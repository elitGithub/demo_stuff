# Strand & City Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task by task. The workspace requires an implementer and a fresh adversarial reviewer; the orchestrator does not implement. Checkbox steps track progress. The operator requires code before tests, continued execution without per-task commit or routine-fix approval gates, and no Git operations.

**Goal:** Build the approved interactive Laravel hairstylist demo, with isolated visitor databases and a complete request, acceptance, simulated deposit and confirmation journey.

**Architecture:** A Blade application uses one private SQLite registry and one SQLite database per visitor. Models own scopes, relationships and local predicates; services coordinate typed workflows. Registry admission and SQLite transactions protect lifecycle and booking integrity without workers or external services.

**Tech Stack:** PHP 8.4, Laravel 13.36.0, SQLite, GD, Blade, local CSS and JavaScript; PHPUnit 12.5.39, Mockery 1.6.15 and Pint 1.32.1 for development.

**Spec:** `../specs/2026-10-21-stylist-discovery-design.md`, approved 2026-10-21. Preview: `../../mockups/discovery-preview.html`.

**Status:** Approved by the operator on 2026-10-21, including scoped permissions and model substitutions. Task 1 passed implementation and review. The operator subsequently authorized completing all remaining tasks, skipping per-task commit gates and routine-fix approval questions while retaining tests and reviews. Git remains untouched. This latest instruction supersedes contrary commit/fix gates below. Local checks confirm PHP 8.4.26, PDO SQLite and GD. Hosted capabilities still require verification.

## Global Constraints

- Repository: `/var/www/demo_stuff`; demo: `stylist-discovery`; new Laravel application: `stylist-discovery/site`. All application paths below are relative to `site/` unless explicitly prefixed with `demo:` or `workspace:`.
- Preserve the approved design and preview alongside the application. Existing demos, their databases and unrelated `travel-business/public/` changes are outside scope.
- Fictional brand Strand & City; fictional people, studios and addresses; email domains end in `.example`. No real transactions, card fields, email, third-party requests or account integrations.
- PHP 8.4 and Laravel 13.36.0. No npm dependencies or asset bundler: local assets are ready to serve. No Boost, Tinker, Livewire, SPA, payment SDK or workers.
- One declaration per file; generators create framework artifacts. All methods, constructors and tests have complete tag-only docblocks. No prose comments, strict-types declaration, single-letter variables, implicit nullable types or unbraced control flow.
- TitleCase enum cases with `label(): string`; readonly DTOs with named construction arguments; CarbonImmutable for dates. Arrays occur only at framework/configuration/serialization boundaries, not as application service contracts.
- Controllers validate, call and respond. FormRequests validate shape only. Policies and services enforce authorization and domain rules. SQL performs filtering, ordering, totals and pagination.
- No single-use forwarding wrappers, private methods with one caller, swallowed errors or fallback identities/connections. Pin affected dependencies; no opportunistic upgrades.
- Tests follow implementation and use isolated databases only. No application database access, dependency installation, non-generator Artisan invocation or deletion without the permissions listed at the end.
- All authored file edits use visible Edit/Write tools. Generator, dependency, test-fixture and package outputs need the explicit generated-output exception listed below.
- Phone-first at 320, 390, 768 and 1440 pixels; immediate loading for all navigation/submissions; required markers; Cancel left and Save right; destructive confirmation only. CSS tokens, visible focus, reduced motion and opaque glass fallbacks.
- Latest operator acceptance: match the approved mockup's visual quality throughout, including deliberate dropdown carets, spacing and control states. Discovery is the primary entry; account management is secondary. Guide the sample visitor through request, contextual stylist acceptance, client deposit, confirmation and inbox with visible next actions. Do not expose disconnected scaffold screens, dead feature links or implementation-phase copy as a finished demo.
- All user-controlled collections paginate or have an explicit small cap. Discovery is 12/page; workspaces, services, portfolio, admin and inbox are 12/page. Slot choices are bounded to one selected day.
- Leave Git untouched. Each task proceeds through tests, independent review and correction, then immediately into the next task without an operator commit gate.
- Hosting: InfinityFree PHP 8.4, subdirectory `/stylist-discovery/`, private `_app`, prebuilt dependencies/assets, no hosted Artisan/SSH/worker. Nothing is uploaded or published by an agent.

## Review Focus

1. A tab submits after another tab changes role: reject before binding or mutation, even when numeric user/booking IDs happen to match (Tasks 3–4).
2. A request is admitted while cleanup selects the same sandbox, or initialization/upload fails halfway through: never delete an active operation's files, expose a partial sandbox or lose accounting for leftovers (Tasks 3 and 10).
3. Two real PHP processes accept/pay/cancel against the same slot at a deadline: one consistent outcome, no duplicate money/messages, no resurrection (Tasks 8–9).
4. Local time is ambiguous/nonexistent, a service price changes, or an admin suspends an accepted stylist: preserve snapshots and existing obligations while rejecting newly ineligible work (Tasks 6–9 and 11).
5. A full sandbox still displays truthful state; malicious image data, HTML, forged totals and private-file URLs cannot cross identity boundaries (Tasks 5, 8–10 and 12).

## File and responsibility map

| Area | Files/directories | Responsibility |
| --- | --- | --- |
| Application foundation | `bootstrap/app.php`, `config/*.php`, `routes/web.php`, `app/Providers/AppServiceProvider.php` | Connection defaults, middleware order, services, routes, safe failures |
| Registry | `database/migrations/registry/`, `app/Models/Registry/`, `app/Services/SandboxService.php` | Admission, lifecycle, rate/session limits, cleanup ledger |
| Visitor domain | `database/migrations/visitor/`, `app/Models/`, `app/Enums/`, `app/Data/` | Persisted invariants, casts, scopes and typed contracts |
| Identity | `app/Services/AccountService.php`, `app/Http/Middleware/`, `app/Policies/` | Authentication, role allowlist, stale-form protection, ownership |
| Catalogue | `app/Services/DiscoveryService.php`, `StylistService.php`, `PortfolioService.php` | Discovery, onboarding, catalogue editing and private images |
| Scheduling | `app/Services/AvailabilityService.php`, `BookingService.php`, `PaymentService.php`, `InboxService.php` | Calendar rules, serialized booking transitions, deposit/refund and messages |
| Screens | `resources/views/`, `public/assets/css/app.css`, `public/assets/js/app.js` | Blade screens and shared progressive enhancement |
| Tests | `tests/bootstrap.php`, `TestCase.php`, `Support/`, `Feature/`, `Unit/` | Safe test boot, generated fixtures, HTTP and process-race tests |
| Delivery | `app/Console/Commands/`, `app/Services/DeploymentService.php`, `demo:deploy/`, `demo:docs/` | Clean fixture/package build, run guide, evidence and hosted checklist |

No repository/service interfaces, general workflow engine, generic quota framework or custom filesystem-lock abstraction are introduced. New classes below have concrete consumers.

## Fixed values and shared contracts

### Configuration

`config/demo.php` owns brand, EUR, pagination, time limits, caps, locations, seed catalogue and seeded-role account keys. `config/database.php` defines explicit `registry` and unresolved `visitor` connections; `visitor` is the default and must throw before resolution. No fallback SQLite file.

