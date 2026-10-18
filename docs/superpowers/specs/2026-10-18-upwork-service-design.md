# Upwork service: custom business systems built on working demos

Date: 2026-10-18
Owner: the operator (Upwork profile "Eliyahu T.", Full Stack Web Developer, Haifa)

## Intent

Turn the portfolio demos in this workspace into paid work on Upwork. The pitch is "your system, live in days, built on a base that already works": a buyer clicks through a working demo in their own industry, then pays for a customized copy. The build is the entry point; the steady income is a monthly maintenance retainer, or a managed-hosting tier for clients who want hands-off service.

The demos are not sold as products. What is sold is customization of a proven base, plus ongoing work.

## Why now, and current state

The operator's Upwork profile has been quiet since May 2024 because long-term contracts came from outside Upwork. The profile still has assets: $6K+ earned, 9 jobs, 81 hours, 4 completed reviews all rated 5.0 (two endorsed), Rising Talent, verified ID. It also has gaps that block this plan:

- Portfolio is empty.
- Overview is four short lines and includes "Software is given as is, with no warranty", which contradicts a maintenance offer.
- Past jobs (Telegram bots, GPT integration, a crypto wallet, PHP fixes) do not resemble the demos.
- 0 Connects; Freelancer Plus has lapsed; 5 contracts still show "in progress".
- One existing Project Catalog item: "detailed code review", from $300.
- Off-topic skills (translation, beta reading, typing) were already removed by the operator.

Capacity for Upwork clients: 20 to 60 hours per week.

## Buyers

1. Small and medium business owners who need their first proper website, or have outgrown spreadsheets and messaging apps but do not want to pay for a large CRM they will barely use. They want something that fits how they work now and can grow. Typical example: a reiki and home-cleansing practitioner who posted a $150 job for "a simple website with a booking link".
2. Larger clients who want custom systems. They post jobs, compare proposals, and over-specify. The demos prove experience; they are not bought as-is.

Known failure pattern the offer must handle: small buyers want a large-CRM feature set for a landing-page price; larger buyers bring requirement lists far beyond what they need.

## The offer

### Demos and the packages they back

Six Project Catalog listings, each titled by the buyer's need rather than the demo's original niche:

| Listing (need) | Demo | Live URL |
| --- | --- | --- |
| Appointment booking website for a service business (salons, spas, therapists, coaches, wellness) | Atelier Studio | https://demo-sites.infinityfree.me/studio/ |
| Online ordering for restaurants and cafes | Resto-Chef | https://resto-chef-demo.infinityfree.me/ |
| Lightweight CRM for small sales and service teams | CustomCRM (Krayin-based) | https://turnkey-demo.is-great.org/ |
| Home services marketplace and booking platform | Haven | https://demo-sites.infinityfree.me/haven/ |
| Travel agency website with an enquiry dashboard | Elsewhere | https://demo-sites.infinityfree.me/travel-agency-demo/ |
| Email-to-case tracking for property managers and service teams | Casefile | https://demo-sites.infinityfree.me/casefile/ (deployment in progress) |

All six are linked from the hub at https://demo-sites.infinityfree.me/ (new hub page built locally, upload pending). All demo data is fictional.

Separate work running alongside (all six listings go up now, per the operator):

- Casefile: the real Google sign-in and Gmail connection are built once as a reusable component, plugged into the existing `SignInProvider` and `MailboxConnector` seams, and then included in every Casefile tier. Each client supplies their own Google Cloud project credentials and connects their own mailbox.
- Elsewhere: the hosted dashboard currently shares one database between visitors; the operator is fixing this.

### Tiers (same ladder for every listing)

