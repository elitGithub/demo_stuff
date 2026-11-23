# Universe sync rewrite

Status: draft for operator approval, builder review folded in. Supersedes the lease, capture barrier and journal parts of `2026-11-22-r2-checkpoints-design.md` and the cloud parts of `2026-11-21-universe-scaffold-design.md`.

## Why

On 2026-11-22 the current launcher failed in normal use:

1. A PC that last synced with the old five-folder format could not pull the newer full-profile save. `restore()` compared every local file against the old six-file list and the cloud list, and stopped on SillyTavern's own `_cache` file.
2. A fresh restore ran at about 3 files a second and showed no progress, so it looked hung. The cloud save carried 104 settings backups of about 9 MB each (Tavern Scenario Builder keeps a 9.3 MB `savedSession` in `settings.json` and SillyTavern backs it up on every change) and 20 MB of `_webpack` build cache.
3. One failed R2 request ("fetch failed") made the lease renewal fail, and the launcher shut SillyTavern down.
4. The restart refused with "Local story differs from its last acknowledged state" because SillyTavern had rebuilt its caches. The chat itself was unchanged. This happens after every crash.
5. A session that exited without saving left its lease in the cloud, and the next start refused with "Another launcher holds the cloud save lease".

## Rules (operator rulings, 2026-11-22)

1. Sync only story data. Machine-local caches and SillyTavern's `backups/` stay out.
2. On start the cloud wins when it is newer. Local files that changed since this PC's last sync are moved into a dated conflicts folder, never deleted. When the cloud has not moved since this PC's last sync, the local copy wins and goes up with the next save.
3. A network failure never stops SillyTavern.
4. Transfers run in parallel and show progress.
5. No lock. Two PCs may run at once. A save only lands if the cloud has not moved since this PC's last sync; otherwise this PC keeps playing, keeps its changes, and is told to restart to pull.
6. SillyTavern runs unmodified. Node only copies its files to and from the cloud: every 15 minutes, on **Save now**, and on stop. The hooks inside SillyTavern and the browser are removed.

## Requirements

- Linux on both PCs, with `local/data` on a case-sensitive filesystem. Start-up checks this by creating `local/data.universe/case-probe` and looking up `CASE-PROBE`; if both resolve to one file, sync is disabled and the status says why. SillyTavern still starts.
- Both PCs run the new launcher. The old launcher rejects manifests without folder entries and expects a lease, so the README says to update both PCs before the next handoff.

## Kept

- The cloud layout under `_universe/v2/` in the configured bucket: `control.json` (`{version: 1, change, head, lease}`, updated by ETag compare-and-set), `blobs/<sha256>` and `manifests/<id>.json` (`{version: 2, id, parent, files}`). The current head stays readable, so nothing is re-uploaded. New code always writes `lease: null` and ignores any lease it reads.
- `src/r2.mjs` (SigV4 transport and credential parsing), changed so each request passes its own timeout instead of the fixed 15 seconds at line 71.
- `src/server.mjs` (wrapper home page, `/status`, CSRF-protected `POST /save`), reworked for the new statuses below.
- The build script, the pinned SillyTavern, Scenario Builder and Vocalia packages, `.env` handling and the `local/` layout.
- The guard that refuses to use a bucket without `control.json` that already holds other objects. It now disables sync with a status message instead of stopping start-up.

## Removed

- The cloud lease and its 60-second renewal.
- `src/child-preload.mjs`, `src/integration/browser-bridge.js`, `src/integration/pinned-hooks.mjs`, `src/integration/server-bridge.mjs`, `src/classes/capture-gate.mjs`, and the `--import` preload, IPC channel and handshake in `src/child.mjs`.
- `src/checkpoint-store.mjs`, `src/local-session.mjs`, the local journal, the `.universe-story-root` identity file, the old five-folder format, standalone mode, the legacy `config.yaml` copy and the legacy `sillytavern/` and `runtime-data/` checks. A second launcher on the same PC already fails on the busy wrapper port.
- Folder entries in manifests. Folders are created as files need them; folder entries in existing manifests are ignored.
- `tests/barrier.test.mjs`, `tests/checkpoint-store.test.mjs` and the cases in `tests/launcher.test.mjs` that cover removed behaviour.
- The old staging folder `local/data.universe/checkpoints/` stays on disk; the README tells the operator it can be deleted.

