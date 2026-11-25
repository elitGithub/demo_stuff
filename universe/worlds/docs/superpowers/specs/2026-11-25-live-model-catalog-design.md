# Live OpenRouter Model Catalog & Verified Defaults Design

Status: draft for operator approval (2026-11-25). Availability check sections added and revised after two builder reviews (2026-11-25); rulings 12-16 answer them.

## Why

- `src/openrouter/recommended-models.json` (agent-written, never checked) contained 6 model IDs, including 4 of 5 `defaultSlots`, that no provider serves: `GET https://openrouter.ai/api/v1/models/<id>/endpoints` returned 0 providers for each on 2026-11-25 12:38Z (`nousresearch/hermes-3-llama-3.1-70b`, `sao10k/l3.3-euryale-70b`, `thedrummer/rocinante-12b`, `cognitivecomputations/dolphin3.0-mistral-24b`, `thedrummer/valkyrie-49b-v1`, `nousresearch/hermes-4-70b`), and none of the 6 was in `GET /api/v1/models` at 11:58Z. `sao10k/l3.3-euryale-70b` failed in play as the Composer with `HTTP 404: ... no longer available on OpenRouter: no provider serves this model anymore` (`local/model-replies.log`, 12:16Z).
- Both Settings and Character modal dropdowns populated from the static `recommended` list until the user manually clicked "Load all OpenRouter models", and truncated the live OpenRouter catalog to 60 items.

## Operator Decisions (2026-11-25)

1. **Verified default slots** (all 5 listed in `https://openrouter.ai/api/v1/models` and served by at least one provider on `/api/v1/models/<id>/endpoints` on 2026-11-25 12:38Z; answered a real call in play, per `local/model-replies.log` headers: `thedrummer/cydonia-24b-v4.1` as Director and Mind, `cognitivecomputations/dolphin-mistral-24b-venice-edition` as Pedant; not yet called: `nousresearch/hermes-4-405b`, `sao10k/l3.1-euryale-70b`, `thedrummer/unslopnemo-12b`):
   - `director`: `nousresearch/hermes-4-405b`
   - `composer`: `sao10k/l3.1-euryale-70b`
   - `main`: `thedrummer/cydonia-24b-v4.1`
   - `recurring`: `thedrummer/unslopnemo-12b`
   - `scribe`: `cognitivecomputations/dolphin-mistral-24b-venice-edition`
2. **4-hour disk + memory cache** (lifetime set by ruling 8 below): cache the live OpenRouter catalog in memory and on disk at `local/openrouter-models-cache.json` with a 4-hour TTL (`14_400_000` ms). Fall back to the cached catalog with a stale warning if a refresh fails; manual Refresh bypasses the TTL.
3. **Live-only uncapped dropdowns**: remove the static `Suggested (Unrestricted RP)` `<optgroup>` from Settings and Character modal dropdowns, auto-load the cached live OpenRouter catalog on startup without blocking app boot, and remove the 60-item cap so all matching live models are selectable. Retain `defaultSlots` strictly for first-run DB seeding, blank-slot prefill in Settings, and the **Apply suggested defaults** button.
4. **Every model is checked in reality** (operator directive): a model ID counts as usable only after a check against OpenRouter itself. No model list in the repo, and no name or "same family" reading of an ID, is a source.

## Availability Check: What Was Measured (2026-11-25)

- 11 IDs were checked against both `GET /api/v1/models` and `GET /api/v1/models/<id>/endpoints`: the 6 IDs missing from the list had 0 providers, and the 5 listed IDs had 1 or 2 providers.
- The one model seen failing in play (`sao10k/l3.3-euryale-70b`) had 0 providers. A provider count says a model is served. It does not prove a call will succeed: only a real call proves that.
- Each endpoint record carries a `status` number. `thedrummer/cydonia-24b-v4.1` showed `-5` at 12:22Z and answered every real call that day, so `status` is not a usable health signal and is not read.
- Full-catalog check, run once on 2026-11-25 ~12:50Z: 472 listed models, one `/endpoints` request each, 10 requests in flight at a time: 6.6 seconds, all 472 returned HTTP 200, none throttled, none failed.
- 60 of the 472 listed models had 0 providers on `/endpoints`: 19 routing aliases whose IDs start with `~` (for example `~openai/gpt-luna-latest`), 31 `:batch` variants (for example `openai/gpt-4o:batch`), and 10 others (`openrouter/auto`, `openrouter/auto-beta`, `openrouter/auto-code`, `openrouter/bodybuilder`, `openrouter/free`, `openrouter/fusion`, `openrouter/pareto-code`, `nvidia/switchyard`, `typesafe/jev-router`, `openai/gpt-5.2-chat`). Whether any of them answer a real call was not tested. Under ruling 5 all 60 are left out of the dropdowns.

## Availability Check: Operator Rulings (2026-11-25)

