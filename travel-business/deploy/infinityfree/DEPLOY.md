# Elsewhere hosted release

Operator-only deployment to `https://demo-sites.infinityfree.me/travel-agency-demo/`.
The local workflow uploads and publishes nothing.

## Release ZIP: 2026-10-19

`deploy/builds/php-site-2026-10-19/travel-demo.zip`

| File | Bytes | Files | SHA-256 |
| --- | ---: | ---: | --- |
| `travel-demo.zip` | 2,445,409 | 94 | `b3f8bd65a8ab43095d5182f32d08d8752edf1ac15595ab31d035728b1c698c87` |

Built from `site/` with PHP 8.4:

```bash
php bin/package.php --output deploy/builds/php-site-2026-10-19
```

The command prints the path, size, file count and SHA-256. The older builds under
`deploy/builds/` (`sqlite-sandboxes-*`) are superseded (`.html` pages plus the PHP
API); do not upload them.

The output folder must be new or empty.

The ZIP contains only `travel-agency-demo/`. The pages are PHP files; visitor data
is plain SQLite in `private/sandboxes/`: `registry.sqlite` lists the sandboxes and
rate limits, and each visitor has their own `<digest>.sqlite`. The folder ships in
the ZIP with a `Require all denied` `.htaccess`; the PHP code never creates a
folder. The ZIP holds no database, log, runtime state, test, script from `bin/` or
secret.

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
Then delete the uploaded `htdocs/travel-demo.zip`.

## 3. Clean up the host

Extracting over an earlier release leaves files the new code never reads. Delete
them. Work only inside `htdocs/travel-agency-demo/`. Never touch
`htdocs/index.html` (the root hub) or `/studio/`.

- the old pages `index.html`, `destinations.html`, `journeys.html`, `about.html`,
  `journal.html`, `contact.html` and `admin.html` in `htdocs/travel-agency-demo/`
  only (nothing redirects them; left in place they stay reachable as a stale copy);
- the stale class files that no longer exist in the package: in
  `private/classes/`, anything not listed in the extracted ZIP, including
  `Registry.php`, `RateBucket.php` and `SandboxState.php`;
- `private/runtime/` (the old shared database and failed runtime attempts);
- `preflight.php` and `private/preflight-secret.php`, if they were uploaded.

Delete the old `.html` pages. The new `.htaccess` sets `DirectoryIndex index.php`,
so the folder address serves the PHP page even if an `index.html` is left behind.

## 4. Acceptance

1. Open `https://demo-sites.infinityfree.me/travel-agency-demo/`. It must show
   the home page, and all seven pages must open at their `.php` addresses.
2. In two separate browsers, submit enquiries, enter the dashboard, change a
   status and create a booking. Each browser sees only its own data.
3. Confirm `https://demo-sites.infinityfree.me/travel-agency-demo/private/`
   returns 403.
4. Check the site at phone and desktop widths.
5. Confirm the root hub (`https://demo-sites.infinityfree.me/`) and `/studio/`
   still load.
6. Confirm `https://demo-sites.infinityfree.me/travel-agency-demo/index.html`
   returns 404, and so do the other six old `.html` pages.
7. Confirm `sqlite-check.php` and `htdocs/travel-demo.zip` are gone (both
   addresses return 404).

## Failures

`private/sandboxes/php-errors.log` holds every failure the API logs, for example
when a page shows "The demo storage is unavailable." Read it in the File Manager
and delete it when convenient. Only failures are logged, so it stays small.
