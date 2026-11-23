import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import FakeZeta from './support/FakeZeta.mjs';

/**
 * @param {string} name
 * @return {object}
 */
function load(name) {
    const context = vm.createContext({ URL, URLSearchParams, TextDecoder });
    const url = new URL(`../scribe/page/${name}.js`, import.meta.url);
    vm.runInContext(readFileSync(url, 'utf8'), context, { filename: url.pathname });
    return vm.runInContext(name, context);
}

const ZetaSource = load('ZetaSource');

const TOKEN = FakeZeta.Token;
const SECRET = 'zeta-test-7f3a9c';
const API = 'https://api.zeta-ai.io';
const MESSAGES = `${API}/v1/rooms/abc/messages`;
const FIRST_PAGE = `${MESSAGES}?limit=31`;
const TIMEOUT = ZetaSource.Settings.TimeoutMs;
const END = ZetaSource.End;
const SHAPE = 'Zeta answered in an unexpected shape';
const NO_PAUSE = 'Could not pause between requests';
const LATE = 'Zeta did not answer in time';

/**
 * @param {string} name
 * @return {string}
 */
function bearer(name) {
    return `Bearer ${name}-0123456789abcdef`;
}

/**
 * @param {Iterable<{ id: string }>} list
 * @return {string[]}
 */
function ids(list) {
    return Array.from(list, (message) => message.id);
}

/**
 * @return {Promise<void>}
 */
function settle() {
    return new Promise((resolve) => setImmediate(resolve));
}

/**
 * @return {Promise<void>}
 */
function never() {
    return new Promise(() => {});
}

/**
 * @param {number} milliseconds
 * @return {Promise<void>}
 */
function rest(milliseconds) {
    return milliseconds === TIMEOUT ? never() : Promise.resolve();
}

/**
 * @return {{ pause: (milliseconds: number) => Promise<void>, paused: number[] }}
 */
function recorder() {
    const paused = [];
    /**
     * @param {number} milliseconds
     * @return {Promise<void>}
     */
    const pause = (milliseconds) => {
        if (milliseconds === TIMEOUT) {
            return never();
        }
        paused.push(milliseconds);
        return Promise.resolve();
    };
    return { pause, paused };
}

/**
 * @return {{ promise: Promise<*>, resolve: Function, reject: Function }}
 */
function deferred() {
    let resolve = null;
    let reject = null;
    const promise = new Promise((resolved, rejected) => {
        resolve = resolved;
        reject = rejected;
    });
    return { promise, resolve, reject };
}

/**
 * @param {Promise<*>} promise
 * @return {Promise<Error>}
 */
async function failureOf(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new assert.AssertionError({ message: 'expected the call to throw' });
}

/**
 * @param {Error} error
 * @return {boolean}
 */
function carriesToken(error) {
    const texts = [String(error)];
    for (const name of Object.getOwnPropertyNames(error)) {
        texts.push(String(error[name]));
    }
    return texts.some((text) => text.includes(SECRET) || text.includes(TOKEN));
}

/**
 * @param {string} url
 * @return {string|null}
 */
function cursorOf(url) {
    return new URL(url).searchParams.get('cursor');
}

/**
 * @param {string} id
 * @param {number} minute
 * @param {string} text
 * @return {object}
 */
function said(id, minute = 1, text = 'A line of the tale.') {
    return FakeZeta.message(id, FakeZeta.time(minute), text);
}

/**
 * @param {Function} fetch
 * @param {object} extra
 * @return {Promise<object>}
 */
function walk(fetch, extra = {}) {
    return ZetaSource.history({ fetch, token: TOKEN, roomId: FakeZeta.Room, pause: rest, ...extra });
}

/**
 * @param {Function} fetch
 * @param {object} extra
 * @return {Promise<object>}
 */
function latest(fetch, extra = {}) {
    return ZetaSource.newest({ fetch, token: TOKEN, roomId: FakeZeta.Room, pause: rest, ...extra });
}

/**
 * @return {{ seen: string[], stop: () => void }}
 */
function rejections() {
    const seen = [];
    /**
     * @param {*} reason
     * @return {void}
     */
    const listener = (reason) => {
        seen.push(String(reason?.message ?? reason));
    };
    process.on('unhandledRejection', listener);
    return {
        seen,
        /**
         * @return {void}
         */
        stop: () => {
            process.off('unhandledRejection', listener);
        },
    };
}

/**
 * @param {*} root
 * @param {object} target
 * @param {number} depth
 * @return {boolean}
 */
function reaches(root, target, depth) {
    if (root === target) {
        return true;
    }
    if (depth === 0 || root === null || (typeof root !== 'object' && typeof root !== 'function')) {
        return false;
    }
    const tag = Object.prototype.toString.call(root);
    let children = [];
    if (tag === '[object Map]') {
        children = [...root.keys(), ...root.values()];
    } else if (tag === '[object Set]' || Array.isArray(root)) {
        children = [...root];
    } else {
        children = Object.getOwnPropertyNames(root).map((name) => Object.getOwnPropertyDescriptor(root, name).value);
    }
    return children.some((child) => reaches(child, target, depth - 1));
}

test('the room is read from the address', () => {
    assert.equal(ZetaSource.room('/rooms/abc'), 'abc');
    assert.equal(ZetaSource.room('/rooms/abc/extra'), 'abc');
    assert.equal(ZetaSource.room('/rooms/abc/'), 'abc');
    assert.equal(ZetaSource.room('/en/rooms/abc'), 'abc');
    assert.equal(ZetaSource.room('/zh-TW/rooms/abc/extra'), 'abc');
    assert.equal(ZetaSource.room('/rooms/caf%C3%A9%20one'), 'café one');
    assert.equal(ZetaSource.room('/rooms/a%2Fb'), 'a/b');
    assert.equal(ZetaSource.room('/rooms/a+b&c=d'), 'a+b&c=d');
    for (const path of ['/', '', '/rooms', '/rooms/', '/rooms//abc', '/roomsabc', '/characters/abc', '/characters/rooms/abc', '/rooms/%E0%A4%A']) {
        assert.equal(ZetaSource.room(path), null, path);
    }
});

test('Pause aborts a held history fetch, page delay and error retry before another request leaves', async () => {
    for (const held of ['fetch', 'cursor', 'retry']) {
        const controller = new AbortController();
        const waiting = deferred();
        const requests = [];
        const fetch = async (url, init) => {
            requests.push(url);
            assert.equal(init.signal, controller.signal);
            if (held === 'fetch') {
                waiting.resolve();
                return never();
            }
            return held === 'retry' ? FakeZeta.reply(429, '') : FakeZeta.page([said('new')], 'older');
        };
        const pause = (ms) => {
            if (ms !== TIMEOUT) {
                waiting.resolve();
            }
            return never();
        };
        const result = walk(fetch, { pause, signal: controller.signal });
        await waiting.promise;
        controller.abort();
        await assert.rejects(result, { name: 'AbortError' });
        assert.equal(requests.length, 1);
        await assert.rejects(walk(fetch, { pause, signal: controller.signal }), { name: 'AbortError' });
        assert.equal(requests.length, 1);
    }
});

test('native fetch and XHR deliver room-scoped final rows, including a swiped message, without consuming the response', async () => {
    const page = FakeZeta.window();
    const watcher = ZetaSource.watch(page);
    const reports = [];
    const traffic = [];
    watcher.onTraffic((event) => traffic.push(event));
    const notice = deferred();
    watcher.onMessages((room) => (received) => {
        assert.equal(room, 'abc');
        reports.push(received);
        notice.resolve();
    });
    const row = (id, minute, text) => ({ ...said(id, minute), contents: [{ type: 'TEXT', text }], roomId: 'abc' });
    const first = row('first', 1, 'They enter.');
    const latest = row('last', 2, 'They wait.');
    const body = JSON.stringify({ messages: [latest, first], nextCursor: null });
    const response = new Response(body);
    Object.defineProperty(response, 'url', { value: FIRST_PAGE });
    page.answer = () => Promise.resolve(response);
    assert.equal(await (await page.fetch(FIRST_PAGE)).text(), body);
    await notice.promise;
    assert.deepEqual(ids(reports[0].messages), ['first', 'last']);
    assert.equal(reports[0].head, true);
    assert.equal(reports[0].complete, true);
    const deliver = (url, payload, status = 200, finalUrl = url, method = 'GET') => {
        const xhr = new page.XMLHttpRequest();
        xhr.open(method, url);
        xhr.send();
        Object.assign(xhr, { status, responseType: 'json', responseURL: finalUrl, response: payload });
        xhr.finish();
    };
    const changed = row('last', 2, 'They fly.');
    deliver(MESSAGES + '/last', changed);
    assert.deepEqual(JSON.parse(JSON.stringify(reports[1].messages[0])), changed);
    assert.equal(reports[1].head, false);
    assert.equal(reports[1].complete, false);
    deliver(FIRST_PAGE + '&cursor=older', { messages: [first], nextCursor: null });
    assert.equal(reports[2].head, false);
    assert.equal(reports[2].complete, false);
    deliver(API + '/v1/rooms/abc', { id: 'abc', lastMessage: changed });
    assert.equal(reports[3].messages[0].contents[0].text, 'They fly.');
    deliver(API + '/v1/rooms/abc', { id: 'other', lastMessage: changed });
    deliver(MESSAGES + '/last', { ...changed, roomId: 'other' });
    deliver(MESSAGES + '/last', { ...changed, id: 'other' });
    deliver(MESSAGES + '/last', { id: 'last', text: 'partial' });
    deliver(FIRST_PAGE, { messages: [first, {}], nextCursor: null });
    deliver(MESSAGES + '/last', changed, 504);
    deliver(MESSAGES + '/last', changed, 200, 'https://example.org/sign-in');
    assert.equal(reports.length, 4);
    assert.deepEqual(traffic, []);
    deliver(MESSAGES + '/last', changed, 200, MESSAGES + '/last', 'PATCH');
    assert.equal(reports[4].messages[0].contents[0].text, 'They fly.');
    assert.equal(reports[4].created, undefined);
    deliver(MESSAGES, changed, 201, MESSAGES, 'POST');
    assert.equal(reports[5].created, true);
    deliver(MESSAGES + '/last', {}, 200, MESSAGES + '/last', 'PATCH');
    assert.equal(reports.length, 6);
    deliver(MESSAGES + '/last', { result: changed });
    assert.equal(reports[6].messages[0].contents[0].text, 'They fly.');
    deliver(MESSAGES + '/last', { first: latest, second: changed });
    assert.equal(reports.length, 7);
    deliver(FIRST_PAGE, { messages: [changed, first, first], nextCursor: null });
    assert.equal(reports[7].head, true);
    assert.equal(reports[7].complete, false);
    assert.equal(reports[7].ambiguous, true);
    assert.deepEqual(ids(reports[7].messages), ['first', 'last']);
    watcher.stop();
});

test('saved history rejoins a fresh suffix and verifies distant evidence after a multi-page append', async () => {
    const api = new FakeZeta(FakeZeta.messages(1022));
    api.most = 100;
    const emptyIndex = () => ({ locations: new Map(), boundaries: new Map() });
    let hints;
    const { messages: saved } = await walk(api.fetch, { index: emptyIndex(), remember: (value) => { hints = value; } });
    const before = api.requests.length;
    const latestIndex = emptyIndex();
    const warm = await walk(api.fetch, { index: latestIndex, saved, hints });
    assert.equal(api.requests.length - before, 1);
    assert.equal(warm.observed.length, 31);
    assert.deepEqual(ids(warm.messages), ids(saved));
    assert.equal(hints.pages.length, 33);
    assert.equal(Object.hasOwn(hints, 'transport'), false);
    const legacy = await walk(api.fetch, { index: emptyIndex(), saved });
    assert.equal(api.requests.length - before, 2);
    assert.equal(legacy.observed.length, 31);
    api.messages[1018] = { ...api.messages[1018], edited: true };
    api.messages.push(...Array.from({ length: 70 }, (_, number) => said('append' + number, 1023 + number)));
    const index = emptyIndex();
    const extended = await walk(api.fetch, { index, saved, hints });
    assert.equal(api.requests.length - before, 5);
    assert.equal(extended.observed.length, 93);
    assert.equal(extended.messages[1018].edited, true);
    assert.deepEqual(ids(extended.messages), ids(api.messages));
    api.messages[0] = { ...api.messages[0], edited: true };
    const prior = api.requests.length;
    const verified = await latest(api.fetch, { index, through: saved[0].id, required: [saved[0].id], known: extended.messages });
    assert.ok(api.requests.length - prior <= 5);
    assert.equal(verified.verified.find((row) => row.id === saved[0].id).edited, true);
});

for (const [removed, added, requests] of [[1, 1, 1], [40, 62, 3], [5, 30, 2]]) {
    test('a changed saved tip rejoins the observed suffix: ' + removed + ' replaced by ' + added, async () => {
        const api = new FakeZeta(FakeZeta.messages(1034));
        api.most = 150;
        const index = () => ({ locations: new Map(), boundaries: new Map() });
        let hints;
        const remember = (value) => { hints = value; };
        const { messages: saved } = await walk(api.fetch, { index: index(), remember });
        const previous = api.requests.length;
        const newer = Array.from({ length: added }, (_, number) => said('new-' + number, 1035 + number));
        api.messages.splice(-removed, removed, ...newer);
        const edited = api.messages.at(-added - 1);
        edited.edited = true;
        const active = index();
        const current = await walk(api.fetch, { saved, hints, index: active, remember });
        assert.equal(api.requests.length - previous, requests);
        assert.deepEqual(ids(current.messages), ids(api.messages));
        assert.equal(current.observed.length, requests * 31);
        assert.equal(current.observed[0].id, api.messages.at(-requests * 31).id);
        assert.ok(current.messages.find((row) => row.id === edited.id).edited);
        const reopened = index();
        const reload = await walk(api.fetch, { saved: current.messages, hints, index: reopened });
        assert.equal(api.requests.length - previous, requests + 1);
        assert.deepEqual(ids(reload.messages), ids(api.messages));
        api.messages[0].edited = true;
        const probe = await latest(api.fetch, { index: reopened, known: reload.messages, through: saved[0].id, required: [saved[0].id] });
        assert.ok(probe.verified.some((row) => row.id === saved[0].id && row.edited));
        assert.ok(api.requests.length - previous <= requests + 5);
    });
}

