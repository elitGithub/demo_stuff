import { createHash } from 'node:crypto';
import worker from '../../worker.mjs';

export default class FakeScribeWorker {
    static Origin = 'https://zeta-dm-memory.elit1989.workers.dev';

    static Key = 'Fictional-DM-Key-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ-abcdefghijkl';

    static JsonType = 'application/json; charset=utf-8';

    static TextType = 'text/plain; charset=utf-8';

    static Routes = Object.freeze({
        '/v1/scribe': Object.freeze({ GET: 'heads' }),
        '/v1/scribe/part': Object.freeze({ GET: 'readPart', PUT: 'stagePart' }),
        '/v1/scribe/commit': Object.freeze({ POST: 'commit' }),
        '/v1/scribe/spend': Object.freeze({ POST: 'spend' }),
        '/v1/scribe/lease': Object.freeze({ POST: 'lease', DELETE: 'release' }),
        '/v1/scribe/ask': Object.freeze({ POST: 'ask' }),
        '/v1/memory': Object.freeze({ GET: 'memory' }),
    });

    /**
     * @param {{ now: () => number }} clock
     * @param {string} [key]
     */
    constructor(clock, key = FakeScribeWorker.Key) {
        this.clock = clock;
        this.key = key;
        this.kinds = new Map();
        this.parts = new Map();
        this.spent = new Map();
        this.leases = new Map();
        this.asks = new Map();
        this.memories = new Map();
        this.log = [];
        this.scripted = [];
        this.mode = 'answer';
        this.held = [];
    }

    /**
     * @return {void}
     */
    silence() {
        this.mode = 'silent';
    }

    /**
     * @return {void}
     */
    fail() {
        this.mode = 'failing';
    }

    /**
     * @return {void}
     */
    speak() {
        this.mode = 'answer';
    }

    /**
     * @param {string} path
     * @param {number} status
     * @param {object|string|null} body
     * @param {boolean} [applied]
     * @param {string} [headers]
     * @return {void}
     */
    answer(path, status, body, applied = false, headers = '') {
        this.scripted.push({ path, status, body, applied, headers });
    }

    /**
     * @param {string} roomId
     * @param {string} kind
     * @param {number} revision
     * @param {string[]} pieces
     * @return {void}
     */
    seed(roomId, kind, revision, pieces) {
        const heads = this.kinds.get(roomId) ?? new Map();
        this.kinds.set(roomId, heads);
        heads.set(kind, { kind, revision, parts: pieces.length, updatedAt: new Date(this.clock.now()).toISOString() });
        pieces.forEach((text, part) => {
            const digest = createHash('sha256').update(text, 'utf8').digest('hex');
            this.parts.set(FakeScribeWorker.partKey(roomId, kind, revision, part), { text, digest });
        });
    }

    /**
     * @param {string} roomId
     * @param {string} browser
     * @return {void}
     */
    hold(roomId, browser) {
        const expiresAt = this.clock.now() + worker.Limits.LeaseMs;
        this.leases.set(roomId, { browser, expiresAt, wanted: null, wantedUntil: null, asked: 0 });
    }

    /**
     * @param {string} roomId
     * @param {string} notes
     * @return {void}
     */
    setNotes(roomId, notes) {
        this.memories.set(roomId, { roomId, notes, revision: 1, updatedAt: new Date(this.clock.now()).toISOString() });
    }

    /**
     * @param {string} path
     * @param {string} [method]
     * @return {object[]}
     */
    calls(path, method = null) {
        return this.log.filter((entry) => entry.path === path && (method === null || entry.method === method));
    }

    /**
     * @param {string} roomId
     * @param {string} kind
     * @return {string|null}
     */
    textOf(roomId, kind) {
        const head = this.kinds.get(roomId)?.get(kind) ?? null;
        if (head === null) {
            return null;
        }
        const pieces = [];
        for (let part = 0; part < head.parts; part++) {
            pieces.push(this.parts.get(FakeScribeWorker.partKey(roomId, kind, head.revision, part)).text);
        }
        return pieces.join('');
    }

    /**
     * @param {string} roomId
     * @param {string} kind
     * @return {number}
     */
    revisionOf(roomId, kind) {
        return this.kinds.get(roomId)?.get(kind)?.revision ?? 0;
    }

    /**
     * @param {string} roomId
     * @param {string} kind
     * @param {number} revision
     * @param {number} part
     * @return {string}
     */
    static partKey(roomId, kind, revision, part) {
        return JSON.stringify([roomId, kind, revision, part]);
    }

