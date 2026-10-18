# Elsewhere visitor sandboxes

Date: 2026-10-18

Status: Approved by the operator on 2026-10-18, including the proposed defaults
below. A fresh builder review and scoped re-review found no remaining
consequential planning questions. Implementation awaits separate plan approval
and execution authorization.

## Purpose

Visitors must be able to submit fictional travel enquiries, edit their statuses
and create demo bookings without seeing or changing another visitor's work.
Elsewhere's listing remains blocked until isolation has been verified on the
operator-uploaded hosted release.

The current hosted adapter opens `private/runtime/demo.sqlite` for every request.
The local Node server opens one application-wide store. Dashboard login gates
access but does not select a visitor's data. Both implementations must change.
This diagnosis comes from source inspection, not access to a running database.

## Decisions made by the operator

- One SQLite database per visitor, in both hosted PHP and local Node.
- A sandbox expires after four hours of inactivity.
- Expired sandboxes are cleaned up and managed storage has a cap.
- Logout ends dashboard access only. Edits remain available in that browser
  until the sandbox expires.
- Keep the existing editable enquiry-to-booking walkthrough.

## Approved design defaults

The operator approved these recommendations with the complete design.

| Detail | Proposed behavior |
| --- | --- |
| Visitor identity | One browser cookie context; tabs share a sandbox. Separate browser profiles or private contexts receive different sandboxes. |
| Activity | Accepted sandbox API requests renew the idle deadline; static page/assets delivery and an idle open tab do not. |
| Allocation | Contact and dashboard pages initialize or resume a sandbox before enabling their server actions. Other public pages allocate nothing. |
| Expiry recovery | A fresh page load may initialize new samples and explains that they are fresh. Expiry during an already-open workflow requires an explicit fresh start; no pending submission or edit is replayed. |
| Capacity | At most 100 allocated sandbox slots, 1 MiB per SQLite database and 128 MiB total managed runtime storage. |
| Record bounds | At most 100 enquiries, including the four seed enquiries. Bookings are bounded by those enquiries plus the three independent seed bookings. |
| Capacity policy | Clean expired sandboxes first, then reject allocation if still full. Never evict an unexpired sandbox to admit someone else. |
| Cleanup schedule | Enforce expiry on access immediately; reclaim files during subsequent API traffic. No background service or scheduled ping is required. |
| Restart | Persist sandbox identity, idle deadline and dashboard authorization on disk; a normal server restart preserves unexpired work. |
| Existing shared data | Leave the old shared database untouched and unreachable from new requests. New sandboxes use canonical fictional seeds, never a copy of old submissions. |

The limits are conservative demo defaults, not measurements of the host's
remaining capacity. They are configurable per deployment, with invalid or
inconsistent configurations rejected. No storage usage was queried for this
design. Changes to these approved defaults require an operator decision.

## Scope and constraints

Keep Node 24's bundled SQLite, PHP/PDO SQLite, static templates and browser
JavaScript. No packages, paid services, external APIs, database server, workers,
Redis, real customer accounts or cross-device recovery are introduced.

This retains existing enquiry status editing and one-time booking conversion;
it does not add contact-detail editing, real booking operations or a manual
reset feature. The six public pages and existing visual design remain.

The hosted target remains PHP 8.4 on InfinityFree, with no shell or Artisan.
The workspace's 30,000-file and 50,000-daily-hit hosting constraints apply.
Private state stays below the existing protected private directory. The local
server serves only `public/`.

Design approval does not authorize database access, deletion of existing data,
dependency changes, Git mutations, upload or publication. The implementation
plan must respect the workspace's generator, code, screen and review rules.

## Identity and dashboard authorization

Use a new cryptographically random 256-bit sandbox cookie. A visitor-supplied
query parameter, request body field, record ID or IP address must never select
a sandbox. Validate the cookie's fixed encoding before doing filesystem work;
derive the private directory name from its SHA-256 digest. Accept an existing
identity only when its server-owned registry entry exists and is unexpired.
Never create a directory for an arbitrary submitted token.

Use a separate random dashboard authorization cookie, with its digest bound
to exactly one sandbox in the registry. Login rotates that authorization;
logout invalidates it server-side and clears only the dashboard cookie.
Re-entering the dashboard reuses the unexpired sandbox and its edits. Sandbox
expiry invalidates its dashboard authorization as well.

