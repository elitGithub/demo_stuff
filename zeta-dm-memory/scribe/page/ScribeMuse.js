const ScribeMuse = Object.freeze({
    Settings: Object.freeze({
        LineBytes: 300,
        Recent: 10,
        WordsLimit: 2000,
        LabelLimit: 60,
        TextLimit: 200,
        FirstEntry: 0,
        NoSceneBefore: 0,
        ContentGroup: 1,
        LabelReach: 40,
        OneMarked: 1,
        Nothing: '',
        Space: ' ',
        Newline: '\n',
        BlankLine: '\n\n',
        Comma: ', ',
        Colon: ': ',
        Marker: '@',
        ScribeStart: '[scribe',
        Joiner: ' | ',
        Day: 'Day ',
        Present: 'present: ',
        Nobody: 'nobody',
        Unknown: '(unknown)',
        Toward: ' toward ',
        Cut: '...',
        NewSubject: 'New ',
        AnotherName: 'Another name for ',
        NoLongerName: 'No longer a name for ',
        BecomesA: 'Becomes a ',
        Renamed: 'Renamed: ',
        IsNow: ' is now ',
        Leaves: 'Leaves the book: ',
        SubjectElse: 'Something else changes: ',
        HiddenMark: 'Hidden',
        NotHiddenMark: 'Not hidden',
        NewFact: ', new',
        NewNotInForce: ', new but not in force (',
        NotInForceClose: ')',
        FactEnd: ': ',
        RemovedFact: ', removed: ',
        WasStatus: ', was ',
        BecomesStatus: ', becomes ',
        HiddenToOpen: 'Was hidden, becomes not hidden: ',
        OpenToHidden: 'Was not hidden, becomes hidden: ',
        WhoKnows: ', who knows it changes: ',
        FactAlso: ', also changes (',
        FactAlsoClose: '): ',
        AliasMember: 'aliases',
        NameKey: '|',
        Conflict: 'A conflict for you to rule: ',
        Settled: 'A conflict would be settled: ',
        ConflictChanges: 'A conflict changes: ',
        OpenThread: 'Open thread: ',
        ClosedNew: 'New thread, already closed: ',
        ThreadClosed: 'Thread closed: ',
        ThreadReopened: 'Thread reopened: ',
        ThreadChanges: 'Thread changes: ',
        ThreadRemoved: 'Thread removed: ',
        LookAlike: 'A look-alike for you to rule: ',
        And: ' and ',
        BookElse: 'Something else in the book would change: ',
        NothingChanges: 'Nothing in the book would change.',
        Covered: Object.freeze(['revision', 'subjects', 'facts', 'threads', 'conflicts', 'lookAlikes',
            'resolutions', 'legacyDecisions', 'decisionRead', 'editOrigins', 'editedSince']),
        SubjectCovered: Object.freeze(['id', 'kind', 'label', 'aka']),
        FactCovered: Object.freeze(['id', 'status', 'hidden', 'told', 'widened']),
        FactLinks: Object.freeze(['replacedBy', 'ended']),
        MapTag: '[object Map]',
        SetTag: '[object Set]',
        Headings: Object.freeze({
            Scene: 'SCENE:',
            Thread: 'THREAD:',
            Recent: 'RECENT MESSAGES:',
        }),
        Reasons: Object.freeze({
            NotFromANote: 'NotFromANote',
            WrongPosition: 'WrongPosition',
        }),
        Brackets: Object.freeze(['()', '[]']),
        NormalForm: 'NFKC',
        Quote: '"',
        Apostrophe: "'",
        ReasonGiven: ', reason given for the end: ',
        PinnedMark: ', pinned',
        LookSettled: 'A look-alike would be settled: ',
        LookChanges: 'A look-alike changes: ',
        EndedStatus: 'Ended',

        /**
         * @return {RegExp}
         */
        get LineBreak() {
            return /\r\n|(?!\t)[\p{Cc}\p{Zl}\p{Zp}]/u;
        },

        /**
         * @return {RegExp}
         */
        get Controls() {
            return /[\p{Cc}\p{Zl}\p{Zp}]/gu;
        },

        /**
         * @return {RegExp}
         */
        get FormatCharacter() {
            return /\p{Cf}/gu;
        },

        /**
         * @return {RegExp}
         */
        get LeadingCitation() {
            return /^(?:\[#\d+\]\s*)+/;
        },

        /**
         * @return {RegExp}
         */
        get MarkedLine() {
            return /^[ >*_#`]*LINE:\s*(.*)$/;
        },

        /**
         * @return {RegExp}
         */
        get Ignorable() {
            return /[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu;
        },

        /**
         * @return {RegExp}
         */
        get DressStart() {
            return /^[*_`]+/;
        },

        /**
         * @return {RegExp}
         */
        get DressEnd() {
            return /[*_`]+$/;
        },

        /**
         * @return {RegExp}
         */
        get DressMarks() {
            return /[*_`]/g;
        },

        /**
         * @return {RegExp}
         */
        get QuoteMark() {
            return /^\p{Quotation_Mark}$/u;
        },

        /**
         * @return {RegExp}
         */
        get QuoteMarks() {
            return /(?!['’])\p{Quotation_Mark}/gu;
        },

        /**
         * @return {RegExp}
         */
        get Letters() {
            return /[\p{L}\p{N}]/u;
        },

        /**
         * @return {RegExp}
         */
        get LabelInside() {
            return /^(?:[^\s:]+ ){0,3}[^\s:]+ ?:(?!\d)/;
        },

        /**
         * @return {RegExp}
         */
        get NoneAnswer() {
            return /^none(?:[\p{P}\s]*$|[.,:;]| \p{Pd} )/iu;
        },

        /**
         * @return {RegExp}
         */
        get Refusal() {
            return /^(?:(?:i['’]m sorry|i am sorry|i can['’]t|i cannot|i won['’]t|as an ai)(?!\p{L})|(?:sorry|sure|certainly)[,.!]|here(?: is|['’]s) (?:a|the|your) (?:\S+ ){0,3}(?:line|suggestion|narrator|option|version)(?!\p{L}))/iu;
        },

        PromptLines: Object.freeze([
            'You help a storyteller keep an ongoing adult fiction roleplay moving. You do not continue the story yourself.',
            'You receive the SCENE as it stands, one open THREAD the story left hanging, and the RECENT MESSAGES.',
            'Write one narrator line, at most 40 words, that brings the THREAD back into this scene as a development the characters must react to: an arrival, a discovery, a message, a consequence. It must fit the scene and contradict nothing in the recent messages.',
            'Answer with exactly one line that begins with LINE: followed by the narrator line, all on that one line. No quotation marks around it, no label inside it, nothing before it and nothing after it.',
            'If the thread cannot fit this scene at all, answer with exactly: NONE',
        ]),

        /**
         * @return {readonly string[]}
         */
        get Filed() {
            const types = ScribeAnswer.Type;
            return [
                types.Subject,
                types.Alias,
                types.Fact,
                types.Change,
                types.Refine,
                types.End,
                types.ThreadOpen,
            ];
        },
    }),

    /**
     * @return {string}
     */
    get SuggestPrompt() {
        return ScribeMuse.Settings.PromptLines.join(ScribeMuse.Settings.Newline);
    },

    /**
     * @param {object} state
     * @param {{ present: ReadonlyArray<{ subject: string|null }> }|null} now
     * @param {readonly string[]} exclude
     * @return {object|null}
     */
    thread(state, now, exclude) {
        const settings = ScribeMuse.Settings;
        const open = state.threads.filter(
            /**
             * @param {{ id: string, closed: object|null }} thread
             * @return {boolean}
             */
            (thread) => thread.closed === null && !exclude.includes(thread.id),
        );
        if (open.length === 0) {
            return null;
        }
        if (now === null) {
            return open[settings.FirstEntry];
        }
        const worlds = new Set();
        for (const subject of state.subjects) {
            if (subject.kind === ScribeCategory.SubjectKinds.World) {
                worlds.add(subject.id);
            }
        }
        const present = new Set();
        for (const person of now.present) {
            if (person.subject !== null && !worlds.has(person.subject)) {
                present.add(person.subject);
            }
        }
        const near = open.find(
            /**
             * @param {{ text: string }} thread
             * @return {boolean}
             */
            (thread) =>
                ScribeAnalyzer.select(state, thread.text, settings.Nothing, settings.NoSceneBefore).some(
                    /**
                     * @param {string} id
                     * @return {boolean}
                     */
                    (id) => present.has(id),
                ),
        );
        return near === undefined ? open[settings.FirstEntry] : near;
    },

    /**
     * @param {{ day: number, place: string, reach: string, present: ReadonlyArray<{ label: string }>, summary: string }|null} now
     * @param {{ text: string }} thread
     * @param {readonly object[]} recent
     * @return {string}
     */
    suggestInput(now, thread, recent) {
        const settings = ScribeMuse.Settings;
        const headings = settings.Headings;
        let scene = settings.Unknown;
        if (now !== null) {
            const labels = now.present.map(
                /**
                 * @param {{ label: string }} person
                 * @return {string}
                 */
                (person) => ScribeIntake.collapse(person.label),
            );
            scene = [
                settings.Day + now.day,
                ScribeIntake.collapse(now.place),
                now.reach.toLowerCase(),
                settings.Present + (labels.length === 0 ? settings.Nobody : labels.join(settings.Comma)),
                ScribeIntake.collapse(now.summary),
            ].join(settings.Joiner);
        }
        return [
            headings.Scene + settings.Newline + scene,
            headings.Thread + settings.Newline + thread.text,
            headings.Recent + settings.Newline + ScribeIntake.transcript(recent.slice(-settings.Recent)),
        ].join(settings.BlankLine);
    },

    /**
     * @param {*} text
     * @return {string|null}
     */
    line(text) {
        const settings = ScribeMuse.Settings;
        if (typeof text !== 'string') {
            return null;
        }
        const lines = text.split(settings.LineBreak).map(
            /**
             * @param {string} raw
             * @return {string}
             */
            (raw) => raw.replace(settings.FormatCharacter, settings.Nothing).trim(),
        );
        const marked = [];
        for (const [index, candidate] of lines.entries()) {
            const found = candidate.match(settings.MarkedLine);
            if (found !== null) {
                marked.push({ index, content: found[settings.ContentGroup] });
            }
        }
        if (marked.length !== settings.OneMarked) {
            return null;
        }
        const following = lines[marked[settings.FirstEntry].index + 1];
        if (following !== undefined && following !== settings.Nothing) {
            return null;
        }
        let kept = marked[settings.FirstEntry].content
            .normalize(settings.NormalForm)
            .replace(settings.Ignorable, settings.Nothing);
        let changed = true;
        while (changed) {
            const before = kept;
            kept = kept
                .trim()
                .replace(settings.DressStart, settings.Nothing)
                .replace(settings.DressEnd, settings.Nothing)
                .trim();
            const points = Array.from(kept);
            const first = points[settings.FirstEntry];
            const last = points.at(-1);
            const inner = points.slice(1, -1).join(settings.Nothing);
            const wrapped =
                points.length >= 2 &&
                ((settings.QuoteMark.test(first) && settings.QuoteMark.test(last)) ||
                    settings.Brackets.some(
                        /**
                         * @param {string} pair
                         * @return {boolean}
                         */
                        (pair) => first === pair[0] && last === pair[1],
                    ));
            if (wrapped && !inner.includes(first) && !inner.includes(last)) {
                kept = inner.trim();
            }
            changed = kept !== before;
        }
        kept = ScribeIntake.collapse(kept);
        const label = kept.replace(settings.DressMarks, settings.Nothing).match(settings.LabelInside);
        const refused =
            !settings.Letters.test(kept) ||
            settings.NoneAnswer.test(kept) ||
            kept.toLowerCase().includes(settings.ScribeStart) ||
            kept.includes(settings.Marker) ||
            (label !== null && Array.from(label[settings.FirstEntry]).length <= settings.LabelReach) ||
            settings.Refusal.test(kept) ||
            ScribeText.bytes(kept) > settings.LineBytes;
        return refused ? null : kept;
    },

    /**
     * @param {{ state: object, now: object|null, recent: readonly object[], exclude: readonly string[], ask: function(string, string): Promise<{ text: string }> }} request
     * @return {Promise<Readonly<{ thread: string, text: string }>|null>}
     */
    async suggest({ state, now, recent, exclude, ask }) {
        const chosen = ScribeMuse.thread(state, now, exclude);
        if (chosen === null) {
            return null;
        }
        let answer;
        try {
            answer = (await ask(ScribeMuse.SuggestPrompt, ScribeMuse.suggestInput(now, chosen, recent))).text;
        } catch {
            answer = null;
        }
        const text = ScribeMuse.line(answer);
        return text === null ? null : Object.freeze({ thread: chosen.id, text });
    },

    /**
     * @param {{ state: object, player: string, words: string, anchor: { id: string, position: number }|null, ask: function(string, string): Promise<{ text: string }> }} request
     * @return {Promise<Readonly<{ operations: readonly object[], refused: readonly object[] }>|null>}
     */
    async tell({ state, player, words, anchor, ask }) {
        const settings = ScribeMuse.Settings;
        const note = Array.from(
            ScribeIntake.collapse(
                words
                    .replace(settings.FormatCharacter, settings.Nothing)
                    .replace(settings.Controls, settings.Space)
                    .trim()
                    .replace(settings.LeadingCitation, settings.Nothing),
            ),
        )
            .slice(settings.FirstEntry, settings.WordsLimit)
            .join(settings.Nothing)
            .trim();
        if (note === settings.Nothing || anchor === null) {
            return null;
        }
        let answer;
        try {
            const notes = [{ text: note, position: anchor.position }];
            answer = (await ask(ScribeAnalyzer.NotesPrompt, ScribeAnalyzer.notesInput(state, player, notes))).text;
        } catch {
            answer = null;
        }
        const parsed = ScribeAnswer.parse(typeof answer === 'string' ? answer : settings.Nothing);
        const operations = [];
        const refused = [...parsed.refused];
        for (const operation of parsed.operations) {
            if (!settings.Filed.includes(operation.type)) {
                refused.push(Object.freeze({ operation, reason: settings.Reasons.NotFromANote }));
            } else if (operation.type !== ScribeAnswer.Type.Subject && operation.position !== anchor.position) {
                refused.push(Object.freeze({ operation, reason: settings.Reasons.WrongPosition }));
            } else {
                operations.push(operation);
            }
        }
        return Object.freeze({ operations: Object.freeze(operations), refused: Object.freeze(refused) });
    },

    /**
     * @param {*} text
     * @param {number} limit
     * @return {string}
     */
    clean(text, limit) {
        const settings = ScribeMuse.Settings;
        const flat = ScribeIntake.collapse(
            String(text).replace(settings.Controls, settings.Space).replace(settings.FormatCharacter, settings.Nothing),
        );
        const points = Array.from(flat);
        if (points.length <= limit) {
            return flat;
        }
        return points.slice(settings.FirstEntry, limit - settings.Cut.length).join(settings.Nothing) + settings.Cut;
    },

    /**
     * @param {ReadonlyMap<string, string>} labels
     * @param {object} fact
     * @return {string}
     */
    describeFact(labels, fact) {
        const settings = ScribeMuse.Settings;
        const label = ScribeMuse.quote(labels.get(fact.subject), settings.LabelLimit);
        const text = settings.Colon + ScribeMuse.quote(fact.text, settings.TextLimit);
        if (fact.category !== ScribeCategory.Settings.RelationCategory) {
            return label + settings.Comma + ScribeMuse.clean(fact.category, settings.LabelLimit) + text;
        }
        const target = fact.target === null ? fact.targetText : labels.get(fact.target);
        return label + settings.Toward + ScribeMuse.quote(target, settings.LabelLimit) + text;
    },

    /**
     * @param {*} text
     * @param {number} limit
     * @return {string}
     */
    quote(text, limit) {
        const settings = ScribeMuse.Settings;
        const inside = ScribeMuse.clean(text, limit).replace(settings.QuoteMarks, settings.Apostrophe);
        return settings.Quote + inside + settings.Quote;
    },

    /**
     * @param {object} entry
     * @param {readonly string[]} omitted
     * @return {string}
     */
    serial(entry, omitted) {
        const settings = ScribeMuse.Settings;
        const kept = {};
        for (const key of Object.keys(entry)) {
            if (!omitted.includes(key)) {
                kept[key] = entry[key];
            }
        }
        return JSON.stringify(
            kept,
            /**
             * @param {string} key
             * @param {*} value
             * @return {*}
             */
            (key, value) => {
                const tag = Object.prototype.toString.call(value);
                if (tag === settings.MapTag || tag === settings.SetTag) {
                    return Array.from(
                        value,
                        /**
                         * @param {*} item
                         * @return {string}
                         */
                        (item) => JSON.stringify(item),
                    ).sort();
                }
                return value;
            },
        );
    },

    /**
     * @param {object} before
     * @param {object} after
     * @return {readonly string[]}
     */
    changes(before, after) {
        const settings = ScribeMuse.Settings;
        const status = ScribeReplay.Status;
        const lines = [];
        const labelOf = new Map();
        const subjects = new Map();
        const facts = new Map();
        const threads = new Map();
        const conflicts = new Map();
        for (const subject of before.subjects) {
            subjects.set(subject.id, subject);
            labelOf.set(subject.id, subject.label);
        }
        for (const subject of after.subjects) {
            labelOf.set(subject.id, subject.label);
        }
        const kept = new Map();
        for (const subject of after.subjects) {
            kept.set(subject.id, subject);
        }
        for (const fact of before.facts) {
            facts.set(fact.id, fact);
        }
        const finals = new Map();
        for (const fact of after.facts) {
            finals.set(fact.id, fact);
        }
        for (const thread of before.threads) {
            threads.set(thread.id, thread);
        }
        /**
         * @param {{ subject: string, category: string }} conflict
         * @return {string}
         */
        const conflictKey = (conflict) => JSON.stringify([conflict.subject, conflict.category]);
        for (const conflict of before.conflicts) {
            conflicts.set(conflictKey(conflict), conflict);
        }
        /**
         * @param {string} text
         * @return {string}
         */
        const label = (text) => ScribeMuse.clean(text, settings.LabelLimit);
        /**
         * @param {string} text
         * @return {string}
         */
        const book = (text) => ScribeMuse.quote(text, settings.LabelLimit);
        /**
         * @param {{ hidden: boolean }} fact
         * @return {string}
         */
        const mark = (fact) => (fact.hidden ? settings.HiddenMark : settings.NotHiddenMark);
        const named = new Set();
        /**
         * @param {string} subject
         * @param {string} name
         * @return {string}
         */
        const nameKey = (subject, name) => subject + settings.NameKey + ScribeText.normaliseName(name);
        for (const subject of after.subjects) {
            if (!subjects.has(subject.id)) {
                lines.push(settings.NewSubject + label(subject.kind) + settings.Colon + book(subject.label));
                const own = [ScribeText.normaliseName(subject.label), ScribeText.normaliseName(subject.name)];
                for (const name of subject.aka) {
                    if (!own.includes(ScribeText.normaliseName(name))) {
                        named.add(nameKey(subject.id, name));
                        lines.push(settings.AnotherName + book(subject.label) + settings.Colon + book(name));
                    }
                }
            }
        }
        for (const subject of after.subjects) {
            const earlier = subjects.get(subject.id);
            if (earlier !== undefined && earlier.kind !== subject.kind) {
                lines.push(settings.BecomesA + label(subject.kind) + settings.Colon + book(subject.label));
            }
        }
        for (const subject of after.subjects) {
            const earlier = subjects.get(subject.id);
            if (earlier !== undefined && earlier.label !== subject.label) {
                lines.push(settings.Renamed + book(earlier.label) + settings.IsNow + book(subject.label));
            }
        }
        for (const subject of after.subjects) {
            const earlier = subjects.get(subject.id);
            if (earlier === undefined) {
                continue;
            }
            for (const name of subject.aka) {
                if (!earlier.aka.includes(name)) {
                    named.add(nameKey(subject.id, name));
                    lines.push(settings.AnotherName + book(subject.label) + settings.Colon + book(name));
                }
            }
            for (const name of earlier.aka) {
                if (!subject.aka.includes(name)) {
                    named.add(nameKey(subject.id, name));
                    lines.push(settings.NoLongerName + book(subject.label) + settings.Colon + book(name));
                }
            }
        }
        for (const subject of before.subjects) {
            if (!kept.has(subject.id)) {
                lines.push(settings.Leaves + book(subject.label));
            }
        }
        for (const subject of after.subjects) {
            const earlier = subjects.get(subject.id);
            const differs =
                earlier !== undefined &&
                ScribeMuse.serial(earlier, settings.SubjectCovered) !== ScribeMuse.serial(subject, settings.SubjectCovered);
            if (differs) {
                lines.push(settings.SubjectElse + book(subject.label));
            }
        }
        for (const fact of after.facts) {
            if (facts.has(fact.id)) {
                continue;
            }
            const said = settings.FactEnd + ScribeMuse.describeFact(labelOf, fact);
            const pinned = fact.made || fact.pinned ? settings.PinnedMark : settings.Nothing;
            lines.push(
                fact.status === status.InForce
                    ? mark(fact) + settings.NewFact + pinned + said
                    : mark(fact) +
                          settings.NewNotInForce +
                          label(fact.status) +
                          settings.NotInForceClose +
                          pinned +
                          said,
            );
        }
        for (const fact of before.facts) {
            if (!finals.has(fact.id)) {
                lines.push(mark(fact) + settings.RemovedFact + ScribeMuse.describeFact(labelOf, fact));
            }
        }
        for (const fact of after.facts) {
            const earlier = facts.get(fact.id);
            if (earlier !== undefined && earlier.status !== fact.status) {
                lines.push(
                    mark(fact) +
                        settings.WasStatus +
                        label(earlier.status) +
                        settings.BecomesStatus +
                        label(fact.status) +
                        settings.Colon +
                        ScribeMuse.describeFact(labelOf, fact),
                );
                const reason = fact.status === settings.EndedStatus && fact.ended ? fact.ended.reason : settings.Nothing;
                if (ScribeMuse.clean(reason, settings.TextLimit) !== settings.Nothing) {
                    lines.push(
                        mark(fact) +
                            settings.ReasonGiven +
                            ScribeMuse.describeFact(labelOf, fact) +
                            settings.Colon +
                            ScribeMuse.quote(reason, settings.TextLimit),
                    );
                }
            }
        }
        for (const fact of after.facts) {
            const earlier = facts.get(fact.id);
            if (earlier !== undefined && earlier.hidden !== fact.hidden) {
                lines.push(
                    (earlier.hidden ? settings.HiddenToOpen : settings.OpenToHidden) +
                        ScribeMuse.describeFact(labelOf, fact),
                );
            }
        }
        for (const fact of after.facts) {
            const earlier = facts.get(fact.id);
            const differs =
                earlier !== undefined &&
                JSON.stringify([earlier.told, earlier.widened]) !== JSON.stringify([fact.told, fact.widened]);
            if (differs) {
                lines.push(mark(fact) + settings.WhoKnows + ScribeMuse.describeFact(labelOf, fact));
            }
        }
        for (const fact of after.facts) {
            const earlier = facts.get(fact.id);
            if (earlier === undefined) {
                continue;
            }
            const omitted =
                earlier.status === fact.status ? settings.FactCovered : [...settings.FactCovered, ...settings.FactLinks];
            const members = Object.keys(fact).filter(
                /**
                 * @param {string} member
                 * @return {boolean}
                 */
                (member) =>
                    !omitted.includes(member) &&
                    ScribeMuse.serial({ member: earlier[member] }, []) !== ScribeMuse.serial({ member: fact[member] }, []),
            );
            if (members.length > 0) {
                lines.push(
                    mark(fact) +
                        settings.FactAlso +
                        members.join(settings.Comma) +
                        settings.FactAlsoClose +
                        ScribeMuse.describeFact(labelOf, fact),
                );
            }
        }
        const present = new Set();
        for (const conflict of after.conflicts) {
            present.add(conflictKey(conflict));
            const earlier = conflicts.get(conflictKey(conflict));
            const said = book(labelOf.get(conflict.subject)) + settings.Comma + label(conflict.category);
            if (earlier === undefined) {
                lines.push(settings.Conflict + said);
            } else if (ScribeMuse.serial(earlier, []) !== ScribeMuse.serial(conflict, [])) {
                lines.push(settings.ConflictChanges + said);
            }
        }
        for (const conflict of before.conflicts) {
            if (!present.has(conflictKey(conflict))) {
                lines.push(
                    settings.Settled + book(labelOf.get(conflict.subject)) + settings.Comma + label(conflict.category),
                );
            }
        }
        /**
         * @param {{ text: string }} thread
         * @return {string}
         */
        const text = (thread) => ScribeMuse.quote(thread.text, settings.TextLimit);
        const remaining = new Set();
        for (const thread of after.threads) {
            remaining.add(thread.id);
            const earlier = threads.get(thread.id);
            if (earlier === undefined) {
                lines.push((thread.closed === null ? settings.OpenThread : settings.ClosedNew) + text(thread));
            } else if (earlier.closed === null && thread.closed !== null) {
                lines.push(settings.ThreadClosed + text(thread));
            } else if (earlier.closed !== null && thread.closed === null) {
                lines.push(settings.ThreadReopened + text(thread));
            } else if (ScribeMuse.serial(earlier, []) !== ScribeMuse.serial(thread, [])) {
                lines.push(settings.ThreadChanges + text(thread));
            }
        }
        for (const thread of before.threads) {
            if (!remaining.has(thread.id)) {
                lines.push(settings.ThreadRemoved + text(thread));
            }
        }
        /**
         * @param {{ first: string, second: string }} pair
         * @return {string}
         */
        const pairKey = (pair) => JSON.stringify([pair.first, pair.second]);
        /**
         * @param {{ first: string, second: string }} pair
         * @return {string}
         */
        const pairText = (pair) => book(labelOf.get(pair.first)) + settings.And + book(labelOf.get(pair.second));
        const pairs = new Map();
        for (const pair of before.lookAlikes) {
            pairs.set(pairKey(pair), pair);
        }
        const standing = new Set();
        for (const pair of after.lookAlikes) {
            standing.add(pairKey(pair));
            const earlier = pairs.get(pairKey(pair));
            if (earlier === undefined) {
                lines.push(settings.LookAlike + pairText(pair));
            } else if (ScribeMuse.serial(earlier, []) !== ScribeMuse.serial(pair, [])) {
                lines.push(settings.LookChanges + pairText(pair));
            }
        }
        for (const pair of before.lookAlikes) {
            if (!standing.has(pairKey(pair))) {
                lines.push(settings.LookSettled + pairText(pair));
            }
        }
        for (const member of Object.keys(after)) {
            if (settings.Covered.includes(member) ||
                ScribeMuse.serial({ member: before[member] }, []) === ScribeMuse.serial({ member: after[member] }, [])) {
                continue;
            }
            let said = false;
            if (member === settings.AliasMember) {
                const known = new Set();
                const final = new Set();
                for (const entry of before[member]) {
                    known.add(JSON.stringify(entry));
                }
                for (const entry of after[member]) {
                    final.add(JSON.stringify(entry));
                }
                const moved = [
                    ...after[member].filter(
                        /**
                         * @param {object} entry
                         * @return {boolean}
                         */
                        (entry) => !known.has(JSON.stringify(entry)),
                    ),
                    ...before[member].filter(
                        /**
                         * @param {object} entry
                         * @return {boolean}
                         */
                        (entry) => !final.has(JSON.stringify(entry)),
                    ),
                ];
                said = moved.every(
                    /**
                     * @param {{ subject: string, name: string }} entry
                     * @return {boolean}
                     */
                    (entry) => named.has(nameKey(entry.subject, entry.name)),
                );
            }
            if (!said) {
                lines.push(settings.BookElse + label(member));
            }
        }
        return Object.freeze(lines.length === 0 ? [settings.NothingChanges] : lines);
    },
});
