# PBL Group Builder — Implementation Spec

**Context:** JABSOM Problem-Based Learning group assignment across units MD1–MD7. The class is split into groups of 5–6 students, each with one or two faculty tutors, reshuffled every unit. Assignments must satisfy hard rules, optimize soft preferences, and carry history forward so repeats are avoided across units. Student data is FERPA-protected, so nothing may leave the operator's machine.

---

## 1. Recommended architecture: a single offline HTML file

**Build the tool as one self-contained `.html` file that runs entirely in the browser.** The operator double-clicks it, it opens in Chrome/Edge/Safari, and all parsing, solving, and exporting happen client-side in JavaScript. No server, no install, no internet connection used.

Why this beats the alternatives given the constraints:

| Option | FERPA-safe? | Install needed | Drag-drop UI | Verdict |
|---|---|---|---|---|
| **Single offline HTML file** | Yes — data never leaves the machine | None (any browser) | Easy | **Recommended** |
| Excel + VBA macro | Yes | Macros often blocked by university IT; security prompts | Painful | No |
| Python script / `.exe` | Yes | Requires Python or a flagged executable on managed machines | Hard | No |
| Web app with backend | No — data would transit/store in cloud | — | — | Disqualified |

The key insight: a local HTML file with embedded JavaScript is a full programming environment that touches nothing outside the page. It reads the operator's spreadsheet through a file picker, processes it in memory, and writes a new spreadsheet back to the Downloads folder. The student data only ever exists in that browser tab.

**Distribution:** email the single `.html` file, or drop it on a shared drive. There is no version-server to maintain; updates are just a new file.

---

## 2. Data: the workbook is the source of truth

Because there is no cloud backend, the operator's **master workbook is also the durable database**. The tool reads it, solves the current unit, and writes the result back into the same workbook (including history). The operator keeps one workbook per cohort for the whole MD1–MD7 cycle.

A template workbook with these sheets:

**`Students`** — one row per student:

- `StudentID` (stable key, e.g. initials+number; used everywhere instead of full name)
- `Name`
- `Gender` (for balance)
- `Imi` (Y/N — Imi Hoʻōla student)
- `Resident` (Y/N — Hawaiʻi resident vs non-resident)
- `LCMentorID` (faculty ID of their Learning Community mentor — cannot be their tutor)
- `ScheduleTag` (e.g. `ImiGA`, `HOMEmgr`, `Exception:Tue-AM`, blank if none)

**`Tutors`** — one row per faculty:

- `TutorID`, `Name`
- `Availability` (which time slots / schedule tags this tutor can cover)
- `MaxStudents` (default 6)
- `CoTutorOK` (Y/N — can share a group)

**`Conflicts`** — one row per conflict pair (covers both conflict types):

- `TypeA_ID`, `TypeB_ID`, `Kind` (`student-student` or `tutor-student`), optional `Reason`

**`Groups`** — defines this unit's slots:

- `Unit` (MD1…MD7), `GroupID`, `TimeSlot`, `TutorID(s)`

**`History`** — auto-appended by the tool after each unit; the engine of repeat-avoidance:

- `Unit`, `StudentID`, `GroupID`, `TutorID`

History gives the solver everything it needs: "never repeat a tutor" = scan a student's prior `TutorID`s; "avoid repeat groupmates" = scan who shared a `GroupID` with them before. The operator never hand-maintains history — they just don't delete the sheet.

> **Format note:** support both `.xlsx` (parsed in-browser via SheetJS) and `.csv`. Provide the operator a pre-built template workbook with these exact column headers and a couple of example rows so setup is foolproof.

---

## 3. Constraints

### Hard (must never be violated; a draft that breaks one is invalid)

1. **Tutor–student conflict** — a flagged tutor and student cannot share a group.
2. **Student–student conflict** — a flagged student pair cannot share a group.
3. **No repeat tutor** — a student is never assigned a tutor from any prior unit.
4. **Schedule fit** — students with `ScheduleTag` (Imi GAs, HOME managers, exceptions) go only into groups whose `TimeSlot`/tutor availability accommodates them.
5. **LC mentor ≠ tutor** — a student's group tutor is never their LC mentor.

### Soft (optimize; each violation adds a weighted penalty)

