# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

**Phases 1–3 are implemented** (data + validation + FERPA-safe round-trip, the solver, and the interactive board), plus UX work on top:
- **Paste import** — `parsePasted()` ingests tab-delimited rows from Excel/Google Sheets (or CSV text), matching the target sheet by headers like the `.csv` path; pasting into an already-loaded workbook replaces just that one sheet.
- **Inline editor** — the sheet view renders editable text cells, Y/N **toggle switches** for `BOOL_COLS` (`Imi`/`Resident`/`CoTutorOK`), a **`ScheduleTag` dropdown**, and **sanitized pick-lists** (`FIELD_KINDS`, scoped per sheet so identifier columns stay free text): static enums (`GENDER_OPTS`, `AVAIL_OPTS`, `MAXSTU_OPTS`, `KIND_OPTS`, `TIMESLOT_OPTS`, `UNIT_OPTS`) and record refs (`refOptions` — LC Mentor → tutors by name, Conflict Person A/B → students+tutors, history refs). All show human labels; the canonical value is stored. Add/delete-row too. Edits write back into `workbook` and re-validate live. **Undo/redo** (`history`/`histPtr`, `pushHistory`/`undo`/`redo`, `Ctrl+Z`/`Ctrl+Shift+Z`/`Ctrl+Y`) snapshots the whole workbook per committed edit; `loadWorkbook` calls `resetHistory()`; the keydown handler defers to native field undo while a text input is focused.
- **Example data loads by default** — `makeExample()` generates a deterministic ~80-student cohort (14 tutors/groups for MD2, prior MD1 history, sparse conflicts, a few schedule exceptions) with enough slack to solve with 0 violations (covered by a test). The auto-load at script end is gated on `document.body` so it's skipped under the headless test. The small `TEMPLATE` is still the downloadable starter and what the data/solver tests use.
- **Solver (Phase 2)** — pure functions (no DOM): `solve(workbook, unit, weights, locks?)` → `buildIndex` / `priorData` / `groupsForUnit` → `seed` (greedy, most-constrained-first) → `optimize` (hill-climbing swaps/moves, snapshot-revert, 12 seeded restarts via `mulberry32`) → `verifyHard` scorecard. Hard rules in `staticViolation` + `memberConflict`; soft penalties in `metricsOf`/`penaltyOf` weighted by `SOFT` slider values (never hardcoded). Over-constrained input is **not fudged**: `leastBad` keeps the least-bad placement and the relaxed rule is surfaced in `result.violations`. **Schedule-fit model (spec open Q §7.5):** only `Exception:<Day>-AM/PM` binds hard (group `TimeSlot` must match AM/PM); `ImiGA`/`HOMEmgr`/custom tags are informational — tighten in `scheduleFits()`.
- **Interactive board (Phase 3)** — `renderResult` recomputes hard flags + soft scores **live** from `lastResult.groups`, so manual edits update instantly. Chips are **drag-and-drop** between groups (delegated DnD on `#board`); a chip that breaks a hard rule turns red with a tooltip. **Lock** (`locked` Set, 🔒 per chip) pins students; **Re-solve (keep locked)** passes a `locks` Map to `solve()` (pinned in `seed`, never moved in `optimize`); **Unlock all** clears them. A fresh **Solve** clears locks; `loadWorkbook` resets them.
- **Readable labels** — a display layer (`SHEET_LABELS`, `COLUMN_LABELS`, `TAG_LABELS`/`tagLabel()`, `genderLabel`) maps canonical keys to plain-English titles for rendering only; the data keeps canonical keys/values for the `.xlsx` round-trip. Don't rename data keys.
- **Theme & logo** — **light mode only** (no dark `prefers-color-scheme`): a **white masthead** with a deep-green wordmark and a single green accent rule (`border-bottom`); no gold trim (by request — green is the sole accent, `--gold` is unused). The real JABSOM logo lives at `vendor/jabsom-logo.svg`, referenced relatively in `index.html` and inlined as a `data:` URI by `build.mjs`. Never a remote URL (FERPA/offline).

