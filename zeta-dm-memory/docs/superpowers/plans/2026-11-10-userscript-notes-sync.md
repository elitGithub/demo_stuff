# Userscript Notes Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. The operator's instructions override stock TDD, Git, installation, and automatic fix-loop instructions.

**Status:** Approved by the operator on 2026-11-10. Design approved on 2026-11-10.

**Goal:** Add notes-only cloud sync and a saved-room import picker to the working Tampermonkey script without rewriting its existing behavior.

**Architecture:** Extend the original v1.2 IIFE with one local cloudSync object and narrow hooks in room-state access, notes input, widget construction, UI refresh, and room/focus changes. Keep the narrator and send implementation intact. Exercise the installed script through a dependency-free VM/browser harness and mocked GM requests.

**Tech stack:** Existing JavaScript userscript, Tampermonkey GM APIs, localStorage, existing Node.js v24.11.0 test runner. No new packages or build step.

**Spec:** [Approved userscript design](../specs/2026-11-10-userscript-notes-sync-design.md).

## Global constraints

- Additive patch only. Preserve the working layout, original settings/localStorage keys, narrator formatting, React setter, Paste, counting, force-next, minimized state, keyboard and pointer handling, and 800 ms widget loop. Do not modernize or reformat original code.
- API origin is https://zeta-dm-memory.elit1989.workers.dev. Existing endpoints, SQL, schema, and Worker are unchanged.
- Exact pathname is the string roomId. Recognize localized room routes such as /en/rooms/CHAT_ID; never convert an identifier to an integer or normalize its spelling.
- Only notes and expectedRevision enter PUT JSON. Notes preserve whitespace and valid Unicode up to 65,536 UTF-8 bytes. Empty notes are valid.
- A changed note waits for 500 ms of inactivity and completed IME composition. Settings changes, no-op edits, and widget ticks produce no PUT.
- Keys contain 60-254 visible ASCII characters, including punctuation. Keep keys in Tampermonkey private storage and request headers, never source/page storage/DOM/URLs/logs.
- Read before a first upload; preserve dirty notes, use revision checks, capture room identity, and prevent stale responses from replacing later edits or another room's UI.
- Import uses a paginated list of saved identifiers, 25 per page. Copy only notes, with confirmation before replacing different nonempty destination notes.
- Product code is written by an implementer subagent. Retain the approved GPT-6.1 Sol high implementer and GPT-6 Astra high reviewer substitutions. Root writes orchestration documents and verifies claims.
- Code first, then tests. All checks here are database-free. No actual API, key, chat messages, SQLite, application DB, installations, Git writes, deletions, deployment, or unrelated edits.
- Every file change uses apply_patch. Keep reports outside the repository at C:/Users/elit1/.claude/projects/-var-www-demo-stuff/sdd-snapshots/zeta-dm-userscript-sync/.

## Review focus

1. Navigation between a note edit and the existing 800 ms path check must never save old-room text into a new room; test both pending requests and focused notes input.
2. A successful PUT whose response is lost must reconcile by reading matching cloud notes, without a duplicate update or silent overwrite.
3. Typing during a pending save or an import fetch must preserve the newer local draft and its remaining 500 ms debounce.
4. Changing grants must preserve the original injection behavior; compare untouched source sections and test the existing native-setter/event/send flow in the harness, with live browser verification explicitly pending.
5. Remote identifiers, notes, pagination cursors, malformed payloads, and credentials must remain literal data; test text-only rendering, room identity, key isolation, and rejected redirects.

---

### Task 1: Patch, verify, and deliver the working userscript

This is one reviewable feature task. Setup, tests, and instructions belong to the same deliverable; do not split out a refactor or dispatch follow-on feature work.

**Files:**

| Action | File | Responsibility |
|---|---|---|
| Create | zeta-dm-memory.user.js | Original script plus the scoped sync addition |
| Create | tests/fixtures/zeta-dm-memory.v1.2.js | Exact original attachment contents for preservation checks |
| Create | tests/support/UserscriptHarness.mjs | VM, minimal DOM/events, controlled timers/storage, mocked GM transport |
| Create | tests/userscript.test.mjs | Behavioral and preservation regressions |
| Modify | README.md | Userscript installation, key menu, sync/import use, checks and limits |
| Create | docs/verification/userscript-verification.md | Actual automated evidence and pending operator browser checks |

