# Zeta Scribe: the book lives in the operator's Worker and D1

Date: 2026-11-18
Status: direction set by the operator on 2026-11-18 ("IT SHOULD HAVE BEEN THE BASE OF THE CODE", "THE SCRIBE. WORKS. WITH. THE. CLOUD.", "There is local only mode", "why not use the tools we have?", "CROSS TAB SYNC IS A THING", "plan for worker: save it to the cloudflare db"). Revised after a builder check against the Free plan's limits. Calls marked "assistant's call" are open to the operator's ruling.

## Why

The operator plays on more than one PC. The scribe keeps everything in one browser's Tampermonkey storage, so a second PC starts with nothing and would pay for a whole reading again, and a second tab goes stale. The operator already runs a Cloudflare Worker with a D1 database (`worker.mjs`, `schema.sql`) that the DM Memory script uses for per-room notes; the scribe should stand on it.

## Goal

Every PC with the DM API key opens the same book for a room, sees the same findings and reminder state, shares one day's budget, and never pays to adopt twice; every tab updates live; without the key the scribe works on this browser only, as today.

## Limits that shape it

- Workers Free plan: 10 ms CPU per request, 100,000 requests a day for the account (shared with the notes script), 50 D1 queries per request; D1 Free: 100,000 rows written a day, 500 MB per database; the Worker's body cap today is 512 KiB.
- All scribe storage calls are synchronous (`ScribeStore` over `GM_*`); a network store cannot answer synchronously.

## What is synced, and what is not

- **Synced:** `book` (the reading log), `settings`, `live` (findings, notes, reminder state), the day's spending, and the deleted-message list now kept with the campaign (moved into the `book` kind; assistant's call).
- **Not synced: `campaign`** (the pulled chat, the largest kind). Any PC pulls the chat from Zeta itself with the page's login, for free, as it already does on opening a room (assistant's call: syncing it would send megabytes every turn, past the Free plan's CPU limit, for data Zeta already serves).

## Design

1. **Schema** (added to `schema.sql`; the operator runs it in the D1 console; the existing tables are untouched):
   - `scribe_kinds(room_id, kind, revision, parts, updated_at)`: the committed head of each synced kind; primary key `(room_id, kind)`.
   - `scribe_parts(room_id, kind, revision, part, text)`: the text of a kind in parts of at most 400,000 characters; primary key `(room_id, kind, revision, part)`. Rows of revisions older than the committed one are deleted when a new one commits.
   - `scribe_spent(room_id, day, browser, total)`: each browser's running total for the day; primary key `(room_id, day, browser)`; the day's spending is the sum.
   - `scribe_lease(room_id, browser, expires_at)`: who reads; primary key `room_id`.
   - Column checks mirror `room_memories` (room-ID rules, sizes, revisions).
   - No chat text is ever stored (operator, 2026-11-18: "avoid jamming gigantic chats. Notes, facts, etc."): only the book (subjects, facts, rulings, scenes, threads), settings, the live record and spending. A kind is capped at 10 parts (4,000,000 characters); a larger commit is refused and the panel says the book is too large to save to the Worker.
2. **Worker routes** (in `worker.mjs`, same bearer key, same room-ID, revision, `409` and error rules as `/v1/memory`, the same validation helpers; the Worker never parses the stored text, it only stores and returns it, so a part costs almost no CPU):
   - `GET /v1/scribe?roomId=…`: the committed heads, the day's spending (sum and this browser's total) and the lease.
   - `GET /v1/scribe/part?roomId=…&kind=…&revision=…&part=…`: one part, as raw text.
   - `PUT /v1/scribe/part?roomId=…&kind=…&revision=…&part=…`: one staged part as a raw text body (at most 400,000 characters), allowed only to the lease holder.
   - `POST /v1/scribe/commit?roomId=…` with `{ browser, kinds: [{ kind, expectedRevision, revision, parts }] }`: commits one or several kinds at once (adopt and start-over write settings and book together) only if the caller holds the lease and every expected revision matches; otherwise `409` and nothing changes. Staged parts of an uncommitted revision are swept on the next commit.
   - `POST /v1/scribe/spend?roomId=…` with `{ browser, day, total }`: stores this browser's running total for the day if higher than the stored one (repeats are harmless); returns the day's sum.
   - `POST /v1/scribe/lease?roomId=…` with `{ browser, want }`: takes or renews the lease for 90 s when free, expired or already this browser's; else returns the holder and records that another PC wants it; `DELETE` releases.
   - The scribe's requests count against a separate rate counter of 600 a minute, so they never starve the notes API.
