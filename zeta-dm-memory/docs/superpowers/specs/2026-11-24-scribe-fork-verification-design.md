# Fork verification refresh, prefix cutoff, and diagnostics

Proposed design, 24 November 2026. Extends `docs/superpowers/specs/2026-11-19-scribe-room-forks-design.md`.

## Problem

Fork recovery fails with `"The original messages do not verify this fork through the selected passage."` when the parent room has new messages or edits not present in this browser's cached parent `campaign`, or when any passage before an observed clone point (`selected`) differs between parent and fork:

1. `ScribeBoot.forkSource` trusts the parent room's local cached `campaign` whenever `campaign.completeHistory` is true, without checking whether the cache contains `selected` or the message IDs referenced by `book.log.read` and `book.log.checkRequests`, and never retries with fresh Zeta history when verification fails or stops early against the cached parent.
2. `ScribeFork.stage` rejects the entire fork whenever an observed `selected` message ID is not reached, even when a verified played prefix (at least one non-intro message) matches before the divergence, and `ScribePanel` locks the recovery button to `origin.messageId` whenever an observed clone origin exists.
3. `ScribeFork.stage` collapses every verification failure (missing `selected`, timestamp/sender/content/candidate mismatch, shorter fork, or intro-only match) into one generic sentence with no passage number, message ID, or differing field.

## Decisions

### 1. Parent history freshness (cache-first, auto-refresh on gap or mismatch)

- **Signature and wiring:**
  - `ScribeBoot.forkSource(session, sourceRoomId, request, { selected = null, refresh = false, book = null } = {})`
  - In `ScribeBoot.js`, `recoverFork` wires:
    `keeper.recoverFork(sourceRoomId, messageId, (room, options) => ScribeBoot.forkSource(session, room, request, { ...options, selected: messageId }))`
  - `ScribeKeeper.recoverFork` calls `loadSource(sourceRoomId)` on pass 1 (keeping 1-arg test stubs compatible) and `loadSource(sourceRoomId, { refresh: true, book: source.book })` on pass 2 (only when `source.cached === true`).
- **Source Book loading in `forkSource`:**
  - When `refresh === true` and `book` is passed (and passes `ScribeKeeper.soundBook(book) && book.adopted`), reuse `book` without re-reading storage or the Worker.
  - Otherwise, try `ScribeStore.read(storage, sourceRoomId, kinds.Book)` (treating a damaged read as `null`); if the local Book is missing or fails `ScribeKeeper.soundBook(book) && book.adopted`, fall back to `session.cloud.forkBook(sourceRoomId, request.signal)`. If still missing or not sound/adopted, throw `'No adopted Book was found for this saved chat.'`.
- **Cache eligibility in `forkSource` (pass 1, `refresh === false`):**
  - Read `ScribeStore.read(storage, sourceRoomId, kinds.Campaign)` inside a `try/catch` so a damaged local parent `campaign` falls back to Zeta instead of aborting.
  - Use cached `campaign.messages` only when all of these hold:
    - `campaign?.completeHistory === true`, `!campaign.needsHistory`, `Array.isArray(campaign.messages)`, and `campaign.messages.length > 0`;
    - building `const known = new Set(campaign.messages.map((row) => row?.id))`:
      - if `typeof selected === 'string' && selected !== ''`, `known.has(selected)`;
      - every key in `Object.keys(book.log.read)` is in `known`;
      - every `entry?.messageId` in `Object.values(book.log.checkRequests ?? {})` (when `typeof entry?.messageId === 'string'`) is in `known`.
  - When eligible, return `{ book, messages: campaign.messages, cached: true }`.
  - Otherwise (including `refresh === true`), fetch complete parent history via `ZetaSource.history({ ...request, roomId: sourceRoomId })`, require `history.completeHistory === true`, and return `{ book, messages: history.messages, cached: false }`.
  - `forkSource` never writes to or mutates any parent room storage key.
- **Child history freshness in `ScribeKeeper.recoverFork`:**
  - Pull fresh complete child history from `keeper.zeta.history` when `!campaign.completeHistory || campaign.needsHistory || keeper.partial || keeper.unjoined || keeper.mismatch !== null || keeper.suspectAt !== null`.
  - When replacing `campaign` with fresh child history, delete `campaign.observations` alongside `needsHistory`, `awaitingFirstPull`, and `recheck` so pre-pull queued observations are not replayed later.
