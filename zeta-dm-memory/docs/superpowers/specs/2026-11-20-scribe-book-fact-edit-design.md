# Edit the wording of a Book fact

20 November 2026. Design for operator review.

Open **Book**, choose the subject, then **Edit** beside the fact. For a bounty relation toward Mirra, change “offers a bounty of 100,000 gold” to “offers a bounty of 50,000 gold” and press **Save**. The same fact row shows the corrected amount. The relation still points to Mirra. The next eligible generated reminder reads the corrected book. A paragraph the operator has already queued keeps its selected text and identity.

## The row

Book opens in its existing read-only display. An in-force fact or a disputed alternative can be edited on its own row, including pinned values. Replaced, ended, expired and removed facts remain readable history. A watching tab can read the book. Saving requires the room's writable reader and a healthy book.

Edit opens a required text field prefilled with the displayed wording. The row still shows its subject context, category, target, source, status and audience. Cancel discards the draft. Save is rightmost, shows immediate progress and returns focus to the row after success. Unchanged text closes the editor without writing. Blank or punctuation-only wording gives an inline error. Ordinary redraws preserve the draft and cursor. If the fact changes while the editor is open, Save preserves the draft and explains that the row changed. Reopening Edit uses the latest value. A failed save leaves the original fact and draft available for retry.

## The book

If another fact already has the proposed wording and replay would combine the rows, keep both facts and their citations. Show “This wording would combine two facts. Choose distinct wording.” beside the field and retain the draft. Saving also compares who knew the fact when Edit opened with its current audience. A new disclosure to one character is a stale edit even when the hidden flag stays the same. The operator can reopen the row to review the latest audience and wording.

Save records one reversible operator ruling in the existing room log. Replay applies the wording to the identified fact and preserves its identity, subject, category, relation target, audience, source citation and applicable pin. The source message and original log entry remain available as evidence. Rulings made identifies the affected fact and shows its old and new wording. Revoking an edit reveals the most recent remaining correction or the original wording. Later changes to other facts, visibility and knowledge survive.

Fixed facts retain the existing conflict rules. Correcting the disputed point can resolve that disagreement, while unrelated alternatives and other disputes remain actionable. Reader regeneration cannot move an edit to a similarly worded fact about another target. Apply it after a reread only when the unchanged source passage and fact identity still identify one fact. A replaced, removed or materially changed source never brings back an obsolete fact.

The correction goes through Keeper's existing ruling save and replay. Edit, Cancel and Save incur zero model calls. The corrected amount is available to Book, Summary, the analyzer and the next writer when they consume replayed state. Verification uses synthetic rooms, both composer layouts, a reload, a failed save and revocation.
