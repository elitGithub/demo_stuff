const ScribeReminder = Object.freeze({
    Part: Object.freeze({
        Correction: 'Correction',
        Wearing: 'Wearing',
        Secret: 'Secret',
        Filed: 'Filed',
        Looks: 'Looks',
        Job: 'Job',
        Place: 'Place',
    }),

    Shape: Object.freeze({
        Look: 'Look',
        State: 'State',
        Where: 'Where',
        Named: 'Named',
        Thing: 'Thing',
        Passing: 'Passing',
        Owned: 'Owned',
        Habit: 'Habit',
        Past: 'Past',
    }),

    Settings: Object.freeze({
        MaxCharacters: 3000,
        StoryOpen: 'The story so far: ',
        LongestTimeline: 12000,
        FirstScenes: 5,
        StoryHeadings: Object.freeze({
            Timeline: 'TIMELINE:',
            Threads: 'OPEN THREADS:',
            Now: 'NOW:',
        }),
        None: '(none)',
        ListMarker: '- ',
        Joiner: ' | ',
        Day: 'Day ',
        Newline: '\n',
        BlankLine: '\n\n',
        StoryPromptLines: Object.freeze([
            'You are the Scribe: you tell the story so far of an ongoing adult fiction roleplay between consenting adult characters.',
            'You receive TIMELINE (every scene in story order: day, place, what happened), OPEN THREADS (what is left hanging) and NOW (what is happening at the last message).',
            '',
            'Write the story so far as plain prose in story order: how it began (who came to whom, and for what), what has been done since, where things stand now and what is needed next. Write as much as the story needs.',
            '',
            'Rules.',
            '1. Only what those lines say. No name, place, object or event that they do not hold.',
            '2. Past tense for what happened; present tense for where things stand now.',
            '3. Write the prose and nothing else: no heading, no label, no list, no remarks.',
        ]),
        LongestText: 200,
        MostPlaces: 2,
        LongestLabel: 60,
        MostLabelWords: 4,
        FewestTestedWords: 3,
        FewestLetters: 3,
        NotFound: -1,
        NormalForm: 'NFKC',
        WrittenForm: 'NFC',
        ListWord: 'and',
        Article: 'the',
        Slash: '/',
        Nothing: '',
        Space: ' ',
        LooksCategories: Object.freeze(['age', 'eyes', 'hair', 'build', 'skin', 'appearance', 'feature']),
        PlaceCategories: Object.freeze(['location', 'appearance', 'feature']),
        FiledOrigins: Object.freeze(['Operator', 'Notes']),
        LightWords: Object.freeze([
            'a',
            'an',
            'the',
            'and',
            'or',
            'with',
            'of',
            'in',
            'on',
            'at',
            'to',
            'for',
            'from',
            'by',
            'her',
            'his',
            'their',
            'its',
            'is',
            'are',
            'has',
            'have',
            'very',
        ]),
        LookClauses: Object.freeze({
            age: Object.freeze({
                prefix: 'aged ',
                suffix: '',
                nouns: Object.freeze(['age', 'old', 'year', 'years']),
                adjectives: Object.freeze(['aged']),
                counted: true,
            }),
            eyes: Object.freeze({
                prefix: '',
                suffix: ' eyes',
                nouns: Object.freeze(['eye', 'eyes']),
                adjectives: Object.freeze(['eyed']),
                counted: false,
            }),
            hair: Object.freeze({
                prefix: '',
                suffix: ' hair',
                nouns: Object.freeze(['hair']),
                adjectives: Object.freeze(['haired', 'bald', 'balding']),
                counted: false,
            }),
            skin: Object.freeze({
                prefix: '',
                suffix: ' skin',
                nouns: Object.freeze(['skin']),
                adjectives: Object.freeze(['skinned']),
                counted: false,
            }),
        }),
        Shapes: Object.freeze({
            age: 'Look',
            eyes: 'Look',
            hair: 'Look',
            skin: 'Look',
            kind: 'State',
            status: 'State',
            role: 'State',
            build: 'State',
            location: 'Where',
            aka: 'Named',
            title: 'Named',
            appearance: 'Thing',
            feature: 'Thing',
            condition: 'Passing',
            belonging: 'Owned',
            trait: 'Habit',
            ability: 'Habit',
            rule: 'Habit',
            background: 'Past',
        }),
        Called: Object.freeze({ aka: 'is also called ', title: 'is titled ' }),
        Is: 'is ',
        Has: 'has ',
        Was: 'was ',
        IsAt: 'is at ',
        IsIn: 'is in ',
        Leads: Object.freeze([
            'is',
            'are',
            'was',
            'were',
            'has',
            'had',
            'have',
            'can',
            'cannot',
            'could',
            'will',
            'would',
            'may',
            'might',
            'must',
            'should',
            'does',
            'did',
            'doesn',
            'didn',
            'isn',
            'wasn',
            'hasn',
            'won',
            'always',
            'never',
            'often',
            'usually',
            'sometimes',
            'rarely',
            'seldom',
            'wears',
            'wore',
        ]),
        Determiners: Object.freeze([
            'a',
            'an',
            'the',
            'his',
            'her',
            'their',
            'its',
            'my',
            'our',
            'your',
            'some',
            'several',
            'many',
            'few',
            'no',
            'every',
            'each',
            'both',
            'this',
            'that',
            'these',
            'those',
        ]),
        Prepositions: Object.freeze([
            'in',
            'at',
            'on',
            'under',
            'inside',
            'outside',
            'behind',
            'beside',
            'near',
            'by',
            'with',
            'without',
            'among',
            'between',
            'across',
            'around',
            'above',
            'below',
            'over',
            'into',
            'onto',
            'from',
            'toward',
            'towards',
            'within',
            'beyond',
            'through',
            'of',
            'to',
            'for',
            'about',
            'against',
            'along',
            'after',
            'before',
            'during',
            'until',
            'upon',
        ]),
        Joiners: Object.freeze(['and', 'or', 'but']),
        NumberWords: Object.freeze([
            'one',
            'two',
            'three',
            'four',
            'five',
            'six',
            'seven',
            'eight',
            'nine',
            'ten',
            'eleven',
            'twelve',
            'thirteen',
            'fourteen',
            'fifteen',
            'sixteen',
            'seventeen',
            'eighteen',
            'nineteen',
            'twenty',
            'thirty',
            'forty',
            'fifty',
            'sixty',
            'seventy',
            'eighty',
            'ninety',
            'hundred',
        ]),
        Toward: 'toward ',
        Last: -1,
        Wears: ' wears ',
        Secretly: ' secretly ',
        OnlyOpen: '; only ',
        KnowsOne: ' knows.',
        KnowMany: ' know.',
        NoOneElse: '; no one else here knows.',
        Party: 'The party: ',
        Semicolon: '; ',
        Colon: ': ',
        Comma: ', ',
        And: ' and ',
        FullStop: '.',

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
        get Frame() {
            return /[\[\]@]/u;
        },

        /**
         * @return {RegExp}
         */
        get Frames() {
            return /[\[\]@]/gu;
        },

        /**
         * @return {RegExp}
         */
        get SentenceEnd() {
            return /[.!?…]["'”’)\]]*(?=\s|$)/gu;
        },

        /**
         * @return {RegExp}
         */
        get WordEnd() {
            return /\S(?=\s)/gu;
        },

        /**
         * @return {RegExp}
         */
        get EchoedLabel() {
            return /^[\s>*_"'“”‘’`]*(?:the\s+)?(?:story\s+)?so\s+far[*_"'“”‘’`]*\s*(?::|[—–]|-\s)[\s>*_"'“”‘’`]*/iu;
        },

        /**
         * @return {RegExp}
         */
        get HeadedLabel() {
            return /^\s*(?:#+|\*\*|__|>)\s*(?:the\s+)?(?:story\s+)?so\s+far\s*(?:\*\*|__)?\s*\r?\n[\s>]*/iu;
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
        get LabelCharacters() {
            return /^[\p{Lu}\p{Ll}\p{Lt}\p{Mn}0-9 '\u{2019}-]+$/u;
        },

        /**
         * @return {RegExp}
         */
        get WearingLead() {
            return /^(?:(?:is|are)\s+)?(?:wears|wearing)\s+/iu;
        },

        /**
         * @return {RegExp}
         */
        get ClauseBreak() {
            return /[,;(]/u;
        },

        /**
         * @return {RegExp}
         */
        get Numeral() {
            return /^\p{N}/u;
        },

        /**
         * @return {RegExp}
         */
        get Plural() {
            return /\p{L}[^isu]s$/u;
        },

        /**
         * @return {RegExp}
         */
        get PresentVerb() {
            return /\p{L}[^aiosu]s$/u;
        },

        /**
         * @return {RegExp}
         */
        get Progressive() {
            return /\p{L}{2}ing$/u;
        },
    }),

    /**
     * @return {string}
     */
    get StoryPrompt() {
        return ScribeReminder.Settings.StoryPromptLines.join(ScribeReminder.Settings.Newline);
    },

    /**
     * @param {string} text
     * @return {number}
     */
    span(text) {
        return Array.from(text).length;
    },

    /**
     * @param {object} state
     * @param {object|null} now
     * @return {string}
     */
    storyInput(state, now) {
        const settings = ScribeReminder.Settings;
        const headings = settings.StoryHeadings;
        const lines = state.scenes.map(
            /**
             * @param {{ day: number, place: string, summary: string }} scene
             * @return {string}
             */
            (scene) => [settings.Day + scene.day, scene.place, scene.summary].join(settings.Joiner),
        );
        let scenes = lines;
        if (ScribeReminder.span(lines.join(settings.Newline)) > settings.LongestTimeline) {
            const first = lines.slice(0, settings.FirstScenes);
            const newest = [];
            let used = ScribeReminder.span(first.join(settings.Newline));
            for (const line of lines.slice(settings.FirstScenes).reverse()) {
                const after = used + ScribeReminder.span(settings.Newline + line);
                if (after > settings.LongestTimeline) {
                    break;
                }
                newest.unshift(line);
                used = after;
            }
            scenes = [...first, ...newest];
        }
        const threads = [];
        for (const thread of state.threads) {
            if (thread.closed === null) {
                threads.push(settings.ListMarker + thread.text);
            }
        }
        const summary = now === null || now.summary.trim() === settings.Nothing ? settings.None : now.summary;
        return [
            [headings.Timeline, scenes.length === 0 ? settings.None : scenes.join(settings.Newline)],
            [headings.Threads, threads.length === 0 ? settings.None : threads.join(settings.Newline)],
            [headings.Now, summary],
        ]
            .map(
                /**
                 * @param {string[]} section
                 * @return {string}
                 */
                (section) => section.join(settings.Newline),
            )
            .join(settings.BlankLine);
    },

    /**
     * @param {string} text
     * @return {string|null}
     */
    told(text) {
        const settings = ScribeReminder.Settings;
        const said = ScribeIntake.collapse(
            ScribeReminder.clean(
                text.replace(settings.HeadedLabel, settings.Nothing).replace(settings.EchoedLabel, settings.Nothing),
                settings.NormalForm,
            )
                .replace(settings.Frames, settings.Nothing)
                .replace(settings.Backslashes, settings.Slash),
        );
        return said === settings.Nothing ? null : said;
    },

    /**
     * @param {string} text
     * @return {number[]}
     */
    ends(text) {
        const settings = ScribeReminder.Settings;
        const opening = (ScribeIntake.Settings.OwnMarker + settings.Space + settings.StoryOpen).length;
        const ends = [];
        for (const match of text.matchAll(settings.SentenceEnd)) {
            const end = match.index + match[0].length;
            if (end > opening && end < text.length) {
                ends.push(end);
            }
        }
        return ends;
    },

    /**
     * @param {string} text
     * @param {number} limit
     * @return {string}
     */
    cut(text, limit) {
        const settings = ScribeReminder.Settings;
        const characters = Array.from(text);
        if (characters.length <= limit) {
            return text;
        }
        const room = characters.slice(0, limit).join(settings.Nothing).length;
        let end = 0;
        for (const pattern of [settings.SentenceEnd, settings.WordEnd]) {
            for (const match of text.matchAll(pattern)) {
                const reach = match.index + match[0].length;
                if (reach <= room) {
                    end = reach;
                }
            }
            if (end > 0) {
                break;
            }
        }
        return text.slice(0, end === 0 ? room : end).trim();
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
     * @return {string|null}
     */
    guarded(text) {
        const settings = ScribeReminder.Settings;
        const said = ScribeReminder.clean(text, settings.WrittenForm)
            .replace(settings.TrailingMarks, settings.Nothing)
            .replace(settings.Backslashes, settings.Slash);
        const fits =
            said !== settings.Nothing &&
            !settings.Frame.test(said.normalize(settings.NormalForm)) &&
            Array.from(said).length <= settings.LongestText;
        return fits ? said : null;
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
             * @param {{ label: string|null }} person
             * @return {string|null}
             */
            (person) => (person.label === null ? null : ScribeReminder.printed(person.label)),
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
        const words = ScribeReminder.wordsOf(player);
        const standing = state.subjects.filter(
            /**
             * @param {{ mergedInto: string|null }} subject
             * @return {boolean}
             */
            (subject) => subject.mergedInto === null,
        );
        const exact = standing.filter(
            /**
             * @param {{ label: string, name: string, aka: readonly string[] }} subject
             * @return {boolean}
             */
            (subject) =>
                [subject.label, subject.name, ...subject.aka].some(
                    /**
                     * @param {string} name
                     * @return {boolean}
                     */
                    (name) => ScribeText.normaliseName(name) === wanted,
                ),
        );
        const close = standing.filter(
            /**
             * @param {{ kind: string, label: string, name: string }} subject
             * @return {boolean}
             */
            (subject) =>
                subject.kind === ScribeCategory.SubjectKinds.Character &&
                [subject.label, subject.name].some(
                    /**
                     * @param {string} name
                     * @return {boolean}
                     */
                    (name) => ScribeReminder.begins(ScribeReminder.wordsOf(name), words),
                ),
        );
        return Object.freeze(
            (exact.length > 0 ? exact : close).map(
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
     * @return {ReadonlyArray<Readonly<{ subject: string|null, label: string|null, own: string|null }>>}
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
         * @param {string|null} owner
         * @return {boolean}
         */
        const elsewhere = (index, key, owner) => {
            const owners = index.get(key);
            return owners !== undefined && (owners.size > 1 || !owners.has(owner));
        };
        const playerKey = keyOf(player);
        const article = ScribeText.normaliseName(settings.Article);
        /**
         * @param {string|null} printed
         * @param {string|null} subject
         * @return {{ label: string|null, own: string|null }}
         */
        const allowed = (printed, subject) => {
            if (printed === null) {
                return { label: null, own: null };
            }
            const key = ScribeText.normaliseName(printed);
            const mine = subject !== null && subject === self;
            const taken = elsewhere(names, key, subject) || (key === playerKey && !mine);
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
            return {
                label: taken || speaks ? null : printed,
                own: taken || (speaks && subject === null) ? null : printed,
            };
        };
        const found = [];
        const seen = new Set();
        const strangers = new Set();
        for (const person of now.present) {
            if (person.subject === null) {
                const key = ScribeText.normaliseName(person.label);
                if (!strangers.has(key)) {
                    strangers.add(key);
                    found.push({ subject: null, ...allowed(ScribeReminder.printed(person.label), null) });
                }
                continue;
            }
            const subject = ScribeKnowledge.survivor(state, person.subject);
            if (!seen.has(subject)) {
                seen.add(subject);
                const printed = books.has(subject) ? ScribeReminder.printed(books.get(subject)) : null;
                found.push({ subject, ...allowed(printed, subject) });
            }
        }
        const labels = ScribeReminder.named(found);
        const owns = ScribeReminder.named(
            found.map(
                /**
                 * @param {{ subject: string|null, own: string|null }} person
                 * @return {{ subject: string|null, label: string|null }}
                 */
                (person) => ({ subject: person.subject, label: person.own }),
            ),
        );
        return Object.freeze(
            found.map(
                /**
                 * @param {{ subject: string|null }} person
                 * @param {number} index
                 * @return {Readonly<{ subject: string|null, label: string|null, own: string|null }>}
                 */
                (person, index) => Object.freeze({ subject: person.subject, label: labels[index], own: owns[index] }),
            ),
        );
    },

    /**
     * @param {string} name
     * @return {string[]}
     */
    wordsOf(name) {
        return ScribeText.normaliseName(name).split(ScribeReminder.Settings.Space);
    },

    /**
     * @param {readonly string[]} first
     * @param {readonly string[]} second
     * @return {boolean}
     */
    begins(first, second) {
        const shorter = first.length <= second.length ? first : second;
        const longer = shorter === first ? second : first;
        return shorter.every(
            /**
             * @param {string} word
             * @param {number} index
             * @return {boolean}
             */
            (word, index) => word === longer[index],
        );
    },

    /**
     * @param {readonly object[]} notes
     * @param {{ keys: readonly string[], label: string|null }} person
     * @param {string} kind
     * @param {ReadonlyArray<{ keys: readonly string[] }>} present
     * @param {function(string, object): boolean} foreign
     * @return {object|null}
     */
    noteOf(notes, person, kind, present, foreign) {
        let found = null;
        for (const note of notes) {
            if (note.kind !== kind) {
                continue;
            }
            const key = ScribeText.normaliseName(note.name);
            const words = ScribeReminder.wordsOf(note.name);
            /**
             * @param {{ keys: readonly string[] }} other
             * @return {boolean}
             */
            const near = (other) =>
                other.keys.some(
                    /**
                     * @param {string} name
                     * @return {boolean}
                     */
                    (name) => ScribeReminder.begins(ScribeReminder.wordsOf(name), words),
                );
            /**
             * @param {{ keys: readonly string[] }} other
             * @return {boolean}
             */
            const same = (other) => other.keys.includes(key);
            const free = person.keys.some(
                /**
                 * @param {string} name
                 * @return {boolean}
                 */
                (name) => {
                    const form = ScribeReminder.wordsOf(name);
                    const shared = form.length < words.length ? name : key;
                    return ScribeReminder.begins(form, words) && !foreign(ScribeText.normaliseName(shared), person);
                },
            );
            const exact = same(person) && present.filter(same).length === 1;
            const close = person.label !== null && !same(person) && free && present.filter(near).length === 1;
            if ((exact || close) && (found === null || note.position > found.position)) {
                found = note;
            }
        }
        return found;
    },

    /**
     * @param {object} state
     * @param {string} subject
     * @param {*} characters
     * @return {string|null}
     */
    writer(state, subject, characters) {
        if (!Array.isArray(characters)) {
            return null;
        }
        const record = state.subjects.find(
            /**
             * @param {{ id: string }} candidate
             * @return {boolean}
             */
            (candidate) => candidate.id === subject,
        );
        if (record === undefined || record.kind !== ScribeCategory.SubjectKinds.Character) {
            return null;
        }
        const forms = [record.label, record.name, ...record.aka];
        const keys = forms.map(
            /**
             * @param {string} form
             * @return {string}
             */
            (form) => ScribeText.normaliseName(form),
        );
        let found = null;
        for (const character of characters) {
            if (keys.includes(ScribeText.normaliseName(character.name))) {
                return character.description;
            }
            const words = ScribeReminder.wordsOf(character.name);
            const near = forms.some(
                /**
                 * @param {string} form
                 * @return {boolean}
                 */
                (form) => ScribeReminder.begins(ScribeReminder.wordsOf(form), words),
            );
            if (found === null && near) {
                found = character.description;
            }
        }
        return found;
    },

    /**
     * @param {string} text
     * @return {string[]}
     */
    content(text) {
        const light = ScribeReminder.Settings.LightWords;
        return ScribeText.words(text).filter(
            /**
             * @param {string} word
             * @return {boolean}
             */
            (word) => !light.includes(word),
        );
    },

    /**
     * @param {readonly string[]} sought
     * @param {readonly string[]} words
     * @return {number[]}
     */
    within(sought, words) {
        const starts = [];
        for (let index = 0; sought.length > 0 && index + sought.length <= words.length; index++) {
            const matched = sought.every(
                /**
                 * @param {string} word
                 * @param {number} offset
                 * @return {boolean}
                 */
                (word, offset) => word === words[index + offset],
            );
            if (matched) {
                starts.push(index);
            }
        }
        return starts;
    },

    /**
     * @param {string} text
     * @param {string} description
     * @return {boolean}
     */
    added(text, description) {
        const sought = ScribeReminder.content(text);
        return sought.length > 0 && ScribeReminder.within(sought, ScribeReminder.content(description)).length === 0;
    },

    /**
     * @param {string} text
     * @param {readonly string[]} phrases
     * @return {boolean}
     */
    restates(text, phrases) {
        const words = ScribeReminder.content(text);
        const covered = new Set();
        for (const phrase of phrases) {
            const sought = ScribeReminder.content(phrase);
            for (const start of ScribeReminder.within(sought, words)) {
                for (let offset = 0; offset < sought.length; offset++) {
                    covered.add(start + offset);
                }
            }
        }
        return covered.size === words.length;
    },

    /**
     * @param {string} text
     * @return {string[]}
     */
    tokens(text) {
        const settings = ScribeReminder.Settings;
        return text.split(settings.Space).map(
            /**
             * @param {string} token
             * @return {string}
             */
            (token) => {
                const [word = settings.Nothing] = ScribeText.words(token);
                return word;
            },
        );
    },

    /**
     * @param {string} text
     * @return {string}
     */
    head(text) {
        const settings = ScribeReminder.Settings;
        const cut = text.search(settings.ClauseBreak);
        return (cut === settings.NotFound ? text : text.slice(0, cut)).trimEnd();
    },

    /**
     * @param {string} text
     * @return {boolean}
     */
    linked(text) {
        return ScribeReminder.tokens(text).some(
            /**
             * @param {string} token
             * @return {boolean}
             */
            (token) => ScribeReminder.Settings.Prepositions.includes(token),
        );
    },

    /**
     * @param {string} word
     * @return {boolean}
     */
    counted(word) {
        const settings = ScribeReminder.Settings;
        return settings.Numeral.test(word) || settings.NumberWords.includes(word);
    },

    /**
     * @param {string} category
     * @param {string} text
     * @return {string}
     */
    looked(category, text) {
        const settings = ScribeReminder.Settings;
        if (!Object.hasOwn(settings.LookClauses, category)) {
            return text;
        }
        const clause = settings.LookClauses[category];
        const marked = ScribeText.words(text).some(
            /**
             * @param {string} word
             * @return {boolean}
             */
            (word) => clause.nouns.includes(word) || clause.adjectives.includes(word),
        );
        const head = ScribeReminder.head(text);
        const [first] = ScribeReminder.tokens(head);
        const counted = ScribeReminder.counted(first);
        const bare = clause.counted
            ? counted
            : !counted && !settings.Determiners.includes(first) && !ScribeReminder.linked(head);
        if (marked || !bare || head === settings.Nothing) {
            return text;
        }
        return clause.prefix + head + clause.suffix + text.slice(head.length);
    },

    /**
     * @param {string} category
     * @param {string} text
     * @return {string}
     */
    stated(category, text) {
        const settings = ScribeReminder.Settings;
        const shapes = ScribeReminder.Shape;
        const shape = Object.hasOwn(settings.Shapes, category) ? settings.Shapes[category] : shapes.Habit;
        const tokens = ScribeReminder.tokens(text);
        const [first] = tokens;
        const single = tokens.length === 1;
        const second = single ? settings.Nothing : tokens[1];
        const named = settings.Determiners.includes(first) || ScribeReminder.counted(first);
        const opening = settings.Prepositions.includes(first) || settings.Progressive.test(first);
        const loose = single || settings.Prepositions.includes(second) || settings.Joiners.includes(second);
        const acting = settings.PresentVerb.test(first);
        if (shape === shapes.Named) {
            return settings.Called[category] + text;
        }
        if (shape === shapes.Look) {
            const look = ScribeReminder.looked(category, text);
            const clause = settings.LookClauses[category];
            const adjective = ScribeText.words(text).some(
                /**
                 * @param {string} word
                 * @return {boolean}
                 */
                (word) => clause.adjectives.includes(word),
            );
            const noun = look !== text || named || clause.nouns.includes(first);
            const being = clause.counted || (!noun && (adjective || ScribeReminder.linked(ScribeReminder.head(text))));
            return (being ? settings.Is : settings.Has) + look;
        }
        if (settings.Leads.includes(first)) {
            return text;
        }
        if (shape === shapes.Past) {
            return named || opening ? settings.Was + text : text;
        }
        if (opening) {
            return settings.Is + text;
        }
        if (shape === shapes.Owned) {
            return settings.Has + text;
        }
        if (shape === shapes.Where) {
            return acting ? text : settings.IsAt + text;
        }
        if (shape === shapes.State) {
            return acting ? text : settings.Is + text;
        }
        if (named) {
            return settings.Has + text;
        }
        if (shape === shapes.Habit) {
            return acting ? text : settings.Is + text;
        }
        if (settings.Plural.test(first)) {
            return single && shape === shapes.Passing ? settings.IsIn + text : settings.Has + text;
        }
        return loose ? settings.Is + text : settings.Has + text;
    },

    /**
     * @param {{ state: object, now: ?object, player: string, unread: *, notes: *, characters: *, first: *, story?: string|null }} request
     * @return {Readonly<{ text: string, led: readonly string[] }>|null}
     */
    compose({ state, now, player, unread, notes, characters, first, story = null }) {
        const settings = ScribeReminder.Settings;
        const parts = ScribeReminder.Part;
        const kinds = ScribePedant.Note;
        const everyone = ScribeKnowledge.Everyone;
        const relation = ScribeCategory.Settings.RelationCategory;
        const wanted = Array.isArray(first) ? first : [];
        const namesakes = ScribeReminder.namesakes(state, player);
        const self = namesakes.length === 1 ? namesakes[0] : null;
        const seen = now === null ? [] : now.present;
        const heard = self === null ? seen : [...seen, { subject: self, label: settings.Nothing }];
        const records = new Map();
        const owners = new Map();
        const holders = new Map();
        for (const subject of state.subjects) {
            const owner = subject.mergedInto === null ? subject.id : subject.mergedInto;
            records.set(subject.id, subject);
            owners.set(subject.id, owner);
            for (const name of [subject.label, subject.name, ...subject.aka]) {
                const key = ScribeText.normaliseName(name);
                const held = holders.get(key) ?? new Set();
                held.add(owner);
                holders.set(key, held);
            }
        }
        const playerKey = ScribeText.normaliseName(player);
        /**
         * @param {string} key
         * @param {{ subject: string|null, self: boolean }} person
         * @return {boolean}
         */
        const foreign = (key, person) => {
            const held = holders.get(key);
            const other = held !== undefined && (held.size > 1 || !held.has(person.subject));
            return other || (key === playerKey && !person.self);
        };
        const present = ScribeReminder.people(state, { present: heard }, player).map(
            /**
             * @param {{ subject: string|null, label: string|null, own: string|null }} person
             * @return {{ subject: string|null, label: string|null, own: string|null, keys: string[], self: boolean }}
             */
            (person) => {
                const record = person.subject === null ? undefined : records.get(person.subject);
                const mine = person.subject !== null && person.subject === self;
                const forms = [
                    ...(person.own === null ? [] : [person.own]),
                    ...(record === undefined ? [] : [record.label, record.name, ...record.aka]),
                    ...(mine ? [player] : []),
                ];
                const keys = [
                    ...new Set(
                        forms.map(
                            /**
                             * @param {string} form
                             * @return {string}
                             */
                            (form) => ScribeText.normaliseName(form),
                        ),
                    ),
                ];
                return { subject: person.subject, label: person.label, own: person.own, keys, self: mine };
            },
        );
        const inRoom = new Set();
        const names = new Map();
        for (const person of present) {
            if (person.subject !== null) {
                inRoom.add(person.subject);
                names.set(person.subject, person.label);
            }
        }
        const contested = new Set();
        for (const conflict of state.conflicts) {
            contested.add(conflict.established);
            for (const id of conflict.others) {
                contested.add(id);
            }
        }
        const byId = new Map();
        const factsOf = new Map();
        for (const fact of state.facts) {
            byId.set(fact.id, fact);
            const owner = owners.get(fact.subject);
            const listed = factsOf.get(owner) ?? [];
            listed.push(fact);
            factsOf.set(owner, listed);
        }
        const thinner = new Map();
        for (const refinement of state.refinements) {
            thinner.set(refinement.to, byId.get(refinement.from));
        }
        /**
         * @param {object} fact
         * @return {boolean}
         */
        const quarrel = (fact) => {
            for (let wording = fact; wording !== undefined; wording = thinner.get(wording.id)) {
                if (contested.has(wording.id)) {
                    return true;
                }
            }
            return false;
        };
        /**
         * @param {object} fact
         * @return {boolean}
         */
        const veiled = (fact) => fact.hidden && fact.widened !== everyone;
        /**
         * @param {object} fact
         * @return {boolean}
         */
        const usable = (fact) => {
            const kind = ScribeReplay.kindOf(fact.category);
            const changing = kind === ScribeCategory.Kind.Moving || kind === ScribeCategory.Kind.Passing;
            const target = fact.target === null ? null : ScribeKnowledge.survivor(state, fact.target);
            const aimed = fact.category !== relation || (target !== null && inRoom.has(target));
            return (
                fact.status === ScribeReplay.Status.InForce &&
                !(changing && unread.length > 0) &&
                aimed &&
                !quarrel(fact)
            );
        };
        /**
         * @param {object} fact
         * @return {string|null}
         */
        const clause = (fact) => {
            const text = ScribeReminder.guarded(fact.text);
            if (text === null) {
                return null;
            }
            if (fact.category === relation) {
                const target = names.get(ScribeKnowledge.survivor(state, fact.target));
                return target === null ? null : settings.Toward + target + settings.Colon + text;
            }
            return ScribeReminder.stated(fact.category, text);
        };
        /**
         * @param {object} fact
         * @return {string}
         */
        const joint = (fact) => (veiled(fact) && fact.category !== relation ? settings.Secretly : settings.Space);
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
         * @param {readonly string[]} labels
         * @return {string}
         */
        const listed = (labels) =>
            labels.length === 1
                ? labels[0]
                : labels.slice(0, settings.Last).join(settings.Comma) + settings.And + labels.at(settings.Last);
        /**
         * @param {{ subject: string|null }} person
         * @return {object[]}
         */
        const factsAbout = (person) => (person.subject === null ? [] : (factsOf.get(person.subject) ?? []));
        /**
         * @param {object} person
         * @param {object} fact
         * @return {{ tail: string|null, everyone: boolean }}
         */
        const audience = (person, fact) => {
            const watching = present.filter(
                /**
                 * @param {object} other
                 * @return {boolean}
                 */
                (other) => other !== person,
            );
            const knowers = watching.filter(
                /**
                 * @param {object} other
                 * @return {boolean}
                 */
                (other) => knowing(other, fact),
            );
            const unnamed = knowers.some(
                /**
                 * @param {{ label: string|null }} knower
                 * @return {boolean}
                 */
                (knower) => knower.label === null,
            );
            const labels = knowers.map(
                /**
                 * @param {{ label: string|null }} knower
                 * @return {string|null}
                 */
                (knower) => knower.label,
            );
            const verb = labels.length === 1 ? settings.KnowsOne : settings.KnowMany;
            const tail = labels.length === 0 ? settings.NoOneElse : settings.OnlyOpen + listed(labels) + verb;
            return { tail: unnamed ? null : tail, everyone: knowers.length === watching.length };
        };
        const pieces = [];
        const said = new Set();
        for (const id of wanted) {
            const fact = byId.get(id);
            if (fact === undefined || said.has(id) || !usable(fact)) {
                continue;
            }
            const owner = owners.get(fact.subject);
            const person = present.find(
                /**
                 * @param {{ subject: string|null }} candidate
                 * @return {boolean}
                 */
                (candidate) => candidate.subject === owner,
            );
            const words = clause(fact);
            if (person === undefined || person.label === null || words === null || (veiled(fact) && person.self)) {
                continue;
            }
            const tail = veiled(fact) ? audience(person, fact).tail : settings.FullStop;
            if (tail !== null) {
                said.add(id);
                const text = person.label + joint(fact) + words + tail;
                pieces.push({ part: parts.Correction, person, fact: id, text });
            }
        }
        for (const person of present) {
            const note =
                person.own === null ? null : ScribeReminder.noteOf(notes, person, kinds.Wearing, present, foreign);
            const worn = note === null ? null : note.text.replace(settings.WearingLead, settings.Nothing);
            const text = worn === null ? null : ScribeReminder.guarded(worn);
            if (text !== null) {
                pieces.push({ part: parts.Wearing, person, fact: null, text });
            }
        }
        const others = present.filter(
            /**
             * @param {{ self: boolean, label: string|null }} person
             * @return {boolean}
             */
            (person) => !person.self && person.label !== null,
        );
        for (const person of others) {
            for (const fact of factsAbout(person)) {
                if (said.has(fact.id) || !veiled(fact) || !usable(fact)) {
                    continue;
                }
                const known = audience(person, fact);
                const words = clause(fact);
                if (known.everyone || known.tail === null || words === null) {
                    continue;
                }
                said.add(fact.id);
                const text = person.label + joint(fact) + words + known.tail;
                pieces.push({ part: parts.Secret, person, fact: null, text });
            }
        }
        for (const person of others) {
            for (const fact of factsAbout(person)) {
                const filed = settings.FiledOrigins.includes(fact.origin);
                if (said.has(fact.id) || veiled(fact) || !filed || !usable(fact)) {
                    continue;
                }
                const words = clause(fact);
                if (words !== null) {
                    said.add(fact.id);
                    const text = person.label + settings.Space + words + settings.FullStop;
                    pieces.push({ part: parts.Filed, person, fact: null, text });
                }
            }
        }
        const shown = present.filter(
            /**
             * @param {{ self: boolean, own: string|null }} person
             * @return {boolean}
             */
            (person) => !person.self && person.own !== null,
        );
        for (const person of shown) {
            const description =
                person.subject === null ? null : ScribeReminder.writer(state, person.subject, characters);
            const standing = factsAbout(person).filter(
                /**
                 * @param {object} fact
                 * @return {boolean}
                 */
                (fact) =>
                    settings.LooksCategories.includes(fact.category) &&
                    fact.status === ScribeReplay.Status.InForce &&
                    !veiled(fact),
            );
            const note = ScribeReminder.noteOf(notes, person, kinds.Looks, present, foreign);
            const newest =
                note !== null &&
                standing.every(
                    /**
                     * @param {{ position: number }} fact
                     * @return {boolean}
                     */
                    (fact) => fact.position < note.position,
                );
            const items = [];
            const spoken = [];
            for (const category of settings.LooksCategories) {
                const facts = standing
                    .filter(
                        /**
                         * @param {object} fact
                         * @return {boolean}
                         */
                        (fact) => fact.category === category && usable(fact),
                    )
                    .sort(
                        /**
                         * @param {{ position: number }} earlier
                         * @param {{ position: number }} later
                         * @return {number}
                         */
                        (earlier, later) => earlier.position - later.position,
                    );
                for (const fact of facts) {
                    const text = ScribeReminder.guarded(fact.text);
                    if (text === null) {
                        continue;
                    }
                    const look = ScribeReminder.looked(category, text);
                    if (said.has(fact.id)) {
                        spoken.push(look);
                    } else if (!newest && (description === null || ScribeReminder.added(look, description))) {
                        items.push(look);
                        spoken.push(look);
                    }
                }
            }
            const text = note === null ? null : ScribeReminder.guarded(note.text);
            const fits = text !== null && (description === null || ScribeReminder.added(text, description));
            if (fits && !ScribeReminder.restates(text, spoken)) {
                items.push(text);
            }
            if (items.length > 0) {
                pieces.push({ part: parts.Looks, person, fact: null, text: items.join(settings.Comma) });
            }
        }
        const places = [];
        for (const subject of state.subjects) {
            if (subject.mergedInto === null && subject.kind === ScribeCategory.SubjectKinds.Place) {
                places.push(subject);
            }
        }
        const threads = [];
        for (const thread of state.threads) {
            const text = thread.closed === null ? ScribeReminder.guarded(thread.text) : null;
            if (text !== null) {
                threads.push({ text, position: thread.position });
            }
        }
        threads.sort(
            /**
             * @param {{ position: number }} earlier
             * @param {{ position: number }} later
             * @return {number}
             */
            (earlier, later) => later.position - earlier.position,
        );
        const forms = [];
        for (const place of places) {
            for (const form of [place.label, place.name, ...place.aka]) {
                forms.push({ place, sought: ScribeText.words(form) });
            }
        }
        forms.sort(
            /**
             * @param {{ sought: readonly string[] }} longer
             * @param {{ sought: readonly string[] }} shorter
             * @return {number}
             */
            (longer, shorter) => shorter.sought.length - longer.sought.length,
        );
        let job = null;
        let visited = [];
        for (const thread of threads) {
            const words = ScribeText.words(thread.text);
            const claimed = new Set();
            const earliest = new Map();
            for (const { place, sought } of forms) {
                for (const start of ScribeReminder.within(sought, words)) {
                    const span = [];
                    for (let offset = 0; offset < sought.length; offset++) {
                        span.push(start + offset);
                    }
                    const free = span.every(
                        /**
                         * @param {number} index
                         * @return {boolean}
                         */
                        (index) => !claimed.has(index),
                    );
                    if (free) {
                        for (const index of span) {
                            claimed.add(index);
                        }
                        earliest.set(place, Math.min(start, earliest.get(place) ?? start));
                    }
                }
            }
            const named = Array.from(
                earliest,
                /**
                 * @param {Array<object|number>} entry
                 * @return {{ place: object, earliest: number }}
                 */
                ([place, index]) => ({ place, earliest: index }),
            );
            if (named.length > 0) {
                job = thread;
                visited = named.sort(
                    /**
                     * @param {{ earliest: number }} before
                     * @param {{ earliest: number }} after
                     * @return {number}
                     */
                    (before, after) => before.earliest - after.earliest,
                );
                break;
            }
        }
        if (job === null && threads.length > 0) {
            job = threads[0];
        }
        if (job !== null) {
            const text = settings.Party + job.text + settings.FullStop;
            pieces.push({ part: parts.Job, person: null, fact: null, text });
        }
        let described = 0;
        for (const { place } of visited) {
            const label = ScribeReminder.guarded(place.label);
            let newest = null;
            for (const fact of factsOf.get(place.id) ?? []) {
                const fitting =
                    settings.PlaceCategories.includes(fact.category) &&
                    fact.status === ScribeReplay.Status.InForce &&
                    !veiled(fact) &&
                    !quarrel(fact) &&
                    ScribeReminder.guarded(fact.text) !== null;
                if (fitting && (newest === null || fact.position > newest.position)) {
                    newest = fact;
                }
            }
            if (described < settings.MostPlaces && label !== null && newest !== null) {
                described++;
                const text = label + settings.Colon + ScribeReminder.guarded(newest.text) + settings.FullStop;
                pieces.push({ part: parts.Place, person: null, fact: null, text });
            }
        }
        /**
         * @param {readonly object[]} kept
         * @return {string}
         */
        const render = (kept) => {
            const sentences = [];
            for (const piece of kept) {
                /**
                 * @param {string} part
                 * @return {object|undefined}
                 */
                const sibling = (part) =>
                    kept.find(
                        /**
                         * @param {{ part: string, person: object|null }} other
                         * @return {boolean}
                         */
                        (other) => other.part === part && other.person === piece.person,
                    );
                if (piece.part === parts.Wearing) {
                    const looks = sibling(parts.Looks);
                    const tail = looks === undefined ? settings.Nothing : settings.Semicolon + looks.text;
                    sentences.push(piece.person.own + settings.Wears + piece.text + tail + settings.FullStop);
                } else if (piece.part !== parts.Looks) {
                    sentences.push(piece.text);
                } else if (sibling(parts.Wearing) === undefined) {
                    sentences.push(piece.person.own + settings.Colon + piece.text + settings.FullStop);
                }
            }
            return [ScribeIntake.Settings.OwnMarker, ...told, ...sentences].join(settings.Space);
        };
        const opening = ScribeIntake.Settings.OwnMarker + settings.Space + settings.StoryOpen;
        const room = settings.MaxCharacters - ScribeReminder.span(opening);
        const told = story === null ? [] : [settings.StoryOpen + ScribeReminder.cut(story, room)];
        const kept = [...pieces];
        let text = render(kept);
        while (kept.length > 0 && ScribeReminder.span(text) > settings.MaxCharacters) {
            kept.pop();
            text = render(kept);
        }
        if (kept.length === 0 && told.length === 0) {
            return null;
        }
        const led = kept
            .filter(
                /**
                 * @param {{ part: string }} piece
                 * @return {boolean}
                 */
                (piece) => piece.part === parts.Correction,
            )
            .map(
                /**
                 * @param {{ fact: string }} piece
                 * @return {string}
                 */
                (piece) => piece.fact,
            );
        return Object.freeze({ text, led: Object.freeze(led) });
    },
});
