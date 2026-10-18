# Elsewhere Visitor Sandboxes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task by task, subject to the operator's execution loop below. Steps use checkboxes. Do not use native execution: the orchestrator does not write implementation code.

**Goal:** Give each Elsewhere visitor an editable, private SQLite sandbox in both Node and hosted PHP, expiring after four idle hours with bounded storage.

**Architecture:** A private JSON registry maps opaque cookie digests to separate SQLite files and dashboard authorization. A serialized runtime owns allocation, admission, expiry and cleanup; record stores never choose visitor identity. Both HTTP adapters and the browser use the same explicit context and error contract.

**Tech Stack:** Node.js 24+, bundled `node:sqlite`, PHP 8.4/PDO SQLite, existing static templates and vanilla browser JavaScript. Built-in Node tests and the existing Python/Apache hosting harness; no new dependencies.

**Spec:** [Approved visitor-sandbox design](../specs/2026-10-18-visitor-sandboxes-design.md).

**Status:** Execution authorized on 2026-10-18: finish all tasks in one run, with adversarial review per task and operator review of the combined result. Git remains read-only. The operator approved GPT-6.1 Sol implementers, GPT-6 Astra reviewers, native date APIs and syntax/style checks without new packages.

## Global constraints

- Scope is `/var/www/demo_stuff/travel-business/`; all paths below are relative to that directory.
- Sandbox inactivity is exactly 14,400 seconds; logout preserves records and renews the activity lease.
- At most 100 allocated slots, 1,048,576 bytes per SQLite main file, 134,217,728 bytes total managed runtime files, 100 enquiries including seeds, and at most 103 bookings.
- Cleanup reclaims at most 10 expired/failed allocations per API request; expiry on access is immediate even before physical cleanup.
- Registry rate-limit buckets are capped at 1,000; new allocations are 10 per IP/hour, enquiry creation and login are each 50 per IP/hour.
- Four initial enquiries and three initial bookings; dates are relative to allocation, email domains end in `.example`.
- Browser lists display 20 rows per page; search covers the entire bounded visitor dataset.
- Node and PHP use different runtime roots and never share files. Local Node supports one server process per runtime root.
- No shared-database fallback, migration of old submissions, active-visitor eviction, automatic mutation replay or heartbeat that extends idle pages.
- No new dependencies, paid services, workers, external APIs, real customer accounts, full contact-detail editor or manual reset feature.
- Git remains read-only. Code first, then adversarial tests. No TDD or agent commits despite stock skill examples.
- Only approved temporary test databases may be opened. Never read a production environment file or bootstrap the normal application to investigate its database.
- Visible Edit/Write tools make source changes. Runtime fixtures and generated artifacts are created only by approved test/build commands.
- No deletions outside explicitly authorized runtime/test directories; legacy data and old PHP session files remain untouched.
- New declarations have their own files; new layer boundaries use readonly DTOs and enums with TitleCase cases and `label()`. No loose record arrays across service boundaries.
- Follow tag-only method docblocks, braces, named PHP DTO arguments, explicit nullability, visible focus, stylesheet tokens, reduced motion and immediate loading states.

## Execution gates

1. The operator has authorized execution of all six tasks. Do not upload, publish or modify Git state.
2. For each task, dispatch one implementer, then an independent adversarial reviewer with **"THIS CODE IS WRONG! PROVE OTHERWISE!"**. Verify each claim with a focused check, delegate accepted fixes and obtain scoped re-review. Continue to the next task after review passes. The operator's batch-execution directive supersedes the earlier pauses for fix rounds and commits. The final handoff opens with `Commit-ready.` or `NOT commit-ready: <missing item>`.
3. The operator approved GPT-6.1 Sol implementers and GPT-6 Astra adversarial reviewers as substitutes for unavailable Haiku/Sonnet/Opus routing.
4. The operator approved native date APIs and syntax/style checks for this dependency-free Elsewhere implementation. Do not add Carbon, Pint or any other package. PHP signatures below take Unix seconds.
5. Present the exact task verification commands before database-capable runs. Obtain the required approval for tests and deletion of their generated directories under `storage/test-runs/`. Test commands never use `storage/demo.sqlite`, a normal sandbox root, or any hosted database. Approval to design cleanup is not approval to delete existing files now.
6. At implementation time, persist loop briefs/reviews only under `~/.claude/projects/-var-www-demo-stuff/sdd-snapshots/elsewhere-visitor-sandboxes/`, as required by the workspace. No such files are needed for this planning turn; resolve any required filesystem permission then. Evidence intended for delivery belongs in `docs/verification/`.

## Review focus

These five adversarial conditions receive explicit tests in the named tasks.

1. Cookies change between loading a record and clicking Save, including simultaneous first visits: stale contexts must never write to a new sandbox. Tasks 3 and 5.
2. A process dies after reserving space or committing a record: restart must retain accounting, preserve accepted work and never silently reseed an existing database. Tasks 2 and 4.
3. Browser cookies survive restart, or authorization expires/rotates independently of a stale tab: only the bound authorization works and logout preserves records. Tasks 2, 3 and 5.
4. Maximum-length multibyte text, a hot journal or failed cleanup consumes more space than the main SQLite file: quota enforcement must remain correct and transactions roll back. Tasks 1, 2 and 4.
5. Shared IPs, forged forwarding headers and aborted requests must not merge visitors, bypass limits, extend rejected leases or hold a storage lock indefinitely. Tasks 2, 3 and 4.

## File and interface map

### Shared data and protocol

Create these authoritative, dependency-free data files:

| File | Responsibility |
| --- | --- |
| `config/sandbox.json` | Limits, cookie names, protocol version, lock timing and SQLite page size. |
| `src/demo-seed.json` | Canonical fictional seed fields and departure day offsets, without absolute dates or visitor data. |
| `src/schema.sql` | Enquiries, bookings and schema/seed metadata; no visitor data or global rate-limit table. |
| `config/enquiry-budgets.json` | Allowed budget strings: empty, `$2,000–$3,500`, `$3,500–$5,000`, `$5,000–$8,000`, `$8,000+`; the same file supplies both validators and rendered options. |

Use these exact keys/defaults in `config/sandbox.json`:

