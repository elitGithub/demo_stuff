# Casefile walkthrough checklist

## Dark-mode and control checks

- [ ] At 390 px and 1440 px, inspect System, Light and Dark on Desk, Tracker, Mail, Board, case details, Search, Inbox, Settings, notifications, How this runs for real, sign-in and the layout picker.
- [ ] At 360 px and 430 px, confirm the two-row header keeps all four main links and the Workspace, Appearance and notification icons inside the viewport; repeat consecutive Board Arrow, Home and End focus checks below the measured header.
- [ ] Switch theme with an unsaved reply/details draft and keyboard focus. Confirm the appearance changes immediately while the draft, focus and scroll position remain.
- [ ] Check saved choice after refresh, navigation, sign-out, a second tab and demo reset. Confirm System follows a live device setting change and explicit Light/Dark do not.
- [ ] Check status, action, avatar, field, modal sheet and glass contrast; visible focus; opaque fallback and reduced motion where browser controls allow.
- [ ] Open case and Board Status and Search Sender selects in Light and Dark on phone and desktop. In a supporting browser, check the rounded option picker, selected checkmark, focus and hover, scrolling, long Sender wrapping, and the open case menu above its dialog without clipping. Record native fallback in other browsers separately.
- [ ] Use the keyboard to change Appearance radios, commit and cancel separate native select choices with Escape, submit Search with Sender, and perform one approved Board status change. Check draft, focus, pending feedback and counts.
- [ ] Check no-JavaScript device fallback and hidden Appearance control, live device changes, forced colours and reduced motion where browser controls allow. Record unavailable capabilities in the dark-mode verification record.

The earlier dark-mode browser pass observed both themes on the named pages at 390 × 844 and 1440 × 900, plus header widths at 360 and 430 px. Its former Theme and select-caret screenshots are superseded for control appearance. The final control pass observed the Theme group fitting at 360 and 430 px without document overflow, native radio arrow keys, and a two-tab Dark-to-Light update that retained an unsaved Notes draft and focus. At 390 px, enhanced case Status opened above the phone dialog in both themes; keyboard selection committed one unsaved value and Escape cancelled another. Long Sender options wrapped within the phone menu in both themes, Search returned the four expected Northway cases, and open Sender menus were captured at 1440 px. Both themes' open Status menus were also captured in the 1600 px details rail. One approved Board change moved CASE-0016 to In progress with matching card focus, feedback and Open 4 / In progress 3 / Closed 9 counts; its pending state completed too quickly to capture. Consecutive Board keys passed at 360 px. The aggregate boxes remain open where their full route/viewport matrix or unavailable media/fallback capabilities were not exercised. The preview loaded final source CSS through an existing development hot file, so these observations do not verify the production bundle. See the [dark-mode verification record](verification/2026-10-17-casefile-dark-mode-verification.md) for screenshots and exact limits.

Task 15, October 2026. Source and isolated PHPUnit checks do not substitute for the browser checks below. Use only the expressly approved isolated preview; never an application database. Primary's partial CUA observations are recorded below. Blank boxes mean the complete check remains pending, not passed; individual observed parts are listed separately.

## Browser geometry matrix

Primary measured the following surfaces at each width after the return-link CSS fix. Every entry below means no document-level horizontal overflow only; it does not mean the full journey or every mutation was repeated at that size. Document widths were 345, 375, 415, 753, 1265 and 1705 px respectively. Board's contained horizontal columns and the navigation strip may scroll within their own containers.

| Layout | Phone 360 px | Phone 390 px | Phone 430 px | Tablet 768 px | Desktop 1280 px | Wide 1720 px |
| --- | --- | --- | --- | --- | --- | --- |
| Desk case | Pass | Pass | Pass | Pass | Pass | Pass |
| Tracker case | Pass | Pass | Pass | Pass | Pass | Pass |
| Mail case | Pass | Pass | Pass | Pass | Pass | Pass |
| Board index | Pass | Pass | Pass | Pass | Pass | Pass |
| Search | Pass | Pass | Pass | Pass | Pass | Pass |
| Settings | Pass | Pass | Pass | Pass | Pass | Pass |
| Inbox | Pass | Pass | Pass | Pass | Pass | Pass |
| Notifications | Pass | Pass | Pass | Pass | Pass | Pass |
| How this runs for real | Pass | Pass | Pass | Pass | Pass | Pass |

