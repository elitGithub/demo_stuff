# Recognizing a Zeta room fork

Proposed addition to the three-helper design. The reminder-delivery task proceeds separately.

## What “Start over from here” preserved

The two private Covenant of Black Scales exports have different room IDs and **zero shared message IDs**. In the fork, every message from #1 to #229 has the same sender, timestamp and ordered content blocks as the corresponding original message. All 227 nonempty candidate IDs in that prefix also match. The first bookmark ID changed. The original continues to #230. The fork ends at #229.

The original has an adopted book written through #223, 15 operator log entries, and a live scene at #230. The fork has an unfinished, machine-written book through #40, no operator entries and no live scene. The original includes Sera's cited measurements at #148 and #196 and the operator's ruling that both forms are correct.

## Recognition and inheritance

1. On opening a new or partly adopted room, use the available room history and saved campaigns to look for a shared prefix. Compare ordered messages from the beginning, including sender, exact timestamp and ordered content blocks. Use matching candidate IDs when present as additional evidence. Ignore room IDs, message IDs and bookmark IDs in the content comparison. Use hashes to narrow the search and confirm against the actual source fields before inheriting. Require matching conversation beyond a common plot introduction. An incomplete page of history cannot establish the start of the match.
2. A verified unique match with a trusted book yields an old-to-new message ID map up to the last identical message. For multiple plausible parent books with different facts or rulings, show the possible rooms and last matching message for operator selection. Without sufficient evidence, keep the child's existing data and explain what is missing. A shared title or character roster is insufficient.
3. Replay the parent's supported history into a staged book under the child's room ID. Remap every source reference, including read marks, fingerprints, fact citations, scene boundaries, knowledge events, findings and both sides of a ruling. Preserve dependencies and operator decisions whose supporting passages survive. Unanchored or ambiguous decisions need review before they become branch truth. A batch straddling the fork boundary cannot be copied as written through its end. Reuse only independently attributable results, or resume from the start of that batch.
4. The parent stays playable with its own later history. In the child preserve child-only messages, work, edits and operator decisions. Reconcile duplicate machine reads from the shared prefix rather than adding their effects twice. For a conflict between a child ruling and a parent ruling, retain the child's choice and expose the discrepancy. Validate the staged result before installing it under the child's reader lock using the normal room-isolated storage path. A failed or repeated inheritance must leave a recoverable book.
5. In this pair the Scribe inherits supported entries through #223 and reads **#224–229**. The Checker inherits only independently verified checks whose sources and versions survive; it resumes at its own first gap. No later parent results, pending sends, message acknowledgements or generated paragraphs cross into the fork. Derive the child's reminder position from its own verified shared sends and current branch. A due paragraph uses the child's latest checked state.

Compare only campaigns available to the same authorized account and profile. Preserve hidden facts and the record of who knows them. Parent and child books allocate their own subject, fact, thread, question and sequence IDs. Translate these references when merging independently created entries. Before installing the staged result, recheck the child's generation and lock ownership. If the child changed during staging, rebase on its latest state.

The original's entry 24 illustrates a legacy ruling without a direct source citation. Pin F74 has no winner and position zero. Replay the state immediately before the ruling to identify the complete disputed Sera/build set, F40 at #148 and F64 at #196. Inherit the ruling on those remapped facts only if that set is unambiguous and fully supported by the shared prefix. Otherwise preserve it for review. The Checker cache also has completed entries through #228 alongside outstanding checks at #216, #218 and #220. Keep those gaps visible and exclude the cached #230 result.

## Acceptance cases

- Open the exported fork with the original available. Recognize #1–229 despite changed IDs. Exclude original #230. Resolve every inherited citation in the child. Sera's two form-specific facts and the operator's ruling survive. Confirm that only the six outstanding passages need Scribe calls.
- Repeat with the child's existing partial #1–40 book. Its machine entries are neither duplicated nor allowed to displace a supported ruling. Repeat after reload and after a failed save. The original's book and read progress are unchanged.
- Test sibling forks, a fork of a fork, a common intro followed by different play, two equally matching parents with different rulings, partial source history, an edited message in the prefix and a fork in the middle of a saved stretch. Never inherit beyond the verified common prefix.
- Continue both branches with different outcomes. Each Checker cites its own room's messages. Sending on either branch clears only that branch's pending reminder.
- Use synthetic messages for repeatable public tests. Keep the actual room pair and its private facts in local verification.
