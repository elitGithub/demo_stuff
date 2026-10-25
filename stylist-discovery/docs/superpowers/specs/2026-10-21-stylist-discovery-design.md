# Stylist discovery and booking demo

Date: 2026-10-21

Status: Approved by the operator on 2026-10-21, including the visual preview. The fresh reviewer found one lead-time ambiguity; the clarified request/acceptance rule passed a scoped recheck with no important questions remaining. Implementation requires the separate plan and execution approvals below.

## Purpose

Build a dedicated portfolio demonstration for the SelahDiscovery job posting. A visitor must be able to discover an independent hairstylist, request an appointment, accept it from the stylist's perspective, pay a simulated deposit, and see the confirmed booking and its notifications. Stylist onboarding and basic platform administration complete the demonstration.

This is a fictional portfolio sample, not the prospective client's commissioned application or an implementation of their unseen Figma. Use the approved working brand **Strand & City** and the new directory `/var/www/demo_stuff/stylist-discovery`.

## Decisions made by the operator

- Dedicated demo under a new subdirectory, using Laravel and SQLite.
- Modern glass styling when the posting supplies no definite style guide. The posting mentions an existing Figma but provides neither its contents nor a link.
- Interactive public demo with a separate SQLite database for each visitor.
- Simulated checkout and an internal demo inbox; no external payment or email accounts.
- Stylist accepts a booking request before the client pays the deposit.
- Include a visual preview with this design.
- Full tag-only method docblocks, no prose comments, thin controllers, service-layer workflows and models with useful domain behavior.

The operator's approval selects the defaults below. Command, dependency and execution permissions remain separate.

## Technical foundation and reuse

Use PHP 8.4 and Laravel 13, Blade, locally served CSS and small browser JavaScript modules. SQLite is the only database engine in this demo. Standard Laravel sessions, authentication, hashing, validation, policies and CSRF protection handle their respective concerns. No SPA, Livewire, external component system, map API, workers or realtime service is needed.

Haven supplies useful customer/provider account and authorization patterns. Atelier supplies appointment duration, availability and overlap-prevention concepts. Elsewhere supplies the lesson that the sandbox registry should be an ordinary SQLite database, without custom lock files, inode checks, permission-bit checks, parent-directory walks or staged JSON storage. Existing applications and their databases remain untouched. Adapt relevant behavior to the new code laws rather than copying unrelated modules or their older code conventions.

The implementation plan must specify the generator/scaffolding approach and exact dependency set for approval. The inspected Haven lockfile contains Laravel 13.36.0, Pint 1.32.1 and PHPUnit 12.5.39; these are existing reference versions, not authorization to install or modify packages. Do not add Boost, Tinker, PDF, payment or mail-provider packages just because another demo contains them.

## User journeys

### Enter the demonstration

The landing page explains the fictional sample and presents a clear **Explore demo** action. Entering allocates or resumes the browser's sandbox. Viewing the landing page and static assets allocates no visitor database.

Within the sandbox, a persistent compact role switch offers seeded Client, Stylist and Admin identities. Each switch is a CSRF-protected, rate-limited POST to an allowlisted seeded account in that sandbox. It changes the authenticated identity but preserves the sandbox and its edits. Normal client/stylist registration and password login also work; admin registration is never available. The role switch is explicitly demo-only and never accepts an arbitrary user ID.

Changing roles in another tab must not silently submit an old form as a different person. Bind mutations to the authenticated actor and sandbox generation present when the form loaded; a mismatch requires a refresh. Explain sandbox expiry without exposing bearer tokens or implementation details in product copy.

### Discover a stylist

Search stylists by display/business name and filter by country, city, specialty and service-price range. Show twelve seeded independent stylists across Paris, Lisbon, Barcelona and Berlin, with fictional studios, biographies, services and portfolio imagery. All seed identities and businesses are fictional, and email addresses use `.example`.

Price filtering applies to an active offered service within the selected specialty when one is selected. Starting prices on cards use the same matching service set, so a result never advertises a price that fails the user's filter. Support query-side alphabetical and starting-price ordering. Paginate results in pages of twelve; show accurate filtered totals and helpful empty states. No map, distance calculation, ratings or invented review counts are included.

