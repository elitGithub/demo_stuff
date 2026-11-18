# Zeta Scribe: a chat profile draft for the main character, in place of the reminder line

Date: 2026-11-18
Status: direction approved by the operator on 2026-11-18 (approach A: "A, its easier and it really is just to reduce Frost's facts from the messages"); the calls marked "assistant's call" are open to their ruling.

## Why

Every Zeta room can have a chat profile attached: the player's own text, up to 2,000 characters, that Zeta gives the model with every turn. The operator now keeps one custom profile per room to hold the main character's facts, so they reach the model on every turn without being written into the messages.

Today the scribe does the opposite: it appends a line beginning `@: [Scribe]` to the player's message every few sends (the "reminder"), carrying the day, place, who is present and what they know. That line pollutes the chat. The operator wants the scribe to keep the profile's content instead: draft, from the book, the main character's lasting facts, and leave the posting to them.

The main character in the operator's campaigns is called Frost; the design uses that name for ease, but the scribe takes the name from the chat (the player's speaker name), never from a setting.

## Goal

A Profile tab in the panel shows a ready-to-paste chat profile for the main character, built from the book, at most 2,000 characters, with a Copy button. The `@: [Scribe]` reminder line is no longer added to messages.

## Non-goals

- The scribe never writes the profile to Zeta. No request to `user-chat-profiles` or `user-plot-chat-profiles`; the operator copies and pastes, and may edit before pasting.
- No model call to write the profile. No prose rewriting, no summarising.
- No change to how the book is read, to findings, to suggestions (**A development** and **Use** still send a chosen line with the next message), or to telling the scribe.
- No profile for any character other than the main character.

## Anti-goals

- A scene fact in the profile: where Frost is, what he is wearing or doing now, his passing condition.
- A secret written as if everyone knew it. Every fact the book holds as hidden appears marked as a secret.
- A text over 2,000 characters offered for copying.
- A fact that is not in the book, or a fact changed in wording.

## Constraints found in the code

- Facts carry `subject`, `category`, `target`, `targetText`, `text`, `hidden`, `told`, `widened`, `status`, `position` (`core/ScribeReplay.js`, `file()`). Only `status === InForce` facts count.
- Categories are already sorted by `core/ScribeCategory.js`: Fixed (`kind, age, eyes, hair, build, skin`), Moving (`status, location, role`, and `relation to X`), List (`aka, title, appearance, ability, belonging, background, trait, feature, rule`), Passing (`condition`).
- The player's name is `intake.player` (`core/ScribeIntake.js`), and `ScribeReminder.namesakes(state, player)` already finds the book subjects that carry it.
- The panel's Summary already orders a subject's facts (`PanelView.summary`).
- Findings texts mention the reminder: `GoesFirst` and `Regenerate` in `page/PanelView.js`.
- Operator law: no file is deleted without the operator's leave in this folder.

## Approaches

- **A. Built from the book, no model. Chosen by the operator.** A fixed layout of the main character's lasting facts, secrets marked, cut to 2,000 characters from the least important end. Free, instant, refreshed whenever the book changes, never invents or drops a fact silently. Reads as a sheet, not prose; the operator edits wording in Zeta.
- B. A model writes prose from the facts on request. Rejected: a call per draft, can drop or reword a secret, two drafts of one book differ.
- C. A, plus an optional model "Tighten" pass. Not now; can be added later if the sheet runs long.

## Design

### 1. Which subject

The main character is the book subject returned by `ScribeReminder.namesakes(state, intake.player)`. With none, the Profile tab says `The book has no entry for <player> yet.` With more than one (a look-alike not yet ruled), it says `The book has more than one <player>; rule the look-alike on the Rulings tab first.` and offers nothing to copy. With no player known yet (`UnknownPlayer`), it says `No message from the player has been read yet.`

### 2. Which facts

Facts of that subject with `status === InForce`, except categories `location` and `condition` (scene facts). Everything else stays: all Fixed and List categories, `role`, `status`, and relations.

Who knows a fact is `ScribeKnowledge.audience(state, fact)`, the same answer the Book tab shows as "known to". A fact is a **secret** when `hidden` is true and its audience is not Everyone. A secret fact is taken out of its category group and written in the secrets block (point 3), whatever its category.

A hidden fact whose audience does not include the main character (a fact about Frost that Frost does not know) is left out of the text, because the profile is read every turn as Frost's own and would hand the model knowledge the character lacks. Such facts are listed on the tab under `Left out: <label> does not know these:` (assistant's call).

### 3. The text

