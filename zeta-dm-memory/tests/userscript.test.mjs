import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { UserscriptHarness } from './support/UserscriptHarness.mjs';

const source = readFileSync(new URL('../zeta-dm-memory.user.js', import.meta.url), 'utf8');
const original = readFileSync(new URL('./fixtures/zeta-dm-memory.v1.2.js', import.meta.url), 'utf8');
const roomA = '/en/rooms/007%2FAlpha/';
const roomB = '/rooms/beta';
const externalSource = '/test-room';
const updatedAt = '2026-11-10T10:00:00.000Z';
const keyName = 'zeta_dm_api_key';
const key = 'demo!~"\\[]{}();+/='.repeat(8).slice(0, 60);
const notesField = 'zeta-dm-notes';
const statusField = 'zeta-dm-sync-status';
const sourceField = 'zeta-dm-import-source';
const importStatus = 'zeta-dm-import-status';
const openImport = 'zeta-dm-open-import';
const confirmImport = 'zeta-dm-import-confirm';
const cancelImport = 'zeta-dm-import-cancel';
const useCloud = 'zeta-dm-use-cloud';
const keepLocal = 'zeta-dm-keep-local';
const retryMenu = 'Retry notes sync';
const setKeyMenu = 'Set DM API key';
const missing = { status: 404, data: { error: { code: 'memory_not_found' } } };
const conflict = { status: 409, data: { error: { code: 'revision_conflict' } } };

/** @return {object} */
function state(notes, settings = {}) {
    return { notes, turnCount: 0, interval: 6, forceNext: false, minimized: false, ...settings };
}

/** @return {object} */
function memory(roomId, notes, revision = 1) {
    return { roomId, notes, revision, updatedAt };
}

/** @return {object} */
function metadata(roomId) {
    return { roomId, revision: 1, updatedAt };
}

/** @return {Map} */
function storage(entries) {
    return new Map(entries.map(([roomId, value]) => ['zeta_dm_mem_' + roomId, JSON.stringify(value)]));
}

/** @return {Promise<UserscriptHarness>} */
async function make(options = {}) {
    const harness = new UserscriptHarness({
        source, pathname: roomA, gmStorage: new Map([[keyName, key]]), ...options,
    });
    await harness.advance(800);
    return harness;
}

/** @return {Promise<UserscriptHarness>} */
async function acknowledged(notes = 'Base', revision = 1, options = {}) {
    const harness = await make(options);
    await harness.completeRequest(0, { data: memory(roomA, notes, revision) });
    return harness;
}

/** @return {string} */
function requestRoom(request) {
    return new URL(request.url).searchParams.get('roomId');
}

/** @return {object[]} */
function writes(harness) {
    return harness.requests.filter(({ method }) => method === 'PUT');
}

/** @return {object} */
function body(request) {
    return JSON.parse(request.data);
}

/** @return {string} */
function text(harness, elementId = statusField) {
    return harness.elements[elementId].textContent;
}

/** @return {Promise<void>} */
async function pickSource(harness, sourceRoom = externalSource) {
    await harness.click(openImport);
    await harness.completeRequest(harness.requests.length - 1, {
        data: { items: [metadata(sourceRoom)], nextCursor: null },
    });
    await harness.change(sourceField, sourceRoom);
}

test('original_injection_sections_are_preserved', () => {
    const spans = [
        ...['formatNotesAsNarrator', 'setReactInputValue', 'findChatInput', 'checkAndInject']
            .map((name) => ['\n    function ' + name + '(', '\n    }\n']),
        ...['keydown', 'pointerdown']
            .map((type) => ["\n    window.addEventListener('" + type + "'", '\n    }, true);\n']),
    ];
    for (const [start, end] of spans) {
        /** @return {string} */
        const section = (input) => {
            const normalized = input.replace(/\r\n/g, '\n');
            const offset = normalized.indexOf(start);
            const last = normalized.indexOf(end, offset);
            assert.notEqual(offset, -1, start);
            assert.notEqual(last, -1, end);
            return normalized.slice(offset, last + end.length);
        };
        assert.equal(section(source), section(original), start);
    }
});

