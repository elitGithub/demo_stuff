# InfinityFree deployment

## Current upgrade ZIP — 2026-10-18

Use `storage/infinityfree/releases/2026-10-18-fixes/casefile-upload.zip`.
The dedicated release folder contains only this ZIP.

| File | Bytes | Files | SHA-256 |
| --- | ---: | ---: | --- |
| `casefile-upload.zip` | 8,640,343 | 6,704 | `a2b25c2b02fbef0d5dc41af7d6d488f528f1a2f50acdb119bcad68fcb6d5d47e` |

This upgrade starts with the retained `storage/infinityfree/20261018-121013-136261/casefile-upload.zip`
(SHA-256 `cbf5eaaecc63c73c559ca0287602a6f3449fcd47c9ad926eb3bf4f9f4ba7e9ef`).
The reviewed application payload preserves vendor and other non-build bytes,
except for the four reviewed current shared views: `app-layout`, `layout-switcher`,
`theme-script` and `theme-switcher`. Its complete build tree comes from the tested
`storage/framework/testing/css-audit-20261018/public/build/final-06`, retaining
the baseline Instrument Sans license. Font CSS/JSON URLs are remapped from
`/build/final-06/` to `/casefile/build/` and every asset reference resolves.
The current `public/build` was stale and was not used.

The current ZIP is an existing-install overlay. It excludes every member under
`_app/storage/`, `_app/bootstrap/cache/` and
`_app/database/fixtures/attachments/`, and contains no real `.env`, database,
credentials or runtime state. Normal merging extraction therefore preserves the
hosted environment and APP_KEY, template, visitor databases, attachments,
sessions, logs and caches. It cannot provision a fresh installation.

The entry point selects the compiled Blade extension
`casefile-dacaa58f5476547191c0c502.php` after configuration loads and before service
providers boot. This content-derived release namespace creates fresh compiled
views in the existing writable views directory, even if old compiled files have
future timestamps. Old cache files remain in place; no manual cache deletion is
needed. `deploy/package-upgrade.py` reproduces this transformation from the
retained reviewed full ZIP at
`storage/infinityfree/upgrade-fix-input-20261018/casefile-reviewed-full.zip`
(SHA-256 `f6e3184f7b66977a8c6eed1c9eab705ef8852699f84b6cd827459997ead877ef`).

The final06 CSS is `app-D-VNy6s6.css` (SHA-256
`7d68fffc5b32ecf7ed8f5f985f359d05850346b141bb3e3ca0a0ddd80ea93f35`),
and JavaScript is `app-CBc_cVwR.js` (SHA-256
`52c0149aa070011edbcf444f76dfdbb94521dd3e0380a3eac250490fe16a6e0c`).
The [CSS audit record](verification/2026-10-18-css-audit.md) records the fresh
production build, actual browser asset URLs, scoped final06 focus regression
and independent review. Unaffected earlier screenshots are reused as documented
there. No full source hash snapshot was retained at build time, so this provenance
does not establish cryptographic proof of every source-to-bundle input.

Static release checks passed without opening SQLite, installing dependencies,
bootstrapping Laravel or rebuilding. Nothing has been uploaded or accepted on
InfinityFree. Keep the listing blocked until the real hosted checks below pass.

## 1. Confirm the host with the check file

The operator first uploads only `deploy/casefile-check.php` to a temporary location under the intended account and visits it over HTTPS. It prints PHP version, `pdo_sqlite`, `sqlite3`, SQLite library version and `disable_functions`; it does not open a database or bootstrap Laravel. Require PHP 8.4+ and `pdo_sqlite`. `sqlite3` supplies the library-version diagnostic; Laravel uses PDO. Remove the diagnostic after recording the result. Never leave `phpinfo`, setup scripts or database importers online.

