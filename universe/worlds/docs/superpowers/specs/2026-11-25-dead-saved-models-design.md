# Dead Saved Models and a Display-Only Browser: Design

Status: draft for operator approval (2026-11-25); builder check done, its questions answered (decisions 6-9). Follows the live model catalog design
(`docs/superpowers/specs/2026-11-25-live-model-catalog-design.md`, "catalog design" below), whose Tasks 1-2 must be
committed first. Builds on its rulings 1-22; supersedes the parts named in "Superseded rulings".

## Why

- Today a saved model that dies stays saved. A character whose override no provider serves blocks every turn
  (catalog design ruling 6), and the character window shows the dead ID in the text field next to a dropdown that
  reads "Use tier default (no override)". Operator: "If the override is dead, how is it still saved? basic UX. Just
  remove it from the save, its DEAD."
- The browser decides model logic it cannot know: it guesses from the catalog list whether a saved model is listed,
  works out the status line from raw fields, picks blank-slot prefill values, and formats option labels. Operator:
  "why the hell does the UI decide logic? ... UI is display. That's it. The only one who knows what models are saved
  is the backend."

## Operator Decisions (2026-11-25)

1. **A dead override is removed by the server.** "Dead" means OpenRouter reports the model as not served: 0 providers
   or 404 (`ModelAvailability.Unserved`, catalog design ruling 12). The result that makes it dead is recorded by a
   refresh, by a save-time check, or is already in the cache when a turn starts; the override is then cleared in the
   database and the character runs on its tier default from the next turn. No turn is refused for a dead override.
   A check that could not run (`Unchecked`) or a model never checked (`null`) is not dead and is not removed.
2. **You are told.** Each removal shows the warning
   `<name>'s model override <id> was removed: no OpenRouter provider serves it (checked <time>)`
   in the Settings tab and in that character's window, in each place until the next save there.
3. **A dead slot forces a new pick.** A slot (`director`, `composer`, `main`, `recurring`, `scribe`) has no fallback:
   turns and the Scribe actions stay refused as today (catalog design rulings 6, 11, 19, slots only); Settings shows a
   red (`danger`) alert on that slot, the slot's dropdown shows no selection, and every Settings save is refused while
   any slot holds a dead model, also when that slot was not changed in the save.
4. **The browser only displays.** Every decision about saved models and their state is made by the backend and sent
   ready to show: whether a saved model is dead, the alert and warning texts, the catalog status line, the option
   labels, and the blank-slot prefill values. The browser renders what it receives and sends what the user enters.
5. **Order:** after the play round on Tasks 1-2.
6. **Archived characters are covered** (builder check): every refresh also checks archived characters' overrides that
   OpenRouter's list does not show (catalog design ruling 16 extended), and their dead overrides are removed like any
   other.
7. **A stale window does not bring a dead override back** (builder check): when a character save sends the ID the
   server already removed from that character (a removal notice for it is still shown in the window), the server
   does not store it, saves the rest, and the window shows the removal warning. A dead ID typed fresh is still refused
   (catalog design ruling 4).
8. **The type-to-filter and its count label stay in the browser** (builder check): they narrow the list already on
   screen and decide nothing about saved data.
9. **Dead-slot texts** (builder check): the alert and refusal texts in "ModelAvailabilityService" below, as written.

## Approaches

- **A. Explicit removal points plus a turn-time guard (my pick).** One backend method removes every dead override and
  writes its notice. It runs right after each point where check results change (refresh finished, server start cache
  read, save-time check) and again at the start of every turn and Scribe action, before the slot check. The browser
  learns the result from the normal GET payloads. Deterministic, easy to test, and the turn-time run also covers rows
  that reached the database another way (the seeder, a synced snapshot).
- **B. Remove only when a turn starts.** Simplest, but Settings and the character window would keep showing a dead
  override until the next turn; it contradicts decision 2's "you are told" before you play.
- **C. A callback from `ModelCatalog` whenever results change.** Same coverage as A without call sites, but the catalog
  would write characters to the database from inside its refresh, mixing two jobs in one class, and an error in that
  write would surface as a failed refresh.

## Backend

### Store (`src/store/schema.sql`, `src/store/SqliteStore.mjs`)

- New table, created by the existing `CREATE TABLE IF NOT EXISTS` load (no migration needed; the existing database
  gains it at the next start):
  `model_override_removals (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE, model_id TEXT NOT NULL, checked_at TEXT NOT
  NULL, removed_at TEXT NOT NULL, shown_in_settings INTEGER NOT NULL DEFAULT 1 CHECK (shown_in_settings IN (0, 1)),
  shown_in_character INTEGER NOT NULL DEFAULT 1 CHECK (shown_in_character IN (0, 1)))`.
- The existing `listModelOverrides()` (`SqliteStore.mjs:457`, the configured IDs the refresh checks under ruling 16)
  drops its `archived = 0` condition (decision 6). Its shape stays (distinct model IDs).
