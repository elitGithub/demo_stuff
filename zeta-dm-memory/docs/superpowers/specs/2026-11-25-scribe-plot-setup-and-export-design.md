# Design: Scribe full plot setup, local setup export, and plot / plot+chat JSON exporter

Date: 2026-11-25 (addendum: 2026-11-26 — room export includes full Zeta chat history in one file). Revised after fresh builder reviews against the live codebase (all blocking and should-fix items resolved). Supersedes [2026-11-19-scribe-story-setup-design.md](2026-11-19-scribe-story-setup-design.md).

Scope: `zeta-dm-memory/` only. `universe/` is untouched.

## Decisions settled with the operator

1. **Scope:** `zeta-dm-memory` only (`universe/` is out of scope).
2. **Storage & export boundary:** Local-only `ScribeStore.Kind.Setup` (not cloud-synced via `ScribeCloud` or `worker.mjs`). Automatically included in full **Export** bundles under top-level `setup`, alongside full untruncated DM Memory notes.
3. **Model context:** Background-only `BACKGROUND` text block prepended once in `ScribeBoot.call` for every text-prompt role; strict-JSON `historicalCheck` stays valid JSON and receives `storySetup` alongside `playerCharacterProfile` as background-only fields.
4. **Plot-page export (`/plots/:plotId/...`):** Plot-only JSON download (`zeta-plot-<slug>.json`, `chat: null`) via a dedicated **Export plot** button on Zeta plot pages using `GET /v1/plots/:plotId` with no room or campaign required.
5. **Chat-panel plot + chat export (`/rooms/:roomId`):** Single **Export plot + chat** button in the chat panel's Progress tab (replacing plot-only export in rooms). Fetches plot + room metadata + persona + DM Memory notes, then fetches fresh full Zeta chat history via `ZetaSource.history`, and downloads one single JSON file (`zeta-plot-chat-<slug>.json`) using the same `zeta-scribe-plot` v1 envelope with `chat: { completeHistory: true, messageCount, messages }` (chronological raw Zeta message objects, ready to seed Worlds). Works identically on adopted and unadopted rooms with zero LLM calls and zero Scribe `book`/`live`/`settings` clutter. Fails loudly (downloads nothing) if history is incomplete (`completeHistory !== true`); empty rooms (`0` messages, `completeHistory: true`) succeed cleanly. Scribe's existing **Export** button stays unchanged for full Scribe backups.

## Verified Zeta traffic (`scribe/private/zeta-ai.io.har`, 2026-11-25)

- **Chat room (`GET /v1/rooms/:roomId`):** returns `id`, `createdAt`, `title`, `introId`, `isIntroFixed`, and `plot`: `id`, `name`, `shortDescription`, `longDescription`, `characters` (`id`, `plotId`, `name`, `description`, `imageUrl`), `chatProfiles` (`id`, `plotId`, `name`, `summary`, `description`, `isUsingDefaultName`), `conversations`, `intros` (`id`, `name`, `description`, `conversation.messages`: `{ type, content, senderType, senderId, speakerName }`), `lorebooks`, `creatorComment`, `hashtags`, `language`, `mode`, `creator`, `infoBoxSetting`, `cyoaSetting`, `isLongDescriptionPublic`, `isExampleConversationPublic`.
- **Plot page (`/en/plots/:plotId/profile` -> `GET /v1/plots/:plotId`):** returns all fields above plus `isAboutPublic`, `about`, and `plugins`. Works on any plot even when no chat room exists. The plot page issues authenticated `api.zeta-ai.io` calls (`/v2/plots/:plotId/likes/summary`, `/v1/creators/:id/follow`, `/v1/rooms/active-room-id?plotId=:plotId`), so `ZetaSource.watch` captures the Bearer token even when landing directly on a plot page.
- **Intro speakers:** In live traffic `speakerName` is `null`; speakers resolve from `senderId`: `'_NARRATOR_'` maps to `'Narrator'`, a character UUID maps to `plot.characters[].name`, and `senderType === 'USER'` maps to `'{{user}}'`. `room.introId` identifies which entry in `plot.intros` the room started from (falling back to `plot.intros[0]`).
- **`{{user}}` placeholder:** Appears verbatim (9 times in the inspected plot) across plot descriptions, characters, chat profiles, and intro messages. Replaced (case-insensitively) with the player's character name when building prompts; left intact in exported JSON so plot generators can template it cleanly.
- **Player profile:** Zeta calls `GET /v1/plots/:plotId/rooms/:roomId/user-personas/selected` (`{ name, profileImageUrl, description }`, 404 when none selected). Zeta does not call `user-plot-chat-profiles/me` on room load and exposes no native in-chat notes endpoint.
- **Lorebooks:** `lorebooks` was empty (`[]`) in both checked rooms/plots, so its entry schema remains unverified. Both normalized `{ name, text }` items and the raw `lorebooks` array are preserved verbatim in storage and export so keys such as triggers/keywords are never lost.
- **Notes:** DM Memory notes live on the operator's Worker (`GET /v1/memory?roomId=...` in `ScribeCloud.js`, up to 65,536 UTF-8 bytes), currently truncated to 4,000 code points (`NotesLongest`) for prompts and never persisted or exported. Scribe's own standing notes are already persisted and exported in `Kind.Live` (`live.notes`).

