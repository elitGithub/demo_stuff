# Zeta scribe design

Date: 2026-11-13
Status: Approved by the operator on 2026-11-13; builder review complete. The calls listed near the end as "not ruled on" were read by the operator with the rest and stand unless overturned.

## Why this exists

The operator plays long roleplay campaigns on zeta-ai.io. Zeta keeps no memory beyond its recent messages, so over a long campaign it forgets people it invented, changes ages, names and descriptions, loses the order of events, and lets characters act on things they were never told. The operator has been compensating by hand: keeping notes, pasting them into messages, and correcting the storyteller. In their words they spend "more time being my own scribe than actually enjoying the plot".

The scribe takes that work over. It reads the chat, keeps an accurate book of the campaign, tells Zeta the few things the current scene needs, and tells the operator when the story contradicts itself. The measure of success is that the operator plays and rules, and does not keep books.

This is a personal tool for one person. It is not a client demo and will not be hosted for others.

## The five players

| Player | What it is | Job |
|---|---|---|
| Zeta | The storyteller. Not ours. | Runs the game. We only feed it what a scene needs. |
| Scribe | Small, fast model | What is happening right now: where, when, who is present, whether the scene is public. |
| Analyzer | Large model, slow, runs in the background | Keeps the book: adds facts, scenes and threads. Chooses what a scene needs. |
| Grammar nazi | Code plus a model | Finds what does not match: names, numbers, descriptions, and people knowing what they cannot. |
| The operator | The player | Plays, and rules on every conflict. A ruling outranks everything. |

## Goals

1. **Story tracking.** A correct record of who exists, what is true of them, what happened in what order, on which story day, and who was there.
2. **Scene knowledge.** When someone from an earlier scene reappears, Zeta is told what that person knows and thinks about the operator's character.
3. **Conflict suggestions.** A thread from the book offered as a narrator line the operator may drop into the story.
4. **Inconsistency flags.** The operator is told when a reply changes an established fact or has someone act on knowledge they cannot have.

## Not goals

- Playing from a phone with the scribe. Turns played on the phone are caught up on the next desktop session.
- Automatic correction of Zeta. The scribe flags; the operator decides whether to reload the reply, edit it, or send a correction.
- Driving the plot unasked. Suggestions are never sent without the operator pressing Use.
- Any second user, public page, account system or hosted copy.

## What would make this a failure even if it works

- The book silently loses or corrupts facts. Every earlier attempt that let a model rewrite text did this.
- The scribe tells Zeta something the operator would have overruled.
- The chat is slowed down: the operator's typing or sending waits on a model.
- A bug runs up a bill.
- The operator has to tend the scribe as much as they used to tend their notes.

## Exemptions from the workspace rules

The workspace rules were written for client demos. The operator has set these aside for this project, in conversation on 2026-11-12 and 2026-11-13. Reviewers should not raise them again.

- **Phone-first.** The operator ruled the phone out of scope. The panel is a desktop side panel that collapses at narrow widths. It is not a phone layout.
- **Free tiers only.** The operator lifted this rule for this project and set a budget of about 20 dollars a month for model calls through OpenRouter.
- **PHP, Laravel and the InfinityFree host.** Do not apply. This project is plain JavaScript on Tampermonkey and Cloudflare, as the 2026-11-10 notes design established.

Everything else applies: lists paginate, no inline styles, visible focus, no emojis, security rules, the approval and review process, and the operator alone touching the database, credentials, deployment and Git.

## Facts about Zeta that this design depends on

Observed by the operator or in the exported data during the trials. The builder must not assume anything about Zeta beyond these. What is still unknown is listed under Step 0.

