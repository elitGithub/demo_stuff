import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

const scribe = Object.freeze({
    Room: '/rooms/alpha',
    Other: '/rooms/beta',
    BrowserA: 'Fictional-Browser-A-0001',
    BrowserB: 'Fictional-Browser-B-0002',
    AskA: 'Fictional-Ask-000000000001',
    AskB: 'Fictional-Ask-000000000002',
    Day: '2026-11-18',
    Now: Date.parse('2026-11-18T10:00:00.000Z') + 1251,
    TextType: 'text/plain; charset=utf-8',
    JsonType: 'application/json; charset=utf-8',
    Allow: Object.freeze({
        '/v1/scribe': 'GET',
        '/v1/scribe/part': 'GET, PUT',
        '/v1/scribe/commit': 'POST',
        '/v1/scribe/spend': 'POST',
        '/v1/scribe/lease': 'POST, DELETE',
        '/v1/scribe/ask': 'POST',
    }),

    /**
     * @return {number}
     */
    windowStart() {
        return Math.floor(scribe.Now / 60000) * 60;
    },

    /**
     * @param {ReadonlyArray<[string, string]>} pairs
     * @return {string}
     */
    encode(pairs) {
        return pairs.map(([name, value]) => name + '=' + encodeURIComponent(value)).join('&');
    },

    /**
     * @param {string} route
     * @param {ReadonlyArray<[string, string]>} pairs
     * @return {string}
     */
    path(route, pairs) {
        return route + '?' + scribe.encode(pairs);
    },

    /**
     * @param {string} [browser]
     * @return {string}
     */
    headsPath(browser = scribe.BrowserA) {
        return scribe.path('/v1/scribe', [['roomId', scribe.Room], ['browser', browser], ['day', scribe.Day]]);
    },

    /**
     * @param {string | null} browser
     * @param {string} [kind]
     * @param {string} [revision]
     * @param {string} [part]
     * @return {string}
     */
    partPath(browser, kind = 'book', revision = '1', part = '0') {
        const pairs = [['roomId', scribe.Room], ['kind', kind], ['revision', revision], ['part', part]];
        return scribe.path('/v1/scribe/part', browser === null ? pairs : [...pairs, ['browser', browser]]);
    },

    /**
     * @param {string} route
     * @return {string}
     */
    roomPath(route) {
        return scribe.path(route, [['roomId', scribe.Room]]);
    },

    /**
     * @param {string} [browser]
     * @return {string}
     */
    releasePath(browser = scribe.BrowserA) {
        return scribe.path('/v1/scribe/lease', [['roomId', scribe.Room], ['browser', browser]]);
    },

    /**
     * @param {string} route
     * @param {object | string} payload
     * @param {string} [contentType]
     * @return {Request}
     */
    post(route, payload, contentType = 'application/json') {
        const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
        const headers = { 'Content-Type': contentType };
        return fixtures.request(scribe.roomPath(route), { method: 'POST', body, headers });
    },

    /**
     * @param {BodyInit} body
     * @param {string | null} [contentType]
     * @param {string} [path]
     * @return {Request}
     */
    stage(body, contentType = scribe.TextType, path = scribe.partPath(scribe.BrowserA)) {
        const headers = contentType === null ? {} : { 'Content-Type': contentType };
        return fixtures.request(path, { method: 'PUT', body, headers });
    },

    /**
     * @param {string} browser
     * @param {number} expiresAt
     * @param {string | null} [wanted]
     * @param {number | null} [wantedUntil]
     * @param {number} [asked]
     * @return {object}
     */
    leaseRow(browser, expiresAt, wanted = null, wantedUntil = null, asked = 0) {
        return { browser, expiresAt, wanted, wantedUntil, asked };
    },

    /**
     * @param {string | Uint8Array} text
     * @return {string}
     */
    digest(text) {
        return createHash('sha256').update(text).digest('hex');
    },

    /**
     * @param {number} count
     * @return {string[]}
     */
    digests(count) {
        return Array.from({ length: count }, (_, index) => scribe.digest('Fictional part ' + index));
    },

    /**
     * @param {string} kind
     * @param {number} expectedRevision
     * @param {number} parts
     * @return {object}
     */
    change(kind, expectedRevision, parts) {
        return { kind, expectedRevision, revision: expectedRevision + 1, digests: scribe.digests(parts) };
    },

    /**
     * @param {Response} response
     * @return {Promise<string>}
     */
    async codeOf(response) {
        return (await response.json()).error.code;
    },

    /**
     * @param {Response} response
     * @return {Promise<{ code: string, message: string }>}
     */
    async errorOf(response) {
        return (await response.json()).error;
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
        assert.equal((await response.json()).error.message, 'Use application/json with UTF-8 encoding.');
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
    assert.deepEqual((await unavailable.json()).error, {
        code: 'database_unavailable', message: 'Notes storage is temporarily unavailable.',
    });
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
    assert.equal((await missing.json()).error.message, 'Notes storage is temporarily unavailable.');
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

test('scribe_routes_reach_their_handlers', async (context) => {
    CloudflareCrypto.install(context);
    const { BrowserA, BrowserB, Now: now } = scribe;
    context.mock.method(Date, 'now', () => now);
    const windowStart = scribe.windowStart();
    const head = { kind: 'book', revision: 1, parts: 1, updatedAt: fixtures.Timestamp };
    const spent = { daySum: 0, mine: 0 };
    const routes = [
        [fixtures.request(scribe.headsPath()), [[], [spent], [], []], 200, 'ReadScribeHeads'],
        [fixtures.request(scribe.partPath(null)), [[{ text: 'Fictional part' }]], 200, 'ReadScribePart'],
        [
            scribe.stage('Fictional part'), [[{ part: 0, digest: scribe.digest('Fictional part') }]], 200,
            'StageScribePart',
        ],
        [
            scribe.post('/v1/scribe/commit', { browser: BrowserA, kinds: [scribe.change('book', 0, 1)], done: [] }),
            [[head], []], 200, 'CommitScribe',
        ],
        [
            scribe.post('/v1/scribe/spend', { browser: BrowserA, day: scribe.Day, total: 0 }),
            [[], [spent]], 200, 'StoreScribeSpent',
        ],
        [
            scribe.post('/v1/scribe/lease', { browser: BrowserA, want: 'None' }),
            [[scribe.leaseRow(BrowserA, now + 90000)], []], 200, 'TakeScribeLease',
        ],
        [
            fixtures.request(scribe.releasePath(), { method: 'DELETE' }),
            [[scribe.leaseRow(BrowserB, now + 90000)]], 200, 'PassScribeLease',
        ],
        [
            scribe.post('/v1/scribe/ask', { browser: BrowserB, id: scribe.AskA, action: {} }),
            [[{ id: scribe.AskA }]], 201, 'AddScribeAsk',
        ],
    ];
    for (const [request, outcomes, status, statement] of routes) {
        const label = request.method + ' ' + new URL(request.url).pathname;
        const db = new ScriptedD1([{ windowStart }], ...outcomes);
        const response = await fixtures.send(request, db);
        assert.equal(response.status, status, label);
        assert.deepEqual(db.calls[0], { sql: worker.Sql.ClaimScribeSlot, values: [windowStart, 600] }, label);
        assert.equal(db.calls[1].sql, worker.Sql[statement], label);
        assert.equal(db.calls.length, outcomes.length + 1, label);
        const type = statement === 'ReadScribePart' ? scribe.TextType : scribe.JsonType;
        assert.equal(response.headers.get('Content-Type'), type, label);
        assert.equal(response.headers.get('Cache-Control'), 'no-store', label);
        assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff', label);
        assert.equal([...response.headers.keys()].some((name) => name.startsWith('access-control-allow-')), false);
    }
});

test('scribe_methods_and_unknown_paths', async (context) => {
    CloudflareCrypto.install(context);
    const untouched = new ScriptedD1();
    const methods = [
        'GET', 'PUT', 'POST', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD', 'constructor', '__proto__', 'toString',
    ];
    const responses = [];
    for (const [route, allow] of Object.entries(scribe.Allow)) {
        for (const method of methods.filter((method) => !allow.split(', ').includes(method))) {
            const response = await fixtures.send(fixtures.request(scribe.roomPath(route), { method }), untouched);
            responses.push(response);
            assert.equal(response.status, 405, route + ' ' + method);
            assert.equal(response.headers.get('Allow'), allow, route + ' ' + method);
            if (method === 'HEAD') {
                assert.equal(response.body, null);
            } else {
                assert.equal(await scribe.codeOf(response), 'method_not_allowed');
            }
        }
    }
    const unknown = [
        '/v1/scribe/', '/v1/scribe/other', '/v1/scribes', '/v1/scribe/part/', '/v1/Scribe', '/v1/scribe/%70art',
        '/v1/scribe/constructor', '/v1/scribe/__proto__',
    ];
    for (const path of unknown) {
        for (const method of ['GET', 'POST', 'DELETE']) {
            const request = fixtures.request(path + '?roomId=%2Frooms%2Falpha', { method });
            const response = await fixtures.send(request, untouched);
            responses.push(response);
            assert.equal(response.status, 404, path + ' ' + method);
            assert.equal(await scribe.codeOf(response), 'not_found');
        }
    }
    for (const response of responses) {
        assert.equal([...response.headers.keys()].some((name) => name.startsWith('access-control-allow-')), false);
    }
    assert.equal(untouched.calls.length, 0);
});

test('scribe_queries_are_exact', async (context) => {
    CloudflareCrypto.install(context);
    const untouched = new ScriptedD1();
    const { BrowserA } = scribe;
    const room = ['roomId', scribe.Room];
    const target = [['kind', 'book'], ['revision', '1'], ['part', '0']];
    const json = 'application/json';
    const commands = [
        ['GET', '/v1/scribe', [room, ['browser', BrowserA], ['day', scribe.Day]], null],
        ['GET', '/v1/scribe/part', [room, ...target], null],
        ['PUT', '/v1/scribe/part', [room, ...target, ['browser', BrowserA]], ['Fictional part', scribe.TextType]],
        [
            'POST', '/v1/scribe/commit', [room],
            [JSON.stringify({ browser: BrowserA, kinds: [scribe.change('book', 0, 1)], done: [] }), json],
        ],
        ['POST', '/v1/scribe/spend', [room], [JSON.stringify({ browser: BrowserA, day: scribe.Day, total: 0 }), json]],
        ['POST', '/v1/scribe/lease', [room], [JSON.stringify({ browser: BrowserA, want: 'None' }), json]],
        ['DELETE', '/v1/scribe/lease', [room, ['browser', BrowserA]], null],
        ['POST', '/v1/scribe/ask', [room], [JSON.stringify({ browser: BrowserA, id: scribe.AskA, action: {} }), json]],
    ];
    const replacements = {
        roomId: ['', 'rooms/alpha', '/space here', '/' + 'a'.repeat(512)],
        kind: ['campaign', 'Book', '', 'book ', 'constructor'],
        revision: ['0', '01', '-1', '1.0', '9007199254740992', '+1', '1e0', ' 1', ''],
        part: ['10', '-1', '1e1', '01', '0x1', ''],
        browser: ['a'.repeat(15), 'a'.repeat(65), 'Fictional_Browser_A_0001', 'Fictional-Browser-A-000é', ''],
        day: [
            '2026-1-18', '2026-11-18T', '18-11-2026', '2026-11-18\n', '', '2026-02-29', '2026-02-30', '2026-04-31',
            '2026-99-99', '0000-00-00', '2026-13-01', '2026-00-10',
        ],
    };
    let refused = 0;
    for (const [method, route, pairs, body] of commands) {
        const full = scribe.encode(pairs);
        const queries = [
            '',
            full + '&',
            full + '&extra=1',
            full + '&%72oomId=' + encodeURIComponent(scribe.Other),
            full + '&roomId=' + encodeURIComponent(scribe.Room),
            full.replace(/^roomId=[^&]*/, 'roomId=%'),
            full.replace(/^roomId=[^&]*/, 'roomId'),
            ...pairs.map((_, index) => scribe.encode(pairs.filter((__, other) => other !== index))),
            ...pairs.flatMap(([name], index) => replacements[name].map((value) =>
                scribe.encode(pairs.map((pair, other) => other === index ? [name, value] : pair))
            )),
        ];
        for (const query of queries) {
            const options = body === null
                ? { method }
                : { method, body: body[0], headers: { 'Content-Type': body[1] } };
            const request = fixtures.request(route + (query ? '?' + query : ''), options);
            const response = await fixtures.send(request, untouched);
            assert.equal(response.status, 400, method + ' ' + route + '?' + query.slice(0, 120));
            assert.equal(await scribe.codeOf(response), 'bad_request');
            refused++;
        }
    }
    assert.equal(refused, 173);
    for (const path of [scribe.headsPath(), scribe.partPath(null)]) {
        const getWithBody = {
            url: fixtures.Origin + path,
            method: 'GET',
            headers: fixtures.request(path).headers,
            body: new ReadableStream(),
        };
        assert.equal((await fixtures.send(getWithBody, untouched)).status, 400);
    }
    const deleteWithBody = fixtures.request(scribe.releasePath(), { method: 'DELETE', body: '{}' });
    assert.notEqual(deleteWithBody.body, null);
    assert.equal((await fixtures.send(deleteWithBody, untouched)).status, 400);
    assert.equal(untouched.calls.length, 0);
});

test('scribe_counters_are_separate', async (context) => {
    CloudflareCrypto.install(context);
    const logs = context.mock.method(console, 'error', () => {});
    context.mock.method(Date, 'now', () => scribe.Now);
    const windowStart = scribe.windowStart();
    const notes = new ScriptedD1([{ windowStart }], [fixtures.memory()]);
    assert.equal((await fixtures.send(fixtures.request(fixtures.room()), notes)).status, 200);
    assert.deepEqual(notes.calls[0], { sql: worker.Sql.ClaimRateSlot, values: [windowStart, 180] });
    const index = new ScriptedD1([{ windowStart }], []);
    assert.equal((await fixtures.send(fixtures.request('/v1/memories'), index)).status, 200);
    assert.deepEqual(index.calls[0], { sql: worker.Sql.ClaimRateSlot, values: [windowStart, 180] });
    const heads = new ScriptedD1([{ windowStart }], [], [{ daySum: 0, mine: 0 }], [], []);
    assert.equal((await fixtures.send(fixtures.request(scribe.headsPath()), heads)).status, 200);
    assert.deepEqual(heads.calls[0], { sql: worker.Sql.ClaimScribeSlot, values: [windowStart, 600] });

    const full = new ScriptedD1([], [{ windowStart }]);
    const denied = await fixtures.send(fixtures.request(scribe.headsPath()), full);
    assert.equal(denied.status, 429);
    assert.equal(denied.headers.get('Retry-After'), '59');
    assert.equal(await scribe.codeOf(denied), 'rate_limited');
    assert.deepEqual(full.calls, [
        { sql: worker.Sql.ClaimScribeSlot, values: [windowStart, 600] },
        { sql: worker.Sql.ReadScribeWindow, values: [] },
    ]);
    const missing = new ScriptedD1([], []);
    const unavailable = await fixtures.send(fixtures.request(scribe.headsPath()), missing);
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await scribe.errorOf(unavailable), {
        code: 'database_unavailable', message: 'Scribe storage is temporarily unavailable.',
    });
    assert.deepEqual(missing.calls.map(({ sql }) => sql), [worker.Sql.ClaimScribeSlot, worker.Sql.ReadScribeWindow]);
    assert.equal(logs.mock.callCount(), 1);
});

test('scribe_heads_answer', async (context) => {
    CloudflareCrypto.install(context);
    const { BrowserA, BrowserB, Room, Now: now } = scribe;
    context.mock.method(Date, 'now', () => now);
    const windowStart = scribe.windowStart();
    const headRows = [
        { kind: 'book', revision: 3, parts: 2, updatedAt: fixtures.Timestamp, room_id: Room },
        { kind: 'settings', revision: 1, parts: 1, updatedAt: fixtures.Timestamp },
    ];
    const askRows = [{ id: scribe.AskA, browser: BrowserB, action: '{"type":"Dismiss"}', createdAt: now - 5 }];
    const lease = scribe.leaseRow(BrowserA, now + 1000, BrowserB, now + 1000, 1);
    const db = new ScriptedD1([{ windowStart }], headRows, [{ daySum: 0.75, mine: 0.25 }], [lease], askRows);
    const response = await fixtures.send(fixtures.request(scribe.headsPath()), db);
    assert.equal(response.status, 200);
    assert.deepEqual(db.calls.slice(1), [
        { sql: worker.Sql.ReadScribeHeads, values: [Room] },
        { sql: worker.Sql.ReadScribeSpent, values: [Room, scribe.Day, BrowserA] },
        { sql: worker.Sql.ReadScribeLease, values: [Room] },
        { sql: worker.Sql.ReadScribeAsks, values: [Room, 20] },
    ]);
    assert.deepEqual(await response.json(), {
        roomId: Room,
        heads: [
            { kind: 'book', revision: 3, parts: 2, updatedAt: fixtures.Timestamp },
            { kind: 'settings', revision: 1, parts: 1, updatedAt: fixtures.Timestamp },
        ],
        spent: { day: scribe.Day, sum: 0.75, mine: 0.25 },
        lease: { browser: BrowserA, expiresAt: now + 1000, wanted: BrowserB, asked: true },
        asks: [{ id: scribe.AskA, browser: BrowserB, action: '{"type":"Dismiss"}', createdAt: now - 5 }],
        now,
    });

    const views = [
        [[], null],
        [[scribe.leaseRow(BrowserA, now)], null],
        [[scribe.leaseRow(BrowserA, now - 1, BrowserB, now + 1000, 1)], null],
        [
            [scribe.leaseRow(BrowserA, now + 1, BrowserB, now, 1)],
            { browser: BrowserA, expiresAt: now + 1, wanted: null, asked: false },
        ],
        [
            [scribe.leaseRow(BrowserA, now + 1, BrowserB, now + 1, 0)],
            { browser: BrowserA, expiresAt: now + 1, wanted: BrowserB, asked: false },
        ],
        [
            [scribe.leaseRow(BrowserA, now + 1, null, null, 1)],
            { browser: BrowserA, expiresAt: now + 1, wanted: null, asked: false },
        ],
    ];
    for (const [rows, view] of views) {
        const viewDb = new ScriptedD1([{ windowStart }], [], [{ daySum: 0, mine: 0 }], rows, []);
        const answer = await (await fixtures.send(fixtures.request(scribe.headsPath()), viewDb)).json();
        assert.deepEqual(answer.lease, view, JSON.stringify(rows));
        assert.deepEqual(answer.heads, []);
        assert.deepEqual(answer.asks, []);
        assert.deepEqual(answer.spent, { day: scribe.Day, sum: 0, mine: 0 });
    }
});

test('scribe_part_bodies_and_limits', async (context) => {
    CloudflareCrypto.install(context);
    const { BrowserA, Room, Now: now } = scribe;
    context.mock.method(Date, 'now', () => now);
    const windowStart = scribe.windowStart();
    /**
     * @param {Request} request
     * @return {Promise<{ response: Response, db: ScriptedD1 }>}
     */
    const accepted = async (request) => {
        const db = new ScriptedD1([{ windowStart }], [{ part: 0, digest: scribe.digest('Fictional part') }]);
        const response = await fixtures.send(request, db);
        return { response, db };
    };

    const { response: staged, db: stagedDb } = await accepted(scribe.stage('Fictional part'));
    assert.equal(staged.status, 200);
    const digest = scribe.digest('Fictional part');
    assert.deepEqual(await staged.json(), { kind: 'book', revision: 1, part: 0, digest });
    assert.deepEqual(stagedDb.calls[1], {
        sql: worker.Sql.StageScribePart, values: [Room, 'book', 1, 0, 'Fictional part', digest, BrowserA, now],
    });
    const edges = scribe.partPath('Z'.repeat(64), 'live', '9007199254740991', '9');
    const { response: edge, db: edgeDb } = await accepted(scribe.stage('x', scribe.TextType, edges));
    assert.equal(edge.status, 200);
    assert.deepEqual(edgeDb.calls[1].values, [
        Room, 'live', Number.MAX_SAFE_INTEGER, 9, 'x', scribe.digest('x'), 'Z'.repeat(64), now,
    ]);
    const { db: vectorDb } = await accepted(scribe.stage('abc'));
    assert.equal(vectorDb.calls[1].values[5], 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const shortest = scribe.partPath('0'.repeat(16), 'settings', '1', '0');
    assert.equal((await accepted(scribe.stage('x', scribe.TextType, shortest))).response.status, 200);
    for (const contentType of ['Text/Plain;Charset="UTF-8"', 'text/plain \t; \tcharset \t= \tutf-8']) {
        assert.equal((await accepted(scribe.stage('x', contentType))).response.status, 200, contentType);
    }

    const untouched = new ScriptedD1();
    for (const contentType of [
        'application/json', 'text/plain', 'text/plain; charset=latin1', 'text/plain; charset=utf-8; charset=utf-8',
        'text/plain; charset=utf-8, text/plain; charset=utf-8', 'text/html; charset=utf-8',
    ]) {
        const response = await fixtures.send(scribe.stage('x', contentType), untouched);
        assert.equal(response.status, 415, contentType);
        assert.deepEqual(await scribe.errorOf(response), {
            code: 'unsupported_media_type', message: 'Use text/plain with UTF-8 encoding.',
        });
    }
    const untyped = scribe.stage(new TextEncoder().encode('x'), null);
    assert.equal(untyped.headers.get('Content-Type'), null);
    assert.equal((await fixtures.send(untyped, untouched)).status, 415);

    const fits = [
        'a'.repeat(400000),
        '𐍈'.repeat(199999) + 'ab',
        '€'.repeat(400000),
        ' \r\n\t é "quoted" {"json":true}',
    ];
    for (const text of fits) {
        const { response, db } = await accepted(scribe.stage(text));
        assert.equal(response.status, 200, text.slice(0, 16));
        assert.equal(db.calls[1].values[4], text);
        assert.equal(db.calls[1].values[5], scribe.digest(text));
    }
    assert.equal(new TextEncoder().encode(fits[2]).length, 1200000);
    assert.equal(fits[1].length, 400000);
    const bomBytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61]);
    const withBom = await accepted(scribe.stage(bomBytes));
    assert.equal(withBom.response.status, 200);
    assert.equal(withBom.db.calls[1].values[4], '﻿a');
    assert.equal(withBom.db.calls[1].values[5], scribe.digest(bomBytes));
    assert.notEqual(scribe.digest(bomBytes), scribe.digest('a'));

    for (const text of ['a'.repeat(400001), '𐍈'.repeat(199999) + 'abc', 'a'.repeat(1200000)]) {
        const response = await fixtures.send(scribe.stage(text), untouched);
        assert.equal(response.status, 413, String(text.length));
        assert.equal(await scribe.codeOf(response), 'payload_too_large');
    }
    let cancelled = false;
    const stream = new ReadableStream({
        /**
         * @param {ReadableStreamDefaultController<Uint8Array>} controller
         * @return {void}
         */
        start(controller) {
            controller.enqueue(new Uint8Array(1200000).fill(0x61));
            controller.enqueue(new Uint8Array([0x61]));
        },
        /**
         * @return {void}
         */
        cancel() {
            cancelled = true;
        },
    });
    const streamed = fixtures.request(scribe.partPath(BrowserA), {
        method: 'PUT',
        duplex: 'half',
        body: stream,
        headers: { 'Content-Type': scribe.TextType, 'Content-Length': '1' },
    });
    const overflow = await fixtures.send(streamed, untouched);
    assert.equal(overflow.status, 413);
    assert.equal(cancelled, true);
    assert.equal(streamed.body.locked, false);

    for (const bytes of [[0xff], [0xed, 0xa0, 0x80], [0x61, 0xc3], [0xc0, 0xaf], [], [0xc0, 0x80]]) {
        const response = await fixtures.send(scribe.stage(new Uint8Array(bytes)), untouched);
        assert.equal(response.status, 400, JSON.stringify(bytes));
        assert.equal(await scribe.codeOf(response), 'bad_request');
    }
    for (const text of ['\u0000abc', 'a\u0000b', 'abc\u0000', '\u0000', '﻿\u0000', 'a'.repeat(399999) + '\u0000']) {
        const response = await fixtures.send(scribe.stage(text), untouched);
        assert.equal(response.status, 400, JSON.stringify(text.slice(-4)));
        assert.deepEqual(await scribe.errorOf(response), {
            code: 'bad_request', message: worker.Errors.BadRequest.message,
        });
    }
    const bodiless = fixtures.request(scribe.partPath(BrowserA), {
        method: 'PUT', headers: { 'Content-Type': scribe.TextType },
    });
    assert.equal(bodiless.body, null);
    assert.equal((await fixtures.send(bodiless, untouched)).status, 400);
    assert.equal(untouched.calls.length, 0);
});

test('scribe_part_reads_raw_text', async (context) => {
    CloudflareCrypto.install(context);
    const { Room } = scribe;
    context.mock.method(Date, 'now', () => scribe.Now);
    const windowStart = scribe.windowStart();
    const text = '{"subjects":[{"name":"Mara é 𐍈"}]}\n';
    const db = new ScriptedD1([{ windowStart }], [{ text }]);
    const response = await fixtures.send(fixtures.request(scribe.partPath(null, 'settings', '12', '3')), db);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'text/plain; charset=utf-8');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new TextEncoder().encode(text));
    assert.deepEqual(db.calls[1], { sql: worker.Sql.ReadScribePart, values: [Room, 'settings', 12, 3] });

    const missing = await fixtures.send(fixtures.request(scribe.partPath(null)), new ScriptedD1([{ windowStart }], []));
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('Content-Type'), scribe.JsonType);
    assert.deepEqual(await missing.json(), {
        error: { code: 'part_not_found', message: worker.Errors.PartNotFound.message },
    });
});

