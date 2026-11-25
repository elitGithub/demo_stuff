# Live OpenRouter Model Catalog & Availability Check: Implementation Plan

Status: draft for operator approval (2026-11-25).
Design spec (approved 2026-11-25): [2026-11-25-live-model-catalog-design.md](../specs/2026-11-25-live-model-catalog-design.md). The design is the source for every behaviour, message text and test case; this plan assigns them to tasks and fixes files and signatures. Where this plan and the design differ, the design wins and the difference is reported.
Workspace: `/var/www/demo_stuff/universe/worlds/`.

## Execution Protocol

- Two tasks, strictly in order: Task 1, operator review and commit, then Task 2, operator review and commit.
- Each task: implementer subagent (Sonnet) -> adversarial reviewer (Opus) -> orchestrator checks each claim against the code -> hand-off opening with `Commit-ready.` or `NOT commit-ready: ...`.
- Each task leaves the app working at its commit. After Task 1 the current browser code keeps working: it already tolerates a missing `recommended` field (`InspectorDrawer.mjs:1715`, `:2196`; `CharacterModal.mjs:589`), and `GET /api/models` ignores its old query parameters.
- Tests: each test file run alone under `NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 120 node --test tests/<file>.test.mjs`. No test reaches live OpenRouter. No test touches `local/worlds.sqlite` or `local/openrouter-models-cache.json`; temporary directories and SQLite files are created by the test and removed by it.
- File changes through the Edit and Write tools only. Never read `.env`. Git read-only. Never disable or break code to watch a test fail.
- Code laws (`/var/www/demo_stuff/CLAUDE.md`): tag-only JSDoc with `@throws` on every reachable uncaught path, braces always, no single-letter names, no magic strings, one class or enum per file, no single-caller private methods, no swallowed errors, logic in services not the Router.

---

## Task 1: Server side (catalog, availability check, service, server, Router)

### Files and signatures

1. `src/openrouter/recommended-models.json` (design section 1): `defaultSlots` only, the 5 verified IDs; `recommended` removed.
2. `src/config.mjs` (design section 2): `WorldsConfig.load()` also returns `modelCachePath: path.join(localDir, 'openrouter-models-cache.json')`; keep `logReplies` and `replyLogPath`; update `@returns`.
3. `src/openrouter/ModelAvailability.mjs` (new, design 3a): `export const ModelAvailability = Object.freeze({ Served: 'served', Unserved: 'unserved', Unchecked: 'unchecked', label(value) })`, shaped like `src/store/enums/TurnMode.mjs` (`label` throws `RangeError` on an unknown value).
4. `src/store/SqliteStore.mjs`: `listModelOverrides()` -> `string[]`, the distinct non-empty `model_override` values of non-archived characters across all campaigns (design 3a, "Configured models").
5. `src/openrouter/ModelCatalog.mjs` (design sections 3 and 3a):
   - `constructor({ catalogPath = path.resolve(import.meta.dirname, 'recommended-models.json'), cachePath = null, fetchImpl = fetch, apiUrl = 'https://openrouter.ai/api/v1/models', endpointsUrlFor = (modelId) => \`https://openrouter.ai/api/v1/models/${modelId}/endpoints\`, configuredIdsProvider = () => [], cacheTtlMs = 14_400_000, timeoutMs = 10_000, nowProvider = Date.now } = {})`
   - `static isValidModelId(modelId)` -> `boolean`
   - `getDefaults()` -> frozen 5-slot object; `getRecommended()` and `#recommended` removed
   - `async listModels({ refresh = false, signal = null } = {})` -> `Promise<Readonly<{defaults, openrouter, fetchedAt, stale, warning}>>` (no `includeAll`)
   - `async checkModel(modelId, { signal = null } = {})` -> `Promise<Readonly<{outcome, providerCount, reason, cacheWarning}>>`
   - `modelStatus(modelId)` -> `string | null`; `modelCheckedAt(modelId)` -> `string | null` (rulings 18-19; `checkedAt()` removed); `close()` -> `void`
   - cache file version 2 with `providerCount`, `unservedIds`, `uncheckedIds`, `verdicts`; disk read inline in the constructor; `#writeCache` (two callers); one private provider-request method (two callers); shared refresh under the catalog's own `AbortController`; 10 provider requests in flight.
6. `src/openrouter/ModelAvailabilityService.mjs` (new, design section 5): `constructor({ modelCatalog, store, scribeService })`; `async checkSlotChanges(nextModels, { signal })`; `async checkOverrideChange(characterName, storedOverride, nextOverride, { signal })`; `blockingMessage(campaignId)` -> `string | null`. Every refusal, warning and block text exactly as the design gives it.
7. `src/server.mjs` (design section 4): `modelCatalog` field on the instance; `configuredIdsProvider` built from the store; catalog built with `cachePath: resolvedConfig.modelCachePath` and no type guard; `ModelAvailabilityService` built after `ScribeService` and passed to the Router as `modelAvailability`; start check after `listen` in `start()`; `close()` in `stop()` before the HTTP server closes; `runCli` builds the catalog with the same provider.
8. `src/http/Router.mjs` (design section 5): required options `modelCatalog` and `modelAvailability` (default `new ModelCatalog()` at `:62` removed; constructor check per design); `GET /api/models` without query parameters (`includeAll` gone); new `POST /api/models/refresh`; `PUT /api/settings` inside `#runWithAbortController` with the `models` shape checks, `checkSlotChanges`, and `warnings` always in the response; character `POST`/`PATCH` with the `modelOverride` type check, `checkOverrideChange` before `#requireIdleCampaign`, and `warnings` on the saved character; `blockingMessage` -> `409` on the five `isLlmRoute` routes, Tell preview and commit included.

