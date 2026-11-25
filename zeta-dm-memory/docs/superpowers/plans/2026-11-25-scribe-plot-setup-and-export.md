# Plan: Scribe full plot setup, local setup export, and plot-page JSON exporter

Date: 2026-11-25. Design: [2026-11-25-scribe-plot-setup-and-export-design.md](../specs/2026-11-25-scribe-plot-setup-and-export-design.md).

All paths are relative to `zeta-dm-memory/`. `universe/` is untouched. Code style follows surrounding Scribe modules: tag-only docblocks (`@param`, `@return`, `@throws`) on every method, no prose comments, braces always, no single-letter variable names, constants in `Settings`, no inline `style` attributes or raw colors in DOM templates. Code first, then tests that try to break it.

---

## Task 1: `ScribeSetup`, `ScribeStore.Kind.Setup`, and `ScribeCloud.rawNotes`

**Files**
- Create: `scribe/page/ScribeSetup.js`
- Modify: `scribe/page/ScribeStore.js`
- Modify: `scribe/page/ScribeCloud.js`
- Create: `tests/scribe-setup.test.mjs`
- Modify: `tests/scribe-store.test.mjs`, `tests/scribe-cloud.test.mjs`

**Exact signatures & values**
- `ScribeSetup` (`scribe/page/ScribeSetup.js`, global `const ScribeSetup = Object.freeze({ ... })`):
  - `Settings`:
    - `StoryCap: 6000` (code points; headings excluded)
    - `Format: 'zeta-scribe-plot'`, `Version: 1`
    - `FilePrefix: 'zeta-plot-'`, `FileSuffix: '.json'`, `MaxSlugLength: 60`, `FallbackSlug: 'plot'`
    - `UnknownPlayer: 'unknown'` (matched case-insensitively; also respects `ScribeIntake.Settings.UnknownPlayer` when loaded)
    - `Headings`:
      - `Background: 'BACKGROUND (never a source on its own: no fact, subject, thread or NOW line comes from it alone; the messages and the book are what happened, and where they differ from it they are right):'`
      - `Story: "STORY SETUP (the writer's starting point; the story has moved on since):"`
      - `Profile: "PLAYER CHARACTER PROFILE (the player's own description of their character; trust it for that character):"`
      - `About: 'About:'`
      - `Characters: 'Story characters:'`
      - `Opening: 'Opening:'`
      - `Lore: 'Lore:'`
  - `ScribeSetup.resolvePlayer(player, profile)`: returns trimmed `player` if non-empty and `trimmed.toLowerCase() !== UnknownPlayer`, else trimmed `profile?.name` if non-empty, else `null`.
  - `ScribeSetup.substitute(text, playerName)`: replaces `/\{\{user\}\}/gi` using `() => playerName` when `playerName !== null`, else returns `text` unchanged.
  - `ScribeSetup.flatten(text)`: replaces `/\r?\n+/g` with a single space and trims.
  - `ScribeSetup.cap(text, limit)`: code-point cap via `Array.from(text)`; if `<= limit` returns `{ text, shown: points.length, whole: points.length }`; else slices to `limit`, cuts at last `\n` (`index > 0`) stripping trailing `\r`, or keeps the exact `limit`-code-point slice when no newline exists.
  - `ScribeSetup.build(story, profile, player = '')`:
    - Builds story body in order: `<name>: <summary>` (or whichever is non-empty), `<description>`, `About:\n<about>`, `Story characters:\n- <name>: <description>`, `Opening:\n<speaker>: <text>`, `Lore:\n- <name>: <text>`.
    - Flattens line breaks in `name`, `summary`, character `name`/`description`, opening `speaker`/`text`, lore `name`/`text`.
    - Substitutes `{{user}}` before capping.
    - Caps story body at `6,000` code points.
    - Combines `Background` + optional `Story` + optional `Profile` (`profile?.text`).
    - Returns frozen `{ text, storyText, profileText, shown, whole, source: profile?.source ?? null, persona: profile?.name ?? null }`.
  - `ScribeSetup.exportBundle({ plot, roomId = null, roomTitle = null, introId = null, profile = null, notes = null, exportedAt })`:
    - Returns plain object `{ format: 'zeta-scribe-plot', version: 1, exportedAt, plotId, roomId, roomTitle, introId, plot: { id, name, shortDescription, longDescription, about, creatorComment, language, mode, hashtags, characters, chatProfiles, opening, lore, raw }, profile, notes }` (raw `{{user}}` preserved untouched; zero messages/book/live/settings/credentials).
  - `ScribeSetup.filename(name, plotId)`: ASCII-safe lowercase slug (non-alphanumeric -> `-`, collapse `-+`, trim leading/trailing `-`, cap 60), falling back to sanitized `plotId`, then `'plot'`, wrapped as `zeta-plot-<slug>.json`.