```json
{
  "protocolVersion": 1,
  "idleSeconds": 14400,
  "maxSandboxes": 100,
  "maxDatabaseBytes": 1048576,
  "maxRuntimeBytes": 134217728,
  "maxEnquiries": 100,
  "cleanupBatch": 10,
  "maxRateBuckets": 1000,
  "allocationLimit": 10,
  "enquiryLimit": 50,
  "loginLimit": 50,
  "rateWindowSeconds": 3600,
  "pageSize": 20,
  "sqlitePageBytes": 4096,
  "registryReserveBytes": 2097152,
  "journalReserveBytes": 2097152,
  "stagingReserveBytes": 2097152,
  "lockWaitMilliseconds": 2000,
  "lockRetryMilliseconds": 25,
  "sandboxCookie": "elsewhere_sandbox_v1",
  "dashboardCookie": "elsewhere_dashboard_v1"
}
```

Configuration overrides are operator-owned local files, not request inputs.
Node uses `SANDBOX_ROOT` and optional `SANDBOX_CONFIG_FILE`; PHP loads packaged
private configuration. Validate all integer bounds, database-page divisibility,
minimum seed capacity and reservation arithmetic. The PHP test harness may
construct its own configuration but must not ship runtime test switches.

Cookie and CSRF tokens are 32 random bytes encoded as exactly 64 lowercase hex
characters. The sandbox directory is the SHA-256 hex digest of the cookie.
Store the dashboard cookie's digest, and store the stable random CSRF token
privately so initialization in another tab can return the same generation.
Compare secrets with constant-time helpers after validating lengths. Cookies
are host-only, HttpOnly, SameSite=Strict, with Max-Age renewed to `idleSeconds`;
Secure applies on HTTPS, and Path is `/` locally or `/travel-agency-demo/` hosted.

All post-initialization actions, including overview reads, send
`X-Elsewhere-Context: <csrfToken>`. Mutations additionally require an exact
same-origin `Origin`, a JSON object and at most 16,384 request-body bytes.
No route accepts a sandbox selector from the URL or payload. Reject duplicate
identity cookie names rather than choosing a different interpretation per backend.

| Node route | PHP `route` | Input | Success body/status |
| --- | --- | --- | --- |
| `POST /api/sandbox` | `sandbox` | `{}`; only context-free operation | `{csrfToken, expiresAt, created, protocolVersion, idleSeconds, pageSize}` / 200 |
| `POST /api/enquiries` | `enquiries` | Existing validated form | `{id, reference}` / 201 |
| `POST /api/admin/login` | `admin/login` | `{}` | `{ok:true}` / 200; rotate bound dashboard cookie |
| `POST /api/admin/logout` | `admin/logout` | `{}` | `{ok:true}` / 200; revoke and clear dashboard cookie only |
| `GET /api/admin/overview` | `admin/overview` | No body | `{enquiries, bookings, catalog}` / 200 |
| `PATCH /api/admin/enquiries/:id` | `admin/enquiries/:id` | `{status}` | `{ok:true}` / 200 |
| `POST /api/admin/enquiries/:id/booking` | `admin/enquiries/:id/booking` | `{}` | `{reference}` / 201 |

`expiresAt` is integer Unix seconds. Keep existing record JSON field names and
wire status strings. IDs are positive safe integers in both runtimes. List
ordering remains `ORDER BY id DESC`; do not sort database records in PHP.

Errors have `{error: string, code: string}`. Enum case names are TitleCase;
their wire values and HTTP statuses are fixed here:

| Case | Wire value | HTTP |
| --- | --- | --- |
| `SandboxContext` | `sandbox_context` | 409 for missing/expired/replaced sandbox or invalid generation |
| `DashboardAccess` | `dashboard_access` | 401 for missing/invalid dashboard authorization in a valid context |
| `Capacity` | `capacity` | 503, `Retry-After: 60` |
| `Busy` | `busy` | 503, `Retry-After: 2` |
| `SandboxFull` | `sandbox_full` | 409 for record limit or SQLite page limit |
| `RateLimited` | `rate_limited` | 429, remaining bucket seconds as `Retry-After` |
| `Validation` | `validation` | 400 |
| `Origin` | `origin` | 403 |
| `BodyTooLarge` | `body_too_large` | 413 |
| `ContentType` | `content_type` | 415 |
| `NotFound` | `not_found` | 404 |
| `Conflict` | `conflict` | 409 for converted status/duplicate conversion |
| `Unavailable` | `unavailable` | 503 for unsafe/corrupt runtime; details only in server logs |
| `Internal` | `internal` | 500 for unexpected failures |

Known routes with a wrong method return 405 and `Allow`, before runtime access.
All API responses are JSON with `Cache-Control: no-store`; retain existing
security headers. Invalid origin/body/shape is rejected before the runtime lock.
Missing generation is checked before dashboard authorization; old clients fail
closed. CSRF errors must not be confused with duplicate-booking `Conflict`.

### DTOs, enums and modules

For every DTO name in this table, its exact Node file is `src/dto/<Name>.mjs`
and its PHP counterpart is `deploy/infinityfree/classes/<Name>.php`. This is
an exhaustive filename expansion, not permission to invent a parallel layer.
Node instances are frozen with typed JSDoc; PHP classes are `final readonly`.
Collections contain typed DTOs, and raw JSON/SQL rows are decoded at boundaries.
DTOs implement Node `toJSON()` / PHP `JsonSerializable::jsonSerialize()` at
those boundaries, flattening record inputs and serializing enum wire values.
Decode and validate registry maps explicitly; JSON.stringify of a Map is not
a persistence implementation. No transport-dependent state lives in DTOs.

