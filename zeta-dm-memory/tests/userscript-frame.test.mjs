import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { UserscriptHarness } from './support/UserscriptHarness.mjs';

const source = readFileSync(new URL('../zeta-dm-memory.user.js', import.meta.url), 'utf8');
const roomA = '/en/rooms/alpha';
const roomB = '/en/rooms/bravo';
const externalSource = '/test-room';
const topOrigin = 'https://zeta-ai.io';
const frameOrigin = 'https://frame.pingpong.ai';
const evilOrigin = 'https://evil.example';
const updatedAt = '2026-11-10T10:00:00.000Z';
const keyName = 'zeta_dm_api_key';
const key = 'frame-key!'.repeat(6);
const paste = 'zeta-dm-InsertNow';
const counter = 'zeta-dm-counter';
const notesField = 'zeta-dm-notes';

/** @return {object} */
function state(notes, settings = {}) {
    return { notes, turnCount: 0, interval: 6, forceNext: false, minimized: false, ...settings };
}

/** @return {Map} */
function storage(entries) {
    return new Map(entries.map(([roomId, value]) => ['zeta_dm_mem_' + roomId, JSON.stringify(value)]));
}

/** @return {object} */
function memory(roomId, notes, revision = 1) {
    return { roomId, notes, revision, updatedAt };
}

/** @return {Promise<UserscriptHarness>} */
async function make(settings = {}, options = {}) {
    const harness = new UserscriptHarness({
        source, pathname: roomA, frame: true, gmStorage: new Map(),
        localStorage: storage([[roomA, state('First', settings)]]), ...options,
    });
    await harness.advance(800);
    await harness.advance(0);
    return harness;
}

/** @return {object[]} */
function arms(harness, to = 'frame') {
    return harness.messages.filter((message) => message.to === to && message.data?.kind === 'arm');
}

/** @return {object} */
function lastArm(harness, to = 'frame') {
    return arms(harness, to).at(-1).data;
}

/** @return {object[]} */
function reports(harness, kind) {
    return harness.messages.filter((message) => message.from.startsWith('frame') && message.data?.kind === kind);
}

/** @return {object[]} */
function pastes(harness) {
    return harness.messages.filter((message) => message.data?.kind === 'paste');
}

/** @return {object[]} */
function keydowns(harness) {
    return harness.chatEvents.filter((event) => event.type === 'keydown');
}

/** @return {Promise<boolean>} */
async function send(harness, text) {
    harness.typeChat(text);
    const passed = harness.enter();
    await harness.advance(25);
    return passed;
}

/** @return {Promise<boolean>} */
async function sendIn(harness, realm, text) {
    const chat = harness.byId(realm.document).chat;
    chat.focus();
    chat.value = text;
    const passed = chat.dispatchEvent(new harness.BrowserEvent('keydown', { key: 'Enter', bubbles: true }));
    await harness.advance(25);
    return passed;
}

test('frame_role_touches_nothing_but_the_chat', async () => {
    const harness = await make({ turnCount: 5 });
    assert.equal(await send(harness, 'Hello'), false);
    harness.typeChat('Again');
    harness.pointerSend();
    await harness.advance(0);
    harness.typeChat('');
    await harness.click(paste);
    await harness.advance(1600);
    assert.equal(reports(harness, 'sent').length, 2);
    assert.equal(reports(harness, 'pasted').length, 1);
    assert.deepEqual(harness.frameCalls, []);
    assert.equal(harness.frameElements['zeta-dm-widget'], undefined);
    assert.equal(harness.frame.document.body.descendants().some((element) => String(element.id).startsWith('zeta-dm')), false);
    const readies = reports(harness, 'ready');
    assert.equal(readies.length, 1);
    assert.equal(readies[0].targetOrigin, topOrigin);
    assert.equal(readies[0].to, 'top');
    for (const message of harness.messages) {
        const fromTop = message.from === 'top';
        assert.equal(message.targetOrigin, fromTop ? frameOrigin : topOrigin);
        assert.equal(message.to, fromTop ? 'frame' : 'top');
        assert.equal(message.delivered, true);
        assert.equal(message.data.zetaDm, 1);
    }
    assert.deepEqual(harness.logs, []);
});

test('ready_is_answered_and_lost_ready_is_recovered', async () => {
    const harness = new UserscriptHarness({
        source, pathname: roomA, frame: true, gmStorage: new Map(), localStorage: storage([[roomA, state('First')]]),
    });
    await harness.advance(0);
    const ready = harness.messages.findIndex((message) => message.from === 'frame' && message.data.kind === 'ready');
    const answer = harness.messages.findIndex((message) => message.from === 'top' && message.data.kind === 'arm');
    assert.notEqual(ready, -1);
    assert.ok(answer > ready);
    assert.deepEqual(harness.messages[answer], {
        from: 'top', to: 'frame', targetOrigin: frameOrigin, data: { zetaDm: 1, kind: 'arm', mode: 'count' }, delivered: true,
    });
    assert.equal('text' in harness.messages[answer].data, false);
    assert.equal(await send(harness, 'Hello'), true);
    assert.equal(harness.readRoom(roomA).turnCount, 1);

    const lost = new UserscriptHarness({
        source, pathname: roomA, frame: true, gmStorage: new Map(), dropFirstReady: true,
        localStorage: storage([[roomA, state('First')]]),
    });
    await lost.advance(0);
    assert.equal(reports(lost, 'ready').length, 1);
    assert.equal(reports(lost, 'ready')[0].delivered, false);
    assert.equal(arms(lost).length, 0);
    lost.typeChat('Unarmed');
    assert.equal(lost.enter(), true);
    await lost.advance(0);
    assert.equal(reports(lost, 'sent').length, 0);
    await lost.advance(800);
    assert.equal(lost.messages.filter((message) => message.from === 'top').length, 0);
    await lost.advance(199);
    assert.equal(arms(lost).length, 0);
    await lost.advance(1);
    assert.equal(reports(lost, 'ready').length, 2);
    assert.equal(reports(lost, 'ready')[1].delivered, true);
    assert.equal(arms(lost).length, 1);
    assert.equal(arms(lost)[0].delivered, true);
    assert.deepEqual(lastArm(lost), { zetaDm: 1, kind: 'arm', mode: 'count' });
    await lost.advance(5000);
    assert.equal(arms(lost).length, 1);
    assert.equal(reports(lost, 'ready').length, 2);
    assert.equal(await send(lost, 'Hello'), true);
    assert.equal(lost.readRoom(roomA).turnCount, 1);
});