Public stylist profiles inside the sandbox show city/country, studio-local timezone, biography, specialties, portfolio, services with durations and prices, booking policy and deposit percentage. Services and portfolio lists are bounded and paginated where appropriate. Unpublished or suspended profiles cannot be discovered or booked.

### Request and confirm a booking

One appointment selects one service and one stylist. The client chooses a date and available start time in the stylist's named timezone. The review screen shows service, duration, studio-local date/time and timezone, full price, deposit and remaining amount. Client-side values never determine server amounts or availability.

The flow is:

1. Client sends a request; it appears as **Requested** in both workspaces and produces an inbox notification for the stylist.
2. Stylist accepts or declines. Acceptance rechecks availability atomically and places a **30-minute** hold on the slot, changing the request to **Awaiting deposit**. A decline records a bounded optional explanation and notifies the client.
3. Client chooses a clearly labelled simulated checkout outcome: successful payment or failed payment. Checkout cancellation returns to the booking without changing its status.
4. A successful simulated deposit changes the booking to **Confirmed** and creates one payment record and confirmation messages. A failed attempt leaves the hold usable until its original deadline.
5. After the service end time, the stylist can mark the visit **Completed**. The seeded data includes completed visits so this path is visible immediately.

Requested bookings do not reserve a slot. Multiple clients may request it, but only one overlapping request may be accepted. The interface explains that availability is confirmed when the stylist accepts. A client's identical active request is rejected instead of being duplicated.

Booking states are an enum with `Requested`, `AwaitingDeposit`, `Confirmed`, `Declined`, `Cancelled`, `Expired` and `Completed` cases and visible labels. Requests expire when their appointment would start; an unpaid accepted request expires at the earlier of the payment deadline and appointment start. At the exact expiry boundary, payment is rejected and the slot is available again. Availability and mutation checks enforce expiry even if an old screen has not refreshed. Cleanup of expired statuses is request-driven and idempotent; there is no worker requirement.

Clients may cancel their own upcoming requested, accepted or confirmed bookings; stylists may cancel their own upcoming accepted or confirmed bookings. Cancellation requires a destructive-action confirmation. Cancelling a confirmed booking records a full simulated deposit refund and releases its slot atomically. Cancellation is unavailable after the appointment starts. No partial refunds, cancellation penalties, disputes, payout or remaining-balance collection are included. The remaining balance is explicitly payable at the fictional studio.

Changing service prices, durations or deposit settings never changes an existing request. Store snapshots of the selected service, integer minor-unit prices, duration, deposit percentage, currency, stylist timezone and the agreed booking instants. Use EUR throughout this demo; international discovery does not imply currency conversion. Deposit percentages range from 10 through 100; calculate the deposit in integer cents with one documented rounding rule and derive the remaining balance by subtraction.

### Stylist workspace

The seeded stylist workspace offers upcoming bookings, requests awaiting a decision, a date-selected schedule, services, weekly availability, time off, profile/portfolio settings and deposit settings. Business counts share the same filters and expiry rules as their underlying records.

Normal stylist registration creates a draft profile. The onboarding form collects display/studio name, biography, fictional address, a configured city and timezone, specialties, a first service and weekly availability. Submission moves it to **Pending review**; admin approval publishes it. A published stylist can edit their own content and offerings. The admin can suspend the profile, preventing new requests and acceptances while preserving access to existing booking history, payment, cancellation and completion flows.

The stylist manages active/inactive services with a specialty, price and duration. Deactivation prevents new requests while preserving all existing booking snapshots. Weekly hours use one opening interval per weekday; no overnight or split shifts. Booking intervals use a 15-minute start grid, service durations from 15 to 240 minutes, a two-hour lead time and a 60-day booking horizon when the client first submits the request. The lead time is not restarted at acceptance: the stylist can accept an existing request any time before its start, and the deposit deadline is the earlier of acceptance plus 30 minutes and the appointment start. Acceptance and payment still recheck working hours, time off, overlap and their applicable deadline. Store instants in UTC and use Carbon with the configured IANA timezone for local rules. Reject nonexistent or ambiguous local times rather than selecting an arbitrary DST occurrence.

