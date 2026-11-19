const ScribeLog = Object.freeze({
    Reason: Object.freeze({
        Citation: 'Citation',
        Reference: 'Reference',
        Ambiguous: 'Ambiguous',
        Mismatch: 'Mismatch',
        Ruled: 'Ruled',
        Quote: 'Quote',
    }),

    Kind: Object.freeze({
        Update: 'Update',
        Operator: 'Operator',
    }),

    Origin: Object.freeze({
        Story: 'Story',
        Notes: 'Notes',
        Answers: 'Answers',
        Operator: 'Operator',
    }),

    Ruling: Object.freeze({
        Pin: 'Pin',
        Merge: 'Merge',
        Split: 'Split',
        Distinct: 'Distinct',
        Narrow: 'Narrow',
        Widen: 'Widen',
        AddFact: 'AddFact',
        RemoveFact: 'RemoveFact',
        Unalias: 'Unalias',
        Answer: 'Answer',
        Dismiss: 'Dismiss',
        DismissContradiction: 'DismissContradiction',
    }),

    Settings: Object.freeze({
        Version: 1,
        FirstNumber: 1,
        FirstRevision: 0,
        LeastPosition: 0,
        Everyone: 'Everyone',
        SubjectPrefix: 'S',
        FactPrefix: 'F',
        ThreadPrefix: 'T',
        QuestionPrefix: 'Q',
        AkaCategory: 'aka',
        Nothing: '',
        Space: ' ',
        OpenBrackets: '([',
        CloseBrackets: ')]',
        AlreadyRead: 'AlreadyRead',
        UnknownOperation: 'UnknownOperation',
        UnknownOrigin: 'UnknownOrigin',
        StaleState: 'StaleState',
        InvalidOperation: 'InvalidOperation',

        /**
         * @return {RegExp}
         */
        get Blank() {
            return /\s/u;
        },
    }),

    /**
     * @return {{ version: number, nextFact: number, nextSubject: number, nextThread: number, nextQuestion: number, nextSequence: number, revision: number, entries: object[], read: Object<string, number>, notes: string[] }}
     */
    create() {
        const settings = ScribeLog.Settings;
        return {
            version: settings.Version,
            nextFact: settings.FirstNumber,
            nextSubject: settings.FirstNumber,
            nextThread: settings.FirstNumber,
            nextQuestion: settings.FirstNumber,
            nextSequence: settings.FirstNumber,
            revision: settings.FirstRevision,
            entries: [],
            read: {},
            notes: [],
        };
    },

    /**
     * @param {string} label
     * @return {string}
     */
    name(label) {
        const settings = ScribeLog.Settings;
        let depth = 0;
        let gap = false;
        let name = settings.Nothing;
        for (const character of label) {
            if (settings.OpenBrackets.includes(character)) {
                depth++;
            } else if (depth > 0 && settings.CloseBrackets.includes(character)) {
                depth--;
            } else if (depth === 0 && settings.Blank.test(character)) {
                gap = true;
            } else if (depth === 0) {
                name += (gap && name !== settings.Nothing ? settings.Space : settings.Nothing) + character;
                gap = false;
            }
        }
        return name === settings.Nothing ? label : name;
    },

    /**
     * @param {object} context
     * @param {string} written
     * @param {string} subject
     * @return {void}
     */
    index(context, written, subject) {
        const key = ScribeText.normaliseName(written);
        const holders = context.names.get(key) ?? [];
        if (key !== ScribeLog.Settings.Nothing && !holders.includes(subject)) {
            context.names.set(key, [...holders, subject]);
        }
    },

    /**
     * @param {object} context
     * @param {string} subject
     * @param {string} label
     * @param {string} name
     * @return {void}
     */
    enrol(context, subject, label, name) {
        const key = ScribeText.normaliseName(label);
        if (key !== ScribeLog.Settings.Nothing && !context.labels.has(key)) {
            context.labels.set(key, subject);
        }
        ScribeLog.index(context, name, subject);
    },

    /**
     * @param {object} context
     * @param {string} written
     * @return {Readonly<{ subject: string|null, ambiguous: boolean }>}
     */
    find(context, written) {
        const key = ScribeText.normaliseName(written);
        const labelled = context.labels.get(key);
        if (labelled !== undefined) {
            return Object.freeze({ subject: labelled, ambiguous: false });
        }
        const holders = context.names.get(key) ?? [];
        return Object.freeze({
            subject: holders.length === 1 ? holders[0] : null,
            ambiguous: holders.length > 1,
        });
    },

    /**
     * @param {object} context
     * @param {string} written
     * @return {boolean}
     */
    clashes(context, written) {
        return context.mismatched.has(ScribeText.normaliseName(written));
    },

    /**
     * @param {object} context
     * @param {string} written
     * @param {string} subject
     * @return {boolean}
     */
    owns(context, written, subject) {
        const key = ScribeText.normaliseName(written);
        const labelled = context.labels.get(key);
        const reached =
            labelled === undefined ? (context.names.get(key) ?? []).includes(subject) : labelled === subject;
        return !ScribeLog.clashes(context, written) && reached;
    },

    /**
     * @param {object} context
     * @param {{ label: string, category: string, target: string|null }} operation
     * @param {object} named
     * @return {boolean}
     */
    fits(context, operation, named) {
        if (!ScribeLog.owns(context, operation.label, named.subject) || operation.category !== named.category) {
            return false;
        }
        if (named.category !== ScribeCategory.Settings.RelationCategory) {
            return true;
        }
        const written = ScribeText.normaliseName(operation.target);
        const sameText =
            written !== ScribeLog.Settings.Nothing && written === ScribeText.normaliseName(named.targetText);
        const sameSubject =
            named.target !== null &&
            !ScribeLog.clashes(context, operation.target) &&
            ScribeLog.find(context, operation.target).subject === named.target;
        return sameText || sameSubject;
    },

    /**
     * @param {object} context
     * @param {string} label
     * @param {string|null} kind
     * @return {{ type: string, subject: string, label: string, kind: string|null }}
     */
    make(context, label, kind) {
        const subject = ScribeLog.Settings.SubjectPrefix + context.counters.nextSubject;
        context.counters.nextSubject++;
        ScribeLog.enrol(context, subject, label, ScribeLog.name(label));
        context.subjects.set(subject, { label, kind, assumed: kind === null });
        return { type: ScribeAnswer.Type.Subject, subject, label, kind };
    },

    /**
     * @param {object} context
     * @param {string} label
     * @param {object[]} made
     * @return {string|null}
     */
    reach(context, label, made) {
        const match = ScribeLog.find(context, label);
        if (match.ambiguous || match.subject !== null) {
            return match.subject;
        }
        const subject = ScribeLog.make(context, label, null);
        made.push(subject);
        return subject.subject;
    },

    /**
     * @param {object} context
     * @param {object} state
     * @return {void}
     */
    learn(context, state) {
        for (const subject of state.subjects) {
            if (subject.mergedInto !== null) {
                ScribeLog.enrol(context, subject.mergedInto, subject.label, subject.name);
                continue;
            }
            ScribeLog.enrol(context, subject.id, subject.label, subject.name);
            for (const aka of subject.aka) {
                ScribeLog.index(context, aka, subject.id);
            }
            context.subjects.set(subject.id, { label: subject.label, kind: subject.kind, assumed: subject.assumed });
        }
    },

    /**
     * @param {*} value
     * @return {boolean}
     */
    worded(value) {
        return typeof value === 'string' && ScribeAnswer.Settings.HasContent.test(value);
    },

    /**
     * @param {*} category
     * @return {string|null}
     */
    categoryKind(category) {
        for (const [kind, words] of Object.entries(ScribeCategory.Settings.Words)) {
            if (words.includes(category)) {
                return ScribeCategory.Kind[kind];
            }
        }
        return null;
    },

    /**
     * @param {object} state
     * @return {{ state: object, subjects: Map<string, object>, facts: Map<string, object> }}
     */
    view(state) {
        const subjects = new Map();
        const facts = new Map();
        for (const subject of state.subjects) {
            subjects.set(subject.id, subject);
        }
        for (const fact of state.facts) {
            facts.set(fact.id, fact);
        }
        return { state, subjects, facts };
    },

    /**
     * @param {{ subjects: Map<string, object> }} view
     * @param {*} id
     * @return {*}
     */
    root(view, id) {
        const subject = view.subjects.get(id);
        return subject === undefined || subject.mergedInto === null ? id : subject.mergedInto;
    },

    /**
     * @param {{ subjects: Map<string, object> }} view
     * @param {*} first
     * @param {*} second
     * @return {string|null}
     */
    twoSubjects(view, first, second) {
        const sameAlready = ScribeLog.root(view, first) === ScribeLog.root(view, second);
        if (typeof first !== 'string' || typeof second !== 'string' || sameAlready) {
            return ScribeLog.Settings.InvalidOperation;
        }
        if (!view.subjects.has(first) || !view.subjects.has(second)) {
            return ScribeLog.Reason.Reference;
        }
        return null;
    },

    /**
     * @param {ReadonlyArray<{ id: string }>} items
     * @param {string} id
     * @return {object|undefined}
     */
    lookup(items, id) {
        return items.find(
            /**
             * @param {{ id: string }} item
             * @return {boolean}
             */
            (item) => item.id === id,
        );
    },

    /**
     * @param {string} subject
     * @param {string} name
     * @return {string}
     */
    aliasKey(subject, name) {
        return JSON.stringify([subject, ScribeText.normaliseName(name)]);
    },

    /**
     * @param {string} first
     * @param {string} second
     * @return {string}
     */
    pair(first, second) {
        return JSON.stringify(first < second ? [first, second] : [second, first]);
    },

    /**
     * @param {object|undefined} fact
     * @return {boolean}
     */
    unnamed(fact) {
        return fact !== undefined && (fact.status === ScribeReplay.Status.Removed || fact.made);
    },

    /**
     * @param {*} list
     * @return {boolean}
     */
    ids(list) {
        if (!Array.isArray(list) || list.length === 0 || new Set(list).size !== list.length) {
            return false;
        }
        for (let index = 0; index < list.length; index++) {
            if (!Object.hasOwn(list, index) || typeof list[index] !== 'string') {
                return false;
            }
        }
        return true;
    },

    /**
     * @param {object} fact
     * @return {{ subject: string, category: string, target: string|null, targetText: string|null, text: string }}
     */
    mark(fact) {
        return {
            subject: fact.subject,
            category: fact.category,
            target: fact.target,
            targetText: fact.targetText,
            text: fact.text,
        };
    },

    /**
     * @param {{ nextFact: number }} counters
     * @return {string}
     */
    nextFactId(counters) {
        const id = ScribeLog.Settings.FactPrefix + counters.nextFact;
        counters.nextFact++;
        return id;
    },

    Resolvers: Object.freeze({
        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        Subject(operation, context, outcome) {
            const reasons = ScribeLog.Reason;
            if (ScribeLog.clashes(context, operation.label)) {
                return reasons.Mismatch;
            }
            const match = ScribeLog.find(context, operation.label);
            if (match.ambiguous) {
                return reasons.Ambiguous;
            }
            if (match.subject === null) {
                outcome.subjects.push(ScribeLog.make(context, operation.label, operation.kind));
                return null;
            }
            const known = context.subjects.get(match.subject);
            if (known.assumed) {
                known.kind = operation.kind;
                known.assumed = false;
                outcome.checks.push({ written: operation.label, subject: match.subject });
                outcome.draft = {
                    type: ScribeAnswer.Type.Subject,
                    subject: match.subject,
                    label: known.label,
                    kind: operation.kind,
                };
                return null;
            }
            if (known.kind === operation.kind) {
                return null;
            }
            context.mismatched.add(ScribeText.normaliseName(operation.label));
            return reasons.Mismatch;
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        Alias(operation, context, outcome) {
            const reasons = ScribeLog.Reason;
            const cite = context.cites.get(operation.position);
            if (cite === undefined) {
                return reasons.Citation;
            }
            if (ScribeLog.clashes(context, operation.label) || ScribeLog.clashes(context, operation.name)) {
                return reasons.Mismatch;
            }
            const known = ScribeLog.find(context, operation.label);
            if (known.ambiguous) {
                return reasons.Ambiguous;
            }
            if (known.subject === null) {
                return reasons.Reference;
            }
            const named = ScribeLog.find(context, operation.name);
            if (named.ambiguous) {
                return reasons.Ambiguous;
            }
            if (named.subject === known.subject) {
                return null;
            }
            const unaliased = context.unaliased.has(ScribeLog.aliasKey(known.subject, operation.name));
            const apart = named.subject !== null && context.distinct.has(ScribeLog.pair(known.subject, named.subject));
            if (unaliased || apart) {
                return reasons.Ruled;
            }
            ScribeLog.index(context, operation.name, known.subject);
            outcome.checks.push({ written: operation.label, subject: known.subject });
            outcome.draft = {
                type: ScribeAnswer.Type.Alias,
                subject: known.subject,
                name: operation.name,
                cite,
                position: operation.position,
                other: named.subject,
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        Fact(operation, context, outcome) {
            const reasons = ScribeLog.Reason;
            const cite = context.cites.get(operation.position);
            if (cite === undefined) {
                return reasons.Citation;
            }
            if (ScribeLog.clashes(context, operation.label)) {
                return reasons.Mismatch;
            }
            const subject = ScribeLog.reach(context, operation.label, outcome.subjects);
            if (subject === null) {
                return reasons.Ambiguous;
            }
            let other = null;
            if (operation.category === ScribeLog.Settings.AkaCategory) {
                const named = ScribeLog.find(context, operation.text).subject;
                other = named === subject ? null : named;
                ScribeLog.index(context, operation.text, subject);
            }
            outcome.checks.push({ written: operation.label, subject });
            outcome.draft = {
                type: ScribeAnswer.Type.Fact,
                fact: null,
                subject,
                label: operation.label,
                category: operation.category,
                target: null,
                targetText: operation.target,
                other,
                text: operation.text,
                cite,
                position: operation.position,
                hidden: operation.hidden,
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        Refine(operation, context, outcome) {
            const reasons = ScribeLog.Reason;
            const cite = context.cites.get(operation.position);
            if (cite === undefined) {
                return reasons.Citation;
            }
            const named = context.facts.get(operation.fact);
            if (named === undefined || ScribeLog.unnamed(named)) {
                return reasons.Reference;
            }
            if (operation.position < named.position) {
                return reasons.Citation;
            }
            if (!ScribeLog.fits(context, operation, named)) {
                return reasons.Mismatch;
            }
            let other = null;
            if (named.category === ScribeLog.Settings.AkaCategory) {
                const found = ScribeLog.find(context, operation.text).subject;
                other = found === named.subject ? null : found;
                ScribeLog.index(context, operation.text, named.subject);
            }
            outcome.draft = {
                type: operation.type,
                fact: operation.fact,
                becomes: null,
                subject: named.subject,
                label: operation.label,
                category: named.category,
                target: named.target,
                targetText: named.targetText,
                other,
                hidden: named.hidden,
                text: operation.text,
                cite,
                position: operation.position,
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        Change(operation, context, outcome) {
            return ScribeLog.Resolvers.Refine(operation, context, outcome);
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        End(operation, context, outcome) {
            const reasons = ScribeLog.Reason;
            const cite = context.cites.get(operation.position);
            if (cite === undefined) {
                return reasons.Citation;
            }
            const named = context.facts.get(operation.fact);
            if (named === undefined || ScribeLog.unnamed(named)) {
                return reasons.Reference;
            }
            if (operation.position < named.position) {
                return reasons.Citation;
            }
            if (!ScribeLog.fits(context, operation, named)) {
                return reasons.Mismatch;
            }
            outcome.draft = {
                type: ScribeAnswer.Type.End,
                fact: operation.fact,
                label: operation.label,
                reason: operation.reason,
                cite,
                position: operation.position,
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        Told(operation, context, outcome) {
            const reasons = ScribeLog.Reason;
            const cite = context.cites.get(operation.position);
            if (cite === undefined) {
                return reasons.Citation;
            }
            const named = context.facts.get(operation.fact);
            if (named === undefined || ScribeLog.unnamed(named)) {
                return reasons.Reference;
            }
            if (operation.position < named.position) {
                return reasons.Citation;
            }
            const owned = ScribeLog.owns(context, operation.owner, named.subject);
            if (!owned || ScribeLog.clashes(context, operation.label)) {
                return reasons.Mismatch;
            }
            const subject = ScribeLog.reach(context, operation.label, outcome.subjects);
            if (subject === null) {
                return reasons.Ambiguous;
            }
            outcome.checks.push({ written: operation.label, subject });
            outcome.draft = {
                type: ScribeAnswer.Type.Told,
                fact: operation.fact,
                subject,
                owner: operation.owner,
                label: operation.label,
                cite,
                position: operation.position,
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        Scene(operation, context, outcome) {
            const reasons = ScribeLog.Reason;
            const reachesBack = context.before !== null && operation.first === context.before.firstPosition;
            const first = reachesBack ? context.before.first : context.cites.get(operation.first);
            const last = context.cites.get(operation.last);
            if (first === undefined || last === undefined || context.starts.has(first)) {
                return reasons.Citation;
            }
            for (const attendee of operation.present) {
                for (const position of [attendee.from, attendee.until]) {
                    const source = context.sources.get(position);
                    if (source?.attributionPending || (context.story && source?.text === ScribeLog.Settings.Nothing)) {
                        return reasons.Citation;
                    }
                }
                if (ScribeLog.clashes(context, attendee.label)) {
                    return reasons.Mismatch;
                }
            }
            const trial = {
                ...context,
                labels: new Map(context.labels),
                names: new Map(context.names),
                counters: { ...context.counters },
            };
            const present = [];
            for (const attendee of operation.present) {
                const subject = ScribeLog.reach(trial, attendee.label, outcome.subjects);
                if (subject === null) {
                    return reasons.Ambiguous;
                }
                outcome.checks.push({ written: attendee.label, subject });
                present.push({ subject, label: attendee.label, from: attendee.from, until: attendee.until });
            }
            context.labels = trial.labels;
            context.names = trial.names;
            context.counters = trial.counters;
            context.starts.add(first);
            outcome.draft = {
                type: ScribeAnswer.Type.Scene,
                day: operation.day,
                first,
                last,
                firstPosition: operation.first,
                lastPosition: operation.last,
                place: operation.place,
                reach: operation.reach,
                present,
                summary: operation.summary,
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        Night(operation, context, outcome) {
            const cite = context.cites.get(operation.position);
            if (cite === undefined) {
                return ScribeLog.Reason.Citation;
            }
            outcome.draft = {
                type: ScribeAnswer.Type.Night,
                cite,
                position: operation.position,
                marker: operation.marker,
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        ThreadOpen(operation, context, outcome) {
            const cite = context.cites.get(operation.position);
            if (cite === undefined) {
                return ScribeLog.Reason.Citation;
            }
            outcome.draft = {
                type: ScribeAnswer.Type.ThreadOpen,
                thread: null,
                text: operation.text,
                cite,
                position: operation.position,
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        ThreadClose(operation, context, outcome) {
            const reasons = ScribeLog.Reason;
            const cite = context.cites.get(operation.position);
            if (cite === undefined) {
                return reasons.Citation;
            }
            if (!context.threads.has(operation.thread)) {
                return reasons.Reference;
            }
            outcome.draft = {
                type: ScribeAnswer.Type.ThreadClose,
                thread: operation.thread,
                how: operation.how,
                cite,
                position: operation.position,
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        Question(operation, context, outcome) {
            const cite = context.cites.get(operation.position);
            if (cite === undefined) {
                return ScribeLog.Reason.Citation;
            }
            outcome.draft = {
                type: ScribeAnswer.Type.Question,
                question: null,
                text: operation.text,
                cite,
                position: operation.position,
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        Contradiction(operation, context, outcome) {
            const cite = context.cites.get(operation.position);
            if (cite === undefined || typeof operation.earlierCite !== 'string') {
                return ScribeLog.Reason.Citation;
            }
            outcome.draft = {
                type: ScribeAnswer.Type.Contradiction,
                cite,
                position: operation.position,
                earlier: operation.earlierCite,
                earlierPosition: operation.earlier,
                said: operation.said,
                before: operation.before,
                why: operation.why,
            };
            return null;
        },
    }),

    Finishers: Object.freeze({
        /**
         * @param {object} draft
         * @param {object} context
         * @return {void}
         */
        Fact(draft, context) {
            if (draft.targetText !== null && !ScribeLog.clashes(context, draft.targetText)) {
                draft.target = ScribeLog.find(context, draft.targetText).subject;
            }
            draft.fact = ScribeLog.Settings.FactPrefix + context.counters.nextFact;
            context.counters.nextFact++;
        },

        /**
         * @param {object} draft
         * @param {object} context
         * @return {void}
         */
        Refine(draft, context) {
            draft.becomes = ScribeLog.Settings.FactPrefix + context.counters.nextFact;
            context.counters.nextFact++;
        },

        /**
         * @param {object} draft
         * @param {object} context
         * @return {void}
         */
        Change(draft, context) {
            ScribeLog.Finishers.Refine(draft, context);
        },

        /**
         * @param {object} draft
         * @param {object} context
         * @return {void}
         */
        ThreadOpen(draft, context) {
            draft.thread = ScribeLog.Settings.ThreadPrefix + context.counters.nextThread;
            context.counters.nextThread++;
        },

        /**
         * @param {object} draft
         * @param {object} context
         * @return {void}
         */
        Question(draft, context) {
            draft.question = ScribeLog.Settings.QuestionPrefix + context.counters.nextQuestion;
            context.counters.nextQuestion++;
        },
    }),

    Rulers: Object.freeze({
        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        Pin(operation, view, outcome) {
            const { subject, category, target, text, hidden } = operation;
            const fixed = ScribeLog.categoryKind(category) === ScribeCategory.Kind.Fixed;
            const valid =
                typeof subject === 'string' &&
                fixed &&
                target === null &&
                ScribeLog.worded(text) &&
                typeof hidden === 'boolean';
            if (!valid) {
                return ScribeLog.Settings.InvalidOperation;
            }
            if (!view.subjects.has(subject)) {
                return ScribeLog.Reason.Reference;
            }
            const owner = ScribeLog.root(view, subject);
            const winner = view.state.facts.find(
                /**
                 * @param {object} fact
                 * @return {boolean}
                 */
                (fact) =>
                    fact.subject === owner &&
                    fact.category === category &&
                    ScribeReplay.live(fact) &&
                    !ScribeLog.unnamed(fact) &&
                    ScribeCategory.same(fact.text, text),
            );
            const source =
                winner ??
                view.state.facts.find(
                    /**
                     * @param {object} fact
                     * @return {boolean}
                     */
                    (fact) =>
                        fact.made &&
                        fact.subject === owner &&
                        fact.category === category &&
                        fact.status === ScribeReplay.Status.InForce &&
                        ScribeCategory.same(fact.text, text),
                );
            outcome.stored = {
                type: operation.type,
                subject,
                category,
                target: null,
                text,
                hidden: winner === undefined ? hidden : winner.hidden,
                fact: ScribeLog.nextFactId(outcome.counters),
                winner: winner === undefined ? null : winner.id,
                told: source === undefined ? [] : [...source.told],
                origin: source === undefined ? ScribeLog.Origin.Operator : source.origin,
                cite: source === undefined ? null : source.cite,
                position: source === undefined ? ScribeReplay.Settings.PinnedPosition : source.position,
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        Merge(operation, view, outcome) {
            const { from, into } = operation;
            if (ScribeLog.root(view, from) !== from) {
                return ScribeLog.Settings.InvalidOperation;
            }
            const reason = ScribeLog.twoSubjects(view, from, into);
            if (reason === null) {
                outcome.stored = { type: operation.type, from, into };
            }
            return reason;
        },

        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        Split(operation, view, outcome) {
            const settings = ScribeLog.Settings;
            const reasons = ScribeLog.Reason;
            const { subject, label, kind, facts } = operation;
            const listing =
                ScribeLog.ids(facts) &&
                !facts.some(
                    /**
                     * @param {string} id
                     * @return {boolean}
                     */
                    (id) => ScribeLog.unnamed(view.facts.get(id)),
                );
            const valid =
                typeof subject === 'string' &&
                typeof label === 'string' &&
                label.length <= ScribeAnswer.Settings.MaxLabel &&
                ScribeLog.worded(ScribeText.normaliseName(label)) &&
                Object.values(ScribeCategory.SubjectKinds).includes(kind) &&
                listing;
            if (!valid) {
                return settings.InvalidOperation;
            }
            if (!view.subjects.has(subject)) {
                return reasons.Reference;
            }
            const owner = ScribeLog.root(view, subject);
            for (const id of facts) {
                const fact = view.facts.get(id);
                if (fact === undefined || fact.subject !== owner) {
                    return reasons.Reference;
                }
            }
            const context = { labels: new Map(), names: new Map(), subjects: new Map() };
            ScribeLog.learn(context, view.state);
            const found = ScribeLog.find(context, label);
            if (found.ambiguous || found.subject !== null) {
                return reasons.Ambiguous;
            }
            const becomes = settings.SubjectPrefix + outcome.counters.nextSubject;
            outcome.counters.nextSubject++;
            outcome.stored = { type: operation.type, subject, label, kind, facts: [...facts], becomes };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        Distinct(operation, view, outcome) {
            const { first, second } = operation;
            const reason = ScribeLog.twoSubjects(view, first, second);
            if (reason === null) {
                outcome.stored = { type: operation.type, first, second };
            }
            return reason;
        },

        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        Narrow(operation, view, outcome) {
            const { scene } = operation;
            if (typeof scene !== 'string') {
                return ScribeLog.Settings.InvalidOperation;
            }
            if (ScribeLog.lookup(view.state.scenes, scene) === undefined) {
                return ScribeLog.Reason.Reference;
            }
            outcome.stored = { type: operation.type, scene };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        Widen(operation, view, outcome) {
            const { fact, to } = operation;
            const everyone = to === ScribeLog.Settings.Everyone;
            const named = view.facts.get(fact);
            if (typeof fact !== 'string' || (!everyone && !ScribeLog.ids(to)) || ScribeLog.unnamed(named)) {
                return ScribeLog.Settings.InvalidOperation;
            }
            const known =
                everyone ||
                to.every(
                    /**
                     * @param {string} id
                     * @return {boolean}
                     */
                    (id) => view.subjects.has(id),
                );
            if (named === undefined || !known) {
                return ScribeLog.Reason.Reference;
            }
            outcome.stored = {
                type: operation.type,
                fact,
                to: everyone ? to : [...to],
                mark: ScribeLog.mark(named),
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        AddFact(operation, view, outcome) {
            const { subject, category, target, text, hidden, cite, position } = operation;
            const relation = category === ScribeCategory.Settings.RelationCategory;
            const kind = ScribeLog.categoryKind(category);
            const valid =
                typeof subject === 'string' &&
                (relation || (kind !== null && kind !== ScribeCategory.Kind.Fixed)) &&
                (relation ? typeof target === 'string' : target === null) &&
                ScribeLog.worded(text) &&
                typeof hidden === 'boolean' &&
                (cite === null || typeof cite === 'string') &&
                Number.isSafeInteger(position) &&
                position >= ScribeLog.Settings.LeastPosition;
            if (!valid) {
                return ScribeLog.Settings.InvalidOperation;
            }
            const owner = ScribeLog.root(view, subject);
            const aimed = relation ? view.subjects.get(target) : undefined;
            const aimedName = aimed === undefined ? ScribeLog.Settings.Nothing : ScribeText.normaliseName(aimed.label);
            const present = view.state.facts.some(
                /**
                 * @param {object} fact
                 * @return {boolean}
                 */
                (fact) => {
                    const written = fact.targetText === null ? null : ScribeText.normaliseName(fact.targetText);
                    const aimedAlike =
                        aimed !== undefined &&
                        (fact.target === ScribeLog.root(view, target) ||
                            (aimedName !== ScribeLog.Settings.Nothing && written === aimedName));
                    return (
                        fact.subject === owner &&
                        fact.category === category &&
                        fact.status === ScribeReplay.Status.InForce &&
                        (!relation || aimedAlike) &&
                        ScribeCategory.same(fact.text, text)
                    );
                },
            );
            if (present) {
                return ScribeLog.Settings.InvalidOperation;
            }
            if (!view.subjects.has(subject) || (relation && aimed === undefined)) {
                return ScribeLog.Reason.Reference;
            }
            outcome.stored = {
                type: operation.type,
                subject,
                category,
                target,
                targetText: relation ? view.subjects.get(target).label : null,
                text,
                hidden,
                cite,
                position,
                fact: ScribeLog.nextFactId(outcome.counters),
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        RemoveFact(operation, view, outcome) {
            const { fact } = operation;
            const named = view.facts.get(fact);
            if (typeof fact !== 'string' || ScribeLog.unnamed(named)) {
                return ScribeLog.Settings.InvalidOperation;
            }
            if (named === undefined) {
                return ScribeLog.Reason.Reference;
            }
            outcome.stored = { type: operation.type, fact, mark: ScribeLog.mark(named) };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        Unalias(operation, view, outcome) {
            const { subject, name } = operation;
            if (typeof subject !== 'string' || typeof name !== 'string') {
                return ScribeLog.Settings.InvalidOperation;
            }
            const owner = ScribeLog.root(view, subject);
            const key = ScribeText.normaliseName(name);
            const held = view.state.aliases.some(
                /**
                 * @param {{ subject: string, name: string }} item
                 * @return {boolean}
                 */
                (item) => item.subject === owner && ScribeText.normaliseName(item.name) === key,
            );
            if (!view.subjects.has(subject) || !held) {
                return ScribeLog.Reason.Reference;
            }
            outcome.stored = { type: operation.type, subject, name };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        Answer(operation, view, outcome) {
            const { question, text } = operation;
            if (typeof question !== 'string' || !ScribeLog.worded(text)) {
                return ScribeLog.Settings.InvalidOperation;
            }
            const asked = ScribeLog.lookup(view.state.questions, question);
            if (asked === undefined) {
                return ScribeLog.Reason.Reference;
            }
            outcome.stored = { type: operation.type, question, text, questionText: asked.text };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        Dismiss(operation, view, outcome) {
            const { question } = operation;
            if (typeof question !== 'string') {
                return ScribeLog.Settings.InvalidOperation;
            }
            const asked = ScribeLog.lookup(view.state.questions, question);
            if (asked === undefined) {
                return ScribeLog.Reason.Reference;
            }
            outcome.stored = { type: operation.type, question, questionText: asked.text };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        DismissContradiction(operation, view, outcome) {
            const { contradiction } = operation;
            if (typeof contradiction !== 'string') {
                return ScribeLog.Settings.InvalidOperation;
            }
            const read = ScribeLog.lookup(view.state.contradictions, contradiction);
            if (read === undefined) {
                return ScribeLog.Reason.Reference;
            }
            outcome.stored = { type: operation.type, contradiction, said: read.said, before: read.before };
            return null;
        },
    }),

    /**
     * @param {object} log
     * @param {object} state
     * @param {readonly object[]} operations
     * @param {{ messages: readonly object[], origin: string, sources?: ReadonlyMap<number, object> }} stretch
     * @return {Readonly<{ entry: object, refused: ReadonlyArray<Readonly<{ operation: object, reason: string }>> }>}
     * @throws {Error}
     */
    append(log, state, operations, stretch) {
        const settings = ScribeLog.Settings;
        const origins = ScribeLog.Origin;
        if (
            stretch.origin !== origins.Story &&
            stretch.origin !== origins.Notes &&
            stretch.origin !== origins.Answers
        ) {
            throw new Error(settings.UnknownOrigin);
        }
        if (state.revision !== log.revision) {
            throw new Error(settings.StaleState);
        }
        const story = stretch.origin === origins.Story;
        const sources = stretch.sources ?? new Map(stretch.messages.map((message) => [message.position, message]));
        const messageIds = [];
        const cites = new Map();
        let earliest = Number.POSITIVE_INFINITY;
        for (const message of stretch.messages) {
            if (message.attributionPending) {
                continue;
            }
            messageIds.push(message.id);
            if (!story || message.text !== settings.Nothing) {
                cites.set(message.position, message.id);
            }
            earliest = Math.min(earliest, message.position);
        }
        let before = null;
        for (const scene of state.scenes) {
            const running =
                before === null ||
                scene.lastPosition > before.lastPosition ||
                (scene.lastPosition === before.lastPosition && scene.firstPosition > before.firstPosition);
            if (scene.firstPosition < earliest && running) {
                before = scene;
            }
        }
        if (story) {
            for (const id of messageIds) {
                if (Object.hasOwn(log.read, id)) {
                    throw new Error(settings.AlreadyRead);
                }
            }
        }
        const unaliased = new Set();
        for (const item of state.unaliased) {
            unaliased.add(ScribeLog.aliasKey(item.subject, item.name));
        }
        const distinct = new Set();
        for (const item of state.distinct) {
            distinct.add(ScribeLog.pair(item.first, item.second));
        }
        const settled = new Map();
        let marked = new Set();
        let context = null;
        let results = [];
        let unsettled = true;
        while (unsettled) {
            context = {
                cites,
                sources,
                story,
                before,
                unaliased,
                distinct,
                starts: new Set(),
                facts: new Map(),
                threads: new Set(),
                labels: new Map(),
                names: new Map(),
                subjects: new Map(),
                mismatched: new Set(marked),
                counters: {
                    nextSubject: log.nextSubject,
                    nextFact: log.nextFact,
                    nextThread: log.nextThread,
                    nextQuestion: log.nextQuestion,
                },
            };
            for (const fact of state.facts) {
                context.facts.set(fact.id, fact);
            }
            for (const thread of state.threads) {
                context.threads.add(thread.id);
            }
            ScribeLog.learn(context, state);
            results = [];
            for (const [index, operation] of operations.entries()) {
                if (!Object.hasOwn(ScribeLog.Resolvers, operation.type)) {
                    throw new Error(settings.UnknownOperation);
                }
                const outcome = { subjects: [], draft: null, checks: [] };
                const reason = settled.get(index) ?? ScribeLog.Resolvers[operation.type](operation, context, outcome);
                results.push({ operation, outcome, reason });
            }
            let refusedAtEnd = false;
            for (const [index, { outcome, reason }] of results.entries()) {
                const shifted =
                    reason === null &&
                    outcome.checks.some(
                        /**
                         * @param {{ written: string, subject: string }} check
                         * @return {boolean}
                         */
                        (check) => ScribeLog.find(context, check.written).subject !== check.subject,
                    );
                if (shifted) {
                    settled.set(index, ScribeLog.Reason.Ambiguous);
                    refusedAtEnd = true;
                }
            }
            unsettled = refusedAtEnd || context.mismatched.size > marked.size;
            marked = context.mismatched;
        }
        const resolved = [];
        const refused = [];
        for (const { operation, outcome, reason } of results) {
            if (reason !== null) {
                refused.push(Object.freeze({ operation, reason }));
                continue;
            }
            resolved.push(...outcome.subjects);
            if (outcome.draft === null) {
                continue;
            }
            if (Object.hasOwn(ScribeLog.Finishers, outcome.draft.type)) {
                ScribeLog.Finishers[outcome.draft.type](outcome.draft, context);
            }
            resolved.push(outcome.draft);
        }
        const entry = {
            sequence: log.nextSequence,
            kind: ScribeLog.Kind.Update,
            origin: stretch.origin,
            messageIds: story ? messageIds : [],
            operations: resolved,
            withdrawn: false,
        };
        Object.assign(log, context.counters);
        log.nextSequence++;
        log.revision++;
        log.entries.push(entry);
        for (const id of entry.messageIds) {
            log.read[id] = entry.sequence;
        }
        return Object.freeze({ entry, refused: Object.freeze(refused) });
    },

    /**
     * @param {object} log
     * @param {object} operation
     * @return {object}
     */
    file(log, operation) {
        const entry = {
            sequence: log.nextSequence,
            kind: ScribeLog.Kind.Operator,
            origin: ScribeLog.Origin.Operator,
            messageIds: [],
            operations: [operation],
            withdrawn: false,
        };
        log.nextSequence++;
        log.revision++;
        log.entries.push(entry);
        return entry;
    },

    /**
     * @param {object} log
     * @param {object} state
     * @param {object} operation
     * @return {object}
     * @throws {Error}
     */
    rule(log, state, operation) {
        const settings = ScribeLog.Settings;
        if (state.revision !== log.revision) {
            throw new Error(settings.StaleState);
        }
        if (operation === null || typeof operation !== 'object' || !Object.hasOwn(ScribeLog.Ruling, operation.type)) {
            throw new Error(settings.UnknownOperation);
        }
        const outcome = { counters: { nextFact: log.nextFact, nextSubject: log.nextSubject }, stored: null };
        const reason = ScribeLog.Rulers[operation.type](operation, ScribeLog.view(state), outcome);
        if (reason !== null) {
            throw new Error(reason);
        }
        Object.assign(log, outcome.counters);
        return ScribeLog.file(log, outcome.stored);
    },

    /**
     * @param {object} log
     * @param {object} state
     * @return {readonly object[]}
     * @throws {Error}
     */
    keepFirst(log, state) {
        if (state.revision !== log.revision) {
            throw new Error(ScribeLog.Settings.StaleState);
        }
        const facts = ScribeLog.view(state).facts;
        const counters = { nextFact: log.nextFact };
        const pins = [];
        for (const conflict of state.conflicts) {
            if (conflict.established === null) {
                continue;
            }
            const fact = facts.get(conflict.established);
            pins.push({
                type: ScribeLog.Ruling.Pin,
                subject: fact.subject,
                category: fact.category,
                target: null,
                text: fact.text,
                hidden: fact.hidden,
                fact: ScribeLog.nextFactId(counters),
                winner: fact.id,
                told: [...fact.told],
                origin: fact.origin,
                cite: fact.cite,
                position: fact.position,
            });
        }
        log.nextFact = counters.nextFact;
        const entries = [];
        for (const pin of pins) {
            entries.push(ScribeLog.file(log, pin));
        }
        return Object.freeze(entries);
    },

    /**
     * @param {object} log
     * @param {string} messageId
     * @return {readonly string[]|null}
     */
    withdraw(log, messageId) {
        let found = null;
        for (const entry of log.entries) {
            const story = entry.kind === ScribeLog.Kind.Update && entry.origin === ScribeLog.Origin.Story;
            if (story && !entry.withdrawn && entry.messageIds.includes(messageId)) {
                found = entry;
                break;
            }
        }
        if (found === null) {
            return null;
        }
        found.withdrawn = true;
        for (const id of found.messageIds) {
            if (log.read[id] === found.sequence) {
                delete log.read[id];
            }
        }
        log.revision++;
        return Object.freeze([...found.messageIds]);
    },

    /**
     * @param {object} log
     * @param {number} sequence
     * @return {object|null}
     */
    revoke(log, sequence) {
        for (const entry of log.entries) {
            if (entry.sequence === sequence && entry.kind === ScribeLog.Kind.Operator && !entry.withdrawn) {
                entry.withdrawn = true;
                log.revision++;
                return entry;
            }
        }
        return null;
    },
});