The specifically supplied source is C:/Users/elit1/.codex/attachments/28e81ca3-b879-47ca-bfdd-7b11e3abbdd1/Pasted text.txt. Read only that attachment; do not alter it. Preserve its existing content in the baseline fixture using a visible patch, with no normalization beyond any unavoidable line-ending handling. Existing comments, styles, and display content are not an invitation to cleanup.

#### Step 1: Establish the additive boundary

- [ ] Create the baseline fixture and updated userscript from v1.2. Keep @name, @namespace, @match, and @run-at. Increment metadata and displayed version to 1.3. Replace @grant none with GM_getValue, GM_setValue, GM_xmlhttpRequest, GM_registerMenuCommand, and GM_addValueChangeListener; add @connect zeta-dm-memory.elit1989.workers.dev. No @require, wildcard connection, page-global API bridge, or runtime import.
- [ ] Keep formatNotesAsNarrator, setReactInputValue, findChatInput, checkAndInject, and the existing keydown/pointerdown handlers unchanged. New import controls use select/buttons; conflict notes use a pre element populated with textContent. Do not add a textarea or text input that the original generic chat-input finder could capture.
- [ ] Only narrowly edit getRoomKey, loadRoomState, saveRoomState, buildWidget, syncUI, notes input handling, and the existing path-change branch. New sync functions live inside the existing IIFE, not in a replacement application/module tree.

#### Step 2: Define local state and integration interfaces

Extend the original room helpers with optional roomId arguments defaulting to window.location.pathname: getRoomKey(roomId), loadRoomState(roomId), and saveRoomState(state, roomId). Keep the original storage key prefix and fields. Let saveRoomState return true/false for persistence success; existing callers can ignore that result. New cloud failures must not leak notes or keys in console messages.

Persist sync bookkeeping as one optional cloudSync member in the same local room record as notes, so a notes edit and its dirty marker are written together:

| Field | Meaning |
|---|---|
| revision: number or null | null means unverified; 0 means a confirmed missing record; positive safe integer means known cloud revision |
| baseNotes: string or null | Last acknowledged/confirmed cloud text; null until known |
| dirty: boolean | Current notes require explicit reconciliation or saving |
| editId: string | Unique local edit token, generated for a genuine notes change |
| editedAt: number | Time of the latest relevant edit/debounce reset in milliseconds |
| conflict: Memory or null | Remote snapshot shown for explicit resolution, when present |

Migration treats an existing nonempty note without metadata as an unverified dirty draft; an empty unmodified default is clean. An intentional edit to empty while the first fetch is pending is dirty and must not be mistaken for that default. Invalid sync metadata becomes unverified without erasing valid original notes/settings. Runtime timers, request handles, and UI objects are not serialized. Same-browser localStorage sharing is retained; no new multi-tab locking service is introduced.

Define these methods on the new cloudSync object; subordinate callbacks/data fields remain implementer choices. New methods have tag-only JSDoc.

| Signature | Contract |
|---|---|
| start(): void | Register key/retry menu commands, key-change listener, and focus integration once |
| isChatRoom(roomId: string): boolean | Recognize /rooms/nonempty-id or /locale/rooms/nonempty-id with optional trailing slash; preserve the entire pathname |
| activateRoom(roomId: string): void | Bind the visible editor and initiate one initial read for a valid chat |
| editNotes(roomId: string, notes: string): void | Persist notes/dirty marker together and schedule only a real change |
| schedule(roomId: string): void | Respect edit deadline, composition, pending work, retry delay, and blocked state |
| synchronize(roomId: string, refresh: boolean): Promise<void> | Serialize read/reconcile/conditional save work for that room |
| request(method: string, path: string, query: object, body: object or null): Promise<ApiResult> | Fixed-origin GM transport; capture credential generation; bounded completion |
| resolveConflict(roomId: string, choice: string): Promise<void> | Explicit UseCloud or KeepLocal resolution against the shown snapshot |
| attachControls(widget: HTMLElement): void | Add the status/import/conflict controls once |
| render(roomId: string): void | Render current-room status and temporary sections without replacing active typed notes |
| openImport(roomId: string): Promise<void> | Open source picker and load its first page |
| loadImportPage(roomId: string, after: string or null): Promise<void> | Validate and render one 25-item page; maintain visited cursor navigation |
| importNotes(destinationRoomId: string, sourceRoomId: string): Promise<void> | Guard destination generation, fetch source, confirm replacement, and call editNotes |

Memory is a validated readonly record containing roomId, notes, revision, updatedAt. Page contains validated metadata items and nextCursor. ApiResult contains status, parsed data, and retryAfter; raw driver/network objects never become persistent room state. Use named frozen cases for new status/choice values. No test hooks, secret-bearing globals, or exported page APIs are added.

