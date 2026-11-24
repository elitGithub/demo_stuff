# Worlds POC Implementation Plan

Status: draft for operator approval (2026-11-24).
Design spec: [2026-11-24-worlds-poc-design.md](../specs/2026-11-24-worlds-poc-design.md).
Workspace: `/var/www/demo_stuff/universe/worlds/` (zero npm dependencies, Node 24 built-ins only).

## Execution protocol

- One task at a time, in order (Tasks 1–8).
- Each task: implementer subagent -> adversarial reviewer -> orchestrator verification -> hand-off (`Commit-ready.` / `NOT commit-ready`) -> operator review & commit -> next task.
- All automated tests run via `node --test tests/<suite>.test.mjs` using isolated in-memory or temporary SQLite files removed by the test; never touches `local/worlds.sqlite` or live OpenRouter/R2.
- All code follows `/var/www/demo_stuff/AGENTS.md`: zero single-letter variables, tag-only JSDoc on every method/function, braces always, TitleCase enum cases with `label()`, no emojis anywhere, phone-first UI with stylesheet tokens and zero inline `style` attributes.

---

## Task 1: Scaffold, Config, Secrets, and SQLite `StoryStore`

### Files
- `universe/worlds/.gitignore` — ignores `local/`, `.env`, `.env.*`, preserves `!.env.example`.
- `universe/worlds/.env.example` — `WORLDS_PORT=8768`, `OPENROUTER_API_KEY=`, `R2_ACCOUNT_ID=`, `R2_ACCESS_KEY_ID=`, `R2_SECRET_ACCESS_KEY=`, `R2_BUCKET=`.
- `universe/worlds/README.md` — setup, local run (`node src/server.mjs`), R2 handoff, test command, honest POC limits.
- `universe/worlds/src/store/Enums.mjs` — frozen enum objects with TitleCase keys and `label(value)` methods:
  - `CharacterTier`: `Main: 'main'`, `Recurring: 'recurring'`
  - `AvatarToken`: `Sage: 'sage'`, `Rose: 'rose'`, `Amber: 'amber'`, `Slate: 'slate'`, `Plum: 'plum'`, `Teal: 'teal'`, `Indigo: 'indigo'`, `Coral: 'coral'`
  - `TurnRole`: `User: 'user'`, `Assistant: 'assistant'`
  - `TurnMode`: `Normal: 'normal'`, `Narrator: 'narrator'`, `Encounter: 'encounter'`
  - `SpeakerType`: `Narrator: 'narrator'`, `Character: 'character'`, `Player: 'player'`
  - `SceneType`: `Public: 'public'`, `Private: 'private'`
  - `FindingKind`: `Contradiction: 'contradiction'`, `SecretLeak: 'secret_leak'`, `NameMismatch: 'name_mismatch'`
  - `FindingStatus`: `Open: 'open'`, `Dismissed: 'dismissed'`, `Ruled: 'ruled'`, `Told: 'told'`
  - `SpendStage`: `Director: 'director'`, `Mind: 'mind'`, `Composer: 'composer'`, `Scribe: 'scribe'`, `Pedant: 'pedant'`, `Muse: 'muse'`
- `universe/worlds/src/config.mjs`:
  - `loadConfig({ rootDir, env })` -> `{ port, rootDir, localDir, dbPath, secretsPath, syncStatePath, conflictsDir, envApiKey, r2 }`
  - `readSecrets(secretsPath)` -> `{ openRouterApiKey: ?string }`
  - `writeSecrets(secretsPath, { openRouterApiKey })` — atomic temp-file write + rename, mode `0o600` (clears key when `null`/empty).
  - `resolveApiKey(config)` -> `{ key: ?string, source: 'secrets' | 'env' | 'none' }` (`local/secrets.json` overrides `.env`).
