const ScribeLive = Object.freeze({
    Status: Object.freeze({
        Open: 'Open',
        Dismissed: 'Dismissed',
        Accepted: 'Accepted',
        Told: 'Told',
        Reminded: 'Reminded',
    }),

    Settings: Object.freeze({
        MessageBytes: 4500,
        Recent: 20,
        FindingsKept: 200,
        DismissedKept: 500,
        CheckedKept: 8,
        NotesKept: 100,
        FirstMost: 5,
        FirstFinding: 0,
        FirstEpoch: 0,
        FirstDay: 1,
        NoSends: 0,
        LongestEdit: 3000,
        RetryMs: Object.freeze([15000, 60000, 300000]),
        Retried: Object.freeze({
            Scene: 'scene',
            Check: 'check',
        }),
        FirstTry: 0,
        RetriesKept: 50,
        FirstAnswered: 200,
        LastAnswered: 299,
        NotFound: -1,
        Removed: 1,
        CallsKept: 20,
        OneSend: 1,
        NoCount: 0,
        Last: -1,
        Nothing: '',
        Space: ' ',
        Fulfilled: 'fulfilled',
        Uncast: Object.freeze({ characters: null, profile: null, notice: null }),
        StoppedPhase: 'Stopped',
        DoneStop: 'Done',
        ObjectType: 'object',
        StringType: 'string',
        BooleanType: 'boolean',
        Roles: Object.freeze({
            Scribe: 'Scribe',
            Pedant: 'Pedant',
            Analyzer: 'Analyzer',
        }),
        Needs: Object.freeze({
            Spelling: Object.freeze(['subject', 'label', 'written']),
            Contradiction: Object.freeze(['subject', 'label', 'fact', 'category', 'book', 'said']),
            Leak: Object.freeze(['subject', 'label', 'fact', 'category', 'book', 'speaker', 'speakerLabel']),
            Situation: Object.freeze(['said', 'book']),
        }),
        SceneTexts: Object.freeze(['message', 'place', 'reach', 'summary']),
        Messages: Object.freeze({
            Watching: 'Another tab is reading this chat',
            Unread: 'The saved live part of this chat could not be read; it is tried again',
            Untrusted: 'The book of this chat cannot be trusted right now',
            Stopped: 'The keeper is stopped',
            Busy: 'The last request of this kind has not finished yet',
            NoBook: 'No book yet: adopt this chat first.',
            NotRead: 'The book has not finished its first reading.',
            LongEdit: 'A reminder may be at most 3,000 characters; nothing was saved.',
            BehindOpen: 'No reminder: the scene was last read at #',
            BehindMiddle: '; the latest reply is #',
            UnreadOpen: 'No reminder: the scene has not been read yet; the latest reply is #',
            FullStop: '.',
            SceneUnreadable: "the Scribe's answer about the scene could not be read",
            StoryEmpty: 'the answer held no story',
            Untold: 'No reminder: the story so far could not be written: ',
            SceneFailing: 'Scene failing: ',
            ChecksFailing: 'Checks failing: ',
            StoryFailing: 'Story failing: ',
            EditStale: 'Your edit was written before the latest reply; Save it again to send it.',
            Crowded: 'No reminder: your message leaves no room for it.',
            Unmarked: 'the scene was saved before replies were told apart by their text',
            ChangedOpen: 'No reminder: the latest reply #',
            ChangedClose: ' changed and is being read again.',
            StoryUnread: "The story's characters could not be read, so every character counts as custom: ",
            ProfileUnread: 'The chat profile could not be read, so it is left out of the calls: ',
            Budget: "The day's budget is spent: replies are not checked and no new reminder is made until tomorrow.",
        }),
        NothingAppended: Object.freeze({
            ready: null,
            suggestion: null,
            ends: Object.freeze([]),
        }),

        /**
         * @return {RegExp}
         */
        get EveryLead() {
            return /^(?:[\p{Zs}\t]*@:)*[\p{Zs}\t]*/u;
        },
    }),

    /**
     * @param {*} error
     * @return {string}
     */
    words(error) {
        const settings = ScribeLive.Settings;
        const described =
            error !== null && typeof error === settings.ObjectType && typeof error.message === settings.StringType;
        return described ? error.message : String(error);
    },

    /**
     * @param {*} value
     * @return {boolean}
     */
    isObject(value) {
        return typeof value === ScribeLive.Settings.ObjectType && value !== null && !Array.isArray(value);
    },

    /**
     * @param {*} value
     * @return {boolean}
     */
    isText(value) {
        return typeof value === ScribeLive.Settings.StringType;
    },

    /**
     * @param {*} value
     * @return {boolean}
     */
    isTexts(value) {
        return Array.isArray(value) && value.every(ScribeLive.isText);
    },

    /**
     * @param {*} value
     * @return {object|null}
     */
    scene(value) {
        const settings = ScribeLive.Settings;
        if (!ScribeLive.isObject(value)) {
            return null;
        }
        const sound =
            settings.SceneTexts.every(
                /**
                 * @param {string} name
                 * @return {boolean}
                 */
                (name) => ScribeLive.isText(value[name]),
            ) &&
            value.place !== settings.Nothing &&
            (value.fingerprint === undefined || ScribeLive.isText(value.fingerprint)) &&
            Number.isSafeInteger(value.position) &&
            Number.isSafeInteger(value.day) &&
            value.day >= settings.FirstDay &&
            typeof value.changed === settings.BooleanType &&
            Array.isArray(value.present) &&
            value.present.every(
                /**
                 * @param {*} person
                 * @return {boolean}
                 */
                (person) =>
                    ScribeLive.isObject(person) &&
                    ScribeLive.isText(person.label) &&
                    (person.subject === null || ScribeLive.isText(person.subject)),
            );
        return sound ? value : null;
    },

    /**
     * @param {*} value
     * @return {object|null}
     */
    finding(value) {
        const settings = ScribeLive.Settings;
        const sound =
            ScribeLive.isObject(value) &&
            ScribeLive.isText(value.kind) &&
            Object.hasOwn(settings.Needs, value.kind) &&
            ScribeLive.isText(value.key) &&
            (value.fault === undefined || ScribeLive.isText(value.fault)) &&
            ScribeLive.isText(value.status) &&
            ScribeLive.isText(value.message) &&
            Number.isSafeInteger(value.position) &&
            (value.fingerprint === undefined || value.fingerprint === null || ScribeLive.isText(value.fingerprint)) &&
            settings.Needs[value.kind].every(
                /**
                 * @param {string} name
                 * @return {boolean}
                 */
                (name) => ScribeLive.isText(value[name]),
            );
        if (!sound) {
            return null;
        }
        const fault = value.fault === undefined ? value.key : value.fault;
        const kept = {
            ...value,
            fault,
            key: ScribeLive.identity(fault, value.message),
            fingerprint: ScribeLive.isText(value.fingerprint) ? value.fingerprint : null,
        };
        delete kept.correction;
        return kept;
    },

    /**
     * @param {string} fault
     * @param {string} message
     * @return {string}
     */
    identity(fault, message) {
        return JSON.stringify([fault, message]);
    },

    /**
     * @param {*} value
     * @return {object[]}
     */
    findings(value) {
        if (!Array.isArray(value)) {
            return [];
        }
        const kept = [];
        for (const item of value) {
            const finding = ScribeLive.finding(item);
            if (finding !== null) {
                kept.push(finding);
            }
        }
        return kept;
    },

    /**
     * @param {object[]} findings
     * @param {*} messages
     * @return {object[]}
     */
    pruned(findings, messages) {
        const settings = ScribeLive.Settings;
        if (!Array.isArray(messages) || messages.length === settings.NoCount) {
            return findings;
        }
        const prints = new Map(
            messages.map(
                /**
                 * @param {{ id: string, fingerprint: string }} item
                 * @return {Array<string>}
                 */
                (item) => [item.id, item.fingerprint],
            ),
        );
        const earliest = messages[settings.FirstFinding].position;
        return findings.filter(
            /**
             * @param {{ message: string, fingerprint: string|null, position: number }} finding
             * @return {boolean}
             */
            (finding) => {
                if (prints.has(finding.message)) {
                    return finding.fingerprint === null || prints.get(finding.message) === finding.fingerprint;
                }
                return finding.position < earliest;
            },
        );
    },

    /**
     * @param {*} value
     * @return {object|null}
     */
    note(value) {
        const settings = ScribeLive.Settings;
        const sound =
            ScribeLive.isObject(value) &&
            ScribeLive.isText(value.name) &&
            value.name !== settings.Nothing &&
            Object.values(ScribePedant.Note).includes(value.kind) &&
            ScribeLive.isText(value.text) &&
            value.text !== settings.Nothing &&
            ScribeLive.isText(value.message) &&
            ScribeLive.isText(value.fingerprint) &&
            Number.isSafeInteger(value.position);
        return sound
            ? {
                  name: value.name,
                  kind: value.kind,
                  text: value.text,
                  message: value.message,
                  fingerprint: value.fingerprint,
                  position: value.position,
              }
            : null;
    },

    /**
     * @param {*} value
     * @return {object[]}
     */
    notes(value) {
        if (!Array.isArray(value)) {
            return [];
        }
        const kept = [];
        for (const item of value) {
            const note = ScribeLive.note(item);
            if (note !== null) {
                kept.push(note);
            }
        }
        return kept;
    },

    /**
     * @param {readonly object[]} given
     * @param {object} message
     * @return {object[]}
     */
    stamped(given, message) {
        return given.map(
            /**
             * @param {{ name: string, kind: string, text: string }} note
             * @return {object}
             */
            (note) => ({
                name: note.name,
                kind: note.kind,
                text: note.text,
                message: message.id,
                fingerprint: message.fingerprint,
                position: message.position,
            }),
        );
    },

    /**
     * @param {readonly object[]} notes
     * @param {readonly object[]} given
     * @param {object} message
     * @return {object[]}
     */
    noted(notes, given, message) {
        const settings = ScribeLive.Settings;
        const keyOf =
            /**
             * @param {{ name: string, kind: string }} note
             * @return {string}
             */
            (note) => JSON.stringify([ScribeText.normaliseName(note.name), note.kind]);
        const standing = new Map();
        for (const note of notes) {
            if (note.message !== message.id) {
                standing.set(keyOf(note), note);
            }
        }
        for (const note of ScribeLive.stamped(given, message)) {
            const key = keyOf(note);
            const older = standing.get(key);
            if (older === undefined || older.position <= note.position) {
                standing.set(key, note);
            }
        }
        const all = [...standing.values()];
        const youngest = [...all]
            .sort(
                /**
                 * @param {{ position: number }} first
                 * @param {{ position: number }} second
                 * @return {number}
                 */
                (first, second) => second.position - first.position,
            )
            .slice(settings.FirstFinding, settings.NotesKept);
        return all.filter(
            /**
             * @param {object} note
             * @return {boolean}
             */
            (note) => youngest.includes(note),
        );
    },

    /**
     * @param {readonly object[]} notes
     * @param {Readonly<object>} keeperView
     * @return {object[]}
     */
    standing(notes, keeperView) {
        const read = keeperView.lastRead;
        return ScribeLive.pruned(notes, keeperView.messages).filter(
            /**
             * @param {{ kind: string, position: number }} note
             * @return {boolean}
             */
            (note) => note.kind !== ScribePedant.Note.Looks || read === null || note.position > read.position,
        );
    },

    /**
     * @param {*} value
     * @return {string|null}
     */
    edited(value) {
        const settings = ScribeLive.Settings;
        const sound =
            ScribeLive.isText(value) &&
            ScribeLive.line(value) === value &&
            !ScribeLive.hollow(value) &&
            Array.from(value).length <= settings.LongestEdit;
        return sound ? value : null;
    },

    /**
     * @param {*} value
     * @return {object[]}
     */
    retries(value) {
        const settings = ScribeLive.Settings;
        if (!Array.isArray(value)) {
            return [];
        }
        const kept = [];
        for (const entry of value.slice(settings.FirstFinding, settings.RetriesKept)) {
            const sound =
                ScribeLive.isObject(entry) &&
                ScribeLive.isText(entry.id) &&
                ScribeLive.isText(entry.fingerprint) &&
                Number.isSafeInteger(entry.position) &&
                Object.values(settings.Retried).includes(entry.role) &&
                ScribeLive.isText(entry.reason) &&
                Number.isSafeInteger(entry.tries) &&
                entry.tries >= settings.FirstTry &&
                Number.isFinite(entry.at);
            if (sound) {
                kept.push({
                    id: entry.id,
                    fingerprint: entry.fingerprint,
                    position: entry.position,
                    role: entry.role,
                    reason: entry.reason,
                    tries: entry.tries,
                    at: entry.at,
                });
            }
        }
        return kept;
    },

    /**
     * @param {*} value
     * @return {number|null}
     */
    count(value) {
        return Number.isSafeInteger(value) ? value : null;
    },

    /**
     * @param {string} text
     * @return {string}
     */
    line(text) {
        const settings = ScribeLive.Settings;
        const intake = ScribeIntake.Settings;
        const bare = ScribeIntake.collapse(text).replace(settings.EveryLead, settings.Nothing);
        return ScribeIntake.own(bare) ? bare : intake.OwnMarker + intake.Space + bare;
    },

    /**
     * @param {string} line
     * @return {boolean}
     */
    hollow(line) {
        return line.slice(ScribeIntake.Settings.OwnMarker.length).trim() === ScribeLive.Settings.Nothing;
    },

    /**
     * @param {readonly object[]} findings
     * @param {string[]} dismissed
     * @param {readonly object[]|null} raised
     * @param {object} message
     * @param {boolean} remembered
     * @return {object[]}
     */
    merged(findings, dismissed, raised, message, remembered) {
        const settings = ScribeLive.Settings;
        const statuses = ScribeLive.Status;
        if (raised === null) {
            return [...findings];
        }
        const kept = new Set(
            findings.map(
                /**
                 * @param {{ key: string }} finding
                 * @return {string}
                 */
                (finding) => finding.key,
            ),
        );
        const added = [];
        for (const finding of raised) {
            const fault = ScribePedant.key(finding);
            const key = ScribeLive.identity(fault, message.id);
            const known = dismissed.includes(fault);
            if (!kept.has(key) && (!known || remembered)) {
                kept.add(key);
                added.push({
                    ...finding,
                    fault,
                    key,
                    fingerprint: message.fingerprint,
                    status: known ? statuses.Dismissed : statuses.Open,
                });
            }
        }
        const all = [...added, ...findings];
        const youngest = [...all]
            .sort(
                /**
                 * @param {{ position: number }} first
                 * @param {{ position: number }} second
                 * @return {number}
                 */
                (first, second) => second.position - first.position,
            )
            .slice(settings.FirstFinding, settings.FindingsKept);
        return all.filter(
            /**
             * @param {object} finding
             * @return {boolean}
             */
            (finding) => youngest.includes(finding),
        );
    },

    /**
     * @param {object} live
     * @return {void}
     */
    load(live) {
        const settings = ScribeLive.Settings;
        live.record = {
            now: null,
            ready: null,
            led: [],
            basis: null,
            edited: null,
            editedFor: null,
            draft: null,
            forced: false,
            sends: settings.NoSends,
            findings: [],
            notes: [],
            dismissed: [],
            suggestion: null,
            seen: null,
            reminded: null,
            edition: null,
            checked: [],
            retries: [],
            failing: { scene: null, check: null },
            story: null,
            untold: null,
        };
        live.problem = null;
        let saved = null;
        try {
            saved = ScribeStore.read(live.storage, live.roomId, ScribeStore.Kind.Live);
        } catch (error) {
            live.problem = ScribeLive.words(error);
            live.loaded = ScribeLive.isObject(error) && error.damaged === true;
            return;
        }
        live.loaded = true;
        if (!ScribeLive.isObject(saved)) {
            return;
        }
        const record = live.record;
        record.now = ScribeLive.scene(saved.now);
        record.reminded = ScribeLive.scene(saved.reminded);
        const basis = saved.basis;
        const sound =
            ScribeLive.isObject(basis) &&
            Number.isSafeInteger(basis.revision) &&
            ScribeLive.isTexts(basis.first) &&
            ScribeLive.isText(basis.notes) &&
            ScribeLive.isText(basis.story);
        const composed = sound && ScribeLive.isText(saved.ready);
        live.owed = ScribeLive.isText(saved.ready) && !composed;
        record.ready = composed ? saved.ready : null;
        record.led = composed && ScribeLive.isTexts(saved.led) ? [...saved.led] : [];
        record.basis = composed
            ? { revision: basis.revision, first: [...basis.first], notes: basis.notes, story: basis.story }
            : null;
        record.edited = ScribeLive.edited(saved.edited);
        const written = saved.editedFor;
        const against =
            record.edited !== null &&
            ScribeLive.isObject(written) &&
            ScribeLive.isText(written.id) &&
            ScribeLive.isText(written.fingerprint);
        record.editedFor = against ? { id: written.id, fingerprint: written.fingerprint } : null;
        record.draft = ScribeLive.edited(saved.draft) ?? (against ? null : record.edited);
        record.edited = against ? record.edited : null;
        record.forced = saved.forced === true;
        record.sends = Number.isSafeInteger(saved.sends) && saved.sends >= settings.NoSends ? saved.sends : settings.NoSends;
        record.findings = ScribeLive.findings(saved.findings);
        record.notes = ScribeLive.notes(saved.notes);
        const dismissed = ScribeLive.isTexts(saved.dismissed) ? [...saved.dismissed] : [];
        for (const finding of [...record.findings].reverse()) {
            if (finding.status === ScribeLive.Status.Dismissed && !dismissed.includes(finding.fault)) {
                dismissed.push(finding.fault);
            }
        }
        record.dismissed = dismissed.slice(-settings.DismissedKept);
        record.suggestion = ScribeLive.isText(saved.suggestion) ? saved.suggestion : null;
        const seen = saved.seen;
        if (
            ScribeLive.isObject(seen) &&
            ScribeLive.isText(seen.id) &&
            ScribeLive.isText(seen.fingerprint) &&
            Number.isSafeInteger(seen.position)
        ) {
            record.seen = {
                id: seen.id,
                fingerprint: seen.fingerprint,
                position: seen.position,
                before: ScribeLive.scene(seen.before),
            };
        }
        record.edition = Number.isSafeInteger(saved.edition) ? saved.edition : null;
        record.retries = ScribeLive.retries(saved.retries);
        const failing = ScribeLive.isObject(saved.failing) ? saved.failing : {};
        record.failing = {
            scene: ScribeLive.isText(failing.scene) ? failing.scene : null,
            check: ScribeLive.isText(failing.check) ? failing.check : null,
        };
        const story = saved.story;
        if (ScribeLive.isObject(story) && ScribeLive.isText(story.key) && ScribeLive.isText(story.text)) {
            record.story = { key: story.key, text: story.text };
        }
        const untold = saved.untold;
        const owed =
            ScribeLive.isObject(untold) &&
            ScribeLive.isText(untold.key) &&
            ScribeLive.isText(untold.reason) &&
            Number.isSafeInteger(untold.tries) &&
            untold.tries >= settings.FirstTry &&
            Number.isFinite(untold.at);
        if (owed) {
            record.untold = { key: untold.key, reason: untold.reason, tries: untold.tries, at: untold.at };
        }
        if (Array.isArray(saved.checked)) {
            for (const entry of saved.checked.slice(settings.FirstFinding, settings.CheckedKept)) {
                const usable =
                    ScribeLive.isObject(entry) &&
                    ScribeLive.isText(entry.id) &&
                    ScribeLive.isText(entry.fingerprint) &&
                    Number.isSafeInteger(entry.revision) &&
                    ScribeLive.scene(entry.now) !== null &&
                    ScribeLive.isText(entry.now.fingerprint) &&
                    Array.isArray(entry.findings) &&
                    ScribeLive.findings(entry.findings).length === entry.findings.length;
                if (usable) {
                    record.checked.push({
                        id: entry.id,
                        fingerprint: entry.fingerprint,
                        revision: entry.revision,
                        now: entry.now,
                        findings: ScribeLive.findings(entry.findings),
                        notes: ScribeLive.notes(entry.notes),
                    });
                }
            }
        }
    },

    /**
     * @param {object} live
     * @return {void}
     */
    announce(live) {
        live.shown = live.problem;
        try {
            live.notify();
        } catch (error) {
            live.problem = ScribeLive.words(error);
        }
    },

    /**
     * @param {object} live
     * @return {void}
     */
    heard(live) {
        if (!live.closed && live.problem !== live.shown) {
            ScribeLive.announce(live);
        }
    },

    /**
     * @param {object} live
     * @return {void}
     */
    save(live) {
        try {
            ScribeStore.write(live.storage, live.roomId, ScribeStore.Kind.Live, live.record);
        } catch (error) {
            live.problem = ScribeLive.words(error);
        }
    },

    /**
     * @param {object} live
     * @return {void}
     */
    changed(live) {
        ScribeLive.save(live);
        ScribeLive.announce(live);
    },

    /**
     * @param {object} live
     * @return {boolean}
     */
    active(live) {
        if (live.closed) {
            return false;
        }
        const view = live.keeper.view();
        if (!view.reader) {
            live.watching = true;
            return false;
        }
        if (live.watching || !live.loaded) {
            live.watching = false;
            live.epoch++;
            ScribeLive.load(live);
        }
        if (!live.loaded || view.trusted !== true) {
            return live.loaded;
        }
        const record = live.record;
        if (record.edition === null) {
            record.edition = view.edition;
            ScribeLive.save(live);
        } else if (view.edition > record.edition) {
            live.epoch++;
            record.findings = [];
            record.dismissed = [];
            record.now = null;
            record.reminded = null;
            record.ready = null;
            record.led = [];
            record.basis = null;
            record.seen = null;
            record.suggestion = null;
            record.checked = [];
            record.retries = [];
            record.failing = { scene: null, check: null };
            record.story = null;
            record.untold = null;
            record.edition = view.edition;
            live.again = null;
            live.offer = null;
            live.excluded = [];
            live.understood = null;
            live.appended = ScribeLive.Settings.NothingAppended;
            ScribeLive.changed(live);
        }
        try {
            const kept = ScribeLive.pruned(record.findings, view.messages);
            const notes = ScribeLive.standing(record.notes, view);
            if (kept.length !== record.findings.length || notes.length !== record.notes.length) {
                record.findings = kept;
                record.notes = notes;
                ScribeLive.save(live);
            }
            ScribeLive.settled(live, view);
        } catch (error) {
            live.problem = ScribeLive.words(error);
        }
        return true;
    },

    /**
     * @param {object} live
     * @param {Readonly<object>} view
     * @return {void}
     */
    settled(live, view) {
        const settings = ScribeLive.Settings;
        const record = live.record;
        let moved = false;
        if (record.edited !== null && !ScribeLive.written(record, view)) {
            record.draft = record.edited;
            record.edited = null;
            record.editedFor = null;
            moved = true;
        }
        const reply = ScribeLive.answered(view);
        const unmarked = record.now !== null && record.now.fingerprint === undefined;
        const scheduled = record.retries.some(
            /**
             * @param {{ role: string }} entry
             * @return {boolean}
             */
            (entry) => entry.role === settings.Retried.Scene,
        );
        if (unmarked && reply !== undefined && !scheduled) {
            record.retries.unshift({
                id: reply.id,
                fingerprint: reply.fingerprint,
                position: reply.position,
                role: settings.Retried.Scene,
                reason: settings.Messages.Unmarked,
                tries: settings.FirstTry,
                at: settings.NoCount,
            });
            moved = true;
        }
        if (moved) {
            ScribeLive.save(live);
        }
    },

    /**
     * @param {object} live
     * @return {string|null}
     */
    refusal(live) {
        const settings = ScribeLive.Settings;
        const messages = settings.Messages;
        const doubt = ScribeLive.distrust(live);
        if (doubt !== null) {
            return doubt;
        }
        const view = live.keeper.view();
        const stopped = ScribeLive.isObject(view.stop) && view.stop.reason !== settings.DoneStop;
        if (view.phase === settings.StoppedPhase || stopped) {
            return messages.Stopped;
        }
        const spent =
            Number.isFinite(view.spentToday) &&
            ScribeLive.isObject(view.settings) &&
            Number.isFinite(view.settings.budget) &&
            view.spentToday >= view.settings.budget;
        if (spent) {
            live.problem = messages.Budget;
            return messages.Budget;
        }
        if (live.problem === messages.Budget) {
            live.problem = null;
        }
        return null;
    },

    /**
     * @param {object} live
     * @param {number} epoch
     * @return {boolean}
     */
    current(live, epoch) {
        return ScribeLive.active(live) && live.epoch === epoch;
    },

    /**
     * @param {object} live
     * @param {string} role
     * @param {{ failure: string|null, retryable?: boolean }} noted
     * @return {function(string, string): Promise<{ text: string, cost: * }>}
     */
    asker(live, role, noted) {
        /**
         * @param {string} system
         * @param {string} user
         * @return {Promise<{ text: string, cost: * }>}
         * @throws {Error}
         */
        const ask = async (system, user) => {
            const refused = ScribeLive.refusal(live);
            if (refused !== null) {
                throw new Error(refused);
            }
            try {
                const answer = await live.ask(role, system, user);
                ScribeLive.called(live, role, answer, null);
                return answer;
            } catch (error) {
                noted.failure = ScribeLive.words(error);
                const answered =
                    ScribeLive.isObject(error) &&
                    Number.isSafeInteger(error.status) &&
                    error.status >= ScribeLive.Settings.FirstAnswered &&
                    error.status <= ScribeLive.Settings.LastAnswered;
                noted.retryable = ScribeLive.isObject(error) && error.retryable === true && !answered;
                ScribeLive.called(live, role, error, noted.failure);
                throw error;
            }
        };
        return ask;
    },

    /**
     * @param {object} live
     * @param {string} role
     * @param {*} source
     * @param {string|null} problem
     * @return {void}
     */
    called(live, role, source, problem) {
        const settings = ScribeLive.Settings;
        const given = ScribeLive.isObject(source) ? source : {};
        live.calls = [
            Object.freeze({
                role,
                tokensIn: ScribeLive.count(given.tokensIn),
                tokensOut: ScribeLive.count(given.tokensOut),
                reasoningTokens: ScribeLive.count(given.reasoningTokens),
                finish: ScribeLive.isText(given.finish) ? given.finish : null,
                answer: ScribeLive.isText(given.answer) ? given.answer : null,
                problem,
            }),
            ...live.calls,
        ].slice(settings.FirstFinding, settings.CallsKept);
    },

    /**
     * @param {object} live
     * @param {{ failure: string|null }} noted
     * @return {void}
     */
    report(live, noted) {
        if (noted.failure !== null) {
            live.problem = noted.failure;
        }
    },

    /**
     * @param {{ findings: object[] }} record
     * @param {string} key
     * @return {object|undefined}
     */
    find(record, key) {
        return record.findings.find(
            /**
             * @param {{ key: string }} finding
             * @return {boolean}
             */
            (finding) => finding.key === key,
        );
    },

    /**
     * @param {object} live
     * @param {Readonly<object>} view
     * @param {object} finding
     * @return {Readonly<{ told: boolean, spent: boolean }>}
     */
    can(live, view, finding) {
        if (live.cans.state !== view.state) {
            live.cans = { state: view.state, byKey: new Map() };
        }
        const known = live.cans.byKey.get(finding.key);
        if (known !== undefined) {
            return known;
        }
        const can = Object.freeze({
            told: ScribePedant.told(view.state, finding) !== null,
            spent: ScribePedant.spent(view.state, finding),
        });
        live.cans.byKey.set(finding.key, can);
        return can;
    },

    /**
     * @param {readonly object[]} findings
     * @param {object} state
     * @return {string[]}
     */
    first(findings, state) {
        const settings = ScribeLive.Settings;
        const first = [];
        for (const finding of findings) {
            const open =
                finding.kind === ScribePedant.Kind.Contradiction &&
                finding.status === ScribeLive.Status.Open &&
                !ScribePedant.spent(state, finding);
            if (open && !first.includes(finding.fact) && first.length < settings.FirstMost) {
                first.push(finding.fact);
            }
        }
        return first;
    },

    /**
     * @param {readonly object[]} notes
     * @return {string}
     */
    marked(notes) {
        return ScribeText.fingerprint(JSON.stringify(notes));
    },

    /**
     * @param {{ revision: number, first: string[], notes: string }|null} basis
     * @param {object|null} reminded
     * @param {object|null} now
     * @param {readonly object[]} findings
     * @param {readonly object[]} notes
     * @param {object} state
     * @return {boolean}
     */
    holds(basis, reminded, now, findings, notes, state) {
        const differs =
            basis === null ||
            state.revision !== basis.revision ||
            !ScribeScene.same(reminded, now) ||
            ScribeLive.marked(notes) !== basis.notes;
        if (differs) {
            return false;
        }
        const first = ScribeLive.first(findings, state);
        return (
            first.length === basis.first.length &&
            first.every(
                /**
                 * @param {string} fact
                 * @param {number} index
                 * @return {boolean}
                 */
                (fact, index) => fact === basis.first[index],
            )
        );
    },

    /**
     * @param {object} live
     * @param {Readonly<object>} view
     * @return {boolean}
     */
    fresh(live, view) {
        const record = live.record;
        return (
            record.ready !== null &&
            record.story !== null &&
            record.basis !== null &&
            record.basis.story === record.story.key &&
            ScribeLive.holds(
                record.basis,
                record.reminded,
                record.now,
                record.findings,
                ScribeLive.standing(record.notes, view),
                view.state,
            )
        );
    },

    /**
     * @param {{ forced: boolean, sends: number }} record
     * @param {Readonly<object>} keeperView
     * @return {boolean}
     */
    due(record, keeperView) {
        return record.forced || record.sends >= keeperView.settings.refresh;
    },

    /**
     * @param {Readonly<object>} keeperView
     * @return {object|undefined}
     */
    answered(keeperView) {
        const listed = Array.isArray(keeperView.messages) ? keeperView.messages : [];
        return listed.findLast(
            /**
             * @param {{ fromPlayer: boolean }} message
             * @return {boolean}
             */
            (message) => message.fromPlayer !== true,
        );
    },

    /**
     * @param {object|null} now
     * @param {Readonly<object>} keeperView
     * @return {string|null}
     */
    behind(now, keeperView) {
        const settings = ScribeLive.Settings;
        const messages = settings.Messages;
        const reply = ScribeLive.answered(keeperView);
        if (reply === undefined) {
            return null;
        }
        const read =
            now === null
                ? undefined
                : keeperView.messages.find(
                      /**
                       * @param {{ id: string }} message
                       * @return {boolean}
                       */
                      (message) => message.id === now.message,
                  );
        if (read !== undefined && read.fingerprint === now.fingerprint && read.position >= reply.position) {
            return null;
        }
        if (now === null) {
            return messages.UnreadOpen + reply.position + messages.FullStop;
        }
        if (now.message === reply.id) {
            return messages.ChangedOpen + reply.position + messages.ChangedClose;
        }
        return messages.BehindOpen + now.position + messages.BehindMiddle + reply.position + messages.FullStop;
    },

    /**
     * @param {object} live
     * @return {Promise<Readonly<{ characters: readonly object[]|null, profile: string|null, notice: string|null }>>}
     */
    cast(live) {
        const settings = ScribeLive.Settings;
        const messages = settings.Messages;
        if (live.cast !== null) {
            return Promise.resolve(live.cast);
        }
        if (live.casting !== null) {
            return live.casting;
        }
        /**
         * @param {() => Promise<*>} read
         * @return {Promise<{ status: string, value?: *, reason?: * }>}
         */
        const settle = async (read) => {
            const [result] = await Promise.allSettled([Promise.resolve().then(read)]);
            return result;
        };

        /**
         * @return {Promise<Array<{ status: string, value?: *, reason?: * }>>}
         */
        const reads = async () => {
            const story = await settle(live.story);
            const told = story.status === settings.Fulfilled ? story.value : story.reason;
            const plotId = ScribeLive.isObject(told) && ScribeLive.isText(told.plotId) ? told.plotId : null;
            const profile = await settle(
                /**
                 * @return {Promise<string|null>}
                 */
                () => live.profile(plotId),
            );
            return [story, profile];
        };
        live.casting = reads().then(
            /**
             * @param {Array<{ status: string, value?: *, reason?: * }>} settled
             * @return {Readonly<{ characters: readonly object[]|null, profile: string|null, notice: string|null }>}
             */
            (settled) => {
                const [story, profile] = settled;
                live.casting = null;
                const failed = [story, profile].filter(
                    /**
                     * @param {{ status: string }} result
                     * @return {boolean}
                     */
                    (result) => result.status !== settings.Fulfilled,
                );
                const unseen = failed.some(
                    /**
                     * @param {{ reason: * }} result
                     * @return {boolean}
                     */
                    (result) => ScribeLive.words(result.reason) === ZetaSource.Settings.Messages.NoLogin,
                );
                if (live.closed || unseen) {
                    return settings.Uncast;
                }
                const read = story.status === settings.Fulfilled;
                const profiled = profile.status === settings.Fulfilled;
                const notices = [];
                if (!read) {
                    notices.push(messages.StoryUnread + ScribeLive.words(story.reason));
                }
                if (!profiled) {
                    notices.push(messages.ProfileUnread + ScribeLive.words(profile.reason));
                }
                live.cast = Object.freeze({
                    characters: read ? story.value.characters : null,
                    profile: profiled ? profile.value : null,
                    notice: notices.length === settings.NoCount ? null : notices.join(settings.Space),
                });
                return live.cast;
            },
        );
        return live.casting;
    },

    /**
     * @param {object} live
     * @param {Readonly<object>} view
     * @param {object|null} now
     * @param {readonly object[]} findings
     * @param {readonly object[]} notes
     * @return {Promise<{ composed: Readonly<{ text: string, led: readonly string[] }>|null, basis: { revision: number, first: string[], notes: string, story?: string } }>}
     */
    async remind(live, view, now, findings, notes) {
        const first = ScribeLive.first(findings, view.state);
        const given = ScribeLive.standing(notes, view);
        const basis = { revision: view.state.revision, first, notes: ScribeLive.marked(given) };
        const cast = await ScribeLive.cast(live);
        const story = await ScribeLive.recount(live, view, now);
        if (story === null) {
            return { composed: null, basis };
        }
        basis.story = live.record.story.key;
        const composed = ScribeReminder.compose({
            state: view.state,
            now,
            player: view.player,
            unread: view.unread,
            notes: given,
            characters: cast.characters,
            first: [...first],
            story,
        });
        return { composed, basis };
    },

    /**
     * @param {object} live
     * @param {Readonly<object>} view
     * @param {object|null} now
     * @return {Promise<string|null>}
     */
    async recount(live, view, now) {
        const settings = ScribeLive.Settings;
        const epoch = live.epoch;
        const record = live.record;
        const scene =
            now === null
                ? null
                : [now.day, ScribeText.normaliseName(now.place), now.reach, [...ScribeScene.identities(now)].sort()];
        const key = ScribeText.fingerprint(JSON.stringify([ScribeReminder.storyInput(view.state, null), scene]));
        if (record.story !== null && record.story.key === key) {
            return record.story.text;
        }
        const untold = record.untold === null || record.untold.key !== key ? null : record.untold;
        const resting =
            untold !== null && (untold.tries >= settings.RetryMs.length || untold.at > live.clock.now());
        if (resting) {
            return null;
        }
        if (live.recounting !== null && live.recounting.key === key) {
            return live.recounting.promise;
        }

        /**
         * @return {Promise<string|null>}
         */
        const tell = async () => {
            const noted = { failure: null, retryable: false };
            let text = null;
            try {
                const ask = ScribeLive.asker(live, settings.Roles.Scribe, noted);
                const answer = await ask(ScribeReminder.StoryPrompt, ScribeReminder.storyInput(view.state, now));
                text = ScribeReminder.told(answer.text);
            } catch (error) {
                noted.failure = ScribeLive.words(error);
            }
            if (live.epoch !== epoch) {
                return null;
            }
            if (text !== null) {
                record.story = { key, text };
                record.untold = null;
                return text;
            }
            const tries = untold === null ? settings.FirstTry : untold.tries + 1;
            const parked = !noted.retryable || tries >= settings.RetryMs.length;
            const moment = live.clock.now();
            record.untold = {
                key,
                reason: noted.failure ?? settings.Messages.StoryEmpty,
                tries: parked ? settings.RetryMs.length : tries,
                at: parked ? moment : moment + settings.RetryMs[tries],
            };
            return null;
        };
        const promise = tell();
        live.recounting = { key, promise };
        try {
            return await promise;
        } finally {
            if (live.recounting !== null && live.recounting.promise === promise) {
                live.recounting = null;
            }
        }
    },

    /**
     * @param {object} record
     * @param {{ composed: Readonly<{ text: string, led: readonly string[] }>|null, basis: { revision: number, first: string[], notes: string, story?: string } }|null} made
     * @return {void}
     */
    keep(record, made) {
        if (record.edited !== null) {
            return;
        }
        if (made === null || made.composed === null) {
            record.ready = null;
            record.led = [];
            record.basis = null;
            return;
        }
        record.ready = made.composed.text;
        record.led = [...made.composed.led];
        record.basis = made.basis;
        record.reminded = record.now;
    },

    /**
     * @param {object} live
     * @param {object} message
     * @param {object|null} again
     * @return {Promise<void>}
     */
    async consider(live, message, again = null) {
        const settings = ScribeLive.Settings;
        const roles = settings.Roles;
        const statuses = ScribeLive.Status;
        if (live.closed || message.fromPlayer || ScribeLive.refusal(live) !== null) {
            return;
        }
        const record = live.record;
        const view = live.keeper.view();
        const revision = view.state.revision;
        const seen = record.seen;
        const repeated = seen !== null && seen.id === message.id && seen.fingerprint === message.fingerprint;
        if (again === null && repeated) {
            return;
        }
        const epoch = live.epoch;
        const earlier = live.problem;
        live.problem = null;
        const replaced = seen !== null && seen.position === message.position;
        const previous = replaced ? seen.before : record.now;
        const remembered =
            again !== null
                ? undefined
                : record.checked.find(
                      /**
                       * @param {{ id: string, fingerprint: string, revision: number }} entry
                       * @return {boolean}
                       */
                      (entry) =>
                          entry.id === message.id &&
                          entry.fingerprint === message.fingerprint &&
                          entry.revision === revision,
                  );
        if (again === null) {
            record.seen = {
                id: message.id,
                fingerprint: message.fingerprint,
                position: message.position,
                before: previous,
            };
        }
        const kinds = settings.Retried;
        const asking = {
            scene: again === null || again.role === kinds.Scene,
            check: again === null || again.role === kinds.Check,
        };
        const failed = { scene: null, check: null, sceneRetryable: false, checkRetryable: false };
        let found = null;
        let raised = null;
        let notes = null;
        if (remembered === undefined) {
            let profile = null;
            try {
                profile = (await ScribeLive.cast(live)).profile;
            } catch (error) {
                live.problem = ScribeLive.words(error);
            }
            if (asking.scene) {
                const sceneNoted = { failure: null, retryable: false };
                try {
                    found = await ScribeScene.now({
                        state: view.state,
                        player: view.player,
                        messages: view.messages,
                        previous,
                        ask: ScribeLive.asker(live, roles.Scribe, sceneNoted),
                        profile,
                    });
                } catch (error) {
                    live.problem = ScribeLive.words(error);
                }
                ScribeLive.report(live, sceneNoted);
                if (!ScribeLive.current(live, epoch)) {
                    return;
                }
                if (found === null) {
                    failed.scene = sceneNoted.failure ?? settings.Messages.SceneUnreadable;
                    failed.sceneRetryable = sceneNoted.retryable;
                }
            }
            if (asking.check) {
                const pedantNoted = { failure: null, retryable: false };
                try {
                    const reviewed = await ScribePedant.review({
                        state: view.state,
                        player: view.player,
                        message,
                        unread: view.unread,
                        messages: view.messages,
                        ask: ScribeLive.asker(live, roles.Pedant, pedantNoted),
                        profile,
                    });
                    raised = reviewed.findings;
                    notes = reviewed.notes;
                } catch (error) {
                    live.problem = ScribeLive.words(error);
                    failed.check = pedantNoted.failure ?? ScribeLive.words(error);
                    failed.checkRetryable = pedantNoted.retryable;
                }
                ScribeLive.report(live, pedantNoted);
                if (!ScribeLive.current(live, epoch)) {
                    return;
                }
            }
            if (ScribeLive.refusal(live) !== null) {
                record.seen = seen;
                if (ScribeLive.distrust(live) !== null) {
                    live.problem = earlier;
                }
                return;
            }
        } else {
            found = remembered.now;
            raised = remembered.findings;
            notes = remembered.notes;
        }
        const kept = asking.scene ? previous : record.now;
        const now = found === null ? kept : found;
        const draft = ScribeLive.merged(
            ScribeLive.pruned(record.findings, view.messages),
            record.dismissed,
            raised,
            message,
            remembered !== undefined,
        );
        let made = null;
        try {
            if (record.edited === null && ScribeLive.due(record, view) && ScribeLive.behind(now, view) === null) {
                const drafted =
                    notes === null
                        ? record.notes
                        : ScribeLive.noted(ScribeLive.standing(record.notes, view), notes, message);
                made = await ScribeLive.remind(live, view, now, draft, drafted);
            }
        } catch (error) {
            live.problem = ScribeLive.words(error);
        }
        if (!ScribeLive.current(live, epoch)) {
            return;
        }
        if (!ScribeLive.trusted(live)) {
            record.seen = seen;
            live.problem = earlier;
            return;
        }
        const latest = live.keeper.view();
        if (found !== null && !ScribeScene.same(previous, found)) {
            live.offer = null;
            live.excluded = [];
        }
        if (remembered === undefined) {
            ScribeLive.retried(live, message, again, asking, failed);
        }
        record.now = now;
        record.findings = ScribeLive.merged(
            ScribeLive.pruned(record.findings, latest.messages),
            record.dismissed,
            raised,
            message,
            remembered !== undefined,
        );
        if (notes !== null) {
            record.notes = ScribeLive.noted(ScribeLive.standing(record.notes, latest), notes, message);
        }
        if (remembered === undefined && found !== null && raised !== null) {
            const entry = {
                id: message.id,
                fingerprint: message.fingerprint,
                revision,
                now: found,
                findings: raised.map(
                    /**
                     * @param {object} finding
                     * @return {object}
                     */
                    (finding) => ({
                        ...finding,
                        fault: ScribePedant.key(finding),
                        key: ScribeLive.identity(ScribePedant.key(finding), message.id),
                        fingerprint: message.fingerprint,
                        status: statuses.Open,
                    }),
                ),
                notes: ScribeLive.stamped(notes, message),
            };
            record.checked = [
                entry,
                ...record.checked.filter(
                    /**
                     * @param {{ id: string, fingerprint: string }} other
                     * @return {boolean}
                     */
                    (other) => other.id !== message.id || other.fingerprint !== message.fingerprint,
                ),
            ].slice(settings.FirstFinding, settings.CheckedKept);
        }
        const ready =
            made !== null &&
            made.composed !== null &&
            record.edited === null &&
            ScribeLive.due(record, latest) &&
            ScribeLive.behind(now, latest) === null &&
            ScribeLive.holds(
                made.basis,
                now,
                record.now,
                record.findings,
                ScribeLive.standing(record.notes, latest),
                latest.state,
            );
        if (ready) {
            ScribeLive.keep(record, made);
        } else if (
            record.forced &&
            record.ready === null &&
            record.edited === null &&
            (made === null || made.composed !== null)
        ) {
            live.refreshing = true;
        }
        ScribeLive.changed(live);
    },

    /**
     * @param {object} live
     * @param {object} message
     * @param {object|null} again
     * @param {{ scene: boolean, check: boolean }} asking
     * @param {{ scene: string|null, check: string|null, sceneRetryable: boolean, checkRetryable: boolean }} failed
     * @return {void}
     */
    retried(live, message, again, asking, failed) {
        const settings = ScribeLive.Settings;
        const kinds = settings.Retried;
        const record = live.record;
        const moment = live.clock.now();
        const roles = [
            { role: kinds.Scene, asked: asking.scene, reason: failed.scene, retryable: failed.sceneRetryable },
            { role: kinds.Check, asked: asking.check, reason: failed.check, retryable: failed.checkRetryable },
        ];
        const added = [];
        for (const { role, asked, reason, retryable } of roles) {
            if (!asked) {
                continue;
            }
            /**
             * @param {{ id: string, fingerprint: string, role: string }} entry
             * @return {boolean}
             */
            const mine = (entry) =>
                entry.role === role && entry.id === message.id && entry.fingerprint === message.fingerprint;
            if (reason === null) {
                record.failing[role] = null;
                record.retries = record.retries.filter(
                    /**
                     * @param {{ id: string, fingerprint: string, role: string }} entry
                     * @return {boolean}
                     */
                    (entry) => (role === kinds.Scene ? entry.role !== role : !mine(entry)),
                );
                continue;
            }
            const tries = again !== null && again.role === role ? again.tries + 1 : settings.FirstTry;
            const parked = !retryable || tries >= settings.RetryMs.length;
            if (parked) {
                record.failing[role] = reason;
            }
            record.retries = record.retries.filter(
                /**
                 * @param {{ id: string, fingerprint: string, role: string }} entry
                 * @return {boolean}
                 */
                (entry) => (role === kinds.Scene ? entry.role !== role : !mine(entry)),
            );
            added.push({
                id: message.id,
                fingerprint: message.fingerprint,
                position: message.position,
                role,
                reason,
                tries: parked ? settings.RetryMs.length : tries,
                at: parked ? moment : moment + settings.RetryMs[tries],
            });
        }
        for (const entry of added) {
            if (record.retries.length >= settings.RetriesKept) {
                const spent = record.retries.findLastIndex(
                    /**
                     * @param {{ tries: number }} kept
                     * @return {boolean}
                     */
                    (kept) => kept.tries >= settings.RetryMs.length,
                );
                if (spent === settings.NotFound) {
                    record.failing[entry.role] = entry.reason;
                    continue;
                }
                record.retries.splice(spent, settings.Removed);
            }
            record.retries.unshift(entry);
        }
    },

    /**
     * @param {object} live
     * @return {void}
     */
    rekey(live) {
        const settings = ScribeLive.Settings;
        if (!ScribeLive.active(live)) {
            return;
        }
        const record = live.record;
        const spent = settings.RetryMs.length;
        const parked = record.retries.some(
            /**
             * @param {{ tries: number }} entry
             * @return {boolean}
             */
            (entry) => entry.tries >= spent,
        );
        const untold = record.untold !== null && record.untold.tries >= spent;
        if (!parked && !untold) {
            return;
        }
        const moment = live.clock.now();
        const reply = ScribeLive.answered(live.keeper.view());
        record.failing = { scene: null, check: null };
        record.retries = record.retries.filter(
            /**
             * @param {{ id: string, fingerprint: string, role: string }} entry
             * @return {boolean}
             */
            (entry) =>
                entry.role === settings.Retried.Scene ||
                (reply !== undefined && entry.id === reply.id && entry.fingerprint === reply.fingerprint),
        );
        for (const entry of record.retries) {
            entry.tries = settings.FirstTry;
            entry.at = moment;
        }
        if (record.untold !== null) {
            record.untold.tries = settings.FirstTry;
            record.untold.at = moment;
        }
        ScribeLive.changed(live);
        ScribeLive.view(live);
    },

    /**
     * @param {object} live
     * @param {Readonly<object>} keeperView
     * @return {{ entry: object, message: object }|null}
     */
    overdue(live, keeperView) {
        const record = live.record;
        const listed = Array.isArray(keeperView.messages) ? keeperView.messages : [];
        const moment = live.clock.now();
        const standing = record.retries.filter(
            /**
             * @param {{ id: string, fingerprint: string }} entry
             * @return {boolean}
             */
            (entry) =>
                listed.some(
                    /**
                     * @param {{ id: string, fingerprint: string }} message
                     * @return {boolean}
                     */
                    (message) => message.id === entry.id && message.fingerprint === entry.fingerprint,
                ),
        );
        if (standing.length !== record.retries.length) {
            record.retries = standing;
            ScribeLive.save(live);
        }
        const entry = standing.find(
            /**
             * @param {{ at: number, tries: number }} candidate
             * @return {boolean}
             */
            (candidate) => candidate.at <= moment && candidate.tries < ScribeLive.Settings.RetryMs.length,
        );
        if (entry === undefined) {
            return null;
        }
        const message = listed.find(
            /**
             * @param {{ id: string, fingerprint: string }} candidate
             * @return {boolean}
             */
            (candidate) => candidate.id === entry.id && candidate.fingerprint === entry.fingerprint,
        );
        return { entry, message };
    },

    /**
     * @param {object} live
     * @return {Promise<void>}
     */
    async refresh(live) {
        if (ScribeLive.refusal(live) !== null) {
            return;
        }
        const view = live.keeper.view();
        const record = live.record;
        const owed = record.forced || record.untold !== null || live.owed;
        const waiting = record.ready === null ? owed && record.now !== null : !ScribeLive.fresh(live, view);
        const stale = ScribeLive.behind(record.now, view) !== null;
        if (record.edited !== null || !ScribeLive.due(record, view) || !waiting || stale) {
            return;
        }
        live.owed = false;
        const epoch = live.epoch;
        const now = record.now;
        let made = null;
        try {
            made = await ScribeLive.remind(live, view, now, record.findings, record.notes);
        } catch (error) {
            live.problem = ScribeLive.words(error);
        }
        if (!ScribeLive.current(live, epoch) || !ScribeLive.trusted(live)) {
            return;
        }
        const latest = live.keeper.view();
        if (made === null || made.composed === null) {
            if (record.ready !== null && !ScribeLive.fresh(live, latest)) {
                ScribeLive.keep(record, null);
            }
        } else if (
            ScribeLive.due(record, latest) &&
            ScribeLive.holds(
                made.basis,
                now,
                record.now,
                record.findings,
                ScribeLive.standing(record.notes, latest),
                latest.state,
            )
        ) {
            ScribeLive.keep(record, made);
        }
        ScribeLive.changed(live);
    },

    /**
     * @param {object} live
     * @return {Promise<void>}
     * @throws {Error}
     */
    async force(live) {
        if (live.closed) {
            return;
        }
        const blocked = ScribeLive.forceBlock(live);
        if (blocked !== null) {
            throw new Error(blocked);
        }
        if (live.forcing) {
            throw new Error(ScribeLive.Settings.Messages.Busy);
        }
        const record = live.record;
        live.forcing = true;
        try {
            record.forced = true;
            ScribeLive.changed(live);
            if (
                record.edited !== null ||
                ScribeLive.fresh(live, live.keeper.view()) ||
                record.now === null ||
                ScribeLive.behind(record.now, live.keeper.view()) !== null ||
                live.running !== null ||
                live.refreshing
            ) {
                return;
            }
            const epoch = live.epoch;
            const now = record.now;
            let made = null;
            try {
                made = await ScribeLive.remind(live, live.keeper.view(), now, record.findings, record.notes);
            } catch (error) {
                live.problem = ScribeLive.words(error);
            }
            if (!ScribeLive.current(live, epoch) || !ScribeLive.trusted(live)) {
                return;
            }
            const latest = live.keeper.view();
            const kept =
                made !== null &&
                made.composed !== null &&
                record.edited === null &&
                ScribeLive.due(record, latest) &&
                ScribeLive.holds(
                    made.basis,
                    now,
                    record.now,
                    record.findings,
                    ScribeLive.standing(record.notes, latest),
                    latest.state,
                );
            if (kept) {
                ScribeLive.keep(record, made);
            }
            ScribeLive.changed(live);
        } finally {
            live.forcing = false;
        }
    },

    /**
     * @param {object} live
     * @return {Promise<void>}
     */
    async drain(live) {
        while (!live.closed && (live.waiting !== null || live.again !== null || live.refreshing)) {
            if (live.waiting !== null) {
                const next = live.waiting;
                live.waiting = null;
                try {
                    await ScribeLive.consider(live, next);
                } catch (error) {
                    live.problem = ScribeLive.words(error);
                }
            } else if (live.again !== null) {
                const retry = live.again;
                live.again = null;
                try {
                    await ScribeLive.consider(live, retry.message, retry.entry);
                } catch (error) {
                    live.problem = ScribeLive.words(error);
                }
            } else {
                live.refreshing = false;
                try {
                    await ScribeLive.refresh(live);
                } catch (error) {
                    live.problem = ScribeLive.words(error);
                }
            }
            ScribeLive.heard(live);
        }
        live.running = null;
    },

    /**
     * @param {object} live
     * @return {Promise<void>}
     */
    kick(live) {
        if (live.running === null) {
            live.running = ScribeLive.drain(live);
        }
        return live.running;
    },

    /**
     * @param {object} live
     * @param {object} message
     * @return {Promise<void>}
     */
    async reply(live, message) {
        if (live.closed) {
            return;
        }
        live.waiting = message;
        await ScribeLive.kick(live);
    },

    /**
     * @param {object} live
     * @param {string} text
     * @return {string}
     */
    outgoing(live, text) {
        const settings = ScribeLive.Settings;
        live.appended = settings.NothingAppended;
        ScribeLive.active(live);
        const offer = ScribeLive.lines(live);
        const made = ScribeSender.compose(text, offer, settings.MessageBytes);
        live.crowded = made.crowded;
        live.appended = Object.freeze({
            ready: made.ready ? offer.ready : null,
            suggestion: made.suggestion ? offer.suggestion : null,
            carried: made.carried,
            crowded: made.crowded,
        });
        return made.text;
    },

    /**
     * @param {object} live
     * @return {Readonly<{ ready: string|null, suggestion: string|null }>}
     */
    lines(live) {
        const nothing = ScribeLive.Settings.NothingAppended;
        if (live.closed || !live.loaded || live.watching) {
            return nothing;
        }
        const view = live.keeper.view();
        const record = live.record;
        const renewed = record.edition !== null && view.edition > record.edition;
        if (!view.reader || view.trusted !== true || renewed) {
            return nothing;
        }
        const waiting = ScribeLive.due(record, view) && ScribeLive.fresh(live, view) ? record.ready : null;
        const current = ScribeLive.behind(record.now, view) === null;
        const typed = record.edited !== null && ScribeLive.written(record, view);
        const prepared = current ? waiting : null;
        return Object.freeze({
            ready: typed ? record.edited : prepared,
            suggestion: record.suggestion,
            ends: Object.freeze(typed || prepared === null ? [] : ScribeReminder.ends(prepared)),
        });
    },

    /**
     * @param {object} live
     * @param {{ ready: string|null, suggestion: string|null, carried?: string|null, crowded?: boolean }} lines
     * @return {void}
     */
    went(live, lines) {
        const settings = ScribeLive.Settings;
        if (!ScribeLive.active(live)) {
            return;
        }
        const record = live.record;
        const state = live.keeper.view().state;
        live.crowded = lines.crowded === true;
        if (lines.ready !== null && lines.ready === (record.edited ?? record.ready)) {
            const led = record.led;
            const carried = ScribeLive.isText(lines.carried) ? lines.carried : lines.ready;
            const said = new Set(ScribeText.words(carried));
            ScribeLive.skip(record);
            for (const finding of record.findings) {
                const reminded =
                    finding.kind === ScribePedant.Kind.Contradiction &&
                    finding.status === ScribeLive.Status.Open &&
                    led.includes(finding.fact) &&
                    ScribeText.words(finding.book).every(
                        /**
                         * @param {string} word
                         * @return {boolean}
                         */
                        (word) => said.has(word),
                    ) &&
                    !ScribePedant.spent(state, finding);
                if (reminded) {
                    finding.status = ScribeLive.Status.Reminded;
                }
            }
        }
        if (record.suggestion === lines.suggestion) {
            record.suggestion = null;
        }
        if (lines.ready !== null) {
            record.forced = false;
        }
        record.sends = lines.ready === null ? record.sends + settings.OneSend : settings.NoSends;
        ScribeLive.changed(live);
    },

    /**
     * @param {object} live
     * @return {void}
     */
    sent(live) {
        const went = live.appended;
        live.appended = ScribeLive.Settings.NothingAppended;
        ScribeLive.went(live, went);
    },

    /**
     * @param {object} live
     * @param {string} key
     * @return {void}
     */
    dismiss(live, key) {
        if (!ScribeLive.active(live)) {
            return;
        }
        const record = live.record;
        const finding = ScribeLive.find(record, key);
        if (finding === undefined) {
            return;
        }
        const fault = finding.fault;
        for (const each of record.findings) {
            if (each.fault === fault) {
                each.status = ScribeLive.Status.Dismissed;
            }
        }
        record.dismissed = [
            ...record.dismissed.filter(
                /**
                 * @param {string} kept
                 * @return {boolean}
                 */
                (kept) => kept !== fault,
            ),
            fault,
        ].slice(-ScribeLive.Settings.DismissedKept);
        ScribeLive.changed(live);
    },

    /**
     * @param {object} live
     * @param {string} key
     * @return {Promise<void>}
     * @throws {Error}
     */
    async told(live, key) {
        if (!ScribeLive.trusted(live)) {
            return;
        }
        const finding = ScribeLive.find(live.record, key);
        if (finding === undefined || finding.status !== ScribeLive.Status.Open) {
            return;
        }
        if (live.ruling) {
            throw new Error(ScribeLive.Settings.Messages.Busy);
        }
        const ruling = ScribePedant.told(live.keeper.view().state, finding);
        if (ruling === null) {
            return;
        }
        live.ruling = true;
        try {
            await live.keeper.rule(ruling);
        } catch (error) {
            if (live.closed) {
                return;
            }
            throw error;
        } finally {
            live.ruling = false;
        }
        if (!ScribeLive.active(live)) {
            return;
        }
        const ruled = ScribeLive.find(live.record, key);
        if (ruled === undefined) {
            return;
        }
        ruled.status = ScribeLive.Status.Told;
        ScribeLive.changed(live);
    },

    /**
     * @param {object} live
     * @param {string} text
     * @return {void}
     */
    use(live, text) {
        if (!ScribeLive.active(live)) {
            return;
        }
        const line = ScribeIntake.collapse(text);
        if (line === ScribeLive.Settings.Nothing) {
            return;
        }
        live.record.suggestion = line;
        if (live.offer !== null && live.offer.text === line) {
            live.offer = null;
        }
        ScribeLive.changed(live);
    },

    /**
     * @param {object} live
     * @return {void}
     */
    clear(live) {
        if (!ScribeLive.active(live)) {
            return;
        }
        const record = live.record;
        ScribeLive.skip(record);
        record.draft = null;
        record.suggestion = null;
        ScribeLive.changed(live);
    },

    /**
     * @param {object} record
     * @return {void}
     */
    skip(record) {
        record.ready = null;
        record.led = [];
        record.basis = null;
        record.edited = null;
        record.editedFor = null;
        record.forced = false;
        record.sends = ScribeLive.Settings.NoSends;
    },

    /**
     * @param {{ editedFor: { id: string, fingerprint: string }|null }} record
     * @param {Readonly<object>} keeperView
     * @return {boolean}
     */
    written(record, keeperView) {
        const reply = ScribeLive.answered(keeperView);
        const against = record.editedFor;
        if (reply === undefined) {
            return against === null;
        }
        return against !== null && against.id === reply.id && against.fingerprint === reply.fingerprint;
    },

    /**
     * @param {object} live
     * @param {string} text
     * @param {boolean|null} shown
     * @param {{ id: string, fingerprint: string }|null|undefined} against
     * @return {void}
     * @throws {Error}
     */
    edit(live, text, shown, against) {
        const settings = ScribeLive.Settings;
        if (!ScribeLive.active(live)) {
            return;
        }
        const line = ScribeLive.line(text);
        const record = live.record;
        if (ScribeLive.hollow(line)) {
            if (shown ?? ScribeLive.lines(live).ready !== null) {
                ScribeLive.skip(record);
                record.draft = null;
                ScribeLive.changed(live);
            }
            return;
        }
        if (Array.from(line).length > settings.LongestEdit) {
            throw new Error(settings.Messages.LongEdit);
        }
        const reply = ScribeLive.answered(live.keeper.view());
        const latest = reply === undefined ? null : { id: reply.id, fingerprint: reply.fingerprint };
        const opened = against === undefined ? latest : against;
        const same =
            opened === null || latest === null
                ? opened === latest
                : opened.id === latest.id && opened.fingerprint === latest.fingerprint;
        record.edited = same ? line : null;
        record.editedFor = same ? latest : null;
        record.draft = same ? null : line;
        record.led = [];
        ScribeLive.changed(live);
    },

    /**
     * @param {object} live
     * @return {string|null}
     */
    forceBlock(live) {
        const messages = ScribeLive.Settings.Messages;
        if (!ScribeLive.active(live)) {
            return ScribeLive.distrust(live);
        }
        const view = live.keeper.view();
        if (view.booked !== true) {
            return messages.NoBook;
        }
        if (view.trusted === true) {
            return null;
        }
        return ScribeLive.isText(view.problem) && view.problem !== ScribeLive.Settings.Nothing
            ? view.problem
            : messages.NotRead;
    },

    /**
     * @param {object} live
     * @return {Promise<void>}
     * @throws {Error}
     */
    async suggest(live) {
        const settings = ScribeLive.Settings;
        if (live.closed) {
            return;
        }
        const refused = ScribeLive.refusal(live);
        if (refused !== null) {
            throw new Error(refused);
        }
        if (live.suggesting) {
            throw new Error(settings.Messages.Busy);
        }
        const epoch = live.epoch;
        const excluded = live.excluded;
        const view = live.keeper.view();
        live.suggesting = true;
        const noted = { failure: null };
        let offer = null;
        try {
            offer = await ScribeMuse.suggest({
                state: view.state,
                now: live.record.now,
                recent: view.messages.slice(-settings.Recent),
                exclude: [...excluded],
                ask: ScribeLive.asker(live, settings.Roles.Scribe, noted),
            });
        } finally {
            live.suggesting = false;
        }
        if (!ScribeLive.current(live, epoch) || !ScribeLive.trusted(live) || live.excluded !== excluded) {
            return;
        }
        ScribeLive.report(live, noted);
        live.offer = offer;
        if (offer !== null) {
            excluded.push(offer.thread);
        }
        ScribeLive.announce(live);
    },

    /**
     * @param {object} live
     * @return {void}
     */
    ignore(live) {
        if (!ScribeLive.active(live)) {
            return;
        }
        live.offer = null;
        ScribeLive.announce(live);
    },

    /**
     * @param {object} live
     * @param {string} words
     * @return {Promise<void>}
     * @throws {Error}
     */
    async tell(live, words) {
        const settings = ScribeLive.Settings;
        if (live.closed) {
            return;
        }
        const refused = ScribeLive.refusal(live);
        if (refused !== null) {
            throw new Error(refused);
        }
        if (live.telling) {
            throw new Error(settings.Messages.Busy);
        }
        live.telling = true;
        try {
            const epoch = live.epoch;
            const view = live.keeper.view();
            const anchor = view.lastRead;
            const noted = { failure: null };
            const result = await ScribeMuse.tell({
                state: view.state,
                player: view.player,
                words,
                anchor,
                ask: ScribeLive.asker(live, settings.Roles.Analyzer, noted),
            });
            if (!ScribeLive.current(live, epoch) || !ScribeLive.trusted(live)) {
                return;
            }
            ScribeLive.report(live, noted);
            if (result === null) {
                live.understood = null;
                ScribeLive.announce(live);
                return;
            }
            let foreseen = { lines: Object.freeze([]), refused: Object.freeze([]) };
            if (result.operations.length > settings.NoCount) {
                try {
                    foreseen = await ScribeLive.foresee(live, result.operations, anchor);
                } catch (error) {
                    if (live.closed) {
                        return;
                    }
                    live.understood = null;
                    ScribeLive.announce(live);
                    throw error;
                }
                if (!ScribeLive.current(live, epoch) || !ScribeLive.trusted(live)) {
                    return;
                }
            }
            live.understood = {
                operations: result.operations,
                anchor,
                mused: result.refused,
                lines: foreseen.lines,
                refused: Object.freeze([...result.refused, ...foreseen.refused]),
            };
            ScribeLive.announce(live);
        } finally {
            live.telling = false;
        }
    },

    /**
     * @param {object} live
     * @param {readonly object[]} operations
     * @param {{ id: string, position: number }} anchor
     * @return {Promise<{ lines: readonly string[], refused: readonly object[] }>}
     * @throws {Error}
     */
    async foresee(live, operations, anchor) {
        const preview = await live.keeper.preview(operations, anchor);
        return { lines: ScribeMuse.changes(preview.before, preview.state), refused: preview.refused };
    },

    /**
     * @param {object} live
     * @return {string|null}
     */
    distrust(live) {
        const messages = ScribeLive.Settings.Messages;
        if (!ScribeLive.active(live)) {
            return live.loaded ? messages.Watching : messages.Unread;
        }
        return live.keeper.view().trusted === true ? null : messages.Untrusted;
    },

    /**
     * @param {object} live
     * @return {boolean}
     */
    trusted(live) {
        return ScribeLive.distrust(live) === null;
    },

    /**
     * @param {object} live
     * @return {Promise<void>}
     * @throws {Error}
     */
    async confirm(live) {
        if (live.closed) {
            return;
        }
        const doubt = ScribeLive.distrust(live);
        const understood = live.understood;
        if (understood === null || understood.operations.length === ScribeLive.Settings.NoCount) {
            return;
        }
        if (doubt !== null) {
            throw new Error(doubt);
        }
        if (live.confirming) {
            throw new Error(ScribeLive.Settings.Messages.Busy);
        }
        live.confirming = true;
        try {
            let foreseen = null;
            try {
                foreseen = await ScribeLive.foresee(live, understood.operations, understood.anchor);
            } catch (error) {
                if (live.closed) {
                    return;
                }
                throw error;
            }
            if (live.closed) {
                return;
            }
            const lost = ScribeLive.distrust(live);
            if (lost !== null) {
                throw new Error(lost);
            }
            if (live.understood !== understood) {
                return;
            }
            const unchanged =
                foreseen.lines.length === understood.lines.length &&
                foreseen.lines.every(
                    /**
                     * @param {string} line
                     * @param {number} index
                     * @return {boolean}
                     */
                    (line, index) => line === understood.lines[index],
                );
            if (!unchanged) {
                live.understood = {
                    ...understood,
                    lines: foreseen.lines,
                    refused: Object.freeze([...understood.mused, ...foreseen.refused]),
                };
                ScribeLive.announce(live);
                return;
            }
            try {
                await live.keeper.file(understood.operations, understood.anchor);
            } catch (error) {
                if (live.closed) {
                    return;
                }
                throw error;
            }
            if (live.understood === understood) {
                live.understood = null;
            }
            if (!ScribeLive.active(live)) {
                return;
            }
            ScribeLive.announce(live);
        } finally {
            live.confirming = false;
        }
    },

    /**
     * @param {object} live
     * @return {void}
     */
    forget(live) {
        if (!ScribeLive.active(live)) {
            return;
        }
        live.understood = null;
        ScribeLive.announce(live);
    },

    /**
     * @param {object} live
     * @return {void}
     */
    close(live) {
        live.closed = true;
        live.epoch++;
        live.waiting = null;
        live.again = null;
        live.refreshing = false;
    },

    /**
     * @param {object} live
     * @return {Readonly<object>}
     */
    view(live) {
        const settings = ScribeLive.Settings;
        const reading = ScribeLive.refusal(live) === null;
        const record = live.record;
        const understood = live.understood;
        const keeperView = live.keeper.view();
        if (reading) {
            const newest = Array.isArray(keeperView.messages) ? keeperView.messages.at(settings.Last) : undefined;
            const seen = record.seen;
            const unchecked =
                ScribeLive.isObject(newest) &&
                newest.fromPlayer !== true &&
                (seen === null ||
                    seen.id !== newest.id ||
                    seen.fingerprint !== newest.fingerprint);
            if (unchecked && live.running === null && live.waiting === null) {
                live.waiting = newest;
            }
            if (live.running === null && live.waiting === null && live.again === null) {
                live.again = ScribeLive.overdue(live, keeperView);
            }
            const untold = record.untold;
            const retold =
                untold !== null &&
                untold.tries < settings.RetryMs.length &&
                untold.at <= live.clock.now() &&
                record.ready === null;
            live.refreshing =
                live.refreshing ||
                (record.edited === null &&
                    ScribeLive.due(record, keeperView) &&
                    ((record.ready !== null && !ScribeLive.fresh(live, keeperView)) ||
                        retold ||
                        (live.owed && record.ready === null)));
            if (live.waiting !== null || live.again !== null || live.refreshing) {
                Promise.resolve().then(
                    /**
                     * @return {Promise<void>}
                     */
                    () => ScribeLive.kick(live),
                );
            }
        }
        live.shown = live.problem;
        const messages = settings.Messages;
        const failing = [];
        if (record.failing.scene !== null) {
            failing.push(messages.SceneFailing + record.failing.scene);
        }
        if (record.failing.check !== null) {
            failing.push(messages.ChecksFailing + record.failing.check);
        }
        if (record.untold !== null && record.untold.tries >= settings.RetryMs.length) {
            failing.push(messages.StoryFailing + record.untold.reason);
        }
        const untold = record.untold !== null && record.ready === null ? messages.Untold + record.untold.reason : null;
        const typed = record.edited !== null && ScribeLive.written(record, keeperView);
        const draft = typed ? null : (record.draft ?? record.edited);
        let held = null;
        if (draft !== null) {
            held = messages.EditStale;
        } else if (!typed) {
            held = ScribeLive.behind(record.now, keeperView) ?? untold ?? (live.crowded ? messages.Crowded : null);
        } else if (live.crowded) {
            held = messages.Crowded;
        }
        const latest = ScribeLive.answered(keeperView);
        return Object.freeze({
            now: record.now,
            ready: ScribeLive.lines(live).ready,
            draft,
            stale: draft !== null,
            latest: latest === undefined ? null : Object.freeze({ id: latest.id, fingerprint: latest.fingerprint }),
            held,
            failing: Object.freeze(failing),
            calls: Object.freeze([...live.calls]),
            due: ScribeLive.due(record, keeperView),
            edited: typed,
            prepared: record.ready !== null,
            forced: record.forced,
            forceBlock: ScribeLive.forceBlock(live),
            sends: record.sends,
            findings: Object.freeze(
                record.findings.map(
                    /**
                     * @param {object} finding
                     * @return {Readonly<object>}
                     */
                    (finding) =>
                        Object.freeze({
                            ...finding,
                            can:
                                finding.status === ScribeLive.Status.Open
                                    ? ScribeLive.can(live, keeperView, finding)
                                    : null,
                        }),
                ),
            ),
            suggestion: record.suggestion,
            offer: live.offer,
            notice: live.cast === null ? null : live.cast.notice,
            understood:
                understood === null
                    ? null
                    : Object.freeze({
                          lines: understood.lines,
                          refused: understood.refused,
                          count: understood.operations.length,
                      }),
            problem: live.problem,
        });
    },

    /**
     * @param {object} live
     * @return {Readonly<object>}
     */
    handle(live) {
        return Object.freeze({
            /**
             * @return {Readonly<object>}
             */
            view: () => ScribeLive.view(live),

            /**
             * @param {object} message
             * @return {Promise<void>}
             */
            reply: (message) => ScribeLive.reply(live, message),

            /**
             * @param {string} text
             * @return {string}
             */
            outgoing: (text) => ScribeLive.outgoing(live, text),

            /**
             * @return {void}
             */
            sent: () => {
                ScribeLive.sent(live);
            },

            /**
             * @return {Readonly<{ ready: string|null, suggestion: string|null }>}
             */
            lines: () => ScribeLive.lines(live),

            /**
             * @param {{ ready: string|null, suggestion: string|null, carried?: string|null, crowded?: boolean }} lines
             * @return {void}
             */
            went: (lines) => {
                ScribeLive.went(live, lines);
            },

            /**
             * @param {string} key
             * @return {void}
             */
            dismiss: (key) => {
                ScribeLive.dismiss(live, key);
            },

            /**
             * @param {string} key
             * @return {Promise<void>}
             */
            told: (key) => ScribeLive.told(live, key),

            /**
             * @param {string} text
             * @return {void}
             */
            use: (text) => {
                ScribeLive.use(live, text);
            },

            /**
             * @return {void}
             */
            clear: () => {
                ScribeLive.clear(live);
            },

            /**
             * @param {string} text
             * @param {boolean|null} shown
             * @param {{ id: string, fingerprint: string }|null|undefined} against
             * @return {void}
             */
            edit: (text, shown = null, against = undefined) => {
                ScribeLive.edit(live, text, shown, against);
            },

            /**
             * @return {Promise<void>}
             */
            force: () => ScribeLive.force(live),

            /**
             * @return {void}
             */
            rekey: () => {
                ScribeLive.rekey(live);
            },

            /**
             * @return {Promise<string|null>}
             */
            profile: async () => (await ScribeLive.cast(live)).profile,

            /**
             * @return {Promise<void>}
             */
            suggest: () => ScribeLive.suggest(live),

            /**
             * @return {Promise<void>}
             */
            another: () => ScribeLive.suggest(live),

            /**
             * @return {void}
             */
            ignore: () => {
                ScribeLive.ignore(live);
            },

            /**
             * @param {string} words
             * @return {Promise<void>}
             */
            tell: (words) => ScribeLive.tell(live, words),

            /**
             * @return {Promise<void>}
             */
            confirm: () => ScribeLive.confirm(live),

            /**
             * @return {void}
             */
            forget: () => {
                ScribeLive.forget(live);
            },

            /**
             * @return {void}
             */
            close: () => {
                ScribeLive.close(live);
            },
        });
    },

    /**
     * @param {{ keeper: { view: Function, rule: Function, file: Function, preview: Function }, storage: { get: Function, set: Function, remove: Function, list: Function }, roomId: string, ask: Function, clock: { now: Function }, notify: Function, story: () => Promise<object>, profile: (plotId: string|null) => Promise<string|null> }} options
     * @return {Readonly<object>}
     */
    open(options) {
        const { keeper, storage, roomId, ask, clock, notify, story, profile } = options;
        const settings = ScribeLive.Settings;
        const live = {
            keeper,
            storage,
            roomId,
            ask,
            clock,
            notify,
            story,
            profile,
            calls: [],
            again: null,
            recounting: null,
            crowded: false,
            owed: false,
            cast: null,
            casting: null,
            record: null,
            problem: null,
            shown: null,
            loaded: false,
            closed: false,
            watching: false,
            epoch: settings.FirstEpoch,
            running: null,
            waiting: null,
            refreshing: false,
            appended: settings.NothingAppended,
            offer: null,
            excluded: [],
            understood: null,
            suggesting: false,
            forcing: false,
            telling: false,
            confirming: false,
            ruling: false,
            cans: { state: null, byKey: new Map() },
        };
        ScribeLive.load(live);
        live.watching = !keeper.view().reader;
        return ScribeLive.handle(live);
    },
});
