# Universe R2 checkpoints (superseded by `2026-11-22-sync-rewrite-design.md`)

## What the operator gets

SillyTavern keeps saving locally as the user plays. Every 15 minutes while the Node launcher is running, it checks the entire SillyTavern user profile and publishes a restorable R2 revision when the profile has changed. A confirmed revision can be restored on the other PC, including saved API keys. The existing **Save now** design describes a separate way to request a checkpoint. Automatic saves must work without pressing a button or keeping a browser tab open.

## Profile coverage and upgrading an existing save

- Capture every profile file byte-for-byte and preserve the directory tree, including empty folders. Names, depth and file extensions do not determine membership. This includes settings, persona definitions and portraits, saved keys, chats, group state, cards, lorebooks, gallery images, extension data and files created by future extensions.
- For a named SillyTavern account, also carry the account record and account avatar that SillyTavern stores outside its profile directory. The restored account must be selectable with its original credentials in the same SillyTavern account mode. The npm-installed launcher and extensions remain project dependencies.
- Identify the older five-folder format on both read and recovery. It describes only the paths its writer could capture. Loading it on a PC that already has a persona, images or keys must preserve those files. The first complete capture on the PC holding that data publishes a full-profile revision, even when its five old folders have no changes. An old revision by itself cannot recover files its writer omitted.
- Give the full-profile format an explicit marker. Verify its file contents, directories and associated account records after restoration. If an item cannot be transferred faithfully to Windows, report the path and keep the previous confirmed revision available. Never mark a partial copy as complete or print key values. When two PCs have conflicting unconfirmed edits, preserve both copies for the operator.
- Deliver the change through the existing npm launcher. An existing build must pick up the new code on the next normal start. Check this with a disposable build and synthetic profiles. The operator's running instance, actual profile and R2 bucket are outside the test fixtures.

## Approaches considered

Manual saving alone requires the operator to remember. Publishing on every local change sends many versions of the same growing transcript. The operator selected scheduled checkpoints and manual saving. Use the existing R2 transport and the existing 60-second lease renewal.

## When a revision is created

- Start one 15-minute timer when the local writer session is ready. Replace today's 30-second background upload loop. On each tick, compare the complete profile inventory, including deletions and renames, with the last confirmed full-profile revision. An unchanged interval needs no R2 checkpoint requests. Lease renewal continues independently.
- Use one serialized queue for timer ticks, button presses and close. Requests for the same captured state share the result. A manual request made after capture must cover changes already saved locally when it was pressed. Queue a follow-up capture if needed. Missed timer ticks after sleep collapse into one check.
- The last confirmed time identifies an acknowledged revision. An unchanged manual check reports **Already up to date** and retains the original confirmation time. A successful intermediate commit advances the cloud head and keeps the lease. A second PC can restore that head after release or lease expiry.

## Capturing a live session

The current launcher can assume the child has exited before publishing. A live checkpoint needs its own stable local copy. The unit of capture is a completed SillyTavern save across the portable files. Unsent drafts remain in the editor. A manual request waits for a turn already streaming at request time to finish and for its resulting save to reach disk. The button immediately shows **Waiting for current turn** while this is pending.

Use the Universe integration for the pinned SillyTavern release. Track active turns, pending saves and in-flight profile mutations across the participating tabs and server. Allow typing throughout. At capture, drain started saves, briefly queue new mutations, and copy the complete inventory and contents into a private local staging area. Release queued writes before network I/O. A file watcher or two equal directory scans alone cannot establish that a multi-file save has finished. The implementation plan must cover profile-wide writes, including delayed settings saves, server-side settings backups scheduled after a request completes, persona images, saved keys, uploads, account changes and the existing story routes. If the integration cannot establish a consistent boundary, keep local edits, report a pending checkpoint and retry.

Use the existing content hashes and retain validation against path traversal, filesystem links and conflicting Windows paths throughout the complete profile. Restrict the old path allowlist to reading or recovering older saves. Upload only missing or changed content from the captured copy. An edit made during upload belongs to the next capture. Publish the complete manifest using the existing conditional update of the lease and head. Keep the 60-second renewal running throughout capture and upload. A launcher that loses the lease stops publishing and preserves its local changes.

A busy automatic tick coalesces into one pending check and retries at the next completed turn or save. A manual wait has a proposed 60-second deadline. On timeout, or when a tab vanishes before acknowledging its flush, report **Checkpoint still pending**, keep local edits, and release the request slot so shutdown and retries can proceed. Never label a timed-out operation saved.

## Save now on the Universe wrapper home page

The operator selected the Universe wrapper's existing home page for the **Save now** button. Show progress and the confirmed result beside a native, keyboard-accessible button. An unchanged checkpoint retains the previous confirmation time. A busy, unavailable or failed checkpoint reports its own state. In local-only mode show **Cloud save is not configured**.

The home page submits a same-origin, CSRF-protected request to its loopback wrapper. The wrapper passes the request directly to its existing full-profile R2 checkpoint queue. Keep the existing capture barrier, 15-minute timer, and graceful-stop save. Test through npm with a simulated child, in-memory R2 and in-process HTTP request/response objects.

## Failure and recovery

Persist the base revision, the proposed operation ID and the immutable capture before attempting publication. Keep the working session's newer edits independently recoverable. On acknowledgement, atomically record the confirmed base locally and continue tracking newer changes. After a lost response or crash, check the remote revision and its ancestry before retrying. Recover from the captured bytes even when the live working tree has changed. Preserve both sides of a divergent history. Reclaim staging files only after the journal no longer references them. Retain support for pending journals produced by the current launcher.

Record a durable capture-complete marker only after the inventory and its bytes are durable. A crash while editing, including between group metadata and transcript writes, can leave an uncertain working tree. Keep that tree for recovery and keep the prior cloud head available. Resume publication from a completed capture. For a legacy publishing journal, verify every byte against its recorded manifest before retrying. Treat a legacy editing journal as unconfirmed and require reconciliation before advancing the head.

Coordinate the existing graceful launcher stop with the checkpoint queue. Drain an in-flight commit before the existing final save uses its updated base revision and releases the lease. An interrupted stop leaves the last confirmed checkpoint available to the next writer.

## Acceptance checks

1. Use a controllable clock and ten active chat tabs. One launcher makes one lease renewal per minute. Idle ticks make zero additional R2 requests. Several edits to one file before the 15-minute mark produce one uploaded final version.
2. Restore a confirmed 15-minute checkpoint onto a fresh simulated PC B after PC A crashes and its lease expires. Compare the entire synthetic profile tree byte-for-byte, including a persona portrait, a fake API key, named-account identity and avatar, settings, gallery images, extension state, empty folders, hidden and extensionless files. Exercise deletions and renames between full revisions. Verify that a legacy head and pending journal preserve previously omitted files on PC A and that its first full revision restores them on PC B.
3. Press **Save now** during a streamed group turn, a multi-file group save and an automatic upload. Verify immediate feedback, no partial turn or mixed revision, and that edits accepted after capture survive for the following revision.
4. Inject a failed upload, lost commit acknowledgement, restart with newer local edits, and takeover by PC B. Kill the process between group metadata and transcript writes with both the current and legacy editing journal formats. Verify that the last confirmed revision stays usable and pending local bytes survive without promoting a partial save.
5. Stop the launcher normally during a checkpoint. Verify that the last local turn is saved, the final revision follows the confirmed checkpoint and the writer lease is released.
6. Verify the wrapper button with synthetic data. Exercise a manual click before the first timer fires, a click during an upload, an unchanged check, an unavailable writer and a failed upload. Compare the contents of the confirmed revision with the restored profile on a second simulated PC.