- [ ] Implement these state/contracts and small original-helper extensions without rearranging the original script.

#### Step 3: Add credentials and bounded transport

- [ ] Store only the key under the private GM key zeta_dm_api_key. Register Set DM API key and Retry notes sync. The set action uses a native prompt with no existing key as its default. Cancel preserves configuration; invalid input is rejected without logging it. On an actual key change, invalidate/abort old credential-generation work, clear automatic-auth blocking, and read the active room before uploading. GM_addValueChangeListener applies the same invalidation in another tab.
- [ ] Use GM_xmlhttpRequest with the fixed origin, encoded query parameters, Authorization, JSON body/content type for PUT, anonymous: true, and redirect: error. Set timeout to 15000 ms and add an independent 15000 ms abort timer because transport modes differ in timeout support. Complete/reject once, clear the timer, and handle error/timeout/abort callbacks. A missing abort handle must not leave the promise unresolved. Reject an unexpected final origin before applying a response.
- [ ] Validate successful Memory/Page responses, exact requested room identity, positive safe revisions, UTC timestamps, notes Unicode/byte limit, at most 25 page items, and valid nullable nextCursor. Use the API's generic roomId validation for source/cursor entries, including test-room identifiers. Only memory_not_found from the expected read is a confirmed absence. Error bodies never become notes; show controlled status text without raw request, headers, or response dumps.
- [ ] Preserve no-key local operation. Invalid key/configuration and 401 stop automatic retries. Network failures, 500, database_unavailable, and retryable platform failures use at most five retries at 1000, 2000, 4000, 8000, and 16000 ms. A 429 waits at least its valid Retry-After seconds and the debounce/backoff deadline. If a delay cannot be represented safely by the timer, pause for manual retry instead of retrying early. Other 4xx errors stop until a relevant user change or explicit retry.

#### Step 4: Implement synchronization and attach narrow hooks

- [ ] On first read: adopt cloud text only for a clean local copy; reconcile identical dirty text as already saved; preserve differing dirty text. If its known baseline revision matches the cloud revision, allow the debounced write. Otherwise show a conflict. A confirmed missing record enables expectedRevision 0; preserve local notes and do not automatically create an untouched empty default.
- [ ] The notes input hook captures the field's bound roomId. If the pathname changed before the 800 ms loop, rebind/refresh rather than writing the old field into the new room. Record edits locally immediately, including during composition. compositionstart cancels a pending save; compositionend permits a save only after a fresh 500 ms quiet interval. Unchanged text does not schedule another PUT.
- [ ] Serialize each room's read/PUT sequence. Each operation captures roomId, editId, notes, expected revision, and credential generation. On successful PUT, update only the accepted cloud baseline and revision; re-read current local state before marking clean. Never downgrade a newer known revision or discard another editId's different text. If current notes differ from acknowledged notes, keep dirty and respect the current edit deadline before the next PUT. A later edit whose text already equals the accepted snapshot reconciles without an extra PUT.
- [ ] On a timeout or other uncertain save result, the next attempt reads first. Matching remote notes reconcile the lost response. A changed remote baseline produces a conflict. Repeated 409 responses are never converted into an unconditional overwrite or an automatic retry against a newly fetched revision.
- [ ] Restore dirty work after reload through a fresh read. Persist conflicts with their shown snapshot. Use cloud notes requires confirmation if it would replace different local text; Keep my notes writes against the shown remote revision. Protect both actions against changed room/edit/credential generations while dialogs or requests are pending.
- [ ] Hook the original path-change branch and browser focus. Coalesce duplicate reads and avoid overlapping operations. Rebind notes on actual room changes even if the textarea is focused; preserve active typing in the same room. A clean remote update may refresh a focused notes field when its editId has not changed; do not update the hidden baseline while leaving stale clean text visible. The 800 ms loop remains a DOM/path check, not an API poll. Settings/counter saves have no upload hook.
- [ ] A failed local persistence attempt retains the in-memory/visible draft and shows Local save failed. It must not report Saved, upload an older persisted value, or let a refresh erase the failed draft. Explicit retry first attempts to persist that current draft, then resumes cloud work.

#### Step 5: Add the compact status, import, and conflict controls