1. **Spread Imi students** — at most one Imi student per group where possible.
2. **Spread non-residents** — distribute non-residents across groups.
3. **Gender balance** — keep each group's gender mix near the class ratio.
4. **Avoid repeat groupmates** — minimize pairs who were grouped together in a previous unit.

Soft-constraint weights are **adjustable sliders** in the UI, because the relative importance shifts year to year. The solver minimizes total weighted penalty subject to all hard constraints holding.

---

## 4. Solver

This is a constraint-satisfaction + optimization problem at small scale (≈60–80 students, ≈12 groups), well within reach of a heuristic running in-browser in well under a second.

**Algorithm:**

1. **Pre-filter / domain reduction** — for each student, compute the set of groups they *could* legally join (eliminating hard-constraint violations from the start: incompatible schedule slots, groups whose tutor is a conflict / prior tutor / LC mentor).
2. **Greedy seeding** — place the most-constrained students first (fewest legal groups), respecting hard constraints, to find a valid starting assignment. Restart with reshuffling if a dead-end is hit.
3. **Local search (simulated annealing / hill-climbing)** — repeatedly swap pairs of students between groups, keeping only moves that preserve all hard constraints and lower the total soft-penalty score. Run many random restarts and keep the best result.
4. **Report** — output the assignment plus a scorecard: every hard constraint marked satisfied, each soft metric scored (e.g. "Imi separation: 11/12 groups clean," "repeat groupmate pairs: 3"), and any unavoidable hard-constraint violation surfaced explicitly with the reason.

**When no fully legal solution exists** (over-constrained input), the tool does not silently fudge it: it returns the least-bad assignment and a red flag naming exactly which hard rule it had to relax and for whom — so the operator can fix the input (add a tutor, resolve a conflict) and rerun.

---

## 5. Workflow and UI ("Both": auto-solve + manual override)

The operator's experience, start to finish:

1. **Open** the HTML file. **Load** the master workbook via the file picker.
2. The tool validates the input and reports any data problems (missing IDs, an LC mentor not in the Tutors sheet, etc.) before solving.
3. **Pick the unit** (MD1–MD7) and confirm the group/tutor slots for it.
4. **Auto-solve.** Within a second, a draft assignment appears as a board: one column per group, student chips inside, tutor(s) at the top, plus the live scorecard.
5. **Manual override.** The operator can **drag a student** from one group to another. On every move the tool **re-validates live**: a move that breaks a hard rule turns the chip red with a tooltip ("would repeat tutor Dr. X from MD2"); soft-score changes update instantly. Hard-rule-breaking moves can be blocked or allowed-with-warning (configurable).
6. **Re-solve / lock.** The operator can lock specific students in place and re-run the solver to optimize around them.
7. **Export.** Write the finalized assignment back into the workbook: a per-unit results sheet plus appended `History` rows. Also offer a clean printable/PDF roster. The new workbook downloads locally; the operator saves it as the master for the next unit.

Everything in steps 1–7 happens offline in the tab.

---

## 6. Build phases

- **Phase 1 — Data + validation.** Template workbook, SheetJS in-browser parsing, input validation and error reporting. Proves the FERPA-safe round-trip (load → display → export) before any solving.
- **Phase 2 — Solver.** Hard-constraint engine + greedy seed + local search + scorecard. Validate against a real (de-identified) past unit to confirm it reproduces a sensible assignment.
- **Phase 3 — Interactive board.** Drag-and-drop UI with live re-validation, locking, soft-weight sliders, re-solve.
- **Phase 4 — Export polish.** Write-back to workbook with history append, printable roster, PDF.

---

## 7. Open questions to confirm before building

1. **Cohort size and group count per unit** — to confirm the solver's scale (heuristic is fine up to a few hundred; just confirms restart counts).
2. **One or two tutors per group** — how often co-tutoring happens, and whether co-tutor pairs themselves have constraints.
3. **History scope** — should "no repeat tutor" and "avoid repeat groupmates" span the entire MD1–MD7 cycle, or reset at some boundary (e.g. preclinical vs clinical)?
4. **Hard-move policy** — in manual mode, should the tool *block* moves that break hard rules, or *allow with a warning*?
5. **Schedule modeling** — is `TimeSlot` a small fixed set (e.g. AM/PM blocks), or finer-grained? This determines how `ScheduleTag` matching is encoded.
