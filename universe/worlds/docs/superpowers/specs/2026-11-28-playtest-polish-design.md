# Playtest Polish Design

Date: 2026-11-28
Scope: `universe/worlds`

## 1. Context and Goals

The first live playtest of Worlds against the `hero_gone` Zeta export surfaced five concrete usability and reliability defects:

1. **Cast search and large-cast Scene presence:** With 76 seeded characters, the Cast tab has no search filter, and the Scene tab's Cast Presence list reuses the Cast tab's 25-character page, hiding characters 26–76 until paginated in another tab.
2. **Scene scroll reset on presence updates:** Clicking `Present`, `Remote`, or `Absent` (or adding/removing walk-ons) calls `InspectorDrawer.render()` directly without `FocusKeeper.keep(...)`, resetting `.drawer-body` scroll position to `0` on every click.
3. **Plain asterisk rendering in chat:** `ChatView` writes raw `textContent` into `.beat-text`, so `*action narration*` renders literally instead of muted italic action spans contrasting with foreground dialogue.
4. **Scribe and Pedant context overflow (HTTP 400):** `ScribeService.updateMemory()` sends all unread turns in one request with no batch cap, and `PedantService.checkTurn()` puts all earlier unread turns into `SINCE THE BOOK WAS LAST READ:` with no budget cap. Large backlogs (such as partially read imports or multi-turn Scribe delays) exceed model context limits.
5. **CharacterBrain preamble leakage:** Models occasionally emit prose before `<thoughts>`. One-line rule tightening instructs the model to begin directly with `<thoughts>` and emit nothing before `<thoughts>` or after `</next>`.

All user-supplied inputs (search queries, character text, model output, query parameters) are treated as hostile: strictly validated before trimming, bounded, parameterized in SQL, linear-time parsed, and rendered through DOM text nodes only (zero `innerHTML`).

---

## 2. Hardened Cast Search, Full Scene Presence, and Scroll Preservation

### 2.1 Backend: `GET /api/campaigns/:id/characters?q=...`

**Files:** `src/store/SqliteStore.mjs`, `src/http/Router.mjs`

- Export shared frozen validation constants on `SqliteStore.Settings` (reused by `Router.mjs` so no limits or regexes are duplicated):
  - `MaxCharacterQueryLength: 100`
  - `LikeEscapeChar: '\\'`
  - `ControlCharPattern: /\p{Cc}/u`
  - `get AsciiUpperPattern()` returning `/[A-Z]/g` (fresh regex instance per access, matching codebase convention)
- Add optional `query = null` parameter to `SqliteStore.listCharacters(campaignId, { includeArchived = false, limit = 25, after = null, query = null } = {})`.
- **Input validation (strict, fail-loudly, raw-length checked before trimming):**
  - In `SqliteStore.listCharacters`: if `query !== null`:
    - Must be a `string` (otherwise throw `TypeError`).
    - Reject if `query.length > SqliteStore.Settings.MaxCharacterQueryLength` (100) BEFORE trimming (blocks whitespace-padding DoS) — throw `RangeError`.
    - Reject if `SqliteStore.Settings.ControlCharPattern.test(query)` (blocks every Unicode control character, category Cc: U+0000-U+001F and U+007F-U+009F; format characters are not rejected) — throw `RangeError`.
    - Trim whitespace. If empty after trimming, normalize to `null` (no filter).
  - In `Router.mjs` (`GET /api/campaigns/:id/characters`):
    - Read `rawQuery = searchParams.has('q') ? searchParams.get('q') : null`. When `q` is sent more than once, the first value is used; later values are ignored (not validated, never reach SQL).
    - If `rawQuery !== null`: reject with HTTP 400 (message built from `SqliteStore.Settings.MaxCharacterQueryLength`; text `q must be at most 100 characters without control characters.` unchanged) when `rawQuery.length > SqliteStore.Settings.MaxCharacterQueryLength` or `SqliteStore.Settings.ControlCharPattern.test(rawQuery)`.
    - Normalize empty/whitespace-only to `null` and pass `query` to `this.#store.listCharacters(...)`.
