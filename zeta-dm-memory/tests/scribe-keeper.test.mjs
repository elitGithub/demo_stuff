import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import FakeChat from './support/FakeChat.mjs';
import FakeStorage from './support/FakeStorage.mjs';

/**
 * @return {Object<string, object>}
 */
function load() {
    const context = vm.createContext({ TextEncoder });
    const loaded = {};
    const files = [
        ['core', 'ScribeText'],
        ['core', 'ScribeCategory'],
        ['core', 'ScribeIntake'],
        ['core', 'ScribeAnswer'],
        ['core', 'ScribeLog'],
        ['core', 'ScribeReplay'],
        ['core', 'ScribeAnalyzer'],
        ['core', 'ScribeAdoption'],
        ['bench', 'BenchView'],
        ['page', 'ScribeStore'],
        ['page', 'ScribeKeeper'],
    ];
    for (const [folder, name] of files) {
        const url = new URL(`../scribe/${folder}/${name}.js`, import.meta.url);
        vm.runInContext(readFileSync(url, 'utf8'), context, { filename: url.pathname });
        loaded[name] = vm.runInContext(name, context);
    }
    return loaded;
}

const { ScribeAnswer, ScribeReplay, ScribeAnalyzer, ScribeStore, ScribeKeeper } = load();

const ROOM = 'harbour';
const OTHER_ROOM = 'quarry';
const START = Date.UTC(2026, 10, 15, 9, 0, 0);
const DAY = '2026-11-15';
const NEXT_DAY = '2026-11-16';
const MOST_CALLS = 60;
const MOST_TURNS = 200;
const BOOK = /^scribe:(?:head|part):[^:]+:book(?::|$)/;
const READING = 'The book is being read; try again when it has finished this stretch';
const PULLING = 'The chat is being pulled; try again when it has finished';
const WATCHING = 'Another tab is reading this chat';
const DAMAGED = 'The saved book of this chat is damaged';
const DISORDER = 'The messages of this chat are not in time order';
const PART = 'The chat was pulled only in part: ';
const AGAIN = '; it will be pulled again.';
const UNREACHED = `${PART}Zeta could not be reached${AGAIN}`;
const NEWEST_ONLY = `${PART}the chat has more pages than one pull may read${AGAIN}`;
const STOPPED_EARLY = `${PART}it stopped early${AGAIN}`;
const FAR = 'The chat could not be pulled far enough to join what is saved: ';
const FAR_AGAIN = '. It is pulled again every minute; the book is kept as it is.';
const FAR_EARLY = `${FAR}it stopped early${FAR_AGAIN}`;
const SAVE_FAILED = 'The save failed';
const SPENT = /^scribe:spent:/;
const UNJOINED = 'The newest messages do not join what is saved yet; the chat is being pulled again.';
const SUSPECT = 'The chat on the site does not match what is saved. It will be checked again in a minute.';
const NOTHING_PULLED = 'Nothing has been pulled from the chat yet';
const UNCONFIRMED = 'The save could not be confirmed; the book was loaded again';
const UNREAD_STORAGE = 'The storage could not be read';
const BAD_ANCHOR = 'The argument is not valid: anchor';
const MINUTE = 60000;
const PROSE = 'I could not tell which lines of this long stretch of the tale matter to the book.';
const MISMATCH =
    'The chat on the site no longer matches what is saved (checked twice). Starting the book over discards the book and your rulings.';
const CAMPAIGN = /^scribe:(?:head|part):[^:]+:campaign(?::|$)/;
const OATH = 'swore an oath to the harbour guild';
const HOUR = 3600000;
const SECONDS_SIX = 6000;
const SETTINGS = /^scribe:(?:head|part):[^:]+:settings(?::|$)/;
const BOOK_PART = /^scribe:part:harbour:book:/;
const BOOK_HEAD = /^scribe:head:harbour:book$/;
const PIN = Object.freeze({ type: 'Pin', subject: 'S1', category: 'age', target: null, text: 'thirty', hidden: false });

const prompts = new Map([
    [ScribeAnalyzer.Prompt, 'Story'],
    [ScribeAnalyzer.NotesPrompt, 'Notes'],
    [ScribeAnalyzer.AnswersPrompt, 'Answers'],
]);

/**
 * @param {*} value
 * @return {*}
 */
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

/**
 * @return {Promise<void>}
 */
function settle() {
    return new Promise((resolve) => setImmediate(resolve));
}

/**
 * @param {Function} condition
 * @return {Promise<void>}
 */
async function until(condition) {
    for (let turn = 0; turn < MOST_TURNS; turn++) {
        if (condition()) {
            return;
        }
        await settle();
    }
    assert.fail('The awaited moment never came');
}

/**
 * @param {Promise<void>} promise
 * @return {Promise<boolean>}
 */
async function returns(promise) {
    let timer = null;
    const late = new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), 2000);
    });
    const finished = await Promise.race([promise.then(() => true), late]);
    clearTimeout(timer);
    return finished;
}

/**
 * @return {{ promise: Promise<void>, release: Function }}
 */
function gate() {
    let release = null;
    const promise = new Promise((resolve) => {
        release = resolve;
    });
    return { promise, release };
}

/**
 * @return {{ time: number, day: string, now: Function, today: Function }}
 */
function clockAt() {
    const clock = { time: START, day: DAY };
    /**
     * @return {number}
     */
    clock.now = () => clock.time;
    /**
     * @return {string}
     */
    clock.today = () => clock.day;
    return clock;
}

/**
 * @param {Object<string, string[]>} blocks
 * @return {string}
 */
function answer(blocks) {
    return Object.entries(blocks)
        .map(([block, lines]) => [`=== ${block}`, ...lines].join('\n'))
        .join('\n');
}

/**
 * @param {string} pass
 * @param {string} user
 * @return {number[]}
 */
function marksOf(pass, user) {
    if (pass === 'Story') {
        const heading = user.match(/NEW MESSAGES \(#(\d+) to #(\d+)\):/);
        return [Number(heading[1]), Number(heading[2])];
    }
    return [...user.matchAll(/^\[#(\d+)\] /gm)].map((match) => Number(match[1]));
}

/**
 * @param {{ pass: string, marks: number[] }} call
 * @param {{ conflict?: boolean, question?: boolean }} options
 * @return {string}
 */
function scripted(call, options) {
    if (call.pass !== 'Story') {
        return answer({
            FACTS: call.marks.map((mark) => `Halvard | trait | settled by the answers at line ${mark} | #${mark}`),
        });
    }
    if (options.blank === true) {
        return '=== FACTS';
    }
    const [first, last] = call.marks;
    const facts = [
        `Halvard | trait | keeps watch from line ${first} | #${first}`,
        `Mirelle | trait | counts coins to line ${last} | #${last}`,
    ];
    const blocks = { SUBJECTS: ['Halvard | character', 'Mirelle | character'], FACTS: facts };
    if (first === 1 && options.conflict === true) {
        facts.push('Halvard | age | twenty-five | #3', 'Halvard | age | thirty | #5');
    }
    if (first === 1 && options.question === true) {
        blocks.QUESTIONS = ['Does Mirelle trust Halvard? | #12'];
    }
    if (options.asks !== undefined && first <= options.asks && options.asks <= last) {
        blocks.QUESTIONS = [`Who rang the harbour bell? | #${options.asks}`];
    }
    return answer(blocks);
}

/**
 * @param {{ cost?: number, broken?: string|null, hold?: Function|null, conflict?: boolean, question?: boolean }} options
 * @return {{ calls: object[], broken: string|null, cost: number, ask: Function }}
 */
function analyst(options = {}) {
    const model = {
        calls: [],
        broken: options.broken ?? null,
        cost: options.cost ?? 0.01,
        unreadable: options.unreadable ?? null,
    };
    /**
     * @param {string} role
     * @param {string} system
     * @param {string} user
     * @return {Promise<{ text: string, cost: number }>}
     */
    model.ask = async (role, system, user) => {
        const pass = prompts.get(system);
        const call = { role, pass, marks: marksOf(pass, user) };
        model.calls.push(call);
        if (model.calls.length > MOST_CALLS) {
            await new Promise(() => {});
        }
        const held = options.hold === undefined || options.hold === null ? null : options.hold(call);
        if (held !== null) {
            await held;
        }
        if (model.broken !== null) {
            throw new Error(model.broken);
        }
        if (model.unreadable !== null && model.unreadable(call)) {
            return { text: PROSE, cost: model.cost };
        }
        return { text: scripted(call, options), cost: model.cost };
    };
    return model;
}

/**
 * @param {{ calls: object[] }} model
 * @return {string[]}
 */
function ranges(model) {
    return model.calls.map((call) => `${call.pass} ${call.marks.join('-')}`);
}

/**
 * @param {FakeChat} chat
 * @param {{ ask: Function }} model
 * @param {{ storage?: FakeStorage, clock?: object, tabId?: string, roomId?: string, claim?: Function, wait?: boolean, onNotify?: Function }} extra
 * @return {Promise<{ keeper: object, events: object[], storage: FakeStorage, clock: object }>}
 */
async function opened(chat, model, extra = {}) {
    const events = [];
    const storage = extra.storage ?? new FakeStorage();
    const clock = extra.clock ?? clockAt();
    const tabId = extra.tabId ?? 'tab-1';
    const holder = { keeper: null, finish: null, ended: false };
    const ended = new Promise((resolve) => {
        holder.finish = resolve;
    });
    /**
     * @return {void}
     */
    const check = () => {
        if (holder.keeper !== null && !holder.ended && holder.keeper.view().phase !== 'Loading') {
            holder.ended = true;
            holder.finish();
        }
    };
    const options = {
        storage,
        roomId: extra.roomId ?? ROOM,
        tabId,
        zeta: chat.zeta(tabId),
        ask: model.ask,
        clock,
        /**
         * @param {object} event
         * @return {void}
         */
        notify: (event) => {
            events.push(event);
            if (extra.onNotify !== undefined) {
                extra.onNotify(event);
            }
            check();
        },
    };
    if (extra.claim !== undefined) {
        options.claim = extra.claim;
    }
    if (extra.profile !== undefined) {
        options.profile = extra.profile;
    }
    const opening = ScribeKeeper.open(options);
    assert.equal(await returns(opening), true, 'open never resolved');
    holder.keeper = await opening;
    check();
    if (extra.wait !== false) {
        assert.equal(await returns(ended), true, 'the first pull never ended');
    }
    return { keeper: holder.keeper, events, storage, clock };
}

/**
 * @param {number} first
 * @param {number} last
 * @return {number[]}
 */
function numbers(first, last) {
    return Array.from({ length: last - first + 1 }, (unused, index) => first + index);
}

/**
 * @param {FakeStorage} storage
 * @return {string[]}
 */
function savedIds(storage) {
    return ScribeStore.read(storage, ROOM, ScribeStore.Kind.Campaign).messages.map((message) => message.id);
}

/**
 * @param {FakeStorage} storage
 * @return {number}
 */
function savedNotes(storage) {
    const book = savedBook(storage);
    if (book === null) {
        return -1;
    }
    return book.log.entries.filter((entry) => entry.origin === 'Notes' && !entry.withdrawn).length;
}

/**
 * @param {string[]} lines
 * @return {object[]}
 */
function told(lines) {
    return ScribeAnswer.parse(answer({ FACTS: lines })).operations;
}

/**
 * @param {object} options
 * @return {Promise<{ chat: FakeChat, model: object, keeper: object, events: object[], storage: FakeStorage, clock: object }>}
 */
async function adopted(options = {}) {
    const chat = options.chat ?? new FakeChat(options.count ?? 100);
    const model = analyst(options);
    const opening = await opened(chat, model, options);
    await opening.keeper.adopt({});
    return { chat, model, ...opening };
}

/**
 * @param {FakeStorage} storage
 * @return {object|null}
 */
function savedBook(storage) {
    return ScribeStore.read(storage, ROOM, ScribeStore.Kind.Book);
}

/**
 * @param {FakeStorage} storage
 * @return {number}
 */
function savedReads(storage) {
    const book = savedBook(storage);
    return book === null ? -1 : Object.keys(book.log.read).length;
}

/**
 * @param {FakeStorage} storage
 * @param {string} id
 * @return {boolean}
 */
function savedRead(storage, id) {
    return Object.hasOwn(savedBook(storage).log.read, id);
}

/**
 * @param {FakeStorage} storage
 * @param {RegExp} pattern
 * @return {string}
 */
function storedText(storage, pattern) {
    const kept = [...storage.values.entries()].filter(([name]) => pattern.test(name)).sort();
    return JSON.stringify(kept);
}

/**
 * @param {FakeStorage} storage
 * @return {number}
 */
function bookSaves(storage) {
    return storage.calls.filter((call) => call.operation === 'set' && BOOK.test(call.name)).length;
}

/**
 * @param {FakeStorage} base
 * @return {object}
 */
function guarded(base) {
    const wrapper = {
        base,
        refusedGets: [],
        refusedSets: [],
        readBacks: [],
        /**
         * @param {RegExp} pattern
         * @param {number} times
         * @return {void}
         */
        refuseSets(pattern, times) {
            wrapper.refusedSets.push({ pattern, times });
        },
        /**
         * @param {RegExp} pattern
         * @param {number} times
         * @return {void}
         */
        refuseGets(pattern, times) {
            wrapper.refusedGets.push({ pattern, times });
        },
        /**
         * @param {RegExp} pattern
         * @return {void}
         */
        refuseReadBack(pattern) {
            wrapper.readBacks.push({ pattern, armed: false, done: false });
        },
        /**
         * @param {string} name
         * @param {*} fallback
         * @return {*}
         * @throws {Error}
         */
        get(name, fallback) {
            for (const rule of wrapper.refusedGets) {
                if (rule.times > 0 && rule.pattern.test(name)) {
                    rule.times--;
                    throw new Error(`The storage refused to get ${name}`);
                }
            }
            for (const rule of wrapper.readBacks) {
                if (rule.armed && rule.pattern.test(name)) {
                    rule.armed = false;
                    rule.done = true;
                    throw new Error(`The storage refused to get ${name}`);
                }
            }
            return base.get(name, fallback);
        },
        /**
         * @param {string} name
         * @param {*} value
         * @return {void}
         */
        set(name, value) {
            for (const rule of wrapper.refusedSets) {
                if (rule.times > 0 && rule.pattern.test(name)) {
                    rule.times--;
                    throw new Error(`The storage refused to set ${name}`);
                }
            }
            base.set(name, value);
            for (const rule of wrapper.readBacks) {
                if (!rule.done && rule.pattern.test(name)) {
                    rule.armed = true;
                }
            }
        },
        /**
         * @param {string} name
         * @return {void}
         */
        remove(name) {
            base.remove(name);
        },
        /**
         * @return {string[]}
         */
        list() {
            return base.list();
        },
    };
    return wrapper;
}

/**
 * @param {FakeStorage} storage
 * @return {number}
 */
function rulingsSaved(storage) {
    return savedBook(storage).log.entries.filter((entry) => entry.kind === 'Operator' && !entry.withdrawn).length;
}

/**
 * @param {FakeStorage} storage
 * @return {number}
 */
function otherSets(storage) {
    return storage.calls.filter((call) => call.operation === 'set' && !call.name.startsWith('scribe:spent:')).length;
}

/**
 * @param {object[]} events
 * @return {object[]}
 */
function replies(events) {
    return events.filter((event) => event.kind === 'Reply');
}

/**
 * @param {object} keeper
 * @param {string} text
 * @return {object[]}
 */
function factsSaying(keeper, text) {
    return keeper.view().state.facts.filter((fact) => fact.text === text);
}

test('a chat with no book says so', async () => {
    const chat = new FakeChat(100);
    const model = analyst();
    const { keeper, storage } = await opened(chat, model);
    const view = keeper.view();
    assert.equal(view.phase, 'NoBook');
    assert.equal(view.reader, true);
    assert.equal(view.roomId, ROOM);
    assert.equal(view.total, 100);
    assert.equal(view.settled, 99);
    assert.equal(view.read, 0);
    assert.equal(view.problem, null);
    assert.equal(view.flight, null);
    assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Campaign).messages.length, 100);
    assert.equal(savedBook(storage), null);
    assert.equal(chat.count('tab-1', 'history'), 1);
    await keeper.tick();
    assert.equal(keeper.view().phase, 'NoBook');
    assert.equal(model.calls.length, 0);
    assert.equal(savedBook(storage), null);
});

test('adopting reads every settled message and saves after each stretch', async () => {
    const chat = new FakeChat(100);
    const storage = new FakeStorage();
    const savedAtCall = [];
    const model = analyst({
        /**
         * @return {null}
         */
        hold: () => {
            savedAtCall.push(savedReads(storage));
            return null;
        },
    });
    const { keeper, events } = await opened(chat, model, { storage });
    await keeper.adopt({ size: 40 });
    assert.deepEqual(ranges(model), ['Story 1-40', 'Story 41-80', 'Story 81-99']);
    assert.deepEqual(
        model.calls.map((call) => call.role),
        ['Analyzer', 'Analyzer', 'Analyzer'],
    );
    assert.deepEqual(savedAtCall, [0, 40, 80]);
    const view = keeper.view();
    assert.equal(view.phase, 'Idle');
    assert.equal(view.read, 99);
    assert.equal(view.stop.reason, 'Done');
    assert.equal(savedReads(storage), 99);
    assert.equal(savedRead(storage, 'MESSAGE-99'), true);
    assert.equal(savedRead(storage, 'MESSAGE-100'), false);
    assert.equal(Object.keys(savedBook(storage).fingerprints).length, 99);
    assert.equal(savedBook(storage).adopted, true);
    assert.deepEqual(plain(view.lines.map((line) => line.first)), [81, 41, 1]);
    assert.equal(view.calls.length, 3);
    assert.equal(events.filter((event) => event.kind === 'Progress').length, 3);
});

test('the newest reply is read only once it is answered', async () => {
    const { chat, model, keeper, storage } = await adopted();
    chat.add(1);
    await keeper.tick();
    assert.equal(model.calls.length, 3);
    assert.equal(keeper.view().read, 99);
    assert.equal(keeper.view().settled, 100);
    for (const batch of [30, 8]) {
        chat.add(batch);
        await keeper.tick();
    }
    assert.equal(model.calls.length, 3);
    assert.equal(keeper.view().settled, 138);
    assert.equal(keeper.view().read, 99);
    chat.add(2);
    await keeper.tick();
    assert.deepEqual(ranges(model).slice(3), ['Story 100-139']);
    const view = keeper.view();
    assert.equal(view.total, 141);
    assert.equal(view.read, 139);
    assert.equal(savedRead(storage, 'MESSAGE-139'), true);
    assert.equal(savedRead(storage, 'MESSAGE-140'), false);
    assert.equal(savedRead(storage, 'MESSAGE-141'), false);
});

test('a reply event is sent for a new or changed newest message', async () => {
    const chat = new FakeChat(100);
    const { keeper, events } = await opened(chat, analyst());
    events.length = 0;
    chat.add(1);
    await keeper.tick();
    assert.deepEqual(plain(replies(events).map((event) => event.message.id)), ['MESSAGE-101']);
    events.length = 0;
    chat.regenerate();
    await keeper.tick();
    assert.deepEqual(plain(replies(events).map((event) => event.message.id)), ['MESSAGE-102']);
    events.length = 0;
    chat.edit(102, 'The tale turns at the ford, line 102.');
    await keeper.tick();
    assert.deepEqual(plain(replies(events).map((event) => event.message.id)), ['MESSAGE-102']);
    assert.equal(replies(events)[0].message.text.includes('turns at the ford'), true);
    events.length = 0;
    await keeper.tick();
    assert.equal(replies(events).length, 0);
    assert.equal(events.length, 2);
});

test('an edited message is read again', async () => {
    const held = gate();
    let rereading = false;
    const { chat, model, keeper, storage } = await adopted({
        count: 45,
        conflict: true,
        /**
         * @param {{ marks: number[] }} call
         * @return {Promise<void>|null}
         */
        hold: (call) => (rereading && call.marks[0] === 1 ? held.promise : null),
    });
    assert.deepEqual(ranges(model), ['Story 1-40', 'Story 41-44']);
    assert.equal(keeper.view().state.conflicts.length, 1);
    await keeper.rule(PIN);
    assert.equal(keeper.view().state.conflicts.length, 0);
    chat.edit(20, 'The tale turns another way, line 20.');
    rereading = true;
    const ticking = keeper.tick();
    await until(() => model.calls.length === 3);
    assert.equal(keeper.view().read, 4);
    assert.equal(savedReads(storage), 4);
    assert.equal(savedRead(storage, 'MESSAGE-1'), false);
    assert.equal(savedRead(storage, 'MESSAGE-40'), false);
    assert.equal(savedRead(storage, 'MESSAGE-41'), true);
    assert.equal(Object.hasOwn(savedBook(storage).fingerprints, 'MESSAGE-20'), false);
    held.release();
    await ticking;
    await keeper.tick();
    assert.deepEqual(ranges(model), ['Story 1-40', 'Story 41-44', 'Story 1-40']);
    assert.equal(keeper.view().read, 44);
    assert.equal(keeper.view().state.conflicts.length, 0);
    const pinned = factsSaying(keeper, 'thirty');
    assert.equal(pinned.length, 1);
    assert.equal(pinned[0].pinned, true);
    assert.equal(pinned[0].status, 'InForce');
});

test('a deleted message is noticed in the newest page', async () => {
    const { chat, model, keeper, storage } = await adopted();
    const saves = bookSaves(storage);
    chat.regenerate();
    await keeper.tick();
    assert.equal(keeper.view().read, 99);
    assert.equal(keeper.view().total, 100);
    assert.equal(bookSaves(storage), saves);
    assert.equal(model.calls.length, 3);
    chat.remove(90);
    await keeper.tick();
    const view = keeper.view();
    assert.equal(view.total, 99);
    assert.equal(view.read, 80);
    assert.equal(savedReads(storage), 80);
    assert.equal(savedRead(storage, 'MESSAGE-80'), true);
    assert.equal(savedRead(storage, 'MESSAGE-81'), false);
    assert.equal(savedRead(storage, 'MESSAGE-90'), false);
    assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Campaign).messages.length, 99);
    assert.equal(model.calls.length, 3);
});

test('messages played elsewhere are read in order', async () => {
    const { chat, model, keeper, storage, clock } = await adopted();
    keeper.close();
    chat.add(60);
    const second = analyst();
    const again = await opened(chat, second, { storage, clock, tabId: 'tab-2' });
    assert.equal(again.keeper.view().total, 160);
    assert.equal(again.keeper.view().read, 99);
    assert.equal(second.calls.length, 0);
    await again.keeper.tick();
    assert.deepEqual([...ranges(model), ...ranges(second)], ['Story 1-40', 'Story 41-80', 'Story 81-99', 'Story 100-139']);
    assert.equal(again.keeper.view().read, 139);
    const ids = [];
    for (const entry of savedBook(storage).log.entries) {
        if (!entry.withdrawn) {
            ids.push(...entry.messageIds);
        }
    }
    assert.equal(ids.length, 139);
    assert.equal(new Set(ids).size, 139);
    await again.keeper.tick();
    assert.equal(second.calls.length, 1);
});

test('closing mid-reading loses nothing saved', async () => {
    const chat = new FakeChat(100);
    const storage = new FakeStorage();
    const held = gate();
    const model = analyst({
        /**
         * @param {{ marks: number[] }} call
         * @return {Promise<void>|null}
         */
        hold: (call) => (call.marks[0] === 41 ? held.promise : null),
    });
    const { keeper, events, clock } = await opened(chat, model, { storage });
    const adopting = keeper.adopt({});
    await until(() => model.calls.length === 2);
    assert.equal(savedReads(storage), 40);
    keeper.close();
    const sets = otherSets(storage);
    const told = events.length;
    held.release();
    await adopting;
    await settle();
    assert.equal(otherSets(storage), sets);
    assert.equal(events.length, told);
    assert.equal(savedReads(storage), 40);
    assert.equal(model.calls.length, 2);
    const second = analyst();
    const again = await opened(chat, second, { storage, clock, tabId: 'tab-2' });
    assert.equal(again.keeper.view().reader, true);
    assert.equal(again.keeper.view().read, 40);
    await again.keeper.tick();
    assert.deepEqual(ranges(second), ['Story 41-80', 'Story 81-99']);
    assert.equal(again.keeper.view().read, 99);
});

test('a pause stops after the stretch in flight and resume goes on', async () => {
    const chat = new FakeChat(100);
    const held = gate();
    const model = analyst({
        /**
         * @param {{ marks: number[] }} call
         * @return {Promise<void>|null}
         */
        hold: (call) => (call.marks[0] === 1 ? held.promise : null),
    });
    const { keeper, storage } = await opened(chat, model);
    const adopting = keeper.adopt({});
    await until(() => model.calls.length === 1);
    keeper.pause();
    held.release();
    await adopting;
    let view = keeper.view();
    assert.equal(view.phase, 'Stopped');
    assert.equal(view.stop.reason, 'Paused');
    assert.equal(view.read, 40);
    assert.equal(savedReads(storage), 40);
    assert.equal(model.calls.length, 1);
    await keeper.tick();
    assert.equal(model.calls.length, 1);
    assert.equal(keeper.view().phase, 'Stopped');
    await keeper.resume();
    assert.deepEqual(ranges(model), ['Story 1-40', 'Story 41-80', 'Story 81-99']);
    view = keeper.view();
    assert.equal(view.phase, 'Idle');
    assert.equal(view.read, 99);
});

test('the daily budget stops reading and a new day lifts it', async () => {
    const chat = new FakeChat(100);
    const storage = new FakeStorage();
    const clock = clockAt();
    const spentAtCall = [];
    const model = analyst({
        cost: 0.04,
        /**
         * @return {null}
         */
        hold: () => {
            spentAtCall.push(Math.round(ScribeStore.spent(storage, ROOM, clock.day) * 100));
            return null;
        },
    });
    const { keeper } = await opened(chat, model, { storage, clock });
    await keeper.adopt({ budget: 0.05 });
    assert.equal(model.calls.length, 2);
    assert.deepEqual(spentAtCall, [0, 4]);
    let view = keeper.view();
    assert.equal(view.phase, 'Stopped');
    assert.equal(view.stop.reason, 'Budget');
    assert.equal(Math.round(view.spentToday * 100), 8);
    assert.equal(Math.round(ScribeStore.spent(storage, ROOM, DAY) * 100), 8);
    await keeper.tick();
    assert.equal(model.calls.length, 2);
    assert.equal(keeper.view().phase, 'Stopped');
    clock.day = NEXT_DAY;
    await keeper.tick();
    assert.deepEqual(ranges(model), ['Story 1-40', 'Story 41-80', 'Story 81-99']);
    view = keeper.view();
    assert.equal(view.phase, 'Idle');
    assert.equal(view.read, 99);
    assert.equal(Math.round(view.spentToday * 100), 4);
});

test('no key stops with words and resumes', async () => {
    const chat = new FakeChat(100);
    const model = analyst({ broken: 'No key' });
    const { keeper } = await opened(chat, model);
    await keeper.adopt({});
    let view = keeper.view();
    assert.equal(view.phase, 'Stopped');
    assert.equal(view.stop.reason, 'Failed');
    assert.equal(view.stop.problem, 'No key');
    assert.equal(view.read, 0);
    await keeper.tick();
    assert.equal(model.calls.length, 1);
    model.broken = null;
    await keeper.resume();
    view = keeper.view();
    assert.equal(view.phase, 'Idle');
    assert.equal(view.read, 99);
    assert.deepEqual(ranges(model), ['Story 1-40', 'Story 1-40', 'Story 41-80', 'Story 81-99']);
});

test('a failed pull says why and tries again', async () => {
    const chat = new FakeChat(100);
    const storage = new FakeStorage();
    const first = await opened(chat, analyst(), { storage });
    first.keeper.close();
    const before = storedText(storage, /:campaign/);
    chat.add(5);
    chat.fail('history', new Error('Zeta answered HTTP 401'));
    const { keeper } = await opened(chat, analyst(), { storage, clock: first.clock, tabId: 'tab-2' });
    let view = keeper.view();
    assert.equal(view.problem, 'Zeta answered HTTP 401');
    assert.equal(view.total, 100);
    assert.equal(storedText(storage, /:campaign/) === before, true);
    await keeper.tick();
    view = keeper.view();
    assert.equal(view.problem, null);
    assert.equal(view.total, 105);
    assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Campaign).messages.length, 105);
});

