# Zeta DM notes API design

Date: 2026-11-10
Status: Approved by the operator on 2026-11-10; builder review complete.

## Confirmed scope

Provide private cross-browser storage for the notes in the existing Zeta AI Tampermonkey script. The operator chose JavaScript on Cloudflare Workers with D1, on the Free plan only. The operator has deployed a Hello World Worker, connected D1 as `DB`, and added the Worker Secret `DM_API_KEY`. Its value stays with the operator.

Only notes synchronize. Injection interval, turn counter, inject-next flag, and collapsed state remain browser-local. Records are separate per room. Every successful change replaces the previous notes. A duplicated chat can explicitly copy another room's notes without linking future edits. There is no website, administration screen, public demo, delete endpoint, or application revision history.

The immediate deliverable is the API, schema SQL, and dashboard deployment instructions. Updating the userscript is a later task; its integration contract is included here so the API supports it.

## Approved design decisions

The operator approved these recommendations on 2026-11-10:

- Reject stale saves with a revision check so an older browser cannot silently overwrite newer notes. Revision numbers are concurrency metadata, not stored historical copies.
- Include a paginated room index for a future source-room picker.
- Accept up to 64 KiB of UTF-8 notes per room, including deliberately empty notes.
- Limit authenticated valid requests to 180 per UTC minute using one atomic D1 counter row. Each request therefore spends one counter write as well as its own data operation. No additional service, binding, or paid feature is required.
- Keep source and documentation under `zeta-dm-memory/`, with manual dashboard deployment.

Changes to these decisions require an updated design and operator approval.

## Platform and operator boundaries

Use plain JavaScript without a framework, runtime dependency, package installation, website assets, or build service. Deliver one dashboard-pasteable Worker module and a separate SQL schema. Exact files, method boundaries, and checks belong in the implementation plan.

The operator executes schema SQL and deploys code. Agents do not access the application database, read credentials, publish, mutate Git, or install dependencies. Database-backed tests require operator execution or exact-command approval; database-free tests may run automatically. Source changes must use visible editing tools. Unrelated workspace files are outside scope.

The operator's explicit JavaScript and Cloudflare choices supersede the workspace's PHP/Laravel and InfinityFree defaults for this project. General security, style, approval, and review requirements remain applicable.

## Authentication and privacy

Every data route requires HTTPS and `Authorization: Bearer <DM_API_KEY>`. Both the configured secret and supplied key must contain 60-254 visible ASCII characters, inclusive (U+0021 through U+007E), including punctuation. Whitespace and control characters are rejected. Do not trim, normalize, or decode key contents. This operator-approved correction on 2026-11-10 replaces the original exact-64 alphanumeric restriction. Missing or malformed server configuration fails closed. Never fall back to anonymous access.

Hash the supplied and configured tokens with SHA-256, then compare the fixed-length digests using Cloudflare's `crypto.subtle.timingSafeEqual`. Never put a key in D1, source code, URLs, logs, or Zeta page storage. The one shared private key identifies the one owner; the API accepts no client-supplied owner identity.

The future client uses Tampermonkey script storage and privileged cross-origin requests, with an explicit API-host allowlist. No cookie authentication or permissive CORS response is needed. The explicit bearer header and JSON PUT requirement provide the CSRF boundary: the browser does not attach the credential automatically.

Authenticate before D1 access. Wrong or missing keys produce a generic 401 without a database query. Malformed requests also fail before D1 access. All responses use JSON, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`. Notes are opaque text. Diagnostics may contain a request identifier and controlled error category, never notes, credentials, request bodies, or raw database exceptions.

## Identity and tables

Use the existing script's exact `window.location.pathname` as `roomId`, preserving its current `zeta_dm_mem_` plus pathname association. Do not infer Zeta's room-ID syntax, lowercase, trim, or silently normalize identifiers. Different pathnames remain different rooms. The later userscript synchronizes only after identifying an actual chat room.

A room identifier starts with `/`, contains 1-512 UTF-8 bytes of valid Unicode, and contains no whitespace, control characters, backslash, `?`, or `#`. It travels as a URL-encoded query value, decoded once through the URL API. Echo the original value in JSON.

`room_memories` has four columns: `room_id` (text primary key, binary collation), `notes` (required text), `revision` (positive integer starting at 1), and `updated_at` (API-generated UTC ISO 8601 timestamp). A separate `api_rate_limit` table has one fixed primary-key row with a minute bucket and nonnegative accepted-request count. Constraints enforce these invariants. The schema creates tables without destructive statements, credentials, or sample personal notes. D1's provider-managed backups are separate from application history.

## Routes and payloads

| Method and route | Behavior |
|---|---|
| `GET /v1/memory?roomId=<encoded pathname>` | Retrieve a single room |
| `PUT /v1/memory?roomId=<encoded pathname>` | Create or replace its notes |
| `GET /v1/memories?limit=25&after=<encoded pathname>` | List room metadata for copying |

All routes require authentication. No public diagnostic route, PATCH, or DELETE is provided. Authenticate before route disclosure. Unknown routes return 404; unsupported methods return 405 with the relevant Allow header. Reject unknown, repeated, or malformed query parameters.

