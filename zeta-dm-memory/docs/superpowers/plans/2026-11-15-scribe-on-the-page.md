# The scribe on the Zeta page: the whole of it

**Status:** Rewritten 2026-11-15 on the operator's instruction: not a smaller version, the whole thing. "Use the simple export flow, save the JSON locally in the same PC, analyze the campaign. Write a summary, then ask the player to rule or resolve. Then we have a memory (the full campaign so far), scribe (which needs to react to me reloading responses or editing them) and a pedant."

**Goal:** One Tampermonkey script on zeta-ai.io that is the scribe the design describes: it pulls the open chat from Zeta by direct request, keeps it and the book on this PC, analyses the campaign, shows a summary and asks the operator to rule; from then on it keeps the book current as play goes on (reloads and edits included), tells Zeta what the scene knows through narrator reminders, and points out where Zeta contradicts the book. It replaces the DM Memory script.

**Spec:** [Approved scribe design](../specs/2026-11-13-scribe-design.md). The engine it stands on: [Scribe engine plan](2026-11-13-scribe-engine.md), built and tested (510 tests).

## What the operator will have

1. **Memory.** Open a chat: the script pulls the whole history from Zeta's own endpoint (the exporter's request), keeps the campaign JSON and the book in Tampermonkey's storage on this PC, and walks the campaign with the Analyzer. When it is done the panel shows a **summary** (who is in the story, where things stand, the timeline, the open threads) and **what needs a ruling**. An "Export" button downloads the campaign and the book as JSON files.
2. **Scribe.** After that the book follows play: answered messages are read in the background; a regenerated or edited reply is noticed and its stretch is read again; what was played elsewhere is read on the next open. Before each send, when the scene has changed or the refresh count is reached, a short narrator reminder (who is here, what they know, what bears on the scene) is added to the outgoing message. The player character's hidden thoughts are never handed to anyone who does not know them.
3. **Pedant.** Each reply is checked against the book: a changed age, number, colour or description; a name spelt another way; a character knowing what they were never told. Findings appear in the panel with what can be done about each: dismiss, rule, send a correction, or say that the character was in fact told.
4. **Suggestions and the scribe's box.** An open thread that fits the scene is offered as a narrator line the operator may use; and a box in the panel takes plain words meant for the scribe ("she is 35, not 30"), which it files after showing what it understood.

## Decisions (the operator may overturn any)