test('ready_repeats_until_armed', async () => {
    const harness = new UserscriptHarness({
        source, pathname: roomA, frame: true, gmStorage: new Map(), localStorage: storage([[roomA, state('First')]]),
    });
    harness.setFrameRect(0, 0);
    await harness.advance(5000);
    assert.equal(reports(harness, 'ready').length, 6);
    assert.equal(reports(harness, 'ready').every((message) => message.delivered), true);
    assert.equal(arms(harness).length, 0);
    harness.typeChat('Hidden');
    assert.equal(harness.enter(), true);
    await harness.advance(0);
    assert.equal(reports(harness, 'sent').length, 0);
    harness.setFrameRect(480, 927);
    await harness.advance(1000);
    assert.equal(reports(harness, 'ready').length, 7);
    assert.deepEqual(arms(harness).map((message) => message.data), [{ zetaDm: 1, kind: 'arm', mode: 'count' }]);
    await harness.advance(5000);
    assert.equal(reports(harness, 'ready').length, 7);
    assert.equal(arms(harness).length, 1);
    assert.equal([...harness.timers.values()].some((timer) => timer.realm === harness.frame), false);

    const offArmed = await make({}, { localStorage: storage([[roomA, state('')]]) });
    await offArmed.advance(5000);
    assert.equal(reports(offArmed, 'ready').length, 1);
    assert.equal(lastArm(offArmed).mode, 'off');
});

test('hidden_same_window_reload_is_rearmed', async () => {
    const harness = await make({ turnCount: 0 });
    assert.equal(await send(harness, 'One'), true);
    assert.equal(harness.readRoom(roomA).turnCount, 1);
    const frameWindow = harness.frame.window;
    harness.setFrameRect(0, 0);
    harness.reloadSameWindow();
    await harness.advance(0);
    assert.equal(harness.frame.window, frameWindow);
    assert.equal(harness.iframe.contentWindow, frameWindow);
    assert.equal(reports(harness, 'ready').length, 2);
    const armsBefore = arms(harness).length;
    await harness.advance(3000);
    assert.equal(arms(harness).length, armsBefore);
    harness.setFrameRect(480, 927);
    await harness.advance(1000);
    assert.equal(arms(harness).length, armsBefore + 1);
    assert.deepEqual(lastArm(harness), { zetaDm: 1, kind: 'arm', mode: 'count' });
    for (const text of ['Two', 'Three', 'Four', 'Five']) {
        assert.equal(await send(harness, text), true);
    }
    assert.equal(harness.readRoom(roomA).turnCount, 5);
    assert.equal(await send(harness, 'Six'), false);
    assert.equal(harness.elements.chat.value, 'Six\n\n*First*');
    assert.equal(harness.readRoom(roomA).turnCount, 0);
    const readies = reports(harness, 'ready').length;
    await harness.advance(5000);
    assert.equal(reports(harness, 'ready').length, readies);

    const visible = await make({ turnCount: 5 });
    visible.reloadSameWindow();
    await visible.advance(0);
    assert.deepEqual(lastArm(visible), { zetaDm: 1, kind: 'arm', mode: 'inject', text: '*First*' });
    assert.equal(await send(visible, 'Hello'), false);
    assert.equal(visible.elements.chat.value, 'Hello\n\n*First*');
});

test('top_messages_only_a_frame_that_has_spoken', async () => {
    const harness = new UserscriptHarness({
        source, pathname: roomA, frame: true, blankFrame: true, gmStorage: new Map(),
        localStorage: storage([[roomA, state('First', { turnCount: 5 })]]),
    });
    assert.equal(harness.frame.origin, topOrigin);
    await harness.advance(2400);
    await harness.editNotes('Second');
    await harness.change('zeta-dm-force', true);
    await harness.click(paste);
    await harness.advance(1600);
    assert.deepEqual(harness.messages, []);
    harness.reloadSameWindow();
    await harness.advance(0);
    assert.deepEqual(lastArm(harness), { zetaDm: 1, kind: 'arm', mode: 'inject', text: '*Second*' });
    assert.equal(await send(harness, 'Hello'), false);
    assert.equal(harness.elements.chat.value, 'Hello\n\n*Second*');
    harness.typeChat('');
    await harness.click(paste);
    await harness.advance(1600);
    assert.equal(harness.elements.chat.value, '*Second*');
    assert.ok(harness.messages.length > 0);
    assert.equal(harness.messages.every((message) => message.delivered), true);
});

test('enter_and_send_count_through_the_frame', async () => {
    const harness = await make({ turnCount: 0, interval: 6 });
    harness.typeChat('Hello');
    assert.equal(harness.enter(), true);
    assert.equal(harness.elements.chat.value, 'Hello');
    await harness.advance(0);
    assert.equal(harness.readRoom(roomA).turnCount, 1);
    harness.typeChat('Again');
    assert.equal(harness.pointerSend(), true);
    assert.equal(harness.elements.chat.value, 'Again');
    await harness.advance(0);
    assert.equal(harness.readRoom(roomA).turnCount, 2);
    assert.equal(harness.elements[counter].textContent, '2 / 6');
    harness.typeChat('Icon');
    harness.frameElements.send.children[0].dispatchEvent(new harness.BrowserEvent('pointerdown'));
    await harness.advance(0);
    assert.equal(harness.readRoom(roomA).turnCount, 3);
    assert.equal(harness.elements[counter].textContent, '3 / 6');
    assert.deepEqual(reports(harness, 'sent').map((message) => message.data.injected), [false, false, false]);
    assert.equal(harness.chatEvents.some((event) => event.type === 'input'), false);
});

test('due_injection_by_enter_holds_and_resends_once', async () => {
    const harness = await make({ turnCount: 5 });
    assert.deepEqual(lastArm(harness), { zetaDm: 1, kind: 'arm', mode: 'inject', text: '*First*' });
    const resent = [];
    harness.elements.chat.addEventListener('keydown', (event) => resent.push(event));
    harness.typeChat('Hello');
    assert.equal(harness.enter(), false);
    assert.equal(harness.elements.chat.value, 'Hello\n\n*First*');
    assert.deepEqual(harness.chatEvents.map(({ type }) => type), ['tracker', 'native-setter', 'input', 'change']);
    await harness.advance(24);
    assert.equal(keydowns(harness).length, 0);
    await harness.advance(1);
    assert.deepEqual(keydowns(harness).map((event) => event.key), ['Enter']);
    assert.equal(resent.length, 1);
    assert.deepEqual(
        { key: resent[0].key, code: resent[0].code, keyCode: resent[0].keyCode, which: resent[0].which,
            bubbles: resent[0].bubbles, cancelable: resent[0].cancelable, target: resent[0].target },
        { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, target: harness.elements.chat },
    );
    await harness.advance(2000);
    assert.equal(keydowns(harness).length, 1);
    const room = harness.readRoom(roomA);
    assert.equal(room.turnCount, 0);
    assert.equal(room.forceNext, false);
    assert.equal(lastArm(harness).mode, 'count');
    assert.equal('text' in lastArm(harness), false);
    assert.deepEqual(reports(harness, 'sent').map((message) => message.data.injected), [true]);
    assert.equal(harness.elements[counter].textContent, '0 / 6');
});

