# Elsewhere SQLite Sandbox Storage Implementation Plan

> **For agentic workers:** run this through the workspace execution loop in `/var/www/demo_stuff/CLAUDE.md`: one task at a time, implementer subagent, adversarial Opus review, the orchestrator checks the reviewer's claims, the operator commits, then the next task is proposed. Code first, then tests that try to break it (no TDD). Agents never run git write commands.

**Goal:** Replace the hand-rolled filesystem registry with plain SQLite in both runtimes, so the hosted demo works under InfinityFree's `open_basedir`.

**Architecture:** `registry.sqlite` holds sandboxes and rate buckets; each visitor has `<digest>.sqlite` in the same folder. Every request runs one short `BEGIN IMMEDIATE` registry transaction (expire, identity checks, renew, charge), commits, deletes expired files, then runs the visitor operation in the visitor database's own transaction.

**Tech Stack:** PHP 8.4 with PDO SQLite (hosted), Node 24 with `node:sqlite` (local), Python 3 Apache harness with `php-fpm8.4`.

**Spec:** `travel-business/docs/superpowers/specs/2026-10-19-sqlite-sandbox-storage-design.md`

## Global Constraints

- Visitor-facing behaviour is unchanged: routes, payloads, cookies, context header, error codes, messages, status codes, `Retry-After` values, 14400 s idle expiry, rate limits, `maxSandboxes` 100, page size 20.
- No filesystem call at request time outside the sandboxes folder. No file-mode, inode, link-count or parent-walk checks. Hosted code creates no folder.
- Every connection sets `PRAGMA busy_timeout`, `journal_mode = DELETE` and `temp_store = MEMORY`. Visitor connections also set `foreign_keys = ON` and `max_page_count = maxDatabaseBytes / sqlitePageBytes`; `page_size = sqlitePageBytes` is set before the schema on create.
- PHP open-existing uses `Pdo\Sqlite::ATTR_OPEN_FLAGS => Pdo\Sqlite::OPEN_READWRITE`; Node uses the `file:<path>?mode=rw` URI.
- `SQLITE_BUSY` (5) on any connection maps to 503 `busy` with `Retry-After: 2`; `SQLITE_FULL` (13) maps to 409 `sandbox_full`; any other storage failure maps to 503 `unavailable` with its cause logged.
- No new dependencies and no package installs. Tests use folders under `storage/test-runs/` that they create and remove.
- Workspace code laws: one declaration per file, tag-only docblocks on every method, braces always, no single-letter variables, named arguments on PHP DTO construction, no swallowed errors (log-and-continue only where the spec says so), no emojis.
- Run only the affected test files; never the full suite in the loop.

## Review Focus

1. **Missing hosted folder** (extraction did not create `private/sandboxes/`): the API must still return the 503 `unavailable` JSON, not a fatal or blank page, and must not create the folder. Pinned in Task 1 (`missing sandboxes folder returns unavailable`).
2. **Corrupt or foreign `registry.sqlite`**: garbage bytes in the file give 503 `unavailable` with the cause logged, never a 500 or a stack trace. Pinned in Task 1 and Task 2 (`corrupt_registry_is_unavailable`).
3. **Extracting over the 2026-10-18 release**: stale `classes/Registry.php`, `RateBucket.php` and `SandboxState.php` stay on the host after an overwrite extract. The new code must never load them. Pinned in Task 1 (stale class sentinels).
4. **Undeletable expired file**: the row is still removed, the failure is logged, the request succeeds, and the orphan is never reattached. Pinned in Task 1 and Task 2 (`failed_file_delete_is_logged_and_row_removed`).
5. **Deleted visitor file under a live row**: 503 `unavailable`, and the file is not recreated as an empty or fresh sandbox. Pinned in Task 1 and Task 2 (`missing_visitor_file_is_unavailable_and_not_recreated`).

---

### Task 1: Hosted PHP adapter on SQLite (deployable)

Implementer: Opus. After the operator commits this task, the ZIP can be deployed.

