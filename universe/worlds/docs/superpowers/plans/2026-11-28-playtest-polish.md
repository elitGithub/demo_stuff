# Playtest Polish Implementation Plan

Date: 2026-11-28
Spec: [2026-11-28-playtest-polish-design.md](../specs/2026-11-28-playtest-polish-design.md)
Scope: `universe/worlds`

Three sequential, independently verifiable tasks (one task per commit).

---

## Task 1 — Hardened Cast Search API (`SqliteStore` + `Router` + `WorldsApi`)

### Files
- `src/store/SqliteStore.mjs`
- `src/http/Router.mjs`
- `public/api.mjs`
- `tests/store.test.mjs`
- `tests/http.test.mjs`

### Exact Signatures & Values
1. **`src/store/SqliteStore.mjs`:**
   - Add `static Settings = Object.freeze({ MaxCharacterQueryLength: 100, LikeEscapeChar: '\\', ControlCharPattern: /\p{Cc}/u, get AsciiUpperPattern() { return /[A-Z]/g; } });` on `SqliteStore`.
   - Update `listCharacters(campaignId, { includeArchived = false, limit = 25, after = null, query = null } = {})`:
     - Validate `query`:
       - If `query !== null`:
         - If `typeof query !== 'string'`, throw `new TypeError('query must be null or a string.')`.
         - If `query.length > SqliteStore.Settings.MaxCharacterQueryLength`, throw ``new RangeError(`query must be at most ${SqliteStore.Settings.MaxCharacterQueryLength} characters.`)``.
         - If `SqliteStore.Settings.ControlCharPattern.test(query)`, throw `new RangeError('query must not contain control characters.')`.
         - `trimmed = query.trim()`; if `trimmed.length === 0`, treat as `null`.
     - When normalized query is non-null:
       - `folded = trimmed.replace(SqliteStore.Settings.AsciiUpperPattern, (character) => character.toLowerCase())`.
       - `escaped = folded.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')`.
       - `pattern = `%${escaped}%``.
       - Append parameterized filter clause to BOTH `SELECT COUNT(*) AS total` and `SELECT *` queries:
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
       - Bind `[campaignId, pattern, pattern, pattern]` (plus cursor params and `validLimit + 1` for the page query).
     - Existing `ORDER BY name ASC, id ASC`, keyset cursor `(name > ? OR (name = ? AND id > ?))`, and `total` operate over the filtered set.
2. **`src/http/Router.mjs` (`GET /api/campaigns/:id/characters`):**
   - Read `rawQuery = searchParams.has('q') ? searchParams.get('q') : null`.
   - If `rawQuery !== null`:
     - If `rawQuery.length > SqliteStore.Settings.MaxCharacterQueryLength || SqliteStore.Settings.ControlCharPattern.test(rawQuery)`, throw ``this.#createHttpError(400, `q must be at most ${SqliteStore.Settings.MaxCharacterQueryLength} characters without control characters.`)``.
   - Pass `query: rawQuery` to `this.#store.listCharacters(campaignId, { includeArchived, limit, after, query: rawQuery })`.
3. **`public/api.mjs`:**
   - Update `listCharacters(campaignId, { includeArchived = false, limit = 25, after = null, query = null, signal = null } = {})`:
     - When `typeof query === 'string' && query.trim().length > 0`, call `params.set('q', query.trim())`.

