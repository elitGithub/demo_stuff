import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../worker.mjs';
import CloudflareCrypto from './support/CloudflareCrypto.mjs';
import ScriptedD1 from './support/ScriptedD1.mjs';

const fixtures = Object.freeze({
    Origin: 'https://api.example',
    Key: 'FictionalZetaKey0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl',
    Alpha: '/rooms/alpha',
    Beta: '/rooms/beta',
    Timestamp: '2026-11-10T10:00:00.000Z',

    /**
     * @param {string} [roomId]
     * @return {string}
     */
    room(roomId = fixtures.Alpha) {
        return '/v1/memory?roomId=' + encodeURIComponent(roomId);
    },

    /**
     * @param {string} [roomId]
     * @param {string} [notes]
     * @param {number} [revision]
     * @return {object}
     */
    memory(roomId = fixtures.Alpha, notes = 'Fictional notes', revision = 1) {
        return { roomId, notes, revision, updatedAt: fixtures.Timestamp };
    },

    /**
     * @param {string} path
     * @param {RequestInit & {duplex?: string}} [options]
     * @return {Request}
     */
    request(path, options = {}) {
        const headers = new Headers({ Authorization: 'Bearer ' + fixtures.Key });
        for (const [name, value] of new Headers(options.headers)) {
            headers.set(name, value);
        }
        return new Request(new URL(path, fixtures.Origin), { ...options, headers });
    },

    /**
     * @param {BodyInit} body
     * @param {string} [contentType]
     * @return {Request}
     */
    put(body, contentType = 'application/json') {
        return fixtures.request(fixtures.room(), {
            method: 'PUT', body, headers: { 'Content-Type': contentType },
        });
    },

    /**
     * @param {Request} request
     * @param {ScriptedD1} db
     * @return {Promise<Response>}
     */
    send(request, db) {
        return worker.fetch(request, { DB: db, DM_API_KEY: fixtures.Key });
    },
});

test('auth_precedes_database_and_route', async (context) => {
    CloudflareCrypto.install(context);
    const db = new ScriptedD1();
    const wrong = 'X' + fixtures.Key.slice(1);
    const missing = new Request(fixtures.Origin + fixtures.room());
    const wrongRoute = fixtures.request('/unknown', { headers: { Authorization: 'Bearer ' + wrong } });
    const combined = fixtures.request(fixtures.room(), {
        headers: [
            ['Authorization', 'Bearer ' + fixtures.Key],
            ['Authorization', 'Bearer ' + fixtures.Key],
        ],
    });
    assert.equal(combined.headers.get('Authorization'), 'Bearer ' + fixtures.Key + ', Bearer ' + fixtures.Key);
    const wrongScheme = fixtures.request(fixtures.room(), { headers: { Authorization: 'Basic ' + fixtures.Key } });
    const doubleSpace = fixtures.request(fixtures.room(), { headers: { Authorization: 'Bearer  ' + fixtures.Key } });
    for (const request of [missing, wrongRoute, combined, wrongScheme, doubleSpace]) {
        for (const DB of [db, undefined]) {
            const response = await worker.fetch(request, { DB, DM_API_KEY: fixtures.Key });
            assert.equal(response.status, 401);
            assert.deepEqual(await response.json(), {
                error: { code: 'unauthorized', message: 'Authentication required.' },
            });
            assert.equal(db.calls.length, 0);
        }
    }
});

test('configuration_fails_closed', async (context) => {
    CloudflareCrypto.install(context);
    const logs = context.mock.method(console, 'error', () => {});
    const db = new ScriptedD1();
    for (const secret of ['', 'short', fixtures.Key.slice(0, -1) + '\x7f', undefined]) {
        const response = await worker.fetch(fixtures.request(fixtures.room()), { DB: db, DM_API_KEY: secret });
        assert.equal(response.status, 503);
        assert.equal((await response.json()).error.code, 'configuration_error');
    }
    const response = await worker.fetch(fixtures.request(fixtures.room()), { DM_API_KEY: fixtures.Key });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'configuration_error');
    assert.equal(db.calls.length, 0);
    assert.equal(logs.mock.callCount(), 5);
});

