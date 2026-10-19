# Elsewhere as a PHP-only site

Date: 2026-10-19

Status: Approved by the operator on 2026-10-19 after the builder check, together with the plan.

## Why

Elsewhere had two runtimes: a Node server (with its own copy of the sandbox
API) plus a Node build that rendered the HTML, and a PHP adapter for
InfinityFree. Only PHP is ever hosted. The operator ruled that Node goes
entirely: PHP becomes the only implementation, and the pages are written as
PHP/HTML templates.

## Decisions made by the operator

- Remove everything Node: the server, the Node sandbox API and storage, the
  page build, the Node packager, `package.json` and every Node test.
- Pages are PHP/HTML templates with shared partials, served by PHP.
- Page addresses become `.php`: `index.php`, `destinations.php`, `journeys.php`,
  `about.php`, `journal.php`, `contact.php`, `admin.php`. The folder URL serves
  `index.php`.
- The repo holds the site exactly as deployed, in one folder,
  `travel-business/site/`, mirroring `htdocs/travel-agency-demo/`.
  `php bin/package.php` zips it. Locally, `php -S` serves the same folder
  through a small router that blocks `private/`.
- Tests: the PHP storage test and the Python Apache/PHP-FPM harness stay. The
  harness is extended to every `.php` page. Browser scripts are checked by hand
  in a real browser, with screenshots in the verification record.
- The new work builds on the current working tree, including the uncommitted
  Node-side Task 2 changes, which are deleted along with Node.
- Deletion is approved for every Node file listed under "Removed", and for the
  generated `public/` folder.
- Files move with `mv` (assets, PHP classes, JSON and SQL), each checked with
  SHA-256 before and after, so nothing is retyped.

## Goals

- One runtime: PHP 8.4. Nothing in the repo needs Node.
- The pages look and behave exactly as today, apart from `.html` becoming
  `.php` in addresses and links.
- Deploying is: package, upload, extract.

## Non-goals

- No change to page content, styles, browser scripts, the API contract or the
  SQLite storage design from `2026-10-19-sqlite-sandbox-storage-design.md`.
- No redirects from the old `.html` addresses (nothing outside links to them).
- No new dependencies.

## Constraints

- InfinityFree: PHP 8.4, `open_basedir` limited to `htdocs`, no SSH, no
  workers. `pdo_sqlite` is checked with `deploy/infinityfree/sqlite-check.php`
  before upload.
- Workspace code laws (`/var/www/demo_stuff/CLAUDE.md`): one declaration per
  file, tag-only docblocks, readonly DTOs between layers, no loose arrays from
  new code, escape all output, no inline `style` attributes, no hardcoded data
  that belongs in data files.

## Design

### Folder layout

```
travel-business/
  site/                         = htdocs/travel-agency-demo/
    .htaccess                   from deploy/infinityfree/website.htaccess, DirectoryIndex index.php
    robots.txt                  "User-agent: *\nDisallow: /\n"
    index.php destinations.php journeys.php about.php journal.php contact.php admin.php
    api.php                     requires private/api.php
    assets/                     moved from travel-business/assets/
    private/
      .htaccess                 "Require all denied\n"
      api.php autoload.php      moved from deploy/infinityfree/
      config.php                committed (see Configuration)
      classes/                  moved from deploy/infinityfree/classes/, plus page classes
      views/                    layout and partials
      catalog.json              destinations, journeys, articles (full content)
      schema.sql registry-schema.sql demo-seed.json   moved from src/
      sandbox.json enquiry-budgets.json               moved from config/
      sandboxes/.htaccess       "Require all denied\n"
  bin/package.php               builds the ZIP
  bin/router.php                local php -S router (never shipped)
  deploy/infinityfree/          DEPLOY.md, sqlite-check.php, root-index.html
  tests/php/SandboxRuntimeTest.php
  tests/infinityfree.py
  docs/
```

The source-tree fallbacks in the PHP classes (`dirname(__DIR__, 3).'/src'` and
similar) are removed: the files always sit beside them in `private/`.

### Pages

Each page file sets its title, description and scripts, then renders through
the shared layout in `private/views/`. The layout produces the same `<head>`
the Node build produced today, including `<meta name="api-endpoint"
content="api.php">` (which the packager used to inject), the same header,
footer, call to action, cards and dialog `<template>`s. Only `.html` → `.php`
changes in links.

- Scripts per page, in this order: `sandbox.js` on contact and admin;
  `dashboard-pagination.js` on admin; `app.js` on every page; `admin.js` on
  admin. All `defer`.
- Asset versioning as today: `styles.css`, `sandbox.js`,
  `dashboard-pagination.js`, `app.js` and `admin.js` get `?v=` plus the first 10
  hex characters of the file's SHA-256, computed by PHP at request time.
- Money formatting matches `Intl.NumberFormat('en-US', USD, 0 decimals)`, for
  example `$3,250`.
- The contact page reads budget options from `private/enquiry-budgets.json`,
  and the idle-hours text from `idleSeconds` in `private/sandbox.json`.
- Every dynamic value is escaped with `htmlspecialchars`. The fixed SVG icon
  markup is emitted as trusted constants.
- Catalog content moves from `src/data.mjs` into `private/catalog.json` and is
  read into readonly DTOs. The API keeps using the same file. Its overview
  payload still exposes only `{id, name}` destinations and `{id, title}`
  journeys.

### Configuration

`private/config.php` is committed, returning `origin`, `base_path`
(`/travel-agency-demo`) and `sandbox_root` (`__DIR__.'/sandboxes'`). The origin
is the `ELSEWHERE_LOCAL_ORIGIN` constant when it is defined, otherwise
`https://demo-sites.infinityfree.me`. Only `bin/router.php`, which is never
shipped, defines that constant, from its own `ELSEWHERE_ORIGIN` environment
variable, defaulting to `http://127.0.0.1:8089`. The host never calls `getenv`. The harness keeps writing its own config
into its extracted copy.