    /**
     * @param {string} name
     * @return {{ status: number, payload: object }}
     */
    static failure(name) {
        const error = worker.Errors[name];
        return { status: error.status, payload: { error: { code: error.code, message: error.message } } };
    }

    /**
     * @param {object} details
     * @return {{ abort: () => void }}
     */
    request(details) {
        const url = new URL(details.url);
        const query = Object.fromEntries(url.searchParams);
        const entry = {
            method: details.method,
            path: url.pathname,
            query,
            body: typeof details.data === 'string' ? details.data : null,
            headers: { ...details.headers },
            at: this.clock.now(),
        };
        this.log.push(entry);
        const call = { ended: false };
        const handle = {
            /**
             * @return {void}
             */
            abort: () => {
                if (!call.ended) {
                    call.ended = true;
                    details.onabort({ status: 0 });
                }
            },
        };
        if (this.mode === 'silent') {
            this.held.push(call);
            return handle;
        }
        if (this.mode === 'failing') {
            Promise.resolve().then(() => {
                if (!call.ended) {
                    call.ended = true;
                    details.onerror({ status: 0 });
                }
            });
            return handle;
        }
        let outcome = null;
        const index = this.scripted.findIndex((script) => script.path === url.pathname);
        if (index >= 0) {
            const [script] = this.scripted.splice(index, 1);
            if (script.applied) {
                this.handle(details, url, query);
            }
            outcome = { status: script.status, payload: script.body, headers: script.headers };
        } else {
            outcome = this.handle(details, url, query);
        }
        entry.status = outcome.status;
        const text = typeof outcome.payload === 'string' ? outcome.payload : JSON.stringify(outcome.payload);
        const type = typeof outcome.payload === 'string' ? FakeScribeWorker.TextType : FakeScribeWorker.JsonType;
        const headers = `content-type: ${type}\r\ncache-control: no-store\r\n${outcome.headers ?? ''}`;
        Promise.resolve().then(() => {
            if (call.ended) {
                return;
            }
            call.ended = true;
            details.onload({
                status: outcome.status, finalUrl: url.href, responseHeaders: headers, responseText: text,
            });
        });
        return handle;
    }

    /**
     * @param {object} details
     * @param {URL} url
     * @param {Object<string, string>} query
     * @return {{ status: number, payload: object|string }}
     */
    handle(details, url, query) {
        const authorization = details.headers?.Authorization ?? '';
        if (authorization !== `Bearer ${this.key}`) {
            return FakeScribeWorker.failure('Unauthorized');
        }
        const route = FakeScribeWorker.Routes[url.pathname];
        if (route === undefined) {
            return FakeScribeWorker.failure('NotFound');
        }
        if (!Object.hasOwn(route, details.method)) {
            return FakeScribeWorker.failure('MethodNotAllowed');
        }
        let body = null;
        if (typeof details.data === 'string' && details.method !== 'PUT') {
            try {
                body = JSON.parse(details.data);
            } catch {
                return FakeScribeWorker.failure('BadRequest');
            }
        }
        const now = this.clock.now();
        return this[route[details.method]]({ query, body, text: details.data ?? null, now });
    }

    /**
     * @param {object|undefined} row
     * @param {number} now
     * @return {object|null}
     */
    static leaseView(row, now) {
        if (row === undefined || row.expiresAt <= now) {
            return null;
        }
        const wanting = row.wanted !== null && row.wantedUntil > now;
        return {
            browser: row.browser,
            expiresAt: row.expiresAt,
            wanted: wanting ? row.wanted : null,
            asked: wanting && row.asked === 1,
        };
    }

    /**
     * @param {string} roomId
     * @return {object[]}
     */
    headsOf(roomId) {
        const heads = [...(this.kinds.get(roomId)?.values() ?? [])];
        heads.sort((one, other) => (one.kind < other.kind ? -1 : one.kind > other.kind ? 1 : 0));
        return heads.map(({ kind, revision, parts, updatedAt }) => ({ kind, revision, parts, updatedAt }));
    }

    /**
     * @param {string} roomId
     * @return {object[]}
     */
    asksOf(roomId) {
        const asks = [...(this.asks.get(roomId) ?? [])];
        asks.sort((one, other) => one.createdAt - other.createdAt || (one.id < other.id ? -1 : one.id > other.id ? 1 : 0));
        return asks
            .slice(0, worker.Limits.MostAsks)
            .map(({ id, browser, action, createdAt }) => ({ id, browser, action, createdAt }));
    }