1. **Scope:** every model in the catalog shown in the dropdowns is checked, not only the configured slots and overrides.
2. **Check:** provider count. A model passes when `GET https://openrouter.ai/api/v1/models/<id>/endpoints` returns at least one provider. No test call to the model.
3. **When:** on catalog refresh when the cache has expired; at server start only when the cached results are older than the cache lifetime (a start within it reuses the cached results and sends nothing); on the **Refresh OpenRouter models** button, which rechecks the whole catalog at any time regardless of the cache lifetime; and on saving a slot or a character model override (that one model, checked live at save time). The check results are cached together with the catalog, in memory and in `local/openrouter-models-cache.json`.
4. **Failure on save:** saving a slot or a character model override whose model fails the check is refused.
5. **Failed catalog entries:** a catalog model that fails the check is left out of the Settings and Character dropdowns.
6. **Saved slot that later fails:** when a slot or override saved earlier fails the check at server start or on refresh, turns are refused up front with a message naming the slot (or character) and the model, until the operator changes it.
7. **Check cannot run at save:** when the check itself cannot run (OpenRouter unreachable or the request fails), the save goes through with a warning that the model could not be checked.
8. **Cache lifetime:** 4 hours (`14_400_000` ms), replacing the current default of 5 minutes (`cacheTtlMs = 300_000`, `ModelCatalog.mjs:31`).
9. **Per-model request failures during a refresh:** a refresh sends 1 catalog request plus 1 provider request per model (473 requests at 472 models). A model whose provider request fails is left out of the dropdowns, the same as a model with 0 providers.
10. **No checked catalog yet:** when no model has been checked at all (first start with OpenRouter unreachable, or every refresh failed and no cache file exists), turns are allowed; a dead model then fails the turn with OpenRouter's own error.
11. **Manual Scribe actions:** Update memory, Tell and Muse are refused under ruling 6 exactly like turns, whichever slot or override fails. Tell is refused as a whole, preview and commit.
12. **Could not check is not "fails":** only a model OpenRouter reports as not served (0 providers, or 404) blocks turns. A slot whose provider request failed or timed out during a refresh does not block.
13. **A refresh always replaces the cache:** models whose provider request failed are left out even when that empties the dropdowns until the next refresh or a manual Refresh.
14. **Character save warning:** when a character save goes through with a warning, the character window stays open showing the warning; the operator closes it.
15. **Copy:** "Suggested unrestricted defaults are prefilled below" (`InspectorDrawer.mjs:1644`) and "non-frontier unrestricted defaults" (`README.md:43`) stay as they are.
16. **Configured models missing from the list:** every refresh also runs the provider check on each configured model (the 5 slots and every non-archived character override) that is not in OpenRouter's model list. They block turns only when OpenRouter reports 0 providers or 404, like any other model.
17. **A save-time check during a refresh wins** (Task 1 review): a save-time result recorded while a refresh is running is kept over that refresh's result for the same model, in memory and on disk. Every other earlier result is replaced as in ruling 13.
18. **Each result keeps its own check time:** every recorded result stores when it was found: a save-time result, the time its provider request answered; a refresh result, that refresh's `fetchedAt`.
19. **Block message, one time per model:** each model named in the turn block carries its own check time, `(checked <time>)`; the single trailing `Checked <time>.` is removed.
20. **Save warnings in view** (Task 2 review): after a save that returns warnings, in the Settings tab and in the Character modal, the first warning is scrolled into view. The layout is unchanged.
21. **Character modal override dropdown when the saved override is filtered out** (Task 2 review): the `''` option reads `Select an OpenRouter model...` while the saved override is hidden by the filter; otherwise it reads `Use tier default (no override)`.
22. **Settings warnings clear only on the next save** (Task 2 review): closing the drawer no longer clears them, on phone or desktop.

Decision 3 (uncapped dropdowns) departs from the screen law "Lists paginate; never render an unbounded list". It is the operator's decision, recorded here so later reviews do not flag it.

## Architecture & File Contracts

### 1. `src/openrouter/recommended-models.json`

Keep only `defaultSlots` with the 5 verified IDs above. Remove the `recommended` array completely so no static model catalog remains to rot.

```json
{
  "defaultSlots": {
    "director": "nousresearch/hermes-4-405b",
    "composer": "sao10k/l3.1-euryale-70b",
    "main": "thedrummer/cydonia-24b-v4.1",
    "recurring": "thedrummer/unslopnemo-12b",
    "scribe": "cognitivecomputations/dolphin-mistral-24b-venice-edition"
  }
}
```

### 2. `src/config.mjs`

- Add `modelCachePath: path.join(localDir, 'openrouter-models-cache.json')` to the frozen config returned by `WorldsConfig.load()`, updating the tag-only `@returns` JSDoc.
- `local/` is already gitignored, and `WorldSync` only syncs `worlds.sqlite`, so the cache stays strictly local.

### 3. `src/openrouter/ModelCatalog.mjs`

- **Constructor options & validation**:
  - `catalogPath = path.resolve(import.meta.dirname, 'recommended-models.json')`
  - `cachePath = null`: must be `null` or a non-empty string containing no NUL (`\0`) characters (`TypeError` for non-string/non-null, `RangeError` for empty/whitespace or `\0`). `null` runs memory-only for isolated tests.
  - `fetchImpl = fetch`
  - `apiUrl = 'https://openrouter.ai/api/v1/models'`
  - `cacheTtlMs = 14_400_000` (4 hours)
  - `timeoutMs = 10_000`
  - `nowProvider = Date.now`
- Remove `#recommended` and `getRecommended()`. Keep `getDefaults()` returning frozen `{ director, composer, main, recurring, scribe }`.
- **Disk cache file schema** (`local/openrouter-models-cache.json`, camelCase normalized records):
  ```json
  {
    "version": 2,
    "fetchedAtMs": 1764072000000,
    "fetchedAt": "2026-11-25T12:00:00.000Z",
    "models": [
      {
        "id": "provider/model",
        "name": "Display Name",
        "contextLength": 131072,
        "promptCostPerMillion": 0.3,
        "completionCostPerMillion": 0.5,
        "isModerated": false,
        "supportsStructuredOutput": true,
        "providerCount": 1
      }
    ],
    "unservedIds": ["provider/listed-model-with-no-provider"],
    "uncheckedIds": ["provider/listed-model-whose-request-failed"],
    "verdicts": {
      "provider/unlisted-configured-model": { "outcome": "served", "providerCount": 1, "checkedAt": "2026-11-25T12:00:00.000Z" }
    }
  }
  ```