test('digest_comparison_and_detached_fetch', async (context) => {
    const sizes = CloudflareCrypto.install(context);
    const db = new ScriptedD1([{ windowStart: 0 }], [fixtures.memory()]);
    const { fetch } = worker;
    const ok = await fetch(fixtures.request(fixtures.room(), { headers: { Authorization: 'bEaReR ' + fixtures.Key } }), {
        DB: db, DM_API_KEY: fixtures.Key,
    });
    assert.equal(ok.status, 200);
    for (const wrong of ['X' + fixtures.Key.slice(1), fixtures.Key.slice(0, -1) + 'X']) {
        const response = await fixtures.send(fixtures.request(fixtures.room(), {
            headers: { Authorization: 'Bearer ' + wrong },
        }), db);
        assert.equal(response.status, 401);
    }
    assert.deepEqual(sizes, [[32, 32], [32, 32], [32, 32]]);
    assert.equal(db.calls.length, 2);
});

test('bearer_keys_accept_the_range_and_literal_punctuation', async (context) => {
    const sizes = CloudflareCrypto.install(context);
    const punctuation = Array.from({ length: 94 }, (_, index) => String.fromCharCode(33 + index))
        .filter((character) => !/[A-Za-z0-9]/.test(character)).join('');
    assert.equal(punctuation.length, 32);

    const lengths = [60, 61, 64, 253, 254];
    const keys = lengths.map((length) => (punctuation + '%2F').padEnd(length - 1, 'X') + '~');
    for (const key of keys) {
        const db = new ScriptedD1([{ windowStart: 0 }], [fixtures.memory()]);
        const request = fixtures.request(fixtures.room(), { headers: { Authorization: 'bEaReR ' + key } });
        const response = await worker.fetch(request, { DB: db, DM_API_KEY: key });
        assert.equal(response.status, 200, 'matching key length ' + key.length);
        assert.equal(db.calls.length, 2);
    }
    assert.deepEqual(keys.map((key) => key.length), lengths);

    const db = new ScriptedD1();
    const [, , key, longerKey] = keys;
    const wrongKeys = ['?' + key.slice(1), key.slice(0, -1) + '%', key.replace('%2F', '/'), longerKey];
    for (const wrong of wrongKeys) {
        const request = fixtures.request(fixtures.room(), { headers: { Authorization: 'Bearer ' + wrong } });
        const response = await worker.fetch(request, { DB: db, DM_API_KEY: key });
        assert.equal(response.status, 401);
    }

    for (const secret of [keys[0], keys.at(-1)]) {
        const browserRequest = new Request(fixtures.Origin + fixtures.room());
        const response = await worker.fetch(browserRequest, { DB: db, DM_API_KEY: secret });
        assert.equal(response.status, 401);
        assert.equal((await response.json()).error.code, 'unauthorized');
    }
    assert.equal(db.calls.length, 0);
    assert.deepEqual(sizes, Array.from({ length: keys.length + wrongKeys.length }, () => [32, 32]));
});

test('malformed_keys_fail_before_digests_or_storage', async (context) => {
    const sizes = CloudflareCrypto.install(context);
    const logs = context.mock.method(console, 'error', () => {});
    const db = new ScriptedD1();
    const invalidKeys = [
        fixtures.Key.slice(0, 59), fixtures.Key.padEnd(255, 'X'),
        ...[' ', '\t', '\r', '\n', '\0', '\x1f', '\x7f', '\x80', 'é', '𐍈'].map((character) =>
            fixtures.Key.slice(0, 30) + character + fixtures.Key.slice(31)
        ),
    ];
    const browserRequest = new Request(fixtures.Origin + fixtures.room());
    const invalidSecrets = [...invalidKeys, null, 123, { length: 60 }];
    for (const secret of invalidSecrets) {
        const response = await worker.fetch(browserRequest, { DB: db, DM_API_KEY: secret });
        assert.equal(response.status, 503);
        assert.equal((await response.json()).error.code, 'configuration_error');
    }

    const invalidHeaders = [
        ...invalidKeys.map((key) => 'Bearer ' + key),
        'Bearer\t' + fixtures.Key, 'Bearer  ' + fixtures.Key,
        ' Bearer ' + fixtures.Key, 'Bearer ' + fixtures.Key + ' ',
    ];
    for (const header of invalidHeaders) {
        const request = fixtures.request(fixtures.room());
        context.mock.method(request.headers, 'get', () => header);
        const response = await fixtures.send(request, db);
        assert.equal(response.status, 401);
        assert.equal((await response.json()).error.code, 'unauthorized');
    }
    assert.equal(logs.mock.callCount(), invalidSecrets.length);
    assert.deepEqual(sizes, []);
    assert.equal(db.calls.length, 0);
});