    /**
     * @param {string} roomId
     * @param {string} day
     * @param {string} browser
     * @return {{ day: string, sum: number, mine: number }}
     */
    spentOf(roomId, day, browser) {
        let sum = 0;
        let mine = 0;
        for (const [key, total] of this.spent) {
            const [room, spentDay, spender] = JSON.parse(key);
            if (room === roomId && spentDay === day) {
                sum += total;
                if (spender === browser) {
                    mine += total;
                }
            }
        }
        return { day, sum, mine };
    }

    /**
     * @param {string} roomId
     * @param {string} browser
     * @param {number} now
     * @param {Array<{ kind: string, expectedRevision: number }>} expected
     * @return {{ status: number, payload: object }}
     */
    refusal(roomId, browser, now, expected) {
        if (FakeScribeWorker.leaseView(this.leases.get(roomId), now)?.browser !== browser) {
            return FakeScribeWorker.failure('LeaseLost');
        }
        const conflicted = expected.some((change) => this.revisionOf(roomId, change.kind) !== change.expectedRevision);
        return FakeScribeWorker.failure(conflicted ? 'ScribeConflict' : 'PartsMissing');
    }

    /**
     * @param {string} roomId
     * @param {string} browser
     * @param {number} now
     * @return {boolean}
     */
    holds(roomId, browser, now) {
        const row = this.leases.get(roomId);
        return row !== undefined && row.browser === browser && row.expiresAt > now;
    }

    /**
     * @param {{ query: object, now: number }} request
     * @return {{ status: number, payload: object }}
     */
    heads({ query, now }) {
        const roomId = query.roomId;
        return {
            status: 200,
            payload: {
                roomId,
                heads: this.headsOf(roomId),
                spent: this.spentOf(roomId, query.day, query.browser),
                lease: FakeScribeWorker.leaseView(this.leases.get(roomId), now),
                asks: this.asksOf(roomId),
                now,
            },
        };
    }

    /**
     * @param {{ query: object }} request
     * @return {{ status: number, payload: object|string }}
     */
    readPart({ query }) {
        const revision = Number(query.revision);
        const part = Number(query.part);
        const head = this.kinds.get(query.roomId)?.get(query.kind) ?? null;
        const stored = this.parts.get(FakeScribeWorker.partKey(query.roomId, query.kind, revision, part));
        if (head === null || head.revision !== revision || part >= head.parts || stored === undefined) {
            return FakeScribeWorker.failure('PartNotFound');
        }
        return { status: 200, payload: stored.text };
    }

    /**
     * @param {{ query: object, text: string|null, now: number }} request
     * @return {{ status: number, payload: object }}
     */
    stagePart({ query, text, now }) {
        const roomId = query.roomId;
        const revision = Number(query.revision);
        const part = Number(query.part);
        if (typeof text !== 'string' || text === '') {
            return FakeScribeWorker.failure('BadRequest');
        }
        if (text.length > worker.Limits.PartCharacters) {
            return FakeScribeWorker.failure('ScribeTooLarge');
        }
        if (!this.holds(roomId, query.browser, now) || this.revisionOf(roomId, query.kind) >= revision) {
            return this.refusal(roomId, query.browser, now, [{ kind: query.kind, expectedRevision: revision - 1 }]);
        }
        const digest = createHash('sha256').update(text, 'utf8').digest('hex');
        this.parts.set(FakeScribeWorker.partKey(roomId, query.kind, revision, part), { text, digest });
        return { status: 200, payload: { kind: query.kind, revision, part, digest } };
    }

    /**
     * @param {{ query: object, body: object, now: number }} request
     * @return {{ status: number, payload: object }}
     */
    commit({ query, body, now }) {
        const roomId = query.roomId;
        const { browser, kinds, done } = body;
        const staged = kinds.every((change) =>
            change.digests.every((digest, part) => {
                const key = FakeScribeWorker.partKey(roomId, change.kind, change.revision, part);
                return this.parts.get(key)?.digest === digest;
            }),
        );
        const matching = kinds.every((change) => this.revisionOf(roomId, change.kind) === change.expectedRevision);
        if (!this.holds(roomId, browser, now) || !matching || !staged) {
            return this.refusal(roomId, browser, now, kinds);
        }
        const heads = this.kinds.get(roomId) ?? new Map();
        this.kinds.set(roomId, heads);
        const updatedAt = new Date(now).toISOString();
        const rows = [];
        for (const change of kinds) {
            const head = { kind: change.kind, revision: change.revision, parts: change.digests.length, updatedAt };
            heads.set(change.kind, head);
            rows.push({ ...head });
        }
        for (const key of [...this.parts.keys()]) {
            const [room, kind, revision, part] = JSON.parse(key);
            const head = heads.get(kind);
            if (room === roomId && (head === undefined || head.revision !== revision || part >= head.parts)) {
                this.parts.delete(key);
            }
        }
        if (done.length > 0) {
            this.asks.set(roomId, (this.asks.get(roomId) ?? []).filter((ask) => !done.includes(ask.id)));
        }
        return { status: 200, payload: { heads: rows } };
    }

