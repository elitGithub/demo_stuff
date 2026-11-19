import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import worker from '../worker.mjs';
import CloudflareCrypto from './support/CloudflareCrypto.mjs';
import ScriptedD1 from './support/ScriptedD1.mjs';
import SqliteD1 from './support/SqliteD1.mjs';

const fixtures = Object.freeze({
    Origin: 'https://api.example',
    Key: 'FictionalZetaKey0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl',
    Alpha: '/rooms/alpha',
    Beta: '/rooms/beta',
    Timestamp: '2026-11-10T10:00:00.000Z',

    /**
     * @param {SqliteD1 | ScriptedD1} db
     * @param {string} path
     * @param {RequestInit} [options]
     * @return {Promise<Response>}
     */
    request(db, path, options = {}) {
        const request = new Request(fixtures.Origin + path, {
            ...options,
            headers: { Authorization: 'Bearer ' + fixtures.Key, 'Content-Type': 'application/json' },
        });
        return worker.fetch(request, { DB: db, DM_API_KEY: fixtures.Key });
    },

    /**
     * @param {SqliteD1 | ScriptedD1} db
     * @param {string} roomId
     * @return {Promise<Response>}
     */
    read(db, roomId) {
        return fixtures.request(db, '/v1/memory?roomId=' + encodeURIComponent(roomId));
    },

    /**
     * @param {SqliteD1} db
     * @param {string} roomId
     * @param {string} notes
     * @param {number} expectedRevision
     * @return {Promise<Response>}
     */
    save(db, roomId, notes, expectedRevision) {
        return fixtures.request(db, '/v1/memory?roomId=' + encodeURIComponent(roomId), {
            method: 'PUT', body: JSON.stringify({ notes, expectedRevision }),
        });
    },

    /**
     * @param {SqliteD1} db
     * @return {Promise<object>}
     */
    async rateRow(db) {
        const { results } = await db.prepare('SELECT window_start AS windowStart, request_count AS count FROM api_rate_limit WHERE id = 1')
            .bind().all();
        return { ...results[0] };
    },
});

const scribe = Object.freeze({
    Room: '/rooms/alpha',
    BrowserA: 'Fictional-Browser-A-0001',
    BrowserB: 'Fictional-Browser-B-0002',
    Day: '2026-11-18',
    NextDay: '2026-11-19',
    Start: Date.parse('2026-11-18T10:00:00.000Z'),
    TextType: 'text/plain; charset=utf-8',

    /**
     * @param {SqliteD1} db
     * @param {string} method
     * @param {string} route
     * @param {Record<string, string | number>} query
     * @param {string | null} [body]
     * @param {string} [contentType]
     * @return {Promise<Response>}
     */
    send(db, method, route, query, body = null, contentType = 'application/json') {
        const authorization = { Authorization: 'Bearer ' + fixtures.Key };
        const headers = body === null ? authorization : { ...authorization, 'Content-Type': contentType };
        const url = fixtures.Origin + route + '?' + new URLSearchParams(query);
        return worker.fetch(new Request(url, { method, body, headers }), { DB: db, DM_API_KEY: fixtures.Key });
    },

    /**
     * @param {SqliteD1} db
     * @param {string} browser
     * @param {string} [day]
     * @return {Promise<Response>}
     */
    heads(db, browser, day = scribe.Day) {
        return scribe.send(db, 'GET', '/v1/scribe', { roomId: scribe.Room, browser, day });
    },

    /**
     * @param {SqliteD1} db
     * @param {string} kind
     * @param {number} revision
     * @param {number} part
     * @return {Promise<Response>}
     */
    part(db, kind, revision, part) {
        return scribe.send(db, 'GET', '/v1/scribe/part', { roomId: scribe.Room, kind, revision, part });
    },

    /**
     * @param {SqliteD1} db
     * @param {string} browser
     * @param {string} kind
     * @param {number} revision
     * @param {number} part
     * @param {string} text
     * @return {Promise<Response>}
     */
    stage(db, browser, kind, revision, part, text) {
        const query = { roomId: scribe.Room, kind, revision, part, browser };
        return scribe.send(db, 'PUT', '/v1/scribe/part', query, text, scribe.TextType);
    },

    /**
     * @param {SqliteD1} db
     * @param {string} browser
     * @param {object[]} kinds
     * @param {string[]} [done]
     * @return {Promise<Response>}
     */
    commit(db, browser, kinds, done = []) {
        return scribe.post(db, '/v1/scribe/commit', { browser, kinds, done });
    },

    /**
     * @param {SqliteD1} db
     * @param {string} route
     * @param {object} payload
     * @return {Promise<Response>}
     */
    post(db, route, payload) {
        return scribe.send(db, 'POST', route, { roomId: scribe.Room }, JSON.stringify(payload));
    },

    /**
     * @param {SqliteD1} db
     * @param {string} browser
     * @param {string} [want]
     * @return {Promise<Response>}
     */
    lease(db, browser, want = 'None') {
        return scribe.post(db, '/v1/scribe/lease', { browser, want });
    },

    /**
     * @param {SqliteD1} db
     * @param {string} browser
     * @return {Promise<Response>}
     */
    release(db, browser) {
        return scribe.send(db, 'DELETE', '/v1/scribe/lease', { roomId: scribe.Room, browser });
    },

    /**
     * @param {SqliteD1} db
     * @param {string} browser
     * @param {string} day
     * @param {number} total
     * @return {Promise<Response>}
     */
    spend(db, browser, day, total) {
        return scribe.post(db, '/v1/scribe/spend', { browser, day, total });
    },

    /**
     * @param {SqliteD1} db
     * @param {string} browser
     * @param {string} id
     * @param {object} action
     * @return {Promise<Response>}
     */
    ask(db, browser, id, action) {
        return scribe.post(db, '/v1/scribe/ask', { browser, id, action });
    },

    /**
     * @param {string} text
     * @return {string}
     */
    digest(text) {
        return createHash('sha256').update(text).digest('hex');
    },

    /**
     * @param {string} kind
     * @param {number} expectedRevision
     * @param {string[]} texts
     * @return {object}
     */
    change(kind, expectedRevision, texts) {
        return { kind, expectedRevision, revision: expectedRevision + 1, digests: texts.map(scribe.digest) };
    },

    /**
     * @param {SqliteD1} db
     * @param {string} kind
     * @param {number} revision
     * @param {number} parts
     * @return {Promise<string>}
     */
    async published(db, kind, revision, parts) {
        let text = '';
        for (let part = 0; part < parts; part++) {
            const read = await scribe.part(db, kind, revision, part);
            assert.equal(read.status, 200);
            text += await read.text();
        }
        return text;
    },

    /**
     * @param {string} browser
     * @param {number} expiresAt
     * @param {string | null} [wanted]
     * @param {boolean} [asked]
     * @return {object}
     */
    view(browser, expiresAt, wanted = null, asked = false) {
        return { browser, expiresAt, wanted, asked };
    },

    /**
     * @param {Promise<Response>} pending
     * @param {number} [status]
     * @return {Promise<object>}
     */
    async answer(pending, status = 200) {
        const response = await pending;
        assert.equal(response.status, status);
        return response.json();
    },

    /**
     * @param {Promise<Response>} pending
     * @param {number} status
     * @return {Promise<string>}
     */
    async refusal(pending, status) {
        return (await scribe.answer(pending, status)).error.code;
    },

    /**
     * @param {SqliteD1} db
     * @param {string} sql
     * @param {...(string | number)} values
     * @return {Promise<object[]>}
     */
    async rows(db, sql, ...values) {
        const { results } = await db.prepare(sql).bind(...values).all();
        return results.map((row) => ({ ...row }));
    },

    /**
     * @param {SqliteD1} db
     * @return {Promise<object>}
     */
    async counter(db) {
        const [row] = await scribe.rows(db,
            'SELECT window_start AS windowStart, request_count AS count FROM scribe_rate_limit WHERE id = 1');
        return row;
    },

    /**
     * @param {object[]} heads
     * @return {object[]}
     */
    sorted(heads) {
        return heads.toSorted((one, other) => (one.kind < other.kind ? -1 : 1));
    },
});