test('http_headers_normalize_outer_whitespace_before_authentication', async (context) => {
    CloudflareCrypto.install(context);
    const db = new ScriptedD1([{ windowStart: 0 }], [fixtures.memory()]);
    const request = fixtures.request(fixtures.room(), { headers: { Authorization: ' \tBearer ' + fixtures.Key + '\t ' } });
    assert.equal(request.headers.get('Authorization'), 'Bearer ' + fixtures.Key);
    const response = await fixtures.send(request, db);
    assert.equal(response.status, 200);
    assert.equal(db.calls.length, 2);
});

test('routing_and_methods', async (context) => {
    CloudflareCrypto.install(context);
    const db = new ScriptedD1([{ windowStart: 0 }], [fixtures.memory()]);
    const responses = [];
    const success = await fixtures.send(fixtures.request(fixtures.room()), db);
    responses.push(success);
    assert.equal(success.status, 200);
    for (const [path, method, allow] of [[fixtures.room(), 'POST', 'GET, PUT'], ['/v1/memories', 'PUT', 'GET'], [fixtures.room(), 'HEAD', 'GET, PUT']]) {
        const response = await fixtures.send(fixtures.request(path, { method }), db);
        responses.push(response);
        assert.equal(response.status, 405);
        assert.equal(response.headers.get('Allow'), allow);
        if (method === 'HEAD') {
            assert.equal(response.body, null);
        }
    }
    const unknown = await fixtures.send(fixtures.request('/unknown'), db);
    responses.push(unknown);
    assert.equal(unknown.status, 404);
    for (const method of ['OPTIONS', 'HEAD']) {
        const response = await fixtures.send(new Request(fixtures.Origin + fixtures.room(), { method }), db);
        responses.push(response);
        assert.equal(response.status, 401);
        if (method === 'HEAD') {
            assert.equal(response.body, null);
        }
    }
    for (const response of responses) {
        assert.equal([...response.headers.keys()].some((name) => name.startsWith('access-control-allow-')), false);
    }
    assert.equal(db.calls.length, 2);
});

test('room_identity_is_lossless', async (context) => {
    CloudflareCrypto.install(context);
    for (const roomId of ['/rooms/a%2Fb', '/rooms/a/b', "/rooms/';DROP-TABLE-room_memories;--"]) {
        const db = new ScriptedD1([{ windowStart: 0 }], [fixtures.memory(roomId)]);
        const response = await fixtures.send(fixtures.request(fixtures.room(roomId)), db);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).roomId, roomId);
        assert.deepEqual(db.calls[1], { sql: worker.Sql.ReadMemory, values: [roomId] });
    }
});

test('room_and_query_validation', async (context) => {
    CloudflareCrypto.install(context);
    const longest = '/' + 'é'.repeat(255) + 'a';
    const db = new ScriptedD1([{ windowStart: 0 }], [fixtures.memory(longest)]);
    const ok = await fixtures.send(fixtures.request(fixtures.room(longest)), db);
    assert.equal(ok.status, 200);
    assert.deepEqual(db.calls[1].values, [longest]);
    const untouched = new ScriptedD1();
    const badRooms = ['', longest + 'a', 'missing-slash', '/space here', '/tab\t', '/line\n', '/\u0000', '/\u0085', '/\u2003', '/\\', '/?', '/#'];
    const badQueries = [
        '/v1/memory',
        '/v1/memory?roomId=%',
        '/v1/memory?roomId=%GG',
        '/v1/memory?roomId=%2F%C0%AF',
        '/v1/memory?roomId=%2F%ED%A0%80',
        '/v1/memory?roomId=%2Falpha+beta',
        '/v1/memory?roomId=%2Falpha&%72oomId=%2Fbeta',
        '/v1/memory?roomId=%2Falpha&key=unexpected',
        '/v1/memory?roomId=%2Falpha&',
        '/v1/memories?after=',
        '/v1/memories?after',
        '/v1/memories?after=%2Falpha&%61fter=%2Fbeta',
        '/v1/memories?%FF=2',
        'http://api.example/v1/memory?roomId=%2Falpha',
    ];
    for (const path of [...badRooms.map(fixtures.room), ...badQueries]) {
        const response = await fixtures.send(fixtures.request(path), untouched);
        assert.equal(response.status, 400, path);
    }
    const getWithBody = {
        url: fixtures.Origin + fixtures.room(),
        method: 'GET',
        headers: fixtures.request(fixtures.room()).headers,
        body: new ReadableStream(),
    };
    assert.equal((await fixtures.send(getWithBody, untouched)).status, 400);
    assert.equal(untouched.calls.length, 0);
});

