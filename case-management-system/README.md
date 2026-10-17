# Casefile

Casefile turns simulated emails from chosen senders into numbered cases. A fictional Toronto landlord can read a thread, open an attachment, reply, save notes, change status and search the case history. Hosted demo visitors receive separate SQLite copies. No Google account is contacted and no real email is sent.

PHP 8.4+, Laravel 13.37.0 (locked), SQLite, Blade, Tailwind 4 and Vite 8. No worker or external mail service is required. [Client walkthrough](docs/DEMO.md), [deployment](docs/DEPLOYMENT.md), [asset provenance](docs/ASSETS.md), [verification](docs/verification/2026-10-17-casefile-verification.md).

The top bar's Appearance icon opens System, Light and Dark choices on guest and signed-in pages. Workspace opens all four layouts, Compare layouts, How this runs for real and Sign out; Demo mode also includes Reset my demo. On phones, Workspace uses a grid icon above the four main navigation links. System follows the device light or dark setting by default; Light and Dark are saved browser overrides under the Casefile-specific `casefile.theme` key. If browser storage is unavailable, the selected appearance lasts only on the current page. Without JavaScript, the page follows the device setting and the Appearance control remains hidden. Status and Sender use native select controls. Supporting browsers enhance their open menus with rounded, spacious rows; other browsers retain native menus. [Dark-mode verification](docs/verification/2026-10-17-casefile-dark-mode-verification.md) records final-source browser checks, package integrity and remaining hosted checks separately.

## Run locally

Use a new checkout and a new database. These are operator-run instructions: dependency installation, database access and each Artisan invocation need explicit approval when an agent runs them. Do not run Composer's `setup` or `dev` scripts; they include additional commands.

Prerequisites: PHP 8.4 with Laravel's extensions plus `pdo_sqlite` and GD, Composer, Python 3.10+, and a Node release supported by the locked Vite 8 build (Node 22.12+). From the project root:

```sh
composer install --no-scripts --no-plugins --no-interaction --prefer-dist
npm ci --ignore-scripts
cp .env.example .env
php artisan key:generate
php artisan casefile:build-fixtures
php artisan casefile:build-template --path=/var/www/demo_stuff/case-management-system/database/casefile.sqlite
npm run build
php artisan serve --host=127.0.0.1 --port=8093
```

Before the template command, set `.env` to `CASEFILE_MODE=local`, `DB_CONNECTION=sqlite`, `DB_DATABASE` equal to that new absolute path, `APP_URL=http://127.0.0.1:8093`, file sessions and file cache. Replace the absolute path if your checkout lives elsewhere. The template command creates/migrates/seeds its own `.building` database and refuses to replace an existing destination without `--force`; the commands above do not reset existing data. The fixtures command overwrites its four generated attachments. No separate migration or seeding command is needed.