test('rulings are saved before they are shown', async () => {
    const shown = await adopted({ conflict: true });
    assert.equal(shown.keeper.view().state.conflicts.length, 1);
    await shown.keeper.rule(PIN);
    const saved = savedBook(shown.storage);
    const last = saved.log.entries.at(-1);
    assert.equal(last.kind, 'Operator');
    assert.equal(last.operations[0].type, 'Pin');
    const order = shown.keeper.view().messages.map((message) => message.id);
    assert.equal(ScribeReplay.run(saved.log, order).conflicts.length, 0);
    assert.equal(shown.keeper.view().state.conflicts.length, 0);

    const failing = await adopted({ conflict: true });
    const before = storedText(failing.storage, BOOK);
    failing.storage.refuseSetsMatching(BOOK);
    await assert.rejects(failing.keeper.rule(PIN), { message: UNCONFIRMED });
    assert.equal(failing.keeper.view().state.conflicts.length, 1);
    assert.equal(storedText(failing.storage, BOOK) === before, true);
    failing.storage.allow();
    await assert.rejects(failing.keeper.rule({ ...PIN, category: 'colour' }), { message: 'InvalidOperation' });
    assert.equal(storedText(failing.storage, BOOK) === before, true);
    await failing.keeper.rule(PIN);
    const rulings = savedBook(failing.storage).log.entries.filter((entry) => entry.kind === 'Operator');
    assert.equal(rulings.length, 1);
    assert.equal(failing.keeper.view().state.conflicts.length, 0);

    const chat = new FakeChat(100);
    const held = gate();
    const model = analyst({
        /**
         * @return {Promise<void>}
         */
        hold: () => held.promise,
    });
    const reading = await opened(chat, model);
    const adopting = reading.keeper.adopt({});
    await until(() => model.calls.length === 1);
    await assert.rejects(reading.keeper.rule(PIN), { message: READING });
    await assert.rejects(reading.keeper.keepFirst(), { message: READING });
    await assert.rejects(reading.keeper.revoke(1), { message: READING });
    held.release();
    await adopting;
    assert.equal(reading.keeper.view().read, 99);
});

test('an answered question is filed on the next tick', async () => {
    const { keeper, model } = await adopted({ question: true });
    const asked = keeper.view().state.questions;
    assert.deepEqual(plain(asked.map((question) => [question.id, question.answer, question.dismissed])), [
        ['Q1', null, false],
    ]);
    await keeper.rule({ type: 'Answer', question: 'Q1', text: 'She trusts him with the ledger' });
    assert.equal(model.calls.length, 3);
    await keeper.tick();
    assert.deepEqual(ranges(model).slice(3), ['Answers 12']);
    const questions = keeper.view().state.questions;
    assert.equal(questions[0].dismissed, true);
    assert.equal(factsSaying(keeper, 'settled by the answers at line 12').length, 1);
    await keeper.tick();
    assert.equal(model.calls.length, 4);
});

test('one thing at a time', async () => {
    const chat = new FakeChat(100);
    const held = gate();
    const model = analyst({
        /**
         * @param {{ marks: number[] }} call
         * @return {Promise<void>|null}
         */
        hold: (call) => (call.marks[0] === 1 ? held.promise : null),
    });
    const { keeper } = await opened(chat, model);
    const release = chat.hold('history');
    const pulling = keeper.pull();
    await until(() => chat.count('tab-1', 'history') === 2);
    assert.equal(keeper.view().flight, 'Pulling the chat: 0 messages');
    await keeper.tick();
    assert.equal(chat.count('tab-1', 'history'), 2);
    assert.equal(chat.count('tab-1', 'newest'), 0);
    await assert.rejects(keeper.adopt({}), { message: PULLING });
    await assert.rejects(keeper.pull(), { message: PULLING });
    release();
    await pulling;
    assert.equal(keeper.view().flight, null);

    const adopting = keeper.adopt({});
    await until(() => model.calls.length === 1);
    assert.equal(keeper.view().flight, 'Reading #1 to #40');
    await keeper.tick();
    assert.equal(chat.count('tab-1', 'newest'), 0);
    assert.equal(chat.count('tab-1', 'history'), 2);
    assert.equal(model.calls.length, 1);
    await assert.rejects(keeper.adopt({}), { message: READING });
    await assert.rejects(keeper.pull(), { message: READING });
    await assert.rejects(keeper.configure({ size: 20 }), { message: READING });
    held.release();
    await adopting;
    assert.equal(model.calls.length, 3);

    await keeper.tick();
    await keeper.tick();
    assert.equal(chat.count('tab-1', 'newest'), 2);
    assert.equal(model.calls.length, 3);
});

test('a second tab watches', async () => {
    const chat = new FakeChat(100);
    const storage = new FakeStorage();
    const clock = clockAt();
    const first = await opened(chat, analyst(), { storage, clock });
    await first.keeper.adopt({});
    const watcherModel = analyst();
    const second = await opened(chat, watcherModel, { storage, clock, tabId: 'tab-2' });
    let view = second.keeper.view();
    assert.equal(view.phase, 'Watching');
    assert.equal(view.reader, false);
    assert.equal(view.total, 100);
    assert.equal(view.read, 99);
    await assert.rejects(second.keeper.adopt({}), { message: WATCHING });
    await assert.rejects(second.keeper.resume(), { message: WATCHING });
    await assert.rejects(second.keeper.rule(PIN), { message: WATCHING });
    await assert.rejects(second.keeper.configure({ size: 20 }), { message: WATCHING });
    await assert.rejects(second.keeper.pull(), { message: WATCHING });
    chat.add(30);
    await first.keeper.tick();
    chat.add(11);
    await first.keeper.tick();
    assert.equal(first.keeper.view().read, 139);
    await second.keeper.tick();
    view = second.keeper.view();
    assert.equal(view.phase, 'Watching');
    assert.equal(view.read, 139);
    assert.equal(view.total, 141);
    assert.equal(chat.count('tab-2', 'history') + chat.count('tab-2', 'newest'), 0);
    assert.equal(watcherModel.calls.length, 0);
    first.keeper.close();
    await second.keeper.tick();
    view = second.keeper.view();
    assert.equal(view.reader, true);
    assert.equal(view.phase, 'Idle');
    assert.equal(chat.count('tab-2', 'history'), 1);
});

test('a claim lost to another tab stops this one', async () => {
    const chat = new FakeChat(100);
    const storage = new FakeStorage();
    const clock = clockAt();
    const first = await opened(chat, analyst(), { storage, clock });
    await first.keeper.tick();
    assert.equal(first.keeper.view().reader, true);
    clock.time += 120000;
    const second = await opened(chat, analyst(), { storage, clock, tabId: 'tab-2' });
    assert.equal(second.keeper.view().reader, true);
    const looked = chat.count('tab-1', 'newest');
    await first.keeper.tick();
    const view = first.keeper.view();
    assert.equal(view.phase, 'Watching');
    assert.equal(view.reader, false);
    assert.equal(chat.count('tab-1', 'newest'), looked);
    await assert.rejects(first.keeper.adopt({}), { message: WATCHING });
    await second.keeper.tick();
    assert.equal(second.keeper.view().reader, true);
});

test('a damaged book is not overwritten', async () => {
    const { chat, keeper, storage, clock } = await adopted();
    keeper.close();
    storage.values.set(`scribe:head:${ROOM}:book`, 'not json');
    const before = storedText(storage, BOOK);
    const model = analyst();
    const again = await opened(chat, model, { storage, clock, tabId: 'tab-2' });
    let view = again.keeper.view();
    assert.equal(view.phase, 'Stopped');
    assert.equal(view.problem, DAMAGED);
    assert.equal(view.read, 0);
    chat.add(30);
    await again.keeper.tick();
    chat.add(15);
    await again.keeper.tick();
    assert.equal(model.calls.length, 0);
    assert.equal(storedText(storage, BOOK) === before, true);
    assert.equal(again.keeper.view().problem, DAMAGED);
    await assert.rejects(again.keeper.resume(), { message: DAMAGED });
    await assert.rejects(again.keeper.rule(PIN), { message: DAMAGED });
    assert.equal(storedText(storage, BOOK) === before, true);
    await again.keeper.adopt({});
    view = again.keeper.view();
    assert.equal(view.phase, 'Idle');
    assert.equal(view.problem, null);
    assert.equal(view.read, 144);
    assert.equal(savedReads(storage), 144);
});

test('settings are kept per chat', async () => {
    const chat = new FakeChat(10);
    const storage = new FakeStorage();
    const first = await opened(chat, analyst(), { storage });
    assert.equal(first.keeper.view().settings.size, 40);
    assert.equal(first.keeper.view().settings.pedant, 'mistralai/mistral-large-4-0');
    await first.keeper.configure({
        size: 25,
        budget: 1.5,
        analyzer: 'mistralai/mistral-medium-3',
        pedant: 'mistralai/mistral-small-3.2-24b-instruct',
    });
    assert.equal(first.keeper.view().settings.size, 25);
    assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Settings).size, 25);
    first.keeper.close();
    const again = await opened(chat, analyst(), { storage, clock: first.clock, tabId: 'tab-2' });
    const settings = again.keeper.view().settings;
    assert.deepEqual(
        [settings.analyzer, settings.scribe, settings.pedant, settings.size, settings.budget, settings.refresh],
        ['mistralai/mistral-medium-3', 'mistralai/mistral-small-3.2-24b-instruct', 'mistralai/mistral-small-3.2-24b-instruct', 25, 1.5, 6],
    );
    const other = await opened(new FakeChat(10), analyst(), { storage, clock: first.clock, roomId: OTHER_ROOM });
    const defaults = other.keeper.view().settings;
    assert.deepEqual(
        [defaults.analyzer, defaults.scribe, defaults.pedant, defaults.size, defaults.budget, defaults.refresh],
        ['mistralai/mistral-large-4-0', 'mistralai/mistral-small-3.2-24b-instruct', 'mistralai/mistral-large-4-0', 40, 3, 6],
    );
    await assert.rejects(again.keeper.configure({ size: 0 }), { message: 'The settings are not valid: size' });
    await assert.rejects(again.keeper.configure({ budget: -1 }), { message: 'The settings are not valid: budget' });
    assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Settings).size, 25);
});