**Files:**
- Create: `src/registry-schema.sql` (the two `CREATE TABLE IF NOT EXISTS` statements from the spec, verbatim)
- Create: `deploy/infinityfree/sqlite-check.php`
- Rewrite: `deploy/infinityfree/classes/SandboxRegistry.php`, `deploy/infinityfree/classes/SandboxRuntime.php`, `deploy/infinityfree/classes/VisitorStore.php`
- Modify: `deploy/infinityfree/classes/SandboxRecord.php` (drop `state`), `deploy/infinityfree/api.php` (error log lines)
- Delete: `deploy/infinityfree/classes/Registry.php`, `deploy/infinityfree/classes/RateBucket.php`, `deploy/infinityfree/classes/SandboxState.php`, `deploy/infinityfree/preflight.php`, `deploy/infinityfree/preflight-secret.example.php`
- Modify: `bin/package-infinityfree.mjs`
- Rewrite: `deploy/infinityfree/DEPLOY.md`
- Test: `tests/php/SandboxRuntimeTest.php`, `tests/infinityfree.py`, `tests/package.test.mjs`

**Interfaces:**
- Consumes: existing `SandboxConfig`, `Catalog`, `RequestIdentity`, `SandboxOperation`, `ApiResult`, `Bootstrap`, `CookieChange`, `Acknowledgement`, `DemoError`, `ErrorCode`, the command DTOs, and `ApiController` (unchanged). This task keeps `config/sandbox.json` as is and uses `lockWaitMilliseconds` as the busy timeout; Task 2 renames it.
- Produces (Task 2 mirrors these in Node):
  - `SandboxRuntime::__construct(string $root, SandboxConfig $config, Catalog $catalog, \Closure $now)` and `execute(SandboxOperation $operation, RequestIdentity $identity, EnquiryInput|StatusChange|EnquiryId|null $command = null): ApiResult`, both signatures unchanged.
  - `SandboxRecord(string $digest, string $csrfToken, ?string $dashboardDigest, int $lastActivity)`.
  - `VisitorStore::__construct(string $path, SandboxConfig $config, Catalog $catalog, \Closure $now, bool $create)`, signature unchanged; `createEnquiry`, `overview`, `updateStatus`, `convert` and `close` unchanged.
  - Storage layout: `<root>/registry.sqlite` and `<root>/<sha256-hex>.sqlite`.

- [ ] **Step 1: Rewrite `SandboxRegistry.php` as the registry database**

  It owns one PDO connection to `<root>/registry.sqlite`:
  - opened with the normal create flags, error mode exceptions, the Global Constraints pragmas and `busy_timeout = lockWaitMilliseconds`;
  - `src/registry-schema.sql` applied on every open, read from `dirname(__DIR__).'/registry-schema.sql'` with the same source-tree fallback `VisitorStore` uses today.

  Public methods, each tag-only documented; names may differ if each has more than one caller:
  - begin, commit and roll back;
  - expire: delete rate buckets with `expiresAt <= now`, delete up to `cleanupBatch` sandboxes with `lastActivity + idleSeconds <= now`, and return their digests;
  - find by digest;
  - count sandboxes;
  - insert and update a `SandboxRecord`;
  - charge a rate bucket. Port today's `SandboxRuntime::charge()` semantics exactly: key `hash('sha256', $action->value."\0".$address)`, limit per `RateAction`, 429 `rate_limited` with `retryAfter = expiresAt - now` for a full bucket, and for a new bucket while `maxRateBuckets` exist, `min(expiresAt) - now`;
  - delete files: for each digest, unlink `<digest>.sqlite` and `<digest>.sqlite-journal` if present. Each failure goes to `error_log('Sandbox cleanup failed: '.$error)` and the loop continues.

  A `PDOException` with `errorInfo[1] === 5` becomes `DemoError('The demo is busy. Please try again.', 503, ErrorCode::Busy, 2)`. Any other `Throwable` becomes the existing `unavailable()` `DemoError` with the cause as `previous`.

