# Elsewhere isolated visitor release

Operator-only deployment to `https://demo-sites.infinityfree.me/travel-agency-demo/`.
No upload or publication is performed by the local verification workflow.

## Prepare and preserve

Require PHP 8.4, PDO SQLite, private writable storage, same-directory atomic
replacement and advisory locks shared across concurrent PHP requests. The local
Apache result does not prove InfinityFree supplies these capabilities.

Back up the existing Elsewhere files privately. Preserve all legacy databases,
sessions, `private/runtime/`, and the private directory's Apache denial. The new
runtime is `private/runtime/sandbox-runtime/`; it never reads or reseeds a legacy
shared database. Do not change the root hub, root `.htaccess`, `/studio/` or any
other demo. The package includes only `travel-agency-demo/`.

Build from the reviewed source with Node 24 and Python 3:

```bash
node --disable-warning=ExperimentalWarning bin/package-infinityfree.mjs --output deploy/builds/visitor-sandboxes-release
```

Use a new or empty output; do not remove an existing build to reuse that path.
For another hostname add `--origin https://your-demo-domain.example` without a
trailing slash. Record the ZIP SHA-256 and inspect every member before upload.
No `.sqlite`, journal, registry, runtime, tests, preflight or secret belongs in it.
Canonical schema, seed, budget and sandbox JSON files are included privately;
packaging opens no database. Static assets and every PHP helper form one release.

## Protected capability preflight

The diagnostic is deliberately excluded from the ZIP. The operator separately
uploads `deploy/infinityfree/preflight.php` as
`travel-agency-demo/preflight.php`. Copy `preflight-secret.example.php` to the
protected `travel-agency-demo/private/preflight-secret.php` and replace its
placeholder with the SHA-256 digest of a fresh cryptographically random 32-byte
token, encoded as 64 lowercase hex characters. Generate/store the token in a
private local tool. Publish only its digest in the protected PHP return value.
Never put the token in source control, URLs, command histories, screenshots,
request logs or this verification record. Use a private HTTP client with header
`X-Elsewhere-Preflight: <private token>` and `Content-Type: application/json`.
The token check precedes fixture work and fails closed on missing configuration.

Every request is POST to `/travel-agency-demo/preflight.php`; send exactly one
JSON field, for example `{"action":"check"}`. There are four actions:

| Action | Required result |
| --- | --- |
| `check` | HTTP 200; `acquired`, `pdoSqlite`, `privateWritable`, `atomicReplace` all true. Run twice to check replacement of an existing marker. |
| `hold` | Holds only the diagnostic fixture lock for three seconds, then HTTP 200 with `heldMilliseconds: 3000`. |
| `probe` | While another request holds the lock, HTTP 200 with `acquired: false`; after release, `acquired: true`. Use separate concurrent HTTP requests. |
| `finish` | When idle, HTTP 200 with `finished: true`; while held, HTTP 409 with `acquired: false`. |

Missing/wrong tokens return 403, unsupported methods 405, malformed actions 400,
oversized requests 413, wrong content types 415 and fixture failures 503. Output
contains capability booleans only, without filesystem paths or record data.
The diagnostic never loads the application or opens any SQLite database. It
writes bounded known marker files only in `private/runtime/preflight-v1/`.
`finish` removes `marker.tmp` and `marker.json`; it retains the empty persistent
`fixture.lock` inode to prevent lock replacement races. It never deletes unknown
files or touches `sandbox-runtime/`. After concurrent checks finish, the operator
removes the diagnostic, secret, and its known diagnostic fixture/lock directory.
Confirm public diagnostic access is gone. Removal remains an operator action.

If any capability or private-file denial fails, keep public mutations disabled
and do not publish the listing.

## Replace the release

Temporarily disable public enquiry and dashboard mutations during replacement.
Upload/extract the complete reviewed API, helpers, canonical inputs, HTML and
versioned assets together. Preserve private runtime/legacy files while replacing
release files. `private/config.php` pins the exact external origin and subsite
cookie path; do not infer HTTPS or identity from forwarded client headers.
Keep the private `.htaccess` active throughout. No SSH, Artisan, worker, migration
or application database access is needed.

Protocol 1 uses new `elsewhere_sandbox_v1` and `elsewhere_dashboard_v1` HttpOnly,
SameSite=Strict cookies scoped to `/travel-agency-demo/`, Secure on configured
HTTPS. Legacy cookie names authorize nothing. The context header binds each
request to its sandbox generation. After a transition, visitors may need the
explicit fresh-demo action; no failed write is replayed.

If release acceptance fails, disable public mutations or restore a previously
isolated release. Never restore the shared writable API on a public demo.

## Hosted acceptance and listing gate

Keep the listing blocked until the operator records date, hostname, release
checksum, capability results and actual browser observations in
`docs/verification/2026-10-18-visitor-sandboxes.md`.

1. Verify `private/`, config, classes, schema, seed, live registry/database/journal
   files and diagnostic secret return 403. Check root hub and other demos remain intact.
2. In two independent cookie contexts, submit distinct fictional `.example`
   enquiries before login. Enter dashboards, change status and create bookings.
   Each context must see only its own edits, even when local record IDs overlap.
3. In another tab of the same context, confirm edits persist. Leave the dashboard,
   confirm access ends, re-enter and confirm retained edits. Check phone 390x844
   and desktop 1440x900, keyboard focus, loading feedback and list pagination/search.
4. Confirm accepted activity slides the four-hour deadline. After four actual
   idle hours, a stale explicit write must fail with recovery; unsent values stay
   present. Explicit restart must not replay a write. Submit again only deliberately.
   No shipped clock override exists; local harness time control is not hosted evidence.
5. Check error/retry behavior and normal capacity without deliberately exhausting
   the public shared account. Default caps are 100 slots, 100 enquiries per slot,
   1 MiB per database and 128 MiB managed storage; physical cleanup is opportunistic.
6. Run `finish`, remove diagnostic/secret fixtures, then repeat public-file denial.

This host has no workers; cleanup occurs on later API requests that reach the
serialized runtime, including requests subsequently rejected. Only admitted
activity renews the lease. Node's
process-local queue supports one process per root; PHP uses cross-request flock.
Cookies identify a browser context, not a person; there is no cross-device
recovery, real booking, email, payment or production staff authentication.
