const ScribeLog = Object.freeze({
    CheckerPlanVersion: 4,

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
        const holders = context.names.get(written) ?? [];
        if (written && !holders.includes(subject)) {
            context.names.set(written, [...holders, subject]);
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
        const holders = context.labels.get(label) ?? [];
        if (label && !holders.includes(subject)) {
            context.labels.set(label, [...holders, subject]);
        }
        ScribeLog.index(context, name, subject);
    },

    /**
     * @param {object} context
     * @param {string} written
     * @return {Readonly<{ subject: string|null, ambiguous: boolean }>}
     */
    find(context, written) {
        const holders = context.labels.get(written) ?? context.names.get(written) ?? [];
        return Object.freeze({
            subject: holders.length === 1 ? holders[0] : null,
            ambiguous: holders.length > 1,
        });
    },

    /**
     * @param {object} context
     * @param {string} written
     * @param {string} subject
     * @return {boolean}
     */
    owns(context, written, subject) {
        return (context.labels.get(written) ?? context.names.get(written) ?? []).includes(subject);
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
        return JSON.stringify([subject, name.toLowerCase()]);
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
            const ids = context.labels.get(operation.label) ?? [];
            const subject = ids.find((id) => context.subjects.get(id)?.kind === operation.kind) ??
                ids.find((id) => context.subjects.get(id)?.assumed);
            if (subject === undefined) {
                outcome.draft = ScribeLog.make(context, operation.label, operation.kind);
                return null;
            }
            const known = context.subjects.get(subject);
            if (known.assumed) {
                known.kind = operation.kind;
                known.assumed = false;
                outcome.draft = {
                    type: ScribeAnswer.Type.Subject,
                    subject,
                    label: known.label,
                    kind: operation.kind,
                };
                return null;
            }
            if (operation.evidence) {
                outcome.draft = { type: operation.type, subject, label: known.label, kind: known.kind };
            }
            return null;
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

            const declared = ScribeLog.fits(context, operation, named) ? null : {
                label: operation.label, category: operation.category, target: operation.target, ...ScribeCategory.scope(operation),
            };
            let other = null;
            if (named.category === ScribeLog.Settings.AkaCategory) {
                const found = ScribeLog.find(context, operation.text).subject;
                other = found === named.subject ? null : found;
                ScribeLog.index(context, operation.text, named.subject);
            }
            const selectedSubject = ScribeLog.reach(context, operation.label, outcome.subjects) ?? named.subject;
            outcome.draft = {
                type: operation.type,
                ...(declared ? { declared } : {}),
                ...(selectedSubject !== named.subject ? { changedSubject: true } : {}),
                fact: operation.fact,
                becomes: null,
                subject: selectedSubject,
                label: operation.label,
                category: operation.category,
                ...ScribeCategory.scope(named),
                ...ScribeCategory.scope(operation),
                target: operation.target ? ScribeLog.find(context, operation.target).subject : null,
                targetText: operation.target,
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

            const declared = ScribeLog.fits(context, operation, named) ? null : {
                label: operation.label, category: operation.category, target: operation.target, ...ScribeCategory.scope(operation),
            };
            outcome.draft = {
                type: ScribeAnswer.Type.End,
                ...(declared ? { declared } : {}),
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

            const owned = ScribeLog.owns(context, operation.owner, named.subject);
            const subject = ScribeLog.reach(context, operation.label, outcome.subjects);
            if (subject === null) {
                return reasons.Ambiguous;
            }
            outcome.checks.push({ written: operation.label, subject });
            outcome.draft = {
                type: ScribeAnswer.Type.Told,
                ...(!owned ? { declared: { owner: operation.owner, label: operation.label } } : {}),
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
            const prior = context.sources.get(operation.first);
            const recorded = prior && context.story && operation.first < context.earliest && prior.text &&
                !prior.attributionPending && Object.hasOwn(context.read, prior.id);
            const first = context.cites.get(operation.first) ?? (recorded ? prior.id :
                reachesBack && (!context.story || !prior) ? context.before.first : undefined);
            const last = context.cites.get(operation.last);
            if (first === undefined || last === undefined) {
                return reasons.Citation;
            }
            for (const attendee of operation.present) {
                for (const position of [attendee.from, attendee.until]) {
                    const source = context.sources.get(position);
                    if (source?.attributionPending || (context.story && source?.text === ScribeLog.Settings.Nothing)) {
                        return reasons.Citation;
                    }
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
            const used = context.starts.get(first) ?? new Set();
            const existing = context.scenes.filter((scene) => scene.first === first && !used.has(scene.id));
            const matches = existing.filter((scene) => scene.day === operation.day && scene.place === operation.place);
            let sceneId = matches.length === 1 ? matches[0].id : used.size === 0 && existing.length === 1 ? existing[0].id : null;
            if (!sceneId) {
                sceneId = used.size || existing.length ? JSON.stringify([first, context.sequence, used.size]) : first;
            }
            used.add(sceneId);
            context.starts.set(first, used);
            outcome.draft = {
                type: ScribeAnswer.Type.Scene,
                ...(sceneId === first ? {} : { sceneId }),
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
            if (draft.targetText !== null) {
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
            if (text === fact.text) {
                return null;
            }
            const source = view.state.editOrigins?.[fact.id] ?? { fact: fact.id, cite: fact.cite,
                subject: fact.subject, category: fact.category, target: fact.target, targetText: fact.targetText,
                ...ScribeCategory.scope(fact), book: fact.text, sourcePrint: null };
            outcome.stored = { type: operation.type, fact: fact.id, before: fact.text, text, ...scope, source: { ...source } };
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
            const valid =
                typeof subject === 'string' &&
                typeof category === 'string' && Boolean(ScribeCategory.parse(category)) &&
                (relation ? typeof target === 'string' : target === null) &&
                ScribeLog.worded(text) &&
                typeof hidden === 'boolean' &&
                (cite === null || typeof cite === 'string') &&
                Number.isSafeInteger(position) &&
                position >= ScribeLog.Settings.LeastPosition;
            if (!valid) {
                return ScribeLog.Settings.InvalidOperation;
            }
            const aimed = relation ? view.subjects.get(target) : undefined;
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
            const key = name.toLowerCase();
            const held = view.state.aliases.some(
                /**
                 * @param {{ subject: string, name: string }} item
                 * @return {boolean}
                 */
                (item) => item.subject === owner && item.name.toLowerCase() === key,
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
        let context = null;
        let results = [];
        let unsettled = true;
        while (unsettled) {
            context = {
                cites,
                sources,
                story,
                before,
                earliest,
                read: log.read,
                unaliased,
                distinct,
                starts: new Map(),
                scenes: state.scenes,
                sequence: log.nextSequence,
                facts: new Map(),
                threads: new Set(),
                labels: new Map(),
                names: new Map(),
                subjects: new Map(),
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
            unsettled = refusedAtEnd;
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
                outcome.draft.evidence = outcome.draft.declared ? { ...operation.evidence, declared: outcome.draft.declared } : operation.evidence;
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
     * @param {object} entry
     * @return {string|null}
     */
    modelReading(entry) {
        if (!entry || entry.withdrawn || ![ScribeLog.Origin.Story, ScribeLog.Origin.Notes, ScribeLog.Origin.Answers].includes(entry.origin)) {
            return null;
        }
        if (typeof entry.modelReading === 'string') {
            return entry.modelReading;
        }
        if (entry.modelResponse && (entry.unfiledRows?.length || entry.proposals?.length)) {
            return entry.modelResponse;
        }
        const rows = entry.unfiledRows;
        if (entry.operations.length || entry.proposals?.length || !rows?.length ||
            !rows.every((row) => !row.resolvedBy && row.block === ScribeAnswer.Settings.Preamble && typeof row.line === 'string')) {
            return null;
        }
        return rows.map((row) => row.line).join('\n');
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
        const filedClaims = new Map();
        const subjectNames = new Map();
        const legacy = new Map();
        const legacyRecords = ScribeLog.legacyRecords(book.log);
        for (const entry of book.log.entries) {
            for (const binding of entry.withdrawn ? [] : entry.check?.legacyRulings ?? []) {
                if (ScribeLog.validLegacy(binding, legacyRecords)) {
                    legacy.set(JSON.stringify([binding.legacyQuestion, binding.legacy]), binding);
                }
            }
        }
        let lastFiled = 0;
        for (const entry of book.log.entries) {
            if (!entry.withdrawn && entry.operatorText) {
                const position = byId.get(entry.after)?.position ?? 0;
                const bucket = rows[position];
                if (bucket) {
                    bucket.rulings.push({ origin: ScribeLog.Origin.Operator, position, text: entry.operatorText });
                }
            }
            if (entry.checkerRuling) {
                const decision = entry.checkerRuling;
                const next = byId.get(decision.after)?.position;
                if (!entry.withdrawn && next && rows[next]) {
                    const current = decision.support.every((source) => ScribeLog.supportedPassage(source, byId.get(source.messageId))) &&
                        ScribeLog.currentReportedSources(decision, (source) => byId.get(source.messageId)?.fingerprint === source.fingerprint);
                    const row = { origin: ScribeLog.Origin.Operator, position: next,
                        text: JSON.stringify({ finding: decision.finding, sequence: entry.sequence, question: decision.question, decision: decision.canonical,
                            accounts: current ? decision.claims : [], action: decision.action, ...(current ? {} : { sourceStale: true }) }) };
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
            const response = story ? ScribeLog.modelReading(entry) : entry.modelResponse ?? ScribeLog.modelReading(entry);
            const responseAt = story ? end : Math.max(0, ...(entry.responseSources ?? []).map((source) => {
                const message = byId.get(source.id);
                return message?.fingerprint === source.fingerprint ? message.position : 0;
            }));
            if (response && responseAt && (!story || entry.messageIds.every((id) => book.log.read[id] === entry.sequence))) {
                rows[responseAt - 1].written.push({ position: responseAt, origin: entry.origin, filing: 'model reading', text: response });
            }
            for (const item of story ? entry.unfiledRows ?? [] : []) {
                const id = item.reviewAt ?? entry.messageIds.at(-1);
                const position = byId.get(id)?.position;
                if (!item.resolvedBy && position && book.log.read[id] === entry.sequence) {
                    rows[position - 1].written.push({ position, origin: entry.origin, filing: 'unfiled model answer',
                        section: item.block, reason: item.reason, text: item.line });
                }
            }
            for (const proposal of entry.proposals ?? []) {
                const id = proposal.operation.evidence?.messageId ?? proposal.sourceId;
                const position = byId.get(id)?.position;
                if (!proposal.resolvedBy && position && book.log.read[id] === entry.sequence) {
                    rows[position - 1].written.push({ position, origin: entry.origin, filing: 'unfiled proposal',
                        reason: proposal.reason, text: JSON.stringify(proposal.operation) });
                }
            }
            for (const operation of entry.operations) {
                if (operation.revoked || operation.type === ScribeAnswer.Type.Contradiction) {
                    continue;
                }
                if (operation.type === ScribeAnswer.Type.Subject) {
                    subjectNames.set(operation.subject, operation.label);
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
                const source = block && evidence.verified !== false && cited.fingerprint === evidence.fingerprint && block.speaker === evidence.speaker &&
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
                } else if (evidence?.verified === false) {
                    row.modelCitation = { issue: evidence.issue, attribution: evidence.attribution, quote: evidence.modelQuote,
                        message: evidence.citedMessage, block: evidence.citedBlock, original: block ?
                            { speaker: block.speaker, pieces: ScribeIntake.sourcePieces(block) } : null };
                } else if (story && evidence) {
                    row.proposedCitation = { messageId: citedId, blockNumber: evidence.blockNumber, quote: evidence.quote, verified: false };
                    row.attribution = evidence.attribution;
                } else if (story && cited && !evidence) {
                    const candidates = ScribeLog.sourceClaims(cited, [operation])[0]?.candidates ?? [];
                    if (candidates.length === 1) {
                        row.source = { messageId: cited.id, position: cited.position, fingerprint: cited.fingerprint, ...candidates[0] };
                        row.reconstructed = true;
                    }
                }
                if (story && row.source && operation.type === ScribeAnswer.Type.Fact) {
                    const claim = { source: row.source, text: row.source.quote, subject: subjectNames.get(operation.subject),
                        attribute: operation.category, value: operation.text, attribution: row.attribution ?? null };
                    if (claim.subject && claim.value && (' ' + ScribeText.words(row.source.quote).join(' ') + ' ')
                        .includes(' ' + ScribeText.words(claim.value).join(' ') + ' ')) {
                        if (!filedClaims.has(cited.id)) {
                            filedClaims.set(cited.id, new Map());
                        }
                        filedClaims.get(cited.id).set(JSON.stringify(claim), claim);
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
        return { rows, checks, filedClaims, subjectNames };
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
        if (!block || source.verified === false || typeof source.quote !== 'string' || !source.quote.trim() ||
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
     * @param {object} decision
     * @param {Function} matches
     * @return {boolean}
     */
    currentReportedSources(decision, matches) {
        return [decision.source, decision.earlier].every((source) => source?.verified !== false || matches(source));
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
        const legacyRecords = ScribeLog.legacyRecords(log);
        for (const entry of log.entries) {
            const decisions = entry.kind === ScribeLog.Kind.Operator && entry.checkerRuling ? [entry.checkerRuling] :
                entry.origin === ScribeLog.Origin.Checker ? entry.check?.legacyRulings ?? [] : [];
            for (const decision of entry.withdrawn ? [] : decisions) {
                if (!Array.isArray(decision.support) || (decision.legacy && !ScribeLog.validLegacy(decision, legacyRecords))) {
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
                    : fingerprints?.get(source.messageId) === source.fingerprint)) &&
                    ScribeLog.currentReportedSources(decision, (source) => positions.has(source.messageId) &&
                        ((!messages && !fingerprints) || (messages ? messages.get(source.messageId)?.fingerprint :
                            fingerprints.get(source.messageId)) === source.fingerprint));
                const row = { ...decision, ...(decision.legacy ? { action: 'explain', account: null,
                    explanation: decision.canonical ?? 'Dismissed by the operator.', claims: [], factIds: [], patches: [], additions: [] } : {}),
                    sequence: decision.legacy ?? entry.sequence,
                    status: decision.action === 'open' ? 'deferred' : 'settled',
                    ...(!current ? { sourceStale: true, shareInReminder: false } : {}) };
                latest.set(decision.finding, row);
                history.push(row);
            }
        }
        return history;
    },

    /**
     * @param {object} log
     * @return {object}
     */
    legacyRecords(log) {
        const originals = new Map();
        const operators = new Map();
        for (const entry of log.entries) {
            if (entry.withdrawn) {
                continue;
            }
            for (const operation of entry.operations) {
                if (operation.revoked || entry.retired?.includes(operation.cite)) {
                    continue;
                }
                if (operation.type === ScribeAnswer.Type.Question) {
                    originals.set(operation.question, operation);
                } else if (entry.kind === ScribeLog.Kind.Operator && [ScribeLog.Ruling.Answer, ScribeLog.Ruling.Dismiss].includes(operation.type)) {
                    operators.set(operation.question, { operation, sequence: entry.sequence });
                }
            }
        }
        return { originals, operators };
    },

    /**
     * @param {object} decision
     * @param {object} records
     * @return {boolean}
     */
    validLegacy(decision, { originals, operators }) {
        const question = originals.get(decision.legacyQuestion);
        const chosen = operators.get(decision.legacyQuestion);
        return !!question && Array.isArray(decision.support) && chosen?.sequence === decision.legacy && decision.question === question.text &&
            decision.source?.messageId === question.cite &&
            (chosen.operation.passages ?? []).every((passage) => decision.support.some((source) =>
                source.messageId === passage.id && source.fingerprint === passage.fingerprint)) &&
            (chosen.operation.text ?? null) === decision.canonical;
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
        const candidates = [];
        for (const { question, operation, sequence } of prior) {
            if (row.source.messageId !== question.cite ||
                operation.passages?.some((passage) => !row.support.some((source) =>
                    source.messageId === passage.id && source.fingerprint === passage.fingerprint))) {
                continue;
            }
            if (question.text === row.question) {
                candidates.push({ finding: row.id, version: row.version, kind: row.kind, question: row.question,
                    source: row.source, earlier: row.earlier, record: row.record, support: row.support,
                    legacy: sequence, legacyQuestion: question.id, sequence, action: 'explain', account: null,
                    explanation: operation.text ?? 'Dismissed by the operator.', canonical: operation.text ?? null, claims: [],
                    pointClaims: [], factIds: [], patches: [], additions: [], status: 'settled' });
            }
        }
        return candidates.length === 1 ? candidates[0] : null;
    },

    /**
     * @param {string} field
     * @return {string}
     */
    claimAttribute(field) {
        const name = typeof field === 'string' ? ScribeText.words(field).join(' ') : '';
        return name === 'eye color' ? 'eyes' : name;
    },

    /**
     * @param {object} left
     * @param {object} right
     * @param {object} source
     * @param {object} opposing
     * @param {string} question
     * @return {boolean}
     */
    competingClaims(left, right, source, opposing, question) {
        const words = (value) => ' ' + ScribeText.words(value).join(' ') + ' ';
        const grounded = (claim, passage) => {
            if (![claim.subject, claim.attribute, claim.value].every((field) => typeof field === 'string' && ScribeText.words(field).length)) {
                return false;
            }
            return words(passage.quote).includes(words(claim.value)) &&
                (words(passage.context ?? passage.quote).includes(words(claim.subject)) || passage.role !== ScribeIntake.Role.Narrator &&
                    ScribeCategory.same(claim.subject, passage.speaker ?? ''));
        };
        if (ScribeLog.claimAttribute(left.attribute ?? '') !== ScribeLog.claimAttribute(right.attribute ?? '') ||
            !grounded(left, source) || !grounded(right, opposing) || !ScribeCategory.same(left.target ?? '', right.target ?? '')) {
            return false;
        }
        const lhs = words(source.quote);
        const rhs = words(opposing.quote);
        if (!ScribeCategory.same(left.subject, right.subject)) {
            return Boolean(left.target && lhs.includes(words(left.target)) && rhs.includes(words(right.target)));
        }
        if (ScribeCategory.same(left.value, right.value)) {
            return false;
        }
        const sameFrame = lhs.replace(words(left.value), ' [] ') === rhs.replace(words(right.value), ' [] ');
        const property = [left.attribute, right.attribute].find((key) =>
            words(source.context ?? source.quote).includes(words(key)) && words(opposing.context ?? opposing.quote).includes(words(key)));
        const issue = words(question);
        const namesAlternatives = [left.attribute, left.value, right.value].every((field) => issue.includes(words(field)));
        if (!property && !sameFrame && !namesAlternatives) {
            return false;
        }
        const normalized = (claim) => {
            const point = property ?? left.attribute;
            const value = words(claim.value);
            const key = words(point);
            const text = value.endsWith(key) ? value.slice(0, -key.length).trim() : claim.value;
            return ScribeCategory.value({ category: 'build', dimension: point, text: text || claim.value });
        };
        return normalized(left) !== normalized(right);
    },

    /**
     * @param {object} finding
     * @param {Map} citedClaims
     * @param {Map} messages
     * @param {Set} rulings
     * @param {Map} filedClaims
     * @param {Map} subjectNames
     * @return {object}
     */
    findingPoint(finding, citedClaims, messages, rulings, filedClaims, subjectNames) {
        const bookIssue = ['Omission', 'Citation'].includes(finding.kind);
        const accounts = {};
        const keyOf = (source) => [source.messageId, source.blockNumber, source.speaker, source.quote];
        const support = [];
        const verified = {};
        const boundClaims = (source, index) => [...(index.get(source.messageId)?.values() ?? [])].filter((claim) =>
            claim.source.blockNumber === source.blockNumber && claim.source.speaker === source.speaker && (claim.source.quote === source.quote ||
                claim.source.verified !== false && claim.source.quote && source.quote && claim.value &&
                (' ' + ScribeText.words(source.quote).join(' ') + ' ').includes(' ' + ScribeText.words(claim.value).join(' ') + ' ') &&
                (claim.source.quote.includes(source.quote) || source.quote.includes(claim.source.quote)) &&
                ScribeLog.passage(claim.source, messages.get(source.messageId))));
        const claimsAt = (source) => {
            const checked = boundClaims(source, citedClaims);
            return checked.length || bookIssue ? checked : boundClaims(source, filedClaims);
        };
        for (const side of ['source', 'earlier']) {
            const source = finding[side];
            if (!source) {
                continue;
            }
            accounts[side] = claimsAt(source);
            const passage = ScribeLog.passage(source, messages.get(source.messageId));
            if (!passage) {
                continue;
            }
            support.push(passage);
            verified[side] = passage;
        }
        const record = ScribeLog.checkRecord(finding.record);
        const identitySupport = [...support];
        const printed = finding.record?.text.split('\n').find((line) => line.startsWith('Filed citation: '));
        let citation = record?.evidence;
        if (printed) {
            try {
                citation = JSON.parse(printed.slice('Filed citation: '.length));
            } catch (error) {
                if (!(error instanceof SyntaxError)) {
                    throw error;
                }
            }
        }
        const filed = (!record?.cite || citation?.messageId === record.cite) ?
            ScribeLog.passage(citation, messages.get(citation?.messageId)) : null;
        if (filed && !support.some((source) => source.messageId === filed.messageId && source.blockNumber === filed.blockNumber &&
            source.speaker === filed.speaker && source.quote === filed.quote)) {
            support.push(filed);
        }
        if (record?.cite) {
            const original = messages.get(record.cite);
            if (original && !original.attributionPending && !identitySupport.some((source) => source.messageId === record.cite)) {
                if (printed && filed) {
                    identitySupport.push(filed);
                } else {
                    for (const block of original.blocks) {
                        for (const piece of ScribeIntake.sourcePieces(block)) {
                            const context = ScribeLog.passage({ messageId: original.id, position: original.position,
                                fingerprint: original.fingerprint, blockNumber: block.blockNumber, speaker: block.speaker, quote: piece.quote }, original);
                            if (context) {
                                identitySupport.push(context);
                            }
                        }
                    }
                }
            }
        }
        const point = record?.fact ? ['fact', record.fact] : ['source', ...keyOf(finding.source)];
        const identities = [finding.kind, finding.question, point, ...identitySupport.map(keyOf), record?.fact ?? finding.record?.text ?? null];
        const id = ScribeText.fingerprint(JSON.stringify(identities));
        const priorId = ScribeText.fingerprint(JSON.stringify([finding.kind, ScribeText.words(finding.question).join(' '), ...identities.slice(2)]));
        const version = ScribeText.fingerprint(JSON.stringify([id, support.map((source) => [source.role, source.context]),
            record ?? finding.record?.text ?? null, Object.values(accounts).map((group) => group.map((claim) =>
                [claim.attribution, claim.subject, claim.attribute, claim.value, ...(claim.target ? [claim.target] : [])]))]));
        const comparisons = [];
        const compare = (left, right, candidate, account) => {
            if (!ScribeLog.competingClaims(left, right, verified.source, candidate, finding.question)) {
                return false;
            }
            const holders = !ScribeCategory.same(left.subject, right.subject);
            const subject = holders ? left.target : left.subject;
            const value = holders ? left.subject : left.value;
            const other = holders ? right.subject : right.value;
            const words = (phrase) => ' ' + ScribeText.words(phrase).join(' ') + ' ';
            const property = [left.attribute, right.attribute].find((field) =>
                words(verified.source.context).includes(words(field)) && words(candidate.context ?? candidate.quote).includes(words(field)));
            const question = 'Which account should the book keep for ' + subject + (property ? ' (' + property + ')' : '') +
                ', “' + value + '” or “' + other + '”?';
            const score = [subject, property, value, other].filter((field) => field && words(finding.question).includes(words(field))).length;
            comparisons.push({ account, question, score, left, right, candidate });
            return true;
        };
        const independent = (candidate, account) => {
            const target = verified.source;
            if (!target || !candidate) {
                return false;
            }
            if (target.messageId === candidate.messageId && target.blockNumber === candidate.blockNumber) {
                const block = messages.get(target.messageId).blocks.find((part) => part.blockNumber === target.blockNumber);
                const left = block.text.indexOf(target.quote);
                const right = block.text.indexOf(candidate.quote);
                if (left + target.quote.length > right && right + candidate.quote.length > left) {
                    return;
                }
            }
            const compared = claimsAt(candidate).filter((claim) => claim.source.verified !== false);
            for (const left of accounts.source.filter((claim) => claim.source.verified !== false)) {
                for (const right of compared) {
                    if (account === 'record' && record?.fact && (!ScribeCategory.same(record.text ?? '', right.value ?? '') ||
                        !ScribeCategory.same(subjectNames.get(record.subject) ?? '', right.subject ?? '') ||
                        ScribeLog.claimAttribute(record.category ?? '') !== ScribeLog.claimAttribute(right.attribute ?? ''))) {
                        continue;
                    }
                    compare(left, right, candidate, account);
                }
            }
        };
        independent(verified.earlier, 'earlier');
        independent(filed, 'record');
        const rulingText = /^r\d+$/.test(finding.record?.ref) ? finding.record.text.split('\n').slice(1).join('\n') : null;
        let operatorStatement = null;
        let operatorClaims = [];
        if (rulingText && [...rulings].some((row) => row.origin === ScribeLog.Origin.Operator && row.text === rulingText)) {
            try {
                const decision = JSON.parse(rulingText);
                if (!decision?.sourceStale && decision?.action !== 'open') {
                    operatorStatement = decision?.decision ?? decision?.text ?? rulingText;
                    operatorClaims = decision?.action === 'choose' ? decision.accounts ?? [] : [];
                }
            } catch (error) {
                if (!(error instanceof SyntaxError)) {
                    throw error;
                }
                operatorStatement = rulingText;
            }
        }
        if (typeof operatorStatement === 'string' && verified.source) {
            const statement = ScribeText.words(operatorStatement);
            accounts.source.some((left) => {
                const opposing = { quote: operatorStatement };
                if (operatorClaims.some((right) => {
                    const cited = ScribeLog.passage(right.source, messages.get(right.source?.messageId));
                    return cited && (operatorStatement === right.value || operatorStatement.includes(cited.quote)) &&
                        compare(left, right, cited, 'record');
                })) {
                    return true;
                }
                if (!left.value || !left.subject || !left.attribute) {
                    return false;
                }
                const quote = ScribeText.words(verified.source.quote);
                const value = ScribeText.words(left.value);
                const start = quote.findIndex((word, index) => value.every((part, offset) => quote[index + offset] === part));
                if (start < 0 || quote.length === value.length) {
                    return false;
                }
                const end = start + value.length;
                if (!quote.slice(0, start).every((word, index) => word === statement[index]) ||
                    !quote.slice(end).every((word, index) => word === statement[statement.length - (quote.length - end) + index])) {
                    return false;
                }
                const candidate = statement.slice(start, statement.length - (quote.length - end)).join(' ');
                return candidate && compare(left, { ...left, value: candidate }, opposing, 'record');
            });
        }
        const highest = Math.max(-1, ...comparisons.map((item) => item.score));
        const questions = new Set(comparisons.filter((item) => item.score === highest).map((item) => item.question));
        const rulingQuestion = questions.size === 1 ? [...questions][0] : null;
        const selected = comparisons.filter((item) => item.question === rulingQuestion);
        const choices = verified.source ? ['source', ...new Set(selected.map((item) => item.account))] : [];
        const actionable = !bookIssue && choices.length > 1;
        const correctable = bookIssue && verified.source && (finding.kind === 'Omission' || record?.fact) &&
            accounts.source.some((claim) => claim.subject && claim.attribute && claim.value);
        return { ...finding, id, priorId, version, accounts, support, choices, status: 'open', actionable,
            diagnostic: !actionable, correctable: Boolean(correctable), ...(actionable ? {
                rulingQuestion,
                earlier: choices.includes('earlier') ? finding.earlier : null,
                record: choices.includes('record') ? finding.record : null,
                accounts: { source: [...new Set(selected.map((item) => item.left))],
                    earlier: [...new Set(selected.filter((item) => item.account === 'earlier').map((item) => item.right))] },
                support: [...new Set([verified.source, ...selected.filter((item) => item.candidate.messageId).map((item) => item.candidate)])],
            } : {}), ...(operatorStatement && choices.includes('record') ? { operatorStatement } : {}) };
    },

    /**
     * @param {object} book
     * @param {object} state
     * @param {object[]} messages
     * @param {object} change
     * @param {((state:object, row:object, messages:object[], canonical:string|null)=>boolean)|null} shareable
     * @return {object}
     */
    ruleFinding(book, state, messages, change, shareable = null) {
        const log = book.log;
        const progress = ScribeLog.checkProgress(book, messages);
        const row = progress.findings.find((finding) => finding.id === change?.finding);
        const correction = row?.correctable && change.action === 'choose' && change.account === 'source';
        if (state.revision !== log.revision || (!row?.actionable && !correction) || row.version !== change.version || row.status === 'settled' ||
            row.status === 'deferred' && change.action === 'open') {
            throw new Error('This finding changed. Review the current evidence before ruling.');
        }
        const { action } = change;
        const account = change.account ?? null;
        const explanation = typeof change.explanation === 'string' ? change.explanation.trim() : null;
        if (!['choose', 'explain', 'open'].includes(action) || (action === 'choose'
            ? !row.choices.includes(account) : account !== null) ||
            (action === 'explain' ? (!explanation || explanation.length > 3000) : explanation !== null)) {
            throw new Error('Choose an available account, explain the evidence in up to 3,000 characters, or leave it open.');
        }
        const record = ScribeLog.checkRecord(row.record);
        let claims = action === 'choose' ? (row.accounts[account] ?? []) : Object.values(row.accounts).flat();
        let canonical = action === 'choose' ? (account === 'record' ? row.operatorStatement ?? record?.text ?? row.record.text : row[account].quote ?? row.question) : explanation;
        const patches = [];
        const factIds = [];
        const additions = [];
        const counters = { nextFact: log.nextFact, nextSubject: log.nextSubject };
        const declarations = [];
        const named = (name) => {
            const active = state.subjects.filter((subject) => !subject.mergedInto);
            const exact = active.filter((subject) => subject.label === name);
            if (exact.length) {
                return exact;
            }
            const aliases = active.filter((subject) => subject.aka.includes(name));
            return aliases.length ? aliases : active.filter((subject) => subject.name === name);
        };
        const ownerFor = (name) => {
            const owners = named(name);
            if (owners.length > 0) {
                return owners.length === 1 ? owners[0].id : null;
            }
            const pending = declarations.find((item) => item.label === name);
            if (pending) {
                return pending.subject;
            }
            const subject = ScribeLog.Settings.SubjectPrefix + counters.nextSubject++;
            declarations.push({ type: ScribeAnswer.Type.Subject, subject, label: name, kind: null });
            return subject;
        };
        const matchesSource = (fact, claim) => claim.subject && claim.value && named(claim.subject).some((owner) => owner.id === fact.subject) &&
            (fact.cite === claim.source.messageId || fact.evidence?.messageId === claim.source.messageId) &&
            (ScribeCategory.same(fact.text, claim.value) || ScribeCategory.same(fact.text, claim.text) ||
                fact.evidence?.quote === claim.source.quote && fact.evidence?.value === claim.value) &&
            (claim.attribute === fact.category || fact.evidence?.attribute === claim.attribute);
        const mark = (fact) => ({ subject: fact.subject, category: fact.category, text: fact.text,
            cite: fact.cite, target: fact.target, targetText: fact.targetText, ...ScribeCategory.scope(fact) });
        const evidenceFor = (claim) => ({ ...claim.source, messageNumber: claim.source.position, subject: claim.subject,
            attribute: claim.attribute, value: claim.value, attribution: claim.attribution });
        const selectedClaims = claims;
        const filedClaims = new Set();
        if (action === 'choose' && record?.fact) {
            const fact = state.facts.find((item) => item.id === record.fact);
            if (!fact || (record.text && fact.text !== record.text) || (record.subject && fact.subject !== record.subject) ||
                (record.category && fact.category !== record.category) || (record.cite && fact.cite !== record.cite) ||
                (Object.hasOwn(record, 'target') && record.target !== fact.target) ||
                (Object.hasOwn(record, 'targetText') && record.targetText !== fact.targetText)) {
                throw new Error('The cited book entry has changed. Check its current wording and references.');
            }
            const owned = claims.filter((item) => item.subject && named(item.subject).length === 1 && named(item.subject)[0].id === fact.subject);
            const candidates = owned.length <= 1 ? owned : owned.filter((item) =>
                item.attribute === fact.category || item.attribute === fact.evidence?.attribute);
            const claim = claims.length === 1 ? claims[0] : candidates.length === 1 ? candidates[0] : null;
            const subject = account !== 'record' && claim?.subject && claim.value ? ownerFor(claim.subject) : null;
            if (account === 'record') {
                factIds.push(fact.id);
            } else if (subject) {
                const fixed = ScribeLog.categoryKind(fact.category) === ScribeCategory.Kind.Fixed;
                const category = ScribeCategory.parse(claim.attribute ?? '');
                const relation = claim.target || category?.target || fact.category === ScribeCategory.Settings.RelationCategory;
                const selectedCategory = relation ? ScribeCategory.Settings.RelationCategory :
                    claim.attribute === fact.evidence?.attribute ? fact.category : category?.category ?? fact.category;
                const scope = selectedCategory === fact.category ? ScribeCategory.scope(fact) : ScribeCategory.scope({ category: selectedCategory, text: claim.value });
                let target = relation ? fact.target : null;
                let targetText = relation ? fact.targetText : null;
                if (relation) {
                    const selectedTarget = claim.target ?? category?.target;
                    const related = named(selectedTarget ?? claim.value);
                    if (related.length === 1) {
                        target = related[0].id;
                        targetText = related[0].label;
                    } else if (selectedTarget) {
                        target = null;
                        targetText = selectedTarget;
                    }
                }
                if (claims.length === 1) {
                    canonical = claim.value;
                }
                filedClaims.add(claim);
                const after = { subject, category: selectedCategory, target, targetText, ...scope, text: claim.value, cite: claim.source.messageId, position: claim.source.position,
                    ruledAttribute: claim.attribute, evidence: evidenceFor(claim) };
                const other = account === 'source' ? 'earlier' : 'source';
                const movedCitation = row.kind === 'Citation' && fact.cite !== claim.source.messageId;
                const companion = movedCitation ? (row.accounts[other] ?? []).filter((item) => item.subject === claim.subject &&
                    item.value && item.source.messageId === fact.cite && item.attribute !== claim.attribute) : [];
                if (companion.length === 1 && fact.category !== ScribeCategory.Settings.RelationCategory && !fixed && fact.subject === subject) {
                    const kept = companion[0];
                    claims = [kept, ...selectedClaims];
                    patches.push({ id: fact.id, before: mark(fact), after: { subject, category: ScribeCategory.parse(kept.attribute)?.category ?? fact.category,
                        target: null, targetText: null, text: kept.value,
                        cite: kept.source.messageId, position: kept.source.position, ruledAttribute: kept.attribute, evidence: evidenceFor(kept) } });
                    const id = ScribeLog.nextFactId(counters);
                    additions.push({ ...after, type: ScribeLog.Ruling.AddFact, fact: id, hidden: fact.hidden });
                    factIds.push(id);
                } else if (movedCitation && fact.text !== claim.value) {
                    patches.push({ id: fact.id, before: mark(fact), after: null });
                    const id = ScribeLog.nextFactId(counters);
                    additions.push({ ...after, type: ScribeLog.Ruling.AddFact, fact: id, hidden: fact.hidden });
                    factIds.push(id);
                } else {
                    patches.push({ id: fact.id, before: mark(fact), after });
                }
                factIds.push(fact.id);
            }
        }
        if (action === 'choose' && account !== 'record') {
            for (const claim of selectedClaims) {
                if (filedClaims.has(claim)) {
                    continue;
                }
                const matched = state.facts.filter((fact) => matchesSource(fact, claim));
                if (matched.length) {
                    for (const fact of matched) {
                        if (!factIds.includes(fact.id)) {
                            factIds.push(fact.id);
                        }
                    }
                    continue;
                }
                const category = claim.attribute && ScribeCategory.parse(claim.attribute);
                const owner = claim.subject && category && claim.value ? ownerFor(claim.subject) : null;
                if (owner) {
                    const targetText = claim.target ?? category.target;
                    const related = targetText ? named(targetText) : [];
                    const id = ScribeLog.nextFactId(counters);
                    additions.push({ type: ScribeLog.Ruling.AddFact, fact: id, subject: owner,
                        category: targetText ? ScribeCategory.Settings.RelationCategory : category.category, target: related.length === 1 ? related[0].id : null, targetText,
                        ...ScribeCategory.scope({ category: category.category, text: claim.text }),
                        text: claim.value, hidden: true,
                        cite: claim.source.messageId, position: claim.source.position, ruledAttribute: claim.attribute, evidence: evidenceFor(claim) });
                    factIds.push(id);
                    if (selectedClaims.length === 1 && row.kind === 'Omission') {
                        canonical = claim.value;
                    }
                }
            }
        }
        if (action === 'choose' && account !== 'record' && !record?.fact) {
            const accepted = [...state.facts.filter((fact) => factIds.includes(fact.id)), ...additions];
            const other = account === 'source' ? 'earlier' : 'source';
            const opposing = row.accounts[other] ?? [];
            for (const fact of state.facts) {
                const accountClaims = opposing.filter((claim) => named(claim.subject).some((owner) => owner.id === fact.subject));
                const winners = accepted.filter((winner) => winner.subject === fact.subject && winner.target === fact.target &&
                    winner.targetText === fact.targetText && ScribeCategory.sameScope(winner, fact));
                if (!factIds.includes(fact.id) && accountClaims.some((claim) => matchesSource(fact, claim)) &&
                    (winners.some((winner) => winner.category === fact.category) || winners.length === 1 && accountClaims.length === 1)) {
                    patches.push({ id: fact.id, before: mark(fact), after: null });
                }
            }
        }
        const { id, version, kind, question, source, earlier, support } = row;
        if ((change.shareInReminder !== undefined && typeof change.shareInReminder !== 'boolean') ||
            (change.shareInReminder && (action === 'open' || !shareable?.(state, row, messages, canonical)))) {
            throw new Error('Only rulings supported by public evidence can be shared with everyone in the chat.');
        }
        const decision = { finding: id, version, kind, reportedQuestionHash: ScribeText.fingerprint(question),
            question: row.rulingQuestion ?? (kind === 'Omission' ? 'File the cited claim' : 'Correct the cited book entry'),
            source, earlier: earlier ?? null, record: row.record ?? null,
            ...(change.shareInReminder ? { shareInReminder: true } : {}),
            support, action, account, explanation, claims, canonical, factIds, patches, additions,
            pointClaims: row.accounts.source.map(({ subject, attribute }) => ({ subject, attribute })),
            after: messages[(progress.processedThrough ?? progress.checkedThrough) - 1].id };
        const entry = { sequence: log.nextSequence, kind: ScribeLog.Kind.Operator, origin: ScribeLog.Origin.Operator,
            messageIds: [], operations: declarations, checkerRuling: JSON.parse(JSON.stringify(decision)), withdrawn: false };
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
        log.nextSubject = counters.nextSubject;
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
        if (page?.complete !== true || (page.judged !== undefined && typeof page.judged !== 'boolean') ||
            typeof page.id !== 'string' || !page.id || !Number.isSafeInteger(page.total) ||
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
        if (page.reviewRows !== undefined && (!Array.isArray(page.reviewRows) || !page.reviewRows.every((row) =>
            row && ['answer', 'claims', 'findings'].includes(row.section) && typeof row.reason === 'string' &&
            typeof row.statement === 'string'))) {
            return false;
        }
        if (page.modelResponses !== undefined && (!Array.isArray(page.modelResponses) ||
            !page.modelResponses.every((text) => typeof text === 'string'))) {
            return false;
        }
        if (answer.claims.length !== page.claims.length) {
            return false;
        }
        const supported = (source, currentOnly) => {
            const original = messages[source?.position - 1];
            const block = original?.blocks.find((part) => part.blockNumber === source.blockNumber);
            return Boolean(block && original.position === source.position &&
                (currentOnly ? original.id === target.id : original.position <= target.position) &&
                original.id === source.messageId && original.fingerprint === source.fingerprint && block.speaker === source.speaker &&
                typeof source.quote === 'string' && source.quote.trim() && (source.verified === false ||
                    block.text.includes(source.quote) && (ScribeIntake.Originals.get(block) ?? block.text).includes(source.quote)));
        };
        return page.claims.every((claim, index) => {
            const raw = answer.claims[index];
            return claim && raw && supported(claim.source, true) && claim.text === claim.source.quote &&
                JSON.stringify(raw.attribution) === JSON.stringify(claim.attribution) &&
                raw.source?.quote === claim.source.quote && raw.source.ref === 'm' + claim.source.position + 'b' + claim.source.blockNumber &&
                ['subject', 'attribute', 'value', 'target'].every((key) => (raw[key] ?? null) === (claim[key] ?? null));
        }) &&
            page.findings.every((finding) => finding && (finding.source?.unlinked === true
                ? finding.source.verified === false && finding.source.messageId === target.id && finding.source.fingerprint === target.fingerprint &&
                    finding.source.position === target.position && finding.source.blockNumber === null && finding.source.speaker === null
                : supported(finding.source, true)) &&
                typeof finding.question === 'string' && finding.question.trim() &&
                (!finding.earlier || supported(finding.earlier, false)));
    },

    /**
     * @param {object} page
     * @param {object} message
     * @return {object}
     */
    recoveredCheckPage(page, message) {
        if (!page.reviewRows?.length) {
            return page;
        }
        const claims = [...page.claims];
        const findings = [...page.findings];
        const reviewRows = [];
        let judged = page.judged;
        for (const row of page.reviewRows) {
            let item;
            try {
                item = JSON.parse(row.statement);
            } catch {
                reviewRows.push(row);
                continue;
            }
            const source = item?.source;
            const block = message.blocks.find((part) => source?.ref === 'm' + message.position + 'b' + part.blockNumber);
            if (row.section === 'answer' && row.reason === 'The Checker returned an incomplete or unrecognized response envelope.' &&
                item?.page === page.id && item.complete === true && Array.isArray(item.claims) && Array.isArray(item.findings)) {
                judged = true;
                continue;
            }
            if (!block || typeof source.quote !== 'string' || !source.quote.trim()) {
                reviewRows.push(row);
                continue;
            }
            const citation = { messageId: message.id, position: message.position, fingerprint: message.fingerprint,
                blockNumber: block.blockNumber, speaker: block.speaker, quote: source.quote };
            if (!block.text.includes(source.quote) || !(ScribeIntake.Originals.get(block) ?? block.text).includes(source.quote)) {
                citation.verified = false;
            }
            if (row.section === 'claims' &&
                ['subject', 'attribute', 'value', 'target'].every((field) => item[field] == null || typeof item[field] === 'string')) {
                claims.push({ source: citation, text: citation.quote, attribution: item.attribution, subject: item.subject ?? null,
                    attribute: item.attribute ?? null, value: item.value ?? null, ...(item.target ? { target: item.target } : {}) });
            } else if (row.section === 'findings' &&
                !item.earlier && !item.record && typeof item.question === 'string' && item.question.trim()) {
                findings.push({ kind: item.kind, source: citation, earlier: null, record: null, question: item.question });
            } else {
                reviewRows.push(row);
            }
        }
        return { ...page, claims, findings, reviewRows, judged };
    },

    /**
     * @param {object} book
     * @param {readonly object[]} messages
     * @param {boolean} includeContext
     * @return {object}
     */
    checkWork(book, messages, includeContext = true) {
        const { rows, checks, filedClaims, subjectNames } = ScribeLog.checkIndex(book, messages);
        let version = 'checker-v1';
        let writtenThrough = 0;
        let checkedThrough = 0;
        let processedThrough = 0;
        let checkedCount = 0;
        let message = null;
        let completed = [];
        let segments = [];
        let priorPages = [];
        const earlierClaims = [];
        const rulings = new Set();
        const decisions = new Map();
        const findings = new Map();
        const byId = new Map(messages.map((source) => [source.id, source]));
        const history = ScribeLog.findingHistory(book.log, byId, null, byId);
        const active = history.filter((row) => row.status !== 'superseded');
        const citedClaims = new Map();
        const reviewRows = new Map();
        const modelReadings = [];
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
            for (const choice of bucket.decisions) {
                const previous = decisions.get(choice.decision.finding);
                if (previous && previous.sequence > choice.sequence) {
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
            priorPages = [];
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
            }
            if (receipt?.fingerprint === source.fingerprint) {
                priorPages = (receipt.priorPages ?? []).filter((page) => page.seal === ScribeLog.checkSeal(page) &&
                    ScribeLog.validCheckPage(page, source, messages));
                if (message && receipt.planVersion !== ScribeLog.CheckerPlanVersion) {
                    priorPages = [...priorPages, ...completed, ...segments];
                    completed = [];
                    segments = [];
                }
            }
            const currentIds = new Set([...completed, ...segments].map((page) => page.id));
            const previous = priorPages.filter((page) => !currentIds.has(page.id));
            const observations = new Map();
            for (const page of [...previous, ...completed, ...segments]) {
                observations.set(page.id, page.modelResponses ?? []);
            }
            const represented = new Map();
            for (const id of [...observations.keys()].sort((left, right) => left.length - right.length)) {
                let ancestor = id;
                while (ancestor.includes('/')) {
                    ancestor = ancestor.slice(0, ancestor.lastIndexOf('/'));
                    if (represented.has(ancestor)) {
                        break;
                    }
                }
                const parent = represented.get(ancestor);
                const own = new Map();
                for (const statement of observations.get(id)) {
                    own.set(statement, (own.get(statement) ?? 0) + 1);
                    const available = parent?.get(statement) ?? 0;
                    if (available) {
                        parent.set(statement, available - 1);
                    } else {
                        modelReadings.push({ role: 'Checker', first: source.position, last: source.position, statement });
                    }
                }
                represented.set(id, own);
            }
            for (const page of message ? [...previous, ...completed, ...segments] : []) {
                for (const row of page.reviewRows ?? []) {
                    reviewRows.set(JSON.stringify([source.position, row]), { position: source.position, ...row });
                }
            }
            if (message) {
                continue;
            }
            const recovered = [...previous, ...completed].map((page) => ScribeLog.recoveredCheckPage(page, source));
            for (const page of recovered) {
                for (const row of page.reviewRows ?? []) {
                    reviewRows.set(JSON.stringify([source.position, row]), { position: source.position, ...row });
                }
                for (const claim of page.claims) {
                    const id = claim.source.messageId;
                    if (!citedClaims.has(id)) {
                        citedClaims.set(id, new Map());
                    }
                    citedClaims.get(id).set(JSON.stringify(claim), claim);
                }
            }
            for (const page of recovered) {
                const retained = [...page.findings];
                if (page.judged === undefined) {
                    const raw = JSON.parse(page.answer);
                    for (const item of raw.findings) {
                        if (item?.kind !== 'Omission' || typeof item.question !== 'string' || !item.question.trim() ||
                            item.record != null || item.earlier != null || retained.some((row) => row.kind === item.kind &&
                                row.question === item.question && row.source.quote === item.source?.quote &&
                                'm' + row.source.position + 'b' + row.source.blockNumber === item.source?.ref)) {
                            continue;
                        }
                        const claim = page.claims.find((row) => row.source.quote === item.source?.quote &&
                            'm' + row.source.position + 'b' + row.source.blockNumber === item.source?.ref);
                        if (claim) {
                            retained.push({ kind: item.kind, question: item.question, source: claim.source, earlier: null, record: null });
                        }
                    }
                }
                for (const finding of retained) {
                    const row = ScribeLog.findingPoint(finding, citedClaims, byId, rulings, filedClaims, subjectNames);
                    const linked = active.find((prior) => (prior.finding === row.id || prior.finding === row.priorId) &&
                        prior.kind === row.kind && (prior.question === row.question || prior.reportedQuestionHash === ScribeText.fingerprint(row.question)));
                    if (linked) {
                        row.id = linked.finding;
                        row.ruling = linked;
                        row.status = linked.status;
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
            processedThrough++;
            if (recovered.slice(previous.length).every((page) => page.judged ?? !page.reviewRows?.some((row) => row.section === 'answer'))) {
                checkedCount++;
                if (checkedThrough === processedThrough - 1) {
                    checkedThrough++;
                }
            }
            if (includeContext) {
                const independent = new Map();
                for (const page of recovered) {
                    for (const claim of page.claims) {
                        independent.set(JSON.stringify(claim), claim);
                    }
                }
                const originals = new Map();
                for (const record of [...bucket.written, ...independent.values(), ...bucket.rulings]) {
                    const cite = record.source;
                    const message = cite && byId.get(cite.messageId);
                    const block = message?.blocks.find((part) => part.blockNumber === cite.blockNumber);
                    if (block && cite.verified !== false && cite.fingerprint === message.fingerprint &&
                        typeof cite.quote === 'string' && cite.quote && block.text.includes(cite.quote)) {
                        const linked = { messageId: message.id, position: message.position, fingerprint: message.fingerprint,
                            blockNumber: block.blockNumber, speaker: block.speaker, role: block.role, quote: cite.quote };
                        originals.set(JSON.stringify(linked), linked);
                    }
                }
                earlierClaims.push(...originals.values(), ...bucket.written.map((row) => {
                    if (!row.modelCitation?.original) {
                        return row;
                    }
                    const { original, ...modelCitation } = row.modelCitation;
                    return { ...row, modelCitation };
                }), ...independent.values());
            }
        }
        for (const prior of active) {
            if (!findings.has(prior.finding)) {
                findings.set(prior.finding, { id: prior.finding, version: prior.version, kind: prior.kind,
                    question: prior.question, source: prior.source, earlier: prior.earlier, record: prior.record,
                    status: prior.status, ruling: prior, actionable: false });
            }
        }
        return { checkedThrough, processedThrough, checkedCount, writtenThrough, message, version,
            reviewRows: [...reviewRows.values()], modelReadings, written: message ? rows[message.position - 1].written : [],
            earlierClaims, rulings: includeContext ? [...rulings] : [], completed: message ? completed : [], segments,
            priorPages: message ? priorPages : [], findings: [...findings.values()] };
    },

    /**
     * @param {object} book
     * @param {readonly object[]} messages
     * @return {object}
     */
    checkProgress(book, messages) {
        const { checkedThrough, processedThrough, checkedCount, writtenThrough, findings, reviewRows, modelReadings } = ScribeLog.checkWork(book, messages, false);
        return { checkedThrough, writtenThrough, findings, ...(processedThrough !== checkedThrough ? { processedThrough, checkedCount } : {}),
            ...(reviewRows.length ? { reviewRows } : {}), ...(modelReadings.length ? { modelReadings } : {}) };
    },

    /**
     * @param {object} page
     * @return {string}
     */
    checkSeal(page) {
        const fields = [page.id, page.index, page.total, page.answer, page.claims, page.findings];
        if (page.judged !== undefined) {
            fields.push(page.judged);
        }
        if (page.planBytes !== undefined) {
            fields.push(page.planBytes, page.parentId ?? null, page.parentIndex ?? null);
        }
        if (page.verifyFrom !== undefined) {
            fields.push(page.verifyFrom);
        }
        if (page.reviewRows !== undefined) {
            fields.push(page.reviewRows);
        }
        if (page.modelResponses !== undefined) {
            fields.push(page.modelResponses);
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
        if (existing.check.planVersion !== ScribeLog.CheckerPlanVersion) {
            if (current.priorPages.length) {
                existing.check.priorPages = current.priorPages;
            }
            existing.check.planVersion = ScribeLog.CheckerPlanVersion;
            existing.check.pages = [];
            delete existing.check.segments;
        }
        if (existing.check.priorPages?.length) {
            existing.check.priorPages = existing.check.priorPages.filter((prior) => prior.id !== stored.id ||
                prior.answer !== stored.answer || JSON.stringify(prior.modelResponses) !== JSON.stringify(stored.modelResponses) ||
                JSON.stringify(prior.reviewRows) !== JSON.stringify(stored.reviewRows));
            if (!existing.check.priorPages.length) {
                delete existing.check.priorPages;
            }
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
            const blocks = message.blocks.filter((block) => evidence?.verified !== false && (!evidence || (evidence.messageId === message.id &&
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
            let lastPosition = null;
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
                    } else if (lastIndex >= 0 && now - lastIndex > (position !== null && lastPosition !== null
                        ? position - lastPosition : index - lastEntryIndex)) {
                        first = Math.min(first, lastIndex + 1);
                    }
                    lastIndex = now;
                    lastEntryIndex = index;
                    lastPosition = position;
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