### Break-It Tests
- **`tests/store.test.mjs`:**
  - Case-insensitive ASCII search matching `name`, `slug`, and `aliases` (with `json_each`).
  - SQL injection strings (`"' OR 1=1 --"`, `'"; DROP TABLE characters; --'`) return 0 matches and leave `characters` intact.
  - Literal SQLite `LIKE` wildcards (`100%`, `under_score`, `back\slash`) match ONLY characters containing those exact characters, not arbitrary rows.
  - JSON syntax probes (`"["`, `"]"`, `"\""`, `","`) do NOT falsely match `aliases_json`.
  - Non-ASCII uppercase name/alias (`'Élodie'`) matches exact search `'Élodie'`.
  - Pagination with `limit`, `after`, `query`, and `includeArchived` returns accurate filtered `total` and non-overlapping ordered pages.
  - Invalid inputs rejected: non-string `query` (`TypeError`), raw whitespace-padded string length `101` (`RangeError` before trimming), every control character U+0000-U+001F and U+007F-U+009F (`RangeError`); whitespace-only `<= 100` normalizes to unfiltered.
  - A slug containing `_` (`vault_keeper`) is found by a query containing `_`.
  - `ControlCharPattern` source and flags are asserted (`\p{Cc}`, `u`).
  - The neighbours of the control ranges and format characters are accepted (U+0020, U+007E, U+00A0, U+200B, U+202E).
