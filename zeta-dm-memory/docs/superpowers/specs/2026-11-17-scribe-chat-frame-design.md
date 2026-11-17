# Zeta Scribe: the chat inside the Pingpong frame

Date: 2026-11-17
Status: direction approved by the operator on 2026-11-17 ("Right, lets fix Scribe then. Properly."); the calls listed under "Calls made by the assistant" are open to their ruling.

## Why

On 2026-11-17 Zeta moved the chat into a cross-origin iframe. Evidence from the live site, recorded in `2026-11-17-chat-frame-design.md` (the DM Memory change) and from the scribe's first real run the same day:

- Room page `https://zeta-ai.io/en/rooms/<uuid>`: the top document holds no `textarea[name="message"]`.
- The chat box is inside `https://frame.pingpong.ai/v1/index.html` (cross-origin; its hash carries only `run` and `host`; `location.ancestorOrigins` inside it is `["https://zeta-ai.io"]`). There the chat box is `textarea[name="message"]`; three other `input[type="text"]` fields sit near the bottom; the buttons near the bottom are labelled "Suggested replies", "Insert asterisk" and "Send".
- Text set through the React setter, then a script-made Enter 25 ms later, is sent by the frame's chat box (owner's check).
- The scribe, running on the top page, still pulled the whole chat with the page's login (`Last pull: 864 messages, ended NoCursor`), saved the key and made model calls.

The scribe matches only `https://zeta-ai.io/*` and is barred from frames, so its send hook never sees the chat box: no reminder and no suggestion can go out. Worse, its send hook falls back to the first textarea and the first text input of the top document, which are now other tools' fields (DM Memory's notes box).

## Goal

The reminder and a chosen suggestion go out with the player's message again, with the chat inside the frame, under the rules the send hook already has (the player's words unchanged, once, taken back when the player edits or the send does not happen).

## Non-goals

- No change to the book, the keeper, the store, the pedant, the reminder's content, the suggestions helper, the panel, or how the chat history is pulled.
- No new grant, no new `@connect`, no new storage.
- The DM Memory script is not touched.

## Anti-goals

- The scribe never writes into any field other than the chat box.
- A click on "Suggested replies" or "Insert asterisk" is never taken for a send.
- The OpenRouter key, the site's token, the book and the settings never enter the frame: the part that runs there makes no request and reads one stored value only, the bridge token below.
- The top page never posts to a window that is not a Pingpong frame of its own document, and never to one that has not spoken first.
- No script in the top page or in the frame can put a line into the player's message through the bridge, and none can make the scribe believe a line went out.

## Design

1. **Header.** Add `// @match https://frame.pingpong.ai/*` and remove `// @noframes`, so Tampermonkey runs the script inside the chat frame. Everything else in the header stays.
2. **Three cases, chosen at start by where the script runs.**
   - Origin `https://zeta-ai.io` and the window is the top window: the top role. Everything the scribe does today, plus the bridge below.
   - Origin `https://frame.pingpong.ai`, and the parent is the top page (`location.ancestorOrigins[0]` is `https://zeta-ai.io`; where `ancestorOrigins` does not exist, `window.parent !== window`): the frame role. Only the send hook and the bridge. No storage, no request, no panel, no page mark.
   - Anything else (a Zeta sub-frame, a Pingpong page opened by itself or under another site): nothing.
3. **Chat box and Send button, in both roles.** The chat box is `textarea[name="message"]` and nothing else. The mouse path reacts only to `button[aria-label="Send"]`. The fallbacks (first textarea, first text input, any icon button within 180 px of the bottom) are removed. The top role keeps its send hook for a chat box in the top document, which covers the old layout if the site serves it again.
4. **What is appended is decided in one place.** A pure function builds the outgoing text from the player's text and the lines on offer: a blank text gets nothing; otherwise each line is added as a new line beginning `@: `; while the whole is over 4,500 bytes the reminder is dropped first, then the suggestion. The top role's own hook and the frame role both use it. The live part offers its lines (`ready` reminder only while it is still current and the book trusted; `suggestion` only when chosen) and is told what went.
5. **Bridge messages.** Every message is an object tagged `zetaScribe: 1` with a `kind`.

   | kind | direction | fields |
   |---|---|---|
   | `ready` | frame to top | none |
   | `arm` | top to frame | `seq`: a whole number that names the arm; `token`: the bridge token; `ready`: string or null; `suggestion`: string or null |
   | `sent` | frame to top | `seq`: the arm it was sent under; `ready`: boolean; `suggestion`: boolean (which lines went) |

   - **Pingpong frames.** A Pingpong frame is the window of any iframe in the top document whose `src` starts with `https://frame.pingpong.ai/`. There is no single "chat frame" and no measuring of boxes: every Pingpong frame that has spoken is armed, and each is heard. (The first design armed only the first visible one; a frame that was hidden for a moment then kept its last arm for good, and its report was dropped.)
   - The top role posts with target origin `https://frame.pingpong.ai` and accepts only messages whose origin is `https://frame.pingpong.ai` and whose source is a Pingpong frame of its document at that moment.
   - The frame role posts to `window.parent` with target origin `https://zeta-ai.io` and accepts only messages whose origin is `https://zeta-ai.io` and whose source is `window.parent`.
   - Both sides ignore an event that the browser did not deliver itself (`isTrusted` not true), and anything untagged, of an unknown kind, or with a field of the wrong type.
   - **The bridge token.** A script in the top page can post to the frame as the top page does, so origin and source cannot tell the scribe's arm from a forged one. The two copies of the script share the userscript's own storage, which page scripts cannot read. The top keeps one random value there (`scribe-bridge`, made once, read again before every arm) and puts it in every arm; the frame reads that one value and accepts an arm only with it, compared exactly.
   - **Handshake.** The frame posts `ready` at start and every 1,000 ms until it accepts its first valid `arm`. The top remembers the Pingpong frames from which it accepted a valid message (at most 16; one still in the document is never pushed out, and when the list is full a new one is not heard), forgets those that left the document, and arms only those.
