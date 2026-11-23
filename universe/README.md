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

After updating Universe, run `npm ci` and `npm run build` before starting it again. The build places the launcher, Universe's reply-retry extension, Tavern Scenario Builder, Aspect: Vocalia and SillyTavern 1.19.1 in `dist/`. npm installs SillyTavern and its dependencies under `dist/node_modules/sillytavern/` from the lockfile.

The reply-retry extension sends a reply request again when it fails completely: no answer at all, a dropped connection, or OpenRouter busy or down. It tries again after 2, 5 and 10 seconds, and before each try a pop-up says **Reply failed (...). Retrying 1 of 3...**, counting up to 3 of 3. If the last try also fails, SillyTavern shows its usual error. A bad key, no credits, a reply that stopped part-way, or a press of **Stop** is never retried. A retried request can be billed twice if OpenRouter had already received it.

`npm install` and `npm ci` include Tavern Scenario Builder 1.1.0. The build makes it available to every profile. Open **Character Management**, click the **wizard hat** beside Group Chats, and enter your premise under **Scenario**. [Upstream source](https://github.com/Copenblend/tavernScenarioBuilder/tree/e27b831f66240ac0c4c1d9acd7ba8c182d29f70b)

The same commands install Aspect: Vocalia 1.0.4 for every profile. Vocalia manages which members of a group chat are present and who replies. Configure it in **Extensions → Aspect: Vocalia**. [Upstream source](https://github.com/Vectricity/st-aspect-vocalia/tree/a9c596130d4d00b8d157e50e3c0d2c2d65f921e6)

Machine configuration stays in `local/config.yaml`, story data in `local/data/`, the sync state in `local/data.universe/` and files moved aside by a pull in `local/conflicts/`. Git ignores `dist/`, `node_modules/`, `local/` and `.env`.

The [status endpoint](http://127.0.0.1:8767/status) reports what Universe is doing, the progress of a transfer, the last save in this run and the latest message. You can change its port with `UNIVERSE_PORT` in `.env`.

## Cloud handoff

Update both PCs to this version before the next handoff. An older Universe cannot read the saves this version makes. The first start after the update reads the existing cloud save, and files already in the cloud are not uploaded again.

While SillyTavern runs, Universe copies the story data to the cloud every 15 minutes, when you click **Save now**, and when you stop Universe. No SillyTavern tab has to be open. The [Universe home page](http://127.0.0.1:8767/) shows a progress bar while files are moving, and beside **Save now** the result of your click, the latest message and the time of the last save. If you set `UNIVERSE_PORT`, use that port in the address.

The save includes every SillyTavern profile, account record, setting, saved API key, persona, portrait, chat, character, lorebook, gallery and extension file in `local/data/`. It leaves out SillyTavern's caches, logs and temporary files, its browser sign-in secret, and the `backups/`, `thumbnails/` and `assets/temp/` folders of each profile. Settings snapshots made with **Make snapshot** live in `backups/`, so they stay on the PC that made them. A file that is still being written waits for the next save. A symbolic link or other special file among the saved files in `local/data/` stops the save with a message naming it. When the cloud holds a newer save at start, such a file also stops the pull, and SillyTavern does not start.

To hand off, stop Universe on the first PC with Ctrl+C and wait for **Saved to cloud at** on its console. Then start Universe on the second PC with the same R2 settings. It pulls the newer files before SillyTavern starts, and the console and the home page show the progress.

After a pull that changed files, reload every SillyTavern tab that was open before. Universe gives SillyTavern a new sign-in secret, so an old tab is signed out and cannot write its old copy of a chat or a setting over the pulled files. The console and the home page say **Reload any open SillyTavern tabs**.

Both PCs may run at the same time, but a save only lands when the cloud has not changed since this PC last pulled or saved. If the other PC saved first, this PC keeps running and keeps its changes, and the home page says **The other PC saved newer changes at** with the time. Automatic saves stop, and **Save now** shows the same message, until you restart Universe on this PC.

When Universe starts and the cloud holds a newer save than this PC last pulled or saved, the cloud wins. Every file this PC changed since then is first moved to `local/conflicts/<date and time>/`, in the same folders as in `local/data/`, and the cloud copy takes its place. The folder name is the time of the pull in UTC, and the home page names it. A file this PC deleted since then comes back with the pull. Files that only this PC has ever had stay where they are and go up with the next save. Nothing this PC changed is deleted, and the conflicts folder is never uploaded. Look through it, copy back what you want to keep, and delete it when you are done.

If the cloud cannot be reached at start, Universe keeps trying for 2 minutes, then starts SillyTavern on the local files with **Cloud unreachable: not pulled** and keeps trying in the background. When it gets through, it saves, or reports that the other PC saved newer changes. A save that cannot reach the cloud keeps trying for 10 minutes, then shows **Not saved since** with the time and the reason, and tries again at the next save. A network failure never stops SillyTavern.

## Recovery

- When Universe stops, the console prints **Saved to cloud at** with the time, or **NOT SAVED TO CLOUD** with the reason. Changes that were not saved stay on this PC and go up the next time Universe starts here. If the other PC saves first, they are moved to `local/conflicts/` at that start instead.
- If a pull stops before it finishes, for example on a disk error, on a symbolic link or other special file among the saved files, or when the cloud is unreachable for 10 minutes in the middle of it, Universe says where it stopped and why, and does not start SillyTavern. Fix the cause and start Universe again. It continues the pull, and nothing is lost or moved twice.
- To use SillyTavern while Universe cannot start, run it on its own on the same files from the Universe directory, and stop it with Ctrl+C:

  ```sh
  HOME="$PWD/local" TMPDIR="$PWD/local" SILLYTAVERN_LISTEN=false SILLYTAVERN_PORT=8000 node dist/node_modules/sillytavern/server.js --dataRoot "$PWD/local/data" --configPath "$PWD/local/config.yaml"
  ```

  Nothing goes to the cloud while it runs. The next Universe start saves the changes, or moves them to `local/conflicts/` if the other PC saved first. After a pull that stopped part-way, start Universe first if you can, so the pull finishes before you play.
- Cloud sync turns itself off, and SillyTavern still starts, when `local/data/` is on a filesystem that ignores letter case, when this PC last synced with a different bucket, when the bucket holds other files but no Universe save, or when the cloud gives an answer at start that trying again cannot fix, for example because an R2 key is wrong. The console and the home page say which. With all four R2 settings blank, Universe runs without cloud saves and says **Cloud save is not configured**.
- Earlier versions kept copies in `local/data.universe/checkpoints/`. This version does not use that folder, and you can delete it.
- The launcher's own console lines are also written to `local/logs/launcher.log`, so after a closed or crashed terminal its last line shows whether the final save happened.

## Limits

- Closing the terminal window also sends SIGHUP to SillyTavern. SillyTavern then ends at once without its clean exit, so a file it is writing in place at that moment can be cut short. Stop Universe with Ctrl+C before closing the window.
- A save leaves out the new version of a file that changed in the last 2 seconds, and of a `.json` or `.jsonl` file, or any file under `local/data/_storage/`, that does not read as complete JSON. A program that pauses for more than 2 seconds in the middle of writing a file can still have that half-written file saved.
- Each file's time limit assumes that file alone moves at 25 KB/s or faster, and up to six files move at once. A connection of at least 150 KB/s keeps every file inside its time limit when six move together. On a slower one, a large file can run out of time on every try, and the save or pull then gives up after 10 minutes in which no file gets through, plus up to two of that file's time limits.
- Universe keeps the newest 100 saves in the cloud. While Universe is running, after a save that uploaded changes, it deletes the older saves and every file that no kept save uses, at most once a day. It never does this after the final save when you stop Universe. Nothing uploaded in the last 24 hours is deleted. If this cleanup fails, the home page says why, the save itself is not affected, and the cleanup runs again after the next save.
- On a network that silently drops packets, a save can run for up to 10 minutes plus two of one request's time limits before it reports that it failed. The 10 minutes start when the first try fails, and that try has already used up one full time limit; the last try can start just before the 10 minutes end and use up another. Each try has its own time limit: 15 seconds for the small requests that read or update the cloud's record of which save is newest, 2 minutes to read or write the list of files in a save, and for each file, 2 minutes plus one second for every 25 KB of its size.

## Verify

Run `npm test` from the Universe directory. The launcher, server, sync and build tests live in `tests/`. They use temporary folders, test children and an in-memory cloud. The sample character card is at `tests/fixtures/story-tests/mara-vale.json`.

Application modules live in `src/` and the cloud sync classes in `src/sync/`.
