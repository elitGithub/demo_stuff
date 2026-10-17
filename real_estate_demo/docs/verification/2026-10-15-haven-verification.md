# Haven verification record

Started 2026-10-15; final checks continued into 2026-10-16 (Asia/Jerusalem). This is an original portfolio demonstration, not previous client work.

## Automated verification

- Full isolated PHPUnit suite: 196 tests, 783 assertions; one intentional skip for the separately authorized file-backed concurrency test.
- Opt-in HiringConcurrencyTest: 1 test, 4 assertions. Two workers competing for a request produce one successful hire, one conflict, one accepted quote and one booking event.
- Focused review regressions: 21 tests, 136 assertions, covering private photo validation/storage cleanup and receipt access.
- Production Vite build passed; locally bundled fonts and assets.
- Targeted Laravel Pint check passed; composer validate --no-check-publish passed.
- Deployment export regression compiled the actual migration schema with a disconnected MySQL grammar and serialized fictional in-memory fixture rows. No MySQL server was accessed.
- Upload ZIP extraction audit passed, including required empty runtime directories, private-path protection files, MODE=demo template and exclusion of environment/runtime database files.

The test harness forces SQLite :memory: and prevents external HTTP calls. Concurrency fixtures are separately guarded and removed. No live hosting database was accessed. Commands and approvals are recorded in the execution ledger.

## Real browser checks

The approved local preview runs at http://127.0.0.1:8091. Fictional browser data remains in its local SQLite database; exported hosting fixtures come independently from the clean test seeder.

| Area | Evidence |
| --- | --- |
| Discovery | Homepage, all six category links, matching professionals, Round Rock filtering and Juniper public profile |
| Customer account | Ordinary registration, mismatched-password error with name preserved, corrected registration, logout/login and empty workspace |
| Request/photo | Created a plumbing request with the original kitchen PNG; private photo rendered; preview-removal control verified |
| Quote/message/hire | Jordan submitted a $185.50 proposal and message; Alex hired it; private address appeared for the hired provider |
| Progress/payment/review | Provider started/finished work; customer confirmed, acknowledged simulated checkout and created a receipt/review |
| Provider onboarding | Avery registered pending, completed a Handyman/Austin profile, was approved by admin, logged in and submitted a $95 proposal |
| Admin | Painting deactivated and restored; cancelled historical paint project remained readable |
| Notifications/history | Read action reduced unread count and moved activity to the Read filter; completed conversation retained messages and disabled composing |
| Phone, 390px | Registration, mobile sign-in/sign-out, proposal, hiring, status progression, simulated checkout, receipt and review; no document overflow |
| Tablet, 768px | Customer workspace inspected, no document overflow |
| Desktop, 1440px | Public profile and admin dashboard inspected |
| Browser diagnostics | No warning/error console entries observed during the verified journeys |

Receipt print control was clicked. The in-app browser exposed no native print preview, so printed page layout is not visually certified. The print stylesheet hides the actual header, workspace sidebar, footer and demo bar.

Reduced-motion and reduced-transparency styles are included; automated OS preference emulation is not available in this browser tool. Phone navigation opens and closes with Escape, returning focus to its toggle. Final read-only browser verification is recorded below.

## Independent review

One independent final reviewer inspected the implementation against the approved plan. Four Important findings were reproduced and corrected:

1. Failed photo writes could leave the partially written file. Storage now allocates the filename before writing and removes that exact path on failure; the regression writes bytes before throwing.
2. Hired providers could not read receipts. Policies and the completed-job link now preserve access for the hired provider, including after suspension. Checkout remains customer-only.
3. ZIP omitted empty Laravel runtime directories. Directory entries are preserved and an extraction audit checks them.
4. A header-only PNG could pass metadata checks. Bounded GD decoding now rejects malformed pixel data before storage.

The same reviewer rechecked those fixes and reported PASS WITH SUGGESTIONS, with no remaining Important concern in the fixes.

Deferred Minor: invalid admin category edits reload persisted values instead of recovering unsaved fields. The operator must re-enter those edits. It does not alter stored data.

## Read-only mode verification

Database-hook mutation tests, HTTP rejection, session-only authentication and seeded read-only browsing pass in the isolated suite.

An attempted browser mode switch on the existing --no-reload development server did not change its inherited MODE=local environment. The test request was saved locally; this was a verification setup error, not a passing demo-mode test. Local .env was restored. On 2026-10-16 the operator approved and we ran MODE=demo php artisan serve --host=127.0.0.1 --port=8092 --no-reload exactly once. The separate preview at http://127.0.0.1:8092 visibly runs in read-only mode.

The separate read-only browser check passed:

- Customer/provider/admin role switches work.
- A fully populated request with the original kitchen PNG is rejected with the read-only response.
- New account registration is rejected with the same response.
- An existing fictional account can sign in and out without database writes.
- Admin category creation/save controls are disabled.
- The hired provider can open the completed job receipt.
- The SQLite file and all three private files have identical SHA-256 values before and after the entire check. See [machine-readable result](readonly-browser-result.json).
- No browser console warnings or errors were observed.

Both local previews remain available: writable http://127.0.0.1:8091 and read-only http://127.0.0.1:8092. No application source changes were needed for this verification.

## Deployment limits

Prepared for a configurable subdirectory such as /home-services-demo/ on the existing InfinityFree portal. No publishing has occurred. The operator must confirm PHP/extensions, import into a new empty MySQL database, configure a fresh application key and host credentials, and check HTTPS/subdirectory assets/private-path denials/read-only behavior on the actual host. The generated MySQL import has not been executed on a live MySQL server.

## Screenshots

- [Read-only rejection](readonly-submission-blocked.png)
- [Read-only admin workspace](admin-readonly-desktop.png)
- [Read-only homepage](home-readonly-desktop.png)
- [Desktop homepage](home-desktop.png)
- [Phone homepage](home-phone.png)
- [Phone receipt](receipt-phone.png)
- [Desktop admin workspace](admin-desktop.png)
- [Tablet customer workspace](customer-tablet.png)
- [Desktop professional profile](professional-desktop.png)

Legacy retirement and the final post-removal check are recorded separately in ../legacy-retirement.md.

## Post-retirement verification

Legacy retirement is complete. The full isolated suite again passed (196 tests, 783 assertions, one deliberate opt-in skip), production build passed, and homepage/profile/private image/role switches/completed job/receipt were rechecked in the browser after removal.