- **Parameterized SQL filtering with consistent SQLite ASCII case folding:**
  - SQLite's built-in `lower()` folds ASCII `A-Z` only. To avoid breaking exact-case searches on non-ASCII names (e.g. searching `'Élodie'` against `lower('Élodie') === 'Élodie'`), fold only ASCII uppercase letters in the query (`folded = trimmed.replace(SqliteStore.Settings.AsciiUpperPattern, (ch) => ch.toLowerCase())`), then escape `\`, `%`, and `_` using `LikeEscapeChar`:
    `escaped = folded.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')`
    and bind `pattern = `%${escaped}%`` as SQL parameters (never string-interpolated).
  - Filter clause (appended cleanly to both `SELECT COUNT(*)` and `SELECT *` queries):
    ```sql
    AND (
      lower(name) LIKE ? ESCAPE '\'
      OR lower(slug) LIKE ? ESCAPE '\'
      OR EXISTS (
        SELECT 1
        FROM json_each(characters.aliases_json)
        WHERE lower(CAST(value AS TEXT)) LIKE ? ESCAPE '\'
      )
    )
    ```
  - Using `json_each(characters.aliases_json)` prevents false matches against JSON syntax characters (`[`, `]`, `"`, `,`) and avoids loading all rows into JS.
  - Existing keyset cursor pagination (`ORDER BY name ASC, id ASC`, `(name > ? OR (name = ? AND id > ?))`) and `total` count operate strictly over the filtered result set.

### 2.2 Frontend API and App Wiring

**Files:** `public/api.mjs`, `public/app.mjs`

- `WorldsApi.listCharacters(campaignId, { includeArchived = false, limit = 25, after = null, query = null, signal = null } = {})`:
  - When `typeof query === 'string' && query.trim().length > 0`, append `params.set('q', query.trim())`.
- `WorldsApp`:
  - Track `#castQuery = ''`, `#castRequestSeq = 0`, `#castAbortController = null`, and `#campaignLoadSeq = 0`.
  - `#loadAllActiveCharacters(campaignId, { signal = null } = {})`: forward `signal` to each `this.#api.listCharacters(...)` call.
  - On `selectCampaign(campaignId)` and on last-campaign deletion (`app.mjs:153-159`):
    - Increment `#campaignLoadSeq` and `#castRequestSeq`, abort `#castAbortController` (if active), reset `#castQuery = ''`, and pass `[]` to `this.#inspectorDrawer.setSceneCast([])` when clearing to no campaign.
    - Guard post-await updates in `selectCampaign` on `loadSeq === this.#campaignLoadSeq && this.#activeCampaignId === campaignId` so a slow Campaign A load never overwrites Campaign B's cast, scene cast, turns, findings, memory, or rulings.
    - Pass `allActiveCast.filter((character) => !character.archived)` to `this.#inspectorDrawer.setSceneCast(...)` whenever a campaign loads (`selectCampaign`) or cast mutates (`#refreshCast`, character save/archive/delete).
  - Update `#refreshCast({ includeArchived = this.#castIncludeArchived, query = this.#castQuery } = {})`:
    - Increment `#castRequestSeq`, abort previous `#castAbortController`, create a new `AbortController`, and capture `campaignId`, `requestSeq`, and `signal`.
    - Fetch both the filtered/paginated `castPage` (`listCharacters(campaignId, { includeArchived, limit: 25, query, signal })`) and active cast (`#loadAllActiveCharacters(campaignId, { signal })`).
    - If `signal.aborted` or `requestSeq !== this.#castRequestSeq` or `this.#activeCampaignId !== campaignId`, return silently without mutating state or rethrowing `AbortError`.
    - On success, commit `this.#castIncludeArchived = includeArchived`, `this.#castQuery = query`, update `#activeCharacters`, `ChatView.setCharacters`, `InspectorDrawer.setSceneCast`, and `InspectorDrawer.setCastPage(castPage, { includeArchived, query })`.
    - On non-abort error, rethrow so `InspectorDrawer` displays the error without overwriting the previously committed `query` or `nextCursor`.
  - Update `onLoadMoreCast(after, includeArchived, query)` to pass `{ includeArchived, limit: 25, after, query }` and guard against campaign switch or `#castRequestSeq` change before appending.
  - Update `onReloadCast(includeArchived, query)` and add `onSearchCast(query)` both routing cleanly through `#refreshCast({ includeArchived, query })`.
  - Update `onSetPresence`, `onAddWalkOn`, and `onRemoveWalkOn` in `public/app.mjs` to call `this.#applyUpdatedCampaign(updated, { resetDraft: false })` (matching `onSetPinnedStyle`) so unsaved Scene form drafts (Location, Day, Time, Visibility) are never wiped when toggling presence or managing walk-ons.