test('put_shape_and_media_type', async (context) => {
    CloudflareCrypto.install(context);
    const json = JSON.stringify({ notes: 'Fictional notes', expectedRevision: 0 });
    const db = new ScriptedD1([{ windowStart: 0 }], [fixtures.memory()]);
    const ok = await fixtures.send(fixtures.put(json, 'Application/JSON; Charset="UTF-8"'), db);
    assert.equal(ok.status, 201);
    assert.equal(db.calls[1].sql, worker.Sql.CreateMemory);
    const untouched = new ScriptedD1();
    for (const contentType of ['text/plain', 'application/json; charset=latin1', 'application/json; charset=utf-8; charset=utf-8', 'application/json, application/json']) {
        const response = await fixtures.send(fixtures.put(json, contentType), untouched);
        assert.equal(response.status, 415);
    }
    for (const payload of [
        '{', 'null', '[]', 'true', '{}',
        '{"notes":"x"}',
        '{"expectedRevision":0}',
        '{"notes":"x","expectedRevision":0,"extra":1}',
        '{"notes":null,"expectedRevision":0}',
        '{"notes":"x","expectedRevision":"0"}',
        '{"notes":"x","expectedRevision":true}',
        '{"notes":"x","expectedRevision":0.5}',
        '{"notes":"x","expectedRevision":-1}',
        '{"notes":"x","expectedRevision":9007199254740992}',
    ]) {
        const response = await fixtures.send(fixtures.put(payload), untouched);
        assert.equal(response.status, 400, payload);
    }
    assert.equal(untouched.calls.length, 0);
});

test('revision_validation_uses_the_selected_numeric_source', async (context) => {
    CloudflareCrypto.install(context);
    const untouched = new ScriptedD1();
    const hugeExponent = '9'.repeat(8192);
    for (const literal of [
        '1.0000000000000001', '-1e-400', '9007199254740990.5',
        '1e-400', '1e' + hugeExponent, '1e-' + hugeExponent,
        '9007199254740991.00001', '90071992547409920e-1',
    ]) {
        const request = fixtures.put('{"notes":"fixture","expectedRevision":' + literal + '}');
        const response = await fixtures.send(request, untouched);
        assert.equal(response.status, 400, literal.slice(0, 32));
    }
    for (const raw of [
        '{"expectedRevision":1,"notes":"fixture","expectedRevision":1.0000000000000001}',
        '{"expectedRevision":1.0000000000000001,"notes":{"expectedRevision":1}}',
        '{"expectedRevision":1.0000000000000001,"notes":"\\"expectedRevision\\":1"}',
    ]) {
        const response = await fixtures.send(fixtures.put(raw), untouched);
        assert.equal(response.status, 400, raw);
    }
    assert.equal(untouched.calls.length, 0);

    const cases = [
        ['{"notes":"fixture","expectedRevision":1.0}', 1],
        ['{"notes":"fixture","expectedRevision":0.0009e+4}', 9],
        ['{"notes":"fixture","expectedRevision":1200E-2}', 12],
        ['{"notes":"fixture","expectedRevision":2e3}', 2000],
        ['{"notes":"fixture","expectedRevision":9007199254740991000e-3}', Number.MAX_SAFE_INTEGER],
        ['{"notes":"fixture","expectedRevision":-0e' + hugeExponent + '}', 0],
        ['{"notes":"fixture","expectedRevision":1.0000000000000001,"\\u0065xpectedRevision":1}', 1],
        ['{"notes":"\\"expectedRevision\\":0.5","expectedRevision":1}', 1],
    ];
    for (const [raw, revision] of cases) {
        const db = new ScriptedD1([{ windowStart: 0 }], [fixtures.memory(fixtures.Alpha, 'fixture', revision || 1)]);
        const response = await fixtures.send(fixtures.put(raw), db);
        assert.equal(response.status, revision === 0 ? 201 : 200, raw.slice(0, 64));
        assert.equal(db.calls.length, 2);
        if (revision === 0) {
            assert.equal(db.calls[1].sql, worker.Sql.CreateMemory);
        } else {
            assert.equal(db.calls[1].sql, worker.Sql.UpdateMemory);
            assert.equal(db.calls[1].values[1], revision);
        }
    }
});

