const ScribeAnalyzer = Object.freeze({
    Settings: Object.freeze({
        Newline: '\n',
        BlankLine: '\n\n',
        Nothing: '',
        Space: ' ',
        None: '(none)',
        NoFacts: '(no facts yet)',
        Nobody: 'nobody',
        Headings: Object.freeze({
            Player: 'PLAYER CHARACTER:',
            Subjects: 'SUBJECTS:',
            Ledger: 'LEDGER:',
            Scenes: 'LAST SCENES:',
            Nights: 'NIGHTS:',
            Threads: 'OPEN THREADS:',
            Notes: 'PLAYER NOTES:',
            Answers: 'ANSWERED QUESTIONS:',
        }),
        MessagesOpen: 'NEW MESSAGES (#',
        MessagesTo: ' to #',
        MessagesClose: '):',
        ListMarker: '- ',
        SubjectMarker: '## ',
        Opening: ' (',
        Closing: ')',
        AkaOpen: '; aka ',
        Comma: ', ',
        Colon: ': ',
        RelationTo: 'relation to ',
        CiteOpen: ' (#',
        Owner: ' (owner)',
        Pinned: ' pinned',
        Hidden: ' hidden',
        Stale: ' (check: the other side has changed)',
        Joiner: ' | ',
        Day: 'Day ',
        Hash: '#',
        Span: '-#',
        Present: 'present: ',
        From: 'from #',
        Until: 'until #',
        NumberOpen: '[#',
        NumberClose: '] ',
        AnswerMarker: ' ANSWER: ',
        NormalForm: 'NFC',
        Apostrophe: "'",
        CommonWords: Object.freeze(['the', 'and', 'of']),
        ShortestAka: 3,
        ShortestWord: 3,
        CasedWord: 2,
        ShownScenes: 3,
        ShownNights: 3,
        NoSceneBefore: 1,
        NoLimit: Number.POSITIVE_INFINITY,
        BoundaryWidth: 2,
        Last: -1,

        /**
         * @return {RegExp}
         */
        get Apostrophes() {
            return /[’‘ʼ]/gu;
        },

        /**
         * @return {RegExp}
         */
        get Whitespace() {
            return /\s+/gu;
        },

        /**
         * @return {RegExp}
         */
        get Word() {
            return /[\p{L}\p{M}\p{N}]+/gu;
        },

        /**
         * @return {RegExp}
         */
        get WordBefore() {
            return /[\p{L}\p{M}\p{N}]$/u;
        },

        /**
         * @return {RegExp}
         */
        get WordAfter() {
            return /^[\p{L}\p{M}\p{N}]/u;
        },

        PromptLines: Object.freeze([
            'You are the Analyzer: keeper of the campaign book for an ongoing adult fiction roleplay between consenting adult characters.',
            'You never write story. After each stretch of play you add what is new to the book.',
            'Record intimate, profane and violent facts plainly; never soften, omit or judge. Never invent.',
            "Messages are numbered [#n]. Lines marked (player) are spoken or done by the player's character.",
            '"Narrator" is the storyteller\'s narration, not a character.',
            '',
            'The book is a list of single facts. Each has an id like F12, a subject, a category, a statement and the message number that established it. You never rewrite the book. You only add facts, and say when the story has changed or ended one.',
            '',
            'You receive PLAYER CHARACTER, SUBJECTS (everyone and everything that has an entry), LEDGER (the facts now in force for the subjects named in the new messages), LAST SCENES, NIGHTS, OPEN THREADS and the NEW MESSAGES.',
            'In the LEDGER each fact ends with (#n), the message that established it, or (owner) when the player added it by hand. After that it may be marked pinned, hidden, or (check: the other side has changed).',
            '',
            'Answer with these blocks, in this order, each starting with its === line. Leave a block out if it has nothing. Write nothing else: no headings, no remarks, no notes inside or between blocks.',
            '',
            '=== SUBJECTS',
            'Label | kind',
            '=== NAMES',
            'Name as the story writes it | Label of the known subject | #n',
            '=== FACTS',
            'Label | category | statement | #n',
            'Label | category | statement | hidden | #n',
            '=== CHANGES',
            'F12 | Label | category | the new statement | #n',
            'F12 | Label | category | FULLER: the same fact with more detail | #n',
            'F45 | Label | category | ENDED: why it is no longer true | #n',
            '=== TOLD',
            'F12 | Label of the subject the fact is about | Label of the one who was told | #n',
            '=== SCENES',
            'Day N | #first-#last | Place | public or private | present: Label, Label (from #n), Label (until #n) | what happened',
            '=== NIGHTS',
            '#n | what marks the night or the time skip',
            '=== THREADS',
            'OPEN | something left hanging | #n',
            'CLOSE T3 | how it resolved | #n',
            '=== QUESTIONS',
            'A question for the player | #n',
            '',
            'Categories. Use exactly these words.',
            'One value at a time:',
            '  kind (character, group, place, item or world), age (a plain number whenever the story gives one), eyes, hair (colour and usual style), build (height and body shape), skin, status (alive, dead or missing), location (where they live or are staying), role (what they are or do for a living), relation to <Label> (where they stand with that person: lovers, rivals, friends, enemies, family; one short sentence, not what they last did to each other)',
            'Any number of values:',
            '  aka (a full name, another name or a nickname they go by)',
            '  title (a rank or honour they hold)',
            '  appearance (permanent looks only: scars, tattoos, piercings, birthmarks, the way they habitually dress)',
            '  ability (a skill or power they have, or a limit on one)',
            '  belonging (something they own and keep)',
            '  background (their life before the story began)',
            '  trait (a lasting habit, taste, fear or preference: shown more than once, or stated as how they always are)',
            '  condition (a passing state that will be gone in days: bruises, soreness, a wound that will heal, what they are wearing right now, drunk, exhausted, a mood)',
            '  feature (of a place or item), rule (how the world works; the subject is the world)',
            '',
            'What is a fact and what is not. Before adding a line ask: if nothing new happens, is this still true a month from now?',
            'Yes: it is a fact. No, it will fade: it is a condition. It is something that happened: it goes in SCENES only.',
            'Right:',
            '  Mirelle | hair | black, worn in a long braid | #46',
            '  Mirelle | build | short and broad-shouldered | #41',
            '  Isolde | appearance | always wears a green travelling cloak | #24',
            '  Mirelle | condition | a split lip from the brawl | #78',
            "  Mirelle | condition | wearing a borrowed guard's coat | #12",
            '  Halvard | background | deserted at the siege | hidden | #20',
            'Wrong, and why:',
            '  Mirelle | appearance | flushed cheeks, hair in disarray      (passing: condition)',
            '  Isolde | appearance | her cloak slips from one shoulder       (one moment: not a fact at all)',
            '  Mirelle | trait | tells Halvard to turn down the post         (one reaction: SCENES)',
            '  Halvard | relation to Kira | she slapped him                  (an event: SCENES)',
            '',
            'Rules.',
            '1. One fact per line, one detail per fact, under 25 words. Every FACTS, NAMES, CHANGES, TOLD, THREADS and QUESTIONS line ends with exactly one message number: the message that established it. A SUBJECTS line has no number. A SCENES line has only its range. A NIGHTS line starts with its number.',
            '2. Facts are what stays true: what a storyteller must know to keep this person consistent next month. Things that happened (a kiss, a fight, a walk, a talk) go in SCENES, never in FACTS. An event produces a fact only through what it leaves behind: a title, a belonging, a scar, a changed relation.',
            '3. Read the LEDGER before adding. Never repeat what it holds, even in other words.',
            "4. Subjects. Use a label from SUBJECTS exactly. For someone or something new, add a SUBJECTS line first; its kind is exactly one of character, group, place, item, world. If a new person has the same name as an existing subject, give them a label with a short distinguishing note in brackets, such as Oswin (Tamsin's uncle). A label never contains # or a comma. Give an entry to every named character who speaks or acts and to named places that are used. Unnamed passers-by get none.",
            "5. NAMES. When the story writes a known subject's name another way (a misspelling, a nickname, a first name alone, a full name used for the first time), do not make a new subject: write a NAMES line the first time, then use the known label.",
            '6. Fixed attributes (kind, age, eyes, hair, build, skin). When the new messages state one that the LEDGER already holds for that subject: if it means the same (another spelling, a synonym, the same age said another way) write nothing; if it adds detail to the same thing write a FULLER line in CHANGES; if it contradicts the LEDGER and the story gives no reason, write it as a plain FACTS line and the player will be asked to rule. Never decide who is right.',
            "7. CHANGES is for what the story itself changes or ends: someone is promoted, scarred for good, loses a belonging, breaks a habit. Give the id from the LEDGER, then the subject's label and the category exactly as the LEDGER shows them. For status, location, role and relation you need no id: add the new fact in FACTS and it replaces the old one; write hidden on it when it is still a secret.",
            "8. hidden. Mark a fact hidden when it is the subject's own thought, or something the subject conceals from everyone present. What a character learns, is told or is shown in a scene is not hidden: the scene's list of who was present decides who knows it. Something the narrator states that even its subject does not know is filed, hidden, under the one who does know it, or under the world when nobody does. Write a TOLD line when the new messages show a character being told or shown a fact the LEDGER marks hidden. One TOLD line per person. A FULLER line keeps the hidden mark of the fact it extends; when the added detail is more secret than the fact, write it as a separate hidden fact instead.",
            '9. A relation marked (check: the other side has changed) must be restated in FACTS as it stands now, hidden if it is marked hidden.',
            "10. A fact marked pinned is the player's ruling. Write nothing that changes, ends, extends or contradicts it. A TOLD line on it is still written.",
            "11. SCENES: one line per scene in the new messages, in order, at most four, each summary under 35 words, naming every death, fight, first, revelation, deal and promise. A scene is a stretch in one place with one main thing going on. If the first new messages continue the last scene shown in LAST SCENES, repeat that scene's line with the same first number and the new last number. public means bystanders could see or hear; private means only those listed. List everyone present, separated by commas only. Add (from #n) for someone who arrived after the scene began, (until #n) for someone who left before it ended, (from #a until #b) for both; someone who left and came back is listed twice. Continue the day count from LAST SCENES. A night belongs to the day it ends.",
            '12. NIGHTS: only nights slept through and stated time skips. Conditions need no tidying: they expire at the next night by themselves.',
            '13. THREADS: something left hanging that the story could pick up later: a threat, a promise, a plan, a mystery, someone due back. A fact, a feeling or something already finished is not a thread. At most two new threads per stretch. Never repeat the open list.',
            '14. QUESTIONS. When the story leaves something unclear and a guess would matter (does she like him or love him; is this the same man as before), write no fact for it. Ask the player one short question instead. At most two questions per stretch.',
        ]),

        NotesPromptLines: Object.freeze([
            'You are the Analyzer: keeper of the campaign book for an ongoing adult fiction roleplay between consenting adult characters.',
            'You never write story. Record intimate, profane and violent facts plainly; never soften, omit or judge. Never invent.',
            '',
            'The PLAYER NOTES below were written by the player. They are true and they outrank the story. Each line is numbered [#n].',
            'File what they say in the book. You receive PLAYER CHARACTER, SUBJECTS (everyone and everything that has an entry), LEDGER (the facts now in force for the subjects the notes name) and the PLAYER NOTES.',
            'In the LEDGER each fact ends with (#n) or (owner), and may then be marked pinned or hidden.',
            '',
            'Answer with these blocks, in this order, each starting with its === line. Leave a block out if it has nothing. Write nothing else.',
            '',
            '=== SUBJECTS',
            'Label | kind',
            '=== NAMES',
            'Name as the notes write it | Label of the known subject | #n',
            '=== FACTS',
            'Label | category | statement | #n',
            'Label | category | statement | hidden | #n',
            '=== CHANGES',
            'F12 | Label | category | the new statement | #n',
            'F12 | Label | category | FULLER: the same fact with more detail | #n',
            'F45 | Label | category | ENDED: why it is no longer true | #n',
            '=== THREADS',
            'OPEN | something left hanging | #n',
            '',
            'Categories. Use exactly these words.',
            'One value at a time:',
            '  kind (character, group, place, item or world), age (a plain number whenever the notes give one), eyes, hair (colour and usual style), build (height and body shape), skin, status (alive, dead or missing), location (where they live or are staying), role (what they are or do for a living), relation to <Label> (where they stand with that person; one short sentence)',
            'Any number of values:',
            '  aka (a full name, another name or a nickname they go by)',
            '  title (a rank or honour they hold)',
            '  appearance (permanent looks only)',
            '  ability (a skill or power they have, or a limit on one)',
            '  belonging (something they own and keep)',
            '  background (their life before the story began)',
            '  trait (a lasting habit, taste, fear or preference)',
            '  condition (a passing state that will be gone in days)',
            '  feature (of a place or item), rule (how the world works; the subject is the world)',
            '',
            'Rules.',
            '1. One fact per line, one detail per fact, under 25 words. Every FACTS, NAMES, CHANGES and THREADS line ends with exactly one number: the number of the note line it came from. A SUBJECTS line has no number.',
            '2. Read the LEDGER before adding. Never repeat what it holds, even in other words.',
            "3. When a note contradicts a fact in the LEDGER, or says it is no longer true, do not add a second fact: write a CHANGES line for that fact, with its id, the subject's label and the category exactly as the LEDGER shows them. When a note adds detail to a fact, write a FULLER line. A fact marked pinned is never changed.",
            '4. Use a label from SUBJECTS exactly. For someone or something new, add a SUBJECTS line first; its kind is exactly one of character, group, place, item, world. A label never contains # or a comma.',
            "5. When a note writes a known subject's name another way, write a NAMES line, then use the known label.",
            '6. Mark a fact hidden when the note says it is a secret or known only to the subject.',
            '7. A note that cannot be read as a fact about a subject is left out. Never guess.',
        ]),

        AnswersPromptLines: Object.freeze([
            'You are the Analyzer: keeper of the campaign book for an ongoing adult fiction roleplay between consenting adult characters.',
            'You never write story. Record intimate, profane and violent facts plainly; never soften, omit or judge. Never invent.',
            '',
            "Earlier you asked the player questions about things the story left unclear. ANSWERED QUESTIONS holds each question with the player's answer, numbered [#n] by the message it was about.",
            'File each answer in the book, exactly as the player answered. You receive PLAYER CHARACTER, SUBJECTS (everyone and everything that has an entry), LEDGER (the facts now in force for the subjects named) and the ANSWERED QUESTIONS.',
            'In the LEDGER each fact ends with (#n) or (owner), and may then be marked pinned or hidden.',
            '',
            'Answer with these blocks, in this order, each starting with its === line. Leave a block out if it has nothing. Write nothing else.',
            '',
            '=== SUBJECTS',
            'Label | kind',
            '=== NAMES',
            'Name as written | Label of the known subject | #n',
            '=== FACTS',
            'Label | category | statement | #n',
            'Label | category | statement | hidden | #n',
            '=== CHANGES',
            'F12 | Label | category | the new statement | #n',
            'F12 | Label | category | FULLER: the same fact with more detail | #n',
            'F45 | Label | category | ENDED: why it is no longer true | #n',
            '',
            'Categories. Use exactly these words.',
            'One value at a time:',
            '  kind (character, group, place, item or world), age, eyes, hair, build, skin, status, location, role, relation to <Label>',
            'Any number of values:',
            '  aka, title, appearance, ability, belonging, background, trait, condition, feature, rule',
            '',
            'Rules.',
            '1. One fact per line, one detail per fact, under 25 words. Every FACTS, NAMES and CHANGES line ends with exactly one number: the number shown for the question it answers. A SUBJECTS line has no number.',
            '2. Read the LEDGER before adding. Never repeat what it holds, even in other words.',
            "3. When an answer contradicts a fact in the LEDGER, or says it is no longer true, do not add a second fact: write a CHANGES line for that fact, with its id, the subject's label and the category exactly as the LEDGER shows them. When an answer adds detail to a fact, write a FULLER line. A fact marked pinned is never changed.",
            '4. Use a label from SUBJECTS exactly. For someone or something new, add a SUBJECTS line first; its kind is exactly one of character, group, place, item, world. A label never contains # or a comma.',
            '5. Mark a fact hidden when the answer says it is a secret, a thought, or known only to the subject.',
            '6. An answer that settles nothing ("leave it open", "not decided") produces no line. Never guess.',
        ]),
    }),

    /**
     * @return {string}
     */
    get Prompt() {
        return ScribeAnalyzer.Settings.PromptLines.join(ScribeAnalyzer.Settings.Newline);
    },

    /**
     * @return {string}
     */
    get NotesPrompt() {
        return ScribeAnalyzer.Settings.NotesPromptLines.join(ScribeAnalyzer.Settings.Newline);
    },

    /**
     * @return {string}
     */
    get AnswersPrompt() {
        return ScribeAnalyzer.Settings.AnswersPromptLines.join(ScribeAnalyzer.Settings.Newline);
    },

    /**
     * @param {string} heading
     * @param {readonly string[]} lines
     * @return {string}
     */
    section(heading, lines) {
        const settings = ScribeAnalyzer.Settings;
        const body = lines.length === 0 ? settings.None : lines.join(settings.Newline);
        return heading + settings.Newline + body;
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
     * @param {number} before
     * @return {readonly object[]}
     */
    earlier(state, before) {
        return Object.freeze(
            state.scenes
                .filter(
                    /**
                     * @param {{ firstPosition: number }} scene
                     * @return {boolean}
                     */
                    (scene) => scene.firstPosition < before,
                )
                .sort(
                    /**
                     * @param {{ firstPosition: number, lastPosition: number }} first
                     * @param {{ firstPosition: number, lastPosition: number }} second
                     * @return {number}
                     */
                    (first, second) =>
                        first.lastPosition - second.lastPosition || first.firstPosition - second.firstPosition,
                ),
        );
    },

    /**
     * @param {string} text
     * @return {string}
     */
    fold(text) {
        const settings = ScribeAnalyzer.Settings;
        return text
            .normalize(settings.NormalForm)
            .replace(settings.Apostrophes, settings.Apostrophe)
            .replace(settings.Whitespace, settings.Space);
    },

    /**
     * @param {string} text
     * @return {Map<string, number[]>}
     */
    index(text) {
        const starts = new Map();
        for (const match of text.matchAll(ScribeAnalyzer.Settings.Word)) {
            const offsets = starts.get(match[0]) ?? [];
            offsets.push(match.index);
            starts.set(match[0], offsets);
        }
        return starts;
    },

    /**
     * @param {string} text
     * @param {Map<string, number[]>} starts
     * @param {string} wanted
     * @return {boolean}
     */
    found(text, starts, wanted) {
        const settings = ScribeAnalyzer.Settings;
        let rarest = null;
        for (const run of wanted.matchAll(settings.Word)) {
            const offsets = starts.get(run[0]) ?? [];
            if (rarest === null || offsets.length < rarest.offsets.length) {
                rarest = { offsets, at: run.index };
            }
        }
        if (rarest === null) {
            return false;
        }
        return rarest.offsets.some(
            /**
             * @param {number} offset
             * @return {boolean}
             */
            (offset) => {
                const start = offset - rarest.at;
                const end = start + wanted.length;
                return (
                    start >= 0 &&
                    text.startsWith(wanted, start) &&
                    !settings.WordBefore.test(text.slice(Math.max(0, start - settings.BoundaryWidth), start)) &&
                    !settings.WordAfter.test(text.slice(end, end + settings.BoundaryWidth))
                );
            },
        );
    },

    /**
     * @param {object} state
     * @param {string} text
     * @param {string} player
     * @param {number} before
     * @return {readonly string[]}
     */
    select(state, text, player, before) {
        const settings = ScribeAnalyzer.Settings;
        const kept = ScribeAnalyzer.fold(text);
        const folded = kept.toLowerCase();
        const starts = ScribeAnalyzer.index(folded);
        let exact = null;
        const playerName = ScribeText.normaliseName(player);
        const running = ScribeAnalyzer.earlier(state, before).at(settings.Last);
        const present = new Set();
        for (const attendee of running === undefined ? [] : running.present) {
            present.add(attendee.subject);
        }
        const chosen = [];
        for (const subject of state.subjects) {
            if (subject.mergedInto !== null) {
                continue;
            }
            const playing = [subject.name, ...subject.aka].some(
                /**
                 * @param {string} name
                 * @return {boolean}
                 */
                (name) => ScribeText.normaliseName(name) === playerName,
            );
            const spelled = ScribeAnalyzer.fold(subject.name);
            const words = spelled.split(settings.Space).filter(
                /**
                 * @param {string} word
                 * @return {boolean}
                 */
                (word) => !settings.CommonWords.includes(word.toLowerCase()),
            );
            const sought = [
                spelled.toLowerCase(),
                ...words
                    .filter(
                        /**
                         * @param {string} word
                         * @return {boolean}
                         */
                        (word) => Array.from(word).length >= settings.ShortestWord,
                    )
                    .map(
                        /**
                         * @param {string} word
                         * @return {string}
                         */
                        (word) => word.toLowerCase(),
                    ),
                ...subject.aka
                    .map(
                        /**
                         * @param {string} aka
                         * @return {string}
                         */
                        (aka) => ScribeAnalyzer.fold(aka).toLowerCase(),
                    )
                    .filter(
                        /**
                         * @param {string} aka
                         * @return {boolean}
                         */
                        (aka) => Array.from(aka).length >= settings.ShortestAka,
                    ),
            ];
            const cased = words.filter(
                /**
                 * @param {string} word
                 * @return {boolean}
                 */
                (word) => Array.from(word).length === settings.CasedWord,
            );
            const always = subject.kind === ScribeCategory.SubjectKinds.World || playing || present.has(subject.id);
            const named =
                sought.some(
                    /**
                     * @param {string} wanted
                     * @return {boolean}
                     */
                    (wanted) => ScribeAnalyzer.found(folded, starts, wanted),
                ) ||
                cased.some(
                    /**
                     * @param {string} word
                     * @return {boolean}
                     */
                    (word) => {
                        if (exact === null) {
                            exact = ScribeAnalyzer.index(kept);
                        }
                        return ScribeAnalyzer.found(kept, exact, word);
                    },
                );
            if (always || named) {
                chosen.push(subject.id);
            }
        }
        return Object.freeze(chosen);
    },

    /**
     * @param {object} state
     * @param {string} player
     * @param {string} text
     * @param {number} before
     * @param {number} through
     * @return {readonly string[]}
     */
    opening(state, player, text, before, through) {
        const settings = ScribeAnalyzer.Settings;
        const headings = settings.Headings;
        const labels = ScribeAnalyzer.labels(state);
        const subjects = [];
        for (const subject of state.subjects) {
            if (subject.mergedInto === null) {
                const aka =
                    subject.aka.length === 0 ? settings.Nothing : settings.AkaOpen + subject.aka.join(settings.Comma);
                subjects.push(
                    settings.ListMarker + subject.label + settings.Opening + subject.kind + aka + settings.Closing,
                );
            }
        }
        const stale = new Set();
        for (const mark of state.stale) {
            stale.add(JSON.stringify([mark.subject, mark.target]));
        }
        const ledgers = new Map();
        for (const id of ScribeAnalyzer.select(state, text, player, before)) {
            ledgers.set(id, []);
        }
        for (const fact of state.facts) {
            const lines = ledgers.get(fact.subject);
            if (lines === undefined || fact.status !== ScribeReplay.Status.InForce || fact.position > through) {
                continue;
            }
            let category = fact.category;
            if (category === ScribeCategory.Settings.RelationCategory) {
                category = settings.RelationTo + (fact.target === null ? fact.targetText : labels.get(fact.target));
            }
            let line = fact.id + settings.Space + category + settings.Colon + fact.text;
            if (fact.origin === ScribeLog.Origin.Operator) {
                line += settings.Owner;
            } else {
                line += settings.CiteOpen + fact.position + settings.Closing;
            }
            if (fact.pinned) {
                line += settings.Pinned;
            }
            if (fact.hidden && fact.widened !== ScribeLog.Settings.Everyone) {
                line += settings.Hidden;
            }
            if (stale.has(JSON.stringify([fact.subject, fact.target]))) {
                line += settings.Stale;
            }
            lines.push(line);
        }
        const ledger = [];
        for (const [id, lines] of ledgers) {
            ledger.push(settings.SubjectMarker + labels.get(id), ...(lines.length === 0 ? [settings.NoFacts] : lines));
        }
        return Object.freeze([
            ScribeAnalyzer.section(headings.Player, [player]),
            ScribeAnalyzer.section(headings.Subjects, subjects),
            ScribeAnalyzer.section(headings.Ledger, ledger),
        ]);
    },

    /**
     * @param {object} state
     * @param {string} player
     * @param {readonly object[]} stretch
     * @return {string}
     */
    input(state, player, stretch) {
        const settings = ScribeAnalyzer.Settings;
        const headings = settings.Headings;
        const first = stretch[0].position;
        const last = stretch.at(settings.Last).position;
        const transcript = ScribeIntake.transcript(stretch);
        const labels = ScribeAnalyzer.labels(state);
        const scenes = [];
        for (const scene of ScribeAnalyzer.earlier(state, first).slice(-settings.ShownScenes)) {
            const attendance = scene.present.map(
                /**
                 * @param {{ subject: string, from: number|null, until: number|null }} attendee
                 * @return {string}
                 */
                (attendee) => {
                    const bounds = [];
                    if (attendee.from !== null) {
                        bounds.push(settings.From + attendee.from);
                    }
                    if (attendee.until !== null) {
                        bounds.push(settings.Until + attendee.until);
                    }
                    const bounded =
                        bounds.length === 0
                            ? settings.Nothing
                            : settings.Opening + bounds.join(settings.Space) + settings.Closing;
                    return labels.get(attendee.subject) + bounded;
                },
            );
            scenes.push(
                [
                    settings.Day + scene.day,
                    settings.Hash + scene.firstPosition + settings.Span + scene.lastPosition,
                    scene.place,
                    scene.reach.toLowerCase(),
                    settings.Present + (attendance.length === 0 ? settings.Nobody : attendance.join(settings.Comma)),
                    scene.summary,
                ].join(settings.Joiner),
            );
        }
        const nights = state.nights
            .filter(
                /**
                 * @param {{ position: number }} night
                 * @return {boolean}
                 */
                (night) => night.position < first,
            )
            .slice(-settings.ShownNights)
            .map(
                /**
                 * @param {{ position: number, marker: string }} night
                 * @return {string}
                 */
                (night) => settings.Hash + night.position + settings.Joiner + night.marker,
            );
        const threads = state.threads
            .filter(
                /**
                 * @param {{ closed: object|null, position: number }} thread
                 * @return {boolean}
                 */
                (thread) => thread.closed === null && thread.position <= last,
            )
            .map(
                /**
                 * @param {{ id: string, text: string }} thread
                 * @return {string}
                 */
                (thread) => thread.id + settings.Colon + thread.text,
            );
        const messages = settings.MessagesOpen + first + settings.MessagesTo + last + settings.MessagesClose;
        return [
            ...ScribeAnalyzer.opening(state, player, transcript, first, last),
            ScribeAnalyzer.section(headings.Scenes, scenes),
            ScribeAnalyzer.section(headings.Nights, nights),
            ScribeAnalyzer.section(headings.Threads, threads),
            ScribeAnalyzer.section(messages, [transcript]),
        ].join(settings.BlankLine);
    },

    /**
     * @param {object} state
     * @param {string} player
     * @param {readonly object[]} notes
     * @return {string}
     */
    notesInput(state, player, notes) {
        const settings = ScribeAnalyzer.Settings;
        const text = notes
            .map(
                /**
                 * @param {{ text: string }} note
                 * @return {string}
                 */
                (note) => note.text,
            )
            .join(settings.Newline);
        const lines = notes.map(
            /**
             * @param {{ text: string, position: number }} note
             * @return {string}
             */
            (note) => settings.NumberOpen + note.position + settings.NumberClose + note.text,
        );
        return [
            ...ScribeAnalyzer.opening(state, player, text, settings.NoSceneBefore, settings.NoLimit),
            ScribeAnalyzer.section(settings.Headings.Notes, lines),
        ].join(settings.BlankLine);
    },

    /**
     * @param {object} state
     * @param {string} player
     * @param {readonly object[]} questions
     * @return {string}
     */
    answersInput(state, player, questions) {
        const settings = ScribeAnalyzer.Settings;
        const answered = questions.filter(
            /**
             * @param {{ answer: string|null }} question
             * @return {boolean}
             */
            (question) => question.answer !== null,
        );
        const text = answered
            .flatMap(
                /**
                 * @param {{ text: string, answer: string }} question
                 * @return {string[]}
                 */
                (question) => [question.text, question.answer],
            )
            .join(settings.Newline);
        const lines = answered.map(
            /**
             * @param {{ text: string, answer: string, position: number }} question
             * @return {string}
             */
            (question) =>
                settings.NumberOpen +
                question.position +
                settings.NumberClose +
                question.text +
                settings.AnswerMarker +
                question.answer,
        );
        return [
            ...ScribeAnalyzer.opening(state, player, text, settings.NoSceneBefore, settings.NoLimit),
            ScribeAnalyzer.section(settings.Headings.Answers, lines),
        ].join(settings.BlankLine);
    },
});
