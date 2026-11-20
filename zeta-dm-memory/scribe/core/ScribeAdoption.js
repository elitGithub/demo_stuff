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
     * @param {number} minimum
     * @return {boolean}
     */
    quoted(message, quote, minimum = ScribeAdoption.Settings.FewestQuoteWords) {
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
        if (ScribeText.words(current).length < minimum) {
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
     * @param {object} operation
     * @param {object} item
     * @param {object} message
     * @param {object} state
     * @param {Map<number, object>} sources
     * @return {object|null}
     */
    bind(operation, item, message, state, sources) {
        const block = message.blocks.find((source) => source.blockNumber === item.blockNumber);
        if (!block || !block.text.includes(item.quote) ||
            !(ScribeIntake.Originals.get(block) ?? block.text).includes(item.quote) ||
            !ScribeAdoption.quoted({ ...message, text: block.text }, item.quote, 1)) {
            return null;
        }
        const types = ScribeAnswer.Type;
        if (operation.position !== undefined && operation.position !== item.messageNumber ||
            operation.type === types.Scene && (item.messageNumber < operation.first || item.messageNumber > operation.last)) {
            return null;
        }
        const statement = operation.text ?? operation.reason ?? operation.summary ?? operation.marker ?? operation.how;
        const quote = ScribeAdoption.folded(item.quote);
        const quotedWords = ScribeAnalyzer.index(quote);
        const supports = (text) => ScribeAnalyzer.found(quote, quotedWords, ScribeAdoption.folded(text));
        const excerpt = statement && item.quote.includes(statement) ? statement : item.quote;
        const quoteStart = block.text.indexOf(item.quote) + item.quote.indexOf(excerpt);
        const before = block.text.slice(0, quoteStart).split(/[.!?\n]/).at(-1);
        const after = block.text.slice(quoteStart + excerpt.length).split(/[.!?\n]/)[0];
        const sentence = ScribeAdoption.folded(before + excerpt + after);
        const indexedSentence = ScribeAnalyzer.index(sentence);
        const pronoun = /^(?:she|he|they|it|her|his|their|its)\b/.test(sentence);
        const antecedent = pronoun ? ScribeAdoption.folded(block.text.slice(0, quoteStart - before.length)
            .trim().split(/[.!?\n]+/).filter(Boolean).at(-1) ?? '') : '';
        const named = (label) => {
            const subject = state.subjects.find((entry) => entry.label === label);
            const names = subject ? [subject.label, subject.name, ...subject.aka] : [label];
            return names.some((name) => {
                const folded = ScribeAdoption.folded(name);
                return ScribeAnalyzer.found(sentence, indexedSentence, folded) ||
                    folded === ScribeAdoption.folded(block.speaker) && (operation.type === types.Subject ||
                        /\b(?:i|me|my|mine|we|our|us)\b/.test(sentence) || item.attribution === 'claimed') ||
                    antecedent && ScribeAnalyzer.found(antecedent, ScribeAnalyzer.index(antecedent), folded);
            });
        };
        if (operation.label && !named(operation.label) || operation.target && !named(operation.target) ||
            operation.owner && !named(operation.owner) || operation.name && !named(operation.name)) {
            return null;
        }
        if (operation.type === types.Scene) {
            const earlier = state.scenes.find((scene) => scene.firstPosition === operation.first);
            const names = new Set();
            const text = [];
            for (const [number, source] of sources) {
                if (number >= operation.first && number <= operation.last && !source.attributionPending) {
                    for (const part of source.blocks) {
                        names.add(ScribeAdoption.folded(part.speaker));
                        text.push(part.text);
                    }
                }
            }
            const sceneText = ScribeAdoption.folded(text.join('\n'));
            const index = ScribeAnalyzer.index(sceneText);
            const present = (name) => names.has(ScribeAdoption.folded(name)) ||
                ScribeAnalyzer.found(sceneText, index, ScribeAdoption.folded(name));
            if (operation.place !== earlier?.place && !present(operation.place) ||
                operation.present.some((person) => !present(person.label) && !earlier?.present.some((prior) =>
                    state.subjects.some((subject) => subject.id === prior.subject && subject.label === person.label)))) {
                return null;
            }
        }
        const promised = /\b(?:promise(?:s|d)?|offer(?:s|ed)? to|will (?:give|hand|bring|return|lend)|(?:i|we)'ll (?:give|hand|bring|return|lend))\b/.test(sentence);
        const inferred = /\b(?:suspect(?:s|ed)?|guess(?:es|ed)?|probably|perhaps|might be|wonder(?:s|ed)? (?:if|whether))\b/.test(sentence);
        const reporting = /\b(?:claim(?:s|ed)?|says?|said|report(?:s|ed)?|allege(?:s|d)?|insist(?:s|ed)?|told)\b/;
        const clauseBefore = before.split(/(?:;|,\s*(?:but|while|then|and then|meanwhile)\s+|\s+and then\s+)/i).at(-1);
        const report = reporting.test(clauseBefore + excerpt) && !reporting.test(statement ?? '');
        if (statement && report && item.attribution === 'witnessed') {
            return null;
        }
        if (promised && item.attribution !== 'promised' || inferred && !promised && item.attribution !== 'inferred' ||
            item.attribution === 'ruled' && (!message.fromPlayer || block.role !== ScribeIntake.Role.Player ||
                !/\b(?:i rule|my ruling|canonically|retcon|correction|out of character)\b/.test(sentence)) ||
            operation.category === 'belonging' && (promised || inferred || ['promised', 'inferred'].includes(item.attribution))) {
            return null;
        }
        const scope = ScribeCategory.scope({ category: operation.category, text: sentence });
        if ((item.form || item.dimension) && operation.category !== 'build' ||
            item.form && item.form !== scope.form && (scope.form || !supports(item.form + ' form')) ||
            item.dimension && item.dimension !== scope.dimension && (scope.dimension || !supports(item.dimension))) {
            return null;
        }
        const form = scope.form ?? item.form;
        const dimension = scope.dimension ?? item.dimension;
        const physical = { eyes: /\b(?:eyes?|irises?|iris)\b/, hair: /\b(?:hair|braid|curls|locks)\b/,
            skin: /\b(?:skin|complexion)\b/ };
        if (Object.hasOwn(physical, operation.category) && !physical[operation.category].test(sentence) &&
            Object.values(physical).some((pattern) => pattern.test(sentence))) {
            return null;
        }
        if (item.event && !supports(item.event) || item.time && !supports(item.time) ||
            item.day && item.day !== operation.day && !supports(String(item.day)) ||
            item.related?.some((name) => name !== block.speaker && !supports(name)) ||
            item.subject && item.subject !== operation.label && item.subject !== block.speaker && !supports(item.subject) ||
            item.attribute && item.attribute !== operation.category && item.attribute !== operation.type && !supports(item.attribute)) {
            return null;
        }
        if (operation.type !== types.Question && statement) {
            const claim = ScribeAdoption.folded(statement);
            const words = new Set(ScribeText.words(quote + ' ' + block.speaker + ' ' + operation.label));
            const grammar = new Set(['a', 'an', 'the', 'and', 'of', 'to', 'at', 'for', 'in', 'as', 'is', 'was', 'has',
                'her', 'his', 'they', 'their', 'she', 'he', 'it', 'its', 'my', 'me', 'i', 'am', 'had', 'by', 'with']);
            if (!supports(statement) &&
                ScribeText.words(claim).some((word) => !grammar.has(word) && !words.has(word))) {
                return null;
            }
            const negative = /\b(?:not|never|no longer|without|cannot|can't|isn't|wasn't|didn't)\b/;
            if (negative.test(sentence) && !negative.test(claim)) {
                return null;
            }
        }
        const value = statement ?? operation.summary ?? operation.marker ?? operation.how ?? operation.name ??
            operation.said ?? operation.kind ?? operation.label;
        if (item.value !== undefined && item.value !== null && value !== undefined &&
            !ScribeAdoption.folded(value).includes(ScribeAdoption.folded(item.value))) {
            return null;
        }
        const evidence = {
            section: item.section, row: item.row, messageNumber: message.position, messageId: message.id,
            fingerprint: message.fingerprint, blockNumber: block.blockNumber, speaker: block.speaker,
            quote: item.quote, attribution: item.attribution, form, dimension,
            event: item.event ?? null, day: item.day ?? operation.day ?? null, time: item.time ?? null,
            subject: item.subject ?? operation.label ?? null, attribute: item.attribute ?? operation.category ?? operation.type,
            value: item.value ?? value ?? null, related: item.related ?? (operation.target ? [operation.target] : []),
        };
        return { ...operation, form, dimension, evidence };
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
        const story = step.pass === ScribeAdoption.Pass.Story;
        const protocol = story ? ScribeAnswer.parseStory(answer.text) : null;
        const parsed = story ? { operations: [], refused: protocol.refused } : ScribeAnswer.parse(answer.text);
        const shown = new Map(step.messages.map((message) => [message.position, message]));
        const owes = new Set();
        const unquoted = [];
        if (story) {
            const claimed = new Set();
            let unassigned = [...protocol.read.keys()].some((number) => !shown.has(number));
            for (const problem of parsed.refused) {
                const item = protocol.evidence.get(protocol.rejectedRows.get(problem));
                if (item && shown.has(item.messageNumber)) {
                    owes.add(item.messageNumber);
                } else {
                    unassigned = true;
                }
            }
            for (const [key, item] of protocol.evidence) {
                if (!shown.has(item.messageNumber)) {
                    unassigned = true;
                } else if (!protocol.rows.has(key)) {
                    owes.add(item.messageNumber);
                }
            }
            for (const [key, operation] of protocol.rows) {
                if (operation.type === ScribeAnswer.Type.Contradiction) {
                    continue;
                }
                const item = protocol.evidence.get(key);
                const number = item?.messageNumber ?? operation.position ?? operation.last;
                const message = shown.get(number);
                const bound = item && message ? ScribeAdoption.bind(operation, item, message, step.state, job.places) : null;
                if (bound) {
                    parsed.operations.push(bound);
                    claimed.add(number);
                } else {
                    unquoted.push({ operation, reason: item && message ? ScribeLog.Reason.Quote : ScribeLog.Reason.Citation });
                    if (!message) {
                        unassigned = true;
                    }
                    owes.add(number);
                    if (operation.position !== undefined) {
                        owes.add(operation.position);
                    }
                }
            }
            for (const number of shown.keys()) {
                if (unassigned || protocol.read.get(number) !== (claimed.has(number) ? 'read' : 'no change')) {
                    owes.add(number);
                }
            }
        }
        const wordy = answer.text.split(ScribeAnswer.Settings.LineBreak).some(
            /**
             * @param {string} line
             * @return {boolean}
             */
            (line) => Array.from(line.trim()).length > settings.LongestEmptyLine,
        );
        const kept = { pass: step.pass, system: step.system, input: step.user, answer: answer.text };
        if (!story && parsed.operations.length === 0 && (parsed.refused.length > 0 || wordy)) {
            await job.record(Object.freeze({ sequence: null, ...kept, readable: false }));
            await ScribeAdoption.report(job, step, 0, parsed.refused, []);
            const range =
                step.first === null
                    ? settings.Nothing
                    : settings.Stretch[step.pass] + step.first + settings.RangeTo + step.last;
            return ScribeAdoption.finish(job, stops.Failed, settings.Unreadable[step.pass] + range + settings.NoLine);
        }
        const operations = parsed.operations;
        const stretch = { messages: step.messages, origin: step.origin, sources: job.places, results: protocol?.read };
        const answers = step.pass === ScribeAdoption.Pass.Answers;
        const order = answers ? job.roomOrder : job.order;
        const pending = answers ? job.pending : null;
        const state = step.state.revision === job.log.revision ? step.state :
            ScribeReplay.run(job.log, order, pending, job.fingerprints, null, null, job.room);
        let filing = operations;
        if (story) {
            for (const { operation } of unquoted) {
                if (operation.evidence) {
                    owes.add(operation.evidence.messageNumber);
                }
            }
            while (true) {
                const gap = step.messages.findIndex((message) => owes.has(message.position));
                stretch.messages = gap < 0 ? step.messages : step.messages.slice(0, gap);
                if (!stretch.messages.length) {
                    break;
                }
                const end = stretch.messages.at(-1).position;
                filing = operations.filter((operation) => operation.evidence.messageNumber <= end);
                const staged = { ...job.log, entries: [...job.log.entries], read: { ...job.log.read } };
                const trial = ScribeLog.append(staged, state, filing, stretch);
                if (!trial.refused.length) {
                    break;
                }
                unquoted.push(...trial.refused);
                for (const { operation } of trial.refused) {
                    owes.add(operation.evidence.messageNumber);
                }
            }
            if (!stretch.messages.length) {
                await job.record(Object.freeze({ sequence: null, ...kept, readable: false }));
                await ScribeAdoption.report(job, step, 0, parsed.refused, unquoted);
                return ScribeAdoption.finish(job, stops.Failed, settings.Unreadable.Story + ' #' + step.first +
                    settings.RangeTo + step.last + settings.NoLine);
            }
        }
        const result = ScribeLog.append(job.log, state, filing, stretch);
        for (const note of step.notes) {
            job.log.notes.push(note.text);
        }
        for (const question of step.questions) {
            const state = ScribeReplay.run(job.log, order, pending, job.fingerprints, null, null, job.room);
            const entry = ScribeLog.rule(job.log, state, {
                type: ScribeLog.Ruling.Dismiss,
                question: question.id,
            });
            ScribeLog.link(entry, state, [], step.messages);
        }
        await job.save(job.log, step.questions);
        await job.record(Object.freeze({ sequence: result.entry.sequence, ...kept, readable: !owes.size }));
        const refused = Object.freeze([...result.refused, ...unquoted]);
        await ScribeAdoption.report(job, step, result.entry.operations.length, parsed.refused, refused);
        return owes.size ? ScribeAdoption.finish(job, stops.Failed, 'Missing supported Story evidence at #' +
            step.messages[stretch.messages.length].position + '.') : null;
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
                room,
                messages: room.slice(0, end),
                order: roomOrder.slice(0, end),
                roomOrder,
                fingerprints: new Map(room.map((message) => [message.id, message.fingerprint])),
                pending: new Set(room.filter((message) => message.attributionPending).map((message) => message.id)),
                places: new Map(room.map((message) => [message.position, message])),
                calls: 0,
                unpriced: 0,
            });
            while (!(await job.paused())) {
                let state = ScribeReplay.run(job.log, job.order, null, job.fingerprints, null, null, room);
                const answerState = job.log.nextQuestion > 1 && (end < room.length || job.pending.size)
                    ? ScribeReplay.run(job.log, roomOrder, job.pending, job.fingerprints, null, null, room) : state;
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
                    state = ScribeReplay.run(job.log, job.order, null, job.fingerprints, null, null, room);
                }
                if (!reading) {
                    return ScribeAdoption.finish(job, stops.Done, null);
                }
                if (ScribeIntake.transcript(stretch) === settings.Nothing) {
                    const result = ScribeLog.append(job.log, state, [], { messages: stretch, origin: origins.Story,
                        results: new Map(stretch.map((message) => [message.position, 'no change'])) });
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
