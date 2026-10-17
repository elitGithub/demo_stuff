# Execution ledger — plan: real_estate_demo/docs/superpowers/plans/2026-10-15-haven-marketplace.md

Approved spec: ../specs/2026-10-15-home-services-design.md
Execution: native implementation with one independent final review.
Scope: real_estate_demo only. Started 2026-10-15.

## Decisions and preflight

- Ruling: Work in the existing designated directory; do not create branches, worktrees or commits — explicit operator restrictions and approved plan override skill defaults — cost: the operator owns versioning and integration.
- Ruling: Keep this ledger permanently instead of deleting a skill workspace — there will be no implementation commits to recover progress from — cost: one additional documentation file.
- Approval boundary: dependency installation, source edits, linting and DB-free unit tests are authorized. Each Artisan invocation needs exact approval. Database tests and local initialization still need explicit database authorization.
- Legacy inventory: ../legacy-source-inventory.json records 171 files (7,021,418 bytes) by path, size and SHA-256. No legacy files have been changed or removed.

| Producer → consumer | Shared interface | Preflight result |
| --- | --- | --- |
| 1 → 2–8 | Model names, role/status enums, integer cents, fixture helpers | Consistent with approved spec and shared contracts. |
| 2 → 3–7 | Session authentication, role middleware, provider approval, allowlisted demo identity | Demo identity keys must remain non-fillable and protected in admin changes. |
| 3 → 4–7 | Request visibility, photo policy, coarse location, owner-only private address | Historical quoting providers may read the request, but only a hired provider receives private address. |
| 4 → 5–6 | Quote version and accepted quote, request-first transaction ordering | Acceptance and subsequent proposal edits must recheck locked state; accepted quote is immutable. |
| 5 → 6–7 | Conversation participants, notification recipient | Admin does not gain private conversation access; closed/suspended threads are read-only. |
| 6 → 7–8 | Completed state, accepted amount, unique payment and review | Totals/identities are derived from persisted agreement; retries cannot create duplicate receipts or reviews. |
| 7 → 8–9 | Admin status changes, protected demo accounts | Suspended providers lose new work/write access while preserving historical reads. |
| 8 → 9 | Standalone fixtures/assets and validated app | Legacy removal waits for verified standalone workflows and an exact manifest match. |

## Task status

1. Domain, money and isolated configuration: complete.
2. Accounts, authentication and profiles: complete.
3. Glass shell, discovery and requests: complete.
4. Quotes and atomic hiring: complete.
5. Conversations and notifications: complete.
6. Job lifecycle, simulated payments and reviews: complete.
7. Admin and dashboards: complete.
8. Fixtures, full journey, concurrency, browser and documentation: complete.
9. Legacy archive/removal and final verification: complete.

## Verification record

- Baseline: Composer validation and platform requirements passed; stock Vite build passed.
- Installation uses --no-scripts --no-plugins. No Artisan command or database access has run.
- Boost dependency installation started; exact approval requested for php artisan boost:install.

- Boost v2.10.3 dependency installed successfully (no scripts/plugins; no security advisories reported).
- Approved php artisan boost:install run exited 1: no boost namespace. Source inspection confirmed both boost.enabled=false and missing APP_ENV=local prevented command registration. Enabled the development tool, kept browser logging off, and prepared a local .env with file-backed cache/session and a generated key. No database created or accessed. Fresh exact command approval required for retry.
- Boost test enforcement configured explicitly to prevent its installer spawning an unapproved artisan test --list-tests child command; integrations/MCP disabled.
- Rechecked legacy manifest: all 171 files, 7,021,418 bytes, exact SHA-256 matches.

- Operator ran Boost installation successfully; generated AGENTS.md read. No .ai/rules directory exists.
- Ruling: Create Laravel source files directly and use vendor/bin/phpunit, rather than generated make/test shell commands — approved plan and operator command restrictions take precedence over generated Boost conventions — cost: hand-written scaffolding must be verified by lint and tests.
- Operator approved repeated isolated PHPUnit runs (including internal test migrations) for implementation. This excludes local/demo databases and shell Artisan commands.
- Money: expected missing-class failures observed; implementation and validation now pass all 36 unit tests.
- Schema: six expected absent-model/schema failures observed against :memory: before implementation.

- Task 1: complete. vendor/bin/phpunit --no-progress: 43 tests, 49 assertions passed. Composer lock refreshed without dependency changes; Pint applied enum import formatting.
- Task 2: account/profile/demo HTTP tests initially had 14 failures from missing routes (18 cases total). First implemented run: 17/18 passed; production-environment case reached real CSRF protection (419) because switching environment disables Laravel test bypass. Corrected the test to submit a session CSRF token, preserving production middleware.