Deleting these files needs the operator's deletion permission for `universe/src/` and `universe/tests/`.

## Sync scope

Paths are relative to `local/data` and use `/`. A file is synced unless it matches one of these:

- at the root: `_cache/`, `_webpack/`, `_uploads/`, `_errors/`, `cookie-secret.txt`, `content.log`, `access.log`, `heartbeat.json`, `.universe-story-root`;
- exactly at `<user>/backups/`, `<user>/thumbnails/` and `<user>/assets/temp/`, where `<user>` is a top-level folder whose name does not start with `_` (for example `default-user`). A folder named `backups` deeper down, such as `default-user/chats/backups/`, is synced;
- any file whose name ends in `.` followed only by digits (write-file-atomic's temporary files, `<target>.<number>`).

`_storage/` (account records) and `_css/` (user stylesheet) are synced. Settings snapshots made with SillyTavern's **Make snapshot** live in `backups/` and therefore stay on the PC that made them.

Only regular files are synced. A symbolic link or special file inside the scope makes that save stop with a status naming the path, so a swapped folder can never look like a mass deletion. A file that disappears between listing and reading is treated as absent.

Reading a manifest: an entry with an invalid path (absolute, empty, containing `..`, `\`, a NUL byte or an empty segment) rejects the whole manifest before any file is touched. A valid entry outside the scope is ignored. This lets the current head, which contains `_webpack/`, `backups/` and `cookie-secret.txt`, be pulled. New manifests never contain out-of-scope entries, and each entry carries `size` as well as `path` and `hash`.

## Reading files safely

SillyTavern writes most files through write-file-atomic (temp file and rename), but some it writes in place: `_storage/` (node-persist `fs.writeFile`), `user/images/`, `backgrounds/`, sprites, `assets/`, vector `index.json`, imported or renamed chats, duplicated cards and restored settings snapshots. So the scan reads every file as: stat, read, stat. If the size or modification time changed, it reads again, up to three times; if it never settles, that file keeps its last synced version in this save and is retried next time. A `.json` file must parse and every non-empty line of a `.jsonl` file must parse; if not, the same rule applies. A half-written file never goes up.

## Local state

`local/data.universe/sync.json`, written by temp file and rename:

```json
{ "bucket": "<account>/<bucket>", "revision": "<manifest id or null>", "pending": null,
  "files": { "<path>": { "hash": "<sha256>", "size": 123, "mtimeMs": 1700000000000 } } }
```

`revision` is the cloud manifest this PC last pulled or saved (B below). `files` is that manifest's list plus the size and modification time seen when each file was hashed, so a scan only rehashes files whose size or time changed. `pending` holds `{ id, files }` of a save whose manifest is uploaded but whose head update is not yet confirmed. The file changes only after a confirmed pull or save.

If `bucket` differs from the configured bucket, sync is disabled with a status naming both, and SillyTavern still starts.

Migration: when `sync.json` is missing and the old `local/data.universe/journal.json` has a `base`, B is that id. Its file list is `journal.files` when `journal.format` is 2, otherwise the cloud manifest. If neither is available (offline with an old journal, or no journal), B is unknown.

If the local scope holds no files while B lists files, B is treated as unknown for this start. An emptied or unmounted data folder therefore pulls the cloud copy and is never saved as "everything deleted".

## Start

1. Load the configuration and `sync.json`, check the filesystem, scan the local scope.
2. Read `control.json`, retrying with backoff for up to 2 minutes. If the cloud stays unreachable, start SillyTavern on the local files with the status **Cloud unreachable: not pulled**, and keep retrying in the background. The first successful contact runs the save step, which reports a newer cloud as a conflict.
3. Resolve `pending`: if the cloud head is `pending.id`, or `pending.id` is among the head's first 100 ancestors, the earlier save landed and B becomes `pending`. Otherwise `pending` is dropped.
4. If the cloud head H is null or equals B, nothing is pulled.
5. Otherwise pull H. For every path in the local scan or in H:

| Local file | Action |
| --- | --- |
| equal to H's copy | nothing |
| equal to B's copy, or absent locally | take H's copy; if H has none, delete the local file |
| present locally, absent from both B and H | keep it; it goes up with the next save |
| different from B's copy (or B unknown) and different from H's | move it to the conflicts folder, then take H's copy if H has one |

   Order: first all deletions and moves into the conflicts folder; then remove folders left empty by them, deepest first; then write H's files. A folder that blocks a file path is therefore gone before the file is written.

   The conflicts folder is `local/conflicts/<UTC time as YYYY-MM-DDTHH-mm-ss-SSSZ>/`; if that name exists, `-2`, `-3` and so on are added. A move never replaces an existing file.

   Downloads run six at a time. Each blob is checked against its hash, written to a temp file beside the target and renamed into place.

   If the pull cannot finish (a disk error, or the cloud unreachable for 10 minutes in the middle of it), start-up stops with the path and the reason, and SillyTavern does not start on a half-pulled folder. The next start resumes the pull: B is unchanged, files already written equal H and are skipped, and files already moved aside are absent locally. Nothing is lost or moved twice.

6. If the pull changed any file, write a new random value into `local/data/cookie-secret.txt` before starting SillyTavern. Every browser tab still open from before then loses its session, so it cannot write its old copy of a chat or settings over the pulled files. The console and the wrapper home page say **Reload any open SillyTavern tabs**.
7. Record B = H in `sync.json`, then start SillyTavern.
8. If the local scan differs from B, run a save straight away.

## Saves

Triggers: a 15-minute timer, **Save now**, and stopping. One save runs at a time; a request during a save queues exactly one follow-up.

1. Read `control.json`. If its head is neither B nor `pending.id`, this is a conflict (below). This one read per timer tick lets a PC that started offline, or runs alongside the other PC, learn early that the cloud moved.
2. Scan. If every path and hash equals B, report **Up to date** and stop.
3. Upload the blobs not present in B or H, six at a time. Each file is read once by the safe-read rule; those bytes are hashed and uploaded, and that hash and size go into the manifest. Uploads use `If-None-Match: *`; a 409 or 412 means the blob already exists and is accepted.
4. Upload `manifests/<id>.json` with `parent` = B, then record `pending` in `sync.json`.
5. Compare-and-set `control.json`: if its head equals B, set head to the new id. On success, record B = new manifest and clear `pending`. If the request fails or its reply is lost, re-read `control.json`: a head equal to `pending.id` counts as success; a head with `pending.id` among its first 100 ancestors means the save landed and the other PC has saved since, so record B = `pending` and report a conflict.
6. **Conflict:** the status shows **The other PC saved newer changes at <time>. This PC's changes stay here. Restart Universe to pull; files changed on both PCs go to local/conflicts.** Automatic saves stop until restart, and **Save now** reports the same message. SillyTavern keeps running.

## Network failures

- `control.json` requests time out after 15 seconds; blob and manifest requests after 120 seconds.
- A failed request is retried after 1, 2, 4, 8, 16 and then every 30 seconds. A save keeps retrying until it succeeds, hits a conflict, the launcher stops, or 10 minutes pass; then it reports **Not saved since <time>: <reason>** and tries again at the next trigger.
- Nothing in the sync path stops SillyTavern.

## Stopping

Ctrl+C, or SillyTavern exiting, stops SillyTavern first, waits for a save already running, then runs the final save, all within 2 minutes in total. The console prints **Saved to cloud at <time>**, or **NOT SAVED TO CLOUD: <reason>. The changes stay on this PC. They go up the next time Universe starts here, unless the other PC saves first; then files changed on both PCs go to local/conflicts.**

## Local-only mode

With all four R2 values blank, Universe starts SillyTavern and does no sync; `sync.json` is neither read nor written, and the status says **Cloud save is not configured**.

## Progress and status

`/status` returns `phase` (`pulling`, `running`, `saving`, `stopping`, `stopped`, `offline`, `conflict`, `disabled`, `failed`), `progress` (`filesDone`, `filesTotal`, `bytesDone`, `bytesTotal`) during transfers, `lastSavedAt`, `unsavedSince`, `error`, `conflictAt` and `conflictsFolder`. `bytesTotal` counts entries that carry `size`; older entries count towards files only. The wrapper home page polls `/status` every 2 seconds and shows a progress bar during transfers and the latest message beside **Save now**. During transfers the console prints a progress line every 5 seconds.

## Open ruling: cloud storage growth

Nothing deletes old blobs or manifests. Every save that changes `settings.json` uploads it again, and Scenario Builder makes it 9.3 MB. At one changed save every 15 minutes that is about 37 MB per hour of play, so R2's 10 GB free storage lasts roughly 270 hours of play. Options:

1. **Keep the last 100 saves (recommended).** After each successful save, delete manifests older than the newest 100 and blobs that no kept manifest uses. A blob uploaded less than a day ago is never deleted, so a save the other PC is still uploading is safe. At most about 1 GB with today's settings file.
2. Keep everything and show bucket size on the wrapper page; decide later.

## Other code the rewrite changes

- `scripts/build.mjs`: the file list (lines 17-22, 171) and the build signature, moved to v6 so `--if-missing` does not reuse the v5 `dist` with the old launcher; `tests/build.test.mjs` updated to match.
- `src/server.mjs`: save outcomes, the `ok` phases, the old 60-second deadline and console texts; its import from `story-files.mjs`.
- `src/wrapper-home.html`: status polling and the progress bar.
- `src/child.mjs`: plain spawn of SillyTavern with the same arguments and environment, minus the preload and IPC.

## Size

The scan, pull, save and cloud store came to about 1,350 lines of source after review (`src/sync/` plus `r2.mjs`), against an original target of 800; the operator accepted this on 2026-11-23. The launcher, child and server are rewritten small on top of them, replacing about 2,900 lines of the old sync.

## Tests

Node's test runner with temporary folders, an in-memory R2 transport that can fail on demand, and a fake SillyTavern child. Every run uses the memory limit and kill timeout from the workspace notes. Each case is a test:

1. Fresh PC: the pulled scope matches the cloud byte for byte; out-of-scope entries in the cloud head are ignored; excluded local paths are untouched; progress reaches its totals.
2. The 2026-11-22 situation: an old five-folder journal, a different local `_cache` and a full-profile head with `_webpack/` and `backups/` entries. The pull succeeds, the cache is untouched, changed in-scope files are in `local/conflicts/`.
3. Restart after a crash with rebuilt caches and unsaved chat edits, cloud unchanged: SillyTavern starts and the edits go up.
4. Twenty failed requests in the middle of a session: SillyTavern keeps running and the save lands once requests succeed.
5. The other PC saves first: conflict reported at the next timer tick even with no local changes; cloud head and local files untouched. Restart: changed local files in `local/conflicts/`, cloud copies in place, `cookie-secret.txt` replaced.
6. Offline start, then the cloud returns with a newer head: conflict reported.
7. The transport fails half-way through a pull: SillyTavern does not start; the rerun converges with nothing lost or moved twice.
8. Lost reply to the head update, and a crash before `sync.json` is written: no conflict reported, nothing pulled.
9. Deletions and renames propagate both ways; a new local-only file survives a pull; a file replacing a folder of the same name is written.
10. A manifest with a traversal path, a backslash or an empty segment is rejected before any file is touched.
11. Emptied data folder with an intact `sync.json`: the cloud copy is pulled and no deletion is saved.
12. A file rewritten during the scan, a half-written `.json` and a write-file-atomic temp file: none goes up.
13. Two pulls in the same second get separate conflicts folders.
14. Migration from a format-2 `journal.json` while offline uses `journal.files`.
15. Stop with the network down: the message names the failure, and the next start uploads the changes.
16. If the storage ruling is option 1: the newest 100 saves and every blob younger than a day survive pruning.

## Documentation

Rewrite the README's cloud handoff and recovery sections for these rules, including updating both PCs together and reloading open tabs after a pull. Mark `2026-11-22-r2-checkpoints-design.md` as superseded by this design.
