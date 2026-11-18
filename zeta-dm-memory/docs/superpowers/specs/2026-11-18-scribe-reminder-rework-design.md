# Zeta Scribe: the reminder, reworked

Date: 2026-11-18
Status: requirements decided by the operator on 2026-11-18 across the session (quoted below); approaches and calls marked "assistant's call" are open to their ruling.

## Why

The operator's reminders from 2026-11-18, room `/en/rooms/45359def-...`:

```
[Scribe] Day 1, "Frost's apartment", private. Present: Frost, Thessaly, Veyra, Selene. Frost keeps this secret and no one here knows it: background: "knows a Malachai connected to the Staff of Elders". Thessaly, eyes: "teal". Thessaly, hair: "silver". ...
```
"Frost keeps WHAT a secret?"

```
[Scribe] Day 1, "Frost's apartment", private. Present: Frost.
```
sent under the operator's own message that moved the story to the next day at the east gate.

```
[Scribe] Day 2, "Ashenmaw Ruins", private. Present: Frost, Mavan the Gray, Thessaly, Veyra, Selene. Of those here only Thessaly, Veyra and Selene know this about Frost, the others do not: eyes: "blue-gray". ...
```
"It makes no mention of clothing ... Otherwise it resets to stuff like 'you're wearing pajamas' but he's NOT. The appearance part is pointless, it lives in the profile."

And: "Zeta keeps making up places" (the reply line "You the F-rank they sent to the Ashenmaw job?" belongs in the reminder); "every 6 unless I mark it ... every 6-10 is enough unless I force it"; "a character can go from '42, stocky, red hair' to '20, tall, black hair' in six messages"; story NPC changes "HAS to be added (... new weapons, a new feature like a scar or a piece of clothing)"; "I can't edit it."

## What the operator decided

1. **Spacing.** A reminder goes every N sends (the existing `Sends between reminders` setting, default 6; the operator uses 6 to 10), and only then, unless the operator forces one with the next message. No early reminders for a scene change, a contradiction or a new finding.
2. **No scene line.** No day, no place, no "Present:" list from before the player's message.
3. **The main character's lasting facts stay out** (they are in the chat profile). What he is wearing now goes in.
4. **Clothing, always.** What each character present is wearing now.
5. **Story NPCs:** only what the chat added or changed beyond the writer's description (new weapons, a scar, clothing). **Custom characters:** their looks and lasting facts.
6. **The current job or destination** and the established places it involves.
7. **Facts the operator filed lead** while that character is present.
8. **Plain sentences.** No category labels, no quoted fragments, one sentence of looks per person, each secret a whole sentence saying what is known and by whom.
9. **Visible things are not secrets.** Eyes, hair, build, skin, appearance, features and clothing are known to anyone who can see the character.
10. **Editable before it goes.** The waiting reminder can be edited and cleared.
11. **Looks caught from the very reply** that describes them, not at the next reading of the book (which can be 40 messages behind).

## Goal

Every Nth send, or when forced, the player's message carries one short `@: [Scribe]` line that tells the model what the book knows and the model is likely to get wrong: who is wearing what now, how the people present look when that is not already given by the writer or the profile, who knows which secret, and what the party is doing and where. Nothing stale, nothing the model already has, readable as prose.

## Non-goals

- World facts riding with their topic (backlog item 9), nudges (item 8), the chat profile draft (item 3): separate pieces.
- No change to how the book is read in stretches.

## Approaches for catching looks and clothing from the very reply (decision 11)

- **A. Assistant's pick.** The checker call that already runs on every reply (large model, last 10 messages in view) gains one more answer block, `=== NOW`, giving, from the reply and the recent messages, what each character present is wearing now and how any character the book does not know yet looks. These "live notes" feed the reminder until the book's next reading files them properly. No extra call; the checker already reads the right messages.
- B. Read the book in smaller stretches (10 instead of 40). More calls, more cost, and still up to 10 messages late.
- C. A separate model call per reply for looks only. Extra cost and a second failure path for what A gets in the existing call.

## Design (assuming approach A)

