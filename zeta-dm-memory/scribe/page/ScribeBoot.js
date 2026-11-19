const ScribeBoot = Object.freeze({
    Role: Object.freeze({
        Analyzer: 'Analyzer',
        Scribe: 'Scribe',
        Pedant: 'Pedant',
    }),

    Settings: Object.freeze({
        TickMs: 20000,
        AfterTraffic: Object.freeze([0, 5000, 15000]),
        TickGapMs: 3000,
        RouteMs: 1000,
        RetryMs: 10000,
        Attempts: 3,
        PauseMs: 2000,
        TimeoutMs: Object.freeze({
            Analyzer: 600000,
            Scribe: 180000,
            Pedant: 180000,
        }),
        TransportMarginMs: 5000,
        LockWaitMs: 2000,
        LockRetryMs: 10000,
        ModelOrigin: 'https://openrouter.ai',
        MaxTokens: Object.freeze({
            Analyzer: 40000,
            Scribe: 4000,
            Pedant: 4000,
        }),
        LockPrefix: 'scribe:reader:',
        Models: Object.freeze({
            Analyzer: 'analyzer',
            Scribe: 'scribe',
            Pedant: 'pedant',
        }),
        Budget: 'budget',
        NotesOpen: '\n\nOPERATOR NOTES:\n',
        Parts: Object.freeze([
            Object.freeze({ name: 'sender', ending: 'detach' }),
            Object.freeze({ name: 'panel', ending: 'unmount' }),
            Object.freeze({ name: 'live', ending: 'close' }),
            Object.freeze({ name: 'keeper', ending: 'close' }),
            Object.freeze({ name: 'cloud', ending: 'close' }),
        ]),
        IfAvailable: Object.freeze({ ifAvailable: true }),
        Once: Object.freeze({ once: true }),
        AbortEvent: 'abort',
        KeyEvents: Object.freeze(['keydown', 'keyup', 'keypress']),
        VisibilityEvent: 'visibilitychange',
        MessageEvent: 'message',
        FrameTag: 'iframe',
        KeptArms: 8,
        KeptFrames: 16,
        SentLimit: 10,
        SentWindowMs: 10000,
        TokenShortest: 16,
        TokenLongest: 200,
        NothingOffered: Object.freeze({ ready: null, suggestion: null, ends: Object.freeze([]) }),
        Capture: true,
        Hidden: 'hidden',
        ResponseType: 'text',
        Redirect: 'error',
        PathStart: '/',
        RoomsPath: '/v1/rooms/',
        Mark: 'data-zeta-scribe',
        Mask: '[hidden]',
        KeptTokens: 5,
        Space: ' ',
        ByteOrderMark: '﻿',
        LogPrefix: '[Scribe] ',
        LinkTag: 'a',
        RevokeMs: 60000,
        MonthOffset: 1,
        DateDigits: 2,
        DatePad: '0',
        DateJoint: '-',
        FirstEntry: 0,
        NotFound: -1,
        Last: -1,
        NoSpending: 0,
        Nothing: '',
        ObjectType: 'object',
        StringType: 'string',
        FunctionType: 'function',
        Messages: Object.freeze({
            Refused: 'The request was refused',
            Failed: 'The request failed',
            TimedOut: 'The request timed out',
            Stopped: 'The request was stopped',
            NoKey: 'No key',
            Spent: "The day's budget is spent",
            Left: 'The chat has been left',
            Running: 'The scribe is already running on this page',
            NotStarted: 'The scribe could not start: ',
            NotWatched: 'The page could not be watched: ',
            NotFollowed: 'The chat could not be followed: ',
            NotChecked: 'The check failed: ',
            NotDrawn: 'The panel could not be drawn: ',
            NotHanded: 'The reply could not be handed on: ',
            NotClosed: 'A part of the scribe could not be closed: ',
            NotLocked: 'The reader lock failed: ',
            NoLock: 'The browser lock could not be used, so the stored claim decides who reads: ',
            Silent: 'it did not answer',
            NotRecorded: 'The spending could not be saved; it is kept until it can be: ',
            Unrecorded: 'The spending could not be recorded, so nothing more is asked until it is',
            NotArmed: 'The chat frame could not be armed: ',
            NotHeard: 'A message from the chat frame could not be handled: ',
            NotTold: 'The live part could not be told what went: ',
            NoBridge: 'The bridge to the chat frame could not be keyed: ',
            NoToken: 'no usable token was made',
            NoStore: 'the token could not be read, made or saved',
            NotSynced: 'The book could not be synced: ',
        }),
    }),

    /**
     * @param {*} error
     * @return {string}
     */
    words(error) {
        const settings = ScribeBoot.Settings;
        const described = error !== null && typeof error === settings.ObjectType && typeof error.message === settings.StringType;
        return described ? error.message : String(error);
    },

    /**
     * @param {string} token
     * @return {string}
     */
    bare(token) {
        const settings = ScribeBoot.Settings;
        const space = token.indexOf(settings.Space);
        return space === settings.NotFound ? token : token.slice(space + settings.Space.length).trim();
    },

    /**
     * @param {{ watcher: object|null, tokens: string[] }} boot
     * @return {string|null}
     */
    token(boot) {
        const settings = ScribeBoot.Settings;
        if (boot.watcher === null) {
            return null;
        }
        const token = boot.watcher.token();
        if (typeof token === settings.StringType && token !== settings.Nothing && !boot.tokens.includes(token)) {
            boot.tokens.push(token);
            boot.tokens.splice(settings.FirstEntry, Math.max(boot.tokens.length - settings.KeptTokens, settings.FirstEntry));
        }
        return token;
    },

    /**
     * @param {object} boot
     * @param {string} text
     * @return {void}
     */
    say(boot, text) {
        const settings = ScribeBoot.Settings;
        ScribeBoot.token(boot);
        let stored = null;
        try {
            stored = boot.environment.storage.get(ScribeFrame.Bridge.TokenName, null);
        } catch {
            stored = null;
        }
        let told = text;
        for (const secret of [boot.bridge, stored]) {
            if (ScribeBoot.usable(secret)) {
                told = told.replaceAll(secret, settings.Mask);
            }
        }
        for (const token of boot.tokens) {
            for (const secret of [token, ScribeBoot.bare(token)]) {
                if (secret !== settings.Nothing) {
                    told = told.replaceAll(secret, settings.Mask);
                }
            }
        }
        boot.environment.log(told);
    },

    /**
     * @param {object} boot
     * @param {string} prefix
     * @param {Function} action
     * @return {void}
     */
    attempt(boot, prefix, action) {
        new Promise(
            /**
             * @param {Function} resolve
             * @return {void}
             */
            (resolve) => {
                resolve(action());
            },
        ).then(
            null,
            /**
             * @param {*} error
             * @return {void}
             */
            (error) => {
                ScribeBoot.say(boot, `${prefix}${ScribeBoot.words(error)}`);
            },
        );
    },

    /**
     * @param {object} session
     * @param {number} milliseconds
     * @param {Function} action
     * @param {Function|null} ended
     * @return {void}
     */
    later(session, milliseconds, action, ended) {
        if (session.closed) {
            if (ended !== null) {
                ended();
            }
            return;
        }
        const timer = session.boot.environment.timers.setTimeout(
            /**
             * @return {void}
             */
            () => {
                session.timers.delete(timer);
                action();
            },
            milliseconds,
        );
        session.timers.set(timer, ended);
    },

    /**
     * @param {object} session
     * @param {number} milliseconds
     * @return {Promise<void>}
     */
    pause(session, milliseconds) {
        return new Promise(
            /**
             * @param {Function} resolve
             * @param {Function} reject
             * @return {void}
             */
            (resolve, reject) => {
                ScribeBoot.later(
                    session,
                    milliseconds,
                    resolve,
                    /**
                     * @return {void}
                     */
                    () => {
                        reject(new Error(ScribeBoot.Settings.Messages.Left));
                    },
                );
            },
        );
    },

    /**
     * @param {object} session
     * @param {string} member
     * @return {*}
     * @throws {Error}
     */
    setting(session, member) {
        const saved = ScribeStore.read(session.boot.environment.storage, session.roomId, ScribeStore.Kind.Settings);
        return saved !== null && Object.hasOwn(saved, member) ? saved[member] : ScribeKeeper.Defaults[member];
    },

    /**
     * @param {string} text
     * @return {number}
     */
    billed(text) {
        const settings = ScribeBoot.Settings;
        let body = null;
        try {
            body = JSON.parse(text.startsWith(settings.ByteOrderMark) ? text.slice(settings.ByteOrderMark.length) : text);
        } catch {
            body = null;
        }
        const cost = body?.usage?.cost;
        return Number.isFinite(cost) && cost > settings.NoSpending ? cost : settings.NoSpending;
    },

    /**
     * @param {object} session
     * @return {number}
     */
    owed(session) {
        const debt = session.boot.debts.get(session.roomId);
        return debt !== undefined && debt.day === session.boot.environment.clock.today() ? debt.amount : ScribeBoot.Settings.NoSpending;
    },

    /**
     * @param {object} session
     * @return {void}
     */
    repay(session) {
        const boot = session.boot;
        const environment = boot.environment;
        const debt = boot.debts.get(session.roomId);
        if (debt === undefined) {
            return;
        }
        const day = environment.clock.today();
        if (debt.day !== day) {
            boot.debts.delete(session.roomId);
            return;
        }
        let before = null;
        let failure = null;
        try {
            before = ScribeStore.spent(environment.storage, session.roomId, day);
            ScribeStore.spend(environment.storage, session.roomId, day, debt.amount);
            boot.debts.delete(session.roomId);
            return;
        } catch (error) {
            failure = error;
        }
        if (before !== null && ScribeBoot.landed(session, day, before + debt.amount)) {
            boot.debts.delete(session.roomId);
            return;
        }
        ScribeBoot.say(boot, `${ScribeBoot.Settings.Messages.NotRecorded}${ScribeBoot.words(failure)}`);
    },

    /**
     * @param {object} session
     * @param {string} day
     * @param {number} total
     * @return {boolean}
     */
    landed(session, day, total) {
        try {
            return ScribeStore.spent(session.boot.environment.storage, session.roomId, day) === total;
        } catch {
            return false;
        }
    },

    /**
     * @param {object} session
     * @return {void}
     * @throws {Error}
     */
    solvent(session) {
        ScribeBoot.repay(session);
        if (session.boot.debts.has(session.roomId)) {
            throw new Error(ScribeBoot.Settings.Messages.Unrecorded);
        }
    },

    /**
     * @param {object} session
     * @param {number} amount
     * @return {void}
     */
    charge(session, amount) {
        if (amount <= ScribeBoot.Settings.NoSpending) {
            return;
        }
        session.boot.debts.set(session.roomId, { day: session.boot.environment.clock.today(), amount: ScribeBoot.owed(session) + amount });
        ScribeBoot.repay(session);
    },

    /**
     * @param {object} session
     * @param {string} role
     * @param {string} system
     * @param {string} user
     * @param {{ amount: number, settled: boolean }} bill
     * @return {Promise<{ text: string, tokensIn: number, tokensOut: number, reasoningTokens: number|null, finish: string }>}
     * @throws {Error}
     */
    async call(session, role, system, user, bill) {
        const settings = ScribeBoot.Settings;
        const messages = settings.Messages;
        const environment = session.boot.environment;
        if (session.closed) {
            throw new Error(messages.Left);
        }
        const key = ScribeStore.key(environment.storage);
        if (key === settings.Nothing) {
            throw new Error(messages.NoKey);
        }
        const model = ScribeBoot.setting(session, settings.Models[role]);
        const timeoutMs = settings.TimeoutMs[role];
        const transportMs = timeoutMs - settings.TransportMarginMs;

        /**
         * @param {number} milliseconds
         * @return {Promise<void>}
         */
        const pause = (milliseconds) => ScribeBoot.pause(session, milliseconds);
        let ended = Promise.resolve();

        /**
         * @return {null}
         */
        const over = () => null;

        /**
         * @param {string} url
         * @param {object} options
         * @return {Promise<{ status: number, text: () => Promise<string> }>}
         */
        const fetch = (url, options) => {
            const sending = ended.then(
                /**
                 * @return {Promise<{ status: number, text: () => Promise<string> }>}
                 * @throws {Error}
                 */
                () => {
                    if (bill.settled) {
                        throw new Error(messages.Stopped);
                    }
                    const stopper = new environment.pageWindow.AbortController();
                    let done = false;
                    ScribeBoot.later(
                        session,
                        transportMs,
                        /**
                         * @return {void}
                         */
                        () => {
                            if (!done) {
                                stopper.abort();
                            }
                        },
                        null,
                    );
                    return session.boot
                        .request(url, {
                            method: options.method,
                            headers: options.headers,
                            body: options.body,
                            timeout: transportMs,
                            signal: stopper.signal,
                        })
                        .finally(
                            /**
                             * @return {void}
                             */
                            () => {
                                done = true;
                            },
                        );
                },
            );
            ended = sending.then(over, over);
            return sending.then(
                /**
                 * @param {{ status: number, text: () => Promise<string> }} response
                 * @return {Promise<{ status: number, text: () => Promise<string> }>}
                 */
                async (response) => {
                    const text = await response.text();
                    const cost = ScribeBoot.billed(text);
                    if (bill.settled) {
                        ScribeBoot.charge(session, cost);
                    } else {
                        bill.amount += cost;
                    }
                    return {
                        status: response.status,

                        /**
                         * @return {Promise<string>}
                         */
                        text: async () => text,
                    };
                },
            );
        };
        const notes = session.cloud === null ? null : session.cloud.notes();
        const noted = typeof notes === settings.StringType && notes !== settings.Nothing;
        const told = noted ? `${user}${settings.NotesOpen}${notes}` : user;
        const answer = await ScribeGateway.retry(
            /**
             * @return {Promise<object>}
             */
            () =>
                ScribeGateway.call({
                    fetch,
                    key,
                    model,
                    system,
                    user: told,
                    maxTokens: settings.MaxTokens[role],
                    sleep: pause,
                    timeoutMs,
                }),
            { attempts: settings.Attempts, pauseMs: settings.PauseMs, sleep: pause },
        );
        return answer;
    },

    /**
     * @param {object} session
     * @param {string} role
     * @param {string} system
     * @param {string} user
     * @return {Promise<{ text: string, cost: number }>}
     * @throws {Error}
     */
    async ask(session, role, system, user) {
        const bill = { amount: ScribeBoot.Settings.NoSpending, settled: false };
        ScribeBoot.solvent(session);
        try {
            const answer = await ScribeBoot.call(session, role, system, user, bill);
            bill.settled = true;
            return { text: answer.text, cost: bill.amount };
        } catch (error) {
            bill.settled = true;
            ScribeBoot.charge(session, bill.amount);
            throw error;
        }
    },

    /**
     * @param {object} session
     * @param {string} role
     * @param {string} system
     * @param {string} user
     * @return {Promise<{ text: string, cost: number, tokensIn: number, tokensOut: number, reasoningTokens: number|null, finish: string }>}
     * @throws {Error}
     */
    async counted(session, role, system, user) {
        const settings = ScribeBoot.Settings;
        const environment = session.boot.environment;
        ScribeBoot.solvent(session);
        const budget = ScribeBoot.setting(session, settings.Budget);
        const today = environment.clock.today();
        const spent =
            ScribeStore.spent(environment.storage, session.roomId, today) +
            ScribeStore.others(environment.storage, session.roomId, today);
        if (spent >= budget) {
            throw new Error(settings.Messages.Spent);
        }
        const bill = { amount: settings.NoSpending, settled: false };
        try {
            const answer = await ScribeBoot.call(session, role, system, user, bill);
            return {
                text: answer.text,
                cost: bill.amount,
                tokensIn: answer.tokensIn,
                tokensOut: answer.tokensOut,
                reasoningTokens: answer.reasoningTokens,
                finish: answer.finish,
            };
        } finally {
            bill.settled = true;
            ScribeBoot.charge(session, bill.amount);
        }
    },

    /**
     * @param {Function} xmlHttpRequest
     * @return {(url: string, options: { method: string, headers: object, body: string, timeout?: number, signal?: object }) => Promise<{ status: number, text: () => Promise<string> }>}
     */
    request(xmlHttpRequest) {
        const settings = ScribeBoot.Settings;
        const messages = settings.Messages;

        /**
         * @param {*} url
         * @param {{ method: string, headers: object, body: string, timeout?: number, signal?: object }} options
         * @return {Promise<{ status: number, text: () => Promise<string> }>}
         */
        return (url, options) =>
            new Promise(
                /**
                 * @param {Function} resolve
                 * @param {Function} reject
                 * @return {void}
                 */
                (resolve, reject) => {
                    if (typeof url !== settings.StringType || !url.startsWith(`${settings.ModelOrigin}${settings.PathStart}`)) {
                        reject(new Error(messages.Refused));
                        return;
                    }
                    const signal = options.signal ?? null;
                    if (signal !== null && signal.aborted) {
                        reject(new Error(messages.Stopped));
                        return;
                    }
                    const details = Object.create(null);
                    details.method = options.method;
                    details.url = url;
                    details.headers = { __proto__: null, ...options.headers };
                    details.data = options.body;
                    details.responseType = settings.ResponseType;
                    details.anonymous = true;
                    details.timeout = options.timeout;
                    details.redirect = settings.Redirect;

                    /**
                     * @param {{ status: number, responseText: * }} response
                     * @return {void}
                     */
                    details.onload = (response) => {
                        const text = typeof response.responseText === settings.StringType ? response.responseText : settings.Nothing;
                        resolve({
                            status: response.status,

                            /**
                             * @return {Promise<string>}
                             */
                            text: async () => text,
                        });
                    };

                    /**
                     * @return {void}
                     */
                    details.onerror = () => {
                        reject(new Error(messages.Failed));
                    };

                    /**
                     * @return {void}
                     */
                    details.ontimeout = () => {
                        reject(new Error(messages.TimedOut));
                    };

                    /**
                     * @return {void}
                     */
                    details.onabort = () => {
                        reject(new Error(messages.Stopped));
                    };
                    let handle = null;
                    try {
                        handle = xmlHttpRequest(details);
                    } catch {
                        reject(new Error(messages.Failed));
                        return;
                    }
                    if (signal !== null) {
                        signal.addEventListener(
                            settings.AbortEvent,
                            /**
                             * @return {void}
                             */
                            () => {
                                if (typeof handle?.abort !== settings.FunctionType) {
                                    reject(new Error(messages.Stopped));
                                    return;
                                }
                                try {
                                    handle.abort();
                                } catch {
                                    reject(new Error(messages.Stopped));
                                }
                            },
                            settings.Once,
                        );
                    }
                },
            );
    },

    /**
     * @param {object} session
     * @return {void}
     */
    redraw(session) {
        const panel = session.panel;
        if (panel !== null) {
            ScribeBoot.attempt(
                session.boot,
                ScribeBoot.Settings.Messages.NotDrawn,
                /**
                 * @return {*}
                 */
                () => panel.redraw(),
            );
        }
    },

    /**
     * @param {{ session: object|null }} boot
     * @param {{ composedPath?: Function, target?: object, stopImmediatePropagation: Function }} event
     * @return {void}
     */
    shield(boot, event) {
        const settings = ScribeBoot.Settings;
        try {
            const panel = boot.session === null ? null : boot.session.panel;
            const host = panel === null ? null : (panel.host ?? null);
            if (host === null) {
                return;
            }
            let path = [];
            if (typeof event.composedPath === settings.FunctionType) {
                path = event.composedPath();
            } else {
                for (let node = event.target; node !== null && node !== undefined; node = node.parentNode) {
                    path.push(node);
                }
            }
            if (path.includes(host)) {
                event.stopImmediatePropagation();
            }
        } catch {
            return;
        }
    },

    /**
     * @param {object} session
     * @return {void}
     */
    stir(session) {
        if (!session.ticking) {
            return;
        }
        for (const delay of ScribeBoot.Settings.AfterTraffic) {
            ScribeBoot.later(
                session,
                delay,
                /**
                 * @return {void}
                 */
                () => {
                    ScribeBoot.askTick(session);
                },
                null,
            );
        }
    },

    /**
     * @param {object} boot
     * @return {object[]}
     */
    prune(boot) {
        const settings = ScribeBoot.Settings;
        const present = [];
        for (const frame of boot.environment.document.querySelectorAll(settings.FrameTag)) {
            if (typeof frame.src === settings.StringType && frame.src.startsWith(ScribeFrame.Bridge.FramePrefix)) {
                present.push(frame.contentWindow);
            }
        }
        boot.frames = boot.frames.filter(
            /**
             * @param {{ target: object }} entry
             * @return {boolean}
             */
            (entry) => present.includes(entry.target),
        );
        return present;
    },

    /**
     * @param {object} boot
     * @return {object[]}
     */
    targets(boot) {
        return boot.frames.map(
            /**
             * @param {{ target: object }} entry
             * @return {object}
             */
            (entry) => entry.target,
        );
    },

    /**
     * @param {*} token
     * @return {boolean}
     */
    usable(token) {
        const settings = ScribeBoot.Settings;
        return typeof token === settings.StringType && token.length >= settings.TokenShortest && token.length <= settings.TokenLongest;
    },

    /**
     * @param {object} boot
     * @return {string|null}
     */
    keyed(boot) {
        const messages = ScribeBoot.Settings.Messages;
        const environment = boot.environment;
        const name = ScribeFrame.Bridge.TokenName;
        let token = null;
        let reason = messages.NoStore;
        try {
            const stored = environment.storage.get(name, null);
            if (ScribeBoot.usable(stored)) {
                token = stored;
            } else {
                const made = environment.random();
                if (ScribeBoot.usable(made)) {
                    environment.storage.set(name, made);
                    token = made;
                } else {
                    reason = messages.NoToken;
                }
            }
        } catch {
            token = null;
        }
        if (token === null) {
            if (!boot.unkeyed) {
                ScribeBoot.say(boot, `${messages.NoBridge}${reason}`);
            }
            boot.unkeyed = true;
            return null;
        }
        boot.unkeyed = false;
        boot.bridge = token;
        return token;
    },

    /**
     * @param {object} boot
     * @param {object} target
     * @return {?{ target: object, last: ?object, kept: object[], sends: number[], failed: boolean }}
     */
    remember(boot, target) {
        const known = boot.frames.find(
            /**
             * @param {{ target: object }} entry
             * @return {boolean}
             */
            (entry) => entry.target === target,
        );
        if (known !== undefined) {
            return known;
        }
        if (boot.frames.length >= ScribeBoot.Settings.KeptFrames) {
            return null;
        }
        const entry = { target, last: null, kept: [], sends: [], failed: false };
        boot.frames.push(entry);
        return entry;
    },

    /**
     * @param {*} line
     * @return {string|null}
     */
    fit(line) {
        return typeof line === ScribeBoot.Settings.StringType && line.length <= ScribeFrame.Bridge.LongestLine ? line : null;
    },

    /**
     * @param {object} boot
     * @return {Readonly<{ ready: string|null, suggestion: string|null }>}
     */
    offered(boot) {
        const session = boot.session;
        if (session === null || session.closed || session.live === null || session.keeper.view().reader !== true) {
            return ScribeBoot.Settings.NothingOffered;
        }
        session.live.view();
        const lines = session.live.lines();
        const ready = ScribeBoot.fit(lines.ready);
        return Object.freeze({
            ready,
            suggestion: ScribeBoot.fit(lines.suggestion),
            ends: ready === null ? ScribeBoot.Settings.NothingOffered.ends : lines.ends,
        });
    },

    /**
     * @param {object} boot
     * @param {{ target: object, last: ?object, kept: object[], failed: boolean }} entry
     * @param {Readonly<{ ready: string|null, suggestion: string|null }>} lines
     * @return {void}
     */
    post(boot, entry, lines) {
        const settings = ScribeBoot.Settings;
        const bridge = ScribeFrame.Bridge;
        const seq = boot.seq + 1;
        const message = {
            [bridge.TagName]: bridge.Tag,
            kind: bridge.Kind.Arm,
            seq,
            token: boot.bridge,
            ready: lines.ready,
            suggestion: lines.suggestion,
            ends: [...lines.ends],
        };
        const clone = boot.environment.clone;
        try {
            entry.target.postMessage(clone === null ? message : clone(message), bridge.FrameOrigin);
        } catch (error) {
            if (!entry.failed) {
                ScribeBoot.say(boot, `${settings.Messages.NotArmed}${ScribeBoot.words(error)}`);
            }
            entry.failed = true;
            return;
        }
        entry.failed = false;
        boot.seq = seq;
        const session = boot.session !== null && !boot.session.closed ? boot.session : null;
        const arm = Object.freeze({ seq, ready: lines.ready, suggestion: lines.suggestion, session });
        entry.last = arm;
        entry.kept.push(arm);
        entry.kept.splice(settings.FirstEntry, Math.max(entry.kept.length - settings.KeptArms, settings.FirstEntry));
    },

    /**
     * @param {object} boot
     * @param {object[]} forced
     * @return {void}
     */
    arm(boot, forced) {
        const settings = ScribeBoot.Settings;
        if (boot.frames.length === settings.FirstEntry || boot.arming) {
            return;
        }
        boot.arming = true;
        try {
            ScribeBoot.prune(boot);
            if (boot.frames.length === settings.FirstEntry || ScribeBoot.keyed(boot) === null) {
                return;
            }
            const lines = ScribeBoot.offered(boot);
            for (const entry of boot.frames) {
                const last = entry.last;
                const same = last !== null && last.ready === lines.ready && last.suggestion === lines.suggestion;
                if (!same || forced.includes(entry.target)) {
                    ScribeBoot.post(boot, entry, lines);
                }
            }
        } catch (error) {
            ScribeBoot.say(boot, `${settings.Messages.NotArmed}${ScribeBoot.words(error)}`);
        } finally {
            boot.arming = false;
        }
    },

    /**
     * @param {object} boot
     * @param {{ kept: object[] }} entry
     * @param {{ seq: number, ready: boolean, suggestion: boolean }} report
     * @return {void}
     */
    reported(boot, entry, report) {
        const session = boot.session;
        if (session === null || session.closed) {
            return;
        }
        const kept = entry.kept.find(
            /**
             * @param {{ seq: number }} arm
             * @return {boolean}
             */
            (arm) => arm.seq === report.seq,
        );
        const live = session.live;
        if (kept !== undefined && kept.session === session && live !== null) {
            const ready = report.ready ? kept.ready : null;
            const lines = Object.freeze({
                ready,
                suggestion: report.suggestion ? kept.suggestion : null,
                carried: ready !== null && report.cut !== null ? ready.slice(0, report.cut) : ready,
                crowded: report.crowded,
            });
            ScribeBoot.attempt(
                boot,
                ScribeBoot.Settings.Messages.NotTold,
                /**
                 * @return {*}
                 */
                () => live.went(lines),
            );
        }
        ScribeBoot.stir(session);
    },

    /**
     * @param {object} boot
     * @param {{ origin: *, source: *, data: * }} event
     * @return {void}
     */
    hear(boot, event) {
        const bridge = ScribeFrame.Bridge;
        try {
            if (event.isTrusted !== true || event.origin !== bridge.FrameOrigin) {
                return;
            }
            const report = ScribeFrame.report(event.data);
            if (report === null) {
                return;
            }
            const source = event.source;
            if (!ScribeBoot.prune(boot).includes(source)) {
                return;
            }
            const entry = ScribeBoot.remember(boot, source);
            if (entry === null) {
                return;
            }
            if (report.kind === bridge.Kind.Sent) {
                const settings = ScribeBoot.Settings;
                const now = boot.environment.clock.now();
                if (
                    entry.sends.some(
                        /**
                         * @param {number} time
                         * @return {boolean}
                         */
                        (time) => time > now,
                    )
                ) {
                    entry.sends = [];
                }
                entry.sends = entry.sends.filter(
                    /**
                     * @param {number} time
                     * @return {boolean}
                     */
                    (time) => now - time <= settings.SentWindowMs,
                );
                if (entry.sends.length >= settings.SentLimit) {
                    return;
                }
                entry.sends.push(now);
                ScribeBoot.reported(boot, entry, report);
            }
            ScribeBoot.arm(boot, [source]);
        } catch (error) {
            ScribeBoot.say(boot, `${ScribeBoot.Settings.Messages.NotHeard}${ScribeBoot.words(error)}`);
        }
    },

    /**
     * @param {object} session
     * @param {*} path
     * @return {boolean}
     */
    ours(session, path) {
        const settings = ScribeBoot.Settings;
        if (typeof path !== settings.StringType || !path.startsWith(settings.RoomsPath)) {
            return false;
        }
        const segment = path.slice(settings.RoomsPath.length).split(settings.PathStart)[settings.FirstEntry];
        let roomId = null;
        try {
            roomId = decodeURIComponent(segment);
        } catch {
            roomId = null;
        }
        return roomId === session.roomId;
    },

    /**
     * @param {object} session
     * @return {void}
     */
    tick(session) {
        const keeper = session.keeper;
        session.gapping = true;
        session.owed = false;
        ScribeBoot.later(
            session,
            ScribeBoot.Settings.TickGapMs,
            /**
             * @return {void}
             */
            () => {
                session.gapping = false;
                if (session.owed) {
                    ScribeBoot.tick(session);
                }
            },
            null,
        );
        ScribeBoot.contest(session);
        ScribeBoot.arm(session.boot, []);
        const cloud = session.cloud;
        ScribeBoot.attempt(
            session.boot,
            ScribeBoot.Settings.Messages.NotSynced,
            /**
             * @return {Promise<void>}
             */
            () => cloud.tick(),
        );
        ScribeBoot.attempt(
            session.boot,
            ScribeBoot.Settings.Messages.NotChecked,
            /**
             * @return {Promise<void>}
             */
            () => keeper.tick(),
        );
    },

    /**
     * @param {object} session
     * @return {void}
     */
    sync(session) {
        const cloud = session.cloud;
        if (cloud === null || session.closed) {
            return;
        }
        ScribeBoot.attempt(
            session.boot,
            ScribeBoot.Settings.Messages.NotSynced,
            /**
             * @return {Promise<void>}
             */
            () => cloud.stir(),
        );
    },

    /**
     * @param {object} session
     * @return {boolean}
     * @throws {Error}
     */
    chosen(session) {
        if (session.locking) {
            return session.reader;
        }
        const storage = session.boot.environment.storage;
        const name = ScribeStore.name(ScribeStore.Settings.Types.Claim, ScribeStore.room(session.roomId));
        const held = ScribeStore.claimOf(ScribeStore.fetch(storage, name));
        return held !== null && held.tabId === session.boot.environment.tabId;
    },

    /**
     * @param {object} session
     * @return {void}
     */
    askTick(session) {
        if (!session.ticking) {
            return;
        }
        if (session.gapping) {
            session.owed = true;
            return;
        }
        ScribeBoot.tick(session);
    },

    /**
     * @param {object} boot
     * @return {boolean}
     */
    hidden(boot) {
        return boot.environment.document.visibilityState === ScribeBoot.Settings.Hidden;
    },

    /**
     * @param {object} session
     * @return {boolean}
     */
    reading(session) {
        return session.keeper !== null && session.keeper.view().phase === ScribeKeeper.Phase.Reading;
    },

    /**
     * @param {object} session
     * @return {Promise<void>}
     */
    hold(session) {
        session.reader = true;
        return new Promise(
            /**
             * @param {Function} release
             * @return {void}
             */
            (release) => {
                session.release = release;
            },
        );
    },

    /**
     * @param {object} session
     * @return {void}
     */
    giveBack(session) {
        session.reader = false;
        if (session.release !== null) {
            const release = session.release;
            session.release = null;
            release();
        }
    },

    /**
     * @param {object} session
     * @return {void}
     */
    withdraw(session) {
        if (session.asking !== null) {
            const asking = session.asking;
            session.asking = null;
            asking.abort();
        }
    },

    /**
     * @param {object} session
     * @param {*} error
     * @return {void}
     */
    rest(session, error) {
        const settings = ScribeBoot.Settings;
        if (!session.warned) {
            session.warned = true;
            ScribeBoot.say(session.boot, `${settings.Messages.NotLocked}${ScribeBoot.words(error)}`);
        }
        session.resting = true;
        ScribeBoot.later(
            session,
            settings.LockRetryMs,
            /**
             * @return {void}
             */
            () => {
                session.resting = false;
                ScribeBoot.look(session);
            },
            null,
        );
    },

    /**
     * @param {object} session
     * @return {void}
     */
    wait(session) {
        const settings = ScribeBoot.Settings;
        const boot = session.boot;
        const environment = boot.environment;
        if (session.closed || session.reader || session.resting || session.asking !== null) {
            return;
        }
        let asking = null;
        let asked = null;
        try {
            asking = new environment.pageWindow.AbortController();
            session.asking = asking;
            asked = environment.locks.request(
                `${settings.LockPrefix}${session.roomId}`,
                { signal: asking.signal },
                /**
                 * @return {Promise<void>|null}
                 */
                () => {
                    if (session.asking === asking) {
                        session.asking = null;
                    }
                    if (session.closed || !session.locking) {
                        return null;
                    }
                    const held = ScribeBoot.hold(session);
                    ScribeBoot.askTick(session);
                    return held;
                },
            );
        } catch (error) {
            session.asking = null;
            ScribeBoot.rest(session, error);
            return;
        }
        Promise.resolve(asked).then(
            null,
            /**
             * @param {*} error
             * @return {void}
             */
            (error) => {
                if (session.asking === asking) {
                    session.asking = null;
                }
                if (!asking.signal.aborted) {
                    ScribeBoot.rest(session, error);
                }
            },
        );
    },

    /**
     * @param {object} session
     * @return {Promise<void>}
     */
    lock(session) {
        const settings = ScribeBoot.Settings;
        const messages = settings.Messages;
        const boot = session.boot;
        return new Promise(
            /**
             * @param {Function} answered
             * @return {void}
             */
            (answered) => {
                let known = false;

                /**
                 * @param {string|null} failure
                 * @return {void}
                 */
                const answer = (failure) => {
                    if (known) {
                        return;
                    }
                    known = true;
                    if (failure !== null) {
                        session.locking = false;
                        ScribeBoot.say(boot, `${messages.NoLock}${failure}`);
                    }
                    answered();
                };
                ScribeBoot.later(
                    session,
                    settings.LockWaitMs,
                    /**
                     * @return {void}
                     */
                    () => {
                        answer(messages.Silent);
                    },
                    /**
                     * @return {void}
                     */
                    () => {
                        answer(null);
                    },
                );
                let asked = null;
                try {
                    asked = boot.environment.locks.request(
                        `${settings.LockPrefix}${session.roomId}`,
                        settings.IfAvailable,
                        /**
                         * @param {object|null} lock
                         * @return {Promise<void>|null}
                         */
                        (lock) => {
                            if (known || session.closed) {
                                answer(null);
                                return null;
                            }
                            session.locking = true;
                            answer(null);
                            if (lock === null) {
                                ScribeBoot.wait(session);
                                return null;
                            }
                            return ScribeBoot.hold(session);
                        },
                    );
                } catch (error) {
                    answer(ScribeBoot.words(error));
                    return;
                }
                Promise.resolve(asked).then(
                    null,
                    /**
                     * @param {*} error
                     * @return {void}
                     */
                    (error) => {
                        answer(ScribeBoot.words(error));
                    },
                );
            },
        );
    },

    /**
     * @param {object} session
     * @return {void}
     */
    look(session) {
        if (!session.closed && session.locking) {
            ScribeBoot.wait(session);
        }
    },

    /**
     * @param {object} session
     * @param {*} state
     * @return {void}
     */
    yieldTo(session, state) {
        const settings = ScribeBoot.Settings;
        const name = `${settings.LockPrefix}${session.roomId}`;
        const pending = state?.pending;
        session.wanted =
            Array.isArray(pending) &&
            pending.some(
                /**
                 * @param {*} request
                 * @return {boolean}
                 */
                (request) => request?.name === name,
            );
        if (!session.wanted || session.closed || session.release === null || !ScribeBoot.hidden(session.boot) || ScribeBoot.reading(session)) {
            return;
        }
        session.wanted = false;
        ScribeBoot.giveBack(session);
        ScribeBoot.wait(session);
    },

    /**
     * @param {object} session
     * @return {void}
     */
    contest(session) {
        const settings = ScribeBoot.Settings;
        const boot = session.boot;
        const locks = boot.environment.locks;
        if (session.closed || !session.locking || session.release === null || !ScribeBoot.hidden(boot) || typeof locks.query !== settings.FunctionType) {
            return;
        }
        let asked = null;
        try {
            asked = locks.query();
        } catch {
            return;
        }
        Promise.resolve(asked)
            .then(
                /**
                 * @param {*} state
                 * @return {void}
                 */
                (state) => {
                    ScribeBoot.yieldTo(session, state);
                },
                /**
                 * @return {null}
                 */
                () => null,
            )
            .then(
                null,
                /**
                 * @param {*} error
                 * @return {void}
                 */
                (error) => {
                    ScribeBoot.say(boot, `${settings.Messages.NotLocked}${ScribeBoot.words(error)}`);
                },
            );
    },

    /**
     * @param {object} session
     * @return {void}
     */
    close(session) {
        const settings = ScribeBoot.Settings;
        const boot = session.boot;
        const timers = boot.environment.timers;
        session.closed = true;
        session.ticking = false;
        if (session.interval !== null) {
            timers.clearInterval(session.interval);
            session.interval = null;
        }
        const endings = [...session.timers.values()];
        for (const timer of session.timers.keys()) {
            timers.clearTimeout(timer);
        }
        session.timers.clear();
        session.held = null;
        for (const part of settings.Parts) {
            const built = session[part.name];
            session[part.name] = null;
            if (built !== null) {
                ScribeBoot.attempt(
                    boot,
                    settings.Messages.NotClosed,
                    /**
                     * @return {*}
                     */
                    () => built[part.ending](),
                );
            }
        }
        ScribeBoot.withdraw(session);
        ScribeBoot.giveBack(session);
        ScribeBoot.repay(session);
        for (const entry of boot.frames) {
            entry.kept = [];
        }
        ScribeBoot.arm(boot, ScribeBoot.targets(boot));
        for (const ended of endings) {
            if (ended !== null) {
                ended();
            }
        }
    },

    /**
     * @param {object} session
     * @return {Promise<void>}
     */
    async begin(session) {
        const settings = ScribeBoot.Settings;
        const messages = settings.Messages;
        const boot = session.boot;
        const environment = boot.environment;
        try {
            if (environment.locks !== null) {
                await ScribeBoot.lock(session);
            }
            if (session.closed) {
                return;
            }

            /**
             * @param {string} url
             * @param {object} init
             * @return {Promise<object>}
             */
            const fetch = (url, init) =>
                boot.pageFetch.call(environment.pageWindow, url, environment.clone === null ? init : environment.clone(init));

            /**
             * @param {number} milliseconds
             * @return {Promise<void>}
             */
            const pause = (milliseconds) => ScribeBoot.pause(session, milliseconds);
            session.cloud = ScribeCloud.open({
                storage: environment.storage,
                roomId: session.roomId,
                notesRoom: environment.pageWindow.location.pathname,
                xmlHttpRequest: environment.xmlHttpRequest,
                clock: environment.clock,
                random: environment.random,

                /**
                 * @param {number} milliseconds
                 * @param {Function} action
                 * @return {void}
                 */
                later: (milliseconds, action) => {
                    ScribeBoot.later(session, milliseconds, action, null);
                },

                /**
                 * @return {boolean}
                 */
                chosen: () => ScribeBoot.chosen(session),

                /**
                 * @return {boolean}
                 */
                reader: () => session.keeper !== null && session.keeper.view().reader === true,

                /**
                 * @return {boolean}
                 */
                busy: () => session.keeper !== null && (session.keeper.view().busy ?? null) !== null,

                /**
                 * @return {boolean}
                 */
                reading: () => ScribeBoot.reading(session),

                /**
                 * @return {void}
                 */
                notify: () => {
                    const keeper = session.keeper;
                    if (session.closed || keeper === null) {
                        return;
                    }
                    ScribeBoot.redraw(session);
                    ScribeBoot.attempt(
                        boot,
                        messages.NotChecked,
                        /**
                         * @return {Promise<void>}
                         */
                        () => keeper.tick(),
                    );
                },
            });
            const options = {
                storage: environment.storage,
                roomId: session.roomId,
                tabId: environment.tabId,
                zeta: Object.freeze({
                    /**
                     * @param {(count: number) => void} onPage
                     * @return {Promise<object>}
                     */
                    history: (onPage) =>
                        ZetaSource.history({ fetch, token: ScribeBoot.token(boot), roomId: session.roomId, pause, onPage }),

                    /**
                     * @return {Promise<object>}
                     */
                    newest: () => ZetaSource.newest({ fetch, token: ScribeBoot.token(boot), roomId: session.roomId, pause }),
                }),

                /**
                 * @param {string} role
                 * @param {string} system
                 * @param {string} user
                 * @return {Promise<{ text: string, cost: number }>}
                 */
                ask: (role, system, user) => ScribeBoot.ask(session, role, system, user),
                clock: environment.clock,

                /**
                 * @return {Promise<string|null>}
                 */
                profile: async () => (session.live === null ? null : session.live.profile()),

                /**
                 * @param {{ kind: string, message?: * }} event
                 * @return {void}
                 */
                notify: (event) => {
                    if (session.closed) {
                        return;
                    }
                    if (event.kind === ScribeKeeper.Event.Reply) {
                        const live = session.live;
                        if (live === null) {
                            session.held = { message: event.message };
                        } else {
                            ScribeBoot.attempt(
                                boot,
                                messages.NotHanded,
                                /**
                                 * @return {*}
                                 */
                                () => live.reply(event.message),
                            );
                        }
                    }
                    ScribeBoot.redraw(session);
                    ScribeBoot.arm(boot, []);
                    ScribeBoot.sync(session);
                    if (session.wanted) {
                        ScribeBoot.contest(session);
                    }
                },

                /**
                 * @return {boolean}
                 */
                lease: () => session.cloud !== null && session.cloud.leads(),
            };
            if (session.locking) {
                /**
                 * @return {boolean}
                 */
                options.claim = () => session.reader;
            }
            const keeper = await ScribeKeeper.open(options);
            if (session.closed) {
                ScribeBoot.attempt(
                    boot,
                    messages.NotClosed,
                    /**
                     * @return {*}
                     */
                    () => keeper.close(),
                );
                return;
            }
            session.keeper = keeper;
            const live = ScribeLive.open({
                keeper,
                storage: environment.storage,
                roomId: session.roomId,

                /**
                 * @param {string} role
                 * @param {string} system
                 * @param {string} user
                 * @return {Promise<{ text: string, cost: number }>}
                 */
                ask: (role, system, user) => ScribeBoot.counted(session, role, system, user),
                clock: environment.clock,

                /**
                 * @return {Promise<object>}
                 */
                story: () => ZetaSource.story({ fetch, token: ScribeBoot.token(boot), roomId: session.roomId, pause }),

                /**
                 * @param {string|null} plotId
                 * @return {Promise<string|null>}
                 */
                profile: (plotId) =>
                    ZetaSource.profile({ fetch, token: ScribeBoot.token(boot), roomId: session.roomId, pause }, plotId),

                /**
                 * @return {void}
                 */
                notify: () => {
                    ScribeBoot.redraw(session);
                    ScribeBoot.arm(boot, []);
                    ScribeBoot.sync(session);
                },
            });
            session.live = live;
            if (session.held !== null) {
                const message = session.held.message;
                session.held = null;
                ScribeBoot.attempt(
                    boot,
                    messages.NotHanded,
                    /**
                     * @return {*}
                     */
                    () => live.reply(message),
                );
            }
            session.panel = ScribePanel.mount({
                document: environment.document,
                keeper,
                live,
                cloud: session.cloud,
                storage: environment.storage,
                confirm: environment.confirm,
                download: environment.download,
                clock: environment.clock,
            });
            session.sender = ScribeSender.attach({
                document: environment.document,
                window: environment.pageWindow,
                ignore: session.panel.host ?? null,

                /**
                 * @param {...*} values
                 * @return {*}
                 */
                outgoing: (...values) => live.outgoing(...values),

                /**
                 * @param {...*} values
                 * @return {*}
                 */
                sent: (...values) => live.sent(...values),
            });
            session.interval = environment.timers.setInterval(
                /**
                 * @return {void}
                 */
                () => {
                    ScribeBoot.askTick(session);
                },
                settings.TickMs,
            );
            session.ticking = true;
            ScribeBoot.arm(boot, ScribeBoot.targets(boot));
            const cloud = session.cloud;
            ScribeBoot.attempt(
                boot,
                messages.NotSynced,
                /**
                 * @return {Promise<void>}
                 */
                () => cloud.tick(),
            );
        } catch (error) {
            const abandoned = session.closed;
            ScribeBoot.close(session);
            ScribeBoot.say(boot, `${messages.NotStarted}${ScribeBoot.words(error)}`);
            if (!abandoned) {
                boot.retry = environment.timers.setTimeout(
                    /**
                     * @return {void}
                     */
                    () => {
                        boot.retry = null;
                        if (boot.session === session) {
                            boot.session = null;
                            ScribeBoot.follow(boot);
                        }
                    },
                    settings.RetryMs,
                );
            }
        }
    },

    /**
     * @param {object} boot
     * @return {void}
     */
    forget(boot) {
        if (boot.retry !== null) {
            boot.environment.timers.clearTimeout(boot.retry);
            boot.retry = null;
        }
    },

    /**
     * @param {object} boot
     * @return {void}
     */
    follow(boot) {
        const environment = boot.environment;
        try {
            ScribeBoot.token(boot);
            if (environment.document.body === null) {
                return;
            }
            const roomId = ZetaSource.room(environment.pageWindow.location.pathname);
            const current = boot.session;
            if ((current === null ? null : current.roomId) === roomId) {
                if (current !== null) {
                    ScribeBoot.look(current);
                }
                return;
            }
            ScribeBoot.forget(boot);
            if (current !== null) {
                boot.session = null;
                ScribeBoot.close(current);
            }
            if (roomId !== null) {
                const session = {
                    boot,
                    roomId,
                    closed: false,
                    ticking: false,
                    locking: false,
                    reader: false,
                    release: null,
                    asking: null,
                    resting: false,
                    warned: false,
                    wanted: false,
                    cloud: null,
                    keeper: null,
                    live: null,
                    panel: null,
                    sender: null,
                    held: null,
                    interval: null,
                    timers: new Map(),
                    gapping: false,
                    owed: false,
                };
                boot.session = session;
                ScribeBoot.begin(session);
            }
        } catch (error) {
            ScribeBoot.say(boot, `${ScribeBoot.Settings.Messages.NotFollowed}${ScribeBoot.words(error)}`);
        }
    },

    /**
     * @param {Date} date
     * @return {string}
     */
    day(date) {
        const settings = ScribeBoot.Settings;
        return [date.getFullYear(), date.getMonth() + settings.MonthOffset, date.getDate()]
            .map(
                /**
                 * @param {number} part
                 * @return {string}
                 */
                (part) => String(part).padStart(settings.DateDigits, settings.DatePad),
            )
            .join(settings.DateJoint);
    },

    /**
     * @param {{ pageWindow: object, document: object, storage: object, xmlHttpRequest: Function, exporter: Function|null, clone: Function|null, timers: { setTimeout: Function, clearTimeout: Function, setInterval: Function, clearInterval: Function }, clock: { now: () => number, today: () => string }, tabId: string, locks: object|null, confirm: (text: string) => boolean, download: (name: string, text: string) => void, log: (text: string) => void, random: () => string, menu: (label: string, action: Function) => void, prompt: (text: string) => string|null, alert: (text: string) => void }} environment
     * @return {Readonly<{ stop: () => void }>}
     */
    start(environment) {
        const settings = ScribeBoot.Settings;
        const messages = settings.Messages;
        const boot = {
            environment,
            root: environment.document.documentElement ?? null,
            pageFetch: null,
            watcher: null,
            shield: null,
            visibility: null,
            request: null,
            session: null,
            route: null,
            retry: null,
            tokens: [],
            debts: new Map(),
            listener: null,
            bridge: null,
            unkeyed: false,
            frames: [],
            arming: false,
            seq: 0,
        };
        if (boot.root !== null && boot.root.hasAttribute(settings.Mark)) {
            ScribeBoot.say(boot, messages.Running);
            return Object.freeze({
                /**
                 * @return {void}
                 */
                stop: () => {},
            });
        }
        try {
            boot.pageFetch = environment.pageWindow.fetch;
            boot.watcher = ZetaSource.watch(environment.pageWindow, environment.exporter === null ? undefined : environment.exporter);

            /**
             * @param {object} event
             * @return {void}
             */
            const shield = (event) => {
                ScribeBoot.shield(boot, event);
            };
            for (const type of settings.KeyEvents) {
                environment.pageWindow.addEventListener(type, shield, settings.Capture);
            }
            boot.shield = shield;

            /**
             * @param {{ origin: *, source: *, data: * }} event
             * @return {void}
             */
            const listener = (event) => {
                ScribeBoot.hear(boot, event);
            };
            environment.pageWindow.addEventListener(settings.MessageEvent, listener);
            boot.listener = listener;
        } catch (error) {
            ScribeBoot.say(boot, `${messages.NotWatched}${ScribeBoot.words(error)}`);
        }
        if (boot.root !== null) {
            boot.root.setAttribute(settings.Mark, settings.Nothing);
        }

        /**
         * @return {void}
         */
        const visibility = () => {
            if (boot.session !== null) {
                ScribeBoot.contest(boot.session);
            }
        };
        environment.document.addEventListener(settings.VisibilityEvent, visibility);
        boot.visibility = visibility;
        ScribeBoot.keyed(boot);
        const cloudWords = ScribeCloud.Settings;
        environment.menu(
            cloudWords.Menu,
            /**
             * @return {void}
             */
            () => {
                ScribeBoot.attempt(
                    boot,
                    messages.NotSynced,
                    /**
                     * @return {void}
                     * @throws {Error}
                     */
                    () => {
                        const key = environment.prompt(cloudWords.Prompt);
                        if (key === null || key === undefined) {
                            return;
                        }
                        if (!ScribeCloud.validKey(key)) {
                            environment.alert(cloudWords.BadKey);
                            return;
                        }
                        if (key === ScribeStore.cloudKey(environment.storage)) {
                            return;
                        }
                        ScribeStore.setCloudKey(environment.storage, key);
                        if (boot.session !== null && !boot.session.closed) {
                            ScribeBoot.askTick(boot.session);
                        }
                    },
                );
            },
        );
        boot.request = ScribeBoot.request(environment.xmlHttpRequest);
        if (boot.watcher !== null) {
            boot.watcher.onTraffic(
                /**
                 * @param {{ method: string, path: string }} traffic
                 * @return {void}
                 */
                (traffic) => {
                    const session = boot.session;
                    if (session !== null && ScribeBoot.ours(session, traffic.path)) {
                        ScribeBoot.stir(session);
                    }
                },
            );
        }
        ScribeBoot.follow(boot);
        boot.route = environment.timers.setInterval(
            /**
             * @return {void}
             */
            () => {
                ScribeBoot.follow(boot);
            },
            settings.RouteMs,
        );
        return Object.freeze({
            /**
             * @return {void}
             */
            stop: () => {
                if (boot.session !== null) {
                    ScribeBoot.close(boot.session);
                    boot.session = null;
                }
                environment.timers.clearInterval(boot.route);
                ScribeBoot.forget(boot);
                if (boot.watcher !== null) {
                    boot.watcher.stop();
                }
                if (boot.shield !== null) {
                    for (const type of settings.KeyEvents) {
                        environment.pageWindow.removeEventListener(type, boot.shield, settings.Capture);
                    }
                    boot.shield = null;
                }
                if (boot.visibility !== null) {
                    environment.document.removeEventListener(settings.VisibilityEvent, boot.visibility);
                    boot.visibility = null;
                }
                if (boot.listener !== null) {
                    environment.pageWindow.removeEventListener(settings.MessageEvent, boot.listener);
                    boot.listener = null;
                }
                if (boot.root !== null) {
                    boot.root.removeAttribute(settings.Mark);
                    boot.root = null;
                }
            },
        });
    },
});
