// Headless test of the pure data logic in index.html (no browser needed).
//
// Extracts the app <script> from index.html, stubs the browser globals it
// touches at load time, exposes the pure functions, and exercises:
//   - template build -> xlsx -> parse round-trip is lossless and clean
//   - validation catches the classic data problems (dupes, bad refs, bad enums)
//
// Run:  node tests/core.test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

process.on('uncaughtException', (e) => {
  console.error('UNCAUGHT:', e && e.message);
  console.error((e && e.stack || '').split('\n').slice(0, 4).join('\n'));
  process.exit(1);
});

// 1. Load SheetJS (standalone build exports via CJS default under ESM import).
const _mod = await import('../vendor/xlsx.full.min.js');
const XLSX = _mod.default ?? _mod.XLSX ?? globalThis.XLSX;
assert.ok(XLSX && XLSX.utils, 'SheetJS failed to load');

// 2. Pull the app script out of index.html (the one without a src attr).
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const m = html.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/i);
assert.ok(m, 'could not locate the app <script> block');
const appSrc = m[1] + '\n;globalThis.__app = { validate, parseWorkbook, buildWorkbook, parsePasted, solve, defaultWeights, makeExample, resultSheets, TEMPLATE, SCHEMA, SHEET_ORDER };';

// 3. Minimal stubs for the DOM/browser globals referenced at load time.
const stubEl = () => new Proxy({}, {
  get: (t, k) => (k === 'classList') ? { add(){}, remove(){} }
                 : (k in t) ? t[k] : (typeof k === 'string' ? function(){} : undefined),
  set: () => true,
});
const sandbox = {
  XLSX,
  document: { getElementById: stubEl, createElement: stubEl, addEventListener(){} },
  FileReader: class { readAsText(){} readAsArrayBuffer(){} },
  alert: () => {},
  console,
  globalThis: null, // set below
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox);
const app = sandbox.__app;
assert.ok(app && app.validate, 'app functions not exposed');

// --- Test 1: template round-trips losslessly and validates clean ----------
const wb = app.buildWorkbook(app.TEMPLATE);
const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
const reread = {};
const wb2 = XLSX.read(new Uint8Array(buf), { type: 'array' });
for (const name of app.SHEET_ORDER)
  reread[name] = XLSX.utils.sheet_to_json(wb2.Sheets[name], { defval: '', raw: false });

let res = app.validate(reread);
assert.equal(res.errors.length, 0, 'template should have 0 errors, got: ' +
  JSON.stringify(res.errors));
assert.equal(reread.Students.length, app.TEMPLATE.Students.length, 'student count preserved');
assert.equal(reread.Students[0].StudentID, 'AB01', 'student id preserved');
assert.equal(reread.Blockouts.length, app.TEMPLATE.Blockouts.length, 'Blockouts sheet round-trips');
console.log('✓ template round-trips losslessly and validates with 0 errors');

// --- Test 2: validation catches deliberately broken data ------------------
const bad = JSON.parse(JSON.stringify(app.TEMPLATE));
bad.Students.push({ StudentID:'AB01', Name:'Dup', Gender:'F', Imi:'X', Resident:'Y', LCMentorID:'T99', ScheduleTag:'' });
bad.Groups.push({ Unit:'MD9', GroupID:'G3', TimeSlot:'AM', TutorIDs:'T55' });
res = app.validate(bad);
const msgs = res.errors.map(e => e.msg).join(' | ');
assert.ok(/duplicate StudentID "AB01"/.test(msgs), 'should flag duplicate StudentID');
assert.ok(/Imi must be Y\/N/.test(msgs), 'should flag bad Imi enum');
assert.ok(/LCMentorID "T99" is not in the Tutors/.test(msgs), 'should flag unknown LC mentor');
assert.ok(/Unit must be one of MD1/.test(msgs), 'should flag bad unit');
assert.ok(/TutorID "T55" is not in the Tutors/.test(msgs), 'should flag unknown group tutor');
console.log(`✓ validation caught ${res.errors.length} seeded errors`);

