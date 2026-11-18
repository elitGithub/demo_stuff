# Plan: Zeta Scribe checker false alarms (revised)

Design: `docs/superpowers/specs/2026-11-18-scribe-checker-fixes-design.md` (revised 2026-11-18: the model judges name spellings). One task, one commit.

All paths are relative to `zeta-dm-memory/`. Code style follows the surrounding file: tag-only docblocks on every method, braces always, no single-letter names, values in `Settings`, lines at most 120 columns outside prompt strings.

## Task 1: the checker fixes

### Starting point

The working tree holds the earlier build of this task (run matching, lower-case word set, cache, `messages` argument) and its tests. That part is withdrawn. The reference for "as before this work" is `git show HEAD:zeta-dm-memory/scribe/page/ScribePedant.js` (and the same for the test and `ScribeLive.js`). Restore with the Edit tool; git stays read-only.

### Files

- `scribe/page/ScribePedant.js`
- `scribe/page/ScribeLive.js` (back to its HEAD content)
- `tests/scribe-pedant.test.mjs`
- `tests/scribe-live.test.mjs` (the `the chat is shown to the spelling check` test is removed; other live tests changed only if the spelling behaviour change requires it, listed in the report)
- `tests/scribe-whole.test.mjs` only if a whole-walk expectation depends on an unconfirmed spelling finding (listed in the report)
- `scribe/scribe.user.js`, rebuilt with `node scribe/pack.mjs`
- `docs/verification/scribe-page-verification.md`: the dated paragraph added for this task is rewritten to describe this version and its counts

### Changes in `ScribePedant.js`

1. **Withdraw** everything the earlier build added for spelling: `ShortestPhrase`, `Lower`, `Blank`, `Likeness` (if added for runs), the `Chats` cache, `lowerWords`, `likeness`, `parts`, `runs`, the `openNames` split, the `messages` parameter of `spellings` and `review`, and the run tests. `spellings(state, message)` and `openWords` read exactly as at HEAD.
2. **Keep** from the earlier build: `Settings.UncheckedCategories = ['location']` and its use in `survey`; prompt rule 3 `states or uses`; their tests (location never a checkable contradiction; prompt text).
3. **Candidates in the input.** `Settings.Headings.Candidates: 'NAME CANDIDATES:'`. `input(state, player, message, unread, candidates)` adds, after the reply section, `ScribeAnalyzer.section(headings.Candidates, lines)` where each line is `[Settings.CandidatePrefix + (index + 1), candidate.label, candidate.looksLike, candidate.written].join(settings.Joiner)`; `spellings` sets `looksLike` to the name word `ScribeText.resembles` matched, and `misspelt` strips it so stored findings keep today's fields; and `Settings.CandidatePrefix = 'N'`. With no candidates the section is left out entirely (no heading).
4. **The prompt.**
   - The "You receive" line names the new section: `..., one REPLY from the storyteller, and NAME CANDIDATES: words in the REPLY that look like known names, each line giving the name, the word of that name it looks like, and the word in the REPLY.`
   - The "Find where" line becomes: `Find where the REPLY disagrees with the LEDGER, where a speaker uses something they do not know, and which NAME CANDIDATES are misspellings.`
   - `Answer with these two blocks` becomes `Answer with these three blocks`.
   - The answer format gains, after the LEAKS example line: `=== MISSPELLINGS` and `N21` and `N22` (example numbers, one per line, beyond `MostCandidates` so an echoed example never confirms a real candidate).
   - Rules 1 to 5 exist today (rule 3 as changed by this task); rule 6 follows rule 5.
   - Rule 6, appended after rule 5: `6. A misspelling is a word in the REPLY that is meant as the listed known name but is written another way. An ordinary word, a word at the start of a sentence that is not meant as the name, and a different or new name are not misspellings. Report only numbers from NAME CANDIDATES. In the MISSPELLINGS block write only the numbers of the misspellings, one per line, nothing else on the line.`
5. **Parsing.** `ScribePedant.Block` gains `Misspellings: 'MISSPELLINGS'`. `parse(text)` returns `{ contradictions, leaks, misspellings }`; `misspellings` is the list of candidate numbers (integers) read from lines of that block. The whole line is read, after it is cleaned (format characters, list markers, bold, table edges, `NumberDress`: backticks, `*`, `_`, `#`, trailing `.,;:`), and must consist solely of candidate numbers (`Settings.CandidateNumber`, `/^N\s*0*([1-9]\d*)$/i`, per token; a token may be wrapped in brackets, `[N3]`) separated by commas, semicolons, spaces or `and` (a comma or semicolon followed by `and`, as in `N1, N3, and N5`, is one separator). Every number on such a line counts; any other text on the line voids it, a pipe included. While MISSPELLINGS is read, an empty line is skipped and the block stays open; a line that consists solely of candidate numbers is read; any other line (a label in any style or with no colon, a line starting with `none`, prose, an unknown `===` heading, a markdown heading, a checkbox line, a pipe line, a note) ends the block; a markdown heading is a line whose raw text, after format characters and leading whitespace, starts with one or more `#` then whitespace, and it ends the block before any number is read (`# N3` ends it, `#N3` with no space is number dress and reads `[3]`), and no further line counts until a known heading opens a block; a known heading starts its own block, an unknown one starts none. The heading `MISSPELLING` is read as `MISSPELLINGS`. Existing blocks parse as today.
6. **Confirming.** `confirm(...)` is unchanged for contradictions and leaks, caps included. A new function `misspelt(candidates, numbers)` returns the candidate at each confirmed number (1-based, in range, each number once; out-of-range and repeated numbers ignored), unchanged, as Spelling findings, in candidate order. Spellings do not go through the caps, as at HEAD (the per-fact slot would collapse them all into one). Each line `N<k>` is its own candidate, so one word listed against two known names can be confirmed for both.
   - At most `Settings.MostCandidates = 20` candidates are sent, the first 20 in `spellings` order; the rest are neither sent nor raised.
