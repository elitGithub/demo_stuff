# Zeta userscript notes sync addition

Date: 2026-11-10
Status: Approved by the operator on 2026-11-10 after the builder check reported nothing important left.

## Scope confirmed by the operator

Add API-backed notes synchronization to the existing working Tampermonkey v1.2 script. Save changed notes after 500 ms without typing. Add an Import button with a list of saved chat identifiers. The actual chat URL pattern is https://zeta-ai.io/en/rooms/CHAT_ID. Room identifiers remain strings; use the full, unchanged pathname as the API roomId.

The operator expressly requires an additive patch, not a rewrite. Preserve the existing widget layout, localStorage association, narrator formatting, React input setter, turn counting, interval control, force-next control, minimized state, Paste button, keyboard interception, and pointer interception. Keep the existing 800 ms widget loop. No cleanup, restyling, framework, module migration, or changes to the Worker/schema are included. Apply workspace conventions to new code without reformatting the working original.

Original input: the specifically supplied Pasted text.txt attachment, userscript v1.2. Deliver one updated installable userscript in this project. The original attachment remains untouched. Testing and delivery instructions accompany the patch.

## Existing approved API contract

API origin: https://zeta-dm-memory.elit1989.workers.dev. Use GET /v1/memory, PUT /v1/memory, and GET /v1/memories exactly as implemented. PUT sends only notes and expectedRevision. Settings, counters, minimized state, and all sync bookkeeping stay local. Notes preserve their exact text and line breaks, up to 65,536 UTF-8 bytes. Empty notes are a deliberate valid update; an absent record is different from empty notes.

The operator reported a successful hosted save/read check after deploying the key-range correction: create returned 201, read returned 200, and matching notes/revision 1 were returned. This establishes the reported basic hosted path, not userscript compatibility or the entire hosted checklist.

## Credential and transport additions

Replace @grant none with only the Tampermonkey grants needed for private script storage, the API request, and menu configuration. Restrict @connect to the existing Worker host. Keep @match on the original Zeta origin so single-page navigation still initializes the widget. Use the Tampermonkey request API rather than page fetch; the Worker does not require CORS changes.

Add a Tampermonkey menu command to set or replace DM_API_KEY. Use a native prompt without pre-filling an existing key; cancellation preserves the current value. Validate the existing 60-254 visible-ASCII key contract, including punctuation. Store the key only in Tampermonkey script storage. Never put it in the script source, page localStorage, a page input, request URL, DOM attributes, logs, or error text. Configuration is per browser; the operator enters the key in each browser.

Requests use the fixed HTTPS origin and explicit bearer header, omit cookies, reject redirects, and have a bounded timeout/abort path. Validate response status and JSON shape before applying notes. All room parameters are encoded once. Returned roomId must exactly match the requested room. No endpoint or credential is accepted from a source-chat entry or API response.

A missing key keeps the current local script usable and shows a short setup status. Authentication/configuration errors stop automatic retries and direct the operator to the menu. Changing the key invalidates old pending responses and starts a fresh read before further uploads.

## Small changes to the existing script

- Add sync helpers inside the existing IIFE; keep the original organization and injection functions.
- Extend room-state access with an explicit pathname for asynchronous work while retaining the current default pathname behavior for existing synchronous callers.
- Hook the notes input event after its immediate local save. No cloud hook is added to generic settings/counter saves.
- Add one compact status line and Import button to the existing widget body. A temporarily expanded import/conflict section may appear there. New controls use classes and a small scoped stylesheet; the original styles remain intact.
- Hook room changes and browser focus for reads. The existing timer may detect a changed pathname, but it never periodically uploads or polls the API.
- Restrict API activity to a chat pathname with a nonempty identifier after the rooms segment. Preserve the complete localized pathname, including its exact spelling. Do not convert, decode again, lowercase, or extract an integer identifier.

## Notes lifecycle

Persist edits locally immediately, including the fact that they have not yet been synchronized. Keep enough per-room local metadata to distinguish the last acknowledged notes/revision from the current edited text. Reloading or a temporary network failure must not turn a dirty draft into a clean copy.

On room entry, read its saved notes. A matching clean copy may be updated from the API. A new browser with empty local defaults adopts saved notes without uploading its empty default. A confirmed memory_not_found response permits existing local notes to initialize that room. A failed read never counts as a missing record and never enables an unconditional create. Initial migration with different nonempty local and cloud notes requires explicit resolution; preserve the local text while presenting the choice.

