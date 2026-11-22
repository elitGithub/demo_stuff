# Universe local build layout

Universe is one npm project. The operator runs `npm ci`, `npm run build`, `npm test` and `npm start` from `universe/`. The build produces runnable application files and includes the locked SillyTavern 1.19.1 runtime and its dependencies.

## Layout

| Project path | Contents |
| --- | --- |
| `src/` | Universe server, launcher, child process, local saves and R2 integration |
| `src/classes/` | The existing `CloudSave` and `CaptureGate` classes, each in its own module |
| `src/integration/` | Pinned SillyTavern adapter and browser and server bridges |
| `tests/` | Launcher, checkpoint store and chat integration tests and their story fixtures |
| `dist/` | Runnable Universe launcher, integration assets and npm-managed SillyTavern runtime |

## Build and launch

`npm run build` assembles `dist/` from the Universe sources and the versions recorded in the existing npm lockfile. SillyTavern is included at its normal npm dependency path within the build. Its server, frontend assets and dependencies must resolve from the build. The source adapter verifies the pinned upstream files before enabling live captures.

`npm start` launches the built application from the project root. After `npm ci` on a clean checkout it also prepares a missing build. Starting the project continues to use the existing project `.env`, `local/config.yaml`, `local/data/` and recovery journal. The build inputs are application source, package metadata and locked dependency files. Credentials, chats, cards, journals, test profiles and npm caches remain private to the local installation. Generated output lives under the project’s ignored `dist/` directory.

## Verification

Run the relocated tests through `npm test`. Build twice and check that the expected entry point and pinned assets are present. Start the built runtime with an isolated local profile, open the real chat UI and exercise a checkpoint capture. Verify dependency resolution inside `dist/`, the project-relative paths used by regular startup, and exclusion of private data from the build. Preserve the running operator session throughout verification.