- [ ] **Step 2: Rewrite `SandboxRuntime::execute()` to the spec's request flow, steps 1 to 8**

  - Keep the command-type check, the clock check and the identity rules exactly as in the current lines 18 to 32: the ready test `timestamp < lastActivity + idleSeconds`, the 409 `sandbox_context` and 401 `dashboard_access` conditions, and the operations that need authorization.
  - Bootstrap with a live sandbox renews `lastActivity` and returns `created: false`.
  - Bootstrap without one:
    - the count check gives 503 `capacity` with retry 60, then charge `Allocation`, then generate tokens;
    - `new VisitorStore(create: true)`, close it, then insert the row and commit;
    - on any failure, unlink the partial file and journal, roll back, and throw `unavailable`.
  - Login and logout token handling, `cookies()`, `bootstrap()`, `token()` and `same()` are kept as they are.
  - Registry changes commit before the visitor operation. Expired files are deleted after that commit. A domain error from the visitor operation keeps the cookies attached exactly as today.
  - Delete `reconcile()`, `admit()` and all `SandboxState` use.

- [ ] **Step 3: Cut `VisitorStore.php` back**

  - Create: open with the default flags, set the pragmas, then run `schema.sql` and the seed in one `BEGIN IMMEDIATE` transaction. Insert no `metadata` rows.
  - Open existing: use `Pdo\Sqlite::OPEN_READWRITE` flags, then set the per-connection pragmas.
  - Remove the `fopen`/`chmod` creation, the `lstat` check, the schema comparison, the seed and metadata re-checks, `integrity_check`, `foreign_key_check` and the settings read-back.
  - The `transaction()` mapping of code 13 to `sandbox_full` stays. Add code 5 to `busy` exactly as in Step 1.

- [ ] **Step 4: Error log, record DTO, deletions**

  - `api.php` sets `ini_set('log_errors', '1')` and `ini_set('error_log', __DIR__.'/sandboxes/php-errors.log')` before `require autoload.php`.
  - `SandboxRecord` drops `state`.
  - Delete the five files listed above (deletion approved in the spec).

- [ ] **Step 5: Packaging and the SQLite check**

  `bin/package-infinityfree.mjs`:
  - writes `'sandbox_root' => __DIR__.'/sandboxes'`;
  - writes `private/sandboxes/.htaccess` containing `Require all denied\n`;
  - copies `src/registry-schema.sql` to `private/registry-schema.sql`;
  - removes `preflight` from the public-build rejection regex.

  `sqlite-check.php` prints exactly two lines, `PHP <PHP_VERSION>` and `pdo_sqlite: yes` or `pdo_sqlite: no`, with `Content-Type: text/plain`.

- [ ] **Step 6: Rewrite `DEPLOY.md`**

  Write the spec's four steps, plain:
  1. the SQLite check, then delete the check file;
  2. upload and extract with overwrite, then confirm `private/sandboxes/` exists;
  3. optional removal of `private/runtime/`, `preflight.php`, `private/preflight-secret.php`, and the stale `private/classes/Registry.php`, `RateBucket.php` and `SandboxState.php`;
  4. two-browser acceptance, the `private/` 403 check, and phone and desktop widths.

  State that `private/sandboxes/php-errors.log` holds failures. Record the new ZIP's byte size and SHA-256 from the package run, and say that no upload or hosted acceptance is claimed.

- [ ] **Step 7: Rework the Apache harness in `tests/infinityfree.py` to PHP-FPM 8.4**

  - Replace `LoadModule php_module` with `mod_proxy` and `mod_proxy_fcgi`, plus `SetHandler "proxy:unix:<temp>/php-fpm.sock|fcgi://localhost"` for `\.php$`.
  - Generate `<temp>/php-fpm.conf`: global `error_log` and `pid` in `<temp>`; one pool `[elsewhere]`; `listen = <temp>/php-fpm.sock`; `pm = static` with `pm.max_children = 8`; `catch_workers_output = yes`.
  - Set these as `php_admin_value`: `open_basedir = <web>/:<temp>/php-tmp/`, `sys_temp_dir` and `upload_tmp_dir` set to `<temp>/php-tmp`, `disable_functions = putenv`, `display_errors = Off`, `opcache.enable = 0`.
  - Start `/usr/sbin/php-fpm8.4 -F -y <conf> -p <temp>` before Apache and stop both in the existing `finally`.
  - Switch the runtime-warnings scan to the FPM log as well as Apache's.
  - `php_worker` keeps using the 8.4 CLI `php`.