// --- Test 3: pasted rows (Excel/Sheets are tab-delimited) parse + match ---
const tsv = [
  'StudentID\tName\tGender\tImi\tResident\tLCMentorID\tScheduleTag',
  'GH04\tGil Bladder\tM\tN\tY\tT01\t',
  'IJ05\tMy Graine\tF\tY\tN\tT03\tImiGA',
].join('\n');
const pasted = app.parsePasted(tsv);
assert.equal(pasted.match, 'Students', 'tab-delimited paste should match the Students sheet');
assert.equal(pasted.rows.length, 2, 'both pasted data rows parsed');
assert.equal(pasted.rows[0].Name, 'Gil Bladder', 'pasted cell value parsed');
// And a CSV paste still matches by headers.
const csv = 'TutorID,Name,Availability,MaxStudents,CoTutorOK\nT09,Dr. Polly Mer,AM,6,Y';
assert.equal(app.parsePasted(csv).match, 'Tutors', 'comma-delimited paste should match the Tutors sheet');
console.log('✓ pasted rows parse and match the right sheet');

// --- Test 4: solver places everyone with no hard-rule violations ----------
const sol = app.solve(app.TEMPLATE, 'MD1', app.defaultWeights());
const placed = sol.groups.reduce((n, g) => n + g.students.length, 0);
assert.equal(placed, app.TEMPLATE.Students.length, 'every student is placed in some group');
assert.equal(sol.violations.length, 0, 'example data solves with 0 relaxed hard rules, got: ' +
  JSON.stringify(sol.violations));
assert.ok(sol.scorecard.hard.every(h => h.ok), 'scorecard reports all hard constraints satisfied');
// No student appears in two groups.
const seen = new Set();
sol.groups.forEach(g => g.students.forEach(id => { assert.ok(!seen.has(id), 'no duplicate placement'); seen.add(id); }));
// Spot-check specific hard rules on the produced assignment:
const groupOf = id => sol.groups.find(g => g.students.includes(id));
assert.notEqual(groupOf('AB01').GroupID, groupOf('CD02').GroupID, 'student–student conflict AB01/CD02 kept apart');
assert.ok(!groupOf('IJ05').tutors.includes('T01'), 'IJ05 not tutored by their LC mentor T01');
assert.ok(!groupOf('EF03').tutors.includes('T02'), 'tutor–student conflict T02/EF03 respected');
console.log(`✓ solver placed all ${placed} students, 0 violations, hard rules verified`);

// --- Test 5: over-constrained input is flagged, not silently fudged -------
const tight = JSON.parse(JSON.stringify(app.TEMPLATE));
// Force a dead-end: the only group is tutored by EF03's conflict tutor T02 (and CD02's LC mentor).
tight.Groups = [{ Unit:'MD1', GroupID:'G1', Day:'Mon', Start:'09:00', End:'11:00', TutorIDs:'T02' }];
const tightSol = app.solve(tight, 'MD1', app.defaultWeights());
assert.ok(tightSol.violations.length > 0, 'over-constrained input surfaces at least one relaxed hard rule');
console.log(`✓ over-constrained input flagged ${tightSol.violations.length} relaxed rule(s) instead of hiding them`);

// --- Test 6: the ~80-student example cohort solves cleanly ----------------
const ex = app.makeExample();
assert.equal(ex.Students.length, 80, 'example cohort has 80 students');
const exSol = app.solve(ex, 'MD2', app.defaultWeights());
const exPlaced = exSol.groups.reduce((n, g) => n + g.students.length, 0);
assert.equal(exPlaced, 80, 'all 80 example students placed');
assert.equal(exSol.violations.length, 0, '80-student example solves with 0 relaxed hard rules, got: ' +
  JSON.stringify(exSol.violations.slice(0, 5)));
assert.ok(exSol.scorecard.hard.every(h => h.ok), 'example scorecard reports all hard constraints satisfied');
console.log(`✓ 80-student example placed all ${exPlaced}, 0 violations across ${exSol.groups.length} groups`);