test('original_narration_paste_and_send_behavior', async () => {
    const outputs = [];
    for (const script of [original, source]) {
        const harness = await make({
            source: script, gmStorage: new Map(),
            localStorage: storage([[roomA, state(' \t*First* \n\n **Second** \n', {
                interval: 2, turnCount: 1, forceNext: true,
            })]]),
        });
        harness.typeChat('Message  ');
        await harness.click('zeta-dm-InsertNow');
        const paste = harness.elements.chat.value;
        const pasteEvents = [...harness.chatEvents];
        const pasteState = harness.readRoom(roomA);
        assert.equal(paste, 'Message\n\n*First*\n*Second*');
        assert.deepEqual(pasteEvents.map(({ type }) => type), ['tracker', 'native-setter', 'input', 'change']);
        assert.equal(pasteState.turnCount, 0);
        assert.equal(pasteState.forceNext, false);
        harness.typeChat('Next');
        assert.equal(harness.enter(), true);
        assert.equal(harness.readRoom(roomA).turnCount, 1);
        harness.typeChat('Send');
        assert.equal(harness.enter(), false);
        assert.equal(harness.elements.chat.value, 'Send\n\n*First*\n*Second*');
        await harness.advance(24);
        assert.deepEqual(harness.chatEvents.map(({ type }) => type), ['tracker', 'native-setter', 'input', 'change']);
        await harness.advance(1);
        assert.equal(harness.chatEvents.at(-1).key, 'Enter');
        const sendEvents = [...harness.chatEvents];
        await harness.change('zeta-dm-force', true);
        harness.typeChat('Pointer');
        harness.pointerSend();
        assert.equal(harness.elements.chat.value, 'Pointer\n\n*First*\n*Second*');
        const final = harness.readRoom(roomA);
        assert.equal(final.turnCount, 0);
        assert.equal(final.forceNext, false);
        outputs.push({ paste, pasteEvents, pasteState, sendEvents, pointerEvents: harness.chatEvents, final });
    }
    assert.deepEqual(outputs[1], outputs[0]);
});

test('notes_debounce_and_no_op', async () => {
    const harness = await acknowledged();
    await harness.editNotes('First');
    await harness.advance(499);
    assert.equal(writes(harness).length, 0);
    await harness.editNotes('Second');
    await harness.advance(499);
    assert.equal(writes(harness).length, 0);
    await harness.editNotes('Second');
    await harness.advance(1);
    assert.equal(writes(harness).length, 1);
    assert.deepEqual(body(writes(harness)[0]), { notes: 'Second', expectedRevision: 1 });
    await harness.completeRequest(1, { data: memory(roomA, 'Second', 2) });
    await harness.editNotes('Different');
    await harness.advance(100);
    await harness.editNotes('Second');
    await harness.advance(500);
    assert.equal(writes(harness).length, 1);
    assert.equal(harness.readRoom(roomA).cloudSync.dirty, false);
});

test('composition_delays_upload', async () => {
    const harness = await acknowledged();
    await harness.editNotes('Typing');
    await harness.advance(499);
    await harness.dispatchComposition('compositionstart');
    await harness.editNotes('海 \u{10348}');
    assert.equal(harness.readRoom(roomA).notes, '海 \u{10348}');
    await harness.advance(2000);
    assert.equal(writes(harness).length, 0);
    await harness.dispatchComposition('compositionend');
    await harness.advance(499);
    assert.equal(writes(harness).length, 0);
    await harness.advance(1);
    assert.deepEqual(body(writes(harness)[0]), { notes: '海 \u{10348}', expectedRevision: 1 });
});

test('settings_and_widget_ticks_stay_local', async () => {
    const harness = await acknowledged();
    await harness.change('zeta-dm-interval', '7');
    await harness.change('zeta-dm-force', true);
    await harness.click('zeta-dm-header');
    harness.typeChat('Local');
    harness.enter();
    await harness.advance(2425);
    assert.equal(harness.requests.length, 1);
    assert.deepEqual({ ...harness.readRoom(roomA), cloudSync: undefined }, {
        ...state('Base', { interval: 7, minimized: true }), cloudSync: undefined,
    });
    await harness.editNotes('New');
    await harness.advance(500);
    assert.deepEqual(body(writes(harness)[0]), { notes: 'New', expectedRevision: 1 });
});

test('initial_read_and_migration', async () => {
    const clean = await acknowledged('Cloud');
    assert.equal(clean.elements[notesField].value, 'Cloud');
    assert.equal(clean.readRoom(roomA).cloudSync.dirty, false);
    const matching = await acknowledged('Cloud', 2, { localStorage: storage([[roomA, state('Cloud')]]) });
    assert.equal(matching.readRoom(roomA).cloudSync.revision, 2);
    assert.equal(matching.readRoom(roomA).cloudSync.dirty, false);
    const different = await acknowledged('Cloud', 2, { localStorage: storage([[roomA, state('Legacy')]]) });
    assert.equal(different.elements[notesField].value, 'Legacy');
    assert.match(text(different), /Conflict/);
    const create = await make({ localStorage: storage([[roomA, state('Legacy', { cloudSync: { dirty: 'invalid' } })]]) });
    await create.completeRequest(0, missing);
    assert.deepEqual(body(writes(create)[0]), { notes: 'Legacy', expectedRevision: 0 });
    const untouched = await make();
    await untouched.completeRequest(0, missing);
    assert.equal(untouched.readRoom(roomA).cloudSync.revision, 0);
    const rejected = await make({ localStorage: storage([[roomA, state('Legacy')]]) });
    await rejected.completeRequest(0, { status: 404, data: { error: { code: 'not_found' } } });
    for (const harness of [clean, matching, different, untouched, rejected]) {
        await harness.advance(2000);
        assert.equal(writes(harness).length, 0);
    }
    assert.equal(rejected.readRoom(roomA).notes, 'Legacy');
});