Open [the local demo](http://127.0.0.1:8093) and choose **Continue with Google (simulated)**. Local mode uses the one database, keeps the simulated mailbox controls and does not offer sandbox reset. To exercise separate visitors locally, use `CASEFILE_MODE=demo` and separately approve/run `php artisan casefile:build-template --path=/var/www/demo_stuff/case-management-system/storage/app/template/casefile-template.sqlite`; restart the server after changing configuration. Demo mode uses private copies under `storage/app/sandboxes`.

## Client walkthrough

1. Sign in as Dana Whitfield and choose Conversation desk.
2. Open Inbox and deliver the next email. Follow its newly created case.
3. Reply, keep the case open for the scripted response, then save Issue and Notes and close the case.
4. Search by case number, status, sender or received dates; return from the case to the same search.
5. Track an ignored sender to backfill their existing mail. Read and clear notifications.
6. Change layouts. In hosted demo mode, Reset my demo restores the seed and retains the layout.

The detailed [walkthrough](docs/DEMO.md) includes expected results and the limits of the simulation.

## Posting feature map

| Posting requirement | Demonstrated behavior |
| --- | --- |
| Secure Google/Gmail connection | Simulated sign-in and mailbox; real provider/connector contracts and an honest explanation page. Real OAuth/API integration is not shipped. |
| Watch selected senders | Add, rename, deactivate and reactivate tracked addresses; unknown senders remain in Inbox. |
| Automatically create numbered cases | `CASE-0001` sequence; intake preserves sender, received date, subject and full message. |
| Attachments | Two generated PDFs and two PNG illustrations; authorized private routes, no uploads. |
| Issue, status and notes | Explicit Save; Open, In progress and Closed; changes recorded in the timeline. |
| Search and dashboard | Combined keyword/number, status, sender and date filters; paginated newest-first cases and matching totals. |
| Threaded follow-ups | Same-thread mail joins its case; inbound replies and sent replies reopen closed cases. |
| In-app/email notification | Bell and toast plus notification mail inside the simulated inbox only. |
| Phone support | Four responsive layouts with the same domain workflow. |

## Four layouts

| Layout | Working style |
| --- | --- |
| Conversation desk (default) | Conversation list, thread and details rail; phone details sheet. |
| Tracker | Compact case rows with status views and a dedicated case page. |
| Mail | Mail-style reading pane, reply and note actions. |
| Board | Paginated status columns; status select moves cards. Phone column tabs support keyboard navigation. |

Layout choice is a presentation cookie, survives sandbox reset and does not change stored case data. Drag-and-drop is not required or implemented.

## Deliberate limits

All identities and `.example` addresses are fictional. There is one landlord persona, no passwords, real OAuth, real mail, visitor uploads or background inbox watcher. Scripted content is finite: sixteen initial cases, forty-three mailbox messages and twenty script entries including replies. The roughly twenty-second response needs an eligible script entry and an open case page; it is not real Gmail latency.

Demo sandboxes expire after 24 hours and are swept during provisioning; configured cap is 50, with provisioning and mutation rate limits. Demo copies are disposable, not a persistent customer service. Isolation is covered by automated tests; independent browser-session isolation remains an explicit deployment check. Browser evidence is partial, not a completed every-layout/every-viewport matrix. See the verification record.

## Going live with a real mailbox

This is additional implementation, not an environment-only switch. Build a real `App\Contracts\SignInProvider` restricted to the owner's Google identity and a real `App\Contracts\MailboxConnector` for inbound mail and threaded replies. Replace the simulated bindings in `AppServiceProvider`, implement production configuration/validation in `ModeGuard`, and only then select `CASEFILE_MODE=production`. This build deliberately rejects that mode.

For a private personal inbox, an owner-run Apps Script bridge is the proposed starting point: authorize it in the owner's account, poll approximately every five minutes, forward selected mail to a new authenticated intake endpoint and provide a secured outbound reply path. Neither bridge nor endpoint is shipped. A Sheet-only script is another product with fewer screens. Direct Gmail API integration is another connector option; polling is simpler to operate than push for one inbox.

Google setup includes a Cloud project, consent audience, least-required scopes, OAuth client and exact HTTPS redirect URI, owner allowlist, protected credentials/tokens, revocation handling and appropriate hosting/scheduling. Testing-state mail authorizations normally expire after seven days. Personal-use apps can qualify for review exemptions; a bridge does not automatically exempt wider distribution. Restricted mail data handled by a server can require verification and an annual assessment. Publishing and verification are separate steps; assessment costs depend on the provider. [Google audience rules](https://support.google.com/cloud/answer/15549945), [restricted-scope review](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), [Apps Script authorization](https://developers.google.com/apps-script/guides/client-verification).

Standard Gmail API use currently has no added charge; script and account quotas apply. Hosting and an optional domain are separate. Illustrative October 2026 prices: shared PHP hosting about USD 3 promotional to USD 11 renewal monthly with a long prepaid term; a small virtual server about EUR 6 before tax and possible IPv4 charges. These are variable examples, not purchases or guarantees. InfinityFree is USD 0 for this demo, with account limits and unconfirmed remote SQLite support. [Google quotas](https://developers.google.com/workspace/gmail/api/reference/quota), [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas), [Hostinger pricing](https://www.hostinger.com/pricing), [Hetzner rates](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/), [IP costs](https://docs.hetzner.com/cloud/servers/primary-ips/overview/), [InfinityFree](https://www.infinityfree.com/).

## Verification and delivery

```sh
PAO_DISABLE=1 php vendor/bin/phpunit --no-progress --display-all-issues
node --test tests/JavaScript/*.test.mjs
```

PHP tests use isolated in-memory/disposable SQLite databases. Packaging tests have separate explicit template/output scope and approval; commands are in [DEPLOYMENT.md](docs/DEPLOYMENT.md). Source lockfiles are retained; no package updates are part of deployment. [The verification record](docs/verification/2026-10-17-casefile-verification.md) distinguishes automated results, screenshots and unfinished host checks.

## Further sources

- [Google Gmail push](https://developers.google.com/workspace/gmail/api/guides/push) and [Pub/Sub pricing](https://cloud.google.com/pubsub/pricing).
- [InfinityFree account limits](https://forum.infinityfree.com/t/all-of-the-limits-on-infinityfree-and-what-they-mean/43467) and [Laravel deployment guidance](https://forum.infinityfree.com/t/how-to-install-a-laravel-site-on-infinityfree/118578). Confirm the actual account before upload.
- [Instrument Sans upstream and license](https://github.com/Instrument/instrument-sans); redistribution notice is included in the package.
- Laravel and installed libraries retain their own licenses in production vendor. Generated attachment provenance is recorded in [ASSETS.md](docs/ASSETS.md).