| Tier | Price | Delivery | Scope |
| --- | --- | --- | --- |
| Launch | $300 | 5 days | The demo rebranded with the client's name, logo, colours, photos and texts; the public site plus the one core flow of that demo (for booking: a booking request that emails the client); mobile-ready; installed on the client's hosting; features outside the tier removed from the code. Requires the intake questionnaire. Includes one 30-minute kickoff call and one written revision round. |
| Business | $600 | 10 days | Launch, plus the staff/admin side of the demo (for booking: admin panel, availability calendar, client records, confirmation emails). One revision round. |
| Growth | $2,000 | 3 weeks | Business, plus the demo's advanced modules (for booking: packages and memberships, reports, staff roles) and one new integration of the client's choice, built for them (for example online payments or deposits through the client's Stripe account, or SMS reminders). Two revision rounds. Includes the first month of the retainer. |

What a tier may promise (my call, from the builder check): a tier lists only what the demo does today, plus wiring that is configuration only, such as real email through the client's own mail provider (the demos simulate email). Anything that needs new code (payments, SMS, a second language, a live mailbox connector) is either Growth's one included integration or a quoted add-on. Each listing's FAQ states plainly what the demo only simulates.

Demos that do not fit "public site plus one core flow" (my calls):

| Demo | Launch | Business | Growth |
| --- | --- | --- | --- |
| CustomCRM (admin-only) | Branded CRM with people, companies, and the opportunity list and pipeline board, for one team | Plus activities and follow-ups, services, printable PDF quotes, and manager and salesperson roles with record restrictions | Plus one new integration (for example a website lead form feeding the CRM) and custom fields |
| Haven (marketplace) | Customer request form and an admin view for handling requests, with the client as the only provider | Plus provider accounts, quotes, and the hire flow | Plus the remaining marketplace modules and one new integration |

Rules that apply to every tier:

- The buyer fills in the Upwork intake questionnaire before work starts.
- Calls beyond those included are billed at $50 per hour.
- Anything outside the tier is a priced add-on or hourly work.
- Hosting is the client's cost. Installation on the client's hosting is included.
- Ownership (operator's decision): the operator owns all the work, including the base and any feature built new for a client. The client receives a permanent, non-exclusive license to use and modify their copy for their own business, and may not resell or redistribute it. Offers state this, with the base described as pre-existing work. For Launch and Business, code for features the client did not buy is removed before delivery, not just switched off.
- When a deal needs a lawyer (operator gets real legal advice before signing; triggers proposed by the assistant): any one of a contract above $5,000; the client sends their own contract, NDA or IP terms; the client asks for ownership, exclusivity or a non-compete; health, financial, children's or other regulated data; warranties, indemnities, uptime guarantees or penalties beyond this offer; the operator holding the client's data on the managed tier for the first time; money moving between third parties (for example marketplace payouts).
- Exception, CustomCRM: its base is Krayin CRM, which is MIT-licensed open source, so the operator does not own the base. The client receives Krayin under its MIT license plus a license to the operator's customization package, and no code is removed.

The Launch price was raised from an initial $150 because explanation, scoping and calls add 2 to 3 hours to every job, on top of roughly 3 hours of build.

### Ongoing work

Retainer, $500 per month:

- 10 hours of work per month, scheduled from the client's requests. Unused hours are lost at month end.
- Bugs: a defect caused by the operator's own code changes is fixed within the 10 hours; if bug work runs past 10 hours in a month, the overrun is free. Anything not caused by the operator's code (client changes, hosting, third parties) is billable.
- Extra hours: $50 per hour, paid upfront in blocks (for example, 100 hours for $5,000) for faster or larger customization.
- Personal QA: $50 per hour.
- Response: review of a reported breakage starts within 24 hours. (The operator did not exclude weekends or holidays; the builder should state it as 24 hours.)
- Hosting: the client pays for it and manages it. If the operator manages hosting, the client is on the managed tier.

Managed tier, from $1,000 per month (hosting fees not included):

- Monitoring around the clock, with alerts reaching the operator.
- Hosting and configuration run entirely by the operator; the client never touches them.
- A staging copy; changes are tested there before going live.
- Includes the same 10 hours of work per month.
- QA: one hour per month is free; all further QA is billed separately at $50 per hour.

### Larger clients

Larger clients are reached through proposals, not packages. The offer to them is a paid first phase built on the closest demo, then a second phase scoped from real use. This trims oversized requirement lists without arguing about them. Pricing is hourly or milestone-based at the profile rate.

## Channels

- Project Catalog listings (passive): the six packages above.
- Proposals to job posts (active): most small buyers post jobs rather than browse packages, so proposals carry the demo link that matches the post. Proposals cost Connects; the account has 0. Buying Connects or renewing Freelancer Plus is the operator's decision and spend.
- Profile and portfolio: the profile is repositioned around custom business systems, with the demos as the portfolio.

## Profile changes

- Title and overview rewritten around custom business systems built fast on working bases, with the six demos as proof. The "no warranty" line goes; the overview mentions the retainer.
- Portfolio: one entry per demo, with screenshots of the live demo and its link.
- Skills aligned with the offer (PHP, Laravel, JavaScript, web application development, CRM, booking systems, and similar).
- Hourly rate stays at $50 (my call: it matches the retainer and extra-hour rates; raising it later is easy).
- The existing $300 code-review package stays (my call: it does not conflict with the new offer).
- The operator checks the 5 "in progress" contracts and closes any that are finished, so the profile does not look stalled.

## Goals

- Win the first two or three jobs from the new packages and proposals.
- Convert build clients to the retainer.

## Non-goals

- Selling the demos as off-the-shelf products.
- Automating anything on Upwork. Agents never post, send, buy or publish on Upwork; the operator does all of that.
- Paid promotion (Upwork ads, profile boost), unless the operator decides otherwise.

## Anti-goals (failure even if everything gets posted)

- Launch-tier buyers getting unbounded scope or unlimited calls for $300.
- Larger clients pulling the operator into unpaid scoping of oversized requirement lists.
- Promising features a demo does not have at package prices.
- Managing a client's hosting without the managed-tier fee.
- Any claim on the profile that is not true: no invented clients, results or numbers. The demos are presented as demos with fictional data.

## Constraints

- Upwork takes a fee from every payment; the operator accepts this.
- A client met on Upwork must keep paying through Upwork for 24 months, so retainers run as Upwork contracts (monthly fixed price or hourly; extra-hour blocks as funded milestones).
- No emojis anywhere.
- Upwork field limits (title length, overview length, skills count, listing fields) must be checked against Upwork's current forms by the builder.

## What gets built (deliverables)

All as Markdown files under `/var/www/demo_stuff/docs/upwork/` (my call), ready for the operator to paste into Upwork:

1. Profile: title, overview, skills list, rate.
2. Six Project Catalog listings: title, category, description, the three tiers with their per-demo scope, intake questionnaire, add-ons, FAQ, and gallery image choices.
3. Six portfolio entries: title, role, description, skills, link, and screenshots.
4. Proposal templates: one for small-business job posts and one for larger clients.
5. A terms sheet covering the retainer, the managed tier, the bug policy and the license wording, to paste into offers.
6. Screenshots of each live demo, captured from the public URLs and saved under `docs/upwork/screenshots/`. Casefile's are captured once its deployment is live.

## Add-ons (my call; prices at $50 per hour)

| Add-on | Price |
| --- | --- |
| Extra 30-minute call | $25 |
| Extra revision round | $100 |
| Extra page | $75 |
| Data import from a spreadsheet | $150 |
| SMS reminders (SMS provider costs paid by the client) | $150 |
| Second language | $200 |
| One module from a higher tier | priced from the hours it takes, quoted before work |

## Left to the builder

- All wording, listing order, categories, FAQ content and screenshot selection.
- The per-demo split of features into Launch, Business and Growth, derived from each demo's own README feature list using the pattern above (public site and one core flow; then the staff side; then the advanced modules).
- The license wording, checked against Upwork's current contract terms.
