# Zeta DM Memory: chat inside the Pingpong frame

Date: 2026-11-17
Status: Approved by the operator on 2026-11-17 ("Just go") after the builder check and the resend check on the real frame.

## Why

The DM Memory userscript (`zeta-dm-memory.user.js`, v1.3) stopped counting turns, stopped injecting notes, and its **+ Paste** button does nothing. Evidence gathered on the live site on 2026-11-17, browser with only this script installed:

- Room page `https://zeta-ai.io/en/rooms/<uuid>`: the only textarea in the top document is the widget's own `#zeta-dm-notes`. No `textarea[name="message"]`, no contenteditable.
- Clicking into the chat box focuses an `IFRAME`: `https://frame.pingpong.ai/v1/index.html`, 480x927, cross-origin (`contentDocument` is null). Its URL hash carries only the keys `run` and `host`; the room id is not in it. `location.ancestorOrigins` inside it is `["https://zeta-ai.io"]`.
- Inside the frame: the chat box is `textarea[name="message"]` (placeholder "Enter text"). Three other `input[type="text"]` fields sit near the bottom. Buttons within 180 px of the bottom, all with an svg: aria-label "Suggested replies", "Insert asterisk", "Send".
- Room state in localStorage is intact (notes present, storage writable).

The script matches only `https://zeta-ai.io/*`, so it never runs where the user types. Its Enter hook sees an `IFRAME` as the active element, and `findChatInput()` finds nothing.

## Goal

Turn counting, automatic injection at the interval, **Inject on next message** and **+ Paste** work again with the chat inside the frame, with the same visible behavior as v1.3.

## Non-goals

- The Zeta Scribe userscript is not touched (operator ruling).
- No change to the cloud notes sync, the Worker, the schema, the notes format or the localStorage layout.
- No widget restyle or cleanup beyond the title line below.
- No new grants, no new `@connect`, no new storage.

## Anti-goals

- Notes never land in any field other than the chat box.
- A click on "Suggested replies" or "Insert asterisk" never counts as a send.
- Notes text is handed to the frame only when it is about to go into the chat (a due injection or a Paste).

## Approaches

- **A. Split across the frame (chosen by the operator).** The same file runs in both documents. The top page keeps all state and the widget; the frame part hooks the send and talks to the top page through `postMessage`.
- **B. Tampermonkey shared storage as the channel.** Rejected: the frame does not know its room, two open rooms would overwrite one shared "current room" value, and the counter would have to leave localStorage.
- **C. Widget inside the frame.** Rejected: notes and cloud sync are keyed by the room path the frame cannot see, and the widget would cover the 480 px chat column.

## Design

1. **Header.** Add `// @match https://frame.pingpong.ai/*`. Version `1.4`. No `@noframes`, so Tampermonkey runs the script in the frame. Grants and `@connect` unchanged.
2. **Two roles, chosen by `location.origin`.**
   - `https://zeta-ai.io`: top role. Everything v1.3 does, plus the bridge below.
   - `https://frame.pingpong.ai`: frame role. Only the send hooks and the bridge. No widget, no cloud sync, no menu commands, no localStorage or GM storage access. It does nothing when `window.parent === window`, or when `location.ancestorOrigins` exists and its first entry is not `https://zeta-ai.io`.
   - Any other origin: do nothing.
3. **Chat box and Send button.** In both roles the chat box is `textarea[name="message"]` only, and the mouse hook reacts only to `button[aria-label="Send"]`. The v1.3 fallbacks (`textarea:not(#zeta-dm-notes)`, `input[type="text"]`, any svg button near the bottom) are dropped, because inside the frame they would hit the three text inputs and the other two buttons. In the top role the existing hooks stay and act only when the chat box is in the top document, which covers the old layout if the site serves it again.
4. **Bridge messages.** Every message is an object tagged `zetaDm: 1` with a `kind`.

   | kind | direction | fields |
   |---|---|---|
   | `ready` | frame to top | none |
   | `arm` | top to frame | `mode`: `off`, `count` or `inject`; `text`: the formatted notes when `mode` is `inject`, otherwise absent |
   | `sent` | frame to top | `injected`: boolean |
   | `paste` | top to frame | `text`: the formatted notes |
   | `pasted` | frame to top | none |

   - The chat frame is the first iframe in the top document whose `src` starts with `https://frame.pingpong.ai/` and whose box is larger than zero in both dimensions. On 2026-11-17 the room page held exactly one such iframe. Arms and pastes go only to the chat frame.
   - The top role posts with target origin `https://frame.pingpong.ai` and accepts only messages whose origin is `https://frame.pingpong.ai` and whose source is the chat frame's `contentWindow`.
   - The frame role posts to `window.parent` with target origin `https://zeta-ai.io` and accepts only messages whose origin is `https://zeta-ai.io` and whose source is `window.parent`.
   - Anything untagged, of an unknown kind, or with fields of the wrong type is ignored.
   - **Handshake.**
     - The frame role starts only when its parent is the top page: `location.ancestorOrigins[0]` is `https://zeta-ai.io`. Where `ancestorOrigins` does not exist, it starts when `window.parent !== window`.
     - It posts `ready` at start and again every 1000 ms until it accepts its first valid `arm`, then it stops.
     - The top remembers, in a `WeakSet`, every chat frame window from which it has accepted a valid `ready`, `sent` or `pasted`. It posts arms and pastes only while `chatFrame()` is in that set. A frame that has not spoken, such as the iframe's initial `about:blank` document, gets nothing. When the chat frame switches to another window in the set, the next push goes to it even if the arm is unchanged.
     - A frame that reloads in place keeps its window. Its repeated `ready` re-arms it once it is visible again.