test('confirmed_missing_recreates_known_notes_with_revision_zero', async () => {
    for (const reload of [false, true]) {
        const prior = await acknowledged('Previously saved', 4);
        const harness = reload ? await make({ localStorage: prior.localStorage }) : prior;
        if (!reload) {
            await harness.focus();
        }
        await harness.completeRequest(reload ? 0 : 1, missing);
        const room = harness.readRoom(roomA);
        assert.equal(room.notes, 'Previously saved');
        assert.equal(room.cloudSync.revision, 0);
        assert.equal(room.cloudSync.dirty, true);
        assert.equal(writes(harness).length, 1);
        assert.deepEqual(body(writes(harness)[0]), { notes: 'Previously saved', expectedRevision: 0 });
    }
    const reset = await acknowledged();
    await reset.editNotes('Unverified draft');
    reset.localStorage.set('zeta_dm_mem_' + roomA, JSON.stringify(state('Unverified draft')));
    await reset.advance(500);
    assert.equal(reset.requests[1].method, 'GET');
    assert.equal(writes(reset).length, 0);
    await reset.completeRequest(1, missing);
    assert.deepEqual(body(writes(reset)[0]), { notes: 'Unverified draft', expectedRevision: 0 });
});

test('deliberate_empty_and_note_validation', async () => {
    const harness = await acknowledged('Old');
    await harness.editNotes('');
    await harness.advance(500);
    assert.deepEqual(body(writes(harness)[0]), { notes: '', expectedRevision: 1 });
    await harness.completeRequest(1, { data: memory(roomA, '', 2) });
    const boundary = '\u{10348}'.repeat(16384);
    for (const invalid of ['broken \uD800', boundary + 'x']) {
        await harness.editNotes(invalid);
        await harness.advance(500);
        assert.equal(harness.readRoom(roomA).notes, invalid);
        assert.equal(writes(harness).length, 1);
        assert.match(text(harness), /valid Unicode.*65,536/);
    }
    await harness.editNotes(boundary);
    await harness.advance(500);
    assert.deepEqual(body(writes(harness)[1]), { notes: boundary, expectedRevision: 2 });
    const pending = await make();
    await pending.editNotes('temporary');
    await pending.editNotes('');
    await pending.completeRequest(0, { data: memory(roomA, 'Cloud', 1) });
    assert.equal(pending.readRoom(roomA).notes, '');
    assert.equal(pending.readRoom(roomA).cloudSync.dirty, true);
    assert.match(text(pending), /Conflict/);
    const missingWithClear = await make();
    await missingWithClear.editNotes('temporary');
    await missingWithClear.editNotes('');
    await missingWithClear.completeRequest(0, missing);
    assert.equal(missingWithClear.readRoom(roomA).cloudSync.revision, 0);
    assert.equal(missingWithClear.readRoom(roomA).cloudSync.dirty, true);
    await missingWithClear.advance(499);
    assert.equal(writes(missingWithClear).length, 0);
    await missingWithClear.advance(1);
    assert.deepEqual(body(writes(missingWithClear)[0]), { notes: '', expectedRevision: 0 });
});

test('navigation_pins_pending_work', async () => {
    const harness = await acknowledged();
    await harness.editNotes('Draft A');
    harness.navigate(roomB);
    await harness.editNotes('Old focused field attempted edit');
    assert.equal(harness.readRoom(roomA).notes, 'Draft A');
    assert.equal(harness.readRoom(roomB), null);
    assert.equal(harness.elements[notesField].value, '');
    assert.equal(requestRoom(harness.requests[1]), roomB);
    await harness.advance(500);
    assert.equal(requestRoom(writes(harness)[0]), roomA);
    assert.match(writes(harness)[0].url, /roomId=%2Fen%2Frooms%2F007%252FAlpha%2F/);
    await harness.completeRequest(2, { data: memory(roomA, 'Draft A', 2) });
    await harness.completeRequest(1, { data: memory(roomB, 'Cloud B', 5) });
    assert.equal(harness.elements[notesField].value, 'Cloud B');
    assert.equal(harness.readRoom(roomB).notes, 'Cloud B');
    assert.equal(writes(harness).length, 1);
    const lateRead = await make();
    lateRead.navigate(roomB);
    await lateRead.advance(800);
    await lateRead.completeRequest(1, { data: memory(roomB, 'Visible B') });
    await lateRead.completeRequest(0, { data: memory(roomA, 'Late A') });
    assert.equal(lateRead.elements[notesField].value, 'Visible B');
});