// --- Test 7: locks pin a student to a group across a (re-)solve ------------
const lockEx = app.makeExample();
const locks = new Map([['S10', 'G3'], ['S20', 'G7']]);
const lockedSol = app.solve(lockEx, 'MD2', app.defaultWeights(), locks);
const groupIdOf = id => (lockedSol.groups.find(g => g.students.includes(id)) || {}).GroupID;
assert.equal(groupIdOf('S10'), 'G3', 'locked student S10 stays in G3');
assert.equal(groupIdOf('S20'), 'G7', 'locked student S20 stays in G7');
const lockedPlaced = lockedSol.groups.reduce((n, g) => n + g.students.length, 0);
assert.equal(lockedPlaced, 80, 'all students still placed with locks applied');
console.log('✓ locked students are pinned to their groups across a re-solve');

// --- Test 8: write-back produces Results rows + appended, idempotent history ---
const wbEx = app.makeExample();
const solEx = app.solve(wbEx, 'MD2', app.defaultWeights());
const sheets1 = app.resultSheets(solEx, wbEx);
assert.equal(sheets1.results.length, 80, 'Results has one row per placed student');
assert.ok(sheets1.results.every(r => r.Unit === 'MD2' && r.GroupID && r.StudentID),
  'Results rows carry Unit/Group/Student');
const md2Hist = sheets1.history.filter(r => r.Unit === 'MD2');
assert.equal(md2Hist.length, 80, 'one MD2 history row per student (single-tutor groups)');
assert.ok(sheets1.history.some(r => r.Unit === 'MD1'), 'prior MD1 history is preserved');
// Idempotent: feeding the merged history back in and re-merging keeps MD2 count stable.
const wbAgain = { ...wbEx, PBLHistory: sheets1.history };
const sheets2 = app.resultSheets(solEx, wbAgain);
assert.equal(sheets2.history.filter(r => r.Unit === 'MD2').length, 80,
  're-export replaces (not duplicates) this unit\'s history rows');
console.log(`✓ write-back: ${sheets1.results.length} Results rows, MD2 history appended idempotently`);

// --- Test 9: cohort filtering scopes the solve to one class ---------------
const cohortEx = app.makeExample();
assert.ok(cohortEx.Students.every(s => s.Cohort), 'example students carry a Cohort');
const inCohort = app.solve(cohortEx, 'MD2', app.defaultWeights(), null, '2028');
assert.equal(inCohort.groups.reduce((n, g) => n + g.students.length, 0), 80,
  'solving the present cohort places all 80');
const noCohort = app.solve(cohortEx, 'MD2', app.defaultWeights(), null, '1999');
assert.ok(noCohort.error || noCohort.groups.every(g => g.students.length === 0),
  'a cohort with no matching group slots yields no placements (flagged, not fudged)');
console.log('✓ cohort filtering scopes the solve to the chosen class');

// --- Test 10: with no Groups sheet, auto-build one group per assigned tutor --
const autoWb = app.makeExample();
autoWb.Groups = [];                       // no slots defined → derive from tutors
const autoSol = app.solve(autoWb, 'MD2', app.defaultWeights());
assert.equal(autoSol.groups.length, 14, 'auto-builds one group per MD2 tutor (14)');
assert.ok(autoSol.groups.every(g => g.tutors.length === 1), 'one tutor per auto-built group');
assert.equal(autoSol.groups.reduce((n, g) => n + g.students.length, 0), 80, 'all placed via auto-built groups');
assert.equal(autoSol.violations.length, 0, 'auto-built groups solve cleanly');
console.log('✓ auto-built groups (no Groups sheet) place all 80 cleanly');