Each actual notes change resets a trailing 500 ms timer. No upload occurs before that interval expires, during IME composition, or when text equals the last acknowledged snapshot. Editing and then returning to the acknowledged text produces no write. Interval/counter/minimized/force-next actions never upload. Import is an explicit notes change and enters the same save path.

Serialize work for a room. Capture room identity, text, edit generation, and expected revision with each operation. A late response cannot clear a newer dirty edit, replace another room's visible notes, or save under the current pathname instead of the captured one. An acknowledgement advances the saved baseline while preserving newer local edits and their remaining debounce. Navigation must also rebind the notes field before accepting edits for the newly visible room; the original focus guard must not leave old-room text bound to a new-room save.

Fetch on return to browser focus, coalescing duplicate reads. Preserve dirty local text. If the remote revision changed from its known baseline, enter a conflict rather than silently advancing the baseline and overwriting someone else's update. A remote snapshot already identical to the dirty text reconciles a lost acknowledgement without another write.

The existing same-browser localStorage sharing is retained. No new multi-tab editing service or locking system is part of this patch. Acknowledgements must still compare current local text/generation before clearing dirty state, so another local edit is not mistaken for an acknowledged one.

## Errors and conflicts

Show loading, saving, saved, unsynced, and conflict status beside the notes. Render all returned text as text, never HTML. Oversized/invalid notes remain local with a visible error and are not sent. A failed local write is not reported as safely persisted.

Transient failures retain dirty text and use a finite retry sequence with increasing delays; respect Retry-After on 429. Automatic retries stop for authentication, input validation, and revision conflicts. A menu command or visible retry action can restart a stopped synchronization attempt. No continuous background polling is introduced.

A conflict preserves local text and the fetched remote snapshot. A compact temporary section shows the remote notes and offers Use cloud notes or Keep my notes. Replacing local notes requires confirmation. Keeping local notes uses the revision of the remote snapshot the user was shown; another 409 produces a new conflict rather than an automatic overwrite. Ordinary autosaves do not prompt for confirmation.

## Import interaction chosen by the operator

The Import button expands a small source selector within the existing widget. Fetch the room index only when it is opened. Show exact room identifiers and updated timestamps; the API has no chat-title field. Paginate 25 items at a time using nextCursor, with Previous/Next navigation over visited pages. Disable selecting the current room. Use text rendering and preserve exact cursor values. No note previews or unbounded full-index fetch is added.

Selecting a source and pressing Import fetches that source's current notes. Verify that the destination room and its edit generation still match the operation's start. If the user navigated or edited during the fetch, do not replace their current text; display a safe status and require another explicit import. An initial destination read must complete before importing can schedule a write.

If destination notes differ and are nonempty, confirm replacement after the source fetch. Cancel preserves everything. Acceptance changes only destination notes, saves them locally, and schedules the normal debounced upload using the destination revision. Source notes remain unchanged and future edits are independent. Importing an empty source intentionally clears the destination after the same confirmation. Identical source and destination text is a no-op. Cancel sits left of the rightmost Import action.

## Builder discretion and verification

The builder may choose internal helper names, local metadata field names, finite backoff delays, request timeouts, status wording, and compact control placement consistent with these boundaries. Those are implementation choices, not new user requirements. Keep the implementation proportional to the addition. Do not add new dependencies or alter the working injection behavior to satisfy a general style preference.

Database-free tests use the existing Node runtime with controlled GM requests, storage, time, and DOM events. Cover debounce reset/no-op/IME, local-only settings, first-load migration, explicit empty notes, failed initial fetch, room navigation and late responses, edits during a save, reload recovery, retries/429/401, stale revisions, literal room IDs, import pagination and confirmation, source independence, credential isolation, and the original narrator/turn/Paste/send behavior. No real API, database, credentials, or AI chat messages are used by automated checks. Browser/Tampermonkey/React behavior still requires operator verification after installation.

Process: fresh builder check, operator design approval, exact implementation plan and approval, one implementer task, adversarial review, and scoped corrections approved by the operator. Git is read-only. No dependencies, database operations, deployment, or unrelated edits are authorized by this design. The previously approved Sol implementer and Astra reviewer substitutions remain applicable.

## Primary references

Tampermonkey documents script storage, menu commands, cross-origin requests, sandbox choices, and connection allowlists in its [official documentation](https://www.tampermonkey.net/documentation.php?locale=en). The existing API design defines the notes-only payload and conflict behavior. These references support the integration mechanisms; they do not establish that an updated userscript has been tested on the live Zeta site.