test('messages out of order are refused', async () => {
    const chat = new FakeChat(100);
    chat.retime(50, FakeChat.time(10));
    const model = analyst();
    const { keeper, storage } = await opened(chat, model);
    let view = keeper.view();
    assert.equal(view.problem, DISORDER);
    assert.equal(view.read, 0);
    assert.equal(await returns(keeper.tick()), true);
    assert.equal(await returns(keeper.pull()), true);
    view = keeper.view();
    assert.equal(view.problem, DISORDER);
    await assert.rejects(keeper.adopt({}), { message: DISORDER });
    assert.equal(model.calls.length, 0);
    assert.equal(savedBook(storage), null);
});

test('nothing loops', async () => {
    const down = await adopted();
    down.chat.failAlways('newest', new Error('Zeta could not be reached'));
    for (let turn = 0; turn < 20; turn++) {
        down.chat.add(2);
        assert.equal(await returns(down.keeper.tick()), true);
    }
    assert.equal(down.chat.count('tab-1', 'newest') <= 20, true);
    assert.equal(down.keeper.view().problem, 'Zeta could not be reached');
    assert.equal(down.model.calls.length, 3);

    const silentChat = new FakeChat(100);
    const silentModel = analyst({ broken: 'The model gave no answer' });
    const silent = { chat: silentChat, model: silentModel, ...(await opened(silentChat, silentModel)) };
    assert.equal(await returns(silent.keeper.adopt({})), true);
    assert.equal(silent.model.calls.length, 1);
    for (let turn = 0; turn < 20; turn++) {
        silent.chat.add(3);
        const before = silent.model.calls.length;
        assert.equal(await returns(silent.keeper.tick()), true);
        assert.equal(silent.model.calls.length - before <= 1, true);
    }
    assert.equal(silent.chat.count('tab-1', 'newest') <= 20, true);
    assert.equal(silent.keeper.view().stop.problem, 'The model gave no answer');

    const full = await adopted();
    full.storage.refuseSetsMatching(/^scribe:(?:head|part):/);
    const fullBefore = full.model.calls.length;
    for (let turn = 0; turn < 20; turn++) {
        full.chat.add(3);
        const before = full.model.calls.length;
        const newestBefore = full.chat.count('tab-1', 'newest');
        const historyBefore = full.chat.count('tab-1', 'history');
        assert.equal(await returns(full.keeper.tick()), true);
        assert.equal(full.model.calls.length - before <= 1, true);
        assert.equal(full.chat.count('tab-1', 'newest') - newestBefore <= 1, true);
        assert.equal(full.chat.count('tab-1', 'history') - historyBefore <= 1, true);
    }
    assert.equal(full.chat.count('tab-1', 'newest') <= 20, true);
    assert.equal(full.model.calls.length, fullBefore);
    assert.equal(full.keeper.view().problem, UNJOINED);

    const unsaved = await adopted();
    unsaved.chat.add(30);
    await unsaved.keeper.tick();
    unsaved.chat.add(11);
    unsaved.storage.refuseSetsMatching(BOOK);
    const unsavedBefore = unsaved.model.calls.length;
    for (let turn = 0; turn < 20; turn++) {
        const before = unsaved.model.calls.length;
        assert.equal(await returns(unsaved.keeper.tick()), true);
        assert.equal(unsaved.model.calls.length - before <= 1, true);
    }
    assert.equal(unsaved.model.calls.length - unsavedBefore, 1);
    assert.equal(unsaved.chat.count('tab-1', 'newest') <= 21, true);
    const view = unsaved.keeper.view();
    assert.equal(view.phase, 'Stopped');
    assert.equal(view.stop.problem, 'The save failed');
    assert.equal(view.read, 99);
    assert.equal(savedReads(unsaved.storage), 99);
});

test('a page that does not join what is saved brings a whole pull', async () => {
    const { chat, model, keeper, storage, clock } = await adopted();
    assert.equal(chat.count('tab-1', 'history'), 1);
    chat.add(40);
    clock.time += MINUTE;
    await keeper.tick();
    assert.equal(chat.count('tab-1', 'history'), 2);
    assert.equal(savedIds(storage).join(',') === numbers(1, 140).map((number) => `MESSAGE-${number}`).join(','), true);
    assert.equal(keeper.view().total, 140);
    assert.deepEqual(ranges(model).slice(3), ['Story 100-139']);
    assert.equal(keeper.view().read, 139);
    chat.add(30);
    await keeper.tick();
    assert.equal(chat.count('tab-1', 'history'), 2);
    assert.equal(chat.count('tab-1', 'newest'), 2);
    assert.equal(savedIds(storage).length, 170);
    assert.equal(keeper.view().total, 170);
});

test('a pull cut short withdraws nothing outside it', async () => {
    const { chat, keeper, storage } = await adopted({ count: 120 });
    assert.equal(keeper.view().read, 119);
    const ends = [
        ['Failed', 'Zeta could not be reached', UNREACHED],
        ['RepeatedCursor', null, STOPPED_EARLY],
        ['NothingNew', null, STOPPED_EARLY],
        ['Limit', null, NEWEST_ONLY],
    ];
    for (const [end, problem, words] of ends) {
        chat.cutShort(end, 62, problem);
        await keeper.pull();
        const view = keeper.view();
        assert.equal(view.total, 120, end);
        assert.equal(view.read, 119, end);
        assert.equal(savedIds(storage).length, 120, end);
        assert.equal(savedReads(storage), 119, end);
        assert.equal(savedRead(storage, 'MESSAGE-1'), true, end);
        assert.equal(savedRead(storage, 'MESSAGE-58'), true, end);
        assert.equal(view.problem, words, end);
    }
    chat.cutShort('Failed', 62, 'Zeta could not be reached');
    await keeper.pull();
    assert.equal(keeper.view().problem, UNREACHED);
    chat.remove(5);
    await keeper.pull();
    const view = keeper.view();
    assert.equal(view.problem, null);
    assert.equal(view.total, 119);
    assert.equal(savedIds(storage).includes('MESSAGE-5'), false);
    assert.equal(savedRead(storage, 'MESSAGE-1'), false);
    assert.equal(savedRead(storage, 'MESSAGE-41'), true);
    assert.equal(view.read, 79);
});

test('a partial pull still notices what changed inside it', async () => {
    const { chat, keeper, storage } = await adopted({ count: 120 });
    chat.edit(100, 'The tale turns at the weir, line 100.');
    chat.remove(110);
    chat.cutShort('Failed', 62, 'Zeta could not be reached');
    await keeper.pull();
    const view = keeper.view();
    assert.equal(view.problem.startsWith(PART), true);
    assert.equal(view.total, 119);
    assert.equal(savedIds(storage).length, 119);
    assert.equal(savedIds(storage).includes('MESSAGE-110'), false);
    assert.equal(savedRead(storage, 'MESSAGE-100'), false);
    assert.equal(savedRead(storage, 'MESSAGE-81'), false);
    assert.equal(savedRead(storage, 'MESSAGE-80'), true);
    assert.equal(savedRead(storage, 'MESSAGE-1'), true);
    assert.equal(view.read, 80);
});

test('skipped messages are reported', async () => {
    const chat = new FakeChat(100);
    chat.skip(2);
    const { keeper, storage } = await opened(chat, analyst());
    let view = keeper.view();
    assert.equal(savedIds(storage).length, 100);
    assert.equal(view.total, 100);
    assert.equal(view.problem.includes('2 messages could not be read from the site.'), true);
    chat.skip(3);
    chat.cutShort('Limit', 62);
    await keeper.pull();
    view = keeper.view();
    assert.equal(view.problem.startsWith(NEWEST_ONLY), true);
    assert.equal(view.problem.includes('3 messages could not be read from the site.'), true);
    await keeper.pull();
    assert.equal(keeper.view().problem, null);
});

test('the view tells what is unread and what was read last', async () => {
    const chat = new FakeChat(121);
    const held = gate();
    const model = analyst({
        /**
         * @param {{ marks: number[] }} call
         * @return {Promise<void>|null}
         */
        hold: (call) => (call.marks[0] === 41 ? held.promise : null),
    });
    const { keeper } = await opened(chat, model);
    let view = keeper.view();
    assert.equal(view.lastRead, null);
    assert.deepEqual(plain(view.unread.map((message) => message.position)), numbers(1, 121));
    const adopting = keeper.adopt({});
    await until(() => model.calls.length === 2);
    keeper.pause();
    held.release();
    await adopting;
    view = keeper.view();
    assert.equal(view.read, 80);
    assert.deepEqual(plain(view.unread.map((message) => message.position)), numbers(81, 121));
    assert.equal(view.unread[0].id, 'MESSAGE-81');
    assert.equal(view.unread[40].id, 'MESSAGE-121');
    assert.deepEqual(plain(view.lastRead), { id: 'MESSAGE-80', position: 80 });
    chat.edit(20, 'The tale turns another way, line 20.');
    await keeper.pull();
    view = keeper.view();
    assert.deepEqual(plain(view.unread.map((message) => message.position)), [...numbers(1, 40), ...numbers(81, 121)]);
    assert.deepEqual(plain(view.lastRead), { id: 'MESSAGE-80', position: 80 });
});

test("the view lists the owner's rulings", async () => {
    const { keeper } = await adopted({ conflict: true, question: true });
    assert.equal(keeper.view().made.length, 0);
    await keeper.rule(PIN);
    await keeper.rule({ type: 'Dismiss', question: 'Q1' });
    const made = keeper.view().made;
    assert.deepEqual(plain(made.map((row) => [row.sequence, row.type])), [
        [5, 'Dismiss'],
        [4, 'Pin'],
    ]);
    assert.equal(typeof made[1].summary, 'string');
    await keeper.revoke(made[0].sequence);
    assert.deepEqual(plain(keeper.view().made.map((row) => [row.sequence, row.type])), [[4, 'Pin']]);
});

test("the player's words are filed as their own", async () => {
    const storage = new FakeStorage();
    const notesAtNotice = [];
    const held = gate();
    const { chat, model, keeper, clock } = await adopted({
        storage,
        /**
         * @return {void}
         */
        onNotify: () => {
            notesAtNotice.push(savedNotes(storage));
        },
        /**
         * @param {{ marks: number[] }} call
         * @return {Promise<void>|null}
         */
        hold: (call) => (call.marks[0] === 100 ? held.promise : null),
    });
    assert.equal(savedNotes(storage), 0);
    const anchor = { id: 'MESSAGE-12', position: 12 };
    notesAtNotice.length = 0;
    const refused = await keeper.file(told(['Halvard | trait | swore an oath to the harbour guild | #12']), anchor);
    assert.equal(refused.length, 0);
    assert.equal(savedNotes(storage), 1);
    assert.deepEqual(notesAtNotice, [1]);
    assert.equal(savedBook(storage).log.entries.at(-1).origin, 'Notes');
    assert.equal(savedReads(storage), 99);
    const filed = factsSaying(keeper, 'swore an oath to the harbour guild');
    assert.equal(filed.length, 1);
    assert.equal(filed[0].origin, 'Notes');
    assert.equal(filed[0].cite, 'MESSAGE-12');

    const second = await keeper.file(told(['Halvard | trait | keeps a second ledger | #90']), anchor);
    assert.deepEqual(plain(second.map((item) => item.reason)), ['Citation']);
    assert.equal(factsSaying(keeper, 'keeps a second ledger').length, 0);

    const before = storedText(storage, BOOK);
    await assert.rejects(keeper.file(told(['Halvard | trait | hums at dusk | #12']), { id: 'MESSAGE-100', position: 100 }), {
        message: BAD_ANCHOR,
    });
    await assert.rejects(keeper.file(told(['Halvard | trait | hums at dusk | #12']), { id: 'MESSAGE-999', position: 12 }), {
        message: BAD_ANCHOR,
    });
    assert.equal(storedText(storage, BOOK) === before, true);
    assert.equal((await keeper.file([], anchor)).length, 0);
    assert.equal(storedText(storage, BOOK) === before, true);

    chat.add(30);
    await keeper.tick();
    chat.add(11);
    const ticking = keeper.tick();
    await until(() => model.calls.length === 4);
    await assert.rejects(keeper.file(told(['Halvard | trait | hums at dusk | #12']), anchor), { message: READING });
    held.release();
    await ticking;
    assert.equal(keeper.view().read, 139);

    const watcher = await opened(chat, analyst(), { storage, clock, tabId: 'tab-2' });
    await assert.rejects(watcher.keeper.file(told(['Halvard | trait | hums at dusk | #12']), anchor), { message: WATCHING });

    chat.edit(20, 'The tale turns another way, line 20.');
    await keeper.pull();
    assert.equal(savedRead(storage, 'MESSAGE-12'), false);
    await keeper.tick();
    assert.equal(ranges(model).at(-1), 'Story 1-40');
    assert.equal(savedRead(storage, 'MESSAGE-12'), true);
    assert.equal(savedNotes(storage), 1);
    const kept = factsSaying(keeper, 'swore an oath to the harbour guild');
    assert.equal(kept.length, 1);
    assert.equal(kept[0].origin, 'Notes');
});

test("an injected claim replaces the store's", async () => {
    const chat = new FakeChat(100);
    const storage = new FakeStorage();
    let holding = false;
    const { keeper } = await opened(chat, analyst(), {
        storage,
        /**
         * @return {boolean}
         */
        claim: () => holding,
    });
    assert.equal(keeper.view().phase, 'Watching');
    assert.equal(keeper.view().reader, false);
    assert.equal([...storage.values.keys()].some((name) => name.startsWith('scribe:claim:')), false);
    holding = true;
    await keeper.tick();
    assert.equal(keeper.view().reader, true);
    assert.equal(keeper.view().phase, 'NoBook');
    assert.equal(chat.count('tab-1', 'history'), 1);
    holding = false;
    await keeper.tick();
    assert.equal(keeper.view().phase, 'Watching');
    assert.equal(keeper.view().reader, false);
    holding = true;
    await keeper.tick();
    assert.equal(keeper.view().reader, true);
    keeper.close();
    const touched = storage.calls.filter((call) => typeof call.name === 'string' && call.name.startsWith('scribe:claim:'));
    assert.equal(touched.length, 0);
    await assert.rejects(
        ScribeKeeper.open({
            storage,
            roomId: ROOM,
            tabId: 'tab-9',
            zeta: chat.zeta('tab-9'),
            ask: analyst().ask,
            clock: clockAt(),
            /**
             * @return {void}
             */
            notify: () => {},
            claim: 'yes',
        }),
        { message: 'The argument is not valid: claim' },
    );
});

test('the chat profile is asked for before each reading and goes to the reading model', async () => {
    const profile = 'Orla is a sellsword from the north.';
    /**
     * @param {(() => Promise<string|null>)|undefined} given
     * @return {Promise<{ users: string[], asked: number, keeper: object }>}
     */
    const read = async (given) => {
        const model = analyst();
        const users = [];
        const counted = { asked: 0 };
        const watched = {
            /**
             * @param {string} role
             * @param {string} system
             * @param {string} user
             * @return {Promise<{ text: string, cost: number }>}
             */
            ask: async (role, system, user) => {
                users.push(user);
                return model.ask(role, system, user);
            },
        };
        const extra =
            given === undefined
                ? {}
                : {
                      /**
                       * @return {Promise<string|null>}
                       */
                      profile: async () => {
                          counted.asked++;
                          return given();
                      },
                  };
        const { keeper } = await opened(new FakeChat(100), watched, extra);
        await keeper.adopt({});
        await keeper.tick();
        return { users, asked: counted.asked, keeper };
    };
    const heading = `\n\nPLAYER CHARACTER PROFILE:\n${profile}\n\nSUBJECTS:`;
    const told = await read(async () => profile);
    assert.equal(told.users.length >= 3, true);
    assert.equal(told.users.every((user) => user.includes(heading)), true);
    assert.equal(told.asked >= 1, true);
    assert.equal(told.keeper.view().phase, 'Idle');
    const untold = await read(async () => null);
    const bare = await read(undefined);
    assert.equal(untold.users.length, told.users.length);
    assert.equal(untold.users.some((user) => user.includes('PLAYER CHARACTER PROFILE:')), false);
    assert.deepEqual(untold.users, bare.users);
    assert.deepEqual(
        told.users.map((user) => user.replace(`PLAYER CHARACTER PROFILE:\n${profile}\n\n`, '')),
        bare.users,
    );
    const chat = new FakeChat(100);
    await assert.rejects(
        ScribeKeeper.open({
            storage: new FakeStorage(),
            roomId: ROOM,
            tabId: 'tab-9',
            zeta: chat.zeta('tab-9'),
            ask: analyst().ask,
            clock: clockAt(),
            /**
             * @return {void}
             */
            notify: () => {},
            profile: 'Orla',
        }),
        { message: 'The argument is not valid: profile' },
    );
});

test('open returns before the pull ends', async () => {
    const { chat, keeper: first, storage, clock } = await adopted();
    first.close();
    chat.add(5);
    const release = chat.hold('history');
    const { keeper, events } = await opened(chat, analyst(), { storage, clock, tabId: 'tab-2', wait: false });
    let view = keeper.view();
    assert.equal(view.phase, 'Loading');
    assert.equal(view.read, 99);
    assert.equal(view.total, 100);
    assert.equal(view.flight, 'Pulling the chat: 0 messages');
    await keeper.tick();
    assert.equal(chat.count('tab-2', 'newest'), 0);
    assert.equal(chat.count('tab-2', 'history'), 1);
    await assert.rejects(keeper.rule(PIN), { message: PULLING });
    const toldBefore = events.length;
    release();
    await until(() => keeper.view().phase !== 'Loading');
    view = keeper.view();
    assert.equal(view.phase, 'Idle');
    assert.equal(view.total, 105);
    assert.equal(events.length > toldBefore, true);
    keeper.close();

    chat.add(3);
    const releaseAgain = chat.hold('history');
    const third = await opened(chat, analyst(), { storage, clock, tabId: 'tab-3', wait: false });
    assert.equal(third.keeper.view().phase, 'Loading');
    const sets = storage.count('set');
    third.keeper.close();
    const toldThird = third.events.length;
    releaseAgain();
    for (let turn = 0; turn < 5; turn++) {
        await settle();
    }
    assert.equal(storage.count('set'), sets);
    assert.equal(third.events.length, toldThird);
    assert.equal(savedIds(storage).length, 105);
});

test('an unreadable campaign withdraws nothing', async () => {
    const { chat, model, keeper, storage, clock } = await adopted();
    keeper.close();
    assert.equal(savedReads(storage), 99);
    const spoils = [
        [
            'spoiled head',
            /**
             * @return {void}
             */
            () => {
                storage.values.set(`scribe:head:${ROOM}:campaign`, 'not json');
            },
        ],
        [
            'missing',
            /**
             * @return {void}
             */
            () => {
                for (const name of [...storage.values.keys()]) {
                    if (name.includes(`:${ROOM}:campaign`)) {
                        storage.values.delete(name);
                    }
                }
            },
        ],
        ['one refused read', null],
    ];
    for (const [index, [label, spoil]] of spoils.entries()) {
        const wrapper = guarded(storage);
        if (spoil === null) {
            wrapper.refuseGets(/^scribe:head:harbour:campaign$/, 1);
        } else {
            spoil();
        }
        const again = await opened(chat, model, { storage: wrapper, clock, tabId: `tab-${index + 2}` });
        await again.keeper.tick();
        assert.equal(savedReads(storage), 99, label);
        assert.equal(again.keeper.view().read, 99, label);
        assert.equal(again.keeper.view().problem, null, label);
        assert.equal(model.calls.length, 3, label);
        assert.equal(savedIds(storage).length, 100, label);
        again.keeper.close();
    }
});