test('schema_is_repeatable_and_constrained', async (context) => {
    const db = new SqliteD1(context);
    const create = db.prepare(worker.Sql.CreateMemory);
    await create.bind(fixtures.Alpha, 'Fixture', fixtures.Timestamp).all();
    db.applySchema();
    const { results: [existing] } = await db.prepare(worker.Sql.ReadMemory).bind(fixtures.Alpha).all();
    assert.equal(existing.notes, 'Fixture');
    assert.equal(existing.revision, 1);
    for (const [roomId, notes] of [
        [fixtures.Beta, null], [fixtures.Beta, 'é'.repeat(32769)], ['', ''], ['/' + 'a'.repeat(512), ''], ['beta', ''],
    ]) {
        await assert.rejects(create.bind(roomId, notes, fixtures.Timestamp).all(), /constraint/i);
    }
    const insert = db.prepare('INSERT INTO room_memories (room_id, notes, revision, updated_at) VALUES (?1, ?2, ?3, ?4)');
    for (const revision of [-1, 0, 9007199254740992]) {
        await assert.rejects(insert.bind(fixtures.Beta, '', revision, fixtures.Timestamp).all(), /constraint/i);
    }
    await assert.rejects(insert.bind(fixtures.Beta, '', 1, 'invalid').all(), /constraint/i);
    const rate = db.prepare('INSERT INTO api_rate_limit (id, window_start, request_count) VALUES (?1, ?2, ?3)');
    for (const values of [[2, 0, 1], [1, 0, 181], [1, 0, -1], [1, -60, 1], [1, 1, 1]]) {
        await assert.rejects(rate.bind(...values).all(), /constraint/i);
    }
});

test('create_replace_clear_and_isolate', async (context) => {
    CloudflareCrypto.install(context);
    const db = new SqliteD1(context);
    const first = await fixtures.save(db, fixtures.Alpha, 'Alpha fixture', 0);
    assert.equal(first.status, 201);
    assert.equal((await first.json()).revision, 1);
    assert.equal((await fixtures.save(db, fixtures.Beta, 'Beta fixture', 0)).status, 201);
    const changed = await fixtures.save(db, fixtures.Alpha, 'Alpha replacement', 1);
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).revision, 2);
    const cleared = await fixtures.save(db, fixtures.Alpha, '', 2);
    assert.equal(cleared.status, 200);
    assert.equal((await cleared.json()).notes, '');
    const alpha = await fixtures.read(db, fixtures.Alpha);
    assert.equal(alpha.status, 200);
    assert.equal((await alpha.json()).notes, '');
    const beta = await fixtures.read(db, fixtures.Beta);
    assert.equal(beta.status, 200);
    assert.equal((await beta.json()).notes, 'Beta fixture');
    const missing = await fixtures.read(db, '/rooms/missing');
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'memory_not_found');
});

test('no_op_keeps_revision_and_timestamp', async (context) => {
    CloudflareCrypto.install(context);
    const db = new SqliteD1(context);
    let nowMs = Date.parse(fixtures.Timestamp);
    context.mock.method(Date, 'now', () => nowMs);
    const first = await fixtures.save(db, fixtures.Alpha, 'First', 0);
    assert.equal(first.status, 201);
    const original = await first.json();
    nowMs += 1000;
    const changed = await fixtures.save(db, fixtures.Alpha, 'Second', original.revision);
    assert.equal(changed.status, 200);
    const current = await changed.json();
    assert.notEqual(current.updatedAt, original.updatedAt);
    nowMs += 1000;
    const identical = await fixtures.save(db, fixtures.Alpha, current.notes, current.revision);
    assert.equal(identical.status, 200);
    assert.deepEqual(await identical.json(), current);
    const stale = await fixtures.save(db, fixtures.Alpha, current.notes, original.revision);
    assert.equal(stale.status, 409);
});

test('competing_creates_and_updates', async (context) => {
    CloudflareCrypto.install(context);
    const db = new SqliteD1(context);
    for (const expectedRevision of [0, 1]) {
        const responses = await Promise.all(Array.from({ length: 20 }, (_, index) =>
            fixtures.save(db, fixtures.Alpha, 'Competing fixture ' + expectedRevision + '-' + index, expectedRevision)
        ));
        const winningStatus = expectedRevision === 0 ? 201 : 200;
        const winners = responses.filter(({ status }) => status === winningStatus);
        assert.equal(winners.length, 1);
        assert.equal(responses.filter(({ status }) => status === 409).length, 19);
        const accepted = await winners[0].json();
        assert.equal(accepted.revision, expectedRevision + 1);
        const final = await fixtures.read(db, fixtures.Alpha);
        assert.equal(final.status, 200);
        assert.deepEqual(await final.json(), accepted);
    }
});

test('accepted_snapshot_is_returned', async (context) => {
    CloudflareCrypto.install(context);
    let later;
    const db = new SqliteD1(context, {
        /**
         * @param {string} sql
         * @param {(string | number | null)[]} values
         * @return {Promise<void>}
         */
        async afterExecute(sql, values) {
            if (sql === worker.Sql.UpdateMemory && values[2] === 'Earlier write') {
                later = await fixtures.save(db, fixtures.Alpha, 'Later write', 2);
            }
        },
    });
    assert.equal((await fixtures.save(db, fixtures.Alpha, 'Initial', 0)).status, 201);
    const earlier = await fixtures.save(db, fixtures.Alpha, 'Earlier write', 1);
    assert.equal(later.status, 200);
    const latest = await later.json();
    assert.equal(latest.notes, 'Later write');
    assert.equal(latest.revision, 3);
    assert.equal(earlier.status, 200);
    const accepted = await earlier.json();
    assert.equal(accepted.notes, 'Earlier write');
    assert.equal(accepted.revision, 2);
    assert.deepEqual(await (await fixtures.read(db, fixtures.Alpha)).json(), latest);
});

test('lost_response_reconciliation', async (context) => {
    CloudflareCrypto.install(context);
    const db = new SqliteD1(context);
    assert.equal((await fixtures.save(db, fixtures.Alpha, 'Initial', 0)).status, 201);
    assert.equal((await fixtures.save(db, fixtures.Alpha, 'Intended', 1)).status, 200);
    const retry = await fixtures.save(db, fixtures.Alpha, 'Intended', 1);
    assert.equal(retry.status, 409);
    const response = await fixtures.read(db, fixtures.Alpha);
    assert.equal(response.status, 200);
    const current = await response.json();
    assert.equal(current.notes, 'Intended');
    assert.equal(current.revision, 2);
});

