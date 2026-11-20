const ScribeKeeper = Object.freeze({
    Phase: Object.freeze({
        Loading: 'Loading',
        NoBook: 'NoBook',
        Reading: 'Reading',
        Idle: 'Idle',
        Stopped: 'Stopped',
        Watching: 'Watching',
    }),

    Event: Object.freeze({
        Changed: 'Changed',
        Progress: 'Progress',
        Reply: 'Reply',
    }),

    Busy: Object.freeze({
        Looking: 'Looking',
        Pulling: 'Pulling',
        Reading: 'Reading',
        Checking: 'Checking',
    }),

    Defaults: Object.freeze({
        analyzer: 'mistralai/mistral-large-4-0',
        scribe: 'mistralai/mistral-small-3.2-24b-instruct',
        pedant: 'mistralai/mistral-large-4-0',
        size: 40,
        budget: 3,
        refresh: 6,
    }),

    Settings: Object.freeze({
        Role: 'Analyzer',
        LastCalls: 20,
        LastLines: 50,
        KeptAnswers: 8,
        RepullMs: 60000,
        ExpensiveCheckMs: 600000,
        FirstEpoch: 0,
        NoCount: 0,
        NoSpending: 0,
        NoEdition: 0,
        LeastCount: 1,
        One: 1,
        Last: -1,
        NotFound: -1,
        Models: Object.freeze(['analyzer', 'scribe', 'pedant']),
        Counts: Object.freeze(['size', 'refresh']),
        Amount: 'budget',
        Counters: Object.freeze(['version', 'nextFact', 'nextSubject', 'nextThread', 'nextQuestion', 'nextSequence', 'revision']),
        Lasting: Object.freeze(['Paused', 'Failed']),
        WholeEnds: Object.freeze(['NoCursor', 'EmptyPage']),
        Ends: Object.freeze({
            Failed: 'Failed',
            Limit: 'Limit',
        }),
        KeyJoint: '\n',
        SentenceJoint: ' ',
        Nothing: '',
        ObjectType: 'object',
        StringType: 'string',
        BooleanType: 'boolean',
        FunctionType: 'function',
        UndefinedType: 'undefined',
        Messages: Object.freeze({
            Watching: 'Another tab is reading this chat',
            Reading: 'The book is being read; try again when it has finished this stretch',
            Pulling: 'The chat is being pulled; try again when it has finished',
            Closed: 'This chat has been closed',
            NoBook: 'No book has been started for this chat',
            Disorder: 'The messages of this chat are not in time order',
            Unreadable: 'The messages of this chat could not be read',
            Unsettled: 'The chat could not be compared with the book',
            Attribution: 'Authorship is unresolved for player message #',
            NoSettings: 'The settings are missing',
            BadSetting: 'The settings are not valid: ',
            ThrownAway: 'The reading was thrown away',
            PartOpen: 'The chat was pulled only in part: ',
            PartClose: '; it will be pulled again.',
            PullFailed: 'the pull failed',
            TooLong: 'the chat has more pages than one pull may read',
            StoppedEarly: 'it stopped early',
            FarOpen: 'The chat could not be pulled far enough to join what is saved: ',
            FarClose: '. It is pulled again every minute; the book is kept as it is.',
            SkippedOne: ' message could not be read from the site.',
            SkippedMany: ' messages could not be read from the site.',
            NothingPulled: 'Nothing has been pulled from the chat yet',
            Unjoined: 'The newest messages do not join what is saved yet; the chat is being pulled again.',
            Suspect: 'The chat on the site does not match what is saved. It will be checked again in a minute.',
            Mismatch:
                'The chat on the site no longer matches what is saved (checked twice). Starting the book over discards the book and your rulings.',
            Unconfirmed: 'The save could not be confirmed; the book was loaded again',
            BadAnchor: 'The argument is not valid: anchor',
            BadOperations: 'The argument is not valid: operations',
            BadClaim: 'The argument is not valid: claim',
            CheckSchedule: 'Scribe could not read or save the history-check schedule on this device. Check that Tampermonkey storage is available.',
            BadProfile: 'The argument is not valid: profile',
        }),
        Flight: Object.freeze({
            PullOpen: 'Reading chat history from Zeta · ',
            PullOne: ' message',
            PullClose: ' messages',
            Looking: 'Looking for new messages',
            ReadOpen: 'Reading #',
            ReadMiddle: ' to #',
            Answers: 'Filing the answered questions',
            Finishing: 'Finishing the reading',
            Ruling: 'Saving a ruling',
            Filing: 'Saving what the player told the scribe',
        }),
    }),

    /**
     * @param {*} value
     * @return {boolean}
     */
    isObject(value) {
        return typeof value === ScribeKeeper.Settings.ObjectType && value !== null && !Array.isArray(value);
    },

    /**
     * @param {*} error
     * @return {string}
     */
    words(error) {
        const settings = ScribeKeeper.Settings;
        const described = error !== null && typeof error === settings.ObjectType && typeof error.message === settings.StringType;
        return described ? error.message : String(error);
    },

    /**
     * @param {*} value
     * @return {*}
     */
    copy(value) {
        return JSON.parse(JSON.stringify(value));
    },

    /**
     * @return {string}
     */
    damagedBook() {
        return ScribeStore.damaged(ScribeStore.Kind.Book).message;
    },

    /**
     * @param {Readonly<object>} base
     * @param {*} given
     * @return {Readonly<{ analyzer: string, scribe: string, pedant: string, size: number, budget: number, refresh: number }>}
     * @throws {Error}
     */
    settle(base, given) {
        const settings = ScribeKeeper.Settings;
        const messages = settings.Messages;
        if (!ScribeKeeper.isObject(given)) {
            throw new Error(messages.NoSettings);
        }
        const merged = {};
        for (const name of Object.keys(ScribeKeeper.Defaults)) {
            merged[name] = Object.hasOwn(given, name) ? given[name] : base[name];
        }
        for (const name of settings.Models) {
            if (typeof merged[name] !== settings.StringType || merged[name].trim() === settings.Nothing) {
                throw new Error(messages.BadSetting + name);
            }
        }
        for (const name of settings.Counts) {
            if (!Number.isSafeInteger(merged[name]) || merged[name] < settings.LeastCount) {
                throw new Error(messages.BadSetting + name);
            }
        }
        if (!Number.isFinite(merged[settings.Amount]) || merged[settings.Amount] < settings.NoSpending) {
            throw new Error(messages.BadSetting + settings.Amount);
        }
        return Object.freeze(merged);
    },

    /**
     * @param {*} value
     * @return {Readonly<{ reason: string, problem: string|null }>|null}
     */
    stopOf(value) {
        const settings = ScribeKeeper.Settings;
        if (!ScribeKeeper.isObject(value) || !settings.Lasting.includes(value.reason)) {
            return null;
        }
        if (value.problem !== null && typeof value.problem !== settings.StringType) {
            return null;
        }
        const source = value.source === 'OpenRouter' || ScribeStore.localSource(value.source) ? { source: value.source } : {};
        return Object.freeze({ reason: value.reason, problem: value.problem, ...source });
    },

    /**
     * @param {object[]} messages
     * @return {object[]}
     */
    strings(messages) {
        return messages.map(
            /**
             * @param {{ id: * }} message
             * @return {object}
             */
            (message) => (typeof message.id === ScribeKeeper.Settings.StringType ? message : { ...message, id: String(message.id) }),
        );
    },

    /**
     * @param {object[]} messages
     * @return {object[]}
     */
    single(messages) {
        const seen = new Set();
        const kept = [];
        for (const message of ScribeKeeper.strings(messages)) {
            if (!seen.has(message.id)) {
                seen.add(message.id);
                kept.push(message);
            }
        }
        return kept;
    },

    /**
     * @param {object[]} rawMessages
     * @param {object} keeper
     * @return {{ intake: Readonly<{ messages: readonly object[], notes: readonly object[], player: string }>|null, disorder: string|null }}
     */
    take(rawMessages, keeper) {
        const messages = ScribeKeeper.Settings.Messages;
        try {
            const evidence = ScribeKeeper.readKind(keeper, ScribeStore.Kind.Live);
            return { intake: ScribeIntake.read(rawMessages, evidence.value), disorder: null };
        } catch (error) {
            const unordered = ScribeKeeper.words(error) === ScribeIntake.Settings.UnorderedMessage;
            return { intake: null, disorder: unordered ? messages.Disorder : messages.Unreadable };
        }
    },

    /**
     * @param {Readonly<{ messages: readonly object[] }>} intake
     * @return {string|null}
     */
    newestKey(intake) {
        const message = intake.messages.at(ScribeKeeper.Settings.Last);
        return message === undefined ? null : message.id + ScribeKeeper.Settings.KeyJoint + message.fingerprint;
    },

    /**
     * @param {object} keeper
     * @return {boolean}
     */
    answered(keeper) {
        return keeper.state.questions.some(
            /**
             * @param {{ answer: string|null, dismissed: boolean }} question
             * @return {boolean}
             */
            (question) => ScribeAdoption.canAnswer(question, keeper.intake.messages),
        );
    },

    /**
     * @param {object} keeper
     * @param {{ kind: string, message?: object }} event
     * @return {void}
     */
    tell(keeper, event) {
        if (keeper.closed) {
            return;
        }
        ScribeKeeper.settleTargets(keeper);
        try {
            keeper.notify(Object.freeze(event));
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
        }
    },

    /**
     * @param {object} keeper
     * @return {void}
     * @throws {Error}
     */
    show(keeper) {
        const messages = keeper.intake === null ? [] : keeper.intake.messages;
        const log = keeper.book === null ? ScribeLog.create() : keeper.book.log;
        const unread = [];
        let lastRead = null;
        for (const message of messages) {
            if (Object.hasOwn(log.read, message.id) && keeper.book.fingerprints[message.id] === message.fingerprint &&
                !message.attributionPending && (keeper.book.projections?.[message.id] ?? null) === (message.projection ?? null)) {
                lastRead = Object.freeze({ id: message.id, position: message.position });
            } else {
                unread.push(message);
            }
        }
        keeper.state = ScribeKeeper.replay(keeper, log);
        keeper.read = messages.length - unread.length;
        keeper.unread = Object.freeze(unread);
        keeper.lastRead = lastRead;
        const coverage = keeper.book === null ? { writtenThrough: 0, verificationPending: [], legacyClaims: [] }
            : ScribeLog.coverage(keeper.book, messages);
        keeper.checkProgress = keeper.checkPassage && keeper.book
            ? ScribeLog.checkProgress(keeper.book, messages)
            : null;
        keeper.writtenThrough = coverage.writtenThrough;
        keeper.verificationPending = Object.freeze(coverage.verificationPending);
        keeper.legacyClaims = Object.freeze(coverage.legacyClaims);
        keeper.made = Object.freeze([]);
        if (typeof BenchView !== ScribeKeeper.Settings.UndefinedType) {
            const filed = log.entries.filter((entry) => entry.origin === ScribeLog.Origin.Notes && !entry.withdrawn)
                .flatMap((entry) => {
                    const linked = entry.operations.filter((operation) => operation.resolutions?.length && !operation.revoked);
                    if (!linked.length) {
                        return [];
                    }
                    return [{ sequence: entry.sequence, type: ScribeLog.Origin.Notes,
                        summary: linked.map((operation) => operation.resolutions[0].fact + ' — ' +
                            (operation.text ?? operation.reason ?? operation.resolutions[0].said)).join(', ') }];
                });
            keeper.made = Object.freeze(
                [...BenchView.made(log), ...filed].sort((first, second) => second.sequence - first.sequence).map(
                    /**
                     * @param {{ sequence: number, type: string, summary: string }} row
                     * @return {Readonly<{ sequence: number, type: string, summary: string }>}
                     */
                    (row) => Object.freeze(row),
                ),
            );
        }
    },

    /**
     * @param {object} keeper
     * @return {string|null}
     */
    blocked(keeper) {
        const messages = ScribeKeeper.Settings.Messages;
        const busy = ScribeKeeper.Busy;
        if (keeper.closed) {
            return messages.Closed;
        }
        if (!keeper.reader) {
            return messages.Watching;
        }
        if (keeper.unloaded !== null) {
            return keeper.unloaded;
        }
        if (keeper.busy === busy.Reading) {
            return messages.Reading;
        }
        if (keeper.busy === busy.Pulling) {
            return messages.Pulling;
        }
        const replacing = keeper.mismatch !== null && !keeper.partial;
        if (!replacing) {
            const hold = ScribeKeeper.held(keeper);
            if (hold !== null) {
                return hold;
            }
            if (!keeper.compared) {
                return ScribeKeeper.issue(keeper) ?? messages.Unsettled;
            }
        }
        if (keeper.owed.size > ScribeKeeper.Settings.NoCount) {
            return keeper.owing;
        }
        try {
            return ScribeKeeper.still(keeper) ? null : messages.Watching;
        } catch (error) {
            return ScribeKeeper.words(error);
        }
    },

    /**
     * @param {object} keeper
     * @return {string|null}
     */
    issue(keeper) {
        return keeper.problem?.reason ?? keeper.problem;
    },

    /**
     * @param {object} keeper
     * @return {Readonly<object>}
     */
    view(keeper) {
        const messages = keeper.intake === null ? Object.freeze([]) : keeper.intake.messages;
        ScribeKeeper.recount(keeper);
        const local = keeper.unloaded ?? ScribeKeeper.issue(keeper);
        const pending = messages.find((message) => message.attributionPending);
        const problem = local ??
            (keeper.blank ? null : ScribeKeeper.held(keeper)) ??
            (keeper.owed.size === ScribeKeeper.Settings.NoCount ? null : keeper.owing) ??
            keeper.damaged ??
            keeper.cut ?? (pending ? ScribeKeeper.Settings.Messages.Attribution + pending.position : null);
        const history = local === null && problem !== null && problem === keeper.cut;
        const nextCheck = keeper.checkProgress && messages[keeper.checkProgress.checkedThrough];
        const waiting = keeper.reader && !keeper.closed && keeper.phase === ScribeKeeper.Phase.Idle &&
            keeper.book?.adopted && keeper.compared && keeper.historyChecked && !keeper.pausing &&
            keeper.unloaded === null && !keeper.owed.size && ScribeKeeper.held(keeper) === null &&
            keeper.writtenThrough > keeper.checkProgress?.checkedThrough && nextCheck &&
            (keeper.checkPage || keeper.spentToday < keeper.settings.budget) &&
            keeper.expensiveAfter > keeper.clock.now() &&
            (keeper.deferredCheck?.id === nextCheck.id && !keeper.zeta.onHead?.(keeper.deferredCheck.sources) ||
                keeper.zeta.distant?.(nextCheck.id));
        return Object.freeze({
            phase: keeper.phase,
            roomId: keeper.roomId,
            reader: keeper.reader,
            busy: keeper.busy,
            booked: keeper.book !== null || keeper.damaged !== null,
            total: messages.length,
            settled: messages.length,
            read: keeper.read,
            unread: keeper.unread,
            lastRead: keeper.lastRead,
            writtenThrough: keeper.writtenThrough,
            checksEnabled: keeper.checkPassage !== null,
            checkedThrough: keeper.checkProgress?.checkedThrough ?? 0,
            checkerFindings: keeper.checkProgress?.findings ?? [],
            checkerProblem: keeper.checkProblem,
            expensiveCheckAt: waiting ? keeper.expensiveAfter : null,
            verificationPending: keeper.verificationPending,
            legacyClaims: keeper.legacyClaims,
            made: keeper.made,
            state: keeper.state,
            messages,
            own: keeper.intake === null ? Object.freeze([]) : keeper.intake.own,
            player: keeper.intake === null ? ScribeIntake.Settings.UnknownPlayer : keeper.intake.player,
            settings: keeper.settings,
            spentToday: keeper.spentToday,
            flight: keeper.flight,
            began: keeper.flight === null ? null : keeper.began,
            stop: keeper.stop,
            restoredStop: keeper.restoredStop === keeper.stop && keeper.stop !== null,
            pulled: keeper.lastPull,
            historyChecked: keeper.historyChecked,
            readerCurrent: keeper.compared && keeper.historyChecked && !keeper.pollPending && !keeper.checkStretch &&
                messages.length > 0 && keeper.read === messages.length,
            adoptBlock: ScribeKeeper.blocked(keeper),
            mismatch: keeper.mismatch !== null,
            trusted: keeper.reader && keeper.unloaded === null && keeper.book !== null && keeper.book.adopted && ScribeKeeper.held(keeper) === null,
            edition: keeper.edition,
            calls: Object.freeze([...keeper.calls]),
            lines: Object.freeze([...keeper.lines]),
            problemSource: history ? 'Zeta' : (keeper.unloaded === null ? keeper.problem?.source ?? null : null),
            problem,
        });
    },

    /**
     * @param {object} keeper
     * @return {string}
     */
    glance(keeper) {
        const view = ScribeKeeper.view(keeper);
        return JSON.stringify([
            view.phase,
            view.reader,
            view.total,
            view.read,
            view.problem,
            view.spentToday,
            view.flight,
            view.stop,
            view.pulled,
            view.mismatch,
            view.settings,
            view.lastRead,
            view.unread.length,
            view.made.length,
            view.state.revision,
            view.state.facts.length,
            keeper.newest,
            view.edition,
        ]);
    },

    /**
     * @param {object} keeper
     * @param {string} kind
     * @return {{ value: Object|null, damage: string|null }}
     * @throws {Error}
     */
    readKind(keeper, kind) {
        try {
            return { value: ScribeStore.read(keeper.storage, keeper.roomId, kind), damage: null };
        } catch (error) {
            if (error?.damaged !== true) {
                throw error;
            }
            return { value: null, damage: ScribeKeeper.words(error) };
        }
    },

    /**
     * @param {*} value
     * @return {boolean}
     */
    soundBook(value) {
        const settings = ScribeKeeper.Settings;
        if (
            !ScribeKeeper.isObject(value) ||
            typeof value.adopted !== settings.BooleanType ||
            !ScribeKeeper.isObject(value.fingerprints) ||
            !ScribeKeeper.isObject(value.log)
        ) {
            return false;
        }
        const log = value.log;
        if (!Array.isArray(log.entries) || !ScribeKeeper.isObject(log.read) || !Array.isArray(log.notes)) {
            return false;
        }
        for (const name of settings.Counters) {
            if (!Number.isSafeInteger(log[name])) {
                return false;
            }
        }
        for (const fingerprint of Object.values(value.fingerprints)) {
            if (typeof fingerprint !== settings.StringType) {
                return false;
            }
        }
        for (const sequence of Object.values(log.read)) {
            if (!Number.isSafeInteger(sequence)) {
                return false;
            }
        }
        for (const note of log.notes) {
            if (typeof note !== settings.StringType) {
                return false;
            }
        }
        for (const entry of log.entries) {
            const sound =
                ScribeKeeper.isObject(entry) &&
                Number.isSafeInteger(entry.sequence) &&
                typeof entry.kind === settings.StringType &&
                typeof entry.origin === settings.StringType &&
                typeof entry.withdrawn === settings.BooleanType &&
                Array.isArray(entry.messageIds) &&
                Array.isArray(entry.operations);
            if (!sound) {
                return false;
            }
            for (const id of entry.messageIds) {
                if (typeof id !== settings.StringType) {
                    return false;
                }
            }
            for (const operation of entry.operations) {
                if (!ScribeKeeper.isObject(operation) || typeof operation.type !== settings.StringType) {
                    return false;
                }
            }
        }
        return true;
    },

    /**
     * @param {object} keeper
     * @param {Object|null} value
     * @param {string|null} damage
     * @return {void}
     */
    takeBook(keeper, value, damage) {
        keeper.book = null;
        keeper.damaged = damage;
        if (damage === null && value !== null) {
            if (ScribeKeeper.soundBook(value)) {
                keeper.book = value;
            } else {
                keeper.damaged = ScribeKeeper.damagedBook();
            }
        }
        try {
            ScribeKeeper.show(keeper);
        } catch (error) {
            keeper.book = null;
            keeper.damaged = ScribeKeeper.damagedBook();
            ScribeKeeper.show(keeper);
        }
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    damage(keeper) {
        keeper.book = null;
        keeper.damaged = ScribeKeeper.damagedBook();
        keeper.compared = false;
        if (keeper.reader) {
            keeper.phase = ScribeKeeper.Phase.Stopped;
        }
        ScribeKeeper.show(keeper);
    },

    /**
     * @param {object} keeper
     * @param {Object|null} value
     * @return {void}
     */
    takeCampaign(keeper, value) {
        keeper.blank = value === null || !Array.isArray(value.messages);
        const messages = keeper.blank ? [] : ScribeKeeper.strings(value.messages);
        const gone = !keeper.blank && Array.isArray(value.gone) ? value.gone.map(String) : [];
        keeper.historyComplete = !keeper.blank && value.completeHistory === true;
        const recheck = !keeper.blank && Array.isArray(value.recheck) ? value.recheck.filter((id) => typeof id === 'string') : [];
        keeper.campaign = { messages, gone, ...(keeper.historyComplete ? { completeHistory: true } : {}),
            ...(recheck.length ? { recheck } : {}) };
        keeper.compared = false;
        const taken = ScribeKeeper.take(messages, keeper);
        if (taken.intake === null) {
            keeper.problem = taken.disorder;
            return;
        }
        keeper.intake = taken.intake;
        keeper.newest = ScribeKeeper.newestKey(taken.intake);
    },

    /**
     * @param {object} keeper
     * @return {boolean}
     */
    load(keeper) {
        const kinds = ScribeStore.Kind;
        const none = ScribeKeeper.Settings.NoEdition;
        let settingsRead = null;
        let campaignRead = null;
        let bookRead = null;
        ScribeKeeper.checkSchedule(keeper);
        try {
            settingsRead = ScribeKeeper.readKind(keeper, kinds.Settings);
            if (settingsRead.damage === null) {
                const edition = settingsRead.value === null ? none : settingsRead.value.edition;
                keeper.edition = Number.isSafeInteger(edition) && edition >= none ? edition : none;
            }
            campaignRead = ScribeKeeper.readKind(keeper, kinds.Campaign);
            bookRead = ScribeKeeper.readKind(keeper, kinds.Book);
        } catch (error) {
            keeper.unloaded = ScribeKeeper.words(error);
            return false;
        }
        keeper.unloaded = null;
        keeper.historyChecked = false;
        keeper.historyComplete = false;
        keeper.pullDone = false;
        keeper.partial = false;
        keeper.cutShort = false;
        keeper.unjoined = false;
        keeper.suspectAt = null;
        keeper.mismatch = null;
        keeper.cut = null;
        keeper.settings = ScribeKeeper.Defaults;
        keeper.savedStop = null;
        const record = settingsRead.value;
        if (settingsRead.damage !== null) {
            keeper.problem = settingsRead.damage;
        } else if (record !== null) {
            try {
                keeper.settings = ScribeKeeper.settle(ScribeKeeper.Defaults, record);
            } catch (error) {
                keeper.problem = ScribeKeeper.words(error);
            }
            keeper.savedStop = ScribeKeeper.stopOf(record.stop);
        }
        keeper.stop = keeper.savedStop;
        keeper.restoredStop = keeper.stop;
        keeper.retryAt = null;
        keeper.intake = null;
        keeper.newest = null;
        ScribeKeeper.takeCampaign(keeper, campaignRead.value);
        ScribeKeeper.takeBook(keeper, bookRead.value, bookRead.damage);
        ScribeKeeper.counted(keeper);
        return true;
    },

    /**
     * @param {object} keeper
     * @return {number}
     */
    owedToday(keeper) {
        const today = keeper.clock.today();
        return keeper.owed.has(today) ? keeper.owed.get(today) : ScribeKeeper.Settings.NoSpending;
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    counted(keeper) {
        const failure = ScribeKeeper.recount(keeper);
        if (failure !== null) {
            keeper.problem = failure;
        }
    },

    /**
     * @param {object} keeper
     * @return {string|null}
     */
    recount(keeper) {
        const today = keeper.clock.today();
        try {
            const spent = ScribeStore.spent(keeper.storage, keeper.roomId, today);
            const others = ScribeStore.others(keeper.storage, keeper.roomId, today);
            keeper.spentToday = spent + others + ScribeKeeper.owedToday(keeper);
        } catch (error) {
            return ScribeKeeper.words(error);
        }
        return null;
    },

    /**
     * @param {object} keeper
     * @param {string} day
     * @param {number} amount
     * @return {number|null}
     */
    spend(keeper, day, amount) {
        let before = null;
        try {
            before = ScribeStore.spent(keeper.storage, keeper.roomId, day);
            return ScribeStore.spend(keeper.storage, keeper.roomId, day, amount);
        } catch (error) {
            keeper.owing = ScribeKeeper.words(error);
        }
        if (before === null) {
            return null;
        }
        try {
            const total = ScribeStore.spent(keeper.storage, keeper.roomId, day);
            return total === before + amount ? total : null;
        } catch (error) {
            keeper.owing = ScribeKeeper.words(error);
            return null;
        }
    },

    /**
     * @param {object} keeper
     * @param {number} amount
     * @return {boolean}
     */
    pay(keeper, amount) {
        const day = keeper.clock.today();
        const total = ScribeKeeper.spend(keeper, day, amount);
        if (total !== null) {
            ScribeKeeper.counted(keeper);
            return true;
        }
        const owed = keeper.owed.has(day) ? keeper.owed.get(day) : ScribeKeeper.Settings.NoSpending;
        keeper.owed.set(day, owed + amount);
        keeper.spentToday += amount;
        return false;
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    repay(keeper) {
        const settings = ScribeKeeper.Settings;
        const today = keeper.clock.today();
        for (const [day, amount] of [...keeper.owed.entries()]) {
            let later = false;
            try {
                later = day !== today && ScribeStore.spent(keeper.storage, keeper.roomId, today) > settings.NoSpending;
            } catch (error) {
                keeper.owing = ScribeKeeper.words(error);
                continue;
            }
            if (later || ScribeKeeper.spend(keeper, day, amount) !== null) {
                keeper.owed.delete(day);
            }
        }
        ScribeKeeper.counted(keeper);
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    reloadBook(keeper) {
        try {
            const read = ScribeKeeper.readKind(keeper, ScribeStore.Kind.Book);
            ScribeKeeper.takeBook(keeper, read.value, read.damage);
        } catch (error) {
            keeper.unloaded = ScribeKeeper.words(error);
        }
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    reloadCampaign(keeper) {
        try {
            const read = ScribeKeeper.readKind(keeper, ScribeStore.Kind.Campaign);
            ScribeKeeper.takeCampaign(keeper, read.value);
            ScribeKeeper.show(keeper);
        } catch (error) {
            keeper.unloaded = ScribeKeeper.words(error);
        }
    },

    /**
     * @param {object} keeper
     * @return {boolean}
     * @throws {Error}
     */
    claimed(keeper) {
        const held =
            keeper.claim === null
                ? ScribeStore.claim(keeper.storage, keeper.roomId, keeper.tabId, keeper.clock.now())
                : keeper.claim() === true;
        return held && (keeper.lease === null || keeper.lease() === true);
    },

    /**
     * @param {object} keeper
     * @return {boolean}
     * @throws {Error}
     */
    still(keeper) {
        let held = false;
        if (keeper.claim === null) {
            const name = ScribeStore.name(ScribeStore.Settings.Types.Claim, ScribeStore.room(keeper.roomId));
            const stored = ScribeStore.claimOf(ScribeStore.fetch(keeper.storage, name));
            held = stored !== null && stored.tabId === keeper.tabId;
        } else {
            held = keeper.claim() === true;
        }
        return held && (keeper.lease === null || keeper.lease() === true);
    },

    /**
     * @param {object} keeper
     * @return {boolean}
     */
    writable(keeper) {
        let still;
        try {
            still = ScribeKeeper.still(keeper);
        } catch (error) {
            keeper.authorityBlocked = true;
            keeper.problem = ScribeKeeper.words(error);
            return false;
        }
        keeper.authorityBlocked = false;
        if (!still) {
            ScribeKeeper.lose(keeper);
        }
        return still;
    },

    /**
     * @param {object} keeper
     * @param {string} kind
     * @param {object} value
     * @return {void}
     * @throws {Error}
     */
    store(keeper, kind, value) {
        const epoch = keeper.epoch;
        if (keeper.closed || !keeper.reader) {
            throw new Error(ScribeKeeper.Settings.Messages.Watching);
        }
        ScribeStore.write(keeper.storage, keeper.roomId, kind, value,
            () => !keeper.closed && keeper.reader && keeper.epoch === epoch && ScribeKeeper.writable(keeper));
    },

    /**
     * @param {object} keeper
     * @param {readonly object[]} messages
     * @param {Set<string>|null} changed
     * @return {{ log: object, fingerprints: Object<string, string>, adopted: boolean }|null}
     * @throws {Error}
     */
    withdrawn(keeper, messages, changed = null) {
        const book = keeper.book;
        const targets = changed ?? ScribeLog.invalidated(book, messages, keeper.campaign.gone, keeper.intake?.messages ?? [],
            keeper.historyComplete && !keeper.partial && !keeper.unjoined);
        for (const id of keeper.campaign.recheck ?? []) {
            if (Object.hasOwn(book.log.read, id)) {
                targets.add(id);
            }
        }
        if (!targets.size) {
            return null;
        }
        const log = ScribeKeeper.copy(book.log);
        const fingerprints = { ...book.fingerprints };
        const projections = { ...book.projections };
        for (const id of ScribeLog.withdrawSources(log, targets)) {
            delete fingerprints[id];
            delete projections[id];
        }
        return { ...book, log, fingerprints, projections };
    },

    /**
     * @param {object} keeper
     * @param {object|null} source
     * @param {Set<string>|null} invalid
     * @return {void}
     */
    compare(keeper, source = null, invalid = null) {
        const settings = ScribeKeeper.Settings;
        const taken = source ?? ScribeKeeper.take(keeper.campaign.messages, keeper);
        keeper.compared = false;
        if (taken.intake === null) {
            keeper.problem = taken.disorder;
            return;
        }
        if (keeper.book !== null) {
            let changed = null;
            try {
                changed = ScribeKeeper.withdrawn(keeper, taken.intake.messages, invalid);
            } catch (error) {
                ScribeKeeper.damage(keeper);
                return;
            }
            if (changed !== null) {
                if (!ScribeKeeper.writable(keeper)) {
                    return;
                }
                try {
                    ScribeKeeper.store(keeper, ScribeStore.Kind.Book, changed);
                } catch (error) {
                    keeper.problem = ScribeKeeper.words(error);
                    ScribeKeeper.reloadBook(keeper);
                    return;
                }
                keeper.book = changed;
            }
        }
        const gone = keeper.campaign.gone;
        if ((gone.length || keeper.campaign.recheck?.length) && (keeper.book !== null || keeper.damaged === null)) {
            if (!ScribeKeeper.writable(keeper)) {
                return;
            }
            const cleared = { messages: keeper.campaign.messages, gone: [],
                ...(keeper.campaign.completeHistory ? { completeHistory: true } : {}) };
            try {
                ScribeKeeper.store(keeper, ScribeStore.Kind.Campaign, cleared);
            } catch (error) {
                keeper.problem = ScribeKeeper.words(error);
                ScribeKeeper.reloadCampaign(keeper);
                return;
            }
            keeper.campaign = cleared;
        }
        keeper.intake = taken.intake;
        try {
            ScribeKeeper.show(keeper);
        } catch (error) {
            ScribeKeeper.damage(keeper);
            return;
        }
        keeper.compared = true;
        const newest = ScribeKeeper.newestKey(taken.intake);
        if (newest !== keeper.newest) {
            keeper.newest = newest;
            const message = taken.intake.messages.at(settings.Last);
            if (message !== undefined) {
                ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Reply, message });
            }
        }
    },

    /**
     * @param {object} keeper
     * @param {object[]} rawMessages
     * @param {string[]} gone
     * @param {boolean} complete
     * @return {boolean}
     */
    absorb(keeper, rawMessages, gone, complete) {
        if (!ScribeKeeper.writable(keeper)) {
            return false;
        }
        const taken = ScribeKeeper.take(rawMessages, keeper);
        const invalid = keeper.book && taken.intake ? ScribeLog.invalidated(keeper.book, taken.intake.messages,
            gone, keeper.intake?.messages ?? [], keeper.historyComplete && !keeper.partial && !keeper.unjoined) : null;
        const recheck = new Set(keeper.campaign.recheck);
        for (const id of invalid ?? []) {
            recheck.add(id);
        }
        const campaign = { messages: rawMessages, gone, ...(complete || keeper.historyComplete ? { completeHistory: true } : {}),
            ...(recheck.size ? { recheck: [...recheck] } : {}) };
        try {
            ScribeKeeper.store(keeper, ScribeStore.Kind.Campaign, campaign);
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
            ScribeKeeper.reloadCampaign(keeper);
            return false;
        }
        keeper.campaign = campaign;
        keeper.blank = false;
        keeper.problem = null;
        ScribeKeeper.compare(keeper, taken, invalid);
        return true;
    },

    /**
     * @param {object[]} saved
     * @param {object[]} pulled
     * @param {boolean} keepAll
     * @param {boolean} whole
     * @return {{ messages: object[], removed: string[], joined: boolean, shared: boolean, changed: boolean }}
     */
    merge(saved, pulled, keepAll, whole = false) {
        const settings = ScribeKeeper.Settings;
        if (pulled.length === settings.NoCount) {
            return { messages: saved, removed: [], joined: true, shared: false, changed: false };
        }
        const inPulled = new Set();
        for (const message of pulled) {
            inPulled.add(message.id);
        }
        const join = saved.findIndex(
            /**
             * @param {{ id: string }} message
             * @return {boolean}
             */
            (message) => inPulled.has(message.id),
        );
        if (join === settings.NotFound) {
            if (saved.length === settings.NoCount) {
                return { messages: pulled, removed: [], joined: true, shared: false, changed: true };
            }
            return { messages: saved, removed: [], joined: false, shared: false, changed: false };
        }
        const known = new Map();
        const removed = whole && !keepAll ? saved.slice(0, join).map((message) => message.id) : [];
        const tail = [];
        let next = settings.NoCount;
        let changed = false;
        for (const message of saved.slice(join)) {
            if (inPulled.has(message.id)) {
                known.set(message.id, message);
                for (; next < pulled.length; next++) {
                    tail.push(pulled[next]);
                    if (pulled[next].id === message.id) {
                        next++;
                        break;
                    }
                }
            } else if (keepAll) {
                tail.push(message);
            } else {
                removed.push(message.id);
                changed = true;
            }
        }
        for (; next < pulled.length; next++) {
            tail.push(pulled[next]);
        }
        for (const message of pulled) {
            const before = known.get(message.id);
            if (before === undefined || JSON.stringify(before) !== JSON.stringify(message)) {
                changed = true;
            }
        }
        const messages = whole && !keepAll ? tail : [...saved.slice(0, join), ...tail];
        changed ||= messages.length !== saved.length || messages.some((message, index) => message.id !== saved[index].id);
        return { messages, removed, joined: true, shared: true, changed };
    },

    /**
     * @param {object} keeper
     * @param {object[]} pulled
     * @param {boolean} keepAll
     * @param {boolean} emptyRoom
     * @param {boolean} whole
     * @param {readonly object[]} verified
     * @return {{ fresh: boolean, joined: boolean, shared: boolean, changed: boolean }}
     */
    takeIn(keeper, pulled, keepAll, emptyRoom = false, whole = false, verified = []) {
        const saved = keeper.campaign.messages;
        const merged = emptyRoom && !keepAll && pulled.length === 0 && saved.length > 0
            ? { messages: [], removed: saved.map((message) => message.id), joined: true, shared: false, changed: true }
            : ScribeKeeper.merge(saved, pulled, keepAll, whole);
        if (!merged.joined) {
            return { fresh: false, joined: false, shared: false, changed: false };
        }
        if (verified.length) {
            const replacements = new Map(verified.map((row) => [row.id, row]));
            merged.messages = merged.messages.map((row) => {
                const fresh = replacements.get(row.id);
                if (fresh && JSON.stringify(fresh) !== JSON.stringify(row)) {
                    merged.changed = true;
                    return fresh;
                }
                return row;
            });
        }
        const confirmed = whole && (emptyRoom || pulled.length > 0) && !keepAll;
        if (!merged.changed && !(confirmed && !keeper.campaign.completeHistory)) {
            if (!keeper.compared && !keeper.blank) {
                ScribeKeeper.compare(keeper);
            }
            return { fresh: true, joined: true, shared: merged.shared, changed: false };
        }
        const gone = [...keeper.campaign.gone];
        for (const id of merged.removed) {
            if (!gone.includes(id)) {
                gone.push(id);
            }
        }
        const fresh = ScribeKeeper.absorb(keeper, merged.messages, gone, confirmed);
        return { fresh, joined: true, shared: merged.shared, changed: true };
    },

    /**
     * @param {number} skipped
     * @return {string|null}
     */
    skippedWords(skipped) {
        const settings = ScribeKeeper.Settings;
        if (!(skipped > settings.NoCount)) {
            return null;
        }
        return skipped + (skipped === settings.One ? settings.Messages.SkippedOne : settings.Messages.SkippedMany);
    },

    /**
     * @param {{ end: string, problem: string|null, skipped: number }} pulled
     * @param {boolean} apart
     * @return {string|null}
     */
    shortfall(pulled, apart) {
        const settings = ScribeKeeper.Settings;
        const messages = settings.Messages;
        const ends = settings.Ends;
        const sentences = [];
        if (!ScribeKeeper.whole(pulled)) {
            const given = typeof pulled.problem === settings.StringType ? pulled.problem : null;
            let reason = messages.StoppedEarly;
            if (pulled.end === ends.Limit) {
                reason = messages.TooLong;
            }
            if (pulled.end === ends.Failed) {
                reason = messages.PullFailed;
            }
            if (apart) {
                sentences.push(messages.FarOpen + (given ?? messages.StoppedEarly) + messages.FarClose);
            } else {
                sentences.push(messages.PartOpen + (given ?? reason) + messages.PartClose);
            }
        }
        const skipped = ScribeKeeper.skippedWords(pulled.skipped);
        if (skipped !== null) {
            sentences.push(skipped);
        }
        return sentences.length === settings.NoCount ? null : sentences.join(settings.SentenceJoint);
    },

    /**
     * @param {object} keeper
     * @return {boolean}
     */
    mayRepull(keeper) {
        const now = keeper.clock.now();
        return keeper.pulledAt === null || now < keeper.pulledAt || now - keeper.pulledAt >= ScribeKeeper.Settings.RepullMs;
    },

    /**
     * @param {{ end: string }} pulled
     * @return {boolean}
     */
    whole(pulled) {
        return ScribeKeeper.Settings.WholeEnds.includes(pulled.end);
    },

    /**
     * @param {object} keeper
     * @return {string|null}
     */
    held(keeper) {
        const messages = ScribeKeeper.Settings.Messages;
        if (keeper.blank) {
            return messages.NothingPulled;
        }
        if (keeper.partial) {
            return keeper.cut;
        }
        if (keeper.mismatch !== null) {
            return messages.Mismatch;
        }
        if (keeper.suspectAt !== null) {
            return messages.Suspect;
        }
        if (keeper.unjoined) {
            return messages.Unjoined;
        }
        return null;
    },

    /**
     * @param {object} keeper
     * @return {boolean}
     */
    holding(keeper) {
        return keeper.partial || keeper.unjoined || keeper.suspectAt !== null || keeper.mismatch !== null;
    },

    /**
     * @param {object} keeper
     * @param {Function|null} onComplete
     * @param {Function|null} allowExpensive
     * @return {Promise<boolean>}
     */
    async history(keeper, onComplete = null, allowExpensive = null) {
        const settings = ScribeKeeper.Settings;
        const flight = settings.Flight;
        const epoch = keeper.epoch;
        keeper.busy = ScribeKeeper.Busy.Pulling;
        keeper.pulledAt = keeper.clock.now();
        keeper.flight = flight.PullOpen + settings.NoCount + flight.PullClose;
        keeper.began = keeper.pulledAt;
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
        let result = null;
        try {
            result = await keeper.zeta.history(
                /**
                 * @param {number} count
                 * @return {void}
                 */
                (count) => {
                    if (keeper.epoch === epoch) {
                        keeper.flight = flight.PullOpen + count + (count === settings.One ? flight.PullOne : flight.PullClose);
                        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
                    }
                },
                allowExpensive,
            );
        } catch (error) {
            if (keeper.epoch === epoch) {
                keeper.problem = { source: 'Zeta', reason: ScribeKeeper.words(error) };
            }
        }
        if (keeper.epoch !== epoch) {
            return false;
        }
        keeper.flight = null;
        if (result === null || result.deferredCheck) {
            ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            return false;
        }
        const pulled = ScribeKeeper.single(result.messages);
        const whole = ScribeKeeper.whole(result);
        const natural = result.end !== settings.Ends.Failed && result.end !== settings.Ends.Limit;
        const now = keeper.clock.now();
        keeper.pullDone = true;
        keeper.problem = null;
        keeper.cutShort = !whole;
        keeper.lastPull = Object.freeze({ end: result.end, count: pulled.length, skipped: result.skipped, at: now });
        const taken = ScribeKeeper.takeIn(keeper, pulled, result.skipped > settings.NoCount,
            whole && result.problem === null && result.emptyRoom === true, whole && !result.problem && result.completeHistory === true);
        if (keeper.epoch !== epoch) {
            return false;
        }
        if (taken.fresh && whole && !result.skipped && !result.problem && pulled.at(settings.Last)?.id === keeper.campaign.messages.at(settings.Last)?.id) {
            ScribeKeeper.observed(keeper, pulled, result.completeHistory === true);
            if (result.completeHistory === true && onComplete) {
                onComplete(pulled);
            }
        }
        if (taken.fresh) {
            ScribeKeeper.confirmStretch(keeper, pulled, result);
        }
        keeper.cut = ScribeKeeper.shortfall(result, !taken.joined);
        keeper.partial = !whole && !taken.shared && !(keeper.book === null && natural && taken.joined);
        if (taken.shared || (taken.joined && whole)) {
            keeper.unjoined = false;
            keeper.suspectAt = null;
            keeper.mismatch = null;
        } else if (!taken.joined && whole) {
            if (keeper.mismatch !== null || (keeper.suspectAt !== null && now - keeper.suspectAt >= settings.RepullMs)) {
                keeper.mismatch = pulled;
            } else if (keeper.suspectAt === null || now < keeper.suspectAt) {
                keeper.suspectAt = now;
            }
        }
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
        return taken.fresh;
    },

    /**
     * @param {object} keeper
     * @param {string|null} anchor
     * @param {object|null} expected
     * @param {readonly string[]} evidence
     * @param {object|null} check
     * @return {Promise<boolean>}
     */
    async newest(keeper, anchor = null, expected = null, evidence = [], check = null) {
        const epoch = keeper.epoch;
        const before = ScribeKeeper.issue(keeper);
        keeper.flight = ScribeKeeper.Settings.Flight.Looking;
        keeper.began = keeper.clock.now();
        let page = null;
        let through = null;
        const required = new Set(evidence);
        try {
            const stretch = keeper.checkStretch && !keeper.pausing && ScribeKeeper.due(keeper) ? ScribeKeeper.nextStretch(keeper) : [];
            through = anchor ?? (stretch.length ? keeper.intake.messages[Math.max(0, stretch[0].position - 2)].id : null);
            for (const row of stretch) {
                required.add(row.id);
            }
            if (through !== null) {
                required.add(through);
            }
            if (expected) {
                required.add(expected.id);
            }
            page = await keeper.zeta.newest(through, [...required], keeper.campaign.messages, check);
        } catch (error) {
            if (keeper.epoch === epoch) {
                keeper.problem = { source: 'Zeta', reason: ScribeKeeper.words(error) };
            }
        }
        if (keeper.epoch !== epoch) {
            return false;
        }
        keeper.flight = null;
        if (page?.deferredCheck) {
            return false;
        }
        if (page === null) {
            if (ScribeKeeper.issue(keeper) !== before) {
                ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            }
            return false;
        }
        if (page.needsHistory) {
            if ((keeper.cutShort || keeper.unjoined) && !ScribeKeeper.mayRepull(keeper)) {
                return false;
            }
            const originals = keeper.intake?.messages.filter((row) => required.has(row.id)) ?? [];
            let confirmed = false;
            const fresh = await ScribeKeeper.history(keeper, (pulled) => {
                const received = new Set(pulled.map((row) => row.id));
                confirmed = originals.length === required.size && originals.every((row) => {
                    const current = keeper.intake?.messages[row.position - 1];
                    return received.has(row.id) && current?.id === row.id && current.fingerprint === row.fingerprint &&
                        current.projection === row.projection && current.attributionPending === row.attributionPending;
                });
            }, page.expiredCheck ? check.reserve : null);
            if (!fresh || keeper.cutShort || keeper.unjoined || keeper.epoch !== epoch) {
                return false;
            }
            if (expected === null) {
                return true;
            }
            const current = keeper.intake?.messages[expected.position - 1];
            return confirmed && current?.id === expected.id && current.fingerprint === expected.fingerprint &&
                current.projection === expected.projection && !current.attributionPending;
        }
        keeper.problem = null;
        const head = ScribeKeeper.single(page.messages);
        const verified = page.verified ?? [];
        const pulled = [...verified, ...head];
        const complete = ScribeKeeper.whole(page) && !page.skipped && !page.problem && page.completeHistory === true;
        if (anchor && !complete && !pulled.some((message) => message.id === anchor)) {
            keeper.problem = page.problem ? { source: 'Zeta', reason: page.problem } : ScribeKeeper.Settings.Messages.Unsettled;
            ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            return false;
        }
        const taken = ScribeKeeper.takeIn(keeper, head, page.skipped > ScribeKeeper.Settings.NoCount,
            ScribeKeeper.whole(page) && page.problem === null && page.emptyRoom === true, complete, verified);
        if (keeper.epoch !== epoch) {
            return false;
        }
        if (!taken.joined) {
            keeper.unjoined = true;
            if (ScribeKeeper.mayRepull(keeper)) {
                const fresh = await ScribeKeeper.history(keeper);
                return fresh && expected === null;
            }
            ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            return false;
        }
        if (taken.shared) {
            keeper.suspectAt = null;
        }
        const observed = taken.fresh && !page.skipped && !page.problem && (ScribeKeeper.whole(page) || page.end === 'ThroughMessage') &&
            pulled.at(ScribeKeeper.Settings.Last)?.id === keeper.campaign.messages.at(ScribeKeeper.Settings.Last)?.id;
        if (observed) {
            ScribeKeeper.observed(keeper, pulled, complete);
        }
        if (taken.fresh) {
            ScribeKeeper.confirmStretch(keeper, pulled, page);
        }
        const skipped = ScribeKeeper.skippedWords(page.skipped);
        if (page.problem) {
            keeper.problem = { source: 'Zeta', reason: page.problem };
        } else if (skipped !== null) {
            keeper.problem = skipped;
        }
        if (taken.changed || ScribeKeeper.issue(keeper) !== before) {
            ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
        }
        if (expected !== null) {
            const current = keeper.intake?.messages[expected.position - 1];
            const received = new Set(pulled.map((message) => message.id));
            return observed && received.has(expected.id) && evidence.every((id) => received.has(id)) && current?.id === expected.id &&
                current.fingerprint === expected.fingerprint && !current.attributionPending && current.projection === expected.projection;
        }
        return taken.fresh;
    },

    /**
     * @param {object} keeper
     * @return {readonly object[]}
     */
    nextStretch(keeper) {
        const messages = keeper.activeTarget ? keeper.intake.messages.slice(0, ScribeKeeper.plan(keeper, keeper.activeTarget).end)
            : keeper.intake.messages;
        return ScribeAdoption.next(keeper.book.log, messages, keeper.settings.size);
    },

    /**
     * @param {object} keeper
     * @param {object[]} pulled
     * @param {object} response
     * @return {void}
     */
    confirmStretch(keeper, pulled, response) {
        if (!keeper.checkStretch || !keeper.compared || !keeper.book || response.skipped || response.problem ||
            (pulled.length === 0 && response.emptyRoom !== true)) {
            return;
        }
        const ids = new Set(pulled.map((message) => message.id));
        const stretch = ScribeKeeper.nextStretch(keeper);
        if (!stretch.length || (!keeper.pausing && ScribeKeeper.due(keeper))) {
            keeper.checkStretch = !stretch.every((message) => ids.has(message.id));
        }
    },

    /**
     * @param {object} keeper
     * @param {{id: string, fingerprint: string}|null} target
     * @return {{ settled: readonly object[], end: number }}
     */
    plan(keeper, target = null) {
        const settled = keeper.intake.messages;
        if (target !== null) {
            const index = settled.findIndex((message) => message.id === target.id && message.fingerprint === target.fingerprint);
            return { settled, end: index + 1 };
        }
        if (!keeper.book.adopted || ScribeKeeper.answered(keeper)) {
            return { settled, end: settled.length };
        }
        const end = settled.findLastIndex(
            (message) => !message.attributionPending && !Object.hasOwn(keeper.book.log.read, message.id),
        ) + 1;
        return { settled, end };
    },

    /**
     * @param {object} keeper
     * @return {boolean}
     */
    due(keeper) {
        const book = keeper.book;
        const blocked = keeper.unloaded !== null || keeper.owed.size > ScribeKeeper.Settings.NoCount;
        if (book === null || !keeper.compared || blocked || ScribeKeeper.held(keeper) !== null) {
            return false;
        }
        if (keeper.phase === ScribeKeeper.Phase.Stopped) {
            const stop = keeper.stop;
            if (stop === null) {
                return false;
            }
            if (stop.reason === ScribeAdoption.Stop.Budget) {
                return keeper.spentToday < keeper.settings.budget;
            }
            return keeper.retryAt !== null && keeper.clock.now() >= keeper.retryAt;
        }
        if (ScribeKeeper.answered(keeper)) {
            return true;
        }
        if (!book.adopted) {
            if (keeper.intake.messages.some((message) => message.attributionPending)) {
                const plan = ScribeKeeper.plan(keeper);
                return plan.settled.some((message) => !message.attributionPending && !Object.hasOwn(book.log.read, message.id));
            }
            return true;
        }
        return ScribeKeeper.plan(keeper).end > ScribeKeeper.Settings.NoCount;
    },

    /**
     * @param {object} keeper
     * @param {readonly object[]} chosen
     * @return {string}
     */
    reading(keeper, chosen) {
        const flight = ScribeKeeper.Settings.Flight;
        if (ScribeKeeper.answered(keeper)) {
            return flight.Answers;
        }
        const stretch = ScribeAdoption.next(keeper.book.log, chosen, keeper.settings.size);
        if (stretch.length === ScribeKeeper.Settings.NoCount) {
            return flight.Finishing;
        }
        return flight.ReadOpen + stretch[0].position + flight.ReadMiddle + stretch.at(ScribeKeeper.Settings.Last).position;
    },

    /**
     * @param {object} keeper
     * @param {Readonly<{ reason: string, problem: string|null }>|null} stop
     * @param {boolean} storageCaused
     * @return {void}
     */
    keepStop(keeper, stop, storageCaused) {
        const settings = ScribeKeeper.Settings;
        keeper.restoredStop = null;
        keeper.stop = stop;
        keeper.retryAt = storageCaused ? keeper.clock.now() + settings.RepullMs : null;
        const saved = stop !== null && settings.Lasting.includes(stop.reason) && !storageCaused ? stop : null;
        if (JSON.stringify(saved) === JSON.stringify(keeper.savedStop) || keeper.unloaded !== null) {
            return;
        }
        if (!ScribeKeeper.writable(keeper)) {
            return;
        }
        try {
            ScribeKeeper.saveStop(keeper, saved);
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
        }
    },

    /**
     * @param {object} keeper
     * @param {Readonly<{ reason: string, problem: string|null }>|null} saved
     * @return {void}
     * @throws {Error}
     */
    saveStop(keeper, saved) {
        ScribeKeeper.writeSettings(keeper, keeper.settings, saved, keeper.edition);
        keeper.savedStop = saved;
    },

    /**
     * @param {object} keeper
     * @param {Readonly<object>} settings
     * @param {Readonly<{ reason: string, problem: string|null }>|null} stop
     * @param {number} edition
     * @return {void}
     * @throws {Error}
     */
    writeSettings(keeper, settings, stop, edition) {
        ScribeKeeper.store(keeper, ScribeStore.Kind.Settings, { ...settings, stop, edition });
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    restoreEdition(keeper) {
        try {
            ScribeKeeper.writeSettings(keeper, keeper.settings, keeper.savedStop, keeper.edition);
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
        }
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    holdPause(keeper) {
        const phases = ScribeKeeper.Phase;
        ScribeKeeper.keepStop(keeper, Object.freeze({ reason: ScribeAdoption.Stop.Paused, problem: null }), false);
        if (keeper.reader && keeper.busy !== ScribeKeeper.Busy.Reading && keeper.phase !== phases.Loading) {
            keeper.phase = phases.Stopped;
        }
    },

    /**
     * @param {object} keeper
     * @param {{id: string, fingerprint: string}|null} target
     * @return {Promise<void>}
     */
    async read(keeper, target = null) {
        const settings = ScribeKeeper.Settings;
        const stops = ScribeAdoption.Stop;
        const epoch = keeper.epoch;
        if (!keeper.compared) {
            ScribeKeeper.compare(keeper);
            if (!keeper.compared) {
                return;
            }
        }
        const book = keeper.book;
        const size = keeper.settings.size;
        const { settled, end } = ScribeKeeper.plan(keeper, target);
        const chosen = settled.slice(0, end);
        const room = target === null ? keeper.intake.messages : chosen;
        const notes = keeper.intake.notes.filter(
            /**
             * @param {{ position: number }} note
             * @return {boolean}
             */
            (note) => note.position <= end,
        );
        const prints = new Map();
        const lengths = new Map();
        for (const message of room) {
            prints.set(message.id, message.fingerprint);
            if (message.projection !== undefined) {
                lengths.set(message.id, message.projection);
            }
        }
        const credentials = ScribeStore.diagnosticKeys(keeper.storage);
        const diagnostic = (value) => ScribeStore.diagnosticCopy(value, ScribeStore.redactor(keeper.storage, credentials));
        const job = { recorded: settings.NoSpending, saveFailed: false, superseded: false, storage: false, modelError: null };
        /**
         * @param {readonly object[]} questions
         * @param {boolean} refreshed
         * @return {void}
         * @throws {Error}
         */
        const confirmAttribution = (questions = [], refreshed = false) => {
            if (keeper.compared && questions.length === 0 && !refreshed) {
                return;
            }
            const latest = ScribeKeeper.take(keeper.campaign.messages, keeper).intake;
            /**
             * @param {number} position
             * @return {boolean}
             */
            const changed = (position) => {
                const before = room[position - 1];
                const now = latest.messages[position - 1];
                return before?.id !== now?.id || now?.attributionPending ||
                    before?.projection !== now?.projection || before?.fingerprint !== now?.fingerprint;
            };
            const sources = questions.length ? room : chosen;
            if (keeper.book !== book || !latest || sources.some((message) => !message.attributionPending && changed(message.position)) ||
                questions.some((question) => changed(question.position))) {
                keeper.compared = false;
                job.superseded = true;
                throw new Error(settings.Messages.ThrownAway);
            }
        };
        keeper.busy = ScribeKeeper.Busy.Reading;
        keeper.phase = ScribeKeeper.Phase.Reading;
        keeper.flight = ScribeKeeper.reading(keeper, chosen);
        keeper.began = keeper.clock.now();
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
        let result = null;
        try {
            const today = keeper.clock.today();
            job.recorded =
                ScribeStore.spent(keeper.storage, keeper.roomId, today) +
                ScribeStore.others(keeper.storage, keeper.roomId, today);
            const profile = keeper.profile === null ? null : await keeper.profile();
            result = await ScribeAdoption.run({
                messages: room,
                readThrough: end,
                notes,
                player: keeper.intake.player,
                profile,
                log: ScribeKeeper.copy(book.log),
                size,
                budget: keeper.settings.budget,
                spent: job.recorded,
                /**
                 * @return {boolean}
                 * @throws {Error}
                 */
                atBudget: () => {
                    const problem = ScribeKeeper.recount(keeper);
                    if (problem !== null) {
                        job.storage = true;
                        throw new Error(problem);
                    }
                    return keeper.spentToday >= keeper.settings.budget;
                },
                /**
                 * @param {string} system
                 * @param {string} user
                 * @param {readonly object[]} questions
                 * @return {Promise<{ text: string, cost: * }>}
                 */
                ask: async (system, user, questions) => {
                    if (keeper.epoch !== epoch || !ScribeKeeper.writable(keeper)) {
                        throw new Error(settings.Messages.ThrownAway);
                    }
                    confirmAttribution(questions);
                    const key = JSON.stringify([system, user]);
                    const found = keeper.kept.find(
                        /**
                         * @param {{ key: string }} answer
                         * @return {boolean}
                         */
                        (answer) => answer.key === key,
                    );
                    if (found !== undefined) {
                        for (const credential of found.credentials) {
                            credentials.add(credential);
                        }
                        return { text: found.text, cost: settings.NoSpending };
                    }
                    ScribeStore.diagnosticKeys(keeper.storage, credentials);
                    let answer;
                    try {
                        answer = await keeper.ask(settings.Role, system, user);
                    } catch (error) {
                        const reason = ScribeKeeper.words(error);
                        job.modelError = {
                            reason,
                            keyChanged: error?.keyChanged,
                            source: ScribeStore.localSource(error?.source) ? ScribeStore.errorSource(error) : 'OpenRouter',
                        };
                        throw error;
                    } finally {
                        ScribeStore.diagnosticKeys(keeper.storage, credentials);
                    }
                    if (!keeper.closed) {
                        keeper.kept.push({ key, text: answer.text, credentials });
                        keeper.kept.splice(settings.NoCount, Math.max(keeper.kept.length - settings.KeptAnswers, settings.NoCount));
                    }
                    return answer;
                },
                /**
                 * @param {object} log
                 * @param {readonly object[]} questions
                 * @return {Promise<void>}
                 * @throws {Error}
                 */
                save: async (log, questions) => {
                    if (keeper.epoch !== epoch || !ScribeKeeper.writable(keeper)) {
                        throw new Error(settings.Messages.ThrownAway);
                    }
                    if (keeper.pollPending && !keeper.pausing) {
                        keeper.pollPending = false;
                        const observed = keeper.observed;
                        const entry = log.entries.at(-1);
                        const positions = new Set(entry.messageIds);
                        const first = room.find((message) => positions.has(message.id)) ?? room[0];
                        const anchor = first ? room[Math.max(0, first.position - 2)].id : null;
                        const fresh = await ScribeKeeper.newest(keeper, anchor, null, [...entry.messageIds,
                            ...questions.map((question) => room[question.position - 1].id)]);
                        if (keeper.epoch !== epoch || !ScribeKeeper.writable(keeper)) {
                            throw new Error(settings.Messages.ThrownAway);
                        }
                        keeper.busy = ScribeKeeper.Busy.Reading;
                        if (!fresh || keeper.observed === observed) {
                            keeper.checkStretch = true;
                            job.superseded = true;
                            throw new Error(settings.Messages.ThrownAway);
                        }
                        keeper.pollPending = true;
                        confirmAttribution(questions, true);
                    } else {
                        confirmAttribution(questions);
                    }
                    const fingerprints = {};
                    const projections = {};
                    for (const id of Object.keys(log.read)) {
                        fingerprints[id] = prints.has(id) ? prints.get(id) : book.fingerprints[id];
                        if (lengths.has(id)) {
                            projections[id] = lengths.get(id);
                        } else if (!prints.has(id) && Object.hasOwn(book.projections ?? {}, id)) {
                            projections[id] = book.projections[id];
                        }
                    }
                    try {
                        ScribeKeeper.store(keeper, ScribeStore.Kind.Book, {
                            ...book,
                            log,
                            fingerprints,
                            projections,
                            adopted: book.adopted,
                        });
                    } catch (error) {
                        job.saveFailed = true;
                        job.storage = true;
                        throw error;
                    }
                    book.log = ScribeKeeper.copy(log);
                    book.fingerprints = fingerprints;
                    book.projections = projections;
                    keeper.kept = [];
                    ScribeKeeper.show(keeper);
                },
                /**
                 * @param {{ readable: boolean, system: string, input: string }} item
                 * @return {Promise<void>}
                 */
                record: async (item) => {
                    if (!item.readable) {
                        const key = JSON.stringify([item.system, item.input]);
                        keeper.kept = keeper.kept.filter(
                            /**
                             * @param {{ key: string }} answer
                             * @return {boolean}
                             */
                            (answer) => answer.key !== key,
                        );
                    }
                    if (keeper.epoch !== epoch) {
                        return;
                    }
                    const calls = keeper.calls;
                    calls.unshift(diagnostic(item));
                    for (let index = calls.length - 1; index >= 0 && calls.length > settings.LastCalls; index--) {
                        if (calls[index].readable) {
                            calls.splice(index, 1);
                        }
                    }
                },
                /**
                 * @param {{ spent: number, pass: string, last: number }} report
                 * @return {Promise<void>}
                 * @throws {Error}
                 */
                progress: async (report) => {
                    const amount = report.spent - job.recorded;
                    if (amount > settings.NoSpending) {
                        const recorded = ScribeKeeper.pay(keeper, amount);
                        job.recorded = report.spent;
                        if (!recorded) {
                            job.storage = true;
                            throw new Error(keeper.owing);
                        }
                    }
                    if (keeper.epoch !== epoch) {
                        return;
                    }
                    if (report.pass === ScribeAdoption.Pass.Story && Object.hasOwn(book.log.read, room[report.last - 1].id)) {
                        keeper.checkStretch = ScribeAdoption.next(book.log, chosen, size).length > settings.NoCount;
                        if (keeper.checkStretch && !keeper.pausing) {
                            keeper.pollPending = true;
                        }
                    }
                    keeper.lines.unshift(diagnostic(report));
                    keeper.lines.splice(settings.LastLines);
                    keeper.flight = ScribeKeeper.reading(keeper, chosen);
                    keeper.began = keeper.clock.now();
                    ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Progress });
                },
                /**
                 * @return {boolean}
                 */
                paused: () => keeper.pausing || keeper.epoch !== epoch || keeper.pollPending,
            });
        } catch (error) {
            job.storage = true;
            result = { stop: stops.Failed, problem: ScribeKeeper.words(error), spent: job.recorded };
        }
        const repoll = keeper.pollPending && (result.stop === stops.Paused || job.superseded) && !keeper.pausing;
        let stop = job.superseded || repoll ? stops.Done : result.stop;
        let problem = job.superseded ? null : result.problem;
        const unrecorded = result.spent - job.recorded;
        if (unrecorded > settings.NoSpending) {
            ScribeKeeper.pay(keeper, unrecorded);
        }
        if (keeper.epoch !== epoch) {
            return;
        }
        if (job.saveFailed || job.superseded) {
            ScribeKeeper.reloadBook(keeper);
        }
        if (stop === stops.Done && !job.superseded && !repoll && !book.adopted && keeper.book === book &&
            keeper.writtenThrough === keeper.intake.messages.length && ScribeKeeper.writable(keeper)) {
            const finished = { ...book, adopted: true };
            try {
                ScribeKeeper.store(keeper, ScribeStore.Kind.Book, finished);
                keeper.book = finished;
            } catch (error) {
                stop = stops.Failed;
                problem = ScribeKeeper.words(error);
                job.storage = true;
                ScribeKeeper.reloadBook(keeper);
            }
        }
        if (keeper.pausing) {
            stop = stops.Paused;
            problem = null;
            job.storage = false;
        }
        if (keeper.epoch !== epoch) {
            return;
        }
        keeper.busy = null;
        keeper.flight = null;
        if (keeper.authorityBlocked) {
            keeper.stop = Object.freeze({ reason: stops.Failed, problem: ScribeKeeper.words(keeper.problem) });
            keeper.retryAt = keeper.clock.now();
            keeper.phase = ScribeKeeper.Phase.Stopped;
            ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            return;
        }
        const modelError = stop === stops.Failed && problem === job.modelError?.reason ? job.modelError : null;
        if (modelError?.keyChanged?.()) {
            if (ScribeKeeper.writable(keeper)) {
                keeper.phase = ScribeKeeper.resting(keeper);
                await ScribeKeeper.step(keeper, false, target);
            }
            return;
        }
        const source = modelError ? { source: modelError.source } : {};
        const masked = diagnostic(problem);
        ScribeKeeper.keepStop(keeper, Object.freeze({ reason: stop, problem: masked, ...source }), job.storage);
        if (keeper.epoch !== epoch) {
            return;
        }
        keeper.phase = stop === stops.Done ? ScribeKeeper.Phase.Idle : ScribeKeeper.Phase.Stopped;
        if (keeper.unloaded === null) {
            ScribeKeeper.show(keeper);
        }
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
        if (repoll && keeper.epoch === epoch) {
            await ScribeKeeper.step(keeper, true, target);
        }
    },

    /**
     * @param {object} keeper
     * @return {string}
     */
    resting(keeper) {
        const phases = ScribeKeeper.Phase;
        const stopped = keeper.stop !== null && keeper.stop.reason !== ScribeAdoption.Stop.Done;
        if (keeper.unloaded !== null || keeper.damaged !== null || stopped) {
            return phases.Stopped;
        }
        return keeper.book === null ? phases.NoBook : phases.Idle;
    },

    /**
     * @param {object} keeper
     * @return {Promise<boolean>}
     */
    async start(keeper) {
        const epoch = keeper.epoch;
        keeper.phase = ScribeKeeper.Phase.Loading;
        try {
            ScribeStore.sweep(keeper.storage, keeper.roomId);
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
        }
        if (!keeper.blank) {
            ScribeKeeper.compare(keeper);
        }
        if (keeper.epoch !== epoch) {
            return false;
        }
        let fresh = false;
        try {
            fresh = await ScribeKeeper.history(keeper);
        } finally {
            if (keeper.epoch === epoch) {
                keeper.phase = ScribeKeeper.resting(keeper);
                ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            }
        }
        return keeper.epoch === epoch && fresh;
    },

    /**
     * @param {object} keeper
     * @return {Promise<void>}
     */
    async begin(keeper) {
        const epoch = keeper.epoch;
        ScribeKeeper.occupy(keeper, ScribeKeeper.Busy.Pulling);
        try {
            await ScribeKeeper.start(keeper);
        } finally {
            if (keeper.epoch === epoch) {
                ScribeKeeper.occupy(keeper, null);
            }
        }
    },

    /**
     * @param {object} keeper
     * @param {boolean} reserve
     * @return {boolean}
     */
    checkSchedule(keeper, reserve = false) {
        const now = keeper.clock.now();
        const maximum = now + ScribeKeeper.Settings.ExpensiveCheckMs;
        try {
            const saved = keeper.storage.get(keeper.checkAfterKey, 0);
            let deadline = Number.isSafeInteger(saved) && saved > 0 ? saved : 0;
            const due = reserve && deadline <= now;
            if (due || deadline > maximum) {
                deadline = maximum;
                if (keeper.reader && ScribeKeeper.still(keeper)) {
                    keeper.storage.set(keeper.checkAfterKey, deadline);
                    if (keeper.storage.get(keeper.checkAfterKey, 0) !== deadline) {
                        throw new Error(ScribeKeeper.Settings.Messages.CheckSchedule);
                    }
                } else if (reserve) {
                    return false;
                }
            }
            keeper.expensiveAfter = deadline;
            if (keeper.checkProblem?.reason === ScribeKeeper.Settings.Messages.CheckSchedule) {
                keeper.checkProblem = null;
            }
            return due;
        } catch {
            keeper.expensiveAfter = null;
            keeper.scheduleReadAt = now + ScribeKeeper.Settings.RepullMs;
            keeper.checkProblem = { source: 'Scribe', reason: ScribeKeeper.Settings.Messages.CheckSchedule };
            if (reserve) {
                keeper.checkRetryAt = now + ScribeKeeper.Settings.RepullMs;
            }
            return false;
        }
    },

    /**
     * @param {object} keeper
     * @return {Promise<void>}
     */
    async check(keeper) {
        const now = keeper.clock.now();
        if (keeper.expensiveAfter > now + ScribeKeeper.Settings.ExpensiveCheckMs ||
            keeper.expensiveAfter === null && (now >= keeper.scheduleReadAt || keeper.scheduleReadAt > now + ScribeKeeper.Settings.RepullMs)) {
            ScribeKeeper.checkSchedule(keeper);
        }
        if (!keeper.checkPassage || keeper.phase !== ScribeKeeper.Phase.Idle ||
            !keeper.book?.adopted || !keeper.compared || !keeper.historyChecked || keeper.pausing ||
            keeper.unloaded !== null || keeper.owed.size || ScribeKeeper.held(keeper) !== null ||
            keeper.writtenThrough <= keeper.checkProgress.checkedThrough ||
            keeper.clock.now() < keeper.checkRetryAt) {
            return;
        }
        const budgetProblem = ScribeKeeper.recount(keeper);
        if (budgetProblem || (!keeper.checkPage && keeper.spentToday >= keeper.settings.budget)) {
            keeper.checkProblem = { source: 'Scribe', reason: budgetProblem
                ? ScribeStore.diagnostic(keeper.storage, budgetProblem) : "The day's budget is spent" };
            return;
        }
        const messages = keeper.intake.messages;
        const work = ScribeLog.checkWork(keeper.book, messages);
        if (!work.message) {
            return;
        }
        const epoch = keeper.epoch;
        const target = work.message;
        if ((keeper.expensiveAfter === null || keeper.clock.now() < keeper.expensiveAfter) &&
            (keeper.deferredCheck?.id === target.id && keeper.deferredCheck.version === work.version &&
                !keeper.zeta.onHead?.(keeper.deferredCheck.sources) || keeper.zeta.distant?.(target.id))) {
            return;
        }
        keeper.deferredCheck = null;
        const selected = keeper.settings.pedant;
        const modelKey = 'model:' + selected;
        const limit = keeper.book.log.checkLimits?.[modelKey];
        if (limit?.blocked === work.version) {
            keeper.checkProblem = { source: 'Scribe', reason: limit.reason };
            return;
        }
        const credentials = ScribeStore.diagnosticKeys(keeper.storage);
        const current = () => keeper.epoch === epoch && !keeper.closed && !keeper.pausing &&
            keeper.compared && keeper.settings.pedant === selected && ScribeKeeper.writable(keeper);
        const yieldPage = {};
        const durableBook = () => {
            const durable = ScribeKeeper.readKind(keeper, ScribeStore.Kind.Book);
            if (durable.damage || !durable.value || !ScribeKeeper.soundBook(durable.value)) {
                throw new Error(durable.damage ?? ScribeKeeper.damagedBook());
            }
            return durable.value;
        };
        const learnLimit = (bytes, reason = null) => {
            if (!current()) {
                throw yieldPage;
            }
            const book = durableBook();
            const latest = ScribeLog.checkWork(book, keeper.intake.messages, false);
            if (latest.message?.id !== target.id || latest.version !== work.version) {
                throw yieldPage;
            }
            const previous = book.log.checkLimits?.[modelKey];
            const bound = Number.isSafeInteger(bytes) && bytes > 0 ? Math.min(bytes, previous?.bytes ?? bytes) : previous?.bytes;
            book.log.checkLimits = { ...book.log.checkLimits, [modelKey]: {
                bytes: bound, ...(reason === null ? {} : { blocked: work.version, reason }),
            } };
            ScribeKeeper.store(keeper, ScribeStore.Kind.Book, book);
            keeper.book = book;
        };
        const save = async (page, sources = null) => {
            if (!current()) {
                throw yieldPage;
            }
            keeper.checkPage = { id: target.id, version: work.version, model: selected, page, sources };
            if (keeper.owed.size) {
                throw new Error(keeper.owing);
            }
            keeper.pollPending = false;
            const first = Math.min(target.position, page.verifyFrom ?? target.position,
                ...page.findings.map((finding) => finding.earlier?.position ?? target.position));
            const evidence = sources ?? messages.slice(first - 1, target.position).map((message) => message.position);
            const cited = [...evidence, ...page.findings.map((finding) => finding.earlier?.position ?? target.position)];
            const ids = cited.map((position) => messages[position - 1].id);
            const check = {
                previouslyLimited: keeper.expensiveAfter !== 0,
                cooling: keeper.expensiveAfter > keeper.clock.now(),
                reserve: () => {
                    if (!current()) {
                        return false;
                    }
                    if (!ScribeKeeper.checkSchedule(keeper, true)) {
                        keeper.deferredCheck = { id: target.id, version: work.version,
                            sources: [target.id, messages[first - 1].id, messages.at(-1).id, ...ids] };
                        return false;
                    }
                    return true;
                },
            };
            if (!messages[first - 1] || !await ScribeKeeper.newest(keeper, messages[first - 1].id, target,
                ids, check) || !current()) {
                throw yieldPage;
            }
            const book = durableBook();
            if (ScribeLog.saveCheck(book, keeper.intake.messages, work, page)) {
                ScribeKeeper.store(keeper, ScribeStore.Kind.Book, book);
            } else {
                const latest = ScribeLog.checkWork(book, keeper.intake.messages, false);
                if (latest.message?.id === target.id && latest.version === work.version &&
                    ![...latest.completed, ...latest.segments].some((done) => done.id === page.id)) {
                    keeper.checkPage = null;
                    throw new Error('The Checker result could not be verified against the original passage. The passage remains due.');
                }
            }
            keeper.book = book;
            keeper.checkPage = null;
            keeper.checkProblem = null;
            ScribeKeeper.show(keeper);
            throw yieldPage;
        };
        keeper.flight = 'Checking message #' + target.position;
        keeper.began = keeper.clock.now();
        ScribeKeeper.occupy(keeper, ScribeKeeper.Busy.Checking);
        try {
            if (keeper.checkPage?.id === target.id && keeper.checkPage.version === work.version && keeper.checkPage.model === selected) {
                await save(keeper.checkPage.page, keeper.checkPage.sources);
            }
            keeper.checkPage = null;
            await keeper.checkPassage({
                message: target, written: work.written, earlierClaims: work.earlierClaims, rulings: work.rulings,
                completedPages: work.completed, completedSegments: work.segments, savePage: save, saveSegment: save, learnLimit,
                ...(Number.isSafeInteger(limit?.bytes) && limit.bytes > 0 ? { pageBytes: limit.bytes } : {}),
                ask: async (system, input, sources = []) => {
                    if (!current()) {
                        throw yieldPage;
                    }
                    if (keeper.expensiveAfter === null || keeper.clock.now() < keeper.expensiveAfter) {
                        const ids = [...sources].map((position) => messages[position - 1].id);
                        if (ids.some((id) => keeper.zeta.distant?.(id))) {
                            keeper.deferredCheck = { id: target.id, version: work.version, sources: ids };
                            throw yieldPage;
                        }
                    }
                    const failure = ScribeKeeper.recount(keeper);
                    if (failure || keeper.owed.size || keeper.spentToday >= keeper.settings.budget) {
                        throw new Error(failure ?? keeper.owing ?? "The day's budget is spent");
                    }
                    const answer = await keeper.ask('Pedant', system, input);
                    if (Number.isFinite(answer.cost) && answer.cost > 0) {
                        ScribeKeeper.pay(keeper, answer.cost);
                    }
                    return answer;
                },
            });
        } catch (error) {
            if (error !== yieldPage && !keeper.closed && keeper.epoch === epoch) {
                const mask = ScribeStore.redactor(keeper.storage, credentials);
                keeper.checkProblem = { source: error?.source ?? 'Scribe', reason: mask(ScribeKeeper.words(error)) };
                if (error?.checkerContextFloor && current()) {
                    learnLimit(null, keeper.checkProblem.reason);
                }
                keeper.checkRetryAt = keeper.clock.now() + ScribeKeeper.Settings.RepullMs;
            }
        } finally {
            if (keeper.epoch === epoch && !keeper.closed) {
                keeper.flight = null;
                ScribeKeeper.occupy(keeper, null);
            }
        }
    },

    /**
     * @param {object} keeper
     * @param {string|null} busy
     * @return {void}
     */
    occupy(keeper, busy) {
        if (keeper.busy === busy) {
            return;
        }
        keeper.busy = busy;
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    lose(keeper) {
        keeper.epoch++;
        keeper.reader = false;
        keeper.busy = null;
        keeper.flight = null;
        keeper.phase = ScribeKeeper.Phase.Watching;
        ScribeKeeper.load(keeper);
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
    },

    /**
     * @param {object} keeper
     * @return {Promise<void>}
     */
    async watch(keeper) {
        const before = ScribeKeeper.glance(keeper);
        ScribeKeeper.load(keeper);
        let claimed = false;
        try {
            claimed = ScribeKeeper.claimed(keeper);
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
        }
        if (!claimed) {
            if (ScribeKeeper.glance(keeper) !== before) {
                ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            }
            return;
        }
        keeper.reader = true;
        if (keeper.unloaded !== null) {
            keeper.phase = ScribeKeeper.Phase.Stopped;
            ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            return;
        }
        await ScribeKeeper.begin(keeper);
    },

    /**
     * @param {object} keeper
     * @param {boolean} poll
     * @param {{id: string, fingerprint: string}|null} target
     * @return {Promise<void>}
     */
    async step(keeper, poll = true, target = null) {
        if (keeper.owed.size > ScribeKeeper.Settings.NoCount) {
            ScribeKeeper.repay(keeper);
        }
        if (!keeper.reader) {
            await ScribeKeeper.watch(keeper);
            return;
        }
        let claimed;
        try {
            claimed = ScribeKeeper.claimed(keeper);
        } catch (error) {
            keeper.authorityBlocked = true;
            keeper.problem = ScribeKeeper.words(error);
            ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            return;
        }
        keeper.authorityBlocked = false;
        if (!claimed) {
            ScribeKeeper.lose(keeper);
            return;
        }
        if (keeper.busy !== null || keeper.deciding) {
            if (poll && [ScribeKeeper.Busy.Reading, ScribeKeeper.Busy.Checking].includes(keeper.busy)) {
                keeper.pollPending = true;
            }
            return;
        }
        const epoch = keeper.epoch;
        ScribeKeeper.occupy(keeper, ScribeKeeper.Busy.Looking);
        try {
            let fresh = false;
            const reloading = keeper.unloaded !== null;
            if (reloading && !ScribeKeeper.load(keeper)) {
                return;
            }
            if (keeper.pausing) {
                ScribeKeeper.holdPause(keeper);
                if (keeper.epoch !== epoch) {
                    return;
                }
            }
            if (reloading) {
                fresh = await ScribeKeeper.start(keeper);
            } else {
                ScribeKeeper.counted(keeper);
                const holding = ScribeKeeper.holding(keeper);
                if (!keeper.pullDone || ((holding || keeper.cutShort) && ScribeKeeper.mayRepull(keeper))) {
                    fresh = await ScribeKeeper.history(keeper);
                } else if (!holding) {
                    const requested = target && keeper.intake?.messages.find((message) => message.id === target.id);
                    const first = requested ? Math.min(requested.position, keeper.writtenThrough + 1) : null;
                    const anchor = first ? keeper.intake.messages[Math.max(0, first - 2)].id : null;
                    fresh = await ScribeKeeper.newest(keeper, anchor, null, requested ? [requested.id] : []);
                }
            }
            if (keeper.epoch === epoch && fresh) {
                keeper.pollPending = false;
                const requested = target === null || ScribeKeeper.plan(keeper, target).end > keeper.writtenThrough;
                if (requested && !keeper.checkStretch && ScribeKeeper.due(keeper)) {
                    await ScribeKeeper.read(keeper, target);
                } else if (target === null && poll && !keeper.checkStretch) {
                    await ScribeKeeper.check(keeper);
                }
            }
        } finally {
            if (keeper.epoch === epoch) {
                ScribeKeeper.occupy(keeper, null);
            }
        }
    },

    /**
     * @param {object} keeper
     * @param {boolean} poll
     * @return {Promise<void>}
     */
    async tick(keeper, poll = true) {
        if (keeper.closed) {
            return;
        }
        try {
            await ScribeKeeper.step(keeper, poll);
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
        }
    },

    /**
     * @param {object} keeper
     * @param {Function} run
     * @return {Promise<*>}
     */
    async track(keeper, run) {
        if (keeper.activity !== null) {
            return run();
        }
        let release;
        keeper.activity = new Promise((resolve) => { release = resolve; });
        try {
            return await run();
        } finally {
            keeper.activity = null;
            release();
        }
    },

    /**
     * @param {object} keeper
     * @param {object[]} pulled
     * @param {boolean} complete
     * @return {void}
     */
    observed(keeper, pulled, complete) {
        keeper.historyChecked = true;
        keeper.historyComplete ||= complete;
        keeper.observed++;
        if (keeper.targets.size === 0 || !keeper.compared) {
            return;
        }
        const received = new Set(pulled.map((message) => message.id));
        for (const request of keeper.targets.values()) {
            if (received.has(request.target.id) || complete) {
                const current = keeper.intake.messages.find((message) => message.id === request.target.id);
                request.seen = received.has(request.target.id) ? current?.fingerprint : null;
            }
        }
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    settleTargets(keeper) {
        for (const [key, request] of keeper.targets) {
            const stopped = keeper.closed || !keeper.reader || keeper.epoch !== request.epoch;
            const confirmed = keeper.compared && keeper.historyChecked && !keeper.pollPending && !keeper.authorityBlocked &&
                request.seen !== undefined && keeper.busy !== ScribeKeeper.Busy.Looking &&
                keeper.busy !== ScribeKeeper.Busy.Pulling && keeper.unloaded === null && ScribeKeeper.held(keeper) === null;
            const message = confirmed && keeper.intake?.messages.find((source) => source.id === request.target.id);
            const current = message && request.seen === request.target.fingerprint && message.fingerprint === request.target.fingerprint;
            if (stopped || (confirmed && (!current || message.position <= keeper.writtenThrough))) {
                keeper.targets.delete(key);
                request.resolve(Boolean(!stopped && current));
            }
        }
    },

    /**
     * @param {object} keeper
     * @param {{id: string, fingerprint: string}} target
     * @return {Promise<boolean>}
     */
    catchUp(keeper, target) {
        if (!ScribeKeeper.isObject(target) || typeof target.id !== 'string' || !target.id ||
            typeof target.fingerprint !== 'string' || !target.fingerprint || keeper.closed || !keeper.reader || !keeper.book) {
            return Promise.resolve(false);
        }
        const source = Object.freeze({ id: target.id, fingerprint: target.fingerprint });
        const key = JSON.stringify([source.id, source.fingerprint]);
        const joined = keeper.targets.get(key);
        if (joined) {
            return joined.promise;
        }
        let resolve;
        const promise = new Promise((done) => { resolve = done; });
        const request = { target: source, epoch: keeper.epoch, seen: undefined, promise, resolve };
        keeper.targets.set(key, request);
        if (keeper.busy === ScribeKeeper.Busy.Reading) {
            keeper.pollPending = true;
        }
        const advance = async () => {
            try {
                ScribeKeeper.settleTargets(keeper);
                while (keeper.targets.get(key) === request && keeper.activity !== null) {
                    await Promise.race([keeper.activity, promise]);
                }
                if (keeper.targets.get(key) !== request) {
                    return;
                }
                await ScribeKeeper.track(keeper, async () => {
                    keeper.activeTarget = source;
                    try {
                        await ScribeKeeper.step(keeper, false, source);
                    } finally {
                        keeper.activeTarget = null;
                    }
                });
                ScribeKeeper.settleTargets(keeper);
            } catch (error) {
                keeper.problem = ScribeKeeper.words(error);
            } finally {
                if (keeper.targets.get(key) === request) {
                    keeper.targets.delete(key);
                    resolve(false);
                }
            }
        };
        void advance();
        return promise;
    },

    /**
     * @param {object} keeper
     * @return {void}
     * @throws {Error}
     */
    guard(keeper, duringCheck = false) {
        const messages = ScribeKeeper.Settings.Messages;
        const busy = ScribeKeeper.Busy;
        if (keeper.closed) {
            throw new Error(messages.Closed);
        }
        if (!keeper.reader) {
            throw new Error(messages.Watching);
        }
        if (keeper.unloaded !== null) {
            throw new Error(keeper.unloaded);
        }
        if (keeper.busy === busy.Reading) {
            throw new Error(messages.Reading);
        }
        if (keeper.busy !== null && !(duringCheck && keeper.busy === busy.Checking)) {
            throw new Error(messages.Pulling);
        }
    },

    /**
     * @param {object} keeper
     * @return {void}
     * @throws {Error}
     */
    needBook(keeper) {
        if (keeper.damaged !== null) {
            throw new Error(keeper.damaged);
        }
        if (keeper.book === null) {
            throw new Error(ScribeKeeper.Settings.Messages.NoBook);
        }
    },

    /**
     * @param {object} keeper
     * @return {void}
     * @throws {Error}
     */
    readable(keeper) {
        const hold = ScribeKeeper.held(keeper);
        if (hold !== null) {
            throw new Error(hold);
        }
        if (!keeper.compared) {
            throw new Error(ScribeKeeper.issue(keeper) ?? ScribeKeeper.Settings.Messages.Unsettled);
        }
    },

    /**
     * @param {object} keeper
     * @param {*} given
     * @return {Promise<void>}
     * @throws {Error}
     */
    async adopt(keeper, given) {
        const messages = ScribeKeeper.Settings.Messages;
        ScribeKeeper.guard(keeper);
        const replacing = keeper.mismatch !== null && !keeper.partial;
        if (!replacing) {
            ScribeKeeper.readable(keeper);
        }
        const settings = ScribeKeeper.settle(keeper.settings, given);
        ScribeKeeper.solvent(keeper);
        if (!ScribeKeeper.writable(keeper)) {
            throw new Error(messages.Watching);
        }
        const edition = keeper.edition + ScribeKeeper.Settings.One;
        ScribeKeeper.writeSettings(keeper, settings, null, edition);
        keeper.settings = settings;
        keeper.savedStop = null;
        keeper.kept = [];
        if (replacing) {
            const campaign = { messages: keeper.mismatch, gone: [] };
            try {
                ScribeKeeper.store(keeper, ScribeStore.Kind.Campaign, campaign);
            } catch (error) {
                ScribeKeeper.restoreEdition(keeper);
                ScribeKeeper.reloadCampaign(keeper);
                ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
                throw new Error(ScribeKeeper.words(error));
            }
            keeper.campaign = campaign;
            keeper.historyComplete = false;
            keeper.blank = false;
            keeper.mismatch = null;
            keeper.suspectAt = null;
            keeper.unjoined = false;
            keeper.compared = false;
        }
        const book = { log: ScribeLog.create(), fingerprints: {}, adopted: false };
        try {
            ScribeKeeper.store(keeper, ScribeStore.Kind.Book, book);
        } catch (error) {
            ScribeKeeper.restoreEdition(keeper);
            ScribeKeeper.reloadBook(keeper);
            ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            throw new Error(messages.Unconfirmed);
        }
        keeper.edition = edition;
        keeper.book = book;
        keeper.checkStretch = false;
        keeper.damaged = null;
        keeper.stop = null;
        keeper.retryAt = null;
        keeper.pausing = false;
        if (!keeper.compared) {
            ScribeKeeper.compare(keeper);
            if (!keeper.compared) {
                throw new Error(ScribeKeeper.issue(keeper) ?? messages.Unsettled);
            }
        }
        ScribeKeeper.show(keeper);
        await ScribeKeeper.read(keeper);
    },

    /**
     * @param {object} keeper
     * @return {Promise<void>}
     * @throws {Error}
     */
    async resume(keeper) {
        ScribeKeeper.guard(keeper);
        ScribeKeeper.needBook(keeper);
        ScribeKeeper.readable(keeper);
        ScribeKeeper.solvent(keeper);
        if (!ScribeKeeper.writable(keeper)) {
            throw new Error(ScribeKeeper.Settings.Messages.Watching);
        }
        if (keeper.savedStop !== null) {
            ScribeKeeper.saveStop(keeper, null);
        }
        keeper.pausing = false;
        ScribeKeeper.keepStop(keeper, null, false);
        if (keeper.checkStretch) {
            keeper.phase = ScribeKeeper.Phase.Idle;
            await ScribeKeeper.step(keeper);
            return;
        }
        await ScribeKeeper.read(keeper);
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    rekey(keeper) {
        keeper.checkRetryAt = 0;
        keeper.checkProblem = null;
        const stop = keeper.stop;
        const failed = stop !== null && stop.reason === ScribeAdoption.Stop.Failed;
        if (keeper.closed || !keeper.reader || !failed || keeper.busy === ScribeKeeper.Busy.Reading) {
            return;
        }
        if (!ScribeKeeper.writable(keeper)) {
            return;
        }
        ScribeKeeper.keepStop(keeper, null, false);
        if (keeper.phase === ScribeKeeper.Phase.Stopped) {
            keeper.phase = ScribeKeeper.resting(keeper);
        }
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
    },

    /**
     * @param {object} keeper
     * @return {void}
     * @throws {Error}
     */
    solvent(keeper) {
        if (keeper.owed.size > ScribeKeeper.Settings.NoCount) {
            ScribeKeeper.repay(keeper);
        }
        if (keeper.owed.size > ScribeKeeper.Settings.NoCount) {
            throw new Error(keeper.owing);
        }
    },

    /**
     * @param {object} keeper
     * @return {void}
     * @throws {Error}
     */
    pause(keeper) {
        const messages = ScribeKeeper.Settings.Messages;
        if (keeper.closed) {
            throw new Error(messages.Closed);
        }
        if (!keeper.reader || !ScribeKeeper.writable(keeper)) {
            throw new Error(messages.Watching);
        }
        keeper.pausing = true;
        ScribeKeeper.holdPause(keeper);
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
    },

    /**
     * @param {object} keeper
     * @param {object} book
     * @param {string} flight
     * @return {void}
     * @throws {Error}
     */
    saveBook(keeper, book, flight) {
        const messages = ScribeKeeper.Settings.Messages;
        if (!ScribeKeeper.writable(keeper)) {
            throw new Error(messages.Watching);
        }
        keeper.flight = flight;
        keeper.began = keeper.clock.now();
        try {
            ScribeKeeper.store(keeper, ScribeStore.Kind.Book, book);
        } catch (error) {
            keeper.flight = null;
            ScribeKeeper.reloadBook(keeper);
            ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            throw new Error(messages.Unconfirmed);
        }
        keeper.flight = null;
        keeper.book = book;
        ScribeKeeper.show(keeper);
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
    },

    /**
     * @param {object} keeper
     * @param {object} log
     * @return {object}
     */
    replay(keeper, log) {
        const messages = keeper.intake?.messages ?? [];
        const order = messages.map((message) => message.id);
        return ScribeReplay.run(log, order, null, new Map(messages.map((message) => [message.id, message.fingerprint])), null, null, messages);
    },

    /**
     * @param {object} keeper
     * @param {object} change
     * @return {Promise<void>}
     * @throws {Error}
     */
    async decide(keeper, change) {
        ScribeKeeper.guard(keeper, true);
        ScribeKeeper.needBook(keeper);
        ScribeKeeper.readable(keeper);
        const findings = keeper.checkProgress?.findings ?? [];
        const finding = typeof change?.finding === 'string' && typeof change.version === 'string'
            && findings.find((row) => row.id === change.finding && row.version === change.version);
        if (!finding || !keeper.historyChecked || keeper.deciding || keeper.owed.size) {
            throw new Error('The evidence for this question needs to be checked again. Reopen it in Findings.');
        }
        const record = ScribeLog.checkRecord(finding.record);
        const evidence = new Set([finding.source?.messageId, finding.earlier?.messageId, ...finding.support.map((source) => source.messageId),
            record?.cite, record?.evidence?.messageId].filter(Boolean));
        const messages = keeper.intake.messages;
        const cited = messages.filter((message) => evidence.has(message.id));
        if (!cited.length || cited.length !== evidence.size) {
            throw new Error('The cited messages are unavailable. Refresh this room before ruling.');
        }
        const epoch = keeper.epoch;
        keeper.deciding = true;
        try {
            const latest = cited.at(-1);
            const seen = await ScribeKeeper.newest(keeper, cited[0].id, latest, cited.map((message) => message.id));
            if (!seen || keeper.epoch !== epoch || keeper.closed || !ScribeKeeper.writable(keeper)) {
                throw new Error('The cited messages could not be confirmed. Refresh the question and try again.');
            }
            ScribeKeeper.guard(keeper, true);
            ScribeKeeper.readable(keeper);
            const saved = ScribeKeeper.readKind(keeper, ScribeStore.Kind.Book);
            if (saved.damage || !saved.value || !ScribeKeeper.soundBook(saved.value)) {
                throw new Error(saved.damage ?? ScribeKeeper.damagedBook());
            }
            const book = saved.value;
            ScribeLog.ruleFinding(book, ScribeKeeper.replay(keeper, book.log), keeper.intake.messages, change, ScribeKnowledge.shareableFinding);
            ScribeKeeper.saveBook(keeper, book, ScribeKeeper.Settings.Flight.Ruling);
        } finally {
            keeper.deciding = false;
        }
    },

    /**
     * @param {object} keeper
     * @param {Function} change
     * @return {Promise<void>}
     * @throws {Error}
     */
    async ruling(keeper, change) {
        ScribeKeeper.guard(keeper, true);
        ScribeKeeper.needBook(keeper);
        const log = ScribeKeeper.copy(keeper.book.log);
        if (change(log, ScribeKeeper.replay(keeper, log)) === null) {
            return;
        }
        const book = { ...keeper.book, log };
        ScribeKeeper.saveBook(keeper, book, ScribeKeeper.Settings.Flight.Ruling);
    },

    /**
     * @param {object} keeper
     * @param {*} operations
     * @param {*} anchor
     * @return {{ log: object, result: Readonly<{ entry: object, refused: ReadonlyArray<Readonly<{ operation: object, reason: string }>> }> }|null}
     * @throws {Error}
     */
    draft(keeper, operations, anchor) {
        const settings = ScribeKeeper.Settings;
        ScribeKeeper.guard(keeper, true);
        ScribeKeeper.needBook(keeper);
        if (!Array.isArray(operations)) {
            throw new Error(settings.Messages.BadOperations);
        }
        let cited = null;
        if (ScribeKeeper.isObject(anchor) && keeper.intake !== null) {
            for (const message of keeper.intake.messages) {
                if (message.id === String(anchor.id) && !message.attributionPending && Object.hasOwn(keeper.book.log.read, message.id)) {
                    cited = message;
                }
            }
        }
        if (cited === null) {
            throw new Error(settings.Messages.BadAnchor);
        }
        if (operations.length === settings.NoCount) {
            return null;
        }
        const log = ScribeKeeper.copy(keeper.book.log);
        const stretch = { messages: keeper.intake.messages.slice(0, cited.position), origin: ScribeLog.Origin.Notes };
        let result = null;
        try {
            result = ScribeLog.append(log, keeper.state, operations, stretch);
        } catch (error) {
            if (ScribeKeeper.words(error) !== ScribeLog.Settings.StaleState) {
                throw error;
            }
            result = ScribeLog.append(log, ScribeKeeper.replay(keeper, log), operations, stretch);
        }
        return { log, result };
    },

    /**
     * @param {object} keeper
     * @param {*} operations
     * @param {*} anchor
     * @param {readonly object[]|null} resolution
     * @return {Promise<ReadonlyArray<Readonly<{ operation: object, reason: string }>>>}
     * @throws {Error}
     */
    async file(keeper, operations, anchor, resolution = null) {
        const settings = ScribeKeeper.Settings;
        const drafted = ScribeKeeper.draft(keeper, operations, anchor);
        if (drafted === null) {
            return Object.freeze([]);
        }
        if (drafted.result.entry.operations.length === settings.NoCount) {
            return drafted.result.refused;
        }
        ScribeLog.link(drafted.result.entry, keeper.state, resolution ?? [], keeper.intake.messages);
        const book = { ...keeper.book, log: drafted.log };
        ScribeKeeper.saveBook(keeper, book, settings.Flight.Filing);
        return drafted.result.refused;
    },

    /**
     * @param {object} keeper
     * @param {*} operations
     * @param {*} anchor
     * @return {Promise<Readonly<{ before: object, state: object, refused: ReadonlyArray<Readonly<{ operation: object, reason: string }>> }>>}
     * @throws {Error}
     */
    async preview(keeper, operations, anchor) {
        const drafted = ScribeKeeper.draft(keeper, operations, anchor);
        const before = ScribeKeeper.replay(keeper, keeper.book.log);
        if (drafted === null) {
            return Object.freeze({ before, state: before, refused: Object.freeze([]) });
        }
        if (drafted.result.entry.operations.length === ScribeKeeper.Settings.NoCount) {
            return Object.freeze({ before, state: before, refused: drafted.result.refused });
        }
        const state = ScribeKeeper.replay(keeper, drafted.log);
        return Object.freeze({ before, state, refused: drafted.result.refused });
    },

    /**
     * @param {object} keeper
     * @param {*} given
     * @return {Promise<void>}
     * @throws {Error}
     */
    async configure(keeper, given) {
        ScribeKeeper.guard(keeper, true);
        const settings = ScribeKeeper.settle(keeper.settings, given);
        if (!ScribeKeeper.writable(keeper)) {
            throw new Error(ScribeKeeper.Settings.Messages.Watching);
        }
        ScribeKeeper.writeSettings(keeper, settings, keeper.savedStop, keeper.edition);
        keeper.settings = settings;
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    close(keeper) {
        if (keeper.closed) {
            return;
        }
        keeper.closed = true;
        keeper.epoch++;
        keeper.busy = null;
        keeper.flight = null;
        keeper.kept = [];
        if (keeper.claim === null && (keeper.reader || keeper.lease !== null)) {
            try {
                ScribeStore.release(keeper.storage, keeper.roomId, keeper.tabId);
            } catch (error) {
                keeper.problem = ScribeKeeper.words(error);
            }
        }
        keeper.reader = false;
        ScribeKeeper.settleTargets(keeper);
    },

    /**
     * @param {object} keeper
     * @return {Readonly<object>}
     */
    handle(keeper) {
        return Object.freeze({
            /**
             * @return {Readonly<object>}
             */
            view: () => ScribeKeeper.view(keeper),

            /**
             * @return {void}
             */
            attributionChanged: () => {
                keeper.compared = false;
            },

            /**
             * @param {*} settings
             * @return {Promise<void>}
             */
            adopt: (settings) => ScribeKeeper.track(keeper, () => ScribeKeeper.adopt(keeper, settings)),

            /**
             * @return {Promise<void>}
             */
            resume: () => ScribeKeeper.track(keeper, () => ScribeKeeper.resume(keeper)),

            /**
             * @param {{id: string, fingerprint: string}} target
             * @return {Promise<boolean>}
             */
            catchUp: (target) => ScribeKeeper.catchUp(keeper, target),

            /**
             * @return {void}
             * @throws {Error}
             */
            pause: () => {
                ScribeKeeper.pause(keeper);
            },

            /**
             * @return {void}
             */
            rekey: () => {
                ScribeKeeper.rekey(keeper);
            },

            /**
             * @param {boolean} poll
             * @return {Promise<void>}
             */
            tick: (poll = true) => ScribeKeeper.track(keeper, () => ScribeKeeper.tick(keeper, poll)),

            /**
             * @return {Promise<void>}
             */
            pull: () => ScribeKeeper.track(keeper, async () => {
                ScribeKeeper.guard(keeper);
                const epoch = keeper.epoch;
                ScribeKeeper.occupy(keeper, ScribeKeeper.Busy.Pulling);
                try {
                    await ScribeKeeper.history(keeper);
                } finally {
                    if (keeper.epoch === epoch) {
                        ScribeKeeper.occupy(keeper, null);
                    }
                }
            }),

            /**
             * @param {object} operation
             * @param {readonly object[]|null} resolution
             * @return {Promise<void>}
             */
            rule: (operation, resolution = null) =>
                ScribeKeeper.ruling(
                    keeper,
                    /**
                     * @param {object} log
                     * @param {object} state
                     * @return {object}
                     */
                    (log, state) => {
                        const entry = ScribeLog.rule(log, state, operation);
                        if (entry !== null) {
                            ScribeLog.link(entry, state, resolution ?? [], keeper.intake?.messages ?? []);
                        }
                        return entry;
                    },
                ),

            /**
             * @param {object} change
             * @return {Promise<void>}
             */
            ruling: (change) => ScribeKeeper.decide(keeper, change),

            /**
             * @param {readonly object[]|null} resolution
             * @return {Promise<void>}
             */
            keepFirst: (resolution = null) =>
                ScribeKeeper.ruling(
                    keeper,
                    /**
                     * @param {object} log
                     * @param {object} state
                     * @return {readonly object[]}
                     */
                    (log, state) => {
                        const entries = ScribeLog.keepFirst(log, state);
                        for (const entry of entries) {
                            ScribeLog.link(entry, state, resolution ?? [], keeper.intake?.messages ?? []);
                        }
                        return entries;
                    },
                ),

            /**
             * @param {number} sequence
             * @return {Promise<void>}
             */
            revoke: (sequence) =>
                ScribeKeeper.ruling(
                    keeper,
                    /**
                     * @param {object} log
                     * @return {object|null}
                     */
                    (log) => ScribeLog.revoke(log, sequence),
                ),

            /**
             * @param {object[]} operations
             * @param {{ id: string, position: number }} anchor
             * @param {readonly object[]|null} resolution
             * @return {Promise<ReadonlyArray<Readonly<{ operation: object, reason: string }>>>}
             */
            file: (operations, anchor, resolution = null) => ScribeKeeper.file(keeper, operations, anchor, resolution),

            /**
             * @param {object[]} operations
             * @param {{ id: string, position: number }} anchor
             * @return {Promise<Readonly<{ before: object, state: object, refused: ReadonlyArray<Readonly<{ operation: object, reason: string }>> }>>}
             */
            preview: (operations, anchor) => ScribeKeeper.preview(keeper, operations, anchor),

            /**
             * @param {*} settings
             * @return {Promise<void>}
             */
            configure: (settings) => ScribeKeeper.configure(keeper, settings),

            /**
             * @return {void}
             */
            close: () => {
                ScribeKeeper.close(keeper);
            },
        });
    },

    /**
     * @param {{ storage: { get: Function, set: Function, remove: Function, list: Function }, roomId: string, tabId: string, zeta: { history: Function, newest: Function }, ask: Function, clock: { now: Function, today: Function }, notify: Function, claim?: () => boolean, lease?: () => boolean, profile?: () => Promise<string|null> }} options
     * @return {Promise<Readonly<object>>}
     * @throws {Error}
     */
    async open(options) {
        const { storage, roomId, tabId, zeta, ask, clock, notify } = options;
        const settings = ScribeKeeper.Settings;
        const claim = options.claim === undefined || options.claim === null ? null : options.claim;
        if (claim !== null && typeof claim !== settings.FunctionType) {
            throw new Error(settings.Messages.BadClaim);
        }
        const lease = options.lease === undefined || options.lease === null ? null : options.lease;
        if (lease !== null && typeof lease !== settings.FunctionType) {
            throw new Error(settings.Messages.BadClaim);
        }
        const profile = options.profile === undefined || options.profile === null ? null : options.profile;
        if (profile !== null && typeof profile !== settings.FunctionType) {
            throw new Error(settings.Messages.BadProfile);
        }
        const keeper = {
            storage,
            roomId,
            tabId,
            zeta,
            ask,
            checkPassage: options.checkPassage ?? null,
            checkProgress: null,
            deciding: false,
            checkPage: null,
            checkProblem: null,
            checkRetryAt: 0,
            checkAfterKey: ScribeStore.name(ScribeStore.Settings.Types.CheckAfter, ScribeStore.room(roomId)),
            expensiveAfter: 0,
            scheduleReadAt: 0,
            deferredCheck: null,
            clock,
            notify,
            claim,
            lease,
            profile,
            phase: ScribeKeeper.Phase.Loading,
            reader: false,
            authorityBlocked: false,
            closed: false,
            epoch: settings.FirstEpoch,
            targets: new Map(),
            activeTarget: null,
            activity: null,
            settings: ScribeKeeper.Defaults,
            savedStop: null,
            stop: null,
            retryAt: null,
            pausing: false,
            campaign: { messages: [], gone: [] },
            blank: true,
            intake: null,
            compared: false,
            newest: null,
            book: null,
            damaged: null,
            unloaded: null,
            pullDone: false,
            partial: false,
            cutShort: false,
            unjoined: false,
            suspectAt: null,
            mismatch: null,
            kept: [],
            owed: new Map(),
            owing: null,
            pulledAt: null,
            lastPull: null,
            historyChecked: false,
            historyComplete: false,
            observed: 0,
            pollPending: false,
            checkStretch: false,
            cut: null,
            state: null,
            read: settings.NoCount,
            unread: Object.freeze([]),
            lastRead: null,
            made: Object.freeze([]),
            busy: null,
            flight: null,
            began: null,
            problem: null,
            calls: [],
            lines: [],
            spentToday: settings.NoSpending,
            edition: settings.NoEdition,
        };
        ScribeKeeper.show(keeper);
        try {
            keeper.reader = ScribeKeeper.claimed(keeper);
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
        }
        ScribeKeeper.load(keeper);
        if (!keeper.reader) {
            keeper.phase = ScribeKeeper.Phase.Watching;
        } else if (keeper.unloaded !== null) {
            keeper.phase = ScribeKeeper.Phase.Stopped;
        } else {
            ScribeKeeper.track(keeper, () => ScribeKeeper.begin(keeper)).catch(
                /**
                 * @param {*} error
                 * @return {void}
                 */
                (error) => {
                    keeper.problem = ScribeKeeper.words(error);
                },
            );
        }
        return ScribeKeeper.handle(keeper);
    },
});