- [ ] **Step 8: Adapt the harness checks to the new storage**

  - `configure()` creates `runtime_root` with `mkdir`, as the ZIP would.
  - `registry()` reads `registry.sqlite` with Python's `sqlite3` into the same dict shape: `sandboxes` keyed by digest, `rateBuckets` keyed by key.
  - `save_registry()` writes rows.
  - `database(client)` returns `runtime_root / (digest + '.sqlite')`.
  - Each "no runtime access" check becomes `not (runtime_root / 'registry.sqlite').exists()`.
  - Each `registry.json` byte comparison becomes a comparison of `registry()` rows.
  - The busy check holds `BEGIN IMMEDIATE` on `registry.sqlite` in a `php_worker` for 3 s. Keep its assertion: 503 `busy`, `Retry-After` `'2'`, elapsed between 1.8 and 4 s with `lockWaitMilliseconds` 2000.
  - Delete the whole preflight block, the pending-reservation, crash-artifact and leftover-journal-capacity checks, and the `'preflight'` term in the package-content check.
  - Keep every other check.

- [ ] **Step 9: Add harness checks that try to break it**

  - **Stale class sentinels:** before extracting, write `private/classes/Registry.php`, `RateBucket.php` and `SandboxState.php` containing `<?php throw new Error('stale class loaded');`. Every later check must pass, and the warnings scan must show no `stale class loaded`.
  - **missing sandboxes folder returns unavailable:** `configure()` a root that is not created. A bootstrap returns 503 `{"error":"The demo storage is unavailable.","code":"unavailable"}`, and the folder still does not exist.
  - **corrupt_registry_is_unavailable:** write `b'not a database'` to `registry.sqlite`. A bootstrap returns 503 `unavailable`, and the body does not contain `registry.sqlite` or the temp path.
  - **bootstrap seed failure leaves nothing:** replace `private/schema.sql` with `CREATE TABLE broken (;` for one bootstrap. Expect 503 `unavailable`, an unchanged sandbox count, and no `*.sqlite` beside `registry.sqlite`. Then restore the file.
  - **error log written:** after the seed-failure check, `private/sandboxes/php-errors.log` exists and contains `API storage failed`. A request for `/travel-agency-demo/private/sandboxes/php-errors.log` returns 403. The log path is fixed by `api.php`, independent of the fixture `sandbox_root`.
  - **missing_visitor_file_is_unavailable_and_not_recreated:** delete one live visitor's `.sqlite`. Their overview returns 503 `unavailable`, and the file still does not exist.
  - **failed_file_delete_is_logged_and_row_removed:** replace an expired visitor's file with a non-empty directory of the same name. Make it expired by setting `lastActivity` back past 14400 s through `save_registry()`. The next request from another visitor succeeds, the expired row is gone, and the log contains `Sandbox cleanup failed`.

- [ ] **Step 10: Update `tests/php/SandboxRuntimeTest.php`**

  - `runtime()` creates its root folder.
  - `registry()` and `save()` read and write `registry.sqlite` through PDO.
  - Keep `lifecycle`, `loginRotationRejectsOldAuthorization`, `exactRateWindowBoundary`, `expiredTargetOutsideCleanupBatch`, `expiry`, `limits`, `cleanup` (rows and files removed, at most `cleanupBatch` per request), `storeBoundaries` and `validation`.
  - Delete `storage`, `unsafe` and `crashPhases`.
  - Add `missingVisitorFileIsUnavailable`: delete the file; expect `ErrorCode::Unavailable` and `file_exists` false afterwards.
  - Add `busyRegistryReturnsBusy`: a second PDO holds `BEGIN IMMEDIATE` and the config sets `lockWaitMilliseconds` 200; expect `ErrorCode::Busy` with `retryAfter` 2.
  - Add `busyVisitorDatabaseReturnsBusy`: the same, holding the visitor file.
  - Add `failedFileDeleteIsLoggedAndRowRemoved`: the directory trick from Step 9; expect the row gone and the request succeeding.

