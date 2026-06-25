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
const appSrc = m[1] + '\n;globalThis.__app = { validate, parseWorkbook, buildWorkbook, parsePasted, solve, defaultWeights, makeExample, resultSheets, procDecide, procPacketDocs, procQuoteEmail, pdfLayout, buildPdf, examParseLog, examBuildVisits, examFindGaps, examFindDwells, examFlagPostBreak, examExtraSignals, examScreen, examReportDocs, examTimeline, examParseResponses, EXAM_EXAMPLE, TEMPLATE, SCHEMA, SHEET_ORDER };';

// 3. Minimal stubs for the DOM/browser globals referenced at load time.
const stubEl = () => new Proxy({}, {
  get: (t, k) => (k === 'classList') ? { add(){}, remove(){} }
                 : (k in t) ? t[k] : (typeof k === 'string' ? function(){} : undefined),
  set: () => true,
});
const sandbox = {
  XLSX,
  document: { getElementById: stubEl, createElement: stubEl, addEventListener(){}, querySelectorAll: () => [] },
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
res = app.validate(bad);
const msgs = res.errors.map(e => e.msg).join(' | ');
assert.ok(/duplicate StudentID "AB01"/.test(msgs), 'should flag duplicate StudentID');
assert.ok(/Imi must be Y\/N/.test(msgs), 'should flag bad Imi enum');
assert.ok(/LCMentorID "T99" is not in the Tutors/.test(msgs), 'should flag unknown LC mentor');
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

// --- Test 14: a student with MULTIPLE roles is blocked if ANY role overlaps ---
const multiRole = {
  Students: [
    { StudentID:'M1', Name:'Multi', Gender:'F', Imi:'N', Resident:'Y', LCMentorID:'', ScheduleTag:'ImiGA; HOMEmgr', Cohort:'2028' },
    { StudentID:'M2', Name:'Plain', Gender:'M', Imi:'N', Resident:'Y', LCMentorID:'', ScheduleTag:'',               Cohort:'2028' },
  ],
  Tutors: [
    { TutorID:'TA', Name:'A', Units:'MD1', Day:'Mon', Start:'09:00', End:'11:00', MaxStudents:6, CoTutorOK:'Y' },
    { TutorID:'TB', Name:'B', Units:'MD1', Day:'Tue', Start:'09:00', End:'11:00', MaxStudents:6, CoTutorOK:'Y' },
  ],
  Conflicts: [], Groups: [],
  // Only the SECOND role (HOMEmgr) is blocked, and only on Tue — the multi-role student must avoid TB.
  Blockouts: [{ Subject:'HOMEmgr', Day:'Tue', Start:'09:00', End:'11:00' }],
  PBLHistory: [],
};
const mr = app.solve(multiRole, 'MD1', app.defaultWeights());
const mGroupDay = id => (mr.groups.find(g => g.students.includes(id)) || {}).day;
assert.equal(mr.violations.length, 0, 'multi-role case solves cleanly');
assert.equal(mGroupDay('M1'), 'Mon', 'a second role\'s block-out still keeps the multi-role student out (Tue → Mon)');
console.log('✓ a student\'s multiple roles are all honored by the schedule rule');

// --- Test 15: a tutor's per-unit time override applies to that unit, default to the others ---
const ovWb = {
  Students: [{ StudentID:'X1', Name:'X', Gender:'F', Imi:'N', Resident:'Y', LCMentorID:'', ScheduleTag:'', Cohort:'2028' }],
  Tutors: [{ TutorID:'TX', Name:'X', Units:'MD2; MD3', Day:'Mon', Start:'09:00', End:'11:00', MaxStudents:6, CoTutorOK:'Y' }],
  Conflicts: [], Groups: [], Blockouts: [],
  TutorTimes: [{ TutorID:'TX', Unit:'MD3', Day:'Thu', Start:'13:00', End:'15:00' }],   // override MD3 only
  PBLHistory: [],
};
const md2 = app.solve(ovWb, 'MD2', app.defaultWeights());
const md3 = app.solve(ovWb, 'MD3', app.defaultWeights());
assert.equal(md2.groups[0].day, 'Mon', 'MD2 uses the tutor default day (no override)');
assert.equal(md3.groups[0].day, 'Thu', 'MD3 uses the per-unit override day');
assert.equal(md2.groups[0].students.length + md3.groups[0].students.length, 2, 'the student places in both unit solves');
console.log('✓ per-unit tutor time override applies to its unit, default elsewhere');

// --- Test 16: imperfect paste — variant headers, word values, blank lines, no-match ---
const messy = [
  'Student ID\tName\tGender\tImi\tResident\tLC Mentor\tSchedule\tClass Year',
  'Z9\t Pat Ient \tFemale\tYes\tno\tT01\tImiGA\t2028',
  '\t\t\t\t\t\t\t',                                  // stray blank line
].join('\n');
const mp = app.parsePasted(messy);
assert.equal(mp.match, 'Students', 'variant/friendly headers still match Students');
assert.equal(mp.rows.length, 1, 'fully-blank row dropped');
const mrow = mp.rows[0];
assert.equal(mrow.StudentID, 'Z9', '"Student ID" → StudentID');
assert.equal(mrow.Name, 'Pat Ient', 'value trimmed');
assert.equal(mrow.Gender, 'F', '"Female" → F');
assert.equal(mrow.Imi, 'Y', '"Yes" → Y');
assert.equal(mrow.Resident, 'N', '"no" → N');
assert.equal(mrow.LCMentorID, 'T01', '"LC Mentor" → LCMentorID');
assert.equal(mrow.ScheduleTag, 'ImiGA', '"Schedule" → ScheduleTag');
assert.equal(mrow.Cohort, '2028', '"Class Year" → Cohort');
assert.equal(app.parsePasted('Foo\tBar\n1\t2').match, null, 'unrecognized headers → no confident match');
console.log('✓ imperfect pastes canonicalize headers/values and drop blank rows');

// --- Test 17: procurement decision engine (fund + category + amount thresholds) ---
const formUrls = (r) => r.forms.map(f => f.url);
// UH small buy → P-Card, no HCE gate under $2,500
let p = app.procDecide({ fund: 'uh', type: 'supplies', amount: 800, vendor: 'uh', quotes: 0 });
assert.match(p.method, /P-Card|informal/i, 'UH <$2,500 is a P-Card / informal buy');
assert.ok(!p.gates.some(g => /HCE/.test(g)), 'no HCE gate below $2,500');
// UH mid buy → SuperQuotes via OPM at $25k–$100k, HCE gate applies
p = app.procDecide({ fund: 'uh', type: 'supplies', amount: 40000, vendor: 'new', quotes: 0 });
assert.match(p.approver, /OPM/, 'UH $25k–$100k routes through OPM');
assert.ok(p.gates.some(g => /HCE/.test(g)), 'HCE gate at $2,500+');
// UH large buy → formal CSB/CSP
p = app.procDecide({ fund: 'uh', type: 'supplies', amount: 250000, vendor: 'uh', quotes: 3 });
assert.match(p.method, /Formal|CSB|CSP/i, 'UH $100k+ is a formal solicitation');
// UH construction has its own thresholds (FBO between $25k and $250k)
p = app.procDecide({ fund: 'uh', type: 'construction', amount: 120000, vendor: 'uh', quotes: 0 });
assert.match(p.approver, /FBO|Facilities/, 'UH construction $25k–$250k routes to FBO');
// RCUH thresholds + portal + checklist form
p = app.procDecide({ fund: 'rcuh', type: 'services', amount: 2000, vendor: 'uh', quotes: 0 });
assert.match(p.method, /No quotes/i, 'RCUH <=$3,500 needs no quotes');
assert.equal(p.system, 'RCUH Financial Portal', 'RCUH routes through the Financial Portal');
assert.ok(formUrls(p).some(u => /attachment-28/.test(u)), 'RCUH packet includes the procurement checklist');
p = app.procDecide({ fund: 'rcuh', type: 'supplies', amount: 50000, vendor: 'uh', quotes: 0 });
assert.match(p.approver, /Financial Services Manager/, 'RCUH $25k–$100k → FSM');
// Sole source attaches the fund-appropriate justification form
p = app.procDecide({ fund: 'uh', type: 'supplies', amount: 9000, vendor: 'uh', quotes: 0, sole: true });
assert.ok(formUrls(p).some(u => /SPO-001/.test(u)), 'UH sole source attaches SPO-001');
p = app.procDecide({ fund: 'rcuh', type: 'supplies', amount: 9000, vendor: 'uh', quotes: 0, sole: true });
assert.ok(formUrls(p).some(u => /attachment-2-sole-source/.test(u)), 'RCUH sole source attaches Attachment 02');
// Cooperative contract + DGP gate by category
p = app.procDecide({ fund: 'uh', type: 'computer', amount: 5000, vendor: 'uh', quotes: 0 });
assert.ok(p.coop && /NASPO 24-03/.test(p.coop.ref), 'computer purchases point at the NASPO computer contract');
p = app.procDecide({ fund: 'uh', type: 'software', amount: 5000, vendor: 'uh', quotes: 0 });
assert.ok(p.gates.some(g => /Data Governance|DGP/.test(g)), 'software triggers a DGP data-governance gate');
assert.ok(formUrls(p).some(u => /infosec/.test(u)), 'software packet links the DGP request');
// No amount → neutral prompt, no method
p = app.procDecide({ fund: 'uh', type: 'supplies', amount: NaN, vendor: 'uh', quotes: 0 });
assert.equal(p.method, '', 'no amount yields no method');
console.log('✓ procurement engine: UH/RCUH thresholds, routing, forms, coop contracts, gates');

// --- Test 18: packet PDF generation (document selection + valid PDF bytes) ---
const dd = app.procDecide({ fund: 'rcuh', type: 'software', amount: 30000, vendor: 'uh', quotes: 0, sole: true });
assert.ok(dd.coop && dd.coop.contacts && dd.coop.contacts.length, 'coop contract carries vendor quote contacts');
assert.ok(dd.coop.contacts.some(c => /@/.test(c.email || '')), 'quote contacts include email addresses');
// computer coop carries NASPO-specific vendor sites
const cpu = app.procDecide({ fund: 'uh', type: 'computer', amount: 6000, vendor: 'uh', quotes: 0 });
assert.ok(cpu.coop.contacts.some(c => /naspo/i.test(c.site || '') || /dellnaspovp|hp\.com\/buy|techtoday/i.test(c.site || '')), 'computer vendors carry NASPO ordering sites');
const pdocs = app.procPacketDocs(dd, {
  date: '2026-06-10', requestor: 'Jane Doe', dept: 'OME', fundCode: 'RX123', vendor: 'Carahsoft',
  purpose: 'Survey platform license', typeLabel: 'Software, subscription, or cloud',
  soleWhy: 'Only certified vendor', soleUnique: 'Integrates with REDCap', solePrice: 'GSA pricing',
  quoteRows: [], cover: true, sole: true, quotes: false, checklist: true,
});
assert.equal(pdocs.length, 3, 'cover + sole + checklist selected (quote summary omitted)');
const bytes = app.buildPdf(app.pdfLayout(pdocs));
assert.ok(bytes && bytes.length > 200 && typeof bytes[0] === 'number', 'buildPdf returns non-trivial byte output');
const pdfStr = Array.from(bytes).map(c => String.fromCharCode(c)).join('');
assert.equal(pdfStr.slice(0, 5), '%PDF-', 'starts with the PDF signature');
assert.ok(pdfStr.includes('%%EOF'), 'terminates with %%EOF');
assert.ok(/\nxref\n/.test(pdfStr) && pdfStr.includes('/Root 1 0 R'), 'has an xref table + trailer root');
assert.ok(pdfStr.includes('Sole Source Justification') && pdfStr.includes('RCUH Procurement Checklist'), 'renders the selected document headings');
assert.ok(pdfStr.includes('contact for quotes') || pdfStr.includes('Who to contact for quotes'), 'cover sheet lists who to contact for quotes');
assert.ok(pdfStr.includes('Mariah.Edwards@Carahsoft.com'), 'cover sheet prints the actual quote-contact email');
assert.ok(!pdfStr.includes('Quote / Price Summary'), 'omits the unselected quote summary');
// byte offsets in the xref must point at real "N 0 obj" markers (offset integrity)
const xi = pdfStr.indexOf('xref\n');
const freeEntryStart = pdfStr.indexOf('\n', xi + 5) + 1;     // start of the "0000000000 65535 f " free entry
const obj1Off = parseInt(pdfStr.slice(freeEntryStart + 20, freeEntryStart + 30), 10); // next 20-byte entry = object 1
assert.equal(pdfStr.slice(obj1Off, obj1Off + 7), '1 0 obj', 'object-1 xref offset points at object 1');
console.log('✓ packet generator: selects the right documents and emits a valid PDF with correct offsets');

// --- Test 19: quotes branch + quote-request email (one identical request to all vendors) ---
// Needs quotes but has none → engine flags it and steers to a request, not a summary.
const needs = app.procDecide({ fund: 'uh', type: 'computer', amount: 9000, vendor: 'uh', quotes: 0 });
assert.equal(needs.needQuotes, true, '$9k UH purchase needs competitive quotes');
assert.equal(needs.haveQuotes, false, 'no quotes in hand');
assert.ok(needs.docs.some(d => /still need|request/i.test(d)), 'no-quotes path lists "you still need these", not "N attached"');
// Has quotes → summarize instead.
const has = app.procDecide({ fund: 'uh', type: 'computer', amount: 9000, vendor: 'uh', quotes: 3 });
assert.ok(has.docs.some(d => /quotes attached/i.test(d)), 'quotes-in-hand path lists attached quotes');
// Quote email: one subject/body addressed to ALL the contract's vendor emails.
const qe = app.procQuoteEmail(needs, { item: 'Laptops', specs: '10x ThinkPad X1', deadline: '2026-06-20', requestor: 'Jane Doe', dept: 'OME' });
assert.ok(qe.recipients.length >= 3 && qe.recipients.every(e => /@/.test(e)), 'request targets all contract vendor emails');
assert.match(qe.subject, /Quote Request - Laptops - OME/, 'subject is built from the item + department');
assert.ok(/reference NASPO 24-03/i.test(qe.body), 'body cites the cooperative contract number');
assert.ok(/15 business days/.test(qe.body), 'body asks for a 15-day quote validity');
// Generating a packet with no quotes includes the Request-for-Quote doc (not a price summary).
const reqDocs = app.procPacketDocs(needs, { cover: false, quoteReq: true, item: 'Laptops', specs: '10x ThinkPad X1', deadline: '2026-06-20', requestor: 'Jane Doe', dept: 'OME' });
const reqPdf = Array.from(app.buildPdf(app.pdfLayout(reqDocs))).map(c => String.fromCharCode(c)).join('');
assert.ok(reqPdf.includes('Request for Quote') && reqPdf.includes('Heather.Morgado@dell.com'), 'quote-request doc lists the identical recipients');
assert.ok(!reqPdf.includes('Quote / Price Summary'), 'no price summary when there are no quotes');
console.log('✓ quotes branch: no quotes → make a request (to all vendors); quotes → summarize');

// --- Test 20: exam screener — parse/dedup, gap detection, post-break flags ---
const ep = app.examParseLog(app.EXAM_EXAMPLE);
assert.ok(ep.events.length > 0, 'snapshot log parses into events');
assert.equal(ep.events.every(e => Number.isFinite(e.t) && e.evt), true, 'events carry a numeric timestamp + evt');
// Non-NAVIGATION / malformed lines are ignored, not fatal.
const noisy = app.examParseLog('garbage line\n' + app.EXAM_EXAMPLE + '\n4/27 [NAVIGATION] {not json}');
assert.equal(noisy.events.length, ep.events.length, 'noise and malformed JSON lines are skipped');
// Duplicate ExamSoft rows collapse.
const doubled = app.examParseLog(app.EXAM_EXAMPLE.split('\n').flatMap(l => [l, l]).join('\n'));
assert.equal(doubled.events.length, ep.events.length, 'doubled (qId,evt,t) rows are de-duplicated');
assert.ok(doubled.dupesRemoved > 0, 'reports how many duplicates were collapsed');

const rep = app.examScreen(app.EXAM_EXAMPLE, { gapMin: 4, rapidSec: 8, dwellMin: 5 });
assert.ok(rep.gaps.length >= 1, 'finds the ~9-minute idle gap over the 4-min threshold');
assert.ok(rep.gaps.some(g => g.durMs >= 8 * 60000), 'longest gap is ~9 minutes');
assert.ok(rep.gaps.every(g => g.after.evt === 'qsExt'), 'break gaps are between questions (after a qsExt), not time-on-question');
assert.equal(rep.summary.flagCount, rep.flags.length, 'summary flag count matches');
// The post-break Q2 revisit changed its answer (rvNum 1→3) → a switch flag.
const sw = rep.flags.find(f => f.visit.qId === 'Q2' && f.reasons.some(r => r.kind === 'switch'));
assert.ok(sw, 'flags the post-break answer switch on Q2 (rvNum jumped)');
// Q5 was answered in 3s after the break → a rapid-answer flag.
assert.ok(rep.flags.some(f => f.visit.qId === 'Q5' && f.reasons.some(r => r.kind === 'rapid')), 'flags the rapid post-break answer on Q5');
// The ~6-minute span on Q6 (never left) is a long-dwell signal, NOT a break gap.
assert.ok(rep.dwells.some(d => d.qId === 'Q6' && d.durMs >= 5 * 60000), 'finds the long in-place dwell on Q6');
assert.ok(!rep.gaps.some(g => g.before.qId === 'Q6' || g.after.qId === 'Q6'), 'the Q6 dwell is not miscounted as a break gap');
assert.ok(rep.extra.some(x => x.type === 'dwell' && x.qId === 'Q6'), 'dwell surfaces as an "other" signal');
assert.equal(rep.summary.reviewCount, rep.flags.length + rep.extra.length, 'review count = post-break flags + other signals');
// A high threshold suppresses the gap (and thus the flags) — nothing is hardcoded.
const calm = app.examScreen(app.EXAM_EXAMPLE, { gapMin: 30, rapidSec: 8, dwellMin: 30 });
assert.equal(calm.gaps.length, 0, 'no gaps when the threshold is above the largest idle span');
assert.equal(calm.flags.length, 0, 'no post-break flags without a qualifying gap');
assert.equal(calm.dwells.length, 0, 'no dwell signal when the dwell threshold is high');
console.log(`✓ exam screener: parsed ${ep.events.length} events, ${rep.gaps.length} gap(s), ${rep.flags.length} flag(s), ${rep.dwells.length} dwell(s)`);

// --- Test 20b: change-burst + blank→answered signals on a tailored log ------
const burstLog = [
  '5/1/2026 8:00:00 AM [NAVIGATION] {"qId":"A","ans":"{A}","rvNum":1,"evt":"qsEntr","log":1778000000000}',
  '5/1/2026 8:00:20 AM [NAVIGATION] {"qId":"A","rvNum":1,"evt":"qsExt","log":1778000020000}',
  '5/1/2026 8:00:20 AM [NAVIGATION] {"qId":"B","ans":"{B}","rvNum":1,"evt":"qsEntr","log":1778000020000}',
  '5/1/2026 8:00:40 AM [NAVIGATION] {"qId":"B","rvNum":1,"evt":"qsExt","log":1778000040000}',
  '5/1/2026 8:00:40 AM [NAVIGATION] {"qId":"C","ans":"{}","rvNum":0,"evt":"qsEntr","log":1778000040000}',   // C left blank
  '5/1/2026 8:00:50 AM [NAVIGATION] {"qId":"C","rvNum":0,"evt":"qsExt","log":1778000050000}',
  // --- 10-minute gap ---
  '5/1/2026 8:10:50 AM [NAVIGATION] {"qId":"A","ans":"{X}","rvNum":2,"evt":"qsEntr","log":1778000650000}',  // A changed
  '5/1/2026 8:11:10 AM [NAVIGATION] {"qId":"A","rvNum":2,"evt":"qsExt","log":1778000670000}',
  '5/1/2026 8:11:10 AM [NAVIGATION] {"qId":"B","ans":"{Y}","rvNum":2,"evt":"qsEntr","log":1778000670000}',  // B changed
  '5/1/2026 8:11:30 AM [NAVIGATION] {"qId":"B","rvNum":2,"evt":"qsExt","log":1778000690000}',
  '5/1/2026 8:11:30 AM [NAVIGATION] {"qId":"C","ans":"{Z}","rvNum":1,"evt":"qsEntr","log":1778000690000}',  // C now answered
  '5/1/2026 8:11:50 AM [NAVIGATION] {"qId":"C","rvNum":1,"evt":"qsExt","log":1778000710000}',
].join('\n');
const br = app.examScreen(burstLog, { gapMin: 4, rapidSec: 1, dwellMin: 30 });
assert.ok(br.extra.some(x => x.type === 'burst' && x.count >= 2), 'flags a change burst (A and B changed within the window after the gap)');
assert.ok(br.extra.some(x => x.type === 'blank' && x.qId === 'C'), 'flags blank→answered on C (unanswered before the gap, answered after)');
console.log('✓ exam screener: change-burst and blank→answered signals fire on a tailored log');

// --- Test 21: exam screener — optional responses CSV join + valid PDF report ---
const respCsv = 'Question,Response,Correct\nQ2,D,Yes\nQ5,A,No\nQ4,A,Yes';
const respParsed = app.examParseResponses(respCsv);
assert.ok(respParsed.ok, 'responses CSV with id + correctness columns parses');
const repC = app.examScreen(app.EXAM_EXAMPLE, { gapMin: 4, rapidSec: 8, responses: respParsed });
const q2 = repC.flags.find(f => f.visit.qId === 'Q2');
assert.equal(q2.correct, true, 'Q2 post-break switch is marked correct from the CSV');
assert.equal(q2.wrongToRight, true, 'Q2 changed-after-break-and-now-correct is flagged as the pattern of interest');
assert.equal(repC.summary.wrongToRight, 1, 'summary counts the changed→correct pattern');
// Unmappable CSV degrades gracefully (no crash, ok:false).
assert.equal(app.examParseResponses('foo,bar\n1,2').ok, false, 'a CSV with no id/correctness column is reported unmapped');
// PDF report builds and is structurally valid.
const exDocs = app.examReportDocs(repC, { exam: 'MD4 Final', student: 'De-identified', date: '2026-06-25' });
const exBytes = app.buildPdf(app.pdfLayout(exDocs, { headerLabel: 'Exam activity screen' }));
const exStr = Array.from(exBytes).map(c => String.fromCharCode(c)).join('');
assert.equal(exStr.slice(0, 5), '%PDF-', 'report starts with the PDF signature');
assert.ok(exStr.includes('%%EOF') && /\nxref\n/.test(exStr), 'report has xref + EOF');
assert.ok(exStr.includes('Exam Activity Screen'), 'report renders its heading');
console.log('✓ exam screener: responses join marks correctness and the PDF report is valid');

// --- Test 22: best-effort taker-ID detection + labeled report ---------------
assert.equal(app.examParseLog(app.EXAM_EXAMPLE).taker, null, 'the plain navigation example embeds no taker id');
const idLog = '5/1/2026 8:00:00 AM [INFO] {"takerId":"STU-12345","examId":"MD4"}\n' + app.EXAM_EXAMPLE;
const idParsed = app.examParseLog(idLog);
assert.ok(idParsed.taker && idParsed.taker.value === 'STU-12345', 'detects an embedded takerId when the log carries one');
assert.equal(idParsed.events.length, app.examParseLog(app.EXAM_EXAMPLE).events.length, 'the id line is not counted as a navigation event');
const idRep = app.examScreen(idLog, { gapMin: 4 });
assert.ok(idRep.taker && idRep.taker.value === 'STU-12345', 'examScreen surfaces the detected taker');
const whoDocs = app.examReportDocs(idRep, { student: 'STU-12345', exam: 'MD4 Final' });
const whoPdf = Array.from(app.buildPdf(app.pdfLayout(whoDocs))).map(c => String.fromCharCode(c)).join('');
assert.ok(whoPdf.includes('STU-12345') && whoPdf.includes('MD4 Final'), 'the report PDF prints the student + exam label');
console.log('✓ exam screener: taker-ID auto-detection and labeled report');

// --- Test 23: PDF report wraps long cell text within the page (no cutoff) ----
const longRep = app.examScreen(app.EXAM_EXAMPLE, { gapMin: 4, rapidSec: 8, dwellMin: 5,
  responses: app.examParseResponses('Question,Response,Correct\nQ2,D,Yes\nQ5,A,No') });
const longDocs = app.examReportDocs(longRep, {
  exam: 'MD4 PBL/Lecture Final 2026 (a deliberately long exam name meant to stress text wrapping in the report header and tables)',
  student: 'Jane Doe (STU-0042)', date: '2026-06-25' });
const longPages = app.pdfLayout(longDocs, { headerLabel: 'Exam activity screen' });
const PAGE_RIGHT = 612 - 54;   // page width minus the right margin
let maxRight = 0;
const tmRe = /\/F[12] (\d+(?:\.\d+)?) Tf 1 0 0 1 ([\d.]+) [\d.-]+ Tm \(((?:[^()\\]|\\.)*)\) Tj/g;
for (const pg of longPages) {
  let mm;
  while ((mm = tmRe.exec(pg))) {
    const size = +mm[1], x = +mm[2], txt = mm[3].replace(/\\([()\\])/g, '$1');   // unescape \( \) \\ for true length
    maxRight = Math.max(maxRight, x + txt.length * size * 0.52);                  // same width estimate pdfWrap uses
  }
}
assert.ok(maxRight <= PAGE_RIGHT, `report text must stay within the page (widest ${maxRight.toFixed(1)} <= ${PAGE_RIGHT})`);
console.log(`✓ exam report PDF wraps within the page (widest text ends at ${maxRight.toFixed(1)}pt of ${PAGE_RIGHT}pt)`);

// --- Test 24: activity timeline geometry (normalized 0..1 positions) --------
const tlRep = app.examScreen(app.EXAM_EXAMPLE, { gapMin: 4, rapidSec: 8, dwellMin: 5 });
const tl = app.examTimeline(tlRep);
assert.ok(tl.spanMs > 0, 'timeline has a positive span');
assert.equal(tl.gaps.length, tlRep.gaps.length, 'one timeline segment per break gap');
assert.ok(tl.gaps.every(g => g.x0 >= 0 && g.x1 <= 1 && g.x1 > g.x0), 'gap segments are within 0..1 and ordered');
assert.ok(tl.dwells.some(d => d.qId === 'Q6'), 'the Q6 dwell appears on the timeline');
assert.equal(tl.flags.length, tlRep.flags.length, 'one marker per post-break flag');
assert.ok(tl.flags.every(f => f.x >= 0 && f.x <= 1), 'flag markers are within 0..1');
// The gap sits in the first half (it happens early in the example) and Q6 dwell at the end.
assert.ok(tl.gaps[0].x0 < 0.6, 'the example gap starts in the first part of the exam');
assert.ok(tl.dwells.find(d => d.qId === 'Q6').x1 > 0.9, 'the closing dwell reaches the end of the timeline');
console.log('✓ activity timeline maps gaps, dwells, and post-break markers onto a 0..1 axis');

console.log('\nALL TESTS PASSED');