## Architecture & changes

### 1. Zeta data extraction (`scribe/page/ZetaSource.js`)

- **`ZetaSource.plotPage(pathname)`**: Matches `/^(?:\/[a-z]{2,3}(?:-[a-z0-9]{2,8})?)?\/plots\/([^/]+)/i` and returns the URI-decoded `plotId` (or `null`).
- **`ZetaSource.readyRequest(request)`**: Shared validator checking `request.signal?.throwIfAborted()`, `token` (`NoLogin`), and `pause` (`NoPause`). `ZetaSource.ready(request)` preserves existing error precedence (`signal` -> `token` (`NoLogin`) -> `roomId` (`NoRoom`) -> `pause` (`NoPause`)).
- **`ZetaSource.get(request, path, fresh = false)`**: Passes `{ pause: request.pause, signal: request.signal }` to its 30s `ZetaSource.wait(...)` timeout race so aborting a request immediately clears the timeout timer.
- **`ZetaSource.parsePlot(rawPlot, fallbackPlotId = null, introId = null)`**: Shared normalizer for both `GET /v1/rooms/:roomId` and `GET /v1/plots/:plotId`. Accepts finite numeric `rawPlot.id` (matching `ZetaSource.plotOf`) as well as non-empty strings. Throws `NoPlot` if `rawPlot` is not an object or no `plotId` can be resolved. Returns a frozen normalized object:
  - `plotId`: non-empty string (`rawPlot.id` or `fallbackPlotId`).
  - `name`, `summary` (`shortDescription`), `description` (`longDescription`), `about`, `creatorComment`: trimmed strings (`''` when absent or non-string).
  - `language`, `mode`: trimmed non-empty strings or `null`.
  - `hashtags`: frozen array of trimmed non-empty strings from `rawPlot.hashtags`.
  - `characters`: frozen array of `{ id: string|null, name: string, description: string }` from `rawPlot.characters` (missing or non-list -> `[]`, no longer a shape error; skips non-object items or items whose trimmed `name` is empty; preserves `name`/`description` for `ScribeReminder.writer`).
  - `chatProfiles`: frozen array of `{ id: string|null, name: string, summary: string, description: string }` from `rawPlot.chatProfiles` (non-list -> `[]`; keeps objects with at least one non-empty trimmed `name`, `summary`, or `description`).
  - `opening`: frozen array of `{ speaker: string, text: string }` from the intro in `rawPlot.intros` matching `introId` (falling back to `intros[0]`):
    - `text`: trimmed string from `content` (when string) or `content.text` (when string); messages without non-empty text are skipped.
    - `speaker`: trimmed `speakerName` if non-empty; else `'Narrator'` if `senderId === '_NARRATOR_'`; else matching `characters` entry's `name` when `senderId` matches `character.id`; else `'{{user}}'` if `senderType === 'USER'`; else `''`.
  - `lore`: frozen array of `{ name: string, text: string }` from `rawPlot.lorebooks`:
    - `text`: first trimmed non-empty string among `content`, `description`, `text`, `value`; entries without text are skipped.
    - `name`: first trimmed non-empty string among `name`, `title`, `key`, or `keys.filter(string).join(', ')`; `''` if none.
  - `raw`: JSON-safe deep clone of the plot's lossless fields (`characters`, `chatProfiles`, `intros`, `lorebooks`, `conversations`, `plugins`, `infoBoxSetting`, `cyoaSetting`, `creator`, `isLongDescriptionPublic`, `isExampleConversationPublic`, `isAboutPublic`).
- **`ZetaSource.story(request)`**: Still one `GET /v1/rooms/:roomId` request. Resolves `plotId = ZetaSource.plotOf(room.body)`. If `plotId === null`, throws `NoPlot`. If `!ZetaSource.isObject(room.body?.plot)`, throws `Object.assign(ZetaSource.failure(words.NoPlot, room.status, false), { plotId })` (preserving `error.plotId` so `ScribeLive.cast` can still read `user-personas/selected`). Otherwise calls `parsePlot(room.body.plot, plotId, room.body.introId ?? null)` and returns `{ ...parsed, roomTitle, introId, createdAt }`.
- **`ZetaSource.plot(request)`**: Takes `{ fetch, token, plotId, introId = null, pause, signal? }`. Calls `ZetaSource.readyRequest(request)` and validates `filled(plotId)` (else `NoPlot`). Calls `GET /v1/plots/:plotId` with `retried`. Validates `isObject(read.body)` (else `Shape`). Returns `parsePlot(read.body, request.plotId, request.introId ?? null)`.
- **`ZetaSource.profile(request, plotId = null)`**: Continues calling `GET /v1/plots/:plotId/rooms/:roomId/user-personas/selected` (404 -> `null`, no notice; invalid shape -> `NoPersona`; 5xx -> throws). Returns frozen `{ source: 'Persona', name: string|null, description: string, text: string } | null`:
  - Empty/null `description` -> `null`.
  - `name` = trimmed string or `null`.
  - `description` = full uncapped trimmed description (lossless for export).
  - `text` = `name ? "${name}: ${description}" : description`, capped at `LongestProfile` (2,000 code points) for prompts.