- New `listCharacterOverrides()` -> every character with a non-null `model_override`, in every campaign, archived
  included: `{ characterId, campaignId, name, modelOverride }`.
- `removeModelOverride({ characterId, modelId, checkedAt })`, in one transaction: clears `model_override` only if it
  still equals `modelId` (a save in between wins), and inserts one notice row. Returns whether it removed. Follows the
  existing write conventions (`updated_at`, the local change sequence used by sync).
- `listOverrideRemovals({ place, characterId })`: the notices still shown in Settings (all campaigns) or for one
  character, with the character's current name.
- `markOverrideRemovalsSeen({ place, characterId })`: Settings save sets `shown_in_settings = 0` on all rows; a save of
  a character sets `shown_in_character = 0` on that character's rows. A row with both 0 is deleted.

### `ModelAvailabilityService`

- `removeDeadOverrides()` -> number removed: for each entry of `listCharacterOverrides()` whose
  `modelStatus(modelOverride)` is `Unserved`, calls `removeModelOverride` with `modelCheckedAt(modelOverride)`.
- Called:
  - after `listModels` resolves at server start (`server.mjs:386`) and after `GET /api/models` and
    `POST /api/models/refresh` resolve in the Router;
  - at the start of every character create and update, before the stored override is read (so a save cannot write
    back an override removed in the same request);
  - after the checks in `checkSlotChanges` and `checkOverrideChange` (a save-time check can record a dead verdict for a
    model other characters use);
  - first thing in `#assertModelsAvailable` (`Router.mjs:1475`), before the slot check.
- Decision 7: in a character update, a sent `modelOverride` equal to a model ID of one of that character's removal
  notices still shown in the window is treated as `null` (not stored, not checked); the rest of the save goes through;
  that notice is not marked seen by this save, so the answer carries it.
  An error in it fails the request that ran it (fail loudly); at server start it is reported on stderr like the
  existing start-refresh failure.
- `blockingMessage(campaignId)` checks the 5 slots only. Text (ruling 19 kept, override part dropped):
  `Refused: the <slot> slot uses <id>, which no OpenRouter provider serves (checked <time>). Change it in Settings.`
- `checkSlotChanges` adds a refusal for every slot whose stored model is `Unserved` and that the save does not change
  to another model: `the <slot> slot uses <id>, which no OpenRouter provider serves (checked <time>); pick a served
  model` (joined into the existing `Not saved: ...` refusal, HTTP 400). It runs for every `PUT /api/settings`, also one
  without `models`.
- `slotStates()` -> per slot `{ modelId, dead, alert }`; `alert` is
  `The <slot> slot uses <id>, which no OpenRouter provider serves (checked <time>). Pick a served model.` when dead,
  else `null`.
- `suggestedModels()` -> for each blank slot, the verified default from `recommended-models.json` `defaultSlots`,
  left out when that default is itself `Unserved`.

### Router payloads (`src/http/Router.mjs`)

- `GET /api/settings` and the `PUT /api/settings` answer add:
  - `slots`: `slotStates()`;
  - `suggestedModels`: `suggestedModels()`;
  - `overrideRemovals`: the warning texts (decision 2) still shown in Settings. A successful `PUT` marks them seen
    first, so its answer carries `[]`.
- Every character answer (list, single, create, update) adds `overrideRemovals`: that character's warning texts still
  shown in its window, oldest first (`[]` when none). Only a save from the character window marks them seen: its
  request carries `acknowledgeRemovals: true`; other character updates (the Cast archive toggle, `app.mjs:396`) do
  not. A successful window save marks them seen first, so its answer carries `[]` (except decision 7).
- `GET /api/models` and `POST /api/models/refresh` leave out of `openrouter` every model whose current `modelStatus` is
  `Unserved`, so a model found dead by a save-time check after the last refresh also leaves the dropdowns (catalog
  design ruling 5 with ruling 17).
- `GET /api/models` and `POST /api/models/refresh` add `statusText` (the loaded-state line, exact texts of catalog
  design section 6: `OpenRouter models: <n> · Cached <fetchedAt>`, `OpenRouter models: <n> (stale cache ·
  <fetchedAt>)`, `OpenRouter models: 0 (unavailable)`) and a `label` on every model (format of catalog design
  section 6: `<id> (<context>k, $<prompt>/$<completion>, moderated)`, parts only when present). `defaults` leaves out
  a default that is `Unserved` (it also feeds **Apply suggested defaults**).

## Browser (`public/`)

- Asks again when the answer can have changed: after every model load (boot and Refresh, success or error) and after
  every turn and Scribe action answer (success or refusal), it reloads `GET /api/settings` and the active campaign's
  cast. An open character window takes the new `overrideRemovals` of its character; its form values stay as typed
  (decision 7 covers a stale override).
