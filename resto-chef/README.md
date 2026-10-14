# Resto-Chef — restaurant ordering demo

A working proposal demo built from the supplied PHP project. Customers can browse
and search the menu, use a multi-item cart, choose pickup or delivery, place orders,
and track their history. Staff can manage dishes, prices, categories, availability,
preparation status and date-filtered sales.

## Deploy on InfinityFree

Follow [the complete InfinityFree deployment guide](deploy/infinityfree/DEPLOY.md).
Build a fresh upload ZIP, importable MySQL demo SQL, and private demo logins with:

```bash
python3 bin/package-infinityfree.py
```

Outputs are in ignored `storage/infinityfree/`. Extract the ZIP locally, configure
`htdocs/private/.env`, and upload only the contents of `htdocs` to the host's website
directory. Import `demo.sql` separately through phpMyAdmin. The raw repository
layout is not the InfinityFree upload layout. No command-line access on the host is
needed. See the guide for exact steps, HTTPS, verification and troubleshooting.

## Run locally

Requirements: PHP 8.2+ with PDO, pdo_sqlite and mbstring. No Composer or npm install.

```bash
cd /var/www/demo_stuff/resto-chef
# First setup only; prints randomly generated staff/customer credentials:
php bin/setup.php --demo
php -S 127.0.0.1:8087 -t public public/router.php
```

Open http://127.0.0.1:8087. In this workspace setup has already been run. The generated
credentials are saved privately in `storage/demo-credentials.json` (mode 0600).
The staff login uses `/login`, then redirects to `/admin`. Use a separate browser
profile or private window to demonstrate customer and staff sessions simultaneously.
Never share the staff credentials in a public proposal or repository.

Setup refuses to reseed a database containing users. To create a fresh independent
demo, choose a new absolute `DB_PATH`; no reset command deletes existing data.
Without `--demo`, setup creates the schema and a staff account only. Set
`ADMIN_EMAIL` to choose that account's email; passwords are always random.
`--json` outputs credentials as JSON for isolated test tooling.

## Proposal walkthrough

1. Browse the menu; filter categories, search, and add two dishes to the bag.
2. Change quantities, sign in as the demo customer, and select pickup or delivery.
3. Enter a contact phone number (and address for delivery), then place the order.
4. Open the staff order desk. Advance the order through preparation and readiness.
5. For delivery, dispatch it before completing; for pickup, complete when collected.
6. Refresh the customer's order page to show the updated progress.
7. Open Overview, select Today, and show the completed sale and popular dishes.
8. Edit a price or toggle a dish unavailable; show the storefront reflecting it.

The seeded menu and orders are illustrative. Existing local photos are reused and
labeled illustrative in the storefront. Replace these with restaurant-provided
photos, branding and actual menu details before sharing the final proposal demo.

## Database and configuration

Optional: copy `.env.example` to `.env` and edit it. Actual environment variables
have priority over `.env`. SQLite defaults to `storage/demo.sqlite`, outside the
public document root. Amounts are integer cents. Currency defaults to USD, delivery
fee to 350 cents, and reporting timezone to UTC. Set `APP_NAME`, `APP_CURRENCY`,
`DELIVERY_FEE_CENTS`, and `APP_TIMEZONE` as appropriate. This demo assumes currencies
with two decimal places.

MySQL is also implemented through PDO with native prepared statements, utf8mb4,
nonpersistent connections, and optional verified TLS using `DB_SSL_CA`. Create a
separate empty database and dedicated non-root user, then configure:

```dotenv
DB_DRIVER=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=restaurant_demo
DB_USER=restaurant_app
DB_PASSWORD=your-random-password
```

Use a setup account with schema-creation permissions to run `bin/setup.php`, then
restrict the runtime account to the needed SELECT/INSERT/UPDATE/DELETE permissions
on this database. No credentials are embedded in source; blank passwords and the
root database user are rejected. Automated integration validation covers SQLite and an isolated MySQL/Apache HTTPS
package deployment. Check the target hosting account using the deployment guide.
The legacy `mishtidb` database is never automatically imported or modified.

## Security and hosting

- Serve **only `public/`**. Do not serve the project root. The root `.htaccess`
  denies access; the public `.htaccess` supports Apache rewriting. For Nginx use
  `root /var/www/demo_stuff/resto-chef/public` and route application requests to `index.php`.
- The user-export API is removed. Its old URLs return HTTP 410, without data.
- Old standalone PHP handlers and the plaintext password SQL dump were removed.
  An original-source backup is at `/tmp/restrogirls-original-20261014.tar.gz` on this
  machine only; it is not part of the application or a distributable artifact.
- Password hashing, rotated sessions, HttpOnly/SameSite cookies, idle expiry,
  CSRF on every mutation, POST-only actions, staff roles, customer-order ownership,
  login throttling, parameterized SQL, output escaping and security headers.
- All prices/totals come from the server. Checkout revalidates availability and
  prices, stores immutable item snapshots, and prevents duplicate submissions.
- SQLite reserves its write transaction before reading checkout prices. Replaying
  a completed checkout preserves any newly started cart.
- Use HTTPS and `SESSION_SECURE=1` for remote hosting. Keep `.env`, storage,
  credentials, logs and source files out of the web root. Configure your server's
  body-size/rate limits and back up the database. PHP's built-in server is local-only.

## Sales and demo scope

Pickup: New → Preparing → Ready → Completed.
Delivery: New → Preparing → Ready → On the way → Completed.
Orders may be cancelled before completion; completed orders cannot be reversed.
Sales recognize completed orders by completion time in `APP_TIMEZONE`, include
delivery fees, and exclude cancelled/unfinished orders. Menu changes do not alter
past item names or prices. Daily totals, completed count, average order value,
active orders and popular dishes are available in Overview.

Payment is **pay on pickup/delivery**; no online money is charged. Completing an
order records it as a completed sale, not a separately verified payment. This demo
does not include tax calculations, refunds, delivery zones, drivers, email/SMS,
password reset, online payments or production deployment. Order updates appear on
refresh, with a refresh control on customer and staff pages.

## Verification

```bash
php tests/domain.php
python3 tests/config.py
python3 tests/web.py
python3 tests/concurrency.py
# With the demo running and Google Chrome installed; Node 22+:
node tests/browser.mjs
```

Domain and HTTP tests use isolated databases and do not change demo orders.
The concurrency test verifies a checkout survives a competing SQLite write.
Browser checks use a disposable Chrome profile and the demo accounts; they only
exercise navigation/cart and create screenshots under ignored `storage/screenshots/`.
No third-party test packages are required. Override `CHROME_BIN` or `DEMO_URL` for
the browser check when necessary.

## Code map

- `public/`: sole web entrypoint, local assets and development router.
- `app/Database.php`, `app/config.php`: private persistence and environment settings.
- `app/Auth.php`: password authentication, safe account results and throttling.
- `app/Store.php`: catalog, cart validation, transactional orders, status and sales.
- `app/Http.php`, `app/bootstrap.php`: routing, authorization, sessions and CSRF.
- `templates/`: responsive customer and staff views with escaped values.
- `bin/setup.php`: CLI-only initialization and sample data.
- `tests/`: domain, black-box HTTP, concurrency and browser checks.