test('scribe_refusal_reasons', async (context) => {
    CloudflareCrypto.install(context);
    const { BrowserA, BrowserB, Now: now } = scribe;
    context.mock.method(Date, 'now', () => now);
    const windowStart = scribe.windowStart();
    const sql = worker.Sql;
    const ours = scribe.leaseRow(BrowserA, now + 1000);
    /**
     * @param {string} kind
     * @param {number} revision
     * @return {object}
     */
    const head = (kind, revision) => ({ kind, revision, parts: 1, updatedAt: fixtures.Timestamp });
    const stages = [
        [[[scribe.leaseRow(BrowserB, now + 1000)]], 'lease_lost', [sql.ReadScribeLease]],
        [[[scribe.leaseRow(BrowserA, now)]], 'lease_lost', [sql.ReadScribeLease]],
        [[[]], 'lease_lost', [sql.ReadScribeLease]],
        [[[ours], [head('book', 1)]], 'revision_conflict', [sql.ReadScribeLease, sql.ReadScribeHeads]],
        [[[ours], [head('book', 3)]], 'revision_conflict', [sql.ReadScribeLease, sql.ReadScribeHeads]],
        [[[ours], [head('live', 4)]], 'parts_missing', [sql.ReadScribeLease, sql.ReadScribeHeads]],
    ];
    for (const [outcomes, code, reads] of stages) {
        const db = new ScriptedD1([{ windowStart }], [], ...outcomes);
        const response = await fixtures.send(scribe.stage('Fictional part'), db);
        assert.equal(response.status, 409, code);
        assert.equal(await scribe.codeOf(response), code);
        assert.deepEqual(db.calls.map((call) => call.sql), [sql.ClaimScribeSlot, sql.StageScribePart, ...reads]);
    }

    const body = {
        browser: BrowserA,
        kinds: [scribe.change('book', 1, 1), scribe.change('live', 1, 1)],
        done: [scribe.AskA],
    };
    const commits = [
        [[[scribe.leaseRow(BrowserB, now + 1000)]], 'lease_lost', [sql.ReadScribeLease]],
        [[[scribe.leaseRow(BrowserA, now - 1)]], 'lease_lost', [sql.ReadScribeLease]],
        [[[ours], [head('book', 1)]], 'revision_conflict', [sql.ReadScribeLease, sql.ReadScribeHeads]],
        [[[ours], [head('book', 2), head('live', 1)]], 'revision_conflict', [sql.ReadScribeLease, sql.ReadScribeHeads]],
        [[[ours], [head('book', 1), head('live', 1)]], 'parts_missing', [sql.ReadScribeLease, sql.ReadScribeHeads]],
    ];
    for (const [outcomes, code, reads] of commits) {
        const db = new ScriptedD1([{ windowStart }], [], ...outcomes);
        const response = await fixtures.send(scribe.post('/v1/scribe/commit', body), db);
        assert.equal(response.status, 409, code);
        const answer = await response.json();
        assert.equal(answer.error.code, code);
        assert.equal(Object.values(worker.Errors).some(({ message }) => message === answer.error.message), true);
        assert.deepEqual(db.calls.map((call) => call.sql), [sql.ClaimScribeSlot, sql.CommitScribe, ...reads]);
    }
    assert.equal(worker.Errors.ScribeConflict.code, worker.Errors.RevisionConflict.code);
    assert.notEqual(worker.Errors.ScribeConflict.message, worker.Errors.RevisionConflict.message);
});

