# Plan: make the scribe do what its approved design says

Design: `docs/superpowers/specs/2026-11-13-scribe-design.md` (approved 2026-11-13). No new design: each fix below restores a line of it that the build breaks, shown by the export of room `45359def` on 2026-11-19. Operator, 2026-11-19: "FIX THE GODDAMN SYSTEM".

Code laws as in every scribe plan (Settings objects, tag-only docblocks on every method and arrow callback, braces always, no single-letter names, lines at most 120 columns, no emojis, Edit/Write only, git read-only, no deletions, no dependencies, `node scribe/pack.mjs` the one build step, tests one file at a time under the memory limit).

## Fix 1. The scene is current, or no reminder goes (design lines 222 and 231)

"Now ... comes from the Scribe, so it is current." "Someone who died twenty messages ago must not be reported as standing in the room." The export: the scene stayed at #157 (Mavan alive) for 68 replies while its calls failed, and every reminder said Mavan was present.

1. `ScribeLive`: a reminder is prepared, shown as waiting, or attached to a send only when the live record's `now` belongs to the latest reply (`now.message` is that reply's id, or the latest reply is the player's own and `now` is the reply before it). Otherwise nothing is attached, and the Findings tab's reminder line says: `No reminder: the scene was last read at #157; the latest reply is #225.` A forced reminder obeys the same rule (it waits for a current scene).
2. `ScribeScene`: the scene call's input gains, for each subject the book knows, its in-force `status` facts, and its prompt one rule: a character whose STATUS says they died, were destroyed or left the story is never PRESENT unless the messages show them back.

## Fix 2. Failures are retried and the operator is told (safety rule 5, line 270)

"Temporary failures are retried a small number of times with a pause, without the operator's involvement. The operator is told only if it keeps failing." The export and the operator's screen: scene and check calls failed silently from #146; a failed check is never retried; a 402 stopped the reading for good; OpenRouter's reason was thrown away; a new key changed nothing.

1. `ScribeGateway`: a non-2xx answer keeps the provider's own error text (`error.message` of the body, else the first 300 characters of the body) as the failure's `reason`, masked of the key as reasons are today; it appears in every notice built from the error.
2. `ScribeLive`: a reply whose scene or check call failed is retried at the next live cycle, at most 3 times with 15 s, 60 s, 300 s between tries (backlog item 5a); a later reply is not held up by it. After the third failure the header shows `Scene failing: <reason>` or `Checks failing: <reason>` until a call of that role succeeds.
3. `ScribeKeeper` / `ScribePanel`: saving an OpenRouter key clears a reading's `Failed` stop and lets the next tick read at once; the header shows the stop's reason with the provider's text.
4. Progress, Last calls: live calls are listed beside the keeper's (role, tokens in, tokens out, reasoning tokens when the provider reports them, finish). An answer cut off for length is still refused whole (safety rule 1), but its first 2,000 characters are kept with that entry so the cause of the cut-offs can be seen.

## Fix 3. The Analyzer lists the contradictions it reads (decision 7, line 90; Rulings, line 184)