The journey checklist below remains aggregate: blank boxes retain any unverified part or layout/viewport combination. Specific completed actions appear in the evidence record.

## Full journey, per layout on phone and desktop

- [ ] Enter through simulated Google sign-in; simulated-mail notice is visible; new visitor reaches the picker.
- [ ] Compare layouts, select the layout and confirm the switcher marks it; switching preserves the useful current page and filters.
- [ ] Deliver mail; pending feedback appears immediately and progress/counts agree with the new case. Open its case from the workspace and simulated Inbox.
- [ ] Read the conversation and open a private attachment through its authorized route; record actual viewing separately from link rendering.
- [ ] Send a reply; see the outbound message and Sent mailbox entry, then the simulated reply and toast.
- [ ] During the reply timer and an inflight delivery, type into reply, Issue, Notes and Status; each draft survives. An unchanged successful delivery reloads with the toast. Draft-preserving arrival shows the delivered state and an explicit discard/show action.
- [ ] Edit Issue, Notes and Status; Cancel is left of Save, Save is rightmost, required markers are visible, and the saved result appears where expected.
- [ ] Close and reopen the case; status, counts and history agree. No confirmation appears for these reversible actions.
- [ ] Search by number, message text and notes; combine status, sender and dates; follow a result and Back to search; verify retained filters and pagination.
- [ ] Add the fictional cousin as a sender and see inbox backfill create their case. Rename, deactivate and reactivate; field errors stay with the submitted form. Only deletion/reset asks for destructive confirmation.
- [ ] Read notifications, mark read and verify the bell count.
- [ ] Open How this runs for real from the nav. Check ordered sections, readable option cards, recommendation, five cost rows, current markers and official source links.
- [ ] Reset the isolated demo; story and counts return to their initial values while the layout choice survives. Sign out; protected pages redirect to sign-in.

## Layout-specific checks

- [ ] Desk: phone shows one pane at a time; list links open the selected conversation. On wide desktop, sidebar, case list, conversation and edit rail fit without document overflow.
- [ ] Tracker: phone filter navigation stays usable above the demo banner, wrapping text and counts; desktop sidebar and dense rows fit. Ordinary and opaque-fallback backgrounds stay readable.
- [ ] Mail: phone moves from list to reading; desktop has the grouped list, latest-message preview/unread markers, facts and reading pane. Reply focuses the composer. Note opens/focuses Notes; close returns focus to Note. Toolbar does not hide controls.
- [ ] Board: phone status tabs and contained swiping work; Left/Right/Home/End keyboard controls select columns. Desktop shows all columns. Changing status shows immediate pending feedback and reveals/focuses the moved card in the destination, including paginated columns. Column pagination retains the other columns' pages and correct fragments.

## Shared accessibility and responsive checks

- [ ] At 360, 390, 430, 768, 1280 and 1720 px, inspect top bar, demo banner, forms, long subject/address text, search, settings, Inbox and the real-connection page. No document-level horizontal scrolling or clipped essential actions.
- [ ] Tab from the skip link through nav, layout picker/switcher, lists, pagination and forms. Focus is visible inside clipped containers; labels and required markers identify fields. No keyboard trap except the active modal sheet.
- [ ] At phone/tablet widths, open Manage case; close with its button and Escape, verifying focus restoration. Open Note in Mail and confirm the correct return control.
- [ ] Trigger details validation errors and visit a details hash; sheet reveals and focuses the invalid/target field. Resize across 1500 px while open and while editing; draft, modal state and wide rail remain usable.
- [ ] Observe immediate pending state on brand/home, all nav/list/pagination links, sign-in/out, layout choice, delivery controls, case forms, sender forms and notification actions. Check recovery/back navigation does not leave controls disabled. New-tab attachments/sources and local fragment controls are distinct from page requests.
- [ ] With reduced motion actually enabled/emulated, verify animation and transition suppression. Record the method; source rules alone do not count.
- [ ] With reduced transparency or backdrop-filter support disabled, verify opaque, readable glass surfaces, including Tracker sidebar. Record the method; do not claim unsupported emulation.
- [ ] Inspect console and network for actual errors if those surfaces are available. Record unavailable inspection explicitly.
- [ ] Run with JavaScript disabled if supported; core navigation/forms remain usable, Board keeps its Save status fallback and details content can be reached. Record unsupported controls rather than implying a pass.

## Evidence and remaining limits