test('scribe_commit_shape', async (context) => {
    CloudflareCrypto.install(context);
    const { BrowserA, Room, Now: now } = scribe;
    context.mock.method(Date, 'now', () => now);
    const windowStart = scribe.windowStart();
    const updatedAt = new Date(now).toISOString();
    const returned = [
        { kind: 'settings', revision: 1, parts: 1, updatedAt },
        { kind: 'book', revision: 5, parts: 2, updatedAt },
    ];
    const db = new ScriptedD1([{ windowStart }], returned, [], []);
    const kinds = [scribe.change('settings', 0, 1), scribe.change('book', 4, 2)];
    const response = await fixtures.send(scribe.post('/v1/scribe/commit', {
        browser: BrowserA, kinds, done: [scribe.AskA, scribe.AskB],
    }), db);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { heads: returned });
    const [first, second] = scribe.digests(2);
    const bound = '[{"kind":"settings","expectedRevision":0,"revision":1,"digests":["' + first + '"]},'
        + '{"kind":"book","expectedRevision":4,"revision":5,"digests":["' + first + '","' + second + '"]}]';
    assert.deepEqual(db.calls.slice(1), [
        { sql: worker.Sql.CommitScribe, values: [Room, bound, BrowserA, updatedAt, now] },
        { sql: worker.Sql.SweepScribeParts, values: [Room] },
        { sql: worker.Sql.DropScribeAsks, values: [Room, '["' + scribe.AskA + '","' + scribe.AskB + '"]'] },
    ]);

    /**
     * @param {number} count
     * @return {string}
     */
    const listed = (count) => JSON.stringify(scribe.digests(count));
    const literals = [
        ['{"kind":"book","expectedRevision":1.0,"revision":2,"digests":' + listed(1) + '}', 1, 2, 1],
        ['{"digests":' + listed(2) + ',"revision":5.000,"kind":"live","expectedRevision":40e-1}', 4, 5, 2],
        ['{"kind":"book","expectedRevision":0,"revision":1e0,"digests":' + listed(10) + '}', 0, 1, 10],
        ['{"kind":"book","expectedRevision":9007199254740990,"revision":9007199254740991,"digests":' + listed(1)
            + '}', 9007199254740990, Number.MAX_SAFE_INTEGER, 1],
    ];
    for (const [change, expectedRevision, revision, parts] of literals) {
        const single = new ScriptedD1([{ windowStart }], [{ kind: 'book', revision, parts, updatedAt }], []);
        const raw = '{"done":[],"kinds":[' + change + '],"browser":"' + BrowserA + '"}';
        const plain = await fixtures.send(scribe.post('/v1/scribe/commit', raw), single);
        assert.equal(plain.status, 200, change);
        assert.deepEqual(single.calls.map((call) => call.sql), [
            worker.Sql.ClaimScribeSlot, worker.Sql.CommitScribe, worker.Sql.SweepScribeParts,
        ]);
        assert.deepEqual(JSON.parse(single.calls[1].values[1]), [{
            kind: JSON.parse(change).kind, expectedRevision, revision, digests: scribe.digests(parts),
        }]);
    }
    const twice = { kind: 'book', expectedRevision: 0, revision: 1, digests: [first, first] };
    const repeated = new ScriptedD1([{ windowStart }], [{ kind: 'book', revision: 1, parts: 2, updatedAt }], []);
    const sameText = await fixtures.send(scribe.post('/v1/scribe/commit', {
        browser: BrowserA, kinds: [twice], done: [],
    }), repeated);
    assert.equal(sameText.status, 200);
    assert.deepEqual(JSON.parse(repeated.calls[1].values[1]), [twice]);

    const valid = { browser: BrowserA, kinds: [scribe.change('book', 0, 1)], done: [] };
    const twentyOne = Array.from({ length: 21 }, (_, index) => 'Fictional-Ask-' + String(index).padStart(12, '0'));
    /**
     * @param {unknown} digests
     * @return {object}
     */
    const naming = (digests) => ({ ...valid, kinds: [{ kind: 'book', expectedRevision: 0, revision: 1, digests }] });
    const shaped = [
        { ...valid, kinds: [] },
        {
            ...valid, kinds: [
                scribe.change('settings', 0, 1), scribe.change('book', 0, 1), scribe.change('live', 0, 1),
                scribe.change('book', 1, 1),
            ],
        },
        { ...valid, kinds: [scribe.change('book', 0, 1), scribe.change('book', 1, 1)] },
        { ...valid, kinds: [scribe.change('campaign', 0, 1)] },
        { ...valid, kinds: [scribe.change('Book', 0, 1)] },
        { ...valid, kinds: [{ kind: 'book', expectedRevision: 0, revision: 2, digests: [first] }] },
        { ...valid, kinds: [{ kind: 'book', expectedRevision: 1, revision: 1, digests: [first] }] },
        { ...valid, kinds: [scribe.change('book', 0, 0)] },
        { ...valid, kinds: [scribe.change('book', 0, 11)] },
        { ...valid, kinds: [{ ...scribe.change('book', 0, 1), extra: 1 }] },
        { ...valid, kinds: [{ ...scribe.change('book', 0, 1), parts: 1 }] },
        { ...valid, kinds: [{ kind: 'book', expectedRevision: 0, revision: 1, parts: 1 }] },
        { ...valid, kinds: [{ kind: 'book', revision: 1, digests: [first] }] },
        { ...valid, kinds: [{ kind: 'book', expectedRevision: '0', revision: 1, digests: [first] }] },
        naming(true),
        naming(first),
        naming(1),
        naming(null),
        naming({ 0: first }),
        naming([first.toUpperCase()]),
        naming([first.slice(1)]),
        naming([first + '0']),
        naming(['g' + first.slice(1)]),
        naming([' ' + first.slice(1)]),
        naming([first.slice(1) + '\n']),
        naming([first, null]),
        naming([first, 1]),
        naming([[first]]),
        { ...valid, kinds: 'book' },
        { ...valid, kinds: [null] },
        { ...valid, kinds: [[]] },
        { ...valid, kinds: [scribe.change('book', 0, 1)], extra: 1 },
        { kinds: valid.kinds, done: [] },
        { ...valid, browser: 'short' },
        { ...valid, browser: 42 },
        { ...valid, done: twentyOne },
        { ...valid, done: [scribe.AskA, scribe.AskA] },
        { ...valid, done: ['bad id with spaces'] },
        { ...valid, done: [1] },
        { ...valid, done: null },
        { ...valid, done: {} },
    ].map((payload) => JSON.stringify(payload));
    const prefix = '{"browser":"' + BrowserA + '","done":[],"kinds":[{"kind":"book",';
    const one = '"digests":' + listed(1);
    const raws = [
        prefix + '"expectedRevision":-1,"revision":0,' + one + '}]}',
        prefix + '"expectedRevision":1.5,"revision":2.5,' + one + '}]}',
        prefix + '"expectedRevision":"1","revision":2,' + one + '}]}',
        prefix + '"expectedRevision":1.0000000000000001,"revision":2,' + one + '}]}',
        prefix + '"expectedRevision":0,"revision":1.0000000000000001,' + one + '}]}',
        prefix + '"expectedRevision":9007199254740991,"revision":9007199254740992,' + one + '}]}',
        prefix + '"expectedRevision":0,"revision":1,"revision":1.5,' + one + '}]}',
        prefix + '"expectedRevision":0,"revision":1,' + one + ',"digests":[]}]}',
        prefix + '"expectedRevision":0,"revision":1e999,' + one + '}]}',
        '{"browser":"' + BrowserA + '","done":[],"kinds":[{"kind":"book","expectedRevision":0,"revision":1,' + one
            + '}],"__proto__":{}}',
        '[]', 'null', '"text"', '{', '{}', '',
    ];
    const untouched = new ScriptedD1();
    for (const payload of [...shaped, ...raws]) {
        const refused = await fixtures.send(scribe.post('/v1/scribe/commit', payload), untouched);
        assert.equal(refused.status, 400, payload.slice(0, 160));
    }
    assert.equal(twentyOne.every((id) => worker.AskIdPattern.test(id)), true);
    const typed = await fixtures.send(scribe.post('/v1/scribe/commit', valid, 'text/plain; charset=utf-8'), untouched);
    assert.equal(typed.status, 415);
    assert.deepEqual(await scribe.errorOf(typed), {
        code: 'unsupported_media_type', message: 'Use application/json with UTF-8 encoding.',
    });
    assert.equal(untouched.calls.length, 0);
});

