import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import FakeEvent from './support/FakeEvent.mjs';
import FakeNode from './support/FakeNode.mjs';
import FakeSendDocument from './support/FakeSendDocument.mjs';
import FakeSendWindow from './support/FakeSendWindow.mjs';
import FakeTextArea from './support/FakeTextArea.mjs';
import FakeTextInput from './support/FakeTextInput.mjs';

/**
 * @return {object}
 */
function load() {
    const context = vm.createContext({ TextEncoder });
    for (const path of ['../scribe/core/ScribeText.js', '../scribe/page/ScribeSender.js']) {
        const url = new URL(path, import.meta.url);
        vm.runInContext(readFileSync(url, 'utf8'), context, { filename: url.pathname });
    }
    return vm.runInContext('ScribeSender', context);
}

const ScribeSender = load();
const NATIVE = Object.getOwnPropertyDescriptor(FakeTextArea.prototype, 'value');
const LINE = '\n@: [Scribe] Day 1, the mill.';
const ENTER = Object.freeze({ key: 'Enter', keyCode: 13 });

/**
 * @param {string} text
 * @return {string}
 */
function appendLine(text) {
    return text + LINE;
}

/**
 * @param {{ tracker?: boolean }} options
 * @return {object}
 */
function makePage(options = {}) {
    const window = new FakeSendWindow();
    const document = new FakeSendDocument(window);
    const panel = document.add(new FakeNode('div', { id: 'scribe-panel' }));
    const box = document.add(new FakeTextArea({ name: 'message', tracker: options.tracker }));
    const button = document.add(new FakeNode('button', { type: 'button', bottom: 860, label: 'Send' }));
    const icon = button.append(new FakeNode('svg'));
    const page = {
        window,
        document,
        panel,
        box,
        button,
        icon,
        state: '',
        sentTexts: [],
        prevented: [],
        keys: [],
        inputs: [],
        refusing: false,
        clearAfter: 0,
    };
    box.addEventListener('input', (event) => {
        page.inputs.push(event.data);
        if (box.value !== box.tracked) {
            box.tracked = box.value;
            page.state = box.value;
        }
    });
    page.send = (event) => {
        if (page.state.trim() === '') {
            return;
        }
        page.prevented.push(event.defaultPrevented);
        if (page.refusing) {
            return;
        }
        page.sentTexts.push(page.state);
        const clear = () => {
            page.state = '';
            box.value = '';
        };
        if (page.clearAfter > 0) {
            window.setTimeout(clear, page.clearAfter);
        } else {
            clear();
        }
    };
    box.addEventListener('keydown', (event) => {
        page.keys.push([event.key, event.code, event.keyCode, event.which, event.bubbles, event.cancelable]);
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
            page.send(event);
        }
    });
    button.addEventListener('pointerdown', page.send);
    return page;
}

/**
 * @param {object} page
 * @param {string} text
 * @param {FakeTextArea|null} field
 * @return {void}
 */
function type(page, text, field = null) {
    const target = field ?? page.box;
    page.document.focus(target);
    NATIVE.set.call(target, text);
    target.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    target.forget();
    page.inputs = [];
}

/**
 * @param {object} page
 * @param {function(string): string} outgoing
 * @param {function(): void} sent
 * @return {{ calls: { outgoing: string[], sent: number }, handle: { detach: function(): void } }}
 */
function wire(page, outgoing, sent = () => {}) {
    const calls = { outgoing: [], sent: 0 };
    const handle = ScribeSender.attach({
        document: page.document,
        window: page.window,
        ignore: page.panel,
        outgoing: (text) => {
            calls.outgoing.push(text);
            return outgoing(text);
        },
        sent: () => {
            calls.sent++;
            sent();
        },
    });
    return { calls, handle };
}

/**
 * @param {object} page
 * @param {object} extra
 * @param {object|null} field
 * @return {FakeEvent}
 */
function pressEnter(page, extra = {}, field = null) {
    const target = field ?? page.box;
    page.document.focus(target);
    return page.window.dispatch(target, 'keydown', { ...ENTER, ...extra });
}

/**
 * @param {FakeNode} node
 * @return {number}
 */
function keydowns(node) {
    return node.events.filter(([type]) => type === 'keydown').length;
}

/**
 * @param {object} page
 * @param {string} key
 * @param {object} extra
 * @return {FakeEvent}
 */
function keyOn(page, key, extra = {}) {
    page.document.focus(page.box);
    return page.window.dispatch(page.box, 'keydown', { key, ...extra });
}

/**
 * @param {object} page
 * @param {string} value
 * @return {void}
 */
function edit(page, value) {
    NATIVE.set.call(page.box, value);
    page.box.dispatchEvent(new FakeEvent('input', { bubbles: true }));
}

/**
 * @param {object} page
 * @return {{ part: { ready: string|null }, calls: { outgoing: string[], sent: number }, handle: { detach: function(): void } }}
 */
function liveOf(page) {
    const part = { ready: LINE };
    const wired = wire(
        page,
        (text) => (part.ready === null ? text : text + part.ready),
        () => {
            part.ready = null;
        },
    );
    return { part, calls: wired.calls, handle: wired.handle };
}

test('enter is held back and sent again', () => {
    const page = makePage();
    const { calls } = wire(page, appendLine);
    type(page, 'Hello');
    const event = pressEnter(page);
    const expected = appendLine('Hello');
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.immediateStopped, true);
    assert.deepEqual(calls.outgoing, ['Hello']);
    assert.equal(page.box.value, expected);
    assert.equal(page.state, expected);
    assert.deepEqual(page.keys, []);
    assert.equal(keydowns(page.box), 0);
    page.window.advance(24);
    assert.equal(keydowns(page.box), 0);
    assert.deepEqual(page.keys, []);
    page.window.advance(1);
    assert.equal(keydowns(page.box), 1);
    assert.deepEqual(page.keys, [['Enter', 'Enter', 13, 13, true, true]]);
    assert.deepEqual(page.prevented, [false]);
    assert.deepEqual(page.sentTexts, [expected]);
    assert.deepEqual(calls.outgoing, ['Hello']);
    assert.equal(calls.sent, 0);
    page.window.advance(100);
    assert.equal(calls.sent, 1);
    page.window.advance(5000);
    assert.equal(calls.sent, 1);
    assert.equal(keydowns(page.box), 1);
    assert.equal(page.box.value, '');
    assert.equal(page.window.timerCount, 0);

    const slow = makePage();
    slow.clearAfter = 650;
    const late = wire(slow, appendLine);
    type(slow, 'Hello again');
    pressEnter(slow);
    slow.window.advance(600);
    assert.equal(late.calls.sent, 0);
    assert.equal(slow.box.value, appendLine('Hello again'));
    slow.window.advance(200);
    assert.equal(late.calls.sent, 1);
    slow.window.advance(5000);
    assert.equal(late.calls.sent, 1);

    const quiet = makePage();
    const nothing = wire(quiet, (text) => text);
    type(quiet, 'Quiet words');
    const plain = pressEnter(quiet);
    assert.equal(plain.defaultPrevented, false);
    assert.equal(plain.immediateStopped, false);
    assert.deepEqual(quiet.sentTexts, ['Quiet words']);
    assert.equal(quiet.keys.length, 1);
    quiet.window.advance(5000);
    assert.equal(keydowns(quiet.box), 0);
    assert.equal(quiet.keys.length, 1);
    assert.equal(nothing.calls.sent, 1);
});