- **Disk cache read (inline in `constructor` — no single-caller private method)**:
  - Runs when `cachePath !== null`.
  - Opens with `fs.openSync(cachePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)` so symlinks fail loudly (`ELOOP`).
  - `ENOENT` is a normal cold cache miss; any other filesystem error (`EACCES`, `EISDIR`, `ELOOP`) throws loudly.
  - Parses JSON inside a targeted `try/catch`; invalid JSON, non-plain-object root (`null`, arrays, primitives), `version !== 2`, non-integer or negative `fetchedAtMs`, non-string or unparseable `fetchedAt` (`Number.isNaN(Date.parse(fetchedAt))`), `Date.parse(fetchedAt) !== fetchedAtMs`, non-array `models`, `unservedIds` or `uncheckedIds` that is not an array of strings, or `verdicts` that is not a plain object whose values are `{ outcome, providerCount, checkedAt }` with `outcome` an enum value, `providerCount` a positive integer or `null` and `checkedAt` a string with `!Number.isNaN(Date.parse(checkedAt))`, is treated as a cache miss (overwritten on the next successful live fetch). A `models: []` file is valid (ruling 13). `fetchedAtMs: 0` marks a file holding only save-time results (no catalog yet, written by `checkModel`); it is valid only when `models`, `unservedIds` and `uncheckedIds` are all empty; otherwise it is a cache miss.
  - Validates cached model entries directly against the normalized camelCase schema (never re-multiplying costs by `1_000_000`): requires non-empty string `id`; coerces `name` to trimmed string or `id`; `contextLength` to positive integer or `null`; `promptCostPerMillion` and `completionCostPerMillion` to finite non-negative numbers or `null`; `isModerated` to boolean or `null`; `supportsStructuredOutput` to boolean; requires `providerCount` to be a positive integer. Skips malformed individual entries, deduplicates by `id`, sorts by `id`, and freezes. If `parsed.models.length > 0` yields zero valid entries, treats the file as a cache miss.
- **Disk cache write (private method `#writeCache`, two callers: a completed refresh and `checkModel`, section 3a)**:
  - Runs when `cachePath !== null`.
  - Checks `fs.lstatSync(cachePath)` (ignoring `ENOENT`): if the target exists and `stats.isSymbolicLink()`, throws an `Error` with `code = 'ELOOP'` loudly (security failure, never downgraded to a warning).
  - Atomic write matching `WorldsConfig.writeSecrets`: `fs.mkdirSync(parentDir, { recursive: true, mode: 0o700 })`, sibling temp file `.openrouter-models-cache-${process.pid}-${randomUUID()}.tmp` opened with `'wx'` and `0o600`, write JSON, `fs.fsyncSync`, close, `fs.renameSync` onto `cachePath`. On failure, closes open descriptor if needed and unlinks temp file if `fs.existsSync(tempPath)`.
  - For non-`ELOOP` write errors (e.g. `EACCES`, `ENOSPC`), returns the freshly fetched models with `stale: false` and `warning: 'Loaded live OpenRouter models, but failed to update local cache: <message>'` so live data is usable while the error is surfaced loudly.
- **`listModels({ refresh = false, signal = null } = {})`**:
  - Update tag-only `@param` and `@returns` JSDoc (`{defaults, openrouter, fetchedAt, stale, warning}`).
  - Validates `refresh` (boolean) and `signal` (`null` or `AbortSignal`). Rejects immediately with `AbortError` if `signal?.aborted`.
  - **Fresh cache hit**: when `!refresh && #cachedModels !== null && #cachedAtMs !== null && nowMs >= #cachedAtMs && nowMs - #cachedAtMs < #cacheTtlMs`, returns frozen `{ defaults, openrouter: #cachedModels, fetchedAt: #cachedAtIso, stale: false, warning: null }` with zero network requests.
  - **Live fetch**: runs as the shared refresh of section 3a, under the catalog's own abort controller. The caller's `signal` only ends that caller's wait: when it aborts, the call rejects with `AbortError` and the shared refresh carries on.
    - On upstream success (`response.ok`, valid JSON, `Array.isArray(parsedBody.data)`): normalizes snake_case upstream records (skipping IDs that fail `ModelCatalog.isValidModelId`), deduplicates, sorts by `id`, runs the provider check of section 3a, then samples `nowMs = this.#nowProvider()` once, after the last provider request, for both `#cachedAtMs` and `#cachedAtIso = new Date(nowMs).toISOString()`, freezes, updates memory cache, performs the disk write, and returns frozen `{ defaults, openrouter, fetchedAt, stale: false, warning }`.
    - On upstream failure (network error, timeout, non-2xx HTTP, malformed JSON, missing `data` array): leaves any prior cache untouched and returns frozen:
      - With prior cache: `{ defaults, openrouter: #cachedModels, fetchedAt: #cachedAtIso, stale: true, warning: '<reason> Showing cached OpenRouter catalog.' }`
      - Without prior cache: `{ defaults, openrouter: [], fetchedAt: null, stale: true, warning: '<reason>' }`

### 3a. Availability check in `ModelCatalog` (rulings 1-19)

