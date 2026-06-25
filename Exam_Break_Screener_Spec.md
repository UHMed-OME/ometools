# Exam Break Screener — Spec

A tool in the OME Web Toolkit (`#tool-exam` in `index.html`). It parses an ExamSoft
**snapshot log** for a single student's exam and flags patterns worth a human's review:
unusually long inactivity gaps (possible breaks) and answer changes / rapid answers right
after such a gap. Motivated by a faculty question about screening for students who may be
abusing bathroom breaks during exams.

> **It is a screening aid, not a verdict.** A flagged gap means the iPad recorded no events
> for a while — not that the student left, and certainly not that they cheated. Everything
> here is a prompt for a human to look closer, alongside the full record.

## 1. Hard constraints (inherited from the toolkit)
- **Single self-contained `index.html`, 100% in-browser, fully offline.** No server, no
  network calls at runtime. The snapshot log (which may identify a student) never leaves the
  machine. This is a FERPA requirement, identical to the rest of the toolkit.
- **No student data in the repo.** Use synthetic logs only (see `EXAM_EXAMPLE`).

## 2. Input — the ExamSoft snapshot log
ExamSoft's *View Exam Snapshot Log* emits one line per event:

```
4/27/2026 9:09:08 AM [NAVIGATION] {"qId":"lnxp…","ans":"{}","rvNum":0,"evt":"qsEntr","log":1777280948044}
```

- `evt` — `qsEntr` (entered a question) / `qsExt` (left it). Other event types are ignored.
- `qId` — question identifier.
- `rvNum` — answer-revision count for that visit (**assumed**; confirm against a known exam).
- `ans` / `isfdbk` / `nts` — chosen answer / feedback flag / notes.
- `log` — epoch-ms timestamp (authoritative for math); the leading wall-clock string is shown to humans.

ExamSoft commonly emits each event **twice**; the parser de-duplicates identical `(qId, evt, log)` rows.

**Identity.** The snapshot log is **per-student** — you pick the exam-taker in ExamSoft, then view
*their* log — so the `[NAVIGATION]` events carry no taker ID, and within one log every flag is that
one student. The tool therefore lets you **label the report** (Exam + Student/taker ID) so the report
says who it's for. As a fallback, `examDetectId` scans every line's JSON for an identity-looking key
(`takerId`/`candidate`/`studentId`/`email`/…) and, if a real export embeds one, pre-fills the Student
field. Attributing flags across *many* students at once is **batch mode** — a future feature; today
it's one log = one student.

A key distinction underlies the signals: a long span **between** questions (after a `qsExt`,
before the next `qsEntr`) is *idle with nothing open* — a **break candidate**. A long span
**inside** a question (`qsEntr` → its `qsExt`) is a **dwell** — the student never left the
question. These are computed separately so time-on-question is never miscounted as a break.

## 3. What it flags
**Inactivity gaps** — between-question idle spans `≥` the *break gap threshold* (default 4 min,
configurable from the logs faculty keep of real break times).

**Post-break answer activity** — for the visit(s) resuming after a gap:
- **switch**: a revisit to an already-seen `qId` whose `rvNum` increased (answer changed after the break);
- **rapid**: a visit shorter than the *rapid-answer threshold* (default 8 s) that still recorded an answer (`rvNum > 0`).

**Other signals** (`examExtraSignals`):
- **change burst** — ≥ 2 answers changed within a window (default 5 min) of resuming after a gap; a flurry of edits beats a single change.
- **blank → answered** — a question unanswered before a gap (`rvNum` 0) that gets answered after returning.
- **long in-place dwell** — a single question open `≥` the *dwell threshold* (default 5 min) without leaving; covers both look-ups that need no break and in-question absences (the log can't tell them apart).

**Correctness** *(optional, experimental)* — paste the ExamSoft learner-responses CSV (the same
export Elentra's integration imports). A post-break **switch** whose answer is now correct is
highlighted as **changed → correct** (`wrongToRight`) — the specific pattern Jason described. The
snapshot log has no correctness data, and the CSV's question key may not match the log's internal
`qId`, so the join is best-effort until a real export is mapped. Degrades to "unknown".

Thresholds (gap / rapid / dwell) are **live UI controls** — nothing is hardcoded; raising them
suppresses the corresponding signals. The report leads with a one-line **verdict** (N signals to
review) and groups the detail into collapsible sections, so the first screen isn't a wall of tables.

## 4. Output
- Summary cards (exam span, gaps over threshold, longest gap, post-break flags, questions seen).
- An **inactivity-gaps** table and a **post-break activity** table (with switch/rapid/correctness pills).
- A collapsible full question timeline (per-visit duration + `rvNum` + revisit note).
- A JABSOM-branded **PDF report** via the toolkit's dependency-free PDF writer
  (`pdfLayout(docs, {headerLabel})` / `buildPdf`).

## 5. Architecture (where things live in `index.html`)
- **Pure engine** (no DOM, headlessly tested): `examParseLog` → `examBuildVisits` /
  `examFindGaps` (between-question breaks) / `examFindDwells` (in-question dwells) /
  `examFlagPostBreak` / `examExtraSignals` (burst, blank→answered, dwell), `examParseResponses`,
  `examScreen` (the entry point), and `examReportDocs` (PDF blocks). Plus `EXAM_EXAMPLE`
  (synthetic demo log) and helpers `examFmtDur` / `examFmtClock`.
- **DOM wiring**: `initExam` / `examRun` / `examRender` (verdict + collapsible accordion) /
  `examShowInput` (collapse the input to a one-line bar after a screen) / `examReset` /
  `examDownloadPdf`, gated on `document.body` like the other tools so the headless test skips it.
- **Registry**: one `TOOLS` entry (`id: 'exam'`, `icon: 'clock'`) + the `#tool-exam` panel.
- **Tests**: `tests/core.test.mjs` exercises parse/dedupe, gap detection, both post-break flag
  kinds, threshold suppression, the responses join, and PDF validity.

## 6. Open questions / follow-ups
- **`rvNum` semantics** — confirm it is the answer-revision count (it drives the switch signal).
- **Responses-CSV mapping** — finalize the real column names and the `qId` ↔ question-number
  join against a true ExamSoft export before relying on the correctness column.
- **Break threshold** — calibrate the default against the real break-time logs faculty kept.
- **Possible Elentra port** — the pure engine is framework-free; it could move into an Elentra
  Exam-module report (reusing the responses already imported there, with the snapshot log
  uploaded per exam) if OME decides to operationalize it.