- `ScribeStore.js`:
  - Add `Setup: 'setup'` to `ScribeStore.Kind` (`Campaign`, `Book`, `Live`, `Settings`, `Setup`).
- `ScribeCloud.js`:
  - Initialize `cloud.rawNotes = null` in `open` and reset `cloud.rawNotes = null` in `restart`.
  - In `readNotes`: on 200 string response, set `cloud.rawNotes = notes.trim() === '' ? null : notes` (untruncated); on 404 `memory_not_found`, set `cloud.rawNotes = null`.
  - Add `ScribeCloud.rawNotes(cloud)` returning `cloud.rawNotes`, and expose `rawNotes: () => ScribeCloud.rawNotes(cloud)` and `notesChecked: () => cloud.checkedNotes` on the cloud handle.
  - Confirm `ScribeCloud.Settings.Synced` stays `[Settings, Book, Live]`.

**Tests that try to break it**
- `tests/scribe-setup.test.mjs`: section order; empty sections omitted; both null -> `text: null`; 6,000-code-point cap cut at `\n`, with `\r\n`, with no newline, and across UTF-16 surrogate pairs (e.g. astral chars); headings excluded from `shown`/`whole`; `{{user}}` / `{{USER}}` ignored for `'unknown'` / `'UNKNOWN'`, falls back to `profile.name`, handles `$&`/`$$`/`$1` in player name literally, leaves `{{user}}` intact when neither exists; line breaks inside names, summaries, character descriptions, opening messages, and lore entries; twelve story characters; `exportBundle` preserves `{{user}}` and `plot.raw` (including custom `lorebooks` trigger/keyword fields) and omits messages/book; `filename` rejects path traversal, collapses hyphens, handles non-ASCII-only titles, falls back to `plotId`, then `'plot'`.
- `tests/scribe-store.test.mjs`: `Kind.Setup` write/read round-trip, presence in `exportText` (`bundle.setup`), removal by `ScribeStore.drop`, listing in `ScribeStore.rooms`, damaged `Kind.Setup` reported in `bundle.damaged`/`bundle.raw`.
- `tests/scribe-cloud.test.mjs`: `rawNotes()` returns full 10,000-char string while `notes()` returns <= 4,000 code points; `notesChecked()` flips true on 200 and 404 `memory_not_found`, false on 500; `restart()` resets `rawNotes()` to `null`; `Synced` excludes `Kind.Setup`.

**Verify**: `node tests/scribe-setup.test.mjs && node tests/scribe-store.test.mjs && node tests/scribe-cloud.test.mjs`

---

## Task 2: `ZetaSource` full plot/persona extraction, plot-page routing, and `FakeZeta`

**Files**
- Modify: `scribe/page/ZetaSource.js`
- Modify: `tests/support/FakeZeta.mjs`
- Modify: `tests/scribe-zeta.test.mjs`

**Exact signatures & values**
- `ZetaSource.Settings`:
  - Add `PlotPath` getter `/^(?:\/[a-z]{2,3}(?:-[a-z0-9]{2,8})?)?\/plots\/([^/]+)/i`.
  - Add field constants: `IdField: 'id'`, `TitleField: 'title'`, `IntroIdField: 'introId'`, `CreatedAtField: 'createdAt'`, `ShortDescriptionField: 'shortDescription'`, `LongDescriptionField: 'longDescription'`, `AboutField: 'about'`, `CreatorCommentField: 'creatorComment'`, `LanguageField: 'language'`, `ModeField: 'mode'`, `HashtagsField: 'hashtags'`, `ChatProfilesField: 'chatProfiles'`, `SummaryField: 'summary'`, `IntrosField: 'intros'`, `ConversationField: 'conversation'`, `MessagesField: 'messages'`, `ContentField: 'content'`, `TextField: 'text'`, `ValueField: 'value'`, `SpeakerNameField: 'speakerName'`, `SenderIdField: 'senderId'`, `SenderTypeField: 'senderType'`, `NarratorSenderId: '_NARRATOR_'`, `NarratorSpeaker: 'Narrator'`, `UserSenderType: 'USER'`, `UserPlaceholder: '{{user}}'`, `LorebooksField: 'lorebooks'`, `LoreNameFields: ['name', 'title', 'key']`, `LoreKeysField: 'keys'`, `LoreTextFields: ['content', 'description', 'text', 'value']`, `PersonaSource: 'Persona'`, `RawPlotFields: ['characters', 'chatProfiles', 'intros', 'lorebooks', 'conversations', 'plugins', 'infoBoxSetting', 'cyoaSetting', 'creator', 'isLongDescriptionPublic', 'isExampleConversationPublic', 'isAboutPublic']`.
