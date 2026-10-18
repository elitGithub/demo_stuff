# Elsewhere sandbox storage on SQLite

Date: 2026-10-19

Status: Draft. Awaiting builder check and operator approval.

## Why

The hosted demo at `demo-sites.infinityfree.me/travel-agency-demo/` answers every
API request with "The demo storage is unavailable." The operator traced it on the
host:

1. `SandboxRegistry::prepareRoot()` walked the runtime path from `/` and called
   `mkdir('/home')`. InfinityFree's `open_basedir` allows only
   `/home/vol1_4/infinityfree.com/if0_43183405/htdocs` (plus temp paths), so it
   failed on the first component.
2. With that patched, `SandboxRegistry::file()` rejected `registry.json` as an
   "Unsafe runtime file": the permission-bit and hard-link checks do not hold on
   this host.

The cause is the storage layer itself. It hand-rolls a filesystem database: lock
files, staged JSON with rename and fsync, inode, hard-link and permission checks,
folder walks and folder-scan size accounting. None of it was ever run on the
host. The operator ruled that this goes, in favour of plain SQLite used the way
an ordinary application uses it.

## Decisions made by the operator

- The sandbox registry moves into SQLite. SQLite provides locking and atomic
  writes.
- Every visitor keeps a separate SQLite database file. One shared database with
  rows tagged per visitor is rejected: it is the failure the visitor-sandbox work
  was created to remove.
- No hand-rolled filesystem code: no lock files, `flock`, staged files, renames,
  fsync, permission-bit, hard-link or inode checks, parent-folder walks,
  per-visitor folders or folder-scan size accounting.
- The hosted storage folder ships in the ZIP. Hosted code never creates a folder.
- The local Node server and the hosted PHP adapter change the same way.
- `VisitorStore` is cut back in the same pass: no per-request schema comparison,
  seed re-check, `integrity_check`, settings read-back or `chmod`.
- The protected preflight diagnostic and its secret flow are deleted. The
  deployment guide keeps only a one-file `pdo_sqlite` check and plain steps.
- Deletion is approved for `deploy/infinityfree/preflight.php` and
  `deploy/infinityfree/preflight-secret.example.php`.

## Goals

- The hosted demo works under InfinityFree's `open_basedir`, with no filesystem
  calls outside the sandboxes folder.
- Each visitor keeps their own isolated, editable demo data for four idle hours,
  as today.
- The storage code is short, ordinary and readable: open a database, run a
  transaction, delete a file on expiry.

## Non-goals

- No change to anything a visitor or the browser sees: routes, payload shapes,
  cookies, the context header, error codes and messages, status codes, the
  four-hour idle expiry, rate limits, capacity, page size or UI.
- No migration of existing hosted state. Nothing hosted ever worked on the new
  runtime; old files are left for the operator to remove (see Deployment).
- No new dependencies (npm, Composer or otherwise).

## Anti-goals

- Any code that inspects file modes, inodes or link counts, or walks parent
  directories.
- Any filesystem call outside the sandboxes folder at request time.
- A shared database for visitor data.
- Replacing hand-rolled checks with different hand-rolled checks.

## Constraints

- InfinityFree: PHP 8.4, `open_basedir` limited to `htdocs` and temp paths, no
  SSH, no workers, no error log visible to the operator. `pdo_sqlite` is not yet
  confirmed on the account.
- Local: Node 24 with the bundled `node:sqlite`.
- Workspace code laws apply: one declaration per file, tag-only docblocks, enums
  with `label()`, readonly DTOs between layers, braces always, named arguments on
  DTO construction, no single-letter variables, no swallowed errors.

## Design

### Storage layout

One folder holds everything:

- `registry.sqlite`: the sandbox list and the rate-limit buckets.
- `<digest>.sqlite`: one file per visitor. `<digest>` is the SHA-256 hex of the
  visitor's sandbox cookie token, as today. The token itself is never stored.
- SQLite's own transient `-journal` files.

Folder per environment:

- Hosted: `travel-agency-demo/private/sandboxes/`. The packager writes
  `private/sandboxes/.htaccess` containing `Require all denied`, which also makes
  the folder exist after extraction. `private/config.php` points `sandbox_root`
  at `__DIR__.'/sandboxes'`.
- Local Node: `storage/sandboxes/` by default (still overridable by
  `SANDBOX_ROOT`). `server.mjs` creates it at startup with one recursive `mkdir`.
- Tests: temporary folders the tests create and remove.