`PBL_Group_Builder_Spec.md` remains the authoritative source; read it before building further, and treat its open questions (spec §7) as things to confirm with the operator rather than guess. **Phase 4** (write-back of the solved assignment as a per-unit Results sheet + appended `PBLHistory`, plus a printable/PDF roster) is **not built yet** — Export still writes only the raw workbook round-trip (`buildWorkbook`), not the solved board.

## Layout

- `index.html` — the app. Loads `vendor/xlsx.full.min.js` via a relative `<script src>`. This is what GitHub Pages serves.
- `vendor/xlsx.full.min.js` — vendored SheetJS (Apache-2.0), committed. Never load SheetJS from a CDN.
- `vendor/jabsom-logo.svg` — the JABSOM logo (a PNG wrapped in SVG). Referenced relatively in `index.html`; inlined as a `data:` URI by the build.
- `build.mjs` — `node build.mjs` inlines SheetJS **and** the logo into `dist/pbl-group-builder.html`, the **single self-contained, emailable** file the spec mandates (spec §1). `dist/` is the distribution artifact. **Gotcha:** the replacements pass a *function* to `String.replace`, not a string — the minified SheetJS contains `$&`/`$'` sequences that string-form `replace` would interpret as special patterns and silently corrupt the library. Keep the function form.
- `tests/core.test.mjs` — `node tests/core.test.mjs` runs the pure data logic (validation, build, round-trip, paste parsing) headlessly by extracting the app `<script>` from `index.html` and stubbing the DOM. No browser/deps needed. It regex-matches the script block as **the last `<script>` before `</body>` with no `src` attr**, then *appends its own* `globalThis.__app = { validate, parseWorkbook, buildWorkbook, parsePasted, TEMPLATE, SCHEMA, SHEET_ORDER }` line referencing those top-level names. So: keep the app script last before `</body>`, and if you rename any of those functions/consts in `index.html`, update the export line in the test or it silently fails to load them. The app's load-time DOM wiring (`$('btn…').onclick = …`, `document.addEventListener('keydown', …)`) runs against the test's stubs, so keep wiring tolerant of them — the stub `document` only provides `getElementById`, `createElement`, and `addEventListener`; if you call another `document`/`window` method at load time, add it to the test stub.
- `.nojekyll` — so Pages serves `vendor/` (Jekyll would skip it).

### Deviation from spec
Excel **reserves the worksheet name "History"** (change-tracking), so SheetJS (and Excel) reject it. The spec's `History` sheet is stored as **`PBLHistory`** — identical columns. This is the only schema name that differs from spec §2.

## Commands

- Run/preview: open `index.html` in a browser (`start index.html`), or open the bundled `dist/pbl-group-builder.html`.
- Build single-file: `node build.mjs`
- Test: `node tests/core.test.mjs`
- After editing `index.html` or `vendor/`, re-run the build so `dist/` stays current.

## What this is

A tool for JABSOM (medical school) Problem-Based Learning group assignment. The class (~60–80 students) is split into groups of 5–6, each with one or two faculty tutors, and **reshuffled every unit MD1–MD7**. The tool assigns students to groups subject to hard rules, optimizes soft preferences, and uses accumulated history to avoid repeats across units.

## Hard architectural constraints (these are not optional)

- **Single self-contained `.html` file, runs 100% in-browser, fully offline.** The operator double-clicks it; it opens in Chrome/Edge/Safari. No server, no build step, no install, no network calls. Distribution is just emailing the file.
- **FERPA: student data must never leave the machine.** No fetch/XHR/CDN/telemetry at runtime. Any libraries (e.g. SheetJS) must be inlined into the HTML, not loaded from a CDN. This rules out a backend, hosted web app, or any cloud dependency.
- **The operator's workbook is the database.** There is no other persistence. The tool reads the master `.xlsx`/`.csv`, solves the current unit, and writes results + appended history back into a downloaded workbook that becomes the master for the next unit. Use SheetJS (inlined) for parsing/writing; support both `.xlsx` and `.csv`. **CSV is asymmetric by design:** a loaded `.csv` is a single table, so only one sheet is ingested (matched to a schema sheet by its headers); export always writes the full multi-sheet `.xlsx` (`PBL_template.xlsx` / `PBL_export.xlsx`). The real round-trip is `.xlsx`; `.csv` load is a convenience for single-sheet edits.

