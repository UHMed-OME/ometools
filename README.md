# PBL Group Builder

A single, self-contained, **offline** web tool for JABSOM (John A. Burns School of Medicine)
Problem-Based Learning group assignment. It splits a class into tutor-led groups for a unit,
respecting hard rules and optimizing soft preferences, and carries history forward so groups
reshuffle across units.

**▶ Live app: https://uhmed-ome.github.io/ometools/**

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

## Other tools in this toolkit
The same offline shell hosts additional OME tools (pick them from the left sidebar):

- **Procurement Wizard** — a step-by-step guide that turns *what you're buying* + *funding source* + *amount* into the right method, forms, routing, and a generated submission-packet PDF (UH/State and RCUH rules built in). No student data; all client-side.
- **Exam Break Screener** — parses an ExamSoft **snapshot log** (the per-event `[NAVIGATION]` data, `qsEntr`/`qsExt` with timestamps) to surface, for one student's exam:
  1. **Inactivity gaps** longer than a configurable break threshold (the iPad sits idle → no events);
  2. **Post-break answer activity** — a question revisited and *changed* right after a gap (`rvNum` jumped), or answered suspiciously fast on resuming;
  3. **Correctness** of those changed answers — *optional*, by pasting the ExamSoft learner-responses CSV (the same export Elentra imports); the join is experimental until a real export is mapped.

  It renders a summary + gaps/flags tables and saves a JABSOM-branded **PDF report**. It is a **screening aid for human review, not a verdict** — a gap is only iPad inactivity, not proof of a break or misconduct. The log itself never leaves the browser.

## Feedback
Use GitHub Issues to report bugs or request features:
- [Report a bug](https://github.com/UHMed-OME/ometools/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/UHMed-OME/ometools/issues/new?template=feature_request.yml)

Please do not include student names, IDs, schedules, screenshots with roster data, or any other
FERPA-protected information in public issues.

## Develop
- Run: open `index.html` in a browser (`start index.html` on Windows).
- Build the single file: `node build.mjs` → `dist/pbl-group-builder.html`.
- Test the pure logic: `node tests/core.test.mjs`.

See [`CLAUDE.md`](CLAUDE.md) for architecture, [`PBL_Group_Builder_Spec.md`](PBL_Group_Builder_Spec.md)
for the spec, and [`REDESIGN.md`](REDESIGN.md) / [`USABILITY_AUDIT.md`](USABILITY_AUDIT.md) for design notes.

> **After cloning, activate the data-safety hook:** `git config core.hooksPath .githooks`