- Browser results are partial, reported by primary from the authorized isolated CUA preview on 2026-10-17. No implementer-controlled server or browser was started.
- Desk observed: actual automatic reply after the configured delay preserved reply, Issue, Notes and Status drafts; explicit discard displayed the new reply. Phone details modal closed with Escape and restored focus. Saved Issue and Notes persisted, including another save after resumed checks. Adding Sam with a display-name email header backfilled one case. A reset returned totals to 16 cases and two unread notifications. Final post-fix 1720 px geometry passed: complementary nonmodal rail left 1389/right 1689/width 300; thread left 558/right 1373; both start at y 538.55 with no rail/thread collision. The sticky composer intentionally overlays scrolling thread content.
- Browser found a real desktop defect: the shared breakpoint rule hid Back to search above 768 px. The rule was removed and wide Desk grid rows adjusted for the visible return control. Tracker then visibly followed a CASE-0017 search result and Back to search returned to the filtered results. Isolated regression follows combined keyword/status/sender results and their exact returned filter values in all four layouts.
- Tracker observed: actual automatic reply, close and reopen, search/result/back round-trip and Sam backfill. Operator cleared the stalled native reset confirmation; reset then restored 16 cases and two unread notifications. Full journeys were not repeated at every size.
- Mail observed: layout switch preserved the current case; Closed filter listed nine cases; first script delivery created CASE-0017. At 360 px Note opened the native modal focused on Notes, Close details returned focus to Note, and Reply focused the composer. Sent reply and actual timed automatic reply appeared; close, combined case-number/Closed search and Back to search passed. Sam backfill, deactivate/reactivate retained one case. Operator accepted reset; totals returned to 16 cases/two unread with Mail preserved.
- Board observed: delivery, reply, actual timed automatic reply and close passed. Sam backfill created CASE-0018; changing its select to Closed automatically submitted, redirected to its card fragment, focused the card article and revealed Closed at left 20 px on a 360 px viewport. Closed total was 11. Closed page two retained its column fragment/position, displayed Page 2 of 2 and had no document overflow. Case-number/Closed search and Back to search passed. Actual touch swiping was not performed.
- Board keyboard correction passed primary's final actual browser check with `app-BXtwaOZi.js`. At 360 × 800, consecutive native ArrowRight, ArrowLeft, Home, End, ArrowRight and ArrowLeft presses retained the active tab with its href matching the fragment. The focused tab remained below the sticky header and above the fixed banner: top 301.19/bottom 345.19, header bottom 228, banner top 755.20, outer scrollY 0. The final settled state selected Closed with its column at left 20 px; document width 345 versus viewport 360 meant no document overflow. At 430 px Home left the focused tab at top 303.59/bottom 347.59 below header bottom 228. At 768 px End left it at top 245.59/bottom 289.59, between header bottom 146 and banner top 749.20; document width 753 versus viewport 768. The earlier focus-only correction also preserved moved-card focus and Next/Previous column pagination; final geometry changes were local to the keyboard handler. Scoped final review passed with no actionable findings, recorded externally in `task-15-focus-completion-rereview.md`; primary checked the code and independently reran all nine Node tests successfully.
- Shared observed: authorized `/attachments/2` opened `kitchen-sink-leak.png` in a new tab; the complete 1200 × 800 image and actual screenshot were inspected. Notifications Mark all as read changed the bell from four to zero and removed Unread labels. Renaming Sam to Aaron moved the row first while retaining one case. Inbox Sent showed the actual outbound reply and case link. The real-connection page's five ordered sections, three cards, bridge recommendation, five cost rows and official source anchors were read in the browser; external source destinations were not thereby verified.
- Combined notes search for `Afternoon visit agreed` with Open, Marcus and both dates set to 2026-10-17 returned one case. Opening it, switching Tracker to Desk and following the visible desktop Back to search retained every filter.
- Recovery tab 2 and final inspected browser console error/warning logs were empty. Operator accepted the final Board reset; seed totals returned to 16 cases and two unread notifications. Primary signed out through the UI, then navigating to protected `/` redirected to `/sign-in`. Network inspection, media emulation and JavaScript disabling are unavailable in the current CUA tool; no browser pass for them is claimed. The earlier native confirmation stall was cleared by the operator; it was a browser-tool limitation, not an application source fix.
- Existing screenshots, verified as files on 2026-10-17; viewport dimensions and capture timing supplied by primary are listed below. These capture selected states and do not complete the pending browser matrix.
- Preview template: primary reports its last SHA-256 unchanged: `1A28150D776CF08F5BEEE0E64539CC4B92A0698575B6D2929A8C66BFEDDB2F43`, matching the external preview execution record. No template rebuild was performed for this evidence reconciliation.
- Preview closure: primary stopped server session 77543 with exit 0, closed the browser tabs and reset the viewport. The template hash remained unchanged and the template was retained through Task 16 package verification. After the final review passed, the operator accepted the documented browser limits and directed closure; primary validated and removed only the approved disposable preview root. The package remains retained. Unchecked browser items remain unverified, not passed.
- Isolated feature evidence: initial Task 15 `ForRealPageTest` and `ChromeTest` pass: 77 tests, 1277 assertions. Includes rendered no-inline-style and pending-hook checks across eight routes in each layout. The subsequent combined-search regression passes in all four layouts: one test, 48 assertions. Touched-file Pint, PHP syntax checks and rebuilt assets pass. Final stable full suite passes: 746 tests, 13833 assertions, 1 minute 54.002 seconds, no PHPUnit issues. Earlier-task results are recorded externally in their task reports.
- Board correction verification: nine dependency-free Node regression tests pass, both JavaScript syntax checks pass and the final build passes. JavaScript asset is `app-BXtwaOZi.js`; CSS remains `app-Dc6n5ezI.css`. These fixture checks support the actual browser evidence above; they do not replace it.
- Source audit: page navigation/forms use pending hooks; fragment-only controls and new-tab links are intentionally local/separate navigation. Templates use stylesheet tokens; shared focus, reduced-motion and opaque-fallback rules are present. Media behavior is source/test evidence only; no emulation was available.
- Visitor isolation: require independent actual cookie/session evidence before marking browser-verified; existing automated isolation coverage is separate evidence.
- InfinityFree account limits, remote PHP/SQLite extensions and hosted behavior remain operator checks; no upload or host inspection is part of Task 15.

