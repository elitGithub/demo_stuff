import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import FakeScribeWorker from './support/FakeScribeWorker.mjs';
import FakeStorage from './support/FakeStorage.mjs';
import FakeTimers from './support/FakeTimers.mjs';

/**
 * @return {Object<string, object>}
 */
function load() {
    const context = vm.createContext({ TextEncoder, URL, URLSearchParams });
    const loaded = {};
    for (const name of ['ScribeStore', 'ScribeKeeper', 'ScribeCloud']) {
        const url = new URL(`../scribe/page/${name}.js`, import.meta.url);
        vm.runInContext(readFileSync(url, 'utf8'), context, { filename: url.pathname });
        loaded[name] = vm.runInContext(name, context);
    }
    return loaded;
}

const { ScribeStore, ScribeCloud } = load();
const ROOM = 'harbour';
const CLOUD_ROOM = '/rooms/harbour';
const NOTES_ROOM = '/rooms/harbour/play';
const DAY = '2026-11-18';
const NEXT_DAY = '2026-11-19';
const START = Date.parse('2026-11-18T10:00:00.000Z');
const KEY = FakeScribeWorker.Key;
const OTHER = 'Fictional-Browser-Z-9999';
const LEASE = '/v1/scribe/lease';
const HEADS = '/v1/scribe';
const PART = '/v1/scribe/part';
const COMMIT = '/v1/scribe/commit';
const SPEND = '/v1/scribe/spend';
const NOTES = '/v1/memory';
const TURNS = 30;
const MOST_STEPS = 2000;
const SETTINGS = Object.freeze({ edition: 1, budget: 3, size: 30 });
const LOG = Object.freeze({ version: 1, nextFact: 1, nextSubject: 1, nextThread: 1, nextQuestion: 1,
    nextSequence: 2, revision: 1, entries: [], notes: [] });
const BOOK = Object.freeze({ log: { ...LOG, read: { m1: 1, m2: 1, m3: 1 } }, fingerprints: {}, adopted: true });
const OTHER_BOOK = Object.freeze({ ...BOOK, log: { ...LOG, read: { m1: 1, m2: 1, m3: 1, m4: 1, m5: 1 } } });
const LIVE = Object.freeze({ findings: [], ready: null, seen: { id: 'm3' } });
const OTHER_LIVE = Object.freeze({ findings: [], ready: 'The book says so.', seen: { id: 'm5' } });
const CONFLICT_BODY = Object.freeze({
    error: { code: 'revision_conflict', message: 'The book changed elsewhere. Read it again before saving.' },
});
const LOST_BODY = Object.freeze({ error: { code: 'lease_lost', message: 'Another browser holds the lease for this room.' } });
const MISSING_BODY = Object.freeze({ error: { code: 'parts_missing', message: 'Some staged parts are missing. Send them again.' } });
const DOWN_BODY = Object.freeze({ error: { code: 'database_unavailable', message: 'Scribe storage is temporarily unavailable.' } });
const LIMITED_BODY = Object.freeze({ error: { code: 'rate_limited', message: 'Too many requests. Retry later.' } });
const NOT_FOUND_BODY = Object.freeze({ error: { code: 'not_found', message: 'Endpoint not found.' } });

/**
 * @return {Promise<void>}
 */
