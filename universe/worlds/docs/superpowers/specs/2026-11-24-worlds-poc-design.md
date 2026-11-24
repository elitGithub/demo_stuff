# Worlds POC Design

Status: builder-reviewed draft for operator approval (2026-11-24).

## Why

- SillyTavern + Aspect: Vocalia broke on turn 5 of a real multi-character scenario: regex word-distance matching pulled absent Viola into a bedroom on "I need to get vegetables to Viola", and SillyTavern's shared group-chat transcript caused Collette to fixate on Viola.
- Zeta's single-prompt style felt fluid and adaptive across intimate 1-on-1 beats and fast ensemble banter, and let the player steer scenes inline, but its memory degraded over long campaigns (1,384+ messages) and had no private per-character knowledge boundaries.
- `zeta-dm-memory` already solved structured story memory (subjects, relationships, who-knows-what, open threads, operator Rulings, Pedant, Muse), but fought Zeta's DOM/iframe and accumulated polling/guardrail overhead.
- Worlds unifies the proven narrative brain and 3-tier character model into a small, local-first standalone app under `universe/worlds/` before investing in Phase 2 wizards.

## Operator decisions (2026-11-24)

1. **Location and stack:** Live under `universe/worlds/` (leaving existing SillyTavern/Universe launcher files untouched). Zero-dependency Node 24 (`node:http`, `node:sqlite`, `node:crypto`, native `fetch`, `node --test`) with a vanilla HTML/CSS/ESM frontend.
2. **Runtime and sync:** Local Node + SQLite (`local/worlds.sqlite`, gitignored) behind a clean `StoryStore` repository boundary (so a later move to Cloudflare D1 or a hosted server does not rewrite engine logic) + Cloudflare R2 sync for switching between two PCs using a dedicated R2 bucket in `worlds/.env` (never sharing Universe's SillyTavern R2 bucket).
3. **3-tier character model:**
   - `main`: own AI call on the main model (or per-character override) with strict witness-filtered history and Scribe facts known to them.
   - `recurring`: own AI call on a smaller/cheaper model (or per-character override) with compact witness-filtered history and Scribe facts known to them.
   - `walkon`: played by the Narrator inside Narrator beats and tracked in the active walk-ons list until they leave.
4. **Turn loop and output style:** **Director -> Parallel Witness-Isolated Character Minds -> Narrator Composer**. Outputs one cohesive Zeta-paced scene (adaptive to intimate 1-on-1 vs. multi-character banter) broken into **speaker-tagged beats**, each rendered with that speaker's **name and avatar**.
5. **Presence, cut-away scenes, walk-ons, and encounters:**
   - Talking *about* an absent character never summons them.
   - Arrivals and exits come from: (a) clear player narrative intent parsed by the Director, (b) automatic encounter rolls (`1/8` public, `1/30` private, configurable, gated by plausibility), (c) the **Encounter** button (forced hit, no plausibility check), or (d) one-click toggles in the Presence drawer.
   - **Cut-away / player-absent scenes are first-class:** the player character (e.g., Frost) is a normal cast entry (`is_player = 1`), not hardcoded as always present. When the player writes `*Two hours later, Frost is doing his rounds, Mirra and Kira are in the party wagon. Maya knocks*`, the active scene has `present = [Mirra, Kira, Maya]` and `offscreenNotes = { frost: "doing his rounds" }`. Frost is excluded from `witness_ids` until written back in.
6. **Two-layer memory (surgical Scribe extraction):**
   - **Layer 1 (Live Director state):** updated synchronously on every committed turn (location, time, `public`/`private`, present/remote/absent, off-screen notes, walk-ons). Zero lag.
   - **Layer 2 (Stripped-down Scribe Book):** surgically extracted pure domain logic from `zeta-dm-memory/scribe/core/` (subjects, facts, relations, who-knows-what, open/closed threads, operator Rulings, Pedant contradiction/secret-leak checks, Muse thread-revival suggestions). All Zeta DOM/iframe code, `EvidencePromptLines`/`Checker`/`ScribeAdoption` overhead, periodic polling, background OpenRouter hammering, `@: [Scribe]` chat injection, and arbitrary blocking lockouts are dropped. Memory updates run only on deterministic triggers: scene transition, every N turns (configurable, default 10, `0` = manual only), or manual **Update Memory** click.
7. **POC seeding and scope:**
   - Manual campaign and cast setup form in the UI.
   - Local CLI seed helper (`scripts/seed-from-export.mjs`) that reads a Zeta Scribe export (such as `zeta-dm-memory/scribe/private/hero_gone_latest.json`) and populates a starter campaign roster and materialized starting facts into gitignored `local/worlds.sqlite`. Committed tests and fixtures stay strictly fictional.
   - **Phase 2 (explicitly deferred until POC turns 1–30 prove the play feel):** AI Plot Generator wizard, AI Character Generator + 1-click Walk-on Promotion wizard, Image Generation (portraits/snapshots), full-chat Zeta history importer, remote/phone hosting.

## Goals, non-goals, anti-goals

- **Goals:** Playable 3-tier multi-character engine with true witness isolation, cut-away scenes, adaptive Zeta-style woven output with per-beat speaker avatars, stripped-down Scribe memory (Book, Rulings, Pedant, Muse), encounter rolls/button, atomic Regenerate/Delete rollback, OpenRouter retry + spend tracking, and safe R2 handoff between two PCs.
- **Non-goals (POC):** SillyTavern card PNG import/export, branching message trees, TTS/sprites, multi-user auth, AI plot/character/image wizards (Phase 2).
- **Anti-goals:** Sharing Universe's R2 bucket; periodic background timers that call OpenRouter unprompted; hiding OpenRouter errors or swallowing malformed model JSON; hardcoding censored models (all 5 model slots are OpenRouter-configurable for adult/RP campaigns).

## Architecture

### Folder layout (`universe/worlds/`)

- `.env.example`, `.gitignore` (`local/`, `.env`), `README.md`
- `src/server.mjs` — HTTP server bound strictly to `127.0.0.1` (`WORLDS_PORT`, default `8768`), startup R2 pull before opening SQLite (when configured), graceful Ctrl+C abort + bounded R2 push (30s timeout).
- `src/config.mjs` — reads `worlds/.env` and process env (`WORLDS_PORT`, `OPENROUTER_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`) plus `local/secrets.json` (mode `0o600`, atomic write). Key precedence: `local/secrets.json` overrides `.env` when set via Settings UI; clearing the UI override falls back to `.env`.
- `src/http/` — route dispatcher, loopback `Host` + `Origin` validation on all routes, `X-Worlds-CSRF` token enforcement on all mutations, per-IP/route rate limiter, 256 KB JSON body cap, CSP/security headers, SSE stream helper, static asset server.
- `src/store/` — `schema.sql` and `SqliteStore.mjs` implementing a clean `StoryStore` contract (no SQL outside `src/store/`). Opens `node:sqlite` with `PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;`.
- `src/openrouter/` — `OpenRouterClient.mjs` (chat completions + SSE streaming + `usage.cost` / `finish_reason` extraction), `RetryPolicy.mjs` (2s/5s/10s backoff matching `universe/extension/universe-retry/ReplyRetry.js`: retries network drops, HTTP `408/429/500/502/503/504`, and transient OpenRouter JSON errors; never retries `401/402/403`, quota errors, partial streams after first byte, mid-stream SSE `{ error }` frames, or user Abort).
- `src/engine/` — `TurnEngine.mjs`, `Director.mjs`, `CharacterMind.mjs`, `NarratorComposer.mjs`, `EncounterRoller.mjs`, `WitnessFilter.mjs`, `BeatParser.mjs`.
- `src/scribe/` — surgically extracted pure ESM modules converted from `zeta-dm-memory/scribe/core/` (`ScribeText.mjs`, `ScribeCategory.mjs`, `ScribeAnswer.mjs`, `ScribeIntakeAdapter.mjs`, `ScribeLog.mjs`, `ScribeReplay.mjs`, `ScribeKnowledge.mjs`, `ScribeAnalyzer.mjs`) — explicitly dropping Zeta's `EvidencePromptLines`, `Checker`, and `ScribeAdoption` — plus native services (`ScribeService.mjs`, `PedantService.mjs`, `MuseService.mjs`).
- `src/sync/` — `R2Transport.mjs` (SigV4 transport matching `universe/src/r2.mjs` with sized `bodyTimeoutMs` for snapshots) and `WorldSync.mjs` (atomic SQLite snapshot sync via `VACUUM INTO` + `hasForeignObjects()` guard + ETag compare-and-swap on `_worlds/v1/control.json`).
- `public/` — `index.html`, `styles.css`, `app.mjs`, `api.mjs`, `components/` (phone-first responsive layout, CSS custom-property tokens, no inline styles, escaped DOM rendering, `fetch()` + `ReadableStream` for CSRF-authenticated SSE).
- `scripts/seed-from-export.mjs` — reads a Zeta Scribe JSON export (verified via `fs.realpathSync()` under `/var/www`), replays its book during seeding, and writes a starter campaign + cast + materialized `Origin: 'Operator'` facts (`position: 0, cite: null`) into `local/worlds.sqlite`.
- `tests/` — `node --test` suites using in-memory / temp SQLite, fake OpenRouter, and fake R2 transport with fictional fixtures only.

### Code and screen standards

Implementation follows `/var/www/demo_stuff/AGENTS.md` strictly: zero single-letter variables, tag-only JSDoc on every method/function, braces always, enums with labels and structured objects between layers, no emojis anywhere, phone-first responsive CSS with stylesheet tokens (zero inline `style` attributes), paginated lists everywhere, and immediate loading states on every server round-trip.

## Data model (`local/worlds.sqlite`)

All primary keys are UUIDs; all timestamps are ISO-8601 UTC strings.

- `settings` (`key TEXT PRIMARY KEY, value_json TEXT NOT NULL`) — stores global default OpenRouter model slots (`director`, `composer`, `main`, `recurring`, `scribe`), default encounter odds (`publicOdds: 8`, `privateOdds: 30`), default `scribeInterval: 10`, `pedantEnabled: true`, optional `dailyWarnUsd` (soft warning banner only, never locks out turns). OpenRouter API key is never stored in SQLite.
- `campaigns` (`id`, `title`, `premise`, `style_notes`, `player_character_id` nullable for ensemble/spectator campaigns, `scene_state_json`, `encounter_public_odds`, `encounter_private_odds`, `scribe_interval`, `created_at`, `updated_at`)
  - New campaigns inherit defaults from `settings`; `0` disables auto-encounters (guarded against division by zero) or auto-Scribe.
  - `turns_since_scribe` is derived directly from `COUNT(turns WHERE campaign_id = ? AND role = 'assistant' AND seq > scribe_books.last_turn_seq)` — never stored as a drift-prone counter.
  - `scene_state_json` holds current live state (referencing character UUIDs):
    ```json
    {
      "sceneNumber": 1,
      "day": 1,
      "timeLabel": "Morning",
      "location": "Village",
      "sceneType": "public",
      "presentIds": ["<uuid-frost>", "<uuid-lize>"],
      "remoteIds": [],
      "offscreenNotes": {},
      "activeWalkOns": []
    }
    ```
  - `remoteIds` semantics: **live audio/comm contact** (e.g., sending stone, shouting through a closed door, phone). Remote characters witness audible beats in the scene and count as `present` in synthesized Scribe `Scene` ops so `WitnessFilter` and `ScribeKnowledge` never diverge.
- `characters` (`id`, `campaign_id`, `slug`, `scribe_subject_id`, `name`, `aliases_json`, `is_player`, `tier`, `model_override`, `persona`, `voice_notes`, `avatar_token`, `avatar_initials`, `archived`, `created_at`, `updated_at`)
  - `slug`: unique per campaign, short lowercase ASCII (`frost`, `lize`, `collette`), used in LLM prompts and `[[BEAT:<slug>]]` tags instead of 36-char UUIDs.
  - `scribe_subject_id`: maps 1:1 to Scribe subject IDs (`S1`, `S2`, ...) and syncs labels/aliases when a character is created or edited.
  - `tier`: `'main' | 'recurring'`. (Walk-ons live in `scene_state_json.activeWalkOns` until promoted.)
  - `avatar_token`: enum of CSS theme tokens (`sage`, `rose`, `amber`, `slate`, `plum`, `teal`, `indigo`, `coral`) mapped to classes in `styles.css` (no inline styles or raw hex values).
  - Deleting a character referenced by `turns` or `beats` is forbidden; users can **Archive** them instead.
- `turns` (`id`, `campaign_id`, `seq`, `role`, `mode`, `raw_text`, `ooc_nudge`, `scene_number`, `witness_ids_json`, `scene_state_before_json`, `scene_state_after_json`, `director_plan_json`, `truncated`, `created_at`)
  - `role`: `'user' | 'assistant'`; `mode`: `'normal' | 'narrator' | 'encounter'`.
  - `scene_state_before_json` snapshots the campaign's `scene_state_json` before the user+assistant turn pair so **Delete** and **Regenerate** restore exact prior presence, walk-ons, and location atomically.
  - `truncated`: `1` if Composer returned `finish_reason === 'length'`, surfaced as a visible warning badge in the UI.
- `beats` (`id`, `turn_id`, `seq`, `speaker_type`, `character_id`, `speaker_name`, `text`, `witness_ids_json`, `mind_packet_json`)
  - `speaker_type`: `'narrator' | 'character' | 'player'`.
  - User turns in `mode === 'narrator'` store `speaker_type = 'narrator'`, `character_id = NULL`, `speaker_name = 'Narrator'` (never misattributed to the player character during cut-away scenes). User turns in `mode === 'normal'` or `'encounter'` with an active player character store `speaker_type = 'player'`, `character_id = player_character_id` (or `'narrator'` if the Director detects a 3rd-person cut-away stage direction while the player is absent).
  - `witness_ids_json` is stored per beat so mid-turn arrivals do not expose earlier pre-arrival beats.
  - `mind_packet_json` stores the private Mind output for operator inspection only; it is never sent to other characters.
- `scribe_books` (`campaign_id PRIMARY KEY`, `book_json`, `last_turn_seq`, `dirty`, `updated_at`)
  - `book_json` stores the Scribe event log (`version`, `entries`, counters) replayed via `ScribeReplay`.
  - `dirty = 1` when an older already-read turn is edited, showing a non-intrusive **Memory out of date — Update** badge instead of polling.
- `findings` (`id`, `campaign_id`, `turn_id`, `kind`, `subject_id`, `subject_name`, `speaker_character_id`, `fact_id`, `category`, `book_text`, `summary`, `quote`, `status`, `created_at`)
  - `kind`: `'contradiction' | 'secret_leak' | 'name_mismatch'`.
  - `status`: `'open' | 'dismissed' | 'ruled' | 'told'`.
  - Carries exact Scribe IDs (`subject_id`, `fact_id`, `speaker_character_id`) so **Rule it** and **They were told** execute cleanly against `ScribeLog`.
- `spend_log` (`id`, `campaign_id`, `turn_id` nullable, `stage`, `model`, `prompt_tokens`, `completion_tokens`, `cost_usd` nullable, `created_at`)
  - `stage`: `'director' | 'mind' | 'composer' | 'scribe' | 'pedant' | 'muse'`.
  - `turn_id` is nullable so aborted/failed intermediate Director or Mind calls still record spend immediately. `cost_usd` is nullable when OpenRouter omits cost (`$X.XX (+unpriced)` in header, UTC day boundary).

## HTTP API surface

All routes validate loopback `Host` (`127.0.0.1:<port>` or `localhost:<port>`). All mutating routes require `X-Worlds-CSRF` + loopback `Origin`. Lists paginate (`limit` default 25, max 50; chat turns default 50) and return `{ items, total, nextCursor }`.

| Method & Path | Purpose |
| --- | --- |
| `GET /` | Serves `index.html` with per-session CSRF `<meta>` token and strict CSP |
| `GET /api/health` | Status, active R2 sync state, today's UTC spend |
| `GET /api/settings`, `PUT /api/settings` | Read/update model slots, defaults, API key status (`local/secrets.json` vs `.env`) |
| `GET /api/campaigns`, `POST /api/campaigns`, `PATCH /api/campaigns/:id`, `DELETE /api/campaigns/:id` | Campaign CRUD + scene/presence manual updates |
| `GET /api/campaigns/:id/characters`, `POST /api/campaigns/:id/characters`, `PATCH /api/campaigns/:id/characters/:charId` | Cast CRUD and archiving (syncs `scribe_subject_id` label/aliases) |
| `GET /api/campaigns/:id/turns` | Paginated turns + beats (newest page first, cursor for **Load earlier**) |
| `POST /api/campaigns/:id/turns` | Runs turn pipeline; responds as SSE via `fetch()` + `ReadableStream` (per-campaign in-flight mutex returns `409 Conflict` if busy) |
| `POST /api/campaigns/:id/turns/regenerate` | Atomically rolls back last assistant turn + Scribe entries for it and re-runs pipeline via SSE |
| `PATCH /api/campaigns/:id/turns/:turnId` | Edits turn text; withdraws/marks Scribe `dirty` if already read |
| `DELETE /api/campaigns/:id/turns/last` | Deletes last turn pair atomically, restoring `scene_state_before_json` and withdrawing Scribe entries |
| `GET /api/campaigns/:id/memory` | Paginated Scribe subjects/facts/relations/threads + `dirty` flag + rulings |
| `POST /api/campaigns/:id/memory/update` | Deterministic manual Scribe update (also resolves `dirty` withdrawn turns) |
| `POST /api/campaigns/:id/memory/tell` | Two-step **Work it out** (preview) / **File it** (commit operator Ruling/fact) |
| `POST /api/campaigns/:id/memory/muse` | Suggests a `Narrator:` nudge reviving an open thread |
| `GET /api/campaigns/:id/findings`, `POST /api/campaigns/:id/findings/:findingId/resolve` | Paginated Pedant findings + **Rule it** / **They were told** / **Dismiss** |
| `POST /api/sync/save` | Triggers explicit R2 snapshot push and returns result |

## Turn pipeline

Entry point: `POST /api/campaigns/:id/turns` (acquires per-campaign in-flight lock; returns `409` if another turn is running on this campaign). Nothing is committed to `turns` or `campaigns.scene_state_json` until Step 3 completes, preventing orphan `user` turns or dirty state on failure or **Stop**.

### Input
`{ text: string, mode: 'normal' | 'narrator' | 'encounter', oocNudge?: string }`
- Leading `Narrator:` (ignoring leading `*`, `_`, whitespace) forces `mode = 'narrator'` and strips the prefix in prompt transcripts.
- `mode = 'encounter'` with empty `text` uses `*(Encounter)*`.

### Step 0: Encounter pre-roll
- `mode === 'narrator'`: `encounterRoll = { rolled: false }`.
- `mode === 'encounter'`: forced hit, skips plausibility check; rolls target (`1/3` absent non-archived, non-player cast member if any exist, else stranger) and stance (`1/3` enemy, `1/3` friendly, `1/3` chatter).
- `mode === 'normal'`: when the active odds value (`encounter_public_odds` or `encounter_private_odds`) is `> 0`, rolls `1 / odds`. On hit, passes candidate target kind + stance to Director for plausibility check. When `odds === 0`, skips rolling.

### Step 1: Director pass (1 fast JSON call)
- **Inputs:** campaign premise, current `scene_state` (`preState`), full non-archived cast roster (`slug`, `name`, `aliases`, `tier`, short role summary, `is_player`, current presence), active walk-ons, last 8 turns (compact speaker-tagged lines), user message + `oocNudge`, encounter roll candidate, and open Scribe thread titles.
- **Required JSON output (using character `slug`s, mapped to UUIDs in code):**
  - `sceneChanged: boolean`
  - `location: string`, `day: number`, `timeLabel: string`, `sceneType: 'public' | 'private'`
  - `userInputKind: 'player_in_scene' | 'narrator_direction'` (distinguishes Frost acting in-scene vs. a 3rd-person cut-away direction when Frost is absent)
  - `presentSlugs: string[]`, `remoteSlugs: string[]`
  - `offscreenNotes: Record<string, string>`
  - `walkOnsEnter: string[]`, `walkOnsLeave: string[]`
  - `encounterAccepted: boolean`, `encounterBrief: string`
  - `pacing: 'intimate_deep' | 'focused_one' | 'group_banter' | 'narrator_only'`
  - `targetChars: number` (clamped in code to `600..2200`, default `1350`)
  - `responders: Array<{ slug: string, beatGoal: string, length: 'short' | 'medium' | 'long' }>` (max 3)
  - `narratorDirective: string`
- **Hard code-enforced invariants:**
  - Unknown slugs are dropped; `presentIds` and `remoteIds` are disjoint.
  - Talking *about* an absent character never adds them to `presentIds`; only explicit arrival/scene-move narration, accepted encounter, or existing presence puts them in `presentIds`.
  - When `sceneChanged === true`, code increments `sceneNumber` and clears `activeWalkOns` except those explicitly carried or entered in `walkOnsEnter`.
  - Every `responder` must be in `presentIds ∪ remoteIds` and must NOT be `player_character_id`.
  - If `mode === 'narrator'`, `encounterAccepted` is forced `false`. If `mode === 'encounter'`, `encounterAccepted` is forced `true`. If `pacing === 'narrator_only'`, `responders` is forced `[]`.
  - **Absent-player cut-away invariant:** if `userInputKind === 'player_in_scene'` while `player_character_id` is absent from `presentIds`, Director must either place the player into `presentIds` (arriving) or cut the scene back to the player (`sceneChanged = true`, `presentIds = [player]`); a player-spoken beat is never witnessed by characters who are not in the player's active scene.
  - On malformed JSON, retry once with a strict JSON-fix prompt; if still invalid, abort cleanly with zero DB mutations and return an error SSE event.
  - Emit ephemeral SSE `phase: "director_done"` (preview only; DB not mutated yet).

### Step 2: Parallel Witness-Isolated Character Minds
- Skipped completely if `responders.length === 0`.
- Runs `Promise.all` across `responders` (max 3). Emits SSE `phase: "minds"` with responder names.
- Compute `arrivingIds = (nextPresentIds ∪ nextRemoteIds) \ (prePresentIds ∪ preRemoteIds)` (for non-cut-away turns where an encounter or arrival occurs mid-turn).
- For each responder `character`:
  - **Model:** `character.model_override || settings.models[character.tier]`.
  - **Witness filter (`WitnessFilter.mjs`):** loads only prior beats where `beats.witness_ids_json` contains `character.id` (capped to last `25` witnessed turns for `main`, `12` for `recurring`). Messages from scenes `character` did not witness are never included.
  - **Current turn input:** if `character.id` is in `arrivingIds` (arriving mid-turn via encounter/arrival), receives `encounterBrief` + observable arrival context rather than private pre-arrival user dialogue. Otherwise receives the current user beat.
  - **Knowledge filter (`ScribeKnowledge`):** extracts only facts known to `character.scribe_subject_id` (public facts + facts from scenes they witnessed + facts explicitly told to them), their relationships with people in `nextPresentIds ∪ nextRemoteIds`, operator Rulings, and open threads visible to them (seeded `position === 0` public threads, or threads whose opening turn has `character.id` in `witness_ids`).
  - **Output (compact JSON):** `{ internalThought, physicalAction, spokenLines, tone, knowledgeBoundaries }`.
  - If any Mind call fails after retries or is aborted, abort the entire turn cleanly (log spend for completed calls with `turn_id = NULL`, leave `turns` and `scene_state_json` untouched, surface exact character/error to UI).

### Step 3: Narrator Composer (1 streamed call)
- Emits SSE `phase: "composing"`.
- **Inputs:** campaign premise & style notes, updated `scene_state`, active walk-ons, recent turns from the **current scene** (prose continuity), current user turn + `oocNudge`, Director's `narratorDirective`, `pacing`, `targetChars`, `encounterBrief`, and Character Mind packets labeled with `slug` and `name`.
- **Hard prompt contracts:**
  - Preserve each Character Mind's spoken intent and knowledge boundaries.
  - `internalThought` informs body language, hesitation, and subtext **only** — never print telepathic inner monologue as readable facts in shared beats.
  - Never speak, act, or think for the player character (`is_player = 1`).
- **Speaker-tag streaming protocol (`BeatParser.mjs`):**
  ```text
  [[BEAT:narrator]]
  *The tavern door swung open...*
  [[BEAT:lize]]
  *She froze, hand halfway to her cup.*
  ...You can't just do that in front of people.
  [[BEAT:collette]]
  *Her jaw dropped.*
  He just wiped her mouth!
  ```
  - `BeatParser` is stateful across SSE chunks (buffers partial `[[BEAT:...` prefixes so split tags never leak into prose).
  - Leading prose without a tag defaults to `narrator`; unknown tags match case-insensitively against present/remote character slugs or names and otherwise fall back to `narrator`; accidental `[[BEAT:<player_slug>]]` tags are remapped to `narrator` (stripping/flagging player impersonation).
  - Streamed live over SSE as incremental beat deltas so the UI renders each beat with its speaker's **name and avatar badge** in real time.
  - If OpenRouter emits a mid-stream SSE `{ error }` frame or drops mid-stream, abort cleanly without committing (never retry after bytes have streamed). If `finish_reason === 'length'`, commit with `truncated = 1` and show a truncation notice.
- **Atomic commit (single SQLite transaction):**
  1. Insert `user` turn (`witness_ids = prePresentIds ∪ preRemoteIds` when in-scene, or `nextPresentIds ∪ nextRemoteIds` for a fresh cut-away `narrator` scene) + its beat (`player` or `narrator`).
  2. Insert `assistant` turn + ordered `beats` (`witness_ids = nextPresentIds ∪ nextRemoteIds` for beats involving/following arrival, or `prePresentIds ∪ preRemoteIds` for pre-arrival beats if split).
  3. Update `campaigns.scene_state_json = nextState`, link `spend_log.turn_id` for this turn's calls, and increment `localChangeSeq`.

### Step 4: Deterministic Post-Turn Memory & Pedant
- **Pedant (optional, default on):** if `scribe_books` has subjects/facts and `pedantEnabled` is true, runs 1 non-blocking check on the new assistant beats. Unlike legacy `ScribePedant.js` (which only checked `fact.hidden === true` and bailed silently over 60k chars), `PedantService` checks `!ScribeKnowledge.knows(state, speakerSubjectId, fact)` across **all** active facts (including non-hidden facts from `private` scenes) with no silent bailout. Saves structured rows into `findings` and emits SSE `event: "findings"`.
- **Scribe Book update (`ScribeService.mjs`):** runs ONLY when:
  1. `director.sceneChanged === true` — analyzes unread turns **strictly before** the new turn (`scene_number < nextState.sceneNumber`, i.e., the just-completed previous scene), OR
  2. `turns_since_scribe >= campaign.scribe_interval` (when `scribe_interval > 0`), OR
  3. User clicks **Update Memory** in the drawer.
  Never runs on a timer. `ScribeService` synthesizes deterministic `Scene` operations (`firstPosition`, `lastPosition`, `place`, `day`, `reach`, `present`) directly from stored `turns` into `ScribeLog`, then calls the Scribe LLM for facts/relations/threads only — without Zeta's `EvidencePromptLines` or `Checker` overhead.

## Editing, Deleting, Regenerating, and Operator Rulings

- **Regenerate last reply:** acquires campaign lock, deletes the last `assistant` turn (and its beats/findings), withdraws that turn from `scribe_books` via `ScribeLog.withdrawSources()` if already read, restores `campaigns.scene_state_json` from the paired `user` turn's `scene_state_before_json`, and re-runs the turn pipeline cleanly from that `user` turn.
- **Delete last turn pair:** confirmation dialog required. Atomically deletes the trailing `user` + `assistant` pair (guaranteeing no orphan `user` turn), restores `scene_state_before_json`, and calls `ScribeLog.withdrawSources()` if those turns were already read.
- **Edit message:** updates text in place; if already read by Scribe, withdraws that turn's sources and sets `scribe_books.dirty = 1` so clicking **Update Memory** re-reads the affected stretch cleanly.
- **Manual Presence toggle:** clicking any cast member in the Presence bar (`Present` / `Remote` / `Absent`) or adding/removing a walk-on updates `campaigns.scene_state_json` immediately without an LLM call.
- **Operator Rulings & Tell Scribe:**
  - On a Pedant finding: **Rule it** (files an operator Ruling via `ScribeLog.rule` using exact `subject_id`/`fact_id`/`category`), **They were told** (records knowledge grant for `speaker_character_id` on `fact_id`), or **Dismiss**.
  - **Tell Scribe** box: two-step **Work it out** (preview diff) -> **File it** (commit Ruling/fact/thread directly; never sent to chat).
  - **Muse ("Suggest development"):** one click asks `MuseService` for a short `Narrator:` nudge reviving an open thread; **Use** places it in the composer (never auto-sends).

## Cloud Sync (Cloudflare R2)

- Uses `worlds/.env` with its own dedicated R2 bucket (separate from `universe/.env`). When all four R2 variables are blank, runs in **Local only** mode.
- **Foreign-bucket guard:** `WorldSync` runs `hasForeignObjects()` (mirroring `universe/src/sync/CloudStore.mjs`) allowing ONLY `_worlds/`. If `_universe/` or any other top-level object exists, sync turns itself off with a clear error instead of risking Universe's bucket.
- Object layout:
  - `_worlds/v1/control.json` — `{ version: 1, head: "<uuid>", sha256: "<hex>", savedAt: "<iso>" }`
  - `_worlds/v1/snapshots/<uuid>.sqlite` — atomic snapshot via SQLite `VACUUM INTO` (excludes `local/secrets.json`).
- Local sync ledger (`local/sync-state.json`): `{ bucket, lastHead, lastEtag, pendingHead, syncedChangeSeq }`. Detects accidental bucket swaps and resolves timeout-after-server-commit via `pendingHead` without false conflicts.
- **Startup Pull (runs BEFORE opening the runtime SQLite connection):**
  - If R2 is unreachable (15s control timeout), falls back to local DB with **Cloud unreachable: local mode**.
  - If cloud `head` matches `pendingHead`, promotes `pendingHead` to `lastHead` (prior push succeeded).
  - If cloud `head` differs from `lastHead`: when local DB has unsynced writes (`localChangeSeq > syncedChangeSeq`), opens local DB briefly to `VACUUM INTO local/conflicts/<utc-timestamp>/worlds.sqlite` (capturing all WAL transactions) and closes it, then removes `worlds.sqlite-wal`/`worlds.sqlite-shm` and atomically replaces `worlds.sqlite` with the downloaded snapshot (verified by SHA-256).
- **Push (on Save to Cloud button and clean Ctrl+C shutdown, 30s shutdown budget):**
  - Snapshots DB via `VACUUM INTO` temp file, uploads with sized `bodyTimeoutMs` (`120s + bytes / 25 KB/s`), writes `pendingHead` to `sync-state.json`, then updates `control.json` with `If-Match: <lastEtag>` (or `If-None-Match: *` on first push).
  - On `409`/`412`, reports **"The other PC saved newer changes"** and refuses to overwrite until restarted/pulled.
  - Prunes snapshots older than the newest 30 and older than 24h (handling R2 `IsTruncated` pagination and never deleting `control.head`).

## UI layout (Phone-first, Screen Laws)

- **Main view:**
  - Top bar: Campaign selector/setup button, active scene pill (`Location • Day N • Public/Private`), today's UTC spend (`$0.00`, soft warning if over `dailyWarnUsd`), R2 sync status + **Save to Cloud** button, Inspector drawer toggle.
  - Chat stream: paginated (newest 50 turns, **Load earlier** button at top). Assistant turns display woven speaker-tagged beats with CSS-token avatar badge + speaker name + prose; action bar on last turn pair (Regenerate, Edit, Delete with confirm).
  - Composer bar: textarea (Enter sends, Shift+Enter newline; `Narrator:` auto-badged), collapsible **OOC Nudge** input, **Encounter** button, **Send** / **Stop** button, immediate live phase status (`Directing...` -> `Thinking: Lize, Collette...` -> `Composing...`).
- **Inspector drawer** (slide-over on narrow screens, docked right sidebar on wide screens):
  - **Scene & Presence:** editable Location/Time/Public-Private, cast list with 1-click `Present` / `Remote` / `Absent` pills and off-screen note display, active walk-ons list with quick add/remove.
  - **Cast & Tiers:** paginated list (25/page) with quick view/edit (`main` / `recurring`, model override, persona, voice notes, avatar token) + Add Character modal (Save rightmost, Cancel left, required markers).
  - **Memory (Book):** paginated (25/page) searchable subjects, facts with **who knows** badges, relationships, open/closed threads, **Update Memory** button (with `dirty` indicator when needed), **Tell Scribe** box, and **Muse** button.
  - **Findings & Rulings:** paginated (25/page) open Pedant findings with **Rule it** / **They were told** / **Dismiss**, plus paginated active operator Rulings.
  - **Settings:** 5 OpenRouter model slots (`director`, `composer`, `main`, `recurring`, `scribe`), default encounter odds, Scribe interval, Pedant toggle, optional `dailyWarnUsd`, OpenRouter API key entry (`local/secrets.json` vs `.env` status).
- Every server round-trip (turns, regenerate, edit, delete, presence, cast, campaign, memory update, tell scribe, muse, findings, settings, cloud save) shows an immediate loading state; counts shown on screen match DB totals; keyboard focus visible and `prefers-reduced-motion` respected.

## Security

- Server binds strictly to `127.0.0.1` and validates `Host` (`127.0.0.1:<port>` or `localhost:<port>`) on every route (including `GET`).
- Security headers on all responses: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'; form-action 'none'`.
- All mutating endpoints require a valid per-session `X-Worlds-CSRF` header and loopback `Origin`. SSE uses `fetch()` + `ReadableStream` so `POST /turns` carries `X-Worlds-CSRF`.
- Rate limiting on API routes (30 LLM-triggering requests/min; 120 general API requests/min) and 256 KB max JSON request body.
- OpenRouter API key lives only in `.env` or `local/secrets.json` (`0o600`), never in SQLite, R2, logs, or API responses.
- All user input, character metadata, and model outputs are rendered via `textContent` / safe DOM nodes (never raw `innerHTML`).
- `scripts/seed-from-export.mjs` resolves input paths via `fs.realpathSync()` and rejects any path outside `/var/www`.

## Verification strategy (POC)

- Unit and integration tests (`node --test tests/*.test.mjs`) using isolated in-memory / temporary SQLite DBs, scripted fake OpenRouter responses, and in-memory R2 transport with fictional fixtures only:
  - Witness isolation proof (absent Collette's Mind prompt contains zero beats or private facts from Viola's bedroom scene; `internalThought` never leaks to peers).
  - Cut-away scene proof (`*Two hours later, Frost is doing his rounds...*` excludes Frost from `presentIds` and `witness_ids`; `Narrator:` beats are never misattributed to Frost).
  - Mentions-never-summon proof (`"I need to get vegetables to Viola"` keeps Viola absent) and mid-turn arrival isolation (newly arrived encounter character does not see private pre-arrival user text).
  - Encounter odds (`0` disable guard, public/private odds), plausibility gating, forced Encounter button, and `Narrator:` no-encounter rule.
  - Atomic failure/abort handling (failed Mind/Composer or Abort leaves zero orphan `user` turns and unchanged `scene_state_json`, while preserving `spend_log`); per-campaign `409` in-flight mutex.
  - `BeatParser` chunk-split tag buffering, unknown-speaker fallback, and player-beat rejection; Director malformed-JSON retry & loud failure.
  - Regenerate/Delete atomic `scene_state_before` + `ScribeLog.withdrawSources()` rollback; Edit `dirty` flag & repair on **Update Memory**.
  - Surgical Scribe core replay, deterministic synthesized `Scene` ops, seeded `Origin: 'Operator'` facts surviving `ScribeReplay.run()`, Rulings precedence, Pedant catching non-hidden `private` scene leaks, and zero background timers.
  - OpenRouter `RetryPolicy` (`408/429/500/502/503/504`/network; refuses `401/402/403`/partial/mid-stream SSE error/Abort) and `null` cost / `length` truncation handling.
  - R2 sync `hasForeignObjects()` guard, WAL-safe conflict backup (`VACUUM INTO`), `pendingHead` recovery, ETag compare-and-swap, `control.head` prune protection, and local-only/offline fallback.
  - Loopback `Host`/CSRF/CSP/rate-limit enforcement and seed-script symlink escape rejection.
- Real playtest gate before Phase 2: seed the Hero Gone roster into `local/worlds.sqlite` via `scripts/seed-from-export.mjs` and play turns 1–30 through the real UI against OpenRouter.