- **Guard validation and single refresh retry in `ScribeKeeper.recoverFork`:**
  - Before calling `ScribeFork.stage`, verify `ScribeKeeper.soundBook(source?.book) && source.book.adopted` (returning `{ ok: false, reason: 'Fork recovery needs an adopted source Book and a fork without independent Book changes.' }` without refreshing).
  - Run `ScribeFork.stage` on pass 1. When `source.cached === true`, check whether a refresh is needed **before** calling `await ScribeFork.requests`:
    - `ScribeFork.stage` threw an error, OR
    - `result.cutoff !== null` (observed `selected` was not reached), OR
    - `result.mismatch !== null && result.mismatch.childId !== null` (a real divergence between existing parent and child passages, excluding `!after` where the fork is simply shorter than a longer parent) AND at least one message ID in `Object.keys(source.book.log.read)` is either absent from `source.messages` or sits at index `>= result.mismatch.index` in `source.messages`.
  - If pass 1 did not trigger refresh after `stage`, run `await ScribeFork.requests(result, source.book, taken.intake.messages)`. If `requests` throws while `source.cached === true`, also trigger the single refresh retry.
  - On refresh retry:
    - Recheck `current()` before calling `loadSource(sourceRoomId, { refresh: true, book: source.book })`, after `loadSource` resolves, and after pass-2 `await ScribeFork.requests` right before `ScribeStore.installFork` (returning `{ ok: false, reason: 'Fork recovery stopped because the room changed.' }` if `!current()`).
    - Re-run `ScribeFork.stage` and `ScribeFork.requests` once against the refreshed `source`.
    - If the fresh Zeta pull or pass-2 staging fails, `recoverFork` catches the error and returns `{ ok: false, reason: ScribeKeeper.words(error) }` rather than installing a truncated Book from stale cache (`ScribeBoot.forkAction` still enforces `controller.signal.throwIfAborted()`).
  - When `source.cached` is falsy (fresh Zeta fetch or test stubs returning `{ book, messages }`), `recoverFork` never calls `loadSource` a second time.

### 2. Verified prefix inheritance with cutoff reporting when `selected` is not reached

- Normalize `const target = typeof selected === 'string' && selected !== '' ? selected : null;` in `ScribeFork.stage`.
- Add `ScribeFork.mismatch(before, after)` returning `string|null`:
  - `!after`: `'the fork has fewer messages than the source'`
  - `before.messageTime !== after.messageTime`: `'message timestamp differs'`
  - `!ScribeFork.equal(before.sender, after.sender)`: `'sender differs'`
  - `!ScribeFork.equal(before.contents, after.contents)`: `'message content differs'`
  - `before.candidateId && after.candidateId && before.candidateId !== after.candidateId`: `'candidate ID differs'`
  - otherwise `null`.
- Walk `parent` and `messages` from index `0`. On the first non-null `reason = ScribeFork.mismatch(before, after)`, record:
  `mismatch = { index, parentId: before.id, childId: after?.id ?? null, reason }`
  and break.
- Stop when `target && target === before.id`.
- Post-loop decision:
  - **Reached `target` (`target !== null && mapping.has(target)`):** proceed through `target` (including if `target` is an intro passage) with `cutoff = null`.
  - **Did not reach `target` (`target !== null && !mapping.has(target)`):**
    - If `mapping.size > 0 && played` (at least one matched passage had `before.isIntro === false && after.isIntro === false`), inherit the verified prefix through `boundary` and set `cutoff`:
      - When `mismatch !== null`:
        `{ selected: target, index: mismatch.index, parentId: mismatch.parentId, childId: mismatch.childId, reason: mismatch.reason, detail: 'passage #' + (mismatch.index + 1) + ' (' + mismatch.parentId + ') — ' + mismatch.reason + '.' }`
      - When `mismatch === null` (parent ended without containing `target`):
        `{ selected: target, index: parent.length, parentId: null, childId: messages[parent.length]?.id ?? null, reason: 'selected passage was not found in the source chat', detail: 'selected passage was not found in the source chat.' }`
    - Otherwise (`!mapping.size || !played`), throw the diagnostic error below.
  - **No `target` (`target === null`, saved-chat picker):**
    - If `mapping.size > 0 && played`, inherit through `boundary` with `cutoff = null` (keeping `mismatch` on the returned object).
    - Otherwise (`!mapping.size || !played`), throw the diagnostic error below.
- `ScribeFork.stage` returns `{ book, shared: mapping.size, read: credited.size, mapping, sourceIntake, cutoff, mismatch }`.

### 3. Actionable diagnostics in errors and UI outcomes