test('a pull that ends early withdraws nothing older', async () => {
    const { chat, model, keeper, storage } = await adopted({ count: 300 });
    assert.equal(savedReads(storage), 299);
    const calls = model.calls.length;
    for (const end of ['NoCursor', 'EmptyPage']) {
        chat.cutShort(end, 62);
        await keeper.pull();
        assert.equal(savedReads(storage), 299, end);
        assert.equal(savedIds(storage).length, 300, end);
        assert.equal(keeper.view().read, 299, end);
        await keeper.tick();
        await keeper.tick();
        assert.equal(model.calls.length, calls, end);
    }
});

test('what is removed is decided by order', async () => {
    const shared = new FakeChat(100);
    shared.retime(69, FakeChat.time(70));
    const first = await adopted({ chat: shared });
    shared.regenerate();
    shared.regenerate();
    await first.keeper.tick();
    assert.equal(savedIds(first.storage).includes('MESSAGE-69'), true);
    assert.equal(savedRead(first.storage, 'MESSAGE-69'), true);
    assert.equal(first.keeper.view().read, 99);

    const untimed = new FakeChat(100);
    untimed.retime(85, null);
    const second = await adopted({ chat: untimed });
    untimed.remove(85);
    await second.keeper.tick();
    assert.equal(savedIds(second.storage).includes('MESSAGE-85'), false);
    assert.equal(savedRead(second.storage, 'MESSAGE-81'), false);
    assert.equal(savedRead(second.storage, 'MESSAGE-80'), true);
    assert.equal(second.keeper.view().read, 80);

    const third = await adopted();
    third.chat.add(40);
    third.chat.fail('history', new Error('Zeta could not be reached'));
    third.clock.time += MINUTE;
    await third.keeper.tick();
    assert.equal(third.chat.count('tab-1', 'history'), 2);
    assert.equal(savedIds(third.storage).length, 100);
    assert.equal(savedReads(third.storage), 99);
    assert.equal(third.keeper.view().total, 100);
});

test('a removal is not lost by a crash', async () => {
    const { chat, keeper, storage, clock } = await adopted();
    storage.refuseSetsMatching(BOOK);
    chat.remove(90);
    await keeper.tick();
    assert.deepEqual(plain(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Campaign).gone), ['MESSAGE-90']);
    assert.equal(savedRead(storage, 'MESSAGE-90'), true);
    keeper.close();
    storage.allow();
    const again = await opened(chat, analyst(), { storage, clock, tabId: 'tab-2' });
    assert.equal(savedRead(storage, 'MESSAGE-81'), false);
    assert.equal(savedRead(storage, 'MESSAGE-80'), true);
    assert.deepEqual(plain(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Campaign).gone), []);
    assert.equal(again.keeper.view().read, 80);
});

test('no reading on a chat known to be incomplete', async () => {
    const chat = new FakeChat(300);
    chat.cutShort('Failed', 62, 'Zeta could not be reached');
    const model = analyst();
    const { keeper, clock } = await opened(chat, model);
    assert.equal(keeper.view().total, 62);
    assert.equal(keeper.view().problem, UNREACHED);
    await assert.rejects(keeper.adopt({}), { message: UNREACHED });
    assert.equal(model.calls.length, 0);
    clock.time += 30000;
    await keeper.tick();
    clock.time += 29999;
    await keeper.tick();
    assert.equal(chat.count('tab-1', 'history'), 1);
    assert.equal(chat.count('tab-1', 'newest'), 0);
    clock.time += 1;
    await keeper.tick();
    assert.equal(chat.count('tab-1', 'history'), 2);
    assert.equal(keeper.view().total, 300);
    await keeper.adopt({});
    assert.equal(ranges(model)[0], 'Story 1-40');
    assert.equal(keeper.view().read, 299);

    const early = new FakeChat(10);
    early.fail('history', new Error('No login seen yet'));
    const waiting = await opened(early, analyst());
    assert.equal(waiting.keeper.view().problem, 'No login seen yet');
    await assert.rejects(waiting.keeper.adopt({}), { message: NOTHING_PULLED });
});

test('the last pull is shown', async () => {
    const chat = new FakeChat(100);
    chat.skip(1);
    const { keeper, clock } = await opened(chat, analyst());
    let view = keeper.view();
    assert.deepEqual(plain(view.pulled), { end: 'NoCursor', count: 100, skipped: 1, at: START });
    assert.equal(view.problem, '1 message could not be read from the site.');
    const ends = [
        ['RepeatedCursor', STOPPED_EARLY],
        ['NothingNew', STOPPED_EARLY],
        ['Limit', NEWEST_ONLY],
        ['Failed', UNREACHED],
    ];
    for (const [end, words] of ends) {
        chat.cutShort(end, 62, end === 'Failed' ? 'Zeta could not be reached' : null);
        clock.time += 1000;
        await keeper.pull();
        view = keeper.view();
        assert.deepEqual(plain(view.pulled), { end, count: 62, skipped: 0, at: clock.time }, end);
        assert.equal(view.problem, words, end);
    }
});

test('keep-up never pays for a scrap', async () => {
    const { chat, model, keeper } = await adopted({ count: 120 });
    chat.remove(50);
    await keeper.pull();
    chat.add(1);
    await keeper.tick();
    assert.deepEqual(ranges(model).slice(3), ['Story 41-79']);
    assert.equal(keeper.view().read, 118);
    chat.add(30);
    await keeper.tick();
    assert.equal(model.calls.length, 4);
    chat.add(9);
    await keeper.tick();
    assert.deepEqual(ranges(model).slice(4), ['Story 119-158']);
});

test('an answered question is filed at once', async () => {
    const { chat, model, keeper, events } = await adopted({ question: true });
    chat.add(1);
    await keeper.tick();
    assert.equal(model.calls.length, 3);
    await keeper.rule({ type: 'Answer', question: 'Q1', text: 'She trusts him with the ledger' });
    await keeper.tick();
    assert.deepEqual(ranges(model).slice(3), ['Answers 12']);
    assert.equal(keeper.view().state.questions[0].dismissed, true);
    assert.equal(factsSaying(keeper, 'settled by the answers at line 12').length, 1);
    assert.equal(keeper.view().unread.length, 2);
    events.length = 0;
    await keeper.tick();
    await keeper.tick();
    assert.equal(model.calls.length, 4);
    assert.equal(events.length, 4);
});

test('a storage failure is tried again', async () => {
    const first = await adopted();
    first.keeper.close();
    first.chat.add(41);
    const wrapper = guarded(first.storage);
    wrapper.refuseGets(BOOK_HEAD, 1);
    const before = storedText(first.storage, BOOK);
    const model = analyst();
    const again = await opened(first.chat, model, { storage: wrapper, clock: first.clock, tabId: 'tab-2' });
    let view = again.keeper.view();
    assert.equal(view.problem, UNREAD_STORAGE);
    assert.equal(view.phase, 'Stopped');
    await assert.rejects(again.keeper.resume(), { message: UNREAD_STORAGE });
    assert.equal(storedText(first.storage, BOOK) === before, true);
    await again.keeper.tick();
    view = again.keeper.view();
    assert.equal(view.problem, null);
    assert.equal(view.read, 139);
    assert.deepEqual(ranges(model), ['Story 100-139']);

    const base = new FakeStorage();
    const middleWrapper = guarded(base);
    const middle = await adopted({ storage: middleWrapper });
    middle.chat.add(30);
    await middle.keeper.tick();
    middle.chat.add(11);
    middleWrapper.refuseGets(BOOK_HEAD, 1000);
    await middle.keeper.tick();
    assert.equal(middle.keeper.view().problem, UNREAD_STORAGE);
    assert.equal(savedReads(base), 99);
    middleWrapper.refusedGets.length = 0;
    await middle.keeper.tick();
    assert.equal(middle.keeper.view().problem, null);
    assert.equal(middle.keeper.view().read, 139);
    assert.equal(savedReads(base), 139);
    assert.deepEqual(ranges(middle.model).slice(3), ['Story 100-139']);

    const settingsBase = new FakeStorage();
    const owner = await opened(new FakeChat(100), analyst(), { storage: settingsBase });
    await owner.keeper.configure({ budget: 0.02 });
    owner.keeper.close();
    const settingsWrapper = guarded(settingsBase);
    settingsWrapper.refuseGets(/^scribe:head:harbour:settings$/, 1);
    const reopened = await opened(new FakeChat(100), analyst(), { storage: settingsWrapper, clock: owner.clock, tabId: 'tab-3' });
    await assert.rejects(reopened.keeper.adopt({}), { message: UNREAD_STORAGE });
    await reopened.keeper.tick();
    await reopened.keeper.adopt({});
    assert.equal(ScribeStore.read(settingsBase, ROOM, ScribeStore.Kind.Settings).budget, 0.02);
    assert.equal(reopened.keeper.view().settings.budget, 0.02);
    assert.equal(reopened.keeper.view().stop.reason, 'Budget');
});

test('a save that threw is looked at again', async () => {
    const base = new FakeStorage();
    const wrapper = guarded(base);
    const stored = await adopted({ conflict: true, storage: wrapper });
    wrapper.refuseReadBack(BOOK_HEAD);
    await assert.rejects(stored.keeper.rule(PIN), { message: UNCONFIRMED });
    assert.equal(rulingsSaved(base), 1);
    assert.equal(stored.keeper.view().state.conflicts.length, 0);
    stored.chat.add(30);
    await stored.keeper.tick();
    stored.chat.add(11);
    await stored.keeper.tick();
    assert.equal(stored.keeper.view().read, 139);
    assert.equal(rulingsSaved(base), 1);

    const lost = await adopted({ conflict: true });
    lost.storage.refuseSetsMatching(BOOK_HEAD);
    await assert.rejects(lost.keeper.rule(PIN), { message: UNCONFIRMED });
    assert.equal(rulingsSaved(lost.storage), 0);
    assert.equal(lost.keeper.view().state.conflicts.length, 1);
});

test('a malformed book is damage, not a crash', async () => {
    const shapes = [
        [
            'message ids null',
            /**
             * @param {object} book
             * @return {void}
             */
            (book) => {
                book.log.entries[0].messageIds = null;
            },
        ],
        [
            'no fingerprints',
            /**
             * @param {object} book
             * @return {void}
             */
            (book) => {
                delete book.fingerprints;
            },
        ],
    ];
    for (const [label, spoil] of shapes) {
        const { chat, keeper, storage, clock } = await adopted();
        keeper.close();
        const book = savedBook(storage);
        spoil(book);
        ScribeStore.write(storage, ROOM, ScribeStore.Kind.Book, book);
        const before = storedText(storage, BOOK);
        const model = analyst();
        const again = await opened(chat, model, { storage, clock, tabId: 'tab-2' });
        assert.equal(again.keeper.view().phase, 'Stopped', label);
        assert.equal(again.keeper.view().problem, DAMAGED, label);
        chat.edit(97, 'The tale turns at the mill, line 97.');
        for (let turn = 0; turn < 3; turn++) {
            chat.add(15);
            assert.equal(await returns(again.keeper.tick()), true, label);
        }
        assert.equal(again.keeper.view().phase, 'Stopped', label);
        assert.equal(storedText(storage, BOOK) === before, true, label);
        assert.equal(model.calls.length, 0, label);
    }
});

test('a stop survives a reload', async () => {
    const chat = new FakeChat(100);
    const storage = new FakeStorage();
    const clock = clockAt();
    let held = gate();
    const model = analyst({
        /**
         * @param {{ marks: number[] }} call
         * @return {Promise<void>|null}
         */
        hold: (call) => (call.marks[0] === 1 ? held.promise : null),
    });
    const first = await opened(chat, model, { storage, clock });
    const adopting = first.keeper.adopt({});
    await until(() => model.calls.length === 1);
    first.keeper.pause();
    held.release();
    await adopting;
    first.keeper.close();
    for (let turn = 0; turn < 4; turn++) {
        const again = await opened(chat, model, { storage, clock, tabId: `tab-${turn + 2}` });
        await again.keeper.tick();
        assert.equal(again.keeper.view().phase, 'Stopped');
        assert.equal(again.keeper.view().stop.reason, 'Paused');
        again.keeper.close();
    }
    assert.equal(model.calls.length, 1);
    const resumed = await opened(chat, model, { storage, clock, tabId: 'tab-7' });
    await resumed.keeper.resume();
    assert.equal(resumed.keeper.view().phase, 'Idle');
    assert.equal(resumed.keeper.view().read, 99);
    resumed.keeper.pause();
    assert.equal(resumed.keeper.view().stop.reason, 'Paused');
    held = gate();
    const restarting = resumed.keeper.adopt({});
    await until(() => model.calls.length === 4);
    resumed.keeper.close();
    held.release();
    await restarting;
    const cleared = await opened(chat, model, { storage, clock, tabId: 'tab-8' });
    assert.equal(cleared.keeper.view().phase, 'Idle');
    assert.equal(cleared.keeper.view().stop, null);
    await cleared.keeper.tick();
    assert.equal(cleared.keeper.view().phase, 'Idle');
    assert.equal(cleared.keeper.view().read, 99);
    cleared.keeper.close();

    const failing = new FakeChat(100);
    const failingStorage = new FakeStorage();
    let holding = true;
    const unreadable = analyst({
        /**
         * @param {{ marks: number[] }} call
         * @return {boolean}
         */
        unreadable: (call) => call.marks[0] === 41,
    });
    const failed = await opened(failing, unreadable, {
        storage: failingStorage,
        clock,
        /**
         * @return {boolean}
         */
        claim: () => holding,
    });
    await failed.keeper.adopt({});
    const problem = failed.keeper.view().stop.problem;
    assert.equal(failed.keeper.view().stop.reason, 'Failed');
    assert.equal(unreadable.calls.length, 2);
    for (let turn = 0; turn < 5; turn++) {
        holding = false;
        await failed.keeper.tick();
        assert.equal(failed.keeper.view().phase, 'Watching');
        holding = true;
        await failed.keeper.tick();
        await failed.keeper.tick();
        assert.equal(failed.keeper.view().phase, 'Stopped');
        assert.equal(failed.keeper.view().stop.problem, problem);
    }
    failed.keeper.close();
    for (let turn = 0; turn < 4; turn++) {
        const again = await opened(failing, unreadable, { storage: failingStorage, clock, tabId: `tab-${turn + 2}` });
        await again.keeper.tick();
        assert.equal(again.keeper.view().phase, 'Stopped');
        assert.equal(again.keeper.view().stop.reason, 'Failed');
        assert.equal(again.keeper.view().stop.problem, problem);
        again.keeper.close();
    }
    assert.equal(unreadable.calls.length, 2);
    unreadable.unreadable = null;
    const mended = await opened(failing, unreadable, { storage: failingStorage, clock, tabId: 'tab-9' });
    await mended.keeper.resume();
    assert.equal(mended.keeper.view().phase, 'Idle');
    assert.equal(mended.keeper.view().read, 99);
});

test('paid calls are always counted', async () => {
    const chat = new FakeChat(100);
    const held = gate();
    const model = analyst({
        cost: 0.5,
        /**
         * @param {{ marks: number[] }} call
         * @return {Promise<void>|null}
         */
        hold: (call) => (call.marks[0] === 41 ? held.promise : null),
    });
    const { keeper, storage } = await opened(chat, model);
    const adopting = keeper.adopt({});
    await until(() => model.calls.length === 2);
    keeper.close();
    const sets = otherSets(storage);
    held.release();
    await adopting;
    await settle();
    assert.equal(Math.round(ScribeStore.spent(storage, ROOM, DAY) * 100), 100);
    assert.equal(otherSets(storage), sets);

    const lostChat = new FakeChat(100);
    const lostHeld = gate();
    let holding = true;
    const lostModel = analyst({
        cost: 0.5,
        /**
         * @param {{ marks: number[] }} call
         * @return {Promise<void>|null}
         */
        hold: (call) => (call.marks[0] === 41 ? lostHeld.promise : null),
    });
    const lost = await opened(lostChat, lostModel, {
        /**
         * @return {boolean}
         */
        claim: () => holding,
    });
    const lostAdopting = lost.keeper.adopt({});
    await until(() => lostModel.calls.length === 2);
    holding = false;
    const lostSets = otherSets(lost.storage);
    lostHeld.release();
    await lostAdopting;
    await settle();
    assert.equal(Math.round(ScribeStore.spent(lost.storage, ROOM, DAY) * 100), 100);
    assert.equal(otherSets(lost.storage), lostSets);
    assert.equal(lost.keeper.view().phase, 'Watching');
});

test('a stale reader saves nothing', async () => {
    const chat = new FakeChat(100);
    const storage = new FakeStorage();
    const clock = clockAt();
    const held = gate();
    const model = analyst({
        conflict: true,
        /**
         * @param {{ marks: number[] }} call
         * @return {Promise<void>|null}
         */
        hold: (call) => (call.marks[0] === 100 ? held.promise : null),
    });
    const first = await opened(chat, model, { storage, clock });
    await first.keeper.adopt({});
    chat.add(30);
    await first.keeper.tick();
    chat.add(11);
    const ticking = first.keeper.tick();
    await until(() => model.calls.length === 4);
    clock.time += 120000;
    const second = await opened(chat, analyst({ conflict: true }), { storage, clock, tabId: 'tab-2' });
    assert.equal(second.keeper.view().reader, true);
    await second.keeper.rule(PIN);
    assert.equal(rulingsSaved(storage), 1);
    held.release();
    await ticking;
    assert.equal(rulingsSaved(storage), 1);
    assert.equal(savedReads(storage), 99);
    assert.equal(first.keeper.view().phase, 'Watching');

    const refusedChat = new FakeChat(100);
    const refusedStorage = new FakeStorage();
    const refusedHeld = gate();
    const refusedModel = analyst({
        /**
         * @param {{ marks: number[] }} call
         * @return {Promise<void>|null}
         */
        hold: (call) => (call.marks[0] === 100 ? refusedHeld.promise : null),
    });
    const refused = await opened(refusedChat, refusedModel, { storage: refusedStorage });
    await refused.keeper.adopt({});
    refusedChat.add(30);
    await refused.keeper.tick();
    refusedChat.add(11);
    const refusedTicking = refused.keeper.tick();
    await until(() => refusedModel.calls.length === 4);
    refusedStorage.refuseSetsMatching(/^scribe:claim:/);
    await refused.keeper.tick();
    assert.equal(refused.keeper.view().reader, true);
    refusedStorage.allow();
    refusedHeld.release();
    await refusedTicking;
    assert.equal(savedReads(refusedStorage), 139);
    await refused.keeper.tick();
    assert.equal(refusedModel.calls.length, 4);
    assert.equal(refused.keeper.view().reader, true);
});

test('the lost claim stops writes', async () => {
    const chat = new FakeChat(100);
    const held = gate();
    let holding = true;
    const model = analyst({
        /**
         * @param {{ marks: number[] }} call
         * @return {Promise<void>|null}
         */
        hold: (call) => (call.marks[0] === 41 ? held.promise : null),
    });
    const { keeper, storage } = await opened(chat, model, {
        /**
         * @return {boolean}
         */
        claim: () => holding,
    });
    const adopting = keeper.adopt({});
    await until(() => model.calls.length === 2);
    const saves = bookSaves(storage);
    holding = false;
    held.release();
    await adopting;
    assert.equal(bookSaves(storage), saves);
    assert.equal(savedReads(storage), 40);
    assert.equal(keeper.view().phase, 'Watching');
    assert.equal(keeper.view().reader, false);
});

