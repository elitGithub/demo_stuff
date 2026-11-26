# Reply tuning, project 1: request assembly and the per-character turn

Status: approved by the operator (2026-11-25). Builder check done and folded in.

## Why

Today one turn sends large unselected blobs and hopes the model copes:

- The Composer gets every earlier turn of the current scene with no limit (`src/engine/TurnEngine.mjs:773`). On the
  imported Hero Gone campaign the first turn sent about 174,000 tokens to `sao10k/l3.1-euryale-70b` (131,072 maximum)
  and OpenRouter refused it (HTTP 400).
- Each Mind gets every fact its character knows, with no relevance filter (`src/scribe/ScribeService.mjs:179-183`;
  Frost knows 214).
- Minds run in parallel, so characters cannot react to one another inside a turn; the Composer then rewrites every
  Mind packet, private thoughts included, into one woven reply.
- A Director or Mind reply that misses its JSON format kills the whole turn after one repair retry
  ("CharacterMind (Collette) returned malformed JSON after repair retry").

Operator's intent (2026-11-25): stop sending a humongous blob; each request gets scene-relevant information, a fixed
protocol and a given amount of data; each character's reply is its own request to its own brain model, with its
info, personality, protocol, "respond as" and scene data. Main characters are to gain "a real brain" over projects
1 and 2. Research notes behind this design (SillyTavern, Vocalia, Tavern Scenario Builder):
`~/.claude/projects/-var-www-demo-stuff/sdd-snapshots/reply-tuning/research.md`.

## Project split (operator ruling)

1. **This design:** request assembly and the new turn.
2. Character brain: reused inner monologue as a budgeted summary of what the character feels, reflection ("dream")
   into beliefs at scene breaks, possibly a Thinker pass and mood meters, slow timed runs (every few hours) for
   characters not in the current scene.
3. Book pass by a bigger model at intervals, scene-scoped (a scene touching a plot thread updates that thread), and
   format-miss improvements (reformat retries).

## Operator decisions (2026-11-25)

1. Characters reply one after another, each in its own request. A later speaker sees the earlier replies of the same
   turn that it witnessed ("Viola responding to Collette's teasing").
2. Requests are written as XML-style tagged sections with compact lines (operator's `<story_state>` example).
3. Two memory levels: the compact state covers the current scene only; the book keeps the whole storyline.
4. Hybrid routing: the Director owns presence, arrivals, encounters and pacing, and tells each brain who it reacts
   to, what the beat should do and which data matters. Replies may hand the floor to someone present.
5. Narration is a Narrator request in Zeta's narrator voice: weather, time, light, where everyone is, scenery,
   visible actions. It leaves the player alone unless the action is obvious or small, or the player says they do it.
6. A character box holds speech in quotes and third-person actions in asterisks together
   (`"it's so warm here..." *picks a book up*`), never first-person self-narration.
7. Brain output: `<thoughts>` (private, viewable by the operator), `<reply>` (the box), `<next>` (who speaks next).
8. Director output: tags as well.
9. Character card: Tavern Scenario Builder's 23-field structure. Appearance on the card is the starting value; the
   story updates the book; every request reads the book's current value.
10. A change the player states directly (own message or `Narrator:` line: dyed hair, new name, eye colour for good,
    a scar, clothing) updates the book; the Scribe and the Pedant raise nothing about it.
11. A second value for a fixed attribute (kind, age, eyes, hair, build, skin) written only by a model is filed as
    `Reported`, not in force; requests keep the old value; the Pedant flags the reply as today.
12. At most 1 reply per character per turn, **tentative**: multi-character interaction is wanted and the cap is tuned
    in play. Every present main or recurring character has a slot; all walk-ons together count as one slot (the
    Narrator); not everyone has to reply, the Director picks.
13. Build approach A: replace the turn in place. The Mind becomes the brain, the Composer becomes the Narrator, the
    old Mind-to-Composer path goes. Deleting old files needs the operator's go per path at plan time.
14. The Scribe model is a Settings change, not part of this build.

## Goals, non-goals, anti-goals

- **Goals:** every request stays inside its model's context; each request carries a selected, budgeted slice in a
  fixed tagged layout; characters reply in sequence and react to each other; a format miss never kills a turn;
  private thoughts reach no other character; the card gives each character a real identity block; player-stated
  changes become book state.
- **Non-goals (projects 2 and 3):** reusing thoughts, reflection, Thinker, mood meters, timed runs, the book pass,
  reformat retries, tool-use memory, vector retrieval, prompt compression, regenerating a single box, AI-drafted
  cards.
- **Anti-goals:** pruning the book to fit a request (the book keeps everything; only the request slice is cut);
  sending any character's thoughts to another character or to the Narrator; JSON output formats; invented limits
  with no operator ruling or measurement behind them; breaking stored turns of existing campaigns.

## The new turn

Entry points are unchanged: `POST /turns`, `POST /turns/regenerate`, the per-campaign lock, abort on client
disconnect, nothing committed until the end, one transaction (`commitTurnPair`), spend rows linked at commit.

1. **Encounter roll:** unchanged (`EncounterRoller`).
2. **Director** (one call, tagged output, below). Emits `phase {phase:'directing'}` then
   `phase {phase:'director_done', sceneState, plan}` as today.
3. **Narrator box** (one call, streamed) when the Director wrote a `<narrator>` tag, or when anyone arrives this turn
   (then it is forced, directive defaulting to describing the arrival). Opens the turn, before any character box.
   It voices all walk-ons. Emits `phase {phase:'narrating'}`.
4. **Character boxes, one after another.** The queue starts as the Director's `<direction>` tags in order. For each:
   emit `phase {phase:'replying', name, slug}`, run the brain (streamed), add its box. After a box, its `<next>` name
   is appended to the queue when that character is present or remote, not the player, not already queued, and still
   has a slot under the per-character cap (setting `maxRepliesPerCharacter`, default 1). `<next>` naming the player,
   `none`, an absent name or a full cap adds nothing. The chain ends when the queue is empty.
5. **Commit**, then Pedant and Scribe triggers exactly as today.

`pacing narrator_only` means no character boxes. A turn commits when at least one box exists (Narrator or
character); with zero boxes it fails as today with no database change.

### Witnesses

- The player's beat: as today (pre-turn participants; the scene-change and cut-away rules unchanged).
- The Narrator box and every character box: all next participants (present and remote after the Director). An
  arriving character therefore sees the Narrator box that brings them in and every box after it, and never the
  player's line that preceded the arrival (today's invariant, now enforced by order instead of by matching names in
  prose; the name-matching block `TurnEngine.mjs:813-854` goes).
