# Haven

A purpose-built home-services marketplace portfolio demonstration, implemented in Laravel 13 / PHP 8.4, Blade, Tailwind 4 and Vite. Apple Glass-inspired responsive UI, original illustrations and fictional people/projects.

See [the demo walkthrough](docs/DEMO.md), [deployment instructions](docs/DEPLOYMENT.md) and [asset provenance](docs/ASSETS.md).

## Local setup

Operator rules apply: Git is read-only, database access requires approval, and each exact shell Artisan command needs one-run approval. Do not run setup against an existing application database.

1. PHP 8.4+ with PDO SQLite, PDO MySQL, mbstring, XML, fileinfo, OpenSSL and GD; Composer; Node 24+ and npm.
2. From this directory: composer install --no-scripts --no-plugins, npm ci --ignore-scripts, then npm run build. Composer scripts intentionally contain no hidden Artisan/database setup.
3. Copy .env.example to .env only if absent. Set DB_DATABASE to the absolute path of this application's database/haven.sqlite. Use MODE=local, file sessions/cache, synchronous in-app notifications, and DEMO_ENABLED=true. No external services are needed.
4. If APP_KEY is empty, the operator may run php artisan key:generate --no-interaction. A generated local key already exists in the development environment; do not replace an existing key.
5. Create an empty database/haven.sqlite only if absent. Never truncate an existing database. With explicit database approval, run exactly:

    php artisan migrate --seed --no-interaction

Expected: migrations complete and DemoSeeder creates 6 categories, 8 providers and 8 projects. The seeder checks every marketplace table and refuses nonempty data without replacing accounts, passwords or records. Never use migrate:fresh for setup.

With exact command approval, run:

    php artisan serve --host=127.0.0.1 --port=8091 --no-reload

The --no-reload server inherits environment values at startup. Changing MODE in .env requires a fresh approved server invocation; editing the file alone does not switch a running preview.

Open http://127.0.0.1:8091 and choose a demo role. Normal customer/provider registration is also available in local mode.

The web process needs write access to storage, bootstrap/cache and the local SQLite file/directory. Keep storage private. No storage:link is needed.

## Verification

    vendor/bin/phpunit --no-progress
    vendor/bin/pint --test app bootstrap/app.php bootstrap/providers.php config database routes tests
    npm run build

PHPUnit uses forced in-memory SQLite, refuses cached config or other database connections, and disables external HTTP calls. The operator has authorized these isolated tests for this implementation.

The concurrency test is skipped unless separately approved. Its exact opt-in invocation is:

    HAVEN_CONCURRENCY_APPROVED=1 vendor/bin/phpunit tests/Feature/HiringConcurrencyTest.php --no-progress

It creates only generated hiring-*.sqlite fixtures under storage/framework/testing, launches two guarded PHP workers, internally migrates each dedicated fixture, races two quote acceptances, and removes the exact fixture/SQLite sidecars/barriers. It never points at the application database.

The verified local session also has a separate read-only preview at http://127.0.0.1:8092. It was started once with operator approval using MODE=demo php artisan serve --host=127.0.0.1 --port=8092 --no-reload. Each future Artisan invocation still needs exact approval. Both previews use the same fictional local database; use port 8092 to inspect the public-demo restrictions.

See [the final verification record](../docs/verification/2026-10-15-haven-verification.md) for test, browser, review and legacy-retirement results.

## Portfolio context

This is an original demonstration of supported development capabilities, not a claim of previous client work. Customer/provider/admin workflows are implemented. Payments are explicitly simulated; no payment details are collected. Messaging updates on page refresh. Notifications stay in the application. There are no emails, SMS, payouts, background workers or external integrations.

Local mode supports real persistence. The public InfinityFree deployment uses MODE=demo: all database mutations are blocked by a connection hook and HTTP mutations are blocked before files are saved. Session-only login/logout/role selection remains available. Visitors explore seeded states without changing shared demo data.