- Task 2: complete. Full suite passed: 61 tests, 125 assertions. Account creation, sessions, throttling, profile edits and allowlisted demo entry covered.
- Task 3: 29 expected request/discovery/photo/opportunity failures observed before implementation; partial-storage mock initially also reported missing-class handler cleanup (implementation absent).

## Operator steering: InfinityFree and read-only public demo

- Operator specified the existing InfinityFree account/site and a subdirectory deployment like travel-agency-demo. Public demo must disable writes/deletes via a database hook and .env demo mode.
- Ruling: Preserve real workflows in local mode and guard shared hosted data in MODE=demo (also accepts lowercase mode=demo and APP_ENV=demo) — incorporates the explicit latest instruction without removing the portfolio workflows — cost: hosted visitors inspect seeded workflow states instead of persisting changes.
- Adapt the existing CRM beforeExecuting guard; add HTTP guard to prevent file-write side effects; allow session-only login/logout/role switching. No sibling files are modified.
- Task 8 now includes InfinityFree subdirectory packaging, MySQL import artifact, shared-host session isolation, and read-only mode tests/documentation. Publishing and live database access remain outside current approvals.
- Official InfinityFree Laravel hosting guide checked: prebuilt vendor/assets, file sessions/cache, no terminal Artisan, no persistent queue/websocket process. PHP 8.4 reported by staff in October 2026 support search; verify runtime before eventual upload.

- Read-only demo addendum: 14 tests, 34 assertions passed. Direct SQL mutations, HTTP registration, password rehash avoidance, remember-token preservation, logout and role switching covered. MODE=local written to local environment; MODE=demo is a deployment setting.
- Task 3: complete. Full suite: 106 tests, 310 assertions passed. Vite build passed with locally bundled fonts and no fallback warning. Original house illustration, service art, responsive public/workspace layouts, scoped dashboards, requests, validation, private photos, rollback cleanup, matching and notifications implemented. Browser visual review remains scheduled for Task 8.
- Existing ExampleTest now uses RefreshDatabase because the real home page queries categories. No production query was hidden or mocked to preserve the old stock test.
- Request-photo storage deliberately has no public disk URL and local disk serving is disabled.

- Task 4: proposal/hiring tests observed 21 missing-route failures before implementation, then all 21 tests / 83 assertions passed. Request-first locks, profile revalidation, quote versions, atomic accepted-quote compare-and-set, idempotent acceptance, declined notifications and private comparisons are implemented. File-backed concurrent execution remains an explicit Task 8 verification requiring separate database-file approval.

- Task 4: complete. Full suite passed: 127 tests, 393 assertions. Frontend build passed.
- Task 5: 14 missing-route failures observed before implementation.
- Ruling: Normalize notification payload keys to route_name / route_parameters (Task 5 contract) and resolve only allowlisted destinations — the earlier Task 3 implementation used route / parameters and no real demo database exists yet — cost: no deployed data migration; future fixtures use the normalized keys.

- Task 5: complete. Conversation/notification tests: 14 tests, 77 assertions; full suite: 141 tests, 470 assertions passed. Scoped inboxes, participant-only conversations, closed-thread guards, safe notification links and explicit read actions implemented.
- Task 6: 11 expected failures observed for missing lifecycle/payment/review endpoints and candidate timeline visibility.

- Task 6: complete. Lifecycle/payment/review tests: 11 tests, 95 assertions passed. Full suite: 152 tests, 565 assertions; Vite build passed. Private timelines, state transitions, cancellation, agreed-price simulated checkout/receipts and unique completion-gated reviews implemented.
- Task 7: 11 expected failures across 12 admin/dashboard cases before implementation; pre-existing scoped customer dashboard case passed.
- Ruling: Admin category icon values use the implemented six SVG keys (pipe, bolt, brush, leaf, wrench, sparkles), replacing the plan example plumbing — shared UI contract already uses these keys — cost: future icons must be added to the allowlist.

- Task 7: complete. Admin/dashboard suite: 12 tests, 77 assertions; full suite: 162 tests, 636 assertions passed. Vite build passed. Scoped metrics, protected demo identities, approvals/suspension and non-destructive category administration implemented.
- Task 8: four expected absent-seeder errors observed; complete real HTTP request/photo/quote/message/hire/progress/payment/review journey already passes.

- Operator approved one local migrate/seed command, one local serve command and browser exercise of fictional local data. Both exact Artisan commands ran successfully; local preview is http://127.0.0.1:8091.
- Operator also approved file-backed concurrency fixtures and guarded child processes, including reruns after fixes. First concurrency run found SQLite deferred read-to-write upgrade failure (database is locked). Framework source confirms PHP 8.4 supports configured BEGIN IMMEDIATE; changed SQLite transaction mode to IMMEDIATE with 5-second busy timeout. MySQL row locks remain unchanged.