7. **`review({ state, player, message, unread, ask })`.**
   - `candidates = ScribePedant.spellings(state, message)` cut to `MostCandidates`.
   - If the survey ledger is empty and there are no candidates: return `[]` with no call.
   - Otherwise call the model once with `input(..., candidates)`.
   - A throw from `ask` propagates (no unconfirmed spelling finding; `ScribeLive` raises nothing for it and shows the problem; findings of unchanged replies are kept, and an edited or regenerated reply's old findings go, as they always have; the new text is checked when the model is back and the reply is shown again, not on a timer and not after a reload; a check refused because the budget ran out during it is checked again when the budget frees).
   - Otherwise return `confirm(...)` (contradictions and leaks, as today) followed by `misspelt(candidates, parsed.misspellings)`. An answer that parses empty is a valid "nothing found", never a failure.

### Change in `ScribeLive.js`

Back to HEAD: the `messages: view.messages` line is removed.

### Tests that try to break it (`tests/scribe-pedant.test.mjs`)

Existing HEAD spelling tests on `spellings` stay as they were at HEAD (they now test candidates). The location and prompt tests from the earlier build stay. Withdrawn run, lower-case and cache tests are removed. New:

- `input` with candidates: the section text exactly, numbered from `N1` in `spellings` order; with no candidates no `NAME CANDIDATES:` heading appears.
- `parse`: `=== MISSPELLINGS` with `N1`, `n 2`, `**N3**`, `- N4`, `N0`, `N-1`, `X5`, `N1 | Thessaly | Thessely` (voided: any text other than candidate numbers voids the line), `(none)`; any line that is not numbers only ends the block (an unknown `===` heading, a `#` heading, a label, a checkbox line, prose), and `[N3]` is read; `N1, N3, and N5` is read as three numbers; mixed with the other two blocks in any order.
- `review` with a scripted model:
  - Candidates `Fine` (Nine Quarter) and `Thessely` (Thessaly); the model answers `N2` only: one Spelling finding, `Thessely`.
  - The model answers nothing for MISSPELLINGS: no Spelling finding.
  - The model answers `N9`, `N2`, `N2`: one finding (`N2`), `N9` ignored.
  - Empty ledger with one candidate: the model is called once; the prompt holds the candidate.
  - Empty ledger, no candidates: no call.
  - `ask` throws: the review rejects with the same error.
  - The model answers a CONTRADICTIONS block and no MISSPELLINGS block: the contradiction is returned, no Spelling finding.
  - Two candidates confirmed in one reply: two Spelling findings (no cap collapses them).
  - 25 candidates: the input lists `N1` to `N20` only; `N21` in the answer is ignored.
- `spent` and dismissal keys for a confirmed Spelling finding behave as at HEAD (one existing test exercised through `review`).

Live tests and the whole walk: these change, fixture by fixture, and the report lists each change.
- Every scripted checker answer (`PEDANT`, `PEDANT_MANY` and the like in `tests/scribe-live.test.mjs`, `pedantAnswer` in `tests/scribe-whole.test.mjs`) that stands behind an expected Spelling finding gains a `MISSPELLINGS` block with the right `N<k>` for that message's candidates.
- Tests that count checker calls or spending change where a reply with a candidate and an empty ledger now makes a call; each keeps proving what it proved (adjust the scripted cost or the expectation, never drop the check).
- Tests of a failing checker expect no spelling finding for the failed reply, and that the same reply is checked and its spelling raised once the model is back.
- `ScribeLive` is unchanged: it catches the rejection, leaves `raised` null (findings kept, no checked entry) and shows the problem.

### Commands (each file alone, under the memory limit from the README)

```
NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 120 node --test --test-timeout=20000 tests/scribe-pedant.test.mjs
... tests/scribe-live.test.mjs
... tests/scribe-whole.test.mjs
... tests/scribe-pack.test.mjs
... tests/scribe-panel.test.mjs
node scribe/pack.mjs
```

### Done when

All five files pass, `git diff HEAD -- scribe/page/ScribeLive.js` is empty, `scribe/scribe.user.js` is rebuilt from the changed sources, and the verification record describes this version.
