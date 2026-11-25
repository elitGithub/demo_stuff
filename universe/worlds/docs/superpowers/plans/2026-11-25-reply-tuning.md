# Reply Tuning, Project 1 Implementation Plan

> **For agentic workers:** executed by the workspace loop in `/var/www/demo_stuff/CLAUDE.md` (one task at a time:
> implementer subagent, adversarial Opus review, orchestrator checks, hand-off, the operator commits). Steps use
> checkbox (`- [ ]`) syntax. Code first, then tests that try to break it (no TDD, workspace law).

**Goal:** Replace the Director -> parallel Minds -> Composer turn with Director -> optional Narrator -> character
brains replying one after another, every request a budgeted, selected, tagged slice.

**Architecture:** Pure request-building modules (budget, story slice, history window, tag reading) feed three call
modules (Director, Narrator, CharacterBrain); `TurnEngine` sequences them, keeps the lock, abort and single-commit
rules, and stores each box as a beat. Storage gains a versioned upgrade path, a character card, measured
characters-per-token and new settings; the book gains the player-stated and fixed-value rules.

**Tech Stack:** Node 24 (`node:sqlite`, `node:http`, `node:test`, native `fetch`), vanilla ESM browser code, no new
dependencies.

**Spec:** `universe/worlds/docs/superpowers/specs/2026-11-25-reply-tuning-design.md` (approved 2026-11-25). Read it
before any task; this plan only fixes names, files, values and tests.

## Global Constraints

- Workspace laws in `/var/www/demo_stuff/CLAUDE.md` apply in full: tag-only JSDoc (`@param`, `@returns`,
  `@throws` on every uncaught path) on every function, method and test helper; no prose comments; braces always; no
  single-letter or throwaway names; no magic strings; one declaration per file; enums with `label()`; no private
  method with one caller; no single-use wrappers; no swallowed errors; no defensive `?.`/`??` on guaranteed values;
  no inline styles or raw colours; no emojis; phone-first; every round-trip shows a loading state. Small anonymous
  callbacks written inline as option properties need no docblock.
- File changes only with Edit/Write. Git read-only. No dependency changes. No file deleted without the operator's go
  for that path (deletions are listed in Task 7). Never read `.env`, `local/`, credentials. Never start the real
  server. Never run the seeder except `--dry-run`.
- Node only under limits, one test file at a time, from `universe/worlds`:
  `NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 120 node --test tests/<file>.test.mjs`
- Output formats are the operator's (tags as in the spec); no JSON output format anywhere new.
- Values from the spec: `replyReserve` 3000 tokens, every stage; `maxRepliesPerCharacter` default 1 (tentative);
  Scribe interval default 1; starting `charsPerToken` 3; history windows main 25, recurring 12, Director 8, Narrator
  25 (current scene); the Director roster summary 220 characters.
- Stored names stay: spend stages `mind` and `composer`, settings slot `composer`. Labels: `mind` -> "Brain",
  `composer` -> "Narrator", Settings slot -> "Narrator model".
- Each task ends commit-ready with every one of the 10 test files passing.

## Review Focus

1. A campaign whose scene holds hundreds of imported turns (Hero Gone): no request may exceed `contextLength -
   3000`; the oldest turns drop whole. Owned by Task 4 and Task 7.
2. A brain or Narrator reply with no tags at all, or tags in the wrong order, or a `<reply>` split across stream
   chunks: the turn commits, nothing leaks from `<thoughts>` into the box. Owned by Task 6.
3. An arriving character: its request never contains the player's line that came before its arrival. Owned by
   Task 7.
4. Opening an existing database created before this plan (version 0, rows present): every row survives, `card_json`
   is filled, a second start does nothing. Owned by Task 1.
5. Saving a card after the story changed an appearance value: the story's value stays in force. Owned by Task 2.

---

### Task 1: Schema upgrades, card storage, measured characters-per-token, new settings

**Files:**
- Modify: `src/store/schema.sql`, `src/store/SqliteStore.mjs`, `src/openrouter/OpenRouterClient.mjs`,
  `src/store/enums/SpendStage.mjs`, `src/http/Router.mjs` (settings validation only), `scripts/seed-from-export.mjs`
