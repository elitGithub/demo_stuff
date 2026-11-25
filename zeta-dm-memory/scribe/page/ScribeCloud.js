const ScribeCloud = Object.freeze({
    Phase: Object.freeze({
        Off: 'Off',
        Idle: 'Idle',
        Loading: 'Loading',
        Leading: 'Leading',
        Watching: 'Watching',
        Offline: 'Offline',
        Refused: 'Refused',
        Unusable: 'Unusable',
        Conflict: 'Conflict',
    }),

    Answer: Object.freeze({
        Keep: 'Keep',
        Cloud: 'Cloud',
    }),

    Settings: Object.freeze({
        Origin: 'https://zeta-dm-memory.elit1989.workers.dev',
        Paths: Object.freeze({
            Heads: '/v1/scribe',
            Part: '/v1/scribe/part',
            Commit: '/v1/scribe/commit',
            Spend: '/v1/scribe/spend',
            Lease: '/v1/scribe/lease',
            Notes: '/v1/memory',
        }),
        RoomPrefix: '/rooms/',
        Synced: Object.freeze([ScribeStore.Kind.Settings, ScribeStore.Kind.Book, ScribeStore.Kind.Live]),

        /**
         * @return {string[]}
         */
        get Leads() {
            const phases = ScribeCloud.Phase;
            return [phases.Off, phases.Leading, phases.Offline, phases.Refused, phases.Unusable];
        },

        /**
         * @return {string[]}
         */
        get Renewing() {
            const phases = ScribeCloud.Phase;
            return [phases.Leading, phases.Watching, phases.Conflict];
        },

        /**
         * @return {string[]}
         */
        get Reaching() {
            const phases = ScribeCloud.Phase;
            return [phases.Leading, phases.Watching, phases.Conflict, phases.Unusable];
        },

        /**
         * @return {string[]}
         */
        get Settled() {
            const phases = ScribeCloud.Phase;
            return [phases.Offline, phases.Watching];
        },

        /**
         * @return {string[]}
         */
        get Dropped() {
            const phases = ScribeCloud.Phase;
            return [phases.Leading, phases.Offline];
        },

        /**
         * @return {string[]}
         */
        get Stepping() {
            const phases = ScribeCloud.Phase;
            return [phases.Loading, phases.Leading];
        },
        PartCharacters: 400000,
        MostParts: 10,
        RoomBytes: 512,
        TimeoutMs: 15000,
        PartTimeoutMs: 60000,
        OpenMs: 15000,
        QuietMs: 2000,
        RenewMs: 20000,
        LeaseMs: 90000,
        LastTryMs: 1000,
        BackoffMs: Object.freeze([1000, 2000, 4000, 8000, 16000]),
        MostRetryMs: 60000,
        NotesEveryMs: 300000,
        NotesLongest: 4000,
        MostSettles: 2,
        KeyShortest: 60,
        KeyLongest: 254,

        /**
         * @return {RegExp}
         */
        get KeyPattern() {
            return /^[!-~]+$/;
        },

        /**
         * @return {RegExp}
         */
        get RoomRefused() {
            return /[\p{White_Space}\p{Cc}﻿\uD800-\uDFFF\\?#]/u;
        },

        /**
         * @return {RegExp}
         */
        get RetryAfter() {
            return /^retry-after:[ \t]*(\d+)[ \t]*\r?$/im;
        },

        /**
         * @return {RegExp}
         */
        get PartStartRefused() {
            return /^[\uDC00-\uDFFF﻿]$/;
        },
        Wants: Object.freeze({ None: 'None', Waiting: 'Waiting', Asked: 'Asked' }),
        Codes: Object.freeze({
            LeaseLost: 'lease_lost',
            Conflict: 'revision_conflict',
            PartsMissing: 'parts_missing',
            NoNotes: 'memory_not_found',
            Configuration: 'configuration_error',
        }),
        Transport: Object.freeze({ Network: 0, Rejected: -1, Cancelled: -2 }),
        Statuses: Object.freeze({
            Ok: 200,
            Created: 201,
            Redirect: 300,
            Client: 400,
            Unauthorized: 401,
            NotFound: 404,
            Conflict: 409,
            Limited: 429,
            Server: 500,
        }),
        Methods: Object.freeze({ Get: 'GET', Put: 'PUT', Post: 'POST' }),
        ContentTypes: Object.freeze({ Json: 'application/json', Text: 'text/plain; charset=utf-8' }),
        Headers: Object.freeze({ Authorization: 'Authorization', ContentType: 'Content-Type' }),
        Bearer: 'Bearer ',
        ResponseType: 'text',
        Redirect: 'error',
        Menu: 'Set DM API key',
        Prompt: 'Enter DM API key',
        BadKey: 'Enter 60–254 visible ASCII characters.',
        Messages: Object.freeze({
            BadRoom: "This chat's ID cannot be used as a room in your Worker",
            TooLarge: 'The book is too large to keep in your Worker',
            Unreadable: 'What your Worker holds for this chat could not be read',
            Elsewhere: "Another PC is reading this chat; this PC's book is kept as soon as it lets go.",
            NoChoice: 'There is nothing to choose.',
            Busy: 'The last request of this kind has not finished yet',
            Unreachable: 'Your Worker could not be reached; try again.',
            Refused: 'Your Worker refused the request: ',
            Rejected: 'An answer did not come straight from your Worker',
        }),
        LineBreak: '\n',
        CarriageReturn: '\r',
        SendingType: 'sending',
        Forever: Number.POSITIVE_INFINITY,
        Nothing: '',
        FirstEpoch: 0,
        FirstRound: 0,
        FirstPart: 0,
        NoRevision: 0,
        NoGeneration: 0,
        NoSpending: 0,
        NoCount: 0,
        NoDelay: 0,
        Next: 1,
        MillisecondsPerSecond: 1000,
        StringType: 'string',
        ObjectType: 'object',
    }),

    /**
     * @param {*} value
     * @return {boolean}
     */
    validKey(value) {
        const settings = ScribeCloud.Settings;
        return (
            typeof value === settings.StringType &&
            value.length >= settings.KeyShortest &&
            value.length <= settings.KeyLongest &&
            settings.KeyPattern.test(value)
        );
    },

    /**
     * @param {*} roomId
     * @return {string|null}
     */
    room(roomId) {
        const settings = ScribeCloud.Settings;
        if (typeof roomId !== settings.StringType) {
            return null;
        }
        const room = `${settings.RoomPrefix}${roomId}`;
        if (settings.RoomRefused.test(room) || new TextEncoder().encode(room).length > settings.RoomBytes) {
            return null;
        }
        return room;
    },

    /**
     * @param {*} error
     * @return {string}
     */
    words(error) {
        const settings = ScribeCloud.Settings;
        const described =
            error !== null && typeof error === settings.ObjectType && typeof error.message === settings.StringType;
        return described ? error.message : String(error);
    },

    /**
     * @param {{ status: number }} result
     * @return {boolean}
     */
    ok(result) {
        const statuses = ScribeCloud.Settings.Statuses;
        return result.status === statuses.Ok || result.status === statuses.Created;
    },

    /**
     * @param {{ data: * }} result
     * @return {string|null}
     */
    code(result) {
        const code = result.data?.error?.code;
        return typeof code === ScribeCloud.Settings.StringType ? code : null;
    },

    /**
     * @param {object} cloud
     * @param {string} method
     * @param {string} path
     * @param {Object<string, string|number>} query
     * @param {string|object|null} body
     * @param {number} timeoutMs
     * @param {AbortSignal|null} signal
     * @return {Promise<{ status: number, data: *, text: string, retryAfter: number, transportProblem: string|null }>}
     */
    request(cloud, method, path, query, body, timeoutMs, signal = null) {
        const settings = ScribeCloud.Settings;
        const transport = settings.Transport;
        const statuses = settings.Statuses;
        const epoch = cloud.epoch;
        const key = ScribeStore.cloudKey(cloud.storage);
        const url = new URL(path, settings.Origin);
        url.search = new URLSearchParams(query).toString();
        return new Promise(
            /**
             * @param {Function} resolve
             * @return {void}
             */
            (resolve) => {
                if (!ScribeCloud.validKey(key)) {
                    resolve({
                        status: statuses.Unauthorized,
                        data: null,
                        text: settings.Nothing,
                        retryAfter: settings.NoDelay,
                        transportProblem: key ? 'The DM API key saved on this PC has an invalid format.' : 'No DM API key is saved on this PC.',
                    });
                    return;
                }
                let finished = false;
                let handle = null;

                /**
                 * @param {number} status
                 * @param {*} data
                 * @param {string} text
                 * @param {number} retryAfter
                 * @param {string|null} transportProblem
                 * @return {void}
                 */
                const finish = (status, data, text, retryAfter, transportProblem = null) => {
                    if (finished) {
                        return;
                    }
                    finished = true;
                    signal?.removeEventListener('abort', abort);
                    resolve({ status, data, text, retryAfter, transportProblem });
                };

                /**
                 * @param {number} status
                 * @param {string|null} transportProblem
                 * @return {void}
                 */
                const fail = (status, transportProblem = null) => {
                    finish(status, null, settings.Nothing, settings.NoDelay, transportProblem);
                };
                const abort = () => {
                    fail(transport.Cancelled);
                    handle?.abort?.();
                };
                if (signal?.aborted) {
                    abort();
                    return;
                }
                signal?.addEventListener('abort', abort, { once: true });
                const headers = { [settings.Headers.Authorization]: `${settings.Bearer}${key}` };
                const details = {
                    method,
                    url: url.href,
                    headers,
                    anonymous: true,
                    redirect: settings.Redirect,
                    responseType: settings.ResponseType,
                    timeout: timeoutMs,

                    /**
                     * @param {{ status: number, finalUrl: *, responseHeaders: *, responseText: * }} response
                     * @return {void}
                     */
                    onload: (response) => {
                        if (cloud.epoch !== epoch) {
                            fail(transport.Cancelled);
                            return;
                        }
                        try {
                            const status = response.status;
                            if (
                                new URL(response.finalUrl).href !== url.href ||
                                (status >= statuses.Redirect && status < statuses.Client)
                            ) {
                                fail(transport.Rejected);
                                return;
                            }
                            const received = String(response.responseHeaders ?? settings.Nothing);
                            const retryHeader = settings.RetryAfter.exec(received);
                            const asked =
                                retryHeader === null
                                    ? settings.NoDelay
                                    : Number(retryHeader[1]) * settings.MillisecondsPerSecond;
                            const retryAfter = Math.min(asked, settings.MostRetryMs);
                            const text =
                                typeof response.responseText === settings.StringType
                                    ? response.responseText
                                    : settings.Nothing;
                            let data = null;
                            try {
                                data = JSON.parse(text);
                            } catch {
                                data = null;
                            }
                            finish(status, data, text, retryAfter);
                        } catch {
                            fail(transport.Rejected);
                        }
                    },

                    /**
                     * @return {void}
                     */
                    onerror: () => {
                        fail(transport.Network);
                    },

                    /**
                     * @return {void}
                     */
                    ontimeout: () => {
                        fail(transport.Network, 'The Worker request timed out.');
                    },

                    /**
                     * @return {void}
                     */
                    onabort: () => {
                        fail(transport.Network, 'The Worker request was cancelled.');
                    },
                };
                if (typeof body === settings.StringType) {
                    headers[settings.Headers.ContentType] = settings.ContentTypes.Text;
                    details.data = body;
                } else if (body !== null) {
                    headers[settings.Headers.ContentType] = settings.ContentTypes.Json;
                    details.data = JSON.stringify(body);
                }
                cloud.later(
                    timeoutMs,
                    /**
                     * @return {void}
                     */
                    () => {
                        fail(transport.Network, 'The Worker request timed out.');
                        try {
                            handle?.abort?.();
                        } catch {
                            return;
                        }
                    },
                );
                try {
                    handle = cloud.xmlHttpRequest(details);
                } catch {
                    fail(transport.Network);
                }
            },
        );
    },

    /**
     * @param {object} cloud
     * @param {{ status: number, data: *, retryAfter: number }} result
     * @return {void}
     */
    failed(cloud, result, lookup = false) {
        const settings = ScribeCloud.Settings;
        const statuses = settings.Statuses;
        const transport = settings.Transport;
        const phases = ScribeCloud.Phase;
        const code = ScribeCloud.code(result);
        if (result.status === transport.Cancelled) {
            return;
        }
        if (lookup && !cloud.lookupFailed && cloud.phase === phases.Watching) {
            cloud.lookupFailed = true;
            cloud.notify();
        }
        const lapsed = ScribeCloud.lapsed(cloud, cloud.clock.now());
        if (!lapsed && (result.status === statuses.Unauthorized || code === settings.Codes.Configuration)) {
            cloud.phase = phases.Refused;
            cloud.notify();
            return;
        }
        const passing =
            result.status === transport.Network ||
            result.status === statuses.Limited ||
            result.status >= statuses.Server;
        if (!passing) {
            const refused = `${settings.Messages.Refused}${code ?? result.status}`;
            cloud.problem = result.status === transport.Rejected ? settings.Messages.Rejected : refused;
            cloud.opening = false;
        }
        ScribeCloud.fallen(cloud, result.status === statuses.Limited ? result.retryAfter : settings.NoDelay);
    },

    /**
     * @param {object} cloud
     * @param {number} waited
     * @return {void}
     */
    fallen(cloud, waited) {
        const settings = ScribeCloud.Settings;
        const phases = ScribeCloud.Phase;
        if (ScribeCloud.lapsed(cloud, cloud.clock.now())) {
            ScribeCloud.record(cloud, ScribeCloud.enter(cloud, waited));
            return;
        }
        const opening = cloud.opening && cloud.phase === phases.Loading;
        if (!opening || !cloud.owed || waited > settings.NoDelay) {
            ScribeCloud.backOff(cloud, waited);
        }
        if (opening) {
            ScribeCloud.record(cloud, ScribeCloud.resume(cloud));
            return;
        }
        if (settings.Stepping.includes(cloud.phase)) {
            cloud.phase = phases.Offline;
            cloud.notify();
        }
    },

    /**
     * @param {object} cloud
     * @param {Promise<void>} work
     * @return {void}
     */
    record(cloud, work) {
        work.catch(
            /**
             * @param {*} error
             * @return {void}
             */
            (error) => {
                cloud.problem = ScribeCloud.words(error);
            },
        );
    },

    /**
     * @param {object} cloud
     * @param {number} waited
     * @return {void}
     */
    backOff(cloud, waited) {
        const settings = ScribeCloud.Settings;
        const backoff = settings.BackoffMs[cloud.retries] ?? settings.NoDelay;
        const now = cloud.clock.now();
        cloud.retries = Math.min(cloud.retries + settings.Next, settings.BackoffMs.length);
        cloud.backedAt = now;
        cloud.retryAt = now + Math.max(backoff, waited);
        if (waited > settings.NoDelay) {
            cloud.limitedUntil = now + waited;
        }
    },

    /**
     * @param {number} now
     * @param {number} at
     * @return {number}
     */
    elapsed(now, at) {
        return now >= at ? now - at : ScribeCloud.Settings.Forever;
    },

    /**
     * @param {object} cloud
     * @param {number} now
     * @return {boolean}
     */
    lapsed(cloud, now) {
        const settings = ScribeCloud.Settings;
        return cloud.phase === ScribeCloud.Phase.Leading && ScribeCloud.elapsed(now, cloud.heldAt) >= settings.LeaseMs;
    },

    /**
     * @param {object} cloud
     * @param {number} waited
     * @return {Promise<void>}
     * @throws {Error}
     */
    enter(cloud, waited) {
        const settings = ScribeCloud.Settings;
        cloud.renewal++;
        cloud.renewing = false;
        ScribeCloud.loading(cloud);
        cloud.opening = true;
        cloud.switchAt = cloud.clock.now() + settings.OpenMs;
        cloud.retries = settings.NoCount;
        cloud.retryAt = null;
        if (waited > settings.NoDelay) {
            ScribeCloud.backOff(cloud, waited);
        }
        return ScribeCloud.resume(cloud);
    },

    /**
     * @param {object} cloud
     * @return {Promise<void>}
     * @throws {Error}
     */
    resume(cloud) {
        const settings = ScribeCloud.Settings;
        const now = cloud.clock.now();
        if (!cloud.opening || cloud.phase !== ScribeCloud.Phase.Loading || now >= cloud.switchAt) {
            return Promise.resolve();
        }
        if (cloud.flying) {
            cloud.owed = true;
            return Promise.resolve();
        }
        const first = settings.BackoffMs[settings.NoCount];
        const cut = cloud.switchAt - settings.LastTryMs;
        const spaced = cloud.backedAt === null || ScribeCloud.elapsed(now, cloud.backedAt) >= first;
        const limited = cloud.limitedUntil !== null && now < cloud.limitedUntil && now >= cloud.backedAt;
        if (spaced && !limited && (ScribeCloud.due(cloud, now) || now >= cut)) {
            return ScribeCloud.begin(cloud);
        }
        const dueAt = cloud.retryAt === null ? now : cloud.retryAt;
        const spacedAt = spaced ? now : cloud.backedAt + first;
        const limitedAt = limited ? cloud.limitedUntil : now;
        const at = Math.max(Math.min(dueAt, cut), spacedAt, limitedAt);
        const epoch = cloud.epoch;
        cloud.waits++;
        const wait = cloud.waits;
        cloud.later(
            at - now,
            /**
             * @return {void}
             */
            () => {
                if (cloud.epoch === epoch && cloud.waits === wait) {
                    ScribeCloud.record(cloud, ScribeCloud.resume(cloud));
                }
            },
        );
        return Promise.resolve();
    },

    /**
     * @param {object} cloud
     * @return {boolean}
     */
    leads(cloud) {
        return ScribeCloud.Settings.Leads.includes(cloud.phase) && !ScribeCloud.lapsed(cloud, cloud.clock.now());
    },

    /**
     * @param {object} cloud
     * @return {string[]}
     * @throws {Error}
     */
    unsent(cloud) {
        const synced = ScribeStore.synced(cloud.storage, cloud.roomId);
        const noGeneration = ScribeCloud.Settings.NoGeneration;
        return ScribeCloud.Settings.Synced.filter(
            /**
             * @param {string} kind
             * @return {boolean}
             */
            (kind) => {
                const generation = ScribeStore.generation(cloud.storage, cloud.roomId, kind);
                const recorded = Object.hasOwn(synced, kind) ? synced[kind].generation : noGeneration;
                return generation !== null && generation > noGeneration && generation !== recorded;
            },
        );
    },

    /**
     * @param {object} cloud
     * @return {string}
     * @throws {Error}
     */
    sentName(cloud) {
        return ScribeStore.name(ScribeCloud.Settings.SendingType, ScribeStore.room(cloud.roomId));
    },

    /**
     * @param {object} cloud
     * @param {string} key
     * @return {void}
     */
    restart(cloud, key) {
        const phases = ScribeCloud.Phase;
        cloud.epoch++;
        cloud.key = key;
        cloud.phase = key === ScribeCloud.Settings.Nothing ? phases.Off : phases.Idle;
        cloud.heads = new Map();
        cloud.checkedHeads = false;
        cloud.lookupFailed = false;
        cloud.held = false;
        cloud.heldAt = null;
        cloud.renewal = ScribeCloud.Settings.NoCount;
        cloud.opening = false;
        cloud.switchAt = null;
        cloud.owed = false;
        cloud.waits = ScribeCloud.Settings.NoCount;
        cloud.limitedUntil = null;
        cloud.answered = false;
        cloud.loads = ScribeCloud.Settings.NoCount;
        cloud.garbled = false;
        cloud.spoiled = new Map();
        cloud.texts = new Map();
        cloud.again = false;
        cloud.timer = false;
        cloud.flying = false;
        cloud.renewing = false;
        cloud.spending = false;
        cloud.noting = false;
        cloud.leaseAt = null;
        cloud.retryAt = null;
        cloud.backedAt = null;
        cloud.retries = ScribeCloud.Settings.NoCount;
        cloud.sent = null;
        cloud.notes = null;
        cloud.checkedNotes = false;
        cloud.notesAt = null;
        cloud.conflict = null;
        cloud.problem = null;
    },

    /**
     * @param {object} cloud
     * @param {number} at
     * @return {boolean}
     */
    due(cloud, at) {
        return cloud.retryAt === null || at >= cloud.retryAt || at < cloud.backedAt;
    },

    /**
     * @param {object} cloud
     * @return {Promise<void>}
     * @throws {Error}
     */
    tick(cloud) {
        const phases = ScribeCloud.Phase;
        const settings = ScribeCloud.Settings;
        if (cloud.closed) {
            return Promise.resolve();
        }
        const key = ScribeStore.cloudKey(cloud.storage);
        if (key !== cloud.key) {
            ScribeCloud.restart(cloud, key);
        }
        if (cloud.phase === phases.Off) {
            return Promise.resolve();
        }
        if (!cloud.chosen()) {
            if (cloud.phase !== phases.Idle) {
                ScribeCloud.restart(cloud, key);
            }
            return Promise.resolve();
        }
        const now = cloud.clock.now();
        const work = [];
        if (cloud.phase === phases.Idle || ScribeCloud.lapsed(cloud, now)) {
            work.push(ScribeCloud.enter(cloud, settings.NoDelay));
        } else if (cloud.phase === phases.Offline && !cloud.flying && ScribeCloud.due(cloud, now)) {
            work.push(ScribeCloud.begin(cloud));
        } else if (cloud.again && !cloud.flying && !cloud.reader()) {
            cloud.again = false;
            work.push(ScribeCloud.reload(cloud));
        } else if (settings.Renewing.includes(cloud.phase) && !cloud.renewing && ScribeCloud.due(cloud, now)) {
            if (cloud.leaseAt === null || ScribeCloud.elapsed(now, cloud.leaseAt) >= settings.RenewMs) {
                work.push(ScribeCloud.renew(cloud));
            }
        }
        work.push(ScribeCloud.stir(cloud));
        if (cloud.answered && settings.Reaching.includes(cloud.phase) && ScribeCloud.due(cloud, now)) {
            work.push(ScribeCloud.spend(cloud));
            work.push(ScribeCloud.readNotes(cloud));
        }
        return Promise.all(work).then(
            /**
             * @return {void}
             */
            () => undefined,
        );
    },

    /**
     * @param {object} cloud
     * @return {Promise<void>}
     * @throws {Error}
     */
    stir(cloud) {
        const phases = ScribeCloud.Phase;
        const settings = ScribeCloud.Settings;
        if (cloud.closed || cloud.phase === phases.Off || cloud.phase === phases.Idle) {
            return Promise.resolve();
        }
        const now = cloud.clock.now();
        for (const kind of settings.Synced) {
            const generation = ScribeStore.generation(cloud.storage, cloud.roomId, kind);
            if (cloud.seen.has(kind) && cloud.seen.get(kind) !== generation) {
                cloud.changedAt = now;
            }
            cloud.seen.set(kind, generation);
        }
        if (cloud.phase !== phases.Leading || cloud.timer || cloud.flying) {
            return Promise.resolve();
        }
        if (ScribeCloud.unsent(cloud).length === settings.NoCount) {
            return Promise.resolve();
        }
        const quiet = cloud.changedAt === null ? settings.QuietMs : ScribeCloud.elapsed(now, cloud.changedAt);
        if (quiet >= settings.QuietMs) {
            return ScribeCloud.push(cloud, false);
        }
        const epoch = cloud.epoch;
        cloud.timer = true;
        cloud.later(
            settings.QuietMs - quiet,
            /**
             * @return {void}
             */
            () => {
                if (cloud.epoch !== epoch) {
                    return;
                }
                cloud.timer = false;
                ScribeCloud.stir(cloud).catch(
                    /**
                     * @param {*} error
                     * @return {void}
                     */
                    (error) => {
                        cloud.problem = ScribeCloud.words(error);
                    },
                );
            },
        );
        return Promise.resolve();
    },

    /**
     * @param {object} cloud
     * @param {() => Promise<void>} work
     * @return {Promise<boolean>}
     * @throws {Error}
     */
    async fly(cloud, work) {
        if (cloud.flying) {
            return false;
        }
        const epoch = cloud.epoch;
        cloud.flying = true;
        try {
            await work();
        } catch (error) {
            if (cloud.epoch === epoch) {
                cloud.problem = ScribeCloud.words(error);
                ScribeCloud.fallen(cloud, ScribeCloud.Settings.NoDelay);
            }
            throw error;
        } finally {
            if (cloud.epoch === epoch) {
                cloud.flying = false;
                if (cloud.owed) {
                    cloud.owed = false;
                    ScribeCloud.record(cloud, ScribeCloud.resume(cloud));
                }
            }
        }
        return true;
    },

    /**
     * @param {object} cloud
     * @param {*} answer
     * @param {number} askedAt
     * @return {boolean}
     */
    leased(cloud, answer, askedAt) {
        cloud.held = answer?.held === true;
        cloud.leaseAt = cloud.clock.now();
        if (cloud.held) {
            cloud.heldAt = askedAt;
        }
        if (!cloud.garbled) {
            cloud.retries = ScribeCloud.Settings.NoCount;
            cloud.retryAt = null;
            cloud.limitedUntil = null;
            cloud.problem = null;
        }
        cloud.answered = true;
        return cloud.held;
    },

    /**
     * @param {object} cloud
     * @return {Promise<{ status: number, data: *, text: string, retryAfter: number }>}
     */
    lease(cloud) {
        const settings = ScribeCloud.Settings;
        return ScribeCloud.request(
            cloud,
            settings.Methods.Post,
            settings.Paths.Lease,
            { roomId: cloud.room },
            { browser: ScribeStore.browserId(cloud.storage, cloud.random), want: settings.Wants.None },
            settings.TimeoutMs,
        );
    },

    /**
     * @param {object} cloud
     * @param {string} room
     * @param {AbortSignal|null} signal
     * @return {Promise<{ status: number, data: *, text: string, retryAfter: number }>}
     */
    heads(cloud, room = cloud.room, signal = null) {
        const settings = ScribeCloud.Settings;
        return ScribeCloud.request(
            cloud,
            settings.Methods.Get,
            settings.Paths.Heads,
            {
                roomId: room,
                browser: ScribeStore.browserId(cloud.storage, cloud.random),
                day: cloud.clock.today(),
            },
            null,
            settings.TimeoutMs,
            signal,
        );
    },

    /**
     * @param {object} cloud
     * @return {void}
     */
    loading(cloud) {
        const phases = ScribeCloud.Phase;
        if (cloud.phase !== phases.Loading) {
            const epoch = cloud.epoch;
            cloud.loads++;
            const load = cloud.loads;
            cloud.phase = phases.Loading;
            cloud.opening = false;
            cloud.later(
                ScribeCloud.Settings.OpenMs,
                /**
                 * @return {void}
                 */
                () => {
                    if (cloud.epoch !== epoch || cloud.loads !== load || cloud.phase !== phases.Loading) {
                        return;
                    }
                    cloud.opening = false;
                    cloud.retries = ScribeCloud.Settings.NoCount;
                    cloud.retryAt = cloud.limitedUntil;
                    cloud.phase = phases.Offline;
                    cloud.notify();
                },
            );
        }
        cloud.notify();
    },

    /**
     * @param {object} cloud
     * @return {Promise<void>}
     * @throws {Error}
     */
    async begin(cloud) {
        const settings = ScribeCloud.Settings;
        const phases = ScribeCloud.Phase;
        const epoch = cloud.epoch;
        cloud.room = ScribeCloud.room(cloud.roomId);
        if (cloud.room === null) {
            cloud.phase = phases.Unusable;
            cloud.problem = settings.Messages.BadRoom;
            cloud.notify();
            return;
        }
        try {
            ScribeStore.browserId(cloud.storage, cloud.random);
        } catch (error) {
            cloud.phase = phases.Offline;
            cloud.problem = ScribeCloud.words(error);
            ScribeCloud.backOff(cloud, settings.NoDelay);
            cloud.notify();
            return;
        }
        const flown = await ScribeCloud.fly(
            cloud,
            /**
             * @return {Promise<void>}
             */
            async () => {
                const askedAt = cloud.clock.now();
                const lease = await ScribeCloud.lease(cloud);
                if (cloud.epoch !== epoch) {
                    return;
                }
                if (!ScribeCloud.ok(lease)) {
                    ScribeCloud.failed(cloud, lease, true);
                    return;
                }
                ScribeCloud.leased(cloud, lease.data, askedAt);
                await ScribeCloud.refresh(cloud);
            },
        );
        if (flown && cloud.epoch === epoch) {
            await ScribeCloud.stir(cloud);
        }
        if (cloud.epoch === epoch && cloud.answered && settings.Reaching.includes(cloud.phase)) {
            await Promise.all([ScribeCloud.spend(cloud), ScribeCloud.readNotes(cloud)]);
        }
    },

    /**
     * @param {object} cloud
     * @return {Promise<void>}
     * @throws {Error}
     */
    async refresh(cloud) {
        const epoch = cloud.epoch;
        const result = await ScribeCloud.heads(cloud);
        if (cloud.epoch !== epoch) {
            return;
        }
        if (!ScribeCloud.ok(result)) {
            ScribeCloud.failed(cloud, result, true);
            return;
        }
        await ScribeCloud.settle(cloud, result.data);
    },

    /**
     * @param {object} cloud
     * @return {Promise<void>}
     * @throws {Error}
     */
    async reload(cloud) {
        const epoch = cloud.epoch;
        const flown = await ScribeCloud.fly(
            cloud,
            /**
             * @return {Promise<void>}
             */
            () => ScribeCloud.refresh(cloud),
        );
        if (flown && cloud.epoch === epoch) {
            await ScribeCloud.stir(cloud);
        }
    },

    /**
     * @param {object} cloud
     * @param {*} spent
     * @return {void}
     * @throws {Error}
     */
    noteSpent(cloud, spent) {
        const settings = ScribeCloud.Settings;
        const sound =
            typeof spent?.day === settings.StringType && Number.isFinite(spent.sum) && Number.isFinite(spent.mine);
        if (sound) {
            const others = Math.max(settings.NoSpending, spent.sum - spent.mine);
            ScribeStore.setOthers(cloud.storage, cloud.roomId, spent.day, others);
        }
    },

    /**
     * @param {object} cloud
     * @param {string} kind
     * @param {{ revision: number, parts: number }} head
     * @param {string} room
     * @param {AbortSignal|null} signal
     * @return {Promise<{ text: string|null, result: object|null }>}
     */
    async download(cloud, kind, head, room = cloud.room, signal = null) {
        const settings = ScribeCloud.Settings;
        const epoch = cloud.epoch;
        const held = room === cloud.room ? cloud.texts.get(kind) : undefined;
        if (held !== undefined && held.revision === head.revision) {
            return { text: held.text, result: null };
        }
        const pieces = [];
        for (let part = settings.FirstPart; part < head.parts; part++) {
            const query = { roomId: room, kind, revision: head.revision, part };
            const result = await ScribeCloud.request(
                cloud,
                settings.Methods.Get,
                settings.Paths.Part,
                query,
                null,
                settings.PartTimeoutMs,
                signal,
            );
            if (cloud.epoch !== epoch || result.status !== settings.Statuses.Ok) {
                return { text: null, result };
            }
            pieces.push(result.text);
        }
        return { text: pieces.join(settings.Nothing), result: null };
    },

    /**
     * @param {{status: number, transportProblem?: string|null}} response
     * @param {string} activity
     * @return {void}
     * @throws {Error}
     */
    checkForkResponse(response, activity) {
        const {Messages, Statuses, Transport} = ScribeCloud.Settings;
        if (response.status === Statuses.Ok) {
            return;
        }
        if (response.transportProblem) {
            throw new Error(response.transportProblem);
        }
        if (response.status === Transport.Cancelled) {
            throw new Error('The Worker request was cancelled.');
        }
        if (response.status === Transport.Rejected) {
            throw new Error(Messages.Rejected + '.');
        }
        if (response.status === Transport.Network) {
            throw new Error('The Worker could not be reached while ' + activity + '.');
        }
        if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
            throw new Error('The Worker returned an invalid HTTP status while ' + activity + '.');
        }
        throw new Error('The Worker returned HTTP ' + response.status + ' while ' + activity + '.');
    },

    /**
     * @param {object} cloud
     * @param {string} sourceRoomId
     * @param {AbortSignal|null} signal
     * @return {Promise<object|null>}
     * @throws {Error}
     */
    async forkBook(cloud, sourceRoomId, signal = null) {
        const settings = ScribeCloud.Settings;
        const room = ScribeCloud.room(sourceRoomId);
        if (!room || sourceRoomId === cloud.roomId || cloud.closed) {
            throw new Error('The source room is unavailable.');
        }
        const response = await ScribeCloud.heads(cloud, room, signal);
        ScribeCloud.checkForkResponse(response, 'looking up the saved Book');
        if (!Array.isArray(response.data?.heads)) {
            throw new Error('The Worker returned an invalid list of saved records for this chat.');
        }
        const heads = response.data.heads.filter((item) => item?.kind === ScribeStore.Kind.Book);
        if (!heads.length) {
            if (response.data.heads.some((item) => !settings.Synced.includes(item?.kind) ||
                !Number.isSafeInteger(item.revision) || item.revision < 1 ||
                !Number.isSafeInteger(item.parts) || item.parts < 1 || item.parts > settings.MostParts)) {
                throw new Error('The Worker returned an invalid list of saved records for this chat.');
            }
            return null;
        }
        const [head] = heads;
        if (heads.length !== 1 || !Number.isSafeInteger(head.parts) || head.parts < 1 ||
            head.parts > settings.MostParts || !Number.isSafeInteger(head.revision) || head.revision < 1) {
            throw new Error('The Worker returned invalid revision or part information for the saved Book.');
        }
        const result = await ScribeCloud.download(cloud, head.kind, head, room, signal);
        if (result.result !== null) {
            ScribeCloud.checkForkResponse(result.result, 'downloading the saved Book');
            throw new Error('The Worker connection changed while downloading the saved Book.');
        }
        const book = ScribeStore.decode(result.text);
        if (!book || !ScribeKeeper.soundBook(book)) {
            throw new Error('The downloaded data does not contain a readable Scribe Book.');
        }
        return book;
    },

    /**
     * @param {*} text
     * @return {number|null}
     */
    readCount(text) {
        const read = ScribeStore.decode(text)?.log?.read;
        const settings = ScribeCloud.Settings;
        return read !== null && typeof read === settings.ObjectType ? Object.keys(read).length : null;
    },

    /**
     * @param {object} cloud
     * @param {string} reason
     * @return {void}
     */
    unreadable(cloud, reason) {
        cloud.problem = reason;
        cloud.garbled = true;
        cloud.texts = new Map();
        ScribeCloud.backOff(cloud, ScribeCloud.Settings.NoDelay);
        cloud.phase = cloud.answered && !cloud.held ? ScribeCloud.Phase.Watching : ScribeCloud.Phase.Offline;
        cloud.notify();
    },

    /**
     * @param {object} cloud
     * @param {*} first
     * @return {Promise<void>}
     * @throws {Error}
     */
    async settle(cloud, first) {
        const settings = ScribeCloud.Settings;
        const phases = ScribeCloud.Phase;
        const kinds = ScribeStore.Kind;
        const storage = cloud.storage;
        const roomId = cloud.roomId;
        const epoch = cloud.epoch;
        const answer = cloud.conflict === null ? null : cloud.conflict.answer;
        const keeping = answer === ScribeCloud.Answer.Keep;
        const taking = answer === ScribeCloud.Answer.Cloud;
        const sentName = ScribeCloud.sentName(cloud);
        let record = ScribeStore.decode(ScribeStore.fetch(storage, sentName));
        let reply = first;
        let sweeps = settings.FirstRound;
        let stepped = false;
        for (;;) {
            let sound = reply !== null && typeof reply === settings.ObjectType && Array.isArray(reply.heads);
            const heads = new Map();
            if (sound) {
                for (const head of reply.heads) {
                    sound =
                        settings.Synced.includes(head?.kind) &&
                        Number.isSafeInteger(head.revision) &&
                        head.revision > settings.NoRevision &&
                        Number.isSafeInteger(head.parts) &&
                        head.parts > settings.NoCount &&
                        head.parts <= settings.MostParts;
                    if (!sound) {
                        break;
                    }
                    heads.set(head.kind, { revision: head.revision, parts: head.parts });
                }
            }
            if (!sound) {
                ScribeCloud.unreadable(cloud, settings.Messages.Unreadable);
                return;
            }
            ScribeCloud.noteSpent(cloud, reply.spent);
            const priorBook = cloud.checkedHeads ? cloud.heads.get(kinds.Book)?.revision ?? settings.NoRevision : null;
            cloud.heads = heads;
            cloud.checkedHeads = true;
            const synced = ScribeStore.synced(storage, roomId);
            const fetched = new Map();
            let swept = null;
            for (const kind of settings.Synced) {
                const head = heads.get(kind) ?? null;
                const revision = head === null ? settings.NoRevision : head.revision;
                const entry = synced[kind] ?? { revision: settings.NoRevision, generation: settings.NoGeneration };
                let snapshot = null;
                let damaged = false;
                try {
                    snapshot = ScribeStore.snapshot(storage, roomId, kind);
                } catch (error) {
                    if (error?.damaged !== true) {
                        throw error;
                    }
                    damaged = true;
                }
                const clean = snapshot === null || snapshot.generation === entry.generation;
                const moved = revision !== entry.revision;
                if (revision === settings.NoRevision) {
                    if (taking && snapshot !== null) {
                        ScribeStore.setSynced(storage, roomId, kind, settings.NoRevision, snapshot.generation);
                    } else if (moved && !damaged) {
                        const generation = clean ? settings.NoGeneration : entry.generation;
                        ScribeStore.setSynced(storage, roomId, kind, settings.NoRevision, generation);
                    }
                    continue;
                }
                if (snapshot !== null && !damaged && !moved && (clean || !taking)) {
                    continue;
                }
                if (cloud.spoiled.get(kind) === revision) {
                    ScribeCloud.unreadable(cloud, settings.Messages.Unreadable);
                    return;
                }
                const loaded = await ScribeCloud.download(cloud, kind, head);
                if (cloud.epoch !== epoch) {
                    return;
                }
                if (loaded.result !== null && loaded.result.status === settings.Statuses.NotFound) {
                    swept = { kind, revision };
                    break;
                }
                if (loaded.result !== null) {
                    ScribeCloud.failed(cloud, loaded.result, true);
                    return;
                }
                const value = ScribeStore.decode(loaded.text);
                if (value === null || (kind === kinds.Book && !ScribeKeeper.soundBook(value))) {
                    cloud.spoiled.set(kind, revision);
                    ScribeCloud.unreadable(cloud, settings.Messages.Unreadable);
                    return;
                }
                cloud.texts.set(kind, { revision, text: loaded.text });
                const rollback = kind === kinds.Book && revision < entry.revision;
                const adopt = damaged || snapshot === null || taking || (clean && !keeping && !rollback);
                fetched.set(kind, { revision, text: loaded.text, snapshot, adopt });
            }
            if (swept !== null) {
                if (sweeps >= settings.MostSettles) {
                    cloud.spoiled.set(swept.kind, swept.revision);
                    ScribeCloud.unreadable(cloud, settings.Messages.Unreadable);
                    return;
                }
                sweeps++;
                const again = await ScribeCloud.heads(cloud);
                if (cloud.epoch !== epoch) {
                    return;
                }
                if (!ScribeCloud.ok(again)) {
                    ScribeCloud.failed(cloud, again, true);
                    return;
                }
                reply = again.data;
                continue;
            }
            cloud.opening = false;
            if (cloud.garbled) {
                cloud.garbled = false;
                cloud.retries = settings.NoCount;
                cloud.retryAt = null;
                cloud.problem = null;
            }
            const adopted = new Map();
            const diverged = new Map();
            for (const [kind, found] of fetched) {
                if (found.adopt) {
                    adopted.set(kind, found);
                    continue;
                }
                const sending = record !== null && Object.hasOwn(record, kind) ? record[kind] : null;
                const sent =
                    sending !== null &&
                    sending.revision === found.revision &&
                    sending.characters === found.text.length &&
                    sending.digest === ScribeStore.digest(found.text) &&
                    ScribeStore.whole(sending.generation);
                if (found.text === found.snapshot.text) {
                    ScribeStore.setSynced(storage, roomId, kind, found.revision, found.snapshot.generation);
                } else if (sent) {
                    ScribeStore.setSynced(storage, roomId, kind, found.revision, sending.generation);
                } else {
                    diverged.set(kind, found);
                }
            }
            if (record !== null) {
                storage.remove(sentName);
                record = null;
            }
            const asking =
                diverged.size > settings.NoCount && (diverged.has(kinds.Book) || keeping) && !(keeping && cloud.held);
            const writes = new Map();
            const deferred = new Map();
            for (const [kind, found] of adopted) {
                if (asking && found.snapshot !== null) {
                    deferred.set(kind, found);
                } else {
                    writes.set(kind, found);
                }
            }
            if (!asking) {
                for (const [kind, found] of diverged) {
                    if (cloud.held) {
                        ScribeStore.setSynced(storage, roomId, kind, found.revision, settings.NoGeneration);
                    } else {
                        writes.set(kind, found);
                    }
                }
            }
            if (writes.size > settings.NoCount && cloud.reader()) {
                ScribeCloud.loading(cloud);
                if (stepped || cloud.reader()) {
                    cloud.again = true;
                    return;
                }
                stepped = true;
                continue;
            }
            for (const [kind, found] of writes) {
                ScribeStore.writeText(storage, roomId, kind, found.text);
                const generation = ScribeStore.generation(storage, roomId, kind);
                ScribeStore.setSynced(storage, roomId, kind, found.revision, generation);
                cloud.seen.set(kind, generation);
            }
            cloud.again = false;
            cloud.texts = new Map();
            if (asking) {
                let here = null;
                try {
                    here = ScribeCloud.readCount(ScribeStore.snapshot(storage, roomId, kinds.Book)?.text);
                } catch (error) {
                    if (error?.damaged !== true) {
                        throw error;
                    }
                }
                const there = diverged.has(kinds.Book) ? ScribeCloud.readCount(diverged.get(kinds.Book).text) : here;
                const texts = new Map();
                for (const [kind, found] of [...diverged, ...deferred]) {
                    texts.set(kind, { revision: found.revision, text: found.text });
                }
                cloud.conflict = { cloud: texts, here, there, answer: keeping ? ScribeCloud.Answer.Keep : null };
                cloud.phase = phases.Conflict;
                cloud.notify();
                return;
            }
            if (taking || (keeping && diverged.size === settings.NoCount)) {
                cloud.conflict = null;
            }
            const phase = cloud.held ? phases.Leading : phases.Watching;
            const changed = cloud.lookupFailed || phase !== cloud.phase || writes.size > settings.NoCount ||
                priorBook !== (heads.get(kinds.Book)?.revision ?? settings.NoRevision);
            cloud.lookupFailed = false;
            cloud.phase = phase;
            if (changed) {
                cloud.notify();
            }
            return;
        }
    },

    /**
     * @param {object} cloud
     * @param {{ status: number, data: * }} result
     * @return {Promise<void>}
     * @throws {Error}
     */
    async refused(cloud, result) {
        const settings = ScribeCloud.Settings;
        const codes = settings.Codes;
        const code = result.status === settings.Statuses.Conflict ? ScribeCloud.code(result) : null;
        if (code === codes.LeaseLost) {
            cloud.held = false;
            cloud.phase = ScribeCloud.Phase.Watching;
            cloud.notify();
            await ScribeCloud.refresh(cloud);
            return;
        }
        if (code === codes.Conflict) {
            await ScribeCloud.refresh(cloud);
            return;
        }
        if (code !== codes.PartsMissing) {
            ScribeCloud.failed(cloud, result);
        }
    },

    /**
     * @param {object} cloud
     * @param {boolean} force
     * @return {Promise<void>}
     * @throws {Error}
     */
    async push(cloud, force) {
        const settings = ScribeCloud.Settings;
        const phases = ScribeCloud.Phase;
        const now = cloud.clock.now();
        if (cloud.closed || cloud.phase !== phases.Leading || cloud.flying || ScribeCloud.lapsed(cloud, now)) {
            return;
        }
        if (!force && !ScribeCloud.due(cloud, now)) {
            return;
        }
        const unsent = ScribeCloud.unsent(cloud);
        if (unsent.length === settings.NoCount) {
            return;
        }
        if (!force && unsent.includes(ScribeStore.Kind.Book) && cloud.reading()) {
            return;
        }
        if (!force && cloud.changedAt !== null && ScribeCloud.elapsed(now, cloud.changedAt) < settings.QuietMs) {
            return;
        }
        await ScribeCloud.fly(
            cloud,
            /**
             * @return {Promise<void>}
             */
            () => ScribeCloud.send(cloud, unsent),
        );
    },

    /**
     * @param {object} cloud
     * @param {string[]} unsent
     * @return {Promise<void>}
     * @throws {Error}
     */
    async send(cloud, unsent) {
        const settings = ScribeCloud.Settings;
        const phases = ScribeCloud.Phase;
        const epoch = cloud.epoch;
        const synced = ScribeStore.synced(cloud.storage, cloud.roomId);
        const ready = [];
        for (const kind of unsent) {
            const base = Object.hasOwn(synced, kind) ? synced[kind].revision : settings.NoRevision;
            const cached = cloud.heads.has(kind) ? cloud.heads.get(kind).revision : settings.NoRevision;
            if (base !== cached) {
                await ScribeCloud.refresh(cloud);
                return;
            }
            let snapshot = null;
            try {
                snapshot = ScribeStore.snapshot(cloud.storage, cloud.roomId, kind);
            } catch (error) {
                if (error?.damaged !== true) {
                    throw error;
                }
                continue;
            }
            const text = snapshot.text;
            const refusedStart = settings.PartStartRefused;
            const pieces = [];
            for (let start = settings.NoCount; start < text.length; ) {
                let end = Math.min(start + settings.PartCharacters, text.length);
                while (end < text.length && end > start + settings.Next && refusedStart.test(text[end])) {
                    end--;
                }
                pieces.push(text.slice(start, end));
                start = end;
            }
            if (pieces.length > settings.MostParts) {
                cloud.phase = phases.Unusable;
                cloud.problem = settings.Messages.TooLarge;
                cloud.notify();
                return;
            }
            ready.push({ kind, base, snapshot, pieces });
        }
        if (ready.length === settings.NoCount) {
            return;
        }
        const changes = [];
        for (const item of ready) {
            const digests = [];
            for (let part = settings.FirstPart; part < item.pieces.length; part++) {
                const query = {
                    roomId: cloud.room,
                    kind: item.kind,
                    revision: item.base + settings.Next,
                    part,
                    browser: ScribeStore.browserId(cloud.storage, cloud.random),
                };
                const staged = await ScribeCloud.request(
                    cloud,
                    settings.Methods.Put,
                    settings.Paths.Part,
                    query,
                    item.pieces[part],
                    settings.PartTimeoutMs,
                );
                if (cloud.epoch !== epoch) {
                    return;
                }
                if (!ScribeCloud.ok(staged)) {
                    await ScribeCloud.refused(cloud, staged);
                    return;
                }
                digests.push(staged.data?.digest);
            }
            changes.push({
                kind: item.kind,
                expectedRevision: item.base,
                revision: item.base + settings.Next,
                digests,
            });
        }
        const committed = await ScribeCloud.request(
            cloud,
            settings.Methods.Post,
            settings.Paths.Commit,
            { roomId: cloud.room },
            { browser: ScribeStore.browserId(cloud.storage, cloud.random), kinds: changes, done: [] },
            settings.TimeoutMs,
        );
        if (cloud.epoch !== epoch) {
            return;
        }
        if (!ScribeCloud.ok(committed)) {
            if (committed.status !== settings.Statuses.Conflict) {
                const record = Object.fromEntries(
                    ready.map(
                        /**
                         * @param {{ kind: string, base: number, snapshot: { text: string, generation: number } }} item
                         * @return {Array<string|object>}
                         */
                        (item) => [
                            item.kind,
                            {
                                revision: item.base + settings.Next,
                                digest: ScribeStore.digest(item.snapshot.text),
                                characters: item.snapshot.text.length,
                                generation: item.snapshot.generation,
                            },
                        ],
                    ),
                );
                cloud.storage.set(ScribeCloud.sentName(cloud), JSON.stringify(record));
            }
            await ScribeCloud.refused(cloud, committed);
            return;
        }
        for (const item of ready) {
            const revision = item.base + settings.Next;
            ScribeStore.setSynced(cloud.storage, cloud.roomId, item.kind, revision, item.snapshot.generation);
            cloud.heads.set(item.kind, { revision, parts: item.pieces.length });
        }
        cloud.retries = settings.NoCount;
        cloud.retryAt = null;
        cloud.problem = null;
        if (cloud.conflict !== null && cloud.conflict.answer === ScribeCloud.Answer.Keep) {
            cloud.conflict = null;
            cloud.notify();
        } else if (ready.some((item) => item.kind === ScribeStore.Kind.Book)) {
            cloud.notify();
        }
    },

    /**
     * @param {object} cloud
     * @return {Promise<void>}
     * @throws {Error}
     */
    async renew(cloud) {
        const settings = ScribeCloud.Settings;
        const phases = ScribeCloud.Phase;
        const epoch = cloud.epoch;
        const renewal = cloud.renewal;
        cloud.renewing = true;
        const askedAt = cloud.clock.now();
        let result = null;
        try {
            result = await ScribeCloud.lease(cloud);
        } finally {
            if (cloud.epoch === epoch && cloud.renewal === renewal) {
                cloud.renewing = false;
            }
        }
        if (cloud.epoch !== epoch || cloud.renewal !== renewal) {
            return;
        }
        if (!ScribeCloud.ok(result)) {
            ScribeCloud.failed(cloud, result, true);
            return;
        }
        const held = ScribeCloud.leased(cloud, result.data, askedAt);
        const keeping = cloud.conflict !== null && cloud.conflict.answer === ScribeCloud.Answer.Keep;
        if (held && cloud.phase === phases.Conflict && keeping) {
            await ScribeCloud.carry(cloud);
            return;
        }
        if (held && settings.Settled.includes(cloud.phase)) {
            await ScribeCloud.reload(cloud);
            return;
        }
        if (!held && settings.Dropped.includes(cloud.phase)) {
            cloud.phase = phases.Watching;
            cloud.notify();
            await ScribeCloud.reload(cloud);
        } else if (!held && cloud.phase === phases.Watching) {
            await ScribeCloud.reload(cloud);
        }
    },

    /**
     * @param {object} cloud
     * @return {Promise<void>}
     * @throws {Error}
     */
    async carry(cloud) {
        const settings = ScribeCloud.Settings;
        for (const kind of settings.Synced) {
            const found = cloud.conflict.cloud.get(kind);
            if (found !== undefined) {
                ScribeStore.setSynced(cloud.storage, cloud.roomId, kind, found.revision, settings.NoGeneration);
                continue;
            }
            const generation = ScribeStore.generation(cloud.storage, cloud.roomId, kind);
            if (!cloud.heads.has(kind) && generation !== null && generation > settings.NoGeneration) {
                ScribeStore.setSynced(cloud.storage, cloud.roomId, kind, settings.NoRevision, settings.NoGeneration);
            }
        }
        cloud.phase = ScribeCloud.Phase.Leading;
        cloud.notify();
        await ScribeCloud.push(cloud, true);
    },

    /**
     * @param {object} cloud
     * @return {Promise<void>}
     * @throws {Error}
     */
    async spend(cloud) {
        const settings = ScribeCloud.Settings;
        const today = cloud.clock.today();
        const total = ScribeStore.spent(cloud.storage, cloud.roomId, today);
        const sent = cloud.sent;
        const due = sent !== null && sent.day === today ? total > sent.total : total > settings.NoSpending;
        if (!due || cloud.spending) {
            return;
        }
        const epoch = cloud.epoch;
        cloud.spending = true;
        let result = null;
        try {
            result = await ScribeCloud.request(
                cloud,
                settings.Methods.Post,
                settings.Paths.Spend,
                { roomId: cloud.room },
                { browser: ScribeStore.browserId(cloud.storage, cloud.random), day: today, total },
                settings.TimeoutMs,
            );
        } finally {
            if (cloud.epoch === epoch) {
                cloud.spending = false;
            }
        }
        if (cloud.epoch !== epoch) {
            return;
        }
        if (!ScribeCloud.ok(result)) {
            ScribeCloud.failed(cloud, result);
            return;
        }
        ScribeCloud.noteSpent(cloud, result.data);
        cloud.sent = { day: today, total };
    },

    /**
     * @param {string} text
     * @return {{ text: string, length: number, cut: number|null }}
     */
    trimmed(text) {
        const settings = ScribeCloud.Settings;
        const points = Array.from(text);
        if (points.length <= settings.NotesLongest) {
            return { text, length: points.length, cut: null };
        }
        const head = points.slice(settings.NoCount, settings.NotesLongest).join(settings.Nothing);
        const end = head.lastIndexOf(settings.LineBreak);
        const line = end > settings.NoCount ? head.slice(settings.NoCount, end) : head;
        const bare = line.length - settings.Next;
        const kept = line.endsWith(settings.CarriageReturn) ? line.slice(settings.NoCount, bare) : line;
        return { text: kept, length: Array.from(kept).length, cut: points.length };
    },

    /**
     * @param {object} cloud
     * @return {Promise<void>}
     */
    async readNotes(cloud) {
        const settings = ScribeCloud.Settings;
        const statuses = settings.Statuses;
        const now = cloud.clock.now();
        const recent = cloud.notesAt !== null && ScribeCloud.elapsed(now, cloud.notesAt) < settings.NotesEveryMs;
        if (cloud.noting || recent) {
            return;
        }
        const epoch = cloud.epoch;
        cloud.noting = true;
        cloud.notesAt = now;
        let result = null;
        try {
            result = await ScribeCloud.request(
                cloud,
                settings.Methods.Get,
                settings.Paths.Notes,
                { roomId: cloud.notesRoom },
                null,
                settings.TimeoutMs,
            );
        } finally {
            if (cloud.epoch === epoch) {
                cloud.noting = false;
            }
        }
        if (cloud.epoch !== epoch) {
            return;
        }
        const notes = result.data?.notes;
        const previouslyChecked = cloud.checkedNotes;
        const previous = cloud.notes;
        cloud.checkedNotes = false;
        if (result.status === statuses.Ok && typeof notes === settings.StringType) {
            cloud.notes = notes.trim() === settings.Nothing ? null : ScribeCloud.trimmed(notes);
            cloud.checkedNotes = true;
        } else if (result.status === statuses.NotFound && ScribeCloud.code(result) === settings.Codes.NoNotes) {
            cloud.notes = null;
            cloud.checkedNotes = true;
        }
        if (cloud.checkedNotes !== previouslyChecked || previous?.length !== cloud.notes?.length || previous?.cut !== cloud.notes?.cut) {
            cloud.notify();
        }
    },

    /**
     * @param {object} cloud
     * @return {Promise<void>}
     * @throws {Error}
     */
    async keep(cloud) {
        const messages = ScribeCloud.Settings.Messages;
        if (cloud.phase !== ScribeCloud.Phase.Conflict || cloud.conflict === null) {
            throw new Error(messages.NoChoice);
        }
        if (cloud.flying) {
            throw new Error(messages.Busy);
        }
        cloud.conflict.answer = ScribeCloud.Answer.Keep;
        if (!cloud.held) {
            throw new Error(messages.Elsewhere);
        }
        await ScribeCloud.carry(cloud);
    },

    /**
     * @param {object} cloud
     * @return {Promise<void>}
     * @throws {Error}
     */
    async useCloud(cloud) {
        const messages = ScribeCloud.Settings.Messages;
        if (cloud.phase !== ScribeCloud.Phase.Conflict || cloud.conflict === null) {
            throw new Error(messages.NoChoice);
        }
        if (cloud.flying) {
            throw new Error(messages.Busy);
        }
        const conflict = cloud.conflict;
        const before = conflict.answer;
        conflict.answer = ScribeCloud.Answer.Cloud;
        await ScribeCloud.reload(cloud);
        const waiting = cloud.phase === ScribeCloud.Phase.Loading && cloud.again;
        if (cloud.conflict === conflict && !waiting) {
            conflict.answer = before;
            throw new Error(cloud.garbled ? messages.Unreadable : messages.Unreachable);
        }
    },

    /**
     * @param {object} cloud
     * @return {string|null}
     */
    notes(cloud) {
        return cloud.notes === null ? null : cloud.notes.text;
    },

    /**
     * @param {object} cloud
     * @return {Readonly<{ phase: string, keyed: boolean, conflict: Readonly<{ here: number|null, there: number|null }>|null, notes: Readonly<{ length: number, cut: number|null }>|null, unsent: number, problem: string|null }>}
     * @throws {Error}
     */
    view(cloud) {
        const phases = ScribeCloud.Phase;
        const conflict = cloud.phase === phases.Conflict ? cloud.conflict : null;
        const quiet = cloud.phase === phases.Off || cloud.phase === phases.Idle;
        const unsent = quiet ? [] : ScribeCloud.unsent(cloud);
        return Object.freeze({
            phase: cloud.phase,
            keyed: cloud.key !== ScribeCloud.Settings.Nothing,
            bookRevision: cloud.checkedHeads ? cloud.heads.get(ScribeStore.Kind.Book)?.revision ?? ScribeCloud.Settings.NoRevision : null,
            bookPending: unsent.includes(ScribeStore.Kind.Book),
            lookupFailed: cloud.lookupFailed,
            unreadable: cloud.garbled,
            checkedNotes: cloud.checkedNotes,
            conflict: conflict === null ? null : Object.freeze({ here: conflict.here, there: conflict.there }),
            notes: cloud.notes === null ? null : Object.freeze({ length: cloud.notes.length, cut: cloud.notes.cut }),
            unsent: unsent.length,
            problem: cloud.problem,
        });
    },

    /**
     * @param {object} cloud
     * @return {void}
     */
    close(cloud) {
        cloud.epoch++;
        cloud.closed = true;
    },

    /**
     * @param {{ storage: object, roomId: string, notesRoom: string, xmlHttpRequest: Function, clock: { now: () => number, today: () => string }, random: () => string, later: (milliseconds: number, action: Function) => void, chosen: () => boolean, reader: () => boolean, busy: () => boolean, reading: () => boolean, notify: () => void }} options
     * @return {Readonly<{ view: Function, tick: Function, stir: Function, leads: Function, notes: Function, keep: Function, useCloud: Function, close: Function }>}
     */
    open(options) {
        const settings = ScribeCloud.Settings;
        const cloud = {
            storage: options.storage,
            roomId: options.roomId,
            notesRoom: options.notesRoom,
            xmlHttpRequest: options.xmlHttpRequest,
            clock: options.clock,
            random: options.random,
            later: options.later,
            chosen: options.chosen,
            reader: options.reader,
            busy: options.busy,
            reading: options.reading,
            notify: options.notify,
            phase: ScribeCloud.Phase.Off,
            key: settings.Nothing,
            room: null,
            epoch: settings.FirstEpoch,
            heads: new Map(),
            seen: new Map(),
            changedAt: null,
            timer: false,
            closed: false,
        };
        ScribeCloud.restart(cloud, ScribeStore.cloudKey(options.storage));
        return Object.freeze({
            /**
             * @return {Readonly<object>}
             */
            view: () => ScribeCloud.view(cloud),

            /**
             * @param {string} sourceRoomId
             * @param {AbortSignal|null} signal
             * @return {Promise<object|null>}
             */
            forkBook: (sourceRoomId, signal = null) => ScribeCloud.forkBook(cloud, sourceRoomId, signal),

            /**
             * @return {Promise<void>}
             */
            tick: () => ScribeCloud.tick(cloud),

            /**
             * @return {Promise<void>}
             */
            stir: () => ScribeCloud.stir(cloud),

            /**
             * @return {boolean}
             */
            leads: () => ScribeCloud.leads(cloud),

            /**
             * @return {string|null}
             */
            notes: () => ScribeCloud.notes(cloud),

            /**
             * @return {Promise<void>}
             */
            keep: () => ScribeCloud.keep(cloud),

            /**
             * @return {Promise<void>}
             */
            useCloud: () => ScribeCloud.useCloud(cloud),

            /**
             * @return {void}
             */
            close: () => {
                ScribeCloud.close(cloud);
            },
        });
    },
});
