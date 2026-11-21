# Universe local server scaffold

Universe will run SillyTavern on one PC at a time. Cloudflare will hold the authoritative story save. Opening Universe will restore the latest complete save and reopen the last conversation. Closing its dedicated window will start the final save. A background process must survive the window closing until Cloudflare acknowledges that save or Universe records a pending handoff for recovery.

## Approach

The operator selected a local launcher with a dedicated window. This allows either PC to run the chat while the other is off. A single hosted instance would require an available host. An in-process SillyTavern plugin starts too late to give the launcher control over restoring data before SillyTavern starts.

## First implementation task

Create a standalone Node application under `universe/`. Use Node built-ins and start it with `npm start` from the project directory. Bind to `127.0.0.1` on port `8767`. The root route returns a plain-text status identifying the Universe launcher. Any unknown path returns 404. A port conflict must fail startup visibly.

Reserve `universe/local/SillyTavern/` for an unmodified upstream installation and `universe/local/data/` for its external data root. Resolve these paths relative to the project. Ignore the entire `local/` tree in the project's `.gitignore`. Document the paths in the README. The local data directory and upstream directory may remain absent during this task. The server must start on a clean copy and must never serve files from either path.

The scaffold consists of the Node manifest, server entry point, project `.gitignore`, short README and project instructions pointing to the workspace rules. Verify startup, the root response, a missing path, loopback binding, failure on a busy port, and clean shutdown. All checks run locally.

## Later milestones

Installing a pinned SillyTavern release, launching its dedicated window, tracking the last open conversation and implementing Cloudflare handoff are separate tasks. The initial endpoint reports launcher availability only. Credentials remain on each PC. The future handoff must preserve pending local changes after a crash, publish complete revisions under a single renewable writer lease and prevent an older PC from overwriting a newer cloud save.
