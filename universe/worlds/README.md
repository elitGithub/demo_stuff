# Worlds POC

Local-first multi-character interactive story engine with sequential witness-isolated character brains, an optional Narrator pass, measured prompt budgeting, structured Scribe memory, and optional Cloudflare R2 snapshot sync.

## Requirements

- Node.js 24 (uses built-in `node:sqlite`, `node:http`, `node:crypto`, `node:test`, and native `fetch`).
- Minimal dependencies: `dotenv` for `.env` parsing.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env`:

   ```bash
   cp .env.example .env
   ```

3. Set `OPENROUTER_API_KEY` in `.env` (or configure it later in the Settings UI, which writes `local/secrets.json` with mode `0600` and overrides `.env`).

4. Optional Cloudflare R2 sync for switching between two PCs:
   - Create a dedicated R2 bucket exclusively for Worlds.
   - Never share Universe's SillyTavern R2 bucket. Startup sync refuses any bucket containing objects outside `_worlds/`.
   - Fill all four variables (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`) or leave all four blank for local-only mode.

## Run

```bash
node src/server.mjs
```

The server binds strictly to `127.0.0.1` on `WORLDS_PORT` (default `8768`) and stores local data under `local/worlds.sqlite` (gitignored).

### Schema Upgrades

Versioned schema upgrades are tracked via `PRAGMA user_version` (`src/store/SchemaUpgrades.mjs`). Fresh databases start at the latest schema version. For an existing pre-upgrade database, starting the server upgrades `local/worlds.sqlite` once inside a transaction (adding `characters.card_json` populated from existing `persona` and `voice_notes`, and adding `spend_log.prompt_chars`). Subsequent starts skip already applied steps.

The replies of every model call are appended to `local/model-replies.log`. Set `WORLDS_LOG_REPLIES=0` in `.env` to turn this off. The file holds story text and is gitignored.

## Turn Pipeline and Request Budgeting

Each player turn runs sequentially: `Director -> optional Narrator -> sequential CharacterBrains`.

1. **Encounter roll & Director (`src/engine/Director.mjs`):**
   - Evaluates encounter odds (`EncounterRoller`), then sends the Director request with the campaign premise, scene state, cast roster summaries (220-char `personalitySummary`), open threads, recent turns (`HistoryWindow`, up to 8 turns), and the player's input/OOC nudge.
   - Outputs XML-style tags (`<scene>`, `<situation>`, `<input>`, `<present>`, `<remote>`, `<offscreen>`, `<walkons>`, `<encounter>`, `<pacing>`, `<narrator>`, `<direction>`, `<style>`). Each tag is parsed independently (`TagReader`); broken tags are ignored, and a full miss keeps the previous scene state and falls back to present non-player main and recurring characters replying in roster order.
   - Emits live SSE phases `directing` (`Directing...`) and `director_done` (`Scene planned...`).
2. **Optional Narrator (`src/engine/Narrator.mjs`):**
   - Runs before any character box when the Director outputs a `<narrator>` directive, when any non-player character arrives in the scene, or when pacing is `narrator_only`.
   - Receives non-hidden in-force facts (`StorySlice`, `omniscient: true`), current-scene history (`HistoryWindow`, up to 25 turns), scene style guidance, and the Narrator direction (covering arrivals, walk-ons, encounter brief, and OOC nudge).
   - Streams `<narration>` into its own beat box under SSE phase `narrating` (`Narrating...`).
3. **Sequential Character Brains (`src/engine/CharacterBrain.mjs`):**
   - Runs each queued character one after another under SSE phase `replying` (`{name} is replying...`). Later speakers witness earlier boxes emitted in the same turn; arriving characters start `<this_turn>` at the Narrator box and do not see the player's preceding line.
   - System message carries `<campaign>`, `<identity>`, `<voice_examples>`, and `<rules>`. User message carries `<story_state>` (witness-isolated `ScribeKnowledge.knows` facts), `<history>` (up to 25 witnessed turns for `main`, 12 for `recurring`), `<this_turn>`, `<portrayal>` (`characterNote`), optional `<style>`, and `<direction>`.
   - Brain responses use `<thoughts>`, `<reply>`, and `<next>`:
     - `<reply>` streams live into the box via `ReplyStreamSplitter`. If `<reply>` is missing, text outside `<thoughts>`/`<next>` is used.
     - `<thoughts>` are stored privately on the beat (`mind_packet_json`), never sent to any other character or the Narrator, and shown in the transcript behind a collapsed **Thoughts** toggle on committed character boxes.
     - `<next>` appends an eligible present/remote non-player character to the turn queue if not already queued and under the per-character cap (`maxRepliesPerCharacter`).
   - A failed Narrator or brain call drops only that box and emits a warning while the chain continues; a turn commits as long as at least one box is produced.

### Measured Request Budgets

