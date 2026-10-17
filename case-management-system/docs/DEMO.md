# Casefile client walkthrough

Everything here is simulated. Dana Whitfield, the properties, companies, tenants and `.example` email addresses are fictional. No Google account is needed and no email leaves the application. Hosted demo mode gives each visitor a disposable private copy; local mode shares one local database.

The top bar's Appearance icon opens System, Light and Dark choices before and after sign-in. Open Workspace (the grid icon on phones) for layout choices, Compare layouts, How this runs for real, Sign out and the Demo-only Reset my demo action. Cases, Search, Inbox and Settings remain the main navigation. System follows the device setting, including changes while this page is open. Light and Dark override it and are remembered in this browser across navigation, sign-out and demo reset. Theme does not change case data or layout. If storage is blocked, the selected theme works for this page only and a notice appears. Without JavaScript, the page follows the device setting and the Appearance control stays hidden. Status and Sender remain native selects: their open menus have enhanced spacing and colour in supporting browsers and use the browser's native menu elsewhere. The [dark-mode verification record](verification/2026-10-17-casefile-dark-mode-verification.md) shows the tested phone and desktop controls and identifies the remaining browser and package limits.

## A case from arrival to resolution

1. Select **Continue with Google (simulated)**. On first entry, choose Conversation desk. The seed starts with 16 cases and two unread notifications.
2. Open Inbox. **Deliver next email** advances the finite script and reports whether the email created a case, joined a thread or was ignored. The first scripted new tracked thread creates `CASE-0017` in a fresh copy.
3. Follow the case link. Read the complete conversation and open an available attachment. PDFs and PNG illustrations are private, read-only sample files.
4. Write a reply and send it. It appears in the thread and Inbox's Sent view with a simulated-sending label. Leave an eligible case open for roughly twenty seconds to see the scripted response. If editing when it arrives, preserve your draft until you choose to display the update; the reply can also be delivered with the demo controls.
5. Open Manage case, save an Issue and Notes, and change status to In progress, then Closed. The timeline records status changes. A later inbound reply or your own reply on a closed case reopens it.
6. Search using the case number and Closed status, optionally adding sender and date bounds. Open the result, then use Back to search to retain the filter selection.
7. Open notifications and mark them read. The bell count changes. Casefile's own notification messages remain simulated Inbox mail and do not become cases.

## Control which senders become cases

Open an untracked Inbox message and select Track this sender, or add the address in Settings. Its existing inbox threads are backfilled, oldest first. Changing a display name retains the address identity. Deactivate to stop intake and reactivate to resume/backfill. A sender with cases cannot be deleted; unused senders can be removed.

Only the normalized email address controls matching. Tracked senders, cases, notifications and all changes belong to the current visitor's copy in hosted demo mode.

## Try each way of working

| Layout | What to show |
| --- | --- |
| Conversation desk | Select a conversation, reply alongside the thread and edit details. On a phone, Manage case opens a sheet. |
| Tracker | Scan compact rows and status views, open a case, then return to the list/search. |
| Mail | Read the large message pane; Reply focuses the composer and Note opens details at Notes. |
| Board | Change a card's status; it moves to the destination column and stays in view. Each column paginates. Phone tabs work with arrow keys, Home and End. |

The layout switcher preserves the selected case where applicable. The layout is remembered in a cookie; the case data and workflow are the same in every view. Board uses status controls rather than drag-and-drop.

## Finish the demonstration

Visit **How this runs for real** for the differences between a Sheet-only script, an owner-run Apps Script bridge and direct Gmail integration. The real sign-in provider, mailbox connector, bridge and live scheduling need separate implementation. `CASEFILE_MODE=production` intentionally fails in this build.

In demo mode, **Reset my demo** asks confirmation and restores 16 cases/two unread notifications while preserving the chosen layout. Sign out ends the session; a future hosted sign-in may create a fresh copy. Sandbox expiry/caps and rate limits make this a temporary demonstration, not permanent case storage. Local mode has no sandbox reset.

The [browser checklist](walkthrough-checklist.md) and [verification record](verification/2026-10-17-casefile-verification.md) distinguish observed checks from outstanding viewport, accessibility and hosting checks.
