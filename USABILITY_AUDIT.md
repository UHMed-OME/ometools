# PBL Group Builder — Usability Audit

A fresh heuristic evaluation of the **current** build (commit `4fb327a`), judging the real
operator experience end-to-end rather than the feature list. Persona: a JABSOM faculty/staff
operator — competent but occasional, not a power user. Method: Nielsen heuristics + the
ui-ux-pro-max categories. Findings are deliberately critical and may question earlier choices.

## Top issues (prioritized)

| # | Severity | Finding | Recommendation |
|---|----------|---------|----------------|
| 1 | 🟠 High | **No protection against losing work.** Everything is in memory; closing/refreshing the tab after editing or solving silently discards it. | Add a `beforeunload` warning when there are unsaved edits/an unexported solve. (Keep it FERPA-safe: warn only, no auto-persist of student data.) |
| 2 | 🟠 High | **Example data loads by default with weak framing.** A new operator can't tell the 80 fake students from their own data, and may edit/solve the sample thinking it's real — or not realize they must load their workbook. | Make first-run an explicit choice (empty state: "Load your workbook" vs "Explore with example data"). When example is active, show a persistent "Example data — Clear" banner. |
| 3 | 🟠 High | **"Fix errors above" points to the wrong place.** The solve-blocked message says fix the errors "above," but with tabs the errors live on the **Roster** tab, not above the board. | Make the blocked message link to Roster and the first error (reuse `jumpToError`). |
| 4 | 🟡 Med | **Icon-only transport hurts discoverability.** example/open/paste/template/undo/redo/export are icon-only; tooltips need hover (no touch) and the meanings aren't obvious to occasional users. | Show icon **+ text label** at ≥720px; keep icon-only on phones. Or group "Data" vs "Edit" vs "Output". |
| 5 | 🟡 Med | **Undo doesn't cover the board.** Ctrl+Z/undo only reverts roster edits (workbook snapshots); dragging/move-select on the board isn't undoable, which violates the "same action, same undo" expectation we set in the editor. | Snapshot board state into an undo stack too, or add a "Reset to solved" button on the board. |
| 6 | 🟡 Med | **Output is split in two places.** Export is a transport icon; Print/PDF is a board-action button. The natural "I'm done → produce the roster" step has no single home. | Consolidate into one Export area/step (the deferred stepper's Export step), or put both buttons together after the board. |
| 7 | 🟡 Med | **"Total penalty" is jargon.** Operators don't think in penalty units; the number is meaningless without context. | Drop it from the scorecard (or move behind "details"); keep the plain-language metric cards. |
| 8 | 🟢 Low | **Per-chip "Move…" select adds clutter** at 80 chips (three controls per chip: drag + move + lock). | Reveal the Move select on focus/hover only; keep it always-available for keyboard via the chip's focus. |

## Findings by area

### Onboarding & mental model
- The four-step reality (Load → Review/edit → Build → Export) isn't signposted; nothing guides
  the operator from Roster to Groups to output. (The deferred **stepper rail** directly fixes
  this — this audit raises its priority.)
- The FERPA note is permanent banner noise after first read; consider making it dismissible.

### Navigation & flow
- Solve lives only on the Groups tab; a first-timer on Roster may not find "where do I make
  groups." A primary "Build groups →" affordance at the end of Roster would bridge it.
- Tabs lack arrow-key navigation and `aria-controls` to their panels (minor a11y).

### Roster editing
- All five sheet sub-tabs (Students/Tutors/Conflicts/Groups/History) are shown with equal
  weight, but operators mostly touch Students. Consider de-emphasizing History (machine-managed)
  and grouping the rest as "Setup".
- Strong points: live validation, sanitized pick-lists, sticky first column, class filter,
  in-app delete confirm, jump-to-error. These are working well.

### Solving & the board
- Before the first solve the board area is empty with no prompt — add "Pick a unit and press
  Solve to build groups."
- A 14-column board scrolls horizontally with no overview; fine at this scale but consider a
  zoom/condense toggle for larger cohorts.
- Capacity shortfall is reported as a count but unplaced students aren't listed.

### Scorecard
- Hard pills + plain-language metric cards read well. "Non-residents over share" is slightly
  cryptic; "Total penalty" is jargon (see #7).

### Data safety
- See #1. Also: an accidental "Load example data" or "Open workbook" silently replaces the
  current in-memory workbook with no confirm — risk of clobbering unsaved edits.

### Accessibility (spot check)
- Good: focus rings, reduced-motion, aria-live on validation/scorecard, modal focus trap,
  keyboard move-select, color always paired with text.
- Gaps: tablist arrow-key nav + `aria-controls`; the move-select font (0.72rem) is small;
  tabpanels lack `aria-labelledby`.

## Suggested remediation order (quick wins first)
1. **#1 beforeunload guard** + **#3 link the blocked-solve message** + **#7 drop Total penalty** — tiny, high value.
2. **#2 first-run framing** (empty state + "example" banner) + confirm before replacing an edited workbook.
3. **#4 icon+text transport** at desktop widths; **#5 board undo / reset**.
4. **Stepper rail** (Load → Build → Export) — addresses flow signposting, output consolidation (#6), and Solve discoverability together.
5. Polish: empty board prompt, dismissible FERPA note, tablist a11y, #8 move-select reveal.