test("the owner's notes are filed", async () => {
    const chat = new FakeChat(99);
    chat.edit(98, 'I wave to the ferryman.\n*(\nHalvard served ten years with the pikes.\n)*');
    const model = analyst();
    const { keeper, storage } = await opened(chat, model);
    await keeper.adopt({});
    assert.deepEqual(ranges(model), ['Story 1-40', 'Story 41-80', 'Notes 98', 'Story 81-98']);
    assert.equal(savedBook(storage).log.notes.includes('Halvard served ten years with the pikes.'), true);
});

test('a filing that fails or is all refused leaves nothing', async () => {
    const { chat, keeper, storage } = await adopted();
    const anchor = { id: 'MESSAGE-12', position: 12 };
    storage.refuseSetsMatching(BOOK);
    await assert.rejects(keeper.file(told(['Halvard | trait | swore an oath to the harbour guild | #12']), anchor), {
        message: UNCONFIRMED,
    });
    storage.allow();
    chat.add(30);
    await keeper.tick();
    chat.add(11);
    await keeper.tick();
    assert.equal(keeper.view().read, 139);
    assert.equal(savedNotes(storage), 0);
    assert.equal(factsSaying(keeper, 'swore an oath to the harbour guild').length, 0);
    const saves = bookSaves(storage);
    const refused = await keeper.file(told(['Halvard | trait | keeps a second ledger | #90']), anchor);
    assert.deepEqual(plain(refused.map((item) => item.reason)), ['Citation']);
    assert.equal(bookSaves(storage), saves);
    assert.equal(savedNotes(storage), 0);
    chat.add(30);
    await keeper.tick();
    chat.add(10);
    await keeper.tick();
    assert.equal(keeper.view().read, 179);
    assert.equal(savedNotes(storage), 0);
});

test('a chat that no longer matches can be started over', async () => {
    const { chat, model, keeper, storage, clock } = await adopted();
    const campaignBefore = storedText(storage, CAMPAIGN);
    const bookBefore = storedText(storage, BOOK);
    assert.equal(keeper.view().mismatch, false);
    chat.renameAll('OTHER');
    clock.time += MINUTE;
    await keeper.tick();
    let view = keeper.view();
    assert.equal(view.mismatch, false);
    assert.equal(view.problem, SUSPECT);
    clock.time += MINUTE;
    await keeper.tick();
    view = keeper.view();
    assert.equal(view.mismatch, true);
    assert.equal(view.problem, MISMATCH);
    assert.equal(storedText(storage, CAMPAIGN) === campaignBefore, true);
    assert.equal(storedText(storage, BOOK) === bookBefore, true);
    await keeper.tick();
    clock.time += MINUTE;
    await keeper.tick();
    assert.equal(keeper.view().mismatch, true);
    assert.equal(model.calls.length, 3);
    await assert.rejects(keeper.resume(), { message: MISMATCH });
    assert.equal(storedText(storage, BOOK) === bookBefore, true);
    await keeper.adopt({});
    view = keeper.view();
    assert.equal(view.mismatch, false);
    assert.equal(view.problem, null);
    assert.equal(view.phase, 'Idle');
    assert.equal(view.read, 99);
    assert.deepEqual(ranges(model).slice(3), ['Story 1-40', 'Story 41-80', 'Story 81-99']);
    const ids = savedIds(storage);
    assert.equal(ids.length, 100);
    assert.equal(ids.every((id) => id.startsWith('OTHER-')), true);
    assert.deepEqual(plain(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Campaign).gone), []);
    const marks = Object.keys(savedBook(storage).log.read);
    assert.equal(marks.length, 99);
    assert.equal(marks.every((id) => id.startsWith('OTHER-')), true);
    assert.equal(savedRead(storage, 'OTHER-1'), true);
});

test('a mismatch that heals is forgotten', async () => {
    const { chat, model, keeper, storage, clock } = await adopted();
    const campaignBefore = storedText(storage, CAMPAIGN);
    const bookBefore = storedText(storage, BOOK);
    chat.renameAll('OTHER');
    clock.time += MINUTE;
    await keeper.tick();
    clock.time += MINUTE;
    await keeper.tick();
    assert.equal(keeper.view().mismatch, true);
    chat.renameAll('MESSAGE');
    clock.time += MINUTE;
    await keeper.tick();
    const view = keeper.view();
    assert.equal(view.mismatch, false);
    assert.equal(view.problem, null);
    assert.equal(storedText(storage, CAMPAIGN) === campaignBefore, true);
    assert.equal(storedText(storage, BOOK) === bookBefore, true);
    await keeper.adopt({});
    assert.equal(storedText(storage, CAMPAIGN) === campaignBefore, true);
    assert.equal(savedIds(storage).every((id) => id.startsWith('MESSAGE-')), true);
    assert.equal(savedRead(storage, 'MESSAGE-1'), true);
    assert.equal(keeper.view().read, 99);
    assert.deepEqual(ranges(model).slice(3), ['Story 1-40', 'Story 41-80', 'Story 81-99']);
});

/**
 * @param {object} state
 * @param {string} text
 * @return {Array<string|null>}
 */
function factLine(state, text) {
    const found = state.facts.filter((fact) => fact.text === text);
    assert.equal(found.length, 1, `facts saying ${text}`);
    return plain([found[0].id, found[0].category, found[0].text, found[0].origin, found[0].cite]);
}

test('a preview shows what filing would do and changes nothing', async () => {
    const { keeper, storage, events } = await adopted();
    const anchor = { id: 'MESSAGE-12', position: 12 };
    const operations = told([`Halvard | trait | ${OATH} | #12`]);
    const sets = storage.count('set');
    const notices = events.length;
    const revision = keeper.view().state.revision;
    const shown = await keeper.preview(operations, anchor);
    assert.equal(shown.refused.length, 0);
    const previewed = factLine(shown.state, OATH);
    assert.equal(factsSaying(keeper, OATH).length, 0);
    assert.equal(keeper.view().state.revision, revision);
    assert.equal(storage.count('set'), sets);
    assert.equal(events.length, notices);
    const empty = await keeper.preview([], anchor);
    assert.equal(empty.refused.length, 0);
    assert.equal(empty.state === empty.before, true);
    assert.equal(empty.before.revision, keeper.view().state.revision);
    assert.equal(storage.count('set'), sets);
    await keeper.file(operations, anchor);
    assert.deepEqual(factLine(keeper.view().state, OATH), previewed);
});

test('a preview shares nothing with the book', async () => {
    const { chat, keeper, storage } = await adopted({ conflict: true });
    const anchor = { id: 'MESSAGE-12', position: 12 };
    const operations = told([`Halvard | trait | ${OATH} | #12`]);
    const first = await keeper.preview(operations, anchor);
    const second = await keeper.preview(operations, anchor);
    assert.deepEqual(factLine(second.state, OATH), factLine(first.state, OATH));
    await keeper.rule(PIN);
    assert.equal(factsSaying(keeper, OATH).length, 0);
    assert.equal(savedNotes(storage), 0);
    assert.equal(storedText(storage, BOOK).includes(OATH), false);
    chat.add(30);
    await keeper.tick();
    chat.add(11);
    await keeper.tick();
    assert.equal(keeper.view().read, 139);
    assert.equal(factsSaying(keeper, OATH).length, 0);
    assert.equal(savedNotes(storage), 0);
    assert.equal(storedText(storage, BOOK).includes(OATH), false);
});

test('a preview obeys the same rules as a filing', async () => {
    const held = gate();
    const { chat, model, keeper, storage, clock } = await adopted({
        /**
         * @param {{ marks: number[] }} call
         * @return {Promise<void>|null}
         */
        hold: (call) => (call.marks[0] === 100 ? held.promise : null),
    });
    const anchor = { id: 'MESSAGE-12', position: 12 };
    const operations = told([`Halvard | trait | ${OATH} | #12`]);
    await assert.rejects(keeper.preview(operations, { id: 'MESSAGE-100', position: 100 }), { message: BAD_ANCHOR });
    await assert.rejects(keeper.preview(operations, { id: 'MESSAGE-999', position: 12 }), { message: BAD_ANCHOR });
    const refused = await keeper.preview(told(['Halvard | trait | keeps a second ledger | #90']), anchor);
    assert.deepEqual(plain(refused.refused.map((item) => item.reason)), ['Citation']);
    assert.equal(refused.state.facts.filter((fact) => fact.text === 'keeps a second ledger').length, 0);
    chat.add(30);
    await keeper.tick();
    chat.add(11);
    const ticking = keeper.tick();
    await until(() => model.calls.length === 4);
    await assert.rejects(keeper.preview(operations, anchor), { message: READING });
    held.release();
    await ticking;
    const watcher = await opened(chat, analyst(), { storage, clock, tabId: 'tab-2' });
    await assert.rejects(watcher.keeper.preview(operations, anchor), { message: WATCHING });
});

/**
 * @param {number} amount
 * @return {number}
 */
function cents(amount) {
    return Math.round(amount * 100);
}

/**
 * @param {FakeStorage} storage
 * @param {RegExp} pattern
 * @return {number}
 */
function setsMatching(storage, pattern) {
    return storage.calls.filter((call) => call.operation === 'set' && pattern.test(call.name)).length;
}

/**
 * @param {object} keeper
 * @param {object} clock
 * @param {number} span
 * @param {number} every
 * @return {Promise<void>}
 */
async function tickFor(keeper, clock, span, every) {
    for (let elapsed = 0; elapsed < span; elapsed += every) {
        clock.time += every;
        await keeper.tick();
    }
}

/**
 * @param {object} opening
 * @param {number} added
 * @return {Promise<void>}
 */
async function grow(opening, added) {
    opening.chat.add(30);
    await opening.keeper.tick();
    opening.chat.add(added - 30);
    await opening.keeper.tick();
}

/**
 * @param {FakeStorage} storage
 * @return {object|null}
 */
function savedStop(storage) {
    const record = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Settings);
    return record === null ? null : record.stop;
}

test('a full storage never pays twice', async () => {
    const chat = new FakeChat(100);
    const storage = new FakeStorage();
    const model = analyst({
        cost: 0.05,
        /**
         * @param {{ marks: number[] }} call
         * @return {null}
         */
        hold: (call) => {
            if (call.marks[0] === 100) {
                storage.refuseSetsMatching(/./);
            }
            return null;
        },
    });
    const opening = await opened(chat, model, { storage });
    await opening.keeper.adopt({ budget: 0.5 });
    await grow({ chat, keeper: opening.keeper }, 41);
    assert.equal(model.calls.length, 4);
    assert.equal(cents(opening.keeper.view().spentToday), 20);
    await tickFor(opening.keeper, opening.clock, HOUR, SECONDS_SIX);
    assert.equal(model.calls.length, 4);
    assert.equal(cents(opening.keeper.view().spentToday), 20);
    assert.equal(savedReads(storage), 99);
    storage.allow();
    await opening.keeper.tick();
    assert.equal(model.calls.length, 4);
    assert.equal(savedReads(storage), 139);
    assert.equal(cents(ScribeStore.spent(storage, ROOM, DAY)), 20);
});

test('owed spending binds the budget', async () => {
    const chat = new FakeChat(100);
    const storage = new FakeStorage();
    const model = analyst({ cost: 0.05 });
    const { keeper, clock } = await opened(chat, model, { storage });
    await keeper.adopt({ budget: 0.5 });
    storage.refuseSetsMatching(/^scribe:spent:/);
    for (let minute = 0; minute < 30; minute++) {
        chat.add(4);
        clock.time += MINUTE;
        await keeper.tick();
    }
    assert.equal(model.calls.length, 4);
    assert.equal(cents(keeper.view().spentToday), 20);
    assert.equal(cents(ScribeStore.spent(storage, ROOM, DAY)), 15);
    storage.allow();
    clock.time += MINUTE;
    await keeper.tick();
    assert.equal(model.calls.length, 6);
    assert.equal(cents(ScribeStore.spent(storage, ROOM, DAY)), 30);
    assert.equal(keeper.view().read, 219);
});

test('an unsaved stretch is not bought again', async () => {
    const refused = await adopted({ cost: 0.05 });
    refused.chat.add(30);
    await refused.keeper.tick();
    refused.chat.add(11);
    refused.storage.refuseSetsMatching(BOOK);
    await refused.keeper.tick();
    await tickFor(refused.keeper, refused.clock, 10 * MINUTE, SECONDS_SIX);
    assert.equal(refused.model.calls.length, 4);
    assert.equal(savedReads(refused.storage), 99);
    refused.storage.allow();
    refused.clock.time += MINUTE;
    await refused.keeper.tick();
    assert.equal(refused.model.calls.length, 4);
    assert.equal(savedReads(refused.storage), 139);

    for (const kind of ['read', 'write']) {
        const base = new FakeStorage();
        const wrapper = guarded(base);
        const once = await adopted({
            storage: wrapper,
            /**
             * @param {{ marks: number[] }} call
             * @return {null}
             */
            hold: (call) => {
                if (call.marks[0] === 100) {
                    if (kind === 'read') {
                        wrapper.refuseGets(BOOK_HEAD, 1);
                    } else {
                        wrapper.refuseSets(BOOK_PART, 1);
                    }
                }
                return null;
            },
        });
        await grow(once, 41);
        assert.equal(savedReads(base), 99, kind);
        once.clock.time += MINUTE;
        await once.keeper.tick();
        assert.equal(once.model.calls.length, 4, kind);
        assert.equal(savedReads(base), 139, kind);
    }

    const ruled = await adopted({ conflict: true });
    ruled.chat.add(30);
    await ruled.keeper.tick();
    ruled.chat.add(11);
    ruled.storage.refuseSetsMatching(BOOK);
    await ruled.keeper.tick();
    ruled.storage.allow();
    await ruled.keeper.rule({ type: 'Merge', from: 'S2', into: 'S1' });
    ruled.clock.time += MINUTE;
    await ruled.keeper.tick();
    assert.deepEqual(ranges(ruled.model).slice(3), ['Story 100-139', 'Story 100-139']);
    assert.equal(savedReads(ruled.storage), 139);
});

test('kept answers end with a confirmed save and with adopt', async () => {
    const chat = new FakeChat(41);
    const model = analyst({ blank: true });
    const { keeper } = await opened(chat, model);
    await keeper.adopt({});
    assert.equal(model.calls.length, 1);
    chat.edit(20, 'The tale turns another way, line 20.');
    await keeper.tick();
    assert.equal(model.calls.length, 2);
    chat.edit(20, 'I answer the ferryman, line 20.');
    await keeper.tick();
    assert.equal(model.calls.length, 3);
    assert.equal(keeper.view().read, 40);

    const storage = new FakeStorage();
    let armed = true;
    const restarting = analyst({
        /**
         * @param {{ marks: number[] }} call
         * @return {null}
         */
        hold: (call) => {
            if (call.marks[0] === 1 && armed) {
                armed = false;
                storage.refuseSetsMatching(BOOK);
            }
            return null;
        },
    });
    const again = await opened(new FakeChat(100), restarting, { storage });
    await again.keeper.adopt({});
    assert.equal(again.keeper.view().stop.reason, 'Failed');
    storage.allow();
    await again.keeper.adopt({});
    assert.deepEqual(ranges(restarting), ['Story 1-40', 'Story 1-40', 'Story 41-80', 'Story 81-99']);
    assert.equal(again.keeper.view().read, 99);
});

test('a refused spending read is storage-caused', async () => {
    for (const reload of [false, true]) {
        const base = new FakeStorage();
        const wrapper = guarded(base);
        const opening = await adopted({ storage: wrapper });
        opening.keeper.pause();
        await grow(opening, 41);
        assert.equal(opening.model.calls.length, 3);
        wrapper.refuseGets(/^scribe:spent:/, 1);
        await opening.keeper.resume();
        assert.equal(opening.keeper.view().stop.reason, 'Failed');
        assert.equal(savedStop(base), null);
        assert.equal(opening.model.calls.length, 3);
        let keeper = opening.keeper;
        if (reload) {
            keeper.close();
            keeper = (await opened(opening.chat, opening.model, { storage: wrapper, clock: opening.clock, tabId: 'tab-2' })).keeper;
            assert.equal(keeper.view().stop, null);
            assert.equal(keeper.view().phase, 'Idle');
        } else {
            opening.clock.time += MINUTE;
        }
        await keeper.tick();
        assert.equal(savedReads(base), 139, String(reload));
        assert.equal(opening.model.calls.length, 4, String(reload));
    }
});

test('a tab that lost the claim writes no settings', async () => {
    const actions = [
        [
            'adopt',
            /**
             * @param {object} keeper
             * @return {Promise<void>}
             */
            async (keeper) => {
                await assert.rejects(keeper.adopt({ budget: 9 }), { message: WATCHING });
            },
        ],
        [
            'configure',
            /**
             * @param {object} keeper
             * @return {Promise<void>}
             */
            async (keeper) => {
                await assert.rejects(keeper.configure({ size: 25 }), { message: WATCHING });
            },
        ],
        [
            'pause',
            /**
             * @param {object} keeper
             * @return {Promise<void>}
             */
            async (keeper) => {
                assert.throws(() => keeper.pause(), { message: WATCHING });
            },
        ],
        [
            'resume',
            /**
             * @param {object} keeper
             * @return {Promise<void>}
             */
            async (keeper) => {
                await assert.rejects(keeper.resume(), { message: WATCHING });
            },
        ],
    ];
    for (const [label, act] of actions) {
        const chat = new FakeChat(100);
        const storage = new FakeStorage();
        const clock = clockAt();
        const first = await opened(chat, analyst(), { storage, clock });
        await first.keeper.adopt({});
        clock.time += 120000;
        const second = await opened(chat, analyst(), { storage, clock, tabId: 'tab-2' });
        second.keeper.pause();
        const settingsText = storedText(storage, SETTINGS);
        const writes = setsMatching(storage, SETTINGS);
        await act(first.keeper);
        assert.equal(setsMatching(storage, SETTINGS), writes, label);
        assert.equal(storedText(storage, SETTINGS) === settingsText, true, label);
        assert.equal(savedStop(storage).reason, 'Paused', label);
        second.keeper.close();
        const model = analyst();
        const third = await opened(chat, model, { storage, clock, tabId: 'tab-3' });
        await third.keeper.tick();
        assert.equal(third.keeper.view().phase, 'Stopped', label);
        assert.equal(third.keeper.view().stop.reason, 'Paused', label);
        assert.equal(model.calls.length, 0, label);
    }
});