async function flush() {
    for (let turn = 0; turn < TURNS; turn++) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

/**
 * @param {FakeTimers} timers
 * @param {number} milliseconds
 * @return {Promise<void>}
 */
async function pass(timers, milliseconds) {
    await flush();
    const target = timers.now() + milliseconds;
    for (let step = 0; step < MOST_STEPS; step++) {
        const next = timers.next;
        if (next === null || next > target) {
            timers.advance(target - timers.now());
            await flush();
            return;
        }
        timers.advance(Math.max(0, next - timers.now()));
        await flush();
    }
    assert.fail('Time did not come to rest');
}

/**
 * @return {{ timers: FakeTimers, worker: FakeScribeWorker, delay: (details: object) => number }}
 */
function world() {
    const timers = new FakeTimers(START);
    return { timers, worker: new FakeScribeWorker(timers), delay: () => 0 };
}

/**
 * @param {{ timers: FakeTimers, worker: FakeScribeWorker, delay: (details: object) => number }} place
 * @param {{ name?: string, storage?: FakeStorage, keyed?: boolean, key?: string, kinds?: Object<string, object>, follow?: boolean }} choices
 * @return {object}
 */
function computer(place, choices = {}) {
    const storage = choices.storage ?? new FakeStorage();
    const name = choices.name ?? 'A';
    if (choices.keyed !== false && choices.storage === undefined) {
        ScribeStore.setCloudKey(storage, choices.key ?? KEY);
    }
    for (const [kind, value] of Object.entries(choices.kinds ?? {})) {
        ScribeStore.write(storage, ROOM, kind, value);
    }
    const follow = choices.follow === true;
    const pc = {
        name,
        storage,
        reader: false,
        busy: false,
        reading: false,
        chosen: true,
        notified: 0,
        made: 0,
        cloud: null,
        asleep: false,
        dropping: false,
        holding: null,
        skew: 0,
        overdue: [],
        trail: [],
    };
    pc.open = () => {
        pc.cloud = ScribeCloud.open({
            storage,
            roomId: ROOM,
            notesRoom: NOTES_ROOM,
            xmlHttpRequest: (details) => {
                if (pc.dropping) {
                    return { abort: () => undefined };
                }
                if (pc.holding === new URL(details.url).pathname) {
                    return place.worker.request({
                        ...details,
                        onload: (response) => {
                            pc.overdue.push(() => details.onload(response));
                        },
                    });
                }
                const wait = place.delay(details);
                if (wait === 0) {
                    return place.worker.request(details);
                }
                return place.worker.request({
                    ...details,
                    onload: (response) => {
                        place.timers.setTimeout(() => details.onload(response), wait);
                    },
                });
            },
            clock: {
                now: () => place.timers.now() + pc.skew,
                today: () => (place.timers.now() >= Date.parse(`${NEXT_DAY}T00:00:00.000Z`) ? NEXT_DAY : DAY),
            },
            random: () => {
                pc.made++;
                return `Fictional-Browser-${name}-${String(pc.made).padStart(4, '0')}`;
            },
            later: (milliseconds, action) => {
                place.timers.setTimeout(() => {
                    if (pc.asleep) {
                        pc.overdue.push(action);
                        return;
                    }
                    action();
                }, milliseconds);
            },
            chosen: () => pc.chosen,
            reader: () => pc.reader,
            busy: () => pc.busy,
            reading: () => pc.reading,
            notify: () => {
                pc.notified++;
                pc.trail.push(`${pc.cloud.view().phase}:${pc.cloud.leads()}`);
                if (follow) {
                    pc.reader = pc.cloud.leads();
                }
            },
        });
        return pc.cloud;
    };
    pc.open();
    return pc;
}

/**
 * @param {object} pc
 * @return {Promise<void>}
 */
async function wake(pc) {
    pc.asleep = false;
    pc.holding = null;
    for (const action of pc.overdue.splice(0)) {
        action();
        await flush();
    }
}

/**
 * @param {object} pc
 * @param {string} kind
 * @return {string|null}
 */
function localText(pc, kind) {
    return ScribeStore.snapshot(pc.storage, ROOM, kind)?.text ?? null;
}

/**
 * @param {FakeScribeWorker} worker
 * @param {string} path
 * @param {string|null} method
 * @return {object[]}
 */
function bodies(worker, path, method = null) {
    return worker.calls(path, method).map((entry) => JSON.parse(entry.body));
}

/**
 * @param {string} text
 * @return {string}
 */
function sha(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * @param {object} place
 * @param {object} choices
 * @return {Promise<object>}
 */
async function leading(place, choices = {}) {
    const pc = computer(place, { kinds: { settings: SETTINGS, book: BOOK, live: LIVE }, ...choices });
    await pc.cloud.tick();
    assert.equal(pc.cloud.view().phase, 'Leading');
    return pc;
}

/**
 * @param {object} pc
 * @param {string} kind
 * @param {object} value
 * @return {void}
 */
function save(pc, kind, value) {
    ScribeStore.write(pc.storage, ROOM, kind, value);
}

/**
 * @param {object} place
 * @param {object} pc
 * @param {string} kind
 * @param {object} value
 * @return {Promise<void>}
 */
async function changed(place, pc, kind, value) {
    save(pc, kind, value);
    await pc.cloud.stir();
    await pass(place.timers, 2000);
}

/**
 * @param {*} value
 * @return {*}
 */
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

test('local only: no key, no request, no browser ID, no synced record', async () => {
    const place = world();
    const pc = computer(place, { keyed: false, kinds: { settings: SETTINGS, book: BOOK } });
    const before = pc.storage.count('set');
    for (let tick = 0; tick < 4320; tick++) {
        await pc.cloud.tick();
        await pc.cloud.stir();
        assert.equal(pc.cloud.leads(), true);
        place.timers.advance(20000);
    }
    assert.deepEqual(place.worker.log, []);
    assert.equal(pc.made, 0);
    assert.equal(pc.storage.count('set'), before);
    assert.equal(pc.storage.values.has('scribe:browser'), false);
    assert.equal(pc.storage.values.has('scribe:synced:harbour'), false);
    assert.equal(pc.cloud.view().keyed, false);
    assert.equal(pc.cloud.view().phase, 'Off');
    assert.equal(pc.cloud.view().unsent, 0);
    assert.equal(pc.cloud.notes(), null);
    assert.equal(pc.notified, 0);
});

test('opening: loading at once, the lease before the heads, moved kinds downloaded part by part', async () => {
    const place = world();
    const book = JSON.stringify({ ...BOOK, notes: 'y'.repeat(500000) });
    const pieces = ScribeStore.pieces(book, 400000);
    assert.equal(pieces.length, 2);
    place.worker.seed(CLOUD_ROOM, 'book', 4, pieces);
    place.worker.seed(CLOUD_ROOM, 'settings', 2, [JSON.stringify(SETTINGS)]);
    const watcher = computer(place);
    watcher.chosen = false;
    await watcher.cloud.tick();
    assert.equal(place.worker.log.length, 0);
    assert.equal(watcher.cloud.view().phase, 'Idle');
    assert.equal(watcher.cloud.leads(), false);
    const pc = computer(place, { name: 'B' });
    assert.equal(pc.cloud.leads(), false);
    const ticking = pc.cloud.tick();
    assert.equal(pc.cloud.view().phase, 'Loading');
    assert.equal(pc.notified, 1);
    await ticking;
    const paths = place.worker.log.map((entry) => `${entry.method} ${entry.path}`);
    assert.deepEqual(paths.slice(0, 5), [`POST ${LEASE}`, `GET ${HEADS}`, `GET ${PART}`, `GET ${PART}`, `GET ${PART}`]);
    assert.deepEqual(
        place.worker.calls(PART).map((entry) => [entry.query.kind, entry.query.revision, entry.query.part]),
        [['settings', '2', '0'], ['book', '4', '0'], ['book', '4', '1']],
    );
    assert.equal(localText(pc, 'book'), book);
    assert.equal(localText(pc, 'settings'), JSON.stringify(SETTINGS));
    assert.equal(localText(pc, 'live'), null);
    assert.deepEqual(plain(ScribeStore.synced(pc.storage, ROOM)), {
        settings: { revision: 2, generation: ScribeStore.generation(pc.storage, ROOM, 'settings') },
        book: { revision: 4, generation: ScribeStore.generation(pc.storage, ROOM, 'book') },
    });
    assert.equal(pc.cloud.view().phase, 'Leading');
    assert.equal(pc.cloud.leads(), true);
    assert.equal(pc.notified >= 2, true);
    assert.equal(place.worker.calls(PART, 'PUT').length, 0);
});

test('two PCs: the first upload goes in one commit, the second PC opens the same book', async () => {
    const place = world();
    const pcA = await leading(place);
    const paths = place.worker.log.map((entry) => `${entry.method} ${entry.path}`);
    assert.deepEqual(paths.slice(0, 6), [`POST ${LEASE}`, `GET ${HEADS}`, `PUT ${PART}`, `PUT ${PART}`, `PUT ${PART}`, `POST ${COMMIT}`]);
    const [commit] = bodies(place.worker, COMMIT);
    assert.deepEqual(
        commit.kinds.map((change) => [change.kind, change.expectedRevision, change.revision, change.digests.length]),
        [['settings', 0, 1, 1], ['book', 0, 1, 1], ['live', 0, 1, 1]],
    );
    assert.deepEqual(commit.done, []);
    assert.equal(commit.kinds[1].digests[0], sha(localText(pcA, 'book')));
    for (const kind of ['settings', 'book', 'live']) {
        assert.equal(place.worker.textOf(CLOUD_ROOM, kind), localText(pcA, kind));
    }
    assert.equal(pcA.cloud.view().unsent, 0);
    const pcB = computer(place, { name: 'B' });
    await pcB.cloud.tick();
    assert.equal(pcB.cloud.view().phase, 'Watching');
    assert.equal(pcB.cloud.leads(), false);
    for (const kind of ['settings', 'book', 'live']) {
        assert.equal(localText(pcB, kind), localText(pcA, kind));
    }
    const parts = place.worker.calls(PART, 'GET').length;
    for (let tick = 0; tick < 3; tick++) {
        await pass(place.timers, 20000);
        await pcB.cloud.tick();
    }
    assert.equal(place.worker.calls(PART, 'GET').length, parts);
    assert.equal(place.worker.calls(PART, 'PUT').length, 3);
    assert.equal(pcB.cloud.view().phase, 'Watching');
});

test('15 s: a silent Worker turns offline at 15,000 ms and the unsent kinds go up when it answers', async () => {
    const place = world();
    const pc = computer(place, { kinds: { settings: SETTINGS, book: BOOK } });
    place.worker.silence();
    pc.cloud.tick();
    await flush();
    assert.equal(pc.cloud.view().phase, 'Loading');
    await pass(place.timers, 14999);
    assert.equal(pc.cloud.view().phase, 'Loading');
    assert.equal(pc.cloud.leads(), false);
    await pass(place.timers, 1);
    assert.equal(pc.cloud.view().phase, 'Offline');
    assert.equal(pc.cloud.leads(), true);
    place.worker.speak();
    await pc.cloud.tick();
    assert.equal(place.worker.calls(HEADS).length, 0);
    await pass(place.timers, 1000);
    await pc.cloud.tick();
    assert.equal(pc.cloud.view().phase, 'Leading');
    assert.equal(place.worker.calls(LEASE).length, 2);
    assert.equal(place.worker.calls(HEADS).length, 1);
    const [commit] = bodies(place.worker, COMMIT);
    assert.deepEqual(
        commit.kinds.map((change) => [change.kind, change.expectedRevision]),
        [['settings', 0], ['book', 0]],
    );
});

test('unsent work survives a reload', async () => {
    const place = world();
    const pc = await leading(place);
    save(pc, 'live', OTHER_LIVE);
    await pc.cloud.stir();
    const before = place.worker.log.length;
    pc.cloud.close();
    await pass(place.timers, 5000);
    assert.equal(place.worker.log.length, before);
    pc.open();
    await pc.cloud.tick();
    const commits = bodies(place.worker, COMMIT);
    assert.deepEqual(commits.at(-1).kinds.map((change) => [change.kind, change.expectedRevision, change.revision]), [['live', 1, 2]]);
    assert.equal(place.worker.textOf(CLOUD_ROOM, 'live'), JSON.stringify(OTHER_LIVE));
});

test('quiet time: two seconds after the last change, and never mid-reading for the book', async () => {
    const place = world();
    const pc = await leading(place);
    const puts = () => place.worker.calls(PART, 'PUT').length;
    save(pc, 'live', OTHER_LIVE);
    await pc.cloud.stir();
    await pass(place.timers, 1999);
    assert.equal(puts(), 3);
    await pass(place.timers, 1);
    assert.equal(puts(), 4);
    assert.equal(place.worker.calls(PART, 'PUT').at(-1).at, START + 2000);
    const moved = place.timers.now();
    save(pc, 'live', LIVE);
    await pc.cloud.stir();
    await pass(place.timers, 1500);
    save(pc, 'live', OTHER_LIVE);
    await pc.cloud.stir();
    await pass(place.timers, 1999);
    assert.equal(puts(), 4);
    await pass(place.timers, 1);
    assert.equal(puts(), 5);
    assert.equal(place.worker.calls(PART, 'PUT').at(-1).at, moved + 3500);
    pc.reading = true;
    save(pc, 'settings', { ...SETTINGS, edition: 2 });
    save(pc, 'book', OTHER_BOOK);
    await pc.cloud.stir();
    await pass(place.timers, 5000);
    await pc.cloud.stir();
    assert.equal(puts(), 5);
    pc.reading = false;
    await pass(place.timers, 100);
    await pc.cloud.stir();
    const commit = bodies(place.worker, COMMIT).at(-1);
    assert.deepEqual(commit.kinds.map((change) => change.kind), ['settings', 'book']);
    assert.equal(bodies(place.worker, COMMIT).length, 4);
});

test('splitting: parts never start with a low surrogate, and more than ten parts stay on this PC', async () => {
    const place = world();
    const content = `${'a'.repeat(399990)}𐍈${'a'.repeat(399998)}`;
    const value = { text: content };
    const text = JSON.stringify(value);
    assert.equal(text.length, 800001);
    assert.equal(text.charCodeAt(399999) >= 0xd800 && text.charCodeAt(399999) <= 0xdbff, true);
    const pc = computer(place, { kinds: { book: value } });
    await pc.cloud.tick();
    const staged = place.worker.calls(PART, 'PUT');
    assert.equal(staged.length, 3);
    for (const entry of staged) {
        const first = entry.body.charCodeAt(0);
        assert.equal(first >= 0xdc00 && first <= 0xdfff, false);
        assert.equal(entry.body.length <= 400000, true);
    }
    assert.equal(staged.map((entry) => entry.body).join(''), text);
    assert.equal(place.worker.textOf(CLOUD_ROOM, 'book'), text);
    const large = world();
    const heavy = computer(large, { kinds: { book: { text: 'b'.repeat(4000001) } } });
    await heavy.cloud.tick();
    assert.equal(large.worker.calls(PART, 'PUT').length, 0);
    assert.equal(large.worker.calls(COMMIT).length, 0);
    assert.equal(heavy.cloud.view().phase, 'Unusable');
    assert.equal(heavy.cloud.view().problem, 'The book is too large to keep in your Worker');
    assert.equal(heavy.cloud.leads(), true);
});

/**
 * @param {object} place
 * @param {object} pc
 * @param {object} cloudBook
 * @return {Promise<void>}
 */
async function conflicted(place, pc, cloudBook) {
    place.worker.seed(CLOUD_ROOM, 'book', 2, [JSON.stringify(cloudBook)]);
    place.worker.answer(PART, 200, { kind: 'book', revision: 2, part: 0, digest: sha('x') });
    place.worker.answer(COMMIT, 409, CONFLICT_BODY);
    await changed(place, pc, 'book', OTHER_BOOK);
}

test('conflict: a different cloud book asks, the same book is recorded', async () => {
    const place = world();
    const pc = await leading(place);
    const notified = pc.notified;
    await conflicted(place, pc, BOOK);
    assert.equal(pc.cloud.view().phase, 'Conflict');
    assert.deepEqual(plain(pc.cloud.view().conflict), { here: 5, there: 3 });
    assert.equal(pc.cloud.leads(), false);
    assert.equal(pc.notified > notified, true);
    const puts = place.worker.calls(PART, 'PUT').length;
    for (let tick = 0; tick < 3; tick++) {
        await pass(place.timers, 20000);
        await pc.cloud.tick();
    }
    assert.equal(place.worker.calls(PART, 'PUT').length, puts);
    assert.equal(pc.cloud.view().phase, 'Conflict');
    assert.equal(localText(pc, 'book'), JSON.stringify(OTHER_BOOK));
    const same = world();
    const twin = await leading(same);
    await conflicted(same, twin, OTHER_BOOK);
    assert.equal(twin.cloud.view().phase, 'Leading');
    assert.equal(twin.cloud.view().conflict, null);
    assert.deepEqual(plain(ScribeStore.synced(twin.storage, ROOM).book), {
        revision: 2,
        generation: ScribeStore.generation(twin.storage, ROOM, 'book'),
    });
    assert.equal(twin.cloud.view().unsent, 0);
});

test('conflict: Keep pushes over the cloud, Use the cloud takes it', async () => {
    const place = world();
    const pc = await leading(place);
    await conflicted(place, pc, BOOK);
    await pc.cloud.keep();
    assert.equal(pc.cloud.view().phase, 'Leading');
    assert.equal(pc.cloud.view().conflict, null);
    assert.equal(place.worker.revisionOf(CLOUD_ROOM, 'book'), 3);
    assert.equal(place.worker.textOf(CLOUD_ROOM, 'book'), JSON.stringify(OTHER_BOOK));
    assert.deepEqual(bodies(place.worker, COMMIT).at(-1).kinds.map((change) => [change.kind, change.expectedRevision]), [['book', 2]]);
    await assert.rejects(pc.cloud.keep(), { message: 'There is nothing to choose.' });
    await assert.rejects(pc.cloud.useCloud(), { message: 'There is nothing to choose.' });
    const other = world();
    const taker = await leading(other);
    await conflicted(other, taker, BOOK);
    const puts = other.worker.calls(PART, 'PUT').length;
    await taker.cloud.useCloud();
    assert.equal(taker.cloud.view().phase, 'Leading');
    assert.equal(taker.cloud.view().conflict, null);
    assert.equal(localText(taker, 'book'), JSON.stringify(BOOK));
    assert.deepEqual(plain(ScribeStore.synced(taker.storage, ROOM).book), {
        revision: 2,
        generation: ScribeStore.generation(taker.storage, ROOM, 'book'),
    });
    await pass(other.timers, 5000);
    await taker.cloud.tick();
    assert.equal(other.worker.calls(PART, 'PUT').length, puts);
    assert.equal(other.worker.revisionOf(CLOUD_ROOM, 'book'), 2);
});

test('conflict: Use the cloud that cannot reach the Worker says so and keeps the question', async () => {
    const place = world();
    const pc = await leading(place);
    await conflicted(place, pc, BOOK);
    place.worker.fail();
    await assert.rejects(pc.cloud.useCloud(), { message: 'Your Worker could not be reached; try again.' });
    assert.equal(pc.cloud.view().phase, 'Conflict');
    assert.equal(localText(pc, 'book'), JSON.stringify(OTHER_BOOK));
    place.worker.speak();
    await pass(place.timers, 2000);
    await pc.cloud.useCloud();
    assert.equal(pc.cloud.view().phase, 'Leading');
    assert.equal(localText(pc, 'book'), JSON.stringify(BOOK));
});

test('conflict: a newer head during Keep is pushed over without asking again', async () => {
    const place = world();
    const pc = await leading(place);
    await conflicted(place, pc, BOOK);
    place.worker.seed(CLOUD_ROOM, 'book', 3, [JSON.stringify({ ...BOOK, later: true })]);
    const phases = [];
    const tracked = pc.notified;
    await pc.cloud.keep();
    phases.push(pc.cloud.view().phase);
    await pass(place.timers, 3000);
    await pc.cloud.stir();
    phases.push(pc.cloud.view().phase);
    assert.deepEqual(phases, ['Leading', 'Leading']);
    assert.equal(pc.notified > tracked, true);
    assert.equal(place.worker.revisionOf(CLOUD_ROOM, 'book'), 4);
    assert.equal(place.worker.textOf(CLOUD_ROOM, 'book'), JSON.stringify(OTHER_BOOK));
    assert.equal(pc.cloud.view().conflict, null);
});

test('conflict: Keep while another PC reads waits for the lease', async () => {
    const place = world();
    const pcA = await leading(place);
    save(pcA, 'book', OTHER_BOOK);
    pcA.reading = true;
    await pcA.cloud.stir();
    await pass(place.timers, 91000);
    const pcB = computer(place, { name: 'B' });
    await pcB.cloud.tick();
    assert.equal(pcB.cloud.view().phase, 'Leading');
    await changed(place, pcB, 'book', { ...BOOK, fromB: true });
    assert.equal(place.worker.revisionOf(CLOUD_ROOM, 'book'), 2);
    await pcA.cloud.tick();
    assert.equal(pcA.cloud.view().phase, 'Conflict');
    assert.deepEqual(plain(pcA.cloud.view().conflict), { here: 5, there: 3 });
    await assert.rejects(pcA.cloud.keep(), {
        message: "Another PC is reading this chat; this PC's book is kept as soon as it lets go.",
    });
    assert.equal(pcA.cloud.view().phase, 'Conflict');
    pcB.cloud.close();
    await pass(place.timers, 20000);
    await pcA.cloud.tick();
    assert.equal(pcA.cloud.view().phase, 'Conflict');
    await pass(place.timers, 71000);
    pcA.reading = false;
    await pcA.cloud.tick();
    assert.equal(pcA.cloud.view().phase, 'Leading');
    assert.equal(place.worker.revisionOf(CLOUD_ROOM, 'book'), 3);
    assert.equal(place.worker.textOf(CLOUD_ROOM, 'book'), JSON.stringify(OTHER_BOOK));
});

/**
 * @param {object} place
 * @param {Object<string, object>} base
 * @return {object}
 */
function synchronised(place, base) {
    const pc = computer(place, { name: 'B', kinds: base });
    for (const kind of Object.keys(base)) {
        ScribeStore.setSynced(pc.storage, ROOM, kind, 1, ScribeStore.generation(pc.storage, ROOM, kind));
    }
    return pc;
}

/**
 * @param {object} place
 * @return {object}
 */
function startedOverElsewhere(place) {
    place.worker.seed(CLOUD_ROOM, 'settings', 2, [JSON.stringify({ ...SETTINGS, edition: 2 })]);
    place.worker.seed(CLOUD_ROOM, 'book', 2, [JSON.stringify({ ...BOOK, log: { ...LOG, read: { n1: 1, n2: 1 } } })]);
    place.worker.seed(CLOUD_ROOM, 'live', 2, [JSON.stringify(OTHER_LIVE)]);
    const pc = synchronised(place, { settings: SETTINGS, book: BOOK, live: LIVE });
    save(pc, 'settings', { ...SETTINGS, stop: 'Budget' });
    save(pc, 'book', OTHER_BOOK);
    return pc;
}

test("the answer covers all three kinds: nothing is replaced before it, Keep pushes this PC's three", async () => {
    const place = world();
    const pc = startedOverElsewhere(place);
    const mine = Object.fromEntries(['settings', 'book', 'live'].map((kind) => [kind, localText(pc, kind)]));
    await pc.cloud.tick();
    assert.equal(pc.cloud.view().phase, 'Conflict');
    assert.deepEqual(plain(pc.cloud.view().conflict), { here: 5, there: 2 });
    for (const kind of ['settings', 'book', 'live']) {
        assert.equal(localText(pc, kind), mine[kind], kind);
    }
    await pc.cloud.keep();
    assert.equal(pc.cloud.view().phase, 'Leading');
    assert.equal(pc.cloud.view().conflict, null);
    assert.deepEqual(
        bodies(place.worker, COMMIT).at(-1).kinds.map((change) => [change.kind, change.expectedRevision]),
        [['settings', 2], ['book', 2], ['live', 2]],
    );
    for (const kind of ['settings', 'book', 'live']) {
        assert.equal(place.worker.textOf(CLOUD_ROOM, kind), mine[kind], kind);
        assert.equal(place.worker.revisionOf(CLOUD_ROOM, kind), 3, kind);
        assert.equal(localText(pc, kind), mine[kind], kind);
    }
    assert.equal(pc.cloud.view().unsent, 0);
});

test("the answer covers all three kinds: Use the cloud's takes the three and leaves nothing unsent", async () => {
    const place = world();
    const pc = startedOverElsewhere(place);
    await pc.cloud.tick();
    assert.equal(pc.cloud.view().phase, 'Conflict');
    await pc.cloud.useCloud();
    assert.equal(pc.cloud.view().phase, 'Leading');
    assert.equal(pc.cloud.view().conflict, null);
    for (const kind of ['settings', 'book', 'live']) {
        assert.equal(localText(pc, kind), place.worker.textOf(CLOUD_ROOM, kind), kind);
    }
    assert.equal(pc.cloud.view().unsent, 0);
    const offline = world();
    offline.worker.seed(CLOUD_ROOM, 'settings', 1, [JSON.stringify(SETTINGS)]);
    const cloudBook = { ...BOOK, log: { ...LOG, read: { m1: 1, m2: 1, m3: 1, m4: 1 } } };
    offline.worker.seed(CLOUD_ROOM, 'book', 2, [JSON.stringify(cloudBook)]);
    const restarted = synchronised(offline, { settings: SETTINGS, book: { ...BOOK, log: { ...LOG, read: { m1: 1 } } } });
    save(restarted, 'settings', { ...SETTINGS, edition: 2 });
    save(restarted, 'book', { log: { ...LOG, read: {} }, fingerprints: {}, adopted: false });
    await restarted.cloud.tick();
    assert.equal(restarted.cloud.view().phase, 'Conflict');
    assert.deepEqual(plain(restarted.cloud.view().conflict), { here: 0, there: 4 });
    await restarted.cloud.useCloud();
    assert.equal(restarted.cloud.view().phase, 'Leading');
    assert.equal(localText(restarted, 'settings'), JSON.stringify(SETTINGS));
    assert.equal(localText(restarted, 'book'), offline.worker.textOf(CLOUD_ROOM, 'book'));
    assert.equal(restarted.cloud.view().unsent, 0);
    await pass(offline.timers, 5000);
    await restarted.cloud.stir();
    await restarted.cloud.tick();
    assert.equal(offline.worker.calls(PART, 'PUT').length, 0);
    assert.equal(offline.worker.revisionOf(CLOUD_ROOM, 'settings'), 1);
    assert.equal(offline.worker.textOf(CLOUD_ROOM, 'settings'), JSON.stringify(SETTINGS));
});

test('only live differs: pushed over with the lease, taken without it', async () => {
    const place = world();
    const pc = await leading(place);
    place.worker.seed(CLOUD_ROOM, 'live', 2, [JSON.stringify(OTHER_LIVE)]);
    await changed(place, pc, 'live', { ...LIVE, mine: true });
    assert.equal(pc.cloud.view().phase, 'Leading');
    assert.equal(ScribeStore.synced(pc.storage, ROOM).live.revision, 2);
    assert.equal(pc.cloud.view().unsent, 1);
    await pc.cloud.stir();
    assert.equal(place.worker.revisionOf(CLOUD_ROOM, 'live'), 3);
    assert.equal(place.worker.textOf(CLOUD_ROOM, 'live'), JSON.stringify({ ...LIVE, mine: true }));
    const other = world();
    const pcA = await leading(other);
    pcA.cloud.close();
    save(pcA, 'live', { ...LIVE, mine: true });
    other.worker.seed(CLOUD_ROOM, 'live', 2, [JSON.stringify(OTHER_LIVE)]);
    other.worker.hold(CLOUD_ROOM, OTHER);
    pcA.open();
    await pcA.cloud.tick();
    assert.equal(pcA.cloud.view().phase, 'Watching');
    assert.equal(localText(pcA, 'live'), JSON.stringify(OTHER_LIVE));
    assert.equal(ScribeStore.synced(pcA.storage, ROOM).live.revision, 2);
    assert.equal(pcA.cloud.view().unsent, 0);
});

test('losing the lease: a refused commit or renewal stops the writing', async () => {
    const place = world();
    const pc = await leading(place);
    place.worker.answer(COMMIT, 409, LOST_BODY);
    const notified = pc.notified;
    await changed(place, pc, 'live', OTHER_LIVE);
    assert.equal(pc.cloud.view().phase, 'Watching');
    assert.equal(pc.cloud.leads(), false);
    assert.equal(pc.notified > notified, true);
    place.worker.hold(CLOUD_ROOM, OTHER);
    const puts = place.worker.calls(PART, 'PUT').length;
    for (let tick = 0; tick < 3; tick++) {
        await pass(place.timers, 20000);
        await pc.cloud.tick();
        await pc.cloud.stir();
    }
    assert.equal(place.worker.calls(PART, 'PUT').length, puts);
    const other = world();
    const renewer = await leading(other);
    other.worker.hold(CLOUD_ROOM, OTHER);
    await pass(other.timers, 20000);
    await renewer.cloud.tick();
    assert.equal(renewer.cloud.view().phase, 'Watching');
    assert.equal(renewer.cloud.leads(), false);
    const third = world();
    const asker = await leading(third);
    asker.reading = true;
    save(asker, 'book', OTHER_BOOK);
    await asker.cloud.stir();
    third.worker.hold(CLOUD_ROOM, OTHER);
    third.worker.seed(CLOUD_ROOM, 'book', 2, [JSON.stringify(BOOK)]);
    await pass(third.timers, 20000);
    await asker.cloud.tick();
    assert.equal(asker.cloud.view().phase, 'Conflict');
    assert.deepEqual(plain(asker.cloud.view().conflict), { here: 5, there: 3 });
});

test('a lapsed lease stops leading at once, and the next tick settles before it leads again', async () => {
    for (const stays of [false, true]) {
        const place = world();
        const pcA = await leading(place);
        await pass(place.timers, 89999);
        assert.equal(pcA.cloud.leads(), true);
        await pass(place.timers, 1);
        assert.equal(pcA.cloud.leads(), false);
        await pass(place.timers, 3600000);
        const pcB = computer(place, { name: 'B' });
        await pcB.cloud.tick();
        assert.equal(pcB.cloud.view().phase, 'Leading');
        await changed(place, pcB, 'book', OTHER_BOOK);
        assert.equal(place.worker.revisionOf(CLOUD_ROOM, 'book'), 2);
        if (!stays) {
            pcB.cloud.close();
            await pass(place.timers, 91000);
        }
        assert.equal(pcA.cloud.view().phase, 'Leading');
        assert.equal(pcA.cloud.leads(), false);
        const before = place.worker.log.length;
        const ticking = pcA.cloud.tick();
        assert.equal(pcA.cloud.view().phase, 'Loading');
        assert.equal(pcA.cloud.leads(), false);
        await ticking;
        const paths = place.worker.log.slice(before).map((entry) => `${entry.method} ${entry.path}`);
        assert.deepEqual(paths.slice(0, 3), [`POST ${LEASE}`, `GET ${HEADS}`, `GET ${PART}`]);
        assert.equal(localText(pcA, 'book'), JSON.stringify(OTHER_BOOK));
        assert.equal(pcA.cloud.view().phase, stays ? 'Watching' : 'Leading');
        assert.equal(pcA.cloud.leads(), !stays);
        if (!stays) {
            await changed(place, pcA, 'book', { ...OTHER_BOOK, fromA: true });
            assert.equal(pcA.cloud.view().phase, 'Leading');
            assert.equal(place.worker.revisionOf(CLOUD_ROOM, 'book'), 3);
            assert.equal(place.worker.textOf(CLOUD_ROOM, 'book'), JSON.stringify({ ...OTHER_BOOK, fromA: true }));
        }
    }
});

/**
 * @param {FakeScribeWorker} worker
 * @param {number} from
 * @return {Set<string>}
 */
function browsersSince(worker, from) {
    const browsers = new Set();
    for (const entry of worker.log.slice(from)) {
        const body = entry.body !== null && entry.method !== 'PUT' ? JSON.parse(entry.body) : null;
        const browser = entry.query.browser ?? body?.browser;
        if (browser !== undefined) {
            browsers.add(browser);
        }
    }
    return browsers;
}

test('two tabs that make the browser ID at the same moment end with one', async () => {
    const place = world();
    const storage = new FakeStorage();
    ScribeStore.setCloudKey(storage, KEY);
    const first = computer(place, { storage, name: 'T1' });
    const second = computer(place, { storage, name: 'T2' });
    await first.cloud.tick();
    assert.equal(storage.values.get('scribe:browser'), 'Fictional-Browser-T1-0001');
    storage.values.delete('scribe:browser');
    await second.cloud.tick();
    assert.equal(storage.values.get('scribe:browser'), 'Fictional-Browser-T2-0001');
    const from = place.worker.log.length;
    for (let tick = 0; tick < 3; tick++) {
        await pass(place.timers, 20000);
        await first.cloud.tick();
        await second.cloud.tick();
    }
    assert.equal(place.worker.log.length > from, true);
    assert.deepEqual([...browsersSince(place.worker, from)], ['Fictional-Browser-T2-0001']);
    assert.equal(storage.values.get('scribe:browser'), 'Fictional-Browser-T2-0001');
});

test('a tab whose browser ID was replaced uses the stored one, and leads once the old lease lapses', async () => {
    const place = world();
    const pc = await leading(place);
    const replaced = 'Fictional-Browser-Z-0002';
    pc.storage.set('scribe:browser', replaced);
    const from = place.worker.log.length;
    await pass(place.timers, 20000);
    await pc.cloud.tick();
    assert.equal(pc.cloud.view().phase, 'Watching');
    assert.equal(pc.cloud.leads(), false);
    for (let tick = 0; tick < 3; tick++) {
        await pass(place.timers, 20000);
        await pc.cloud.tick();
        assert.equal(pc.cloud.view().phase, 'Watching');
    }
    await pass(place.timers, 20000);
    await pc.cloud.tick();
    assert.equal(pc.cloud.view().phase, 'Leading');
    assert.equal(place.worker.leases.get(CLOUD_ROOM).browser, replaced);
    assert.deepEqual([...browsersSince(place.worker, from)], [replaced]);
});

const SAVED_BEFORE_SLEEP = Object.freeze({ ...BOOK, note: 'saved before sleep' });

/**
 * @param {string} flight
 * @param {boolean} stays
 * @return {Promise<{ place: object, pcA: object, pcB: object }>}
 */
async function asleepInFlight(flight, stays) {
    const place = world();
    const pcA = await leading(place);
    await pass(place.timers, 20000);
    await pcA.cloud.tick();
    await pass(place.timers, 18000);
    if (flight === 'upload') {
        pcA.dropping = true;
        await changed(place, pcA, 'book', SAVED_BEFORE_SLEEP);
    } else if (flight === 'commit') {
        pcA.holding = COMMIT;
        await changed(place, pcA, 'book', SAVED_BEFORE_SLEEP);
    } else {
        if (flight === 'limited') {
            place.worker.answer(LEASE, 429, LIMITED_BODY, false, 'retry-after: 30\r\n');
            pcA.holding = LEASE;
        } else {
            pcA.dropping = true;
        }
        await pass(place.timers, 2000);
        pcA.cloud.tick();
        await flush();
    }
    pcA.asleep = true;
    pcA.dropping = false;
    await pass(place.timers, 91000);
    const pcB = computer(place, { name: 'B' });
    await pcB.cloud.tick();
    assert.equal(pcB.cloud.view().phase, 'Leading');
    const landed = place.worker.revisionOf(CLOUD_ROOM, 'book');
    await changed(place, pcB, 'book', OTHER_BOOK);
    assert.equal(place.worker.revisionOf(CLOUD_ROOM, 'book'), landed + 1);
    if (!stays) {
        pcB.cloud.close();
    }
    await pass(place.timers, stays ? 20000 : 3600000);
    return { place, pcA, pcB };
}

/**
 * @param {{ place: object, pcA: object }} slept
 * @param {boolean} tickFirst
 * @return {Promise<{ paths: string[], trail: string[] }>}
 */
async function woken(slept, tickFirst) {
    const { place, pcA } = slept;
    const before = place.worker.log.length;
    const trail = pcA.trail.length;
    if (tickFirst) {
        const ticking = pcA.cloud.tick();
        await wake(pcA);
        await ticking;
    } else {
        await wake(pcA);
        await pcA.cloud.tick();
    }
    return {
        paths: place.worker.log.slice(before).map((entry) => `${entry.method} ${entry.path}`),
        trail: pcA.trail.slice(trail),
    };
}

test('a renewal in flight when the machine sleeps does not bring back leading on the old book', async () => {
    const slept = await asleepInFlight('renewal', false);
    const { paths, trail } = await woken(slept, false);
    assert.deepEqual(paths.slice(0, 3), [`POST ${LEASE}`, `GET ${HEADS}`, `GET ${PART}`]);
    assert.deepEqual(trail, ['Loading:false', 'Leading:true']);
    assert.equal(localText(slept.pcA, 'book'), JSON.stringify(OTHER_BOOK));
});

test('an upload in flight when the machine sleeps does not bring back leading on the old book', async () => {
    const slept = await asleepInFlight('upload', false);
    const { paths, trail } = await woken(slept, true);
    const pc = slept.pcA;
    assert.deepEqual(paths.slice(0, 3), [`POST ${LEASE}`, `GET ${HEADS}`, `GET ${PART}`]);
    assert.deepEqual(trail, ['Loading:false', 'Conflict:false']);
    assert.deepEqual(plain(pc.cloud.view().conflict), { here: 3, there: 5 });
    assert.equal(localText(pc, 'book'), JSON.stringify(SAVED_BEFORE_SLEEP));
    assert.equal(pc.cloud.leads(), false);
});

test('a PC that wakes before its network is caught by a try before the switch, or goes offline at it', async () => {
    const runs = [
        { stays: false, back: 5, tries: [0, 1000, 3000, 7000], leads: 7 },
        { stays: true, back: 5, tries: [0, 1000, 3000, 7000], leads: null },
        { stays: false, back: 12, tries: [0, 1000, 3000, 7000, 14000], leads: 14 },
        { stays: false, back: 14, tries: [0, 1000, 3000, 7000, 14000], leads: 14 },
        { stays: false, back: null, tries: [0, 1000, 3000, 7000, 14000], leads: 15 },
    ];
    for (const run of runs) {
        const back = run.back === null ? 'never' : `by ${run.back} s`;
        const label = `B ${run.stays ? 'stays' : 'has gone'}, network back ${back}`;
        const { place, pcA } = await asleepInFlight('renewal', run.stays);
        place.worker.fail();
        const woke = place.timers.now();
        await wake(pcA);
        const led = [];
        for (let second = 1; second <= 20; second++) {
            if (second === run.back) {
                place.worker.speak();
            }
            await pass(place.timers, 1000);
            led.push(pcA.cloud.leads());
        }
        const tries = place.worker.calls(LEASE).filter((entry) => entry.at >= woke).map((entry) => entry.at - woke);
        assert.deepEqual(tries, run.tries, label);
        assert.equal(led.indexOf(true), run.leads === null ? -1 : run.leads - 1, label);
        if (run.leads !== null) {
            assert.equal(led.slice(run.leads - 1).every((leads) => leads), true, label);
        }
        if (run.back === null) {
            assert.equal(pcA.cloud.view().phase, 'Offline', label);
            assert.equal(localText(pcA, 'book'), JSON.stringify(BOOK), label);
        } else {
            assert.equal(pcA.cloud.view().phase, run.stays ? 'Watching' : 'Leading', label);
            assert.equal(localText(pcA, 'book'), JSON.stringify(OTHER_BOOK), label);
        }
    }
});

test('the tries after a lapse are spaced and bounded even when the backoff list was spent before it', async () => {
    for (const broken of ['network', 'server']) {
        const place = world();
        place.worker.seed(CLOUD_ROOM, 'settings', 1, [JSON.stringify(SETTINGS)]);
        place.worker.seed(CLOUD_ROOM, 'book', 2, [JSON.stringify({ ...BOOK, log: { ...LOG, read: { m1: 1, m2: 1, c3: 1 } } })]);
        const pc = synchronised(place, { settings: SETTINGS, book: BOOK });
        save(pc, 'book', OTHER_BOOK);
        await pc.cloud.tick();
        assert.equal(pc.cloud.view().phase, 'Conflict', broken);
        if (broken === 'network') {
            place.worker.fail();
        } else {
            for (let answer = 0; answer < 100; answer++) {
                place.worker.answer(LEASE, 503, DOWN_BODY);
            }
        }
        for (let tick = 0; tick < 6; tick++) {
            await pass(place.timers, 20000);
            await pc.cloud.tick();
        }
        await pc.cloud.keep();
        assert.equal(pc.cloud.leads(), false, broken);
        const leases = place.worker.calls(LEASE).length;
        const from = place.timers.now();
        pc.cloud.tick();
        await flush();
        assert.equal(place.worker.calls(LEASE).length - leases <= 1, true, broken);
        await pass(place.timers, 20000);
        const tries = place.worker.calls(LEASE).slice(leases).map((entry) => entry.at - from);
        assert.deepEqual(tries, [1000, 2000, 4000, 8000, 14000], broken);
        assert.equal(pc.cloud.view().phase, 'Offline', broken);
    }
});

test('a slow Worker never holds the keeper past the 15 s switch, at opening or after a lapse', async () => {
    const place = world();
    const pc = computer(place, { follow: true, kinds: { settings: SETTINGS, book: BOOK, live: LIVE } });
    place.delay = () => 14900;
    pc.cloud.tick();
    await pass(place.timers, 14999);
    assert.equal(pc.cloud.view().phase, 'Loading');
    await pass(place.timers, 1);
    assert.equal(pc.cloud.view().phase, 'Offline');
    assert.equal(pc.cloud.leads(), true);
    await pass(place.timers, 15000);
    assert.equal(pc.cloud.view().phase, 'Leading');
    const { place: slept, pcA } = await asleepInFlight('renewal', false);
    slept.worker.fail();
    await wake(pcA);
    await pass(slept.timers, 13500);
    slept.worker.speak();
    slept.delay = () => 14900;
    await pass(slept.timers, 1499);
    assert.equal(pcA.cloud.view().phase, 'Loading');
    await pass(slept.timers, 1);
    assert.equal(pcA.cloud.view().phase, 'Offline');
    await pass(slept.timers, 45000);
    assert.equal(pcA.cloud.view().phase, 'Leading');
    assert.equal(localText(pcA, 'book'), JSON.stringify(OTHER_BOOK));
});

test('when the switch closes the window, the next try is due at the next tick', async () => {
    for (const back of [16, 18]) {
        const { place, pcA } = await asleepInFlight('renewal', false);
        place.worker.fail();
        const woke = place.timers.now();
        await wake(pcA);
        await pass(place.timers, 15000);
        assert.equal(pcA.cloud.view().phase, 'Offline', `back at ${back} s`);
        await pass(place.timers, (back - 15) * 1000);
        place.worker.speak();
        await pass(place.timers, (20 - back) * 1000);
        await pcA.cloud.tick();
        const tries = place.worker.calls(LEASE).filter((entry) => entry.at >= woke).map((entry) => entry.at - woke);
        assert.deepEqual(tries, [0, 1000, 3000, 7000, 14000, 20000], `back at ${back} s`);
        assert.equal(pcA.cloud.view().phase, 'Leading', `back at ${back} s`);
        assert.equal(localText(pcA, 'book'), JSON.stringify(OTHER_BOOK), `back at ${back} s`);
    }
});

test('an answer that trying again cannot help ends the opening at once', async () => {
    const place = world();
    const pc = computer(place, { kinds: { book: BOOK } });
    for (let answer = 0; answer < 10; answer++) {
        place.worker.answer(LEASE, 404, NOT_FOUND_BODY);
    }
    await pc.cloud.tick();
    assert.equal(pc.cloud.view().phase, 'Offline');
    assert.equal(pc.cloud.view().problem, 'Your Worker refused the request: not_found');
    assert.equal(pc.cloud.leads(), true);
    await pass(place.timers, 14000);
    assert.equal(place.worker.calls(LEASE).length, 1);
});

test('a commit answer that came before waking is kept, so nothing is asked about a book the cloud holds', async () => {
    for (const tickFirst of [true, false]) {
        const slept = await asleepInFlight('commit', false);
        const { place, pcA } = slept;
        assert.equal(place.worker.revisionOf(CLOUD_ROOM, 'book'), 3);
        await woken(slept, tickFirst);
        const label = tickFirst ? 'the tick runs first' : 'the answer runs first';
        assert.equal(pcA.cloud.view().phase, 'Leading', label);
        assert.equal(pcA.cloud.view().conflict, null, label);
        assert.equal(localText(pcA, 'book'), JSON.stringify(OTHER_BOOK), label);
        assert.equal(ScribeStore.synced(pcA.storage, ROOM).book.revision, 3, label);
    }
});

test('a 429 answer to a renewal in flight at sleep holds the fresh lease request back by its Retry-After', async () => {
    const { place, pcA } = await asleepInFlight('limited', false);
    const woke = place.timers.now();
    await wake(pcA);
    assert.equal(pcA.cloud.view().phase, 'Loading');
    assert.equal(pcA.cloud.leads(), false);
    for (let tick = 0; tick < 3; tick++) {
        await pass(place.timers, 20000);
        await pcA.cloud.tick();
    }
    const tries = place.worker.calls(LEASE).filter((entry) => entry.at >= woke).map((entry) => entry.at - woke);
    assert.equal(tries[0], 40000);
    assert.equal(pcA.cloud.view().phase, 'Leading');
    assert.equal(localText(pcA, 'book'), JSON.stringify(OTHER_BOOK));
});

test('a wall clock set back neither stops the renewals nor lets two PCs lead', async () => {
    const place = world();
    const pcA = await leading(place);
    await pass(place.timers, 20000);
    await pcA.cloud.tick();
    pcA.skew = -600000;
    const renewals = () => bodies(place.worker, LEASE).filter((body) => body.browser.includes('-A-')).length;
    const before = renewals();
    let pcB = null;
    let both = 0;
    for (let tick = 0; tick < 15; tick++) {
        await pass(place.timers, 20000);
        await pcA.cloud.tick();
        if (pcB === null && place.timers.now() - START >= 120000) {
            pcB = computer(place, { name: 'B' });
        }
        if (pcB !== null) {
            await pcB.cloud.tick();
            both += pcA.cloud.leads() && pcB.cloud.leads() ? 1 : 0;
        }
    }
    assert.equal(both, 0);
    assert.equal(renewals() - before >= 7, true);
    assert.equal(pcA.cloud.view().phase, 'Leading');
    assert.equal(pcB.cloud.view().phase, 'Watching');
});

test('parts missing: staged again at the next push, and only this push digests are named', async () => {
    const place = world();
    const pc = await leading(place);
    place.worker.answer(COMMIT, 409, MISSING_BODY);
    await changed(place, pc, 'live', OTHER_LIVE);
    assert.equal(place.worker.revisionOf(CLOUD_ROOM, 'live'), 1);
    assert.equal(pc.cloud.view().phase, 'Leading');
    assert.equal(pc.cloud.view().unsent, 1);
    const fresh = { ...OTHER_LIVE, again: true };
    await changed(place, pc, 'live', fresh);
    const commits = bodies(place.worker, COMMIT);
    assert.deepEqual(commits.at(-2).kinds[0].digests, [sha(JSON.stringify(OTHER_LIVE))]);
    assert.deepEqual(commits.at(-1).kinds[0].digests, [sha(JSON.stringify(fresh))]);
    assert.equal(place.worker.revisionOf(CLOUD_ROOM, 'live'), 2);
    assert.equal(place.worker.textOf(CLOUD_ROOM, 'live'), JSON.stringify(fresh));
});

test('unknown commit outcome: the heads are read before anything is sent again', async () => {
    const place = world();
    const pc = await leading(place);
    place.worker.answer(COMMIT, 503, DOWN_BODY, true);
    await changed(place, pc, 'live', OTHER_LIVE);
    assert.equal(pc.cloud.view().phase, 'Offline');
    assert.equal(pc.cloud.leads(), true);
    assert.equal(place.worker.revisionOf(CLOUD_ROOM, 'live'), 2);
    const commits = place.worker.calls(COMMIT).length;
    await pass(place.timers, 1000);
    await pc.cloud.tick();
    assert.equal(pc.cloud.view().phase, 'Leading');
    assert.equal(place.worker.calls(COMMIT).length, commits);
    assert.equal(ScribeStore.synced(pc.storage, ROOM).live.revision, 2);
    assert.equal(pc.cloud.view().unsent, 0);
    place.worker.answer(COMMIT, 503, DOWN_BODY, true);
    await changed(place, pc, 'live', LIVE);
    assert.equal(pc.cloud.view().phase, 'Offline');
    assert.equal(place.worker.revisionOf(CLOUD_ROOM, 'live'), 3);
    await changed(place, pc, 'live', { ...LIVE, after: true });
    await pc.cloud.tick();
    assert.equal(pc.cloud.view().phase, 'Leading');
    assert.equal(pc.cloud.view().conflict, null);
    assert.equal(place.worker.revisionOf(CLOUD_ROOM, 'live'), 4);
    assert.equal(place.worker.textOf(CLOUD_ROOM, 'live'), JSON.stringify({ ...LIVE, after: true }));
    assert.deepEqual(bodies(place.worker, COMMIT).at(-1).kinds.map((change) => change.expectedRevision), [3]);
    const other = world();
    const lost = await leading(other);
    other.worker.answer(COMMIT, 503, DOWN_BODY, false);
    await changed(other, lost, 'live', OTHER_LIVE);
    assert.equal(other.worker.revisionOf(CLOUD_ROOM, 'live'), 1);
    assert.equal(lost.cloud.view().phase, 'Offline');
    await pass(other.timers, 1000);
    await lost.cloud.tick();
    const order = other.worker.log.slice(-4).map((entry) => `${entry.method} ${entry.path}`);
    assert.deepEqual(order, [`POST ${LEASE}`, `GET ${HEADS}`, `PUT ${PART}`, `POST ${COMMIT}`]);
    assert.equal(other.worker.revisionOf(CLOUD_ROOM, 'live'), 2);
});

test('downloads wait until the keeper has stepped down', async () => {
    const place = world();
    await leading(place);
    const pc = computer(place, { name: 'B' });
    pc.reader = true;
    await pc.cloud.tick();
    assert.equal(pc.cloud.view().phase, 'Loading');
    assert.equal(pc.cloud.leads(), false);
    assert.equal(pc.notified >= 2, true);
    assert.equal(localText(pc, 'book'), null);
    assert.equal(pc.storage.values.has('scribe:synced:harbour'), false);
    await pass(place.timers, 20000);
    await pc.cloud.tick();
    assert.equal(localText(pc, 'book'), null);
    pc.reader = false;
    await pc.cloud.tick();
    assert.equal(localText(pc, 'book'), JSON.stringify(BOOK));
    assert.equal(pc.cloud.view().phase, 'Watching');
});

test('every Loading turns offline at 15 s, and a reload never blocks the keeper longer', async () => {
    const place = world();
    await leading(place);
    const pc = computer(place, { name: 'B' });
    pc.reader = true;
    await pc.cloud.tick();
    assert.equal(pc.cloud.view().phase, 'Loading');
    await pass(place.timers, 14999);
    assert.equal(pc.cloud.view().phase, 'Loading');
    const notified = pc.notified;
    await pass(place.timers, 1);
    assert.equal(pc.cloud.view().phase, 'Offline');
    assert.equal(pc.notified, notified + 1);
    await pass(place.timers, 5000);
    await pc.cloud.tick();
    assert.equal(pc.cloud.view().phase, 'Loading');
    assert.equal(localText(pc, 'book'), null);
    await pass(place.timers, 14999);
    assert.equal(pc.cloud.view().phase, 'Loading');
    await pass(place.timers, 1);
    assert.equal(pc.cloud.view().phase, 'Offline');
    pc.reader = false;
    await pc.cloud.tick();
    assert.equal(pc.cloud.view().phase, 'Watching');
    assert.equal(localText(pc, 'book'), JSON.stringify(BOOK));
    assert.equal(place.worker.calls(PART, 'GET').length, 3);
    const slow = world();
    const book = JSON.stringify({ ...BOOK, notes: 'y'.repeat(500000) });
    slow.worker.seed(CLOUD_ROOM, 'book', 4, ScribeStore.pieces(book, 400000));
    const follower = computer(slow, { name: 'C', follow: true, kinds: { book: BOOK } });
    ScribeStore.setSynced(follower.storage, ROOM, 'book', 3, ScribeStore.generation(follower.storage, ROOM, 'book'));
    slow.delay = (details) => (details.method === 'GET' && new URL(details.url).pathname === PART ? 10000 : 0);
    let blocked = 0;
    let longest = 0;
    for (let second = 0; second < 80; second++) {
        if (second % 20 === 0) {
            follower.cloud.tick();
        }
        await pass(slow.timers, 1000);
        blocked = follower.cloud.leads() ? 0 : blocked + 1000;
        longest = Math.max(longest, blocked);
    }
    assert.equal(longest <= 15000, true, `blocked for ${longest} ms`);
    assert.equal(localText(follower, 'book'), book);
    assert.equal(follower.cloud.view().phase, 'Leading');
    assert.equal(slow.worker.calls(PART, 'GET').length, 2);
});

test('a damaged local book is replaced by the cloud one', async () => {
    const place = world();
    place.worker.seed(CLOUD_ROOM, 'book', 3, [JSON.stringify(BOOK)]);
    const storage = new FakeStorage();
    ScribeStore.setCloudKey(storage, KEY);
    storage.set('scribe:head:harbour:book', JSON.stringify({ generation: 4, parts: 1, characters: 10, digest: '00000000', form: 2 }));
    assert.throws(() => ScribeStore.snapshot(storage, ROOM, 'book'), { message: 'The saved book of this chat is damaged' });
    const pc = computer(place, { storage });
    await pc.cloud.tick();
    assert.equal(localText(pc, 'book'), JSON.stringify(BOOK));
    assert.equal(ScribeStore.synced(storage, ROOM).book.revision, 3);
    assert.equal(place.worker.calls(PART, 'PUT').length, 0);
});

test('refused: a refused key waits for a new key', async () => {
    const place = world();
    const pc = computer(place, { key: `${KEY}-wrong`, kinds: { book: BOOK } });
    await pc.cloud.tick();
    assert.equal(pc.cloud.view().phase, 'Refused');
    assert.equal(pc.cloud.leads(), true);
    const requests = place.worker.log.length;
    for (let tick = 0; tick < 5; tick++) {
        await pass(place.timers, 20000);
        await pc.cloud.tick();
    }
    assert.equal(place.worker.log.length, requests);
    ScribeStore.setCloudKey(pc.storage, KEY);
    await pc.cloud.tick();
    assert.equal(pc.cloud.view().phase, 'Leading');
    assert.equal(place.worker.revisionOf(CLOUD_ROOM, 'book'), 1);
    ScribeStore.setCloudKey(pc.storage, 'short');
    const silent = place.worker.log.length;
    await pc.cloud.tick();
    assert.equal(pc.cloud.view().phase, 'Refused');
    assert.equal(place.worker.log.length, silent);
    ScribeStore.setCloudKey(pc.storage, '');
    await pc.cloud.tick();
    assert.equal(pc.cloud.view().phase, 'Off');
    assert.equal(pc.cloud.view().keyed, false);
});

test('backoff: 1, 2, 4 s, a last try 1 s before the switch, then the list again after it; Retry-After', async () => {
    const place = world();
    const pc = computer(place, { kinds: { book: BOOK } });
    place.worker.fail();
    for (let step = 0; step <= 64; step++) {
        pc.cloud.tick();
        await pass(place.timers, 500);
    }
    const attempts = place.worker.calls(LEASE).map((entry) => entry.at - START);
    assert.deepEqual(attempts.slice(0, 8), [0, 1000, 3000, 7000, 14000, 15000, 16000, 18000]);
    assert.equal(pc.cloud.view().phase, 'Offline');
    assert.equal(pc.cloud.leads(), true);
    const limited = world();
    const waiting = computer(limited, { kinds: { book: BOOK } });
    limited.worker.answer(LEASE, 429, LIMITED_BODY, false, 'retry-after: 30\r\n');
    await waiting.cloud.tick();
    assert.equal(waiting.cloud.view().phase, 'Loading');
    await pass(limited.timers, 15000);
    assert.equal(waiting.cloud.view().phase, 'Offline');
    assert.equal(limited.worker.calls(LEASE).length, 1);
    await pass(limited.timers, 14999);
    await waiting.cloud.tick();
    assert.equal(limited.worker.calls(LEASE).length, 1);
    await pass(limited.timers, 1);
    await waiting.cloud.tick();
    assert.equal(limited.worker.calls(LEASE).length, 2);
    assert.equal(waiting.cloud.view().phase, 'Leading');
});

test('an unreadable revision backs off, is never downloaded again, and a new revision recovers', async () => {
    const cases = [
        ['a text that does not decode', (worker) => worker.seed(CLOUD_ROOM, 'book', 3, ['{"log":', 'x'])],
        [
            'a missing part',
            (worker) => {
                worker.seed(CLOUD_ROOM, 'book', 3, ['{"log":', '{}}']);
                worker.parts.delete(FakeScribeWorker.partKey(CLOUD_ROOM, 'book', 3, 1));
            },
        ],
    ];
    for (const [label, seed] of cases) {
        const place = world();
        seed(place.worker);
        const pc = computer(place);
        for (let step = 0; step <= 64; step++) {
            pc.cloud.tick();
            await pass(place.timers, 500);
        }
        const attempts = place.worker.calls(LEASE).map((entry) => entry.at - START);
        assert.deepEqual(attempts.slice(0, 8), [0, 1000, 3000, 7000, 15000, 31000, 31500, 32000], label);
        const log = place.worker.log;
        const following = log.filter((entry, index) => index > 0 && log[index - 1].path === LEASE);
        assert.equal(following.length, attempts.length, label);
        assert.equal(following.every((entry) => entry.method === 'GET' && entry.path === HEADS), true, label);
        const later = log.filter((entry) => entry.at > START).map((entry) => `${entry.method} ${entry.path}`);
        const pairs = Array.from({ length: attempts.length - 1 }, () => [`POST ${LEASE}`, `GET ${HEADS}`]).flat();
        assert.deepEqual(later, pairs, label);
        const parts = place.worker.calls(PART, 'GET').length;
        const requests = log.length;
        for (let tick = 0; tick < 30; tick++) {
            await pc.cloud.tick();
            await pass(place.timers, 20000);
        }
        assert.equal(place.worker.calls(PART, 'GET').length, parts, label);
        assert.equal(log.length, requests + 60, label);
        assert.equal(pc.cloud.view().phase, 'Offline', label);
        assert.equal(pc.cloud.view().problem, 'What your Worker holds for this chat could not be read', label);
        assert.equal(pc.cloud.leads(), true, label);
        place.worker.seed(CLOUD_ROOM, 'book', 4, [JSON.stringify(BOOK)]);
        await pc.cloud.tick();
        assert.equal(pc.cloud.view().phase, 'Leading', label);
        assert.equal(pc.cloud.view().problem, null, label);
        assert.equal(localText(pc, 'book'), JSON.stringify(BOOK), label);
        const recovered = place.worker.calls(PART, 'GET').at(-1).query;
        assert.deepEqual(recovered, { roomId: CLOUD_ROOM, kind: 'book', revision: '4', part: '0' }, label);
    }
});

test('Retry-After is held to the Worker 60 s at most', async () => {
    const place = world();
    const pc = computer(place, { kinds: { book: BOOK } });
    place.worker.answer(LEASE, 429, LIMITED_BODY, false, 'retry-after: 86400\r\n');
    await pc.cloud.tick();
    assert.equal(pc.cloud.view().phase, 'Loading');
    await pass(place.timers, 59999);
    assert.equal(pc.cloud.view().phase, 'Offline');
    await pc.cloud.tick();
    assert.equal(place.worker.calls(LEASE).length, 1);
    await pass(place.timers, 1);
    await pc.cloud.tick();
    assert.equal(place.worker.calls(LEASE).length, 2);
    assert.equal(pc.cloud.view().phase, 'Leading');
});

test("Use the cloud's on a revision that does not decode says so, and the question is asked again", async () => {
    const place = world();
    const pc = await leading(place);
    await conflicted(place, pc, BOOK);
    assert.equal(pc.cloud.view().phase, 'Conflict');
    place.worker.seed(CLOUD_ROOM, 'book', 9, ['{"log":', 'x']);
    await assert.rejects(pc.cloud.useCloud(), { message: 'What your Worker holds for this chat could not be read' });
    assert.equal(pc.cloud.view().phase, 'Offline');
    assert.equal(localText(pc, 'book'), JSON.stringify(OTHER_BOOK));
    place.worker.seed(CLOUD_ROOM, 'book', 10, [JSON.stringify(BOOK)]);
    await pass(place.timers, 1000);
    await pc.cloud.tick();
    assert.equal(pc.cloud.view().phase, 'Conflict');
    assert.deepEqual(plain(pc.cloud.view().conflict), { here: 5, there: 3 });
    assert.equal(localText(pc, 'book'), JSON.stringify(OTHER_BOOK));
});

test('Keep also pushes a kind this PC holds and the cloud lacks', async () => {
    const place = world();
    place.worker.seed(CLOUD_ROOM, 'settings', 1, [JSON.stringify(SETTINGS)]);
    place.worker.seed(CLOUD_ROOM, 'book', 2, [JSON.stringify({ ...BOOK, log: { ...LOG, read: { n1: 1, n2: 1 } } })]);
    const pc = synchronised(place, { settings: SETTINGS, book: BOOK });
    save(pc, 'live', LIVE);
    ScribeStore.setSynced(pc.storage, ROOM, 'live', 0, ScribeStore.generation(pc.storage, ROOM, 'live'));
    save(pc, 'book', OTHER_BOOK);
    await pc.cloud.tick();
    assert.deepEqual(plain(pc.cloud.view().conflict), { here: 5, there: 2 });
    await pc.cloud.keep();
    assert.equal(pc.cloud.view().phase, 'Leading');
    assert.equal(place.worker.textOf(CLOUD_ROOM, 'book'), JSON.stringify(OTHER_BOOK));
    assert.equal(place.worker.textOf(CLOUD_ROOM, 'live'), JSON.stringify(LIVE));
    assert.equal(pc.cloud.view().unsent, 0);
});

test('no part starts with U+FEFF, which a browser drops from the front of a text answer', async () => {
    const place = world();
    const opening = JSON.stringify({ ...BOOK, notes: '' }).length - 2;
    const value = { ...BOOK, notes: `${'a'.repeat(400000 - opening)}﻿quoted from the chat` };
    const text = JSON.stringify(value);
    assert.equal(text.charCodeAt(400000), 0xfeff);
    const pc = computer(place, { kinds: { book: value } });
    await pc.cloud.tick();
    const staged = place.worker.calls(PART, 'PUT');
    assert.equal(staged.length, 2);
    assert.equal(staged.every((entry) => entry.body.charCodeAt(0) !== 0xfeff), true);
    assert.equal(staged.every((entry) => entry.body.length <= 400000), true);
    assert.equal(place.worker.textOf(CLOUD_ROOM, 'book'), text);
});

test('the record of a commit whose outcome is unknown survives a reload', async () => {
    const place = world();
    const pc = await leading(place);
    place.worker.answer(COMMIT, 503, DOWN_BODY, true);
    await changed(place, pc, 'book', OTHER_BOOK);
    assert.equal(pc.cloud.view().phase, 'Offline');
    assert.equal(place.worker.revisionOf(CLOUD_ROOM, 'book'), 2);
    const later = { ...OTHER_BOOK, later: true };
    save(pc, 'book', later);
    pc.cloud.close();
    pc.open();
    await pc.cloud.tick();
    assert.equal(pc.cloud.view().phase, 'Leading');
    assert.equal(pc.cloud.view().conflict, null);
    assert.equal(place.worker.revisionOf(CLOUD_ROOM, 'book'), 3);
    assert.equal(place.worker.textOf(CLOUD_ROOM, 'book'), JSON.stringify(later));
    assert.equal(pc.storage.values.has('scribe:sending:harbour'), false);
});

test('operator notes: a cut never ends in a carriage return', () => {
    const cut = ScribeCloud.trimmed(`${'note line\r\n'.repeat(400)}tail`);
    assert.equal(cut.text.endsWith('note line'), true);
    assert.equal(cut.cut, 4404);
});

test('operator notes: blank notes send nothing', async () => {
    const place = world();
    place.worker.setNotes(NOTES_ROOM, '   \n  ');
    const pc = await leading(place);
    assert.equal(pc.cloud.notes(), null);
    assert.equal(pc.cloud.view().notes, null);
});

test('spending: sent once, the others counted, another day reads as nothing', async () => {
    const place = world();
    const pcA = await leading(place);
    const pcB = computer(place, { name: 'B' });
    await pcB.cloud.tick();
    ScribeStore.spend(pcB.storage, ROOM, DAY, 0.5);
    await pcB.cloud.tick();
    ScribeStore.spend(pcA.storage, ROOM, DAY, 0.25);
    await pass(place.timers, 20000);
    await pcA.cloud.tick();
    const sent = bodies(place.worker, SPEND);
    assert.deepEqual(sent, [
        { browser: 'Fictional-Browser-B-0001', day: DAY, total: 0.5 },
        { browser: 'Fictional-Browser-A-0001', day: DAY, total: 0.25 },
    ]);
    assert.equal(ScribeStore.others(pcA.storage, ROOM, DAY), 0.5);
    assert.equal(ScribeStore.others(pcA.storage, ROOM, NEXT_DAY), 0);
    for (let tick = 0; tick < 3; tick++) {
        await pass(place.timers, 20000);
        await pcA.cloud.tick();
    }
    assert.equal(place.worker.calls(SPEND).length, 2);
    ScribeStore.spend(pcA.storage, ROOM, DAY, 0.25);
    await pcA.cloud.tick();
    assert.deepEqual(bodies(place.worker, SPEND).at(-1), { browser: 'Fictional-Browser-A-0001', day: DAY, total: 0.5 });
    assert.equal(ScribeStore.others(pcA.storage, ROOM, DAY), 0.5);
    assert.equal(ScribeStore.others(pcB.storage, ROOM, DAY), 0);
    ScribeStore.spend(pcB.storage, ROOM, DAY, 0.25);
    await pass(place.timers, 20000);
    await pcB.cloud.tick();
    assert.deepEqual(bodies(place.worker, SPEND).at(-1), { browser: 'Fictional-Browser-B-0001', day: DAY, total: 0.75 });
    assert.equal(ScribeStore.others(pcB.storage, ROOM, DAY), 0.5);
    await pass(place.timers, 60000000);
    ScribeStore.spend(pcA.storage, ROOM, NEXT_DAY, 0.125);
    await pcA.cloud.tick();
    assert.deepEqual(bodies(place.worker, SPEND).at(-1), { browser: 'Fictional-Browser-A-0001', day: NEXT_DAY, total: 0.125 });
    assert.equal(ScribeStore.others(pcA.storage, ROOM, NEXT_DAY), 0);
});

test('notes: read with the page path, cut to 4,000 characters, read again after five minutes', async () => {
    const place = world();
    const pc = await leading(place);
    assert.deepEqual(place.worker.calls(NOTES).map((entry) => entry.query), [{ roomId: NOTES_ROOM }]);
    assert.equal(pc.cloud.notes(), null);
    assert.equal(pc.cloud.view().notes, null);
    place.worker.setNotes(NOTES_ROOM, `${'a'.repeat(3000)}\n${'b'.repeat(1000)}`);
    await pass(place.timers, 299999);
    await pc.cloud.tick();
    assert.equal(place.worker.calls(NOTES).length, 1);
    await pass(place.timers, 1);
    await pc.cloud.tick();
    assert.equal(place.worker.calls(NOTES).length, 2);
    assert.equal(pc.cloud.notes(), 'a'.repeat(3000));
    assert.deepEqual(plain(pc.cloud.view().notes), { length: 3000, cut: 4001 });
    place.worker.setNotes(NOTES_ROOM, 'c'.repeat(4001));
    await pass(place.timers, 300000);
    await pc.cloud.tick();
    assert.equal(pc.cloud.notes(), 'c'.repeat(4000));
    assert.deepEqual(plain(pc.cloud.view().notes), { length: 4000, cut: 4001 });
    place.worker.setNotes(NOTES_ROOM, '𐍈'.repeat(4000));
    await pass(place.timers, 300000);
    await pc.cloud.tick();
    assert.deepEqual(plain(pc.cloud.view().notes), { length: 4000, cut: null });
    place.worker.memories.delete(NOTES_ROOM);
    await pass(place.timers, 300000);
    await pc.cloud.tick();
    assert.equal(pc.cloud.notes(), null);
    assert.equal(ScribeCloud.trimmed('short\nnotes').text, 'short\nnotes');
});

test('the Worker room rule and the key rule', () => {
    assert.equal(ScribeCloud.room('harbour'), '/rooms/harbour');
    for (const refused of ['two words', 'tab\there', 'back\\slash', 'a?b', 'a#b', '\ud800', 'x'.repeat(506), 'bom﻿']) {
        assert.equal(ScribeCloud.room(refused), null, JSON.stringify(refused).slice(0, 20));
    }
    assert.equal(ScribeCloud.room('x'.repeat(505)), `/rooms/${'x'.repeat(505)}`);
    assert.equal(ScribeCloud.validKey('k'.repeat(60)), true);
    assert.equal(ScribeCloud.validKey('k'.repeat(254)), true);
    for (const refused of ['k'.repeat(59), 'k'.repeat(255), `${'k'.repeat(59)} `, `${'k'.repeat(59)}é`, null, 60]) {
        assert.equal(ScribeCloud.validKey(refused), false);
    }
});

test('a room the Worker cannot hold stays on this PC', async () => {
    const place = world();
    const storage = new FakeStorage();
    ScribeStore.setCloudKey(storage, KEY);
    const cloud = ScribeCloud.open({
        storage,
        roomId: 'two words',
        notesRoom: '/rooms/two%20words',
        xmlHttpRequest: (details) => place.worker.request(details),
        clock: { now: () => place.timers.now(), today: () => DAY },
        random: () => 'Fictional-Browser-A-0001',
        later: (milliseconds, action) => {
            place.timers.setTimeout(action, milliseconds);
        },
        chosen: () => true,
        reader: () => false,
        busy: () => false,
        reading: () => false,
        notify: () => undefined,
    });
    await cloud.tick();
    assert.equal(cloud.view().phase, 'Unusable');
    assert.equal(cloud.view().problem, "This chat's ID cannot be used as a room in your Worker");
    assert.equal(cloud.leads(), true);
    assert.deepEqual(place.worker.log, []);
});

test('the DM key goes only to the Worker and an answer from elsewhere is refused', async () => {
    const place = world();
    const seen = [];
    const pc = computer(place, { kinds: { book: BOOK } });
    pc.storage.set('scribe:key', 'sk-or-v1-fictional-openrouter-key');
    pc.open();
    const cloud = ScribeCloud.open({
        storage: pc.storage,
        roomId: ROOM,
        notesRoom: NOTES_ROOM,
        xmlHttpRequest: (details) => {
            seen.push(details);
            return place.worker.request(details);
        },
        clock: { now: () => place.timers.now(), today: () => DAY },
        random: () => 'Fictional-Browser-A-0001',
        later: (milliseconds, action) => {
            place.timers.setTimeout(action, milliseconds);
        },
        chosen: () => true,
        reader: () => false,
        busy: () => false,
        reading: () => false,
        notify: () => undefined,
    });
    await cloud.tick();
    assert.equal(seen.length > 3, true);
    for (const details of seen) {
        assert.equal(details.url.startsWith('https://zeta-dm-memory.elit1989.workers.dev/v1/'), true);
        assert.equal(details.headers.Authorization, `Bearer ${KEY}`);
        assert.equal(details.anonymous, true);
        assert.equal(details.redirect, 'error');
        assert.equal(JSON.stringify(details).includes('sk-or-v1'), false);
    }
    const strange = world();
    const misled = computer(strange, { kinds: { book: BOOK } });
    misled.cloud.close();
    const redirected = ScribeCloud.open({
        storage: misled.storage,
        roomId: ROOM,
        notesRoom: NOTES_ROOM,
        xmlHttpRequest: (details) => {
            Promise.resolve().then(() => {
                details.onload({ status: 200, finalUrl: 'https://elsewhere.example/v1/scribe/lease', responseHeaders: '', responseText: '{"held":true}' });
            });
            return { abort: () => undefined };
        },
        clock: { now: () => strange.timers.now(), today: () => DAY },
        random: () => 'Fictional-Browser-A-0001',
        later: (milliseconds, action) => {
            strange.timers.setTimeout(action, milliseconds);
        },
        chosen: () => true,
        reader: () => false,
        busy: () => false,
        reading: () => false,
        notify: () => undefined,
    });
    await redirected.tick();
    assert.equal(redirected.view().phase, 'Offline');
    assert.equal(redirected.view().problem, 'An answer did not come straight from your Worker');
    assert.equal(redirected.view().problem.includes(KEY), false);
});