1. **Everything is kept on this PC, in Tampermonkey's storage**: the campaign as pulled, the book, the settings, the OpenRouter key. No server. The Worker sync between two desktops is not in this plan.
2. **One installed file.** A small pack script joins the engine files, the page files and the userscript header into `scribe/scribe.user.js`.
3. **Zeta is read by direct request only**: `GET https://api.zeta-ai.io/v1/rooms/{roomId}/messages?limit=N&cursor=...` with the page's own token, picked up by watching the page's requests. The page's markup is never parsed for story.
4. **Model calls go from the browser** through `GM_xmlhttpRequest`, to OpenRouter. Three roles, each with its own model setting: the Analyzer (the book; default `mistralai/mistral-large-4-0`), the Scribe (the scene now; default `mistralai/mistral-small-3.2-24b-instruct`), the Pedant (default the Scribe's model).
5. **A message is read into the book once it has been answered**, so the newest reply can still be regenerated without disturbing the book. The Scribe and the Pedant look at the newest reply at once.
6. **A reminder is written by code from the book, never by a model.** A model may only choose which entries to use. Contested facts are left out. It goes out as a narrator block (`@:`), at most 600 bytes, the whole message under 4,500 bytes.
7. **The scribe knows its own reminders by what it sent.** Every reminder and correction it sends is remembered per chat; when that text comes back in the history it is lifted out and never read as story. Each also begins with a fixed marker word, for messages sent from another browser.
8. **Spending is capped per chat per day** (default 3 dollars) and shown in the panel.
9. **One reader per chat**: a second tab on the same chat watches and does not read.

## Global constraints

- Plain JavaScript, no framework, no dependency. Page files are classic scripts like the engine's: one frozen top-level `const` each, tag-only docblocks, no prose comments, braces always, no single-letter names, constants in `Settings`.
- Everything from the outside world (the page's window and document, Tampermonkey's functions, timers, the clock) is passed in, so every file is tested in a Node VM with fakes.
- **Every test run, by anyone, is under the hard memory limit**: `NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 120 node --test ...`, one file at a time. No assertion compares fake elements.
- The panel lives in a shadow root. Text is set with `textContent`. No `innerHTML`, no inline handlers. Story text and model output are hostile text.
- The Zeta token and the OpenRouter key never reach a log, an error message, the panel's text, or any request but their own.
- Nothing reaches Zeta but history reads and the operator's own message with what the scribe appended to it; nothing is ever sent without the operator pressing send.
- No real model and no real Zeta in any test. No emojis. No real campaign text or names in any committed file.
- Agents never touch Git state, a database, credentials or deployment; every file change goes through the visible Edit or Write tools.
- Each task: an implementer subagent, a fresh adversarial reviewer, the orchestrator's check, fixes. Tasks are built back to back; the operator is told at each point where the packed script is worth installing.

## Part A: memory

### Task 1: Reading the chat from Zeta (`scribe/page/ZetaSource.js`)

- `watch(pageWindow)`: wraps the page's `fetch` and `XMLHttpRequest` to note the `Authorization` header of requests to `https://api.zeta-ai.io` and to notice the page's own sends and regenerations; changes nothing that passes. `token()`, `onTraffic(callback)`.
- `room(location)`: the room id from `/rooms/<id>`.
- `history({ fetch, token, roomId, pause, onPage })`: every message, oldest first, following `nextCursor` until it repeats or a page is empty; page size 31, half a second between pages; de-duplicated by id, ordered by `messageTime`.
- `newest({ fetch, token, roomId })`: the newest page.

### Task 2: Keeping everything on this PC (`scribe/page/ScribeStore.js`)

- Over four injected functions (`GM_getValue`, `GM_setValue`, `GM_deleteValue`, `GM_listValues`).
- Per chat: the campaign as pulled, the book (the engine's Log), the fingerprints of what was read, the scene now, the reminders sent, the pedant's findings, the settings, the day's spending. Saves are whole or nothing (write new, switch the pointer, remove old); large values are written in parts.
- The OpenRouter key; the one-reader claim; the list of chats with a book; export of a chat's campaign and book as JSON text.

### Task 3: The keeper (`scribe/page/ScribeKeeper.js`)

- `open`: load, pull the history, compare fingerprints (`ScribeIntake.changed`), withdraw what changed or vanished (`ScribeLog.withdraw`), save.
- `adopt` and `resume`: `ScribeAdoption.run` over the answered messages; pause, budget, progress; unreadable answers kept.
- `tick`: ask for the newest page every 20 seconds while the tab is visible and after the page's own traffic; merge; read the next stretch when enough answered messages are unread.
- Rulings (`rule`, `keepFirst`, `revoke`), each saved before it is shown.
- One lock for everything in flight; a result for another chat is thrown away.

### Task 4: The panel, the summary and the rulings (`scribe/page/ScribePanel.js`)

- A collapsible side panel in a shadow root; a header line with the state, the count of items needing a ruling, the day's spending.
- First run: the key, then Adopt with the message count, the models, the stretch size and the budget.
- **Summary**: written by code from the book: the cast (each subject with its kind and its few defining facts), where the story stands (the last scenes), the timeline by day, the open threads, and at the top what needs the operator: conflicts, look-alikes, questions.
- Tabs: Summary, Book, Timeline, Rulings, Findings (Part C), Progress. The lists reuse `scribe/bench/BenchView.js`.

### Task 5: The userscript and the pack (`scribe/page/ScribeBoot.js`, `scribe/pack.mjs`, `scribe/userscript.header.txt`)

- Header: `@match https://zeta-ai.io/*`, `@run-at document-start`, the storage and request grants, `unsafeWindow`, `@connect openrouter.ai`.
- Boot: the watcher, the `fetch`-like wrapper over `GM_xmlhttpRequest`, the keeper and the panel; follows the operator from chat to chat.
- **First point worth installing**: the book builds itself from the live chat and can be read and ruled on.

## Part B: scribe

### Task 6: The scene now (`scribe/page/ScribeScene.js`)

- After each new reply: the small model is shown the last messages and the book's last scene, and answers one line in the engine's SCENES form plus whether the scene changed. Code parses it; a line that does not parse changes nothing.
- A regenerated reply replaces the scene read from the one it replaced.

### Task 7: The reminder (`scribe/page/ScribeReminder.js`, and `ScribeIntake` learns to lift the scribe's own text)

- Candidates from the book for those present: lasting facts that bear on the scene; what each of them knows about the player's character (`ScribeKnowledge.about`); an open thread that names someone present. Left out: contested facts; moving facts and conditions of anyone named in messages the Analyzer has not read yet; anything a character present does not know.
- The model returns which candidates to use; code writes the text: Now, In play, Next. Trimmed by whole lines to 600 bytes.
- `ScribeIntake.read` lifts every block whose text is one the scribe sent, or that begins with the marker.

### Task 8: Sending (`scribe/page/ScribeSender.js`)

- When the operator sends: what is ready (a reminder, corrections, a suggestion they pressed Use on) is appended to their message as narrator blocks, the way the DM Memory script appends its notes; the size guard cuts corrections last and never the operator's own words.
- A reminder goes when the scene changed, a correction is pending, or the refresh count (default 6 sends, per chat) is reached. If nothing is ready in time the message goes without it.
- The DM Memory script's notes box is not carried over; its old pasted notes in the history are already read as the operator's statements.
- **Second point worth installing**: Zeta is being told what the scene knows.

## Part C: pedant

### Task 9: What code can check (`scribe/page/ScribePedant.js`)

- In each new reply: a name within a letter or two of a name in the book; a fixed attribute of someone present stated with words the book does not hold.

### Task 10: What a model checks, and the findings

- The model lists every age, number, colour and description in the reply with who it is about; code compares each with the book. The model is shown, for each speaker, the limited-audience facts they do not know, and says whether a line of theirs uses one; knowledge that could have been passed on in the stretch not yet read is not flagged.
- Findings tab: each finding with Dismiss, Rule (writes the ruling), Correct (a narrator correction written by code from the ruled value, editable, sent with the next message), or They were told (widens the fact).

## Part D

### Task 11: Suggestions

- When a reminder is composed, one open thread that fits the scene may be turned by the model into a narrator line, shown with Use, Another, Ignore. Never sent without Use.

### Task 12: The scribe's box

- Plain words in a panel box; the model turns them into one of the engine's rulings; the panel shows what it understood ("Yselle, age: 35"); filed only on confirmation. Never sent to Zeta.

### Task 13: Pack, README, verification, hand-off

- The packed script committed; the README says how to install it and how to remove the DM Memory script; the verification record says what tests cover and what only the operator can check on the real page, in order.

## What only the operator can verify

No agent can open zeta-ai.io. The first install is the first time the token watcher, the history walk, the panel and the send hook meet the real page. Each hand-off lists what to look at and what to send back if something is off.
