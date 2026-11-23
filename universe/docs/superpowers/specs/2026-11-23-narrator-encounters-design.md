# Narrator and encounters

Status: draft for operator approval.

## Why

- Aspect: Vocalia 1.0.4 moves group members in and out of a scene from words in the player's own messages. Its user-message classifier marks an absent member present when the name appears within nine words of call, get, bring, fetch, wave and similar verbs, when the player greets them by name, or near meeting words. "...need to get some new vegetables to Viola" pulled Viola into a bedroom scene on 2026-11-22 and again on 2026-11-23; "Hi Gargoyle" would pull in a member named Gargoyle. No setting turns this off.
- Deleting a reply and pressing Regenerate in a group makes SillyTavern pick a random enabled member (`group-chats.js:1029`, MANUAL activation with no user input), ignoring Vocalia's presence. Absent Viola and absent Collette replied this way.
- The operator wants what Zeta did well, random encounters and conflict that drive the story, with entrances that happen only by dice or by the operator's own narration.

## Operator decisions (2026-11-23)

1. A character enters a scene in two ways only: a dice-rolled encounter, or the operator writing them in.
2. Walk-ons by default: someone who enters exists until the scene ends for them, either narrated by the AI or written by the operator ("And Tom ran off as fast as he could").
3. A global Narrator: a voice that describes the scene and is never one of the people in it; present and omniscient.
4. The narrator speaks only when something happens, or when the operator writes a message starting with `Narrator:` (for example `*Narrator: and they reach the market square...*`).
5. Encounters both ways: an automatic chance on each player message, lower but never zero in private scenes such as in bed or at home; and an Encounter button.
6. An encounter brings either a known cast member who is not in the scene or a stranger, whichever makes sense ("Frost and Lize could be in bed, but Collette decides to barge in").
7. Build approach: rely on Vocalia with minimal changes; the new parts are Universe's own extension. The operator does not want to take over someone else's work.
8. When the operator writes someone in or out in a plain message ("Collette walks in", "Lize heads home", "Tom, the village drunk, approaches"), the replying character marks it in its routing fields (`arriving=`, `participationNextTurn=departing`, `remote=`) because it read the message. Vocalia keeps honouring those fields from every reply. To stop characters inventing arrivals, Vocalia's editable arrival-rules prompt text (a setting, not code) becomes: mark only arrivals, exits and contacts that the player's latest message or the narrator wrote; never invent one. The extension sets this text when it is enabled, if the text is still Vocalia's default; the operator can still edit it. A model can still occasionally invent an arrival, which the operator fixes in Vocalia's Status panel.

## Goals, non-goals, anti-goals

- Goals: the decisions above; the Regenerate fix; nobody enters or leaves because of a name in passing.
- Non-goals: story memory (relationships, quests, keeping lorebooks current; project 2, designed separately); stripping other characters' thoughts; any change to Tavern Scenario Builder.
- Anti-goals: the narrator speaking or acting for Frost or for a cast member; a model call on every message; changing more of Vocalia than this document lists.

## Approaches considered

1. **Chosen:** two small, optional settings added to Vocalia, plus a new Universe extension for everything new. Universe still depends on Vocalia's behaviour, and a Vocalia update means redoing the two settings.
2. Taking Vocalia over as Universe code: most control, but Universe would own 11,500 lines written by someone else and lose the author's updates. Rejected by the operator.
3. Replacing Vocalia with a Universe scene manager: the cleanest fit, but it rebuilds who-saw-what memory, structured replies and rendering that already work. The biggest build.

## Part A: the Vocalia settings

Universe bundles Vocalia from `packages/st-aspect-vocalia-1.0.4.tgz`, and the build copies it into SillyTavern. The package and the lockfile stay exactly as they are. While copying, the build applies the two changes below as exact, anchored text replacements, and fails the build if Vocalia's text does not match (any version other than 1.0.4). The change list is kept in `docs/vocalia-changes.md` so the operator can offer it to the author. (My call: agents cannot run npm, and this keeps the author's package untouched.)

1. `presenceFromUserMessages` (default `true`). When `false`, a player message never changes anyone's presence: the summon, remote-contact and departure classifiers are not applied to user messages (today's call sites near `index.js` lines 3166, 3356, 7135, 7681 and 7805). Witness tagging and everything else stay as they are. Entrances, exits and phone contact then come only from replies' routing fields (decision 8).
2. `manualOnlyMembers` (default empty), a list of avatars that automatic turn flow never picks: not as opening speaker, not as fallback, not as continuation, not through another reply's `speakingTo`. They speak only through `/trigger`. Their replies are parsed and routed like anyone's, so a manual-only member's `arriving=` takes effect. A manual-only member's reply may also carry `leaving=ExactName`, which marks that member absent.

Universe sets `presenceFromUserMessages` to `false` and lists the Narrator in `manualOnlyMembers`.

## Part B: the Narrator

