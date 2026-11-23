# Universe sync rewrite plan

Design: `docs/superpowers/specs/2026-11-22-sync-rewrite-design.md`.

Operator rulings, 2026-11-22: no lock; SillyTavern hooks removed; design approved ("Go"); storage growth option 1 (keep the newest 100 saves), taken from that "Go"; deletion allowed in `universe/src/` and `universe/tests/`.

## Conventions

- Node built-ins only. No dependency is added or changed.
- One exported declaration per file: a class, or a frozen object of functions. New sync modules live in `src/sync/`.
- Tag-only docblocks (`@param`, `@returns`, `@throws`) on every function and method, no prose comments, braces always, no single-letter variables, no single-use wrappers, no swallowed errors.
- Code first, then tests that try to break it. Tests use `node:test`, temporary folders under `os.tmpdir()` that the test removes, the in-memory bucket from Task 1 and a fake child. Run each test file on its own:
  `NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 120 node --test tests/<file>`
- No agent runs `npm start`, `npm ci`, `npm run build` against the project, touches `universe/local/`, reads `.env`, or contacts R2. Git stays read-only.

## Values (`src/sync/SyncSettings.mjs`, one frozen object)

| Name | Value |
| --- | --- |
| `Concurrency` | 6 |
| `ControlTimeoutMs` | 15000 |
| `ObjectTimeoutMs` | 120000 |
| `RetryDelaysMs` | 1000, 2000, 4000, 8000, 16000, then 30000 repeated |
| `StartContactMs` | 120000 |
| `TransferGiveUpMs` | 600000 (save retry window and mid-pull outage) |
| `StopBudgetMs` | 120000 |
| `SaveIntervalMs` | 900000 |
| `AncestorLimit` | 100 |
| `KeepSaves` | 100 |
| `BlobMinAgeMs` | 86400000 |
| `SettleAttempts` | 3 |
| `ConsoleProgressMs` | 5000 |
| `RootExcluded` | `_cache/`, `_webpack/`, `_uploads/`, `_errors/`, `cookie-secret.txt`, `content.log`, `access.log`, `heartbeat.json`, `.universe-story-root` |
| `UserExcluded` | `backups/`, `thumbnails/`, `assets/temp/` |
| `TempFilePattern` | `/\.\d+$/` on the file name |

## Task 1: scope, safe scan, cloud store

Files:

- `src/r2.mjs`: the request options gain `timeoutMs` (default 15000) used by `AbortSignal.timeout`. Nothing else changes in this task.
- `src/sync/SyncSettings.mjs`: the table above.
- `src/sync/SyncScope.mjs`, frozen: `isValid(path): boolean` (relative, non-empty, no `..`, `\`, NUL or empty segment); `includes(path): boolean` (valid and not excluded per the design's scope rules); `entries(list): Array<{path, hash, size?}>` (throws `Error('Invalid path in cloud manifest: <path>')` on the first invalid path, drops out-of-scope entries and folder entries).
- `src/sync/ProfileScan.mjs`, frozen: `scan(dataRoot, known): Promise<{files: Map<string, {hash, size, mtimeMs}>, unsettled: string[], blocked: string|null}>`. Walks the data root without following links; stops at the first symbolic link or special file in scope and returns its path as `blocked`. Reuses `known[path].hash` when size and `mtimeMs` match. Reads by stat, read, stat, up to `SettleAttempts`; `.json` must parse and every non-empty `.jsonl` line must parse. A file that never settles keeps its `known` entry (if any) and is listed in `unsettled`. A file that vanishes is absent. `read(dataRoot, path): Promise<{bytes, hash, size, mtimeMs}|null>` applies the same rules to one file and returns `null` if it is absent or unsettled.
- `src/sync/Retry.mjs`, frozen: `run(operation, {giveUpMs, clock, onWait}): Promise<value>`. Retries on thrown network errors and HTTP 5xx or 429 with `RetryDelaysMs`; rethrows other errors immediately and the last error when `giveUpMs` runs out. `onWait({attempt, error, nextMs})` feeds the status.
- `src/sync/CloudStore.mjs`, class `CloudStore(transport)`. Single attempts only (retry is the caller's), each with its timeout:
  - `readControl(): Promise<{exists, head, etag, now}>` (keeps the strong-ETag and shape validation of the old `control()`);
  - `setHead(control, head): Promise<boolean>`: compare-and-set writing `{version: 1, change: <uuid>, head, lease: null}`, `false` on 409 or 412;
  - `bucketEmpty(): Promise<boolean>`;
  - `manifest(id): Promise<{id, parent, files}>` (validates `version` 1 or 2, `id`, `parent`; `files` through `SyncScope.entries`);
  - `putManifest(manifest)`: immutable put of `{version: 2, id, parent, files}` where `files` carry `path`, `hash`, `size`;
  - `blob(hash): Promise<Buffer>` verified against the hash; `putBlob(hash, bytes)`: `If-None-Match: *`, 409 or 412 accepted;
  - `hasAncestor(head, id): Promise<boolean>`: walks parents from `head`, at most `AncestorLimit` steps.
- `tests/support/MemoryBucket.mjs`: an in-memory R2 behind the transport signature `(method, key, options)`, returning `Response` objects with `date` and strong `etag` headers, honouring `match`, `absent`, `list` and `timeoutMs`. Fault switches: `failNext(count)` throws `TypeError('fetch failed')`; `loseReplyNext()` applies the next write and then throws; `status(key, code)` forces one status.

Tests that try to break it:

- `tests/sync-scope.test.mjs`: every excluded root entry and user entry; `default-user/chats/backups/x.jsonl` stays in; `settings.json.12345` is out; traversal, backslash, NUL, empty segment and absolute paths are invalid; `entries` drops the current head's `_webpack/`, `backups/` and folder entries and rejects a traversal path.
- `tests/profile-scan.test.mjs`: a file rewritten between stat and read settles on the second attempt; one rewritten every attempt is `unsettled` and keeps its known entry; a truncated `.json` and a `.jsonl` with a broken line are unsettled; a write-file-atomic temp file is ignored; a symlinked folder in scope is `blocked`; a file deleted during the walk is absent; unchanged size and time reuse the known hash without reading the file.
- `tests/cloud-store.test.mjs`: compare-and-set loses to a concurrent writer; a weak or missing ETag is rejected; a blob whose bytes do not match is rejected; an existing blob upload is accepted; a manifest with a traversal path throws before returning; `hasAncestor` stops at 100 steps and on a cycle; `Retry.run` survives twenty `fetch failed` errors, gives up after `giveUpMs` with a fake clock, and does not retry a 403.

## Task 2: pull and save

Files:

- `src/sync/SyncState.mjs`, frozen: `read(stateRoot, bucket): Promise<{bucket, revision, pending, files}|{mismatch: string}|null>`, including the migration from `journal.json` (format 2 uses `journal.files`; otherwise the files are resolved later from the cloud manifest, marked `files: null`); `write(stateRoot, state)` by temp file and rename.
- `src/sync/ProfileSync.mjs`, class `ProfileSync({dataRoot, stateRoot, bucket, cloud, clock, onStatus})`:
  - `start(): Promise<{changedFiles: number, offline: boolean, disabled: string|null}>`: design steps 1 to 7 (filesystem probe, contact with `StartContactMs`, `pending` resolution, empty-folder guard, pull table, ordering, conflicts folder naming, downloads with `Concurrency`, cookie-secret rotation when files changed, `sync.json`). Throws `Error('Pull stopped at <path>: <reason>')` when a pull cannot finish.
  - `save(reason): Promise<{outcome: 'saved'|'unchanged'|'conflict'|'failed'|'blocked', at, error}>`: design save steps 1 to 6 with `TransferGiveUpMs`; one save at a time, one queued follow-up; after a conflict every later call returns `conflict` without contacting the cloud.
  - `onStatus` receives `{phase, progress, lastSavedAt, unsavedSince, error, conflictAt, conflictsFolder, reloadTabs}` changes.

Tests that try to break it (`tests/profile-sync.test.mjs`), design test numbers in brackets: fresh pull with out-of-scope head entries [1]; the 2026-11-22 situation [2]; other PC saves first, conflict at the next save with no local change, restart moves changed files and replaces the cookie secret [5]; offline start then newer head [6]; transport dies half-way through a pull, rerun converges [7]; lost head-update reply and crash before `sync.json` [8]; deletions, renames, a new local-only file, a file replacing a folder [9]; traversal manifest touches nothing [10]; emptied data folder [11]; unsettled and temp files never uploaded [12]; two pulls in the same second [13]; offline migration from a format-2 journal [14]; an unchanged save makes zero bucket requests beyond the one control read.

## Task 3: launcher, child, server, build, deletions

Files:

- `src/launcher.mjs`: rewritten around `ProfileSync`. Keeps `projectConfiguration`, `configuration` and the `runLauncher(config, signal, onState, dependencies)` signature (`dependencies`: `startChild`, `transport`, `clock`, `onSaveReady`). Flow: local-only mode, `start()` (offline start keeps contacting in the background and triggers `save('reconnect')` on first contact), start the child, `SaveIntervalMs` timer, `onSaveReady(() => sync.save('manual'))`, stop sequence inside `StopBudgetMs`, the console lines from the design, a progress line every `ConsoleProgressMs` during transfers. SillyTavern exiting by itself is treated like Ctrl+C.
- `src/child.mjs`: plain `spawn` of `server.js` with today's arguments and environment and no preload or IPC; returns `{pid, finished, stop()}` where `stop()` sends SIGTERM, then SIGKILL after 15 seconds.
- `src/server.mjs`: imports `readFileSync` instead of `story-files.mjs`; `POST /save` starts a save and answers 202 at once (local-only 503, rate limit unchanged); `/status` returns the design's fields plus `ok` for `running`; the 60-second deadline and old outcome table are removed.
- `scripts/build.mjs`: `sources` lists the new files (`server.mjs`, `launcher.mjs`, `child.mjs`, `r2.mjs`, `wrapper-home.html`, `sync/*.mjs`); signature `Universe local build v6`, with v5 recognised as a previous build to replace; `tests/build.test.mjs` updated.
- Deleted: `src/child-preload.mjs`, `src/checkpoint-store.mjs`, `src/local-session.mjs`, `src/story-files.mjs`, `src/classes/capture-gate.mjs`, `src/classes/cloud-save.mjs`, `src/integration/` (three files), `tests/barrier.test.mjs`, `tests/checkpoint-store.test.mjs`. `tests/launcher.test.mjs` rewritten.

Tests that try to break it (`tests/launcher.test.mjs`): crash restart with rebuilt caches and unsaved edits [3]; twenty failures mid-session, the child is never stopped [4]; stop with the network down prints the failure and the next start uploads [15]; Ctrl+C during a running save stays inside the stop budget; bucket mismatch and a case-insensitive probe disable sync but start the child; local-only mode never builds a cloud store; `/save` answers 202 and a second press during a save queues one follow-up; build output contains no removed file and v5 output is replaced.

## Task 4: wrapper page and documentation

Files:

- `src/wrapper-home.html`: polls `/status` every 2 seconds; progress bar and counts during transfers; the latest message, last saved time and conflict text beside **Save now**; the button shows **Saving...** at once and is disabled while a save runs; phone-first layout; styles in the nonce'd stylesheet with colour tokens, visible focus, reduced motion respected.
- `README.md`: cloud handoff and recovery rewritten for the new rules: update both PCs together, the conflicts folder, reloading tabs after a pull, the old `local/data.universe/checkpoints/` folder may be deleted, plain-SillyTavern fallback command.
- `docs/superpowers/specs/2026-11-22-r2-checkpoints-design.md`: first line marks it superseded by the sync rewrite design.

Tests: the page is served with its CSP and contains no inline `style` attributes; `/status` JSON carries every field the page reads.

## Task 5: keep the newest 100 saves

Files:

- `src/r2.mjs`: `list` takes `{prefix, token}` and returns all keys page by page; `DELETE` supported.
- `src/sync/CloudStore.mjs`: `listObjects(prefix): Promise<Array<{key, lastModified}>>`, `deleteObject(key)`.
- `src/sync/Pruner.mjs`, frozen: `prune(cloud, head, now): Promise<{manifests, blobs}>`. Keeps the newest `KeepSaves` manifests on the parent chain from `head` and every blob they use; deletes other manifests and blobs only when older than `BlobMinAgeMs`. Runs after the first successful save of a launcher run and then at most once every 24 hours (`prunedAt` in `sync.json`). A failure is reported in the status and never fails the save.

Tests that try to break it (`tests/pruner.test.mjs`): 150 saves leave 100 manifests and exactly their blobs; a blob younger than a day survives although unreferenced; a manifest of a concurrent save from the other PC younger than a day survives; listing across several pages; a delete failure leaves the save outcome `saved`.

## Execution

One task at a time: an implementer subagent (Opus) builds it, an adversarial Opus reviewer tries to break it, the orchestrator checks each finding against the code, the hand-off opens with "Commit-ready." or "NOT commit-ready: <what is missing>", the operator commits, and only then is the next task proposed. Briefs, reports and the ledger live in `~/.claude/projects/-var-www-demo-stuff/sdd-snapshots/sync-rewrite/`.
