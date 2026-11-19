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
    const context = vm.createContext({ URL, URLSearchParams });
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
