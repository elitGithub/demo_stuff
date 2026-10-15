# Run the Turnkey CRM demo in WSL

This is the real Krayin/Laravel CRM with Turnkey branding and a fictional service-business dataset. The dedicated `turnkey_crm_demo` database was installed, populated and checked locally on 2026-10-14 with operator approval.

## Open the existing demo

Visit [Turnkey CRM](http://localhost:8081/admin/login). Click **Use demo account**, then **Sign in**.

| Account | Email | Password |
| --- | --- | --- |
| Manager | `demo@turnkey.example` | `TurnkeyDemo!2026` |
| Salesperson | `sales@turnkey.example` | `TurnkeyDemo!2026` |

The private owner is separate from these shared accounts. Its local credential record is `storage/app/turnkey-preview/private-owner.json`; keep it private.

To restart the existing demo from WSL, run `cd /var/www/demo_stuff/turnkey-crm` followed by `bash bin/serve-demo.sh`. The server binds to `127.0.0.1:8081`. Do not rerun the installer or seeder to restart it.

## Included

- Responsive Turnkey login, blue branding, application header, mobile/dark logo variants, email and quote identity.
- 8 companies, 12 contacts, 12 opportunities across six stages, 16 activities/notes, 4 services and 4 quotes.
- Shared manager account `demo@turnkey.example`, plus salesperson `sales@turnkey.example` with visibility restricted to that user's records. Both use the configured demo password, initially `TurnkeyDemo!2026`.
- CRM editing remains available with `APP_ENV=local`. `APP_ENV=demo` blocks database changes for every account. System/account settings, password resets, integrations, mail sending and uploaded files are separately restricted by `TURNKEY_DEMO=true`. The installation owner remains separate.
- Dates are relative to the day the sample data is inserted.

## Read-only environment

Set `APP_ENV=demo` in `.env` to activate the database write guard. The current local `.env` has not been changed by this implementation. The allowed environment names live in `packages/Webkul/Turnkey/src/Config/turnkey.php` under `read_only_environments` and default to `['demo']`.

The early `ReadOnlyDatabaseServiceProvider` registers Laravel's `beforeExecuting` hook on existing and future connections, including named/reconnected connections and CLI execution. Rejected queries throw a 403 with a read-only message before reaching PDO. A normal `DB::listen` callback runs after execution and cannot prevent a write; `DB::prohibitDestructiveCommands` only restricts certain Artisan commands, not ordinary application writes.

Only single `SELECT`, `SHOW`, `DESCRIBE` and `DESC` statements are admitted. Inserts, updates, deletes, DDL, procedures, stacked statements, executable comments, write-capable `SELECT INTO`, sequence writes and known mutating functions are blocked. Ambiguous syntax, including `WITH`, `EXPLAIN`, `#` comments/operators, nested comments, dollar/bracket quoting, quoted function calls and backslash-escaped literals, is deliberately rejected; use bound parameters for values. The SQL check is an application guard, not a complete SQL sandbox: direct PDO calls, external tools and custom stored functions require a database account restricted to read-only privileges for a database-enforced guarantee. No database grants were changed.

Keep `SESSION_DRIVER=file` and file cache for this mode; database session/cache/queue writes are also blocked. Authentication that needs to save a password rehash or remember token will be blocked too. Install/seed under `APP_ENV=local`, then switch to `demo`; there is no CLI or owner bypass. Restart long-running workers after changing environments. If configuration was cached, the operator must rebuild or clear that cache before the new value takes effect; no Artisan cache command was run here.

The live workflow checks below were performed in the editable local environment. The read-only behavior has separate tests with disconnected fake connections; it has not been tested against the live database.

## Operator setup for a new empty demo

The commands below are provided for the operator. The assistant must not run database operations or any Artisan command without the required explicit authorization.

1. In Ubuntu WSL, enter the application directory. The current local `.env` is already configured. For a new copy, create it only if it does not already exist:

   ```bash
   cd /var/www/demo_stuff/turnkey-crm
   cp -n .env.demo.example .env
   ```

2. Create an **empty, dedicated** MySQL/MariaDB database named `turnkey_crm_demo`, using your normal database administration process. Example SQL for the operator:

   ```sql
   CREATE DATABASE turnkey_crm_demo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

   Configure `DB_USERNAME` and `DB_PASSWORD` in `.env` for a user with privileges on this database. Use a name ending `_demo`; leave customer databases separate. Adjust `DB_HOST`/port if needed. No existing credentials were copied from another project.

3. Dependencies have been installed from the pinned lockfile. To install them again without invoking application scripts:

   ```bash
   composer install --prefer-dist --no-scripts --no-plugins --no-interaction
   ```

4. Initialize **only this empty demo database**. The stock installer drops existing tables in its configured database and generates the application key:

   ```bash
   php artisan krayin-crm:install
   ```

   Select the dedicated database; keep the application name `Turnkey CRM`, URL `http://localhost:8081`, locale English and your chosen currency. Create a private owner account with a strong password different from `admin123`. Do not use the shared demo email as the owner, and do not skip admin creation. Do not reuse this command for customer updates.

5. Populate the CRM:

   ```bash
   php artisan turnkey:demo
   ```

   This command requires demo mode, an initialized database whose name ends `_demo`, no existing business records and no previous seed marker. It uses a transaction, preserves the installation owner, and refuses a second run instead of deleting records.

6. Start the local server in a WSL terminal:

   ```bash
   bash bin/serve-demo.sh
   ```

   Open [the local demo](http://localhost:8081/admin/login), click **Use demo account**, then **Sign in**. The login page displays the shared credentials only when demo mode is enabled. Keep this development server local.

## Check the demo

Open the dashboard and Opportunities board; inspect a customer and its activity history; move an opportunity to another stage; create a follow-up; open and print a quote. Switch dark mode and check a narrow/mobile viewport. Sign in as the salesperson to verify record visibility. Settings/account modifications should be denied, and no real email should leave the demo.

Changing the configured demo password after seeding does not update the stored user's password. Use the same configured value until the demo is intentionally rebuilt. A reset is an operator-controlled rebuild of a disposable demo database; there is no public or automatic reset endpoint.

Verified against the running local CRM:

- Manager login, logout and the demo-account shortcut; populated dashboard and opportunity board.
- Contact details, including contacts without phone numbers; owner/participant lookup controls.
- Moving `New branch launch` from New to Follow Up, with its history entry.
- Creating `Confirm next steps — demo walkthrough` and marking it complete; its saved completion flag was checked.
- Editing a quote's billing/shipping addresses and downloading a branded, one-page PDF with the correct city and $900 total.
- Salesperson visibility: six owned opportunities and two quotes; another owner's opportunity redirects away, and system settings return 403.
- Blue branding, dark-mode switching and a 390px mobile dashboard. Date filters wrap without horizontal page overflow.

The initial dataset remains in place with the walkthrough changes: 18 activity/history records rather than the original 16, one moved opportunity and an edited quote. Outgoing mail suppression and the demo route restrictions are covered by source review and isolated tests; no real email was sent.

The installer ran once. The first demo seed failed on an empty phone-number payload and rolled back its business records; after the regression fix, the operator-approved retry succeeded. The seed marker prevents another seed. Keep real customer data out of this demo. Public hosting and repeatable customer provisioning remain separate follow-up work.

## Development checks without database access

```bash
php vendor/bin/pest tests/Unit --compact
php vendor/bin/pint --test packages/Webkul/Turnkey tests/Unit/Turnkey tests/Support bootstrap/providers.php
```

The Turnkey unit tests use pure logic and a minimal view container; they do not boot the CRM or register a database service. Do not run the full feature suite against a normal `.env`; it needs an explicitly isolated test database and authorization.

Latest isolated checks: 99 passing tests / 399 assertions, including 58 database-guard cases; Pint passing; syntax checks for 63 PHP files including 30 compiled Blade templates. The full database-backed feature suite was not run.

The Activities list now uses Activity, Opportunity, Owner, Due date and Status columns, with cards on small screens. Open an activity title or its arrow to read comments, full schedule and record history in a keyboard-accessible detail panel. Due date shows the scheduled start; incomplete activities become overdue after their scheduled end. Editing and completion controls are omitted in the read-only environment.

This Activities update was checked at desktop and 390px mobile widths using the real Blade/Vue components with isolated sample responses: sorting in both directions, empty search, calendar switching, detail opening and Escape/focus return, failed-update feedback, dark table styling and read-only detail controls. No database access or Artisan commands were used for this update. Live database workflows were not repeated.

Contacts (People and Companies), Opportunities and Quotes now use the same list and detail-panel design. People show company, primary email/phone and tag; Companies show location and contact count; Opportunities show customer, value, stage, owner and expected close; Quotes show customer, total, expiry, owner and validity. Quote validity is based on expiry, with the expiry day still active; it does not imply a sent or accepted status. Additional contact methods, company addresses, quote breakdowns and record dates appear in the detail panel.

Opportunities open in List view by default; Board remains available with the selected pipeline preserved and matching card styling. Native queries, filters, exports and permission checks remain in place. The detail panel keeps permitted View, Edit, Print and Delete actions, with confirmation handled by the original component. Read-only mode removes mutation controls and disables board dragging. Google Contacts export and optional document upload remain available for authorized customer installations outside demo/read-only mode.

This record-screen update was checked using real Blade/Vue templates and fixture repositories without registering a database service: all four desktop lists, the opportunity board, mobile cards at 390px, sorting in both directions, empty search, drawer opening and Escape/focus return, Delete confirmation cancellation, dark table styling and read-only quote actions. Isolated tests cover formatting, missing contact data, expiry boundaries and permission/environment gates. No live database requests, Artisan commands, staging or commits were performed for this update.

The desktop sidebar expands Contacts inline, with nested People/Companies links and current-page highlighting. Opening a group from the collapsed icon rail expands the sidebar first. The menu still uses Krayin's configured labels and permission-filtered items; Settings/Configuration remain direct links and mobile keeps its existing drawer. The real sidebar template was checked with isolated fixture menus for click and keyboard disclosure, collapsed-state expansion, People/Companies navigation, dark styling and mobile drawer compatibility. No live database requests or Artisan commands were used.

The initial sidebar preview used an anonymous layout and missed a stylesheet ordering problem in the full admin layout. Sidebar CSS is now linked directly in the admin head; pushing it from the sidebar body is too late for the head's styles stack. A full-layout regression test renders the actual header/sidebar with fixture authentication and menu data and checks that the stylesheet appears in the head exactly once. Full-layout visual checks cover the 200px desktop sidebar, 13px disclosure arrow and proper content offset; collapsed groups also report a collapsed accessibility state while hidden.

## Customization locations

- `packages/Webkul/Turnkey/src`: provider, config, middleware, sample data and seeder.
- `packages/Webkul/Turnkey/src/Resources/views/admin`: targeted Admin overrides; upstream Admin templates remain intact.
- `public/turnkey`: static branding assets, requiring no frontend rebuild.
- `UPSTREAM.json` and `UPSTREAM.sha256`: original copied source provenance; the checksums describe the pre-customization baseline.

## Source control

The workspace root `.gitignore` explicitly allows `turnkey-crm`; this directory's own rules then exclude `.env` variants, credentials, dependencies, caches, runtime storage and generated builds. Source, docs, example environments and dependency lockfiles remain eligible for Git. Nothing was staged or committed.

The existing compiled browser assets remain on disk for the local demo but are ignored by Git. A fresh source checkout therefore needs the frontend assets built or supplied in a release artifact before serving the CRM. Preserve the runtime storage directory skeleton when packaging a release.

## Hosted read-only demo on InfinityFree

After the operator finishes the browser installer, the temporary `deploy/infinityfree/turnkey-demo-setup.php` page can prepare the dedicated `if0_43175351_turnkey` database on `sql206.infinityfree.com`. Upload the small demo setup package into `htdocs`, preserving its `_app` paths. It contains no environment file or setup token; it reuses the installation's private setup key. Open the private URL from the generated START-HERE file and press **Load demo data and enable read-only**.

Only that authenticated, signed POST bootstraps the CRM and accesses its database. It validates the exact host/database/site, requires file sessions/cache and InnoDB tables, and refuses existing business data. The existing demo seeder preserves the installer owner and commits the sample records and seed marker in one transaction. A repeat after an interrupted response skips a committed seed and finishes the environment change.

Before creating demo accounts, the page closes normal CRM requests behind a persistent preparation marker. A failed or interrupted request leaves this gate closed, while the private setup page remains usable for retries. After seeding, the page atomically sets `APP_ENV=demo`, `TURNKEY_DEMO=true` and `APP_DEBUG=false`, preserving all other environment settings. The existing application-level query guard blocks database writes on subsequent requests; the hosting database user's grants are unchanged. The default shared login is `demo@turnkey.example` / `TurnkeyDemo!2026`, unless the demo password was configured differently before seeding.

The maintenance gate opens only after the environment switch succeeds. The completion marker then disables the temporary page. Delete `htdocs/turnkey-demo-setup.php` and the earlier `turnkey-check.php` after success. Then sign in using the demo account and check the dashboard, contacts, opportunities, activities and quotes; mutation controls should be hidden and the read-only banner visible. Keep the private `_app` folder and the installed marker. No reinstall or reset is part of this operation.

The setup page is tested against an isolated PHP fixture without a CRM application or database. Environment rewrites, exact-target checks and seeding guards have pure unit coverage. These checks do not substitute for the operator's hosted import and browser verification.