| Value | Setting |
| --- | --- |
| Locations | Paris/France/Europe/Paris; Lisbon/Portugal/Europe/Lisbon; Barcelona/Spain/Europe/Madrid; Berlin/Germany/Europe/Berlin |
| Initial catalogue | 12 published profiles, three per city; six specialties: Curls, Colour, Cuts, Braids, Locs, Extensions; 3 services and 3 immutable work images per profile |
| Accounts | 12 stylists, 3 clients, 1 admin; seeded role switch uses one configured client, one stylist, one admin |
| Search inputs | Name 80 characters; configured city/country; existing specialty ID; integer price cents 0–100000; page integer 1–10000 |
| Profile inputs | Display/studio names 80 characters, bio 1200, address 180, caption 160; plain text only |
| Service inputs | Name 80; price 100–100000 cents; duration integer 15–240 minutes; deposit percentage integer 10–100 |
| Schedule | One interval per weekday, opening before closing on the same local date; starts on a 15-minute grid; no split/overnight intervals |
| Request window | At least 2 hours from now, at most 60 days from now; compare UTC instants after local-time validation; boundaries inclusive |
| Acceptance/expiry | Accept before start; hold ends at `min(accepted_at + 30 minutes, starts_at)`; expired at `now >= deadline` |
| Money | `deposit_cents = intdiv(price_cents * deposit_percent + 50, 100)`; `remaining_cents = price_cents - deposit_cents` |
| Sandboxes | 4 idle hours; max 25 slots, including Allocating/Retiring/failed-deletion slots |
| Visitor storage | 4096-byte SQLite pages; max 1024 pages = 4 MiB; DELETE journal, foreign keys ON, temp_store MEMORY, busy timeout 2000 ms |
| Registry storage | Max 4096 pages = 16 MiB; same page/journal/foreign-key/timeout settings |
| Registry row caps | 250 sessions, 1000 revoked-session tombstones, 2000 cache entries, 100 cache locks, 200 upload-ledger rows; expired rows cleared in bounded batches of 100 |
| Session/cache bounds | Session payload max 16 KiB; rate-limit cache values max 4 KiB; session lifetime 240 minutes; database cache/locks explicitly use registry |
| Session serialization | Global session blocking, registry-backed lock store, 120-second lock lifetime, 2-second wait; revoked old session IDs retained as digests for 120 seconds |
| Rate limits | Allocate 10/IP/hour; role switch 10/session/minute; login 5/IP+normalized-email/minute plus 20/IP/minute; signup 5/IP/hour; other mutations 30/session/minute |
| Record caps, seed included | 40 users, 20 profiles, 120 services, 150 bookings, 1000 inbox messages; 8 visitor images in all upload-ledger states per sandbox |
| Additional bounded records | 7 weekly-hours rows/profile; 40 time-off intervals/sandbox; one Deposit and one Refund row/booking; no payment row for simulated failures |
| Upload input | At most 5 MiB, 4096 pixels per side, 4 million pixels total; inspect type/dimensions before full decode |
| Upload output | GD re-encode to JPEG or PNG; maximum long edge 1600 pixels, at most 1 MiB; eight images including pending/retired files, no hidden replacement reserve |
| Cleanup | At most 2 sandbox slots and 8 upload-ledger records/request; no directory scan; retry failed deletion on subsequent requests |
| PHP/log limits | Target memory limit 128 MiB, upload_max_filesize 5M, post_max_size 6M, max_file_uploads 1, max_execution_time 30; private log 1 MiB plus one 1 MiB rotation |

Limit session payloads before persistence; do not flash passwords/files or unbounded request input. Rate-limit keys use an application-key HMAC of the connection IP and normalized identifier. Do not trust arbitrary proxy headers on InfinityFree. SQLite constraints/triggers enforce registry row limits without a custom cache implementation; map their named capacity errors explicitly. Other DB failures remain errors and are logged privately.

Maximum live visitor database/journal allowance is 200 MiB; upload allowance is 200 MiB. Registry plus journal reserves another 32 MiB; template is at most 4 MiB. Runtime SQLite/upload files are at most 253, plus one bounded private log and its one rotation. Package validation reserves 440 MiB for managed runtime files, excludes host-owned temporary request files from this estimate, and records actual vendor/assets/package size separately. PHP request/upload limits and GD memory limits must also pass the hosted check. Failures retain ledger slots instead of allowing unbounded orphan files.

### Enums and data

Generate each file, then edit its declaration; all enums are string-backed with TitleCase cases and `label(): string`.

- `Enums/AccountRole.php`: Client, Stylist, Admin.
- `Enums/ProfileStatus.php`: Draft, Pending, Published, Suspended.
- `Enums/BookingStatus.php`: Requested, AwaitingDeposit, Confirmed, Declined, Cancelled, Expired, Completed.
- `Enums/PaymentKind.php`: Deposit, Refund. `Enums/CheckoutOutcome.php`: Succeeded, Failed.
- `Enums/InboxEvent.php`: RequestReceived, RequestAccepted, RequestDeclined, DepositPaid, BookingExpired, BookingCancelled, DepositRefunded.
- `Enums/SandboxStatus.php`: Allocating, Active, Retiring. `Enums/UploadStatus.php`: Reserved, Attached, Retiring.
- `Enums/DiscoverySort.php`: Name, PriceAscending, PriceDescending.

DTO files are readonly and have the following typed constructor fields; constructors use named arguments at every call site. Collections have generic element types in tag-only docblocks.

| File under `app/Data/` | Fields |
| --- | --- |
| `SandboxContext.php` | `string digest, string generation, CarbonImmutable expiresAt` |
| `ActorContext.php` | `?int userId, string revision, string generation` |
| `RegistrationInput.php` | `string name, string email, string password, AccountRole role` |
| `LoginInput.php` | `string email, string password` |
| `DiscoveryFilter.php` | `?string search, ?string countryCode, ?string cityCode, ?int specialtyId, ?int minimumCents, ?int maximumCents, DiscoverySort sort, int page` |
| `StylistInput.php` | `string displayName, string studioName, string biography, string address, string cityCode, int depositPercent, Collection<int, int> specialtyIds` |
| `ServiceInput.php` | `string name, int specialtyId, int priceCents, int durationMinutes, bool active` |
| `WeeklyInterval.php` | `int weekday, string opensAt, string closesAt` |
| `WeeklySchedule.php` | `Collection<int, WeeklyInterval> intervals` |
| `TimeOffInput.php` | `string startsLocal, string endsLocal` |
| `TimeSlot.php` | `CarbonImmutable startsAt, CarbonImmutable endsAt, string timezone` |
| `BookingInput.php` | `int serviceId, string startsLocal, string requestKey, ?string note` |
| `CheckoutResult.php` | `Booking booking, CheckoutOutcome outcome` |
| `PortfolioInput.php` | `UploadedFile image, string caption` |

FormRequest `inputData()` methods construct the appropriate DTO after validation. Framework-facing Blade data, config, migration schema definitions and validation rules may use arrays. Domain services never accept raw request arrays.

Unless a test explicitly exercises the complete seed template or full journey, arrange only its required fictional identities/records in a fresh schema. Do not carry seeded bookings into assertions expecting zero/one booking. The assertion excerpts below belong to their named scenarios, not one shared sequence. Use explicit model creation in fixture builders; no Faker dependency or unused Eloquent factories.

### HTTP conventions

Use named routes and generated URLs for the `/stylist-discovery/` prefix. All mutations are POST/PATCH/DELETE with CSRF, throttling and actor-context validation where authenticated. Successful mutations use POST/Redirect/GET with a nearby flash result. Invalid input is 422, unauthorized role 403, inaccessible record 404, stale actor/booking conflict 409, expired sandbox 410, capacity/rate limit 429, storage busy 503 with `Retry-After: 2`. Storage failures show a neutral message and log the real cause privately.

The session holds an opaque random sandbox token, never a path, plus generation and actor revision. Only its SHA-256 digest identifies the server-generated database filename. Actor context is a hidden, signed value created from the session and current principal; an anonymous form has a null user ID. Login, registration, logout and role switch rotate the revision and CSRF token; identity changes regenerate the session identifier while preserving sandbox ownership. Record a bounded tombstone for the old session ID before rotation. A queued request carrying that ID returns a refresh response without saving a new session or setting a cookie, so it cannot overwrite the new login cookie. Stale forms cannot select another sandbox or actor.

## Task 1: Generated application and safe verification harness

**Files:**
- Create generated Laravel project: `site/` under the demo, initially using `composer create-project` without scripts/install.
- Modify generated `composer.json`, `bootstrap/{app,providers}.php`, `config/*.php`, `routes/{web,console}.php`, `app/Providers/AppServiceProvider.php`, `tests/TestCase.php`, `phpunit.xml`, `.env.example`, `.gitignore`; normalize generated owned PHP stubs to the workspace comment/docblock rules, excluding vendor.
- Create `pint.json`, `.env.testing`, ignored `.env.local` with initially empty APP_KEY, `tests/bootstrap.php`, `tests/Support/TemporaryRuntime.php`, `tests/Unit/RuntimeSafetyTest.php`, `resources/views/landing.blade.php`, `public/assets/css/app.css`, `public/assets/js/app.js`, `demo:AGENTS.md`, `demo:.gitignore`.
- Remove only unused generated starter files listed in Permissions; preserve their useful bootstrap/configuration conventions.

**Interfaces:**
- Produces `TemporaryRuntime::create(): self`, `path(string $relative): string`, `destroy(): void`; test-owned paths only.
- Produces `Tests\TestCase::createApplication(): Application` that selects `.env.testing` and isolated paths before kernel bootstrap.
- Produces stateless `GET /` landing response; application providers must not connect to any database at boot.

- [x] Generate the empty `site/` skeleton using the exact command in Permissions; record the resolved skeleton version. Replace its dependency manifest through visible edits, then install the approved direct versions and transitive lockfile. Stop if a pinned version is unavailable; do not substitute.
- [x] Configure `visitor` to fail closed until bound, explicit `registry`, private file paths, no queue/mail delivery, and local CSS/JS. Local registry/template paths are `storage/app/demo-runtime/{registry,template}.sqlite`; generated visitor filenames and upload filenames share that packaged private directory. Generate a key only into the new ignored `.env.local` through the listed command, without printing it. Session-backed routes arrive in Task 3; the initial landing route uses no database.
- [x] Implement test bootstrap safety before adding database tests: refuse cached configuration, refuse paths outside the test-generated root, force isolated connection names and explicitly select `.env.testing` before Laravel loads environment files. No application `.env` read during tests. Prevent stray HTTP requests and fake mail delivery.
- [x] Set Pint `preset: laravel`, `no_superfluous_phpdoc_tags: false`, `phpdoc_summary: false`, `declare_strict_types: false`; preserve bare tag-only method docs. Remove prose comments from owned generated stubs and apply required method docblocks; leave vendor files untouched. Remove the starter inspirational console command through a visible edit.
- [x] Add code-first tests named `test_boot_does_not_connect_to_an_application_database`, `test_external_runtime_path_is_rejected`, and `test_cached_configuration_is_rejected`. Assert `/` is 200, contains `Strand & City`, and creates zero registry/visitor files; supplying `/var/www/demo_stuff/beauty_saloon_management/database/database.sqlite` as a test path throws before any connection attempt.

  ```php
  $this->get('/')->assertOk()->assertSee('Strand & City');
  $this->assertFileDoesNotExist($runtime->path('registry.sqlite'));
  ```