test('scribe_json_bodies_are_capped', async (context) => {
    CloudflareCrypto.install(context);
    const { BrowserA, BrowserB, Now: now } = scribe;
    context.mock.method(Date, 'now', () => now);
    const windowStart = scribe.windowStart();
    const updatedAt = new Date(now).toISOString();
    const largest = { browser: BrowserB, id: scribe.AskA, action: { text: 'a'.repeat(8181) } };
    assert.equal(JSON.stringify(largest.action).length, 8192);
    const routes = [
        [
            '/v1/scribe/commit',
            { browser: BrowserA, kinds: [scribe.change('book', 0, 10)], done: [scribe.AskA] },
            [[{ kind: 'book', revision: 1, parts: 10, updatedAt }], [], []], 200,
        ],
        ['/v1/scribe/spend', { browser: BrowserA, day: scribe.Day, total: 1 }, [[], [{ daySum: 1, mine: 1 }]], 200],
        ['/v1/scribe/lease', { browser: BrowserA, want: 'None' }, [[scribe.leaseRow(BrowserA, now + 90000)], []], 200],
        ['/v1/scribe/ask', largest, [[{ id: scribe.AskA }]], 201],
    ];
    const untouched = new ScriptedD1();
    for (const [route, payload, outcomes, status] of routes) {
        const json = JSON.stringify(payload);
        assert.equal(json.length < 16384, true, route);
        const db = new ScriptedD1([{ windowStart }], ...outcomes);
        const exact = await fixtures.send(scribe.post(route, json.padEnd(16384, ' ')), db);
        assert.equal(exact.status, status, route);
        assert.equal(db.calls.length, outcomes.length + 1, route);
        for (const padded of [json.padEnd(16385, ' '), json.padEnd(16384, 'é')]) {
            assert.equal(new TextEncoder().encode(padded).length > 16384, true, route);
            const over = await fixtures.send(scribe.post(route, padded), untouched);
            assert.equal(over.status, 413, route);
            assert.equal(await scribe.codeOf(over), 'payload_too_large');
        }
    }
    let cancelled = false;
    const stream = new ReadableStream({
        /**
         * @param {ReadableStreamDefaultController<Uint8Array>} controller
         * @return {void}
         */
        start(controller) {
            controller.enqueue(new TextEncoder().encode(JSON.stringify(routes[0][1]).padEnd(16384, ' ')));
            controller.enqueue(new Uint8Array([32]));
        },
        /**
         * @return {void}
         */
        cancel() {
            cancelled = true;
        },
    });
    const streamed = fixtures.request(scribe.roomPath('/v1/scribe/commit'), {
        method: 'POST', duplex: 'half', body: stream,
        headers: { 'Content-Type': 'application/json', 'Content-Length': '1' },
    });
    assert.equal((await fixtures.send(streamed, untouched)).status, 413);
    assert.equal(cancelled, true);
    assert.equal(streamed.body.locked, false);
    assert.equal(untouched.calls.length, 0);
});