- `ZetaSource.plotPage(pathname)`: returns decoded `plotId` matching `PlotPath`, else `null`.
- `ZetaSource.readyRequest(request)`: checks `request.signal?.throwIfAborted()`, `filled(request.token)` (`NoLogin`), `typeof request.pause === 'function'` (`NoPause`). `ZetaSource.ready(request)` calls `readyRequest(request)` then checks `roomId` (`NoRoom`).
- `ZetaSource.parsePlot(rawPlot, fallbackPlotId = null, introId = null)`:
  - Validates `isObject(rawPlot)` and resolves `plotId` from finite numeric or non-empty string `rawPlot.id` or `fallbackPlotId` (throws `NoPlot` if absent).
  - Extracts `name`, `summary`, `description`, `about`, `creatorComment`, `language`, `mode`, `hashtags`, `characters` (`{ id, name, description }`, skipping entries with empty trimmed `name`; missing/non-array -> `[]`), `chatProfiles` (`{ id, name, summary, description }`), `opening` (selects intro matching `introId`, fallback `intros[0]`, resolves `speaker`: trimmed `speakerName` -> `'_NARRATOR_'` => `'Narrator'` -> `senderId` lookup in `characters` -> `senderType === 'USER'` => `'{{user}}'` -> `''`; text from string `content` or string `content.text`), `lore` (`{ name, text }` from `lorebooks`), and JSON-safe cloned `raw`.
- `ZetaSource.story(request)`:
  - Calls `GET /v1/rooms/:roomId` once.
  - Resolves `plotId = ZetaSource.plotOf(room.body)`; throws `NoPlot` if `null`.
  - If `!isObject(room.body?.plot)`, throws `Object.assign(ZetaSource.failure(words.NoPlot, room.status, false), { plotId })`.
  - Calls `parsePlot(room.body.plot, plotId, room.body.introId ?? null)` and returns frozen `{ ...parsed, roomTitle, introId, createdAt }`.
- `ZetaSource.plot(request)`:
  - Calls `readyRequest(request)`, validates `filled(request.plotId)` and `encodeURIComponent` (`NoPlot`).
  - Fetches `GET /v1/plots/${encodeURIComponent(request.plotId)}` via `retried`.
  - Validates `isObject(read.body)` (else `Shape`).
  - Returns `parsePlot(read.body, request.plotId, request.introId ?? null)`.
- `ZetaSource.profile(request, plotId = null)`:
  - Returns `null` on empty `plotId`, 404, or empty/null `description`.
  - Returns frozen `{ source: 'Persona', name: title || null, description: detail, text: cappedText }` (`description` uncapped; `text` capped at `LongestProfile` 2,000 code points).
- `tests/support/FakeZeta.mjs`:
  - Add configurable `introId`, `intros`, `lorebooks`, `chatProfiles`, `about`, `creatorComment`, `hashtags`, `plugins`, `conversations`, `plotFailure` fields.
  - Serve `GET /v1/plots/:plotId` with full plot body (including `about`, `isAboutPublic`, `plugins`) alongside `GET /v1/rooms/:roomId` (including `introId`, `plot`).

**Tests that try to break it**
- `tests/scribe-zeta.test.mjs`: HAR-shaped room body returns every field without hitting `/v1/plots/:id`; `room.introId` picks second intro over `intros[0]`; `speakerName: null` resolves `_NARRATOR_`, character UUID, `USER`, and unknown `senderId`; `content` as string, `{ text }`, and number (skipped); finite numeric `plot.id`; missing `characters` gives `[]`; non-object `plot` with top-level `plotId` attaches `error.plotId`; `lorebooks` with `content`/`description`/`text`/`value` and `name`/`title`/`key`/`keys` plus raw `lorebooks` verbatim; `plotPage` matches `/plots/:id/profile`, `/en/plots/:id/profile`, `/pt-BR/plots/:id`, ignores `/rooms/:id` and `/plots/`; `ZetaSource.plot` fetches `/v1/plots/:id`, passes `introId`, extracts `about`/`plugins`, honors `AbortSignal`, rejects 404/500/non-object/missing `plotId`; `ZetaSource.profile` returns `{ source: 'Persona', name, description, text }` with uncapped `description` > 2,000 chars and capped `text` == 2,000 code points, empty name -> `name: null`, empty description -> `null`, 404 -> `null`, 500 -> throws.

