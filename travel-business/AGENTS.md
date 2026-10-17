# Elsewhere (travel-business): agent instructions

The primary instructions for every demo in this workspace are in `/var/www/demo_stuff/CLAUDE.md` (its `AGENTS.md` is an identical copy). Read it first; its operator laws and workflow apply here in full.

Demo-specific notes:

- Node.js 24 or newer with the bundled `node:sqlite`; no npm packages, external APIs or paid services, and none may be added.
- `build.mjs` renders `src/` templates into the git-ignored `public/`; run the build after editing templates, styles or browser scripts.
- Run steps, the client walkthrough, configuration and the InfinityFree deployment (static frontend plus the PHP/SQLite API in `deploy/infinityfree/`) are in `README.md`.