Target: `https://demo-sites.infinityfree.me/casefile/`, beside the other demos. Nothing in this delivery uploads or publishes it. Remote PHP extensions, Apache behavior and account limits have not been verified. [InfinityFree advertises PHP 8.4](https://www.infinityfree.com/); the actual account check decides whether this package is viable.

Historical dark-mode release: `storage/infinityfree/dark-mode-20261017/casefile-upload.zip` and its [dark-mode verification record](verification/2026-10-17-casefile-dark-mode-verification.md) describe the earlier Theme-segments interface. That build produced `app-DGK12e4o.css` (52.79 kB) and `app-BXtwaOZi.js`; the Theme script was inline in the shared document head. Its isolated browser preview used an existing development hot file and served source CSS from `127.0.0.1:5173/resources/css/app.css`, so those visual checks did not prove that the production bundle was served. Preserve this archive and the earlier `task16-20261017` package as historical releases. The current upgrade ZIP section above supersedes the historical deliveries below.

## 2. Check the file budget

The local verifier prints `Files: N` and rejects 12,000 or more files. Account limits are shared by all demos: the planned budget is approximately 30,000 files/directories and 50,000 daily hits for the whole account. Check the actual control panel's usage and remaining allowance before packaging/upload, allowing for directories, new visitor databases, sessions, cache and logs. The 12,000-file package limit is a conservative project ceiling, not a promise that the account has room. [Account-limit reference](https://forum.infinityfree.com/t/all-of-the-limits-on-infinityfree-and-what-they-mean/43467).

## 3. Prepare locally

For this existing-install upgrade use the current ZIP above and continue to
section 4. Do not rebuild fixtures, templates or assets, rerun the old packager,
or recreate the hosted environment. The historical full-build workflow below
is separate from this static artifact assembly.

For a future fresh installation or separately approved full rebuild, use the
source lockfiles, a newly verified production build and the four generated fixture
attachments. Do not use the stale current `public/build` for this release.
Prerequisites are Composer, PHP 8.4+, Python 3.10+, and existing frontend build
dependencies. The packager never invokes Artisan, a build command or a migration.
Any missing template must be built separately with exact operator approval.
Never substitute an application database or a visitor sandbox for the immutable seed template.

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

The output root must be new and below this project's `storage`; source symlinks are rejected. The historical 2026-10-17 template SHA-256 was `1a28150d776cf08f5beee0e64539cc4b92a0698575b6d2929a8c66bfeddb2f43`. The reviewed full ZIP carried the 2026-10-18 baseline template as opaque archive bytes, SHA-256 `46c88ea91a77eb1dfe7b607682fa9a9757abd05253fde9c2640f88d817a29d87`; the current upgrade excludes that member so the hosted template survives extraction. It was not opened as SQLite during this release task. The full packager checks SQLite integrity, 16 cases, 43 mailbox messages, 20 script entries and the current migration version using an immutable read-only connection. It verifies the source hash afterward. Those reads still require operator approval; do not run `package.py` or `verify-package.py` to transfer this upgrade.

The script creates a separate workspace, copies the lockfiles there, and runs exactly:

```sh
composer install --no-dev --no-scripts --no-plugins --no-interaction --prefer-dist --no-progress
```

Composer home/cache remain inside that generated workspace. No source dependency changes or global cache/config writes are intended. The copy installs only locked production dependencies, then packages production vendor, application/config/routes, Blade views, migrations for reference, private fixture attachments and the template. It does not copy source `.env`, tests, node_modules, existing databases, sandboxes, session/cache data or logs. No development bootstrap cache is copied. Laravel can create its package-discovery cache in the writable private `bootstrap/cache` at runtime.

The output contains `casefile-upload.zip`, unpacked `casefile/`, a sibling `manifest.json` with byte lengths/SHA-256 values, `INSTRUCTIONS.txt`, this guide and the private generated build workspace. Keep the ZIP and manifest together for repeat verification. The manifest detects corruption; it is not a digital signature against an attacker replacing both files.

Both normal extraction and extraction ignoring directory entries are audited. Real `index.html` marker files preserve writable runtime paths; they are non-empty because InfinityFree File Manager extraction drops empty files and directories, and the verifier rejects any 0-byte archive file. Verification rejects unsafe paths, symlinks, duplicate ZIP entries, secrets/development files, missing protections, mismatched manifest, missing assets/fonts/license, changed fixtures, wrong production dependencies and invalid template. It checks writable extraction directories without starting the application; this does not prove remote permissions or HTTP access control.

## 4. Upload and configure

### Existing installation upgrade

Use InfinityFree File Manager's archive extraction for this upgrade. Select the
target domain's actual `htdocs`; accounts with multiple domains may have several.

1. Confirm the ZIP filename, byte size and SHA-256 above. Keep a private backup
   of the existing installation before the upgrade. Complete any outstanding
   host capability checks from section 1 separately.
2. Upload `casefile-upload.zip` into that `htdocs` and extract it there, enabling
   overwrite of matching files and merging existing directories. The ZIP's
   `casefile/` must map to `htdocs/casefile/`; extracting inside the existing
   `casefile/` would create an incorrect second level.
3. Keep all existing folders and remote-only files. No folder deletion, file
   skip list, environment edit, key change, migration or cache clearing is
   needed. Wait until extraction completes successfully before using the site,
   then perform section 5's hosted checks.

Extraction updates multiple files and is not atomic; use a quiet maintenance
window and avoid submitting changes while it runs. The local overlay test
proves preservation with normal merging extraction; actual hosted extraction and
acceptance remain operator checks. Keep the listing blocked if they fail.

No SSH, host Artisan, workers or migrations are used. The package is fixed to
`/casefile`; font CSS/manifest URLs use `/casefile/build/`. Renaming the directory
requires a reviewed package URL adjustment as well as environment/cookie changes.

```text
htdocs/casefile/
  index.php
  .htaccess
  build/
  _app/
    .htaccess
    .env.example
    app/ bootstrap/ config/ routes/ resources/ database/ vendor/
```

Existing `_app/.env`, `_app/storage/`, `_app/bootstrap/cache/` and private fixture
attachments remain on the host and are absent from this upgrade ZIP.

The root rewrite rule denies `_app` access; `_app/.htaccess` separately denies all access. Both must survive upload. Private attachments remain at `_app/database/fixtures/attachments`, matching `config/casefile.php`; serve them only through authorized attachment routes. There is no public storage symlink.

### Fresh installation only

The current upgrade ZIP cannot create a fresh installation. The following
configuration notes apply only to a separately approved full-install package.
For an approved new installation,
create `_app/.env` privately from the shipped `.env.example`. It is deliberately
absent from the ZIP. Set a new secret APP_KEY generated locally, not an example
key. One non-Artisan key-generation command for the operator is:

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
- Confirm the actual network responses use `app-D-VNy6s6.css` and `app-CBc_cVwR.js`; no `final-06`, localhost, stale bundle or development hot-file URL appears. Recheck phone and desktop Light/Dark screens, Workspace/Appearance menus and dismissal, first paint, persistence and no-JavaScript device fallback. At 1499→1500→1499px, Desk/Mail open editors retain Notes drafts and visible focus; when Close details hides, focus moves to Issue. Recheck long Sender labels, native/enhanced pickers, phone dialogs and visible loading feedback. The local audit documents limits on loading-paint, zoom and OS preference evidence; hosted acceptance must record actual observations.
- Follow the [client walkthrough](DEMO.md) in all layouts. Open authorized PDF/PNG attachments. Confirm save/reply/status results, script controls, notifications, combined search and reset.
- Use two independent browser profiles: sign both in, change a case and sender in one, and prove the second profile's data/totals are unchanged. Reset one and prove the other remains unchanged. Inspect the distinct session cookies and correct path; never publish their values.
- Sign out and revisit protected URLs, confirm redirect, then confirm unauthorized attachments cannot be read. Verify no debug exception details are shown.
- Check remaining file capacity after sandbox provisioning and that rate-limit responses are usable. Sweeping runs on provisioning, not a worker. Do not assume a cron job exists.
- Confirm Laravel receives the genuine client IP through the host's proxy chain: provisioning and action rate limits depend on it. Do not blindly trust arbitrary forwarded headers. If the host requires trusted-proxy configuration, identify its actual trusted proxies/header contract and treat that configuration and spoofing tests as host-specific work before sharing the demo.

Local automated checks do not replace these remote checks. Record the hosted
date, hostname, current ZIP checksum, capability/privacy/isolation results and
actual browser observations beside the [CSS audit record](verification/2026-10-18-css-audit.md).
Keep the listing blocked until acceptance is recorded; no deployment success is claimed here.

## MySQL fallback decision

If `pdo_sqlite` is absent or PHP cannot write private SQLite files, stop. Do not change `DB_CONNECTION` to MySQL and share one writable database between visitors: demo mode deliberately requires SQLite and its isolation depends on separate files. A MySQL deployment would need an explicitly approved isolation design, migration/import workflow and new tests, or a separately approved read-only demonstration. None is included here. No automatic fallback or remote database access is performed.

## Isolated package tests

These tests install locked production dependencies into generated test workspaces, read only the approved seed/copies, mutate generated ZIPs, and remove only their own random temporary directories. The command below is the historical passing invocation for this delivery; its preview-template path has since been removed. For future runs, separately prepare a fresh template as documented above, substitute its absolute path, and approve the full command and generated cleanup before agent execution:

```sh
PYTHONDONTWRITEBYTECODE=1 CASEFILE_PACKAGE_TEMPLATE=/var/www/demo_stuff/case-management-system/storage/framework/testing/browser-preview-20261017-01/app/template/casefile-template.sqlite CASEFILE_PACKAGE_TEST_ROOT=/var/www/demo_stuff/case-management-system/storage/framework/testing/task16-package-tests-20261017 python3 -m unittest discover -s tests/Deployment -p test_package.py -v
```

Missing Composer/npm/PHP or unset isolated paths produce a visible skip, not a pass. The integration build uses prebuilt assets and does not install npm dependencies. Retained release output is not automatically deleted.

## Historical header correction delivery

The header correction groups layouts and occasional account actions inside Workspace, and System/Light/Dark inside Appearance. Its archive path is `storage/infinityfree/header-20261017/casefile-upload.zip`. Check the [header verification record](verification/2026-10-17-casefile-header-verification.md) for the actual package status, size and SHA-256 before using the archive; the path alone does not establish a passing package. The final build produced `app-CZkSi_rH.css` and `app-CH8RY8l8.js`. Verify the archive contains those matching stylesheet/bundle assets and manifest, the Workspace forms, Appearance trigger and tooltip, and disclosure behavior. The theme controller remains inline in the shared document head.

The [2026-10-18 pointer-dismissal correction](verification/2026-10-18-theme-dismissal-verification.md) is newer than that historical archive. The current upgrade ZIP at the top includes the reviewed current inline theme controller and subsequent final06 CSS/focus corrections. The historical archive and its recorded hash remain unchanged.

The isolated browser preview uses the existing development hot file to load Vite source assets. Those browser observations establish source behavior; the verification record separately records production build/archive consistency and any production-serving checks actually performed. Preserve the earlier packages. On the hosted path, recheck phone menu bounds, keyboard dismissal, first paint, persistence, device fallback without JavaScript and Demo reset before accepting delivery. Open case and Board Status and Search Sender menus; supporting browsers should show the enhanced picker, while others retain a native menu. Check the phone case dialog and a long Sender label.
