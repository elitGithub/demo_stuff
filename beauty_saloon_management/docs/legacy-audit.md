# Legacy migration and removal audit

Date: 2026-10-15. Scope: the `Database`, `barbarbaba` and `cdm` directories beside Studio.

## Decision and coverage

Extraction and removal are complete. Every identified useful business workflow has a working Studio equivalent or the explicit disposition below. The remaining legacy source has no actionable setup/runtime dependency. The three legacy directories were removed under the user's instruction after successful independent review, complete tests and a fresh standalone install.

The inventory covers **220 first-party PHP files** (73 salon, 147 CDM), both SQL schemas and all remaining assets/support files. `legacy-inventory.json` records each application file's path, SHA-256, size, functional area and query table tokens, plus tree totals and schema hashes. It contains no old customer records or credentials. The removed trees comprise 2,782 files / 133,584,751 bytes. Bundled PHPMailer, AdminLTE, JavaScript libraries, fonts and their documentation are support dependencies, not additional business workflows. The CDM docs directory documents AdminLTE itself. Its upload directory contains old image records; its text files contain notification queue/debug state.

The source was evaluated by workflow, database usage, route/UI handlers, mutation handlers and associated scripts. The first pass covered scheduling, client care, billing and reminders. The completion pass separately traced membership/inventory, CDM pipeline/assignment/exports, and outreach/content. Remaining account/profile, manager removal/reassignment, backup, notification and dashboard handlers were checked during final inventory reconciliation. No first-party file remains unclassified.

Existing-data preservation was explicitly waived. Old accounts, uploaded customer images, databases, credentials, queue state and logs are intentionally not imported. The only reused asset is the already copied salon hero photograph; its provenance is below.

## Final workflow disposition

| Legacy behavior and source examples | Studio replacement / decision |
| --- | --- |
| Public pages, booking, appointments and staff schedules | Shared website, qualified-stylist booking, server-priced services, time off, calendar, rescheduling and explicit lifecycle. BookingService and Booking/Workspace tests, including a two-process overlap test. |
| Customers, visit services, notes and follow-ups | Client directory/profile, favourite hairstyles/private photos/services/stylist, repeated appointments, notes and follow-up completion. Client company and B2C/B2B/B2G segment are editable. |
| `membership_plans`, `user_memberships`; add/edit/manage plans and subscriptions | Paid plan enrolment, duration/benefit/price snapshots, expiry display and append-only renewals. Renewals start at expiry or today if expired. Text benefits remain manually fulfilled; the old code had no reliable credit/redemption or automatic charging system to preserve. |
| `tblservices` product type/opening stock; `stock.php`, `order.php`, `add_invoice.php`, `pro_sale.php` | Separate product catalogue and stock ledger, stock adjustment reasons, atomic multi-line checkout/payment/inventory changes, insufficient-stock rollback and idempotency. Negative-stock clamping and submitted totals rejected. |
| Invoice/payment methods, receipts, search | Shared service/retail/membership invoices and payment records; line/client/tax snapshots; quantity totals; invoice and receipt PDFs. Existing bill history remains immutable when catalogue data changes. |
| `staff_commision.php`, `top_staff.php`, `top_services.php`, date sales reports | Date-filtered paid sales, item quantities/net revenue, per-stylist commissions, type totals and CSV. Commission freezes at service invoicing, excludes tax/retail/memberships, and appears only when paid. Duplicate stylist names remain separate. |
| Tax/category configuration | Service categories are editable labels; installation tax percentage and currency are server configuration, frozen on invoices. Duplicate legacy tax/category admin screens are unnecessary. |
| Birthday/anniversary cron handlers | Separate marketing-channel consent and optional dates; annual deduplication; fresh recipient/consent/date checks; simulated outbox. Leap-day occasions run on February 29 only. |
| `subcriber.php`, `tblsubscriber` | Public explicit newsletter consent, audience list, safe preview composition, token confirmation unsubscribe and manager suppression. Anonymous signups cannot reverse an opt-out. |
| `about-us.php`, `contact-us.php`, missing `tblpage` references | Allowlisted, escaped plain-text website editor for brand, hero/about text and contact information. No arbitrary HTML or credentials editor. |
| CDM leads → engagement → proposal → order → payment → delivery → closed/cancelled | Assigned enquiry/package/group-booking board, stage/date/agent/segment/search/due filters, next actions, references, notes and append-only events. Server enforces sequential and chronological transitions; closing requires a paid same-client invoice. |
| Proposal/order/payment/delivery/cancellation attachments and references | Validated PDF/raster files in private storage; scoped download routes; stage references and dates saved in history. No public uploads or executable files. |
| `user_void_transaction.php`, cancelled/closed updates | Explicit manager reopening with reason and active assignee. Prior cycle, invoice, milestones and cancellation history remain. Unsafe automatic closure of cancelled orders is deliberately rejected. |
| CDM exports/master lists | Assignment-scoped, filter-preserving CSV including client/company/segment/agent/stage references. Formula prefixes escaped. Financial CSV is manager-only. |
| Manager/agent/user CRUD and profiles | Owner/manager/staff accounts, active-state enforcement, manager relationships, owner-only access administration, self-profile/password changes requiring current password. Disable accounts rather than hard-delete financial/audit ownership. Owner can reset staff passwords. |
| Role dashboards, notification polling and file-based follow-up queues | Shared role-aware workspace, assigned pipeline board/due filter, client follow-ups and append-only event timelines. Duplicated polling widgets, gender pie charts and notification-read copies do not add salon workflow value. No file queue is retained. |
| `superadmin_backup.php`, `backups` | Private `studio:backup` SQLite snapshot with business uploads, manifest/hash and tested failure cleanup. Backup restoration is operational tooling, not a public UI endpoint. |
| `superadmin_phpmyadmin*.php` | Deliberately removed arbitrary database administration. Laravel migrations and deployment/database-provider tools replace it. |
| Legacy login/register/reset/session implementations and embedded SMTP settings | Laravel password hashing, sessions, CSRF, throttles and access checks. Public staff registration, weak reset flows, MD5 passwords and embedded credentials are rejected. Provider-based password recovery and real transports are later deployment integrations. |
| Bundled templates, CSS/JS/plugins/fonts, PHPMailer copies, config/includes, SQL dumps | Replaced by Studio source and locked Composer packages. No runtime consumer remains. Old customer files/logs/queue data discarded under the explicit data-migration waiver. |