### 2. Setup prompt builder & plot export formatter (`scribe/page/ScribeSetup.js`, new)

Placed in `scribe/pack.mjs` directly before `scribe/page/ScribeLive.js`.

- **`ScribeSetup.build(story, profile, player = '')`**:
  - Resolves player replacement name: trimmed `player` when non-empty AND not equal (case-insensitive) to `ScribeIntake.Settings.UnknownPlayer` (`'unknown'`), else trimmed `profile?.name` when non-empty, else `null` (leave `{{user}}` untouched). Replaces `/\{\{user\}\}/gi` using a replacer function `() => resolvedPlayer` so `$` sequences (`$$`, `$&`) in names are never interpreted.
  - Collapses internal line breaks to single spaces in `name`, `summary`, character `name` and `description`, opening `speaker` and `text`, and lore `name` and `text`.
  - Builds the story body in fixed order (omitting empty sections):
    1. `<name>: <summary>` (or whichever is non-empty)
    2. `<description>`
    3. `About:\n<about>`
    4. `Story characters:\n- <name>: <description>` (or `- <name>` if description empty)
    5. `Opening:\n<speaker>: <text>` (or `<text>` if speaker empty)
    6. `Lore:\n- <name>: <text>` (or `- <text>` if name empty)
  - Caps the story body (headings outside the cap) at `6,000` code points (`Array.from`), cutting at the last `\n` before the cap (stripping trailing `\r`) or at the exact 6,000-code-point boundary when no newline exists. Tracks `whole` (uncut code-point count) and `shown` (kept code-point count).
  - Profile body is `profile?.text` (already capped at 2,000 code points).
  - Builds combined `text` (or `null` when both `storyText` and `profileText` are null):
    ```text
    BACKGROUND (never a source on its own: no fact, subject, thread or NOW line comes from it alone; the messages and the book are what happened, and where they differ from it they are right):

    STORY SETUP (the writer's starting point; the story has moved on since):
    <storyText>

    PLAYER CHARACTER PROFILE (the player's own description of their character; trust it for that character):
    <profileText>
    ```
    Empty sub-blocks are omitted.
  - Returns frozen `{ text, storyText, profileText, shown, whole, source: profile?.source ?? null, persona: profile?.name ?? null }`.
- **`ScribeSetup.exportBundle({ plot, roomId = null, roomTitle = null, introId = null, profile = null, notes = null, chat = null, exportedAt })`**:
  - Produces a clean standalone JSON object:
    - Top-level: `format: 'zeta-scribe-plot'`, `version: 1`, `exportedAt`, `plotId`, `roomId`, `roomTitle`, `introId`, `plot`, `profile`, `notes`, `chat`.
    - `plot`: normalized fields mapped from `parsePlot` (`id: plot.plotId`, `name`, `shortDescription: plot.summary`, `longDescription: plot.description`, `about`, `creatorComment`, `language`, `mode`, `hashtags`, `characters`, `chatProfiles`, `opening`, `lore`) plus `raw` (lossless `characters`, `chatProfiles`, `intros`, `lorebooks`, `conversations`, `plugins`, `infoBoxSetting`, `cyoaSetting`, `creator`, `isLongDescriptionPublic`, `isExampleConversationPublic`, `isAboutPublic`).
    - `profile`: `null` or deep-cloned lossless `{ source, name, description }` (omitting the 2,000-code-point prompt-capped `text`).
    - `chat`: `null` on plot-page exports; when provided (room exports), validates `chat` is a non-array plain object with `chat.completeHistory === true` and `Array.isArray(chat.messages)` (throwing `IncompleteChat` otherwise) and emits `{ completeHistory: true, messageCount: chat.messages.length, messages }` with a JSON-safe deep clone of chronological raw Zeta message objects (matching the element schema Worlds' `seed-from-export.mjs` parses; note Worlds will later need a reader for the `zeta-scribe-plot` envelope since today's `seed-from-export.mjs` reads full Scribe backups).
    - Contains zero Book entries, zero live state, zero settings, and zero credentials/keys (`chat` is `null` on plot-page exports).
- **`ScribeSetup.filename(name, plotId, withChat = false)`**: Returns `zeta-plot-<safe-slug>.json` (or `zeta-plot-chat-<safe-slug>.json` when `withChat` is true) — ASCII alphanumeric + `-`, lowercased, consecutive `-` collapsed, leading/trailing `-` trimmed, max 60 chars with trailing `-` re-trimmed after slicing, falling back to sanitized `plotId`, then `'plot'` so `zeta-plot-.json` / `zeta-plot-chat-.json` / trailing-hyphen slugs are never emitted.

