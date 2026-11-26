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
        StoryReasons: Object.freeze({
            format: 'The model returned a book entry in an unrecognized format.',
            evidence: 'Scribe could not verify a book entry against its cited chat passage.',
            Quote: 'The model’s evidence quote does not appear verbatim in the cited block.',
            Block: 'The model cited a block that does not exist in the message.',
            Citation: 'A book row has a missing source or cites a message outside its allowed range.',
            Reference: 'The book entry refers to a record that does not exist or is no longer available.',
            Ambiguous: 'The book entry uses a name that matches multiple subjects.',
            Mismatch: 'The book entry names a category, scope or subject that differs from the referenced record.',
            Ruled: 'The book entry conflicts with an existing operator ruling.',
            Player: 'The model labelled a non-player source as a player ruling.',
            Scope: 'The model supplied a measurement scope on a row outside the build category.',
            missingRead: 'The first unread message has neither a reading result nor a cited book entry.',
            conflictingRead: 'The model marked the first unread message “no change” but also filed a book entry from it.',
            outsideRead: 'The model reported reading a message outside the requested batch.',
            invalidRead: 'The model gave the first unread message an incomplete or unrecognized reading result.',
            duplicateRead: 'The model gave the first unread message more than one reading result.',
            checkerOnly: 'The model returned only a discrepancy row for this message. Discrepancies belong to the independent Checker.',
            coverage: 'The model omitted or contradicted the required reading result for a message.',
            legacy: 'The previous reading stopped because Scribe could not verify the model’s answer.',
        }),
        Arguments: Object.freeze({
            Options: 'The options are missing.',
            Messages: 'messages is not a list.',
            ReadThrough: 'readThrough is not a whole number within the message list.',
            Notes: 'notes is not a list.',
            Player: 'player is not a string.',
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
        const stretch = [];
        for (const message of messages) {
            if (message.attributionPending || Object.hasOwn(log.read, message.id)) {
                continue;
            }
            stretch.push(message);
            if (stretch.length === count) {
                break;
            }
        }
        return Object.freeze(stretch);
    },

    /**
     * @param {object} question
     * @param {object} message
     * @return {string}
     */
    inputKey(question, message) {
        const text = question.answer ?? question.text;
        return JSON.stringify([message?.id, message?.fingerprint, question.id ?? null, text.length, ScribeText.fingerprint(text)]);
    },

    /**
     * @param {object} log
     * @param {readonly object[]} messages
     * @return {object[]}
     */
    pendingSources(log, messages) {
        const pending = new Map();
        for (const entry of log.entries) {
            const reading = entry.modelResponse?.trim() || ScribeLog.modelReading(entry) || entry.operations.length ||
                entry.proposals?.length || entry.unfiledRows?.length ||
                entry.sources?.some((source) => source.result === 'read' || source.result === 'no change');
            for (const source of entry.withdrawn ? [] : entry.sources ?? []) {
                if (reading && !(source.filingPending ?? []).some((issue) => !['missingRead', 'format'].includes(issue.reason))) {
                    continue;
                }
                if (log.read[source.id] === entry.sequence && (source.filingPending?.length || source.result === 'unverified')) {
                    pending.set(source.id, source.fingerprint);
                }
            }
        }
        return messages.filter((message) => !message.attributionPending && pending.has(message.id) &&
            pending.get(message.id) === message.fingerprint);
    },

    /**
     * @param {object} question
     * @param {readonly object[]} messages
     * @return {boolean}
     */
    canAnswer(question, messages) {
        const message = messages[question.position - 1];
        return question.answer !== null && !question.dismissed && !message?.attributionPending;
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
     * @param {{first: number, last: number, reason: string}} failure
     * @return {string}
     */
    storyProblem(failure) {
        const range = failure.first === failure.last ? '#' + failure.first : '#' + failure.first + ' to #' + failure.last;
        return ScribeAdoption.Settings.StoryReasons[failure.reason] + ' That reading left ' + range + ' unverified.';
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
                ...(step.pass === ScribeAdoption.Pass.Story && step.messages?.length &&
                    step.messages.length !== step.last - step.first + 1 ? { selected: step.messages.length } : {}),
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
     * @param {Map<number, object>} shown
     * @return {{evidence: object, form: string|null, dimension: string|null, position?: number}|string}
     */
    bind(operation, item, shown) {
        const within = item && operation.sourceCitation && [...operation.sourceCitation.matchAll(/#(\d+)(?:\s*[-‐–—−]\s*#?(\d+))?/gu)]
            .some(([, first, last]) => item.messageNumber >= Number(first) && item.messageNumber <= Number(last ?? first));
        const declared = within ? item.messageNumber :
            operation.position ?? (operation.type === ScribeAnswer.Type.Scene ? undefined : operation.last);
        const message = shown.get(declared ?? item?.messageNumber ?? operation.last);
        if (!message) {
            return ScribeLog.Reason.Citation;
        }
        const block = item?.messageNumber === message.position ?
            message.blocks.find((source) => source.blockNumber === item.blockNumber) : null;
        let issue = null;
        if (!item || item.messageNumber !== message.position) {
            issue = ScribeLog.Reason.Citation;
        } else if (!block) {
            issue = 'Block';
        } else if (!block.text.includes(item.quote) || !(ScribeIntake.Originals.get(block) ?? block.text).includes(item.quote)) {
            issue = ScribeLog.Reason.Quote;
        } else if (item.attribution === 'ruled' && (!message.fromPlayer || block.role !== ScribeIntake.Role.Player)) {
            issue = 'Player';
        } else if (operation.type === ScribeAnswer.Type.Scene &&
            (message.position < operation.first || message.position > operation.last)) {
            issue = ScribeLog.Reason.Citation;
        }
        const statement = operation.text ?? operation.reason ?? operation.summary ?? operation.marker ?? operation.how;
        const { form = null, dimension = null } = item ?? {};
        const value = statement ?? operation.name ?? operation.said ?? operation.kind ?? operation.label;
        const evidence = {
            section: item?.section ?? null, row: item?.row ?? null, messageNumber: message.position, messageId: message.id,
            fingerprint: message.fingerprint, blockNumber: block?.blockNumber ?? null, speaker: block?.speaker ?? null,
            quote: issue ? null : item.quote, attribution: item?.attribution ?? null, form, dimension,
            event: item?.event ?? null, day: item?.day ?? operation.day ?? null, time: item?.time ?? null,
            subject: item?.subject ?? operation.label ?? null, attribute: item?.attribute ?? operation.category ?? operation.type,
            value: item?.value ?? value ?? null, valueSupplied: item?.value != null,
            related: item?.related ?? (operation.target ? [operation.target] : []),
            ...(operation.sourceCitation ? { sourceCitation: operation.sourceCitation } : {}),
            ...(issue ? { verified: false, issue, modelQuote: item?.quote ?? null,
                citedMessage: item?.messageNumber ?? null, citedBlock: item?.blockNumber ?? null } : {}),
        };
        const bound = { ...operation, form, dimension, evidence };
        if (operation.position !== undefined) {
            bound.position = message.position;
        }
        return bound;
    },

    /**
     * @param {object} job
     * @param {number} position
     * @param {object} operation
     * @param {object|undefined} item
     * @param {Map<number, Map<string, object>>} originalRows
     * @return {boolean}
     */
    filed(job, position, operation, item, originalRows) {
        const message = job.places.get(position);
        const owner = message && job.log.read[message.id];
        if (owner === undefined) {
            return false;
        }
        if (!originalRows.has(owner)) {
            const entry = job.log.entries.find((candidate) => candidate.sequence === owner);
            const saved = new Map();
            if (entry?.modelResponse && !entry.withdrawn && entry.origin === ScribeLog.Origin.Story) {
                const protocol = ScribeAnswer.parseStory(entry.modelResponse);
                for (const filed of entry.operations) {
                    const evidence = filed.evidence;
                    if (!evidence || filed.revoked || evidence.verified === false ||
                        job.fingerprints.get(evidence.messageId) !== evidence.fingerprint) {
                        continue;
                    }
                    const key = evidence.section + ':' + evidence.row;
                    const original = protocol.rows.get(key);
                    const citation = protocol.evidence.get(key);
                    if (original && citation && evidence.filingKey === ScribeText.fingerprint(JSON.stringify([original, evidence.form, evidence.dimension]))) {
                        saved.set(JSON.stringify([evidence.messageId, original, evidence.form, evidence.dimension]), citation);
                    }
                }
            }
            originalRows.set(owner, saved);
        }
        const prior = originalRows.get(owner).get(JSON.stringify([message.id, operation, item?.form ?? null, item?.dimension ?? null]));
        return Boolean(prior && (!item || ['messageNumber', 'blockNumber', 'quote', 'attribution', 'form', 'dimension',
            'subject', 'attribute', 'value', 'event', 'day', 'time', 'related'].every((field) =>
            JSON.stringify(prior[field] ?? null) === JSON.stringify(item[field] ?? null))));
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
        const story = step.pass === ScribeAdoption.Pass.Story;
        job.calls++;
        let answer = null;
        try {
            answer = await job.ask(step.system, step.user, step.questions, step.messages);
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
        const answers = step.pass === ScribeAdoption.Pass.Answers;
        const noteRead = new Map();
        let readingNotes = false;
        const lines = [];
        for (const line of (answer.text ?? '').split(/\r?\n/)) {
            const heading = /^===\s*([A-Z]+)(?:\s*===)?$/i.exec(line.trim())?.[1].toUpperCase();
            if (step.pass === ScribeAdoption.Pass.Notes && heading) {
                readingNotes = heading === 'READ';
                if (readingNotes) {
                    continue;
                }
            }
            const receipt = readingNotes && /^#([1-9]\d*)\s*\|\s*(read|no change)$/i.exec(line.trim());
            if (receipt && step.messages.some((message) => message.position === Number(receipt[1]))) {
                noteRead.set(Number(receipt[1]), receipt[2].toLowerCase());
                continue;
            }
            lines.push(line);
        }
        const protocol = story ? ScribeAnswer.parseStory(answer.text) : null;
        const narrative = story && answer.text.trim() && !protocol.structured && !/^\(no change\)$/i.test(answer.text.trim()) ? answer.text : null;
        const parsed = story ? { operations: [], refused: narrative ? [] : protocol.refused } : ScribeAnswer.parse(lines.join('\n'));
        const shown = new Map(step.messages.map((message) => [message.position, message]));
        const copying = job.diagnostic ?? ((value) => value);
        const issues = new Map();
        const unfiled = [];
        let unassigned = 0;
        const noteIssue = (number, reason, row = null) => {
            if (!shown.has(number)) {
                unassigned++;
                return;
            }
            const details = issues.get(number) ?? [];
            details.push(row ? { reason, row } : { reason });
            issues.set(number, details);
        };
        if (story) {
            for (const problem of parsed.refused) {
                const receipt = protocol.rejectedRead.get(problem);
                const row = protocol.rejectedRows.get(problem);
                const item = protocol.evidence.get(row);
                if (receipt || item) {
                    noteIssue(receipt?.number ?? item.messageNumber, receipt?.reason ?? 'Citation', row);
                }
            }
            for (const number of protocol.read.keys()) {
                if (!shown.has(number)) {
                    noteIssue(number, 'outsideRead');
                    parsed.refused.push({ block: 'READ', line: '#' + number, reason: 'outsideRead' });
                }
            }
            for (const [key, item] of protocol.evidence) {
                if (!protocol.rows.has(key) && ![...protocol.rejectedRows.values()].includes(key)) {
                    noteIssue(item.messageNumber, 'Citation', key);
                    parsed.refused.push({ block: 'EVIDENCE', line: JSON.stringify(item), reason: 'Citation', messageNumber: item.messageNumber });
                }
            }
            const originalRows = new Map();
            for (const [key, operation] of protocol.rows) {
                const item = protocol.evidence.get(key);
                const number = item?.messageNumber ?? operation.position ?? operation.last;
                if (operation.type === ScribeAnswer.Type.Subject && !item && step.state.subjects.some((subject) =>
                    !subject.assumed && subject.mergedInto === null && subject.label === operation.label && subject.kind === operation.kind &&
                    subject.evidence?.verified !== false && subject.evidence && job.fingerprints.get(subject.evidence.messageId) === subject.evidence.fingerprint)) {
                    continue;
                }
                const position = operation.position ?? operation.last;
                if (position < step.first && ScribeAdoption.filed(job, position, operation, item, originalRows)) {
                    continue;
                }
                const bound = operation.type === ScribeAnswer.Type.Contradiction ? 'checkerOnly' :
                    ScribeAdoption.bind(operation, item, shown);
                if (typeof bound === 'string') {
                    unfiled.push({ operation: item ? { ...operation, modelEvidence: item } : operation, reason: bound,
                        ...(bound === ScribeLog.Reason.Citation ? { pendingSource: key } : {}) });
                    noteIssue(shown.has(number) ? number : operation.position ?? operation.last, bound, key);
                } else {
                    if (bound.evidence.section === null) {
                        const [section, row] = key.split(':');
                        bound.evidence.section = section;
                        bound.evidence.row = Number(row);
                    }
                    bound.evidence.filingKey = ScribeText.fingerprint(JSON.stringify([operation, bound.form, bound.dimension]));
                    if (bound.evidence.issue) {
                        noteIssue(bound.evidence.messageNumber, bound.evidence.issue, key);
                        bound.evidence.modelQuote = copying(bound.evidence.modelQuote);
                        unfiled.push({ operation: bound, reason: bound.evidence.issue, pendingSource: key });
                    } else {
                        parsed.operations.push(bound);
                    }
                }
            }
        }
        const stretch = { messages: step.messages, origin: step.origin, sources: job.places, results: protocol?.read };
        const order = answers ? job.roomOrder : job.order;
        const pending = answers ? job.pending : null;
        const state = step.state.revision === job.log.revision ? step.state :
            ScribeReplay.run(job.log, order, pending, job.fingerprints, null, null, job.room);
        let operations = parsed.operations;
        const destination = step.retry ? { ...job.log, entries: [...job.log.entries], read: { ...job.log.read } } : job.log;
        const previous = new Map();
        const accepted = new Map();
        const proseOnly = new Set();
        if (step.retry) {
            for (const message of step.messages) {
                const entry = job.log.entries.find((candidate) => candidate.sequence === job.log.read[message.id]);
                previous.set(message.id, entry);
                if (entry.sources?.length === 1 && entry.sources[0].result === 'unverified' && !entry.operations.length &&
                    !entry.proposals?.length && entry.unfiledRows?.length &&
                    entry.unfiledRows.every((line) => line.block === ScribeAnswer.Settings.Preamble)) {
                    proseOnly.add(message.id);
                }
                delete destination.read[message.id];
                for (const operation of entry.operations) {
                    if (operation.evidence?.messageId === message.id && operation.evidence.filingKey) {
                        accepted.set(message.id + ':' + operation.evidence.filingKey, operation);
                    }
                }
            }
            operations = operations.filter((operation) => {
                const old = accepted.get(operation.evidence.messageId + ':' + operation.evidence.filingKey);
                if (old?.evidence.verified === false && operation.evidence.verified !== false) {
                    old.evidence = operation.evidence;
                }
                return !old;
            });
        }
        const result = ScribeLog.append(destination, state, operations, stretch);
        if (typeof answer.text === 'string') {
            result.entry[narrative ? 'modelReading' : 'modelResponse'] = copying(answer.text);
        }
        if (!story) {
            result.entry.responseSources = step.messages.map(({ id, fingerprint }) => ({ id, fingerprint }));
        }
        if (Object.hasOwn(answer, 'finish') && answer.finish !== 'stop') {
            result.entry.providerFinish = answer.finish;
        }
        unfiled.push(...result.refused);
        if (story) {
            result.entry.sourceAuthority = true;
            for (const { operation, reason } of result.refused) {
                const item = operation.evidence;
                noteIssue(item.messageNumber, reason, item.section + ':' + item.row);
            }
            if (unfiled.length) {
                result.entry.proposals = copying(unfiled.map(({ operation, reason, pendingSource }) => ({ operation, reason,
                    ...(pendingSource ? { pendingSource: result.entry.sequence + ':' + pendingSource } : {}),
                    sourceId: operation.evidence?.messageId ?? shown.get(operation.position ?? operation.last)?.id ?? step.messages.at(-1).id })));
            }
            if (parsed.refused.length) {
                const wholeAnswer = step.messages.length === 1 && !protocol.rows.size && !protocol.read.size &&
                    !protocol.evidence.size && parsed.refused.every((line) => line.block === ScribeAnswer.Settings.Preamble);
                result.entry.unfiledRows = copying(parsed.refused.map((problem) => {
                    const number = problem.messageNumber ?? protocol.rejectedRead.get(problem)?.number ??
                        protocol.evidence.get(protocol.rejectedRows.get(problem))?.messageNumber;
                    const row = ScribeAnswer.Blocks.includes(problem.block) ? protocol.rejectedRows.get(problem) : null;
                    return { ...problem, reviewAt: shown.get(number)?.id ?? step.messages.at(-1).id, ...(row ? {row} : {}),
                        ...(wholeAnswer ? {wholeAnswer: true} : {}) };
                }));
            }
            const supported = new Set([...parsed.operations, ...unfiled.map(({ operation }) => operation)].filter((operation) => operation.evidence)
                .map((operation) => operation.evidence?.messageNumber));
            for (const source of result.entry.sources) {
                const number = source.position;
                if (supported.has(number)) {
                    if (source.result === 'no change') {
                        noteIssue(number, 'conflictingRead');
                    }
                }
                if (source.result === undefined && answer.text.trim()) {
                    source.result = 'processed';
                } else if (source.result === undefined) {
                    source.result = 'unverified';
                    if (!issues.has(number)) {
                        noteIssue(number, 'missingRead');
                    }
                }
                if (unassigned && source.id === step.messages.at(-1).id) {
                    noteIssue(number, 'format');
                }
                if (issues.has(number)) {
                    source.filingPending = issues.get(number);
                }
            }
            if (unassigned) {
                result.entry.unfiledLines = unassigned;
            }
            if (step.retry) {
                const failed = new Set(result.refused.map((item) => item.operation));
                const repaired = parsed.operations.filter((item) => !failed.has(item) && item.evidence.verified !== false);
                const intendedChange = ({ evidence, fact, thread, ...fields }) => JSON.stringify(fields);
                for (const operation of result.entry.operations) {
                    previous.get(operation.evidence?.messageId ?? operation.cite)?.operations.push(operation);
                }
                for (const source of result.entry.sources) {
                    const entry = previous.get(source.id);
                    const old = entry.sources.find((item) => item.id === source.id);
                    const rows = repaired.filter((item) => item.evidence.messageId === source.id);
                    const byRow = new Map(rows.map((item) => [item.evidence.section + ':' + item.evidence.row, item]));
                    const complete = step.messages.length === 1 && !source.filingPending?.length && source.result !== 'unverified';
                    let replacedAnswer = false;
                    for (const line of entry.unfiledRows ?? []) {
                        const replacesProse = complete && (line.wholeAnswer || proseOnly.has(source.id)) &&
                            line.block === ScribeAnswer.Settings.Preamble;
                        if (line.reviewAt === source.id && !line.resolvedBy && (replacesProse || byRow.has(line.row) ||
                            line.block === 'READ' && protocol.read.has(source.position) && !issues.get(source.position)?.some(
                                (issue) => ['invalidRead', 'duplicateRead', 'outsideRead'].includes(issue.reason)))) {
                            line.resolvedBy = result.entry.sequence;
                            replacedAnswer ||= replacesProse;
                        }
                    }
                    const newLines = (result.entry.unfiledRows ?? []).filter((item) => item.reviewAt === source.id);
                    if (newLines.length) {
                        entry.unfiledRows = [...new Map([...(entry.unfiledRows ?? []), ...newLines].map(
                            (item) => [JSON.stringify(item), item])).values()];
                    }
                    for (const proposal of entry.proposals ?? []) {
                        if (proposal.sourceId !== source.id || proposal.resolvedBy) {
                            continue;
                        }
                        const evidence = proposal.operation.evidence;
                        const correction = byRow.get(evidence?.section + ':' + evidence?.row);
                        if (correction && (evidence.filingKey === correction.evidence.filingKey ||
                            proposal.reason === ScribeLog.Reason.Reference && intendedChange(proposal.operation) === intendedChange(correction))) {
                            proposal.resolvedBy = result.entry.sequence;
                        }
                    }
                    const newProposals = (result.entry.proposals ?? []).filter((item) => item.sourceId === source.id);
                    if (newProposals.length) {
                        const proposals = new Map((entry.proposals ?? []).map((item) => [JSON.stringify(item), item]));
                        for (const proposal of newProposals) {
                            proposals.set(JSON.stringify(proposal), proposal);
                        }
                        entry.proposals = [...proposals.values()];
                    }
                    const unresolved = entry.operations.filter((item) => item.evidence?.messageId === source.id && item.evidence.verified === false)
                        .map((item) => ({ reason: item.evidence.issue, row: item.evidence.section + ':' + item.evidence.row }));
                    for (const item of entry.proposals ?? []) {
                        if (item.sourceId === source.id && !item.resolvedBy) {
                            unresolved.push({ reason: item.reason });
                        }
                    }
                    for (const line of entry.unfiledRows ?? []) {
                        if (line.reviewAt === source.id && !line.resolvedBy) {
                            unresolved.push({ reason: 'format', ...(line.row ? {row: line.row} : {}) });
                        }
                    }
                    const pending = [...(source.filingPending ?? []), ...unresolved];
                    if (source.result === 'unverified' && old.result === 'read') {
                        source.result = 'read';
                    }
                    if (source.result === 'no change' && !replacedAnswer && old.filingPending?.some((issue) => issue.reason !== 'missingRead')) {
                        pending.push(...old.filingPending);
                    }
                    Object.assign(old, source);
                    if (pending.length) {
                        old.filingPending = [...new Map(pending.map((item) => [JSON.stringify(item), item])).values()];
                    } else {
                        delete old.filingPending;
                    }
                }
                for (const counter of ['nextSubject', 'nextFact', 'nextThread', 'nextQuestion', 'nextSequence', 'revision']) {
                    job.log[counter] = destination[counter];
                }
                job.log.entries.push({ sequence: result.entry.sequence, kind: result.entry.kind, origin: result.entry.origin,
                    withdrawn: false, messageIds: result.entry.messageIds, retrySources: result.entry.messageIds, operations: [], sources: [],
                    ...(narrative ? { modelReading: result.entry.modelReading } : { modelResponse: result.entry.modelResponse }) });
            }
        } else {
            if (noteRead.size) {
                result.entry.noteReceipts = step.messages.filter((message) => noteRead.has(message.position)).map((message) => ({
                    id: message.id, fingerprint: message.fingerprint, result: noteRead.get(message.position),
                }));
            }
            if (parsed.refused.length) {
                result.entry.unfiledRows = copying(parsed.refused);
            }
            if (unfiled.length) {
                result.entry.proposals = copying(unfiled);
            }
            for (const input of [...step.notes, ...step.questions]) {
                const message = job.places.get(input.position);
                const key = ScribeAdoption.inputKey(input, message);
                if (answers) {
                    const latest = ScribeReplay.run(job.log, order, pending, job.fingerprints, null, null, job.room);
                    const dismissal = ScribeLog.rule(job.log, latest, { type: ScribeLog.Ruling.Dismiss, question: input.id });
                    ScribeLog.link(dismissal, latest, [], step.messages);
                } else {
                    job.log.notes.push(input.text);
                    (result.entry.filedInputs ??= []).push(key);
                }
            }
        }
        await job.save(job.log, step.questions, step.messages);
        const readable = Boolean(answer.text.trim());
        await job.record(Object.freeze({ sequence: result.entry.sequence, pass: step.pass, system: step.system,
            input: step.user, answer: answer.text, readable }));
        await ScribeAdoption.report(job, step, result.entry.operations.length + (narrative ? 1 : 0), parsed.refused, Object.freeze(unfiled));
        return null;
    },

    /**
     * @param {{ messages: readonly object[], readThrough?: number, notes: readonly object[], player: string, log: object, size: number, budget: number, spent: number, atBudget?: Function, ask: Function, save: Function, record: Function, progress: Function, paused: Function }} options
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
            const requestedInputs = Array.isArray(options.retryInputs) ? new Set(options.retryInputs) : null;
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
                if (options.retrySources?.length) {
                    const requested = new Set(options.retrySources);
                    const batch = ScribeAdoption.pendingSources(job.log, job.messages).filter((message) => requested.has(message.id)).slice(0, job.size);
                    if (!batch.length) {
                        return ScribeAdoption.finish(job, stops.Done, null);
                    }
                    const stop = await ScribeAdoption.consult(job, { pass: passes.Story, origin: origins.Story,
                        first: batch[0].position, last: batch.at(-1).position, system: ScribeAnalyzer.Prompt,
                        user: ScribeAnalyzer.input(state, job.player, batch), messages: batch, state,
                        questions: [], notes: [], retry: true });
                    return stop ?? ScribeAdoption.finish(job, stops.Done, null);
                }
                const answerState = job.log.nextQuestion > 1 && (end < room.length || job.pending.size)
                    ? ScribeReplay.run(job.log, roomOrder, job.pending, job.fingerprints, null, null, room) : state;
                const answerPositions = new Set();
                const answered = answerState.questions.filter(
                    /**
                     * @param {{ answer: string|null, dismissed: boolean }} question
                     * @return {boolean}
                     */
                    (question) => {
                        if (!ScribeAdoption.canAnswer(question, room) || answerPositions.has(question.position) ||
                            (requestedInputs && !requestedInputs.has(ScribeAdoption.inputKey(question, job.places.get(question.position))))) {
                            return false;
                        }
                        answerPositions.add(question.position);
                        return true;
                    },
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
                const stretch = requestedInputs ? [] : ScribeAdoption.next(job.log, job.messages, job.size);
                const reading = stretch.length > 0;
                const first = reading ? stretch[0].position : null;
                const last = reading ? stretch.at(settings.Last).position : null;
                const filed = new Set(job.log.entries.filter((entry) => !entry.withdrawn && entry.origin === origins.Notes)
                    .flatMap((entry) => [...entry.filedInputs ?? [], ...entry.pendingInputs ?? []]));
                const legacy = new Map();
                for (const text of job.log.notes) {
                    legacy.set(text, (legacy.get(text) ?? 0) + 1);
                }
                for (const note of job.notes) {
                    const key = ScribeAdoption.inputKey(note, job.places.get(note.position));
                    if (filed.has(key)) {
                        legacy.set(note.text, (legacy.get(note.text) ?? 0) - 1);
                    }
                }
                const notePositions = new Set();
                const fresh = job.notes.filter(
                    /**
                     * @param {{ text: string, position: number }} note
                     * @return {boolean}
                     */
                    (note) => {
                        const key = ScribeAdoption.inputKey(note, job.places.get(note.position));
                        if (filed.has(key)) {
                            return false;
                        }
                        if (legacy.get(note.text) > 0) {
                            legacy.set(note.text, legacy.get(note.text) - 1);
                            return false;
                        }
                        const allowed = (end === room.length || note.position <= job.messages.at(settings.Last)?.position) &&
                        job.places.has(note.position) &&
                        !job.places.get(note.position).attributionPending &&
                        (!reading || note.position <= last) &&
                        (!requestedInputs || requestedInputs.has(ScribeAdoption.inputKey(note, job.places.get(note.position))));
                        if (!allowed || notePositions.has(note.position)) {
                            return false;
                        }
                        notePositions.add(note.position);
                        return true;
                    },
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
                    if (fresh.length) {
                        continue;
                    }
                    return ScribeAdoption.finish(job, stops.Done, null);
                }
                if (stretch.every((message) => !message.text && job.notes.some((note) => note.position === message.position))) {
                    const receipts = new Map(job.log.entries.filter((entry) => !entry.withdrawn).flatMap((entry) =>
                        (entry.noteReceipts ?? []).map((source) => [source.id, source])));
                    const results = new Map(stretch.map((message) => {
                        const receipt = receipts.get(message.id);
                        return [message.position, receipt?.fingerprint === message.fingerprint ? receipt.result : 'processed'];
                    }));
                    const { entry } = ScribeLog.append(job.log, state, [], { messages: stretch, origin: origins.Story, results });
                    entry.sourceAuthority = true;
                    await job.save(job.log, [], stretch);
                    await ScribeAdoption.report(job, { pass: passes.Story, first, last }, 0, [], []);
                    continue;
                }
                const storyStop = await ScribeAdoption.consult(job, {
                    pass: passes.Story,
                    origin: origins.Story,
                    first,
                    last,
                    system: ScribeAnalyzer.Prompt,
                    user: ScribeAnalyzer.input(state, job.player, stretch),
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
