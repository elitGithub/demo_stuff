# Fork verification refresh, prefix cutoff, and diagnostics

24 November 2026. One implementation task for the [approved design](../specs/2026-11-24-scribe-fork-verification-design.md). Zero new dependencies, zero model calls, zero writes to parent room storage.

## Task 1. Refresh stale parent history, inherit verified prefixes with cutoff, and report exact mismatch diagnostics

### Code changes

- [ ] **`scribe/core/ScribeFork.js`**
  - Add `ScribeFork.mismatch(before, after)` returning `string|null`:
    - `!after` -> `'the fork has fewer messages than the source'`
    - `before.messageTime !== after.messageTime` -> `'message timestamp differs'`
    - `!ScribeFork.equal(before.sender, after.sender)` -> `'sender differs'`
    - `!ScribeFork.equal(before.contents, after.contents)` -> `'message content differs'`
    - `before.candidateId && after.candidateId && before.candidateId !== after.candidateId` -> `'candidate ID differs'`
    - otherwise `null`.
  - In `ScribeFork.stage(source, messages, intake, sourceRoomId, roomId, selected, current)`:
    - Normalize `const target = typeof selected === 'string' && selected !== '' ? selected : null;`.
    - Track `let mismatch = null;` during the prefix loop; on first non-null `reason = ScribeFork.mismatch(before, after)`, set `mismatch = { index, parentId: before.id, childId: after?.id ?? null, reason }; break;`.
    - Break after mapping `before.id` when `target && target === before.id`.
    - Compute `cutoff` and verification failure:
      - If `target !== null && mapping.has(target)`: `cutoff = null`.
      - Else if `mapping.size > 0 && played`:
        - When `target === null`: `cutoff = null`.
        - When `target !== null && mismatch !== null`: `cutoff = { selected: target, index: mismatch.index, parentId: mismatch.parentId, childId: mismatch.childId, reason: mismatch.reason, detail: 'passage #' + (mismatch.index + 1) + ' (' + mismatch.parentId + ') — ' + mismatch.reason + '.' }`.
        - When `target !== null && mismatch === null`: `cutoff = { selected: target, index: parent.length, parentId: null, childId: messages[parent.length]?.id ?? null, reason: 'selected passage was not found in the source chat', detail: 'selected passage was not found in the source chat.' }`.
      - Else throw:
        - `mismatch !== null`: `'Fork verification failed at passage #' + (mismatch.index + 1) + ' (' + mismatch.parentId + '): ' + mismatch.reason + (target ? ' (selected ' + target + ').' : '.')`
        - `target !== null`: `'Fork verification failed: selected passage ' + target + ' was not found in the source chat and no non-intro passage matched.'`
        - otherwise: `'Fork verification failed: only intro passages matched (no played passage verified).'`
    - Return `{ book, shared: mapping.size, read: credited.size, mapping, sourceIntake, cutoff, mismatch }`.

- [ ] **`scribe/page/ScribeBoot.js`**
  - Update `ScribeBoot.forkSource(session, sourceRoomId, request, { selected = null, refresh = false, book = null } = {})`:
    - Reuse `book` when `refresh === true && ScribeKeeper.soundBook(book) && book.adopted`.
    - Otherwise read local `ScribeStore.read(storage, sourceRoomId, kinds.Book)` inside `try/catch` (treating damaged/unsound/unadopted local Book as `null`), falling back to `await session.cloud.forkBook(sourceRoomId, request.signal)`. Enforce `request.signal.throwIfAborted()` and throw `'No adopted Book was found for this saved chat.'` if `!ScribeKeeper.soundBook(book) || !book.adopted`.
    - When `!refresh`, read `ScribeStore.read(storage, sourceRoomId, kinds.Campaign)` inside `try/catch` (treating damaged as `null`).
    - Check cache eligibility: `campaign?.completeHistory === true && !campaign.needsHistory && Array.isArray(campaign.messages) && campaign.messages.length > 0`, and building `const known = new Set(campaign.messages.map((row) => row?.id))`, verify:
      - `typeof selected !== 'string' || selected === '' || known.has(selected)`
      - `Object.keys(book.log.read).every((id) => known.has(id))`
      - `Object.values(book.log.checkRequests ?? {}).every((item) => typeof item?.messageId !== 'string' || known.has(item.messageId))`
    - Return `{ book, messages: campaign.messages, cached: true }` when eligible; otherwise fetch `await ZetaSource.history({ ...request, roomId: sourceRoomId })`, require `history.completeHistory === true`, and return `{ book, messages: history.messages, cached: false }`. Never write to parent storage.
  - Update `recoverFork` wiring at `ScribeBoot.js:2648-2649`:
    `recoverFork: (sourceRoomId, messageId) => ScribeBoot.forkAction(session, fetch, (request) => keeper.recoverFork(sourceRoomId, messageId, (room, options) => ScribeBoot.forkSource(session, room, request, { ...options, selected: messageId })))`

