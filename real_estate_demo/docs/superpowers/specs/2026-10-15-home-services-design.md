# Haven: home-services marketplace demo

## Purpose and approved direction

Build a working portfolio demonstration based on the supplied Upwork posting.
This is one of several demos intended for a future Upwork service describing
the kinds of products the operator can build. All people and activity are
fictional; the project is presented as a purpose-built demonstration.

The operator selected a working Laravel demo with real workflows, authorized
Laravel installation and execution inside `real_estate_demo`, and requested
styling inspired by Apple's Glass theme.

Create the standalone application in `real_estate_demo/marketplace`. The legacy
`Real-Estate` folder is reference material only. Keep all work inside
`real_estate_demo`; Git remains read-only. Existing databases and sibling
applications are outside scope. The operator retains control of commits.

**Haven** is a working product name. English, USD, and a fictional US service
area are presentation defaults that can be changed without changing workflows.

## Stack and runtime

- PHP 8.4 and Laravel 13; the installed framework is 13.36.0.
- Blade, Tailwind, and small progressive-enhancement JavaScript modules.
  Add Livewire only where an interaction needs it; ordinary forms are sufficient
  for the first workflow implementation.
- Dedicated SQLite file inside this application for local demonstration,
  in-memory SQLite for tests, and a schema portable to MySQL.
- Laravel password hashing, session authentication, validation, policies,
  Eloquent relationships, transactions and feature tests.
- No external payment, email, SMS or push service enabled by default.
- Only `public/` is a web root. First delivery runs locally and includes setup
  and deployment documentation. Publishing to an external host is separate.

Installation skips Composer scripts so it cannot silently run Artisan or touch a
database. Application initialization and tests that access a database must stay
within the operator's command approval rules; no existing database is used.

## Coverage of the Upwork posting

| Requirement | What the demo demonstrates |
| --- | --- |
| Customer registration/login | Real registration, hashed passwords, login/logout and customer dashboard |
| Provider registration/profiles | Onboarding, biography, services, service area, profile and approval |
| Service categories | Public browsing plus admin category management |
| Job/service requests | Customer creates and tracks category, scope, location, budget and preferred date |
| Photo upload | Validated image upload, previews and authorized retrieval |
| Receiving/responding to opportunities | Approved providers see open requests in their categories and service area |
| Quotes/proposals | Price, availability and scope; customer compares and accepts one |
| Messaging | Private request-specific conversation with each quoting provider |
| Job tracking | Open, booked, in progress, awaiting confirmation, completed or cancelled |
| Ratings/reviews | One customer review of the hired provider after completion |
| Notifications | Persistent in-app notifications for matching opportunities, quotes, messages and status changes |
| Basic payments | Clearly labelled simulated checkout and receipt; no real charge or card collection |
| Admin dashboard | Operational metrics, provider approval/suspension, categories and job oversight |
| Responsive platform | Desktop, tablet and phone layouts for all three roles |

Payment simulation is a deliberate limitation of the portfolio demo. A live
integration, payouts, identity verification, taxes, refunds and disputes require
a separately agreed payment model. A simulated payment must never be described
as a processed charge. Native mobile apps are outside this first version.

## Glass-inspired visual design

Use Liquid Glass cues for the navigation and floating-control layer:
translucency, backdrop blur, fine bright borders, subtle inset highlights, soft
shadows and rounded shapes. Dense content, tables and form fields sit on quiet,
near-opaque surfaces for readability.

Use a warm off-white canvas, dark ink typography, blue primary actions, restrained
peach/lavender ambient color, generous spacing, consistent line icons and
home-service imagery with known provenance. The landing page has an editorial
hero and strong category discovery; signed-in pages emphasize the next action.

Glass effects are selective, not applied to every box. This follows Apple's
distinction between navigation/control materials and content:
https://developer.apple.com/design/human-interface-guidelines/materials