- Create: `src/store/CharacterCard.mjs`, `src/store/SchemaUpgrades.mjs`
- Test: `tests/store.test.mjs`, `tests/openrouter.test.mjs`, `tests/http.test.mjs`, `tests/seed.test.mjs`

**Interfaces:**
- Produces:
  - `class CharacterCard` (readonly, frozen): string fields `age, hair, eyes, height, body, face, features, traits,
    habits, behavior, likes, dislikes, sexualityOrientation, sexualityKinks, sexualityLikes, sexualityDislikes,
    speakingStyle, speakingQuirks, personalitySummary, scenario, characterNote`, `speechExamples: readonly string[]`,
    `filedFactIds: Readonly<Record<string, string>>` (keys are appearance field names). Static
    `CharacterCard.AppearanceFields` (frozen list `age, hair, eyes, height, body, face, features`),
    `CharacterCard.empty(): CharacterCard`, `CharacterCard.fromObject(value: unknown): CharacterCard` (throws
    `TypeError` naming the field on a non-string field or a non-array `speechExamples`), `toObject(): object`.
  - `SchemaUpgrades.Latest` (integer, 1) and `SchemaUpgrades.steps`: frozen list of `{version: number, apply(db):
    void}`.
  - Character rows carry `card: CharacterCard`; `createCharacter`/`updateCharacter` accept `card` (object or
    `CharacterCard`) and no longer accept `persona` or `voiceNotes`.
  - `store.recordSpend(dto)` accepts `promptChars` (non-negative integer or null).
  - `store.lowestCharsPerToken(model: string): number | null` and `store.lowestCharsPerTokenOverall(): number | null`.
  - Settings gain `maxRepliesPerCharacter` (default 1) and `replyReserve` (default 3000); `scribeInterval` default 1.

- [ ] **Step 1: Upgrade runner.** In the `SqliteStore` constructor, before running `schema.sql`, read
  `PRAGMA user_version` and whether table `characters` exists. Run `schema.sql`. When `characters` existed, apply
  every `SchemaUpgrades.steps` entry with `version > user_version` in one transaction; then set
  `PRAGMA user_version = SchemaUpgrades.Latest`. A fresh database (no `characters` before) only gets the version
  set. `schema.sql` describes the newest shape (with `card_json` and `prompt_chars`) and does not set the version.
- [ ] **Step 2: Upgrade 1.** `ALTER TABLE characters ADD COLUMN card_json TEXT NOT NULL DEFAULT '{}'`; then for
  every row `card_json = CharacterCard` with `personalitySummary = persona`, `speakingStyle = voice_notes`;
  `ALTER TABLE spend_log ADD COLUMN prompt_chars INTEGER`. `persona` and `voice_notes` stay, unread.
- [ ] **Step 3: Card on character rows.** Read and write `card_json` through `CharacterCard`; drop `persona` and
  `voiceNotes` from the DTO, the allowed patch keys and the returned row. Seeder writes `card: CharacterCard.empty()`
  and no persona (its persona-from-facts code goes; the facts are in the book).
- [ ] **Step 4: Spend characters.** `OpenRouterClient` passes `promptChars` = sum of `content.length` over the
  request messages to `onSpend` (complete and stream, including the stream-failure path with usage);
  `recordSpend` stores it. `lowestCharsPerToken(model)` = `MIN(prompt_chars * 1.0 / prompt_tokens)` over rows of
  that model with `prompt_chars IS NOT NULL AND prompt_tokens > 0`, else `null`; the overall variant ignores model.
- [ ] **Step 5: Settings and labels.** `getSettings`/`updateSettings` handle `maxRepliesPerCharacter` and
  `replyReserve` (integers >= 1, `RangeError` otherwise); `scribeInterval` default 1 in `getSettings` and in
  `schema.sql` (`campaigns.scribe_interval DEFAULT 1`); Router settings validation accepts the two new keys.
  `SpendStage.label('mind')` returns `'Brain'`, `label('composer')` returns `'Narrator'`.