Time off blocks new bookings. Schedule/timezone edits and time-off creation that would invalidate an accepted or confirmed booking fail with the affected bookings shown; the stylist must first resolve those bookings explicitly. Existing requested bookings are rechecked when accepted. No rescheduling workflow is included in this first demo; clients cancel and request another time.

Portfolio management supports captioned JPEG, PNG and WebP uploads. Validate actual type and decoded dimensions, re-encode using the available PHP image extension, reject SVG/animated/oversize content, remove metadata and serve files through authorized sandbox-aware routes. Seed images are shared immutable application assets; visitor uploads are private to their sandbox. There is no upload-to-public-directory shortcut.

### Client workspace and demo inbox

Clients see their paginated bookings, status, deposit action/deadline, remaining balance, cancellation action and service history. They may register, log in and log out, and update their own display name; full account settings and password recovery are excluded from the demo and documented.

The demo inbox contains recipient-scoped simulated email messages and in-app unread/read state. Request, acceptance, decline, deposit confirmation, expiry, cancellation and simulated refund events produce deterministic, idempotent notifications in the same database transaction as the domain change. Each recipient sees only their own messages. Mark-read is a mutation, and inbox lists paginate. No real email is sent and no contact data is transmitted externally.

### Admin workspace

Admin can review pending stylist applications, approve/suspend profiles, manage specialty availability, and inspect booking status and aggregate counts within the same visitor sandbox. Admin cannot pay deposits or impersonate arbitrary users through request parameters. Admin oversight does not grant access to private inbox contents. Disabling a specialty removes it from new service creation and new discovery/request eligibility while retaining historical data and already accepted or confirmed visits.

## Domain and code boundaries

Models describe relationships, enum/date/money casts, reusable query scopes and local domain predicates such as whether a booking is payable or a stylist is published. Query scopes own database filtering and ordering. Models do not coordinate multi-model workflows, send notifications, resolve request identity or switch sandbox connections.

Services/actions coordinate registration, onboarding, publication, booking creation and transitions, availability, simulated payments/refunds, portfolio storage and sandbox lifecycle. They accept explicit authenticated principals plus readonly input DTOs and return models, typed results or paginators as appropriate. FormRequests validate shape; policies and services enforce ownership, allowed transitions, availability and business rules. Controllers validate, call and respond.

Proposed domain models: User, StylistProfile, Specialty, Service, PortfolioImage, WorkingHours, TimeOff, Booking, Payment and InboxMessage. Use normal relationships/pivots for profile specialties. Separate registry models describe Sandbox, Laravel sessions/cache and operational limits; they explicitly use the registry connection.

Every method, including constructors, model relationships, casts/scopes, request methods, policies and tests, has a complete tag-only docblock with applicable `@param`, `@return` and `@throws` tags. No prose comments or docblock summaries. One declaration per file; enum cases are TitleCase with `label()`. Use explicit types, `?Type` nullables, named DTO arguments, descriptive variables, braces and Carbon. Keep framework-required arrays at framework boundaries; do not pass loose arrays between application layers. Avoid one-use wrappers, one-caller private helpers and defensive fallbacks for guaranteed values. Add Pint configuration that preserves required bare tags and run Pint only on touched files.

## Booking and payment integrity

SQLite needs an actual write lock before reading competing availability. Acceptance and payment begin the critical transaction with a write to the stylist's booking-lock counter, then reload and validate the booking, overlapping holds/confirmed appointments, working hours, time off and deadlines. Do not assume `SELECT FOR UPDATE` provides row locking in SQLite. Database constraints enforce unique business keys and one successful deposit/refund per booking.

Use half-open booking intervals: adjacent appointments may touch; overlapping accepted holds and confirmed bookings may not. Recheck admission and overlap during every state-changing operation. Retrying or double-clicking request, acceptance, payment, refund and notification actions must not create duplicate effects. Failed transactions leave no partial booking/payment/message state. Expired holds cannot be resurrected by a late checkout response. Return useful validation or retryable busy errors without swallowing storage failures.

