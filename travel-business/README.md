# Elsewhere: travel business demo

A complete boutique travel website showcase with six public pages and a separate
demo workspace for saved enquiries and fictional bookings. It is a PHP site: seven
PHP pages, a JSON API and SQLite storage. Everything is contained in this
directory; no Composer or npm packages, external APIs or paid services are required.

## Requirements

- PHP 8.4 with the `pdo_sqlite` and `zip` extensions (the ZIP extension is only
  needed to package the site).
- Python 3 and a local Apache with PHP-FPM 8.4, only for the hosting test.

## Run locally

```bash
cd /var/www/demo_stuff/travel-business
ELSEWHERE_ORIGIN=http://127.0.0.1:8089 php -S 127.0.0.1:8089 bin/router.php
```

- Website: [http://127.0.0.1:8089/travel-agency-demo/](http://127.0.0.1:8089/travel-agency-demo/)
- Dashboard: [http://127.0.0.1:8089/travel-agency-demo/admin.php](http://127.0.0.1:8089/travel-agency-demo/admin.php)
- Click **Enter the demo dashboard** to explore; no password is required.

`bin/router.php` serves `site/` under `/travel-agency-demo/`, the same path as the
host. It redirects `/` there, runs the PHP pages, streams css, js, svg, jpg, png,
ttf and txt files, and answers 403 for `private/` and dotfiles and 404 for
everything else. It is for local use only and is never shipped.

Opening Contact or the dashboard creates a private browser sandbox with four
fictional enquiries and three sample bookings. Ordinary public pages allocate
nothing. Each sandbox has its own SQLite file in `site/private/sandboxes/`, which
Git ignores. Edits are kept until the sandbox expires.

## A suggested client walkthrough

1. Open the home page and browse the photography, editorial content and navigation.
2. Go to **Destinations**, filter by region and open a destination preview.
3. Browse **Journeys**, try travel-style filters and price sorting, and open an itinerary.
4. Click **Make it your journey** to open a prefilled trip enquiry form.
5. Use fictional contact details and submit. A saved enquiry reference appears.
6. Enter the **Demo dashboard**, find the traveller, open their enquiry and change
   its status to **Contacted** or **Proposal**.
7. Click **Create demo booking**. A persistent planning record appears in the
   Sample bookings tab. Conversion is protected against duplicate clicks.
8. Explore **Our story**, read full **Journal** articles and try the contact FAQs.

## Pages and features

| Page | Address | Experience |
| --- | --- | --- |
| Home | `index.php` | Photographic hero, journey finder, destination cards, featured journeys and journal |
| Destinations | `destinations.php` | Six destinations, region filters, text search and destination previews |
| Journeys | `journeys.php` | Six itineraries, destination/style filters, sorting, detailed day-by-day previews |
| Our story | `about.php` | Brand concept, approach and travel values |
| Journal | `journal.php` | Three complete editorial stories in accessible reading dialogs |
| Contact | `contact.php` | Validated enquiry form, itinerary prefill, saved reference and FAQs |
| Demo dashboard | `admin.php` | Enquiry list and status management, single-use booking conversion, sample bookings |

The folder address `/travel-agency-demo/` serves `index.php`. Shared mobile
navigation, keyboard focus styles, native modal focus management, reduced-motion
support, local photographs and fonts and page metadata are included.

## Technology and files

- `site/` is the site exactly as deployed and mirrors `htdocs/travel-agency-demo/`.
  - `index.php`, `destinations.php`, `journeys.php`, `about.php`, `journal.php`,
    `contact.php`, `admin.php`: one small file per page, rendering through the
    shared layout.
  - `api.php`: the JSON API entry point.
  - `assets/`: CSS, browser scripts, photographs, fonts and favicon.
  - `private/`: never served. It holds the API, the storage and page classes, the
    views in `views/`, `catalog.json` (destinations, journeys and articles),
    `schema.sql`, `registry-schema.sql`, `demo-seed.json`, `sandbox.json`,
    `enquiry-budgets.json`, `config.php` and `sandboxes/`.
- `bin/package.php` builds the deployment ZIP; `bin/router.php` is the local router.
- `deploy/infinityfree/` holds the deployment guide, the SQLite check and the root index.
- `tests/php/SandboxRuntimeTest.php` and `tests/infinityfree.py` are the tests.
- Assets are versioned in the pages with `?v=` plus the first ten characters of the
  file's SHA-256, computed by PHP at request time.
- `site/private/sandboxes/` holds `registry.sqlite` (sandboxes and rate buckets) and
  one `<digest>.sqlite` per visitor. It ships with a deny-all `.htaccess` and
  nothing else. Hosted code never creates a folder.

### Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `ELSEWHERE_ORIGIN` | `http://127.0.0.1:8089` | Local only. Read by `bin/router.php`, which defines the `ELSEWHERE_LOCAL_ORIGIN` constant that `site/private/config.php` uses as the API origin. Set it to match the host and port you pass to `php -S`. |
| `site/private/config.php` | hosted origin `https://demo-sites.infinityfree.me` | Origin, base path `/travel-agency-demo` and the sandbox folder. Hosted code never reads environment variables. |
| `site/private/sandbox.json` | see file | Sandbox limits, cookie names and the idle time shown on the contact page. |
| `site/private/enquiry-budgets.json` | see file | Budget options on the contact form. |

Canonical limits are 100 sandboxes, 100 enquiries per sandbox including the four
seeds, 20 rows per dashboard page and 1 MiB per visitor database. Cleanup removes
at most ten idle sandboxes (row and file) per API request that reaches the runtime,
including requests subsequently rejected; a file that cannot be deleted is logged,
its row is still removed and the orphan is ignored. Rate limits per server-seen
IP are ten allocations, 50 enquiries and 50 dashboard entries per one-hour window,
with at most 1,000 buckets. Forwarding headers do not change that identity.
Each SQLite connection waits at most `busyTimeoutMilliseconds` (2000) for a lock
before the API answers 503 `busy` with `Retry-After: 2`.

SQLite serializes writers, so no lock file is involved. Every request runs one
short `BEGIN IMMEDIATE` transaction on `registry.sqlite`, commits, then runs the
visitor operation in that visitor's own database.

The API returns typed `code` values. `sandbox_context` requires an explicit fresh
demo action, then a separate submit or dashboard entry; mutations are never
replayed automatically. `dashboard_access` requires dashboard entry.
`capacity`, `busy` and `rate_limited` include bounded retry guidance through
`Retry-After`; `sandbox_full` means the record or database limit was reached.
`unavailable` reports private storage failures without exposing paths or credentials.

## Package and deploy

```bash
php bin/package.php
```

The default output is `deploy/builds/<date>-<time>/travel-demo.zip`; pass
`--output <new or empty folder>` to choose another. The command prints the path,
byte size, file count and SHA-256. It makes all its checks before creating
anything, refuses a non-empty output folder or one inside `site/`, leaves out
`*.sqlite*`, `*.log` and everything in `private/sandboxes/` except `.htaccess`, and
stops with an error naming any other file whose type is not php, css, js, json,
sql, svg, jpg, png or ttf (or txt), apart from `.htaccess`.

The ZIP contains only `travel-agency-demo/`. It never replaces the root hub, the
root `.htaccess` or another demo. Hosted addresses:

- Website: https://demo-sites.infinityfree.me/travel-agency-demo/
- Dashboard: https://demo-sites.infinityfree.me/travel-agency-demo/admin.php
- Plain demo directory: https://demo-sites.infinityfree.me/

Follow [the deployment guide](deploy/infinityfree/DEPLOY.md) for the SQLite check,
the upload and extract steps, removing the old `.html` pages and the hosted
acceptance checks. Hosted acceptance is pending the operator; the public listing
stays blocked until the evidence is recorded.

## Verification

```bash
php -d zend.assertions=1 -d assert.exception=1 \
  -d open_basedir="$PWD/site/private/:$PWD/tests/php/:$PWD/storage/test-runs/" \
  tests/php/SandboxRuntimeTest.php
python3 tests/infinityfree.py
```

The PHP test covers the storage runtime under `open_basedir`. The hosting test
builds the ZIP with `bin/package.php`, extracts it, and runs it under temporary
Apache and PHP-FPM workers. It checks all seven pages (status, API meta tag,
Content Security Policy, scripts in order with their hashes, main heading), the
folder address, private-file denial, concurrency, `open_basedir` confinement,
packaging rules and the private error log. It also runs `bin/router.php` on a
temporary copy of `site/`. Both use only generated temporary files, and the
hosting test uses random loopback ports; they remove their files afterwards. The
browser scripts have no automated test: the verification record holds screenshots
of every page rendered by headless Chromium, and the interactive check is the
operator's hosted two-browser acceptance. Local verification does not establish
hosted behavior. Results and pending acceptance
work are in [the verification record](docs/verification/2026-10-19-php-only-site.md).

## Demo boundaries

Elsewhere is fictional. The copy, itineraries, prices, contacts and sample bookings
are demonstration content. The site does not send email, take payments, reserve
inventory, confirm travel arrangements or verify live availability.

The dashboard deliberately offers public demo access. **Use fictional data only.**
Records are private to one browser cookie context. Tabs in that context share
edits; separate browser profiles or private windows receive separate sandboxes.
There is no cross-device recovery. Leaving the dashboard revokes dashboard access
but retains edits until expiry. Clearing cookies loses access; possession of a
visitor's bearer cookies grants that visitor's access. This is not a production
customer portal. Do not enter real customer data.
For production, replace demo access with individual authenticated staff accounts,
define access and retention rules, and connect the desired mail or booking service.

The demo uses HttpOnly SameSite session cookies, same-origin API checks, bounded
JSON requests, server-side validation, rate limits, prepared statements and a
Content Security Policy. Access expires strictly at four idle hours; admitted
operations renew the deadline. Rejected admission does not. Physical deletion is
opportunistic on later API requests that reach the runtime, including requests
subsequently rejected, so expiry is not an exact deletion promise.
There is no analytics or external runtime request. Demo pages are marked noindex;
replace that setting and add the real canonical URL and sitemap when launching a
real brand.

Honest limits of this copy:

- The traveller count and sort lists on the forms are fixed in the page markup.
- Search text is lowercased with ASCII rules, so a future place name with an
  uppercase non-ASCII letter would not match a lowercase search.
- Old `.html` addresses are not redirected; they only exist on a host that still
  holds files from earlier releases, until you delete them.
- The browser scripts have no automated test.
- The local router does not send the `.htaccess` security headers (Content
  Security Policy and the others); only the hosting test and the host do.
- Hosted behavior has not been verified.

## Asset credits

Destination photography downloaded from Unsplash image URLs:

- Alpine lake: `photo-1476514525535-07fb3b4ae5f1`
- Italy: `photo-1516483638261-f4dbaf036963`
- Japan: `photo-1493976040374-85c8e12f0c0e`
- Bali: `photo-1537996194471-e657df975ab4`
- Tanzania / safari: `photo-1516026672322-bc52d61a55d5`
- Maldives: `photo-1514282401047-d79a71a590e8`
- Greece: `photo-1533105079780-92b9be482077`

Each source is `https://images.unsplash.com/<photo-id>`; locally stored images
provide illustrative destination photography, not promises of a specific property.
Fonts: **DM Sans** and **DM Serif Display**, distributed by Google Fonts under the
SIL Open Font License. License text is included in `site/assets/fonts/OFL-*.txt`.
The compass mark and interface icons are original inline SVG artwork.