- A character card named Narrator, added to the group, always present and omniscient in Vocalia, and manual-only. The extension offers **Add narrator to this group**, which creates the card if it does not exist, adds it, and sets those three flags. Vocalia keeps presence and omniscience per chat (`chat_metadata.aspect_vocalia`) and has no "always present" flag, so the extension sets the narrator present and omniscient whenever a chat of that group opens.
- The narrator writes every Vocalia parameter (`speakingTo`, `participationNextTurn`, `arriving`, `remote`), because a block missing one is malformed and its `arriving=` is refused. It never writes `participationNextTurn=departing`. `enter=` and `leave=` are one key each, with several names joined by `|`.
- When no group member other than the narrator is present (Frost alone), the narrator answers every player message. (My call: otherwise nothing would reply.)
- Card text, in substance: you are the narrative voice of this story. You describe places, weather, crowds, consequences and the people who are not group members. You are never a person in the scene. You never speak, act or think for Frost (the player) or for any group member. A walk-on's words go inside your narration, never in `[dialogue]`.
- Walk-ons are not group members. The narrator plays them inside its narration and records them in its parameters with `enter=Name` and `leave=Name`, which Vocalia ignores and the extension reads. The list of current walk-ons lives in `chat_metadata.universe_narrator.walkOns` and is shown only to the narrator, so a walk-on who left in the operator's own message does no harm: the narrator reads the history and closes them with `leave=` when it next speaks.

## Part C: the Universe extension (`universe/extension/universe-narrator/`)

The build copies it into SillyTavern's third-party extensions folder, as for the reply-retry extension.

1. **`Narrator:` messages.** A player message whose text, after leading `*`, `_` and spaces, starts with `Narrator:` triggers the narrator with the hidden instruction to write the scene the player directs. The player's message stays in the chat. The narrator's reply comes before any character reply to that message. The characters then react through Vocalia's normal turn flow. A `Narrator:` message never rolls for an encounter. Vocalia's automatic flow starts from the same `MESSAGE_SENT` event and `/trigger` waits only 10 seconds for a running generation, so the builder must show that the narrator goes first without a further Vocalia change; if it cannot, the builder stops and reports back, and any further Vocalia change needs the operator's approval.
2. **Automatic encounters.** Every other player message rolls. The chance depends on the scene tag of the latest reply: public 1 in 8, private 1 in 30, untagged as public. Both numbers can be changed per chat and are stored in `chat_metadata.universe_narrator`. On a hit, a quiet background prompt (no chat message) asks whether an interruption is plausible in the current scene. Only on yes does the narrator speak, before the characters reply.
3. **The Encounter button**, beside the message box, works like Send with a forced hit and no plausibility check. Text in the box is sent as the player's message; with an empty box it posts `*(Encounter)*` as the player's message. Either way it is a new player turn, so the characters react to the encounter as to any player message. (My call: Vocalia's per-turn limits reset only on a player message.)
4. **What an encounter brings.** One roll in three is a known face: a group member who is absent and not manual-only. The narrator picks whoever plausibly fits the place, and when nobody fits, a stranger comes instead. Otherwise a stranger who fits the place. The stance is rolled separately: enemy, friendly or chatter, one third each. The narrator receives these as a hidden instruction. A known face enters through `arriving=`, a stranger through `enter=`.
5. **Scene tag.** The extension adds its own prompt line asking every reply to end its `[parameters]` with `scene=private` or `scene=public`. Vocalia 1.0.4 already accepts unknown parameter keys without marking the block malformed (`index.js` near line 3850). A `Narrator:` message that names a place sets the tag through the narrator's reply.
6. **Regenerate.** In a group with Vocalia active, Regenerate never picks at random. When a reply is the last message, the reply is regenerated by the same speaker. When the player's message is last (a reply was deleted), the extension triggers the character who last spoke and is still present, or the narrator if the last reply was the narrator's. This covers every entry point: the menu item, Ctrl+Enter and `/regenerate`; all of them reach `GROUP_MEMBER_DRAFTED` and the generate interceptor, which can abort a wrong pick. If this cannot be done from outside Vocalia, the builder stops and reports back; another Vocalia change needs the operator's approval.

**Keep a walk-on** moves to project 2 (my call): turning Tom into a lasting character needs a model-written card and Vocalia state in every chat of the group, and it belongs with lasting cast and story memory.

## Limits

- The narrator and the plausibility check are model calls: one small background call per automatic hit, one reply per encounter or `Narrator:` message. At 1 in 8 that is about one extra reply every eight messages in public scenes.
- Scene tags come from the model and can be wrong. A wrong tag only shifts the odds.
- Arrivals and exits written in plain messages depend on the model reading them (decision 8); a missed or invented one is fixed in Vocalia's Status panel.
- A Vocalia update from the author means re-applying Part A to the new version.

## Order

Built after sync rewrite Task 3 (which rewrites `scripts/build.mjs`) and after the reply-retry task, which adds the build step that copies Universe's own extensions into SillyTavern.

## Left to the builder

The exact card text within Part B's substance; how the extension triggers and orders the narrator's reply before Vocalia's turn flow; the extension's settings layout; the test approach for browser-side code.