## Visitor sandbox design

Use one private **registry SQLite database** for sandbox/session/cache/rate-limit metadata, and one separate **visitor SQLite database** for every browser sandbox. A visitor never selects a database through a URL, submitted path, user ID or IP address. Use Laravel's secure session cookie; the server-owned session identifies a cryptographically random sandbox key. Store only a digest/opaque server-owned identifier in the registry. Bind authenticated identity and a sandbox generation to every mutating form.

The middleware order must establish the registry-backed session, resolve a valid sandbox, configure and reconnect the visitor connection, and only then run authentication and route model binding. The default business connection fails closed before resolution. Registry models always use their named registry connection. There is no fallback to another visitor's database or a shared application-data database.

Initial entry is an explicit CSRF-protected POST. Copy a packaged pristine template database into a new random visitor filename, initialize fictional dates relative to allocation time, and publish the sandbox only after initialization succeeds. The template contains only canonical fictional data and random unusable seed passwords; no real sandbox is copied. The deployment package includes an empty initialized registry and pristine visitor template, prepared locally with separately approved database commands. No hosted Artisan or runtime migration is required.

Proposed operational defaults:

| Setting | Proposed value |
| --- | --- |
| Idle lifetime | Four hours; accepted dynamic activity renews it, an idle tab does not |
| Active sandboxes | At most 25; cleanup expired entries before rejecting allocation |
| Visitor database cap | 4 MiB, enforced on each connection through SQLite page limits |
| Visitor upload cap | 8 images total, each at most 1 MiB after re-encoding |
| Record caps | 40 users, 20 stylist profiles, 120 services, 150 bookings, 1,000 inbox messages |
| Allocation limit | 10 new sandboxes per connection IP per hour |
| Entry/login limits | 10 role switches and 5 password attempts per minute |
| SQLite busy timeout | Two seconds; retryable response on timeout |
| Cleanup | Bounded expired-sandbox reclamation during subsequent dynamic requests |

Seed records count toward the caps. Cap enforcement is transactional and returns a clear demo-limit message without evicting another visitor or corrupting existing work. Registry/session/cache records also require bounded expiry cleanup. The plan must quantify registry limits, portfolio pixel limits and file-count/byte overhead before implementation. Avoid a bespoke filesystem quota engine; explicit database and upload bounds provide a conservative deployment budget.

The registry transaction serializes admission/allocation and establishes an activity lease before opening a visitor database. Visitor transactions are separate and short. The plan must prevent cleanup racing a request that has admitted access, and ensure incomplete allocations/failed file deletions remain reclaimable and accounted for. Use SQLite's own locks and transactions, ordinary file creation/copy/deletion in the packaged private storage folder, and a bounded cleanup ledger. No custom lock files, directory walks, permission-bit/inode assumptions or JSON registry.

Expiry immediately prevents further access. A stale open form gets an explicit session-ended state and an action to start fresh; never replay its submission or old record ID into a new sandbox. Logout ends account access but preserves sandbox edits for the idle lifetime. No manual sandbox-reset feature or cross-device recovery is included. Physical cleanup happens on later traffic, so the UI must not promise deletion at the exact expiry time.

Uploads use server-generated flat filenames tied to registry-owned records, with private authorized retrieval. Hosted storage directories ship in the package; runtime code does not walk or create parent directories outside them. Missing configuration/storage fails visibly and logs privately. SQLite rollback journals are used, with foreign keys and busy timeout configured consistently. There is no shared visitor-data store.

## Visual direction and accessibility

The working brand is Strand & City. Use a quiet pearl background, dark ink typography, restrained violet accents, translucent rounded navigation/search surfaces, subtle depth and editorial hairstyle imagery. Glass is selective: forms, long text and booking details retain strong opaque contrast. Use a local/system font stack and original or properly licensed/generated assets recorded in provenance documentation.