### 2.3 InspectorDrawer: Cast Search, Scene Cast Filter, Sorting, and Scroll Preservation

**Files:** `public/components/InspectorDrawer.mjs`, `public/styles.css`

- **Campaign-switch state resets in `setCampaign` (`previousId !== nextId`):**
  - Increment `#sceneStyleRequestSeq`, `#presenceRequestSeq`, `#walkOnRequestSeq`, and `#castRequestSeq`.
  - Reset `#sceneStyleBusy = false`, `#presenceBusyId = null`, `#walkOnBusy = false`, `#sceneCast = []`, `#sceneCastFilter = ''`, `#castData.query = ''`, `#castData.queryDraft = ''`, `#castData.loadingMore = false`, `#castData.error = ''`.
- **Focus & scroll preservation on data setters:**
  - `setCastPage(page, { append = false, includeArchived = this.#castData.includeArchived, query = this.#castData.query } = {})` updates `#castData.query = query` (only on committed success, never before the request completes, so failed searches cannot pair a new `query` with an old `nextCursor`), sets `#castData.loadingMore = false`, and re-renders via `FocusKeeper.keep(...)` (preserving focus, selection, and `.drawer-body` scroll).
  - `setSceneCast(characters)` stores `#sceneCast = Array.isArray(characters) ? characters.filter((char) => !char.archived) : []` and re-renders via `FocusKeeper.keep(...)`.
- **Cast tab search (paginated server-side):**
  - Render a search form (`class="action-row-split"`) above the cast list matching the Memory tab layout:
    - `<input id="cast-search-input" type="search" class="field-control" maxlength="100" placeholder="Search cast by name, slug, or alias...">`
    - `Search` submit button (`busy: this.#castData.loadingMore`, `busyLabel: 'Loading...'`)
    - `Clear` ghost button rendered when `this.#castData.query.length > 0` (`disabled: this.#castData.loadingMore`)
  - Disable the `Include archived` checkbox while `this.#castData.loadingMore` is true, and pass `(archiveCheck.checked, this.#castData.query)` to `onReloadCast`.
  - On submit:
    - Validate `#castData.queryDraft` against `MaxCharacterQueryLength` (100) and `ControlCharPattern` BEFORE trimming; if invalid, show a clear inline error in `#castData.error` (never silently truncate) and do not send a request.
    - Otherwise normalize `nextQuery = this.#castData.queryDraft.trim()`, set `#castData.loadingMore = true`, `#castData.error = ''`, render via `FocusKeeper.keep(...)`, and call `await this.#callbacks.onSearchCast(nextQuery)` guarded by `#castRequestSeq`. Keep `#castData.query` unchanged until `setCastPage` commits the response so `Load more` always pairs matching cursor and query.
  - Pass `(this.#castData.nextCursor, this.#castData.includeArchived, this.#castData.query)` to `onLoadMoreCast`.
  - `Cast (${this.#castData.total})` header displays the server's filtered `total`.
- **Scene tab Cast Presence (full active cast + live client filter + presence sorting):**
  - Remove the Cast-tab pager (`this.#buildPager(...)`) from `presenceSection` in the Scene tab; Scene tab renders all matching entries from `#sceneCast`.
  - Render a live filter bar (`class="action-row-split"`) above the presence cards when `#sceneCast.length > 0`:
    - `<input id="scene-cast-search" type="search" class="field-control" maxlength="100" placeholder="Filter cast by name, slug, or alias...">`
    - `Clear` ghost button rendered when `#sceneCastFilter.length > 0`.
    - On `input`, update `#sceneCastFilter` and re-render via `FocusKeeper.keep(...)` (preserving focus, selection range, and `.drawer-body` scroll).
  - Filter `#sceneCast` using plain case-insensitive substring matching (`toLowerCase().includes(needle)`) across `character.name`, `character.slug`, and `character.aliases` (zero regex construction from user input, immune to ReDoS).
  - Sort matching characters by presence group:
    1. Present (`presentSet.has(id)`) -> rank `0`
    2. Remote (`remoteSet.has(id)`) -> rank `1`
    3. Absent -> rank `2`
    Within each rank, sort by `name.localeCompare(other.name, undefined, { sensitivity: 'base' })`, then `id.localeCompare(other.id)`.
  - Section title reflects honest counts: `Cast Presence (${totalActive})` when unfiltered, `Cast Presence (${filtered.length}/${totalActive})` when filtered. When filter matches zero characters, render an info alert (`No active characters match your filter.`).
  - Populate `shownNoteKeys` from ALL characters in `#sceneCast` (before filtering) so filtering the presence list never dumps hidden characters' off-screen notes into `"Other off-screen notes"`.
