const PanelView = Object.freeze({
    Settings: Object.freeze({
        CastLines: 4,
        Standing: 3,
        Single: 1,
        FirstPage: 1,
        DraftLength: 200,
        Leading: Object.freeze(['role', 'status', 'location', 'title']),
        Lookups: Object.freeze(['subjects', 'facts', 'scenes']),
        Rulings: Object.freeze([
            Object.freeze({ from: 'conflicts', to: 'conflicts' }),
            Object.freeze({ from: 'lookAlikes', to: 'lookAlikes' }),
            Object.freeze({ from: 'scenes', to: 'publicScenes' }),
            Object.freeze({ from: 'questions', to: 'questions' }),
            Object.freeze({ from: 'refinements', to: 'refinements' }),
            Object.freeze({ from: 'aliases', to: 'aliases' }),
        ]),
        Words: Object.freeze({
            Loading: 'Loading the chat...',
            NoBookOpen: 'No book on this PC or in the Worker: ',
            NoLocalBook: 'No local book: ',
            NoBookOne: ' message.',
            NoBookMany: ' messages.',
            Reading: 'Reading the chat...',
            UpToDateOpen: 'Up to date: ',
            WaitingRead: 'Waiting to read: ',
            DisputedOpen: 'Unresolved authorship: ',
            Of: ' of ',
            ReadClose: ' read.',
            StoppedOpen: 'Stopped: ',
            Stopped: 'Stopped.',
            Paused: 'Paused.',
            Budget: "the day's budget is spent.",
            NoReason: 'the reason was not recorded.',
            Watching: 'Another tab is reading this chat.',
            CloudLoading: 'Loading the book from your Worker...',
            CloudConflict: 'This PC and your Worker hold different books for this chat.',
            WatchingPc: 'Another PC is reading this chat.',
            Offline: ' Working offline.',
            Refused: ' The DM API key was refused; the book stays on this PC.',
            UnusableOpen: ' The book stays on this PC: ',
            WorkerOpen: ' Worker: ',
            MessagesRead: ' messages read.',
            AboutOpen: ' About ',
            ReadingOne: ' reading to go.',
            ReadingMany: ' readings to go.',
            Minutes: ':',
            FirstUnderWay: 'The first reading is under way. This fills as each stretch lands.',
            NothingReadYet: 'Nothing has been read yet. Press Resume above.',
            ProblemOpen: ' Problem: ',
            LoginWait: " Waiting for the site's login: it is taken from the page's next request to Zeta.",
            ScribeOpen: ' Scribe: ',
            Hidden: ' (hidden)',
            Toward: ' toward ',
            TowardLine: 'toward ',
            Colon: ': ',
            Comma: ', ',
            Quote: '"',
            Hash: '#',
            Against: ' against ',
            InReply: '" in the reply; the book has ',
            BookHas: ': the book has ',
            ReplySays: '; the reply says ',
            Uses: ' uses that ',
            NeverTold: ' was never told.',
            FullStop: '.',
            Space: ' ',
            Nothing: '',
            Cut: '...',
            Unknown: '(unknown)',
            GoesFirst: "The book's value goes first in the next reminder, if this room may hear it.",
            Spent: 'The book has since changed.',
            Regenerate: 'If the reply should not stand, regenerate it. The next reminder will say who does not know.',
            RegenerateSituation: 'If the reply should not stand, regenerate it.',
            SituationSays: 'The reply says "',
            SituationEarlier: '"; earlier: "',
            SituationClose: '".',
        }),
        ModelOperations: Object.freeze({ scene: 'scene updates', check: 'story checks', recap: 'story recap' }),
        Problems: Object.freeze({
            key: ['OpenRouter key rejected', 'OpenRouter rejected the saved API key.', 'Open Settings, enter your current OpenRouter key, and press Save key.'],
            providerAuth: ['Model provider authentication error', 'The model provider reported an authentication error.', 'Check your provider settings in OpenRouter. If your OpenRouter key changed, enter it in Settings and press Save key.'],
            previousKey: ['Previous OpenRouter key rejection', 'The previous book reading stopped because OpenRouter rejected the key used then.', ''],
            keyStorage: ['Key storage unavailable', 'Scribe could not read the saved OpenRouter key from local storage.', 'Check that Tampermonkey can read its local storage, then retry.'],
            keyRecovery: ['Room recovery pending', 'The key is saved. Scribe could not resume work in this room and will try again.', ''],
            missingKey: ['OpenRouter key needed', 'Scribe needs an OpenRouter API key.', 'Open Settings, enter your OpenRouter key, and press Save key.'],
            credit: ['OpenRouter spending limit', 'OpenRouter reported a credit or spending limit.', 'Check the balance and spending limit for your OpenRouter account or key.'],
            rate: ['OpenRouter rate limit', 'OpenRouter is limiting requests.', ''],
            server: ['OpenRouter service error', 'OpenRouter returned a service error.', 'See Progress for the provider detail.'],
            connection: ['OpenRouter connection failed', 'The request to OpenRouter did not complete.', 'Check your connection.'],
            length: ['OpenRouter answer cut short', 'The model answer ended early.', 'See Progress for details.'],
            unusable: ['Unusable model answer', 'The model supplied no usable result.', 'See Progress for details.'],
            declined: ['Writer declined the recap', 'The writer declined to produce a recap. Your reminder is still due.', ''],
            unknown: ['OpenRouter request failed', '', 'See the OpenRouter detail in Progress.'],
            budget: ['Scribe daily budget spent', "Scribe reached its local daily budget.", ''],
            login: ['Zeta sign-in needed', 'Sign in to Zeta and open the chat.', ''],
            history: ['Zeta history unavailable', 'Scribe could not read the chat history from Zeta.', 'See Progress for details.'],
            local: ['Scribe problem', '', 'See the detail in Progress.'],
            workerKey: ['Worker key rejected', 'The Cloudflare Worker refused the DM API key.', 'In Tampermonkey, choose Zeta Scribe → Set DM API key.'],
            workerBook: ['Worker book unavailable', 'Book sync is unavailable.', 'See Progress for details.'],
            offline: ['Working offline', 'Scribe is working offline. It will retry the Worker connection.', ''],
            worker: ['Worker sync problem', 'The Cloudflare Worker reported a problem.', 'See Progress for details.'],
        }),
        Titles: Object.freeze({
            Spelling: 'Name spelt another way',
            Contradiction: 'The reply contradicts the book',
            Leak: 'Someone knows what they were not told',
            Situation: "The reply doesn't fit what's happening",
            Unknown: 'A finding of a kind this panel does not know',
        }),
        Actions: Object.freeze({
            Dismiss: 'Dismiss',
            Told: 'They were told',
            Rule: 'Rule it...',
        }),
        StringType: 'string',
        NumberType: 'number',
        ObjectType: 'object',
        SecondsPerMinute: 60,
        MillisecondsPerSecond: 1000,
        SecondDigits: 2,
        NoCount: 0,
    }),

    /**
     * @param {number} milliseconds
     * @return {string}
     */
    elapsed(milliseconds) {
        const settings = PanelView.Settings;
        const valid = Number.isFinite(milliseconds) && milliseconds > settings.NoCount;
        const seconds = valid ? Math.floor(milliseconds / settings.MillisecondsPerSecond) : settings.NoCount;
        const minutes = Math.floor(seconds / settings.SecondsPerMinute);
        const rest = String(seconds % settings.SecondsPerMinute).padStart(settings.SecondDigits, '0');
        return String(minutes) + settings.Words.Minutes + rest;
    },

    /**
     * @param {{ read: number, total: number, unread: readonly *[], settings: { size: number } }} keeperView
     * @return {string}
     */
    progress(keeperView) {
        const settings = PanelView.Settings;
        const words = settings.Words;
        let line = PanelView.number(keeperView.read) + words.Of + PanelView.number(keeperView.total) + words.MessagesRead;
        const unread = PanelView.listed(keeperView.unread);
        const disputed = unread.filter((message) => message?.attributionPending).length;
        if (disputed > settings.NoCount) {
            return line + ' ' + PanelView.number(disputed) +
                (disputed === settings.Single ? ' unread message has' : ' unread messages have') + ' unresolved authorship.';
        }
        const left = unread.length;
        if (left > settings.NoCount) {
            const readings = Math.ceil(left / keeperView.settings.size);
            line +=
                words.AboutOpen +
                PanelView.number(readings) +
                (readings === settings.Single ? words.ReadingOne : words.ReadingMany);
        }
        return line;
    },

    /**
     * @param {object} keeperView
     * @param {object} live
     * @return {string|null}
     */
    reminderStatus(keeperView, live) {
        if (live.unconfirmed) {
            return live.held;
        }
        if (live.selected != null) {
            return live.held;
        }
        if (live.forced && live.ready === null) {
            return keeperView.flight ?? live.preparationBlock ?? live.held;
        }
        return live.held;
    },

    /**
     * @param {object} keeperView
     * @param {object|null} cloud
     * @return {{ status: string, action: string }}
     */
    workerBook(keeperView, cloud) {
        const phases = ScribeCloud.Phase;
        const phase = cloud?.phase ?? phases.Off;
        const connect = 'In Tampermonkey, choose Zeta Scribe → Set DM API key and enter the key used on the other PC.';
        const revision = cloud?.bookRevision;
        const confirmed = Number.isSafeInteger(revision) && revision > 0 ? 'Worker book revision ' + revision + '.' : '';
        if (phase === phases.Off) {
            return { status: 'Worker unchecked. No DM API key on this PC.', action: connect };
        }
        if (phase === phases.Refused) {
            return { status: 'Worker access refused.', action: connect };
        }
        if (cloud?.unreadable) {
            return { status: 'The Worker’s saved data for this room is unreadable.',
                action: 'Check Progress and the book on the original PC. Scribe retries when the Worker has a new revision.' };
        }
        if (phase === phases.Offline || phase === phases.Unusable || cloud?.lookupFailed) {
            const offline = phase === phases.Offline || cloud?.lookupFailed;
            const status = offline ? 'Worker offline.' : 'Worker sync unavailable.';
            return { status: confirmed ? status + ' Last verified: ' + confirmed : status,
                action: offline ? 'Check your connection. Scribe retries automatically.' : 'See Progress for the Worker error.' };
        }
        if (phase === phases.Conflict) {
            return { status: 'This PC and the Worker have different books.', action: 'Review the two books above.' };
        }
        if (confirmed) {
            return { status: confirmed, action: cloud.bookPending ? 'Local book changes are waiting to upload.' :
                (keeperView.booked ? 'Open this room on the other PC with the same DM API key.' : 'Scribe is loading this book onto this PC.') };
        }
        if ((phase === phases.Leading || phase === phases.Watching) && revision === 0) {
            return { status: 'The Worker has no saved book for this room.',
                action: keeperView.booked && cloud.bookPending ? 'This PC’s book is waiting to upload.' :
                    'If another PC has this book, open the same room there and check its Worker status in Settings.' };
        }
        return { status: 'Worker book lookup pending.', action: phase === phases.Idle ? 'The reading tab checks this room.' : 'Checking this room for a saved book.' };
    },

    /**
     * @param {{ phase: string, read: number, flight: string|null }} keeperView
     * @param {object|null} cloud
     * @return {string|null}
     */
    empty(keeperView, cloud = null) {
        const settings = PanelView.Settings;
        const words = settings.Words;
        const phases = ScribeKeeper.Phase;
        if (keeperView.phase === phases.NoBook) {
            const worker = PanelView.workerBook(keeperView, cloud);
            return worker.status + ' ' + worker.action;
        }
        const booked = [phases.Reading, phases.Idle, phases.Stopped].includes(keeperView.phase);
        if (!booked || keeperView.read !== settings.NoCount) {
            return null;
        }
        if ((keeperView.flight ?? null) !== null) {
            return words.FirstUnderWay;
        }
        return keeperView.phase === phases.Stopped ? words.NothingReadYet : null;
    },

    /**
     * @param {{ pass: string, first: number|null, last: number|null, read: number, refusedLines?: *, refusedOperations?: * }} report
     * @return {string}
     */
    finished(report) {
        return BenchView.progress({
            ...report,
            refusedLines: PanelView.listed(report.refusedLines),
            refusedOperations: PanelView.listed(report.refusedOperations),
        });
    },

    Step: Object.freeze({
        Adopt: 'Adopt',
        Resume: 'Resume',
    }),

    /**
     * @param {{ phase: string, flight: string|null, stop: { reason: string }|null }} keeperView
     * @return {string|null}
     */
    next(keeperView) {
        const phases = ScribeKeeper.Phase;
        const stops = ScribeAdoption.Stop;
        const flight = keeperView.flight ?? null;
        const stop = keeperView.stop ?? null;
        if (flight !== null && flight !== ScribeKeeper.Settings.Flight.Looking) {
            return null;
        }
        if (keeperView.phase === phases.NoBook) {
            return PanelView.Step.Adopt;
        }
        if (
            keeperView.phase === phases.Stopped &&
            stop !== null &&
            stop.reason !== stops.Budget &&
            stop.reason !== stops.Done
        ) {
            return PanelView.Step.Resume;
        }
        return null;
    },

    /**
     * @param {{ phase: string, total: number, read: number, flight: string|null, stop: { reason: string, problem: string|null }|null, problem: string|null }} keeperView
     * @param {{ problem?: string|null }} liveView
     * @param {{ phase: string, problem?: string|null }|null} cloudView
     * @return {string}
     */
    headline(keeperView, liveView, cloudView = null) {
        const settings = PanelView.Settings;
        const words = settings.Words;
        const phases = ScribeKeeper.Phase;
        const clouds = ScribeCloud.Phase;
        const stops = ScribeAdoption.Stop;
        const flight = keeperView.flight ?? null;
        const cloud = cloudView === null ? clouds.Off : cloudView.phase;
        let line = words.Reading;
        if (cloud === clouds.Loading) {
            line = words.CloudLoading;
        } else if (cloud === clouds.Conflict) {
            line = words.CloudConflict;
        } else if (keeperView.phase === phases.Watching && cloud === clouds.Watching) {
            line = words.WatchingPc;
        } else if (keeperView.phase === phases.Watching) {
            line = words.Watching;
        } else if (flight !== null) {
            line = PanelView.said(flight);
        } else if (keeperView.phase === phases.Loading) {
            line = words.Loading;
        } else if (keeperView.phase === phases.NoBook) {
            const verifiedEmpty = [clouds.Leading, clouds.Watching].includes(cloud) && cloudView?.bookRevision === 0 &&
                !cloudView.lookupFailed && !cloudView.unreadable;
            line =
                (verifiedEmpty ? words.NoBookOpen : words.NoLocalBook) +
                PanelView.number(keeperView.total) +
                (keeperView.total === settings.Single ? words.NoBookOne : words.NoBookMany);
            if (!verifiedEmpty) {
                line += ' ' + PanelView.workerBook(keeperView, cloudView).status;
            }
        } else if (keeperView.phase === phases.Idle) {
            let status = keeperView.read < keeperView.total ? words.WaitingRead : words.UpToDateOpen;
            if (PanelView.listed(keeperView.unread).some((message) => message?.attributionPending)) {
                status = words.DisputedOpen;
            }
            line =
                status +
                PanelView.number(keeperView.read) +
                words.Of +
                PanelView.number(keeperView.total) +
                words.ReadClose;
        } else if (keeperView.phase === phases.Stopped && keeperView.stop === null) {
            line = words.Stopped;
        } else if (keeperView.phase === phases.Stopped && keeperView.stop.reason === stops.Paused) {
            line = words.StoppedOpen + words.Paused;
        } else if (keeperView.phase === phases.Stopped && keeperView.stop.reason === stops.Budget) {
            line = words.StoppedOpen + words.Budget;
        } else if (keeperView.phase === phases.Stopped) {
            line = words.Stopped;
        }
        return line;
    },

    /**
     * @param {string} reason
     * @return {{cause: string, provider: string}}
     */
    modelProblem(reason) {
        const gateway = ScribeGateway.Settings.Messages;
        const parsed = /^([^;]+); status (\d{3}|no response); finish ([^;]+?)(?:; reason: (.*))?$/.exec(reason);
        const diagnostic = parsed && (Object.values(gateway).includes(parsed[1]) || /^no answer within \d+ seconds$/.test(parsed[1]));
        const legacy = /^HTTP (\d{3})(?:\s*:\s*|\s+|$)(.*)$/.exec(reason);
        const status = Number(diagnostic ? parsed[2] : legacy?.[1]);
        const provider = (diagnostic ? parsed[4] : legacy?.[2]) ?? '';
        let cause = 'unknown';
        if (status === 401) {
            cause = 'key';
        } else if (diagnostic && status >= 200 && status < 300 && parsed[1] === gateway.ProviderAuth) {
            cause = 'providerAuth';
        } else if (status === 402) {
            cause = 'credit';
        } else if (status === 429) {
            cause = 'rate';
        } else if (status >= 500 && status < 600) {
            cause = 'server';
        } else if (diagnostic && parsed[2] === 'no response' && (parsed[1] === gateway.Network || parsed[1].startsWith(gateway.TimeoutPrefix))) {
            cause = 'connection';
        } else if (diagnostic && parsed[3] === ScribeGateway.Settings.Finish.Length) {
            cause = 'length';
        } else if ((diagnostic && status >= 200 && status < 300) || [ScribeLive.Settings.Messages.SceneUnreadable, ScribeLive.Settings.Messages.StoryEmpty].includes(reason)) {
            cause = 'unusable';
        } else if (reason === 'No key') {
            cause = 'missingKey';
        } else if (reason === "The day's budget is spent" || reason === ScribeLive.Settings.Messages.Budget) {
            cause = 'budget';
        }
        return { cause, provider: cause === 'unknown' ? reason : provider };
    },

    /**
     * @param {object} keeperView
     * @return {boolean}
     */
    previousKey(keeperView) {
        const stop = keeperView.stop;
        if (!keeperView.restoredStop || stop?.reason !== ScribeAdoption.Stop.Failed || typeof stop.problem !== 'string') {
            return false;
        }
        const detail = stop.problem.trim();
        return stop.source === 'OpenRouter' ? PanelView.modelProblem(detail).cause === 'key' :
            !stop.source && /^unexpected HTTP status; status 401; finish none(?:; reason: .+)?$/.test(detail);
    },

    /**
     * @param {object} keeperView
     * @param {object} liveView
     * @param {object|null} cloudView
     * @return {object[]}
     */
    problems(keeperView, liveView, cloudView = null) {
        const groups = new Map();
        const copy = PanelView.Settings.Problems;
        const add = (service, cause, operation, detail, distinction = '', retrying = false) => {
            const key = JSON.stringify([service, cause, distinction]);
            if (!groups.has(key)) {
                groups.set(key, { service, cause, operations: [], label: copy[cause][0], details: [], retrying: false });
            }
            const group = groups.get(key);
            if (!group.operations.includes(operation)) {
                group.operations.push(operation);
            }
            if (detail && !group.details.includes(detail)) {
                group.details.push(detail);
            }
            group.retrying ||= retrying;
        };
        const model = (operation, detail, retrying = false, source = 'OpenRouter') => {
            const { cause, provider } = PanelView.modelProblem(detail);
            if (source === ScribeStore.KeyStorageSource) {
                add('Scribe', 'keyStorage', operation, null);
            } else if (cause === 'budget' || cause === 'missingKey') {
                add('Scribe', cause, operation, detail);
            } else if (source === 'Scribe') {
                add('Scribe', 'local', operation, detail, detail);
            } else {
                add('OpenRouter', cause, operation, detail, provider, retrying);
            }
        };
        if (keeperView.keyProblem) {
            add('Scribe', 'keyStorage', 'key access', null);
        }
        if (keeperView.keyRecoveryProblem) {
            add('Scribe', 'keyRecovery', 'room recovery', null);
        }
        const keeper = keeperView.problem;
        if (keeper) {
            if (keeper === ZetaSource.Settings.Messages.NoLogin) {
                add('Zeta', 'login', 'chat history', keeper);
            } else if (keeperView.problemSource === 'Zeta') {
                add('Zeta', 'history', 'chat history', keeper, keeper);
            } else {
                add('Scribe', 'local', 'book updates', keeper, keeper);
            }
        }
        const stop = keeperView.stop;
        if (stop?.reason === ScribeAdoption.Stop.Failed) {
            const detail = stop.problem?.trim() || 'The reason was not recorded.';
            if (keeperView.previousKey ?? PanelView.previousKey(keeperView)) {
                add('OpenRouter', 'previousKey', 'book reading', detail);
            } else if (stop.source === 'OpenRouter' || ScribeStore.localSource(stop.source)) {
                model('book reading', detail, false, stop.source);
            } else {
                add('Scribe', 'local', 'book reading', detail, detail);
            }
        }
        if (keeperView.checkerProblem?.reason) {
            model('story checks', keeperView.checkerProblem.reason, false, keeperView.checkerProblem.source);
        }
        const failing = PanelView.listed(liveView.failing);
        for (const failure of failing) {
            const operation = PanelView.Settings.ModelOperations[failure?.role];
            if (failure?.role === 'recap' && failure.reason === ScribeLive.Settings.Messages.StoryDeclined) {
                add('Scribe', 'declined', operation, null);
            } else if (operation && typeof failure.reason === 'string') {
                model(operation, failure.reason, failure.retrying === true, failure.source);
            }
        }
        if (liveView.problem && !failing.some((failure) => failure?.reason === liveView.problem)) {
            const detail = liveView.problem;
            if (detail === ScribeLive.Settings.Messages.Budget) {
                add('Scribe', 'budget', 'live updates', detail);
            } else {
                add('Scribe', 'local', 'live updates', detail, detail);
            }
        }
        const cloudCause = cloudView?.unreadable ? 'workerBook' : cloudView?.lookupFailed ? 'offline' :
            { Refused: 'workerKey', Unusable: 'workerBook', Offline: 'offline' }[cloudView?.phase];
        if (cloudCause || cloudView?.problem) {
            add('Cloudflare', cloudCause ?? 'worker', 'book sync', cloudView.problem);
        }
        const result = [];
        for (const group of groups.values()) {
            const [, opening, guidance] = copy[group.cause];
            let action = guidance;
            if (group.cause === 'previousKey') {
                if (keeperView.keyProblem || keeperView.hasKey == null) {
                    action = 'Check that Tampermonkey can read its local storage before retrying.';
                } else if (!keeperView.hasKey) {
                    action = copy.missingKey[2];
                } else {
                    action = keeperView.reader && PanelView.next(keeperView) === PanelView.Step.Resume ?
                        'Press Resume to try the saved key.' : 'Use Resume in the reading tab to try the saved key.';
                }
            }
            const names = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(group.operations);
            const affected = names[0].toUpperCase() + names.slice(1) + ' could not run.';
            const retry = group.retrying && group.cause === 'rate' ? ' A retry is scheduled.' : '';
            const description = ['declined', 'previousKey', 'keyStorage', 'keyRecovery'].includes(group.cause) ? '' : affected;
            const explanation = [opening, description, action].filter(Boolean).join(' ') + retry;
            result.push({ ...group, explanation });
        }
        return result;
    },

    /**
     * @param {{ conflicts: *, lookAlikes: *, questions: * }} state
     * @return {{ conflicts: number, lookAlikes: number, questions: number }}
     */
    needs(state) {
        /**
         * @return {boolean}
         */
        const any = () => true;
        return {
            conflicts: PanelView.tally(state.conflicts, any),
            lookAlikes: PanelView.tally(state.lookAlikes, any),
            questions: PanelView.tally(
                state.questions,
                /**
                 * @param {{ answer: string|null, dismissed: boolean }} question
                 * @return {boolean}
                 */
                (question) => question.answer === null && !question.dismissed,
            ),
        };
    },

    /**
     * @param {object} state
     * @return {{ needs: { conflicts: number, lookAlikes: number, questions: number }, cast: Array<{ id: string, label: string, kind: string, lines: string[] }|null>, standing: object[], days: Array<{ day: number|null, scenes: Array<object|null> }>, threads: Array<{ id: string, text: string, position: number }|null> }}
     */
    summary(state) {
        const settings = PanelView.Settings;
        const words = settings.Words;
        const relation = ScribeCategory.Settings.RelationCategory;
        const names = PanelView.names(state);
        const shown = new Map();
        const facts = PanelView.each(
            state.facts,
            /**
             * @param {{ status: string, subject: string, category: string, target: string|null, targetText: string|null, text: string, hidden: boolean }} fact
             * @return {object[]}
             */
            (fact) =>
                fact.status === ScribeReplay.Status.InForce
                    ? [
                          {
                              subject: fact.subject,
                              category: fact.category,
                              form: fact.form,
                              dimension: fact.dimension,
                              target: fact.target,
                              targetText: fact.targetText,
                              text: fact.text,
                              hidden: fact.hidden,
                          },
                      ]
                    : [],
        );
        for (const fact of facts) {
            if (fact === null) {
                continue;
            }
            const kept = shown.get(fact.subject) ?? [];
            kept.push(fact);
            shown.set(fact.subject, kept);
        }
        const members = PanelView.each(
            state.subjects,
            /**
             * @param {{ id: string, label: string, kind: string, mergedInto: string|null }} subject
             * @return {Array<{ id: string, label: string, kind: string, lines: string[], facts: number }>}
             */
            (subject) => {
                if (subject.mergedInto !== null) {
                    return [];
                }
                const owned = shown.get(subject.id) ?? [];
                const ordered = [];
                for (const category of settings.Leading) {
                    ordered.push(
                        ...owned.filter(
                            /**
                             * @param {{ category: string }} fact
                             * @return {boolean}
                             */
                            (fact) => fact.category === category,
                        ),
                    );
                }
                ordered.push(
                    ...owned.filter(
                        /**
                         * @param {{ category: string }} fact
                         * @return {boolean}
                         */
                        (fact) => fact.category === relation,
                    ),
                    ...owned.filter(
                        /**
                         * @param {{ category: string }} fact
                         * @return {boolean}
                         */
                        (fact) => fact.category !== relation && !settings.Leading.includes(fact.category),
                    ),
                );
                const lines = ordered.slice(0, settings.CastLines).map(
                    /**
                     * @param {{ category: string, target: string|null, targetText: string|null, text: string, hidden: boolean }} fact
                     * @return {string}
                     */
                    (fact) => {
                        const mark = fact.hidden ? words.Hidden : words.Nothing;
                        if (fact.category !== relation) {
                            return BenchView.scoped(fact, PanelView.said(fact.category)) + words.Colon + PanelView.said(fact.text) + mark;
                        }
                        const target = fact.target === null ? PanelView.named(fact.targetText) : names.get(fact.target);
                        return words.TowardLine + target + words.Colon + PanelView.said(fact.text) + mark;
                    },
                );
                return [
                    {
                        id: subject.id,
                        label: PanelView.named(subject.label),
                        kind: PanelView.named(subject.kind),
                        lines,
                        facts: owned.length,
                    },
                ];
            },
        );
        const ranked = members.filter(
            /**
             * @param {object|null} member
             * @return {boolean}
             */
            (member) => member !== null,
        );
        ranked.sort(
            /**
             * @param {{ label: string, facts: number }} first
             * @param {{ label: string, facts: number }} second
             * @return {number}
             */
            (first, second) => second.facts - first.facts || first.label.localeCompare(second.label),
        );
        const cast = [
            ...ranked.map(
                /**
                 * @param {{ id: string, label: string, kind: string, lines: string[] }} member
                 * @return {{ id: string, label: string, kind: string, lines: string[] }}
                 */
                (member) => ({ id: member.id, label: member.label, kind: member.kind, lines: member.lines }),
            ),
            ...members.filter(
                /**
                 * @param {object|null} member
                 * @return {boolean}
                 */
                (member) => member === null,
            ),
        ];
        const scenes = PanelView.each(
            state.scenes,
            /**
             * @param {{ day: number, lastPosition: number }} scene
             * @return {Array<{ day: number, last: number, row: object }>}
             */
            (scene) => [{ day: scene.day, last: scene.lastPosition, row: BenchView.scene(scene, names, state) }],
        );
        const placed = scenes.filter(
            /**
             * @param {object|null} scene
             * @return {boolean}
             */
            (scene) => scene !== null,
        );
        const latest = [...placed].sort(
            /**
             * @param {{ last: number }} first
             * @param {{ last: number }} second
             * @return {number}
             */
            (first, second) => first.last - second.last,
        );
        const standing = latest.slice(-settings.Standing).map(
            /**
             * @param {{ row: object }} scene
             * @return {object}
             */
            (scene) => scene.row,
        );
        const grouped = new Map();
        for (const scene of placed) {
            const rows = grouped.get(scene.day) ?? [];
            rows.push(scene.row);
            grouped.set(scene.day, rows);
        }
        const days = [...grouped.entries()]
            .sort(
                /**
                 * @param {[number, object[]]} first
                 * @param {[number, object[]]} second
                 * @return {number}
                 */
                (first, second) => first[0] - second[0],
            )
            .map(
                /**
                 * @param {[number, object[]]} entry
                 * @return {{ day: number, scenes: object[] }}
                 */
                ([day, rows]) => ({ day, scenes: rows }),
            );
        const lost = scenes.filter(
            /**
             * @param {object|null} scene
             * @return {boolean}
             */
            (scene) => scene === null,
        );
        if (lost.length > 0) {
            days.push({ day: null, scenes: lost });
        }
        const threads = PanelView.each(
            state.threads,
            /**
             * @param {{ id: string, text: string, position: number, closed: object|null }} thread
             * @return {Array<{ id: string, text: string, position: number }>}
             */
            (thread) =>
                thread.closed === null ? [{
                    id: thread.id,
                    text: [thread.text, BenchView.citations(thread)].filter(Boolean).join(' · '),
                    position: thread.position,
                }] : [],
        );
        return { needs: PanelView.needs(state), cast, standing, days, threads };
    },

    /**
     * @param {object} state
     * @return {{ conflicts: Array<object|null>, lookAlikes: Array<object|null>, publicScenes: Array<object|null>, questions: Array<object|null>, refinements: Array<object|null>, aliases: Array<object|null> }}
     */
    rulings(state) {
        const settings = PanelView.Settings;
        const empty = {};
        for (const list of settings.Rulings) {
            empty[list.from] = [];
        }

        /**
         * @return {Object<string, Array<object|null>>}
         */
        const apart = () => {
            const sound = PanelView.sound(state);
            const lists = {};
            for (const list of settings.Rulings) {
                const items = state[list.from];

                /**
                 * @param {readonly object[]} entries
                 * @param {object} base
                 * @return {object[]}
                 */
                const read = (entries, base) => BenchView.rulings({ ...base, ...empty, [list.from]: entries })[list.to];

                /**
                 * @return {Array<object|null>}
                 */
                const one = () => PanelView.apart(items, read, sound);
                lists[list.to] = PanelView.objects(items)
                    ? PanelView.attempt(
                          /**
                           * @return {object[]}
                           */
                          () => read(items, sound),
                          one,
                      )
                    : one();
            }
            return lists;
        };
        const whole = settings.Rulings.every(
            /**
             * @param {{ from: string }} list
             * @return {boolean}
             */
            (list) => PanelView.objects(state[list.from]),
        );
        return whole
            ? PanelView.attempt(
                  /**
                   * @return {object}
                   */
                  () => BenchView.rulings(state),
                  apart,
              )
            : apart();
    },

    /**
     * @param {{ type: *, position: *, said: *, earlier: *, before: *, entry?: *, why: * }} operation
     * @return {string[]}
     */
    sides(operation) {
        const settings = PanelView.Settings;
        const words = settings.Words;
        if (operation.type !== ScribeAnswer.Type.Contradiction) {
            return [];
        }
        /**
         * @param {*} position
         * @param {*} quote
         * @return {string}
         */
        const cited = (position, quote) =>
            words.Hash + PanelView.said(position) + words.Space + words.Quote + PanelView.said(quote) + words.Quote;
        const earlier =
            typeof operation.entry === settings.StringType
                ? operation.entry
                : cited(operation.earlier, operation.before);
        return [cited(operation.position, operation.said), earlier, PanelView.said(operation.why)];
    },

    /**
     * @param {object} state
     * @return {Array<{ id: string, text: string, why: string }|null>}
     */
    contradictions(state) {
        const words = PanelView.Settings.Words;
        return PanelView.each(
            state.contradictions,
            /**
             * @param {{ id: *, position: *, said: *, earlierPosition: *, before: *, why: *, dismissed: * }} item
             * @return {Array<{ id: string, text: string, why: string }>}
             */
            (item) =>
                item.dismissed === true
                    ? []
                    : [
                          {
                              id: PanelView.said(item.id),
                              text:
                                  words.Hash +
                                  PanelView.said(item.position) +
                                  words.Space +
                                  words.Quote +
                                  PanelView.said(item.said) +
                                  words.Quote +
                                  words.Against +
                                  words.Hash +
                                  PanelView.said(item.earlierPosition) +
                                  words.Space +
                                  words.Quote +
                                  PanelView.said(item.before) +
                                  words.Quote,
                              why: PanelView.said(item.why),
                          },
                      ],
        ).reverse();
    },

    /**
     * @param {object} state
     * @param {string} query
     * @param {number} page
     * @return {{ rows: Array<object|null>, pages: number }}
     */
    subjects(state, query, page) {
        const settings = PanelView.Settings;

        /**
         * @return {{ rows: Array<object|null>, pages: number }}
         */
        const apart = () =>
            BenchView.page(
                PanelView.apart(
                    state.subjects,
                    /**
                     * @param {readonly object[]} entries
                     * @param {object} base
                     * @return {object[]}
                     */
                    (entries, base) =>
                        BenchView.subjects({ ...base, subjects: entries }, query, settings.FirstPage).rows,
                    PanelView.sound(state),
                ),
                page,
            );
        return PanelView.objects(state.subjects)
            ? PanelView.attempt(
                  /**
                   * @return {{ rows: object[], pages: number }}
                   */
                  () => BenchView.subjects(state, query, page),
                  apart,
              )
            : apart();
    },

    /**
     * @param {object} state
     * @param {string} id
     * @return {{ id: string, heading: string, kind: string, aka: readonly string[], facts: Array<object|null> }|null}
     */
    subject(state, id) {
        /**
         * @return {object|null}
         */
        const apart = () => {
            const sound = PanelView.sound(state);
            const found = PanelView.attempt(
                /**
                 * @return {object|null}
                 */
                () => BenchView.subject({ ...sound, facts: [] }, id),
                /**
                 * @return {null}
                 */
                () => null,
            );
            if (found === null) {
                return null;
            }
            const facts = PanelView.apart(
                state.facts,
                /**
                 * @param {readonly object[]} entries
                 * @param {object} base
                 * @return {object[]}
                 */
                (entries, base) => BenchView.subject({ ...base, facts: entries }, id).facts,
                sound,
            );
            return { ...found, facts };
        };
        const whole = PanelView.objects(state.subjects) && PanelView.objects(state.facts);
        const subject = whole
            ? PanelView.attempt(
                  /**
                   * @return {object|null}
                   */
                  () => BenchView.subject(state, id),
                  apart,
              )
            : apart();
        if (subject !== null) {
            const facts = new Map(PanelView.listed(state.facts).filter(Boolean).map((fact) => [fact.id, fact]));
            for (const row of subject.facts) {
                const fact = facts.get(row?.id);
                if (row && ScribeReplay.live(fact)) {
                    row.expected = PanelView.attempt(() => ScribeLog.editExpected(fact, state), () => null);
                }
            }
        }
        return subject;
    },

    /**
     * @param {object} state
     * @param {number} page
     * @return {{ rows: Array<object|null>, pages: number }}
     */
    timeline(state, page) {
        const names = PanelView.names(state);
        return BenchView.page(
            PanelView.each(
                state.scenes,
                /**
                 * @param {object} scene
                 * @return {object[]}
                 */
                (scene) => [BenchView.scene(scene, names, state)],
            ),
            page,
        );
    },

    /**
     * @param {*} value
     * @return {string}
     */
    named(value) {
        const settings = PanelView.Settings;
        const present = typeof value === settings.StringType && value !== settings.Words.Nothing;
        return present ? value : settings.Words.Unknown;
    },

    /**
     * @param {*} value
     * @return {string}
     */
    said(value) {
        const settings = PanelView.Settings;
        if (typeof value === settings.StringType) {
            return value;
        }
        if (typeof value === settings.NumberType && Number.isFinite(value)) {
            return String(value);
        }
        return settings.Words.Unknown;
    },

    /**
     * @param {*} value
     * @return {string}
     */
    number(value) {
        const finite = typeof value === PanelView.Settings.NumberType && Number.isFinite(value);
        return finite ? BenchView.count(value) : PanelView.Settings.Words.Unknown;
    },

    /**
     * @param {*} items
     * @return {readonly *[]}
     */
    listed(items) {
        return Array.isArray(items) ? items : [];
    },

    /**
     * @param {*} item
     * @return {boolean}
     */
    entry(item) {
        return item !== null && typeof item === PanelView.Settings.ObjectType;
    },

    /**
     * @param {*} items
     * @return {boolean}
     */
    objects(items) {
        return (
            Array.isArray(items) &&
            items.every(
                /**
                 * @param {*} item
                 * @return {boolean}
                 */
                (item) => PanelView.entry(item),
            )
        );
    },

    /**
     * @param {*} items
     * @param {(item: object) => Array<*>} read
     * @return {Array<*>}
     */
    each(items, read) {
        const rows = [];
        for (const item of PanelView.listed(items)) {
            if (!PanelView.entry(item)) {
                rows.push(null);
                continue;
            }
            try {
                rows.push(...read(item));
            } catch {
                rows.push(null);
            }
        }
        return rows;
    },

    /**
     * @param {*} items
     * @return {Array<string|null>}
     */
    lines(items) {
        return PanelView.listed(items).map(
            /**
             * @param {*} item
             * @return {string|null}
             */
            (item) => (typeof item === PanelView.Settings.StringType ? item : null),
        );
    },

    /**
     * @param {*} items
     * @param {(item: object) => boolean} test
     * @return {number}
     */
    tally(items, test) {
        return PanelView.each(
            items,
            /**
             * @param {object} item
             * @return {object[]}
             */
            (item) => (test(item) ? [item] : []),
        ).filter(
            /**
             * @param {object|null} item
             * @return {boolean}
             */
            (item) => item !== null,
        ).length;
    },

    /**
     * @param {() => *} read
     * @param {() => *} fallback
     * @return {*}
     */
    attempt(read, fallback) {
        try {
            return read();
        } catch {
            return fallback();
        }
    },

    /**
     * @param {*} items
     * @param {(entries: readonly object[], base: object) => object[]} read
     * @param {object} sound
     * @return {Array<object|null>}
     */
    apart(items, read, sound) {
        return PanelView.each(
            items,
            /**
             * @param {object} item
             * @return {object[]}
             */
            (item) => read([item], sound),
        );
    },

    /**
     * @param {object} state
     * @return {object}
     */
    sound(state) {
        const sound = { ...state };
        for (const name of PanelView.Settings.Lookups) {
            sound[name] = PanelView.each(
                state[name],
                /**
                 * @param {object} item
                 * @return {object[]}
                 */
                (item) => [{ ...item }],
            ).filter(
                /**
                 * @param {object|null} item
                 * @return {boolean}
                 */
                (item) => item !== null,
            );
        }
        return sound;
    },

    /**
     * @param {object} state
     * @return {{ get: (id: *) => string }}
     */
    names(state) {
        const labels = PanelView.attempt(
            /**
             * @return {Map<string, string>}
             */
            () => BenchView.labels(state),
            /**
             * @return {Map<string, string>}
             */
            () => BenchView.labels(PanelView.sound(state)),
        );
        return {
            /**
             * @param {*} id
             * @return {string}
             */
            get: (id) => PanelView.named(labels.get(id)),
        };
    },

    /**
     * @param {{ get: (id: *) => string }} names
     * @param {Map<string, object>} facts
     * @param {{ label: *, category: *, fact: * }} finding
     * @return {string}
     */
    about(names, facts, finding) {
        const words = PanelView.Settings.Words;
        const fact = facts.get(finding.fact);
        const label = PanelView.named(finding.label);
        if (finding.category !== ScribeCategory.Settings.RelationCategory || fact === undefined) {
            return label + words.Comma + PanelView.named(finding.category);
        }
        const target = fact.target === null ? PanelView.named(fact.targetText) : names.get(fact.target);
        return label + words.Toward + target;
    },

    /**
     * @param {object} state
     * @param {object[]} verified
     * @param {object[]} live
     * @return {object[]}
     */
    checkerFindings(state, verified, live) {
        const known = [...PanelView.listed(live), ...PanelView.listed(state?.resolutions)];
        const includes = (text, words) => Boolean(text && words &&
            (' ' + ScribeReplay.wording(text) + ' ').includes(' ' + ScribeReplay.wording(words) + ' '));
        return PanelView.listed(verified).filter((check) => !known.some((finding) => {
            if (check.kind !== 'Contradiction' || !['Contradiction', 'Situation'].includes(finding.kind) ||
                check.source.messageId !== finding.message || check.source.fingerprint !== finding.fingerprint ||
                !(includes(check.source.quote, finding.said) || includes(finding.said, check.source.quote))) {
                return false;
            }
            if (finding.fact && check.record?.text.includes(JSON.stringify(finding.fact))) {
                return true;
            }
            return includes(check.earlier?.quote, finding.book) &&
                (!finding.fact || state.facts?.some((fact) => fact.id === finding.fact && fact.cite === check.earlier.messageId));
        }));
    },

    /**
     * @param {object} state
     * @param {{ findings?: * }} liveView
     * @return {Array<{ key: *, kind: *, status: *, title: string, detail: string, actions: string[], notes: string[], draft: string|null }|null>}
     */
    findings(state, liveView) {
        const settings = PanelView.Settings;
        const words = settings.Words;
        const titles = settings.Titles;
        const actions = settings.Actions;
        const kinds = ScribePedant.Kind;
        const names = PanelView.names(state);
        const facts = PanelView.attempt(
            /**
             * @return {Map<string, object>}
             */
            () => BenchView.facts(state),
            /**
             * @return {Map<string, object>}
             */
            () => BenchView.facts(PanelView.sound(state)),
        );
        return PanelView.each(
            liveView.findings,
            /**
             * @param {{ key: *, kind: *, status: *, label: *, category: *, book: *, said: *, speakerLabel: *, written: *, fact: *, can?: object|null }} finding
             * @return {Array<{ key: *, kind: *, status: *, title: string, detail: string, actions: string[], notes: string[], draft: string|null }>}
             */
            (finding) => {
                const open = finding.status === ScribeLive.Status.Open;
                const can = open ? (finding.can ?? null) : null;
                const known = [kinds.Spelling, kinds.Contradiction, kinds.Leak, kinds.Situation].includes(finding.kind);
                let title = titles.Unknown;
                let detail = words.Nothing;
                if (finding.kind === kinds.Spelling) {
                    title = titles.Spelling;
                    detail =
                        words.Quote +
                        PanelView.named(finding.written) +
                        words.InReply +
                        PanelView.named(finding.label) +
                        words.FullStop;
                } else if (finding.kind === kinds.Contradiction) {
                    title = titles.Contradiction;
                    detail =
                        PanelView.about(names, facts, finding) +
                        words.BookHas +
                        PanelView.named(finding.book) +
                        words.ReplySays +
                        PanelView.named(finding.said) +
                        words.FullStop;
                } else if (finding.kind === kinds.Leak) {
                    title = titles.Leak;
                    const speaker = PanelView.named(finding.speakerLabel);
                    detail =
                        speaker +
                        words.Uses +
                        PanelView.about(names, facts, finding) +
                        words.Colon +
                        PanelView.named(finding.book) +
                        words.FullStop +
                        words.Space +
                        speaker +
                        words.NeverTold;
                } else if (finding.kind === kinds.Situation) {
                    title = titles.Situation;
                    detail =
                        words.SituationSays +
                        PanelView.named(finding.said) +
                        words.SituationEarlier +
                        PanelView.named(finding.book) +
                        words.SituationClose;
                }
                const listed = open || finding.status === ScribeLive.Status.Reminded;
                const possible = listed ? [actions.Dismiss] : [];
                const notes = [];
                let draft = null;
                if (known && can !== null && can.spent) {
                    notes.push(words.Spent);
                } else if (known && listed) {
                    const leak = finding.kind === kinds.Leak;
                    const contradiction = finding.kind === kinds.Contradiction;
                    if (can !== null && can.told === true) {
                        possible.push(actions.Told);
                    }
                    if (contradiction) {
                        possible.push(actions.Rule);
                        const reply = Array.from(PanelView.named(finding.said));
                        const cut = reply.length > settings.DraftLength;
                        const kept = cut ? reply.slice(0, settings.DraftLength - words.Cut.length) : reply;
                        draft =
                            PanelView.about(names, facts, finding) +
                            words.Colon +
                            kept.join(words.Nothing) +
                            (cut ? words.Cut : words.Nothing);
                    }
                    if (contradiction && open) {
                        notes.push(words.GoesFirst);
                    }
                    if (leak && open) {
                        notes.push(words.Regenerate);
                    }
                    if (finding.kind === kinds.Situation && open) {
                        notes.push(words.RegenerateSituation);
                    }
                }
                return [
                    {
                        key: finding.key,
                        ...(finding.fingerprint ? { fingerprint: finding.fingerprint } : {}),
                        ...(finding.ruling !== undefined ? { ruling: finding.ruling } : {}),
                        kind: finding.kind,
                        status: finding.status,
                        title,
                        detail,
                        actions: possible,
                        notes,
                        draft,
                    },
                ];
            },
        );
    },
});