If the folder is missing on the host, opening `registry.sqlite` fails, the request
returns the existing 503 `unavailable` response, and the cause is logged.

### Registry database

Schema, shipped as `src/registry-schema.sql` and copied privately into the
package beside `schema.sql`, applied with `CREATE TABLE IF NOT EXISTS` on every
open:

```sql
CREATE TABLE IF NOT EXISTS sandboxes (
  digest TEXT PRIMARY KEY,
  csrfToken TEXT NOT NULL UNIQUE,
  dashboardDigest TEXT UNIQUE,
  lastActivity INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_buckets (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL
);
```

A row in `sandboxes` exists only for a fully seeded visitor database. There are
no pending or failed states.

Every connection, registry or visitor, sets `PRAGMA busy_timeout` to
`busyTimeoutMilliseconds` and `PRAGMA journal_mode = DELETE`. WAL is not used.

### Request flow (both runtimes)

1. Open `registry.sqlite` and `BEGIN IMMEDIATE`.
2. Delete rate buckets whose `expiresAt` has passed.
3. Select up to `cleanupBatch` sandboxes whose `lastActivity + idleSeconds` has
   passed, delete those rows, and remember their digests.
4. Apply today's identity rules unchanged: sandbox cookie digest lookup, idle
   check, context-header match, dashboard-cookie digest match, and the same error
   for each failure.
5. Bootstrap without a live sandbox:
   - if the `sandboxes` row count has reached `maxSandboxes`, return the existing
     503 capacity error;
   - charge the allocation rate bucket;
   - generate the sandbox token, CSRF token and digest;
   - create and seed `<digest>.sqlite` (see Visitor database);
   - insert the `sandboxes` row;
   - commit, then return the bootstrap payload and cookies.
   If creation or seeding fails, delete the partial file, roll back, and return
   503 `unavailable`.
6. Any other accepted request: charge the enquiry or login bucket where today's
   code does, update `lastActivity` and `dashboardDigest` as today, and commit.
7. After the commit, delete the files of the sandboxes removed in step 3 and any
   `-journal` beside them. A failed delete is logged and the request carries on;
   the orphaned file is harmless because no row points to it.
8. Operations that need visitor data then open `<digest>.sqlite` and run in that
   database's own `BEGIN IMMEDIATE` transaction. This happens after the registry
   commit, so the registry is locked only briefly. The request has just renewed
   the sandbox, so cleanup cannot remove that file while the request runs.

Registry updates for an accepted request stay committed even if the visitor
operation then fails with a domain error, which matches today's behaviour.

`SQLITE_BUSY` after the timeout, on the registry or on a visitor database,
returns the existing 503 `busy` error with `Retry-After: 2`, as today's single
lock does. Any other storage failure returns the existing 503
`unavailable` error and logs its cause (`error_log` in PHP, `console.error` in
Node).

### Visitor database

- Create: open the path with SQLite's normal create behaviour. Set
  `page_size = sqlitePageBytes`, `journal_mode = DELETE`, `foreign_keys = ON`,
  `temp_store = MEMORY` (so SQLite writes no temp files outside the folder) and
  `max_page_count = maxDatabaseBytes / sqlitePageBytes`. Then run `schema.sql` and
  the seed inserts in one transaction. `cache_spill` and `cache_size` are no
  longer set.
- Open existing: never create. PHP passes
  `Pdo\Sqlite::ATTR_OPEN_FLAGS => Pdo\Sqlite::OPEN_READWRITE` (PHP 8.4+; the older
  `PDO::SQLITE_*` spellings are deprecated in 8.5 and `api.php` turns notices into
  failures). Node opens the `file:` URI with `?mode=rw`. Both refuse a missing file
  with "unable to open database file" (checked locally). Then set `busy_timeout`,
  `foreign_keys`, `temp_store` and `max_page_count`, which are per connection.
- A missing file for a live row therefore returns 503 `unavailable` and never
  turns into a fresh sandbox.
- `SQLITE_FULL` (code 13) still maps to the existing 409 `sandbox_full` error.
- The `metadata` table and its seed insert are removed; nothing reads them once
  the verification code is gone.

### Configuration

`config/sandbox.json` and both `SandboxConfig` classes:

- remove `maxRuntimeBytes`, `registryReserveBytes`, `journalReserveBytes`,
  `stagingReserveBytes` and `lockRetryMilliseconds`, along with the storage
  reservation validation;
- rename `lockWaitMilliseconds` to `busyTimeoutMilliseconds` (value 2000);
- keep every other key and value.