### Tests (code first, then tests that try to break it)

All the design's "Availability check" test cases that do not need the browser, plus:
- `tests/config.test.mjs`: `modelCachePath` sits in `localDir`.
- A new `tests/catalog.test.mjs` for `ModelCatalog` and `ModelAvailabilityService` (fake `fetchImpl`, temporary `cachePath` directories): ID shape against a list of the measured ID forms (`~`, `:batch`, dots, dashes) and the rejected forms (`?`, `#`, space, `..`, empty segment); provider outcomes; shared refresh; `close()`; cache version 2 round trip and every malformed-file case; `verdicts` ordering in `modelStatus`; ruling 16; the 4-hour lifetime boundary (`t + 14_399_999` sends nothing, `t + 14_400_000` refreshes); clock rollback refreshes; at most 10 provider requests in flight.
- `tests/http.test.mjs`: every `WorldsServer.create` gets the fake catalog (design, Verification Strategy); settings and character save refusals, warnings, shape errors, abort; the `409` block on all five routes; `POST /api/models/refresh` `403` without Origin/CSRF; `GET /api/models` ignores query parameters; server start within the lifetime sends nothing; `stop()` closes the catalog.
- `tests/ui.test.mjs`: only the server fixtures (`:1108-1210`, `:1380-1422`) get the fake catalog, and the default-slot and `recommended` assertions are updated, so the file passes against the Task 1 server. No browser code changes in Task 1.
- Run `config`, `catalog`, `http`, `ui`, `engine`, `scribe`, `store`, `openrouter` test files, each alone.

---

## Task 2: Browser and README

### Files and signatures

1. `public/api.mjs` (design section 6): `getModels({ signal = null } = {})` -> `GET /api/models`; new `refreshModels({ signal = null } = {})` -> `POST /api/models/refresh` with the CSRF headers of the other mutating calls.
2. `public/app.mjs` (design sections 6 and 6a): `#modelCatalog`, `#modelCatalogLoading`, `#modelCatalogError`, `#modelLoadSeq`, `#modelAbortController`; `#loadModels(refresh = false)` replacing `#loadAllModels` (calls `refreshModels` or `getModels`); boot load fired without awaiting alongside health, settings and campaigns; `onRefreshModels` passed to the drawer and the modal; `onSaveSettings` passes `warnings` to the drawer; `onSave` returns the saved character with `warnings`.
3. `public/components/InspectorDrawer.mjs` (design sections 6 and 6a): `setModelCatalogLoading`, `setModelCatalogError`, `setSettingsWarnings(warnings)`; `onLoadAllModels` renamed `onRefreshModels`; one **Refresh OpenRouter models** button; static `Suggested (Unrestricted RP)` group, the 60-item cap and the saved-value restore code (`:2232-2241`) removed; filter and select placeholders, count label, status lines and alerts as the design gives them; focus and caret kept on async catalog updates; Pedant checkbox ID `settings-pedant-enabled`; the "Suggested unrestricted defaults are prefilled below" text unchanged (ruling 15).
4. `public/components/CharacterModal.mjs` (design sections 6 and 6a): `open({ character, modelCatalog, modelCatalogLoading, modelCatalogError, onRefreshModels })`; `setModelCatalogLoading`, `setModelCatalogError`; `#render({ focusName })`; static group and 60-item cap removed; status line with the Settings strings; after a save with warnings the modal stays open on the saved character showing them (ruling 14), otherwise it closes as today.
5. `README.md` (design section 7): the 5 default slot IDs, the 4-hour memory and disk cache, the provider check, the Refresh button, and the turn block; the "non-frontier unrestricted defaults" text unchanged (ruling 15).

### Tests (`tests/ui.test.mjs`)

The design's browser test cases: non-blocking boot when OpenRouter fails; out-of-order refresh race; more than 60 models rendered with no `Suggested` group; count label equals option count and the select falls back to `''` while the text field keeps the saved ID; missing prices never render `$undefined`; warning and danger banners; settings save warnings in the Settings tab; character save with warnings keeps the modal open, without warnings closes it; async catalog update keeps focus and caret in a Settings text field and focus on a number field; the Refresh button sends `POST /api/models/refresh`. The fake DOM gains `activeElement`, `selectionStart` and `selectionEnd`. Then run `ui`, `http`, `catalog` and `config`, each alone.