- [x] Run `/usr/bin/php8.4 vendor/bin/phpunit --filter RuntimeSafetyTest`; expected all tests pass. Run Pint on the explicit touched PHP list only.
- [x] Apply the Task Gate below. Deliverable: runnable static landing and a test harness that cannot touch application data.

## Task 2: Domain schema, bounded registry and pristine seed builders

**Files:**
- Generate and rename migration files through visible edits: `database/migrations/visitor/2026_10_21_000100_create_identity_and_catalogue.php`, `2026_10_21_000200_create_scheduling_and_inbox.php`; `database/migrations/registry/2026_10_21_000100_create_registry.php`.
- Modify the already-generated `app/Models/User.php`; generate `app/Models/{StylistProfile,Specialty,Service,PortfolioImage,WorkingHours,TimeOff,Booking,Payment,InboxMessage,SandboxMeta}.php` and `app/Models/Registry/{Sandbox,SandboxFile,RevokedSession}.php`.
- Generate all enums listed above and `database/seeders/DemoSeeder.php`; modify generated `database/seeders/DatabaseSeeder.php`. Remove unused HasFactory references from owned models.
- Create `config/demo.php`, `tests/Feature/SchemaInvariantTest.php`, `tests/Feature/SeedTemplateTest.php`; generate `app/Console/Commands/BuildDemoFixtures.php` and `app/Services/FixtureService.php`.
- Create original shared vector assets at `public/assets/seed/{stylist-01,...,stylist-12}.svg` and `public/assets/seed/work-{01,...,36}.svg`; source provenance in `demo:docs/assets.md`.

**Interfaces:**
- Models provide typed relationships, enum/immutable-date casts and ownership scopes. `User::hasRole(AccountRole $role): bool`; `StylistProfile::isPublished(): bool`; `Booking::effectiveStatus(CarbonImmutable $now): BookingStatus`; `Booking::isPayable(CarbonImmutable $now): bool`. The role predicate uses a distinct name to preserve Eloquent's inherited `Model::is($model)` contract.
- `FixtureService::build(string $outputDirectory): void` creates an empty registry and pristine template in a new, approved directory; refuses an existing output. `FixtureService::initializeVisitor(CarbonImmutable $now): void` sets relative seed dates on the bound visitor connection only.
- Console signature: `demo:build-fixtures {--output=}`; no hidden migrations during HTTP requests.

- [x] Generate models/enums/seeders/migrations using `make:*`; move generated migrations to the exact canonical filenames above. Registry models use `registry`; all visitor models use `visitor` explicitly.
- [x] Implement identity/catalogue tables: unique normalized email; enum role; profile unique user, status, city code, IANA timezone, deposit percent, booking lock version; specialties with unique slug/enabled flag; profile-specialty unique pivot; services with integer cents/duration/active flag; images with either immutable seed asset key or unique private storage key, never a client path. Use foreign keys and CHECK constraints for bounded money, percentages, durations and statuses.
- [x] Implement scheduling tables: unique `(profile_id, weekday)` hours; time-off UTC intervals; bookings with client/profile/service IDs, UUID request key and normalized-input fingerprint, immutable service-name/price_cents/duration_minutes/deposit_percent/deposit_cents/remaining_cents/currency/timezone/start/end snapshots, status, accepted/deadline timestamps, optional decline/cancellation reason and remaining notification budget. Index `(profile_id, starts_at, ends_at, status)` and `(client_id, status, starts_at)`. Unique `(client_id, request_key)` and partial unique `(client_id, service_id, starts_at)` for Requested/AwaitingDeposit/Confirmed. Expire effective stale rows before attempting an identical new request.
- [x] Payments have positive integer cents, EUR and unique `(booking_id, kind)`. Inbox has recipient, booking, event enum, unique `(recipient_id, event_key)`, bounded subject/body and read timestamp. SandboxMeta is one row with generation, access-lock counter and seed anchor. Keep historical service/profile rows; no cascading deletion of bookings.
- [x] Implement registry tables: sandbox digest PK, generation, status, idle expiry, allocation timestamp; upload ledger with generated storage key, sandbox digest, status, created timestamp; revoked session digest PK and expiry. Add standard Laravel sessions/cache/cache_locks on registry, with bounded inserts/payloads and expiry indexes. Count all non-reclaimed sandbox/file rows against caps. No passwords, visitor inbox/body data or raw IPs in registry.
- [x] Seed exactly the configured 16 accounts, 12 profiles, 36 services, 36 immutable work images and six specialties. Include upcoming Requested/AwaitingDeposit/Confirmed bookings and past Completed visits for the seeded client/stylist, with matching payment/event rows and remaining notification budgets for active bookings. Use random unusable seed passwords and no published credentials. Source every biography/name/service from configuration; document all artwork as original fictional illustration, with no implied customer photography.
- [x] Build fixtures only through the explicit command or approved isolated tests. The local build creates the new `storage/app/demo-runtime/` with an empty `registry.sqlite` and pristine `template.sqlite`; package builds use their separate new output path. Initialize seed dates relative to allocation, in each studio timezone, at valid daytime slots; acceptance deadlines start from allocation. Never clone an existing visitor database.
- [x] Add `SchemaInvariantTest` assertions: duplicate email/payment/event key rejected; 9% deposit, 14-minute service and 100001-cent service rejected; partial duplicate active request rejected; historic snapshots survive service deactivation. `SeedTemplateTest`: exactly 12 published profiles, three per city, no plaintext credential, all emails `.example`, all dates valid after two different allocation anchors, template unchanged after initialization of two copies.

  ```php
  $this->assertSame(12, StylistProfile::query()->count());
  $this->assertSame(36, Service::query()->count());
  $this->assertSame(3, StylistProfile::query()->where('city_code', 'paris')->count());
  ```

- [x] Run `/usr/bin/php8.4 vendor/bin/phpunit --filter 'SchemaInvariantTest|SeedTemplateTest'`; expected all pass against generated test fixtures. Apply Task Gate.

## Task 3: Visitor database admission and lifecycle isolation

**Files:**
- Generate `app/Services/SandboxService.php`, `app/Data/SandboxContext.php`, `app/Http/Middleware/BindSandbox.php`, `app/Http/Middleware/BoundRegistrySession.php`, `app/Http/Controllers/DemoEntryController.php`, `app/Http/Requests/EnterDemoRequest.php`.
- Modify `bootstrap/app.php`, `config/database.php`, `config/session.php`, `config/cache.php`, `routes/web.php`, `app/Providers/AppServiceProvider.php`, landing view.
- Create `resources/views/errors/{409,410,429,503}.blade.php`, `tests/Feature/SandboxIsolationTest.php`, `tests/Feature/SandboxLifecycleTest.php`, `tests/Support/ConcurrentProcesses.php`, `tests/Support/sandbox-worker.php`.

**Interfaces:**
- `SandboxService::enter(Session $session, string $connectionIp, CarbonImmutable $now): SandboxContext`.
- `SandboxService::admit(Session $session, CarbonImmutable $now): SandboxContext`.
- `SandboxService::reclaim(CarbonImmutable $now): int` returns fully reclaimed sandbox count, at most two.
- `BindSandbox::handle(Request $request, Closure $next): Response` resolves/binds visitor before authentication and route binding; purges it in `finally`.
- `ConcurrentProcesses::run(string $worker, Collection<int, string> $arguments): Collection<int, Process>` starts independent PHP processes with a test-owned fixture/barrier. No assertions through an application database.