test('due_injection_by_send_button', async () => {
    const harness = await make({ turnCount: 5 });
    harness.typeChat('Hello');
    assert.equal(harness.pointerSend(), true);
    assert.equal(harness.elements.chat.value, 'Hello\n\n*First*');
    await harness.advance(1000);
    assert.equal(keydowns(harness).length, 0);
    assert.equal(harness.readRoom(roomA).turnCount, 0);
    assert.equal(harness.elements[counter].textContent, '0 / 6');
    assert.deepEqual(reports(harness, 'sent').map((message) => message.data.injected), [true]);

    const present = await make({ turnCount: 5 });
    present.typeChat('Already *First* here');
    assert.equal(present.enter(), true);
    assert.equal(present.elements.chat.value, 'Already *First* here');
    await present.advance(100);
    assert.equal(keydowns(present).length, 1);
    assert.deepEqual(reports(present, 'sent').map((message) => message.data.injected), [true]);
    assert.equal(present.readRoom(roomA).turnCount, 0);
});

test('other_buttons_and_fields_never_count', async () => {
    const harness = await make({ turnCount: 5 });
    const before = harness.readRoom(roomA);
    const frame = harness.frameElements;
    harness.typeChat('Hello');
    for (const id of ['suggest', 'asterisk']) {
        assert.equal(harness.pointerOn(id), true);
        frame[id].children[0].dispatchEvent(new harness.BrowserEvent('pointerdown'));
    }
    frame.extra1.value = 'Field text';
    assert.equal(harness.enterOn('extra1'), true);
    harness.typeChat(' \n\t ');
    assert.equal(harness.enter(), true);
    assert.equal(harness.pointerSend(), true);
    harness.typeChat('Hello');
    assert.equal(harness.enterOn('chat', { shiftKey: true }), true);
    assert.equal(harness.enterOn('chat', { isComposing: true }), true);
    assert.equal(harness.elements.chat.dispatchEvent(new harness.BrowserEvent('keydown', { key: 'a' })), true);
    await harness.advance(2000);
    assert.equal(reports(harness, 'sent').length, 0);
    assert.deepEqual(harness.readRoom(roomA), before);
    assert.equal(harness.elements.chat.value, 'Hello');
    assert.deepEqual(['extra1', 'extra2', 'extra3'].map((id) => frame[id].value), ['Field text', '', '']);
    assert.equal(harness.elements[counter].textContent, '5 / 6');
});

test('empty_notes_never_count_or_cross', async () => {
    const rooms = [
        state(''),
        state(' \n** \n\t*** ', { turnCount: 5, forceNext: true }),
    ];
    for (const room of rooms) {
        const harness = await make({}, { localStorage: storage([[roomA, room]]) });
        assert.deepEqual(arms(harness).map((message) => message.data), [{ zetaDm: 1, kind: 'arm', mode: 'off' }]);
        assert.equal(await send(harness, 'Hello'), true);
        harness.typeChat('Again');
        harness.pointerSend();
        await harness.advance(0);
        assert.equal(harness.elements.chat.value, 'Again');
        assert.equal(reports(harness, 'sent').length, 0);
        assert.deepEqual(harness.readRoom(roomA), room);
        harness.postAs({ origin: frameOrigin, source: harness.frame.window }, harness.window,
            { zetaDm: 1, kind: 'sent', injected: false });
        await harness.advance(0);
        assert.deepEqual(harness.readRoom(roomA), room);
    }
    const fresh = await make({}, { localStorage: new Map() });
    assert.deepEqual(lastArm(fresh), { zetaDm: 1, kind: 'arm', mode: 'off' });
    assert.equal(await send(fresh, 'Hello'), true);
    assert.equal(reports(fresh, 'sent').length, 0);
    assert.equal(fresh.readRoom(roomA), null);
});

test('two_quick_sends_inject_once', async () => {
    const harness = await make({ turnCount: 5 });
    harness.typeChat('One');
    assert.equal(harness.enter(), false);
    assert.equal(harness.elements.chat.value, 'One\n\n*First*');
    harness.typeChat('Two');
    assert.equal(harness.enter(), true);
    assert.equal(harness.elements.chat.value, 'Two');
    await harness.advance(0);
    assert.deepEqual(reports(harness, 'sent').map((message) => message.data.injected), [true, false]);
    assert.equal(harness.readRoom(roomA).turnCount, 1);
    assert.equal(harness.readRoom(roomA).forceNext, false);

    const pointer = await make({ turnCount: 5 });
    pointer.typeChat('One');
    pointer.pointerSend();
    pointer.typeChat('Two');
    pointer.pointerSend();
    assert.equal(pointer.elements.chat.value, 'Two');
    await pointer.advance(0);
    assert.deepEqual(reports(pointer, 'sent').map((message) => message.data.injected), [true, false]);
    assert.equal(pointer.readRoom(roomA).turnCount, 1);
});

test('interval_one_injects_every_send', async () => {
    const harness = await make({ interval: 1 });
    for (const text of ['One', 'Two']) {
        assert.equal(await send(harness, text), false);
        assert.equal(harness.elements.chat.value, text + '\n\n*First*');
    }
    harness.typeChat('Three');
    harness.pointerSend();
    assert.equal(harness.elements.chat.value, 'Three\n\n*First*');
    await harness.advance(0);
    assert.equal(await send(harness, 'Four'), false);
    assert.equal(harness.elements.chat.value, 'Four\n\n*First*');
    assert.deepEqual(reports(harness, 'sent').map((message) => message.data.injected), [true, true, true, true]);
    assert.equal(harness.readRoom(roomA).turnCount, 0);
    assert.equal(lastArm(harness).mode, 'inject');
});

test('force_next_injects_and_clears', async () => {
    const harness = await make({ turnCount: 0 });
    assert.equal(lastArm(harness).mode, 'count');
    await harness.change('zeta-dm-force', true);
    await harness.advance(0);
    assert.deepEqual(lastArm(harness), { zetaDm: 1, kind: 'arm', mode: 'inject', text: '*First*' });
    assert.equal(await send(harness, 'Go'), false);
    assert.equal(harness.elements.chat.value, 'Go\n\n*First*');
    const room = harness.readRoom(roomA);
    assert.equal(room.forceNext, false);
    assert.equal(room.turnCount, 0);
    assert.equal(harness.elements['zeta-dm-force'].checked, false);
    assert.equal(lastArm(harness).mode, 'count');
    await harness.change('zeta-dm-force', true);
    await harness.change('zeta-dm-force', false);
    await harness.advance(0);
    assert.equal(lastArm(harness).mode, 'count');
    assert.equal(await send(harness, 'Plain'), true);
    assert.equal(harness.elements.chat.value, 'Plain');
    assert.equal(harness.readRoom(roomA).turnCount, 1);
});

