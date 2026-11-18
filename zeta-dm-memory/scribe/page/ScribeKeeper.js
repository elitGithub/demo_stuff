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
        Pulling: 'Pulling',
        Reading: 'Reading',
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
        }),
        Flight: Object.freeze({
            PullOpen: 'Pulling the chat: ',
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
        return Object.freeze({ reason: value.reason, problem: value.problem });
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
     * @return {{ intake: Readonly<{ messages: readonly object[], notes: readonly object[], player: string }>|null, disorder: string|null }}
     */
    take(rawMessages) {
        const messages = ScribeKeeper.Settings.Messages;
        try {
            return { intake: ScribeIntake.read(rawMessages), disorder: null };
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
     * @param {Readonly<{ questions: readonly object[] }>} state
     * @return {boolean}
     */
    answered(state) {
        return state.questions.some(
            /**
             * @param {{ answer: string|null, dismissed: boolean }} question
             * @return {boolean}
             */
            (question) => question.answer !== null && !question.dismissed,
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
        const order = [];
        const unread = [];
        let lastRead = null;
        for (const message of messages) {
            order.push(message.id);
            if (Object.hasOwn(log.read, message.id)) {
                lastRead = Object.freeze({ id: message.id, position: message.position });
            } else {
                unread.push(message);
            }
        }
        keeper.state = ScribeReplay.run(log, order);
        keeper.read = messages.length - unread.length;
        keeper.unread = Object.freeze(unread);
        keeper.lastRead = lastRead;
        keeper.made = Object.freeze([]);
        if (typeof BenchView !== ScribeKeeper.Settings.UndefinedType) {
            keeper.made = Object.freeze(
                BenchView.made(log).map(
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
     * @return {Readonly<object>}
     */
    view(keeper) {
        const messages = keeper.intake === null ? Object.freeze([]) : keeper.intake.messages;
        ScribeKeeper.recount(keeper);
        return Object.freeze({
            phase: keeper.phase,
            roomId: keeper.roomId,
            reader: keeper.reader,
            total: messages.length,
            settled: Math.max(messages.length - 1, ScribeKeeper.Settings.NoCount),
            read: keeper.read,
            unread: keeper.unread,
            lastRead: keeper.lastRead,
            made: keeper.made,
            state: keeper.state,
            messages,
            player: keeper.intake === null ? ScribeIntake.Settings.UnknownPlayer : keeper.intake.player,
            settings: keeper.settings,
            spentToday: keeper.spentToday,
            flight: keeper.flight,
            began: keeper.flight === null ? null : keeper.began,
            stop: keeper.stop,
            pulled: keeper.lastPull,
            mismatch: keeper.mismatch !== null,
            trusted: keeper.reader && keeper.unloaded === null && keeper.book !== null && keeper.book.adopted && ScribeKeeper.held(keeper) === null,
            edition: keeper.edition,
            calls: Object.freeze([...keeper.calls]),
            lines: Object.freeze([...keeper.lines]),
            problem:
                keeper.unloaded ??
                keeper.problem ??
                (keeper.blank ? null : ScribeKeeper.held(keeper)) ??
                (keeper.owed.size === ScribeKeeper.Settings.NoCount ? null : keeper.owing) ??
                keeper.damaged ??
                keeper.cut,
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
        keeper.campaign = { messages, gone };
        keeper.compared = false;
        const taken = ScribeKeeper.take(messages);
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
        try {
            keeper.spentToday = ScribeStore.spent(keeper.storage, keeper.roomId, keeper.clock.today()) + ScribeKeeper.owedToday(keeper);
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
            keeper.spentToday = total + ScribeKeeper.owedToday(keeper);
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
        if (keeper.claim !== null) {
            return keeper.claim() === true;
        }
        return ScribeStore.claim(keeper.storage, keeper.roomId, keeper.tabId, keeper.clock.now());
    },

    /**
     * @param {object} keeper
     * @return {boolean}
     * @throws {Error}
     */
    still(keeper) {
        if (keeper.claim !== null) {
            return keeper.claim() === true;
        }
        const name = ScribeStore.name(ScribeStore.Settings.Types.Claim, ScribeStore.room(keeper.roomId));
        const held = ScribeStore.claimOf(ScribeStore.fetch(keeper.storage, name));
        return held !== null && held.tabId === keeper.tabId;
    },

    /**
     * @param {object} keeper
     * @return {boolean}
     */
    writable(keeper) {
        let still = true;
        try {
            still = ScribeKeeper.still(keeper);
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
        }
        if (!still) {
            ScribeKeeper.lose(keeper);
        }
        return still;
    },

    /**
     * @param {object} keeper
     * @param {readonly object[]} messages
     * @return {{ log: object, fingerprints: Object<string, string>, adopted: boolean }|null}
     * @throws {Error}
     */
    withdrawn(keeper, messages) {
        const book = keeper.book;
        const present = new Set();
        for (const message of messages) {
            present.add(message.id);
        }
        const known = [];
        for (const id of Object.keys(book.log.read)) {
            known.push({ id, fingerprint: book.fingerprints[id] });
        }
        const targets = ScribeIntake.changed(known, messages).withdrawn.filter(
            /**
             * @param {string} id
             * @return {boolean}
             */
            (id) => present.has(id),
        );
        for (const id of keeper.campaign.gone) {
            if (Object.hasOwn(book.log.read, id)) {
                targets.push(id);
            }
        }
        if (targets.length === ScribeKeeper.Settings.NoCount) {
            return null;
        }
        const log = ScribeKeeper.copy(book.log);
        const fingerprints = { ...book.fingerprints };
        for (const id of targets) {
            const freed = ScribeLog.withdraw(log, id);
            if (freed !== null) {
                for (const freedId of freed) {
                    delete fingerprints[freedId];
                }
            }
        }
        return { log, fingerprints, adopted: book.adopted };
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    compare(keeper) {
        const settings = ScribeKeeper.Settings;
        const taken = ScribeKeeper.take(keeper.campaign.messages);
        keeper.compared = false;
        if (taken.intake === null) {
            keeper.problem = taken.disorder;
            return;
        }
        if (keeper.book !== null) {
            let changed = null;
            try {
                changed = ScribeKeeper.withdrawn(keeper, taken.intake.messages);
            } catch (error) {
                ScribeKeeper.damage(keeper);
                return;
            }
            if (changed !== null) {
                if (!ScribeKeeper.writable(keeper)) {
                    return;
                }
                try {
                    ScribeStore.write(keeper.storage, keeper.roomId, ScribeStore.Kind.Book, changed);
                } catch (error) {
                    keeper.problem = ScribeKeeper.words(error);
                    ScribeKeeper.reloadBook(keeper);
                    return;
                }
                keeper.book = changed;
            }
        }
        const gone = keeper.campaign.gone;
        if (gone.length > settings.NoCount && (keeper.book !== null || keeper.damaged === null)) {
            if (!ScribeKeeper.writable(keeper)) {
                return;
            }
            const cleared = { messages: keeper.campaign.messages, gone: [] };
            try {
                ScribeStore.write(keeper.storage, keeper.roomId, ScribeStore.Kind.Campaign, cleared);
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
     * @return {boolean}
     */
    absorb(keeper, rawMessages, gone) {
        if (!ScribeKeeper.writable(keeper)) {
            return false;
        }
        const campaign = { messages: rawMessages, gone };
        try {
            ScribeStore.write(keeper.storage, keeper.roomId, ScribeStore.Kind.Campaign, campaign);
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
            ScribeKeeper.reloadCampaign(keeper);
            return false;
        }
        keeper.campaign = campaign;
        keeper.blank = false;
        keeper.problem = null;
        ScribeKeeper.compare(keeper);
        return true;
    },

    /**
     * @param {object[]} saved
     * @param {object[]} pulled
     * @param {boolean} keepAll
     * @return {{ messages: object[], removed: string[], joined: boolean, shared: boolean, changed: boolean }}
     */
    merge(saved, pulled, keepAll) {
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
        const removed = [];
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
        return { messages: [...saved.slice(0, join), ...tail], removed, joined: true, shared: true, changed };
    },

    /**
     * @param {object} keeper
     * @param {object[]} pulled
     * @param {boolean} keepAll
     * @return {{ fresh: boolean, joined: boolean, shared: boolean, changed: boolean }}
     */
    takeIn(keeper, pulled, keepAll) {
        const merged = ScribeKeeper.merge(keeper.campaign.messages, pulled, keepAll);
        if (!merged.joined) {
            return { fresh: false, joined: false, shared: false, changed: false };
        }
        if (!merged.changed) {
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
        const fresh = ScribeKeeper.absorb(keeper, merged.messages, gone);
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
     * @return {Promise<boolean>}
     */
    async history(keeper) {
        const settings = ScribeKeeper.Settings;
        const flight = settings.Flight;
        const epoch = keeper.epoch;
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
                        keeper.flight = flight.PullOpen + count + flight.PullClose;
                        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
                    }
                },
            );
        } catch (error) {
            if (keeper.epoch === epoch) {
                keeper.problem = ScribeKeeper.words(error);
            }
        }
        if (keeper.epoch !== epoch) {
            return false;
        }
        keeper.flight = null;
        if (result === null) {
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
        const taken = ScribeKeeper.takeIn(keeper, pulled, result.skipped > settings.NoCount);
        if (keeper.epoch !== epoch) {
            return false;
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
     * @return {Promise<boolean>}
     */
    async newest(keeper) {
        const epoch = keeper.epoch;
        const before = keeper.problem;
        keeper.flight = ScribeKeeper.Settings.Flight.Looking;
        keeper.began = keeper.clock.now();
        let page = null;
        try {
            page = await keeper.zeta.newest();
        } catch (error) {
            if (keeper.epoch === epoch) {
                keeper.problem = ScribeKeeper.words(error);
            }
        }
        if (keeper.epoch !== epoch) {
            return false;
        }
        keeper.flight = null;
        if (page === null) {
            if (keeper.problem !== before) {
                ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            }
            return false;
        }
        keeper.problem = null;
        const taken = ScribeKeeper.takeIn(keeper, ScribeKeeper.single(page.messages), page.skipped > ScribeKeeper.Settings.NoCount);
        if (keeper.epoch !== epoch) {
            return false;
        }
        if (!taken.joined) {
            keeper.unjoined = true;
            if (ScribeKeeper.mayRepull(keeper)) {
                return ScribeKeeper.history(keeper);
            }
            ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            return false;
        }
        if (taken.shared) {
            keeper.suspectAt = null;
        }
        const skipped = ScribeKeeper.skippedWords(page.skipped);
        if (skipped !== null) {
            keeper.problem = skipped;
        }
        if (taken.changed || keeper.problem !== before) {
            ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
        }
        return taken.fresh;
    },

    /**
     * @param {object} keeper
     * @return {{ settled: readonly object[], end: number }}
     */
    plan(keeper) {
        const settings = ScribeKeeper.Settings;
        const settled = keeper.intake.messages.slice(0, settings.Last);
        const read = keeper.book.log.read;
        if (!keeper.book.adopted) {
            return { settled, end: settled.length };
        }
        const size = keeper.settings.size;
        let end = settings.NoCount;
        let lastRead = settings.NotFound;
        let runStart = settings.NotFound;
        for (let index = 0; index <= settled.length; index++) {
            const closing = index === settled.length || Object.hasOwn(read, settled[index].id);
            if (!closing) {
                if (runStart === settings.NotFound) {
                    runStart = index;
                }
                continue;
            }
            if (index < settled.length) {
                lastRead = index;
            }
            if (runStart !== settings.NotFound) {
                const length = index - runStart;
                const taken = index === settled.length ? Math.floor(length / size) * size : length;
                if (taken > settings.NoCount) {
                    end = runStart + taken;
                }
                runStart = settings.NotFound;
            }
        }
        if (ScribeKeeper.answered(keeper.state)) {
            end = Math.max(end, lastRead + 1);
        }
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
        if (!book.adopted || ScribeKeeper.answered(keeper.state)) {
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
        if (ScribeKeeper.answered(keeper.state)) {
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
        ScribeStore.write(keeper.storage, keeper.roomId, ScribeStore.Kind.Settings, { ...settings, stop, edition });
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
     * @return {Promise<void>}
     */
    async read(keeper) {
        const settings = ScribeKeeper.Settings;
        const stops = ScribeAdoption.Stop;
        const epoch = keeper.epoch;
        const book = keeper.book;
        const size = keeper.settings.size;
        const { settled, end } = ScribeKeeper.plan(keeper);
        const chosen = settled.slice(0, end);
        const notes = keeper.intake.notes.filter(
            /**
             * @param {{ position: number }} note
             * @return {boolean}
             */
            (note) => note.position <= end,
        );
        const prints = new Map();
        for (const message of keeper.intake.messages) {
            prints.set(message.id, message.fingerprint);
        }
        const job = { recorded: settings.NoSpending, saveFailed: false, storage: false };
        keeper.busy = ScribeKeeper.Busy.Reading;
        keeper.phase = ScribeKeeper.Phase.Reading;
        keeper.flight = ScribeKeeper.reading(keeper, chosen);
        keeper.began = keeper.clock.now();
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
        let result = null;
        try {
            job.recorded = ScribeStore.spent(keeper.storage, keeper.roomId, keeper.clock.today());
            result = await ScribeAdoption.run({
                messages: chosen,
                notes,
                player: keeper.intake.player,
                log: book.log,
                size,
                budget: keeper.settings.budget,
                spent: job.recorded,
                /**
                 * @param {string} system
                 * @param {string} user
                 * @return {Promise<{ text: string, cost: * }>}
                 */
                ask: async (system, user) => {
                    const key = JSON.stringify([system, user]);
                    const found = keeper.kept.find(
                        /**
                         * @param {{ key: string }} answer
                         * @return {boolean}
                         */
                        (answer) => answer.key === key,
                    );
                    if (found !== undefined) {
                        return { text: found.text, cost: settings.NoSpending };
                    }
                    const answer = await keeper.ask(settings.Role, system, user);
                    if (!keeper.closed) {
                        keeper.kept.push({ key, text: answer.text });
                        keeper.kept.splice(settings.NoCount, Math.max(keeper.kept.length - settings.KeptAnswers, settings.NoCount));
                    }
                    return answer;
                },
                /**
                 * @param {object} log
                 * @return {Promise<void>}
                 * @throws {Error}
                 */
                save: async (log) => {
                    if (keeper.epoch !== epoch || !ScribeKeeper.writable(keeper)) {
                        throw new Error(settings.Messages.ThrownAway);
                    }
                    const fingerprints = {};
                    for (const id of Object.keys(log.read)) {
                        fingerprints[id] = prints.has(id) ? prints.get(id) : book.fingerprints[id];
                    }
                    try {
                        ScribeStore.write(keeper.storage, keeper.roomId, ScribeStore.Kind.Book, {
                            log,
                            fingerprints,
                            adopted: book.adopted,
                        });
                    } catch (error) {
                        job.saveFailed = true;
                        job.storage = true;
                        throw error;
                    }
                    book.fingerprints = fingerprints;
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
                    calls.unshift(item);
                    for (let index = calls.length - 1; index >= 0 && calls.length > settings.LastCalls; index--) {
                        if (calls[index].readable) {
                            calls.splice(index, 1);
                        }
                    }
                },
                /**
                 * @param {{ spent: number }} report
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
                    keeper.lines.unshift(report);
                    keeper.lines.splice(settings.LastLines);
                    keeper.flight = ScribeKeeper.reading(keeper, chosen);
                    keeper.began = keeper.clock.now();
                    ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Progress });
                },
                /**
                 * @return {boolean}
                 */
                paused: () => keeper.pausing || keeper.epoch !== epoch,
            });
        } catch (error) {
            job.storage = true;
            result = { stop: stops.Failed, problem: ScribeKeeper.words(error), spent: job.recorded };
        }
        let stop = result.stop;
        let problem = result.problem;
        const unrecorded = result.spent - job.recorded;
        if (unrecorded > settings.NoSpending) {
            ScribeKeeper.pay(keeper, unrecorded);
        }
        if (keeper.epoch !== epoch) {
            return;
        }
        if (job.saveFailed) {
            ScribeKeeper.reloadBook(keeper);
        }
        if (stop === stops.Done && !book.adopted && keeper.book === book) {
            if (!ScribeKeeper.writable(keeper)) {
                return;
            }
            const finished = { log: book.log, fingerprints: book.fingerprints, adopted: true };
            try {
                ScribeStore.write(keeper.storage, keeper.roomId, ScribeStore.Kind.Book, finished);
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
        keeper.busy = null;
        keeper.flight = null;
        ScribeKeeper.keepStop(keeper, Object.freeze({ reason: stop, problem }), job.storage);
        if (keeper.epoch !== epoch) {
            return;
        }
        keeper.phase = stop === stops.Done ? ScribeKeeper.Phase.Idle : ScribeKeeper.Phase.Stopped;
        if (keeper.unloaded === null) {
            ScribeKeeper.show(keeper);
        }
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
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
        keeper.busy = ScribeKeeper.Busy.Pulling;
        try {
            await ScribeKeeper.start(keeper);
        } finally {
            if (keeper.epoch === epoch) {
                keeper.busy = null;
            }
        }
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
     * @return {Promise<void>}
     */
    async step(keeper) {
        if (keeper.owed.size > ScribeKeeper.Settings.NoCount) {
            ScribeKeeper.repay(keeper);
        }
        if (!keeper.reader) {
            await ScribeKeeper.watch(keeper);
            return;
        }
        let claimed = true;
        try {
            claimed = ScribeKeeper.claimed(keeper);
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
        }
        if (!claimed) {
            ScribeKeeper.lose(keeper);
            return;
        }
        if (keeper.busy !== null) {
            return;
        }
        const epoch = keeper.epoch;
        keeper.busy = ScribeKeeper.Busy.Pulling;
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
                    fresh = await ScribeKeeper.newest(keeper);
                }
            }
            if (keeper.epoch === epoch && fresh && ScribeKeeper.due(keeper)) {
                await ScribeKeeper.read(keeper);
            }
        } finally {
            if (keeper.epoch === epoch) {
                keeper.busy = null;
            }
        }
    },

    /**
     * @param {object} keeper
     * @return {Promise<void>}
     */
    async tick(keeper) {
        if (keeper.closed) {
            return;
        }
        try {
            await ScribeKeeper.step(keeper);
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
        }
    },

    /**
     * @param {object} keeper
     * @return {void}
     * @throws {Error}
     */
    guard(keeper) {
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
        if (keeper.busy === busy.Pulling) {
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
            throw new Error(keeper.problem ?? ScribeKeeper.Settings.Messages.Unsettled);
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
                ScribeStore.write(keeper.storage, keeper.roomId, ScribeStore.Kind.Campaign, campaign);
            } catch (error) {
                ScribeKeeper.restoreEdition(keeper);
                ScribeKeeper.reloadCampaign(keeper);
                ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
                throw new Error(ScribeKeeper.words(error));
            }
            keeper.campaign = campaign;
            keeper.blank = false;
            keeper.mismatch = null;
            keeper.suspectAt = null;
            keeper.unjoined = false;
            keeper.compared = false;
        }
        const book = { log: ScribeLog.create(), fingerprints: {}, adopted: false };
        try {
            ScribeStore.write(keeper.storage, keeper.roomId, ScribeStore.Kind.Book, book);
        } catch (error) {
            ScribeKeeper.restoreEdition(keeper);
            ScribeKeeper.reloadBook(keeper);
            ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            throw new Error(messages.Unconfirmed);
        }
        keeper.edition = edition;
        keeper.book = book;
        keeper.damaged = null;
        keeper.stop = null;
        keeper.retryAt = null;
        keeper.pausing = false;
        if (!keeper.compared) {
            ScribeKeeper.compare(keeper);
            if (!keeper.compared) {
                throw new Error(keeper.problem ?? messages.Unsettled);
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
        await ScribeKeeper.read(keeper);
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
            ScribeStore.write(keeper.storage, keeper.roomId, ScribeStore.Kind.Book, book);
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
     * @return {string[]}
     */
    order(keeper) {
        const order = [];
        if (keeper.intake !== null) {
            for (const message of keeper.intake.messages) {
                order.push(message.id);
            }
        }
        return order;
    },

    /**
     * @param {object} keeper
     * @param {(log: object, state: object) => *} change
     * @return {Promise<void>}
     * @throws {Error}
     */
    async ruling(keeper, change) {
        ScribeKeeper.guard(keeper);
        ScribeKeeper.needBook(keeper);
        const log = ScribeKeeper.copy(keeper.book.log);
        if (change(log, ScribeReplay.run(log, ScribeKeeper.order(keeper))) === null) {
            return;
        }
        const book = { log, fingerprints: keeper.book.fingerprints, adopted: keeper.book.adopted };
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
        ScribeKeeper.guard(keeper);
        ScribeKeeper.needBook(keeper);
        if (!Array.isArray(operations)) {
            throw new Error(settings.Messages.BadOperations);
        }
        let cited = null;
        if (ScribeKeeper.isObject(anchor) && keeper.intake !== null) {
            for (const message of keeper.intake.messages) {
                if (message.id === String(anchor.id) && Object.hasOwn(keeper.book.log.read, message.id)) {
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
            result = ScribeLog.append(log, ScribeReplay.run(log, ScribeKeeper.order(keeper)), operations, stretch);
        }
        return { log, result };
    },

    /**
     * @param {object} keeper
     * @param {*} operations
     * @param {*} anchor
     * @return {Promise<ReadonlyArray<Readonly<{ operation: object, reason: string }>>>}
     * @throws {Error}
     */
    async file(keeper, operations, anchor) {
        const settings = ScribeKeeper.Settings;
        const drafted = ScribeKeeper.draft(keeper, operations, anchor);
        if (drafted === null) {
            return Object.freeze([]);
        }
        if (drafted.result.entry.operations.length === settings.NoCount) {
            return drafted.result.refused;
        }
        const book = { log: drafted.log, fingerprints: keeper.book.fingerprints, adopted: keeper.book.adopted };
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
        const order = ScribeKeeper.order(keeper);
        const before = ScribeReplay.run(keeper.book.log, order);
        if (drafted === null) {
            return Object.freeze({ before, state: before, refused: Object.freeze([]) });
        }
        if (drafted.result.entry.operations.length === ScribeKeeper.Settings.NoCount) {
            return Object.freeze({ before, state: before, refused: drafted.result.refused });
        }
        const state = ScribeReplay.run(drafted.log, order);
        return Object.freeze({ before, state, refused: drafted.result.refused });
    },

    /**
     * @param {object} keeper
     * @param {*} given
     * @return {Promise<void>}
     * @throws {Error}
     */
    async configure(keeper, given) {
        ScribeKeeper.guard(keeper);
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
        if (keeper.reader && keeper.claim === null) {
            try {
                ScribeStore.release(keeper.storage, keeper.roomId, keeper.tabId);
            } catch (error) {
                keeper.problem = ScribeKeeper.words(error);
            }
        }
        keeper.reader = false;
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
             * @param {*} settings
             * @return {Promise<void>}
             */
            adopt: (settings) => ScribeKeeper.adopt(keeper, settings),

            /**
             * @return {Promise<void>}
             */
            resume: () => ScribeKeeper.resume(keeper),

            /**
             * @return {void}
             * @throws {Error}
             */
            pause: () => {
                ScribeKeeper.pause(keeper);
            },

            /**
             * @return {Promise<void>}
             */
            tick: () => ScribeKeeper.tick(keeper),

            /**
             * @return {Promise<void>}
             */
            pull: async () => {
                ScribeKeeper.guard(keeper);
                const epoch = keeper.epoch;
                keeper.busy = ScribeKeeper.Busy.Pulling;
                try {
                    await ScribeKeeper.history(keeper);
                } finally {
                    if (keeper.epoch === epoch) {
                        keeper.busy = null;
                    }
                }
            },

            /**
             * @param {object} operation
             * @return {Promise<void>}
             */
            rule: (operation) =>
                ScribeKeeper.ruling(
                    keeper,
                    /**
                     * @param {object} log
                     * @param {object} state
                     * @return {object}
                     */
                    (log, state) => ScribeLog.rule(log, state, operation),
                ),

            /**
             * @return {Promise<void>}
             */
            keepFirst: () =>
                ScribeKeeper.ruling(
                    keeper,
                    /**
                     * @param {object} log
                     * @param {object} state
                     * @return {readonly object[]}
                     */
                    (log, state) => ScribeLog.keepFirst(log, state),
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
             * @return {Promise<ReadonlyArray<Readonly<{ operation: object, reason: string }>>>}
             */
            file: (operations, anchor) => ScribeKeeper.file(keeper, operations, anchor),

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
     * @param {{ storage: { get: Function, set: Function, remove: Function, list: Function }, roomId: string, tabId: string, zeta: { history: Function, newest: Function }, ask: Function, clock: { now: Function, today: Function }, notify: Function, claim?: () => boolean }} options
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
        const keeper = {
            storage,
            roomId,
            tabId,
            zeta,
            ask,
            clock,
            notify,
            claim,
            phase: ScribeKeeper.Phase.Loading,
            reader: false,
            closed: false,
            epoch: settings.FirstEpoch,
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
            ScribeKeeper.begin(keeper).catch(
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