test('the value is set the way the page notices', () => {
    const page = makePage();
    wire(page, appendLine);
    type(page, 'Hello');
    pressEnter(page);
    const expected = appendLine('Hello');
    assert.deepEqual(page.box.trail, [
        'tracker:Hello',
        `native:${expected}`,
        'event:input:true:insertText',
        'event:change:true:',
    ]);
    assert.deepEqual(page.inputs, [expected]);
    assert.equal(page.state, expected);

    const bare = makePage({ tracker: false });
    wire(bare, appendLine);
    type(bare, 'Hello');
    pressEnter(bare);
    assert.equal(Object.hasOwn(bare.box, '_valueTracker'), false);
    assert.deepEqual(bare.box.trail, [`native:${expected}`, 'event:input:true:insertText', 'event:change:true:']);
    assert.equal(bare.state, expected);
    bare.window.advance(25);
    assert.deepEqual(bare.sentTexts, [expected]);
});

test('shift-enter and composition do nothing', () => {
    const page = makePage();
    const other = page.document.add(new FakeNode('input', { type: 'search' }));
    const { calls } = wire(page, appendLine);
    type(page, 'Hello');
    const events = [
        pressEnter(page, { shiftKey: true }),
        pressEnter(page, { isComposing: true }),
        pressEnter(page, { keyCode: 229 }),
        pressEnter(page, { key: 'a', keyCode: 65 }),
        pressEnter(page, {}, other),
    ];
    page.window.advance(5000);
    assert.deepEqual(
        events.map((event) => event.defaultPrevented || event.immediateStopped),
        [false, false, false, false, false],
    );
    assert.deepEqual(calls.outgoing, []);
    assert.equal(calls.sent, 0);
    assert.deepEqual(page.box.trail, []);
    assert.equal(page.box.value, 'Hello');
    assert.deepEqual(page.sentTexts, []);
    assert.equal(keydowns(page.box), 0);
    assert.equal(page.window.timerCount, 0);

    type(page, '   \n ');
    pressEnter(page);
    page.window.dispatch(page.icon, 'pointerdown');
    page.window.advance(5000);
    assert.deepEqual(calls.outgoing, []);
    assert.equal(calls.sent, 0);
    assert.deepEqual(page.box.trail, []);
    assert.equal(page.box.value, '   \n ');
});

test('only send is send', () => {
    const page = makePage();
    const { calls } = wire(page, appendLine);
    const others = ['Suggested replies', 'Insert asterisk'].map((label) => {
        const button = page.document.add(new FakeNode('button', { type: 'button', bottom: 870, label }));
        const icon = button.append(new FakeNode('svg'));
        return { button, icon };
    });
    const submit = page.document.add(new FakeNode('button', { type: 'submit', bottom: 870 }));
    submit.append(new FakeNode('svg'));
    const lowerCase = page.document.add(new FakeNode('button', { type: 'submit', bottom: 870, label: 'send' }));
    const labelledDiv = page.document.add(new FakeNode('div', { bottom: 870, label: 'Send' }));
    type(page, 'Not a send');
    for (const other of others) {
        page.window.dispatch(other.button, 'pointerdown');
        page.window.dispatch(other.icon, 'pointerdown');
    }
    for (const node of [submit, lowerCase, labelledDiv, page.box]) {
        page.window.dispatch(node, 'pointerdown');
    }
    page.window.advance(5000);
    assert.deepEqual(calls.outgoing, []);
    assert.equal(calls.sent, 0);
    assert.equal(page.box.value, 'Not a send');
    assert.deepEqual(page.box.trail, []);
    assert.equal(page.window.timerCount, 0);

    type(page, 'By the send button');
    const pressed = page.window.dispatch(page.button, 'pointerdown');
    assert.equal(pressed.defaultPrevented, false);
    assert.equal(pressed.immediateStopped, false);
    assert.deepEqual(calls.outgoing, ['By the send button']);
    assert.deepEqual(page.sentTexts, [appendLine('By the send button')]);
    assert.deepEqual(page.prevented, [false]);
    page.window.advance(100);
    assert.equal(calls.sent, 1);
    assert.equal(keydowns(page.box), 0);

    type(page, 'By the icon');
    const iconPress = page.window.dispatch(page.icon, 'pointerdown');
    assert.equal(iconPress.defaultPrevented || iconPress.immediateStopped, false);
    assert.deepEqual(page.sentTexts, [appendLine('By the send button'), appendLine('By the icon')]);
    page.window.advance(100);
    assert.equal(calls.sent, 2);

    const inside = page.panel.append(new FakeNode('button', { type: 'button', bottom: 870, label: 'Send' }));
    inside.append(new FakeNode('svg'));
    const ghost = page.document.add(new FakeNode('button', { type: 'button', bottom: 870, label: 'Send' }));
    type(page, 'Not a send either');
    page.window.dispatch(inside, 'pointerdown');
    page.window.dispatch(inside, 'pointerdown', { path: [] });
    page.window.dispatch(ghost, 'pointerdown', { path: [ghost, page.panel, page.window] });
    page.window.advance(5000);
    assert.equal(calls.outgoing.length, 2);
    assert.equal(page.box.value, 'Not a send either');

    const high = page.document.add(new FakeNode('button', { type: 'button', bottom: 10, label: 'Send' }));
    page.window.dispatch(high, 'pointerdown');
    assert.deepEqual(calls.outgoing.at(-1), 'Not a send either');
    assert.equal(page.box.value, appendLine('Not a send either'));
});

