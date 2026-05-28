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
const appSrc = m[1] + '\n;globalThis.__app = { validate, parseWorkbook, buildWorkbook, TEMPLATE, SCHEMA, SHEET_ORDER };';

// 3. Minimal stubs for the DOM/browser globals referenced at load time.
const stubEl = () => new Proxy({}, {
  get: (t, k) => (k === 'classList') ? { add(){}, remove(){} }
                 : (k in t) ? t[k] : (typeof k === 'string' ? function(){} : undefined),
  set: () => true,
});
const sandbox = {
  XLSX,
  document: { getElementById: stubEl, createElement: stubEl },
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

console.log('\nALL TESTS PASSED');