test('a deleted tip reuses the saved prefix only after the authenticated room and a full aligned head agree', async () => {
    const saved = FakeZeta.messages(1034);
    const api = new FakeZeta(saved.slice(0, -1));
    const index = () => ({ locations: new Map(), boundaries: new Map() });
    const result = await walk(api.fetch, { index: index(), saved });
    assert.deepEqual(ids(result.messages), ids(api.messages));
    assert.equal(result.observed.length, 31);
    assert.equal(api.requests.length, 2);
    assert.match(api.requests[1].url, /\/rooms\/abc$/);
    const fresh = await walk(api.fetch, { index: index(), saved: result.messages });
    assert.equal(api.requests.length, 3);
    assert.deepEqual(ids(fresh.messages), ids(api.messages));
    assert.equal(api.requests[1].options.headers.Authorization, TOKEN);
    for (const wrong of [{ id: 'another', lastMessage: { id: api.messages.at(-1).id } }, { id: 'abc', lastMessage: saved.at(-1) },
        {id: 'abc'}, {id: 'abc', lastMessage: null}, {}, null]) {
        const stale = FakeZeta.scripted([FakeZeta.page(api.messages.slice(-31).reverse(), 'next'), FakeZeta.reply(200, JSON.stringify(wrong))]);
        const uncertain = await walk(stale.fetch, { index: index(), saved });
        assert.equal(uncertain.end, END.Failed);
        assert.equal(uncertain.observed, undefined);
        assert.equal(stale.requests.length, 2);
    }
});

test('multiple edits and insertions in the newest page rejoin below the changed rows', async () => {
    for (const mode of ['replacements', 'insertion', 'deletion']) {
        const api = new FakeZeta(FakeZeta.messages(1034));
        api.most = 40;
        const saved = api.messages.slice();
        if (mode === 'replacements') {
            for (const offset of [1030, 1033]) {
                api.messages[offset] = { ...api.messages[offset], id: 'changed-' + offset };
            }
        } else if (mode === 'insertion') {
            api.messages.splice(1031, 0, { ...api.messages[1030], id: 'inserted', messageTime: '2026-01-01T17:11:30.000Z' });
        } else {
            api.messages.splice(1030, 1);
        }
        const result = await walk(api.fetch, { saved, index: { locations: new Map(), boundaries: new Map() } });
        assert.equal(api.requests.length, 1, mode);
        assert.deepEqual(ids(result.messages), ids(api.messages), mode);
        assert.equal(result.observed.length, 31, mode);
    }
});

test('a changed tip waits for corroboration and keeps ambiguous or failed pages out of the fast join', async () => {
    const saved = FakeZeta.messages(100);
    const head = said('new', 101);
    for (const rows of [[head, saved[97]], [head, head, saved[97], saved[96]], [saved[97], saved[96]],
        [head, saved[97], saved[95]], [head, saved[95], saved[97], saved[94], saved[93]]]) {
        const api = FakeZeta.scripted([FakeZeta.page(rows, 'next'), FakeZeta.reply(400, 'Expired cursor')]);
        const result = await walk(api.fetch, { saved, index: { locations: new Map(), boundaries: new Map() } });
        assert.equal(result.end, END.Failed);
        assert.equal(result.observed, undefined);
        assert.equal(result.completeHistory, undefined);
    }
});

test('an undersized first page sets a conservative known cheap depth even without saved page hints', async () => {
    const records = FakeZeta.messages(25);
    const api = new FakeZeta(records);
    api.perPage = 5;
    for (const hints of [null, { pages: [] }]) {
        const index = { locations: new Map(), boundaries: new Map() };
        const refreshed = await walk(api.fetch, { index, saved: records, hints });
        assert.equal(refreshed.observed.length, 5);
        assert.equal(index.cheapDepth, 5);
    }
});

test('an empty page with a continuation never certifies a saved-room repair', async () => {
    const saved = FakeZeta.messages(100);
    for (const prefix of [[], [FakeZeta.page(saved.slice(63, 93).reverse(), 'next')]]) {
        const api = FakeZeta.scripted([...prefix, FakeZeta.page([], 'more')]);
        const result = await walk(api.fetch, { index: { locations: new Map(), boundaries: new Map() }, saved });
        assert.match(result.problem, /empty history page/);
        assert.equal(result.completeHistory, undefined);
        assert.equal(result.observed, undefined);
    }
});

test('observed room cursors re-fetch distant sources, including edits, without traversing the intervening pages', async () => {
    const api = new FakeZeta(FakeZeta.messages(1022));
    api.most = 80;
    const index = { locations: new Map(), boundaries: new Map() };
    const { messages: known } = await walk(api.fetch, { index });
    assert.equal(api.requests.length, 33);
    const required = [known[0].id, known[500].id, known.at(-1).id];
    api.messages[500] = { ...api.messages[500], edited: true };
    const read = () => latest(api.fetch, { index, required, through: required[0], known });
    let page = await read();
    assert.equal(api.requests.length, 36);
    assert.equal(page.end, END.ThroughMessage);
    assert.equal(page.verified.find((row) => row.id === known[500].id).edited, true);
    assert.equal(page.verified.some((row) => row.id === known[300].id), false);
    api.messages.push(said('new-reply', 1023));
    page = await read();
    assert.equal(page.messages.at(-1).id, 'new-reply');
    assert.ok(api.requests.length <= 40);
    assert.ok(page.verified.some((row) => row.id === known[0].id));
    const reordered = api.messages[500];
    api.messages[500] = api.messages[501];
    api.messages[501] = reordered;
    assert.equal((await read()).needsHistory, true);
});

test('an unchanged transport page remains verifiable when timestamps put rows in a different order', async () => {
    const rows = FakeZeta.messages(1022);
    [rows[7].messageTime, rows[8].messageTime] = [rows[8].messageTime, rows[7].messageTime];
    const api = new FakeZeta(rows);
    api.most = 80;
    const index = { locations: new Map(), boundaries: new Map() };
    const { messages: known } = await walk(api.fetch, { index });
    assert.equal(known[7].id, rows[8].id);
    const through = rows[4].id;
    for (let attempt = 1; attempt <= 3; attempt++) {
        const page = await latest(api.fetch, { index, known, through, required: [through] });
        assert.equal(page.end, END.ThroughMessage);
        assert.ok(page.verified.some((row) => row.id === through));
        assert.equal(api.requests.length, 33 + 2 * attempt);
    }
    [rows[7], rows[8]] = [rows[8], rows[7]];
    assert.equal((await latest(api.fetch, { index, known, through, required: [through] })).needsHistory, true);
});

test('an expired historical checkpoint requests a fresh index and the next verification stays bounded', async () => {
    const api = new FakeZeta(FakeZeta.messages(372));
    api.most = 60;
    const index = { locations: new Map(), boundaries: new Map() };
    const { messages: known } = await walk(api.fetch, { index });
    const through = known[4].id;
    const stale = index.locations.get(through);
    const expired = (url, options) => new URL(url).searchParams.get('cursor') === stale
        ? Promise.resolve(FakeZeta.reply(410, 'Gone')) : api.fetch(url, options);
    const verify = (fetch) => latest(fetch, { index, known, through, required: [through] });
    assert.equal((await verify(expired)).needsHistory, true);
    await walk(api.fetch, { index });
    const before = api.requests.length;
    assert.ok((await verify(api.fetch)).verified.some((row) => row.id === through));
    assert.equal(api.requests.length - before, 2);
});

test('snapshot-bound cursors switch to the current listing and stop once every requested source is fresh', async () => {
    const api = new FakeZeta(FakeZeta.messages(372));
    api.most = 100;
    let snapshot = 0;
    let expired = 0;
    const fetch = async (url, options) => {
        const address = new URL(url);
        const cursor = address.searchParams.get('cursor');
        if (cursor === null) {
            snapshot++;
        } else {
            const [generation, token] = cursor.split(':');
            if (generation !== String(snapshot)) {
                expired++;
                return FakeZeta.reply(410, 'Gone');
            }
            address.searchParams.set('cursor', token);
        }
        const response = await api.fetch(address.href, options);
        const data = JSON.parse(await response.text());
        return FakeZeta.page(data.messages, data.nextCursor && snapshot + ':' + data.nextCursor);
    };
    const index = { locations: new Map(), boundaries: new Map() };
    const { messages: known } = await walk(fetch, { index });
    const through = known[330].id;
    const verify = () => latest(fetch, { index, known, through, required: [through] });
    const before = api.requests.length;
    for (let check = 0; check < 3; check++) {
        const page = await verify();
        assert.equal(page.end, END.ThroughMessage);
        assert.ok(page.verified.some((row) => row.id === through));
        assert.equal(page.messages.at(-1).id, known.at(-1).id);
    }
    assert.equal(api.requests.length - before, 6);
    assert.equal(expired, 2);
});

test('a background check reserves only a deep expired-link walk and can recover indexed verification', async () => {
    const api = new FakeZeta(FakeZeta.messages(1022));
    api.most = 250;
    const index = { locations: new Map(), boundaries: new Map() };
    const { messages: known } = await walk(api.fetch, { index });
    const last = known.at(-1).id;
    const old = known[1].id;
    const near = known.at(-32).id;
    let reserved = 0;
    const check = { previouslyLimited: true, reserve: () => ++reserved === 1 };
    const verify = async (id, expired) => {
        const stale = index.locations.get(id);
        let refused = false;
        const fetch = (url, options) => {
            if (expired && !refused && new URL(url).searchParams.get('cursor') === stale) {
                refused = true;
                return Promise.resolve(FakeZeta.reply(410, 'Gone'));
            }
            return api.fetch(url, options);
        };
        return latest(fetch, { index, known, through: id, required: [id], check });
    };
    assert.equal((await verify(old, true)).messages.length, 1022);
    const before = api.requests.length;
    assert.equal((await verify(old, true)).deferredCheck, true);
    assert.equal(api.requests.length - before, 2);
    assert.ok((await verify(last, false)).messages.some((row) => row.id === last));
    assert.ok((await verify(near, true)).messages.some((row) => row.id === near));
    assert.equal(reserved, 2);
    const restored = await verify(old, false);
    assert.ok(restored.verified.some((row) => row.id === old));
    assert.equal(reserved, 2);
    assert.equal((await verify(old, true)).needsHistory, true);
    assert.equal(reserved, 2);
});

for (const duplicate of [9, 961]) {
    test('duplicate #' + duplicate + ' preserves the full listing’s first observation during indexed verification', async () => {
        const rows = FakeZeta.messages(1022);
        const index = { locations: new Map(), boundaries: new Map() };
        const current = rows[duplicate - 1];
        const shadow = FakeZeta.message(current.id, current.messageTime, 'Outdated duplicate');
        rows.splice(duplicate - 1, 0, shadow);
        const api = new FakeZeta(rows);
        api.most = 90;
        const { messages: known } = await walk(api.fetch, { index });
        assert.equal(known.length, 1022);
        assert.equal(known[duplicate - 1].contents[0].text, current.contents[0].text);
        shadow.contents[0].text = 'A different outdated duplicate';
        current.contents[0].text = 'Revised first observation';
        const expected = (await walk(api.fetch)).messages.find((row) => row.id === current.id);
        const before = api.requests.length;
        for (const through of [known[duplicate - 2].id, current.id]) {
            const page = await latest(api.fetch, { index, known, required: [through], through });
            assert.equal(page.end, END.ThroughMessage);
            const seen = page.verified.find((row) => row.id === current.id);
            if (through === current.id || seen) {
                assert.deepEqual(seen, expected);
            }
        }
        assert.equal(api.requests.length - before, 4);
    });
}

test('the whole history comes in order', async () => {
    const messages = FakeZeta.messages(100);
    messages[9].messageTime = FakeZeta.time(500);
    const api = new FakeZeta(messages);
    const counts = [];
    let timers = 0;
    /**
     * @param {number} milliseconds
     * @return {Promise<void>}
     */
    const pause = (milliseconds) => {
        if (milliseconds === TIMEOUT) {
            timers += 1;
            return never();
        }
        api.events.push(`pause ${milliseconds}`);
        return new Promise((resolve) => {
            setImmediate(() => {
                api.events.push('resumed');
                resolve();
            });
        });
    };
    const result = await ZetaSource.history({
        fetch: api.fetch,
        token: TOKEN,
        roomId: FakeZeta.Room,
        pause,
        onPage: (count) => counts.push(count),
    });
    const expected = ids(messages).filter((id) => id !== 'm010');
    expected.push('m010');
    assert.deepEqual(ids(result.messages), expected);
    assert.equal(result.messages.length, 100);
    assert.equal(result.end, END.NoCursor);
    assert.equal(result.problem, null);
    assert.equal(result.skipped, 0);
    assert.deepEqual(counts, [31, 62, 93, 100]);
    assert.deepEqual(api.events, ['fetch', 'pause 500', 'resumed', 'fetch', 'pause 500', 'resumed', 'fetch', 'pause 500', 'resumed', 'fetch']);
    assert.equal(timers, 4);
    assert.equal(api.requests.length, 4);
    assert.equal(api.requests[0].url, FIRST_PAGE);
    assert.equal(api.requests[1].url, `${FIRST_PAGE}&cursor=older%2B31%2F%3D`);
    assert.deepEqual(
        api.requests.map((request) => cursorOf(request.url)),
        [null, FakeZeta.cursorAt(31), FakeZeta.cursorAt(62), FakeZeta.cursorAt(93)],
    );
    for (const request of api.requests) {
        assert.equal(new URL(request.url).searchParams.get('limit'), '31');
        assert.equal(request.url.startsWith(FIRST_PAGE), true);
        assert.equal(request.receiver === undefined, true);
        assert.deepEqual(Object.keys(request.options), ['headers']);
        assert.deepEqual(Object.keys(request.options.headers), ['Authorization']);
        assert.equal(request.options.headers.Authorization, TOKEN);
    }
    const quiet = new FakeZeta(FakeZeta.messages(100));
    const throwing = await walk(quiet.fetch, {
        onPage: () => {
            throw new Error('the progress line broke');
        },
    });
    assert.equal(throwing.messages.length, 100);
    assert.equal(quiet.requests.length, 4);
});