test("the message box is the page's, never the panel's", () => {
    const window = new FakeSendWindow();
    const document = new FakeSendDocument(window);
    const panel = document.add(new FakeNode('div', { id: 'scribe-panel' }));
    const panelBox = panel.append(new FakeTextArea({ name: 'message' }));
    const panelNotes = panel.append(new FakeTextArea({}));
    const plain = document.add(new FakeTextArea({}));
    const asked = [];
    ScribeSender.attach({
        document,
        window,
        ignore: panel,
        outgoing: (text) => {
            asked.push(text);
            return appendLine(text);
        },
        sent: () => {},
    });
    /**
     * @param {FakeTextArea} field
     * @param {string} text
     * @return {FakeEvent}
     */
    const enter = (field, text) => {
        NATIVE.set.call(field, text);
        field.forget();
        document.focus(field);
        return window.dispatch(field, 'keydown', ENTER);
    };
    for (const field of [plain, panelBox, panelNotes]) {
        const event = enter(field, 'Panel words');
        assert.equal(event.defaultPrevented || event.immediateStopped, false);
        assert.equal(field.value, 'Panel words');
        assert.deepEqual(field.trail, []);
    }
    assert.deepEqual(asked, []);

    window.advance(5000);
    const named = document.add(new FakeTextArea({ name: 'message' }));
    enter(plain, 'Second');
    assert.equal(plain.value, 'Second');
    enter(panelBox, 'Panel again');
    assert.equal(panelBox.value, 'Panel again');
    assert.deepEqual(asked, []);
    enter(named, 'Third');
    assert.deepEqual(asked, ['Third']);
    assert.equal(named.value, appendLine('Third'));
    window.advance(5000);
    NATIVE.set.call(named, 'Fourth');
    document.focus(panelBox);
    const elsewhere = window.dispatch(named, 'keydown', ENTER);
    assert.equal(elsewhere.defaultPrevented, false);
    assert.deepEqual(asked, ['Third']);
    assert.equal(named.value, 'Fourth');
});

test('a send that did not happen is undone', () => {
    const page = makePage();
    page.refusing = true;
    const { calls } = wire(page, appendLine);
    type(page, 'Hello');
    pressEnter(page);
    const expected = appendLine('Hello');
    assert.equal(page.box.value, expected);
    page.window.advance(25);
    assert.equal(keydowns(page.box), 1);
    assert.deepEqual(page.sentTexts, []);
    page.window.advance(1499);
    assert.equal(page.box.value, expected);
    assert.equal(calls.sent, 0);
    page.window.advance(1);
    assert.equal(page.box.value, 'Hello');
    assert.equal(page.state, 'Hello');
    assert.deepEqual(page.box.trackerCalls, ['Hello', expected]);
    assert.deepEqual(page.box.writes, [`native:${expected}`, 'native:Hello']);
    assert.equal(calls.sent, 0);
    page.window.advance(5000);
    assert.equal(calls.sent, 0);
    assert.equal(page.window.timerCount, 0);

    page.refusing = false;
    pressEnter(page);
    page.window.advance(25);
    assert.deepEqual(page.sentTexts, [expected]);
    page.window.advance(100);
    assert.equal(calls.sent, 1);
    assert.deepEqual(calls.outgoing, ['Hello', 'Hello']);
});

test('nothing is appended twice', () => {
    const page = makePage();
    page.refusing = true;
    const growing = (text) => (text.length > 8 ? `${text}\n@: B` : `${text}\n@: A`);
    const first = wire(page, growing);
    type(page, 'Hello');
    pressEnter(page);
    page.window.advance(10);
    const during = pressEnter(page);
    assert.equal(during.defaultPrevented, true);
    page.window.advance(15);
    assert.equal(keydowns(page.box), 1);
    page.window.advance(1000);
    const after = pressEnter(page);
    assert.equal(after.defaultPrevented, false);
    page.window.dispatch(page.icon, 'pointerdown');
    assert.deepEqual(first.calls.outgoing, ['Hello']);
    assert.equal(page.box.value, 'Hello\n@: A');
    assert.deepEqual(page.box.writes, ['native:Hello\n@: A']);
    page.window.advance(1000);
    assert.equal(page.box.value, 'Hello\n@: A');
    assert.equal(keydowns(page.box), 1);
    page.refusing = false;
    pressEnter(page);
    assert.deepEqual(page.sentTexts, ['Hello\n@: A']);
    page.window.advance(100);
    assert.equal(first.calls.sent, 1);
    first.handle.detach();

    const second = wire(page, (text) => `${text}\n@: A`);
    type(page, 'Hello\n@: A');
    const repeated = pressEnter(page);
    assert.equal(repeated.defaultPrevented, false);
    assert.deepEqual(second.calls.outgoing, ['Hello\n@: A']);
    assert.deepEqual(page.box.writes, ['instance:', 'native:']);
    assert.deepEqual(page.sentTexts, ['Hello\n@: A', 'Hello\n@: A']);
    page.window.advance(100);
    assert.equal(second.calls.sent, 1);
    assert.equal(keydowns(page.box), 0);
});

test('the sender never breaks the page', () => {
    const throwing = makePage();
    const broken = wire(throwing, () => {
        throw new Error('outgoing failed');
    });
    type(throwing, 'Hello');
    const event = pressEnter(throwing);
    throwing.window.dispatch(throwing.icon, 'pointerdown');
    assert.equal(event.defaultPrevented || event.immediateStopped, false);
    assert.deepEqual(throwing.sentTexts, ['Hello']);
    assert.deepEqual(throwing.prevented, [false]);
    assert.deepEqual(throwing.box.writes, ['instance:', 'native:']);
    throwing.window.advance(5000);
    assert.equal(broken.calls.sent, 0);
    assert.equal(broken.calls.outgoing.length, 1);
    assert.equal(keydowns(throwing.box), 0);

    const failingSent = makePage();
    const loud = wire(failingSent, appendLine, () => {
        throw new Error('sent failed');
    });
    type(failingSent, 'Hello');
    pressEnter(failingSent);
    failingSent.window.advance(5000);
    assert.equal(loud.calls.sent, 1);
    assert.deepEqual(failingSent.sentTexts, [appendLine('Hello')]);
    assert.equal(failingSent.window.timerCount, 0);

    const vanished = makePage();
    const lost = wire(vanished, appendLine);
    type(vanished, 'Hello');
    vanished.document.remove(vanished.box);
    const gone = pressEnter(vanished);
    vanished.window.dispatch(vanished.icon, 'pointerdown');
    vanished.window.dispatch({ listeners: [], parent: null }, 'pointerdown');
    assert.equal(gone.defaultPrevented, false);
    assert.deepEqual(lost.calls.outgoing, []);
    assert.deepEqual(vanished.sentTexts, ['Hello']);
    assert.deepEqual(vanished.box.writes, ['instance:', 'native:']);

    const going = makePage();
    going.refusing = true;
    const waiting = wire(going, appendLine);
    type(going, 'Hello');
    pressEnter(going);
    going.window.advance(25);
    going.document.remove(going.box);
    going.window.advance(5000);
    assert.equal(waiting.calls.sent, 0);
    assert.equal(going.box.value, appendLine('Hello'));
    assert.equal(going.window.timerCount, 0);
});