test('a pause is saved in every phase', async () => {
    /**
     * @param {FakeChat} chat
     * @param {FakeStorage} storage
     * @param {object} clock
     * @param {string} label
     * @return {Promise<void>}
     */
    const reloadNextDay = async (chat, storage, clock, label) => {
        clock.day = NEXT_DAY;
        const model = analyst();
        const again = await opened(chat, model, { storage, clock, tabId: `tab-${label}` });
        await again.keeper.tick();
        assert.equal(again.keeper.view().phase, 'Stopped', label);
        assert.equal(again.keeper.view().stop.reason, 'Paused', label);
        assert.equal(model.calls.length, 0, label);
        again.keeper.close();
    };

    const budgetChat = new FakeChat(100);
    const budgetStorage = new FakeStorage();
    const budget = await opened(budgetChat, analyst({ cost: 0.04 }), { storage: budgetStorage });
    await budget.keeper.adopt({ budget: 0.05 });
    assert.equal(budget.keeper.view().stop.reason, 'Budget');
    budget.keeper.pause();
    assert.equal(budget.keeper.view().stop.reason, 'Paused');
    assert.equal(savedStop(budgetStorage).reason, 'Paused');
    budget.keeper.close();
    await reloadNextDay(budgetChat, budgetStorage, budget.clock, 'budget');

    const opening = await adopted();
    opening.keeper.close();
    const release = opening.chat.hold('history');
    const loading = await opened(opening.chat, analyst(), { storage: opening.storage, clock: opening.clock, tabId: 'tab-2', wait: false });
    assert.equal(loading.keeper.view().phase, 'Loading');
    loading.keeper.pause();
    assert.equal(savedStop(opening.storage).reason, 'Paused');
    release();
    await until(() => loading.keeper.view().phase !== 'Loading');
    assert.equal(loading.keeper.view().phase, 'Stopped');
    assert.equal(loading.keeper.view().stop.reason, 'Paused');
    loading.keeper.close();
    await reloadNextDay(opening.chat, opening.storage, opening.clock, 'opening');

    const readingChat = new FakeChat(100);
    const readingStorage = new FakeStorage();
    const held = gate();
    const readingModel = analyst({
        /**
         * @param {{ marks: number[] }} call
         * @return {Promise<void>|null}
         */
        hold: (call) => (call.marks[0] === 41 ? held.promise : null),
    });
    const reading = await opened(readingChat, readingModel, { storage: readingStorage });
    const adopting = reading.keeper.adopt({});
    await until(() => readingModel.calls.length === 2);
    reading.keeper.pause();
    assert.equal(savedStop(readingStorage).reason, 'Paused');
    assert.equal(reading.keeper.view().stop.reason, 'Paused');
    held.release();
    await adopting;
    assert.equal(reading.keeper.view().stop.reason, 'Paused');
    reading.keeper.close();
    await reloadNextDay(readingChat, readingStorage, reading.clock, 'reading');

    const claimChat = new FakeChat(100);
    const claimStorage = new FakeStorage();
    const claimHeld = gate();
    let holding = true;
    const claimModel = analyst({
        /**
         * @param {{ marks: number[] }} call
         * @return {Promise<void>|null}
         */
        hold: (call) => (call.marks[0] === 41 ? claimHeld.promise : null),
    });
    const claimed = await opened(claimChat, claimModel, {
        storage: claimStorage,
        /**
         * @return {boolean}
         */
        claim: () => holding,
    });
    const claimAdopting = claimed.keeper.adopt({});
    await until(() => claimModel.calls.length === 2);
    claimed.keeper.pause();
    holding = false;
    await claimed.keeper.tick();
    assert.equal(claimed.keeper.view().phase, 'Watching');
    holding = true;
    await claimed.keeper.tick();
    claimHeld.release();
    await claimAdopting;
    await claimed.keeper.tick();
    assert.equal(claimed.keeper.view().phase, 'Stopped');
    assert.equal(claimed.keeper.view().stop.reason, 'Paused');
    assert.equal(claimModel.calls.length, 2);
    claimed.keeper.close();
    await reloadNextDay(claimChat, claimStorage, claimed.clock, 'claim');
});

test('a mismatch needs two whole pulls', async () => {
    const { chat, model, keeper, storage, clock } = await adopted({ conflict: true });
    await keeper.rule(PIN);
    const bookText = storedText(storage, BOOK);
    const campaignText = storedText(storage, CAMPAIGN);
    chat.strangers(40);
    await keeper.pull();
    let view = keeper.view();
    assert.equal(view.mismatch, false);
    assert.equal(view.problem, SUSPECT);
    await assert.rejects(keeper.adopt({}), { message: SUSPECT });
    await keeper.tick();
    assert.equal(model.calls.length, 3);
    await keeper.pull();
    view = keeper.view();
    assert.equal(view.mismatch, false);
    assert.equal(view.problem, null);
    assert.equal(storedText(storage, BOOK) === bookText, true);
    assert.equal(storedText(storage, CAMPAIGN) === campaignText, true);
    assert.equal(rulingsSaved(storage), 1);
    await keeper.tick();
    assert.equal(model.calls.length, 3);
    chat.strangers(40);
    await keeper.pull();
    assert.equal(keeper.view().mismatch, false);
    clock.time += MINUTE;
    chat.strangers(40);
    await keeper.pull();
    view = keeper.view();
    assert.equal(view.mismatch, true);
    assert.equal(view.problem, MISMATCH);
    await keeper.adopt({});
    assert.equal(savedIds(storage).every((id) => id.startsWith('OTHER-')), true);
    assert.equal(savedIds(storage).length, 40);
    assert.deepEqual(ranges(model).slice(3), ['Story 1-39']);
    assert.equal(keeper.view().read, 39);
});

test('a pull cut short is never a mismatch', async () => {
    const { chat, model, keeper, storage, clock } = await adopted({ conflict: true });
    await keeper.rule(PIN);
    chat.add(200);
    chat.cutShort('Failed', 62, 'Zeta answered HTTP 500');
    clock.time += MINUTE;
    await keeper.pull();
    const note = `${FAR}Zeta answered HTTP 500${FAR_AGAIN}`;
    let view = keeper.view();
    assert.equal(view.mismatch, false);
    assert.equal(view.problem, note);
    await assert.rejects(keeper.adopt({}), { message: note });
    assert.equal(savedReads(storage), 99);
    assert.equal(rulingsSaved(storage), 1);
    assert.equal(model.calls.length, 3);
    clock.time += MINUTE;
    await keeper.tick();
    view = keeper.view();
    assert.equal(view.total, 300);
    assert.equal(view.read, 299);
    assert.deepEqual(ranges(model).slice(3), ['Story 100-139', 'Story 140-179', 'Story 180-219', 'Story 220-259', 'Story 260-299']);
    assert.equal(rulingsSaved(storage), 1);
    assert.equal(keeper.view().state.conflicts.length, 0);
});

test('a failed history that joins is used', async () => {
    const { chat, model, keeper, clock } = await adopted({ count: 300 });
    chat.add(40);
    chat.cutAlways('Failed', 62, 'Zeta answered HTTP 500');
    clock.time += MINUTE;
    await keeper.tick();
    assert.deepEqual(ranges(model).slice(8), ['Story 300-339']);
    assert.equal(keeper.view().total, 340);
    assert.equal(keeper.view().problem, `${PART}Zeta answered HTTP 500${AGAIN}`);
    await keeper.resume();
    const pulls = chat.count('tab-1', 'history');
    await keeper.tick();
    assert.equal(chat.count('tab-1', 'history'), pulls);
    clock.time += MINUTE;
    await keeper.tick();
    assert.equal(chat.count('tab-1', 'history'), pulls + 1);
    clock.time += MINUTE;
    await keeper.tick();
    assert.equal(chat.count('tab-1', 'history'), pulls + 2);
});

test('an unreadable message is not a deleted one', async () => {
    const { chat, model, keeper, storage } = await adopted();
    chat.hide(85);
    await keeper.tick();
    assert.equal(savedIds(storage).includes('MESSAGE-85'), true);
    assert.equal(savedRead(storage, 'MESSAGE-85'), true);
    assert.equal(savedReads(storage), 99);
    assert.equal(keeper.view().problem, '1 message could not be read from the site.');
    await keeper.tick();
    assert.equal(model.calls.length, 3);
    assert.equal(keeper.view().read, 99);
    assert.equal(keeper.view().problem, null);
});

test('a hold says why and a clock set back does not stretch it', async () => {
    const { chat, keeper, clock } = await adopted();
    chat.add(41);
    await keeper.tick();
    assert.equal(keeper.view().problem, UNJOINED);
    await assert.rejects(keeper.resume(), { message: UNJOINED });
    const pulls = chat.count('tab-1', 'history');
    clock.time -= HOUR;
    await keeper.tick();
    assert.equal(chat.count('tab-1', 'history'), pulls + 1);
    assert.equal(keeper.view().total, 141);
    assert.equal(keeper.view().problem, null);
});

test('the view is never ahead of what is saved', async () => {
    const base = new FakeStorage();
    const wrapper = guarded(base);
    const opening = await adopted({
        storage: wrapper,
        /**
         * @param {{ marks: number[] }} call
         * @return {null}
         */
        hold: (call) => {
            if (call.marks[0] === 100) {
                wrapper.refuseGets(BOOK_HEAD, 1000);
            }
            return null;
        },
    });
    await grow(opening, 41);
    assert.equal(opening.keeper.view().problem, UNREAD_STORAGE);
    assert.equal(opening.keeper.view().read, 99);
    assert.equal(savedReads(base), 99);
});

test('a watcher is quiet when nothing changed', async () => {
    const first = await adopted({ conflict: true });
    const second = await opened(first.chat, analyst(), { storage: first.storage, clock: first.clock, tabId: 'tab-2' });
    second.events.length = 0;
    for (let turn = 0; turn < 5; turn++) {
        await second.keeper.tick();
    }
    assert.equal(second.events.length, 0);
    await first.keeper.rule(PIN);
    await second.keeper.tick();
    assert.equal(second.events.length, 1);
});

test('a preview carries its own before', async () => {
    const { keeper, storage } = await adopted();
    const anchor = { id: 'MESSAGE-12', position: 12 };
    const sets = storage.count('set');
    const shown = await keeper.preview(told([`Halvard | trait | ${OATH} | #12`]), anchor);
    const state = keeper.view().state;
    assert.equal(shown.before.revision, state.revision);
    assert.equal(shown.before.facts.length, state.facts.length);
    assert.equal(shown.before.subjects.length, state.subjects.length);
    assert.equal(shown.state.facts.length, shown.before.facts.length + 1);
    const refusedOnly = await keeper.preview(told(['Halvard | trait | keeps a second ledger | #90']), anchor);
    assert.equal(refusedOnly.state === refusedOnly.before, true);
    assert.equal(refusedOnly.refused.length, 1);
    const none = await keeper.preview([], anchor);
    assert.equal(none.state === none.before, true);
    assert.equal(storage.count('set'), sets);
});

test('the opening compares before it pulls', async () => {
    const { chat, keeper, storage, clock } = await adopted();
    storage.refuseSetsMatching(BOOK);
    chat.edit(90, 'The tale turns at the ford, line 90.');
    await keeper.tick();
    assert.equal(savedReads(storage), 99);
    keeper.close();
    storage.allow();
    chat.fail('history', new Error('Zeta could not be reached'));
    const again = await opened(chat, analyst(), { storage, clock, tabId: 'tab-2' });
    assert.equal(again.keeper.view().problem, 'Zeta could not be reached');
    assert.equal(savedReads(storage), 80);
});

test('the budget lifts only above it', async () => {
    const chat = new FakeChat(100);
    const model = analyst();
    const { keeper, events } = await opened(chat, model);
    await keeper.adopt({ budget: 0.02 });
    assert.equal(keeper.view().stop.reason, 'Budget');
    assert.equal(cents(keeper.view().spentToday), 2);
    events.length = 0;
    for (let turn = 0; turn < 4; turn++) {
        await keeper.tick();
    }
    assert.equal(events.length, 8);
    assert.equal(model.calls.length, 2);
});

test('what the view keeps is capped and kept', async () => {
    let refusals = 1;
    const model = analyst({
        /**
         * @param {{ marks: number[] }} call
         * @return {boolean}
         */
        unreadable: (call) => call.marks[0] === 3 && refusals-- > 0,
    });
    const { keeper } = await opened(new FakeChat(101), model);
    await keeper.adopt({ size: 2 });
    assert.equal(keeper.view().stop.reason, 'Failed');
    await keeper.resume();
    assert.equal(model.calls.length, 51);
    const view = keeper.view();
    assert.equal(view.calls.length, 20);
    assert.equal(view.calls.filter((item) => !item.readable).length, 1);
    assert.equal(view.calls.at(-1).readable, false);
    assert.equal(view.lines.length, 50);
});

test('absent is not changed', async () => {
    const { chat, model, keeper, storage, clock } = await adopted({ count: 300 });
    keeper.close();
    for (const name of [...storage.values.keys()]) {
        if (CAMPAIGN.test(name)) {
            storage.values.delete(name);
        }
    }
    chat.cutShort('Failed', 62, 'Zeta could not be reached');
    const again = await opened(chat, model, { storage, clock, tabId: 'tab-2' });
    await again.keeper.tick();
    clock.time += MINUTE;
    await again.keeper.tick();
    await again.keeper.tick();
    assert.equal(again.keeper.view().total, 300);
    assert.equal(model.calls.length, 8);
    assert.equal(savedReads(storage), 299);
});

test("the chat's start closes a run", async () => {
    const chat = new FakeChat(100);
    const model = analyst();
    const { keeper } = await opened(chat, model);
    await keeper.adopt({ size: 10 });
    assert.equal(model.calls.length, 10);
    await keeper.configure({ size: 40 });
    chat.edit(5, 'The tale turns at the well, line 5.');
    await keeper.pull();
    assert.equal(keeper.view().read, 89);
    await keeper.tick();
    assert.equal(ranges(model).at(-1), 'Story 1-10');
    assert.equal(keeper.view().read, 99);
});

test('an answer citing the last read message is filed', async () => {
    const { model, keeper } = await adopted({ asks: 99 });
    await keeper.rule({ type: 'Answer', question: 'Q1', text: 'The miller rang it' });
    await keeper.tick();
    assert.deepEqual(ranges(model).slice(3), ['Answers 99']);
    assert.equal(keeper.view().state.questions[0].dismissed, true);
    assert.equal(factsSaying(keeper, 'settled by the answers at line 99').length, 1);
});

test('a storage-caused stop is not saved and is retried', async () => {
    for (const reload of [true, false]) {
        const base = new FakeStorage();
        const wrapper = guarded(base);
        let armed = true;
        const opening = await adopted({
            storage: wrapper,
            /**
             * @param {{ marks: number[] }} call
             * @return {null}
             */
            hold: (call) => {
                if (call.marks[0] === 100 && armed) {
                    armed = false;
                    wrapper.refuseSets(BOOK_PART, 1);
                }
                return null;
            },
        });
        await grow(opening, 41);
        assert.equal(opening.keeper.view().stop.reason, 'Failed', String(reload));
        assert.equal(savedStop(base), null, String(reload));
        let keeper = opening.keeper;
        if (reload) {
            keeper.close();
            keeper = (await opened(opening.chat, opening.model, { storage: wrapper, clock: opening.clock, tabId: 'tab-2' })).keeper;
            assert.equal(keeper.view().stop, null);
        } else {
            opening.clock.time += MINUTE;
        }
        await keeper.tick();
        assert.equal(savedReads(base), 139, String(reload));
        assert.equal(keeper.view().phase, 'Idle', String(reload));
    }
});

test('a failed claim check is not a lost claim', async () => {
    const base = new FakeStorage();
    const wrapper = guarded(base);
    const opening = await adopted({
        storage: wrapper,
        /**
         * @param {{ marks: number[] }} call
         * @return {null}
         */
        hold: (call) => {
            if (call.marks[0] === 100) {
                wrapper.refuseGets(/^scribe:claim:/, 1);
            }
            return null;
        },
    });
    await grow(opening, 41);
    assert.equal(savedReads(base), 139);
    assert.equal(opening.keeper.view().reader, true);
    assert.equal(opening.model.calls.length, 4);
});

test('ids are compared as strings', async () => {
    const chat = new FakeChat(100);
    chat.numeric = true;
    const { keeper, storage } = await adopted({ chat });
    assert.equal(savedRead(storage, '20'), true);
    chat.edit(20, 'The tale turns another way, line 20.');
    await keeper.pull();
    assert.equal(savedRead(storage, '20'), false);
    assert.equal(savedRead(storage, '41'), true);
    assert.equal(savedReads(storage), 59);
});

test('a stale reader saves no campaign', async () => {
    const chat = new FakeChat(100);
    const storage = new FakeStorage();
    const clock = clockAt();
    const first = await opened(chat, analyst(), { storage, clock });
    await first.keeper.adopt({});
    clock.time += 120000;
    const second = await opened(chat, analyst(), { storage, clock, tabId: 'tab-2' });
    assert.equal(second.keeper.view().reader, true);
    chat.add(5);
    const writes = setsMatching(storage, CAMPAIGN);
    await first.keeper.pull();
    assert.equal(setsMatching(storage, CAMPAIGN), writes);
    assert.equal(first.keeper.view().phase, 'Watching');
});

test('one id twice in a pull', async () => {
    const chat = new FakeChat(100);
    chat.twice(50);
    const { keeper, storage } = await opened(chat, analyst());
    assert.equal(savedIds(storage).filter((id) => id === 'MESSAGE-50').length, 1);
    assert.equal(savedIds(storage).length, 100);
    assert.equal(keeper.view().total, 100);
});

test('only a pull that reached the start is whole', async () => {
    for (const end of ['RepeatedCursor', 'NothingNew']) {
        const { chat, model, keeper, storage, clock } = await adopted({ count: 300, conflict: true });
        await keeper.rule(PIN);
        const bookText = storedText(storage, BOOK);
        const campaignText = storedText(storage, CAMPAIGN);
        chat.add(200);
        chat.cutAlways(end, 93);
        for (let turn = 0; turn < 2; turn++) {
            clock.time += MINUTE;
            await keeper.tick();
        }
        const view = keeper.view();
        assert.equal(chat.count('tab-1', 'history'), 3, end);
        assert.equal(view.mismatch, false, end);
        assert.equal(view.problem, FAR_EARLY, end);
        await assert.rejects(keeper.adopt({}), { message: FAR_EARLY });
        assert.equal(storedText(storage, CAMPAIGN) === campaignText, true, end);
        assert.equal(storedText(storage, BOOK) === bookText, true, end);
        assert.equal(rulingsSaved(storage), 1, end);
        assert.equal(model.calls.length, 8, end);
    }

    const mixed = await adopted({ count: 300 });
    mixed.chat.add(200);
    mixed.chat.strangers(40);
    mixed.chat.cutShort('NothingNew', 93);
    mixed.clock.time += MINUTE;
    await mixed.keeper.tick();
    assert.equal(mixed.keeper.view().problem, SUSPECT);
    mixed.clock.time += MINUTE;
    await mixed.keeper.tick();
    assert.equal(mixed.chat.count('tab-1', 'history'), 3);
    assert.equal(mixed.keeper.view().mismatch, false);
    assert.equal(mixed.keeper.view().problem, FAR_EARLY);

    const confirmed = await adopted();
    const confirmedText = storedText(confirmed.storage, CAMPAIGN);
    confirmed.chat.strangers(40);
    await confirmed.keeper.pull();
    confirmed.clock.time += MINUTE;
    confirmed.chat.strangers(40);
    await confirmed.keeper.pull();
    assert.equal(confirmed.keeper.view().mismatch, true);
    confirmed.chat.add(200);
    confirmed.chat.cutShort('RepeatedCursor', 93);
    await confirmed.keeper.pull();
    await assert.rejects(confirmed.keeper.adopt({}), { message: FAR_EARLY });
    assert.equal(storedText(confirmed.storage, CAMPAIGN) === confirmedText, true);
    assert.equal(confirmed.model.calls.length, 3);
});