test('a repeated cursor ends the walk', async () => {
    const messages = FakeZeta.messages(100);
    const api = new FakeZeta(messages);
    api.repeat = 'again';
    const { pause, paused } = recorder();
    const result = await walk(api.fetch, { pause });
    assert.equal(api.requests.length, 2);
    assert.deepEqual(
        api.requests.map((request) => cursorOf(request.url)),
        [null, 'again'],
    );
    assert.equal(result.end, END.RepeatedCursor);
    assert.deepEqual(ids(result.messages), ids(messages.slice(38)));
    assert.deepEqual(paused, [500]);
    const cycling = FakeZeta.scripted([
        FakeZeta.page([said('c3', 3)], 'one'),
        FakeZeta.page([said('c2', 2)], 'two'),
        FakeZeta.page([said('c1', 1)], 'one'),
    ]);
    const cycled = await walk(cycling.fetch);
    assert.equal(cycling.requests.length, 3);
    assert.equal(cycled.end, END.RepeatedCursor);
    assert.deepEqual(ids(cycled.messages), ['c1', 'c2', 'c3']);
});

test('an empty page ends the walk', async () => {
    const messages = FakeZeta.messages(40);
    const api = new FakeZeta(messages);
    api.endless = true;
    const counts = [];
    const result = await walk(api.fetch, { onPage: (count) => counts.push(count) });
    assert.equal(api.requests.length, 3);
    assert.equal(result.end, END.EmptyPage);
    assert.deepEqual(ids(result.messages), ids(messages));
    assert.deepEqual(counts, [31, 40, 40]);
    const empty = new FakeZeta([]);
    empty.endless = true;
    const { pause, paused } = recorder();
    const nothing = await walk(empty.fetch, { pause });
    assert.equal(nothing.messages.length, 0);
    assert.equal(nothing.end, END.EmptyPage);
    assert.equal(empty.requests.length, 1);
    assert.deepEqual(paused, []);
    for (const ending of [null, '', undefined]) {
        const ended = FakeZeta.scripted([FakeZeta.page([said('e1')], ending)]);
        const result = await walk(ended.fetch);
        assert.deepEqual(ids(result.messages), ['e1']);
        assert.equal(result.end, END.NoCursor);
        assert.equal(ended.requests.length, 1);
    }
});

test('duplicates across pages are kept once', async () => {
    const { fetch, requests } = FakeZeta.scripted([
        FakeZeta.page([said('d4', 4, 'four'), said('d3', 3, 'three as first seen')], 'p2'),
        FakeZeta.page([said('d3', 3, 'three seen again'), said('d2', 2, 'two as first seen')], 'p3'),
        FakeZeta.page([said('d2', 2, 'two seen again'), said('d1', 1, 'one')], null),
    ]);
    const counts = [];
    const result = await walk(fetch, { onPage: (count) => counts.push(count) });
    assert.equal(requests.length, 3);
    assert.deepEqual(ids(result.messages), ['d1', 'd2', 'd3', 'd4']);
    assert.deepEqual(
        Array.from(result.messages, (message) => message.contents[0].text),
        ['one', 'two as first seen', 'three as first seen', 'four'],
    );
    assert.deepEqual(counts, [2, 3, 4]);
});

