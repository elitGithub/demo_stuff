# Narrator and encounters plan

Design: `docs/superpowers/specs/2026-11-23-narrator-encounters-design.md` (approved 2026-11-23).

Operator rulings, 2026-11-23: design approved as it stands. Vocalia is extended by override, not patched rule by rule ("extend -> override what we need"): the build renames each overridden Vocalia function and appends Universe's versions under the original names. Built after sync Task 5 and the closed-terminal fix are committed.

## Conventions

- Those of `docs/superpowers/plans/2026-11-22-sync-rewrite.md`:
  - No dependency is added.
  - One exported declaration per file (a frozen object).
  - Tag-only docblocks on every function, method and named callback, tests included.
  - Braces always. No single-letter or throwaway names. No swallowed errors.
  - Code first, then tests that try to break it.
  - Each test file is run on its own with the sync plan's command.
  - No agent runs `npm start`, `npm ci` or `npm run build` against the project, touches `universe/local/`, reads `.env`, or contacts OpenRouter.
- Browser logic lives in pure modules that import nothing from SillyTavern and take what they need as arguments; Node tests import them directly. Each extension's `index.js` only wires SillyTavern to those modules. It is syntax-checked in Node and proven in the verification run below.
- Exception to one-declaration-per-file: `extension/vocalia-overrides.js` is a source fragment, not a module. It is appended to Vocalia's `index.js`, and its top-level function declarations must carry Vocalia's function names. Every override delegates its policy to `globalThis.universeNarrator`. Without that object, every override behaves exactly as Vocalia's own function.
- A third-party extension imports SillyTavern through `globalThis.SillyTavern.getContext()`, called fresh each time. Two things are not in the context and are imported from `../../../group-chats.js`: `editGroup`, and the live `is_group_generating`.
- Facts about Vocalia 1.0.4 and SillyTavern 1.19.1, with line numbers, are in the research notes kept with this plan's review package. Vocalia's text is the extracted `packages/st-aspect-vocalia-1.0.4.tgz`, read by the build. Line numbers below are Vocalia `index.js` 1.0.4.

## Values (`extension/universe-narrator/NarratorSettings.js`, one frozen object)

| Name | Value |
| --- | --- |
| `NarratorName` | `Narrator` |
| `PublicOdds` | 8 (one in 8) |
| `PrivateOdds` | 30 (one in 30) |
| `KnownFaceOdds` | 3 (one in 3) |
| `Stances` | `enemy`, `friendly`, `chatter` (one third each) |
| `EncounterText` | `*(Encounter)*` |
| `MetadataKey` | `universe_narrator` (chat metadata: `publicOdds`, `privateOdds`, `walkOns`) |
| `SettingsKey` | `universe_narrator` (extension settings: `narratorAvatar`) |
| `NarratorPrefix` | `/^[\s*_]*Narrator:/i` |
| `PromptKeys` | `universe_narrator_turn`, `universe_narrator_walkons`, `universe_scene_tag` |

Extension manifest: `display_name` `Universe: Narrator`, `loading_order` 2, `dependencies` `["third-party/st-aspect-vocalia"]`, `generate_interceptor` `universeNarratorGenerateInterceptor`, `js` `index.js`, `author` `Universe`, `version` `1.0.0`.

## Review Focus

1. The player mentions "the narrator" mid-sentence: the narrator must not speak. Only `NarratorPrefix` or an encounter puts it first. Owner: Task 1 (`findMentionedPresentMembers` override under the picking flag).
2. The narrator writes `leaving=Col` for Collette: nothing happens. `leaving=` takes exact names, case-insensitive, unlike Vocalia's substring match for `arriving=`. Owner: Task 1.
3. The narrator card is deleted, or the narrator is removed from the group: `isNarrator` is false for every member, every override behaves as Vocalia, and **Add narrator to this group** recreates the card and adds it again. Owner: Task 2.
4. The chat is switched with an encounter pending or a narrator instruction set: nothing carries over. Pending rolls, checks and prompts are cleared on `CHAT_CHANGED`. Owner: Task 3.
5. Regenerate when the last speaker has since left the scene: the latest earlier speaker who is still present replies. If there is none, the narrator replies when it is in the group. Otherwise SillyTavern's own pick stands. Owner: Task 4.

## Task 1: Vocalia overrides

Files:

