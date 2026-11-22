# Linux PC handoff

After pulling the repository, copy `.env.example` to `.env` in the Universe directory on the new PC and enter the four R2 values there. With Node.js 22 or newer, run `npm install`. The project pins SillyTavern 1.19.1 in its npm manifest and lockfile. npm installs it under `node_modules/` and uses `local/npm-cache/`.

Run `npm start` from the Universe directory for each session. The launcher reads the project’s optional `.env`, restores the story into `local/data/` when cloud handoff is enabled, and runs SillyTavern in the foreground session. Open `http://127.0.0.1:8000/` and configure the model connection once on that PC.

Live sessions stage story files. Publishing the final revision and releasing the cloud lease currently happen on graceful launcher exit. Automatic 15-minute checkpoints and an in-chat **Save now** action are pending.