test('binary_cursor_walk', async (context) => {
    CloudflareCrypto.install(context);
    const db = new SqliteD1(context);
    const roomIds = [
        ...Array.from({ length: 48 }, (_, index) => '/rooms/' + (47 - index)),
        '/rooms/a%2Fb', '/rooms/a/b', '/rooms/é', '/rooms/𐍈', '/rooms/Z',
    ];
    const insert = db.prepare(worker.Sql.CreateMemory);
    for (const roomId of roomIds) {
        await insert.bind(roomId, 'Private fixture', fixtures.Timestamp).all();
    }
    const { results: ordered } = await db.prepare('SELECT room_id AS roomId FROM room_memories ORDER BY room_id COLLATE BINARY ASC')
        .bind().all();
    const walked = [];
    let after = null;
    for (const size of [25, 25, 3]) {
        const response = await fixtures.request(db, '/v1/memories' + (after === null ? '' : '?after=' + encodeURIComponent(after)));
        assert.equal(response.status, 200);
        const page = await response.json();
        assert.deepEqual(Object.keys(page), ['items', 'nextCursor']);
        assert.equal(page.items.length, size);
        for (const item of page.items) {
            assert.deepEqual(Object.keys(item), ['roomId', 'revision', 'updatedAt']);
            walked.push(item.roomId);
        }
        assert.equal(page.nextCursor, size === 25 ? page.items.at(-1).roomId : null);
        after = page.nextCursor;
    }
    assert.equal(new Set(walked).size, 53);
    assert.deepEqual(walked, ordered.map(({ roomId }) => roomId));
    assert.equal(after, null);
});

test('rate_capacity_and_rollover', async (context) => {
    CloudflareCrypto.install(context);
    const db = new SqliteD1(context);
    let nowMs = Date.parse(fixtures.Timestamp) + 1200;
    context.mock.method(Date, 'now', () => nowMs);
    for (let attempt = 0; attempt < 180; attempt++) {
        await worker.claimRateSlot(db, nowMs);
    }
    const denied = await fixtures.read(db, fixtures.Alpha);
    assert.equal(denied.status, 429);
    assert.equal(denied.headers.get('Retry-After'), '59');
    assert.equal((await fixtures.rateRow(db)).count, 180);
    nowMs += 60000;
    const missing = await fixtures.read(db, fixtures.Alpha);
    assert.equal(missing.status, 404);
    assert.deepEqual(await fixtures.rateRow(db), { windowStart: Math.floor(nowMs / 60000) * 60, count: 1 });
});

test('delayed_bucket_cannot_reset_limit', async (context) => {
    CloudflareCrypto.install(context);
    const db = new SqliteD1(context);
    const later = Date.parse(fixtures.Timestamp) + 60000;
    const earlier = later - 1000;
    await worker.claimRateSlot(db, later);
    await worker.claimRateSlot(db, earlier);
    const bucket = Math.floor(later / 60000) * 60;
    assert.deepEqual(await fixtures.rateRow(db), { windowStart: bucket, count: 2 });
    for (let attempt = 2; attempt < 180; attempt++) {
        await worker.claimRateSlot(db, later);
    }
    context.mock.method(Date, 'now', () => earlier);
    const denied = await fixtures.read(db, fixtures.Alpha);
    assert.equal(denied.status, 429);
    assert.equal(denied.headers.get('Retry-After'), '61');
    assert.deepEqual(await fixtures.rateRow(db), { windowStart: bucket, count: 180 });
});

test('parallel_rate_claims', async (context) => {
    CloudflareCrypto.install(context);
    const nowMs = Date.parse(fixtures.Timestamp);
    context.mock.method(Date, 'now', () => nowMs);
    const waiting = Promise.withResolvers();
    let arrivals = 0;
    const db = new SqliteD1(context, {
        /**
         * @param {string} sql
         * @return {Promise<void>}
         */
        async beforeExecute(sql) {
            if (sql === worker.Sql.ClaimRateSlot) {
                arrivals++;
                if (arrivals === 200) {
                    waiting.resolve();
                }
                await waiting.promise;
            }
        },
    });
    const responses = await Promise.all(Array.from({ length: 200 }, () => fixtures.request(db, '/v1/memories')));
    assert.equal(responses.filter(({ status }) => status === 200).length, 180);
    assert.equal(responses.filter(({ status }) => status === 429).length, 20);
    assert.deepEqual(await fixtures.rateRow(db), { windowStart: Math.floor(nowMs / 60000) * 60, count: 180 });
});

test('literal_sql_and_unicode', async (context) => {
    CloudflareCrypto.install(context);
    const db = new SqliteD1(context);
    const roomId = "/rooms/';DROP-TABLE-room_memories;--%2F";
    for (const [index, notes] of ["'; DROP TABLE room_memories; --\r\ne\u0301 𐍈", '', '𐍈'.repeat(16384)].entries()) {
        const response = await fixtures.save(db, roomId, notes, index);
        assert.equal(response.status, index === 0 ? 201 : 200);
        assert.equal((await response.json()).notes, notes);
        const read = await fixtures.read(db, roomId);
        assert.equal(read.status, 200);
        assert.equal((await read.json()).notes, notes);
    }
    const oversized = await fixtures.save(db, roomId, '𐍈'.repeat(16384) + 'a', 3);
    assert.equal(oversized.status, 413);
    assert.equal((await fixtures.save(db, fixtures.Beta, 'Still independent', 0)).status, 201);
    assert.equal((await (await fixtures.read(db, fixtures.Beta)).json()).notes, 'Still independent');
});

test('storage_faults_and_overflow', async (context) => {
    CloudflareCrypto.install(context);
    const logs = context.mock.method(console, 'error', () => {});
    const missingSchema = new SqliteD1(context, { installSchema: false });
    const broken = new ScriptedD1(new Error('Fictional storage error'));
    for (const db of [missingSchema, broken]) {
        const response = await fixtures.read(db, fixtures.Alpha);
        assert.equal(response.status, 503);
        assert.equal((await response.json()).error.code, 'database_unavailable');
    }
    const db = new SqliteD1(context);
    await db.prepare('INSERT INTO room_memories (room_id, notes, revision, updated_at) VALUES (?1, ?2, ?3, ?4)')
        .bind(fixtures.Alpha, 'Ceiling', Number.MAX_SAFE_INTEGER, fixtures.Timestamp).all();
    const overflow = await fixtures.save(db, fixtures.Alpha, 'Overflow', Number.MAX_SAFE_INTEGER);
    assert.equal(overflow.status, 503);
    assert.equal((await overflow.json()).error.code, 'database_unavailable');
    const current = await fixtures.read(db, fixtures.Alpha);
    assert.equal(current.status, 200);
    assert.deepEqual(await current.json(), {
        roomId: fixtures.Alpha, notes: 'Ceiling', revision: Number.MAX_SAFE_INTEGER, updatedAt: fixtures.Timestamp,
    });
    assert.equal(logs.mock.callCount(), 3);
});

