# SQLite sandbox storage verification

Date: 2026-10-19. Scope: local results for the move from the hand-rolled filesystem
registry to plain SQLite in both runtimes. Hosted acceptance is pending the
operator; no upload or hosted check is claimed here. The public listing stays
blocked until hosted acceptance evidence is recorded.

Design: `docs/superpowers/specs/2026-10-19-sqlite-sandbox-storage-design.md`.
Plan: `docs/superpowers/plans/2026-10-19-sqlite-sandbox-storage.md`.

## Environment

Node 24 with `node:sqlite`; PHP CLI 8.4 with PDO SQLite. These local capabilities
do not establish hosted capabilities, and `pdo_sqlite` on the hosting account is
still to be confirmed with `deploy/infinityfree/sqlite-check.php`. No application
database or production file was read. Tests create and remove only their own
temporary folders under `storage/test-runs/`.

## Executed local checks

Commands run from `travel-business/`:

| Command | Actual result |
| --- | --- |
| `node --disable-warning=ExperimentalWarning --test tests/sandbox-runtime.test.mjs tests/store.test.mjs tests/contracts.test.mjs tests/site.test.mjs tests/package.test.mjs` | Exit 0; 45 tests, 45 pass, 0 fail. |
| `php -l` on `SandboxConfig.php`, `SandboxRegistry.php`, `VisitorStore.php` and `tests/php/SandboxRuntimeTest.php` | No syntax errors. |
| `php -d zend.assertions=1 -d assert.exception=1 -d open_basedir=<package, src, config, tests/php, storage/test-runs> tests/php/SandboxRuntimeTest.php` | Exit 0; 14 tests PASS, 150 PHP runtime assertions passed. |
| `grep -rn "lockWaitMilliseconds\|registry.json\|runtime.lock\|SandboxQueue\|SandboxState\|preflight" src deploy bin tests config README.md` | Only the intended matches remain: the stale-class cleanup step in `DEPLOY.md`, the stale-class sentinels in `tests/infinityfree.py`, the preflight-absence checks in `tests/package.test.mjs`, and the removed-key assertion in `tests/contracts.test.mjs`. |
| `python3 tests/infinityfree.py` | Exit 0; 121 hosting checks passed, including `PASS no PHP runtime warnings or fatals`. |
| `node --disable-warning=ExperimentalWarning --test tests/package.test.mjs` (re-run after packaging) | 2 tests, 2 pass. |

`npm test` was not run for this task.

## What the Node tests pin

- Request flow on `registry.sqlite`: identity rules, sliding activity, exact idle
  boundary, admitted business errors renewing activity, rejected admission not
  renewing it, and rate limits surviving cookie resets and restarts.
- Two visitors with overlapping record IDs never see each other's data.
- Cleanup removes at most `cleanupBatch` rows and files per request and leaves
  unrelated files in the folder alone.
- A live row whose file is gone returns 503 `unavailable` and the file is not
  recreated; opening an existing visitor database never creates it.
- A held registry or visitor write lock returns 503 `busy` with `Retry-After: 2`
  once `busyTimeoutMilliseconds` passes.
- An undeletable expired file is logged with `Sandbox cleanup failed.`, its row is
  removed and the request succeeds; the orphan is never reattached.
- A corrupt `registry.sqlite` and a missing sandboxes folder return 503
  `unavailable` with the cause attached, and the folder is not created.
- The removed configuration keys are rejected as unknown, and the canonical
  defaults carry `busyTimeoutMilliseconds: 2000`.
- Visitor connections report `journal_mode` `delete`, `foreign_keys` 1,
  `temp_store` 2, `max_page_count` of `maxDatabaseBytes / 4096` and the configured
  `busy_timeout`; the schema has no `metadata` table.

## Release ZIP

`deploy/builds/sqlite-sandboxes-2026-10-19-task2/travel-demo.zip`: 2,467,357 bytes,
68 files, SHA-256 `627d98fcbfd12aadf04d0f74869008dbc8cf0c11904a70e3da7c9830a541b37a`.

It carries the renamed configuration. The earlier builds (`sqlite-sandboxes-2026-10-19`
and `sqlite-sandboxes-2026-10-19-fix1`) are superseded; do not upload them.

## Pending operator work

- Run the `pdo_sqlite` check on the host, upload, extract and confirm
  `private/sandboxes/` exists.
- Two-browser acceptance, the `private/` 403 check and phone and desktop widths,
  as listed in the deployment guide.