5. **Arming (top role).** The arm for the current room follows the v1.3 rule, read from the room's normalised local state (non-string notes count as empty, and an unsaved in-memory draft is used). It is `off` when `formatNotesAsNarrator(notes)` is empty, because v1.3 does not count turns without notes. It is `inject` when `forceNext` is set or `turnCount + 1 >= interval`. Otherwise it is `count`. The top pushes the arm to the chat frame:
   - in reply to `ready`;
   - after every `sent`, unconditionally, because the frame has changed its own arm (step 6). With an interval of 1 the new arm equals the last one pushed, and skipping it would leave the frame on `count` for good;
   - whenever the computed arm, or the chat frame window, differs from the last one pushed. This covers notes edits, interval and force changes, counter changes, room changes and cloud updates. A send right after a notes edit must carry the new text, so the 800 ms loop alone is not enough. Room changes are checked every 100 ms. Only the first room activation waits for the widget, as in v1.3; later checks do not need it.
6. **Sending (frame role).** It triggers on Enter in the chat box (no Shift, not composing), or on pointerdown on Send, when the box holds non-blank text.
   - No arm received yet, or `off`: do nothing and report nothing.
   - `count`: report `sent` with `injected: false`.
   - `inject`: if the box does not already contain the text, set it to its current value with trailing whitespace trimmed, then `\n\n`, then the text, through the v1.3 React setter. For Enter, hold the keypress and dispatch Enter again after 25 ms, as v1.3 does. The owner checked this in a throwaway room on 2026-11-17: text set through the React setter, then a script-made Enter on the box 25 ms later, was sent by the frame's chat box. Report `sent` with `injected: true`, including when the text was already present (v1.3 resets the counter in that case too). Then drop the local arm to `count` until the next `arm` arrives, so two quick sends do not inject twice.
7. **Counting (top role), on `sent`.** Use the current room's stored state. Ignore the message when the normalised notes of step 5 format to nothing. If `injected` is true, set `turnCount` to 0 and clear `forceNext`; otherwise add 1 to `turnCount`. Save, refresh the widget, and re-arm.
8. **Paste.**
   - If the chat box is in the top document, use the v1.3 path unchanged.
   - Otherwise, when the notes format to something, post `paste` to the chat frame. The frame writes the box as v1.3 Paste does: an empty or blank box gets the notes alone; otherwise the current value with trailing whitespace trimmed, then `\n\n`, then the notes. It does nothing if the box already contains the notes, and answers `pasted` only when it wrote. On `pasted` the top resets `turnCount` and `forceNext` as v1.3 does.
   - With no frame or empty notes, nothing happens, as in v1.3.
9. **Widget title.** It becomes `DM Memory v1.4`. The dice emoji is removed under the workspace no-emoji rule. No other widget change.

## Calls made by the assistant, for the operator to check

- Chat box is `textarea[name="message"]` only, and the mouse hook reacts to `button[aria-label="Send"]` only, in both roles (step 3).
- The top page's own hooks stay for the old layout (step 3).
- Notes text crosses to the frame only in an `inject` arm or a `paste` (steps 4 and 5).
- After acting on `inject` the frame drops to `count` locally, and the top always re-arms after `sent` (steps 5 and 6).
- The chat frame is the first visible Pingpong iframe; arms and pastes go only to it (step 4).
- Paste into an empty box puts in the notes alone, as v1.3 does (step 8).
- Widget title `DM Memory v1.4` without the emoji (step 9).
- The byte-for-byte preservation test is replaced by behavior tests (Tests).

## Accepted limits

- The Send button is found by its English label. In another site language, mouse sends are not counted; Enter still is.
- A notes edit and a send inside one message round trip (about a millisecond) may use the previous arm.
- A send within 100 ms of a room change may carry the previous room's arm.
- If the page ever switches the chat back to an earlier Pingpong frame (never observed; the room page holds one), a send before the next 800 ms tick may use that frame's previous arm.
- For up to 1 s after a hidden chat frame reloads and is shown again, a send is not counted.
- As in v1.3, a turn counts at the keypress or click even if the site then refuses the send.

## Tests

- The existing userscript tests for the top role stay green, with one exception: `original_injection_sections_are_preserved` pins the v1.2 injection sections byte for byte, and this change must alter them, so it is replaced by behavior tests. Harness fixtures adapt to the new selectors.
- A two-document harness (top and frame) relays `postMessage` with origins and sources. Tests try to break:
  - origin and source checks, in both directions;
  - Suggested replies and Insert asterisk clicks;
  - the three text inputs;
  - empty notes;
  - a due injection through Enter and through Send;
  - two quick sends;
  - force-next;
  - Paste through the frame, including text already present;
  - a frame reload and a room change re-arming;
  - a notes edit just before a send;
  - malformed messages.

## Owner checks on the real page

1. Reinstall the script. Open a room. The widget shows `DM Memory v1.4` and the console shows no errors from the script.
2. Send with Enter. The counter goes up by one.
3. Send with the Send button. The counter goes up by one.
4. Click Suggested replies and Insert asterisk with text in the box. The counter does not move.
5. Send until the counter is due. The notes are appended under the message, which is sent once, and the counter resets.
6. Tick **Inject on next message** and send. The notes go with that message.
7. Press **+ Paste**. The notes appear in the chat box and the counter resets.

## Delivery

- Updated `zeta-dm-memory.user.js`.
- README install section: mention the added match and that the script runs inside the chat frame.
- `docs/verification/userscript-verification.md` gains the frame results and the owner checks above.