- [ ] **Step 11: Update `tests/package.test.mjs`**

  - The config regex becomes `/sandbox_root.*__DIR__.*\/sandboxes'/`.
  - Assert that `private/sandboxes/.htaccess` equals `'Require all denied\n'`.
  - Add `['src/registry-schema.sql', 'registry-schema.sql']` to the copied-file list.
  - Assert that `deploy/infinityfree/preflight.php` no longer exists.

- [ ] **Step 12: Verify**

  Run:
  - `php -l` on every changed PHP file. Expected: no syntax errors.
  - `php -d zend.assertions=1 -d assert.exception=1 -d open_basedir=$PWD/deploy/infinityfree/:$PWD/src/:$PWD/config/:$PWD/tests/php/:$PWD/storage/test-runs/ tests/php/SandboxRuntimeTest.php`. Expected: exit 0 and the assertion count printed.
  - `python3 tests/infinityfree.py`. Expected: exit 0, every `PASS` line, and the final `no PHP runtime warnings or fatals`.
  - `node --disable-warning=ExperimentalWarning --test tests/package.test.mjs`. Expected: pass.

- [ ] **Step 13: Hand-off.** The operator reviews and commits; then Task 2 is proposed.

---

### Task 2: Local Node runtime on SQLite, shared config and docs

Implementer: Sonnet (it mirrors Task 1).

**Files:**
- Rewrite: `src/sandbox/SandboxRegistry.mjs`, `src/sandbox/SandboxRuntime.mjs`, `src/VisitorStore.mjs`
- Modify: `src/dto/SandboxRecord.mjs` (drop `state`), `server.mjs`, `src/schema.sql` (drop the `metadata` table), `config/sandbox.json`, `src/dto/SandboxConfig.mjs`, `deploy/infinityfree/classes/SandboxConfig.php`, and the PHP uses of `lockWaitMilliseconds` (`SandboxRegistry.php`, `VisitorStore.php`)
- Delete: `src/sandbox/SandboxQueue.mjs`, `src/dto/Registry.mjs`, `src/dto/RateBucket.mjs`, `src/enums/SandboxState.mjs`
- Modify: `README.md` (storage, configuration, deployment, verification sections)
- Create: `docs/verification/2026-10-19-sqlite-sandbox-storage.md`
- Test: `tests/sandbox-runtime.test.mjs`, `tests/store.test.mjs`, `tests/contracts.test.mjs`, `tests/site.test.mjs`, plus the key rename in `tests/infinityfree.py` and `tests/php/SandboxRuntimeTest.php`

**Interfaces:**
- Consumes: Task 1's storage layout, request flow, `SandboxRecord` shape and error mapping, mirrored in Node.
- Produces:
  - `new SandboxRuntime(root, config, catalog, now)` and `async execute(operation, identity, command = null): Promise<ApiResult>`, both unchanged for `ApiController.mjs`.
  - `new SandboxRecord({ digest, csrfToken, dashboardDigest, lastActivity })`.
  - `createStore(path, config, catalog, now, create)`, unchanged.

- [ ] **Step 1: Configuration in both runtimes**

  - `config/sandbox.json` removes `maxRuntimeBytes`, `registryReserveBytes`, `journalReserveBytes`, `stagingReserveBytes` and `lockRetryMilliseconds`, and renames `lockWaitMilliseconds` to `busyTimeoutMilliseconds` (2000).
  - Both `SandboxConfig` classes drop the reservation validation, the `lockRetryMilliseconds > lockWaitMilliseconds` check and the `maxRuntimeBytes` bound. Every other bound stays.
  - Update the PHP uses to `busyTimeoutMilliseconds`, and the overrides in `tests/infinityfree.py` and `tests/php/SandboxRuntimeTest.php`.