- [x] Implement bounded registry session handling and Laravel database cache/locks. Extend the framework StartSession middleware for bounds/revocation checks rather than reimplementing sessions. Set `session.block=true`, `session.block_store=database`, `session.block_lock_seconds=120`, `session.block_wait_seconds=2`, and disable probabilistic unbounded session GC in favour of the bounded cleanup. Check revoked session IDs after acquiring the session lock and before reading/saving state; revoked requests must not emit Set-Cookie. Set production Secure/HttpOnly/SameSite=Lax, scoped cookie path and distinct name; local HTTP uses its explicit development configuration.
- [x] Register ordered middleware: cookies, registry-session handling, CSRF, sandbox admission, visitor binding, authentication, actor validation (Task 4), then substitute bindings. Registration/login entry routes require sandbox but not auth. Root GET may create a bounded registry session/CSRF token but never a visitor DB; POST `/demo/enter` allocates/resumes and authenticates the configured seeded client. Before Task 4 it redirects to a minimal sandbox-ready response. Expired-session responses provide an explicit GET `/demo/start` link that creates a fresh CSRF/session only when the old context has expired, then requires the normal entry POST. An active context resumes instead; this is not a manual sandbox-reset feature.
- [x] Reserve an Allocating row in a short registry write transaction before creating the generated visitor filename. Copy only the pristine template, open/configure it, initialize seed dates, then conditionally mark Active using the original generation and bind the session only after one row changes. On failure, retain Allocating as proof the copy was never admitted, advance its expiry for prompt bounded cleanup, and retain its quota slot until deletion succeeds. This Task3 review correction permits recovery of truncated copies without a schema migration. No registry transaction waits on a visitor lock.
- [x] Admission checks expiry, then atomically renews the four-hour activity lease before opening the visitor. Existing files use SQLite READWRITE without CREATE. Set every connection's page limit/foreign keys/timeout. Missing files fail 503 and create nothing.
- [x] Protect the admitted request with a short visitor transaction whose first operation increments SandboxMeta's access-lock counter, then recheck the registry row is Active before auth/binding. Keep this transaction through synchronous controller/view construction; nested domain transactions use savepoints. No external I/O, streamed writes or lazy response callbacks inside this window. This serializes concurrent access within one sandbox, while different visitors use different files.
- [x] Cleanup marks an expired previously active slot Retiring in registry first, then obtains an exclusive SQLite transaction on its visitor file without holding a registry lock. A busy visitor is left intact for a later request. After exclusive access proves no active operation, close and remove only ledger-owned files/journal; queued admitted requests must recheck Active after acquiring their visitor lock and abort before use. An expired Allocating slot has never been admitted: rotate its generation to invalidate late activation, retain Allocating until deletion finishes, and reclaim its owned partial bytes without parsing SQLite. Upload mutations use the same visitor transaction. Remove registry rows only after every associated file is gone; missing files count as already gone. Return storage errors explicitly, with failed deletions privately logged and accounted for.
- [x] Abandoned Allocating rows are eligible after four hours; explicitly failed allocations have their expiry advanced for immediate bounded cleanup. Reserved upload rows use the four-hour bound. One shared eight-record upload-work budget applies across retired sandboxes and reservation reconciliation, including busy attempts. Registry expiry cleanup runs before new inserts. No directory scans, custom lock files, runtime parent-folder creation or trusted client file names.
- [x] Add tests: `test_overlapping_ids_stay_in_separate_files` asserts A's changed name never appears in B; `test_expired_post_does_not_allocate_or_replay` expects 410 and unchanged file count; `test_missing_active_file_is_not_recreated` expects 503; `test_failed_copy_retains_a_reclaimable_slot` asserts cap accounting; `test_twenty_sixth_allocation_is_rejected` expects 429 with 25 slots; `test_registry_and_session_caps_are_bounded` exercises 251st session and oversized payload rejection.
- [x] Add real-process `test_cleanup_cannot_delete_an_admitted_request`: hold A's visitor write lock, attempt cleanup after synthetic expiry, assert file and ledger remain; release A, then assert later cleanup succeeds. `test_waiting_admission_rechecks_retiring_state` proves no read/write after retirement. `test_busy_timeout_is_retryable` expects 503/Retry-After 2 within a bounded tolerance. Also hit SQLite page cap and verify rollback with no partial rows.

  ```php
  $busyResponse->assertStatus(503)->assertHeader('Retry-After', '2');
  $this->assertFileExists($admittedVisitorPath);
  $expiredMutationResponse->assertStatus(410);
  ```

- [x] Run `/usr/bin/php8.4 vendor/bin/phpunit --filter 'SandboxIsolationTest|SandboxLifecycleTest'`; expected all pass. Apply Task Gate.

## Task 4: Authentication, role switching and stale-form protection

**Files:**
- Generate `app/Services/AccountService.php`, `app/Data/{ActorContext,RegistrationInput,LoginInput}.php`.
- Generate `app/Http/Controllers/{SessionController,RegistrationController,RoleController,AccountController}.php`, `app/Http/Requests/{LoginRequest,RegistrationRequest,SwitchRoleRequest,UpdateNameRequest}.php`, `app/Http/Middleware/{EnsureActorContext,EnsureRole}.php`.
- Create `resources/views/auth/{login,register}.blade.php`, `resources/views/account/edit.blade.php`, `resources/views/components/{actor-context,field-errors,loading-button}.blade.php`, `tests/Feature/AccountAccessTest.php`, `tests/Feature/ActorContextTest.php`.
- Modify entry controller, provider, routes, shared CSS/JS and `bootstrap/app.php`.

**Interfaces:**
- `AccountService::register(RegistrationInput $input): User`; `login(LoginInput $input): User`; `switchRole(AccountRole $role): User`; `updateName(User $actor, string $name): User`.
- `AccountService::context(Session $session, ?User $actor): ActorContext`; `AccountService::assertContext(Session $session, ?User $actor, string $signedContext): void`.
- Normal registration permits Client or Stylist only. Context and session lifecycle changes occur together under the session lock.

- [x] Implement normal hashed-password registration/login/logout, unique normalized email, 12–128 character passwords, bounded names and role enums. Reject submitted Admin registration. Stylist registration creates one Draft profile in the same transaction, subject to both record caps.
- [x] Implement seeded role allowlist from config; reject arbitrary IDs or extra fields. Reserve the old-session tombstone before identity changes, then rotate actor revision and CSRF token, regenerate session identifier, and preserve only server-owned sandbox context. A full tombstone ledger rejects the switch before changing identity. Logout retains the sandbox but removes authentication. Apply the fixed rate limits; failed credentials return the same message.
- [x] Validate signed actor/generation context before route binding on every authenticated mutation, including role switch/logout. Login/signup forms bind to the current anonymous/session revision. An old tab receives a 409 refresh screen and never runs against the newly selected principal.
- [x] Add phone-first authentication/account forms with required markers, error summaries/field errors and submit progress. JavaScript restores navigation/loading state on back-forward cache `pageshow`; accessible status text updates without erasing validation.
- [x] Add assertions: admin signup 422 with no account; duplicate normalized email rejected; role switch to arbitrary ID 422; wrong-role controller access 403; forged signature 409; GET cannot mutate. In `test_old_client_form_after_stylist_switch_is_rejected`, assert 409 and zero bookings, including after switching away and back. `test_parallel_role_switch_cannot_restore_old_session` uses independent requests and asserts the final role/revision is preserved. Missing CSRF returns 419 with CSRF middleware enabled explicitly in that test.

  ```php
  $staleFormResponse->assertStatus(409);
  $revokedSessionResponse->assertHeaderMissing('Set-Cookie');
  $this->assertDatabaseCount('bookings', 0, 'visitor');
  ```

- [x] Run `/usr/bin/php8.4 vendor/bin/phpunit --filter 'AccountAccessTest|ActorContextTest'`; expected all pass. Apply Task Gate.

## Task 5: Responsive discovery and stylist profiles

**Files:**
- Generate `app/Services/DiscoveryService.php`, `app/Data/DiscoveryFilter.php`, `app/Http/Controllers/DiscoveryController.php`, `app/Http/Requests/DiscoveryRequest.php`.
- Modify `app/Models/{StylistProfile,Service}.php`, `routes/web.php`, local CSS/JS.
- Create `resources/views/layouts/app.blade.php`, `resources/views/components/{navigation,stylist-card,pagination,status,empty-state}.blade.php`, `resources/views/discovery/index.blade.php`, `resources/views/stylists/show.blade.php`, `tests/Feature/DiscoveryTest.php`.

**Interfaces:**
- `DiscoveryService::search(DiscoveryFilter $filter): LengthAwarePaginator<StylistProfile>`.
- `DiscoveryService::profile(int $profileId): StylistProfile` rejects undiscoverable profiles.
- `Service::scopeMatching(Builder $query, DiscoveryFilter $filter): Builder`; `StylistProfile::scopeDiscoverable(Builder $query): Builder`.

