const BenchView = Object.freeze({
    PageSize: 20,

    Settings: Object.freeze({
        FirstPage: 1,
        AuditSize: 30,
        Nothing: '',
        Hash: '#',
        RangeTo: ' to #',
        Span: '-#',
        Joiner: ', ',
        Colon: ': ',
        Space: ' ',
        RelationTo: 'relation to ',
        NotesSource: 'notes #',
        OwnerSource: 'owner',
        Public: 'public',
        Private: 'private',
        Narrowed: 'public, narrowed',
        Nobody: 'nobody',
        FromOpen: ' (from #',
        UntilOpen: ' (until #',
        UntilInside: ' until #',
        Close: ')',
        Stored: ' stored, ',
        Refused: ' refused, ',
        Spent: ' spent, ',
        Single: 1,
        Call: ' call',
        Calls: ' calls',
        Unpriced: ' unpriced, ',
        Of: ' of ',
        Read: ' read',
        Dollar: '$',
        Decimals: 4,
        ThousandsSeparator: ',',
        Words: Object.freeze({
            Pin: 'Pin ',
            Merge: 'Merge ',
            Into: ' into ',
            Split: 'Split ',
            FromSubject: ' from ',
            As: ' as ',
            Distinct: 'Keep ',
            And: ' and ',
            Apart: ' apart',
            Narrow: 'Narrow the scene starting at ',
            Widen: 'Widen ',
            To: ' to ',
            Add: 'Add ',
            Remove: 'Remove ',
            Unalias: 'Unalias ',
            Answer: 'Answer ',
            Dismiss: 'Dismiss ',
            DismissContradiction: 'Dismiss the contradiction "',
            Against: '" against "',
            QuoteClose: '"',
        }),
        Random: Object.freeze({
            Increment: 0x6d2b79f5,
            FirstShift: 15,
            SecondShift: 7,
            ThirdShift: 14,
            Odd: 1,
            Mixer: 61,
            Range: 4294967296,
        }),

        /**
         * @return {RegExp}
         */
        get Thousands() {
            return /\B(?=(\d{3})+(?!\d))/g;
        },
    }),

    /**
     * @param {*} page
     * @param {number} pages
     * @return {number}
     */
    clamp(page, pages) {
        const first = BenchView.Settings.FirstPage;
        const asked = Number.isSafeInteger(page) && page >= first ? page : first;
        return Math.min(asked, pages);
    },

    /**
     * @param {readonly object[]} items
     * @param {number} page
     * @return {{ rows: object[], pages: number }}
     */
    page(items, page) {
        const size = BenchView.PageSize;
        const pages = Math.max(BenchView.Settings.FirstPage, Math.ceil(items.length / size));
        const current = BenchView.clamp(page, pages);
        return { rows: items.slice((current - 1) * size, current * size), pages };
    },

    /**
     * @param {object} state
     * @return {Map<string, string>}
     */
    labels(state) {
        const labels = new Map();
        for (const subject of state.subjects) {
            labels.set(subject.id, subject.label);
        }
        return labels;
    },

    /**
     * @param {object} state
     * @return {Map<string, object>}
     */
    facts(state) {
        const facts = new Map();
        for (const fact of state.facts) {
            facts.set(fact.id, fact);
        }
        return facts;
    },

    /**
     * @param {number} number
     * @return {string}
     */
    count(number) {
        const settings = BenchView.Settings;
        return String(number).replace(settings.Thousands, settings.ThousandsSeparator);
    },

    /**
     * @param {object} state
     * @return {object|null}
     */
    running(state) {
        let found = null;
        for (const scene of state.scenes) {
            if (found === null || scene.lastPosition >= found.lastPosition) {
                found = scene;
            }
        }
        return found;
    },

    /**
     * @param {{ category: string, target: string|null, targetText: string|null }} fact
     * @param {Map<string, string>} labels
     * @return {string}
     */
    category(fact, labels) {
        if (fact.category !== ScribeCategory.Settings.RelationCategory) {
            return fact.category;
        }
        return BenchView.Settings.RelationTo + (fact.target === null ? fact.targetText : labels.get(fact.target));
    },

    /**
     * @param {{ origin: string, position: number }} fact
     * @return {string}
     */
    source(fact) {
        const settings = BenchView.Settings;
        if (fact.origin === ScribeLog.Origin.Operator) {
            return settings.OwnerSource;
        }
        if (fact.origin === ScribeLog.Origin.Notes) {
            return settings.NotesSource + fact.position;
        }
        return settings.Hash + fact.position;
    },

    /**
     * @param {object} state
     * @param {object} fact
     * @param {Map<string, string>} labels
     * @return {string}
     */
    audience(state, fact, labels) {
        const heard = ScribeKnowledge.audience(state, fact);
        if (heard === ScribeKnowledge.Everyone) {
            return ScribeKnowledge.Everyone;
        }
        return heard
            .map(
                /**
                 * @param {string} id
                 * @return {string}
                 */
                (id) => labels.get(id),
            )
            .join(BenchView.Settings.Joiner);
    },

    /**
     * @param {object} state
     * @param {string} query
     * @param {number} page
     * @return {{ rows: Array<{ id: string, label: string, kind: string, facts: number, present: boolean }>, pages: number }}
     */
    subjects(state, query, page) {
        const settings = BenchView.Settings;
        const running = BenchView.running(state);
        const present = new Set();
        for (const attendee of running === null ? [] : running.present) {
            present.add(attendee.subject);
        }
        const counts = new Map();
        for (const fact of state.facts) {
            if (fact.status === ScribeReplay.Status.InForce) {
                counts.set(fact.subject, (counts.get(fact.subject) ?? 0) + 1);
            }
        }
        const wanted = query.trim().toLowerCase();
        const rows = state.subjects
            .filter(
                /**
                 * @param {{ label: string, name: string, aka: readonly string[], mergedInto: string|null }} subject
                 * @return {boolean}
                 */
                (subject) =>
                    subject.mergedInto === null &&
                    (wanted === settings.Nothing ||
                        [subject.label, subject.name, ...subject.aka].some(
                            /**
                             * @param {string} written
                             * @return {boolean}
                             */
                            (written) => written.toLowerCase().includes(wanted),
                        )),
            )
            .map(
                /**
                 * @param {{ id: string, label: string, kind: string }} subject
                 * @return {{ id: string, label: string, kind: string, facts: number, present: boolean }}
                 */
                (subject) => ({
                    id: subject.id,
                    label: subject.label,
                    kind: subject.kind,
                    facts: counts.get(subject.id) ?? 0,
                    present: present.has(subject.id),
                }),
            );
        rows.sort(
            /**
             * @param {{ label: string, facts: number, present: boolean }} first
             * @param {{ label: string, facts: number, present: boolean }} second
             * @return {number}
             */
            (first, second) =>
                Number(second.present) - Number(first.present) ||
                second.facts - first.facts ||
                first.label.localeCompare(second.label),
        );
        return BenchView.page(rows, page);
    },

    /**
     * @param {object} state
     * @param {string} id
     * @return {{ id: string, heading: string, kind: string, aka: readonly string[], facts: object[] }|null}
     */
    subject(state, id) {
        const found = state.subjects.find(
            /**
             * @param {{ id: string }} candidate
             * @return {boolean}
             */
            (candidate) => candidate.id === id,
        );
        if (found === undefined) {
            return null;
        }
        const subject =
            found.mergedInto === null
                ? found
                : state.subjects.find(
                      /**
                       * @param {{ id: string }} candidate
                       * @return {boolean}
                       */
                      (candidate) => candidate.id === found.mergedInto,
                  );
        const labels = BenchView.labels(state);
        const facts = state.facts
            .filter(
                /**
                 * @param {{ subject: string }} fact
                 * @return {boolean}
                 */
                (fact) => fact.subject === subject.id,
            )
            .map(
                /**
                 * @param {object} fact
                 * @return {object}
                 */
                (fact) => ({
                    id: fact.id,
                    category: BenchView.category(fact, labels),
                    text: fact.text,
                    source: BenchView.source(fact),
                    status: fact.status,
                    audience: BenchView.audience(state, fact, labels),
                    hidden: fact.hidden,
                    pinned: fact.pinned,
                }),
            );
        return { id: subject.id, heading: subject.label, kind: subject.kind, aka: subject.aka, facts };
    },

    /**
     * @param {object} scene
     * @param {Map<string, string>} labels
     * @return {{ id: string, day: number, range: string, place: string, reach: string, present: string, summary: string }}
     */
    scene(scene, labels) {
        const settings = BenchView.Settings;
        let reach = settings.Private;
        if (scene.reach === ScribeAnswer.Reach.Public) {
            reach = scene.narrowed ? settings.Narrowed : settings.Public;
        }
        const present = scene.present.map(
            /**
             * @param {{ subject: string, from: number|null, until: number|null }} attendee
             * @return {string}
             */
            (attendee) => {
                const label = labels.get(attendee.subject);
                if (attendee.from !== null && attendee.until !== null) {
                    return label + settings.FromOpen + attendee.from + settings.UntilInside + attendee.until + settings.Close;
                }
                if (attendee.from !== null) {
                    return label + settings.FromOpen + attendee.from + settings.Close;
                }
                if (attendee.until !== null) {
                    return label + settings.UntilOpen + attendee.until + settings.Close;
                }
                return label;
            },
        );
        return {
            id: scene.id,
            day: scene.day,
            range: settings.Hash + scene.firstPosition + settings.Span + scene.lastPosition,
            place: scene.place,
            reach,
            present: present.length === 0 ? settings.Nobody : present.join(settings.Joiner),
            summary: scene.summary,
        };
    },

    /**
     * @param {object} state
     * @param {number} page
     * @return {{ rows: object[], pages: number }}
     */
    timeline(state, page) {
        const labels = BenchView.labels(state);
        return BenchView.page(
            state.scenes.map(
                /**
                 * @param {object} scene
                 * @return {object}
                 */
                (scene) => BenchView.scene(scene, labels),
            ),
            page,
        );
    },

    /**
     * @param {object} state
     * @return {{ conflicts: object[], lookAlikes: object[], publicScenes: object[], questions: object[], refinements: object[], aliases: object[] }}
     */
    rulings(state) {
        const labels = BenchView.labels(state);
        const facts = BenchView.facts(state);
        const conflicts = state.conflicts.map(
            /**
             * @param {{ subject: string, category: string, established: string|null, others: readonly string[] }} conflict
             * @return {object}
             */
            (conflict) => {
                const ids = conflict.established === null ? conflict.others : [conflict.established, ...conflict.others];
                return {
                    subject: conflict.subject,
                    label: labels.get(conflict.subject),
                    category: conflict.category,
                    established: conflict.established,
                    values: ids.map(
                        /**
                         * @param {string} id
                         * @return {{ fact: string, text: string, source: string, hidden: boolean, established: boolean }}
                         */
                        (id) => {
                            const fact = facts.get(id);
                            return {
                                fact: id,
                                text: fact.text,
                                source: BenchView.source(fact),
                                hidden: fact.hidden,
                                established: id === conflict.established,
                            };
                        },
                    ),
                };
            },
        );
        const lookAlikes = state.lookAlikes.map(
            /**
             * @param {{ first: string, second: string, reason: string }} likeness
             * @return {object}
             */
            (likeness) => ({
                first: likeness.first,
                second: likeness.second,
                firstLabel: labels.get(likeness.first),
                secondLabel: labels.get(likeness.second),
                reason: likeness.reason,
            }),
        );
        const publicScenes = state.scenes
            .filter(
                /**
                 * @param {object} scene
                 * @return {boolean}
                 */
                (scene) => ScribeKnowledge.open(scene),
            )
            .map(
                /**
                 * @param {object} scene
                 * @return {object}
                 */
                (scene) => BenchView.scene(scene, labels),
            );
        const questions = state.questions
            .filter(
                /**
                 * @param {{ dismissed: boolean }} question
                 * @return {boolean}
                 */
                (question) => !question.dismissed,
            )
            .map(
                /**
                 * @param {{ id: string, text: string, position: number, answer: string|null }} question
                 * @return {object}
                 */
                (question) => ({
                    id: question.id,
                    text: question.text,
                    position: question.position,
                    answer: question.answer,
                }),
            );
        const refinements = state.refinements.map(
            /**
             * @param {{ from: string, to: string }} refinement
             * @return {object}
             */
            (refinement) => {
                const fuller = facts.get(refinement.to);
                return {
                    label: labels.get(fuller.subject),
                    category: BenchView.category(fuller, labels),
                    from: facts.get(refinement.from).text,
                    to: fuller.text,
                };
            },
        );
        const aliases = state.aliases.map(
            /**
             * @param {{ subject: string, name: string }} alias
             * @return {object}
             */
            (alias) => ({ subject: alias.subject, label: labels.get(alias.subject), name: alias.name }),
        );
        return { conflicts, lookAlikes, publicScenes, questions, refinements, aliases };
    },

    Summaries: Object.freeze({
        /**
         * @param {object} operation
         * @return {string}
         */
        EditFact(operation) {
            return 'Edited ' + operation.fact + ' from “' + operation.before + '” to “' + operation.text + '”';
        },

        /**
         * @param {{ category: string, text: string }} operation
         * @return {string}
         */
        Pin(operation) {
            const settings = BenchView.Settings;
            return settings.Words.Pin + operation.category + settings.Colon + operation.text;
        },

        /**
         * @param {{ from: string, into: string }} operation
         * @return {string}
         */
        Merge(operation) {
            const words = BenchView.Settings.Words;
            return words.Merge + operation.from + words.Into + operation.into;
        },

        /**
         * @param {{ subject: string, label: string, facts: readonly string[] }} operation
         * @return {string}
         */
        Split(operation) {
            const settings = BenchView.Settings;
            const words = settings.Words;
            return (
                words.Split +
                operation.facts.join(settings.Joiner) +
                words.FromSubject +
                operation.subject +
                words.As +
                operation.label
            );
        },

        /**
         * @param {{ first: string, second: string }} operation
         * @return {string}
         */
        Distinct(operation) {
            const words = BenchView.Settings.Words;
            return words.Distinct + operation.first + words.And + operation.second + words.Apart;
        },

        /**
         * @param {{ scene: string }} operation
         * @return {string}
         */
        Narrow(operation) {
            return BenchView.Settings.Words.Narrow + operation.scene;
        },

        /**
         * @param {{ fact: string, to: string|readonly string[] }} operation
         * @return {string}
         */
        Widen(operation) {
            const settings = BenchView.Settings;
            const to = operation.to === ScribeKnowledge.Everyone ? operation.to : operation.to.join(settings.Joiner);
            return settings.Words.Widen + operation.fact + settings.Words.To + to;
        },

        /**
         * @param {{ category: string, targetText: string|null, text: string }} operation
         * @return {string}
         */
        AddFact(operation) {
            const settings = BenchView.Settings;
            const category =
                operation.category === ScribeCategory.Settings.RelationCategory
                    ? settings.RelationTo + operation.targetText
                    : operation.category;
            return settings.Words.Add + category + settings.Colon + operation.text;
        },

        /**
         * @param {{ fact: string, mark: { text: string } }} operation
         * @return {string}
         */
        RemoveFact(operation) {
            const settings = BenchView.Settings;
            return settings.Words.Remove + operation.fact + settings.Colon + operation.mark.text;
        },

        /**
         * @param {{ subject: string, name: string }} operation
         * @return {string}
         */
        Unalias(operation) {
            const words = BenchView.Settings.Words;
            return words.Unalias + operation.name + words.FromSubject + operation.subject;
        },

        /**
         * @param {{ question: string, text: string }} operation
         * @return {string}
         */
        Answer(operation) {
            const settings = BenchView.Settings;
            return settings.Words.Answer + operation.question + settings.Colon + operation.text;
        },

        /**
         * @param {{ question: string, questionText: string }} operation
         * @return {string}
         */
        Dismiss(operation) {
            const settings = BenchView.Settings;
            return settings.Words.Dismiss + operation.question + settings.Colon + operation.questionText;
        },

        /**
         * @param {{ said: string, before: string }} operation
         * @return {string}
         */
        DismissContradiction(operation) {
            const words = BenchView.Settings.Words;
            return words.DismissContradiction + operation.said + words.Against + operation.before + words.QuoteClose;
        },
    }),

    /**
     * @param {{ entries: readonly object[] }} log
     * @return {Array<{ sequence: number, type: string, summary: string }>}
     */
    made(log) {
        const rulings = ScribeLog.Ruling;
        const owned = log.entries.filter(
            /**
             * @param {{ kind: string, withdrawn: boolean }} entry
             * @return {boolean}
             */
            (entry) => entry.kind === ScribeLog.Kind.Operator && !entry.withdrawn,
        );
        const answeredIds = new Set();
        const answeredWordings = new Set();
        for (const entry of owned) {
            const [operation] = entry.operations;
            if (operation.type === rulings.Answer) {
                answeredIds.add(operation.question);
                answeredWordings.add(ScribeReplay.wording(operation.questionText));
            }
        }
        const rows = [];
        for (const entry of owned) {
            const [operation] = entry.operations;
            const filed =
                operation.type === rulings.Dismiss &&
                (answeredIds.has(operation.question) ||
                    answeredWordings.has(ScribeReplay.wording(operation.questionText)));
            if (filed) {
                continue;
            }
            rows.unshift({
                sequence: entry.sequence,
                type: operation.type,
                summary: BenchView.Summaries[operation.type](operation),
            });
        }
        return rows;
    },

    /**
     * @param {object} state
     * @return {number}
     */
    blocking(state) {
        const likeness = ScribeReplay.Likeness;
        const blocked = state.lookAlikes.filter(
            /**
             * @param {{ reason: string }} item
             * @return {boolean}
             */
            (item) => item.reason === likeness.SameName || item.reason === likeness.Alias,
        );
        return state.conflicts.length + blocked.length;
    },

    /**
     * @param {number} seed
     * @return {() => number}
     */
    random(seed) {
        const settings = BenchView.Settings.Random;
        let current = seed >>> 0;
        return (
            /**
             * @return {number}
             */
            () => {
                current = (current + settings.Increment) >>> 0;
                let mixed = Math.imul(current ^ (current >>> settings.FirstShift), settings.Odd | current);
                mixed = (mixed + Math.imul(mixed ^ (mixed >>> settings.SecondShift), settings.Mixer | mixed)) ^ mixed;
                return ((mixed ^ (mixed >>> settings.ThirdShift)) >>> 0) / settings.Range;
            }
        );
    },

    /**
     * @param {object} state
     * @param {readonly object[]} messages
     * @param {number} seed
     * @return {Array<{ fact: string, subject: string, category: string, text: string, position: number, message: string }>}
     */
    audit(state, messages, seed) {
        const settings = BenchView.Settings;
        const pool = state.facts.filter(
            /**
             * @param {{ status: string, origin: string }} fact
             * @return {boolean}
             */
            (fact) => fact.status === ScribeReplay.Status.InForce && fact.origin === ScribeLog.Origin.Story,
        );
        const next = BenchView.random(seed);
        for (let index = pool.length - 1; index > 0; index--) {
            const swap = Math.floor(next() * (index + 1));
            [pool[index], pool[swap]] = [pool[swap], pool[index]];
        }
        const texts = new Map();
        for (const message of messages) {
            texts.set(message.id, message.text);
        }
        const labels = BenchView.labels(state);
        return pool.slice(0, settings.AuditSize).map(
            /**
             * @param {object} fact
             * @return {{ fact: string, subject: string, category: string, text: string, position: number, message: string }}
             */
            (fact) => ({
                fact: fact.id,
                subject: labels.get(fact.subject),
                category: BenchView.category(fact, labels),
                text: fact.text,
                position: fact.position,
                message: texts.get(fact.cite) ?? settings.Nothing,
            }),
        );
    },

    /**
     * @param {number} amount
     * @return {string}
     */
    money(amount) {
        const settings = BenchView.Settings;
        return settings.Dollar + amount.toFixed(settings.Decimals);
    },

    /**
     * @param {{ pass: string, first: number|null, last: number|null, read: number, total: number, spent: number, unpriced: number, stored: number, refusedLines: readonly object[], refusedOperations: readonly object[] }} report
     * @return {string}
     */
    progress(report) {
        const settings = BenchView.Settings;
        const where =
            report.pass === ScribeAdoption.Pass.Story
                ? settings.Hash + report.first + settings.RangeTo + report.last
                : report.pass;
        const refused = report.refusedLines.length + report.refusedOperations.length;
        const unpriced =
            report.unpriced === 0
                ? settings.Nothing
                : BenchView.calls(report.unpriced) + settings.Unpriced;
        return (
            where +
            settings.Colon +
            report.stored +
            settings.Stored +
            refused +
            settings.Refused +
            BenchView.money(report.spent) +
            settings.Spent +
            unpriced +
            BenchView.count(report.read) +
            settings.Of +
            BenchView.count(report.total) +
            settings.Read
        );
    },

    /**
     * @param {number} count
     * @return {string}
     */
    calls(count) {
        const settings = BenchView.Settings;
        return BenchView.count(count) + (count === settings.Single ? settings.Call : settings.Calls);
    },
});
