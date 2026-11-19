const ScribeAnswer = Object.freeze({
    Reason: Object.freeze({
        Shape: 'Shape',
        Category: 'Category',
        Citation: 'Citation',
        Name: 'Name',
    }),

    Type: Object.freeze({
        Subject: 'Subject',
        Alias: 'Alias',
        Fact: 'Fact',
        Change: 'Change',
        Refine: 'Refine',
        End: 'End',
        Told: 'Told',
        Scene: 'Scene',
        Night: 'Night',
        ThreadOpen: 'ThreadOpen',
        ThreadClose: 'ThreadClose',
        Question: 'Question',
        Contradiction: 'Contradiction',
    }),

    Reach: Object.freeze({
        Public: 'Public',
        Private: 'Private',
    }),

    Blocks: Object.freeze([
        'SUBJECTS',
        'NAMES',
        'FACTS',
        'CHANGES',
        'TOLD',
        'SCENES',
        'NIGHTS',
        'THREADS',
        'QUESTIONS',
        'CONTRADICTIONS',
    ]),

    Settings: Object.freeze({
        Preamble: 'PREAMBLE',
        Unknown: 'UNKNOWN',
        Nights: 'NIGHTS',
        Nothing: '',
        Pipe: '|',
        Joiner: ' | ',
        Comma: ',',
        Colon: ':',
        OpenBracket: '(',
        CloseBracket: ')',
        FromWord: 'from',
        EndedWord: 'ended',
        FullerWord: 'fuller',
        NarratorName: 'narrator',
        HiddenWord: 'hidden',
        LabelEdges: '*_`',
        LabelStart: '*_`-–—+•·> ',
        MarkerWrappers: '*_`])',
        MarkerLeaders: ' :|-–—.;*_`])"',
        MarkerTrailers: '*_`"',
        BoldInner: '$1',
        NotFound: -1,
        MinPosition: 1,
        MaxLabel: 60,
        SecondField: 1,
        ThirdField: 2,
        StatementStart: 3,
        SummaryStart: 5,
        Last: -1,
        SubjectFields: 2,
        NameFields: 3,
        FactFields: 3,
        ChangeFields: 5,
        ToldFields: 4,
        SceneFields: 6,
        NightFields: 2,
        ThreadFields: 3,
        CloseOnlyFields: 2,
        QuestionFields: 2,
        ContradictionFields: 3,

        /**
         * @return {RegExp}
         */
        get LineBreak() {
            return /\r\n|\n|\r/;
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
        get ListMarkers() {
            return /^(?:(?:[-*+•>]|\d+[.)]) )+/;
        },

        /**
         * @return {RegExp}
         */
        get Bold() {
            return /^\*\*([\s\S]*)\*\*$/;
        },

        /**
         * @return {RegExp}
         */
        get Fence() {
            return /^```\w*$/;
        },

        /**
         * @return {RegExp}
         */
        get NoneLine() {
            return /^(?:none|\(none|no new|nothing)(?!\p{L})/iu;
        },

        /**
         * @return {RegExp}
         */
        get HashDigit() {
            return /#\d/;
        },

        /**
         * @return {RegExp}
         */
        get LeadingHashDigit() {
            return /^(?:#|\[#|\(#)\d/;
        },

        /**
         * @return {RegExp}
         */
        get NonAlphanumerics() {
            return /[^\p{L}\p{N}]/gu;
        },

        /**
         * @return {RegExp}
         */
        get Bracketed() {
            return /^\[([\s\S]*)\]$/;
        },

        /**
         * @return {RegExp}
         */
        get CitationSeparator() {
            return /,\s*and\b|,|\band\b/i;
        },

        /**
         * @return {RegExp}
         */
        get CitationItem() {
            return /^#(\d+)(?:\s*[-‐–—−]\s*#?(\d+))?$/;
        },

        /**
         * @return {RegExp}
         */
        get HasContent() {
            return /[\p{L}\p{N}]/u;
        },

        /**
         * @return {RegExp}
         */
        get FactId() {
            return /^F\d+$/i;
        },

        /**
         * @return {RegExp}
         */
        get MarkerWord() {
            return /^[^\p{L}\p{N}]*(\p{L}+)(?![\p{L}\p{N}])/u;
        },

        /**
         * @return {RegExp}
         */
        get GluedHeader() {
            return /^[^\p{L}]*(\p{L}+)(?![\p{L}\p{N}])/u;
        },

        /**
         * @return {RegExp}
         */
        get EntrySplitters() {
            return /\band\b|[&;]/i;
        },

        /**
         * @return {RegExp}
         */
        get UnmarkedBound() {
            return /\(\s*(?:from|until)\b[^()\d]*\d[^()]*\)/i;
        },

        /**
         * @return {RegExp}
         */
        get DayField() {
            return /^day\s+(\d+)$/i;
        },

        /**
         * @return {RegExp}
         */
        get PresentField() {
            return /^present:([\s\S]*)$/i;
        },

        /**
         * @return {RegExp}
         */
        get EmptyAttendance() {
            return /^(?:|none|nobody|noone)$/;
        },

        /**
         * @return {RegExp}
         */
        get BoundBoth() {
            return /\(\s*from\s+#(\d+)(?:\s*,)?\s*until\s+#(\d+)\s*\)$/i;
        },

        /**
         * @return {RegExp}
         */
        get BoundOne() {
            return /\(\s*(from|until)\s+#(\d+)\s*\)$/i;
        },

        /**
         * @return {RegExp}
         */
        get OpenThread() {
            return /^open$/i;
        },

        /**
         * @return {RegExp}
         */
        get CloseThread() {
            return /^close\s+(T\d+)$/i;
        },

        /**
         * @return {RegExp}
         */
        get QuotedCitation() {
            return /^([^\s"“”]*)\s*["“”]([\s\S]*)["“”]$/u;
        },

        /**
         * @return {RegExp}
         */
        get CitedNumber() {
            return /^#(\d+)$/;
        },

        /**
         * @return {RegExp}
         */
        get EntryId() {
            return /^(?:#\d+\s+)?["'“”‘’]?([FT]\d+)\.?["'“”‘’]?\.?(?:\s*\(\s*#\d+\s*\))?$/i;
        },
    }),

    /**
     * @param {string} digits
     * @return {number|null}
     */
    positiveInteger(digits) {
        const number = Number(digits);
        if (!Number.isSafeInteger(number) || number < ScribeAnswer.Settings.MinPosition) {
            return null;
        }
        return number;
    },

    /**
     * @param {string} field
     * @return {Readonly<{ first: number, last: number, count: number }>|null}
     */
    citation(field) {
        const settings = ScribeAnswer.Settings;
        const wrapped = field.match(settings.Bracketed);
        const attempts = wrapped === null ? [[field, true]] : [[field, true], [wrapped[1], false]];
        for (const [body, itemBrackets] of attempts) {
            const items = body.split(settings.CitationSeparator);
            let head = null;
            let valid = true;
            for (const item of items) {
                const trimmed = item.trim();
                const own = itemBrackets ? trimmed.match(settings.Bracketed) : null;
                const match = (own === null ? trimmed : own[1].trim()).match(settings.CitationItem);
                if (match === null) {
                    valid = false;
                    break;
                }
                const first = ScribeAnswer.positiveInteger(match[1]);
                const last = match[2] === undefined ? first : ScribeAnswer.positiveInteger(match[2]);
                if (first === null || last === null || last < first) {
                    valid = false;
                    break;
                }
                if (head === null) {
                    head = { first, last };
                }
            }
            if (valid) {
                return Object.freeze({ first: head.first, last: head.last, count: items.length });
            }
        }
        return null;
    },

    /**
     * @param {string} text
     * @return {string}
     */
    bare(text) {
        return text.replace(ScribeAnswer.Settings.NonAlphanumerics, ScribeAnswer.Settings.Nothing).toLowerCase();
    },

    /**
     * @param {string} raw
     * @return {string|null}
     */
    label(raw) {
        const settings = ScribeAnswer.Settings;
        const trimmed = raw.trim();
        let start = 0;
        let end = trimmed.length;
        while (start < end && settings.LabelStart.includes(trimmed[start])) {
            start++;
        }
        while (end > start && settings.LabelEdges.includes(trimmed[end - 1])) {
            end--;
        }
        const label = trimmed.slice(start, end).trim();
        if (label.length > settings.MaxLabel) {
            return null;
        }
        const name = ScribeText.normaliseName(label);
        if (!settings.HasContent.test(name) || name === settings.NarratorName) {
            return null;
        }
        return label;
    },

    /**
     * @param {string[]} fields
     * @return {string|null}
     */
    text(fields) {
        const settings = ScribeAnswer.Settings;
        const unusable = fields.some(
            /**
             * @param {string} field
             * @param {number} index
             * @return {boolean}
             */
            (field, index) =>
                !settings.HasContent.test(field) ||
                ScribeAnswer.bare(field) === settings.HiddenWord ||
                (index > 0 && settings.LeadingHashDigit.test(field)),
        );
        if (fields.length === 0 || unusable) {
            return null;
        }
        return fields.join(settings.Joiner);
    },

    Readers: Object.freeze({
        /**
         * @param {string[]} fields
         * @return {object|string}
         */
        SUBJECTS(fields) {
            const settings = ScribeAnswer.Settings;
            const reasons = ScribeAnswer.Reason;
            if (fields.length !== settings.SubjectFields) {
                return reasons.Shape;
            }
            const [labelField, kindField] = fields;
            const kind = Object.values(ScribeCategory.SubjectKinds).find(
                /**
                 * @param {string} value
                 * @return {boolean}
                 */
                (value) => value === kindField.toLowerCase(),
            );
            if (kind === undefined) {
                return reasons.Shape;
            }
            const label = ScribeAnswer.label(labelField);
            if (label === null) {
                return reasons.Name;
            }
            return Object.freeze({ type: ScribeAnswer.Type.Subject, label, kind });
        },

        /**
         * @param {string[]} fields
         * @return {object|string}
         */
        NAMES(fields) {
            const settings = ScribeAnswer.Settings;
            const reasons = ScribeAnswer.Reason;
            if (fields.length !== settings.NameFields) {
                return reasons.Shape;
            }
            const [nameField, labelField, citationField] = fields;
            const name = ScribeAnswer.label(nameField);
            const label = ScribeAnswer.label(labelField);
            if (name === null || label === null) {
                return reasons.Name;
            }
            const cited = ScribeAnswer.citation(citationField);
            if (cited === null) {
                return reasons.Citation;
            }
            return Object.freeze({ type: ScribeAnswer.Type.Alias, name, label, position: cited.first });
        },

        /**
         * @param {string[]} fields
         * @return {object|string}
         */
        FACTS(fields) {
            const settings = ScribeAnswer.Settings;
            const reasons = ScribeAnswer.Reason;
            const hiddenAfter = ScribeAnswer.bare(fields.at(settings.Last)) === settings.HiddenWord;
            const withoutTail = hiddenAfter ? fields.slice(0, settings.Last) : fields;
            const citationField = withoutTail.at(settings.Last);
            const body = withoutTail.slice(0, settings.Last);
            const hiddenBefore = body.length > 0 && ScribeAnswer.bare(body.at(settings.Last)) === settings.HiddenWord;
            const core = hiddenBefore ? body.slice(0, settings.Last) : body;
            if (core.length < settings.FactFields) {
                return reasons.Shape;
            }
            const [labelField, categoryField] = core;
            const text = ScribeAnswer.text(core.slice(settings.ThirdField));
            if (text === null) {
                return reasons.Shape;
            }
            const label = ScribeAnswer.label(labelField);
            if (label === null) {
                return reasons.Name;
            }
            const parsed = ScribeCategory.parse(categoryField);
            if (parsed === null) {
                return reasons.Category;
            }
            const cited = ScribeAnswer.citation(citationField);
            if (cited === null) {
                return reasons.Citation;
            }
            return Object.freeze({
                type: ScribeAnswer.Type.Fact,
                label,
                category: parsed.category,
                target: parsed.target,
                text,
                position: cited.first,
                hidden: hiddenAfter || hiddenBefore,
            });
        },

        /**
         * @param {string[]} fields
         * @return {object|string}
         */
        CHANGES(fields) {
            const settings = ScribeAnswer.Settings;
            const reasons = ScribeAnswer.Reason;
            const types = ScribeAnswer.Type;
            if (fields.length < settings.ChangeFields || !settings.FactId.test(fields[0])) {
                return reasons.Shape;
            }
            const statement = ScribeAnswer.text(fields.slice(settings.StatementStart, settings.Last));
            if (statement === null) {
                return reasons.Shape;
            }
            const word = statement.match(settings.MarkerWord);
            const lower = word === null ? settings.Nothing : word[1].toLowerCase();
            const marked = lower === settings.EndedWord || lower === settings.FullerWord;
            let hasMarker = false;
            if (marked) {
                let after = word[0].length;
                while (after < statement.length && settings.MarkerWrappers.includes(statement[after])) {
                    after++;
                }
                hasMarker = word[1] === word[1].toUpperCase() || statement[after] === settings.Colon;
                if (!hasMarker) {
                    return reasons.Shape;
                }
            }
            let rest = settings.Nothing;
            if (hasMarker) {
                let start = word[0].length;
                let end = statement.length;
                while (start < end && settings.MarkerLeaders.includes(statement[start])) {
                    start++;
                }
                while (end > start && settings.MarkerTrailers.includes(statement[end - 1])) {
                    end--;
                }
                rest = statement.slice(start, end).trim();
                const hollow = rest !== settings.Nothing && !settings.HasContent.test(rest);
                if (hollow || (lower === settings.FullerWord && rest === settings.Nothing)) {
                    return reasons.Shape;
                }
            }
            const label = ScribeAnswer.label(fields[settings.SecondField]);
            if (label === null) {
                return reasons.Name;
            }
            const parsed = ScribeCategory.parse(fields[settings.ThirdField]);
            if (parsed === null) {
                return reasons.Category;
            }
            const cited = ScribeAnswer.citation(fields.at(settings.Last));
            if (cited === null) {
                return reasons.Citation;
            }
            const named = {
                fact: fields[0].toUpperCase(),
                label,
                category: parsed.category,
                target: parsed.target,
            };
            if (hasMarker && lower === settings.EndedWord) {
                return Object.freeze({ type: types.End, ...named, reason: rest, position: cited.first });
            }
            if (hasMarker) {
                return Object.freeze({ type: types.Refine, ...named, text: rest, position: cited.first });
            }
            return Object.freeze({ type: types.Change, ...named, text: statement, position: cited.first });
        },

        /**
         * @param {string[]} fields
         * @return {object|string}
         */
        TOLD(fields) {
            const settings = ScribeAnswer.Settings;
            const reasons = ScribeAnswer.Reason;
            if (fields.length !== settings.ToldFields || !settings.FactId.test(fields[0])) {
                return reasons.Shape;
            }
            const [fact, ownerField, labelField, citationField] = fields;
            const owner = ScribeAnswer.label(ownerField);
            const label = ScribeAnswer.label(labelField);
            if (owner === null || label === null) {
                return reasons.Name;
            }
            const cited = ScribeAnswer.citation(citationField);
            if (cited === null) {
                return reasons.Citation;
            }
            return Object.freeze({
                type: ScribeAnswer.Type.Told,
                fact: fact.toUpperCase(),
                owner,
                label,
                position: cited.first,
            });
        },

        /**
         * @param {string[]} fields
         * @return {object|string}
         */
        SCENES(fields) {
            const settings = ScribeAnswer.Settings;
            const reasons = ScribeAnswer.Reason;
            if (fields.length < settings.SceneFields) {
                return reasons.Shape;
            }
            const [dayField, spanField, place, reachField, presentField] = fields;
            const dayMatch = dayField.match(settings.DayField);
            const day = dayMatch === null ? null : ScribeAnswer.positiveInteger(dayMatch[1]);
            const reach = Object.values(ScribeAnswer.Reach).find(
                /**
                 * @param {string} value
                 * @return {boolean}
                 */
                (value) => value.toLowerCase() === reachField.toLowerCase(),
            );
            const presentMatch = presentField.match(settings.PresentField);
            const summary = ScribeAnswer.text(fields.slice(settings.SummaryStart));
            if (
                day === null ||
                place === settings.Nothing ||
                reach === undefined ||
                presentMatch === null ||
                summary === null
            ) {
                return reasons.Shape;
            }
            const attendance = presentMatch[1].trim();
            const entries = [];
            if (!settings.EmptyAttendance.test(ScribeAnswer.bare(attendance))) {
                const pieces = [];
                let depth = 0;
                let piece = settings.Nothing;
                let outside = settings.Nothing;
                for (const character of attendance) {
                    if (character === settings.OpenBracket) {
                        depth++;
                    } else if (character === settings.CloseBracket) {
                        depth--;
                        if (depth < 0) {
                            return reasons.Shape;
                        }
                    }
                    if (character === settings.Comma && depth === 0) {
                        pieces.push({ piece, outside });
                        piece = settings.Nothing;
                        outside = settings.Nothing;
                    } else {
                        piece += character;
                        if (depth === 0 && character !== settings.CloseBracket) {
                            outside += character;
                        }
                    }
                }
                if (depth !== 0) {
                    return reasons.Shape;
                }
                pieces.push({ piece, outside });
                for (const entry of pieces) {
                    let rest = entry.piece.trim();
                    if (rest === settings.Nothing) {
                        continue;
                    }
                    if (settings.EntrySplitters.test(entry.outside)) {
                        return reasons.Shape;
                    }
                    let from = null;
                    let until = null;
                    let both = rest.match(settings.BoundBoth);
                    let one = both === null ? rest.match(settings.BoundOne) : null;
                    while (both !== null || one !== null) {
                        let found = null;
                        let newFrom = null;
                        let newUntil = null;
                        if (both !== null) {
                            found = both;
                            newFrom = ScribeAnswer.positiveInteger(both[1]);
                            newUntil = ScribeAnswer.positiveInteger(both[2]);
                            if (newFrom === null || newUntil === null) {
                                return reasons.Shape;
                            }
                        } else {
                            found = one;
                            const bound = ScribeAnswer.positiveInteger(one[2]);
                            if (bound === null) {
                                return reasons.Shape;
                            }
                            newFrom = one[1].toLowerCase() === settings.FromWord ? bound : null;
                            newUntil = newFrom === null ? bound : null;
                        }
                        if ((newFrom !== null && from !== null) || (newUntil !== null && until !== null)) {
                            return reasons.Shape;
                        }
                        from = newFrom ?? from;
                        until = newUntil ?? until;
                        rest = rest.slice(0, found.index).trim();
                        both = rest.match(settings.BoundBoth);
                        one = both === null ? rest.match(settings.BoundOne) : null;
                    }
                    const backwards = from !== null && until !== null && from > until;
                    if (backwards || settings.HashDigit.test(rest) || settings.UnmarkedBound.test(rest)) {
                        return reasons.Shape;
                    }
                    entries.push({ rest, from, until });
                }
            }
            const present = [];
            for (const { rest, from, until } of entries) {
                const label = ScribeAnswer.label(rest);
                if (label === null) {
                    return reasons.Name;
                }
                present.push(Object.freeze({ label, from, until }));
            }
            const cited = ScribeAnswer.citation(spanField);
            if (cited === null || cited.count !== 1) {
                return reasons.Citation;
            }
            return Object.freeze({
                type: ScribeAnswer.Type.Scene,
                day,
                first: cited.first,
                last: cited.last,
                place,
                reach,
                present: Object.freeze(present),
                summary,
            });
        },

        /**
         * @param {string[]} fields
         * @return {object|string}
         */
        NIGHTS(fields) {
            const settings = ScribeAnswer.Settings;
            const reasons = ScribeAnswer.Reason;
            if (fields.length < settings.NightFields) {
                return reasons.Shape;
            }
            const marker = ScribeAnswer.text(fields.slice(settings.SecondField));
            if (marker === null) {
                return reasons.Shape;
            }
            const cited = ScribeAnswer.citation(fields[0]);
            if (cited === null) {
                return reasons.Citation;
            }
            return Object.freeze({ type: ScribeAnswer.Type.Night, position: cited.first, marker });
        },

        /**
         * @param {string[]} fields
         * @return {object|string}
         */
        THREADS(fields) {
            const settings = ScribeAnswer.Settings;
            const reasons = ScribeAnswer.Reason;
            const opening = settings.OpenThread.test(fields[0]);
            const closing = fields[0].match(settings.CloseThread);
            const accountless = fields.length === settings.CloseOnlyFields && closing !== null;
            if (fields.length < settings.ThreadFields && !accountless) {
                return reasons.Shape;
            }
            const body = accountless
                ? settings.Nothing
                : ScribeAnswer.text(fields.slice(settings.SecondField, settings.Last));
            if ((!opening && closing === null) || body === null) {
                return reasons.Shape;
            }
            const cited = ScribeAnswer.citation(fields.at(settings.Last));
            if (cited === null) {
                return reasons.Citation;
            }
            if (opening) {
                return Object.freeze({ type: ScribeAnswer.Type.ThreadOpen, text: body, position: cited.first });
            }
            return Object.freeze({
                type: ScribeAnswer.Type.ThreadClose,
                thread: closing[1].toUpperCase(),
                how: body,
                position: cited.first,
            });
        },

        /**
         * @param {string[]} fields
         * @return {object|string}
         */
        QUESTIONS(fields) {
            const settings = ScribeAnswer.Settings;
            const reasons = ScribeAnswer.Reason;
            if (fields.length < settings.QuestionFields) {
                return reasons.Shape;
            }
            const text = ScribeAnswer.text(fields.slice(0, settings.Last));
            if (text === null) {
                return reasons.Shape;
            }
            const cited = ScribeAnswer.citation(fields.at(settings.Last));
            if (cited === null) {
                return reasons.Citation;
            }
            return Object.freeze({ type: ScribeAnswer.Type.Question, text, position: cited.first });
        },

        /**
         * @param {string[]} fields
         * @return {object|string}
         */
        CONTRADICTIONS(fields) {
            const settings = ScribeAnswer.Settings;
            const reasons = ScribeAnswer.Reason;
            if (fields.length !== settings.ContradictionFields) {
                return reasons.Shape;
            }
            const [saidField, beforeField, whyField] = fields;
            const saidMatch = saidField.match(settings.QuotedCitation);
            const named = beforeField.match(settings.EntryId);
            const entry = named === null ? null : named[1].toUpperCase();
            const beforeMatch = entry === null ? beforeField.match(settings.QuotedCitation) : null;
            const why = ScribeAnswer.text([whyField]);
            if (saidMatch === null || (entry === null && beforeMatch === null) || why === null) {
                return reasons.Shape;
            }
            const said = saidMatch[2].trim();
            const before = beforeMatch === null ? null : beforeMatch[2].trim();
            if (!settings.HasContent.test(said) || (before !== null && !settings.HasContent.test(before))) {
                return reasons.Shape;
            }
            const saidNumber = saidMatch[1].match(settings.CitedNumber);
            const position = saidNumber === null ? null : ScribeAnswer.positiveInteger(saidNumber[1]);
            if (position === null) {
                return reasons.Citation;
            }
            if (entry !== null) {
                return Object.freeze({
                    type: ScribeAnswer.Type.Contradiction,
                    position,
                    said,
                    earlier: null,
                    before: null,
                    entry,
                    why,
                });
            }
            const beforeNumber = beforeMatch[1].match(settings.CitedNumber);
            const earlier = beforeNumber === null ? null : ScribeAnswer.positiveInteger(beforeNumber[1]);
            if (earlier === null || earlier >= position) {
                return reasons.Citation;
            }
            const type = ScribeAnswer.Type.Contradiction;
            return Object.freeze({ type, position, said, earlier, before, entry, why });
        },
    }),

    /**
     * @param {string} text
     * @return {Readonly<{ operations: readonly object[], refused: ReadonlyArray<Readonly<{ block: string, line: string, reason: string }>> }>}
     */
    parse(text) {
        const settings = ScribeAnswer.Settings;
        const operations = [];
        const refused = [];
        let block = settings.Preamble;
        for (const raw of text.split(settings.LineBreak)) {
            const line = raw
                .replace(settings.FormatCharacter, settings.Nothing)
                .trim()
                .replace(settings.ListMarkers, settings.Nothing)
                .replace(settings.Bold, settings.BoldInner)
                .replace(settings.ListMarkers, settings.Nothing)
                .trim();
            const piped = line.includes(settings.Pipe);
            let fields = null;
            if (piped) {
                fields = line.split(settings.Pipe).map(
                    /**
                     * @param {string} field
                     * @return {string}
                     */
                    (field) => field.trim(),
                );
            } else if (block === settings.Nights) {
                const colon = line.indexOf(settings.Colon);
                const lead = line.slice(0, colon);
                const cited = colon === settings.NotFound ? null : ScribeAnswer.citation(lead);
                if (cited !== null && cited.count === 1 && lead === lead.trim()) {
                    fields = [lead, line.slice(colon + 1).trim()];
                }
            }
            let reason = null;
            let quarantine = false;
            if (fields === null) {
                const name = ScribeAnswer.bare(line).toUpperCase();
                if (ScribeAnswer.Blocks.includes(name)) {
                    block = name;
                    continue;
                }
                if (
                    line === settings.Nothing ||
                    settings.Fence.test(line) ||
                    (!settings.HashDigit.test(line) && settings.NoneLine.test(line))
                ) {
                    continue;
                }
                quarantine = true;
            } else {
                const glued = fields[0].match(settings.GluedHeader);
                quarantine = glued !== null && ScribeAnswer.Blocks.includes(glued[1]);
            }
            if (quarantine) {
                reason = ScribeAnswer.Reason.Shape;
                if (block !== settings.Preamble) {
                    block = settings.Unknown;
                }
            } else if (ScribeAnswer.Readers[block] === undefined) {
                reason = ScribeAnswer.Reason.Shape;
            } else {
                const result = ScribeAnswer.Readers[block](fields);
                if (typeof result === 'string') {
                    reason = result;
                } else {
                    operations.push(result);
                }
            }
            if (reason !== null) {
                refused.push(Object.freeze({ block, line, reason }));
            }
        }
        return Object.freeze({ operations: Object.freeze(operations), refused: Object.freeze(refused) });
    },
});
