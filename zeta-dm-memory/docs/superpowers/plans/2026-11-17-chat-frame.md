# DM Memory chat frame Implementation Plan

> **For agentic workers:** Execute under the workspace loop in `/var/www/demo_stuff/CLAUDE.md` (implementer subagent, adversarial reviewer, operator commits). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DM Memory counts turns, injects notes, honours force-next and pastes again now that Zeta's chat box lives in the cross-origin `frame.pingpong.ai` iframe.

**Architecture:** One userscript file, two roles chosen by `location.origin`. The top role (`https://zeta-ai.io`) keeps all state and the widget and talks to the frame role (`https://frame.pingpong.ai`) through tagged `postMessage` messages. The frame role only hooks the send and writes the chat box.

**Tech Stack:** Plain JavaScript userscript (Tampermonkey), Node 24 `node:test` with the VM harness in `tests/support/UserscriptHarness.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-17-chat-frame-design.md`

## Global Constraints

- Only `zeta-dm-memory.user.js`, the userscript tests and harness, `README.md` and `docs/verification/userscript-verification.md` change. Nothing under `scribe/`, no Worker, schema or cloud-sync logic change.
- Header: add `// @match        https://frame.pingpong.ai/*`; `// @version      1.4`. Grants and `@connect` unchanged. No `@noframes`.
- Origins exactly `https://zeta-ai.io` and `https://frame.pingpong.ai`; chat frame `src` prefix `https://frame.pingpong.ai/`.
- Message tag `zetaDm: 1`; kinds `ready`, `arm`, `sent`, `paste`, `pasted`; arm modes `off`, `count`, `inject`.
- Chat box selector `textarea[name="message"]`; Send selector `button[aria-label="Send"]`; resend delay 25 ms.
- Widget title `DM Memory v1.4`, no emoji. No other widget change.
- New code: tag-only docblocks (`@param`, `@return`), no prose comments, braces always, no single-letter variables, constants in one frozen object (like `cloudSync.Status`), no private function with one caller, no swallowed errors. Do not reformat untouched v1.3 code.
- No dependency installs. No TDD: code first, then tests that try to break it.

## Review Focus

1. A frame whose `ready` is lost because it loaded before the top script: the frame repeats `ready` every 1000 ms until it is armed, and the top only messages frames that have spoken (fix round 1, F1/F4).
2. A cloud update or Import that changes the notes while an `inject` arm is out: the loop re-arms within 800 ms with the new text.
3. An SPA room change while the same frame window stays: the arm follows the new room's state.
4. Enter during IME composition, Shift+Enter, Enter in the three text inputs, and Enter on a blank box: no count, no write.
5. Notes with CRLF, leading or trailing asterisks and blank lines: the frame receives exactly `formatNotesAsNarrator` output and writes it unchanged.

---

### Task 1: Split the script across the chat frame

**Files:**
- Modify: `zeta-dm-memory.user.js` (header lines 1-14; IIFE start lines 16-20; `findChatInput` 1111-1117; widget title 1143; notes input handler 1173-1184; Paste handler 1226-1241; `syncUI` 1246-1275; keydown and pointerdown listeners 1304-1345; loop 1349-1355)
- Modify: `tests/support/UserscriptHarness.mjs`
- Modify: `tests/userscript.test.mjs` (remove `original_injection_sections_are_preserved`)
- Create: `tests/userscript-frame.test.mjs`
- Modify: `README.md` (install section), `docs/verification/userscript-verification.md`

**Interfaces (inside the IIFE, all function declarations so both roles can call them):**
- `Bridge`: frozen constants object holding the origins, frame prefix, tag, kinds, modes and `ResendMs: 25`.
- `findChatInput(): ?HTMLTextAreaElement`: `document.querySelector('textarea[name="message"]')` only.
- `appendNotes(box: HTMLTextAreaElement, text: string): boolean`: returns false when `box.value` already includes `text`. Otherwise it writes, through `setReactInputValue`, `text` alone when `box.value.trimEnd()` is empty, else `box.value.trimEnd() + '\n\n' + text`, and returns true. Frame role inject and frame role paste use it. The v1.3 `checkAndInject` and top Paste code stay as they are.
- `hookSends(deliver: (box: HTMLTextAreaElement) => boolean): void`: replaces the two v1.3 window listeners and is called once per role.
  - Keydown, capture: acts on Enter with no Shift and not composing, when `document.activeElement === findChatInput()` and the box value is non-blank. When `deliver` returns true it calls `preventDefault`, then `stopImmediatePropagation`, and re-dispatches Enter on the box after `ResendMs` with the existing `bypassNextEnter` guard and the same event fields as v1.3.
  - Pointerdown, capture: acts when `event.target.closest('button[aria-label="Send"]')` matches, the button is outside `#zeta-dm-widget` and the box is non-blank. It calls `deliver` and holds nothing.
  - The top role passes `checkAndInject`.