- **Scroll & focus preservation + async isolation on Presence & Walk-on actions:**
  - Assign deterministic IDs:
    - Presence pills: `scene-presence-${character.id}-${modeOpt.value}`
    - Walk-on input: `scene-walkon-input`
  - Wrap loading and completion renders for presence toggles and walk-on add/remove in `FocusKeeper.keep({ documentRef, containerElement, scrollSelector, renderFn, returnFocusId })`, using the clicked presence pill's ID for presence changes and `scene-walkon-input` for walk-on add/remove.
  - Gate `catch` and `finally` on `requestSeq === this.#presenceRequestSeq` (or `#walkOnRequestSeq`). If stale (campaign switched), return early without mutating state or moving focus. In `finally`, skip `this.render()` when `this.#activeTab !== InspectorDrawer.#SceneTabId` so switching tabs mid-save never disturbs focus on the active tab.

---

## 3. Asterisk `*action*` Text Styling in Chat

**Files:** `public/components/BeatTextFormatter.mjs` (new, one exported declaration), `public/components/ChatView.mjs`, `public/styles.css`, `tests/ui.test.mjs`

### 3.1 Pure Linear-Time Formatter (`BeatTextFormatter`)

Export `BeatTextFormatter` (`Object.freeze({ ActionClass: 'beat-action', Kind: Object.freeze({ Plain: 'plain', Action: 'action' }), tokenize(text), renderInto(container, text, documentRef) })`):

- `tokenize(text)`:
  - Validates `typeof text === 'string'` (throws `TypeError` otherwise).
  - For `''`, returns `Object.freeze([])`.
  - Splits `text` on `\r?\n` so Windows CRLF never leaves trailing `\r` breaking end-of-line checks, and an unclosed `*` on one line never bleeds muted styling into later lines.
  - For each line, scans `*` character positions in O(N) time (zero backtracking regexes):
    1. **Zero or one `*`:** emit `{ kind: 'plain', text: line }`.
    2. **Broken model nested asterisk line:** if `*` count is odd and `>= 3`, AND `line.startsWith('*')`, AND `line.endsWith('*')`, AND `!line.includes('"')` (prevents swallowing spoken dialogue like `*She waves.* "Wait — 2 * 3?" *She smiles.*`):
       - Strip all `*` characters from the line; if the resulting text is non-empty, emit `{ kind: 'action', text: stripped }` (otherwise fall back to `{ kind: 'plain', text: line }`).
    3. **General case:** pair asterisks left-to-right `(positions[0], positions[1])`, `(positions[2], positions[3])`, ...:
       - Text before `open` -> `'plain'` (if non-empty).
       - Text between `open + 1` and `close`:
         - If `close > open + 1`: emit `{ kind: 'action', text: inner }` (delimiters `*` stripped).
         - If `close === open + 1` (`**`): emit `{ kind: 'plain', text: '**' }`.
       - Trailing text after the last paired `close` (including an unpaired trailing `*...` during live SSE streaming) -> `'plain'`.
  - Re-insert `'\n'` between lines and merge adjacent `'plain'` segments so output is minimal and canonical.
  - Freeze each segment object and the returned array.
- `renderInto(container, text, documentRef)`:
  - Single canonical DOM contract:
    - Clears `container` via `container.textContent = ''`.
    - For each segment in `BeatTextFormatter.tokenize(text)`:
      - `'plain'`: `container.append(documentRef.createTextNode(segment.text))`
      - `'action'`: creates `span = documentRef.createElement('span')`, sets `span.className = BeatTextFormatter.ActionClass`, `span.textContent = segment.text`, calls `container.append(span)`.
  - Zero `innerHTML`; adversarial markup inside `*<script>alert(1)</script>*` renders strictly as inert text.

### 3.2 ChatView, CSS, and Test Harness Integration