| Name | Fields/contracts |
| --- | --- |
| `SandboxConfig` | Validated keys from the configuration block; static `from(raw)` / `from(object $raw): self`. |
| `EnquiryInput` | `firstName,lastName,email,destination,journey,departure,budget,message: string; travelers: int`. Consent is validated before construction. |
| `EnquiryRecord` | `id:int, reference:string, input:EnquiryInput, status:EnquiryStatus, createdAt:string`; serialize `input` flattened to existing wire fields. |
| `BookingRecord` | Existing booking wire fields; nullable `enquiryId`; `status:BookingStatus`. |
| `CatalogDestination` | `id:string, name:string`. |
| `CatalogJourney` | `id,title,destination:string, price:int`. |
| `Catalog` | `destinations: list<CatalogDestination>, journeys: list<CatalogJourney>, budgets: readonly list<string>` from `config/enquiry-budgets.json`; expose only destinations/journeys in overview JSON. |
| `Overview` | `enquiries:list<EnquiryRecord>, bookings:list<BookingRecord>, catalog:Catalog`. |
| `CreatedEnquiry` | `id:int, reference:string`. |
| `CreatedBooking` | `reference:string`. |
| `Acknowledgement` | `ok:bool`, always true for successful empty-result actions. |
| `RequestIdentity` | Nullable sandbox/dashboard/context token strings; `remoteAddress:string`. |
| `EnquiryId` | `id:int`, validated positive safe integer. |
| `StatusChange` | `id:int, status:EnquiryStatus`, only the four user-editable statuses. |
| `SandboxRecord` | `digest,csrfToken:string; dashboardDigest:?string; lastActivity:int; state:SandboxState`. |
| `RateBucket` | `key:string, hits:int, expiresAt:int`. |
| `Registry` | `version:1, sandboxes: map<string,SandboxRecord>, rateBuckets: map<string,RateBucket>`. |
| `Bootstrap` | Fields from the sandbox response table. |
| `CookieChange` | `name,value,path:string; maxAge:int; secure:bool`; HttpOnly/Strict/host-only invariant. |
| `ApiResult` | `payload:Bootstrap|Overview|CreatedEnquiry|CreatedBooking|Acknowledgement; cookies:list<CookieChange>`. |

Create one enum per file at `src/enums/<Name>.mjs` and
`deploy/infinityfree/classes/<Name>.php`: `ErrorCode` as above;
`EnquiryStatus` = New/Contacted/Proposal/Converted/Closed;
`BookingStatus` = Planning/Confirmed/Cancelled;
`SandboxState` = Pending/Ready/Failed; `RateAction` = Allocation/Enquiry/Login;
`SandboxOperation` = Bootstrap/CreateEnquiry/Login/Logout/Overview/UpdateStatus/CreateBooking.
PHP uses backed enums; JavaScript uses frozen enum instances with `value` and
`label()`, one enum class per file. Match current lowercase wire status strings.

The Node error lives in `src/InputError.mjs` with
`InputError(message, status=400, code=ErrorCode.Validation, retryAfter=null)`;
PHP uses `classes/DemoError.php` with equivalent typed fields and constructor.
Only the HTTP edge converts an error to raw response JSON.

All signatures below use the DTO names above. Node `now` is `() => integer Unix
seconds`; PHP `now` is a `Closure(): int`. Production uses the system clock,
tests inject a clock directly; no HTTP header or query parameter controls time.

---

## Task 1: Canonical seeds, bounded record store and typed contracts

**Files:** Create the four shared data files and Node DTO files for
`SandboxConfig`, `EnquiryInput`, `EnquiryRecord`, `BookingRecord`,
`CatalogDestination`, `CatalogJourney`, `Catalog`, `Overview`, `CreatedEnquiry`,
`CreatedBooking`, `Acknowledgement`, `EnquiryId`, `StatusChange`; create the
Node `ErrorCode`, `EnquiryStatus`, `BookingStatus` enums,
`src/InputError.mjs`, `src/EnquiryValidator.mjs`,
`src/VisitorStore.mjs`, `tests/store.test.mjs`, `tests/contracts.test.mjs`, and
`tests/support/TestWorkspace.mjs`. Modify `src/store.mjs`, `server.mjs`
(import/typed-command adaptation only), `tests/site.test.mjs`, and `.gitignore`.

**Interfaces:**

- `EnquiryValidator(catalog:Catalog, now)`; `validate(raw:unknown): EnquiryInput`.
- `VisitorStore(path:string, config:SandboxConfig, catalog:Catalog, now, create:boolean)`;
  `createEnquiry(input:EnquiryInput):CreatedEnquiry`, `overview():Overview`,
  `updateStatus(command:StatusChange):Acknowledgement`,
  `convert(command:EnquiryId):CreatedBooking`, `close():void`.
- `src/store.mjs` retains one `createStore(path, config, catalog, now, create):VisitorStore`
  factory and re-exports `InputError`. Omit the last four arguments only at
  existing legacy callers temporarily, preserving their
  fresh-file setup behavior until Task 3. Runtime callers must always pass an
  explicit create flag. The packager remains a caller until Task 4.
- `TestWorkspace.create():Promise<TestWorkspace>` allocates exclusively beneath
  `storage/test-runs/`; `path(relative):string`, `close():Promise<void>`. It
  removes only its own random directory after the approved test run.

- [ ] Implement configuration, DTOs and enums using the exact table above. JSON serialization preserves existing API shapes. Add `storage/test-runs/` under the already ignored storage subtree; add `/deploy/builds/` to `.gitignore` for later release artifacts.
- [ ] Move validation into `EnquiryValidator`. Preserve existing input limits and journey/destination checks; define lengths as Unicode code points in both runtimes. Reject invalid calendar dates, invalid UTF-8, unpaired surrogate values in decoded JSON, non-object input, non-boolean consent and non-integer party size. Retain the existing UTC-yesterday date allowance. Budget membership comes from `catalog.budgets`, loaded from the canonical budgets file.
- [ ] Put the existing schema in `src/schema.sql`, preserving unique references, the unique enquiry-to-booking link and status checks. Put schema version and completed-seed markers in metadata. `create:false` must reject a missing file or invalid schema/seed state without creating or reseeding it; `create:true` must refuse an existing file.
- [ ] Implement `VisitorStore` using prepared statements, DELETE journal mode, page size 4096, foreign keys and per-connection `max_page_count = maxDatabaseBytes / sqlitePageBytes`. Verify the effective settings. Use `temp_store=MEMORY`, `cache_spill=OFF` and a page cache sufficient for the bounded database; do not ATTACH databases, VACUUM or introduce savepoint journals. Validate `journalReserveBytes >= 2 * maxDatabaseBytes`, `stagingReserveBytes >= 2 * maxDatabaseBytes` and the complete reservation equation. Catch SQLite-full specifically as `SandboxFull`; roll back on any write failure.
- [ ] Create seeds with enquiry IDs 1-4 and references `EW-DEMO-001` through `004`, booking IDs 1-3 and existing `BK-DEMO-001` through `003`. Preserve existing people/catalog choices and values. Enquiry offsets are 75/120/65/160 days; booking offsets are 90/45/150 days. Use `olivia@travel.example`, `james@travel.example`, `sophie@travel.example`, `noah@travel.example`; derive timestamps and departures from injected allocation time. New submissions retain random `EW-`/`BK-` references.
- [ ] Enforce `maxEnquiries` in the same transaction as insertion. Keep conversion and its status update atomic and permit at most one conversion per enquiry. Return DTOs; no new business logic in HTTP handlers. Adapt existing Node imports/calls so this task still runs with its old session gate and isolated legacy tests; it is not a release of visitor isolation.
- [ ] After implementation, write these tests in the named files:

| Test | Required assertions |
| --- | --- |
| `canonical_seed_is_relative_and_private` | `assert.equal(overview.enquiries.length, 4)`; bookings 3; `now=1792281600` produces offset-based UTC dates; a new store at `now+86400` moves dates exactly one day; all seed email domains end `.example`. |
| `open_existing_never_seeds` | Missing file with `create:false` throws and still does not exist; malformed/schema-less/seed-incomplete files are byte-preserved, not repaired. |
| `record_cap_is_transactional` | Config maxEnquiries=5 allows one post-seed enquiry; the next fails `SandboxFull`; count stays 5. |
| `conversion_rolls_back_and_is_unique` | First conversion succeeds; second conflicts; forced insertion failure leaves original enquiry status and booking count unchanged. |
| `unicode_and_page_limit` | Boundary-length emoji text is accepted by code-point length; one extra point is rejected; repeated maximum valid input reaches either configured record or page cap without exceeding `maxDatabaseBytes`; no partial row remains after full-database failure. |
| `settings_and_typed_wire_contract` | DELETE mode, effective page limit and foreign keys verified on a temporary store; JSON shapes/status strings match the protocol table; invalid configuration fails before creating a database. |

- [ ] Verify after approval: `node --disable-warning=ExperimentalWarning --test tests/contracts.test.mjs tests/store.test.mjs`; then `npm test` because the store/old HTTP seam changed. Expected: all assertions pass, no skipped database-cap tests, no application database access. Update the old test harness to use `TestWorkspace`, a safe temporary `DB_PATH` and `.example` submissions during this transitional task.
- [ ] Complete the execution gate; wait for the operator before Task 2.

## Task 2: Node sandbox registry, lifecycle, quotas and cleanup

**Files:** Create `src/sandbox/SandboxRegistry.mjs`,
`src/sandbox/SandboxQueue.mjs`, `src/sandbox/SandboxRuntime.mjs`,
`tests/sandbox-runtime.test.mjs`; create Node DTOs `RequestIdentity`,
`SandboxRecord`, `RateBucket`, `Registry`, `Bootstrap`, `CookieChange`,
`ApiResult` and enums `SandboxState`, `RateAction`, `SandboxOperation` at their
mapped filenames. Modify `src/InputError.mjs` to carry renewal cookies.
Consume Task 1's DTOs, errors, configuration and store factory. Do not switch
`server.mjs` to the new runtime yet.

**Interfaces:**

- `SandboxRegistry(root:string, config:SandboxConfig)`;
  `load():Registry`, `save(registry:Registry):void`,
  `extraBytes(registry:Registry):number`, `remove(record:SandboxRecord):void`.
- `SandboxQueue.forRoot(root:string, waitMilliseconds:number):SandboxQueue`;
  `run<T>(action:()=>T|Promise<T>):Promise<T>`. Share the queue for a canonical
  root; use a monotonic clock for lock deadlines, not the injected idle clock.
- `SandboxRuntime(root:string, config:SandboxConfig, catalog:Catalog, now)`;
  `execute(operation:SandboxOperation, identity:RequestIdentity, command:EnquiryInput|StatusChange|EnquiryId|null):Promise<ApiResult>`.
- No callable performs a record action outside `execute`. The registry handles
  filesystem safety/accounting; the runtime owns identity, queue, admission,
  cleanup and business dispatch. No per-route wrapper classes.

- [ ] Implement the runtime layout: `registry.json`, `registry.next`, `runtime.lock` (PHP coordination later), and `<digest>/demo.sqlite`. An allocation uses `<digest>/seed.sqlite` then renames it to `demo.sqlite`. Directories are private (0700 locally), files 0600. Reject symlink components and non-regular managed files; only server-generated digest entries are eligible for cleanup.
- [ ] Implement a process-wide queue keyed by resolved runtime root, including multiple runtime objects in one process. Cancel timed-out queued work before it can execute; timeout 2,000 ms means `Busy`, not delayed execution after an error response. Inputs are already parsed. Node's supported deployment is one process per runtime root; document this without claiming the queue protects multiple processes.
- [ ] Registry initialization is allowed only in an empty managed root. Validate version, counts, field types, states, digest formats, token formats and file sizes before trusting metadata. Each serialized registry image is at most 1 MiB; write/flush `registry.next`, rename atomically, and propagate failures. Missing/corrupt registry with existing allocations yields `Unavailable` and preserves files.
- [ ] Under the queue, prune expired rate buckets and inspect the bounded registry. Reconcile Pending allocations as Failed on recovery. Delete up to 10 expired/Failed allocations, never Ready/unexpired ones. Remove a registry entry only after all its managed files are removed; failed removal keeps its slot and byte charges. Retry recoverable failed deletions on later requests. Unknown directories or oversized/unrecognized sidecars fail closed, not recursive sweep.
- [ ] Make allocation durable in this order: check limits; charge allocation bucket; save a Pending registry entry; create/seed the temporary database; close it; rename; mark Ready and save; only then return the new cookies/context. Failures preserve a charged Pending/Failed entry until safe cleanup. Existing Ready files are never reseeded. Use token digests for directory lookup and independent random CSRF/dashboard values.
- [ ] Enforce the quota equation below before allocations and operations that may write, including hot-journal recovery. Physical inspection uses bounded `lstat` entries, not database queries. Never subtract missing data until registry/filesystem reconciliation is safely complete.

```text
databaseReservation = allocatedSlotCount * maxDatabaseBytes
metadataReservation = registryReserveBytes
futureScratch = journalReserveBytes + stagingReserveBytes
extra = measured leftover journals, staged/partial files and other recognized
        artifacts not covered by main-file or metadata reservations
admit only when databaseReservation + metadataReservation + futureScratch
                + extra <= maxRuntimeBytes
default reservation = 100 MiB + 2 MiB + 2 MiB + 2 MiB = 106 MiB
```

  A crashed writer can leave journals after its lock is released: these must
  become `extra` before a new writer is admitted. Serialization alone does not
  bound accumulated leftovers. Treat filesystem allocation overhead and the
  host's free disk separately; the advertised cap covers managed file bytes,
  and real disk errors still fail closed. Validate reserves against the 4096-byte
  page configuration and bounded write operations. If measured/required journal
  space exceeds its reserve, refuse further writes rather than weakening the cap.

