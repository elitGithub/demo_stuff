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

The initial database is created automatically with four fictional enquiries and
three sample bookings. Subsequent restarts preserve records and never reseed them.

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
- `src/store.mjs` validates inputs and persists records with SQLite prepared statements.
- `storage/demo.sqlite` is created at runtime and excluded from Git.
- `public/` is generated and excluded from Git. Run the build on a fresh checkout.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8089` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address; use `0.0.0.0` only when intentionally sharing |
| `DB_PATH` | `storage/demo.sqlite` | SQLite path; parent directory is created automatically |
| `PUBLIC_ORIGIN` | request's HTTP origin | Exact external origin when using an HTTPS reverse proxy |

For external hosting, use a host that supports a persistent Node 24 process and
writable persistent storage. Configure HTTPS at the reverse proxy and set
`PUBLIC_ORIGIN=https://your-demo-domain.example` (without a trailing slash).
Static-only hosting can display the pages but cannot save enquiries or run the dashboard.

### InfinityFree deployment

The hosted version uses the same static frontend with a PHP/SQLite API:

- Website: https://demo-sites.infinityfree.me/travel-agency-demo/
- Dashboard: https://demo-sites.infinityfree.me/travel-agency-demo/admin.html
- Plain demo directory: https://demo-sites.infinityfree.me/

Create a fresh deployment package with Node 24 and Python 3:

```bash
node --disable-warning=ExperimentalWarning bin/package-infinityfree.mjs --output storage/travel-demo
```

The output directory must be empty or new. Upload and extract `travel-demo.zip`
inside the hosting account's `/htdocs`. It contains the root `index.html` and
`travel-agency-demo/` only; it does not modify the existing `/studio/` demo or
root `.htaccess`. The included root index links to both demos.

The PHP API creates a fresh seeded SQLite database and session files under
`travel-agency-demo/private/runtime/`. Apache rules deny public access to all
of `private/`. Never remove that directory or its protection during updates.
Runtime data is excluded from packages, so uploading updated files preserves
saved enquiries. PHP requires PDO SQLite and write access to `private/`.

The API adapter, Apache rules and root index source live in `deploy/infinityfree/`.
For a different domain, pass `--origin https://your-domain.example` to the
packager; the subsite path remains `/travel-agency-demo/`.

## Demo boundaries

Elsewhere is fictional. The copy, itineraries, prices, contacts and sample bookings
are demonstration content. The site does not send email, take payments, reserve
inventory, confirm travel arrangements or verify live availability.

The dashboard deliberately offers public demo access. **Use fictional data only.**
Anyone using the demo login can view and update saved enquiries. It is not a
production customer portal. Do not put real customer data in this database.
For production, replace demo access with individual authenticated staff accounts,
define access/retention rules, and connect the desired mail or booking service.

The demo uses HttpOnly SameSite session cookies, same-origin API checks, bounded
JSON requests, server-side validation, rate limits, prepared statements and a
Content Security Policy. Sessions expire after four hours and on server restart.
There is no analytics or external runtime request. Demo pages are marked noindex;
replace that setting and add the real canonical URL/sitemap when launching a real brand.

## Verification

```bash
npm test
python3 tests/infinityfree.py
```

The tests use a temporary database and a separate random local port. They cover
page/link/asset delivery, private-file protection, session access, cross-origin
requests, input validation, persistent enquiry creation, status changes,
single-use booking conversion and logout. They do not modify the demo database.
The hosting test requires local Apache/PHP with PDO SQLite and validates the actual
ZIP under a temporary Apache server, including nested URLs and private-file denial.

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