- [ ] **`scribe/page/ScribeKeeper.js`**
  - In `ScribeKeeper.recoverFork(keeper, sourceRoomId, messageId, loadSource)`:
    - Pass 1 calls `await loadSource(sourceRoomId)`.
    - Validate `ScribeKeeper.soundBook(source?.book) && source.book.adopted` right after `loadSource` and `current()` check (returning `{ ok: false, reason: 'Fork recovery needs an adopted source Book and a fork without independent Book changes.' }` without refreshing).
    - Pull fresh child history when `!campaign.completeHistory || campaign.needsHistory || keeper.partial || keeper.unjoined || keeper.mismatch !== null || keeper.suspectAt !== null`; delete `campaign.observations` alongside `needsHistory`, `awaitingFirstPull`, and `recheck` on the fresh `campaign`.
    - Run `ScribeFork.stage` against `source`. When `source.cached === true`, refresh once **before** `ScribeFork.requests` if:
      - `ScribeFork.stage` threw, OR
      - `result.cutoff !== null`, OR
      - `result.mismatch !== null && result.mismatch.childId !== null` and at least one ID in `Object.keys(source.book.log.read)` is missing from `source.messages` or has index `>= result.mismatch.index` in `source.messages`.
    - Otherwise run `await ScribeFork.requests(result, source.book, taken.intake.messages)`. If that throws while `source.cached === true`, also run the single refresh retry.
    - For the single refresh retry:
      - Recheck `current()` before calling `await loadSource(sourceRoomId, { refresh: true, book: source.book })`, recheck `current()` after it resolves, verify `ScribeKeeper.soundBook(refreshed?.book) && refreshed.book.adopted`, run `ScribeFork.stage` and `await ScribeFork.requests` once, and propagate any error through the outer `catch` as `{ ok: false, reason: ScribeKeeper.words(error) }`.
    - Recheck `current()` right after `await ScribeFork.requests` and before `ScribeStore.installFork` (returning `{ ok: false, reason: 'Fork recovery stopped because the room changed.' }` if `!current()`).
    - Return `{ ok: true, shared: result.shared, read: result.read, ...(result.cutoff ? { cutoff: result.cutoff } : {}) }`.

- [ ] **`scribe/page/ScribePanel.js`**
  - In `ScribePanel.pullFork(panel, sourceRoomId, messageId)`:
    - Keep exact existing `action.done` text when `!result.cutoff`.
    - When `result.cutoff` is truthy, append `' Stopped before selected passage ' + result.cutoff.selected + ': ' + result.cutoff.detail`.

- [ ] **Shipped userscript (`scribe/scribe.user.js`)**
  - Update the four modified sections and bump `@version` from `0.3.46` to `0.3.47` via visible Edit calls; verify exact normalized equality with `ScribePack.build(realRead, '0.3.47')` and `node --check scribe/scribe.user.js`.

### Tests that try to break the task

- [ ] **`tests/scribe-fork.test.mjs`**
  - Update line 64 (`stage(data, 'parent3')` with candidate mismatch at index 3) to assert `shared === 3`, `read === 3`, and `cutoff` matching passage `#4 (parent3)` / `candidate ID differs`.
  - Update lines 65-66 (`data.child[1].contents[0].text += ' edited'`) to assert diagnostic error `/Fork verification failed at passage #2 \(parent1\): message content differs\./`.
  - Keep line 109 (`assert.deepEqual({...result}, {ok: true, read: 1300, shared: 1300})`) unchanged to prove `cutoff` is omitted when `null`.
  - Add adversarial cases for `ScribeFork.stage`:
    - `selected` missing from `parent` with played prefix -> succeeds with `cutoff.reason === 'selected passage was not found in the source chat'` and `cutoff.index === parent.length`.
    - `selected` at `parent0` (intro) when `parent0` matches -> succeeds with `cutoff === null`.
    - Every failure diagnostic (`messageTime`, `sender`, `contents`, `candidateId`, shorter fork, missing `selected` with intro-only match, intro-only picker match).
  - Add adversarial cases for `ScribeKeeper.recoverFork`:
    - `source.cached === true` throws in `stage` -> refreshes once with `{ refresh: true, book }`, succeeds, never calls a 3rd time.
    - `source.cached === true` hits `cutoff` (stale cache diverged before `selected`) -> refreshes once before `ScribeFork.requests`, recovers through `selected`.
    - `source.cached === true` hits `mismatch` (`childId !== null`) before a read message when `selected === null` -> refreshes once and recovers all read passages.
    - `source.cached === true` with shorter fork (`!after`, `cutoff === null`) -> does NOT refresh.
    - `source.cached === true` with matching prefix and extra child-only messages -> does NOT refresh.
    - `source.cached` absent/false on failure or `cutoff` -> never refreshes.
    - Refresh fails (network/incomplete) -> returns `{ ok: false, reason }` without installing stale Book.
    - Room/generation changes during refresh -> returns `{ ok: false, reason: 'Fork recovery stopped because the room changed.' }` without installing.
    - Stale unjoined child `campaign` (`keeper.unjoined` / `keeper.partial` with queued `observations`) -> pulls fresh child history and drops pre-pull `observations`.

- [ ] **`tests/scribe-boot.test.mjs` and `tests/scribe-whole.test.mjs`**
  - `forkSource` skips stale local parent `campaign` when `selected` is missing, when a `book.log.read` or `checkRequests` ID is missing, or when local parent `campaign` is damaged; fetches fresh Zeta history without writing parent storage.
  - `forkSource` with `refresh: true` reuses passed `book` (zero extra Worker lookups).
  - End-to-end installed script test in `tests/scribe-whole.test.mjs`:
    - Observed clone where parent's local `campaign` is stale (missing new messages including `selected`, or containing pre-edit text) pulls fresh parent history from Zeta, leaves parent storage untouched, and recovers through `selected`.
    - Observed clone where fresh parent and fork diverge after a played prefix recovers the verified prefix and renders the cutoff explanation in `scribe-fork-outcome`.
    - Existing shorter-fork picker route continues to make zero extra parent Zeta pulls and renders exact unchanged outcome text.

- [ ] **Verification run**
  - Run `node --check scribe/scribe.user.js`, `tests/scribe-pack.test.mjs`, `tests/scribe-fork.test.mjs`, `tests/scribe-boot.test.mjs`, `tests/scribe-keeper.test.mjs`, `tests/scribe-panel.test.mjs`, and `tests/scribe-whole.test.mjs`.
