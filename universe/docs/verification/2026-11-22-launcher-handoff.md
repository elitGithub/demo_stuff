# Universe launcher handoff verification

On 2026-11-22, Ubuntu under WSL ran all 19 cases in `node --test launcher.test.mjs` with Node 24.21.0. All passed, with zero skips. Run the command from `universe/`.

| Scenario | Observed result |
| --- | --- |
| Two independent PC profiles | PC B restored PC A's exit-time turn. A subsequent handoff returned PC B's edits and deletion to PC A. Each retained its own credentials. |
| Upload failure and restart | The journal remained pending after an injected storage failure. Retrying published the retained turn before the child could edit. |
| Lost acknowledgement or stale writer | Recovery recognized a previously accepted revision. When the other PC had committed different edits, both versions survived. |
| Missing or replaced local story directory | Recovery stopped with the prior cloud revision intact. Intentionally deleting the final story from the original directory still synchronized. |
| Interrupted rename and restore | Restore resumed a case-only rename, reused an empty leftover directory, and preserved local-only files. A conflicting nonempty directory stopped the restore. |
| Process lifecycle | A real Ubuntu test child wrote its final turn on SIGTERM. The launcher included that turn in the confirmed revision. |

A separate `npm start` check with SillyTavern absent verified binding to `127.0.0.1:8767`, root responses, 404s for private paths, visible port conflicts, interrupt handling and immediate restart.

The two PC profiles used separate temporary data roots and one in-memory R2 transport. Live Cloudflare signing, two physical machines, an installed SillyTavern release and dedicated-window closure were outside this verification.

## Live R2 handoff

With SillyTavern 1.19.1 installed, the first live save staged the transcript but failed to publish its revision. The compressed R2 control read returned a weak ETag. After the identity-encoding fix, all 20 Ubuntu tests passed, including a transport regression covering the exact conditional-write header.

The original launcher recovered pending revision `fd543c09-d47e-4bb7-9101-c0d90ce4aecb` and completed a clean shutdown. A direct read from R2 confirmed the revision in the committed history, a released writer lease, and the expected transcript hash. The fresh local data root had no copy of the transcript before restore.

A separate SillyTavern instance restored the story from live R2. Its chat API returned the exact message `The lighthouse log is ready for pickup. Reference mwr0lwns.` in `Universe handoff mwr0lwns`. After that instance stopped and released its lease, the original profile resumed on port 8000 and returned the same message in R2 mode. Both profiles ran on one Ubuntu host.