test('scribe_schema_is_repeatable_and_constrained', async (context) => {
    const db = new SqliteD1(context);
    const { Room, BrowserA, BrowserB, Day } = scribe;
    const stamp = fixtures.Timestamp;
    const askId = 'Fictional-Ask-000000000001';
    const kinds = db.prepare('INSERT INTO scribe_kinds (room_id, kind, revision, parts, updated_at) '
        + 'VALUES (?1, ?2, ?3, ?4, ?5)');
    const parts = db.prepare('INSERT INTO scribe_parts (room_id, kind, revision, part, text, digest) '
        + 'VALUES (?1, ?2, ?3, ?4, ?5, ?6)');
    const sum = scribe.digest('x');
    const spent = db.prepare('INSERT INTO scribe_spent (room_id, day, browser, total) VALUES (?1, ?2, ?3, ?4)');
    const lease = db.prepare('INSERT INTO scribe_lease (room_id, browser, expires_at, wanted, wanted_until, asked) '
        + 'VALUES (?1, ?2, ?3, ?4, ?5, ?6)');
    const asks = db.prepare('INSERT INTO scribe_asks (room_id, id, browser, action, created_at) '
        + 'VALUES (?1, ?2, ?3, ?4, ?5)');
    const rate = db.prepare('INSERT INTO scribe_rate_limit (id, window_start, request_count) VALUES (?1, ?2, ?3)');
    await kinds.bind(Room, 'book', 1, 1, stamp).all();
    db.applySchema();
    assert.deepEqual(await scribe.rows(db, 'SELECT kind, revision, parts FROM scribe_kinds'), [
        { kind: 'book', revision: 1, parts: 1 },
    ]);

    const refused = [
        [kinds, [Room, 'campaign', 1, 1, stamp]],
        [kinds, [Room, 'live', 0, 1, stamp]],
        [kinds, [Room, 'live', 9007199254740992, 1, stamp]],
        [kinds, [Room, 'live', 1, 0, stamp]],
        [kinds, [Room, 'live', 1, 11, stamp]],
        [kinds, ['rooms/alpha', 'live', 1, 1, stamp]],
        [kinds, ['/' + 'a'.repeat(512), 'live', 1, 1, stamp]],
        [kinds, [Room, 'live', 1, 1, 'invalid']],
        [parts, [Room, 'campaign', 1, 0, 'x', sum]],
        [parts, [Room, 'book', 0, 0, 'x', sum]],
        [parts, [Room, 'book', 1, 10, 'x', sum]],
        [parts, [Room, 'book', 1, -1, 'x', sum]],
        [parts, [Room, 'book', 1, 0, '', sum]],
        [parts, [Room, 'book', 1, 0, 'a'.repeat(400001), sum]],
        [parts, [Room, 'book', 1, 0, '𐍈'.repeat(300000) + 'a', sum]],
        [parts, [Room, 'book', 1, 0, 'x', null]],
        [parts, [Room, 'book', 1, 0, 'x', '']],
        [parts, [Room, 'book', 1, 0, 'x', sum.slice(1)]],
        [parts, [Room, 'book', 1, 0, 'x', sum + '0']],
        [parts, [Room, 'book', 1, 0, 'x', sum.toUpperCase()]],
        [parts, [Room, 'book', 1, 0, 'x', 'g' + sum.slice(1)]],
        [parts, [Room, 'book', 1, 0, 'x', '-' + sum.slice(1)]],
        [parts, [Room, 'book', 1, 0, 'x', '*'.repeat(64)]],
        [parts, [Room, 'book', 1, 0, 'x', 'é'.repeat(64)]],
        [spent, [Room, Day, 'a'.repeat(15), 0]],
        [spent, [Room, Day, 'a'.repeat(65), 0]],
        [spent, [Room, '18-11-2026', BrowserA, 0]],
        [spent, [Room, '2026-02-29', BrowserA, 0]],
        [spent, [Room, '2026-02-30', BrowserA, 0]],
        [spent, [Room, '2026-99-99', BrowserA, 0]],
        [spent, [Room, '0000-00-00', BrowserA, 0]],
        [spent, [Room, Day, BrowserA, -1]],
        [spent, [Room, Day, BrowserA, 1000000.01]],
        [lease, [Room, BrowserA, 0, null, null, 2]],
        [lease, [Room, BrowserA, 0, BrowserB, null, 0]],
        [lease, [Room, BrowserA, 0, null, 5, 0]],
        [lease, [Room, BrowserA, -1, null, null, 0]],
        [lease, [Room, 'a'.repeat(15), 0, null, null, 0]],
        [lease, [Room, BrowserA, 0, 'a'.repeat(15), 5, 0]],
        [asks, [Room, 'a'.repeat(15), BrowserA, '{}', 0]],
        [asks, [Room, askId, 'a'.repeat(15), '{}', 0]],
        [asks, [Room, askId, BrowserA, '{', 0]],
        [asks, [Room, askId, BrowserA, '{"text":"' + 'a'.repeat(8182) + '"}', 0]],
        [asks, [Room, askId, BrowserA, '{}', -1]],
        [rate, [2, 0, 1]],
        [rate, [1, 30, 1]],
        [rate, [1, 0, 601]],
    ];
    for (const [statement, values] of refused) {
        await assert.rejects(statement.bind(...values).all(), /constraint/i, JSON.stringify(values).slice(0, 80));
    }
    assert.deepEqual(await scribe.rows(db, 'SELECT count(*) AS count FROM scribe_parts'), [{ count: 0 }]);

    await kinds.bind(Room, 'live', Number.MAX_SAFE_INTEGER, 10, stamp).all();
    await parts.bind(Room, 'book', 1, 9, '€'.repeat(400000), scribe.digest('€'.repeat(400000))).all();
    await parts.bind(Room, 'book', 1, 0, '𐍈'.repeat(300000), '0123456789abcdef'.repeat(4)).all();
    await spent.bind(Room, Day, BrowserA, 1000000).all();
    await spent.bind(Room, '2028-02-29', BrowserA, 0).all();
    await lease.bind(Room, BrowserA, 0, BrowserB, 5, 1).all();
    await asks.bind(Room, askId, BrowserA, '{"text":"' + 'a'.repeat(8181) + '"}', 0).all();
    await rate.bind(1, 0, 600).all();
    for (const [table, count] of [
        ['scribe_kinds', 2], ['scribe_parts', 2], ['scribe_spent', 2], ['scribe_lease', 1], ['scribe_asks', 1],
        ['scribe_rate_limit', 1],
    ]) {
        assert.deepEqual(await scribe.rows(db, 'SELECT count(*) AS count FROM ' + table), [{ count }], table);
    }
    db.applySchema();
    assert.deepEqual(await scribe.rows(db, 'SELECT count(*) AS count FROM scribe_parts'), [{ count: 2 }]);
});