test('scribe_commit_fails_closed_without_native_source', async (context) => {
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
    const body = { browser: scribe.BrowserA, kinds: [scribe.change('book', 0, 1)], done: [] };
    const response = await fixtures.send(scribe.post('/v1/scribe/commit', body), db);
    assert.equal(response.status, 500);
    assert.equal(await scribe.codeOf(response), 'internal_error');
    const spend = await fixtures.send(scribe.post('/v1/scribe/spend', {
        browser: scribe.BrowserA, day: scribe.Day, total: 1,
    }), new ScriptedD1([{ windowStart: scribe.windowStart() }], [], [{ daySum: 1, mine: 1 }]));
    assert.equal(spend.status, 200);
    assert.equal(logs.mock.callCount(), 1);
    assert.equal(db.calls.length, 0);
});

test('scribe_spend_shape', async (context) => {
    CloudflareCrypto.install(context);
    const { BrowserA, Room, Day } = scribe;
    context.mock.method(Date, 'now', () => scribe.Now);
    const windowStart = scribe.windowStart();
    const db = new ScriptedD1([{ windowStart }], [], [{ daySum: 0.75, mine: 0.25 }]);
    const body = { browser: BrowserA, day: Day, total: 0.25 };
    const response = await fixtures.send(scribe.post('/v1/scribe/spend', body), db);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { day: Day, sum: 0.75, mine: 0.25 });
    assert.deepEqual(db.calls.slice(1), [
        { sql: worker.Sql.StoreScribeSpent, values: [Room, Day, BrowserA, 0.25] },
        { sql: worker.Sql.ReadScribeSpent, values: [Room, Day, BrowserA] },
    ]);
    for (const total of [0, 1000000, 1e-9]) {
        const edge = new ScriptedD1([{ windowStart }], [], [{ daySum: total, mine: total }]);
        const accepted = await fixtures.send(scribe.post('/v1/scribe/spend', { ...body, total }), edge);
        assert.equal(accepted.status, 200, String(total));
        assert.equal(edge.calls[1].values[3], total);
    }
    for (const day of ['2028-02-29', '2000-02-29', '2026-12-31', '2026-01-01']) {
        const dated = new ScriptedD1([{ windowStart }], [], [{ daySum: 1, mine: 1 }]);
        const accepted = await fixtures.send(scribe.post('/v1/scribe/spend', { ...body, day }), dated);
        assert.equal(accepted.status, 200, day);
        assert.equal(dated.calls[1].values[1], day);
    }

    const untouched = new ScriptedD1();
    const valid = { browser: BrowserA, day: Day, total: 1 };
    const shaped = [
        { ...valid, total: -0.01 },
        { ...valid, total: '1' },
        { ...valid, total: 1000000.01 },
        { ...valid, total: null },
        { ...valid, total: true },
        { browser: BrowserA, total: 1 },
        { ...valid, day: '2026-1-18' },
        { ...valid, day: 20261118 },
        { ...valid, day: '2026-02-29' },
        { ...valid, day: '2100-02-29' },
        { ...valid, day: '2026-02-30' },
        { ...valid, day: '2026-06-31' },
        { ...valid, day: '2026-99-99' },
        { ...valid, day: '0000-00-00' },
        { ...valid, day: '2026-11-00' },
        { ...valid, browser: 'short' },
        { ...valid, extra: 1 },
    ].map((payload) => JSON.stringify(payload));
    const raws = ['{"browser":"' + BrowserA + '","day":"' + Day + '","total":1e999}', '[]'];
    for (const payload of [...shaped, ...raws]) {
        const refused = await fixtures.send(scribe.post('/v1/scribe/spend', payload), untouched);
        assert.equal(refused.status, 400, payload);
    }
    assert.equal(untouched.calls.length, 0);
});