- Thoughts are stored with the box (`beats.mind_packet_json`) and stripped from every history as today
  (`WitnessFilter` 48-56). In this project nobody gets thoughts back, not even their author.

### Failures

- **Format misses never fail the turn:** see each output format below.
- **API failures** (after `RetryPolicy`): a failed Director call fails the turn as today. A failed Narrator or brain
  call drops that box, emits `warning {stage, message}` naming the character, and the chain continues.
- **Abort:** as today; nothing is committed, spend rows stay unlinked.

## Request budgets

For every call: `inputBudget = contextLength(model) - replyReserve(stage)`. `contextLength` comes from the OpenRouter
catalog the app already caches (`ModelCatalog`, `context_length`). The request also sends `max_tokens =
replyReserve(stage)` so a reply can never push past the window (the client supports `maxTokens`; no stage sends it
today). `replyReserve` is one setting, 3000 tokens for every stage (operator); the Director's `length` per direction
still steers how long a reply should be.

When the catalog has no context length for a model (not listed, or not checked since the last refresh), the call is
still sent, bounded by the history windows below without token trimming. Keeping configured models in the catalog is
the operator's setup, not a failure path in the code (operator ruling).

Token counts are estimated from characters: `tokens = ceil(chars / charsPerToken(model))`. `charsPerToken` is
measured: every call records the character count of everything it sends (all message contents) next to the prompt
tokens OpenRouter reports (new `spend_log.prompt_chars`). The ratio for a model is the **lowest** `prompt_chars /
prompt_tokens` seen in that model's rows, so the estimate is as conservative as the densest prompt measured, and
message framing is included because OpenRouter's count includes it. A model with no rows uses the lowest ratio over
all rows; with no rows at all, the starting value below.

Assembly order, stopping at the budget:

1. Mandatory parts (identity, reply rules, the player's line, this turn's earlier boxes, the Director's direction).
   If these alone exceed the budget the call fails with a clear error naming the character and model (no silent
   truncation of mandatory parts).
2. `<story_state>` sections in the order of the selection below.
3. History, newest first, never more than today's windows: 25 witnessed turns for a main character, 12 for a
   recurring one, 8 turns for the Director, the current scene's turns up to 25 for the Narrator. Whole turns only;
   the oldest that does not fit is dropped with everything older.

## Fact selection for `<story_state>`

Only facts the character knows (`ScribeKnowledge.knows`), in force, from the book. In order, until the budget is
used:

1. Scene line (place, day, time, public or private), present and remote people, the Director's one-line situation.
2. The character's own facts.
3. For each present or remote person: their current state as this character knows it (fixed attributes, status,
   location, role, condition, belongings, appearance, features).
4. Relations between this character and the people present.
5. Open threads visible to this character that touch this character or anyone present.
6. Facts about subjects named (label or alias) in this turn's text (player line and earlier boxes) or in the most
   recent witnessed turn.

Within a section: rulings and operator facts first, then newest first. Everything else the character knows is not
sent this call. The Narrator sees the same selection over all in-force facts that are not hidden, with "this
character" read as the people present. Hidden facts never reach the Narrator, because its prose is witnessed by
everyone present.

## Request layouts

Drafts; exact wording is tuned in play, the section order and tags are the design.

### Brain (system message, stable across the scene)

```
You are {name} in an ongoing adult fiction roleplay. You write only {name}'s own reply.

<campaign>
Premise: {campaign premise}
Style: {campaign style notes}
</campaign>

<identity>
Personality: {personality_summary}
Traits: {traits} | Habits: {habits} | Behaviour: {behavior}
Likes: {likes} | Dislikes: {dislikes}
Sexuality: {sexuality_orientation} | Kinks: {sexuality_kinks} | Likes: {sexuality_likes} | Dislikes: {sexuality_dislikes}
Speaking style: {speaking_style} | Quirks: {speaking_quirks}
Role in the story: {scenario}
</identity>

<voice_examples>
{each speech example on its own line}
</voice_examples>

<rules>
Write speech in "quotes" and {name}'s actions in third person between *asterisks*, together in one reply.
Never write first-person narration of your own actions.
Never speak, act or decide for {player} or for anyone else.
Know only what is in your story state and what you witnessed.
Answer in exactly this shape and nothing else:
<thoughts>what {name} privately thinks and feels now</thoughts>
<reply>the visible reply</reply>
<next>the name of who should answer you, or {player}, or none</next>
</rules>
```

Empty card fields are left out with their labels.

### Brain (user message, changes every call)

```
<story_state>...selected lines...</story_state>
<history>...witnessed turns, oldest first, "Speaker: text"...</history>
<this_turn>...player's line if witnessed, then earlier boxes of this turn...</this_turn>
<portrayal>{character_note}</portrayal>
<direction reacting="{name or player}" length="short|medium|long">{beat goal and data that matters}</direction>
```

An arriving character's `<this_turn>` starts at the Narrator box that brings them in.

### Narrator

System: `<campaign>` (premise and style notes, as for the brain), Zeta-style narrator rules (scene, weather, light,
sounds, where everyone is, visible actions, walk-on lines; never a cast member's choices; the player only when
obvious, small or stated by the player), and the shape `<narration>...</narration>`. User message: `<story_state>`
(all non-hidden facts, as above), `<history>` (current scene), `<this_turn>` (player's line), `<direction>` (the
Director's `<narrator>` text, arrivals, encounter brief, walk-ons entering and leaving, and the player's OOC nudge
when given).

The OOC nudge goes to the Director (as today) and the Narrator. Brains do not get it; the Director turns it into
their directions. Premise and style notes are mandatory parts of the brain and Narrator budgets.

### Director

Inputs as today (premise, pre-turn scene, roster, walk-ons, open threads, recent turns, encounter candidate, the
player's input and OOC nudge), with two changes: the roster summary is the card's `personality_summary` (220
characters, as today), and recent turns go through the token budget. Output:

```
<scene changed="yes|no">{place} | day {n} | {time label} | public|private</scene>
<situation>{one line}</situation>
<input>player|narrator</input>
<present>{slug}, {slug}</present>
<remote>{slug}</remote>
<offscreen to="{slug}">{note}</offscreen>
<walkons enter="{name}, {name}" leave="{name}"/>
<encounter accepted="yes|no">{brief}</encounter>
<pacing>intimate_deep|focused_one|group_banter|narrator_only</pacing>
<narrator>{what the narration should cover}</narrator>
<direction to="{slug}" reacting="{slug or player}" length="short|medium|long">{beat goal, data that matters}</direction>
```

Every tag is read on its own; a broken or unknown tag is dropped and the rest is used. All invariants
`Director.mjs` enforces today stay (known slugs, present and remote disjoint, day never goes back, walk-on resets,
player auto-insert, offscreen-note rules, encounter forcing by mode, responders present or remote and never the
player, `narrator_only` means no directions). `targetChars` goes. The JSON repair retry goes.

## Output parsing and misses

- **Brain:** `<thoughts>`, `<reply>`, `<next>` read independently. No `<reply>` tag: all text outside the other tags
  becomes the reply. No usable text: no box, `warning`, the chain continues. Missing `<thoughts>`: empty. Missing or
  unusable `<next>`: nothing added. Streaming shows only the `<reply>` text as it arrives (a stateful tag splitter,
  as `BeatParser` does for split tags today); thoughts appear when the box completes.
- **Narrator:** `<narration>` or, failing that, the whole text.
- **Director:** a full miss (no recognised tag): the scene stays as it was and every present non-player main or
  recurring character answers the player, in roster order, without directions.
- `finish_reason === 'length'` on any box sets the turn's `truncated` as today.

## Character card

Fields (Tavern Scenario Builder 1.1.0): `age, hair, eyes, height, body, face, features, traits, habits, behavior,
likes, dislikes, sexuality_orientation, sexuality_kinks, sexuality_likes, sexuality_dislikes, speaking_style,
speaking_quirks, personality_summary, scenario, character_note, speech_examples[]` plus the existing name, slug,
aliases, tier, player flag, model override and avatar. Stored as one `card_json` column validated by a readonly
`CharacterCard` DTO.

- **Appearance fields** are starting values, filed into the book for the character's subject as operator facts:
  `age` to `age`, `hair` to `hair`, `eyes` to `eyes` (fixed slots), `height` and `body` together as one `build` fact
  (`{height}; {body}`, fixed slot; the Scribe defines build as height and body shape), `face` to `appearance`,
  `features` to `feature` (list categories).
- On save, only fields whose value changed from the stored card are filed. For a fixed slot the new fact is filed as
  decided (operator ruling 2026-11-26, see "Addendum: decisions"): it replaces the live value, the old value becomes
  `Reported`. For a list category the
  card remembers which fact each field filed (`card_json` keeps the fact id per field) and the new fact replaces that
  one fact only, leaving story-added appearance and features alone. Unchanged fields are never re-filed, so a later
  save never overwrites what the story changed.
- A campaign with no book yet gets an empty one on the first card save, so the filing always lands
  (`#syncCharacterInBook` returns early today when no book exists, `Router.mjs:1488-1491`).
- Requests read appearance only from the book. The card window shows the book's current value under each
  appearance field when it differs.
- **Identity fields** go to the brain's `<identity>` and `<voice_examples>`; `character_note` goes to `<portrayal>`.
- **Window:** grouped sections (basics, appearance, personality, intimacy, voice, role and portrayal), phone-first,
  speech examples as an add-and-remove list. Name stays the only required field.

## Book rules for player-stated changes

- A fact cited to a player-authored turn (player beat or `Narrator:` turn) with attribution `witnessed` (narration
  and actions, about anyone) that sets a value in a fixed (kind, age, eyes, hair, build, skin) or moving (status,
  location, role) slot is filed as decided: it replaces the live value, the old one becomes `Reported`. The player
  character's dialogue ("your eyes are blue, right?") stays a claim, as today. List and passing categories (scar as
  feature, clothing as condition) are additive already.
- A player-stated new name ("you are now called Bubba") is filed as an alias, as today. The original name stays the
  subject's label and the cast name (operator ruling).
- The Scribe interval default becomes 1 (operator ruling), so a stated change reaches the book after the turn it was
  written in. Existing campaigns keep their stored interval until changed in their settings.
- A model-written second value for a fixed attribute is filed as `Reported`. Moving slots are unaffected (characters
  move and change roles in the story).
- The Pedant already ignores user turns (`PedantService.mjs:94-97`); it keeps flagging model replies that contradict
  the book.
- The book state is rebuilt from its log on every load, so these rules apply to every book, old entries included.
  The imported Hero Gone book is all operator facts, which the rules do not reclassify.

## Storage and upgrades

- **Schema upgrades:** the store gains numbered upgrades tracked with `PRAGMA user_version`, run at server start
  (and by the seeder, which opens the store). `schema.sql` describes the newest shape for fresh databases; the
  store sets the version after deciding fresh versus existing (plan Task 1). Upgrade 1: `characters.card_json TEXT NOT NULL DEFAULT '{}'` (filled from `persona` into
  `personality_summary` and `voice_notes` into `speaking_style`), `spend_log.prompt_chars INTEGER`. The old
  `persona` and `voice_notes` columns stay, unused. The operator runs the upgrade by starting the server; agents only
  run it on temporary test databases.
- **Stored names stay:** the spend stage values `mind` and `composer` and the settings slot key `composer` stay, so
  old rows and CHECK constraints stay valid. Labels change: stage `mind` shows as "Brain", `composer` as "Narrator",
  the Settings slot as "Narrator model".
- **Boxes are beats:** the Narrator box is a `narrator` beat, each character box a `character` beat;
  `mind_packet_json` holds `{thoughts, next, direction}`.
- **Settings:** `maxRepliesPerCharacter` (default 1, tentative), `replyReserve` (default 3000) and the default
  Scribe interval (now 1).

## Browser

- Each box streams in its own row as it arrives; status reads "Directing...", "Narrating...", "{name} is
  replying...".
- Each character box has a collapsed "Thoughts" toggle showing its stored thoughts.
- Settings: "Narrator model" label, replies per character per turn, reply reserve.
- Card window as above.
- Regenerate and Delete act on the whole turn; Edit picks a box, as today.

## Tests

Rewritten: the engine, http and ui tests that script Director JSON, parallel Minds and the Composer `[[BEAT]]`
stream (engine 671, 728, 833, 967, 1055, 1239, 1539, 1894, 2051, 2181, 2409, 2466; http 648, 1231, 1530, 1813; ui
1485). New, each trying to break its part:

- No request exceeds `contextLength - replyReserve` (fake catalog with a small context, a long scene).
- Fact selection order and cut-off; nothing the character does not know is sent.
- Sequence: a later box sees earlier boxes it witnessed; an arriving character never sees the player's line before
  its arrival; no thoughts in any request; handoff rules (absent, player, cap, duplicates).
- Director tag parsing with broken and missing tags, every carried-over invariant, full-miss fallback.
- Brain and Narrator misses; a failed brain call continues the chain; zero boxes fails with no database change.
- Upgrade 1 on a version-0 database file keeps every row and fills `card_json`.
- Card save files only changed appearance fields; a later unrelated save does not revert story changes.
- Player-stated (`witnessed`) fixed and moving changes replace; player dialogue stays a claim; model-written fixed
  second value becomes `Reported`; a stated new name becomes an alias only.
- A model with no catalog context length is still called, bounded by the history windows.

## Operator answers to the builder check (2026-11-25)

1. Unknown context length: no failure path; the operator keeps models set up; the call goes out bounded by the
   history windows.
2. Scribe interval default 1.
3. "Player stated" means `witnessed` facts from the player's own turns; dialogue stays a claim.
4. A stated new name is an alias; the original name stays under the hood.
5. Reply reserve 3000 tokens for every stage.
6. `charsPerToken` before any measurement: 3.

## Addendum: scene styles (operator, 2026-11-25)

The operator asked for style guidance per kind of scene ("on explicit scenes, have the model focus more on vivid
descriptions; in fighting scenes more advanced detailing") and approved these styles and texts:

| Style | Text |
|---|---|
| `explicit` | Match the tone and pace of the scene. Describe sexual activity in vivid, explicit detail: bodies, touch, taste, sound, breath, reactions. Build a hot scene loaded with sexual tension; let each beat escalate or linger instead of rushing to the end. Desire, hesitation and dominance follow who the character is. |
| `combat` | Write a fluent, exciting fight, blow by blow: footing, distance, weapons, injuries, shifts in momentum. Build every move on what you know about the character: skills, gear, wounds, build. Follow what the player declared, and never decide the outcome of the player's own action. Use short, punchy sentences at the peaks. |
| `tension` | Focus on a tense atmosphere: what is left unsaid, small sounds, glances, held breath, the sense that something is about to break. Slow the pace and hold back resolution. Characters guard their words and watch each other. |
| `emotional` | Focus on feelings and the space between people: vulnerability, warmth, regret, comfort. Show emotion through small gestures, silences and tone of voice rather than naming it. Let moments breathe; no jokes that break the mood unless that is who the character is. |
| `banter` | Light, quick, playful exchanges. Wit, teasing and personality over plot. Keep replies short and reactive, let characters bounce off each other, and keep descriptions brief. |
| `travel` | Bring the place to life: landscape, weather, smells, sounds, distance, and the people and creatures met on the way. Leave things for the player to notice and choose from. Keep the group's mood and fatigue present. |
| `investigation` | Focus on detail and clues: what can be seen, read, overheard or worked out. Characters reason aloud only from what they actually know and never reveal more than the scene supports. Leave the conclusions for the player to draw. |
| `none` | No style block; the campaign's style notes still apply. |

- **Who picks:** the Director, every turn, with a `<style>{name}</style>` tag; its prompt lists the names with a
  one-line meaning each. An unknown or missing name means `none`. On a Director full miss the previous style stays.
- **Pin:** the operator can pin a style for the current scene from the Scene tab ("Automatic" or one style). A pin
  overrides the Director and is cleared when the scene changes.
- **Texts:** the seven texts above are the defaults of a `sceneStyles` setting, editable in Settings; the list of
  names is fixed (an enum with `label()`).
- **Injection:** the chosen text goes into the Narrator's and every brain's user message as `<style>...</style>`,
  directly above `<direction>` (after `<portrayal>` for brains). It is a mandatory part of the budget. `none` sends
  no block.
- **Scene state** keeps `style` (the style in force this turn, shown in the Scene tab) and `pinnedStyle` (`null`
  when automatic).

## Addendum: decisions (operator, 2026-11-26)

The operator's word decides a fixed value: the card, and what the player states happened (rule 10). A model can
not change it without that basis; its second value stays `Reported` (rule 11).

- A card save files a changed fixed value (age, hair, eyes, build) as a decided operator fact, directly (no edit
  step: the book ignores an edit with unchanged text).
- When two decided values share a fixed or moving slot, the later decision wins; the older becomes `Reported`
  and stays readable as the earlier value ("originally red"). Later means later in the book's log (the entry that
  made the decision: the card save, the operator's edit, or, from Task 3, the story entry of the player's
  statement).
- Example: card hair red (in force); the player narrates "she dyed her hair black" (decided, later: black in force,
  red `Reported`); a reply mentions blonde hair (model, no basis: `Reported`); the operator then edits the card's
  hair (newest decision: in force).
- The card window keeps the card's own value and shows "In the book now: ..." under the field when the book
  differs.
- **Unknown values:** a card text value with no letter or digit ("?", "-", "...") is saved as `?` and filed into the
  book as `?`. Every model request shows a `?` value as `unknown` ("I think a LLM would react incorrect to it, so in
  the requests any "?" becomes "unknown""). Speech examples are kept as written.
- A card change to a list field replaces the card's own fact even after the story refined it (operator: "card
  changes to explain").

## Later (not this project)

- Styles the operator defines (names beyond the fixed list).

- The player can speak as any character (as in Zeta).

- Short book data (operator, 2026-11-26): appearance stays a short summary ("black hair, scar on left cheek, green
  eyes"); detail goes into features ("has an old scar, silvery, from a long sword from a long forgotten battle").
  About how the Scribe writes refinements: project 3.

## Calls I made (operator to check)

- The Narrator opens the turn only (not between or after boxes) and is forced when someone arrives.
- The Narrator states positions and the world, never a cast member's choices.
- Director full-miss fallback as above.
- History windows reuse today's numbers (25 / 12 / 8, Narrator 25) under the token budget.
- A failed brain or Narrator call drops that box and continues; a failed Director call fails the turn.
- Thoughts appear when a box completes, not while streaming.
- `persona` to `personality_summary` and `voice_notes` to `speaking_style` in upgrade 1; old columns kept.
- Stored stage and slot names kept, labels changed.
- `charsPerToken` uses the lowest measured ratio per model (headroom from data, not a margin).
- Hidden facts never reach the Narrator.
- Premise and style notes in a `<campaign>` section for brains and Narrator; the OOC nudge to Director and
  Narrator only.
- Card appearance mapping (height and body to `build`, face to `appearance`, features to `feature`), per-field
  fact tracking for list categories, an empty book created on the first card save.
- The book rules apply to every book on replay (no versioning).

## Left to the builder

The exact Narrator rule wording, the tag splitter's internals, how a thread is judged to touch a subject (subject
reference where the thread record has one, otherwise label or alias match in its text), which store methods carry
the upgrade runner, the card window's section components, and SSE payload details beyond the phase names above.