- `universe/worlds/src/store/schema.sql` — full SQLite DDL for `settings`, `sync_meta`, `campaigns`, `characters`, `turns`, `beats`, `scribe_books`, `findings`, `spend_log`, with foreign keys, unique `(campaign_id, slug)`, unique `(campaign_id, seq)` on `turns`, and indexes on `(campaign_id, seq)`, `(turn_id, seq)`, `(campaign_id, status)`, `(created_at)`.
- `universe/worlds/src/store/SqliteStore.mjs`:
  - `class SqliteStore` (opens via `DatabaseSync` with `PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;`):
    - `close()`, `vacuumInto(targetPath)`, `getLocalChangeSeq()`
    - `getSettings()`, `updateSettings(patch)` (defaults: `models: { director: '', composer: '', main: '', recurring: '', scribe: '' }`, `publicOdds: 8`, `privateOdds: 30`, `scribeInterval: 10`, `pedantEnabled: true`, `dailyWarnUsd: null`)
    - `listCampaigns({ limit, after })`, `getCampaign(campaignId)`, `createCampaign(dto)`, `updateCampaign(campaignId, patch)`, `deleteCampaign(campaignId)`
    - `listCharacters(campaignId, { includeArchived, limit, after })`, `getCharacter(campaignId, characterId)`, `createCharacter(campaignId, dto)`, `updateCharacter(campaignId, characterId, patch)` (enforces unique slug, forbids deleting referenced characters)
    - `listTurns(campaignId, { limit, beforeSeq })`, `getTurn(campaignId, turnId)`, `getLatestTurnPair(campaignId)`, `countTurnsSinceScribe(campaignId)`
    - `commitTurnPair({ campaignId, userTurn, userBeat, assistantTurn, assistantBeats, nextSceneState, spendIds })` — single transaction inserting user turn + beat, assistant turn + beats, updating `campaigns.scene_state_json`, linking `spend_log.turn_id`, incrementing `sync_meta.local_change_seq`.
    - `updateTurnText(campaignId, turnId, newText)`
    - `deleteLastAssistantTurn(campaignId)` / `deleteLastTurnPair(campaignId)` — atomic restore of `scene_state_before_json` + cascade delete of beats/findings + increment `local_change_seq`.
    - `getScribeBook(campaignId)`, `saveScribeBook(campaignId, { bookJson, lastTurnSeq, dirty })`, `markScribeDirty(campaignId)`
    - `listFindings(campaignId, { status, limit, after })`, `insertFindings(campaignId, turnId, items)`, `resolveFinding(campaignId, findingId, status)`
    - `recordSpend(dto)`, `getDailySpend(utcDateString)` -> `{ totalUsd, unpricedCount, callCount }`

### Adversarial tests (`tests/store.test.mjs`, `tests/config.test.mjs`)
- Rejects partial R2 env vars (`R2_BUCKET` set without `R2_SECRET_ACCESS_KEY`).
- `local/secrets.json` overrides `.env`; clearing it falls back to `.env`; file permissions are `0o600`.
- `commitTurnPair` rolls back completely (zero orphan user turn, unchanged `scene_state_json`) if inserting an assistant beat fails a constraint.
- `deleteLastTurnPair` restores exact `scene_state_before_json` and updates derived `countTurnsSinceScribe`.
- Enforces unique `(campaign_id, slug)`, rejects invalid enum values, rejects deleting a character referenced by beats, and verifies pagination totals/cursors across 60 turns.
- `vacuumInto` produces a standalone readable SQLite snapshot containing uncommitted WAL transactions.

---

## Task 2: OpenRouter Client, Retry Policy, and Spend Tracking

### Files
- `universe/worlds/src/openrouter/RetryPolicy.mjs`:
  - Constants: `DelaysMs = [2000, 5000, 10000]`, `RetryStatuses = [408, 429, 500, 502, 503, 504]`, `TransientReasons = ['Provider returned error', 'Upstream error', 'Overloaded', 'Service unavailable']`.
  - `classifyFailure({ status, bodyText, error, aborted, bytesEmitted })` -> `{ retryable: boolean, reason: string }`.
  - `runWithRetry(operation, { wait, notify, signal, delaysMs })` — retries only when `retryable === true`; never retries `401/402/403`, `quota_error: true`, aborted signals, or failures after first streamed byte (`bytesEmitted > 0`).