## Captured screenshots

| Existing file | Viewport | Evidence boundary |
| --- | --- | --- |
| [2026-10-17-picker-desktop.jpg](verification/2026-10-17-picker-desktop.jpg) | 1600 × 1000 | Desktop layout picker |
| [2026-10-17-desk-phone.jpg](verification/2026-10-17-desk-phone.jpg) | 360 × 800 | Desk phone state; full journey remains partial |
| [2026-10-17-desk-desktop-drafts.jpg](verification/2026-10-17-desk-desktop-drafts.jpg) | 1600 × 1000 | Desk drafts before the latest return-link CSS change; does not verify final wide geometry |
| [2026-10-17-tracker-phone.jpg](verification/2026-10-17-tracker-phone.jpg) | 360 × 800 | Tracker phone state; full phone journey remains pending |
| [2026-10-17-tracker-desktop.jpg](verification/2026-10-17-tracker-desktop.jpg) | 1600 × 1000 | Tracker after CSS fix, with actual automatic reply observed |
| [2026-10-17-mail-desktop.jpg](verification/2026-10-17-mail-desktop.jpg) | 1720 × 1000 | Mail desktop state |
| [2026-10-17-board-phone.jpg](verification/2026-10-17-board-phone.jpg) | 360 × 800 | Board phone state; touch swipe not performed |
| [2026-10-17-board-desktop.jpg](verification/2026-10-17-board-desktop.jpg) | 1720 × 1000 | Earlier Board desktop state before the keyboard correction |
| [2026-10-17-board-desktop-final.jpg](verification/2026-10-17-board-desktop-final.jpg) | Desktop; capture 1705 × 991 | Final desktop Board capture; phone focus evidence is recorded separately |
| [2026-10-17-board-phone-focus.jpg](verification/2026-10-17-board-phone-focus.jpg) | 360 × 800 | Intermediate failure: active tab retained but hidden behind the sticky header; not passing focus evidence |
| [2026-10-17-board-phone-focus-final.jpg](verification/2026-10-17-board-phone-focus-final.jpg) | 360 × 800 | Final passing visible-focus state after the geometry correction and consecutive native keys |
| [2026-10-17-for-real-phone.jpg](verification/2026-10-17-for-real-phone.jpg) | 360 × 800 | Real-connection page on phone |
| [2026-10-17-desk-desktop-final.jpg](verification/2026-10-17-desk-desktop-final.jpg) | 1720 × 1000 | Final Desk geometry after return-link CSS fix |