### 3. Local persistence & full DM Memory notes (`ScribeStore.js`, `ScribeCloud.js`, `ScribeLive.js`)

- **`ScribeStore.Kind.Setup = 'setup'`**:
  - Local-only store kind. `ScribeCloud.Settings.Synced` stays `[Settings, Book, Live]`; `worker.mjs` is untouched.
  - `ScribeStore.exportText`, `rooms`, `drop`, `sweep`, `describe`, and `checkKind` already iterate `Object.values(ScribeStore.Kind)` dynamically, so **Export** automatically emits top-level `setup` and `ScribeStore.drop(storage, roomId)` cleans it up.
  - Persisted shape: `{ plotId, roomTitle, introId, story, profile, notes, fetchedAt }`.
- **`ScribeCloud.js`**:
  - Keeps `cloud.rawNotes` (full untruncated non-empty string from `/v1/memory`, or `null`) alongside `cloud.notes` (the 4,000-code-point prompt slice). Resets `cloud.rawNotes = null` in `ScribeCloud.restart`.
  - Exposes `rawNotes: () => ScribeCloud.rawNotes(cloud)` and `notesChecked: () => cloud.checkedNotes` on the cloud handle so exports get full untruncated DM Memory notes while model prompts stay capped at 4,000 code points.
- **`ScribeLive.js`**:
  - Accepts optional `rawNotes?: () => { checked: boolean, text: string|null }` in `ScribeLive.open` (defaults to `() => ({ checked: false, text: null })`).
  - **Unadopted room invariant preserved (`tests/scribe-whole.test.mjs:887-912`):** `ScribeLive.open` starts `ScribeLive.cast(live)` eagerly ONLY when `keeper.view().booked === true`. On an unadopted room, opening, timers, and reopening fire zero Zeta requests and write zero `Kind.Setup` storage. When `booked` transitions to `true` (checked in `ScribeBoot`'s keeper `notify` callback) or when `ScribeBoot.look` observes a token with `booked === true`, `handle.ensureCast()` triggers `ScribeLive.cast(live)` if `live.cast === null && live.casting === null`.
  - When `ScribeLive.cast(live)` settles (whether fulfilled or failed, except `NoLogin` / closed), it calls `live.notify()` so `ScribePanel` redraws Settings immediately.
  - **Merge-safe persistence:** On any fulfilled read (`story` or `profile`) while `keeper.view().booked === true`, `ScribeLive` reads existing `Kind.Setup` (catching `{ damaged: true }` and treating damaged prior data as `{}`), merges only newly fulfilled fields (`story`/`plotId`/`roomTitle`/`introId` when `story` fulfilled; `profile` when `profile` fulfilled; `notes` when `rawNotes().checked === true`, otherwise keeping prior `notes`), and writes `Kind.Setup` (best-effort; storage failures are caught and do not break live processing).
  - When `story` fails and `plotId === null`, `profile` is skipped and recorded as `profileFailed: true` (not `none set`, not stuck on `Reading...`, and without appending a spurious `ProfileUnread` error to `cast.notice`).
  - `handle.setup()`: `Promise<Readonly<{ text: string|null, storyText: string|null, profileText: string|null, shown: number, whole: number, source: string|null, persona: string|null }>>` — awaits `ScribeLive.cast(live)` and calls `ScribeSetup.build(cast.story, cast.profile, keeper.view().player)`.
  - `handle.setupRecord()`: returns `{ story, profile, notes }` from live memory (`live.cast`), falling back to persisted `Kind.Setup` (catching `{ damaged: true }`) only for fields not yet read live (`storyRead` / `profileRead`), so a confirmed 404 (`profileRead: true, profile: null`) never resurrects a stale saved persona.
  - `handle.ensureCast()`: triggers `ScribeLive.cast(live)` when `booked && live.cast === null && live.casting === null` (called on token arrival and adoption).
  - `ScribeLive.view(live)` exposes `setup: { read: boolean, reading: boolean, storyRead: boolean, storyFailed: boolean, shown: number, whole: number, profileRead: boolean, profileFailed: boolean, source: string|null, persona: string|null }` (with `reading: live.casting !== null` so unadopted rooms do not falsely spin).
  - Both `ScribeLive.remind` and `ScribeLive.generateReminder` read `cast.story?.characters ?? null` (unchanged `ScribeReminder.writer` behavior).
  - `Messages.StoryUnread` becomes `'The story setup could not be read: '`.

### 4. Model call wiring (`ScribeBoot.js`, `ScribeKeeper.js`, `ScribeAnalyzer.js`, `ScribeScene.js`, `ScribePedant.js`, `ScribeAdoption.js`)

- **`ScribeBoot.call`** (all text-prompt roles: `!historicalCheck`):
  - When `typeof session.live?.setup === 'function'`, registers a cancellable pre-dispatch trial in `session.running` BEFORE awaiting `session.live.setup()` (so `calls.due()` is `true` and Pause / Force stop immediately interrupt a stalled `setup()` wait via `halted`, never blocking for 30s x 3 retries; the underlying shared `live.cast` is not broken for later callers). Any `setup()` error is redacted via `ScribeStore.diagnostic` and tagged `stopped = 0`.
  - After `setup` resolves, re-checks `ScribeBoot.currentRoom(session)`, `session.pauseEpoch !== epoch`, and `current?.stop?.reason === ScribeAdoption.Stop.Paused` (a session closed or paused during the wait sends nothing and is not billed), then reads `session.cloud.notes()`.
  - Assembles `told`:
    - Prepends `setup.text + '\n\n'` when `setup?.text` is non-empty.
    - Appends `settings.NotesOpen + notes` when `noted` is true (as today).
  - Covers every text-prompt role on the page from one place: Reading (story, Notes, and Answers passes), Scene, Live Pedant, Tell, Muse suggestion, and Reminder.
  - The offline bench (`BenchPage.js`) calls `ScribeGateway` directly and gets no block.
- **Strict-JSON historical checker (`historicalCheck = role === Pedant && helper === 'keeper'`)**:
  - `ScribeBoot.call` does NOT prepend plain-text `setup.text` or append plain-text `OPERATOR NOTES:` to `historicalCheck`, preserving strict JSON input.
  - `ScribeKeeper` replaces `options.profile` / `BadProfile` with `options.setup` / `BadSetup` (`() => Promise<{ storyText: string|null, profileText: string|null } | null>`), wired by `ScribeBoot` to `session.live.setup()`.
  - `ScribeKeeper.adopt` removes its `keeper.profile()` read and `profile` argument to `ScribeAdoption.run` (reading passes now get the block from `ScribeBoot.call`).
  - Before dispatching a historical check page (`ScribeKeeper.js`), awaits `keeper.setup()`, re-verifies `current()`, and invokes `ScribePedant`'s `inputWithSetup(setup)` callback, which injects `storySetup` (when `setup?.storyText` is non-empty) and `playerCharacterProfile` (when `setup?.profileText` is non-empty) into the JSON object while keeping `inputStamp` computed on the base `input`.
  - `ScribePedant.CheckPrompt` updates its profile line to document both `storySetup` (explicitly background-only; Book claims still verify strictly against cited messages) and `playerCharacterProfile`.
- **Removed duplicate per-role profile plumbing:**
  - `ScribeAnalyzer.input` (`profile` arg, `Headings.Profile`, prompt sentence).
  - `ScribeScene.input` / `ScribeScene.now` (`profile` arg, `Headings.Profile`, prompt sentence).
  - `ScribePedant.input` / `ScribePedant.review` (`profile` arg, `Headings.Profile`, prompt sentence).
  - `ScribeAdoption` (`options.profile`, `Settings.Arguments.Profile`).
  - `ScribeLive` handle's old `profile()` method and its separate `profile` reads before Scene/Pedant calls.

### 5. Plot-page export widget (`scribe/page/ScribePlotExport.js`, new) & Chat Panel (`ScribePanel.js`, `PanelStyle.js`, `ScribeBoot.js`)

- **Shared boot-level network helpers & routing in `ScribeBoot.js`**:
  - Extract boot-level `ScribeBoot.pageFetch(boot)` (Xray-safe wrapper around `boot.pageFetch` + `environment.clone` / `environment.pageWindow`, usable without a room `session`) and `ScribeBoot.delay(boot, ms, signal)` (timer-backed abortable pause tracked on `boot.plotTimers` so `closePlot()` / `stop()` clear pending timers; named `delay` to avoid colliding with existing lock-contention `ScribeBoot.wait(session)`). Room-session pauses stay on `ScribeBoot.pause(session, ms, signal)`.
  - In `ScribeBoot.follow(boot)`: compute `roomId = ZetaSource.room(pathname)` and `plotId = roomId === null ? ZetaSource.plotPage(pathname) : null`. Reconcile `boot.session` against `roomId` and `boot.plotSession` against `plotId` independently (fixing the current `null === null` early return). Guard mounting `boot.plotSession` with `environment.document.body !== null` (retrying on `DOMContentLoaded` / `boot.plotRetry` under `@run-at document-start`, with both the listener and timer cleaned up on `closePlot()` / `stop()`).
  - Tear down `boot.plotSession` on room navigation, non-plot navigation, `pagehide`, and `stop()`.
  - Update `ScribeBoot.shield` to also allow events originating inside `boot.plotSession?.host`.
  - Trigger `session.live?.ensureCast()` in `keeper`'s `notify` callback when `keeper.view().booked` is true AND in `ScribeBoot.look(session)` whenever `ScribeBoot.token(boot)` is non-null and `booked` is true (so both token-before-adopt and token-after-adopt work without network side effects inside `ScribeBoot.token()`).
- **Plot-page widget (`scribe/page/ScribePlotExport.js`)**:
  - Placed in `scribe/pack.mjs` before `scribe/page/ScribeBoot.js`.
  - `ScribePlotExport.mount({ document, AbortController, plotId, fetchPlot, download, clock })` -> `Readonly<{ host: Element, unmount: () => void }>`.
  - Uses `AbortController` passed from `environment.pageWindow.AbortController` (never bare global `AbortController`).
  - Mounts an isolated Shadow DOM host (`id = 'scribe-plot-host'`) reusing `PanelStyle` CSS tokens (light/dark, phone-first, visible keyboard focus, reduced-motion respected, zero inline `style` attributes, zero raw colors).
  - Positioned bottom-right with safe viewport margins (`max-width: calc(100vw - 1.5rem)`), containing an **Export plot** button and an adjacent live status line (`aria-live="polite"`).
  - On click:
    - Ignores clicks while busy.
    - Immediately shows loading state (`Exporting plot...`, button disabled).
    - Calls `fetchPlot(signal)` (wired by `ScribeBoot` to `ZetaSource.plot({ fetch, token: ScribeBoot.token(boot), plotId, pause: (ms) => ScribeBoot.delay(boot, ms, signal), signal })`).
    - Builds JSON via `ScribeSetup.exportBundle({ plot, exportedAt: new Date(clock.now()).toISOString() })` and downloads via `download(ScribeSetup.filename(plot.name, plot.plotId), JSON.stringify(bundle, null, 2))`.
    - Reports immediate outcome beside the button (e.g. `Exported zeta-plot-harbour-lights.json (3 characters, 2 lore entries).`) or error reason (including `NoLogin` guidance).
    - `unmount()` aborts any active `AbortController` and removes the host cleanly.
- **Chat panel updates (`scribe/page/ScribePanel.js`)**:
  - `ScribePanel.mount` accepts optional `exportPlot?: (signal: AbortSignal | null, onProgress?: (count: number) => void) => Promise<{ plot: object, roomId: string, roomTitle: string|null, introId: string|null, profile: object|null, notes: string|null, chat: { completeHistory: true, messages: object[] } | null }>` and `AbortController?: Function | null` (optional for test harnesses; when `exportPlot` is omitted, the **Export plot + chat** button renders disabled and clicking is a no-op; when `AbortController` is omitted, `controller` is `null` and `signal` is `null`).
  - **Progress tab (`Builders.Progress`)**: keeps existing **Export** button (`Words.Export = 'Export'`) unchanged, adds **Export plot + chat** (`Ids.ExportPlot`, `Words.ExportPlot = 'Export plot + chat'`, `Guard.Free`) right beside it (before destructive **Start the book over**), and adds a dedicated polite status outlet (`Outlets.PlotExport`, `Ids.PlotExportOutcome = 'scribe-plot-export-outcome'`) so concurrent `Pull`/`Adopt`/`CheckHistory` completions on `Outlets.Controls` never wipe live export progress or confirmation.
    - Uses its own `panel.exportingPlot` busy flag (independent of `book: true` commands like `Pull`/`Adopt`), disables the button while running, shows `Exporting plot + chat...` in `Outlets.PlotExport` (updating live to `Exporting plot + chat (62 messages)...` as history pages arrive), aborts `panel.plotExportController` on `unmount()`, and suppresses all download/DOM updates whenever `!panel.mounted` (covering both `AbortError` and `Messages.Left` on room leave).
    - Wired by `ScribeBoot.exportPlot(session, signal, onProgress)` (using `pause = (ms) => ScribeBoot.pause(session, ms, signal)` and checking `signal?.throwIfAborted()` + `ScribeBoot.currentRoom(session)` on entry, after every `await`, and inside the `/v1/plots/:plotId` `catch`) to:
      1) Read `record = session.live?.setupRecord?.() ?? { story: null, profile: null, notes: null }`. If `record.story === null`, fetch `ZetaSource.story` on demand with `signal` (so unadopted rooms work on explicit click). Fetch `ZetaSource.profile` on demand with `signal` when `record.story === null` OR (`record.profile === null && !session.live?.view?.().setup?.profileRead`).
      2) When `plotId` is known, try `ZetaSource.plot({ fetch, token, plotId, introId, pause, signal })` (preserving the room's `introId` for `plot.opening`), falling back to the room's `story` on non-abort, still-in-room errors (re-throwing abort or room-leave `Messages.Left`).
      3) Fetch fresh full Zeta chat history via `ZetaSource.history({ fetch, token, roomId: session.roomId, pause, signal, onPage: onProgress })`. Require `history.completeHistory === true`; if incomplete (mid-pagination failure, `skipped > 0`, `RepeatedCursor`, `NothingNew`, `Limit`, or `problem !== null`), throw a descriptive error so nothing is downloaded. Empty rooms (`0` messages, `completeHistory: true`) succeed with `messages: []`.
      4) Attach `roomId`, `roomTitle`, `introId`, `profile`, `notes: session.cloud?.notesChecked?.() ? session.cloud.rawNotes() : (record.notes ?? null)` (so cleared Worker notes never resurrect stale storage), and `chat: { completeHistory: true, messages: history.messages }`.
    - Downloads `ScribeSetup.filename(plot.name, plot.plotId, true)` (`zeta-plot-chat-<slug>.json`) and prints the outcome in `Outlets.PlotExport` (e.g. `Exported zeta-plot-chat-harbour-lights.json (3 characters, 2 lore entries, 48 messages).`).
  - **Existing `exportChat` (`Export` button):** Before calling `ScribeStore.exportText`, if `cloud?.notesChecked?.()` is true, best-effort reads `Kind.Setup` (catching `{ damaged: true }` and any storage error); if an existing valid `setup` object is present and its `notes` differs from `cloud.rawNotes()`, writes the updated `notes` so the full chat export carries the latest untruncated DM Memory notes without crashing on damaged rooms or creating `Kind.Setup` for unadopted rooms.
  - **Settings tab (`Drawers.Settings`)**: adds two status paragraphs (`panel.parts.SetupState`, `panel.parts.ProfileState` with `Ids.SetupState`, `Ids.ProfileState`) before `KeyState`, normalizing `setup = heard.setup ?? null` in `ScribePanel.redraw`:
    - `SetupState` (hidden when `setup === null` or unadopted & unread):
      - `setup.reading`: `Reading the story setup...`
      - `setup.storyFailed`: `Story setup: could not be read.`
      - `setup.storyRead && setup.shown === 0`: `Story setup: none on this story.`
      - `setup.storyRead && setup.whole > setup.shown`: `Story setup: 2,140 characters go with every call (cut from 7,310).` (singular `1 character goes` when `shown === 1`).
      - `setup.storyRead`: `Story setup: 2,140 characters go with every call.` (singular `1 character goes` when `shown === 1`).
    - `ProfileState` (hidden when `setup === null` or unadopted & unread):
      - `setup.reading`: `Reading the profile...`
      - `setup.profileFailed`: `Profile: could not be read.`
      - `setup.profileRead && setup.persona`: `Profile: your persona <PanelView.said(setup.persona)>.`
      - `setup.profileRead && setup.source !== null`: `Profile: set for this chat.`
      - `setup.profileRead`: `Profile: none set for this chat.`