For each call, `RequestBudget` computes `inputBudget = ModelCatalog.contextLength(model) - replyReserve` (using OpenRouter's cached `context_length`, and passing `max_tokens = replyReserve` to OpenRouter). When a model has no cached context length, requests are still sent bounded by the history window limits without token trimming.

Token counts are estimated as `ceil(chars / charsPerToken)`, where `charsPerToken` is measured from `spend_log.prompt_chars` over `prompt_tokens` (using the lowest observed ratio for that model, falling back to the lowest ratio across all models, then the starting default of `3`).

`StorySlice` fills `<story_state>` in priority order (scene/situation line, viewer facts, present and remote character states, relations, visible open threads, and facts about subjects named in recent text; rulings and operator facts first, then newest) up to the budget. `HistoryWindow` packs whole witnessed turns newest-first and drops the oldest turns first if needed so mandatory parts are never truncated.

## Character Cards, Book Filing, and Player Narration

- **23-field Character Card (`src/store/CharacterCard.mjs`):** Supports Tavern Scenario Builder fields across Basics, Appearance (`age`, `hair`, `eyes`, `height`, `body`, `face`, `features`), Personality (`personalitySummary`, `traits`, `habits`, `behavior`, `likes`, `dislikes`), Intimacy (`sexualityOrientation`, `sexualityKinks`, `sexualityLikes`, `sexualityDislikes`), Voice (`speakingStyle`, `speakingQuirks`, `speechExamples[]`), and Role and portrayal (`scenario`, `characterNote`).
- **Unknown values (`?` -> `unknown`):** Non-empty card text containing no letters or digits (such as `?`, `-`, `...`) normalizes to `?` on save/load and renders as `unknown` inside model requests (`CharacterCard.requestValue`, `StorySlice`); speech examples stay verbatim.
- **Book appearance filing (`src/scribe/CardFiling.mjs`):** Card appearance fields act as starting values filed into the Scribe book only when changed (`age`, `hair`, `eyes`, `height` + `body` combined as `build`, `face` as `appearance`, and `features` as `feature`). Fixed slots are filed as decided operator facts so later edits supersede earlier values; list fields track their filed fact IDs (`filedFactIds`) so only card-owned entries are replaced. Model requests read current appearance from the book, and the character modal shows `In the book now: ...` under any field where the book differs.
- **Player narration facts:** The composer's **Add narration facts** toggle (as well as inline `<narration>...</narration>` tags or `Narrator:` messages) attaches narration to the player's turn. Facts extracted from player turns update fixed and moving book slots directly as player decisions, whereas conflicting model-written fixed values are filed as `Reported` and flagged by the Pedant.

## Settings, Scene Styles, and Models

On first startup with blank model slots, the server seeds non-frontier unrestricted defaults (`src/openrouter/recommended-models.json`):

- `director`: `nousresearch/hermes-4-405b`
- `composer` (**Narrator model**): `sao10k/l3.1-euryale-70b`
- `main`: `thedrummer/cydonia-24b-v4.1`
- `recurring`: `thedrummer/unslopnemo-12b`
- `scribe`: `cognitivecomputations/dolphin-mistral-24b-venice-edition`

These five IDs are the only model list kept in the repository, and they are used only to seed a new database, to prefill blank slots and for the **Apply suggested defaults** button. Every model picker lists the live OpenRouter catalog and nothing else.

Additional configurable settings in the **Settings** tab:

- **Narrator model** (stored under slot key `composer`), **Director model**, **Main character model**, **Recurring character model**, and **Scribe / Pedant / Muse model**.
- **Replies per character per turn** (`maxRepliesPerCharacter`, integer `1` to `5`, default `1`).
- **Reply length cap (tokens)** (`replyReserve`, integer `>= 1`, default `3000`).
- **Default Scribe interval** (`scribeInterval`, default `1` so player-stated changes enter the book after each turn).
- **Scene styles** (`sceneStyles`): editable guidance texts for `Explicit`, `Combat`, `Tension`, `Emotional`, `Banter`, `Travel`, and `Investigation`.

In the **Scene** tab of the Inspector:

- Displays the current **Active style** in force (including `(pinned)` when pinned).
- **Scene style** selector lets you choose `Automatic` (the Director picks `<style>` each turn) or pin one of the 7 styles via `PATCH /api/campaigns/:id`. Any active pin overrides the Director and clears automatically when the scene changes.

The catalog is loaded in the background when the page opens, so a slow or offline OpenRouter never delays campaigns or chat. It is cached in memory and in `local/openrouter-models-cache.json` (gitignored, not synced) for 4 hours. A server start or page load within those 4 hours reuses the cache and sends nothing to OpenRouter. When a refresh fails the cached catalog is shown with a stale warning.

On every refresh the server checks each listed model against `GET https://openrouter.ai/api/v1/models/<id>/endpoints` and keeps only models that at least one provider serves. The pickers in the **Settings** tab and the character edit modal show all of them, without a cap. A model ID typed into a slot or a character override is checked when you save it, only when the value changed from the stored one, and an ID that is not a well-formed OpenRouter model ID is refused:

- a model no provider serves is refused and nothing in that save is stored;
- a check that cannot run (OpenRouter unreachable) lets the save through with a warning, shown in the Settings tab or in the character window, which then stays open until you close it.

The **Refresh OpenRouter models** button rechecks the whole catalog at any time (`POST /api/models/refresh`). When a saved slot or character override is found unserved, turns and the Update memory, Tell and Muse actions are refused with a message naming the slot or character and the model until you change it.

## Seeding from a Zeta Export

The seeder reads exactly one input: the file written by the Zeta Scribe export (`ScribeStore.exportText()`). It replays the export's `book.log` against `campaign.messages` with Worlds' own `ScribeReplay`, then creates a campaign, its cast and an initial Scribe book of `Origin: 'Operator'` entries at `position: 0` with `cite: null`:

- Cast: every live character subject except the Narrator, keeping Zeta's subject IDs, labels, every alias record and which kinds were only guessed (cut to 60 characters), with empty 23-field `CharacterCard` entries (historical attributes live in the seeded book).
- Facts: every live fact plus every `Reported` claim, each keeping its hidden flag, who knows it (the audience Zeta works out from its scenes, told and widened lists), and its attribution and speaker. A hidden fact Zeta widened to everyone is seeded with a widen ruling that applies to that fact only, never to other facts with the same wording. Ended, replaced, expired and removed facts are not seeded.
- Threads: every open thread.
- Opening scene: day, place, time and reach of the last scene (narrowed scenes open as private), with the characters still present at its end.
- Tiers: the player, every `--main` character and the three characters with the most facts are `main`; the rest are `recurring`.

Zeta's fact status is copied, not re-judged: a fact that was `Reported` in Zeta is seeded as `Reported`, and every other seeded fact is in force. An unfinished book (`book.adopted` false) is accepted. The seeder works out how many leading chat messages the Scribe read (`readThrough`), returns it with `chatMessages` in the summary, and prints `Scribe book read through message <n> of <total>.` to stderr when the book stops short of the chat. The campaign has story memory only through that message. The seeder stops with an error naming the fact when a live or `Reported` fact is pinned or disputed, carries a form or dimension, or is a relation with no target subject. It also stops with an error naming both subjects when the replayed book holds an unresolved look-alike pair.

The export is refused unless it is complete: `book.log.read` present, `campaign.completeHistory` true, no `needsHistory`, neither `book` nor `campaign` listed as damaged, and every Story entry's messages present in `campaign.messages`.

1. Place your export file anywhere inside `/var/www` (paths resolving outside `/var/www` via symlinks are rejected).
2. Preview without writing SQLite:

   ```bash
   node scripts/seed-from-export.mjs /var/www/demo_stuff/zeta-dm-memory/scribe/private/hero_gone_latest_updated.json --dry-run --player frost
   ```

3. Seed into `local/worlds.sqlite`:

   ```bash
   node scripts/seed-from-export.mjs /var/www/demo_stuff/zeta-dm-memory/scribe/private/hero_gone_latest_updated.json --player frost
   ```

Optional flags (each may be given once; a value may start with a dash unless it is itself one of these flags):

- `--player <slugNameAliasOrSubjectId>`: the player character, matched by slug, then name, then alias, then Scribe subject ID. The export names no player, so without this flag the campaign has none.
- `--main <slugNameAliasOrSubjectId,...>`: comma-separated characters to promote to `main`, matched like `--player`. A reference that matches nothing, or matches several characters, is an error.
- `--title <name>`: campaign title (default `Seeded Campaign`).
- `--db <sqlitePath>`: target a custom SQLite path instead of `local/worlds.sqlite`.
- `--force`: replace an existing campaign with the same title inside one transaction.
- `--dry-run`: print the summary (`characters`, `subjects`, `facts`, `relations`, `claims`, `threads`, `player`) without opening SQLite.
- Omitting `[exportPath]` defaults to `/var/www/demo_stuff/zeta-dm-memory/scribe/private/hero_gone_latest_updated.json`.

Then start `node src/server.mjs` and open `http://127.0.0.1:8768`.

## Tests

Run test files one at a time under memory and time limits:

```bash
NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 120 node --test tests/ui.test.mjs
```

Tests run against isolated in-memory or temporary SQLite databases removed after execution and never touch `local/worlds.sqlite` or external APIs.

## POC Scope and Honest Limits

- Local single-user tool only (loopback HTTP with CSRF and origin checks; no multi-user auth or public hosting).
- Manual campaign and cast setup plus a local CLI seeder for existing Zeta Scribe exports.
- Deferred to Phase 2: AI Plot Generator wizard, AI Character Generator and walk-on promotion wizard, image generation, full-chat Zeta history import, and remote hosting.
- OpenRouter API keys live only in `.env` or `local/secrets.json` and are never stored in SQLite or synced to R2.