- In `ChatView.#createBeatRow(...)`: replace `textElement.textContent = ...` with `BeatTextFormatter.renderInto(textElement, rawText, this.#documentRef)`.
- In `ChatView.appendStreamDelta(...)`: replace `textElement.textContent = beatEntry.text` with `BeatTextFormatter.renderInto(textElement, beatEntry.text, this.#documentRef)`.
- Pending streaming user preview (`ChatView.mjs:676-685`, which uses plain `<span>` and `*(Encounter)*`) is intentionally left untouched; committed turns and streaming assistant beats render through `#createBeatRow` / `appendStreamDelta`.
- In `public/styles.css`:
  ```css
  .beat-action {
    font-style: italic;
    color: var(--text-muted);
  }
  ```
  Token-only (no raw hex values outside `:root`), contrasting cleanly against `.beat-text` (`var(--text-primary)`).
- In `tests/ui.test.mjs`:
  - Add minimal `FakeTextNode` and `FakeDocument.createTextNode(text)` support to the test DOM harness: `FakeElement.append` accepts `FakeTextNode` (included in `textContent`, skipped by `querySelectorAll`, `matches`, and element-only traversal, and cleared by `textContent = ''`).
  - Update the static file inventory (`tests/ui.test.mjs:1139-1152`) to include `public/components/BeatTextFormatter.mjs`, add `.beat-action` to required CSS classes (`:1194`), update existing `.beat-text` `textContent` expectations (`:4318-4324`, `:4350`) to reflect stripped `*` delimiters + `.beat-action` spans, and update the Scene XSS test (`:1626-1685`) to populate `drawer.setSceneCast(...)`.

---

## 4. Budget-Aware Scribe Batching and Pedant Context Capping

**Files:** `src/scribe/ScribeService.mjs`, `src/scribe/PedantService.mjs`, `src/server.mjs`

### 4.1 ModelCatalog Injection

- `ScribeService` constructor accepts optional `modelCatalog = null` (validated: `null` or object with `typeof modelCatalog.contextLength === 'function'`, throwing `TypeError` otherwise).
- `PedantService` constructor accepts optional `modelCatalog = null` (same validation).
- `WorldsServer.create()` in `src/server.mjs` passes `modelCatalog: activeModelCatalog` to both `new ScribeService(...)` and `new PedantService(...)`.

### 4.2 Scribe Batching (`ScribeService.updateMemory`)

- Frozen constants on `ScribeService.Settings`:
  - `MaxBatchTurns: 20`
  - `AbortName: 'AbortError'`
  - `AbortMessage: 'Scribe update aborted.'`
