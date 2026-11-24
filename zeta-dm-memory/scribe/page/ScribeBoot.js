const ScribeBoot = Object.freeze({
    Role: Object.freeze({
        Analyzer: 'Analyzer',
        Scribe: 'Scribe',
        Pedant: 'Pedant',
    }),

    Settings: Object.freeze({
        TickMs: 20000,
        TickGapMs: 3000,
        RouteMs: 1000,
        RetryMs: 10000,
        Attempts: 3,
        PauseMs: 2000,
        NoneStopped: 0,
        LockWaitMs: 2000,
        LockRetryMs: 10000,
        ModelOrigin: 'https://openrouter.ai',
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
        NothingOffered: Object.freeze({
            ready: null,
            suggestion: null,
            ends: Object.freeze([]),
            reminder: null,
            attempt: null,
        }),
        Capture: true,
        Hidden: 'hidden',
        ResponseType: 'text',
        Redirect: 'error',
        PathStart: '/',
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
            Stopped: 'The request was stopped',
            NotReader: 'This tab is no longer the reader for this chat',
            Paused: 'The book is paused',
            NoKey: 'No key',
            KeyStorage: 'Scribe could not read the saved OpenRouter key from local storage.',
            ReminderNotSaved: 'Reminder was not saved. Your text is still here. Click Save to retry.',
            ReminderNotGenerated: 'The reminder request could not be delivered to the reading tab.',
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
     * @return {number|null}
     */
    later(session, milliseconds, action, ended) {
        if (session.closed) {
            if (ended !== null) {
                ended();
            }
            return null;
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
        return timer;
    },

    /**
     * @param {object} session
     * @param {number} milliseconds
     * @param {AbortSignal|null} signal
     * @return {Promise<void>}
     */
    pause(session, milliseconds, signal = null) {
        return new Promise(
            /**
             * @param {Function} resolve
             * @param {Function} reject
             * @return {void}
             */
            (resolve, reject) => {
                const stopped = () => {
                    session.boot.environment.timers.clearTimeout(timer);
                    session.timers.delete(timer);
                    reject(new Error(ScribeBoot.Settings.Messages.Stopped));
                };
                const timer = ScribeBoot.later(session, milliseconds, () => {
                    signal?.removeEventListener('abort', stopped);
                    resolve();
                }, () => {
                    signal?.removeEventListener('abort', stopped);
                    reject(new Error(ScribeBoot.Settings.Messages.Left));
                });
                if (signal?.aborted) {
                    stopped();
                } else if (timer !== null) {
                    signal?.addEventListener('abort', stopped, { once: true });
                }
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
     * @return {string}
     * @throws {Error}
     */
    modelKey(session) {
        const messages = ScribeBoot.Settings.Messages;
        if (!ScribeBoot.currentRoom(session)) {
            throw new Error(messages.Left);
        }
        ScribeBoot.refreshKey(session.boot);
        if (session.boot.keyProblem) {
            throw Object.assign(new Error(messages.KeyStorage), { source: 'Scribe', code: ScribeStore.KeyStorageSource });
        }
        if (!session.boot.keyValue) {
            throw new Error(messages.NoKey);
        }
        return session.boot.keyValue;
    },

    /**
     * @param {object} session
     * @param {string} role
     * @param {string} system
     * @param {string} user
     * @param {{ amount: number, settled: boolean }} bill
     * @param {'keeper'|'live'|'reminder'} helper
     * @param {Function|null} beforeDispatch
     * @return {Promise<{ text: string, tokensIn: number, tokensOut: number, reasoningTokens: number|null, finish: string, stopped: number }>}
     * @throws {Error}
     */
    async call(session, role, system, user, bill, helper, beforeDispatch = null) {
        const settings = ScribeBoot.Settings;
        const messages = settings.Messages;
        const environment = session.boot.environment;
        if (!ScribeBoot.currentRoom(session)) {
            throw new Error(messages.Left);
        }
        const current = session.keeper?.view();
        if (current?.stop?.reason === ScribeAdoption.Stop.Paused) {
            throw new Error(messages.Paused);
        }
        if (current && !current.booked) {
            throw new Error(ScribeKeeper.Settings.Messages.NoBook);
        }
        const epoch = session.pauseEpoch;
        const model = ScribeBoot.setting(session, settings.Models[role]);

        const dispatchedKeys = new Set();
        const historicalCheck = role === ScribeBoot.Role.Pedant && helper === 'keeper';
        const singleAttempt = historicalCheck || helper === 'reminder';
        const notes = historicalCheck || session.cloud === null ? null : session.cloud.notes();
        const noted = typeof notes === settings.StringType && notes !== settings.Nothing;
        const told = noted ? `${user}${settings.NotesOpen}${notes}` : user;
        for (;;) {
            if (session.pauseEpoch !== epoch) {
                throw new Error(messages.Paused);
            }
            const trial = {
                cancelled: null,
                keyVersion: null,
                stopper: new environment.pageWindow.AbortController(),
                dispatchError: null,
                halt: null,
            };
            const halted = new Promise(
                /**
                 * @param {Function} resolve
                 * @return {void}
                 */
                (resolve) => {
                    trial.halt = (reason) => {
                        if (trial.cancelled !== null) {
                            return;
                        }
                        trial.cancelled = reason;
                        trial.stopper.abort();
                        resolve({ answer: null, error: new Error(reason) });
                    };
                },
            );
            const pause = (milliseconds) => ScribeBoot.pause(session, milliseconds, trial.stopper.signal);
            /**
             * @param {string} url
             * @param {object} options
             * @return {Promise<{ status: number, text: () => Promise<string> }>}
             */
            const fetch = async (url, options) => {
                if (beforeDispatch !== null) {
                    try {
                        beforeDispatch();
                    } catch (error) {
                        trial.dispatchError = error;
                        throw error;
                    }
                }
                trial.keyVersion = session.boot.keyVersion;
                dispatchedKeys.add(session.boot.keyValue);
                const response = await session.boot.request(url, options);
                const text = await response.text();
                if (trial.cancelled === messages.Paused) {
                    throw new Error(trial.cancelled);
                }
                const cost = ScribeBoot.billed(text);
                if (bill.settled) {
                    ScribeBoot.charge(session, cost);
                } else {
                    bill.amount += cost;
                }
                if (trial.cancelled !== null) {
                    throw new Error(trial.cancelled);
                }
                return { status: response.status, text: async () => text };
            };
            session.running.add(trial);
            ScribeBoot.redraw(session);
            const going = ScribeGateway.retry(
                /**
                 * @return {Promise<object>}
                 */
                async () => {
                    await Promise.resolve();
                    const previousVersion = trial.keyVersion;
                    trial.keyVersion = null;
                    if (!ScribeBoot.currentRoom(session)) {
                        throw new Error(messages.Left);
                    }
                    if (epoch !== session.pauseEpoch) {
                        throw new Error(messages.Paused);
                    }
                    if (bill.settled || trial.cancelled) {
                        throw new Error(messages.Stopped);
                    }
                    let key;
                    let preparedVersion;
                    let wasUnreadable;
                    do {
                        preparedVersion = session.boot.keyVersion;
                        wasUnreadable = session.boot.keyProblem;
                        const resuming = dispatchedKeys.size > 0 && previousVersion !== preparedVersion;
                        if (singleAttempt || resuming || (dispatchedKeys.size === 0 && helper === 'live')) {
                            ScribeBoot.affordable(session, bill.amount);
                        } else {
                            ScribeBoot.solvent(session);
                        }
                        if (session.keyPending && helper === 'keeper') {
                            session.keyPending.keeper = false;
                        } else if (session.keyPending && session.live) {
                            session.keyPending.liveWork ??= session.live.keyWork();
                        }
                        const view = session.keeper?.view();
                        if (!view?.reader || !session.cloud.leads() || !ScribeBoot.chosen(session)) {
                            throw new Error(messages.NotReader);
                        }
                        if (view.stop?.reason === ScribeAdoption.Stop.Paused) {
                            throw new Error(messages.Paused);
                        }
                        if (!view.booked) {
                            throw new Error(ScribeKeeper.Settings.Messages.NoBook);
                        }
                        key = ScribeBoot.modelKey(session);
                    } while (preparedVersion !== session.boot.keyVersion || wasUnreadable);
                    return ScribeGateway.call({
                        fetch,
                        key,
                        reading: true,
                        model,
                        system,
                        user: told,
                        sleep: pause,
                        timeoutMs: null,
                        signal: trial.stopper.signal,
                    });
                },
                { attempts: singleAttempt ? 1 : settings.Attempts, pauseMs: settings.PauseMs, sleep: pause },
            ).then(
                /**
                 * @param {object} answer
                 * @return {{ answer: object, error: null }}
                 */
                (answer) => ({ answer, error: null }),
                /**
                 * @param {*} error
                 * @return {{ answer: null, error: * }}
                 */
                (error) => {
                    const failure = trial.dispatchError ?? error;
                    failure.source = trial.keyVersion === null ? 'Scribe' : 'OpenRouter';
                    return { answer: null, error: failure };
                },
            );
            const outcome = await Promise.race([going, halted]);
            session.running.delete(trial);
            ScribeBoot.redraw(session);
            if (outcome.error !== null) {
                let error = outcome.error;
                const unauthorized = error.status === 401 || error.providerCode === 401;
                if (historicalCheck && trial.keyVersion !== null) {
                    error.billed = bill.amount > settings.NoSpending;
                    if (unauthorized && !error.billed && !error.usedTokens && beforeDispatch !== null) {
                        error.unbilledAuth = true;
                        error.keyChanged = () => {
                            ScribeBoot.refreshKey(session.boot);
                            return !session.boot.keyProblem && trial.keyVersion !== session.boot.keyVersion;
                        };
                    }
                } else if (unauthorized && trial.keyVersion !== null) {
                    try {
                        ScribeBoot.modelKey(session);
                        if (helper !== 'reminder' && trial.keyVersion !== session.boot.keyVersion) {
                            continue;
                        }
                        const version = trial.keyVersion;
                        error.keyChanged = () => {
                            ScribeBoot.refreshKey(session.boot);
                            return session.boot.keyProblem || session.boot.keyVersion !== version;
                        };
                    } catch (problem) {
                        error = problem;
                    }
                }
                if (error.code !== ScribeStore.KeyStorageSource) {
                    const mask = ScribeStore.redactor(environment.storage, dispatchedKeys);
                    for (const field of ['message', 'reason', 'answer', 'finish']) {
                        if (typeof error[field] === 'string') {
                            error[field] = mask(error[field]);
                        }
                    }
                }
                error.stopped = settings.NoneStopped;
                throw error;
            }
            return { ...outcome.answer, stopped: settings.NoneStopped };
        }
    },

    /**
     * @param {object} session
     * @param {string} role
     * @param {string} system
     * @param {string} user
     * @param {Function|null} beforeDispatch
     * @return {Promise<{ text: string, cost: number, stopped: number }>}
     * @throws {Error}
     */
    async ask(session, role, system, user, beforeDispatch = null) {
        const bill = { amount: ScribeBoot.Settings.NoSpending, settled: false };
        try {
            const answer = await ScribeBoot.call(session, role, system, user, bill, 'keeper', beforeDispatch);
            bill.settled = true;
            return { text: answer.text, cost: bill.amount, finish: answer.finish, stopped: answer.stopped };
        } catch (error) {
            bill.settled = true;
            ScribeBoot.charge(session, bill.amount);
            error.source ??= 'Scribe';
            throw error;
        }
    },

    /**
     * @param {object} session
     * @param {number} pending
     * @return {void}
     * @throws {Error}
     */
    affordable(session, pending) {
        const settings = ScribeBoot.Settings;
        const environment = session.boot.environment;
        ScribeBoot.solvent(session);
        const budget = ScribeBoot.setting(session, settings.Budget);
        const today = environment.clock.today();
        const spent =
            ScribeStore.spent(environment.storage, session.roomId, today) +
            ScribeStore.others(environment.storage, session.roomId, today);
        if (spent + pending >= budget) {
            throw new Error(settings.Messages.Spent);
        }
    },

    /**
     * @param {object} session
     * @param {string} role
     * @param {string} system
     * @param {string} user
     * @param {boolean} singleAttempt
     * @return {Promise<{ text: string, cost: number, tokensIn: number, tokensOut: number, reasoningTokens: number|null, finish: string, stopped: number }>}
     * @throws {Error}
     */
    async counted(session, role, system, user, singleAttempt = false) {
        const settings = ScribeBoot.Settings;
        const bill = { amount: settings.NoSpending, settled: false };
        try {
            const answer = await ScribeBoot.call(session, role, system, user, bill, singleAttempt ? 'reminder' : 'live');
            return {
                text: answer.text,
                cost: bill.amount,
                tokensIn: answer.tokensIn,
                tokensOut: answer.tokensOut,
                reasoningTokens: answer.reasoningTokens,
                finish: answer.finish,
                stopped: answer.stopped,
            };
        } catch (error) {
            error.source ??= 'Scribe';
            throw error;
        } finally {
            bill.settled = true;
            ScribeBoot.charge(session, bill.amount);
        }
    },

    /**
     * @param {Function} xmlHttpRequest
     * @return {(url: string, options: { method: string, headers: object, body: string, signal?: object }) => Promise<{ status: number, text: () => Promise<string> }>}
     */
    request(xmlHttpRequest) {
        const settings = ScribeBoot.Settings;
        const messages = settings.Messages;

        /**
         * @param {*} url
         * @param {{ method: string, headers: object, body: string, signal?: object }} options
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
                        const abort = () => {
                            if (typeof handle?.abort !== settings.FunctionType) {
                                reject(new Error(messages.Stopped));
                                return;
                            }
                            try {
                                handle.abort();
                            } catch {
                                reject(new Error(messages.Stopped));
                            }
                        };
                        if (signal.aborted) {
                            abort();
                        } else {
                            signal.addEventListener(settings.AbortEvent, abort, settings.Once);
                        }
                    }
                },
            );
    },

    /**
     * @param {object} session
     * @return {boolean}
     */
    currentRoom(session) {
        const boot = session.boot;
        return !session.closed && !boot.stopped && boot.session === session &&
            ZetaSource.room(boot.environment.pageWindow.location.pathname) === session.roomId;
    },

    /**
     * @param {object} session
     * @return {void}
     */
    recoverKey(session) {
        const pending = session.keyPending;
        if (!pending || session.recoveringKey || !ScribeBoot.currentRoom(session) || !session.live ||
            session.boot.keyProblem || !session.boot.keyValue) {
            return;
        }
        session.recoveringKey = true;
        try {
            const view = session.keeper.view();
            if (!view.reader || view.phase === ScribeKeeper.Phase.Loading || view.busy === ScribeKeeper.Busy.Reading ||
                view.stop?.reason === ScribeAdoption.Stop.Paused || view.stop?.reason === ScribeAdoption.Stop.Budget ||
                view.spentToday >= view.settings?.budget || !session.cloud.leads() || !ScribeBoot.chosen(session)) {
                session.keyRecoveryProblem = false;
                return;
            }
            if (pending.keeper || pending.changed) {
                session.keeper.rekey(pending.changed === true, pending.keeper);
                pending.keeper = false;
                pending.changed = false;
            }
            session.live.rekey(pending.liveWork);
            if (session.keyPending === pending) {
                session.keyPending = null;
            }
            session.keyRecoveryProblem = false;
        } catch {
            session.keyRecoveryProblem = true;
        } finally {
            session.recoveringKey = false;
        }
    },

    /**
     * @param {object} boot
     * @return {boolean}
     */
    refreshKey(boot) {
        if (boot.stopped) {
            return false;
        }
        const unreadable = boot.keyProblem;
        let value;
        try {
            value = ScribeStore.key(boot.environment.storage);
        } catch {
            boot.keyProblem = true;
            if (!unreadable && boot.session && ScribeBoot.currentRoom(boot.session)) {
                ScribeBoot.redraw(boot.session);
            }
            return false;
        }
        boot.keyProblem = false;
        const changed = value !== boot.keyValue;
        if (changed) {
            boot.keyValue = value;
            boot.keyVersion++;
        }
        if ((changed || unreadable) && boot.session && !ScribeBoot.currentRoom(boot.session)) {
            ScribeBoot.follow(boot);
        }
        const session = boot.session;
        if ((changed || unreadable) && session && ScribeBoot.currentRoom(session)) {
            if (changed) {
                session.keyPending = { keeper: true, changed: true };
                session.panel?.keyChanged();
            }
            ScribeBoot.redraw(session);
        }
        return changed;
    },

    /**
     * @param {object} session
     * @param {string} typed
     * @param {number} version
     * @return {boolean}
     */
    saveKey(session, typed, version) {
        const boot = session.boot;
        if (!ScribeBoot.currentRoom(session)) {
            throw new Error(ScribeBoot.Settings.Messages.Left);
        }
        ScribeBoot.refreshKey(boot);
        if (boot.keyProblem) {
            throw new Error(ScribeBoot.Settings.Messages.KeyStorage);
        }
        if (version !== boot.keyVersion) {
            return false;
        }
        const value = typed.trim();
        if (!value) {
            return true;
        }
        ScribeStore.setKey(boot.environment.storage, value);
        ScribeBoot.refreshKey(boot);
        if (boot.keyProblem || boot.keyValue !== value) {
            throw new Error(ScribeStore.Settings.Messages.KeyFailed);
        }
        if (version === boot.keyVersion) {
            session.keyPending = { ...session.keyPending, keeper: true };
            ScribeBoot.recoverKey(session);
        }
        return true;
    },

    /**
     * @param {object} session
     * @return {void}
     */
    redraw(session) {
        if (!ScribeBoot.currentRoom(session)) {
            return;
        }
        ScribeBoot.recoverKey(session);
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
        const entry = { target, last: null, kept: [], sends: [], pending: null, scope: null, failed: false };
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
        const lines = session.live.lines(true);
        const ready = ScribeBoot.fit(lines.ready);
        const reminder = ready === null ? null : ScribeBoot.name(lines.reminder);
        const attempt = reminder === null ? null : ScribeBoot.name(lines.attempt);
        return Object.freeze({
            ready,
            ...(lines.manual === true && ready !== null ? { manual: true } : {}),
            ...(lines.onlyExisting ? { onlyExisting: true } : {}),
            ...(ScribeBoot.fit(lines.previous) ? { previous: lines.previous } : {}),
            ...(ScribeBoot.fit(lines.previousSuggestion) ? { previousSuggestion: lines.previousSuggestion } : {}),
            suggestion: ScribeBoot.fit(lines.suggestion),
            ends: ready === null ? ScribeBoot.Settings.NothingOffered.ends : lines.ends,
            reminder: attempt === null ? null : reminder,
            attempt,
        });
    },

    /**
     * @param {*} identity
     * @return {string|null}
     */
    name(identity) {
        const named =
            typeof identity === ScribeBoot.Settings.StringType &&
            identity.length > ScribeBoot.Settings.FirstEntry &&
            identity.length <= ScribeFrame.Bridge.LongestIdentity;
        return named ? identity : null;
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
        const session = boot.session && !boot.session.closed ? boot.session : null;
        const observationToken = session === null ? null : entry.last?.session === session
            ? entry.last.observationToken : boot.environment.random();
        const message = {
            [bridge.TagName]: bridge.Tag,
            kind: bridge.Kind.Arm,
            seq,
            ...(session ? { room: session.roomId, observationToken } : {}),
            token: boot.bridge,
            ready: lines.ready,
            ...(lines.manual ? { manual: true } : {}),
            ...(lines.onlyExisting ? { onlyExisting: true } : {}),
            ...(lines.previous ? { previous: lines.previous } : {}),
            ...(lines.previousSuggestion ? { previousSuggestion: lines.previousSuggestion } : {}),
            suggestion: lines.suggestion,
            ends: [...lines.ends],
            reminder: lines.reminder,
            attempt: lines.attempt,
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
        const arm = Object.freeze({
            seq,
            observationToken,
            ready: lines.ready,
            manual: lines.manual === true,
            onlyExisting: lines.onlyExisting === true,
            previous: lines.previous,
            previousSuggestion: lines.previousSuggestion,
            ends: lines.ends,
            suggestion: lines.suggestion,
            reminder: lines.reminder,
            attempt: lines.attempt,
            reports: new Set(),
            session,
        });
        if (entry.scope === null || entry.last?.session !== session) {
            entry.scope = seq;
        }
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
            const offered = ScribeBoot.offered(boot);
            const reserved = boot.session?.reservedDelivery;
            const now = boot.environment.clock.now();
            for (const entry of boot.frames) {
                const oldest = entry.sends[settings.FirstEntry];
                const saturated = entry.sends.length >= settings.SentLimit && oldest <= now && now - oldest <= settings.SentWindowMs;
                const waiting = saturated && reserved && reserved.reminder === offered.reminder && reserved.attempt === offered.attempt;
                const lines = waiting ? { ...settings.NothingOffered, suggestion: offered.suggestion } : offered;
                const last = entry.last;
                const same =
                    last !== null &&
                    last.ready === lines.ready &&
                    last.onlyExisting === (lines.onlyExisting === true) &&
                    last.previous === lines.previous &&
                    last.previousSuggestion === lines.previousSuggestion &&
                    last.suggestion === lines.suggestion &&
                    last.reminder === lines.reminder &&
                    last.attempt === lines.attempt;
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
     * @param {string|null} key
     * @param {object|null} outstanding
     * @return {void}
     */
    reported(boot, entry, report, key, outstanding) {
        const session = boot.session;
        if (session === null || session.closed || session.live === null) {
            return;
        }
        const kind = ScribeFrame.Bridge.Kind;
        const pending = entry.pending;
        const finishing = pending !== null && pending.arm.session === session &&
            pending.arm.seq === report.seq && pending.index === report.index;
        const kept = finishing ? pending.arm : entry.kept.find(
            /**
             * @param {{ seq: number }} arm
             * @return {boolean}
             */
            (arm) => arm.seq === report.seq,
        );
        const repeated = kept !== undefined && report.index !== null && kept.reports.has(report.index);
        const forged = kept !== undefined && report.ready && (report.reminder !== null || kept.manual) &&
            (report.reminder !== kept.reminder || report.attempt !== kept.attempt);
        if ((outstanding || kept?.session === session) && !repeated && !forged && !(kept?.manual && report.cut !== null)) {
            const ready = report.ready ? (outstanding ?? kept).ready : null;
            const lines = outstanding ?? Object.freeze({
                key,
                ...(report.submission ? { submission: report.submission } : {}),
                ...((ready !== null || report.previous) && report.retained ? { retained: true } : {}),
                ...(report.previous && kept.previous ? { previous: true, previousSuggestion: report.previousSuggestion } : {}),
                ...((report.previous || (ready !== null && kept.manual)) && report.trimmedSubmission ? { trimmedSubmission: report.trimmedSubmission } : {}),
                ready,
                ...(ready !== null && kept.manual ? { manual: true } : {}),
                suggestion: report.suggestion ? kept.suggestion : null,
                carried: report.previous ? kept.previous : ready !== null && kept.manual ? ScribeSender.paragraph(ready) :
                    ready !== null && report.cut !== null ? ready.slice(0, report.cut) : ready,
                crowded: report.crowded,
                reminder: ready === null ? null : kept.reminder,
                attempt: ready === null ? null : kept.attempt,
            });
            const live = session.live;
            const warning = ScribeBoot.Settings.Messages.NotTold;
            if (report.kind === kind.Starting) {
                if (!finishing) {
                    entry.pending = { arm: kept, index: report.index, lines };
                    let journaled = false;
                    ScribeBoot.attempt(boot, warning, () => { journaled = live.starting(lines) === true; });
                    if (lines.reminder !== null) {
                        const bridge = ScribeFrame.Bridge;
                        const grant = { [bridge.TagName]: bridge.Tag, kind: bridge.Kind.Reserved, token: boot.bridge,
                            room: session.roomId, seq: report.seq, index: report.index, allowed: journaled };
                        if (!journaled) {
                            kept.reports.add(report.index);
                            entry.pending = null;
                        }
                        entry.target.postMessage(boot.environment.clone ? boot.environment.clone(grant) : grant, bridge.FrameOrigin);
                    }
                }
                return;
            }
            if (report.kind === kind.Uncertain && finishing) {
                entry.pending = null;
                ScribeBoot.attempt(boot, warning, () => live.uncertain(pending.lines));
            } else if (finishing || outstanding || report.kind === kind.Sent) {
                if (kept && report.index !== null) {
                    kept.reports.add(report.index);
                }
                const attempted = finishing ? pending.lines : lines;
                if (finishing) {
                    entry.pending = null;
                }
                if (report.kind === kind.Cancelled || report.kind === kind.Rejected) {
                    ScribeBoot.attempt(boot, warning, () => report.kind === kind.Rejected ? live.rejected(attempted, report.status ?? 401) : live.cancelled(attempted));
                    const reserved = session.reservedDelivery;
                    if (reserved && reserved.seq === report.seq && reserved.index === report.index) {
                        const delay = reserved.retryAt - boot.environment.clock.now();
                        if (delay <= 0) {
                            session.reservedDelivery = null;
                        } else {
                            ScribeBoot.later(session, delay, () => {
                                if (session.reservedDelivery === reserved) {
                                    session.reservedDelivery = null;
                                    ScribeBoot.arm(boot, []);
                                }
                            }, null);
                        }
                    }
                } else {
                    ScribeBoot.attempt(boot, warning, () => live.went(attempted));
                    if (attempted.crowded) {
                        ScribeBoot.redraw(session);
                    }
                }
            }
        }
    },

    /**
     * @param {object} boot
     * @param {string} room
     * @return {Function|null}
     */
    nativeMessages(boot, room) {
        if (boot.stopped || ZetaSource.room(boot.environment.pageWindow.location.pathname) !== room) {
            return null;
        }
        if (boot.intake?.room !== room) {
            ScribeBoot.follow(boot);
        }
        const intake = boot.intake;
        if (intake?.room !== room) {
            return null;
        }
        return (page) => {
            if (boot.stopped || intake !== boot.intake || ZetaSource.room(boot.environment.pageWindow.location.pathname) !== room) {
                return;
            }
            const session = boot.session;
            if (session?.keeper && ScribeBoot.currentRoom(session) && session.keeper.observe(page)) {
                return;
            }
            const key = intake.signal + ':' + boot.environment.tabId + ':' + ++boot.relaySequence;
            intake.pages.push({ key, page });
            ScribeBoot.relay(boot, intake);
        };
    },

    /**
     * @param {object} session
     * @param {string} part
     * @return {{id: string, tab?: string, reader?: string|null, preview?: string, error?: string|null}|null}
     */
    reminderValue(session, part) {
        const key = ScribeStore.name('reminder', ScribeStore.room(session.roomId), part);
        return ScribeStore.decode(ScribeStore.fetch(session.boot.environment.storage, key));
    },

    /**
     * @param {object} session
     * @return {Promise<string>}
     * @throws {Error}
     */
    async generateReminder(session) {
        const messages = ScribeBoot.Settings.Messages;
        if (!ScribeBoot.currentRoom(session)) {
            throw new Error(messages.Left);
        }
        if (session.keeper.view().stop?.reason === ScribeAdoption.Stop.Paused) {
            throw new Error(messages.Paused);
        }
        if (ScribeBoot.reminderValue(session, 'generating')) {
            throw new Error('A reminder is already being generated for this room.');
        }
        const { storage, tabId } = session.boot.environment;
        const id = crypto.randomUUID();
        const key = ScribeLive.reminderKey(session.roomId, 'generating');
        return new Promise((resolve, reject) => {
            const leave = () => {
                session.reminderWaits.delete(leave);
                session.inspectGeneration = null;
                reject(new Error(messages.Left));
            };
            const inspect = () => {
                let completed;
                let result;
                try {
                    if (ScribeBoot.reminderValue(session, 'generating')?.id === id) {
                        return;
                    }
                    completed = ScribeBoot.reminderValue(session, 'preview');
                    result = ScribeBoot.reminderValue(session, 'result');
                } catch {
                    return;
                }
                session.reminderWaits.delete(leave);
                session.inspectGeneration = null;
                if (completed?.id === id) {
                    resolve(completed.preview);
                } else {
                    reject(new Error(result?.id === id ? result.error : messages.ReminderNotGenerated));
                }
            };
            session.reminderWaits.set(leave, inspect);
            session.inspectGeneration = inspect;
            try {
                storage.set(key, JSON.stringify({ id, tab: tabId, reader: null }));
                ScribeBoot.serveGeneration(session);
                inspect();
            } catch (error) {
                session.reminderWaits.delete(leave);
                session.inspectGeneration = null;
                reject(error);
            }
        });
    },

    /**
     * @param {object} session
     * @return {void}
     */
    serveGeneration(session) {
        if (!session.live || !ScribeBoot.currentRoom(session)) {
            return;
        }
        const marker = ScribeBoot.reminderValue(session, 'generating');
        if (!marker?.id || !session.keeper.view().reader || !ScribeBoot.chosen(session)) {
            return;
        }
        const { storage, tabId } = session.boot.environment;
        const key = ScribeLive.reminderKey(session.roomId, 'generating');
        if (session.generationWork) {
            if (marker.id !== session.generationWork.id) {
                ScribeLive.storeReminderValue(storage, key, JSON.stringify(session.generationWork));
            }
            return;
        }
        const { id } = marker;
        session.generationWork = { ...marker, reader: tabId };
        const finish = (error = null) => {
            let failedResult;
            try {
                if (ScribeBoot.reminderValue(session, 'generating')?.id === id) {
                    ScribeLive.storeReminderValue(storage, ScribeLive.reminderKey(session.roomId, 'result'),
                        JSON.stringify({ id, error: error ? ScribeStore.diagnostic(storage, ScribeBoot.words(error)) : null }));
                }
            } catch (resultError) {
                failedResult = {error: resultError};
            }
            try {
                if (ScribeBoot.reminderValue(session, 'generating')?.id === id) {
                    let removeError;
                    try {
                        storage.remove(key);
                    } catch (error) {
                        removeError = error;
                    }
                    if (ScribeBoot.reminderValue(session, 'generating')?.id === id) {
                        storage.set(key, null);
                        if (ScribeBoot.reminderValue(session, 'generating')?.id === id) {
                            throw removeError ?? new Error('The reminder generation marker could not be cleared.');
                        }
                    }
                }
            } finally {
                session.generationWork = null;
            }
            if (failedResult) {
                throw failedResult.error;
            }
        };
        if (marker.reader) {
            finish(new Error(ScribeBoot.Settings.Messages.NotReader));
            return;
        }
        try {
            ScribeLive.storeReminderValue(storage, key, JSON.stringify(session.generationWork));
        } catch (error) {
            finish(error);
            return;
        }
        Promise.resolve(session.live.generateReminder()).then((preview) => {
            const current = ScribeBoot.reminderValue(session, 'generating');
            if (current?.id !== id || current.reader !== tabId) {
                throw new Error(ScribeBoot.Settings.Messages.NotReader);
            }
            try {
                ScribeLive.storeReminderValue(storage, ScribeLive.reminderKey(session.roomId, 'preview'), JSON.stringify({ id, preview }));
            } catch (error) {
                throw Object.assign(new Error('The generated reminder could not be saved for this room.'), { cause: error });
            }
        }).then(() => finish(), finish).catch((error) => ScribeBoot.say(session.boot, ScribeBoot.words(error)));
    },

    /**
     * @param {object} session
     * @return {void}
     */
    redrawReminder(session) {
        /** @type {{redrawReminder?: () => boolean}|null} */
        const panel = session.panel;
        session.reminderRefreshFailed = panel?.redrawReminder?.() === false;
    },

    /**
     * @param {object} boot
     * @param {object} intake
     * @return {void}
     */
    relay(boot, intake) {
        if (!intake || boot.stopped || intake !== boot.intake || intake.relaying) {
            return;
        }
        const storage = boot.environment.storage;
        intake.relaying = true;
        try {
            while (intake.pages.length) {
                const { key, page } = intake.pages[0];
                const text = JSON.stringify(page);
                storage.set(key, text);
                if (storage.get(key, null) !== text) {
                    throw new Error('The observed change could not be saved.');
                }
                storage.set(intake.signal, key);
                intake.pages.shift();
            }
            const session = boot.session;
            if (!session?.keeper || !ScribeBoot.currentRoom(session) || !session.keeper.view().reader) {
                intake.reader = false;
                return;
            }
            intake.reader = true;
            const prefix = intake.signal + ':';
            const records = [];
            const edits = [];
            for (const key of storage.list()) {
                if (key.startsWith(prefix)) {
                    const text = storage.get(key, null);
                    if (typeof text === 'string') {
                        const page = ZetaSource.quietly(null, JSON.parse, text);
                        if (key.startsWith(prefix + 'edit:')) {
                            if (typeof page?.text === 'string' && typeof page.shown === 'boolean' &&
                                (page.selectionId === null || typeof page.selectionId === 'string') && Number.isFinite(page.observedAt)) {
                                edits.push({ key, page });
                            }
                        } else if (ZetaSource.validPage(session.roomId, page)) {
                            records.push({ key, page });
                        }
                    }
                }
            }
            records.sort((left, right) => left.page.observedAt - right.page.observedAt);
            for (const { key, page } of records) {
                if (session.keeper.observe(page)) {
                    storage.remove(key);
                }
            }
            const owns = () => ScribeBoot.currentRoom(session) && ScribeBoot.chosen(session) && session.keeper.view().reader;
            edits.sort((left, right) => left.page.observedAt - right.page.observedAt);
            for (const { key, page } of edits) {
                if (!session.live || !owns()) {
                    break;
                }
                try {
                    session.live.writeReminderDraft(page.text);
                } catch {
                    if (owns()) {
                        storage.set(key, JSON.stringify({ error: ScribeBoot.Settings.Messages.ReminderNotSaved }));
                    }
                    continue;
                }
                storage.remove(key);
            }
            ScribeBoot.serveGeneration(session);
        } catch {
            ScribeBoot.say(boot, 'Scribe could not transfer an observed chat change between tabs.');
        } finally {
            intake.relaying = false;
        }
    },

    /**
     * @param {object} boot
     * @param {string} room
     * @param {string|null} message
     * @return {Function|null}
     */
    observe(boot, room, message) {
        const session = boot.session;
        if (!session?.live || room !== session.roomId || !ScribeBoot.currentRoom(session) ||
            (message !== null && !ScribeBoot.name(message))) {
            return null;
        }
        const channel = message === null ? 'sendNotice' : 'streamNotice';
        const finish = (outcome) => {
            if (session[channel] !== finish || !ScribeBoot.currentRoom(session)) {
                return;
            }
            session[channel] = null;
            if (message !== null) {
                session.live.streamResult(message, outcome);
            } else if (outcome === 'forbidden') {
                session.live.sendForbidden();
            } else if (outcome === 'ok') {
                session.live.sendAllowed();
            }
        };
        session[channel] = finish;
        return finish;
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
            if (report.kind === bridge.Kind.Messages) {
                const session = boot.session;
                if (session && entry.last?.session === session && report.room === session.roomId &&
                    entry.scope !== null && report.seq >= entry.scope && report.seq <= entry.last.seq &&
                    report.token === entry.last.observationToken && ScribeBoot.usable(report.token)) {
                    ScribeBoot.nativeMessages(boot, report.room)?.(report.page);
                }
                return;
            }
            if (report.kind === bridge.Kind.Activity) {
                const session = boot.session;
                if (!session || !ScribeBoot.currentRoom(session) || report.room !== session.roomId || entry.last?.session !== session ||
                    entry.scope === null || report.seq < entry.scope || report.seq > entry.last.seq) {
                    return;
                }
                const channel = report.message === null ? 'sendNotice' : 'streamNotice';
                const prior = entry[channel];
                if (report.outcome === 'start') {
                    if (!prior || report.seq > prior.seq || (report.seq === prior.seq && report.index > prior.index)) {
                        entry[channel] = { ...report, finish: ScribeBoot.observe(boot, report.room, report.message) };
                    }
                } else if (prior?.seq === report.seq && prior.index === report.index && prior.message === report.message) {
                    prior.finish?.(report.outcome);
                }
                return;
            }
            const pending = entry.pending;
            const finishing = pending !== null && pending.arm.session === boot.session &&
                pending.arm.seq === report.seq && pending.index === report.index;
            const issued = entry.scope !== null && report.seq >= entry.scope && report.seq <= entry.last?.seq;
            const key = Number.isSafeInteger(report.index) && issued ?
                `frame:${boot.environment.tabId}:${entry.scope}:${report.seq}:${report.index}` : null;
            const terminal = [bridge.Kind.Sent, bridge.Kind.Rejected, bridge.Kind.Cancelled].includes(report.kind);
            const outstanding = !finishing && terminal && key !== null ? boot.session?.live?.outstanding(key) ?? null : null;
            if (outstanding && !(report.previous && outstanding.previous) && (report.ready !== (outstanding.ready !== null) || report.suggestion !== (outstanding.suggestion !== null) ||
                report.reminder !== outstanding.reminder || report.attempt !== outstanding.attempt)) {
                return;
            }
            if (report.kind !== bridge.Kind.Ready && !finishing && !outstanding) {
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
                    const current = entry.last;
                    const session = boot.session;
                    const reserved = session?.reservedDelivery;
                    if (report.kind !== bridge.Kind.Starting || !report.ready || !report.reminder || !report.submission ||
                        !session || session.closed || current?.session !== session ||
                        current.reminder !== report.reminder || current.attempt !== report.attempt ||
                        (reserved?.reminder === report.reminder && reserved.attempt === report.attempt)) {
                        return;
                    }
                    const arm = entry.kept.find((item) => item.seq === report.seq);
                    if (!arm || arm.session !== session || arm.reminder !== report.reminder ||
                        arm.attempt !== report.attempt || arm.reports.has(report.index) ||
                        (report.cut !== null && !arm.ends.includes(report.cut))) {
                        return;
                    }
                    session.reservedDelivery = {
                        reminder: report.reminder,
                        attempt: report.attempt,
                        seq: report.seq,
                        index: report.index,
                        retryAt: now + settings.SentWindowMs / settings.SentLimit,
                    };
                    ScribeBoot.later(session, entry.sends[settings.FirstEntry] + settings.SentWindowMs + 1 - now,
                        () => ScribeBoot.arm(boot, []), null);
                } else {
                    entry.sends.push(now);
                }
            }
            if (report.kind !== bridge.Kind.Ready) {
                if (report.kind === bridge.Kind.Starting && issued) {
                    boot.session.sendNotice = null;
                }
                ScribeBoot.reported(boot, entry, report, key, outstanding);
            }
            if (report.kind !== bridge.Kind.Starting) {
                ScribeBoot.arm(boot, [source]);
            } else if (boot.session?.reservedDelivery?.seq === report.seq) {
                ScribeBoot.arm(boot, []);
            }
        } catch (error) {
            ScribeBoot.say(boot, `${ScribeBoot.Settings.Messages.NotHeard}${ScribeBoot.words(error)}`);
        }
    },

    /**
     * @param {object} session
     * @return {void}
     */
    tick(session) {
        const keeper = session.keeper;
        ScribeBoot.relay(session.boot, session.boot.intake);
        if (session.reminderRefreshFailed) {
            ScribeBoot.redrawReminder(session);
        }
        for (const inspect of session.reminderWaits.values()) {
            inspect();
        }
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
        const keyRecoveryProblem = session.keyRecoveryProblem;
        if (session.keyPending) {
            ScribeBoot.recoverKey(session);
        }
        if (session.live?.refreshWatcher?.() || keyRecoveryProblem !== session.keyRecoveryProblem) {
            ScribeBoot.redraw(session);
        }
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
            try {
                session.keeper?.releaseReader();
            } finally {
                release();
            }
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
     * @param {object & {forkController: AbortController|null, stopForkOrigin?: (() => void)|null}} session
     * @return {void}
     */
    close(session) {
        const settings = ScribeBoot.Settings;
        const boot = session.boot;
        const timers = boot.environment.timers;
        session.closed = true;
        session.ticking = false;
        session.historyRequest?.abort();
        session.forkController?.abort();
        session.stopForkOrigin?.();
        session.stopRelay?.();
        session.stopLiveHead?.();
        for (const stop of session.roomReminderWatches) {
            stop();
        }
        for (const stop of session.reminderSignals.values()) {
            stop();
        }
        for (const leave of session.reminderWaits.keys()) {
            leave();
        }
        session.stopClaim?.();
        if (session.interval !== null) {
            timers.clearInterval(session.interval);
            session.interval = null;
        }
        const endings = [...session.timers.values()];
        for (const timer of session.timers.keys()) {
            timers.clearTimeout(timer);
        }
        session.timers.clear();
        for (const trial of session.running) {
            trial.halt(settings.Messages.Left);
        }
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
            entry.scope = null;
            entry.pending = null;
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
     * @return {{parentRoomId: string, childRoomId: string, messageId: string}|null}
     */
    forkOrigin(session) {
        const key = ScribeStore.name('fork', ScribeStore.room(session.roomId));
        /** @type {{parentRoomId: string, childRoomId: string, messageId: string}|null} */
        const origin = ScribeStore.decode(ScribeStore.fetch(session.boot.environment.storage, key));
        return origin?.childRoomId === session.roomId && typeof origin.parentRoomId === 'string' &&
            origin.parentRoomId !== session.roomId && typeof origin.messageId === 'string' ? origin : null;
    },

    /**
     * @param {object} session
     * @param {Function} fetch
     * @param {Function} action
     * @return {Promise<object>}
     * @throws {Error}
     */
    async forkAction(session, fetch, action) {
        const messages = ScribeBoot.Settings.Messages;
        if (!ScribeBoot.currentRoom(session)) {
            throw new Error(messages.Left);
        }
        const view = session.keeper.view();
        if (view.stop?.reason === ScribeAdoption.Stop.Paused) {
            throw new Error(messages.Paused);
        }
        if (!view.reader || !ScribeBoot.chosen(session)) {
            throw new Error(messages.NotReader);
        }
        if (session.forkController || view.busy) {
            throw new Error('Another room action is in progress.');
        }
        const controller = new session.boot.environment.pageWindow.AbortController();
        session.forkController = controller;
        ScribeBoot.redraw(session);
        try {
            const result = await action({
                roomId: session.roomId, fetch, token: ScribeBoot.token(session.boot), signal: controller.signal,
                pause: (ms) => ScribeBoot.pause(session, ms, controller.signal),
            });
            controller.signal.throwIfAborted();
            return result;
        } finally {
            session.forkController = null;
            if (ScribeBoot.currentRoom(session)) {
                ScribeBoot.redraw(session);
            }
        }
    },

    /**
     * @param {object} session
     * @param {string} sourceRoomId
     * @param {{fetch: Function, token: string|null, signal: AbortSignal, roomId: string, pause: (ms: number) => Promise<void>}} request
     * @return {Promise<object>}
     * @throws {Error}
     */
    async forkSource(session, sourceRoomId, request) {
        const storage = session.boot.environment.storage;
        const kinds = ScribeStore.Kind;
        let book = ScribeStore.read(storage, sourceRoomId, kinds.Book);
        if (!book?.adopted) {
            book = await session.cloud.forkBook(sourceRoomId, request.signal);
        }
        request.signal.throwIfAborted();
        if (!book?.adopted) {
            throw new Error('No adopted Book was found for this saved chat.');
        }
        const campaign = ScribeStore.read(storage, sourceRoomId, kinds.Campaign);
        let messages = campaign?.messages;
        if (!campaign?.completeHistory || campaign.needsHistory || !Array.isArray(messages) || !messages.length) {
            /** @type {{messages: object[], completeHistory?: boolean, problem: string|null}} */
            const history = await ZetaSource.history({ ...request, roomId: sourceRoomId });
            if (history.completeHistory !== true) {
                throw new Error(history.problem ?? 'The source chat history is incomplete.');
            }
            messages = history.messages;
        }
        return { book, messages };
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
            const fetch = (url, init) => {
                if (environment.clone === null) {
                    return boot.pageFetch.call(environment.pageWindow, url, init);
                }
                const { signal, ...fields } = init;
                const pageInit = environment.clone(fields);
                if (signal) {
                    pageInit.signal = signal;
                }
                return boot.pageFetch.call(environment.pageWindow, url, pageInit);
            };

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
                        () => keeper.tick(false),
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
                     * @throws {Error}
                     */
                    history: async (onPage) => {
                        if (!ScribeBoot.currentRoom(session)) {
                            throw new Error(messages.Left);
                        }
                        if (session.keeper?.view().stop?.reason === ScribeAdoption.Stop.Paused) {
                            throw new Error(messages.Paused);
                        }
                        const controller = new environment.pageWindow.AbortController();
                        session.historyRequest = controller;
                        ScribeBoot.redraw(session);
                        try {
                            return await ZetaSource.history({
                                fetch, token: ScribeBoot.token(boot), roomId: session.roomId, onPage,
                                signal: controller.signal, pause: (ms) => ScribeBoot.pause(session, ms, controller.signal),
                            });
                        } finally {
                            if (session.historyRequest === controller) {
                                session.historyRequest = null;
                                ScribeBoot.redraw(session);
                            }
                        }
                    },

                    /**
                     * @return {void}
                     */
                    abort: () => {
                        session.historyRequest?.abort();
                        session.forkController?.abort();
                    },
                }),

                /**
                 * @param {string} role
                 * @param {string} system
                 * @param {string} user
                 * @return {Promise<{ text: string, cost: number }>}
                 */
                ask: (role, system, user) => ScribeBoot.ask(session, role, system, user),
                askChecker: (system, user, beforeDispatch) => ScribeBoot.ask(session, ScribeBoot.Role.Pedant, system, user, beforeDispatch),
                pauseCalls: (reason = messages.Paused) => {
                    session.pauseEpoch++;
                    /** @type {{pause?: () => void}|null} */
                    const live = session.live;
                    live?.pause?.();
                    for (const trial of session.running) {
                        trial.halt(reason);
                    }
                },
                checkPassage: (request) => ScribePedant.checkPassage(request),
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
                    if (session.keeper && !boot.intake?.reader && session.keeper.view().reader && ScribeBoot.currentRoom(session)) {
                        ScribeBoot.relay(boot, boot.intake);
                    }
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
            if (!session.locking) {
                const name = ScribeStore.name(ScribeStore.Settings.Types.Claim, ScribeStore.room(session.roomId));
                const checkOwner = () => {
                    if (!session.closed) {
                        ScribeBoot.attempt(boot, messages.NotChecked, () => {
                            const owner = ScribeStore.claimOf(ScribeStore.fetch(environment.storage, name));
                            if (owner && owner.tabId !== environment.tabId) {
                                keeper.releaseReader();
                            }
                        });
                    }
                };
                session.stopClaim = environment.storage.watch(name, checkOwner);
                checkOwner();
            }
            /** @type {{readReminderDraft: () => string|null, writeReminderDraft: (text: string) => void, [method: string]: Function}} */
            const live = ScribeLive.open({
                keeper,
                storage: environment.storage,
                roomId: session.roomId,

                /**
                 * @param {string} role
                 * @param {string} system
                 * @param {string} user
                 * @param {boolean} singleAttempt
                 * @return {Promise<{ text: string, cost: number }>}
                 */
                ask: (role, system, user, singleAttempt = false) => ScribeBoot.counted(session, role, system, user, singleAttempt),
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
            if (ScribeBoot.currentRoom(session) && boot.intake?.room === session.roomId) {
                const intake = boot.intake;
                session.stopRelay = environment.storage.watch(intake.signal, () => {
                    const key = environment.storage.get(intake.signal, null);
                    if (ScribeBoot.currentRoom(session) && keeper.view().reader && typeof key === 'string' &&
                        key.startsWith(intake.signal + ':edit:') && environment.storage.get(key, null) === 'null' &&
                        !session.reminderSignals.has(key)) {
                        const stop = environment.storage.watch(key, () => {
                            stop();
                            session.reminderSignals.delete(key);
                            ScribeBoot.relay(boot, intake);
                        });
                        session.reminderSignals.set(key, stop);
                    }
                    ScribeBoot.relay(boot, intake);
                });
                for (const part of ['draft', 'draft-sent', 'preview', 'generating', 'result']) {
                    const key = ScribeStore.name('reminder', ScribeStore.room(session.roomId), part);
                    const stop = environment.storage.watch(key, () => {
                        if (!ScribeBoot.currentRoom(session)) {
                            return;
                        }
                        if (part === 'generating') {
                            ScribeBoot.serveGeneration(session);
                            session.inspectGeneration?.();
                        }
                        ScribeBoot.redrawReminder(session);
                    });
                    session.roomReminderWatches.push(stop);
                }
                const liveHead = ScribeStore.name(ScribeStore.Settings.Types.Head, ScribeStore.room(session.roomId), ScribeStore.Kind.Live);
                session.stopLiveHead = environment.storage.watch(liveHead, () => {
                    if (ScribeBoot.currentRoom(session) && !keeper.view().reader) {
                        session.panel?.redraw();
                    }
                });
                ScribeBoot.relay(boot, intake);
            }
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
            const refreshOrigin = () => {
                if (ScribeBoot.currentRoom(session)) {
                    session.forkOrigin = ScribeBoot.forkOrigin(session);
                    ScribeBoot.redraw(session);
                }
            };
            session.stopForkOrigin = environment.storage.watch(ScribeStore.name('fork', ScribeStore.room(session.roomId)), refreshOrigin);
            session.forkOrigin = ScribeBoot.forkOrigin(session);
            session.panel = ScribePanel.mount({
                document: environment.document,
                keyVersion: () => boot.keyVersion,
                keyProblem: () => boot.keyProblem,
                keyRecoveryProblem: () => session.keyRecoveryProblem,
                saveKey: (typed, version) => ScribeBoot.saveKey(session, typed, version),
                forkOrigin: () => session.forkOrigin,
                listForkRooms: () => ScribeBoot.forkAction(session, fetch, (request) => ZetaSource.savedRooms(request)),
                recoverFork: (sourceRoomId, messageId) => ScribeBoot.forkAction(session, fetch, (request) =>
                    keeper.recoverFork(sourceRoomId, messageId, () => ScribeBoot.forkSource(session, sourceRoomId, request))),
                readReminderDraft: () => live.readReminderDraft(),
                writeReminderDraft: (text) => {
                    try {
                        live.writeReminderDraft(text);
                    } catch (error) {
                        throw Object.assign(new Error(messages.ReminderNotSaved), { cause: error });
                    }
                },
                readReminderPreview: () => ScribeBoot.reminderValue(session, 'preview')?.preview ?? null,
                clearReminderPreview: (preview) => {
                    if (ScribeBoot.reminderValue(session, 'preview')?.preview === preview) {
                        environment.storage.remove(ScribeLive.reminderKey(session.roomId, 'preview'));
                    }
                },
                reminderGeneration: () => {
                    const marker = ScribeBoot.reminderValue(session, 'generating');
                    return marker ? (marker.tab === environment.tabId ? 'here' : 'other') : null;
                },
                reminderGenerationError: () => ScribeBoot.reminderValue(session, 'result')?.error ?? null,
                generateReminder: () => ScribeBoot.generateReminder(session),
                keeper,
                live,
                cloud: session.cloud,
                calls: Object.freeze({
                    /**
                     * @return {boolean}
                     */
                    due: () => Boolean(session.historyRequest && !session.historyRequest.signal.aborted) ||
                        Boolean(session.forkController && !session.forkController.signal.aborted) ||
                        [...session.running].some((trial) => !trial.cancelled),

                    /**
                     * @return {void}
                     */
                    stop: () => {
                        keeper.pause();
                    },
                }),
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
                receipt: () => {
                    const lines = live.posting();
                    return {
                        room: (roomId) => roomId === session.roomId,
                        manual: lines.manual === true,
                        confirmed: () => live.went(lines),
                        rejected: (status) => live.rejected(lines, status),
                        uncertain: () => live.uncertain(lines),
                        cancelled: () => live.cancelled(lines),
                    };
                },

                /**
                 * @param {...*} values
                 * @return {*}
                 */
                sent: (...values) => live.sent(...values),
                /**
                 * @return {void}
                 */
                cancelled: () => live.cancelled(),
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
            ScribeBoot.recoverKey(session);
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
        if (boot.suspended || boot.stopped) {
            return;
        }
        try {
            ScribeBoot.token(boot);
            const roomId = ZetaSource.room(environment.pageWindow.location.pathname);
            if (boot.intake?.room !== roomId) {
                boot.intake = roomId === null ? null : { room: roomId, pages: [], reader: false, relaying: false,
                    signal: ScribeStore.name('observations', ScribeStore.room(roomId)) };
            }
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
            if (roomId !== null && environment.document.body !== null) {
                const session = {
                    boot,
                    roomId,
                    closed: false,
                    keyPending: null,
                    recoveringKey: false,
                    keyRecoveryProblem: false,
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
                    reservedDelivery: null,
                    panel: null,
                    running: new Set(),
                    reminderWaits: new Map(),
                    reminderSignals: new Map(),
                    roomReminderWatches: [],
                    generationWork: null,
                    /** @type {(() => void)|null} */
                    inspectGeneration: null,
                    historyRequest: null,
                    forkController: null,
                    forkOrigin: null,
                    stopForkOrigin: null,
                    pauseEpoch: 0,
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
            keySubscription: null,
            keyValue: null,
            keyVersion: 0,
            keyProblem: false,
            stopped: false,
            suspended: false,
            request: null,
            session: null,
            intake: null,
            relaySequence: 0,
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
            if (!ScribeBoot.hidden(boot)) {
                ScribeBoot.refreshKey(boot);
            }
            if (boot.session !== null && ScribeBoot.currentRoom(boot.session)) {
                ScribeBoot.contest(boot.session);
            }
        };
        environment.document.addEventListener(settings.VisibilityEvent, visibility);
        const follow = () => ScribeBoot.follow(boot);
        const pageHidden = () => {
            boot.suspended = true;
            if (boot.session) {
                const session = boot.session;
                boot.session = null;
                ScribeBoot.close(session);
            }
        };
        const pageShown = () => {
            boot.suspended = false;
            follow();
            visibility();
        };
        const navigation = environment.pageWindow.navigation;
        const routeTarget = navigation ?? environment.pageWindow;
        const routeEvent = navigation ? 'currententrychange' : 'popstate';
        routeTarget.addEventListener(routeEvent, follow);
        environment.pageWindow.addEventListener('pagehide', pageHidden);
        environment.pageWindow.addEventListener('pageshow', pageShown);
        boot.visibility = visibility;
        ScribeBoot.keyed(boot);
        boot.keySubscription = environment.storage.watch(ScribeStore.name(ScribeStore.Settings.Key), () => ScribeBoot.refreshKey(boot));
        ScribeBoot.refreshKey(boot);
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
                        ScribeStore.browserId(environment.storage, environment.random);
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
            boot.watcher.onFork?.((origin) => ScribeBoot.attempt(boot, 'The fork origin could not be saved. ', () => {
                const key = ScribeStore.name('fork', ScribeStore.room(origin.childRoomId));
                const value = JSON.stringify(origin);
                environment.storage.set(key, value);
                if (ScribeStore.fetch(environment.storage, key) !== value) {
                    throw new Error('Storage did not retain the origin.');
                }
                if (boot.session?.roomId === origin.childRoomId) {
                    boot.session.forkOrigin = origin;
                    ScribeBoot.redraw(boot.session);
                }
            }));
            boot.watcher.onMessages((room) => ScribeBoot.nativeMessages(boot, room));
            boot.watcher.onStream?.((room, message) => ScribeBoot.observe(boot, room, message));
            boot.watcher.onPost((room) => {
                const finish = ScribeBoot.observe(boot, room, null);
                const receipt = boot.session?.sender?.posting(room);
                return ScribeSender.observePost(receipt, finish);
            });
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
                boot.stopped = true;
                boot.keySubscription();
                boot.keyValue = null;
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
                    routeTarget.removeEventListener(routeEvent, follow);
                    environment.pageWindow.removeEventListener('pagehide', pageHidden);
                    environment.pageWindow.removeEventListener('pageshow', pageShown);
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