Mobile navigation must remain usable without horizontal overflow. Include
keyboard focus, visible field labels, inline errors, preserved form values,
non-color status indicators, reduced-motion support and opaque fallbacks when
backdrop filters are unavailable. Use a discreet persistent demo notice and clear
payment wording instead of filling product screens with implementation details.

## Customer journey

Browse categories and public professional profiles. Register or enter the
allowlisted demo customer account. Post a request with title, description,
category, city/service area, private street address, desired date, optional
budget and up to five photos.

Compare proposals, message a professional and hire one. Follow the job timeline,
confirm completion, try the simulated checkout and leave a rating and review.

## Professional journey

Register as a provider and complete a profile with services and service area.
An administrator approves the profile before it can receive opportunities and
submit quotes. Seeded demo professionals are already approved.

Browse matching open requests, inspect authorized photos and submit a proposal
with price, availability and scope. Read and respond to the associated customer
conversation. Start booked work, then request customer confirmation when done.

## Administrator journey

See metrics derived from real demo records and recent operational activity.
Approve or suspend providers, create/update/deactivate categories and inspect
jobs and their activity. Do not provide destructive bulk operations.

Protect the three seeded demo-entry identities from suspension or credential
changes that would prevent visitors from exploring the demo. Administration is
separate from the customer and professional interfaces.

## Workflow rules

1. Only customers create requests. The owner may edit an open request before it
   receives any quotes, or cancel an open/booked request.
2. Only approved, active providers can quote an open request in a category and
   service area they offer. A provider cannot quote their own request.
3. There is one proposal per provider/request. Pending proposals can be updated
   before selection; an accepted proposal's price and scope are immutable.
4. Accepting a quote locks the request in a transaction, verifies current state
   and provider eligibility, selects exactly one quote, closes competing quotes
   and changes the job to booked. Stale or duplicate submissions cannot select a
   second provider or change an existing agreement.
5. The hired provider performs booked -> in_progress -> awaiting_confirmation.
   The customer performs awaiting_confirmation -> completed. No skipped states.
   Cancellation after work starts is outside this first demo.
6. A conversation belongs to one request and one provider. Only the customer and
   that provider can read/send its messages. Competing providers cannot read one
   another's quotes or conversations.
7. Eligible providers see city/area, request details and photos for open
   opportunities. Only the hired provider sees the customer's street address
   and contact details. Other customers cannot access these requests.
8. Only the customer pays for a completed job. Simulated payment uses the accepted
   quote's amount, never a posted total. Repeated checkout returns the existing
   receipt rather than creating another payment.
9. Only the customer of a completed request can review its hired provider, once.
   Public rating averages and counts are computed from submitted reviews.
10. Notifications belong to their recipient; reading them or following their
    links must preserve underlying record permissions.
11. Suspending a provider prevents new proposals and provider state transitions.
    Historical agreements, messages and receipts remain visible to participants.
    Administration can restore the provider.
12. Deactivating a category prevents new selection while retaining historical
    requests and their labels/relationships.

## Data and validation

Core records: User (customer/provider/admin), ProviderProfile, Category,
provider-category membership, ServiceRequest, RequestPhoto, Quote, Message,
JobEvent, Review, Payment and database notifications.

Use foreign keys and unique constraints for relationships and uniqueness.
Service area is selected from Austin, Round Rock or Cedar Park in the demo;
matching uses these canonical choices rather than geocoding or free-text equality.
Money is integer cents with one configured currency. Avoid floating-point
conversion of entered prices. Store timestamps consistently and format for the
chosen demo locale.

Validate title length (120 characters), descriptions/scopes (5,000), messages
(2,000), budgets from zero to 100,000 dollars, quote amounts (at least 1 dollar, at most 100,000
dollars), today-or-later dates for new requests/proposals and integer review ratings from 1 to 5.
Accept at most two decimal places for prices. Reject user-supplied roles or
ownership fields that would grant additional privileges.

Accept JPEG, PNG and WebP photos, maximum 5 MiB per image and five per request.
Validate actual image content and dimensions up to 4096 by 4096, use generated filenames,
store on a private disk and serve through an authorized route. Never accept SVG
or executable content. Clean up files if a submission fails after storage.