test('edits_during_save_keep_their_debounce', async () => {
    const harness = await acknowledged();
    await harness.editNotes('First');
    await harness.advance(500);
    await harness.editNotes('Second');
    await harness.advance(100);
    await harness.completeRequest(1, { data: memory(roomA, 'First', 2) });
    assert.equal(harness.readRoom(roomA).notes, 'Second');
    assert.equal(harness.readRoom(roomA).cloudSync.dirty, true);
    await harness.advance(399);
    assert.equal(writes(harness).length, 1);
    await harness.advance(1);
    assert.deepEqual(body(writes(harness)[1]), { notes: 'Second', expectedRevision: 2 });
    await harness.editNotes('Third');
    await harness.editNotes('Second');
    await harness.completeRequest(2, { data: memory(roomA, 'Second', 3) });
    await harness.advance(500);
    assert.equal(writes(harness).length, 2);
    assert.equal(harness.readRoom(roomA).cloudSync.dirty, false);
});

test('manual_retry_during_pending_put_preserves_latest_edit_and_debounce', async () => {
    const harness = await acknowledged();
    await harness.editNotes('Earlier snapshot');
    await harness.advance(500);
    assert.deepEqual(body(writes(harness)[0]), { notes: 'Earlier snapshot', expectedRevision: 1 });
    await harness.editNotes('Latest draft');
    await harness.advance(100);
    await harness.runMenu(retryMenu);
    assert.equal(harness.requests.length, 2);
    assert.equal(harness.readRoom(roomA).notes, 'Latest draft');
    assert.equal(harness.readRoom(roomA).cloudSync.dirty, true);
    await harness.completeRequest(1, { data: memory(roomA, 'Earlier snapshot', 2) });
    assert.equal(harness.requests[2].method, 'GET');
    assert.equal(harness.readRoom(roomA).notes, 'Latest draft');
    assert.equal(harness.readRoom(roomA).cloudSync.dirty, true);
    await harness.completeRequest(2, { data: memory(roomA, 'Earlier snapshot', 2) });
    await harness.advance(399);
    assert.equal(writes(harness).length, 1);
    await harness.advance(1);
    assert.deepEqual(body(writes(harness)[1]), { notes: 'Latest draft', expectedRevision: 2 });
    await harness.completeRequest(3, { data: memory(roomA, 'Latest draft', 3) });
    assert.equal(harness.elements[notesField].value, 'Latest draft');
    assert.equal(harness.readRoom(roomA).cloudSync.dirty, false);
    assert.equal(text(harness), 'Saved');
});

test('reload_and_focus_preserve_dirty_notes', async () => {
    const before = await acknowledged();
    await before.editNotes('Local');
    const harness = await make({ localStorage: before.localStorage });
    assert.equal(harness.requests[0].method, 'GET');
    await harness.focus();
    await harness.focus();
    assert.equal(harness.requests.length, 1);
    await harness.advance(500);
    assert.equal(writes(harness).length, 0);
    await harness.completeRequest(0, { data: memory(roomA, 'Remote update', 2) });
    assert.equal(harness.elements[notesField].value, 'Local');
    assert.equal(harness.readRoom(roomA).cloudSync.revision, 1);
    assert.equal(harness.readRoom(roomA).cloudSync.conflict.revision, 2);
    const clean = await acknowledged();
    clean.elements[notesField].focus();
    await clean.focus();
    await clean.completeRequest(1, { data: memory(roomA, 'Updated', 3) });
    assert.equal(clean.elements[notesField].value, 'Updated');
    assert.equal(clean.readRoom(roomA).cloudSync.baseNotes, 'Updated');
    await clean.focus();
    await clean.editNotes('Intervening edit');
    await clean.editNotes('Updated');
    await clean.completeRequest(2, { data: memory(roomA, 'Changed during read', 4) });
    assert.equal(clean.elements[notesField].value, 'Updated');
    assert.equal(clean.readRoom(roomA).cloudSync.conflict.notes, 'Changed during read');
});

test('shared_clean_reconciliation_updates_focused_editor_before_saved', async () => {
    const first = await acknowledged('Older visible notes');
    first.elements[notesField].focus();
    const second = await acknowledged('New shared notes', 2, { localStorage: first.localStorage });
    assert.equal(second.elements[notesField].value, 'New shared notes');
    assert.equal(first.elements[notesField].value, 'Older visible notes');
    await first.focus();
    assert.match(text(first), /Loading/);
    await first.completeRequest(1, { data: memory(roomA, 'New shared notes', 2) });
    assert.equal(first.elements[notesField].value, 'New shared notes');
    assert.equal(text(first), 'Saved');
    await first.editNotes(first.elements[notesField].value + ' plus edit');
    await first.advance(500);
    assert.deepEqual(body(writes(first)[0]), { notes: 'New shared notes plus edit', expectedRevision: 2 });
});