test('equal times keep their order', async () => {
    const { fetch } = FakeZeta.scripted([
        FakeZeta.page([said('q6', 3), said('q5', 2), said('q4', 2)], 'p2'),
        FakeZeta.page([said('q3', 2), said('q2', 1), said('q1', 1)], null),
    ]);
    assert.deepEqual(ids((await walk(fetch)).messages), ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']);
    const single = FakeZeta.scripted([FakeZeta.page([said('s3', 2), said('s2', 2), said('s1', 1)], 'more')]);
    assert.deepEqual(ids((await latest(single.fetch)).messages), ['s1', 's2', 's3']);
});

test('failures say what and never the token', async () => {
    const cases = [
        { answers: [FakeZeta.reply(401, `Token ${TOKEN} is not valid`)], message: 'Zeta answered HTTP 401', status: 401, requests: 1 },
        { answers: [FakeZeta.reply(500, 'Server error'), FakeZeta.reply(500, 'Server error'), FakeZeta.reply(500, 'Server error')], message: 'Zeta answered HTTP 500', status: 500, requests: 3 },
        { answers: [FakeZeta.reply(200, `<html>${TOKEN}</html>`)], message: SHAPE, status: 200, requests: 1 },
        { answers: [FakeZeta.reply(200, JSON.stringify({ items: [], token: TOKEN }))], message: SHAPE, status: 200, requests: 1 },
        { answers: [FakeZeta.reply(200, JSON.stringify({ messages: { id: 'x' } }))], message: SHAPE, status: 200, requests: 1 },
        { answers: [FakeZeta.reply(200, JSON.stringify({ messages: [{ messageTime: FakeZeta.time(1) }] }))], message: SHAPE, status: 200, requests: 1 },
        { answers: [FakeZeta.reply(200, JSON.stringify({ messages: [null] }))], message: SHAPE, status: 200, requests: 1 },
        {
            answers: [new Error(`connection refused for ${TOKEN}`), new Error(`connection refused for ${TOKEN}`), new Error(`connection refused for ${TOKEN}`)],
            message: 'Zeta could not be reached',
            status: null,
            requests: 3,
        },
    ];
    for (const reading of ['history', 'newest']) {
        for (const failing of cases) {
            const { fetch, requests } = FakeZeta.scripted(failing.answers);
            const error = await failureOf(ZetaSource[reading]({ fetch, token: TOKEN, roomId: FakeZeta.Room, pause: rest }));
            assert.equal(Object.prototype.toString.call(error), '[object Error]');
            assert.equal(error.message, failing.message, `${reading} ${failing.message}`);
            assert.equal(error.status, failing.status);
            assert.equal('cause' in error, false);
            assert.equal(carriesToken(error), false, `${reading} ${failing.message}`);
            assert.equal(requests.length, failing.requests, `${reading} ${failing.message}`);
        }
        const missing = [
            [{ token: undefined }, 'No login seen yet'],
            [{ token: null }, 'No login seen yet'],
            [{ token: '' }, 'No login seen yet'],
            [{ roomId: undefined }, 'No chat is open'],
            [{ roomId: null }, 'No chat is open'],
            [{ roomId: '' }, 'No chat is open'],
        ];
        for (const [extra, message] of missing) {
            const { fetch, requests } = FakeZeta.scripted([FakeZeta.page([], null)]);
            const request = { fetch, token: TOKEN, roomId: FakeZeta.Room, pause: rest, ...extra };
            const error = await failureOf(ZetaSource[reading](request));
            assert.equal(error.message, message);
            assert.equal(requests.length, 0);
        }
    }
});

test('the newest page alone', async () => {
    const messages = FakeZeta.messages(100);
    const api = new FakeZeta(messages);
    const result = await latest(api.fetch);
    assert.equal(api.requests.length, 1);
    assert.equal(api.requests[0].url, FIRST_PAGE);
    assert.equal(api.requests[0].receiver === undefined, true);
    assert.deepEqual(Object.keys(api.requests[0].options.headers), ['Authorization']);
    assert.equal(api.requests[0].options.headers.Authorization, TOKEN);
    assert.deepEqual(ids(result.messages), ids(messages.slice(69)));
    assert.equal(result.end, END.NoCursor);
    const empty = new FakeZeta([]);
    assert.equal((await latest(empty.fetch)).end, END.EmptyPage);
    const odd = new FakeZeta(FakeZeta.messages(3), 'a b/c');
    const oddResult = await latest(odd.fetch, { roomId: 'a b/c' });
    assert.equal(odd.requests[0].url, `${API}/v1/rooms/a%20b%2Fc/messages?limit=31`);
    assert.deepEqual(ids(oddResult.messages), ['m001', 'm002', 'm003']);
    const refused = FakeZeta.scripted([FakeZeta.reply(403, 'Forbidden')]);
    const error = await failureOf(latest(refused.fetch));
    assert.equal(error.message, 'Zeta answered HTTP 403');
    assert.equal(error.status, 403);
});

test('a boundary refresh follows only the cursors needed for the next stretch', async () => {
    const messages = FakeZeta.messages(100);
    for (const [through, pages] of [['m099', 1], ['m040', 2]]) {
        const api = new FakeZeta(messages);
        const result = await latest(api.fetch, { through });
        assert.deepEqual(api.requests.map((request) => cursorOf(request.url)), [null, FakeZeta.cursorAt(31)].slice(0, pages));
        assert.equal(result.end, END.ThroughMessage);
        assert.deepEqual(ids(result.messages), ids(messages.slice(-31 * pages)));
    }
});

test('a target search proves the complete history only when it actually reaches the start', async () => {
    const messages = FakeZeta.messages(100);
    const reached = await latest(new FakeZeta(messages).fetch, { through: 'missing-at-start' });
    assert.equal(reached.completeHistory, true);
    assert.deepEqual(ids(reached.messages), ids(messages));
    const bounded = await latest(new FakeZeta(messages).fetch, { through: 'm040' });
    assert.equal(bounded.completeHistory, undefined);
    const recent = await latest(new FakeZeta(messages).fetch);
    assert.equal(recent.completeHistory, undefined);
});

test('the status-only watcher reads only the room and HTTP result for player message POSTs', async () => {
    const page = FakeZeta.window();
    const headerSetter = page.XMLHttpRequest.prototype.setRequestHeader;
    const watcher = ZetaSource.watch(page, undefined, false);
    assert.equal(page.XMLHttpRequest.prototype.setRequestHeader, headerSetter);
    const attempts = [];
    watcher.onPost((room) => {
        const outcomes = [];
        attempts.push({ room, outcomes });
        return (status) => outcomes.push(status);
    });
    const reads = [];
    const privateField = () => { reads.push('private'); throw new Error('private field'); };
    const init = { method: 'POST', get headers() { return privateField(); }, get body() { return privateField(); } };
    const response = { status: 401, get headers() { return privateField(); }, get text() { return privateField(); } };
    const pending = deferred();
    page.answer = () => pending.promise;
    assert.equal(page.fetch(MESSAGES, init), pending.promise);
    assert.deepEqual(attempts, [{ room: 'abc', outcomes: [] }]);
    pending.resolve(response);
    await settle();
    const xhr = new page.XMLHttpRequest();
    xhr.open('POST', MESSAGES);
    xhr.setRequestHeader('Authorization', bearer('unused'));
    xhr.send({});
    xhr.status = 201;
    xhr.finish();
    await page.fetch(MESSAGES, { method: 'GET' });
    await page.fetch(`${MESSAGES}/one/regenerate`, init);
    await page.fetch('https://unrelated.example/v1/rooms/abc/messages', init);
    assert.deepEqual(attempts, [{ room: 'abc', outcomes: [401] }, { room: 'abc', outcomes: [201] }]);
    assert.deepEqual(reads, []);
    assert.equal(watcher.token(), null);
    watcher.stop();
});

test('the POST watcher accepts HTTP results only from the original final endpoint', async () => {
    const page = FakeZeta.window();
    const watcher = ZetaSource.watch(page, undefined, false);
    const statuses = [];
    watcher.onPost(() => (status) => statuses.push(status));
    const login = 'https://zeta-ai.io/login';
    const otherRoom = `${API}/v1/rooms/another/messages`;
    const otherOrigin = 'https://elsewhere.example/v1/rooms/abc/messages';
    const fetchCases = [
        [{ status: 201, redirected: false, url: MESSAGES }, 201],
        [{ status: 401, redirected: false, url: MESSAGES }, 401],
        [{ status: 200, redirected: true, url: login }, null],
        [{ status: 200, redirected: true, url: MESSAGES }, null],
        [{ status: 401, url: login }, null],
        [{ status: 200, url: otherRoom }, null],
        [{ status: 200, url: otherOrigin }, null],
        [{ status: 200, url: '' }, null],
        [{ status: 200, get url() { throw new Error('inaccessible'); } }, null],
        [{ status: 201 }, 201],
    ];
    for (const [response, expected] of fetchCases) {
        const nativeResult = Promise.resolve(response);
        page.answer = () => nativeResult;
        assert.equal(page.fetch(MESSAGES, { method: 'POST' }), nativeResult);
        await settle();
        assert.deepEqual(statuses.splice(0), [expected]);
    }
    for (const [finalUrl, expected] of [[MESSAGES, 201], [login, null], [otherRoom, null], [otherOrigin, null], ['', null]]) {
        const xhr = new page.XMLHttpRequest();
        xhr.open('POST', MESSAGES);
        xhr.send();
        xhr.status = 201;
        xhr.responseURL = finalUrl;
        xhr.finish();
        assert.deepEqual(statuses.splice(0), [expected]);
    }
    watcher.stop();
});

test('reply streams report only a normalized result, without consuming the page response or claiming a player send', async () => {
    const page = Object.assign(FakeZeta.window(), { setTimeout, clearTimeout });
    const watcher = ZetaSource.watch(page, undefined, false);
    const path = MESSAGES + '/message-123/candidates/stream';
    const attempts = [];
    const sends = [];
    const changed = [];
    watcher.onTraffic((traffic) => changed.push(traffic.method));
    watcher.onPost((room) => { sends.push(room); });
    watcher.onStream((room, message) => {
        const result = deferred();
        attempts.push({ room, message, result });
        return (outcome) => result.resolve(outcome);
    });
    for (const [type, body, status, outcome] of [
        ['application/json', '{"code":"TOO_MANY_REQUEST","message":"never expose this"}', 429, 'rateLimited'],
        ['application/json', '{"error":{"code":"CHAT_ABUSED","message":"never expose this"}}', 400, 'chatAbused'],
        ['application/json', '{"code":"CHAT_ABUSED"}', 200, 'chatAbused'],
        ['text/event-stream', 'event: error\r\ndata: {"code":"CHAT_ABUSED"}\r\n\r\n', 200, 'chatAbused'],
        ['text/event-stream', 'data: {"text":"reply"}\r\revent: error\rdata: {"code":"CHAT_ABUSED"}\r\r', 200, 'chatAbused'],
        ['text/event-stream', 'data: {"error":{"status":429}}\n\n', 200, 'rateLimited'],
        ['text/event-stream', 'data: {"content":"CHAT_ABUSED"}\n\ndata: [DONE]\n\n', 200, 'ok'],
    ]) {
        const response = new Response(body, { status, headers: { 'Content-Type': type } });
        Object.defineProperty(response, 'url', { value: path });
        page.answer = () => Promise.resolve(response);
        const original = await page.fetch(path, { method: 'POST' });
        assert.equal(original, response);
        assert.equal(original.bodyUsed, false);
        const { room, message, result } = attempts.at(-1);
        assert.deepEqual([room, message], ['abc', 'message-123']);
        assert.equal(await result.promise, outcome);
        assert.equal(await original.text(), body);
    }
    assert.deepEqual(changed, ['POST']);
    const read = new Response('data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    Object.defineProperty(read, 'url', { value: path });
    page.answer = () => Promise.resolve(read);
    await page.fetch(path, { method: 'GET' });
    assert.equal(await attempts.at(-1).result.promise, 'ok');
    assert.deepEqual(changed, ['POST']);
    const count = attempts.length;
    await page.fetch(path + '/other', { method: 'POST' });
    await page.fetch(path.replace(API, 'https://unrelated.example'), { method: 'GET' });
    assert.equal(attempts.length, count);
    assert.deepEqual(sends, []);
    watcher.stop();
});

test('fetch and XHR honor a completion marker after an oversized SSE event while preserving real errors', async () => {
    const page = FakeZeta.window();
    const watcher = ZetaSource.watch(page, undefined, false);
    const path = MESSAGES + '/message-123/candidates/stream';
    const large = 'data: ' + JSON.stringify({ text: 'a'.repeat(18000) }) + '\n\n';
    const done = 'data: [DONE]\n\n';
    const blocked = 'event: error\ndata: {"code":"CHAT_ABUSED"}\n\n';
    const reports = [];
    watcher.onStream(() => (outcome) => reports.push(outcome));
    for (const [body, expected] of [[large + done, 'ok'], [large + blocked + done, 'chatAbused'], [large + done + blocked, 'chatAbused']]) {
        const response = new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
        Object.defineProperty(response, 'url', { value: path });
        page.answer = () => Promise.resolve(response);
        const fetched = await page.fetch(path, { method: 'POST' });
        assert.equal(await fetched.text(), body);
        await settle();
        assert.deepEqual(reports.splice(0), [expected]);
        const xhr = new page.XMLHttpRequest();
        xhr.open('POST', path);
        xhr.send();
        Object.assign(xhr, { status: 200, responseURL: path, responseType: 'text', responseText: body });
        xhr.finish();
        assert.deepEqual(reports.splice(0), [expected]);
    }
    for (const body of [large, large + 'data: {"text":"more"}\n\n', large + 'event: error\ndata: {"code":"OTHER"}\n\n' + done]) {
        const xhr = new page.XMLHttpRequest();
        xhr.open('POST', path);
        xhr.send();
        Object.assign(xhr, { status: 200, responseURL: path, responseType: 'text', responseText: body });
        xhr.finish();
        assert.deepEqual(reports, []);
    }
    watcher.stop();
});

test('XHR stream failures are isolated from send receipts and validate the final endpoint', () => {
    const page = FakeZeta.window();
    const watcher = ZetaSource.watch(page, undefined, false);
    const path = MESSAGES + '/message-123/candidates/stream';
    const reports = [];
    const changed = [];
    watcher.onTraffic((traffic) => changed.push(traffic.method));
    watcher.onStream((room, message) => (outcome) => reports.push([room, message, outcome]));
    for (const [status, type, body, url] of [
        [429, 'text', '', path], [400, 'json', { code: 'CHAT_ABUSED' }, path],
        [200, 'text', 'data: {"error":{"code":"CHAT_ABUSED"}}\n\n', path],
        [200, 'text', 'data: {"text":"CHAT_ABUSED"}\n\n', path],
        [200, 'text', '{"error":"unknown"}', path],
        [429, 'text', '', path + '/elsewhere'],
    ]) {
        const xhr = new page.XMLHttpRequest();
        xhr.open('POST', path);
        xhr.send('{}');
        Object.assign(xhr, { status, responseType: type, responseURL: url, response: body, responseText: body });
        xhr.finish();
    }
    assert.deepEqual(reports, ['rateLimited', 'chatAbused', 'chatAbused', 'ok'].map((outcome) => ['abc', 'message-123', outcome]));
    assert.deepEqual(changed, ['POST']);
    watcher.stop();
});

test('a long-running fetch reports an error after a large stream and preserves the entire response', async () => {
    const timers = new Map();
    const page = Object.assign(FakeZeta.window(), {
        setTimeout(callback, delay) { timers.set(callback, delay); return callback; },
        clearTimeout(callback) { timers.delete(callback); },
    });
    const watcher = ZetaSource.watch(page, undefined, false);
    const reports = [];
    watcher.onStream(() => (outcome) => reports.push(outcome));
    const path = MESSAGES + '/late/candidates/stream';
    const content = 'data: ' + JSON.stringify({ text: 'a'.repeat(120) }) + '\r\n\r\n';
    const normalEvents = content.repeat(2000);
    const largeEvent = 'data: ' + 'a'.repeat(35000) + '\r\n';
    const finalEvent = '\r\nevent: error\r\ndata: {"code":"CHAT_ABUSED"}\r\n\r\n';
    let controller;
    const stream = new ReadableStream({ start(value) { controller = value; } });
    const response = new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
    Object.defineProperty(response, 'url', { value: path });
    page.answer = () => Promise.resolve(response);
    const original = await page.fetch(path);
    assert.equal(original, response);
    const body = original.text();
    const encoder = new TextEncoder();
    controller.enqueue(encoder.encode(normalEvents));
    await settle();
    for (const [callback, delay] of timers) {
        if (delay <= 125000) {
            callback();
        }
    }
    controller.enqueue(encoder.encode(largeEvent));
    controller.enqueue(encoder.encode(finalEvent));
    controller.close();
    assert.equal(await body, normalEvents + largeEvent + finalEvent);
    for (let turn = 0; !reports.length && turn < 20; turn++) {
        await settle();
    }
    assert.deepEqual(reports, ['chatAbused']);
    watcher.stop();
});

test('XHR scans appended long stream events before loadend and reports the late rejection exactly once', () => {
    const page = FakeZeta.window();
    const watcher = ZetaSource.watch(page, undefined, false);
    const reports = [];
    watcher.onStream(() => (outcome) => reports.push(outcome));
    const path = MESSAGES + '/late/candidates/stream';
    const xhr = new page.XMLHttpRequest();
    xhr.open('GET', path);
    xhr.send();
    const content = 'data: ' + JSON.stringify({ text: 'b'.repeat(120) }) + '\n\n';
    Object.assign(xhr, { status: 200, responseType: 'text', responseURL: path, responseText: content.repeat(2000) });
    const progress = xhr.listeners.find((entry) => entry.type === 'progress').listener;
    progress();
    xhr.responseText += 'data: ' + 'b'.repeat(35000) + '\r\n';
    progress();
    assert.deepEqual(reports, []);
    xhr.responseText += '\r\nevent: error\r\ndata: {"code":"CHAT_ABUSED"}\r\n\r\n';
    progress();
    assert.deepEqual(reports, ['chatAbused']);
    xhr.finish();
    assert.deepEqual(reports, ['chatAbused']);
    assert.equal(xhr.listeners.length, 0);
    watcher.stop();
});

test('the watcher sees the token', () => {
    const page = FakeZeta.window();
    const watcher = ZetaSource.watch(page);
    assert.equal(watcher.token(), null);
    page.fetch(MESSAGES, { headers: { Authorization: bearer('one') } });
    assert.equal(watcher.token(), bearer('one'));
    page.fetch(MESSAGES, { headers: [['Accept', 'application/json'], ['Authorization', bearer('two')]] });
    assert.equal(watcher.token(), bearer('two'));
    page.fetch(MESSAGES, { headers: new Headers({ Authorization: bearer('three') }) });
    assert.equal(watcher.token(), bearer('three'));
    page.fetch(`${API}/v1/users/me`, { headers: { authorization: bearer('four') } });
    assert.equal(watcher.token(), bearer('four'));
    page.fetch(new Request(MESSAGES, { headers: { AUTHORIZATION: bearer('five') } }));
    assert.equal(watcher.token(), bearer('five'));
    page.fetch(new Request(MESSAGES, { headers: { Authorization: bearer('ignored') } }), { headers: { Authorization: bearer('six') } });
    assert.equal(watcher.token(), bearer('six'));
    page.fetch(new Request(MESSAGES, { headers: { Authorization: bearer('seven') } }), { method: 'GET' });
    assert.equal(watcher.token(), bearer('seven'));
    page.fetch('//api.zeta-ai.io/v1/rooms/abc/messages', { headers: { Authorization: bearer('eight') } });
    assert.equal(watcher.token(), bearer('eight'));
    page.fetch(new URL(MESSAGES), { headers: { Authorization: bearer('nine') } });
    assert.equal(watcher.token(), bearer('nine'));
    const request = new page.XMLHttpRequest();
    request.open('GET', MESSAGES);
    request.setRequestHeader('Authorization', bearer('ten'));
    assert.equal(watcher.token(), bearer('ten'));
    const lower = new page.XMLHttpRequest();
    lower.open('GET', `${API}/v1/users/me`);
    lower.setRequestHeader('authorization', bearer('eleven'));
    assert.equal(watcher.token(), bearer('eleven'));
    page.fetch(MESSAGES, { headers: { Authorization: '' } });
    page.fetch(MESSAGES, { headers: { Accept: 'application/json' } });
    page.fetch(MESSAGES);
    assert.equal(watcher.token(), bearer('eleven'));
    page.fetch('https://elsewhere.example/v1/rooms/abc/messages', { headers: { Authorization: bearer('evil') } });
    page.fetch('https://api.zeta-ai.io.evil.example/v1/rooms/abc/messages', { headers: { Authorization: bearer('evil') } });
    page.fetch('http://api.zeta-ai.io/v1/rooms/abc/messages', { headers: { Authorization: bearer('evil') } });
    page.fetch('/v1/rooms/abc/messages', { headers: { Authorization: bearer('evil') } });
    page.fetch(new Request('https://api.zeta-ai.io.evil.example/v1', { headers: { Authorization: bearer('evil') } }));
    const elsewhere = new page.XMLHttpRequest();
    elsewhere.open('GET', 'https://api.zeta-ai.io.evil.example/v1/rooms/abc/messages');
    elsewhere.setRequestHeader('Authorization', bearer('evil'));
    const reopened = new page.XMLHttpRequest();
    reopened.open('GET', MESSAGES);
    reopened.open('GET', 'https://elsewhere.example/v1');
    reopened.setRequestHeader('Authorization', bearer('evil'));
    const unopened = new page.XMLHttpRequest();
    unopened.setRequestHeader('Authorization', bearer('evil'));
    assert.equal(watcher.token(), bearer('eleven'));
});

test('the watcher changes nothing', async () => {
    const page = FakeZeta.window();
    ZetaSource.watch(page);
    const init = { method: 'POST', headers: { Authorization: bearer('kept'), Accept: 'text/plain' }, body: 'hello' };
    const before = JSON.stringify(init);
    const extra = { more: true };
    const answer = Promise.resolve(FakeZeta.reply(200, '{}'));
    page.answer = () => answer;
    const returned = page.fetch(MESSAGES, init, extra);
    assert.equal(returned === answer, true);
    assert.equal(page.fetchCalls.length, 1);
    const call = page.fetchCalls[0];
    assert.equal(call.receiver === page, true);
    assert.equal(call.values.length, 3);
    assert.equal(call.values[0], MESSAGES);
    assert.equal(call.values[1] === init, true);
    assert.equal(call.values[2] === extra, true);
    assert.equal(JSON.stringify(init), before);
    const bare = page.fetch;
    bare(MESSAGES);
    assert.equal(page.fetchCalls[1].receiver === undefined, true);
    assert.equal(page.fetchCalls[1].values.length, 1);
    const other = { name: 'another receiver' };
    page.fetch.call(other, MESSAGES);
    assert.equal(page.fetchCalls[2].receiver === other, true);
    page.fetch();
    assert.equal(page.fetchCalls[3].values.length, 0);
    const refusal = new Error('offline');
    const rejected = Promise.reject(refusal);
    page.answer = () => rejected;
    const failing = page.fetch(MESSAGES, { method: 'POST' });
    assert.equal(failing === rejected, true);
    await assert.rejects(failing, (error) => error === refusal);
    const thrown = new Error('thrown at once');
    page.answer = () => {
        throw thrown;
    };
    assert.throws(() => page.fetch(MESSAGES), (error) => error === thrown);
    page.answer = () => answer;
    const hostile = new Map([['Authorization', bearer('hostile')]]);
    hostile[Symbol.iterator] = () => {
        throw new Error('unreadable map');
    };
    const faults = [
        ['http://[', undefined],
        [MESSAGES, { headers: { get Authorization() {
            throw new Error('unreadable header');
        } } }],
        [MESSAGES, { headers: { get: () => {
            throw new Error('unreadable headers');
        } } }],
        [MESSAGES, { get headers() {
            throw new Error('unreadable init');
        } }],
        [MESSAGES, { headers: hostile }],
        [{ toString: () => {
            throw new Error('no text');
        } }, undefined],
    ];
    for (const [input, given] of faults) {
        const count = page.fetchCalls.length;
        const result = page.fetch(input, given);
        assert.equal(result === answer, true);
        assert.equal(page.fetchCalls.length, count + 1);
        assert.equal(page.fetchCalls[count].values[0] === input, true);
        assert.equal(page.fetchCalls[count].values[1] === given, true);
    }
    const broken = FakeZeta.window();
    const brokenWatcher = ZetaSource.watch(broken);
    Object.defineProperty(broken.location, 'href', {
        get: () => {
            throw new Error('no location');
        },
    });
    broken.fetch(MESSAGES, { headers: { Authorization: bearer('lost') } });
    assert.equal(broken.fetchCalls.length, 1);
    assert.equal(brokenWatcher.token(), null);
    const request = new page.XMLHttpRequest();
    const opened = request.open('POST', MESSAGES, true, 'name', 'word');
    const header = request.setRequestHeader('Authorization', bearer('kept'));
    const body = { content: 'a body' };
    const sent = request.send(body);
    assert.deepEqual(
        request.calls.map((entry) => entry.name),
        ['open', 'setRequestHeader', 'send'],
    );
    for (const entry of request.calls) {
        assert.equal(entry.receiver === request, true);
    }
    assert.equal(opened === request.calls[0].result, true);
    assert.equal(header === request.calls[1].result, true);
    assert.equal(sent === request.calls[2].result, true);
    assert.deepEqual(request.calls[0].values, ['POST', MESSAGES, true, 'name', 'word']);
    assert.deepEqual(request.calls[1].values, ['Authorization', bearer('kept')]);
    assert.equal(request.calls[2].values.length, 1);
    assert.equal(request.calls[2].values[0] === body, true);
    const faulty = new page.XMLHttpRequest();
    faulty.open('POST', 'http://[');
    faulty.open('POST', MESSAGES);
    faulty.setRequestHeader({ toString: () => {
        throw new Error('no name');
    } }, 'Bearer x');
    faulty.addEventListener = () => {
        throw new Error('no listening');
    };
    faulty.send();
    assert.deepEqual(
        faulty.calls.map((entry) => entry.name),
        ['open', 'open', 'setRequestHeader', 'send'],
    );
    assert.equal(faulty.calls[0].values[1], 'http://[');
});

test('traffic is noticed when the page changes the chat', async () => {
    const page = FakeZeta.window();
    const watcher = ZetaSource.watch(page);
    const heard = [];
    watcher.onTraffic(() => {
        throw new Error('a listener broke');
    });
    watcher.onTraffic((traffic) => {
        heard.push(`${traffic.method} ${traffic.path}`);
    });
    const sending = deferred();
    page.answer = () => sending.promise;
    const sent = page.fetch(MESSAGES, { method: 'POST', body: 'hello' });
    await settle();
    assert.deepEqual(heard, []);
    sending.resolve(FakeZeta.reply(200, '{}'));
    await sent;
    await settle();
    assert.deepEqual(heard, ['POST /v1/rooms/abc/messages']);
    const failing = deferred();
    page.answer = () => failing.promise;
    const lost = page.fetch(`${MESSAGES}/m1/regenerate?stream=true`, { method: 'post' });
    await settle();
    assert.equal(heard.length, 1);
    failing.reject(new Error('dropped'));
    await assert.rejects(lost);
    await settle();
    assert.deepEqual(heard, ['POST /v1/rooms/abc/messages', 'POST /v1/rooms/abc/messages/m1/regenerate']);
    page.answer = () => Promise.resolve(FakeZeta.reply(200, '{}'));
    await page.fetch(new Request(`${MESSAGES}/m2`, { method: 'DELETE' }));
    await settle();
    assert.equal(heard.at(-1), 'DELETE /v1/rooms/abc/messages/m2');
    assert.equal(heard.length, 3);
    const request = new page.XMLHttpRequest();
    request.open('PATCH', `${MESSAGES}/m3`);
    request.send('{}');
    await settle();
    assert.equal(heard.length, 3);
    request.finish();
    assert.equal(heard.length, 4);
    assert.equal(heard.at(-1), 'PATCH /v1/rooms/abc/messages/m3');
    request.open('POST', MESSAGES);
    request.send('{}');
    request.finish();
    assert.equal(heard.length, 5);
    assert.equal(heard.at(-1), 'POST /v1/rooms/abc/messages');
    request.finish();
    assert.equal(heard.length, 5);
    await page.fetch(MESSAGES);
    await page.fetch(MESSAGES, { method: 'GET' });
    await page.fetch('https://elsewhere.example/v1/rooms/abc/messages', { method: 'POST' });
    const reading = new page.XMLHttpRequest();
    reading.open('GET', MESSAGES);
    reading.send();
    reading.finish();
    const outside = new page.XMLHttpRequest();
    outside.open('POST', 'https://elsewhere.example/v1/rooms/abc');
    outside.send();
    outside.finish();
    await settle();
    assert.equal(heard.length, 5);
});

test('stop puts the page back', async () => {
    const page = FakeZeta.window();
    const prototype = page.XMLHttpRequest.prototype;
    const originals = [page.fetch, prototype.open, prototype.setRequestHeader, prototype.send];
    const first = ZetaSource.watch(page);
    const wrapped = [page.fetch, prototype.open, prototype.setRequestHeader, prototype.send];
    for (let index = 0; index < 4; index++) {
        assert.equal(wrapped[index] === originals[index], false);
    }
    const second = ZetaSource.watch(page);
    assert.equal(second === first, true);
    assert.equal(page.fetch === wrapped[0], true);
    assert.equal(prototype.open === wrapped[1], true);
    assert.equal(prototype.setRequestHeader === wrapped[2], true);
    assert.equal(prototype.send === wrapped[3], true);
    const heard = [];
    second.onTraffic((traffic) => heard.push(traffic.method));
    await page.fetch(MESSAGES, { method: 'POST', headers: { Authorization: bearer('once') } });
    await settle();
    assert.equal(page.fetchCalls.length, 1);
    assert.deepEqual(heard, ['POST']);
    assert.equal(first.token(), bearer('once'));
    first.stop();
    assert.equal(page.fetch === originals[0], true);
    assert.equal(prototype.open === originals[1], true);
    assert.equal(prototype.setRequestHeader === originals[2], true);
    assert.equal(prototype.send === originals[3], true);
    const again = ZetaSource.watch(page);
    assert.equal(again === first, false);
    assert.equal(page.fetch === originals[0], false);
    /**
     * @return {Promise<null>}
     */
    const foreign = async () => null;
    const ours = page.fetch;
    page.fetch = foreign;
    again.stop();
    assert.equal(page.fetch === foreign, true);
    assert.equal(prototype.open === originals[1], true);
    assert.equal(prototype.setRequestHeader === originals[2], true);
    assert.equal(prototype.send === originals[3], true);
    const quiet = [];
    again.onTraffic((traffic) => quiet.push(traffic.method));
    await ours.call(page, MESSAGES, { method: 'POST', headers: { Authorization: bearer('after') } });
    await settle();
    assert.equal(again.token(), null);
    assert.deepEqual(quiet, []);
    first.stop();
    assert.equal(page.fetch === foreign, true);
    const fresh = ZetaSource.watch(page);
    assert.equal(fresh === again, false);
    fresh.stop();
    assert.equal(page.fetch === foreign, true);
});

test('the walk says how it ended', async () => {
    const finished = new FakeZeta(FakeZeta.messages(40));
    const plain = await walk(finished.fetch);
    assert.equal(plain.end, END.NoCursor);
    assert.equal(plain.messages.length, 40);
    assert.equal(finished.requests.length, 2);
    const open = new FakeZeta(FakeZeta.messages(40));
    open.endless = true;
    const emptied = await walk(open.fetch);
    assert.equal(emptied.end, END.EmptyPage);
    assert.equal(emptied.messages.length, 40);
    assert.equal(open.requests.length, 3);
    const repeating = new FakeZeta(FakeZeta.messages(100));
    repeating.repeat = 'again';
    assert.equal((await walk(repeating.fetch)).end, END.RepeatedCursor);
    const stale = [said('s2', 2), said('s1', 1)];
    const useless = FakeZeta.scripted([
        FakeZeta.page(stale, 'fresh-1'),
        FakeZeta.page(stale, 'fresh-2'),
        FakeZeta.page(stale, 'fresh-3'),
    ]);
    const unchanged = await walk(useless.fetch);
    assert.equal(unchanged.end, END.NothingNew);
    assert.equal(useless.requests.length, 2);
    assert.deepEqual(ids(unchanged.messages), ['s1', 's2']);
    assert.equal(ZetaSource.Settings.MostPages, 2000);
    const bottomless = new FakeZeta(FakeZeta.messages(2100));
    bottomless.perPage = 1;
    bottomless.most = 2100;
    const limited = await walk(bottomless.fetch);
    assert.equal(limited.end, END.Limit);
    assert.equal(limited.problem, null);
    assert.equal(bottomless.requests.length, 2000);
    assert.equal(limited.messages.length, 2000);
    assert.equal(limited.messages[0].id, 'm101');
    assert.equal(limited.messages.at(-1).id, 'm2100');
    const known = [said('k2', 2), said('k1', 1)];
    const settled = FakeZeta.scripted([FakeZeta.page(known, 'p2'), FakeZeta.page(known, null)]);
    const nothingNew = await walk(settled.fetch);
    assert.equal(nothingNew.end, END.NothingNew);
    assert.equal(settled.requests.length, 2);
    const numbered = FakeZeta.scripted([
        FakeZeta.page([said('u2', 2)], 5),
        FakeZeta.page([said('u1', 1)], 5),
        FakeZeta.page([said('u0', 0)], 6),
    ]);
    const counted = await walk(numbered.fetch);
    assert.equal(counted.end, END.RepeatedCursor);
    assert.equal(numbered.requests.length, 2);
    assert.equal(cursorOf(numbered.requests[1].url), '5');
    assert.deepEqual(ids(counted.messages), ['u1', 'u2']);
});

test('a failure late in a pull keeps what was pulled', async () => {
    /**
     * @param {object[]} tail
     * @return {{ fetch: Function, requests: object[] }}
     */
    const pulled = (tail) =>
        FakeZeta.scripted([
            FakeZeta.page([said('f4', 4), said('f3', 3)], 'p2'),
            FakeZeta.page([said('f2', 2), said('f1', 1)], 'p3'),
            ...tail,
        ]);
    const busy = pulled([FakeZeta.reply(500, 'Server error'), FakeZeta.reply(500, 'Server error'), FakeZeta.reply(500, 'Server error')]);
    const { pause, paused } = recorder();
    const kept = await walk(busy.fetch, { pause });
    assert.equal(kept.end, END.Failed);
    assert.equal(kept.problem, 'Zeta answered HTTP 500');
    assert.deepEqual(ids(kept.messages), ['f1', 'f2', 'f3', 'f4']);
    assert.equal(busy.requests.length, 5);
    assert.deepEqual(paused, [500, 500, 2000, 4000]);
    const refused = pulled([FakeZeta.reply(401, `Token ${TOKEN} expired`)]);
    const stopped = await walk(refused.fetch);
    assert.equal(stopped.end, END.Failed);
    assert.equal(stopped.problem, 'Zeta answered HTTP 401');
    assert.equal(stopped.problem.includes(SECRET), false);
    assert.deepEqual(ids(stopped.messages), ['f1', 'f2', 'f3', 'f4']);
    assert.equal(refused.requests.length, 3);
    const first = FakeZeta.scripted([FakeZeta.reply(500, 'Server error'), FakeZeta.reply(500, 'Server error'), FakeZeta.reply(500, 'Server error')]);
    const error = await failureOf(walk(first.fetch));
    assert.equal(error.message, 'Zeta answered HTTP 500');
    assert.equal(error.status, 500);
    assert.equal(first.requests.length, 3);
});

test('a request is retried with a growing pause', async () => {
    const once = recorder();
    const slow = FakeZeta.scripted([FakeZeta.reply(429, 'Slow down'), FakeZeta.page([said('r1')], null)]);
    const recovered = await latest(slow.fetch, { pause: once.pause });
    assert.deepEqual(ids(recovered.messages), ['r1']);
    assert.equal(slow.requests.length, 2);
    assert.deepEqual(once.paused, [2000]);
    const thrice = recorder();
    const down = FakeZeta.scripted([
        FakeZeta.reply(503, 'Unavailable'),
        FakeZeta.reply(502, 'Bad gateway'),
        FakeZeta.reply(500, 'Server error'),
        FakeZeta.page([said('r2')], null),
    ]);
    const error = await failureOf(latest(down.fetch, { pause: thrice.pause }));
    assert.equal(error.message, 'Zeta answered HTTP 500');
    assert.equal(down.requests.length, 3);
    assert.deepEqual(thrice.paused, [2000, 4000]);
    for (const status of [401, 403, 404]) {
        const untried = recorder();
        const refused = FakeZeta.scripted([FakeZeta.reply(status, 'No'), FakeZeta.page([said('r3')], null)]);
        const refusal = await failureOf(latest(refused.fetch, { pause: untried.pause }));
        assert.equal(refusal.message, `Zeta answered HTTP ${status}`);
        assert.equal(refused.requests.length, 1);
        assert.deepEqual(untried.paused, []);
    }
    const blip = recorder();
    const flaky = FakeZeta.scripted([
        new Error('the connection dropped'),
        FakeZeta.page([said('g2', 2)], 'p2'),
        FakeZeta.page([said('g1', 1)], null),
    ]);
    const continued = await walk(flaky.fetch, { pause: blip.pause });
    assert.equal(continued.end, END.NoCursor);
    assert.deepEqual(ids(continued.messages), ['g1', 'g2']);
    assert.equal(flaky.requests.length, 3);
    assert.deepEqual(blip.paused, [2000, 500]);
    const unreachable = recorder();
    const offline = FakeZeta.scripted([
        new Error('offline one'),
        new Error('offline two'),
        new Error('offline three'),
        FakeZeta.page([said('o1')], null),
    ]);
    const offlineError = await failureOf(walk(offline.fetch, { pause: unreachable.pause }));
    assert.equal(offlineError.message, 'Zeta could not be reached');
    assert.equal(offlineError.status, null);
    assert.equal(offline.requests.length, 3);
    assert.deepEqual(unreachable.paused, [2000, 4000]);
    const midway = recorder();
    const hiccup = FakeZeta.scripted([
        FakeZeta.page([said('h2', 2)], 'p2'),
        FakeZeta.reply(429, 'Slow down'),
        FakeZeta.page([said('h1', 1)], null),
    ]);
    const whole = await walk(hiccup.fetch, { pause: midway.pause });
    assert.equal(whole.end, END.NoCursor);
    assert.deepEqual(ids(whole.messages), ['h1', 'h2']);
    assert.deepEqual(midway.paused, [500, 2000]);
});

test('a request that never answers times out', async () => {
    const watching = rejections();
    try {
        const timers = [];
        /**
         * @param {number} milliseconds
         * @return {Promise<void>}
         */
        const pause = (milliseconds) => {
            if (milliseconds !== TIMEOUT) {
                return Promise.resolve();
            }
            const timer = deferred();
            timers.push(timer);
            return timer.promise;
        };
        const hanging = [];
        /**
         * @return {Promise<object>}
         */
        const fetch = () => {
            const pending = deferred();
            hanging.push(pending);
            return pending.promise;
        };
        let done = false;
        const reading = latest(fetch, { pause });
        reading.then(
            () => {
                done = true;
            },
            () => {
                done = true;
            },
        );
        for (let index = 0; index < 3; index++) {
            await settle();
            assert.equal(done, false);
            assert.equal(timers.length, index + 1);
            assert.equal(hanging.length, index + 1);
            timers[index].resolve();
        }
        const error = await failureOf(reading);
        assert.equal(error.message, LATE);
        assert.equal(error.status, null);
        assert.equal(hanging.length, 3);
        for (const pending of hanging) {
            pending.reject(new Error(`late failure for ${TOKEN}`));
        }
        const bodies = [];
        /**
         * @return {Promise<object>}
         */
        const silent = async () => {
            const body = deferred();
            bodies.push(body);
            return { status: 200, text: () => body.promise };
        };
        const quick = await failureOf(latest(silent, { pause: () => Promise.resolve() }));
        assert.equal(quick.message, LATE);
        assert.equal(quick.status, null);
        assert.equal(bodies.length, 3);
        for (const body of bodies) {
            body.reject(new Error('the body broke later'));
        }
        await settle();
        await settle();
        assert.deepEqual(watching.seen, []);
    } finally {
        watching.stop();
    }
});

test('bad messages are left out and counted', async () => {
    const numbered = said('x', 5);
    numbered.id = 12;
    const unnamed = said('y', 4);
    delete unnamed.id;
    const blank = said('', 3);
    const nested = said('z', 2);
    nested.id = { inner: 'value' };
    const { fetch } = FakeZeta.scripted([FakeZeta.page([numbered, unnamed, blank, nested, null, said('kept', 1)], null)]);
    const result = await walk(fetch);
    assert.deepEqual(ids(result.messages), ['kept', '12']);
    assert.equal(typeof result.messages[1].id, 'string');
    assert.equal(result.skipped, 4);
    assert.equal(result.end, END.NoCursor);
    const newest = FakeZeta.scripted([FakeZeta.page([unnamed, said('n1', 1)], null)]);
    assert.equal((await latest(newest.fetch)).skipped, 1);
    const hopeless = FakeZeta.scripted([FakeZeta.page([unnamed, blank, nested], null)]);
    const error = await failureOf(walk(hopeless.fetch));
    assert.equal(error.message, SHAPE);
    assert.equal(error.status, 200);
    const later = FakeZeta.scripted([FakeZeta.page([said('l2', 2), unnamed], 'p2'), FakeZeta.page([unnamed, blank], null)]);
    const partial = await walk(later.fetch);
    assert.equal(partial.end, END.Failed);
    assert.equal(partial.problem, SHAPE);
    assert.deepEqual(ids(partial.messages), ['l2']);
    assert.equal(partial.skipped, 1);
});

test('order follows the instant, then the API', async () => {
    /**
     * @param {string} id
     * @param {*} messageTime
     * @return {object}
     */
    const timed = (id, messageTime) => {
        const message = said(id);
        message.messageTime = messageTime;
        return message;
    };
    const untimed = said('n0');
    delete untimed.messageTime;
    const { fetch } = FakeZeta.scripted([
        FakeZeta.page(
            [
                timed('f', '2026-01-01T00:00:00.100Z'),
                timed('h', '2026-01-01T00:00:02.000Z'),
                timed('g', '2026-01-01T00:00:02Z'),
                timed('d', '2026-01-01T01:00:00.500+01:00'),
            ],
            'p2',
        ),
        FakeZeta.page(
            [
                timed('e', 'not a time'),
                timed('c', '2026-01-01T00:00:01Z'),
                timed('b', '2026-01-01T00:00:00.250Z'),
                timed('a', '2026-01-01T00:00:00Z'),
                untimed,
            ],
            null,
        ),
    ]);
    const result = await walk(fetch);
    assert.deepEqual(ids(result.messages), ['n0', 'a', 'f', 'b', 'd', 'c', 'e', 'g', 'h']);
    const numeric = FakeZeta.scripted([FakeZeta.page([timed('later', '2026-01-01T00:00:05Z'), timed('odd', 12345), timed('early', '2026-01-01T00:00:01Z')], null)]);
    assert.deepEqual(ids((await walk(numeric.fetch)).messages), ['early', 'odd', 'later']);
});

test('adapter faults become this file\'s errors', async () => {
    const watching = rejections();
    try {
        /**
         * @return {Promise<object>}
         */
        const brokenStatus = async () => ({
            get status() {
                throw new Error(`status broke for ${TOKEN}`);
            },
            text: async () => '{"messages":[]}',
        });
        const statusError = await failureOf(latest(brokenStatus));
        assert.equal(statusError.message, SHAPE);
        assert.equal(statusError.status, null);
        assert.equal(carriesToken(statusError), false);
        /**
         * @return {Promise<void>}
         */
        const rejecting = async () => {
            throw new Error(`pause broke for ${TOKEN}`);
        };
        const asked = [];
        /**
         * @param {string} url
         * @return {Promise<object>}
         */
        const unanswered = (url) => {
            asked.push(url);
            return never();
        };
        const pauseError = await failureOf(walk(unanswered, { pause: rejecting }));
        assert.equal(pauseError.message, NO_PAUSE);
        assert.equal(pauseError.status, null);
        assert.equal(carriesToken(pauseError), false);
        assert.equal(asked.length, 1);
        /**
         * @param {number} milliseconds
         * @return {Promise<void>}
         */
        const between = (milliseconds) => (milliseconds === ZetaSource.Settings.PauseMs ? rejecting() : rest(milliseconds));
        const betweenPages = new FakeZeta(FakeZeta.messages(40));
        const cut = await walk(betweenPages.fetch, { pause: between });
        assert.equal(cut.end, END.Failed);
        assert.equal(cut.problem, NO_PAUSE);
        assert.equal(cut.messages.length, 31);
        assert.equal(betweenPages.requests.length, 1);
        /**
         * @return {void}
         */
        const throwing = () => {
            throw new Error('pause threw at once');
        };
        for (const reading of ['history', 'newest']) {
            for (const pause of [undefined, null, 'soon']) {
                const api = new FakeZeta(FakeZeta.messages(5));
                const error = await failureOf(ZetaSource[reading]({ fetch: api.fetch, token: TOKEN, roomId: FakeZeta.Room, pause }));
                assert.equal(error.message, NO_PAUSE, `${reading} ${String(pause)}`);
                assert.equal(error.status, null);
                assert.equal(api.requests.length, 0);
            }
            for (const pause of [throwing, rejecting]) {
                asked.length = 0;
                const error = await failureOf(ZetaSource[reading]({ fetch: unanswered, token: TOKEN, roomId: FakeZeta.Room, pause }));
                assert.equal(error.message, NO_PAUSE, reading);
                assert.equal(error.status, null);
                assert.equal(carriesToken(error), false);
                assert.equal(asked.length, 1);
            }
        }
        const progress = new FakeZeta(FakeZeta.messages(40));
        const finished = await walk(progress.fetch, {
            onPage: async () => {
                throw new Error('the progress line broke later');
            },
        });
        assert.equal(finished.messages.length, 40);
        assert.equal(finished.end, END.NoCursor);
        await settle();
        await settle();
        assert.deepEqual(watching.seen, []);
    } finally {
        watching.stop();
    }
});

test('the wrappers are exported when asked', async () => {
    const page = FakeZeta.window();
    const prototype = page.XMLHttpRequest.prototype;
    const originals = [page.fetch, prototype.open, prototype.setRequestHeader, prototype.send];
    const given = [];
    const made = [];
    /**
     * @param {Function} wrapper
     * @return {Function}
     */
    const exporter = (wrapper) => {
        given.push(wrapper);
        /**
         * @param {...*} values
         * @return {*}
         */
        const exported = function (...values) {
            return wrapper.apply(this, values);
        };
        made.push(exported);
        return exported;
    };
    const watcher = ZetaSource.watch(page, exporter);
    assert.equal(given.length, 4);
    assert.equal(page.fetch === made[0], true);
    assert.equal(prototype.open === made[1], true);
    assert.equal(prototype.setRequestHeader === made[2], true);
    assert.equal(prototype.send === made[3], true);
    for (let index = 0; index < 4; index++) {
        assert.equal(typeof given[index], 'function');
        assert.equal(given[index] === originals[index], false);
    }
    const init = { headers: { Authorization: bearer('exported') } };
    const returned = page.fetch(MESSAGES, init);
    assert.equal(page.fetchCalls.length, 1);
    assert.equal(page.fetchCalls[0].receiver === page, true);
    assert.equal(page.fetchCalls[0].values[1] === init, true);
    assert.equal(returned === page.fetchCalls[0].result, true);
    assert.equal(watcher.token(), bearer('exported'));
    const request = new page.XMLHttpRequest();
    const opened = request.open('POST', MESSAGES);
    request.setRequestHeader('Authorization', bearer('exported-xhr'));
    assert.equal(opened === request.calls[0].result, true);
    assert.equal(request.calls[0].receiver === request, true);
    assert.equal(watcher.token(), bearer('exported-xhr'));
    const heard = [];
    watcher.onTraffic((traffic) => heard.push(traffic.method));
    request.send();
    request.finish();
    assert.deepEqual(heard, ['POST']);
    watcher.stop();
    assert.equal(page.fetch === originals[0], true);
    assert.equal(prototype.open === originals[1], true);
    assert.equal(prototype.setRequestHeader === originals[2], true);
    assert.equal(prototype.send === originals[3], true);
    const plain = FakeZeta.window();
    const plainFetch = plain.fetch;
    const plainWatcher = ZetaSource.watch(plain);
    assert.equal(plain.fetch === plainFetch, false);
    assert.equal(plain.fetch.name, 'fetch');
    assert.equal(plain.XMLHttpRequest.prototype.open.name, 'open');
    plain.fetch(MESSAGES, { headers: { Authorization: bearer('plain') } });
    assert.equal(plainWatcher.token(), bearer('plain'));
    for (const failing of [() => null, () => {
        throw new Error('cannot export');
    }]) {
        const other = FakeZeta.window();
        const otherFetch = other.fetch;
        const otherOpen = other.XMLHttpRequest.prototype.open;
        ZetaSource.watch(other, failing);
        assert.equal(other.fetch === otherFetch, true);
        assert.equal(other.XMLHttpRequest.prototype.open === otherOpen, true);
    }
});

test('traffic does not depend on the path', async () => {
    const page = FakeZeta.window();
    const watcher = ZetaSource.watch(page);
    const heard = [];
    watcher.onTraffic((traffic) => heard.push(`${traffic.method} ${traffic.path}`));
    await page.fetch(`${API}/v1/messages/m1/regenerate`, { method: 'POST' });
    await settle();
    const request = new page.XMLHttpRequest();
    request.open('PATCH', `${API}/v2/anything`);
    request.send('{}');
    request.finish();
    assert.deepEqual(heard, ['POST /v1/messages/m1/regenerate', 'PATCH /v2/anything']);
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'options']) {
        await page.fetch(`${API}/v2/anything`, { method });
        const reading = new page.XMLHttpRequest();
        reading.open(method, `${API}/v2/anything`);
        reading.send();
        reading.finish();
    }
    await page.fetch('https://elsewhere.example/v2/anything', { method: 'POST' });
    const outside = new page.XMLHttpRequest();
    outside.open('POST', 'https://elsewhere.example/v2/anything');
    outside.send();
    outside.finish();
    await settle();
    assert.equal(heard.length, 2);
});