- Resolve `model = await this.#resolveModel(campaignId)` and `replyReserve = this.#store.getSettings().replyReserve`.
- Loop chronologically over `unreadTurns` starting at `cursor = 0`:
  1. If `signal?.aborted`, throw an `AbortError` (`error.name = ScribeService.Settings.AbortName`) cleanly (any earlier completed batches are already persisted).
  2. Build fresh `budget` for this batch using current `RequestBudget.charsPerToken({ store: this.#store, model })` and `contextLength = this.#modelCatalog?.contextLength(model) ?? null`, and recompute `systemTokens = budget.estimate(ScribeAnalyzer.StoryPrompt)` from this batch's `budget`.
  3. Select the largest contiguous batch `batchTurns` starting at `cursor` up to `Math.min(unreadTurns.length, cursor + ScribeService.Settings.MaxBatchTurns)`:
     - Grow `count = 1..maxCount`, mapping `candidateTurns` -> `candidateMessages` and building `candidatePrompt = ScribeAnalyzer.input(state, player, candidateMessages, profile)`.
     - Check `budget.fits(systemTokens, candidatePrompt)`.
     - If `count === 1` and `!budget.fits(systemTokens, candidatePrompt)`:
       - Let `usedTokens = systemTokens + budget.estimate(candidatePrompt)`.
       - Throw a `RangeError` (`Scribe prompt for turn #${candidateTurns[0].seq} exceeds ${model} context limit (${usedTokens} estimated tokens > ${budget.limitTokens} input budget). Switch to a larger-context Scribe model or lower reply length cap.`) — maps cleanly to HTTP 400 in `Router.#mapErrorStatusCode` and a clear `[scribe]` warning in `TurnEngine`.
     - If `count > 1` and `!budget.fits(systemTokens, candidatePrompt)`: stop growing and keep the `count - 1` slice with its already-built `batchPrompt`.
  4. **Non-overlapping `missingSceneTurns` partitioning:**
     - Let `nextBatchFirstSeq = cursor + batchTurns.length < unreadTurns.length ? unreadTurns[cursor + batchTurns.length].seq : null`.
     - Include in this batch's scene synthesis only remaining `missingSceneTurns` with `nextBatchFirstSeq === null || turn.seq < nextBatchFirstSeq`, removing them from the remaining `missingSceneTurns` pool so multi-batch catch-up never emits overlapping scene spans.
  5. Call `this.#client.complete({ model, messages: [{ role: 'system', content: ScribeAnalyzer.StoryPrompt }, { role: 'user', content: batchPrompt }], maxTokens: replyReserve, stage: SpendStage.Scribe, campaignId, signal })`.
  6. Parse response with `ScribeAnswer.parseStory(completion.text)`. On unparseable non-empty output (existing repair-retry path):
     - Build `repairPrompt` and check `budget.fits(systemTokens, repairPrompt)`.
     - If `repairPrompt` exceeds `budget`, compute remaining char budget for `completion.text` (`Math.max(0, Math.floor((budget.limitTokens - systemTokens - budget.estimate(repairWithoutReply)) * charsPerToken))`); if `> 0`, truncate `completion.text` to that ceiling and re-verify `budget.fits(...)`; if even the header + `batchPrompt` alone exceeds `budget`, throw an `Error` (`'Scribe returned unparseable output and repair prompt exceeds model context budget.'`) rather than silently marking unparsed turns as read.
     - Always pass `maxTokens: replyReserve` on the repair retry call.
  7. Append operations with `ScribeLogCore.append(log, state, [...sceneOps, ...parsedOperations], { messages: batchMessages, origin: ScribeLogCore.Origin.Story, sources: sourcesByPosition, results: new Map(batchMessages.map((message) => [message.position, 'read'])) })` (matching existing `ScribeService` append contract), replay `state = ScribeReplay.run(...)`, recompute `lastTurnSeq`, and **persist immediately** (`#persistBookAndCharacters`, setting `dirty: cursor + batchTurns.length < unreadTurns.length`, clearing `pendingSubjectUpdates` after the first persist).
  8. Accumulate `totalScenesAdded`, `totalOperationsAdded`, `allRefused`, and advance `cursor += batchTurns.length`.
- Return `Object.freeze({ log, state, lastTurnSeq, updated, scenesAdded: totalScenesAdded, operationsAdded: totalOperationsAdded, refused: Object.freeze(allRefused) })`.

### 4.3 Pedant Budget Capping (`PedantService.checkTurn`)

- Frozen constants on `PedantService.Settings`:
  - `MaxRecentMessages: 10`
  - `FallbackRecentChars: 20000`
  - `FallbackSinceChars: 20000`
- Resolve `replyReserve = this.#store.getSettings().replyReserve`, `contextLength = this.#modelCatalog?.contextLength(model) ?? null`, `charsPerToken = RequestBudget.charsPerToken({ store: this.#store, model })`, and build `budget = RequestBudget.create({ contextLength, replyReserve, charsPerToken })`.
- Define a single canonical prompt assembler `buildUserPrompt(recentSlice, sinceSlice)` that builds the exact `sections.join('\n\n')` string (mandatory `PLAYER CHARACTER`, `SUBJECT ROSTER`, `LEDGER`, `DOES NOT KNOW`, optional `RECENT MESSAGES` when `recentSlice.length > 0`, `SINCE THE BOOK WAS LAST READ`, and `REPLY (#n)`).
- Compute `systemTokens = budget.estimate(PedantService.Prompt)` and verify mandatory minimum fits:
  - Check `budget.fits(systemTokens, buildUserPrompt([], []))`.
  - If `false`: compute `mandatoryTokens = systemTokens + budget.estimate(buildUserPrompt([], []))` and throw a `RangeError` (`Pedant mandatory prompt exceeds ${model} context limit (${mandatoryTokens} estimated tokens > ${budget.limitTokens} input budget).`) so `TurnEngine` emits a clean `[pedant]` warning rather than sending a doomed HTTP 400.