test('scribe_lease_take_want_and_release', async (context) => {
    CloudflareCrypto.install(context);
    const { BrowserA, BrowserB, Room, Now: now } = scribe;
    context.mock.method(Date, 'now', () => now);
    const windowStart = scribe.windowStart();
    const sql = worker.Sql;
    const askRows = [{ id: scribe.AskA, browser: BrowserB, action: '{"type":"Confirm"}', createdAt: now - 9 }];
    const held = scribe.leaseRow(BrowserA, now + 90000, BrowserB, now + 5, 1);
    const takeDb = new ScriptedD1([{ windowStart }], [held], askRows);
    const take = await fixtures.send(scribe.post('/v1/scribe/lease', { browser: BrowserA, want: 'None' }), takeDb);
    assert.equal(take.status, 200);
    assert.deepEqual(await take.json(), {
        held: true,
        lease: { browser: BrowserA, expiresAt: now + 90000, wanted: BrowserB, asked: true },
        asks: [{ id: scribe.AskA, browser: BrowserB, action: '{"type":"Confirm"}', createdAt: now - 9 }],
        now,
    });
    assert.deepEqual(takeDb.calls.slice(1), [
        { sql: sql.TakeScribeLease, values: [Room, BrowserA, now + 90000, now] },
        { sql: sql.ReadScribeAsks, values: [Room, 20] },
    ]);

    for (const [want, asked] of [['Asked', 1], ['Waiting', 0]]) {
        const wanted = scribe.leaseRow(BrowserA, now + 5000, BrowserB, now + 90000, asked);
        const wantDb = new ScriptedD1([{ windowStart }], [], [wanted]);
        const response = await fixtures.send(scribe.post('/v1/scribe/lease', { browser: BrowserB, want }), wantDb);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            held: false,
            lease: { browser: BrowserA, expiresAt: now + 5000, wanted: BrowserB, asked: asked === 1 },
            asks: [],
            now,
        });
        assert.deepEqual(wantDb.calls.slice(1), [
            { sql: sql.TakeScribeLease, values: [Room, BrowserB, now + 90000, now] },
            { sql: sql.WantScribeLease, values: [Room, BrowserB, now + 90000, now, asked] },
        ]);
    }
    const noneDb = new ScriptedD1([{ windowStart }], [], [scribe.leaseRow(BrowserA, now + 5000)]);
    const none = await fixtures.send(scribe.post('/v1/scribe/lease', { browser: BrowserB, want: 'None' }), noneDb);
    assert.deepEqual((await none.json()).lease, {
        browser: BrowserA, expiresAt: now + 5000, wanted: null, asked: false,
    });
    assert.deepEqual(noneDb.calls.map((call) => call.sql), [
        sql.ClaimScribeSlot, sql.TakeScribeLease, sql.ReadScribeLease,
    ]);
    const lapsedDb = new ScriptedD1([{ windowStart }], [], [], []);
    const lapsed = await fixtures.send(scribe.post('/v1/scribe/lease', { browser: BrowserB, want: 'Asked' }), lapsedDb);
    assert.deepEqual(await lapsed.json(), { held: false, lease: null, asks: [], now });
    assert.deepEqual(lapsedDb.calls.map((call) => call.sql), [
        sql.ClaimScribeSlot, sql.TakeScribeLease, sql.WantScribeLease, sql.ReadScribeLease,
    ]);

    const untouched = new ScriptedD1();
    for (const payload of [
        { browser: BrowserA, want: 'asked' },
        { browser: BrowserA, want: true },
        { browser: BrowserA, want: 'none' },
        { browser: BrowserA, want: 'constructor' },
        { browser: BrowserA },
        { browser: BrowserA, want: 'None', extra: 1 },
        { browser: 'short', want: 'None' },
    ]) {
        const refused = await fixtures.send(scribe.post('/v1/scribe/lease', payload), untouched);
        assert.equal(refused.status, 400, JSON.stringify(payload));
    }
    assert.equal(untouched.calls.length, 0);

    const passDb = new ScriptedD1([{ windowStart }], [scribe.leaseRow(BrowserB, now + 90000)]);
    const passed = await fixtures.send(fixtures.request(scribe.releasePath(), { method: 'DELETE' }), passDb);
    assert.deepEqual(await passed.json(), {
        released: true, lease: { browser: BrowserB, expiresAt: now + 90000, wanted: null, asked: false }, now,
    });
    assert.deepEqual(passDb.calls[1], { sql: sql.PassScribeLease, values: [Room, BrowserA, now + 90000, now] });
    const dropDb = new ScriptedD1([{ windowStart }], [], [{ browser: BrowserA }]);
    const dropped = await fixtures.send(fixtures.request(scribe.releasePath(), { method: 'DELETE' }), dropDb);
    assert.deepEqual(await dropped.json(), { released: true, lease: null, now });
    assert.deepEqual(dropDb.calls.slice(2), [{ sql: sql.DropScribeLease, values: [Room, BrowserA] }]);
    const keptDb = new ScriptedD1([{ windowStart }], [], [], [scribe.leaseRow(BrowserB, now + 3000)]);
    const kept = await fixtures.send(fixtures.request(scribe.releasePath(), { method: 'DELETE' }), keptDb);
    assert.deepEqual(await kept.json(), {
        released: false, lease: { browser: BrowserB, expiresAt: now + 3000, wanted: null, asked: false }, now,
    });
    assert.deepEqual(keptDb.calls.slice(3), [{ sql: sql.ReadScribeLease, values: [Room] }]);
});