test('revision_validation_fails_closed_without_native_source', async (context) => {
    CloudflareCrypto.install(context);
    const logs = context.mock.method(console, 'error', () => {});
    const parse = JSON.parse;
    context.mock.method(JSON, 'parse', (json, reviver) => {
        if (typeof reviver !== 'function') {
            return parse(json, reviver);
        }
        return parse(json,
            /**
             * @this {object}
             * @param {string} key
             * @param {unknown} value
             * @return {unknown}
             */
            function omitSource(key, value) {
                return reviver.call(this, key, value);
            }
        );
    });
    const db = new ScriptedD1();
    const response = await fixtures.send(fixtures.put('{"notes":"fixture","expectedRevision":1}'), db);
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error.code, 'internal_error');
    assert.equal(logs.mock.callCount(), 1);
    assert.equal(db.calls.length, 0);
});

test('body_count_ignores_declared_length', async (context) => {
    CloudflareCrypto.install(context);
    const json = '{"notes":"Fictional notes","expectedRevision":0}';
    const padded = new TextEncoder().encode(json.padEnd(524288, ' '));
    const db = new ScriptedD1([{ windowStart: 0 }], [fixtures.memory()]);
    const exact = await fixtures.send(fixtures.put(padded), db);
    assert.equal(exact.status, 201);
    const untouched = new ScriptedD1();
    for (const headers of [{ 'Content-Length': '1' }, {}]) {
        let cancelled = false;
        const body = new ReadableStream({
            /**
             * @param {ReadableStreamDefaultController<Uint8Array>} controller
             * @return {void}
             */
            start(controller) {
                controller.enqueue(padded);
                controller.enqueue(new Uint8Array([32]));
            },
            /**
             * @return {void}
             */
            cancel() {
                cancelled = true;
            },
        });
        const request = fixtures.request(fixtures.room(), {
            method: 'PUT', duplex: 'half', body, headers: { 'Content-Type': 'application/json', ...headers },
        });
        const response = await fixtures.send(request, untouched);
        assert.equal(response.status, 413);
        assert.equal(cancelled, true);
        assert.equal(request.body.locked, false);
    }
    assert.equal(untouched.calls.length, 0);
});

test('unicode_and_note_limits', async (context) => {
    CloudflareCrypto.install(context);
    for (const notes of ['a'.repeat(65536), '𐍈'.repeat(16384), '', ' \r\n\t e\u0301  \n']) {
        const db = new ScriptedD1([{ windowStart: 0 }], [fixtures.memory(fixtures.Alpha, notes)]);
        const response = await fixtures.send(fixtures.put(JSON.stringify({ notes, expectedRevision: 0 })), db);
        assert.equal(response.status, 201);
        assert.equal((await response.json()).notes, notes);
        assert.equal(db.calls[1].values[1], notes);
    }
    const untouched = new ScriptedD1();
    for (const notes of ['a'.repeat(65537), '𐍈'.repeat(16384) + 'a']) {
        const response = await fixtures.send(fixtures.put(JSON.stringify({ notes, expectedRevision: 0 })), untouched);
        assert.equal(response.status, 413);
    }
    const malformed = new TextEncoder().encode('{"notes":"x","expectedRevision":0}');
    malformed[10] = 0xff;
    for (const body of [malformed, '{"notes":"\\ud800","expectedRevision":0}', '{"notes":"\\udc00","expectedRevision":0}']) {
        const response = await fixtures.send(fixtures.put(body), untouched);
        assert.equal(response.status, 400);
    }
    assert.equal(untouched.calls.length, 0);
});

test('index_validation_and_projection', async (context) => {
    CloudflareCrypto.install(context);
    const db = new ScriptedD1([{ windowStart: 0 }], [fixtures.memory()]);
    const response = await fixtures.send(fixtures.request('/v1/memories'), db);
    assert.equal(response.status, 200);
    assert.deepEqual(db.calls[1], { sql: worker.Sql.ListFirst, values: [26] });
    assert.deepEqual(await response.json(), {
        items: [{ roomId: fixtures.Alpha, revision: 1, updatedAt: fixtures.Timestamp }], nextCursor: null,
    });
    const cursorDb = new ScriptedD1([{ windowStart: 0 }], [fixtures.memory(fixtures.Beta)]);
    const cursor = await fixtures.send(fixtures.request('/v1/memories?limit=50&after=' + encodeURIComponent(fixtures.Alpha)), cursorDb);
    assert.equal(cursor.status, 200);
    assert.deepEqual(cursorDb.calls[1], { sql: worker.Sql.ListAfter, values: [fixtures.Alpha, 51] });
    const lookaheadDb = new ScriptedD1([{ windowStart: 0 }], [fixtures.memory(), fixtures.memory(fixtures.Beta)]);
    const lookahead = await fixtures.send(fixtures.request('/v1/memories?limit=01'), lookaheadDb);
    assert.deepEqual(await lookahead.json(), {
        items: [{ roomId: fixtures.Alpha, revision: 1, updatedAt: fixtures.Timestamp }], nextCursor: fixtures.Alpha,
    });
    assert.deepEqual(lookaheadDb.calls[1].values, [2]);
    const untouched = new ScriptedD1();
    for (const query of ['limit=0', 'limit=51', 'limit=1.5', 'limit=1&%6cimit=2', 'limit=', 'limit=1%0A', 'limit=%2B1']) {
        const invalid = await fixtures.send(fixtures.request('/v1/memories?' + query), untouched);
        assert.equal(invalid.status, 400, query);
    }
    assert.equal(untouched.calls.length, 0);
});

