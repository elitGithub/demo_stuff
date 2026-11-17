const BenchPage = Object.freeze({
    Settings: Object.freeze({
        Ids: Object.freeze({
            Key: 'key',
            KeyProblem: 'key-problem',
            Campaign: 'campaign',
            Model: 'model',
            ModelProblem: 'model-problem',
            Size: 'size',
            SizeProblem: 'size-problem',
            Stop: 'stop',
            StopProblem: 'stop-problem',
            Budget: 'budget',
            BudgetProblem: 'budget-problem',
            Pause: 'pause',
            Continue: 'continue',
            Start: 'start',
            Status: 'status',
            TabProgress: 'tab-progress',
            TabBook: 'tab-book',
            TabTimeline: 'tab-timeline',
            TabRulings: 'tab-rulings',
            TabAudit: 'tab-audit',
            PanelProgress: 'panel-progress',
            PanelBook: 'panel-book',
            PanelTimeline: 'panel-timeline',
            PanelRulings: 'panel-rulings',
            PanelAudit: 'panel-audit',
            ProgressTitle: 'progress-title',
            BookTitle: 'book-title',
            TimelineTitle: 'timeline-title',
            RulingsTitle: 'rulings-title',
            AuditTitle: 'audit-title',
            Waiting: 'waiting',
            ProgressList: 'progress-list',
            ProgressPrevious: 'progress-previous',
            ProgressPlace: 'progress-place',
            ProgressNext: 'progress-next',
            Search: 'search',
            SubjectsList: 'subjects-list',
            SubjectsPrevious: 'subjects-previous',
            SubjectsPlace: 'subjects-place',
            SubjectsNext: 'subjects-next',
            Detail: 'detail',
            Heading: 'heading',
            Names: 'names',
            FactsList: 'facts-list',
            FactsPrevious: 'facts-previous',
            FactsPlace: 'facts-place',
            FactsNext: 'facts-next',
            AddCategory: 'add-category',
            AddTargetField: 'add-target-field',
            AddTarget: 'add-target',
            AddText: 'add-text',
            AddHidden: 'add-hidden',
            AddFile: 'add-file',
            AddOutcome: 'add-outcome',
            SplitLabel: 'split-label',
            SplitKind: 'split-kind',
            SplitFile: 'split-file',
            SplitOutcome: 'split-outcome',
            TimelineList: 'timeline-list',
            TimelinePrevious: 'timeline-previous',
            TimelinePlace: 'timeline-place',
            TimelineNext: 'timeline-next',
            KeepFirst: 'keep-first',
            KeepOutcome: 'keep-outcome',
            ConflictsList: 'conflicts-list',
            ConflictsPrevious: 'conflicts-previous',
            ConflictsPlace: 'conflicts-place',
            ConflictsNext: 'conflicts-next',
            LikesList: 'likes-list',
            LikesPrevious: 'likes-previous',
            LikesPlace: 'likes-place',
            LikesNext: 'likes-next',
            ScenesList: 'scenes-list',
            ScenesPrevious: 'scenes-previous',
            ScenesPlace: 'scenes-place',
            ScenesNext: 'scenes-next',
            QuestionsList: 'questions-list',
            QuestionsPrevious: 'questions-previous',
            QuestionsPlace: 'questions-place',
            QuestionsNext: 'questions-next',
            AliasesList: 'aliases-list',
            AliasesPrevious: 'aliases-previous',
            AliasesPlace: 'aliases-place',
            AliasesNext: 'aliases-next',
            RefinementsList: 'refinements-list',
            RefinementsPrevious: 'refinements-previous',
            RefinementsPlace: 'refinements-place',
            RefinementsNext: 'refinements-next',
            MadeList: 'made-list',
            MadePrevious: 'made-previous',
            MadePlace: 'made-place',
            MadeNext: 'made-next',
            AuditSeed: 'audit-seed',
            AuditDraw: 'audit-draw',
            AuditTally: 'audit-tally',
            AuditSave: 'audit-save',
            AuditOutcome: 'audit-outcome',
            AuditList: 'audit-list',
            AuditPrevious: 'audit-previous',
            AuditPlace: 'audit-place',
            AuditNext: 'audit-next',
        }),
        Tabs: Object.freeze({
            Progress: Object.freeze({ tab: 'TabProgress', panel: 'PanelProgress', heading: 'ProgressTitle' }),
            Book: Object.freeze({ tab: 'TabBook', panel: 'PanelBook', heading: 'BookTitle' }),
            Timeline: Object.freeze({ tab: 'TabTimeline', panel: 'PanelTimeline', heading: 'TimelineTitle' }),
            Rulings: Object.freeze({ tab: 'TabRulings', panel: 'PanelRulings', heading: 'RulingsTitle' }),
            Audit: Object.freeze({ tab: 'TabAudit', panel: 'PanelAudit', heading: 'AuditTitle' }),
        }),
        FirstTab: 'Progress',
        Lists: Object.freeze({
            Progress: Object.freeze({
                list: 'ProgressList',
                previous: 'ProgressPrevious',
                place: 'ProgressPlace',
                next: 'ProgressNext',
            }),
            Subjects: Object.freeze({
                list: 'SubjectsList',
                previous: 'SubjectsPrevious',
                place: 'SubjectsPlace',
                next: 'SubjectsNext',
            }),
            Facts: Object.freeze({ list: 'FactsList', previous: 'FactsPrevious', place: 'FactsPlace', next: 'FactsNext' }),
            Timeline: Object.freeze({
                list: 'TimelineList',
                previous: 'TimelinePrevious',
                place: 'TimelinePlace',
                next: 'TimelineNext',
            }),
            Conflicts: Object.freeze({
                list: 'ConflictsList',
                previous: 'ConflictsPrevious',
                place: 'ConflictsPlace',
                next: 'ConflictsNext',
            }),
            Likes: Object.freeze({ list: 'LikesList', previous: 'LikesPrevious', place: 'LikesPlace', next: 'LikesNext' }),
            Scenes: Object.freeze({ list: 'ScenesList', previous: 'ScenesPrevious', place: 'ScenesPlace', next: 'ScenesNext' }),
            Questions: Object.freeze({
                list: 'QuestionsList',
                previous: 'QuestionsPrevious',
                place: 'QuestionsPlace',
                next: 'QuestionsNext',
            }),
            Aliases: Object.freeze({
                list: 'AliasesList',
                previous: 'AliasesPrevious',
                place: 'AliasesPlace',
                next: 'AliasesNext',
            }),
            Refinements: Object.freeze({
                list: 'RefinementsList',
                previous: 'RefinementsPrevious',
                place: 'RefinementsPlace',
                next: 'RefinementsNext',
            }),
            Made: Object.freeze({ list: 'MadeList', previous: 'MadePrevious', place: 'MadePlace', next: 'MadeNext' }),
            Audit: Object.freeze({ list: 'AuditList', previous: 'AuditPrevious', place: 'AuditPlace', next: 'AuditNext' }),
        }),
        Setup: Object.freeze(['Campaign', 'Model', 'Size', 'Stop', 'Budget']),
        Checked: Object.freeze({
            Key: 'KeyProblem',
            Model: 'ModelProblem',
            Size: 'SizeProblem',
            Stop: 'StopProblem',
            Budget: 'BudgetProblem',
        }),
        RulingControls: Object.freeze([
            'AddCategory',
            'AddTarget',
            'AddText',
            'AddHidden',
            'AddFile',
            'SplitLabel',
            'SplitKind',
            'SplitFile',
            'KeepFirst',
        ]),
        Defaults: Object.freeze({
            Model: 'mistralai/mistral-large-4-0',
            Size: '40',
            Budget: '3',
            Seed: 1,
        }),
        PrivatePath: '/private/',
        CampaignPrefix: 'campaign-',
        LogPrefix: 'log-',
        CallsPrefix: 'calls-',
        UnreadablePart: 'unreadable-',
        FocusTags: Object.freeze(['BUTTON', 'INPUT', 'SELECT']),
        Sections: Object.freeze({
            Subjects: 'subjects',
            Facts: 'facts',
            Conflicts: 'conflicts',
            Likes: 'likes',
            Scenes: 'scenes',
            Questions: 'questions',
            Aliases: 'aliases',
            Made: 'made',
            Audit: 'audit',
        }),
        Roles: Object.freeze({
            Open: 'open',
            Tick: 'tick',
            Remove: 'remove',
            Public: 'public',
            Value: 'value',
            Other: 'other',
            Hidden: 'hidden',
            Pin: 'pin',
            Keep: 'keep',
            Distinct: 'distinct',
            Merge: 'merge',
            Narrow: 'narrow',
            Text: 'text',
            Dismiss: 'dismiss',
            Answer: 'answer',
            Unalias: 'unalias',
            Revoke: 'revoke',
            Right: 'right',
            Wrong: 'wrong',
        }),
        AuditPrefix: 'audit-',
        JsonSuffix: '.json',
        Dash: '-',
        PostMethod: 'POST',
        JsonHeaders: Object.freeze({ 'Content-Type': 'application/json' }),
        Ok: 200,
        Missing: 404,
        MaxTokens: 8000,
        TimeoutMs: 180000,
        Attempts: 3,
        PauseMs: 10000,
        TickMs: 1000,
        MillisecondsPerSecond: 1000,
        FirstPage: 1,
        LeastCount: 1,
        NoPosition: 0,
        Last: -1,
        Nothing: '',
        True: 'true',
        Tags: Object.freeze({
            Item: 'li',
            List: 'ul',
            Paragraph: 'p',
            Span: 'span',
            Block: 'div',
            Quote: 'blockquote',
            Button: 'button',
            Input: 'input',
            Label: 'label',
            Select: 'select',
            Option: 'option',
            Details: 'details',
            Summary: 'summary',
        }),
        Classes: Object.freeze({
            Row: 'row',
            Empty: 'empty',
            Meta: 'meta',
            Problem: 'problem',
            Actions: 'actions',
            Choices: 'choices',
            Message: 'message',
            Ruling: 'ruling',
            Primary: 'primary',
            Danger: 'danger',
            Tick: 'tick',
            Field: 'field',
            Required: 'required',
        }),
        Attributes: Object.freeze({
            Type: 'type',
            Busy: 'aria-busy',
            Selected: 'aria-selected',
            Current: 'aria-current',
            Hidden: 'aria-hidden',
            Required: 'aria-required',
            Fact: 'data-fact',
            Key: 'data-key',
        }),
        InputTypes: Object.freeze({
            Button: 'button',
            Checkbox: 'checkbox',
            Text: 'text',
        }),
        Events: Object.freeze({
            Click: 'click',
            Change: 'change',
            Input: 'input',
            Focus: 'focus',
        }),
        Verdict: Object.freeze({
            Right: 'Right',
            Wrong: 'Wrong',
        }),
        Likeness: Object.freeze({
            Spelling: 'their names are spelled alike',
            SameName: 'they have the same name',
            Alias: 'one is called by the name of the other',
        }),
        Refusals: Object.freeze({
            InvalidOperation: 'The engine refused this: it is not a valid ruling here.',
            Reference: 'The engine refused this: it names something the book does not hold.',
            Ambiguous: 'The engine refused this: that name already belongs to a subject or could mean more than one.',
            StaleState: 'The engine refused this: the book changed underneath it. Try again.',
            UnknownOperation: 'The engine refused this: it does not know this kind of ruling.',
        }),
        Words: Object.freeze({
            MissingElement: 'The page markup has no element with the id ',
            LoadingList: 'Loading the list of campaigns...',
            ListFailed: 'The list of campaigns could not be read: ',
            NotAList: 'the server did not send a list of names',
            NoCampaign:
                'No campaign in scribe/private/: copy an export there under a name beginning campaign- and ending .json.',
            ChooseCampaign: 'Choose a campaign.',
            Placeholder: 'Choose a campaign',
            Loading: 'Loading ',
            Ellipsis: '...',
            NotFound: 'the file is not there',
            NotExport: 'it is not an export with a list of messages',
            CannotUse: ' cannot be used: ',
            SavedBookOpen: 'A saved book exists: ',
            SavedBookOf: ' of ',
            SavedBookClose: ' messages read.',
            NoSavedBook: 'No saved book for this campaign yet: Start begins one.',
            BookUnreadable: 'The saved book could not be read: ',
            KeyMissing: 'Enter the OpenRouter key.',
            ModelMissing: 'Enter a model.',
            SizeWrong: 'Messages per stretch must be a whole number of at least 1.',
            StopWrong: 'Stop after message must be blank or a whole number of at least 1.',
            BudgetWrong: 'The budget must be a number of dollars, 0 or more.',
            FixFields: 'Nothing was started: a field above needs attention.',
            StartOver: 'Start a new book? It replaces the saved book for this campaign.',
            Running: 'Building the book.',
            SavingBook: 'Saving the book...',
            Pausing: 'Pausing after the stretch in flight.',
            Done: 'Done: every message is read.',
            DoneOpen: 'Done: every message up to #',
            DoneMiddle: ' is read; ',
            DoneOf: ' of ',
            DoneClose: ' in the campaign.',
            PausedAfter: 'Paused after #',
            PausedBefore: 'Paused before any message was read.',
            BudgetOpen: 'Stopped: the budget of ',
            BudgetClose: ' is spent.',
            Stopped: 'Stopped: ',
            UnpricedOpen: 'The budget could not count ',
            UnpricedClose: ' that carried no price.',
            Reloading: 'Reloading the saved book...',
            ReloadFailed: 'The saved book could not be reloaded: ',
            WaitingOpen: 'Waiting for the model on ',
            TheNotes: 'the notes',
            TheAnswers: 'the answers',
            Seconds: 's',
            CallNotSaved: 'The call record ',
            WasNotSaved: ' was not saved: ',
            HttpStatus: 'the server answered ',
            Unexpected: 'Something went wrong: ',
            Refused: 'Refused lines',
            Empty: 'None.',
            PageOpen: 'Page ',
            PageOf: ' of ',
            Rulings: 'Rulings',
            OtherNames: 'Other names: ',
            NoOtherNames: 'none',
            InForce: ' in force',
            RunningScene: ', in the running scene',
            KnownTo: 'known to ',
            HiddenMark: 'hidden',
            PinnedMark: 'pinned',
            EstablishedMark: 'established',
            SecondPerson: 'Belongs to the second person',
            Remove: 'Remove',
            MakePublic: 'Make public',
            RemoveOpen: 'Remove ',
            RemoveClose: ' from the book?',
            Added: 'Added ',
            SplitOpen: 'Move ',
            SplitMiddle: ' facts to a new subject named ',
            SplitClose: '?',
            SplitDone: 'Split: the new subject is ',
            Saving: 'Saving...',
            NotSaved: 'The ruling was not saved: ',
            Other: 'Other value',
            Required: ' *',
            PinOther: 'Pin this value',
            KeepLabel: 'Keep',
            TwoPeople: 'Two people',
            SamePerson: 'Same person',
            MergeOpen: 'Treat ',
            MergeKeeping: ' as one subject, keeping ',
            Question: '?',
            OnlyPresent: 'Only those present',
            AnswerLabel: 'Answer',
            Answer: 'Answer',
            Dismiss: 'Dismiss',
            AnsweredOpen: 'Answered: ',
            AnsweredClose: ' (will be filed on the next run)',
            NotSame: 'Not the same',
            JoinedTo: ' is a name of ',
            Becomes: ' becomes ',
            Revoke: 'Revoke',
            RevokeOpen: 'Revoke ruling ',
            RevokeGone: 'That ruling is already revoked.',
            NothingToKeep: 'No conflict has an established value to keep.',
            KeptOpen: 'Kept the first value for ',
            KeptClose: ' conflicts.',
            Day: 'Day ',
            Present: 'present: ',
            Right: 'Right',
            Wrong: 'Wrong',
            MarkedRight: 'Marked right',
            MarkedWrong: 'Marked wrong',
            TallyRight: ' right, ',
            TallyWrong: ' wrong, ',
            TallyToGo: ' to go',
            MessageGone: 'The cited message is gone.',
            SeedWrong: 'The seed must be a whole number of at least 0.',
            NoLongerInForce: 'no longer in force',
            SavingAudit: 'Saving the audit...',
            AuditSaved: 'Saved ',
            AuditNotSaved: 'The audit was not saved: ',
            Hash: '#',
            RangeTo: ' to #',
            Colon: ': ',
            Comma: ', ',
            And: ' and ',
            Joiner: ' | ',
            Open: ' (',
            Close: ')',
            Space: ' ',
            Dot: '. ',
            FullStop: '.',
        }),

        /**
         * @return {RegExp}
         */
        get WholeNumber() {
            return /^\d+$/;
        },

        /**
         * @return {RegExp}
         */
        get Decimal() {
            return /^(?:\d+(?:\.\d+)?|\.\d+)$/;
        },
    }),

    /**
     * @param {{ document: object, fetch: Function, setInterval: Function, clearInterval: Function, setTimeout: Function, confirm: Function, now: Function }} environment
     * @return {Readonly<{ idle: () => Promise<void> }>}
     * @throws {Error}
     */
    start(environment) {
        const settings = BenchPage.Settings;
        const elements = {};
        for (const [key, id] of Object.entries(settings.Ids)) {
            const element = environment.document.getElementById(id);
            if (element === null) {
                throw new Error(settings.Words.MissingElement + id);
            }
            elements[key] = element;
        }
        const pages = {};
        for (const parts of Object.values(settings.Lists)) {
            pages[parts.list] = settings.FirstPage;
        }
        const page = {
            environment,
            elements,
            room: null,
            campaign: null,
            order: [],
            book: null,
            saved: false,
            choice: 0,
            running: false,
            loading: false,
            reloading: false,
            saving: false,
            pausing: false,
            failedSave: false,
            held: null,
            spent: 0,
            tab: settings.FirstTab,
            pages,
            query: settings.Nothing,
            chosen: null,
            ticks: new Set(),
            lines: [],
            seed: settings.Defaults.Seed,
            audit: null,
            verdicts: new Map(),
            controls: [],
            fields: [],
            keyed: new Map(),
            typed: new Map(),
            lastKey: null,
            pending: new Set(),
        };
        elements.Model.value = settings.Defaults.Model;
        elements.Size.value = settings.Defaults.Size;
        elements.Budget.value = settings.Defaults.Budget;
        elements.AuditSeed.value = String(settings.Defaults.Seed);
        BenchPage.fill(page);
        BenchPage.wire(page);
        BenchPage.draw(page);
        BenchPage.track(page, BenchPage.list(page));
        return Object.freeze({
            /**
             * @return {Promise<void>}
             */
            idle: async () => {
                while (page.pending.size > 0) {
                    await Promise.allSettled([...page.pending]);
                }
            },
        });
    },

    /**
     * @param {object} page
     * @param {Promise<*>} task
     * @return {void}
     */
    track(page, task) {
        page.pending.add(task);
        task.then(
            /**
             * @return {void}
             */
            () => {
                page.pending.delete(task);
            },
            /**
             * @param {*} error
             * @return {void}
             */
            (error) => {
                page.pending.delete(task);
                BenchPage.say(page, BenchPage.Settings.Words.Unexpected + BenchPage.reason(error));
            },
        );
    },

    /**
     * @param {object} page
     * @param {object} element
     * @param {string} type
     * @param {() => Promise<*>} act
     * @return {void}
     */
    listen(page, element, type, act) {
        element.addEventListener(
            type,
            /**
             * @return {void}
             */
            () => {
                BenchPage.track(page, act());
            },
        );
    },

    /**
     * @param {*} error
     * @return {string}
     */
    reason(error) {
        const described = error !== null && typeof error === 'object' && typeof error.message === 'string';
        return described ? error.message : String(error);
    },

    /**
     * @param {*} error
     * @return {string}
     */
    refusal(error) {
        const refusals = BenchPage.Settings.Refusals;
        const message = BenchPage.reason(error);
        return Object.hasOwn(refusals, message) ? refusals[message] : message;
    },

    /**
     * @param {object} page
     * @param {string} text
     * @return {void}
     */
    say(page, text) {
        page.elements.Status.textContent = text;
    },

    /**
     * @param {object} log
     * @return {object}
     */
    copy(log) {
        return JSON.parse(JSON.stringify(log));
    },

    /**
     * @param {object} page
     * @param {object} log
     * @return {object}
     */
    replay(page, log) {
        return ScribeReplay.run(log, page.order);
    },

    /**
     * @param {object} page
     * @return {string}
     */
    logName(page) {
        const settings = BenchPage.Settings;
        return settings.LogPrefix + page.room + settings.JsonSuffix;
    },

    /**
     * @param {object} page
     * @param {string} name
     * @return {Promise<string|null>}
     * @throws {Error}
     */
    async load(page, name) {
        const settings = BenchPage.Settings;
        const response = await page.environment.fetch(settings.PrivatePath + name);
        if (response.status === settings.Missing) {
            return null;
        }
        if (response.status !== settings.Ok) {
            throw new Error(settings.Words.HttpStatus + response.status);
        }
        return response.text();
    },

    /**
     * @param {object} page
     * @param {string} name
     * @param {string} body
     * @return {Promise<void>}
     * @throws {Error}
     */
    async post(page, name, body) {
        const settings = BenchPage.Settings;
        const response = await page.environment.fetch(settings.PrivatePath + name, {
            method: settings.PostMethod,
            headers: settings.JsonHeaders,
            body,
        });
        if (response.status !== settings.Ok) {
            throw new Error(settings.Words.HttpStatus + response.status);
        }
    },

    /**
     * @param {string} text
     * @return {number|null}
     */
    whole(text) {
        const trimmed = text.trim();
        if (!BenchPage.Settings.WholeNumber.test(trimmed)) {
            return null;
        }
        const number = Number(trimmed);
        return Number.isSafeInteger(number) ? number : null;
    },

    /**
     * @param {object} page
     * @param {object} log
     * @return {object|null}
     */
    lastRead(page, log) {
        let last = null;
        for (const message of page.campaign.messages) {
            if (Object.hasOwn(log.read, message.id)) {
                last = message;
            }
        }
        return last;
    },

    /**
     * @param {object} page
     * @param {object} select
     * @param {Array<[string, string]>} pairs
     * @param {string} chosen
     * @return {void}
     */
    options(page, select, pairs, chosen) {
        const settings = BenchPage.Settings;
        select.replaceChildren(
            ...pairs.map(
                /**
                 * @param {[string, string]} pair
                 * @return {object}
                 */
                ([value, text]) => {
                    const option = BenchPage.make(page, settings.Tags.Option, text);
                    option.value = value;
                    return option;
                },
            ),
        );
        select.value = chosen;
    },

    /**
     * @param {object} page
     * @return {void}
     */
    fill(page) {
        const elements = page.elements;
        const categories = [];
        for (const [kind, words] of Object.entries(ScribeCategory.Settings.Words)) {
            if (kind !== ScribeCategory.Kind.Fixed) {
                categories.push(...words);
            }
        }
        categories.push(ScribeCategory.Settings.RelationCategory);
        BenchPage.options(
            page,
            elements.AddCategory,
            categories.map(
                /**
                 * @param {string} category
                 * @return {[string, string]}
                 */
                (category) => [category, category],
            ),
            categories[0],
        );
        const kinds = Object.values(ScribeCategory.SubjectKinds);
        BenchPage.options(
            page,
            elements.SplitKind,
            kinds.map(
                /**
                 * @param {string} kind
                 * @return {[string, string]}
                 */
                (kind) => [kind, kind],
            ),
            kinds[0],
        );
        elements.AddTargetField.hidden = true;
    },

    /**
     * @param {object} page
     * @return {void}
     */
    wire(page) {
        const settings = BenchPage.Settings;
        const events = settings.Events;
        const elements = page.elements;
        for (const element of Object.values(elements)) {
            if (settings.FocusTags.includes(element.tagName)) {
                element.addEventListener(
                    events.Focus,
                    /**
                     * @return {void}
                     */
                    () => {
                        page.lastKey = null;
                    },
                );
            }
        }
        BenchPage.listen(
            page,
            elements.Campaign,
            events.Change,
            /**
             * @return {Promise<void>}
             */
            () => BenchPage.choose(page),
        );
        BenchPage.listen(
            page,
            elements.Start,
            events.Click,
            /**
             * @return {Promise<void>}
             */
            () => BenchPage.begin(page, true),
        );
        BenchPage.listen(
            page,
            elements.Continue,
            events.Click,
            /**
             * @return {Promise<void>}
             */
            () => BenchPage.begin(page, false),
        );
        BenchPage.listen(
            page,
            elements.Pause,
            events.Click,
            /**
             * @return {Promise<void>}
             */
            async () => {
                page.pausing = true;
                BenchPage.say(page, settings.Words.Pausing);
                BenchPage.lock(page);
            },
        );
        for (const [name, tab] of Object.entries(settings.Tabs)) {
            BenchPage.listen(
                page,
                elements[tab.tab],
                events.Click,
                /**
                 * @return {Promise<void>}
                 */
                async () => {
                    page.tab = name;
                    BenchPage.draw(page);
                },
            );
        }
        for (const parts of Object.values(settings.Lists)) {
            BenchPage.listen(
                page,
                elements[parts.previous],
                events.Click,
                /**
                 * @return {Promise<void>}
                 */
                async () => {
                    page.pages[parts.list]--;
                    BenchPage.draw(page);
                },
            );
            BenchPage.listen(
                page,
                elements[parts.next],
                events.Click,
                /**
                 * @return {Promise<void>}
                 */
                async () => {
                    page.pages[parts.list]++;
                    BenchPage.draw(page);
                },
            );
        }
        BenchPage.listen(
            page,
            elements.Search,
            events.Input,
            /**
             * @return {Promise<void>}
             */
            async () => {
                page.query = elements.Search.value;
                page.pages[settings.Lists.Subjects.list] = settings.FirstPage;
                BenchPage.draw(page);
            },
        );
        BenchPage.listen(
            page,
            elements.AddCategory,
            events.Change,
            /**
             * @return {Promise<void>}
             */
            async () => {
                elements.AddTargetField.hidden = elements.AddCategory.value !== ScribeCategory.Settings.RelationCategory;
            },
        );
        BenchPage.listen(
            page,
            elements.AddFile,
            events.Click,
            /**
             * @return {Promise<void>}
             */
            () => BenchPage.addFact(page),
        );
        BenchPage.listen(
            page,
            elements.SplitFile,
            events.Click,
            /**
             * @return {Promise<void>}
             */
            () => BenchPage.split(page),
        );
        BenchPage.listen(
            page,
            elements.KeepFirst,
            events.Click,
            /**
             * @return {Promise<boolean>}
             */
            () => BenchPage.keepFirst(page),
        );
        BenchPage.listen(
            page,
            elements.AuditDraw,
            events.Click,
            /**
             * @return {Promise<void>}
             */
            () => BenchPage.reseed(page),
        );
        BenchPage.listen(
            page,
            elements.AuditSeed,
            events.Change,
            /**
             * @return {Promise<void>}
             */
            () => BenchPage.reseed(page),
        );
        BenchPage.listen(
            page,
            elements.AuditSave,
            events.Click,
            /**
             * @return {Promise<void>}
             */
            () => BenchPage.saveAudit(page),
        );
    },

    /**
     * @param {object} page
     * @return {Promise<void>}
     */
    async list(page) {
        const settings = BenchPage.Settings;
        const words = settings.Words;
        page.loading = true;
        BenchPage.say(page, words.LoadingList);
        BenchPage.lock(page);
        let names = [];
        try {
            const listed = JSON.parse(await BenchPage.load(page, settings.Nothing));
            if (!Array.isArray(listed)) {
                throw new Error(words.NotAList);
            }
            names = listed.filter(
                /**
                 * @param {*} name
                 * @return {boolean}
                 */
                (name) =>
                    typeof name === 'string' &&
                    name.startsWith(settings.CampaignPrefix) &&
                    name.endsWith(settings.JsonSuffix) &&
                    name.length > settings.CampaignPrefix.length + settings.JsonSuffix.length,
            );
        } catch (error) {
            page.loading = false;
            BenchPage.say(page, words.ListFailed + BenchPage.reason(error));
            BenchPage.lock(page);
            return;
        }
        const pairs = names.map(
            /**
             * @param {string} name
             * @return {[string, string]}
             */
            (name) => [name, name],
        );
        BenchPage.options(page, page.elements.Campaign, [[settings.Nothing, words.Placeholder], ...pairs], settings.Nothing);
        page.loading = false;
        BenchPage.say(page, names.length === 0 ? words.NoCampaign : words.ChooseCampaign);
        BenchPage.lock(page);
    },

    /**
     * @param {object} page
     * @return {Promise<void>}
     */
    async choose(page) {
        const settings = BenchPage.Settings;
        const words = settings.Words;
        const name = page.elements.Campaign.value;
        page.choice++;
        const choice = page.choice;
        page.room = null;
        page.campaign = null;
        page.order = [];
        page.book = null;
        page.saved = false;
        BenchPage.clean(page);
        if (name === settings.Nothing) {
            page.loading = false;
            BenchPage.say(page, words.ChooseCampaign);
            BenchPage.draw(page);
            return;
        }
        page.loading = true;
        BenchPage.say(page, words.Loading + name + words.Ellipsis);
        BenchPage.lock(page);
        let campaign = null;
        try {
            const text = await BenchPage.load(page, name);
            if (page.choice !== choice) {
                return;
            }
            if (text === null) {
                throw new Error(words.NotFound);
            }
            const exported = JSON.parse(text);
            if (exported === null || typeof exported !== 'object' || !Array.isArray(exported.messages)) {
                throw new Error(words.NotExport);
            }
            campaign = ScribeIntake.read(exported.messages);
        } catch (error) {
            if (page.choice !== choice) {
                return;
            }
            page.loading = false;
            BenchPage.say(page, name + words.CannotUse + BenchPage.reason(error));
            BenchPage.draw(page);
            return;
        }
        const room = name.slice(settings.CampaignPrefix.length, name.length - settings.JsonSuffix.length);
        const order = campaign.messages.map(
            /**
             * @param {{ id: string }} message
             * @return {string}
             */
            (message) => message.id,
        );
        let book = null;
        let saved = true;
        let line = words.NoSavedBook;
        try {
            const text = await BenchPage.load(page, settings.LogPrefix + room + settings.JsonSuffix);
            if (page.choice !== choice) {
                return;
            }
            saved = text !== null;
            if (saved) {
                book = JSON.parse(text);
                ScribeReplay.run(book, order);
                const read = campaign.messages.filter(
                    /**
                     * @param {{ id: string }} message
                     * @return {boolean}
                     */
                    (message) => Object.hasOwn(book.read, message.id),
                ).length;
                line =
                    words.SavedBookOpen +
                    BenchView.count(read) +
                    words.SavedBookOf +
                    BenchView.count(campaign.messages.length) +
                    words.SavedBookClose;
            }
        } catch (error) {
            if (page.choice !== choice) {
                return;
            }
            book = null;
            saved = true;
            line = words.BookUnreadable + BenchPage.reason(error);
        }
        page.room = room;
        page.campaign = campaign;
        page.order = order;
        page.book = book;
        page.saved = saved;
        page.loading = false;
        BenchPage.say(page, line);
        BenchPage.draw(page);
    },

    /**
     * @param {object} page
     * @return {void}
     */
    clean(page) {
        page.chosen = null;
        page.ticks.clear();
        page.verdicts.clear();
        page.audit = null;
        page.lines = [];
        page.spent = 0;
        page.typed.clear();
    },

    /**
     * @param {object} page
     * @return {{ model: string, size: number|null, stop: number|null, budget: number, problems: Map<string, string> }}
     */
    form(page) {
        const settings = BenchPage.Settings;
        const words = settings.Words;
        const checked = settings.Checked;
        const elements = page.elements;
        const problems = new Map();
        if (elements.Key.value.trim() === settings.Nothing) {
            problems.set(checked.Key, words.KeyMissing);
        }
        const model = elements.Model.value.trim();
        if (model === settings.Nothing) {
            problems.set(checked.Model, words.ModelMissing);
        }
        const size = BenchPage.whole(elements.Size.value);
        if (size === null || size < settings.LeastCount) {
            problems.set(checked.Size, words.SizeWrong);
        }
        const stopText = elements.Stop.value.trim();
        const stop = BenchPage.whole(stopText);
        if (stopText !== settings.Nothing && (stop === null || stop < settings.LeastCount)) {
            problems.set(checked.Stop, words.StopWrong);
        }
        const budgetText = elements.Budget.value.trim();
        const budget = Number(budgetText);
        if (!settings.Decimal.test(budgetText) || !Number.isFinite(budget)) {
            problems.set(checked.Budget, words.BudgetWrong);
        }
        return { model, size, stop, budget, problems };
    },

    /**
     * @param {object} page
     * @param {boolean} fresh
     * @return {Promise<void>}
     */
    async begin(page, fresh) {
        const settings = BenchPage.Settings;
        const words = settings.Words;
        const form = BenchPage.form(page);
        for (const problem of Object.values(settings.Checked)) {
            page.elements[problem].textContent = form.problems.get(problem) ?? settings.Nothing;
        }
        if (form.problems.size > 0) {
            BenchPage.say(page, words.FixFields);
            return;
        }
        if (fresh && page.saved && !page.environment.confirm(words.StartOver)) {
            return;
        }
        const campaign = page.campaign;
        const cut = form.stop !== null && form.stop < campaign.messages.length;
        const messages = cut
            ? campaign.messages.filter(
                  /**
                   * @param {{ position: number }} message
                   * @return {boolean}
                   */
                  (message) => message.position <= form.stop,
              )
            : campaign.messages;
        const log = fresh ? ScribeLog.create() : BenchPage.copy(page.book);
        const run = { choice: page.choice, room: page.room, stop: cut ? form.stop : null };
        if (fresh) {
            BenchPage.clean(page);
        }
        page.running = true;
        page.pausing = false;
        page.failedSave = false;
        page.held = null;
        BenchPage.say(page, words.Running);
        BenchPage.draw(page);

        /**
         * @param {number} milliseconds
         * @return {Promise<void>}
         */
        const sleep = (milliseconds) =>
            new Promise(
                /**
                 * @param {Function} resolve
                 * @return {void}
                 */
                (resolve) => {
                    page.environment.setTimeout(resolve, milliseconds);
                },
            );
        const result = await ScribeAdoption.run({
            messages,
            notes: campaign.notes,
            player: campaign.player,
            log,
            size: form.size,
            budget: form.budget,
            spent: page.spent,
            /**
             * @param {string} system
             * @param {string} user
             * @return {Promise<{ text: string, cost: number|null }>}
             */
            ask: (system, user) =>
                BenchPage.ask(page, { system, user, model: form.model, sleep, log, messages, size: form.size }),
            /**
             * @param {object} kept
             * @return {Promise<void>}
             */
            save: (kept) => BenchPage.saveBook(page, kept, run),
            /**
             * @param {object} item
             * @return {Promise<void>}
             */
            record: async (item) => {
                page.held = item;
            },
            /**
             * @param {object} report
             * @return {Promise<void>}
             */
            progress: (report) => BenchPage.report(page, report, run),
            /**
             * @return {boolean}
             */
            paused: () => page.pausing || page.choice !== run.choice,
        });
        page.running = false;
        page.pausing = false;
        page.held = null;
        if (page.choice !== run.choice) {
            BenchPage.draw(page);
            return;
        }
        page.spent = result.spent;
        const outcome = BenchPage.stopped(page, result, form.budget, run);
        page.lines.unshift({ text: outcome, refused: [] });
        BenchPage.say(page, outcome);
        if (result.stop === ScribeAdoption.Stop.Failed && page.failedSave) {
            await BenchPage.reload(page, outcome, run);
        }
        BenchPage.draw(page);
    },

    /**
     * @param {object} page
     * @param {{ system: string, user: string, model: string, sleep: Function, log: object, messages: readonly object[], size: number }} call
     * @return {Promise<{ text: string, cost: number|null }>}
     * @throws {Error}
     */
    async ask(page, call) {
        const settings = BenchPage.Settings;
        const words = settings.Words;
        const environment = page.environment;
        let where = words.TheAnswers;
        if (call.system === ScribeAnalyzer.Prompt) {
            const stretch = ScribeAdoption.next(call.log, call.messages, call.size);
            where = words.Hash + stretch[0].position + words.RangeTo + stretch.at(settings.Last).position;
        } else if (call.system === ScribeAnalyzer.NotesPrompt) {
            where = words.TheNotes;
        }
        const started = environment.now();
        BenchPage.tick(page, where, started);
        const timer = environment.setInterval(
            /**
             * @return {void}
             */
            () => {
                BenchPage.tick(page, where, started);
            },
            settings.TickMs,
        );
        try {
            const answer = await ScribeGateway.retry(
                /**
                 * @return {Promise<object>}
                 */
                () => {
                    const controller = new environment.AbortController();
                    return ScribeGateway.call({
                        fetch: environment.fetch,
                        key: page.elements.Key.value.trim(),
                        model: call.model,
                        system: call.system,
                        user: call.user,
                        maxTokens: settings.MaxTokens,
                        sleep: call.sleep,
                        timeoutMs: settings.TimeoutMs,
                        signal: controller.signal,
                    }).finally(
                        /**
                         * @return {void}
                         */
                        () => {
                            controller.abort();
                        },
                    );
                },
                { attempts: settings.Attempts, pauseMs: settings.PauseMs, sleep: call.sleep },
            );
            return { text: answer.text, cost: answer.cost };
        } finally {
            environment.clearInterval(timer);
            page.elements.Waiting.hidden = true;
            page.elements.Waiting.textContent = settings.Nothing;
        }
    },

    /**
     * @param {object} page
     * @param {string} where
     * @param {number} started
     * @return {void}
     */
    tick(page, where, started) {
        const settings = BenchPage.Settings;
        const words = settings.Words;
        const seconds = Math.floor((page.environment.now() - started) / settings.MillisecondsPerSecond);
        page.elements.Waiting.textContent = words.WaitingOpen + where + words.Colon + seconds + words.Seconds;
        page.elements.Waiting.hidden = false;
    },

    /**
     * @param {object} page
     * @param {object} log
     * @param {{ choice: number, room: string, stop: number|null }} run
     * @return {Promise<void>}
     * @throws {Error}
     */
    async saveBook(page, log, run) {
        const settings = BenchPage.Settings;
        const words = settings.Words;
        const body = JSON.stringify(log);
        const current = page.choice === run.choice;
        if (current) {
            BenchPage.say(page, words.SavingBook);
        }
        try {
            await BenchPage.post(page, settings.LogPrefix + run.room + settings.JsonSuffix, body);
        } catch (error) {
            page.failedSave = true;
            throw error;
        }
        if (page.choice !== run.choice) {
            return;
        }
        page.book = JSON.parse(body);
        page.saved = true;
        BenchPage.say(page, page.pausing ? words.Pausing : words.Running);
    },

    /**
     * @param {object} page
     * @param {object} report
     * @param {{ choice: number, room: string, stop: number|null }} run
     * @return {Promise<void>}
     */
    async report(page, report, run) {
        const settings = BenchPage.Settings;
        const held = page.held;
        page.held = null;
        const refused = [
            ...report.refusedLines.map(
                /**
                 * @param {{ line: string, reason: string }} item
                 * @return {{ text: string, reason: string }}
                 */
                (item) => ({ text: item.line, reason: item.reason }),
            ),
            ...report.refusedOperations.map(
                /**
                 * @param {{ operation: object, reason: string }} item
                 * @return {{ text: string, reason: string }}
                 */
                (item) => {
                    const operation = item.operation;
                    const parts = [
                        operation.type,
                        operation.fact,
                        operation.label,
                        operation.name,
                        operation.category,
                        operation.text,
                    ];
                    const text = parts
                        .filter(
                            /**
                             * @param {*} part
                             * @return {boolean}
                             */
                            (part) => typeof part === 'string',
                        )
                        .join(settings.Words.Joiner);
                    return { text, reason: item.reason };
                },
            ),
        ];
        if (page.choice === run.choice) {
            page.lines.unshift({ text: BenchView.progress(report), refused });
            BenchPage.draw(page);
        }
        if (held === null) {
            return;
        }
        const number = held.readable ? held.sequence : settings.UnreadablePart + page.environment.now();
        const name = settings.CallsPrefix + run.room + settings.Dash + number + settings.JsonSuffix;
        const record = { ...held, refusedLines: report.refusedLines, refusedOperations: report.refusedOperations };
        try {
            await BenchPage.post(page, name, JSON.stringify(record));
        } catch (error) {
            if (page.choice !== run.choice) {
                return;
            }
            const words = settings.Words;
            page.lines.unshift({
                text: words.CallNotSaved + name + words.WasNotSaved + BenchPage.reason(error),
                refused: [],
            });
            BenchPage.draw(page);
        }
    },

    /**
     * @param {object} page
     * @param {{ stop: string, problem: string|null, unpriced: number }} result
     * @param {number} budget
     * @param {{ stop: number|null }} run
     * @return {string}
     */
    stopped(page, result, budget, run) {
        const settings = BenchPage.Settings;
        const words = settings.Words;
        const stops = ScribeAdoption.Stop;
        let reason = words.Stopped + result.problem;
        if (result.stop === stops.Done && run.stop === null) {
            reason = words.Done;
        } else if (result.stop === stops.Done) {
            const messages = page.campaign.messages;
            const read = messages.filter(
                /**
                 * @param {{ id: string }} message
                 * @return {boolean}
                 */
                (message) => Object.hasOwn(page.book.read, message.id),
            ).length;
            reason =
                words.DoneOpen +
                run.stop +
                words.DoneMiddle +
                BenchView.count(read) +
                words.DoneOf +
                BenchView.count(messages.length) +
                words.DoneClose;
        } else if (result.stop === stops.Paused) {
            const last = page.book === null ? null : BenchPage.lastRead(page, page.book);
            reason = last === null ? words.PausedBefore : words.PausedAfter + last.position + words.FullStop;
        } else if (result.stop === stops.Budget) {
            reason = words.BudgetOpen + BenchView.money(budget) + words.BudgetClose;
        }
        if (result.unpriced === 0) {
            return reason;
        }
        return reason + words.Space + words.UnpricedOpen + BenchView.calls(result.unpriced) + words.UnpricedClose;
    },

    /**
     * @param {object} page
     * @param {string} outcome
     * @param {{ choice: number, room: string }} run
     * @return {Promise<void>}
     */
    async reload(page, outcome, run) {
        const settings = BenchPage.Settings;
        const words = settings.Words;
        page.reloading = true;
        BenchPage.say(page, words.Reloading);
        BenchPage.lock(page);
        try {
            const saved = await BenchPage.load(page, settings.LogPrefix + run.room + settings.JsonSuffix);
            if (page.choice === run.choice) {
                page.book = saved === null ? null : JSON.parse(saved);
                page.saved = saved !== null;
                BenchPage.say(page, outcome);
            }
        } catch (error) {
            if (page.choice === run.choice) {
                BenchPage.say(page, outcome + words.Space + words.ReloadFailed + BenchPage.reason(error));
            }
        }
        page.reloading = false;
    },

    /**
     * @param {object} page
     * @return {void}
     */
    lock(page) {
        const settings = BenchPage.Settings;
        const elements = page.elements;
        const busy = page.running || page.loading || page.reloading || page.saving;
        elements.Start.disabled = busy || page.campaign === null;
        elements.Continue.disabled = busy || page.book === null;
        elements.Pause.disabled = !page.running || page.pausing;
        for (const key of settings.Setup) {
            elements[key].disabled = busy;
        }
        const ruled = busy || page.book === null;
        for (const key of settings.RulingControls) {
            elements[key].disabled = ruled;
        }
        for (const control of page.controls) {
            control.disabled = ruled;
        }
        elements.AuditSave.disabled = busy || page.room === null;
        elements.Status.setAttribute(settings.Attributes.Busy, String(busy));
    },

    /**
     * @param {object} page
     * @return {void}
     */
    draw(page) {
        const settings = BenchPage.Settings;
        const words = settings.Words;
        const elements = page.elements;
        const focused = BenchPage.remember(page);
        page.controls = [];
        page.fields = [];
        page.keyed = new Map();
        const log = page.book === null ? ScribeLog.create() : page.book;
        const state = BenchPage.replay(page, log);
        const blocking = BenchView.blocking(state);
        elements.TabRulings.textContent =
            blocking === 0 ? words.Rulings : words.Rulings + words.Open + blocking + words.Close;
        for (const [name, tab] of Object.entries(settings.Tabs)) {
            const open = name === page.tab;
            elements[tab.panel].hidden = !open;
            elements[tab.tab].setAttribute(settings.Attributes.Selected, String(open));
        }
        BenchPage.Drawers[page.tab](page, state, log);
        BenchPage.lock(page);
        BenchPage.restore(page, focused);
    },

    /**
     * @param {object} page
     * @return {string|null}
     */
    remember(page) {
        const attribute = BenchPage.Settings.Attributes.Key;
        for (const field of page.fields) {
            page.typed.set(field.getAttribute(attribute), { value: field.value, checked: field.checked });
        }
        const document = page.environment.document;
        const active = document.activeElement;
        if (active === null || active === document.body) {
            return page.lastKey;
        }
        return active.getAttribute(attribute);
    },

    /**
     * @param {object} page
     * @param {string|null} focused
     * @return {void}
     */
    restore(page, focused) {
        const settings = BenchPage.Settings;
        for (const field of page.fields) {
            const kept = page.typed.get(field.getAttribute(settings.Attributes.Key));
            if (kept === undefined) {
                continue;
            }
            if (field.type === settings.InputTypes.Checkbox) {
                field.checked = kept.checked;
            } else {
                field.value = kept.value;
            }
        }
        if (focused === null) {
            return;
        }
        const target = page.keyed.get(focused);
        if (target !== undefined && !target.disabled) {
            target.focus();
            return;
        }
        page.lastKey = null;
        page.elements[settings.Tabs[page.tab].heading].focus({ preventScroll: true });
    },

    /**
     * @param {...(string|number)} parts
     * @return {string}
     */
    key(...parts) {
        return JSON.stringify(parts);
    },

    /**
     * @param {object} page
     * @param {object} element
     * @param {string} key
     * @return {object}
     */
    keyed(page, element, key) {
        const settings = BenchPage.Settings;
        element.setAttribute(settings.Attributes.Key, key);
        page.keyed.set(key, element);
        for (const type of [settings.Events.Focus, settings.Events.Click]) {
            element.addEventListener(
                type,
                /**
                 * @return {void}
                 */
                () => {
                    page.lastKey = key;
                },
            );
        }
        return element;
    },

    /**
     * @param {object} page
     * @param {{ list: string, previous: string, place: string, next: string }} parts
     * @param {readonly object[]} items
     * @param {(row: object) => object} build
     * @return {void}
     */
    paged(page, parts, items, build) {
        BenchPage.show(page, parts, BenchView.page(items, page.pages[parts.list]), build);
    },

    /**
     * @param {object} page
     * @param {{ list: string, previous: string, place: string, next: string }} parts
     * @param {{ rows: object[], pages: number }} result
     * @param {(row: object) => object} build
     * @return {void}
     */
    show(page, parts, result, build) {
        const settings = BenchPage.Settings;
        const words = settings.Words;
        const elements = page.elements;
        const current = BenchView.clamp(page.pages[parts.list], result.pages);
        page.pages[parts.list] = current;
        const rows = result.rows.map(build);
        if (rows.length === 0) {
            rows.push(BenchPage.make(page, settings.Tags.Item, words.Empty, settings.Classes.Empty));
        }
        elements[parts.list].replaceChildren(...rows);
        elements[parts.previous].disabled = current <= settings.FirstPage;
        elements[parts.next].disabled = current >= result.pages;
        elements[parts.place].textContent = words.PageOpen + current + words.PageOf + result.pages;
    },

    /**
     * @param {object} page
     * @param {string} tag
     * @param {string} text
     * @param {...string} classes
     * @return {object}
     */
    make(page, tag, text, ...classes) {
        const element = page.environment.document.createElement(tag);
        element.textContent = text;
        if (classes.length > 0) {
            element.classList.add(...classes);
        }
        return element;
    },

    /**
     * @param {object} page
     * @param {object} element
     * @return {object}
     */
    control(page, element) {
        element.classList.add(BenchPage.Settings.Classes.Ruling);
        page.controls.push(element);
        return element;
    },

    /**
     * @param {object} page
     * @param {string} text
     * @param {() => Promise<*>} act
     * @param {boolean} ruled
     * @param {string} key
     * @param {...string} classes
     * @return {object}
     */
    button(page, text, act, ruled, key, ...classes) {
        const settings = BenchPage.Settings;
        const button = BenchPage.make(page, settings.Tags.Button, text, ...classes);
        button.setAttribute(settings.Attributes.Type, settings.InputTypes.Button);
        BenchPage.keyed(page, button, key);
        BenchPage.listen(page, button, settings.Events.Click, act);
        return ruled ? BenchPage.control(page, button) : button;
    },

    /**
     * @param {object} page
     * @param {string} type
     * @param {string} text
     * @param {string} key
     * @param {boolean} kept
     * @return {{ label: object, input: object }}
     */
    field(page, type, text, key, kept) {
        const settings = BenchPage.Settings;
        const tick = type === settings.InputTypes.Checkbox;
        const label = BenchPage.make(
            page,
            settings.Tags.Label,
            settings.Nothing,
            tick ? settings.Classes.Tick : settings.Classes.Field,
        );
        const input = BenchPage.make(page, settings.Tags.Input, settings.Nothing);
        input.setAttribute(settings.Attributes.Type, type);
        BenchPage.keyed(page, input, key);
        BenchPage.control(page, input);
        if (kept) {
            page.fields.push(input);
        }
        const caption = BenchPage.make(page, settings.Tags.Span, text);
        if (tick) {
            label.append(input, caption);
            return { label, input };
        }
        const marker = BenchPage.make(page, settings.Tags.Span, settings.Words.Required, settings.Classes.Required);
        marker.setAttribute(settings.Attributes.Hidden, settings.True);
        input.setAttribute(settings.Attributes.Required, settings.True);
        caption.append(marker);
        label.append(caption, input);
        return { label, input };
    },

    /**
     * @param {object} page
     * @param {object} outcome
     * @param {(log: object, state: object) => string} apply
     * @param {string|null} question
     * @return {Promise<boolean>}
     */
    async ruling(page, outcome, apply, question) {
        const settings = BenchPage.Settings;
        const words = settings.Words;
        const choice = page.choice;
        const name = BenchPage.logName(page);
        const log = BenchPage.copy(page.book);
        let done = null;
        try {
            done = apply(log, BenchPage.replay(page, log));
        } catch (error) {
            outcome.textContent = BenchPage.refusal(error);
            return false;
        }
        if (question !== null && !page.environment.confirm(question)) {
            outcome.textContent = settings.Nothing;
            return false;
        }
        const body = JSON.stringify(log);
        outcome.textContent = words.Saving;
        page.saving = true;
        BenchPage.lock(page);
        try {
            await BenchPage.post(page, name, body);
        } catch (error) {
            page.saving = false;
            BenchPage.lock(page);
            outcome.textContent = words.NotSaved + BenchPage.reason(error);
            return false;
        }
        page.saving = false;
        if (page.choice !== choice) {
            BenchPage.lock(page);
            return false;
        }
        page.book = JSON.parse(body);
        BenchPage.draw(page);
        outcome.textContent = done;
        return true;
    },

    /**
     * @param {object} operation
     * @return {(log: object, state: object) => string}
     */
    rule(operation) {
        return (
            /**
             * @param {object} log
             * @param {object} state
             * @return {string}
             */
            (log, state) => {
                ScribeLog.rule(log, state, operation);
                return BenchPage.Settings.Nothing;
            }
        );
    },

    /**
     * @param {object} page
     * @return {Promise<void>}
     */
    async addFact(page) {
        const settings = BenchPage.Settings;
        const words = settings.Words;
        const elements = page.elements;
        const relation = elements.AddCategory.value === ScribeCategory.Settings.RelationCategory;
        const anchor = BenchPage.lastRead(page, page.book);
        const operation = {
            type: ScribeLog.Ruling.AddFact,
            subject: page.chosen,
            category: elements.AddCategory.value,
            target: relation ? elements.AddTarget.value : null,
            text: elements.AddText.value.trim(),
            hidden: elements.AddHidden.checked,
            cite: anchor === null ? null : anchor.id,
            position: anchor === null ? settings.NoPosition : anchor.position,
        };
        const filed = await BenchPage.ruling(
            page,
            elements.AddOutcome,
            /**
             * @param {object} log
             * @param {object} state
             * @return {string}
             */
            (log, state) => words.Added + ScribeLog.rule(log, state, operation).operations[0].fact + words.FullStop,
            null,
        );
        if (filed) {
            elements.AddText.value = settings.Nothing;
            elements.AddHidden.checked = false;
        }
    },

    /**
     * @param {object} page
     * @return {Promise<void>}
     */
    async split(page) {
        const settings = BenchPage.Settings;
        const words = settings.Words;
        const elements = page.elements;
        const label = elements.SplitLabel.value.trim();
        const facts = [...page.ticks];
        const operation = {
            type: ScribeLog.Ruling.Split,
            subject: page.chosen,
            label,
            kind: elements.SplitKind.value,
            facts,
        };
        const filed = await BenchPage.ruling(
            page,
            elements.SplitOutcome,
            /**
             * @param {object} log
             * @param {object} state
             * @return {string}
             */
            (log, state) => words.SplitDone + ScribeLog.rule(log, state, operation).operations[0].becomes + words.FullStop,
            words.SplitOpen + facts.length + words.SplitMiddle + label + words.SplitClose,
        );
        if (filed) {
            page.ticks.clear();
            elements.SplitLabel.value = settings.Nothing;
        }
    },

    /**
     * @param {object} page
     * @return {Promise<boolean>}
     */
    keepFirst(page) {
        const words = BenchPage.Settings.Words;
        return BenchPage.ruling(
            page,
            page.elements.KeepOutcome,
            /**
             * @param {object} log
             * @param {object} state
             * @return {string}
             * @throws {Error}
             */
            (log, state) => {
                const entries = ScribeLog.keepFirst(log, state);
                if (entries.length === 0) {
                    throw new Error(words.NothingToKeep);
                }
                return words.KeptOpen + entries.length + words.KeptClose;
            },
            null,
        );
    },

    /**
     * @param {object} page
     * @param {object} state
     * @return {Array<{ fact: string, subject: string, category: string, text: string, position: number, message: string }>}
     */
    drawn(page, state) {
        if (page.audit === null || page.audit.length === 0) {
            page.audit = BenchView.audit(state, page.campaign === null ? [] : page.campaign.messages, page.seed);
        }
        return page.audit;
    },

    /**
     * @param {object} page
     * @param {ReadonlyArray<{ fact: string }>} items
     * @return {{ verdicts: Array<string|null>, right: number, wrong: number }}
     */
    judged(page, items) {
        const verdict = BenchPage.Settings.Verdict;
        const verdicts = items.map(
            /**
             * @param {{ fact: string }} item
             * @return {string|null}
             */
            (item) => page.verdicts.get(item.fact) ?? null,
        );
        return {
            verdicts,
            right: verdicts.filter(
                /**
                 * @param {string|null} given
                 * @return {boolean}
                 */
                (given) => given === verdict.Right,
            ).length,
            wrong: verdicts.filter(
                /**
                 * @param {string|null} given
                 * @return {boolean}
                 */
                (given) => given === verdict.Wrong,
            ).length,
        };
    },

    /**
     * @param {object} page
     * @return {Promise<void>}
     */
    async reseed(page) {
        const settings = BenchPage.Settings;
        const seed = BenchPage.whole(page.elements.AuditSeed.value);
        if (seed === null) {
            page.elements.AuditOutcome.textContent = settings.Words.SeedWrong;
            return;
        }
        page.seed = seed;
        page.audit = null;
        page.verdicts.clear();
        page.pages[settings.Lists.Audit.list] = settings.FirstPage;
        page.elements.AuditOutcome.textContent = settings.Nothing;
        BenchPage.draw(page);
    },

    /**
     * @param {object} page
     * @return {Promise<void>}
     */
    async saveAudit(page) {
        const settings = BenchPage.Settings;
        const words = settings.Words;
        const elements = page.elements;
        const items = BenchPage.drawn(page, BenchPage.replay(page, page.book === null ? ScribeLog.create() : page.book));
        const judged = BenchPage.judged(page, items);
        const audit = {
            room: page.room,
            seed: page.seed,
            drawn: items.length,
            right: judged.right,
            wrong: judged.wrong,
            items: items.map(
                /**
                 * @param {{ fact: string, subject: string, category: string, text: string, position: number }} item
                 * @param {number} index
                 * @return {object}
                 */
                (item, index) => ({
                    fact: item.fact,
                    subject: item.subject,
                    category: item.category,
                    text: item.text,
                    position: item.position,
                    verdict: judged.verdicts[index],
                }),
            ),
        };
        const choice = page.choice;
        const name = settings.AuditPrefix + page.room + settings.JsonSuffix;
        elements.AuditOutcome.textContent = words.SavingAudit;
        page.saving = true;
        BenchPage.lock(page);
        let outcome = words.AuditSaved + name + words.FullStop;
        try {
            await BenchPage.post(page, name, JSON.stringify(audit));
        } catch (error) {
            outcome = words.AuditNotSaved + BenchPage.reason(error);
        }
        page.saving = false;
        BenchPage.lock(page);
        if (page.choice === choice) {
            elements.AuditOutcome.textContent = outcome;
        }
    },

    Drawers: Object.freeze({
        /**
         * @param {object} page
         * @return {void}
         */
        Progress(page) {
            BenchPage.paged(
                page,
                BenchPage.Settings.Lists.Progress,
                page.lines,
                /**
                 * @param {{ text: string, refused: ReadonlyArray<{ text: string, reason: string }> }} line
                 * @return {object}
                 */
                (line) => BenchPage.Rows.line(page, line),
            );
        },

        /**
         * @param {object} page
         * @param {object} state
         * @return {void}
         */
        Book(page, state) {
            const settings = BenchPage.Settings;
            const words = settings.Words;
            const lists = settings.Lists;
            const elements = page.elements;
            BenchPage.show(
                page,
                lists.Subjects,
                BenchView.subjects(state, page.query, page.pages[lists.Subjects.list]),
                /**
                 * @param {object} row
                 * @return {object}
                 */
                (row) => BenchPage.Rows.subject(page, row),
            );
            const subject = page.chosen === null ? null : BenchView.subject(state, page.chosen);
            elements.Detail.hidden = subject === null;
            if (subject === null) {
                page.chosen = null;
                return;
            }
            page.chosen = subject.id;
            elements.Heading.textContent = subject.heading + words.Open + subject.kind + words.Close;
            elements.Names.textContent =
                words.OtherNames + (subject.aka.length === 0 ? words.NoOtherNames : subject.aka.join(words.Comma));
            BenchPage.paged(
                page,
                lists.Facts,
                subject.facts,
                /**
                 * @param {object} fact
                 * @return {object}
                 */
                (fact) => BenchPage.Rows.fact(page, fact),
            );
            const targets = state.subjects
                .filter(
                    /**
                     * @param {{ mergedInto: string|null }} candidate
                     * @return {boolean}
                     */
                    (candidate) => candidate.mergedInto === null,
                )
                .map(
                    /**
                     * @param {{ id: string, label: string }} candidate
                     * @return {[string, string]}
                     */
                    (candidate) => [candidate.id, candidate.label],
                );
            const current = elements.AddTarget.value;
            const kept = targets.some(
                /**
                 * @param {[string, string]} pair
                 * @return {boolean}
                 */
                ([id]) => id === current,
            );
            BenchPage.options(page, elements.AddTarget, targets, kept ? current : targets[0][0]);
        },

        /**
         * @param {object} page
         * @param {object} state
         * @return {void}
         */
        Timeline(page, state) {
            const parts = BenchPage.Settings.Lists.Timeline;
            BenchPage.show(
                page,
                parts,
                BenchView.timeline(state, page.pages[parts.list]),
                /**
                 * @param {object} row
                 * @return {object}
                 */
                (row) => BenchPage.Rows.scene(page, row, false),
            );
        },

        /**
         * @param {object} page
         * @param {object} state
         * @param {object} log
         * @return {void}
         */
        Rulings(page, state, log) {
            const lists = BenchPage.Settings.Lists;
            const rulings = BenchView.rulings(state);
            const rows = BenchPage.Rows;
            BenchPage.paged(
                page,
                lists.Conflicts,
                rulings.conflicts,
                /**
                 * @param {object} conflict
                 * @return {object}
                 */
                (conflict) => rows.conflict(page, conflict),
            );
            BenchPage.paged(
                page,
                lists.Likes,
                rulings.lookAlikes,
                /**
                 * @param {object} likeness
                 * @return {object}
                 */
                (likeness) => rows.likeness(page, likeness),
            );
            BenchPage.paged(
                page,
                lists.Scenes,
                rulings.publicScenes,
                /**
                 * @param {object} scene
                 * @return {object}
                 */
                (scene) => rows.scene(page, scene, true),
            );
            BenchPage.paged(
                page,
                lists.Questions,
                rulings.questions,
                /**
                 * @param {object} question
                 * @return {object}
                 */
                (question) => rows.question(page, question),
            );
            BenchPage.paged(
                page,
                lists.Aliases,
                rulings.aliases,
                /**
                 * @param {object} alias
                 * @return {object}
                 */
                (alias) => rows.alias(page, alias),
            );
            BenchPage.paged(
                page,
                lists.Refinements,
                rulings.refinements,
                /**
                 * @param {object} refinement
                 * @return {object}
                 */
                (refinement) => rows.refinement(page, refinement),
            );
            BenchPage.paged(
                page,
                lists.Made,
                BenchView.made(log),
                /**
                 * @param {object} made
                 * @return {object}
                 */
                (made) => rows.made(page, made),
            );
        },

        /**
         * @param {object} page
         * @param {object} state
         * @return {void}
         */
        Audit(page, state) {
            const words = BenchPage.Settings.Words;
            const items = BenchPage.drawn(page, state);
            const judged = BenchPage.judged(page, items);
            const left = items.length - judged.right - judged.wrong;
            page.elements.AuditTally.textContent =
                judged.right + words.TallyRight + judged.wrong + words.TallyWrong + left + words.TallyToGo;
            const standing = new Set();
            for (const fact of state.facts) {
                if (fact.status === ScribeReplay.Status.InForce && fact.origin === ScribeLog.Origin.Story) {
                    standing.add(fact.id);
                }
            }
            BenchPage.paged(
                page,
                BenchPage.Settings.Lists.Audit,
                items,
                /**
                 * @param {object} item
                 * @return {object}
                 */
                (item) => BenchPage.Rows.audit(page, item, standing.has(item.fact)),
            );
        },
    }),

    Rows: Object.freeze({
        /**
         * @param {object} page
         * @return {{ item: object, outcome: object, actions: object }}
         */
        frame(page) {
            const settings = BenchPage.Settings;
            const tags = settings.Tags;
            const classes = settings.Classes;
            return {
                item: BenchPage.make(page, tags.Item, settings.Nothing, classes.Row),
                outcome: BenchPage.make(page, tags.Paragraph, settings.Nothing, classes.Problem),
                actions: BenchPage.make(page, tags.Block, settings.Nothing, classes.Actions),
            };
        },

        /**
         * @param {object} page
         * @param {{ text: string, refused: ReadonlyArray<{ text: string, reason: string }> }} line
         * @return {object}
         */
        line(page, line) {
            const settings = BenchPage.Settings;
            const words = settings.Words;
            const tags = settings.Tags;
            const item = BenchPage.make(page, tags.Item, settings.Nothing, settings.Classes.Row);
            item.append(BenchPage.make(page, tags.Paragraph, line.text));
            if (line.refused.length > 0) {
                const details = BenchPage.make(page, tags.Details, settings.Nothing);
                const list = BenchPage.make(page, tags.List, settings.Nothing);
                list.append(
                    ...line.refused.map(
                        /**
                         * @param {{ text: string, reason: string }} refused
                         * @return {object}
                         */
                        (refused) =>
                            BenchPage.make(page, tags.Item, refused.text + words.Open + refused.reason + words.Close),
                    ),
                );
                details.append(BenchPage.make(page, tags.Summary, words.Refused), list);
                item.append(details);
            }
            return item;
        },

        /**
         * @param {object} page
         * @param {{ id: string, label: string, kind: string, facts: number, present: boolean }} row
         * @return {object}
         */
        subject(page, row) {
            const settings = BenchPage.Settings;
            const words = settings.Words;
            const item = BenchPage.make(page, settings.Tags.Item, settings.Nothing, settings.Classes.Row);
            const choose = BenchPage.button(
                page,
                row.label,
                /**
                 * @return {Promise<void>}
                 */
                async () => {
                    page.chosen = row.id;
                    page.pages[settings.Lists.Facts.list] = settings.FirstPage;
                    page.ticks.clear();
                    page.elements.AddOutcome.textContent = settings.Nothing;
                    page.elements.SplitOutcome.textContent = settings.Nothing;
                    BenchPage.draw(page);
                },
                false,
                BenchPage.key(settings.Sections.Subjects, row.id, settings.Roles.Open),
            );
            if (row.id === page.chosen) {
                choose.setAttribute(settings.Attributes.Current, settings.True);
            }
            const meta = row.kind + words.Comma + row.facts + words.InForce + (row.present ? words.RunningScene : settings.Nothing);
            item.append(choose, BenchPage.make(page, settings.Tags.Span, words.Space + meta, settings.Classes.Meta));
            return item;
        },

        /**
         * @param {object} page
         * @param {{ id: string, category: string, text: string, source: string, status: string, audience: string, hidden: boolean, pinned: boolean }} fact
         * @return {object}
         */
        fact(page, fact) {
            const settings = BenchPage.Settings;
            const words = settings.Words;
            const roles = settings.Roles;
            const section = settings.Sections.Facts;
            const ruling = ScribeLog.Ruling;
            const { item, outcome, actions } = BenchPage.Rows.frame(page);
            item.setAttribute(settings.Attributes.Fact, fact.id);
            const parts = [fact.id, fact.category, fact.text, fact.source, fact.status, words.KnownTo + fact.audience];
            if (fact.hidden) {
                parts.push(words.HiddenMark);
            }
            if (fact.pinned) {
                parts.push(words.PinnedMark);
            }
            const tick = BenchPage.field(
                page,
                settings.InputTypes.Checkbox,
                words.SecondPerson,
                BenchPage.key(section, fact.id, roles.Tick),
                false,
            );
            tick.input.checked = page.ticks.has(fact.id);
            BenchPage.listen(
                page,
                tick.input,
                settings.Events.Change,
                /**
                 * @return {Promise<void>}
                 */
                async () => {
                    if (tick.input.checked) {
                        page.ticks.add(fact.id);
                    } else {
                        page.ticks.delete(fact.id);
                    }
                },
            );
            actions.append(
                BenchPage.button(
                    page,
                    words.Remove,
                    /**
                     * @return {Promise<boolean>}
                     */
                    () =>
                        BenchPage.ruling(
                            page,
                            outcome,
                            BenchPage.rule({ type: ruling.RemoveFact, fact: fact.id }),
                            words.RemoveOpen + fact.id + words.Open + fact.text + words.Close + words.RemoveClose,
                        ),
                    true,
                    BenchPage.key(section, fact.id, roles.Remove),
                    settings.Classes.Danger,
                ),
                BenchPage.button(
                    page,
                    words.MakePublic,
                    /**
                     * @return {Promise<boolean>}
                     */
                    () =>
                        BenchPage.ruling(
                            page,
                            outcome,
                            BenchPage.rule({ type: ruling.Widen, fact: fact.id, to: ScribeKnowledge.Everyone }),
                            null,
                        ),
                    true,
                    BenchPage.key(section, fact.id, roles.Public),
                ),
            );
            item.append(BenchPage.make(page, settings.Tags.Paragraph, parts.join(words.Joiner)), tick.label, actions, outcome);
            return item;
        },

        /**
         * @param {object} page
         * @param {{ id: string, day: number, range: string, place: string, reach: string, present: string, summary: string }} row
         * @param {boolean} narrowing
         * @return {object}
         */
        scene(page, row, narrowing) {
            const settings = BenchPage.Settings;
            const words = settings.Words;
            const { item, outcome, actions } = BenchPage.Rows.frame(page);
            const text = [words.Day + row.day, row.range, row.place, row.reach, words.Present + row.present, row.summary];
            item.append(BenchPage.make(page, settings.Tags.Paragraph, text.join(words.Joiner)));
            if (narrowing) {
                actions.append(
                    BenchPage.button(
                        page,
                        words.OnlyPresent,
                        /**
                         * @return {Promise<boolean>}
                         */
                        () =>
                            BenchPage.ruling(
                                page,
                                outcome,
                                BenchPage.rule({ type: ScribeLog.Ruling.Narrow, scene: row.id }),
                                null,
                            ),
                        true,
                        BenchPage.key(settings.Sections.Scenes, row.id, settings.Roles.Narrow),
                    ),
                );
                item.append(actions, outcome);
            }
            return item;
        },

        /**
         * @param {object} page
         * @param {{ subject: string, label: string, category: string, values: ReadonlyArray<{ fact: string, text: string, source: string, hidden: boolean, established: boolean }> }} conflict
         * @return {object}
         */
        conflict(page, conflict) {
            const settings = BenchPage.Settings;
            const words = settings.Words;
            const roles = settings.Roles;
            const section = settings.Sections.Conflicts;
            const { item, outcome, actions } = BenchPage.Rows.frame(page);

            /**
             * @param {string} role
             * @param {...string} more
             * @return {string}
             */
            const key = (role, ...more) => BenchPage.key(section, conflict.subject, conflict.category, role, ...more);

            /**
             * @param {string} text
             * @param {boolean} hidden
             * @return {Promise<boolean>}
             */
            const pin = (text, hidden) =>
                BenchPage.ruling(
                    page,
                    outcome,
                    BenchPage.rule({
                        type: ScribeLog.Ruling.Pin,
                        subject: conflict.subject,
                        category: conflict.category,
                        target: null,
                        text,
                        hidden,
                    }),
                    null,
                );
            const choices = BenchPage.make(page, settings.Tags.Block, settings.Nothing, settings.Classes.Choices);
            for (const value of conflict.values) {
                const marks = [value.text + words.Open + value.source + words.Close];
                if (value.hidden) {
                    marks.push(words.HiddenMark);
                }
                if (value.established) {
                    marks.push(words.EstablishedMark);
                }
                choices.append(
                    BenchPage.button(
                        page,
                        marks.join(words.Comma),
                        /**
                         * @return {Promise<boolean>}
                         */
                        () => pin(value.text, value.hidden),
                        true,
                        key(roles.Value, value.fact),
                    ),
                );
            }
            const other = BenchPage.field(page, settings.InputTypes.Text, words.Other, key(roles.Other), true);
            const hidden = BenchPage.field(page, settings.InputTypes.Checkbox, words.HiddenMark, key(roles.Hidden), true);
            actions.append(
                BenchPage.button(
                    page,
                    words.PinOther,
                    /**
                     * @return {Promise<boolean>}
                     */
                    () => pin(other.input.value.trim(), hidden.input.checked),
                    true,
                    key(roles.Pin),
                ),
            );
            item.append(
                BenchPage.make(page, settings.Tags.Paragraph, conflict.label + words.Comma + conflict.category),
                choices,
                other.label,
                hidden.label,
                actions,
                outcome,
            );
            return item;
        },

        /**
         * @param {object} page
         * @param {{ first: string, second: string, firstLabel: string, secondLabel: string, reason: string }} likeness
         * @return {object}
         */
        likeness(page, likeness) {
            const settings = BenchPage.Settings;
            const words = settings.Words;
            const ruling = ScribeLog.Ruling;
            const { item, outcome, actions } = BenchPage.Rows.frame(page);
            const pair = likeness.firstLabel + words.And + likeness.secondLabel;

            /**
             * @param {string} role
             * @return {string}
             */
            const key = (role) => BenchPage.key(settings.Sections.Likes, likeness.first, likeness.second, role);
            const keep = BenchPage.make(page, settings.Tags.Select, settings.Nothing);
            BenchPage.keyed(page, keep, key(settings.Roles.Keep));
            BenchPage.control(page, keep);
            page.fields.push(keep);
            BenchPage.options(
                page,
                keep,
                [
                    [likeness.first, likeness.firstLabel],
                    [likeness.second, likeness.secondLabel],
                ],
                likeness.first,
            );
            const field = BenchPage.make(page, settings.Tags.Label, settings.Nothing, settings.Classes.Field);
            field.append(BenchPage.make(page, settings.Tags.Span, words.KeepLabel), keep);
            actions.append(
                BenchPage.button(
                    page,
                    words.TwoPeople,
                    /**
                     * @return {Promise<boolean>}
                     */
                    () =>
                        BenchPage.ruling(
                            page,
                            outcome,
                            BenchPage.rule({
                                type: ruling.Distinct,
                                first: likeness.first,
                                second: likeness.second,
                            }),
                            null,
                        ),
                    true,
                    key(settings.Roles.Distinct),
                ),
                BenchPage.button(
                    page,
                    words.SamePerson,
                    /**
                     * @return {Promise<boolean>}
                     */
                    () => {
                        const into = keep.value;
                        const first = into === likeness.first;
                        const from = first ? likeness.second : likeness.first;
                        const kept = first ? likeness.firstLabel : likeness.secondLabel;
                        return BenchPage.ruling(
                            page,
                            outcome,
                            BenchPage.rule({ type: ruling.Merge, from, into }),
                            words.MergeOpen + pair + words.MergeKeeping + kept + words.Question,
                        );
                    },
                    true,
                    key(settings.Roles.Merge),
                ),
            );
            item.append(
                BenchPage.make(
                    page,
                    settings.Tags.Paragraph,
                    pair + words.Colon + settings.Likeness[likeness.reason],
                ),
                field,
                actions,
                outcome,
            );
            return item;
        },

        /**
         * @param {object} page
         * @param {{ id: string, text: string, position: number, answer: string|null }} question
         * @return {object}
         */
        question(page, question) {
            const settings = BenchPage.Settings;
            const words = settings.Words;
            const ruling = ScribeLog.Ruling;
            const { item, outcome, actions } = BenchPage.Rows.frame(page);
            item.append(
                BenchPage.make(
                    page,
                    settings.Tags.Paragraph,
                    question.text + words.Open + words.Hash + question.position + words.Close,
                ),
            );
            if (question.answer !== null) {
                item.append(
                    BenchPage.make(
                        page,
                        settings.Tags.Paragraph,
                        words.AnsweredOpen + question.answer + words.AnsweredClose,
                        settings.Classes.Meta,
                    ),
                );
            }
            const roles = settings.Roles;
            const section = settings.Sections.Questions;
            const field = BenchPage.field(
                page,
                settings.InputTypes.Text,
                words.AnswerLabel,
                BenchPage.key(section, question.id, roles.Text),
                true,
            );
            actions.append(
                BenchPage.button(
                    page,
                    words.Dismiss,
                    /**
                     * @return {Promise<boolean>}
                     */
                    () =>
                        BenchPage.ruling(
                            page,
                            outcome,
                            BenchPage.rule({ type: ruling.Dismiss, question: question.id }),
                            null,
                        ),
                    true,
                    BenchPage.key(section, question.id, roles.Dismiss),
                ),
                BenchPage.button(
                    page,
                    words.Answer,
                    /**
                     * @return {Promise<boolean>}
                     */
                    () =>
                        BenchPage.ruling(
                            page,
                            outcome,
                            BenchPage.rule({
                                type: ruling.Answer,
                                question: question.id,
                                text: field.input.value.trim(),
                            }),
                            null,
                        ),
                    true,
                    BenchPage.key(section, question.id, roles.Answer),
                    settings.Classes.Primary,
                ),
            );
            item.append(field.label, actions, outcome);
            return item;
        },

        /**
         * @param {object} page
         * @param {{ subject: string, label: string, name: string }} alias
         * @return {object}
         */
        alias(page, alias) {
            const settings = BenchPage.Settings;
            const words = settings.Words;
            const { item, outcome, actions } = BenchPage.Rows.frame(page);
            actions.append(
                BenchPage.button(
                    page,
                    words.NotSame,
                    /**
                     * @return {Promise<boolean>}
                     */
                    () =>
                        BenchPage.ruling(
                            page,
                            outcome,
                            BenchPage.rule({
                                type: ScribeLog.Ruling.Unalias,
                                subject: alias.subject,
                                name: alias.name,
                            }),
                            null,
                        ),
                    true,
                    BenchPage.key(settings.Sections.Aliases, alias.subject, alias.name, settings.Roles.Unalias),
                ),
            );
            item.append(
                BenchPage.make(page, settings.Tags.Paragraph, alias.name + words.JoinedTo + alias.label),
                actions,
                outcome,
            );
            return item;
        },

        /**
         * @param {object} page
         * @param {{ label: string, category: string, from: string, to: string }} refinement
         * @return {object}
         */
        refinement(page, refinement) {
            const settings = BenchPage.Settings;
            const words = settings.Words;
            return BenchPage.make(
                page,
                settings.Tags.Item,
                refinement.label +
                    words.Comma +
                    refinement.category +
                    words.Colon +
                    refinement.from +
                    words.Becomes +
                    refinement.to,
                settings.Classes.Row,
            );
        },

        /**
         * @param {object} page
         * @param {{ sequence: number, type: string, summary: string }} made
         * @return {object}
         */
        made(page, made) {
            const settings = BenchPage.Settings;
            const words = settings.Words;
            const { item, outcome, actions } = BenchPage.Rows.frame(page);
            actions.append(
                BenchPage.button(
                    page,
                    words.Revoke,
                    /**
                     * @return {Promise<boolean>}
                     */
                    () =>
                        BenchPage.ruling(
                            page,
                            outcome,
                            /**
                             * @param {object} log
                             * @return {string}
                             * @throws {Error}
                             */
                            (log) => {
                                if (ScribeLog.revoke(log, made.sequence) === null) {
                                    throw new Error(words.RevokeGone);
                                }
                                return settings.Nothing;
                            },
                            words.RevokeOpen + made.sequence + words.Open + made.summary + words.Close + words.Question,
                        ),
                    true,
                    BenchPage.key(settings.Sections.Made, made.sequence, settings.Roles.Revoke),
                    settings.Classes.Danger,
                ),
            );
            item.append(
                BenchPage.make(
                    page,
                    settings.Tags.Paragraph,
                    made.sequence + words.Dot + made.type + words.Colon + made.summary,
                ),
                actions,
                outcome,
            );
            return item;
        },

        /**
         * @param {object} page
         * @param {{ fact: string, subject: string, category: string, text: string, position: number, message: string }} audited
         * @param {boolean} standing
         * @return {object}
         */
        audit(page, audited, standing) {
            const settings = BenchPage.Settings;
            const words = settings.Words;
            const verdict = settings.Verdict;
            const roles = settings.Roles;
            const section = settings.Sections.Audit;
            const { item, actions } = BenchPage.Rows.frame(page);
            item.setAttribute(settings.Attributes.Fact, audited.fact);
            const heading = [audited.fact, audited.subject, audited.category, audited.text, words.Hash + audited.position];
            if (!standing) {
                heading.push(words.NoLongerInForce);
            }
            item.append(
                BenchPage.make(page, settings.Tags.Paragraph, heading.join(words.Joiner)),
                BenchPage.make(
                    page,
                    settings.Tags.Quote,
                    audited.message === settings.Nothing ? words.MessageGone : audited.message,
                    settings.Classes.Message,
                ),
            );
            const given = page.verdicts.get(audited.fact);
            if (given !== undefined) {
                item.append(
                    BenchPage.make(
                        page,
                        settings.Tags.Paragraph,
                        given === verdict.Right ? words.MarkedRight : words.MarkedWrong,
                        settings.Classes.Meta,
                    ),
                );
            }
            actions.append(
                BenchPage.button(
                    page,
                    words.Wrong,
                    /**
                     * @return {Promise<void>}
                     */
                    async () => {
                        page.verdicts.set(audited.fact, verdict.Wrong);
                        BenchPage.draw(page);
                    },
                    false,
                    BenchPage.key(section, audited.fact, roles.Wrong),
                ),
                BenchPage.button(
                    page,
                    words.Right,
                    /**
                     * @return {Promise<void>}
                     */
                    async () => {
                        page.verdicts.set(audited.fact, verdict.Right);
                        BenchPage.draw(page);
                    },
                    false,
                    BenchPage.key(section, audited.fact, roles.Right),
                    settings.Classes.Primary,
                ),
            );
            item.append(actions);
            return item;
        },
    }),
});
