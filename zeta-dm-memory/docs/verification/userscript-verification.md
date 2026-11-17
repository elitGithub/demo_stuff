# Userscript verification

## v1.4 chat frame

Run on 2026-11-17 with Node.js v24.20.0 on Linux in the workspace, from the demo directory.

```sh
node --check zeta-dm-memory.user.js
node --test tests/userscript.test.mjs tests/userscript-frame.test.mjs
```

After review fix round 2, the syntax check exited 0. The two suites exited 0 with 55 passed, 0 failed, 0 cancelled, and 0 skipped in 273 ms: 23 in `userscript.test.mjs` and 32 in `userscript-frame.test.mjs`.

`original_injection_sections_are_preserved` is removed, because v1.4 changes the sections it pinned byte for byte. `original_narration_paste_and_send_behavior` still runs the v1.2 fixture beside the current source in the old single-document layout and gets the same narrator text, Paste result, React setter events, turn state, 25 ms Enter resend, and pointer send.

The frame suite runs the source twice on one clock: once as the room page at `https://zeta-ai.io` and once as the chat frame at `https://frame.pingpong.ai`, joined by a `postMessage` relay that checks target origins and reports sender origin and window. It covers a lost `ready`, Enter and Send counting, due injection through Enter (held 25 ms and resent once) and through Send, Suggested replies, Insert asterisk, the three text inputs, blank boxes, Shift+Enter and IME composition, empty notes, two quick sends, an interval of 1, force-next, Paste into empty, padded and already-filled boxes, hidden and missing frames, decoy iframes, notes crossing only when due, forged and malformed messages in both directions, untagged site traffic, a reloaded frame, a room change, a notes edit before a send, cloud and Import changes re-armed by the 800 ms loop, CRLF and asterisk formatting, the top page hooks touching only the chat box, other origins and foreign parents staying idle, the header, and the title. The frame copy makes no storage, Tampermonkey, or widget calls.

The review fix rounds added tests for these cases:
- the repeated `ready` (every 1000 ms until the first arm, and none after);
- a frame reloaded in place in the same window, hidden and then shown again, which is re-armed;
- an iframe still on its initial same-origin document, which gets no message until its frame copy speaks;
- a non-Zeta or nested `ancestorOrigins`, which posts no `ready`;
- the arm following a room change within 100 ms, including a non-room page and a window focus;
- the room check continuing without the widget node once the first room is active, while the first activation still waits for the widget (fix round 2);
- a second Pingpong iframe: switching back to an earlier frame window that has already spoken re-arms it within one 800 ms tick, carries force-next, and accepts Paste without a new `ready` (fix round 2);
- the arm read from normalised notes (non-string stored notes give `off` without errors) and from an unsaved draft;
- unrelated iframes that are never measured.

Accepted limits:
- A send within 100 ms of a room change may carry the previous room's arm.
- A notes edit and a send inside one message round trip may use the previous arm.

### Owner checks on the real page

- [ ] Reinstall the script. Open a room. The widget shows `DM Memory v1.4` and the console shows no errors from the script.
- [ ] Send with Enter. The counter goes up by one.
- [ ] Send with the Send button. The counter goes up by one.
- [ ] Click Suggested replies and Insert asterisk with text in the box. The counter does not move.
- [ ] Send until the counter is due. The notes are appended under the message, which is sent once, and the counter resets.
- [ ] Tick **Inject on next message** and send. The notes go with that message.
- [ ] Press **+ Paste**. The notes appear in the chat box and the counter resets.

The VM tests do not establish browser, React, Tampermonkey sandbox, or cross-origin `postMessage` behavior on the live site.

## v1.3

Run on 2026-11-10 with Node.js v24.11.0 on Windows against the WSL workspace.

### Automated checks

Run from the demo directory in PowerShell.

```powershell
& 'C:/Program Files/nodejs/node.exe' --check zeta-dm-memory.user.js
& 'C:/Program Files/nodejs/node.exe' --test tests/userscript.test.mjs
```

After review corrections, the syntax check exited 0. The VM suite exited 0 with 24 passed, 0 failed, 0 cancelled, and 0 skipped in 658.9095 ms.

The suite compares all four preserved injection functions and both global send handlers against the v1.2 fixture with normalized line endings. The original and updated scripts produce the same narrator text, Paste behavior, native setter and input/change events, turn state, pointer interception, and 25 ms Enter resend in the harness.

The sync tests cover room-bound navigation, later edits during pending work, retry and lost-response recovery, conditional conflicts, IME and debounce, local persistence failure, pagination, literal rendering, import confirmations and races, credential rotation and isolation, and malformed responses. The harness uses controlled timers, storage, DOM events, and Tampermonkey transport responses. It uses fictional data and credentials.

Two VM instances sharing storage verify that both conflict actions reject a snapshot the panel has yet to show, and that a clean read or save acknowledgement refreshes a focused editor. Further checks verify revision-zero recovery after confirmed absence and the latest draft's 500 ms debounce when **Retry notes sync** is selected during an older save.

### Operator browser checks pending

- Install v1.3 over v1.2. Verify Paste, automatic narrator injection, the keyboard resend, and pointer send with the real React composer.
- Set the key independently in two browsers. Save one room and reopen or focus that room in the other browser. Confirm notes sync and the injection settings stay local.
- Open a room with legacy local notes. Verify matching notes reconcile and different notes present the two conflict choices.
- Navigate between two rooms with the editor focused. Verify each room keeps its own notes and a late response leaves the current editor alone.
- Import a saved room, cancel a replacement, and confirm a replacement from a source with empty notes. Verify the source remains independent.
- Exercise a failed request and use **Retry notes sync**. Check that the draft stays visible throughout.

The VM tests do not establish browser, React, Tampermonkey, or hosted Worker behavior. Automated verification made no hosted requests, used no database, and sent no chat messages.