- **Model ID shape:** static `ModelCatalog.isValidModelId(modelId)` -> `boolean`: a string matching `^~?[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:-]*$` that does not contain `..`. Tested on 2026-11-25 against all 472 live catalog IDs: every one matches. Catalog IDs that fail it are skipped at normalization; IDs typed by the operator that fail it are refused before any request (section 5).
- **Provider request:** `GET endpointsUrlFor(modelId)`, new constructor option with default `` (modelId) => `https://openrouter.ai/api/v1/models/${modelId}/endpoints` ``. The ID has passed the shape check, so it goes into the path as is (the measured runs used raw IDs, including `/`, `~` and `:`, and all returned HTTP 200). Header `Accept: application/json` only; no API key is sent (the measured runs sent none). Each request uses `timeoutMs`, combined with the abort signal of whoever runs it (the shared refresh, or the save that called `checkModel`). One private method makes this request; its two callers are the refresh and `checkModel`.
- **Outcome of one provider request** (measured responses): HTTP 200 with a `data.endpoints` array of length 1 or more is **served** (`providerCount` = that length); HTTP 200 with 0 endpoints, or HTTP 404 (`{"error":{"message":"Not Found","code":404}}`, which OpenRouter returns for an ID it does not know), is **unserved**; anything else is **unchecked**, with one of these reasons: `timed out after 10 seconds`, `HTTP <status>`, `malformed response`, `network error: <message>`.
- **Configured models:** new constructor option `configuredIdsProvider = () => []`, returning the configured model IDs: the 5 settings slots and the distinct non-empty overrides of all non-archived characters. `server.mjs` wires it to the settings and a new store method `SqliteStore.listModelOverrides()` -> `string[]` (`SELECT DISTINCT model_override FROM characters WHERE archived = 0 AND model_override IS NOT NULL`).
- **Refresh** (inside the live fetch of `listModels`, after the catalog list succeeds): run the provider request for every normalized listed model, plus every configured ID that passes the shape check and is not in the list (ruling 16), 10 requests in flight at a time (measured: 472 in 6.6 seconds, none throttled). Results:
  - listed **served** models, with their `providerCount`, form the catalog the dropdowns show; listed **unserved** IDs go to `unservedIds` and listed **unchecked** IDs to `uncheckedIds`, both left out of the dropdowns (rulings 5, 9);
  - each configured unlisted ID's outcome goes to `verdicts` with `checkedAt` = the refresh's `fetchedAt` (ruling 18); these never appear in the dropdowns;
  - the new cache always replaces the previous one, `verdicts` included, even when it holds 0 served models (ruling 13), except a `checkModel` result recorded while this refresh was running: it is kept in `verdicts` over this refresh's result for that ID (ruling 17).
  If the catalog list request itself fails, the existing stale-cache fallback applies unchanged and no provider requests are sent.
- **Failures are reported, not dropped:** when any provider request was unchecked, the refresh result's `warning` is `<n> of <total> models could not be checked (first reason: <reason>); they are left out until the next refresh.` When the cache write also fails, the two warning texts are joined with one space, the unchecked text first. The refresh writes each non-empty warning to stderr once, with `console.error`.
- **Shared refresh:** at most one refresh runs at a time. A call that needs a refresh while one is running awaits that same refresh instead of starting a second set of requests (server start, browser boot load and a Refresh click can overlap). The refresh runs under the catalog's own `AbortController`. New method `close()` aborts a running refresh and is final: afterwards `listModels` returns the current cache without refreshing and `checkModel` rejects with `AbortError`. An aborted refresh rejects with `AbortError` and changes neither the memory nor the disk cache.
- **Cache file:** `version` becomes `2`; each model entry gains `providerCount` (positive integer); top-level `unservedIds`, `uncheckedIds` (arrays of strings) and `verdicts` (object keyed by model ID, values `{ outcome, providerCount, checkedAt }`) are added. A version-1 file, or an entry without a valid `providerCount`, is treated like the other malformed cases (cache miss, or the entry skipped).
- **`async checkModel(modelId, { signal = null } = {})`** -> `Promise<Readonly<{outcome: string, providerCount: number | null, reason: string | null, cacheWarning: string | null}>>` (`outcome` from the enum below): one live provider request for one model, for save-time checks (ruling 3). It neither starts nor waits for a refresh. Throws `TypeError` when `isValidModelId(modelId)` is false. When the caller's `signal` aborts, or the catalog is closed, before the result is recorded, it rejects with `AbortError`, records and writes nothing (the save is then not made). Every outcome is recorded in `verdicts` with `checkedAt` = the ISO time from `nowProvider` when the provider request answered (ruling 18), in memory and on disk; `fetchedAt` and `fetchedAtMs` are not changed, no catalog entry is added and the dropdowns do not change. A non-`ELOOP` disk write failure sets `cacheWarning` to `The model check result could not be written to the local cache: <message>.` (the save goes through with it as one more warning); `ELOOP` throws.
- **`modelStatus(modelId)`** -> enum value or `null`: reads the cache only, no network. In this order: the outcome in `verdicts` if the ID is there (save-time results are newer than the last refresh); **served** when the ID is in the catalog; **unserved** when it is in `unservedIds`; **unchecked** when it is in `uncheckedIds`; otherwise `null` (never checked). `null` never blocks (ruling 10), and with no checked catalog yet every ID without a verdict is `null`. Plus `modelCheckedAt(modelId)` -> the time of the result `modelStatus` returns: the verdict's `checkedAt`, or the cached `fetchedAt` for an ID found in the catalog, `unservedIds` or `uncheckedIds`; `null` when `modelStatus` is `null`. `checkedAt()` is removed.
- **Enum:** `src/openrouter/ModelAvailability.mjs`, cases `Served`, `Unserved`, `Unchecked` (TitleCase) with a `label()` method, shaped like `src/store/enums/TurnMode.mjs`.

### 4. `src/server.mjs`