- Concurrency regression now passes: exactly one success, one 409, one accepted quote and one booking event.
- Browser desktop journey passed through request/photo, proposal, message, hiring/private-address disclosure, work progress, customer confirmation, simulated receipt and review. Phone 390px completed-project page has no document overflow.
- Browser found two UI gaps: mobile navigation lacked sign-out; photo previews lacked removal. Added accessible controls and scheduled browser recheck. Removed an unnecessary registered-mark symbol from receipt branding.
- Hosting SQL export compiles actual migrations using a disconnected MySQL grammar and serializes only in-memory fictional test fixtures. No MySQL server is contacted. Export regression passed (26 assertions); 25 SQL-classifier unit cases also passed.

- Independent final review found three Important issues and one suspected malformed-image issue. Reproduced and fixed failed-write orphan cleanup, hired-provider historical receipt access, missing empty runtime folders in ZIP, and header-only PNG acceptance. Focused request/payment regressions pass: 21 tests, 136 assertions. ZIP extraction regression failed against the old artifact as expected; new package verification is pending.
- Ruling: Defer the Minor admin category validation recovery polish — invalid category edits currently reload persisted field values, requiring re-entry — no data corruption or access-control impact; final report records this limitation.
- Full suite after review fixes: 196 tests, 783 assertions, one intentional opt-in concurrency skip. Formatter applied only within the application. Receipt print stylesheet corrected to target the actual header/demo-bar classes.

- Final reviewer narrow recheck: all four Important findings resolved; PASS WITH SUGGESTIONS for the recorded Minor category input-recovery issue. Reviewer independently inspected runtime directory entries in the rebuilt ZIP.
- Production build, Composer validation, Pint and separate concurrency 1/4 all pass. Rebuilt package .cache/haven-infinityfree-20261015-210026 passed extraction audit (6,692 files).
- Browser completed ordinary provider approval/login/proposal; category deactivation/history/restoration; phone hiring/progress/checkout/review; notifications read filter and closed conversation; tablet and desktop layout checks.
- Attempted MODE switch on the existing --no-reload server retained its startup MODE=local and saved a fictional test request. Framework ServeCommand source confirms inherited environment. Restored .env; requested exact approval for a separate MODE=demo server. No production-mode code changed for this verification setup error.
- Legacy preflight: all 171 files / 7,021,418 bytes still exactly match inventory; no legacy runtime/build references among 174 text files; original asset provenance checked.

- Task 9 complete: exact 171-file manifest verified; recovery archive re-read/hash-verified; removed only Real-Estate. Archive SHA-256 recorded in docs/legacy-retirement.md. Post-removal full suite 196/783 (one deliberate skip) and build passed; browser homepage/profile/private image/role switches/job history/receipt passed.
- Keyboard check: Escape closes mobile navigation and returns focus to toggle. Print control clicked, but the in-app browser exposes no native print preview; printed layout not visually certified. Reduced-motion/transparency rules inspected in source; OS emulation unavailable.
- Finishing workflow: keep the existing working directory for operator review/commit, as already required by explicit Git read-only instruction. No merge/push/branch menu or Git mutation is applicable.

- 2026-10-16: operator approved MODE=demo php artisan serve --host=127.0.0.1 --port=8092 --no-reload once; command ran successfully. No additional Artisan commands ran.
- Final read-only browser check passed: all roles, normal login/logout, hired-provider receipt; request+PNG and registration rejected; admin saves disabled. Local database and every private file remained byte-for-byte unchanged by SHA-256 comparison. Browser screenshots and readonly-browser-result.json retained.
- Task 8 complete. All nine implementation tasks are complete, with the documented Minor form-recovery issue and host/native-print verification limits. No deployment or live MySQL operation was performed. Source and Git remain unchanged by this last verification step.

- 2026-10-16 deployment request: operator authorized upload to the existing InfinityFree portal and specified /haven/ as the exact path. Updated package folder, APP_URL and SESSION_PATH. Hosted database operations still require separate approval. No files have been uploaded yet.

## 2026-10-16: hosted runtime-directory failure

Operator uploaded the 20261016-072301 package and supplied a production error: bootstrap/cache must be present and writable, followed by view-container errors. The original ZIP stores five required runtime paths only as empty directory entries. Files-only extraction reproduces their loss. The packaging script now includes non-hidden index.html markers in all six runtime paths. The archive verifier now checks standard and files-only extraction, filesystem writes, and the exact Laravel PackageManifest::build operation without booting the application or accessing a database. The original archive fails the new regression check; original plus the six-file repair passes; rebuilt package also passes. No hosted files, credentials or databases were changed by the agent. The exact hosted directory/permissions state remains uninspected. Operator must apply haven-runtime-directories-fix.zip at /htdocs and verify the result; do not reimport SQL or replace the configured .env.
