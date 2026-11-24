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
            PartClose: '. Use Pull the chat again to finish the import.',
            PullFailed: 'the pull failed',
            TooLong: 'the chat has more pages than one pull may read',
            StoppedEarly: 'it stopped early',
            FarOpen: 'The chat could not be pulled far enough to join what is saved: ',
            FarClose: '. Use Pull the chat again to reconcile the saved book.',
            SkippedOne: ' message could not be read from the site.',
            SkippedMany: ' messages could not be read from the site.',
            NothingPulled: 'Nothing has been pulled from the chat yet',
            Unjoined: 'The newest messages do not join the saved chat. Use Pull the chat again to reconcile them.',
            Suspect: 'The chat on the site does not match what is saved. Use Pull the chat again to check.',
            Paused: 'The book is paused',
            Mismatch:
                'The chat on the site no longer matches what is saved (checked twice). Starting the book over discards the book and your rulings.',
            Unconfirmed: 'The save could not be confirmed; the book was loaded again',
            BadAnchor: 'The argument is not valid: anchor',
            BadOperations: 'The argument is not valid: operations',
            BadClaim: 'The argument is not valid: claim',
            CheckDispatched: 'The Checker already requested this comparison. Its answer is unavailable. The passage remains pending.',
            CheckAuth: 'The Checker request was rejected before billing. Replace the saved API key to continue.',
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
        const structured = value.reason === ScribeAdoption.Stop.Failed && Object.hasOwn(value, 'storyFailure');
        if (!structured && value.problem !== null && typeof value.problem !== settings.StringType) {
            return null;
        }
        const source = value.source === 'OpenRouter' || ScribeStore.localSource(value.source) ? { source: value.source } : {};
        if (value.reason === ScribeAdoption.Stop.Failed && (structured || !value.source)) {
            let failure = value.storyFailure;
            if (!structured && typeof value.problem === 'string') {
                const legacy = /^The answer for #(\d+) to #(\d+) held no line that could be read\.$/.exec(value.problem);
                const pending = /^Missing supported Story evidence at #(\d+)\.$/.exec(value.problem);
                if (legacy) {
                    failure = { first: Number(legacy[1]), last: Number(legacy[2]), reason: 'legacy' };
                } else if (pending) {
                    failure = { first: Number(pending[1]), last: Number(pending[1]), reason: 'legacy' };
                }
            }
            if (!value.source && failure && Number.isSafeInteger(failure.first) && Number.isSafeInteger(failure.last) &&
                failure.first > 0 && failure.last >= failure.first && typeof failure.reason === 'string' &&
                Object.hasOwn(ScribeAdoption.Settings.StoryReasons, failure.reason) &&
                ((failure.reason === 'legacy' && failure.stamp === undefined) ||
                    (typeof failure.stamp === 'string' && /^[0-9a-f]{8}$/.test(failure.stamp)))) {
                const { first, last, reason, stamp } = failure;
                const storyFailure = Object.freeze({ first, last, reason, ...(stamp ? { stamp } : {}) });
                return Object.freeze({ reason: value.reason, problem: ScribeAdoption.storyProblem(storyFailure), storyFailure });
            }
            if (structured) {
                return Object.freeze({ reason: value.reason, problem: null, storyFailure: null });
            }
        }
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
        const pendingSources = ScribeAdoption.pendingSources(log, messages);
        const entries = new Map(log.entries.map((entry) => [entry.sequence, entry]));
        keeper.pendingFiling = [];
        keeper.modelReadings = [...(keeper.checkProgress?.modelReadings ?? [])];
        const positions = new Map(messages.map((row) => [row.id, row.position]));
        keeper.linkedEntries = 0;
        keeper.unlinkedEntries = 0;
        for (const entry of log.entries) {
            if (entry.withdrawn) {
                continue;
            }
            const text = entry.modelResponse ?? ScribeLog.modelReading(entry);
            if (text) {
                const ids = entry.responseSources?.map((source) => source.id) ?? entry.messageIds;
                const places = ids.map((id) => positions.get(id)).filter((position) => position !== undefined);
                keeper.modelReadings.push({ role: entry.origin === ScribeLog.Origin.Story ? 'Scribe' : entry.origin,
                    first: places[0] ?? null, last: places.at(-1) ?? null, statement: text });
            }
            if (entry.origin !== ScribeLog.Origin.Story) {
                continue;
            }
            for (const operation of entry.operations) {
                if (operation.revoked) {
                    continue;
                }
                if (operation.evidence?.quote && operation.evidence.verified !== false) {
                    keeper.linkedEntries++;
                } else {
                    keeper.unlinkedEntries++;
                }
            }
        }
        for (const message of pendingSources) {
            const entry = entries.get(log.read[message.id]);
            const source = entry.sources.find((item) => item.id === message.id);
            const issues = source.filingPending?.length ? source.filingPending : [{ reason: 'missingRead' }];
            for (const issue of issues) {
                const proposal = entry.proposals?.find((item) => !item.resolvedBy && item.sourceId === message.id &&
                    item.reason === issue.reason && (!issue.row || item.operation.evidence?.section + ':' + item.operation.evidence?.row === issue.row))?.operation;
                const raw = entry.unfiledRows?.filter((row) => !row.resolvedBy && row.reviewAt === message.id);
                const evidence = entry.operations.find((operation) => operation.evidence?.messageId === message.id &&
                    operation.evidence.issue === issue.reason && operation.evidence.section + ':' + operation.evidence.row === issue.row)?.evidence;
                const statements = proposal ? [proposal.text ?? proposal.said ?? proposal.name ?? proposal.type] :
                    evidence?.modelQuote ? ['Model quote: ' + evidence.modelQuote] :
                    issue.reason === 'format' ? raw?.map((row) => row.line) ?? [] : [];
                keeper.pendingFiling.push({ kind: 'story', id: message.id, position: message.position, ...issue, statements });
            }
        }
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
        if (keeper.pausing || keeper.stop?.reason === ScribeAdoption.Stop.Paused) {
            return messages.Paused;
        }
        if (keeper.busy === busy.Reading) {
            return messages.Reading;
        }
        if (keeper.busy === busy.Pulling) {
            return messages.Pulling;
        }
        const replacing = keeper.mismatch !== null && !keeper.partial;
        if (!replacing && (keeper.book !== null || keeper.damaged !== null)) {
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
        const flight = keeper.stop?.reason === ScribeAdoption.Stop.Paused && keeper.phase === ScribeKeeper.Phase.Stopped
            ? null : keeper.flight;
        const processedChecks = keeper.checkProgress?.processedThrough ?? keeper.checkProgress?.checkedThrough ?? 0;
        const pendingChecks = new Set((keeper.campaign.checkDue ?? []).map((row) => row.id));
        let missingReply = null;
        for (const request of Object.values(keeper.book?.log.checkRequests ?? {})) {
            const message = messages.find((row) => row.id === request.messageId);
            if (!message || (request.fingerprint && (request.fingerprint !== message.fingerprint ||
                (request.projection ?? null) !== (message.projection ?? null)))) {
                continue;
            }
            pendingChecks.add(request.messageId);
            if (!request.reply && keeper.busy !== ScribeKeeper.Busy.Checking) {
                missingReply ??= { source: 'Scribe', reason: request.authRejected
                    ? ScribeKeeper.Settings.Messages.CheckAuth : ScribeKeeper.Settings.Messages.CheckDispatched };
            }
        }
        return Object.freeze({
            phase: keeper.phase,
            roomId: keeper.roomId,
            reader: keeper.reader,
            busy: keeper.busy,
            booked: keeper.book !== null || keeper.damaged !== null,
            canRecoverFork: Boolean(keeper.reader && !keeper.closed && !keeper.busy && !keeper.pausing && !keeper.damaged &&
                !keeper.unloaded && keeper.stop?.reason !== ScribeAdoption.Stop.Paused && ScribeKeeper.replaceableForkBook(keeper.book)),
            total: messages.length,
            settled: messages.length,
            read: keeper.read,
            unread: keeper.unread,
            lastRead: keeper.lastRead,
            writtenThrough: keeper.writtenThrough,
            checksEnabled: keeper.checkPassage !== null,
            checkedThrough: keeper.checkProgress?.checkedThrough ?? 0,
            checkedCount: keeper.checkProgress?.checkedCount ?? keeper.checkProgress?.checkedThrough ?? 0,
            processedChecks,
            pendingChecks: pendingChecks.size,
            historyCheckCount: keeper.campaign.checkRange?.length ?? 0,
            canCheckHistory: Boolean(keeper.campaign.checkRange?.length && keeper.reader && !keeper.busy &&
                keeper.book?.adopted && !keeper.pausing && keeper.stop?.reason !== ScribeAdoption.Stop.Paused &&
                keeper.historyChecked && ScribeKeeper.held(keeper) === null),
            checkerFindings: keeper.checkProgress?.findings ?? [],
            checkerAlerts: keeper.checkProgress?.checkerAlerts ?? [],
            checkerReview: keeper.checkProgress?.reviewRows ?? [],
            checkerProblem: keeper.checkProblem ?? missingReply,
            expensiveCheckAt: null,
            verificationPending: keeper.verificationPending,
            acknowledged: keeper.read - (keeper.verificationPending?.length ?? 0),
            legacyClaims: keeper.legacyClaims,
            made: keeper.made,
            state: keeper.state,
            messages,
            own: keeper.intake === null ? Object.freeze([]) : keeper.intake.own,
            player: keeper.intake === null ? ScribeIntake.Settings.UnknownPlayer : keeper.intake.player,
            settings: keeper.settings,
            spentToday: keeper.spentToday,
            flight,
            began: flight === null ? null : keeper.began,
            stop: keeper.stop,
            storyRetry: ScribeKeeper.storyRetry(keeper),
            inputRetry: ScribeKeeper.storyRetry(keeper, false, 'input'),
            pendingFiling: keeper.pendingFiling,
            modelReadings: keeper.modelReadings,
            linkedEntries: keeper.linkedEntries,
            unlinkedEntries: keeper.unlinkedEntries,
            restoredStop: keeper.restoredStop === keeper.stop && keeper.stop !== null,
            pulled: keeper.lastPull,
            historyChecked: keeper.historyChecked,
            missingOriginals: Boolean(keeper.book && !keeper.historyChecked && !messages.length &&
                (keeper.blank || keeper.campaign.needsHistory)),
            readerCurrent: keeper.compared && keeper.historyChecked && ScribeKeeper.held(keeper) === null && !keeper.pollPending &&
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
            view.pendingFiling.length,
            view.linkedEntries,
            view.unlinkedEntries,
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
     * @param {{messages: object[], gone?: string[], completeHistory?: boolean, needsHistory?: boolean, awaitingFirstPull?: boolean, recheck?: string[], sourceOrder?: {head: number, complete: number, rows: Object<string, number>}, checkDue?: object[], checkRange?: object[], observations?: object[]}|null} value
     * @return {void}
     */
    takeCampaign(keeper, value) {
        keeper.blank = value === null || !Array.isArray(value.messages);
        const messages = keeper.blank ? [] : ScribeKeeper.strings(value.messages);
        const gone = !keeper.blank && Array.isArray(value.gone) ? value.gone.map(String) : [];
        keeper.historyComplete = !keeper.blank && value.completeHistory === true;
        const recheck = !keeper.blank && Array.isArray(value.recheck) ? value.recheck.filter((id) => typeof id === 'string') : [];
        keeper.campaign = { messages, gone, ...(keeper.historyComplete ? { completeHistory: true } : {}),
            ...(!keeper.blank && value.needsHistory === true ? { needsHistory: true } : {}),
            ...(!keeper.blank && ScribeKeeper.isObject(value.sourceOrder) ? { sourceOrder: value.sourceOrder } : {}),
            ...(!keeper.blank && Array.isArray(value.checkDue) ? { checkDue: value.checkDue } : {}),
            ...(!keeper.blank && Array.isArray(value.checkRange) ? { checkRange: value.checkRange } : {}),
            ...(!keeper.blank && Array.isArray(value.observations) ? { observations: value.observations } : {}),
            ...(recheck.length ? { recheck } : {}) };
        if (value?.awaitingFirstPull === true && messages.length === 0) {
            keeper.blank = true;
        }
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
        keeper.partial = false;
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
        keeper.stop = keeper.savedStop?.storyFailure ? null : keeper.savedStop;
        keeper.restoredStop = keeper.stop;
        keeper.retryAt = null;
        keeper.intake = null;
        keeper.newest = null;
        const knownMissing = campaignRead.damage !== null || campaignRead.value !== null && !Array.isArray(campaignRead.value.messages) ||
            campaignRead.value === null && (bookRead.value !== null || bookRead.damage !== null || keeper.edition > none);
        ScribeKeeper.takeCampaign(keeper, knownMissing ? { messages: [], gone: [], needsHistory: true } : campaignRead.value);
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
            const cleared = { ...keeper.campaign, gone: [] };
            delete cleared.recheck;
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
     * @param {object} sourceOrder
     * @param {boolean} incoming
     * @return {boolean}
     */
    absorb(keeper, rawMessages, gone, complete, sourceOrder, incoming = false) {
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
        const prior = new Map((keeper.intake?.messages ?? []).map((row) => [row.id, row]));
        const queued = new Map((keeper.campaign.checkDue ?? []).map((row) => [row.id, row]));
        const checkDue = [];
        for (const row of taken.intake?.messages ?? []) {
            const projection = row.projection ?? null;
            const held = queued.get(row.id);
            if (held?.fingerprint === row.fingerprint && held.projection === projection) {
                checkDue.push(held);
            } else if (incoming && !row.attributionPending && prior.get(row.id)?.fingerprint !== row.fingerprint) {
                checkDue.push({ id: row.id, fingerprint: row.fingerprint, projection });
            }
        }
        const campaign = { messages: rawMessages, gone, sourceOrder, ...(checkDue.length ? { checkDue } : {}),
            ...(complete || keeper.historyComplete ? { completeHistory: true } : {}),
            ...(keeper.campaign.checkRange ? { checkRange: keeper.campaign.checkRange } : {}),
            ...(keeper.campaign.observations?.length ? { observations: keeper.campaign.observations } : {}),
            ...(!complete && keeper.campaign.needsHistory ? { needsHistory: true } : {}),
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
     * @param {object} sourceOrder
     * @return {{ fresh: boolean, joined: boolean, shared: boolean, changed: boolean }}
     */
    takeIn(keeper, pulled, keepAll, emptyRoom, whole, sourceOrder) {
        const saved = keeper.campaign.messages;
        const merged = emptyRoom && !keepAll && pulled.length === 0 && saved.length > 0
            ? { messages: [], removed: saved.map((message) => message.id), joined: true, shared: false, changed: true }
            : ScribeKeeper.merge(saved, pulled, keepAll, whole);
        if (!merged.joined) {
            return { fresh: false, joined: false, shared: false, changed: false };
        }
        const confirmed = whole && (emptyRoom || pulled.length > 0) && !keepAll;
        const gone = [...keeper.campaign.gone];
        for (const id of merged.removed) {
            if (!gone.includes(id)) {
                gone.push(id);
            }
        }
        const fresh = ScribeKeeper.absorb(keeper, merged.messages, gone, confirmed, sourceOrder);
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
     * @param {object} pulled
     * @return {boolean}
     */
    whole(pulled) {
        return !pulled.problem && ScribeKeeper.Settings.WholeEnds.includes(pulled.end);
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
        if (keeper.partial || keeper.campaign.needsHistory) {
            return keeper.cut ?? messages.Unjoined;
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
     * @param {boolean} manual
     * @return {Promise<boolean>}
     */
    async history(keeper, manual = false) {
        if (keeper.pausing || keeper.stop?.reason === ScribeAdoption.Stop.Paused) {
            return false;
        }
        const settings = ScribeKeeper.Settings;
        const flight = settings.Flight;
        const epoch = keeper.epoch;
        if (keeper.blank) {
            const campaign = { ...keeper.campaign, needsHistory: true };
            delete campaign.awaitingFirstPull;
            ScribeKeeper.store(keeper, ScribeStore.Kind.Campaign, campaign);
            keeper.campaign = campaign;
            keeper.blank = false;
        }
        keeper.busy = ScribeKeeper.Busy.Pulling;
        const started = keeper.clock.now();
        keeper.began = started;
        keeper.flight = flight.PullOpen + settings.NoCount + flight.PullClose;
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
        if (keeper.epoch !== epoch) {
            return false;
        }
        let result;
        try {
            result = await keeper.zeta.history((count) => {
                if (keeper.epoch === epoch) {
                    keeper.flight = flight.PullOpen + count + (count === 1 ? flight.PullOne : flight.PullClose);
                    ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
                }
            });
        } catch (error) {
            if (keeper.epoch === epoch) {
                keeper.flight = null;
                keeper.problem = { source: 'Zeta', reason: ScribeKeeper.words(error) };
                ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            }
            return false;
        }
        if (keeper.epoch !== epoch) {
            return false;
        }
        keeper.flight = null;
        const rows = ScribeKeeper.single(result.messages);
        const complete = ScribeKeeper.whole(result) && !result.skipped && result.completeHistory === true &&
            (rows.length > 0 || result.emptyRoom === true);
        keeper.lastPull = Object.freeze({ end: result.end, count: rows.length, skipped: result.skipped, at: keeper.clock.now() });
        keeper.problem = null;
        keeper.cut = ScribeKeeper.shortfall(result, false);
        if (!complete) {
            const shortfall = keeper.cut;
            const previous = keeper.campaign.sourceOrder ?? { head: 0, complete: 0, rows: {} };
            const partial = rows.length && (keeper.campaign.messages.length || !keeper.book?.log.entries.length && !keeper.book?.adopted)
                ? ScribeKeeper.takeIn(keeper, rows, result.skipped > 0, false, false, {
                    head: started, complete: previous.complete,
                    rows: { ...previous.rows, ...Object.fromEntries(rows.map((row) => [row.id, started])) },
                }) : null;
            if (partial?.joined) {
                keeper.unjoined = false;
                keeper.suspectAt = null;
                keeper.mismatch = null;
            } else if (rows.length) {
                keeper.unjoined = true;
            }
            keeper.partial = !keeper.historyChecked || keeper.unjoined || keeper.mismatch !== null || keeper.suspectAt !== null;
            keeper.cut = !partial?.joined && keeper.campaign.messages.length && rows.length
                ? ScribeKeeper.shortfall(result, true) : shortfall;
            keeper.cut ??= settings.Messages.Unjoined;
            ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            return false;
        }
        const taken = ScribeKeeper.takeIn(keeper, rows, false, result.emptyRoom === true, true,
            { head: started, complete: started, rows: {} });
        if (!taken.joined) {
            const now = keeper.clock.now();
            if (keeper.mismatch !== null || keeper.suspectAt !== null && now - keeper.suspectAt >= settings.RepullMs) {
                keeper.mismatch = rows;
            } else if (keeper.suspectAt === null || now < keeper.suspectAt) {
                keeper.suspectAt = now;
            }
            ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            return false;
        }
        if (taken.fresh) {
            keeper.unjoined = false;
            keeper.partial = false;
            keeper.suspectAt = null;
            keeper.mismatch = null;
            ScribeKeeper.observed(keeper, rows, true);
            if (manual && keeper.compared) {
                const checkRange = keeper.intake.messages.map((row) => ({ id: row.id, fingerprint: row.fingerprint,
                    projection: row.projection ?? null }));
                const campaign = { ...keeper.campaign, checkRange };
                ScribeKeeper.store(keeper, ScribeStore.Kind.Campaign, campaign);
                keeper.campaign = campaign;
            }
        }
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
        return taken.fresh;
    },

    /**
     * @param {object} keeper
     * @param {string[]} ids
     * @param {object|null} expected
     * @return {boolean}
     */
    available(keeper, ids, expected = null) {
        if (!keeper.compared || !keeper.historyChecked || ScribeKeeper.held(keeper) !== null) {
            return false;
        }
        const messages = keeper.intake.messages;
        const known = new Set(messages.filter((row) => !row.attributionPending).map((row) => row.id));
        const current = expected && messages[expected.position - 1];
        return ids.every((id) => known.has(id)) && (!expected || current?.id === expected.id &&
            current.fingerprint === expected.fingerprint && current.projection === expected.projection);
    },

    /**
     * @param {object} keeper
     * @param {{messages: object[], head: boolean, complete: boolean, created?: boolean, replacement?: boolean, candidate?: {message: string, id: string, contents: object[]}, ambiguous?: boolean, observedAt: number}} page
     * @return {boolean|null}
     */
    applyObserved(keeper, page) {
        const saved = keeper.campaign.messages;
        const previous = keeper.campaign.sourceOrder ?? { head: 0, complete: 0, rows: {} };
        if ((!page.head && !page.created && !page.replacement && !page.candidate) || page.ambiguous || (!page.messages.length && !page.candidate) ||
            page.observedAt < previous.complete || page.head && page.observedAt < previous.head) {
            return true;
        }
        let rows = ScribeKeeper.single(page.messages);
        if (rows.length !== page.messages.length || ((page.created || page.replacement) && (page.head || rows.length !== 1))) {
            return true;
        }
        const known = new Map(saved.map((row, index) => [row.id, index]));
        if (page.candidate) {
            const stored = saved[known.get(page.candidate.message)];
            if (!stored || stored.candidateId !== page.candidate.id) {
                return true;
            }
            rows = [{ ...stored, contents: page.candidate.contents, edited: true }];
        }
        let overlapRows = [];
        let additions = rows;
        if (page.replacement || page.candidate) {
            if (!known.has(rows[0].id)) {
                return true;
            }
            overlapRows = rows;
            additions = [];
        } else if (page.head && saved.length) {
            const overlap = rows.findIndex((row) => row.id === saved.at(-1).id);
            if (overlap < 0) {
                if (!page.complete && rows.every((row) => !known.has(row.id))) {
                    keeper.cut = ScribeKeeper.Settings.Messages.Unjoined;
                    keeper.unjoined = true;
                    return null;
                }
                return true;
            }
            const start = saved.length - overlap - 1;
            overlapRows = rows.slice(0, overlap + 1);
            const continuous = start >= 0 && overlapRows.every((row, index) => {
                const stored = saved[start + index];
                return stored.id === row.id && stored.messageTime === row.messageTime && stored.sender.type === row.sender.type;
            });
            if (!continuous) {
                return true;
            }
            additions = rows.slice(overlap + 1);
        }
        if (additions.some((row) => known.has(row.id) ||
            Object.hasOwn(previous.rows, row.id) && previous.rows[row.id] > page.observedAt)) {
            return true;
        }
        const changes = overlapRows.filter((row) => {
            const stored = saved[known.get(row.id)];
            return !(Object.hasOwn(previous.rows, row.id) && previous.rows[row.id] > page.observedAt) &&
                (stored.candidateId !== row.candidateId || JSON.stringify(stored.contents) !== JSON.stringify(row.contents));
        });
        if (!additions.length && !changes.length) {
            return true;
        }
        if (keeper.blank || keeper.campaign.needsHistory || (!saved.length && page.head && !page.complete)) {
            return null;
        }
        const messages = [...saved];
        for (const row of changes) {
            messages[known.get(row.id)] = row;
        }
        if (additions.length && saved.length && Date.parse(additions[0].messageTime) < Date.parse(saved.at(-1).messageTime)) {
            if (!page.created) {
                return true;
            }
            const [created] = additions;
            const position = saved.findIndex((row) => Date.parse(row.messageTime) > Date.parse(created.messageTime));
            messages.splice(position, 0, created);
        } else {
            messages.push(...additions);
        }
        const changed = [...changes, ...additions];
        const sourceOrder = { ...previous, head: page.head ? page.observedAt : previous.head,
            rows: { ...previous.rows, ...Object.fromEntries(changed.map((row) => [row.id, page.observedAt])) } };
        if (!ScribeKeeper.absorb(keeper, messages, keeper.campaign.gone, false, sourceOrder, keeper.historyChecked)) {
            return false;
        }
        if (keeper.busy === ScribeKeeper.Busy.Reading) {
            keeper.pollPending = true;
        } else if (keeper.busy === ScribeKeeper.Busy.Checking) {
            keeper.followChanges = true;
        }
        if (page.head && keeper.unjoined) {
            keeper.unjoined = false;
            if (!keeper.partial) {
                keeper.cut = null;
            }
        }
        if (keeper.compared && !keeper.unjoined) {
            ScribeKeeper.observed(keeper, changed, false);
        }
        return true;
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    flushObserved(keeper) {
        const pages = keeper.campaign.observations;
        if (!pages?.length) {
            return;
        }
        const pending = [];
        for (const page of pages) {
            const applied = ScribeKeeper.applyObserved(keeper, page);
            if (applied === false) {
                return;
            }
            if (applied === null) {
                pending.push(page);
            }
        }
        if (pending.length === pages.length) {
            return;
        }
        const campaign = { ...keeper.campaign };
        if (pending.length) {
            campaign.observations = pending;
        } else {
            delete campaign.observations;
            if (keeper.cut === ScribeKeeper.Settings.Messages.Unjoined && !keeper.unjoined && !keeper.partial) {
                keeper.cut = null;
            }
        }
        ScribeKeeper.store(keeper, ScribeStore.Kind.Campaign, campaign);
        keeper.campaign = campaign;
    },

    /**
     * @param {object} keeper
     * @param {object} page
     * @return {boolean}
     */
    observe(keeper, page) {
        if (keeper.closed || !keeper.reader || keeper.unloaded !== null ||
            !Array.isArray(page?.messages) || !ScribeKeeper.writable(keeper)) {
            return false;
        }
        const observation = { messages: page.messages, head: page.head === true, complete: page.complete === true,
            created: page.created === true, ambiguous: page.ambiguous === true,
            ...(page.replacement ? { replacement: true } : {}), ...(page.candidate ? { candidate: page.candidate } : {}),
            observedAt: Number.isFinite(page.observedAt) ? page.observedAt : keeper.clock.now() };
        if ((!observation.head && !observation.created && !observation.replacement && !observation.candidate) ||
            observation.ambiguous || (!observation.messages.length && !observation.candidate)) {
            return true;
        }
        try {
            const previous = keeper.campaign.messages;
            const held = keeper.pausing || keeper.stop?.reason === ScribeAdoption.Stop.Paused || keeper.busy === ScribeKeeper.Busy.Pulling;
            const applied = held ? null : ScribeKeeper.applyObserved(keeper, observation);
            if (applied !== true) {
                const observations = keeper.campaign.observations ?? [];
                const last = observations.at(-1);
                const duplicate = last && last.head === observation.head && last.complete === observation.complete &&
                    last.created === observation.created && last.ambiguous === observation.ambiguous &&
                    last.replacement === observation.replacement && JSON.stringify(last.candidate) === JSON.stringify(observation.candidate) &&
                    JSON.stringify(last.messages) === JSON.stringify(observation.messages);
                if (!duplicate || last.observedAt < observation.observedAt) {
                    const campaign = { ...keeper.campaign, ...(keeper.blank ? { awaitingFirstPull: true } : {}),
                        observations: [...(duplicate ? observations.slice(0, -1) : observations), observation] };
                    ScribeKeeper.store(keeper, ScribeStore.Kind.Campaign, campaign);
                    keeper.campaign = campaign;
                }
                return true;
            }
            if (keeper.campaign.messages !== previous) {
                ScribeKeeper.flushObserved(keeper);
                ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
                void ScribeKeeper.track(keeper, () => ScribeKeeper.tick(keeper, false));
            }
            return true;
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
            ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            return false;
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
        if (stretch.at(-1).position - stretch[0].position + 1 !== stretch.length) {
            return 'Reading ' + stretch.length + ' unread messages between #' + stretch[0].position +
                ' and #' + stretch.at(-1).position;
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
        ScribeKeeper.keepStop(keeper, Object.freeze({ reason: ScribeAdoption.Stop.Paused, problem: null }), false);
        if (keeper.reader) {
            keeper.phase = ScribeKeeper.Phase.Stopped;
        }
    },

    /**
     * @param {object} keeper
     * @param {{id: string, fingerprint: string}|null} target
     * @param {object|null} retry
     * @return {Promise<void>}
     */
    async read(keeper, target = null, retry = null) {
        const settings = ScribeKeeper.Settings;
        const stops = ScribeAdoption.Stop;
        const epoch = keeper.epoch;
        if (!keeper.book || keeper.pausing || keeper.stop?.reason === stops.Paused) {
            return;
        }
        if (!keeper.compared) {
            ScribeKeeper.compare(keeper);
            if (!keeper.compared) {
                return;
            }
        }
        const book = keeper.book;
        const intake = keeper.intake;
        const size = keeper.settings.size;
        const { settled, end: planned } = ScribeKeeper.plan(keeper, target);
        const end = retry ? retry.through : planned;
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
         * @param {readonly object[]} sources
         * @return {void}
         * @throws {Error}
         */
        const confirmAttribution = (questions = [], sources = chosen) => {
            if (keeper.compared && keeper.intake === intake && keeper.book === book && questions.length === 0) {
                return;
            }
            const latest = keeper.compared ? keeper.intake : ScribeKeeper.take(keeper.campaign.messages, keeper).intake;
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
        if (keeper.epoch !== epoch) {
            return;
        }
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
                ...(retry?.kind === 'story' ? { retrySources: retry.ids } : {}),
                ...(retry?.kind === 'input' ? { retryInputs: retry.keys } : {}),
                diagnostic,
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
                 * @param {readonly object[]} sources
                 * @return {Promise<{ text: string, cost: * }>}
                 */
                ask: async (system, user, questions, sources) => {
                    if (keeper.epoch !== epoch || !ScribeKeeper.writable(keeper)) {
                        throw new Error(settings.Messages.ThrownAway);
                    }
                    confirmAttribution(questions, sources);
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
                        return { text: found.text, ...(Object.hasOwn(found, 'finish') ? { finish: found.finish } : {}), cost: settings.NoSpending };
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
                    if (!keeper.closed && keeper.epoch === epoch) {
                        keeper.kept.push({ key, text: answer.text, ...(Object.hasOwn(answer, 'finish') ? { finish: answer.finish } : {}), credentials });
                        keeper.kept.splice(settings.NoCount, Math.max(keeper.kept.length - settings.KeptAnswers, settings.NoCount));
                    }
                    return answer;
                },
                /**
                 * @param {object} log
                 * @param {readonly object[]} questions
                 * @param {readonly object[]} sources
                 * @return {Promise<void>}
                 * @throws {Error}
                 */
                save: async (log, questions, sources) => {
                    if (keeper.epoch !== epoch || !ScribeKeeper.writable(keeper)) {
                        throw new Error(settings.Messages.ThrownAway);
                    }
                    confirmAttribution(questions, sources);
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
                    if (keeper.epoch !== epoch) {
                        return;
                    }
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

        const failure = stop === stops.Failed && !job.storage && result.storyFailure;
        const storyFailure = failure ? Object.freeze({ ...failure, stamp: ScribeKeeper.storyStamp(
            room.slice(failure.first - 1, failure.last)) }) : null;
        ScribeKeeper.keepStop(keeper, Object.freeze({ reason: stop, problem: masked, ...source,
            ...(storyFailure ? { storyFailure } : {}) }), job.storage);
        if (keeper.epoch !== epoch) {
            return;
        }
        keeper.phase = stop === stops.Done ? ScribeKeeper.Phase.Idle : ScribeKeeper.Phase.Stopped;
        if (keeper.unloaded === null) {
            ScribeKeeper.show(keeper);
        }
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
        if (repoll && keeper.epoch === epoch) {
            await ScribeKeeper.step(keeper, false, target);
        }
        if (keeper.epoch === epoch && keeper.phase === ScribeKeeper.Phase.Idle) {
            await ScribeKeeper.check(keeper);
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
     * @return {void}
     */
    start(keeper) {
        const epoch = keeper.epoch;
        keeper.phase = keeper.stop?.reason === ScribeAdoption.Stop.Paused
            ? ScribeKeeper.Phase.Stopped : ScribeKeeper.Phase.Loading;
        try {
            ScribeStore.sweep(keeper.storage, keeper.roomId);
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
        }
        if (keeper.savedStop?.storyFailure && ScribeKeeper.writable(keeper)) {
            ScribeKeeper.keepStop(keeper, null, false);
        }
        try {
            if (keeper.blank && keeper.book !== null) {
                keeper.partial = true;
                keeper.cut = ScribeKeeper.Settings.Messages.Unjoined;
            } else if (!keeper.blank) {
                ScribeKeeper.compare(keeper);
                keeper.partial = keeper.campaign.needsHistory === true;
                keeper.cut = keeper.partial ? ScribeKeeper.Settings.Messages.Unjoined : null;
                keeper.historyChecked = keeper.compared && !keeper.partial;
            }
            if (keeper.epoch === epoch && !keeper.pausing && keeper.stop?.reason !== ScribeAdoption.Stop.Paused) {
                ScribeKeeper.flushObserved(keeper);
            }
        } finally {
            if (keeper.epoch === epoch) {
                keeper.phase = ScribeKeeper.resting(keeper);
                ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            }
        }
    },

    /**
     * @param {object} keeper
     * @return {Promise<void>}
     */
    async begin(keeper) {
        const epoch = keeper.epoch;
        ScribeKeeper.start(keeper);
        if (keeper.epoch === epoch) {
            await ScribeKeeper.check(keeper);
        }
    },

    /**
     * @param {object} keeper
     * @return {object}
     * @throws {Error}
     */
    checkBook(keeper) {
        const durable = ScribeKeeper.readKind(keeper, ScribeStore.Kind.Book);
        if (durable.damage || !durable.value || !ScribeKeeper.soundBook(durable.value)) {
            throw new Error(durable.damage ?? ScribeKeeper.damagedBook());
        }
        return durable.value;
    },

    /**
     * @param {object} book
     * @param {string} id
     * @return {void}
     */
    releaseCheckRequest(book, id) {
        if (book.log.checkRequests) {
            delete book.log.checkRequests[id];
            if (!Object.keys(book.log.checkRequests).length) {
                delete book.log.checkRequests;
            }
        }
    },

    /**
     * @param {object} keeper
     * @param {readonly object[]} requested
     * @return {Promise<void>}
     */
    async check(keeper, requested = keeper.campaign.checkDue) {
        const epoch = keeper.epoch;
        if (!keeper.checkPassage || keeper.checkingQueue === epoch || keeper.busy || !keeper.campaign.checkDue?.length) {
            return;
        }
        keeper.checkingQueue = epoch;
        try {
            for (const source of requested) {
                if (keeper.closed || keeper.epoch !== epoch || !keeper.reader || keeper.phase !== ScribeKeeper.Phase.Idle || !keeper.book?.adopted ||
                    keeper.busy || !keeper.historyChecked || keeper.pausing || ScribeKeeper.held(keeper) !== null) {
                    return;
                }
                if (keeper.campaign.checkDue?.some((row) => row.id === source.id && row.fingerprint === source.fingerprint &&
                    row.projection === source.projection) && keeper.book.fingerprints[source.id] === source.fingerprint &&
                    (keeper.book.projections?.[source.id] ?? null) === source.projection) {
                    await ScribeKeeper.checkOne(keeper, source);
                }
            }
        } finally {
            if (keeper.checkingQueue === epoch) {
                keeper.checkingQueue = null;
                if (keeper.followChanges && keeper.epoch === epoch && !keeper.closed && !keeper.pausing) {
                    keeper.followChanges = false;
                    await ScribeKeeper.step(keeper, false);
                }
            }
        }
    },

    /**
     * @param {object} keeper
     * @param {object} source
     * @return {void}
     */
    checked(keeper, source) {
        const due = keeper.campaign.checkDue?.filter((entry) => entry.id !== source.id ||
            entry.fingerprint !== source.fingerprint || entry.projection !== source.projection);
        if (!due || due.length === keeper.campaign.checkDue.length) {
            return;
        }
        const campaign = { ...keeper.campaign };
        if (due.length) {
            campaign.checkDue = due;
        } else {
            delete campaign.checkDue;
        }
        ScribeKeeper.store(keeper, ScribeStore.Kind.Campaign, campaign);
        keeper.campaign = campaign;
    },

    /**
     * @param {object} keeper
     * @param {object} source
     * @return {Promise<void>}
     */
    async checkOne(keeper, source) {
        const budgetProblem = ScribeKeeper.recount(keeper);
        if (budgetProblem || (!keeper.checkPage && !keeper.book.log.checkRequests && keeper.spentToday >= keeper.settings.budget)) {
            keeper.checkProblem = { source: 'Scribe', reason: budgetProblem
                ? ScribeStore.diagnostic(keeper.storage, budgetProblem) : "The day's budget is spent" };
            return;
        }
        const messages = keeper.intake.messages;
        let work = ScribeLog.checkWork(keeper.book, messages, true, source.id);
        if (work.targetComplete) {
            ScribeKeeper.checked(keeper, source);
            return;
        }
        const previous = Object.entries(keeper.book.log.checkRequests ?? {}).find(([, request]) =>
            request.messageId === source.id && request.version === work.version);
        if (work.targetDispatched && (!previous || keeper.checkReply?.id !== previous[0])) {
            keeper.checkProblem = { source: 'Scribe', reason: previous?.[1].authRejected
                ? ScribeKeeper.Settings.Messages.CheckAuth : ScribeKeeper.Settings.Messages.CheckDispatched };
            return;
        }
        if (work.message?.id !== source.id || work.message.fingerprint !== source.fingerprint) {
            return;
        }
        const epoch = keeper.epoch;
        const target = work.message;
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
        const pending = Object.fromEntries(Object.entries(keeper.book.log.checkRequests ?? {}).filter(([, request]) =>
            request.messageId === target.id && request.version === work.version));
        const writeBook = (book) => {
            ScribeKeeper.store(keeper, ScribeStore.Kind.Book, book);
            keeper.book = book;
        };
        /**
         * @param {number|null} bytes
         * @param {string|null} reason
         * @return {void}
         */
        const learnLimit = (bytes, reason = null) => {
            if (!current()) {
                throw yieldPage;
            }
            const book = ScribeKeeper.checkBook(keeper);
            const latest = ScribeLog.checkWork(book, keeper.intake.messages, false, source.id);
            if (latest.message?.id !== target.id || latest.version !== work.version) {
                throw yieldPage;
            }
            const previous = book.log.checkLimits?.[modelKey];
            const bound = Number.isSafeInteger(bytes) && bytes > 0 ? Math.min(bytes, previous?.bytes ?? bytes) : previous?.bytes;
            book.log.checkLimits = { ...book.log.checkLimits, [modelKey]: {
                bytes: bound, ...(reason === null ? {} : { blocked: work.version, reason }),
            } };
            writeBook(book);
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
            const evidenceCurrent = cited.every((position) => {
                const original = messages[position - 1];
                const latest = keeper.intake.messages[position - 1];
                return original && latest && !latest.attributionPending && original.id === latest.id &&
                    original.fingerprint === latest.fingerprint && original.projection === latest.projection;
            });
            if (!messages[first - 1] || !evidenceCurrent || !ScribeKeeper.available(keeper, [target.id], target) || !current()) {
                throw yieldPage;
            }
            const book = ScribeKeeper.checkBook(keeper);
            const finished = !work.legacyPartial || (page.parentId === undefined && page.index + 1 === page.total);
            if (ScribeLog.saveCheck(book, keeper.intake.messages, work, page)) {
                ScribeKeeper.releaseCheckRequest(book, page.id);
                writeBook(book);
                if (finished) {
                    ScribeKeeper.checked(keeper, source);
                }
                if (keeper.checkReply?.id === page.id) {
                    keeper.checkReply = null;
                }
            } else {
                const latest = ScribeLog.checkWork(book, keeper.intake.messages, false, source.id);
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
            if (finished) {
                throw yieldPage;
            }
        };
        keeper.flight = 'Checking message #' + target.position;
        keeper.began = keeper.clock.now();
        ScribeKeeper.occupy(keeper, ScribeKeeper.Busy.Checking);
        try {
            if (keeper.checkPage?.id === target.id && keeper.checkPage.version === work.version && keeper.checkPage.model === selected) {
                await save(keeper.checkPage.page, keeper.checkPage.sources);
                work = ScribeLog.checkWork(keeper.book, messages, true, source.id);
            }
            keeper.checkPage = null;
            await keeper.checkPassage({
                targeted: true, legacyPartial: work.legacyPartial, version: work.version,
                batchMessages: work.batchMessages, pendingEntries: work.pendingEntries,
                state: work.state ?? keeper.state, player: keeper.intake.player,
                message: target, written: work.written, earlierClaims: work.earlierClaims, rulings: work.rulings,
                diagnostic: (value) => ScribeStore.diagnosticCopy(value, ScribeStore.redactor(keeper.storage, credentials)),
                completedPages: work.completed, completedSegments: work.segments, priorPages: work.priorPages,
                requests: pending, planBytes: Object.values(pending)[0]?.planBytes,
                savePage: save, saveSegment: save, learnLimit,
                ...(Number.isSafeInteger(limit?.bytes) && limit.bytes > 0 ? { pageBytes: limit.bytes } : {}),
                ask: async (system, input, sources, id, planBytes) => {
                    if (!current()) {
                        throw yieldPage;
                    }
                    const book = ScribeKeeper.checkBook(keeper);
                    const previous = book.log.checkRequests?.[id];
                    const inputStamp = ScribeText.fingerprint(input);
                    if (previous) {
                        if (previous.inputStamp && previous.inputStamp !== inputStamp) {
                            throw yieldPage;
                        }
                        if (previous.authRejected) {
                            throw new Error(ScribeKeeper.Settings.Messages.CheckAuth);
                        }
                        if (!previous.reply && keeper.checkReply?.id === id) {
                            previous.reply = keeper.checkReply.reply;
                            writeBook(book);
                        }
                        if (!previous.reply) {
                            throw new Error(ScribeKeeper.Settings.Messages.CheckDispatched);
                        }
                        return previous.reply;
                    }
                    const failure = ScribeKeeper.recount(keeper);
                    if (failure || keeper.owed.size || keeper.spentToday >= keeper.settings.budget) {
                        throw new Error(failure ?? keeper.owing ?? "The day's budget is spent");
                    }
                    let dispatched = false;
                    const beforeDispatch = () => {
                        if (!current()) {
                            throw yieldPage;
                        }
                        const latest = ScribeKeeper.checkBook(keeper);
                        const next = ScribeLog.checkWork(latest, keeper.intake.messages, false, source.id);
                        if (next.message?.id !== target.id || next.version !== work.version ||
                            latest.log.checkRequests?.[id] || [...next.completed, ...next.segments].some((page) => page.id === id)) {
                            throw yieldPage;
                        }
                        (latest.log.checkRequests ??= {})[id] = { messageId: target.id, fingerprint: target.fingerprint,
                            projection: target.projection ?? null, version: work.version, planBytes, inputStamp };
                        writeBook(latest);
                        dispatched = true;
                    };
                    let answer;
                    try {
                        answer = await keeper.askChecker(system, input, beforeDispatch);
                    } catch (error) {
                        if (dispatched && current() && error?.unbilledAuth) {
                            const latest = ScribeKeeper.checkBook(keeper);
                            if (!error.keyChanged?.()) {
                                latest.log.checkRequests[id].authRejected = true;
                            } else {
                                ScribeKeeper.releaseCheckRequest(latest, id);
                            }
                            writeBook(latest);
                        }
                        throw error;
                    }
                    if (Number.isFinite(answer?.cost) && answer.cost > 0) {
                        ScribeKeeper.pay(keeper, answer.cost);
                    }
                    if (typeof answer?.text !== 'string' || !answer.text.trim()) {
                        throw new Error(ScribeKeeper.Settings.Messages.CheckDispatched);
                    }
                    const mask = ScribeStore.redactor(keeper.storage, credentials);
                    const reply = { text: mask(answer.text), ...(typeof answer.finish === 'string' ? { finish: mask(answer.finish) } : {}) };
                    keeper.checkReply = { id, reply };
                    if (keeper.closed || !ScribeKeeper.writable(keeper)) {
                        throw yieldPage;
                    }
                    const latest = ScribeKeeper.checkBook(keeper);
                    if (!latest.log.checkRequests?.[id]) {
                        throw yieldPage;
                    }
                    latest.log.checkRequests[id].reply = reply;
                    writeBook(latest);
                    if (!current()) {
                        throw yieldPage;
                    }
                    return reply;
                },
            });
        } catch (error) {
            if (error !== yieldPage && !keeper.closed && keeper.epoch === epoch) {
                const mask = ScribeStore.redactor(keeper.storage, credentials);
                keeper.checkProblem = { source: error?.source ?? 'Scribe', reason: mask(ScribeKeeper.words(error)) };
                if (error?.checkerContextFloor && current()) {
                    learnLimit(null, keeper.checkProblem.reason);
                }
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
        if (keeper.closed || !keeper.reader) {
            return;
        }
        keeper.epoch++;
        keeper.reader = false;
        keeper.pausing = false;
        keeper.zeta.abort?.();
        keeper.pauseCalls?.(ScribeKeeper.Settings.Messages.Watching);
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
            return;
        }
        const epoch = keeper.epoch;
        try {
            if (keeper.unloaded !== null) {
                const paused = keeper.pausing || keeper.stop?.reason === ScribeAdoption.Stop.Paused;
                if (!ScribeKeeper.load(keeper)) {
                    return;
                }
                if (paused) {
                    ScribeKeeper.holdPause(keeper);
                }
                ScribeKeeper.start(keeper);
            }
            if (keeper.epoch !== epoch) {
                return;
            }
            if (keeper.pausing || keeper.stop?.reason === ScribeAdoption.Stop.Paused) {
                if (keeper.savedStop?.reason !== ScribeAdoption.Stop.Paused) {
                    ScribeKeeper.holdPause(keeper);
                }
                return;
            }
            ScribeKeeper.counted(keeper);
            ScribeKeeper.flushObserved(keeper);
            if (!keeper.compared && !keeper.blank) {
                ScribeKeeper.compare(keeper);
            }
            if (!keeper.historyChecked || !keeper.compared || ScribeKeeper.held(keeper) !== null) {
                return;
            }
            ScribeKeeper.observed(keeper, keeper.intake.messages, false);
            keeper.pollPending = false;
            if (ScribeKeeper.due(keeper) && (target === null || ScribeKeeper.plan(keeper, target).end > keeper.writtenThrough)) {
                await ScribeKeeper.read(keeper, target);
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
        if (keeper.campaign.needsHistory) {
            return;
        }
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
        if (keeper.pausing || keeper.stop?.reason === ScribeAdoption.Stop.Paused) {
            throw new Error(messages.Paused);
        }
        const firstBook = keeper.book === null && keeper.damaged === null;
        const replacing = keeper.mismatch !== null && !keeper.partial;
        if (!firstBook && !replacing) {
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
        keeper.damaged = null;
        keeper.stop = null;
        keeper.retryAt = null;
        keeper.pausing = false;
        if (firstBook && keeper.blank) {
            const epoch = keeper.epoch;
            try {
                if (!await ScribeKeeper.history(keeper)) {
                    if (keeper.epoch !== epoch) {
                        return;
                    }
                    throw new Error(ScribeKeeper.issue(keeper) ?? keeper.cut ?? messages.Unsettled);
                }
            } finally {
                if (keeper.epoch === epoch) {
                    keeper.phase = ScribeKeeper.resting(keeper);
                    ScribeKeeper.occupy(keeper, null);
                }
            }
            if (keeper.epoch !== epoch) {
                return;
            }
            ScribeKeeper.flushObserved(keeper);
            ScribeKeeper.readable(keeper);
        } else if (firstBook) {
            keeper.phase = ScribeKeeper.resting(keeper);
            ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            ScribeKeeper.readable(keeper);
        }
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
     * @param {object|null} book
     * @return {boolean}
     */
    replaceableForkBook(book) {
        return book === null || (!book.adopted && !Object.keys(book.log.checkRequests ?? {}).length &&
            book.log.entries.every((entry) => entry.origin === ScribeLog.Origin.Story && !entry.withdrawn) &&
            !book.log.notes.length);
    },

    /**
     * @param {object} keeper
     * @param {string} sourceRoomId
     * @param {string|null} messageId
     * @param {Function} loadSource
     * @return {Promise<object>}
     */
    async recoverFork(keeper, sourceRoomId, messageId, loadSource) {
        const epoch = keeper.epoch;
        let occupied = false;
        try {
            ScribeKeeper.guard(keeper);
            if (keeper.pausing || keeper.stop?.reason === ScribeAdoption.Stop.Paused) {
                return {ok: false, reason: ScribeKeeper.Settings.Messages.Paused};
            }
            if (keeper.damaged || sourceRoomId === keeper.roomId || !ScribeKeeper.replaceableForkBook(keeper.book)) {
                return {ok: false, reason: 'This Book already has independent changes.'};
            }
            const {Book, Campaign, Live} = ScribeStore.Kind;
            const room = ScribeStore.room(keeper.roomId);
            const generations = [Book, Campaign, Live].map((kind) =>
                [ScribeStore.name(ScribeStore.Settings.Types.Head, room, kind), kind, ScribeStore.generation(keeper.storage, keeper.roomId, kind)]);
            const current = (published = null) => keeper.reader && !keeper.closed && !keeper.pausing && keeper.epoch === epoch &&
                keeper.stop?.reason !== ScribeAdoption.Stop.Paused && ScribeKeeper.writable(keeper) &&
                generations.every(([head, kind, generation]) => published?.has(head)
                    ? ScribeStore.fetch(keeper.storage, head) === published.get(head)
                    : generation !== null && ScribeStore.generation(keeper.storage, keeper.roomId, kind) === generation);
            if (!current()) {
                return {ok: false, reason: ScribeKeeper.Settings.Messages.Watching};
            }
            occupied = true;
            ScribeKeeper.occupy(keeper, ScribeKeeper.Busy.Pulling);
            const source = await loadSource(sourceRoomId);
            if (!current()) {
                return {ok: false, reason: 'Fork recovery stopped because the room changed.'};
            }
            let campaign = keeper.campaign;
            if (!campaign.completeHistory || campaign.needsHistory) {
                const started = keeper.clock.now();
                const result = await keeper.zeta.history(() => {});
                if (!result || !ScribeKeeper.whole(result) || result.skipped || result.completeHistory !== true ||
                    !result.messages?.length) {
                    return {ok: false, reason: 'Zeta did not supply the complete fork history.'};
                }
                campaign = {...campaign, messages: result.messages, gone: [], completeHistory: true, sourceOrder: {
                    head: started, complete: started, rows: Object.fromEntries(result.messages.map((row) => [row.id, started])),
                }};
                delete campaign.needsHistory;
                delete campaign.awaitingFirstPull;
                delete campaign.recheck;
            }
            if (!current()) {
                return {ok: false, reason: 'Fork recovery stopped because the room changed.'};
            }
            const taken = ScribeKeeper.take(campaign.messages, keeper);
            if (!taken.intake) {
                return {ok: false, reason: ScribeKeeper.words(taken.disorder)};
            }
            const result = ScribeFork.stage(source, campaign.messages, taken.intake, sourceRoomId, keeper.roomId, messageId, keeper.book);
            await ScribeFork.requests(result, source.book, taken.intake.messages);
            ScribeKeeper.show({...keeper, intake: taken.intake, book: result.book, campaign});
            ScribeStore.installFork(keeper.storage, keeper.roomId, campaign === keeper.campaign ? null : campaign, result.book, current);
            ScribeKeeper.takeCampaign(keeper, campaign);
            keeper.book = result.book;
            keeper.blank = false;
            keeper.partial = false;
            keeper.unjoined = false;
            keeper.suspectAt = null;
            keeper.mismatch = null;
            keeper.problem = null;
            keeper.cut = null;
            keeper.compared = true;
            keeper.historyChecked = true;
            keeper.phase = ScribeKeeper.resting(keeper);
            ScribeKeeper.show(keeper);
            return {ok: true, shared: result.shared, read: result.read};
        } catch (error) {
            return {ok: false, reason: ScribeKeeper.words(error)};
        } finally {
            if (occupied && keeper.epoch === epoch) {
                ScribeKeeper.occupy(keeper, null);
            }
        }
    },

    /**
     * @param {object} keeper
     * @return {Promise<void>}
     * @throws {Error}
     */
    async resume(keeper) {
        const paused = keeper.stop?.reason === ScribeAdoption.Stop.Paused;
        const beforeAdoption = paused && keeper.book === null && keeper.damaged === null;
        ScribeKeeper.guard(keeper);
        if (!paused && keeper.book !== null) {
            ScribeKeeper.readable(keeper);
        }
        if (!beforeAdoption) {
            ScribeKeeper.needBook(keeper);
        }
        ScribeKeeper.solvent(keeper);
        if (!ScribeKeeper.writable(keeper)) {
            throw new Error(ScribeKeeper.Settings.Messages.Watching);
        }
        if (keeper.savedStop !== null) {
            ScribeKeeper.saveStop(keeper, null);
        }
        keeper.pausing = false;
        ScribeKeeper.keepStop(keeper, null, false);
        keeper.phase = ScribeKeeper.resting(keeper);
        ScribeKeeper.flushObserved(keeper);
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
        if (!beforeAdoption && keeper.historyChecked && !ScribeKeeper.held(keeper)) {
            await ScribeKeeper.read(keeper);
        }
    },

    /**
     * @param {readonly object[]} rows
     * @return {string}
     */
    storyStamp(rows) {
        return ScribeText.fingerprint(JSON.stringify(rows.map((row) => [row.id, row.fingerprint, row.projection])));
    },

    /**
     * @param {object} keeper
     * @param {boolean} confirming
     * @return {Readonly<object>|null}
     */
    storyRetry(keeper, confirming = false, kind = 'story', id = null) {
        if (!keeper.reader || keeper.closed || keeper.phase !== ScribeKeeper.Phase.Idle ||
            (!confirming && keeper.busy !== null) || keeper.pausing || !keeper.compared || !keeper.historyChecked ||
            !keeper.book || keeper.damaged || keeper.unloaded || keeper.owed.size || ScribeKeeper.held(keeper) !== null ||
            keeper.spentToday >= keeper.settings.budget) {
            return null;
        }
        const work = keeper.pendingFiling.filter((item) => item.kind === kind && (id === null || item.id === id));
        if (!work.length) {
            return null;
        }
        const first = work[0].position;
        const selected = work.filter((item) => item.position === first);
        const ids = [selected[0].id];
        const keys = selected.filter((item) => item.key).map((item) => item.key);
        const stamp = ScribeKeeper.storyStamp([keeper.intake.messages[first - 1]]);
        const token = JSON.stringify([keeper.roomId, keeper.tabId, keeper.epoch, keeper.edition, keeper.retrySerial, stamp, kind, keys]);
        return Object.freeze({ kind, first, last: first, through: first, ids, keys, token });
    },

    /**
     * @param {object} keeper
     * @param {object} displayed
     * @return {Promise<void>}
     * @throws {Error}
     */
    async retryStory(keeper, displayed) {
        const stale = 'This reading has changed. Check the current pending messages before retrying.';
        ScribeKeeper.guard(keeper);
        ScribeKeeper.readable(keeper);
        ScribeKeeper.solvent(keeper);
        ScribeKeeper.recount(keeper);
        const scope = ScribeKeeper.storyRetry(keeper, false, displayed?.kind, displayed?.ids?.[0]);
        if (!scope || scope.token !== displayed?.token || scope.first !== displayed.first ||
            scope.last !== displayed.last || scope.through !== displayed.through || !ScribeKeeper.writable(keeper)) {
            throw new Error(stale);
        }
        const epoch = keeper.epoch;
        const rows = keeper.intake.messages.slice(scope.first - 1, scope.through);
        ScribeKeeper.occupy(keeper, ScribeKeeper.Busy.Looking);
        try {
            const fresh = ScribeKeeper.available(keeper, rows.map((row) => row.id), rows[0]);
            ScribeKeeper.recount(keeper);
            if (!fresh || keeper.epoch !== epoch || !ScribeKeeper.writable(keeper) ||
                ScribeKeeper.storyRetry(keeper, true, scope.kind, scope.ids[0])?.token !== scope.token) {
                throw new Error(stale);
            }
            keeper.retrySerial++;
            keeper.pollPending = false;
            await ScribeKeeper.read(keeper, null, scope);
        } finally {
            if (keeper.epoch === epoch) {
                ScribeKeeper.occupy(keeper, null);
            }
        }
    },

    /**
     * @param {object} keeper
     * @param {boolean} changed
     * @param {boolean} retryReading
     * @return {void}
     */
    rekey(keeper, changed = false, retryReading = true) {
        if (changed && !keeper.closed && keeper.reader && keeper.book?.log.checkRequests && ScribeKeeper.writable(keeper)) {
            const book = ScribeKeeper.checkBook(keeper);
            const rejected = Object.entries(book.log.checkRequests ?? {}).filter(([, request]) => request.authRejected);
            if (rejected.length) {
                keeper.checkProblem = null;
                for (const [id] of rejected) {
                    ScribeKeeper.releaseCheckRequest(book, id);
                }
                ScribeKeeper.store(keeper, ScribeStore.Kind.Book, book);
                keeper.book = book;
            }
        }
        const stop = keeper.stop;
        const failed = stop !== null && stop.reason === ScribeAdoption.Stop.Failed;
        if (!retryReading || keeper.closed || !keeper.reader || !failed || Object.hasOwn(stop, 'storyFailure') || keeper.busy === ScribeKeeper.Busy.Reading) {
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
        keeper.epoch++;
        keeper.zeta.abort?.();
        keeper.pauseCalls?.();
        keeper.busy = null;
        keeper.flight = null;
        keeper.pollPending = false;
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
            const seen = ScribeKeeper.available(keeper, cited.map((message) => message.id), latest);
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
    draft(keeper, operations, anchor, operatorText = null) {
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
        if (operations.length === settings.NoCount && !operatorText) {
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
    async file(keeper, operations, anchor, resolution = null, note = null) {
        const settings = ScribeKeeper.Settings;
        const drafted = ScribeKeeper.draft(keeper, operations, anchor, note?.operatorText);
        if (drafted === null) {
            return Object.freeze([]);
        }
        if (note?.operatorText) {
            drafted.result.entry.operatorText = ScribeStore.diagnostic(keeper.storage, note.operatorText);
            drafted.result.entry.modelResponse = ScribeStore.diagnostic(keeper.storage, note.modelResponse);
            drafted.result.entry.after = anchor.id;
        } else if (drafted.result.entry.operations.length === settings.NoCount) {
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
        keeper.zeta.abort?.();
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

            /** @return {void} */
            releaseReader: () => ScribeKeeper.lose(keeper),

            /**
             * @param {object} page
             * @return {boolean}
             */
            observe: (page) => ScribeKeeper.observe(keeper, page),

            /**
             * @param {number} first
             * @param {number} last
             * @return {Promise<void>}
             */
            checkHistory: (first, last) => ScribeKeeper.track(keeper, async () => {
                ScribeKeeper.guard(keeper);
                if (keeper.pausing || keeper.stop?.reason === ScribeAdoption.Stop.Paused) {
                    throw new Error(ScribeKeeper.Settings.Messages.Paused);
                }
                ScribeKeeper.needBook(keeper);
                ScribeKeeper.readable(keeper);
                ScribeKeeper.solvent(keeper);
                const range = keeper.campaign.checkRange;
                if (!range?.length || !keeper.book.adopted) {
                    throw new Error('Pull the chat again before checking its history.');
                }
                if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > range.length) {
                    throw new Error('Enter a message range within the last manual pull.');
                }
                const current = new Map(keeper.intake.messages.map((row) => [row.id, row]));
                const requested = range.slice(first - 1, last).filter((row) => {
                    const message = current.get(row.id);
                    if (!message || message.attributionPending || message.fingerprint !== row.fingerprint ||
                        (message.projection ?? null) !== row.projection) {
                        return false;
                    }
                    const work = ScribeLog.checkWork(keeper.book, keeper.intake.messages, false, row.id);
                    return !work.targetComplete && !work.targetDispatched;
                });
                const due = new Map((keeper.campaign.checkDue ?? []).map((row) => [row.id, row]));
                for (const row of requested) {
                    due.set(row.id, row);
                }
                const campaign = { ...keeper.campaign, checkDue: [...due.values()] };
                ScribeKeeper.store(keeper, ScribeStore.Kind.Campaign, campaign);
                keeper.campaign = campaign;
                await ScribeKeeper.check(keeper, requested);
                ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            }),

            /** @return {void} */
            attributionChanged: () => {
                keeper.compared = false;
            },

            /**
             * @param {*} settings
             * @return {Promise<void>}
             */
            adopt: (settings) => ScribeKeeper.track(keeper, () => ScribeKeeper.adopt(keeper, settings)),

            /**
             * @param {string} sourceRoomId
             * @param {string|null} messageId
             * @param {Function} loadSource
             * @return {Promise<object>}
             */
            recoverFork: (sourceRoomId, messageId, loadSource) => ScribeKeeper.track(keeper,
                () => ScribeKeeper.recoverFork(keeper, sourceRoomId, messageId, loadSource)),

            /**
             * @return {Promise<void>}
             */
            resume: () => ScribeKeeper.track(keeper, () => ScribeKeeper.resume(keeper)),

            /**
             * @param {object} displayed
             * @return {Promise<void>}
             */
            retryStory: (displayed) => ScribeKeeper.track(keeper, () => ScribeKeeper.retryStory(keeper, displayed)),
            filingRetry: (kind, id) => ScribeKeeper.storyRetry(keeper, false, kind, id),

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
             * @param {boolean} changed
             * @param {boolean} retryReading
             * @return {void}
             */
            rekey: (changed = false, retryReading = true) => {
                ScribeKeeper.rekey(keeper, changed, retryReading);
            },

            /**
             * @param {boolean} poll
             * @return {Promise<void>}
             */
            tick: (poll = true) => ScribeKeeper.track(keeper, () => ScribeKeeper.tick(keeper, poll)),

            /**
             * @return {Promise<void>}
             */
            pull: async () => {
                if (keeper.pausing || keeper.stop?.reason === ScribeAdoption.Stop.Paused) {
                    throw new Error(ScribeKeeper.Settings.Messages.Paused);
                }
                if (keeper.book === null && keeper.damaged === null) {
                    throw new Error(ScribeKeeper.Settings.Messages.NoBook);
                }
                const epoch = keeper.epoch;
                if (keeper.busy === ScribeKeeper.Busy.Checking && keeper.activity) {
                    await keeper.activity;
                    if (keeper.closed) {
                        throw new Error(ScribeKeeper.Settings.Messages.Closed);
                    }
                    if (keeper.epoch !== epoch || !keeper.reader || !ScribeKeeper.still(keeper)) {
                        throw new Error(ScribeKeeper.Settings.Messages.Watching);
                    }
                }
                ScribeKeeper.guard(keeper);
                return ScribeKeeper.track(keeper, async () => {
                    ScribeKeeper.occupy(keeper, ScribeKeeper.Busy.Pulling);
                    try {
                        await ScribeKeeper.history(keeper, true);
                        if (keeper.epoch === epoch) {
                            ScribeKeeper.flushObserved(keeper);
                        }
                    } finally {
                        if (keeper.epoch === epoch) {
                            ScribeKeeper.occupy(keeper, null);
                        }
                    }
                });
            },

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
            file: (operations, anchor, resolution = null, note = null) => ScribeKeeper.file(keeper, operations, anchor, resolution, note),

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
     * @param {{ storage: { get: Function, set: Function, remove: Function, list: Function }, roomId: string, tabId: string, zeta: { history: Function, abort?: Function }, ask: Function, askChecker?: (system: string, input: string, beforeDispatch: Function) => Promise<object>, pauseCalls?: Function, checkPassage?: Function, clock: { now: Function, today: Function }, notify: Function, claim?: () => boolean, lease?: () => boolean, profile?: () => Promise<string|null> }} options
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
            pauseCalls: options.pauseCalls,
            ask,
            askChecker: options.askChecker ?? ((system, input, beforeDispatch) => {
                beforeDispatch();
                return ask('Pedant', system, input);
            }),
            checkPassage: options.checkPassage ?? null,
            checkProgress: null,
            deciding: false,
            checkPage: null,
            checkReply: null,
            checkingQueue: null,
            followChanges: false,
            checkProblem: null,
            pendingFiling: [],
            modelReadings: [],
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
            partial: false,
            unjoined: false,
            suspectAt: null,
            mismatch: null,
            kept: [],
            retrySerial: 0,
            owed: new Map(),
            owing: null,
            lastPull: null,
            historyChecked: false,
            historyComplete: false,
            observed: 0,
            pollPending: false,
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