- [ ] Append one small status/import row inside the existing widget body. Preserve the original controls/styles. Use a scoped style element and classes for new controls; add no external assets. Provide loading/saving/saved/unsynced/conflict states, keyboard focus, and an accessible live status. Ordinary saves require no confirmation.
- [ ] Import expands a select/list with exact roomId and updatedAt text, Previous/Next, Cancel, and rightmost Import. Load GET /v1/memories?limit=25 only on opening/page navigation. Keep only one rendered page and visited cursor navigation; do not fetch all pages. Disable the current room as a source and show empty/loading/error states where the picker is open.
- [ ] Capture destination room/edit generation and selection when Import is clicked. Require completed destination initialization and no unresolved conflict before starting. Fetch the selected source; after return, verify destination and edit generation again. Replacing different nonempty notes uses native confirmation. Recheck guards after confirmation. Cancellation, navigation, typing, or source read failure must leave destination notes untouched. Identical notes cause no PUT. Accepted changed notes, including an intentional clear, enter editNotes and the 500 ms path. Never write the source record or copy its revision/settings to the destination.
- [ ] Render the remote conflict snapshot in a pre element using textContent, with Use cloud notes and Keep my notes actions. Use textContent/value for all remote values and avoid interpolating them into HTML. Native key prompts and new non-text-input controls must not be captured by the unchanged chat-input/send handlers.

#### Step 6: Add behavioral tests after implementation

Create one UserscriptHarness class in tests/support/UserscriptHarness.mjs. Load the real userscript source with node:vm and supply only the controlled browser/GM surface it uses. No network listener, fetch to a server, package, SQLite import, or actual browser/key is used. The harness runs the IIFE as installed; do not export test-only production internals or copy the sync algorithm into tests.

Harness interfaces: constructor({ source, pathname, localStorage, gmStorage }); advance(ms); editNotes(text); navigate(pathname); focus(); click(elementId); change(elementId, value); dispatchComposition(kind); runMenu(label, promptResult); completeRequest(index, { status, data, headers, finalUrl }); failRequest(index, kind); readRoom(roomId). Expose requests, elements, logs, and recorded confirmations/storage writes for assertions. GM storage changes can be delivered through its registered listener. Timers and promises must be flushed deterministically. Baseline original script can use the same harness with unavailable GM APIs because it grants none.

- [ ] Implement the harness and the following named tests. Values in assertions are required outcomes; equivalent direct assertions are allowed without reimplementing behavior under test.

| Test | Required assertions |
|---|---|
| original_injection_sections_are_preserved | Compare named original functions and keydown/pointerdown handler source spans against the v1.2 fixture; assert.equal(actual, original) for each preserved span. Ignore only line endings. |
| original_narration_paste_and_send_behavior | Original and updated scripts produce the same formatted message, counter/reset/force state, 25 ms resend behavior, native setter and input/change events for matching local fixtures. |
| notes_debounce_and_no_op | After an acknowledged baseline, assert zero PUTs at 499 ms, one at 500; another edit resets the wait. Edit back to baseline yields zero PUTs. |
| composition_delays_upload | Persist composing text locally; assert zero PUTs throughout composition and at 499 ms after end; one after 500. |
| settings_and_widget_ticks_stay_local | Change interval/force/minimized and exercise counter/widget ticks; assert zero PUTs and unchanged API payload scope. |
| initial_read_and_migration | Empty defaults adopt remote without a PUT; matching notes reconcile; nonempty different legacy notes show conflict; confirmed 404 permits create with expectedRevision 0; failed fetch permits no PUT. |
| deliberate_empty_and_note_validation | Clearing a known note sends notes: ''; invalid Unicode or 65,537 UTF-8 bytes remain local with an error and no PUT; 65,536 bytes are eligible. |
| navigation_pins_pending_work | Edit room A, navigate to B before 500/800 ms, then deliver responses in reverse order. Assert only A's captured path receives its PUT, B's UI stays B, and no old focused-field edit is written to B. |
| edits_during_save_keep_their_debounce | Edit again while PUT is pending; acknowledge the older text. Assert different newer text remains dirty and no second PUT occurs before its own 500 ms deadline. Returning to the accepted snapshot produces no extra PUT. |
| reload_and_focus_preserve_dirty_notes | Recreate harness with saved local metadata; assert initial GET precedes any PUT. Focus reads cannot overwrite dirty text or silently advance its baseline over a changed cloud revision. A focused clean field refreshes together with its baseline when no edit intervened. |
| uncertain_save_reconciles | Simulate an applied save followed by timeout; next request is GET. Matching cloud text becomes clean with zero repeated PUTs; differing newer text becomes a conflict. |
| retry_limits_and_auth_block | Verify the five finite delays, Retry-After minimum, independent abort timeout, and no hot loop. 401/configuration/validation/conflict stop automatic attempts; relevant explicit action restarts them. |
| conflict_choices_are_conditional | Cancel/UseCloud/KeepLocal preserve or replace exactly the intended text. KeepLocal uses the displayed revision; a second 409 leaves a new conflict. No source or current-room mix-up. |
| local_write_failure_is_visible | Simulated quota failure preserves visible/in-memory text and prevents false Saved/old-value upload; successful manual retry persists and resumes the intended draft. |
| import_pagination_and_literal_rendering | Show at most 25 entries, correct cursor requests and previous navigation; current room disabled. SQL/HTML-looking IDs render literally, and notes are never fetched for every list entry. |
| import_copies_only_destination_notes | Confirmed import changes destination notes and sends its expectedRevision after 500 ms; source is untouched; other local fields stay equal. Empty source clears explicitly, identical source is a no-op, cancel sends nothing. |
| import_races_and_failures_are_safe | Editing/navigation/cancellation during source fetch or confirmation preserves the newer destination; failed/malformed source response sends no PUT. |
| key_storage_transport_and_rotation | Only GM storage/header contains the fictional 60/254-character punctuation key. No key in localStorage, DOM, URL, logs, or source. Validate fixed origin, anonymous request, redirect rejection, timeout, and stale key-generation responses. |
| invalid_api_responses_fail_closed | Reject wrong roomId, missing/invalid fields, unsafe revisions, malformed JSON, oversized notes, invalid cursor/page length and unexpected redirects without overwriting notes or claiming success. |