### Packaging

`php bin/package.php [--output <empty dir>]` (default
`deploy/builds/<date>-<time>/`) zips `site/` as `travel-agency-demo/...` into
`travel-demo.zip` with PHP's `ZipArchive`. It refuses a non-empty output
folder, and excludes `*.sqlite*`, `*.log` and anything else inside
`private/sandboxes/` except its `.htaccess`. Any other file whose extension is
not php, css, js, json, sql, svg, jpg, png, ttf or txt (or which is not named
`.htaccess`) stops the build with an error naming it. It runs every check
before creating anything, and the default output folder is
`deploy/builds/<Ymd-His>/`. It prints the path, byte size, file count and
SHA-256.

### Local run

`ELSEWHERE_ORIGIN=http://127.0.0.1:8089 php -S 127.0.0.1:8089 bin/router.php`,
then open `http://127.0.0.1:8089/travel-agency-demo/`.

The router serves `site/` under `/travel-agency-demo/`, the same path as the
host, because the API's cookie path stays `/travel-agency-demo/` and the API is
not changed. It:

- redirects `/` to `/travel-agency-demo/`;
- returns 403 for `private/` and dotfiles;
- runs `.php` files (the folder URL runs `index.php`);
- streams the other existing files with a small MIME map (css, js, svg, jpg,
  png, ttf, txt);
- returns 404 for everything else.

### Removed

- Node runtime and tooling: `package.json`, `server.mjs`, `build.mjs`,
  `bin/package-infinityfree.mjs`, all of `src/` (after its data, schema and
  seed files move), and `config/` (after its JSON moves).
- Node tests: every `tests/*.test.mjs` and `tests/support/`.
- The generated `public/` folder.
- Old locations emptied by the moves: `deploy/infinityfree/api.php`,
  `autoload.php`, `website.htaccess` and `classes/`, plus the top-level
  `assets/`.
- `.gitignore` drops `public/` and `test-results/`, and adds
  `site/private/sandboxes/*.sqlite*` and `site/private/sandboxes/*.log`.

### Tests

- `tests/php/SandboxRuntimeTest.php` loads `site/private/autoload.php` and runs
  under `open_basedir` as today.
- `tests/infinityfree.py` builds with `php bin/package.php` instead of Node,
  and checks every `.php` page for status 200, the api-endpoint meta, the CSP
  header, its scripts in order with `?v=` hashes, and its main heading. The
  folder URL must serve `index.php`. All existing API, storage and security
  checks stay.
- One-time parity check while building. The baseline is the pages inside
  `deploy/builds/sqlite-sandboxes-2026-10-19-task2/travel-demo.zip`, which
  already carry the api-endpoint meta. Render each PHP page and compare the two
  as parsed HTML, using a throwaway Python `html.parser` script kept outside the
  repo:
  - entities are decoded on both sides, so `&` and `&amp;` are equal;
  - whitespace between tags is ignored and attribute order is normalised;
  - `.html` → `.php` in links is the agreed difference;
  - `?v=` hashes must be equal, because the assets are unchanged.

  Templates may be readable, indented PHP. The result goes in the verification
  record. It is not a permanent test.
- Browser check: the implementer takes phone (390x844) and desktop (1440x900)
  screenshots of every page with the headless Chromium already on this machine
  (`~/.cache/ms-playwright/chromium_headless_shell-*`), served by the local
  router, and stores them under `docs/verification/`. Interactive flows are
  covered by the harness's API checks and by the operator's two-browser hosted
  acceptance in DEPLOY.md. No expiry or capacity staging.

### Docs

- `README.md` is rewritten for PHP: run steps, configuration, tests,
  deployment, feature map and honest limits. Node is no longer mentioned.
- The demo's own `CLAUDE.md` and `AGENTS.md` notes say PHP 8.4 and point to
  `site/`.
- `deploy/infinityfree/DEPLOY.md`: package with `php bin/package.php`. After
  extracting, also delete the old `*.html` pages on the host.
- A new verification record holds the parity result, the test results, the ZIP
  figures, and phone and desktop screenshots from a real browser.

## Left to the builder

- Names of the page and view classes and partials, within the code laws.
- How the layout receives per-page values (a readonly page DTO is expected).
- Router and packager internals.

## Calls made by the assistant (for the operator to check)

- Local origin through the `ELSEWHERE_LOCAL_ORIGIN` constant that only the
  router defines (from `ELSEWHERE_ORIGIN`, default `http://127.0.0.1:8089`).
  The hosted origin is the fallback, and the host never calls `getenv`.
- `bin/router.php` lives outside `site/`, so it is never uploaded.
- Old `.html` files on the host are removed by hand (a DEPLOY step), not by
  redirects.
- `catalog.json` holds the full catalog for both the pages and the API.
- A one-time parity check against the last Node build proves the pages did not
  change. It compares parsed HTML, not bytes, so the escaping can differ.
- The local router serves under `/travel-agency-demo/`, so the API and its
  cookie path stay untouched.
- Screenshots are taken with the headless Chromium already on this machine.
  Interactive checks are the harness plus your hosted acceptance.
- Reviews of this work diff against a snapshot of the current working tree
  (Task 2 included), so the uncommitted Task 2 edits are not mistaken for new
  work.
- The committed `config.php` keeps `'sandbox' => (object) []`, which `api.php`
  reads.
- Catalog-derived lists come from `catalog.json`. The fixed travellers and sort
  lists and the remaining literal alt text stay hard-coded (operator ruling
  2026-10-19: this is a demo).