test('error_headers_and_redaction', async (context) => {
    CloudflareCrypto.install(context);
    const logs = context.mock.method(console, 'error', () => {});
    const notes = 'Sensitive fictional notes';
    const raw = 'Raw database exception ' + notes + fixtures.Key;
    const db = new ScriptedD1([{ windowStart: 0 }], new Error(raw));
    const unavailable = await fixtures.send(fixtures.put(JSON.stringify({ notes, expectedRevision: 0 })), db);
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).error.code, 'database_unavailable');
    const unsuccessful = await fixtures.send(fixtures.request(fixtures.room()), new ScriptedD1({ success: false, results: [] }));
    assert.equal(unsuccessful.status, 503);
    const failure = await fixtures.send({
        method: 'GET',
        headers: {
            /**
             * @return {never}
             * @throws {Error}
             */
            get() {
                throw new Error(raw);
            },
        },
    }, db);
    assert.equal(failure.status, 500);
    assert.equal((await failure.json()).error.code, 'internal_error');
    const missing = await fixtures.send(fixtures.request(fixtures.room()), new ScriptedD1([{ windowStart: 0 }], []));
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'memory_not_found');
    const success = await fixtures.send(fixtures.request(fixtures.room()), new ScriptedD1([{ windowStart: 0 }], [fixtures.memory()]));
    assert.equal(success.status, 200);
    for (const response of [unavailable, unsuccessful, failure, missing, success]) {
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
        assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
    }
    assert.deepEqual(logs.mock.calls.map(({ arguments: args }) => args[1]), ['database_unavailable', 'database_unavailable', 'internal_error']);
    for (const { arguments: args } of logs.mock.calls) {
        assert.equal(args.length, 2);
        assert.match(args[0], /^[\da-f-]{36}$/i);
        assert.equal(args.join(' ').includes(fixtures.Key), false);
        assert.equal(args.join(' ').includes(notes), false);
        assert.equal(args.join(' ').includes(raw), false);
    }
});

test('rate_and_conflict_mapping', async (context) => {
    CloudflareCrypto.install(context);
    const logs = context.mock.method(console, 'error', () => {});
    const nowMs = Date.parse(fixtures.Timestamp) + 1251;
    context.mock.method(Date, 'now', () => nowMs);
    const windowStart = Math.floor(nowMs / 60000) * 60;
    const db = new ScriptedD1([], [{ windowStart }]);
    const response = await fixtures.send(fixtures.request(fixtures.room()), db);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '59');
    assert.equal((await response.json()).error.code, 'rate_limited');
    assert.deepEqual(db.calls, [
        { sql: worker.Sql.ClaimRateSlot, values: [windowStart, 180] },
        { sql: worker.Sql.ReadRateWindow, values: [] },
    ]);
    const missingDb = new ScriptedD1([], []);
    const missing = await fixtures.send(fixtures.request(fixtures.room()), missingDb);
    assert.equal(missing.status, 503);
    assert.equal(missingDb.calls.length, 2);
    assert.equal(logs.mock.callCount(), 1);
    const conflictDb = new ScriptedD1([{ windowStart }], []);
    const conflict = await fixtures.send(fixtures.put('{"notes":"new","expectedRevision":2}'), conflictDb);
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.code, 'revision_conflict');
    assert.deepEqual(conflictDb.calls.map(({ sql }) => sql), [worker.Sql.ClaimRateSlot, worker.Sql.UpdateMemory]);
    assert.deepEqual(conflictDb.calls[1].values, [fixtures.Alpha, 2, 'new', new Date(nowMs).toISOString()]);
    assert.equal(logs.mock.callCount(), 1);
});