test('scribe_two_browsers_share_one_book', async (context) => {
    CloudflareCrypto.install(context);
    const db = new SqliteD1(context);
    const { BrowserA, BrowserB, Start: nowMs } = scribe;
    context.mock.method(Date, 'now', () => nowMs);
    assert.deepEqual(await scribe.answer(scribe.lease(db, BrowserA)), {
        held: true, lease: scribe.view(BrowserA, nowMs + 90000), asks: [], now: nowMs,
    });
    const texts = [
        ['settings', ['{"budget":3,"models":["fictional-model"]}']],
        ['book', ['{"subjects":[{"name":"Mara é ', '𐍈","facts":["\'; DROP TABLE scribe_parts; --"]}]}']],
    ];
    for (const [kind, pieces] of texts) {
        for (const [part, text] of pieces.entries()) {
            const staged = await scribe.answer(scribe.stage(db, BrowserA, kind, 1, part, text));
            assert.deepEqual(staged, { kind, revision: 1, part, digest: scribe.digest(text) });
        }
    }
    const committed = await scribe.answer(scribe.commit(db, BrowserA, [
        scribe.change('settings', 0, texts[0][1]), scribe.change('book', 0, texts[1][1]),
    ]));
    const updatedAt = new Date(nowMs).toISOString();
    const heads = [
        { kind: 'book', revision: 1, parts: 2, updatedAt },
        { kind: 'settings', revision: 1, parts: 1, updatedAt },
    ];
    assert.deepEqual(scribe.sorted(committed.heads), heads);

    assert.deepEqual(await scribe.answer(scribe.heads(db, BrowserB)), {
        roomId: scribe.Room,
        heads,
        spent: { day: scribe.Day, sum: 0, mine: 0 },
        lease: scribe.view(BrowserA, nowMs + 90000),
        asks: [],
        now: nowMs,
    });
    for (const [kind, pieces] of texts) {
        for (const [part, text] of pieces.entries()) {
            const read = await scribe.part(db, kind, 1, part);
            assert.equal(read.status, 200);
            assert.equal(read.headers.get('Content-Type'), scribe.TextType);
            assert.equal(await read.text(), text);
        }
    }
    assert.equal(await scribe.refusal(scribe.stage(db, BrowserB, 'book', 2, 0, 'Intruder'), 409), 'lease_lost');
    assert.equal(await scribe.refusal(scribe.commit(db, BrowserB, [scribe.change('book', 1, ['Intruder'])]), 409),
        'lease_lost');
    assert.deepEqual(await scribe.rows(db, 'SELECT count(*) AS count FROM scribe_parts'), [{ count: 3 }]);
    assert.equal(await (await scribe.part(db, 'book', 1, 1)).text(), texts[1][1][1]);
});

test('scribe_commit_is_all_or_nothing', async (context) => {
    CloudflareCrypto.install(context);
    const db = new SqliteD1(context);
    const { BrowserA, Start: nowMs } = scribe;
    context.mock.method(Date, 'now', () => nowMs);
    const updatedAt = new Date(nowMs).toISOString();
    await scribe.answer(scribe.lease(db, BrowserA));
    await scribe.answer(scribe.stage(db, BrowserA, 'book', 1, 0, 'First book'));
    await scribe.answer(scribe.commit(db, BrowserA, [scribe.change('book', 0, ['First book'])]));
    await scribe.answer(scribe.stage(db, BrowserA, 'book', 2, 0, 'Second book'));
    await scribe.answer(scribe.stage(db, BrowserA, 'live', 2, 0, 'Live two'));

    const both = [scribe.change('book', 1, ['Second book']), scribe.change('live', 1, ['Live two'])];
    assert.equal(await scribe.refusal(scribe.commit(db, BrowserA, both), 409), 'revision_conflict');
    assert.deepEqual((await scribe.answer(scribe.heads(db, BrowserA))).heads, [
        { kind: 'book', revision: 1, parts: 1, updatedAt },
    ]);
    const staged = 'SELECT kind, revision, part FROM scribe_parts ORDER BY kind, revision, part';
    assert.deepEqual(await scribe.rows(db, staged), [
        { kind: 'book', revision: 1, part: 0 },
        { kind: 'book', revision: 2, part: 0 },
        { kind: 'live', revision: 2, part: 0 },
    ]);

    const second = [scribe.change('book', 1, ['Second book'])];
    assert.deepEqual((await scribe.answer(scribe.commit(db, BrowserA, second))).heads, [
        { kind: 'book', revision: 2, parts: 1, updatedAt },
    ]);
    assert.deepEqual(await scribe.rows(db, staged), [{ kind: 'book', revision: 2, part: 0 }]);
    assert.equal(await (await scribe.part(db, 'book', 2, 0)).text(), 'Second book');
    assert.equal(await scribe.refusal(scribe.part(db, 'book', 1, 0), 404), 'part_not_found');
    assert.equal(await scribe.refusal(scribe.part(db, 'live', 2, 0), 404), 'part_not_found');
});

test('scribe_parallel_commits', async (context) => {
    CloudflareCrypto.install(context);
    const { BrowserA, Start: nowMs } = scribe;
    context.mock.method(Date, 'now', () => nowMs);
    const waiting = Promise.withResolvers();
    let arrivals = 0;
    const db = new SqliteD1(context, {
        /**
         * @param {string} sql
         * @return {Promise<void>}
         */
        async beforeExecute(sql) {
            if (sql === worker.Sql.CommitScribe) {
                arrivals++;
                if (arrivals === 20) {
                    waiting.resolve();
                }
                await waiting.promise;
            }
        },
    });
    await scribe.answer(scribe.lease(db, BrowserA));
    await scribe.answer(scribe.stage(db, BrowserA, 'book', 1, 0, 'Committed once'));
    const responses = await Promise.all(Array.from({ length: 20 }, () =>
        scribe.commit(db, BrowserA, [scribe.change('book', 0, ['Committed once'])])
    ));
    assert.equal(responses.filter(({ status }) => status === 200).length, 1);
    const losers = responses.filter(({ status }) => status === 409);
    assert.equal(losers.length, 19);
    for (const loser of losers) {
        assert.equal((await loser.json()).error.code, 'revision_conflict');
    }
    const { heads } = await scribe.answer(scribe.heads(db, BrowserA));
    assert.deepEqual(heads.map(({ kind, revision }) => ({ kind, revision })), [{ kind: 'book', revision: 1 }]);
    assert.equal(await (await scribe.part(db, 'book', 1, 0)).text(), 'Committed once');
});

test('scribe_sweep_keeps_only_committed_parts', async (context) => {
    CloudflareCrypto.install(context);
    const db = new SqliteD1(context);
    const { BrowserA, Start: nowMs } = scribe;
    context.mock.method(Date, 'now', () => nowMs);
    await scribe.answer(scribe.lease(db, BrowserA));
    const one = [0, 1, 2].map((part) => 'Revision one part ' + part);
    for (const [part, text] of one.entries()) {
        await scribe.answer(scribe.stage(db, BrowserA, 'book', 1, part, text));
    }
    await scribe.answer(scribe.commit(db, BrowserA, [scribe.change('book', 0, one)]));
    for (const part of [0, 1, 5]) {
        await scribe.answer(scribe.stage(db, BrowserA, 'book', 2, part, 'Revision two part ' + part));
    }
    const two = [0, 1].map((part) => 'Revision two part ' + part);
    await scribe.answer(scribe.commit(db, BrowserA, [scribe.change('book', 1, two)]));
    assert.deepEqual(await scribe.rows(db, 'SELECT revision, part, text FROM scribe_parts ORDER BY revision, part'), [
        { revision: 2, part: 0, text: 'Revision two part 0' },
        { revision: 2, part: 1, text: 'Revision two part 1' },
    ]);
    for (const [revision, part] of [[1, 0], [1, 1], [1, 2], [2, 2], [2, 5]]) {
        assert.equal(await scribe.refusal(scribe.part(db, 'book', revision, part), 404), 'part_not_found');
    }
    assert.equal(await (await scribe.part(db, 'book', 2, 1)).text(), 'Revision two part 1');
});