3. **Who talks to the Worker.** One tab per browser: the one already chosen by the browser's lock (today's reader). Other tabs on that browser never call the Worker; they see every change through Tampermonkey's value-change listener (`GM_addValueChangeListener`) and redraw at once. The browser has a stored random ID; the lease is held by the browser, so a reload or crash on the same PC never locks itself out.
4. **Opening a room** (the panel shows `Loading the book from your Worker` from the first moment): the tab reads the heads; any synced kind whose committed revision differs from what this browser last saw is downloaded part by part into local storage; then the keeper starts, pulls the chat from Zeta as today, and the session runs on local storage with all the existing synchronous code. If the Worker does not answer within 15 s, the scribe works on the local copy, says `Working offline` in the header, and syncs when the Worker answers.
5. **Saving.** `ScribeStore.write` stays synchronous and local and also records, in local storage, that the kind is unsent and which cloud revision it was based on (so a closed tab loses nothing). The reading tab sends unsent kinds: `live` and `settings` 2 s after the last change; `book` after each reading and each ruling (not every turn). Parts first, then one commit.
6. **One reader across PCs.** The reading browser renews the lease every tick. A watching PC polls the heads every 20 s (one small request) and downloads only kinds whose revision moved. When the operator works on PC B while PC A holds the lease: PC B shows **Read here**; pressing it marks the lease wanted, PC A lets go at its next tick (or the lease expires in 90 s if PC A is off), and PC B takes over after pulling the latest heads. A hidden, idle reader also lets go when another PC wants it, as tabs do today.
7. **Watchers can act.** On any tab or PC, Edit, Save, Clear, force, Dismiss, rulings and Tell the scribe work: a watcher queues the action (local storage for tabs; a small `requests` part of the `live` kind for PCs), the reader applies it within a tick, and the result reaches everyone through the sync. The watcher shows it as pending until then.
8. **Conflicts.** The lease makes two writers rare. If a commit still gets `409` (this PC lost the lease while offline), the reader stops writing, keeps its unsent copy, pulls the cloud, and if the two books differ the panel asks once: **Keep this PC's book** or **Use the cloud's**, showing how many messages each has read (assistant's call: the operator decides which paid-for book to keep; nothing is dropped silently).
9. **Moving today's book up.** The first time a room is opened with the key set and the cloud has nothing for it, this browser's book, settings and live record are pushed up as they are: no new reading, no cost.
10. **Spending.** Every model call's cost is added to this browser's running total for the day locally at once (as today) and sent to `/spend` with the next sync; the budget check uses the cloud's sum from the last sync plus this browser's unsent amount.
11. **Without the key** the scribe works on this browser only, exactly as today, and the Settings tab says the book stays on this PC.
12. **Using what is already there.** The Worker client follows the DM Memory script's (`zeta-dm-memory.user.js`: the fixed `Origin` constant, `request(method, path, query, body)` over `GM_xmlhttpRequest`, the bearer header, retries with backoff); the scribe takes the same DM API key the same way (a Tampermonkey menu entry, **Set DM API key**); the userscript header gains the same `@connect` host. The scribe also reads the room's DM Memory notes (`GET /v1/memory?roomId=…`) and gives them to its models as context under `OPERATOR NOTES:`; it never writes them.

## Tests that try to break it

To be listed in the plan: two simulated PCs on one room (book adopted on one, opened on the other with no reading); a takeover with Read here, an expired lease, a hidden idle holder; a commit race and the `409` choice; spending shared across PCs, repeats counted once; a 400,000-character part boundary with surrogate pairs; the Worker unreachable then back, unsent kinds surviving a reload; the first upload of an existing local book; same-browser tabs redrawing on a change; a Worker test suite in the style of `tests/http.test.mjs` and `tests/sqlite.test.mjs` (the SQLite one needs the operator's approval to run).

## Left to the builder

Request and response field names; where the client lives (a new `ScribeCloud` packed before `ScribeStore`); how the reading tab's tick schedules the sync.