- Pack optional context sections as contiguous newest suffixes (walking backwards from newest to oldest, breaking on the first message that does not fit so chronological holes are never created):
  1. **`SINCE THE BOOK WAS LAST READ:`** (`earlierUnread`, sorted ascending by `position`):
     - Walk backwards from newest to oldest, forming `candidateSince = [msg, ...selectedSince]`.
     - Check UTF-16 char ceiling `ScribeIntakeAdapter.transcript(candidateSince).length <= PedantService.Settings.FallbackSinceChars` when `budget.limitTokens === null`, AND when `budget.limitTokens !== null`, check `budget.fits(systemTokens, buildUserPrompt([], candidateSince))`.
     - If it fits, accept `selectedSince = candidateSince`; otherwise `break`. (If even the single newest unread message exceeds the budget or 20,000-char fallback, `selectedSince` stays empty rather than overflowing.)
  2. **`RECENT MESSAGES:`** (up to last `PedantService.Settings.MaxRecentMessages` = 10 read messages before `message.position`):
     - Walk backwards from newest to oldest, forming `candidateRecent = [msg, ...selectedRecent]`.
     - Always enforce `ScribeIntakeAdapter.transcript(candidateRecent).length <= PedantService.Settings.FallbackRecentChars` (except preserving the existing single-message exception when `budget.limitTokens === null && selectedRecent.length === 0`), AND when `budget.limitTokens !== null`, enforce `budget.fits(systemTokens, buildUserPrompt(candidateRecent, selectedSince))`.
     - If it fits, accept `selectedRecent = candidateRecent`; otherwise `break`.
- Send `buildUserPrompt(selectedRecent, selectedSince)` with `maxTokens: replyReserve` to `this.#client.complete(...)`.

---

## 5. CharacterBrain Prompt Tightening

**File:** `src/engine/CharacterBrain.mjs`

- Update the output-shape rule line in `CharacterBrain.buildMessages()` from:
  `'Answer in exactly this shape and nothing else:'`
  to:
  `'Start directly with <thoughts>. Write nothing before <thoughts> or after </next>. Answer in exactly this shape:'`
- Preserves all tag names, `<next>` semantics, and streaming behavior.

---

## 6. Security and Code-Law Checklist

- **Hostile input defense:**
  - `q` validated in both `Router.mjs` (HTTP 400) and `SqliteStore.listCharacters` (`TypeError`/`RangeError`) using shared `SqliteStore.Settings`: non-string rejected, raw length > 100 rejected before trimming, Unicode control characters (category Cc) rejected, ASCII-only case folding consistent with SQLite `lower()`, SQL `LIKE` wildcards (`%`, `_`, `\`) escaped with `ESCAPE '\'`, aliases queried via `json_each`, strictly parameterized bindings.
  - Client-side Cast search rejects > 100 chars or control chars with an inline error (no silent truncation).
  - Client-side Scene filter uses plain `toLowerCase().includes(...)` (no `new RegExp(userInput)`).
  - `BeatTextFormatter` uses O(N) linear scan (no backtracking regex), handles CRLF and quoted dialogue safely, and renders strictly via `documentRef.createTextNode` + `span.textContent` (zero `innerHTML`, zero raw CSS colors).
  - Static UI audit in `tests/ui.test.mjs` continues to enforce zero `innerHTML`, zero inline `style`, zero `/\.style\b/`, zero raw hex colors outside `:root`, zero emojis.
- **Screen laws:**
  - Phone-first controls (`min-height: 44px`, full-width responsive `.action-row-split`), immediate loading states on Cast search and Presence pills, scroll & focus preserved via `FocusKeeper.keep`, honest filtered counts (`M/N` or `total`), unsaved Scene drafts preserved across presence/walk-on actions.
- **Code laws (production and tests):**
  - One exported declaration per file, tag-only JSDoc (`@param`, `@returns`, `@throws`), braces always, no single-letter or `_` throwaway names, no magic strings or inline mode literals, no defensive fallbacks on guaranteed values, no swallowed errors.

---

## 7. Non-Goals

- No changes to the Zeta seeder (`scripts/seed-from-export.mjs`) or `hero_gone_latest.json` (operator supplied the updated 1384/1384 export in `universe/seed-plots/hero_gone_latest.json`).
- No changes to model defaults (`recommended-models.json`); operator can pick a larger model directly in Settings.
- No changes to Lorebooks, editable prompt templates, or Project 2 Character Brain memory (those remain queued after live playtesting).