The discovery screen places the city/service search above a grid of portfolio-led stylist cards. Mobile uses a single column and an accessible filter disclosure; desktop uses a compact filter rail and a three-column grid. Profile pages prioritize work samples and services, with a clear booking action. Workspaces use a short, consistent navigation and responsive booking cards rather than desktop tables squeezed onto a phone.

The preview is a disposable design artifact, not functioning application code. Its local filter and viewport controls only demonstrate layout. It labels the data and booking actions as a design preview. Source: `docs/mockups/discovery-preview.html`; local viewing URL: `http://127.0.0.1:8094/discovery-preview.html`. The preview uses original vector illustrations; final hairstyle portfolio assets remain part of the implementation. Desktop and 390-pixel phone-container layouts and the specialty filter were checked in the browser; these are preview checks, not application acceptance evidence.

Every network action has immediate visible progress and prevents accidental duplicate submission. Validation appears beside the triggering control; success appears where the user acted. Save is rightmost and Cancel is left. Required fields have visible markers. Only destructive actions use confirmation dialogs. All lists paginate and counts agree with displayed filters. No inline style attributes or raw colors in templates; stylesheet tokens own color, spacing and motion. Preserve visible keyboard focus, meaningful labels, reduced motion and opaque fallbacks when blur is unsupported. Check 320, 390, 768 and 1440 pixel widths.

## Verification and delivery

Implement code first, then tests that attack behavior. Use only operator-approved in-memory SQLite or generated temporary fixture databases, never an application database. Verify:

- Two independent browsers can make overlapping-ID changes without seeing or changing each other's bookings, profiles, uploads, sessions or inboxes.
- Forged IDs, actor changes in another tab, expired sessions, stale generations and direct private-file requests fail safely.
- Concurrent acceptances of overlapping requests have only one winner; adjacent slots remain valid.
- Payment/deadline races, duplicate success/refund requests, cancelled checkout and failed payment outcomes preserve amounts and state.
- Changing catalogue prices/durations/deposits does not change existing bookings; client-submitted totals are ignored.
- Time off, working hours, lead time, DST boundaries, profile suspension and specialty deactivation are enforced consistently.
- Allocation limits, database/upload/record caps, busy locks, failed initialization and expiry cleanup preserve active sandboxes and useful errors.
- Portfolio type spoofing, oversized/decompression-heavy images, path traversal, stored HTML and CSRF cannot cross security boundaries.
- Inbox delivery/read state is scoped and idempotent; there is no external HTTP/mail delivery.
- Phone and desktop walkthroughs include loading, empty, validation, expiry and capacity states, keyboard navigation and reduced-motion behavior.

Ship source and lockfiles; README run steps; client/stylist/admin walkthrough; feature map against the posting; explicit limitations; asset provenance; a deployment guide; and local verification results/screenshots under `docs/verification/`. The local deployment package goes under `deploy/`, with built dependencies/assets and a private `_app` directory. Omit live sandboxes, runtime credentials, logs and private uploads. The operator uploads and performs hosted acceptance, including the one-file `pdo_sqlite` check, private-path denial, subdirectory URLs and two-browser isolation.

## Explicit limits

No real payments, card fields, email delivery, provider onboarding/KYC, commissions/payouts, native apps, maps, reviews, chat, recurring appointments, staff teams, multiple locations per stylist, currency conversion, password recovery, calendar synchronization, real identity verification or production usage claim. The client's Figma and real payment/deployment requirements remain separate work if the proposal is accepted.

## Approval and execution boundaries

Approval of this design selects its proposed product defaults. It does not authorize dependency installation, database access, non-generator Artisan runs, deletion, Git mutation or publication. The next step is a separate exact-file/task implementation plan for operator approval, followed by one implementer task and one adversarial review at a time.

The implementation plan must request the precise commands/dependencies and folder-scoped runtime/test cleanup permissions needed. Available agent models in this Codex session do not include Haiku, Sonnet or Opus; the operator must choose an allowed substitute before implementation/review dispatch requiring those models. The fresh design builder check can use the available general reviewer because the design-review rule specifies freshness and role rather than an Opus model.