test('paste_through_the_frame', async () => {
    const harness = await make({ turnCount: 3, forceNext: true });
    harness.typeChat('');
    await harness.click(paste);
    assert.equal(harness.elements.chat.value, '');
    await harness.advance(0);
    assert.equal(harness.elements.chat.value, '*First*');
    assert.deepEqual(harness.chatEvents.map(({ type }) => type), ['tracker', 'native-setter', 'input', 'change']);
    assert.deepEqual(pastes(harness).map(({ to, targetOrigin, data }) => [to, targetOrigin, data]),
        [['frame', frameOrigin, { zetaDm: 1, kind: 'paste', text: '*First*' }]]);
    assert.equal(harness.readRoom(roomA).turnCount, 0);
    assert.equal(harness.readRoom(roomA).forceNext, false);
    assert.equal(harness.elements[counter].textContent, '0 / 6');
    assert.equal(harness.elements['zeta-dm-force'].checked, false);

    await send(harness, 'a');
    await send(harness, 'b');
    assert.equal(harness.readRoom(roomA).turnCount, 2);
    harness.typeChat('Hi  ');
    await harness.click(paste);
    await harness.advance(0);
    assert.equal(harness.elements.chat.value, 'Hi\n\n*First*');
    assert.equal(harness.readRoom(roomA).turnCount, 0);

    harness.typeChat(' \n ');
    await harness.click(paste);
    await harness.advance(0);
    assert.equal(harness.elements.chat.value, '*First*');

    await send(harness, 'c');
    const pasted = reports(harness, 'pasted').length;
    harness.typeChat('Keep *First* here');
    await harness.click(paste);
    await harness.advance(0);
    assert.equal(harness.elements.chat.value, 'Keep *First* here');
    assert.deepEqual(harness.chatEvents, []);
    assert.equal(reports(harness, 'pasted').length, pasted);
    assert.equal(harness.readRoom(roomA).turnCount, 1);
    assert.equal(harness.elements[counter].textContent, '1 / 6');
});

test('paste_needs_notes_and_a_visible_frame', async () => {
    const empty = await make({}, { localStorage: storage([[roomA, state(' ** ', { turnCount: 3 })]]) });
    empty.typeChat('Hi');
    await empty.click(paste);
    await empty.advance(0);
    assert.equal(pastes(empty).length, 0);
    assert.equal(empty.elements.chat.value, 'Hi');
    assert.equal(empty.readRoom(roomA).turnCount, 3);
    const hiders = [
        (harness) => harness.iframe.remove(),
        (harness) => harness.setFrameRect(0, 0),
        (harness) => harness.setFrameRect(480, 0),
        (harness) => harness.setFrameRect(0, 927),
    ];
    for (const hide of hiders) {
        const harness = await make({ turnCount: 3 });
        hide(harness);
        harness.typeChat('Hi');
        const before = harness.messages.length;
        await harness.click(paste);
        await harness.advance(1600);
        assert.equal(harness.messages.length, before);
        assert.equal(harness.elements.chat.value, 'Hi');
        assert.equal(harness.readRoom(roomA).turnCount, 3);
    }
});

test('chat_frame_is_the_first_visible_pingpong_iframe', async () => {
    const harness = new UserscriptHarness({
        source, pathname: roomA, frame: true, gmStorage: new Map(),
        localStorage: storage([[roomA, state('First', { turnCount: 5 })]]),
    });
    const posted = [];
    for (const [src, width, height] of [
        ['https://ads.example/frame.html', 300, 250],
        ['https://frame.pingpong.ai/v1/index.html#hidden', 0, 0],
        ['https://frame.pingpong.ai.evil.example/v1/', 480, 927],
        ['http://frame.pingpong.ai/v1/index.html', 480, 927],
    ].reverse()) {
        const decoy = harness.document.body.prepend(new harness.top.Element('iframe'));
        decoy.setAttribute('src', src);
        decoy.rect = { width, height, bottom: height };
        decoy.contentWindow = { postMessage: (...args) => posted.push([src, ...args]) };
    }
    await harness.advance(800);
    await harness.advance(0);
    assert.deepEqual(lastArm(harness), { zetaDm: 1, kind: 'arm', mode: 'inject', text: '*First*' });
    harness.typeChat('');
    await harness.click(paste);
    await harness.advance(0);
    assert.deepEqual(posted, []);
    assert.equal(harness.elements.chat.value, '*First*');
    assert.equal(harness.readRoom(roomA).turnCount, 0);
    assert.equal(lastArm(harness).mode, 'count');
});

test('notes_cross_only_when_due', async () => {
    const harness = await make({ turnCount: 0 });
    await send(harness, 'One');
    await send(harness, 'Two');
    harness.typeChat('Three');
    harness.pointerSend();
    await harness.advance(0);
    await send(harness, 'Four');
    await harness.editNotes('Changed');
    await harness.advance(1600);
    assert.equal(harness.readRoom(roomA).turnCount, 4);
    assert.equal(arms(harness).every((message) => message.data.mode === 'count'), true);
    assert.equal(/First|Changed/.test(JSON.stringify(harness.messages)), false);
    await send(harness, 'Five');
    const crossing = harness.messages.filter((message) => /First|Changed/.test(JSON.stringify(message)));
    assert.deepEqual(crossing.map(({ from, to, data }) => [from, to, data.kind, data.mode, data.text]),
        [['top', 'frame', 'arm', 'inject', '*Changed*']]);
});

