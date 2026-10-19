# Elsewhere PHP-only Site Implementation Plan

> **For agentic workers:** run this through the workspace execution loop in `/var/www/demo_stuff/CLAUDE.md`: one task at a time, implementer subagent, adversarial Opus review, the orchestrator checks the reviewer's claims, the operator commits, then the next task is proposed. Code first, then tests that try to break it (no TDD). Agents never run git write commands.

**Goal:** Remove Node completely and serve Elsewhere as PHP pages from one `site/` folder that mirrors `htdocs/travel-agency-demo/`.

**Architecture:** The seven pages are PHP files rendering through shared view partials in `site/private/views/`, with catalog content in `site/private/catalog.json` read into readonly DTOs. The existing PHP API and SQLite storage move unchanged into `site/private/`. `bin/package.php` zips `site/`, and `bin/router.php` serves it locally under `/travel-agency-demo/`.

**Tech Stack:** PHP 8.4 (`ZipArchive`, PDO SQLite), Python 3 Apache/PHP-FPM harness, headless Chromium from `~/.cache/ms-playwright/`.

**Spec:** `travel-business/docs/superpowers/specs/2026-10-19-php-only-site-design.md`

## Global Constraints

- Page content, styles, browser scripts, the API contract and the SQLite storage design are unchanged. Only `.html` → `.php` changes in addresses and links.
- Pages: `index.php`, `destinations.php`, `journeys.php`, `about.php`, `journal.php`, `contact.php`, `admin.php`. `.htaccess` sets `DirectoryIndex index.php`.
- Scripts per page, in this order, all `defer`: `sandbox.js` (contact, admin), `dashboard-pagination.js` (admin), `app.js` (all), `admin.js` (admin). Each versioned file gets `?v=` plus the first 10 hex characters of its SHA-256.
- Every dynamic value is escaped with `htmlspecialchars`. Fixed SVG icon markup is emitted as trusted constants. No inline `style` attributes.
- Files move with `mv`, with SHA-256 checked before and after. Deletion is approved only for the files the spec lists under "Removed", plus `public/`, plus runtime files a local run creates under `site/private/sandboxes/` (`*.sqlite*`, `php-errors.log`).
- Workspace code laws: one declaration per file, tag-only docblocks, readonly DTOs between layers, no loose arrays from new code, braces always, no single-letter variables, named arguments on DTO construction, no emojis. No new dependencies.
- Run only the commands each task lists.

## Review Focus

1. **Folder URL**: `/travel-agency-demo/` must render the home page, both on Apache (`DirectoryIndex index.php`) and through the local router. Pinned in Task 1 (harness check `folder URL serves index.php`).
2. **Escaping regressions**: catalog text containing `&`, quotes or `<` renders as text, never markup. Pinned in Task 1 (parity check decodes entities; harness check that `Culture &amp; discovery` appears escaped in the journeys page source).
3. **Private views and data over HTTP**: `private/views/*.php`, `private/catalog.json` and `private/config.php` return 403 on Apache and through the router. Pinned in Task 1 (harness denial list plus router check).
4. **Packaging leaks**: the ZIP never contains `*.sqlite*`, `*.log`, `bin/`, `tests/` or anything in `private/sandboxes/` except `.htaccess`. Pinned in Task 1 (harness package-content check after a local run has left runtime files in `site/private/sandboxes/`).
5. **Stale `.html` pages on the host**: after an overwrite extract, the old `.html` files still exist, and `index.php` must win at the folder URL. Pinned in Task 1 (the harness extracts over a tree containing a sentinel `index.html` and checks that the folder URL serves the PHP page).

---

### Task 1: PHP site in `site/`, packaging, router, tests

Implementer: Opus.

**Files:**
- Move with `mv`:
  - `assets/` → `site/assets/`
  - `deploy/infinityfree/classes/*` → `site/private/classes/`
  - `deploy/infinityfree/api.php` → `site/private/api.php`
  - `deploy/infinityfree/autoload.php` → `site/private/autoload.php`
  - `deploy/infinityfree/website.htaccess` → `site/.htaccess`
  - `src/schema.sql`, `src/registry-schema.sql`, `src/demo-seed.json` → `site/private/`
  - `config/sandbox.json`, `config/enquiry-budgets.json` → `site/private/`
- Create:
  - `site/index.php`, `destinations.php`, `journeys.php`, `about.php`, `journal.php`, `contact.php`, `admin.php`
  - `site/api.php`, `site/robots.txt`, `site/private/.htaccess`, `site/private/config.php`, `site/private/catalog.json`, `site/private/sandboxes/.htaccess`
  - `site/private/views/*.php` (layout and partials)
  - new page and catalog classes in `site/private/classes/`
  - `bin/package.php`, `bin/router.php`
- Modify:
  - `site/.htaccess` (`DirectoryIndex index.php`)
  - `site/private/classes/*.php` (remove source-tree fallback paths)
  - `tests/php/SandboxRuntimeTest.php` (autoload path)
  - `tests/infinityfree.py` (build with `bin/package.php`, page checks, package checks moved from `tests/package.test.mjs`)
