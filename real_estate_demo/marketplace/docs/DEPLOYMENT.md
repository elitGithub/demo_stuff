# InfinityFree deployment

Target: https://demo-sites.infinityfree.me/haven/ (operator-confirmed destination). Upload the haven directory alongside the existing demo directories and add Haven to the portal index. Nothing has been uploaded or published by this task.

The application requires PHP 8.4+. Confirm the selected InfinityFree account's current PHP version and required extensions before upload. The official [InfinityFree Laravel guide](https://forum.infinityfree.com/t/how-to-install-a-laravel-site-on-infinityfree/118578) requires locally prepared dependencies/assets and a layout compatible with the fixed htdocs root. No SSH, Artisan, queue worker or websocket process is assumed on the host.

## Public directory and private application

A generated hosting package places index.php, .htaccess, build/ and images/ at the chosen public subdirectory root. The application lives in _app/ beneath it because files outside htdocs are unsuitable on this host. Two protections deny direct HTTP access to _app/: a root rewrite rule and _app/.htaccess. Do not upload if either protection is missing.

The index entry point sets Laravel's public path to the package root. Private photos are served by the authorized controller from _app/storage/app/private/request-photos. There is no public storage symlink. .env, dependencies, source, logs and session files are never intended as public resources.

## Environment

Use deploy/.env.infinityfree.example as the template. Set a new random APP_KEY, the final HTTPS APP_URL, the matching SESSION_PATH, a distinct Haven SESSION_COOKIE, and InfinityFree's assigned MySQL hostname/database/user/password. Do not use localhost as the database host. Keep APP_DEBUG=false, MODE=demo, DEMO_ENABLED=true, BOOST_ENABLED=false, file sessions/cache and synchronous in-app notifications.

MODE=demo (also accepts lowercase mode=demo) blocks INSERT/UPDATE/DELETE/DDL and other non-read statements through a database connection hook, plus blocks unsafe web requests before application side effects. Login/logout/role switching uses session files and avoids password rehash/remember-token writes. Do not configure database-backed sessions, cache or queues in demo mode.

The sample APP_KEY and DB credentials are intentionally blank. Never commit populated .env files or upload SQL/backup archives as public files.

## Preparation and import

From marketplace, run the approved isolated fixture-export test with vendor/bin/phpunit tests/Feature/DeploymentExportTest.php --no-progress, then npm run build and python3 deploy/package.py. The exporter uses only SQLite :memory: and a disconnected MySQL grammar; it never contacts MySQL. The package installs locked production dependencies with Composer scripts/plugins disabled, excludes development credentials, and validates the ZIP after extraction. It includes the otherwise-empty Laravel runtime directories.

The generated folder is named in ../.cache/latest-infinityfree-package.txt. It contains haven-upload.zip, import-into-empty-database.sql, a SHA-256 manifest and setup instructions. Only the ZIP's haven directory belongs under htdocs. Keep the SQL and outer package files off the web server. Run python3 deploy/verify-package.py followed by the absolute ZIP path to repeat the extraction audit without accessing a database.

Local verification does not execute the generated SQL on a live MySQL server or test InfinityFree's Apache configuration. Those checks remain part of the operator's eventual deployment. See ../../docs/verification/2026-10-15-haven-verification.md for the final test and browser record.

Use a new, empty database reserved for Haven. Import the generated schema/fictional-data SQL using the account's phpMyAdmin. The import has no DROP/TRUNCATE statements and will refuse conflicting table names; it is not a reset script. Schema creation on MySQL cannot be made fully transactional, so an interrupted initial import needs operator review, not a blind retry. Keep the SQL outside the public directory.

Match the exported private fixture photo with its database path. Do not independently reseed the host or copy development session/cache/database files. Upload prebuilt production vendor/ and build/; do not upload node_modules, .git, tests, development credentials or the legacy application.

## Host verification

Before sharing the demo link, check HTTPS, every asset under the subdirectory, all three role switches, notifications, projects, private photos and the receipt. Verify that direct URLs to _app/.env, _app/vendor/autoload.php, _app/storage/logs/laravel.log and dotfiles return 403/404 without file content. Verify registration, proposal, message and admin writes return the read-only response and unchanged data. Confirm the Haven session cookie is scoped to the chosen path and does not collide with other demos.

Do not leave phpinfo, setup/import endpoints or writable public diagnostic scripts on the host. There is no web database installer in this application.

## Conventional hosting

On a host with configurable document roots, point the web root directly to marketplace/public, keep everything else outside it, and use normal Laravel deployment. Apply the same environment/privacy settings. Production payments, messaging integrations and notifications require separate implementation and operational review.
