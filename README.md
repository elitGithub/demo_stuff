# Demo projects

This workspace contains three proposal demos. Each application lives in
its own folder, with its own configuration, data, setup instructions and deployment
tools.

| Project | Purpose | Stack | Local entry point |
| --- | --- | --- | --- |
| [Resto-Chef](resto-chef/README.md) | Restaurant ordering, kitchen workflow and sales reporting | PHP 8.2+, PDO, SQLite or MySQL; no Composer/npm dependencies | [Storefront](http://127.0.0.1:8087) |
| [Turnkey CRM / CustomCRM](turnkey-crm/DEMO.md) | Branded service-business CRM with a populated sales workflow | Krayin CRM, Laravel 12, PHP 8.3+, Vue, MySQL/MariaDB | [Admin login](http://localhost:8081/admin/login) |
| [Atelier Studio](beauty_saloon_management/studio/README.md) | Salon website, scheduling, retail, memberships and enquiry CRM | Laravel 13, PHP 8.3+, Blade, SQLite | [Website](http://127.0.0.1:8088) |

## Resto-Chef

The restaurant demo includes a customer storefront and a staff workspace:

- Customers can browse and search dishes, filter categories, manage a multi-item
  cart, sign in, choose pickup or delivery, place orders and view their history.
- Staff can manage dishes, prices, categories and availability, and move orders
  through preparation, readiness, delivery and completion.
- The sales overview reports completed sales, order counts, average order value,
  active orders and popular dishes, with date filters.
- Seeded dishes, illustrative food photos, customer/staff accounts and sample
  orders support a full ordering walkthrough. Prices and order totals are
  calculated on the server, and past orders retain their original item details.

Payment is on pickup or delivery; the demo does not charge online payments.
Order progress updates on refresh. Tax, refunds, delivery zones and email/SMS
notifications are outside the current demo scope.

### Run locally

Install PHP 8.2+ with PDO, `pdo_sqlite` and `mbstring`. From the workspace root:

```bash
cd resto-chef
# Only for a fresh database; skip this for the existing configured demo:
php bin/setup.php --demo
php -S 127.0.0.1:8087 -t public public/router.php
```

Setup generates random credentials and saves them privately in
`storage/demo-credentials.json`. Staff sign in at `/login` and are redirected to
`/admin`. Use separate browser sessions to demonstrate customer and staff views.
Setup refuses to reseed a database that already contains users.

SQLite is the local default; MySQL configuration is also supported. Serve only
`public/` when using the source layout. For shared hosting, the
[InfinityFree deployment guide](resto-chef/deploy/infinityfree/DEPLOY.md) explains
how to generate and upload the separate hosting package, import its demo SQL and
configure the private environment file.

See the [Resto-Chef README](resto-chef/README.md) for the full walkthrough,
configuration, security details and verification commands.

## Turnkey CRM / CustomCRM

The `turnkey-crm/` project customizes Krayin CRM with **CustomCRM** branding and
a fictional service-business dataset:

- Dashboard, people and companies, opportunities with list and pipeline board
  views, activities and follow-ups, services, and printable PDF quotes.
- An initial dataset of 8 companies, 12 contacts, 12 opportunities across six
  stages, 16 activities/notes, 4 services and 4 quotes. Local walkthrough edits
  may change those counts.
- Shared manager and salesperson accounts, with the salesperson restricted to
  their records and a separate private installation owner.
- Responsive lists, mobile cards, detail panels, dark mode, and a sidebar with
  nested People/Companies navigation.
- Demo restrictions on settings, account changes, integrations, outgoing mail
  and uploads. `APP_ENV=demo` additionally enables the application-level database
  write guard and hides mutation controls; local CRM editing is available under
  `APP_ENV=local`.

### Run the existing local demo

From the workspace root:

```bash
cd turnkey-crm
bash bin/serve-demo.sh
```

Open [the admin login](http://localhost:8081/admin/login), choose **Use demo
account**, then **Sign in**. Restarting the server does not require reinstalling
or reseeding the database.

For a fresh checkout, follow the [demo setup guide](turnkey-crm/DEMO.md) for
dependencies, a dedicated empty database, configuration and one-time seeding.
Compiled browser assets are ignored by Git, so a fresh checkout also needs built
assets or a prepared release package. The stock installer deletes tables in its
configured database; use it only for a new, empty demo database.

The same guide covers the [InfinityFree read-only deployment](turnkey-crm/DEMO.md#hosted-read-only-demo-on-infinityfree),
including private setup, sample-data loading and activation of read-only mode.
The [hosting instructions](turnkey-crm/deploy/infinityfree/START-HERE.txt) describe
the upload layout and installation checks. Custom functionality lives in
`packages/Webkul/Turnkey/`, with branding assets in `public/turnkey/`.

## Atelier Studio

The salon demo lives in `beauty_saloon_management/studio/`. It combines a public
website with appointments, stylist availability, client preferences and visit
history, retail/stock, memberships, an enquiry pipeline, consented outreach,
sales/commission reports, staff roles, invoice/receipt PDFs and a disabled payment
gateway boundary. It uses fictional data and no legacy runtime dependencies.

```bash
cd beauty_saloon_management/studio
composer dev
```

Open [the website](http://127.0.0.1:8088) or [staff login](http://127.0.0.1:8088/login)
and choose **Explore the demo**. For a fresh installation, use `composer run setup`;
repeated setup preserves existing demo records. Live messaging and online payments
are not enabled. See the [setup and walkthrough](beauty_saloon_management/studio/README.md).

The supplied salon/CDM source was removed after the
[workflow audit and standalone verification](beauty_saloon_management/studio/docs/legacy-audit.md).
Only the new Studio app remains in the salon directory.
The web root must point only at `studio/public/`.

## Adding another demo

Create a new folder at the workspace root and keep its source, documentation and
project-specific `.gitignore` inside that folder. The root `.gitignore` covers
shared exclusions such as local environment files, dependencies, editor files,
logs and test reports. Each project's rules cover its runtime data and build or
deployment artifacts. Source files, images, example environments and dependency
lockfiles remain eligible for Git.

To see exactly which rule ignores a path, run:

```bash
git check-ignore -v --no-index path/to/file
```

Git tracks files, so a completely empty folder will not appear in `git status`
until it contains a file.