6. **Arming (top role).** The arm is the live part's lines at that moment. A session that is not the reader, has no trusted book, or is closed arms with both lines null. The top pushes an arm to every remembered frame: in reply to `ready`; after every `sent`; and whenever the lines differ from the last arm pushed to that frame (looked at whenever the live part or the keeper notifies, on the session's interval tick, and when a session finishes building). An arm is recorded only once it was posted. When a session closes (the player leaves the chat) it pushes one last arm with both lines null. The frame takes the latest valid arm it receives; `seq` need not rise.
7. **Sending (frame role).** With no arm received yet the frame does nothing and reports nothing. With an arm, the send hook works as it does today on the frame's own chat box: on Enter (no modifier, not composing) or a press on Send with text in the box, the lines are appended, an Enter is held and sent again after 25 ms, and the hook then watches the box: the moment the player edits, the lines are taken out and the send is over; when the box no longer holds the lines and nothing was edited, the send has gone. For a send that has gone the frame reports `sent` with the arm's `seq` and which lines went (both false when nothing was appended), and stops offering the lines that went until the next arm, so two quick sends cannot carry them twice.
8. **Counting (top role), on `sent`.** For each frame the top keeps the last 8 arms it pushed to it, each belonging to the session it was made for; when a session closes they are forgotten, so one chat's report never reaches another chat. At most 10 `sent` are accepted from one frame in any 10 seconds. When `seq` names one of the arms kept for that frame, the live part is told which of that arm's lines went (it clears a reminder or suggestion only if it still holds the very same text, marks the findings that reminder led with, and counts the send). An earlier arm counts because a send settles in the frame for about a second and a half, during which the top may push a newer arm; the frame then reports under the older number. In every case the keeper is asked to look at the chat as after the page's own traffic (at once, and after 5 and 15 seconds), since the frame's send may not pass through the top page's network calls.

## Calls made by the assistant, for the operator to check

- The chat box is `textarea[name="message"]` only and the Send button `button[aria-label="Send"]` only, in both roles (3).
- The top page's own hook stays for the old layout (3).
- The reminder crosses to the frame when it is ready, not only at the moment of sending (6): a call from the frame to the top cannot be answered within a keypress. The line is on its way into the chat anyway.
- The reminder is dropped before the suggestion when the message would be over 4,500 bytes, as today (4).
- A `sent` from the frame also makes the keeper look at the chat (8).

## Accepted limits

- The Send button is found by its English label. In another site language a press on Send carries nothing; Enter still does.
- A change of the lines and a send inside one message round trip (about a millisecond) may use the previous arm.
- DM Memory and the scribe both hook Enter inside the frame. Only one of them may be enabled.
- For up to 1 second after a chat frame reloads, a send carries nothing.
- Every page on `frame.pingpong.ai` that runs the script receives the bridge token. A page there that forwarded the messages it receives to its parent would let a hostile script in the Zeta page add a line to the player's messages.
- A hostile script in the Zeta page can fill the list of frames with 16 Pingpong iframes before the chat's frame speaks; then nothing is appended (it fails safe).

## Tests

- The send hook's existing tests stay, adapted to the two selectors.
- A two-document harness (top and frame) relays `postMessage` with origins and sources. Tests try to break: origin and source checks in both directions; malformed messages; a frame that has not spoken; an unarmed frame; the other two buttons and the three text inputs; a send by Enter and by Send; two quick sends; the take-back on an edit; the byte limit; a stale `seq`; a frame reload; leaving the chat; a tab that is not the reader; the frame role reading no storage and making no request.
- The whole walk runs over a page whose chat box is inside a frame.

## Owner checks on the real page

1. Rebuild and reinstall. Tampermonkey shows the script running in the room page and in the Pingpong frame. The console shows no error from the scribe.
2. With a book adopted and a reminder shown under "With your next message": type a message and press Enter. The message in the chat ends with one `@: [Scribe] ...` line, sent once; the panel no longer shows the reminder as waiting.
3. The same with the Send button.
4. Click "Suggested replies" and "Insert asterisk" with text in the box: nothing is added.
5. Press Enter while a reply is streaming, then type on: the scribe's line leaves the box.
6. Type in DM Memory's notes box (with DM Memory disabled, type in any other field of the page): nothing is added there.

## Build order

1. The send hook, the composing function, the live part's lines and "what went", and the frame role (`scribe/page/ScribeSender.js`, `scribe/page/ScribeLive.js`, new `scribe/page/ScribeFrame.js`, their tests).
2. The top role's bridge and the three cases at start (`scribe/page/ScribeBoot.js`, `scribe/page/ScribeStart.js`, their tests).
3. The header and the pack list (`scribe/userscript.header.txt`, `scribe/pack.mjs`, `tests/scribe-pack.test.mjs`).
4. The whole walk over a framed chat (`tests/scribe-whole.test.mjs` and its support files).
5. One adversarial review of the bridge, the fixes, then the README and the verification record.