- `extension/vocalia-overrides.js` (fragment). Overrides, under their Vocalia names:
  - `detectUserSummonBootstrap(text)` (2942). With `universeNarrator` present, it returns the base result with every target list emptied. This one override stops a player message from pulling members in, from making phone contact, and from tagging an absent member as a witness (6185).
  - `applyUserDepartureBootstrap(userMessageId, userText)` (2900). With `universeNarrator` present, it changes nothing and returns the base's empty-detection shape.
  - `selectFirstSpeakerForOpeningUserMessage(userMessageId)` (3329), `selectContinuationTargetsForUserMessage(userMessageId, state)` (7666) and `selectTargetsForLatestUnansweredUserMessageRecovery()` (3145). Each runs in this order:
    1. `universeNarrator.firstSpeaker(messageId)` returns an avatar: the result is that member alone, with reason `universe-narrator`, in the base's return shape (the recovery selector keeps its other fields).
    2. Otherwise the base runs with the module-level picking flag set, so the narrator is hidden.
    3. If the base returns no target and the narrator is the only route-eligible member, the result is the narrator, with reason `universe-narrator-alone`.
  - `getRouteEligibleMembersCompat()` (1867), `isMemberRouteEligibleCompat(member)` (1872) and `findMentionedPresentMembers(text)` (1804): while the picking flag is set, the base result without the narrator. Otherwise the base result unchanged, so owner checks (4770) and the no-responder check (6480) still see it.
  - `validTargetsFromBlock(block, ownerMember)` (4886): the base result without the narrator, always. A character addressing the narrator never triggers it.
  - `applyOwnerBlockToState(block, ownerMember, messageId, firstAssistantForUserMessage)` (5068): base first, then `universeNarrator.onReplyBlock(block, ownerMember.avatar, messageId)`. When the owner is the narrator and the block is not malformed, each name in `block.leaving` (split on `|`, exact name, case-insensitive) is set absent with Vocalia's `setPresence(avatar, MEMBER_STATUS_ABSENT)`. Unknown keys reach `block` raw (3873-3875).
  - The implementer reads `getWaitingForUserTarget` (7648), `getStoredSpeakingToTargetsFromLastSpeaker` (3111) and `findMostRecentRouteEligibleAssistantBefore` (3039). Each is overridden the same way only if it can return the narrator while the flag is set; the report says which.
- `docs/vocalia-changes.md`: every renamed function, what its override does, and how to re-check on a new Vocalia version.

Interfaces:

- Consumes `globalThis.universeNarrator`:
  - `firstSpeaker(userMessageId: number): ?string`;
  - `isNarrator(avatar: string): boolean`;
  - `onReplyBlock(block: object, ownerAvatar: string, messageId: number): void`.
- Produces the rename list used by Task 2's build step. Every overridden name is `function <name>(` in Vocalia and becomes `function vocaliaBase_<name>(`.

Tests that try to break it (`tests/vocalia-overrides.test.mjs`): the fragment runs as a script in a `node:vm` context whose globals are stub base functions and Vocalia helpers.

- Without `universeNarrator`, every override returns exactly what its base returns.
- With it:
  - the summon targets are empty;
  - departures change nothing;
  - `firstSpeaker` wins over the base in all three selectors;
  - each base rule that would pick the narrator is hidden from it:
    - the stored `speakingTo` rule,
    - the waiting-for-user rule,
    - the most recent assistant rule,
    - the last-speaker rule,
    - the random and first fallbacks,
    - a mid-sentence "narrator" mention;
  - the narrator alone is still picked;
  - owner eligibility outside picking still sees the narrator;
  - `validTargetsFromBlock` drops the narrator;
  - `leaving=Collette|Lize` sets both absent;
  - `leaving=Col` sets nothing;
  - a malformed block sets nothing;
  - `onReplyBlock` receives every block.

## Task 2: narrator member and the extension core

Files:

- `extension/universe-narrator/NarratorSettings.js`: the Values table.
- `extension/universe-narrator/NarratorTurn.js`, frozen:
  - `isNarratorMessage(text): boolean` (`NarratorPrefix`).
  - `firstSpeaker({text, narratorAvatar, encounter}): {avatar, instruction}|null`.
    - A narrator message gives the narrator with the instruction "The player directs the scene in their latest message, after `Narrator:`. Write that scene."
    - Otherwise `encounter` (Task 3; `null` in this task) decides.
    - With no narrator in the group, it returns `null`.