- **History.** `GET https://api.zeta-ai.io/v1/rooms/{roomId}/messages?limit=N&cursor=...` with the page's own `Authorization: Bearer` token returns `messages`, `nextCursor`, `prevCursor`. The newest page comes first and the cursor walks backwards. A throwaway exporter built on this pulled 864 and 1,326 message rooms completely.
- **Message shape.** Each message has `id`, `sender.type` (`USER` or `BOT`), `messageTime`, `edited`, `candidateId`, and `contents[]`. Each content block has `type`, `speakerName`, `position` (`NARRATOR`, `LEFT`, `RIGHT`) and `text`. Speakers are exact, so the scribe never guesses who said a line.
- **Narrator syntax.** Typing `@:` in a message makes that part a narrator block; `@Name:` makes a speaker block. The export confirms that a `USER` message can contain a block whose speaker is `Narrator`.
- **Length.** A message of 4,948 bytes was accepted. The true ceiling is unknown and somewhat higher.
- **Profile box.** Reliable only for basic appearance. Anything subtle is ignored about half the time. The scribe does not use it.
- **Reload and edit.** The operator can make Zeta regenerate a reply and can edit a reply's text.
- **Fork.** Zeta can save a chat and fork a new one. The operator will test the engine on forks of live campaigns.
- **Old notes.** The current userscript pastes the operator's notes into their own messages as repeated blocks of asterisk-wrapped lines. They are in the history of every existing campaign.
- **The operator's own messages hold several kinds of block.** Read from the 1,326-message export on 2026-11-14: one message from the operator can contain their character's lines (`RIGHT`), narrator blocks (`NARRATOR`, typed with `@:`), and lines they voice for other characters (`LEFT`, typed with `@Name:`), in any order and any number. A block ends where the next one begins and may span several lines. Of 659 operator messages, 115 had more than one block, with 113 narrator blocks among them.
- **Edits are flagged.** An edited reply stays in place and carries `edited: true`. `candidateId` can be null.

Everything known about Zeta's stored chat is read from the exports. The operator's instruction of 2026-11-14 is to take such facts from that data and not to invent exercises to discover them.

## Decisions the operator has made

These are settled. Changing one needs an updated design and the operator's approval.

1. **How the scribe speaks.** As a narrator block using `@:`, appended to the operator's outgoing message. Scoped to the current scene, capped in size. Sent when the scene changes, when a correction is due, and every few messages regardless, with that number adjustable.
2. **Where things live.** Model calls go from the browser straight to OpenRouter. The book is stored in the existing Cloudflare Worker and D1 database, so it syncs between the operator's desktops and survives a cleared browser.
3. **Three levels of consent.**

   | Kind of scribe text | Sent |
   |---|---|
   | Scene reminder | Automatically, on the triggers above |
   | Correction | Shown first; goes out with the next message unless dismissed |
   | Story suggestion | Only when the operator presses Use |

4. **Private thoughts stay visible to Zeta.** The operator writes them for the narrator. The preferred form is a narrator aside that states the hidden thing and its limits together, for example `@: He does not mention, and they do not know, that he was charging down an army at the time.` The scribe records such things as known only to the character and watches replies for leaks.
5. **Knowledge is strict.** A character knows something only if they saw it, were told, heard it as gossip the story actually showed, or the operator states that everyone knows. Known gossips are not assumed to spread what they know.
6. **Notes do not outrank the story automatically.** The operator's own notes can be wrong. Where notes and story disagree, the operator rules.
7. **First established wins until ruled.** A later value that contradicts an earlier one is a conflict, not an update, unless the story shows the change.
8. **Adoption is the operator's choice, and ruling comes first.** Opening a chat without a book shows the size, time and cost of adopting it. After adoption the scribe says nothing to Zeta until the operator has ruled on what it found. During ordinary play a new conflict does not silence the scribe; the contested fact is withheld from reminders until ruled.
9. **Budget.** About 20 US dollars a month across all campaigns.
10. **Screen.** A side panel beside the chat. Zeta's chat column is narrow and centred on a desktop, with empty space either side.
11. **Build order.** The book first, then scene reminders, then the pedant's flags, then suggestions. Each step is usable alone.
12. **Accuracy over speed.** The operator accepts minutes of background delay for a book they can trust.
13. **One script.** The scribe is the next version of the existing DM Memory userscript and replaces it. The old notes box goes away and its notes are imported as the operator's statements.
14. **Public scenes reach everyone by default.** What is shown in a public scene is known to everyone, and the scribe acts on that without waiting. Each public scene is listed for the operator as an item that does not block, so any one of them can be narrowed to those present.
15. **Words for the scribe go in the panel.** The operator tells the scribe things through a box in the side panel. Nothing meant only for the scribe is typed into Zeta's message box, because a marker there is only characters and could reach Zeta.