- [ ] Implement cookie resolution, exact-boundary expiry and generation matching. Initialization creates/resumes without dashboard login. Every other operation requires the current generation; dashboard operations additionally require the bound dashboard digest. Preserve dashboard authorization over restart. Renew the lease/cookies only after successful admission, before the record operation; a business conflict/full result still counts as activity and must carry renewal cookies even on the error response. Extend `InputError` with a typed `cookies:list<CookieChange>` field for this admitted-error case.
- [ ] Persist fixed-window IP/action buckets using a hash of the actual connection address plus `RateAction`. Refuse new buckets when 1,000 live buckets exist; do not evict live limits. Allocation is charged only for a new slot; validation/auth/context failures neither charge a business action nor renew the sandbox. Accepted initialization/resumption is activity. Rejected business rates do not renew cookies or lastActivity.
- [ ] Rotate dashboard authorization on login. Logout clears the server digest and dashboard cookie while renewing the sandbox lease. Contact activity and initialization also renew a valid incoming dashboard cookie. Opening/reading/writing a store occurs only under the queue; close it in `finally` before release. A normal restart uses registry state and cannot reset limits or leases.
- [ ] Write tests after implementation with injected clocks and temporary roots:

| Test | Required assertions |
| --- | --- |
| `two_contexts_and_logout_retention` | A/B have different cookies and paths, four independent seeds; A's new enquiry/status/booking are absent from B; logout preserves A's database and old dashboard token fails. |
| `exact_idle_boundary_and_sliding_activity` | With `t=1_800_000_000`, expiry is `t+14400`; action at `t+14399` moves it to `t+28799`; action at the exact new boundary throws `SandboxContext` without opening/seeding a store. Rejected actions leave the prior timestamp byte-for-byte unchanged. |
| `restart_and_token_binding` | Construct a new runtime over the same root/clock; existing cookie/context/auth still work; mixed A/B cookie pairs fail; login rotates old auth; logout renews only sandbox access. |
| `parallel_allocation_and_full_capacity` | With two slots and permissive test allocation limit, 20 parallel initializations yield exactly two allocations; remaining calls are Capacity; active files/data unchanged. |
| `cleanup_is_bounded_and_safe` | Twelve expired entries: one request removes at most ten; target expiry is enforced even when not among them. A live entry, symlink target and legacy sentinel outside root remain untouched. |
| `crash_and_delete_failures_stay_charged` | Simulate Pending before mkdir, seeded-before-Ready, truncated registry.next, hot journal and deletion permission failure; restart either reclaims safely or remains fail-closed with the slot/bytes charged. Never recreate a missing Ready database. |
| `reservation_includes_leftovers` | Use maxSandboxes=2, maxDatabaseBytes=65536, journal/staging reserves=131072 each, registry reserve=2097152 and maxRuntimeBytes=2490368. After two allocations, leftover journal/staging bytes prevent further write admission despite small main files. Repeated failed cleanup cannot create uncharged files. Each accepted state remains within count/byte bounds. |
| `limits_survive_cookie_reset` | Eleven same-address new allocations in an hour: ten accepted, eleventh RateLimited; restart/cookie reset does not bypass. Different cookies sharing an IP remain isolated. Test 50/51 enquiry and login limits, bucket-cap refusal, and exact window rollover. |
| `queue_timeout_never_runs_later` | Hold `SandboxQueue.forRoot(testRoot, 2000)` with a controlled test promise; a second runtime action times out, and releasing the first does not subsequently execute it or extend a lease. |

- [ ] Verify after approval: `node --disable-warning=ExperimentalWarning --test tests/sandbox-runtime.test.mjs`. Expected: lifecycle, quota, failure and concurrency assertions all pass; zero edits outside its test workspace. Complete the execution gate before Task 3.

## Task 3: Route every Node API action through its sandbox

**Files:** Modify `server.mjs`, `src/store.mjs` (remove transitional default-create behavior),
`bin/package-infinityfree.mjs` (explicit store-factory arguments only),
`tests/site.test.mjs`; create `src/ApiController.mjs` and
`tests/support/ApiClient.mjs`.

**Interfaces:**

- `ApiController(runtime:SandboxRuntime, catalog:Catalog, config:SandboxConfig, origin:string, now)`;
  `handle(request:IncomingMessage, response:ServerResponse):Promise<void>`.
- `ApiClient(baseUrl:string)` keeps an independent cookie jar and context;
  `initialize():Promise<Response>`, `request(method,path,body=null,overrides=null):Promise<Response>`.
  Overrides are explicit test input; normal calls attach the configured Origin,
  cookies and context and process every Set-Cookie header, including on errors.
- `createStore(path, config, catalog, now, create)` becomes mandatory-arguments;
  update the still-legacy packager call to pass explicit options until Task 4
  removes that call. There is no implicit create-on-read path.

- [ ] Replace the global application store/session/rate maps with a runtime configured by `SANDBOX_ROOT` (default `storage/sandbox-runtime/`) and optional `SANDBOX_CONFIG_FILE`. Do not consult `DB_PATH` for runtime records. Remove the session timer; cleanup is request-driven. Shutdown closes the HTTP listener and drains accepted work, without deleting runtime state.
- [ ] Implement the protocol table in `ApiController`: parse/validate shape, call the runtime once, serialize its DTO result or error and its cookies. Business logic remains in validators/store/runtime. Preserve static-file traversal protection, MIME restrictions and security headers in `server.mjs`.
- [ ] Validate a configured `PUBLIC_ORIGIN` as an exact HTTP(S) origin; for loopback development only, derive it from the bound listening address/actual port, not an arbitrary Host header. Require explicit origin when sharing beyond loopback. GET requests with cross-site fetch metadata or a foreign supplied Origin are rejected too; absent Origin is permitted only for non-mutating reads with valid context/auth.
- [ ] Read at most 16,384 streamed body bytes, including chunked requests. Require `{}` for bootstrap/login/logout/conversion, reject extra sandbox selectors, reject duplicate identity cookies and reject invalid route IDs. Respond before queue entry to malformed/unauthorized transport requests. Unknown API routes never allocate a sandbox.
- [ ] Replace old shared-session HTTP tests with two `ApiClient` instances. Keep page/asset delivery, private-file, validation, persistence and conversion regression coverage. Every subprocess must receive an explicit test `SANDBOX_ROOT`/config; assert the normal runtime and legacy-database paths were never opened. Create a plain sentinel at the temporary legacy path rather than reading the real legacy database.
- [ ] Add these integration assertions after code:

