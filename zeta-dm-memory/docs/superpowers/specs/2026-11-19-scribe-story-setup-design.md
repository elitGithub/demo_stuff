# Design: the scribe knows the story setup and the player's profile

Date: 2026-11-19. Operator's ask: "I need the scribe to KNOW the profile so it can work things out. Rulings, decisions, etc." and "Does it read the original plot?" Shape approved by the operator 2026-11-19 ("OK"). Revised after a builder's read (blocking: how `call` gets the block; should fix: Settings data, the background-only rule, placement, the plot id, profile edge cases). Built after cloud store Task 2 is committed (both change `ScribeBoot.call`).

## What Zeta gives (checked 2026-11-19 on the operator's room `3799016f-...`, "The Unchained Princess", with the page's login)

- `GET /v1/rooms/:roomId` (the scribe reads it already) carries the whole plot under `plot`: `id`, `name`, `shortDescription`, `longDescription` (675 characters here), `characters` (`name`, `description`; Mirra, 380 characters), `intros[0].conversation.messages` (the opening; each `{ type, content, senderType, senderId, speakerName }`, two here), `lorebooks` (empty here), `conversations` (null: the example conversation is not public). The writer's hidden prompt is not exposed.
- `GET /v1/plots/:plotId` (read by the scribe today) answers 200 with the login, 404 without; it adds nothing the room record lacks.
- `GET /v1/rooms/:roomId/user-plot-chat-profiles/me` answers **404** in a room with no custom chat profile. The scribe treats that as a failure today: notice "could not be read", and no model gets a profile.
- `GET /v1/plots/:plotId/rooms/:roomId/user-personas/selected` (the page reads it) answers `{ name, profileImageUrl, description }`: here `Frost`, 600 characters. This is the persona Zeta uses for the player when the room has no custom profile.

## Today

The profile reaches three calls (the reading's story pass, the scene, the checker) as a `PLAYER CHARACTER PROFILE:` section built in `ScribeAnalyzer.input`, `ScribeScene.input` and `ScribePedant.input`; Tell ("Work it out", `ScribeMuse.tell`), the Muse's suggestion (`ScribeMuse.suggest`) and the reading's Notes and Answers passes get none (0bd4e90 left those two passes out on purpose; this design reverses that). The plot gives only `characters`, used only by the reminder (`ScribeReminder.writer`). No model sees the plot.

## The change

1. **One read for the story.** `ZetaSource.story` reads `GET /v1/rooms/:roomId` only; the `GET /v1/plots/:plotId` request is removed. `plotId` comes from `plotOf(body)` as today (top-level `plotId` or `plot.id`); everything else from `body.plot`. `NoPlot` when `body.plot` is not an object. It returns `{ plotId, name, summary, description, characters, opening, lore }`:
   - `summary` = `shortDescription`, `description` = `longDescription` (strings, trimmed; empty when absent);
   - `characters` as today (`name`, `description`), still used by the reminder unchanged; a missing or non-list `characters` gives an empty list (no longer a failure);
   - `opening` = `intros[0].conversation.messages` as `{ speaker, text }`, `speaker` from `speakerName`, `text` from `content` when it is a string, else from `content.text` when that is a string; others skipped;
   - `lore` = `lorebooks` entries as `{ name, text }`, `text` the first string among `content`, `description`, `text`; others skipped. **The lorebook shape is unverified** (the checked plot has none); a plot with one is a hand-off check.
2. **The profile Zeta really uses.** `ZetaSource.profile(request, plotId)`: the room's custom profile first (`user-plot-chat-profiles/me`, today's text paths). On **404**, or a 200 with no text, and when `plotId` is known, the selected persona (`user-personas/selected`). Returns `{ source: 'Room'|'Persona', name: string|null, text }`; for a persona, `name` is its name and `text` is `<name>: <description>` (just the description when the name is empty); a persona with an empty description gives null. Null when neither has text: not a failure, no notice. Any other failure (a 5xx, a wrong shape) on either read keeps today's notice. Capped at `LongestProfile` (2,000 code points).
3. **Reads in order, at once.** `ScribeLive.cast` reads the story, then the profile with the story's `plotId` (null when the story failed: only the room profile is tried). The cast is started when the live part opens (not on first use), so the Settings lines have data. Once per room per page load, shared by concurrent callers, re-read on revisit, `NoLogin` retried later: as today. `Uncast` and the `StoryUnread` wording change to the new shape ("The story could not be read: ").
4. **The background block.** A new `scribe/page/ScribeSetup.js` (`Settings` with the headings, the cap and the line shapes) has `build(story, profile, player)` returning `{ text: string|null, shown: number, whole: number, source, persona }`:
   ```
   BACKGROUND (never a source on its own: no fact, subject, thread or NOW line comes from it alone; the messages and the book are what happened, and where they differ from it they are right):

   STORY SETUP (the writer's starting point; the story has moved on since):
   The Unchained Princess: Proud, shackled, daring you to try
   <description>
   Story characters:
   - Mirra: <description, its line breaks as spaces>
   Opening:
   <speaker>: <text, its line breaks as spaces>
   Lore:
   - <name>: <text, its line breaks as spaces>

   PLAYER CHARACTER PROFILE (the player's own description of their character; trust it for that character):
   <profile text>
   ```
   Empty parts are left out (no `Lore:` with no lore; no `STORY SETUP` with no story; `text` null with neither). The story part's body (headings not counted) is capped at 6,000 code points, filled in the order shown, cut at the last line break before the cap, or at the cap itself when there is none; the cut is not marked. `whole` is the uncut length, `shown` the kept length. `{{user}}` (any case) in the setup is replaced by the player's name (hand-off check: whether Zeta's texts carry it).
5. **Every page model call gets it, first, from one place.** The live handle's `profile` is replaced by `setup(): Promise<string|null>` (the block text, built by `ScribeSetup` inside `ScribeLive` from the cast). `ScribeBoot.call` does `const block = session.live === null ? null : await session.live.setup()`, then checks `session.closed` again (a session closed during the reads sends nothing and is not charged), then sends `block + '\n\n' + user` (just `user` with no block), followed by cloud Task 2's `NotesOpen + notes`. So the block comes before the call's own sections and the transcript stays last. This covers every role on the page: reading (story, Notes and Answers passes), scene, checker, Tell, the Muse's suggestion. The bench (`BenchPage.js`) calls the gateway directly and gets no block.
6. **Removed** (the block replaces them, so the profile goes once per call): `profile` in `ScribeAnalyzer.input`, `ScribeScene.input`/`now`, `ScribePedant.input`/`review`; the `Profile` option and its check in `ScribeAdoption` (`Messages.Profile`); the keeper's `profile` option, `keeper.profile` and `BadProfile`; `ScribeBoot`'s keeper `profile` option; `handle.profile`; the three `Headings.Profile` entries; the sentence about `PLAYER CHARACTER PROFILE` in the three prompts; `ZetaSource.Settings.PlotsPath` and the plot read.
7. **Shown to the operator** (live view gains `setup: { shown, whole, source, persona, read: boolean }|null`; `Drawers.Settings` reads it): `Story setup: 2,140 characters go with every call (cut from 7,310).` / `No story setup could be read.` / `Reading the story setup...` (not read yet); `Profile: this chat's custom profile.` / `Profile: your persona Frost.` / `Profile: none set for this chat.` / `Profile: could not be read.` Progress keeps today's notices for real failures only.

## Decision for the operator

The block's first line makes it background only: the models may use it to understand and judge, but nothing is filed, noted or flagged from it alone (today nothing checks this: the reading cites `#n` without checking the message says it, and the checker's NOW lines are kept whenever the name appears). The alternative is letting the reading file setup facts, which then need a citation that says where they came from. Recommended: background only.