test('a token is replaced only by a token', () => {
    const page = FakeZeta.window();
    const watcher = ZetaSource.watch(page);
    const held = `Bearer ${'a'.repeat(40)}`;
    page.fetch(MESSAGES, { headers: { Authorization: held } });
    assert.equal(watcher.token(), held);
    const weak = [
        'Bearer undefined',
        'Bearer null',
        'Bearer NULL',
        'Bearer ',
        'abcde',
        `  ${'x'.repeat(10)}  `,
        'Bearer [object Object]',
        'Bearer false false false',
        'Bearer null null null',
        'Bearer NULL NULL NULL',
        'Bearer NaN NaN NaN NaN',
        'Bearer token undefined',
        'Bearer abcdefgh',
    ];
    for (const value of weak) {
        page.fetch(MESSAGES, { headers: { Authorization: value } });
        assert.equal(watcher.token(), held, value);
        const request = new page.XMLHttpRequest();
        request.open('GET', MESSAGES);
        request.setRequestHeader('Authorization', value);
        assert.equal(watcher.token(), held, value);
    }
    for (const value of [12345678901234567890, [`Bearer ${'e'.repeat(40)}`], { toString: () => `Bearer ${'f'.repeat(40)}` }]) {
        page.fetch(MESSAGES, { headers: { Authorization: value } });
        assert.equal(watcher.token(), held);
        const request = new page.XMLHttpRequest();
        request.open('GET', MESSAGES);
        request.setRequestHeader('Authorization', value);
        assert.equal(watcher.token(), held);
    }
    const replacement = `Bearer ${'c'.repeat(40)}`;
    page.fetch(MESSAGES, { headers: { Authorization: replacement } });
    assert.equal(watcher.token(), replacement);
    const padded = `Bearer ${'d'.repeat(40)}`;
    page.fetch(MESSAGES, { headers: { Authorization: `  ${padded}  ` } });
    assert.equal(watcher.token(), padded);
    const lettered = 'Bearer abcnullundefinedxyz0123456789';
    page.fetch(MESSAGES, { headers: { Authorization: lettered } });
    assert.equal(watcher.token(), lettered);
    const shortest = 'Bearer abcdefghi';
    assert.equal(shortest.length, 16);
    page.fetch(MESSAGES, { headers: { Authorization: shortest } });
    assert.equal(watcher.token(), shortest);
});

