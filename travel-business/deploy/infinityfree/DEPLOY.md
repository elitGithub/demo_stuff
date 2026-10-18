# Elsewhere isolated visitor release

Operator-only deployment to `https://demo-sites.infinityfree.me/travel-agency-demo/`.
No upload or publication is performed by the local verification workflow.

## Current upgrade ZIP — 2026-10-18

Use `storage/infinityfree/releases/2026-10-18-fixes/elsewhere-upload.zip`.
The dedicated release folder contains only this ZIP.

| File | Bytes | Files | SHA-256 |
| --- | ---: | ---: | --- |
| `elsewhere-upload.zip` | 2,470,258 | 69 | `7cfe4b03241950d08471131b482358503199e068f13a35c40f8507250a4a4121` |

This is an unchanged copy of the reviewed
`deploy/builds/visitor-sandboxes-release/travel-demo.zip`, including the isolated
visitor fixes. Static checks confirm archive CRC, safe paths, matching current
release inputs and exclusion of runtime, databases, tests, diagnostics and secrets.
It contains only the inner `travel-agency-demo/` directory. No upload or hosted
acceptance is claimed; the listing remains blocked until the checks below pass.

## Prepare and preserve

Require PHP 8.4, PDO SQLite, private writable storage, same-directory atomic
replacement and advisory locks shared across concurrent PHP requests. The local
Apache result does not prove InfinityFree supplies these capabilities.

Keep a private backup of the existing installation before the upgrade. If a
consistent point-in-time runtime backup is required, quiesce requests and wait
for admitted work to finish before taking it.
Preserve all legacy databases, sessions, `private/runtime/`, and the private
directory's Apache denial. The new
runtime is `private/runtime/sandbox-runtime/`; it never reads or reseeds a legacy
shared database. Do not change the root hub, root `.htaccess`, `/studio/` or any
other demo. The package includes only `travel-agency-demo/`.

For this upgrade use the ZIP above; no local rebuild is needed. A future,
separately reviewed release can be built from source with Node 24 and Python 3:

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
completes the idle `finish` action, requiring HTTP 200 with `finished: true`,
then removes the diagnostic, secret, and its known diagnostic fixture/lock
directory. Confirm public diagnostic access is gone before maintenance and
replacement. This is the single cleanup point; do not call the removed endpoint
during final acceptance. Removal remains an operator action.

If any capability or private-file denial fails, keep public mutations disabled
and do not publish the listing.

## Replace the release

This procedure upgrades the existing hosted subsite using InfinityFree File
Manager's archive extraction. Select the target domain's actual `htdocs`; an
account with multiple domains can have more than one.

1. Confirm the ZIP filename, byte size and SHA-256 above. Keep the private backup
   described above. Complete outstanding protected capability checks and their
   diagnostic removal separately before using the release.
2. Upload `elsewhere-upload.zip` into that `htdocs` and extract it there,
   enabling overwrite of matching files and merging existing directories. Its
   inner `travel-agency-demo/` must map to `htdocs/travel-agency-demo/` without a
   second nested directory. Dotfiles, including both guards, are in the ZIP.
3. Keep all existing folders and remote-only files. The archive contains no
   runtime tree, live database, session or credential files, so no skip list,
   folder deletion or cache clearing is needed. Wait for successful extraction,
   then complete the hosted acceptance sequence below.

Extraction updates multiple files and is not atomic; use a quiet maintenance
window and avoid submitting changes while it runs. Normal merging extraction
preserves existing runtime and legacy state in the local overlay test. Actual
hosted extraction and acceptance remain operator checks; keep the listing
blocked if they fail.

`private/config.php` pins the exact external origin and subsite cookie path; do
not infer HTTPS or identity from forwarded client headers. No SSH, Artisan,
worker, migration or application database access is needed for transfer.

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
6. Confirm the earlier diagnostic/secret/fixture cleanup remains complete and
   public diagnostic access is absent or denied (403/404). Repeat private-file
   denial checks; do not call the removed `finish` endpoint again.

This host has no workers; cleanup occurs on later API requests that reach the
serialized runtime, including requests subsequently rejected. Only admitted
activity renews the lease. Node's
process-local queue supports one process per root; PHP uses cross-request flock.
Cookies identify a browser context, not a person; there is no cross-device
recovery, real booking, email, payment or production staff authentication.