## Cost

At most about 8,000 characters (roughly 2,000 tokens) more input on every call. The scene and the checker run on every reply: about 4,000 more input tokens per reply. A reading stretch adds about 2,000 for the story pass, and as much again for each Notes or Answers pass it runs.

## Files

`scribe/page/ZetaSource.js`, `ScribeLive.js`, `ScribeSetup.js` (new), `ScribeBoot.js`, `ScribeKeeper.js`, `ScribeScene.js`, `ScribePedant.js`, `ScribePanel.js`, `PanelView.js` if the line is built there, `scribe/core/ScribeAnalyzer.js`, `ScribeAdoption.js`; `scribe/pack.mjs` (`ScribeSetup.js` right before `ScribeLive.js`; 28 files after cloud Task 2); `scribe/scribe.user.js` rebuilt; `tests/support/FakeZeta.mjs` (the room body carries `plot: { id, name, shortDescription, longDescription, characters, intros, lorebooks }`; the `/v1/plots/:id` route goes; a `.../user-personas/selected` route answers from `this.persona`); every test that loads `ScribeLive` also loads `ScribeSetup`; `tests/scribe-setup.test.mjs` (new); the verification record.

## Tests that try to break it

- `ZetaSource`: a room body like the observed one gives every field; no request to `/v1/plots/:plotId`; top-level `plotId` with a `plot` object; no `plot` object (`NoPlot`); `characters` missing; `content` as string, as `{ text }`, as a number (skipped); lorebook entries in each accepted shape and junk; profile 200, profile 200 without text then persona, profile 404 then persona 200, both 404 (null, no notice), profile 500 (notice), persona 500 (notice), persona with empty name, persona with empty description; no `plotId` (persona not tried).
- `ScribeSetup`: order; empty parts left out; the 6,000 cap cut at a line break and with none; `shown` and `whole`; headings outside the cap; line breaks inside a description; surrogate pairs at the cap; `{{user}}` and `{{USER}}`; twelve story characters.
- `ScribeBoot`: every role's user text starts with the block and ends with `OPERATOR NOTES:` when both exist; neither when neither; the block appears exactly once per call; a call before the cast resolves waits and carries it; a session closed during the wait sends nothing and charges nothing; `session.live` null sends no block.
- Prompts and inputs: no `PLAYER CHARACTER PROFILE` section built by the analyzer, scene or checker inputs.
- `ScribeReminder`: unchanged output with the new `story` shape.
- Panel: each Settings line, including not read yet and failed; no notice for a room with no custom profile.
- Whole site: the observed room shape end to end; one room read, no plot read, the persona read on 404.
- Tests that encode today's behaviour and flip: `scribe-whole.test.mjs` (the 404 profile notice, near line 954), `scribe-boot.test.mjs` (the plot read and parallel reads, near line 1087; the keeper's `profile` null, near line 1080), `scribe-live.test.mjs` (near lines 4437 and 4462).

## Hand-off checks on the real room

Settings shows the persona and the setup size; a reply's checker and scene calls carry the block once (Progress, Last calls); a plot with a lorebook, and whether `{{user}}` appears in Zeta's texts.

## Not in this change

The chat profile draft (backlog), the writer's hidden prompt and example conversation (not exposed), steering.
