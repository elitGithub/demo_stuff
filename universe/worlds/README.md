# Worlds POC

Local-first multi-character interactive story engine with witness-isolated character minds, speaker-tagged narrative composition, structured Scribe memory, and optional Cloudflare R2 snapshot sync.

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

The replies of every model call are appended to `local/model-replies.log`. Set `WORLDS_LOG_REPLIES=0` in `.env` to turn this off. The file holds story text and is gitignored.

## Models

On first startup with blank model slots, the server seeds non-frontier unrestricted defaults (`src/openrouter/recommended-models.json`):

- `director`: `nousresearch/hermes-4-405b`
- `composer`: `sao10k/l3.1-euryale-70b`
- `main`: `thedrummer/cydonia-24b-v4.1`
- `recurring`: `thedrummer/unslopnemo-12b`
- `scribe`: `cognitivecomputations/dolphin-mistral-24b-venice-edition`

These five IDs are the only model list kept in the repository, and they are used only to seed a new database, to prefill blank slots and for the **Apply suggested defaults** button. Every model picker lists the live OpenRouter catalog and nothing else.

The catalog is loaded in the background when the page opens, so a slow or offline OpenRouter never delays campaigns or chat. It is cached in memory and in `local/openrouter-models-cache.json` (gitignored, not synced) for 4 hours. A server start or page load within those 4 hours reuses the cache and sends nothing to OpenRouter. When a refresh fails the cached catalog is shown with a stale warning.

On every refresh the server checks each listed model against `GET https://openrouter.ai/api/v1/models/<id>/endpoints` and keeps only models that at least one provider serves. The pickers in the **Settings** tab and the character edit modal show all of them, without a cap. A model ID typed into a slot or a character override is checked when you save it, only when the value changed from the stored one, and an ID that is not a well-formed OpenRouter model ID is refused:

- a model no provider serves is refused and nothing in that save is stored;
- a check that cannot run (OpenRouter unreachable) lets the save through with a warning, shown in the Settings tab or in the character window, which then stays open until you close it.

The **Refresh OpenRouter models** button rechecks the whole catalog at any time (`POST /api/models/refresh`). When a saved slot or character override is found unserved, turns and the Update memory, Tell and Muse actions are refused with a message naming the slot or character and the model until you change it.

## Seeding from a Zeta Export

The seeder reads exactly one input: the file written by the Zeta Scribe export (`ScribeStore.exportText()`). It replays the export's `book.log` against `campaign.messages` with Worlds' own `ScribeReplay`, then creates a campaign, its cast and an initial Scribe book of `Origin: 'Operator'` entries at `position: 0` with `cite: null`:

- Cast: every live character subject except the Narrator, keeping Zeta's subject IDs, labels, every alias record and which kinds were only guessed (cut to 60 characters).
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

```bash
node --test tests/*.test.mjs
```

Tests run against isolated in-memory or temporary SQLite databases removed after execution and never touch `local/worlds.sqlite` or external APIs.

## POC Scope and Honest Limits

- Local single-user tool only (loopback HTTP with CSRF and origin checks; no multi-user auth or public hosting).
- Manual campaign and cast setup plus a local CLI seeder for existing Zeta Scribe exports.
- Deferred to Phase 2: AI Plot Generator wizard, AI Character Generator and walk-on promotion wizard, image generation, full-chat Zeta history import, and remote hosting.
- OpenRouter API keys live only in `.env` or `local/secrets.json` and are never stored in SQLite or synced to R2.