- [x] Implement a SQL query with matching active, enabled-specialty services; derive card minimum price from the identical filtered subquery. Filter country/city/name/specialty/price, order in SQL by requested sort and ID as stable tie-breaker, paginate 12 with accurate count. Treat `%` and `_` in names as literal search characters; bind every value.
- [x] Build the approved pearl/ink/violet visual treatment with local assets and system fonts. Desktop rail/three cards; phone filter disclosure/single cards. Use original portfolio illustrations consistently and label fictional sample imagery in the demo information, without invented reviews or ratings.
- [x] Render profile biography, timezone, services/prices/durations, policy and deposit percent, with separate named page parameters for paginated services and portfolio. Only Published and eligible offerings get booking links. Keep the hero and Explore demo useful when a sandbox is full or expired.
- [x] Add `test_card_price_uses_the_matching_service`: a profile with a 2000-cent cut and 9000-cent colour, filter Colour/min8000, must show 9000 not 2000. `test_pagination_and_counts_share_filters`: 13 matching profiles produce total13, 12 on page1, one on page2, no duplicates. Test min>max, unknown location, invalid sort, Unicode names, literal wildcards, HTML escaping, empty results and suspended profiles returning404.

  ```php
  $this->assertSame(9000, $matchingProfile->starting_price_cents);
  $this->assertSame(13, $firstPage->total());
  $this->assertCount(12, $firstPage->items());
  $this->assertCount(1, $secondPage->items());
  ```

- [x] Run `/usr/bin/php8.4 vendor/bin/phpunit --filter DiscoveryTest`; expected all pass. Browser-check discovery/profile at 390 and 1440, including loading, keyboard filters and an empty result. Apply Task Gate.

## Task 6: Stylist onboarding, services and deposit settings

**Files:**
- Generate `app/Services/StylistService.php`, `app/Data/{StylistInput,ServiceInput}.php`, `app/Policies/{StylistProfilePolicy,ServicePolicy}.php`.
- Generate `app/Http/Controllers/{StylistProfileController,ServiceController}.php`, `app/Http/Requests/{StylistProfileRequest,ServiceRequest,SubmitProfileRequest}.php`.
- Create `resources/views/stylist/{profile,services,service-edit,onboarding}.blade.php`, `tests/Feature/StylistCatalogueTest.php`; modify routes, models and shared UI as needed.

**Interfaces:**
- `StylistService::saveProfile(User $actor, StylistInput $input): StylistProfile`.
- `StylistService::saveService(User $actor, ?Service $service, ServiceInput $input): Service`.
- `StylistService::submit(User $actor): StylistProfile` requires complete profile, at least one active eligible service and weekly hours.
- City changes call `AvailabilityService::assertScheduleSafe(...)` after Task 7; until then disallow city changes when any AwaitingDeposit/Confirmed booking exists. Task 7 replaces that conservative guard with the precise shared rule.

- [x] Implement owner-scoped profile/service creation and edits; obtain owner from authenticated principal, never request user_id. Service specialty must be enabled and selected for that profile. Preserve service rows/snapshots when inactive. Profile deposit defaults to 25% and allows 10–100%.
- [x] Separate saving a Draft from submitting Pending. Incomplete submission returns specific field errors; Pending submissions are idempotent; Published edits retain publication. Suspended profiles may edit content but cannot self-publish or remove suspension.
- [x] Build forms and paginated service list, local saved-state feedback, required markers and currency inputs converted to integer cents by validated request parsing. Reject scientific notation and more than two decimals. No destructive confirmation for routine save/deactivation; actual destructive actions use one.
- [x] Add assertions: another stylist's service404; forged status ignored/rejected; disabled specialty rejected; incomplete submit422; completed onboarding Pending; 10% and100% accepted,9%/101% rejected; 19.99 becomes1999 exactly; 120th service allowed/121st rejected; catalogue price/duration edits leave existing booking snapshot unchanged.

  ```php
  $this->assertSame(ProfileStatus::Pending, $submittedProfile->status);
  $this->assertSame(1999, $savedService->price_cents);
  $this->assertSame($originalSnapshotCents, $booking->fresh()->price_cents);
  ```

- [x] Run `/usr/bin/php8.4 vendor/bin/phpunit --filter StylistCatalogueTest`; expected all pass. Apply Task Gate.

## Task 7: Availability, DST and schedule protection

**Files:**
- Generate `app/Services/AvailabilityService.php`, `app/Data/{WeeklyInterval,WeeklySchedule,TimeOffInput,TimeSlot}.php`, `app/Policies/TimeOffPolicy.php`.
- Generate `app/Http/Controllers/AvailabilityController.php`, `app/Http/Requests/{WeeklyScheduleRequest,TimeOffRequest,SlotRequest}.php`.
- Create `resources/views/stylist/availability.blade.php`, `resources/views/bookings/slots.blade.php`, `tests/Unit/LocalTimeTest.php`, `tests/Feature/AvailabilityTest.php`; modify `StylistService`, relevant models and routes.

**Interfaces:**
- `AvailabilityService::localInstant(string $local, string $timezone): CarbonImmutable` rejects zero or multiple matching UTC instants.
- `AvailabilityService::slots(Service $service, string $localDate, CarbonImmutable $now): Collection<int, TimeSlot>`.
- `AvailabilityService::assertAvailable(StylistProfile $profile, CarbonImmutable $startsAt, CarbonImmutable $endsAt, ?int $exceptBookingId, CarbonImmutable $now): void` checks hours, time off and effective occupied intervals, without restarting lead time.
- `AvailabilityService::assertScheduleSafe(StylistProfile $profile, WeeklySchedule $schedule, string $timezone, ?TimeOffInput $timeOff, CarbonImmutable $now): void` returns conflicts as validation errors linked to the affected bookings.
- `AvailabilityService::saveWeekly(User $actor, WeeklySchedule $schedule): void`; `addTimeOff(User $actor, TimeOffInput $input): TimeOff`; `removeTimeOff(User $actor, TimeOff $timeOff): void`.

- [x] Parse exact `Y-m-d H:i` local inputs using timezone transition offsets and round-trip candidate instants; do not let Carbon silently normalize invalid or ambiguous times. Iterate UTC instants for slot calculation and retain only unambiguous local grid starts. All stored timestamps are UTC seconds.
- [x] Implement one-day slot calculation using weekly hours, duration, time off, effective active holds and Confirmed bookings. Half-open intervals permit touching endpoints. Requested/expired rows do not occupy slots. Slot selection applies the two-hour/60-day request window; acceptance uses `assertAvailable` without reapplying initial lead time.
- [x] Serialize schedule mutations with the profile booking-lock write. Reject a weekly-hours, city/timezone or time-off change that invalidates an effective hold or Confirmed appointment, showing affected links. Past completed/history is unaffected. Time-off listing paginates; cap40; removal is owner-authorized and confirmed as destructive.
- [x] Add `test_dst_gap_and_fold_are_rejected`: Europe/Paris `2027-03-28 02:30` and `2026-10-25 02:30` both throw validation errors; `2026-10-25 03:30` succeeds at `02:30Z`. Test invalid dates, wrong offsets, 09:07 start, end outside hours, and duration15/240 boundaries.
- [x] Add schedule tests: 10:00–11:00 accepts adjacent11:00, rejects10:45; exact now+2h accepted, one minute earlier rejected; exact now+60days accepted, one minute later rejected; hold expired at now no longer blocks; conflicting time off/closing-hours edit returns422 and preserves previous hours. Changing city/timezone that invalidates a confirmed slot fails atomically.

  ```php
  $this->assertSame(
      '2026-10-25 02:30',
      $availability->localInstant('2026-10-25 03:30', 'Europe/Paris')->format('Y-m-d H:i'),
  );
  $conflictingTimeOffResponse->assertStatus(422);
  ```

- [x] Run `/usr/bin/php8.4 vendor/bin/phpunit --filter 'LocalTimeTest|AvailabilityTest|StylistCatalogueTest'`; expected all pass, including replacement of Task6's conservative city guard. Apply Task Gate.

## Task 8: Booking requests, decisions and transactional inbox

Latest operator refinement: connect review/detail/inbox with clear state-aware next steps. For the configured sample identities, provide safe contextual role transitions returning to the relevant booking; validate both identities and ownership before switching, preserve CSRF/actor/session rules, and never allow arbitrary impersonation or redirect URLs. Normal registered users retain their own authorized flow. Add an HTTP regression for the sample handoff and foreign-booking rejection; use concrete existing state/role logic rather than a generic tour framework.

**Files:**
- Generate `app/Services/{BookingService,InboxService}.php`, `app/Data/BookingInput.php`, `app/Policies/{BookingPolicy,InboxMessagePolicy}.php`.
- Generate `app/Http/Controllers/{BookingController,BookingDecisionController,InboxController}.php`, `app/Http/Requests/{BookingRequest,BookingDecisionRequest,InboxReadRequest}.php`.
- Create `resources/views/bookings/{review,show}.blade.php`, `resources/views/inbox/index.blade.php`, `tests/Feature/BookingDecisionTest.php`, `tests/Feature/InboxTest.php`, `tests/Support/booking-worker.php`.
- Modify Booking/InboxMessage scopes, routes and shared components.