**Verify**: `node tests/scribe-zeta.test.mjs`

---

## Task 3: Prompt cleanup and strict-JSON historical checker setup (`ScribeAnalyzer`, `ScribeAdoption`, `ScribeScene`, `ScribePedant`, `ScribeKeeper`)

**Files**
- Modify: `scribe/core/ScribeAnalyzer.js`
- Modify: `scribe/core/ScribeAdoption.js`
- Modify: `scribe/page/ScribeScene.js`
- Modify: `scribe/page/ScribePedant.js`
- Modify: `scribe/page/ScribeKeeper.js`
- Modify: `tests/scribe-analyzer.test.mjs`, `tests/scribe-adoption.test.mjs`, `tests/scribe-scene.test.mjs`, `tests/scribe-pedant.test.mjs`, `tests/scribe-keeper.test.mjs`, `tests/scribe-authority-reading.test.mjs`

**Exact signatures & values**
- `ScribeAnalyzer.js`: remove `Headings.Profile`, remove `PLAYER CHARACTER PROFILE` line from `PromptLines`, change `input(state, player, stretch)` (drop `profile` arg and profiled section).
- `ScribeAdoption.js`: remove `Settings.Arguments.Profile`, remove `options.profile` validation and `job.profile` propagation to `ScribeAnalyzer.input`.
- `ScribeScene.js`: remove `Headings.Profile`, remove `PLAYER CHARACTER PROFILE` line from `PromptLines`, change `input(state, player, messages, previous)` and `now({ state, player, messages, previous, ask })`.
- `ScribePedant.js`:
  - Live review: remove `Headings.Profile`, remove `PLAYER CHARACTER PROFILE` line from `PromptLines`, change `input(state, player, message, unread, candidates, messages)` and `review({ state, player, message, unread, messages, ask })`.
  - Historical check (`CheckPrompt` and `incoming` line 896):
    - Replace line 386 in `CheckPrompt` with: `'storySetup (background only; never a source for Book claims on its own — verify claims strictly against cited messages) and playerCharacterProfile (the player’s description of their character), when present, provide context.'`
    - Change 6th callback passed to `work.ask` to `(setup) => JSON.stringify({ ...input, ...(setup?.storyText ? { storySetup: setup.storyText } : {}), ...(setup?.profileText ? { playerCharacterProfile: setup.profileText } : {}) })`.
- `ScribeKeeper.js`:
  - Replace `Settings.Messages.BadProfile` with `BadSetup: 'The argument is not valid: setup'`.
  - Replace `options.profile` in `open(options)` with `options.setup` (`() => Promise<{ storyText: string|null, profileText: string|null }|null>`), validating function or null/undefined.
  - In `adopt` (~line 1855): remove `keeper.profile()` call and `profile` field from `ScribeAdoption.run(...)`.
  - In `checkPassage` (~line 2411): rename `inputWithProfile` to `inputWithSetup`; if `inputWithSetup && keeper.setup`, await `const setup = await keeper.setup()`, re-check `current()`, and if `setup?.storyText || setup?.profileText` set `outgoing = inputWithSetup(setup)` (while `inputStamp` remains computed on base `input`).

**Tests that try to break it**
- `scribe-analyzer`, `scribe-scene`, `scribe-pedant`: inputs and system prompts never emit `PLAYER CHARACTER PROFILE:`; live `ScribePedant.review` and `ScribeScene.now` accept their updated request shapes.
- `scribe-adoption`: rejects no `profile` dependency; story/Notes/Answers passes run cleanly without `profile`.
- `scribe-keeper` & `scribe-authority-reading`: `open({ setup: 'bad' })` throws `BadSetup`; `adopt` never calls `setup()`; `checkPassage` injects `storySetup` and `playerCharacterProfile` into valid JSON (omitting null fields), keeps `inputStamp` invariant across setup changes, yields if `current()` becomes false while awaiting `setup()`.

**Verify**:
`node tests/scribe-analyzer.test.mjs && node tests/scribe-adoption.test.mjs && node tests/scribe-scene.test.mjs && node tests/scribe-pedant.test.mjs && node tests/scribe-keeper.test.mjs && node tests/scribe-authority-reading.test.mjs && node tests/scribe-authority-book.test.mjs && node tests/scribe-authority-judgments.test.mjs && node tests/scribe-authority-rulings.test.mjs && node tests/scribe-check-ledger.test.mjs && node tests/scribe-facts.test.mjs`

---

## Task 4: `ScribeLive` cast lifecycle, merge-safe `Kind.Setup` persistence, and `setup` view