test('a second whole pull needs its minute', async () => {
    const { chat, keeper, clock } = await adopted();
    chat.strangers(40);
    chat.strangers(40);
    await keeper.pull();
    clock.time += 5000;
    await keeper.pull();
    assert.equal(keeper.view().mismatch, false);
    assert.equal(keeper.view().problem, SUSPECT);
    clock.time += MINUTE - 5000;
    chat.strangers(40);
    await keeper.pull();
    assert.equal(keeper.view().mismatch, true);
});

test('with no book any natural end starts one', async () => {
    const chat = new FakeChat(100);
    chat.cutShort('RepeatedCursor', 62);
    const model = analyst();
    const { keeper } = await opened(chat, model);
    assert.equal(keeper.view().total, 62);
    await keeper.adopt({});
    assert.equal(model.calls.length, 2);
    assert.equal(keeper.view().read, 61);

    const failed = new FakeChat(100);
    failed.cutShort('Failed', 62, 'Zeta could not be reached');
    const failedModel = analyst();
    const opening = await opened(failed, failedModel);
    await assert.rejects(opening.keeper.adopt({}), { message: UNREACHED });
    assert.equal(failedModel.calls.length, 0);
    assert.equal(savedBook(opening.storage), null);
});

test('resume keeps what was paid for', async () => {
    const base = new FakeStorage();
    const wrapper = guarded(base);
    let armed = true;
    const opening = await adopted({
        storage: wrapper,
        /**
         * @param {{ marks: number[] }} call
         * @return {null}
         */
        hold: (call) => {
            if (call.marks[0] === 100 && armed) {
                armed = false;
                wrapper.refuseSets(BOOK_PART, 1);
            }
            return null;
        },
    });
    await grow(opening, 41);
    assert.equal(opening.keeper.view().stop.reason, 'Failed');
    assert.equal(savedReads(base), 99);
    await opening.keeper.resume();
    assert.deepEqual(ranges(opening.model).slice(3), ['Story 100-139']);
    assert.equal(savedReads(base), 139);

    let refusals = 1;
    const unreadable = analyst({
        /**
         * @param {{ marks: number[] }} call
         * @return {boolean}
         */
        unreadable: (call) => call.marks[0] === 41 && refusals-- > 0,
    });
    const failing = await opened(new FakeChat(100), unreadable);
    await failing.keeper.adopt({});
    assert.equal(failing.keeper.view().stop.reason, 'Failed');
    assert.equal(unreadable.calls.length, 2);
    await failing.keeper.resume();
    assert.deepEqual(ranges(unreadable), ['Story 1-40', 'Story 41-80', 'Story 41-80', 'Story 81-99']);
    assert.equal(failing.keeper.view().read, 99);
});

test('a spending write that landed is not owed', async () => {
    const chat = new FakeChat(100);
    const storage = new FakeStorage();
    const model = analyst({ cost: 0.25 });
    const { keeper } = await opened(chat, model, { storage });
    storage.throwAfterSetsMatching(SPENT);
    await keeper.adopt({});
    await grow({ chat, keeper }, 41);
    assert.equal(model.calls.length, 4);
    assert.equal(cents(ScribeStore.spent(storage, ROOM, DAY)), 100);
    assert.equal(cents(keeper.view().spentToday), 100);
    storage.allow();
    await keeper.tick();
    assert.equal(cents(ScribeStore.spent(storage, ROOM, DAY)), 100);

    const refused = new FakeStorage();
    const refusedModel = analyst({ cost: 0.25 });
    const second = await opened(new FakeChat(100), refusedModel, { storage: refused });
    refused.refuseSetsMatching(SPENT);
    await second.keeper.adopt({});
    assert.equal(refusedModel.calls.length, 1);
    assert.equal(cents(ScribeStore.spent(refused, ROOM, DAY)), 0);
    assert.equal(cents(second.keeper.view().spentToday), 25);
    refused.allow();
    await second.keeper.tick();
    await second.keeper.tick();
    assert.equal(cents(ScribeStore.spent(refused, ROOM, DAY)), 25);
    assert.equal(cents(second.keeper.view().spentToday), 25);
});

test('a pause survives unreadable storage', async () => {
    const { chat, model, keeper, storage, clock } = await adopted();
    storage.refuseSetsMatching(/./);
    keeper.pause();
    assert.equal(keeper.view().stop.reason, 'Paused');
    assert.equal(keeper.view().phase, 'Stopped');
    await grow({ chat, keeper }, 41);
    for (let turn = 0; turn < 3; turn++) {
        clock.time += MINUTE;
        await keeper.tick();
    }
    assert.equal(model.calls.length, 3);
    assert.equal(keeper.view().stop.reason, 'Paused');
    assert.equal(savedStop(storage), null);
    storage.allow();
    await keeper.tick();
    assert.equal(savedStop(storage).reason, 'Paused');
    assert.equal(keeper.view().stop.reason, 'Paused');
    keeper.close();
    const later = analyst();
    const again = await opened(chat, later, { storage, clock, tabId: 'tab-2' });
    await again.keeper.tick();
    assert.equal(again.keeper.view().phase, 'Stopped');
    assert.equal(again.keeper.view().stop.reason, 'Paused');
    assert.equal(later.calls.length, 0);

    const first = await adopted();
    first.keeper.close();
    const wrapper = guarded(first.storage);
    wrapper.refuseGets(BOOK_HEAD, 1);
    const reopened = await opened(first.chat, analyst(), { storage: wrapper, clock: first.clock, tabId: 'tab-2' });
    assert.equal(reopened.keeper.view().problem, UNREAD_STORAGE);
    reopened.keeper.pause();
    assert.equal(reopened.keeper.view().stop.reason, 'Paused');
    await reopened.keeper.tick();
    assert.equal(reopened.keeper.view().problem, null);
    assert.equal(reopened.keeper.view().phase, 'Stopped');
    assert.equal(reopened.keeper.view().stop.reason, 'Paused');
    assert.equal(savedStop(first.storage).reason, 'Paused');
    reopened.keeper.close();
    first.chat.add(41);
    const last = analyst();
    const third = await opened(first.chat, last, { storage: first.storage, clock: first.clock, tabId: 'tab-3' });
    await third.keeper.tick();
    assert.equal(third.keeper.view().phase, 'Stopped');
    assert.equal(last.calls.length, 0);
});

test('a resume that cannot clear the stop does not read', async () => {
    const { chat, model, keeper, storage } = await adopted();
    keeper.pause();
    await grow({ chat, keeper }, 41);
    assert.equal(model.calls.length, 3);
    storage.refuseSetsMatching(SETTINGS);
    await assert.rejects(keeper.resume(), { message: SAVE_FAILED });
    assert.equal(model.calls.length, 3);
    assert.equal(savedStop(storage).reason, 'Paused');
    assert.equal(keeper.view().stop.reason, 'Paused');
    storage.allow();
    await keeper.resume();
    assert.equal(model.calls.length, 4);
    assert.equal(savedStop(storage), null);
});

test('a watcher notices an edited last message', async () => {
    const first = await adopted();
    const second = await opened(first.chat, analyst(), { storage: first.storage, clock: first.clock, tabId: 'tab-2' });
    for (const change of ['edit', 'regenerate']) {
        second.events.length = 0;
        if (change === 'edit') {
            first.chat.edit(100, 'The tale turns at the ford, line 100.');
        } else {
            first.chat.regenerate();
        }
        await first.keeper.tick();
        await second.keeper.tick();
        await second.keeper.tick();
        assert.equal(second.events.length, 1, change);
    }
});

test('nothing is paid while anything is owed', async () => {
    const chat = new FakeChat(100);
    const storage = new FakeStorage();
    const model = analyst({ cost: 0.05 });
    const { keeper, clock } = await opened(chat, model, { storage });
    const refusal = /^The storage refused to set scribe:spent:/;
    storage.refuseSetsMatching(SPENT);
    await keeper.adopt({});
    assert.equal(model.calls.length, 1);
    assert.equal(cents(keeper.view().spentToday), 5);
    clock.time += MINUTE;
    await keeper.tick();
    assert.equal(model.calls.length, 1);
    await assert.rejects(keeper.resume(), { message: refusal });
    await assert.rejects(keeper.adopt({}), { message: refusal });
    assert.equal(model.calls.length, 1);
    storage.allow();
    await keeper.tick();
    assert.equal(model.calls.length, 3);
    assert.equal(cents(ScribeStore.spent(storage, ROOM, DAY)), 15);
    assert.equal(keeper.view().read, 99);
});

test('owed spending of an earlier day is kept', async () => {
    for (const todayRecorded of [false, true]) {
        const label = String(todayRecorded);
        const storage = new FakeStorage();
        const model = analyst({ cost: 0.25 });
        const { keeper, clock } = await opened(new FakeChat(100), model, { storage });
        storage.refuseSetsMatching(SPENT);
        await keeper.adopt({});
        assert.equal(model.calls.length, 1, label);
        clock.day = NEXT_DAY;
        storage.allow();
        if (todayRecorded) {
            ScribeStore.spend(storage, ROOM, NEXT_DAY, 0.02);
        }
        await keeper.tick();
        assert.equal(cents(ScribeStore.spent(storage, ROOM, DAY)), todayRecorded ? 0 : 25, label);
        assert.equal(cents(ScribeStore.spent(storage, ROOM, NEXT_DAY)), todayRecorded ? 2 : 0, label);
        assert.equal(cents(keeper.view().spentToday), todayRecorded ? 2 : 0, label);
        assert.equal(keeper.view().problem, null, label);
    }
});

test('a stop is saved only by the reader', async () => {
    const chat = new FakeChat(100);
    const storage = new FakeStorage();
    const clock = clockAt();
    const held = gate();
    const model = analyst({
        /**
         * @param {{ marks: number[] }} call
         * @return {Promise<void>|null}
         */
        hold: (call) => (call.marks[0] === 41 ? held.promise : null),
        /**
         * @param {{ marks: number[] }} call
         * @return {boolean}
         */
        unreadable: (call) => call.marks[0] === 41,
    });
    const first = await opened(chat, model, { storage, clock });
    const adopting = first.keeper.adopt({});
    await until(() => model.calls.length === 2);
    clock.time += 120000;
    const second = await opened(chat, analyst(), { storage, clock, tabId: 'tab-2' });
    assert.equal(second.keeper.view().reader, true);
    second.keeper.pause();
    const writes = setsMatching(storage, SETTINGS);
    held.release();
    await adopting;
    assert.equal(setsMatching(storage, SETTINGS), writes);
    assert.equal(savedStop(storage).reason, 'Paused');
    assert.equal(first.keeper.view().phase, 'Watching');
});

test('a reading that ends after a pause keeps the pause', async () => {
    const chat = new FakeChat(100);
    const base = new FakeStorage();
    const wrapper = guarded(base);
    const held = gate();
    const model = analyst({
        /**
         * @param {{ marks: number[] }} call
         * @return {Promise<void>|null}
         */
        hold: (call) => (call.marks[0] === 41 ? held.promise : null),
    });
    const { keeper, clock } = await opened(chat, model, { storage: wrapper });
    const adopting = keeper.adopt({});
    await until(() => model.calls.length === 2);
    keeper.pause();
    wrapper.refuseSets(BOOK_PART, 1);
    held.release();
    await adopting;
    assert.equal(keeper.view().stop.reason, 'Paused');
    assert.equal(savedStop(base).reason, 'Paused');
    keeper.close();
    const later = analyst();
    const again = await opened(chat, later, { storage: base, clock, tabId: 'tab-2' });
    await again.keeper.tick();
    assert.equal(again.keeper.view().phase, 'Stopped');
    assert.equal(again.keeper.view().stop.reason, 'Paused');
    assert.equal(later.calls.length, 0);
});

test('a cut-short pull never feeds the suspicion', async () => {
    const { chat, keeper, clock } = await adopted();
    chat.add(200);
    chat.strangers(40);
    await keeper.pull();
    assert.equal(keeper.view().problem, SUSPECT);
    clock.time += MINUTE;
    chat.cutShort('Failed', 62, 'Zeta answered HTTP 500');
    await keeper.pull();
    assert.equal(keeper.view().mismatch, false);
    assert.equal(keeper.view().problem, `${FAR}Zeta answered HTTP 500${FAR_AGAIN}`);
    clock.time += MINUTE;
    chat.strangers(40);
    await keeper.pull();
    assert.equal(keeper.view().mismatch, true);
});

test('a skipped message removes nothing in a history pull either', async () => {
    const { chat, model, keeper, storage } = await adopted();
    const bookText = storedText(storage, BOOK);
    chat.hide(85);
    await keeper.pull();
    assert.equal(savedIds(storage).includes('MESSAGE-85'), true);
    assert.equal(savedRead(storage, 'MESSAGE-85'), true);
    assert.equal(storedText(storage, BOOK) === bookText, true);
    assert.equal(keeper.view().read, 99);
    assert.equal(keeper.view().problem, '1 message could not be read from the site.');
    assert.equal(model.calls.length, 3);
});

test('trusted says the book can be relied on', async () => {
    const chat = new FakeChat(100);
    const held = gate();
    const model = analyst({
        /**
         * @param {{ marks: number[] }} call
         * @return {Promise<void>|null}
         */
        hold: (call) => (call.marks[0] === 100 ? held.promise : null),
    });
    const opening = await opened(chat, model);
    assert.equal(opening.keeper.view().trusted, false, 'no book');
    await opening.keeper.adopt({});
    assert.equal(opening.keeper.view().phase, 'Idle');
    assert.equal(opening.keeper.view().trusted, true, 'idle');
    chat.add(30);
    await opening.keeper.tick();
    chat.add(11);
    const ticking = opening.keeper.tick();
    await until(() => model.calls.length === 4);
    assert.equal(opening.keeper.view().phase, 'Reading');
    assert.equal(opening.keeper.view().trusted, true, 'reading');
    held.release();
    await ticking;
    opening.keeper.pause();
    assert.equal(opening.keeper.view().stop.reason, 'Paused');
    assert.equal(opening.keeper.view().trusted, true, 'paused');

    const budgetChat = new FakeChat(100);
    const budget = await opened(budgetChat, analyst());
    await budget.keeper.adopt({ budget: 0.03 });
    assert.equal(budget.keeper.view().phase, 'Idle');
    await grow({ chat: budgetChat, keeper: budget.keeper }, 41);
    assert.equal(budget.keeper.view().stop.reason, 'Budget');
    assert.equal(budget.keeper.view().trusted, true, 'budget');

    const joined = await adopted();
    joined.chat.add(40);
    joined.chat.cutAlways('Failed', 62, 'Zeta answered HTTP 500');
    joined.clock.time += MINUTE;
    await joined.keeper.tick();
    assert.equal(joined.keeper.view().read, 139);
    assert.equal(joined.keeper.view().trusted, true, 'a failed history that joins');
    const watcher = await opened(joined.chat, analyst(), { storage: joined.storage, clock: joined.clock, tabId: 'tab-2' });
    assert.equal(watcher.keeper.view().phase, 'Watching');
    assert.equal(watcher.keeper.view().trusted, false, 'watching');

    const spoiled = await adopted();
    spoiled.keeper.close();
    const book = savedBook(spoiled.storage);
    delete book.fingerprints;
    ScribeStore.write(spoiled.storage, ROOM, ScribeStore.Kind.Book, book);
    const damaged = await opened(spoiled.chat, analyst(), { storage: spoiled.storage, clock: spoiled.clock, tabId: 'tab-2' });
    assert.equal(damaged.keeper.view().problem, DAMAGED);
    assert.equal(damaged.keeper.view().trusted, false, 'damaged');

    const closed = await adopted();
    closed.keeper.close();
    const unreadWrapper = guarded(closed.storage);
    unreadWrapper.refuseGets(BOOK_HEAD, 1);
    const unread = await opened(closed.chat, analyst(), { storage: unreadWrapper, clock: closed.clock, tabId: 'tab-2' });
    assert.equal(unread.keeper.view().problem, UNREAD_STORAGE);
    assert.equal(unread.keeper.view().trusted, false, 'storage unread at open');

    const base = new FakeStorage();
    const reloadWrapper = guarded(base);
    const reloading = await adopted({
        storage: reloadWrapper,
        /**
         * @param {{ marks: number[] }} call
         * @return {null}
         */
        hold: (call) => {
            if (call.marks[0] === 100) {
                reloadWrapper.refuseGets(BOOK_HEAD, 1000);
            }
            return null;
        },
    });
    await grow(reloading, 41);
    assert.equal(reloading.keeper.view().problem, UNREAD_STORAGE);
    assert.equal(reloading.keeper.view().reader, true);
    assert.equal(reloading.keeper.view().trusted, false, 'a failed reload');

    const strange = await adopted();
    strange.chat.strangers(40);
    await strange.keeper.pull();
    assert.equal(strange.keeper.view().problem, SUSPECT);
    assert.equal(strange.keeper.view().trusted, false, 'suspect');
    strange.clock.time += MINUTE;
    strange.chat.strangers(40);
    await strange.keeper.pull();
    assert.equal(strange.keeper.view().mismatch, true);
    assert.equal(strange.keeper.view().trusted, false, 'mismatch');

    const hidden = await adopted();
    hidden.chat.strangers(40);
    await hidden.keeper.pull();
    hidden.chat.fail('history', new Error('Zeta could not be reached'));
    hidden.clock.time += MINUTE;
    await hidden.keeper.tick();
    assert.equal(hidden.keeper.view().problem, 'Zeta could not be reached');
    assert.equal(hidden.keeper.view().trusted, false, 'a hold behind another problem');

    const absent = await adopted();
    absent.keeper.close();
    for (const name of [...absent.storage.values.keys()]) {
        if (CAMPAIGN.test(name)) {
            absent.storage.values.delete(name);
        }
    }
    absent.chat.fail('history', new Error('Zeta could not be reached'));
    const blank = await opened(absent.chat, analyst(), { storage: absent.storage, clock: absent.clock, tabId: 'tab-2' });
    assert.equal(blank.keeper.view().problem, 'Zeta could not be reached');
    assert.equal(blank.keeper.view().trusted, false, 'nothing pulled');

    const apart = await adopted();
    apart.chat.add(200);
    for (const [end, problem] of [
        ['Failed', 'Zeta answered HTTP 500'],
        ['RepeatedCursor', null],
    ]) {
        apart.chat.cutShort(end, 93, problem);
        await apart.keeper.pull();
        assert.equal(apart.keeper.view().problem.startsWith(FAR), true, end);
        assert.equal(apart.keeper.view().trusted, false, end);
    }

    const unjoined = await adopted();
    unjoined.chat.add(41);
    await unjoined.keeper.tick();
    assert.equal(unjoined.keeper.view().problem, UNJOINED);
    assert.equal(unjoined.keeper.view().trusted, false, 'the newest page not joining');
});