- [ ] **Step 2: Node `SandboxRegistry.mjs`, `SandboxRuntime.mjs` and `VisitorStore.mjs`, mirroring Task 1 Steps 1 to 3 with `DatabaseSync`**

  - The registry opens with `new DatabaseSync(path)`. The visitor database opens with `new DatabaseSync('file:' + path + '?mode=rw')` for existing files and `new DatabaseSync(path)` on create.
  - Busy is `error.errcode === 5` and full is `error.errcode === 13`.
  - Cleanup failures go to `console.error('Sandbox cleanup failed.', error)`.
  - `execute()` stays `async` but runs synchronously inside; there is no queue.
  - `VisitorStore` inserts no `metadata`, and `src/schema.sql` drops the `metadata` table.
  - Delete the four files listed above.

- [ ] **Step 3: `server.mjs`**

  The default root becomes `join(root, 'storage', 'sandboxes')`. Run `mkdirSync(sandboxRoot, { recursive: true })` once at startup, before constructing `SandboxRuntime`. `SANDBOX_ROOT` still overrides it.

- [ ] **Step 4: Node tests**

  - **`tests/sandbox-runtime.test.mjs`:** keep `two_contexts_and_logout_retention`, `exact_idle_boundary_and_sliding_activity`, `admitted_business_errors_renew_and_rejected_admission_does_not`, `restart_and_token_binding`, `parallel_allocation_and_full_capacity`, `cleanup_is_bounded_and_safe` (rows and files removed, at most `cleanupBatch`), `limits_survive_cookie_reset`, `rate_bucket_cap_refuses_new_buckets_without_forgetting_live_limits` and `hot_journal_restart_preserves_committed_work`, adapted to `registry.sqlite`. Delete `crash_and_delete_failures_stay_charged`, `failed_real_cleanup_retains_slot_and_all_remaining_bytes`, `reservation_includes_leftovers`, `queue_timeout_never_runs_later` and `unsafe_or_corrupt_runtime_is_preserved`. Add:
    - `missing_visitor_file_is_unavailable_and_not_recreated`: 503 `unavailable`, and `existsSync` false afterwards;
    - `busy_registry_returns_busy_with_retry_after`: a second `DatabaseSync` holds `BEGIN IMMEDIATE` and `busyTimeoutMilliseconds` is 200; expect code `busy`, status 503 and `retryAfter` 2;
    - `failed_file_delete_is_logged_and_row_removed`: the directory trick, with `console.error` captured;
    - `corrupt_registry_is_unavailable`: garbage bytes in `registry.sqlite`; expect 503 `unavailable`.
  - **`tests/store.test.mjs`:** `open_existing_never_seeds` becomes `open_existing_never_creates`: a missing path throws `unavailable` and creates no file. `settings_and_typed_wire_contract` asserts `journal_mode` `delete`, `foreign_keys` 1, `temp_store` 2 and `max_page_count` `maxDatabaseBytes / 4096` on the store's connection. Keep the others.
  - **`tests/contracts.test.mjs`:** the canonical defaults have no removed keys and include `busyTimeoutMilliseconds: 2000`. `SandboxConfig.from({ lockWaitMilliseconds: 2000 })` throws `Unknown sandbox configuration key.`
  - **`tests/site.test.mjs`:** point the server fixture at a created `storage/test-runs` folder. Keep every test.

- [ ] **Step 5: Docs**

  - README: storage is now `storage/sandboxes/` with `registry.sqlite` and `<digest>.sqlite`; update the configuration table (`SANDBOX_ROOT` default and the key changes); the deployment summary points to the new `DEPLOY.md`; remove preflight mentions.
  - The verification record lists each command with its result, says hosted acceptance is pending the operator, and records the ZIP checksum from Task 1.

- [ ] **Step 6: Verify**

  Run:
  - `node --disable-warning=ExperimentalWarning --test tests/sandbox-runtime.test.mjs tests/store.test.mjs tests/contracts.test.mjs tests/site.test.mjs tests/package.test.mjs`. Expected: all pass.
  - The two PHP commands from Task 1 Step 12. Expected: as in Task 1.
  - `grep -rn "lockWaitMilliseconds\|registry.json\|runtime.lock\|SandboxQueue\|SandboxState\|preflight" src deploy bin tests config README.md`. Expected: no matches.

- [ ] **Step 7: Hand-off.** The operator reviews and commits.
