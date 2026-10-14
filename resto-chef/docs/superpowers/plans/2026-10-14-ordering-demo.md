# Ordering demo implementation plan

> **For agentic workers:** Use superpowers:executing-plans for the authorized work.

**Goal:** A locally runnable, secure customer-to-kitchen proposal demo.
**Architecture:** Public front controller, templates, shared PDO domain services.
**Tech Stack:** PHP 8.2+, SQLite/MySQL PDO, CSS/JavaScript, Python HTTP tests.
**Spec:** docs/superpowers/specs/2026-10-14-ordering-demo-design.md

## Global constraints
- Server-calculated integer money and immutable item snapshots.
- CSRF plus role validation before POST mutations; no user-export API.
- CLI setup only; private files outside public document root.
- No destructive changes to existing databases or production deployment.
- Supplied directory has no usable Git history: work here, retain /tmp source backup.

## Review focus
- Duplicate checkout and concurrent status updates cannot duplicate sales.
- Stale prices/unavailable food must be rejected before an order is created.
- Guessing order identifiers must not expose another customer's information.
- Completion time in configured timezone determines sales dates.
- Legacy entrypoints, config and database files must be inaccessible over HTTP.

## Task 1: Domain and secure persistence
Files: app/config.php, app/Database.php, app/Auth.php, app/Store.php,
bin/setup.php, tests/domain.php, .env.example, .gitignore.
- [x] Write tests against Database::migrate, Auth::register/login, Store::quote,
  placeOrder, transition, orderForUser and sales. Run php tests/domain.php and
  observe absent-class failure before implementation.
- [x] Implement schema with foreign keys, cents, unique request keys and snapshots.
- [x] Implement configured PDO, login hashing/throttling and transactional orders.
- [x] Verify valid and invalid carts, replay, stale quote, availability, snapshots,
  transition graph, owner access and report date boundaries; all tests pass.

## Task 2: Customer and staff web workflows
Files: app/bootstrap.php, app/Http.php, public/index.php, public/router.php,
templates/*.php, tests/web.py.
- [x] Write isolated HTTP tests; run python3 tests/web.py before routes exist.
- [x] Build session/CSRF/escape helpers and menu/cart/checkout/auth/history routes.
- [x] Build staff dashboard/orders/menu/categories and guarded POST actions.
- [x] Remove old handlers and dump; retire API with 410; protect private files.
- [x] Verify headers, CSRF, authorization, tampering, escaping and full workflow.

## Task 3: Demo presentation and verification
Files: public/assets/*, README.md, server config.
- [x] Style responsive local-asset customer and staff screens with useful states.
- [x] CLI seed menu/example orders, generate private random login credentials.
- [x] Document setup, settings, walkthrough, tests and scope limitations.
- [x] Run lint/domain/HTTP suite; inspect browser desktop/mobile and staff screens.
- [x] Independent final review; fix material findings and rerun affected checks.

## Progress
- Original source backed up to /tmp/restrogirls-original-20261014.tar.gz.
- Sandbox commands stalled; approved outside-sandbox execution is working.

- Task 1 domain implemented; initial absent-class failure observed, then 38 domain checks passed.

- Task 2: complete. 42 isolated HTTP checks passed after initial absent-setup failure.
- Task 3: complete. Setup/walkthrough README, local preview, 10 responsive browser
  screens inspected; no horizontal overflow, broken images or JS exceptions.
- Independent final review found three concrete issues, all fixed with regression
  tests: SQLite deferred-transaction lock upgrade, old checkout replay clearing a
  new cart, and malformed fulfillment causing an error during validation recovery.
- Final verification: 38 domain + 42 HTTP + 1 concurrency check passed; 22 PHP files
  linted; JavaScript syntax checked. Browser screenshots saved under storage/.
- Implementation ruling: SQLite is the tested default; MySQL connection/schema path
  exists but was not integration-tested against a target server. README states this.
- No deferred reviewer findings. Original source backup remains outside web root.
