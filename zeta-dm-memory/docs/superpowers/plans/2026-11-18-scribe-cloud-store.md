# Plan: Zeta Scribe cloud store

Design: `docs/superpowers/specs/2026-11-18-scribe-cloud-store-design.md` (approved by the operator 2026-11-18: "Yes, the storage just needs facts and so on. The chat itself - no need. We have it right in zeta."). Plan approved by the operator 2026-11-18 with every proposed resolution in its open questions ("Approved. I'm not going to start writing from two pcs anyway."). Three tasks, one commit each, built and reviewed one at a time in this order. The next task is proposed only after the operator commits the one before it.

All paths are relative to `zeta-dm-memory/`. The plan is written against the code as it stands on 2026-11-18, including the uncommitted reminder-rework change (live notes) in `scribe/page/ScribeLive.js`, `scribe/page/ScribePedant.js` and their tests; nothing here depends on it beyond the `live` record fields it already loads. Line numbers are those of 2026-11-18 and move as tasks land.

Code laws for every task: tag-only docblocks on every method (including arrow callbacks, as the files do now); braces always; no single-letter names; every value in a `Settings` object (in `worker.mjs`: `Limits`, `Sql` and the other frozen tables, as today); code lines at most 120 columns; no emojis; one declaration per purpose; no single-use wrappers; changes through the Edit and Write tools only; git read-only; no database access by agents: the operator runs `schema.sql` in the D1 console and any SQL, and runs `tests/sqlite.test.mjs` or approves that exact command (it opens in-memory SQLite); `tests/http.test.mjs` and every scribe test touch no database; no file is deleted without the operator's leave (removing code inside a file, or the userscript removing its own Tampermonkey values at run time, is not a deletion).

## Open questions for the operator

Each has a proposed resolution that the tasks below assume. A different ruling changes only the steps named.

1. **Wanting the lease (points 1, 2 and 6).** The lease table as listed (`room_id, browser, expires_at`) has nowhere to record that another PC wants it, and point 6 names two triggers: **Read here**, and "a hidden, idle reader also lets go when another PC wants it, as tabs do today". A PC left on with the Zeta tab in front counts as visible though nobody is at it, so Read here cannot wait for the holder to be hidden. **Proposed:** `scribe_lease` gains `wanted` (the wanting browser or null), `wanted_until` (ms; a want lapses 90 s after it was last sent) and `asked` (0 or 1). Read here sends an asked want: the holder lets go at its first tick with no reading or pull in flight, whatever its visibility (a paid reading is never thrown away). A watching PC whose tab is visible sends a plain want with each poll: the holder lets go only when hidden and idle, as tabs do. Letting go is: push every unsent kind, then `DELETE`, which passes the lease straight to the wanting browser (so the old holder cannot take it back at its next tick before the wanting PC polls); with no live want, `DELETE` frees it. (Task 1 schema and routes; Task 3 client.)
2. **The separate rate counter (point 2).** `api_rate_limit` is pinned to `id = 1` and `request_count <= 180`, and the existing tables stay untouched. **Proposed:** a table `scribe_rate_limit` of the same shape with a cap of 600; scribe routes claim it, the notes routes keep theirs. (Task 1.)
3. **How a watching PC queues an action (point 7 against point 2).** Staging a part and committing are allowed only to the lease holder, so a watching PC cannot write a `requests` part of the `live` kind. **Proposed:** a table `scribe_asks` and `POST /v1/scribe/ask`, open to any key holder (one JSON action of at most 8,192 bytes, at most 20 waiting per room, a repeated ID stored once). Waiting asks come back with the heads and, to the holder, with each lease renewal; the holder's next commit names the ones it applied (`done`) and the Worker removes them. The reader records each applied ask's ID and outcome in the `live` record (`answered`, the last 50), so an ask is never applied twice, even by a new reader, and the asking tab shows a refusal instead of losing it silently. (Task 1 schema and route; Task 3 client.)
4. **Tell the scribe from a watcher (point 7).** **Work it out** keeps the understood preview in the reading tab's memory, and **File it** files that object; a watcher can see neither. **Proposed:** the preview moves into the `live` record (`understood`, synced with the rest), so a watcher's **Work it out** queues the words, every tab and PC shows the reader's preview, and **File it** or **Forget** queue a confirm or a forget naming the preview's fingerprint; a preview that changed in between refuses the confirm with words that say so. (Task 3.)
5. **The deleted-message list (the synced set).** `campaign.gone` lives only from the pull that finds a deletion (`ScribeKeeper.takeIn`, line 988) to the `compare` (line 832) that withdraws those messages from the book and clears the list, in one synchronous run. It lingers only while the book is damaged or the tab has lost the reader role, and then no book can be written either, so moving it into the `book` kind cannot be built for the damaged case and adds nothing otherwise: the synced book already carries every withdrawal. **Proposed:** `gone` stays in the local campaign exactly as today and is not synced. (No task changes it.)
6. **A part can exceed today's body cap.** 400,000 UTF-16 code units can take 1,200,000 UTF-8 bytes, more than the 524,288-byte cap the design lists. **Proposed:** the part route has its own cap, `PartBytes: 1200000` (under D1's 2,000,000-byte row limit), counted while the body streams in, then at most 400,000 code units after decoding; the notes route keeps 524,288, and the scribe's JSON routes take at most `ScribeBodyBytes: 16384` (the largest legitimate body, an ask, is about 8.5 KB). (Task 1; the JSON cap is fix round 1, L5.)
7. **When only settings or live differ (point 8).** Point 8 asks when "the two books differ". **Proposed:** the question is asked when the book texts differ, and its answer covers all three kinds. When the books are the same text, a differing `settings` or `live` follows the lease without a question: this PC's copy is pushed over the cloud's when this PC holds the lease, and the cloud's is taken when another PC holds it. An answer stands until carried out: **Keep this PC's book** pushes over whatever the cloud holds once this PC holds the lease; **Use the cloud's** takes whatever it holds then. (Task 2.)
8. **Operator notes (point 12).** The DM notes may be 65,536 bytes, and "its models" is not narrowed. **Proposed:** every model call already passes through `ScribeBoot.call`, so every call (readings, the checker, the scene, the muse, Tell) gets the notes at the end of its user text under `OPERATOR NOTES:`, cut to the first 4,000 characters at the last line break before the cap; the Settings tab says how many characters go and whether they were cut. They are read when the room opens and again at most every 5 minutes, under the page's own pathname (the DM script stores them under `location.pathname`); the scribe's own rows use `/rooms/<roomId>`, since the Worker's room-ID rule needs a leading `/`. (Task 2.)
9. **Two guards the design does not list (point 2).** A commit naming parts that were never staged, or that an earlier commit swept during a tab hand-off, would publish a broken head; staging into a committed revision would rewrite text others are reading. **Proposed:** a commit also requires every named part to be staged (else `409 parts_missing`, which the client answers by sending the parts again, with no question), and staging refuses a revision at or below the committed one (`409 revision_conflict`). Fix round 1 (L3) makes the first guard exact: each staged part is stored with the SHA-256 digest of its text, a commit names its parts' digests in order, and it lands only when every named part is staged with that digest, so parts left by an earlier holder or a late, stale `PUT` are never published. (Task 1.)

## Task 1: schema and Worker routes

