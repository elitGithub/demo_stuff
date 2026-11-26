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
        SavedRoomsLimit: 20,
        MessagesPath: '/messages',
        PlotsPath: '/v1/plots/',
        RoomsSegment: '/rooms/',
        PersonaPath: '/user-personas/selected',
        NotFound: 404,
        NameSeparator: ': ',
        PlotIdPaths: Object.freeze([Object.freeze(['plotId']), Object.freeze(['plot', 'id'])]),
        PlotField: 'plot',
        IdField: 'id',
        TitleField: 'title',
        IntroIdField: 'introId',
        CreatedAtField: 'createdAt',
        ShortDescriptionField: 'shortDescription',
        LongDescriptionField: 'longDescription',
        AboutField: 'about',
        CreatorCommentField: 'creatorComment',
        LanguageField: 'language',
        ModeField: 'mode',
        HashtagsField: 'hashtags',
        CharactersField: 'characters',
        ChatProfilesField: 'chatProfiles',
        SummaryField: 'summary',
        IntrosField: 'intros',
        ConversationField: 'conversation',
        MessagesField: 'messages',
        ContentField: 'content',
        TextField: 'text',
        SpeakerNameField: 'speakerName',
        SenderIdField: 'senderId',
        SenderTypeField: 'senderType',
        NarratorSenderId: '_NARRATOR_',
        NarratorSpeaker: 'Narrator',
        UserSenderType: 'USER',
        UserPlaceholder: '{{user}}',
        LorebooksField: 'lorebooks',
        LoreNameFields: Object.freeze(['name', 'title', 'key']),
        LoreKeysField: 'keys',
        LoreTextFields: Object.freeze(['content', 'description', 'text', 'value']),
        PersonaSource: 'Persona',
        RawPlotFields: Object.freeze([
            'characters',
            'chatProfiles',
            'intros',
            'lorebooks',
            'conversations',
            'plugins',
            'infoBoxSetting',
            'cyoaSetting',
            'creator',
            'isLongDescriptionPublic',
            'isExampleConversationPublic',
            'isAboutPublic',
        ]),
        ListSeparator: ', ',
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
        get PlotPath() {
            return /^(?:\/[a-z]{2,3}(?:-[a-z0-9]{2,8})?)?\/plots\/([^/]+)/i;
        },

        /**
         * @return {RegExp}
         */
        get QueryOrHash() {
            return /[?#]/;
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
            EmptyContinuation: 'Zeta returned an empty history page with a link to more messages',
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
     * @param {*} pathname
     * @return {string|null}
     */
    plotPage(pathname) {
        const settings = ZetaSource.Settings;
        if (typeof pathname !== settings.StringType) {
            return null;
        }
        const cleanPath = pathname.split(settings.QueryOrHash, 1)[0];
        const match = settings.PlotPath.exec(cleanPath);
        if (match === null) {
            return null;
        }
        const decoded = ZetaSource.quietly(null, decodeURIComponent, match[settings.IdGroup]);
        return ZetaSource.roomId(decoded) ? decoded : null;
    },

    /**
     * @param {*} value
     * @return {string}
     */
    trimmed(value) {
        const settings = ZetaSource.Settings;
        return typeof value === settings.StringType ? value.trim() : settings.Nothing;
    },

    /**
     * @param {*} value
     * @return {string|null}
     */
    optionalText(value) {
        const text = ZetaSource.trimmed(value);
        return text === ZetaSource.Settings.Nothing ? null : text;
    },

    /**
     * @param {*} value
     * @return {string|null}
     */
    identifier(value) {
        const settings = ZetaSource.Settings;
        if (typeof value === settings.NumberType && Number.isFinite(value)) {
            return String(value);
        }
        return ZetaSource.optionalText(value);
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
     * @param {*} value
     * @return {boolean}
     */
    roomId(value) {
        const settings = ZetaSource.Settings;
        if (typeof value !== settings.StringType) {
            return false;
        }
        const trimmed = value.trim();
        return trimmed !== settings.Nothing && trimmed !== '.' && trimmed !== '..' &&
            ZetaSource.quietly(null, encodeURIComponent, value) !== null;
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
     * @return {URL|null}
     */
    apiAddress(state, address) {
        const resolved = new URL(address, state.pageWindow.location.href);
        return resolved.origin === ZetaSource.Settings.ApiOrigin ? resolved : null;
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
     * @param {object} state
     * @param {URL} url
     * @param {string} method
     * @return {object|null}
     */
    hostRequest(state, url, method) {
        const path = url.pathname;
        const verb = String(method).toUpperCase();
        const route = state.onMessages && /^\/v1\/rooms\/([^/]+)\/messages$/.exec(path);
        if (route && (verb === 'POST' || verb === 'GET' && [...url.searchParams.keys()].every((key) => key === 'limit'))) {
            return { path, method: verb, room: decodeURIComponent(route[1]) };
        }
        if (state.onMessages && verb === 'PUT') {
            const edit = /^\/v1\/rooms\/([^/]+)\/messages\/([^/]+)(?:\/candidates\/([^/]+))?$/.exec(path);
            if (edit) {
                return { path, method: verb, room: decodeURIComponent(edit[1]), message: decodeURIComponent(edit[2]),
                    candidate: edit[3] === undefined ? null : decodeURIComponent(edit[3]) };
            }
        }
        return ZetaSource.traffic(path, verb);
    },

    /**
     * @param {*} contents
     * @return {boolean}
     */
    contents(contents) {
        return Array.isArray(contents) && contents.every((block) => ZetaSource.isObject(block) &&
            ZetaSource.filled(block.type) && (block.type !== 'TEXT' || typeof block.text === 'string'));
    },

    /**
     * @param {string} room
     * @param {*} row
     * @return {boolean}
     */
    canonical(room, row) {
        return ZetaSource.isObject(row) && ZetaSource.filled(row.id) &&
            (row.roomId === undefined || row.roomId === room) && ZetaSource.filled(row.sender?.type) &&
            typeof row.messageTime === 'string' && Number.isFinite(Date.parse(row.messageTime)) &&
            ZetaSource.contents(row.contents);
    },

    /**
     * @param {string} room
     * @param {*} page
     * @return {boolean}
     */
    validPage(room, page) {
        return ZetaSource.isObject(page) && typeof page.head === 'boolean' && typeof page.complete === 'boolean' &&
            (!page.complete || page.head) && Number.isFinite(page.observedAt) && page.observedAt > 0 &&
            Array.isArray(page.messages) && (page.created === undefined || page.created === true && !page.head && page.messages.length === 1) &&
            (page.replacement === undefined || page.replacement === true && !page.head && !page.created && page.messages.length === 1) &&
            (page.candidate === undefined || !page.head && !page.created && !page.replacement && !page.messages.length &&
                ZetaSource.isObject(page.candidate) && ZetaSource.filled(page.candidate.message) && ZetaSource.filled(page.candidate.id) &&
                ZetaSource.contents(page.candidate.contents)) &&
            (page.ambiguous === undefined || page.ambiguous === true && !page.complete) &&
            page.messages.every((row) => ZetaSource.canonical(room, row));
    },

    /**
     * @param {object} state
     * @param {object|null} traffic
     * @return {Function|null}
     */
    observing(state, traffic) {
        if (!traffic?.room) {
            return null;
        }
        const deliver = state.onMessages(traffic.room);
        if (typeof deliver !== 'function') {
            return null;
        }
        const clock = state.pageWindow.performance;
        const observedAt = Number.isFinite(clock?.timeOrigin) ? clock.timeOrigin + clock.now() : Date.now();
        return (body) => {
            if (state.stopped || !ZetaSource.isObject(body)) {
                return;
            }
            if (traffic.method === 'PUT') {
                if (traffic.candidate !== null) {
                    if (body.id === traffic.candidate && body.edited === true && ZetaSource.contents(body.contents)) {
                        deliver({ messages: [], head: false, complete: false, observedAt,
                            candidate: { message: traffic.message, id: body.id, contents: body.contents } });
                    }
                } else if (ZetaSource.canonical(traffic.room, body.message) && body.message.roomId === traffic.room &&
                    body.message.id === traffic.message) {
                    deliver({ messages: [body.message], head: false, complete: false, observedAt, replacement: true });
                }
                return;
            }
            if (traffic.method === 'POST') {
                if (ZetaSource.canonical(traffic.room, body)) {
                    deliver({ messages: [body], head: false, complete: false, observedAt, created: true });
                }
                return;
            }
            if (!Array.isArray(body.messages) || !body.messages.every((row) => ZetaSource.canonical(traffic.room, row))) {
                return;
            }
            const messages = ZetaSource.ordered(body.messages);
            if (messages.length !== body.messages.length) {
                const byId = new Map(messages.map((row) => [row.id, row]));
                if (body.messages.some((row) => !ScribeFork.equal(row, byId.get(row.id)))) {
                    return;
                }
            }
            const cursor = body.nextCursor;
            if (cursor === null || ZetaSource.filled(cursor) || Number.isFinite(cursor)) {
                deliver({ messages, head: true, complete: cursor === null, observedAt });
            }
        };
    },

    /**
     * @param {object} state
     * @param {object|null} traffic
     * @param {*} input
     * @param {*} init
     * @return {Function|null}
     */
    forking(state, traffic, input, init) {
        if (!state.onFork || traffic?.method !== 'POST') {
            return null;
        }
        const match = /^\/v1\/rooms\/([^/]+)\/clone$/.exec(traffic.path);
        if (!match) {
            return null;
        }
        const parentRoomId = decodeURIComponent(match[1]);
        let messageId;
        if (typeof init?.body === 'string') {
            messageId = JSON.parse(init.body)?.messageId;
        } else if (init?.body == null && Object.prototype.toString.call(input) === ZetaSource.Settings.RequestTag) {
            messageId = input.clone().json().then((body) => body?.messageId, () => null);
        } else {
            return null;
        }
        return async (response) => {
            const selected = await messageId;
            const childRoomId = response?.id;
            if (!state.stopped && typeof selected === 'string' && selected.trim() !== '' &&
                ZetaSource.roomId(parentRoomId) && ZetaSource.roomId(childRoomId) && childRoomId !== parentRoomId) {
                state.onFork({ parentRoomId, childRoomId, messageId: selected });
            }
        };
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
        const address = ZetaSource.apiAddress(state, carried ? input.url : String(input));
        if (address === null) {
            return null;
        }
        if (state.credentials) {
            const given = init?.headers;
            const headers = given === undefined || given === null ? (carried ? input.headers : null) : given;
            ZetaSource.remember(state, ZetaSource.authorization(headers));
        }
        return ZetaSource.hostRequest(state, address, init?.method ?? (carried ? input.method : settings.ReadMethod));
    },

    /**
     * @param {{ callbacks: Function[], stopped: boolean }} state
     * @param {Readonly<{ method: string, path: string }>} traffic
     * @return {void}
     */
    notify(state, traffic, replySucceeded = false) {
        if (state.stopped || traffic.method === 'GET' || (ZetaSource.replyPath(traffic.path) && !replySucceeded)) {
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
    settled(state, result, traffic, receipt, stream, observe) {
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
            const status = observe || receipt || ZetaSource.replyPath(traffic.path) ? ZetaSource.quietly(null, ZetaSource.postStatus, traffic.path, response, 'url') : null;
            if (observe && !state.stopped && status >= 200 && status < 300 && typeof response.clone === 'function') {
                const copy = ZetaSource.quietly(null, () => response.clone());
                if (copy && typeof copy.text === 'function') {
                    copy.text().then((raw) => observe(JSON.parse(raw))).catch(() => {});
                }
            }
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
        const url = ZetaSource.apiAddress(state, String(address));
        if (url !== null) {
            ZetaSource.Requests.set(request, { traffic: ZetaSource.hostRequest(state, url, method), listener: null });
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
        const messages = ZetaSource.quietly(null, ZetaSource.observing, state, record.traffic);
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
            const status = !state.stopped && (messages || receipt || ZetaSource.replyPath(record.traffic.path)) ? responseStatus() : null;
            if (messages && status >= 200 && status < 300) {
                ZetaSource.quietly(null, () => {
                    if (request.responseType === 'json') {
                        messages(JSON.parse(JSON.stringify(request.response)));
                    } else if (!request.responseType || request.responseType === 'text') {
                        messages(JSON.parse(request.responseText));
                    }
                });
            }
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
                const observe = ZetaSource.quietly(null, ZetaSource.forking, state, traffic, input, init) ??
                    ZetaSource.quietly(null, ZetaSource.observing, state, traffic);
                const result = originals.fetch.apply(this, arguments);
                ZetaSource.quietly(null, ZetaSource.settled, state, result, traffic, receipt, stream, observe);
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
             * @param {Function} callback
             * @return {void}
             */
            onMessages: (callback) => { state.onMessages = callback; },

            /**
             * @param {function({parentRoomId: string, childRoomId: string, messageId: string}): void} callback
             * @return {void}
             */
            onFork: (callback) => { state.onFork = callback; },

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
     * @param {{ token: *, pause: *, signal?: AbortSignal }} request
     * @return {void}
     * @throws {Error}
     */
    readyRequest(request) {
        const settings = ZetaSource.Settings;
        const words = settings.Messages;
        if (!ZetaSource.isObject(request)) {
            throw ZetaSource.failure(words.NoLogin, null, false);
        }
        request.signal?.throwIfAborted();
        if (!ZetaSource.filled(request.token)) {
            throw ZetaSource.failure(words.NoLogin, null, false);
        }
        if (typeof request.pause !== settings.FunctionType) {
            throw ZetaSource.failure(words.NoPause, null, false);
        }
    },

    /**
     * @param {{ token: *, roomId: *, pause: *, signal?: AbortSignal }} request
     * @return {void}
     * @throws {Error}
     */
    ready(request) {
        const settings = ZetaSource.Settings;
        const words = settings.Messages;
        if (!ZetaSource.isObject(request)) {
            throw ZetaSource.failure(words.NoLogin, null, false);
        }
        request.signal?.throwIfAborted();
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
     * @param {AbortSignal|undefined} signal
     * @param {Function} run
     * @return {Promise<*>}
     * @throws {Error}
     */
    async abortable(signal, run) {
        if (!signal) {
            return run();
        }
        signal.throwIfAborted();
        let cancel;
        const stopped = new Promise((resolve, reject) => {
            cancel = () => reject(signal.reason);
            signal.addEventListener('abort', cancel, { once: true });
        });
        try {
            return await Promise.race([stopped, run()]);
        } finally {
            signal.removeEventListener('abort', cancel);
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
            await ZetaSource.abortable(request.signal, () => pause(milliseconds, request.signal));
        } catch {
            request.signal?.throwIfAborted();
            throw ZetaSource.failure(ZetaSource.Settings.Messages.NoPause, null, false);
        }
    },

    /**
     * @param {{ fetch: Function, token: string, pause: (milliseconds: number) => Promise<void> }} request
     * @param {string} path
     * @return {Promise<{ status: number, body: * }>}
     * @throws {Error}
     */
    async get(request, path, fresh = false) {
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
                response = await send(address, { headers: { [settings.AuthorizationHeader]: request.token },
                    ...(request.signal ? { signal: request.signal } : {}), ...(fresh ? { cache: 'no-store' } : {}) });
            } catch {
                request.signal?.throwIfAborted();
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
                request.signal?.throwIfAborted();
                throw ZetaSource.failure(words.Shape, status, false);
            }
        };
        const answered = await ZetaSource.abortable(request.signal, () => Promise.race([
            reach(),
            ZetaSource.wait({ pause: request.pause, signal: request.signal }, settings.TimeoutMs).then(
                /**
                 * @return {null}
                 */
                () => null,
            ),
        ]));
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
            request.signal?.throwIfAborted();
            if (failed !== null) {
                await ZetaSource.wait(request, settings.RetryPauseMs * (number - settings.FirstTry));
            }
            try {
                return await read();
            } catch (error) {
                request.signal?.throwIfAborted();
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
            const resolved = ZetaSource.identifier(ZetaSource.at(body, path));
            if (resolved !== null) {
                return resolved;
            }
        }
        return null;
    },

    /**
     * @param {*} rawPlot
     * @param {string|number|null} fallbackPlotId
     * @param {string|number|null} introId
     * @return {Readonly<{ plotId: string, name: string, summary: string, description: string, about: string, creatorComment: string, language: string|null, mode: string|null, hashtags: ReadonlyArray<string>, characters: ReadonlyArray<Readonly<{ id: string|null, name: string, description: string }>>, chatProfiles: ReadonlyArray<Readonly<{ id: string|null, name: string, summary: string, description: string }>>, opening: ReadonlyArray<Readonly<{ speaker: string, text: string }>>, lore: ReadonlyArray<Readonly<{ name: string, text: string }>>, raw: Readonly<object> }>}
     * @throws {Error}
     */
    parsePlot(rawPlot, fallbackPlotId = null, introId = null) {
        const settings = ZetaSource.Settings;
        const words = settings.Messages;
        if (!ZetaSource.isObject(rawPlot)) {
            throw ZetaSource.failure(words.NoPlot, null, false);
        }
        const plotId = ZetaSource.identifier(rawPlot[settings.IdField]) ?? ZetaSource.identifier(fallbackPlotId);
        if (plotId === null) {
            throw ZetaSource.failure(words.NoPlot, null, false);
        }
        const name = ZetaSource.trimmed(rawPlot[settings.NameField]);
        const summary = ZetaSource.trimmed(rawPlot[settings.ShortDescriptionField]);
        const description = ZetaSource.trimmed(rawPlot[settings.LongDescriptionField]);
        const about = ZetaSource.trimmed(rawPlot[settings.AboutField]);
        const creatorComment = ZetaSource.trimmed(rawPlot[settings.CreatorCommentField]);
        const language = ZetaSource.optionalText(rawPlot[settings.LanguageField]);
        const mode = ZetaSource.optionalText(rawPlot[settings.ModeField]);
        const hashtags = [];
        if (Array.isArray(rawPlot[settings.HashtagsField])) {
            for (const tag of rawPlot[settings.HashtagsField]) {
                const clean = ZetaSource.trimmed(tag);
                if (clean !== settings.Nothing) {
                    hashtags.push(clean);
                }
            }
        }
        const characters = [];
        const characterNames = new Map();
        if (Array.isArray(rawPlot[settings.CharactersField])) {
            for (const item of rawPlot[settings.CharactersField]) {
                if (!ZetaSource.isObject(item)) {
                    continue;
                }
                const characterName = ZetaSource.trimmed(item[settings.NameField]);
                if (characterName === settings.Nothing) {
                    continue;
                }
                const characterId = ZetaSource.identifier(item[settings.IdField]);
                const characterDescription = ZetaSource.trimmed(item[settings.DescriptionField]);
                characters.push(
                    Object.freeze({
                        id: characterId,
                        name: characterName,
                        description: characterDescription,
                    }),
                );
                if (characterId !== null && !characterNames.has(characterId)) {
                    characterNames.set(characterId, characterName);
                }
            }
        }
        const chatProfiles = [];
        if (Array.isArray(rawPlot[settings.ChatProfilesField])) {
            for (const item of rawPlot[settings.ChatProfilesField]) {
                if (!ZetaSource.isObject(item)) {
                    continue;
                }
                const profileName = ZetaSource.trimmed(item[settings.NameField]);
                const profileSummary = ZetaSource.trimmed(item[settings.SummaryField]);
                const profileDescription = ZetaSource.trimmed(item[settings.DescriptionField]);
                if (
                    profileName === settings.Nothing &&
                    profileSummary === settings.Nothing &&
                    profileDescription === settings.Nothing
                ) {
                    continue;
                }
                chatProfiles.push(
                    Object.freeze({
                        id: ZetaSource.identifier(item[settings.IdField]),
                        name: profileName,
                        summary: profileSummary,
                        description: profileDescription,
                    }),
                );
            }
        }
        const opening = [];
        const intros = rawPlot[settings.IntrosField];
        if (Array.isArray(intros) && intros.length > 0) {
            const wantedIntroId = ZetaSource.identifier(introId);
            let chosenIntro = null;
            if (wantedIntroId !== null) {
                for (const candidate of intros) {
                    if (ZetaSource.isObject(candidate) && ZetaSource.identifier(candidate[settings.IdField]) === wantedIntroId) {
                        chosenIntro = candidate;
                        break;
                    }
                }
            }
            if (chosenIntro === null) {
                chosenIntro = intros[0];
            }
            const conversation = ZetaSource.isObject(chosenIntro) ? chosenIntro[settings.ConversationField] : null;
            const introMessages =
                ZetaSource.isObject(conversation) && Array.isArray(conversation[settings.MessagesField])
                    ? conversation[settings.MessagesField]
                    : [];
            for (const entry of introMessages) {
                if (!ZetaSource.isObject(entry)) {
                    continue;
                }
                const content = entry[settings.ContentField];
                let messageText = settings.Nothing;
                if (typeof content === settings.StringType) {
                    messageText = content.trim();
                } else if (ZetaSource.isObject(content)) {
                    messageText = ZetaSource.trimmed(content[settings.TextField]);
                }
                if (messageText === settings.Nothing) {
                    continue;
                }
                let speaker = ZetaSource.trimmed(entry[settings.SpeakerNameField]);
                if (speaker === settings.Nothing) {
                    const senderId = ZetaSource.identifier(entry[settings.SenderIdField]);
                    if (senderId === settings.NarratorSenderId) {
                        speaker = settings.NarratorSpeaker;
                    } else if (senderId !== null && characterNames.has(senderId)) {
                        speaker = characterNames.get(senderId);
                    } else if (entry[settings.SenderTypeField] === settings.UserSenderType) {
                        speaker = settings.UserPlaceholder;
                    }
                }
                opening.push(Object.freeze({ speaker, text: messageText }));
            }
        }
        const lore = [];
        if (Array.isArray(rawPlot[settings.LorebooksField])) {
            for (const entry of rawPlot[settings.LorebooksField]) {
                if (!ZetaSource.isObject(entry)) {
                    continue;
                }
                let loreText = settings.Nothing;
                for (const field of settings.LoreTextFields) {
                    const candidate = ZetaSource.trimmed(entry[field]);
                    if (candidate !== settings.Nothing) {
                        loreText = candidate;
                        break;
                    }
                }
                if (loreText === settings.Nothing) {
                    continue;
                }
                let loreName = settings.Nothing;
                for (const field of settings.LoreNameFields) {
                    const candidate = ZetaSource.trimmed(entry[field]);
                    if (candidate !== settings.Nothing) {
                        loreName = candidate;
                        break;
                    }
                }
                if (loreName === settings.Nothing && Array.isArray(entry[settings.LoreKeysField])) {
                    const keys = [];
                    for (const key of entry[settings.LoreKeysField]) {
                        const clean = ZetaSource.trimmed(key);
                        if (clean !== settings.Nothing) {
                            keys.push(clean);
                        }
                    }
                    loreName = keys.join(settings.ListSeparator);
                }
                lore.push(Object.freeze({ name: loreName, text: loreText }));
            }
        }
        const raw = {};
        for (const field of settings.RawPlotFields) {
            if (!Object.hasOwn(rawPlot, field)) {
                continue;
            }
            const cloned = ZetaSource.quietly(
                undefined,
                /**
                 * @return {*}
                 */
                () => {
                    const encoded = JSON.stringify(rawPlot[field]);
                    return encoded === undefined ? undefined : JSON.parse(encoded);
                },
            );
            if (cloned !== undefined) {
                raw[field] = cloned;
            }
        }
        return Object.freeze({
            plotId,
            name,
            summary,
            description,
            about,
            creatorComment,
            language,
            mode,
            hashtags: Object.freeze(hashtags),
            characters: Object.freeze(characters),
            chatProfiles: Object.freeze(chatProfiles),
            opening: Object.freeze(opening),
            lore: Object.freeze(lore),
            raw: Object.freeze(raw),
        });
    },

    /**
     * @param {{ fetch: Function, token: string|null, roomId: string|null, pause: Function, signal?: AbortSignal }} request
     * @return {Promise<{rooms: Array<{id: string, title: string}>, nextCursor: *}>}
     * @throws {Error}
     */
    async savedRooms(request) {
        const settings = ZetaSource.Settings;
        ZetaSource.ready(request);
        if (!ZetaSource.roomId(request.roomId)) {
            throw ZetaSource.failure(settings.Messages.NoRoom, null, false);
        }
        const room = await ZetaSource.get(request, settings.RoomsPath + encodeURIComponent(request.roomId));
        const plotId = ZetaSource.plotOf(room.body);
        if (room.body?.id !== request.roomId || plotId === null) {
            throw ZetaSource.failure(settings.Messages.Shape, room.status, false);
        }
        const query = new URLSearchParams({ plotId, limit: String(settings.SavedRoomsLimit) });
        const { body, status } = await ZetaSource.get(request, settings.RoomsPath + 'saved?' + query);
        if (!Array.isArray(body?.rooms) || !Object.hasOwn(body, 'nextCursor')) {
            throw ZetaSource.failure(settings.Messages.Shape, status, false);
        }
        const rooms = body.rooms.map((saved) => {
            if (!ZetaSource.roomId(saved?.id) || typeof saved.title !== 'string' || ZetaSource.plotOf(saved) !== plotId) {
                throw ZetaSource.failure(settings.Messages.Shape, status, false);
            }
            return { id: saved.id, title: saved.title };
        });
        return { rooms, nextCursor: body.nextCursor };
    },

    /**
     * @param {{ fetch: Function, token: string|null, roomId: string|null, pause: Function, signal?: AbortSignal }} request
     * @return {Promise<Readonly<object>>}
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
        const plotId = ZetaSource.plotOf(room.body);
        if (plotId === null) {
            throw ZetaSource.failure(words.NoPlot, room.status, false);
        }
        const rawPlot = room.body[settings.PlotField];
        if (!ZetaSource.isObject(rawPlot)) {
            throw Object.assign(ZetaSource.failure(words.NoPlot, room.status, false), { plotId });
        }
        const roomTitle = ZetaSource.optionalText(room.body[settings.TitleField]);
        const introId = ZetaSource.identifier(room.body[settings.IntroIdField]);
        const createdAt = ZetaSource.optionalText(room.body[settings.CreatedAtField]);
        const parsed = ZetaSource.parsePlot(rawPlot, plotId, introId);
        return Object.freeze({ ...parsed, roomTitle, introId, createdAt });
    },

    /**
     * @param {{ fetch: Function, token: string|null, plotId: string|null, introId?: string|number|null, pause: Function, signal?: AbortSignal }} request
     * @return {Promise<Readonly<object>>}
     * @throws {Error}
     */
    async plot(request) {
        const settings = ZetaSource.Settings;
        const words = settings.Messages;
        ZetaSource.readyRequest(request);
        if (!ZetaSource.roomId(request.plotId)) {
            throw ZetaSource.failure(words.NoPlot, null, false);
        }
        const path = settings.PlotsPath + encodeURIComponent(request.plotId);
        const read = await ZetaSource.retried(
            request,
            /**
             * @return {Promise<{ status: number, body: * }>}
             */
            () => ZetaSource.get(request, path),
        );
        if (!ZetaSource.isObject(read.body)) {
            throw ZetaSource.failure(words.Shape, read.status, false);
        }
        return ZetaSource.parsePlot(read.body, request.plotId, request.introId ?? null);
    },

    /**
     * @param {{ fetch: Function, token: string|null, roomId: string|null, pause: Function, signal?: AbortSignal }} request
     * @param {string|null} plotId
     * @return {Promise<Readonly<{ source: string, name: string|null, description: string, text: string }>|null>}
     * @throws {Error}
     */
    async profile(request, plotId = null) {
        const settings = ZetaSource.Settings;
        ZetaSource.ready(request);
        if (!ZetaSource.roomId(plotId)) {
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
        const name = ZetaSource.optionalText(read.body[settings.NameField]);
        const combined = name === null ? detail : `${name}${settings.NameSeparator}${detail}`;
        const text = Array.from(combined).slice(0, settings.LongestProfile).join(settings.Nothing);
        return Object.freeze({
            source: settings.PersonaSource,
            name,
            description: detail,
            text,
        });
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
     * @param {object[]} saved
     * @param {object|null} hints
     * @return {object|null}
     */
    savedPages(saved, hints) {
        const rows = new Map(saved.map((row) => [row.id, row]));
        if (!rows.size || rows.size !== saved.length) {
            return null;
        }
        const ids = [...rows.keys()];
        let transport = ids;
        const boundaries = new Map();
        const locations = new Map();
        if (hints && Number.isSafeInteger(hints.count) && hints.count > 0 && hints.count <= ids.length &&
            hints.first === ids[0] && hints.last === ids[hints.count - 1] &&
            Array.isArray(hints.pages) && hints.pages.length <= ZetaSource.Settings.MostPages) {
            if (Array.isArray(hints.transport)) {
                if (hints.count !== ids.length || hints.transport.length < rows.size ||
                    hints.transport.some((id) => !rows.has(id)) || new Set(hints.transport).size !== rows.size) {
                    return { rows, transport, boundaries, locations };
                }
                const chronological = ZetaSource.ordered(hints.transport.map((id) => rows.get(id)).reverse());
                if (!chronological.every((row, position) => row.id === ids[position])) {
                    return { rows, transport, boundaries, locations };
                }
                transport = hints.transport;
            }
            const head = (hints.transport ? transport.length : hints.count) - 1;
            let start = head;
            for (const point of hints.pages) {
                if (!Array.isArray(point) || ![2, 5].includes(point.length)) {
                    return { rows, transport, boundaries: new Map(), locations: new Map() };
                }
                const [cursor, last, high = start, first = high, seenHead = head] = point;
                if (![last, high, first, seenHead].every(Number.isSafeInteger) || last < 0 || last > high ||
                    high > start || first < 0 || first > seenHead || boundaries.has(cursor) ||
                    (cursor !== null && typeof cursor !== 'string')) {
                    return { rows, transport, boundaries: new Map(), locations: new Map() };
                }
                boundaries.set(cursor, { first, head: seenHead });
                for (let position = high; position >= last; position--) {
                    const id = transport[position];
                    if (!locations.has(id)) {
                        locations.set(id, cursor);
                    }
                }
                start = last - 1;
            }
        }
        return { rows, transport, boundaries, locations };
    },

    /**
     * @param {{ fetch: Function, token: string|null, roomId: string|null, pause: (milliseconds: number) => Promise<void>, onPage?: (count: number) => void, through?: string|null, boundaryTime?: string|null }} request
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
        let saved = request.saved && request.index ? ZetaSource.savedPages(request.saved, request.hints) : null;
        let overlap = -1;
        const positions = saved ? new Map(saved.transport.map((id, position) => [id, position])) : null;
        let priorPosition = saved?.transport.length;
        let ordered = true;
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
                request.signal?.throwIfAborted();
                if (received.length === 0) {
                    throw error;
                }
                return ZetaSource.outcome(received, ends.Failed, error.message, skipped);
            }
            skipped += page.skipped;
            if (read === 0 && request.index && !skipped) {
                request.index.headIds = new Set(page.messages.map((row) => row.id));
                request.index.completeHead = page.nextCursor === null && (page.messages.length > 0 || page.emptyRoom);
                request.index.cheapDepth = page.messages.length;
            }
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
            request.signal?.throwIfAborted();
            const next = page.nextCursor;
            if (saved && next !== null && !skipped && page.messages.length && distinct.size > before && !used.has(next)) {
                if (overlap < 0) {
                    const within = page.messages.findIndex((row) => saved.rows.has(row.id));
                    if (within >= 0) {
                        overlap = received.length - page.messages.length + within;
                    }
                }
                if (overlap >= 0) {
                    const old = saved.transport;
                    for (const row of page.messages) {
                        const position = positions.get(row.id);
                        if (position !== undefined) {
                            ordered &&= position < priorPosition;
                            priorPosition = position;
                        }
                    }
                    const exactStart = old.length - (received.length - overlap);
                    const suffix = exactStart >= 0 && received.slice(overlap).every((row, offset) => old[old.length - 1 - offset] === row.id);
                    let uniqueSuffix = suffix;
                    if (suffix && positions.size !== old.length) {
                        for (let start = old.indexOf(received.at(-1).id); start >= 0 && start < exactStart;
                            start = old.indexOf(received.at(-1).id, start + 1)) {
                            if (received.slice(overlap).every((row, offset) => old[start + received.length - overlap - 1 - offset] === row.id)) {
                                uniqueSuffix = false;
                                break;
                            }
                        }
                    }
                    const prefix = suffix ? exactStart : positions.get(received.at(-1).id);
                    let matched = 0;
                    while (prefix !== undefined && matched < received.length && old[prefix + matched] === received[received.length - 1 - matched].id) {
                        matched++;
                    }
                    const exact = matched === received.length - overlap && prefix + matched === old.length;
                    let currentHead = overlap > 0 || received[0].id === old.at(-1);
                    const unambiguous = ordered && distinct.size === received.length && positions.size === old.length;
                    if (!currentHead && read === 0 && overlap === 0 && unambiguous && matched === settings.PageSize &&
                        matched === received.length && prefix > 0 && prefix + matched < old.length) {
                        let metadata = null;
                        try {
                            metadata = (await ZetaSource.get(request, settings.RoomsPath + encodeURIComponent(request.roomId), true)).body;
                        } catch (error) {
                            return ZetaSource.outcome(received, ends.Failed, error.message, skipped);
                        }
                        if (metadata?.id === request.roomId && metadata.lastMessage?.id === received[0].id) {
                            currentHead = true;
                        } else {
                            return ZetaSource.outcome(received, ends.Failed, 'Zeta’s room details and latest history page disagree. Scribe will check again.', skipped);
                        }
                    }
                    if (prefix > 0 && currentHead && (uniqueSuffix || unambiguous && (exact || matched >= 2))) {
                        const older = old.slice(0, prefix);
                        const transport = older.concat(received.map((row) => row.id).reverse());
                        const messages = ZetaSource.ordered(received.concat(older.slice().reverse().map((id) => saved.rows.get(id))));
                        const unique = [...new Set(transport.slice().reverse())].reverse();
                        const index = request.index;
                        index.transport = transport;
                        index.order = new Map(transport.map((id, position) => [id, position]));
                        index.disordered = messages.some((row, position) => row.id !== unique[position]);
                        index.boundaries = saved.boundaries;
                        index.locations = saved.locations;
                        const head = transport.length - 1;
                        for (const [token, offset] of boundaries) {
                            index.boundaries.set(token, { first: head - offset, head });
                        }
                        for (const [id, token] of locations) {
                            index.locations.set(id, token);
                        }
                        if (request.remember && (!exact || overlap > 0)) {
                            const pages = [];
                            const recorded = new Set();
                            for (let high = head; high >= 0;) {
                                const token = index.locations.get(transport[high]);
                                let low = high;
                                while (low > 0 && index.locations.get(transport[low - 1]) === token) {
                                    low--;
                                }
                                const origin = index.boundaries.get(token);
                                if (origin && !recorded.has(token)) {
                                    pages.push([token, low, high, origin.first, origin.head]);
                                    recorded.add(token);
                                }
                                high = low - 1;
                            }
                            ZetaSource.quietly(null, request.remember, { count: messages.length, first: messages[0].id,
                                last: messages.at(-1).id, pages: pages.slice(0, settings.MostPages),
                                ...(index.disordered || unique.length !== transport.length ? { transport } : {}) });
                        }
                        return { messages, end: ends.ThroughMessage, skipped: 0, problem: null,
                            observed: ZetaSource.ordered(received) };
                    }
                    if (!currentHead || !unambiguous && !suffix) {
                        saved = null;
                    }
                }
            }
            let end = null;
            if (page.messages.length === 0) {
                end = ends.EmptyPage;
            } else if (distinct.size === before) {
                end = ends.NothingNew;
            } else if (next === null) {
                end = ends.NoCursor;
            } else if (request.through && distinct.has(request.through) && (request.required ?? []).every((id) => distinct.has(id))) {
                end = ends.ThroughMessage;
            } else if (request.boundaryTime && page.messages.some((row) => Date.parse(row.messageTime) < Date.parse(request.boundaryTime))) {
                return ZetaSource.outcome(received, ends.Failed, 'The saved fork boundary was not found in the latest Zeta messages.', skipped);
            } else if (used.has(next)) {
                end = ends.RepeatedCursor;
            }
            if (end !== null) {
                const problem = end === ends.EmptyPage && next !== null ? settings.Messages.EmptyContinuation : null;
                const result = ZetaSource.outcome(received, end, problem, skipped);
                const complete = !problem && !skipped && (end === ends.NoCursor || end === ends.EmptyPage);
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
                    if (request.remember && result.messages.length) {
                        const pages = [...boundaries];
                        const hints = { count: result.messages.length, first: result.messages[0].id,
                            last: result.messages.at(-1).id, pages: pages.map(([token], position) =>
                                [token, received.length - (pages[position + 1]?.[1] ?? received.length)]),
                            ...(request.index.disordered || unique.length !== transport.length ? { transport } : {}) };
                        ZetaSource.quietly(null, request.remember, hints);
                    }
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
        const historical = new Map();
        if (!request.savedRoom && !request.check && request.through && request.index?.expirations > 0) {
            for (const id of request.required ?? []) {
                const cursor = request.index.locations.get(id);
                if (cursor == null || historical.has(cursor)) {
                    continue;
                }
                try {
                    historical.set(cursor, await ZetaSource.page(request, cursor));
                } catch (error) {
                    if (![400, ZetaSource.Settings.NotFound, 410].includes(error.status)) {
                        throw error;
                    }
                    historical.set(cursor, null);
                }
            }
        }
        const page = await ZetaSource.page(request, null);
        const result = ZetaSource.outcome(page.messages, page.messages.length === 0 ? ends.EmptyPage : ends.NoCursor, null, page.skipped);
        if (request.index && !page.skipped) {
            request.index.headIds = new Set(page.messages.map((row) => row.id));
            request.index.completeHead = page.nextCursor === null && (page.messages.length > 0 || page.emptyRoom);
            const tip = request.index.disordered ? request.index.transport?.at(-1) : request.known?.at(-1)?.id;
            if (tip && page.nextCursor !== null && page.messages.length && !request.index.headIds.has(tip)) {
                return { needsHistory: true, changedHead: page };
            }
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
                return { ...repair, changedHead: page };
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
            const cached = new Set();
            let direct = false;
            let reserved = false;
            const latest = request.known.at(-1);
            for (const id of new Set([...(request.required ?? []), latest.id])) {
                let cursor = locations.get(id);
                let adjacent = null;
                if (historical.has(cursor) && historical.get(cursor) === null) {
                    cursor = null;
                }
                if (cursor == null && known.has(id) && !observed.has(id)) {
                    if (request.savedRoom && join - known.get(id) > ZetaSource.Settings.PageSize) {
                        cached.add(id);
                        continue;
                    }
                    cursor = page.nextCursor;
                    adjacent = join - 1;
                }
                let attempts = 0;
                while (!observed.has(id)) {
                    if (request.savedRoom && timeline.has(id) && (historical.get(cursor) === null ||
                        attempts > 0 && (attempts >= 2 || adjacent === null || adjacent - known.get(id) >= ZetaSource.Settings.PageSize))) {
                        cached.add(id);
                        break;
                    }
                    if (cursor == null || !known.has(id) || attempts++ >= ZetaSource.Settings.MostPages ||
                        (adjacent !== null && adjacent < known.get(id))) {
                        return repair;
                    }
                    if (fetched.has(cursor)) {
                        const previous = fetched.get(cursor);
                        cursor = previous.next;
                        adjacent = previous.last - 1;
                        continue;
                    }
                    if (!reserved && !locations.has(id) && request.check?.previouslyLimited &&
                        fetched.size >= ZetaSource.Settings.CheapCheckPages - 1) {
                        reserved = request.check.reserve();
                        if (!reserved) {
                            return { deferredCheck: true };
                        }
                    }
                    await ZetaSource.wait(request, ZetaSource.Settings.PauseMs);
                    let older;
                    try {
                        older = historical.get(cursor) ?? await ZetaSource.page(request, cursor);
                    } catch (error) {
                        if ([400, ZetaSource.Settings.NotFound, 410].includes(error.status)) {
                            request.index.expirations = (request.index.expirations ?? 0) + 1;
                            if (request.savedRoom && timeline.has(id)) {
                                if (request.check && !reserved && (limited || request.index.expirations >= 2)) {
                                    reserved = request.check.reserve();
                                    if (!reserved) {
                                        return { deferredCheck: true };
                                    }
                                }
                                historical.set(cursor, null);
                                cached.add(id);
                                break;
                            }
                            if (!request.check && request.through && adjacent === null && cursor !== page.nextCursor) {
                                cursor = page.nextCursor;
                                adjacent = join - 1;
                                continue;
                            }
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
                    if (first === undefined && request.savedRoom && !request.index.disordered && !older.skipped &&
                        rows.length && known.size === transport.length) {
                        const high = known.get(rows[0].id);
                        const low = older.nextCursor === null ? 0 : known.get(rows.at(-1).id);
                        const observedRows = [...rows, ...verified.values(), ...page.messages];
                        if (Number.isInteger(high) && Number.isInteger(low) && high >= low &&
                            new Set(rows.map((row) => row.id)).size === rows.length &&
                            rows.every((row) => !known.has(row.id) || known.get(row.id) >= low && known.get(row.id) <= high)) {
                            const replacement = [...transport.slice(0, low), ...rows.map((row) => row.id).reverse(), ...transport.slice(high + 1)];
                            const data = new Map([...timeline, ...observedRows.map((row) => [row.id, row])]);
                            const campaign = ZetaSource.ordered(replacement.map((key) => data.get(key)).reverse());
                            if (campaign.every((row, position) => row.id === replacement[position])) {
                                request.index.transport = replacement;
                                request.index.order = new Map(replacement.map((key, position) => [key, position]));
                                request.index.boundaries.set(cursor, { first: low + rows.length - 1, head: replacement.length - 1 });
                                for (const row of rows) {
                                    locations.set(row.id, cursor);
                                }
                                return { ...result, end: ends.ThroughMessage, reconciled: campaign, verified: observedRows };
                            }
                        }
                        cached.add(id);
                        break;
                    }
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
            if (direct && !historical.size) {
                request.index.expirations = 0;
            }
            for (const id of headIds) {
                locations.set(id, null);
            }
            for (const row of result.messages) {
                verified.set(row.id, row);
            }
            const additions = result.messages.filter((row) => !timeline.has(row.id));
            const suffix = [cached.has(latest.id) ? latest : verified.get(latest.id), ...additions];
            const orderedSuffix = ZetaSource.ordered([...suffix].reverse());
            if (orderedSuffix.some((row, position) => row.id !== suffix[position].id) ||
                [...verified.values()].some((row) => timeline.has(row.id) && timeline.get(row.id).messageTime !== row.messageTime)) {
                return repair;
            }
            for (const row of suffix) {
                verified.delete(row.id);
            }
            return { ...result, end: ends.ThroughMessage, messages: suffix, verified: [...verified.values()],
                ...(cached.size ? { cached: [...cached] } : {}) };
        }
        if (request.index && !page.skipped) {
            for (const row of page.messages) {
                request.index.locations.set(row.id, null);
            }
        }
        return page.emptyRoom ? Object.freeze({ ...result, emptyRoom: true }) : result;
    },
});