- [ ] **Step 6: Tests (try to break it).**
  - `store.test.mjs` "upgrades a version-0 database and keeps every row": build a temporary database file with
    HEAD's old `characters` and `spend_log` definitions (copied into a test fixture constant) and two characters
    with persona and voice notes; open `SqliteStore`; assert `user_version === 1`, both rows present, card
    `personalitySummary`/`speakingStyle` equal the old values, `prompt_chars` column exists; close and reopen:
    nothing changes, no error.
  - "a fresh database starts at the latest version"; "CharacterCard.fromObject refuses a number in hair and a
    string speechExamples" (`TypeError`, message names the field); "updateCharacter refuses persona" (old key
    rejected).
  - "lowestCharsPerToken returns the minimum ratio and ignores rows without prompt_chars or with zero tokens"
    (rows 4000/1000, 3000/1000, null/500, 100/0 -> 3).
  - `openrouter.test.mjs`: `onSpend` receives `promptChars` equal to the summed message lengths for complete,
    stream, and stream failure after usage.
  - `http.test.mjs`: settings PUT accepts `maxRepliesPerCharacter: 2`, `replyReserve: 3000`; refuses `0`, `1.5`,
    `'3'`; GET shows `scribeInterval: 1` on a fresh store.
  - `seed.test.mjs`: seeded characters have an empty card; `--dry-run` counts unchanged.
- [ ] **Step 7: Run** every test file, one at a time, with the limited command. Expected: all pass.

### Task 2: Character card end to end, appearance filed into the book

**Files:**
- Modify: `src/http/Router.mjs` (character routes, `#syncCharacterInBook`), `src/scribe/ScribeService.mjs`,
  `public/components/CharacterModal.mjs`, `public/styles.css`, `public/api.mjs` (if payload helpers name fields)
- Create: `src/scribe/CardFiling.mjs`
- Test: `tests/http.test.mjs`, `tests/scribe.test.mjs`, `tests/ui.test.mjs`