Design points 1 and 2, with open questions 1, 2, 3, 6 and 9. Nothing in `scribe/` or in `zeta-dm-memory.user.js` changes. This section is written as amended by fix round 1 (2026-11-18, the review's L1 to L6, N2 and N5): part digests, at most 10 parts a kind, a 16,384-byte scribe JSON cap, no U+0000 in a part, real calendar days, and scribe wording for the 415 on a part and for storage faults.

### Files

- `schema.sql`
- `worker.mjs`
- `tests/http.test.mjs`, `tests/sqlite.test.mjs` (the support classes `ScriptedD1`, `SqliteD1` and `CloudflareCrypto` are used as they are)
- `README.md` (API, deploy, hosted checks, limits)
- `docs/verification/api-verification.md`: a dated paragraph with counts

### Schema

Appended to `schema.sql`; the two existing tables are untouched. Every statement is `IF NOT EXISTS`, so the operator may run the whole file again. `ROOM_CHECK` below stands for the `room_memories` check, written out in full in each table: `CHECK (length(CAST(room_id AS BLOB)) BETWEEN 1 AND 512 AND substr(room_id, 1, 1) = '/')`.

```sql
CREATE TABLE IF NOT EXISTS scribe_kinds (
    room_id TEXT NOT NULL COLLATE BINARY ROOM_CHECK,
    kind TEXT NOT NULL CHECK (kind IN ('settings', 'book', 'live')),
    revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
    parts INTEGER NOT NULL CHECK (parts BETWEEN 1 AND 10),
    updated_at TEXT NOT NULL CHECK (length(updated_at) = 24),
    PRIMARY KEY (room_id, kind)
) STRICT;

CREATE TABLE IF NOT EXISTS scribe_parts (
    room_id TEXT NOT NULL COLLATE BINARY ROOM_CHECK,
    kind TEXT NOT NULL CHECK (kind IN ('settings', 'book', 'live')),
    revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
    part INTEGER NOT NULL CHECK (part BETWEEN 0 AND 9),
    text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 400000 AND length(CAST(text AS BLOB)) <= 1200000),
    digest TEXT NOT NULL CHECK (length(digest) = 64 AND digest NOT GLOB '*[^0-9a-f]*'),
    PRIMARY KEY (room_id, kind, revision, part)
) STRICT;

CREATE TABLE IF NOT EXISTS scribe_spent (
    room_id TEXT NOT NULL COLLATE BINARY ROOM_CHECK,
    day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(day) IS day),
    browser TEXT NOT NULL CHECK (length(browser) BETWEEN 16 AND 64),
    total REAL NOT NULL CHECK (total BETWEEN 0 AND 1000000),
    PRIMARY KEY (room_id, day, browser)
) STRICT;

CREATE TABLE IF NOT EXISTS scribe_lease (
    room_id TEXT PRIMARY KEY NOT NULL COLLATE BINARY ROOM_CHECK,
    browser TEXT NOT NULL CHECK (length(browser) BETWEEN 16 AND 64),
    expires_at INTEGER NOT NULL CHECK (expires_at >= 0),
    wanted TEXT CHECK (wanted IS NULL OR length(wanted) BETWEEN 16 AND 64),
    wanted_until INTEGER CHECK (wanted_until IS NULL OR wanted_until >= 0),
    asked INTEGER NOT NULL DEFAULT 0 CHECK (asked IN (0, 1)),
    CHECK ((wanted IS NULL) = (wanted_until IS NULL))
) STRICT;

CREATE TABLE IF NOT EXISTS scribe_asks (
    room_id TEXT NOT NULL COLLATE BINARY ROOM_CHECK,
    id TEXT NOT NULL CHECK (length(id) BETWEEN 16 AND 64),
    browser TEXT NOT NULL CHECK (length(browser) BETWEEN 16 AND 64),
    action TEXT NOT NULL CHECK (length(CAST(action AS BLOB)) BETWEEN 2 AND 8192),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    PRIMARY KEY (room_id, id)
) STRICT;

CREATE TABLE IF NOT EXISTS scribe_rate_limit (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    window_start INTEGER NOT NULL CHECK (window_start >= 0 AND window_start % 60 = 0),
    request_count INTEGER NOT NULL CHECK (request_count BETWEEN 0 AND 600)
) STRICT;
```

SQLite's `length(text)` counts code points, never more than the UTF-16 length the Worker checks, so a part the Worker accepts always passes the check. `date(day) IS day` refuses an impossible day such as `2026-02-30` (SQLite normalises it to another date) or `2026-99-99` (NULL, which `IS` refuses where `=` would not).

### Changes in `worker.mjs`

How it works today: `fetch` (line 99) authenticates, `parseCommand` (line 175) checks the URL, path, method, query encoding and body, then `claimRateSlot` (line 411) claims the single counter and the switch runs one handler; `readSaveBody` (line 259) streams the JSON body under `BodyBytes`, keeps each `expectedRevision`'s source text through a `JSON.parse` reviver and validates it with `validateRevision` (line 339); `respond` (line 377) always sends JSON. Every statement goes through `execute` (line 392) as one prepared statement: no batch, so each multi-row rule below is a single statement.

1. **`Limits`** gains `ScribeBodyBytes: 16384`, `ScribeRateCapacity: 600`, `PartCharacters: 400000`, `PartBytes: 1200000`, `MostParts: 10`, `LeaseMs: 90000`, `WantMs: 90000`, `MostSpent: 1000000`, `AskBytes: 8192`, `MostAsks: 20`, `MostKinds: 3`.
2. **`Kinds`** gains `Heads`, `PartRead`, `PartStage`, `Commit`, `Spend`, `Lease`, `Release`, `Ask` (each value its own name, as `Read`, `Save`, `List` are). **`NotesKinds: Object.freeze(['Read', 'Save', 'List'])`** names the commands that claim the notes counter.
3. **New tables:** `ScribeKinds: Object.freeze(['settings', 'book', 'live'])`; `Wants: Object.freeze({ None: 'None', Waiting: 'Waiting', Asked: 'Asked' })`; `Counters` with `Notes: { claim: 'ClaimRateSlot', read: 'ReadRateWindow', capacity: 'RateCapacity', unavailable: 'DatabaseUnavailable' }` and `Scribe: { claim: 'ClaimScribeSlot', read: 'ReadScribeWindow', capacity: 'ScribeRateCapacity', unavailable: 'ScribeUnavailable' }`; `Routes` mapping each path to its methods and command (`'/v1/scribe': { GET: 'Heads' }`, `'/v1/scribe/part': { GET: 'PartRead', PUT: 'PartStage' }`, `'/v1/scribe/commit': { POST: 'Commit' }`, `'/v1/scribe/spend': { POST: 'Spend' }`, `'/v1/scribe/lease': { POST: 'Lease', DELETE: 'Release' }`, `'/v1/scribe/ask': { POST: 'Ask' }`); `Queries` giving each scribe command's exact query names (`Heads: ['roomId', 'browser', 'day']`, `PartRead: ['roomId', 'kind', 'revision', 'part']`, `PartStage: ['roomId', 'kind', 'revision', 'part', 'browser']`, `Commit`, `Spend`, `Lease`, `Ask: ['roomId']`, `Release: ['roomId', 'browser']`); `MediaTypes` with getters `Json` (the pattern now inline in `readSaveBody`, moved unchanged) and `Text` (`/^text\/plain[ \t]*;[ \t]*charset[ \t]*=[ \t]*(?:utf-8|"utf-8")$/i`), and the response types `JsonType: 'application/json; charset=utf-8'`, `TextType: 'text/plain; charset=utf-8'`; getters `BrowserPattern` and `AskIdPattern`, both `/^[0-9A-Za-z-]{16,64}$/`, `DayPattern` `/^\d{4}-\d{2}-\d{2}$/` and `DigestPattern` `/^[0-9a-f]{64}$/`; `IntegerKeys: Object.freeze(['expectedRevision', 'revision'])`.
4. **`Errors`** gains `LeaseLost: { code: 'lease_lost', status: 409, message: 'Another browser holds the lease for this room.' }`, `ScribeConflict: { code: 'revision_conflict', status: 409, message: 'The book changed elsewhere. Read it again before saving.' }` (the notes route keeps `RevisionConflict` and its wording), `PartsMissing: { code: 'parts_missing', status: 409, message: 'Some staged parts are missing. Send them again.' }`, `PartNotFound: { code: 'part_not_found', status: 404, message: 'No committed part matches.' }`, `AsksFull: { code: 'asks_full', status: 409, message: 'Too many requests are waiting for the reading browser.' }`, `UnsupportedText: { code: 'unsupported_media_type', status: 415, message: 'Use text/plain with UTF-8 encoding.' }` (a part sent with another type), `ScribeUnavailable: { code: 'database_unavailable', status: 503, message: 'Scribe storage is temporarily unavailable.' }`. `fetch` keeps the counter it chose outside its `try`, and its `catch` answers a `DatabaseUnavailable` with `Errors[counter.unavailable]`, so a D1 fault on a scribe route uses the scribe wording and the notes routes answer exactly as before.
5. **`Sql`** gains these statements (bound values in the order shown):

```sql
-- ClaimScribeSlot (?1 windowStart, ?2 capacity) and ReadScribeWindow: ClaimRateSlot and ReadRateWindow
-- with scribe_rate_limit in place of api_rate_limit, otherwise identical.

-- ReadScribeHeads (?1 room)
SELECT kind, revision, parts, updated_at AS updatedAt FROM scribe_kinds WHERE room_id = ?1 ORDER BY kind

-- ReadScribeSpent (?1 room, ?2 day, ?3 browser)
SELECT coalesce(sum(total), 0.0) AS daySum,
    coalesce(sum(CASE WHEN browser = ?3 THEN total END), 0.0) AS mine
FROM scribe_spent WHERE room_id = ?1 AND day = ?2

-- ReadScribeLease (?1 room)
SELECT browser, expires_at AS expiresAt, wanted, wanted_until AS wantedUntil, asked
FROM scribe_lease WHERE room_id = ?1

-- ReadScribeAsks (?1 room, ?2 MostAsks)
SELECT id, browser, action, created_at AS createdAt
FROM scribe_asks WHERE room_id = ?1 ORDER BY created_at, id LIMIT ?2

-- ReadScribePart (?1 room, ?2 kind, ?3 revision, ?4 part): committed parts only
SELECT stored.text AS text
FROM scribe_parts AS stored
JOIN scribe_kinds AS head
    ON head.room_id = stored.room_id AND head.kind = stored.kind AND head.revision = stored.revision
WHERE stored.room_id = ?1 AND stored.kind = ?2 AND stored.revision = ?3 AND stored.part = ?4
    AND stored.part < head.parts

-- StageScribePart (?1 room, ?2 kind, ?3 revision, ?4 part, ?5 text, ?6 digest, ?7 browser, ?8 nowMs)
INSERT INTO scribe_parts (room_id, kind, revision, part, text, digest)
SELECT ?1, ?2, ?3, ?4, ?5, ?6
WHERE EXISTS (SELECT 1 FROM scribe_lease WHERE room_id = ?1 AND browser = ?7 AND expires_at > ?8)
    AND NOT EXISTS (SELECT 1 FROM scribe_kinds WHERE room_id = ?1 AND kind = ?2 AND revision >= ?3)
ON CONFLICT (room_id, kind, revision, part) DO UPDATE SET text = excluded.text, digest = excluded.digest
RETURNING part, digest

-- CommitScribe (?1 room, ?2 kinds JSON, ?3 browser, ?4 updatedAt, ?5 nowMs): all kinds or none;
-- each kind lands with as many parts as it names digests, and only when part i is staged with digest i
INSERT INTO scribe_kinds (room_id, kind, revision, parts, updated_at)
SELECT ?1, wanted.value ->> '$.kind', wanted.value ->> '$.revision',
    json_array_length(wanted.value, '$.digests'), ?4
FROM json_each(?2) AS wanted
WHERE EXISTS (SELECT 1 FROM scribe_lease WHERE room_id = ?1 AND browser = ?3 AND expires_at > ?5)
    AND NOT EXISTS (
        SELECT 1 FROM json_each(?2) AS asked
        LEFT JOIN scribe_kinds AS head ON head.room_id = ?1 AND head.kind = asked.value ->> '$.kind'
        WHERE coalesce(head.revision, 0) <> asked.value ->> '$.expectedRevision'
    )
    AND NOT EXISTS (
        SELECT 1 FROM json_each(?2) AS asked
        WHERE (
            SELECT count(*) FROM json_each(asked.value, '$.digests') AS named
            JOIN scribe_parts AS staged
                ON staged.room_id = ?1 AND staged.kind = asked.value ->> '$.kind'
                    AND staged.revision = asked.value ->> '$.revision'
                    AND staged.part = named.key AND staged.digest = named.value
        ) <> json_array_length(asked.value, '$.digests')
    )
ON CONFLICT (room_id, kind) DO UPDATE SET
    revision = excluded.revision, parts = excluded.parts, updated_at = excluded.updated_at
RETURNING kind, revision, parts, updated_at AS updatedAt

-- SweepScribeParts (?1 room): every part that is not part of a committed head
DELETE FROM scribe_parts
WHERE room_id = ?1 AND NOT EXISTS (
    SELECT 1 FROM scribe_kinds AS head
    WHERE head.room_id = scribe_parts.room_id AND head.kind = scribe_parts.kind
        AND head.revision = scribe_parts.revision AND scribe_parts.part < head.parts
)

-- DropScribeAsks (?1 room, ?2 ids JSON)
DELETE FROM scribe_asks WHERE room_id = ?1 AND id IN (SELECT value FROM json_each(?2))

-- StoreScribeSpent (?1 room, ?2 day, ?3 browser, ?4 total): only a higher total is written
INSERT INTO scribe_spent (room_id, day, browser, total) VALUES (?1, ?2, ?3, ?4)
ON CONFLICT (room_id, day, browser) DO UPDATE SET total = excluded.total
WHERE excluded.total > scribe_spent.total

-- TakeScribeLease (?1 room, ?2 browser, ?3 nowMs + LeaseMs, ?4 nowMs)
INSERT INTO scribe_lease (room_id, browser, expires_at, wanted, wanted_until, asked)
VALUES (?1, ?2, ?3, NULL, NULL, 0)
ON CONFLICT (room_id) DO UPDATE SET
    browser = excluded.browser,
    expires_at = excluded.expires_at,
    wanted = CASE WHEN wanted = excluded.browser OR wanted_until <= ?4 THEN NULL ELSE wanted END,
    wanted_until = CASE WHEN wanted = excluded.browser OR wanted_until <= ?4 THEN NULL ELSE wanted_until END,
    asked = CASE WHEN wanted = excluded.browser OR wanted_until <= ?4 THEN 0 ELSE asked END
WHERE scribe_lease.browser = excluded.browser OR scribe_lease.expires_at <= ?4
RETURNING browser, expires_at AS expiresAt, wanted, wanted_until AS wantedUntil, asked

-- WantScribeLease (?1 room, ?2 browser, ?3 nowMs + WantMs, ?4 nowMs, ?5 asked 0 or 1)
UPDATE scribe_lease SET
    wanted = ?2,
    wanted_until = ?3,
    asked = CASE WHEN ?5 = 1 THEN 1 WHEN wanted = ?2 AND wanted_until > ?4 THEN asked ELSE 0 END
WHERE room_id = ?1 AND browser <> ?2 AND expires_at > ?4
RETURNING browser, expires_at AS expiresAt, wanted, wanted_until AS wantedUntil, asked

-- PassScribeLease (?1 room, ?2 browser, ?3 nowMs + LeaseMs, ?4 nowMs): hand-off to a live want
UPDATE scribe_lease SET browser = wanted, expires_at = ?3, wanted = NULL, wanted_until = NULL, asked = 0
WHERE room_id = ?1 AND browser = ?2 AND wanted IS NOT NULL AND wanted_until > ?4
RETURNING browser, expires_at AS expiresAt, wanted, wanted_until AS wantedUntil, asked

-- DropScribeLease (?1 room, ?2 browser)
DELETE FROM scribe_lease WHERE room_id = ?1 AND browser = ?2 RETURNING browser

-- AddScribeAsk (?1 room, ?2 id, ?3 browser, ?4 action, ?5 nowMs, ?6 MostAsks)
INSERT INTO scribe_asks (room_id, id, browser, action, created_at)
SELECT ?1, ?2, ?3, ?4, ?5 WHERE (SELECT count(*) FROM scribe_asks WHERE room_id = ?1) < ?6
ON CONFLICT (room_id, id) DO NOTHING
RETURNING id

-- FindScribeAsk (?1 room, ?2 id)
SELECT id FROM scribe_asks WHERE room_id = ?1 AND id = ?2
```

`?2` of `CommitScribe` is `JSON.stringify` of the validated kinds, built by the Worker; SQL reads only values the Worker wrote. The `WHERE` of the `INSERT ... SELECT` also settles SQLite's upsert parse ambiguity.

6. **`fetch`** claims `Counters.Notes` for `NotesKinds` and `Counters.Scribe` otherwise, and its switch gains one case per scribe command, each calling the handler below and `respond`.
7. **`claimRateSlot(db, nowMs, counter = worker.Counters.Notes)`** uses `worker.Sql[counter.claim]`, `worker.Sql[counter.read]` and `worker.Limits[counter.capacity]`; the notes path binds and calls exactly what it does today.
8. **`parseCommand`** keeps its HTTPS check, then sends a path found in `Routes` to `parseScribe`; the memory and index branch is unchanged. **`checkQuery(url): void`** is the encoding loop of lines 193-204, moved unchanged and called by both branches.
9. **`parseScribe(request, url, route): Promise<Readonly<Command>>`**: `405` with `Allow` = the route's methods joined by `, ` when the method is not in the route (`HEAD` included, as today); `400` for a `GET` or `DELETE` with a body; `checkQuery`; **`queryOf(url, names): Record<string, string>`** (400 unless the query holds exactly those names, each once); then per command the validators and body readers below. Command shapes: `{ kind, roomId, browser, day }` (Heads), `{ kind, roomId, target: { kind, revision, part } }` (PartRead), the same plus `browser, text` (PartStage), `{ kind, roomId, ...input }` (Commit, Spend, Lease, Ask), `{ kind, roomId, browser }` (Release).
10. **Validators** (all `400` on failure): `validateRoomId` as today; **`validateKind(value)`** (one of `ScribeKinds`); **`validateBrowser(value)`** and the ask ID (`BrowserPattern`, `AskIdPattern`); **`validateDay(value)`** (`DayPattern`, and a real calendar date: `Date.parse(value)` is not NaN and `new Date(...).toISOString().slice(0, 10)` gives `value` back); **`validateIndex(value, least, most)`** for query integers (`/^(?:0|[1-9][0-9]*)$/`, a safe integer within the range): revision `1..MAX_SAFE_INTEGER`, part `0..MostParts - 1`.
11. **Bodies.** **`readBody(request, pattern, limit, unsupported): Promise<Uint8Array>`**: `415` (the `Errors` entry named by `unsupported`) unless `Content-Type` matches `pattern`, `400` without a body, then the stream loop of lines 268-291 moved unchanged with `limit` (the reader is cancelled and `413` thrown past it). `readSaveBody` calls it with `MediaTypes.Json`, `BodyBytes` and `UnsupportedMediaType` and keeps the rest. **`readPartText(request): Promise<{ text, digest }>`**: `readBody(request, MediaTypes.Text, PartBytes, 'UnsupportedText')`, fatal UTF-8 decode (`400`; a fatal decoder never yields a lone surrogate), empty `400`, any U+0000 `400` (SQLite's `length()` stops at a NUL, so it would otherwise reach the schema check as a storage fault), more than `PartCharacters` code units `413`; `digest` is the lowercase hex SHA-256 of the body bytes (`crypto.subtle.digest`; the bytes are exactly the text's UTF-8, a leading BOM included). **`readScribeJson(request): Promise<{ payload: object, sources: WeakMap<object, Map<string, string>> }>`**: `readBody(request, MediaTypes.Json, ScribeBodyBytes, 'UnsupportedMediaType')`, fatal decode, `JSON.parse` with a reviver that records, per holder object, the source text of each number under an `IntegerKeys` key (as `collectRevisionSource` does for one key); `400` unless the payload is a plain object. **`integerOf(sources, holder, key): number`**: `500 InternalError` when a number has no source (as line 324 does), else `validateRevision(source)`.
12. **Inputs** (exact keys, else `400`): **`commitInput(payload, sources)`** → `{ browser, kinds: [{ kind, expectedRevision, revision, digests }], done: string[] }`: `kinds` 1 to `MostKinds` items with distinct kinds, `expectedRevision` from `integerOf`, `revision === expectedRevision + 1`, `digests` an array of 1 to `MostParts` strings matching `DigestPattern` (part `i` is named by `digests[i]`; the same digest may repeat); `done` 0 to `MostAsks` distinct ask IDs. **`spendInput(payload)`** → `{ browser, day, total }`, `total` a finite number within `0..MostSpent` (`JSON.parse('1e999')` gives Infinity and is refused). **`leaseInput(payload)`** → `{ browser, want }`, `want` one of `Wants`. **`askInput(payload)`** → `{ browser, id, action }`, `action` a plain object whose `JSON.stringify` is at most `AskBytes` UTF-8 bytes (`413` past it).
13. **Handlers.**
    - **`leaseView(row, nowMs): Readonly<object>|null`**: null without a row or once `expiresAt <= nowMs`; else `{ browser, expiresAt, wanted, asked }` with `wanted` null and `asked` false once `wantedUntil <= nowMs`. Used by every lease answer.
    - **`loadScribe(db, command, nowMs)`**: `ReadScribeHeads`, `ReadScribeSpent`, `ReadScribeLease`, `ReadScribeAsks` in that order; `200 { roomId, heads, spent: { day, sum, mine }, lease, asks, now }`.
    - **`readPart(db, command)`**: `ReadScribePart`; no row is `PartNotFound`; the text is answered as `TextType`.
    - **`stagePart(db, command, nowMs)`**: `StageScribePart`; a row gives `200 { kind, revision, part, digest }`; none calls **`refusal(db, roomId, browser, nowMs, expected)`** with the target kind expected at `revision - 1`.
    - **`refusal(db, roomId, browser, nowMs, expected): Promise<never>`**: `ReadScribeLease`, then `LeaseLost` when `leaseView` is null or not this browser's; else `ReadScribeHeads`, and `ScribeConflict` when any expected kind's head revision (0 when absent) differs; else `PartsMissing`.
    - **`commitScribe(db, command, updatedAt, nowMs)`**: `CommitScribe`; no rows calls `refusal` with the commit's expectations (and no sweep runs); rows are followed by `SweepScribeParts` and, when `done` is not empty, `DropScribeAsks`; `200 { heads }` from the returned rows. These are separate statements, so a fault in the sweep or the drop answers `503` after the heads moved: a `503` from `commit` means the outcome is unknown (review L2, documented, no code change).
    - **`spendScribe(db, command)`**: `StoreScribeSpent`, then `ReadScribeSpent`; `200 { day, sum, mine }`.
    - **`leaseScribe(db, command, nowMs)`**: `TakeScribeLease`; a row is `held: true`, followed by `ReadScribeAsks`; else, when `want` is not `None`, `WantScribeLease` with `asked` 1 for `Asked`; else, or when that returns no row, `ReadScribeLease`. `200 { held, lease, asks, now }`, `asks` empty unless held.
    - **`releaseScribe(db, command, nowMs)`**: `PassScribeLease`; a row is `released: true` with the new holder; else `DropScribeLease` (a row is `released: true, lease: null`); else `released: false` and `ReadScribeLease`. `200 { released, lease, now }`.
    - **`askScribe(db, command, nowMs)`**: `AddScribeAsk`; a row is `201 { id }`; else `FindScribeAsk`: found is `200 { id }` (a repeat), not found is `AsksFull`.
14. **`respond(payload, status, headers, type = worker.MediaTypes.JsonType)`**: a text type sends the payload string as it is; `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` as today. Errors stay JSON.

### Routes

| Request | Query | Body | Success | Refusals beyond 400, 401, 413, 415, 429, 503 |
| --- | --- | --- | --- | --- |
| `GET /v1/scribe` | `roomId`, `browser`, `day` | none | `200 { roomId, heads: [{ kind, revision, parts, updatedAt }], spent: { day, sum, mine }, lease, asks: [{ id, browser, action, createdAt }], now }` | none |
| `GET /v1/scribe/part` | `roomId`, `kind`, `revision`, `part` | none | `200`, the raw text, `text/plain; charset=utf-8` | `404 part_not_found` |
| `PUT /v1/scribe/part` | the four above and `browser` | raw text, `text/plain; charset=utf-8`, at most 1,200,000 bytes and 400,000 code units, no U+0000 | `200 { kind, revision, part, digest }` | `409 lease_lost`, `409 revision_conflict` |
| `POST /v1/scribe/commit` | `roomId` | `{ browser, kinds: [{ kind, expectedRevision, revision, digests: [hex] }], done: [id] }` | `200 { heads: [...] }` | `409 lease_lost`, `409 revision_conflict`, `409 parts_missing` |
| `POST /v1/scribe/spend` | `roomId` | `{ browser, day, total }` | `200 { day, sum, mine }` | none |
| `POST /v1/scribe/lease` | `roomId` | `{ browser, want: 'None' or 'Waiting' or 'Asked' }` | `200 { held, lease, asks, now }` | none |
| `DELETE /v1/scribe/lease` | `roomId`, `browser` | none | `200 { released, lease, now }` | none |
| `POST /v1/scribe/ask` | `roomId` | `{ browser, id, action: {...} }` | `201 { id }`, `200 { id }` for a repeat | `409 asks_full` |

`lease` is `{ browser, expiresAt, wanted, asked }` or null. `action` comes back as the stored JSON string; the Worker never parses stored part or ask text. A commit answers `200` whether it creates or replaces (several kinds at once), unlike the notes route's `201`. `digest` is the lowercase hex SHA-256 of the part's UTF-8 bytes; a commit's `digests` name its parts in order, and `409 parts_missing` also answers a named part staged with other text. A `503` from `commit` means the outcome is unknown: the client reads the heads again before retrying.

### Changes in `README.md`

- **API:** the table above, the shapes, the 600-a-minute scribe counter beside the notes counter, the part limits, and that rows of older revisions and abandoned staging are removed at the next commit while `scribe_spent` keeps one small row per room, day and browser.
- **Deploy:** step 2 says to run the whole reviewed `schema.sql` again (repeatable; it only adds the six `scribe_*` tables), then redeploy `worker.mjs` as in step 3; the bindings and secret are unchanged.
- **Hosted checks:** a second PowerShell block, in the style of the first, on one unique fictional room (`/rooms/verification-<guid>-scribe`) with two fictional browser IDs from `[guid]::NewGuid()`: heads of the new room are empty with a null lease; browser A takes the lease; B's asked want comes back on A's renewal; B cannot stage (`409 lease_lost`); A stages one part, whose answered `digest` equals the SHA-256 PowerShell computes, and commits revision 1 naming it; the part reads back byte for byte as `text/plain`; a second commit expecting 0 is `409 revision_conflict`; spends of 0.25, 0.25 and 0.1 by A and 0.5 by B give `mine` 0.25 and `sum` 0.75; A's `DELETE` passes the lease to B; A's next `POST` is `held: false`. The rows stay, as the notes checks' rows do.
- **Limits:** a commit's rows count against D1's 100,000 rows written a day (each row written also writes its table's primary-key index, so about two rows per write); the scribe's routes against the shared 100,000 requests a day.

### Left to the builder

The `message` wording of the new errors; the PowerShell layout; whether the scribe handlers share one place for `nowMs` to ISO text (the notes path's `new Date(nowMs).toISOString()`).

### Tests that try to break it

`tests/http.test.mjs` (scripted adapter, no database):
- **Routes and methods:** every path and method pair; `405` with `Allow` `GET`, `GET, PUT`, `POST`, `POST`, `POST, DELETE`, `POST`; `HEAD` gets `405` with no body; `/v1/scribe/`, `/v1/scribe/other` and `/v1/scribes` are `404`; no statement runs for any refusal; no `access-control-allow-*` header anywhere.
- **Queries are exact:** for each command, a missing name, a repeat spelt `%72oomId`, an extra name, an empty value, `roomId=%`, a trailing `&`; kinds `campaign`, `Book`, empty; revisions `0`, `01`, `-1`, `1.0`, `9007199254740992`; parts `10`, `-1`, `1e1`; a browser of 15 and 65 characters and one with `_`; days `2026-1-18`, `2026-11-18T`, `2026-02-29`, `2026-02-30`, `2026-04-31`, `2026-99-99`, `0000-00-00`, `2026-13-01` and `2026-00-10`; a `GET` and a `DELETE` with a body: all `400`, nothing bound.
- **Separate counters:** a scribe request binds `ClaimScribeSlot` with `[windowStart, 600]`; a notes request still binds `ClaimRateSlot` with `[windowStart, 180]`; a full scribe counter reads `ReadScribeWindow` and answers `429` with `Retry-After`.
- **Heads:** the four statements in order with their exact values; the answer deep-equals the documented shape; an expired lease row gives `lease: null`; a lapsed want gives `wanted: null, asked: false`.
- **Parts:** `PUT` binds `StageScribePart` with `[room, kind, revision, part, text, digest, browser, now]` and answers the row's `digest`; the digest of `abc` is the published SHA-256 vector, every accepted text's digest equals Node's SHA-256 of it, and a leading BOM is hashed with the text; `application/json`, `text/plain`, `text/plain; charset=latin1` and no type are `415` with `Use text/plain with UTF-8 encoding.`; 400,000 `a` passes and 400,001 is `413`; 199,999 `𐍈` plus `ab` (400,000 code units) passes and is bound unchanged, plus `c` is `413`; 400,000 `€` (1,200,000 bytes) passes; a stream of 1,200,001 bytes is `413` with the reader cancelled and released; `0xff`, the encoded lone surrogate `ED A0 80`, the overlong NUL `C0 80` and an empty body are `400`; U+0000 first, in the middle, last, alone, after a BOM and at the 400,000th code unit is `400 bad_request`, nothing bound. `GET` answers the text with `text/plain; charset=utf-8`, `no-store` and `nosniff`; no row is `404 part_not_found`.
- **Refusal reasons:** an empty `StageScribePart` with another browser's lease is `lease_lost`; with this browser's expired lease, `lease_lost`; with this browser's lease and a head at the revision, `revision_conflict`. An empty `CommitScribe` gives `lease_lost`, `revision_conflict` (one of two kinds off) or `parts_missing`, in that precedence; no sweep statement follows a refusal.
- **Commit shape:** a valid body binds `CommitScribe` with the exact kinds JSON, then `SweepScribeParts`, then `DropScribeAsks` only when `done` is not empty; `400` for no kinds, four kinds, a repeated kind, `campaign`, `revision` not `expectedRevision + 1`, 0 and 11 digests, `expectedRevision` `-1`, `1.5`, `"1"` and `1.0000000000000001`, an extra key (`parts` beside `digests` included), the old shape with `parts` and no `digests`, `digests` not an array, a digest in upper case, of 63 or 65 characters, with a non-hex character, white space or a newline, or not a string, a missing `browser`, 21 `done` IDs, a repeated `done` ID; `1.0` and `1e0` are accepted as 1; ten digests and a repeated digest are accepted; a body without reviver source support is `500` (as `revision_validation_fails_closed_without_native_source`); a `text/plain` body is `415` with the JSON wording.
- **JSON cap:** a commit, spend, lease and ask body padded to exactly 16,384 bytes is accepted; 16,385 bytes of spaces, and 16,384 characters padded with `é`, are `413` with nothing bound; a streamed commit body one byte past the cap is `413` with the reader cancelled and released.
- **Spend:** binds `StoreScribeSpent` then `ReadScribeSpent`; `-0.01`, `1e999`, `"1"`, `1000000.01`, a missing `day`, and the days `2026-02-29`, `2100-02-29`, `2026-02-30`, `2026-06-31`, `2026-99-99`, `0000-00-00` and `2026-11-00` are `400`; `0` is accepted, and so are `2028-02-29`, `2000-02-29`, `2026-12-31` and `2026-01-01`.
- **Lease:** a returned take row is `held: true` followed by `ReadScribeAsks`; an empty take with `Asked` binds `WantScribeLease` with asked 1 and with `Waiting` asked 0; `None` reads the lease and binds no want; `want` of `asked`, `true` and missing are `400`. `DELETE`: a pass row hands to the wanted browser; a drop row is `released` with `lease: null`; neither is `released: false` with the current lease.
- **Asks:** a stored ask is `201`; a repeat ID is `200` with one row; a full room is `409 asks_full`; an array, a string and an 8,193-byte action are refused.
- **Redaction:** a failing `StageScribePart`, a failing scribe claim, an unsuccessful heads read and a failing sweep after a landed commit are `503 database_unavailable` with `Scribe storage is temporarily unavailable.`, and the log lines carry neither the part text nor the key; the notes routes' `503` and `415` keep their wording.
- Every existing test passes unchanged.

`tests/sqlite.test.mjs` (real statements on in-memory SQLite; the operator runs it or approves the exact command):
- **Schema:** applied twice; each new check refuses its bad value (`kind` `campaign`, revision 0, parts 11, part 10, empty and 400,001-character text, a 1,200,001-byte text, a digest that is NULL, empty, 63 or 65 characters, upper case, or holds `g`, `-`, `*` or `é`, browser of 15 characters, days `18-11-2026`, `2026-02-29`, `2026-02-30`, `2026-99-99` and `0000-00-00`, total -1, asked 2, a `wanted` without `wanted_until`, `request_count` 601, an 8,193-byte action); parts 10, part 9 and the day `2028-02-29` are stored.
- **Two browsers share one book:** A takes the lease, stages two parts, commits `settings` and `book` at revision 1 in one commit; B reads the heads and both parts and gets A's text exactly; B's staging and commit are `lease_lost`.
- **All or nothing:** a commit of `book` expecting 1 (head 1) and `live` expecting 1 (no head) is `409 revision_conflict`; neither head moves and the staged parts stay until the next good commit sweeps them.
- **Parallel commits:** with a `beforeExecute` barrier, 20 commits by the holder expecting the same head give one `200` and 19 `409 revision_conflict`; the head moved by one.
- **The sweep:** revision 1 in three parts, then revision 2 staged in two parts plus a stray part 5, committed with two parts: only revision 2's parts 0 and 1 remain; revision 1's parts and stray part 5 read as `404`.
- **Committed text cannot be rewritten:** staging at the committed revision, and below it, is `409 revision_conflict`, and the text reads back unchanged.
- **Leases:** A takes; B's asked want shows on A's renewal; A's `DELETE` passes the lease to B for 90 s; A's take is refused; 91 s later A takes it; a want left to lapse (91 s) is not passed on (`DELETE` drops the lease); a plain want from B does not set `asked`, and B's later asked want does.
- **Spending:** A's totals 0.25, 0.25, 0.1 leave `mine` 0.25; B's 0.5 makes `sum` 0.75; another day is separate; the heads report A's `mine`; spends and heads for `2026-02-29`, `2026-11-31`, `2026-99-99` and `0000-00-00` are `400`.
- **The part boundary:** 199,999 `𐍈` plus `ab`, and 400,000 `€`, commit and read back identical; 400,001 code units are `413` and nothing is stored.
- **A commit names what it staged (L3):** A stages `book` revision 1 parts 0 and 1, its lease lapses, B takes it and stages only part 0, then commits naming its own two parts: `409 parts_missing`, no head, and the rows show B's part 0 and A's part 1 with their digests; once B stages part 1 the same commit lands and publishes B's text only. A late stale `PUT` that overwrites part 1 makes the commit naming the new text `409 parts_missing`, as does naming the right digests in the wrong order; staging the new text again lands it. A two-kind commit with one stale part lands neither kind.
- **No NUL (L1):** U+0000 first, in the middle or last is `400 bad_request`, nothing stored and nothing logged.
- **Ten parts (L4):** ten parts commit and read back joined; part 10 cannot be staged or read, and eleven digests are `400`.
- **Separate capacity:** 600 scribe claims fill the scribe counter; a notes request is still answered and the notes counter reads 1; the 601st scribe request is `429`; 200 parallel scribe claims give 600 at most.
- **Asks:** two asks come back oldest first to the holder's renewal and in the heads; a commit naming them in `done` removes them; the 21st is `409 asks_full`; a repeated ID stays one row.

### Commands

```
node --check worker.mjs
NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 120 node --test --test-timeout=20000 tests/http.test.mjs
NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 120 node --test --test-timeout=20000 tests/sqlite.test.mjs   (operator's approval)
```

### Done when

`worker.mjs` checks, `tests/http.test.mjs` passes, `tests/sqlite.test.mjs` passes in the operator's approved run, the README has the API, deploy and hosted-check additions, and the verification record has the counts. After the operator runs the schema and deploys: the hosted scribe checks pass and are noted.

## Task 2: the scribe's Worker client and storage sync

Design points 3 to 5 and 8 to 12, with open questions 7 and 8. One tab per browser talks to the Worker; the lease is taken and renewed, but nothing yet asks for it (Task 3), so a watching PC takes it only when it is free or expired. Other tabs keep today's 20 s watch.

### Files

- `scribe/page/ScribeCloud.js` (new; packed after `ScribeStore.js`, not before as the design suggests, because its `Settings` name `ScribeStore.Kind` values and a later file cannot be read while a pack is loading)
- `scribe/page/ScribeStore.js`, `scribe/page/ScribeKeeper.js`, `scribe/page/ScribeBoot.js`, `scribe/page/ScribeStart.js`
- `scribe/page/PanelView.js`, `scribe/page/ScribePanel.js` (`scribe/page/PanelStyle.js` only if the choice block needs a rule the actions rows do not give it)
- `scribe/userscript.header.txt`, `scribe/pack.mjs`
- `tests/scribe-cloud.test.mjs` (new), `tests/support/FakeScribeWorker.mjs` (new), `tests/support/PanelCloud.mjs` (new)
- `tests/scribe-store.test.mjs`, `tests/scribe-keeper.test.mjs`, `tests/scribe-boot.test.mjs`, `tests/scribe-panel.test.mjs`, `tests/support/PanelHarness.mjs`, `tests/scribe-pack.test.mjs`, `tests/scribe-whole.test.mjs`, `tests/support/WholeTab.mjs`, `tests/sqlite.test.mjs` (one contract test)
- `scribe/scribe.user.js`, rebuilt with `node scribe/pack.mjs`
- `README.md` (the scribe section), `docs/verification/scribe-page-verification.md`: a dated paragraph with counts

### How sync is kept (the shape every step below uses)

- **Synced kinds**, in commit order: `settings`, `book`, `live`. `campaign` never leaves the browser (and keeps `gone`, open question 5).
- **What this browser last saw:** `scribe:synced:<room>` holds `{ [kind]: { revision, generation } }`: the cloud revision the local copy came from or was committed as, and the local head generation (`ScribeStore.write` raises it by one on every save) that matched it. A kind is **unsent** when its local generation is above 0 and differs from the recorded one, and its **base** is the recorded revision (0 when none). Every local save therefore marks its kind unsent with no extra write, and a closed tab loses nothing: the next tab finds the generation moved (design point 5).
- **Spending:** `scribe:spent:<room>` stays this browser's running total for the day (today's record). `scribe:others:<room>` holds `{ day, amount }`, the other browsers' total for the day from the last sync (`sum - mine`). The budget is checked against `spent + others`, which is the design's "the cloud's sum from the last sync plus this browser's unsent amount".
- **The key** is `scribe:cloudkey`; **the browser ID** is `scribe:browser`, made with `random()` the first time a key is in use. Neither is a name `ScribeStore.describe` accepts, so `rooms`, `sweep` and `exportText` ignore them.
- **The cloud room ID** is `/rooms/` plus the decoded room ID; a room ID the Worker's rule would refuse keeps the room local with a notice. The notes room ID is `pageWindow.location.pathname` when the session begins (open question 8).

### Changes in `ScribeStore.js`

1. `Settings.Types` gains `Synced: 'synced'`, `Others: 'others'`; `Segments` gains `Synced: [3]`, `Others: [3]`; `Settings` gains `CloudKey: 'cloudkey'`, `Browser: 'browser'`, getter `BrowserPattern` `/^[0-9A-Za-z-]{16,64}$/`.
2. **`pieces(text, size): string[]`**: the splitting loop of `write` (lines 448-457) moved unchanged with `size` in place of `PartCharacters`; `write` calls it with `PartCharacters`.
3. **`writeText(storage, roomId, kind, text): number`**: `write` from its `check` of the text onward (line 447), unchanged; `write` stringifies and calls it. Same refusals, same return.
4. **`load`** also returns `text` (the joined pieces it already builds at line 391).
5. **`snapshot(storage, roomId, kind): { text: string, generation: number }|null`**: `load` with the name checks of `read`; null when absent; a damaged kind throws as `load` does.
6. **`generation(storage, roomId, kind): number|null`**: the head's generation, 0 with no head, null when the head does not parse (no parts are read).
7. **`synced(storage, roomId): Object<string, { revision: number, generation: number }>`**: the record; kinds outside `Kind`, and entries whose fields are not safe integers at least 0, are dropped. **`setSynced(storage, roomId, kind, revision, generation): void`** writes one entry.
8. **`others(storage, roomId, day): number`** (0 for another day, a missing record, or an amount that is not a finite number at least 0) and **`setOthers(storage, roomId, day, amount): void`**.
9. **`cloudKey(storage): string`** and **`setCloudKey(storage, key): void`**, as `key` and `setKey` on their own name.
10. **`browserId(storage, random): string`**: the stored value when it matches `BrowserPattern`, else `random()` stored and returned; a random value that does not match is refused with `BadArgument`.

### `ScribeCloud.js` (new)

**`Phase`**: `Off` (no key), `Idle` (a key, but this tab is not the browser's chosen tab), `Loading`, `Leading`, `Watching`, `Offline`, `Refused`, `Unusable`, `Conflict`.

**`Settings`**: `Origin: 'https://zeta-dm-memory.elit1989.workers.dev'` (the DM script's `cloudSync.Origin`); `Paths: { Heads: '/v1/scribe', Part: '/v1/scribe/part', Commit: '/v1/scribe/commit', Spend: '/v1/scribe/spend', Lease: '/v1/scribe/lease', Notes: '/v1/memory' }`; `RoomPrefix: '/rooms/'`; `Synced: [Kind.Settings, Kind.Book, Kind.Live]`; `PartCharacters: 400000`; `MostParts: 10`; `TimeoutMs: 15000`; `PartTimeoutMs: 60000`; `OpenMs: 15000`; `QuietMs: 2000`; `RenewMs: 20000`; `BackoffMs: [1000, 2000, 4000, 8000, 16000]` (the DM script's); `NotesEveryMs: 300000`; `NotesLongest: 4000`; `KeyShortest: 60`, `KeyLongest: 254`, getter `KeyPattern` `/^[!-~]+$/`; `Wants: { None: 'None', Waiting: 'Waiting', Asked: 'Asked' }`; `Codes: { LeaseLost: 'lease_lost', Conflict: 'revision_conflict', PartsMissing: 'parts_missing', NoNotes: 'memory_not_found', Configuration: 'configuration_error' }`; `Transport: { Network: 0, Rejected: -1, Cancelled: -2 }` (the DM script's); `Statuses` (200, 201, 401, 404, 409, 429, 500); `Methods`; `ContentTypes: { Json: 'application/json', Text: 'text/plain; charset=utf-8' }`; `Menu: 'Set DM API key'`, `Prompt: 'Enter DM API key'`, `BadKey: 'Enter 60–254 visible ASCII characters.'` (the DM script's words); `Messages: { BadRoom: "This chat's ID cannot be used as a room in your Worker", TooLarge: 'The book is too large to keep in your Worker', Unreadable: 'What your Worker holds for this chat could not be read', Elsewhere: "Another PC is reading this chat; this PC's book is kept as soon as it lets go.", NoChoice: 'There is nothing to choose.', Busy: 'The last request of this kind has not finished yet' }`.

**Options of `open`**: `{ storage, roomId, notesRoom, xmlHttpRequest, clock, random, later, chosen, reader, busy, reading, notify }`: `later(milliseconds, action)` is the session's timer; `chosen()` is true while this tab is the browser's chosen tab; `reader()` is the keeper view's `reader`; `busy()` is true while the keeper view's `busy` is set; `reading()` is true while it is `Reading`; `notify()` redraws and ticks the keeper at once.

**State**: `phase`, `key` (the key in use), `room`, `epoch`, `heads` (kind to `{ revision, parts }` from the last read or commit), `seen` (kind to the last local generation observed) and `changedAt`, `flying` (one data flight at a time), `renewing`, `spending`, `noting` (separate small flights, so a long upload never holds a renewal back), `leaseAt`, `retryAt` and `retries`, `sent` (`{ day, total }` last sent), `notes` (`{ text, length, cut }` or null), `notesAt`, `conflict` (`{ cloud: Map<kind, { revision, text|null }>, here: number|null, there: number|null, answer: null|'Keep'|'Cloud' }` or null), `problem`, `closed`.

**Functions**:

1. **`validKey(value): boolean`**: a string of `KeyShortest` to `KeyLongest` characters matching `KeyPattern`.
2. **`room(roomId): string|null`**: `RoomPrefix + roomId` when it passes the Worker's room rule (no white space, control, `\`, `?`, `#` or lone surrogate; at most 512 UTF-8 bytes), else null.
3. **`request(cloud, method, path, query, body, timeoutMs): Promise<{ status: number, data: *, text: string, retryAfter: number }>`**: the DM script's `request` (`zeta-dm-memory.user.js` line 523) on the cloud's state: the key read from `ScribeStore.cloudKey` (an invalid key answers `401` without sending); a string body goes as `ContentTypes.Text`, an object as JSON; `anonymous: true`, `redirect: 'error'`, `responseType: 'text'`; a `finalUrl` other than the URL, or a 3xx, is `Rejected`; `Retry-After` parsed as there; a timer at `timeoutMs` aborts as `Network`; an answer after the epoch moved is `Cancelled`; `data` is the parsed JSON or null, `text` the raw text.
4. **`failed(cloud, result): void`**: `401` or `configuration_error` sets `Refused` (no retry until the key changes); `Network`, `429` and `5xx` set `retryAt` from `BackoffMs[retries]` (at least `Retry-After` for `429`, then once per tick when the list is spent) and, from `Loading` or `Leading`, set `Offline`; a `Watching` PC that loses the Worker stays `Watching` (it knows another PC reads) and retries. Anything else sets `problem` with the error code.
5. **`leads(cloud): boolean`**: true in `Off`, `Leading`, `Offline`, `Refused` and `Unusable`; false in `Idle`, `Loading`, `Watching` and `Conflict`. `Idle` is false so a tab that becomes chosen cannot read before its cloud has loaded.
6. **`tick(cloud): void`** (each boot tick, before the keeper's): a key that differs from `cloud.key` raises the epoch and starts over (`Off` with no key); `!chosen()` sets `Idle`; `Off` does nothing at all (local only: no request, no browser ID); `Idle` starts `begin`; `Offline` and `Refused` (after a key change) retry `begin` once `retryAt` has passed; `Leading` and `Watching` call `renew` when `RenewMs` has passed since `leaseAt`; then `stir`, `spend` and `readNotes` when due.
7. **`stir(cloud): void`** (also called from the keeper's and the live part's notify): reads each synced kind's `ScribeStore.generation`; any change from `seen` sets `changedAt` to now; then, when `Leading` and something is unsent, schedules `push` with `later` at `changedAt + QuietMs` (one timer at a time).
8. **`begin(cloud): Promise<void>`** (design point 4): `room` null gives `Unusable` with `BadRoom`; else `phase = Loading` and `notify()` at once (the panel shows the loading line from the first moment), a `later(OpenMs)` that turns a still-`Loading` cloud `Offline` and calls `notify()` (the keeper then reads the local copy), then `POST lease` with `want: None`, then `GET heads` with this browser's ID and today (`clock.today()`), then `settle`, then `Leading` when the lease was held, else `Watching`. An answer that lands after the switch to `Offline` is handled the same way: the steps below step the keeper down first when they must write.
9. **`settle(cloud, heads): Promise<void>`**: stores the spending (`setOthers(today, max(0, sum - mine))`) and the heads, then per synced kind, with `h` the cloud revision (0 when absent), `e` the synced entry and `s` the local snapshot:
   - clean (`s` absent, or its generation is `e.generation`): `h === e.revision` leaves it; `h > 0` otherwise downloads it; `h === 0` with `e.revision > 0` records `{ revision: 0, generation: 0 }`, so the local copy goes up again as a first upload;
   - damaged (the snapshot throws a damaged error): `h > 0` downloads it over the damage; else nothing;
   - unsent, `h === e.revision`: left for `push` (design point 9, the first upload, is this case with `h` and `e.revision` both 0);
   - unsent, `h !== e.revision`: the cloud text is downloaded into memory (null when `h` is 0); the same text as the local one records `setSynced(kind, h, s.generation)`; a different text joins the diverged set.
   A diverged `book` sets `Conflict` with `here` and `there` (each book's `Object.keys(log.read).length`, null for no book) and the diverged kinds' cloud texts; otherwise diverged `settings` or `live` are pushed over the cloud (expected `h`) when the lease is held, and taken from the cloud when it is not (open question 7). **Writing a kind locally** happens only while `reader()` is false: when it is true, `settle` sets `Loading`, calls `notify()` (the keeper's step finds the claim gone and loses the reader role) and settles again at the next tick. A download writes with `ScribeStore.writeText` and records `setSynced(kind, h, ScribeStore.generation(...))`.
10. **`download(cloud, kind, head): Promise<string>`**: `GET part` for parts `0` to `parts - 1` in order, joined; a `404` (the revision was swept meanwhile) reads the heads again and restarts the settle, at most twice, then `Offline`; a text that does not decode to an object is not written and sets `problem` to `Unreadable` (the phase goes `Offline`).
11. **`push(cloud, expected = null): Promise<void>`**: runs only when `Leading`, no flight is up and something is unsent. While the `book` is unsent and `reading()` is true, nothing goes (so a new edition's settings and book commit together, and the book goes after each reading and each ruling, never mid-reading); before `changedAt + QuietMs`, nothing goes. Each unsent kind whose cached head equals its base (or whose expected head is given by a conflict answer) is read with `ScribeStore.snapshot`, split by `ScribeStore.pieces(text, PartCharacters)` (more than `MostParts` gives `Unusable` with `TooLarge`, and the keeper goes on locally), and staged with `PUT part` at revision `base + 1`; then one `POST commit` with every staged kind, each naming in part order the `digest` its own `PUT` answers gave this push (never one kept from an earlier push), and `done: []`. `200` records `setSynced(kind, revision, snapshot generation)` and the new heads; a kind saved again meanwhile stays unsent (its generation moved) and goes in the next push. `lease_lost` sets `Watching`, calls `notify()` and settles from fresh heads; `revision_conflict` settles from fresh heads; `parts_missing` stages again at the next push; a `503` or a network failure on `commit` leaves the outcome unknown (the heads may have moved, Task 1's L2), so the retry first reads the heads and settles from them, and a kind whose head now equals the revision just sent with the same text is recorded as sent, not pushed again; other failures go to `failed`.
12. **`renew(cloud): Promise<void>`**: `POST lease` with `want: None`. Held, from `Offline` or `Watching`: `GET heads`, `settle`, `Leading` ("after pulling the latest heads"). Not held, from `Leading` or `Offline`: `Watching`, `notify()` (the reader stops writing at once, design point 8), then `settle` from fresh heads: unsent kinds that differ now ask the question. A `Conflict` whose answer is `Keep` and which now holds the lease carries it out (`push` with the conflict's revisions as expected).
13. **`spend(cloud): Promise<void>`**: when `ScribeStore.spent(today)` is above `sent.total` (or `sent` is for another day and the total is above 0), `POST spend` with `{ browser, day, total }`; the answer's `sum - mine` (never below 0) goes to `setOthers`, and `sent` becomes what was sent. It needs no lease.
14. **`readNotes(cloud): Promise<void>`**: at most every `NotesEveryMs`, and only after the Worker has answered: `GET /v1/memory?roomId=<notesRoom>`. `200` keeps **`trimmed(text)`** (the first `NotesLongest` code points, cut at the last line break before the cap when there is one; `{ text, length, cut }` with `cut` the original length or null); `404 memory_not_found` keeps null; a failure keeps what it had.
15. **`keep(cloud): Promise<void>`** (**Keep this PC's book**): `NoChoice` outside `Conflict`; sets the answer to `Keep`; with the lease held, `push` with the conflict's cloud revisions as expected (a further `revision_conflict` takes the new head as expected without asking again, open question 7), then `Leading` and `notify()`; without it, throws `Error(Elsewhere)` and the answer waits for `renew` to take the lease.
16. **`useCloud(cloud): Promise<void>`** (**Use the cloud's**): `NoChoice` outside `Conflict`; reads the heads again, downloads every diverged kind (`settle` with this PC's unsent copies of those kinds treated as clean), then `Leading` or `Watching` by the lease and `notify()`.
17. **`notes(cloud): string|null`**, **`view(cloud): Readonly<{ phase, keyed: boolean, conflict: Readonly<{ here: number|null, there: number|null }>|null, notes: Readonly<{ length: number, cut: number|null }>|null, unsent: number, problem: string|null }>`**, **`close(cloud): void`** (raises the epoch, sets `closed`; the lease is not released: it lapses 90 s after the last renewal).
18. **`open(options): Readonly<{ view, tick, stir, leads, notes, keep, useCloud, close }>`**.

### Changes in `ScribeKeeper.js`

1. **`open`** (line 2247) takes `lease?: () => boolean`, validated as `claim` is (`BadClaim` for a non-function), kept as `keeper.lease` (null when absent).
2. **`claimed`** (line 746) and **`still`** (line 758) take or check the local claim exactly as today, then return false when `keeper.lease !== null && keeper.lease() !== true`. So a tab keeps the browser's claim while its cloud loads or watches, and `close` still releases the stored claim as today.
3. **`recount`** (line 639): `spentToday = spent + ScribeStore.others(...) + owedToday`. **`pay`** (line 679): after a recorded spend, `ScribeKeeper.counted(keeper)` instead of its own sum. **`read`** (line 1410): `job.recorded` adds `ScribeStore.others(...)` inside the same `try` (every later amount is a difference from it, so payments stay this browser's own).

### Changes in `ScribeBoot.js`

1. **`Settings`**: `NotesOpen: '\n\nOPERATOR NOTES:\n'`; `Parts` gains `{ name: 'cloud', ending: 'close' }` after `keeper`; `Messages.NotSynced: 'The book could not be synced: '`.
2. **`start`** (line 1721), after `ScribeBoot.keyed(boot)` (so the bridge read and write stay the first two Tampermonkey calls, as `tests/scribe-whole.test.mjs` line 1855 checks): `environment.menu(ScribeCloud.Settings.Menu, action)`, once per page. The action is the DM script's: `environment.prompt(Prompt)`; null does nothing; an invalid key calls `environment.alert(BadKey)`; a valid key that differs is saved with `ScribeStore.setCloudKey`, then the session's `askTick`.
3. **`begin`** (line 1438): `session.cloud = ScribeCloud.open({...})` before `ScribeKeeper.open`, with `notesRoom: environment.pageWindow.location.pathname`, `later: (milliseconds, action) => ScribeBoot.later(session, milliseconds, action, null)`, `chosen: () => session.locking ? session.reader : <the stored claim names environment.tabId>`, `reader`, `busy` and `reading` from `session.keeper` (false while it is null), and `notify` that redraws and runs `keeper.tick()` through `attempt`. The keeper's options gain `lease: () => session.cloud.leads()`. The keeper's `notify` and the live part's `notify` also call `session.cloud.stir()`. `ScribePanel.mount` gets `cloud: session.cloud`.
4. **`tick`** (line 1034) calls `session.cloud.tick()` (through `attempt`) before `keeper.tick()`.
5. **`follow`** (line 1649): the session object gains `cloud: null`.
6. **`call`** (line 379): when `session.cloud.notes()` is a non-empty string, the user text sent is `user + NotesOpen + notes` (open question 8). Nothing else of the call changes.
7. **`counted`** (line 529) refuses when `ScribeStore.spent(...) + ScribeStore.others(...)` reaches the budget.

### Changes in `ScribeStart.js`, the header and the pack

- `ScribeStart.js`: the environment gains `menu: (label, action) => GM_registerMenuCommand(label, action)`, `prompt: (text) => window.prompt(text)`, `alert: (text) => window.alert(text)`.
- `scribe/userscript.header.txt`: `// @grant        GM_registerMenuCommand` and `// @connect      zeta-dm-memory.elit1989.workers.dev`.
- `scribe/pack.mjs`: `Files` gains `scribe/page/ScribeCloud.js` right after `scribe/page/ScribeStore.js` (27 files).

### Changes in the panel

- **`PanelView.headline(keeperView, liveView, cloudView)`** (line 190): `Loading` gives `Words.CloudLoading` (`'Loading the book from your Worker...'`); `Conflict` gives `CloudConflict` (`'This PC and your Worker hold different books for this chat.'`); the keeper's `Watching` phase with the cloud `Watching` gives `WatchingPc` (`'Another PC is reading this chat.'`); otherwise today's line, then ` Working offline.` (`Offline`), ` The DM API key was refused; the book stays on this PC.` (`Refused`) or ` The book stays on this PC: <reason>.` (`Unusable`); problems are appended as today.
- **`ScribePanel.mount`** (line 563) takes `cloud`; **`redraw`** (line 2189) reads `panel.cloud.view()` beside the other two (a throw locks everything, as today) and passes it to `header` and `draw`.
- **The choice** (header, built in `build`, line 1353): a block `Ids.Choice: 'scribe-choice'` (hidden unless `Conflict`) holding the counts paragraph `Ids.ChoiceCounts: 'scribe-choice-counts'` (`'This PC: 120 messages read. Your Worker: 131 messages read.'`, `'no book'` for null), one actions row with **Use the cloud's** (`Ids.UseCloud: 'scribe-use-cloud'`) on the left and **Keep this PC's book** (`Ids.KeepHere: 'scribe-keep-here'`, primary) on the right, and the outlet `Outlets.Choice: 'choice'` (`Ids.ChoiceOutcome: 'scribe-choice-outcome'`). Both run `perform` with pending `Words.Working`; both are `Guard.Free` with their disabled state set by the header while either is pending. No confirmation dialog: the question is the confirmation.
- **Settings tab** (`Builders.Settings`, line 2062; `Drawers.Settings`, line 3788): a paragraph `Ids.CloudState: 'scribe-cloud-state'` above the key: with no cloud key, `'No DM API key: the book stays on this PC. Set DM API key from the Tampermonkey menu to keep it in your Worker.'` (design point 11); with one, `'The book is kept in your Worker and shared by every PC with the DM API key.'`; and a paragraph `Ids.Notes: 'scribe-notes'` (hidden with no key): `'No operator notes for this chat in your Worker.'`, or how many characters of the operator notes go to the models and, when cut, from how many.
- `tests/support/PanelCloud.mjs`: `view()` from a settable value; `keep()` and `useCloud()` note their calls and answer like `PanelLive.suggest`.

### Left to the builder

The exact sentences within the meanings above; how `ScribeCloud` keeps its caches (maps or objects); whether `spend` and `readNotes` ride the tick or their own timers, within the values above. **A consequence to state in the report:** an answer that lands after the 15 s switch to `Offline` and finds the cloud moved steps the keeper down at once, which throws away a reading in flight (it happens only when another PC read meanwhile, and that reading would conflict anyway).

### Tests that try to break it

`tests/support/FakeScribeWorker.mjs`: an in-memory Worker answering `GM_xmlhttpRequest` details for every route of Task 1 with the same statuses and shapes (`Origin`, a clock, a request log, `silence()` for no answer, `fail()` for `onerror`, `answer(path, status, body)` for one scripted answer). `tests/sqlite.test.mjs` gains **`the_fake_worker_answers_as_the_worker`**: one script of requests (two browsers, staging, commits, a race, spending, a hand-off) sent to `worker.fetch` over `SqliteD1` and to the fake, with `Date.now` mocked; the statuses and bodies are equal (operator's approval to run).

`tests/scribe-cloud.test.mjs` (two browsers are two `FakeStorage` sharing one `FakeScribeWorker`):
- **Local only:** with no key, a day of ticks makes no request, stores no browser ID and no synced record; `leads()` is true throughout; `view().keyed` is false.
- **Opening:** `view().phase` is `Loading` before any answer; the lease comes before the heads; moved kinds download part by part into local storage and match the cloud's text; the synced record holds the revisions and the new generations; `notify` was called; a non-chosen tab makes no request.
- **Two PCs:** PC A's local `settings`, `book` and `live` go up in one commit expecting 0 (the first upload, no other request in between); PC B opens and its three local texts equal A's; B's later ticks download nothing unchanged.
- **15 s:** a silent Worker leaves `Loading` at 15,000 ms, not 14,999, and `leads()` turns true; when it answers, the lease and heads are read and unsent kinds are pushed with their base.
- **Unsent survives a reload:** a save, then the cloud closed before the quiet time ends (no request), then a new cloud on the same storage pushes it with the right expected revision.
- **Quiet time:** a `live` save at `t` goes at `t + 2000`, not `t + 1999`; another save at `t + 1500` moves it to `t + 3500`; `settings` and `book` unsent while `reading()` is true send nothing, and both go in one commit once it is false.
- **Splitting:** a text of 800,001 code units with a surrogate pair across 400,000 goes in three parts, none starting with a low surrogate, joined back to the text; more than 10 parts gives `Unusable` with no request and `leads()` true.
- **Conflict:** a commit answered `revision_conflict` with a different cloud book gives `Conflict` with both read counts and no further staging; the same book text records the cloud revision with no question; **Keep** pushes over the cloud's head and leads; **Use the cloud's** writes the cloud's texts locally, records them and pushes nothing; a `revision_conflict` during Keep pushes over the newer head without asking again; Keep while another PC holds the lease throws `Elsewhere` and is carried out by the renewal that takes the lease.
- **Only live differs:** with the same book, this PC's `live` goes over the cloud's when it holds the lease, and the cloud's is taken when it does not.
- **Losing the lease:** `lease_lost` on a commit gives `Watching`, `leads()` false and no further `PUT`; a renewal answered `held: false` does the same; a watching PC with unsent work that differs gets the question.
- **`parts_missing`:** the parts are staged again and the commit lands at the next push; a part answered by a late, stale `PUT` is never named, because each commit names only the digests its own `PUT` answers gave.
- **Unknown commit outcome:** a commit answered `503` after its heads moved is not sent again: the next push reads the heads first and records the kind as sent; a `503` that did not land is pushed again after that read.
- **Downloads wait for the keeper:** with `reader()` true, a moved cloud kind is not written; `Loading` and `notify` come first, and the write lands once `reader()` is false.
- **Damage:** a damaged local `book` is replaced by the cloud's.
- **Refused:** `401` gives `Refused` and no retry until the key changes; a new key starts over.
- **Backoff:** network failures retry after 1, 2, 4, 8 and 16 s, then once per tick; `429` waits for `Retry-After`.
- **Spending:** a local spend sends `{ browser, day, total }` once; an unchanged total sends nothing; `others` becomes `sum - mine`; another day's `others` read as 0.
- **Notes:** read with the pathname; `404` gives none; 4,001 characters are cut at the last line break (at 4,000 with none); read again after 5 minutes, not before.

`tests/scribe-store.test.mjs`: `pieces` against today's `write` output for the same text; `writeText` and `write` store the same parts; `load` returns the text; `generation` 0, a number, and null for an unparsable head; `synced` drops bad entries one by one; `others` for another day, a negative and a non-number amount; `cloudKey` apart from `key`; `browserId` made once and kept, and a bad stored value replaced; `rooms`, `sweep` and `exportText` are unchanged with the new names present.

`tests/scribe-keeper.test.mjs`: with `lease` false the keeper opens `Watching` and never reads, even holding the claim; turning true makes the next tick read; turning false mid-session loses the reader role at the next step; `spentToday` includes `others`; a reading with `others` at the budget stops at once; `lease` not a function is `BadClaim`.

`tests/scribe-boot.test.mjs` (a `ScribeCloud` stand-in records its options and calls, as the other parts' stand-ins do): the menu entry is registered once, after the bridge key; Cancel saves nothing; 59 characters, 255 characters and a non-ASCII key alert and save nothing; a valid key is saved; the cloud is opened before the keeper, ticked before it, and closed with the session; the keeper's `lease` is the cloud's `leads`; a model call carries `OPERATOR NOTES:` and the notes at the end only when the cloud has notes, and no log line carries the key; `counted` refuses at `spent + others >= budget`.

`tests/scribe-panel.test.mjs`: each headline (loading, offline, refused, unusable, another PC, conflict); the choice block hidden outside `Conflict`; its counts, `no book`, left and right order, `Working...` at once on either press, the refusal in its outlet; the Settings paragraphs with and without a key and the notes paragraph; at phone width the header with the choice has no horizontal scroll.

`tests/scribe-pack.test.mjs`: 27 files with `ScribeCloud` right after `ScribeStore`; `headerProblems` reads both hosts (`ModelOrigin` and `ScribeCloud`'s `Origin`) and wants them as the two `@connect` lines; `GM_registerMenuCommand` is granted and used.

`tests/scribe-whole.test.mjs` (`WholeTab` gains `GM_registerMenuCommand`, `window.prompt` and `window.alert`, and sends Worker requests to a `FakeScribeWorker`; `install` takes a second browser's `storage` and `locks`):
- **Two PCs, one book:** PC A sets the key through the menu, adopts and reads (its model calls and cost noted); PC B opens the room: no model call, the same book state, the header says another PC reads and shows A's spending; A's tab is closed; 90 s later B's tick takes the lease, pulls the chat, and reads nothing A had read.
- **Offline and back:** the Worker silent when B opens: `Working offline` at 15 s, the keeper reads locally; the Worker back: B's unsent work goes up, or the question shows when A has written meanwhile.
- **Without a key** every existing step passes unchanged.

### Commands

```
NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 120 node --test --test-timeout=20000 tests/scribe-cloud.test.mjs
... scribe-store, scribe-keeper, scribe-boot, scribe-panel, scribe-pack, scribe-whole
NODE_OPTIONS=... tests/sqlite.test.mjs   (operator's approval; the contract test)
node scribe/pack.mjs
```

### Done when

The seven scribe files pass, the contract test passes in the operator's approved run, the userscript is rebuilt, the README's scribe section says how to allow the Worker host, set the key and what syncs, and the verification record has the counts. After the operator installs it: one room adopted on one PC and opened on another, with the second PC's model calls and header noted.

## Task 3: live sync between tabs and PCs

Design points 3, 6 and 7, with open questions 1, 3 and 4.

### Files

- `scribe/page/ScribeAsks.js` (new; packed after `ScribeLive.js`)
- `scribe/page/ScribeCloud.js`, `scribe/page/ScribeLive.js`, `scribe/page/ScribeBoot.js`, `scribe/page/ScribeStart.js`, `scribe/page/PanelView.js`, `scribe/page/ScribePanel.js`
- `scribe/userscript.header.txt`, `scribe/pack.mjs`
- `tests/scribe-asks.test.mjs` (new), `tests/scribe-cloud.test.mjs`, `tests/scribe-live.test.mjs`, `tests/scribe-boot.test.mjs`, `tests/scribe-panel.test.mjs`, `tests/scribe-pack.test.mjs`, `tests/scribe-whole.test.mjs`
- `tests/support/FakeStorage.mjs` (value-change listeners), `tests/support/WholeTab.mjs`, `tests/support/FakeScribeWorker.mjs` (wants, asks), `tests/support/PanelCloud.mjs`, `tests/support/PanelLive.mjs`
- `scribe/scribe.user.js`, rebuilt; `README.md` ("One tab per chat reads" becomes one browser and one PC); `docs/verification/scribe-page-verification.md`: a dated paragraph with counts

### `ScribeAsks.js` (new)

An ask is `{ id, at, outlet, name, args, sent }`, stored one per value at `scribe:ask:<room>:<id>` (so two tabs never overwrite each other's list); `scribe:asked:<room>` holds `{ id, at }` and changes whenever an ask is added or removed, so one listened name tells the reader and the watchers.

1. **`Name`**: `Dismiss`, `Told`, `Edit`, `Clear`, `Force`, `Rule`, `KeepFirst`, `Revoke`, `Tell`, `Confirm`, `Forget`. **`Settings`**: `Type: 'ask'`, `Signal: 'asked'`, `MostWaiting: 20`, `LongestAsk: 8192` (UTF-8 bytes of the stored JSON), `TellLongest: 2000`, getter `IdPattern` `/^[0-9A-Za-z-]{16,64}$/`, and `Args`: per name its argument keys (`Dismiss` and `Told`: `key`; `Edit`: `text`, `shown`; `Rule`: `operation`; `Revoke`: `sequence`; `Tell`: `words`; `Confirm`: `print`; the others none).
2. **`make(name, args, outlet, id, at): Readonly<object>`** and **`valid(value): Readonly<object>|null`** (the shape above, exact argument keys, `key` and `text` strings, `shown` a boolean or null, `operation` a plain object, `sequence` a safe integer, `words` a string of at most `TellLongest`, `print` a string, at most `LongestAsk` bytes).
3. **`put(storage, roomId, ask): void`** (refuses past `MostWaiting` waiting asks), **`waiting(storage, roomId): object[]`** (by `at`, then `id`; invalid values skipped), **`mark(storage, roomId, id): void`** (`sent: true`), **`take(storage, roomId, id): void`**; each change rewrites the signal.
4. **`apply(keeper, live, ask): Promise<string|null>`**: runs the ask on the reader's handles (`live.dismiss`, `live.told`, `live.edit`, `live.clear`, `live.force`, `keeper.rule`, `keeper.keepFirst`, `keeper.revoke`, `live.tell`, `live.confirm(print)`, `live.forget`) and answers null or the refusal's words.

### Changes in `ScribeLive.js`

1. **Settings** `AnsweredKept: 50`; `Messages.Changed: 'What the scribe understood has changed; look at it again before filing it.'`.
2. **`understood` moves into the record** (open question 4): `record.understood` replaces `live.understood` in `tell` (line 1577), `confirm` (line 1677), `forget` (line 1756), the new-edition reset in `active` (line 606) and `view` (line 1779); `tell` and `forget` save (`changed`); `load` (line 465) keeps it only when `operations` is an array of objects, `anchor` an object with a string `id` and a safe-integer `position`, and `mused`, `refused` and `lines` arrays (`lines` of strings); else null. `view().understood` gains `print`: `ScribeText.fingerprint(JSON.stringify(operations))`. **`confirm(live, print = null)`** throws `Error(Messages.Changed)` when `print` is given and differs from the current preview's.
3. **`record.answered`**: `[{ id, problem }]`, at most `AnsweredKept`, newest last; loaded with bad items dropped. Handle **`answer(id, problem)`** appends (dropping an older entry of the same ID) and saves; `view()` gains `answered` (the list).
4. **`reload(live): void`** (handle `reload`): on a part that is not active, `load` and `announce`; an active part does nothing (it is the writer).

### Changes in `ScribeCloud.js`

1. **Options** gain `visible()` (the document is not hidden), `answered()` (the IDs in the reader's `live` record), `waiting()` (this browser's local asks) and `asked(asks)` (hands the Worker's waiting asks to the reader). **Settings** gain `Paths.Ask: '/v1/scribe/ask'`, `WatchMs: 20000`, `AskedPollMs: 5000`, `StateName: 'cloudstate'`; `Phase` is unchanged.
2. **Watching** (design point 6): every `WatchMs`, `GET heads` and `settle` (moved kinds download, so every tab sees them); a null lease is taken at once (`POST lease`, then the heads again, then `Leading`); otherwise, when `visible()` or asked, `POST lease` with `Waiting` or `Asked` (open question 1). After each `live` download, local asks marked `sent` whose ID is in the downloaded `answered` are taken.
3. **`readHere(cloud): Promise<void>`** (handle `readHere`): sets `asked`, posts `Asked` at once, then polls every `AskedPollMs` until the lease names this browser (handed over) or is free (taken), then the heads and `Leading`. **Keep this PC's book** while another PC holds the lease calls it instead of throwing, then carries the answer out.
4. **Letting go** (open question 1): a renewal whose lease shows another browser's want, when `!busy()` and no flight is up, and when the want is asked or the tab is hidden: `push` with the quiet time ignored, then `DELETE lease`; `released` gives `Watching` and `notify()` (the keeper loses the reader role). A failed push keeps the lease and tries at the next renewal.
5. **Asks across PCs** (open question 3): a watching browser's chosen tab posts each local ask not yet `sent` (`POST ask` with `{ browser, id, action: { outlet, name, args, at } }`) and marks it; the holder's renewal answer's `asks` go to `asked(asks)`; each commit's `done` is the Worker asks whose IDs `answered()` holds.
6. **The other tabs' header**: the chosen tab writes `scribe:cloudstate:<room>` (`{ phase }`) on each phase change; on a tab that is not chosen, `view()` reports that phase as `elsewhere`, so it can say another PC reads.

### Changes in `ScribeBoot.js`, `ScribeStart.js`, the header and the pack

1. **Environment:** `listen: (name, callback) => GM_addValueChangeListener(name, callback)` and `unlisten: (id) => GM_removeValueChangeListener(id)` (`ScribeStart.js`); header grants `GM_addValueChangeListener` and `GM_removeValueChangeListener`; `Files` gains `scribe/page/ScribeAsks.js` right after `scribe/page/ScribeLive.js` (28 files).
2. **`listen(session): void`** (called in `begin` once the parts exist): listens to the four head names of the room, `scribe:spent:<room>`, `scribe:others:<room>`, the ask signal and the cloud state; the IDs are kept and removed in `close`.
3. **`hear(session, name, remote): void`**: a change the tab made itself (`remote` false) is ignored; the ask signal makes the reader `answer` and the others redraw; any other name, on a tab that is not the reader, runs `keeper.tick()` (its watch loads storage and tells the panel) and `live.reload()`, then redraws: same-browser tabs update at once (design point 3), not at the next 20 s tick.
4. **`answer(session): Promise<void>`** (on the reader, one run at a time): the local waiting asks and the Worker asks handed over by `asked`, skipping IDs already in `live.view().answered`; each in order through `ScribeAsks.apply`, then `live.answer(id, problem)`, then `ScribeAsks.take` for a local one. Called by the tick, by `hear` and by `asked`.
5. **The panel** gets `defer: (name, args, outlet) => <make and put an ask; answer its id>` and `waiting: () => ScribeAsks.waiting(storage, roomId)`; the cloud gets `visible`, `answered`, `waiting` and `asked`.

### Changes in the panel

- **`perform`** (line 2587): a request gains `defer: { name, args }|null`. When the keeper view is not the reader and `defer` is set, nothing is called: `panel.defer(...)` stores the ask, `panel.asked` remembers `{ id, done }` for the outlet, and the outlet says `Words.Queued` (`'Waiting for the tab that reads this chat.'`) or `QueuedPc` (`'Waiting for the PC that reads this chat.'`, when the cloud is `Watching`). The call sites that pass `defer`: `rule` (line 2644, also used by the Book tab's add, remove, make public and split), `keepFirst` (line 2911), the revoke row (line 4500), the findings remedies (line 4635: `Dismiss`, `Told`), `force` (line 2737), Tell's **Work it out** (line 2783) and **File it** (line 2805, with the preview's `print`), **Forget** (line 3366). **Clear** (line 1867) and the reminder box's **Save** (`closeEdit`, line 2717) defer directly through the same helper when not the reader.
- **Pending until the result arrives** (design point 7): each redraw, an outlet in `panel.asked` whose ask still waits keeps its words and its control disabled; once the ask is gone and `live.answered` holds its ID, a problem fails the outlet and none says the remembered done words; an ask gone with no answer yet keeps waiting.
- **`lock`** (line 2485): the controls of the actions above stay enabled on a tab that is not the reader (unless their outlet waits); Adopt, Resume, Pause, Pull, Suggest, Use, Ignore, Save settings and Save key keep their guards.
- **Read here**: a header button `Ids.ReadHere: 'scribe-read-here'` (`Words.ReadHere: 'Read here'`, primary, `Guard.Free`) shown on the chosen tab while the cloud is `Watching`, with the outlet `Outlets.ReadHere: 'read-here'` saying `'Asked the other PC to let go: it does when it is not reading, or within 90 seconds if it is off.'`; the headline on other tabs says another PC reads when `elsewhere` is `Watching`.
- `tests/support/PanelLive.mjs` gains `answer`, `reload` and `answered` in its view; `PanelCloud.mjs` gains `readHere`.

### Left to the builder

The pending and Read here sentences within the meanings above; whether `hear` coalesces several names changed in one save into one redraw.

### Tests that try to break it

`tests/support/FakeStorage.mjs`: listeners per name and per tab, called in a microtask with `remote` true for another tab's write; `tests/support/WholeTab.mjs` passes the writing tab.

`tests/scribe-asks.test.mjs`: every name with good and bad arguments (missing, extra, wrong type, a 2,001-character Tell, an 8,193-byte ask); `put` refuses the 21st; `waiting` orders by time then ID and skips junk values one by one; two tabs putting at once keep both; `apply` calls exactly the right handle method with the arguments and returns a thrown refusal's words.

`tests/scribe-live.test.mjs`: the understood preview survives a reload and reaches a watching part; a confirm with a stale `print` throws `Changed` and files nothing; a new edition clears it; `answered` keeps 50, newest last, one per ID; junk `understood` and `answered` load as null and empty; `reload` reloads a watching part and leaves an active one alone.

`tests/scribe-cloud.test.mjs`:
- **Read here:** PC B asks; PC A, visible and idle, lets go at its next renewal; B holds the lease, reads the heads, leads; nothing A had unsent is lost (it went up before the hand-off).
- **No paid reading is thrown away:** with A's `busy()` true, A keeps the lease until it is false.
- **Hidden and idle:** B visible sends a plain want; A visible keeps the lease; A hidden and idle lets go; A hidden but reading does not.
- **Expired:** A closed; B takes the lease 90 s after A's last renewal, not before.
- **A lapsed want** (B gone for 91 s) is not handed over: A keeps leading.
- **Polling:** a watching PC reads the heads every 20 s, downloads only kinds whose revision moved, and makes no request for unchanged heads beyond the one read.
- **Asks:** a watcher's local ask is posted once and marked; the holder receives it with the renewal; the commit carries its ID in `done`; the watcher takes it after the `live` download that answers it.

`tests/scribe-boot.test.mjs`: the listeners are registered for the named values and removed on close; a remote change on a watching tab ticks the keeper and reloads the live part at once; a change the tab made itself does nothing; the reader answers local and Worker asks in order, skips answered IDs, records each outcome and takes local asks; two signals at once answer once.

`tests/scribe-panel.test.mjs`: on a watching view each deferrable action stores an ask (exact name and arguments) and says the waiting words at once, its control disabled; the outcome replaces them when `answered` arrives, a problem as a failure; Adopt, Pause and Suggest stay disabled; Read here shows only on the chosen tab while watching, says its words at once on press; phone width has no horizontal scroll.

`tests/scribe-pack.test.mjs`: 28 files, `ScribeAsks` right after `ScribeLive`; the two listener grants used and granted.

`tests/scribe-whole.test.mjs`:
- **Same-browser tabs redraw at once:** a second tab on the reading PC shows a new finding before the clock moves a tick.
- **A takeover with Read here, an expired lease, a hidden idle holder:** the three walks above on two PCs, with no model call by the PC taking over.
- **Watcher actions:** on PC B, Dismiss, a ruling, Edit and Save, and Tell the scribe (Work it out, then File it) each show waiting, then their result on both PCs; a refused ruling shows its refusal on B; each is applied once.

### Commands

```
NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 120 node --test --test-timeout=20000 tests/scribe-asks.test.mjs
... scribe-live, scribe-cloud, scribe-boot, scribe-panel, scribe-pack, scribe-whole
node scribe/pack.mjs
```

### Done when

The seven files pass, the userscript is rebuilt, the README describes Read here, the hand-off and watcher actions, and the verification record has the counts. After the operator installs it: a takeover with Read here between two real PCs, and one watcher action, noted with what each PC showed.