test('scribe_asks_are_queued', async (context) => {
    CloudflareCrypto.install(context);
    const { BrowserB, Room, Now: now } = scribe;
    context.mock.method(Date, 'now', () => now);
    const windowStart = scribe.windowStart();
    const action = { type: 'Dismiss', finding: 'Fictional finding é' };
    const valid = { browser: BrowserB, id: scribe.AskA, action };
    const stored = new ScriptedD1([{ windowStart }], [{ id: scribe.AskA }]);
    const created = await fixtures.send(scribe.post('/v1/scribe/ask', valid), stored);
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { id: scribe.AskA });
    assert.deepEqual(stored.calls[1], {
        sql: worker.Sql.AddScribeAsk, values: [Room, scribe.AskA, BrowserB, JSON.stringify(action), now, 20],
    });
    const repeatDb = new ScriptedD1([{ windowStart }], [], [{ id: scribe.AskA }]);
    const repeat = await fixtures.send(scribe.post('/v1/scribe/ask', valid), repeatDb);
    assert.equal(repeat.status, 200);
    assert.deepEqual(await repeat.json(), { id: scribe.AskA });
    assert.deepEqual(repeatDb.calls[2], { sql: worker.Sql.FindScribeAsk, values: [Room, scribe.AskA] });
    const fullDb = new ScriptedD1([{ windowStart }], [], []);
    const full = await fixtures.send(scribe.post('/v1/scribe/ask', { ...valid, id: scribe.AskB }), fullDb);
    assert.equal(full.status, 409);
    assert.equal(await scribe.codeOf(full), 'asks_full');

    const largest = { text: 'a'.repeat(8181) };
    assert.equal(JSON.stringify(largest).length, 8192);
    const edgeDb = new ScriptedD1([{ windowStart }], [{ id: scribe.AskA }]);
    const edge = await fixtures.send(scribe.post('/v1/scribe/ask', {
        browser: BrowserB, id: scribe.AskA, action: largest,
    }), edgeDb);
    assert.equal(edge.status, 201);
    const untouched = new ScriptedD1();
    for (const [payload, status] of [
        [{ ...valid, action: [] }, 400],
        [{ ...valid, action: 'Dismiss' }, 400],
        [{ ...valid, action: null }, 400],
        [{ ...valid, action: { text: 'a'.repeat(8182) } }, 413],
        [{ ...valid, action: { text: 'é'.repeat(4091) } }, 413],
        [{ ...valid, id: 'short-id' }, 400],
        [{ ...valid, id: 'Fictional_Ask_000000000001' }, 400],
        [{ ...valid, extra: 1 }, 400],
        [{ browser: BrowserB, action }, 400],
    ]) {
        const refused = await fixtures.send(scribe.post('/v1/scribe/ask', payload), untouched);
        assert.equal(refused.status, status, JSON.stringify(payload).slice(0, 80));
    }
    assert.equal(untouched.calls.length, 0);
});

