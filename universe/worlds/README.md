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