test('the edition names the book', async () => {
    const chat = new FakeChat(41);
    const storage = new FakeStorage();
    const clock = clockAt();
    let holding = true;
    const model = analyst({ conflict: true });
    const { keeper } = await opened(chat, model, {
        storage,
        clock,
        /**
         * @return {boolean}
         */
        claim: () => holding,
    });
    assert.equal(keeper.view().edition, 0, 'no book');
    await keeper.adopt({});
    assert.equal(keeper.view().read, 40);
    assert.equal(keeper.view().edition, 1, 'the first adopt');
    const watcher = await opened(chat, analyst(), {
        storage,
        clock,
        tabId: 'tab-2',
        /**
         * @return {boolean}
         */
        claim: () => false,
    });
    assert.equal(watcher.keeper.view().phase, 'Watching');
    assert.equal(watcher.keeper.view().edition, 1, 'a watching tab');
    await keeper.rule(PIN);
    assert.equal(keeper.view().edition, 1, 'a ruling');
    await keeper.configure({ size: 40 });
    assert.equal(keeper.view().edition, 1, 'the settings');
    await watcher.keeper.tick();
    assert.equal(watcher.keeper.view().edition, 1, 'the settings, in a watching tab');
    model.broken = 'No key';
    chat.edit(20, 'The tale turns another way, line 20.');
    await keeper.tick();
    assert.equal(keeper.view().read, 0);
    assert.equal(keeper.view().edition, 1, 'a withdrawn stretch');
    model.broken = null;
    await keeper.resume();
    assert.equal(keeper.view().read, 40);
    assert.equal(keeper.view().edition, 1, 'a reading');
    keeper.pause();
    assert.equal(keeper.view().edition, 1, 'a pause');
    holding = false;
    await keeper.tick();
    assert.equal(keeper.view().phase, 'Watching');
    assert.equal(keeper.view().edition, 1, 'a lost claim');
    holding = true;
    await keeper.tick();
    assert.equal(keeper.view().reader, true);
    assert.equal(keeper.view().edition, 1, 'a regained claim');
    keeper.close();
    const reloaded = await opened(chat, analyst(), { storage, clock, tabId: 'tab-3' });
    assert.equal(reloaded.keeper.view().edition, 1, 'a reload');
    reloaded.keeper.close();
    const wrapper = guarded(storage);
    wrapper.refuseGets(BOOK_HEAD, 1);
    const unreadable = await opened(chat, analyst(), { storage: wrapper, clock, tabId: 'tab-4' });
    assert.equal(unreadable.keeper.view().problem, UNREAD_STORAGE);
    assert.equal(unreadable.keeper.view().edition, 1, 'a reload while the book cannot be read');
    await unreadable.keeper.tick();
    await unreadable.keeper.adopt({});
    assert.equal(unreadable.keeper.view().edition, 2, 'started over');
    await watcher.keeper.tick();
    assert.equal(watcher.keeper.view().edition, 2, 'a watching tab after the start over');
    storage.refuseSetsMatching(BOOK);
    await assert.rejects(unreadable.keeper.adopt({}), { message: UNCONFIRMED });
    assert.equal(unreadable.keeper.view().edition, 2, 'a start over that failed');
    storage.allow();
    await watcher.keeper.tick();
    assert.equal(watcher.keeper.view().edition, 2, 'a start over that failed, in a watching tab');

    const strange = await adopted();
    strange.chat.strangers(40);
    await strange.keeper.pull();
    strange.clock.time += MINUTE;
    strange.chat.strangers(40);
    await strange.keeper.pull();
    assert.equal(strange.keeper.view().mismatch, true);
    strange.storage.refuseSetsMatching(CAMPAIGN);
    await assert.rejects(strange.keeper.adopt({}), { message: SAVE_FAILED });
    strange.storage.allow();
    assert.equal(strange.keeper.view().edition, 1, 'a mismatch start over that failed');
    const looking = await opened(strange.chat, analyst(), { storage: strange.storage, clock: strange.clock, tabId: 'tab-2' });
    assert.equal(looking.keeper.view().edition, 1, 'a mismatch start over that failed, in a watching tab');
    await strange.keeper.adopt({});
    assert.equal(strange.keeper.view().edition, 2, 'a mismatch start over');

    const single = await adopted({ count: 1 });
    const beside = await opened(single.chat, analyst(), { storage: single.storage, clock: single.clock, tabId: 'tab-2' });
    beside.events.length = 0;
    await single.keeper.adopt({});
    await beside.keeper.tick();
    assert.equal(beside.keeper.view().edition, 2, 'a start over with nothing to read');
    assert.equal(beside.events.length, 1, 'a watching tab is told of a new edition');
});

test('a book is trusted once it was read', async () => {
    const chat = new FakeChat(100);
    const storage = new FakeStorage();
    const clock = clockAt();
    let held = gate();
    let holdAt = 1;
    const model = analyst({
        /**
         * @param {{ marks: number[] }} call
         * @return {Promise<void>|null}
         */
        hold: (call) => (call.marks[0] === holdAt ? held.promise : null),
    });
    const first = await opened(chat, model, { storage, clock });
    const adopting = first.keeper.adopt({ budget: 0.02 });
    await until(() => model.calls.length === 1);
    assert.equal(first.keeper.view().phase, 'Reading');
    assert.equal(first.keeper.view().edition, 1);
    assert.equal(first.keeper.view().trusted, false, 'the first stretch');
    held.release();
    await adopting;
    assert.equal(first.keeper.view().stop.reason, 'Budget');
    assert.equal(first.keeper.view().read, 80);
    assert.equal(first.keeper.view().trusted, false, 'stopped for the budget');
    first.keeper.pause();
    assert.equal(first.keeper.view().stop.reason, 'Paused');
    assert.equal(first.keeper.view().trusted, false, 'paused');
    first.keeper.close();
    const second = await opened(chat, model, { storage, clock, tabId: 'tab-2' });
    assert.equal(second.keeper.view().phase, 'Stopped');
    assert.equal(second.keeper.view().read, 80);
    assert.equal(second.keeper.view().trusted, false, 'a reload');
    await second.keeper.configure({ budget: 3 });
    holdAt = 81;
    held = gate();
    const resuming = second.keeper.resume();
    await until(() => model.calls.length === 3);
    assert.equal(second.keeper.view().phase, 'Reading');
    assert.equal(second.keeper.view().trusted, false, 'resumed');
    held.release();
    await resuming;
    assert.equal(second.keeper.view().phase, 'Idle');
    assert.equal(second.keeper.view().read, 99);
    assert.equal(second.keeper.view().trusted, true, 'read');
    holdAt = 1;
    held = gate();
    const restarting = second.keeper.adopt({});
    await until(() => model.calls.length === 4);
    assert.equal(second.keeper.view().edition, 2);
    assert.equal(second.keeper.view().trusted, false, 'started over');
    held.release();
    await restarting;
    assert.equal(second.keeper.view().read, 99);
    assert.equal(second.keeper.view().trusted, true, 'read again');
});

test('the view shows what storage holds for the day', async () => {
    const base = new FakeStorage();
    const wrapper = guarded(base);
    const { keeper } = await adopted({ storage: wrapper });
    assert.equal(cents(keeper.view().spentToday), 3);
    const before = keeper.view().problem;
    ScribeStore.spend(base, ROOM, DAY, 0.25);
    assert.equal(cents(keeper.view().spentToday), 28, 'written by someone else');
    ScribeStore.spend(base, ROOM, DAY, 0.5);
    wrapper.refuseGets(SPENT, 1);
    const refused = keeper.view();
    assert.equal(cents(refused.spentToday), 28, 'the read refused');
    assert.equal(refused.problem, before, 'the read refused');
    assert.equal(keeper.view().problem, before, 'after the refused read');
    assert.equal(cents(keeper.view().spentToday), 78, 'the read works again');
});

test('the view says when the step began', async () => {
    const { chat, keeper: first, storage, clock } = await adopted();
    assert.equal(first.view().flight, null);
    assert.equal(first.view().began, null);
    first.close();
    chat.add(5);
    const release = chat.hold('history');
    const { keeper } = await opened(chat, analyst(), { storage, clock, tabId: 'tab-2', wait: false });
    assert.equal(keeper.view().flight, 'Pulling the chat: 0 messages');
    assert.equal(keeper.view().began, START);
    clock.time = START + 9000;
    assert.equal(keeper.view().began, START);
    release();
    await until(() => keeper.view().phase !== 'Loading');
    assert.equal(keeper.view().began, null);
    keeper.close();

    const chatTwo = new FakeChat(100);
    const opening = gate();
    const second = gate();
    const model = analyst({
        /**
         * @param {{ marks: number[] }} call
         * @return {Promise<void>|null}
         */
        hold: (call) => {
            if (call.marks[0] === 1) {
                return opening.promise;
            }
            return call.marks[0] === 41 ? second.promise : null;
        },
    });
    const readClock = clockAt();
    const reading = await opened(chatTwo, model, { clock: readClock });
    assert.equal(reading.keeper.view().began, null);
    const adopting = reading.keeper.adopt({});
    await until(() => model.calls.length === 1);
    assert.equal(reading.keeper.view().began, START);
    readClock.time = START + 120000;
    opening.release();
    await until(() => model.calls.length === 2);
    assert.equal(reading.keeper.view().began, START + 120000);
    readClock.time = START + 300000;
    second.release();
    await adopting;
    assert.equal(reading.keeper.view().flight, null);
    assert.equal(reading.keeper.view().began, null);
});

/**
 * @param {object} keeper
 * @param {FakeStorage} storage
 * @return {string|null}
 */
function blockOf(keeper, storage) {
    const writes = () => JSON.stringify(storage.calls.filter((call) => call.operation !== 'get'));
    const stored = () => JSON.stringify([...storage.values.entries()]);
    const before = { writes: writes(), stored: stored(), view: JSON.stringify(keeper.view()) };
    const block = keeper.view().adoptBlock;
    assert.equal(writes(), before.writes);
    assert.equal(stored(), before.stored);
    assert.equal(JSON.stringify(keeper.view()), before.view);
    return block;
}

test('a mismatch whose pull was cut short is not replaced, and blocked and adopt agree', async () => {
    const mismatched = await adopted();
    mismatched.chat.renameAll('OTHER');
    for (let turn = 0; turn < 2; turn++) {
        mismatched.clock.time += MINUTE;
        await mismatched.keeper.tick();
    }
    assert.equal(mismatched.keeper.view().mismatch, true);
    mismatched.chat.cutShort('Failed', 20, 'Zeta could not be reached');
    mismatched.clock.time += MINUTE;
    await mismatched.keeper.tick();
    const block = blockOf(mismatched.keeper, mismatched.storage);
    assert.equal(block, `${FAR}Zeta could not be reached${FAR_AGAIN}`);
    await assert.rejects(mismatched.keeper.adopt({}), { message: block });
});

test('the keeper tells when it starts and stops being busy, and not when nothing changed', async () => {
    const seen = [];
    const busies = [];
    const holder = { keeper: null };
    const chat = new FakeChat(100);
    const { keeper, clock } = await opened(chat, analyst(), {
        onNotify: () => {
            if (holder.keeper !== null) {
                seen.push(holder.keeper.view().adoptBlock);
                busies.push(holder.keeper.view().busy);
            }
        },
    });
    holder.keeper = keeper;
    assert.equal(keeper.view().adoptBlock, null);
    assert.equal(keeper.view().busy, null);
    seen.length = 0;
    busies.length = 0;
    clock.time += MINUTE;
    await keeper.tick();
    assert.deepEqual(seen, [null, null]);
    assert.deepEqual(busies, ['Looking', null]);
    seen.length = 0;
    const release = chat.hold('history');
    const pulling = keeper.pull();
    await until(() => seen.length >= 1);
    assert.equal(seen[0], PULLING);
    release();
    await pulling;
    assert.equal(seen.at(-1), null);
    assert.equal(keeper.view().adoptBlock, null);
});

test('adoptBlock names what adopt would refuse and changes nothing', async () => {
    const refusal = /^The storage refused to set scribe:spent:/;
    const early = new FakeChat(10);
    early.fail('history', new Error('No login seen yet'));
    const blank = await opened(early, analyst());
    assert.equal(blockOf(blank.keeper, blank.storage), NOTHING_PULLED);
    await assert.rejects(blank.keeper.adopt({}), { message: NOTHING_PULLED });

    const cut = new FakeChat(300);
    cut.cutShort('Failed', 62, 'Zeta could not be reached');
    const partial = await opened(cut, analyst());
    assert.equal(blockOf(partial.keeper, partial.storage), UNREACHED);
    await assert.rejects(partial.keeper.adopt({}), { message: UNREACHED });

    const suspect = await adopted();
    suspect.chat.renameAll('OTHER');
    suspect.clock.time += MINUTE;
    await suspect.keeper.tick();
    assert.equal(blockOf(suspect.keeper, suspect.storage), SUSPECT);
    await assert.rejects(suspect.keeper.adopt({}), { message: SUSPECT });

    const replacing = await adopted();
    replacing.chat.renameAll('OTHER');
    replacing.clock.time += MINUTE;
    await replacing.keeper.tick();
    replacing.clock.time += MINUTE;
    await replacing.keeper.tick();
    assert.equal(replacing.keeper.view().mismatch, true);
    assert.equal(blockOf(replacing.keeper, replacing.storage), null);
    await replacing.keeper.adopt({});
    assert.equal(replacing.keeper.view().mismatch, false);

    const unjoined = await adopted();
    unjoined.chat.add(41);
    await unjoined.keeper.tick();
    assert.equal(blockOf(unjoined.keeper, unjoined.storage), UNJOINED);
    await assert.rejects(unjoined.keeper.adopt({}), { message: UNJOINED });

    const disorder = new FakeChat(100);
    disorder.retime(50, FakeChat.time(10));
    const unsettled = await opened(disorder, analyst());
    assert.equal(blockOf(unsettled.keeper, unsettled.storage), DISORDER);
    await assert.rejects(unsettled.keeper.adopt({}), { message: DISORDER });

    const first = await adopted();
    const second = await opened(first.chat, analyst(), { storage: first.storage, clock: first.clock, tabId: 'tab-2' });
    assert.equal(blockOf(second.keeper, second.storage), WATCHING);
    await assert.rejects(second.keeper.adopt({}), { message: WATCHING });

    const closing = await adopted();
    closing.keeper.close();
    const closed = blockOf(closing.keeper, closing.storage);
    assert.equal(closed, 'This chat has been closed');
    await assert.rejects(closing.keeper.adopt({}), { message: closed });

    const ready = await opened(new FakeChat(100), analyst());
    assert.equal(blockOf(ready.keeper, ready.storage), null);
    await ready.keeper.adopt({});
    assert.equal(ready.keeper.view().read, 99);

    const pullChat = new FakeChat(100);
    const pulling = await opened(pullChat, analyst());
    const release = pullChat.hold('history');
    const pull = pulling.keeper.pull();
    await until(() => pullChat.count('tab-1', 'history') === 2);
    assert.equal(blockOf(pulling.keeper, pulling.storage), PULLING);
    await assert.rejects(pulling.keeper.adopt({}), { message: PULLING });
    release();
    await pull;
    assert.equal(blockOf(pulling.keeper, pulling.storage), null);

    const held = gate();
    const slow = analyst({ hold: () => held.promise });
    const reading = await opened(new FakeChat(100), slow);
    const adopting = reading.keeper.adopt({});
    await until(() => slow.calls.length === 1);
    assert.equal(blockOf(reading.keeper, reading.storage), READING);
    await assert.rejects(reading.keeper.adopt({}), { message: READING });
    held.release();
    await adopting;

    let claimed = true;
    const claiming = await opened(new FakeChat(100), analyst(), { claim: () => claimed });
    assert.equal(blockOf(claiming.keeper, claiming.storage), null);
    claimed = false;
    assert.equal(blockOf(claiming.keeper, claiming.storage), WATCHING);
    assert.equal(claiming.keeper.view().reader, true);
    await assert.rejects(claiming.keeper.adopt({}), { message: WATCHING });

    let failing = false;
    const unreadable = await opened(new FakeChat(100), analyst(), {
        claim: () => {
            if (failing) {
                throw new Error('The claim could not be read');
            }
            return true;
        },
    });
    failing = true;
    assert.equal(blockOf(unreadable.keeper, unreadable.storage), 'The claim could not be read');
    assert.equal(unreadable.keeper.view().reader, true);

    const owing = new FakeStorage();
    const paying = await opened(new FakeChat(100), analyst({ cost: 0.05 }), { storage: owing });
    owing.refuseSetsMatching(SPENT);
    await paying.keeper.adopt({});
    paying.clock.time += MINUTE;
    await paying.keeper.tick();
    const owed = blockOf(paying.keeper, owing);
    assert.match(owed, refusal);
    await assert.rejects(paying.keeper.adopt({}), { message: owed });
    owing.allow();
    assert.match(blockOf(paying.keeper, owing), refusal);
    await paying.keeper.tick();
    assert.equal(blockOf(paying.keeper, owing), null);
    await paying.keeper.adopt({});
});

test('a step that reads a stretch tells 6 times and never shows the keeper idle while it reads', async () => {
    const holder = { keeper: null };
    const tells = [];
    const chat = new FakeChat(13);
    const { keeper, clock } = await adopted({
        chat,
        onNotify: () => {
            if (holder.keeper !== null) {
                const view = holder.keeper.view();
                tells.push({ phase: view.phase, busy: view.busy, flying: view.flight !== null });
            }
        },
    });
    holder.keeper = keeper;
    chat.add(20);
    clock.time += MINUTE;
    await keeper.tick();
    chat.add(20);
    tells.length = 0;
    clock.time += MINUTE;
    await keeper.tick();
    assert.equal(keeper.view().read, 52);
    assert.equal(tells.length, 6);
    assert.deepEqual(
        tells.filter((tell) => tell.phase === 'Reading' && tell.busy === null),
        [],
    );
    assert.deepEqual(tells.at(-1), { phase: 'Idle', busy: null, flying: false });
});

test('a poll that turns into a whole pull tells Looking, then Pulling, then Reading, then nothing', async () => {
    const holder = { keeper: null };
    const tells = [];
    const chat = new FakeChat(100);
    const { keeper, clock } = await adopted({
        chat,
        onNotify: () => {
            if (holder.keeper !== null) {
                const view = holder.keeper.view();
                tells.push({ busy: view.busy, block: view.adoptBlock });
            }
        },
    });
    holder.keeper = keeper;
    chat.add(40);
    const release = chat.hold('history');
    tells.length = 0;
    clock.time += MINUTE;
    const ticking = keeper.tick();
    await until(() => chat.count('tab-1', 'history') === 2);
    assert.equal(keeper.view().busy, 'Pulling');
    assert.equal(keeper.view().adoptBlock, PULLING);
    release();
    await ticking;
    const busies = tells.map((tell) => tell.busy).filter((busy, index, all) => index === 0 || busy !== all[index - 1]);
    assert.deepEqual(busies, ['Looking', 'Pulling', 'Reading', null]);
    assert.equal(
        tells.filter((tell) => tell.busy === 'Pulling').every((tell) => tell.block === PULLING),
        true,
    );
    assert.equal(keeper.view().adoptBlock, null);
});

test('a routine poll says Looking and never Pulling', async () => {
    const chat = new FakeChat(100);
    const { keeper, clock } = await adopted({ chat });
    const release = chat.hold('newest');
    clock.time += MINUTE;
    const ticking = keeper.tick();
    await until(() => keeper.view().busy !== null);
    assert.equal(keeper.view().adoptBlock, null);
    assert.equal(keeper.view().busy, 'Looking');
    await assert.rejects(keeper.adopt({}), { message: PULLING });
    release();
    await ticking;
    assert.equal(keeper.view().busy, null);
});
