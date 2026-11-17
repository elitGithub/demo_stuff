const ScribeReminder = Object.freeze({
    Kind: Object.freeze({
        Fact: 'Fact',
        Knows: 'Knows',
        Unknown: 'Unknown',
    }),

    Settings: Object.freeze({
        MaxBytes: 600,
        MostOpening: 200,
        MostChosen: 8,
        RecentShown: 10,
        LongestText: 200,
        LongestPlace: 60,
        LongestCategory: 30,
        LongestLabel: 60,
        MostLabelWords: 4,
        FewestTestedWords: 3,
        FewestLetters: 3,
        MostPlaceBytes: 80,
        NormalForm: 'NFKC',
        WrittenForm: 'NFC',
        ListWord: 'and',
        Article: 'the',
        Slash: '/',
        LookAlikeQuotes: String.fromCodePoint(
            0x2ba,
            0x2ee,
            0x5f4,
            0x2033,
            0x2036,
            0x275d,
            0x275e,
            0x3003,
            0x1f676,
            0x1f677,
            0x1f678,
        ),
        ListGroup: 1,
        Nothing: '',
        Space: ' ',
        Newline: '\n',
        BlankLine: '\n\n',
        Apostrophe: "'",
        Quote: '"',
        Comma: ', ',
        Colon: ': ',
        Joiner: ' | ',
        FullStop: '.',
        NumberClose: '. ',
        And: ' and ',
        AndCount: ', and ',
        OneOther: ' other',
        ManyOthers: ' others',
        OnePerson: ' person',
        ManyPeople: ' people',
        Toward: 'toward ',
        Day: 'Day ',
        Present: 'Present: ',
        ScenePresent: 'present: ',
        Nobody: 'nobody',
        OnlyOpen: 'Of those here only ',
        KnowsOne: ' knows this about ',
        KnowsMany: ' know this about ',
        OthersDoNot: ', the others do not: ',
        KeepsSecret: ' keeps this secret and no one here knows it: ',
        NoOneKnows: 'No one here knows this about ',
        NotWhole: 'No one here knows the whole of this about ',
        PartOpen: '; only ',
        PartOne: ' knows a part of it: ',
        PartMany: ' know a part of it: ',
        NothingOfIt: '; the others know nothing of it',
        Headings: Object.freeze({
            Scene: 'SCENE:',
            Entries: 'ENTRIES:',
            Recent: 'RECENT MESSAGES:',
        }),

        /**
         * @return {RegExp}
         */
        get LineBreak() {
            return /\r?\n/;
        },

        /**
         * @return {RegExp}
         */
        get TrailingMarks() {
            return /[\s.!?;,]+$/u;
        },

        /**
         * @return {RegExp}
         */
        get Breaking() {
            return /[\p{Cc}\p{Zl}\p{Zp}]/gu;
        },

        /**
         * @return {RegExp}
         */
        get Invisible() {
            return /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
        },

        /**
         * @return {RegExp}
         */
        get QuotationMarks() {
            return /[\p{Quotation_Mark}--[\u{27}\u{2019}]]/gv;
        },

        /**
         * @return {RegExp}
         */
        get Frame() {
            return /[\[\]@]/u;
        },

        /**
         * @return {RegExp}
         */
        get Backslashes() {
            return /\\/g;
        },

        /**
         * @return {RegExp}
         */
        get Words() {
            return /[\p{L}\p{M}\p{N}]+/gu;
        },

        /**
         * @return {RegExp}
         */
        get Letters() {
            return /\p{L}/gu;
        },

        /**
         * @return {RegExp}
         */
        get Bracketed() {
            return /\([^)]*\)|\[[^\]]*\]/gu;
        },

        /**
         * @return {RegExp}
         */
        get FullStops() {
            return /\./g;
        },

        /**
         * @return {RegExp}
         */
        get CategoryCharacters() {
            return /^[\p{Lu}\p{Ll}\p{Lt}0-9 '\u{2019}-]+$/u;
        },

        /**
         * @return {RegExp}
         */
        get LabelCharacters() {
            return /^[\p{Lu}\p{Ll}\p{Lt}\p{Mn}0-9 '\u{2019}-]+$/u;
        },

        /**
         * @return {RegExp}
         */
        get AnswerDress() {
            return /^[\s*>`-]+|[\s*>`-]+$/gu;
        },

        /**
         * @return {RegExp}
         */
        get UseHead() {
            return /^use\**[:\u{FF1A}]\s*\**\s*(.*)$/iu;
        },

        /**
         * @return {RegExp}
         */
        get NoneList() {
            return /^none\.?$/iu;
        },

        /**
         * @return {RegExp}
         */
        get NumberList() {
            return /^\[?\s*#?\d+(?:(?:\s|,|;|(?<!\p{L})and(?!\p{L}))+#?\d+)*\s*\]?\.?$/iu;
        },

        /**
         * @return {RegExp}
         */
        get Digits() {
            return /\d+/g;
        },

        PromptLines: Object.freeze([
            'You help a storyteller keep an ongoing adult fiction roleplay consistent. You never write story.',
            'You receive the SCENE as it stands, a numbered list of ENTRIES that are known to be true, and the RECENT MESSAGES.',
            'Choose the entries the storyteller most needs to be reminded of for this scene: what bears on what is happening now.',
            'Answer with one line and nothing else:',
            '',
            'USE: 3, 7, 12',
            '',
            'Rules.',
            '1. Use only numbers from ENTRIES. At most 8.',
            '2. Prefer entries about what someone here knows or does not know, then lasting facts the recent messages touch on.',
            '3. If nothing is worth reminding, answer USE: none',
        ]),
    }),

    /**
     * @return {string}
     */
    get ChoosePrompt() {
        return ScribeReminder.Settings.PromptLines.join(ScribeReminder.Settings.Newline);
    },

    /**
     * @param {string} text
     * @param {string} form
     * @return {string}
     */
    clean(text, form) {
        const settings = ScribeReminder.Settings;
        return ScribeIntake.collapse(
            text.normalize(form).replace(settings.Breaking, settings.Space).replace(settings.Invisible, settings.Nothing),
        );
    },

    /**
     * @param {string} text
     * @param {number} longest
     * @return {string|null}
     */
    quoted(text, longest) {
        const settings = ScribeReminder.Settings;
        const lookAlikes = Array.from(settings.LookAlikeQuotes);
        const said = Array.from(
            ScribeReminder.clean(text, settings.WrittenForm)
                .replace(settings.TrailingMarks, settings.Nothing)
                .replace(settings.QuotationMarks, settings.Apostrophe)
                .replace(settings.Backslashes, settings.Slash),
            /**
             * @param {string} character
             * @return {string}
             */
            (character) => (lookAlikes.includes(character) ? settings.Apostrophe : character),
        ).join(settings.Nothing);
        const fits =
            said !== settings.Nothing &&
            !settings.Frame.test(said.normalize(settings.NormalForm)) &&
            Array.from(said).length <= longest;
        return fits ? settings.Quote + said + settings.Quote : null;
    },

    /**
     * @param {string} label
     * @return {string|null}
     */
    printed(label) {
        const settings = ScribeReminder.Settings;
        const bare = ScribeIntake.collapse(
            ScribeReminder.clean(label, settings.NormalForm)
                .replace(settings.Bracketed, settings.Space)
                .replace(settings.FullStops, settings.Nothing),
        );
        const words = bare.split(settings.Space);
        const fits =
            settings.LabelCharacters.test(bare) &&
            words.length <= settings.MostLabelWords &&
            Array.from(bare).length <= settings.LongestLabel &&
            !words.some(
                /**
                 * @param {string} word
                 * @return {boolean}
                 */
                (word) => word.toLowerCase() === settings.ListWord,
            );
        return fits ? bare : null;
    },

    /**
     * @param {ReadonlyArray<{ subject: string|null, label: string|null }>} persons
     * @return {ReadonlyArray<string|null>}
     */
    named(persons) {
        const labels = persons.map(
            /**
             * @param {{ subject: string|null, label: string|null }} person
             * @return {string|null}
             */
            (person) => (person.subject === null || person.label === null ? null : ScribeReminder.printed(person.label)),
        );
        const counts = new Map();
        for (const label of labels) {
            if (label !== null) {
                const key = ScribeText.normaliseName(label);
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
        }
        return Object.freeze(
            labels.map(
                /**
                 * @param {string|null} label
                 * @return {string|null}
                 */
                (label) => (label !== null && counts.get(ScribeText.normaliseName(label)) === 1 ? label : null),
            ),
        );
    },

    /**
     * @param {object} state
     * @param {string} player
     * @return {readonly string[]}
     */
    namesakes(state, player) {
        const wanted = ScribeText.normaliseName(player);
        return Object.freeze(
            state.subjects
                .filter(
                    /**
                     * @param {{ label: string, name: string, aka: readonly string[], mergedInto: string|null }} subject
                     * @return {boolean}
                     */
                    (subject) =>
                        subject.mergedInto === null &&
                        [subject.label, subject.name, ...subject.aka].some(
                            /**
                             * @param {string} name
                             * @return {boolean}
                             */
                            (name) => ScribeText.normaliseName(name) === wanted,
                        ),
                )
                .map(
                    /**
                     * @param {{ id: string }} subject
                     * @return {string}
                     */
                    (subject) => subject.id,
                ),
        );
    },

    /**
     * @param {object} state
     * @param {{ present: ReadonlyArray<{ subject: string|null, label: string }> }} now
     * @param {string} player
     * @return {ReadonlyArray<Readonly<{ subject: string|null, label: string|null }>>}
     */
    people(state, now, player) {
        const settings = ScribeReminder.Settings;
        const namesakes = ScribeReminder.namesakes(state, player);
        const self = namesakes.length === 1 ? namesakes[0] : null;
        /**
         * @param {string} text
         * @return {string}
         */
        const keyOf = (text) => ScribeText.normaliseName(ScribeReminder.clean(text, settings.NormalForm));
        const books = new Map();
        const names = new Map();
        const words = new Map();
        /**
         * @param {Map<string, Set<string>>} index
         * @param {string} key
         * @param {string} owner
         * @return {void}
         */
        const enter = (index, key, owner) => {
            const owners = index.get(key) ?? new Set();
            owners.add(owner);
            index.set(key, owners);
        };
        for (const subject of state.subjects) {
            const owner = subject.mergedInto === null ? subject.id : subject.mergedInto;
            const spoken = [subject.label, subject.name, ...subject.aka];
            const printed = ScribeReminder.printed(subject.label);
            books.set(subject.id, subject.label);
            for (const name of printed === null ? spoken : [...spoken, printed]) {
                enter(names, keyOf(name), owner);
            }
            for (const name of spoken) {
                for (const [word] of ScribeReminder.clean(name, settings.NormalForm).matchAll(settings.Words)) {
                    enter(words, ScribeText.normaliseName(word), owner);
                }
            }
        }
        /**
         * @param {Map<string, Set<string>>} index
         * @param {string} key
         * @param {string} owner
         * @return {boolean}
         */
        const elsewhere = (index, key, owner) => {
            const owners = index.get(key);
            return owners !== undefined && (owners.size > 1 || !owners.has(owner));
        };
        const playerKey = keyOf(player);
        const article = ScribeText.normaliseName(settings.Article);
        /**
         * @param {string} subject
         * @return {string|null}
         */
        const allowed = (subject) => {
            const printed = books.has(subject) ? ScribeReminder.printed(books.get(subject)) : null;
            if (printed === null) {
                return null;
            }
            const key = ScribeText.normaliseName(printed);
            const taken = elsewhere(names, key, subject) || (key === playerKey && subject !== self);
            const tested = printed.split(settings.Space).length >= settings.FewestTestedWords;
            const speaks =
                tested &&
                Array.from(printed.matchAll(settings.Words)).some(
                    /**
                     * @param {string[]} match
                     * @return {boolean}
                     */
                    ([word]) => {
                        const wordKey = ScribeText.normaliseName(word);
                        return (
                            Array.from(word.matchAll(settings.Letters)).length >= settings.FewestLetters &&
                            wordKey !== article &&
                            elsewhere(words, wordKey, subject)
                        );
                    },
                );
            return taken || speaks ? null : printed;
        };
        const found = [];
        const seen = new Set();
        const strangers = new Set();
        for (const person of now.present) {
            if (person.subject === null) {
                const key = ScribeText.normaliseName(person.label);
                if (!strangers.has(key)) {
                    strangers.add(key);
                    found.push({ subject: null, label: null });
                }
                continue;
            }
            const subject = ScribeKnowledge.survivor(state, person.subject);
            if (!seen.has(subject)) {
                seen.add(subject);
                found.push({ subject, label: allowed(subject) });
            }
        }
        const labels = ScribeReminder.named(found);
        return Object.freeze(
            found.map(
                /**
                 * @param {{ subject: string|null }} person
                 * @param {number} index
                 * @return {Readonly<{ subject: string|null, label: string|null }>}
                 */
                (person, index) => Object.freeze({ subject: person.subject, label: labels[index] }),
            ),
        );
    },

    /**
     * @param {object} state
     * @param {{ present: ReadonlyArray<{ subject: string|null, label: string }> }} now
     * @param {string} player
     * @param {readonly object[]} unread
     * @return {ReadonlyArray<Readonly<{ number: number, kind: string, subject: string, fact: string, line: string }>>}
     */
    candidates(state, now, player, unread) {
        const settings = ScribeReminder.Settings;
        const kinds = ScribeReminder.Kind;
        const relation = ScribeCategory.Settings.RelationCategory;
        const everyone = ScribeKnowledge.Everyone;
        const namesakes = ScribeReminder.namesakes(state, player);
        const self = namesakes.length === 1 ? namesakes[0] : null;
        const heard = self === null ? now.present : [...now.present, { subject: self, label: settings.Nothing }];
        const present = ScribeReminder.people(state, { present: heard }, player);
        const names = new Map();
        for (const person of present) {
            if (person.subject !== null) {
                names.set(person.subject, person.label);
            }
        }
        const room = present.filter(
            /**
             * @param {{ subject: string|null }} person
             * @return {boolean}
             */
            (person) => self === null || person.subject !== self,
        );
        const owners = room.filter(
            /**
             * @param {{ subject: string|null }} person
             * @return {boolean}
             */
            (person) => person.subject !== null,
        );
        const inRoom = new Set(
            owners.map(
                /**
                 * @param {{ subject: string }} person
                 * @return {string}
                 */
                (person) => person.subject,
            ),
        );
        const contested = new Set();
        for (const conflict of state.conflicts) {
            contested.add(conflict.established);
            for (const id of conflict.others) {
                contested.add(id);
            }
        }
        const byId = new Map();
        for (const fact of state.facts) {
            byId.set(fact.id, fact);
        }
        const thinner = new Map();
        for (const refinement of state.refinements) {
            thinner.set(refinement.to, byId.get(refinement.from));
        }
        /**
         * @param {object} fact
         * @return {object[]}
         */
        const chainOf = (fact) => {
            const chain = [];
            for (let wording = fact; wording !== undefined; wording = thinner.get(wording.id)) {
                chain.push(wording);
            }
            return chain;
        };
        /**
         * @param {{ subject: string|null }} person
         * @param {object} fact
         * @return {boolean}
         */
        const knowing = (person, fact) =>
            person.subject === null
                ? ScribeKnowledge.audience(state, fact) === everyone
                : ScribeKnowledge.knows(state, person.subject, fact);
        /**
         * @param {object} fact
         * @return {boolean}
         */
        const usable = (fact) => {
            const kind = ScribeReplay.kindOf(fact.category);
            const changing = kind === ScribeCategory.Kind.Moving || kind === ScribeCategory.Kind.Passing;
            const target = fact.target === null ? null : ScribeKnowledge.survivor(state, fact.target);
            const aimed = fact.category !== relation || (target !== null && (inRoom.has(target) || target === self));
            const quarrel = chainOf(fact).some(
                /**
                 * @param {{ id: string }} wording
                 * @return {boolean}
                 */
                (wording) => contested.has(wording.id),
            );
            return fact.status === ScribeReplay.Status.InForce && !(changing && unread.length > 0) && aimed && !quarrel;
        };
        /**
         * @param {object} fact
         * @return {string|null}
         */
        const statement = (fact) => {
            const text = ScribeReminder.quoted(fact.text, settings.LongestText);
            const category = ScribeReminder.clean(fact.category, settings.NormalForm);
            const plain =
                settings.CategoryCharacters.test(category) && Array.from(category).length <= settings.LongestCategory;
            if (text === null || !plain) {
                return null;
            }
            if (fact.category !== relation) {
                return category + settings.Colon + text;
            }
            const target = names.get(ScribeKnowledge.survivor(state, fact.target));
            return target === null ? null : settings.Toward + target + settings.Colon + text;
        };
        /**
         * @param {ReadonlyArray<{ label: string|null }>} people
         * @return {string|null}
         */
        const listed = (people) => {
            const labels = people.map(
                /**
                 * @param {{ label: string|null }} person
                 * @return {string|null}
                 */
                (person) => person.label,
            );
            if (labels.includes(null)) {
                return null;
            }
            const last = labels.pop();
            return labels.length === 0 ? last : labels.join(settings.Comma) + settings.And + last;
        };
        const offered = [];
        /**
         * @param {string} kind
         * @param {string} subject
         * @param {string} fact
         * @param {string} line
         * @return {void}
         */
        const offer = (kind, subject, fact, line) => {
            offered.push(Object.freeze({ number: offered.length + 1, kind, subject, fact, line }));
        };
        const playerLabel = self === null ? null : names.get(self);
        if (playerLabel !== null && room.length > 0) {
            const wordings = new Map();
            for (const person of owners) {
                const known = new Set();
                for (const fact of ScribeKnowledge.about(state, person.subject, self).facts) {
                    known.add(fact.id);
                }
                wordings.set(person.subject, known);
            }
            for (const fact of state.facts) {
                if (fact.subject !== self || !usable(fact)) {
                    continue;
                }
                const holders = room.filter(
                    /**
                     * @param {{ subject: string|null }} person
                     * @return {boolean}
                     */
                    (person) => knowing(person, fact),
                );
                if (holders.length === room.length) {
                    continue;
                }
                const placed = new Set(holders);
                const groups = [];
                for (const wording of chainOf(fact).slice(1)) {
                    const people = room.filter(
                        /**
                         * @param {{ subject: string|null }} person
                         * @return {boolean}
                         */
                        (person) =>
                            !placed.has(person) &&
                            (person.subject === null
                                ? ScribeKnowledge.audience(state, wording) === everyone
                                : wordings.get(person.subject).has(wording.id)),
                    );
                    for (const person of people) {
                        placed.add(person);
                    }
                    if (people.length > 0) {
                        groups.push({ wording, people });
                    }
                }
                const parts = groups.map(
                    /**
                     * @param {{ wording: object, people: ReadonlyArray<{ label: string|null }> }} group
                     * @return {string|null}
                     */
                    (group) => {
                        const knowers = listed(group.people);
                        const thin = statement(group.wording);
                        const verb = group.people.length === 1 ? settings.PartOne : settings.PartMany;
                        return knowers === null || thin === null ? null : settings.PartOpen + knowers + verb + thin;
                    },
                );
                const said = statement(fact);
                const knowers = holders.length === 0 ? settings.Nothing : listed(holders);
                if (said === null || knowers === null || parts.includes(null)) {
                    continue;
                }
                let line = settings.NoOneKnows + playerLabel + settings.Colon + said;
                if (holders.length > 0) {
                    const verb = holders.length === 1 ? settings.KnowsOne : settings.KnowsMany;
                    const tail = groups.length === 0 ? settings.OthersDoNot : settings.Colon;
                    line = settings.OnlyOpen + knowers + verb + playerLabel + tail + said;
                } else if (groups.length > 0) {
                    line = settings.NotWhole + playerLabel + settings.Colon + said;
                } else if (fact.hidden && fact.widened !== everyone) {
                    line = playerLabel + settings.KeepsSecret + said;
                }
                const ending = groups.length > 0 && placed.size < room.length ? settings.NothingOfIt : settings.Nothing;
                const kind = holders.length === 0 ? kinds.Unknown : kinds.Knows;
                offer(kind, self, fact.id, line + parts.join(settings.Nothing) + ending);
            }
        }
        for (const owner of self === null ? owners : [...owners, { subject: self, label: playerLabel }]) {
            if (owner.label === null) {
                continue;
            }
            for (const fact of state.facts) {
                const open = !fact.hidden || fact.widened === everyone;
                if (fact.subject !== owner.subject || !open || !usable(fact)) {
                    continue;
                }
                const told =
                    room.every(
                        /**
                         * @param {{ subject: string|null }} person
                         * @return {boolean}
                         */
                        (person) => knowing(person, fact),
                    ) &&
                    namesakes.every(
                        /**
                         * @param {string} namesake
                         * @return {boolean}
                         */
                        (namesake) => ScribeKnowledge.knows(state, namesake, fact),
                    );
                const said = statement(fact);
                if (told && said !== null) {
                    const joiner = fact.category === relation ? settings.Space : settings.Comma;
                    offer(kinds.Fact, owner.subject, fact.id, owner.label + joiner + said);
                }
            }
        }
        return Object.freeze(offered);
    },

    /**
     * @param {{ day: number, place: string, reach: string, present: ReadonlyArray<{ label: string }>, summary: string }} now
     * @param {ReadonlyArray<{ number: number, line: string }>} candidates
     * @param {readonly object[]} recent
     * @return {string}
     */
    chooseInput(now, candidates, recent) {
        const settings = ScribeReminder.Settings;
        const headings = settings.Headings;
        const labels = now.present.map(
            /**
             * @param {{ label: string }} person
             * @return {string}
             */
            (person) => ScribeIntake.collapse(person.label),
        );
        const scene = [
            settings.Day + now.day,
            ScribeIntake.collapse(now.place),
            now.reach.toLowerCase(),
            settings.ScenePresent + (labels.length === 0 ? settings.Nobody : labels.join(settings.Comma)),
            ScribeIntake.collapse(now.summary),
        ].join(settings.Joiner);
        const entries = candidates.map(
            /**
             * @param {{ number: number, line: string }} candidate
             * @return {string}
             */
            (candidate) => candidate.number + settings.NumberClose + candidate.line,
        );
        return [
            headings.Scene + settings.Newline + scene,
            [headings.Entries, ...entries].join(settings.Newline),
            headings.Recent + settings.Newline + ScribeIntake.transcript(recent.slice(-settings.RecentShown)),
        ].join(settings.BlankLine);
    },

    /**
     * @param {*} text
     * @param {ReadonlyArray<{ number: number }>} candidates
     * @return {readonly object[]|null}
     */
    chosen(text, candidates) {
        const settings = ScribeReminder.Settings;
        if (typeof text !== 'string') {
            return null;
        }
        const lines = text.split(settings.LineBreak).map(
            /**
             * @param {string} line
             * @return {string}
             */
            (line) => line.replace(settings.AnswerDress, settings.Nothing),
        );
        for (const [index, line] of lines.entries()) {
            const head = line.match(settings.UseHead);
            if (head === null) {
                continue;
            }
            let listed = head[settings.ListGroup];
            if (listed === settings.Nothing) {
                const next = lines.slice(index + 1).find(
                    /**
                     * @param {string} later
                     * @return {boolean}
                     */
                    (later) => later !== settings.Nothing,
                );
                listed = next === undefined ? settings.Nothing : next;
            }
            if (settings.NoneList.test(listed)) {
                return Object.freeze([]);
            }
            if (!settings.NumberList.test(listed)) {
                continue;
            }
            const numbers = new Set();
            for (const [digits] of listed.matchAll(settings.Digits)) {
                numbers.add(Number(digits));
            }
            const kept = candidates
                .filter(
                    /**
                     * @param {{ number: number }} candidate
                     * @return {boolean}
                     */
                    (candidate) => numbers.has(candidate.number),
                )
                .slice(0, settings.MostChosen);
            return kept.length === 0 ? null : Object.freeze(kept);
        }
        return null;
    },

    /**
     * @param {{ day: number, place: string, reach: string, present: ReadonlyArray<{ subject: string|null, label: string|null }> }} now
     * @param {ReadonlyArray<{ line: string }>} entries
     * @return {Readonly<{ text: string, used: readonly object[] }>}
     */
    fit(now, entries) {
        const settings = ScribeReminder.Settings;
        const labels = ScribeReminder.named(now.present);
        const shown = labels.filter(
            /**
             * @param {string|null} label
             * @return {boolean}
             */
            (label) => label !== null,
        );
        /**
         * @param {number} kept
         * @return {string}
         */
        const list = (kept) => {
            const counted = labels.length - kept;
            if (kept === 0) {
                if (counted === 0) {
                    return settings.Nobody;
                }
                return counted + (counted === 1 ? settings.OnePerson : settings.ManyPeople);
            }
            const names = shown.slice(0, kept).join(settings.Comma);
            if (counted === 0) {
                return names;
            }
            return names + settings.AndCount + counted + (counted === 1 ? settings.OneOther : settings.ManyOthers);
        };
        /**
         * @param {string|null} place
         * @param {number} kept
         * @return {string}
         */
        const open = (place, kept) =>
            ScribeIntake.Settings.OwnMarker +
            settings.Space +
            settings.Day +
            now.day +
            settings.Comma +
            (place === null ? settings.Nothing : place + settings.Comma) +
            now.reach.toLowerCase() +
            settings.FullStop +
            settings.Space +
            settings.Present +
            list(kept) +
            settings.FullStop;
        const written = ScribeReminder.quoted(now.place, settings.LongestPlace);
        const place = written === null || ScribeText.bytes(written) > settings.MostPlaceBytes ? null : written;
        let kept = shown.length;
        let text = open(place, kept);
        while (kept > 0 && ScribeText.bytes(text) > settings.MostOpening) {
            kept--;
            text = open(place, kept);
        }
        if (ScribeText.bytes(text) > settings.MostOpening) {
            text = open(null, kept);
        }
        const used = [];
        for (const entry of entries) {
            const longer = text + settings.Space + entry.line + settings.FullStop;
            if (ScribeText.bytes(longer) <= settings.MaxBytes) {
                text = longer;
                used.push(entry);
            }
        }
        return Object.freeze({ text, used: Object.freeze(used) });
    },

    /**
     * @param {{ day: number, place: string, reach: string, present: ReadonlyArray<{ subject: string|null, label: string|null }> }} now
     * @param {ReadonlyArray<{ line: string }>} entries
     * @return {string}
     */
    write(now, entries) {
        return ScribeReminder.fit(now, entries).text;
    },

    /**
     * @param {{ state: object, now: object|null, player: string, recent: readonly object[], unread: readonly object[], ask: function(string, string): Promise<{ text: string }>, first?: * }} request
     * @return {Promise<Readonly<{ text: string, used: readonly object[], led: readonly string[] }>|null>}
     */
    async compose({ state, now, player, recent, unread, ask, first }) {
        const settings = ScribeReminder.Settings;
        if (now === null) {
            return null;
        }
        const wanted = Array.isArray(first) ? first : [];
        const offered = ScribeReminder.candidates(state, now, player, unread);
        const scene = Object.freeze({ ...now, present: ScribeReminder.people(state, now, player) });
        const leading = [];
        for (const id of wanted) {
            const found = offered.find(
                /**
                 * @param {{ fact: string }} candidate
                 * @return {boolean}
                 */
                (candidate) => candidate.fact === id,
            );
            if (found !== undefined && !leading.includes(found) && leading.length < settings.MostChosen) {
                leading.push(found);
            }
        }
        const rest = offered.filter(
            /**
             * @param {object} candidate
             * @return {boolean}
             */
            (candidate) => !leading.includes(candidate),
        );
        const places = settings.MostChosen - leading.length;
        let picked = rest.slice(0, places);
        if (places > 0 && rest.length > places) {
            const input = ScribeReminder.chooseInput(now, rest, recent);
            let text;
            try {
                text = (await ask(ScribeReminder.ChoosePrompt, input)).text;
            } catch {
                text = null;
            }
            const chosen = ScribeReminder.chosen(text, rest);
            picked = chosen === null ? rest.slice(0, places) : chosen.slice(0, places);
        }
        const fitted = ScribeReminder.fit(scene, [...leading, ...picked]);
        const led = [];
        for (const id of wanted) {
            const said = fitted.used.some(
                /**
                 * @param {{ fact: string }} candidate
                 * @return {boolean}
                 */
                (candidate) => candidate.fact === id,
            );
            if (said && !led.includes(id)) {
                led.push(id);
            }
        }
        return Object.freeze({ text: fitted.text, used: fitted.used, led: Object.freeze(led) });
    },
});