A successful single-room response contains `roomId`, `notes`, `revision`, and `updatedAt`. Missing records return 404 with `memory_not_found`, distinct from a stored empty string.

PUT accepts exactly `notes` and `expectedRevision` in a JSON object. Notes must be valid Unicode text and at most 65,536 UTF-8 bytes; preserve whitespace and line breaks. The revision is a nonnegative safe integer. Require a JSON content type. Bound the streamed body to 524,288 bytes independently of Content-Length, accommodating JSON escaping while bounding work.

- Expected revision 0 creates a missing record at revision 1 and returns 201.
- An existing record requires a matching revision. Changed notes replace the value, advance the revision, update the timestamp, and return 200.
- Identical notes with a matching revision return 200 without changing the revision or timestamp.
- A stale revision or a losing concurrent create returns 409 with `revision_conflict`; existing notes remain unchanged.
- Every success returns the resulting single-room record. Acceptance must be atomic using conditional SQL and bound parameters. Never check a revision and then issue an unconditional write.
- If a response is lost, retrying may return 409. Fetch the current record; if its notes equal the intended text, the client can mark the save complete. Do not automatically force a replacement.

The index returns `items` containing only roomId, revision, and updatedAt, plus nullable `nextCursor`. Sort by room_id using binary collation. Default limit 25, maximum 50; read at most one extra row to detect a next page. The cursor is the last emitted roomId, not an offset; validate it as a room identifier. No note previews, total counts, or unbounded lists. Copying uses a source GET followed by a normal destination PUT and never changes the source.

## Rate limits and errors

After authentication and full request validation, atomically claim a slot in the single D1 UTC-minute bucket. Reject over-limit requests with 429 and Retry-After set to seconds remaining in the bucket. Conditional SQL must prevent rejected requests from incrementing the counter. A slot remains consumed if the subsequent room operation fails.

This limits authenticated loops. Unauthenticated traffic does not touch D1 but still spends Workers requests. Free-plan hard limits are the spending boundary; this design does not promise availability during quota exhaustion or a flood, and nothing upgrades a plan automatically.

Use a consistent JSON error envelope with machine code and safe message: malformed input 400, unauthorized 401, missing record/route 404, unsupported method 405, conflict 409, oversized body/notes 413, unsupported content type 415, rate limit 429, unavailable configuration/database 503, unexpected internal failure 500. Cloudflare-generated platform errors can occur outside this JSON contract. Failures never report a successful save or expose SQL, notes, or secrets.

## Later userscript contract

Save note edits locally immediately. Upload only changed notes after 500 ms without another edit. Settings changes and the existing 800 ms widget loop must not upload. Capture room identity with pending work, serialize uploads per room, and prevent old responses or navigation from targeting another room's visible notes.

Fetch on room entry and return to browser focus. Update a clean local copy and its revision; preserve dirty local notes. Never upload an empty default before the initial fetch completes, and never interpret a failed fetch as a missing room. Existing local notes may initialize a confirmed missing remote record.

Persist dirty state across reloads. Retry transient failures with bounded backoff and respect Retry-After. Stop automatic retries for authentication, validation, or revision conflicts. Conflicts preserve both versions and let the operator choose remote or local; replacing remote requires the latest revision and explicit intent. Show loading, saved, unsynced, and conflict states beside the notes.

Import copies only notes, keeps the source independent, and uses the destination's current revision. Replacing existing destination notes requires destructive confirmation. The API task does not implement these UI changes or alter the narration injector.

## Verification and handoff

An implementer writes code and then adversarial tests; a separate reviewer checks it. Verify authentication and absent configuration, routes/methods, malformed payloads and repeated parameters, exact UTF-8 limits, Unicode and whitespace, intentional empty saves, independent rooms, atomic creation/update, no-op saves, stale saves and concurrency, lost-response recovery, pagination, malformed cursors, atomic rate claims and window rollover, unavailable D1, and absence of sensitive data in logs/cache.

Database-free fakes may verify control flow but cannot prove SQL or atomicity. Disposable isolated SQLite/D1 tests are operator-run or require exact-command approval. Record which checks were actually executed. Never use the application database for automated tests.

The operator receives reviewed schema SQL and Worker code, executes the schema in D1 Console, replaces Hello World, and deploys with DB and DM_API_KEY intact. Operator-run hosted checks use fictional notes to verify unauthorized rejection, two rooms, replacement, and stale-save rejection. Visiting a protected route without an Authorization header returns 401. The real key need not be shared in chat.

## Sources and planning discretion

Primary references: [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/), [timing-safe comparison](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/#timingsafeequal), [Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/#daily-requests), and [D1 pricing and quota failures](https://developers.cloudflare.com/d1/platform/pricing/).

The implementation plan chooses precise SQL statements, JavaScript structure, error-code definitions, and a dependency-free test harness supported by the available tools. It may not change the HTTP behavior or add packages, paid services, cloud resources, or a deployment mechanism without operator approval.