test('scribe_storage_failures_are_redacted', async (context) => {
    CloudflareCrypto.install(context);
    const logs = context.mock.method(console, 'error', () => {});
    context.mock.method(Date, 'now', () => scribe.Now);
    const text = 'Sensitive fictional part';
    const raw = 'Raw database exception ' + text + fixtures.Key;
    const failing = new ScriptedD1([{ windowStart: scribe.windowStart() }], new Error(raw));
    const unavailable = await fixtures.send(scribe.stage(text), failing);
    assert.equal(unavailable.status, 503);
    assert.equal(failing.calls[1].sql, worker.Sql.StageScribePart);
    const claimFails = await fixtures.send(scribe.stage(text), new ScriptedD1(new Error(raw)));
    assert.equal(claimFails.status, 503);
    const unsuccessful = await fixtures.send(fixtures.request(scribe.headsPath()), new ScriptedD1({ success: false }));
    assert.equal(unsuccessful.status, 503);
    const commitBody = { browser: scribe.BrowserA, kinds: [scribe.change('book', 0, 1)], done: [scribe.AskA] };
    const sweepFails = new ScriptedD1([{ windowStart: scribe.windowStart() }], [{
        kind: 'book', revision: 1, parts: 1, updatedAt: new Date(scribe.Now).toISOString(),
    }], new Error(raw));
    const swept = await fixtures.send(scribe.post('/v1/scribe/commit', commitBody), sweepFails);
    assert.equal(swept.status, 503);
    assert.deepEqual(sweepFails.calls.map(({ sql }) => sql), [
        worker.Sql.ClaimScribeSlot, worker.Sql.CommitScribe, worker.Sql.SweepScribeParts,
    ]);
    for (const response of [unavailable, claimFails, unsuccessful, swept]) {
        assert.deepEqual(await scribe.errorOf(response), {
            code: 'database_unavailable', message: 'Scribe storage is temporarily unavailable.',
        });
    }
    assert.equal(logs.mock.callCount(), 4);
    for (const { arguments: args } of logs.mock.calls) {
        assert.equal(args.length, 2);
        assert.match(args[0], /^[\da-f-]{36}$/i);
        assert.equal(args[1], 'database_unavailable');
        assert.equal(args.join(' ').includes(fixtures.Key), false);
        assert.equal(args.join(' ').includes(text), false);
    }
});

test('scribe_too_large_uses_scribe_wording', async (context) => {
    CloudflareCrypto.install(context);
    const untouched = new ScriptedD1();
    const expected = { code: 'payload_too_large', message: 'Scribe request or part exceeds the size limit.' };
    const valid = { browser: scribe.BrowserA, id: scribe.AskA, action: { name: 'Dismiss' } };
    const requests = [
        scribe.stage('a'.repeat(400001)),
        scribe.stage(new Uint8Array(1200001).fill(97)),
        scribe.post('/v1/scribe/commit', JSON.stringify({ browser: scribe.BrowserA, kinds: [], done: [] }).padEnd(16385, ' ')),
        scribe.post('/v1/scribe/ask', { ...valid, action: { text: 'a'.repeat(8182) } }),
    ];
    for (const request of requests) {
        const response = await fixtures.send(request, untouched);
        assert.equal(response.status, 413);
        assert.deepEqual(await scribe.errorOf(response), expected);
    }
    assert.equal(untouched.calls.length, 0);
});

test('notes_too_large_keeps_notes_wording', async (context) => {
    CloudflareCrypto.install(context);
    const untouched = new ScriptedD1();
    const expected = { code: 'payload_too_large', message: 'Request or notes exceed the size limit.' };
    const requests = [
        fixtures.put(JSON.stringify({ notes: 'a'.repeat(65537), expectedRevision: 0 })),
        fixtures.put(JSON.stringify({ notes: 'a', expectedRevision: 0 }).padEnd(524289, ' ')),
    ];
    for (const request of requests) {
        const response = await fixtures.send(request, untouched);
        assert.equal(response.status, 413);
        assert.deepEqual(await scribe.errorOf(response), expected);
    }
    assert.equal(untouched.calls.length, 0);
});
