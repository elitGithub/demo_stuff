# Resto-Chef: agent instructions

The primary instructions for every demo in this workspace are in `/var/www/demo_stuff/CLAUDE.md` (its `AGENTS.md` is an identical copy). Read it first; its operator laws and workflow apply here in full.

Demo-specific notes:

- Plain PHP 8.2+ with PDO and SQLite or MySQL; no Composer or npm dependencies, and none may be added.
- Run steps, the proposal walkthrough, configuration and the InfinityFree packaging are in `README.md` and `deploy/infinityfree/DEPLOY.md`.
- Setup refuses to reseed a database that already contains users; generated credentials live privately in `storage/demo-credentials.json`.