1. **When a reminder goes.** `ScribeLive` makes a reminder due only when `sends >= refresh` or when the operator pressed **Send a reminder with my next message**. The scene-change, contradiction and found-change triggers are removed. A due, unedited reminder is prepared after each reply as today and goes with the next send. A reply's contradictions still lead the next reminder that goes (the book's value first), but no longer make one go early.
2. **Live notes from the checker.** The checker prompt gains `=== NOW` with lines `Name | wearing | what they wear now` for every character present in the reply whose clothing the REPLY or the messages above state, and `Name | looks | how they look` for any character whose looks they state. Rule: only what is stated; nothing guessed; at most 12 lines; names as the messages write them. A line is kept only when its name appears in the reply or the shown messages, its text is at most 120 characters and holds none of `[`, `]`, `@`. `review` returns `{ findings, notes }`; the cached-check path (`record.checked`) stores and reloads the notes with the findings. Notes are stored per room in the live record by name and kind with the message they came from; a newer note replaces an older one; a regenerated or edited reply drops the notes it gave. **Wearing notes are kept until replaced** (they carry across nights and readings); **looks notes are dropped once the book's last read position passes their message** (the book now holds those looks). When the checker is skipped (budget spent, model refused), the stored notes stand and nothing new is added.
3. **Clothing comes only from wearing notes** (assistant's call). The book files clothing as a `condition` (Passing), mixed with wounds and moods, expired at every night and hidden from the reminder while unread messages exist, so it is both stale (the pajamas) and usually absent. No wearing note for a person: no clothing for them (nothing beats stale).
4. **Who is present.** The scene's present list at the newest message (`ScribeScene.now`, unchanged). The main character is found as today (`namesakes` of the player name); unresolved, his line is left out. (Send-time additions from the typed message are dropped: the chat frame never sends the typed text to the page.)
5. **Story NPC or custom.** Once per room, the scribe reads `GET /v1/rooms/:roomId` (the room page itself makes this request) with the page's own login to learn the plot id, then `GET /v1/plots/:plotId` for the story's characters (assumed: a `characters` list with `name` and `description`). A book subject of kind character is a story NPC when its label, name or an aka, normalised, equals a story character's name or one begins with the other's words (`Mavan` and `Mavan the Gray`). Others are custom. Unreadable (wrong shape, error): everyone is custom and the Progress tab says so once per room.
6. **What goes in, per person present.**
   - The main character: his wearing note only (his lasting facts and secrets are in his chat profile).
   - Everyone else: their wearing note; their looks (non-hidden in-force facts of `age`, `eyes`, `hair`, `build`, `skin`, `appearance`, `feature`, plus their newest looks note) when custom, or, when a story NPC, only those looks facts whose content words are not all in the writer's description.
   - Looks are stated plainly, never as "only X knows". A hidden looks fact (a covered scar) is a secret (point 7).
7. **Secrets.** For each hidden in-force fact about a present person other than the main character, whose audience is not everyone present, one sentence: `<Name> secretly <clause>; only <names> know.` or `<Name> secretly <clause>; no one else here knows.` The main character counts among those present for audience. The leak and `told` machinery is unchanged.
8. **The job and the places.** The newest open thread (by position) whose text contains the name of a place-kind subject (normalised), as `The party: <thread text>.`, plus up to 2 places it names, each `<Place>: <its newest in-force location, appearance or feature fact>.` No such thread: the newest open thread alone, without places. None open: nothing.
9. **Order and the cap.** Deterministic, no model call when preparing (assistant's call; the old chooser and its 8-entry cap go): corrections from contradictions first, then wearing, then secrets, then facts the operator filed, then looks, then the job and places. The line is capped at 1,000 bytes (today 600); over the cap, whole sentences are dropped from the end of that order. Each fact text keeps today's guard (at most 200 characters, no `[`, `]` or `@`).
10. **Wording.** One line, `@: [Scribe] ` then sentences. Per person: `Thessaly wears a dented breastplate and a travel cloak; teal eyes, silver hair, tall.` Category names never appear; fact texts are joined as clauses; quotation marks only for spoken words.
11. **Editable, explicitly** (revised 2026-11-18 by the operator after review: a box that saved as it was typed had to guess intent from focus and composition events). The Findings tab's **With your next message** block shows, read-only, exactly the line that will go (or why none will). **Edit** opens it for typing; **Cancel** (left) closes it and changes nothing; **Save** (right) stores the typed line as the operator's edit; saving an empty line is Clear when a line was shown, and changes nothing when none was. While the box is open the scribe keeps working underneath; the typed text replaces the line only on Save. Once saved, nothing replaces the edit (no new reply, book change, note or regenerate) until it is sent or cleared. **Clear** skips this reminder; the send counter resets either way.
12. **The button.** **Send a reminder with my next message** prepares one now from the current book, notes and present list (if none is waiting) and marks it to go with the next send regardless of the counter. It is disabled, with the reason, while the book is not trusted (no book, not read, held).
13. **Storage.** New fields in the live record (notes, edited text, forced flag) get explicit loaders; records saved by the old version load with them empty.

This task runs after the panel fix is committed; it owns the Findings tab's reminder box.

## Tests that try to break it

To be listed in the plan: the operator's three reminders above as fixtures (no day/place line, no Frost lasting facts, clothing present, no category labels, no "only X knows his eyes"), spacing at N with and without a scene change, the force button, edits surviving a book change, story NPC vs custom with the plot readable and unreadable, live notes kept, replaced and dropped after a reading, the 1,000-byte cap and the chooser order.

## Left to the builder

Clause wording of each category; where live notes are stored inside the live record; the exact plot-response field names after the first real read (fallback: custom).

## Needs the real page

The shapes of `GET /v1/rooms/:roomId` (where the plot id sits) and `GET /v1/plots/:plotId` (assumed: a `characters` list with `name` and `description`, seen in Zeta's own code, never called by the scribe); whether Zeta accepts a 1,000-byte line in a message.