**Files**
- Modify: `scribe/page/ScribeLive.js`
- Modify: `tests/scribe-live.test.mjs`, `tests/scribe-reminder.test.mjs`

**Exact signatures & values**
- `ScribeLive.Settings`:
  - `Uncast: Object.freeze({ story: null, profile: null, storyRead: false, storyFailed: false, profileRead: false, profileFailed: false, notice: null })`.
  - `Messages.StoryUnread: 'The story setup could not be read: '`.
- `ScribeLive.open(options)`:
  - Adds optional `rawNotes?: () => { checked: boolean, text: string|null }` (default `() => ({ checked: false, text: null })`).
  - Starts `ScribeLive.cast(live)` eagerly ONLY when `keeper.view().booked === true` (zero Zeta requests and zero `Kind.Setup` writes on unadopted rooms).
- `ScribeLive.cast(live)`:
  - Reads `story`, then `profile(plotId)` only when `plotId` is non-empty string (resolved from `story.value.plotId` or `story.reason.plotId`).
  - When `story` fails and `plotId === null`: marks `profileRead: false, profileFailed: true` (does not falsely report "none set" and does not stay "reading").
  - On `NoLogin` or `live.closed`: leaves `live.cast = null`, returns `Uncast`, and calls `live.notify()` if not closed so UI clears `reading` state.
  - Otherwise stores frozen `live.cast`, calls `ScribeLive.persistSetup(live, cast)` (only when `keeper.view().booked === true` and at least one of `storyRead` or `profileRead` succeeded), and calls `live.notify()`.
- `ScribeLive.persistSetup(live, cast)`:
  - Best-effort `try/catch`: reads prior `ScribeStore.read(live.storage, live.roomId, ScribeStore.Kind.Setup)` (catching `{ damaged: true }` as `{}`).
  - Merges only newly fulfilled parts (`story`, `plotId`, `roomTitle`, `introId` if `cast.storyRead`; `profile` if `cast.profileRead`; `notes` if `live.rawNotes().checked`, else preserves prior `notes`), sets `fetchedAt: new Date(live.clock.now()).toISOString()`, writes `ScribeStore.Kind.Setup`.
- `ScribeLive.handle(live)`:
  - Removes `profile()`.
  - Adds `setup: async () => { const cast = await ScribeLive.cast(live); return ScribeSetup.build(cast.story, cast.profile, live.keeper.view().player); }`.
  - Adds `setupRecord: () => ScribeLive.setupRecord(live)` (returns `{ story, profile, notes }` from `live.cast` merged with persisted `Kind.Setup` fallback, catching `{ damaged: true }`).
  - Adds `ensureCast: () => { if (!live.closed && live.keeper.view().booked && live.cast === null && live.casting === null) { void ScribeLive.cast(live); } }`.
- `ScribeLive.view(live)`:
  - Adds `setup`: when `live.cast !== null`, computes `built = ScribeSetup.build(live.cast.story, live.cast.profile, live.keeper.view().player)` and returns `{ read: true, reading: false, storyRead: live.cast.storyRead, storyFailed: live.cast.storyFailed, shown: built.shown, whole: built.whole, profileRead: live.cast.profileRead, profileFailed: live.cast.profileFailed, source: built.source, persona: built.persona }`; when `live.cast === null`, returns `{ read: false, reading: live.casting !== null, storyRead: false, storyFailed: false, shown: 0, whole: 0, profileRead: false, profileFailed: false, source: null, persona: null }`.
- `ScribeLive.remind` & `ScribeLive.generateReminder`: pass `cast.story?.characters ?? null` (and `live.cast?.story?.characters ?? null`) to `ScribeReminder`.
- `ScribeLive.assess` / scene & live pedant calls: drop separate `profile` read and argument.

**Tests that try to break it**
- `tests/scribe-live.test.mjs`: load `ScribeSetup.js` in harness; unadopted room (`booked: false`) makes zero `story`/`profile` calls and zero `Kind.Setup` writes on `open`; adopted room (`booked: true`) starts `cast` on `open`, notifies on settle, and persists `Kind.Setup`; partial read (`story` fails with `error.plotId`, `profile` succeeds) preserves previously stored `story` and `notes`; failed `story` with `plotId === null` yields `profileFailed: true`; `NoLogin` clears `casting`, notifies, and `ensureCast()` retries once token is available; storage error on `Kind.Setup` write does not break `cast`; damaged prior `Kind.Setup` does not crash `persistSetup` or `setupRecord`; `setup()` re-evaluates `{{user}}` when `keeper.view().player` changes from `'unknown'` to `'Frost'`; `remind` and `generateReminder` still classify story characters identically.
- `tests/scribe-reminder.test.mjs`: unchanged reminder output with new `story.characters` shape.