test('detach gives the box back', () => {
    const page = makePage();
    const { calls, handle } = wire(page, appendLine);
    assert.equal(page.window.listenerCount, 8);
    type(page, 'Goodbye');
    pressEnter(page);
    page.window.advance(10);
    assert.equal(page.window.timerCount, 1);
    assert.equal(page.box.value, appendLine('Goodbye'));
    handle.detach();
    assert.equal(page.window.listenerCount, 0);
    assert.equal(page.window.timerCount, 0);
    assert.equal(page.box.value, 'Goodbye');
    assert.equal(page.state, 'Goodbye');
    page.window.advance(5000);
    assert.equal(keydowns(page.box), 0);
    assert.deepEqual(page.keys, []);
    assert.equal(page.box.value, 'Goodbye');
    assert.equal(calls.sent, 0);
    type(page, 'After');
    pressEnter(page);
    page.window.dispatch(page.icon, 'pointerdown');
    page.window.advance(5000);
    assert.deepEqual(calls.outgoing, ['Goodbye']);
    assert.equal(calls.sent, 0);
    assert.deepEqual(page.sentTexts, ['After']);

    const refused = makePage();
    refused.refusing = true;
    const waiting = wire(refused, appendLine);
    type(refused, 'Wait');
    pressEnter(refused);
    refused.window.advance(300);
    assert.equal(refused.box.value, appendLine('Wait'));
    waiting.handle.detach();
    assert.equal(refused.box.value, 'Wait');
    assert.equal(refused.window.timerCount, 0);
    refused.window.advance(5000);
    assert.equal(waiting.calls.sent, 0);
    assert.equal(refused.box.value, 'Wait');

    const gone = makePage();
    const finished = wire(gone, appendLine);
    type(gone, 'Done');
    pressEnter(gone);
    gone.window.advance(25);
    assert.equal(gone.box.value, '');
    gone.box.forget();
    finished.handle.detach();
    assert.deepEqual(gone.box.trail, []);
    assert.equal(gone.window.timerCount, 0);
});

test('typing is not sending', () => {
    const page = makePage();
    const { calls } = wire(page, appendLine);
    type(page, 'Hello');
    page.refusing = true;
    page.window.dispatch(page.icon, 'pointerdown');
    page.refusing = false;
    assert.equal(page.box.value, appendLine('Hello'));
    assert.deepEqual(page.sentTexts, []);
    page.window.advance(400);
    keyOn(page, ' ');
    assert.equal(page.box.value, 'Hello');
    edit(page, `${page.box.value} :)`);
    page.window.advance(1099);
    assert.equal(calls.sent, 0);
    assert.equal(page.box.value, 'Hello :)');
    assert.equal(page.state, 'Hello :)');
    page.window.advance(5000);
    assert.equal(calls.sent, 0);
    assert.equal(page.box.value.includes(LINE), false);
    pressEnter(page);
    page.window.advance(25);
    assert.deepEqual(page.sentTexts, [appendLine('Hello :)')]);
    assert.equal(page.sentTexts[0].split(LINE).length, 2);
    page.window.advance(100);
    assert.equal(calls.sent, 1);
});

test('a refused send takes the lines back', () => {
    const page = makePage();
    page.refusing = true;
    const { calls } = wire(page, appendLine);
    type(page, 'I open the door');
    pressEnter(page);
    page.window.advance(25);
    assert.deepEqual(page.sentTexts, []);
    assert.equal(page.box.value, appendLine('I open the door'));
    page.window.advance(600);
    keyOn(page, ' ');
    edit(page, `${page.box.value} slowly`);
    page.window.advance(5000);
    assert.equal(calls.sent, 0);
    assert.equal(page.box.value, 'I open the door slowly');
    assert.equal(page.state, 'I open the door slowly');
    assert.equal(page.window.timerCount, 0);

    const changed = makePage();
    changed.refusing = true;
    const unseen = wire(changed, appendLine);
    type(changed, 'I open the door');
    pressEnter(changed);
    changed.window.advance(600);
    NATIVE.set.call(changed.box, `Now ${changed.box.value} slowly`);
    changed.window.advance(924);
    assert.equal(changed.box.value, `Now ${appendLine('I open the door')} slowly`);
    changed.window.advance(1);
    assert.equal(changed.box.value, 'Now I open the door slowly');
    changed.window.advance(5000);
    assert.equal(unseen.calls.sent, 0);
});

test('a send is a send when the lines are gone', () => {
    const emptied = makePage();
    emptied.clearAfter = 200;
    const first = wire(emptied, appendLine);
    type(emptied, 'Hello');
    pressEnter(emptied);
    emptied.window.advance(200);
    assert.equal(first.calls.sent, 0);
    emptied.window.advance(100);
    assert.equal(first.calls.sent, 1);
    emptied.window.advance(5000);
    assert.equal(first.calls.sent, 1);

    const replaced = makePage();
    replaced.refusing = true;
    const second = wire(replaced, appendLine);
    type(replaced, 'Hello');
    pressEnter(replaced);
    replaced.window.advance(300);
    NATIVE.set.call(replaced.box, 'A fresh draft');
    replaced.window.advance(100);
    assert.equal(second.calls.sent, 1);
    replaced.window.advance(5000);
    assert.equal(second.calls.sent, 1);
    assert.equal(replaced.box.value, 'A fresh draft');

    const kept = makePage();
    kept.clearAfter = 2000;
    const third = wire(kept, appendLine);
    type(kept, 'Hello');
    pressEnter(kept);
    kept.window.advance(25);
    assert.deepEqual(kept.sentTexts, [appendLine('Hello')]);
    kept.window.advance(1499);
    assert.equal(kept.box.value, appendLine('Hello'));
    kept.window.advance(1);
    assert.equal(kept.box.value, 'Hello');
    assert.equal(third.calls.sent, 0);
    kept.window.advance(5000);
    assert.equal(third.calls.sent, 0);
});