- **`tests/http.test.mjs`:**
  - `GET /api/campaigns/:id/characters?q=...` filters by name, slug, and alias, paginates with `after`, handles URL-encoded `%25` (`%`), `%5F` (`_`), `%5C` (`\`), and honors `includeArchived`.
  - Rejects `q` longer than 100 chars (including whitespace-padded 101 chars) and control chars (every control character U+0000-U+001F and U+007F-U+009F, and U+0009-U+000D also alone, leading and trailing) with HTTP 400.
  - The accepted neighbours (U+0020, U+007E, U+00A0, U+200B, U+202E) return 200.
  - When `q` is sent more than once, the first value is used; a later value is not validated (a later `q` holding a control character, or longer than the limit, still returns 200).

### Verification
- `tests/store.test.mjs` and `tests/http.test.mjs` pass under Node resource limits; `git diff --check` clean.

---

## Task 2 — Budget-Aware Scribe Batching, Pedant Context Capping, and CharacterBrain Prompt

### Files
- `src/scribe/ScribeService.mjs`
- `src/scribe/PedantService.mjs`
- `src/server.mjs`
- `src/engine/CharacterBrain.mjs`
- `tests/scribe.test.mjs`
- `tests/engine.test.mjs`

### Exact Signatures & Values
1. **`src/scribe/ScribeService.mjs`:**
   - Add frozen `static Settings = Object.freeze({ MaxBatchTurns: 20, AbortName: 'AbortError', AbortMessage: 'Scribe update aborted.', ReadResultStatus: 'read', RepairLines: <the three repair header lines>, PreviousOutputHeading: 'Previous invalid output:', OriginalInputHeading: 'Original input:', TrailingLeadSurrogatePattern: /[\uD800-\uDBFF]$/u });`.
   - Constructor: `constructor({ store, client = null, modelProvider = null, modelCatalog = null } = {})`.
     - Validate `modelCatalog`: `null` or plain/class object with `typeof modelCatalog.contextLength === 'function'` (else throw `TypeError`).
   - `updateMemory({ campaignId, upToSeq = null, signal = null, profile = null } = {})`:
     - Resolve `model = await this.#resolveModel(campaignId)` and `replyReserve = this.#store.getSettings().replyReserve`.
     - Track `remainingMissingSceneTurns = [...missingSceneTurns]`, `cursor = 0`, `totalScenesAdded = 0`, `totalOperationsAdded = 0`, `allRefused = []`, `unpersistedSubjectUpdates = pendingSubjectUpdates`.
     - Loop `while (cursor < unreadTurns.length)`:
       1. If `signal?.aborted`, throw an `Error` with `error.name = ScribeService.Settings.AbortName` and message `ScribeService.Settings.AbortMessage`.
       2. Build fresh `charsPerToken = RequestBudget.charsPerToken({ store: this.#store, model })`, `contextLength = this.#modelCatalog === null ? null : this.#modelCatalog.contextLength(model)`, `budget = RequestBudget.create({ contextLength, replyReserve, charsPerToken })`, and `systemTokens = budget.estimate(ScribeAnalyzer.StoryPrompt)`.
       3. Grow `batchTurns` from `cursor` up to `Math.min(unreadTurns.length, cursor + batchCeiling)`:
          - Map `candidateTurns` -> `candidateMessages` in `messages` order, build `candidatePrompt = ScribeAnalyzer.input(state, player, candidateMessages, profile)` and `candidateRepairPrompt` (the repair-prompt builder, defined once before the loop, applied to `candidatePrompt` and `''`).
          - A candidate fits only if `budget.fits(systemTokens, candidateRepairPrompt)`; if not:
            - If `candidateTurns.length === 1`: compute `usedTokens = systemTokens + budget.estimate(candidateRepairPrompt)` and throw `new RangeError(...)` naming the turn seq, `model`, `usedTokens`, and `budget.limitTokens`.
            - Otherwise stop and keep the previous fitting slice and prompt.
       4. Partition `remainingMissingSceneTurns`:
          - `nextBatchFirstSeq = cursor + batchTurns.length < unreadTurns.length ? unreadTurns[cursor + batchTurns.length].seq : null`.
          - Take `batchMissingScenes` where `nextBatchFirstSeq === null || turn.seq < nextBatchFirstSeq`, keep the rest in `remainingMissingSceneTurns`.
          - Synthesize `sceneOps` from deduplicated `[...batchMissingScenes, ...batchTurns]` sorted by `seq`.
       5. Call `this.#client.complete({ model, messages: [{ role: 'system', content: ScribeAnalyzer.StoryPrompt }, { role: 'user', content: batchPrompt }], maxTokens: replyReserve, stage: SpendStage.Scribe, campaignId, signal })`.
       5a. Cut-off answers are never used. Keep a per-run ceiling `batchCeiling`, starting at `ScribeService.Settings.MaxBatchTurns`; step 3 grows the batch up to `Math.min(unreadTurns.length, cursor + batchCeiling)`. After any completion for the batch (the first call or the repair call of step 6) with `truncated === true`, discard the answer (nothing is appended or persisted). If `batchTurns.length > 1`: set `batchCeiling = Math.floor(batchTurns.length / 2)` (never raised again in the run) and start the same loop iteration again from the abort check, so the batch is selected again from the same `cursor`. If `batchTurns.length === 1`: throw `new RangeError(`Scribe answer for turn #${seq} was cut off at the reply length cap (${replyReserve} tokens) on ${model}. Raise the reply length cap.`)`; the turn stays unread and batches already persisted stay persisted. The scene partition (step 4) and the append (step 7) therefore run only after a completion that was not cut off, and the pool `remainingMissingSceneTurns` is reduced only when the batch is accepted.
       6. On unparseable non-empty response (existing repair-retry condition):
          - Build repair prompt with `completion.text` and `batchPrompt`.
          - If `!budget.fits(systemTokens, repairPrompt)`: compute `baseWithoutReply` (same repair template with `''` instead of `completion.text`; it always fits, because step 3 admitted the batch only if it did) and `maxReplyChars = Math.max(0, Math.floor((budget.limitTokens - systemTokens - budget.estimate(baseWithoutReply)) * charsPerToken))`; trim `completion.text` to `maxReplyChars` characters, shorten it one character at a time until the repair request fits by the estimate (if the answer is already empty and the request still does not fit, throw `new Error('Scribe returned unparseable output and repair prompt exceeds model context budget.')`; this cannot be reached while step 3 holds), and drop a trailing first half of a surrogate pair.
          - Call `this.#client.complete({ ..., maxTokens: replyReserve })` and re-parse (throw on still-unparseable output as before).
       7. Append via `ScribeLogCore.append(log, state, [...sceneOps, ...llmOps], { messages: batchMessages, origin: ScribeLogCore.Origin.Story, sources: sourcesByPosition, results: new Map(batchMessages.map((message) => [message.position, ScribeService.Settings.ReadResultStatus])) })`.
       8. Replay `state = ScribeReplay.run(log, order, null, fingerprints, null, null, messages)`, compute `lastTurnSeq`, and call `this.#persistBookAndCharacters(campaignId, { bookJson: JSON.stringify(log), lastTurnSeq, dirty: cursor + batchTurns.length < unreadTurns.length }, unpersistedSubjectUpdates)` (setting `unpersistedSubjectUpdates = []` afterward).
       9. Accumulate `totalScenesAdded`, `totalOperationsAdded`, `allRefused.push(...appendResult.refused)`, and advance `cursor += batchTurns.length`.
     - Return `Object.freeze({ log, state, lastTurnSeq, updated: true, scenesAdded: totalScenesAdded, operationsAdded: totalOperationsAdded, refused: Object.freeze(allRefused) })`.
2. **`src/scribe/PedantService.mjs`:**
   - Add frozen `static Settings = Object.freeze({ MaxRecentMessages: 10, FallbackRecentChars: 20000, FallbackSinceChars: 20000, Heading: <the seven section headings: Player, Roster, Ledger, Unknown, Recent, Since, ReplyOpen, ReplyClose> });`.
   - Constructor: `constructor({ store, client = null, scribeService, modelProvider = null, modelCatalog = null } = {})` (validate `modelCatalog` identically to `ScribeService`).
   - `checkTurn(...)`:
     - Resolve `replyReserve = this.#store.getSettings().replyReserve`, `contextLength = this.#modelCatalog === null ? null : this.#modelCatalog.contextLength(model)`, `charsPerToken = RequestBudget.charsPerToken({ store: this.#store, model })`, `budget = RequestBudget.create({ contextLength, replyReserve, charsPerToken })`.
     - Define `buildUserPrompt(recentSlice, sinceSlice)` assembling the exact `sections.join('\n\n')` string; the RECENT section is added only when the transcript of `recentSlice` is not the empty string.
     - Compute `systemTokens = budget.estimate(PedantService.Prompt)` and check `budget.fits(systemTokens, buildUserPrompt([], []))`. If `false`, throw `new RangeError(...)` naming `model`, `mandatoryTokens`, and `budget.limitTokens`.
     - Select `selectedSince` as the largest newest suffix of `earlierUnread` that fits, by binary search over the suffix length:
       - When `budget.limitTokens === null`: require `ScribeIntakeAdapter.transcript(candidateSince).length <= PedantService.Settings.FallbackSinceChars`.
       - When `budget.limitTokens !== null`: require `budget.fits(systemTokens, buildUserPrompt([], candidateSince))`.
     - Pack `selectedRecent` backwards from up to `MaxRecentMessages` (10) read messages before `message.position` (break on first non-fit):
       - Require `ScribeIntakeAdapter.transcript(candidateRecent).length <= PedantService.Settings.FallbackRecentChars` (keeping the single-newest-message exception when `budget.limitTokens === null && selectedRecent.length === 0`) AND when `budget.limitTokens !== null`, require `budget.fits(systemTokens, buildUserPrompt(candidateRecent, selectedSince))`.
     - Call `this.#client.complete({ model, messages: [{ role: 'system', content: PedantService.Prompt }, { role: 'user', content: buildUserPrompt(selectedRecent, selectedSince) }], maxTokens: replyReserve, stage: SpendStage.Pedant, campaignId, signal })`.
3. **`src/server.mjs`:**
   - Pass `modelCatalog: activeModelCatalog` into `new ScribeService(...)` and `new PedantService(...)`.
4. **`src/engine/CharacterBrain.mjs`:**
   - Replace `'Answer in exactly this shape and nothing else:'` with `'Start directly with <thoughts>. Write nothing before <thoughts> or after </next>. Answer in exactly this shape:'`.

### Break-It Tests
- **`tests/scribe.test.mjs`:**
  - `ScribeService` constructor rejects invalid `modelCatalog` (`TypeError`).
  - 45 unread turns split into 3 chronological batches (`20`, `20`, `5`), all passing `maxTokens: replyReserve`, each persisting `log` with `dirty: true` during catch-up and `dirty: false` on final batch.
  - Tight `contextLength` splits below 20 turns AND recomputes `systemTokens` + `budget` when `spend_log` lowers `charsPerToken` (e.g. `3.0` -> `2.0`) between batches.
  - Aborting `signal` after Batch 1 throws `AbortError` while Batch 1 remains persisted in SQLite (`dirty: true`) and Batch 2 is not called.
  - Single unread turn exceeding `contextLength - replyReserve` throws `RangeError` without calling OpenRouter.
  - Multi-batch `missingSceneTurns` partitioning produces non-overlapping scene spans across edited turns.
  - Repair retry passes `maxTokens: replyReserve`, and trims oversized invalid `completion.text` to fit budget.
  - `PedantService` constructor rejects invalid `modelCatalog` (`TypeError`).
  - `PedantService.checkTurn` with 50+ large unread turns caps `SINCE THE BOOK WAS LAST READ:` to a contiguous newest suffix inside `contextLength` (and inside `20000` chars when `contextLength === null`) and passes `maxTokens: replyReserve`.
  - `PedantService.checkTurn` throws `RangeError` when mandatory sections alone exceed `contextLength - replyReserve` (without calling OpenRouter).
  - Cut-off answer, several turns: four unread turns, the first reply scripted with `finish_reason: 'length'` and holding rows that parse; the second call carries two turns, a third call carries the other two (the ceiling stays at two); all four turns end up read; no row from the cut-off reply is in the saved book.
  - Cut-off answer, one turn: `RangeError` with the exact message of step 5a; the turn stays unread; an earlier batch of the same run stays saved with `dirty: true`.
  - Cut-off repair reply: the first reply is unparseable and the repair reply is cut off; with two turns the batch is asked again with one turn; nothing from either discarded reply is saved.
  - Twenty turns with every reply cut off: five calls of 20, 10, 5, 2 and 1 turns, then the `RangeError` for turn #1, with nothing read.
  - `contextLength` of `null` from the catalog, and no catalog at all: batches are limited only by `MaxBatchTurns`.
  - With a small campaign where everything fits, the Scribe request and the Pedant request carry the same user prompt text as before this task.
  - Repair retry: a batch that fills the budget to within a few tokens, first answer unparseable, then a repair call is made, fits the budget, carries `max_tokens`, and every turn ends up read (replaces the repair-overflow throw test).
  - Pedant, known context, both sections filled (300 turns, 10 read, context 32768): the request fits the estimate and RECENT is cut or empty.
  - A cut-off answer that does not parse (prose or empty), two turns: no repair call; asked again as `[[1,2],[1],[2]]`.
  - The lowered ceiling survives an accepted batch: 40 turns, first 20-turn answer cut off, then four batches of ten.
  - A later batch is built from the state left by the earlier one (its request contains the first reply's fact).
  - `lastTurnSeq` with gaps: turns 29 and 30 already read, last batch 25 to 28, saved and returned `lastTurnSeq` 30.
  - Pending subject updates are written once in a two-batch run.
  - The full text of both `RangeError` messages is asserted (Pedant: model, a number above the limit, the limit).
  - Catalog validation: a function with a `contextLength` property is rejected; a class instance with a `contextLength` method is accepted.
  - `ScribeService.Settings` and `PedantService.Settings` are frozen and pinned; twelve small read messages give a RECENT section with exactly the newest ten.
  - A batch of more than one turn leaves room for its repair request: three turns with a tight context are asked `[[1],[1],[2],[3]]` and the repair fits.
  - A single turn that fits only without the repair header throws the full `RangeError` before any call.
  - Rounding edge of the trim: at 4.6 characters per token the trimmed answer is shortened until the repair request fits.
  - Surrogate edge of the trim: an answer cut inside an astral character leaves a well-formed previous answer.
  - Pedant RECENT is absent when the recent read messages have an empty transcript; the SINCE suffix is the largest that fits (everything fits, nothing fits, one message).
- **`tests/engine.test.mjs`:**
  - `CharacterBrain.buildMessages` includes `'Start directly with <thoughts>. Write nothing before <thoughts> or after </next>. Answer in exactly this shape:'`.
  - `TurnEngine` treats Pedant mandatory-overflow `RangeError` as a non-fatal `[pedant]` warning while committing the turn cleanly.

### Verification
- `tests/scribe.test.mjs` and `tests/engine.test.mjs` pass under Node resource limits; `git diff --check` clean.

---

## Task 3 — Cast/Scene Search UI, Presence Scroll Preservation, and Asterisk `*action*` Styling

### Files
- `public/components/BeatTextFormatter.mjs` (new — one exported declaration)
- `public/components/ChatView.mjs`
- `public/components/InspectorDrawer.mjs`
- `public/app.mjs`
- `public/styles.css`
- `tests/ui.test.mjs`

### Exact Signatures & Values
1. **`public/components/BeatTextFormatter.mjs` (new):**
   - Export `BeatTextFormatter = Object.freeze({ ActionClass: 'beat-action', Kind: Object.freeze({ Plain: 'plain', Action: 'action' }), tokenize(text), renderInto(container, text, documentRef) })`.
   - `tokenize(text)`: throws `TypeError` on non-string; returns `Object.freeze([])` for `''`; splits on `\r?\n`; O(N) asterisk scanner; Rule 2 (odd `*` count `>= 3` && `line.startsWith('*')` && `line.endsWith('*')` && `!line.includes('"')`) strips `*` into one `'action'` span; pairs remaining `*` left-to-right (`**` stays plain `'**'`, trailing unclosed `*...` stays plain); inserts `'\n'` between lines; merges adjacent `'plain'` segments; freezes every segment and array.
   - `renderInto(container, text, documentRef)`: sets `container.textContent = ''`, appends `documentRef.createTextNode(segment.text)` for `'plain'` and `<span class="beat-action">` (`textContent = segment.text`) for `'action'`. Zero `innerHTML`.
2. **`public/components/ChatView.mjs`:**
   - Use `BeatTextFormatter.renderInto(textElement, rawText, this.#documentRef)` in `#createBeatRow(...)` and `BeatTextFormatter.renderInto(textElement, beatEntry.text, this.#documentRef)` in `appendStreamDelta(...)`.
3. **`public/styles.css`:**
   - Add `.beat-action { font-style: italic; color: var(--text-muted); }` (token-only, zero raw hex outside `:root`).
4. **`public/components/InspectorDrawer.mjs`:**
   - Constants: `#CastSearchInputId = 'cast-search-input'`, `#SceneCastSearchInputId = 'scene-cast-search'`, `#SceneWalkOnInputId = 'scene-walkon-input'`, `#ScenePresenceIdPrefix = 'scene-presence-'`, `#MaxCastQueryLength = 100`, `#ControlCharPattern = /\p{Cc}/u`.
   - Private fields: `#sceneCast = []`, `#sceneCastFilter = ''`, `#presenceRequestSeq = 0`, `#walkOnRequestSeq = 0`, `#castRequestSeq = 0`; add `query: ''`, `queryDraft: ''` to `#castData`.
   - `setCampaign` (`previousId !== nextId`): increment `#sceneStyleRequestSeq`, `#presenceRequestSeq`, `#walkOnRequestSeq`, `#castRequestSeq`; reset `#sceneStyleBusy = false`, `#presenceBusyId = null`, `#walkOnBusy = false`, `#sceneCast = []`, `#sceneCastFilter = ''`, `#castData.query = ''`, `#castData.queryDraft = ''`, `#castData.loadingMore = false`, `#castData.error = ''`.
   - `setSceneCast(characters)`: stores active non-archived characters into `#sceneCast` and re-renders via `FocusKeeper.keep(...)`.
   - `setCastPage(page, { append = false, includeArchived = this.#castData.includeArchived, query = this.#castData.query } = {})`: commits `#castData.query = query`, clears `loadingMore`, and re-renders via `FocusKeeper.keep(...)`.
   - Cast tab: add `#cast-search-input` form (`Search` + conditional `Clear`), strict raw-length/control-char inline validation (`#castData.error`), disable `Include archived` while `loadingMore`, guard `onSearchCast` / `onReloadCast` / `onLoadMoreCast` with `#castRequestSeq`, commit `query` only via `setCastPage` on success.
   - Scene tab: remove Cast-tab pager from `presenceSection`; add live `#scene-cast-search` input (+ `Clear`) over `#sceneCast` using `FocusKeeper.keep(...)` and plain `toLowerCase().includes(needle)` across `name`, `slug`, `aliases`; sort Present -> Remote -> Absent then `name.localeCompare` then `id.localeCompare`; display honest `Cast Presence (N)` or `Cast Presence (M/N)`; populate `shownNoteKeys` from all `#sceneCast`; assign `id="scene-presence-${character.id}-${modeOpt.value}"` and `id="scene-walkon-input"`; wrap presence and walk-on renders in `FocusKeeper.keep(..., returnFocusId)` with request-sequence isolation and tab-guard in `finally`.
5. **`public/app.mjs`:**
   - Track `#castQuery = ''`, `#castRequestSeq = 0`, `#castAbortController = null`, `#campaignLoadSeq = 0`.
   - Add `{ signal = null }` to `#loadAllActiveCharacters`.
   - Reset cast query/abort/scene cast on campaign switch and last-campaign deletion; guard `selectCampaign` post-await updates with `#campaignLoadSeq`; update `#refreshCast` with abort + sequence guard + silent `AbortError` handling; wire `onSearchCast`, `onReloadCast(includeArchived, query)`, `onLoadMoreCast(after, includeArchived, query)`, and `setSceneCast(...)`; pass `{ resetDraft: false }` in `onSetPresence`, `onAddWalkOn`, and `onRemoveWalkOn`.

### Break-It Tests (`tests/ui.test.mjs`)
- Add `FakeTextNode` and `FakeDocument.createTextNode` to DOM test harness; update static file inventory (`BeatTextFormatter.mjs`), required CSS classes (`.beat-action`), existing `.beat-text` assertions, and Scene XSS test (`drawer.setSceneCast(...)`).
- `BeatTextFormatter` unit tests: paired `*action*`, Collette nested `*Yelps... *Cracks...*`, CRLF lines, quoted dialogue guard (`*She waves.* "Wait — 2 * 3?" *smiles.*`), unclosed streaming `*...`, `**` literal, XSS `*<script>alert(1)</script>*`, non-string `TypeError`, 10,000 `*` linear-time performance test.
- `ChatView` tests: committed beats and live `appendStreamDelta` transitions from unclosed `*walking` (plain) -> `*walking*` (`.beat-action`).
- `InspectorDrawer` + `WorldsApp` tests:
  - Cast tab search sends `?q=...`, updates `Cast (N)`, paginates with matching `q`, rejects >100 chars and control chars inline without calling API, failed search keeps committed `query` + `nextCursor`, overlapping searches abort stale response silently.
  - Scene tab shows all 30+ active characters (beyond 25-item page limit), live filter matches name/slug/alias, sorts Present -> Remote -> Absent alphabetically, shows `M/N` filtered count, keeps filtered-out characters' `offscreenNotes` out of `"Other off-screen notes"`.
  - Clicking presence pill or adding/removing walk-on preserves `.drawer-body.scrollTop`, restores focus to the pill / `#scene-walkon-input`, preserves unsaved Scene Location draft, and isolates in-flight requests across campaign switches and tab switches.

### Verification
- All 10 test suites pass one at a time under Node resource limits (`ui`, `http`, `catalog`, `config`, `engine`, `scribe`, `store`, `openrouter`, `seed`, `sync`); `git diff --check` clean.
