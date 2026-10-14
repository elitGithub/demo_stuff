# Turnkey CRM: source assessment and proposed scope

Date: 2026-10-14. Status: source imported; the blue local demo is installed, populated and workflow-tested in WSL. See [DEMO.md](DEMO.md) for access, verified workflows and restart commands. Repeatable customer provisioning remains proposed work.

## Confirmed direction

- Product working name: **Turnkey CRM**.
- Audience: a general small service business.
- Foundation: Krayin 2.2.6, already a Laravel/Vue application.
- A working demo and customer installations should use the same versioned product.
- Self-hosted delivery: source plus installation on the customer's server, a one-time fee, one month of defect fixes excluding customer-caused changes, and no included ongoing updates.
- Managed delivery: a separate installation per customer with hosting, domain/DNS/SSL arrangements and a recurring fee.
- All work for this product lives in this directory.

The proposed scope below is an assessment for discussion, not a claim that the features have been implemented.

## Source and operating constraints

The original source was copied from `/var/www/2026-10-13/ok/outputs/crm-foundations/krayin-2.2.6` in Ubuntu WSL. The upstream release is pinned to commit `e597417bbc537cbd9716e7f1342d65dc21ac2145` of `krayin/laravel-crm`. See [UPSTREAM.json](UPSTREAM.json) for provenance and copy verification.

[composer.json](composer.json) requires PHP `^8.3` and Laravel `^12.0`; [composer.lock](composer.lock) pins Laravel to `v12.66.0`. Admin uses Vue 3, Blade, Tailwind and Vite. Existing compiled assets are included. PHP dependencies are installed from the lockfile with Composer scripts and plugins disabled; the local demo runs on PHP 8.4.

The operator's rules apply: Git is read-only; no database access without approval; every exact `php artisan` command needs direct approval for that run. Database commands are to be presented for the operator to execute. These restrictions also cover tests or scripts that bootstrap the application and touch a database. Composer scripts invoke Artisan, so normal dependency installation must not be used as a shortcut around that approval.

The original assessment used source inspection. Subsequent operator-approved work installed the dedicated demo database, ran the installer once and the demo command twice (one rolled-back failure, then one successful retry), and exercised the live CRM. It did not establish a production customer provisioning or update process.

## Recommended approach

Keep Krayin's Laravel/Vue stack and native authorization. Add a `packages/Webkul/Turnkey` package for product branding, deployment profiles, demo controls and seed orchestration. Add a separate `ServiceJobs` package only when that workflow is selected for implementation. Follow [AGENTS.md](AGENTS.md) and [.github/skills/crm-package-development/SKILL.md](.github/skills/crm-package-development/SKILL.md).

Use Krayin settings where they already exist; use targeted view/component overrides for gaps. Registration changes will be needed in Composer autoloading and application providers; Concord registration is needed for packages with models. Preserve an explicit list of overridden templates to review on upstream upgrades.

Alternatives considered:

| Approach | Consequence |
| --- | --- |
| **Dedicated extension package — recommended** | Keeps customer changes together and retains the existing CRM workflows. Requires verifying template/component override precedence. |
| Directly rebrand the upstream files | A quicker initial edit, but every upstream update requires reviewing scattered changes. |
| Rebuild on Laravel/Filament or another stack | Provides more UI control but requires recreating workflows already supplied by Krayin. No current requirement justifies that cost. |

Per-customer differences should be settings, assets and optional modules. Keep one maintained release instead of permanently diverging customer forks. Product name, customer company identity and deployment URL are distinct fields.

## Branding changes