test('lines in the box are not appended twice', () => {
    const part = { ready: LINE, asked: [], sent: 0 };
    const page = makePage();
    const { calls } = wire(
        page,
        (text) => {
            part.asked.push(text);
            return part.ready === null ? text : text + part.ready;
        },
        () => {
            part.sent++;
            part.ready = null;
        },
    );
    type(page, 'One');
    pressEnter(page);
    page.window.advance(25);
    assert.deepEqual(page.sentTexts, [`One${LINE}`]);
    page.window.advance(25);
    keyOn(page, 'T');
    assert.equal(part.sent, 1);
    type(page, 'Two');
    pressEnter(page);
    assert.equal(part.sent, 1);
    assert.deepEqual(page.sentTexts, [`One${LINE}`, 'Two']);
    page.window.advance(100);
    assert.equal(calls.sent, 2);
    page.window.advance(5000);
    assert.equal(calls.sent, 2);

    const draft = { ready: LINE, sent: 0 };
    const restored = makePage();
    wire(
        restored,
        (text) => (draft.ready === null ? text : text + draft.ready),
        () => {
            draft.sent++;
            draft.ready = null;
        },
    );
    type(restored, 'One');
    pressEnter(restored);
    restored.window.advance(50);
    NATIVE.set.call(restored.box, 'Two');
    restored.state = 'Two';
    pressEnter(restored);
    assert.equal(draft.sent, 1);
    assert.deepEqual(restored.sentTexts, [`One${LINE}`, 'Two']);

    const held = makePage();
    held.refusing = true;
    const repeat = wire(held, appendLine);
    type(held, 'Hello');
    pressEnter(held);
    held.window.advance(500);
    held.refusing = false;
    const again = pressEnter(held);
    assert.equal(again.defaultPrevented, false);
    assert.deepEqual(held.sentTexts, [appendLine('Hello')]);
    assert.equal(held.sentTexts[0].split(LINE).length, 2);
    assert.deepEqual(repeat.calls.outgoing, ['Hello']);
    held.window.advance(100);
    assert.equal(repeat.calls.sent, 1);

    const late = makePage();
    late.refusing = true;
    const onward = wire(late, appendLine);
    type(late, 'Hello');
    pressEnter(late);
    late.window.advance(1400);
    assert.equal(late.box.value, appendLine('Hello'));
    late.refusing = false;
    late.clearAfter = 600;
    const onwardKey = pressEnter(late);
    assert.equal(onwardKey.defaultPrevented, false);
    assert.equal(onward.calls.sent, 0);
    assert.deepEqual(onward.calls.outgoing, ['Hello']);
    assert.deepEqual(late.sentTexts, [appendLine('Hello')]);
    late.window.advance(599);
    assert.equal(late.box.value, appendLine('Hello'));
    assert.equal(onward.calls.sent, 0);
    late.window.advance(101);
    assert.equal(onward.calls.sent, 1);
    late.window.advance(5000);
    assert.equal(onward.calls.sent, 1);
});

test('a modified enter is left alone', () => {
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) {
        const page = makePage();
        const { calls } = wire(page, appendLine);
        type(page, 'A new line please');
        const event = pressEnter(page, { [modifier]: true });
        assert.equal(event.defaultPrevented, false, modifier);
        assert.equal(event.immediateStopped, false, modifier);
        page.window.advance(5000);
        assert.deepEqual(calls.outgoing, [], modifier);
        assert.equal(
            page.box.trail.some((entry) => entry.startsWith('event:')),
            false,
            modifier,
        );
        assert.deepEqual(page.sentTexts, ['A new line please'], modifier);
        assert.deepEqual(page.prevented, [false], modifier);
        assert.equal(page.keys.length, 1, modifier);
        assert.equal(keydowns(page.box), 0, modifier);
        assert.equal(calls.sent, 0, modifier);
    }
});

test("the player's words are never changed", () => {
    const page = makePage();
    const { calls } = wire(page, () => `${LINE.trim()} Hello`);
    type(page, 'Hello');
    const event = pressEnter(page);
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.immediateStopped, false);
    assert.deepEqual(calls.outgoing, ['Hello']);
    assert.deepEqual(page.sentTexts, ['Hello']);
    page.window.advance(5000);
    assert.equal(keydowns(page.box), 0);
    assert.deepEqual(page.box.trail, ['instance:', 'native:']);
    assert.equal(calls.sent, 1);
});

test('a backspace takes the lines out whole', () => {
    const page = makePage();
    page.refusing = true;
    const { part, calls } = liveOf(page);
    type(page, 'I open the door');
    pressEnter(page);
    page.window.advance(425);
    assert.equal(page.box.value, appendLine('I open the door'));
    page.box.forget();
    const key = keyOn(page, 'Backspace');
    assert.equal(key.defaultPrevented, false);
    assert.equal(key.immediateStopped, false);
    assert.equal(page.box.value, 'I open the door');
    assert.equal(page.state, 'I open the door');
    assert.deepEqual([page.box.selectionStart, page.box.selectionEnd], [15, 15]);
    assert.deepEqual(page.box.trail, [
        `tracker:${appendLine('I open the door')}`,
        'native:I open the door',
        'event:input:true:insertText',
        'event:change:true:',
        'select:15:15',
    ]);
    edit(page, page.box.value.slice(0, -1));
    page.window.advance(5000);
    assert.equal(calls.sent, 0);
    assert.equal(page.box.value, 'I open the doo');
    assert.equal(part.ready, LINE);
    page.refusing = false;
    pressEnter(page);
    page.window.advance(25);
    assert.deepEqual(page.sentTexts, [appendLine('I open the doo')]);
    assert.deepEqual(calls.outgoing, ['I open the door', 'I open the doo']);
    page.window.advance(100);
    assert.equal(calls.sent, 1);
});

