# Studio Implementation Plan

> Execute inline using superpowers:executing-plans. The user granted architecture and implementation discretion; proceed continuously and review the working result.

**Goal:** Deliver a runnable salon website and CRM covering all six requested capabilities.

**Architecture:** One Laravel application, shared relational domain, Blade views, dedicated booking/billing/reminder services. Keep the legacy projects as reference and create an independent runtime.

**Tech Stack:** PHP 8.4.1+, Laravel 13, SQLite/MySQL migrations, Blade, local CSS/JS, Dompdf.

**Spec:** `design.md`.

## Global constraints

- Work only in the new studio application and these project docs; preserve unrelated staged edits.
- Fictional demo data; no legacy import and no outbound messages or payment collection.
- Server-side money and availability checks; all staff mutation routes require authentication and CSRF.
- No automatic reset or destructive migration on ordinary startup.

## Review focus

1. Two bookings for the same stylist/time must not both succeed.
2. Malicious submitted totals/service IDs must not alter authoritative pricing.
3. Public routes must not reveal a client's existing private record.
4. Invoice/payment retries must not create duplicate invoices/receipts.
5. Rescheduling, cancellation and consent changes must suppress stale reminders.

### Task 1: Foundation and booking domain

Files: `studio/composer.json`, `database/migrations/*`, `app/Models/*`, `app/Services/BookingService.php`, `tests/Feature/BookingTest.php`.

Produces: models for Client, Stylist, Service, Appointment/AppointmentItem, TimeOff; `BookingService::slots(Stylist, array $serviceIds, string $date): array` and `book(array $data): Appointment`.

- [x] Scaffold Laravel and install locked dependencies; run baseline tests.
- [x] Write and run failing tests for booking, overlap, off-hours, price tampering and invalid services.
- [x] Implement database constraints and transactional scheduling, including server snapshots and UTC conversion.
- [x] Run `php artisan test --filter=BookingTest` and inspect each assertion.

### Task 2: Billing and communications

Files: `app/Services/BillingService.php`, `app/Services/ReminderService.php`, `app/Payments/*`, `routes/console.php`, `tests/Feature/BillingTest.php`, `tests/Feature/ReminderTest.php`.

Consumes appointment snapshots. Produces `BillingService::issue(Appointment): Invoice`, `pay(Invoice, string $method): Payment`, and `ReminderService::processDue(): int`. Stripe adapter is disabled with explicit status.

- [x] Write failing tests for stable invoice totals, repeat issue/pay, cancelled booking reminders and simulated dispatch.
- [x] Implement invoice/payment transactions, snapshots, numbering and receipt state.
- [x] Implement consent-aware outbox planning and due processing; add `reminders:process` scheduler entry.
- [x] Run targeted billing/reminder tests and verify no outbound delivery.

### Task 3: Website, CRM and demo data

Files: `routes/web.php`, `app/Http/Controllers/*`, `resources/views/*`, `public/assets/*`, `database/seeders/DatabaseSeeder.php`, `config/studio.php`, `tests/Feature/WorkspaceTest.php`.

Consumes domain services; public routes use booking validation and staff routes share authentication. Produces working public website, booking wizard, dashboard, schedule, clients/styles/history/follow-ups, services/team, reminders, invoices/receipts and settings status.

- [x] Write failing authorization, page rendering and booking-to-invoice workflow tests.
- [x] Build responsive shared layouts and server-backed forms, with clear validation feedback.
- [x] Seed useful fictional records and a gated demo login; never reseed during normal server startup.
- [x] Run feature suite; verify desktop flow and responsive layouts; record the browser-dialog interaction limitation.

### Task 4: Review, run instructions and handoff

Files: `studio/README.md`, `studio/bin/setup-demo.sh` and Composer dev script, this directory's `progress.md`.

- [x] Run full tests, syntax/style checks, dependency audit and route/view compilation.
- [x] Request one independent code/security review against the spec and new source tree; address material findings with regression tests.
- [x] Document startup, demo credentials, outbound simulation, PDF generation, payment boundary and deferred production work.
- [x] Start local demo, open website/workspace and provide verified URLs and test evidence.

## Completion pass

User instruction to continue with a free hand supplies approval for implementation and verified legacy removal. Continue in the existing Studio workspace; do not disturb the repository's staged legacy import or other projects.

### Task 5: Shared billing, permissions, reports and operations (primary)

