# Plan: Zeta Scribe reminder rework

Design: `docs/superpowers/specs/2026-11-18-scribe-reminder-rework-design.md` (approach A, approved by the operator 2026-11-18). Three tasks, one commit each, built and reviewed one at a time in this order. The next task is proposed only after the operator commits the one before it.

All paths are relative to `zeta-dm-memory/`. The plan is written against the code as it stands, including the uncommitted token-cap change in `scribe/page/ScribeBoot.js` (`MaxTokens.Scribe` and `MaxTokens.Pedant` at 4000), which no task touches.

Code laws for every task: tag-only docblocks on every method (including arrow callbacks, as the files do now); braces always; no single-letter names; every value in a `Settings` object; code lines at most 120 columns (a prompt sentence in `PromptLines` stays one string, as the existing prompt lines are); no emojis; one declaration per purpose; no single-use wrappers; changes through the Edit and Write tools only; git read-only; no file is deleted without the operator's leave (removing code inside a file is not a deletion).

## Open questions for the operator

Each has a proposed resolution that the tasks below assume. A different ruling changes only the step named. Resolved 2026-11-18: the operator approved the plan with every proposed resolution below.

1. **Order versus one sentence per person (design points 9 and 10).** Point 9 orders the line corrections, wearing, secrets, filed facts, looks, job, and drops whole sentences from the end. Point 10's example puts one person's wearing and looks in one sentence (`Thessaly wears ...; teal eyes, silver hair, tall.`). Both cannot hold literally: if wearing and looks share a sentence, looks cannot be dropped before secrets without dropping the wearing too. **Proposed:** the order decides what survives the cap; the rendering then joins a person's surviving wearing and looks into the one sentence of point 10, placed where the wearing stands. Pieces are dropped one at a time from the end of the order (places, job, each person's looks from the last person back, filed facts, secrets, wearing, corrections) and the line is rendered again after each drop. A person with looks but no wearing note gets a looks-only sentence after the filed facts. (Task 3.)
2. **What is in the box must still be the scribe's own line (point 11).** The book lifts a reminder off the player's message only when the line starts with `[Scribe]` and is one line (`ScribeIntake.own`, used by `ScribeIntake.read`); otherwise the next reading files the reminder as the player's words. "What is in the box is what goes" cannot hold for a box the operator empties of its marker or breaks over lines. **Proposed:** the stored edit is the box text collapsed to one line, a typed leading `@:` removed, and `[Scribe] ` put in front when missing; the box shows the stored line once it loses focus. Also: (a) an emptied box (or one holding only the marker) acts as **Clear** for the reminder (the suggestion is kept); (b) an edit over 2,000 bytes is refused under the box and the last accepted text stays stored (a message is at most 4,500 bytes with the player's words, and `ScribeSender.compose` drops the reminder first when it does not fit); (c) text typed into an empty box goes with the next send whatever the counter says, since typing it is the operator's own act, like the button. (Task 1.)
3. **Where the plot id sits (point 5, "Needs the real page").** The shape of `GET /v1/rooms/:roomId` is unknown, so no field name can be grounded. **Proposed:** read the plot id from `plotId`, then `plot.id` (a list in `ZetaSource.Settings`, so a correction is a one-line change); anything else is unreadable, so everyone is custom and the Progress tab says why. The operator can open the room page's own `GET /v1/rooms/<id>` in the browser's network tab before Task 3 is built and give the real path. (Task 3.)
4. **Corrections about the main character (points 1 and 3).** Point 1 keeps a reply's contradictions leading the next reminder; points 3 and 6 keep the main character to his wearing note. **Proposed:** a correction leads for anyone present, the main character included: it is what the reply just got wrong, not a lasting fact restated. (Task 3.)
5. **A story NPC's looks note (point 6).** The looks note is listed only under custom characters. **Proposed:** a story NPC's newest looks note goes in only when its content words are not all in the writer's description, the same test as his looks facts. (Task 3.)
6. **"Facts the operator filed" (point 7 of the decisions, point 9 of the design).** **Proposed:** facts whose `origin` is `Operator` (Add a fact, rulings) or `Notes` (Tell the scribe, and notes pasted into the player's messages). (Task 3.)

## Task 1: spacing, the force button, the editable reminder, and their storage

Design points 1, 11, 12 and 13 (the edited text and the forced flag). The reminder's content and wording stay as they are today (`ScribeReminder` is not touched).

### Files

- `scribe/page/ScribeLive.js`
- `scribe/page/ScribePanel.js` (Findings tab builder and drawer, Settings words and ids)
- `scribe/page/PanelStyle.js` only if the box needs a rule the Tell box does not already give it
- `tests/scribe-live.test.mjs`, `tests/scribe-panel.test.mjs`, `tests/scribe-whole.test.mjs`, `tests/support/PanelLive.mjs`
- `scribe/scribe.user.js`, rebuilt with `node scribe/pack.mjs`
- `docs/verification/scribe-page-verification.md`: a dated paragraph with counts

### Changes in `ScribeLive.js`

How it works today: `consider` (line 825) makes a reminder due when the scene came back changed, when the reply raised a new contradiction (`draft.contradicted`), when `record.sends >= view.settings.refresh`, when `record.reminded` is not the current scene, or when a waiting reminder no longer `holds`. `view` (line 1482) reports `due` as `sends >= refresh || !ScribeScene.same(reminded, now)`. `record.ready`, `led`, `basis`, `reminded` and `sends` are created and loaded in `load` (lines 296-332), set by `keep` (line 717), cleared by `went` (line 1040), `clear` (line 1173) and a new edition in `active` (line 449). `lines` (line 1011) offers `ready` only while `fresh`; `went` (line 1059) resets `sends` to 0 when the reminder went and adds 1 otherwise.

1. **Settings.** `LongestEdit: 2000` (bytes, open question 2). `Messages` gains `NoBook: 'No book yet: adopt this chat first.'`, `NotRead: 'The book has not finished its first reading.'`, `LongEdit: 'A reminder may be at most 2,000 bytes; nothing was saved.'`.
2. **Record fields.** `edited: string|null` (the operator's line, already normalised) and `forced: boolean`, created in `load` beside the others. Loaders: `edited` is kept only when it is a string that `ScribeIntake.own` accepts, holds no line break, has something after the marker and is at most `LongestEdit` bytes; otherwise `null`. `forced` is `saved.forced === true`. A record saved before this task loads with `edited: null, forced: false`.
3. **`due(record, keeperView): boolean`** returns `record.forced || record.sends >= keeperView.settings.refresh`. It replaces the due tests in `consider` and `view`.
4. **`going(live, keeperView): string|null`** is the line that goes: `record.edited` when not null; otherwise `record.ready` when `due` and `fresh`; otherwise null. `lines` uses it (after its existing trust checks) instead of `fresh(...) ? record.ready : null`; `view` reports `ready: going(...)`, so the panel box and the sent line are the same text.
5. **`consider`.** `due` becomes `record.edited === null && ScribeLive.due(record, view)`; the scene-change, `draft.contradicted` and not-holding terms go. After the awaits, the made reminder is kept only when `record.edited === null` and `due` still holds (a Clear or a send while the reply was being checked must not bring it back). `merged` returns the findings array only; its `contradicted` result goes, as nothing reads it.
6. **`keep`** returns at once while `record.edited !== null`, so no path (`consider`, `refresh`, `force`) replaces or clears an edited reminder. `refresh` returns early when `record.edited !== null` or the reminder is not due; `view` sets `live.refreshing` only for an unedited, due, not fresh `ready`.
7. **`skip(record): void`** clears the reminder: `ready = null`, `led = []`, `basis = null`, `edited = null`, `forced = false`, `sends = NoSends`. `clear` calls it and still clears `suggestion` (as today); an emptied edit calls it and keeps the suggestion.
8. **`edit(live, text, shown): void`** (handle: `edit(text, shown = null)`). Returns when `!active(live)`. Normalises per open question 2: `ScribeIntake.collapse`, strip `ScribeIntake.Settings.OwnLead`, put `OwnMarker + ' '` in front when `!ScribeIntake.own(line)`. Nothing after the marker: `skip`, save, announce when `shown` is true (a line was shown when the operator pressed Edit; `shown` null means "a line is ready now"), and no change when it is false. Over `LongestEdit` bytes: throw `Error(Messages.LongEdit)` and change nothing. Otherwise `record.edited = line`, `record.led = []` (the edit may have removed a correction, so nothing is marked as reminded by it), save and announce (the announce re-arms the chat frame through the boot's `notify`).
9. **`went`.** The reminder went when `lines.ready !== null && lines.ready === (record.edited ?? record.ready)`; then `ready`, `led`, `basis`, `edited` clear and `forced` becomes false; `sends` resets as today. Led contradictions are marked Reminded as today (an edited reminder has `led` empty).
10. **`forceBlock(live): string|null`**: `distrust(live)` when the live part is not active (Watching, Unread); else from the keeper view, `NoBook` when `booked` is not true, the keeper's `problem` when `trusted` is not true and a problem is set (held, mismatch, partial), `NotRead` when `trusted` is not true otherwise; null when trusted.
11. **`force(live): Promise<void>`** (handle: `force`). Returns when closed; throws `Error(forceBlock)` when blocked and `Error(Messages.Busy)` while `live.forcing`. Sets `record.forced = true`, saves and announces. When `record.edited` and `record.ready` are both null, prepares one now with `remind(live, view, record.now, record.findings, noted)` (today's `remind`, unchanged) and keeps it when the epoch is current, the book is trusted, it holds against the latest view, and the record is still unedited; then reports the model failure as `refresh` does, saves and announces. With no scene yet (`record.now === null`) nothing is prepared and `forced` stays, so the next reply prepares it.
12. **`view`** gains `due` (from point 3), `edited: record.edited !== null`, `prepared: record.ready !== null` (so the panel can say a line waits for a held book), `forced`, `forceBlock`.
12a. **A forced reminder always ends with a line.** When `consider` ends without keeping a line while `record.forced`, `record.ready` and `record.edited` are empty and its own compose was discarded or not attempted, it sets `live.refreshing`; `refresh` then also runs when `record.ready` is null and `record.forced` with a scene (it still returns while edited, not due, or refused), so the forced reminder is made on the latest revision. A compose that returns nothing does not re-arm.
13. **A new edition** (`active`, line 449) keeps `edited` and `forced` (the design: nothing replaces an edited reminder until it is sent or cleared); `ready`, `led`, `basis` and the rest reset as today.

### Changes in the panel

- `ScribePanel.Settings`: `Ids.Reminder: 'scribe-reminder'`, `Ids.Force: 'scribe-force'`, `Ids.ForceReason: 'scribe-force-reason'`, `Ids.ForceOutcome: 'scribe-force-outcome'`, `Ids.ReminderOutcome: 'scribe-reminder-outcome'`; `Outlets.Force: 'force'`, `Outlets.Reminder: 'reminder'`; `Attributes.Placeholder: 'placeholder'`; `Words.ReminderLabel: 'Reminder'`, `Words.NothingWaiting: 'No reminder is waiting.'`, `Words.PreparedLater: 'A reminder is prepared after the next reply.'`, `Words.Force: 'Send a reminder with my next message'`, `Words.Forced: 'It goes with your next message.'`. `Words.Reminder` (the row prefix) goes with the row.
- **`Builders.Findings`** (line 1759), in the **With your next message** group: a textarea built once with `ScribePanel.field(panel, InputTypes.Area, Words.ReminderLabel, Ids.Reminder, false, false)` and `own(panel, 'Reminder', ...)`, `maxlength` not set (the limit is in bytes; open question 2); its outlet `ReminderOutcome`; the `Queued` pager now lists only the suggestion; one actions row with **Clear** on the left and **Send a reminder with my next message** on the right (primary class), the force outlet under it, then the reason paragraph `ForceReason` (hidden when empty).
- The box is read-only unless open (revised 2026-11-18, design point 11). Under it one actions row holds **Edit** (shown while closed), **Cancel** and **Save** (primary, rightmost; shown while open). `Edit` stores `panel.editing = true` and `panel.editShown` (a line was shown), fills the box with the shown line and focuses it; while `panel.editing` the drawer never writes the box's value. `Cancel` closes it and changes nothing. `Save` calls `panel.live.edit(box.value, panel.editShown)` once and closes the box; a thrown refusal is written to the `Reminder` outlet and the box stays open. `Clear` closes the box. There is no `input`, `focus` or `blur` handling for the box.
- **`Drawers.Findings`** (line 3370): unless `panel.editing`, the box's value is `live.ready ?? ''`; the placeholder is `EditHeld` for a stored edit not shown, `HeldReady` ("Your reminder goes once the book is ready.") when the book is held and the reminder is forced or due and prepared, `PreparedLater` when `live.forced` and nothing is waiting, else `NothingWaiting`; the force outcome, once it reads `Forced` or `PreparedLater`, follows the state (`Forced` when a line is ready, an edit is stored, or the book is held with a line prepared; `PreparedLater` otherwise; empty when not forced); the box, Edit, Save and the force button are disabled while `live.forceBlock !== null`, and `ForceReason` shows that reason. The force button is built with `Guard.Free` and its disabled state is set here (pending included), because `lock` would otherwise overwrite it as it does every Change control; `lockAll` disables it as well. Pressing it runs `perform` with outlet `Force`, pending `Words.Working`, and done `Forced` when `live.view().ready` is then non-null, else `PreparedLater`.
- `redraw` (line 2099) carries `forced`, `edited` and `forceBlock` from the live view beside `ready`.
- `tests/support/PanelLive.mjs`: `edit(text)` notes the call; `force()` answers like `suggest`.

### Left to the builder

The exact sentence of the box's label and placeholders within the words above; whether `edit` saves on every keystroke or keeps memory current at once and saves on the next tick (the line in memory and the frame's arm must be current before the next `pointerdown` either way).

### Tests that try to break it

`tests/scribe-live.test.mjs`:
- Spacing, refresh 3: the first reply (a new scene, a contradiction) prepares nothing and makes no chooser call; a scene change at 1 and 2 sends prepares nothing; at 3 sends the next reply prepares one with no scene change; it goes with the next send and `sends` is 0; the reply after that, with a scene change, prepares nothing.
- A contradiction at 1 send makes nothing go; at the count the reminder leads with the book's value and `led` holds the fact; it is marked Reminded only once it went.
- Force: at 0 sends with a scene, `force()` prepares one, `due` and `forced` are true, `lines().ready` is it, the send resets `forced` and `sends`. Force while one waits makes no model call. Force with no scene prepares nothing and the next reply does. Force twice at once: the second throws Busy. Force with no book, an unread book, a held book (mismatch, partial) and on a watching tab: throws, and `forceBlock` gives `NoBook`, `NotRead`, the keeper's problem and `Watching` respectively; `lines()` stays empty in each.
- Edit: the edited line is what `view().ready` and `lines().ready` give; a new reply at the count, a regenerated reply, a book change (revised state) and `refresh` leave it unchanged, with no chooser call; it survives a reload and a new edition; the send clears it and resets `sends` and `forced`; Clear clears it and the suggestion and resets `sends`.
- Normalising: a line break is collapsed; a missing marker is added; `@: [Scribe] x` and `  [Scribe] x` store `[Scribe] x`; `[Scribe]` alone and spaces alone act as Clear and keep the suggestion; `[Scribe]x` gains the marker in front (it is not an own line); 2,000 bytes are kept and 2,001 bytes (including a multi-byte character at the edge) throw and keep the previous text; every stored edit passes `ScribeIntake.own` and, read back through `ScribeIntake.read` as the end of a player message, is lifted off.
- A Clear or a send while a reply is being checked: the reminder that check makes is not kept.
- Storage: a record saved without `edited` and `forced` loads with null and false; `edited: 5`, `edited` with a line break, `edited` without the marker, `forced: 'yes'` each load as null or false.
- Existing tests that relied on the first scene making a reminder ready (`the first scene and a changed scene make a reminder ready`, `the refresh count makes a reminder due`, `lines offers what may go`, `went marks only what went`, `a reminder goes out only if it is still true`, `a contradicted fact goes first`, `reminded when it went out` and the others that read `view().ready` after one reply) start with `live.force()` or a saved record at the count, and keep proving what they proved; each changed test is listed in the report with why.

`tests/scribe-panel.test.mjs`:
- The box is read-only and shows `live.ready`; Edit opens it prefilled; typing calls nothing; Cancel changes nothing; Save calls `edit(text, shown)` once and closes it; Save of an empty box passes `shown` true when a line was shown at Edit and false otherwise; while it is open a reply and a rebuild leave the typed text alone and Cancel then shows the new line; Clear closes it; a refused save keeps it open with the typed text and says the words under it.
- Clear is left of the force button in one row; the force button is the last action; pressing it shows `Working...` at once, then `Forced` or `PreparedLater`; a failure shows in its outlet.
- With `forceBlock` set, the box and the button are disabled and the reason shows; with it null both are enabled and the reason is hidden; a pending press keeps the button disabled through a redraw.
- The queued list holds only the suggestion; `findings act through the live part` and `everything is locked while the keeper is busy` read the box instead of a `Reminder:` row.
- Phone width: the Findings tab, box and both buttons, has no horizontal scroll (the narrow-width check, extended).

`tests/scribe-whole.test.mjs`: the walk presses **Send a reminder with my next message** where it expects the first reminder after adopting (step 4 and the steps that build on it); a step proves that without the press nothing goes before the count; each step keeps proving what it proved.

### Commands (each file alone, under the memory limit from the README)

```
NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 120 node --test --test-timeout=20000 tests/scribe-live.test.mjs
... scribe-panel, scribe-whole, scribe-pack
node scribe/pack.mjs
```

### Done when

All four files pass, `scribe/scribe.user.js` is rebuilt, and the verification record has the counts.

## Task 2: live notes from the checker

Design point 2, with its storage (point 13). The notes are gathered and stored; nothing reads them for the reminder until Task 3.

### Files

- `scribe/page/ScribePedant.js`
- `scribe/page/ScribeLive.js`
- `tests/scribe-pedant.test.mjs`, `tests/scribe-live.test.mjs`, `tests/scribe-whole.test.mjs` (only where the prompt or a call expectation changes)
- `scribe/scribe.user.js`, rebuilt
- `docs/verification/scribe-page-verification.md`: a dated paragraph with counts

### Changes in `ScribePedant.js`

1. `Note: Object.freeze({ Wearing: 'Wearing', Looks: 'Looks' })` beside `Kind`; `Block.Now: 'NOW'`.
2. `Settings`: `NoteWords: { wearing: 'Wearing', looks: 'Looks' }`, `NoteFields: 3`, `NoteNameField: 0`, `NoteKindField: 1`, `NoteStart: 2`, `MostNotes: 12`, `LongestNote: 120`, and a getter `NoteForbidden` returning `/[\[\]@\p{Zl}\p{Zp}\p{Cc}]/u`.
3. **Prompt.**
   - The find line becomes: `Find where the REPLY disagrees with the LEDGER, where a speaker uses something they do not know, which NAME CANDIDATES are misspellings, where the REPLY does not fit what the messages above establish, and what the characters wear and look like now.`
   - `Answer with these four blocks` becomes `Answer with these five blocks`.
   - After the SITUATION example: `=== NOW`, `Name | wearing | what they wear now`, `Name | looks | how they look`.
   - Rule 8, after rule 7: `8. NOW: for each character present in the REPLY whose clothing the REPLY or the messages above state, write one wearing line with what they wear now; for any character whose looks the REPLY or the messages above state, write one looks line. Only what is stated; never guess. At most 12 lines. Write each name as the messages write it.`
4. **Parsing.** `parse` returns `{ contradictions, leaks, misspellings, situations, now }`. The NOW branch runs where the SITUATION branch does and the same way: `none` or `(none)` lines skipped; a line with at least `NoteFields` pipe fields becomes `{ name, kind, text }` (name and kind each undressed with `undress`, kind lowercased with a trailing colon dropped, text the rest joined with `Joiner` and undressed); other lines skipped with the block left open. Existing tests that deep-equal a parse result gain `now: []`.
5. **`noted(message, lines, shown): readonly object[]`**, called by `review` with the shown messages it already builds for `situated`. A line is kept only when: its kind is a key of `NoteWords` (mapped to `Note`); its name has a letter and, folded, `holds` in a folded block text or a folded speaker name of the reply or a shown message; its text is non-empty, at most `LongestNote` characters (code points) and does not match `NoteForbidden`, nor does the name. A repeated (normalised name, kind) keeps the first. At most `MostNotes` kept, in answer order. Each is frozen `{ name, kind, text }`.
6. **`review`** returns `Object.freeze({ findings, notes })`; a player message returns both empty. The findings are what it returns today, in the same order.

### Changes in `ScribeLive.js`

1. **Settings** `NotesKept: 100`.
2. **Shape.** `record.notes`: `{ name, kind, text, message, fingerprint, position }`, at most one per (normalised name, kind). Validators `note(value): object|null` (kind among `ScribePedant.Note`, texts non-empty, position a safe integer) and `notes(value): object[]` (not an array gives `[]`, bad items dropped), as `finding`/`findings` do. `load` reads `record.notes = notes(saved.notes)`; a record without notes loads with `[]`.
3. **`noted(notes, given, message): object[]`**: drops the notes of `message.id`, then each given note replaces the stored note with the same normalised name and kind when its position is the same or newer (an older reply checked later does not replace a newer note), and is added otherwise; at most `NotesKept`, newest by position kept.
4. **`standing(notes, keeperView): object[]`**: `pruned(notes, keeperView.messages)` (a regenerated reply's notes go: its id is gone; an edited reply's go: its fingerprint changed), then looks notes whose position is at or before `keeperView.lastRead.position` are dropped (the book now holds those looks); wearing notes stay until replaced. `lastRead` null drops nothing. `active` applies it beside the findings prune, in the same try, and saves when the list changed.
5. **`consider`.** The review result gives `raised = reviewed.findings` and `notes = reviewed.notes`; the cached path gives `remembered.findings` and `remembered.notes`. When the checker did not run or threw (budget spent, model refused, refusal returned early), `notes` stays null and the stored notes stand. After the findings merge: `record.notes = noted(standing(record.notes, latest), notes, message)` when `notes` is not null. The cached entry stores `notes` in the full shape; `load` reads an entry's notes with `notes(entry.notes)`, an entry without notes (or a non-array) loading with `[]` and staying usable.
6. A new edition keeps `record.notes` (they come from the chat, not the book, and carry their own message, fingerprint and position).

### Left to the builder

Where `noted` folds the speaker names; whether `standing` and the findings prune share one save. A consequence to state in the report: a regenerated reply drops its notes, and a note it had replaced is not brought back (replacement is literal; the new reply's check usually restates the clothing).

### Tests that try to break it

`tests/scribe-pedant.test.mjs`:
- The prompt fixture is updated and compared whole: the find line, `five blocks`, the NOW example lines and rule 8 exactly.
- Parse: NOW lines with `wearing` and `looks`, `Wearing:`, bold, backticks and table edges; a two-field line skipped; four fields (text joins the rest); `(none)`; NOW before and after the other blocks; MISSPELLINGS then `=== NOW` switches.
- Kept or dropped: a name only in an older message outside RECENT and SINCE dropped; a name only as a speaker label kept; a name not in the messages at all dropped; text of 120 code points kept and 121 dropped (an astral character at the edge); `[`, `]`, `@` in the text or the name dropped; an unknown kind dropped; 13 valid lines give 12; a repeat keeps the first.
- `review` returns `{ findings, notes }`; a player message gives both empty; every existing `review` test reads `.findings` and keeps its expectations.

`tests/scribe-live.test.mjs`:
- A scripted checker answer with NOW lines stores notes with the reply's id, fingerprint and position; they survive a reload.
- A newer reply's wearing note for the same name replaces the older; a reply checked out of order (older position) does not replace a newer; names differing only in case or a leading `the` are one name.
- A regenerated reply drops the notes it gave; an edited reply drops them and its new check adds the new ones.
- `lastRead` moving to the note's message drops a looks note and keeps a wearing note across it and across a night (a later scene of another day); the record is saved.
- Budget spent, the checker refusing, the checker failing: the notes are unchanged and no call is made where none was before.
- The cached path: the same reply seen again at the same revision restores its notes with no call; an entry saved before this task (no notes) is still used and gives none.
- 101 distinct names give 100, the newest kept; junk notes in storage (wrong kind, no position, a number for a name) are dropped one by one.

`tests/scribe-whole.test.mjs`: only prompt-dependent expectations change, listed in the report.

### Commands

```
NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 120 node --test --test-timeout=20000 tests/scribe-pedant.test.mjs
... scribe-live, scribe-whole, scribe-pack
node scribe/pack.mjs
```

### Done when

All four files pass, the userscript is rebuilt, and the verification record has the counts. After the operator installs it, one real check's NOW lines are noted in the verification record from the Progress tab's last calls.

## Task 3: the new content and wording

Design points 3 to 10, with the story read of point 5.

### Files

- `scribe/page/ScribeReminder.js` (rewritten inside the file)
- `scribe/page/ScribeLive.js`, `scribe/page/ZetaSource.js`, `scribe/page/ScribeBoot.js` (the story option only)
- `scribe/page/ScribePanel.js` (the Progress notice)
- `tests/scribe-reminder.test.mjs`, `tests/scribe-live.test.mjs`, `tests/scribe-zeta.test.mjs`, `tests/scribe-boot.test.mjs`, `tests/scribe-panel.test.mjs`, `tests/scribe-whole.test.mjs`, `tests/support/FakeZeta.mjs`, `tests/support/WholeSite.mjs`
- `scribe/scribe.user.js`, rebuilt
- `docs/verification/scribe-page-verification.md`: a dated paragraph with counts

### Changes in `ZetaSource.js`

How it works today: `exchange(request, cursor)` (line 527) builds the messages address, sends it with `request.fetch` and the `Authorization` header, races `wait(request, TimeoutMs)`, maps statuses to failures (`TooMany` and server errors retryable) and parses JSON; `page` (line 622) retries it up to `Tries`; `ready` (line 492) refuses a missing token or room.

1. **`get(request, path): Promise<{ status: number, body: * }>`**: the reach, timeout, status and JSON steps of `exchange`, moved unchanged, for any path under `ApiOrigin`. `exchange` calls it and keeps its own checks of `body.messages` and `nextCursor`.
2. **`retried(request, read): Promise<*>`**: the loop of `page`, moved unchanged; `page` calls it.
3. **`plotOf(body): string|null`**: the first of `Settings.PlotIdPaths` (`[['plotId'], ['plot', 'id']]`, open question 3) that holds a non-empty string or a finite number, as a string.
4. **`story(request): Promise<Readonly<{ characters: ReadonlyArray<Readonly<{ name: string, description: string }>> }>>`**: `ready(request)`; `retried` of `get` for `RoomsPath + encodeURIComponent(roomId)`; `plotOf` (none: failure `Messages.NoPlot`, not retryable); `retried` of `get` for `Settings.PlotsPath` (`'/v1/plots/'`) plus the encoded plot id; `body[Settings.CharactersField]` must be an array (else `Messages.Shape`); items without a non-empty string `name` are skipped; `description` that is not a string becomes `''`. Settings: `PlotsPath`, `PlotIdPaths`, `CharactersField: 'characters'`, `NameField: 'name'`, `DescriptionField: 'description'`, `Messages.NoPlot: 'Zeta named no story for this chat'`.

### Changes in `ScribeBoot.js`

`begin` (line 1540) passes `story: () => ZetaSource.story({ fetch, token: ScribeBoot.token(boot), roomId: session.roomId, pause })` to `ScribeLive.open`, with the same `fetch` (the page's own fetch, its own login, cloned init) the keeper's reads use. The page's own traffic is not touched (the scribe's fetch is the original, captured before the watch wraps it).

### Changes in `ScribeLive.js`

1. **The story, once per room.** `open` takes `story`; the live part holds `cast: null|{ characters: object[]|null, notice: string|null }` and `casting: Promise|null`. **`cast(live): Promise<object>`** returns the held result, or starts one read (shared by concurrent callers) and holds what it gives: the characters with no notice; or, on any failure except `ZetaSource.Settings.Messages.NoLogin`, `characters: null` and `notice: Messages.StoryUnread + words(error)` (`StoryUnread: "The story's characters could not be read, so every character counts as custom: "`). A missing login is not held: everyone is custom for that preparation, with no notice, and the next preparation tries again. A closed live part ignores a late answer. The read starts at the first preparation, not at open (the login is seen by then). The result is held in memory, not stored: one read per room per page load. `view` gains `notice` (the held notice or null).
2. **`remind(live, view, now, findings, notes)`** awaits `cast(live)` and calls the new `ScribeReminder.compose` (no model call). The chooser's answer cache goes: `live.answers`, `Settings.AnswersKept`, the `Roles.Scribe` asker and the `noted` parameter of `remind`, with their resets in `active` and `open`.
3. **Basis.** `basis` gains `notes`: `ScribeText.fingerprint(JSON.stringify(...))` of the standing notes compose was given; `holds(basis, reminded, now, findings, notes, state)` compares it too, so a note change makes an unedited reminder stale and `refresh` rebuilds it. `load` treats a basis without `notes` as unsound (null), so an old ready reminder is rebuilt before it goes.
4. `consider` builds the draft notes (`noted(standing(record.notes, view), notes, message)`) before `remind`, so a reply's own notes reach the reminder it prepares; `refresh` and `force` pass `standing(record.notes, view)`.

### Changes in `ScribeReminder.js`

Today: `candidates` (line 478) offers labelled entries (`category: "text"`, the `Of those here only ... know` and `keeps this secret` lines), a model picks at most 8 (`ChoosePrompt`, `chooseInput`, `chosen`), and `fit` (line 826) writes the `Day N, "place", reach. Present: ...` opening and adds entries to 600 bytes. All of that goes: `Kind`, `candidates`, `chooseInput`, `chosen`, `ChoosePrompt`, `PromptLines`, `fit`, `write`, `quoted`, and the Settings only they use. Kept: `clean`, `printed`, `named`, `namesakes`, `people`.

1. **`Part`**: `Correction`, `Wearing`, `Secret`, `Filed`, `Looks`, `Job`, `Place`, in that rank.
2. **Settings** (values named here; clause words are the builder's): `MaxBytes: 1000`, `LongestText: 200`, `MostPlaces: 2`, `LooksCategories: ['age', 'eyes', 'hair', 'build', 'skin', 'appearance', 'feature']`, `PlaceCategories: ['location', 'appearance', 'feature']`, `FiledOrigins: ['Operator', 'Notes']` (open question 6), `LightWords` (the words the content test ignores, such as `a`, `an`, `and`, `with`, `of`, `her`, `his`), the clause tables `LookClauses` and `FactClauses` (per category a prefix and a suffix), and the joining words `Wears: ' wears '`, `Secretly: ' secretly '`, `OnlyOpen: '; only '`, `KnowsOne: ' knows.'`, `KnowMany: ' know.'`, `NoOneElse: '; no one else here knows.'`, `Party: 'The party: '`, `Semicolon: '; '`, `Colon: ': '`, `Comma: ', '`, `And: ' and '`, `FullStop: '.'`.
3. **`guarded(text): string|null`**: today's cleaning (`clean` with `WrittenForm`, trailing marks, backslashes to `/`) without wrapping quotation marks; null when empty, over `LongestText` code points, or holding `[`, `]` or `@` after NFKC. Every fact text, note text and thread text goes through it.
4. **Who is present.** `people(state, now, player)` as today, except that a person the scene did not resolve keeps `printed(label)` so their notes can be named: `named` stops nulling a label only because the subject is null (it still nulls repeated names), and an unresolved label that is a book subject's name (an ambiguous name the scene could not resolve) stays null. The main character is `namesakes` of length 1, added when the scene left him out; unresolved, he has no line. `now === null` gives no one but him. Nothing is built for send-time additions (the frame never sends the typed text).
5. **`noteOf(notes, person, kind): object|null`**: the newest note of that kind whose normalised name equals the person's label, subject name or an aka, or else, when exactly one present person matches, whose words begin the person's or are begun by them.
6. **`writer(state, subject, characters): string|null`**: when `characters` is an array and the subject is a character, the description of the story character whose name, normalised, equals the subject's label, name or an aka, or begins with its words or is begun by them (`Mavan` and `Mavan the Gray`); null for custom (no match, or the story unread).
7. **`added(text, description): boolean`**: some content word of `text` (`ScribeText.words`, less `LightWords`) is not among the description's words. (`ScribeText.words` folds `grey` and `gray`.)
8. **What goes in, per person** (usable facts are in force, not contested, and for Moving and Passing kinds only while nothing is unread, as `candidates` does today):
   - Corrections: each fact of `first` whose subject is present (the main character included, open question 4), as `<Name> <fact clause>.`; `led` is the corrections that survive the cap.
   - Wearing: the person's wearing note only; book `condition` facts never stand for clothing. No note, no clothing.
   - The main character: his wearing note (and a correction); nothing else of his.
   - Secrets: each hidden in-force fact (`hidden` and not widened to everyone) about a present person other than the main character, when some present person other than its subject does not know it (`ScribeKnowledge.knows`; an unresolved person knows only what everyone knows; the main character counts): `<Name> secretly <fact clause>; only <names> know.` (`knows.` for one), or `; no one else here knows.` A knower without a printable name skips the sentence, as today. Hidden looks facts are secrets here, never looks.
   - Filed facts: each non-hidden usable fact whose origin is in `FiledOrigins` about a present person other than the main character: `<Name> <fact clause>.` A filed looks fact is said here and not again in looks.
   - Looks: for a custom person, the non-hidden usable facts of `LooksCategories` (category order, then position) and the newest looks note; for a story NPC, only those for which `added(text, description)` holds (open question 5). Joined `teal eyes, silver hair, tall`, stated plainly whoever knows them.
   - The job: the newest open thread (`closed === null`, highest position) whose guarded text contains, as whole words, a normalised name of a place subject, as `The party: <text>.`, then up to `MostPlaces` places it names (in the order they appear in the text), each `<Place>: <its newest in-force, non-hidden fact of PlaceCategories>.` (no unread rule for places), a place without one skipped. No such thread: the newest guarded open thread alone. None: nothing.
9. **`compose({ state, now, player, unread, notes, characters, first }): Readonly<{ text: string, led: readonly string[] }>|null`**, synchronous: builds the pieces in rank and present order, renders per open question 1 as `[Scribe] ` and the sentences joined by spaces, and while the line is over `MaxBytes` drops the last piece and renders again. No piece left gives null. Relation facts keep today's rule (the target is present or the main character).

### Changes in the panel

`Builders.Progress` (line 1823) gains a paragraph `Ids.Story: 'scribe-story'` (hidden when empty) under the controls; `Drawers.Progress` (line 3507) takes `live` (as `draw` already passes it) and writes `live.notice`. `redraw` carries `notice` from the live view.

### Left to the builder

The clause tables (`LookClauses`, `FactClauses`) and the `LightWords` list; the wording of a looks-only sentence; the exact plot-response fields after the first real read (the fallback is custom with the notice).

### Tests that try to break it

`tests/scribe-reminder.test.mjs` (the chooser, opening and quoting tests go; those proving label safety, the frame guard, contested facts, relation targets, merged subjects and the main character's resolution keep their point against the new function):
- The operator's three reminders as fixtures: a book with Frost (the player), Thessaly, Veyra, Selene and Mavan the Gray, places Frost's apartment and Ashenmaw Ruins, Frost's hidden background (`knows a Malachai connected to the Staff of Elders`), Frost's eyes known to three of them, Thessaly's teal eyes, silver hair and a `condition` of pajamas, the thread naming Ashenmaw. The line has no `Day`, no place of the scene, no `Present:`, nothing of Frost but his wearing note, the wearing notes of those present, no category name followed by a colon, no `pajamas`, no `"` around a fact, no `only ... know` for eyes, and `The party:` with the Ashenmaw sentence.
- Story NPC against custom: Mavan with a description holding his gray hair and not his scar: the scar goes, the hair does not; the same book with `characters: null`: both go; an unmatched NPC is custom; `Mavan` matches `Mavan the Gray` and `Mava` does not; a looks note inside the description is left out for him and kept for a custom person.
- Secrets: one knower (`knows.`), two, none (`no one else here knows.`), all present know (no sentence), a stranger present, a knower without a printable name (no sentence); a hidden scar is a secret and never a look.
- Order and cap: a crowded room over 1,000 bytes drops places, then the job, then looks from the last person back, then filed facts, then secrets, and keeps corrections; the result is at most 1,000 bytes for multi-byte texts at the edge; the same input always gives the same line; a person's wearing and surviving looks stay one sentence.
- The guard: a fact, note or thread text with `[`, `]`, `@` (including full-width forms NFKC folds), a backslash, or over 200 code points is left out; nothing after `[Scribe] ` holds `[`, `]` or `@`; every line passes `ScribeIntake.own`.
- No wearing note: no clothing for that person; an unresolved person with notes gets a sentence by their printed name; an unprintable one gets none.

`tests/scribe-zeta.test.mjs`: `story` reads the room then the plot with the token and encoded ids (`a b/c`); a numeric plot id; `plot.id`; no plot id; a plot without `characters`; items without a name skipped and a missing description as `''`; 404 is final, 429 is retried up to the limit; no token means no request. The existing `exchange` and `page` tests pass unchanged.

`tests/scribe-boot.test.mjs`: `options.story()` on the live part makes both reads through the page's own fetch, with the cloned init and the current token.

`tests/scribe-live.test.mjs`: one read for many preparations and for two at once; a failed read gives custom and the notice, and no second read; a missing login gives no notice and a later read; a note change makes an unedited reminder stale and rebuilds it; an edited reminder is not replaced by a note, a story answer or a reading; no chooser call anywhere (the chooser tests go); `led` holds only corrections that survived the cap.

`tests/scribe-panel.test.mjs`: the Progress tab shows the notice when set and hides the paragraph when null.

`tests/scribe-whole.test.mjs`, `tests/support/FakeZeta.mjs`, `tests/support/WholeSite.mjs`: the fake site answers the room and plot reads (and 404 where a test wants custom); request counts that included only message pages filter by path; the walk's reminder expectations become the new sentences; each step keeps proving what it proved.

### Commands

```
NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 120 node --test --test-timeout=20000 tests/scribe-reminder.test.mjs
... scribe-live, scribe-zeta, scribe-boot, scribe-panel, scribe-whole, scribe-pack
node scribe/pack.mjs
```

### Done when

All seven files pass, the userscript is rebuilt, and the verification record has the counts. After the operator installs it: the real room and plot shapes are noted (or the Progress notice and its reason), and whether Zeta took a reminder near 1,000 bytes in a message.