test('select all and delete loses nothing', () => {
    const page = makePage();
    page.refusing = true;
    const { part, calls } = liveOf(page);
    type(page, 'I open the door');
    pressEnter(page);
    page.window.advance(425);
    keyOn(page, 'Control', { ctrlKey: true });
    assert.equal(page.box.value, appendLine('I open the door'));
    keyOn(page, 'a', { ctrlKey: true });
    assert.equal(page.box.value, 'I open the door');
    keyOn(page, 'Delete');
    edit(page, '');
    page.window.advance(5000);
    assert.equal(calls.sent, 0);
    assert.equal(part.ready, LINE);
    assert.equal(page.box.value, '');
    page.refusing = false;
    type(page, 'I listen.');
    pressEnter(page);
    page.window.advance(25);
    assert.deepEqual(page.sentTexts, [appendLine('I listen.')]);
    page.window.advance(100);
    assert.equal(calls.sent, 1);
    assert.equal(part.ready, null);
});

test('typing on, then enter, sends the player\'s words first', () => {
    const page = makePage();
    page.refusing = true;
    const { calls } = liveOf(page);
    type(page, 'I open the door');
    pressEnter(page);
    page.window.advance(625);
    keyOn(page, ' ');
    edit(page, `${page.box.value} slowly`);
    page.refusing = false;
    page.window.advance(200);
    pressEnter(page);
    page.window.advance(25);
    assert.deepEqual(page.sentTexts, [appendLine('I open the door slowly')]);
    assert.ok(page.sentTexts[0].endsWith(LINE));
    assert.equal(page.sentTexts[0].split(LINE).length, 2);
    assert.deepEqual(calls.outgoing, ['I open the door', 'I open the door slowly']);
    page.window.advance(100);
    assert.equal(calls.sent, 1);

    const pressed = makePage();
    const smiling = liveOf(pressed);
    type(pressed, 'Hello');
    pressed.refusing = true;
    pressed.window.dispatch(pressed.icon, 'pointerdown');
    pressed.refusing = false;
    assert.equal(pressed.box.value, appendLine('Hello'));
    pressed.window.advance(700);
    keyOn(pressed, ':');
    edit(pressed, `${pressed.box.value} :)`);
    pressed.window.advance(100);
    pressEnter(pressed);
    pressed.window.advance(25);
    assert.deepEqual(pressed.sentTexts, [appendLine('Hello :)')]);
    pressed.window.advance(100);
    assert.equal(smiling.calls.sent, 1);
});

test('every way of editing takes the lines out', () => {
    /**
     * @return {{ page: object, calls: { outgoing: string[], sent: number } }}
     */
    const standing = () => {
        const page = makePage();
        page.refusing = true;
        const { calls } = liveOf(page);
        type(page, 'Hello');
        pressEnter(page);
        page.window.advance(25);
        assert.equal(page.box.value, appendLine('Hello'));
        return { page, calls };
    };
    for (const [kind, init] of [
        ['keydown', { key: 'x' }],
        ['keydown', { key: 'Delete' }],
        ['keydown', { key: 'ArrowLeft' }],
        ['keydown', { key: 'Enter', shiftKey: true }],
        ['beforeinput', { inputType: 'insertText', data: 'x' }],
        ['paste', {}],
        ['cut', {}],
        ['drop', {}],
        ['compositionstart', {}],
    ]) {
        const { page, calls } = standing();
        const named = `${kind} ${JSON.stringify(init)}`;
        const event = page.window.dispatch(page.box, kind, init);
        assert.equal(page.box.value, 'Hello', named);
        assert.equal(event.defaultPrevented, false, named);
        page.window.advance(5000);
        assert.equal(calls.sent, 0, named);
        assert.equal(page.box.value, 'Hello', named);
    }
    for (const key of ['Shift', 'Control', 'Alt', 'Meta']) {
        const { page } = standing();
        keyOn(page, key, { shiftKey: key === 'Shift', ctrlKey: key === 'Control', altKey: key === 'Alt', metaKey: key === 'Meta' });
        assert.equal(page.box.value, appendLine('Hello'), key);
    }

    const { page, calls } = standing();
    const other = page.document.add(new FakeTextArea({ name: 'note' }));
    page.window.dispatch(other, 'keydown', { key: 'x' });
    page.window.dispatch(other, 'paste', {});
    page.window.dispatch(page.panel, 'beforeinput', { inputType: 'insertText', data: 'x' });
    assert.equal(page.box.value, appendLine('Hello'));
    pressEnter(page);
    assert.equal(page.box.value, appendLine('Hello'));
    page.refusing = false;
    pressEnter(page);
    assert.deepEqual(page.sentTexts, [appendLine('Hello')]);
    page.window.advance(100);
    assert.equal(calls.sent, 1);

    const own = makePage();
    const mine = liveOf(own);
    type(own, 'Hello');
    pressEnter(own);
    assert.equal(own.box.value, appendLine('Hello'));
    own.window.advance(25);
    assert.deepEqual(own.sentTexts, [appendLine('Hello')]);
    own.window.advance(100);
    assert.equal(mine.calls.sent, 1);
});

test('a deletion with nothing appended is not a send', () => {
    const page = makePage();
    page.refusing = true;
    const { calls } = wire(page, (text) => text);
    type(page, 'Hello there');
    pressEnter(page);
    page.window.advance(300);
    keyOn(page, 'Backspace');
    edit(page, 'Hello ther');
    page.window.advance(5000);
    assert.equal(calls.sent, 0);
    assert.deepEqual(page.sentTexts, []);
    page.refusing = false;
    pressEnter(page);
    assert.deepEqual(page.sentTexts, ['Hello ther']);
    page.window.advance(100);
    assert.equal(calls.sent, 1);
});

test('a clean send is still a send', () => {
    const page = makePage();
    page.clearAfter = 200;
    const { part, calls } = liveOf(page);
    type(page, 'Hello');
    pressEnter(page);
    page.window.advance(25);
    assert.deepEqual(page.sentTexts, [appendLine('Hello')]);
    page.window.advance(199);
    assert.equal(page.box.value, appendLine('Hello'));
    assert.equal(calls.sent, 0);
    page.window.advance(101);
    assert.equal(page.box.value, '');
    assert.equal(calls.sent, 1);
    assert.equal(part.ready, null);
    page.window.advance(5000);
    assert.equal(calls.sent, 1);

    const quick = makePage();
    quick.clearAfter = 50;
    const next = liveOf(quick);
    type(quick, 'Hello');
    pressEnter(quick);
    quick.window.advance(80);
    assert.deepEqual(quick.sentTexts, [appendLine('Hello')]);
    assert.equal(quick.box.value, '');
    assert.equal(next.calls.sent, 0);
    keyOn(quick, 'W');
    assert.equal(next.calls.sent, 1);
    assert.equal(next.part.ready, null);
    edit(quick, 'W');
    quick.window.advance(5000);
    assert.equal(next.calls.sent, 1);
    assert.equal(quick.box.value, 'W');
});

