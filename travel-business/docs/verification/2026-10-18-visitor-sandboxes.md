# Visitor sandbox verification

Date: 2026-10-18. Scope: reviewed local source and generated isolated fixtures.
Hosted verification is pending operator deployment. The public listing is blocked.

## Environment

Node `v24.20.0`; PHP CLI `8.4.26` with PDO SQLite; Apache `2.4.58 (Ubuntu)`;
Python `3.12.3`. These local capabilities do not establish hosted capabilities.
No production environment or existing application database was read. Database
checks create/remove only their own fixtures under `storage/test-runs/`.

## Executed local checks

Commands run from `/var/www/demo_stuff/travel-business`:

| Command | Actual result |
| --- | --- |
| `npm test` | Exit 0; 62 tests, 62 pass, 0 fail. Builds six public pages and dashboard; includes independent contracts/store, Node HTTP, runtime, package, actual browser-handler VM and pagination tests. |
| `php -d zend.assertions=1 -d assert.exception=1 tests/php/SandboxRuntimeTest.php` | Exit 0; 167 PHP runtime assertions passed. The intentional denied-cleanup fixture emitted its expected private diagnostic; the failed slot remained charged. |
| `python3 tests/infinityfree.py` | Final affected run: exit 0, 121 InfinityFree hosting checks passed; no PHP runtime warnings/fatals. Prior expanded run passed 120 checks before generic-error hardening and its additional regression. |
| `php -l deploy/infinityfree/preflight.php` | Exit 0; no syntax errors after final generic-error hardening. |
| `php -l deploy/infinityfree/preflight-secret.example.php` | Exit 0; no syntax errors. |
| `node --check tests/support/BrowserHarness.mjs` | Exit 0. |
| `git diff --check` | Exit 0 at final parent source check. |

Parent independently reran the complete Node, PHP and Apache commands after
Task 6 implementation: 62/62 tests, 167 assertions and 121 checks passed, all
exit 0. Syntax checks passed for all 37 touched PHP source/test files. Generated
`storage/test-runs/` was empty after verification and reviewer harness cleanup.

The Apache run builds a fixture ZIP and runs actual concurrent Apache/PHP workers.
It checks new assets, Elsewhere-only manifest, private denial, legacy sentinels,
independent visitor records, cookies, origin/context rejection, atomic conversion,
capacity/lock bounds, failure accounting and hot-journal recovery. The separate
preflight is copied only into that generated fixture, never into its ZIP.
Preflight checks cover absent/wrong tokens before filesystem fixture work,
protected secret, strict POST JSON, repeated atomic marker replacement, concurrent
hold/probe, blocked finish while held, later successful lock acquisition and
generic storage failures even when the host starts with `display_errors` enabled.

The first unprivileged Apache launch was blocked by the sandbox's loopback socket
restriction. The authorized run used the same isolated command with sandbox
escalation. No hosted request was made.

## Browser evidence

Parent executed the actual rendered UI through CUA's in-app browser on 2026-10-18,
using only generated `storage/test-runs/workspace-lGLbON`. Three independent
host-only cookie contexts shared one browser profile: A on `127.0.0.1:42577`,
B on `127.0.0.2:36607`, C on `127.0.0.3:37947`. These were not separate full
browser profiles. Same-host tabs shared A's context as intended.
The initial harness static-path guard defect was fixed; actual three-origin
HEAD `/contact.html`, GET `/assets/sandbox.js` and owned-fixture cleanup smoke
passed before the corrected walkthrough. The initial fixture was removed.

Run the test-only fixture after `node build.mjs`:

```bash
node --disable-warning=ExperimentalWarning tests/support/BrowserHarness.mjs
```

It prints three loopback origins, its random fixture path and a private control
file path. One process/runtime/queue serves two sandbox slots; host-only cookie
origins isolate visitors A/B/C. Edit only the printed generated control JSON:
`{"offsetSeconds":0,"delayMilliseconds":0}`. Its clock is frozen at launch plus
the offset; `14400` exercises the exact idle boundary after offset-zero activity.
Delay accepts 0–5000 ms and offset 0–31536000 seconds. Controls are files, never
HTTP query parameters, and the harness is excluded from release packaging.
SIGINT/SIGTERM closes listeners and deletes only its own `TestWorkspace`.

