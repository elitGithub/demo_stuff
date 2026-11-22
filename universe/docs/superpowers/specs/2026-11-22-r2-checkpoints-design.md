# Universe R2 checkpoints

## What the operator gets

One Universe launcher owns four to ten open SillyTavern chats on one PC. SillyTavern keeps its normal local save behavior. Every 15 minutes, Universe publishes a restorable R2 revision if the portable story files changed. **Save now** requests the same operation immediately from any chat. Both work while the launcher and browser stay open. Each PC keeps its own model keys.

## Approaches considered

Manual saving alone requires the operator to remember. Publishing on every local change sends many versions of the same growing transcript. The operator selected scheduled checkpoints and manual saving. Use the existing R2 transport and the existing 60-second lease renewal.

## When a revision is created

- Start one 15-minute timer when the local writer session is ready. Replace today's 30-second background upload loop. On each tick, compare the portable inventory, including deletions and renames, with the last confirmed revision. An unchanged interval needs no R2 checkpoint requests. Lease renewal continues independently.
- Use one serialized queue for timer ticks, button presses and close. Requests for the same captured state share the result. A manual request made after capture must cover changes already saved locally when it was pressed. Queue a follow-up capture if needed. Missed timer ticks after sleep collapse into one check.
- The last confirmed time identifies an acknowledged revision. An unchanged manual check reports **Already up to date** and retains the original confirmation time. A successful intermediate commit advances the cloud head and keeps the lease. A second PC can restore that head after release or lease expiry.

## Capturing a live session

The current launcher can assume the child has exited before publishing. A live checkpoint needs its own stable local copy. The unit of capture is a completed SillyTavern save across the portable files. Unsent drafts remain in the editor. A manual request waits for a turn already streaming at request time to finish and for its resulting save to reach disk. The button immediately shows **Waiting for current turn** while this is pending.

Use a small Universe-owned integration for the pinned SillyTavern release. Track active turns, pending saves and in-flight story mutations across the participating tabs. Allow typing throughout. At capture, drain started saves, briefly queue new story mutations, and copy the portable file inventory and content into a private local staging area. Release queued writes before network I/O. A file watcher or two equal directory scans alone cannot establish that a multi-file save has finished. The implementation plan must identify the actual frontend and server lifecycle hooks and prove the barrier covers solo chats, group metadata and transcript writes, card edits and lore edits. If the integration cannot establish a consistent boundary, leave the prior cloud revision intact and report a pending checkpoint.

Reuse the existing portable path allowlist, validation and content hashes. Upload only missing or changed content from the captured copy. An edit made during upload belongs to the next capture. Publish the complete manifest using the existing conditional update of the lease and head. Keep the 60-second renewal running throughout capture and upload. A launcher that loses the lease stops publishing and preserves its local changes.

A busy automatic tick coalesces into one pending check and retries at the next completed turn or save. A manual wait has a proposed 60-second deadline. On timeout, or when a tab vanishes before acknowledging its flush, report **Checkpoint still pending**, keep local edits, and release the request slot so shutdown and retries can proceed. Never label a timed-out operation saved.

## Save now in the chat

Add a phone- and keyboard-accessible **Save now** action to SillyTavern's chat extensions menu. Keep the action, progress and result together. All tabs observe the same launcher state. Show **Saving…**, **Saved at [time]**, **Already up to date** or **Save failed — retry** as applicable. In local-only mode show **Cloud save is not configured**. No save confirmation dialog is needed.

Keep the integration source under Universe so a clean upstream install can be prepared on either PC. Use a same-origin, authenticated SillyTavern plugin route with the existing CSRF protection to request a checkpoint. Forward a fixed command over the existing child/launcher IPC channel. Keep R2 credentials in the parent. Rate-limit manual requests, coalesce repeated clicks and expose status through a read-only route.

## Failure and recovery

Persist the base revision, the proposed operation ID and the immutable capture before attempting publication. Keep the working session's newer edits independently recoverable. On acknowledgement, atomically record the confirmed base locally and continue tracking newer changes. After a lost response or crash, check the remote revision and its ancestry before retrying. Recover from the captured bytes even when the live working tree has changed. Preserve both sides of a divergent history. Reclaim staging files only after the journal no longer references them. Retain support for pending journals produced by the current launcher.

Record a durable capture-complete marker only after the inventory and its bytes are durable. A crash while editing, including between group metadata and transcript writes, can leave an uncertain working tree. Keep that tree for recovery and keep the prior cloud head available. Resume publication from a completed capture. For a legacy publishing journal, verify every byte against its recorded manifest before retrying. Treat a legacy editing journal as unconfirmed and require reconciliation before advancing the head.

Coordinate the existing graceful launcher stop with the checkpoint queue. Drain an in-flight commit before the existing final save uses its updated base revision and releases the lease. An interrupted stop leaves the last confirmed checkpoint available to the next writer.

## Acceptance checks

1. Use a controllable clock and ten active chat tabs. One launcher makes one lease renewal per minute. Idle ticks make zero additional R2 requests. Several edits to one file before the 15-minute mark produce one uploaded final version.
2. Restore an intermediate checkpoint into a fresh profile after simulating PC A crashing and its lease expiring. Read the exact confirmed turns, cast and group metadata before any final save. Verify deletions and local-only credentials.
3. Press **Save now** during a streamed group turn, a multi-file group save and an automatic upload. Verify immediate feedback, no partial turn or mixed revision, and that edits accepted after capture survive for the following revision.
4. Inject a failed upload, lost commit acknowledgement, restart with newer local edits, and takeover by PC B. Kill the process between group metadata and transcript writes with both the current and legacy editing journal formats. Verify that the last confirmed revision stays usable and pending local bytes survive without promoting a partial save.
5. Stop the launcher normally during a checkpoint. Verify that the last local turn is saved, the final revision follows the confirmed checkpoint and the writer lease is released.
6. Exercise the button in the pinned real UI on desktop and phone widths, including keyboard operation, failure and retry. Verify both the scheduled and manual revision in live R2 with synthetic data while the writing launcher is still running. Check the result against the exact message in each revision.