## The book

The central lesson of the trials is that a model must never maintain prose. Three ways of having a model rewrite text were tried: the whole book, a page per character, and pages with stricter rules. All three bloated and all three eventually dropped or duplicated content. What worked was a ledger: the model only adds single facts, and code does the filing.

### The book is a log, and the current state is worked out from it

The trial code changed facts in place: marked one replaced, another expired. That cannot undo itself, and the design needs undoing, because a reply can be reloaded or edited after it was read.

So the stored book is a log. Every applied update is kept as the list of operations it produced, tied to the messages it read. The operator's rulings and hand edits are operations in the same log. The current state, meaning who exists, which facts are in force, which are disputed, is rebuilt by replaying the log in story order and skipping any message that has been withdrawn.

What follows from that:

- **Withdrawing a message** means dropping its operations and replaying. Facts it had displaced come back by themselves.
- **"First established"** means earliest in the story, by the position of the message a fact cites. It does not mean whichever the scribe happened to read first.
- **Repeating an update is safe** because an update for messages already applied is refused whole, not merged.
- **An update that took minutes to compute** is applied on top of whatever the operator ruled or edited meanwhile, because both are just entries in the log, ordered by story position.

### Subjects

Subjects are people, groups, places, items and the world. Each has an identity that is not its name, so two people can share a name. The Analyzer is shown every subject with a label that is unique, for example "Oswin (Corwen's friend)" and "Oswin (Tamsin's uncle)", and must use those labels. A subject has one name and any number of other names. The code flags a new subject whose name is within a letter or two of an existing one.

The operator can split one subject into two or merge two into one. On a split, each fact goes to one side or the other, defaulting by the scene it came from, and the operator can move any of them. On a merge, the fixed-attribute comparison is run again, so two different ages become a conflict to rule on. A relation points at a subject, not at a name.

### Facts

A fact is one line: a subject, a category, a statement, and the message that established it. A fact with no message is refused. The model never edits or rewrites a fact; it adds new ones and may declare that the story changed or ended an old one.

Categories fall into four kinds, and the code treats each differently:

| Kind | Categories | What the code does with a new value |
|---|---|---|
| Fixed | age, eyes, hair, build, skin, kind | A fuller description of the same thing replaces the thinner one. A different value is a conflict: the first stays in force, the second is kept as disputed, and both go to the operator. |
| Moving | status, location, role, relation to a subject | The new value replaces the old. The old is kept as history. |
| List | other names, titles, lasting looks, abilities, belongings, background, lasting traits, features of a place, rules of the world | Added. Exact repeats are skipped. |
| Passing | condition: bruises, soreness, what someone is wearing now, a mood | Added, and expired by the code once the story has passed a night after the message that established it. |

A category outside this list is refused, not filed somewhere by guesswork.

The passing kind exists because a model that notices something will file it in the nearest slot rather than leave it out. Without it, bite marks were filed as appearance. The trial's instruction to the model, which should be kept, is one test per line: if nothing new happens, is this still true a month from now? Yes is a fact, no is a condition, and something that happened belongs to the timeline.

When one side of a relation changes, the other side is marked for checking the next time the Analyzer reads that pair. In the trial one character's entry said "lovers" while the other's still said "friends".

### The operator's notes

The operator's old pasted notes are lifted out of the history and treated as the operator's statements, not as story. A note sits at the position of the first message that carried that exact text. A note that agrees with the story, or that the story is silent on, becomes a fact cited as a note. A note that disagrees with the story becomes a ruling to make. Notes held in the old script's store are handled the same way.

### Scenes and the timeline

The timeline is a list of scenes in order. A scene is a stretch in one place with one main thing going on. Each scene records:

- the story day
- the first and last message
- the place
- who was present, and for anyone who arrived late or left early, the message where they did
- whether it was public or private
- one line of what happened

Story days advance when the characters sleep or the story skips time. The night belongs to the day it ends. Reading in order, in stretches, got days and nights exactly right in the trials; one-shot reads of a whole campaign did not.

### Who knows what

Knowledge is worked out, not stored per person. The trial ledger asked "what does each person know?" and wrote the same fact onto three people who had been in the same room, along with public news. That is replaced by this:

- A fact is **shown** unless the Analyzer marks it **hidden**. Hidden means a thought, something only the narrator states, or something a character deliberately conceals.
- A fact shown in a private scene is known to everyone who was present at the message it cites.
- A fact shown in a public scene is known to everyone, unless the operator has narrowed that scene to those present.
- A hidden fact is known only to its subject.
- The Analyzer may record that someone was **told** a fact later. That person is added.
- The operator may widen any fact's audience by hand, including to everyone.
- A fact from the operator's notes, or one the operator added, is known to everyone unless the operator says otherwise.
- A group listed as present, such as "the court", knows as a group. A named member knows individually only if listed.

What a character knows about the operator's character is then: the facts about that character shown while they were present or shown in public, plus the one-line summaries of the scenes they attended and of public scenes. The summaries matter because "he humiliated the prince" is something that happened, not a lasting fact, and it is exactly what the King should remember.

### Threads

A thread is something left hanging that the story could pick up: a threat, a promise, a plan, a mystery, someone due back. The trials showed the Analyzer over-produces these, filing plain facts as threads. They are capped per update and are the weakest part of what the Analyzer writes today, which is why suggestions come last.

### Rulings

A ruling is one of two things: a value fixed for a subject and category ("Yselle's age is 35"), or a decision about identity (these two names are one man; these two Oswins are different men). A ruling outranks notes and story.

Once a value is ruled, a later reply that states a different value does not open a new ruling. It is a flag on that reply, to reload, edit, correct or dismiss.