## Cost impact

At most ~8,000 characters (~2,000 input tokens) per model call (6,000 story setup + 2,000 persona; persona is already sent on reading/scene/checker today, so incremental cost is at most ~1,500 input tokens for the story setup). Both plot-page **Export plot** (one Zeta `GET /v1/plots/:plotId`) and chat-panel **Export plot + chat** (plot/room read + paginated Zeta message history) make zero LLM calls.

## Files

- New: `scribe/page/ScribeSetup.js`, `scribe/page/ScribePlotExport.js`, `tests/scribe-setup.test.mjs`, `tests/scribe-plot-export.test.mjs`.
- Modified: `scribe/page/ZetaSource.js`, `scribe/page/ScribeStore.js`, `scribe/page/ScribeCloud.js`, `scribe/page/ScribeLive.js`, `scribe/page/ScribeKeeper.js`, `scribe/page/ScribeBoot.js`, `scribe/page/ScribePanel.js`, `scribe/page/PanelStyle.js`, `scribe/page/ScribeScene.js`, `scribe/page/ScribePedant.js`, `scribe/core/ScribeAnalyzer.js`, `scribe/core/ScribeAdoption.js`, `scribe/pack.mjs` (30 files), `scribe/scribe.user.js` (rebuilt).
- Test support & suites: `tests/support/FakeZeta.mjs`, `tests/support/PanelHarness.mjs`, `tests/support/WholeSite.mjs`, `tests/support/WholePanel.mjs`, `tests/support/WholeTab.mjs`, and affected `tests/scribe-*.test.mjs` suites.

