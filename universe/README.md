# Universe

Universe runs SillyTavern on your PC and can share its story data between PCs through Cloudflare R2.

## Set up a Linux PC

Use Node.js 22 or newer and npm. In the Universe directory, pull the repository and create your private `.env` from the example.

```sh
git pull
(umask 077 && cp -n .env.example .env)
```

Edit `.env` in that directory. Enter the same `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` on both PCs. For a new cloud story, use a dedicated empty bucket and credentials scoped to it. For a local-only story, leave all four blank.

Install the dependencies and start Universe.

```sh
npm install
npm start
```

Leave the terminal open. SillyTavern builds its frontend on first start. When it reports that it is listening, open [the chat](http://127.0.0.1:8000/) and configure your model connection on this PC. On later runs, use `npm start`.

npm installs SillyTavern 1.19.1 under `node_modules/`. Its machine configuration stays in `local/config.yaml`, story data in `local/data/` and the recovery journal in `local/data.universe/`. On upgrade, Universe copies the previous install’s configuration to `local/config.yaml` if that file is missing. Git ignores `node_modules/`, `local/` and `.env`.

The [status endpoint](http://127.0.0.1:8767/status) reports the phase, pending cloud work and the most recent confirmed save in this process. You can change its port with `UNIVERSE_PORT` in `.env`.

## Cloud handoff

The other PC restores the most recent published revision. Automatic 15-minute checkpoints and an in-chat **Save now** action are pending. If the launcher reports a recovery error, preserve that PC’s data and journal.

The cloud snapshot includes per-profile chat transcripts, group chat transcripts and group definitions, character cards, and worlds. It copies JSONL chat files, JSON group and world files, and PNG, WebP or JSON character cards. Credentials, machine settings, logs and other directories stay in each machine's data root. An unsupported filename within this story scope blocks the save so the local copy can be corrected.

While SillyTavern runs, the launcher periodically stages story files. Staging alone does not publish a revision. A graceful launcher exit currently publishes the final inventory, including deletions, and releases the cloud lease. The next machine restores that published version before starting SillyTavern.

## Recovery

- Keep the effective data root, including its hidden `.universe-story-root` identity file, and its sibling `<data-root>.universe/` together. They contain the story files and the journal needed to recover a failed save. Retry the same configuration before using another machine. If the original data root was moved, return it to its configured path. If a launcher or its child crashed, wait for both processes to exit and for an unreleased cloud lease to expire. The lease lasts five minutes from its last renewal.
- A case-only rename preserves local-only files inside the renamed directory. If both spellings already exist locally, or the filesystem rejects the case-only rename, back up the local root and sidecar before resolving the conflicting paths or restoring to a fresh root on a filesystem that supports the rename.
- If the launcher reports that the cloud advanced beyond a pending local save, preserve the data root and sidecar together. Use a fresh Universe checkout and its empty local/data directory to restore the cloud copy. Reconcile the preserved local story through SillyTavern while that new session is running, then stop it and confirm the save. Keep the original until the reconciled copy is verified.
- For a legacy installation under `sillytavern/` or `runtime-data/`, preserve the original checkout and bucket. Set up a fresh Universe checkout, copy your verified legacy story data into `local/data/` before first start, and configure a new empty bucket. If the legacy bucket has newer files, recover and verify those first. A populated legacy bucket is rejected.

## Verify

Run `node --test launcher.test.mjs checkpoint-store.test.mjs` from the Universe directory. The suite uses synthetic local folders, a test child and an in-memory cloud transport.