After adoption, what blocks the scribe from speaking is the list the code produces: conflicting values, look-alike names, and suspected merges. (Amended by the operator on 2026-11-14: names that only resemble each other in spelling are shown as a hint and no longer block; whether a new name is a misspelling of a known one is the Analyzer's judgement. Two subjects with the same name still block.) Two other lists are shown and do not block: the Analyzer's own free-text list of contradictions, as advice, and the public scenes, each of which the operator may narrow. Because a long campaign could produce dozens of blocking items, the Rulings tab offers "keep the first value for all that remain", which applies decision 7 in one step.

(Added by the operator on 2026-11-14.) Two more lists are shown and never block. **Names the Analyzer joined:** when the Analyzer judges that a name in the story is a known subject under another spelling, it says so, the code applies it at once as an alias, and the operator can undo it. **Questions to the player:** where the story leaves a fact unclear, the Analyzer files nothing for it and asks instead ("did you mean she likes him or loves him here"). A question stays in the Rulings tab until the operator answers or dismisses it; an answer goes back to the Analyzer, which files it as ordinary facts. An open question does not stop the scribe from speaking.

### What a citation is

Facts cite Zeta's message `id`, not a position in the list. The panel shows a readable position alongside. A citation covers one message; where the model gives a range, the first message is used, and a range that crosses from one scene into another is refused.

## How it runs

### Adopting an existing chat

1. The panel shows that the chat has no book, with the number of messages and an estimate of time and cost.
2. On Adopt, the scribe pulls the full history through Zeta's history endpoint.
3. The Analyzer walks it in order, a stretch at a time, adding to the log. It saves after every stretch and can be paused, interrupted and resumed.
4. The operator may keep playing. New messages queue and are read when the walk catches up.
5. When the walk ends, the operator is shown every blocking item. The scribe stays silent until they are cleared.

A new campaign skips all of this and starts with an empty book.

### A turn of live play

Everything below happens after Zeta's reply has arrived, while the operator reads it. Nothing blocks typing or sending.

1. The reply is captured, with its exact speakers.
2. The Scribe updates the scene: place, time, who is present, public or private. It says whether the scene changed.
3. The grammar nazi checks the reply. Anything it finds appears in the panel.
4. If the scene changed, a correction is pending, or the refresh count is reached, a reminder is composed and held ready.
5. When enough settled messages have accumulated to make a stretch, the Analyzer reads them in the background and adds to the log. A message is settled once the operator has answered it, so reloading the newest reply rarely disturbs the book.

When the operator sends a message, whatever is ready is appended as narrator blocks and the size guard is applied. If a reminder is not ready in time, the message goes without it and the reminder rides the next one.

The refresh count counts the operator's own sends. It defaults to 6, the old script's interval, and is kept per chat.

### Composing a reminder

A reminder has three parts and nothing else:

- **Now:** where, when, who is present. This comes from the Scribe, so it is current.
- **In play:** the lasting facts of those present that bear on the scene, and what each of them knows about the operator's character from earlier scenes they attended.
- **Next:** an open thread that names someone present, if there is one.

To keep the scribe from telling Zeta something untrue, the model does not write the reminder. It is shown the candidate entries and returns the ones to use. The code writes the text from those entries. The result is plainer than a model's prose, and it cannot contain anything that is not in the book.

Two more guards:

- **Contested facts are left out**, as decided.
- **The book runs behind the chat** by up to a stretch. For anyone named in messages the Analyzer has not read yet, moving facts and conditions are left out of the reminder, because they may already be stale. Someone who died twenty messages ago must not be reported as standing in the room.

A line saying what someone does not know is allowed only for hidden facts about the operator's character.

The default cap is 600 bytes. The whole outgoing message is held under 4,500 bytes. If something must give: the operator's own text and a suggestion they pressed Use on are never cut; corrections go next; the reminder is trimmed by whole lines, never mid-sentence.

Reminders carry a marker the scribe can recognise, so its own past reminders are never read back as story. A narrator block the operator wrote by hand carries no marker and is read as part of the story, which is what the operator intends.

### Reload, edit and catch-up

The scribe keeps a fingerprint of every message it has read. On opening a chat it pulls the history again in the background and compares. A message that has changed, or disappeared, is withdrawn from the log and the new text, if any, is read. Messages it has never seen, because they were played on another device or on the phone, are read in order. The scribe stays silent until this has finished.

### The grammar nazi

Two halves.

- **Code.** A fixed attribute stated with a second value. A new subject whose name resembles an existing one. A scan of each reply for near-miss spellings of names in the book.
- **Model.** A sweep of each reply for every age, number, colour and description, handed to the code to compare; and a check of each speaker against what they could know. Only facts with a limited audience need the second check.

Each finding offers the operator the choices that fit: dismiss, rule on it, add a correction, or widen the audience ("she was told"). A correction's text is written by the code from the ruled value and can be edited before it goes out.

The book running behind matters here too. Someone told a secret in the stretch the Analyzer has not read yet would be flagged wrongly. The leak check therefore treats the unread stretch as unknown and does not flag knowledge that could have been passed on within it.

### Telling the scribe something

The panel has a box for words meant for the scribe: a ruling, a new fact, a correction, a widening of who knows something. The operator types in plain language, for example "Yselle is 35, not 30" or "the whole village knew by morning". The scribe works out what was meant, shows it back in the form it would be filed ("Yselle, age: 35"), and files it only when the operator confirms. What is filed is an operation in the log, like any other ruling or hand edit. Nothing typed in this box is ever sent to Zeta.

### Suggestions

When a reminder is composed, one open thread that fits the scene may be turned into a narrator line and placed in the Suggested box with Use, Another and Ignore. This is the one place a model writes the text the operator sends, and it is never sent without Use.

## Safety rules

These came out of failures in the trials and are requirements, not suggestions.

1. **An answer is accepted whole or not at all.** Only an answer the provider marks as complete is used. An empty answer, one cut off for length, and one that failed partway with some text in it are all thrown away entire.
2. **Inside an accepted answer, each line stands or falls alone.** A line that does not match the expected shape is refused and shown to the operator. The rest of the answer is applied. Nothing malformed is ever repaired by guesswork.
3. **Every Analyzer update's input and answer are kept,** so any fact can be traced to the call that produced it.
4. **An update for messages already applied is refused,** so nothing can be applied twice.
5. **Temporary failures are retried** a small number of times with a pause, without the operator's involvement. The operator is told only if it keeps failing.
6. **Everything is resumable.** A closed tab, a reload or a crash loses at most the update in flight.
7. **Only one desktop reads a chat at a time.** A second desktop that opens the same chat waits, so the same stretch is never paid for twice.
8. **Spending is capped twice:** a daily and monthly cap inside the tool, with a visible meter, and a spending limit set on the OpenRouter key itself. When the tool's cap is reached the scribe stops calling models and says so; the chat itself is unaffected. If the Worker cannot be reached, so the meter cannot be read, no model is called.

## Models and cost

Models are set per role in settings. Defaults are the ones the trials support.

| Role | Default | Evidence |
|---|---|---|
| Analyzer | `mistralai/mistral-large-4-0` | Followed the ledger format without a stray line across ten updates. About 2.5 minutes and 4 cents per 40 messages. It is a thinking model and that time cannot currently be reduced. |
| Scribe | `mistralai/mistral-small-3.2-24b-instruct` | Read 60 messages in about 6 seconds for a fifth of a cent and recorded explicit content plainly. Not yet tested in its narrower live role. |
| Grammar nazi sweep | Undecided | Never tested as a separate pass. It runs on every reply, so it must be a small model or it would consume most of the budget alone. |
| Reminder chooser | Undecided | Never tested. Must be ready before the operator's next message, which rules out a model that thinks for minutes. |

Estimated live cost is about 10 cents per 40 messages, around 75 cents for a 300-message evening. That estimate covers the Analyzer and the Scribe and only guesses at the other two roles. Adopting a 1,326-message campaign is estimated at 1.30 dollars and an hour and a half. All of this is extrapolated from 400 messages and must be measured again once the engine runs. The cost shown on the meter comes from what OpenRouter reports for each call.

Default caps are 20 dollars a month and 3 dollars a day, so that one adoption fits inside a day. Both are adjustable.

Things the trials ruled out: OpenRouter's free models (thinking models that exhaust their allowance, rate limits, 30 to 100 seconds a call); Cloudflare's free AI (enough for about 60 turns a day on a model good enough to matter); small models as keepers of state (they echo the record back as new facts and loop).

## The panel

A side panel docked beside the chat, collapsible, with four tabs.

- **Now.** The scene line. The reminder that will go out next, why, and its size, with Skip, Edit and a control to attach it to the next message even when no trigger has fired. Flags on the last reply with their choices. The Suggested box. The box for telling the scribe something. During adoption, progress, time left and cost so far.
- **Book.** Search. People in the current scene first. Each entry's facts with their sources, what that person knows about the operator's character and what they do not, and controls to add a fact, split or merge.
- **Timeline.** Days, then scenes, each with its range, place, who was present and whether it was public.
- **Rulings.** Blocking items to decide, the Analyzer's advisory list, public scenes that can be narrowed, and past rulings.

A header line always shows whether the book is up to date, how many flags and rulings are open, and money spent today and this month.

Every list in the panel is paged. Removing a fact, a split and a merge ask for confirmation; nothing else does.

A mockup of these states is at `spike/mockup.html`.

## Build order and what each step must prove

Each step ends with the operator using it on a fork of a real campaign.

### Step 0. Find out what is not yet known about Zeta

**Dropped by the operator on 2026-11-14.** This step was written as a short exercise at the browser, and the first plan turned it into a recording script. Neither is needed: how the operator's messages and narrator blocks are stored is in the exports, and the rest is either unnecessary or covered by the design, which compares what it has read against the history every time and re-reads whatever changed.

The questions it would have asked, kept for the record. If the live-script plan turns out to need the two about ids, they are answered by exporting a chat before and after the action and comparing the two files.

- Where the page's login token can be read from, and when.
- How to tell that a reply has finished arriving.
- Whether reloading a reply keeps its message id or makes a new one, and whether messages can be deleted.
- Whether an `@:` block runs to the end of the line or the end of the message.
- Whether a marker placed in a reminder comes back unchanged in the stored text.
- The largest page the history endpoint will return.
- Whether a fork keeps the original message ids, and whether a fork can be traced to its parent.

### Step 1. The book, live

Adoption; capturing replies; the log growing during play; catch-up and withdrawal; the timeline with scenes and attendance; rulings; the Book, Timeline and Rulings tabs; storage and sync; caps and meter.

Done when:

- a fork of a real campaign is adopted from first message to last without the operator intervening;
- every fact in the book points at a message that exists;
- the operator checks thirty facts chosen at random and no more than two are wrong;
- reloading a reply, editing a reply, and reopening the chat on a second desktop each leave the book correct;
- the measured cost and time are recorded in place of this document's estimates.

### Step 2. Scene reminders, including who knows what

The Scribe's live role; choosing and writing the reminder; the outgoing narrator block; the size guard.

This step tests the one thing the whole design assumes and the trials never touched: that a short narrator reminder makes Zeta stay consistent.

Done when the operator has played the same prepared scene on two forks of one campaign, one with reminders and one without, in which a character from an earlier scene returns, and judges that the fork with reminders kept that character's knowledge and the established facts noticeably better.

If it does not, work stops here and the approach to speaking is reconsidered with the operator before Steps 3 and 4 are built. Step 1 remains useful by itself either way.

### Step 3. The pedant's flags

The code checks and the model sweep on each reply; knowledge leaks; corrections.

Done when, over one hundred replies of real play, the operator judges that most flags were worth seeing. A pedant the operator learns to ignore has failed. The sweep's model is chosen in this step by trying candidates against stretches whose contradictions are already known from the trials.

### Step 4. Suggestions

Done when the Suggested box offers a usable line in most scenes that have an open thread, by the operator's judgement, and unused suggestions add no cost.

## What the trials proved, and what they did not

Proved, on two real campaigns of 864 and 1,326 messages:

- Zeta's history can be pulled completely and exactly.
- A large model reads the campaigns, explicit content included, and gets order, days and facts right when it reads in stretches.
- A ledger of single cited facts stays small: 193 current facts after 400 messages.
- Code can file facts, replace moving values, expire passing ones, raise conflicts, and throw away an incomplete answer.
- Because every fact cites its message, claims can be checked by script against the chat.

Measured, and less favourable than first stated:

- Cost per update was not flat. What the model wrote stayed level, but what it was sent grew from about 9,000 to about 16,000 tokens over ten updates, because every subject's name and every night are sent each time. Over a long campaign this needs trimming.

Shown once, by a throwaway script that is not part of the trial code:

- A scan with no model found Tamsin spelled "Collete" ten times, "Galntha" for Odalys, and Aldrich and Aldric, all missed by two large models reading the same text. This is the basis for the pedant's code half, and it has to be built; it does not exist yet.

Not proved:

- That reminders make Zeta consistent.
- The Scribe, the grammar nazi's sweep and the reminder chooser as separate passes.
- A whole campaign through the ledger; 400 of 1,326 messages were run.
- Scene attendance and worked-out knowledge. The trial ledger used the per-person approach this design replaces.
- The log-and-replay form of the book. The trial changed facts in place.
- Expiring conditions by the story's nights. The trial expired them after a count of updates.

Known weaknesses of the Analyzer to design around: it misses some stated values on any single read (a second pass with one narrow job is the answer, not a better prompt), so Step 1's book will be less complete than it will be after Step 3; it merged two different men named Oswin; it updated one side of a relationship and left the other stale; it over-produces threads.

## Risks on the platform

- **Reading the page's traffic.** The only proven way to get Zeta's login token is the exporter's: patch the page's own request functions, in the page, as the document starts loading. The scribe also needs Tampermonkey's privileges for its keys and cross-origin calls. Doing both at once depends on the browser and on Tampermonkey's mode, and it puts code that handles the OpenRouter key next to the page's own code. The builder must keep the key out of the page's reach.
- **Limits of the free Cloudflare plan.** A statement takes at most 100 bound values and a Worker call at most 50 queries, so writing an update one fact per statement can fail. A database is capped at 500 megabytes. Keeping every call's input and answer for every reply would reach that within months, so full records are kept for Analyzer updates and only the most recent ones for the other roles. The existing limits on request size and on requests per minute also apply.
- **Background tabs.** A browser slows or suspends a tab the operator is not looking at. A ninety-minute adoption will be interrupted as a matter of course, so resuming must be routine and cheap.
- **Ruling load.** A long campaign could produce dozens of blocking items. The bulk action in the Rulings tab is what keeps that from becoming the tending this tool exists to remove.

## Boundaries on the builder

- Plain JavaScript with no framework, dependency, package installation or build step, as the existing Worker and userscript are.
- The operator runs all schema SQL and deploys the Worker. Agents do not touch the database, read credentials, publish, or change Git.
- The existing notes Worker stores at most 64 KiB of text per room. A book will exceed that. How the book is stored in D1 is left to the builder, within the Free plan and the limits above, with the existing revision check kept so an older browser cannot overwrite a newer book.
- A book is keyed by Zeta's room id, not by the page's path, so that a language prefix or a trailing slash cannot give one chat two books.
- The OpenRouter key is held in Tampermonkey's script storage, as the existing API key is. It is never written to the page, the database, a URL or a log.
- Tests use made-up campaign text. No real campaign text is ever committed. The trial exports live in a folder Git ignores.
- The logic that files facts and works out knowledge is to be written so it can be tested without a browser or a model. The existing tests already run the userscript in Node this way.
- The trial code under `spike/` is reference only. It was written fast, outside the review loop, and is not to be shipped. The files worth reading are `ledger-core.js` for the filing rules and prompt, `book-core.js` for lifting the old notes out of the history, `zeta-export.user.js` for pulling history, and `ledger-updates.html` for refusing incomplete answers and resuming.

## Calls I made that the operator has not ruled on

These are mine. Any of them can be overturned.

1. The book is stored as a log and the current state is rebuilt from it.
2. Subjects have an identity apart from their name, with unique labels shown to the Analyzer.
3. Facts cite Zeta's message id, with a readable position shown beside it.
4. The code writes the reminder's text from entries the model picks. The model does not write it.
5. The reminder cap of 600 bytes and the whole-message guard of 4,500 bytes.
6. A stretch for the Analyzer is 40 messages, as in the trials.
7. The spending meter and caps are kept with the book in the Worker, so they hold across desktops. Default caps are 20 dollars a month and 3 a day.
8. Passing conditions expire when the story passes a night.
9. Only code-found items block the scribe after adoption; the Analyzer's list of contradictions is advice. A bulk "keep the first value" action exists.
10. A forked chat may copy its parent's book instead of being adopted again, if Step 0 shows that forks keep message ids.
11. If Step 2 shows that reminders do not help, work stops for a rethink before Steps 3 and 4.
12. Step 0 existed. The operator dropped it on 2026-11-14.

## Left to the builder

- The storage layout and the Worker's new routes.
- How replies are captured: from the page's own requests, or by asking the history endpoint.
- How the outgoing message is modified. The existing script does this by editing the input box before send.
- How the operator's character is identified. The trial treated every block in the operator's messages as the player; blocks the operator writes as narrator or as another character are not.
- The exact prompts. The trial prompt in `spike/ledger-core.js` is the starting point; it needs lines for hidden facts, for someone being told, and for scene attendance.
- The exact form of the marker that identifies a scribe reminder.
- How scene boundaries from the fast Scribe and from the slower Analyzer are reconciled. The Analyzer's are the record; the Scribe's are a working guess until the Analyzer has read that stretch.
- What is trimmed from the Analyzer's input as a campaign grows.