- `chatFrame(): ?Window`: top role. Returns the `contentWindow` of the first `iframe` whose `src` starts with the prefix and whose `getBoundingClientRect()` width and height are both above 0.
- `pushArm(force: boolean): void`: top role. Computes the arm for `loadRoomState()` of the current path:
  - `off` when `formatNotesAsNarrator(notes)` is empty;
  - `inject` with `text` when `forceNext` is set or `turnCount + 1 >= interval`;
  - otherwise `count`.

  It posts `{ zetaDm: 1, kind: 'arm', mode, text? }` to `chatFrame()` with target origin `https://frame.pingpong.ai` when `force` is true, the frame window differs from the last one armed, or the serialized arm differs from the last one posted. Callers: the `message` listener (`ready` and `sent`, both with force), the end of `syncUI`, the notes `input` handler after `editNotes`, and the 800 ms loop.

**Role selection.** Place `Bridge` and the role check immediately after the existing `let lastPath` / `let bypassNextEnter` declarations. The frame role reads `bypassNextEnter` through `hookSends`, and a `let` that is never reached stays uninitialised and throws. No v1.3 code that follows, including `cloudSync`, may run in the frame role.
- Origin `https://frame.pingpong.ai`:
  - Return at once when `window.parent === window`.
  - Otherwise keep `arm = null` and register `message` and `hookSends(deliverFromFrame)`.
  - Accept messages only when `event.origin === 'https://zeta-ai.io'`, `event.source === window.parent`, the data is tagged and the fields are valid. An `arm` needs a valid mode, and a non-empty string `text` exactly when the mode is `inject`. A `paste` needs a non-empty string `text`.
  - `paste`: when `findChatInput()` exists and `appendNotes` returns true, post `pasted`.
  - Delivery from the frame:
    - `off` or `null`: report nothing and return false.
    - `count`: post `sent` with `injected: false` and return false.
    - `inject`: run `appendNotes`, post `sent` with `injected: true`, set the local arm to `{ mode: 'count' }`, and return the `appendNotes` result.
  - Post `ready` once, with target origin `https://zeta-ai.io`. Then return. No GM call, no storage, no widget, no menu.
- Any origin other than the two: return at once.
- Origin `https://zeta-ai.io`: v1.3 as before, plus the following.
  - A `message` listener registered at start, not inside `buildWidget`. It accepts only messages whose `event.origin === 'https://frame.pingpong.ai'` and `event.source === chatFrame()`, tagged and valid.
    - `ready`: `pushArm(true)`.
    - `sent` with a boolean `injected`: load the current room's state and ignore the message when its notes format to nothing. If `injected` is true, set `turnCount` to 0 and clear `forceNext`; otherwise add 1 to `turnCount`. Then save, call `syncUI()` and `pushArm(true)`.
    - `pasted`: set `turnCount` to 0, clear `forceNext`, save, call `syncUI()`.
  - Paste handler: when `findChatInput()` exists, the v1.3 path is unchanged. Otherwise, when the notes format to something and `chatFrame()` exists, post `{ zetaDm: 1, kind: 'paste', text }`.

- [ ] **Step 1: Implement the script changes above.** Bump the header and the title.

- [ ] **Step 2: Extend the harness.**
  - Add the top window's `location.origin` (default `https://zeta-ai.io`) and set `window.parent = window` there.
  - Give the existing send button `aria-label="Send"` while keeping `type="submit"`, so v1.2 parity still holds.
  - Add `matches` cases for `button[aria-label="Send"]` and `iframe`.
  - Add `postMessage(data, targetOrigin)` on windows. It delivers a `message` event `{ data: structuredClone(data), origin: senderOrigin, source: senderWindow }` as a 0 ms timer, and only when `targetOrigin` equals the receiver's origin. Every post is logged to `harness.messages` as `{ from, to, targetOrigin, data, delivered }`.
  - Add the option `frame: true`. The top document then gets no chat box and no send button, but an `iframe` with `src` `https://frame.pingpong.ai/v1/index.html#run=r&host=h`, a 480x927 rect and a `contentWindow`.
  - The frame context runs the same source on one shared clock, with origin `https://frame.pingpong.ai`, `parent` set to the top window, and its own `localStorage` and `GM_*` stand-ins. Every call to them is logged to `harness.frameCalls`.
  - The frame document holds:
    - the chat box `textarea[name="message"]` (id `chat`);
    - buttons with aria-labels `Suggested replies` (id `suggest`) and `Insert asterisk` (id `asterisk`), each holding an svg child;
    - the Send button (id `send`, aria-label `Send`, svg child);
    - three `input[type="text"]` (ids `extra1` to `extra3`).
  - In frame mode, `typeChat`, `enter`, `pointerSend` and `elements.chat` use the frame document. Add:
    - `frameElements`;
    - `pointerOn(id)`;
    - `enterOn(id, fields)`, for Shift and composing;
    - `postAs({ origin, source }, target, data)` for forged messages;
    - `reloadFrame()`, which runs a fresh frame context and swaps the iframe's `contentWindow`;
    - `setFrameRect(width, height)`.
  - Existing tests keep passing unchanged except for the removed preservation test.