test('scribe_committed_text_cannot_be_rewritten', async (context) => {
    CloudflareCrypto.install(context);
    const db = new SqliteD1(context);
    const { BrowserA, Start: nowMs } = scribe;
    context.mock.method(Date, 'now', () => nowMs);
    await scribe.answer(scribe.lease(db, BrowserA));
    await scribe.answer(scribe.stage(db, BrowserA, 'book', 1, 0, 'Original'));
    await scribe.answer(scribe.commit(db, BrowserA, [scribe.change('book', 0, ['Original'])]));
    assert.equal(await scribe.refusal(scribe.stage(db, BrowserA, 'book', 1, 0, 'Rewrite'), 409), 'revision_conflict');
    assert.equal(await (await scribe.part(db, 'book', 1, 0)).text(), 'Original');

    await scribe.answer(scribe.stage(db, BrowserA, 'book', 2, 0, 'Second'));
    await scribe.answer(scribe.commit(db, BrowserA, [scribe.change('book', 1, ['Second'])]));
    for (const revision of [1, 2]) {
        assert.equal(await scribe.refusal(scribe.stage(db, BrowserA, 'book', revision, 0, 'Rewrite'), 409),
            'revision_conflict');
    }
    assert.equal(await (await scribe.part(db, 'book', 2, 0)).text(), 'Second');
    assert.deepEqual(await scribe.rows(db, 'SELECT revision, text FROM scribe_parts'), [
        { revision: 2, text: 'Second' },
    ]);
});

test('scribe_leases_pass_and_lapse', async (context) => {
    CloudflareCrypto.install(context);
    const db = new SqliteD1(context);
    const { BrowserA, BrowserB, Start } = scribe;
    let nowMs = Start;
    context.mock.method(Date, 'now', () => nowMs);

    assert.deepEqual(await scribe.answer(scribe.lease(db, BrowserA)), {
        held: true, lease: scribe.view(BrowserA, Start + 90000), asks: [], now: Start,
    });
    assert.deepEqual(await scribe.answer(scribe.lease(db, BrowserB, 'Asked')), {
        held: false, lease: scribe.view(BrowserA, Start + 90000, BrowserB, true), asks: [], now: Start,
    });
    nowMs = Start + 1000;
    assert.deepEqual(await scribe.answer(scribe.lease(db, BrowserA)), {
        held: true, lease: scribe.view(BrowserA, nowMs + 90000, BrowserB, true), asks: [], now: nowMs,
    });
    const passedAt = nowMs;
    assert.deepEqual(await scribe.answer(scribe.release(db, BrowserA)), {
        released: true, lease: scribe.view(BrowserB, passedAt + 90000), now: passedAt,
    });
    nowMs = passedAt + 1000;
    assert.deepEqual(await scribe.answer(scribe.lease(db, BrowserA)), {
        held: false, lease: scribe.view(BrowserB, passedAt + 90000), asks: [], now: nowMs,
    });
    assert.deepEqual(await scribe.answer(scribe.release(db, BrowserA)), {
        released: false, lease: scribe.view(BrowserB, passedAt + 90000), now: nowMs,
    });
    nowMs = passedAt + 91000;
    assert.deepEqual(await scribe.answer(scribe.lease(db, BrowserA)), {
        held: true, lease: scribe.view(BrowserA, nowMs + 90000), asks: [], now: nowMs,
    });

    const wantedAt = nowMs;
    assert.deepEqual(await scribe.answer(scribe.lease(db, BrowserB, 'Waiting')), {
        held: false, lease: scribe.view(BrowserA, wantedAt + 90000, BrowserB, false), asks: [], now: wantedAt,
    });
    nowMs = wantedAt + 60000;
    assert.deepEqual((await scribe.answer(scribe.lease(db, BrowserA))).lease,
        scribe.view(BrowserA, nowMs + 90000, BrowserB, false));
    nowMs = wantedAt + 91000;
    assert.deepEqual(await scribe.answer(scribe.release(db, BrowserA)), { released: true, lease: null, now: nowMs });
    assert.equal((await scribe.answer(scribe.heads(db, BrowserB))).lease, null);
    assert.deepEqual(await scribe.rows(db, 'SELECT count(*) AS count FROM scribe_lease'), [{ count: 0 }]);

    const againAt = nowMs;
    await scribe.answer(scribe.lease(db, BrowserA));
    const held = againAt + 90000;
    for (const [want, asked] of [['Waiting', false], ['Asked', true], ['Waiting', true]]) {
        assert.deepEqual((await scribe.answer(scribe.lease(db, BrowserB, want))).lease,
            scribe.view(BrowserA, held, BrowserB, asked), want);
    }
    assert.deepEqual(await scribe.rows(db, 'SELECT wanted, asked FROM scribe_lease'), [{ wanted: BrowserB, asked: 1 }]);

    nowMs = againAt + 50000;
    await scribe.answer(scribe.lease(db, BrowserB, 'Asked'));
    nowMs = againAt + 91000;
    assert.deepEqual(await scribe.answer(scribe.lease(db, BrowserB)), {
        held: true, lease: scribe.view(BrowserB, nowMs + 90000), asks: [], now: nowMs,
    });
});

test('scribe_spending_is_shared', async (context) => {
    CloudflareCrypto.install(context);
    const db = new SqliteD1(context);
    const { BrowserA, BrowserB, Day, NextDay, Start } = scribe;
    context.mock.method(Date, 'now', () => Start);
    const spends = [
        [BrowserA, Day, 0.25, { day: Day, sum: 0.25, mine: 0.25 }],
        [BrowserA, Day, 0.25, { day: Day, sum: 0.25, mine: 0.25 }],
        [BrowserA, Day, 0.1, { day: Day, sum: 0.25, mine: 0.25 }],
        [BrowserB, Day, 0.5, { day: Day, sum: 0.75, mine: 0.5 }],
        [BrowserA, NextDay, 0.3, { day: NextDay, sum: 0.3, mine: 0.3 }],
    ];
    for (const [browser, day, total, expected] of spends) {
        assert.deepEqual(await scribe.answer(scribe.spend(db, browser, day, total)), expected);
    }
    for (const day of ['2026-02-29', '2026-11-31', '2026-99-99', '0000-00-00']) {
        assert.equal(await scribe.refusal(scribe.spend(db, BrowserA, day, 1), 400), 'bad_request');
        assert.equal(await scribe.refusal(scribe.heads(db, BrowserA, day), 400), 'bad_request');
    }
    assert.deepEqual((await scribe.answer(scribe.heads(db, BrowserA))).spent, { day: Day, sum: 0.75, mine: 0.25 });
    assert.deepEqual((await scribe.answer(scribe.heads(db, BrowserB, NextDay))).spent, {
        day: NextDay, sum: 0.3, mine: 0,
    });
    assert.deepEqual(await scribe.rows(db, 'SELECT day, browser, total FROM scribe_spent ORDER BY day, browser'), [
        { day: Day, browser: BrowserA, total: 0.25 },
        { day: Day, browser: BrowserB, total: 0.5 },
        { day: NextDay, browser: BrowserA, total: 0.3 },
    ]);
});

