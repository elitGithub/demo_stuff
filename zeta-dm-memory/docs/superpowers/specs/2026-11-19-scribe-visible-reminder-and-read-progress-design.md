# Send the visible reminder, finish reading, and close ruled issues

Proposed for operator approval, 19 November 2026. This amends the manual-send, reading and ruling behavior in the [three-helper design](2026-11-19-session-helpers-design.md).

## The paragraph the operator chooses

When Findings shows a paragraph, **Send a reminder with my next message** queues that exact text for the current room. The click itself is the operator's choice to use it, including a draft from an earlier reply. Snapshot the paragraph visible at click time. A subsequent writer result, poll, book update or storyteller reply cannot silently replace or disarm that selection. Show “Queued for your next message” beside it. The click never sends a standalone chat message.

Keep **Edit**. Saving a deliberate edit to a queued paragraph replaces that selection; Cancel restores the previous selection. If the operator presses the send-reminder button while editing, use the text currently in the field in one action. If no paragraph is visible, request a fresh one, start or join outstanding work immediately, and identify what is still being read. Automatic reminders use current room evidence. Preserve an explicitly selected paragraph while automatic work catches up.

An open editor containing only whitespace gets an inline validation error. Keep the existing selection queued. The request for a fresh paragraph applies to an empty preview with the editor closed.

## A delivery clears once

Use the existing room, reminder and send-attempt IDs. After Zeta accepts a player message carrying the complete selected paragraph, clear that offer, its matching draft, preview and frame attachment, and reset the interval. An immediate second send is bare. Preserve any newer edit created while the send was in flight. An explicit rejection keeps the selected paragraph queued. An uncertain result waits for its receipt or reconciliation with room history; the existing explicit resend action remains available.

If the player's text and full paragraph exceed Zeta's 4,500-byte limit including framing, preserve the player's send and visibly say the reminder is still queued. Never shorten a manually selected paragraph behind the operator's back. Keep the existing reminder edit limit of 3,000 characters and show its validation error at the editor.

## Read the tail of the room

The current keeper excludes the newest message and can round the last unread run down to a full batch. With 441 messages a local reproduction went idle at 440/441. Treat the room's batch size as a maximum. With #1–400 saved and size 40, save #401–440 and then #441, even if no further message arrives. When more messages arrive during a read, continue from the first remaining gap. Use stable IDs and raw fingerprints so editing or regenerating the last reply still triggers the appropriate reread.

Advance the displayed count only after the book save succeeds. A failed read, pause, budget limit or lost reader lease preserves the last saved position. Resume eligible work from there. The progress line should distinguish active reading, a saved final batch, and a blocked read. Reuse the existing room lock, spending checks and recovery machinery.

## Automatic interval

Keep **User messages between reminders** as a per-room positive integer, default 6, preserving existing values. Count each accepted player message once. When interval 8 is configured and a paragraph is ready, sends 8 and 16 carry it. A manual delivery on send 3 resets the next regular target to send 11. If the paragraph is still being prepared when due, keep it due for the next eligible send. Clicking the button, a failed send or a storyteller reply adds zero. Reload and duplicate acknowledgements cannot deliver or count twice.

## A ruling closes the issue

Once an operator ruling is saved, remove the issue it resolves from active Findings, the pending rulings list and their badge counts. Preserve the ruling, its evidence and the decision in history. Apply the same result when the operator rules from Findings or directly from Rulings. A written answer awaiting book processing can have a processing status outside the actionable queue; it must not ask the operator to rule again. Leave open, Cancel and a failed save keep the issue open.

Match the disputed point and its supporting evidence. An unrelated book revision or a “book has since changed” label alone cannot close an issue. Reconcile previously saved rulings with older open rows where the link is unambiguous. The same evidence stays settled after reload and rechecking. A materially changed supporting passage or revoked ruling makes only the affected issue eligible to reopen.

The book and Live findings use separate saves. If the book saves the ruling and the Live update fails, use the durable book ruling to suppress the resolved row and update the counts on redraw and reload. Repair the Live record when writable without asking for the same ruling again.

## Acceptance through the shipped userscript

- Reproduce the screenshot with a visible older draft, a newer reply, and #400 of 441 read. Click once, receive another reader/writer update, then send. Assert the actual accepted message carries the displayed paragraph once, the draft clears, and a second send carries no copy. Repeat with edited text, Enter, and the frame Send button.
- Cover a rejected POST, a missing receipt followed by reload, text too large to fit, and a newer draft created while the original send is unresolved. Inspect both the accepted message and the remaining panel state.
- Replay 441 messages with size 40 and stop chat traffic. Verify the persisted book and progress reach 441/441. Fail the final save, resume, and edit the last message under the same ID. Completed work outside the affected range stays valid.
- Exercise intervals 6, 8 and 10, a manual delivery between scheduled reminders, two tabs and two rooms with different interval settings.
- Give the room two open findings. Rule on one and verify its row and count disappear after save, the other stays open, and the decision survives reload. Recheck the same evidence, then edit the supporting passage and verify only that issue can reopen. Repeat with a failed ruling save.
