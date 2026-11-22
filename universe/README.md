# Universe

Universe runs SillyTavern on your PC and can share its story data between PCs through Cloudflare R2.

## Set up a Linux PC

Use Node.js 22 or newer and npm. Open the Universe project directory. Create a private `.env` there from `.env.example` and restrict its permissions to your account.

Edit `.env` in that directory. Enter the same `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` on both PCs. For a new cloud story, use a dedicated empty bucket and credentials scoped to it. For a local-only story, leave all four blank.

Install the locked dependencies and start Universe from this directory.

```sh
npm ci
npm start
```

`npm start` prepares a missing build and launches `dist/server.mjs`. Leave the terminal open. SillyTavern builds its frontend on first start. When it reports that it is listening, open [the chat](http://127.0.0.1:8000/) and configure your model connection on this PC. On later runs, use `npm start`.

After updating Universe, run `npm ci` and `npm run build` before starting it again. The build places the launcher, integration assets and SillyTavern 1.19.1 in `dist/`. npm installs SillyTavern and its dependencies under `dist/node_modules/sillytavern/` from the lockfile.

`npm install` and `npm ci` include Tavern Scenario Builder 1.1.0. The build makes it available to every profile. Open **Character Management**, click the **wizard hat** beside Group Chats, and enter your premise under **Scenario**. [Upstream source](https://github.com/Copenblend/tavernScenarioBuilder/tree/e27b831f66240ac0c4c1d9acd7ba8c182d29f70b)

The same commands install Aspect: Vocalia 1.0.4 for every profile. Vocalia manages which members of a group chat are present and who replies. Configure it in **Extensions → Aspect: Vocalia**. [Upstream source](https://github.com/Vectricity/st-aspect-vocalia/tree/a9c596130d4d00b8d157e50e3c0d2c2d65f921e6)

Machine configuration stays in `local/config.yaml`, story data in `local/data/` and the recovery journal in `local/data.universe/`. On upgrade, Universe copies the previous install’s configuration to `local/config.yaml` if that file is missing. Git ignores `dist/`, `node_modules/`, `local/` and `.env`.

The [status endpoint](http://127.0.0.1:8767/status) reports the phase, pending cloud work and the most recent confirmed save in this process. You can change its port with `UNIVERSE_PORT` in `.env`.

## Cloud handoff

Open the [Universe wrapper home page](http://127.0.0.1:8767/) and click **Save now** to run the existing R2 checkpoint immediately. The result appears beside the button. If you set `UNIVERSE_PORT`, use that port in the address.

The launcher checks the complete SillyTavern data directory every 15 minutes while the writer is running. An open chat tab is optional. It lets active turns and pending saves finish, captures the local files and releases editing before it uploads. Unchanged intervals retain the previous revision. The status endpoint reports the latest confirmed revision and any pending checkpoint or error.

The save includes every SillyTavern profile, account record, setting, saved API key, persona, portrait, chat, character, lorebook, gallery and extension file in the data directory, including hidden files and empty directories. Universe maintains its own root identity separately on each PC. Unsupported filesystem items or conflicting Windows filenames produce an error naming the path. Existing story-only R2 revisions remain readable. On your original PC, the first full capture also publishes everything the older format omitted.

To hand off, stop the launcher normally on the first PC and let its final save finish. Start Universe on the second PC with the same R2 bucket and SillyTavern account mode. It restores files, renames, deletions and empty directories before starting SillyTavern. The cloud lease allows one writer at a time. If the launcher reports a recovery error, preserve that PC’s data and journal.

## Recovery

- Keep the effective data root, including its hidden `.universe-story-root` identity file, and its sibling `<data-root>.universe/` together. They contain the story files and the journal needed to recover a failed save. Retry the same configuration before using another machine. If the original data root was moved, return it to its configured path. If a launcher or its child crashed, wait for both processes to exit and for an unreleased cloud lease to expire. The lease lasts five minutes from its last renewal.
- A case-only rename preserves local-only files inside the renamed directory. If both spellings already exist locally, or the filesystem rejects the case-only rename, back up the local root and sidecar before resolving the conflicting paths or restoring to a fresh root on a filesystem that supports the rename.
- If the launcher reports that the cloud advanced beyond a pending local save, preserve the data root and sidecar together. Use a fresh Universe checkout and its empty local/data directory to restore the cloud copy. Reconcile the preserved local story through SillyTavern while that new session is running, then stop it and confirm the save. Keep the original until the reconciled copy is verified.
- For a legacy installation under `sillytavern/` or `runtime-data/`, preserve the original checkout and bucket. Set up a fresh Universe checkout, copy your verified legacy story data into `local/data/` before first start, and configure a new empty bucket. If the legacy bucket has newer files, recover and verify those first. A populated legacy bucket is rejected.

## Verify

Run `npm test` from the Universe directory. The launcher, checkpoint store, chat integration and build tests live in `tests/`. They use isolated local folders, test children and an in-memory cloud transport. The sample character card is at `tests/fixtures/story-tests/mara-vale.json`.

Application modules live in `src/`, the cloud save and capture gate classes in `src/classes/`, and the pinned SillyTavern integration in `src/integration/`.