**Verify**: `node tests/scribe-live.test.mjs && node tests/scribe-reminder.test.mjs && node tests/scribe-muse.test.mjs`

---

## Task 5: `ScribePlotExport`, `PanelStyle`, `ScribePanel`, and `ScribeBoot` wiring

**Files**
- Create: `scribe/page/ScribePlotExport.js`
- Modify: `scribe/page/PanelStyle.js`
- Modify: `scribe/page/ScribePanel.js`
- Modify: `scribe/page/ScribeBoot.js`
- Create: `tests/scribe-plot-export.test.mjs`
- Modify: `tests/support/PanelHarness.mjs`, `tests/scribe-panel.test.mjs`, `tests/scribe-boot.test.mjs`

**Exact signatures & values**
- `PanelStyle.js`:
  - Add `PlotText` (or shared token block + `.plot-export` styles) using the exact same `:host` light/dark CSS custom properties: bottom-right fixed container (`right: var(--scribe-gap)`, `bottom: var(--scribe-gap)`, `max-width: calc(100vw - 1.5rem)`, `z-index: var(--scribe-layer)`), primary/action button with visible `:focus-visible` outline (`var(--scribe-focus)`), disabled state (`var(--scribe-disabled)`), adjacent polite status text (`var(--scribe-muted)` / `var(--scribe-danger)`), `@media (prefers-reduced-motion: reduce)` respected, zero raw colors.
- `ScribePlotExport.js` (global `const ScribePlotExport = Object.freeze({ ... })`):
  - `Settings`: `HostId: 'scribe-plot-host'`, `ButtonId: 'scribe-plot-export-button'`, `StatusId: 'scribe-plot-export-status'`, `Words: { Export: 'Export plot', Exporting: 'Exporting plot...', Exported: 'Exported ', NoLogin: 'No login seen yet — wait a moment or refresh, then try again.' }`.
  - `ScribePlotExport.mount({ document, AbortController, plotId, fetchPlot, download, clock })`:
    - Mounts Shadow DOM host (`id = HostId`), appends `<style>` (`PanelStyle.PlotText`) + button + status `<p aria-live="polite">`.
    - Click handler ignores clicks while `busy`, sets `busy = true`, disables button, displays `Exporting plot...`, creates `controller = new AbortController()`, awaits `plot = await fetchPlot(controller.signal)`, builds `bundle = ScribeSetup.exportBundle({ plot, exportedAt: new Date(clock.now()).toISOString() })`, downloads `ScribeSetup.filename(plot.name, plot.plotId)` with `JSON.stringify(bundle, null, 2)`, updates status (`Exported <filename> (<n> character(s), <m> lore entry/entries).`), re-enables button. On `AbortError` after unmount, does nothing. On error, maps `NoLogin` to friendly guidance or displays error message.
    - Returns frozen `{ host, unmount }`; `unmount()` sets `unmounted = true`, aborts `controller`, removes `host`.
- `ScribePanel.js`:
  - `Settings.Ids`: add `ExportPlot: 'scribe-export-plot'`, `SetupState: 'scribe-setup-state'`, `ProfileState: 'scribe-profile-state'`.
  - `Settings.Words`: keep `Export: 'Export'`; add `ExportPlot: 'Export plot'`, `ExportingPlot: 'Exporting plot...'`, `SetupReading: 'Reading the story setup...'`, `SetupFailed: 'Story setup: could not be read.'`, `SetupNone: 'Story setup: none on this story.'`, `SetupPrefix: 'Story setup: '`, `SetupOne: ' character goes with every call'`, `SetupMany: ' characters go with every call'`, `SetupCutOpen: ' (cut from '`, `SetupCutClose: ').'`, `ProfileReading: 'Reading the profile...'`, `ProfileFailed: 'Profile: could not be read.'`, `ProfilePersona: 'Profile: your persona '`, `ProfileSet: 'Profile: set for this chat.'`, `ProfileNone: 'Profile: none set for this chat.'`.
  - `ScribePanel.mount(options)`: accept optional `exportPlot = null` and `AbortController = null`. Initialize `panel.exportingPlot = false`, `panel.plotExportController = null`. Abort `panel.plotExportController` in `unmount()`.
  - `Builders.Progress`: add `ExportPlot` button (`Guard.Free`, `ids.ExportPlot`) right beside `Export`.
  - `ScribePanel.exportPlot(panel)`: independent of book locks (`panel.exportingPlot`), disables button while busy, shows `Exporting plot...` in `Outlets.Controls`, calls `panel.exportPlot(controller.signal)`, builds `ScribeSetup.exportBundle(...)`, downloads `ScribeSetup.filename(...)`, reports outcome in `Outlets.Controls`, clears busy flag.
  - `ScribePanel.exportChat(panel)`: before `ScribeStore.exportText`, if `panel.cloud?.notesChecked?.()`, best-effort reads `Kind.Setup` (catching `{ damaged: true }` and any storage error); if an existing object is present and `saved.notes !== raw`, writes `{ ...saved, notes: raw }`. Never crashes on damaged rooms and never creates `Kind.Setup` on unadopted rooms.
  - `Drawers.Settings`: add `SetupState` and `ProfileState` paragraphs above `KeyState`; in `redraw`, normalize `setup = heard.setup ?? null` and render every state cleanly (singular/plural for `shown === 1`; `PanelView.said(setup.persona)`).