## Independent runtime evidence

- Independent correctness/security review found no remaining material issue after fixes to backup failure handling, inactive-assignee reopening, same-name commission grouping and the PHP version floor.
- Composer manifest and lock validate; locked dependencies require PHP 8.4.1+ and install successfully. PHP 8.4.26 was used.
- A fresh copy under `/tmp/studio-standalone-l2fiy85u/studio` contains only Studio source; it began without `.env`, database, private uploads, `vendor` or `node_modules`. Composer installed locked dependencies from scratch. `composer run setup` created the environment, migrated and seeded all modules. All 88 tests passed there; the final PDF correction was additionally regression-tested and synchronized.
- Fresh data: 1 owner, 28 clients, 36 visits, 3 products, 1 purchased membership, 8 enquiries and 2 newsletter subscribers. No old SQL/database files were needed.
- Fresh backup hash matched its manifest and SQLite `integrity_check` returned `ok`.
- Runtime source/config/routes/assets/bin were searched for old project/SQL/absolute repository paths; none were found. Composer/npm source dependencies are independent. The old include/config paths are not used.
- Browser checks cover public/manager neutral design, retail checkout, membership purchase, pipeline, mobile navigation and simulated outreach. Downloads and PDF line totals were independently checked. See `verification.md`.

## Asset provenance

`public/assets/salon-hero.jpg` was copied from the supplied `barbarbaba/panel/images/hero-img.jpg`; byte identity verified before deletion. SHA-256: `dc4ba808eb8dfc3140f09d7c9ab4879749780a5f23c21fecb77c24824aa59a07`. Customer deployments should use their approved imagery. No other legacy UI assets or vendor files are required.

## Removal record

Verification and disposition completed before removal. The final pre-removal check rehashed all 220 application files and checked every tree's file count/byte total against the audit. Then `rm -rf --` removed only the three scoped legacy directories. The sole remaining entry is `beauty_saloon_management/studio`. Existing Git staging and unrelated restaurant/CRM applications were left untouched. The prior staged source import therefore appears as added-in-index/deleted-on-disk until the reviewed changes and deletions are staged; no commit was made. Post-removal verification is recorded in `verification.md` and `progress.md`.