test('headers and destinations are read as the browser reads them', () => {
    const page = FakeZeta.window();
    const watcher = ZetaSource.watch(page);
    page.fetch(MESSAGES, { headers: new Map([['Accept', 'application/json'], ['Authorization', bearer('map')]]) });
    assert.equal(watcher.token(), bearer('map'));
    page.fetch(MESSAGES, { headers: new Map([['authorization', bearer('lower-map')]]) });
    assert.equal(watcher.token(), bearer('lower-map'));
    page.fetch(MESSAGES, { headers: new Map([['AUTHORIZATION', bearer('map')]]) });
    assert.equal(watcher.token(), bearer('map'));
    let touched = false;
    /**
     * @return {Generator<string[]>}
     */
    function* pairs() {
        touched = true;
        yield ['Authorization', bearer('generated')];
    }
    const generated = pairs();
    page.fetch(MESSAGES, { headers: generated });
    assert.equal(touched, false);
    assert.equal(watcher.token(), bearer('map'));
    assert.equal(page.fetchCalls.at(-1).values[1].headers === generated, true);
    const lookalike = {
        url: MESSAGES,
        method: 'POST',
        headers: { Authorization: bearer('lookalike') },
        toString: () => 'https://elsewhere.example/v1/rooms/abc/messages',
    };
    page.fetch(lookalike, { headers: { Authorization: bearer('lookalike-init') } });
    page.fetch(lookalike);
    assert.equal(watcher.token(), bearer('map'));
    const disguised = { url: 'https://elsewhere.example/v1', toString: () => MESSAGES };
    page.fetch(disguised, { headers: { Authorization: bearer('disguised') } });
    assert.equal(watcher.token(), bearer('disguised'));
    page.fetch(new Request(MESSAGES, { headers: { Authorization: bearer('request') } }));
    assert.equal(watcher.token(), bearer('request'));
});