test('shared_clean_acknowledgement_updates_bound_editor', async () => {
    const first = await acknowledged();
    const second = await acknowledged('Base', 1, { localStorage: first.localStorage });
    await first.editNotes('First tab draft');
    await second.editNotes('Shared latest draft');
    await first.advance(500);
    assert.equal(first.elements[notesField].value, 'First tab draft');
    assert.deepEqual(body(writes(first)[0]), { notes: 'Shared latest draft', expectedRevision: 1 });
    await first.completeRequest(1, { data: memory(roomA, 'Shared latest draft', 2) });
    assert.equal(first.elements[notesField].value, 'Shared latest draft');
    assert.equal(text(first), 'Saved');
});

test('uncertain_save_reconciles', async () => {
    for (const remoteText of ['Draft', 'External revision']) {
        const harness = await acknowledged();
        await harness.editNotes('Draft');
        await harness.advance(500);
        await harness.failRequest(1, 'timeout');
        await harness.advance(999);
        assert.equal(harness.requests.length, 2);
        await harness.advance(1);
        assert.equal(harness.requests[2].method, 'GET');
        await harness.completeRequest(2, { data: memory(roomA, remoteText, 2) });
        await harness.advance(20000);
        assert.equal(writes(harness).length, 1);
        assert.equal(harness.readRoom(roomA).notes, 'Draft');
        if (remoteText === 'Draft') {
            assert.equal(harness.readRoom(roomA).cloudSync.dirty, false);
            assert.equal(text(harness), 'Saved');
        } else {
            assert.match(text(harness), /Conflict/);
            assert.equal(harness.readRoom(roomA).cloudSync.conflict.notes, remoteText);
        }
    }
    const newer = await acknowledged();
    await newer.editNotes('Applied before timeout');
    await newer.advance(500);
    await newer.failRequest(1, 'timeout');
    await newer.advance(1000);
    await newer.editNotes('Newer draft');
    await newer.advance(100);
    await newer.completeRequest(2, { data: memory(roomA, 'Applied before timeout', 2) });
    assert.equal(newer.readRoom(roomA).notes, 'Newer draft');
    assert.equal(newer.readRoom(roomA).cloudSync.revision, 2);
    await newer.advance(399);
    assert.equal(writes(newer).length, 1);
    await newer.advance(1);
    assert.deepEqual(body(writes(newer)[1]), { notes: 'Newer draft', expectedRevision: 2 });
});

test('retry_limits_and_auth_block', async () => {
    const harness = await make();
    const delays = [1000, 2000, 4000, 8000, 16000];
    for (const [index, delay] of delays.entries()) {
        await harness.failRequest(index);
        await harness.advance(delay - 1);
        assert.equal(harness.requests.length, index + 1);
        await harness.advance(1);
        assert.equal(harness.requests.length, index + 2);
    }
    await harness.completeRequest(5, { status: 503, data: { error: { code: 'database_unavailable' } } });
    await harness.focus();
    await harness.advance(60000);
    assert.equal(harness.requests.length, 6);
    await harness.runMenu(retryMenu);
    assert.equal(harness.requests.length, 7);
    const rate = await make();
    await rate.completeRequest(0, { status: 429, headers: 'Retry-After: 7\r\n' });
    await rate.runMenu(retryMenu);
    await rate.advance(6999);
    assert.equal(rate.requests.length, 1);
    await rate.advance(1);
    assert.equal(rate.requests.length, 2);
    await rate.completeRequest(1, { status: 429, headers: 'Retry-After: 2147484\r\n' });
    await rate.advance(30000);
    assert.equal(rate.requests.length, 2);
    assert.match(text(rate), /Retry notes sync/);
    const timeout = await make();
    timeout.hasAbortHandle = false;
    await timeout.advance(14999);
    assert.equal(timeout.requests[0].aborted, false);
    await timeout.advance(1);
    assert.equal(timeout.requests[0].aborted, true);
    await timeout.advance(1000);
    await timeout.advance(15000);
    assert.equal(timeout.requests[1].aborted, false);
    await timeout.advance(2000);
    assert.equal(timeout.requests.length, 3);
    for (const response of [
        { status: 401 }, { status: 503, data: { error: { code: 'configuration_error' } } }, { status: 400 },
    ]) {
        const blocked = await make();
        await blocked.completeRequest(0, response);
        await blocked.focus();
        await blocked.advance(60000);
        assert.equal(blocked.requests.length, 1);
        await blocked.runMenu(retryMenu);
        assert.equal(blocked.requests.length, 2);
    }
});

