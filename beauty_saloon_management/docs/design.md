# Studio salon CRM and booking MVP

Date: 2026-10-15

## Intent and decisions

Build a polished, usable salon demo that can become a sellable product. The user authorized a free-hand rebuild, maintained Composer dependencies, and fictional data; preserving or migrating legacy records is no longer required. CDM's customer-centric workflow takes precedence over the salon scripts. Legacy source was inspected without execution and retained until the completion pass; it was then removed after standalone verification.

Use a Laravel 13 application in `beauty_saloon_management/studio`, PHP 8.4.1+, SQLite for an easy local demo, standard Eloquent migrations compatible with MySQL, Blade templates, and local CSS/JavaScript. Prefer a modular monolith over separately deployed frontend/API services. The existing alternatives (patching two procedural apps or embedding a general-purpose CRM) add coupling without solving scheduling or billing integrity.

One configurable salon per installation. English demo UI, USD pricing, salon timezone Asia/Jerusalem; all are explicit configuration. This is not a multi-tenant SaaS. Brand the fictional demo “Atelier — Salon & Studio”; cream, ink and charcoal, editorial typography, uncluttered CRM workspace, responsive navigation, accessible forms.

## Customer journey

Public website presents services, prices, team and a booking call to action. Booking chooses one or more services, a qualified stylist, a date and an available start time, then contact details and reminder preference. Server computes prices/durations and checks working hours, time off and overlaps transactionally. Confirmation uses an unguessable reference; public access exposes only that booking's confirmation. Never expose customer search or private histories publicly.

Staff login opens the dashboard: today's agenda, revenue, follow-ups and upcoming appointments. Staff can search/create/update clients, record notes and preferred styles, track service history, and start a repeat booking with the same services/stylist. Rebooking always rechecks availability and current service prices. A day schedule and appointment detail support confirming, completing and cancelling, with validated transitions. Owner can manage the service catalogue, team availability and salon settings. Owners manage accounts; owners/managers manage financial/catalogue/content functions; staff use scheduling, client care and assigned enquiries.

## Data and integrity

Models: User; Client (contact, consent channels, preferred stylist/style and notes); Stylist (bio, services, working weekdays/hours); Service (category, price in minor units, duration); Appointment (client, stylist, UTC start/end, state, public UUID, frozen service prices/durations); AppointmentItem; ClientNote; Invoice and InvoiceItem (snapshots, unique number, currency, tax, amounts); Payment (method, amount, reference); Reminder (channel, scheduled time, status, preview body, attempts); TimeOff; FollowUp.

Bookings lock a stylist row before checking overlap, and use a transaction so only one conflicting booking wins. SQLite serializes the critical write transaction through an initial lock-acquiring update. Active confirmed appointments reserve time; cancelled/completed appointments cannot be edited into conflicting future slots. Staff availability uses salon-local time; database instants use UTC. Reject past dates, invalid/inactive services and out-of-hours slots. Catalogue and staff records are deactivated rather than deleting historical references.

An appointment can be invoiced once. Invoice totals use integer minor units and stored item snapshots. Historical invoices do not change with catalogue edits. Record payment only through a staff action; protect duplicate payment recording transactionally. Receipt exists only after full recorded payment. PDF generation uses a maintained library; printable HTML is available as well. Documents are demo business documents, not a claimed jurisdiction-certified fiscal system.

## Reminders and payment preparation

Create a database outbox for email, SMS and WhatsApp reminders. Only explicitly selected/consented channels are eligible. Preview mode is the default: processing due reminders records a simulated result with no external network delivery. Cancelled/rescheduled appointments suppress stale reminders. A command and Laravel scheduler hook make future cron integration straightforward. Retries must not duplicate already processed messages. Email can later use Laravel mail transport; SMS/WhatsApp require separately configured providers/templates before delivery is enabled.

Prepare a payment gateway contract and a disabled Stripe adapter/checkout configuration. The demo supports recorded cash/card/transfer payments, clearly distinguished from online collection. No live keys, no charges and no implied successful Stripe payment. Future Stripe Checkout must use server-side invoice totals and signature-verified, idempotent webhooks; redirects cannot mark invoices paid.

## Demo safety and scope

Seed realistic fictional clients, stylists, services, appointments, history, styles, invoices and follow-ups. Dates are relative to the seed date. Demo account credentials are configured/generated locally and documented; demo access is gated by explicit demo mode. Outbound communications stay simulated. Serve only `studio/public`, never the legacy directories or SQL dumps. Source SQL, credentials and runtime data are not public assets. Reset is CLI-only and requires explicit destructive confirmation; ordinary startup is non-destructive.

Deferred: live messaging, live payment collection, multi-tenancy, multi-warehouse operations, payroll payouts, fiscal certification, customer accounts and automatic legacy imports. Retail stock, memberships, sales reporting, enquiry pipeline, roles and backups were included in the completion pass. Legacy implementation mechanisms without further product value were explicitly retired.

## Acceptance

Walk through website → available booking → CRM/client history → preferred style → repeat booking → completed visit → invoice PDF → recorded payment/receipt → reminder preview. Verify authorization, request validation/CSRF, overlap prevention, server-side totals, invoice snapshots, payment idempotency, reminder consent/cancellation and responsive browser behavior. Ship setup/run instructions, locked dependencies, tests and known deployment limits.

## Completion pass — 15 October 2026

The user authorized migration of every useful remaining legacy workflow and removal after verification, with full implementation discretion. Studio remains one salon product. Use a neutral warm-white/charcoal/gray visual palette throughout the website, workspace and documents.

Retain these concepts: retail products with atomic stock movements and paid checkout; dated membership plans/enrolments/renewals with snapshotted benefits (no inferred unlimited-service entitlement or automatic charging); an assigned, auditable sales pipeline for packages and group enquiries with private supporting documents; explicit marketing consent, birthday/anniversary campaigns and newsletter previews; editable plain-text website content; owner/manager/staff roles; date-filtered paid sales and frozen service commissions; private SQLite/database-and-upload backups.

Prices and totals are server-authoritative integer cents. Retail checkout and membership enrolment use an idempotent shared invoice service, then record a manual payment. Inventory cannot become negative. Renewals create history; benefits and dates are frozen. Commission applies only to the service subtotal, excludes tax, and is recognized when paid. Sales stages retain their original business meanings with append-only history; staff only access assigned opportunities. No real messages or payments are sent.

Discard unsafe implementation mechanisms: arbitrary database admin endpoints, PHP file queues, embedded SMTP credentials, interpolated SQL, duplicated vendor trees and legacy dashboards. Record complete source disposition, run fresh standalone setup and full verification, then delete only Database, barbarbaba and cdm beside studio. Existing repository staging and unrelated apps remain untouched.
