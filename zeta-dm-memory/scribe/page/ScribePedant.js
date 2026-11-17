const ScribePedant = Object.freeze({
    Kind: Object.freeze({
        Spelling: 'Spelling',
        Contradiction: 'Contradiction',
        Leak: 'Leak',
    }),

    Block: Object.freeze({
        Contradictions: 'CONTRADICTIONS',
        Leaks: 'LEAKS',
    }),

    Settings: Object.freeze({
        Newline: '\n',
        BlankLine: '\n\n',
        Nothing: '',
        Space: ' ',
        Pipe: '|',
        Joiner: ' | ',
        Apostrophe: "'",
        Unquoted: '$1',
        Unwrapped: '$2',
        Hidden: ' (hidden)',
        RelationTo: 'relation to ',
        DoesNotKnow: ' does not know ',
        ReplyOpen: 'REPLY (#',
        ReplyClose: '):',
        TooLong: '(too long to show)',
        Headings: Object.freeze({
            Player: 'PLAYER CHARACTER:',
            Ledger: 'LEDGER:',
            Unknown: 'DOES NOT KNOW:',
            Since: 'SINCE THE BOOK WAS LAST READ:',
        }),
        MostWords: 120,
        UnreadCharacters: 60000,
        FindingsPerFact: 1,
        FindingsPerKind: 20,
        DressPasses: 4,
        EdgeWidth: 3,
        NormalForm: 'NFC',
        NotFound: -1,
        ShortestNameWord: 4,
        ContradictionFields: 4,
        LeakFields: 3,
        FactField: 0,
        LabelField: 1,
        CategoryField: 2,
        SaidStart: 3,
        SpeakerField: 1,
        WordsStart: 2,
        NumberGroup: 1,
        Finding: Object.freeze({
            kind: null,
            message: null,
            position: null,
            subject: null,
            label: null,
            fact: null,
            category: null,
            book: null,
            said: null,
            speaker: null,
            speakerLabel: null,
            written: null,
        }),

        /**
         * @return {RegExp}
         */
        get Word() {
            return /[\p{L}\p{M}]+(?:['’ʼ‐‑-][\p{L}\p{M}]+)*/gu;
        },

        /**
         * @return {RegExp}
         */
        get Capital() {
            return /^[\p{Lu}\p{Lt}]/u;
        },

        /**
         * @return {RegExp}
         */
        get Possessive() {
            return /['’ʼ]s$/iu;
        },

        /**
         * @return {RegExp}
         */
        get Plural() {
            return /s$/u;
        },

        /**
         * @return {RegExp}
         */
        get NonLetters() {
            return /[^\p{L}]/gu;
        },

        /**
         * @return {RegExp}
         */
        get NoneLine() {
            return /^\(?none/iu;
        },

        /**
         * @return {RegExp}
         */
        get TableEdges() {
            return /^\|\s*|\s*\|$/gu;
        },

        /**
         * @return {RegExp}
         */
        get IdDress() {
            return /[`\[\]*_]|:+(?=[`\[\]*_]*$)/gu;
        },

        /**
         * @return {RegExp}
         */
        get FactNumber() {
            return /^F0*(\d+)$/iu;
        },

        /**
         * @return {RegExp}
         */
        get Forbidden() {
            return /[|\[\]@\p{Zl}\p{Zp}\p{Cc}]/u;
        },

        /**
         * @return {RegExp}
         */
        get Tab() {
            return /\t/gu;
        },

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

        /**
         * @return {RegExp}
         */
        get Apostrophes() {
            return /[’‘ʼ]/gu;
        },

        /**
         * @return {RegExp}
         */
        get WordBefore() {
            return /(?:[\p{L}\p{N}\p{M}]|\p{L}['’])$/u;
        },

        /**
         * @return {RegExp}
         */
        get WordAfter() {
            return /^(?:[\p{L}\p{N}\p{M}]|['’]\p{L})/u;
        },

        PromptLines: Object.freeze([
            'You are the Pedant: a proofreader for an ongoing adult fiction roleplay between consenting adult characters. You never write story.',
            'You receive PLAYER CHARACTER, a LEDGER of established facts (each with an id like F12, its subject, its category and its text), a list of what certain speakers DO NOT KNOW, the messages SINCE THE BOOK WAS LAST READ, and one REPLY from the storyteller.',
            'Find where the REPLY disagrees with the LEDGER, and where a speaker uses something they do not know.',
            '',
            'Answer with these two blocks, each starting with its === line. Leave a block out if it has nothing. Write nothing else.',
            '',
            '=== CONTRADICTIONS',
            'F12 | Label | category | the words of the reply that say otherwise',
            '=== LEAKS',
            'F7 | Label of the speaker | the words of theirs that show they know it',
            '',
            'Rules.',
            "1. A contradiction is a statement in the REPLY, about the LEDGER fact's own subject, that cannot be true together with that fact: another age, number, colour, name, place or description of the same thing. Give the fact's id, its subject's label and its category exactly as the LEDGER shows them, and copy the reply's own words for the other value. Never report a fact marked (hidden) as contradicted.",
            '2. More detail about the same thing is not a contradiction. Less detail is not a contradiction. The same thing in other words is not a contradiction. Something the story has plainly changed (a move, a promotion, a wound), in the REPLY or in the messages since the book was last read, is not a contradiction.',
            "3. A leak is a line spoken by a speaker that states, uses or reacts to a fact listed for that speaker under DOES NOT KNOW. Copy the few words of that speaker's own line that show it, exactly as the REPLY has them. What the narrator says, or what another character says or thinks, is not that speaker's leak.",
            '4. It is not a leak if the speaker was told or shown the fact earlier in the REPLY, or anywhere in the messages since the book was last read.',
            '5. Report only what the REPLY itself shows. Never guess. When in doubt, leave it out.',
        ]),
    }),

    /**
     * @return {string}
     */
    get Prompt() {
        return ScribePedant.Settings.PromptLines.join(ScribePedant.Settings.Newline);
    },

    Keys: Object.freeze({
        /**
         * @param {object} finding
         * @return {string[]}
         */
        Spelling(finding) {
            return [ScribeText.normaliseName(finding.written), finding.subject];
        },

        /**
         * @param {object} finding
         * @return {string[]}
         */
        Contradiction(finding) {
            return [finding.message, finding.fact, ScribeReplay.wording(finding.said)];
        },

        /**
         * @param {object} finding
         * @return {string[]}
         */
        Leak(finding) {
            return [finding.message, finding.fact, finding.speaker];
        },
    }),

    /**
     * @param {object} message
     * @param {object} fields
     * @return {Readonly<object>}
     */
    finding(message, fields) {
        return Object.freeze({
            ...ScribePedant.Settings.Finding,
            message: message.id,
            position: message.position,
            ...fields,
        });
    },

    /**
     * @param {string} text
     * @return {string}
     */
    clean(text) {
        const settings = ScribePedant.Settings;
        return text.replace(settings.Format, settings.Nothing).replace(settings.Spacing, settings.Space).trim();
    },

    /**
     * @param {string} text
     * @return {string}
     */
    folded(text) {
        const settings = ScribePedant.Settings;
        return ScribePedant.clean(text)
            .replace(settings.Apostrophes, settings.Apostrophe)
            .toLowerCase()
            .normalize(settings.NormalForm);
    },

    /**
     * @param {string} text
     * @return {string}
     */
    undress(text) {
        const settings = ScribePedant.Settings;
        let current = ScribePedant.clean(text.replace(settings.Tab, settings.Space));
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
        return current;
    },

    /**
     * @param {object} fact
     * @return {boolean}
     */
    veiled(fact) {
        return fact.hidden && fact.widened !== ScribeKnowledge.Everyone;
    },

    /**
     * @param {object} state
     * @param {string} written
     * @return {object|null}
     */
    find(state, written) {
        const key = ScribeText.normaliseName(written);
        const active = state.subjects.filter(
            /**
             * @param {{ mergedInto: string|null }} subject
             * @return {boolean}
             */
            (subject) => subject.mergedInto === null,
        );
        let matches = active.filter(
            /**
             * @param {{ label: string }} subject
             * @return {boolean}
             */
            (subject) => ScribeText.normaliseName(subject.label) === key,
        );
        if (matches.length === 0) {
            matches = active.filter(
                /**
                 * @param {{ name: string, aka: readonly string[] }} subject
                 * @return {boolean}
                 */
                (subject) =>
                    [subject.name, ...subject.aka].some(
                        /**
                         * @param {string} name
                         * @return {boolean}
                         */
                        (name) => ScribeText.normaliseName(name) === key,
                    ),
            );
        }
        return matches.length === 1 ? matches[0] : null;
    },

    /**
     * @param {object} state
     * @return {Set<string>}
     */
    names(state) {
        const known = new Set();
        for (const subject of state.subjects) {
            for (const name of [subject.name, ...subject.aka]) {
                for (const [word] of name.matchAll(ScribePedant.Settings.Word)) {
                    known.add(ScribeText.normaliseName(word));
                }
            }
        }
        return known;
    },

    /**
     * @param {object} state
     * @param {object} subject
     * @return {string[]}
     */
    openWords(state, subject) {
        const settings = ScribePedant.Settings;
        const secret = new Set();
        const open = new Set();
        for (const fact of state.facts) {
            if (fact.subject === subject.id && fact.category === ScribeLog.Settings.AkaCategory) {
                (ScribePedant.veiled(fact) ? secret : open).add(ScribeText.normaliseName(fact.text));
            }
        }
        for (const alias of state.aliases) {
            if (alias.subject === subject.id) {
                open.add(ScribeText.normaliseName(alias.name));
            }
        }
        const told = subject.aka.filter(
            /**
             * @param {string} name
             * @return {boolean}
             */
            (name) => {
                const key = ScribeText.normaliseName(name);
                return open.has(key) || !secret.has(key);
            },
        );
        const words = [];
        for (const name of [subject.name, ...told]) {
            for (const [word] of name.matchAll(settings.Word)) {
                if (Array.from(word).length >= settings.ShortestNameWord) {
                    words.push(word);
                }
            }
        }
        return words;
    },

    /**
     * @param {object} state
     * @param {string} player
     * @param {object} message
     * @return {object[]}
     */
    speakers(state, player, message) {
        const playing = ScribePedant.find(state, player);
        const found = [];
        for (const block of message.blocks) {
            const subject =
                block.role === ScribeIntake.Role.Character ? ScribePedant.find(state, block.speaker) : null;
            if (subject !== null && subject !== playing && !found.includes(subject)) {
                found.push(subject);
            }
        }
        return found;
    },

    /**
     * @param {object} state
     * @return {Set<string|null>}
     */
    contested(state) {
        const ids = new Set();
        for (const conflict of state.conflicts) {
            for (const id of [conflict.established, ...conflict.others]) {
                ids.add(id);
            }
        }
        return ids;
    },

    /**
     * @param {object} state
     * @param {object} fact
     * @return {object[]}
     */
    wordings(state, fact) {
        const thinner = new Map();
        for (const refinement of state.refinements) {
            thinner.set(refinement.to, refinement.from);
        }
        const chain = [];
        let wording = fact;
        while (wording !== undefined) {
            chain.push(wording);
            wording = ScribeLog.lookup(state.facts, thinner.get(wording.id));
        }
        return chain;
    },

    /**
     * @param {object} state
     * @param {string} knower
     * @param {object} fact
     * @return {boolean}
     */
    aware(state, knower, fact) {
        if (ScribeKnowledge.knows(state, knower, fact)) {
            return true;
        }
        const chain = ScribePedant.wordings(state, fact);
        return ScribeKnowledge.about(state, knower, fact.subject).facts.some(
            /**
             * @param {object} wording
             * @return {boolean}
             */
            (wording) => chain.includes(wording),
        );
    },

    /**
     * @param {object} state
     * @param {string} player
     * @param {object} message
     * @param {readonly object[]} unread
     * @return {{ ledger: object[], candidates: object[], pairs: Array<{ speaker: object, fact: object }>, since: string|null }}
     */
    survey(state, player, message, unread) {
        const settings = ScribePedant.Settings;
        const kinds = ScribeCategory.Kind;
        const contested = ScribePedant.contested(state);
        const groups = new Map();
        for (const id of ScribeAnalyzer.select(state, ScribeIntake.transcript([message]), player, message.position)) {
            groups.set(id, []);
        }
        for (const fact of state.facts) {
            const group = groups.get(fact.subject);
            if (group !== undefined && fact.status === ScribeReplay.Status.InForce && !contested.has(fact.id)) {
                group.push(fact);
            }
        }
        const facts = [...groups.values()].flat();
        const candidates = facts.filter(
            /**
             * @param {object} fact
             * @return {boolean}
             */
            (fact) => {
                const kind = ScribeReplay.kindOf(fact.category);
                return (kind === kinds.Fixed || kind === kinds.Moving) && !ScribePedant.veiled(fact);
            },
        );
        const earlier = unread
            .filter(
                /**
                 * @param {{ position: number }} item
                 * @return {boolean}
                 */
                (item) => item.position < message.position,
            )
            .sort(
                /**
                 * @param {{ position: number }} first
                 * @param {{ position: number }} second
                 * @return {number}
                 */
                (first, second) => first.position - second.position,
            );
        const transcript = ScribeIntake.transcript(earlier);
        const since = Array.from(transcript).length > settings.UnreadCharacters ? null : transcript;
        const pairs = [];
        for (const speaker of since === null ? [] : ScribePedant.speakers(state, player, message)) {
            for (const fact of facts) {
                const secret = ScribePedant.veiled(fact) && !fact.made;
                if (secret && !ScribePedant.aware(state, speaker.id, fact)) {
                    pairs.push({ speaker, fact });
                }
            }
        }
        const ledger = facts.filter(
            /**
             * @param {object} fact
             * @return {boolean}
             */
            (fact) =>
                candidates.includes(fact) ||
                pairs.some(
                    /**
                     * @param {{ fact: object }} pair
                     * @return {boolean}
                     */
                    (pair) => pair.fact === fact,
                ),
        );
        return { ledger, candidates, pairs, since };
    },

    /**
     * @param {Map<string, string>} labels
     * @param {object} fact
     * @return {string}
     */
    target(labels, fact) {
        return fact.target === null ? fact.targetText : labels.get(fact.target);
    },

    /**
     * @param {object} state
     * @param {object} fact
     * @param {string} written
     * @return {boolean}
     */
    aimed(state, fact, written) {
        const key = ScribeText.normaliseName(written);
        const textual = fact.targetText !== null && ScribeText.normaliseName(fact.targetText) === key;
        const found = ScribePedant.find(state, written);
        return textual || (found !== null && found.id === fact.target);
    },

    /**
     * @param {string} place
     * @param {string} sought
     * @return {boolean}
     */
    holds(place, sought) {
        const settings = ScribePedant.Settings;
        let start = place.indexOf(sought);
        while (start !== settings.NotFound) {
            const end = start + sought.length;
            const before = place.slice(Math.max(0, start - settings.EdgeWidth), start);
            const after = place.slice(end, end + settings.EdgeWidth);
            if (!settings.WordBefore.test(before) && !settings.WordAfter.test(after)) {
                return true;
            }
            const next = place.indexOf(sought, start + 1);
            start = next > start ? next : settings.NotFound;
        }
        return false;
    },

    /**
     * @param {string} first
     * @param {string} second
     * @return {boolean}
     */
    sameLabel(first, second) {
        const form = ScribePedant.Settings.NormalForm;
        return first.normalize(form) === second.normalize(form);
    },

    /**
     * @param {readonly string[]} outer
     * @param {readonly string[]} inner
     * @return {boolean}
     */
    contains(outer, inner) {
        for (let start = 0; start + inner.length <= outer.length; start++) {
            const matched = inner.every(
                /**
                 * @param {string} word
                 * @param {number} index
                 * @return {boolean}
                 */
                (word, index) => outer[start + index] === word,
            );
            if (matched) {
                return true;
            }
        }
        return false;
    },

    /**
     * @param {string} text
     * @param {readonly string[]} places
     * @return {string|null}
     */
    claimed(text, places) {
        const settings = ScribePedant.Settings;
        const spaced = text.replace(settings.Tab, settings.Space);
        if (settings.Forbidden.test(spaced)) {
            return null;
        }
        const words = ScribePedant.undress(spaced);
        const sought = ScribePedant.folded(words);
        const usable =
            ScribeAnswer.Settings.HasContent.test(words) &&
            Array.from(words).length <= settings.MostWords &&
            places.some(
                /**
                 * @param {string} place
                 * @return {boolean}
                 */
                (place) => ScribePedant.holds(place, sought),
            );
        return usable ? words : null;
    },

    /**
     * @param {object} state
     * @param {object} message
     * @return {readonly object[]}
     */
    spellings(state, message) {
        const settings = ScribePedant.Settings;
        const known = ScribePedant.names(state);
        const compared = [];
        for (const subject of state.subjects) {
            if (subject.mergedInto !== null) {
                continue;
            }
            for (const word of ScribePedant.openWords(state, subject)) {
                compared.push({ subject, word });
            }
        }
        const seen = new Set();
        const findings = [];
        for (const [found] of message.text.matchAll(settings.Word)) {
            const written = found.replace(settings.Possessive, settings.Nothing);
            const normal = ScribeText.normaliseName(written);
            const stem = normal.replace(settings.Plural, settings.Nothing);
            if (!settings.Capital.test(written) || known.has(normal) || known.has(stem)) {
                continue;
            }
            for (const { subject, word } of compared) {
                const key = JSON.stringify([normal, subject.id]);
                if (!seen.has(key) && ScribeText.resembles(written, word)) {
                    seen.add(key);
                    findings.push(
                        ScribePedant.finding(message, {
                            kind: ScribePedant.Kind.Spelling,
                            subject: subject.id,
                            label: subject.label,
                            written,
                        }),
                    );
                }
            }
        }
        return Object.freeze(findings);
    },

    /**
     * @param {object} state
     * @param {string} player
     * @param {object} message
     * @param {readonly object[]} unread
     * @return {string}
     */
    input(state, player, message, unread) {
        const settings = ScribePedant.Settings;
        const headings = settings.Headings;
        const labels = ScribeAnalyzer.labels(state);
        const survey = ScribePedant.survey(state, player, message, unread);
        const ledger = survey.ledger.map(
            /**
             * @param {object} fact
             * @return {string}
             */
            (fact) => {
                const category =
                    fact.category === ScribeCategory.Settings.RelationCategory
                        ? settings.RelationTo + ScribePedant.target(labels, fact)
                        : fact.category;
                return (
                    [fact.id, labels.get(fact.subject), category, fact.text].join(settings.Joiner) +
                    (ScribePedant.veiled(fact) ? settings.Hidden : settings.Nothing)
                );
            },
        );
        const unknown = survey.pairs.map(
            /**
             * @param {{ speaker: object, fact: object }} pair
             * @return {string}
             */
            (pair) => pair.speaker.label + settings.DoesNotKnow + pair.fact.id,
        );
        let since = [];
        if (survey.since === null) {
            since = [settings.TooLong];
        } else if (survey.since !== settings.Nothing) {
            since = [survey.since];
        }
        const reply = settings.ReplyOpen + message.position + settings.ReplyClose;
        return [
            ScribeAnalyzer.section(headings.Player, [player]),
            ScribeAnalyzer.section(headings.Ledger, ledger),
            ScribeAnalyzer.section(headings.Unknown, unknown),
            ScribeAnalyzer.section(headings.Since, since),
            ScribeAnalyzer.section(reply, [ScribeIntake.transcript([message])]),
        ].join(settings.BlankLine);
    },

    /**
     * @param {string} text
     * @return {Readonly<{ contradictions: readonly object[], leaks: readonly object[] }>}
     */
    parse(text) {
        const settings = ScribePedant.Settings;
        const answer = ScribeAnswer.Settings;
        const blocks = ScribePedant.Block;
        const contradictions = [];
        const leaks = [];
        let block = null;
        for (const raw of typeof text === 'string' ? text.split(answer.LineBreak) : []) {
            const line = raw
                .replace(answer.FormatCharacter, settings.Nothing)
                .trim()
                .replace(answer.ListMarkers, settings.Nothing)
                .replace(answer.Bold, answer.BoldInner)
                .replace(answer.ListMarkers, settings.Nothing)
                .trim();
            const letters = line.replace(settings.NonLetters, settings.Nothing).toUpperCase();
            if (Object.values(blocks).includes(letters)) {
                block = letters;
                continue;
            }
            if (
                block === null ||
                line === settings.Nothing ||
                answer.Fence.test(line) ||
                settings.NoneLine.test(line)
            ) {
                continue;
            }
            const fields = line
                .replace(settings.TableEdges, settings.Nothing)
                .split(settings.Pipe)
                .map(
                    /**
                     * @param {string} field
                     * @return {string}
                     */
                    (field) => field.trim(),
                );
            const number = fields[settings.FactField]
                .replace(settings.IdDress, settings.Nothing)
                .trim()
                .match(settings.FactNumber);
            if (number === null) {
                continue;
            }
            const fact = ScribeLog.Settings.FactPrefix + number[settings.NumberGroup];
            if (block === blocks.Contradictions && fields.length >= settings.ContradictionFields) {
                contradictions.push(
                    Object.freeze({
                        fact,
                        label: fields[settings.LabelField],
                        category: fields[settings.CategoryField],
                        said: fields.slice(settings.SaidStart).join(settings.Joiner),
                    }),
                );
            } else if (block === blocks.Leaks && fields.length >= settings.LeakFields) {
                leaks.push(
                    Object.freeze({
                        fact,
                        speaker: fields[settings.SpeakerField],
                        words: fields.slice(settings.WordsStart).join(settings.Joiner),
                    }),
                );
            }
        }
        return Object.freeze({ contradictions: Object.freeze(contradictions), leaks: Object.freeze(leaks) });
    },

    /**
     * @param {object} state
     * @param {string} player
     * @param {object} message
     * @param {{ contradictions: readonly object[], leaks: readonly object[] }} parsed
     * @param {readonly object[]} unread
     * @return {readonly object[]}
     */
    confirm(state, player, message, parsed, unread) {
        const settings = ScribePedant.Settings;
        const kinds = ScribePedant.Kind;
        const survey = ScribePedant.survey(state, player, message, unread);
        const blocks = message.blocks.map(
            /**
             * @param {{ text: string }} block
             * @return {string}
             */
            (block) => ScribePedant.folded(block.text),
        );
        const found = [];
        for (const claim of parsed.contradictions) {
            const fact = survey.candidates.find(
                /**
                 * @param {{ id: string }} candidate
                 * @return {boolean}
                 */
                (candidate) => candidate.id === claim.fact,
            );
            const said = ScribePedant.claimed(claim.said, blocks);
            if (fact === undefined || said === null) {
                continue;
            }
            const owner = ScribeLog.lookup(state.subjects, fact.subject);
            const written = ScribeText.normaliseName(ScribePedant.undress(claim.label));
            const named = [owner.label, owner.name, ...owner.aka].some(
                /**
                 * @param {string} name
                 * @return {boolean}
                 */
                (name) => ScribeText.normaliseName(name) === written,
            );
            const category = ScribeCategory.parse(ScribePedant.undress(claim.category));
            const relation = fact.category === ScribeCategory.Settings.RelationCategory;
            const fits =
                category !== null &&
                category.category === fact.category &&
                (!relation || ScribePedant.aimed(state, fact, category.target));
            const saidWords = ScribeText.words(said);
            const thinner = ScribePedant.wordings(state, fact).some(
                /**
                 * @param {{ text: string }} wording
                 * @return {boolean}
                 */
                (wording) => ScribePedant.contains(ScribeText.words(wording.text), saidWords),
            );
            if (named && fits && !thinner) {
                found.push(
                    ScribePedant.finding(message, {
                        kind: kinds.Contradiction,
                        subject: owner.id,
                        label: owner.label,
                        fact: fact.id,
                        category: fact.category,
                        book: fact.text,
                        said,
                    }),
                );
            }
        }
        for (const claim of parsed.leaks) {
            const speaker = ScribePedant.find(state, ScribePedant.undress(claim.speaker));
            const pair = survey.pairs.find(
                /**
                 * @param {{ speaker: object, fact: object }} candidate
                 * @return {boolean}
                 */
                (candidate) => candidate.speaker === speaker && candidate.fact.id === claim.fact,
            );
            if (pair === undefined) {
                continue;
            }
            const own = [];
            for (const block of message.blocks) {
                const spoken = block.role === ScribeIntake.Role.Character;
                if (spoken && ScribePedant.find(state, block.speaker) === speaker) {
                    own.push(ScribePedant.folded(block.text));
                }
            }
            const words = ScribePedant.claimed(claim.words, own);
            if (words !== null) {
                const owner = ScribeLog.lookup(state.subjects, pair.fact.subject);
                found.push(
                    ScribePedant.finding(message, {
                        kind: kinds.Leak,
                        subject: owner.id,
                        label: owner.label,
                        fact: pair.fact.id,
                        category: pair.fact.category,
                        book: pair.fact.text,
                        said: words,
                        speaker: speaker.id,
                        speakerLabel: speaker.label,
                    }),
                );
            }
        }
        const counts = new Map();
        const totals = new Map();
        const kept = [];
        for (const candidate of found) {
            const leaked = candidate.kind === kinds.Leak;
            const slot = JSON.stringify(leaked ? [candidate.fact, candidate.speaker] : [candidate.fact]);
            const count = counts.get(slot) ?? 0;
            const total = totals.get(candidate.kind) ?? 0;
            if (count < settings.FindingsPerFact && total < settings.FindingsPerKind) {
                kept.push(candidate);
                totals.set(candidate.kind, total + 1);
            }
            counts.set(slot, count + 1);
        }
        return Object.freeze(kept);
    },

    /**
     * @param {{ state: object, player: string, message: object, unread: readonly object[], ask: function(string, string): Promise<{ text: string }> }} request
     * @return {Promise<readonly object[]>}
     */
    async review({ state, player, message, unread, ask }) {
        if (message.fromPlayer) {
            return Object.freeze([]);
        }
        const spellings = ScribePedant.spellings(state, message);
        if (ScribePedant.survey(state, player, message, unread).ledger.length === 0) {
            return spellings;
        }
        const input = ScribePedant.input(state, player, message, unread);
        let text = null;
        try {
            text = (await ask(ScribePedant.Prompt, input)).text;
        } catch {
            return spellings;
        }
        const confirmed = ScribePedant.confirm(state, player, message, ScribePedant.parse(text), unread);
        return Object.freeze([...spellings, ...confirmed]);
    },

    /**
     * @param {object} finding
     * @return {string}
     */
    key(finding) {
        return JSON.stringify([finding.kind, ...ScribePedant.Keys[finding.kind](finding)]);
    },

    /**
     * @param {object} state
     * @param {object} finding
     * @return {boolean}
     */
    spent(state, finding) {
        const kinds = ScribePedant.Kind;
        if (finding.kind === kinds.Spelling) {
            const subject = ScribeLog.lookup(state.subjects, finding.subject);
            return (
                subject === undefined ||
                subject.mergedInto !== null ||
                !ScribePedant.sameLabel(subject.label, finding.label) ||
                ScribePedant.names(state).has(ScribeText.normaliseName(finding.written))
            );
        }
        const fact = ScribeLog.lookup(state.facts, finding.fact);
        const owner = fact === undefined ? undefined : ScribeLog.lookup(state.subjects, fact.subject);
        const standing =
            owner !== undefined &&
            fact.category === finding.category &&
            ScribeCategory.same(fact.text, finding.book) &&
            fact.status === ScribeReplay.Status.InForce &&
            !ScribePedant.contested(state).has(fact.id) &&
            fact.subject === ScribeKnowledge.survivor(state, finding.subject) &&
            ScribePedant.sameLabel(owner.label, finding.label);
        if (!standing || finding.kind === kinds.Contradiction) {
            return !standing;
        }
        const speaker = ScribeLog.lookup(state.subjects, finding.speaker);
        return (
            speaker === undefined ||
            speaker.mergedInto !== null ||
            !ScribePedant.sameLabel(speaker.label, finding.speakerLabel) ||
            !ScribePedant.veiled(fact) ||
            ScribePedant.aware(state, speaker.id, fact)
        );
    },

    /**
     * @param {object} state
     * @param {object} finding
     * @return {Readonly<{ type: string, fact: string, to: readonly string[] }>|null}
     */
    told(state, finding) {
        if (finding.kind !== ScribePedant.Kind.Leak || ScribePedant.spent(state, finding)) {
            return null;
        }
        const fact = ScribeLog.lookup(state.facts, finding.fact);
        if (fact.made) {
            return null;
        }
        const to = fact.widened === null ? [] : [...fact.widened];
        if (!to.includes(finding.speaker)) {
            to.push(finding.speaker);
        }
        return Object.freeze({ type: ScribeLog.Ruling.Widen, fact: fact.id, to: Object.freeze(to) });
    },
});