test('forged_messages_are_ignored', async () => {
    const harness = await make({ turnCount: 2 });
    const frameWindow = harness.frame.window;
    const topWindow = harness.window;
    const stranger = { postMessage: () => undefined };
    const before = harness.readRoom(roomA);
    const armCount = arms(harness).length;
    harness.typeChat('Hello');
    const toTop = [
        [{ origin: evilOrigin, source: frameWindow }, { zetaDm: 1, kind: 'sent', injected: true }],
        [{ origin: topOrigin, source: frameWindow }, { zetaDm: 1, kind: 'sent', injected: false }],
        [{ origin: evilOrigin, source: frameWindow }, { zetaDm: 1, kind: 'ready' }],
        [{ origin: frameOrigin, source: stranger }, { zetaDm: 1, kind: 'sent', injected: true }],
        [{ origin: frameOrigin, source: stranger }, { zetaDm: 1, kind: 'ready' }],
        [{ origin: frameOrigin, source: topWindow }, { zetaDm: 1, kind: 'pasted' }],
        [{ origin: frameOrigin, source: null }, { zetaDm: 1, kind: 'pasted' }],
        [{ origin: frameOrigin, source: frameWindow }, { kind: 'sent', injected: true }],
        [{ origin: frameOrigin, source: frameWindow }, { zetaDm: '1', kind: 'sent', injected: true }],
        [{ origin: frameOrigin, source: frameWindow }, { zetaDm: true, kind: 'pasted' }],
        [{ origin: frameOrigin, source: frameWindow }, { zetaDm: 1, kind: 'boom' }],
        [{ origin: frameOrigin, source: frameWindow }, { zetaDm: 1, kind: 'Sent', injected: false }],
        [{ origin: frameOrigin, source: frameWindow }, { zetaDm: 1, kind: 'sent', injected: 'yes' }],
        [{ origin: frameOrigin, source: frameWindow }, { zetaDm: 1, kind: 'sent', injected: 1 }],
        [{ origin: frameOrigin, source: frameWindow }, { zetaDm: 1, kind: 'sent' }],
        [{ origin: frameOrigin, source: frameWindow }, null],
        [{ origin: frameOrigin, source: frameWindow }, 'sent'],
        [{ origin: frameOrigin, source: frameWindow }, [1, 'sent']],
    ];
    for (const [sender, data] of toTop) {
        harness.postAs(sender, topWindow, data);
        await harness.advance(0);
        assert.deepEqual(harness.readRoom(roomA), before, JSON.stringify(data));
        assert.equal(arms(harness).length, armCount, JSON.stringify(data));
    }
    const evil = { zetaDm: 1, kind: 'arm', mode: 'inject', text: '*Evil*' };
    const toFrame = [
        [{ origin: evilOrigin, source: topWindow }, evil],
        [{ origin: frameOrigin, source: topWindow }, evil],
        [{ origin: topOrigin, source: stranger }, evil],
        [{ origin: topOrigin, source: frameWindow }, evil],
        [{ origin: topOrigin, source: null }, evil],
        [{ origin: evilOrigin, source: topWindow }, { zetaDm: 1, kind: 'arm', mode: 'off' }],
        [{ origin: topOrigin, source: stranger }, { zetaDm: 1, kind: 'arm', mode: 'off' }],
        [{ origin: topOrigin, source: topWindow }, { ...evil, zetaDm: undefined }],
        [{ origin: topOrigin, source: topWindow }, { ...evil, zetaDm: 2 }],
        [{ origin: topOrigin, source: topWindow }, { zetaDm: 1, kind: 'arm', mode: 'boom' }],
        [{ origin: topOrigin, source: topWindow }, { zetaDm: 1, kind: 'arm', mode: 'boom', text: '*Evil*' }],
        [{ origin: topOrigin, source: topWindow }, { zetaDm: 1, kind: 'arm', mode: 'inject' }],
        [{ origin: topOrigin, source: topWindow }, { zetaDm: 1, kind: 'arm', mode: 'inject', text: 5 }],
        [{ origin: topOrigin, source: topWindow }, { zetaDm: 1, kind: 'arm', mode: 'inject', text: '' }],
        [{ origin: topOrigin, source: topWindow }, { zetaDm: 1, kind: 'arm', mode: 'off', text: '*Evil*' }],
        [{ origin: topOrigin, source: topWindow }, { zetaDm: 1, kind: 'arm' }],
        [{ origin: topOrigin, source: topWindow }, { zetaDm: 1, kind: 'Arm', mode: 'off' }],
        [{ origin: evilOrigin, source: topWindow }, { zetaDm: 1, kind: 'paste', text: '*Evil*' }],
        [{ origin: topOrigin, source: stranger }, { zetaDm: 1, kind: 'paste', text: '*Evil*' }],
        [{ origin: topOrigin, source: topWindow }, { zetaDm: 1, kind: 'paste', text: 5 }],
        [{ origin: topOrigin, source: topWindow }, { zetaDm: 1, kind: 'paste', text: '' }],
        [{ origin: topOrigin, source: topWindow }, { zetaDm: 1, kind: 'paste' }],
        [{ origin: topOrigin, source: topWindow }, null],
        [{ origin: topOrigin, source: topWindow }, 'arm'],
    ];
    for (const [sender, data] of toFrame) {
        harness.postAs(sender, frameWindow, data);
        await harness.advance(0);
        assert.equal(harness.elements.chat.value, 'Hello', JSON.stringify(data));
    }
    assert.equal(await send(harness, 'Hello'), true);
    assert.equal(harness.elements.chat.value, 'Hello');
    assert.equal(harness.readRoom(roomA).turnCount, 3);
    assert.equal(reports(harness, 'pasted').length, 0);

    harness.iframe.remove();
    harness.postAs({ origin: frameOrigin, source: null }, topWindow, { zetaDm: 1, kind: 'pasted' });
    harness.postAs({ origin: frameOrigin, source: undefined }, topWindow, { zetaDm: 1, kind: 'sent', injected: false });
    await harness.advance(0);
    assert.equal(harness.readRoom(roomA).turnCount, 3);
});

test('site_traffic_skips_the_frame_lookup', async () => {
    const harness = await make({ turnCount: 2 });
    let reads = 0;
    const measure = harness.iframe.getBoundingClientRect.bind(harness.iframe);
    harness.iframe.getBoundingClientRect = () => {
        reads += 1;
        return measure();
    };
    for (const data of [{ type: 'resize', height: 900 }, 'token', null, { zetaDm: 2, kind: 'sent', injected: false }]) {
        harness.postAs({ origin: frameOrigin, source: harness.frame.window }, harness.window, data);
    }
    harness.postAs({ origin: evilOrigin, source: harness.frame.window }, harness.window,
        { zetaDm: 1, kind: 'sent', injected: false });
    await harness.advance(0);
    assert.equal(reads, 0);
    assert.equal(harness.readRoom(roomA).turnCount, 2);
    harness.postAs({ origin: frameOrigin, source: harness.frame.window }, harness.window,
        { zetaDm: 1, kind: 'sent', injected: false });
    await harness.advance(0);
    assert.ok(reads > 0);
    assert.equal(harness.readRoom(roomA).turnCount, 3);
});

test('reloaded_frame_is_rearmed_and_old_one_dropped', async () => {
    const harness = await make({ turnCount: 2 });
    const oldArms = arms(harness, 'frame').length;
    const old = harness.reloadFrame();
    await harness.advance(0);
    assert.deepEqual(arms(harness, 'frame2').map((message) => message.data), [{ zetaDm: 1, kind: 'arm', mode: 'count' }]);
    const oldChat = harness.byId(old.document).chat;
    oldChat.focus();
    oldChat.value = 'Stale';
    oldChat.dispatchEvent(new harness.BrowserEvent('keydown', { key: 'Enter', bubbles: true }));
    await harness.advance(0);
    assert.equal(harness.messages.filter((message) => message.from === 'frame' && message.data.kind === 'sent').length, 1);
    assert.equal(harness.readRoom(roomA).turnCount, 2);
    harness.postAs({ origin: frameOrigin, source: old.window }, harness.window, { zetaDm: 1, kind: 'pasted' });
    harness.postAs({ origin: frameOrigin, source: old.window }, harness.window, { zetaDm: 1, kind: 'ready' });
    await harness.advance(0);
    assert.equal(harness.readRoom(roomA).turnCount, 2);
    assert.equal(await send(harness, 'Fresh'), true);
    assert.equal(harness.readRoom(roomA).turnCount, 3);
    await harness.advance(1600);
    assert.equal(arms(harness, 'frame').length, oldArms);

    harness.dropNextReady = true;
    harness.reloadFrame();
    await harness.advance(0);
    assert.equal(reports(harness, 'ready').at(-1).delivered, false);
    assert.equal(arms(harness, 'frame3').length, 0);
    await harness.advance(999);
    assert.equal(harness.messages.filter((message) => message.to === 'frame3').length, 0);
    await harness.advance(1);
    assert.deepEqual(arms(harness, 'frame3').map((message) => message.data), [{ zetaDm: 1, kind: 'arm', mode: 'count' }]);
    assert.equal(await send(harness, 'Third'), true);
    assert.equal(harness.readRoom(roomA).turnCount, 4);
});