- Renders the backend's values: `slots[].alert` as a `danger` alert above that slot's field; `overrideRemovals` as
  `warning` alerts in the Settings tab and, per character, in the character window; `statusText`
  as the status line (the browser keeps only `Loading OpenRouter catalog...`, which describes its own request in
  flight); `label` as each option's text; `suggestedModels` copied into the blank slot fields on load, with the copy
  "Suggested unrestricted defaults are prefilled below" (catalog design ruling 15) shown when it is not empty.
- Removed from the browser: `#applyBlankModelDefaults` and its catalog-arrival trigger, `ModelCatalogView.statusText`
  for loaded states, `ModelCatalogView.optionLabel`.
- Stays in the browser (decision 8): the type-to-filter match on model ID and name, the count label of what it
  renders (`OpenRouter Catalog (<n>)` / `(<m> of <n>)`), and catalog design ruling 21 (which reads the browser's own
  filter state).
- The character window's Save sends `acknowledgeRemovals: true`; the Cast archive toggle does not.
- A dead slot's dropdown shows no selection because the dead model is not in the catalog list; its text field keeps
  showing the dead ID, so the red alert and the field agree.
- Refusals (HTTP 400) and turn blocks (HTTP 409) reach the screen through the existing paths (catalog design 6a).

## Superseded rulings (catalog design)

- Ruling 6 and ruling 11: for overrides, replaced by decision 1 (removal instead of refusal); for slots, unchanged.
- Ruling 19: the block message names slots only; the trailing text becomes `Change it in Settings.`
- Ruling 3 "blank-slot prefill in Settings" now comes from the backend (`suggestedModels`).
- Ruling 16: archived characters' overrides are checked too (decision 6).
- Ruling 4 keeps refusing a dead ID typed fresh; decision 7 covers re-sending an ID the server already removed.

## Calls I made (operator to check)

- The Settings tab shows removal warnings from every campaign (Settings is global); the character window shows only
  that character's.
- The warning uses the character's current name, not the name at removal time.
- A default that is itself dead is left out of `suggestedModels` and **Apply suggested defaults** (suggesting it would
  only produce a refused save).
- A save in between wins: the override is cleared only if it still holds the dead ID.
- Builder check, settled by me: the browser reloads settings and the cast after every model load and every turn or
  Scribe action (so decisions 2 and 3 show without a tab switch); a model found dead by a save-time check leaves the
  model list (catalog design ruling 5); only the character window's Save clears its warnings (`acknowledgeRemovals`);
  several removal warnings for one character are all shown; the removal runs before a character save reads the stored
  override.

## Open for Operator

None (builder check answered 2026-11-25: decisions 6-9).

## Non-goals

- No automatic replacement for a dead slot (decision 3: you pick).
- No change to how or when models are checked (catalog design rulings 1-3, 8, 9, 12, 13, 16-18).
- No change to the format of model replies (roadmap item 2).

## Verification Strategy

- Store: `removeModelOverride` clears only a matching override and writes one notice; a changed override is left
  alone; notices clear per place; a row seen in both places is deleted; deleting a character or campaign deletes its
  notices; an existing database file gains the table at start (temporary file, removed by the test).
- `removeDeadOverrides`: removes `Unserved` overrides only (`Unchecked`, `null`, `Served` kept), archived included,
  across campaigns; runs at each call point listed above (refresh, start, character save start, both save checks,
  turn start); a save-time verdict for model X removes X from every other character; the refresh checks an archived
  character's unlisted override (decision 6).
- Character saves: a window save re-sending a removed ID stores `null`, saves the rest and returns the warning
  (decision 7); a fresh dead ID is still refused; the archive toggle does not clear warnings; a window save does;
  several warnings for one character all return.
- Model list: a model with a save-time `Unserved` verdict is left out of `openrouter`.
- Turn and Scribe routes: a dead override no longer returns 409; the turn runs with the tier default; a dead slot
  still returns 409 with the new text.
- Settings save: refused while any slot is dead, also with `models` absent or unchanged; allowed once the dead slot is
  changed to a served model.
- Payloads: `slots`, `suggestedModels` (dead default left out), `overrideRemovals` (settings and per character), `statusText`,
  `label`, `defaults` without dead defaults; seen-marking on save.
- Browser (`tests/ui.test.mjs`): renders each backend value in its place; no status or label is computed in the
  browser (status line and option text equal the payload's strings); the blank-slot prefill equals `suggestedModels`;
  a dead slot shows the `danger` alert and no selection; removal warnings show in Settings and in the character window
  and go after a save there; settings and the cast are reloaded after each model load and each turn or Scribe answer;
  an open character window takes new warnings without losing its typed values.
- No test reaches the network or `local/`; every server a test builds keeps the fake catalog
  (`tests/support/createFakeModelCatalog.mjs`).