    /**
     * @param {{ query: object, body: object }} request
     * @return {{ status: number, payload: object }}
     */
    spend({ query, body }) {
        const key = JSON.stringify([query.roomId, body.day, body.browser]);
        if (!this.spent.has(key) || body.total > this.spent.get(key)) {
            this.spent.set(key, body.total);
        }
        return { status: 200, payload: this.spentOf(query.roomId, body.day, body.browser) };
    }

    /**
     * @param {{ query: object, body: object, now: number }} request
     * @return {{ status: number, payload: object }}
     */
    lease({ query, body, now }) {
        const roomId = query.roomId;
        const { browser, want } = body;
        const limits = worker.Limits;
        const row = this.leases.get(roomId);
        if (row === undefined || row.browser === browser || row.expiresAt <= now) {
            const fresh = row ?? { wanted: null, wantedUntil: null, asked: 0 };
            const clear = fresh.wanted === browser || (fresh.wantedUntil !== null && fresh.wantedUntil <= now);
            const taken = {
                browser,
                expiresAt: now + limits.LeaseMs,
                wanted: clear ? null : fresh.wanted,
                wantedUntil: clear ? null : fresh.wantedUntil,
                asked: clear ? 0 : fresh.asked,
            };
            this.leases.set(roomId, taken);
            const view = FakeScribeWorker.leaseView(taken, now);
            return { status: 200, payload: { held: true, lease: view, asks: this.asksOf(roomId), now } };
        }
        if (want !== 'None' && row.expiresAt > now) {
            const asked = want === 'Asked' ? 1 : row.wanted === browser && row.wantedUntil > now ? row.asked : 0;
            row.wanted = browser;
            row.wantedUntil = now + limits.WantMs;
            row.asked = asked;
        }
        return { status: 200, payload: { held: false, lease: FakeScribeWorker.leaseView(row, now), asks: [], now } };
    }

    /**
     * @param {{ query: object, now: number }} request
     * @return {{ status: number, payload: object }}
     */
    release({ query, now }) {
        const roomId = query.roomId;
        const row = this.leases.get(roomId);
        if (row !== undefined && row.browser === query.browser && row.wanted !== null && row.wantedUntil > now) {
            const expiresAt = now + worker.Limits.LeaseMs;
            const passed = { browser: row.wanted, expiresAt, wanted: null, wantedUntil: null, asked: 0 };
            this.leases.set(roomId, passed);
            return { status: 200, payload: { released: true, lease: FakeScribeWorker.leaseView(passed, now), now } };
        }
        if (row !== undefined && row.browser === query.browser) {
            this.leases.delete(roomId);
            return { status: 200, payload: { released: true, lease: null, now } };
        }
        return { status: 200, payload: { released: false, lease: FakeScribeWorker.leaseView(row, now), now } };
    }

    /**
     * @param {{ query: object, body: object, now: number }} request
     * @return {{ status: number, payload: object }}
     */
    ask({ query, body, now }) {
        const asks = this.asks.get(query.roomId) ?? [];
        this.asks.set(query.roomId, asks);
        if (asks.some((ask) => ask.id === body.id)) {
            return { status: 200, payload: { id: body.id } };
        }
        if (asks.length >= worker.Limits.MostAsks) {
            return FakeScribeWorker.failure('AsksFull');
        }
        asks.push({ id: body.id, browser: body.browser, action: JSON.stringify(body.action), createdAt: now });
        return { status: 201, payload: { id: body.id } };
    }

    /**
     * @param {{ query: object }} request
     * @return {{ status: number, payload: object }}
     */
    memory({ query }) {
        const memory = this.memories.get(query.roomId);
        if (memory === undefined) {
            return FakeScribeWorker.failure('MemoryNotFound');
        }
        return { status: 200, payload: { ...memory } };
    }
}