One line per group, in this order, which is also the order of importance (assistant's call):

1. Name: `<label>` and, when there are `aka` or `title` facts, ` (also called <a>, <b>)`.
2. Body: `kind`, `age`, `eyes`, `hair`, `build`, `skin`, then `appearance`, then `feature`, as `<Category>: <text>; <Category>: <text>.`
3. Standing: `role`, `status`, `ability`.
4. Secrets: one sentence per secret fact, each on its own line, no heading: `<label> keeps this secret and no one else knows it: <category>: <text>.` When the audience holds others besides the main character, the sentence becomes `<label> keeps this secret; of the others only <names> know it: <category>: <text>.`, names being those subjects' labels, the main character left out. (Assistant's call on the wording; it is the reminder's existing secret wording without "here".)
5. Relationships: `Toward <target name>: <text>.` per relation fact, all on one line, no heading; target name taken from the target subject's label, falling back to `targetText`.
6. Background, then `trait`, then `belonging`, then `rule`, as in point 2.

Within a category, facts keep book order (oldest `position` first). Fact text is written as the book has it, through the same cleaning the reminder uses for quoted text (`ScribeReminder.clean`: control and invisible characters removed, normalised), without quotation marks. Groups with no facts are left out. Lines are joined with a newline.

### 4. The 2,000-character limit

Length is the JavaScript string length of the final text (UTF-16 code units, the measure a browser text field's `maxlength` uses) (assistant's call; the operator confirms on the first paste whether Zeta counts the same). When the full text is longer than 2,000, whole facts are dropped from the end of the order in point 3 (last fact of group 6 first, up to group 2) until it fits; then, if it still does not fit, the `aka` and `title` facts of the name line, last first. The label alone is never dropped; a label is at most 60 characters (`ScribeReminder.Settings.LongestLabel`), so the label alone always fits. The tab then lists the dropped facts under `Left out to fit 2,000 characters:` so the operator can choose to swap them in by hand.

### 5. The Profile tab

A new tab, `Profile`, placed after `Summary` (assistant's call). It holds, in order:

- the headline `Chat profile for <label>` and `Built from the book as of message <read> of <total>.`, both from the keeper view;
- the text in a read-only, selectable box, with the count `<length> of 2,000 characters`;
- a **Copy** button that puts the text on the clipboard and says `Copied.` (or the browser's refusal);
- `New since your last copy:` and `Gone since your last copy:`, compared per fact (assistant's call: the operator edits the pasted copy in Zeta, so the scribe shows what changed rather than asking for a re-paste of everything). The unit is one fact's rendered piece (`<Category>: <text>` in a group line, or one secret or relationship sentence). New lists pieces in the current text not in the last copy, including a fact whose piece changed; Gone lists pieces in the last copy not in the current text. Both are empty and hidden when nothing changed, and before the first copy;
- the `Left out to fit` and `Left out: <label> does not know these` lists when they apply.

The text is rebuilt whenever the book view changes; it costs nothing. In a watching tab it shows the same text from the stored book; Copy works there too.

The last copy is stored per room as the list of rendered pieces, under its own store key, written on a successful Copy from any tab, reader or watcher: it records what the operator took, not the book, so the reader's claim does not guard it (assistant's call). **Start the book over** clears it.

### 6. The reminder line stops

- The scribe no longer prepares or sends the `@: [Scribe]` reminder. The send hook and the frame bridge keep carrying a chosen suggestion exactly as today.
- The `Sends between reminders` setting is removed from the settings form. A stored settings value that still carries it is accepted and the field ignored.
- The Findings tab's `With your next message` block shows only a chosen suggestion waiting to go, or nothing.
- Findings texts drop the reminder: `GoesFirst` becomes `Put the book's value in the chat profile, or rule it if the reply is right.`; `Regenerate` becomes `If the reply should not stand, regenerate it.`
- Old messages that carry an `@: [Scribe]` line are still lifted off when the book reads them, as today.
- No source file is deleted. If the reminder's code becomes unused apart from the helpers the profile uses, the builder reports which parts and the operator decides.

## Tests that try to break it

- A subject with facts in every category: the text has exactly the kept categories, in the order of point 3; `location` and `condition` never appear.
- A hidden fact in a Fixed category, a List category and a relation: each appears once, in the secrets block, never in its own group.
- A hidden fact widened to Everyone appears in its own group, not as a secret. A hidden fact told to two others names exactly those two, never the main character.
- A hidden fact about the main character whose audience leaves him out is not in the text and is listed under `does not know these`.
- Copy, then a fact's text replaced: that fact's new piece is under New and its old piece under Gone; nothing else is listed. Start the book over: both lists empty.
- Replaced, Ended, Expired, Disputed and Removed facts never appear.
- Text over 2,000 characters: the result is at most 2,000, the name line survives, the dropped facts are exactly those listed, and dropping one fewer would exceed the limit.
- Fact text with control characters, zero-width characters, a newline and quotation marks: the profile holds none of the control or invisible characters and stays one fact per sentence.
- No player, no subject, two subjects with the player's name: the three messages, and no Copy.
- Copy twice with one new fact filed between: `New since your last copy` lists only that fact's line.
- A send with no suggestion chosen leaves the player's message untouched; a send with a suggestion chosen adds it once, as today.
- The whole walk: after adoption the Profile tab holds the main character's sheet; no message sent during the walk carries `[Scribe]`.

## Left to the builder

Where the profile builder lives (a new `scribe/page/ScribeProfile.js` packed before `PanelView`, or inside `PanelView`); capitalising category names; the exact store key name; how the clipboard call is reached from the panel's closed shadow root.