test('scribe_part_boundary', async (context) => {
    CloudflareCrypto.install(context);
    const db = new SqliteD1(context);
    const { BrowserA, Start: nowMs } = scribe;
    context.mock.method(Date, 'now', () => nowMs);
    const texts = ['𐍈'.repeat(199999) + 'ab', '€'.repeat(400000)];
    await scribe.answer(scribe.lease(db, BrowserA));
    for (const [part, text] of texts.entries()) {
        await scribe.answer(scribe.stage(db, BrowserA, 'book', 1, part, text));
    }
    await scribe.answer(scribe.commit(db, BrowserA, [scribe.change('book', 0, texts)]));
    for (const [part, text] of texts.entries()) {
        const read = await scribe.part(db, 'book', 1, part);
        assert.equal(read.status, 200);
        assert.equal(await read.text() === text, true, 'part ' + part);
    }
    assert.deepEqual(await scribe.rows(db,
        'SELECT length(text) AS characters, length(CAST(text AS BLOB)) AS bytes FROM scribe_parts ORDER BY part'), [
        { characters: 200001, bytes: 799998 },
        { characters: 400000, bytes: 1200000 },
    ]);
    for (const text of ['a'.repeat(400001), '𐍈'.repeat(199999) + 'abc']) {
        assert.equal(await scribe.refusal(scribe.stage(db, BrowserA, 'book', 2, 0, text), 413), 'payload_too_large');
    }
    assert.deepEqual(await scribe.rows(db, 'SELECT count(*) AS count FROM scribe_parts WHERE revision = 2'), [
        { count: 0 },
    ]);
});

test('scribe_separate_capacity', async (context) => {
    CloudflareCrypto.install(context);
    const db = new SqliteD1(context);
    const nowMs = scribe.Start + 1200;
    context.mock.method(Date, 'now', () => nowMs);
    const windowStart = Math.floor(nowMs / 60000) * 60;
    for (let attempt = 0; attempt < 600; attempt++) {
        await worker.claimRateSlot(db, nowMs, worker.Counters.Scribe);
    }
    assert.deepEqual(await scribe.counter(db), { windowStart, count: 600 });
    const notes = await fixtures.read(db, fixtures.Alpha);
    assert.equal(notes.status, 404);
    assert.deepEqual(await fixtures.rateRow(db), { windowStart, count: 1 });
    const denied = await scribe.heads(db, scribe.BrowserA);
    assert.equal(denied.status, 429);
    assert.equal(denied.headers.get('Retry-After'), '59');
    assert.equal((await denied.json()).error.code, 'rate_limited');
    assert.deepEqual(await scribe.counter(db), { windowStart, count: 600 });
    assert.deepEqual(await fixtures.rateRow(db), { windowStart, count: 1 });
});

test('scribe_parallel_rate_claims', async (context) => {
    CloudflareCrypto.install(context);
    const nowMs = scribe.Start;
    context.mock.method(Date, 'now', () => nowMs);
    const waiting = Promise.withResolvers();
    let gated = false;
    let arrivals = 0;
    const db = new SqliteD1(context, {
        /**
         * @param {string} sql
         * @return {Promise<void>}
         */
        async beforeExecute(sql) {
            if (gated && sql === worker.Sql.ClaimScribeSlot) {
                arrivals++;
                if (arrivals === 200) {
                    waiting.resolve();
                }
                await waiting.promise;
            }
        },
    });
    for (let attempt = 0; attempt < 500; attempt++) {
        await worker.claimRateSlot(db, nowMs, worker.Counters.Scribe);
    }
    gated = true;
    const responses = await Promise.all(Array.from({ length: 200 }, () => scribe.heads(db, scribe.BrowserA)));
    assert.equal(responses.filter(({ status }) => status === 200).length, 100);
    assert.equal(responses.filter(({ status }) => status === 429).length, 100);
    assert.deepEqual(await scribe.counter(db), { windowStart: Math.floor(nowMs / 60000) * 60, count: 600 });
    assert.deepEqual(await scribe.rows(db, 'SELECT count(*) AS count FROM api_rate_limit'), [{ count: 0 }]);
});

test('scribe_asks_reach_the_reader', async (context) => {
    CloudflareCrypto.install(context);
    const db = new SqliteD1(context);
    const { BrowserA, BrowserB, Start } = scribe;
    let nowMs = Start;
    context.mock.method(Date, 'now', () => nowMs);
    const older = 'Fictional-Ask-zzzz-0001';
    const newer = 'Fictional-Ask-aaaa-0002';
    await scribe.answer(scribe.lease(db, BrowserA));
    nowMs = Start + 1;
    const dismiss = { type: 'Dismiss', finding: 'Fictional' };
    assert.deepEqual(await scribe.answer(scribe.ask(db, BrowserB, older, dismiss), 201), { id: older });
    nowMs = Start + 2;
    assert.deepEqual(await scribe.answer(scribe.ask(db, BrowserB, newer, { type: 'Confirm' }), 201), { id: newer });
    const waiting = [
        { id: older, browser: BrowserB, action: '{"type":"Dismiss","finding":"Fictional"}', createdAt: Start + 1 },
        { id: newer, browser: BrowserB, action: '{"type":"Confirm"}', createdAt: Start + 2 },
    ];
    nowMs = Start + 3;
    assert.deepEqual((await scribe.answer(scribe.lease(db, BrowserA))).asks, waiting);
    assert.deepEqual((await scribe.answer(scribe.heads(db, BrowserB))).asks, waiting);
    assert.deepEqual((await scribe.answer(scribe.lease(db, BrowserB, 'Waiting'))).asks, []);
    assert.deepEqual(await scribe.answer(scribe.ask(db, BrowserB, older, { type: 'Dismiss', finding: 'Changed' })), {
        id: older,
    });
    assert.deepEqual(await scribe.rows(db, 'SELECT action FROM scribe_asks WHERE id = ?1', older), [
        { action: waiting[0].action },
    ]);

    await scribe.answer(scribe.stage(db, BrowserA, 'book', 1, 0, 'Applied'));
    await scribe.answer(scribe.commit(db, BrowserA, [scribe.change('book', 0, ['Applied'])], [older, newer]));
    assert.deepEqual((await scribe.answer(scribe.heads(db, BrowserA))).asks, []);

    const fill = Array.from({ length: 20 }, (_, index) => 'Fictional-Ask-fill-' + String(index).padStart(4, '0'));
    for (const [index, id] of fill.entries()) {
        assert.deepEqual(await scribe.answer(scribe.ask(db, BrowserB, id, { index }), 201), { id });
    }
    assert.equal(await scribe.refusal(scribe.ask(db, BrowserB, 'Fictional-Ask-over-0020', { index: 20 }), 409),
        'asks_full');
    assert.deepEqual(await scribe.answer(scribe.ask(db, BrowserB, fill[0], { index: 0 })), { id: fill[0] });
    assert.deepEqual(await scribe.rows(db, 'SELECT count(*) AS count FROM scribe_asks'), [{ count: 20 }]);
    assert.equal((await scribe.answer(scribe.heads(db, BrowserA))).asks.length, 20);
});