test('windows that lack fetch or XHR', () => {
    const noFetch = FakeZeta.window();
    delete noFetch.fetch;
    const xhrOnly = ZetaSource.watch(noFetch);
    assert.equal('fetch' in noFetch, false);
    const request = new noFetch.XMLHttpRequest();
    request.open('GET', MESSAGES);
    request.setRequestHeader('Authorization', bearer('xhr-only'));
    assert.equal(xhrOnly.token(), bearer('xhr-only'));
    xhrOnly.stop();
    assert.equal('fetch' in noFetch, false);
    const noXhr = FakeZeta.window();
    const fetchBefore = noXhr.fetch;
    delete noXhr.XMLHttpRequest;
    const fetchOnly = ZetaSource.watch(noXhr);
    assert.equal(noXhr.fetch === fetchBefore, false);
    assert.equal('XMLHttpRequest' in noXhr, false);
    noXhr.fetch(MESSAGES, { headers: { Authorization: bearer('fetch-only') } });
    assert.equal(fetchOnly.token(), bearer('fetch-only'));
    const bare = { location: { href: FakeZeta.PageAddress } };
    const empty = ZetaSource.watch(bare);
    assert.equal(empty.token(), null);
    empty.onTraffic(() => null);
    empty.stop();
    assert.deepEqual(Object.keys(bare), ['location']);
    const guarded = FakeZeta.window();
    Object.defineProperty(guarded, 'XMLHttpRequest', {
        get: () => {
            throw new Error('no requests here');
        },
    });
    const guardedWatcher = ZetaSource.watch(guarded);
    guarded.fetch(MESSAGES, { headers: { Authorization: bearer('guarded') } });
    assert.equal(guardedWatcher.token(), bearer('guarded'));
    for (const nothing of [null, undefined, 7, 'window']) {
        const handle = ZetaSource.watch(nothing);
        assert.equal(handle.token(), null);
        handle.stop();
    }
    const page = FakeZeta.window();
    ZetaSource.watch(page);
    assert.equal(page.fetch.length, 1);
});

test('an XHR opened again forgets its first request', async () => {
    const page = FakeZeta.window();
    const watcher = ZetaSource.watch(page);
    const heard = [];
    watcher.onTraffic((traffic) => heard.push(`${traffic.method} ${traffic.path}`));
    const request = new page.XMLHttpRequest();
    request.open('POST', MESSAGES);
    request.send('{}');
    request.open('GET', MESSAGES);
    assert.equal(request.listeners.length, 0);
    request.finish();
    request.send();
    request.finish();
    assert.deepEqual(heard, []);
    const unsent = new page.XMLHttpRequest();
    unsent.open('POST', MESSAGES);
    unsent.open('GET', MESSAGES);
    unsent.send();
    unsent.finish();
    assert.deepEqual(heard, []);
    request.open('POST', MESSAGES);
    request.send('{}');
    request.finish();
    assert.deepEqual(heard, ['POST /v1/rooms/abc/messages']);
    const failing = new page.XMLHttpRequest();
    const refusal = new Error('the synchronous send failed');
    failing.refusal = refusal;
    failing.open('POST', `${MESSAGES}/m1`);
    assert.throws(() => failing.send('{}'), (error) => error === refusal);
    assert.equal(failing.listeners.length, 0);
    failing.finish();
    failing.refusal = null;
    failing.send();
    failing.finish();
    assert.deepEqual(heard, ['POST /v1/rooms/abc/messages']);
});

test('xhr records are not kept alive', () => {
    const page = FakeZeta.window();
    const watcher = ZetaSource.watch(page);
    const request = new page.XMLHttpRequest();
    request.open('POST', MESSAGES);
    assert.equal(Object.prototype.toString.call(ZetaSource.Requests), '[object WeakMap]');
    assert.equal(Object.prototype.toString.call(ZetaSource.Watchers), '[object WeakMap]');
    assert.equal(ZetaSource.Requests.has(request), true);
    assert.equal(reaches(ZetaSource, request, 5), false);
    assert.equal(reaches(watcher, request, 5), false);
    request.send();
    assert.equal(reaches(ZetaSource, request, 5), false);
    assert.equal(reaches(watcher, request, 5), false);
});

test('a second send keeps the first request\'s traffic', () => {
    const page = FakeZeta.window();
    const watcher = ZetaSource.watch(page);
    const heard = [];
    watcher.onTraffic((traffic) => heard.push(`${traffic.method} ${traffic.path}`));
    const request = new page.XMLHttpRequest();
    request.open('POST', MESSAGES);
    request.send('{}');
    const refusal = new Error('InvalidStateError: the request was already sent');
    request.refusal = refusal;
    assert.throws(() => request.send('{}'), (error) => error === refusal);
    request.refusal = null;
    assert.equal(request.listeners.length, 1);
    request.finish();
    assert.deepEqual(heard, ['POST /v1/rooms/abc/messages']);
    const again = new page.XMLHttpRequest();
    again.open('POST', `${MESSAGES}/m1`);
    again.send('{}');
    again.finish();
    again.open('POST', `${MESSAGES}/m1`);
    again.send('{}');
    again.finish();
    assert.deepEqual(heard, ['POST /v1/rooms/abc/messages', 'POST /v1/rooms/abc/messages/m1', 'POST /v1/rooms/abc/messages/m1']);
});

test('a cursor of the wrong shape is a failure', async () => {
    for (const wrong of [{ next: 'p2' }, ['p2'], true]) {
        const first = FakeZeta.scripted([FakeZeta.page([said('c1')], wrong), FakeZeta.page([said('c0')], null)]);
        const error = await failureOf(walk(first.fetch));
        assert.equal(error.message, SHAPE);
        assert.equal(error.status, 200);
        assert.equal(first.requests.length, 1);
        const newest = FakeZeta.scripted([FakeZeta.page([said('c1')], wrong)]);
        assert.equal((await failureOf(latest(newest.fetch))).message, SHAPE);
        const third = FakeZeta.scripted([
            FakeZeta.page([said('w3', 3)], 'p2'),
            FakeZeta.page([said('w2', 2)], 'p3'),
            FakeZeta.page([said('w1', 1)], wrong),
            FakeZeta.page([said('w0', 0)], null),
        ]);
        const result = await walk(third.fetch);
        assert.equal(result.end, END.Failed);
        assert.equal(result.problem, SHAPE);
        assert.deepEqual(ids(result.messages), ['w2', 'w3']);
        assert.equal(third.requests.length, 3);
    }
    const falsy = FakeZeta.scripted([FakeZeta.page([said('f1')], false)]);
    const ended = await walk(falsy.fetch);
    assert.equal(ended.end, END.NoCursor);
    assert.equal(falsy.requests.length, 1);
    const zero = FakeZeta.scripted([FakeZeta.page([said('z2', 2)], 0), FakeZeta.page([said('z1', 1)], null)]);
    const zeroed = await walk(zero.fetch);
    assert.equal(zero.requests.length, 2);
    assert.equal(cursorOf(zero.requests[1].url), '0');
    assert.deepEqual(ids(zeroed.messages), ['z1', 'z2']);
});

test('a room that cannot be encoded is a bad argument', async () => {
    for (const reading of ['history', 'newest']) {
        const api = new FakeZeta(FakeZeta.messages(3));
        const error = await failureOf(ZetaSource[reading]({ fetch: api.fetch, token: TOKEN, roomId: 'abc\uD800', pause: rest }));
        assert.equal(Object.prototype.toString.call(error), '[object Error]');
        assert.equal(error.message, 'No chat is open');
        assert.equal(error.status, null);
        assert.equal(api.requests.length, 0);
    }
});

test('traffic follows the method the browser would send', async () => {
    const page = FakeZeta.window();
    const watcher = ZetaSource.watch(page);
    const heard = [];
    watcher.onTraffic((traffic) => heard.push(`${traffic.method} ${traffic.path}`));
    await page.fetch(new Request(MESSAGES, { method: 'POST' }), { method: 'GET' });
    await settle();
    assert.deepEqual(heard, []);
    await page.fetch(new Request(MESSAGES, { method: 'GET' }), { method: 'POST' });
    await settle();
    assert.deepEqual(heard, ['POST /v1/rooms/abc/messages']);
    await page.fetch(new Request(MESSAGES, { method: 'PUT' }));
    await settle();
    assert.deepEqual(heard, ['POST /v1/rooms/abc/messages', 'PUT /v1/rooms/abc/messages']);
});

test('nothing is reported after stop', async () => {
    const page = FakeZeta.window();
    const watcher = ZetaSource.watch(page);
    const heard = [];
    watcher.onTraffic((traffic) => heard.push(traffic.method));
    const pending = deferred();
    page.answer = () => pending.promise;
    const flight = page.fetch(MESSAGES, { method: 'POST' });
    const request = new page.XMLHttpRequest();
    request.open('PATCH', MESSAGES);
    request.send('{}');
    watcher.stop();
    pending.resolve(FakeZeta.reply(200, '{}'));
    await flight;
    await settle();
    request.finish();
    assert.deepEqual(heard, []);
});

test('a status that is not a number is the shape error', async () => {
    const asked = [];
    /**
     * @param {string} url
     * @return {Promise<object>}
     */
    const odd = async (url) => {
        asked.push(url);
        return { status: Number.NaN, text: async () => JSON.stringify({ messages: [], nextCursor: null }) };
    };
    for (const reading of ['history', 'newest']) {
        asked.length = 0;
        const error = await failureOf(ZetaSource[reading]({ fetch: odd, token: TOKEN, roomId: FakeZeta.Room, pause: rest }));
        assert.equal(error.message, SHAPE);
        assert.equal(error.status, null);
        assert.equal(asked.length, 1);
    }
    /**
     * @return {Promise<object>}
     */
    const worded = async () => ({ status: '200', text: async () => JSON.stringify({ messages: [], nextCursor: null }) });
    assert.equal((await failureOf(latest(worded))).message, SHAPE);
});

test('the walk waits for its pauses', async () => {
    const gates = [];
    /**
     * @param {number} milliseconds
     * @return {Promise<void>}
     */
    const pause = (milliseconds) => {
        if (milliseconds === TIMEOUT) {
            return never();
        }
        const gate = deferred();
        gates.push({ milliseconds, gate });
        return gate.promise;
    };
    const flaky = FakeZeta.scripted([
        FakeZeta.reply(500, 'Server error'),
        FakeZeta.reply(503, 'Unavailable'),
        FakeZeta.page([said('t2', 2)], 'p2'),
        FakeZeta.page([said('t1', 1)], null),
    ]);
    const reading = walk(flaky.fetch, { pause });
    const expected = [[1, 2000], [2, 4000], [3, 500]];
    for (const [requests, milliseconds] of expected) {
        await settle();
        await settle();
        assert.equal(flaky.requests.length, requests);
        assert.equal(gates.length, requests);
        assert.equal(gates.at(-1).milliseconds, milliseconds);
        gates.at(-1).gate.resolve();
        await settle();
        assert.equal(flaky.requests.length, requests + 1);
    }
    const result = await reading;
    assert.deepEqual(ids(result.messages), ['t1', 't2']);
    assert.equal(flaky.requests.length, 4);
});

test('skipped messages are summed over pages', async () => {
    /**
     * @param {number} minute
     * @return {object}
     */
    const nameless = (minute) => {
        const message = said('gone', minute);
        delete message.id;
        return message;
    };
    const { fetch } = FakeZeta.scripted([
        FakeZeta.page([said('s3', 3), nameless(3), nameless(3)], 'p2'),
        FakeZeta.page([said('s2', 2), nameless(2), nameless(2)], 'p3'),
        FakeZeta.page([said('s1', 1), nameless(1), nameless(1)], null),
    ]);
    const result = await walk(fetch);
    assert.equal(result.skipped, 6);
    assert.deepEqual(ids(result.messages), ['s1', 's2', 's3']);
});

/**
 * @param {*} body
 * @return {{ status: number, ok: boolean, text: () => Promise<string> }}
 */
function json(body) {
    return FakeZeta.reply(200, JSON.stringify(body));
}

/**
 * @param {*} value
 * @return {*}
 */
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

/**
 * @param {Function} fetch
 * @param {object} extra
 * @return {Promise<object>}
 */
function storyOf(fetch, extra = {}) {
    return ZetaSource.story({ fetch, token: TOKEN, roomId: FakeZeta.Room, pause: rest, ...extra });
}