- Verification failure errors thrown by `ScribeFork.stage`:
  - `mismatch !== null`:
    `'Fork verification failed at passage #' + (mismatch.index + 1) + ' (' + mismatch.parentId + '): ' + mismatch.reason + (target ? ' (selected ' + target + ').' : '.')`
  - `mismatch === null && target !== null`:
    `'Fork verification failed: selected passage ' + target + ' was not found in the source chat and no non-intro passage matched.'`
  - `mismatch === null && target === null`:
    `'Fork verification failed: only intro passages matched (no played passage verified).'`
- `ScribeKeeper.recoverFork` returns `{ ok: true, shared: result.shared, read: result.read, ...(result.cutoff ? { cutoff: result.cutoff } : {}) }` on success (omitting `cutoff` when `null` so existing callers/tests expecting `{ ok, shared, read }` remain unchanged).
- `ScribePanel.pullFork` keeps the exact existing success text when `!result.cutoff`:
  `'Recovered ' + result.read + (result.read === 1 ? ' message reading' : ' message readings') + ' from ' + sourceRoomId + '. Verified ' + result.shared + (result.shared === 1 ? ' shared message.' : ' shared messages.')`
  When `result.cutoff` is truthy, append:
  `' Stopped before selected passage ' + result.cutoff.selected + ': ' + result.cutoff.detail`

## Non-goals and invariants

- Parent room storage (`campaign`, `book`, `live`, `settings`) is strictly read-only during fork recovery.
- No model calls run during fork recovery.
- A current fork Book with entries outside the verified source readings is still rejected; `ScribeStore.installFork` rollback and generation/lock checks remain unchanged.
- `scribe/scribe.user.js` is rebuilt with `node scribe/pack.mjs` so the installed userscript matches the sources.

## Verification

- Update existing expectations in `tests/scribe-fork.test.mjs`:
  - Line 64 (`stage(data, 'parent3')` with candidate mismatch at index 3): now verifies prefix inheritance (`read: 3`, `shared: 3`) with `cutoff` naming passage `#4 (parent3)` and `candidate ID differs`.
  - Lines 65-66 (`data.child[1].contents[0].text += ' edited'`): asserts the diagnostic error naming passage `#2 (parent1)` and `message content differs`.
  - Line 109 (`assert.deepEqual({...result}, {ok: true, read: 1300, shared: 1300})`): continues passing unchanged because `cutoff` is omitted when `null`.
- Add unit tests in `tests/scribe-fork.test.mjs`:
  - `ScribeFork.stage` prefix fallback with `cutoff` when `selected` is past a divergence (candidate mismatch, content edit, timestamp mismatch, shorter fork) or missing from `parent`, while a played prefix matches.
  - `ScribeFork.stage` failure diagnostics for every mismatch kind (`messageTime`, `sender`, `contents`, `candidateId`, shorter fork, missing `selected` with intro-only match, intro-only picker match).
  - `ScribeKeeper.recoverFork` single refresh retry when `source.cached === true` throws, hits `cutoff`, or truncates a read passage (`mismatch.childId !== null`); no refresh when `source.cached` is falsy, when the fork is merely shorter than a longer parent (`!after`, `cutoff === null`), or when cached parent covers all read passages and matches (even with newer child-only messages); `current()` abort/generation-change checks before and after refresh; failure propagation as `{ ok: false, reason }` when refresh fails; stale unjoined child `campaign` pulls fresh child history and clears `observations`.
- Add integration tests in `tests/scribe-boot.test.mjs` and `tests/scribe-whole.test.mjs`:
  - Observed clone where parent's local `campaign` is stale (missing new messages including `selected`, holding an unedited earlier message, or damaged) triggers fresh parent history pull from Zeta, reuses the loaded Book without duplicate Worker lookups, leaves parent storage untouched, and recovers through `selected`.
  - Observed clone where even fresh parent history diverges before `selected` recovers the verified prefix and displays the cutoff explanation in `scribe-fork-outcome`.
  - Existing Route 2 shorter-fork test (`tests/scribe-whole.test.mjs:5654-5812`) issues zero extra parent Zeta pulls and preserves the exact outcome text when `cutoff` is null.
- Rebuild `scribe/scribe.user.js` with `node scribe/pack.mjs` and pass `tests/scribe-pack.test.mjs`, `tests/scribe-fork.test.mjs`, `tests/scribe-boot.test.mjs`, `tests/scribe-keeper.test.mjs`, `tests/scribe-panel.test.mjs`, and `tests/scribe-whole.test.mjs`.