#### Step 7: Run affected checks and write delivery instructions

- [ ] From zeta-dm-memory run `& 'C:/Program Files/nodejs/node.exe' --check zeta-dm-memory.user.js` and `& 'C:/Program Files/nodejs/node.exe' --test tests/userscript.test.mjs`. Expected: both exit 0; tests fail=0, cancelled=0, skipped=0. Do not use a broad test glob or run SQLite/API suites unrelated to unchanged code.
- [ ] Inspect the complete userscript diff against the original fixture, and verify every change is a listed hook/addition. From the workspace root run `git -c safe.directory=//wsl.localhost/Ubuntu/var/www/demo_stuff diff --check -- zeta-dm-memory`; include untracked file contents separately in the review package.
- [ ] Update README: replace the existing script in Tampermonkey instead of running two copies; retain its name/namespace; save; accept only the specific Worker connection permission; set the private key through the new menu in each browser; reload a room. Explain the 500 ms behavior, import picker, source independence, conflict choices, errors/retry, and unchanged local settings. Link the installable .user.js file and exact database-free check commands. Mention that native key prompt input is visible while entered and should not be included in screenshots.
- [ ] Record actual runtime/commands/results in docs/verification/userscript-verification.md. Operator browser checks remain pending: original injection/Paste/send, same-room cross-browser read/save, initial legacy notes, independent room navigation, import/cancel/clear, and failure/retry. No agent sends an AI-chat message or uses a live credential. State VM tests do not prove real React/Tampermonkey behavior.

#### Step 8: Review and handoff

- [ ] Implementer writes its report in the external snapshot directory, with file list, fresh checks, original-source preservation evidence, and concerns. Root sends the exact original-to-updated source diff, full new files, approved spec/plan, and evidence to the adversarial reviewer with THIS CODE IS WRONG! PROVE OTHERWISE! Include auth/privacy and browser race coverage.
- [ ] Root verifies each finding with one focused check. Propose necessary fix rounds for operator ruling, then scoped re-review. Resolve every finding before a commit-ready handoff. No automatic unrelated cleanup.
- [ ] Handoff starts Commit-ready. or NOT commit-ready: and links the updated userscript and evidence, with installation actions and honest pending browser checks. Do not deploy, mutate Git, or start a follow-on task.

## Plan self-review

- Preservation and additive scope are pinned by Steps 1-2 and the original-source/behavior regressions.
- Credentials/transport/privacy are Step 3; local persistence, initialization, debounce, conflicts, races, and retries are Steps 2-4; the selected paginated import UI is Step 5.
- All five Review Focus conditions have named tests in Step 6. Unchanged backend behavior needs no database run.
- Method names, Memory/Page/ApiResult boundaries, metadata fields, route identities, and test harness signatures are consistent across the task. No second implementation module or dependency is introduced.
- The five retry delays and 15000 ms timeout are implementation choices allowed by the approved design. The supplied fixture remains the authority for original behavior.
- This plan applies the already chosen subagent method and model substitutions. It requires operator approval before implementation under the workspace workflow.