| Test | Required assertions |
| --- | --- |
| `public_submission_follows_its_cookie` | Initialize A/B; submit through A before login; A sees it after login and B never does. IDs shared by seed rows cannot be used to affect the other database. |
| `stale_generation_cannot_replay` | Keep A's old context, expire its temporary registry lease under harness control, initialize fresh; old PATCH/conversion returns 409 and fresh seed statuses/bookings remain unchanged. |
| `mixed_credentials_and_revoked_login` | A sandbox + B authorization fails 401; missing context fails 409; old auth after rotation/logout fails; contact activity renews both cookies when authorization remains valid. |
| `cookie_contract_and_first_visit_race` | Assert exact names/paths/HttpOnly/Strict/Max-Age; HTTPS config adds Secure; concurrent cookieless bootstrap responses produce distinct generations, and the losing context cannot write using the winning cookie. |
| `rejected_requests_have_no_activity` | Missing/null/foreign Origin on mutations; bad CSRF; unknown route; malformed/oversized/chunked input; forged Forwarded/X-Forwarded-For. Assert status, no unexpected allocation, unchanged lease and no merged visitor state. |
| `abort_does_not_hold_lock` | Abort a partial request body; another fully parsed request completes without waiting for its body timeout and no partial record appears. |

- [ ] Verify after approval: `npm test`. Expected: the complete Node suite passes with isolated roots. Browser mutation walkthrough is intentionally pending Task 5; do not deploy this intermediate protocol change. Complete the execution gate before Task 4.

## Task 4: PHP parity and a database-free Elsewhere-only package

**Files:** Create all PHP DTOs/enums from the interface map, plus
`deploy/infinityfree/classes/DemoError.php`, `EnquiryValidator.php`,
`VisitorStore.php`, `SandboxRegistry.php`, `SandboxRuntime.php`,
`ApiController.php`, and `deploy/infinityfree/autoload.php`.
Modify `deploy/infinityfree/api.php`, `bin/package-infinityfree.mjs`,
`tests/infinityfree.py`. Create `tests/php/SandboxRuntimeTest.php` and
`tests/package.test.mjs`.

**Interfaces:** PHP classes mirror the established Node DTO fields and service
methods. Use native typed signatures, named DTO construction and `?type` for
single nullable types; the command union is
`EnquiryInput|StatusChange|EnquiryId|null` where a union is required. Specifically:

- `SandboxRuntime::__construct(string $root, SandboxConfig $config, Catalog $catalog, Closure $now)`;
  `execute(SandboxOperation $operation, RequestIdentity $identity, EnquiryInput|StatusChange|EnquiryId|null $command): ApiResult`.
- `VisitorStore::__construct(string $path, SandboxConfig $config, Catalog $catalog, Closure $now, bool $create)`;
  `createEnquiry(EnquiryInput $input): CreatedEnquiry`, `overview(): Overview`,
  `updateStatus(StatusChange $command): Acknowledgement`,
  `convert(EnquiryId $command): CreatedBooking`, `close(): void`.
- `SandboxRegistry` has the same constructor and `load():Registry`,
  `save(Registry $registry):void`, `extraBytes(Registry $registry):int`,
  `remove(SandboxRecord $record):void` responsibilities as Node.