Files: BillingService, Invoice/User/Client models, business foundation migration, access middleware, AccessController, ReportController, Backup command, shared routes/layout, factories/seeder, Billing/Access/Report/Backup tests.

Interface: `BillingService::issueStandalone(Client $client, array $lines, string $kind, string $idempotencyKey): Invoice`, where lines are trusted server catalogue snapshots `{name:string,price:int,quantity:int}` and kind is retail/membership. Existing issue/pay interfaces remain. Invoice appointment_id becomes nullable; kind and unique nullable idempotency_key are added. Service invoices freeze stylist_name, commission_rate and commission_amount. User has role owner/manager/staff, active bool, nullable manager_id; `User::isManager(): bool`. Gate `manage-studio` allows active owners/managers. Shared Client gains birthday, anniversary, marketing_channels JSON, segment b2c/b2b/b2g and company. Foundation migration filename sorts before feature migrations.

- [x] Add tests for standalone invoice snapshots/idempotence/quantity totals, historical commissions, role denial/inactive session, financial report date boundaries and backup integrity; observe missing behavior.
- [x] Implement interfaces and shared integration. Keep invoices/payments manager-only, scheduling/client care available to staff, and user administration owner-only. Managers cannot promote themselves.
- [x] Verify targeted tests, neutral design and existing workflows.

### Task 6: Retail and memberships (independent commerce task)

Files: Product/StockMovement/MembershipPlan/Membership models, commerce migration/service/controller, routes/commerce.php, views/commerce, CommerceSeeder and CommerceTest. Consumes the shared billing interface; route file is required within authenticated /app group. Catalogue and sales access requires manage-studio. Test authoritative prices, multi-item quantity, insufficient stock rollback, duplicate checkout, membership dates and renewal snapshots. Produce working forms and fictional demo records.

- [x] Inspect legacy plan/stock handlers; write failing behavioral tests.
- [x] Implement separate product inventory and paid membership history without automatic charge or ambiguous entitlements.
- [x] Run commerce tests and report integration contracts.

### Task 7: CDM enquiry pipeline (independent pipeline task)

Files: Opportunity/OpportunityEvent models, pipeline migration/service/controller, routes/pipeline.php, views/pipeline, PipelineSeeder and PipelineTest. Consumes User::isManager and Client segment/company. Routes required inside authenticated /app. Preserve lead/engagement/proposal/order/payment/delivery/closed/cancelled stages, references, next action and append-only transitions. Scope staff to assigned records; managers can assign active users. Private PDF/image documents are validated and access-controlled. Closed requires a paid linked invoice belonging to the same client. Exports escape formula prefixes and respect assignment scope.

- [x] Inspect all CDM stage/assignment/export handlers; write failing transition/access/export/upload tests.
- [x] Implement board/detail/forms/history and private documents with seeded enquiries.
- [x] Run pipeline tests and report integration contracts.

### Task 8: Marketing and website content (independent outreach task)

Files: MarketingMessage/Subscriber/StudioSetting models, outreach migration/service/controllers/command/middleware, routes/outreach.php, views/outreach, public home/layout, ClientController and client show view, OutreachSeeder and OutreachTest. Root owns Client model/shared fields. Marketing consent differs from appointment consent. Birthday/anniversary due generation deduplicates per year and rechecks consent before simulation; newsletter signup and token unsubscribe are throttled and never send real messages. Website content is escaped plain text; middleware loads allowlisted saved config values. All admin mutations require manage-studio.

- [x] Inspect birthday/newsletter/content handlers; write failing consent/deduplication/unsubscribe/escaping tests.
- [x] Implement visible preview outbox, editable content and client consent/date fields.
- [x] Run outreach tests and report integration contracts.

### Task 9: Exhaustive disposition, review and deletion

- [x] Map every remaining first-party legacy file to migrated behavior, replaceable support code or rejected unsafe/duplicate implementation; preserve provenance needed for the copied photo.
- [x] Integrate seeders/routes/middleware/navigation; run full tests, formatting, dependency audits, rendered views, real browser flows and PDF rendering.
- [x] Independent security/correctness review; fix material findings and rerun affected tests.
- [x] Copy only Studio to a temporary standalone location, install locked dependencies and run fresh setup/tests with no legacy files; verify private backup content.
- [x] Record evidence and remove only beauty_saloon_management/{Database,barbarbaba,cdm}; rerun route/test/runtime checks; update README/audit/progress.
