# Zeta Scribe: one Adopt, a Settings tab, no stale refusals

Date: 2026-11-18
Status: direction approved by the operator on 2026-11-18 ("Yes, please."); the calls marked "assistant's call" are open to their ruling.

## Why

The operator's first real adoption, room `/en/rooms/45359def-...` (13 messages), 2026-11-18:

- The operator pressed **Adopt this chat** before the first pull of the chat had landed. `ScribeKeeper.adopt` refused through `readable()` with `Nothing has been pulled from the chat yet`, and nothing was read or spent.
- The pull landed a moment later; the headline became `No book for this chat yet: 13 messages.` The refusal stayed on screen under the button, because a panel outcome (`ScribePanel.say`, `panel.outcomes`) lives until the next outcome on the same outlet. The panel read as "adopting, then stopped".
- **Adopt this chat** shows in three places: the header's next-step button (`parts.Next`), the Progress tab's controls (`parts.Adopt`), and the Summary tab's empty text.
- With no book, `ScribePanel.Tabs.Progress` forces the `Key and settings` details open at the top (`ScribePanel.js` near line 3404), and Readings and Last calls are empty, so the Progress tab reads as a settings page.

## Goal

Before adoption the panel says plainly whether Adopt can run, and why not; one press starts it; the Progress tab shows progress only.

## Non-goals

- No change to the keeper's rules (when a pull runs, what `readable()` refuses), the book, the reading, the reminder, the pedant, the store or the frame bridge.
- No new setting, no new grant, no new storage key.

## Anti-goals

- Adopt is never enabled while the keeper would refuse it for a reason the operator cannot act on (no pull yet, a pull in flight, the chat held).
- A refusal or failure text is never shown after the condition it reported has gone.

## Approaches

1. **Chosen.** Gate the single header button on the keeper's own readiness check, and clear outcomes the moment the keeper's state moves on. Uses the check `adopt()` already runs, so the button and the refusal cannot disagree.
2. Keep three Adopt entry points and only clear the stale text. Rejected: the operator found the three entry points confusing in themselves.
3. Retry the adopt automatically once the pull lands. Rejected: a press that silently waits and later starts spending is worse than a disabled button with a reason.

## Design

1. **Readiness in the keeper view.** A new pure function `ScribeKeeper.blocked(keeper): string|null` runs the checks `adopt()` runs, in the same order, with no write to the keeper or to storage, and returns the sentence the first failing check would throw, or `null`. `ScribeKeeper.view()` exposes it as `adoptBlock`. The checks:
   - `guard`'s five checks as they are (closed, not the reader, unloaded, reading, pulling); they are already pure.
   - Unless a mismatch is being replaced (`keeper.mismatch !== null && !keeper.partial`, the condition `adopt()` uses): `held(keeper)`, then `keeper.compared` with `keeper.problem ?? Messages.Unsettled`. Both are pure.
   - Debt: `keeper.owed.size > 0` returns `keeper.owing`. `blocked` does not call `repay`. A debt that `repay` would clear keeps the button disabled until the keeper's next step repays it; the builder makes sure `step` calls `repay` when `owed` is not empty, so the block clears without a press (assistant's call).
   - The reader's claim: `still(keeper)` read inside a try; `false` returns `Messages.Watching`, a throw returns `ScribeKeeper.words(error)`. `lose()` is not called from the view.
   - The settings form is not part of `blocked`: `settle` runs on the panel's form values, which the keeper never sees until a press. Field problems stay with the panel (point 4).
2. **One Adopt button: the header's.** `PanelView.next()` keeps returning `Step.Adopt` in the NoBook phase. `parts.Next` is disabled while `adoptBlock !== null` (in addition to the existing `ruled` rule). The Progress tab's `parts.Adopt` button is hidden in the NoBook and Loading phases and shown in every other phase, including a damaged book, labelled **Start the book over** as today. The Summary tab's empty text drops the instruction to press anything: `No book yet. Nothing is read, and nothing is spent, before you adopt this chat.`
3. **One line under the header button.** `parts.NextOutcome` stays one element. It shows the Next outlet's outcome when there is one; otherwise, when the step is Adopt, it shows `adoptBlock`; otherwise it is hidden. `adoptBlock` is never shown when the step is Resume or there is no step (assistant's call).
4. **Refusals clear when the state moves.** Only failure outcomes clear this way: text from a thrown error in `perform`, `AdoptFix` and `AdoptFixNext`. Success outcomes (`Exported ...`, pause and resume results) keep today's behaviour. When a failure outcome is said on the Next or Controls outlet, the panel stores beside it a readiness signature: `[phase, reader, adoptBlock, stop?.reason ?? null, pulled?.at ?? null]`, taken from the view at the redraw that first shows the outcome. At each later redraw an outcome whose signature differs from the current one is removed before it is written. `glance()` is not used: it changes with spending and the newest message, which would wipe a refusal within a minute for no reason (assistant's call).
5. **A Settings tab.** `ScribePanel.Settings.Tabs` becomes `Summary, Book, Timeline, Rulings, Findings, Progress, Settings`. The Settings tab is built once at construction like the others, holding today's `Key and settings` content with the same element ids, as a plain section (no details element, nothing forced open). The NoBook rule that opened the details is removed. When Adopt or Start the book over is refused for a setup field (`AdoptFixNext` on the header, `AdoptFix` on Progress), the panel switches to the Settings tab, focuses the first field marked with a problem, and both texts read `A field on the Settings tab needs attention.`
6. **Progress shows progress.** The Progress tab holds, in order: the controls (Pull the chat again, Pause, Resume, Export, Start the book over per point 2), Last pull, Readings, Last calls. `Last pull` shows in every tab that has seen a pull result, reader or watcher; a watcher with none says `This tab has not pulled the chat; another tab is reading it.`

## Calls made by the assistant

- Debt that would repay blocks the button until the keeper's next step repays it, rather than the view repaying.
- One line under the header button, with the action's own outcome taking precedence over `adoptBlock`.
- Only failure text clears when the state moves; the signature is the five readiness fields, not `glance()`.
- Existing panel tests that press `scribe-adopt` with no book (`tests/scribe-panel.test.mjs` near lines 732, 1112, 1646, 1932) are rewritten to press the header button; expectations for Save key and Save settings move from the Progress tab to the Settings tab. The whole walk changes the same way.

## Tests that try to break it

- Adopt pressed with no pull yet: impossible (button disabled), and the header says why; then the pull lands and the button enables with no leftover text.
- A refusal shown, then the state changes (pull lands, another tab takes over, budget day turns): the text is gone at the next redraw.
- `adoptBlock` agrees with `adopt()` for every hold the keeper has (blank, partial, mismatch replacing and not, suspect, watching, unsettled), each case adopting or throwing exactly as the view said.
- The Settings tab carries the key field and every setting field with their existing ids, and the existing key and settings tests pass against it.
- The whole walk: adopt from the header only; no `scribe-adopt` press needed before a book exists.
- Phone width: seven tabs wrap without horizontal scroll.

## Left to the builder

The exact wording of the watcher's Last-pull line; where `adoptBlock` is computed inside the keeper; the tab order beyond Settings being last.