- `ScribeBoot.js`:
  - Extract boot-level `ScribeBoot.pageFetch(boot)` (Xray-safe wrapper around `boot.pageFetch` + `environment.clone`) and `ScribeBoot.wait(boot, milliseconds, signal)` (timer-backed abortable pause).
  - Add `boot.plotSession = null` and `boot.plotRetry = null`; add `ScribeBoot.closePlot(boot)` called on navigation away, `pagehide`, and `stop()`.
  - Update `ScribeBoot.follow(boot)`: compute `roomId = ZetaSource.room(pathname)` and `plotId = roomId === null ? ZetaSource.plotPage(pathname) : null`; reconcile `boot.session` against `roomId` and `boot.plotSession` against `plotId` independently (fixing the `null === null` short-circuit); guard `plotSession` mounting with `environment.document.body !== null` (with retry timer / `DOMContentLoaded` if body is not ready yet).
  - Update `ScribeBoot.shield(boot, event)`: also allow events whose composed path contains `boot.plotSession?.host`.
  - In `ScribeBoot.token(boot)` / `ScribeBoot.look(session)`: when a token is newly captured and `session.keeper?.view().booked` is true, call `session.live?.ensureCast()`.
  - In `ScribeBoot.call`:
    - For `!historicalCheck`: register a cancellable pre-dispatch trial in `session.running` before awaiting `session.live.setup()`, race against `halted` (so Pause / Force stop abort immediately with `error.stopped = 0` and redacted diagnostics), remove the pre-dispatch trial before entering the main loop, re-verify `currentRoom`, `pauseEpoch`, and not paused, then build `told` as `[setup?.text, user]` joined by `\n\n`, followed by `NotesOpen + notes` when `noted`.
    - For `historicalCheck`: skip plain-text `setup.text` and `NotesOpen` (strict JSON preserved).
  - Wire `ScribeKeeper.open({ ..., setup: async () => (session.live === null ? null : session.live.setup()) })`.
  - Wire `ScribeLive.open({ ..., rawNotes: () => ({ checked: session.cloud?.notesChecked?.() ?? false, text: session.cloud?.rawNotes?.() ?? null }) })`.
  - Wire `ScribePanel.mount({ ..., AbortController: environment.pageWindow.AbortController, exportPlot: (signal) => ScribeBoot.exportPlot(session, signal) })`:
    - `ScribeBoot.exportPlot(session, signal)`: gets cached `live.setupRecord()` (or reads `ZetaSource.story` + `ZetaSource.profile` on demand if `null`, passing `signal`), tries `ZetaSource.plot({ fetch, token, plotId, introId, pause, signal })` when `plotId` is known (falling back to cached `story` on non-abort error), attaches `roomId`, `roomTitle`, `introId`, `profile`, and `notes: session.cloud?.rawNotes?.() ?? record.notes ?? null`.

**Tests that try to break it**
- `tests/scribe-plot-export.test.mjs`: mounts Shadow DOM host with zero inline styles; click disables button and shows loading state; double-click while busy fires only 1 fetch; downloads formatted JSON with sanitized filename and counts; `NoLogin` shows friendly message; HTTP 500 shows error and re-enables button; `unmount()` aborts in-flight fetch and suppresses post-unmount DOM/download calls.
- `tests/scribe-panel.test.mjs`: `PanelHarness` loads `ScribeSetup`; existing `Export` button label unchanged; `Export` survives damaged `Kind.Setup`; `Export plot` button (`Guard.Free`) shows loading state, ignores double-click while busy, works while book is locked, aborts on unmount; Settings renders all `SetupState` and `ProfileState` states including `shown === 1` singular, cut count, failed, reading, unnamed persona, none set, and `heard.setup === undefined`.
- `tests/scribe-boot.test.mjs`: loads `ScribeSetup` and `ScribePlotExport`; text calls receive `BACKGROUND` once before user content and `OPERATOR NOTES:` after; `historicalCheck` receives untouched JSON; Pause/Force stop aborts a stalled `setup()` wait immediately and bills nothing; session closed during `setup()` wait sends nothing; navigating `/` -> `/plots/p1/profile` -> `/plots/p2/profile` -> `/rooms/harbour` -> `/` mounts/unmounts `plotSession` cleanly, retries when `document.body === null`, shields `plotSession.host` key events, passes `pageWindow.AbortController`; token arrival triggers `live.ensureCast()` on booked rooms; `exportPlot` passes `room.introId` to `ZetaSource.plot` and falls back to cached room story on `/v1/plots/:id` error (re-throwing abort).

