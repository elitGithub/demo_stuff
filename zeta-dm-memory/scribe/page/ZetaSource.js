const ZetaSource = Object.freeze({
    End: Object.freeze({
        NoCursor: 'NoCursor',
        EmptyPage: 'EmptyPage',
        RepeatedCursor: 'RepeatedCursor',
        NothingNew: 'NothingNew',
        Limit: 'Limit',
        Failed: 'Failed',
    }),

    Settings: Object.freeze({
        ApiOrigin: 'https://api.zeta-ai.io',
        PageSize: 31,
        PauseMs: 500,
        MostPages: 2000,
        Tries: 3,
        FirstTry: 1,
        RetryPauseMs: 2000,
        TimeoutMs: 30000,
        TooMany: 429,
        FirstServerError: 500,
        FirstSuccess: 200,
        LastSuccess: 299,
        RoomsPath: '/v1/rooms/',
        MessagesPath: '/messages',
        QueryMark: '?',
        LimitName: 'limit',
        CursorName: 'cursor',
        AuthorizationHeader: 'Authorization',
        AuthorizationName: 'authorization',
        ReadMethod: 'GET',
        ReadMethods: Object.freeze(['GET', 'HEAD', 'OPTIONS']),
        ShortestToken: 16,
        Finished: 'loadend',
        Once: Object.freeze({ once: true }),
        InitPosition: 1,
        RequestTag: '[object Request]',
        MapTag: '[object Map]',
        IdGroup: 1,
        Nothing: '',
        ObjectType: 'object',
        StringType: 'string',
        NumberType: 'number',
        FunctionType: 'function',

        /**
         * @return {RegExp}
         */
        get RoomPath() {
            return /^(?:\/[a-z]{2,3}(?:-[a-z0-9]{2,8})?)?\/rooms\/([^/]+)/i;
        },

        /**
         * @return {RegExp}
         */
        get Scheme() {
            return /^\S+\s+/;
        },

        /**
         * @return {RegExp}
         */
        get Junk() {
            return /(?:^|[^a-z0-9\-._~+/=])(?:undefined|null|\[object|false|nan)(?![a-z0-9\-._~+/=])/;
        },
        Messages: Object.freeze({
            HttpPrefix: 'Zeta answered HTTP ',
            Shape: 'Zeta answered in an unexpected shape',
            Unreachable: 'Zeta could not be reached',
            Timeout: 'Zeta did not answer in time',
            NoPause: 'Could not pause between requests',
            NoLogin: 'No login seen yet',
            NoRoom: 'No chat is open',
        }),
    }),

    Watchers: new WeakMap(),

    Requests: new WeakMap(),

    /**
     * @param {string} pathname
     * @return {string|null}
     */
    room(pathname) {
        const settings = ZetaSource.Settings;
        const match = settings.RoomPath.exec(pathname);
        if (match === null) {
            return null;
        }
        return ZetaSource.quietly(null, decodeURIComponent, match[settings.IdGroup]);
    },

    /**
     * @param {*} value
     * @return {boolean}
     */
    isObject(value) {
        return typeof value === ZetaSource.Settings.ObjectType && value !== null && !Array.isArray(value);
    },

    /**
     * @param {*} value
     * @return {boolean}
     */
    filled(value) {
        const settings = ZetaSource.Settings;
        return typeof value === settings.StringType && value !== settings.Nothing;
    },

    /**
     * @param {*} fallback
     * @param {Function} action
     * @param {...*} values
     * @return {*}
     */
    quietly(fallback, action, ...values) {
        try {
            return action(...values);
        } catch {
            return fallback;
        }
    },

    /**
     * @param {string} message
     * @param {number|null} status
     * @param {boolean} retryable
     * @return {Error}
     */
    failure(message, status, retryable) {
        const error = new Error(message);
        error.status = status;
        error.retryable = retryable;
        return error;
    },

    /**
     * @param {{ pageWindow: object }} state
     * @param {string} address
     * @return {string|null}
     */
    apiPath(state, address) {
        const resolved = new URL(address, state.pageWindow.location.href);
        return resolved.origin === ZetaSource.Settings.ApiOrigin ? resolved.pathname : null;
    },

    /**
     * @param {string} path
     * @param {*} method
     * @return {Readonly<{ method: string, path: string }>|null}
     */
    traffic(path, method) {
        const verb = String(method).toUpperCase();
        return ZetaSource.Settings.ReadMethods.includes(verb) ? null : Object.freeze({ method: verb, path });
    },

    /**
     * @param {{ token: string|null }} state
     * @param {*} value
     * @return {void}
     */
    remember(state, value) {
        const settings = ZetaSource.Settings;
        if (typeof value !== settings.StringType) {
            return;
        }
        const text = value.trim();
        const credentials = text.toLowerCase().replace(settings.Scheme, settings.Nothing);
        if (text.length >= settings.ShortestToken && !settings.Junk.test(credentials)) {
            state.token = text;
        }
    },

    /**
     * @param {*} headers
     * @return {*}
     */
    authorization(headers) {
        const settings = ZetaSource.Settings;
        if (headers === undefined || headers === null) {
            return null;
        }
        const listed = Array.isArray(headers) || Object.prototype.toString.call(headers) === settings.MapTag;
        const pairs = listed && typeof headers[Symbol.iterator] === settings.FunctionType;
        if (!pairs && typeof headers.get === settings.FunctionType) {
            return headers.get(settings.AuthorizationName);
        }
        let found = null;
        for (const [name, value] of pairs ? headers : Object.entries(headers)) {
            if (String(name).toLowerCase() === settings.AuthorizationName) {
                found = value;
            }
        }
        return found;
    },

    /**
     * @param {{ pageWindow: object, token: string|null, stopped: boolean }} state
     * @param {*} input
     * @param {*} init
     * @return {Readonly<{ method: string, path: string }>|null}
     */
    fetched(state, input, init) {
        const settings = ZetaSource.Settings;
        if (state.stopped) {
            return null;
        }
        const carried =
            typeof input === settings.ObjectType && input !== null && Object.prototype.toString.call(input) === settings.RequestTag;
        const path = ZetaSource.apiPath(state, carried ? input.url : String(input));
        if (path === null) {
            return null;
        }
        const given = init?.headers;
        const headers = given === undefined || given === null ? (carried ? input.headers : null) : given;
        ZetaSource.remember(state, ZetaSource.authorization(headers));
        return ZetaSource.traffic(path, init?.method ?? (carried ? input.method : settings.ReadMethod));
    },

    /**
     * @param {{ callbacks: Function[], stopped: boolean }} state
     * @param {Readonly<{ method: string, path: string }>} traffic
     * @return {void}
     */
    notify(state, traffic) {
        if (state.stopped) {
            return;
        }
        for (const callback of state.callbacks) {
            ZetaSource.quietly(null, callback, traffic);
        }
    },

    /**
     * @param {{ callbacks: Function[], stopped: boolean }} state
     * @param {*} result
     * @param {Readonly<{ method: string, path: string }>|null} traffic
     * @return {void}
     */
    settled(state, result, traffic) {
        if (traffic === null) {
            return;
        }

        /**
         * @return {void}
         */
        const finished = () => {
            ZetaSource.notify(state, traffic);
        };
        result.then(finished, finished);
    },

    /**
     * @param {object} request
     * @return {void}
     */
    forget(request) {
        const record = ZetaSource.Requests.get(request);
        ZetaSource.Requests.delete(request);
        if (record !== undefined && record.listener !== null) {
            request.removeEventListener(ZetaSource.Settings.Finished, record.listener);
        }
    },

    /**
     * @param {{ pageWindow: object, stopped: boolean }} state
     * @param {object} request
     * @param {*} method
     * @param {*} address
     * @return {void}
     */
    opened(state, request, method, address) {
        if (state.stopped) {
            return;
        }
        ZetaSource.forget(request);
        const path = ZetaSource.apiPath(state, String(address));
        if (path !== null) {
            ZetaSource.Requests.set(request, { traffic: ZetaSource.traffic(path, method), listener: null });
        }
    },

    /**
     * @param {{ token: string|null, stopped: boolean }} state
     * @param {object} request
     * @param {*} name
     * @param {*} value
     * @return {void}
     */
    headed(state, request, name, value) {
        if (!state.stopped && ZetaSource.Requests.has(request) && String(name).toLowerCase() === ZetaSource.Settings.AuthorizationName) {
            ZetaSource.remember(state, value);
        }
    },

    /**
     * @param {{ callbacks: Function[], stopped: boolean }} state
     * @param {object} request
     * @return {boolean}
     */
    sending(state, request) {
        const settings = ZetaSource.Settings;
        const record = ZetaSource.Requests.get(request);
        if (state.stopped || record === undefined || record.traffic === null || record.listener !== null) {
            return false;
        }

        /**
         * @return {void}
         */
        record.listener = () => {
            if (ZetaSource.Requests.get(request) === record) {
                ZetaSource.Requests.delete(request);
            }
            ZetaSource.notify(state, record.traffic);
        };
        request.addEventListener(settings.Finished, record.listener, settings.Once);
        return true;
    },

    /**
     * @param {object} owner
     * @param {string} name
     * @return {Function|null}
     */
    held(owner, name) {
        const value = owner[name];
        return typeof value === ZetaSource.Settings.FunctionType ? value : null;
    },

    /**
     * @param {object} owner
     * @param {string} name
     * @param {Function} wrapper
     * @param {*} exporter
     * @return {Function|null}
     */
    install(owner, name, wrapper, exporter) {
        const settings = ZetaSource.Settings;
        const exported = typeof exporter === settings.FunctionType ? exporter(wrapper) : wrapper;
        if (typeof exported !== settings.FunctionType) {
            return null;
        }
        owner[name] = exported;
        return exported;
    },

    /**
     * @param {object} owner
     * @param {string} name
     * @param {Function|null} current
     * @param {Function|null} original
     * @return {void}
     */
    restore(owner, name, current, original) {
        if (current !== null && owner[name] === current) {
            owner[name] = original;
        }
    },

    /**
     * @param {object} pageWindow
     * @param {(wrapper: Function) => Function} [exporter]
     * @return {Readonly<{ token: () => string|null, onTraffic: (callback: Function) => void, stop: () => void }>}
     */
    watch(pageWindow, exporter) {
        const known = ZetaSource.Watchers.get(pageWindow);
        if (known !== undefined) {
            return known;
        }
        const prototype = ZetaSource.quietly(
            null,
            /**
             * @param {object} target
             * @return {object}
             */
            (target) => target.XMLHttpRequest.prototype,
            pageWindow,
        );
        const owners = { fetch: pageWindow, open: prototype, setRequestHeader: prototype, send: prototype };
        const originals = {};
        const installed = {};
        for (const name of Object.keys(owners)) {
            originals[name] = ZetaSource.quietly(null, ZetaSource.held, owners[name], name);
        }
        const state = { pageWindow, token: null, callbacks: [], stopped: false };
        const wrappers = {
            /**
             * @param {*} input
             * @return {*}
             */
            fetch(input) {
                'use strict';
                const init = arguments[ZetaSource.Settings.InitPosition];
                const traffic = ZetaSource.quietly(null, ZetaSource.fetched, state, input, init);
                const result = originals.fetch.apply(this, arguments);
                ZetaSource.quietly(null, ZetaSource.settled, state, result, traffic);
                return result;
            },

            /**
             * @param {*} method
             * @param {*} url
             * @return {*}
             */
            open(method, url) {
                'use strict';
                const result = originals.open.apply(this, arguments);
                ZetaSource.quietly(null, ZetaSource.opened, state, this, method, url);
                return result;
            },

            /**
             * @param {*} name
             * @param {*} value
             * @return {*}
             */
            setRequestHeader(name, value) {
                'use strict';
                const result = originals.setRequestHeader.apply(this, arguments);
                ZetaSource.quietly(null, ZetaSource.headed, state, this, name, value);
                return result;
            },

            /**
             * @return {*}
             * @throws {*}
             */
            send() {
                'use strict';
                const created = ZetaSource.quietly(false, ZetaSource.sending, state, this);
                try {
                    return originals.send.apply(this, arguments);
                } catch (error) {
                    if (created) {
                        ZetaSource.quietly(null, ZetaSource.forget, this);
                    }
                    throw error;
                }
            },
        };
        for (const name of Object.keys(owners)) {
            installed[name] =
                originals[name] === null ? null : ZetaSource.quietly(null, ZetaSource.install, owners[name], name, wrappers[name], exporter);
        }
        const handle = Object.freeze({
            /**
             * @return {string|null}
             */
            token: () => state.token,

            /**
             * @param {(traffic: Readonly<{ method: string, path: string }>) => void} callback
             * @return {void}
             */
            onTraffic: (callback) => {
                state.callbacks.push(callback);
            },

            /**
             * @return {void}
             */
            stop: () => {
                state.stopped = true;
                for (const name of Object.keys(owners)) {
                    ZetaSource.quietly(null, ZetaSource.restore, owners[name], name, installed[name], originals[name]);
                }
                if (ZetaSource.Watchers.get(pageWindow) === handle) {
                    ZetaSource.Watchers.delete(pageWindow);
                }
            },
        });
        ZetaSource.quietly(
            null,
            /**
             * @param {object} target
             * @return {WeakMap<object, object>}
             */
            (target) => ZetaSource.Watchers.set(target, handle),
            pageWindow,
        );
        return handle;
    },

    /**
     * @param {{ token: *, roomId: *, pause: * }} request
     * @return {void}
     * @throws {Error}
     */
    ready(request) {
        const settings = ZetaSource.Settings;
        const words = settings.Messages;
        if (!ZetaSource.filled(request.token)) {
            throw ZetaSource.failure(words.NoLogin, null, false);
        }
        if (!ZetaSource.filled(request.roomId) || ZetaSource.quietly(null, encodeURIComponent, request.roomId) === null) {
            throw ZetaSource.failure(words.NoRoom, null, false);
        }
        if (typeof request.pause !== settings.FunctionType) {
            throw ZetaSource.failure(words.NoPause, null, false);
        }
    },

    /**
     * @param {{ pause: (milliseconds: number) => Promise<void> }} request
     * @param {number} milliseconds
     * @return {Promise<void>}
     * @throws {Error}
     */
    async wait(request, milliseconds) {
        const pause = request.pause;
        try {
            await pause(milliseconds);
        } catch {
            throw ZetaSource.failure(ZetaSource.Settings.Messages.NoPause, null, false);
        }
    },

    /**
     * @param {{ fetch: Function, token: string, roomId: string, pause: (milliseconds: number) => Promise<void> }} request
     * @param {string|null} cursor
     * @return {Promise<{ messages: object[], nextCursor: string|null, skipped: number }>}
     * @throws {Error}
     */
    async exchange(request, cursor) {
        const settings = ZetaSource.Settings;
        const words = settings.Messages;
        const query = new URLSearchParams();
        query.set(settings.LimitName, String(settings.PageSize));
        if (cursor !== null) {
            query.set(settings.CursorName, cursor);
        }
        const room = encodeURIComponent(request.roomId);
        const address = `${settings.ApiOrigin}${settings.RoomsPath}${room}${settings.MessagesPath}${settings.QueryMark}${query.toString()}`;
        const send = request.fetch;

        /**
         * @return {Promise<{ status: number, raw: string }>}
         */
        const reach = async () => {
            let response = null;
            try {
                response = await send(address, { headers: { [settings.AuthorizationHeader]: request.token } });
            } catch {
                throw ZetaSource.failure(words.Unreachable, null, true);
            }
            let status = null;
            try {
                const given = response.status;
                status = Number.isFinite(given) ? given : null;
            } catch {
                status = null;
            }
            if (status === null) {
                throw ZetaSource.failure(words.Shape, null, false);
            }
            if (status < settings.FirstSuccess || status > settings.LastSuccess) {
                const busy = status === settings.TooMany || status >= settings.FirstServerError;
                throw ZetaSource.failure(`${words.HttpPrefix}${status}`, status, busy);
            }
            try {
                return { status, raw: await response.text() };
            } catch {
                throw ZetaSource.failure(words.Shape, status, false);
            }
        };
        const answered = await Promise.race([
            reach(),
            ZetaSource.wait(request, settings.TimeoutMs).then(
                /**
                 * @return {null}
                 */
                () => null,
            ),
        ]);
        if (answered === null) {
            throw ZetaSource.failure(words.Timeout, null, true);
        }
        let body = null;
        try {
            body = JSON.parse(answered.raw);
        } catch {
            body = null;
        }
        if (!ZetaSource.isObject(body) || !Array.isArray(body.messages)) {
            throw ZetaSource.failure(words.Shape, answered.status, false);
        }
        const messages = [];
        for (const message of body.messages) {
            if (!ZetaSource.isObject(message)) {
                continue;
            }
            if (typeof message.id === settings.NumberType) {
                message.id = String(message.id);
            }
            if (ZetaSource.filled(message.id)) {
                messages.push(message);
            }
        }
        const skipped = body.messages.length - messages.length;
        if (messages.length === 0 && skipped > 0) {
            throw ZetaSource.failure(words.Shape, answered.status, false);
        }
        const offered = body.nextCursor;
        const finite = typeof offered === settings.NumberType && Number.isFinite(offered);
        const absent = offered === undefined || offered === null || offered === false;
        if (!finite && !absent && typeof offered !== settings.StringType) {
            throw ZetaSource.failure(words.Shape, answered.status, false);
        }
        const nextCursor = finite || ZetaSource.filled(offered) ? String(offered) : null;
        return { messages, nextCursor, skipped };
    },

    /**
     * @param {{ fetch: Function, token: string, roomId: string, pause: (milliseconds: number) => Promise<void> }} request
     * @param {string|null} cursor
     * @return {Promise<{ messages: object[], nextCursor: string|null, skipped: number }>}
     * @throws {Error}
     */
    async page(request, cursor) {
        const settings = ZetaSource.Settings;
        let failed = null;
        for (let number = settings.FirstTry; number <= settings.Tries; number++) {
            if (failed !== null) {
                await ZetaSource.wait(request, settings.RetryPauseMs * (number - settings.FirstTry));
            }
            try {
                return await ZetaSource.exchange(request, cursor);
            } catch (error) {
                if (error.retryable !== true) {
                    throw error;
                }
                failed = error;
            }
        }
        throw failed;
    },

    /**
     * @param {Array<{ id: string, messageTime: * }>} messages
     * @return {object[]}
     */
    ordered(messages) {
        const settings = ZetaSource.Settings;
        const seen = new Set();
        const kept = [];
        for (const message of messages) {
            if (!seen.has(message.id)) {
                seen.add(message.id);
                kept.push(message);
            }
        }
        const timed = [];
        let previous = Number.NEGATIVE_INFINITY;
        for (const message of kept.reverse()) {
            const parsed = typeof message.messageTime === settings.StringType ? Date.parse(message.messageTime) : Number.NaN;
            previous = Number.isNaN(parsed) ? previous : parsed;
            timed.push({ message, time: previous });
        }
        timed.sort(
            /**
             * @param {{ time: number }} first
             * @param {{ time: number }} second
             * @return {number}
             */
            (first, second) => Number(first.time > second.time) - Number(first.time < second.time),
        );
        return timed.map(
            /**
             * @param {{ message: object }} entry
             * @return {object}
             */
            (entry) => entry.message,
        );
    },

    /**
     * @param {object[]} received
     * @param {string} end
     * @param {string|null} problem
     * @param {number} skipped
     * @return {Readonly<{ messages: object[], end: string, problem: string|null, skipped: number }>}
     */
    outcome(received, end, problem, skipped) {
        return Object.freeze({ messages: ZetaSource.ordered(received), end, problem, skipped });
    },

    /**
     * @param {{ fetch: Function, token: string|null, roomId: string|null, pause: (milliseconds: number) => Promise<void>, onPage?: (count: number) => void }} request
     * @return {Promise<Readonly<{ messages: object[], end: string, problem: string|null, skipped: number }>>}
     * @throws {Error}
     */
    async history(request) {
        const settings = ZetaSource.Settings;
        const ends = ZetaSource.End;
        ZetaSource.ready(request);
        const received = [];
        const distinct = new Set();
        const used = new Set();
        let skipped = 0;
        let cursor = null;
        for (let read = 0; read < settings.MostPages; read++) {
            let page = null;
            try {
                if (cursor !== null) {
                    await ZetaSource.wait(request, settings.PauseMs);
                }
                page = await ZetaSource.page(request, cursor);
            } catch (error) {
                if (received.length === 0) {
                    throw error;
                }
                return ZetaSource.outcome(received, ends.Failed, error.message, skipped);
            }
            skipped += page.skipped;
            const before = distinct.size;
            for (const message of page.messages) {
                received.push(message);
                distinct.add(message.id);
            }
            if (typeof request.onPage === settings.FunctionType) {
                Promise.resolve(ZetaSource.quietly(null, request.onPage, distinct.size)).catch(
                    /**
                     * @return {null}
                     */
                    () => null,
                );
            }
            const next = page.nextCursor;
            let end = null;
            if (page.messages.length === 0) {
                end = ends.EmptyPage;
            } else if (distinct.size === before) {
                end = ends.NothingNew;
            } else if (next === null) {
                end = ends.NoCursor;
            } else if (used.has(next)) {
                end = ends.RepeatedCursor;
            }
            if (end !== null) {
                return ZetaSource.outcome(received, end, null, skipped);
            }
            cursor = next;
            used.add(cursor);
        }
        return ZetaSource.outcome(received, ends.Limit, null, skipped);
    },

    /**
     * @param {{ fetch: Function, token: string|null, roomId: string|null, pause: (milliseconds: number) => Promise<void> }} request
     * @return {Promise<Readonly<{ messages: object[], end: string, problem: string|null, skipped: number }>>}
     * @throws {Error}
     */
    async newest(request) {
        const ends = ZetaSource.End;
        ZetaSource.ready(request);
        const page = await ZetaSource.page(request, null);
        return ZetaSource.outcome(page.messages, page.messages.length === 0 ? ends.EmptyPage : ends.NoCursor, null, page.skipped);
    },
});
