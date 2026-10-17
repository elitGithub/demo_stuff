# InfinityFree deployment

## 1. Confirm the host with the check file

The operator first uploads only `deploy/casefile-check.php` to a temporary location under the intended account and visits it over HTTPS. It prints PHP version, `pdo_sqlite`, `sqlite3`, SQLite library version and `disable_functions`; it does not open a database or bootstrap Laravel. Require PHP 8.4+ and `pdo_sqlite`. `sqlite3` supplies the library-version diagnostic; Laravel uses PDO. Remove the diagnostic after recording the result. Never leave `phpinfo`, setup scripts or database importers online.

Target: `https://demo-sites.infinityfree.me/casefile/`, beside the other demos. Nothing in this delivery uploads or publishes it. Remote PHP extensions, Apache behavior and account limits have not been verified. [InfinityFree advertises PHP 8.4](https://www.infinityfree.com/); the actual account check decides whether this package is viable.

Historical dark-mode release: `storage/infinityfree/dark-mode-20261017/casefile-upload.zip` and its [dark-mode verification record](verification/2026-10-17-casefile-dark-mode-verification.md) describe the earlier Theme-segments interface. That build produced `app-DGK12e4o.css` (52.79 kB) and `app-BXtwaOZi.js`; the Theme script was inline in the shared document head. Its isolated browser preview used an existing development hot file and served source CSS from `127.0.0.1:5173/resources/css/app.css`, so those visual checks did not prove that the production bundle was served. Preserve this archive and the earlier `task16-20261017` package as historical releases. Use the Header correction delivery section below for the current controls, assets and verification status.

## 2. Check the file budget

The local verifier prints `Files: N` and rejects 12,000 or more files. Account limits are shared by all demos: the planned budget is approximately 30,000 files/directories and 50,000 daily hits for the whole account. Check the actual control panel's usage and remaining allowance before packaging/upload, allowing for directories, new visitor databases, sessions, cache and logs. The 12,000-file package limit is a conservative project ceiling, not a promise that the account has room. [Account-limit reference](https://forum.infinityfree.com/t/all-of-the-limits-on-infinityfree-and-what-they-mean/43467).

## 3. Prepare locally

Use the source lockfiles, the built `public/build` directory and the four generated fixture attachments. Prerequisites are Composer, PHP 8.4+, Python 3.10+, and existing frontend build dependencies. The packager never invokes Artisan, a build command or a migration. Any missing template must be built separately with exact operator approval. Never substitute an application database or a visitor sandbox for the immutable seed template.

For a fresh installation only, these operator-run commands create the inputs:

```sh
php artisan casefile:build-fixtures
php artisan casefile:build-template --path=/var/www/demo_stuff/case-management-system/storage/app/template/casefile-template.sqlite
npm run build
PYTHONDONTWRITEBYTECODE=1 python3 deploy/package.py
```

The fixtures command overwrites its four fixture files; the template command refuses an existing destination. Do not run them again when approved generated inputs already exist. The default package output is `storage/infinityfree/<UTC timestamp>/casefile-upload.zip`. A missing default template fails clearly instead of silently creating or connecting to a database.

Historical commands used for this delivery (2026-10-17): the unchanged isolated browser-preview template was reused. After verification and review, the disposable `storage/framework/testing/browser-preview-20261017-01` directory was removed with operator approval. That preview input path no longer exists; do not rerun the package command below as written. Future builds must separately prepare a fresh template using the approved `casefile:build-template` command above, then use the default package workflow or explicitly approve its new input/output paths. The retained ZIP can still be verified with the second command.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 deploy/package.py --template /var/www/demo_stuff/case-management-system/storage/framework/testing/browser-preview-20261017-01/app/template/casefile-template.sqlite --output-root /var/www/demo_stuff/case-management-system/storage/infinityfree/task16-20261017
PYTHONDONTWRITEBYTECODE=1 python3 deploy/verify-package.py /var/www/demo_stuff/case-management-system/storage/infinityfree/task16-20261017/casefile-upload.zip
```

The output root must be new and below this project's `storage`; source symlinks are rejected. Expected template SHA-256: `1a28150d776cf08f5beee0e64539cc4b92a0698575b6d2929a8c66bfeddb2f43`. Packaging checks its SQLite integrity, 16 cases, 43 mailbox messages, 20 script entries and the current migration version using an immutable read-only connection. It verifies the source hash afterward. These reads still require operator approval.

The script creates a separate workspace, copies the lockfiles there, and runs exactly:

```sh
composer install --no-dev --no-scripts --no-plugins --no-interaction --prefer-dist --no-progress
```

Composer home/cache remain inside that generated workspace. No source dependency changes or global cache/config writes are intended. The copy installs only locked production dependencies, then packages production vendor, application/config/routes, Blade views, migrations for reference, private fixture attachments and the template. It does not copy source `.env`, tests, node_modules, existing databases, sandboxes, session/cache data or logs. No development bootstrap cache is copied. Laravel can create its package-discovery cache in the writable private `bootstrap/cache` at runtime.

The output contains `casefile-upload.zip`, unpacked `casefile/`, a sibling `manifest.json` with byte lengths/SHA-256 values, `INSTRUCTIONS.txt`, this guide and the private generated build workspace. Keep the ZIP and manifest together for repeat verification. The manifest detects corruption; it is not a digital signature against an attacker replacing both files.

Both normal extraction and extraction ignoring directory entries are audited. Real `index.html` marker files preserve writable runtime paths. Verification rejects unsafe paths, symlinks, duplicate ZIP entries, secrets/development files, missing protections, mismatched manifest, missing assets/fonts/license, changed fixtures, wrong production dependencies and invalid template. It checks writable extraction directories without starting the application; this does not prove remote permissions or HTTP access control.

## 4. Upload and configure

Upload only the ZIP's `casefile/` directory into `htdocs`, preserving dotfiles. Do not upload the outer output folder, ZIP, manifest, Composer workspace, tests or diagnostics. No SSH, host Artisan, workers or migrations are used. The package is fixed to `/casefile`; its generated font CSS/manifest URLs use `/casefile/build/`. Renaming the directory requires a reviewed package URL adjustment as well as environment/cookie changes.

```text
htdocs/casefile/
  index.php
  .htaccess
  build/
  _app/
    .htaccess
    .env.example
    app/ bootstrap/ config/ routes/ resources/ database/ vendor/
    storage/app/template/casefile-template.sqlite
    storage/app/sandboxes/index.html
    storage/framework/cache/data/index.html
    storage/framework/sessions/index.html
    storage/framework/views/index.html
    storage/logs/index.html
```

The root rewrite rule denies `_app` access; `_app/.htaccess` separately denies all access. Both must survive upload. Private attachments remain at `_app/database/fixtures/attachments`, matching `config/casefile.php`; serve them only through authorized attachment routes. There is no public storage symlink.

Create `_app/.env` privately from the shipped `.env.example`. It is deliberately absent from the ZIP. Set a new secret APP_KEY generated locally, not an example key. One non-Artisan key-generation command for the operator is:

```sh
php -r 'echo "base64:".base64_encode(random_bytes(32)).PHP_EOL;'
```

Keep `APP_ENV=production`, `APP_DEBUG=false`, `CASEFILE_MODE=demo`, `DB_CONNECTION=sqlite`, `SESSION_DRIVER=file`, `CACHE_STORE=file` and `QUEUE_CONNECTION=sync`. Set both `APP_URL` and `ASSET_URL` to `https://demo-sites.infinityfree.me/casefile`, with `SESSION_PATH=/casefile`, `SESSION_COOKIE=casefile_session` and secure HTTP-only SameSite=Lax cookies.

`DB_DATABASE` is intentionally blank in the example: demo middleware selects the private per-visitor database before authenticated queries. If specifying a fallback path, it must be a host filesystem absolute path, never a URL or a developer machine path; do not point a fallback at the immutable template. Changing to local mode would require its own writable database and is not the public hosting configuration.

Keep the template readable but not writable by normal application code where the host supports separate permissions. Sandbox/session/cache/view/log directories and `bootstrap/cache` must be writable by PHP. Do not use blanket world-writable permissions. The marker files remain in place. The host file manager may alter ZIP permissions, so inspect these settings after extraction.

## 5. Verify before sharing

The operator performs these checks on the real HTTPS account:

- `/casefile/` as a guest reaches `/casefile/sign-in`; sign-in and sign-out stay within the subdirectory. Check `/casefile/up` for the health response.
- Direct URLs `/casefile/_app/.env`, `/casefile/_app/vendor/autoload.php`, `/casefile/_app/storage/app/template/casefile-template.sqlite`, `/casefile/_app/database/fixtures/attachments/kitchen-sink-leak.png`, `/casefile/_app/storage/logs/laravel.log` and dotfiles return 403/404 without file content. Stop deployment if either protection fails.
- `/casefile/build/manifest.json` and its referenced CSS/JS/font files load from `/casefile/build`. Inspect the browser network, console and computed Instrument Sans font. No missing assets or CDN font requests should be necessary.
- Follow the [client walkthrough](DEMO.md) in all layouts. Open authorized PDF/PNG attachments. Confirm save/reply/status results, script controls, notifications, combined search and reset.
- Use two independent browser profiles: sign both in, change a case and sender in one, and prove the second profile's data/totals are unchanged. Reset one and prove the other remains unchanged. Inspect the distinct session cookies and correct path; never publish their values.
- Sign out and revisit protected URLs, confirm redirect, then confirm unauthorized attachments cannot be read. Verify no debug exception details are shown.
- Check remaining file capacity after sandbox provisioning and that rate-limit responses are usable. Sweeping runs on provisioning, not a worker. Do not assume a cron job exists.
- Confirm Laravel receives the genuine client IP through the host's proxy chain: provisioning and action rate limits depend on it. Do not blindly trust arbitrary forwarded headers. If the host requires trusted-proxy configuration, identify its actual trusted proxies/header contract and treat that configuration and spoofing tests as host-specific work before sharing the demo.

Local automated checks do not replace these remote checks. Use the [verification record](verification/2026-10-17-casefile-verification.md) to record outstanding work honestly.

## MySQL fallback decision

If `pdo_sqlite` is absent or PHP cannot write private SQLite files, stop. Do not change `DB_CONNECTION` to MySQL and share one writable database between visitors: demo mode deliberately requires SQLite and its isolation depends on separate files. A MySQL deployment would need an explicitly approved isolation design, migration/import workflow and new tests, or a separately approved read-only demonstration. None is included here. No automatic fallback or remote database access is performed.

## Isolated package tests

These tests install locked production dependencies into generated test workspaces, read only the approved seed/copies, mutate generated ZIPs, and remove only their own random temporary directories. The command below is the historical passing invocation for this delivery; its preview-template path has since been removed. For future runs, separately prepare a fresh template as documented above, substitute its absolute path, and approve the full command and generated cleanup before agent execution:

```sh
PYTHONDONTWRITEBYTECODE=1 CASEFILE_PACKAGE_TEMPLATE=/var/www/demo_stuff/case-management-system/storage/framework/testing/browser-preview-20261017-01/app/template/casefile-template.sqlite CASEFILE_PACKAGE_TEST_ROOT=/var/www/demo_stuff/case-management-system/storage/framework/testing/task16-package-tests-20261017 python3 -m unittest discover -s tests/Deployment -p test_package.py -v
```

Missing Composer/npm/PHP or unset isolated paths produce a visible skip, not a pass. The integration build uses prebuilt assets and does not install npm dependencies. Retained release output is not automatically deleted.

## Header correction delivery

The header correction groups layouts and occasional account actions inside Workspace, and System/Light/Dark inside Appearance. Its archive path is `storage/infinityfree/header-20261017/casefile-upload.zip`. Check the [header verification record](verification/2026-10-17-casefile-header-verification.md) for the actual package status, size and SHA-256 before using the archive; the path alone does not establish a passing package. The final build produced `app-CZkSi_rH.css` and `app-CH8RY8l8.js`. Verify the archive contains those matching stylesheet/bundle assets and manifest, the Workspace forms, Appearance trigger and tooltip, and disclosure behavior. The theme controller remains inline in the shared document head.

The source-only [2026-10-18 pointer-dismissal correction](verification/2026-10-18-theme-dismissal-verification.md) is newer than that archive. It requires no asset rebuild, but a newly authorized package build is required to include the updated inline theme controller before deployment. The historical archive and its recorded hash remain unchanged.

The isolated browser preview uses the existing development hot file to load Vite source assets. Those browser observations establish source behavior; the verification record separately records production build/archive consistency and any production-serving checks actually performed. Preserve the earlier packages. On the hosted path, recheck phone menu bounds, keyboard dismissal, first paint, persistence, device fallback without JavaScript and Demo reset before accepting delivery. Open case and Board Status and Search Sender menus; supporting browsers should show the enhanced picker, while others retain a native menu. Check the phone case dialog and a long Sender label.