test('a late sign is still a sign', () => {
    /**
     * @return {{ page: object, part: { ready: string|null }, calls: { outgoing: string[], sent: number } }}
     */
    const refused = () => {
        const page = makePage();
        page.refusing = true;
        const { part, calls } = liveOf(page);
        type(page, 'I open the door');
        pressEnter(page);
        page.window.advance(425);
        assert.equal(page.box.value, appendLine('I open the door'));
        return { page, part, calls };
    };

    const cut = refused();
    edit(cut.page, cut.page.box.value.slice(0, -1));
    assert.equal(cut.page.box.value, 'I open the door');
    assert.equal(cut.page.state, 'I open the door');
    cut.page.window.advance(5000);
    assert.equal(cut.calls.sent, 0);
    assert.equal(cut.page.box.value, 'I open the door');
    cut.page.refusing = false;
    pressEnter(cut.page);
    cut.page.window.advance(25);
    assert.deepEqual(cut.page.sentTexts, [appendLine('I open the door')]);
    assert.equal(cut.page.sentTexts[0].split(LINE).length, 2);
    cut.page.window.advance(100);
    assert.equal(cut.calls.sent, 1);

    const emptied = refused();
    edit(emptied.page, '');
    emptied.page.window.advance(5000);
    assert.equal(emptied.calls.sent, 0);
    assert.equal(emptied.part.ready, LINE);
    assert.equal(emptied.page.box.value, '');

    const slowly = refused();
    slowly.page.window.advance(200);
    edit(slowly.page, `${slowly.page.box.value} slowly`);
    assert.equal(slowly.page.box.value, 'I open the door slowly');
    slowly.page.refusing = false;
    slowly.page.window.advance(200);
    pressEnter(slowly.page);
    slowly.page.window.advance(25);
    assert.deepEqual(slowly.page.sentTexts, [appendLine('I open the door slowly')]);
    assert.deepEqual(slowly.calls.outgoing, ['I open the door', 'I open the door slowly']);
    slowly.page.window.advance(100);
    assert.equal(slowly.calls.sent, 1);

    const pressed = makePage();
    const smiling = liveOf(pressed);
    type(pressed, 'Hello');
    pressed.refusing = true;
    pressed.window.dispatch(pressed.icon, 'pointerdown');
    pressed.refusing = false;
    pressed.window.advance(700);
    edit(pressed, `${pressed.box.value} :)`);
    assert.equal(pressed.box.value, 'Hello :)');
    pressed.window.advance(100);
    pressEnter(pressed);
    pressed.window.advance(25);
    assert.deepEqual(pressed.sentTexts, [appendLine('Hello :)')]);
    pressed.window.advance(100);
    assert.equal(smiling.calls.sent, 1);

    const plainPage = makePage();
    plainPage.refusing = true;
    const bare = wire(plainPage, (text) => text);
    type(plainPage, 'Hello there');
    pressEnter(plainPage);
    plainPage.window.advance(300);
    edit(plainPage, 'Hello ther');
    plainPage.window.advance(5000);
    assert.equal(bare.calls.sent, 0);

    const front = refused();
    edit(front.page, `U${front.page.box.value.slice(1, -1)}`);
    front.page.window.advance(5000);
    assert.equal(front.calls.sent, 0);
    assert.equal(front.page.box.value, `U${appendLine('I open the door').slice(1, -1)}`);

    const elsewhere = refused();
    const note = elsewhere.page.document.add(new FakeTextArea({ name: 'note' }));
    elsewhere.page.window.dispatch(note, 'input', {});
    elsewhere.page.window.dispatch(elsewhere.page.panel, 'input', {});
    assert.equal(elsewhere.page.box.value, appendLine('I open the door'));
    elsewhere.page.refusing = false;
    pressEnter(elsewhere.page);
    assert.deepEqual(elsewhere.page.sentTexts, [appendLine('I open the door')]);
    elsewhere.page.window.advance(100);
    assert.equal(elsewhere.calls.sent, 1);
});

test('text typed before and after loses the lines whole', () => {
    /**
     * @param {string} text
     * @return {{ page: object, calls: { outgoing: string[], sent: number } }}
     */
    const refused = (text) => {
        const page = makePage();
        page.refusing = true;
        const { calls } = liveOf(page);
        type(page, text);
        pressEnter(page);
        page.window.advance(325);
        assert.equal(page.box.value, appendLine(text));
        return { page, calls };
    };

    const around = refused('Hello');
    edit(around.page, `Well, ${around.page.box.value} there`);
    assert.equal(around.page.box.value, 'Well, Hello there');
    assert.equal(around.page.state, 'Well, Hello there');
    around.page.window.advance(5000);
    assert.equal(around.calls.sent, 0);
    assert.equal(around.page.box.value, 'Well, Hello there');
    around.page.refusing = false;
    pressEnter(around.page);
    around.page.window.advance(25);
    assert.deepEqual(around.page.sentTexts, [appendLine('Well, Hello there')]);

    const copied = refused('Hello');
    edit(copied.page, `${copied.page.box.value} and I say${LINE}`);
    assert.equal(copied.page.box.value, `Hello and I say${LINE}`);
    assert.equal(copied.calls.sent, 0);

    const cut = refused('I open the door');
    edit(cut.page, cut.page.box.value.slice(0, -1));
    assert.equal(cut.page.box.value, 'I open the door');
    cut.page.window.advance(5000);
    assert.equal(cut.calls.sent, 0);
});

test("the page's own change is still a send", () => {
    const page = makePage();
    page.clearAfter = 200;
    const { part, calls } = liveOf(page);
    type(page, 'Hello');
    pressEnter(page);
    page.window.advance(25);
    assert.deepEqual(page.sentTexts, [appendLine('Hello')]);
    page.box.forget();
    page.window.advance(199);
    assert.equal(calls.sent, 0);
    page.window.advance(101);
    assert.equal(page.box.value, '');
    assert.equal(page.box.trail.some((entry) => entry.startsWith('event:')), false);
    assert.equal(calls.sent, 1);
    assert.equal(part.ready, null);

    const other = makePage();
    other.refusing = true;
    const swapped = liveOf(other);
    type(other, 'Hello');
    pressEnter(other);
    other.window.advance(300);
    NATIVE.set.call(other.box, 'A draft the page restored');
    other.window.advance(100);
    assert.equal(swapped.calls.sent, 1);
    assert.equal(swapped.part.ready, null);
});