**Interfaces:**
- Consumes: `CharacterCard` (Task 1).
- Produces:
  - `CardFiling.operations({state, subjectId, before: CharacterCard, after: CharacterCard}): {operations:
    readonly object[], filedFactIds: Readonly<Record<string, string>>}`: Scribe log operations for each appearance
    field whose value changed. Mapping: `age`->`age`, `hair`->`hair`, `eyes`->`eyes`, `height`+`body` -> one `build`
    fact text `{height}; {body}` (either changed refiles it; an empty part is left out with its separator),
    `face`->`appearance`, `features`->`feature`. Fixed slots: `AddFact` (origin Operator) then `EditFact` on the new
    fact so it is decided. List slots: `RemoveFact` on `before.filedFactIds[field]` when present, then `AddFact`. A
    field changed to empty files nothing and only removes its remembered list fact.
  - `ScribeService.fileCardAppearance({campaignId, characterId, before: CharacterCard, after: CharacterCard}):
    CharacterCard` (returns the card with updated `filedFactIds`); creates an empty book first when the campaign has
    none.
  - Character API payload: `card` object replaces `persona`/`voiceNotes`; responses include `card` and
    `bookAppearance: Record<string, string>` (the book's current in-force text per appearance field, for the hint).

- [ ] **Step 1: Server.** Router POST/PATCH accept `card`, validated with `CharacterCard.fromObject` (400 with the
  field name on failure); inside the existing transaction call `fileCardAppearance` after the character write and
  persist the returned card. Remove the early return for a missing book in this path.
- [ ] **Step 2: Window.** `CharacterModal` sections, in order, each a collapsible group: Basics (existing name, slug,
  aliases, tier, player, model override, avatar), Appearance (7 fields; under each, read-only "In the book now:
  {text}" when `bookAppearance[field]` differs from the card), Personality (`personalitySummary, traits, habits,
  behavior, likes, dislikes`), Intimacy (4 sexuality fields), Voice (`speakingStyle, speakingQuirks`,
  `speechExamples` as an add/remove list), Role and portrayal (`scenario`, `characterNote`). Labels from Tavern
  Scenario Builder's field names in plain words. Stable element IDs for every field and button. Name stays the only
  required field. Save rightmost, Cancel left, loading state on Save.
- [ ] **Step 3: Tests (try to break it).**
  - `scribe.test.mjs` "card filing": a first save files 7 appearance values (build combined); a second save with
    only `hair` changed files only hair and the old hair becomes `Reported`; a later save with nothing changed after
    the story filed a new hair keeps the story's hair in force; `features` changed twice leaves exactly one
    card-filed feature fact and keeps a story-added feature; empty `body` with a set `height` files `{height}`.
  - `http.test.mjs`: create on a campaign with no book creates the book and files the facts; `card.hair: 5` -> 400
    naming `hair`; `persona` key -> 400.
  - `ui.test.mjs`: the window renders all fields, shows the "In the book now" hint only when different, adds and
    removes a speech example, submits `card` with every field; focus survives a catalog update on a card field.
- [ ] **Step 4: Run** every test file, one at a time. Expected: all pass.

### Task 3: Book rules for player-stated changes and model-written fixed values

**Files:**
- Modify: `src/scribe/ScribeReplay.mjs` (`file` ~505-560, decided pass ~1400-1427), `src/scribe/ScribeIntakeAdapter.mjs`
  (message shape), `src/scribe/ScribeService.mjs` (pass message roles to replay)
- Test: `tests/scribe.test.mjs`, `tests/seed.test.mjs` (real-export check unchanged)

**Interfaces:**
- Consumes: messages from `ScribeIntakeAdapter.fromTurns` already carry `role` (`TurnRole`, line ~185).
- Produces: replay rules only; no new public names.

- [ ] **Step 1: Player-stated is decided.** In replay, a Story fact whose every cited message position belongs to a
  message with `role === TurnRole.User`, with `evidence.attribution === 'witnessed'`, in a fixed or moving
  category, joins `book.decided` so the existing decided pass replaces the live value (old -> `Reported`).
- [ ] **Step 2: Model-written fixed second value is Reported.** In `file`, a Story fact in a fixed category, not
  decided, not player-stated, whose fixed slot (`ScribeReplay.keys(fact, Fixed)[0]`) already holds a live in-force
  fact, is filed `Reported` (kept, not entered).
- [ ] **Step 3: Scribe interval default** is already 1 (Task 1); nothing here.
- [ ] **Step 4: Tests (try to break it)** in `scribe.test.mjs`:
  - player narration "Lize's hair is dyed black" (user turn, witnessed, hair) replaces red; requests' source
    (`characterKnowledgePacket`) shows black only;
  - player dialogue claim about eyes (attribution `claimed`) stays `Reported`, old eyes stay in force;
  - a character reply stating different hair: new fact `Reported`, red stays in force;
  - a model-written moving change (location) still enters in force (unchanged behaviour);
  - "you are now called Bubba" files an alias only; subject label unchanged;
  - withdraw of the player's turn restores red in force (replay is pure).
  - `seed.test.mjs` real-export dry-run counts and the 0-mismatch audience check stay as they are.
- [ ] **Step 5: Run** every test file, one at a time. Expected: all pass.

### Task 4: Request assembly modules (budget, story slice, history window)

**Files:**
- Create: `src/engine/RequestBudget.mjs`, `src/engine/StorySlice.mjs`, `src/engine/HistoryWindow.mjs`
- Modify: `src/openrouter/ModelCatalog.mjs` (add `contextLength`), `src/engine/WitnessFilter.mjs` (only if
  `HistoryWindow` reuses it; no behaviour change)
- Test: `tests/engine.test.mjs` (new describe blocks), `tests/catalog.test.mjs`

**Interfaces:**
- Produces:
  - `modelCatalog.contextLength(modelId: string): number | null` (from the cached listed models; `null` when not
    listed or no length).
  - `RequestBudget.create({contextLength: number | null, replyReserve: number, charsPerToken: number}):
    Readonly<{limitTokens: number | null, estimate(text: string): number, fits(usedTokens: number, text: string):
    boolean}>` (`limitTokens` null means no token trimming, windows only). `RequestBudget.charsPerToken({store,
    model}): number`: `store.lowestCharsPerToken(model)`, else the overall value, else `RequestBudget.StartingCharsPerToken`
    (3).
  - `StorySlice.build({state, viewer: {subjectId: string | null, omniscient: boolean}, scene: {location, day,
    timeLabel, sceneType, situation}, presentSubjectIds: readonly string[], remoteSubjectIds: readonly string[],
    namedText: string, playerName: string | null, budget, usedTokens: number}): Readonly<{text: string, tokens:
    number}>`: the `<story_state>` block, sections in spec order 1-6, lines in the operator's compact format
    (`Location: ... | Time: Day n, label | public|private`, `Present: ...`, `Situation: ...`, one `- Name: state |
    Items: ... ` line per person, `Relations: ...`, `Open threads: ...`, `Known facts: ...`), stopping at the
    budget; `omniscient` selects all in-force non-hidden facts; otherwise only `ScribeKnowledge.knows`.
  - `HistoryWindow.build({turns, characterId: string | null, maxTurns: number, budget, usedTokens: number}):
    Readonly<{text: string, tokens: number, turnCount: number}>`: witnessed turns (all turns when `characterId` is
    null), newest first, whole turns only, oldest dropped first, rendered oldest first as `Speaker: text` lines;
    `mindPacket` never included.

- [ ] **Step 1: Implement** the three modules and `contextLength` with the signatures above. Selection order and
  in-section order (rulings and operator facts first, then newest) exactly as the spec's "Fact selection".
- [ ] **Step 2: Tests (try to break it).**
  - "never exceeds the budget": context 4000, reserve 3000, 3 chars/token, 300 turns of 900 characters: total
    estimated tokens of history plus slice <= 1000; the newest turn is present; no partial turn.
  - "null context length trims by windows only": 40 turns, `maxTurns` 25 -> exactly 25 newest.
  - "knows filter": a fact the viewer does not know never appears; hidden facts never appear for `omniscient`.
  - "section order": with a budget that fits only sections 1-3, sections 4-6 are absent and 1-3 complete.
  - "named subjects": a subject named by alias in `namedText` brings its facts in section 6; a subject not named,
    not present, does not appear.
  - "charsPerToken falls back": model rows -> model value; none -> overall; empty store -> 3.
  - `catalog.test.mjs`: `contextLength` for a listed model, `null` for an unlisted or unchecked one.
- [ ] **Step 3: Run** every test file, one at a time. Expected: all pass.

### Task 5: Director with tagged output, scene styles chosen

**Files:**
- Create: `src/engine/TagReader.mjs`, `src/store/enums/SceneStyle.mjs`
- Modify: `src/engine/Director.mjs`, `src/engine/TurnEngine.mjs` (Director call site only: budgeted recent turns,
  new plan fields passed through), `src/store/SqliteStore.mjs` and `src/http/Router.mjs` (the `sceneStyles` setting),
  `tests/engine.test.mjs`, `tests/http.test.mjs`, `tests/ui.test.mjs` (scripted Director replies become tags),
  `tests/store.test.mjs`
- Test: `tests/engine.test.mjs`, `tests/store.test.mjs`, `tests/http.test.mjs`

**Interfaces:**
- Produces:
  - `TagReader.read(text: string, tagName: string): ReadonlyArray<Readonly<{attributes: Readonly<Record<string,
    string>>, body: string}>>` (case-insensitive tag names, attribute values in double quotes, self-closing
    allowed, unclosed tag ignored) and `TagReader.outside(text: string, tagNames: readonly string[]): string` (text
    left after removing those tags and their bodies).
  - `Director.planTurn(options)` keeps its options plus `budget` and returns the same frozen `{plan, nextState,
    spendIds}` shape with: `plan.situation: string`, `plan.narratorDirective` (the `<narrator>` body, `''` when no
    tag), `plan.responders` from `<direction>` tags in order `{characterId, slug, name, beatGoal, length, reacting:
    string}` (`reacting` a slug or `'player'`), `plan.directorMissed: boolean`, `plan.style: string` (a
    `SceneStyle` value). `targetChars` is removed.
  - `SceneStyle` enum: `Explicit 'explicit'`, `Combat 'combat'`, `Tension 'tension'`, `Emotional 'emotional'`,
    `Banter 'banter'`, `Travel 'travel'`, `Investigation 'investigation'`, `None 'none'`, with `label()`.
  - Setting `sceneStyles: Record<string, string>` (every `SceneStyle` except `none`), defaults exactly the texts in
    the spec's "Addendum: scene styles"; `updateSettings` accepts a partial map of known names to strings
    (`RangeError`/`TypeError` otherwise) and merges it.

- [ ] **Step 1: Prompt and parsing.** Director system prompt asks for the spec's tag shape, keeps today's rules 1-9
  in plain words; user sections as today with the roster summary from `card.personalitySummary` (220 characters)
  and recent turns through `HistoryWindow` (`maxTurns` 8, `characterId` null). Each tag read independently with
  `TagReader`; every invariant in `Director.mjs` today stays applied to the parsed values. No repair retry.
  The prompt lists the scene style names with one line each and asks for `<style>{name}</style>`; an unknown or
  missing name gives `none`. Add the `SceneStyle` enum and the `sceneStyles` setting (store and Router PUT).
- [ ] **Step 2: Full miss.** No recognised tag: `nextState` equals the pre-state (scene number unchanged),
  responders = present non-player main and recurring characters in roster order with empty `beatGoal`, `length`
  `medium`, `reacting` `'player'`; `plan.style` = the pre-state's `style` (`none` when absent); `directorMissed`
  true.
- [ ] **Step 3: Keep the old pipeline working.** `TurnEngine` still runs Minds and the Composer from
  `plan.responders` and `plan.narratorDirective`; the scripted Director replies in engine, http and ui tests become
  tagged text with the same meaning; the Composer's `targetChars` line goes.
- [ ] **Step 4: Tests (try to break it).** `TagReader`: nested-looking text, attributes in single quotes ignored,
  unclosed tags, mixed case. Director: each invariant with a hostile tag value (unknown slug, player in
  `<direction>`, absent character as responder, day going back, empty location, `narrator_only` with directions,
  duplicate directions, `<remote>` overlapping `<present>`, `__proto__` in `<offscreen to>`); one broken tag leaves
  the others used; full miss fallback; Narrator mode forces no encounter; Encounter mode forces it. Styles:
  `<style>Combat</style>` (case) gives `combat`, `<style>dance</style>` gives `none`, two `<style>` tags take the
  first. Settings: `sceneStyles` defaults equal the spec texts exactly; a partial update merges; an unknown name or
  a non-string text is refused (store and HTTP).
- [ ] **Step 5: Run** every test file, one at a time. Expected: all pass.

### Task 6: Character brain, Narrator, reply stream splitter

**Files:**
- Create: `src/engine/CharacterBrain.mjs`, `src/engine/Narrator.mjs`, `src/engine/ReplyStreamSplitter.mjs`
- Test: `tests/engine.test.mjs`

**Interfaces:**
- Consumes: `TagReader` (Task 5), `StorySlice`, `HistoryWindow`, `RequestBudget` (Task 4), `CharacterCard` (Task 1).
- Produces:
  - `ReplyStreamSplitter` class: `constructor({visibleTag: string})`, `push(chunk: string): string` (returns newly
    visible text inside `visibleTag` only, buffering a partial tag across chunks), `finish(): Readonly<{visible:
    string, raw: string}>`.
  - `CharacterBrain.reply({campaign, character, card: CharacterCard, playerName: string, storyState: string,
    history: string, thisTurn: string, styleText: string, direction: {reacting: string, length: string, beatGoal:
    string}, model: string, replyReserve: number, client, signal, onDelta}): Promise<Readonly<{reply: string,
    thoughts: string,
    next: string | null, truncated: boolean, spendId: string | null}>>`. Streams with stage `SpendStage.Mind`,
    `maxTokens = replyReserve`. Prompt sections exactly as the spec's "Brain (system message)" and "Brain (user
    message)", empty card fields left out with their labels. Parsing per the spec: no `<reply>` -> outside text;
    no usable text -> `reply` `''`; `next` `null` when missing, `none`, or blank.
  - `Narrator.narrate({campaign, storyState, history, thisTurn, styleText: string, direction: string, model,
    replyReserve, client, signal, onDelta}): Promise<Readonly<{narration: string, truncated: boolean, spendId:
    string | null}>>`. Stage `SpendStage.Composer`; `<narration>` or the whole text.
  - Both put `<style>{styleText}</style>` directly above `<direction>` (after `<portrayal>` for the brain) when
    `styleText` is non-empty, and no block when it is `''`.

- [ ] **Step 1: Implement** the three modules with the signatures above; streamed deltas go through
  `ReplyStreamSplitter` so `onDelta` only ever receives box text.
- [ ] **Step 2: Tests (try to break it).** Splitter: `<rep` + `ly>Hi` + `</reply>` across chunks; thoughts before
  and after reply never emitted; a `</reply>` inside thoughts text; no tags at all (visible empty while streaming,
  `finish` returns raw for the outside-text rule). Brain: request contains no other character's thoughts (history
  input already stripped; assert the built messages); empty card fields produce no empty labels; `<next>none</next>`
  -> null; `maxTokens` 3000 sent; truncated passed through. Narrator: untagged reply becomes narration; hidden facts
  absent (slice built `omniscient`).
- [ ] **Step 3: Run** every test file, one at a time. Expected: all pass.

### Task 7: TurnEngine sequences the new turn; old modules removed

**Files:**
- Modify: `src/engine/TurnEngine.mjs`, `src/server.mjs` (inject `modelCatalog` into `TurnEngine`), `src/http/Router.mjs`
  (SSE phase names pass through; no other change), `tests/engine.test.mjs`, `tests/http.test.mjs`
- Delete (operator go per path required before this task is dispatched): `src/engine/CharacterMind.mjs`,
  `src/engine/NarratorComposer.mjs`, `src/engine/BeatParser.mjs`
- Test: `tests/engine.test.mjs`, `tests/http.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces:
  - `new TurnEngine({store, client, scribeService, pedantService, random, modelCatalog})` (`maxResponders` goes;
    `modelCatalog` must offer `contextLength`).
  - SSE: `phase {phase:'directing'}`, `phase {phase:'director_done', sceneState, plan}`, `phase
    {phase:'narrating'}`, `phase {phase:'replying', name, slug}`, `beat_delta {beatIndex, speakerType, slug,
    speakerName, delta}`, `committed`, `findings`, `warning {stage, message}`, `memory_updated`, `done`, `error` as
    today.
  - Beats: Narrator box `speakerType 'narrator'`, `speakerName 'Narrator'`; character box `speakerType 'character'`;
    `mindPacket` `{thoughts, next, direction}` on character boxes, `null` on the Narrator box.

- [ ] **Step 1: Sequence.** Encounter roll; Director (budgeted); Narrator box when `plan.narratorDirective` is
  non-empty or any non-player character arrives (`arrivingSet` as today), its `<direction>` holding the directive
  (default: describe the arrivals), the encounter brief, walk-ons entering and leaving and the player's OOC nudge;
  Narrator slice `omniscient`, history = current-scene turns through `HistoryWindow` (`characterId` null, `maxTurns`
  25); then the queue from `plan.responders`, each brain call built with `StorySlice`
  (viewer the character), `HistoryWindow` (25 main / 12 recurring) and `<this_turn>` = the player's line when the
  character witnessed it plus earlier boxes of this turn; after each box append `next` when present or remote, not
  the player, not queued, and under `settings.maxRepliesPerCharacter` for this turn. Budget per call:
  `RequestBudget.create({contextLength: modelCatalog.contextLength(model), replyReserve: settings.replyReserve,
  charsPerToken: RequestBudget.charsPerToken({store, model})})`; mandatory parts over the limit throw an `Error`
  naming character and model.
- [ ] **Step 2: Witnesses and storage.** Player beat witnesses as today; every box witnessed by all next
  participants; an arriving character's `<this_turn>` starts at the Narrator box. Remove the name-matching arrival
  block (`TurnEngine.mjs` ~807-863). Commit as today in one transaction, `truncated` = any box truncated.
- [ ] **Step 2b: Scene style.** Scene state gains `style` (a `SceneStyle` value, default `none`) and `pinnedStyle`
  (`null` or a `SceneStyle` value). The style in force = `pinnedStyle` when set, else `plan.style`; it is stored in
  `nextState.style` and its text (`settings.sceneStyles[style]`, `''` for `none`) goes to the Narrator and every
  brain as `styleText`. A scene change clears `pinnedStyle`. The campaign scene PATCH (Router, existing manual
  scene update) accepts `pinnedStyle` (`null` or a known name; 400 otherwise).
- [ ] **Step 3: Failures.** Director API error fails the turn (no database change). A Narrator or brain API error
  drops that box, emits `warning {stage: 'mind'|'composer', message}` naming the character, continues. An empty
  reply drops the box with a warning. Zero boxes: the turn fails with no database change. Abort as today.
- [ ] **Step 4: Remove** `CharacterMind.mjs`, `NarratorComposer.mjs`, `BeatParser.mjs` (after the operator's go)
  and every import and test of them.
- [ ] **Step 5: Tests (try to break it)** in `engine.test.mjs` (rewrite the Mind/Composer tests listed in the spec)
  and `http.test.mjs` (lifecycle and disconnect over SSE):
  - Hero-Gone-sized scene (300 imported turns of 900 characters), catalog context 131072: every recorded request
    under `131072 - 3000` estimated tokens.
  - Lize then Yumi: Yumi's request contains Lize's box from this turn; neither contains the other's thoughts.
  - Arrival: Maya arrives; Maya's request lacks the player's line and starts at the Narrator box.
  - Handoff: `<next>` naming an absent character, the player, a queued one, and one over the cap adds nothing;
    `maxRepliesPerCharacter` 2 lets a character answer twice.
  - Brain API error on the first of two responders: second box committed, `warning` emitted; both failing and no
    Narrator: no turn, no rows, scene state unchanged, spend rows kept unlinked.
  - Regenerate and delete restore scene state and withdraw book sources as today; edit picks a box.
  - Abort during the second brain: nothing committed.
  - Styles: Director `combat` puts the combat text in the Narrator's and both brains' requests; a pin `explicit`
    overrides a Director `banter`; a scene change clears the pin; `none` sends no `<style>` block; PATCH
    `pinnedStyle: 'dance'` -> 400.
- [ ] **Step 6: Run** every test file, one at a time. Expected: all pass.

### Task 8: Browser boxes, thoughts, phase labels, settings fields, README

**Files:**
- Modify: `public/components/ChatView.mjs`, `public/app.mjs`, `public/components/InspectorDrawer.mjs`,
  `public/styles.css`, `README.md`, `tests/ui.test.mjs`

**Interfaces:**
- Consumes: SSE and beat shapes from Task 7; settings keys from Task 1.

- [ ] **Step 1: Chat.** Each beat is its own box (existing rows); character boxes with a `mindPacket.thoughts` get
  a collapsed "Thoughts" toggle (button with `aria-expanded`, stable ID per beat) showing the text; streaming rows as
  today. Status labels: `directing` "Directing...", `narrating` "Narrating...", `replying` "{name} is replying...".
- [ ] **Step 2: Settings.** Slot label "Narrator model"; number inputs "Replies per character per turn"
  (`maxRepliesPerCharacter`, 1 to 5) and "Reply length cap (tokens)" (`replyReserve`, integer >= 1), with the
  existing save and warning flow. A "Scene styles" section with one textarea per style (label from `SceneStyle`),
  saved with the other settings.
- [ ] **Step 2b: Scene tab.** Shows the style in force; a select "Scene style: Automatic | Explicit | Combat |
  Tension | Emotional | Banter | Travel | Investigation" sets or clears `pinnedStyle` through the scene PATCH, with a
  loading state.
- [ ] **Step 3: README.** Turn description, card, budgets, the upgrade on first start ("starting the server
  upgrades `local/worlds.sqlite` once"), new settings, Scribe interval default 1.
- [ ] **Step 4: Tests (try to break it)** in `ui.test.mjs`: the end-to-end turn (server boot, tagged Director,
  Narrator, two brains) renders three boxes in order with the right speakers; the thoughts toggle opens and closes
  and its text never appears in the box; status labels follow the phases; settings refuse `0` and `6` and save `2`;
  a style text edit saves; the Scene tab pin sends `pinnedStyle` and "Automatic" sends `null`; the static audit
  test still passes.
- [ ] **Step 5: Run** every test file, one at a time. Expected: all pass.
