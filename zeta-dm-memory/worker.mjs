/**
 * @typedef {Readonly<{ notes: string, expectedRevision: number }>} SaveInput
 * @typedef {Readonly<{ kind: 'Read', roomId: string } | ({ kind: 'Save', roomId: string } & SaveInput) | { kind: 'List', limit: number, after: string | null }>} Command
 * @typedef {Readonly<{ kind: string, revision: number, part: number }>} PartTarget
 * @typedef {Readonly<PartTarget & { digest: string }>} StagedPart
 * @typedef {Readonly<{ text: string, digest: string }>} PartText
 * @typedef {Readonly<{ kind: string, expectedRevision: number, revision: number,
 *     digests: ReadonlyArray<string> }>} KindChange
 * @typedef {Readonly<{ kind: string, roomId: string, browser?: string, day?: string, target?: PartTarget,
 *     text?: string, digest?: string, kinds?: ReadonlyArray<KindChange>, done?: ReadonlyArray<string>,
 *     total?: number, want?: string, id?: string, action?: string }>} ScribeCommand
 * @typedef {Readonly<{ claim: string, read: string, capacity: string }>} Counter
 * @typedef {Readonly<{ kind: string, revision: number, parts: number, updatedAt: string }>} Head
 * @typedef {Readonly<{ day: string, sum: number, mine: number }>} Spent
 * @typedef {Readonly<{ browser: string, expiresAt: number, wanted: string | null, asked: boolean }>} Lease
 * @typedef {Readonly<{ id: string, browser: string, action: string, createdAt: number }>} Ask
 * @typedef {WeakMap<object, Map<string, string | undefined>>} NumberSources
 * @typedef {Readonly<{ roomId: string, revision: number, updatedAt: string }>} Metadata
 * @typedef {Readonly<Metadata & { notes: string }>} Memory
 * @typedef {Readonly<{ status: number, memory: Memory }>} SaveResult
 * @typedef {Readonly<{ items: ReadonlyArray<Metadata>, nextCursor: string | null }>} Page
 * @typedef {Memory | Metadata | { windowStart: number } | Readonly<Record<string, string | number | null>>} Row
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
        ScribeBodyBytes: 16384,
        DefaultPage: 25,
        MaximumPage: 50,
        MinuteSeconds: 60,
        MinuteMilliseconds: 60000,
        RateCapacity: 180,
        ScribeRateCapacity: 600,
        PartCharacters: 400000,
        PartBytes: 1200000,
        MostParts: 10,
        LeaseMs: 90000,
        WantMs: 90000,
        MostSpent: 1000000,
        AskBytes: 8192,
        MostAsks: 20,
        MostKinds: 3,
    }),
    Kinds: Object.freeze({
        Read: 'Read',
        Save: 'Save',
        List: 'List',
        Heads: 'Heads',
        PartRead: 'PartRead',
        PartStage: 'PartStage',
        Commit: 'Commit',
        Spend: 'Spend',
        Lease: 'Lease',
        Release: 'Release',
        Ask: 'Ask',
    }),
    NotesKinds: Object.freeze(['Read', 'Save', 'List']),
    ScribeKinds: Object.freeze(['settings', 'book', 'live']),
    Wants: Object.freeze({ None: 'None', Waiting: 'Waiting', Asked: 'Asked' }),
    Counters: Object.freeze({
        Notes: Object.freeze({
            claim: 'ClaimRateSlot', read: 'ReadRateWindow', capacity: 'RateCapacity',
            unavailable: 'DatabaseUnavailable',
        }),
        Scribe: Object.freeze({
            claim: 'ClaimScribeSlot', read: 'ReadScribeWindow', capacity: 'ScribeRateCapacity',
            unavailable: 'ScribeUnavailable',
        }),
    }),
    Routes: Object.freeze({
        '/v1/scribe': Object.freeze({ GET: 'Heads' }),
        '/v1/scribe/part': Object.freeze({ GET: 'PartRead', PUT: 'PartStage' }),
        '/v1/scribe/commit': Object.freeze({ POST: 'Commit' }),
        '/v1/scribe/spend': Object.freeze({ POST: 'Spend' }),
        '/v1/scribe/lease': Object.freeze({ POST: 'Lease', DELETE: 'Release' }),
        '/v1/scribe/ask': Object.freeze({ POST: 'Ask' }),
    }),
    Queries: Object.freeze({
        Heads: Object.freeze(['roomId', 'browser', 'day']),
        PartRead: Object.freeze(['roomId', 'kind', 'revision', 'part']),
        PartStage: Object.freeze(['roomId', 'kind', 'revision', 'part', 'browser']),
        Commit: Object.freeze(['roomId']),
        Spend: Object.freeze(['roomId']),
        Lease: Object.freeze(['roomId']),
        Ask: Object.freeze(['roomId']),
        Release: Object.freeze(['roomId', 'browser']),
    }),
    Bodies: Object.freeze({
        Commit: Object.freeze(['browser', 'kinds', 'done']),
        Change: Object.freeze(['kind', 'expectedRevision', 'revision', 'digests']),
        Spend: Object.freeze(['browser', 'day', 'total']),
        Lease: Object.freeze(['browser', 'want']),
        Ask: Object.freeze(['browser', 'id', 'action']),
    }),
    MediaTypes: Object.freeze({
        /**
         * @return {RegExp}
         */
        get Json() {
            return /^application\/json(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*(?:utf-8|"utf-8"))?$/i;
        },
        /**
         * @return {RegExp}
         */
        get Text() {
            return /^text\/plain[ \t]*;[ \t]*charset[ \t]*=[ \t]*(?:utf-8|"utf-8")$/i;
        },
        JsonType: 'application/json; charset=utf-8',
        TextType: 'text/plain; charset=utf-8',
    }),
    IntegerKeys: Object.freeze(['expectedRevision', 'revision']),

    /**
     * @return {RegExp}
     */
    get BrowserPattern() {
        return /^[0-9A-Za-z-]{16,64}$/;
    },

    /**
     * @return {RegExp}
     */
    get AskIdPattern() {
        return /^[0-9A-Za-z-]{16,64}$/;
    },

    /**
     * @return {RegExp}
     */
    get DayPattern() {
        return /^\d{4}-\d{2}-\d{2}$/;
    },

    /**
     * @return {RegExp}
     */
    get IndexPattern() {
        return /^(?:0|[1-9][0-9]*)$/;
    },

    /**
     * @return {RegExp}
     */
    get DigestPattern() {
        return /^[0-9a-f]{64}$/;
    },

    ControlledError: Symbol('ControlledError'),
    Errors: Object.freeze({
        BadRequest: Object.freeze({ code: 'bad_request', status: 400, message: 'Invalid request.' }),
        Unauthorized: Object.freeze({ code: 'unauthorized', status: 401, message: 'Authentication required.' }),
        NotFound: Object.freeze({ code: 'not_found', status: 404, message: 'Endpoint not found.' }),
        MemoryNotFound: Object.freeze({ code: 'memory_not_found', status: 404, message: 'No saved notes for this room.' }),
        MethodNotAllowed: Object.freeze({ code: 'method_not_allowed', status: 405, message: 'Method not allowed.' }),
        RevisionConflict: Object.freeze({ code: 'revision_conflict', status: 409, message: 'Notes changed elsewhere. Reload before saving.' }),
        PayloadTooLarge: Object.freeze({ code: 'payload_too_large', status: 413, message: 'Request or notes exceed the size limit.' }),
        ScribeTooLarge: Object.freeze({
            code: 'payload_too_large', status: 413, message: 'Scribe request or part exceeds the size limit.',
        }),
        UnsupportedMediaType: Object.freeze({ code: 'unsupported_media_type', status: 415, message: 'Use application/json with UTF-8 encoding.' }),
        UnsupportedText: Object.freeze({
            code: 'unsupported_media_type', status: 415, message: 'Use text/plain with UTF-8 encoding.',
        }),
        RateLimited: Object.freeze({ code: 'rate_limited', status: 429, message: 'Too many requests. Retry later.' }),
        ConfigurationError: Object.freeze({ code: 'configuration_error', status: 503, message: 'API configuration is incomplete.' }),
        DatabaseUnavailable: Object.freeze({ code: 'database_unavailable', status: 503, message: 'Notes storage is temporarily unavailable.' }),
        ScribeUnavailable: Object.freeze({
            code: 'database_unavailable', status: 503, message: 'Scribe storage is temporarily unavailable.',
        }),
        InternalError: Object.freeze({ code: 'internal_error', status: 500, message: 'Unable to complete the request.' }),
        LeaseLost: Object.freeze({
            code: 'lease_lost', status: 409, message: 'Another browser holds the lease for this room.',
        }),
        ScribeConflict: Object.freeze({
            code: 'revision_conflict', status: 409, message: 'The book changed elsewhere. Read it again before saving.',
        }),
        PartsMissing: Object.freeze({
            code: 'parts_missing', status: 409, message: 'Some staged parts are missing. Send them again.',
        }),
        PartNotFound: Object.freeze({ code: 'part_not_found', status: 404, message: 'No committed part matches.' }),
        AsksFull: Object.freeze({
            code: 'asks_full', status: 409, message: 'Too many requests are waiting for the reading browser.',
        }),
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
        ClaimScribeSlot: `
            INSERT INTO scribe_rate_limit (id, window_start, request_count)
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
        ReadScribeWindow: `
            SELECT window_start AS windowStart
            FROM scribe_rate_limit
            WHERE id = 1
        `,
        ReadScribeHeads: `
            SELECT kind, revision, parts, updated_at AS updatedAt
            FROM scribe_kinds
            WHERE room_id = ?1
            ORDER BY kind
        `,
        ReadScribeSpent: `
            SELECT coalesce(sum(total), 0.0) AS daySum,
                coalesce(sum(CASE WHEN browser = ?3 THEN total END), 0.0) AS mine
            FROM scribe_spent
            WHERE room_id = ?1 AND day = ?2
        `,
        ReadScribeLease: `
            SELECT browser, expires_at AS expiresAt, wanted, wanted_until AS wantedUntil, asked
            FROM scribe_lease
            WHERE room_id = ?1
        `,
        ReadScribeAsks: `
            SELECT id, browser, action, created_at AS createdAt
            FROM scribe_asks
            WHERE room_id = ?1
            ORDER BY created_at, id
            LIMIT ?2
        `,
        ReadScribePart: `
            SELECT stored.text AS text
            FROM scribe_parts AS stored
            JOIN scribe_kinds AS head
                ON head.room_id = stored.room_id AND head.kind = stored.kind AND head.revision = stored.revision
            WHERE stored.room_id = ?1 AND stored.kind = ?2 AND stored.revision = ?3 AND stored.part = ?4
                AND stored.part < head.parts
        `,
        StageScribePart: `
            INSERT INTO scribe_parts (room_id, kind, revision, part, text, digest)
            SELECT ?1, ?2, ?3, ?4, ?5, ?6
            WHERE EXISTS (SELECT 1 FROM scribe_lease WHERE room_id = ?1 AND browser = ?7 AND expires_at > ?8)
                AND NOT EXISTS (SELECT 1 FROM scribe_kinds WHERE room_id = ?1 AND kind = ?2 AND revision >= ?3)
            ON CONFLICT (room_id, kind, revision, part) DO UPDATE SET text = excluded.text, digest = excluded.digest
            RETURNING part, digest
        `,
        CommitScribe: `
            INSERT INTO scribe_kinds (room_id, kind, revision, parts, updated_at)
            SELECT ?1, wanted.value ->> '$.kind', wanted.value ->> '$.revision',
                json_array_length(wanted.value, '$.digests'), ?4
            FROM json_each(?2) AS wanted
            WHERE EXISTS (SELECT 1 FROM scribe_lease WHERE room_id = ?1 AND browser = ?3 AND expires_at > ?5)
                AND NOT EXISTS (
                    SELECT 1 FROM json_each(?2) AS asked
                    LEFT JOIN scribe_kinds AS head ON head.room_id = ?1 AND head.kind = asked.value ->> '$.kind'
                    WHERE coalesce(head.revision, 0) <> asked.value ->> '$.expectedRevision'
                )
                AND NOT EXISTS (
                    SELECT 1 FROM json_each(?2) AS asked
                    WHERE (
                        SELECT count(*) FROM json_each(asked.value, '$.digests') AS named
                        JOIN scribe_parts AS staged
                            ON staged.room_id = ?1 AND staged.kind = asked.value ->> '$.kind'
                                AND staged.revision = asked.value ->> '$.revision'
                                AND staged.part = named.key AND staged.digest = named.value
                    ) <> json_array_length(asked.value, '$.digests')
                )
            ON CONFLICT (room_id, kind) DO UPDATE SET
                revision = excluded.revision, parts = excluded.parts, updated_at = excluded.updated_at
            RETURNING kind, revision, parts, updated_at AS updatedAt
        `,
        SweepScribeParts: `
            DELETE FROM scribe_parts
            WHERE room_id = ?1 AND NOT EXISTS (
                SELECT 1 FROM scribe_kinds AS head
                WHERE head.room_id = scribe_parts.room_id AND head.kind = scribe_parts.kind
                    AND head.revision = scribe_parts.revision AND scribe_parts.part < head.parts
            )
        `,
        DropScribeAsks: `
            DELETE FROM scribe_asks
            WHERE room_id = ?1 AND id IN (SELECT value FROM json_each(?2))
        `,
        StoreScribeSpent: `
            INSERT INTO scribe_spent (room_id, day, browser, total)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT (room_id, day, browser) DO UPDATE SET total = excluded.total
            WHERE excluded.total > scribe_spent.total
        `,
        TakeScribeLease: `
            INSERT INTO scribe_lease (room_id, browser, expires_at, wanted, wanted_until, asked)
            VALUES (?1, ?2, ?3, NULL, NULL, 0)
            ON CONFLICT (room_id) DO UPDATE SET
                browser = excluded.browser,
                expires_at = excluded.expires_at,
                wanted = CASE WHEN wanted = excluded.browser OR wanted_until <= ?4 THEN NULL ELSE wanted END,
                wanted_until = CASE
                    WHEN wanted = excluded.browser OR wanted_until <= ?4 THEN NULL
                    ELSE wanted_until
                END,
                asked = CASE WHEN wanted = excluded.browser OR wanted_until <= ?4 THEN 0 ELSE asked END
            WHERE scribe_lease.browser = excluded.browser OR scribe_lease.expires_at <= ?4
            RETURNING browser, expires_at AS expiresAt, wanted, wanted_until AS wantedUntil, asked
        `,
        WantScribeLease: `
            UPDATE scribe_lease SET
                wanted = ?2,
                wanted_until = ?3,
                asked = CASE WHEN ?5 = 1 THEN 1 WHEN wanted = ?2 AND wanted_until > ?4 THEN asked ELSE 0 END
            WHERE room_id = ?1 AND browser <> ?2 AND expires_at > ?4
            RETURNING browser, expires_at AS expiresAt, wanted, wanted_until AS wantedUntil, asked
        `,
        PassScribeLease: `
            UPDATE scribe_lease SET browser = wanted, expires_at = ?3, wanted = NULL, wanted_until = NULL, asked = 0
            WHERE room_id = ?1 AND browser = ?2 AND wanted IS NOT NULL AND wanted_until > ?4
            RETURNING browser, expires_at AS expiresAt, wanted, wanted_until AS wantedUntil, asked
        `,
        DropScribeLease: `
            DELETE FROM scribe_lease
            WHERE room_id = ?1 AND browser = ?2
            RETURNING browser
        `,
        AddScribeAsk: `
            INSERT INTO scribe_asks (room_id, id, browser, action, created_at)
            SELECT ?1, ?2, ?3, ?4, ?5
            WHERE (SELECT count(*) FROM scribe_asks WHERE room_id = ?1) < ?6
            ON CONFLICT (room_id, id) DO NOTHING
            RETURNING id
        `,
        FindScribeAsk: `
            SELECT id
            FROM scribe_asks
            WHERE room_id = ?1 AND id = ?2
        `,
    }),

    /**
     * @param {Request} request
     * @param {{ DB?: Database, DM_API_KEY?: string }} env
     * @return {Promise<Response>}
     */
    async fetch(request, env) {
        let counter = worker.Counters.Notes;
        try {
            await worker.authenticate(request, env?.DM_API_KEY);
            const command = await worker.parseCommand(request);
            const db = env.DB;
            if (typeof db?.prepare !== 'function') {
                throw worker.failure('ConfigurationError');
            }

            const nowMs = Date.now();
            counter = worker.NotesKinds.includes(command.kind) ? worker.Counters.Notes : worker.Counters.Scribe;
            await worker.claimRateSlot(db, nowMs, counter);
            switch (command.kind) {
                case worker.Kinds.Read:
                    return worker.respond(await worker.loadMemory(db, command.roomId), 200);
                case worker.Kinds.Save: {
                    const { memory, status } = await worker.saveMemory(db, command.roomId, command, new Date(nowMs).toISOString());
                    return worker.respond(memory, status);
                }
                case worker.Kinds.List:
                    return worker.respond(await worker.listMemories(db, command.limit, command.after), 200);
                case worker.Kinds.Heads:
                    return worker.respond(await worker.loadScribe(db, command, nowMs), 200);
                case worker.Kinds.PartRead: {
                    const text = await worker.readPart(db, command);
                    return worker.respond(text, 200, undefined, worker.MediaTypes.TextType);
                }
                case worker.Kinds.PartStage:
                    return worker.respond(await worker.stagePart(db, command, nowMs), 200);
                case worker.Kinds.Commit: {
                    const updatedAt = new Date(nowMs).toISOString();
                    return worker.respond(await worker.commitScribe(db, command, updatedAt, nowMs), 200);
                }
                case worker.Kinds.Spend:
                    return worker.respond(await worker.spendScribe(db, command), 200);
                case worker.Kinds.Lease:
                    return worker.respond(await worker.leaseScribe(db, command, nowMs), 200);
                case worker.Kinds.Release:
                    return worker.respond(await worker.releaseScribe(db, command, nowMs), 200);
                case worker.Kinds.Ask: {
                    const { status, ask } = await worker.askScribe(db, command, nowMs);
                    return worker.respond(ask, status);
                }
            }
            throw worker.failure('InternalError');
        } catch (error) {
            const controlled = error?.[worker.ControlledError] ?? worker.Errors.InternalError;
            const descriptor = controlled === worker.Errors.DatabaseUnavailable
                ? worker.Errors[counter.unavailable]
                : controlled;
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
     * @return {Promise<Readonly<Command | ScribeCommand>>}
     * @throws {Error}
     */
    async parseCommand(request) {
        const url = new URL(request.url);
        if (url.protocol !== 'https:' || url.username || url.password) {
            throw worker.failure('BadRequest');
        }
        if (Object.hasOwn(worker.Routes, url.pathname)) {
            return worker.parseScribe(request, url, worker.Routes[url.pathname]);
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

        worker.checkQuery(url);

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
     * @param {URL} url
     * @return {void}
     * @throws {Error}
     */
    checkQuery(url) {
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
    },

    /**
     * @param {Request} request
     * @param {URL} url
     * @param {Readonly<Record<string, string>>} route
     * @return {Promise<Readonly<ScribeCommand>>}
     * @throws {Error}
     */
    async parseScribe(request, url, route) {
        if (!Object.hasOwn(route, request.method)) {
            throw worker.failure('MethodNotAllowed', { Allow: Object.keys(route).join(', ') });
        }
        if ((request.method === 'GET' || request.method === 'DELETE') && request.body !== null) {
            throw worker.failure('BadRequest');
        }
        worker.checkQuery(url);

        const kind = route[request.method];
        const query = worker.queryOf(url, worker.Queries[kind]);
        const roomId = worker.validateRoomId(query.roomId);
        switch (kind) {
            case worker.Kinds.Heads:
                return Object.freeze({
                    kind, roomId, browser: worker.validateBrowser(query.browser), day: worker.validateDay(query.day),
                });
            case worker.Kinds.Release:
                return Object.freeze({ kind, roomId, browser: worker.validateBrowser(query.browser) });
            case worker.Kinds.PartRead:
            case worker.Kinds.PartStage: {
                const target = Object.freeze({
                    kind: worker.validateKind(query.kind),
                    revision: worker.validateIndex(query.revision, 1, Number.MAX_SAFE_INTEGER),
                    part: worker.validateIndex(query.part, 0, worker.Limits.MostParts - 1),
                });
                if (kind === worker.Kinds.PartRead) {
                    return Object.freeze({ kind, roomId, target });
                }
                const browser = worker.validateBrowser(query.browser);
                return Object.freeze({ kind, roomId, target, browser, ...await worker.readPartText(request) });
            }
        }

        const { payload, sources } = await worker.readScribeJson(request);
        switch (kind) {
            case worker.Kinds.Commit:
                return Object.freeze({ kind, roomId, ...worker.commitInput(payload, sources) });
            case worker.Kinds.Spend:
                return Object.freeze({ kind, roomId, ...worker.spendInput(payload) });
            case worker.Kinds.Lease:
                return Object.freeze({ kind, roomId, ...worker.leaseInput(payload) });
            case worker.Kinds.Ask:
                return Object.freeze({ kind, roomId, ...worker.askInput(payload) });
        }
        throw worker.failure('InternalError');
    },

    /**
     * @param {URL} url
     * @param {ReadonlyArray<string>} names
     * @return {Readonly<Record<string, string>>}
     * @throws {Error}
     */
    queryOf(url, names) {
        const query = {};
        for (const [name, value] of url.searchParams) {
            if (!names.includes(name) || Object.hasOwn(query, name)) {
                throw worker.failure('BadRequest');
            }
            query[name] = value;
        }
        if (Object.keys(query).length !== names.length) {
            throw worker.failure('BadRequest');
        }
        return Object.freeze(query);
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
     * @param {unknown} value
     * @return {string}
     * @throws {Error}
     */
    validateKind(value) {
        if (!worker.ScribeKinds.includes(value)) {
            throw worker.failure('BadRequest');
        }
        return value;
    },

    /**
     * @param {unknown} value
     * @return {string}
     * @throws {Error}
     */
    validateBrowser(value) {
        if (typeof value !== 'string' || !worker.BrowserPattern.test(value)) {
            throw worker.failure('BadRequest');
        }
        return value;
    },

    /**
     * @param {unknown} value
     * @return {string}
     * @throws {Error}
     */
    validateAskId(value) {
        if (typeof value !== 'string' || !worker.AskIdPattern.test(value)) {
            throw worker.failure('BadRequest');
        }
        return value;
    },

    /**
     * @param {unknown} value
     * @return {string}
     * @throws {Error}
     */
    validateDay(value) {
        const time = typeof value === 'string' && worker.DayPattern.test(value) ? Date.parse(value) : Number.NaN;
        if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value) {
            throw worker.failure('BadRequest');
        }
        return value;
    },

    /**
     * @param {string} value
     * @param {number} least
     * @param {number} most
     * @return {number}
     * @throws {Error}
     */
    validateIndex(value, least, most) {
        const index = Number(value);
        if (!worker.IndexPattern.test(value) || !Number.isSafeInteger(index) || index < least || index > most) {
            throw worker.failure('BadRequest');
        }
        return index;
    },

    /**
     * @param {Request} request
     * @param {RegExp} pattern
     * @param {number} limit
     * @param {keyof typeof worker.Errors} unsupported
     * @param {keyof typeof worker.Errors} tooLarge
     * @return {Promise<Uint8Array>}
     * @throws {Error}
     */
    async readBody(request, pattern, limit, unsupported, tooLarge) {
        const contentType = request.headers.get('Content-Type');
        if (!contentType || !pattern.test(contentType)) {
            throw worker.failure(unsupported);
        }
        if (!request.body) {
            throw worker.failure('BadRequest');
        }

        const reader = request.body.getReader();
        const bytes = new Uint8Array(limit);
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
                        throw worker.failure(tooLarge);
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
        return bytes.subarray(0, size);
    },

    /**
     * @param {Request} request
     * @return {Promise<Readonly<SaveInput>>}
     * @throws {Error}
     */
    async readSaveBody(request) {
        const bytes = await worker.readBody(
            request, worker.MediaTypes.Json, worker.Limits.BodyBytes, 'UnsupportedMediaType', 'PayloadTooLarge'
        );
        const revisionSources = new WeakMap();
        let payload;
        try {
            const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
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
     * @param {Request} request
     * @return {Promise<PartText>}
     * @throws {Error}
     */
    async readPartText(request) {
        const bytes = await worker.readBody(
            request, worker.MediaTypes.Text, worker.Limits.PartBytes, 'UnsupportedText', 'ScribeTooLarge'
        );
        let text;
        try {
            text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        } catch {
            throw worker.failure('BadRequest');
        }
        if (!text || text.includes('\u0000')) {
            throw worker.failure('BadRequest');
        }
        if (text.length > worker.Limits.PartCharacters) {
            throw worker.failure('ScribeTooLarge');
        }
        const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        const digest = Array.from(hash,
            /**
             * @param {number} byte
             * @return {string}
             */
            (byte) => byte.toString(16).padStart(2, '0')
        ).join('');
        return Object.freeze({ text, digest });
    },

    /**
     * @param {Request} request
     * @return {Promise<Readonly<{ payload: Record<string, unknown>, sources: NumberSources }>>}
     * @throws {Error}
     */
    async readScribeJson(request) {
        const bytes = await worker.readBody(
            request, worker.MediaTypes.Json, worker.Limits.ScribeBodyBytes, 'UnsupportedMediaType', 'ScribeTooLarge'
        );
        const sources = new WeakMap();
        let payload;
        try {
            const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            payload = JSON.parse(json,
                /**
                 * @this {object}
                 * @param {string} key
                 * @param {unknown} value
                 * @param {{ source?: string }} [context]
                 * @return {unknown}
                 */
                function collectIntegerSources(key, value, context) {
                    if (worker.IntegerKeys.includes(key) && typeof value === 'number') {
                        const known = sources.get(this) ?? new Map();
                        known.set(key, context?.source);
                        sources.set(this, known);
                    }
                    return value;
                }
            );
        } catch {
            throw worker.failure('BadRequest');
        }
        if (!worker.isRecord(payload)) {
            throw worker.failure('BadRequest');
        }
        return Object.freeze({ payload, sources });
    },

    /**
     * @param {unknown} value
     * @return {value is Record<string, unknown>}
     */
    isRecord(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    },

    /**
     * @param {unknown} value
     * @param {ReadonlyArray<string>} names
     * @return {void}
     * @throws {Error}
     */
    checkKeys(value, names) {
        const exact = worker.isRecord(value) && Object.keys(value).length === names.length && names.every(
            /**
             * @param {string} name
             * @return {boolean}
             */
            (name) => Object.hasOwn(value, name)
        );
        if (!exact) {
            throw worker.failure('BadRequest');
        }
    },

    /**
     * @param {NumberSources} sources
     * @param {Record<string, unknown>} holder
     * @param {string} key
     * @return {number}
     * @throws {Error}
     */
    integerOf(sources, holder, key) {
        if (typeof holder[key] !== 'number') {
            throw worker.failure('BadRequest');
        }
        const source = sources.get(holder)?.get(key);
        if (typeof source !== 'string') {
            throw worker.failure('InternalError');
        }
        return worker.validateRevision(source);
    },

    /**
     * @param {Record<string, unknown>} payload
     * @param {NumberSources} sources
     * @return {Readonly<{ browser: string, kinds: ReadonlyArray<KindChange>, done: ReadonlyArray<string> }>}
     * @throws {Error}
     */
    commitInput(payload, sources) {
        worker.checkKeys(payload, worker.Bodies.Commit);
        const { kinds, done } = payload;
        const { MostKinds, MostAsks, MostParts } = worker.Limits;
        if (!Array.isArray(kinds) || kinds.length < 1 || kinds.length > MostKinds
            || !Array.isArray(done) || done.length > MostAsks) {
            throw worker.failure('BadRequest');
        }
        const changes = kinds.map(
            /**
             * @param {unknown} entry
             * @return {KindChange}
             */
            (entry) => {
                worker.checkKeys(entry, worker.Bodies.Change);
                const expectedRevision = worker.integerOf(sources, entry, 'expectedRevision');
                const revision = worker.integerOf(sources, entry, 'revision');
                const { digests } = entry;
                if (revision !== expectedRevision + 1 || !Array.isArray(digests)
                    || digests.length < 1 || digests.length > MostParts) {
                    throw worker.failure('BadRequest');
                }
                const named = digests.map(
                    /**
                     * @param {unknown} digest
                     * @return {string}
                     */
                    (digest) => {
                        if (typeof digest !== 'string' || !worker.DigestPattern.test(digest)) {
                            throw worker.failure('BadRequest');
                        }
                        return digest;
                    }
                );
                return Object.freeze({
                    kind: worker.validateKind(entry.kind), expectedRevision, revision, digests: Object.freeze(named),
                });
            }
        );
        const asks = done.map(worker.validateAskId);
        const named = new Set(changes.map(
            /**
             * @param {KindChange} change
             * @return {string}
             */
            (change) => change.kind
        ));
        if (named.size !== changes.length || new Set(asks).size !== asks.length) {
            throw worker.failure('BadRequest');
        }
        const browser = worker.validateBrowser(payload.browser);
        return Object.freeze({ browser, kinds: Object.freeze(changes), done: Object.freeze(asks) });
    },

    /**
     * @param {Record<string, unknown>} payload
     * @return {Readonly<{ browser: string, day: string, total: number }>}
     * @throws {Error}
     */
    spendInput(payload) {
        worker.checkKeys(payload, worker.Bodies.Spend);
        const { total } = payload;
        if (!Number.isFinite(total) || total < 0 || total > worker.Limits.MostSpent) {
            throw worker.failure('BadRequest');
        }
        return Object.freeze({
            browser: worker.validateBrowser(payload.browser), day: worker.validateDay(payload.day), total,
        });
    },

    /**
     * @param {Record<string, unknown>} payload
     * @return {Readonly<{ browser: string, want: string }>}
     * @throws {Error}
     */
    leaseInput(payload) {
        worker.checkKeys(payload, worker.Bodies.Lease);
        if (!Object.values(worker.Wants).includes(payload.want)) {
            throw worker.failure('BadRequest');
        }
        return Object.freeze({ browser: worker.validateBrowser(payload.browser), want: payload.want });
    },

    /**
     * @param {Record<string, unknown>} payload
     * @return {Readonly<{ browser: string, id: string, action: string }>}
     * @throws {Error}
     */
    askInput(payload) {
        worker.checkKeys(payload, worker.Bodies.Ask);
        const browser = worker.validateBrowser(payload.browser);
        const id = worker.validateAskId(payload.id);
        if (!worker.isRecord(payload.action)) {
            throw worker.failure('BadRequest');
        }
        const action = JSON.stringify(payload.action);
        if (new TextEncoder().encode(action).length > worker.Limits.AskBytes) {
            throw worker.failure('ScribeTooLarge');
        }
        return Object.freeze({ browser, id, action });
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
     * @param {object | string | null} payload
     * @param {number} status
     * @param {HeadersInit} [headers]
     * @param {string} [type]
     * @return {Response}
     */
    respond(payload, status, headers, type = worker.MediaTypes.JsonType) {
        const responseHeaders = new Headers(headers);
        responseHeaders.set('Content-Type', type);
        responseHeaders.set('Cache-Control', 'no-store');
        responseHeaders.set('X-Content-Type-Options', 'nosniff');
        const body = payload === null || type === worker.MediaTypes.TextType ? payload : JSON.stringify(payload);
        return new Response(body, { status, headers: responseHeaders });
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
     * @param {Counter} [counter]
     * @return {Promise<void>}
     * @throws {Error}
     */
    async claimRateSlot(db, nowMs, counter = worker.Counters.Notes) {
        const { MinuteMilliseconds, MinuteSeconds } = worker.Limits;
        const windowStart = Math.floor(nowMs / MinuteMilliseconds) * MinuteSeconds;
        const claimed = await worker.execute(db, counter.claim, [windowStart, worker.Limits[counter.capacity]]);
        if (claimed.length) {
            return;
        }

        const [active] = await worker.execute(db, counter.read, []);
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

    /**
     * @param {ReadonlyArray<Row>} rows
     * @return {ReadonlyArray<Head>}
     */
    headsOf(rows) {
        return Object.freeze(rows.map(
            /**
             * @param {Row} row
             * @return {Head}
             */
            ({ kind, revision, parts, updatedAt }) => Object.freeze({ kind, revision, parts, updatedAt })
        ));
    },

    /**
     * @param {ReadonlyArray<Row>} rows
     * @return {ReadonlyArray<Ask>}
     */
    asksOf(rows) {
        return Object.freeze(rows.map(
            /**
             * @param {Row} row
             * @return {Ask}
             */
            ({ id, browser, action, createdAt }) => Object.freeze({ id, browser, action, createdAt })
        ));
    },

    /**
     * @param {string} day
     * @param {Row} row
     * @return {Spent}
     */
    spentOf(day, row) {
        return Object.freeze({ day, sum: row.daySum, mine: row.mine });
    },

    /**
     * @param {Row | undefined} row
     * @param {number} nowMs
     * @return {Lease | null}
     */
    leaseView(row, nowMs) {
        if (!row || row.expiresAt <= nowMs) {
            return null;
        }
        const wanting = row.wanted !== null && row.wantedUntil > nowMs;
        return Object.freeze({
            browser: row.browser,
            expiresAt: row.expiresAt,
            wanted: wanting ? row.wanted : null,
            asked: wanting && row.asked === 1,
        });
    },

    /**
     * @param {Database} db
     * @param {Readonly<ScribeCommand>} command
     * @param {number} nowMs
     * @return {Promise<Readonly<object>>}
     * @throws {Error}
     */
    async loadScribe(db, command, nowMs) {
        const { roomId, browser, day } = command;
        const heads = await worker.execute(db, 'ReadScribeHeads', [roomId]);
        const [spent] = await worker.execute(db, 'ReadScribeSpent', [roomId, day, browser]);
        const [lease] = await worker.execute(db, 'ReadScribeLease', [roomId]);
        const asks = await worker.execute(db, 'ReadScribeAsks', [roomId, worker.Limits.MostAsks]);
        return Object.freeze({
            roomId,
            heads: worker.headsOf(heads),
            spent: worker.spentOf(day, spent),
            lease: worker.leaseView(lease, nowMs),
            asks: worker.asksOf(asks),
            now: nowMs,
        });
    },

    /**
     * @param {Database} db
     * @param {Readonly<ScribeCommand>} command
     * @return {Promise<string>}
     * @throws {Error}
     */
    async readPart(db, command) {
        const { roomId, target } = command;
        const [row] = await worker.execute(db, 'ReadScribePart', [roomId, target.kind, target.revision, target.part]);
        if (!row) {
            throw worker.failure('PartNotFound');
        }
        return row.text;
    },

    /**
     * @param {Database} db
     * @param {Readonly<ScribeCommand>} command
     * @param {number} nowMs
     * @return {Promise<StagedPart>}
     * @throws {Error}
     */
    async stagePart(db, command, nowMs) {
        const { roomId, target, browser, text, digest } = command;
        const values = [roomId, target.kind, target.revision, target.part, text, digest, browser, nowMs];
        const [row] = await worker.execute(db, 'StageScribePart', values);
        if (!row) {
            return worker.refusal(db, roomId, browser, nowMs, [
                Object.freeze({ kind: target.kind, expectedRevision: target.revision - 1 }),
            ]);
        }
        return Object.freeze({ kind: target.kind, revision: target.revision, part: row.part, digest: row.digest });
    },

    /**
     * @param {Database} db
     * @param {string} roomId
     * @param {string} browser
     * @param {number} nowMs
     * @param {ReadonlyArray<Readonly<{ kind: string, expectedRevision: number }>>} expected
     * @return {Promise<never>}
     * @throws {Error}
     */
    async refusal(db, roomId, browser, nowMs, expected) {
        const [row] = await worker.execute(db, 'ReadScribeLease', [roomId]);
        if (worker.leaseView(row, nowMs)?.browser !== browser) {
            throw worker.failure('LeaseLost');
        }
        const heads = await worker.execute(db, 'ReadScribeHeads', [roomId]);
        const revisions = new Map(heads.map(
            /**
             * @param {Row} head
             * @return {[string, number]}
             */
            (head) => [head.kind, head.revision]
        ));
        const conflicted = expected.some(
            /**
             * @param {Readonly<{ kind: string, expectedRevision: number }>} change
             * @return {boolean}
             */
            (change) => (revisions.get(change.kind) ?? 0) !== change.expectedRevision
        );
        if (conflicted) {
            throw worker.failure('ScribeConflict');
        }
        throw worker.failure('PartsMissing');
    },

    /**
     * @param {Database} db
     * @param {Readonly<ScribeCommand>} command
     * @param {string} updatedAt
     * @param {number} nowMs
     * @return {Promise<Readonly<{ heads: ReadonlyArray<Head> }>>}
     * @throws {Error}
     */
    async commitScribe(db, command, updatedAt, nowMs) {
        const { roomId, browser, kinds, done } = command;
        const values = [roomId, JSON.stringify(kinds), browser, updatedAt, nowMs];
        const rows = await worker.execute(db, 'CommitScribe', values);
        if (!rows.length) {
            return worker.refusal(db, roomId, browser, nowMs, kinds);
        }
        await worker.execute(db, 'SweepScribeParts', [roomId]);
        if (done.length) {
            await worker.execute(db, 'DropScribeAsks', [roomId, JSON.stringify(done)]);
        }
        return Object.freeze({ heads: worker.headsOf(rows) });
    },

    /**
     * @param {Database} db
     * @param {Readonly<ScribeCommand>} command
     * @return {Promise<Spent>}
     * @throws {Error}
     */
    async spendScribe(db, command) {
        const { roomId, day, browser, total } = command;
        await worker.execute(db, 'StoreScribeSpent', [roomId, day, browser, total]);
        const [row] = await worker.execute(db, 'ReadScribeSpent', [roomId, day, browser]);
        return worker.spentOf(day, row);
    },

    /**
     * @param {Database} db
     * @param {Readonly<ScribeCommand>} command
     * @param {number} nowMs
     * @return {Promise<Readonly<{ held: boolean, lease: Lease | null, asks: ReadonlyArray<Ask>, now: number }>>}
     * @throws {Error}
     */
    async leaseScribe(db, command, nowMs) {
        const { roomId, browser, want } = command;
        const { LeaseMs, WantMs, MostAsks } = worker.Limits;
        const [taken] = await worker.execute(db, 'TakeScribeLease', [roomId, browser, nowMs + LeaseMs, nowMs]);
        if (taken) {
            const asks = worker.asksOf(await worker.execute(db, 'ReadScribeAsks', [roomId, MostAsks]));
            return Object.freeze({ held: true, lease: worker.leaseView(taken, nowMs), asks, now: nowMs });
        }
        const asked = want === worker.Wants.Asked ? 1 : 0;
        const wanted = want === worker.Wants.None
            ? []
            : await worker.execute(db, 'WantScribeLease', [roomId, browser, nowMs + WantMs, nowMs, asked]);
        const [row] = wanted.length ? wanted : await worker.execute(db, 'ReadScribeLease', [roomId]);
        return Object.freeze({ held: false, lease: worker.leaseView(row, nowMs), asks: Object.freeze([]), now: nowMs });
    },

    /**
     * @param {Database} db
     * @param {Readonly<ScribeCommand>} command
     * @param {number} nowMs
     * @return {Promise<Readonly<{ released: boolean, lease: Lease | null, now: number }>>}
     * @throws {Error}
     */
    async releaseScribe(db, command, nowMs) {
        const { roomId, browser } = command;
        const values = [roomId, browser, nowMs + worker.Limits.LeaseMs, nowMs];
        const [passed] = await worker.execute(db, 'PassScribeLease', values);
        if (passed) {
            return Object.freeze({ released: true, lease: worker.leaseView(passed, nowMs), now: nowMs });
        }
        const [dropped] = await worker.execute(db, 'DropScribeLease', [roomId, browser]);
        if (dropped) {
            return Object.freeze({ released: true, lease: null, now: nowMs });
        }
        const [row] = await worker.execute(db, 'ReadScribeLease', [roomId]);
        return Object.freeze({ released: false, lease: worker.leaseView(row, nowMs), now: nowMs });
    },

    /**
     * @param {Database} db
     * @param {Readonly<ScribeCommand>} command
     * @param {number} nowMs
     * @return {Promise<Readonly<{ status: number, ask: Readonly<{ id: string }> }>>}
     * @throws {Error}
     */
    async askScribe(db, command, nowMs) {
        const { roomId, id, browser, action } = command;
        const values = [roomId, id, browser, action, nowMs, worker.Limits.MostAsks];
        const [added] = await worker.execute(db, 'AddScribeAsk', values);
        if (added) {
            return Object.freeze({ status: 201, ask: Object.freeze({ id: added.id }) });
        }
        const [found] = await worker.execute(db, 'FindScribeAsk', [roomId, id]);
        if (!found) {
            throw worker.failure('AsksFull');
        }
        return Object.freeze({ status: 200, ask: Object.freeze({ id: found.id }) });
    },
});

export default worker;
