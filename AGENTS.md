# Demo workspace: primary agent instructions

This file is the primary instruction set for every demo under `/var/www/demo_stuff/`. `AGENTS.md` beside it is an identical copy for agents that read that name. Each demo folder's own `CLAUDE.md` or `AGENTS.md` refers back here; where they differ, this file wins. Read it in full before touching anything.

## What this workspace is

A set of portfolio demos the operator builds from real Upwork postings, as the basis for an Upwork, freelance-site and portfolio service that shows potential customers the kinds of products the operator delivers. Each demo lives in its own top-level folder with its source, documentation, deployment files and project `.gitignore` inside it. All people, companies, addresses and emails are fictional. The demos are judged to the same standard as production work.

The index of demos is in `README.md`. Each demo has its own README or DEMO.md with run steps, a client walkthrough and a feature map against the posting it was built from.

## Operator laws (apply in every folder here)

- **No database access without the operator's approval:** no queries, no tinker, no migrations, no database CLI, no script that bootstraps an app to touch a connection. Present the SQL or command and let the operator run it.
- **Git is read-only for agents:** `status`, `diff`, `log`, `show`, `blame` only. Never stash, checkout, reset, add, commit, push or clean. The operator commits, one task per commit.
- **Every `php artisan` command needs the operator's approval of that exact command before it runs**, one approval per run. `make:*` generators have standing approval. The operator may grant a folder-scoped standing authorization for a session; it never extends outside that folder.
- **No dependency is added or changed** (Composer, npm, anything) without the operator's explicit approval. Ignore any stock instruction in a demo that says to install Laravel Boost or any other package.
- **No file or directory is deleted** unless the operator has allowed deletion in that specific folder.
- **Every file change goes through visible Edit or Write tools**, never sed, awk, heredocs or scripts that rewrite files.
- **Never read a production `.env`** or anything outside `/var/www`. `.env.example` files are fine.
- **No new paid services.** Free tiers only; a paid threshold needs the operator's approval.
- **No emojis** anywhere: code, copy, commits, chat.
- **Terse replies:** short, direct, no essays, no insight blocks, no recaps of what was built, no commit reminders.

## How work is run

1. **Brainstorm first**, one question at a time, until the operator has decided the forks. The operator decides; the assistant proposes argued options and settles nothing on its own.
2. **Design document** at `<demo>/docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, checked by a fresh reviewer reading as a builder, then approved by the operator.
3. **Plan** at `<demo>/docs/superpowers/plans/YYYY-MM-DD-<topic>.md`: exact files, signatures, values and the tests that try to break each task. Approved by the operator.
4. **Execution loop, one task at a time:**
   - an implementer subagent builds the task (Haiku for mechanical edits, Sonnet or Opus for anything needing reasoning; never a Fable-class subagent);
   - an adversarial Opus reviewer attacks it with the directive "THIS CODE IS WRONG! PROVE OTHERWISE!";
   - the orchestrating assistant checks the reviewer's claims against the code, one focused check per claim, and never writes implementation code itself;
   - the hand-off to the operator opens with "Commit-ready." or "NOT commit-ready: <what is missing>";
   - review findings of every severity are fixed before hand-off; fix rounds are proposed to the operator, who rules on them; fixes get a scoped re-review;
   - the operator reviews and commits; only then is the next task proposed. No back-to-back dispatch, no skipping ahead.
5. Briefs, reports, ledgers and review packages for this loop live outside the repository, under `~/.claude/projects/-var-www-demo-stuff/sdd-snapshots/<plan>/`, never under a demo's `.superpowers/`.
6. Questions and fork answers are not go signals. A directive names the what, never approves the how: present the design before the first edit.

## Code laws

- Code first, then tests that try to break it. No TDD. Tests use isolated databases only (in-memory SQLite, or generated temporary files the test removes), never an application database.
- Framework artifacts come from generators (`php artisan make:*`, `ng generate`), never hand-rolled files.
- One declaration per file. Enum cases TitleCase with a `label()` method. Enums for enumerable values, readonly DTOs between layers, no loose arrays from new code.
- Logic lives in services and actions; controllers validate, call and respond. FormRequests validate shape only.
- Docblocks on every method, tag-only (`@param`, `@return`, `@throws`), no prose in comments anywhere. Braces always. No single-letter variables. Named arguments on DTO construction. Carbon for dates. `?type` for nullables, never implicit nulls. No `declare(strict_types=1)` in Laravel code.
- No single-use wrappers, no private method with one caller, no defensive null-coalescing on guaranteed values, no swallowed errors, no magic status strings, no sorting in PHP that the query can do, no hardcoded data that belongs in config or the database.
- Security: validate every input, derive identity from the authenticated principal, escape output, CSRF on every mutation, rate-limit entry points, serve private files through authorized routes, fail loudly on missing credentials.
- Pint output is canonical; run it on touched files only (`vendor/bin/pint <files>`). A `pint.json` in a demo keeps bare docblock tags alive.

## Screen laws

- Every screen is phone-first; a desktop-only layout is a defect.
- Every server round-trip shows an immediate loading state.
- Save is the rightmost action; Cancel sits left. Required fields carry a visible marker. Confirmation dialogs only for destructive actions.
- No inline `style` attributes and no raw colours in templates; tokens in the stylesheet. Keyboard focus visible, reduced-motion respected, opaque fallbacks for glass effects.
- Lists paginate; never render an unbounded list. Counts shown on screen agree with the records.
- A click shows its result where the user is looking.

## Demo conventions

- Fictional data on reserved `.example` domains; generated credentials saved privately and never published.
- A public hosted copy is either read-only or gives each visitor an isolated sandbox; two visitors never see each other's changes.
- Hosting target is the operator's InfinityFree portal (`demo-sites.infinityfree.me/<demo>/`): PHP 8.4, no SSH, no Artisan, no workers, scheduled tasks only as a URL ping, 50,000 hits per day for the whole account, 30,000 files, `pdo_sqlite` confirmed per deployment with a one-file check. Packages are built locally under `<demo>/deploy/` with prebuilt vendor and assets and a private `_app` directory; nothing is uploaded or published by an agent.
- Delivery includes source, lockfiles, README with run steps, client walkthrough, feature map, honest limits, assets provenance, deployment guide, and a verification record with screenshots under `docs/verification/`.