test('room_change_rearms', async () => {
    const harness = await make({}, {
        localStorage: storage([[roomA, state('First')], [roomB, state('Bravo', { turnCount: 5 })]]),
    });
    assert.equal(lastArm(harness).mode, 'count');
    const frameWindow = harness.frame.window;
    harness.navigate(roomB);
    await harness.advance(800);
    assert.equal(harness.frame.window, frameWindow);
    assert.deepEqual(lastArm(harness), { zetaDm: 1, kind: 'arm', mode: 'inject', text: '*Bravo*' });
    assert.equal(await send(harness, 'Hello'), false);
    assert.equal(harness.elements.chat.value, 'Hello\n\n*Bravo*');
    assert.equal(harness.readRoom(roomB).turnCount, 0);
    assert.equal(harness.readRoom(roomA).turnCount, 0);
    harness.navigate(roomA);
    await harness.advance(800);
    assert.deepEqual(lastArm(harness), { zetaDm: 1, kind: 'arm', mode: 'count' });
    assert.equal(await send(harness, 'Back'), true);
    assert.equal(harness.readRoom(roomA).turnCount, 1);
    assert.equal(harness.readRoom(roomB).turnCount, 0);
    harness.navigate('/en/explore');
    await harness.advance(800);
    assert.equal(lastArm(harness).mode, 'off');
    assert.equal(await send(harness, 'Elsewhere'), true);
    assert.equal(harness.readRoom('/en/explore'), null);
    assert.equal(harness.readRoom(roomA).turnCount, 1);
});

test('room_change_is_followed_within_100_ms', async () => {
    const rooms = [
        [roomA, state('Alpha secret', { turnCount: 5 })],
        [roomB, state('Bravo', { turnCount: 0 })],
    ];
    const harness = await make({}, { localStorage: storage(rooms) });
    assert.equal(lastArm(harness).text, '*Alpha secret*');
    harness.navigate(roomB);
    await harness.advance(100);
    assert.deepEqual(lastArm(harness), { zetaDm: 1, kind: 'arm', mode: 'count' });
    await harness.advance(200);
    assert.equal(await send(harness, 'Hello bravo'), true);
    assert.equal(harness.elements.chat.value, 'Hello bravo');
    assert.equal(harness.readRoom(roomA).turnCount, 5);
    assert.equal(harness.readRoom(roomB).turnCount, 1);
    assert.equal(JSON.stringify(harness.messages.filter((message) => message.to === 'frame').slice(1)).includes('Alpha'), false);

    const due = await make({}, {
        localStorage: storage([[roomA, state('Alpha secret')], [roomB, state('Bravo', { turnCount: 5 })]]),
    });
    due.navigate(roomB);
    await due.advance(100);
    assert.deepEqual(lastArm(due), { zetaDm: 1, kind: 'arm', mode: 'inject', text: '*Bravo*' });
    assert.equal(await send(due, 'Hello bravo'), false);
    assert.equal(due.elements.chat.value, 'Hello bravo\n\n*Bravo*');
    assert.equal(due.readRoom(roomB).turnCount, 0);
    assert.equal(due.readRoom(roomA).turnCount, 0);
    due.navigate(roomA);
    await due.advance(100);
    assert.deepEqual(lastArm(due), { zetaDm: 1, kind: 'arm', mode: 'count' });
    assert.equal(due.elements[notesField].value, 'Alpha secret');
    due.navigate('/en/explore');
    await due.advance(100);
    assert.deepEqual(lastArm(due), { zetaDm: 1, kind: 'arm', mode: 'off' });

    const focused = await make({}, {
        localStorage: storage([[roomA, state('Alpha secret')], [roomB, state('Bravo', { turnCount: 5 })]]),
    });
    focused.navigate(roomB);
    await focused.focus();
    await focused.advance(100);
    assert.deepEqual(lastArm(focused), { zetaDm: 1, kind: 'arm', mode: 'inject', text: '*Bravo*' });
});

test('room_check_keeps_running_without_the_widget', async () => {
    const harness = new UserscriptHarness({
        source, pathname: roomA, frame: true, gmStorage: new Map([[keyName, key]]),
        localStorage: storage([[roomA, state('Alpha secret', { turnCount: 5 })], [roomB, state('Bravo', { turnCount: 5 })]]),
    });
    await harness.advance(799);
    assert.equal(harness.requests.length, 0);
    await harness.advance(1);
    assert.equal(harness.requests.length, 1);
    await harness.advance(50);
    harness.elements['zeta-dm-widget'].remove();
    harness.navigate(roomB);
    await harness.advance(100);
    assert.equal(harness.elements['zeta-dm-widget'], undefined);
    assert.deepEqual(lastArm(harness), { zetaDm: 1, kind: 'arm', mode: 'inject', text: '*Bravo*' });
    await harness.advance(200);
    assert.equal(await send(harness, 'Hello bravo'), false);
    assert.equal(harness.elements.chat.value, 'Hello bravo\n\n*Bravo*');
    assert.equal(harness.readRoom(roomB).turnCount, 0);
    assert.equal(harness.readRoom(roomA).turnCount, 5);

    const leak = await make({}, {
        localStorage: storage([[roomA, state('Alpha secret', { turnCount: 5 })], [roomB, state('Bravo', { turnCount: 0 })]]),
    });
    await leak.advance(50);
    leak.elements['zeta-dm-widget'].remove();
    leak.navigate(roomB);
    await leak.advance(300);
    assert.equal(await send(leak, 'Hello bravo'), true);
    assert.equal(leak.elements.chat.value, 'Hello bravo');
    assert.equal(leak.readRoom(roomA).turnCount, 5);
    assert.equal(leak.readRoom(roomB).turnCount, 1);
});