| Actual browser action | Observed result |
| --- | --- |
| Contact entry and pre-login submit | Fresh-ready and privacy/four-idle-hour/logout-retention copy visible. Submitted Avery Isolation, `avery@travel.example`, Italy/Italian journey, two travellers and fictional note. Five-second delay immediately disabled submit with Saving your demo enquiry; success focused confirmation, reference `EW-EEEF96BD`. |
| Dashboard entry and keyboard controls | Setup, Entering your demo and Loading records appeared with disabled controls. Normal first entry showed no false access-ended alert. Five enquiries and three bookings appeared; keyboard-opened details focused Close dialog. |
| Status and booking | Contacted save disabled select/save/conversion controls and showed progress/result in the dialog. Conversion displayed Creating demo booking, closed the dialog, selected bookings, put Avery first (`BK-36ED49FB`), showed four bookings/Showing 1-4 of 4 and focused the booking range. |
| Independent context and capacity | B showed only four seed enquiries/three seed bookings, without A's additions. C was denied at the two-slot fixture cap, Entry disabled, Retry demo setup focused; active A/B remained usable. |
| Same-context tabs and logout | Second A tab restored five enquiries/four bookings and Converted status. Logout immediately cleared the first tab, showed progress, then retention copy and focused Entry. A stale second-tab save closed/cleared its dialog/records and focused Entry with genuine access-ended feedback. Re-entry retained A's edits. |
| Pagination and full-data search | Seventeen more UI submissions (`pagination1` through `pagination17` at `travel.example`) yielded 22 enquiries. First page had 20 rows/Showing 1-20 of 22, Previous disabled; keyboard Next showed two rows/Showing 21-22 of 22, Next disabled. Arrow-key tab changes preserved enquiry page two. Searching Olivia from page one found the original page-two record, Showing 1-1 of 1, while full badges stayed 22/four. |
| Desktop and phone | Actual desktop viewport verified as 1440x900. Phone DOM verified 390x844 and dashboard document width 390, without page overflow; cards, search, pagination and contained table usable. Details width 366 with Close dialog focused. Contact was 390x844 with document width 375. |
| Exact inactivity boundary | Prepared unsent Morgan Retained, `morgan@travel.example`, Japan/japan-beyond, 2027-04-02, three travellers, $3,500–$5,000, note and consent. Advanced only the private fixture clock from zero to exactly 14400. Dashboard save cleared dialog/records and focused Start a fresh demo. Contact submit reported expiry, disabled Submit and focused Restart; DOM inspection confirmed every field/checkbox retained and success hidden. |
| Explicit recovery without replay | Contact restart cleared the resolved error, retained values and enabled/focused Submit without submitting. Dashboard restart required separate Entry; it showed four seeds/three bookings and no Morgan record. Only a further deliberate submit saved Morgan (`EW-7D71C843`) and focused confirmation. |
| Capacity recovery and logs | C's explicit Retry after expiry cleanup created a fresh sandbox, enabled/focused Entry. Browser error/warning logs for A/contact were empty; no JavaScript runtime errors observed. |

Actual JPEG screenshots:

- [Desktop booking result](visitor-sandboxes-desktop.jpg)
- [Independent B seed-only dashboard](visitor-sandboxes-isolation.jpg)
- [C capacity and focused retry](visitor-sandboxes-capacity.jpg)
- [Verified phone dashboard](visitor-sandboxes-phone.jpg)
- [Phone details dialog](visitor-sandboxes-phone-dialog.jpg)
- [Expiry with retained unsent values](visitor-sandboxes-expiry.jpg)
- [Disabled status-save controls and progress](visitor-sandboxes-status.jpg)

Viewport overrides apply per tab; dimensions were inspected after applying them.
An initial incorrectly sized phone capture was replaced with the verified phone
capture. Full-page images can place the sticky header at the current scroll
offset; final phone/expiry captures use the actual viewport. Desktop/isolation
use full-page images. The harness exited 0 on SIGINT; its generated fixture was
confirmed absent. The viewport override was reset and all five owned tabs closed.

Reduced-motion emulation is unavailable in the browser tool. Actual
`matchMedia` preference was false. Live CSSOM and source inspection confirmed
the reduced-motion media rule disables animation/transitions and sets automatic
scroll behavior; contact code branches scrolling by that preference. This is
style/source inspection, not an emulated reduced-motion walkthrough.

## Final release evidence

Built after Task 6 adversarial approval:

```bash
node --disable-warning=ExperimentalWarning bin/package-infinityfree.mjs --output deploy/builds/visitor-sandboxes-release
```

Exit 0. Archive: `deploy/builds/visitor-sandboxes-release/travel-demo.zip`,
2,470,258 bytes, 69 files. SHA-256:

```text
7cfe4b03241950d08471131b482358503199e068f13a35c40f8507250a4a4121
```

The [complete ZIP manifest](visitor-sandboxes-release-manifest.txt) contains only
`travel-agency-demo/`. ZIP integrity and unique sorted paths passed. No database,
journal, registry, runtime, test, preflight or diagnostic secret is included.
Private denial, the exact configured HTTPS origin/subsite/runtime path, canonical
inputs, PHP helpers, generated catalog, assets and HTML API metadata were checked
against current source. The root hub and other demos are absent.

All six tasks passed independent adversarial review; earlier findings were fixed
and passed scoped re-review. Final integration review found one documentation
inconsistency about cleanup before admission. Both guides were corrected, and
the scoped final review returned Spec PASS / Quality APPROVED with no open
findings. Runtime source and the release ZIP were unchanged by that correction.

## Hosted acceptance

Pending operator upload/deployment; no hosted bug-fix claim is made. Follow
`deploy/infinityfree/DEPLOY.md` for the protected one-file capability preflight,
complete API/assets replacement, private/legacy preservation, diagnostic removal,
two-context walkthrough, sliding real-time expiry, logout retention and denial
of private files. Record actual host, date, release checksum, results and evidence
before unblocking the listing. No upload, deployment or publication occurred.