// --- Test 11: a role block-out keeps that role's students out of overlapping groups ---
const schedWb = {
  Students: [
    { StudentID:'P1', Name:'One', Gender:'F', Imi:'N', Resident:'Y', LCMentorID:'', ScheduleTag:'R', Cohort:'2028' },
    { StudentID:'P2', Name:'Two', Gender:'M', Imi:'N', Resident:'Y', LCMentorID:'', ScheduleTag:'',  Cohort:'2028' },
  ],
  Tutors: [
    { TutorID:'TA', Name:'A', Units:'MD1', MaxStudents:6, CoTutorOK:'Y' },
    { TutorID:'TB', Name:'B', Units:'MD1', MaxStudents:6, CoTutorOK:'Y' },
  ],
  Conflicts: [],
  Groups: [
    { Unit:'MD1', GroupID:'G1', Day:'Mon', Start:'09:00', End:'11:00', TutorIDs:'TA' },
    { Unit:'MD1', GroupID:'G2', Day:'Tue', Start:'09:00', End:'11:00', TutorIDs:'TB' },
  ],
  Blockouts: [{ Subject:'R', Day:'Mon', Start:'09:00', End:'11:00' }],   // role R busy Mon 9–11 → can't use G1
  PBLHistory: [],
};
const ss = app.solve(schedWb, 'MD1', app.defaultWeights());
const gOf = id => (ss.groups.find(g => g.students.includes(id)) || {}).GroupID;
assert.equal(ss.violations.length, 0, 'role-blockout case solves cleanly');
assert.equal(gOf('P1'), 'G2', 'role-blocked student avoids the overlapping group (Mon 9–11)');
console.log('✓ role block-out keeps the role\'s students out of overlapping groups');

// --- Test 12: a unit block-out keeps EVERYONE in that unit out of the overlapping group ---
const unitWb = JSON.parse(JSON.stringify(schedWb));
unitWb.Blockouts = [{ Subject:'MD1', Day:'Tue', Start:'09:00', End:'11:00' }];   // a course for MD1, Tue 9–11
const us = app.solve(unitWb, 'MD1', app.defaultWeights());
assert.equal(us.violations.length, 0, 'unit-blockout case solves cleanly');
assert.equal(us.groups.find(g => g.GroupID === 'G2').students.length, 0, 'unit block-out empties the overlapping group for everyone');
console.log('✓ unit block-out empties the overlapping group for the whole unit');

// --- Test 13: auto-built groups take the tutor's time and respect block-outs ---
const autoSched = {
  Students: [
    { StudentID:'A', Name:'A', Gender:'F', Imi:'N', Resident:'Y', LCMentorID:'', ScheduleTag:'', Cohort:'2028' },
    { StudentID:'B', Name:'B', Gender:'M', Imi:'N', Resident:'Y', LCMentorID:'', ScheduleTag:'', Cohort:'2028' },
  ],
  Tutors: [
    { TutorID:'TA', Name:'A', Units:'MD1', Day:'Mon', Start:'09:00', End:'11:00', MaxStudents:6, CoTutorOK:'Y' },
    { TutorID:'TB', Name:'B', Units:'MD1', Day:'Tue', Start:'09:00', End:'11:00', MaxStudents:6, CoTutorOK:'Y' },
  ],
  Conflicts: [], Groups: [],                                   // no Groups → auto-build one per tutor
  Blockouts: [{ Subject:'MD1', Day:'Mon', Start:'09:00', End:'11:00' }],   // course blocks TA's slot
  PBLHistory: [],
};
const asol = app.solve(autoSched, 'MD1', app.defaultWeights());
assert.equal(asol.groups.length, 2, 'auto-builds one group per tutor (no Groups sheet)');
assert.ok(asol.groups.every(g => g.day), 'auto-built groups carry the tutor\'s meeting day');
const monG = asol.groups.find(g => g.day === 'Mon');
assert.equal(monG.students.length, 0, 'a unit block-out empties the auto-built group at the blocked time');
assert.equal(asol.violations.length, 0, 'the other auto-built group seats everyone cleanly');
console.log('✓ auto-built groups take tutor times and honor block-outs (Groups sheet optional)');

console.log('\nALL TESTS PASSED');
