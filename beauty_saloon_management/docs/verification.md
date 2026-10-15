# Studio verification

Date: 2026-10-15. PHP 8.4.26, Laravel 13.36, SQLite. **Post-removal full suite: 88 tests / 546 assertions passed** in 20.96 seconds. Only `studio` remains in `beauty_saloon_management`.

## Automated checks

- Booking: server prices/durations, stylist qualifications, hours/time off, overlapping and adjacent visits, cancellations/reschedules, past/future constraints and repeat-service fidelity. Two independent PHP workers verify one conflicting SQLite booking succeeds and the other is rejected.
- Billing/commerce: immutable snapshots, quantity/tax totals, invoice/payment idempotency, private PDF access, receipt eligibility, inventory rollback, negative-stock prevention, duplicate checkout, membership overlap/expiry/renewal history, plan changes and demo-seed preservation. A rendered-document regression verifies 3 × $12.50 produces a $37.50 line amount.
- Permissions: owner/manager/staff gates, disabled accounts/sessions, password confirmation/current-password checks, role mass-assignment rejection, own-account safeguards and manager relationships.
- Pipeline: assignment-scoped views/writes/exports/files, sequential/chronological stage transitions, same-client paid-invoice closure, cancellation/reopening with preserved history, inactive-assignee recovery, private PDF/raster files, CSV formula escaping, segment/date filters and idempotent fixtures.
- Communications/content: independent reminder/marketing permission, annual occasion deduplication, fresh consent/contact checks, stale suppression, newsletter opt-out, throttling, escaped content, CLI saved branding and preserving opt-outs during seeding.
- Reporting/operations: local payment-date boundaries, currency separation, quantity aggregation, same-name stylist attribution, safe exports, readable backup snapshots/uploads, and failed directory/copy/manifest writes returning failure with cleanup.
- Existing booking/reminder/source-photo/client tests remain in the suite. Tests use isolated databases rather than the local demo.

PHP syntax passed for 100 application/config/migration/test files. Pint, JS syntax, Prettier asset checks, Blade view compilation, Composer validation/platform requirements and route registration passed. There are 78 application routes. Composer audit and npm audit reported no known vulnerabilities. Scheduler lists appointment previews every minute and outreach hourly; no OS cron was installed.

## Independent review

Two review rounds covered first-phase scheduling/reminders and completion-pass authorization, finance, inventory, pipeline, uploads, content, backup and runtime boundaries. All material findings were fixed. Completion-pass regressions cover false-return backup writes, inactive-assignee reopening, duplicate stylist names and the PHP 8.4.1 minimum required by the lockfile. Actual PDF inspection additionally caught and corrected a unit-price versus line-total display error. The reviewer confirmed the final PDF correction and Composer validation.

## Standalone installation and removal gate

A fresh copy at `/tmp/studio-standalone-l2fiy85u/studio` started without `.env`, a database, installed dependencies, private files or any legacy directory. `composer install` installed locked packages; `composer run setup` generated the environment/key, ran all migrations and seeded all features. The full 88-test suite passed with 545 assertions; the final PDF regression subsequently passed there as part of 6 foundation tests / 25 assertions. Its backup SHA-256 matched the manifest and SQLite `integrity_check` returned `ok`.

Fresh demo counts: one owner, 28 clients, 36 appointments, three products, one membership, eight enquiries and two subscribers. Ordinary repeat setup is tested to preserve edits and counts.

The final source scan found no old-folder/SQL/repository-absolute dependencies in executable source, configuration, routes, views, assets or setup scripts. Before deletion, all 220 source hashes and all three tree counts/byte totals were rechecked against `legacy-inventory.json`. Only then were `Database`, `barbarbaba` and `cdm` removed. The entire suite passed again after removal. The original Git index was not changed.

## Browser and documents

- Public website and staff workspace inspected in the new neutral palette.
- Original booking → client style memory → repeat booking flow verified in the initial pass; retained tests remain green.
- Actual retail checkout: Taylor Demo purchased two $18 brushes; invoice INV-2026-00031 and receipt RCT-00031 show $36, with stock reduced.
- Actual membership enrolment: Taylor Demo purchased a 30-day Care Circle term; invoice INV-2026-00032 is paid and the term remains in history.
- Enquiry board and its seeded stages render with filters; no browser console errors observed.
- At 390 × 844, navigation opens and reaches Outreach; content overflow was fixed and measured document width stayed within the viewport. Two due occasion previews were simulated and the UI reported zero pending, with no sends.
- The previous native-dialog verification limitation is resolved: the accessible HTML confirmation opened, Confirm recorded fictional invoice INV-2026-00024 as paid, and its receipt link appeared.
- Authenticated invoice/receipt downloads returned real PDFs. Poppler extracted correct quantity/line/subtotal/total values; the neutral receipt was rendered and inspected with no clipping.

Screenshots in `screenshots/` include the neutral website, pipeline, retail invoice and mobile outreach. Walkthrough records remain in the local fictional demo.

## Limits of verification

This is local SQLite verification, not production load testing or MySQL concurrency certification. Messages stay simulated; Stripe is disabled. No claim of a real provider delivery, card charge, hosted backup service or fiscal certification is made. Production deployment work is listed in README.md.