test('only the chat box is the chat box', () => {
    const window = new FakeSendWindow();
    const document = new FakeSendDocument(window);
    const notes = document.add(new FakeTextArea({ name: 'notes' }));
    const field = document.add(new FakeTextInput({ name: 'message' }));
    const buttons = ['Send', 'Suggested replies', 'Insert asterisk'].map((label) => {
        const button = document.add(new FakeNode('button', { type: 'submit', bottom: 870, label }));
        const icon = button.append(new FakeNode('svg'));
        return { button, icon };
    });
    const calls = { outgoing: 0, sent: 0 };
    ScribeSender.attach({
        document,
        window,
        ignore: null,
        outgoing: (text) => {
            calls.outgoing++;
            return appendLine(text);
        },
        sent: () => {
            calls.sent++;
        },
    });
    for (const box of [notes, field]) {
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'value').set.call(box, 'My own words');
        box.forget();
        document.focus(box);
        const event = window.dispatch(box, 'keydown', ENTER);
        assert.equal(event.defaultPrevented || event.immediateStopped, false);
        for (const pressed of buttons) {
            window.dispatch(pressed.button, 'pointerdown');
            window.dispatch(pressed.icon, 'pointerdown');
        }
    }
    window.advance(5000);
    assert.deepEqual(calls, { outgoing: 0, sent: 0 });
    for (const box of [notes, field]) {
        assert.equal(box.value, 'My own words');
        assert.deepEqual(box.trail, []);
    }
    assert.equal(window.timerCount, 0);
});

test('compose adds, drops and reports', () => {
    const lines = Object.freeze({ ready: '[Scribe] Day 1, the mill.', suggestion: 'Ask the miller.' });
    const blanks = ['', '   ', String.fromCodePoint(0xa0, 0x200b), String.fromCodePoint(0x200b), ' \n\t'];
    /**
     * @param {Readonly<object>} made
     * @return {object}
     */
    const shown = (made) => ({ text: made.text, ready: made.ready, suggestion: made.suggestion });
    for (const blank of blanks) {
        const made = ScribeSender.compose(blank, lines, 4500);
        assert.equal(Object.isFrozen(made), true);
        assert.deepEqual({ ...made }, { text: blank, ready: false, suggestion: false, carried: null, crowded: false });
    }
    const both = ScribeSender.compose('Hello', lines, 4500);
    const whole = 'Hello\n@: [Scribe] Day 1, the mill.\n@: Ask the miller.';
    assert.equal(Object.isFrozen(both), true);
    assert.deepEqual({ ...both }, { text: whole, ready: true, suggestion: true, carried: lines.ready, crowded: false });
    assert.deepEqual({ ...ScribeSender.compose('Hello', lines, Buffer.byteLength(whole)) }, { ...both });

    const suggested = 'Hello\n@: Ask the miller.';
    const crowded = ScribeSender.compose('Hello', lines, Buffer.byteLength(whole) - 1);
    assert.deepEqual(shown(crowded), { text: suggested, ready: false, suggestion: true });
    assert.deepEqual([crowded.carried, crowded.crowded], [null, true]);
    assert.deepEqual(shown(ScribeSender.compose('Hello', lines, Buffer.byteLength(suggested))), {
        text: suggested,
        ready: false,
        suggestion: true,
    });
    assert.deepEqual(shown(ScribeSender.compose('Hello', lines, Buffer.byteLength(suggested) - 1)), {
        text: 'Hello',
        ready: false,
        suggestion: false,
    });
    const tiny = ScribeSender.compose('Hello', lines, 2);
    assert.deepEqual(shown(tiny), { text: 'Hello', ready: false, suggestion: false });

    assert.deepEqual(shown(ScribeSender.compose('Hello', { ready: lines.ready, suggestion: null }, 4500)), {
        text: 'Hello\n@: [Scribe] Day 1, the mill.',
        ready: true,
        suggestion: false,
    });
    assert.deepEqual(shown(ScribeSender.compose('Hello', { ready: null, suggestion: lines.suggestion }, 4500)), {
        text: suggested,
        ready: false,
        suggestion: true,
    });
    const none = ScribeSender.compose('Hello', { ready: null, suggestion: null }, 4500);
    assert.deepEqual({ ...none }, { text: 'Hello', ready: false, suggestion: false, carried: null, crowded: false });

    const told = '[Scribe] The story so far: Halvard came. He waited. Mirelle: brown eyes.';
    const ends = [40, 51];
    const room = Buffer.byteLength(`Hello\n@: ${told}`) - 1;
    const trimmed = ScribeSender.compose('Hello', { ready: told, suggestion: null, ends }, room);
    assert.deepEqual({ ...trimmed }, {
        text: `Hello\n@: ${told.slice(0, 51)}`,
        ready: true,
        suggestion: false,
        carried: told.slice(0, 51),
        crowded: false,
    });
    const shortest = ScribeSender.compose('Hello', { ready: told, suggestion: 'Ask.', ends }, 'Hello'.length + 50 + 10);
    assert.equal(shortest.carried, told.slice(0, 40));
    assert.equal(shortest.suggestion, true);
    const nothing = ScribeSender.compose('Hello', { ready: told, suggestion: null, ends }, 'Hello'.length + 40);
    assert.deepEqual([nothing.ready, nothing.carried, nothing.crowded], [false, null, true]);
    const odd = ScribeSender.compose('Hello', { ready: told, suggestion: null, ends: [500, -3, 'x'] }, 60);
    assert.equal(odd.ready, false);

    const spaced = `${String.fromCodePoint(0xa0)}Hello`;
    assert.equal(ScribeSender.compose(spaced, lines, 4500).text, `${spaced}\n@: [Scribe] Day 1, the mill.\n@: Ask the miller.`);
    const wide = Object.freeze({ ready: 'Ü'.repeat(10), suggestion: 'ß' });
    const wideWhole = 'Hello\n@: ' + 'Ü'.repeat(10) + '\n@: ß';
    assert.equal(Buffer.byteLength(wideWhole) > wideWhole.length, true);
    assert.deepEqual(shown(ScribeSender.compose('Hello', wide, wideWhole.length)), {
        text: 'Hello\n@: ß',
        ready: false,
        suggestion: true,
    });
});