- `universe/worlds/src/openrouter/OpenRouterClient.mjs`:
  - `class OpenRouterClient({ apiKeyProvider, fetchImpl, baseUrl, retryOptions, onSpend })`:
    - `complete({ model, messages, temperature, maxTokens, responseFormat, signal, stage, campaignId, onRetry })` -> `{ text, finishReason, usage: { promptTokens, completionTokens, costUsd } }`
    - `stream({ model, messages, temperature, maxTokens, signal, stage, campaignId, onDelta, onRetry })` -> `{ text, finishReason, usage: { promptTokens, completionTokens, costUsd }, truncated: boolean }`
    - Parses OpenRouter SSE `data: ...` lines across arbitrary chunk boundaries, detects mid-stream `{ error }` JSON frames and throws loudly without retrying, treats missing `usage.cost` as `null`, fails loudly when API key or model is missing.

### Adversarial tests (`tests/openrouter.test.mjs`)
- Retries HTTP 429, 503, 408, 500, 502, 504, network throws, and HTTP-200 transient JSON `{ error: { message: 'Provider returned error' } }` with 2s/5s/10s delays (mocked timer).
- Never retries 401, 402, 403, `quota_error: true`, or `AbortError`.
- Stream parser handles split UTF-8/SSE frames across chunks, aborts cleanly on mid-stream `{ error }` without retrying after bytes emitted, flags `truncated: true` on `finish_reason: 'length'`, and records `costUsd: null` without `NaN`.

---

## Task 3: Surgical Scribe Core Extraction & Native Services

### Files
- Pure ESM extractions from `zeta-dm-memory/scribe/core/` (zero Zeta DOM, zero `EvidencePromptLines`/`Checker`/`ScribeAdoption`, zero timers):
  - `universe/worlds/src/scribe/ScribeText.mjs` (`normaliseName`, `words`, `distance`, `resembles`, `fingerprint`)
  - `universe/worlds/src/scribe/ScribeCategory.mjs` (`parse`, `scope`, `sameScope`, `displayValue`, `value`, `same`)
  - `universe/worlds/src/scribe/ScribeIntakeAdapter.mjs` (converts Worlds `turns + beats` into Scribe-ordered attributed messages; provides minimal helpers required by `ScribeKnowledge`/`ScribeReplay`/`ScribeLogCore`)
  - `universe/worlds/src/scribe/ScribeReplay.mjs` (replays `book.log` into `{ subjects, facts, scenes, threads, questions, rulings }`, supporting both `Origin: 'Story'` and `Origin: 'Operator'` at `position: 0`)
  - `universe/worlds/src/scribe/ScribeKnowledge.mjs` (`open`, `within`, `narrowest`, `covering`, `audience`, `knows`, `about`)
  - `universe/worlds/src/scribe/ScribeLogCore.mjs` (`create`, `append`, `file`, `rule`, `tell`, `withdrawSources`, `syncCharacterSubject`)