test('conflict_choices_are_conditional', async () => {
    const harness = await acknowledged('Cloud <tag>', 3, {
        localStorage: storage([[roomA, state('Local')], [roomB, state('Other')]]),
    });
    assert.equal(text(harness, 'zeta-dm-conflict-notes'), 'Cloud <tag>');
    assert.equal(harness.elements['zeta-dm-conflict-notes'].children.length, 0);
    harness.confirmResult = false;
    await harness.click(useCloud);
    assert.equal(harness.readRoom(roomA).notes, 'Local');
    harness.confirmResult = () => {
        void harness.editNotes('During confirmation');
        return true;
    };
    await harness.click(useCloud);
    assert.equal(harness.readRoom(roomA).notes, 'During confirmation');
    await harness.editNotes('Local');
    await harness.click(keepLocal);
    await harness.advance(500);
    assert.deepEqual(body(writes(harness)[0]), { notes: 'Local', expectedRevision: 3 });
    await harness.completeRequest(1, conflict);
    assert.equal(harness.requests[2].method, 'GET');
    await harness.completeRequest(2, { data: memory(roomA, 'Cloud two', 4) });
    await harness.advance(2000);
    assert.equal(writes(harness).length, 1);
    assert.equal(harness.readRoom(roomA).cloudSync.conflict.revision, 4);
    await harness.click(keepLocal);
    assert.deepEqual(body(writes(harness)[1]), { notes: 'Local', expectedRevision: 4 });
    await harness.completeRequest(3, conflict);
    await harness.completeRequest(4, { data: memory(roomA, 'Cloud three', 5) });
    await harness.advance(2000);
    assert.equal(writes(harness).length, 2);
    assert.match(text(harness), /Conflict/);
    harness.confirmResult = true;
    await harness.click(useCloud);
    assert.equal(harness.elements[notesField].value, 'Cloud three');
    assert.equal(harness.readRoom(roomA).cloudSync.revision, 5);
    assert.equal(harness.readRoom(roomB).notes, 'Other');
});

test('both_conflict_choices_reject_an_unseen_shared_snapshot', async () => {
    const conflictNotes = 'zeta-dm-conflict-notes';
    for (const choice of [useCloud, keepLocal]) {
        const first = await acknowledged('Shown remote version', 1, {
            localStorage: storage([[roomA, state('Keep local draft')]]),
        });
        const second = await acknowledged('New shared conflict', 2, { localStorage: first.localStorage });
        assert.equal(text(first, conflictNotes), 'Shown remote version');
        assert.equal(text(second, conflictNotes), 'New shared conflict');
        assert.equal(first.readRoom(roomA).cloudSync.conflict.revision, 2);
        await first.click(choice);
        assert.equal(first.confirmations.length, 0);
        assert.equal(writes(first).length, 0);
        assert.equal(first.readRoom(roomA).notes, 'Keep local draft');
        assert.equal(text(first, conflictNotes), 'New shared conflict');
        await first.click(choice);
        if (choice === useCloud) {
            assert.equal(first.confirmations.length, 1);
            assert.equal(first.elements[notesField].value, 'New shared conflict');
            assert.equal(first.readRoom(roomA).cloudSync.revision, 2);
            assert.equal(writes(first).length, 0);
        } else {
            assert.deepEqual(body(writes(first)[0]), { notes: 'Keep local draft', expectedRevision: 2 });
        }
    }
});

test('local_write_failure_is_visible', async () => {
    const harness = await acknowledged();
    await harness.editNotes('Older');
    await harness.advance(200);
    harness.failLocalWrites = true;
    await harness.editNotes('Keep this draft');
    await harness.focus();
    await harness.advance(1000);
    assert.equal(harness.readRoom(roomA).notes, 'Older');
    assert.equal(harness.elements[notesField].value, 'Keep this draft');
    assert.equal(text(harness), 'Local save failed');
    assert.equal(harness.requests.length, 1);
    await harness.runMenu(retryMenu);
    assert.equal(harness.requests.length, 1);
    harness.failLocalWrites = false;
    await harness.runMenu(retryMenu);
    assert.equal(harness.readRoom(roomA).notes, 'Keep this draft');
    assert.equal(harness.requests[1].method, 'GET');
    await harness.completeRequest(1, { data: memory(roomA, 'Base') });
    assert.deepEqual(body(writes(harness)[0]), { notes: 'Keep this draft', expectedRevision: 1 });
    await harness.completeRequest(2, { data: memory(roomA, 'Keep this draft', 2) });
    assert.equal(text(harness), 'Saved');
});

