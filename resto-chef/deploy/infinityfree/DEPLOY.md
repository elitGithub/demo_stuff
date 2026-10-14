# Deploy Resto-Chef on InfinityFree

This package is for a **new, empty InfinityFree website and database**, at the root
of a domain or free subdomain. No SSH, Composer, npm, or server-side installer is
required. Use PHP 8.2 or newer. The app uses PDO MySQL and mbstring.

## What you received

| File | Use |
| --- | --- |
| `resto-chef-upload.zip` | Extract on your computer; upload only its `htdocs` contents. |
| `demo.sql` | Import through phpMyAdmin into an empty database. Never upload to `htdocs`. |
| `demo-credentials.json` | Your newly generated staff and customer passwords. Keep locally. |
| `DEPLOY.md` | These instructions. Keep locally. |
| `SHA256SUMS` | Optional integrity checks for the ZIP and SQL. Keep locally. |

The SQL creates 6 tables, 2 accounts, 3 categories, 8 dishes, and 12 sample orders.
Sample order dates are relative to the time you import, so sales are visible in
recent reports. Passwords in SQL are hashed. These logins are different from your
existing local demo logins. The package contains fresh fictional data, not a copy
of local orders or customer accounts.

## 1. Open your hosting account and find the website directory

1. Sign in at <https://dash.infinityfree.com/> and open **Accounts**.
2. Open the hosting account for your demo. If you have only registered a login,
   create a free hosting account and choose a free subdomain first.
3. Wait until the hosting account is active. Under its domain information, note
   the exact website directory. It is normally `htdocs` for the main domain, or
   `your-domain/htdocs` for another domain.
4. Open the account's **File Manager** (InfinityFree's upload UI).

