# Scribe page verification

## Automated checks

Run from the demo directory, one file at a time. On a machine with little memory put this in front of each run: `NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 120`.

```
node --test --test-timeout=20000 tests/scribe-whole.test.mjs
```

Result on 2026-11-16, each file run alone under that limit:

| File | What it covers | Passing |
|---|---|---|
| `scribe-zeta` | reading the chat from the site with the page's own login | 34 of 34 |
| `scribe-store` | the saved book, campaign, settings, spending and reader's claim | 38 of 38 |
| `scribe-keeper` | pulling, reading in stretches, rulings, budget, stops, holds | 96 of 96 |
| `scribe-scene` | who is present, where and when, at the newest message | 20 of 20 |
| `scribe-reminder` | the line added to the player's message | 55 of 55 |
| `scribe-pedant` | findings about a reply | 41 of 41 |
| `scribe-muse` | suggestions and telling the scribe | 35 of 35 |
| `scribe-live` | work at the newest message | 56 of 56 |
| `scribe-sender` | the send hook on the chat box | 26 of 26 |
| `scribe-frame` | the part that runs inside the chat frame | 17 of 17 |
| `scribe-panel` | the panel | 68 of 68 |
| `scribe-boot` | wiring on the page, model requests, the reader's role, the bridge to the chat frame | 75 of 75 |
| `scribe-pack` | the packed userscript's text | 19 of 19 |
| `scribe-whole` | the packed script walked over a fake page whose chat is in a frame | 52 of 52 |

The engine's files on the same day: text 58, intake 51, answer 59, facts 69, scenes 43, operator 48, knowledge 27, analyzer 29, gateway 30, adoption 32, serve 22, bench 49, all passing.

Each part was attacked by a separate reviewer told to prove it wrong, its findings fixed, and the fixes checked again, in two to four rounds a part. Where a reviewer's attack scripts still existed after the last fix they were run again against the final code by the orchestrating assistant: for the suggestions helper, the pedant, the reminder, the boot, the send hook and the live part. For the keeper and the panel the reviewer itself re-ran its inputs against the final code and reported every fix holding.

The whole walk packs the real sources in memory with `ScribePack.build` and runs that text in a Node VM over a fake page, a scripted site and a scripted model. No part of the scribe is replaced by a stand-in. Its steps: install on a page that is no chat; a chat opens; the key; adopt; a reload; a new reply; sending; a refused send followed by typing; a regenerated reply; an edited old message; a ruling; telling the scribe; a suggestion; a billed answer that fails; a second tab; pausing; starting the book over; leaving the chat; a search of every log line, every element's text, every request and every stored value for the key and the site's token; and a phone-width window with the panel never opened, and a hidden panel, where replies are still checked and the reminder still goes out.

