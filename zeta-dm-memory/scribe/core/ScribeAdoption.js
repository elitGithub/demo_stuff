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
            (message) => !Object.hasOwn(log.read, message.id),
        );
        const stretch = [];
        if (start === settings.NotFound) {
            return Object.freeze(stretch);
        }
        for (const message of messages.slice(start, start + count)) {
            if (Object.hasOwn(log.read, message.id)) {
                break;
            }
            stretch.push(message);
        }
        return Object.freeze(stretch);
    },

    /**
     * @param {*} value
     * @return {boolean}
     */
    amount(value) {
        return Number.isFinite(value) && value >= ScribeAdoption.Settings.LeastAmount;
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
        return null;
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
        const read = job.messages.filter(
            /**
             * @param {{ id: string }} message
             * @return {boolean}
             */
            (message) => Object.hasOwn(job.log.read, message.id),
        ).length;
        await job.progress(
            Object.freeze({
                pass: step.pass,
                first: step.first,
                last: step.last,
                read,
                total: job.messages.length,
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
        if (job.spent >= job.budget) {
            return ScribeAdoption.finish(job, stops.Budget, null);
        }
        job.calls++;
        const answer = await job.ask(step.system, step.user);
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
        const stretch = { messages: step.messages, origin: step.origin };
        let result = null;
        try {
            result = ScribeLog.append(job.log, step.state, parsed.operations, stretch);
        } catch (error) {
            if (error.message !== ScribeLog.Settings.StaleState) {
                throw error;
            }
            result = ScribeLog.append(job.log, ScribeReplay.run(job.log, job.order), parsed.operations, stretch);
        }
        for (const note of step.notes) {
            job.log.notes.push(note.text);
        }
        for (const question of step.questions) {
            ScribeLog.rule(job.log, ScribeReplay.run(job.log, job.order), {
                type: ScribeLog.Ruling.Dismiss,
                question: question.id,
            });
        }
        await job.save(job.log);
        await job.record(Object.freeze({ sequence: result.entry.sequence, ...kept, readable: true }));
        await ScribeAdoption.report(job, step, result.entry.operations.length, parsed.refused, result.refused);
        return null;
    },

    /**
     * @param {{ messages: readonly object[], notes: readonly object[], player: string, profile?: string|null, log: object, size: number, budget: number, spent: number, ask: Function, save: Function, record: Function, progress: Function, paused: Function }} options
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
            Object.assign(job, options, { order: [], places: new Map(), calls: 0, unpriced: 0 });
            for (const message of job.messages) {
                job.order.push(message.id);
                job.places.set(message.position, message);
            }
            while (!(await job.paused())) {
                let state = ScribeReplay.run(job.log, job.order);
                const answered = state.questions.filter(
                    /**
                     * @param {{ answer: string|null, dismissed: boolean }} question
                     * @return {boolean}
                     */
                    (question) => question.answer !== null && !question.dismissed,
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
                        user: ScribeAnalyzer.answersInput(state, job.player, answered),
                        messages: job.messages.filter(
                            /**
                             * @param {{ id: string }} message
                             * @return {boolean}
                             */
                            (message) => cited.has(message.id),
                        ),
                        state,
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
                        job.places.has(note.position) &&
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