## Tests that try to break it

- **`ZetaSource`:** HAR-shaped room body extracts every field; `room.introId` selects the matching intro over `intros[0]`; intro `speakerName: null` resolves `'_NARRATOR_'` -> `Narrator`, character `senderId` -> character name, `senderType: 'USER'` -> `'{{user}}'`; finite numeric `plot.id`; missing `characters` gives `[]`; non-object `plot` with top-level `plotId` preserves `error.plotId`; `lorebooks` entries with `content`/`description`/`text`/`value` and `name`/`title`/`key`/`keys`, plus raw `lorebooks` preserved verbatim; `ZetaSource.plotPage` parses `/plots/:id/profile`, `/en/plots/:id/profile?fromRoom=true`, ignores `/rooms/:id`; `ZetaSource.plot` fetches `/v1/plots/:id` with optional `introId`, extracts `about` and `plugins`, honors `AbortSignal`, handles 404/500/bad shape; `ZetaSource.profile` returns `{ source, name, description, text }` with uncapped `description` and 2,000-code-point capped `text`, 404 -> `null`, empty description -> `null`, empty name -> description only, 500 -> throws.
- **`ScribeSetup`:** section ordering; empty sections omitted; 6,000-code-point cap cut at newline and without newline; surrogate pairs across cap; headings outside cap; `{{user}}` and `{{USER}}` substitution skips `'unknown'`, falls back to `profile.name`, handles `$&`/`$$` literally, and leaves raw export untouched; line breaks collapsed in names/headings/descriptions/opening/lore; `exportBundle` has zero book/live/settings/keys, preserves lossless `plot.raw`, emits `chat: null` when omitted, emits `{ completeHistory: true, messageCount, messages }` (deep-cloned) when valid `chat` is supplied, and throws `IncompleteChat` when `chat.completeHistory !== true` or `chat.messages` is not an array; `filename` strips unsafe chars, collapses hyphens, falls back to `plotId`, then `'plot'`, and switches prefix between `zeta-plot-` and `zeta-plot-chat-`.
- **`ScribeStore` & `ScribeCloud`:** `Kind.Setup` round-trips, appears in `exportText`, is removed by `ScribeStore.drop`, and is NOT in `ScribeCloud.Settings.Synced`; `ScribeCloud.rawNotes()` returns full text > 4,000 chars while `notes()` stays capped at 4,000 and `restart` resets `rawNotes` to `null`.
- **`ScribeLive`, `ScribeKeeper` & `ScribeBoot`:** unadopted room sends zero Zeta requests and writes zero `Kind.Setup` on open/timers/reopen; adopted room starts `cast` on open, calls `notify()` on settle, retries `NoLogin` when token arrives, and merge-persists `Kind.Setup` without wiping `notes` or prior `story`; failed `story` with `plotId === null` marks `profileFailed: true`; every text-prompt role receives `BACKGROUND` once before its content and `OPERATOR NOTES:` after; `historicalCheck` receives valid JSON with `storySetup` + `playerCharacterProfile` and no plain-text wrapper; Pause / Force stop aborts a stalled `setup()` wait immediately and charges nothing; navigating `/` <-> `/plots/:id/profile` <-> `/plots/:other/profile` <-> `/rooms/:id` mounts/unmounts `plotSession` cleanly (including `@run-at document-start` before `document.body` exists), uses `pageWindow.AbortController`, and shields plot-export keyboard events.
- **`ScribePlotExport` & `ScribePanel`:** plot-page button shows loading state, ignores double-click while busy, downloads formatted JSON (`zeta-plot-<slug>.json`, `chat: null`), displays error on failure, aborts on unmount; chat-page **Export plot + chat** (Progress tab, `Guard.Free`) works independently of book locks, passes `room.introId` to `ZetaSource.plot`, falls back to cached room plot on `/v1/plots/:id` failure, paginates fresh full history via `ZetaSource.history` with live message count progress, downloads `zeta-plot-chat-<slug>.json` with persona, full DM Memory notes, and chronological `chat.messages` (and handles empty rooms cleanly), fails loudly downloading nothing on incomplete history (mid-pagination failure, skipped rows, repeated cursor, limit), and aborts cleanly on unmount; `Export` preserves its label and does not crash when `Kind.Setup` is damaged; Settings lines render every state including `shown === 1` singular and `heard.setup === undefined`.
- **Prompts & inputs:** `ScribeAnalyzer.input`, `ScribeScene.input`, `ScribePedant.input` no longer emit `PLAYER CHARACTER PROFILE:`; `ScribeReminder` output unchanged in both `remind` and `generateReminder`.
- **Whole-app & pack:** packed `scribe.user.js` runs end-to-end on both room URLs and plot URLs in `scribe-whole.test.mjs`, and `scribe-pack.test.mjs` verifies the 30-file bundle compiles and matches source.

## Hand-off checks on live Zeta

1. Open `/en/plots/57475939-4faa-4cf0-8cf6-ca8dd0ab7ab0/profile?fromRoom=true`, click **Export plot**, verify downloaded `zeta-plot-*.json` has plot title, descriptions, `about`, characters, chatProfiles, speaker-resolved opening, raw intros/lorebooks/plugins, `chat: null`, and zero book/live/settings.
2. Open `/en/rooms/d56b9e83-680d-42f9-9e04-c17292102e0d`, verify Settings shows setup size + persona name, click **Export plot + chat**, verify live message progress and downloaded `zeta-plot-chat-*.json` includes room metadata + persona + full DM Memory notes + complete chronological `chat.messages`, verify **Export** includes `setup`, and inspect outgoing OpenRouter request bodies in DevTools Network (alongside automated tests) to confirm `BACKGROUND` appears once per text call and `historicalCheck` stays valid JSON.
3. Check a plot with non-empty `lorebooks` to confirm normalized `lore` and raw `lorebooks` both populate as expected.