- `extension/universe-narrator/WalkOns.js`, frozen: `apply(walkOns: string[], {enter, leave}: object): string[]`. Names are split on `|` and trimmed. A name is added once. `leave` removes it, case-insensitive. Unknown names are ignored.
- `extension/universe-narrator/index.js`:
  - **Group check:** the narrator is the group member whose avatar equals the extension settings' `narratorAvatar`.
  - **Add narrator to this group** (in the extension's settings panel, group chats only):
    1. If the avatar is missing from the character list, it creates the card with `POST /api/characters/create`. The card has `ch_name` `Narrator`, the design's Part B card text, and an empty `first_mes`.
    2. It stores the returned avatar and calls `getCharacters()`.
    3. It pushes the avatar into the group's `members` and saves with `editGroup(groupId, true)`.
  - **On `CHAT_CHANGED` and `GROUP_UPDATED`**, registered with `eventSource.makeLast` so they run after Vocalia's state set-up, in a group holding the narrator:
    - the narrator's avatar goes into `present` and is removed from `remote`, `absent` and `pendingArrivals`;
    - `members[avatar].omniscience` becomes `true`;
    - `saveMetadata()`.
  - **Arrival rules:** when `extension_settings.aspect_vocalia.protocolInjectionOverrides.arrival_rules` is not a string, it is set to:
    ```
    Arrival rules:
    - Use arriving=ExactName only when the player's latest message or the narrator brought that member into the scene. Never invent an arrival.
    - Use participationNextTurn=departing only when the player's latest message or the narrator took you out of the scene.
    - Use remote=ExactName only for contact that the player's latest message or the narrator described.
    ```
    Then `saveSettingsDebounced()`.
  - **`globalThis.universeNarrator`:** `firstSpeaker` reads the user message text from `chat[messageId]`. A non-null decision sets the `universe_narrator_turn` prompt (`setExtensionPrompt`, IN_CHAT, depth 0, system role). Its filter passes only when `characters[getContext().characterId].avatar` is the narrator. The prompt is cleared on the narrator's next `MESSAGE_RECEIVED` and on `CHAT_CHANGED`.
  - **`onReplyBlock`:** from the narrator, it applies `enter`/`leave` to `chat_metadata.universe_narrator.walkOns` with `WalkOns.apply`, then saves.
  - **Prompts:**
    - `universe_narrator_walkons` (narrator-only filter) lists the current walk-ons.
    - `universe_scene_tag` (all members) asks every reply to end its `[parameters]` with `scene=private` or `scene=public`.
- `scripts/build.mjs`:
  - **Vocalia:** while copying it, for each name in Task 1's list, replace `function <name>(` with `function vocaliaBase_<name>(`. Each must occur exactly once, or the build fails naming the function and the Vocalia version. Then append `extension/vocalia-overrides.js`.
  - **The extension:** copy `extension/universe-narrator/` (an explicit file list) to the third-party folder, as for `universe-retry`.
  - **Signature:** the next version, with the previous one recognised as a build to replace.
- `tests/build.test.mjs`:
  - the built Vocalia contains each `vocaliaBase_` name once and the appended fragment;
  - the result parses as a module (`node --check` on a copy with an `.mjs` name);
  - a Vocalia text missing one function fails the build with its name;
  - the extension files are copied;
  - the previous signature is replaced.

Tests that try to break it:

- `tests/narrator-turn.test.mjs`:
  - `Narrator:` with leading `*`, `_` and spaces counts;
  - `narrator:` in lower case counts;
  - "the Narrator: said" mid-text does not count;
  - no narrator avatar gives `null`;
  - a narrator message never consults `encounter`.
- `tests/walk-ons.test.mjs`:
  - `enter=Tom|Old Mag` adds both;
  - a repeat adds nothing;
  - `leave=tom` removes Tom;
  - an empty or missing value changes nothing.

## Task 3: encounters and the Encounter button

Files:

- `extension/universe-narrator/EncounterRoll.js`, frozen:
  - `hit({sceneTag, publicOdds, privateOdds, random}): boolean`. Untagged counts as public.
  - `pick({absentNames, random}): {kind: 'known'|'stranger', stance: string}`. A known face comes one roll in `KnownFaceOdds`, and only when `absentNames` is not empty.
  - `instruction(pick, absentNames): string`:
    - known: "An encounter happens now. Bring in one of these absent members who plausibly fits this place: <names>. If none fits, bring in a stranger instead. Their stance is <stance>. A member enters with arriving=ExactName; a stranger with enter=Name."
    - stranger: "An encounter happens now. Bring in a stranger who fits this place. Their stance is <stance>. A stranger enters with enter=Name."
- `extension/universe-narrator/index.js` additions:
  - **After each reply's `MESSAGE_RECEIVED`:**
    1. Read that reply's `scene` from its block, through `onReplyBlock`.
    2. Roll `hit`.
    3. On a hit, start the plausibility check with `generateRaw`. Its prompt is the latest reply's text plus "Could an interruption plausibly happen in this scene right now? Answer yes or no." An answer starting with `yes` (case-insensitive) is a yes.
    4. A newer reply or `CHAT_CHANGED` discards the roll and ignores a running check's answer.
  - **`firstSpeaker` for a non-narrator message:**
    - With a pending hit whose check answered yes, the narrator comes first with `instruction(pick(...))`.
    - A check that has not answered yet counts as a miss.
    - The pending roll is consumed by that message either way.
  - **The Encounter button**, in `#rightSendForm` before `#send_but`:
    - It puts `EncounterText` in an empty `#send_textarea`, fires an `input` event, marks the next message as a forced encounter (no check), and clicks `#send_but`.
    - It is disabled while `is_group_generating`.
    - It is styled by the extension's stylesheet with SillyTavern's theme variables, keyboard-focusable, and hidden outside group chats that hold the narrator.
  - **Odds:** `publicOdds` and `privateOdds` are numbers in the chat metadata, edited in the extension's settings panel per chat. Defaults come from the Values table, and the settings panel validates whole numbers of 1 or more.

Tests that try to break it (`tests/encounter-roll.test.mjs`, with a scripted `random`):

- `hit` at the boundary of `1/8` and `1/30`;
- untagged uses public;
- `pick` with no absent names never gives known;
- the stance split covers all three;
- `instruction` contains every absent name and the stance;
- odds of 1 always hit.

## Task 4: Regenerate never picks at random

Files:

- `extension/universe-narrator/RandomPickGuard.js`, frozen:
  - `start(): {noteGenerationStarted(forceChid), noteWrapperStarted(type): boolean}`. `noteWrapperStarted` returns `true` for a wrapper run of type `normal` that no outer `GENERATION_STARTED` with a numeric `force_chid` preceded. Those are the menu Regenerate, Ctrl+Enter, `/regenerate` and an empty Send, which reach SillyTavern's random pick (`group-chats.js:1029-1030`).
  - `replacement({speakers, present, narratorAvatar}): ?string`:
    - `speakers` lists reply owners from newest to oldest, recorded before deletion, as Vocalia's `lastSpeakerAvatar` and the chat tail allow.
    - It returns the newest one still present.
    - Otherwise it returns the narrator when it is in the group, else `null`.
- `extension/universe-narrator/index.js` additions:
  - The guard listens to `GENERATION_STARTED` and `GROUP_WRAPPER_STARTED`.
  - `universeNarratorGenerateInterceptor(chat, contextSize, abort, type)` acts only when all of these hold:
    - the group's strategy is MANUAL;
    - Vocalia is enabled;
    - the guard flagged the run;
    - `replacement` is not `null`.
  - When it acts, it calls `abort(true)`. After `GROUP_WRAPPER_FINISHED` it runs `/trigger await=true <index>` for the replacement, using the member index, not the name.
  - The empty-Send case: the implementer first reads how Vocalia's empty-Send recovery (3145, enqueue at 7530) is reached. If Vocalia already handles an empty Send before SillyTavern's random pick, the guard leaves that path to Vocalia. The report states which.

Tests that try to break it (`tests/random-pick-guard.test.mjs`):

- `/trigger` order (`GENERATION_STARTED` with `force_chid` 3, then wrapper start): not flagged;
- `regenerateGroup` order (wrapper start only): flagged;
- `swipe`, `continue` and `quiet` types: never flagged;
- two runs back to back do not carry a flag over;
- `replacement` skips an absent newest speaker;
- `replacement` falls back to the narrator, then `null`.

## Verification (orchestrator, after Task 4)

Run a temporary copy of the built SillyTavern, never the project's launcher:

- `--dataRoot` set to a scratch folder;
- a group of three test characters plus the narrator;
- the model connection pointed at a local stub server that answers `/api/backends/chat-completions` upstream calls with scripted Vocalia-format replies.

Drive it in Chrome and check:

- "need to get vegetables to Viola" leaves absent Viola absent;
- `Narrator: they reach the market` gives the narrator first, then the character it addresses;
- a forced Encounter brings an arrival or a walk-on;
- deleting the last reply and pressing the menu's Regenerate makes the last present speaker reply;
- the narrator never answers a plain message while another member is present.

Then the operator plays a session and reports what feels wrong.
