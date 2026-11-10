# Userscript v1.3 verification

Run on 2026-11-10 with Node.js v24.11.0 on Windows against the WSL workspace.

## Automated checks

Run from the demo directory in PowerShell.

```powershell
& 'C:/Program Files/nodejs/node.exe' --check zeta-dm-memory.user.js
& 'C:/Program Files/nodejs/node.exe' --test tests/userscript.test.mjs
```

After review corrections, the syntax check exited 0. The VM suite exited 0 with 24 passed, 0 failed, 0 cancelled, and 0 skipped in 658.9095 ms.

The suite compares all four preserved injection functions and both global send handlers against the v1.2 fixture with normalized line endings. The original and updated scripts produce the same narrator text, Paste behavior, native setter and input/change events, turn state, pointer interception, and 25 ms Enter resend in the harness.

The sync tests cover room-bound navigation, later edits during pending work, retry and lost-response recovery, conditional conflicts, IME and debounce, local persistence failure, pagination, literal rendering, import confirmations and races, credential rotation and isolation, and malformed responses. The harness uses controlled timers, storage, DOM events, and Tampermonkey transport responses. It uses fictional data and credentials.

Two VM instances sharing storage verify that both conflict actions reject a snapshot the panel has yet to show, and that a clean read or save acknowledgement refreshes a focused editor. Further checks verify revision-zero recovery after confirmed absence and the latest draft's 500 ms debounce when **Retry notes sync** is selected during an older save.

## Operator browser checks pending

- Install v1.3 over v1.2. Verify Paste, automatic narrator injection, the keyboard resend, and pointer send with the real React composer.
- Set the key independently in two browsers. Save one room and reopen or focus that room in the other browser. Confirm notes sync and the injection settings stay local.
- Open a room with legacy local notes. Verify matching notes reconcile and different notes present the two conflict choices.
- Navigate between two rooms with the editor focused. Verify each room keeps its own notes and a late response leaves the current editor alone.
- Import a saved room, cancel a replacement, and confirm a replacement from a source with empty notes. Verify the source remains independent.
- Exercise a failed request and use **Retry notes sync**. Check that the draft stays visible throughout.

The VM tests do not establish browser, React, Tampermonkey, or hosted Worker behavior. Automated verification made no hosted requests, used no database, and sent no chat messages.
