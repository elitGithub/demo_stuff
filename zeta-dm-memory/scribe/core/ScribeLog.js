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
        Checker: 'Checker',
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
        EditFact: 'EditFact',
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
        const scope = ScribeCategory.scope(operation);
        const original = ScribeCategory.scope(named);
        if ((scope.form && scope.form !== original.form) || (scope.dimension && scope.dimension !== original.dimension)) {
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
            ...ScribeCategory.scope(fact),
            target: fact.target,
            targetText: fact.targetText,
            text: fact.text,
        };
    },

    /**
     * @param {object} fact
     * @return {object}
     */
    editExpected(fact, state = null) {
        const audience = state ? ScribeKnowledge.audience(state, fact) : null;
        return { ...ScribeLog.mark(fact), cite: fact.cite, status: fact.status, pinned: fact.pinned,
            ...(state ? { audience: Array.isArray(audience) ? [...new Set(audience)].sort() : audience,
                fingerprint: ScribeReplay.Inputs.get(state)?.fingerprints?.get(fact.cite) ?? null } : {}),
            hidden: fact.hidden, widened: Array.isArray(fact.widened) ? [...new Set(fact.widened)].sort() : fact.widened,
            told: [...new Set(fact.told)].sort() };
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
                outcome.draft = ScribeLog.make(context, operation.label, operation.kind);
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
                if (operation.evidence) {
                    outcome.draft = { type: operation.type, subject: match.subject, label: known.label, kind: known.kind };
                }
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
                if (operation.evidence) {
                    outcome.draft = { type: operation.type, subject: known.subject, name: operation.name,
                        cite, position: operation.position, other: null };
                }
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
                ...ScribeCategory.scope(operation),
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
                ...ScribeCategory.scope(named),
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
                ...ScribeCategory.scope(named),
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
         * @param {object} outcome
         * @return {string|null}
         */
        EditFact(operation, view, outcome) {
            const fact = view.facts.get(operation.fact);
            if (!ScribeReplay.live(fact) || !operation.expected) {
                return ScribeLog.Settings.StaleState;
            }
            const expected = ScribeLog.editExpected(fact, Object.hasOwn(operation.expected, 'audience') ? view.state : null);
            if (Object.keys(expected).some((key) => JSON.stringify(expected[key]) !== JSON.stringify(operation.expected[key]))) {
                return ScribeLog.Settings.StaleState;
            }
            if (!ScribeLog.worded(operation.text)) {
                return 'Write the corrected wording.';
            }
            const text = operation.text.trim();
            const scope = ScribeCategory.scope(fact);
            const corrected = ScribeCategory.scope({ category: fact.category, text });
            if ((scope.form && corrected.form && scope.form !== corrected.form) ||
                (scope.dimension && corrected.dimension && scope.dimension !== corrected.dimension)) {
                return ScribeLog.Reason.Mismatch;
            }
            const edited = { ...fact, text, ...corrected, ...Object.fromEntries(Object.entries(scope).filter(([, value]) => value)) };
            if (text === fact.text) {
                return null;
            }
            const kind = ScribeReplay.kindOf(fact.category);
            if ([ScribeCategory.Kind.Fixed, ScribeCategory.Kind.List].includes(kind) &&
                view.state.facts.some((other) => other.id !== fact.id && ScribeReplay.live(other) &&
                    other.subject === fact.subject && other.category === fact.category && ScribeCategory.sameScope(other, edited) &&
                    ScribeCategory.value(other) === ScribeCategory.value(edited))) {
                return 'This wording would combine two facts. Choose distinct wording.';
            }
            const source = view.state.editOrigins?.[fact.id] ?? { fact: fact.id, cite: fact.cite,
                subject: fact.subject, category: fact.category, target: fact.target, targetText: fact.targetText,
                ...ScribeCategory.scope(fact), book: fact.text, sourcePrint: null };
            outcome.stored = { type: operation.type, fact: fact.id, before: fact.text, text, ...ScribeCategory.scope(edited), source: { ...source } };
            return null;
        },

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
                [operation.form, operation.dimension].every((part) => part == null || ScribeLog.worded(part)) &&
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
                    ScribeCategory.sameScope(fact, operation) &&
                    ScribeReplay.live(fact) &&
                    !ScribeLog.unnamed(fact) &&
                    ScribeCategory.value(fact) === ScribeCategory.value(operation),
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
                        ScribeCategory.sameScope(fact, operation) &&
                        fact.status === ScribeReplay.Status.InForce &&
                        ScribeCategory.value(fact) === ScribeCategory.value(operation),
                );
            outcome.stored = {
                type: operation.type,
                subject,
                category,
                ...ScribeCategory.scope(operation),
                target: null,
                text,
                hidden: winner === undefined ? hidden : winner.hidden,
                fact: ScribeLog.nextFactId(outcome.counters),
                winner: winner === undefined ? null : winner.id,
                told: source === undefined ? [] : [...source.told],
                origin: source === undefined ? ScribeLog.Origin.Operator : source.origin,
                cite: source === undefined ? null : source.cite,
                position: source === undefined ? ScribeReplay.Settings.PinnedPosition : source.position,
                ...(source?.evidence ? { evidence: source.evidence } : {}),
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
                const evidence = operation.evidence;
                const wrongSource = evidence && (cites.get(evidence.messageNumber) !== evidence.messageId ||
                    sources.get(evidence.messageNumber)?.fingerprint !== evidence.fingerprint ||
                    (operation.position !== undefined && operation.position !== evidence.messageNumber));
                const reason = wrongSource ? ScribeLog.Reason.Citation :
                    settled.get(index) ?? ScribeLog.Resolvers[operation.type](operation, context, outcome);
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
            for (const subject of outcome.subjects) {
                if (operation.evidence) {
                    subject.cite = operation.evidence.messageId;
                }
                resolved.push(subject);
            }
            if (outcome.draft === null) {
                continue;
            }
            if (operation.evidence) {
                outcome.draft.evidence = operation.evidence;
                outcome.draft.cite ??= operation.evidence.messageId;
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
        if (story && stretch.results) {
            entry.sources = stretch.messages.map((message) => ({
                id: message.id, position: message.position, fingerprint: message.fingerprint,
                result: stretch.results.get(message.position),
            }));
        }
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
        if (operation.type === ScribeLog.Ruling.EditFact) {
            ScribeLog.noteEdit(log);
        }
        log.revision++;
        log.entries.push(entry);
        return entry;
    },

    /**
     * @param {object} log
     * @return {void}
     */
    noteEdit(log) {
        const from = log.editRun?.through === log.revision ? log.editRun.from : log.revision;
        log.editRun = { from, through: log.revision + 1 };
    },

    /**
     * @param {object} operation
     * @param {object} issue
     * @return {boolean}
     */
    settles(operation, issue) {
        const ruling = ScribeLog.Ruling;
        const type = ScribeAnswer.Type;
        if (issue.kind === 'Leak') {
            if (operation.type === type.Told) {
                return operation.fact === issue.fact && operation.subject === issue.speaker;
            }
            return operation.type === ruling.Widen && operation.fact === issue.fact &&
                (operation.to === ScribeLog.Settings.Everyone || operation.to.includes(issue.speaker));
        }
        if (issue.kind !== 'Contradiction') {
            return false;
        }
        if (operation.type === ruling.DismissContradiction) {
            return operation.contradiction === issue.contradiction;
        }
        if (operation.type === ruling.RemoveFact) {
            return operation.fact === issue.fact;
        }
        if (operation.type === ruling.EditFact) {
            return operation.fact === issue.fact && operation.before === issue.book &&
                ScribeCategory.same(operation.text, issue.said);
        }
        if (operation.type === type.End) {
            const said = ScribeReplay.wording(issue.said);
            return operation.fact === issue.fact && operation.cite === issue.message && said.length > 0 &&
                (' ' + ScribeReplay.wording(operation.reason) + ' ').includes(' ' + said + ' ');
        }
        if (operation.subject !== issue.subject || operation.category !== issue.category ||
            !ScribeCategory.sameScope(operation, { ...issue, text: issue.book }) ||
            operation.target !== issue.target || (operation.target === null && operation.targetText &&
                operation.targetText !== issue.targetText)) {
            return false;
        }
        if (operation.type === ruling.Pin) {
            return operation.winner === issue.fact || ScribeCategory.same(operation.text, issue.said) ||
                (operation.dispute?.some((fact) => fact.id === issue.fact) &&
                    operation.dispute.some((fact) => fact.cite === issue.message && ScribeCategory.same(fact.text, issue.said)));
        }
        return [type.Fact, type.Refine, type.Change, ruling.AddFact].includes(operation.type) &&
            (![type.Refine, type.Change].includes(operation.type) || operation.fact === issue.fact) &&
            (ScribeCategory.same(operation.text, issue.said) || ScribeCategory.same(operation.text, issue.book));
    },

    /**
     * @param {object} entry
     * @param {object} state
     * @param {object[]} findings
     * @param {readonly object[]} messages
     * @return {void}
     */
    link(entry, state, findings, messages) {
        const sources = new Map(messages.map((message) => [message.id, message]));
        const issues = [];
        for (const finding of findings) {
            const fact = ScribeLog.lookup(state.facts, finding.fact);
            const reply = sources.get(finding.message);
            if (!fact || !reply || reply.fromPlayer || reply.attributionPending || reply.fingerprint !== finding.fingerprint ||
                fact.subject !== finding.subject || fact.category !== finding.category ||
                typeof finding.book !== 'string' || !ScribeCategory.same(fact.text, finding.book) ||
                typeof finding.said !== 'string' || !ScribeReplay.wording(finding.said) ||
                !reply.blocks.some((block) => {
                    if (finding.kind === 'Leak') {
                        const speaker = ScribeLog.lookup(state.subjects, finding.speaker);
                        if (!speaker || block.role !== ScribeIntake.Role.Character ||
                            ![speaker.label, speaker.name, ...speaker.aka].some((name) =>
                                ScribeText.normaliseName(name) === ScribeText.normaliseName(block.speaker))) {
                            return false;
                        }
                    }
                    return (' ' + ScribeReplay.wording(block.text) + ' ').includes(' ' + ScribeReplay.wording(finding.said) + ' ');
                })) {
                continue;
            }
            const source = sources.get(fact.cite);
            if (fact.cite !== null && (!source || source.attributionPending)) {
                continue;
            }
            if (finding.support && (finding.support.cite !== fact.cite ||
                finding.support.sourcePrint !== source?.fingerprint)) {
                continue;
            }
            const conflict = state.contradictions.find((item) => item.cite === reply.id &&
                item.earlier === fact.cite && ScribeCategory.same(item.said, finding.said) &&
                ScribeCategory.same(item.before, fact.text));
            issues.push({
                kind: finding.kind, fact: fact.id, subject: fact.subject, category: fact.category,
                ...ScribeCategory.scope(fact),
                target: fact.target, targetText: fact.targetText, book: fact.text, said: finding.said,
                speaker: finding.speaker ?? null, message: reply.id, fingerprint: reply.fingerprint,
                cite: fact.cite, sourcePrint: source?.fingerprint ?? null, contradiction: conflict?.id ?? null,
            });
        }
        for (const operation of entry.operations) {
            const ruling = ScribeLog.Ruling;
            if (operation.type === ruling.EditFact && operation.source.sourcePrint === null && operation.source.cite !== null) {
                operation.source.sourcePrint = sources.get(operation.source.cite)?.fingerprint ?? null;
            }
            if (operation.type === ruling.Widen) {
                for (const prior of state.resolutions) {
                    const { sequence, alternatives, activeFact, ...issue } = prior;
                    issue.fact = activeFact;
                    if (ScribeLog.settles(operation, issue) && !issues.some((candidate) => candidate.kind === issue.kind &&
                        candidate.fact === issue.fact && candidate.message === issue.message && candidate.speaker === issue.speaker)) {
                        issues.push(issue);
                    }
                }
            }
            let ids = [];
            if ([ruling.Answer, ruling.Dismiss].includes(operation.type)) {
                const question = ScribeLog.lookup(state.questions, operation.question);
                ids = [question.cite];
            } else if (operation.type === ruling.DismissContradiction) {
                const contradiction = ScribeLog.lookup(state.contradictions, operation.contradiction);
                ids = [contradiction.cite, contradiction.earlier];
            } else if (operation.type === ruling.Pin) {
                const conflict = state.conflicts.find((item) => item.subject === operation.subject &&
                    item.category === operation.category && ScribeCategory.sameScope(item, operation));
                if (conflict) {
                    operation.dispute = [conflict.established, ...conflict.others].filter(Boolean).map((id) => {
                        const fact = ScribeLog.lookup(state.facts, id);
                        return { id, cite: fact.cite, text: fact.text, ...ScribeCategory.scope(fact) };
                    });
                    ids = operation.dispute.map((fact) => fact.cite);
                }
            }
            const passages = [...new Set(ids)].filter((id) => sources.has(id));
            if (passages.length) {
                operation.passages = passages.map((id) => ({ id, fingerprint: sources.get(id).fingerprint }));
            }
            const linked = issues.filter((issue) => ScribeLog.settles(operation, issue));
            if (linked.length) {
                operation.resolutions = linked.map((issue) => {
                    const alternatives = state.facts.filter((fact) => fact.subject === issue.subject &&
                        fact.category === issue.category && fact.cite === issue.message &&
                        ScribeCategory.sameScope(fact, { ...issue, text: issue.book }) &&
                        ScribeCategory.same(fact.text, issue.said)).map((fact) => fact.id);
                    if ([ScribeAnswer.Type.Fact, ScribeLog.Ruling.AddFact].includes(operation.type)) {
                        alternatives.push(operation.fact);
                    }
                    return { ...issue, alternatives };
                });
            }
        }
        entry.linked = true;
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
        if (outcome.stored === null) {
            return null;
        }
        if ([ScribeLog.Ruling.Widen, ScribeLog.Ruling.RemoveFact].includes(operation.type) && state.editOrigins?.[operation.fact]) {
            outcome.stored.editedSource = { ...state.editOrigins[operation.fact] };
        }
        if (operation.type === ScribeLog.Ruling.Pin && state.editOrigins?.[outcome.stored.winner]) {
            outcome.stored.editedSource = { ...state.editOrigins[outcome.stored.winner] };
        }
        if (operation.type === ScribeLog.Ruling.EditFact) {
            const inputs = ScribeReplay.Inputs.get(state);
            if (!inputs) {
                throw new Error(settings.StaleState);
            }
            const { order, pending, fingerprints, messages } = inputs;
            const source = outcome.stored.source;
            source.sourcePrint ??= fingerprints?.get(source.cite) ?? null;
            const preview = { ...log, entries: [...log.entries] };
            ScribeLog.file(preview, outcome.stored);
            const after = ScribeReplay.run(preview, order, pending, fingerprints, null, null, messages);
            const retained = new Set(after.facts.map((fact) => fact.id));
            if (state.facts.some((fact) => !retained.has(fact.id)) ||
                !after.facts.some((fact) => fact.id === operation.fact && fact.text === outcome.stored.text)) {
                throw new Error('This wording would combine two facts. Choose distinct wording.');
            }
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
                ...ScribeCategory.scope(fact),
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
     * @param {object} book
     * @param {readonly object[]} messages
     * @return {{writtenThrough: number, verificationPending: string[], legacyClaims: object[]}}
     */
    coverage(book, messages) {
        const receipts = new Map();
        const operations = new Map();
        for (const entry of book.log.entries) {
            if (entry.withdrawn || entry.origin !== ScribeLog.Origin.Story) {
                continue;
            }
            for (const source of entry.sources ?? []) {
                if (book.log.read[source.id] === entry.sequence) {
                    receipts.set(source.id, source);
                }
            }
            if (!entry.sources) {
                for (const operation of entry.operations) {
                    const id = operation.evidence?.messageId ?? operation.cite ?? operation.last;
                    if (id && book.log.read[id] === entry.sequence) {
                        if (!operations.has(id)) {
                            operations.set(id, []);
                        }
                        operations.get(id).push(operation);
                    }
                }
            }
        }
        let writtenThrough = 0;
        const verificationPending = [];
        const legacyClaims = [];
        for (const [index, message] of messages.entries()) {
            if (!Object.hasOwn(book.log.read, message.id) || message.attributionPending || typeof message.fingerprint !== 'string' ||
                book.fingerprints[message.id] !== message.fingerprint ||
                (book.projections?.[message.id] ?? null) !== (message.projection ?? null)) {
                continue;
            }
            if (index === writtenThrough) {
                writtenThrough++;
            }
            const receipt = receipts.get(message.id);
            if (receipt?.fingerprint !== message.fingerprint || !['read', 'no change'].includes(receipt.result)) {
                verificationPending.push(message.id);
                if (operations.has(message.id)) {
                    legacyClaims.push(...ScribeLog.sourceClaims(message, operations.get(message.id)));
                }
            }
        }
        return { writtenThrough, verificationPending, legacyClaims };
    },

    /**
     * @param {object} book
     * @param {readonly object[]} messages
     * @return {object}
     */
    checkIndex(book, messages) {
        const byId = new Map(messages.map((message) => [message.id, message]));
        const rows = messages.map(() => ({ written: [], rulings: [], decisions: [] }));
        const checks = new Map();
        const legacy = new Map();
        for (const entry of book.log.entries) {
            for (const binding of entry.withdrawn ? [] : entry.check?.legacyRulings ?? []) {
                legacy.set(JSON.stringify([binding.legacyQuestion, binding.legacy]), binding);
            }
        }
        let lastFiled = 0;
        for (const entry of book.log.entries) {
            if (entry.checkerRuling) {
                const decision = entry.checkerRuling;
                const next = byId.get(decision.after)?.position;
                if (!entry.withdrawn && next && rows[next]) {
                    const current = decision.support.every((source) => ScribeLog.supportedPassage(source, byId.get(source.messageId)));
                    const row = current ? { origin: ScribeLog.Origin.Operator, position: next,
                        text: JSON.stringify({ finding: decision.finding, sequence: entry.sequence, question: decision.question, decision: decision.canonical,
                            accounts: decision.claims, action: decision.action }) } : null;
                    if (row) {
                        rows[next].rulings.push(row);
                    }
                    rows[next].decisions.push({ decision, sequence: entry.sequence, row });
                }
                continue;
            }
            if (entry.origin === ScribeLog.Origin.Checker) {
                const receipt = entry.check;
                if (receipt && !entry.withdrawn) {
                    checks.set(JSON.stringify([receipt.messageId, receipt.version]), receipt);
                }
                continue;
            }
            const story = entry.origin === ScribeLog.Origin.Story;
            let end = 0;
            for (const id of entry.messageIds) {
                end = Math.max(end, byId.get(id)?.position ?? 0);
            }
            lastFiled = Math.max(lastFiled, end);
            if (entry.withdrawn) {
                continue;
            }
            for (const operation of entry.operations) {
                if (operation.revoked || operation.type === ScribeAnswer.Type.Contradiction) {
                    continue;
                }
                const evidence = operation.evidence;
                const citedId = evidence?.messageId ?? operation.cite ?? operation.last;
                const cited = byId.get(citedId);
                const final = byId.get(operation.last);
                if (story && ((citedId && (!cited || book.log.read[citedId] !== entry.sequence)) ||
                    (operation.last && (!final || book.log.read[operation.last] !== entry.sequence)))) {
                    continue;
                }
                const position = story ? Math.max(cited?.position ?? end, final?.position ?? 0) :
                    Math.max(lastFiled, cited?.position ?? 0, 1);
                const bucket = rows[position - 1];
                if (!bucket) {
                    continue;
                }
                const block = evidence && cited?.blocks.find((part) => part.blockNumber === evidence.blockNumber);
                const source = block && cited.fingerprint === evidence.fingerprint && block.speaker === evidence.speaker &&
                    block.text.includes(evidence.quote) && (ScribeIntake.Originals.get(block) ?? block.text).includes(evidence.quote)
                    ? { messageId: cited.id, fingerprint: cited.fingerprint, position: cited.position,
                        blockNumber: block.blockNumber, speaker: block.speaker, quote: evidence.quote } : null;
                const { evidence: provenance, ...details } = operation;
                const row = { text: JSON.stringify(details), origin: entry.origin, position };
                const id = operation.fact ?? operation.thread ?? operation.question ?? operation.subject;
                if (typeof id === 'string') {
                    row.id = id;
                }
                if (source) {
                    row.source = source;
                    row.attribution = provenance.attribution;
                } else if (story && cited && !evidence) {
                    const candidates = ScribeLog.sourceClaims(cited, [operation])[0]?.candidates ?? [];
                    if (candidates.length === 1) {
                        row.source = { messageId: cited.id, position: cited.position, fingerprint: cited.fingerprint, ...candidates[0] };
                        row.reconstructed = true;
                    }
                }
                (story ? bucket.written : bucket.rulings).push(row);
                if (!story && [ScribeLog.Ruling.Answer, ScribeLog.Ruling.Dismiss].includes(operation.type)) {
                    const binding = legacy.get(JSON.stringify([operation.question, entry.sequence]));
                    if (binding) {
                        bucket.decisions.push({ decision: binding, sequence: entry.sequence, row });
                    }
                }
            }
        }
        return { rows, checks };
    },

    /**
     * @param {object} source
     * @param {object} message
     * @return {object|null}
     */
    passage(source, message) {
        if (!source || !message || message.attributionPending || source.messageId !== message.id) {
            return null;
        }
        const block = message.blocks.find((part) => part.blockNumber === source.blockNumber && part.speaker === source.speaker);
        if (!block || typeof source.quote !== 'string' || !source.quote.trim() ||
            !(ScribeIntake.Originals.get(block) ?? block.text).includes(source.quote)) {
            return null;
        }
        const start = block.text.indexOf(source.quote);
        if (start < 0) {
            return null;
        }
        const left = block.text.slice(0, start).split(/[.!?\n]/u).at(-1);
        const right = /[.!?\n]$/u.test(source.quote) ? '' : block.text.slice(start + source.quote.length).split(/[.!?\n]/u)[0];
        return { ...source, fingerprint: message.fingerprint, position: message.position, role: block.role,
            context: (left + source.quote + right).trim() };
    },

    /**
     * @param {object} source
     * @param {object} message
     * @return {boolean}
     */
    supportedPassage(source, message) {
        const current = ScribeLog.passage(source, message);
        return Boolean(current && source.context === current.context && source.role === current.role);
    },

    /**
     * @param {object|null} record
     * @return {object|null}
     */
    checkRecord(record) {
        for (const line of record?.text?.split('\n') ?? []) {
            if (!line.startsWith('{')) {
                continue;
            }
            let value;
            try {
                value = JSON.parse(line);
            } catch {
                continue;
            }
            if (value && typeof value.type === 'string') {
                return value;
            }
        }
        return null;
    },

    /**
     * @param {object} log
     * @param {Map} positions
     * @param {Map|null} fingerprints
     * @param {Map|null} messages
     * @return {object[]}
     */
    findingHistory(log, positions, fingerprints, messages) {
        const history = [];
        const latest = new Map();
        const operators = new Map();
        for (const entry of log.entries) {
            if (entry.kind === ScribeLog.Kind.Operator && !entry.withdrawn) {
                for (const operation of entry.operations) {
                    if (!operation.revoked && [ScribeLog.Ruling.Answer, ScribeLog.Ruling.Dismiss].includes(operation.type)) {
                        operators.set(operation.question, entry.sequence);
                    }
                }
            }
        }
        for (const entry of log.entries) {
            for (const alert of entry.withdrawn ? [] : entry.check?.challenges ?? []) {
                const previous = latest.get(alert.finding);
                if (previous?.sequence === alert.sequence && ScribeLog.challengesFinding(entry.check, alert, previous) && alert.support.every((source) =>
                    positions.has(source.messageId) && (messages ? ScribeLog.supportedPassage(source, messages.get(source.messageId))
                        : fingerprints?.get(source.messageId) === source.fingerprint))) {
                    previous.status = 'reopened';
                }
            }
            const decisions = entry.kind === ScribeLog.Kind.Operator && entry.checkerRuling ? [entry.checkerRuling] :
                entry.origin === ScribeLog.Origin.Checker ? entry.check?.legacyRulings ?? [] : [];
            for (const decision of entry.withdrawn ? [] : decisions) {
                if (!Array.isArray(decision.support) || (decision.legacy && operators.get(decision.legacyQuestion) !== decision.legacy)) {
                    continue;
                }
                const prior = latest.get(decision.finding);
                if (decision.legacy && prior) {
                    continue;
                }
                if (prior) {
                    prior.status = 'superseded';
                }
                const current = decision.support.every((source) => positions.has(source.messageId) && (messages
                    ? ScribeLog.supportedPassage(source, messages.get(source.messageId))
                    : fingerprints?.get(source.messageId) === source.fingerprint));
                const row = { ...decision, sequence: decision.legacy ?? entry.sequence, status: current
                    ? (decision.action === 'open' ? 'deferred' : 'settled') : 'reopened' };
                latest.set(decision.finding, row);
                history.push(row);
            }
        }
        return history;
    },

    /**
     * @param {object} receipt
     * @param {object} alert
     * @param {object} decision
     * @return {boolean}
     */
    challengesFinding(receipt, alert, decision) {
        const pages = receipt.pages;
        for (const page of pages) {
            for (const finding of page.findings) {
                const source = finding.source;
                if (source.messageId !== alert.support[0]?.messageId || source.blockNumber !== alert.support[0].blockNumber ||
                    source.quote !== alert.support[0].quote || (finding.earlier && (finding.earlier.messageId !== alert.support[1]?.messageId ||
                        finding.earlier.blockNumber !== alert.support[1].blockNumber || finding.earlier.quote !== alert.support[1].quote))) {
                    continue;
                }
                const claims = pages.flatMap((checked) => checked.claims).filter((claim) =>
                    claim.source.messageId === source.messageId && claim.source.blockNumber === source.blockNumber &&
                    claim.source.speaker === source.speaker && claim.source.quote === source.quote);
                if (ScribeLog.relatedFinding(decision, { ...finding, support: alert.support, accounts: { source: claims } })) {
                    return true;
                }
            }
        }
        return false;
    },

    /**
     * @param {object} row
     * @param {object[]} prior
     * @return {object|null}
     */
    legacyFinding(row, prior) {
        if (!['Question', 'Contradiction'].includes(row.kind)) {
            return null;
        }
        const wording = (value) => ' ' + ScribeReplay.wording(value) + ' ';
        const candidates = [];
        for (const { question, operation, sequence } of prior) {
            if (!row.support.some((source) => source.messageId === question.cite) ||
                operation.passages?.some((passage) => !row.support.some((source) =>
                    source.messageId === passage.id && source.fingerprint === passage.fingerprint))) {
                continue;
            }
            const exact = wording(question.text) === wording(row.question);
            const selected = Object.entries(row.accounts).filter(([, claims]) => claims.some((claim) => claim.value &&
                operation.text && wording(operation.text).includes(wording(claim.value)) &&
                (exact || claim.subject && claim.attribute && wording(question.text).includes(wording(claim.subject)) &&
                    wording(row.question).includes(wording(claim.subject)) &&
                    wording(question.text).includes(wording(claim.attribute)) && wording(row.question).includes(wording(claim.attribute)))));
            if (exact || selected.length === 1) {
                const account = selected.length === 1 ? selected[0][0] : null;
                candidates.push({ finding: row.id, version: row.version, kind: row.kind, question: row.question,
                    source: row.source, earlier: row.earlier, record: row.record, support: row.support,
                    legacy: sequence, legacyQuestion: question.id, sequence, action: account ? 'choose' : 'explain', account,
                    explanation: account ? null : operation.text ?? 'Dismissed by the operator.',
                    canonical: operation.text ?? null, claims: account ? row.accounts[account] : [],
                    pointClaims: row.accounts.source.map(({ subject, attribute }) => ({ subject, attribute })),
                    factIds: [], patches: [], additions: [], status: 'settled' });
            }
        }
        return candidates.length === 1 ? candidates[0] : null;
    },

    /**
     * @param {object} finding
     * @param {object[]} claims
     * @param {Map} messages
     * @return {object}
     */
    findingPoint(finding, claims, messages) {
        const accounts = {};
        const keyOf = (source) => [source.messageId, source.blockNumber, source.speaker, source.quote];
        const support = [];
        for (const side of ['source', 'earlier']) {
            const source = finding[side];
            if (!source) {
                continue;
            }
            const passage = ScribeLog.passage(source, messages.get(source.messageId));
            if (!passage) {
                continue;
            }
            support.push(passage);
            accounts[side] = claims.filter((claim) => claim.source.messageId === source.messageId &&
                claim.source.blockNumber === source.blockNumber && claim.source.speaker === source.speaker &&
                claim.source.quote === source.quote);
        }
        const record = ScribeLog.checkRecord(finding.record);
        if (record?.cite && !support.some((source) => source.messageId === record.cite)) {
            const original = messages.get(record.cite);
            if (original && !original.attributionPending) {
                const printed = finding.record.text.split('\n').find((line) => line.startsWith('Filed citation: '));
                let bound = null;
                if (printed) {
                    try {
                        bound = ScribeLog.passage(JSON.parse(printed.slice('Filed citation: '.length)), original);
                    } catch (error) {
                        if (!(error instanceof SyntaxError)) {
                            throw error;
                        }
                    }
                }
                if (bound) {
                    support.push(bound);
                } else {
                    for (const block of original.blocks) {
                        for (const piece of ScribeIntake.sourcePieces(block)) {
                            const context = ScribeLog.passage({ messageId: original.id, position: original.position,
                                fingerprint: original.fingerprint, blockNumber: block.blockNumber, speaker: block.speaker, quote: piece.quote }, original);
                            if (context) {
                                support.push(context);
                            }
                        }
                    }
                }
            }
        }
        const point = record?.fact ? ['fact', record.fact] : ['source', ...keyOf(finding.source)];
        const dispute = ScribeText.words(finding.question).join(' ');
        const identities = [finding.kind, dispute, point, ...support.map(keyOf), record?.fact ?? finding.record?.text ?? null];
        const id = ScribeText.fingerprint(JSON.stringify(identities));
        const version = ScribeText.fingerprint(JSON.stringify([id, support.map((source) => [source.role, source.context]),
            record ?? finding.record?.text ?? null, Object.values(accounts).map((group) => group.map((claim) =>
                [claim.attribution, claim.subject, claim.attribute, claim.value]))]));
        return { ...finding, id, version, accounts, support, status: 'open', actionable: true };
    },

    /**
     * @param {object} book
     * @param {object} state
     * @param {object[]} messages
     * @param {object} change
     * @return {object}
     */
    ruleFinding(book, state, messages, change, shareable = null) {
        const log = book.log;
        const progress = ScribeLog.checkProgress(book, messages);
        const row = progress.findings.find((finding) => finding.id === change?.finding);
        if (state.revision !== log.revision || !row?.actionable || row.version !== change.version || row.status === 'settled' ||
            row.status === 'deferred' && change.action === 'open') {
            throw new Error('This finding changed. Review the current evidence before ruling.');
        }
        const { action } = change;
        const account = change.account ?? null;
        const explanation = typeof change.explanation === 'string' ? change.explanation.trim() : null;
        if (!['choose', 'explain', 'open'].includes(action) || (action === 'choose'
            ? (!['source', 'earlier', 'record'].includes(account) || !row[account]) : account !== null) ||
            (action === 'explain' ? (!explanation || explanation.length > 3000) : explanation !== null)) {
            throw new Error('Choose an available account, explain the evidence in up to 3,000 characters, or leave it open.');
        }
        const record = ScribeLog.checkRecord(row.record);
        let claims = action === 'choose' ? (row.accounts[account] ?? []) : Object.values(row.accounts).flat();
        let canonical = action === 'choose' ? (account === 'record' ? record?.text ?? row.record.text : row[account].quote) : explanation;
        const patches = [];
        const factIds = [];
        const additions = [];
        const counters = { nextFact: log.nextFact };
        const named = (name) => state.subjects.filter((subject) => !subject.mergedInto && [subject.name, subject.label, ...subject.aka]
            .some((label) => ScribeCategory.same(label, name)));
        const matchesSource = (fact, claim) => claim.subject && claim.value && named(claim.subject).some((owner) => owner.id === fact.subject) &&
            (fact.cite === claim.source.messageId || fact.evidence?.messageId === claim.source.messageId) &&
            (ScribeCategory.same(fact.text, claim.value) || ScribeCategory.same(fact.text, claim.text) ||
                fact.evidence?.quote === claim.source.quote && fact.evidence?.value === claim.value) &&
            (claim.attribute === fact.category || fact.evidence?.attribute === claim.attribute);
        const mark = (fact) => ({ subject: fact.subject, category: fact.category, text: fact.text,
            cite: fact.cite, target: fact.target, targetText: fact.targetText, ...ScribeCategory.scope(fact) });
        const evidenceFor = (claim) => ({ ...claim.source, messageNumber: claim.source.position, subject: claim.subject,
            attribute: claim.attribute, value: claim.value, attribution: claim.attribution });
        if (action === 'choose' && record?.fact) {
            const fact = state.facts.find((item) => item.id === record.fact);
            if (!fact || (record.text && fact.text !== record.text) || (record.subject && fact.subject !== record.subject) ||
                (record.category && fact.category !== record.category) || (record.cite && fact.cite !== record.cite) ||
                (Object.hasOwn(record, 'target') && record.target !== fact.target) ||
                (Object.hasOwn(record, 'targetText') && record.targetText !== fact.targetText)) {
                throw new Error('The cited book entry has changed. Check its current wording and references.');
            }
            if (account === 'record') {
                factIds.push(fact.id);
            } else {
                const substantive = claims.filter((claim) => claim.subject && claim.value);
                const sameAttribute = substantive.filter((claim) => claim.attribute && (claim.attribute === fact.category ||
                    claim.attribute === fact.evidence?.attribute));
                const candidates = sameAttribute.length ? sameAttribute : substantive;
                const matched = candidates.filter((claim) => named(claim.subject).length === 1);
                if (matched.length !== 1 || candidates.some((claim) => claim.subject !== matched[0]?.subject)) {
                    throw new Error('The cited account must identify one book subject and its value before changing this entry.');
                }
                const claim = matched[0];
                const subject = named(claim.subject)[0].id;
                const fixed = ScribeLog.categoryKind(fact.category) === ScribeCategory.Kind.Fixed;
                const scope = ScribeCategory.scope({ category: fact.category, text: claim.source.quote });
                if (fixed && (claim.attribute !== fact.category || !ScribeCategory.sameScope(fact, { category: fact.category, ...scope }))) {
                    throw new Error('The cited account does not support this category, scope or relationship.');
                }
                let target = fact.target;
                let targetText = fact.targetText;
                if (fact.category === ScribeCategory.Settings.RelationCategory) {
                    const fold = (value) => value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
                    const quote = fold(claim.source.quote).replace(/[.!]$/u, '');
                    const owner = state.subjects.find((item) => item.id === subject);
                    const subjects = [owner.name, owner.label, ...owner.aka];
                    if (named(claim.source.speaker).some((speaker) => speaker.id === subject)) {
                        subjects.push('I');
                    }
                    const objects = state.subjects.filter((item) => !item.mergedInto && item.id !== subject)
                        .map((item) => ({ id: item.id, label: item.label, names: [item.name, item.label, ...item.aka] }));
                    if (target === null && targetText && !named(targetText).length) {
                        objects.push({ id: null, label: targetText, names: [targetText] });
                    }
                    const related = objects.filter((item) => claim.attribute && subjects.some((actor) => item.names.some((name) => {
                        const prefix = fold(actor + ' ' + claim.attribute) + ' ';
                        const object = fold(name);
                        const value = fold(claim.value);
                        return quote === prefix + object + ' ' + value || (object === value && quote === prefix + object) ||
                            ['to', 'from', 'with', 'for', 'toward', 'towards'].some((join) =>
                                quote === prefix + value + ' ' + join + ' ' + object || quote === prefix + join + ' ' + object + ' ' + value);
                    })));
                    if (related.length !== 1) {
                        throw new Error('The selected words must identify who acted and the single target of this relationship.');
                    }
                    target = related[0].id;
                    targetText = related[0].label;
                }
                canonical = claim.value;
                claims = [claim];
                const after = { subject, target, targetText, ...scope, text: claim.value, cite: claim.source.messageId, position: claim.source.position,
                    ruledAttribute: claim.attribute, evidence: evidenceFor(claim) };
                const other = account === 'source' ? 'earlier' : 'source';
                const movedCitation = row.kind === 'Citation' && fact.cite !== claim.source.messageId;
                const companion = movedCitation ? (row.accounts[other] ?? [])
                    .filter((item) => item.subject === claim.subject && item.value && item.source.messageId === fact.cite &&
                        fact.text.toLowerCase().includes(item.value.toLowerCase()) && !claim.text.includes(item.value)) : [];
                const clauses = movedCitation ? fact.text.trim().split(/\s+(?:and(?:\s+then)?|but|while|as well as|although)\s+|[;—]|\.(?=\s)|,\s+(?=\p{L})/iu)
                    .map((part) => part.trim()).filter(Boolean) : [];
                const fold = (value) => ScribeText.words(value).join(' ');
                const mentions = (text, words) => (' ' + fold(text) + ' ').includes(' ' + fold(words) + ' ');
                const oneValue = (part, item) => {
                    const values = [item.value];
                    if (item.attribute) {
                        values.push(item.value + ' ' + item.attribute);
                        for (const join of [' ', ' of ', ' is ', ' as ', ' as a ', ' as an ', ' as the ']) {
                            values.push(item.attribute + join + item.value);
                        }
                    }
                    return values.some((value) => fold(part) === fold(value));
                };
                if (movedCitation && clauses.length === 1) {
                    if (companion.length || !oneValue(fact.text, claim)) {
                        throw new Error('The whole book entry must match the selected claim before its citation can move. Review each part separately.');
                    }
                }
                if (clauses.length > 1) {
                    const unchanged = clauses.filter((part) => !mentions(part, claim.value));
                    if (clauses.length !== 2 || unchanged.length !== 1 ||
                        (companion.length && !companion.every((item) => oneValue(unchanged[0], item)))) {
                        throw new Error('This combined entry needs separate source support for each part before it can be split.');
                    }
                    const changed = clauses.find((part) => part !== unchanged[0]);
                    const transfer = /^(?:given|received) (?:an? |the )?(\p{L}[\p{L}\p{M}'’-]*) as (?:an? |the )?(.+)$/iu.exec(changed);
                    const completeTransfer = transfer && fold(transfer[2]) === fold(claim.value) &&
                        claim.source.quote.split(/[.!?\n]/u).some((sentence) => {
                            const plain = fold(sentence).split(' ').filter((word) => !['a', 'an', 'the'].includes(word)).join(' ');
                            const item = fold(transfer[1]);
                            const value = fold(claim.value);
                            const actor = claim.source.speaker === claim.subject && plain.startsWith('i ') ? 'i' : fold(claim.subject);
                            if (['received', 'was given'].some((verb) => plain === [actor, verb, item, 'as', value].join(' '))) {
                                return true;
                            }
                            return claim.attribute && fold(claim.attribute) === item &&
                                ['is', 'was'].some((verb) => (' ' + plain + ' ').includes(' ' + item + ' ' + verb + ' ' + value + ' '));
                        });
                    if (!oneValue(changed, claim) && !completeTransfer) {
                        throw new Error('The new source must support the entire part whose citation is being moved.');
                    }
                    if (companion.length === 0) {
                        const retained = unchanged[0];
                        const original = row.support.filter((source) => source.messageId === fact.cite && mentions(source.quote, retained));
                        const source = original.length === 1 ? original[0] : null;
                        const actor = source?.role === ScribeIntake.Role.Character && source.speaker === claim.subject ? 'I' : claim.subject;
                        const literal = source && ['', ' was', ' is', ' had', ' has'].some((verb) =>
                            fold(source.quote) === fold(actor + verb + ' ' + retained));
                        if (!literal || ![ScribeIntake.Role.Character, ScribeIntake.Role.Narrator].includes(source.role)) {
                            throw new Error('The earlier source must verify the retained part of this combined entry before changing its citation.');
                        }
                        companion.push({ source, text: source.quote, subject: claim.subject, attribute: null, value: retained,
                            attribution: source.role === ScribeIntake.Role.Character ? 'claimed' : 'witnessed' });
                    }
                }
                if (companion.length > 0) {
                    if (companion.length !== 1 || fact.category === ScribeCategory.Settings.RelationCategory || fixed ||
                        fact.subject !== subject) {
                        throw new Error('This combined entry needs separately cited accounts before it can be split.');
                    }
                    const kept = companion[0];
                    claims = [kept, claim];
                    patches.push({ id: fact.id, before: mark(fact), after: { subject, target: null, targetText: null, text: kept.value,
                        cite: kept.source.messageId, position: kept.source.position, ruledAttribute: kept.attribute, evidence: evidenceFor(kept) } });
                    const id = ScribeLog.nextFactId(counters);
                    additions.push({ ...after, type: ScribeLog.Ruling.AddFact, fact: id, category: fact.category,
                        target: null, targetText: null, hidden: fact.hidden });
                    factIds.push(id);
                } else {
                    patches.push({ id: fact.id, before: mark(fact), after });
                }
                factIds.push(fact.id);
            }
        } else if (action === 'choose' && account !== 'record') {
            const accepted = state.facts.filter((fact) => claims.some((claim) => matchesSource(fact, claim)));
            factIds.push(...accepted.map((fact) => fact.id));
            const other = account === 'source' ? 'earlier' : 'source';
            for (const fact of state.facts) {
                if (!factIds.includes(fact.id) && (row.accounts[other] ?? []).some((claim) => matchesSource(fact, claim)) &&
                    accepted.some((winner) => winner.subject === fact.subject && winner.category === fact.category &&
                        winner.target === fact.target && winner.targetText === fact.targetText && ScribeCategory.sameScope(winner, fact))) {
                    patches.push({ id: fact.id, before: mark(fact), after: null });
                }
            }
            if (row.kind === 'Omission' && !accepted.length && claims.length === 1) {
                const claim = claims[0];
                const category = claim.attribute && ScribeCategory.parse(claim.attribute);
                const owners = claim.subject && named(claim.subject);
                if (owners?.length === 1 && category && !category.target && claim.value && claim.attribution === 'witnessed') {
                    const id = ScribeLog.nextFactId(counters);
                    additions.push({ type: ScribeLog.Ruling.AddFact, fact: id, subject: owners[0].id,
                        category: category.category, target: null, targetText: null, ...ScribeCategory.scope({ category: category.category, text: claim.text }),
                        text: claim.value, hidden: true,
                        cite: claim.source.messageId, position: claim.source.position, ruledAttribute: claim.attribute, evidence: evidenceFor(claim) });
                    factIds.push(id);
                    canonical = claim.value;
                }
            }
        }
        const { id, version, kind, question, source, earlier, support } = row;
        if ((change.shareInReminder !== undefined && typeof change.shareInReminder !== 'boolean') ||
            (change.shareInReminder && (action === 'open' || !shareable?.(state, row, messages, canonical)))) {
            throw new Error('Only rulings supported by public evidence can be shared with everyone in the chat.');
        }
        const decision = { finding: id, version, kind, question, source, earlier: earlier ?? null, record: row.record ?? null,
            ...(change.shareInReminder ? { shareInReminder: true } : {}),
            support, action, account, explanation, claims, canonical, factIds, patches, additions,
            pointClaims: row.accounts.source.map(({ subject, attribute }) => ({ subject, attribute })),
            after: messages[progress.checkedThrough - 1].id };
        const entry = { sequence: log.nextSequence, kind: ScribeLog.Kind.Operator, origin: ScribeLog.Origin.Operator,
            messageIds: [], operations: [], checkerRuling: JSON.parse(JSON.stringify(decision)), withdrawn: false };
        if (factIds.length) {
            const preview = { ...log, entries: [...log.entries, entry] };
            const applied = ScribeReplay.run(preview, messages.map((message) => message.id), null,
                new Map(messages.map((message) => [message.id, message.fingerprint])), null, null, messages);
            const written = [...patches.filter((patch) => patch.after).map((patch) => ({ id: patch.id, ...patch.after })),
                ...additions.map((fact) => ({ id: fact.fact, ...fact }))];
            if (written.some((fact) => !applied.facts.some((result) => result.id === fact.id && result.subject === fact.subject &&
                result.target === fact.target && result.targetText === fact.targetText &&
                result.text === fact.text && result.cite === fact.cite && result.evidence?.value === fact.evidence.value &&
                result.evidence.attribution === fact.evidence.attribution))) {
                throw new Error('The book could not apply this account to its exact subject, value and source.');
            }
        }
        log.nextSequence++;
        log.nextFact = counters.nextFact;
        log.revision++;
        log.entries.push(entry);
        return entry;
    },

    /**
     * @param {object} page
     * @param {object} target
     * @param {readonly object[]} messages
     * @return {boolean}
     */
    validCheckPage(page, target, messages) {
        if (page?.complete !== true || typeof page.id !== 'string' || !page.id || !Number.isSafeInteger(page.total) ||
            !Number.isSafeInteger(page.index) || page.index < 0 || page.index >= page.total ||
            !Array.isArray(page.claims) || !Array.isArray(page.findings) ||
            typeof page.answer !== 'string' || !page.answer.trim()) {
            return false;
        }
        let answer;
        try {
            answer = JSON.parse(page.answer);
        } catch {
            return false;
        }
        if (answer?.complete !== true || answer.page !== page.id || !Array.isArray(answer.claims) || !Array.isArray(answer.findings)) {
            return false;
        }
        if (Object.keys(answer).some((key) => !['page', 'complete', 'claims', 'findings'].includes(key)) ||
            answer.claims.length !== page.claims.length) {
            return false;
        }
        const supported = (source, currentOnly) => {
            const original = messages[source?.position - 1];
            const block = original?.blocks.find((part) => part.blockNumber === source.blockNumber);
            return Boolean(block && original.position === source.position &&
                (currentOnly ? original.id === target.id : original.position <= target.position) &&
                original.id === source.messageId && original.fingerprint === source.fingerprint && block.speaker === source.speaker &&
                typeof source.quote === 'string' && source.quote.trim() && block.text.includes(source.quote) &&
                (ScribeIntake.Originals.get(block) ?? block.text).includes(source.quote));
        };
        return page.claims.every((claim, index) => {
            const raw = answer.claims[index];
            return claim && raw && supported(claim.source, true) && claim.text === claim.source.quote &&
                ['witnessed', 'claimed', 'inferred', 'promised'].includes(claim.attribution) && raw.attribution === claim.attribution &&
                raw.source?.quote === claim.source.quote && raw.source.ref === 'm' + claim.source.position + 'b' + claim.source.blockNumber &&
                ['subject', 'attribute', 'value'].every((key) => (raw[key] ?? null) === (claim[key] ?? null));
        }) &&
            page.findings.every((finding) => finding && supported(finding.source, true) &&
                ['Omission', 'Citation', 'Contradiction', 'Question'].includes(finding.kind) &&
                typeof finding.question === 'string' && finding.question.trim() &&
                (!finding.earlier || supported(finding.earlier, false)));
    },

    /**
     * @param {object} book
     * @param {readonly object[]} messages
     * @param {boolean} includeContext
     * @return {object}
     */
    checkWork(book, messages, includeContext = true) {
        const { rows, checks } = ScribeLog.checkIndex(book, messages);
        let version = 'checker-v1';
        let writtenThrough = 0;
        let checkedThrough = 0;
        let message = null;
        let completed = [];
        let segments = [];
        const earlierClaims = [];
        const rulings = new Set();
        const decisions = new Map();
        const challenged = new Map();
        let expired = [];
        const findings = new Map();
        const byId = new Map(messages.map((source) => [source.id, source]));
        const history = ScribeLog.findingHistory(book.log, byId, null, byId);
        const active = history.filter((row) => row.status !== 'superseded');
        const citedClaims = new Map();
        let legacy = null;
        for (const source of messages) {
            if (!Object.hasOwn(book.log.read, source.id) || source.attributionPending ||
                !source.fingerprint || book.fingerprints[source.id] !== source.fingerprint ||
                (book.projections?.[source.id] ?? null) !== (source.projection ?? null)) {
                break;
            }
            writtenThrough++;
            if (message) {
                continue;
            }
            const bucket = rows[source.position - 1];
            const identity = [version, source.id, source.fingerprint, source.projection ?? null,
                book.log.read[source.id], bucket.written, bucket.rulings];
            for (const row of bucket.rulings) {
                rulings.add(row);
            }
            const removed = [];
            for (const alert of expired) {
                challenged.set(alert.finding, alert.sequence);
                const old = decisions.get(alert.finding);
                if (old?.sequence === alert.sequence && rulings.delete(old.row)) {
                    removed.push(alert.sequence);
                }
            }
            expired = [];
            for (const choice of bucket.decisions) {
                const previous = decisions.get(choice.decision.finding);
                if (challenged.get(choice.decision.finding) === choice.sequence || previous && previous.sequence > choice.sequence) {
                    if (choice.row && rulings.delete(choice.row)) {
                        removed.push(choice.sequence);
                    }
                    continue;
                }
                if (previous && rulings.delete(previous.row)) {
                    removed.push(previous.sequence);
                }
                decisions.set(choice.decision.finding, choice);
            }
            if (removed.length) {
                identity.push(removed);
            }
            version = ScribeText.fingerprint(JSON.stringify(identity));
            const receipt = checks.get(JSON.stringify([source.id, version]));
            completed = [];
            segments = [];
            const pageIds = new Set();
            if (receipt?.fingerprint === source.fingerprint && Array.isArray(receipt.pages)) {
                for (const page of receipt.pages) {
                    if (!ScribeLog.validCheckPage(page, source, messages) || page.index !== completed.length ||
                        page.seal !== ScribeLog.checkSeal(page) ||
                        (completed.length && completed[0].total !== page.total) || pageIds.has(page.id)) {
                        break;
                    }
                    completed.push(page);
                    pageIds.add(page.id);
                }
            }
            if (completed.length !== completed[0]?.total) {
                if (receipt?.fingerprint === source.fingerprint && Array.isArray(receipt.segments)) {
                    for (const segment of receipt.segments) {
                        if (segment.parentIndex === completed.length && typeof segment.parentId === 'string' &&
                            Number.isSafeInteger(segment.planBytes) && segment.planBytes > 0 &&
                            !pageIds.has(segment.id) && segment.seal === ScribeLog.checkSeal(segment) &&
                            ScribeLog.validCheckPage(segment, source, messages)) {
                            segments.push(segment);
                            pageIds.add(segment.id);
                        }
                    }
                }
                message = source;
                continue;
            }
            for (const alert of receipt.challenges ?? []) {
                const previous = history.find((decision) => decision.finding === alert.finding && decision.sequence === alert.sequence);
                if (previous && ScribeLog.challengesFinding(receipt, alert, previous) &&
                    alert.support.every((reference) => ScribeLog.supportedPassage(reference, byId.get(reference.messageId)))) {
                    expired.push(alert);
                }
            }
            for (const page of completed) {
                for (const claim of page.claims) {
                    const id = claim.source.messageId;
                    if (!citedClaims.has(id)) {
                        citedClaims.set(id, new Map());
                    }
                    citedClaims.get(id).set(JSON.stringify(claim), claim);
                }
            }
            for (const page of completed) {
                for (const finding of page.findings) {
                    const claims = [...(citedClaims.get(finding.source.messageId)?.values() ?? []),
                        ...(finding.earlier && finding.earlier.messageId !== finding.source.messageId
                            ? citedClaims.get(finding.earlier.messageId)?.values() ?? [] : [])];
                    const row = ScribeLog.findingPoint(finding, claims, byId);
                    const related = active.filter((prior) => ScribeLog.relatedFinding(prior, row));
                    const linked = active.find((prior) => prior.finding === row.id) ?? (related.length === 1 ? related[0] : null);
                    if (linked) {
                        const same = linked.version === row.version;
                        row.id = linked.finding;
                        row.ruling = linked;
                        row.status = same ? linked.status : 'reopened';
                        if (same && linked.status === 'reopened') {
                            row.actionable = false;
                        }
                    } else {
                        if (legacy === null) {
                            const operations = new Map();
                            for (const entry of book.log.entries) {
                                if (entry.kind === ScribeLog.Kind.Operator && !entry.withdrawn) {
                                    for (const operation of entry.operations) {
                                        if (!operation.revoked && [ScribeLog.Ruling.Answer, ScribeLog.Ruling.Dismiss].includes(operation.type)) {
                                            operations.set(operation.question, { operation, sequence: entry.sequence });
                                        }
                                    }
                                }
                            }
                            legacy = [];
                            if (operations.size) {
                                const state = ScribeReplay.run(book.log, messages.map((item) => item.id), null,
                                    new Map(messages.map((item) => [item.id, item.fingerprint])), null, null, messages);
                                for (const question of state.questions) {
                                    const old = operations.get(question.id);
                                    if (old && (question.dismissed || question.answer !== null)) {
                                        legacy.push({ question, ...old });
                                    }
                                }
                            }
                        }
                        const established = ScribeLog.legacyFinding(row, legacy);
                        if (established) {
                            row.ruling = established;
                            row.status = 'settled';
                        }
                    }
                    findings.set(row.id, row);
                }
            }
            checkedThrough++;
            if (includeContext) {
                for (const block of source.blocks) {
                    for (const piece of ScribeIntake.sourcePieces(block)) {
                        earlierClaims.push({ messageId: source.id, fingerprint: source.fingerprint, position: source.position,
                            blockNumber: block.blockNumber, speaker: block.speaker, role: block.role,
                            offset: piece.offset, quote: piece.quote });
                    }
                }
                earlierClaims.push(...bucket.written);
                const independent = new Map();
                for (const page of completed) {
                    for (const claim of page.claims) {
                        independent.set(JSON.stringify(claim), claim);
                    }
                }
                earlierClaims.push(...independent.values());
            }
        }
        for (const prior of active) {
            if (!findings.has(prior.finding)) {
                findings.set(prior.finding, { id: prior.finding, version: prior.version, kind: prior.kind,
                    question: prior.question, source: prior.source, earlier: prior.earlier, record: prior.record,
                    status: prior.status, ruling: prior, actionable: false });
            }
        }
        return { checkedThrough, writtenThrough, message, version, written: message ? rows[message.position - 1].written : [],
            earlierClaims, rulings: includeContext ? [...rulings] : [], completed: message ? completed : [], segments, findings: [...findings.values()] };
    },

    /**
     * @param {object} prior
     * @param {object} row
     * @return {boolean}
     */
    relatedFinding(prior, row) {
        if (prior.kind !== row.kind) {
            return false;
        }
        const sameEvidence = prior.support.length === row.support.length && row.support.every((now, index) =>
            now.messageId === prior.support[index].messageId && now.blockNumber === prior.support[index].blockNumber &&
            now.quote === prior.support[index].quote);
        const sameQuestion = ScribeText.words(prior.question).join(' ') === ScribeText.words(row.question).join(' ');
        if (sameEvidence && !sameQuestion) {
            return false;
        }
        const oldRecord = ScribeLog.checkRecord(prior.record)?.fact;
        const newRecord = ScribeLog.checkRecord(row.record)?.fact;
        if (oldRecord && newRecord && oldRecord !== newRecord) {
            return false;
        }
        const known = (prior.pointClaims ?? prior.claims).filter((claim) => claim.subject && claim.attribute);
        const fresh = (row.accounts.source ?? []).filter((claim) => claim.subject && claim.attribute);
        const sameSubject = (old, next) => ScribeText.normaliseName(old.subject) === ScribeText.normaliseName(next.subject);
        if (known.length && fresh.length && !known.some((old) => fresh.some((next) => sameSubject(old, next)))) {
            return false;
        }
        if (sameQuestion && oldRecord && oldRecord === newRecord) {
            return true;
        }
        const shared = prior.support.some((before) => row.support.some((now) => before.messageId === now.messageId &&
            before.blockNumber === now.blockNumber && before.speaker === now.speaker && before.quote === now.quote));
        const sameSlot = row.support.length === prior.support.length && row.support.every((now, index) =>
            now.messageId === prior.support[index].messageId && now.blockNumber === prior.support[index].blockNumber);
        const mentions = (question, attribute) => (' ' + ScribeText.words(question).join(' ') + ' ')
            .includes(' ' + ScribeText.words(attribute).join(' ') + ' ');
        const matched = known.some((old) => fresh.some((claim) => claim.attribute === old.attribute && sameSubject(old, claim) &&
            (sameQuestion || mentions(prior.question, old.attribute) && mentions(row.question, old.attribute))));
        return (shared || sameSlot) && (matched || sameQuestion && (sameEvidence || !known.length || !fresh.length));
    },

    /**
     * @param {object} book
     * @param {readonly object[]} messages
     * @return {object}
     */
    checkProgress(book, messages) {
        const { checkedThrough, writtenThrough, findings } = ScribeLog.checkWork(book, messages, false);
        return { checkedThrough, writtenThrough, findings };
    },

    /**
     * @param {object} page
     * @return {string}
     */
    checkSeal(page) {
        const fields = [page.id, page.index, page.total, page.answer, page.claims, page.findings];
        if (page.planBytes !== undefined) {
            fields.push(page.planBytes, page.parentId ?? null, page.parentIndex ?? null);
        }
        if (page.verifyFrom !== undefined) {
            fields.push(page.verifyFrom);
        }
        return ScribeText.fingerprint(JSON.stringify(fields));
    },

    /**
     * @param {object} book
     * @param {readonly object[]} messages
     * @param {object} work
     * @param {object} page
     * @return {boolean}
     */
    saveCheck(book, messages, work, page) {
        const current = ScribeLog.checkWork(book, messages, false);
        const target = current.message;
        const segment = page?.parentId !== undefined;
        if (!target || target.id !== work.message?.id || target.fingerprint !== work.message.fingerprint ||
            current.version !== work.version || !ScribeLog.validCheckPage(page, target, messages) ||
            (segment ? page.parentIndex : page.index) !== current.completed.length ||
            (page.planBytes !== undefined && (!Number.isSafeInteger(page.planBytes) || page.planBytes < 1)) ||
            (segment && (typeof page.parentId !== 'string' || !page.parentId || !page.planBytes ||
                current.segments.some((item) => item.id === page.id || item.parentId !== page.parentId))) ||
            (!segment && current.completed.some((item) => item.id === page.id || item.total !== page.total))) {
            return false;
        }
        const log = book.log;
        const stored = JSON.parse(JSON.stringify(page));
        stored.seal = ScribeLog.checkSeal(stored);
        let existing = log.entries.findLast((entry) => entry.origin === ScribeLog.Origin.Checker && !entry.withdrawn &&
            entry.check?.messageId === target.id && entry.check.version === current.version);
        if (!existing) {
            existing = { sequence: log.nextSequence++, kind: ScribeLog.Kind.Update, origin: ScribeLog.Origin.Checker,
                messageIds: [], operations: [], withdrawn: false, check: { messageId: target.id,
                    fingerprint: target.fingerprint, version: current.version, pages: [] } };
            log.entries.push(existing);
        }
        if (segment) {
            existing.check.segments = [...current.segments, stored];
        } else {
            existing.check.pages = [...current.completed, stored];
            delete existing.check.segments;
            if (existing.check.pages.length === stored.total && book.log.entries.some((entry) => entry.kind === ScribeLog.Kind.Operator)) {
                const progress = ScribeLog.checkProgress(book, messages);
                existing.check.legacyRulings = progress.findings.filter((finding) => finding.ruling?.legacy &&
                    finding.status === 'settled' && finding.source.messageId === target.id).map((finding) => finding.ruling);
                existing.check.challenges = progress.findings.filter((finding) => finding.status === 'reopened' &&
                    finding.actionable && finding.ruling && finding.source.messageId === target.id &&
                    finding.version !== finding.ruling.version).map((finding) => ({ finding: finding.id,
                        sequence: finding.ruling.sequence, support: finding.support }));
            }
        }
        return true;
    },

    /**
     * @param {object} message
     * @param {readonly object[]} operations
     * @return {object[]}
     */
    sourceClaims(message, operations) {
        const claims = [];
        for (const operation of operations) {
            const evidence = operation.evidence;
            const text = operation.text ?? operation.summary ?? operation.how ?? operation.reason ??
                operation.marker ?? operation.said ?? operation.name ?? evidence?.value;
            if (typeof text !== 'string' || !text.trim()) {
                continue;
            }
            const quote = evidence?.quote ?? text;
            const blocks = message.blocks.filter((block) => (!evidence || (evidence.messageId === message.id &&
                evidence.fingerprint === message.fingerprint && evidence.blockNumber === block.blockNumber && evidence.speaker === block.speaker)) &&
                block.text.includes(quote) && (ScribeIntake.Originals.get(block) ?? block.text).includes(quote));
            const candidates = blocks.map((block) => ({ blockNumber: block.blockNumber, speaker: block.speaker,
                quote, ...(evidence ? { attribution: evidence.attribution } : {}) }));
            claims.push({ messageId: message.id, fingerprint: message.fingerprint, type: operation.type,
                subject: operation.label ?? evidence?.subject ?? null, attribute: operation.category ?? evidence?.attribute ?? null,
                text, candidates });
        }
        return claims;
    },

    /**
     * @param {object} book
     * @param {readonly object[]} messages
     * @param {readonly string[]} gone
     * @param {readonly object[]} previous
     * @param {boolean} previousComplete
     * @return {Set<string>}
     */
    invalidated(book, messages, gone, previous = [], previousComplete = true) {
        const read = book.log.read;
        const removed = new Set(gone);
        const targets = new Set(gone.filter((id) => Object.hasOwn(read, id)));
        const current = new Map(messages.map((message, index) => [message.id, index]));
        const savedOrder = new Map();
        const priorOrder = new Map(previous.map((message, index) => [message.id, index + 1]));
        let first = messages.length;
        for (const entry of book.log.entries) {
            if (entry.withdrawn || entry.origin !== ScribeLog.Origin.Story) {
                continue;
            }
            const ids = entry.messageIds;
            const anchor = entry.operations.find((operation) => operation.cite && Number.isSafeInteger(operation.position) &&
                ids.includes(operation.cite));
            const start = anchor ? anchor.position - ids.indexOf(anchor.cite) : null;
            let lastIndex = -1;
            let lastEntryIndex = -1;
            let deleted = false;
            for (const [index, id] of ids.entries()) {
                if (read[id] !== entry.sequence) {
                    continue;
                }
                const position = entry.sources?.[index]?.position ?? (start === null ? null : start + index);
                if (position !== null) {
                    savedOrder.set(id, position);
                }
                const now = current.get(id);
                if (now !== undefined) {
                    if (deleted || now < lastIndex) {
                        first = Math.min(first, now);
                    } else if (lastIndex >= 0 && now - lastIndex > index - lastEntryIndex) {
                        first = Math.min(first, lastIndex + 1);
                    }
                    lastIndex = now;
                    lastEntryIndex = index;
                } else if (removed.has(id)) {
                    deleted = true;
                    if (lastIndex >= 0 && index === lastEntryIndex + 1) {
                        first = Math.min(first, lastIndex + 1);
                    }
                }
            }
        }
        for (const order of [savedOrder, priorOrder]) {
            let firstDeleted = Infinity;
            for (const id of removed) {
                firstDeleted = Math.min(firstDeleted, order.get(id) ?? Infinity);
            }
            let earliestLaterPosition = Infinity;
            let laterIndex = messages.length;
            for (let index = messages.length - 1; index >= 0; index--) {
                const position = order.get(messages[index].id);
                if (position === undefined) {
                    continue;
                }
                if (position > firstDeleted || position > earliestLaterPosition) {
                    first = Math.min(first, index);
                } else if (laterIndex < messages.length && laterIndex - index > earliestLaterPosition - position) {
                    first = Math.min(first, index + 1);
                }
                laterIndex = index;
                earliestLaterPosition = Math.min(earliestLaterPosition, position);
            }
            if (laterIndex < messages.length && laterIndex + 1 > earliestLaterPosition) {
                if (order === savedOrder) {
                    first = 0;
                } else if (previousComplete) {
                    const novel = messages.slice(0, laterIndex).findIndex((message) => !Object.hasOwn(read, message.id));
                    if (novel !== -1) {
                        first = Math.min(first, novel);
                    }
                }
            }
        }
        for (const [index, message] of messages.entries()) {
            const id = message.id;
            if (Object.hasOwn(read, id) && (message.attributionPending || book.fingerprints[id] !== message.fingerprint ||
                (book.projections?.[id] ?? null) !== (message.projection ?? null))) {
                first = Math.min(first, index);
            }
            if (index >= first && Object.hasOwn(read, id)) {
                targets.add(id);
            }
        }
        return targets;
    },

    /**
     * @param {object} log
     * @param {Set<string>} ids
     * @return {Set<string>}
     */
    withdrawSources(log, ids) {
        const freed = new Set();
        for (const entry of log.entries) {
            if (entry.withdrawn || entry.origin !== ScribeLog.Origin.Story) {
                continue;
            }
            const active = entry.messageIds.filter((id) => log.read[id] === entry.sequence);
            const retired = active.filter((id) => ids.has(id));
            if (!retired.length) {
                continue;
            }
            for (const id of retired) {
                freed.add(id);
                delete log.read[id];
            }
            if (retired.length === active.length) {
                entry.withdrawn = true;
            } else {
                entry.retired = [...(entry.retired ?? []), ...retired];
            }
            log.revision++;
        }
        return freed;
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
            if (story && !entry.withdrawn && log.read[messageId] === entry.sequence && entry.messageIds.includes(messageId)) {
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
            if (entry.sequence === sequence && entry.origin === ScribeLog.Origin.Notes && !entry.withdrawn) {
                const linked = entry.operations.filter((operation) => operation.resolutions?.length && !operation.revoked);
                if (!linked.length) {
                    return null;
                }
                for (const operation of linked) {
                    operation.revoked = true;
                }
                log.revision++;
                return entry;
            }
            if (entry.sequence === sequence && entry.kind === ScribeLog.Kind.Operator && !entry.withdrawn) {
                entry.withdrawn = true;
                if (entry.operations.some((operation) => operation.type === ScribeLog.Ruling.EditFact)) {
                    ScribeLog.noteEdit(log);
                }
                log.revision++;
                return entry;
            }
        }
        return null;
    },
});