Escape user text in Blade. Use CSRF protection, rate-limited login/session
regeneration, and server-side authorization for every mutation and private read.
Preserve valid input on errors and make stale-state errors understandable.

## Demo content and entry

Provide six categories: cleaning, plumbing, electrical, painting, gardening and
handyman work. Supply fictional professionals, meaningful profiles and jobs at
different stages. Include an open customer request with competing quotes, an
active job, and a completed job with a review and simulated receipt. Dashboard
metrics must agree with the underlying records.

An explicit demo flag enables customer, professional and admin entry using only
three allowlisted seeded identities. It never accepts arbitrary user IDs.
Normal registration/login remains available.

The initial demo shares its seeded dataset across browser sessions, so one
visitor's actions may be visible to others. Per-visitor dataset isolation is
outside this version and the hosting guide must explain that behavior.

Setup targets an empty dedicated database and refuses to overwrite populated
data. Reset is an operator action, never a public web endpoint. Credentials,
database files, uploads, caches and dependencies stay out of Git.

## Verification and completion

Write meaningful feature tests for registration/roles, photo validation/access,
provider approval, matching and quoting, quote acceptance, job transitions,
conversation privacy, payment idempotency, review eligibility and notification
ownership. Include forged IDs, tampered totals, stale/duplicate actions and
suspended providers. Tests use only a dedicated isolated test database within
the operator's approved execution scope.

Browser verification must cover the complete three-role journey, photo upload,
validation recovery, mobile and desktop layouts, keyboard focus, reduced-motion
behavior and console/network errors. All visible action controls must work or
clearly explain why unavailable.

Delivery includes source, dependency locks, setup instructions, demo entry
instructions, a feature matrix and honest integration limitations. The demo is
complete when the main journey persists across role changes, required screens
are usable on desktop and phone, and the relevant checks pass.

## Implementation order

1. Identity, roles, schema and repeatable fictional fixtures.
2. Public discovery, professional profiles and request/photo creation.
3. Matching, quoting, acceptance and private messaging.
4. Job progress, reviews, notifications and simulated payment.
5. Administration, final Glass styling and responsive refinement.
6. Workflow tests, browser walkthrough and operator documentation.

Each stage is part of the same deliverable, not a separate approval request.


## Legacy retirement (operator clarification, 2026-10-15)

The operator requested an explicit record of the old files so they can be removed
after reference use is complete. The inventory at
`real_estate_demo/docs/legacy-source-inventory.json` records all 171 original
files (7,021,418 bytes), including relative paths, sizes and SHA-256 hashes.

After the new marketplace passes standalone workflow, build and browser checks,
verify that the legacy tree still matches that inventory, make and verify an
ignored local recovery archive, and remove only
`real_estate_demo/Real-Estate`. Repeat standalone checks after removal.
Stop cleanup for review if the original tree has acquired changed, new, missing
or symlinked files. Retain the manifest and verification record; no legacy PHP,
SQL, scripts, styles, fonts or images may remain as runtime dependencies.


## Approved operator addendum: InfinityFree public demo (2026-10-15)

Target the existing https://demo-sites.infinityfree.me/ hosting arrangement in its own subdirectory (suggested home-services-demo). Retain writable local workflows. Hosted MODE=demo (lowercase mode=demo and APP_ENV=demo accepted) blocks database mutations with a connection-level beforeExecuting hook and blocks HTTP writes before uploads. Session-only login/logout and allowlisted role switching remain available; do not rehash passwords or update remember tokens in read-only mode. All listed Upwork screens remain inspectable using seeded records at multiple workflow stages. Use file sessions/cache with a distinct Haven cookie and scoped cookie path, synchronous in-app notifications, prebuilt assets and a protected private application directory. Prepare deployment files and a MySQL schema/fixture import artifact locally; do not access the hosting database or publish without the required approval.