Cookies are HttpOnly, SameSite=Strict, host-only and Secure on HTTPS. Hosted
cookie paths are `/travel-agency-demo/`; local paths are `/`. Use names unique
to Elsewhere and different from the old login cookies. Renew the sandbox
cookie's four-hour lifetime on accepted activity. When dashboard authorization
is still valid, renew its cookie as well, including activity on the contact
page. Returning within the deadline therefore works after closing the browser.

The registry stores only operational metadata: token digests, anti-CSRF state,
timestamps, capacity reservations and bounded rate-limit buckets. Enquiries,
traveller details and bookings exist only in each visitor's SQLite file.
One dashboard authorization slot per sandbox is sufficient; tabs share cookies.
Retire the old Node session map and PHP native session-file mechanism from new
requests rather than leaving an unbounded second session store.

An opaque anti-CSRF token returned to the page is bound to the current sandbox
generation. Require it on enquiry creation, login, logout, status updates and
booking conversion. Require an exact configured same-origin `Origin` on all
mutations, including initialization, and keep JSON/body-size validation.
Initialization is the only mutation that may run before an anti-CSRF token
exists; it contains no record edit or dashboard authorization operation.

Do not expose bearer cookies in HTML, JSON, logs or local storage. Tokens are
capabilities for a fictional demo, not a substitute for production accounts.

## Request lifecycle

Add one sandbox initialization operation, exposed consistently by the Node
routes and PHP route adapter. It creates a fresh seed database when no valid
sandbox is present or resumes the matching unexpired one. It returns the
anti-CSRF context, idle deadline and whether a fresh sandbox was created.
It does not log the visitor into the dashboard.

On an initial page load, a missing, invalid or expired cookie therefore creates
a fresh sandbox automatically if capacity allows. The page visibly says that
it is a fresh demo with sample data; cookie absence cannot reliably distinguish
a first visitor from an expired browser cookie. This is a page-entry behavior,
not permission to recover or replay an action already in progress.

The contact page initializes before enabling submission. The dashboard
initializes, then tries its authorized overview; an unauthorized response
shows the existing entry button. Server actions show an immediate loading
state and a useful retry state if initialization fails. Merely browsing
destinations, journeys or journal pages does not allocate a database.

For every subsequent API action:

1. Check route, origin, method and bounded input before opening a visitor database.
2. Enter the runtime's exclusive storage critical section.
3. Resolve the sandbox cookie and check expiry and the page's generation token,
   including on dashboard reads. Initialization is the exception that supplies
   a context before those checks can be made.
4. Check dashboard authorization for every dashboard data operation.
5. Apply admission limits and persist the activity lease before touching records.
6. Open only that sandbox's store, perform the scoped read or transaction and
   close it before releasing the critical section.

An admitted, correctly authorized request counts as activity even when a
business limit prevents it, such as duplicate conversion or a full sandbox.
Malformed, cross-origin, unauthorized, rate-limited and stale-generation
requests do not renew the lease. Logout is activity and leaves four idle hours
to return. Ordinary initialization/resumption also counts as activity.

Record IDs may overlap between databases. A request from A containing an ID
used by B can operate only on A's database; it must never open B's. Existing
one-booking-per-enquiry constraints and atomic conversion are retained.

## Expiry and stale pages

The server clock is authoritative. A sandbox is expired when
`now >= lastActivity + 14,400 seconds`, even if its files have not been removed.
No background browser heartbeat keeps an unattended page alive.

An expired, missing or replaced sandbox on a data action returns a stable
machine-readable context error, with HTTP 409, before opening or seeding a
store. Missing dashboard authorization in an otherwise valid sandbox is HTTP
401. Initialization is the explicit path to obtain a valid context again.

On an expiry error, close any record dialog, clear cached dashboard records and
show the explanation beside the entry controls. Preserve unsent contact form
values, but make the visitor start a fresh demo and submit again. Never carry
a pending record ID or automatically replay a mutation into a new database.

A page keeps the anti-CSRF context used to load its records. It must not silently
fetch a new token before sending an old record action. This protects against
another tab replacing cookies after expiry and against reused seed IDs. After
logout in another tab, a stale dashboard action fails authorization and clears
that tab's record view when the response arrives.