- Delete: `public/`

**Interfaces:**
- Consumes: the API and storage classes unchanged; `src/pages.mjs`, `src/components.mjs` and `src/data.mjs` as the content source to translate. They stay in place until Task 2 deletes them.
- Produces, which Task 2 relies on:
  - `php bin/package.php [--output <empty dir>]` writes `<output>/travel-demo.zip` and prints `path`, `bytes`, `files` and `sha256`;
  - `bin/router.php`;
  - the `site/` layout from the spec.

- [ ] **Step 1: Moves.** Record SHA-256 for every file to be moved. Run the `mv` commands. Re-check the hashes at the new paths; all must match. Delete `public/`.

- [ ] **Step 2: Catalog data.** Translate `src/data.mjs` verbatim into `site/private/catalog.json` with keys `destinations`, `journeys` and `articles`, keeping every field and string. Move any hard-coded alt text or option list from `components.mjs`/`pages.mjs` into `catalog.json`, or derive it from the catalog. Add readonly DTOs and a loader for the page catalog. `api.php` keeps reading `__DIR__.'/catalog.json'` and mapping only `id`/`name` and `id`/`title`/`destination`/`price`, so the overview payload is unchanged.

- [ ] **Step 3: Views and pages.**
  - Translate `header`, `footer`, `cta`, `destinationCard`, `journeyCard`, `articleCard`, `templates`, `icon` and the seven page functions into PHP partials in `site/private/views/`.
  - Translate the `<head>` from `build.mjs`, including `<meta name="api-endpoint" content="api.php">` and the route titles and descriptions from its `routes` table, into the layout.
  - Each page file builds its readonly page DTO (file, title, description, scripts) and renders the layout.
  - `money()` returns `'$'.number_format($value)`.
  - The contact page reads budgets from `private/enquiry-budgets.json` and the idle hours from `private/sandbox.json` `idleSeconds`.
  - Change `.html` to `.php` in every internal link.

- [ ] **Step 4: Config, API entry, guards.**
  - `site/private/config.php` returns `['origin' => defined('ELSEWHERE_LOCAL_ORIGIN') ? ELSEWHERE_LOCAL_ORIGIN : 'https://demo-sites.infinityfree.me', 'base_path' => '/travel-agency-demo', 'sandbox_root' => __DIR__.'/sandboxes', 'sandbox' => (object) []]`. Only `bin/router.php` defines the constant (fix round 1).
  - `site/api.php` is `<?php` plus `require __DIR__.'/private/api.php';`.
  - `site/private/.htaccess` and `site/private/sandboxes/.htaccess` contain `Require all denied\n`.
  - `site/robots.txt` is `User-agent: *\nDisallow: /\n`.
  - Remove the `dirname(__DIR__, 3).'/src'` and similar fallbacks in the classes.

- [ ] **Step 5: `bin/package.php`.**
  - Arguments: `--output <dir>`, default `deploy/builds/<Ymd-His>/`. Refuse a non-empty output folder with an error containing `new or empty`. Refuse files outside the extension allowlist, and run every check before creating anything (fix round 1).
  - Zip every file under `site/` as `travel-agency-demo/<relative path>`, dotfiles included. Exclude `*.sqlite`, `*.sqlite-journal`, `*.log`, and every entry under `private/sandboxes/` except `.htaccess`.
  - Print `path`, `bytes`, `files` and `sha256`. Exit non-zero on any failure.

- [ ] **Step 6: `bin/router.php`.** Behaviour as the spec's "Local run" section describes. `/private`, `/private/...` and any path segment starting with `.` return 403. `.php` files run with `chdir` to their folder.

- [ ] **Step 7: Tests.**
  - `tests/php/SandboxRuntimeTest.php` loads `site/private/autoload.php`.
  - In `tests/infinityfree.py`:
    - build with `php bin/package.php --output <temp>/package`;
    - before extracting, write a sentinel `travel-agency-demo/index.html` containing `STALE HTML SENTINEL` into the web root;
    - move every assertion from `tests/package.test.mjs` into the harness: ZIP entries all under `travel-agency-demo/`; no `.sqlite`, `.log`, `bin/` or `tests/` entries; `private/.htaccess` and `private/sandboxes/.htaccess` both equal `Require all denied\n`; `config.php` contains `__DIR__.'/sandboxes'`; a second run into the same output fails with `new or empty`; extraction leaves the root hub byte-identical.
  - Add these harness checks:
    - `folder URL serves index.php`: the response does not contain `STALE HTML SENTINEL` and does contain the home page's `<h1>` text;
    - for each of the seven pages: status 200, the api-endpoint meta, `script-src 'self'` in the CSP, exactly that page's scripts in order with `?v=` plus 10 hex characters, and its `<h1>` text;
    - the journeys page source contains `Culture &amp; discovery`;
    - 403 for `private/views/layout.php` (or the real layout file name), `private/catalog.json`, `private/config.php` and `private/classes/ApiController.php`.
  - Package content after a local run: start the router, bootstrap one sandbox through it so `site/private/sandboxes/` holds runtime files, package, and assert that none of those files are in the ZIP. Then stop the router and remove those runtime files.
  - Router checks in the harness: `/` redirects to `/travel-agency-demo/`; `/travel-agency-demo/private/config.php` returns 403; `/travel-agency-demo/assets/styles.css` returns 200 `text/css`; `/travel-agency-demo/nope.php` returns 404.

