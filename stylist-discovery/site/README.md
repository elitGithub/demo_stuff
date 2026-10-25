# Strand & City application

Requires PHP 8.4 and the locked Composer dependencies.

From this directory, run `APP_ENV=local /usr/bin/php8.4 -S 127.0.0.1:8095 -t public`.
The ignored `.env.local` holds the local application key; never publish it.
Only the static landing is implemented in Task 1. No sandbox, booking or account routes are available yet.

Run isolated safety checks with `/usr/bin/php8.4 vendor/bin/phpunit --filter RuntimeSafetyTest`.
The test harness refuses cached configuration and keeps fixtures beneath generated test roots.
Stock migrations remain unexecuted until Task 2 replaces their schemas. Do not run migrations against an application database.
