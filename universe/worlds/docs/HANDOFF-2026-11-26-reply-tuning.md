# Handoff 2026-11-26: Worlds reply tuning, project 1 (Task 2 commit-ready, Tasks 3-8 next)

For the next agent session on another PC. That session will not have this PC's agent memory
(`~/.claude/projects/-var-www-demo-stuff/memory/`) or the loop files (`~/.claude/projects/-var-www-demo-stuff/
sdd-snapshots/reply-tuning/`), so everything needed is in this file. Read it in full, then
`/var/www/demo_stuff/CLAUDE.md` (workspace laws, in the repo), before doing anything. It replaces
`docs/HANDOFF-2026-11-25-live-model-catalog.md`, whose work is all committed.

## 1. Where things stand

- Commits: `90cfe3c` reply tuning Task 1 plus the catalog fix rounds 3-6; `0691ddc` ("universe: expand character
  cards and clarify unknown values") Task 2 plus its fix round 1, this handoff and `PROMPTS-TO-CHECK.md`. The
  operator commits; agents never do. Later edits to this file (sections 1-3 and 6b) are uncommitted until the
  operator commits them.
- **Task 2 (character card end to end, appearance filed into the book): commit-ready (2026-11-26), awaiting the operator's commit; known limits below.**
  - Built by a Sonnet implementer (section 5); Opus review: 2 High, 4 Medium, 9 Low, 1 Nit, checked against the
    code (section 6).
  - Fix round 1 (section 6a, the operator's rulings included) built: all 10 test files pass (ui 56, http 36,
    catalog 54, config 14, engine 24, scribe 84, store 30, openrouter 49, seed 37, sync 8). Committed in `0691ddc`
    while its scoped re-review was still running.
  - Scoped re-review of fix round 1: 3 Medium, 4 Low, 1 law hit left (section 6b). Seeder dry-run counts unchanged
    on `0691ddc`.
  - **Fix round 2 (section 6b): operator's go on all six items, 2026-11-26 (second PC).** Dispatched to a Sonnet
    implementer; brief at `~/.claude/projects/-var-www-demo-stuff/sdd-snapshots/reply-tuning/task2-fix2-brief.md` on
    that PC (content: section 6b plus the way of working below).
  - Fix round 2 built (plus two corrections: a winning Pin in a field with a decided value reports its slot-mates
    instead of disputing them, and reuses a non-Removed fact of its value instead of copying it). Scoped Opus
    re-review: 1 High, 2 Medium, 5 Low, 1 Nit, checked against the code. All 10 test files pass (ui 58, http 36,
    catalog 54, config 14, engine 24, scribe 108, store 30, openrouter 49, seed 37, sync 8). Real-export check on
    `hero_gone_latest_updated.json` (the handoff's `hero_gone_latest.json` is not on the second PC): 0 status
    differences across 90cfe3c, HEAD and the working tree; the export has no Pins or EditFacts. Dry-run counts on that
    file equal across the three: characters 76, subjects 93, facts 314, relations 41, claims 21, threads 44,
    readThrough 1384, chatMessages 1384.
  - **Fix round 3 (operator's go, 2026-11-26), dispatched:**
    - H-A: since fix 3 one build slot holds several decision fields (forms), but a Pin still acts on the whole slot,
      so an older Pin of one form can overrule newer card saves of another. Fix: when the slot holds a decided value,
      a Pin acts only within its own decision field; slots without one keep today's Pin behaviour.
    - M-B: a model Change or Refine of a decided build with a form, written without the form words, stays in force
      beside it. Fix: the refused second value takes the decided fact's form, so it is `Reported`.
    - M-A (ruled "Server decides"): the server sends per-field book hints computed from the saved card with the
      filing's text rule; the card window only displays them (no live comparison while typing).
    - L-A (ruled "Fact keeps its own"): a Pin that reuses a fact keeps that fact's own visibility (today's code; tests
      added).
    - Technical: tests for two surviving mutants and for the `app.mjs` half of fix 4; `'build'` magic string;
      single-use `ScribeCategory.decisionForm` removed; one `?? null`; two dead test assignments; `decisionField`
      docblock types; a focus assertion.
    - Built, with technical corrections: a Pin acts per field also when its own field holds a decided value
      elsewhere; in such slots Pins are kept per field; a build rewrite takes the old build's form when its own text
      names none. Scoped Opus re-review of rounds 2 and 3: 1 High, 5 Low; all earlier findings fixed on their cases;
      all 10 test files pass (scribe 127); export check and dry-run counts equal across 90cfe3c, HEAD and work.
  - **Fix round 4 (operator's go, 2026-11-26), dispatched:**
    - H-1: a Pin ignores the form its winner inherited, so a Pedant confirmation of a model-rewritten build makes a
      duplicate and can report the card value or show a false Disputed (also without a card value: regression
      against HEAD). Fix: a Pin with a winner belongs to its winner's decision field.
    - L-2: an older Pin beaten by a newer one in the same field stays readable as `Reported` (it vanished).
    - L-3: narrowing decided per slot, the Pins' own fields included (an older Pin of another form vanished when the
      card build said "tall").
    - L-1 (ruled "Every rewrite"): a build rewrite takes the old build's form whatever the old fact's status; tests.
    - L-4, L-5: tests for four surviving mutants; docblock types.
    - Ruled "Check it in round 4" (report only, no fix): a Pedant ruled replacement on a `Reported` fact throws
      StaleState (same at HEAD; card saves make `Reported` facts more common).
    - Built; all 10 test files pass (ui 58, http 37, catalog 54, config 14, engine 24, scribe 136, store 30,
      openrouter 49, seed 37, sync 8); dry-run counts as above. StaleState trace (checked against the code): the
      EditFact ruler refuses non-live facts (`ScribeLogCore.mjs:963`, thrown at `:1820`); `PedantService.mjs:597`
      lets `Reported` facts into the replacement path and the catch at `:608` handles only merges; same at 90cfe3c.
      The Pedant flags only InForce facts, so it happens when the card field changes between a finding and its
      resolution.
    - Scoped Opus re-review of rounds 2-4: 5 Medium, 6 Low, 1 Nit (Medium ones reproduced on work and HEAD by the
      orchestrator); PhpStorm adds 2 hits (`ScribeReplay.mjs:1541` argument type, `tests/scribe.test.mjs:4011`
      unused assignment). Export check and dry-run counts equal across 90cfe3c, HEAD and work.
  - **Fix round 5 (operator's go, 2026-11-26), dispatched:**
    - M1: a Pin whose winner was split to another subject decided on that subject (a card save on one character
      demoted the other's value). Fix: the Pin's field takes the winner's form and the Pin's own subject.
    - M2: a Pin whose winner was later refined into another form or attribute made a duplicate and left two values
      in force. Fix: held facts are matched by the field of the fact they follow to.
    - M3, M4 (ruled "Both keep form"): a Pedant confirmation of a `Reported` form-inheriting build, and a ruled
      replacement that drops the form words, keep the build's form. Every edit of a build whose new text names no
      form keeps the form it had (the replay cannot tell a Pedant edit from a fact-editor edit).
    - M5 (ruled "Newest Pin wins"): Pins ignore the model's evidence attribute name (card values and edits keep the
      per-attribute rule).
    - StaleState (ruled "Newest decision"): a ruled replacement of a `Reported` fact skips the edit and files a Pin,
      the newest decision; no error.
    - Technical: a winning Pin in a decided field reuses only a live or `Reported` fact (Ended or Replaced: a copy);
      docblock types, the PhpStorm hits, one no-op spread; tests for four surviving mutants.
    - Built, plus orchestrator corrections: the kept form follows every edit of a chain; the replay state carries
      `inheritedForms` only when one exists, so the Pedant keeps an inherited form too; `describeChanges` covers that
      key (it showed "Something else in the book would change"); PhpStorm types; a test for a Pin whose value sits in
      two forms (falls back to its own text, the round 4 rule). All 10 test files pass (scribe 153).
    - Scoped Opus re-review of rounds 2-5: 4 Medium, 4 Low, all reproduced by the orchestrator. Books with no decided
      value equal HEAD; export check and dry-run counts equal across 90cfe3c, HEAD and work; PhpStorm clean.
  - **Fix round 6 (operator's go, 2026-11-26, all technical), dispatched:** held facts matched in their standing
    fact's own subject (a model Refine to another character); a replacement text that names a form takes it; the
    Pedant's form-keeping Pin competes with other Pins of its form (its explicit `form` gave it its own slot); made
    copies, their edits and Pins on them placed in their Pin's form (duplicate copies in force); an edit naming a form
    wins over a carried old scope; the edit chain follows replayed edits; tests for four surviving mutants; three
    defensive null checks removed. Operator told: each Pin round has exposed the next edge cases (rounds 3, 4, 5: 1
    High, 5 Medium, 4 Medium); a restructure (Pins as ordinary decisions in every slot) was offered and not chosen.
    - Built (scribe 166). Scoped Opus re-review of rounds 2-6: 4 Medium, 2 Low, no code-law hits; fuzz violations 39
      of 1000 (239 at HEAD), classified: 14 defects, 5 a rule gap (does a Pin act on facts of its form in another
      slot), 20 oracle errors.
    - **Operator stopped the Pin fix rounds (2026-11-26).** Cause: every finding since round 4 came from probes that
      write log entries straight into the book, not from paths the app can take. Real producers: Pins and edits come
      only from resolving a Pedant finding (`PedantService.mjs:603`, `:636`, `:667`); Worlds has no fact editor; Tell
      files story operations only. The one finding called a real regression (round 6 M-B: a model Refine of a Pin's
      copy) was run through the real services (in-memory SQLite, real ScribeService, PedantService, card save,
      scripted model text; probe `orch5/realFlow.mjs` in the session scratchpad): the Scribe refuses the Refine
      ("Reference") and the book ends with one dragon build in force. The Pedant also never checks facts of a
      private scene (not known to everyone).
    - Known limits, seen only on hand-built logs and not reproduced through the app (round 6 re-review): an edit of a
      Pin's copy does not count as a decided value (M-A); a model rewrite of a copy takes no form (M-B, refused by
      the real Scribe); a `Reported`-path replacement Pin carries the old explicit or dimension scope (M-C); a copy's
      form comes from its Pin's text, not the Pin's field (M-D); an accepted Change or Refine keeps the old explicit
      or dimension form when its text names another (L-A, same at HEAD); two surviving mutants (L-B). Open rule gap:
      does a Pin act on facts of its own form that sit in another slot.
    - Last fix: the replay state's `@returns` type lists `inheritedForms` (PhpStorm hit at `PedantService.mjs:627`).
      Orchestrator checks: all 10 test files pass (ui 58, http 37, catalog 54, config 14, engine 24, scribe 166,
      store 30, openrouter 49, seed 37, sync 8); dry-run 76/93/314/41/21/44/1384/1384, Frost; PhpStorm clean on
      changed lines of every changed file.
    - Rule from now on: a review finding counts only when it reproduces through the app's own entry points (routes
      or the services they call, scripted model text); hand-built logs do not count.
- **Way of working, ruled 2026-11-26 ("All three"), for fix round 2 and Tasks 3-8:**
  - (a) the plan maps every existing feature that touches the task's data, with a test case each (for the book:
    decided values, pins, build scope, strike marks, refinements, merges, splits);
  - (b) the implementer gets the review's attack list up front;
  - (c) implementers stop running mutant checks (breaking each fix in memory to see its test fail); the reviewer
    keeps them.
  Cause given to the operator: the Task 2 plan did not map the book's existing features, so the implementer's
  passing tests covered only the listed cases, and the review found the rest.
- Tasks 3-8: not started. One task at a time, each only after the operator commits the one before.

## 2. Documents

- Design (approved 2026-11-25, addenda since): `universe/worlds/docs/superpowers/specs/2026-11-25-reply-tuning-design.md`.
  Read "Addendum: scene styles" and "Addendum: decisions (operator, 2026-11-26)".
- Plan (approved 2026-11-25; Task 2 rewritten and Task 3 Step 1 updated 2026-11-26 after the ruling in section 4):
  `universe/worlds/docs/superpowers/plans/2026-11-25-reply-tuning.md`. 8 tasks:
  1. storage, schema upgrades, card, settings (committed, `90cfe3c`);
  2. card end to end with book filing (committed with fix round 1, `0691ddc`; fix round 2 open);
  3. book rules for player-stated changes and model-written fixed values;
  4. RequestBudget, StorySlice, HistoryWindow, `modelCatalog.contextLength`;
  5. TagReader, Director tags, `SceneStyle` enum and the `sceneStyles` setting;
  6. CharacterBrain, Narrator, ReplyStreamSplitter (`styleText` as `<style>` above `<direction>`);
  7. TurnEngine sequence, scene style state and pin; deletes `src/engine/CharacterMind.mjs`,
     `src/engine/NarratorComposer.mjs`, `src/engine/BeatParser.mjs` (operator gave the go for these three paths:
     "confirmed", 2026-11-25);
  8. browser (thoughts toggle, phase labels, Settings fields incl. replies 1-5 and the style texts, Scene-tab
     style pin, README).

## 3. Open items, in order

1. **Task 2 fix round 2:** ask the operator for the go on section 6b and the answer to the open question in
   section 1. Then write the brief from 6b (rules as section 8; the fix round 1 brief did not travel, 6a holds its
   content), dispatch (Sonnet), scoped Opus re-review of round 2 (section 7, limited to 6b), own checks (all 10
   test files one at a time, seeder dry-run, docblock sweep, PhpStorm on changed lines), hand-off opening
   "Commit-ready." or "NOT commit-ready: ...".
2. **Tasks 3-8**, one at a time, same loop. Task 3 must reuse Task 2's latest-decision rule (plan Task 3 Step 1).
3. **Later (operator-listed, not this project):** project 2 character brain (reflection/dream, budgeted feelings
   summary, timed runs every few hours for characters not in the scene); project 3 book pass at intervals,
   scene-scoped, plus format fixes and Pedant quote verification; the player speaking as any character (as in
   Zeta); operator-defined scene style names; the dead-saved-models design
   (`docs/superpowers/specs/2026-11-25-dead-saved-models-design.md`, draft, not approved); a play round.
4. **Prompts to check:** `universe/worlds/docs/PROMPTS-TO-CHECK.md`, the operator's list of LLM pipelines to make
   sure are functional (Pedant misspelling and placeholder-quote findings first). Proposed code checks there are
   not ruled yet.
5. **Pre-existing, told to the operator, not in scope:** if GET settings fails at boot and again on tab open while
   PUT works, Save blanks the model slots. The concurrent first-open WAL race (seeder and server on the same fresh
   file, about 1 in 80) stays as is: operator ruling "Rule A, leave it".

## 4. Rulings of 2026-11-26 (Task 2)

- The plan's first idea (file a card value with AddFact, then EditFact it so it is decided) does nothing: an
  EditFact with unchanged text stores no entry (`src/scribe/ScribeLogCore.mjs:977`), and the decided pass only
  demotes undecided values (`src/scribe/ScribeReplay.mjs:1418-1426` at HEAD), so two decided values stayed in force.
- Operator: the operator's word decides a fixed value: what is on the card, and what the player states happened.
  "The AI can't change things without basis. It has to be confirmed by the user somehow." Ruled option A ("Let's do
  it like that, fiine"):
  - a card save files a changed fixed value (age, hair, eyes, build) as a decided operator fact (`AddFact` with
    `decided: true`);
  - when two decided values share a slot, the later decision wins and the older becomes `Reported`, readable as the
    earlier value ("hair dyed black (originally red)");
  - model-written second values stay `Reported` (Task 3);
  - the card window keeps the card's own value and shows "In the book now: ..." under the field when the book
    differs.
- Calls made by the orchestrator (stated to the operator): "later" is log order (entry `sequence`), not turn
  position; card facts are filed at `position: 0` (the card is the starting description); editing a character
  first fetches it (new `GET` route) so the window can show the book hints, with a loading state on the trigger and
  an error without opening on failure; `filedFactIds` kept for `face` and `features` only; field labels as in the
  plan.
- The operator's model of appearance, for Task 4 (request assembly): appearance in requests is built from the
  facts about the character, with history, e.g. "scar on shoulder, hair dyed black (originally red)".

## 5. What Task 2 built (first build; fix round 1 changes are in sections 6a and 6b)

Working tree, uncommitted: `src/scribe/CardFiling.mjs` (new), `src/scribe/ScribeLogCore.mjs`,
`src/scribe/ScribeReplay.mjs`, `src/scribe/ScribeService.mjs`, `src/scribe/ScribeCategory.mjs`,
`src/store/CharacterCard.mjs`, `src/http/Router.mjs`, `public/components/CharacterModal.mjs`,
`public/components/InspectorDrawer.mjs`, `public/app.mjs`, `public/api.mjs`, `public/styles.css`,
`tests/scribe.test.mjs`, `tests/http.test.mjs`, `tests/ui.test.mjs`, plus the plan and spec edits and this file.

- `AddFact` accepts `decided` (only `true` or absent; only fixed or moving categories; not with `reported: true`).
- Replay: a decided `AddFact` joins `book.decided`; `decisionSequences` maps each decided fact to the sequence of its
  AddFact entry or its latest EditFact entry; the decided pass keeps the highest-sequence live decided fact per
  decision field and turns every other live fact there `Reported`. Behaviour change: two decided facts in one slot
  used to both stay in force.
- `CardFiling.operations` and `ScribeService.fileCardAppearance` / `bookAppearance` as in the plan;
  `fileCardAppearance` dropped the unused `characterId` parameter. `CharacterCard.Field` constants and
  `ScribeCategory.Names` added so CardFiling has no magic strings.
- Router: `#syncCharacterInBook(campaignId, character, before)` creates the book only when an appearance field
  changed; new `GET /api/campaigns/:id/characters/:characterId`; POST/PATCH responses carry `bookAppearance`.
- Browser: six collapsible `<details>` sections (Basics open), IDs `char-card-{field}`, `char-section-{key}`,
  `char-card-hint-{book key}`, `char-example-{n}`, `char-example-remove-{n}`, `char-example-add`; live hints (build
  under Body); speech example list; submit sends every card field except `filedFactIds`, trimmed, blank examples
  dropped; the Edit button in the Cast tab shows "Opening..." and a failure shows in the Cast tab's danger alert.
- Tests: 22 new scribe tests, 1 new http test (all plan cases plus archived), new ui tests. Runs: ui 51, http 34,
  catalog 54, config 14, engine 21, scribe 63, store 30, openrouter 49, seed 37, sync 8; 0 fail.
- Implementer's own notes (the review was told to test them): a build text containing "tall" or "height" gets a
  dimension-scoped build key and may not demote an unscoped imported build (two builds in force); `decided: true`
  is also accepted through `tellCommit` (client-supplied rulings); a book row created by a card save makes the Book
  tab and the Scribe's first read show the subject and card facts instead of the empty state, and subject numbering
  may follow save order; mutants were restored by editing lines back and checked by grep, not by diff.

## 6. Task 2 review result (2026-11-26)

Opus review finished: 2 High, 4 Medium, 9 Low, 1 Nit. The orchestrator checked each claim against the code:
H1, H2, M1-M4 and L9 confirmed by reading the cited lines; L1-L8 taken as the reviewer reproduced or reasoned
them (L3-L6 reasoned from code, no browser). All 10 test files pass (ui 51, http 34, catalog 54, config 14, engine
21, scribe 63, store 30, openrouter 49, seed 37, sync 8). Seeder dry-run counts unchanged (48/61/195/36/3/23,
Frost, 680/1384). No mutant leftovers.

Findings:
- **H1 A Pin beats every later card decision.** The Pinning pass (`ScribeReplay.mjs` ~1460-1471) runs after the
  decided pass (~1414-1444) and forces its winner. Pins arise in normal use: resolving a Pedant finding as Ruled
  with a replacement in a fixed category files an EditFact plus a Pin (`PedantService.mjs:625`). Card hair black,
  Pin black, card save white: black in force, white Disputed, every later card save in that slot does nothing.
- **H2 Build scope splits the slot, so two builds stay in force.** `ScribeCategory.scope` (`ScribeCategory.mjs`
  114-145, build only) gives build text with "tall"/"height" a height dimension and "long"/"length" a length
  dimension (it exists for Hero Gone's human vs dragon forms); the decision field uses that scoped key. Card
  "5'6\"; slim" then height "tall": both in force (`5'6"; slim; tall; slim`); imported "slim and athletic" plus card
  "tall; slim", "average height; stocky" or body "long-legged and lean": both in force; a model's "She is very
  tall" beside the card's build: both in force.
- **M1 A card value with no letter or digit ("?", "-", "...", "~") fails the whole save with 500
  "InvalidOperation"** (`ScribeLogCore.worded`, reached from `ScribeService.fileCardAppearance`). Rollback is
  correct.
- **M2 A character created archived never gets its card appearance filed**: no subject at creation, and the later
  unarchive PATCH has no appearance change (`Router.mjs` ~1531, ~1570).
- **M3 Replacing a card list value erases story facts with the same wording, now and later**: `RemoveFact` stores a
  strike mark (`ScribeReplay.erase` ~159-175 removes non-operator facts matching it). Card features "freckles",
  story "Freckles", card changed to "a tattoo": the story's Freckles and every later story "freckles" are Removed.
- **M4 A story-refined card feature is not replaced when the card changes** (`CardFiling.mjs:81` checks only that
  the remembered id is live; it does not follow the refinement to its successor). Follows the plan's wording, not
  the spec's ("the new fact replaces that one fact").
- **L1** A list value equal to an existing book fact is filed again (two "a scar", hint shown under a matching
  field). **L2** A remembered id split off to another subject is removed there (no subject or category check).
  **L3** Removing the last speech example drops keyboard focus to the page (`CharacterModal.mjs` ~637). **L4**
  `.card-section-title { display: flex }` hides the `<summary>` disclosure marker (`styles.css` ~1099). **L5** The
  Edit failure shows at the top of the cast list, not where the click was; the Edit button has no ID
  (`InspectorDrawer.mjs` ~864). **L6** A slow character GET that lands after a campaign switch opens the old
  campaign's character; Save then 404s (`app.mjs` ~387). **L7** Untested guard `!decisionSequences.has(...)`
  (`ScribeReplay.mjs:1334`; reachable via edit then subject merge). **L8** Untested `.trim()` in the single-field
  hint comparison (`CharacterModal.mjs` ~572). **L9 (law)** Test helpers without `@throws`:
  `tests/http.test.mjs:2585` `replayBook`, `tests/scribe.test.mjs:2985` `statuses`.
- **Nit** `fileCardAppearance` has no `characterId` parameter: unused, keep it out; the plan's interface line is
  to be corrected.

## 6a. Fix round 1 (rulings given, built, committed in `0691ddc`)

1. **H1:** Pins take part in the latest-decision order by their entry sequence: a Pin older than the newest decided
   value in its slot does not override it; a newer Pin still wins. Test both orders.
2. **H2:** for decisions, a build's slot ignores the word-derived dimension (height/length) and keeps only the
   form (human/dragon form). Checked on the real export: its 5 build facts have no form wording, and one ordinary
   description ("tall with H-cup breasts, wide hips, and curvy figure") is height-scoped only because of "tall". So
   a decided card build replaces every build of that subject with the same form (none), and a model's "very tall"
   becomes `Reported`. Task 3's model-written rule must group builds the same way.
3. **M1 (ruled 2026-11-26):** a card text value with no letter or digit is saved as `?` and filed into the book as
   `?`; every model request shows `?` as `unknown` (operator: "I think a LLL would react incorrect to it, so in the
   requests any "?" becomes "unknown""). Speech examples kept as written (orchestrator's call).
4. **M2:** when a character gets its first subject (created now), file the whole stored card (before = empty).
5. **M3:** list replacement removes only the card's own fact, without a strike mark (an exact removal that adds
   the id to the removed set only), so story facts with the same wording stay.
6. **M4 (ruled 2026-11-26):** when the story refined the card's feature and the card's features then change, the
   card's change replaces the refined fact, following the refinement chain to the current fact. Operator: "card
   changes to explain, but the data should remain short (e.g. appearace: "black hair, scar on left cheek, green
   eyes", and below in character features: "has an old scar, silvery, from a long sword from a long forgotten
   battle")". The "keep it short" part (appearance stays a short summary, detail goes into features) is about how
   the Scribe writes refinements: recorded under Later (project 3, book pass and format fixes), not this round.
7. **L1:** an identical live list value in the book is not filed again and not adopted. **L2:** remove a
   remembered fact only when it is still this subject's (survivor) and this category. **L3:** after removing a
   speech example, focus moves to the previous example's Remove button, else Add. **L4:** keep a visible disclosure
   marker (tokens only). **L5:** stable ID on each Edit button; the failure shows next to the clicked row and focus
   returns to it. **L6:** drop a character GET response when the campaign changed meanwhile. **L7, L8:** tests that
   fail without the guard and the trim. **L9:** `@throws` on both helpers.
8. Plan correction (orchestrator, docs only): `fileCardAppearance` interface without `characterId`; Task 2 list
   replacement wording per items 5-6.

After the ruling: fix-round brief (Sonnet, rules as section 8), scoped Opus re-review of the round, own checks,
hand-off.

## 6b. Scoped re-review of fix round 1, and proposed fix round 2 (2026-11-26)

Re-review result: H2, M2, M3, M4, L1-L4, L6-L9 fixed; every fix-round mutant caught; all 10 test files pass (ui 56,
http 36, catalog 54, config 14, engine 24, scribe 84, store 30, openrouter 49, seed 37, sync 8); no import cycle;
`CharacterCard` normalisation covers every `card_json` writer and the reader. Seeder dry-run on `0691ddc`: counts
unchanged. Orchestrator checked N1, N2, N3, N6, N7 against the code. Reviewer process slip: ran `git stash list`
once (read-only, but outside the allowed git commands).

Findings:
- **N1 (Medium) Pins and card decisions on builds still both stay in force.** `book.decidedSlots` is keyed by the
  scoped slot key (`ScribeReplay.mjs` ~1442-1447) while decisions use the build field without dimension; the Pin
  check (`:946-949`) looks up its own scoped slot. Older Pin build "slim" then card "tall; slim": both in force;
  card "tall; slim" then a newer Pin "athletic": both in force. Hair is fixed.
- **N2 (Medium) A build with no worded part still fails with 500:** height "?" and body "-" join to "?; ?"
  (`CardFiling.mjs` ~77-80), which `AddFact` refuses (it accepts only an exact "?").
- **N3 (Medium) A bare "?" reaches requests through a build with one unknown part:** "?; slim" and "5'6\"; ?" are
  shown as written (`CharacterCard.requestValue` maps only an exact "?").
- **N4 (Low)** The kept form only counts when the text also has a dimension (`ScribeCategory.scope` returns a form
  only together with a dimension): card "slim" turns a story "In dragon form she is covered in black scales"
  `Reported`; imported "In human form she is 5 ft 6" plus card "5'6\"; slim" leaves both in force.
- **N5 (Low)** An older Pin is skipped outright, so a value only the pin created vanishes from the book instead of
  staying readable as `Reported`.
- **N6 (Low)** A failing Edit throws (unhandled TypeError) when the user switched tab or campaign before the GET
  failed: `InspectorDrawer.mjs:952-953` focuses a button that is not rendered; the campaign-change drop covers only
  successful responses.
- **N7 (law)** `CardFiling.operations` docblock lacks `@throws {TypeError}` (it calls `ScribeCategory.value`).
- **N8 (Low, test)** "removes a fact exactly without striking the wording of other facts" passes even when replay
  ignores `exact`: its second fact is an operator fact, which is never struck. Use a story fact.
- Implementer calls, as the re-review found them: `?` -> `unknown` exact-match only (gap N3); dimension-less
  "dragon form" (N4); older Pin skipped (N5); `decided`/`exact` through `tellCommit` accepted, only a hand-built
  CSRF-protected request can send them and Tell preview never produces them (no change proposed); no import cycle
  (`CharacterCard` -> `ScribeAnswer` -> `ScribeCategory` -> `ScribeText`, no path back).
- Reviewer's note on existing books (why item 6 below): the seeder imports Zeta edits as `EditFact`, so with the new
  rule an operator edit of one build reports that subject's other builds whatever their tall/long wording, and an
  older Pin is skipped where a newer EditFact sits in its slot.
- What fix round 1 changed (for orientation): `ScribeReplay` (pin decision sequence, build decision field without
  dimension, exact removal), `ScribeLogCore` (`AddFact` accepts an exact `?`; `RemoveFact` `exact`), `CardFiling`
  (refinement chain, subject/category check, duplicate skip), `CharacterCard` (`Unknown`, `UnknownLabel`,
  `normalise`, `requestValue`; normalised in the constructor), `Router` (first subject files the whole card), the
  five request builders (Director roster, CharacterMind identity and fact lines, NarratorComposer voice, Scribe
  statement, Pedant ledger), `CharacterModal` (focus after removing an example), `InspectorDrawer` (Edit IDs
  `cast-edit-{id}`, error in the row), `app.mjs` (stale GET dropped), `styles.css` (`display: list-item`).

Proposed fix round 2 (waiting for the operator's go):
1. **N1, N5:** Pins are decisions in the same latest-decision rule: a pin's sequence is its entry sequence; in a
   decision field (build: subject, category, form) the newest decision among card values, edits and pins is in
   force, the others `Reported` and readable (a pin's made value is kept as `Reported`, not dropped). Tests for the
   three build cases above and the hair cases.
2. **N2, N3 (orchestrator's call, within the M1 ruling):** a build part that is "?" is left out of the build text;
   when every part is "?", the build is filed as "?". So requests never carry a "?" inside a build, and the exact
   "?" rule stays as it is.
3. **N4:** the decision field reads the form from the text (human/dragon form) even without a dimension; slot keys
   elsewhere unchanged.
4. **N6:** focus the Edit button only when it is rendered; drop a failed GET too when the campaign changed.
5. **N7:** `@throws`. **N8:** the test uses a story fact.
6. **Real-export check:** compare the seeded Hero Gone book's fact statuses replayed with HEAD~1 (`90cfe3c`) code
   against the fixed code (temporary database or pure replay of the exported log, never the app database); report
   every status that changed, for the operator.

## 7. Task 2 review brief (for a rerun)

Adversarial Opus reviewer, read-only on the repository, probes only via the Write tool under the session
scratchpad, Node only under limits. Directive: "Assume this code has defects and try to prove it. A finding counts
only with an input that reproduces it; if you cannot break something, say so." Read the plan header, Global
Constraints, Review Focus 5, Task 2; the spec sections "Character card", "Book rules for player-stated changes",
"Addendum: decisions", "Browser"; this file's sections 4-5. Attack list:

- Decided pass: two decided values in one slot (card vs card, card vs EditFact, edit of an older fact after a newer
  card save); decided facts later removed, withdrawn, merged into another subject, or replaced; an EditFact whose
  source no longer matches (`sourcePrint`); moving categories; scoped fixed facts (`form`, `dimension`); pins in the
  same slot; replay determinism and the two-pass `run`. Did any existing book's statuses change where no decided
  AddFact exists? Run the real-export check in `tests/seed.test.mjs`.
- The implementer's four notes in section 5.
- `AddFact` validation: every `decided` value, category kinds, `reported` combinations, `relation`.
- `CardFiling`: every field alone and together; height/body combinations; whitespace-only values; list
  replacement when the remembered fact is removed, replaced, refined, merged or another subject's; ids that never
  existed; values identical to an existing fact.
- Router: POST/PATCH with and without `card`, only non-appearance changes, archived characters, player switching in
  the same request, no book, concurrent saves, the GET route (other campaign, archived, unknown); rollback when
  filing throws (character write and book row).
- `bookAppearance`: joined text, hidden, scoped, `Disputed`, merged subjects.
- Browser: empty and full cards, long values, example add/remove (focus, IDs after removal), blank examples, hint
  comparison, Edit loading, double click, failure path, stale response after a drawer re-render, phone width,
  focus across a catalog refresh, Save loading, reduced motion, keyboard on `<summary>`.
- Whether each new test fails without its code (mutants in memory or as scratch copies, never by editing repository
  files).
- Code laws on every added or changed line (section 8); law hits are findings, never Nits.

Report: findings ranked Critical, High, Medium, Low, Nit, each with file:line, the reproducing input, observed
versus expected; then what could not be broken; then test summary lines.

## 8. Standing rules (agent memory on the old PC; it does not travel)

- **The operator decides everything.** No product or behaviour decision on an agent's own; surface it with argued
  options and a recommendation. Never re-ask a settled ruling. Questions and fork answers are not go signals.
- **Verify Worlds code before describing its behaviour** (on 2026-11-25 an agent told the operator Worlds raises a
  conflict on a second fixed value; it does not). Facts about the Zeta export come from the exported JSON in hand.
- **UI is display only:** the backend owns every decision about saved data; the browser renders and sends input.
- **Never assume an LLM output format;** formats are the operator's (tags as in the spec for this project).
- **No invented limits** (caps, budgets, timeouts, retries) unless the operator gave them or they were measured.
- **Rewrites keep every safety behaviour of removed code**; a lost one is restored as it was.
- **Code laws are never Nits:** tag-only JSDoc (`@param`, `@returns`, `@throws` on every uncaught path, assertions
  and rejected awaits included) on every function, method, IIFE, named helper, test helper and test-fake method; no
  prose comments; braces; no single-letter or throwaway names; no magic strings; one declaration per file; enums with
  `label()`; no private method with one caller; no single-use wrappers; no swallowed errors; no defensive `?.`/`??`
  on guaranteed values; no inline styles or raw colours; phone-first; loading state on every round-trip. Exception
  (operator): small anonymous callbacks written inline as option properties need no docblock.
- **Process:** implementer subagent (lowest tier that keeps quality: Haiku mechanical, Sonnet with a precise brief
  for reasoning, Opus only when needed) -> adversarial Opus reviewer -> orchestrator checks each claim and never
  writes implementation code -> fix rounds proposed to the operator -> scoped re-review -> hand-off opening
  "Commit-ready." or "NOT commit-ready: ...". In hand-offs, surface only what needs a ruling; fold obvious fixes in.
  Stop after every task; the operator commits.
- **Locks:** no database access (present SQL, the operator runs it); never read `.env`, `config.inc.php`,
  credentials, or anything in `local/` (reply log headers only); git read-only (`status`, `diff`, `log`, `show`,
  `blame`); Edit/Write tools only for file changes (no sed, awk, heredocs, python, shell redirects, scratchpad
  included); no deletes without a per-path go; no dependency changes; never start the real server; never run the
  seeder except `--dry-run`, and only the operator runs it for real. A subagent's denied action is never run for it
  by the orchestrator without the operator's word.
- **Node only under limits, one test file at a time** (an unbounded run crashed WSL three times), from
  `universe/worlds`:
  `NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 120 node --test tests/<file>.test.mjs`
  The 10 files: ui, http, catalog, config, engine, scribe, store, openrouter, seed, sync.
- **Seeder dry-run** (counts must stay unchanged):
  `NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 60 node scripts/seed-from-export.mjs /var/www/demo_stuff/zeta-dm-memory/scribe/private/hero_gone_latest.json --dry-run --player frost`
  Expected: characters 48, subjects 61, facts 195, relations 36, claims 3, threads 23, player Frost, readThrough
  680, chatMessages 1384.
- **Replies:** terse, plain words, no emojis, no insight blocks, no recaps, no commit reminders; report what was run
  and what was not.

## 9. Tools

- PhpStorm MCP (`phpstorm`, SSE `http://127.0.0.1:64442/sse`, registered user-wide with
  `claude mcp add --scope user --transport sse phpstorm http://127.0.0.1:64442/sse`). `get_file_problems` with the
  project path PhpStorm uses on that PC (this PC: `//wsl.localhost/Ubuntu/var/www/demo_stuff`; the older PC:
  `/var/www/demo_stuff`), long timeout for big files. Filter results with jq: drop `LANGUAGE_ADDITIONS` and
  unresolved-SQL noise; keep only lines added in `git diff -U0 HEAD`.
- Probes and scratch files from this PC's scratchpad do not travel.
