# Elsewhere hosted release

Operator-only deployment to `https://demo-sites.infinityfree.me/travel-agency-demo/`.
The local workflow uploads and publishes nothing.

## Release ZIP: 2026-10-19

`deploy/builds/sqlite-sandboxes-2026-10-19-fix1/travel-demo.zip`

| File | Bytes | Files | SHA-256 |
| --- | ---: | ---: | --- |
| `travel-demo.zip` | 2,467,588 | 68 | `34b198dc9615fd6fd04b73ed31369604efc3a38d4fb47861452cf8b9bb6ec721` |

Built from source with Node 24 and Python 3:

```bash
node --disable-warning=ExperimentalWarning bin/package-infinityfree.mjs --output deploy/builds/sqlite-sandboxes-2026-10-19-fix1
```

The older `deploy/builds/sqlite-sandboxes-2026-10-19/` build is superseded; do not
upload it.

The output folder must be new or empty. For another hostname add
`--origin https://your-demo-domain.example` (no trailing slash) and record the new
ZIP's size and SHA-256 here.

The ZIP contains only `travel-agency-demo/`. Visitor data is plain SQLite in
`private/sandboxes/`: `registry.sqlite` lists the sandboxes and rate limits, and
each visitor has their own `<digest>.sqlite`. The folder ships in the ZIP with a
`Require all denied` `.htaccess`; the PHP code never creates a folder. The ZIP
holds no database, runtime state, test or secret.

No upload or hosted acceptance is claimed. Keep the listing blocked until the
steps below pass on the host.

## 1. Check SQLite on the host

Upload `deploy/infinityfree/sqlite-check.php` into `htdocs/travel-agency-demo/`
and open `https://demo-sites.infinityfree.me/travel-agency-demo/sqlite-check.php`.
It prints two lines:

```text
PHP <version>
pdo_sqlite: yes
```

Record the result, then delete `sqlite-check.php` from the host. Continue only if
the version is 8.4 or newer and the second line reads `pdo_sqlite: yes`.

## 2. Upload and extract

Upload `travel-demo.zip` into the domain's `htdocs` and extract it there with
overwrite enabled. The inner `travel-agency-demo/` must land at
`htdocs/travel-agency-demo/`, not in a second nested folder. Then confirm that
`htdocs/travel-agency-demo/private/sandboxes/` exists and contains `.htaccess`.

## 3. Optional cleanup on the host

Earlier releases left files the new code never reads. Delete them when convenient:

- `private/runtime/` (the old shared database and failed runtime attempts);
- `preflight.php` and `private/preflight-secret.php`, if they were uploaded;
- `private/classes/Registry.php`, `private/classes/RateBucket.php` and
  `private/classes/SandboxState.php`.

## 4. Acceptance

1. In two separate browsers, submit enquiries, enter the dashboard, change a
   status and create a booking. Each browser sees only its own data.
2. Confirm `https://demo-sites.infinityfree.me/travel-agency-demo/private/`
   returns 403.
3. Check the site at phone and desktop widths.

## Failures

`private/sandboxes/php-errors.log` holds every failure the API logs, for example
when a page shows "The demo storage is unavailable." Read it in the File Manager
and delete it when convenient. Only failures are logged, so it stays small.