test('earlier_spoken_frame_window_is_rearmed_when_shown_again', async () => {
    const harness = await make({ turnCount: 0 });
    const iframeA = harness.iframe;
    const realmA = harness.frame;
    const visible = { width: 480, height: 927, bottom: 927 };
    const hidden = { width: 0, height: 0, bottom: 0 };
    iframeA.rect = hidden;
    const iframeB = harness.document.body.appendChild(new harness.top.Element('iframe'));
    iframeB.setAttribute('src', 'https://frame.pingpong.ai/v1/index.html#run=r2&host=h');
    iframeB.rect = visible;
    harness.iframe = iframeB;
    harness.reloadFrame();
    const realmB = harness.frame;
    await harness.advance(0);
    assert.deepEqual(lastArm(harness, realmB.name), { zetaDm: 1, kind: 'arm', mode: 'count' });
    assert.equal(await sendIn(harness, realmB, 'B one'), true);
    assert.equal(harness.readRoom(roomA).turnCount, 1);

    iframeA.rect = visible;
    const readies = reports(harness, 'ready').length;
    await harness.change('zeta-dm-force', true);
    await harness.advance(0);
    assert.deepEqual(lastArm(harness, realmA.name), { zetaDm: 1, kind: 'arm', mode: 'inject', text: '*First*' });
    assert.equal(await sendIn(harness, realmA, 'A two'), false);
    assert.equal(harness.byId(realmA.document).chat.value, 'A two\n\n*First*');
    assert.equal(harness.readRoom(roomA).forceNext, false);
    assert.equal(harness.readRoom(roomA).turnCount, 0);
    const chatA = harness.byId(realmA.document).chat;
    chatA.value = '';
    await harness.click(paste);
    await harness.advance(0);
    assert.equal(chatA.value, '*First*');
    assert.equal(reports(harness, 'ready').length, readies);

    iframeA.rect = hidden;
    await harness.advance(800);
    for (const text of ['B two', 'B three', 'B four', 'B five', 'B six']) {
        assert.equal(await sendIn(harness, realmB, text), true);
    }
    assert.equal(harness.readRoom(roomA).turnCount, 5);
    assert.deepEqual(lastArm(harness, realmB.name), { zetaDm: 1, kind: 'arm', mode: 'inject', text: '*First*' });
    assert.equal(lastArm(harness, realmA.name).mode, 'count');
    iframeA.rect = visible;
    await harness.advance(800);
    assert.deepEqual(lastArm(harness, realmA.name), { zetaDm: 1, kind: 'arm', mode: 'inject', text: '*First*' });
    assert.equal(await sendIn(harness, realmA, 'A three'), false);
    assert.equal(harness.byId(realmA.document).chat.value, 'A three\n\n*First*');
    assert.equal(harness.readRoom(roomA).turnCount, 0);
    assert.equal(reports(harness, 'ready').length, readies);
    assert.equal(harness.messages.every((message) => message.delivered), true);
});

test('arm_follows_normalised_notes_and_the_draft', async () => {
    for (const notes of [true, 42, null, ['First'], { line: 'First' }]) {
        const harness = new UserscriptHarness({
            source, pathname: roomA, frame: true, gmStorage: new Map([[keyName, key]]),
            localStorage: storage([[roomA, state(notes, { turnCount: 5 })]]),
        });
        for (let tick = 0; tick < 4; tick += 1) {
            await harness.advance(800);
        }
        assert.equal(harness.requests.length, 1, JSON.stringify(notes));
        assert.deepEqual(lastArm(harness), { zetaDm: 1, kind: 'arm', mode: 'off' }, JSON.stringify(notes));
        harness.postAs({ origin: frameOrigin, source: harness.frame.window }, harness.window,
            { zetaDm: 1, kind: 'sent', injected: false });
        await harness.advance(0);
        assert.equal(harness.readRoom(roomA).turnCount, 5);
        assert.equal(await send(harness, 'Hello'), true);
        assert.equal(reports(harness, 'sent').length, 0);
        assert.equal(harness.elements[counter].textContent, '5 / 6');
    }

    const draft = await make({ turnCount: 5 });
    draft.failLocalWrites = true;
    await draft.editNotes('Draft line');
    await draft.advance(0);
    assert.equal(draft.readRoom(roomA).notes, 'First');
    assert.deepEqual(lastArm(draft), { zetaDm: 1, kind: 'arm', mode: 'inject', text: '*Draft line*' });
    assert.equal(await send(draft, 'Hello'), false);
    assert.equal(draft.elements.chat.value, 'Hello\n\n*Draft line*');
});

test('unrelated_iframes_are_never_measured', async () => {
    const harness = await make({ turnCount: 5 });
    let reads = 0;
    for (const src of ['https://ads.example/slot.html', '', 'about:blank', 'https://frame.pingpong.ai.evil.example/']) {
        const advert = harness.document.body.prepend(new harness.top.Element('iframe'));
        advert.setAttribute('src', src);
        advert.contentWindow = { postMessage: () => undefined };
        advert.getBoundingClientRect = () => {
            reads += 1;
            return { width: 300, height: 250, bottom: 250 };
        };
    }
    await harness.advance(8000);
    await harness.editNotes('Second');
    harness.typeChat('');
    await harness.click(paste);
    await harness.advance(0);
    assert.equal(harness.elements.chat.value, '*Second*');
    assert.equal(await send(harness, 'Hello'), true);
    await harness.advance(800);
    assert.equal(reads, 0);
    assert.equal(harness.elements.chat.value, 'Hello');
    assert.equal(harness.readRoom(roomA).turnCount, 1);
});

test('notes_edit_reaches_the_frame_before_the_send', async () => {
    const harness = await make({ turnCount: 5 });
    await harness.editNotes('Second');
    await harness.advance(0);
    assert.deepEqual(lastArm(harness), { zetaDm: 1, kind: 'arm', mode: 'inject', text: '*Second*' });
    assert.equal(await send(harness, 'Hello'), false);
    assert.equal(harness.elements.chat.value, 'Hello\n\n*Second*');
    assert.equal(harness.readRoom(roomA).turnCount, 0);
    await harness.change('zeta-dm-interval', '1');
    await harness.advance(0);
    assert.deepEqual(lastArm(harness), { zetaDm: 1, kind: 'arm', mode: 'inject', text: '*Second*' });
    await harness.editNotes('');
    await harness.advance(0);
    assert.equal(lastArm(harness).mode, 'off');
    assert.equal(await send(harness, 'Plain'), true);
    assert.equal(harness.elements.chat.value, 'Plain');
    assert.equal(harness.readRoom(roomA).turnCount, 0);
    assert.equal(reports(harness, 'sent').length, 1);
});

test('cloud_change_rearms_within_the_loop', async () => {
    const harness = await make({ turnCount: 5 }, { gmStorage: new Map([[keyName, key]]) });
    await harness.completeRequest(0, { data: memory(roomA, 'First', 1) });
    assert.equal(lastArm(harness).text, '*First*');
    await harness.focus();
    await harness.completeRequest(1, { data: memory(roomA, 'Cloud line', 2) });
    assert.equal(harness.readRoom(roomA).notes, 'Cloud line');
    assert.equal(lastArm(harness).text, '*First*');
    await harness.advance(799);
    assert.equal(lastArm(harness).text, '*First*');
    await harness.advance(1);
    assert.deepEqual(lastArm(harness), { zetaDm: 1, kind: 'arm', mode: 'inject', text: '*Cloud line*' });

    await harness.click('zeta-dm-open-import');
    await harness.completeRequest(2, { data: { items: [{ roomId: externalSource, revision: 1, updatedAt }], nextCursor: null } });
    await harness.change('zeta-dm-import-source', externalSource);
    await harness.click('zeta-dm-import-confirm');
    await harness.completeRequest(3, { data: memory(externalSource, 'Imported line', 4) });
    assert.equal(harness.readRoom(roomA).notes, 'Imported line');
    await harness.advance(800);
    assert.deepEqual(lastArm(harness), { zetaDm: 1, kind: 'arm', mode: 'inject', text: '*Imported line*' });
    assert.equal(await send(harness, 'Hello'), false);
    assert.equal(harness.elements.chat.value, 'Hello\n\n*Imported line*');
    assert.equal(harness.readRoom(roomA).turnCount, 0);
});