/**
 * @param {Function} fetch
 * @param {object} extra
 * @return {Promise<string>}
 */
function profileOf(fetch, extra = {}, plotId = 'p1') {
    return ZetaSource.profile({ fetch, token: TOKEN, roomId: FakeZeta.Room, pause: rest, ...extra }, plotId);
}

test('the story is read from the room alone, with the token and encoded id', async () => {
    const read = FakeZeta.scripted([
        json({
            id: 'a b/c',
            plot: {
                id: 'p q/r',
                characters: [
                    { name: 'Mavan the Gray', description: 'An old wizard with long grey hair.' },
                    { name: 'Thessaly' },
                    { name: '', description: 'nameless' },
                    { description: 'no name at all' },
                    'Selene',
                    null,
                    { name: 7, description: 'a number for a name' },
                    { name: 'Veyra', description: 42 },
                ],
            },
        }),
        json({ characters: [{ name: 'Never read' }] }),
    ]);
    const story = await storyOf(read.fetch, { roomId: 'a b/c' });
    assert.deepEqual(plain(story), {
        characters: [
            { name: 'Mavan the Gray', description: 'An old wizard with long grey hair.' },
            { name: 'Thessaly', description: '' },
            { name: 'Veyra', description: '' },
        ],
        plotId: 'p q/r',
    });
    assert.equal(Object.isFrozen(story), true);
    assert.equal(Object.isFrozen(story.characters), true);
    assert.equal(Object.isFrozen(story.characters[0]), true);
    assert.deepEqual(
        read.requests.map((request) => request.url),
        [`${API}/v1/rooms/a%20b%2Fc`],
    );
    for (const request of read.requests) {
        assert.equal(request.options.headers.Authorization, TOKEN);
        assert.equal(Object.keys(request.options).join(), 'headers');
    }
});

test('the story takes the characters from the room body as Zeta sends it, with no plot request', async () => {
    const zeta = new FakeZeta([]);
    zeta.characters = [
        { name: 'Mavan the Gray', description: 'An old wizard.' },
        { name: 'Thessaly', description: 'A harbour guard.' },
    ];
    const story = await storyOf(zeta.fetch);
    assert.deepEqual(plain(story), { characters: zeta.characters, plotId: FakeZeta.Plot });
    assert.deepEqual(
        zeta.requests.map((request) => request.url),
        [`${API}/v1/rooms/${FakeZeta.Room}`],
    );
    assert.equal(
        zeta.requests.some((request) => request.url.includes('/v1/plots/') && !request.url.includes('/rooms/')),
        false,
    );
    const body = zeta.roomBody();
    assert.equal(Object.hasOwn(body, 'plotId'), false);
    assert.equal(body.plot.characters[0].plotId, FakeZeta.Plot);
    const bare = FakeZeta.scripted([json({ id: 'abc', title: 'No plot here', isActive: true })]);
    const error = await failureOf(storyOf(bare.fetch));
    assert.equal(error.message, 'Zeta named no story for this chat');
    assert.equal(bare.requests.length, 1);
});

test('the plot id may be a number or sit under plot', async () => {
    for (const [room, plot] of [
        [{ plotId: 12, plot: { characters: [] } }, '12'],
        [{ plotId: 0, plot: { characters: [] } }, '0'],
        [{ plot: { id: 'p9', characters: [] } }, 'p9'],
        [{ plotId: '', plot: { id: 'p8', characters: [] } }, 'p8'],
        [{ plotId: null, plot: { id: 4.5, characters: [] } }, '4.5'],
        [{ plotId: 'first', plot: { id: 'second', characters: [] } }, 'first'],
    ]) {
        const read = FakeZeta.scripted([json(room), json({ characters: [] })]);
        const story = await storyOf(read.fetch);
        assert.deepEqual(plain(story), { characters: [], plotId: plot }, JSON.stringify(room));
        assert.equal(read.requests.length, 1, JSON.stringify(room));
    }
    assert.equal(ZetaSource.plotOf({ plot: 'p1' }), null);
    assert.equal(ZetaSource.plotOf({ plotId: true }), null);
    assert.equal(ZetaSource.plotOf(null), null);
    assert.equal(ZetaSource.plotOf([{ plotId: 'p1' }]), null);
});

test('no plot id, or a plot without its characters, is a failure that is not retried', async () => {
    for (const room of [{}, { plotId: '' }, { plot: { id: '' } }, { plot: null }, 'not an object']) {
        const read = FakeZeta.scripted([json(room), json({ characters: [] })]);
        const error = await failureOf(storyOf(read.fetch));
        assert.equal(error.message, 'Zeta named no story for this chat', JSON.stringify(room));
        assert.equal(error.retryable, false);
        assert.equal(read.requests.length, 1);
    }
    const garbled = FakeZeta.scripted([FakeZeta.reply(200, 'not json'), json({ characters: [] })]);
    assert.equal((await failureOf(storyOf(garbled.fetch))).message, 'Zeta named no story for this chat');
    for (const plot of [{}, { characters: 'Mavan' }, { characters: { 0: 'Mavan' } }, { characters: null }, null, [], 'text']) {
        const read = FakeZeta.scripted([json({ plotId: 'p1', plot }), json({ characters: [] })]);
        const error = await failureOf(storyOf(read.fetch));
        assert.equal(error.message, SHAPE, JSON.stringify(plot));
        assert.equal(error.retryable, false);
        assert.equal(read.requests.length, 1);
    }
});

test('a story read gives up on 404 at once and retries 429 up to the limit', async () => {
    for (const status of [401, 404]) {
        const paused = recorder();
        const read = FakeZeta.scripted([FakeZeta.reply(status, 'No'), json({ plotId: 'p1' })]);
        const error = await failureOf(storyOf(read.fetch, { pause: paused.pause }));
        assert.equal(error.message, `Zeta answered HTTP ${status}`);
        assert.equal(read.requests.length, 1);
        assert.deepEqual(paused.paused, []);
    }
    const busy = recorder();
    const crowded = FakeZeta.scripted([
        FakeZeta.reply(429, 'Slow down'),
        FakeZeta.reply(429, 'Slow down'),
        FakeZeta.reply(429, 'Slow down'),
        json({ plotId: 'p1' }),
    ]);
    const error = await failureOf(storyOf(crowded.fetch, { pause: busy.pause }));
    assert.equal(error.message, 'Zeta answered HTTP 429');
    assert.equal(crowded.requests.length, 3);
    assert.deepEqual(busy.paused, [2000, 4000]);
    const patient = recorder();
    const recovered = FakeZeta.scripted([
        FakeZeta.reply(429, 'Slow down'),
        FakeZeta.reply(503, 'Unavailable'),
        json({ plot: { id: 'p1', characters: [{ name: 'Mavan' }] } }),
    ]);
    const story = await storyOf(recovered.fetch, { pause: patient.pause });
    assert.deepEqual(plain(story), { characters: [{ name: 'Mavan', description: '' }], plotId: 'p1' });
    assert.equal(recovered.requests.length, 3);
    assert.deepEqual(patient.paused, [2000, 4000]);
});

test('no token, no room or no pause means no request', async () => {
    for (const [extra, words] of [
        [{ token: null }, 'No login seen yet'],
        [{ token: '' }, 'No login seen yet'],
        [{ roomId: null }, 'No chat is open'],
        [{ pause: null }, NO_PAUSE],
    ]) {
        for (const reader of [storyOf, profileOf]) {
            const read = FakeZeta.scripted([json({ plotId: 'p1' }), json({ characters: [] })]);
            const error = await failureOf(reader(read.fetch, extra));
            assert.equal(error.message, words, JSON.stringify(extra));
            assert.equal(error.retryable, false);
            assert.equal(read.requests.length, 0);
        }
    }
});

test('the profile is the selected persona, read from the plot and room with the token and encoded ids', async () => {
    const read = FakeZeta.scripted([json({ name: ' Frost ', profileImageUrl: null, description: '  A ranger.\n  ' })]);
    assert.equal(await profileOf(read.fetch, { roomId: 'a b/c' }, 'p q/r'), 'Frost: A ranger.');
    assert.deepEqual(
        read.requests.map((request) => request.url),
        [`${API}/v1/plots/p%20q%2Fr/rooms/a%20b%2Fc/user-personas/selected`],
    );
    assert.equal(read.requests[0].options.headers.Authorization, TOKEN);
    const deseret = String.fromCodePoint(0x10400);
    const long = FakeZeta.scripted([json({ name: 'N', description: `${deseret.repeat(1999)}xyz` })]);
    const capped = await profileOf(long.fetch);
    assert.equal(Array.from(capped).length, 2000);
    assert.equal(capped, `N: ${deseret.repeat(1997)}`);
    const exact = FakeZeta.scripted([json({ description: 'y'.repeat(2000) })]);
    assert.equal(await profileOf(exact.fetch), 'y'.repeat(2000));
});

test('a persona with an empty or missing name gives just its description', async () => {
    for (const body of [
        { name: '', description: 'Alone.' },
        { name: '   ', description: 'Alone.' },
        { description: 'Alone.' },
        { name: 5, description: 'Alone.' },
        { name: null, description: 'Alone.' },
    ]) {
        const read = FakeZeta.scripted([json(body)]);
        assert.equal(await profileOf(read.fetch), 'Alone.', JSON.stringify(body));
    }
});

test('a persona with an empty description is null; one with no usable description says so; neither is retried', async () => {
    for (const body of [
        { name: 'Frost', description: '' },
        { name: 'Frost', description: '  \n ' },
        { name: 'Frost', description: null },
        { name: 'Frost' },
        {},
        { data: { description: 'x' } },
    ]) {
        const read = FakeZeta.scripted([json(body), json({ name: 'Late', description: 'late' })]);
        assert.equal(await profileOf(read.fetch), null, JSON.stringify(body));
        assert.equal(read.requests.length, 1);
    }
    for (const body of [null, [], 'text', 7, { name: 'Frost', description: 7 }]) {
        const read = FakeZeta.scripted([json(body), json({ name: 'Late', description: 'late' })]);
        const error = await failureOf(profileOf(read.fetch));
        const shaped = error.message.startsWith('Zeta answered the chat profile in an unexpected shape');
        assert.equal(shaped, true, JSON.stringify(body));
        assert.equal(read.requests.length, 1);
    }
    const garbled = FakeZeta.scripted([FakeZeta.reply(200, '<html>not json</html>')]);
    const odd = await failureOf(profileOf(garbled.fetch));
    assert.equal(typeof odd.message, 'string');
    assert.notEqual(odd.message, '');
});

test('a room without the plot characters still gives the plot id, so the profile can be read', async () => {
    const roomed = FakeZeta.scripted([json({ id: 'harbour', plot: { id: 'plot-7', name: 'A tale' } })]);
    const error = await failureOf(storyOf(roomed.fetch));
    assert.equal(error.message.startsWith('Zeta answered in an unexpected shape'), true, error.message);
    assert.equal(error.plotId, 'plot-7');
});

test('a persona 404 is null at once, any other failure throws, and 429 is retried', async () => {
    const paused = recorder();
    const gone = FakeZeta.scripted([FakeZeta.reply(404, 'No persona'), json({ description: 'late' })]);
    assert.equal(await profileOf(gone.fetch, { pause: paused.pause }), null);
    assert.equal(gone.requests.length, 1);
    assert.deepEqual(paused.paused, []);
    const broken = FakeZeta.scripted([
        FakeZeta.reply(500, 'Broken'),
        FakeZeta.reply(500, 'Broken'),
        FakeZeta.reply(500, 'Broken'),
        json({ description: 'late' }),
    ]);
    const error = await failureOf(profileOf(broken.fetch));
    assert.equal(error.message, 'Zeta answered HTTP 500');
    assert.equal(broken.requests.length, 3);
    const refused = FakeZeta.scripted([FakeZeta.reply(401, 'No'), json({ description: 'late' })]);
    assert.equal((await failureOf(profileOf(refused.fetch))).message, 'Zeta answered HTTP 401');
    assert.equal(refused.requests.length, 1);
    const slow = recorder();
    const crowded = FakeZeta.scripted([FakeZeta.reply(429, 'Slow down'), json({ description: 'At last.' })]);
    assert.equal(await profileOf(crowded.fetch, { pause: slow.pause }), 'At last.');
    assert.deepEqual(slow.paused, [2000]);
});

test('no plot id means no persona request, and the old chat-profile route is never read', async () => {
    for (const plotId of [null, '']) {
        const read = FakeZeta.scripted([json({ name: 'Frost', description: 'A ranger.' })]);
        assert.equal(await profileOf(read.fetch, {}, plotId), null);
        assert.equal(read.requests.length, 0);
    }
    const zeta = new FakeZeta([]);
    assert.equal(await profileOf(zeta.fetch, {}, FakeZeta.Plot), `Orla: ${FakeZeta.Profile}`);
    assert.equal(await ZetaSource.profile({ fetch: zeta.fetch, token: TOKEN, roomId: FakeZeta.Room, pause: rest }), null);
    assert.equal(zeta.requests.length, 1);
    assert.equal(
        zeta.requests.some((request) => request.url.includes('user-plot-chat-profiles')),
        false,
    );
});

test('the fake site serves the room, the plot and the persona', async () => {
    const zeta = new FakeZeta([]);
    zeta.characters = [{ name: 'Mavan the Gray', description: 'An old wizard.' }];
    const story = await storyOf(zeta.fetch);
    assert.deepEqual(plain(story), {
        characters: [{ name: 'Mavan the Gray', description: 'An old wizard.' }],
        plotId: FakeZeta.Plot,
    });
    assert.equal(await profileOf(zeta.fetch, {}, story.plotId), `Orla: ${FakeZeta.Profile}`);
    zeta.persona = '';
    assert.equal(await profileOf(zeta.fetch, {}, story.plotId), FakeZeta.Profile);
    zeta.plot = null;
    zeta.profile = null;
    assert.equal((await failureOf(storyOf(zeta.fetch))).message, 'Zeta answered HTTP 404');
    assert.equal(await profileOf(zeta.fetch), null);
    const stranger = await failureOf(storyOf(zeta.fetch, { token: bearer('stranger') }));
    assert.equal(stranger.message, 'Zeta answered HTTP 401');
});