**Interfaces:**
- `BookingService::request(User $actor, BookingInput $input, CarbonImmutable $now): Booking`.
- `BookingService::accept(User $actor, Booking $booking, CarbonImmutable $now): Booking`; `decline(User $actor, Booking $booking, ?string $reason, CarbonImmutable $now): Booking`.
- `BookingService::expireFor(StylistProfile $profile, CarbonImmutable $now): int` is idempotent and called before relevant queries/transitions.
- `InboxService::record(Booking $booking, User $recipient, InboxEvent $event): InboxMessage` derives deterministic subject/body and event key from snapshot/event/recipient; called inside the domain transaction.
- `InboxService::messages(User $actor, int $page): LengthAwarePaginator<InboxMessage>`; `markRead(User $actor, InboxMessage $message): void`.

- [x] Lock by incrementing the profile booking-lock version as the first domain write before conflict reads, then reload affected rows. Authorize Client and check the unique intent key/fingerprint before reapplying mutable catalogue/time-window rules: an identical retry returns the original result even after a price/timezone change, while a reused key with different service/local time/note returns409. A new intent validates current publish/specialty/service eligibility and initial lead/horizon, then snapshots amounts/timezone/duration. Ignore/reject browser amounts. Reject a second active identical request under a new key.
- [x] Reserve eight notification slots when creating a request: require `count(inbox) + sum(bookings.notification_budget) + 8 <= 1000`. Decrement the booking budget as each unique message is inserted; release unused budget on terminal states. Existing transitions can use their reserved capacity. This is a booking field, not a quota service. Record cap150 includes history.
- [x] Implement Requested→AwaitingDeposit and Requested→Declined. Acceptance checks published profile, active eligible service, snapshots, current hours/time off/overlap, and now before start. Set fixed min(now+30min,start) deadline. Idempotent repeat accept never extends it. A reactivated price/duration setting never replaces snapshots.
- [x] Expire Requested at start and AwaitingDeposit at deadline, recording notifications once. Queries use the same effective-status predicates before stored-status reconciliation. Expire at most the sandbox's bounded150 bookings, ordered by deadline; no job/cron dependency.
- [x] Deliver events inside the same visitor transaction: RequestReceived to stylist; RequestAccepted/RequestDeclined to client; BookingExpired to client and stylist. Render inbox only for current recipient; mark-read POST is authorized. Admin has no private-inbox override.
- [x] Build review/detail/inbox screens with timezone, full/deposit/remaining amounts, plain-text note<=500, and visible requested-versus-held explanation. Review GET computes server values; POST rechecks all rules. Failed/conflicting decisions show the result beside the affected booking.
- [x] Add tests: price1999 at25% deposits500, remaining1499; full100% deposit1999; price/settings changed after request leave snapshots unchanged and an identical intent retry returns the original; accept within the last2h is allowed with shortened deadline; duplicate accept leaves original deadline; note HTML escaped; foreign client/stylist IDs404; admin cannot accept; message insert failure rolls back status.
- [x] Use two real processes in `test_only_one_overlapping_request_can_be_accepted`; assert exactly one AwaitingDeposit, one acceptance message, loser409 or explicit retryable503 followed by conflict on retry. Test adjacent intervals both accepted, expiry at exact boundary, two clients requesting same slot before acceptance, and inbox-cap admission while an already reserved booking can complete its messages. `InboxTest` asserts recipient isolation, single event after retry and unread count/read state consistency.

  ```php
  $this->assertSame(500, $booking->deposit_cents);
  $this->assertSame(1499, $booking->remaining_cents);
  $this->assertSame(1, Booking::query()->where('status', BookingStatus::AwaitingDeposit)->count());
  ```

- [x] Run `/usr/bin/php8.4 vendor/bin/phpunit --filter 'BookingDecisionTest|InboxTest'`; expected all pass. Apply Task Gate.

## Task 9: Simulated deposits, cancellation and role workspaces

Complete the guided sample request → stylist acceptance → client deposit → confirmation/inbox journey using the contextual handoff fromTask8. Each state needs a clear primary next action, current perspective and sensible failure/expiry/cancellation recovery; a success flash alone is insufficient. Verify the connected sequence through HTTP before parent browser acceptance.

**Files:**
- Generate `app/Services/PaymentService.php`, `app/Data/CheckoutResult.php`, `app/Http/Controllers/{CheckoutController,BookingLifecycleController,WorkspaceController}.php`, `app/Http/Requests/{CheckoutRequest,CancelBookingRequest,CompleteBookingRequest,WorkspaceRequest}.php`.
- Create `resources/views/checkout/show.blade.php`, `resources/views/workspaces/{client,stylist}.blade.php`, `resources/views/components/booking-card.blade.php`, `tests/Feature/PaymentLifecycleTest.php`, `tests/Feature/WorkspaceTest.php`.
- Modify `BookingService`, `InboxService`, booking-worker, policies, routes, models and shared UI.

**Interfaces:**
- `PaymentService::checkout(User $actor, Booking $booking, CheckoutOutcome $outcome, CarbonImmutable $now): CheckoutResult`.
- `PaymentService::refund(Booking $booking): Payment` requires the caller's active cancellation transaction; unique Refund makes repeat safe.
- `BookingService::cancel(User $actor, Booking $booking, ?string $reason, CarbonImmutable $now): Booking`; `complete(User $actor, Booking $booking, CarbonImmutable $now): Booking`.
- `BookingService::forActor(User $actor, ?BookingStatus $status, ?string $localDate, int $page, CarbonImmutable $now): LengthAwarePaginator<Booking>`; `countForActor(User $actor, BookingStatus $status, CarbonImmutable $now): int` uses the same effective-state query rules.

- [x] Implement clearly labelled simulated success/failure with no card inputs/network delivery. Both outcomes first authorize owner and recheck state/deadline/availability using snapshots under the booking lock. Success creates one Deposit and Confirmed plus DepositPaid messages to client/stylist. Failure returns unchanged hold/deadline and clear retry copy; cancellation of checkout is a normal back link.
- [x] Treat repeated successful checkout of an already Confirmed/Completed booking with its matching Deposit as idempotent; Cancelled/Expired never reopens. Exact-deadline checkout fails after persisting expiry in a complete transaction. Do not roll expiry back merely to return an error response.
- [x] Implement upcoming cancellation: Client Requested/AwaitingDeposit/Confirmed; owning Stylist AwaitingDeposit/Confirmed. Require now<start. Confirmed cancellation writes one full Refund, changes state, releases slot and sends BookingCancelled plus DepositRefunded to both recipients atomically. Retry returns the existing cancelled result/refund. Complete is stylist-only Confirmed and now>=end. No completion notification is required; release unused notification budget.
- [x] Build client and stylist workspaces with paginated history/upcoming/requests, date-selected local schedule and count queries consistent with cards. Show deposit deadline, studio timezone and remaining studio balance. Use destructive confirmation for cancellation only and immediate visible progress for every action.
- [x] Add `test_success_failure_and_cancelled_checkout`: failed outcome no payment/no deadline extension; back link no mutation; two success posts one Deposit/two confirmation messages; admin cannot pay another actor's deposit. `test_late_payment_never_resurrects` freezes exactdeadline and expects Expired/no Deposit. `test_cancel_refunds_exactly_once` expects one Refund equal snapshot deposit and zero occupied slot.
- [x] Add real-process races: checkout versus expiry, checkout versus cancellation, two cancellation requests. Allowed final states must have consistent payment/refund/message counts; no Cancelled booking with an unrefunded captured Deposit. Test cancellation at exactstart denied and completion at exactend allowed, while one second earlier denied. Exhaust notification admission without breaking reserved cancellation messages.

  ```php
  $this->assertSame(BookingStatus::Cancelled, $booking->fresh()->status);
  $this->assertSame(1, $booking->payments()->where('kind', PaymentKind::Refund)->count());
  $this->assertSame(500, $booking->payments()->where('kind', PaymentKind::Refund)->sole()->amount_cents);
  ```

- [x] `WorkspaceTest` asserts totals agree with filters/pagination, recipient/role boundaries, status labels at expiry and completed seeded journey. Run `/usr/bin/php8.4 vendor/bin/phpunit --filter 'PaymentLifecycleTest|WorkspaceTest|BookingDecisionTest|InboxTest'`; expected all pass. Apply Task Gate.

## Task 10: Private portfolio upload lifecycle

**Files:**
- Generate `app/Services/PortfolioService.php`, `app/Data/PortfolioInput.php`, `app/Policies/PortfolioImagePolicy.php`, `app/Http/Controllers/PortfolioController.php`, `app/Http/Requests/{PortfolioRequest,RemovePortfolioRequest}.php`.
- Create `resources/views/stylist/portfolio.blade.php`, `tests/Feature/PortfolioSecurityTest.php`, `tests/Feature/PortfolioLifecycleTest.php`; modify SandboxService cleanup, profile view, routes and local JS.

**Interfaces:**
- `PortfolioService::store(User $actor, SandboxContext $context, PortfolioInput $input): PortfolioImage`.
- `PortfolioService::remove(User $actor, SandboxContext $context, PortfolioImage $image): void`.
- `PortfolioService::read(User $actor, SandboxContext $context, PortfolioImage $image): Response` authorizes the image's profile visibility/ownership in the current sandbox and returns bounded bytes synchronously.

