# Plan: Zeta Scribe panel fix (one Adopt, Settings tab, no stale refusals)

Design: `docs/superpowers/specs/2026-11-18-scribe-panel-progress-design.md` (approved by the operator 2026-11-18, "build it"). One task, one commit.

All paths are relative to `zeta-dm-memory/`. Code style follows the surrounding file: tag-only docblocks on every method, braces always, no single-letter names, values in `Settings`, code lines at most 120 columns outside long strings.

## Task 1

### Files

- `scribe/page/ScribeKeeper.js` (`blocked`, `view().adoptBlock`, `step` repays an owed debt)
- `scribe/page/PanelView.js` (Summary empty text, header line rules if they live here)
- `scribe/page/ScribePanel.js` (header button and line, outcome clearing, Settings tab, Progress tab, Start the book over visibility)
- `tests/scribe-keeper.test.mjs`, `tests/scribe-panel.test.mjs`, `tests/scribe-whole.test.mjs`, `tests/scribe-boot.test.mjs` (only where expectations change; each listed in the report with why)
- `scribe/scribe.user.js`, rebuilt with `node scribe/pack.mjs`
- `docs/verification/scribe-page-verification.md`: a dated paragraph with counts

### Changes, by design point

1. **`ScribeKeeper.blocked(keeper): string|null`**, pure, exactly the checks and order of design point 1: `guard`'s five checks; unless replacing a mismatch, `held(keeper)` then `compared` (`keeper.problem ?? Messages.Unsettled`); `owed.size > 0` returns `keeper.owing`; the reader's claim through `still` in a try (false gives `Messages.Watching`, a throw gives `words(error)`), never calling `lose`. `view()` exposes it as `adoptBlock`. `step` calls `repay` when `owed` is not empty, so a repayable debt clears without a press.
2. **One Adopt button.** `parts.Next` is disabled while `view.adoptBlock !== null` in addition to the existing `ruled` rule. On the Progress tab `parts.Adopt` is hidden in the NoBook and Loading phases and shown otherwise (damaged book included), labelled Start the book over. Summary empty text: `No book yet. Nothing is read, and nothing is spent, before you adopt this chat.`
3. **One line under the header button.** `parts.NextOutcome` shows the Next outlet's outcome when there is one; otherwise, when the step is Adopt, `adoptBlock`; otherwise it is hidden.
4. **Failure outcomes clear when the state moves.** Failure outcomes only (a thrown error in `perform`, `AdoptFix`, `AdoptFixNext`); success outcomes unchanged. The panel stores, beside a failure outcome on the Next or Controls outlet, the signature `[phase, reader, adoptBlock, stop?.reason ?? null, pulled?.at ?? null]` taken at the redraw that first shows it; at each later redraw an outcome whose signature differs is removed before it is written. Pending (`Working...`) outcomes are untouched.
5. **Settings tab.** `Settings.Tabs` becomes `Summary, Book, Timeline, Rulings, Findings, Progress, Settings`. The Settings tab is built once at construction with today's Key and settings content and the same element ids, as a plain section (no details element). The NoBook rule that opened the details is removed. A setup-field refusal on Adopt (`AdoptFixNext`) or Start the book over (`AdoptFix`) switches to the Settings tab, focuses the first field marked with a problem, and both texts read `A field on the Settings tab needs attention.`
6. **Progress shows progress**: controls (Pull the chat again, Pause, Resume, Export, Start the book over per point 2), Last pull, Readings, Last calls. `Last pull` shows in every tab that has seen a pull result; a watcher with none says `This tab has not pulled the chat; another tab is reading it.`

### Tests that try to break it

From the design's list, each as a test:
- Adopt with no pull yet: header button disabled with the reason; the pull lands; the button enables with no leftover text.
- A refusal shown, then the state changes (pull lands, another tab takes over, the day's budget turns): the text is gone at the next redraw. A success outcome (Exported) survives a pull.
- `blocked` agrees with `adopt()` for every hold (blank, partial, mismatch replacing and not, suspect, watching, unsettled, owed and repayable, owed and not repayable): each case adopts or throws exactly as `blocked` said, and `blocked` changes nothing in the keeper or storage (compare before and after).
- The Settings tab carries the key field and every setting field with their existing ids; the existing key and settings tests pass against it; a bad field on Adopt switches to Settings and focuses that field.
- Start the book over: hidden in NoBook and Loading, shown with a book and with a damaged book.
- A watcher's Progress tab: Last pull line or the watcher sentence.
- The whole walk: adopt from the header only.
- Phone width: seven tabs wrap without horizontal scroll (the panel test's narrow-width check, extended).
- Existing panel tests that press `scribe-adopt` with no book (near `tests/scribe-panel.test.mjs` lines 732, 1112, 1646, 1932) press the header button instead; Save key and Save settings expectations move to the Settings tab.

### Commands (each file alone, under the memory limit from the README)

```
NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 120 node --test --test-timeout=20000 tests/scribe-panel.test.mjs
... scribe-keeper, scribe-whole, scribe-boot, scribe-live, scribe-pack
node scribe/pack.mjs
```

### Done when

All six files pass, `scribe/scribe.user.js` is rebuilt, the verification record has the counts.