- `ApiController::run():void` reads request globals at the edge and calls the
  runtime; its constructor supplies validated config/catalog/runtime/clock.
  `autoload.php` registers only the fixed `Elsewhere\` namespace below
  `classes/`; never accepts a request-controlled include path.

- [ ] Port the tested Node semantics, including validation code-point lengths, safe integer IDs, seed dates, per-connection SQLite settings, registry schema, generation/error behavior and renewal cookies on admitted business errors. PDO errors are mapped only by known SQLite error codes; do not mislabel arbitrary I/O failures as quota exhaustion.
- [ ] Replace the old monolithic PHP functions with the thin API entry point and typed services. Remove calls to `session_start`, `session_save_path`, the shared `openDatabase`, and SQLite-backed IP limits from new execution paths. Leave old files on disk untouched. Do not execute SQL schema setup for reads.
- [ ] Use `fopen` plus `flock(LOCK_EX | LOCK_NB)` on the persistent lock inode, retrying at most 25 ms intervals until the 2,000 ms deadline. Release in `finally`; never delete/recreate the lock file during cleanup. All registry/SQLite work is inside this critical section; body reads precede it. Implement the same reservation/corruption/crash rules, and close PDO before removing any database files.
- [ ] Change packaging to copy canonical schema/relative seeds/config/budgets and PHP helpers directly, removing imports of `node:sqlite`/`createStore`, the seed-build database and extraction of schema through SQL. Keep catalog generation from `src/data.mjs`, and combine it with the canonical budget data when constructing `Catalog`. Default output becomes `deploy/builds/visitor-sandboxes`; require new/empty output, as today. Generated configuration contains origin/base path and private sandbox-root paths, never test clocks or visitor state.
- [ ] The ZIP contains only `travel-agency-demo/`. Stop copying the root index into the output; leave `deploy/infinityfree/root-index.html` untouched. Preserve the existing private-directory denial and nested API meta tag. Exclude registry files, database/journal files, tests and all runtime directories. The package must be usable after a fresh source build without running the Node application.
- [ ] Build a PHP test runner using explicit exceptions/assertions with `zend.assertions=1`; inject clocks/config directly, never through a shipped HTTP testing parameter. Cover every Task 2 lifecycle/quota fixture and compare protocol JSON/types with Node's expected contract.
- [ ] Extend the real Apache harness to independent cookie jars, configurable test-only private roots and multiple workers/processes. Package into its random `storage/test-runs/` directory; allow a test copy of private config to use smaller caps. Do not publish test files. Add these assertions after implementation:

| Test | Required assertions |
| --- | --- |
| `php_node_contract_parity` | Same default limits, seed counts/offsets, request status/error codes, DTO wire shapes, renewal behavior and logout retention. |
| `php_parallel_admission_and_conversion` | Separate concurrent PHP processes cannot exceed slots/bytes; simultaneous conversion gives one 201 and one Conflict; live data remains intact. |
| `php_lock_released_after_process_death` | Kill only a harness-owned worker holding the test lock; another request proceeds after OS release; pending allocation remains charged/recoverable. |
| `php_quota_io_and_cleanup_failures` | Small cap plus multibyte fields/leftover journal and denied removal reproduce Node outcomes; a failed mutation leaves no partial booking/status change. |
| `php_private_files_and_no_legacy_access` | Direct nested registry/database/journal/config paths are denied; legacy sentinel unchanged; old cookies give no authorization; absent/foreign Origin and stale context fail before database access. |
| `package_is_only_elsewhere` | ZIP names all start `travel-agency-demo/`; no runtime or old DB; deployment into a fixture with a root-index sentinel leaves it byte-identical. A seed allocated at a later clock still has future dates. |

- [ ] Verify after approval: `php -d zend.assertions=1 -d assert.exception=1 tests/php/SandboxRuntimeTest.php`, `node --test tests/package.test.mjs`, and `python3 tests/infinityfree.py`. Expected: no skipped concurrency/quota tests, no PHP warnings/fatals and only isolated test data. Run the operator-approved touched-file PHP formatting check after code; do not install a formatter to satisfy the gate. Complete the execution gate before Task 5.

## Task 5: Browser lifecycle, expiry recovery and bounded dashboard lists

**Files:** Create `assets/sandbox.js`, `assets/dashboard-pagination.js`,
`tests/browser-client.test.mjs`, `tests/pagination.test.mjs`.
Modify `assets/app.js`, `assets/admin.js`, `assets/styles.css`,
`src/pages.mjs`, `src/components.mjs`, `build.mjs` and `tests/site.test.mjs`.

**Interfaces:**

- `assets/sandbox.js` defines one `ElsewhereSandboxClient` class on `window`.
  `constructor(endpointForPath, fetchImplementation=window.fetch.bind(window))`;
  `initialize():Promise<Bootstrap>`, `request(path, {method,body}):Promise<object>`,
  `invalidate():void`, `cancelPending():void`. `invalidate` clears context and
  advances the epoch; `cancelPending` advances the epoch without losing context,
  so logout can cancel older reads and still send its authorized request.
  Superseded requests reject with `AbortError` for the UI to ignore, never with
  payloads that could be rendered. It holds context in memory only. Boundary response JSON
  is validated before use; bearer cookies never appear in returned data.
- `assets/dashboard-pagination.js` defines one `ElsewherePagination` class on
  `window`: `constructor(pageSize:number)`,
  `select(records:ReadonlyArray, requestedPage:number):Readonly<{rows,page,pageCount,total,start,end}>`.
  It clamps pages, slices only, never changes ordering or mutates input records.
  Both enquiry and booking lists call it.
- `window.elsewhereApi(path)` keeps its existing Node/PHP URL mapping.
  Build order is deferred `sandbox.js`, `dashboard-pagination.js` (dashboard
  only), `app.js`, `admin.js` (dashboard only). Construct the client after
  `elsewhereApi` exists; contact/admin share that instance. Hash all changed
  script filenames in the build's versioned URLs.

- [ ] Implement the client without automatic bootstrap/retry inside `request`. `initialize` may run once on page entry or when the visitor presses the recovery/retry control. Attach the stored context to every other request, including GET. Parse error `code`; only SandboxContext invalidates generation, while DashboardAccess ends the local dashboard view. A booking Conflict never triggers a fresh sandbox.
- [ ] Treat each client initialization as a generation epoch. Ignore late responses from older epochs; record requests capture the context they were launched with. Do not let a delayed overview after logout repopulate the workspace. UI logout cancels/invalidates pending dashboard loads before starting its own request; its server authorization revocation remains authoritative.
- [ ] Add contact/admin initialization state (`#sandbox-status`, `#sandbox-retry`, `#sandbox-restart`) next to their main actions. Disable submit/entry until initialization succeeds. Fresh-page creation shows `A fresh demo is ready with sample data.`; show the privacy/expiry explanation on both pages. On context loss show `Your demo session ended or changed. Start a fresh demo to continue.` The restart calls initialize, clears stale dashboard state and requires another explicit submit/login action; preserve unsent contact values.
- [ ] On 401 or context loss, close record dialogs, discard pending record IDs, clear record arrays and move focus to the visible entry/recovery control. On successful logout, clear dashboard data but keep sandbox context. All login/logout/save/conversion requests disable their initiating controls and show immediate progress; restore appropriate controls after failures. Never automatically repeat a mutation after a network error or expired cookie.
- [ ] Paginate each tab after applying its search filter, 20 rows per page. Reset page to 1 on search changes, clamp after refresh, keep independent page state for tabs, disable Previous/Next at boundaries. Display `Showing 1-20 of 46` for nonempty results and `No matching records` for zero. Tab badges/stats use full dataset counts, pagination uses filtered counts. Keep conversion feedback and the resulting booking visible by clearing search and selecting its first page.
- [ ] Update contact/dashboard/privacy copy to say private to this browser, four idle hours, logout keeps edits and fictional data only. Do not promise deletion exactly at four hours or real travel actions. Add loading/pagination/error styles using existing tokens, visible focus and reduced-motion rules; no inline style attributes or raw template colours. Build static copy from approved configuration for expiry/page size instead of repeating unexplained magic numbers.
- [ ] Write dependency-free client tests with `node:vm`, stubbed fetch and deferred response promises, exercising the actual browser client source. Use real browser verification in Task 6 for DOM/focus/layout; do not add a DOM/emulation package. Tests must include:

| Test | Required assertions |
| --- | --- |
| `context_error_never_replays` | Recorded fetch sequence contains one PATCH, zero implicit bootstrap/retry; explicit initialization still does not replay the PATCH. Actual unsent form retention is checked in Task 6's browser walkthrough. |
| `late_response_cannot_restore_old_state` | Resolve an old overview after logout/reinitialization: no old dataset is accepted or rendered; old request completion cannot change the client's context epoch. |
| `fresh_page_vs_open_workflow` | Initial initialize may return fresh seeds; later context error requires an explicit recovery event. A normal Conflict preserves context and surfaces the business error. |
| `twenty_row_pages_and_search` | Counts 0/1/20/21/100 produce correct pages/ranges; filtered result on another original page is found; shrinking results clamps the page and preserves original ordering. |
| `build_orders_and_versions_client_assets` | Generated contact/admin pages include dependency order and content hashes; ordinary public pages never initialize a sandbox; all links/assets still load. |