- [x] Inspect finfo MIME, magic structure, dimensions and pixel count before GD decode; accept only JPEG/PNG/WebP. Reject PNG animation chunks and WebP ANIM/ANMF chunks using length-bounded container parsing; reject malformed/truncated containers and SVG. Re-encode decoded pixels to JPEG/PNG, preserve transparency where appropriate, strip metadata, resize<=1600, reject output>1MiB. Do not install an image library.
- [x] Under admitted visitor access, reserve one ledger slot/cryptographically generated flat filename before writing. Count Reserved/Attached/Retiring toward eight. Record upload in visitor transaction; mark Attached only after the outer request transaction commits, using a synchronous after-commit callback. Crashes leave a reserved file reclaimable after four hours, and successful visitor rows protect files whose registry finalization was interrupted. Reconciliation must consult the locked visitor row before deleting an old Reserved file.
- [x] Removal marks ledger Retiring and removes the visitor-visible row atomically. The next bounded cleanup deletes the file only after obtaining visitor access and confirming the reference is absent; a rolled-back removal instead restores Attached. Retain ledger/count on deletion failure and report queued cleanup when relevant. Never delete a file before the outer request transaction commits. Immutable seed artwork is never deleted by an upload route.
- [x] Serve private images through authorized routes with content type, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`; never redirect to a storage path. Published-profile images are visible to authenticated visitors inside that sandbox; Draft/Pending/Suspended images only to owner/admin review. Do not use `storage:link`.
- [x] Build portfolio captions/upload/delete feedback and paginated preview. Set multipart loading immediately. Required image/caption validation is adjacent; deletion uses confirmation. No filesystem path appears in user errors.
- [x] Add tests for MIME-spoofed PHP/JPEG, SVG, animated WebP/APNG, truncated lengths, >5MiB, >4096 side, >4MP, metadata stripping, output size, 9th upload, forged path and cross-sandbox numeric-ID collisions. Assert no file/database mutation on rejection.
- [x] Add crash/failure tests at reserve/write/visitor-commit/finalize/delete; assert no untracked file, no deletion of referenced file, retained quota on failure and later bounded reclamation. `test_read_bytes_survive_concurrent_cleanup` must show an admitted authorized response completes before its retired file is removed.

  ```php
  $ninthUploadResponse->assertStatus(429);
  $foreignImageResponse->assertNotFound();
  $this->assertSame(8, SandboxFile::query()->where('sandbox_digest', $context->digest)->count());
  ```

- [x] Run `/usr/bin/php8.4 vendor/bin/phpunit --filter 'PortfolioSecurityTest|PortfolioLifecycleTest|SandboxLifecycleTest'`; expected all pass. Apply Task Gate.

## Task 11: Admin review and eligibility boundaries

**Files:**
- Generate `app/Services/AdminService.php`, `app/Policies/SpecialtyPolicy.php`, `app/Http/Controllers/AdminController.php`, `app/Http/Requests/{ReviewStylistRequest,SpecialtyAvailabilityRequest,AdminBookingRequest}.php`.
- Create `resources/views/admin/{index,applications,application,bookings,specialties}.blade.php`, `tests/Feature/AdminEligibilityTest.php`; modify routes and shared UI.

**Interfaces:**
- `AdminService::publish(User $actor, StylistProfile $profile): StylistProfile`; `suspend(User $actor, StylistProfile $profile): StylistProfile`; `setSpecialty(User $actor, Specialty $specialty, bool $enabled): Specialty`.
- `AdminService::applications(int $page): LengthAwarePaginator<StylistProfile>`; `bookings(?BookingStatus $status, int $page, CarbonImmutable $now): LengthAwarePaginator<Booking>`.
- Every admin controller checks Admin role; service mutation methods repeat authorization as domain entry points. List methods are only called behind that controller boundary.

- [x] Implement Pending→Published after completeness checks, Published→Suspended, and explicit admin republishing of a suspended complete profile. Only suspension uses a destructive-action confirmation. Display the profile and private onboarding images for review without exposing the applicant's inbox.
- [x] Admin specialty toggle prevents new service creation/discovery/requests and acceptance of still-pending requests. Existing AwaitingDeposit/Confirmed bookings can pay/cancel/complete from snapshots even after profile suspension, service deactivation or specialty disablement. Apply current schedule/overlap/deadline checks normally.
- [x] Build paginated applications, profile review, specialties and booking oversight; counts use the same effective-state queries as workspaces. Admin has no payment/cancellation impersonation route and no arbitrary role-switch target.
- [x] Add `test_disabled_catalogue_preserves_existing_obligations`: request two bookings; accept one; disable/suspend; reject new request and remaining acceptance. In independent fixtures, the accepted booking still pays then refunds, or pays then completes through its real actors. Test incomplete profile cannot publish, nonadmin403, history preserved, admin private-inbox404 and count consistency after expiry.

  ```php
  $this->assertSame(BookingStatus::Confirmed, $paidResult->booking->status);
  $pendingAcceptanceResponse->assertStatus(409);
  $adminPrivateInboxResponse->assertNotFound();
  ```

- [x] Run `/usr/bin/php8.4 vendor/bin/phpunit --filter 'AdminEligibilityTest|PaymentLifecycleTest|DiscoveryTest'`; expected all pass. Apply Task Gate.

## Task 12: Clean package, browser acceptance and delivery evidence

Integration correction confirmed in parent browser QA after Task9: a wrong-role booking review currently tells the visitor to use the global Client switch, which redirects to Workspace and loses the selected service/time. Add a contextual signed, CSRF-protected sample-client continuation that preserves and revalidates that selection, retaining actor/session rotation and global switch behavior. Cover the visible review continuation with an isolated HTTP regression and repeat it in browser acceptance. No arbitrary return URL or eligibility bypass.

Final acceptance must follow visible controls through the entire sample journey without guessing routes, role ownership or IDs. Endpoint tests alone do not establish this. Include native Argon2id support and configured memory/time behavior in the hosted preflight; fresh delivery fixtures use the current driver, never the existing local runtime.

**Files:**
- Generate `app/Services/DeploymentService.php`, `app/Console/Commands/PackageDemo.php`.
- Create `demo:deploy/infinityfree/{index.php,.htaccess,.user.ini,sqlite-check.php,private-config.example.php}`, `tests/Feature/DeploymentPackageTest.php`, `tests/Feature/FullJourneyTest.php`.
- Create `demo:README.md`, `demo:docs/{walkthrough,feature-map,deployment}.md`, `demo:docs/verification/2026-10-21-local-verification.md` and screenshots beneath `demo:docs/verification/screenshots/`.
- Update `demo:docs/assets.md`, `workspace:README.md`, demo/application `.gitignore`, `.env.example` and only UI files with verified defects.

**Interfaces:**
- `DeploymentService::package(string $outputDirectory, string $fixtureDirectory): string` returns archive path, refuses an existing output and copies an explicit allowlist.
- Console signature `demo:package {--output=} {--fixtures=}`; no hosted commands or upload side effects.
- Public package path `/stylist-discovery/`; private application `/stylist-discovery/_app/`; storage roots pre-created in the archive and denied by Apache rules.

- [ ] Build new pristine fixtures, then install production dependencies from the lockfile into a generated staging manifest/vendor tree using `--no-dev --no-scripts --classmap-authoritative`. Do not replace development vendor or copy visitor runtime state. Package public front controller/local assets plus private application, fresh fixture databases and empty storage directories.
- [ ] Supply separate private configuration example with required APP_KEY and absolute resolved paths supplied by operator during deployment; fail if absent or placeholder. Never bake a development key, local `.env`, configuration cache, session, log, upload or visitor DB into the archive. Disable debug and runtime caches that require Artisan; use included optimized Composer autoloading. Blade compiles into the pre-created private view-cache folder.
- [ ] Include Apache deny rules for `_app`, dotfiles, sqlite/journal/log and configuration files; correct RewriteBase/front-controller handling for subdirectory URLs. Supply the target PHP limits through `.user.ini`, but verify effective hosted values instead of assuming overrides are permitted. The short operator-only sqlite-check reports PHP version, SQLite/GD support and effective upload/memory limits, then is removed by the operator. Nothing invokes schema creation or parent-directory creation on the host.
- [ ] Add `DeploymentPackageTest`: archive allowlist and file count below30000 with at least runtime-file reserve; no seeded usable password/key/live database; private path responses denied in local Apache/PHP8.4 harness; missing config fails closed; all links/assets/forms work under `/stylist-discovery/`; connection/file operations stay inside configured storage under `open_basedir`. If matching Apache/FPM tooling is unavailable, record that check as unverified rather than substituting CLI evidence.
- [ ] `FullJourneyTest`: independent visitors A/B; A requests, switches stylist, accepts, switches client, fails then pays, sees receipt/inbox, cancels/refunds; B sees none of A's changes. A new stylist registers, completes onboarding/services/hours, submits, admin publishes, and another client can request. Assert no external HTTP or real mail in all paths.

  ```php
  Http::assertNothingSent();
  Mail::assertNothingSent();
  $this->assertSame(0, $visitorBRowsMatchingVisitorsANewRequestKey);
  $this->assertLessThan(30000 - 255, $packagedFileCount);
  ```

- [ ] Run `/usr/bin/php8.4 vendor/bin/phpunit` once as final suite after the targeted task suites pass. Expected exit0/all passing; record actual totals, PHP version and commands. Run Pint only on the explicit files touched by this task and any files still pending formatting, not all vendor/source indiscriminately.
- [ ] Browser-check 320/390/768/1440 widths, keyboard-only navigation, reduced motion/blur fallback, loading/back navigation, validation, empty lists, capacity/expiry, role-switch stale form and the full booking journey. Capture discovery, profile, mobile booking, stylist requests, checkout, inbox and admin screenshots using available browser tools. Use two independent browser sessions for isolation; two tabs sharing cookies are not that test. Record any unavailable check honestly.
- [ ] Write run steps, client/stylist/admin walkthrough, posting feature map, dependency/asset provenance, simulated-feature limits, storage/file budget, exact build commands and operator hosted acceptance checklist. Hosted acceptance includes PDO SQLite/GD, `_app`403, subdirectory routing, two-browser isolation, cookies, full journey and quota/reclamation behavior. Mark it Pending until operator evidence exists.
- [ ] Apply Task Gate. Deliverable is a locally verified, reviewable package and documentation; no publication or claim of hosted verification.

## Task Gate — applies after every task

1. Implementer returns changed-file list, exact checks/results and unresolved facts. No next-task implementation is included.
2. A fresh adversarial reviewer gets the task/spec/diff and directive **“THIS CODE IS WRONG! PROVE OTHERWISE!”** Review correctness, architecture, security, code laws and mobile behavior where applicable.
3. The orchestrator verifies every claim against the exact code with one focused check per claim. Routine fix rounds are authorized by the operator's completion directive. All confirmed findings, regardless of severity, are fixed by the implementer and receive scoped re-review.
4. Continue to the next task after checks and review pass. Do not stop for per-task handoff, approval or commits. Leave Git untouched and deliver only after the full interactive demo and its verification are complete.
5. Store task briefs/review ledgers outside the repository at `~/.claude/projects/-var-www-demo-stuff/sdd-snapshots/2026-10-21-stylist-discovery/`. This requires the narrow write authorization below; do not inspect unrelated home files.

## Permissions to approve before implementation

Approving the product design did not authorize these operations. This plan proposes the following explicit, folder-scoped permissions; any item not approved remains gated. Git remains read-only and publishing remains excluded.

### Agent models

Haiku/Sonnet/Opus are not available in this Codex session. Proposed substitutes: **gpt-6.1-sol with high reasoning** for implementers, **gpt-6-astra with high reasoning** for independent adversarial reviewers. The orchestrator still does no implementation. The operator must approve these substitutions or supply another available selection before dispatch.

### Dependency and generated-output permissions

Allow a fresh Laravel skeleton under `stylist-discovery/site/`, then these exact direct requirements:

```json
{
  "require": {"php": "^8.4", "laravel/framework": "13.36.0"},
  "require-dev": {"laravel/pint": "1.32.1", "phpunit/phpunit": "12.5.39", "mockery/mockery": "1.6.15"}
}
```

Allow their resolved transitive dependencies in `composer.lock`. No npm packages. Run the following commands in order, with visible manifest edits between scaffold and update:

```bash
# Working directory: /var/www/demo_stuff/stylist-discovery
/usr/bin/php8.4 /usr/local/bin/composer create-project laravel/laravel site '^13.0' --no-install --no-scripts --no-interaction

