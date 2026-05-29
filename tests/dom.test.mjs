// End-to-end smoke test of the browser path that core.test.mjs can't reach:
//   - HTML structure is well-formed (a dropped </style> renders the page blank)
//   - the app loads + renders without throwing (auto-load → summary/tabs/sheet/solver)
//   - solve → renderResult (board) runs
//   - exportWorkbook builds a workbook
// Uses a richer DOM/Window stub than core.test.mjs and lets the auto-load run.
//
// Run:  node tests/dom.test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const _mod = await import('../vendor/xlsx.full.min.js');
const XLSX = _mod.default ?? _mod.XLSX ?? globalThis.XLSX;
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// --- 1. HTML structure -----------------------------------------------------
for (const t of ['<style>', '</style>', '</head>', '<body>', '</body>', '</html>'])
  assert.ok(html.includes(t), `index.html must contain ${t}`);
assert.equal((html.match(/<\/style>/g) || []).length, 1, 'exactly one </style>');
assert.ok(html.includes('<script src="vendor/xlsx.full.min.js"></script>'), 'vendor script tag present');
const m = html.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/i);
assert.ok(m, 'app <script> is the last script before </body>');
console.log('✓ HTML structure is well-formed (style/head/body closed; app script last)');

// --- 2. DOM/Window stub rich enough to render against ----------------------
const els = {};
function mkEl() {
  const e = {
    _cls: new Set(),
    classList: { add(c){e._cls.add(c)}, remove(c){e._cls.delete(c)},
      toggle(c,f){ const on = f===undefined ? !e._cls.has(c) : !!f; on ? e._cls.add(c) : e._cls.delete(c); return on; },
      contains(c){ return e._cls.has(c) } },
    dataset: {}, style: {}, files: [], children: [],
    addEventListener(){}, removeEventListener(){}, appendChild(){}, setAttribute(){}, getAttribute(){ return null },
    closest(){ return null }, querySelector(){ return null }, querySelectorAll(){ return [] },
    focus(){}, scrollIntoView(){},
    set innerHTML(v){}, get innerHTML(){ return '' }, set textContent(v){}, get textContent(){ return '' },
    set value(v){}, get value(){ return '' }, set hidden(v){}, set disabled(v){},
    set onclick(v){}, set onchange(v){}, set oninput(v){},
  };
  return e;
}
const sandbox = {
  XLSX,
  document: { body: mkEl(), getElementById: (id) => els[id] || (els[id] = mkEl()),
    createElement: mkEl, querySelectorAll: () => [], addEventListener(){} },
  window: { addEventListener(){} },
  FileReader: class { readAsText(){} readAsArrayBuffer(){} },
  alert(){}, confirm(){ return true }, setTimeout: () => 0, clearTimeout(){}, console, globalThis: null,
};
sandbox.globalThis = sandbox;
const src = m[1] + '\n;globalThis.__app = { solve, renderResult, exportWorkbook, makeExample, defaultWeights,' +
  ' showSchedule: () => { activeTab = "Blockouts"; renderSheet(); } };';
vm.createContext(sandbox);

// --- 3. Loading the app (auto-load → full render) must not throw -----------
vm.runInContext(src, sandbox);
console.log('✓ app loads + auto-renders the example without throwing');

// --- 4. Solve → render the board, and build an export workbook -------------
const app = sandbox.__app;
const res = app.solve(app.makeExample(), 'MD2', app.defaultWeights());
app.renderResult(res);
console.log('✓ solve → renderResult (board) runs without throwing');
const wb = app.exportWorkbook();
assert.ok(wb && wb.SheetNames && wb.SheetNames.length, 'exportWorkbook produces a workbook');
console.log('✓ exportWorkbook builds a workbook');

// --- 5. The Schedule calendar tab renders without throwing -----------------
app.showSchedule();
console.log('✓ Schedule calendar tab renders without throwing');

console.log('\nALL DOM TESTS PASSED');