test('import_pagination_and_literal_rendering', async () => {
    const harness = await acknowledged();
    const literal = "/<svg>'OR'1'='1";
    const firstPage = [metadata(roomA), metadata(literal),
        ...Array.from({ length: 23 }, (_, index) => metadata('/fake-' + index))];
    const cursor = firstPage.at(-1).roomId;
    await harness.click(openImport);
    assert.equal(new URL(harness.requests[1].url).pathname, '/v1/memories');
    assert.deepEqual([...new URL(harness.requests[1].url).searchParams], [['limit', '25']]);
    await harness.completeRequest(1, { data: { items: firstPage, nextCursor: cursor } });
    const picker = harness.elements[sourceField];
    assert.equal(picker.options.length, 25);
    assert.equal(picker.options[0].disabled, true);
    assert.equal(picker.options[1].value, literal);
    assert.equal(picker.options[1].textContent, literal + ' · ' + updatedAt);
    assert.equal(picker.options[1].children.length, 0);
    await harness.click('zeta-dm-import-next');
    assert.deepEqual([...new URL(harness.requests[2].url).searchParams], [['limit', '25'], ['after', cursor]]);
    await harness.completeRequest(2, { data: { items: [metadata(externalSource)], nextCursor: null } });
    assert.equal(picker.options.length, 1);
    await harness.click('zeta-dm-import-prev');
    assert.equal(new URL(harness.requests[3].url).searchParams.has('after'), false);
    await harness.completeRequest(3, { data: { items: firstPage, nextCursor: cursor } });
    assert.equal(picker.options.length, 25);
    assert.equal(harness.requests.filter((request) => requestRoom(request) !== null).length, 1);
});

test('import_copies_only_destination_notes', async () => {
    const harness = await acknowledged('Before', 4, {
        localStorage: storage([[roomA, state('Before', { interval: 5, turnCount: 2, forceNext: true, minimized: true })],
            [externalSource, state('Existing source locally', { interval: 3 })]]),
    });
    const beforeSource = harness.readRoom(externalSource);
    const beforeDestination = harness.readRoom(roomA);
    const importedNotes = ' *Copied* \r\n literal \u{10348} \n';
    await pickSource(harness);
    await harness.click(confirmImport);
    assert.equal(requestRoom(harness.requests[2]), externalSource);
    await harness.completeRequest(2, { data: memory(externalSource, importedNotes, 17) });
    assert.equal(harness.confirmations.length, 1);
    assert.equal(harness.readRoom(roomA).notes, importedNotes);
    const { notes, cloudSync, ...settings } = harness.readRoom(roomA);
    const { notes: beforeNotes, cloudSync: beforeSync, ...beforeSettings } = beforeDestination;
    assert.equal(beforeNotes, 'Before');
    assert.deepEqual(settings, beforeSettings);
    assert.equal(cloudSync.revision, beforeSync.revision);
    assert.deepEqual(harness.readRoom(externalSource), beforeSource);
    await harness.advance(499);
    assert.equal(writes(harness).length, 0);
    await harness.advance(1);
    assert.equal(requestRoom(writes(harness)[0]), roomA);
    assert.deepEqual(body(writes(harness)[0]), { notes: importedNotes, expectedRevision: 4 });
    await harness.completeRequest(3, { data: memory(roomA, importedNotes, 5) });
    for (const [remoteText, confirm, expected] of [['', false, importedNotes], [importedNotes, true, importedNotes], ['', true, '']]) {
        harness.confirmResult = confirm;
        if (harness.elements['zeta-dm-import'].hidden) {
            await pickSource(harness);
        }
        await harness.click(confirmImport);
        await harness.completeRequest(harness.requests.length - 1, { data: memory(externalSource, remoteText, 17) });
        assert.equal(harness.readRoom(roomA).notes, expected);
        await harness.advance(500);
        assert.equal(writes(harness).length, expected ? 1 : 2);
    }
    assert.deepEqual(body(writes(harness)[1]), { notes: '', expectedRevision: 5 });
    assert.equal(writes(harness).every((request) => requestRoom(request) === roomA), true);
});

