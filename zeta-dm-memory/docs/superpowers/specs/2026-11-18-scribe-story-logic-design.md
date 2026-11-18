# Zeta Scribe: does the reply fit what's happening?

Date: 2026-11-18
Status: direction approved by the operator on 2026-11-18 ("We need the LLM to check these things for me", "Yes, after", approach B "Stronger model yes."). Calls marked "assistant's call" are open to their ruling.

## Why

The checker compares replies only with facts filed in the book and with name spellings. It does not judge whether a reply fits the situation the recent messages set up. The operator's examples from 2026-11-18, room `/en/rooms/45359def-...`:

- The party agreed a dungeon mission with three nights of camping on the road. The reply then asks "You have a bed?" and narrates "Four people, one apartment, one bed."
- The characters stand at the door. The reply has Selene's "free hand ... reaching past Frost's arm toward the bedroom. Toward the table."

The operator's test: "does this match what's happening?" They usually catch these themselves but can let one slip.

## Goal

Each reply is also checked against what the recent messages establish (where the characters are, what they are doing and holding, the time, what was just agreed), and a clash is shown on the Findings tab like any other finding.

## Non-goals

- No style, taste or "could be better" remarks. No suggestions of what to write instead.
- Nothing is written into the chat; the operator decides (regenerate, edit, or dismiss).
- No change to how the book is read.

## Anti-goals

- A finding whose quoted words are not in the reply, or whose "earlier" words are not in the messages shown to the model.
- More than a few situation findings on one reply.

## Approaches

- A. Add the check to the existing call on the small checker model. Rejected: real judgment; a small model misses and invents.
- **B. Chosen by the operator.** Add the check to the existing call and change the checker's default model to the reading model (`mistralai/mistral-large-4-0`). One call per reply, as now; every check gains judgment; each call costs more.
- C. A separate call on the strong model for this check only. Rejected: two calls per reply and a second failure path for little saving over B.

## Design

1. **What the model sees.** The last 10 messages before the reply are always in front of the model (assistant's call: 10 covers the "they agreed to camp" and "they are at the door" range the operator described). The existing `SINCE THE BOOK WAS LAST READ` section is unchanged (it can hold 0 messages right after a reading, or `(too long to show)`). A new section `RECENT MESSAGES:`, placed before it, holds those of the last 10 messages before the reply that the SINCE section does not show: already-read messages when the backlog is short, all 10 when the backlog is too long to show, none when the SINCE section already holds the last 10. It is capped at 20,000 characters, the `[#N] ` prefixes counted, dropping the oldest messages first and, if the newest alone is longer, keeping its end (assistant's call). The chat's messages reach the checker from the live part (`view.messages`), as they did in an earlier, withdrawn version of the spelling fix. The player's own messages are included.
1a. **Every reply is checked.** Today the checker makes no call when the reply has no book fact to check and no name candidate. The situation check needs neither, so every reply that is not the player's makes one call (approach B's "one call per reply"). This adds a call on such replies.
2. **The answer block.** The prompt gains a fourth block, `=== SITUATION`, one line per clash: `the reply's own words | the earlier words they clash with`. And rule 7:
   `7. A situation clash is a statement in the REPLY that cannot be true given what the messages above establish: where the characters are, who is present, what they are doing or holding, the time, or what was just agreed or planned. Copy the reply's own words exactly, then the earlier words that establish the situation, exactly as a message above has them; each quote at most 40 words, from one sentence. Something the REPLY or a message above plainly changes (they walk to the table, the plan changes) is not a clash. Not style, not taste, not something you would have written differently. When in doubt, leave it out.`
   The receive and find lines and the block count in the prompt are updated to match.
3. **Checking the answer.** A situation line becomes a finding only when both quotes are found: the reply's words within one block of the reply and the earlier words within one of the messages shown (RECENT or SINCE), each compared after the same folding the leak check uses (case, whitespace, the apostrophe forms folded to one, and the double quotation marks `"` `«` `»` `“` `”` `„` `‟` `⹂` `〝` `〞` `〟` `＂` `『` `』` `﹃` `﹄` folded to one; other single quote forms are not folded), both sides folded. The earlier words are checked against each shown message's own words, never its `Speaker: ` or ` (player)` labels. Dress is stripped where the code strips it: each field loses one layer of outer wrapping (`**…**`, `*…*`, `_…_`, backticks; `***a***` keeps `*a*`, `**_a_**` keeps `_a_`, a `__…__` pair loses one underscore at each end; the first and last markers count as the wrap even when they belong to separate spans, so `*a.* b *c.*` shows as `a.* b *c.` while it still matches) and a `**` or `__` at its edges only when the field holds an odd number of that marker; the quote test itself also strips outer quotation marks of the forms `"` `'` `“` `‘` and `"` `'` `”` `’`, repeatedly (up to four passes), with outer dress and edge ellipses; other outer marks (`«»`, `„“`, `「」`) are not stripped. Each quote is at most 300 characters (the leak check's 120 is too short for a narrative sentence) and at least 2 words as `ScribeText.words` counts them, which splits contractions, `10pm`, `3rd` and the like into two; the minimum only stops one-word noise, and whether a short line really clashes is the model's judgment (operator, 2026-11-18). Lines failing either check are dropped. At most 3 situation findings per reply (`FindingsPerKind` stays for the other kinds) (assistant's call).
4. **The finding.** A new kind, `Situation`, using the existing fields: `said` holds the reply's words and `book` holds the earlier words; `subject`, `label`, `fact` and the others are null. Its dismissal key is the message and the reply words folded to words (case, punctuation and markup ignored, as for contradictions), so a dismissed clash stays dismissed when the model words the quote with other punctuation. It is never "spent" by a book change; it goes when dismissed or when its reply changes, like every finding.
5. **The panel.** Title `The reply doesn't fit what's happening`; text `The reply says "<said>"; earlier: "<book>".`; hint, while the finding is open, `If the reply should not stand, regenerate it.` (a new text; the existing leak hint mentions the reminder); one action, **Dismiss**. The header's findings count includes it.
5a. **No effect on the reminder.** A Situation finding never makes a reminder due and never leads one (only contradictions do today).
6. **The stronger model.** The checker's default model becomes `mistralai/mistral-large-4-0` (`ScribeKeeper` defaults). Rooms that already saved settings keep the model they saved; the operator changes it on the settings form for this room. The verification record notes the cost per check measured on the operator's room after the change.

## Tests that try to break it

See the plan, `docs/superpowers/plans/2026-11-18-scribe-story-logic.md`.

## Left to the builder

The exact folding helper reused from the leak check; where the 10-message fallback is cut; the order of Situation findings among the others in one reply (after spellings).
