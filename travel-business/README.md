# Elsewhere — travel business demo

A complete boutique travel website showcase with six public pages and a separate
demo workspace for saved enquiries and fictional bookings. Everything is contained
in this directory; no npm packages, external APIs or paid services are required.

## Run

Requires **Node.js 24 or newer** (uses the bundled `node:sqlite` module).

```bash
cd /var/www/demo_stuff/travel-business
npm run build
npm start
```

- Website: [http://127.0.0.1:8089](http://127.0.0.1:8089)
- Dashboard: [http://127.0.0.1:8089/admin.html](http://127.0.0.1:8089/admin.html)
- Click **Enter the demo dashboard** to explore; no password is required.
- Use `npm run dev` to build and start the Node watcher. After editing templates,
  styles or browser scripts, run `npm run build` and refresh the page.

Opening Contact or the dashboard creates a private browser sandbox with four
fictional enquiries and three sample bookings. Ordinary public pages allocate
nothing. Each sandbox has its own SQLite file; restarts preserve valid sandboxes.

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

| Public page | Experience |
| --- | --- |
| Home | Photographic hero, journey finder, destination cards, featured journeys and journal |
| Destinations | Six destinations, region filters, text search and destination previews |
| Journeys | Six itineraries, destination/style filters, sorting, detailed day-by-day previews |
| Our story | Brand concept, approach and travel values |
| Journal | Three complete editorial stories in accessible reading dialogs |
| Contact | Validated enquiry form, itinerary prefill, saved reference and FAQs |

Shared mobile navigation, keyboard focus styles, native modal focus management,
reduced-motion support, local photographs/fonts and page metadata are included.

## Technology and files

- HTML, CSS and vanilla browser JavaScript; no frontend framework or runtime dependencies.
- `build.mjs` renders templates in `src/pages.mjs` and `src/components.mjs` to `public/`.
- `src/data.mjs` contains the destination, itinerary and journal content.
- `assets/` contains CSS, browser scripts, photographs, fonts and favicon.
- `server.mjs` serves only `public/` and exposes the enquiry/dashboard JSON APIs.
- `src/store.mjs` exposes an explicit visitor store; `src/sandbox/` owns identity,
  serialized lifecycle operations, reservations and cleanup.
- `config/sandbox.json`, `src/schema.sql`, `src/demo-seed.json` and
  `config/enquiry-budgets.json` are canonical shared Node/PHP inputs.
- `storage/sandbox-runtime/` contains private runtime state and is excluded from Git.
  Legacy `storage/demo.sqlite` is unused and must be preserved.
- `public/` is generated and excluded from Git. Run the build on a fresh checkout.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8089` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address; use `0.0.0.0` only when intentionally sharing |
| `SANDBOX_ROOT` | `storage/sandbox-runtime` | Dedicated private runtime directory, never a shared legacy database |
| `SANDBOX_CONFIG_FILE` | canonical defaults | Optional JSON file of validated sandbox-limit overrides |
| `PUBLIC_ORIGIN` | bound loopback origin | Exact external HTTP(S) origin, required beyond loopback; no trailing slash |

For external hosting, use a host that supports a persistent Node 24 process and
writable persistent storage. Configure HTTPS at the reverse proxy and set
`PUBLIC_ORIGIN=https://your-demo-domain.example` (without a trailing slash).
Static-only hosting can display the pages but cannot save enquiries or run the dashboard.

Run exactly one Node process per runtime root. Its queue is process-local; Node
cluster or multiple replicas sharing a root are unsupported. PHP instead uses a
persistent lock inode across requests. Never expose either runtime directory.

Canonical limits are 100 allocated slots (pending/failed slots count), 100
enquiries per sandbox including the four seeds, 20 rows per dashboard page,
1 MiB per SQLite main file and 128 MiB total managed storage. Registry, journal
and staging reserves are 2 MiB each. Cleanup considers at most ten expired slots
per API request that reaches the serialized runtime, including requests subsequently
rejected; failed deletion stays charged. Rate limits per server-seen
IP are ten allocations, 50 enquiries and 50 dashboard entries per one-hour window,
with at most 1,000 buckets. Forwarding headers do not change that identity.
The runtime waits at most two seconds for a lock, retrying every 25 ms.

The API returns typed `code` values. `sandbox_context` requires an explicit fresh
demo action, then a separate submit or dashboard entry; mutations are never
replayed automatically. `dashboard_access` requires dashboard entry.
`capacity`, `busy` and `rate_limited` include bounded retry guidance through
`Retry-After`; `sandbox_full` means the record or database limit was reached.
`unavailable` reports private storage failures without exposing paths or credentials.

### InfinityFree deployment

The hosted version uses the same static frontend with a PHP/SQLite API:

- Website: https://demo-sites.infinityfree.me/travel-agency-demo/
- Dashboard: https://demo-sites.infinityfree.me/travel-agency-demo/admin.html
- Plain demo directory: https://demo-sites.infinityfree.me/

Create a fresh deployment package with Node 24 and Python 3:

```bash
node --disable-warning=ExperimentalWarning bin/package-infinityfree.mjs --output deploy/builds/visitor-sandboxes-release
```

The output directory must be empty or new. `travel-demo.zip` contains only
`travel-agency-demo/`; it excludes databases, runtime state, tests, diagnostic
scripts and diagnostic secrets. It never replaces the root hub, root `.htaccess`
or another demo. Building uses canonical JSON/SQL inputs without opening a database.

The PHP API creates private visitor files under
`travel-agency-demo/private/runtime/sandbox-runtime/`. Apache rules deny all of
`private/`. Preserve its protection, old databases and session files during
updates. Old shared data is never migrated into visitor sandboxes.
PHP 8.4 requires PDO SQLite, private writes, atomic replacement and cross-request
advisory locking, verified on the actual host for each deployment.

The API adapter, Apache rules and root index source live in `deploy/infinityfree/`.
For a different domain, pass `--origin https://your-domain.example` to the
packager; the subsite path remains `/travel-agency-demo/`.
Follow [the deployment guide](deploy/infinityfree/DEPLOY.md) for the protected
operator preflight, complete-release replacement and hosted acceptance gates.
The public listing stays blocked until hosted acceptance evidence is recorded.

## Demo boundaries

Elsewhere is fictional. The copy, itineraries, prices, contacts and sample bookings
are demonstration content. The site does not send email, take payments, reserve
inventory, confirm travel arrangements or verify live availability.

The dashboard deliberately offers public demo access. **Use fictional data only.**
Records are private to one browser cookie context. Tabs in that context share
edits; separate browser profiles/private contexts receive separate sandboxes.
There is no cross-device recovery. Leaving the dashboard revokes dashboard access
but retains edits until expiry. Clearing cookies loses access; possession of a
visitor's bearer cookies grants that visitor's access. This is not a production
customer portal. Do not enter real customer data.
For production, replace demo access with individual authenticated staff accounts,
define access/retention rules, and connect the desired mail or booking service.

The demo uses HttpOnly SameSite session cookies, same-origin API checks, bounded
JSON requests, server-side validation, rate limits, prepared statements and a
Content Security Policy. Access expires strictly at four idle hours; admitted
operations renew the deadline. Rejected admission does not. Physical deletion is
opportunistic on later API requests that reach the serialized runtime, including
requests subsequently rejected, so expiry is not an exact deletion promise.
There is no analytics or external runtime request. Demo pages are marked noindex;
replace that setting and add the real canonical URL/sitemap when launching a real brand.

## Verification

```bash
npm test
python3 tests/infinityfree.py
```

The tests use only generated fixtures under `storage/test-runs/` and random
loopback ports, then remove their own fixtures. They cover
page/link/asset delivery, private-file protection, session access, cross-origin
requests, input validation, persistent enquiry creation, status changes,
single-use booking conversion and logout. They do not modify the demo database.
The hosting test requires local Apache/PHP with PDO SQLite and validates a generated
ZIP under temporary Apache workers, including nested URLs, private-file denial,
concurrency and the separately copied protected preflight. Local verification
does not establish hosted behavior. Actual results and pending acceptance work
are in [the verification record](docs/verification/2026-10-18-visitor-sandboxes.md).

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
SIL Open Font License. License text is included in `assets/fonts/OFL-*.txt`.
The compass mark and interface icons are original inline SVG artwork.