"A later value that contradicts an earlier one is a conflict, not an update." Rulings shows "the Analyzer's own free-text list of contradictions, as advice". Never built. The export: Mavan "has held the Staff of Elders for two centuries" (#131) and Magera "has guarded it for a thousand years" (#209) were both filed; nothing was raised.

1. `ScribeAnalyzer` story pass: a new answer section `CONTRADICTIONS`: one line per place where the new messages contradict the LEDGER, an ended fact, a closed thread, or an earlier message (any subject, any category, objects and events included), as `#<new> "<words from the new message>" | #<earlier> "<words from the earlier message>" | <one sentence>`. The pass input gains the ended facts and closed threads with their end reasons and citations (the LEDGER today holds only facts in force).
2. `ScribeAdoption` / code: a line is kept only when both quotes are found in the cited messages (normalised as the checker's situation quotes are); others are refused and shown with the pass as refused lines are today. Kept lines are stored in the book log as an advisory operation.
3. Rulings tab: an advisory list "Contradictions the Analyzer read", newest first, paged, each with both quotes and message numbers, and Dismiss; it never blocks the scribe, as line 184 says.

## Fix 4. The reminder leads with the story so far (operator, 2026-11-19)

Operator: "The reminder should be 'they came to Frost for... and they done... and now they need... and then specifics'." Zeta forgets its own first messages (operator's example: "The Princess at Dawn"). This overturns the design's call 4 (line 411, "the model does not write it") for this one part; the book's timeline already holds the material: every scene has a one-line `summary` (design line 155), e.g. `Three elves confront Frost at his door; ... they demand a mage for an urgent Council mission`.

1. When a reminder is prepared, one Scribe-role call writes **the story so far**: plain prose in story order, as long as the story needs (no sentence count and no separate limit; operator, 2026-11-19: "What if it needs a paragraph", "You're 'budgeting' something for no reason"): how it began (who came to whom, for what), what has been done, where things stand now and what is needed next. Its input: the timeline's scenes in order (day, place, summary; all of them up to 12,000 characters, else the first 5 and the newest that fit), the open threads, and the current scene's summary (current by Fix 1). Its rules: only what those lines say; no name, place, object or event they do not hold; past tense for what happened, present for now.
2. It is kept and reused until the timeline or the current scene changes (no call per send).
3. The reminder is `[Scribe] The story so far: <the story so far> <the specifics as today>` (operator, 2026-11-19: labelled "the story so far" so Zeta's model recognises it): the story so far first, then the specifics. **The reminder cap is 3,000 characters** (operator, 2026-11-19: "2000 characters. Can be 3000."), with no split between the parts; when over, whole pieces of the specifics drop from the end as today, and the story so far is cut only if it alone passes the cap (at a sentence end); the whole outgoing message stays under the existing 4,500-byte guard, the operator's own text never cut. The operator sees it and can Edit it before it goes, as today.
4. No story so far, no reminder: when the call fails or is cut off, the reminder waits (retried as Fix 2) and the waiting line says why.

Tests: the input holds the scenes in order and the threads, capped as stated; a stub answer leads the reminder after `The story so far: ` and the specifics follow; a story so far alone over 3,000 characters is cut at a sentence end; the whole reminder never passes 3,000 characters; specifics drop from the end first; reuse with an unchanged timeline makes no second call; a changed scene makes one; a failed call holds the reminder with the reason.

## Fix 5. Read the chat profile from where Zeta keeps it

The operator's screen: `The chat profile could not be read, so it is left out of the calls: Zeta answered HTTP 404`. The scribe reads `GET /v1/rooms/:roomId/user-plot-chat-profiles/me`, which was never checked against Zeta and answers 404 (seen in rooms `3799016f` and `45359def`). The page itself reads the room's chat profile from `GET /v1/plots/:plotId/rooms/:roomId/user-personas/selected` (200 in both rooms; in `3799016f` it answers `{ name: "Frost", profileImageUrl, description }` with 600 characters).

1. `ZetaSource.profile(request, plotId)` reads only `user-personas/selected`; the `user-plot-chat-profiles/me` request is removed. Its text is `<name>: <description>` (just the description when the name is empty). A 404, or an empty description, is null: no profile, no notice. Any other failure keeps today's notice. Capped at `LongestProfile`. `plotId` comes from `plotOf` on the room body the story read already fetches.
2. `ScribeLive.cast`: the story read first, then the profile with the story's `plotId` (no `plotId`: no profile read, and the story's own notice says why). The profile text then reaches the calls exactly as today.
3. `tests/support/FakeZeta.mjs`: the persona route replaces the old profile route.

Tests: persona 200; persona with an empty name; persona with an empty description (null, no notice); persona 404 (null, no notice); persona 500 (notice); no `plotId`; no request to `user-plot-chat-profiles/me`.

## Fix 6. The story read uses only what Zeta was seen to send (design line 58)

"The builder must not assume anything about Zeta beyond these." The story read fetches `GET /v1/plots/:plotId` and takes `characters` from a body nobody has seen; `tests/support/FakeZeta.mjs` serves a room body `{ id, plotId }` that Zeta does not send. Seen on 2026-11-19 in room `3799016f`: `GET /v1/rooms/:roomId` answers `{ id, createdAt, lastMessage, isActive, title, unreadCount, plot, savedAt, penalty }`, with no top-level `plotId`, and `plot` holds `id`, `name`, `shortDescription`, `longDescription`, `characters` (`{ id, plotId, name, description, imageUrl, isProfileImageDeletedByAbusing }`), `intros`, `lorebooks` and the rest.

1. `ZetaSource.story` takes `characters` from `plot.characters` of the room body it already reads; the `GET /v1/plots/:plotId` request is removed. A missing or non-list `plot.characters` keeps today's shape notice.
2. `tests/support/FakeZeta.mjs`: the room body is the shape seen above (made-up values), and the `/v1/plots/:id` route goes.

Tests: the seen shape gives the characters; no request to `/v1/plots/:plotId`; a room body without `plot` keeps the `NoPlot` notice.

## Tests that try to break it

- Fix 1: a `now` one reply behind attaches nothing and says why; a forced reminder waits; `now` current attaches; a dead status keeps the subject out of PRESENT in the scene input and prompt; the operator's room shape (scene #157, latest #225) attaches nothing.
- Fix 2: a 402 body's message reaches the notice, masked; a failed check is retried at 15 s, 60 s, 300 s and not a fourth time; a later reply is checked meanwhile; the header line appears after the third failure and goes on the next success; a key save clears a `Failed` stop and the next tick reads; Last calls lists live calls and keeps a cut-off answer's first 2,000 characters.
- Fix 3: the Staff case (two messages, two quotes) is kept and shown; a line whose quote is not in the cited message is refused; ended facts and closed threads reach the pass input; Dismiss; the list never blocks.

## Files

`scribe/core/ScribeGateway.js`, `ScribeAnalyzer.js`, `ScribeAdoption.js`, `ScribeReplay.js` if the advisory operation needs replay; `scribe/page/ScribeLive.js`, `ScribeScene.js`, `ScribeKeeper.js`, `ScribeBoot.js` (only what the retries and Last calls need), `ScribePanel.js`, `PanelView.js`; their tests; `scribe/scribe.user.js` rebuilt; `docs/verification/scribe-page-verification.md`. Not `scribe/page/ScribeCloud.js` or `tests/scribe-cloud.test.mjs` (the cloud Task 2 fix round runs at the same time).