## Workbook schema (the data contract)

Sheets and key columns — see spec §2 for full column lists:
- **`Students`** — `StudentID` (stable key used everywhere instead of name), `Name`, `Gender`, `Imi` (Y/N), `Resident` (Y/N), `LCMentorID`, `ScheduleTag`.
- **`Tutors`** — `TutorID`, `Name`, `Availability`, `MaxStudents` (default 6), `CoTutorOK`.
- **`Conflicts`** — `TypeA_ID`, `TypeB_ID`, `Kind` (`student-student` | `tutor-student`), `Reason`.
- **`Groups`** — `Unit`, `GroupID`, `TimeSlot`, `TutorIDs` — defines this unit's slots. (Spec §2 writes the column as `TutorID(s)`; the literal header in code is `TutorIDs`, and it holds a comma/semicolon/slash-separated list — `splitIds()` parses it for co-tutors.)
- **`PBLHistory`** (spec calls it `History`; renamed — see Deviation above) — `Unit`, `StudentID`, `GroupID`, `TutorID` — auto-appended after each unit. This sheet **is** the repeat-avoidance engine: "no repeat tutor" scans prior `TutorID`s for a student; "avoid repeat groupmates" scans who shared a `GroupID`. Never require the operator to hand-edit it.

Ship a template workbook with these exact headers and example rows.

## Constraints the solver enforces

**Hard (a draft violating any one is invalid):** (1) tutor–student conflict, (2) student–student conflict, (3) no repeat tutor across prior units, (4) schedule fit via `ScheduleTag` ↔ `TimeSlot`/availability, (5) a student's tutor is never their `LCMentorID`.

**Soft (weighted penalties, minimized):** spread Imi students (≤1 per group), spread non-residents, gender balance near class ratio, avoid repeat groupmates. Weights are **adjustable UI sliders** — do not hardcode them.

When the input is over-constrained and no fully legal solution exists, **do not silently fudge it**: return the least-bad assignment and explicitly flag which hard rule was relaxed and for whom.

## Solver approach (spec §4)

Heuristic, must run in-browser in well under a second at this scale:
1. Domain reduction — per student, precompute the set of legally joinable groups.
2. Greedy seeding — place most-constrained students (fewest legal groups) first; restart on dead-end.
3. Local search — simulated annealing / hill-climbing swapping students between groups, keeping only hard-constraint-preserving moves that lower total soft penalty; many random restarts, keep best.
4. Scorecard — report every hard constraint satisfied, each soft metric scored, and any unavoidable violation surfaced with a reason.

## UI model

Auto-solve **plus** manual override. After solving, show a board (one column per group, student chips, tutor(s) at top, live scorecard). Dragging a student re-validates live: hard-rule-breaking moves turn the chip red with a tooltip explaining why; soft scores update instantly. Operator can lock students and re-solve around them. Export writes a per-unit results sheet + appended `History`, plus a printable/PDF roster.

## Build phases (spec §6)

1. Data + validation: template, in-browser parse, input validation/error reporting — prove the load→display→export round-trip first.
2. Solver: hard-constraint engine + greedy seed + local search + scorecard.
3. Interactive board: drag-drop, live re-validation, locking, soft-weight sliders, re-solve.
4. Export polish: write-back with history append, printable roster, PDF.

## Repo hygiene (this repo is PUBLIC)

- The repo is **public** under `UHMed-OME`. No student data may ever be committed; `.gitignore` excludes `*.xlsx`/`*.csv`/`/data/`.
- A version-controlled pre-commit hook in `.githooks/pre-commit` hard-blocks committing any spreadsheet/data file (`.xlsx/.xls/.csv/.numbers/.ods/.tsv`), even with `git add -f`. Only `*.template.xlsx`/`*.template.csv` (de-identified) are allowed.
- **After cloning, activate the hook:** `git config core.hooksPath .githooks` (it is not auto-enabled by clone).

## Running / testing

There is no build or test tooling. To run, open the `.html` file directly in a browser (`start file.html` on Windows). When validating the solver, test against a real **de-identified** past unit to confirm it reproduces a sensible assignment — never use real student data in this repo.