Simultaneous first visits before a cookie exists may allocate two sandboxes.
The page whose context no longer matches the browser cookie must reconnect
explicitly before writing; the unused allocation expires normally. Neither
request may write through a mismatched generation. No browser fingerprinting
or IP-based merging is introduced.

## Storage, concurrency and cleanup

Use a new managed runtime subtree: locally under `storage/sandbox-runtime/`,
and hosted under `private/runtime/sandbox-runtime/`. Keep its registry, lock
and visitor directories together. The server runtime no longer uses `DB_PATH`
as a shared record database; document a dedicated sandbox-root setting for
local tests and development. The store's explicit single-file API may remain
for isolated tests and build-time canonical seed generation.

Serialize registry changes, allocations, database work and cleanup per runtime.
PHP uses an OS-released advisory file lock across requests/processes. Node
uses a process-wide queue and supports one server process per runtime root.
The two runtimes do not share a runtime directory. Read request bodies before
acquiring the lock; never wait for network input while holding it. Bound lock
waiting and return a retryable busy error instead of waiting indefinitely.

Use SQLite DELETE journaling for these short-lived stores. Do not retain the
Node store's existing WAL mode for visitor databases. Open a store only while
holding the runtime lock and close it before cleanup can remove it. This also
prevents multiple concurrent journal files from undermining the aggregate cap.

The byte budget includes databases, journals, metadata, partial allocations
and atomic-replacement temporary files. A main-file size check alone is not a
quota. Configure and verify SQLite's maximum page count on every connection to
enforce the 1 MiB database limit and reserve worst-case transaction/metadata
overhead before writes.
Budget conservative space for the journal, one staged database and atomic
registry replacements. Configuration validation must reject any combination
whose maximum reserved footprint can exceed the 128 MiB ceiling.

