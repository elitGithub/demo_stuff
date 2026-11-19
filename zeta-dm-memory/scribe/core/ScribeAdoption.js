const ScribeAdoption = Object.freeze({
    Stop: Object.freeze({
        Done: 'Done',
        Paused: 'Paused',
        Budget: 'Budget',
        Failed: 'Failed',
    }),

    Pass: Object.freeze({
        Answers: 'Answers',
        Notes: 'Notes',
        Story: 'Story',
    }),

    Settings: Object.freeze({
        LeastSize: 1,
        LeastAmount: 0,
        LongestEmptyLine: 40,
        NoCalls: 0,
        ObjectType: 'object',
        NotFound: -1,
        Last: -1,
        Nothing: '',
        Space: ' ',
        Unreadable: Object.freeze({
            Answers: 'The answer for the answered questions',
            Notes: 'The answer for the notes',
            Story: 'The answer for',
        }),
        Stretch: Object.freeze({
            Notes: ' in #',
            Story: ' #',
        }),
        RangeTo: ' to #',
        NoLine: ' held no line that could be read.',
        Arguments: Object.freeze({
            Options: 'The options are missing.',
            Messages: 'messages is not a list.',
            ReadThrough: 'readThrough is not a whole number within the message list.',
            Notes: 'notes is not a list.',
            Player: 'player is not a string.',
            Profile: 'profile is neither a string nor null.',
            Log: 'log is not an object.',
            Size: 'size is not a positive whole number.',
        }),
        Amounts: Object.freeze(['budget', 'spent']),
        NotAmount: ' is not a finite number of at least 0.',
        Callbacks: Object.freeze(['ask', 'save', 'record', 'progress', 'paused']),
        NotFunction: ' is not a function.',
        SharedId: 'Two messages share the id ',
        FullStop: '.',
        TextType: 'string',
        ShortestContentWord: 4,
        CommonWords: Object.freeze([
            'about',
            'after',
            'again',
            'also',
            'been',
            'before',
            'being',
            'come',
            'could',
            'does',
            'each',
            'even',
            'ever',
            'from',
            'have',
            'here',
            'into',
            'just',
            'like',
            'made',
            'make',
            'many',
            'more',
            'most',
            'much',
            'must',
            'never',
            'only',
            'other',
            'over',
            'said',
            'same',
            'says',
            'should',
            'some',
            'still',
            'such',
            'than',
            'that',
            'their',
            'them',
            'then',
            'there',
            'these',
            'they',
            'this',
            'those',
            'very',
            'were',
            'what',
            'when',
            'where',
            'which',
            'while',
            'will',
            'with',
            'would',
            'your',
        ]),
        Apostrophe: "'",
        DoubleQuote: '"',
        NormalForm: 'NFC',
        Unwrapped: '$2',
        Unquoted: '$1',
        DressPasses: 4,
        FewestQuoteWords: 2,

        /**
         * @return {RegExp}
         */
        get Format() {
            return /\p{Cf}/gu;
        },

        /**
         * @return {RegExp}
         */
        get Spacing() {
            return /[\s\p{Cc}]+/gu;
        },

        /**
         * @return {RegExp}
         */
        get Apostrophes() {
            return /[’‘ʼ]/gu;
        },

        /**
         * @return {RegExp}
         */
        get DoubleQuotes() {
            return /["«»“”„‟⹂〝〞〟＂『』﹃﹄]/gu;
        },

        /**
         * @return {RegExp}
         */
        get Wrapped() {
            return /^(\*\*|\*|_|`)([\s\S]*)\1$/u;
        },

        /**
         * @return {RegExp}
         */
        get Quoted() {
            return /^["'“‘]([\s\S]*)["'”’]$/u;
        },

        /**
         * @return {RegExp}
         */
        get LeadingEllipsis() {
            return /^(?:\.\.\.|…)/u;
        },

        /**
         * @return {RegExp}
         */
        get TrailingEllipsis() {
            return /(?:\.\.\.|…)$/u;
        },
    }),

    /**
     * @param {{ read: Object<string, number> }} log
     * @param {readonly object[]} messages
     * @param {number} size
     * @return {readonly object[]}
     */
    next(log, messages, size) {
        const settings = ScribeAdoption.Settings;
        const count = size >= settings.LeastSize ? Math.floor(size) : settings.LeastSize;
        const start = messages.findIndex(
            /**
             * @param {{ id: string }} message
             * @return {boolean}
             */
            (message) => !message.attributionPending && !Object.hasOwn(log.read, message.id),
        );
        const stretch = [];
        if (start === settings.NotFound) {
            return Object.freeze(stretch);
        }
        for (const message of messages.slice(start, start + count)) {
            if (message.attributionPending || Object.hasOwn(log.read, message.id)) {
                break;
            }
            stretch.push(message);
        }
        return Object.freeze(stretch);
    },

    /**
     * @param {object} question
     * @param {readonly object[]} messages
     * @return {boolean}
     */
    canAnswer(question, messages) {
        return question.answer !== null && !question.dismissed && !messages[question.position - 1]?.attributionPending;
    },

    /**
     * @param {*} value
     * @return {boolean}
     */
    amount(value) {
        return Number.isFinite(value) && value >= ScribeAdoption.Settings.LeastAmount;
    },

    /**
     * @param {string} text
     * @return {string}
     */
    clean(text) {
        const settings = ScribeAdoption.Settings;
        return text.replace(settings.Format, settings.Nothing).replace(settings.Spacing, settings.Space).trim();
    },

    /**
     * @param {string} text
     * @return {string}
     */
    folded(text) {
        const settings = ScribeAdoption.Settings;
        return ScribeAdoption.clean(text)
            .replace(settings.Apostrophes, settings.Apostrophe)
            .replace(settings.DoubleQuotes, settings.DoubleQuote)
            .toLowerCase()
            .normalize(settings.NormalForm);
    },

    /**
     * @param {object} message
     * @param {string} quote
     * @return {boolean}
     */
    quoted(message, quote) {
        const settings = ScribeAdoption.Settings;
        let current = ScribeAdoption.clean(quote);
        for (let pass = 0; pass < settings.DressPasses; pass++) {
            const next = current
                .replace(settings.Wrapped, settings.Unwrapped)
                .trim()
                .replace(settings.Quoted, settings.Unquoted)
                .trim()
                .replace(settings.LeadingEllipsis, settings.Nothing)
                .trim()
                .replace(settings.TrailingEllipsis, settings.Nothing)
                .trim();
            if (next === current) {
                break;
            }
            current = next;
        }
        if (ScribeText.words(current).length < settings.FewestQuoteWords) {
            return false;
        }
        const text = ScribeAdoption.folded(ScribeIntake.transcript([message]));
        return ScribeAnalyzer.found(text, ScribeAnalyzer.index(text), ScribeAdoption.folded(current));
    },

    /**
     * @param {{ spent: number, calls: number, unpriced: number }} job
     * @param {string} stop
     * @param {string|null} problem
     * @return {Readonly<{ stop: string, problem: string|null, spent: number, calls: number, unpriced: number }>}
     */
    finish(job, stop, problem) {
        return Object.freeze({ stop, problem, spent: job.spent, calls: job.calls, unpriced: job.unpriced });
    },

    /**
     * @param {*} options
     * @return {string|null}
     */
    check(options) {
        const settings = ScribeAdoption.Settings;
        const problems = settings.Arguments;
        if (options === null || typeof options !== 'object') {
            return problems.Options;
        }
        if (!Array.isArray(options.messages)) {
            return problems.Messages;
        }
        if (options.readThrough !== undefined && (!Number.isSafeInteger(options.readThrough) ||
            options.readThrough < 0 || options.readThrough > options.messages.length)) {
            return problems.ReadThrough;
        }
        const seen = new Set();
        for (const message of options.messages) {
            if (seen.has(message.id)) {
                return settings.SharedId + message.id + settings.FullStop;
            }
            seen.add(message.id);
        }
        if (!Array.isArray(options.notes)) {
            return problems.Notes;
        }
        if (typeof options.player !== 'string') {
            return problems.Player;
        }
        const profile = options.profile;
        if (profile !== undefined && profile !== null && typeof profile !== 'string') {
            return problems.Profile;
        }
        if (options.log === null || typeof options.log !== 'object') {
            return problems.Log;
        }
        if (!Number.isSafeInteger(options.size) || options.size < settings.LeastSize) {
            return problems.Size;
        }
        for (const name of settings.Amounts) {
            if (!ScribeAdoption.amount(options[name])) {
                return name + settings.NotAmount;
            }
        }
        for (const name of settings.Callbacks) {
            if (typeof options[name] !== 'function') {
                return name + settings.NotFunction;
            }
        }
        if (options.atBudget !== undefined && typeof options.atBudget !== 'function') {
            return 'atBudget' + settings.NotFunction;
        }
        return null;
    },

    /**
     * @param {object} state
     * @param {string} id
     * @return {{ text: string, cite: string, position: number, about: string[] }|null}
     */
    entry(state, id) {
        const settings = ScribeAdoption.Settings;
        const statuses = ScribeReplay.Status;
        const fact = state.facts.find(
            /**
             * @param {{ id: string, status: string }} item
             * @return {boolean}
             */
            (item) => item.id === id && (item.status === statuses.InForce || item.status === statuses.Ended),
        );
        if (fact !== undefined) {
            const subject = state.subjects.find(
                /**
                 * @param {{ id: string }} item
                 * @return {boolean}
                 */
                (item) => item.id === fact.subject,
            );
            const names = subject === undefined ? [] : [subject.label, subject.name, ...subject.aka];
            if (typeof fact.cite !== settings.TextType) {
                return null;
            }
            return { text: fact.text, cite: fact.cite, position: fact.position, about: [fact.text, ...names] };
        }
        const thread = state.threads.find(
            /**
             * @param {{ id: string }} item
             * @return {boolean}
             */
            (item) => item.id === id,
        );
        if (thread === undefined) {
            return null;
        }
        const closed = thread.closed;
        const how = closed === null || closed.how.trim() === settings.Nothing ? null : closed.how;
        const cite = closed === null ? thread.cite : closed.cite;
        const position = closed === null ? thread.position : closed.position;
        if (typeof cite !== settings.TextType || !Number.isSafeInteger(position)) {
            return null;
        }
        return { text: how ?? thread.text, cite, position, about: [thread.text, how ?? settings.Nothing] };
    },

    /**
     * @param {string} said
     * @param {readonly string[]} about
     * @return {boolean}
     */
    related(said, about) {
        const settings = ScribeAdoption.Settings;
        /**
         * @param {string} text
         * @return {string[]}
         */
        const content = (text) =>
            ScribeText.words(text).filter(
                /**
                 * @param {string} word
                 * @return {boolean}
                 */
                (word) =>
                    Array.from(word).length >= settings.ShortestContentWord && !settings.CommonWords.includes(word),
            );
        const held = new Set(about.flatMap(content));
        return content(said).some(
            /**
             * @param {string} word
             * @return {boolean}
             */
            (word) => held.has(word),
        );
    },

    /**
     * @param {object} job
     * @param {{ pass: string, first: number|null, last: number|null }} step
     * @param {number} stored
     * @param {readonly object[]} refusedLines
     * @param {readonly object[]} refusedOperations
     * @return {Promise<void>}
     */
    async report(job, step, stored, refusedLines, refusedOperations) {
        const read = job.roomOrder.filter(
            /**
             * @param {string} id
             * @return {boolean}
             */
            (id) => Object.hasOwn(job.log.read, id),
        ).length;
        await job.progress(
            Object.freeze({
                pass: step.pass,
                first: step.first,
                last: step.last,
                read,
                total: job.roomOrder.length,
                spent: job.spent,
                calls: job.calls,
                unpriced: job.unpriced,
                stored,
                refusedLines,
                refusedOperations,
            }),
        );
    },

    /**
     * @param {object} job
     * @param {{ pass: string, system: string, user: string }} step
     * @param {*} source
     * @return {Promise<void>}
     * @throws {Error}
     */
    async stopped(job, step, source) {
        const settings = ScribeAdoption.Settings;
        const given = source !== null && typeof source === settings.ObjectType;
        const stopped = given && Number.isSafeInteger(source.stopped) ? source.stopped : settings.NoCalls;
        for (let stop = settings.NoCalls; stop < stopped; stop++) {
            job.calls++;
            job.unpriced++;
            await job.record(
                Object.freeze({
                    sequence: null,
                    pass: step.pass,
                    system: step.system,
                    input: step.user,
                    answer: null,
                    readable: true,
                    stopped: true,
                }),
            );
        }
    },

    /**
     * @param {object} job
     * @param {{ pass: string, origin: string, first: number|null, last: number|null, system: string, user: string, messages: readonly object[], state: object, notes: readonly object[], questions: readonly object[] }} step
     * @return {Promise<Readonly<{ stop: string, problem: string|null, spent: number, calls: number, unpriced: number }>|null>}
     * @throws {Error}
     */
    async consult(job, step) {
        const settings = ScribeAdoption.Settings;
        const stops = ScribeAdoption.Stop;
        if (await job.paused()) {
            return ScribeAdoption.finish(job, stops.Paused, null);
        }
        if (job.spent >= job.budget || job.atBudget?.()) {
            return ScribeAdoption.finish(job, stops.Budget, null);
        }
        job.calls++;
        let answer = null;
        try {
            answer = await job.ask(step.system, step.user, step.questions);
        } catch (error) {
            await ScribeAdoption.stopped(job, step, error);
            throw error;
        }
        await ScribeAdoption.stopped(job, step, answer);
        if (ScribeAdoption.amount(answer.cost)) {
            job.spent += answer.cost;
        } else {
            job.unpriced++;
        }
        const parsed = ScribeAnswer.parse(answer.text);
        const wordy = answer.text.split(ScribeAnswer.Settings.LineBreak).some(
            /**
             * @param {string} line
             * @return {boolean}
             */
            (line) => Array.from(line.trim()).length > settings.LongestEmptyLine,
        );
        const kept = { pass: step.pass, system: step.system, input: step.user, answer: answer.text };
        if (parsed.operations.length === 0 && (parsed.refused.length > 0 || wordy)) {
            await job.record(Object.freeze({ sequence: null, ...kept, readable: false }));
            await ScribeAdoption.report(job, step, 0, parsed.refused, []);
            const range =
                step.first === null
                    ? settings.Nothing
                    : settings.Stretch[step.pass] + step.first + settings.RangeTo + step.last;
            return ScribeAdoption.finish(job, stops.Failed, settings.Unreadable[step.pass] + range + settings.NoLine);
        }
        const story = step.pass === ScribeAdoption.Pass.Story;
        const operations = [];
        const unquoted = [];
        const shown = new Map();
        for (const message of step.messages) {
            shown.set(message.position, message);
        }
        for (const operation of parsed.operations) {
            if (!story || operation.type !== ScribeAnswer.Type.Contradiction) {
                operations.push(operation);
                continue;
            }
            const said = shown.get(operation.position);
            if (said === undefined) {
                unquoted.push(Object.freeze({ operation, reason: ScribeLog.Reason.Citation }));
                continue;
            }
            const saidFound = ScribeAdoption.quoted(said, operation.said);
            if (operation.entry !== null) {
                const entry = ScribeAdoption.entry(step.state, operation.entry);
                if (entry === null || entry.position >= operation.position) {
                    unquoted.push(Object.freeze({ operation, reason: ScribeLog.Reason.Reference }));
                } else if (!saidFound) {
                    unquoted.push(Object.freeze({ operation, reason: ScribeLog.Reason.Quote }));
                } else if (!ScribeAdoption.related(operation.said, entry.about)) {
                    unquoted.push(Object.freeze({ operation, reason: ScribeLog.Reason.Mismatch }));
                } else {
                    operations.push(
                        Object.freeze({
                            ...operation,
                            earlier: entry.position,
                            before: entry.text,
                            earlierCite: entry.cite,
                        }),
                    );
                }
                continue;
            }
            const before = shown.get(operation.earlier);
            if (saidFound && before !== undefined && ScribeAdoption.quoted(before, operation.before)) {
                operations.push(Object.freeze({ ...operation, earlierCite: before.id }));
            } else {
                unquoted.push(Object.freeze({ operation, reason: ScribeLog.Reason.Quote }));
            }
        }
        const stretch = { messages: step.messages, origin: step.origin, sources: job.places };
        const answers = step.pass === ScribeAdoption.Pass.Answers;
        const order = answers ? job.roomOrder : job.order;
        const pending = answers ? job.pending : null;
        let result = null;
        try {
            result = ScribeLog.append(job.log, step.state, operations, stretch);
        } catch (error) {
            if (error.message !== ScribeLog.Settings.StaleState) {
                throw error;
            }
            result = ScribeLog.append(job.log, ScribeReplay.run(job.log, order, pending), operations, stretch);
        }
        for (const note of step.notes) {
            job.log.notes.push(note.text);
        }
        for (const question of step.questions) {
            ScribeLog.rule(job.log, ScribeReplay.run(job.log, order, pending), {
                type: ScribeLog.Ruling.Dismiss,
                question: question.id,
            });
        }
        await job.save(job.log, step.questions);
        await job.record(Object.freeze({ sequence: result.entry.sequence, ...kept, readable: true }));
        const refused = Object.freeze([...result.refused, ...unquoted]);
        await ScribeAdoption.report(job, step, result.entry.operations.length, parsed.refused, refused);
        return null;
    },

    /**
     * @param {{ messages: readonly object[], readThrough?: number, notes: readonly object[], player: string, profile?: string|null, log: object, size: number, budget: number, spent: number, atBudget?: Function, ask: Function, save: Function, record: Function, progress: Function, paused: Function }} options
     * @return {Promise<Readonly<{ stop: string, problem: string|null, spent: number, calls: number, unpriced: number }>>}
     */
    async run(options) {
        const settings = ScribeAdoption.Settings;
        const stops = ScribeAdoption.Stop;
        const passes = ScribeAdoption.Pass;
        const origins = ScribeLog.Origin;
        const job = { spent: settings.LeastAmount, calls: 0, unpriced: 0 };
        try {
            const problem = ScribeAdoption.check(options);
            if (problem !== null) {
                const given = options !== null && typeof options === 'object' ? options.spent : null;
                job.spent = ScribeAdoption.amount(given) ? given : settings.LeastAmount;
                return ScribeAdoption.finish(job, stops.Failed, problem);
            }
            const room = options.messages;
            const roomOrder = room.map((message) => message.id);
            const end = options.readThrough ?? room.length;
            Object.assign(job, options, {
                messages: room.slice(0, end),
                order: roomOrder.slice(0, end),
                roomOrder,
                pending: new Set(room.filter((message) => message.attributionPending).map((message) => message.id)),
                places: new Map(room.map((message) => [message.position, message])),
                calls: 0,
                unpriced: 0,
            });
            while (!(await job.paused())) {
                let state = ScribeReplay.run(job.log, job.order);
                const answerState = job.log.nextQuestion > 1 && (end < room.length || job.pending.size)
                    ? ScribeReplay.run(job.log, roomOrder, job.pending) : state;
                const answered = answerState.questions.filter(
                    /**
                     * @param {{ answer: string|null, dismissed: boolean }} question
                     * @return {boolean}
                     */
                    (question) => ScribeAdoption.canAnswer(question, room),
                );
                if (answered.length > 0) {
                    const cited = new Set();
                    for (const question of answered) {
                        cited.add(question.cite);
                    }
                    const answersStop = await ScribeAdoption.consult(job, {
                        pass: passes.Answers,
                        origin: origins.Answers,
                        first: null,
                        last: null,
                        system: ScribeAnalyzer.AnswersPrompt,
                        user: ScribeAnalyzer.answersInput(answerState, job.player, answered),
                        messages: room.filter(
                            /**
                             * @param {{ id: string }} message
                             * @return {boolean}
                             */
                            (message) => cited.has(message.id),
                        ),
                        state: answerState,
                        notes: [],
                        questions: answered,
                    });
                    if (answersStop !== null) {
                        return answersStop;
                    }
                    continue;
                }
                const stretch = ScribeAdoption.next(job.log, job.messages, job.size);
                const reading = stretch.length > 0;
                const first = reading ? stretch[0].position : null;
                const last = reading ? stretch.at(settings.Last).position : null;
                const filed = new Set();
                for (const text of job.log.notes) {
                    filed.add(ScribeText.words(text).join(settings.Space));
                }
                const fresh = job.notes.filter(
                    /**
                     * @param {{ text: string, position: number }} note
                     * @return {boolean}
                     */
                    (note) =>
                        (end === room.length || note.position <= job.messages.at(settings.Last)?.position) &&
                        job.places.has(note.position) &&
                        !job.places.get(note.position).attributionPending &&
                        (!reading || note.position <= last) &&
                        !filed.has(ScribeText.words(note.text).join(settings.Space)),
                );
                if (fresh.length > 0) {
                    const positions = new Set();
                    for (const note of fresh) {
                        positions.add(note.position);
                    }
                    const notesStop = await ScribeAdoption.consult(job, {
                        pass: passes.Notes,
                        origin: origins.Notes,
                        first,
                        last,
                        system: ScribeAnalyzer.NotesPrompt,
                        user: ScribeAnalyzer.notesInput(state, job.player, fresh),
                        messages: job.messages.filter(
                            /**
                             * @param {{ position: number }} message
                             * @return {boolean}
                             */
                            (message) => positions.has(message.position),
                        ),
                        state,
                        notes: fresh,
                        questions: [],
                    });
                    if (notesStop !== null) {
                        return notesStop;
                    }
                    state = ScribeReplay.run(job.log, job.order);
                }
                if (!reading) {
                    return ScribeAdoption.finish(job, stops.Done, null);
                }
                if (ScribeIntake.transcript(stretch) === settings.Nothing) {
                    const result = ScribeLog.append(job.log, state, [], { messages: stretch, origin: origins.Story });
                    await job.save(job.log);
                    await ScribeAdoption.report(
                        job,
                        { pass: passes.Story, first, last },
                        result.entry.operations.length,
                        [],
                        result.refused,
                    );
                    continue;
                }
                const storyStop = await ScribeAdoption.consult(job, {
                    pass: passes.Story,
                    origin: origins.Story,
                    first,
                    last,
                    system: ScribeAnalyzer.Prompt,
                    user: ScribeAnalyzer.input(state, job.player, stretch, job.profile),
                    messages: stretch,
                    state,
                    notes: [],
                    questions: [],
                });
                if (storyStop !== null) {
                    return storyStop;
                }
            }
            return ScribeAdoption.finish(job, stops.Paused, null);
        } catch (error) {
            const described = error !== null && typeof error === 'object' && typeof error.message === 'string';
            return ScribeAdoption.finish(job, stops.Failed, described ? error.message : String(error));
        }
    },
});