# Working directory: /var/www/demo_stuff/stylist-discovery/site
/usr/bin/php8.4 /usr/local/bin/composer update --no-scripts --no-interaction --prefer-dist
/usr/bin/php8.4 artisan package:discover --ansi
```

`make:*` retains existing standing approval. Generate controllers, requests, models, policies, middleware, enums, classes, seeders, migrations, commands and tests with `make:controller`, `make:request`, `make:model`, `make:policy`, `make:middleware`, `make:enum`, `make:class`, `make:seeder`, `make:migration`, `make:command` and `make:test`. Then use visible edits; no manually authored substitute framework artifacts. Move generated migration names to the canonical paths through visible Edit tools.

Explicit generated-output exception: Composer/scaffold/generators may write their generated files; Pint may format the explicit touched-file list; the listed key generator may write APP_KEY to the new ignored `.env.local`; approved tests may create/remove their own temporary fixtures; the approved package builder may copy source/vendor/assets into a new staging directory and write its archive. Authored source, configuration and documentation still use visible Edit/Write tools. Application-created demo records/uploads and their bounded expiry cleanup are limited to this demo's runtime folders.

### Isolated tests and local runtime

Request standing permission for the listed PHPUnit/Pint commands and equivalent targeted reruns **inside `stylist-discovery/site/` only**, with databases exclusively in memory or beneath a generated `storage/framework/testing/<random>/` root. Test harnesses may migrate/query those isolated fixtures and launch PHP8.4 subprocesses; they may remove only their generated fixtures. No existing demo/application DB may be opened.

Request permission for these exact local fixture/build/server commands when their owning task is reached:

```bash
# Working directory: /var/www/demo_stuff/stylist-discovery/site
/usr/bin/php8.4 artisan key:generate --env=local
/usr/bin/php8.4 artisan demo:build-fixtures --env=local --output=storage/app/demo-runtime
/usr/bin/php8.4 artisan demo:build-fixtures --env=local --output=../deploy/build-2026-10-21/fixtures
/usr/bin/php8.4 artisan demo:package --env=local --output=../deploy/build-2026-10-21/package --fixtures=../deploy/build-2026-10-21/fixtures
APP_ENV=local /usr/bin/php8.4 -S 127.0.0.1:8095 -t public
```

The local browser server may create/query/update/delete only this demo's fresh registry, visitor DBs and uploaded images under `site/storage/app/demo-runtime/`. It must not use another demo's storage. The key command is allowed only once against this task's new ignored `.env.local`, without `--show`; no production `.env` is read. The fixture builder refuses a populated runtime or existing output, so it cannot reset a running demo.

The package command's permitted Composer subprocess, with cwd at its new staging `_app`, is exactly:

```bash
/usr/bin/php8.4 /usr/local/bin/composer install --no-dev --no-scripts --no-interaction --prefer-dist --classmap-authoritative
```

Outputs must be new directories. Rebuilding an existing output requires a new exact path or separately approved deletion; never silently wipe a prior build. Browser/network binding or outside-workspace permissions may still require the tool's automatic approval review.

### Narrow deletion and review-record permissions

- Remove these generated, unused starter files only: `site/resources/views/welcome.blade.php`, `site/resources/css/app.css`, `site/resources/js/{app,bootstrap}.js`, `site/package.json`, `site/vite.config.js`, `site/tests/{Feature,Unit}/ExampleTest.php`, `site/database/factories/UserFactory.php`, generated `site/database/database.sqlite` if present and confirmed to be the unused scaffold artifact, and the three stock `site/database/migrations/0001_01_01_00000{0,1,2}_*.php` files after replacing their schemas with the named visitor/registry migrations. Generated migration renames are permitted. No deletion elsewhere.
- Runtime deletion is limited to ledger-owned visitor databases/journals/images and expired registry/session/cache rows under this demo, as tested above. Tests delete only their own generated directories. Local logs may keep one size-limited rotation; do not delete operator files.
- Allow creation/update of this plan's task/review records only beneath `~/.claude/projects/-var-www-demo-stuff/sdd-snapshots/2026-10-21-stylist-discovery/`, as required by the workspace workflow. This is not permission to read other home directories.

## Plan self-review

- Spec coverage: foundation/seed/isolation (1–3), identity (4), discovery/visuals (5), onboarding/catalogue (6), scheduling (7), requests/inbox (8), checkout/lifecycle/workspaces (9), portfolio (10), admin (11), package/evidence (12).
- Cross-task contracts: DTO fields and service signatures are defined before use; Task6's temporary schedule guard is explicitly replaced in7; Task8 introduces inbox/event reservations before Task9 uses them; no task requires a real external service.
- Failure coverage: each Review Focus entry has named test cases, including independent PHP processes rather than only sequential unit tests. Test safety is implemented first.
- Approval boundaries: plan and scoped dependency/model/runtime/cleanup permissions were approved before Task1. The subsequent completion directive removes per-task commit and routine-fix approval gates. Git, production data and publication remain outside scope.
- Validation status: this document has been self-reviewed against the approved spec. Test cases and package checks above are planned, not executed or reported as passing.
