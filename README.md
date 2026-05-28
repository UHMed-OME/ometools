# PBL Group Builder

A single, self-contained, **offline** web tool for JABSOM (John A. Burns School of Medicine)
Problem-Based Learning group assignment. It splits a class into tutor-led groups for a unit,
respecting hard rules and optimizing soft preferences, and carries history forward so groups
reshuffle across units.

**▶ Live app: https://uhmed-ome.github.io/pbl-group-builder/**

Or download the single-file build [`dist/pbl-group-builder.html`](dist/pbl-group-builder.html)
and double-click it — it runs entirely in your browser.

## FERPA / privacy
Everything runs client-side. The workbook is read locally, processed in memory, and written
back to your Downloads folder. **No data is uploaded, and there are no network calls at runtime.**
SheetJS and the logo are inlined into the single file; nothing loads from a CDN.

## What it does
- **Roster** — load an `.xlsx`/`.csv`, paste rows from Excel/Google Sheets, or start from example
  data. Edit inline with validation, pick-lists, and a per–class-year filter.
- **Build groups** — pick the unit (and class), solve under the hard rules
  (conflicts, no-repeat tutor, schedule fit, LC-mentor ≠ tutor) while minimizing soft penalties
  (spread Imi Hoʻōla students / non-residents, gender balance, avoid repeat groupmates). Drag to
  adjust, lock students, and re-solve.
- **Export** — write the assignment back as a per-unit Results sheet + appended history, and
  print/save a PDF roster.

## Develop
- Run: open `index.html` in a browser (`start index.html` on Windows).
- Build the single file: `node build.mjs` → `dist/pbl-group-builder.html`.
- Test the pure logic: `node tests/core.test.mjs`.

See [`CLAUDE.md`](CLAUDE.md) for architecture, [`PBL_Group_Builder_Spec.md`](PBL_Group_Builder_Spec.md)
for the spec, and [`REDESIGN.md`](REDESIGN.md) / [`USABILITY_AUDIT.md`](USABILITY_AUDIT.md) for design notes.

> **After cloning, activate the data-safety hook:** `git config core.hooksPath .githooks`
