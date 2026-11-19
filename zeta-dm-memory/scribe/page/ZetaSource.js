const ZetaSource = Object.freeze({
    End: Object.freeze({
        NoCursor: 'NoCursor',
        EmptyPage: 'EmptyPage',
        ThroughMessage: 'ThroughMessage',
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
        PlotsPath: '/v1/plots/',
        RoomsSegment: '/rooms/',
        PersonaPath: '/user-personas/selected',
        NotFound: 404,
        NameSeparator: ': ',
        PlotIdPaths: Object.freeze([Object.freeze(['plotId']), Object.freeze(['plot', 'id'])]),
        PlotField: 'plot',
        CharactersField: 'characters',
        NameField: 'name',
        DescriptionField: 'description',
        LongestProfile: 2000,
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
            NoPersona: 'Zeta answered the chat profile in an unexpected shape',
            Unreachable: 'Zeta could not be reached',
            Timeout: 'Zeta did not answer in time',
            NoPause: 'Could not pause between requests',
            NoLogin: 'No login seen yet',
            NoRoom: 'No chat is open',
            NoPlot: 'Zeta named no story for this chat',
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
        if (state.credentials) {
            const given = init?.headers;
            const headers = given === undefined || given === null ? (carried ? input.headers : null) : given;
            ZetaSource.remember(state, ZetaSource.authorization(headers));
        }
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
     * @param {string} path
     * @param {object} response
     * @param {string} address
     * @return {number|null}
     */
    postStatus(path, response, address) {
        if (!response || (address === 'url' && response.redirected === true)) {
            return null;
        }
        const finalUrl = response[address];
        if (finalUrl !== undefined) {
            const endpoint = new URL(finalUrl);
            if (endpoint.origin !== ZetaSource.Settings.ApiOrigin || endpoint.pathname !== path) {
                return null;
            }
        }
        return Number.isInteger(response.status) ? response.status : null;
    },

    /**
     * @param {{ callbacks: Function[], stopped: boolean }} state
     * @param {*} result
     * @param {Readonly<{ method: string, path: string }>|null} traffic
     * @return {void}
     */
    settled(state, result, traffic, receipt) {
        if (traffic === null) {
            return;
        }

        /**
         * @return {void}
         */
        const finished = (status) => {
            if (!state.stopped && typeof receipt === 'function') {
                ZetaSource.quietly(null, receipt, status);
            }
            ZetaSource.notify(state, traffic);
        };
        result.then((response) => {
            const status = receipt ? ZetaSource.quietly(null, ZetaSource.postStatus, traffic.path, response, 'url') : null;
            finished(status);
        }, () => finished(null));
    },

    /**
     * @param {object} state
     * @param {object|null} traffic
     * @return {Function|null}
     */
    posting(state, traffic) {
        if (!state.onPost || traffic?.method !== 'POST') {
            return null;
        }
        const room = /^\/v1\/rooms\/([^/]+)\/messages$/.exec(traffic.path);
        const id = room === null ? null : ZetaSource.quietly(null, decodeURIComponent, room[1]);
        return id === null ? null : ZetaSource.quietly(null, state.onPost, id);
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
        const receipt = ZetaSource.posting(state, record.traffic);
        record.listener = () => {
            if (ZetaSource.Requests.get(request) === record) {
                ZetaSource.Requests.delete(request);
            }
            if (!state.stopped && typeof receipt === 'function') {
                const status = ZetaSource.quietly(null, ZetaSource.postStatus, record.traffic.path, request, 'responseURL');
                ZetaSource.quietly(null, receipt, status);
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
     * @param {boolean} credentials
     * @return {Readonly<{ token: () => string|null, onTraffic: (callback: Function) => void, stop: () => void }>}
     */
    watch(pageWindow, exporter, credentials = true) {
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
        const owners = { fetch: pageWindow, open: prototype, ...(credentials ? { setRequestHeader: prototype } : {}), send: prototype };
        const originals = {};
        const installed = {};
        for (const name of Object.keys(owners)) {
            originals[name] = ZetaSource.quietly(null, ZetaSource.held, owners[name], name);
        }
        const state = { pageWindow, credentials, token: null, callbacks: [], onPost: null, stopped: false };
        const wrappers = {
            /**
             * @param {*} input
             * @return {*}
             */
            fetch(input) {
                'use strict';
                const init = arguments[ZetaSource.Settings.InitPosition];
                const traffic = ZetaSource.quietly(null, ZetaSource.fetched, state, input, init);
                const receipt = ZetaSource.quietly(null, ZetaSource.posting, state, traffic);
                const result = originals.fetch.apply(this, arguments);
                ZetaSource.quietly(null, ZetaSource.settled, state, result, traffic, receipt);
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
             * @param {Function} callback
             * @return {void}
             */
            onPost: (callback) => { state.onPost = callback; },

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
     * @param {{ fetch: Function, token: string, pause: (milliseconds: number) => Promise<void> }} request
     * @param {string} path
     * @return {Promise<{ status: number, body: * }>}
     * @throws {Error}
     */
    async get(request, path) {
        const settings = ZetaSource.Settings;
        const words = settings.Messages;
        const address = `${settings.ApiOrigin}${path}`;
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
        return { status: answered.status, body };
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
        const answered = await ZetaSource.get(
            request,
            `${settings.RoomsPath}${room}${settings.MessagesPath}${settings.QueryMark}${query.toString()}`,
        );
        const body = answered.body;
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
        return { messages, nextCursor, skipped, emptyRoom: cursor === null && body.messages.length === 0 && offered === null };
    },

    /**
     * @param {{ pause: (milliseconds: number) => Promise<void> }} request
     * @param {() => Promise<*>} read
     * @return {Promise<*>}
     * @throws {Error}
     */
    async retried(request, read) {
        const settings = ZetaSource.Settings;
        let failed = null;
        for (let number = settings.FirstTry; number <= settings.Tries; number++) {
            if (failed !== null) {
                await ZetaSource.wait(request, settings.RetryPauseMs * (number - settings.FirstTry));
            }
            try {
                return await read();
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
     * @param {{ fetch: Function, token: string, roomId: string, pause: (milliseconds: number) => Promise<void> }} request
     * @param {string|null} cursor
     * @return {Promise<{ messages: object[], nextCursor: string|null, skipped: number }>}
     * @throws {Error}
     */
    async page(request, cursor) {
        return ZetaSource.retried(
            request,
            /**
             * @return {Promise<{ messages: object[], nextCursor: string|null, skipped: number }>}
             */
            () => ZetaSource.exchange(request, cursor),
        );
    },

    /**
     * @param {*} body
     * @param {readonly string[]} path
     * @return {*}
     */
    at(body, path) {
        let value = body;
        for (const name of path) {
            if (!ZetaSource.isObject(value) || !Object.hasOwn(value, name)) {
                return null;
            }
            value = value[name];
        }
        return value;
    },

    /**
     * @param {*} body
     * @return {string|null}
     */
    plotOf(body) {
        const settings = ZetaSource.Settings;
        for (const path of settings.PlotIdPaths) {
            const value = ZetaSource.at(body, path);
            const finite = typeof value === settings.NumberType && Number.isFinite(value);
            if (finite || ZetaSource.filled(value)) {
                return String(value);
            }
        }
        return null;
    },

    /**
     * @param {{ fetch: Function, token: string|null, roomId: string|null, pause: Function }} request
     * @return {Promise<Readonly<{ characters: ReadonlyArray<Readonly<{ name: string, description: string }>>, plotId: string }>>}
     * @throws {Error}
     */
    async story(request) {
        const settings = ZetaSource.Settings;
        const words = settings.Messages;
        ZetaSource.ready(request);
        const room = await ZetaSource.retried(
            request,
            /**
             * @return {Promise<{ status: number, body: * }>}
             */
            () => ZetaSource.get(request, settings.RoomsPath + encodeURIComponent(request.roomId)),
        );
        const plot = ZetaSource.plotOf(room.body);
        if (plot === null) {
            throw ZetaSource.failure(words.NoPlot, room.status, false);
        }
        const listed = ZetaSource.at(room.body, [settings.PlotField, settings.CharactersField]);
        if (!Array.isArray(listed)) {
            throw Object.assign(ZetaSource.failure(words.Shape, room.status, false), { plotId: plot });
        }
        const characters = [];
        for (const item of listed) {
            if (!ZetaSource.isObject(item) || !ZetaSource.filled(item[settings.NameField])) {
                continue;
            }
            const description = item[settings.DescriptionField];
            characters.push(
                Object.freeze({
                    name: item[settings.NameField],
                    description: typeof description === settings.StringType ? description : settings.Nothing,
                }),
            );
        }
        return Object.freeze({ characters: Object.freeze(characters), plotId: plot });
    },

    /**
     * @param {{ fetch: Function, token: string|null, roomId: string|null, pause: Function }} request
     * @param {string|null} plotId
     * @return {Promise<string|null>}
     * @throws {Error}
     */
    async profile(request, plotId = null) {
        const settings = ZetaSource.Settings;
        ZetaSource.ready(request);
        if (!ZetaSource.filled(plotId)) {
            return null;
        }
        const path =
            settings.PlotsPath +
            encodeURIComponent(plotId) +
            settings.RoomsSegment +
            encodeURIComponent(request.roomId) +
            settings.PersonaPath;
        let read = null;
        try {
            read = await ZetaSource.retried(
                request,
                /**
                 * @return {Promise<{ status: number, body: * }>}
                 */
                () => ZetaSource.get(request, path),
            );
        } catch (error) {
            if (error.status === settings.NotFound) {
                return null;
            }
            throw error;
        }
        const description = ZetaSource.isObject(read.body) ? read.body[settings.DescriptionField] : undefined;
        const empty = description === null || description === undefined;
        if (!ZetaSource.isObject(read.body) || (!empty && typeof description !== settings.StringType)) {
            throw ZetaSource.failure(settings.Messages.NoPersona, read.status, false);
        }
        const detail = empty ? settings.Nothing : description.trim();
        if (detail === settings.Nothing) {
            return null;
        }
        const name = ZetaSource.at(read.body, [settings.NameField]);
        const title = typeof name === settings.StringType ? name.trim() : settings.Nothing;
        const text = title === settings.Nothing ? detail : `${title}${settings.NameSeparator}${detail}`;
        return Array.from(text).slice(0, settings.LongestProfile).join(settings.Nothing);
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
     * @param {{ fetch: Function, token: string|null, roomId: string|null, pause: (milliseconds: number) => Promise<void>, onPage?: (count: number) => void, through?: string|null }} request
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
            } else if (request.through && distinct.has(request.through)) {
                end = ends.ThroughMessage;
            } else if (used.has(next)) {
                end = ends.RepeatedCursor;
            }
            if (end !== null) {
                const result = ZetaSource.outcome(received, end, null, skipped);
                return page.emptyRoom ? Object.freeze({ ...result, emptyRoom: true }) : result;
            }
            cursor = next;
            used.add(cursor);
        }
        return ZetaSource.outcome(received, ends.Limit, null, skipped);
    },

    /**
     * @param {{ fetch: Function, token: string|null, roomId: string|null, pause: (milliseconds: number) => Promise<void>, through?: string|null }} request
     * @return {Promise<Readonly<{ messages: object[], end: string, problem: string|null, skipped: number }>>}
     * @throws {Error}
     */
    async newest(request) {
        if (request.through) {
            return ZetaSource.history(request);
        }
        const ends = ZetaSource.End;
        ZetaSource.ready(request);
        const page = await ZetaSource.page(request, null);
        const result = ZetaSource.outcome(page.messages, page.messages.length === 0 ? ends.EmptyPage : ends.NoCursor, null, page.skipped);
        return page.emptyRoom ? Object.freeze({ ...result, emptyRoom: true }) : result;
    },
});
