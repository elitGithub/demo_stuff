import assert from 'node:assert/strict';
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
