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
        CheapCheckPages: 2,
        PauseMs: 500,
        MostPages: 2000,
        Tries: 3,
        FirstTry: 1,
        RetryPauseMs: 2000,
        TimeoutMs: 30000,
        TooMany: 429,
        ReplyChunkSize: 8192,
        MaxEventChars: 16384,
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
        return ZetaSource.Settings.ReadMethods.includes(verb) && !(verb === 'GET' && ZetaSource.replyPath(path))
            ? null : Object.freeze({ method: verb, path });
    },

    /**
     * @param {string} path
     * @return {RegExpExecArray|null}
     */
    replyPath(path) {
        return /^\/v1\/rooms\/([^/]+)\/messages\/([^/]+)\/candidates\/stream$/.exec(path);
    },

    /**
     * @param {object} state
     * @param {object|null} traffic
     * @return {Function|null}
     */
    streaming(state, traffic) {
        if (!state.onStream || !traffic || !['GET', 'POST'].includes(traffic.method)) {
            return null;
        }
        const match = ZetaSource.replyPath(traffic.path);
        const finish = match ? state.onStream(decodeURIComponent(match[1]), decodeURIComponent(match[2])) : null;
        if (finish) {
            state.cancelReply?.();
            state.streamReceipt = finish;
        }
        return finish;
    },

    /**
     * @param {*} value
     * @return {string|null}
     */
    replyObject(value) {
        if (!ZetaSource.isObject(value)) {
            return null;
        }
        if (value.code === 'CHAT_ABUSED' || value.error?.code === 'CHAT_ABUSED') {
            return 'chatAbused';
        }
        if (value.status === 429 || value.error?.status === 429 || value.code === 'TOO_MANY_REQUEST' || value.error?.code === 'TOO_MANY_REQUEST') {
            return 'rateLimited';
        }
        return value.error || value.code || value.status >= 400 ? 'unknown' : 'ok';
    },

    /**
     * @param {string} event
     * @return {string|null}
     */
    replyEvent(event) {
        const lines = event.split(/\r?\n/);
        const data = lines.filter((line) => /^data:/.test(line)).map((line) => line.slice(5).trimStart()).join('\n');
        const errorEvent = lines.some((line) => /^event:\s*error\s*$/i.test(line));
        if (data === '[DONE]') {
            return errorEvent ? 'unknown' : 'done';
        }
        const result = ZetaSource.replyObject(ZetaSource.quietly(null, JSON.parse, data));
        return ['chatAbused', 'rateLimited'].includes(result) || !errorEvent ? result : 'unknown';
    },

    /**
     * @param {string} type
     * @return {Function}
     */
    replyParser(type) {
        const limit = ZetaSource.Settings.MaxEventChars;
        let format = /^text\/event-stream\b/i.test(type) ? 'events' : null;
        let pending = '';
        let oversized = false;
        let outcome = null;
        let endedWithCr = false;
        return (chunk, done) => {
            if (!format) {
                const start = chunk.trimStart();
                if (!start) {
                    return null;
                }
                format = start.startsWith('{') || start.startsWith('[') ? 'json' : 'events';
                chunk = start;
            }
            if (format === 'json') {
                oversized ||= pending.length + chunk.length > limit;
                pending = oversized ? '' : pending + chunk;
                return done && !oversized ? ZetaSource.replyObject(ZetaSource.quietly(null, JSON.parse, pending)) : null;
            }
            if (chunk) {
                if (endedWithCr && chunk.startsWith('\n')) {
                    chunk = chunk.slice(1);
                }
                endedWithCr = chunk.endsWith('\r');
                chunk = chunk.replace(/\r\n?/g, '\n');
            }
            const text = pending + chunk;
            const separator = /\n\n/g;
            let from = 0;
            let match;
            while ((match = separator.exec(text)) || done) {
                const end = match ? match.index : text.length;
                const result = oversized || end - from > limit ? 'skipped' : ZetaSource.replyEvent(text.slice(from, end));
                if (result === 'chatAbused' || result === 'rateLimited') {
                    return result;
                }
                if (result && outcome !== 'unknown' && (outcome !== 'skipped' || result !== 'ok')) {
                    outcome = result === 'done' ? 'ok' : result;
                }
                oversized = false;
                if (!match) {
                    return outcome;
                }
                from = separator.lastIndex;
            }
            oversized ||= text.length - from > limit;
            pending = oversized ? text.slice(Math.max(from, text.length - 1)) : text.slice(from);
            return null;
        };
    },

    /**
     * @param {object} state
     * @param {object} response
     * @param {number} status
     * @param {Function} finish
     * @return {Promise<void>}
     */
    async readReply(state, response, status, finish) {
        if (status === ZetaSource.Settings.TooMany) {
            finish('rateLimited');
            return;
        }
        if (!Number.isInteger(status) || typeof response.clone !== 'function') {
            return;
        }
        const reader = response.clone().body?.getReader();
        if (!reader) {
            return;
        }
        const settings = ZetaSource.Settings;
        let expired = false;
        const cancel = () => {
            expired = true;
            reader.cancel().catch(() => {});
        };
        state.cancelReply = cancel;
        let complete = false;
        try {
            const decoder = new TextDecoder();
            const parse = ZetaSource.replyParser(response.headers?.get('content-type') ?? '');
            while (!expired && !state.stopped) {
                const { done, value } = await reader.read();
                if (expired || state.stopped) {
                    return;
                }
                complete = done;
                for (let offset = 0; value && offset < value.length; offset += settings.ReplyChunkSize) {
                    const piece = value.subarray(offset, offset + settings.ReplyChunkSize);
                    const outcome = parse(decoder.decode(piece, { stream: true }), false);
                    if (outcome === 'chatAbused' || outcome === 'rateLimited') {
                        finish(outcome);
                        return;
                    }
                }
                if (done) {
                    const outcome = parse(decoder.decode(), true);
                    if (outcome === 'chatAbused' || outcome === 'rateLimited' || (outcome === 'ok' && status >= 200 && status < 300)) {
                        finish(outcome);
                    }
                    return;
                }
            }
        } finally {
            if (state.cancelReply === cancel) {
                state.cancelReply = null;
            }
            if (!complete && !expired) {
                cancel();
            }
            reader.releaseLock();
        }
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
    notify(state, traffic, replySucceeded = false) {
        if (state.stopped || (ZetaSource.replyPath(traffic.path) && (traffic.method === 'GET' || !replySucceeded))) {
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
    settled(state, result, traffic, receipt, stream) {
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
            ZetaSource.notify(state, traffic, !stream && status >= 200 && status < 300);
        };
        result.then((response) => {
            const status = receipt || ZetaSource.replyPath(traffic.path) ? ZetaSource.quietly(null, ZetaSource.postStatus, traffic.path, response, 'url') : null;
            if (stream && stream === state.streamReceipt && !state.stopped) {
                ZetaSource.readReply(state, response, status, (outcome) => {
                    stream(outcome);
                    if (outcome === 'ok') {
                        ZetaSource.notify(state, traffic, true);
                    }
                }).catch(() => {});
            }
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
            if (record.progress) {
                request.removeEventListener('progress', record.progress);
            }
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
     * @param {object} state
     * @param {object} request
     * @param {object} traffic
     * @param {Function} stream
     * @return {Function}
     */
    xhrReply(state, request, traffic, stream) {
        const size = ZetaSource.Settings.ReplyChunkSize;
        let offset = 0;
        let parse;
        let reported = false;
        return (status, done) => {
            if (reported || !Number.isInteger(status) || state.stopped || stream !== state.streamReceipt) {
                return;
            }
            let outcome = null;
            if (status === ZetaSource.Settings.TooMany) {
                outcome = 'rateLimited';
            } else if (request.responseType === 'json' && done) {
                outcome = ZetaSource.replyObject(request.response);
            } else if (!request.responseType || request.responseType === 'text') {
                const text = request.responseText;
                if (typeof text === 'string') {
                    parse ??= ZetaSource.replyParser(request.getResponseHeader?.('Content-Type') ?? '');
                    while (offset < text.length && !outcome) {
                        const end = Math.min(offset + size, text.length);
                        outcome = parse(text.slice(offset, end), false);
                        offset = end;
                    }
                    if (!outcome && done) {
                        outcome = parse('', true);
                    }
                }
            }
            if (outcome === 'chatAbused' || outcome === 'rateLimited' || (outcome === 'ok' && done && status >= 200 && status < 300)) {
                reported = true;
                stream(outcome);
                if (outcome === 'ok') {
                    ZetaSource.notify(state, traffic, true);
                }
            }
        };
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
        const stream = ZetaSource.quietly(null, ZetaSource.streaming, state, record.traffic);
        const observe = stream ? ZetaSource.xhrReply(state, request, record.traffic, stream) : null;
        const responseStatus = () => ZetaSource.quietly(null, ZetaSource.postStatus, record.traffic.path, request, 'responseURL');
        if (observe) {
            record.progress = () => ZetaSource.quietly(null, observe, responseStatus(), false);
            request.addEventListener('progress', record.progress);
        }
        record.listener = () => {
            if (ZetaSource.Requests.get(request) === record) {
                ZetaSource.forget(request);
            }
            const status = !state.stopped && (receipt || ZetaSource.replyPath(record.traffic.path)) ? responseStatus() : null;
            if (!state.stopped && typeof receipt === 'function') {
                ZetaSource.quietly(null, receipt, status);
            }
            if (observe) {
                ZetaSource.quietly(null, observe, status, true);
            }
            ZetaSource.notify(state, record.traffic, !stream && status >= 200 && status < 300);
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
                const stream = ZetaSource.quietly(null, ZetaSource.streaming, state, traffic);
                const result = originals.fetch.apply(this, arguments);
                ZetaSource.quietly(null, ZetaSource.settled, state, result, traffic, receipt, stream);
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
             * @param {Function} callback
             * @return {void}
             */
            onStream: (callback) => { state.onStream = callback; },

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
                state.cancelReply?.();
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
        const locations = new Map();
        const boundaries = new Map();
        const used = new Set();
        let skipped = 0;
        let cursor = null;
        for (let read = 0; read < settings.MostPages; read++) {
            if (read === settings.CheapCheckPages && request.allowExpensive && !request.allowExpensive()) {
                return { deferredCheck: true };
            }
            let page = null;
            try {
                if (cursor !== null) {
                    await ZetaSource.wait(request, settings.PauseMs);
                }
                page = cursor === null && request.firstPage ? request.firstPage : await ZetaSource.page(request, cursor);
            } catch (error) {
                if (received.length === 0) {
                    throw error;
                }
                return ZetaSource.outcome(received, ends.Failed, error.message, skipped);
            }
            skipped += page.skipped;
            const before = distinct.size;
            if (request.index && page.messages.length) {
                boundaries.set(cursor, received.length);
            }
            for (const message of page.messages) {
                received.push(message);
                distinct.add(message.id);
                if (!locations.has(message.id)) {
                    locations.set(message.id, cursor);
                }
            }
            if (request.index && !skipped && read === settings.CheapCheckPages - 1) {
                request.index.cheapDepth = received.length;
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
            } else if (request.through && distinct.has(request.through) && (request.required ?? []).every((id) => distinct.has(id))) {
                end = ends.ThroughMessage;
            } else if (used.has(next)) {
                end = ends.RepeatedCursor;
            }
            if (end !== null) {
                const result = ZetaSource.outcome(received, end, null, skipped);
                const complete = !skipped && (end === ends.NoCursor || end === ends.EmptyPage);
                if (complete && request.index) {
                    request.index.locations = locations;
                    const head = received.length - 1;
                    request.index.boundaries = new Map([...boundaries].map(([key, offset]) =>
                        [key, { first: head - offset, head }]));
                    const transport = received.map((row) => row.id).reverse();
                    request.index.transport = transport;
                    request.index.order = new Map(transport.map((id, position) => [id, position]));
                    const unique = [...distinct].reverse();
                    request.index.disordered = result.messages.some((row, position) => unique[position] !== row.id);
                }
                return Object.freeze({ ...result, ...(complete ? { completeHistory: true } : {}),
                    ...(page.emptyRoom ? { emptyRoom: true } : {}) });
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
        if (request.through && !request.index) {
            return ZetaSource.history(request);
        }
        const ends = ZetaSource.End;
        ZetaSource.ready(request);
        const page = await ZetaSource.page(request, null);
        const result = ZetaSource.outcome(page.messages, page.messages.length === 0 ? ends.EmptyPage : ends.NoCursor, null, page.skipped);
        if (request.index && !page.skipped) {
            request.index.headIds = new Set(page.messages.map((row) => row.id));
            request.index.completeHead = page.nextCursor === null && (page.messages.length > 0 || page.emptyRoom);
        }
        if (request.index && (request.through || request.index.disordered)) {
            const limited = request.check && (request.index.expirations >= 2 || request.check.previouslyLimited &&
                (request.check.cooling || request.index.expirations !== 0));
            const repair = { needsHistory: true,
                ...(limited ? { expiredCheck: true } : {}) };
            if (!page.skipped && page.nextCursor === null && (page.messages.length || page.emptyRoom)) {
                return { ...result, completeHistory: true, emptyRoom: page.emptyRoom };
            }
            if (page.skipped || !page.messages.length) {
                return repair;
            }
            const known = request.index.order;
            if (!known || !request.known.length) {
                return repair;
            }
            const timeline = new Map(request.known.map((message) => [message.id, message]));
            const headIds = page.messages.map((message) => message.id).reverse();
            const transport = request.index.transport;
            let join = Math.max(transport.length - headIds.length, 0);
            while (join < transport.length && !headIds.every((id, offset) =>
                join + offset < transport.length ? transport[join + offset] === id : !known.has(id))) {
                join++;
            }
            if (join === transport.length) {
                return repair;
            }
            for (let position = transport.length; position < join + headIds.length; position++) {
                const id = headIds[position - join];
                transport.push(id);
                known.set(id, position);
            }
            const head = transport.length - 1;
            const observed = new Set(headIds);
            const verified = new Map();
            const locations = request.index.locations;
            const fetched = new Map();
            let direct = false;
            const latest = request.known.at(-1);
            for (const id of new Set([...(request.required ?? []), latest.id])) {
                let cursor = locations.get(id);
                let adjacent = null;
                if (cursor === null && !observed.has(id)) {
                    cursor = page.nextCursor;
                    adjacent = join - 1;
                }
                let attempts = 0;
                while (!observed.has(id)) {
                    if (request.index.expirations >= 2 && !request.check) {
                        return ZetaSource.history({ ...request, through: request.index.disordered || transport.length !== known.size
                            ? null : request.through, firstPage: page, required: [...(request.required ?? []), latest.id] });
                    }
                    if (cursor == null || !known.has(id) || attempts++ >= 3) {
                        return repair;
                    }
                    if (fetched.has(cursor)) {
                        const previous = fetched.get(cursor);
                        cursor = previous.next;
                        adjacent = previous.last - 1;
                        continue;
                    }
                    await ZetaSource.wait(request, ZetaSource.Settings.PauseMs);
                    let older;
                    try {
                        older = await ZetaSource.page(request, cursor);
                    } catch (error) {
                        if ([400, ZetaSource.Settings.NotFound, 410].includes(error.status)) {
                            request.index.expirations = (request.index.expirations ?? 0) + 1;
                            if (request.check && (request.index.expirations >= 2 || limited)) {
                                return ZetaSource.history({ ...request, firstPage: page,
                                    through: request.index.disordered || transport.length !== known.size ? null : request.through,
                                    required: [...(request.required ?? []), latest.id], allowExpensive: request.check.reserve });
                            }
                            return repair;
                        }
                        throw error;
                    }
                    const rows = older.messages;
                    const boundary = request.index.boundaries.get(cursor);
                    const candidates = adjacent === null && boundary ? [boundary.first, boundary.first + head - boundary.head] : [adjacent];
                    const first = candidates.find((start) => Number.isInteger(start) && rows.length > 0 &&
                        rows.every((row, offset) => transport[start - offset] === row.id) &&
                        (older.nextCursor === null) === (start - rows.length + 1 === 0));
                    if (older.skipped || first === undefined) {
                        return repair;
                    }
                    request.index.boundaries.set(cursor, { first, head });
                    direct ||= locations.get(id) === cursor;
                    adjacent = first - rows.length;
                    fetched.set(cursor, { next: older.nextCursor, last: adjacent + 1 });
                    for (const [offset, row] of rows.entries()) {
                        if (known.get(row.id) !== first - offset) {
                            continue;
                        }
                        locations.set(row.id, cursor);
                        if (!observed.has(row.id)) {
                            verified.set(row.id, row);
                        }
                        observed.add(row.id);
                    }
                    cursor = older.nextCursor;
                }
            }
            if (direct) {
                request.index.expirations = 0;
            }
            for (const id of headIds) {
                locations.set(id, null);
            }
            for (const row of result.messages) {
                verified.set(row.id, row);
            }
            const additions = result.messages.filter((row) => !timeline.has(row.id));
            const suffix = [verified.get(latest.id), ...additions];
            const orderedSuffix = ZetaSource.ordered([...suffix].reverse());
            if (orderedSuffix.some((row, position) => row.id !== suffix[position].id) ||
                [...verified.values()].some((row) => timeline.has(row.id) && timeline.get(row.id).messageTime !== row.messageTime)) {
                return repair;
            }
            for (const row of suffix) {
                verified.delete(row.id);
            }
            return { ...result, end: ends.ThroughMessage, messages: suffix, verified: [...verified.values()] };
        }
        if (request.index && !page.skipped) {
            for (const row of page.messages) {
                request.index.locations.set(row.id, null);
            }
        }
        return page.emptyRoom ? Object.freeze({ ...result, emptyRoom: true }) : result;
    },
});