InfinityFree removes files uploaded outside an `htdocs` directory. This package
keeps private application files in `htdocs/private` and blocks web access using
both a directory access rule and the main routing rules. Do not move `private`
outside `htdocs` on this host. [Official upload restrictions](https://forum.infinityfree.com/t/why-are-my-files-deleted-after-uploading-them/49310).

## 2. Create the database and import the sample data

1. Open the hosting account's **Control Panel**.
2. Open **MySQL Databases**. Enter a name such as `restochef` and choose
   **Create Database**.
3. Record the **full database name**, MySQL username and MySQL hostname displayed
   for it. Names usually include your account prefix, such as
   `if0_12345678_restochef`; do not use just `restochef` in configuration.
4. Open **phpMyAdmin** for that database and select the newly created database.
5. Choose **Import → Choose File**, select the supplied `demo.sql`, leave the
   format as **SQL**, and choose **Import/Go**.
6. Wait for the success message. Confirm these tables exist: `users`, `categories`,
   `food`, `orders`, `order_items`, and `login_attempts`.

Use the database hostname exactly as shown in the panel, **not `localhost`**.
The database password is your hosting/control-panel/FTP account password, which
may differ from the password you use to sign into InfinityFree's client area.
Check the hosting account details if unsure. Remote database connections from your
computer are not supported; use phpMyAdmin for the import.
[Official MySQL connection instructions](https://forum.infinityfree.com/t/how-to-connect-with-mysql/49340).

Import only once into an empty database. The SQL deliberately does not delete or
replace existing tables. If an import fails halfway through, create another empty
database and import there; do not overwrite a database that contains real data.

## 3. Extract and configure the website files

Extract `resto-chef-upload.zip` **on your computer**. You should see:

```text
htdocs/
  .htaccess
  index.php
  assets/
  private/
    .htaccess
    .env
    app/
    templates/
    public/
      index.php
```

Show hidden files in your file browser/editor so `.env` and both `.htaccess` files
are visible. Open **`htdocs/private/.env`** in a plain-text editor. Replace these
four placeholder values with the actual values from your account:

```dotenv
DB_HOST=REPLACE_WITH_MYSQL_HOST
DB_NAME=REPLACE_WITH_DATABASE_NAME
DB_USER=REPLACE_WITH_DATABASE_USER
DB_PASSWORD=REPLACE_WITH_DATABASE_PASSWORD
```

Keep `DB_DRIVER=mysql`, `DB_PORT=3306`, and `SESSION_SECURE=1` as supplied. Enter
the password as one literal line after `=`; `$`, `#`, and `=` inside it are read
as text. Do not add an inline comment or trailing spaces. Save the file as `.env`,
not `.env.txt`. Do not commit your edited file or share it with the client.

You may also change `APP_TIMEZONE` to a PHP/IANA timezone such as `Asia/Jerusalem`.
Prices and seeded orders are in USD; keep `APP_CURRENCY=USD` for this sample.
`DELIVERY_FEE_CENTS=350` means a $3.50 delivery fee. Changing the currency code
changes the label, not the numerical amounts or historical order totals.

## 4. Confirm HTTPS works

**Free InfinityFree subdomain:** HTTPS is supplied automatically; open
`https://YOUR-SUBDOMAIN/` and confirm there is no certificate warning.

**Your own custom domain:** in the client area open **Free SSL Certificates →
New SSL Certificate**, enter the domain, and create the order. Follow its DNS/CNAME
verification instructions, request the certificate when ready, then use automatic
installation if offered (or install its key and certificate under **SSL/TLS**).
Wait until the HTTPS URL opens without a certificate warning.
[Official SSL guide](https://forum.infinityfree.com/t/how-to-get-free-ssl-https-on-infinityfree/49323).

The package already redirects HTTP to HTTPS and uses Secure session cookies. Do
not disable these protections to bypass a certificate problem. If you add
Cloudflare yourself, use Full (strict) SSL with a valid origin certificate, not
Flexible mode.

## 5. Upload into the correct `htdocs`

1. Open the website directory identified in step 1.
2. If it contains only InfinityFree's initial placeholder page, remove that
   placeholder `index.html` or `index2.html`. Back up any existing site before
   replacing its files; this package is intended for a fresh demo website.
3. Upload the package's main `.htaccess` and `private/.htaccess` first, then upload
   the rest of the **contents** of the extracted `htdocs` directory, including
   `private/.env`, through the File Manager upload UI. Create subdirectories if
   the UI does not preserve folders automatically.
4. The result must be `YOUR-WEBSITE-DIRECTORY/index.php` alongside `assets` and
   `private`. Do not create `htdocs/htdocs`, `htdocs/resto-chef`, or `htdocs/public`.
5. Keep the `.htaccess` supplied with this package. Do not replace it with the
   repository root's `.htaccess`, which intentionally denies all web access.
6. If asked for permissions, use the host defaults. Files are normally `644` and
   directories `755`; do not use `777`.

Only upload the website contents. Keep `demo.sql`, `demo-credentials.json`, Git
files, tests, ZIP archives, logs, and this guide off the public website. The
prepared ZIP includes none of those private or development files.

## 6. Verify before sending the client a link

Use a normal browser with JavaScript and cookies enabled. Hosting browser checks
can make command-line tools such as curl report something different from a browser.

1. Visit `https://YOUR-DOMAIN/`: the Resto-Chef menu and food photos should load.
2. Open `/private/.env` and `/private/app/config.php`: both must be denied, never
   show configuration values or code. InfinityFree may show its own error page.
3. Open `demo-credentials.json` **on your computer**. It contains `admin` and
   `customer` email/password pairs. Use the generated customer login at `/login`.
4. Add two dishes, open the cart, and place a pickup order. Place a second order
   for delivery and check that the $3.50 delivery fee is included.
5. In a separate/private browser window, sign in at `/login` with the generated
   staff account. It should open `/admin`.
6. In **Orders**, advance your new order through preparation, ready, and completed
   (delivery also has an on-the-way step). Refresh the customer's order page.
7. In **Overview**, confirm that completed sales are counted. In **Menu**, edit a
   price and toggle availability; check the storefront, then restore the demo item.
8. Check the menu and checkout on your phone.

Send the HTTPS homepage URL in the proposal. You can share the customer login and,
if you want the client to try the staff features, the staff login privately.
Anyone with the staff login can change this demo's menu, prices, availability and
orders. Never share the hosting/database password or the `.env` file.

Suggested message after those checks pass:

> I've prepared a working restaurant-ordering demo for your project: [DEMO URL].
> It includes menu browsing, a cart, pickup/delivery checkout, customer order
> history, and a staff dashboard for order status, pricing, availability and sales.
> The menu and orders are sample data, and checkout uses payment on collection or
> delivery. I can customize the branding, menu and workflow for your restaurant.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Default hosting page / 404 | Correct domain directory; upload the contents of `htdocs`, not its enclosing folder. Clear the browser cache. |
| 403 on the homepage | Use this package's main `.htaccess`, not the repository root's deny-all file. |
| HTTP 500 | Confirm both `.htaccess` files uploaded intact and PHP is 8.2+. Check the control panel's available error logs. |
| “We'll be right back” / 503 | Confirm all four database settings, full prefixed database name, imported tables, and PDO MySQL/mbstring support. Do not expose raw errors publicly. |
| Login does not stick / CSRF error | Use HTTPS, enable cookies, reload the login page and try again. |
| Login rejected | Use this package's `demo-credentials.json`, not the old local-demo passwords or your hosting login. |
| Import says table already exists | You selected a previously initialized database. Use a new empty database. |
| HTTPS redirect loop | If using Cloudflare, change Flexible SSL to Full (strict). Otherwise check the host's HTTPS configuration. |
| CSS/photos missing | Upload the whole `assets` directory directly under `htdocs`; verify filenames and case. |
| Private files can be downloaded | Stop sharing the site; restore both supplied `.htaccess` files and recheck before continuing. |

## Updating and rebuilding

The package generator is committed source; generated artifacts live under ignored
`storage/infinityfree/`. The existing local demo database is not exported or changed.
To build a new independent package on your development computer:

```bash
cd /var/www/demo_stuff/resto-chef
python3 bin/package-infinityfree.py --output storage/infinityfree-next
```

Requires Python 3 and PHP 8.2+ with PDO SQLite and mbstring **on the build computer**;
InfinityFree runs the resulting PHP/MySQL site without these build steps. A fresh
package creates new random account passwords. The generator refuses to replace
an existing output directory, preventing accidental mismatch between SQL and logins.

For an existing live demo, update application files while retaining the server's
`private/.env` and database. Do not reimport demo.sql or overwrite .env with the
placeholder template. Export backups through phpMyAdmin before changing the site.

The package reads its private settings without `putenv()`, which InfinityFree
[disables](https://forum.infinityfree.com/t/couldnt-install-invoiceplane-through-softaculous/37241/49).
Its Apache rules use only the Indexes option; do not add MultiViews or
SymLinksIfOwnerMatch options, which the host now
[blocks](https://forum.infinityfree.com/t/oops-a-website-error-has-ocurred/120873/14).

Local package verification: `python3 tests/infinityfree.py`. This starts disposable
MySQL and Apache HTTPS servers and tests the extracted ZIP. It requires local MySQL
server/client tools, Apache with mod_php/mod_ssl, OpenSSL, and PHP PDO MySQL.
Host-specific behavior must still be checked in the deployed browser using step 6.