### Code removed or replaced

Rewritten as short SQLite classes in both runtimes:
`SandboxRegistry`, `SandboxRuntime` and `VisitorStore`
(`src/sandbox/*.mjs`, `src/VisitorStore.mjs`,
`deploy/infinityfree/classes/*.php`).

Deleted, unless the builder finds a remaining use:

- `src/sandbox/SandboxQueue.mjs`: `node:sqlite` is synchronous and SQLite
  serializes writers.
- `Registry`, `RateBucket` and `SandboxState` in both runtimes
  (`src/dto/Registry.mjs`, `src/dto/RateBucket.mjs`,
  `src/enums/SandboxState.mjs`, `deploy/infinityfree/classes/Registry.php`,
  `RateBucket.php`, `SandboxState.php`).
- `deploy/infinityfree/preflight.php` and
  `deploy/infinityfree/preflight-secret.example.php` (already approved).

Approving this design approves deleting the files in this list.

`SandboxRecord` stays as the row DTO, without `state`.

### Packaging

`bin/package-infinityfree.mjs`:

- writes `sandbox_root => __DIR__.'/sandboxes'` into `private/config.php`;
- writes `private/sandboxes/.htaccess`;
- copies `src/registry-schema.sql` into `private/`;
- still excludes every `.sqlite` file, runtime state and test from the ZIP;
- drops the preflight references.

### Deployment guide

`deploy/infinityfree/DEPLOY.md` is rewritten as plain steps:

1. Upload `deploy/infinityfree/sqlite-check.php` (new, a few lines that print
   `PHP_VERSION` and whether `pdo_sqlite` is loaded) into
   `htdocs/travel-agency-demo/`, open it, record the result, then delete it from
   the host.
2. Upload the ZIP into `htdocs`, extract with overwrite, and confirm
   `private/sandboxes/` exists.
3. Optional cleanup on the host: delete `private/runtime/` (old shared database
   and failed runtime attempts) and any uploaded `preflight.php` or
   `private/preflight-secret.php`.
4. Acceptance: in two separate browsers, submit enquiries, enter the dashboard,
   change a status and create a booking; each sees only its own data. Confirm
   `private/` returns 403. Check phone and desktop widths.

The README storage, configuration and deployment sections are updated to match.

### Tests

Tests for removed behaviour (lock files, staging, permission and inode checks,
preflight) are deleted. API behaviour tests stay and pass unchanged. New or
adapted tests try to break:

- the PHP suite run under `open_basedir` limited to the package root and the test
  temp folder (the regression for this incident), through the existing Apache
  harness in `tests/infinityfree.py`;
- isolation: two visitors with overlapping local record IDs never see each
  other's data;
- expiry: an idle sandbox's row and file are removed, at most `cleanupBatch` per
  request, and its cookie then gets the 409 context error;
- capacity at `maxSandboxes`, plus concurrent bootstraps from parallel PHP
  workers never exceeding it;
- rate limits as today;
- a live row whose file was deleted returns 503 and creates no file;
- a registry write lock held past `busyTimeoutMilliseconds` returns 503 `busy`
  with `Retry-After`;
- `sandbox_full` when a visitor database reaches `maxDatabaseBytes`.

All tests use temporary folders only.

### Verification record

A new `docs/verification/2026-10-19-sqlite-sandbox-storage.md` records local
results and leaves hosted acceptance to the operator.

## Left to the builder

- Method names and internal structure beyond what is named above.
- Exact SQL for the rate-bucket upsert and the expiry query.
- Test harness mechanics and task order in the plan.

## Calls made by the assistant (for the operator to check)

- Hosted folder `private/sandboxes/`, not the old `private/runtime/`, so new
  files never mix with the legacy shared database.
- A `.htaccess` deny file inside the folder doubles as the placeholder that
  makes the ZIP create it.
- The registry lock is held only for registry work; visitor operations run
  afterwards in their own database.
- Expired files are deleted after the registry commit; a failed delete is logged
  and the orphan ignored.
- Rename `lockWaitMilliseconds` to `busyTimeoutMilliseconds`.
- Drop the `metadata` table.
- Rollback journal (`DELETE`), not WAL, for shared-host safety.
- `SQLITE_BUSY` on any connection maps to `busy`, keeping today's error code.
- Keep `temp_store = MEMORY`; drop `cache_spill` and `cache_size`.
- Use the `Pdo\Sqlite` constants; the SQLite check also prints the PHP version.