The first run of the walk passed 24 of 30 tests and showed five places where finished parts did not fit together (a reply checked against a book not yet read; the header's spending lagging; a paid question asked twice; a spent budget never said; a reply that arrived while paused never checked after a reload). All five were fixed in the sources, and the walk's own expectations were corrected where a later ruling made them wrong.

## The owner's first run, 2026-11-17

On the real site, with the first build: the panel appeared; the chat was pulled with the page's own login (`Last pull: 864 messages, ended NoCursor`); the key saved; Adopt started; the cost of a failed call was counted. Two faults showed and were fixed the same day: the reading model's answer was cut off at an 8,000-token cap (now 40,000, with ten minutes a call), and a tab that was not in front stopped working (now a hidden tab keeps working and yields only to another tab on the same chat). The boot and whole-walk counts above are from after those fixes; the rest of the first run is still to be done.

## The chat frame, 2026-11-17

The same day the site moved its chat box into a cross-origin frame (`frame.pingpong.ai`). The script now runs in two places: the room page keeps everything, and the copy inside the frame only adds the scribe's line to the message. The design is `docs/superpowers/specs/2026-11-17-scribe-chat-frame-design.md`. The bridge between the two was reviewed adversarially twice; the reviewer's attack scripts were run again against the final code. What they show: a hidden frame never sends an old line; one chat's line never goes out in another; a line posted to the frame without the bridge token is ignored; a script-made message event is ignored; the frame's copy makes one kind of storage call (reading the bridge token) and no request.

Accepted limit: every page on `frame.pingpong.ai` that runs the script receives the bridge token. A page there that forwarded the messages it receives to its parent would let a hostile script in the Zeta page add a line to the player's messages.

Owner checks for the frame, on the real page:

- [ ] After rebuilding and reinstalling, Tampermonkey shows Zeta Scribe running on the room page and inside the chat frame.
- [ ] With a book adopted and a reminder shown under **With your next message**: press Enter on a message. It appears in the chat ending with one `@: [Scribe] ...` line, sent once, and the panel no longer shows the reminder as waiting.
- [ ] The same with the Send button.
- [ ] "Suggested replies" and "Insert asterisk" with text in the box: nothing is added.
- [ ] With DM Memory enabled only for this check, type in its notes box and press Enter: nothing from the scribe is added there. Then disable DM Memory again.

What only the real page can show for the frame: that Tampermonkey runs the script inside the sandboxed frame; that the frame's copy reads a value the top page's copy saved after the frame started; that message events read as browser-delivered, with the right sender, through Tampermonkey's wrappers; how many Pingpong frames the room page holds.

## Not verified by any agent

- **Nothing has run in a browser.** No agent opened the real site, installed the script in Tampermonkey, or made a request to Zeta.
- **No real model was called.** Every model answer in every test is scripted.
- **`scribe/scribe.user.js` was never written by an agent.** The tests exercise the packed text in memory. The owner builds the file with `node scribe/pack.mjs`.
- The download of an export, the browser's lock manager, visibility events, and Tampermonkey's `GM_xmlhttpRequest` (its `timeout`, `abort`, `redirect` and `anonymous` options) are stand-ins in the tests.

## The owner's first run on the real page, in this order

Stop at the first line that fails and note what the Progress tab and the browser console show (lines from the scribe begin `[Scribe]`).

- [ ] Disable Zeta DM Memory. Build with `node scribe/pack.mjs`, install `scribe/scribe.user.js`, allow only `openrouter.ai`.
- [ ] Open a room. A panel appears. The console shows no error from the scribe.
- [ ] The headline goes from pulling the chat to `No book for this chat yet` with the right message count. On the Progress tab note **Last pull**: count ____ and how it ended ____. (If a long chat's whole history ends with a repeated cursor instead of no cursor or an empty page, say so: one setting follows from it.)
- [ ] Save the key. The panel says a key is saved.
- [ ] On a short chat first: Adopt. Stretches are read, the header's spending rises, the headline ends at up to date. Cost: $____ for ____ messages.
- [ ] Reload the page. No model call is made (the spending does not move) and the counts are the same.
- [ ] Wait for a reply. Within some seconds the Findings tab shows a reminder under **With your next message**.
- [ ] Type a message and press Enter. The message that appears in the chat ends with one `@: [Scribe] ...` line, your words unchanged before it, and it was sent once.
- [ ] Press Enter while a reply is still streaming, then type on. The scribe's line leaves the box; your typing is not inside it.
- [ ] Shift+Enter still makes a new line. Ctrl+Enter does whatever it did before.
- [ ] Send with the site's send button instead of Enter. The line is added once.
- [ ] After the next reading of the book, the scribe's own lines are not in the book as story (Book tab: no fact quotes a `[Scribe]` line).
- [ ] Regenerate a reply. Findings about the old text go; the new text is checked.
- [ ] Type in the panel's fields. Nothing you type there triggers a site shortcut or lands in the chat.
- [ ] Open a second chat in a second tab of the same window. Both chats are read; the hidden one keeps going.
- [ ] Open the same room in a second tab. It says another tab is reading. Hide the first tab: the second takes over.
- [ ] Press **Export**. A file `scribe-<room>.json` is saved.
- [ ] Then adopt the long campaign. Messages: ____ Time: ____ Cost: $____ Conflicts: ____ Look-alikes: ____ Questions: ____

## What only the real page can show

- Which JavaScript world Tampermonkey runs the script in, and whether wrapping the page's `fetch` from there sees the site's requests and its login token.
- Whether the site accepts the scribe's own history requests made with the page's `fetch` and token, and at what rate it throttles them.
- The form in which the site ends a chat's history.
- Whether `textarea[name="message"]` is the message box, whether the site acts on the Enter the scribe sends again after 25 ms, and how long the site keeps the text in the box after a real send (over 1.5 seconds and the line is taken back and sent again with the next message).
- Which buttons with an icon sit within 180 px of the window's bottom besides the send button.
- Whether the site returns the `@: [Scribe] ...` line in the player's message exactly as sent, so that the book can lift it off.
- Whether `GM_xmlhttpRequest` honours `timeout`, `abort` and `redirect: 'error'`, and whether an abort signal made in the page works with the lock manager the script sees.
- Whether a background tab still gets visibility events, and whether a hidden tab's timers are frozen.
- The panel beside the site's own layout at phone width and at desktop width; text direction isolation; typing with an input method in the panel's fields; a click on a panel button while a field is still composing.
- The cost and quality of the real models on the real campaign.

## Known limits accepted in this build

- A history that can never be pulled far enough to join the saved campaign holds the chat until a pull joins; the book is kept.
- Opening messages deleted on the site, and an edit outside the newest page, are noticed only by a whole pull or not at all.
- With two visible windows on one chat the reader stays with the first.
- If storage refuses writes, at most one model call's cost per page load can go unrecorded, and no further call is made until a write succeeds.
- A reply the player answers before its check has started is not checked.
- A suggestion that begins `Narrator —`, an apology outside the listed phrases, or a bracketed aside is shown as the model wrote it; nothing is sent unless the player chooses it.
- A public fact whose own text states a secret is repeated in the reminder as the book has it. The Book tab is where that is seen and ruled.
- A note that restates, at the same message, a hidden fact filed by a ruling replaces it with a public copy; "tell the scribe" shows this before anything is filed.
