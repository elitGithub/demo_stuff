# Atelier Studio

A salon website and staff workspace built with Laravel 13, PHP 8.3+, Blade and SQLite. One independent application with a neutral warm-white/charcoal palette, fictional demo data and owner/manager/staff access.

## Run the demo

```bash
cd /var/www/demo_stuff/beauty_saloon_management/studio
composer dev
```

Open **http://127.0.0.1:8088/** for the website, or **http://127.0.0.1:8088/login** and choose **Explore the demo** for the owner workspace. The local server may already be running. Starting it never resets data.

## Fresh installation

Install PHP **8.3 or newer** with SQLite/PDO, XML/DOM, fileinfo, OpenSSL and the usual Laravel extensions; Composer 2 is required. Verified with PHP 8.3.35 and PHP 8.4.26. Composer is locked against PHP 8.3 for shared-host compatibility. No Node installation or frontend build is needed to run Studio.

```bash
composer run setup
composer dev
```

Setup creates `.env` only if missing, enables demo mode in that new environment, installs locked dependencies, creates SQLite, migrates and seeds an empty installation. It preserves existing keys, records and edits. An existing `.env` must explicitly contain `STUDIO_DEMO=true` for demo preparation.

The seeder generates an owner password in the Git-ignored `storage/app/private/demo-credentials.json` with owner-only permissions. The demo login is gated by `STUDIO_DEMO`; email/password login also works. Shared demo access is for fictional data only. Set `STUDIO_PUBLIC_DEMO=true` to make a public installation browse-only: login/logout and viewing remain available, while bookings, uploads, edits, payments and newsletter submissions are rejected. The local setup leaves this flag off.

## Features

| Area | Working behavior |
| --- | --- |
| Scheduling | Public/staff booking, qualified stylists, combined service duration, real availability, time off, rescheduling and visit lifecycle. Day calendar and list. |
| Client care | Search, contact/company/segment, private notes and style photos, favourite services/stylist, service history, repeat booking and follow-ups. |
| Reminders | Consent-aware email/SMS/WhatsApp outbox. Appointment changes reconcile pending reminders; due processing simulates delivery once. |
| Billing | Frozen invoices and PDF receipts for completed visits, retail and memberships. Manual cash/card-at-studio/transfer recording; retry protection and quantity totals. |
| Retail | Separate product catalogue, stock adjustments with reasons/history, multi-item checkout and transactional stock/payment updates. Negative stock is rejected. |
| Memberships | Editable plans, purchased benefit/price/duration snapshots, expiry and renewal history. No automatic renewal, charging or service-credit redemption. Benefits are fulfilled manually. |
| Enquiries | Assigned CDM-style pipeline from lead through delivery/closed, plus cancellation and audited reopening. References, next actions, dates, private documents, filters and safe CSV exports. Closing needs a paid invoice for that client. |
| Sales reporting | Paid-date filters in the studio timezone, currency-specific totals, popular items, frozen service commissions per stylist and CSV. Commission excludes tax and retail/memberships. |
| Outreach | Separate marketing consent, birthday/anniversary previews, newsletter audience/composition and opt-out links. Everything remains simulated. |
| Website | Shared catalogue/team/booking plus editable plain-text brand, hero/about/contact content and newsletter signup. |
| Access | Owners administer accounts; managers run the business; staff handle appointments, clients and assigned enquiries. Disabled accounts lose access. Self-service profile/password changes require the current password. |
| Operations | Non-destructive setup, locked dependencies, private SQLite/upload backups, tests and scheduler entries. |
| Online payment preparation | Disabled PaymentGateway/StripeGateway boundary. Provider connection and verified webhooks are still required; no online charges occur. |

Money is integer minor units; the current model uses two-decimal currencies. Appointment timestamps are UTC and display in the configured timezone. Prices, availability, consent and access are checked on the server.

## Demo walkthrough