test('import_races_and_failures_are_safe', async () => {
    for (const scenario of ['typing', 'navigation', 'cancel', 'confirmation', 'failed', 'malformed']) {
        const harness = await acknowledged();
        await pickSource(harness);
        await harness.click(confirmImport);
        if (scenario === 'typing') {
            await harness.editNotes('New draft');
            await harness.advance(200);
        } else if (scenario === 'navigation') {
            harness.navigate(roomB);
        } else if (scenario === 'cancel') {
            await harness.click(cancelImport);
        } else if (scenario === 'confirmation') {
            harness.confirmResult = () => {
                void harness.editNotes('During confirmation');
                return true;
            };
        }
        if (scenario === 'failed') {
            await harness.failRequest(2);
            assert.match(text(harness, importStatus), /Could not load/);
        } else {
            await harness.completeRequest(2, {
                data: memory(scenario === 'malformed' ? roomB : externalSource, 'Source'),
            });
        }
        const expected = scenario === 'typing' ? 'New draft' : scenario === 'confirmation' ? 'During confirmation' : 'Base';
        assert.equal(harness.readRoom(roomA).notes, expected, scenario);
        assert.equal(writes(harness).length, 0, scenario);
        if (scenario === 'typing') {
            assert.match(text(harness, importStatus), /Destination changed/);
            await harness.advance(299);
            assert.equal(writes(harness).length, 0);
            await harness.advance(1);
            assert.deepEqual(body(writes(harness)[0]), { notes: expected, expectedRevision: 1 });
        }
    }
});

test('key_storage_transport_and_rotation', async () => {
    const harness = await make({ gmStorage: new Map() });
    assert.match(text(harness), /Local only/);
    await harness.runMenu(setKeyMenu, 'x'.repeat(59));
    await harness.runMenu(setKeyMenu, 'x'.repeat(59) + '\n');
    await harness.runMenu(setKeyMenu, null);
    assert.equal(harness.gmWrites.length, 0);
    assert.equal(harness.alerts.length, 2);
    await harness.runMenu(setKeyMenu, key);
    assert.equal(harness.gmStorage.get(keyName), key);
    const initial = harness.requests[0];
    assert.equal(initial.headers.Authorization, 'Bearer ' + key);
    assert.equal(new URL(initial.url).origin, 'https://zeta-dm-memory.elit1989.workers.dev');
    assert.equal(initial.anonymous, true);
    assert.equal(initial.redirect, 'error');
    assert.equal(initial.timeout, 15000);
    const replacement = 'another!()\\~'.repeat(30).slice(0, 254);
    await harness.runMenu(setKeyMenu, replacement);
    assert.equal(initial.aborted, true);
    assert.equal(harness.requests[1].headers.Authorization, 'Bearer ' + replacement);
    assert.equal(harness.requests[1].method, 'GET');
    await harness.completeRequest(0, { data: memory(roomA, 'Old-key result', 9) });
    await harness.completeRequest(1, { data: memory(roomA, 'New key', 2) });
    assert.equal(harness.elements[notesField].value, 'New key');
    assert.equal(harness.prompts.every((args) => args.length === 1), true);
    await harness.remoteValue(keyName, key);
    assert.equal(harness.requests[2].headers.Authorization, 'Bearer ' + key);
    await harness.completeRequest(2, { data: memory(roomA, 'Redirected', 3), finalUrl: 'https://example.invalid/other' });
    assert.equal(harness.elements[notesField].value, 'New key');
    for (const secret of [key, replacement]) {
        for (const exposed of [source, JSON.stringify(harness.localWrites), JSON.stringify(harness.logs),
            JSON.stringify(harness.requests.map(({ url, data }) => ({ url, data }))),
            harness.document.body.textContent, harness.elements[notesField].value]) {
            assert.equal(exposed.includes(secret), false);
        }
    }
});

test('invalid_api_responses_fail_closed', async () => {
    const invalid = [
        { data: memory(roomB, 'Wrong room') }, { data: { roomId: roomA, revision: 1, updatedAt } },
        { data: memory(roomA, 'Unsafe', Number.MAX_SAFE_INTEGER + 1) },
        { data: { ...memory(roomA, 'Wrong date'), updatedAt: '2026-02-30T00:00:00Z' } },
        { responseText: '{' }, { data: memory(roomA, 'x'.repeat(65537)) },
        { data: memory(roomA, 'Redirect'), finalUrl: 'https://example.invalid/v1/memory' },
    ];
    for (const response of invalid) {
        const harness = await make({ localStorage: storage([[roomA, state('Local')]]) });
        await harness.completeRequest(0, response);
        await harness.advance(1000);
        assert.equal(harness.readRoom(roomA).notes, 'Local');
        assert.equal(harness.elements[notesField].value, 'Local');
        assert.notEqual(text(harness), 'Saved');
        assert.equal(writes(harness).length, 0);
    }
    for (const page of [
        { items: Array.from({ length: 26 }, (_, index) => metadata('/room-' + index)), nextCursor: null },
        { items: [], nextCursor: '/invalid?cursor' },
        { items: [{ ...metadata(externalSource), revision: 0 }], nextCursor: null },
    ]) {
        const harness = await acknowledged();
        await harness.click(openImport);
        await harness.completeRequest(1, { data: page });
        assert.equal(harness.elements[sourceField].options.length, 0);
        assert.match(text(harness, importStatus), /Could not load/);
    }
});