- **Catalog on the instance:** the `WorldsServer` constructor (`server.mjs:36-54`) gains a `modelCatalog` field; `create` passes the catalog it builds (or the one injected by tests).
- **Check at server start (ruling 3):** in `start()` (`server.mjs:312`), after `this.#httpServer.listen(...)` (`:345`) succeeds, call `this.#modelCatalog.listModels({ refresh: false })` without awaiting it in the startup path. A start within the 4-hour lifetime reuses the cache and sends nothing; an expired or missing cache runs the full check. Warnings reach stderr from the refresh itself (section 3a), not again here; a rejection other than `AbortError` is written to stderr with `console.error`. Neither stops the server.
- **Stop:** `stop()` (`server.mjs:368-423`) calls `this.#modelCatalog.close()` before closing the HTTP server, so no provider request outlives the server and no cache write lands after shutdown (including after a test's temporary directory is removed).

- In `WorldsServer.create`, default `modelCatalog = null` in option destructuring, resolve `resolvedConfig` first, then instantiate:
  `const activeModelCatalog = modelCatalog ?? new ModelCatalog({ cachePath: resolvedConfig.modelCachePath, configuredIdsProvider });`
  with no type guard: every test that builds a server injects its own catalog (Verification Strategy), so `modelCachePath` is always present when this line runs.
- `configuredIdsProvider` is built in `create` from the store: the 5 non-empty values of `activeStore.getSettings().models` plus `activeStore.listModelOverrides()`, de-duplicated.
- `create` constructs `new ModelAvailabilityService({ modelCatalog: activeModelCatalog, store: activeStore, scribeService })` after the `ScribeService` and passes it to the Router as option `modelAvailability`.
- In `WorldsServer.runCli`, construct `new ModelCatalog({ cachePath: config.modelCachePath, configuredIdsProvider })` with the same provider.
- `WorldsServer.seedDefaultModelsIfEmpty` stays unchanged and seeds the 5 updated `defaultSlots` on brand-new databases.

### 5. `src/http/Router.mjs`

- `GET /api/models`: rejects non-`GET` with `405`; no query parameters (`includeAll`, `Router.mjs:383-389`, is removed along with its tests). Calls `this.#modelCatalog.listModels({ refresh: false, signal })` inside `#runWithAbortController(...)` and returns `200` with `{ defaults, openrouter, fetchedAt, stale, warning }`. Within the lifetime this sends nothing; after expiry it runs (or joins) the shared refresh, so a GET can trigger at most one full check per 4 hours.
- `POST /api/models/refresh` (new; the **Refresh OpenRouter models** button): passes the existing Origin and CSRF check for mutating methods (`Router.mjs:175-182`) and the API rate limit like every other route; calls `listModels({ refresh: true, signal })` (joining a running refresh if there is one) and returns the same shape. A forced recheck is never reachable by GET.
- **Logic lives in a service, not the Router:** new class `src/openrouter/ModelAvailabilityService.mjs`, constructed in `server.mjs` with `{ modelCatalog, store, scribeService }` and passed to the Router as option `modelAvailability`. The Router's default `modelCatalog = new ModelCatalog()` (`Router.mjs:62`) is removed: both `modelCatalog` and `modelAvailability` are required options. The Router constructor check (`Router.mjs:104-106`) requires `listModels` on the catalog (the only catalog method the Router calls) and the three methods below on the service. All message text below is built in the service.
  - `async checkSlotChanges(nextModels, { signal })` -> `Promise<{refusals: string[], warnings: string[]}>`: compares each slot in `nextModels` with `store.getSettings().models`, both trimmed (the store trims, `SqliteStore.mjs:161`). Changed, non-empty values are shape-checked, then checked with `checkModel` in parallel (at most 5). Unchanged slots send nothing. A non-null `cacheWarning` from `checkModel` is added to `warnings`.
  - `async checkOverrideChange(characterName, storedOverride, nextOverride, { signal })` -> the same shape, for one character.
  - `blockingMessage(campaignId)` -> `string | null`: reads `store.getSettings().models` and the non-archived characters from `scribeService.listAllCharacters(campaignId)` (`ScribeService.mjs:42`, which includes archived ones; they are filtered out), and returns the 409 text when any non-empty slot or override has `modelStatus` **unserved**. **Unchecked** (ruling 12) and `null` (ruling 10) never block.
  - Message parts, joined with `; ` into one sentence:
    - refusal, invalid ID: `the <slot> slot model '<id>' is not a valid OpenRouter model ID` / `<name>'s model override '<id>' is not a valid OpenRouter model ID`;
    - refusal, unserved: `the <slot> slot model <id> is not served by any OpenRouter provider` / `<name>'s model override <id> is not served by any OpenRouter provider`;
    - full refusal: `Not saved: <parts>.`;
    - warning: `The <slot> slot model <id> could not be checked: <reason>.` / `<name>'s model override <id> could not be checked: <reason>.` (one string each);
    - block: `Refused: <parts>. Change it in Settings or the character window.`, with parts `the <slot> slot uses <id>, which no OpenRouter provider serves (checked <time>)` / `<name>'s model override <id> is not served by any OpenRouter provider (checked <time>)`, `<time>` = `modelCheckedAt(<id>)` (ruling 19).
- **Save checks (rulings 3, 4, 7):**
  - `PUT /api/settings`: the whole handler runs inside `#runWithAbortController` (today it has no signal, `Router.mjs:321-373`). When `models` is present, the Router first checks its shape, answering `400` with `models must be an object.` when it is not a plain object, `models.<key> is not a model slot.` for a key outside the 5 slots, and `models.<slot> must be a string.` for a non-string value; then it calls `checkSlotChanges`. If the request's signal aborts during the checks, `checkModel` rejects with `AbortError` and nothing is saved. Any refusal: `400` with the full refusal text, and nothing in the request is saved (odds, interval and key included). Otherwise the save proceeds as today and the response always carries `warnings` (an array, empty when there are none).
  - `POST /api/campaigns/:id/characters` and `PATCH /api/campaigns/:id/characters/:characterId` with `modelOverride`: the Router first answers `400 modelOverride must be a string or null.` for any other type (the same text the store uses, `SqliteStore.mjs:570`), then `checkOverrideChange` runs **before** `#requireIdleCampaign` (`Router.mjs:622`, `:691`), so the synchronous idle check and the write stay together and no turn can start between them. The character name in messages is the trimmed `body.name` when it is a non-empty string; otherwise, on PATCH, the stored name, and on POST, `The new character`. Refusal: `400` with the full refusal text. An abort during the check saves nothing, as for settings. Otherwise the response is the saved character with a `warnings` array added.
- **Turn block (rulings 6, 10, 11, 12):** `POST /api/campaigns/:id/turns`, `POST /api/campaigns/:id/turns/regenerate`, `POST /api/campaigns/:id/memory/update`, `POST /api/campaigns/:id/memory/tell` (both `preview` and `commit`, ruling 11) and `POST /api/campaigns/:id/memory/muse`: after request validation and before any model is called, `blockingMessage(campaignId)`; a non-null result is answered with `409` and that text. These are the five routes of `isLlmRoute` (`Router.mjs:256-267`).

### 6. Frontend (`public/api.mjs`, `public/app.mjs`, `public/components/InspectorDrawer.mjs`, `public/components/CharacterModal.mjs`)

- **`public/api.mjs`**:
  - `getModels({ signal = null } = {})` requests `GET /api/models`; new `refreshModels({ signal = null } = {})` sends `POST /api/models/refresh` with the existing CSRF headers used by the other mutating calls. Both get tag-only JSDoc.
- **`public/app.mjs`**:
  - Tracks `#modelCatalog = null`, `#modelCatalogLoading = false`, `#modelCatalogError = ''`, `#modelLoadSeq = 0`, `#modelAbortController = null`.
  - `#loadModels(refresh = false)`:
    - Increments `#modelLoadSeq`, aborts any in-flight `#modelAbortController`, and creates a fresh `AbortController`.
    - Sets `#modelCatalogLoading = true`, `#modelCatalogError = ''`, and calls `setModelCatalogLoading(true)` on both `InspectorDrawer` and `CharacterModal`.
    - Calls `this.#api.refreshModels({ signal: controller.signal })` when `refresh` is true, otherwise `this.#api.getModels({ signal: controller.signal })`. Aborting the browser request only ends that wait; the server's shared refresh carries on (section 3a).
    - If `requestSeq !== this.#modelLoadSeq` or `controller.signal.aborted`, returns without mutating state.
    - On success: stores `#modelCatalog`, sets `#modelCatalogLoading = false`, `#modelCatalogError = ''`, calls `setModelCatalog(catalog)` on both `InspectorDrawer` and `CharacterModal`.
    - On error: sets `#modelCatalogLoading = false`, `#modelCatalogError = message`, calls `setModelCatalogError(message)` on both `InspectorDrawer` and `CharacterModal` (catches locally so boot never fails or leaks unhandled rejections).
  - During `init()`:
    - Fires `void this.#loadModels(false)` concurrently alongside `await Promise.all([getHealth(), getSettings(), listCampaigns({ limit: 25 })])` so slow or offline OpenRouter responses never block rendering campaigns and chat.
  - Passes `onRefreshModels: () => this.#loadModels(true)` in `InspectorDrawer` callbacks and `{ character, modelCatalog: this.#modelCatalog, modelCatalogLoading: this.#modelCatalogLoading, modelCatalogError: this.#modelCatalogError, onRefreshModels: () => this.#loadModels(true) }` into `CharacterModal.open(...)`.
- **`public/components/InspectorDrawer.mjs`**:
  - Public catalog methods:
    - `setModelCatalog(modelCatalog)` — stores catalog, sets `modelCatalogLoading = false`, `modelCatalogError = ''`, runs `#applyBlankModelDefaults()`, renders.
    - `setModelCatalogLoading(isLoading)` — sets `modelCatalogLoading = Boolean(isLoading)`; when `true`, clears `modelCatalogError = ''`; renders.
    - `setModelCatalogError(errorMessage)` — sets `modelCatalogLoading = false`, `modelCatalogError = typeof errorMessage === 'string' ? errorMessage : String(errorMessage ?? '')`; renders.
  - Single **Refresh OpenRouter models** button invokes `this.#callbacks.onRefreshModels()` (no duplicate catch/loading mutation inside the component; `app.mjs` owns loading/error state).
  - Removes static `Suggested (Unrestricted RP)` `<optgroup>` and `.slice(0, 60)` truncation from `#populateModelSelect`.
  - Updates filter placeholder to `"Filter OpenRouter models..."` and select placeholder to `"Select an OpenRouter model..."`.
  - Renders all live models matching `#settingsData.modelFilter` (matching `id` or `name`, case-insensitive) under one `<optgroup>` labeled `OpenRouter Catalog (${matching.length} of ${total})` when filtered or `OpenRouter Catalog (${total})` when unfiltered.
  - Option label formats `${item.id} (${parts.join(', ')})` using `Number.isInteger(item.contextLength)`, `typeof item.promptCostPerMillion === 'number' && typeof item.completionCostPerMillion === 'number'`, and `item.isModerated === true ? 'moderated' : null`.
  - Checks `hasExactOption` against the **filtered** `matching` list (not unfiltered `openRouterList`), falling back to `''` when filtered out.
  - Status line wording:
    - Loading: `Loading OpenRouter catalog...`
    - Loaded fresh (`!catalog.stale && catalog.fetchedAt`): `OpenRouter models: ${count} · Cached ${catalog.fetchedAt}`
    - Loaded stale with cache (`catalog.stale && catalog.fetchedAt`): `OpenRouter models: ${count} (stale cache · ${catalog.fetchedAt})`
    - Loaded stale without cache (`catalog.stale && !catalog.fetchedAt`): `OpenRouter models: 0 (unavailable)`
  - Alert banners: renders `modelCatalogError` as `danger` alert; renders `catalog.warning` (whenever non-empty, regardless of `catalog.stale`) as `warning` alert.
  - Retains **Apply suggested defaults** and blank-slot prefill using `catalog.defaults`.
- **`public/components/CharacterModal.mjs`**:
  - `open({ character = null, modelCatalog = null, modelCatalogLoading = false, modelCatalogError = '', onRefreshModels = null } = {})`.
  - Adds `setModelCatalogLoading(isLoading)` and `setModelCatalogError(errorMessage)` mirroring `InspectorDrawer` (no-op when `#state === null`); updates `setModelCatalog`, `setModelCatalogLoading`, and `setModelCatalogError` to call `#render({ focusName: false })` so async catalog updates never steal keyboard focus while the user is typing in another field (`open()` passes `{ focusName: true }`).
  - Removes static `Suggested (Unrestricted RP)` `<optgroup>` and `.slice(0, 60)` truncation from `#populateOverrideSelect`.
  - Renders all matching live OpenRouter models with the same context/cost/moderated metadata, filtered `hasExactOption` check, single **Refresh OpenRouter models** button (`onRefreshModels`), a catalog status line using exactly the four Settings status strings above, and `catalog.warning` / `catalogError` alert banner.

### 6a. Frontend: availability results

- Dropdowns list only the cached catalog, which holds served models only (ruling 5); no extra filtering in the client. The free-text model fields in Settings (`InspectorDrawer.mjs:1732-1757`) and the Character modal (`CharacterModal.mjs:275-282`) stay; a typed ID goes through the same save check, and the text field keeps showing the saved value. The existing code that puts the saved value back into the dropdown when the filter hides it (`InspectorDrawer.mjs:2232-2241`; `CharacterModal.mjs` has no such code) is removed, so the dropdown follows section 6 exactly: the options are the filtered matches, the count label equals the number of options, and the select falls back to `''` when the saved value is filtered out.
- **Refusals:** a `400` from a settings or character save already shows in the Settings tab (`InspectorDrawer.mjs:1996-1997`) and the Character modal (`CharacterModal.mjs:526-530`); no change.
- **Settings warnings:** `onSaveSettings` (`app.mjs:502-507`) passes `updatedSettings.warnings` to a new `InspectorDrawer.setSettingsWarnings(warnings)`, which shows each as a `warning` alert in the Settings tab until the next save (ruling 22).
- **Character warnings (ruling 14):** `onSave` (`app.mjs:144-170`) returns the saved character, including `warnings`. In `CharacterModal` (`:520-531`), after `await this.#onSave(...)`: when `warnings` is empty the modal closes as today; when it is not, the modal stays open, switches to editing the saved character, and shows each warning as a `warning` alert; the operator closes it.
- **Focus:** `InspectorDrawer.setModelCatalog`, `setModelCatalogLoading` and `setModelCatalogError` re-render the Settings tab without moving focus: if a field inside the drawer had focus, the element with the same ID gets focus back; for text inputs and textareas the caret and selection are restored too (`selectionStart`/`selectionEnd`), while number inputs and the checkbox get focus only (`setSelectionRange` throws on them). The Pedant checkbox gets the ID `settings-pedant-enabled` so it can be found again. This is the Settings-tab counterpart of the Character modal's `{ focusName: false }`. The fake DOM in `tests/ui.test.mjs` is extended with `activeElement`, `selectionStart` and `selectionEnd` so the test can see it.
- A `409` refusal shows through the existing paths: turns via `app.mjs:1091-1102` and `ComposerBar.setAlert` (a JSON 409 sent before the stream opens reaches it through `api.mjs:665` and `:712-739`); Update memory via `InspectorDrawer.mjs:974-977`; Tell and Muse via their own error handlers (`InspectorDrawer.mjs:1216`, `:1284`, `:1325`).

### 7. Documentation (`README.md`)

Update the 5 default slot IDs in `## Models` and describe the 4-hour memory + disk cache (`local/openrouter-models-cache.json`) and live-only dropdowns.

## Verification Strategy

- `tests/config.test.mjs`: verify `WorldsConfig.load()` returns `modelCachePath` at `<root>/local/openrouter-models-cache.json`.
- `tests/ui.test.mjs`:
  - Pass the fake catalog described at the end of this section to `WorldsServer.create` in the earlier `WorldsApp` UI integration test (`tests/ui.test.mjs:1108-1210`) so `init()` never hits the live network or leaks open requests across teardown.
  - Verify updated 5 `defaultSlots` and removal of `recommended`.
  - Verify 4-hour default TTL, fresh memory hit (0 extra fetches), expired TTL re-fetch, clock-skew guard (`nowMs < fetchedAtMs` re-fetches), and `refresh: true` bypass.
  - Verify disk cache persistence across `ModelCatalog` instances: fresh disk hit (0 fetches), expired disk cache re-fetches and overwrites file, corrupt JSON / wrong version / invalid `fetchedAt` recovers on next live fetch, symlink at `cachePath` throws `ELOOP` on both read and write, non-symlink write failure returns live models + `stale: false` + `warning`.
  - Verify stale fallback on HTTP 503, malformed JSON, missing `data` array, and network/timeout errors (preserves prior cache with `stale: true` and `warning`; cold-start failure returns `openrouter: []`, `defaults`, `stale: true`, `warning`).
  - Verify `AbortSignal` aborts reject with `AbortError` during both `fetch` and body read.
  - Verify `GET /api/models` rejects other methods (`405`) and serves cached live models; the forced refresh goes through `POST /api/models/refresh` (tests below).
  - Verify UI auto-loads live dropdowns on boot without blocking campaign load when OpenRouter fails, prevents out-of-order refresh races, renders >60 live models without truncation, never renders a `Suggested` optgroup, updates selection cleanly when filtering hides current value, does not steal focus in `CharacterModal` on async catalog updates, and renders `warning` alerts.
- Availability check (fake `fetchImpl` and `endpointsUrlFor`, never live OpenRouter):
  - Refresh keeps a model with 1+ endpoints and leaves out one with 0 endpoints, one answering 404, one answering 500, one timing out and one with malformed JSON; `providerCount` lands in the cache file (`version: 2`); a version-1 file is a cache miss.
  - At most 10 provider requests are in flight at once.
  - A failed catalog list request sends no provider requests and keeps the previous cache.
  - Server start within the lifetime sends 0 requests; with an expired cache it runs the full check; a rejection does not stop the server.
  - `checkModel` returns served, unserved (0 endpoints, and 404) and unchecked (network error, timeout, 500, malformed JSON).
  - `PUT /api/settings`: changing a slot to an unserved model returns `400` and saves nothing (including the other fields in the same request); an unchecked model saves and returns `warnings`; an unchanged slot sends no provider request.
  - Character create and update: the same three cases for `modelOverride`.
  - Turns and regenerate: a slot or a non-archived character override that is unserved in the cache returns `409` naming it; an archived character's override does not block; a served configuration starts the turn.
  - Memory update, tell (`preview` and `commit`) and muse: refused with `409` exactly like turns, including when the failing slot is not `scribe`.
  - No checked catalog (`modelStatus` `null` for everything): turns and the three memory actions start.
  - A slot whose model is in `uncheckedIds` does not block (ruling 12); the refresh `warning` and stderr line give the unchecked count and first reason.
  - A refresh where every provider request fails replaces the cache with 0 models (ruling 13); a `models: []` cache file loads as valid.
  - `checkModel` records every outcome in `verdicts` (memory and disk) without changing `fetchedAt` or the dropdown list; a served save-time result for a model the last refresh found unserved makes the next turn start; with no checked catalog, a served save-time result leaves every other slot `null` (turns still start, ruling 10); a non-`ELOOP` write failure adds the cache warning to the save's `warnings`; an aborted request signal rejects and nothing is saved.
  - Ruling 16: a configured unlisted model is provider-checked on refresh; served lets turns start, 0 providers or 404 blocks, unchecked does not block; it never appears in the dropdowns.
  - A refresh with unchecked requests and a failed cache write gives one `warning` with both texts, unchecked first, and writes it to stderr once (not again from `start()`).
  - Shared refresh: two overlapping `listModels` calls that both need a refresh send one set of requests; aborting one caller rejects only that caller; `close()` aborts the refresh and leaves memory and disk cache unchanged; after `close()`, `listModels` sends nothing and `checkModel` rejects; `stop()` calls `close()`.
  - `close()` after a `checkModel` provider answer but before it is recorded: `checkModel` rejects with `AbortError`, and nothing is recorded or written.
  - Ruling 17: a `checkModel` result recorded while a refresh is running survives that refresh (memory and disk) and decides `modelStatus`; one recorded before the refresh started is replaced. No clock comparison decides it (clock rollback is a tested case).
  - Ruling 18: a save-time verdict's `checkedAt` is the check time, a refresh verdict's is the refresh's `fetchedAt`; both round-trip through the cache file; a verdict with a missing, non-string or unparseable `checkedAt` makes the file a cache miss.
  - Ruling 19: a block naming two models found unserved at different times gives each part its own `(checked <time>)`, exact text; a listed model the refresh found unserved shows the refresh's `fetchedAt`.
  - Saved-value dropdown: with the filter hiding the saved model, the dropdown shows only the matches, the count label equals the option count, the select is `''`, and the text field still shows the saved ID.
  - `POST /api/models/refresh` without Origin or CSRF returns `403`; with them it forces a refresh. `GET /api/models` with any query parameter behaves as without; `includeAll` is gone.
  - Model ID shape: an ID with `?`, `#`, a space or `..` (for example `thedrummer/cydonia-24b-v4.1/endpoints?x=`) is refused with the invalid-ID text and sends no request.
  - A non-string slot value in `PUT /api/settings` returns `400` before any check; a slot value differing only in surrounding spaces counts as unchanged.
  - Character save: the check runs before the idle check, and a refused or warned save leaves no turn started in between.
  - UI: a settings save with `warnings` shows them in the Settings tab; a character save with `warnings` keeps the modal open showing them, and one without closes it; an async catalog update keeps focus and caret in a Settings field.
- **Every test that builds a server gets a fake catalog, and no test reaches live OpenRouter:** a real `ModelCatalog` with `cachePath: null`, a fake `fetchImpl` that answers the list URL with the model IDs the test uses and every provider URL from `endpointsUrlFor` with 1 provider. The refresh that `start()` runs therefore goes only to the fake. This covers `tests/ui.test.mjs:1108-1210` (its PUT at `:1164-1177`), the test server at `tests/ui.test.mjs:1380-1422` (whose current fake answers every URL with the list body, so its provider replies must be routed to a provider answer or the picker assertion at `:1495` fails), and every `WorldsServer.create` in `tests/http.test.mjs`, including the settings PUTs at `:572-591`, `:794-798`, `:1299-1303`, `:1635-1639` and `:1861-1865`. The builder lists each one changed.
