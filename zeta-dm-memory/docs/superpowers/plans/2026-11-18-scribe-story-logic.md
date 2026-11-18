# Plan: Zeta Scribe story-logic check

Design: `docs/superpowers/specs/2026-11-18-scribe-story-logic-design.md`. One task, one commit.

All paths are relative to `zeta-dm-memory/`. Code style follows the surrounding file: tag-only docblocks on every method, braces always, no single-letter names, values in `Settings`, code lines at most 120 columns outside prompt strings.

## Task 1: the situation check

### Files

- `scribe/page/ScribePedant.js`
- `scribe/page/ScribeLive.js`: `Settings.Needs` gains the new kind; the `ScribePedant.review` call passes `messages: view.messages`. Nothing else.
- `scribe/page/PanelView.js` and `scribe/page/ScribePanel.js` (title, text, hint, Dismiss for the new kind)
- `scribe/page/ScribeKeeper.js` (the checker's default model)
- `tests/scribe-pedant.test.mjs`, `tests/scribe-live.test.mjs`, `tests/scribe-panel.test.mjs`, `tests/scribe-keeper.test.mjs`, `tests/scribe-whole.test.mjs` (call-count expectations change because every reply now makes a call; listed in the report)
- `scribe/scribe.user.js`, rebuilt with `node scribe/pack.mjs`
- `docs/verification/scribe-page-verification.md`: a dated paragraph for this task with counts

### Changes in `ScribePedant.js`

1. `Kind.Situation: 'Situation'`; `Block.Situation: 'SITUATION'`.
2. `Settings`: `MostSituations: 3`, `RecentCount: 10`, `RecentCharacters: 20000`, `SituationQuote: 300`, `Headings.Recent: 'RECENT MESSAGES:'`, and the field positions the parser needs (reuse existing constants where they mean the same).
3. **Recent messages.** `review({ state, player, message, unread, messages, ask })` gains `messages` (the chat's messages in order; a missing or non-array value is `[]`). A new function `recent(message, messages, shown)` returns the messages that go in `RECENT MESSAGES:`: of the last `RecentCount` messages with `position < message.position`, those not among `shown` (the messages the SINCE section shows: all of `earlier` when it fits, none when it is `(too long to show)`), in order; then, while their joined transcript (the `[#N] ` prefixes included) is over `RecentCharacters`, the oldest is dropped; if one message remains and is still over, its end is kept so that the section, prefix included, is at most `RecentCharacters` (the speaker label may be cut; the message's blocks are cut to the same end, so the quote test sees only what was shown). `survey` returns `shown` for this. `input` places the section (heading, then `ScribeIntake.transcript` of those messages) before `SINCE THE BOOK WAS LAST READ:`, and leaves it out when empty. The SINCE section, `(too long to show)` and the leak pairs are unchanged.
4. **Every reply is checked.** `review` no longer returns early when the ledger and the candidates are empty: every non-player reply makes one call. Existing tests asserting no call (`alone`, `quiet`, near `tests/scribe-pedant.test.mjs:1379-1390`) change to assert one call, and what each proved is kept (for example that no unconfirmed spelling is raised).
5. **Prompt.**
   - The receive line adds `the RECENT MESSAGES before them,` before `the messages SINCE THE BOOK WAS LAST READ`.
   - The find line becomes: `Find where the REPLY disagrees with the LEDGER, where a speaker uses something they do not know, which NAME CANDIDATES are misspellings, and where the REPLY does not fit what the messages above establish.`
   - `Answer with these three blocks` becomes `Answer with these four blocks`.
   - The format gains, after the MISSPELLINGS example: `=== SITUATION` and `the reply's own words | the earlier words they clash with`.
   - Rule 7, after rule 6, exactly as the design gives it.
6. **Parsing.** `parse` returns `{ contradictions, leaks, misspellings, situations }`. The SITUATION branch runs before the `NoneLine` skip and before the fact-number check: a line that, after the usual cleanup, is exactly `none` or `(none)` (any case, optional trailing `.`) is skipped; a line with at least two pipe-separated fields becomes `{ said: first field, earlier: the rest joined with ' | ' }`, each field first losing one layer of outer wrapping (`**…**`, `*…*`, `_…_`, backticks, by `Settings.Wrapped`; `***a***` keeps `*a*`; a `__…__` pair loses one underscore at each end, the quote test removes the rest; first and last markers of separate spans count as the wrap) and then a `**` or `__` at its edges only when the field holds an odd number of that marker (`Settings.DressMarkers`); any other line is skipped (the block stays open, as CONTRADICTIONS and LEAKS do). A quote starting `None...` or `Nonetheless...` is kept. The MISSPELLINGS one-rule reading is unchanged; a known heading still switches blocks. Existing tests that deep-equal the parse result gain `situations: []`.
7. **Confirming.** A new function `situated(message, situations, shown)`, called by `review` with the messages shown in RECENT and SINCE:
   - `said` must pass the leak check's quote test against the reply's folded blocks, and `earlier` against the folded block texts of the shown messages (the words of each message, never its `Speaker: ` or ` (player)` labels), with the length limit `SituationQuote` instead of `MostWords` (add a length parameter to `claimed`, or a sibling; one declaration per purpose);
   - `folded` maps the double quotation marks of `Settings.DoubleQuotes` (`"`, `“`, `”`, `„`, `‟`, `«`, `»` and the other double forms listed there) to one character, as it already does for the apostrophe forms; other single quote forms are not folded; the quote test also strips outer quotation marks of the forms `"` `'` `“` `‘` / `"` `'` `”` `’` from each quote, repeatedly (up to four passes), but not `«»`, `„“` or `「」`;
   - a line whose `said` or `earlier` has fewer than `Settings.FewestSituationWords` (2) words by `ScribeText.words` is dropped;
   - a line whose reply words (`ScribeReplay.wording`: case, punctuation and markup ignored) repeat a kept line is dropped;
   - at most `MostSituations` are kept, in answer order;
   - each kept line becomes `ScribePedant.finding(message, { kind: Situation, said, book: earlier })` (the words as the quote test returns them), all other fields null.
   `review` returns `confirm(...)`, then `misspelt(...)`, then `situated(...)`.
8. **Keys, spent, told.** `key(finding)` for Situation: `JSON.stringify([kind, message, ScribeReplay.wording(said)])` (the reply words folded to words, as contradictions do; or the array form the other kinds use, as long as it holds those three). `spent` returns false for Situation before any fact lookup. `told` is unchanged (leak only).

### Changes in `ScribeLive.js`

`Settings.Needs.Situation: ['said', 'book']`; the `review` call passes `messages: view.messages`. Situation never makes a reminder due or leads one (no change needed: only Contradiction does; a test states it).

### Changes in the panel

- `PanelView` words: `Situation: "The reply doesn't fit what's happening"`, the text `The reply says "<said>"; earlier: "<book>".`, and a new hint `If the reply should not stand, regenerate it.` shown only while the finding is open (as the leak hint is).
- The known-kinds list (`PanelView.js` near line 883) includes Situation. The card has one action, **Dismiss**, wired like the others' Dismiss.

### Change in `ScribeKeeper.js`

The default `pedant` model becomes `mistralai/mistral-large-4-0`. Saved settings are not migrated.

### Tests that try to break it

`tests/scribe-pedant.test.mjs`:
- Prompt: contains the new receive and find lines, `four blocks`, `=== SITUATION` and rule 7 exactly.
- Recent: a book read up to the reply (empty SINCE) shows the last 10 messages under RECENT; a SINCE of 3 messages gives RECENT the 7 before them; a SINCE of 30 gives no RECENT section; a too-long SINCE gives RECENT the last 10; the 20,000-character cap drops the oldest, and a single over-long message keeps its end; `messages` missing behaves as `[]`.
- Every reply: a reply with no ledger and no candidates makes one call.
- Parse: SITUATION with two fields, three fields (earlier joins the rest), one field (skipped), `(none)`, `None.`; a quote starting `Nonetheless` is kept; SITUATION before and after the other blocks; MISSPELLINGS then `=== SITUATION` switches.
- Confirm, with the operator's two cases as fixtures:
  - read messages establishing three nights of camping, the book read up to the reply; the reply asks "You have a bed?"; the model line `You have a bed? | We camp for three nights getting there`: one Situation finding with those words;
  - messages establishing they stand at the door; reply with `reaching past Frost's arm toward the bedroom | They stood at the door`: one finding.
  - A `said` not in the reply, an `earlier` not in any shown message, an `earlier` only in a message older than the last 10 and outside SINCE, a quote over 300 characters: each dropped. A quote of 200 characters in both places: kept.
  - Five valid lines: three kept, in order; a repeated `said`: one kept.
- `review` order: contradictions, leaks, spellings, situations.
- Key and spent: two Situation findings with the same words on one message share a key; `spent` is false after any book change.

`tests/scribe-live.test.mjs`: a scripted checker answer with a SITUATION line raises a Situation finding stored with `said` and `book`; it survives a reload; Dismiss keeps it dismissed for the same reply; a regenerated reply drops it; it does not make a reminder due; the review call receives `view.messages`.

`tests/scribe-panel.test.mjs`: a Situation finding shows the title, the text with both quotes, the hint while open and not after dismissal, and one Dismiss button; the header count includes it.

`tests/scribe-keeper.test.mjs`: the default pedant model is the large one; a room whose saved settings name the small model keeps it.

`tests/scribe-whole.test.mjs`: call counts updated where a reply now makes a call; each step keeps proving what it proved.

### Commands (each file alone, under the memory limit from the README)

```
NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 120 node --test --test-timeout=20000 tests/scribe-pedant.test.mjs
... scribe-live, scribe-panel, scribe-keeper, scribe-whole, scribe-pack
node scribe/pack.mjs
```

### Done when

All six files pass, `scribe/scribe.user.js` is rebuilt, and the verification record has the counts. After the operator installs it and switches the room's checking model: the cost of one check with the large model is noted in the verification record from the Progress tab's last calls.