- [ ] **Step 3: Write `tests/userscript-frame.test.mjs`.** Each test sets room state with the existing `state()` and `storage()` helpers, then calls `advance(800)` and `advance(0)` to deliver messages. In these tests, "notes" is `'First'` (formatted `'*First*'`) unless stated.
  - `frame_role_touches_nothing_but_the_chat`: `frameCalls` is empty, the frame has no `zeta-dm-widget`, and exactly one `ready` was posted from the frame, with target origin `https://zeta-ai.io`.
  - `ready_is_answered_and_lost_ready_is_recovered`: the top answers `ready` with an `arm` of mode `count` and no `text` property, target origin `https://frame.pingpong.ai`. Also, with the harness option `dropFirstReady: true` (the first `ready` is logged but not delivered), an arm still arrives after `advance(800)`.
  - `enter_and_send_count_through_the_frame`: with `turnCount: 0` and `interval: 6`, Enter on `'Hello'` returns true and the room then has `turnCount` 1; `pointerSend` makes it 2; the counter text reads `2 / 6`.
  - `due_injection_by_enter_holds_and_resends_once`: with `turnCount: 5`, Enter on `'Hello'` returns false and the chat reads `'Hello\n\n*First*'`. After 24 ms there is no resent keydown; at 25 ms exactly one. Then `turnCount` is 0, `forceNext` is false, and the next arm is `count`.
  - `due_injection_by_send_button`: `pointerSend` with `turnCount: 5` writes `'Hello\n\n*First*'` without a held event and resets the counter.
  - `other_buttons_and_fields_never_count`: pointerdown on `suggest` and `asterisk` with text in the box; Enter with focus on `extra1`; Enter on a blank box; Enter with `shiftKey`; Enter with `isComposing`. Each leaves no `sent` in `messages` and the stored state unchanged.
  - `empty_notes_never_count_or_cross`: with notes `''` the arm is `off`, and Enter leaves `turnCount` at 0 with no `sent` posted.
  - `two_quick_sends_inject_once`: with `turnCount: 5`, two Enters with no time advanced between them inject only into the first. After delivery `turnCount` is 1.
  - `interval_one_injects_every_send`: with `interval: 1`, three sends in a row each carry `*First*`.
  - `force_next_injects_and_clears`: tick `zeta-dm-force` at `turnCount: 0`. The next send carries `*First*` and `forceNext` becomes false.
  - `paste_through_the_frame`:
    - an empty box becomes exactly `'*First*'` and the counter resets;
    - `'Hi  '` becomes `'Hi\n\n*First*'`;
    - a box already holding `*First*` is unchanged, no `pasted` is posted and the counter is unchanged.
  - `paste_needs_notes_and_a_visible_frame`: empty notes, a missing iframe, or `setFrameRect(0, 0)` each post nothing and change nothing.
  - `notes_cross_only_when_due`: across a session of `count` sends, no logged message contains `First`.
  - `forged_messages_are_ignored`: none of these changes the room state or the frame's chat value:
    - to the top: a wrong origin; the right origin from a non-frame source; untagged data; an unknown kind; `injected: 'yes'`;
    - to the frame: an arm from a wrong origin; an arm from a wrong source; mode `'boom'`; `inject` without `text`; `text: 5`; a paste from a wrong origin.
  - `reloaded_frame_is_rearmed_and_old_one_dropped`: after `reloadFrame()` the new window receives an arm, and messages from the old window are ignored.
  - `room_change_rearms`: navigate to `roomB`, whose stored state is due. The next arm is `inject` with roomB's formatted notes.
  - `notes_edit_reaches_the_frame_before_the_send`: with `turnCount: 5`, `editNotes('Second')` and `advance(0)`. The send then carries `'*Second*'`.
  - `cloud_change_rearms_within_the_loop`: the top's notes change through a cloud read (use the existing `completeRequest` pattern) while armed `inject`. After `advance(800)` the arm text is the new formatted notes.
  - `formatting_crosses_unchanged`: notes `' \t*First* \r\n\r\n **Second** \n'` arrive as `'*First*\n*Second*'`.
  - `top_hooks_only_touch_the_chat_box`: top layout, not frame mode. Add a top-level `input[type="text"]` with text, focus it and press Enter: no count. Remove the chat box and press Paste: that input is untouched.
  - `header_and_title`: the source contains `// @match        https://frame.pingpong.ai/*` and `// @version      1.4`, and the widget title text is `DM Memory v1.4`.

- [ ] **Step 4: Run the checks.**

Run: `node --check zeta-dm-memory.user.js && node --test tests/userscript.test.mjs tests/userscript-frame.test.mjs`
Expected: all tests pass, 0 failures.

- [ ] **Step 5: Update the docs.**
  - README "Install or update the userscript": add a step saying the script now also matches `https://frame.pingpong.ai/*` because Zeta's chat box lives in that frame, and Tampermonkey runs it there.
  - `userscript-verification.md`: add the automated results with date and counts, plus the spec's seven owner checks as unchecked boxes.

- [ ] **Step 6: Hand off.** Do not commit. Report the files changed and the test output to the orchestrator.
