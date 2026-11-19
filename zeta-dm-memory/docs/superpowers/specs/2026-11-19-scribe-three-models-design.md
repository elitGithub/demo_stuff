# Design: three models, one job each

Date: 2026-11-19. Operator: "ONE MODEL FOLLOWS THE STORY AND RAISES CONTRADICTIONS AND INCONSISTENCIES. ONE MODEL WRITES A PROPER REMINDER. ONE MODEL KEEPS TRACK OF TIMELINES AND FINDINGS."

## Why (the export of room `45359def`, "Last Mage on the List", 2026-11-19)

- **No contradiction raised:** Zeta had Mavan hold the Staff of Elders "for two centuries" (#129, #131), then had the dragon Magera guard it "for a thousand years" (#209). Nothing flagged it. The checker sees only facts still in force and the last 10 messages, and the reading had ended the "Mavan holds it" fact at #166, when Mavan's own staff was destroyed (it took the two staffs for one).
- **The book contradicts itself:** "The Staff is destroyed" stays an open story point next to "the Staff of Elders lies in Magera's hoard"; the reading files new versions next to old ones without saying so.
- **A dead man in the reminder:** the scene stopped at #157 (Mavan alive); its calls failed from #146 on (OpenRouter 402, answers cut off), silently. The reminder kept naming Mavan present for 60 messages, the book's "Mavan: dead" (#166) was never used, and Zeta copied the reminder into its own narration (#217, #219, #225).
- **A stuck key:** a 402 stops the reading with a lasting stop that never retries; a new key changes nothing until Resume; OpenRouter's reason text is thrown away (`ScribeGateway.js:289-295`), so the panel cannot say why.

## The three models (the existing three model settings, renamed)

| Model | Setting (today's) | Job |
|---|---|---|
| **Tracker** | Analyzer | Keeps the timeline, the book and the findings |
| **Checker** | Pedant | Follows the story; raises contradictions and inconsistencies |
| **Reminder writer** | Scribe | Writes the reminder |

### Tracker: the timeline and the findings

- **The timeline** is the story's record: one line per thing later replies must agree with, each with its message number: who did what, deaths and departures, what was gained, lost, destroyed, handed over or transformed, and who holds it, deals and promises, reveals, where people are and where they go, the day and time. Example: `#131 Mavan claims he has held the Staff of Elders for two centuries and offers it as the duel prize.` `#167 Frost's Annihilation erases Mavan, his phylactery and his own staff.` It names things exactly as the chat does and never merges two things the chat has not shown to be one.
- **Every reply** (after the Checker, see "Order"), the Tracker adds the reply's and the player's message's lines to the timeline and updates the book (looks, clothing, relations, places, the party's goal): the book is never a stretch behind.
- **When new messages contradict the timeline or the book**, it does not file over: the contradiction goes to **Needs you** as a finding, with both message numbers, until the operator rules.
- **The findings list** (contradictions, inconsistencies, rulings asked and given) is the Tracker's to keep; a ruling corrects the timeline and the book.
- **An existing chat** is read once from the start, in stretches, to build its timeline (as adoption reads today).

### Checker: follows the story

- **Every reply** is judged against the whole timeline, the book, and the recent messages in full: does this reply fit the story so far? It raises a **contradiction** (the reply against anything earlier, at any distance: `#209 Magera has guarded the Staff of Elders for a thousand years` against `#131`) and an **inconsistency** (the dead acting, someone absent speaking, a hand reaching across a room, a destroyed thing in use, the wrong day, a place or rank made up).
- It quotes the reply's words and the earlier message's words; a finding whose quotes are not in those messages is dropped (as today).
- It runs **before** the Tracker records the reply, so a contradicting reply is never written into the timeline as truth.

### Reminder writer: a proper reminder

- When the reminder is due (every N sends, or forced), it writes the state of play in a few plain story sentences, from the timeline, the book and the last messages: who is here, who is dead or gone, what people hold and wear, where they are and where they are going, the deal in force. At most 1,000 bytes. Example for #225: `Mavan the Gray is dead; Frost destroyed him. Thessaly carries the Staff of Elders. The party (Frost, Thessaly, Veyra, Selene) is leaving Ashenmaw Ruins to seal the Northern Rift. Magera, the dragon Frost freed, travels with them as a black housecat under his rules.`
- It states only what the timeline and messages state; the operator still sees it and can Edit or clear it before it goes.
- **No reminder from a stale story:** when the Tracker or the Checker has not handled the last reply (a failed call, a gap), no reminder goes and the header says why.

## Order on each reply

1. Checker judges the reply against the timeline as it stood before it.
2. Tracker records the reply (contradictions flagged go to Needs you, not into the timeline as truth).
3. When due, the Reminder writer writes from the updated timeline.

## Never silent

- A failed call (any model) is retried at the next cycle; while any of the three is failing, the header says which and why, with OpenRouter's own reason text.
- Saving a new key clears a failure stop and retries at once.
- A reply missed while a model was failing is handled when it recovers (no gaps in the timeline or the checks).

## What goes

The scene call (`ScribeScene`: its place and present now come from the timeline), the template reminder (`ScribeReminder.compose` and its people, looks and place rules), the 10-message limit of the situation check, the reading's 40-message lag for new replies.

## Cost (to be measured on the operator's room before the plan)

Per reply: one Checker call and one Tracker call (today: one scene call and one checker call, plus a reading every 40 messages). Every N sends: one Reminder call. The timeline's length grows with the chat; its size per call is the main cost to measure.

## Questions for the operator

1. **The timeline's size:** for a long chat, does the Checker get the whole timeline every reply, or the whole timeline up to a cap with the oldest lines condensed by the Tracker?
2. **The reminder's text in the chat:** Zeta copied the `[Scribe]` block into its own narration three times. Should the reminder be written as plain narration (no `[Scribe]` label), so an echo reads as story, or keep the label so you can see it?
3. **Order against the open work:** cloud store Task 2 is built and in review; the story-setup design waits. Proposed: finish and commit Task 2 (it touches storage, not these models), fold the story setup into this design (all three models get the setup and profile as background), then this.
