# Restaurant proposal demo

The authorized outcome is a working customer-to-staff demo: menu, multi-item cart,
pickup/delivery, staff preparation statuses, menu prices/availability, history and
sales summaries. Security fixes and removal of the user-export API are required.

Keep PHP/PDO; put browser entrypoints/assets in public/ and application/config/data
outside it. SQLite defaults to a private file for simple local setup. Environment
configured MySQL uses native prepared statements, utf8mb4 and a non-root account.
A small shared application avoids duplicated unsafe legacy handlers without a
framework migration. Remove the old handlers and plaintext SQL dump after backup.

Prices are integer cents. Server-side cart quotes are checked again transactionally
at checkout; item names/prices are snapshotted. A unique checkout key prevents
replays. Require customer login; pickup needs name/phone, delivery also needs an
address. Payment is on collection/delivery; no online payment, tax or driver API.
Currency defaults to USD, delivery fee $3.50, reporting timezone UTC, configurable.

Statuses: pending → preparing → ready → completed for pickup; delivery inserts
out_for_delivery before completed. Cancellation is allowed before completion.
Customers see only their own orders. Staff can manage categories, add/edit food,
prices and availability; hiding food preserves historical records. Completed
orders contribute to revenue by completion date; pending/cancelled orders do not.
Reports include order counts, revenue, average value, daily sales and popular items.

Security: hashed passwords, rotated sessions, HttpOnly/SameSite cookies, CSRF on
all POSTs, POST-only mutations, admin checks, SQL binding, escaped output, login
throttling, generic errors, private storage, CSP, CLI-only setup, random demo
credentials. No existing database is automatically changed or imported.

Validation: isolated SQLite domain/HTTP tests for pricing, availability, replay,
rollback, status transitions, immutable history, local date boundaries, roles,
CSRF, injection, guessed order IDs and private files. Browser checks at desktop
and mobile widths. Document launch and demo walkthrough.
