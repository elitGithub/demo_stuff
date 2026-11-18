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
        AnswersKept: 16,
        FirstMost: 5,
        FirstFinding: 0,
        FirstEpoch: 0,
        FirstDay: 1,
        NoSends: 0,
        OneSend: 1,
        NoCount: 0,
        Last: -1,
        Nothing: '',
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
            Budget: "The day's budget is spent: replies are not checked and no new reminder is made until tomorrow.",
        }),
        NothingAppended: Object.freeze({
            ready: null,
            suggestion: null,
        }),
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
     * @param {readonly object[]} findings
     * @param {string[]} dismissed
     * @param {readonly object[]|null} raised
     * @param {object} message
     * @param {boolean} remembered
     * @return {{ findings: object[], contradicted: boolean }}
     */
    merged(findings, dismissed, raised, message, remembered) {
        const settings = ScribeLive.Settings;
        const statuses = ScribeLive.Status;
        if (raised === null) {
            return { findings: [...findings], contradicted: false };
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
        let contradicted = false;
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
                contradicted = contradicted || (!known && finding.kind === ScribePedant.Kind.Contradiction);
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
        return {
            findings: all.filter(
                /**
                 * @param {object} finding
                 * @return {boolean}
                 */
                (finding) => youngest.includes(finding),
            ),
            contradicted,
        };
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
            sends: settings.NoSends,
            findings: [],
            dismissed: [],
            suggestion: null,
            seen: null,
            reminded: null,
            edition: null,
            checked: [],
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
        record.ready = ScribeLive.isText(saved.ready) ? saved.ready : null;
        record.led = record.ready !== null && ScribeLive.isTexts(saved.led) ? [...saved.led] : [];
        const basis = saved.basis;
        const sound =
            ScribeLive.isObject(basis) && Number.isSafeInteger(basis.revision) && ScribeLive.isTexts(basis.first);
        record.basis = sound ? { revision: basis.revision, first: [...basis.first] } : null;
        record.sends = Number.isSafeInteger(saved.sends) && saved.sends >= settings.NoSends ? saved.sends : settings.NoSends;
        record.findings = ScribeLive.findings(saved.findings);
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
        if (Array.isArray(saved.checked)) {
            for (const entry of saved.checked.slice(settings.FirstFinding, settings.CheckedKept)) {
                const usable =
                    ScribeLive.isObject(entry) &&
                    ScribeLive.isText(entry.id) &&
                    ScribeLive.isText(entry.fingerprint) &&
                    Number.isSafeInteger(entry.revision) &&
                    ScribeLive.scene(entry.now) !== null &&
                    Array.isArray(entry.findings) &&
                    ScribeLive.findings(entry.findings).length === entry.findings.length;
                if (usable) {
                    record.checked.push({
                        id: entry.id,
                        fingerprint: entry.fingerprint,
                        revision: entry.revision,
                        now: entry.now,
                        findings: ScribeLive.findings(entry.findings),
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
            record.edition = view.edition;
            live.offer = null;
            live.excluded = [];
            live.understood = null;
            live.appended = ScribeLive.Settings.NothingAppended;
            live.answers = [];
            ScribeLive.changed(live);
        }
        try {
            const kept = ScribeLive.pruned(record.findings, view.messages);
            if (kept.length !== record.findings.length) {
                record.findings = kept;
                ScribeLive.save(live);
            }
        } catch (error) {
            live.problem = ScribeLive.words(error);
        }
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
     * @param {{ failure: string|null }} noted
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
                return await live.ask(role, system, user);
            } catch (error) {
                noted.failure = ScribeLive.words(error);
                throw error;
            }
        };
        return ask;
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
     * @param {{ revision: number, first: string[] }|null} basis
     * @param {object|null} reminded
     * @param {object|null} now
     * @param {readonly object[]} findings
     * @param {object} state
     * @return {boolean}
     */
    holds(basis, reminded, now, findings, state) {
        if (basis === null || state.revision !== basis.revision || !ScribeScene.same(reminded, now)) {
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
            ScribeLive.holds(record.basis, record.reminded, record.now, record.findings, view.state)
        );
    },

    /**
     * @param {object} live
     * @param {Readonly<object>} view
     * @param {object|null} now
     * @param {readonly object[]} findings
     * @param {{ failure: string|null }} noted
     * @return {Promise<{ composed: Readonly<{ text: string, led: readonly string[] }>|null, basis: { revision: number, first: string[] } }>}
     */
    async remind(live, view, now, findings, noted) {
        const settings = ScribeLive.Settings;
        const first = ScribeLive.first(findings, view.state);
        const basis = { revision: view.state.revision, first };
        const asked = ScribeLive.asker(live, settings.Roles.Scribe, noted);
        /**
         * @param {string} system
         * @param {string} user
         * @return {Promise<{ text: string, cost: * }>}
         * @throws {Error}
         */
        const ask = async (system, user) => {
            const request = JSON.stringify([system, user]);
            const known = live.answers.find(
                /**
                 * @param {{ request: string }} entry
                 * @return {boolean}
                 */
                (entry) => entry.request === request,
            );
            if (known !== undefined) {
                return known.answer;
            }
            const answer = await asked(system, user);
            live.answers = [
                ...live.answers.filter(
                    /**
                     * @param {{ request: string }} entry
                     * @return {boolean}
                     */
                    (entry) => entry.request !== request,
                ),
                { request, answer },
            ].slice(-settings.AnswersKept);
            return answer;
        };
        const composed = await ScribeReminder.compose({
            state: view.state,
            now,
            player: view.player,
            recent: view.messages.slice(-settings.Recent),
            unread: view.unread,
            ask,
            first: [...first],
        });
        return { composed, basis };
    },

    /**
     * @param {object} record
     * @param {{ composed: Readonly<{ text: string, led: readonly string[] }>|null, basis: { revision: number, first: string[] } }|null} made
     * @return {void}
     */
    keep(record, made) {
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
     * @return {Promise<void>}
     */
    async consider(live, message) {
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
        if (seen !== null && seen.id === message.id && seen.fingerprint === message.fingerprint) {
            return;
        }
        const epoch = live.epoch;
        const earlier = live.problem;
        live.problem = null;
        const replaced = seen !== null && seen.position === message.position;
        const previous = replaced ? seen.before : record.now;
        const remembered = record.checked.find(
            /**
             * @param {{ id: string, fingerprint: string, revision: number }} entry
             * @return {boolean}
             */
            (entry) => entry.id === message.id && entry.fingerprint === message.fingerprint && entry.revision === revision,
        );
        record.seen = {
            id: message.id,
            fingerprint: message.fingerprint,
            position: message.position,
            before: previous,
        };
        let found = null;
        let raised = null;
        if (remembered === undefined) {
            const sceneNoted = { failure: null };
            try {
                found = await ScribeScene.now({
                    state: view.state,
                    player: view.player,
                    messages: view.messages,
                    previous,
                    ask: ScribeLive.asker(live, roles.Scribe, sceneNoted),
                });
            } catch (error) {
                live.problem = ScribeLive.words(error);
            }
            ScribeLive.report(live, sceneNoted);
            if (!ScribeLive.current(live, epoch)) {
                return;
            }
            const pedantNoted = { failure: null };
            try {
                raised = await ScribePedant.review({
                    state: view.state,
                    player: view.player,
                    message,
                    unread: view.unread,
                    messages: view.messages,
                    ask: ScribeLive.asker(live, roles.Pedant, pedantNoted),
                });
            } catch (error) {
                live.problem = ScribeLive.words(error);
            }
            ScribeLive.report(live, pedantNoted);
            if (!ScribeLive.current(live, epoch)) {
                return;
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
        }
        const now = found === null ? previous : found;
        const draft = ScribeLive.merged(
            ScribeLive.pruned(record.findings, view.messages),
            record.dismissed,
            raised,
            message,
            remembered !== undefined,
        );
        let made = null;
        const remindNoted = { failure: null };
        try {
            const due =
                (found !== null && found.changed) ||
                draft.contradicted ||
                record.sends >= view.settings.refresh ||
                !ScribeScene.same(record.reminded, now) ||
                (record.ready !== null &&
                    !ScribeLive.holds(record.basis, record.reminded, now, draft.findings, view.state));
            if (due) {
                made = await ScribeLive.remind(live, view, now, draft.findings, remindNoted);
            }
        } catch (error) {
            live.problem = ScribeLive.words(error);
        }
        ScribeLive.report(live, remindNoted);
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
        record.now = now;
        record.findings = ScribeLive.merged(
            ScribeLive.pruned(record.findings, latest.messages),
            record.dismissed,
            raised,
            message,
            remembered !== undefined,
        ).findings;
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
            ScribeLive.holds(made.basis, now, record.now, record.findings, latest.state);
        if (ready) {
            ScribeLive.keep(record, made);
        }
        ScribeLive.changed(live);
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
        if (record.ready === null || ScribeLive.fresh(live, view)) {
            return;
        }
        const epoch = live.epoch;
        const now = record.now;
        const noted = { failure: null };
        let made = null;
        try {
            made = await ScribeLive.remind(live, view, now, record.findings, noted);
        } catch (error) {
            live.problem = ScribeLive.words(error);
        }
        if (!ScribeLive.current(live, epoch) || !ScribeLive.trusted(live)) {
            return;
        }
        ScribeLive.report(live, noted);
        const latest = live.keeper.view();
        if (made === null || made.composed === null) {
            if (record.ready !== null && !ScribeLive.fresh(live, latest)) {
                ScribeLive.keep(record, null);
            }
        } else if (ScribeLive.holds(made.basis, now, record.now, record.findings, latest.state)) {
            ScribeLive.keep(record, made);
        }
        ScribeLive.changed(live);
    },

    /**
     * @param {object} live
     * @return {Promise<void>}
     */
    async drain(live) {
        while (!live.closed && (live.waiting !== null || live.refreshing)) {
            if (live.waiting !== null) {
                const next = live.waiting;
                live.waiting = null;
                try {
                    await ScribeLive.consider(live, next);
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
        live.appended = Object.freeze({
            ready: made.ready ? offer.ready : null,
            suggestion: made.suggestion ? offer.suggestion : null,
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
        return Object.freeze({
            ready: ScribeLive.fresh(live, view) ? record.ready : null,
            suggestion: record.suggestion,
        });
    },

    /**
     * @param {object} live
     * @param {{ ready: string|null, suggestion: string|null }} lines
     * @return {void}
     */
    went(live, lines) {
        const settings = ScribeLive.Settings;
        if (!ScribeLive.active(live)) {
            return;
        }
        const record = live.record;
        const state = live.keeper.view().state;
        if (lines.ready !== null && record.ready === lines.ready) {
            const led = record.led;
            record.ready = null;
            record.led = [];
            record.basis = null;
            for (const finding of record.findings) {
                const reminded =
                    finding.kind === ScribePedant.Kind.Contradiction &&
                    finding.status === ScribeLive.Status.Open &&
                    led.includes(finding.fact) &&
                    !ScribePedant.spent(state, finding);
                if (reminded) {
                    finding.status = ScribeLive.Status.Reminded;
                }
            }
        }
        if (record.suggestion === lines.suggestion) {
            record.suggestion = null;
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
        record.ready = null;
        record.led = [];
        record.basis = null;
        record.suggestion = null;
        ScribeLive.changed(live);
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
            live.refreshing = live.refreshing || (record.ready !== null && !ScribeLive.fresh(live, keeperView));
            if (live.waiting !== null || live.refreshing) {
                Promise.resolve().then(
                    /**
                     * @return {Promise<void>}
                     */
                    () => ScribeLive.kick(live),
                );
            }
        }
        live.shown = live.problem;
        return Object.freeze({
            now: record.now,
            ready: record.ready,
            due: record.sends >= keeperView.settings.refresh || !ScribeScene.same(record.reminded, record.now),
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
             * @param {{ ready: string|null, suggestion: string|null }} lines
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
     * @param {{ keeper: { view: Function, rule: Function, file: Function, preview: Function }, storage: { get: Function, set: Function, remove: Function, list: Function }, roomId: string, ask: Function, clock: object, notify: Function }} options
     * @return {Readonly<object>}
     */
    open(options) {
        const { keeper, storage, roomId, ask, notify } = options;
        const settings = ScribeLive.Settings;
        const live = {
            keeper,
            storage,
            roomId,
            ask,
            notify,
            record: null,
            problem: null,
            shown: null,
            loaded: false,
            closed: false,
            watching: false,
            epoch: settings.FirstEpoch,
            running: null,
            waiting: null,
            answers: [],
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
