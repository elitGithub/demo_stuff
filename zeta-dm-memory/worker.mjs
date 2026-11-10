/**
 * @typedef {Readonly<{ notes: string, expectedRevision: number }>} SaveInput
 * @typedef {Readonly<{ kind: 'Read', roomId: string } | ({ kind: 'Save', roomId: string } & SaveInput) | { kind: 'List', limit: number, after: string | null }>} Command
 * @typedef {Readonly<{ roomId: string, revision: number, updatedAt: string }>} Metadata
 * @typedef {Readonly<Metadata & { notes: string }>} Memory
 * @typedef {Readonly<{ status: number, memory: Memory }>} SaveResult
 * @typedef {Readonly<{ items: ReadonlyArray<Metadata>, nextCursor: string | null }>} Page
 * @typedef {Memory | Metadata | { windowStart: number }} Row
 * @typedef {string | number} BoundValue
 * @typedef {{ prepare(sql: string): { bind(...values: BoundValue[]): { all(): Promise<{ success: boolean, results: Row[] }> } } }} Database
 */

const worker = Object.freeze({
    Limits: Object.freeze({
        MinimumKeyCharacters: 60,
        MaximumKeyCharacters: 254,
        RoomBytes: 512,
        NoteBytes: 65536,
        BodyBytes: 524288,
        DefaultPage: 25,
        MaximumPage: 50,
        MinuteSeconds: 60,
        MinuteMilliseconds: 60000,
        RateCapacity: 180,
    }),
    Kinds: Object.freeze({ Read: 'Read', Save: 'Save', List: 'List' }),
    ControlledError: Symbol('ControlledError'),
    Errors: Object.freeze({
        BadRequest: Object.freeze({ code: 'bad_request', status: 400, message: 'Invalid request.' }),
        Unauthorized: Object.freeze({ code: 'unauthorized', status: 401, message: 'Authentication required.' }),
        NotFound: Object.freeze({ code: 'not_found', status: 404, message: 'Endpoint not found.' }),
        MemoryNotFound: Object.freeze({ code: 'memory_not_found', status: 404, message: 'No saved notes for this room.' }),
        MethodNotAllowed: Object.freeze({ code: 'method_not_allowed', status: 405, message: 'Method not allowed.' }),
        RevisionConflict: Object.freeze({ code: 'revision_conflict', status: 409, message: 'Notes changed elsewhere. Reload before saving.' }),
        PayloadTooLarge: Object.freeze({ code: 'payload_too_large', status: 413, message: 'Request or notes exceed the size limit.' }),
        UnsupportedMediaType: Object.freeze({ code: 'unsupported_media_type', status: 415, message: 'Use application/json with UTF-8 encoding.' }),
        RateLimited: Object.freeze({ code: 'rate_limited', status: 429, message: 'Too many requests. Retry later.' }),
        ConfigurationError: Object.freeze({ code: 'configuration_error', status: 503, message: 'API configuration is incomplete.' }),
        DatabaseUnavailable: Object.freeze({ code: 'database_unavailable', status: 503, message: 'Notes storage is temporarily unavailable.' }),
        InternalError: Object.freeze({ code: 'internal_error', status: 500, message: 'Unable to complete the request.' }),
    }),
    Sql: Object.freeze({
        ReadMemory: `
            SELECT room_id AS roomId, notes, revision, updated_at AS updatedAt
            FROM room_memories
            WHERE room_id = ?1
        `,
        CreateMemory: `
            INSERT INTO room_memories (room_id, notes, revision, updated_at)
            VALUES (?1, ?2, 1, ?3)
            ON CONFLICT(room_id) DO NOTHING
            RETURNING room_id AS roomId, notes, revision, updated_at AS updatedAt
        `,
        UpdateMemory: `
            UPDATE room_memories
            SET notes = ?3,
                revision = CASE WHEN notes = ?3 THEN revision ELSE revision + 1 END,
                updated_at = CASE WHEN notes = ?3 THEN updated_at ELSE ?4 END
            WHERE room_id = ?1 AND revision = ?2
            RETURNING room_id AS roomId, notes, revision, updated_at AS updatedAt
        `,
        ListFirst: `
            SELECT room_id AS roomId, revision, updated_at AS updatedAt
            FROM room_memories
            ORDER BY room_id COLLATE BINARY ASC
            LIMIT ?1
        `,
        ListAfter: `
            SELECT room_id AS roomId, revision, updated_at AS updatedAt
            FROM room_memories
            WHERE room_id > ?1 COLLATE BINARY
            ORDER BY room_id COLLATE BINARY ASC
            LIMIT ?2
        `,
        ClaimRateSlot: `
            INSERT INTO api_rate_limit (id, window_start, request_count)
            VALUES (1, ?1, 1)
            ON CONFLICT(id) DO UPDATE SET
                window_start = max(window_start, excluded.window_start),
                request_count = CASE
                    WHEN excluded.window_start > window_start THEN 1
                    ELSE request_count + 1
                END
            WHERE excluded.window_start > window_start OR request_count < ?2
            RETURNING window_start AS windowStart
        `,
        ReadRateWindow: `
            SELECT window_start AS windowStart
            FROM api_rate_limit
            WHERE id = 1
        `,
    }),

    /**
     * @param {Request} request
     * @param {{ DB?: Database, DM_API_KEY?: string }} env
     * @return {Promise<Response>}
     */
    async fetch(request, env) {
        try {
            await worker.authenticate(request, env?.DM_API_KEY);
            const command = await worker.parseCommand(request);
            const db = env.DB;
            if (typeof db?.prepare !== 'function') {
                throw worker.failure('ConfigurationError');
            }

            const nowMs = Date.now();
            await worker.claimRateSlot(db, nowMs);
            switch (command.kind) {
                case worker.Kinds.Read:
                    return worker.respond(await worker.loadMemory(db, command.roomId), 200);
                case worker.Kinds.Save: {
                    const { memory, status } = await worker.saveMemory(db, command.roomId, command, new Date(nowMs).toISOString());
                    return worker.respond(memory, status);
                }
                case worker.Kinds.List:
                    return worker.respond(await worker.listMemories(db, command.limit, command.after), 200);
            }
            throw worker.failure('InternalError');
        } catch (error) {
            const descriptor = error?.[worker.ControlledError] ?? worker.Errors.InternalError;
            if (descriptor.status >= 500) {
                console.error(crypto.randomUUID(), descriptor.code);
            }
            const payload = request?.method === 'HEAD'
                ? null
                : { error: { code: descriptor.code, message: descriptor.message } };
            return worker.respond(payload, descriptor.status, error?.[worker.ControlledError] ? error.headers : undefined);
        }
    },

    /**
     * @param {Request} request
     * @param {unknown} secret
     * @return {Promise<void>}
     * @throws {Error}
     */
    async authenticate(request, secret) {
        const { MinimumKeyCharacters, MaximumKeyCharacters } = worker.Limits;
        /**
         * @param {unknown} key
         * @return {key is string}
         */
        const isValidKey = (key) => typeof key === 'string'
            && key.length >= MinimumKeyCharacters && key.length <= MaximumKeyCharacters && !/[^!-~]/.test(key);

        if (!isValidKey(secret)) {
            throw worker.failure('ConfigurationError');
        }
        const authorization = request.headers.get('Authorization');
        if (!authorization || !/^Bearer /i.test(authorization)) {
            throw worker.failure('Unauthorized');
        }
        const token = authorization.slice('Bearer '.length);
        if (!isValidKey(token)) {
            throw worker.failure('Unauthorized');
        }

        const encoder = new TextEncoder();
        const [suppliedDigest, configuredDigest] = await Promise.all([
            crypto.subtle.digest('SHA-256', encoder.encode(token)),
            crypto.subtle.digest('SHA-256', encoder.encode(secret)),
        ]);
        if (!crypto.subtle.timingSafeEqual(suppliedDigest, configuredDigest)) {
            throw worker.failure('Unauthorized');
        }
    },

    /**
     * @param {Request} request
     * @return {Promise<Readonly<Command>>}
     * @throws {Error}
     */
    async parseCommand(request) {
        const url = new URL(request.url);
        if (url.protocol !== 'https:' || url.username || url.password) {
            throw worker.failure('BadRequest');
        }

        const isMemory = url.pathname === '/v1/memory';
        const isIndex = url.pathname === '/v1/memories';
        if (!isMemory && !isIndex) {
            throw worker.failure('NotFound');
        }
        if (request.method !== 'GET' && !(isMemory && request.method === 'PUT')) {
            throw worker.failure('MethodNotAllowed', { Allow: isMemory ? 'GET, PUT' : 'GET' });
        }
        if (request.method === 'GET' && request.body !== null) {
            throw worker.failure('BadRequest');
        }

        if (url.search) {
            for (const parameter of url.search.slice(1).split('&')) {
                if (!parameter.includes('=')) {
                    throw worker.failure('BadRequest');
                }
                try {
                    decodeURIComponent(parameter);
                } catch {
                    throw worker.failure('BadRequest');
                }
            }
        }

        const query = url.searchParams;
        if (isMemory) {
            if (query.size !== 1 || !query.has('roomId')) {
                throw worker.failure('BadRequest');
            }
            const roomId = worker.validateRoomId(query.get('roomId'));
            if (request.method === 'GET') {
                return Object.freeze({ kind: worker.Kinds.Read, roomId });
            }
            const input = await worker.readSaveBody(request);
            return Object.freeze({ kind: worker.Kinds.Save, roomId, ...input });
        }

        let limit = worker.Limits.DefaultPage;
        let after = null;
        const seen = new Set();
        for (const [name, value] of query) {
            if (seen.has(name)) {
                throw worker.failure('BadRequest');
            }
            seen.add(name);
            if (name === 'limit') {
                limit = Number(value);
                if (/[^0-9]/.test(value) || limit < 1 || limit > worker.Limits.MaximumPage) {
                    throw worker.failure('BadRequest');
                }
            } else if (name === 'after') {
                after = worker.validateRoomId(value);
            } else {
                throw worker.failure('BadRequest');
            }
        }
        return Object.freeze({ kind: worker.Kinds.List, limit, after });
    },

    /**
     * @param {unknown} value
     * @return {string}
     * @throws {Error}
     */
    validateRoomId(value) {
        if (typeof value !== 'string' || !value.startsWith('/') || /[\p{White_Space}\p{Cc}\uFEFF\uD800-\uDFFF\\?#]/u.test(value)
            || new TextEncoder().encode(value).length > worker.Limits.RoomBytes) {
            throw worker.failure('BadRequest');
        }
        return value;
    },

    /**
     * @param {Request} request
     * @return {Promise<Readonly<SaveInput>>}
     * @throws {Error}
     */
    async readSaveBody(request) {
        const contentType = request.headers.get('Content-Type');
        if (!contentType || !/^application\/json(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*(?:utf-8|"utf-8"))?$/i.test(contentType)) {
            throw worker.failure('UnsupportedMediaType');
        }
        if (!request.body) {
            throw worker.failure('BadRequest');
        }

        const reader = request.body.getReader();
        const bytes = new Uint8Array(worker.Limits.BodyBytes);
        let size = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                if (size + value.byteLength > bytes.length) {
                    try {
                        await reader.cancel();
                    } finally {
                        throw worker.failure('PayloadTooLarge');
                    }
                }
                bytes.set(value, size);
                size += value.byteLength;
            }
        } catch (error) {
            throw error?.[worker.ControlledError] ? error : worker.failure('BadRequest');
        } finally {
            reader.releaseLock();
        }

        const revisionSources = new WeakMap();
        let payload;
        try {
            const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size));
            payload = JSON.parse(json,
                /**
                 * @this {object}
                 * @param {string} key
                 * @param {unknown} value
                 * @param {{ source?: string }} [context]
                 * @return {unknown}
                 */
                function collectRevisionSource(key, value, context) {
                    if (key === 'expectedRevision' && typeof value === 'number') {
                        revisionSources.set(this, context?.source);
                    }
                    return value;
                }
            );
        } catch {
            throw worker.failure('BadRequest');
        }
        if (payload === null || typeof payload !== 'object' || Array.isArray(payload)
            || Object.keys(payload).length !== 2 || !Object.hasOwn(payload, 'notes') || !Object.hasOwn(payload, 'expectedRevision')) {
            throw worker.failure('BadRequest');
        }
        const { notes } = payload;
        if (typeof notes !== 'string' || /[\uD800-\uDFFF]/u.test(notes) || typeof payload.expectedRevision !== 'number') {
            throw worker.failure('BadRequest');
        }
        const source = revisionSources.get(payload);
        if (typeof source !== 'string') {
            throw worker.failure('InternalError');
        }
        const expectedRevision = worker.validateRevision(source);
        if (new TextEncoder().encode(notes).length > worker.Limits.NoteBytes) {
            throw worker.failure('PayloadTooLarge');
        }
        return Object.freeze({ notes, expectedRevision });
    },

    /**
     * @param {string} source
     * @return {number}
     * @throws {Error}
     */
    validateRevision(source) {
        const [, sign, whole, fraction = '', exponent = '0'] = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(source);
        const significant = (whole + fraction).replace(/^0+/, '');
        if (!significant) {
            return 0;
        }

        const scale = Number(exponent) - fraction.length;
        const integerLength = significant.length + scale;
        const maximum = String(Number.MAX_SAFE_INTEGER);
        if (sign || integerLength < 1 || integerLength > maximum.length
            || (scale < 0 && /[^0]/.test(significant.slice(integerLength)))) {
            throw worker.failure('BadRequest');
        }

        const integer = significant.slice(0, integerLength).padEnd(integerLength, '0');
        if (integerLength === maximum.length && integer > maximum) {
            throw worker.failure('BadRequest');
        }
        return Number(integer);
    },

    /**
     * @param {keyof typeof worker.Errors} code
     * @param {Record<string, string>} [headers]
     * @return {Error}
     */
    failure(code, headers) {
        const descriptor = worker.Errors[code];
        return Object.assign(new Error(descriptor.code), { [worker.ControlledError]: descriptor, headers });
    },

    /**
     * @param {object | null} payload
     * @param {number} status
     * @param {HeadersInit} [headers]
     * @return {Response}
     */
    respond(payload, status, headers) {
        const responseHeaders = new Headers(headers);
        responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
        responseHeaders.set('Cache-Control', 'no-store');
        responseHeaders.set('X-Content-Type-Options', 'nosniff');
        return new Response(payload === null ? null : JSON.stringify(payload), { status, headers: responseHeaders });
    },

    /**
     * @param {Database} db
     * @param {keyof typeof worker.Sql} statementName
     * @param {BoundValue[]} values
     * @return {Promise<ReadonlyArray<Row>>}
     * @throws {Error}
     */
    async execute(db, statementName, values) {
        let outcome;
        try {
            outcome = await db.prepare(worker.Sql[statementName]).bind(...values).all();
        } catch {
            throw worker.failure('DatabaseUnavailable');
        }
        if (outcome?.success !== true || !Array.isArray(outcome.results)) {
            throw worker.failure('DatabaseUnavailable');
        }
        return outcome.results;
    },

    /**
     * @param {Database} db
     * @param {number} nowMs
     * @return {Promise<void>}
     * @throws {Error}
     */
    async claimRateSlot(db, nowMs) {
        const { MinuteMilliseconds, MinuteSeconds, RateCapacity } = worker.Limits;
        const windowStart = Math.floor(nowMs / MinuteMilliseconds) * MinuteSeconds;
        const claimed = await worker.execute(db, 'ClaimRateSlot', [windowStart, RateCapacity]);
        if (claimed.length) {
            return;
        }

        const [active] = await worker.execute(db, 'ReadRateWindow', []);
        if (!active) {
            throw worker.failure('DatabaseUnavailable');
        }
        const seconds = Math.max(1, Math.ceil(((active.windowStart + MinuteSeconds) * 1000 - nowMs) / 1000));
        throw worker.failure('RateLimited', { 'Retry-After': String(seconds) });
    },

    /**
     * @param {Database} db
     * @param {string} roomId
     * @return {Promise<Readonly<Memory>>}
     * @throws {Error}
     */
    async loadMemory(db, roomId) {
        const [row] = await worker.execute(db, 'ReadMemory', [roomId]);
        if (!row) {
            throw worker.failure('MemoryNotFound');
        }
        return Object.freeze({ roomId: row.roomId, notes: row.notes, revision: row.revision, updatedAt: row.updatedAt });
    },

    /**
     * @param {Database} db
     * @param {string} roomId
     * @param {Readonly<SaveInput>} input
     * @param {string} updatedAt
     * @return {Promise<Readonly<SaveResult>>}
     * @throws {Error}
     */
    async saveMemory(db, roomId, input, updatedAt) {
        const { notes, expectedRevision } = input;
        const creating = expectedRevision === 0;
        const [row] = creating
            ? await worker.execute(db, 'CreateMemory', [roomId, notes, updatedAt])
            : await worker.execute(db, 'UpdateMemory', [roomId, expectedRevision, notes, updatedAt]);
        if (!row) {
            throw worker.failure('RevisionConflict');
        }
        const memory = Object.freeze({ roomId: row.roomId, notes: row.notes, revision: row.revision, updatedAt: row.updatedAt });
        return Object.freeze({ status: creating ? 201 : 200, memory });
    },

    /**
     * @param {Database} db
     * @param {number} limit
     * @param {string | null} after
     * @return {Promise<Readonly<Page>>}
     */
    async listMemories(db, limit, after) {
        const rows = after === null
            ? await worker.execute(db, 'ListFirst', [limit + 1])
            : await worker.execute(db, 'ListAfter', [after, limit + 1]);
        const items = Object.freeze(rows.slice(0, limit).map(({ roomId, revision, updatedAt }) =>
            Object.freeze({ roomId, revision, updatedAt })
        ));
        return Object.freeze({ items, nextCursor: rows.length > limit ? items.at(-1).roomId : null });
    },
});

export default worker;