| Area | Evidence in this source | Proposed change |
| --- | --- | --- |
| Product name and email sender | [`.env.example`](.env.example), [`config/app.php`](config/app.php), [`config/mail.php`](config/mail.php) | Provide separate demo/customer configuration examples with Turnkey CRM defaults and explicit sender/company settings. Do not ship customer secrets. |
| Logo, favicon, colour, footer, menu labels | [`Admin/src/Config/core_config.php`](packages/Webkul/Admin/src/Config/core_config.php) | Populate existing settings from the installation profile. Uploaded logo validation currently accepts raster formats, not SVG; choose supported customer uploads. |
| Login, forgot/reset password | [`Admin/src/Resources/views/sessions`](packages/Webkul/Admin/src/Resources/views/sessions) | Retain configured logos and replace hard-coded vendor marketing links with the product footer. |
| Login favicon | [`components/layouts/anonymous.blade.php`](packages/Webkul/Admin/src/Resources/views/components/layouts/anonymous.blade.php) | Override the mismatched `general.design.admin_logo.favicon` lookup to use the actual `general.general.admin_logo.favicon_image` setting. |
| Desktop/mobile/dark-mode logo | [`components/layouts/header/index.blade.php`](packages/Webkul/Admin/src/Resources/views/components/layouts/header/index.blade.php), [`sidebar/mobile/index.blade.php`](packages/Webkul/Admin/src/Resources/views/components/layouts/sidebar/mobile/index.blade.php) | Use consistent branded variants. The dark-mode toggle currently assigns stock logo asset URLs; test live switching as well as initial rendering. |
| Layout metadata | [`components/layouts/index.blade.php`](packages/Webkul/Admin/src/Resources/views/components/layouts/index.blade.php) | Review titles, alt text and icon metadata; this layout contains a `cache/logo/bagisto.png` reference. |
| Email | [`emails/layout.blade.php`](packages/Webkul/Admin/src/Resources/views/emails/layout.blade.php) | Replace the stock logo with the company identity. Verify absolute asset URLs and sender settings. |
| Quotes | [`quotes/pdf.blade.php`](packages/Webkul/Admin/src/Resources/views/quotes/pdf.blade.php) | Add the issuing company's logo, address and contact details. The template mainly presents quote and recipient information. |

The Admin provider registers both the `admin` view namespace and anonymous Blade components. Verify both resolution paths with a rendered page before relying on ordinary published-view overrides. The [WebForm provider](packages/Webkul/WebForm/src/Providers/WebFormServiceProvider.php) demonstrates mergeable menu and ACL configuration.

## Proposed demo

Demonstrate one end-to-end service-business workflow: enquiry arrives, an owner follows up, a quote is prepared, the deal is won and the work is tracked.

Reuse contacts, companies, leads/pipeline, activities/tasks, notes, products used as services, quotes and the existing dashboard. Start with one pipeline. Keep inventory, AI and external mailbox/marketing integrations out of the initial demo experience unless they support a specific sales story.

Use fictional records with dates relative to the seed/reset date, so dashboards remain useful. A possible first dataset is 10 companies, 20 contacts, 12 deals across stages, 15 activities and 5 quotes. These quantities are proposed, not agreed requirements.

A small **Service Jobs** module can differentiate the package: related customer and optional deal, assigned employee, status, due date and notes. It should use native ACL entries, repositories and record access rules. The contact detail page already exposes [view insertion hooks](packages/Webkul/Admin/src/Resources/views/contacts/persons/view.blade.php). This module follows the branded baseline; it does not need to delay proving installation.

For a public demo:

- Publish limited demo accounts; retain private administrator access. Public visitors must not change credentials, users, system settings or integrations.
- Permit useful CRM interactions, with server-side action and record restrictions. Hiding navigation is insufficient.
- Use a mail sink and block outbound mail, webhooks and external integrations at the application/transport boundary. Do not include real service credentials.
- Limit or disable uploads/imports in the public profile; use fictional downloadable records only.
- Reset only a positively identified demo installation, through an operator-only process with no public reset endpoint. A reset must refuse customer deployments.

[Bouncer.php](packages/Webkul/Admin/src/Bouncer.php) provides global/group/self user scopes. New modules must apply these rules to lists, direct record access, edits, exports and relationships. Retain this authorization system rather than layering Spatie over it.

## Repeatable customer installation

The stock CLI installer is unsuitable as the customer's repeatable provisioning or update command:

| Finding | Source | Required handling |
| --- | --- | --- |
| Regenerates the application key and runs `migrate:fresh` | [`Installer.php`, `handle()`](packages/Webkul/Installer/src/Console/Commands/Installer.php) | Fresh install must refuse an existing/non-empty target. Updates must preserve data and the application key. |
| Force-publishes core configuration | Same installer; [`CoreServiceProvider.php`](packages/Webkul/Core/src/Providers/CoreServiceProvider.php) | Preserve distribution-owned Concord/module registration. Do not overwrite it with upstream defaults. |
| Deletes users/roles and creates a known administrator | [`UserSeeder.php`](packages/Webkul/Installer/src/Database/Seeders/User/UserSeeder.php), [`RoleSeeder.php`](packages/Webkul/Installer/src/Database/Seeders/User/RoleSeeder.php) | Use controlled initial seeding with unique credentials. Do not rerun stock seeders on a customer database. |
| Administrator password is printed; skipping admin creation also skips finalization in that branch | [`Installer.php`, `createAdminCredentials()`](packages/Webkul/Installer/src/Console/Commands/Installer.php) | Use secret input, avoid logging credentials, and finalize every successful installation explicitly. |
| Installation completion uses a file and database flag | [`DatabaseManager.php`](packages/Webkul/Installer/src/Helpers/DatabaseManager.php), [`CanInstall.php`](packages/Webkul/Installer/src/Http/Middleware/CanInstall.php) | Preserve these completion signals. Block public installer routes during provision and after handover. Do not assume deleting the installer provider is safe: it also loads required migrations. |
| Composer hooks invoke Artisan | [`composer.json`](composer.json) | Separate dependency download/build from operator-approved application initialization. |
| Source has a Composer lock but no frontend lockfiles | Root and package `package.json` files | Pin the frontend dependency graph in the build environment and ship tested, prebuilt assets. |

Proposed fresh-install sequence:

1. Check the supported runtime, PHP extensions, writable directories, URL/TLS and dedicated database configuration. Initial supported target: Linux, PHP 8.3 and one explicitly tested MySQL/MariaDB version. Do not promise every database offered by the upstream installer.
2. Unpack the same versioned release used by the demo. The web root is `public/`. Keep the site private while provisioning.
3. Supply customer-specific configuration, a unique application key, owner identity and securely handled credentials. Accept explicit timezone, currency, company identity and mail settings.
4. In the operator-approved provisioning step, verify that the target is empty, apply migrations, seed required reference data, create the unique owner and apply the customer profile. Check every step for failure; do not continue after errors.
5. Record installation completion, link writable storage, prepare caches, configure required background work, and perform acceptance checks before exposure.
6. Hand over the installed release, source, configuration instructions and backup/restore procedure. Retain a release record without secrets.

Use three distinct operations:

- **Fresh customer install:** required reference data and a unique owner; no fictional business records or public demo accounts.
- **Demo seed/reset:** fictional business records and limited demo accounts, guarded by deployment identity; never a customer update mechanism.
- **Maintenance/update:** separate, version-aware migration path preserving customer data, settings, storage and keys. This supports the managed tier and separately purchased maintenance; it does not promise free updates to self-hosted buyers.

An interrupted fresh installation should fail closed with a recorded stage and a deliberate recovery path. A rerun must not silently erase partial data.

Every customer needs separate database credentials, storage, environment/secrets and hostname/cookie configuration. If a shared cache or queue service is used, isolate its namespaces too. Preserve persistent state when replacing a release.

[routes/console.php](routes/console.php) schedules inbound email processing every five minutes. Decide whether that feature is enabled before configuring the scheduler. Queue workers are needed only for the chosen queue configuration. Keep these integrations disabled in the public demo.

The root [LICENSE](LICENSE) is MIT. The lockfile also records GPL/LGPL and other licenses for dependencies, including SVG sanitizing and PDF tooling. A distribution needs a dependency/asset inventory and the applicable notices; the root license is not a complete inventory of bundled terms. This inspection is not a licensing clearance.

## Delivery order and acceptance

1. **Branding baseline:** implement the Turnkey package, consistent identity settings and targeted templates. Verify login/reset, desktop/mobile, light/dark, email and quote output.
2. **Fresh-install path:** produce a versioned release and customer/demo profiles. Prove two independent clean installations from the same artifact; prove rerunning against an existing installation refuses safely.
3. **Public demo:** seed the sales story, enforce demo restrictions, and prove the reset cannot target a customer installation.
4. **Service Jobs:** add the small custom module if selected, then verify action permissions and record visibility for owner, manager and staff.
5. **Managed handover:** verify backup/restore and a maintenance procedure against disposable environments before customer use.

Required runtime verification later includes absence of default credentials, no demo data in customer installs, isolation between customers, blocked installer endpoints, outbound demo restrictions and preserved state across a release replacement. Existing Pest configuration does not itself provide a dedicated test database; database-backed tests need an explicitly isolated environment and operator approval.

The remaining deployment decision is the first hosting target. A conventional Linux PHP-FPM/Nginx or Apache deployment is the simplest initial package; a container distribution can follow if customer demand warrants it. Hosting constraints must be known before claiming installation support.