SQLite's [page-count limit](https://www.sqlite.org/pragma.html#pragma_max_page_count)
bounds the database file; its
[journal-size setting](https://www.sqlite.org/pragma.html#pragma_journal_size_limit)
limits leftover journals after a transaction, not peak transaction space.
Budget live journals separately using SQLite's
[rollback-journal behavior](https://www.sqlite.org/atomiccommit.html#_creating_a_rollback_journal_file).

Bound registry and rate-limit state as well: at most 100 sandbox slots, including
pending/failed allocations awaiting cleanup, and 1,000 live IP/action buckets.
Reserve 2 MiB for registry state including its replacement copy, 2 MiB for a
transaction journal and 2 MiB for staging. With 100 databases of at most 1 MiB,
the default reserved envelope stays below 128 MiB. The plan must confirm these
bounds against the selected serialization and SQLite page/journal settings;
filesystem errors still fail closed with clear logs.

Retain the existing 50-per-hour IP/action limits for enquiry creation and
dashboard login. Add at most 10 new sandbox allocations per IP per hour.
Use the actual connection address, never an untrusted forwarding header.
The allocation limiter runs before creating files and survives cookie resets
and process restarts. Prune expired limiter buckets; if its bounded registry
is full, reject new buckets rather than forgetting live limits. Keep rate-limit
responses distinct from storage-capacity errors. Normal resumption does not
consume a new-allocation allowance.

On API traffic, inspect the bounded registry and reclaim up to ten expired or
failed sandbox allocations per pass. Always enforce the target sandbox's
expiry independently of the cleanup batch. At capacity, attempt cleanup first;
if space remains unavailable, return HTTP 503 with a retry indication. Existing
visitors retain their data and may continue operations that fit their quota.
An individual database/record limit must produce a clear sandbox-full response,
roll back its failed mutation and preserve all previous work.

Publish new registry contents atomically. Reserve a slot before building a
seeded database and make it usable only when initialization succeeds. On crash
recovery, account for partial files and reconcile them under the same lock.
Missing or corrupt metadata must never cause an existing database to be opened
for an unknown visitor, nor an active directory to be silently reseeded.

Cleanup is confined to server-owned entries inside this new subtree, without
following symlinks. It removes an expired sandbox's database and associated
files only while no request can use them. Failed deletions remain accounted
for and are logged; never claim recovered space prematurely. Never sweep the
old shared database, old PHP sessions, source directories or another demo.

Expiry is immediate access revocation. Physical deletion is opportunistic:
with no later API traffic, expired files remain private until a subsequent
request performs cleanup. The UI and README must not promise deletion at the
exact four-hour boundary.

## Browser behavior and copy

Replace references to a shared or public dashboard with a private demo workspace
for this browser. Explain four idle hours, logout retention, fictional data and
the lack of real reservations, payments and messages. Update the contact form,
dashboard, privacy information and README consistently.

Show initialization, login, logout, save and conversion progress where the user
acted. Expiry and capacity errors keep keyboard focus and their recovery action
near that control. Save remains the rightmost action. No confirmation dialog
is added for login or expiry recovery; the old sandbox is already expired.

Keep the current bounded overview payload, capped by the record limits, and
display its filtered enquiry/booking lists in pages of 20. Search continues to
cover the visitor's entire bounded dataset. Page counts, filtered counts and
dashboard totals must describe their respective datasets correctly. This
avoids extending the current unpaginated table into a growing private store.

## Deployment transition

The package contains source, built assets, configuration and canonical fictional
seed material only. It contains no live sandbox, registry, cookie or old shared
record database. Each allocation gets four sample enquiries and three sample
bookings, with future sample dates based on allocation time and reserved
`.example` email domains. Source seed generation and hosted allocation must
agree; an old package's fixed dates must not create already-expired examples.

The release uses new cookie names and the new runtime subtree. Old cookies do
not authorize new routes. Old APIs must not fall back to the legacy database.
Versioned browser assets and generation checks prevent an old open page from
modifying new data; the deployment guide must require replacing the complete
release, not mixing old/new API and frontend versions.

Keep the protected directory rules, and test direct access to new nested files
and journals. Document required write permissions and PDO SQLite verification.
Hosted preflight must also verify advisory locking across concurrent PHP
requests and atomic registry replacement on the actual hosting filesystem;
local Apache tests alone do not establish those capabilities.
The operator uploads the package and performs hosted acceptance checks. The
old database stays private and untouched pending a separate operator decision.
No automatic migration, deletion or publication is part of this design.

## Acceptance evidence

Implementation is followed by adversarial tests using only approved isolated
temporary databases. Existing tests that assume a shared global store must be
updated. Verify both Node and the packaged PHP adapter, including:

- A and B use separate cookie jars, receive independent seeds and cannot see
  each other's submissions, status edits or conversions.
- A's public enquiry appears in A's dashboard after login. B's guesses at A's
  IDs cannot alter A; overlapping local IDs still operate only within B.
- Repeated login, logout and return preserve edits; the invalidated dashboard
  token fails. Same-browser tabs share valid data and handle stale context.
- Exact expiry boundary, sliding activity, activity while logged out, idle pages
  and restart persistence agree between runtimes without waiting four hours.
- A stale page cannot replay a status edit or booking conversion against a fresh
  sandbox with reused IDs. Invalid cookies, missing tokens, path traversal,
  cross-origin mutations and mixed sandbox/dashboard cookies fail safely.
- Concurrent allocations cannot exceed slots or reservations; parallel writes,
  duplicate conversion and cleanup cannot corrupt or delete active work.
- Exercise record, database, aggregate storage and rate-limit bounds with small
  test settings. Include large valid multibyte inputs, transaction rollback,
  partial initialization, restart recovery and failed deletion/accounting.
- Capacity exhaustion preserves existing visitor data and never evicts active
  visitors. Expired files, metadata and temporary artifacts stay accounted for.
- Package content excludes runtime files; private files cannot be downloaded;
  no request reads or writes the legacy shared database.
- Phone and desktop walkthroughs cover loading, expiry, capacity errors,
  pagination, logout/return, keyboard focus and retained unsent form values.

Record test results and browser screenshots under `docs/verification/` during
implementation. Hosted acceptance uses two independent browser contexts with
fictional data after operator deployment. Passing local tests alone does not
release the listing.

## Builder discretion and next gate

The implementation plan chooses exact module/class names, route signatures,
configuration keys, metadata encoding, error enums, locking timeout and test
clock injection. Those choices must preserve the approved behavior and the
hard accounting/isolation invariants above, without new dependencies.

The plan must name exact files and task boundaries, apply workspace coding
conventions to new code, and include failure-focused tests after code. Potential
change surfaces are `server.mjs`, `src/store.mjs`, new runtime-management modules,
`deploy/infinityfree/api.php` and helper files, the packager, browser scripts,
templates, styles, README and both test suites. No implementation is dispatched
before the operator approves the design and then the task plan.