test('formatting_crosses_unchanged', async () => {
    const notes = ' \t*First* \r\n\r\n **Second** \n';
    const harness = await make({}, { localStorage: storage([[roomA, state(notes, { turnCount: 5 })]]) });
    assert.equal(lastArm(harness).text, '*First*\n*Second*');
    assert.equal(await send(harness, 'Hello'), false);
    assert.equal(harness.elements.chat.value, 'Hello\n\n*First*\n*Second*');
    harness.typeChat('');
    await harness.click(paste);
    await harness.advance(0);
    assert.equal(harness.elements.chat.value, '*First*\n*Second*');
    assert.equal(pastes(harness)[0].data.text, '*First*\n*Second*');

    const literal = 'Cost $& and $1 </textarea> <b>bold</b>\r\n***';
    const special = await make({}, { localStorage: storage([[roomA, state(literal, { turnCount: 5 })]]) });
    assert.equal(await send(special, 'Hi'), false);
    assert.equal(special.elements.chat.value, 'Hi\n\n*Cost $& and $1 </textarea> <b>bold</b>*');
});

test('top_hooks_only_touch_the_chat_box', async () => {
    const harness = new UserscriptHarness({
        source, pathname: roomA, gmStorage: new Map(), localStorage: storage([[roomA, state('First', { turnCount: 5 })]]),
    });
    await harness.advance(800);
    const body = harness.document.body;
    const search = body.appendChild(harness.document.createElement('input'));
    search.setAttribute('id', 'search');
    search.setAttribute('type', 'text');
    search.value = 'query';
    const other = body.appendChild(harness.document.createElement('textarea'));
    other.setAttribute('id', 'other');
    other.value = 'draft';
    const icon = body.appendChild(harness.document.createElement('button'));
    icon.setAttribute('id', 'icon');
    icon.setAttribute('type', 'submit');
    icon.appendChild(harness.document.createElement('svg'));
    for (const id of ['search', 'other', 'zeta-dm-notes', 'zeta-dm-interval']) {
        assert.equal(harness.enterOn(id), true, id);
    }
    harness.typeChat('Hello');
    assert.equal(harness.pointerOn('icon'), true);
    icon.children[0].dispatchEvent(new harness.BrowserEvent('pointerdown'));
    harness.pointerOn('zeta-dm-InsertNow');
    await harness.advance(100);
    assert.equal(harness.readRoom(roomA).turnCount, 5);
    assert.equal(search.value, 'query');
    assert.equal(other.value, 'draft');
    assert.equal(harness.elements.chat.value, 'Hello');
    harness.elements.chat.remove();
    search.focus();
    await harness.click(paste);
    await harness.advance(100);
    assert.equal(search.value, 'query');
    assert.equal(other.value, 'draft');
    assert.equal(harness.readRoom(roomA).turnCount, 5);
    assert.deepEqual(harness.messages, []);
});

test('other_origins_and_foreign_parents_stay_idle', async () => {
    for (const origin of [frameOrigin, evilOrigin]) {
        const harness = new UserscriptHarness({
            source, pathname: roomA, origin, gmStorage: new Map([[keyName, key]]),
            localStorage: storage([[roomA, state('First', { turnCount: 5 })]]),
        });
        await harness.advance(1600);
        harness.typeChat('Hello');
        assert.equal(harness.enter(), true);
        harness.pointerSend();
        await harness.advance(100);
        assert.equal(harness.elements['zeta-dm-widget'], undefined);
        assert.equal(harness.elements.chat.value, 'Hello');
        assert.equal(harness.menus.size, 0);
        assert.deepEqual(harness.requests, []);
        assert.deepEqual(harness.messages, []);
        assert.deepEqual(harness.localWrites, []);
        assert.equal(harness.timers.size, 0);
    }
    for (const ancestors of [true, false]) {
        const foreign = new UserscriptHarness({
            source, pathname: '/embed', origin: 'https://other.example', frame: true, ancestors, gmStorage: new Map(),
        });
        await foreign.advance(3000);
        const readies = reports(foreign, 'ready');
        if (ancestors) {
            assert.equal(readies.length, 0);
            assert.equal([...foreign.timers.values()].some((timer) => timer.realm === foreign.frame), false);
        } else {
            assert.equal(readies.length, 4);
            assert.equal(readies.every((message) => !message.delivered && message.targetOrigin === topOrigin), true);
        }
        for (const data of [
            { zetaDm: 1, kind: 'arm', mode: 'inject', text: '*Evil*' },
            { zetaDm: 1, kind: 'paste', text: '*Evil*' },
        ]) {
            foreign.postAs({ origin: 'https://other.example', source: foreign.window }, foreign.frame.window, data);
        }
        await foreign.advance(0);
        assert.equal(await send(foreign, 'Hello'), true);
        assert.equal(foreign.elements.chat.value, 'Hello');
        assert.equal(reports(foreign, 'sent').length, 0);
        assert.deepEqual(foreign.frameCalls, []);
    }

    const nested = new UserscriptHarness({
        source, pathname: roomA, frame: true, gmStorage: new Map(), localStorage: storage([[roomA, state('First')]]),
    });
    await nested.advance(0);
    assert.equal(reports(nested, 'ready').length, 1);
    nested.ancestors = [frameOrigin, topOrigin];
    nested.reloadSameWindow();
    await nested.advance(3000);
    assert.equal(reports(nested, 'ready').length, 1);
    assert.equal(await send(nested, 'Hello'), true);
    assert.equal(reports(nested, 'sent').length, 0);
});

test('header_and_title', async () => {
    assert.ok(source.includes('\n// @match        https://zeta-ai.io/*\n'));
    assert.ok(source.includes('\n// @match        https://frame.pingpong.ai/*\n'));
    assert.ok(source.includes('\n// @version      1.4\n'));
    assert.equal(source.includes('@noframes'), false);
    assert.deepEqual(source.match(/^\/\/ @(?:grant|connect) .*$/gm), [
        '// @grant        GM_getValue',
        '// @grant        GM_setValue',
        '// @grant        GM_xmlhttpRequest',
        '// @grant        GM_registerMenuCommand',
        '// @grant        GM_addValueChangeListener',
        '// @connect      zeta-dm-memory.elit1989.workers.dev',
    ]);
    assert.equal(/\p{Extended_Pictographic}/u.test(source), false);
    const harness = await make();
    assert.equal(harness.elements['zeta-dm-header'].children[0].textContent, 'DM Memory v1.4');
});