1. Book **Lived-in colour** on the public website. The form selects a qualified colour specialist.
2. Enter the workspace, save the client's favourite style/photo and a note, then **Book again** from visit history.
3. Open a completed seeded visit, generate/view its invoice, record a fictional payment and download the receipt.
4. Open **Retail & stock**, choose a client and quantities, then record a paid sale. Inspect the invoice and stock movement.
5. Open **Memberships**, enrol a client or renew a term. The previous term and its benefits remain unchanged.
6. Open **Enquiries**, inspect the eight seeded stages, advance an enquiry, add a private document and filter due actions. A paid same-client invoice is required to close it.
7. Open **Outreach**, simulate the seeded occasion previews or compose a newsletter preview. Nothing is sent.
8. Open **Sales reports**, **Website content**, **Team** (commission settings) and **Staff access** to demonstrate business administration.

Fresh fixtures include four stylists, eight services, 28 clients, 36 visits, three retail products, two membership plans, one purchased membership, eight enquiries and two newsletter subscribers. Local walkthrough records remain editable. To add the new module fixtures to an older Studio demo without resetting it:

```bash
php artisan db:seed --class=CommerceSeeder
php artisan db:seed --class=PipelineSeeder
php artisan db:seed --class=OutreachSeeder
```

These seeders are demo-gated and idempotent.

## Configuration and verification

Website branding/contact text can be edited in the workspace. Timezone, currency, tax percentage and demo mode are installation settings in `.env`/`config/studio.php`; clear the config cache after changing them. Set commission percentages on the Team screen before issuing new service invoices. Existing snapshots are not recalculated.

```bash
php artisan test --compact
vendor/bin/pint --dirty --format agent
php artisan reminders:process   # preview only
php artisan outreach:process    # preview only
php artisan schedule:list
php artisan studio:backup
```

Optional asset formatting: `npm ci`, then `npm run format:check`. Reminder processing is scheduled every minute and outreach hourly, both with overlap prevention. No operating-system cron entry has been installed.

## Backups

`studio:backup` creates a restricted directory under `storage/app/private/backups/`, containing a consistent SQLite snapshot, private style/pipeline uploads, and a manifest with the database SHA-256. It excludes `.env` and demo credentials. Failed writes return failure and clean up incomplete output. Stop web/worker writes while taking a backup if database/upload consistency is required; the command does not pause the application. For other database engines, use provider-native backup tooling.

To restore a selected backup: stop the server/workers, retain a copy of the current database/uploads, verify the manifest hash and SQLite integrity, replace the configured SQLite file with the snapshot and restore its `files/styles` and `files/pipeline` directories into private storage. Restore the deployment's separately secured environment/key, then restart. Verify the process in an isolated copy before restoring a customer installation. The application's tests and standalone check verify readable snapshots and upload inclusion, not a hosted disaster-recovery service.

## Deployment boundary

This is a one-salon demo/MVP. Before onboarding a paying customer, configure HTTPS, `APP_DEBUG=false`, private keys, a web root pointing only to `studio/public`, production accounts, monitoring/backups and retention procedures. Disable shared demo access. Owner password resets are available in Staff access; email-based recovery is not connected. SQLite has been verified; validate migrations/concurrency against any alternate production database.

Live messaging needs provider adapters, delivery feedback and retry policies. Stripe needs server-created checkout, signed webhooks, reconciliation and refunds. A card payment recorded here represents payment already received at the studio. Deposits, partial payments, refund workflows, payroll payouts, multiple locations and multi-tenant SaaS are follow-on work. Review fiscal document/tax requirements for the deployment jurisdiction.

## Legacy disposition

The supplied `Database`, `barbarbaba` and `cdm` directories were removed **after** their useful workflows were migrated, independently reviewed and verified in a fresh standalone Studio installation. Only `studio` remains under `beauty_saloon_management`. No old customer data or credentials were imported. The file hashes, source map and decisions remain in [the audit](docs/legacy-audit.md) and `docs/legacy-inventory.json`.

The hero photo was copied from the provided source before deletion; see the audit for its provenance/hash. Use the customer's approved imagery for deployment. All other UI styling and icons are local Studio code. Package versions/licenses are recorded in Composer/npm lockfiles.

See [verification evidence](docs/verification.md).