- Native Worlds services:
  - `universe/worlds/src/scribe/ScribeService.mjs`:
    - `loadState(campaignId)` -> `{ log, state, lastTurnSeq, dirty }`
    - `characterKnowledgePacket({ state, character, presentCharacters, turnsById })` -> `{ knownFacts, relationships, visibleThreads, rulings }` (thread visibility: `position === 0` public seeded threads OR threads whose opening `turnId` has `character.id` in `witness_ids`)
    - `synthesizeSceneOperations(unreadTurns, charactersById)` — builds deterministic `Scene` ops (`firstPosition`, `lastPosition`, `place`, `day`, `reach`, `present: [scribeSubjectIds]`) directly from stored `turns`.
    - `updateMemory({ campaignId, upToSeq, signal })` — handles `dirty` repair (withdrawing edited turns' sources first), synthesizes `Scene` ops, calls `OpenRouterClient.complete` for structured JSON facts/relations/threads (1 repair retry on invalid JSON), appends to `ScribeLogCore`, persists `scribe_books`.
    - `tellPreview({ campaignId, instruction, signal })` / `tellCommit({ campaignId, operations })`
  - `universe/worlds/src/scribe/PedantService.mjs`:
    - `checkTurn({ campaignId, turn, beats, signal })` — builds `DOES NOT KNOW` per speaking character using `!ScribeKnowledge.knows(state, speakerSubjectId, fact)` across **all** active facts (including non-hidden facts from `private` scenes; no 60k-char bailout). Returns structured findings with `subjectId`, `subjectName`, `speakerCharacterId`, `factId`, `category`, `bookText`, `summary`, `quote`.
    - `resolveFinding({ campaignId, findingId, action, replacementText })` — executes `Rule it` (`ScribeLogCore.rule`), `They were told` (`ScribeLogCore.tell`), or `Dismiss`.
  - `universe/worlds/src/scribe/MuseService.mjs`:
    - `suggestDevelopment({ campaignId, signal })` — selects stale/open threads and returns a short `Narrator:` nudge string (never auto-sent).

### Adversarial tests (`tests/scribe.test.mjs`)
- `Origin: 'Operator'` seeded facts at `position: 0, cite: null` survive `ScribeReplay.run()` when `turns` is empty and do not collide with Worlds turns at `seq = 1, 2, ...`.
- Synthesized `private` scene facts propagate to co-present characters via `ScribeKnowledge.knows()` and are **hidden** from absent characters.
- `PedantService` flags a non-hidden fact from a `private` bedroom scene when an absent character uses it (proving the legacy `veiled()` bug is fixed).
- Operator `Rule it` overrides conflicting story facts across subsequent replays; `They were told` grants knowledge to the specific speaker only.
- `withdrawSources` cleanly removes facts/threads from a rolled-back turn without corrupting earlier turns; zero timers are created.

---

## Task 4: Core Turn Engine (`Director`, `CharacterMind`, `NarratorComposer`, `TurnEngine`)

### Files
- `universe/worlds/src/engine/EncounterRoller.mjs`:
  - `rollEncounter({ mode, sceneType, publicOdds, privateOdds, absentCast, random })` -> `{ triggered, forced, plausibilityRequired, targetKind: 'cast' | 'stranger' | null, stance: 'enemy' | 'friendly' | 'chatter' | null }` (guards `odds <= 0`, never triggers on `narrator`, forces hit on `encounter`).
- `universe/worlds/src/engine/WitnessFilter.mjs`:
  - `selectWitnessedBeats({ turns, characterId, maxTurns })` — filters beats strictly where `beat.witnessIds.includes(characterId)`, excluding `mindPacketJson` and un-witnessed turns.
- `universe/worlds/src/engine/BeatParser.mjs`:
  - Stateful streaming parser `class BeatParser({ validSlugs, nameToSlug, playerSlug })`:
    - `push(chunk)` -> `Array<{ speakerType, slug, speakerName, delta }>`
    - `flush()` -> remaining buffered text.
    - Buffers partial `[[BEAT:...` prefixes across arbitrary SSE chunk splits; defaults untagged opening prose to `narrator`; maps unknown tags by name or falls back to `narrator`; remaps any accidental `[[BEAT:<playerSlug>]]` to `narrator`.
- `universe/worlds/src/engine/Director.mjs`:
  - `planTurn({ campaign, characters, preState, recentTurns, userText, mode, oocNudge, encounterRoll, openThreadTitles, model, client, signal })` -> validated `DirectorPlan` + `nextState`.
  - 1 JSON repair retry on malformed output; enforces all code invariants: unknown slugs dropped, `presentIds`/`remoteIds` disjoint, `responders` subset of `presentIds ∪ remoteIds` excluding `player_character_id`, `mode === 'narrator'` forces `encounterAccepted = false`, `mode === 'encounter'` forces `encounterAccepted = true`, `pacing === 'narrator_only'` forces `responders = []`, `targetChars` clamped `600..2200`, `sceneChanged` increments `sceneNumber`, absent-player cut-away invariant enforced.
- `universe/worlds/src/engine/CharacterMind.mjs`:
  - `think({ character, campaign, nextState, witnessedHistory, knowledgePacket, currentInput, isArriving, encounterBrief, beatGoal, length, model, client, signal })` -> `{ characterId, slug, name, internalThought, physicalAction, spokenLines, tone, knowledgeBoundaries }`.
- `universe/worlds/src/engine/NarratorComposer.mjs`:
  - `compose({ campaign, characters, nextState, recentSceneTurns, userBeat, oocNudge, directorPlan, mindPackets, model, client, signal, onBeatDelta })` -> `{ beats, rawText, truncated }`.
  - Instructs Composer never to print `internalThought` as telepathy in shared beats and never to speak/act for the player character.
- `universe/worlds/src/engine/TurnEngine.mjs`:
  - Per-campaign in-flight `Set` mutex (throws `ConflictError` / HTTP 409 if busy).
  - `runTurn({ campaignId, text, mode, oocNudge, signal, emit })` — Steps 0–4: atomic commit at end of Step 3 only; fires non-blocking Pedant and deterministic Scribe triggers (`sceneChanged` analyzes `scene_number < nextState.sceneNumber` strictly before new turn, OR `turnsSinceScribe >= scribeInterval`).
  - `regenerateLastTurn({ campaignId, signal, emit })` — atomic rollback of last assistant turn + `ScribeLogCore.withdrawSources()` + re-run from paired user turn.
  - `deleteLastTurnPair({ campaignId })` — atomic rollback + `withdrawSources()`.
  - `editTurn({ campaignId, turnId, text })` — edits text + withdraws/marks `dirty = 1` if already read by Scribe.

### Adversarial tests (`tests/engine.test.mjs`)
- **Viola bedroom regression:** `"I need to get vegetables to Viola"` keeps Viola absent and never invokes her Mind.
- **Witness isolation:** Absent Collette's Mind prompt contains zero beats or private facts from Frost & Viola's bedroom scene; Lize's `internalThought` never appears in Collette's prompt on the next turn.
- **Cut-away scene:** `*Two hours later, Frost is doing his rounds, Mirra and Kira are in the party wagon. Maya knocks*` excludes Frost from `presentIds` and `witness_ids`; `Narrator:` cut-away beat has `speaker_type = 'narrator'` (never Frost).
- **Mid-turn encounter arrival:** Newly arrived character receives `encounterBrief`, NOT private pre-arrival user dialogue; `user` turn `witness_ids` excludes the newly arrived encounter character.
- **Abort / Mind failure atomicity:** Failed Mind or mid-stream Composer abort leaves zero orphan `user` turns and unchanged `scene_state_json`, while preserving intermediate `spend_log` entries (`turn_id = NULL`).
- **Concurrency:** Overlapping `runTurn` on the same campaign fails immediately with `ConflictError`.
- **BeatParser fuzzing:** `[[BEAT:lize]]` split 1 character per chunk parses identically; `[[BEAT:frost]]` remaps to `narrator`; unknown tags fall back cleanly.
- **Regenerate rollback:** Turn that triggered Scribe + Regenerate withdraws discarded turn facts before re-running Minds.
- **Scene-change Scribe off-by-one:** On `sceneChanged === true`, Scribe receives strictly prior-scene turns (`scene_number < nextState.sceneNumber`).

---

## Task 5: Cloudflare R2 Snapshot Sync (`R2Transport`, `WorldSync`)

### Files
- `universe/worlds/src/sync/R2Transport.mjs` — SigV4 transport modeled on `universe/src/r2.mjs` with sized `bodyTimeoutMs` (`120_000 + Math.ceil(bytes / 25_000) * 1000`).
- `universe/worlds/src/sync/WorldSync.mjs`:
  - Prefix `_worlds/v1/` (`_worlds/v1/control.json`, `_worlds/v1/snapshots/<uuid>.sqlite`).
  - `hasForeignObjects()` — lists bucket root; returns `true` if any top-level object or prefix other than `_worlds/` exists (refuses to touch Universe's bucket!).
  - `pullOnStartup({ dbPath, syncStatePath, conflictsDir, signal })`:
    - Runs **before** opening runtime SQLite connection.
    - Handles offline fallback (15s timeout -> `{ status: 'offline' }`), foreign bucket refusal (`{ status: 'foreign_bucket' }`), bucket-swap detection, `pendingHead` promotion, and WAL-safe conflict backup (`VACUUM INTO local/conflicts/<utc>/worlds.sqlite` + close + remove `-wal`/`-shm` + SHA-256 verified atomic rename).
  - `pushSnapshot({ store, syncStatePath, signal })`:
    - `VACUUM INTO` temp snapshot -> SHA-256 -> upload snapshot -> persist `pendingHead` -> `PUT control.json` with `If-Match` / `If-None-Match: *` -> on `409`/`412` returns `{ status: 'conflict' }` without overwriting -> on success updates `sync-state.json` and prunes snapshots beyond newest 30 & older than 24h (paginated `IsTruncated`, never deleting `control.head`).

### Adversarial tests (`tests/sync.test.mjs`)
- Refuses to sync when bucket contains `_universe/` or any foreign top-level file.
- Detects bucket swap against `local/sync-state.json`.
- `pendingHead` recovers cleanly without false conflict when `PUT control.json` succeeded server-side before timeout.
- WAL-mode local DB with uncheckpointed transactions is preserved intact in `local/conflicts/<utc>/worlds.sqlite` on cloud conflict, and stale `-wal`/`-shm` files are removed before opening the pulled snapshot.
- `If-Match` mismatch (`412`) refuses overwrite and reports newer remote save.
- Pruner paginates across >1 listing page and never deletes `control.head` even when >30 snapshots exist and `head` is >24h old.
- Offline R2 falls back cleanly to local DB without throwing.

---

## Task 6: Hardened Local HTTP Server & Complete REST/SSE API

### Files
- `universe/worlds/src/http/Security.mjs` — exact loopback `Host` check (`127.0.0.1:<port>` / `localhost:<port>` on all routes), loopback `Origin` + constant-time `X-Worlds-CSRF` check on all mutations, CSP (`default-src 'self'; frame-ancestors 'none'; form-action 'none'`), `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, 256 KB JSON body reader.
- `universe/worlds/src/http/RateLimiter.mjs` — sliding-window in-memory limiter (`30/min` LLM routes, `120/min` general API routes, `429` with `Retry-After`).
- `universe/worlds/src/http/SseStream.mjs` — `Content-Type: text/event-stream`, flush helpers, client disconnect `AbortController` bridge.
- `universe/worlds/src/http/Router.mjs` — implements every route in the design spec's HTTP API surface table, strict input validation, structured error responses (`400/403/404/409/413/429/500`).
- `universe/worlds/src/server.mjs` — CLI entrypoint: loads config -> startup R2 pull -> opens `SqliteStore` -> binds strictly to `127.0.0.1` -> prints URL -> handles `SIGINT`/`SIGTERM` (aborts in-flight turns, bounded 30s R2 push, closes DB).

### Adversarial tests (`tests/http.test.mjs`)
- Rejects non-loopback `Host` header (DNS rebinding) on `GET /` and `GET /api/health` with `403`.
- Rejects missing/wrong `X-Worlds-CSRF` or foreign `Origin` on `POST`/`PATCH`/`PUT`/`DELETE` with `403`.
- Rejects >256 KB JSON bodies with `413`; enforces rate limits with `429` + `Retry-After`.
- Never leaks OpenRouter API key in `GET /api/settings`, `GET /api/health`, or error payloads.
- Exercises full campaign CRUD -> cast CRUD -> SSE `POST /turns` -> `POST /turns/regenerate` -> `DELETE /turns/last` -> `GET /memory` -> `POST /findings/:id/resolve` -> `POST /sync/save`.

---

## Task 7: Phone-First Web UI (`public/`)

### Files
- `universe/worlds/public/index.html` — semantic shell with `<meta name="worlds-csrf" content="__CSRF_TOKEN__">`.
- `universe/worlds/public/styles.css` — complete CSS token palette (including all 8 `avatar_token` classes: `.avatar-sage` .. `.avatar-coral`, `.avatar-narrator`, `.avatar-player`), phone-first responsive layout (slide-over drawer on mobile, docked sidebar on desktop), visible `:focus-visible`, `@media (prefers-reduced-motion: reduce)`, opaque fallbacks, zero inline styles.
- `universe/worlds/public/api.mjs` — CSRF-aware `fetch` wrapper + `fetch()`/`ReadableStream` SSE consumer supporting `AbortController` (**Stop**).
- `universe/worlds/public/components/ChatView.mjs` — paginated chat stream (**Load earlier**), woven speaker-tagged beat rendering with avatar badge + name + escaped `textContent`, truncation badge, last-turn action bar (Regenerate, Edit, Delete).
- `universe/worlds/public/components/ComposerBar.mjs` — textarea (Enter sends, Shift+Enter newline, auto-badges `Narrator:`), collapsible **OOC Nudge**, **Encounter** button, **Send** / **Stop**, live phase banner (`Directing...` -> `Thinking: ...` -> `Composing...`).
- `universe/worlds/public/components/InspectorDrawer.mjs` — tabs: **Scene & Presence** (1-click `Present`/`Remote`/`Absent`, off-screen notes, walk-ons), **Cast** (paginated), **Memory** (paginated subjects/facts/relations/threads, **Update Memory** + `dirty` badge, **Tell Scribe** Work-it-out/File-it, **Muse** Suggest/Use), **Findings & Rulings** (paginated, Rule it / They were told / Dismiss), **Settings** (5 model slots, odds, interval, Pedant, soft daily warning, API key status/override).
- `universe/worlds/public/components/CampaignModal.mjs`, `CharacterModal.mjs`, `ConfirmModal.mjs` — Save rightmost, Cancel left, visible required markers, confirm dialogs for destructive actions only, immediate loading states on every round-trip.
- `universe/worlds/public/app.mjs` — state wiring, URL-free clean SPA boot, spend soft-warning banner, R2 Save-to-Cloud trigger + status display.

### Adversarial tests (`tests/ui.test.mjs`)
- Static audit across `public/**`: zero inline `style=` attributes, zero `.style.` raw color assignments, zero raw hex/rgb literals in `.html`/`.mjs`, zero `innerHTML` with dynamic interpolation, zero emojis.
- Tests SSE client frame parser (chunked UTF-8, mid-stream error, Abort) and escaped rendering helpers against XSS payloads (`<img src=x onerror=alert(1)>`).

---

## Task 8: Local Zeta Export Seeder & Final Verification

### Files
- `universe/worlds/scripts/seed-from-export.mjs`:
  - Usage: `node scripts/seed-from-export.mjs <path-under-/var/www> [--title "..."] [--dry-run]`.
  - Resolves `<path>` with `fs.realpathSync()` and rejects any path outside `/var/www` (blocking symlink escapes).
  - Replays the export's `book.log` using its original message ID order via `ScribeReplay.run()`.
  - Creates a new campaign in `local/worlds.sqlite` with:
    - Player character (`is_player = 1`), top recurring/main character subjects mapped to unique `slug`, `scribe_subject_id`, `tier` (`main` for core cast, `recurring` for secondary characters), `avatar_token`, and persona summary synthesized from their surviving facts.
    - Surviving active subjects, aliases, facts (preserving `hidden`/`knownBy`/`pinned`), and open threads materialized as clean `Origin: 'Operator'` (`position: 0, cite: null`) entries in `scribe_books` (dropping Zeta `Scene` spans so Worlds turn positions `1, 2, ...` never collide).
- `universe/worlds/tests/seed.test.mjs` — tests seeding from a fictional Zeta-shaped export fixture into a temporary SQLite DB, verifies seeded facts survive `ScribeReplay.run()` with empty `turns`, verifies cast `scribe_subject_id` links match, and verifies symlink outside `/var/www` is rejected.

### Final verification gate
- Run full suite: `node --test tests/*.test.mjs` from `/var/www/demo_stuff/universe/worlds/`.
- Operator runs `node scripts/seed-from-export.mjs /var/www/demo_stuff/zeta-dm-memory/scribe/private/hero_gone_latest.json` locally and playtests turns 1–30 through `node src/server.mjs` before deciding on Phase 2.
