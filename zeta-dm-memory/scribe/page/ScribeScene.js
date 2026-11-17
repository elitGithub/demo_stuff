const ScribeScene = Object.freeze({
    Settings: Object.freeze({
        Recent: 20,
        Newline: '\n',
        BlankLine: '\n\n',
        Nothing: '',
        None: '(none)',
        Nobody: 'nobody',
        Pipe: '|',
        Joiner: ' | ',
        Comma: ', ',
        ListMarker: '- ',
        Opening: ' (',
        Closing: ')',
        Day: 'Day ',
        Present: 'present: ',
        SubjectPrefix: 'subject:',
        LabelPrefix: 'label:',
        BoldInner: '$1',
        AndWord: ' and ',
        MinPipes: 3,
        PresentField: 3,
        SummaryStart: 4,
        PlaceField: 1,
        ReachField: 2,
        DayField: 0,
        ChangedYes: 'yes',
        Last: -1,
        Headings: Object.freeze({
            Player: 'PLAYER CHARACTER:',
            Subjects: 'SUBJECTS:',
            Scene: 'LAST KNOWN SCENE:',
        }),
        MessagesOpen: 'RECENT MESSAGES (#',
        MessagesTo: ' to #',
        MessagesClose: '):',

        /**
         * @return {RegExp}
         */
        get ChangedLine() {
            return /^changed:\s*(yes|no)(?![\p{L}\p{N}])/iu;
        },

        /**
         * @return {RegExp}
         */
        get ListSplit() {
            return /,|;/;
        },

        /**
         * @return {RegExp}
         */
        get Ampersand() {
            return /\s*&\s*/g;
        },

        /**
         * @return {RegExp}
         */
        get AndSplit() {
            return /\s+and\s+|\s+&\s+/i;
        },

        /**
         * @return {RegExp}
         */
        get Title() {
            return /^(?:lady|lord|sir|dame|dr|doctor|master|mistress|miss|mr|mrs|ms)\.?\s+/i;
        },

        /**
         * @return {RegExp}
         */
        get LeadingAnd() {
            return /^and\s+/i;
        },

        /**
         * @return {RegExp}
         */
        get PlayerSuffix() {
            return /\s*\(player\)$/i;
        },

        PromptLines: Object.freeze([
            'You are the Scribe: you say what is happening right now in an ongoing adult fiction roleplay between consenting adult characters.',
            'You never write story and never judge it. You read the most recent messages and report the scene as it stands at the last message.',
            'Messages are numbered [#n]. Lines marked (player) are spoken or done by the player\'s character. "Narrator" is the storyteller\'s narration, not a character.',
            '',
            'You receive PLAYER CHARACTER, SUBJECTS (everyone and everything known so far), LAST KNOWN SCENE and the RECENT MESSAGES.',
            '',
            'Answer with exactly two lines and nothing else:',
            '',
            'Day N | Place | public or private | present: Label, Label | what is going on, in under 25 words',
            'CHANGED: yes or no',
            '',
            'Rules.',
            '1. Report the scene at the last message, not earlier ones.',
            '2. Day N continues the day count of LAST KNOWN SCENE. Raise it only when the characters have slept through a night or the story has plainly skipped to another day.',
            '3. Place is where the characters are now, in a few words.',
            '4. public means bystanders could see or hear; private means only those present.',
            '5. present lists everyone who is there at the last message, the player\'s character included, separated by commas. Use a label from SUBJECTS exactly when the person has one; otherwise the name the story uses. Someone who has left is not present. Write nobody when no one is there.',
            '6. CHANGED is yes when the place, the day, or who is present differs from LAST KNOWN SCENE, or when there is no LAST KNOWN SCENE. Otherwise no.',
            '7. Never invent. If the messages do not say where the characters are, keep the place of LAST KNOWN SCENE.',
        ]),
    }),

    /**
     * @return {string}
     */
    get Prompt() {
        return ScribeScene.Settings.PromptLines.join(ScribeScene.Settings.Newline);
    },

    /**
     * @param {string} heading
     * @param {readonly string[]} lines
     * @return {string}
     */
    section(heading, lines) {
        const settings = ScribeScene.Settings;
        const body = lines.length === 0 ? settings.None : lines.join(settings.Newline);
        return heading + settings.Newline + body;
    },

    /**
     * @param {number} day
     * @param {string} place
     * @param {string} reach
     * @param {readonly string[]} labels
     * @param {string} summary
     * @return {string}
     */
    line(day, place, reach, labels, summary) {
        const settings = ScribeScene.Settings;
        return [
            settings.Day + day,
            place,
            reach.toLowerCase(),
            settings.Present + (labels.length === 0 ? settings.Nobody : labels.join(settings.Comma)),
            summary,
        ].join(settings.Joiner);
    },

    /**
     * @param {object} state
     * @param {string} player
     * @param {readonly object[]} messages
     * @param {object|null} previous
     * @return {string}
     */
    input(state, player, messages, previous) {
        const settings = ScribeScene.Settings;
        const headings = settings.Headings;
        const subjects = [];
        const labels = new Map();
        for (const subject of state.subjects) {
            labels.set(subject.id, subject.label);
            if (subject.mergedInto === null) {
                subjects.push(settings.ListMarker + subject.label + settings.Opening + subject.kind + settings.Closing);
            }
        }
        const scenes = [];
        if (previous !== null) {
            scenes.push(
                ScribeScene.line(
                    previous.day,
                    previous.place,
                    previous.reach,
                    previous.present.map(
                        /**
                         * @param {{ label: string }} person
                         * @return {string}
                         */
                        (person) => person.label,
                    ),
                    previous.summary,
                ),
            );
        } else {
            let latest = null;
            for (const scene of state.scenes) {
                if (
                    latest === null ||
                    scene.lastPosition > latest.lastPosition ||
                    (scene.lastPosition === latest.lastPosition && scene.firstPosition > latest.firstPosition)
                ) {
                    latest = scene;
                }
            }
            if (latest !== null) {
                scenes.push(
                    ScribeScene.line(
                        latest.day,
                        latest.place,
                        latest.reach,
                        latest.present
                            .filter(
                                /**
                                 * @param {{ until: number|null }} attendee
                                 * @return {boolean}
                                 */
                                (attendee) => attendee.until === null || attendee.until >= latest.lastPosition,
                            )
                            .map(
                                /**
                                 * @param {{ subject: string }} attendee
                                 * @return {string}
                                 */
                                (attendee) => labels.get(attendee.subject),
                            ),
                        latest.summary,
                    ),
                );
            }
        }
        const recent = messages.slice(-settings.Recent);
        const heading =
            settings.MessagesOpen +
            recent[0].position +
            settings.MessagesTo +
            recent.at(settings.Last).position +
            settings.MessagesClose;
        return [
            ScribeScene.section(headings.Player, [player]),
            ScribeScene.section(headings.Subjects, subjects),
            ScribeScene.section(headings.Scene, scenes),
            ScribeScene.section(heading, [ScribeIntake.transcript(recent)]),
        ].join(settings.BlankLine);
    },

    /**
     * @param {string} text
     * @return {readonly string[]}
     */
    lines(text) {
        const settings = ScribeAnswer.Settings;
        const kept = [];
        for (const raw of text.split(settings.LineBreak)) {
            const line = raw
                .replace(settings.FormatCharacter, settings.Nothing)
                .trim()
                .replace(settings.ListMarkers, settings.Nothing)
                .replace(settings.Bold, settings.BoldInner)
                .replace(settings.ListMarkers, settings.Nothing)
                .trim();
            if (line !== settings.Nothing && !settings.Fence.test(line)) {
                kept.push(line);
            }
        }
        return Object.freeze(kept);
    },

    /**
     * @param {string} text
     * @return {Readonly<{ day: number, place: string, reach: string, present: readonly string[], summary: string, changed: boolean|null }>|null}
     */
    parse(text) {
        const settings = ScribeScene.Settings;
        const answer = ScribeAnswer.Settings;
        if (typeof text !== 'string') {
            return null;
        }
        const lines = ScribeScene.lines(text);
        let changed = null;
        for (const line of lines) {
            const found = line.match(settings.ChangedLine);
            if (found !== null) {
                changed = found[1].toLowerCase() === settings.ChangedYes;
                break;
            }
        }
        const sceneLine = lines.find(
            /**
             * @param {string} line
             * @return {boolean}
             */
            (line) => line.split(settings.Pipe).length > settings.MinPipes,
        );
        if (sceneLine === undefined) {
            return null;
        }
        const fields = sceneLine.split(settings.Pipe).map(
            /**
             * @param {string} field
             * @return {string}
             */
            (field) => field.trim(),
        );
        const dayMatch = fields[settings.DayField].match(answer.DayField);
        const day = dayMatch === null ? null : ScribeAnswer.positiveInteger(dayMatch[1]);
        const place = fields[settings.PlaceField];
        const reach = Object.values(ScribeAnswer.Reach).find(
            /**
             * @param {string} value
             * @return {boolean}
             */
            (value) => value.toLowerCase() === fields[settings.ReachField].toLowerCase(),
        );
        const presentMatch = fields[settings.PresentField].match(answer.PresentField);
        if (day === null || place === settings.Nothing || reach === undefined || presentMatch === null) {
            return null;
        }
        const listed = presentMatch[1].trim().match(answer.Bracketed);
        const written = listed === null ? presentMatch[1].trim() : listed[1].trim();
        const present = answer.EmptyAttendance.test(ScribeAnswer.bare(written))
            ? []
            : written
                  .split(settings.ListSplit)
                  .map(
                      /**
                       * @param {string} label
                       * @return {string}
                       */
                      (label) => label.trim(),
                  )
                  .filter(
                      /**
                       * @param {string} label
                       * @return {boolean}
                       */
                      (label) => label !== settings.Nothing,
                  );
        return Object.freeze({
            day,
            place,
            reach,
            present: Object.freeze(present),
            summary: fields.slice(settings.SummaryStart).join(settings.Joiner),
            changed,
        });
    },

    /**
     * @param {string} text
     * @return {string}
     */
    fold(text) {
        const settings = ScribeScene.Settings;
        return ScribeText.normaliseName(text.replace(settings.Ampersand, settings.AndWord));
    },

    /**
     * @param {readonly object[]} active
     * @param {string} text
     * @return {object|null}
     */
    exact(active, text) {
        const key = ScribeScene.fold(text);
        let matches = active.filter(
            /**
             * @param {{ label: string }} subject
             * @return {boolean}
             */
            (subject) => ScribeScene.fold(subject.label) === key,
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
                        (name) => ScribeScene.fold(name) === key,
                    ),
            );
        }
        return matches.length === 1 ? matches[0] : null;
    },

    /**
     * @param {readonly object[]} active
     * @param {string} item
     * @return {ReadonlyArray<Readonly<{ subject: string|null, label: string }>>}
     */
    people(active, item) {
        const settings = ScribeScene.Settings;
        const text = item
            .trim()
            .replace(settings.LeadingAnd, settings.Nothing)
            .replace(settings.PlayerSuffix, settings.Nothing)
            .trim();
        if (text === settings.Nothing) {
            return [];
        }
        const untitled = text.replace(settings.Title, settings.Nothing);
        let subject = ScribeScene.exact(active, text);
        if (subject === null && untitled !== text) {
            subject = ScribeScene.exact(active, untitled);
        }
        if (subject !== null) {
            return [Object.freeze({ subject: subject.id, label: subject.label })];
        }
        const parts = text.split(settings.AndSplit);
        if (parts.length > 1) {
            return parts.flatMap(
                /**
                 * @param {string} part
                 * @return {ReadonlyArray<Readonly<{ subject: string|null, label: string }>>}
                 */
                (part) => ScribeScene.people(active, part),
            );
        }
        return [Object.freeze({ subject: null, label: text })];
    },

    /**
     * @param {object} state
     * @param {readonly string[]} labels
     * @return {ReadonlyArray<Readonly<{ subject: string|null, label: string }>>}
     */
    resolve(state, labels) {
        const active = state.subjects.filter(
            /**
             * @param {{ mergedInto: string|null }} subject
             * @return {boolean}
             */
            (subject) => subject.mergedInto === null,
        );
        const people = [];
        const seen = new Set();
        for (const written of labels) {
            for (const person of ScribeScene.people(active, written)) {
                const identity =
                    person.subject === null
                        ? ScribeScene.Settings.LabelPrefix + ScribeText.normaliseName(person.label)
                        : person.subject;
                if (!seen.has(identity)) {
                    seen.add(identity);
                    people.push(person);
                }
            }
        }
        return Object.freeze(people);
    },

    /**
     * @param {object|null} now
     * @return {Set<string>}
     */
    identities(now) {
        const settings = ScribeScene.Settings;
        return new Set(
            now.present.map(
                /**
                 * @param {{ subject: string|null, label: string }} person
                 * @return {string}
                 */
                (person) =>
                    person.subject === null
                        ? settings.LabelPrefix + ScribeText.normaliseName(person.label)
                        : settings.SubjectPrefix + person.subject,
            ),
        );
    },

    /**
     * @param {object|null} first
     * @param {object|null} second
     * @return {boolean}
     */
    same(first, second) {
        if (first === null || second === null) {
            return first === second;
        }
        if (
            first.day !== second.day ||
            first.reach !== second.reach ||
            ScribeText.normaliseName(first.place) !== ScribeText.normaliseName(second.place)
        ) {
            return false;
        }
        const firstPeople = ScribeScene.identities(first);
        const secondPeople = ScribeScene.identities(second);
        return (
            firstPeople.size === secondPeople.size &&
            [...firstPeople].every(
                /**
                 * @param {string} identity
                 * @return {boolean}
                 */
                (identity) => secondPeople.has(identity),
            )
        );
    },

    /**
     * @param {{ state: object, player: string, messages: readonly object[], previous: object|null, ask: function(string, string): Promise<{ text: string }> }} request
     * @return {Promise<Readonly<object>|null>}
     */
    async now({ state, player, messages, previous, ask }) {
        if (messages.length === 0) {
            return null;
        }
        let text = null;
        try {
            text = (await ask(ScribeScene.Prompt, ScribeScene.input(state, player, messages, previous))).text;
        } catch {
            return null;
        }
        const parsed = ScribeScene.parse(text);
        if (parsed === null) {
            return null;
        }
        const newest = messages.at(ScribeScene.Settings.Last);
        const found = {
            message: newest.id,
            position: newest.position,
            day: parsed.day,
            place: parsed.place,
            reach: parsed.reach,
            present: ScribeScene.resolve(state, parsed.present),
            summary: parsed.summary,
            changed: false,
        };
        const changed = previous === null || !ScribeScene.same(previous, found) || parsed.changed === true;
        return Object.freeze({ ...found, changed });
    },
});
