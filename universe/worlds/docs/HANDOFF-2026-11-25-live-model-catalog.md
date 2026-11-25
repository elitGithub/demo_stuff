# Handoff 2026-11-25: Worlds live model catalog (Tasks 1-2) and the dead-saved-models design

For the next agent session on another PC. That session will not have this PC's agent memory
(`~/.claude/projects/-var-www-demo-stuff/memory/`) or the loop files (`~/.claude/projects/-var-www-demo-stuff/
sdd-snapshots/2026-11-25-live-model-catalog/`), so everything needed is in this file. Read it in full, then
`/var/www/demo_stuff/CLAUDE.md` (workspace laws, in the repo), before doing anything.

## 1. Where things stand

- HEAD `51b7307`. Nothing from the live model catalog plan is committed. The operator commits; agents never do.
- **Task 1 (server side): Commit-ready.** Built, adversarially reviewed, 3 fix rounds, each re-reviewed. Last full run,
  each file alone: config 14, catalog 54, http 31, ui 9, engine 21, scribe 41, store 12, openrouter 48, seed 37,
  sync 8; 0 fail. PhpStorm clean on changed lines apart from IDE noise (section 7).
- **Task 2 (browser and README): NOT commit-ready: fix round 3 pending** (section 3, item 1). Built, reviewed, 2 fix
  rounds, scoped re-review done (all 10 test files pass in the reviewer's run).
- **Next task, dead saved models: design drafted and builder-checked, not approved** (section 3, item 2).
- The operator wants to run a play round on Tasks 1-2 before the next task starts.

## 2. Documents

- Catalog design (operator's; rulings 1-22): `universe/worlds/docs/superpowers/specs/2026-11-25-live-model-catalog-design.md`
- Catalog plan (Tasks 1-2): `universe/worlds/docs/superpowers/plans/2026-11-25-live-model-catalog.md`
- Next design (draft): `universe/worlds/docs/superpowers/specs/2026-11-25-dead-saved-models-design.md`

## 3. Open items, in order

1. **Task 2: fix round 3, then re-review, then hand-off.** The scoped re-review of fix rounds 1-2 came back: 2 Medium,
   2 Low, 3 Nit, all checked against the code and confirmed; all 10 test files pass (ui 32, http 31, catalog 54,
   config 14, engine 21, scribe 41, store 12, openrouter 48, seed 37, sync 8). Every earlier finding is fixed except
   these. No operator ruling needed; all are technical or law fixes. Fix round 3 (Sonnet implementer), brief content:
   1. **Ruling 22 broken in the real app:** Clear saved key calls `onSaveSettings({ openRouterApiKey: null })`
      (`InspectorDrawer.mjs:1926`) and `app.mjs:515` replaces the warnings with the server's `[]`. Only the Settings
      Save may replace them.
   2. **Focus moved into a closed drawer:** below 960 px the closed drawer is only translated off screen
      (`styles.css:721-739`) and the Refresh focus return (`FocusKeeper.mjs:14-15`, `InspectorDrawer.mjs:2243-2258`)
      does not check it. Closing the drawer cancels a pending Refresh focus return.
   3. **Buttons lose focus on catalog updates** (no ID): stable ID constants for the modal's Close, Cancel, Save and
      avatar buttons, and the drawer's header Close, 5 tabs, Apply suggested defaults, Clear saved key, Cancel, Save.
   4. **Duplicated Refresh focus decision** (`CharacterModal.mjs:146-150`, `InspectorDrawer.mjs:2243-2247`): one
      `FocusKeeper` static method.
   5. Literal `'settings'` at `InspectorDrawer.mjs:2248`: constant.
   6. `ModelCatalogView.mjs:25`, `:89` `Array.isArray(catalog?.openrouter)`: `catalog === null ? [] : catalog.openrouter`.
   7. Tests, each failing without its fix: fix 1 through the real `WorldsApp` (the drawer harness's `onSaveSettings` is
      a no-op, which is why it was missed); fix 2 (backdrop and Escape); fix 3 (each button x 3 setters); the four
      untested Refresh-return parts (focus outside the container never pulled; drawer flag cleared off the Settings
      tab; drawer and modal flags cleared after the return); `ui.test.mjs:2519-2525` selects a listed model before
      `''`.
   Brief rules as in section 6 (laws in full, per-file sweep, Edit/Write only, Node limits). Then a scoped Opus
   re-review of round 3, own docblock sweep and PhpStorm on changed lines, all 10 test files one at a time, hand-off
   opening "Commit-ready." or "NOT commit-ready: ...".
2. **Dead-saved-models design: waiting for the operator's approval.** The builder check is done (7 questions); the
   operator answered 4 (decisions 6-9 in the doc) and the rest are settled in its "Calls I made" for the operator to
   check while reading. "Open for Operator" is empty. After approval: the plan (writing-plans skill), then the usual
   loop, one task at a time. It starts only after Tasks 1-2 are committed and the play round is done.
3. **Pre-existing, not in scope, not raised as a finding:** the Scene tab still drops focus once the tab-change data
   reload lands (`public/app.mjs:278-292`, unchanged vs HEAD). Proven by the re-review (focus lost with the model load
   never landing; kept when the cast reload has settled).
4. **Cause unknown:** an earlier turn failed with "CharacterMind (Collette) returned malformed JSON after repair retry".
   The reply log (`local/model-replies.log`) now captures replies; agents may read its headers only, never story text.
5. **Process breach to know about:** the Task 2 fix-round implementer wrote one scratch file with a python heredoc
   (scratchpad, outside the repo), against the Edit/Write-only rule.
6. **Roadmap after this plan** (operator's order, one at a time, each brainstormed and designed with the operator):
   1. Dead saved models + display-only browser (the draft design; after the play round).
   2. Response format enforcement without failing: when a model's reply does not match the required format, ask the
      model again to recreate it in the format instead of failing the turn. No format has been chosen; the operator
      decides every LLM output format (section 6).
   3. Per-character tuning: response style, knowledge, logic, protocols, "respond as whom", memories, styling per
      character; the UI shows each character's reply in its own box.
   4. Pull the plots, books and data from Zeta, then cancel Zeta and play only on the operator's PCs.

## 4. Working tree (uncommitted)

- **Task 1:** `src/openrouter/ModelCatalog.mjs`, `src/openrouter/ModelAvailability.mjs` (new),
  `src/openrouter/ModelAvailabilityService.mjs` (new), `src/openrouter/recommended-models.json`, `src/config.mjs`,
  `src/store/SqliteStore.mjs`, `src/server.mjs`, `src/http/Router.mjs`, `tests/catalog.test.mjs` (new),
  `tests/support/createFakeModelCatalog.mjs` (new), `tests/http.test.mjs`, `tests/config.test.mjs`,
  `tests/openrouter.test.mjs`, `tests/ui.test.mjs` (server fixtures).
- **Task 2:** `public/api.mjs`, `public/app.mjs`, `public/components/InspectorDrawer.mjs`,
  `public/components/CharacterModal.mjs`, `public/components/FocusKeeper.mjs` (new),
  `public/components/ModelCatalogView.mjs` (new), `README.md`, `tests/ui.test.mjs`.
- **Docs:** the three documents in section 2 (untracked) and this file.
- **Older uncommitted work from earlier tasks** is mixed into several of the same files (`README.md`,
  `tests/ui.test.mjs`, `src/config.mjs`, `src/server.mjs`, `src/store/SqliteStore.mjs` and others) and sits in
  `src/openrouter/ReplyLog.mjs`, `src/openrouter/ReplyStatus.mjs`, `src/openrouter/OpenRouterClient.mjs`,
  `src/scribe/*`, `src/sync/WorldSync.mjs`, `scripts/seed-from-export.mjs`, `public/styles.css`, `.env.example` and
  their tests. The operator said: "I don't care, dispatch".
- Not the agents': untracked `img.png`, `img_1.png`; deleted `docs/HANDOFF-2026-11-25-task8-seeder.md`.

## 5. What Tasks 1-2 built, and the review state

### Task 1 (server)

- `ModelCatalog`: 4-hour memory + disk cache (`local/openrouter-models-cache.json`, version 2: `models` with
  `providerCount`, `unservedIds`, `uncheckedIds`, `verdicts` `{outcome, providerCount, checkedAt}`). A refresh checks
  every listed model on `GET https://openrouter.ai/api/v1/models/<id>/endpoints`, 10 in flight, plus configured models
  missing from the list. Shared refresh under its own AbortController; `close()` is final. `modelStatus(id)`: verdict,
  then catalog (served), then `unservedIds`, then `uncheckedIds`, else `null`. `modelCheckedAt(id)` (replaced
  `checkedAt()`). `#refreshVerdicts` keeps save-time results recorded during a refresh (ruling 17). A
  `fetchedAtMs: 0` file is the save-only file, valid only with empty lists.
- `ModelAvailabilityService`: `checkSlotChanges`, `checkOverrideChange` (save-time, changed values only; dead ->
  `Not saved: ...` HTTP 400; check could not run -> save with a warning), `blockingMessage(campaignId)` (HTTP 409 on the
  5 LLM routes: turns, Update memory, Tell, Muse): `Refused: <parts>. Change it in Settings or the character window.`
  with `(checked <time>)` per model.
- Router: `GET /api/models` (no query parameters), `POST /api/models/refresh` (CSRF), `warnings` on settings and
  character saves.
- Measured 2026-11-25: 472 listed models, full check 6.6 s, 60 listed IDs with 0 providers; unknown ID -> 404.

### Task 2 (browser)

- Boot no longer waits for the model load; `#loadModels(refresh)` with a sequence number and abort; errors show as a
  `danger` alert; uncapped dropdowns, no `Suggested` group; status lines; Refresh buttons; settings and character save
  warnings (ruling 14: the character window stays open on the saved character).
- Review (Opus): 3 Medium, 8 Low, 2 Nit, all confirmed against the code. Fixed in fix round 1 (Sonnet) and fix round 2
  (Haiku):
  - Character window keeps focus, caret, selection and scroll on async catalog updates (`FocusKeeper.keep`).
  - Drawer catalog updates render only on the Settings tab; drawer scroll kept.
  - Ruling 20: first save warning scrolled into view (`FocusKeeper.reveal`, `block: 'nearest'`).
  - Ruling 21: the Character window's empty option reads `Select an OpenRouter model...` while a filter hides the
    saved override, else `Use tier default (no override)`.
  - Ruling 22: Settings warnings clear only on the next save (not on drawer close, not on Clear saved key).
  - The optgroup renders whenever a catalog exists, also with 0 matches (`OpenRouter Catalog (0 of N)`).
  - Focus returns to the Refresh button when its load ends.
  - Shared `ModelCatalogView` (texts, filter, label, status, `populateSelect`); no duplicated fragments.
  - JSDoc, `@throws`, constant for the modal Refresh ID, README `:55` wording.
  - 11 new ui tests; the fake DOM now drops focus on removal like a browser.
- Re-review attack list (for a rerun): every earlier finding; `FocusKeeper.keep` edge cases (focus outside, removed
  element, disabled target, null document, blank-area click); Refresh focus return when the drawer closes or the tab or
  modal changes mid-load, overlapping loads; off-Settings-tab updates; rulings 20-22; optgroup rule; whether each new
  test fails without its fix (in-memory mutants only); code laws, including `FocusKeeper.reveal` (one-line wrapper, two
  callers) and the two near-identical `#renderCatalogUpdate` methods; screen laws; README `:55` against the server.

## 6. Standing rules (agent memory on the old PC; it does not travel)

- **The operator decides everything.** "No one here makes ANY decisions except me." No product or behaviour decision on
  an agent's own; surface it and ask. Never re-ask a settled ruling.
- **UI is display only.** The backend owns every decision about saved data and its state; the browser renders the
  payload and sends input. Operator: "UI is display. That's it. The only one who knows what models are saved is the
  backend." Flag browser code that derives business state.
- **Never assume an LLM output format.** No JSON or any other format unless the operator gives it; state what a stage
  must deliver and ask. ("Who said anything about JSON?")
- **Models only after a live check:** a model counts as available only if `GET /api/v1/models` lists it and
  `/api/v1/models/<id>/endpoints` returns at least one provider. Repo lists (`recommended-models.json`) are not a
  source. Show the raw check; say nothing about quality without data.
- **No invented limits:** no cap, budget, timeout, retry or extra mechanism unless the operator gave it or it was
  measured; otherwise "unknown, to measure" and no limit.
- **Verify external facts:** nothing about an external service goes into a design, plan or test fake unless seen on
  the operator's real data.
- **Comment and code laws are never Nits:** tag-only JSDoc on every function, method, IIFE, named helper, test helper
  and test-fake method; `@throws` on every uncaught path (assertions and rejected awaits included); no prose comments;
  braces; no single-letter or throwaway names; no magic strings; one declaration per file; no private method with one
  caller; no swallowed errors; no defensive null-coalescing on guaranteed values. Exception (operator): small anonymous
  callbacks written inline as option properties need no docblock. Every brief spells this out in full and requires a
  per-file sweep; the orchestrator sweeps the touched files itself and checks the design's test list line by line
  before dispatching a reviewer.
- **Severity gate:** only Medium+ findings trigger a fix round on their own; technical Lows and Nits are the
  orchestrator's call (fix cheaply or drop, say so in one line); only a Low that changes what the operator sees goes to
  the operator, with a recommendation. Code/comment-law hits are always fixed.
- **Process:** design -> plan -> one task at a time: implementer subagent (Haiku mechanical, Sonnet/Opus reasoning;
  subagents cap at Opus) -> adversarial Opus reviewer ("Assume this code has defects and try to prove it. A finding
  counts only with an input that reproduces it; if you cannot break something, say so.") -> orchestrator checks every
  claim against the code -> fix rounds with scoped re-review -> hand-off opening "Commit-ready." or "NOT commit-ready:
  ...". The orchestrator never writes implementation code. Stop after every task; the operator commits.
- **Locks:** no database access (the operator runs queries); never read `.env`, `config.inc.php`, credentials, or
  anything in `local/` (reply log headers only); git read-only, never suggest commits; Edit/Write tools only (no sed,
  heredocs, file-writing scripts); no deletes without a per-path go; no dependency installs; never start the real
  server; never run the seeder except `--dry-run`, and only the operator runs it for real.
- **Node only under limits, one test file at a time:**
  `NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 120 node --test tests/<file>.test.mjs`
  (from `universe/worlds`). The 10 files: ui, http, catalog, config, engine, scribe, store, openrouter, seed, sync.
- **Replies:** terse, no emojis, no insight blocks, restate open items in full, report what was run and what was not.
- **Scribe (Zeta memory) intent, verbatim:** "The scribe writes the book. Constantly. An analyzer reads the book, checks
  it for inconsistencies. A reminder reminds the Zeta chat from the book." Obvious contradictions are flagged on the
  reply; the reminder opens with the story so far. The 2026-11-13 Scribe design differs and is not the operator's
  intent.

## 7. Tools and checks

- PhpStorm MCP `get_file_problems` with `projectPath /var/www/demo_stuff`, `timeout 180000` for large files. Filter:
  drop `LANGUAGE_ADDITIONS`, `process` and `dirname` hits; keep only lines added in `git diff -U0 HEAD`. Known IDE
  noise: `parsedCache` possibly null, `ReadonlyArray` JSDoc, "throw caught locally", "can be simplified to false",
  unresolved SQL tables, test fakes vs JSDoc types, intentional old-API test assertions, pre-existing duplicate
  fragments (`close()`, `#createField`, modal buttons, drawer identity blocks).
- The docblock sweep script and the reviewers' probes lived in the old PC's `/tmp` scratchpad; they do not travel.

## 8. Operator rulings of 2026-11-25 not yet in a committed design

- Catalog design rulings 17-22 are written into the catalog design (untracked file, section 2).
- Dead saved models (written into the draft design as Operator Decisions 1-5): a dead override is cleared by the server
  and the character runs on its tier default; the warning `<name>'s model override <id> was removed: no OpenRouter
  provider serves it (checked <time>)` shows in Settings and that character's window until the next save there; a dead
  slot keeps turns refused, shows a red alert in Settings and refuses every Settings save until a served model is in
  it; the browser only displays; after the play round. Builder-check answers: archived characters' overrides are
  checked and removed too (catalog ruling 16 extended); a stale window re-sending the ID the server removed from that
  character has it dropped and the rest saved (a fresh dead ID is still refused); the type-to-filter and its count
  label stay in the browser; the dead-slot alert and refusal texts as written in the design.