- [ ] **Step 8: One-time parity check.** Write a throwaway script at `/home/elit1/.claude/projects/-var-www-demo-stuff/sdd-snapshots/2026-10-19-php-only-site/parity.py`, outside the repo.
  - It extracts the seven `.html` pages from `deploy/builds/sqlite-sandboxes-2026-10-19-task2/travel-demo.zip`, fetches the seven `.php` pages through the router, and compares them as parsed HTML: entities decoded, whitespace between tags ignored, attributes sorted, `.html` → `.php` in `href`/`action` values as the only allowed difference, and `?v=` values equal.
  - Expected: all seven pages match. Put the script output summary in the report.

- [ ] **Step 9: Screenshots.**
  - With the router running and `ELSEWHERE_ORIGIN=http://127.0.0.1:8089`, use `~/.cache/ms-playwright/chromium_headless_shell-1223/chrome-linux/headless_shell` (use whichever cached build exists).
  - Run `--headless --hide-scrollbars --window-size=390,844 --virtual-time-budget=3000 --screenshot=<file> <url>` for every page, then again at `1440,900`.
  - Save the screenshots as `docs/verification/php-site-<page>-phone.png` and `-desktop.png`, then remove the runtime files the run created.

- [ ] **Step 10: Verify.** Run:
  - `php -l` on every new or changed PHP file. Expected: clean.
  - `php -d zend.assertions=1 -d assert.exception=1 -d open_basedir=$PWD/site/private/:$PWD/tests/php/:$PWD/storage/test-runs/ tests/php/SandboxRuntimeTest.php`. Expected: exit 0, 14 tests, 150 assertions.
  - `python3 tests/infinityfree.py`. Expected: exit 0, all PASS, and `no PHP runtime warnings or fatals`.
  - The parity script. Expected: 7/7 match.

- [ ] **Step 11: Hand-off.** The operator reviews and commits.

---

### Task 2: Remove Node, docs, final ZIP

Implementer: Sonnet.

**Files:**
- Delete:
  - `package.json`, `server.mjs`, `build.mjs`, `bin/package-infinityfree.mjs`
  - every remaining file under `src/`, then `src/` itself
  - `config/` (empty after Task 1)
  - every `tests/*.test.mjs` and `tests/support/`
  - `deploy/infinityfree/classes/` (empty after Task 1)
- Modify: `.gitignore`, `README.md`, `CLAUDE.md`, `AGENTS.md` (the demo's own, identical), `deploy/infinityfree/DEPLOY.md`
- Create: `docs/verification/2026-10-19-php-only-site.md`

**Interfaces:**
- Consumes: Task 1's `bin/package.php`, `bin/router.php`, the screenshots and the parity result.

- [ ] **Step 1: Deletions.** Delete the listed files with `rm` on exact paths and `rmdir` on emptied folders. Then `grep -rn "node\|\.mjs\|npm" --include=*.php --include=*.py --include=*.md --include=.gitignore travel-business` must match only historical docs under `docs/superpowers/` and the older `docs/verification/` records.

- [ ] **Step 2: `.gitignore`.** Remove `public/` and `test-results/`. Add `site/private/sandboxes/*.sqlite*` and `site/private/sandboxes/*.log`. Keep `storage/`, `/storage/test-runs/`, `/deploy/builds/` and `*.log`.

- [ ] **Step 3: Docs.**
  - **README.md:** PHP 8.4 requirements; local run (the router command and URL); configuration (`ELSEWHERE_ORIGIN`, `site/private/sandbox.json`); tests (the PHP test and harness commands); packaging and deployment pointer; the client walkthrough and feature map with `.php` addresses; honest limits; asset credits kept as they are.
  - **CLAUDE.md and AGENTS.md demo notes:** PHP 8.4 with PDO SQLite, no Composer or npm packages; the site lives in `site/` and mirrors the host; package with `php bin/package.php`; run locally with `bin/router.php`.
  - **DEPLOY.md:**
    - the package command;
    - the SQLite check;
    - upload and extract;
    - after extracting, delete the old `*.html` pages and the stale class files on the host;
    - two-browser acceptance at `/travel-agency-demo/`;
    - record the new ZIP figures.

- [ ] **Step 4: Final ZIP and verification record.** Run `php bin/package.php --output deploy/builds/php-site-2026-10-19`. Write `docs/verification/2026-10-19-php-only-site.md` with each command and result from Task 1 Step 10 (re-run here), the parity summary, the ZIP path, size, file count and SHA-256, the screenshot list, and a line saying hosted acceptance is pending the operator.

- [ ] **Step 5: Verify.** Re-run the PHP test and `python3 tests/infinityfree.py`. Expected: as in Task 1. Run `ls travel-business` and check that it shows no Node files.

- [ ] **Step 6: Hand-off.** The operator reviews and commits.