**Verify**: `node tests/scribe-plot-export.test.mjs && node tests/scribe-panel.test.mjs && node tests/scribe-boot.test.mjs`

---

## Task 6: Pack bundle (`scribe/pack.mjs`, `scribe/scribe.user.js`) and end-to-end verification

**Files**
- Modify: `scribe/pack.mjs` (30 files: add `scribe/page/ScribeSetup.js` before `scribe/page/ScribeLive.js` and `scribe/page/ScribePlotExport.js` before `scribe/page/ScribeBoot.js`)
- Rebuild: `scribe/scribe.user.js` (bump `@version` from `0.3.49` to `0.3.50`)
- Modify: `tests/support/WholeSite.mjs`, `tests/support/WholePanel.mjs`, `tests/support/WholeTab.mjs`
- Modify: `tests/scribe-pack.test.mjs`, `tests/scribe-whole.test.mjs`

**Exact details**
- `WholeSite.mjs`: route `GET /v1/plots/:plotId` to the matching room's `FakeZeta` (or a standalone registered plot with no room!) so whole-app tests can visit `/en/plots/:plotId/profile` with or without a room.
- `WholePanel.mjs`: add plot-export host helper (`scribe-plot-host` button + status query).
- `WholeTab.mjs`: support navigating to `/en/plots/:plotId/profile` and firing a plot-page authenticated Zeta fetch (`/v2/plots/:plotId/likes/summary`) so token capture on direct plot-page load is exercised end to end.
- `scribe-pack.test.mjs`: verify 30-file bundle compiles, matches source byte-for-byte, and declares `ScribeSetup` and `ScribePlotExport`.
- `scribe-whole.test.mjs`:
  - End-to-end room visit (adopted): one room read, persona read, Settings displays setup size and persona, outgoing model calls carry `BACKGROUND` once (text) and `storySetup`/`playerCharacterProfile` JSON (`historicalCheck`), chat-page **Export plot** downloads standalone JSON with room metadata + persona + full DM Memory notes (no messages/book), **Export** includes `setup`.
  - Unadopted room invariant preserved: zero Scribe requests and zero `Kind.Setup` writes on open/timers/reopen; explicit **Export plot** still works on demand.
  - End-to-end plot-page visit (`/en/plots/:plotId/profile` with no room): captures login token from plot-page traffic, mounts **Export plot** widget, clicks button, downloads clean JSON with `about`/`plugins`/characters/opening/lorebooks and zero messages/book; navigating away unmounts cleanly.

**Verify** (full affected verification + bundle check + diff hygiene):
```sh
node tests/scribe-setup.test.mjs &&
node tests/scribe-store.test.mjs &&
node tests/scribe-cloud.test.mjs &&
node tests/scribe-zeta.test.mjs &&
node tests/scribe-analyzer.test.mjs &&
node tests/scribe-adoption.test.mjs &&
node tests/scribe-scene.test.mjs &&
node tests/scribe-pedant.test.mjs &&
node tests/scribe-keeper.test.mjs &&
node tests/scribe-live.test.mjs &&
node tests/scribe-reminder.test.mjs &&
node tests/scribe-muse.test.mjs &&
node tests/scribe-plot-export.test.mjs &&
node tests/scribe-panel.test.mjs &&
node tests/scribe-boot.test.mjs &&
node tests/scribe-pack.test.mjs &&
node tests/scribe-whole.test.mjs &&
node tests/scribe-authority-reading.test.mjs &&
node tests/scribe-authority-book.test.mjs &&
node tests/scribe-authority-judgments.test.mjs &&
node tests/scribe-authority-rulings.test.mjs &&
node tests/scribe-check-ledger.test.mjs &&
node tests/scribe-facts.test.mjs &&
git diff --check -- zeta-dm-memory
```
