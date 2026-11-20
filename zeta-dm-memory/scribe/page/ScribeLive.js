const ScribeLive = Object.freeze({
    Status: Object.freeze({
        Open: 'Open',
        Dismissed: 'Dismissed',
        Accepted: 'Accepted',
        Told: 'Told',
        Reminded: 'Reminded',
    }),

    Stream: Object.freeze({ RateLimited: 'rateLimited', ChatAbused: 'chatAbused', Ok: 'ok' }),

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
        SettledKept: 50,
        CountedKept: 50,
        NoSerial: 0,
        IdPrefix: '#reminder-',
        AttemptPrefix: '#attempt-',
        PostPrefix: '#post-',
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
            StoppedByOperator: 'Stopped by the operator; cost unknown',
            Busy: 'The last request of this kind has not finished yet',
            NoBook: 'No book yet: adopt this chat first.',
            NotRead: 'The book has not finished its first reading.',
            EmptyEdit: 'Enter a reminder before queueing it.',
            LongEdit: 'A reminder may be at most 3,000 characters; nothing was saved.',
            BehindOpen: 'No reminder: the scene was last read at #',
            BehindMiddle: '; the latest reply is #',
            UnreadOpen: 'No reminder: the scene has not been read yet; the latest reply is #',
            FullStop: '.',
            SceneUnreadable: "the Scribe's answer about the scene could not be read",
            StoryEmpty: 'the answer held no story',
            StoryDeclined: 'the writer declined to produce a recap',
            Untold: 'The story recap is unavailable. See Progress for details.',
            EditStale: 'Your edit was written before the latest reply; Save it again to send it.',
            Crowded: 'No reminder: your message leaves no room for it.',
            SelectionCrowded: 'Your message left no room for the full reminder. It is still queued.',
            AttemptUnsaved: 'The send attempt could not be saved. Your message goes alone and the reminder stays queued.',
            UnauthorizedSend: 'Zeta rejected this send (HTTP 401). Wait for the reply to finish, then send again. If it persists, check your sign-in.',
            Unmarked: 'the scene was saved before replies were told apart by their text',
            ChangedOpen: 'No reminder: the latest reply #',
            ChangedClose: ' changed and is being read again.',
            StoryUnread: "The story's characters could not be read, so every character counts as custom: ",
            ProfileUnread: 'The chat profile could not be read, so it is left out of the calls: ',
            Budget: "The day's budget is spent: replies are not checked and no new reminder is made until tomorrow.",
            Awaiting:
                'Awaiting confirmation: your last message may have carried this reminder. You can wait for confirmation or choose to resend it.',
            LegacyAwaiting: 'The old save has no delivery receipt for this reminder. It will stay here until the chat confirms delivery or you choose to resend it.',
        }),
        NothingAppended: Object.freeze({
            ready: null,
            suggestion: null,
            ends: Object.freeze([]),
            reminder: null,
            attempt: null,
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
                    ...(ScribeLive.isText(entry.failureId) ? { failureId: entry.failureId } : {}),
                    ...(ScribeStore.localSource(entry.source) ? { source: entry.source } : {}),
                    tries: entry.tries,
                    at: entry.at,
                });
            }
        }
        return kept;
    },

    /**
     * @param {*} value
     * @return {{ id: string, attempt: string, sending: { text: string, after: { id: string, position: number }|null }|null }|null}
     */
    delivery(value) {
        const sending = ScribeLive.isObject(value) ? value.sending : null;
        const after = ScribeLive.isObject(sending) ? sending.after : null;
        const bounded =
            after === null || (ScribeLive.isObject(after) && ScribeLive.isText(after.id) && Number.isSafeInteger(after.position));
        const sound =
            ScribeLive.isObject(value) &&
            ScribeLive.isText(value.id) &&
            ScribeLive.isText(value.attempt) &&
            (sending === null || (ScribeLive.isObject(sending) && ScribeLive.isText(sending.text) && bounded));
        if (!sound) {
            return null;
        }
        return {
            id: value.id,
            attempt: value.attempt,
            evidence: ScribeLive.validPost(value.evidence) ? value.evidence : null,
            prior: (value.prior?.target === null || ScribeLive.isText(value.prior?.target)) && ScribeLive.isText(value.prior?.offer)
                ? { target: value.prior.target, offer: value.prior.offer, released: value.prior.released === true } : null,
            sending:
                sending === null
                    ? null
                    : {
                          text: sending.text,
                          after: after === null ? null : { id: after.id, position: after.position },
                      },
        };
    },

    /**
     * @param {*} post
     * @return {boolean}
     */
    validPost(post) {
        return (
            ScribeLive.isObject(post) &&
            ScribeLive.isText(post.key) &&
            Number.isSafeInteger(post.floor) &&
            post.floor >= ScribeLive.Settings.NoCount &&
            (post.after === null || ScribeLive.isText(post.after)) &&
            (post.submission == null || (typeof post.submission === 'string' && /^[0-9a-f]{8}$/.test(post.submission))) &&
            (post.trimmedSubmission === undefined || (post.manual === true && typeof post.trimmedSubmission === 'string' && /^[0-9a-f]{8}$/.test(post.trimmedSubmission))) &&
            typeof post.confirmed === ScribeLive.Settings.BooleanType &&
            [post.ready, post.carried, post.reminder, post.attempt, post.suggestion].every(
                (line) => line === null || ScribeLive.isText(line),
            )
        );
    },

    /**
     * @param {*} value
     * @return {Array<{ id: string, fingerprint: string }>}
     */
    tally(value) {
        const settings = ScribeLive.Settings;
        if (!Array.isArray(value)) {
            return [];
        }
        const kept = [];
        for (const entry of value) {
            if (ScribeLive.isObject(entry) && ScribeLive.isText(entry.id) && ScribeLive.isText(entry.fingerprint)) {
                kept.push({ id: entry.id, fingerprint: entry.fingerprint });
            }
        }
        return kept.slice(-settings.CountedKept);
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
     * @param {string} text
     * @return {string|null}
     */
    selectionError(text) {
        const content = text.replaceAll(ScribeIntake.Settings.OwnMarker, '').replaceAll('@:', '');
        if (ScribeSender.Settings.Blank.test(content)) {
            return ScribeLive.Settings.Messages.EmptyEdit;
        }
        return Array.from(text).length > ScribeLive.Settings.LongestEdit ? ScribeLive.Settings.Messages.LongEdit : null;
    },

    /**
     * @param {object} live
     * @param {string} text
     * @return {void}
     * @throws {Error}
     */
    select(live, text) {
        const error = ScribeLive.selectionError(text);
        if (error !== null) {
            throw new Error(error);
        }
        const record = live.record;
        if (record.selection?.text === text) {
            return;
        }
        const next = { ...record, delivery: null, forced: true, preparing: false };
        next.selection = { id: ScribeLive.mint(live, next).id, text };
        if (record.draft !== null && (record.draft === text || record.draftOwner === record.selection?.id ||
            (record.selection === null && ScribeLive.lines(live).ready === null))) {
            next.draftOwner = next.selection.id;
        }
        if (record.edited !== null) {
            next.editedOwner = next.selection.id;
        }
        ScribeLive.persistReminder(live, next);
        live.awaiting = false;
        live.attemptUnsaved = false;
        live.crowded = false;
        live.preparationFailure = null;
        ScribeLive.announce(live);
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
     * @param {object|null|undefined} saved
     * @return {void}
     */
    load(live, saved = undefined) {
        const settings = ScribeLive.Settings;
        live.record = {
            now: null,
            ready: null,
            led: [],
            basis: null,
            checkerStamp: null,
            edited: null,
            editedFor: null,
            draft: null,
            draftOwner: null,
            editedOwner: null,
            selection: null,
            previousPost: null,
            preparing: false,
            forced: false,
            intervalHeld: false,
            sends: settings.NoSends,
            serial: settings.NoSerial,
            delivery: null,
            settled: [],
            counted: [],
            posts: [],
            postSerial: settings.NoSerial,
            observed: settings.NoCount,
            observedSends: null,
            observedReminders: [],
            historyTail: [],
            receipts: [],
            attachments: [],
            unauthorizedSend: false,
            forbiddenSend: false,
            streamWarning: null,
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
        live.preparationFailure = null;
        live.awaiting = false;
        live.recovering.clear();
        if (saved === undefined) {
            try {
                saved = ScribeStore.read(live.storage, live.roomId, ScribeStore.Kind.Live);
            } catch (error) {
                live.problem = ScribeLive.words(error);
                live.loaded = ScribeLive.isObject(error) && error.damaged === true;
                return;
            }
        }
        live.loaded = true;
        if (!ScribeLive.isObject(saved)) {
            return;
        }
        const record = live.record;
        record.checkerStamp = ScribeLive.isText(saved.checkerStamp) ? saved.checkerStamp : null;
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
        record.draft = ScribeLive.isText(saved.draft) && ScribeLive.selectionError(saved.draft) === null
            ? saved.draft : (against ? null : record.edited);
        record.edited = against ? record.edited : null;
        record.forced = saved.forced === true;
        record.preparing = saved.preparing === true;
        live.owed ||= record.preparing;
        record.sends = Number.isSafeInteger(saved.sends) && saved.sends >= settings.NoSends ? saved.sends : settings.NoSends;
        record.serial =
            Number.isSafeInteger(saved.serial) && saved.serial >= settings.NoSerial ? saved.serial : settings.NoSerial;
        record.delivery = ScribeLive.delivery(saved.delivery);
        record.previousPost = ScribeLive.validPost(saved.previousPost) ? saved.previousPost : null;
        const selection = saved.selection;
        if (record.delivery && selection?.id === record.delivery.id &&
            ScribeLive.isText(selection.text) && ScribeLive.selectionError(selection.text) === null) {
            record.selection = { id: selection.id, text: selection.text };
            record.draftOwner = (saved.draftOwner === selection.id || record.draft === selection.text) ? selection.id : null;
            record.editedOwner = record.edited !== null ? selection.id : null;
        }
        record.settled = ScribeLive.isTexts(saved.settled) ? saved.settled.slice(-settings.SettledKept) : [];
        record.counted = ScribeLive.tally(saved.counted);
        record.posts = Array.isArray(saved.posts) ? saved.posts.filter(ScribeLive.validPost) : [];
        record.postSerial = Number.isSafeInteger(saved.postSerial) && saved.postSerial >= settings.NoSerial ? saved.postSerial : settings.NoSerial;
        record.observed = Number.isSafeInteger(saved.observed) && saved.observed >= settings.NoCount ? saved.observed : settings.NoCount;
        record.observedSends = Number.isSafeInteger(saved.observedSends) && saved.observedSends >= settings.NoSends ? saved.observedSends : null;
        const lastOffer = live.roomId + settings.IdPrefix + record.serial;
        const confirmedInHistory = record.settled.includes(lastOffer) && record.counted.length > 0 &&
            !record.posts.some((post) => post.reminder === lastOffer && post.confirmed);
        record.intervalHeld = typeof saved.intervalHeld === 'boolean' ? saved.intervalHeld :
            record.serial > settings.NoSerial && live.keeper.view().settings.refresh === settings.OneSend && !confirmedInHistory;
        record.observedReminders = ScribeLive.isTexts(saved.observedReminders) ? saved.observedReminders :
            record.settled.filter((id) => record.posts.some((post) => post.reminder === id) &&
                !record.posts.some((post) => post.reminder === id && post.confirmed && post.reset !== false));
        record.historyTail = Array.isArray(saved.historyTail) ? saved.historyTail.filter((entry) =>
            ScribeLive.isText(entry?.id) && [null, false, true].includes(entry.reset)) : [];
        record.receipts = ScribeLive.isTexts(saved.receipts) ? saved.receipts.slice(-settings.CountedKept) : [];
        record.attachments = Array.isArray(saved.attachments) ? saved.attachments.filter((entry) =>
            ScribeLive.isObject(entry) && ScribeLive.isText(entry.id) && ScribeLive.isText(entry.fingerprint) &&
            Number.isSafeInteger(entry.length) && entry.length >= 0) : [];
        record.unauthorizedSend = saved.unauthorizedSend === true;
        record.forbiddenSend = saved.forbiddenSend === true;
        if ([ScribeLive.Stream.RateLimited, ScribeLive.Stream.ChatAbused].includes(saved.streamWarning)) {
            record.streamWarning = saved.streamWarning;
        }
        if (record.delivery?.evidence && !record.posts.some((post) => post.key === record.delivery.evidence.key)) {
            record.posts.unshift(record.delivery.evidence);
            record.delivery.evidence = null;
        }
        const interrupted = record.delivery?.sending;
        if (interrupted) {
            record.posts.push({
                key: record.delivery.attempt,
                floor: interrupted.after?.position ?? settings.NoCount,
                after: interrupted.after?.id ?? null,
                ready: record.selection?.text ?? record.edited ?? record.ready ?? interrupted.text,
                carried: interrupted.text,
                reminder: record.delivery.id,
                attempt: record.delivery.attempt,
                suggestion: null,
                confirmed: false,
            });
            record.delivery.sending = null;
        }
        live.recovering = new Set(record.posts.filter((post) => !post.confirmed).map((post) => post.key));
        live.awaiting = ScribeLive.awaitingReceipt(live);
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
        for (const role of Object.values(settings.Retried)) {
            const failure = failing[role];
            if (ScribeLive.isText(failure) || (ScribeStore.localSource(failure?.source) && ScribeLive.isText(failure.reason))) {
                record.failing[role] = failure;
            }
        }
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
            record.untold = { key: untold.key, reason: untold.reason, tries: untold.tries, at: untold.at,
                ...(ScribeLive.isText(untold.failureId) ? { failureId: untold.failureId } : {}),
                ...(ScribeStore.localSource(untold.source) ? { source: untold.source } : {}),
            };
        }
        const rejectedCache = record.story !== null && ScribeReminder.declined(record.story.text);
        const opening = ScribeIntake.Settings.OwnMarker + settings.Space + ScribeReminder.Settings.StoryOpen;
        const rejectedOffer = record.ready?.startsWith(opening) && ScribeReminder.declined(record.ready.slice(opening.length));
        const rejectedKey = rejectedOffer ? record.basis.story : rejectedCache ? record.story.key : null;
        if (rejectedKey !== null) {
            if (rejectedOffer || record.basis?.story === rejectedKey) {
                record.ready = null;
                record.basis = null;
                record.led = [];
                record.reminded = null;
            }
            if (rejectedCache) {
                record.story = null;
            }
            record.untold = { key: rejectedKey, reason: settings.Messages.StoryDeclined,
                tries: settings.RetryMs.length, at: live.clock.now() };
        }
        const oldOffer = record.edited ?? record.ready;
        const oldTarget = (record.edited && record.editedFor?.id) || record.now?.message || record.seen?.id;
        if (record.delivery === null && oldOffer !== null) {
            ScribeLive.mint(live).prior = { target: oldTarget ?? null, offer: oldOffer, released: false };
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
            live.repairRulings = false;
        } catch (error) {
            live.problem = ScribeLive.words(error);
        }
    },

    /**
     * @param {object} live
     * @param {object} next
     * @return {void}
     * @throws {Error}
     */
    persistReminder(live, next) {
        ScribeStore.write(live.storage, live.roomId, ScribeStore.Kind.Live, next);
        Object.assign(live.record, next);
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
     * @param {string} field
     * @param {boolean|string|null} value
     * @return {void}
     */
    zetaWarning(live, field, value) {
        if (live.closed) {
            return;
        }
        if (live.loaded && !live.watching && live.keeper.view().reader) {
            const changed = live.record[field] !== value || Object.hasOwn(live.localWarnings, field);
            if (changed) {
                delete live.localWarnings[field];
                live.record[field] = value;
                ScribeLive.changed(live);
            }
        } else {
            const visible = Object.hasOwn(live.localWarnings, field) ? live.localWarnings[field] : live.record[field];
            if (visible !== value) {
                live.localWarnings[field] = value;
                ScribeLive.announce(live);
            }
        }
    },

    /**
     * @param {object} live
     * @param {object} view
     * @param {object[]} findings
     * @return {void}
     */
    applyRulings(live, view, findings) {
        const state = view.state;
        if (live.rulingState === state && live.rulingRows === live.record.findings &&
            findings.length === live.record.findings.length) {
            return;
        }
        const prints = new Map((view.messages ?? []).map((message) => [message.id, message.fingerprint]));
        for (const finding of findings) {
            if (!finding.fact || typeof finding.book !== 'string') {
                continue;
            }
            const current = ScribeLog.lookup(state.facts, finding.fact);
            if (current && !finding.support && current.cite && prints.has(current.cite) &&
                current.subject === finding.subject && current.category === finding.category &&
                ScribeCategory.same(current.text, finding.book)) {
                finding.support = { cite: current.cite, sourcePrint: prints.get(current.cite),
                    target: current.target, targetText: current.targetText };
                live.repairRulings = true;
            } else if (!current && finding.support && prints.get(finding.support.cite) === finding.support.sourcePrint) {
                const replacement = ScribeReplay.supportedFact(state.facts, { ...finding, ...finding.support });
                if (replacement) {
                    finding.fact = replacement.id;
                    finding.fault = ScribePedant.key(finding);
                    finding.key = ScribeLive.identity(finding.fault, finding.message);
                    live.repairRulings = true;
                }
            }
        }
        live.rulingState = state;
        live.rulingRows = live.record.findings;
        const decisions = ScribePedant.decisions(state, findings);
        for (const finding of findings) {
            const sequence = decisions.get(finding);
            if (sequence !== undefined && finding.ruling !== sequence) {
                finding.beforeRuling ??= finding.status === ScribeLive.Status.Told ? ScribeLive.Status.Open : finding.status;
                finding.ruling = sequence;
                finding.status = finding.kind === ScribePedant.Kind.Leak ? ScribeLive.Status.Told : ScribeLive.Status.Accepted;
                live.repairRulings = true;
            } else if (sequence === undefined && (finding.ruling !== undefined ||
                (state.decisionRead != null && finding.status === ScribeLive.Status.Told))) {
                finding.status = finding.beforeRuling ?? ScribeLive.Status.Open;
                delete finding.beforeRuling;
                delete finding.ruling;
                live.repairRulings = true;
            }
        }
    },

    /**
     * @param {object} live
     * @return {boolean}
     */
    refreshWatcher(live) {
        if (live.closed || live.keeper.view().reader) {
            return false;
        }
        try {
            const generation = ScribeStore.generation(live.storage, live.roomId, ScribeStore.Kind.Live);
            if (generation === live.watchedGeneration && generation !== null) {
                return false;
            }
            const saved = ScribeStore.read(live.storage, live.roomId, ScribeStore.Kind.Live);
            ScribeLive.load(live, saved);
            live.watchedGeneration = generation;
            return true;
        } catch (error) {
            const problem = ScribeLive.words(error);
            const changed = live.problem !== problem;
            live.problem = problem;
            return changed;
        }
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
            if (!live.watching) {
                live.watchedGeneration = undefined;
            }
            live.watching = true;
            return false;
        }
        if (live.watching || !live.loaded) {
            live.watching = false;
            live.watchedGeneration = undefined;
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
            if (record.selection === null) {
                record.delivery = null;
                if (record.edited !== null) {
                    ScribeLive.mint(live);
                }
            }
            record.posts = [];
            record.observed = ScribeLive.Settings.NoCount;
            record.observedSends = null;
            record.observedReminders = [];
            record.historyTail = [];
            live.recovering.clear();
            record.counted = [];
            record.receipts = [];
            record.unauthorizedSend = false;
            record.edition = view.edition;
            live.awaiting = false;
            live.issue++;
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
            ScribeLive.applyRulings(live, view, kept);
            if (kept.length !== record.findings.length || notes.length !== record.notes.length || live.repairRulings) {
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
        let moved = ScribeLive.reconcile(live, view);
        const stamp = ScribeLive.checkerStamp(view.state, view.messages);
        if (view.historyChecked !== false && record.checkerStamp !== stamp) {
            record.checkerStamp = stamp;
            if (record.selection !== null || record.edited !== null || record.ready !== null || live.recounting !== null) {
                record.draft = record.edited ?? record.draft ?? record.selection?.text ?? null;
                record.draftOwner = null;
                record.edited = null;
                record.editedOwner = null;
                record.editedFor = null;
                record.selection = null;
                record.ready = null;
                record.led = [];
                record.basis = null;
                record.preparing = ScribeLive.due(record, view);
                live.owed = record.preparing;
                live.issue++;
                live.preparationFailure = null;
                if (record.posts.some((post) => post.reminder === record.delivery?.id && !post.confirmed)) {
                    record.delivery = null;
                    live.awaiting = false;
                }
            }
            record.story = null;
            record.untold = null;
            moved = true;
        }
        if (record.edited !== null && !ScribeLive.written(record, view)) {
            record.draft = record.edited;
            record.draftOwner = record.editedOwner;
            record.edited = null;
            record.editedOwner = null;
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
     * @param {object} record
     * @return {{ id: string, attempt: string, sending: object|null }}
     */
    mint(live, record = live.record) {
        const settings = ScribeLive.Settings;
        if (record.delivery === null) {
            record.serial += settings.OneSend;
            record.delivery = {
                id: live.roomId + settings.IdPrefix + record.serial,
                attempt: live.roomId + settings.AttemptPrefix + record.serial,
                sending: null,
            };
        }
        return record.delivery;
    },

    /**
     * @param {readonly object[]} owned
     * @param {object} message
     * @param {string|null} carried
     * @return {boolean}
     */
    carries(owned, message, carried) {
        return message?.fromPlayer === true && carried !== null && owned.some((entry) =>
            entry.position === message.position && ScribeLive.isText(entry.text) &&
            ScribeLive.line(entry.text) === ScribeLive.line(carried),
        );
    },

    /**
     * @param {object} live
     * @param {string} offered
     * @param {string} carried
     * @param {string|null} id
     * @return {void}
     */
    delivered(live, offered, carried, id) {
        const settings = ScribeLive.Settings;
        const record = live.record;
        const state = live.keeper.view().state;
        const led = record.led;
        const said = new Set(ScribeText.words(carried));
        if (id !== null) {
            record.settled = [...record.settled, id].slice(-settings.SettledKept);
            if (id !== record.delivery?.id) {
                record.sends = settings.NoSends;
                return;
            }
        }
        const manual = record.selection !== null;
        if (record.ready !== null && record.untold?.reason === settings.Messages.StoryDeclined &&
            record.basis?.story !== record.untold.key) {
            record.untold = null;
        }
        const newer = record.edited !== offered && (!manual || record.editedOwner !== id) ? record.edited : null;
        if (manual ? record.draftOwner === id : record.draft === offered) {
            record.draft = null;
            record.draftOwner = null;
        }
        ScribeLive.skip(live, false);
        if (newer !== null && record.draft === null) {
            record.draft = newer;
        }
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
    },

    /**
     * @param {object} live
     * @param {Readonly<object>} view
     * @return {boolean}
     */
    reconcile(live, view) {
        const record = live.record;
        const listed = Array.isArray(view.messages) ? view.messages : [];
        const owned = view.own;
        if (!Array.isArray(owned) || listed.length === 0) {
            return false;
        }
        const settings = ScribeLive.Settings;
        let moved = Boolean(record.delivery?.prior) && view.historyChecked !== false && ScribeLive.inherited(live, listed, owned);
        if (record.observedSends === null) {
            if (record.observed === settings.NoCount) {
                record.observed = record.posts[0]?.floor ?? listed.at(settings.Last).position;
            }
            const provisional = record.posts.filter((post) => post.confirmed && !post.ready).length;
            record.observedSends = Math.max(settings.NoSends, record.sends - provisional);
            moved = true;
        }
        if (listed.at(settings.Last).position <= record.observed) {
            return moved;
        }
        const players = listed.slice(record.observed).filter((message) => message.fromPlayer);
        const matches = new Map();
        const reserved = new Set();
        const ambiguous = new Set();
        const tail = new Map(record.historyTail.map((entry) => [entry.id, entry]));
        const eligible = (post, message) => !reserved.has(post.key) && post.floor < message.position &&
            (post.after === null || listed[post.floor - 1]?.id === post.after);
        const sameSubmission = (post, message) => post.submission &&
            (post.submission === message.submission || post.submission === message.completeSubmission);
        const projection = (message, post) => {
            const wire = ScribeIntake.Submissions.get(message);
            return ScribeIntake.projection(ScribeIntake.playerRange(wire, post), wire);
        };
        for (const message of players) {
            if (tail.has(message.id) || record.counted.some((entry) => entry.id === message.id)) {
                continue;
            }
            const attachments = record.posts.filter((post) => {
                if (!eligible(post, message)) {
                    return false;
                }
                if (post.manual) {
                    return ScribeIntake.carried(message, post);
                }
                return (!post.submission || sameSubmission(post, message)) && ScribeLive.carries(owned, message, post.carried);
            });
            const authoritative = attachments.filter((post) => post.confirmed);
            const candidates = authoritative.length ? authoritative : attachments;
            const distinct = new Set(candidates.filter((post) => post.manual).map((post) => post.reminder)).size > 1;
            if ((!authoritative.length && distinct) || (message.interchangeable && authoritative.length < attachments.length && attachments.length > 1)) {
                ambiguous.add(message.id);
                continue;
            }
            if (authoritative.length > 1 && new Set(authoritative.filter((post) => post.manual)
                .map((post) => projection(message, post))).size > 1) {
                for (const candidate of authoritative) {
                    candidate.contested = true;
                }
            }
            const carried = authoritative[0] ??
                attachments.find((post) => post.retryAllowed !== true) ?? attachments[0];
            if (carried) {
                const length = carried.manual ? projection(message, carried) : null;
                const alternatives = carried.manual ? attachments.filter((post) => post.manual && post.key !== carried.key &&
                    projection(message, post) !== length).map((post) => post.key) : [];
                matches.set(message.id, { post: carried, carried: true, alternatives });
                reserved.add(carried.key);
            }
        }
        for (const message of players) {
            if (ambiguous.has(message.id) || tail.has(message.id) || matches.has(message.id) || record.counted.some((entry) => entry.id === message.id)) {
                continue;
            }
            const same = record.posts.filter((post) => !post.manual && eligible(post, message) && sameSubmission(post, message));
            const post = same.find((entry) => entry.carried === null) ?? same.find((entry) =>
                owned.some((block) => block.position === message.position && ScribeLive.isText(block.text) &&
                    ScribeLive.line(entry.carried).startsWith(ScribeLive.line(block.text))),
            );
            if (post) {
                matches.set(message.id, { post, carried: false });
                reserved.add(post.key);
            }
        }
        let contiguous = true;
        let sends = record.observedSends;
        const prefix = new Set(record.observedReminders);
        const deliveries = new Set(prefix);
        for (const message of players) {
            if (ambiguous.has(message.id)) {
                contiguous = false;
                sends = settings.NoSends;
                continue;
            }
            const prior = tail.get(message.id);
            if (prior) {
                if (prior.reset !== null) {
                    const reset = prior.reminder ? ScribeLive.firstDelivery(deliveries, prior.reminder) : prior.reset;
                    sends = reset ? settings.NoSends : sends + settings.OneSend;
                    if (contiguous && prior.reminder) {
                        prefix.add(prior.reminder);
                    }
                }
                if (contiguous) {
                    record.observed = message.position;
                    record.observedSends = sends;
                    tail.delete(message.id);
                    moved = true;
                }
                continue;
            }
            if (record.counted.some((entry) => entry.id === message.id)) {
                continue;
            }
            moved = true;
            const match = matches.get(message.id);
            const post = match?.post ?? record.posts.find((entry) => eligible(entry, message) &&
                entry.carried === null && (!entry.submission || (entry.confirmed && message.edited)));
            const reminder = !post?.ignored && match?.carried ? post.reminder : null;
            const reset = ScribeLive.firstDelivery(deliveries, reminder);
            if (post) {
                if (post.manual && match?.carried) {
                    ScribeLive.contestProjection(record, post);
                    const wire = ScribeIntake.Submissions.get(message);
                    const range = ScribeIntake.playerRange(wire, post);
                    record.attachments.push({ id: message.id, fingerprint: message.fingerprint,
                        length: range.start, ...(range.end < wire.length ? { end: range.end } : {}),
                        ...(match.alternatives.length ? { alternatives: match.alternatives } : {}),
                        ...(post.contested ? { contested: true } : {}) });
                    if (post.contested) {
                        live.keeper.attributionChanged?.();
                    }
                }
                if (!post.confirmed && !post.ignored) {
                    ScribeLive.accept(live, post, reminder !== null && !record.settled.includes(reminder));
                }
                const index = record.posts.indexOf(post);
                record.posts = record.posts.filter((entry, order) => {
                    if (match && order < index && !reserved.has(entry.key) && !entry.manual && entry.retryAllowed !== true &&
                        live.recovering.has(entry.key)) {
                        live.recovering.delete(entry.key);
                        return false;
                    }
                    return entry.key !== post.key;
                });
                live.recovering.delete(post.key);
            }
            if (!post?.ignored) {
                sends = reset ? settings.NoSends : sends + settings.OneSend;
                if (reset) {
                    record.intervalHeld = false;
                }
            }
            if (contiguous) {
                record.observed = message.position;
                record.observedSends = sends;
                if (reminder) {
                    prefix.add(reminder);
                }
            } else {
                tail.set(message.id, { id: message.id, reset: post?.ignored ? null : reset, ...(reminder ? { reminder } : {}) });
            }
            record.counted = [...record.counted, { id: message.id, fingerprint: message.fingerprint }].slice(-settings.CountedKept);
        }
        if (players.length > 0) {
            record.historyTail = [...tail.values()];
            const pending = new Set([...record.posts, ...record.historyTail].map((entry) => entry.reminder));
            record.observedReminders = [...prefix].filter((id) => pending.has(id));
            const previous = record.sends;
            record.sends = ScribeLive.pendingSends(record, sends, deliveries);
            live.awaiting = ScribeLive.awaitingReceipt(live);
            moved ||= previous !== record.sends;
        }
        return moved;
    },

    /**
     * @param {Set<string>} offers
     * @param {string|null} reminder
     * @return {boolean}
     */
    firstDelivery(offers, reminder) {
        if (!reminder || offers.has(reminder)) {
            return false;
        }
        offers.add(reminder);
        return true;
    },

    /**
     * @param {object} record
     * @param {number} sends
     * @param {Set<string>} deliveries
     * @return {number}
     */
    pendingSends(record, sends, deliveries = new Set(record.observedReminders)) {
        for (const post of record.posts) {
            if (post.confirmed && !post.ignored) {
                const delivered = ScribeLive.firstDelivery(deliveries, post.reminder);
                sends = delivered ? ScribeLive.Settings.NoSends : sends + ScribeLive.Settings.OneSend;
            }
        }
        return sends;
    },

    /**
     * @param {object} live
     * @param {readonly object[]} listed
     * @param {readonly object[]} owned
     * @return {boolean}
     */
    inherited(live, listed, owned) {
        const settings = ScribeLive.Settings;
        const record = live.record;
        const { target, offer } = record.delivery.prior;
        const at = listed.findIndex(
            /**
             * @param {{ id: string }} item
             * @return {boolean}
             */
            (item) => item.id === target,
        );
        if (at === settings.NotFound) {
            return false;
        }
        const next = listed[at + settings.OneSend];
        if (!ScribeLive.carries(owned, next, offer)) {
            return false;
        }
        record.delivery.prior = null;
        if (record.posts.some((post) => post.reminder === record.delivery.id &&
            post.floor < next.position && (post.submission === next.submission || post.submission === next.completeSubmission))) {
            return true;
        }
        ScribeLive.delivered(live, offer, offer, record.delivery.id);
        record.observedSends = settings.NoSends;
        record.observed = next.position;
        record.counted = [{ id: next.id, fingerprint: next.fingerprint }];
        return true;
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
                noted.source = 'Scribe';
                throw Object.assign(new Error(refused), { source: noted.source });
            }
            try {
                const answer = await live.ask(role, system, user);
                ScribeLive.stoppedCalls(live, role, answer);
                ScribeLive.called(live, role, answer, null);
                return answer;
            } catch (error) {
                const reason = ScribeLive.words(error);
                const status = error?.status;
                const hasStatus = Number.isSafeInteger(status) && status >= 100 && status <= 599;
                const described = /^(?:HTTP \d{3}\b|[^;]+; status (?:\d{3}|no response)\b)/.test(reason);
                const detail = hasStatus && !described
                    ? `unexpected HTTP status; status ${status}; finish ${error.finish ?? 'none'}; reason: ${reason}`
                    : reason;
                noted.failure = ScribeStore.diagnostic(live.storage, detail);
                noted.source = ScribeStore.errorSource(error);
                noted.keyChanged = error?.keyChanged;
                const answered =
                    ScribeLive.isObject(error) &&
                    Number.isSafeInteger(error.status) &&
                    error.status >= ScribeLive.Settings.FirstAnswered &&
                    error.status <= ScribeLive.Settings.LastAnswered;
                noted.retryable = ScribeLive.isObject(error) && error.retryable === true && !answered;
                ScribeLive.stoppedCalls(live, role, error);
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
     * @return {void}
     */
    stoppedCalls(live, role, source) {
        const settings = ScribeLive.Settings;
        const counted = ScribeLive.isObject(source) ? ScribeLive.count(source.stopped) : null;
        const stopped = counted === null ? settings.NoCount : counted;
        for (let stop = settings.NoCount; stop < stopped; stop++) {
            ScribeLive.called(live, role, null, settings.Messages.StoppedByOperator);
        }
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
                finish: ScribeLive.isText(given.finish) ? ScribeStore.diagnostic(live.storage, given.finish) : null,
                answer: ScribeLive.isText(given.answer) ? ScribeStore.diagnostic(live.storage, given.answer) : null,
                problem: ScribeStore.diagnostic(live.storage, problem),
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
            record.basis !== null &&
            (record.basis.story === record.story?.key ||
                (record.story === null && record.untold?.reason === ScribeLive.Settings.Messages.StoryDeclined &&
                    record.basis.story !== record.untold.key && record.basis.story === ScribeLive.storyKey(view, record.now))) &&
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
        return record.forced || record.sends + ScribeLive.Settings.OneSend >= keeperView.settings.refresh;
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
        if (!view.readerCurrent) {
            return { composed: null, basis, deferred: true };
        }
        const cast = await ScribeLive.cast(live);
        const latest = live.keeper.view();
        if (!latest.readerCurrent || latest.state.revision !== basis.revision || ScribeLive.behind(now, latest) !== null) {
            return { composed: null, basis, deferred: true };
        }
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
     * @param {Readonly<object>} view
     * @param {object|null} now
     * @param {string[]} corrections
     * @return {string}
     */
    storyKey(view, now, corrections = ScribeLive.storyCorrections(view, now), rulings = ScribeReminder.sharedRulings(view)) {
        const scene =
            now === null
                ? null
                : [now.day, ScribeText.normaliseName(now.place), now.reach, [...ScribeScene.identities(now)].sort()];
        const inputs = [ScribeReminder.storyInput(view.state, null, corrections, rulings), scene];
        const stamp = ScribeLive.checkerStamp(view.state, view.messages, rulings);
        if (stamp !== null) {
            inputs.push(stamp);
        }
        return ScribeText.fingerprint(JSON.stringify(inputs));
    },

    /**
     * @param {object} state
     * @return {string|null}
     */
    checkerStamp(state, messages, shared = null) {
        const decisions = (state?.checkerRulings ?? []).filter((row) => row.status !== 'superseded');
        if (!decisions.length) {
            return null;
        }
        const basis = decisions.map((row) => [row.finding, row.sequence, row.version, row.status]);
        if (decisions.some((row) => row.shareInReminder)) {
            basis.push(shared ?? ScribeReminder.sharedRulings({ state, messages }));
        }
        return ScribeText.fingerprint(JSON.stringify(basis));
    },

    /**
     * @param {object} view
     * @param {object|null} now
     * @return {string[]}
     */
    storyCorrections(view, now) {
        const state = view.state;
        const ruled = (state.checkerRulings ?? []).filter((row) => row.status === 'settled')
            .flatMap((row) => (row.factIds ?? []).map((id) => [id, row.sequence]));
        return ScribeReminder.storyCorrections(ruled.length
            ? { ...state, editOrigins: { ...state.editOrigins, ...Object.fromEntries(ruled) } } : state, now, view.player);
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
        const corrections = ScribeLive.storyCorrections(view, now);
        const rulings = ScribeReminder.sharedRulings(view);
        const stamp = ScribeLive.checkerStamp(view.state, view.messages, rulings);
        const key = ScribeLive.storyKey(view, now, corrections, rulings);
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
                const answer = await ask(ScribeReminder.StoryPrompt, ScribeReminder.storyInput(view.state, now, corrections, rulings));
                if (ScribeReminder.declined(answer.text)) {
                    noted.failure = settings.Messages.StoryDeclined;
                } else {
                    text = ScribeReminder.told(answer.text);
                }
            } catch (error) {
                noted.failure ??= ScribeStore.diagnostic(live.storage, ScribeLive.words(error));
            }
            const current = live.keeper.view();
            if (live.epoch !== epoch || ScribeLive.checkerStamp(current.state, current.messages) !== stamp) {
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
            const superseded = noted.keyChanged?.();
            record.untold = {
                key,
                failureId: crypto.randomUUID(),
                reason: superseded ? '' : noted.failure ?? settings.Messages.StoryEmpty,
                ...(ScribeStore.localSource(noted.source) ? { source: noted.source } : {}),
                tries: parked ? settings.RetryMs.length : tries,
                at: parked ? moment : moment + settings.RetryMs[tries],
            };
            if (superseded) {
                record.untold.tries = settings.FirstTry;
                record.untold.at = moment;
            }
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
     * @param {object} live
     * @param {{ composed: Readonly<{ text: string, led: readonly string[] }>|null, basis: { revision: number, first: string[], notes: string, story?: string } }|null} made
     * @param {number} issue
     * @return {void}
     */
    keep(live, made, issue) {
        const record = live.record;
        if (record.edited !== null || live.issue !== issue) {
            return;
        }
        if (made === null || made.composed === null) {
            record.ready = null;
            record.led = [];
            record.basis = null;
            return;
        }
        const next = record.preparing ? { ...record, preparing: false } : record;
        next.ready = made.composed.text;
        next.led = [...made.composed.led];
        next.basis = made.basis;
        next.reminded = record.now;
        if (next.untold?.reason === ScribeLive.Settings.Messages.StoryDeclined) {
            next.untold = null;
        }
        ScribeLive.mint(live, next);
        if (record.preparing) {
            try {
                ScribeLive.persistReminder(live, next);
                live.preparationFailure = null;
            } catch (error) {
                live.preparationFailure = ScribeLive.words(error);
                throw error;
            }
        }
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
        const issue = live.issue;
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
                    if (!sceneNoted.keyChanged) {
                        live.problem = ScribeLive.words(error);
                    }
                }
                if (!sceneNoted.keyChanged) {
                    ScribeLive.report(live, sceneNoted);
                }
                if (!ScribeLive.current(live, epoch)) {
                    return;
                }
                if (found === null) {
                    failed.scene = sceneNoted.failure ?? settings.Messages.SceneUnreadable;
                    failed.sceneSource = sceneNoted.source;
                    failed.sceneKeyChanged = sceneNoted.keyChanged;
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
                        detailsOnly: view.checksEnabled === true && view.checkedThrough >= message.position,
                        profile,
                    });
                    raised = reviewed.findings;
                    notes = reviewed.notes;
                } catch (error) {
                    if (!pedantNoted.keyChanged) {
                        live.problem = ScribeLive.words(error);
                    }
                    failed.check = pedantNoted.failure ?? ScribeStore.diagnostic(live.storage, ScribeLive.words(error));
                    failed.checkSource = pedantNoted.source;
                    failed.checkKeyChanged = pedantNoted.keyChanged;
                    failed.checkRetryable = pedantNoted.retryable;
                }
                if (!pedantNoted.keyChanged) {
                    ScribeLive.report(live, pedantNoted);
                }
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
            const writer = live.keeper.view();
            if (record.edited === null && ScribeLive.due(record, writer) && ScribeLive.behind(now, writer) === null) {
                const drafted =
                    notes === null
                        ? record.notes
                        : ScribeLive.noted(ScribeLive.standing(record.notes, writer), notes, message);
                made = await ScribeLive.remind(live, writer, now, draft, drafted);
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
        ScribeLive.applyRulings(live, latest, record.findings);
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
            latest.readerCurrent &&
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
            ScribeLive.keep(live, made, issue);
        } else if (
            ScribeLive.due(record, latest) &&
            record.ready === null &&
            record.edited === null &&
            (made?.deferred || made?.composed || (record.forced && made === null))
        ) {
            record.preparing = true;
            live.owed = true;
            live.refreshing = latest.readerCurrent;
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
            { role: kinds.Scene, asked: asking.scene, reason: failed.scene, retryable: failed.sceneRetryable, source: failed.sceneSource },
            { role: kinds.Check, asked: asking.check, reason: failed.check, retryable: failed.checkRetryable, source: failed.checkSource },
        ];
        const added = [];
        for (const { role, asked, reason, retryable, source } of roles) {
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
            const keyChanged = role === kinds.Scene ? failed.sceneKeyChanged : failed.checkKeyChanged;
            const superseded = keyChanged?.();
            if (superseded) {
                record.failing[role] = null;
                if (live.problem === reason) {
                    live.problem = null;
                }
            } else if (parked) {
                if (keyChanged) {
                    live.problem = reason;
                }
                record.failing[role] = ScribeStore.localSource(source) ? { source, reason } : reason;
            }
            record.retries = record.retries.filter(
                /**
                 * @param {{ id: string, fingerprint: string, role: string }} entry
                 * @return {boolean}
                 */
                (entry) => (role === kinds.Scene ? entry.role !== role : !mine(entry)),
            );
            added.push({
                failureId: crypto.randomUUID(),
                id: message.id,
                fingerprint: message.fingerprint,
                position: message.position,
                role,
                reason: superseded ? '' : reason,
                ...(ScribeStore.localSource(source) ? { source } : {}),
                tries: parked ? settings.RetryMs.length : tries,
                at: parked ? moment : moment + settings.RetryMs[tries],
            });
            if (superseded) {
                const replacement = added.at(-1);
                replacement.tries = settings.FirstTry;
                replacement.at = moment;
            }
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
                    record.failing[entry.role] = ScribeStore.localSource(entry.source) ? { source: entry.source, reason: entry.reason } : entry.reason;
                    continue;
                }
                record.retries.splice(spent, settings.Removed);
            }
            record.retries.unshift(entry);
        }
    },

    /**
     * @param {object} live
     * @param {(entry: object) => boolean} eligible
     * @return {void}
     */
    rekey(live, eligible = () => true) {
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
            (entry) => eligible(entry) && entry.tries >= spent,
        );
        const untold = record.untold !== null && eligible(record.untold) && record.untold.tries >= spent;
        if (!parked && !untold) {
            return;
        }
        const moment = live.clock.now();
        const reply = ScribeLive.answered(live.keeper.view());
        for (const role of Object.values(settings.Retried)) {
            if (!record.retries.some((entry) => entry.role === role && entry.tries >= spent && !eligible(entry))) {
                record.failing[role] = null;
            }
        }
        record.retries = record.retries.filter(
            /**
             * @param {{ id: string, fingerprint: string, role: string }} entry
             * @return {boolean}
             */
            (entry) =>
                !eligible(entry) || entry.role === settings.Retried.Scene ||
                (reply !== undefined && entry.id === reply.id && entry.fingerprint === reply.fingerprint),
        );
        for (const entry of record.retries) {
            if (eligible(entry)) {
                entry.tries = settings.FirstTry;
                entry.at = moment;
            }
        }
        if (record.untold !== null && eligible(record.untold)) {
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
        const refusal = ScribeLive.refusal(live);
        if (refusal !== null && !(refusal === ScribeLive.Settings.Messages.Budget && live.record.forced)) {
            live.owed ||= live.record.forced;
            return;
        }
        const view = live.keeper.view();
        const record = live.record;
        const waiting = record.ready === null ? record.now !== null : !ScribeLive.fresh(live, view);
        const stale = ScribeLive.behind(record.now, view) !== null;
        if (!view.readerCurrent || record.edited !== null || !ScribeLive.due(record, view) || !waiting || stale) {
            return;
        }
        live.owed = false;
        const epoch = live.epoch;
        const issue = live.issue;
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
        if (!latest.readerCurrent || made?.deferred || (made?.composed && made.basis.revision !== latest.state.revision)) {
            record.preparing = true;
            live.owed = true;
            live.refreshing = latest.readerCurrent && ScribeLive.behind(record.now, latest) === null;
        } else if (made === null || made.composed === null) {
            if (record.ready !== null && !ScribeLive.fresh(live, latest)) {
                ScribeLive.keep(live, null, issue);
            }
        } else if (
            ScribeLive.due(record, latest) && ScribeLive.behind(now, latest) === null &&
            ScribeLive.holds(
                made.basis,
                now,
                record.now,
                record.findings,
                ScribeLive.standing(record.notes, latest),
                latest.state,
            )
        ) {
            ScribeLive.keep(live, made, issue);
        }
        ScribeLive.changed(live);
    },

    /**
     * @param {object} live
     * @param {string|null} resendId
     * @param {string|null} selectedText
     * @return {Promise<void>}
     * @throws {Error}
     */
    async force(live, resendId = null, selectedText = null) {
        if (live.closed) {
            return;
        }
        const blocked = ScribeLive.forceBlock(live);
        if (blocked !== null) {
            throw new Error(blocked);
        }
        const record = live.record;
        const held = ScribeLive.unconfirmed(live);
        if (resendId !== null || held !== null) {
            if (held === null || resendId !== held.id) {
                return;
            }
            const delivery = { ...record.delivery };
            if (delivery.prior) {
                delivery.prior = { ...delivery.prior, released: true };
            }
            const posts = record.posts.map((post) => post.reminder === held.id && !post.confirmed ?
                { ...post, retryAllowed: true } : post);
            ScribeLive.persistReminder(live, { ...record, delivery, posts, forced: true, preparing: false,
                selection: { id: held.id, text: held.text } });
            live.awaiting = false;
            ScribeLive.announce(live);
            return;
        }
        if (selectedText !== null) {
            ScribeLive.select(live, selectedText);
            return;
        }
        const view = live.keeper.view();
        const preparing = record.selection === null && record.edited === null &&
            (ScribeLive.behind(record.now, view) !== null || !ScribeLive.fresh(live, view));
        ScribeLive.persistReminder(live, { ...record, forced: true, preparing });
        live.preparationFailure = null;
        ScribeLive.announce(live);
        if (live.running !== null || !preparing) {
            return;
        }
        const latest = ScribeLive.answered(view);
        if (ScribeLive.behind(record.now, view) !== null) {
            if (latest && (record.seen?.id !== latest.id || record.seen.fingerprint !== latest.fingerprint)) {
                live.waiting = latest;
            }
        } else if (record.now !== null && !ScribeLive.fresh(live, view)) {
            live.refreshing = true;
        }
        if (live.waiting !== null || live.refreshing) {
            await ScribeLive.kick(live);
            if (live.preparationFailure !== null) {
                throw new Error(live.preparationFailure);
            }
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
        if (live.running === null && (live.waiting !== null || live.again !== null || live.refreshing)) {
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
        const active = ScribeLive.active(live);
        const offer = ScribeLive.lines(live, true);
        const made = ScribeSender.compose(text, offer, settings.MessageBytes);
        if (active && made.text === live.submitted && live.appended.reminder === (made.ready ? offer.reminder : null) &&
            live.record.posts.some((post) => post.key === live.appended.key && !post.confirmed)) {
            return made.text;
        }
        if (active && live.appended.key) {
            ScribeLive.cancelled(live, live.appended);
        }
        live.submitted = made.text;
        live.crowded = made.crowded;
        live.appended = Object.freeze({
            key: active ? live.roomId + settings.PostPrefix + (++live.record.postSerial) : null,
            ...(made.previous || (made.ready && offer.manual) ? ScribeText.playerSubmission(made.playerText ?? text) : { submission: ScribeText.submission(made.text) }),
            ...(made.playerText !== undefined ? { retained: true } : {}),
            ...(made.previous ? { previous: true, previousSuggestion: made.previousSuggestion } : {}),
            ...(made.ready && offer.manual ? { manual: true } : {}),
            ready: made.ready ? offer.ready : null,
            suggestion: made.suggestion ? offer.suggestion : null,
            carried: made.carried,
            crowded: made.crowded,
            reminder: made.ready ? offer.reminder : null,
            attempt: made.ready ? offer.attempt : null,
        });
        if (active && !ScribeLive.starting(live, live.appended) && live.appended.reminder) {
            live.submitted = text;
            live.appended = Object.freeze({ ...live.appended, manual: false, ready: null, carried: null,
                suggestion: null, reminder: null, attempt: null, submission: ScribeText.submission(text) });
            ScribeLive.starting(live, live.appended);
            return text;
        }
        return made.text;
    },

    /**
     * @param {object} live
     * @param {object} lines
     * @return {boolean}
     */
    starting(live, lines) {
        if (!ScribeLive.active(live) || !ScribeLive.isText(lines.key)) {
            return false;
        }
        const record = live.record;
        let previous = null;
        if (lines.previous) {
            previous = ScribeLive.previousPost(record);
            if (!previous || lines.carried !== previous.carried || !lines.retained) {
                return false;
            }
        }
        if (record.receipts.includes(lines.key)) {
            return false;
        }
        const existing = record.posts.find((post) => post.key === lines.key);
        if (existing) {
            return !existing.confirmed && existing.reminder === lines.reminder && existing.attempt === lines.attempt &&
                existing.submission === (lines.submission ?? null) && existing.ready === lines.ready;
        }
        if (lines.manual && (!record.selection || record.selection.id !== lines.reminder || record.delivery?.attempt !== lines.attempt ||
            record.selection.text !== lines.ready || (!lines.retained && ScribeLive.unconfirmed(live) !== null))) {
            return false;
        }
        if (!lines.manual && lines.ready && lines.reminder) {
            const current = ScribeLive.lines(live, lines.retained === true);
            if (current.manual || current.reminder !== lines.reminder || current.attempt !== lines.attempt || current.ready !== lines.ready) {
                return false;
            }
        }
        const listed = live.keeper.view().messages;
        const newest = Array.isArray(listed) ? listed.at(ScribeLive.Settings.Last) : undefined;
        const post = {
            key: lines.key,
            submission: lines.submission ?? null,
            ...((previous || lines.manual) && lines.trimmedSubmission ? { trimmedSubmission: lines.trimmedSubmission } : {}),
            ...(previous || lines.manual ? { manual: true } : {}),
            ...(previous ? { previous: true } : {}),
            ...(lines.retained ? { retained: true } : {}),
            floor: newest?.position ?? record.observed,
            after: newest?.id ?? null,
            ready: previous?.ready ?? lines.ready,
            carried: lines.carried ?? lines.ready,
            suggestion: previous ? (lines.previousSuggestion ? previous.suggestion : null) : lines.suggestion,
            reminder: previous?.reminder ?? lines.reminder,
            attempt: previous?.attempt ?? lines.attempt,
            confirmed: false,
        };
        if (post.manual) {
            try {
                ScribeLive.persistReminder(live, { ...record, unauthorizedSend: false, posts: [...record.posts, post] });
                live.attemptUnsaved = false;
            } catch (error) {
                live.problem = ScribeLive.words(error);
                live.attemptUnsaved = true;
                ScribeLive.announce(live);
                return false;
            }
        } else {
            record.unauthorizedSend = false;
            record.posts.push(post);
            ScribeLive.save(live);
        }
        return true;
    },

    /**
     * @param {object} live
     * @param {object} lines
     * @param {number|null} status
     * @return {void}
     */
    cancelled(live, lines, status = null) {
        if (!ScribeLive.active(live) || !lines?.key) {
            return;
        }
        const record = live.record;
        const kept = record.posts.filter((post) => post.key !== lines.key || post.confirmed);
        if (kept.length !== record.posts.length) {
            const prior = record.posts.find((post) => post.key === lines.key);
            if (prior?.carried) {
                record.previousPost = prior;
            }
            record.unauthorizedSend = status === 401;
            record.posts = kept;
            live.recovering.delete(lines.key);
            live.awaiting = ScribeLive.awaitingReceipt(live);
            record.receipts = [...record.receipts, lines.key].slice(-ScribeLive.Settings.CountedKept);
            if (lines.manual) {
                live.keeper.attributionChanged?.();
            }
            ScribeLive.changed(live);
        }
        if (live.appended.key === lines.key) {
            live.appended = ScribeLive.Settings.NothingAppended;
        }
    },

    /**
     * @param {object} live
     * @return {boolean}
     */
    awaitingReceipt(live) {
        const record = live.record;
        return record.posts.some((post) => !post.confirmed && post.retryAllowed !== true && (post.uncertain || live.recovering.has(post.key)) &&
            post.reminder !== null && post.reminder === record.delivery?.id);
    },

    /**
     * @param {object} live
     * @param {object} lines
     * @return {void}
     */
    uncertain(live, lines) {
        if (!lines?.key || !ScribeLive.active(live)) {
            return;
        }
        const post = live.record.posts.find((entry) => entry.key === lines.key && !entry.confirmed);
        if (!post) {
            return;
        }
        if (live.appended.key === lines.key) {
            live.appended = ScribeLive.Settings.NothingAppended;
        }
        if (!post.uncertain) {
            post.uncertain = true;
            live.awaiting = ScribeLive.awaitingReceipt(live);
            ScribeLive.announce(live);
        }
    },

    /**
     * @param {object} live
     * @return {{ id: string, text: string, legacy: boolean }|null}
     */
    unconfirmed(live) {
        const { delivery, posts } = live.record;
        if (delivery?.prior && !delivery.prior.released) {
            return { id: delivery.id, text: delivery.prior.offer, legacy: true };
        }
        if (live.awaiting && delivery) {
            const post = posts.find((entry) => !entry.confirmed && entry.retryAllowed !== true && entry.reminder === delivery.id);
            if (post) {
                return { id: delivery.id, text: post.ready, legacy: false };
            }
        }
        return null;
    },

    /**
     * @param {object} live
     * @return {Readonly<{ ready: string|null, suggestion: string|null }>}
     */
    lines(live, composer = false) {
        const nothing = ScribeLive.Settings.NothingAppended;
        if (live.closed || !live.loaded || live.watching) {
            return nothing;
        }
        const view = live.keeper.view();
        const record = live.record;
        const renewed = record.edition !== null && view.edition > record.edition;
        if (!view.reader || view.trusted !== true || renewed || record.checkerStamp !== ScribeLive.checkerStamp(view.state, view.messages)) {
            return nothing;
        }
        const waiting = ScribeLive.due(record, view) && ScribeLive.fresh(live, view) ? record.ready : null;
        const current = view.readerCurrent && ScribeLive.behind(record.now, view) === null;
        const awaiting = ScribeLive.unconfirmed(live) !== null;
        const typed = !awaiting && record.edited !== null && ScribeLive.written(record, view);
        const prepared = current && !awaiting ? waiting : null;
        const selected = awaiting ? null : record.selection;
        const ready = selected?.text ?? (typed ? record.edited : prepared);
        const delivery = record.delivery;
        const named = ready !== null && delivery !== null;
        const previous = composer ? ScribeLive.previousPost(record) : null;
        if (composer && awaiting) {
            const prior = record.posts.findLast((post) => post.reminder === delivery?.id && !post.confirmed && post.carried);
            if (prior) {
                return Object.freeze({ ready: prior.ready, manual: prior.manual === true, suggestion: prior.suggestion,
                    ends: prior.carried !== prior.ready && !prior.manual ? [prior.carried.length] : [],
                    reminder: prior.reminder, attempt: prior.attempt, onlyExisting: true });
            }
        }
        return Object.freeze({
            ready,
            ...(previous ? { previous: previous.carried, previousSuggestion: previous.suggestion } : {}),
            ...(selected ? { manual: true } : {}),
            suggestion: record.suggestion,
            ends: Object.freeze(selected || typed || prepared === null ? [] : ScribeReminder.ends(prepared)),
            reminder: named ? delivery.id : null,
            attempt: named ? delivery.attempt : null,
        });
    },

    /**
     * @param {object} record
     * @return {object|null}
     */
    previousPost(record) {
        const previous = record.posts.findLast((post) => post.carried && post.reminder !== record.delivery?.id) ?? record.previousPost;
        return previous && previous.reminder !== record.delivery?.id ? previous : null;
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
        live.crowded = lines.crowded === true;
        if ((lines.key && record.receipts.includes(lines.key)) ||
            (lines.reminder && (!lines.reminder.startsWith(live.roomId + settings.IdPrefix) || (!lines.key && record.settled.includes(lines.reminder))))) {
            return;
        }
        const post = lines.key ? record.posts.find((entry) => entry.key === lines.key) : null;
        const previous = lines.previous && post?.previous && post.carried === lines.carried;
        if ((lines.key || lines.manual) && (!post || post.confirmed || (!previous && (post.reminder !== lines.reminder || post.attempt !== lines.attempt)))) {
            return;
        }
        if (post) {
            post.confirmed = true;
            if (post.manual) {
                ScribeLive.contestProjection(record, post);
                live.keeper.attributionChanged?.();
            }
            post.reset = post.reminder !== null && !record.settled.includes(post.reminder);
        }
        if (!post?.ignored) {
            ScribeLive.accept(live, post ?? lines, post ? post.reset : lines.ready !== null);
        }
        if (post && record.observedSends !== null && record.historyTail.length === 0) {
            record.sends = ScribeLive.pendingSends(record, record.observedSends);
        }
        if (!post && record.observedSends !== null && !record.posts.length) {
            record.observedSends = record.sends;
        }
        ScribeLive.changed(live);
    },

    /**
     * @param {object} record
     * @param {object} post
     * @return {void}
     */
    contestProjection(record, post) {
        for (const bound of record.attachments) {
            if (Array.isArray(bound.alternatives) && bound.alternatives.includes(post.key)) {
                bound.contested = true;
                post.contested = true;
            }
        }
    },

    /**
     * @param {object} live
     * @param {object} lines
     * @param {boolean} carried
     * @return {void}
     */
    accept(live, lines, carried) {
        const settings = ScribeLive.Settings;
        const record = live.record;
        const named = ScribeLive.isText(lines.reminder);
        const delivery = record.delivery;
        const current = named && delivery !== null && delivery.id === lines.reminder && delivery.attempt === lines.attempt;
        const matches = named ? current : lines.ready !== null && lines.ready === (record.edited ?? record.ready);
        if (carried && (matches || (lines.key && named && !record.settled.includes(lines.reminder)))) {
            ScribeLive.delivered(live, lines.ready, lines.carried ?? lines.ready, named ? lines.reminder : null);
        } else if (carried && !named && !lines.key) {
            record.forced = false;
            record.sends = settings.NoSends;
        } else {
            record.sends += settings.OneSend;
            const view = live.keeper.view();
            if (record.ready !== null && record.edited === null && record.selection === null &&
                view.state?.editedSince !== undefined && record.basis?.revision >= view.state.editedSince &&
                !ScribeLive.fresh(live, view) && ScribeLive.due(record, view)) {
                live.refreshing = true;
            }
        }
        if (record.suggestion === lines.suggestion && (carried || lines.ready === null)) {
            record.suggestion = null;
        }
        if (lines.key) {
            record.receipts = [...record.receipts, lines.key].slice(-settings.CountedKept);
        }
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
        const state = live.keeper.view().state;
        const ruling = ScribePedant.told(state, finding);
        if (ruling === null) {
            return;
        }
        live.ruling = true;
        try {
            await live.keeper.rule(ruling, [finding]);
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
        if (ruled === undefined || live.keeper.view().state !== state || ruled.fingerprint !== finding.fingerprint) {
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
        ScribeLive.skip(live);
        record.draft = null;
        record.suggestion = null;
        ScribeLive.changed(live);
    },

    /**
     * @param {object} live
     * @param {boolean} resetHistory
     * @return {void}
     */
    skip(live, resetHistory = true) {
        const record = live.record;
        record.unauthorizedSend = false;
        if (resetHistory && record.observedSends !== null) {
            record.observedSends = ScribeLive.Settings.NoSends;
            for (const post of record.posts) {
                post.ignored = true;
            }
        }
        record.ready = null;
        record.led = [];
        record.basis = null;
        record.edited = null;
        record.editedFor = null;
        record.editedOwner = null;
        record.selection = null;
        record.preparing = false;
        live.owed = false;
        live.preparationFailure = null;
        record.forced = false;
        record.sends = ScribeLive.Settings.NoSends;
        record.intervalHeld = live.keeper.view().settings.refresh === ScribeLive.Settings.OneSend;
        record.delivery = null;
        live.awaiting = false;
        live.issue++;
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
     * @param {string|null} selectionId
     * @return {void}
     * @throws {Error}
     */
    edit(live, text, shown, against, selectionId = null) {
        const settings = ScribeLive.Settings;
        if (!ScribeLive.active(live)) {
            return;
        }
        const record = live.record;
        if (record.selection !== null || (selectionId !== null && record.settled.includes(selectionId))) {
            const blocked = ScribeLive.forceBlock(live);
            if (blocked !== null) {
                throw new Error(blocked);
            }
            ScribeLive.select(live, text);
            return;
        }
        const line = ScribeLive.line(text);
        if (ScribeLive.hollow(line)) {
            if (shown ?? ScribeLive.lines(live).ready !== null) {
                ScribeLive.skip(live);
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
        if (same) {
            ScribeLive.mint(live);
        }
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
        if (noted.keyChanged?.()) {
            return ScribeLive.suggest(live);
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
     * @param {readonly object[]|null} origins
     * @return {Promise<void>}
     * @throws {Error}
     */
    async tell(live, words, origins = null) {
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
            const resolution = live.record.findings.filter((finding) =>
                [ScribeLive.Status.Open, ScribeLive.Status.Reminded].includes(finding.status) &&
                (origins === null || origins.some((issue) => issue.key === finding.key &&
                    issue.fingerprint === finding.fingerprint)));
            let noted;
            let result;
            do {
                noted = { failure: null };
                result = await ScribeMuse.tell({
                    state: view.state,
                    player: view.player,
                    words,
                    anchor,
                    ask: ScribeLive.asker(live, settings.Roles.Analyzer, noted),
                });
                if (!ScribeLive.current(live, epoch) || !ScribeLive.trusted(live)) {
                    return;
                }
            } while (noted.keyChanged?.());
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
                resolution,
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
                await live.keeper.file(understood.operations, understood.anchor, understood.resolution);
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
        if (!live.keeper.view().reader) {
            ScribeLive.refreshWatcher(live);
        }
        const preparationBlock = ScribeLive.refusal(live);
        const reading = preparationBlock === null;
        const record = live.record;
        const understood = live.understood;
        const keeperView = live.keeper.view();
        if (!keeperView.reader && keeperView.booked && keeperView.state && record.edition === keeperView.edition) {
            ScribeLive.applyRulings(live, keeperView, record.findings);
        }
        if (reading) {
            const due = ScribeLive.due(record, keeperView);
            const seen = record.seen;
            const last = keeperView.messages?.at(settings.Last);
            const catchUp = due && last?.fromPlayer && (seen !== null || ScribeLive.behind(record.now, keeperView) !== null);
            const newest = catchUp ? ScribeLive.answered(keeperView) : last;
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
            const newStory = due && untold?.reason === settings.Messages.StoryDeclined && record.ready === null &&
                record.edited === null && record.selection === null && record.now !== null &&
                (record.story?.key === untold.key || ScribeLive.storyKey(keeperView, record.now) !== untold.key);
            const intervalReached = (newStory || untold === null) && (record.sends > settings.NoSends || !record.intervalHeld || record.forced);
            const afterEdit = keeperView.state.editedSince !== undefined && record.basis !== null &&
                record.basis.revision >= keeperView.state.editedSince && record.basis.revision < keeperView.state.revision;
            const owed = (live.owed || intervalReached) && record.ready === null && live.running === null &&
                record.selection === null && record.now !== null && ScribeLive.behind(record.now, keeperView) === null;
            live.refreshing =
                live.refreshing ||
                (keeperView.readerCurrent && live.preparationFailure === null && record.edited === null &&
                    due &&
                    ((record.ready !== null && !afterEdit && !ScribeLive.fresh(live, keeperView)) ||
                        retold || owed));
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
        const include = (role, detail, retrying, source) => {
            const reason = ScribeStore.diagnostic(live.storage, detail);
            const known = failing.find((item) => item.role === role && item.reason === reason && item.source === source);
            if (known) {
                known.retrying ||= retrying;
            } else {
                failing.push({ role, reason, retrying, ...(ScribeStore.localSource(source) ? { source } : {}) });
            }
        };
        for (const role of Object.values(settings.Retried)) {
            const failure = record.failing[role];
            if (failure !== null) {
                include(role, failure.reason ?? failure, false, failure.source);
            }
            for (const retry of record.retries) {
                if (retry.role === role && retry.tries < settings.RetryMs.length && retry.reason && retry.reason !== messages.Unmarked) {
                    include(role, retry.reason, true, retry.source);
                }
            }
        }
        const unconfirmed = ScribeLive.unconfirmed(live);
        const awaiting = unconfirmed !== null;
        const typed = !awaiting && record.edited !== null && ScribeLive.written(record, keeperView);
        const declined = record.untold?.reason === messages.StoryDeclined;
        const pending = declined && record.selection === null && !typed && ScribeLive.due(record, keeperView) &&
            (record.forced || !record.intervalHeld || record.sends > settings.NoSends) &&
            (record.ready === null || (keeperView.state && !ScribeLive.fresh(live, keeperView)));
        if (record.untold?.reason && (!declined || pending)) {
            include('recap', record.untold.reason, record.untold.tries < settings.RetryMs.length, record.untold.source);
        }
        const untold = record.untold !== null && !declined && record.ready === null ? messages.Untold : null;
        const draft = typed || record.selection !== null ? null : (record.draft ?? record.edited);
        let held = null;
        if (awaiting) {
            held = unconfirmed.legacy ? messages.LegacyAwaiting : messages.Awaiting;
        } else if (draft !== null) {
            held = messages.EditStale;
        } else if (!typed && record.selection === null) {
            held = ScribeLive.behind(record.now, keeperView) ?? untold ?? (live.crowded ? messages.Crowded : null);
        } else if (live.crowded) {
            held = record.selection ? messages.SelectionCrowded : messages.Crowded;
        }
        if (record.unauthorizedSend && !awaiting) {
            held = messages.UnauthorizedSend;
        }
        if (record.selection && live.attemptUnsaved) {
            held = messages.AttemptUnsaved;
        }
        const latest = ScribeLive.answered(keeperView);
        const offer = ScribeLive.lines(live);
        return Object.freeze({
            now: record.now,
            ready: offer.ready,
            offerId: offer.reminder ?? null,
            settledOffers: Object.freeze([...record.settled]),
            selected: record.selection?.text ?? null,
            selectionId: record.selection?.id ?? null,
            lastDelivery: record.settled.at(settings.Last) ?? null,
            draft,
            stale: draft !== null,
            latest: latest === undefined ? null : Object.freeze({ id: latest.id, fingerprint: latest.fingerprint }),
            held,
            forbiddenSend: live.localWarnings.forbiddenSend ?? record.forbiddenSend,
            streamWarning: Object.hasOwn(live.localWarnings, 'streamWarning') ? live.localWarnings.streamWarning : record.streamWarning,
            preparationBlock: live.preparationFailure ?? preparationBlock,
            failing: Object.freeze(failing.map(Object.freeze)),
            calls: Object.freeze([...live.calls]),
            due: ScribeLive.due(record, keeperView),
            edited: typed,
            prepared: record.ready !== null,
            forced: record.forced,
            awaiting,
            unconfirmed,
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
            problem: ScribeStore.diagnostic(live.storage, live.problem),
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
             * @return {boolean}
             */
            refreshWatcher: () => ScribeLive.refreshWatcher(live),

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
             * @return {Readonly<object>}
             */
            posting: () => live.appended,

            /**
             * @param {string} key
             * @return {object|null}
             */
            outstanding: (key) => {
                if (!live.loaded || live.closed || live.watching) {
                    return null;
                }
                return live.record.posts.find((post) => post.key === key && post.uncertain && !post.confirmed) ?? null;
            },

            /**
             * @param {object} lines
             * @return {boolean}
             */
            starting: (lines) => ScribeLive.starting(live, lines),

            /**
             * @param {object} [lines]
             * @return {void}
             */
            cancelled: (lines = live.appended) => ScribeLive.cancelled(live, lines),

            /**
             * @param {object} [lines]
             * @param {number} [status]
             * @return {void}
             */
            rejected: (lines = live.appended, status = 401) => ScribeLive.cancelled(live, lines, status),

            /** @return {void} */
            sendForbidden: () => ScribeLive.zetaWarning(live, 'forbiddenSend', true),

            /** @return {void} */
            sendAllowed: () => ScribeLive.zetaWarning(live, 'forbiddenSend', false),

            /**
             * @param {string} messageId
             * @param {string} outcome
             * @return {void}
             */
            streamResult: (messageId, outcome) => {
                if (ScribeLive.isText(messageId) && messageId.length && Object.values(ScribeLive.Stream).includes(outcome)) {
                    ScribeLive.zetaWarning(live, 'streamWarning', outcome === ScribeLive.Stream.Ok ? null : outcome);
                }
            },

            /**
             * @param {object} [lines]
             * @return {void}
             */
            uncertain: (lines = live.appended) => ScribeLive.uncertain(live, lines),

            /**
             * @return {void}
             */
            sent: () => {
                ScribeLive.sent(live);
            },

            /**
             * @return {Readonly<{ ready: string|null, suggestion: string|null }>}
             */
            lines: (composer = false) => ScribeLive.lines(live, composer),

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
            edit: (text, shown = null, against = undefined, selectionId = null) => {
                ScribeLive.edit(live, text, shown, against, selectionId);
            },

            /**
             * @param {string|null} resendId
             * @param {string|null} selectedText
             * @return {Promise<void>}
             */
            force: (resendId = null, selectedText = null) => ScribeLive.force(live, resendId, selectedText),

            /**
             * @return {(entry: object) => boolean}
             */
            keyWork: () => {
                const record = live.record;
                const entries = new Set(record.retries);
                if (record.untold) {
                    entries.add(record.untold);
                }
                const identity = (entry) => JSON.stringify([entry.failureId, entry.role, entry.id, entry.fingerprint, entry.key,
                    entry.position, entry.tries, entry.at, entry.source, entry.reason]);
                const saved = new Set(Array.from(entries, identity));
                return (entry) => live.record === record ? entries.has(entry) : saved.has(identity(entry));
            },

            /**
             * @param {(entry: object) => boolean} [work]
             * @return {void}
             */
            rekey: (work) => {
                ScribeLive.rekey(live, work);
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
             * @param {readonly object[]|null} origins
             * @return {Promise<void>}
             */
            tell: (words, origins = null) => ScribeLive.tell(live, words, origins),

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
            attemptUnsaved: false,
            localWarnings: {},
            owed: false,
            awaiting: false,
            recovering: new Set(),
            issue: settings.FirstEpoch,
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