test('scribe_commit_names_the_parts_it_staged', async (context) => {
    CloudflareCrypto.install(context);
    const db = new SqliteD1(context);
    const { BrowserA, BrowserB, Start } = scribe;
    let nowMs = Start;
    context.mock.method(Date, 'now', () => nowMs);
    const stored = 'SELECT kind, revision, part, text, digest FROM scribe_parts ORDER BY kind, revision, part';
    /**
     * @param {string} kind
     * @param {number} revision
     * @param {number} part
     * @param {string} text
     * @return {object}
     */
    const row = (kind, revision, part, text) => ({ kind, revision, part, text, digest: scribe.digest(text) });

    await scribe.answer(scribe.lease(db, BrowserA));
    await scribe.answer(scribe.stage(db, BrowserA, 'book', 1, 0, 'A-part-0'));
    await scribe.answer(scribe.stage(db, BrowserA, 'book', 1, 1, 'A-part-1'));
    nowMs = Start + 91000;
    assert.equal((await scribe.answer(scribe.lease(db, BrowserB))).held, true);
    await scribe.answer(scribe.stage(db, BrowserB, 'book', 1, 0, 'B-part-0'));
    const handedOver = [scribe.change('book', 0, ['B-part-0', 'B-part-1'])];
    assert.equal(await scribe.refusal(scribe.commit(db, BrowserB, handedOver), 409), 'parts_missing');
    assert.deepEqual((await scribe.answer(scribe.heads(db, BrowserB))).heads, []);
    assert.equal(await scribe.refusal(scribe.part(db, 'book', 1, 0), 404), 'part_not_found');
    assert.deepEqual(await scribe.rows(db, stored), [
        row('book', 1, 0, 'B-part-0'), row('book', 1, 1, 'A-part-1'),
    ]);
    await scribe.answer(scribe.stage(db, BrowserB, 'book', 1, 1, 'B-part-1'));
    await scribe.answer(scribe.commit(db, BrowserB, handedOver));
    assert.equal(await scribe.published(db, 'book', 1, 2), 'B-part-0B-part-1');

    await scribe.answer(scribe.stage(db, BrowserB, 'book', 2, 0, 'new-0'));
    await scribe.answer(scribe.stage(db, BrowserB, 'book', 2, 1, 'new-1'));
    await scribe.answer(scribe.stage(db, BrowserB, 'book', 2, 1, 'old-1'));
    assert.deepEqual((await scribe.rows(db, stored)).filter((entry) => entry.revision === 2), [
        row('book', 2, 0, 'new-0'), row('book', 2, 1, 'old-1'),
    ]);
    const reordered = [scribe.change('book', 1, ['new-0', 'new-1'])];
    assert.equal(await scribe.refusal(scribe.commit(db, BrowserB, reordered), 409), 'parts_missing');
    const swapped = [scribe.change('book', 1, ['old-1', 'new-0'])];
    assert.equal(await scribe.refusal(scribe.commit(db, BrowserB, swapped), 409), 'parts_missing');
    assert.equal(await scribe.published(db, 'book', 1, 2), 'B-part-0B-part-1');
    await scribe.answer(scribe.stage(db, BrowserB, 'book', 2, 1, 'new-1'));
    assert.deepEqual((await scribe.answer(scribe.commit(db, BrowserB, reordered))).heads.map(
        ({ kind, revision, parts }) => ({ kind, revision, parts })
    ), [{ kind: 'book', revision: 2, parts: 2 }]);
    assert.equal(await scribe.published(db, 'book', 2, 2), 'new-0new-1');

    await scribe.answer(scribe.stage(db, BrowserB, 'live', 1, 0, 'Live, new'));
    await scribe.answer(scribe.stage(db, BrowserB, 'book', 3, 0, 'Book three'));
    await scribe.answer(scribe.stage(db, BrowserB, 'live', 1, 0, 'Live, stale'));
    const mixed = [scribe.change('book', 2, ['Book three']), scribe.change('live', 0, ['Live, new'])];
    assert.equal(await scribe.refusal(scribe.commit(db, BrowserB, mixed), 409), 'parts_missing');
    assert.deepEqual((await scribe.answer(scribe.heads(db, BrowserB))).heads.map(({ kind, revision }) => ({
        kind, revision,
    })), [{ kind: 'book', revision: 2 }]);
    await scribe.answer(scribe.stage(db, BrowserB, 'live', 1, 0, 'Live, new'));
    await scribe.answer(scribe.commit(db, BrowserB, mixed));
    assert.equal(await scribe.published(db, 'book', 3, 1), 'Book three');
    assert.equal(await scribe.published(db, 'live', 1, 1), 'Live, new');
    assert.deepEqual(await scribe.rows(db, stored), [row('book', 3, 0, 'Book three'), row('live', 1, 0, 'Live, new')]);
});

test('scribe_nul_parts_are_refused_before_storage', async (context) => {
    CloudflareCrypto.install(context);
    const logs = context.mock.method(console, 'error', () => {});
    const db = new SqliteD1(context);
    const { BrowserA, Start } = scribe;
    context.mock.method(Date, 'now', () => Start);
    await scribe.answer(scribe.lease(db, BrowserA));
    for (const text of ['\u0000abc', 'a\u0000b', 'abc\u0000']) {
        assert.equal(await scribe.refusal(scribe.stage(db, BrowserA, 'book', 1, 0, text), 400), 'bad_request');
    }
    assert.equal(logs.mock.callCount(), 0);
    assert.deepEqual(await scribe.rows(db, 'SELECT count(*) AS count FROM scribe_parts'), [{ count: 0 }]);
});

test('scribe_kind_holds_at_most_ten_parts', async (context) => {
    CloudflareCrypto.install(context);
    const db = new SqliteD1(context);
    const { BrowserA, Start } = scribe;
    context.mock.method(Date, 'now', () => Start);
    const texts = Array.from({ length: 10 }, (_, index) => 'Part ' + index + ' ');
    await scribe.answer(scribe.lease(db, BrowserA));
    for (const [part, text] of texts.entries()) {
        await scribe.answer(scribe.stage(db, BrowserA, 'book', 1, part, text));
    }
    assert.equal(await scribe.refusal(scribe.stage(db, BrowserA, 'book', 1, 10, 'Part 10'), 400), 'bad_request');
    const eleven = [scribe.change('book', 0, [...texts, 'Part 10'])];
    assert.equal(await scribe.refusal(scribe.commit(db, BrowserA, eleven), 400), 'bad_request');
    await scribe.answer(scribe.commit(db, BrowserA, [scribe.change('book', 0, texts)]));
    assert.equal(await scribe.published(db, 'book', 1, 10), texts.join(''));
    assert.equal(await scribe.refusal(scribe.part(db, 'book', 1, 10), 400), 'bad_request');
});
