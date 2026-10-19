# Verification record: Elsewhere as a PHP-only site

Date: 2026-10-19

Hosted acceptance is pending the operator. Nothing here was uploaded or checked on InfinityFree.

## Commands and results

Run from `travel-business/` after Node was removed.

| Command | Result |
| --- | --- |
| `php -l` on every `.php` file under `site/`, `bin/` and `tests/php/` | 69 of 69 `No syntax errors detected` |
| `php -d zend.assertions=1 -d assert.exception=1 -d open_basedir="$PWD/site/private/:$PWD/tests/php/:$PWD/storage/test-runs/" tests/php/SandboxRuntimeTest.php` | exit 0; 14 `PASS` tests; `150 PHP runtime assertions passed.` |
| `python3 tests/infinityfree.py` | exit 0; `189 InfinityFree hosting checks passed.`; every line `PASS`, including `no PHP runtime warnings or fatals` and `folder URL serves index.php` |
| `python3 -I parity.py` (throwaway script kept outside the repo, `bin/router.php` serving `site/`) | exit 0; `7/7 pages match; folder URL matches` |
| `php bin/package.php --output deploy/builds/php-site-2026-10-19` | exit 0; figures below |

The harness builds the ZIP with `php bin/package.php`, extracts it under Apache and
PHP-FPM 8.4, and checks every page, the API, the storage, the private-file denials,
the packaging rules and `bin/router.php` on a temporary copy of `site/`.

## Parity with the last Node build

Baseline: the pages inside `deploy/builds/sqlite-sandboxes-2026-10-19-task2/travel-demo.zip`.
Compared as parsed HTML (entities decoded, whitespace-only text ignored, attributes
sorted, `.html` to `.php` in links), plus stricter whitespace and raw-byte comparisons.

```text
index: MATCH
destinations: MATCH
journeys: MATCH
about: MATCH
journal: MATCH
contact: MATCH
admin: MATCH
folder URL: MATCH (/travel-agency-demo/ serves index.php byte-for-byte)
7/7 pages match; folder URL matches
```

The `?v=` asset hashes are equal on every page.

## Release ZIP

| Item | Value |
| --- | --- |
| Path | `deploy/builds/php-site-2026-10-19/travel-demo.zip` |
| Size | 2,445,409 bytes |
| Files | 94 |
| SHA-256 | `b3f8bd65a8ab43095d5182f32d08d8752edf1ac15595ab31d035728b1c698c87` |

## Screenshots

Taken with headless Chromium at 390x844 (phone) and 1440x900 (desktop), served by
`bin/router.php`:

- `php-site-index-phone.png`, `php-site-index-desktop.png`
- `php-site-destinations-phone.png`, `php-site-destinations-desktop.png`
- `php-site-journeys-phone.png`, `php-site-journeys-desktop.png`
- `php-site-about-phone.png`, `php-site-about-desktop.png`
- `php-site-journal-phone.png`, `php-site-journal-desktop.png`
- `php-site-contact-phone.png`, `php-site-contact-desktop.png`
- `php-site-admin-phone.png`, `php-site-admin-desktop.png`

## Pending

Hosted acceptance is pending the operator: the SQLite check, upload and extract,
removal of the old `.html` pages, the two-browser check and the 403 check in
`deploy/infinityfree/DEPLOY.md`.
