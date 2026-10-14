# Turnkey CRM local demo implementation plan

**Goal:** A branded, populated Krayin demo for a general service business, ready to run in Ubuntu WSL.

**Architecture:** Keep Krayin's CRM and authorization. A Webkul/Turnkey package owns branding, view overrides, demo access restrictions, fictional data and an explicit demo preparation command. Customer packaging follows the demo.

**Spec:** ../TURNKEY.md, narrowed by the operator's request to finish the local demo.

**Constraints:** No Git writes. No Artisan execution without approval of the exact command and run. Database access requires operator approval; that approval was granted for the dedicated local demo installation and workflow tests. Dependencies installed with scripts/plugins disabled. Isolated unit tests must not bootstrap the CRM or open a connection.

- [x] Write and run failing isolated tests for deployment guards, route restrictions and dated fictional data.
- [x] Implement pure Support/DemoGuard.php, Support/DemoAccess.php and Support/DemoDataset.php in packages/Webkul/Turnkey/src.
- [x] Register the Turnkey provider, configuration, views and overrides. Apply demo middleware and outgoing-mail suppression.
- [x] Add local logo/favicon/CSS, responsive login, consistent application identity and email/quote branding. Keep existing CRM assets and behavior.
- [x] Add turnkey:demo and a repository-based seeder. Require demo mode, a database name ending _demo, an initialized schema and no existing business records. Refuse repeat seeding. Preserve the private installation owner.
- [x] Add .env.demo.example and DEMO.md with concrete WSL setup commands and shared demo credentials.
- [x] Run isolated tests, PHP syntax checks and Blade compilation without bootstrapping the CRM; review and fix findings. Passed: 12 tests / 113 assertions, PHP/Blade syntax, Pint and Composer validation. Browser checks and code review findings resolved.
- [x] Initialize the dedicated database with operator approval, then verify login, CRM editing, activity completion, quote PDF output, salesperson restrictions, dark mode and mobile layout. See DEMO.md for the tested results.

## Review focus

Reject customer databases and repeated seeds without deletion. Block direct settings, account, imports and integration endpoints, including GET side effects. Preserve login/logout, CRM editing, lookup requests and quote printing. Test coherent relative dates and references. Prove template overrides include anonymous components.

## Runtime acceptance

Completed the local acceptance walkthrough on 2026-10-14. The database retains the fictional walkthrough changes. Demo settings are blocked in the browser; mail suppression and broader route controls have isolated test/source coverage. Public hosting and customer provisioning are outside this completed local-demo step.
