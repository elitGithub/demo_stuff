# Haven demo walkthrough

This project is an original portfolio demonstration created for the home-services marketplace brief. All names, addresses, projects and reviews are fictional.

## Explore the three perspectives

- Alex Morgan, customer: compare two proposals for a leaking kitchen tap; inspect ongoing shelves, doors awaiting confirmation, a completed bathroom job with receipt/review, a garden booking and a cancelled paint project.
- Jordan Reed, Juniper Home Services: view matching work, send proposals, read request-specific conversations and track assigned jobs.
- Taylor Brooks, admin: review a pending provider, inspect job stages and manage service categories.

Demo entry is an allowlisted session switch, not an admin password. Seeded passwords are random and never published.

## Upwork feature map

| Requested capability | Screen / behavior |
| --- | --- |
| Customer registration and login | /register, /login; customer account choice; session authentication |
| Provider registration and profiles | Provider account choice, /professional/profile, public /professionals/{slug} |
| Service categories | /services, category filters; admin creation/rename/deactivation |
| Customer job requests | Customer workspace; /requests/create; scoped project details |
| Photo uploads | Request form, previews, validated JPEG/PNG/WebP, authorized private photo route |
| Provider opportunities | /opportunities; active category, approved profile and area matching |
| Quotes / proposals | Versioned proposal creation/editing, private comparison, atomic hiring |
| Customer/provider messaging | /messages and /conversations/{quote}; separate participant-only threads |
| Status tracking | Open → booked → in progress → awaiting customer confirmation → completed |
| Ratings / reviews | One customer review per completed agreement; public profile averages |
| Notifications | /notifications; in-app unread/read filters and explicit read action |
| Basic payment capability | Completed job checkout, explicit simulation acknowledgement, printable receipt |
| Admin dashboard | /admin plus provider, category and job oversight |
| Responsive web | Public and role workspaces designed for phone, tablet and desktop |

## Writable local journey

Register or enter as Alex. Post a Plumbing/Handyman job in Austin or Round Rock, optionally with a photo. Enter as Jordan, open Opportunities, submit a quote and send a message. Switch back to Alex, compare and accept the quote. Jordan can now see the private address and start/finish work. Alex confirms completion, simulates checkout, prints the receipt and leaves a review.

A normally registered provider starts pending. Complete their business name, bio, canonical service areas and an active service category; an admin can approve them. Suspension blocks new proposals, messages and job progress while preserving authorized history.

## Hosted demo behavior

InfinityFree uses MODE=demo. Every database write/delete is rejected by a database connection hook. A web middleware also rejects mutations before file-upload effects. Buttons that change state are disabled where appropriate; a clear read-only notice explains why. Ordinary login, logout and the three demo role switches affect only the visitor's session.

The hosted site includes examples of every workflow stage. Registration/request/quote/review forms remain viewable; submission is disabled by the server. No shared records are changed by visitors. Local MODE=local is used to demonstrate the full persistent workflow.

## Deliberate limits

Payments are simulated and collect no card/bank data. No provider payout or escrow exists. Notifications are in-app only. Chat refreshes normally, with no realtime server. There is no real identity/license verification, tax calculation, scheduling dispatch, dispute system, production fraud prevention or native mobile app. Customer addresses and uploaded photos are disclosed only through policies; admins cannot open private conversations.

For an Upwork proposal, describe this as a purpose-built sample and state the actual role and stack. Do not present fictional businesses or ratings as customers or production usage.