- [ ] Verify: `node build.mjs`, `node --test tests/browser-client.test.mjs tests/pagination.test.mjs`; after approval for its isolated DB checks, `npm test`. Expected: all assertions pass. Complete the execution gate before Task 6.

## Task 6: Release verification, operator preflight and delivery instructions

**Files:** Modify `README.md`, `tests/infinityfree.py` as necessary to assert final
asset/package integration. Create `deploy/infinityfree/DEPLOY.md`,
`deploy/infinityfree/preflight.php`,
`deploy/infinityfree/preflight-secret.example.php`, and
`docs/verification/2026-10-18-visitor-sandboxes.md`.
Evidence images: `docs/verification/visitor-sandboxes-phone.png`,
`visitor-sandboxes-desktop.png`, `visitor-sandboxes-expiry.png`,
`visitor-sandboxes-capacity.png`, `visitor-sandboxes-isolation.png`.

**Interfaces:** `preflight.php` is an operator-uploaded, access-protected,
one-file diagnostic, excluded from the release ZIP. It reports PDO SQLite
availability, private-directory writes, atomic replacement, and cross-request
advisory locking using only its own temporary fixture files. It must not open
an application database or load the app. Instructions supply a fresh random
operator token out of band, never published in source, URLs, screenshots or
the release record. The operator places its SHA-256 digest in
`private/preflight-secret.php`; requests carry `X-Elsewhere-Preflight` and the
script fails closed when configuration is absent or the token mismatches.
Neither the secret file nor diagnostic is included in the release package.
The diagnostic accepts only JSON POST actions `check`, `hold`, `probe`, `finish`.
It operates in `private/runtime/preflight-v1/`, never `sandbox-runtime/`.
`hold` locks its fixture for at most three seconds; a concurrent `probe` must
report the lock unavailable. A later probe must acquire it. `check` replaces
and rereads a bounded marker atomically; `finish` removes only known fixture
files when the fixture lock can be held. Upload/removal
and running it remain operator actions.

- [ ] Document local `SANDBOX_ROOT`/`SANDBOX_CONFIG_FILE`, explicit external origin, one Node process per root, defaults and typed error behavior. Explain logout retention, cookie-context isolation, no cross-device recovery, strict inactivity and opportunistic physical deletion. Replace the old README claims that everyone can see/update shared records and sessions necessarily disappear on restart.
- [ ] Document the release transition: build a fresh Elsewhere-only package, run operator preflight, replace the complete API/assets release together, preserve old private data, require new cookie names/context, and never roll back to the shared writable API on a public demo. Failure recovery is disabling dashboard/enquiry mutations or restoring a previously isolated release. The root hub and other demo directories are not part of the upload.
- [ ] Implement the standalone preflight only after the task is authorized. Its token is checked before filesystem work; rate/hold time is bounded; output contains no filesystem secrets or record data. Cover authorized/unauthorized access, lock hold/probe/release and atomic marker replacement in the local Apache fixture. Host behavior is still unverified until the operator runs it there.
- [ ] Run the final independent contracts, Node HTTP tests, PHP runtime tests and actual Apache package suite using their already approved isolated commands. Re-run affected suites only after a new change or failure. Record exact commands, results, runtime versions and remaining limitations; never write a passing result before it exists.
- [ ] With two independent browser contexts and a temporary runtime, execute the complete form/login/status/booking/logout/return walkthrough. Verify 390x844 and 1440x900, keyboard-only interaction, loading under delayed responses, expiry with unsent form values retained, capacity, same-browser tabs, 21+ rows, search and reduced motion. Record screenshots at the exact evidence paths above. Use available browser tooling; do not install a browser dependency without approval.
- [ ] Build the final package with `node --disable-warning=ExperimentalWarning bin/package-infinityfree.mjs --output deploy/builds/visitor-sandboxes-release`. Output must be new/empty; never remove an existing output without folder-specific approval. The new packager is database-free. Inspect the ZIP manifest for only `travel-agency-demo/`, protected helpers/config and no runtime/test/preflight files. Record its checksum in the verification document.
- [ ] Mark local code/package verification separately from **hosted verification pending operator deployment**. Provide operator steps for two hosted browser contexts, sliding expiry, logout retention, private-file denial and capability preflight. Keep the listing blocked until the operator supplies passing hosted evidence; only then record that evidence and its actual date. This task never uploads or publishes.
- [ ] Complete the execution gate. Do not claim the hosted bug fixed from local evidence alone.

## Verification command inventory

These are future commands, not commands executed while writing this plan. Run
from `/var/www/demo_stuff/travel-business`. Database-capable test runs require
the operator approval described above, even though they use isolated fixtures.

| Command | Evidence |
| --- | --- |
| `node --disable-warning=ExperimentalWarning --test tests/contracts.test.mjs tests/store.test.mjs` | DTO/config/seed/store contracts. |
| `node --disable-warning=ExperimentalWarning --test tests/sandbox-runtime.test.mjs` | Node isolation, expiry, accounting and failure recovery. |
| `npm test` | Built site plus complete Node suite. |
| `php -d zend.assertions=1 -d assert.exception=1 tests/php/SandboxRuntimeTest.php` | PHP runtime parity on isolated fixtures. |
| `node --test tests/package.test.mjs` | Elsewhere-only, database-free package content. |
| `python3 tests/infinityfree.py` | Real Apache/PHP package, cookies, filesystem protection and concurrency. |
| `node --test tests/browser-client.test.mjs tests/pagination.test.mjs` | Stale-response and pagination behavior without new packages. |
| `node build.mjs` | Generated frontend asset/template integration; no database. |

## Plan self-review

- [x] Every approved design section has an owner: contracts/store (1), identity/expiry/storage (2), Node transport (3), PHP/package parity (4), browser/copy/pagination (5), release/evidence (6).
- [x] Cross-task methods, DTO fields, context headers, cookies, error codes, paths and defaults are fixed above; PHP mirrors the Node contracts.
- [x] Every Review Focus condition has a named adversarial test in its owning task.
- [x] Crash leftovers are included in quota accounting; failed deletes retain charges; no claim that serialization alone prevents persistent journal accumulation.
- [x] Existing app remains testable between tasks; temporary old-API compatibility ends at Task 3 and packaging DB generation ends at Task 4. Intermediate commits are not deployable releases.
- [x] No implementation, test execution, dependency installation, database access, Git mutation, upload or publication occurred while authoring this plan.

Next action: execute the authorized tasks with per-task adversarial reviews.
