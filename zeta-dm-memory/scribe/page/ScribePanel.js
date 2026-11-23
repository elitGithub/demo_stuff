const ScribePanel = Object.freeze({
    Settings: Object.freeze({
        Remembered: 'scribe:panel',
        Shown: Object.freeze({
            Open: 'open',
            Collapsed: 'collapsed',
        }),
        NarrowWindow: 1100,
        RepeatMs: 1000,
        ClockMs: 1000,
        Hollow: Object.freeze(['Summary', 'Book', 'Timeline', 'Rulings']),
        RoomLength: 60,
        Replacement: '_',
        ShadowMode: 'closed',
        FirstPage: 1,
        LeastCount: 1,
        Single: 1,
        NoPosition: 0,
        NoCount: 0,
        NoBudget: 0,
        Nothing: '',
        True: 'true',
        Off: 'off',
        Unfocusable: '-1',
        FileOpen: 'scribe-',
        FileClose: '.json',
        ObjectType: 'object',
        StringType: 'string',
        NumberType: 'number',
        FunctionType: 'function',
        Tabs: Object.freeze(['Summary', 'Book', 'Timeline', 'Rulings', 'Findings', 'Progress', 'Settings']),
        FirstTab: 'Summary',
        SettingsTab: 'Settings',
        RulingsTab: 'Rulings',
        Ruling: 'Rule',
        Guard: Object.freeze({
            Book: 'Book',
            Change: 'Change',
            Loose: 'Loose',
            Free: 'Free',
        }),
        Lists: Object.freeze({
            Cast: 'cast',
            Days: 'days',
            Threads: 'threads',
            Subjects: 'subjects',
            Facts: 'facts',
            Timeline: 'timeline',
            Conflicts: 'conflicts',
            Likes: 'likes',
            Scenes: 'scenes',
            Questions: 'questions',
            Processing: 'processing',
            RuledFindings: 'ruled-findings',
            Aliases: 'aliases',
            Refinements: 'refinements',
            Made: 'made',
            Queued: 'queued',
            Findings: 'findings',
            Disputed: 'disputed',
            Filing: 'filing',
            Lines: 'lines',
            Calls: 'calls',
            Contradictions: 'contradictions',
            LiveCalls: 'liveCalls',
        }),
        Ids: Object.freeze({
            Host: 'scribe-host',
            Panel: 'scribe-panel',
            Headline: 'scribe-headline',
            Problems: 'scribe-problems',
            ProblemsCompact: 'scribe-problems-compact',
            ProblemDetails: 'scribe-problem-details',
            DisputedGroup: 'scribe-disputed-group',
            FilingGroup: 'scribe-filing-group',
            Choice: 'scribe-choice',
            ChoiceCounts: 'scribe-choice-counts',
            UseCloud: 'scribe-use-cloud',
            KeepHere: 'scribe-keep-here',
            ChoiceOutcome: 'scribe-choice-outcome',
            ForceStop: 'scribe-force-stop',
            Next: 'scribe-next',
            NextOutcome: 'scribe-next-outcome',
            Activity: 'scribe-activity',
            Meter: 'scribe-meter',
            Counts: 'scribe-counts',
            Clock: 'scribe-clock',
            Finished: 'scribe-finished',
            Badge: 'scribe-badge',
            Spend: 'scribe-spend',
            Trouble: 'scribe-trouble',
            Toggle: 'scribe-toggle',
            Body: 'scribe-body',
            Needs: 'scribe-needs',
            Standing: 'scribe-standing',
            Search: 'scribe-search',
            Detail: 'scribe-detail',
            Recovered: 'scribe-fact-draft',
            Heading: 'scribe-subject',
            Names: 'scribe-names',
            AddCategory: 'scribe-add-category',
            AddTargetField: 'scribe-add-target-field',
            AddTarget: 'scribe-add-target',
            AddText: 'scribe-add-text',
            AddHidden: 'scribe-add-hidden',
            AddFile: 'scribe-add-file',
            AddOutcome: 'scribe-add-outcome',
            SplitLabel: 'scribe-split-label',
            SplitKind: 'scribe-split-kind',
            SplitFile: 'scribe-split-file',
            SplitOutcome: 'scribe-split-outcome',
            KeepFirst: 'scribe-keep-first',
            KeepOutcome: 'scribe-keep-outcome',
            Clear: 'scribe-clear',
            ClearOutcome: 'scribe-clear-outcome',
            Reminder: 'scribe-reminder',
            Edit: 'scribe-edit',
            EditCancel: 'scribe-edit-cancel',
            EditSave: 'scribe-edit-save',
            Force: 'scribe-force',
            ForceReason: 'scribe-force-reason',
            Held: 'scribe-held',
            ForceOutcome: 'scribe-force-outcome',
            ReminderOutcome: 'scribe-reminder-outcome',
            Story: 'scribe-story',
            OfferText: 'scribe-offer-text',
            OfferActions: 'scribe-offer-actions',
            OfferOutcome: 'scribe-offer-outcome',
            Tell: 'scribe-tell',
            Work: 'scribe-tell-work',
            TellOutcome: 'scribe-tell-outcome',
            Understood: 'scribe-understood',
            CloudState: 'scribe-cloud-state',
            Notes: 'scribe-notes',
            KeyState: 'scribe-key-state',
            Key: 'scribe-key',
            SaveKey: 'scribe-save-key',
            KeyOutcome: 'scribe-key-outcome',
            SaveSettings: 'scribe-save-settings',
            SettingsOutcome: 'scribe-settings-outcome',
            Adopt: 'scribe-adopt',
            Export: 'scribe-export',
            Pull: 'scribe-pull',
            Pause: 'scribe-pause',
            Resume: 'scribe-resume',
            StoryRetry: 'scribe-story-retry',
            InputRetry: 'scribe-input-retry',
            ControlsOutcome: 'scribe-controls-outcome',
            Pulled: 'scribe-pulled',
            Checked: 'scribe-checked',
        }),
        Prefixes: Object.freeze({
            Tab: 'scribe-tab-',
            Section: 'scribe-section-',
            Title: 'scribe-title-',
            Failure: 'scribe-failure-',
            Empty: 'scribe-empty-',
            List: 'scribe-list-',
            Setting: 'scribe-setting-',
        }),
        Suffixes: Object.freeze({
            Previous: '-previous',
            Place: '-place',
            Next: '-next',
            Pager: '-pager',
            Problem: '-problem',
        }),
        Outlets: Object.freeze({
            Add: 'add',
            Split: 'split',
            Keep: 'keep',
            Clear: 'clear',
            Force: 'force',
            Reminder: 'reminder',
            Key: 'key',
            Settings: 'settings',
            Controls: 'controls',
            Next: 'next',
            Offer: 'offer',
            Tell: 'tell',
            Choice: 'choice',
        }),
        HeaderOutlets: Object.freeze(['next', 'choice']),
        Choices: Object.freeze({
            UseCloud: 'useCloud',
            KeepHere: 'keep',
        }),
        Setup: Object.freeze([
            Object.freeze({ name: 'analyzer', label: 'Reading model', mode: 'text' }),
            Object.freeze({ name: 'scribe', label: 'Scribe model', mode: 'text' }),
            Object.freeze({ name: 'pedant', label: 'Pedant model', mode: 'text' }),
            Object.freeze({ name: 'size', label: 'Messages per stretch', mode: 'numeric' }),
            Object.freeze({ name: 'budget', label: 'Daily budget in dollars', mode: 'decimal' }),
            Object.freeze({ name: 'refresh', label: 'User messages between reminders', mode: 'numeric' }),
        ]),
        Models: Object.freeze(['analyzer', 'scribe', 'pedant']),
        Counts: Object.freeze(['size', 'refresh']),
        Amount: 'budget',
        Needs: Object.freeze([
            Object.freeze({ field: 'conflicts', one: ' conflict', many: ' conflicts' }),
            Object.freeze({ field: 'lookAlikes', one: ' look-alike', many: ' look-alikes' }),
            Object.freeze({ field: 'questions', one: ' question', many: ' questions' }),
        ]),
        Remedies: Object.freeze({
            Dismiss: Object.freeze({ method: 'dismiss', guard: 'Change', book: false }),
            Told: Object.freeze({ method: 'told', guard: 'Book', book: true }),
        }),
        Sections: Object.freeze({
            Offer: 'offer',
            Tell: 'tell',
            Needs: 'needs',
            Subjects: 'subjects',
            Facts: 'facts',
            Scenes: 'scenes',
            Conflicts: 'conflicts',
            Likes: 'likes',
            Questions: 'questions',
            Aliases: 'aliases',
            Made: 'made',
            Findings: 'findings',
            Lines: 'lines',
            Calls: 'calls',
            Contradictions: 'contradictions',
            LiveCalls: 'liveCalls',
        }),
        Acts: Object.freeze({
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
            Suggest: 'suggest',
            Ignore: 'ignore',
            Another: 'another',
            Use: 'use',
            Forget: 'forget',
            File: 'file',
        }),
        Tags: Object.freeze({
            Block: 'div',
            Aside: 'aside',
            Header: 'header',
            Nav: 'nav',
            Section: 'section',
            Title: 'h2',
            Group: 'h3',
            Form: 'h4',
            Paragraph: 'p',
            Span: 'span',
            List: 'ul',
            Item: 'li',
            Button: 'button',
            Input: 'input',
            Area: 'textarea',
            Label: 'label',
            Select: 'select',
            Option: 'option',
            Details: 'details',
            Summary: 'summary',
            Preformatted: 'pre',
            Style: 'style',
            Progress: 'progress',
        }),
        Classes: Object.freeze({
            Panel: 'panel',
            Collapsed: 'collapsed',
            Header: 'header',
            Headline: 'headline',
            Badge: 'badge',
            Spend: 'spend',
            Trouble: 'trouble',
            Toggle: 'toggle',
            Body: 'body',
            Tabs: 'tabs',
            Title: 'panel-title',
            Group: 'group',
            Rows: 'rows',
            Row: 'row',
            Empty: 'empty',
            Meta: 'meta',
            Lines: 'lines',
            Day: 'day',
            Strong: 'title',
            Problem: 'problem',
            Unreadable: 'unreadable',
            Outcome: 'outcome',
            Actions: 'actions',
            Choices: 'choices',
            Message: 'message',
            Offer: 'offer',
            Pager: 'pager',
            Place: 'place',
            Form: 'form',
            Detail: 'detail',
            Primary: 'primary',
            Danger: 'danger',
            Field: 'field',
            Tick: 'tick',
            Required: 'required',
            Activity: 'activity',
            Meter: 'meter',
            Hollow: 'hollow',
            Choice: 'choice',
        }),
        Attributes: Object.freeze({
            Max: 'max',
            Value: 'value',
            Type: 'type',
            Role: 'role',
            Label: 'aria-label',
            Selected: 'aria-selected',
            Controls: 'aria-controls',
            LabelledBy: 'aria-labelledby',
            Expanded: 'aria-expanded',
            Current: 'aria-current',
            Hidden: 'aria-hidden',
            Required: 'aria-required',
            Invalid: 'aria-invalid',
            TabIndex: 'tabindex',
            Autocomplete: 'autocomplete',
            InputMode: 'inputmode',
            MaxLength: 'maxlength',
            Placeholder: 'placeholder',
            Fact: 'data-fact',
        }),
        Aria: Object.freeze({
            Tablist: 'tablist',
            Tab: 'tab',
            Tabpanel: 'tabpanel',
            Status: 'status',
            Alert: 'alert',
        }),
        InputTypes: Object.freeze({
            Button: 'button',
            Checkbox: 'checkbox',
            Text: 'text',
            Password: 'password',
            Area: 'textarea',
        }),
        Events: Object.freeze({
            Click: 'click',
            Change: 'change',
            Input: 'input',
            Toggle: 'toggle',
            CompositionStart: 'compositionstart',
            CompositionEnd: 'compositionend',
            Blur: 'blur',
            FocusOut: 'focusout',
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
            Title: 'Scribe',
            Views: 'Scribe views',
            Hide: 'Hide',
            Show: 'Scribe',
            ToRule: ' to rule',
            Finding: ' finding',
            Findings: ' findings',
            Today: ' today',
            Trouble: 'Something went wrong in the panel: ',
            Unknown: 'Something went wrong.',
            TabFailed: 'This tab could not be drawn: ',
            RowFailed: 'This entry could not be shown.',
            NeedsHeading: 'Needs you',
            CastHeading: 'Cast',
            StandingHeading: 'Where the story stands',
            DaysHeading: 'Days',
            ThreadsHeading: 'Open threads',
            NothingNeeds: 'Nothing needs a ruling.',
            Day: 'Day ',
            Search: 'Search the book',
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
            AddHeading: 'Add a fact',
            Category: 'Category',
            Target: 'Toward',
            FactText: 'Text',
            Hidden: 'Hidden',
            AddButton: 'Add the fact',
            Added: 'Added.',
            AddMissing: 'Write the fact.',
            SplitHeading: 'Split the ticked facts',
            SplitLabel: 'Name of the second person',
            SplitKind: 'Kind',
            SplitButton: 'Split',
            SplitOpen: 'Move ',
            SplitMiddle: ' facts to a new subject named ',
            SplitClose: '?',
            SplitDone: 'Split.',
            SplitNameMissing: 'Name the second person.',
            SplitTickMissing: 'Tick at least one fact to move.',
            KeepFirst: 'Keep the first value for all',
            NothingToKeep: 'No conflict has an established value to keep.',
            KeptOpen: 'Kept the first value for ',
            KeptOne: ' conflict.',
            KeptMany: ' conflicts.',
            ConflictsHeading: 'Conflicts',
            LikesHeading: 'Look-alikes',
            ScenesHeading: 'Public scenes',
            QuestionsHeading: 'Questions',
            AliasesHeading: 'Names joined',
            RefinementsHeading: 'Fuller statements',
            MadeHeading: 'Rulings made',
            Other: 'Other value',
            OtherMissing: 'Write the other value.',
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
            AnswerMissing: 'Write the answer.',
            Dismiss: 'Dismiss',
            YourAnswer: 'Your answer: ',
            Answered: 'Answered; it will be filed at the next reading.',
            NotSame: 'Not the same',
            JoinedTo: ' is a name of ',
            Becomes: ' becomes ',
            Revoke: 'Revoke',
            RevokeOpen: 'Revoke ruling ',
            Present: 'present: ',
            NextHeading: 'With your next message',
            ReminderLabel: 'Reminder',
            NothingWaiting: 'No reminder is waiting.',
            PreparedLater: 'Waiting for a reminder to be prepared.',
            EditHeld: 'Your edit goes once the book is ready.',
            HeldReady: 'Your reminder goes once the book is ready.',
            Edit: 'Edit',
            EditCancel: 'Cancel',
            EditSave: 'Save',
            Force: 'Send a reminder with my next message',
            Resend: 'Resend this reminder with my next message',
            Forced: 'Queued for your next message',
            Suggestion: 'Suggestion: ',
            Clear: 'Clear',
            FindingsHeading: 'Findings',
            OfferHeading: 'A development',
            Suggest: 'Suggest one',
            Ignore: 'Ignore',
            Another: 'Another',
            Use: 'Use',
            Thinking: 'Thinking...',
            NothingFits: 'Nothing fits this scene right now.',
            TellHeading: 'Tell the scribe',
            TellLabel: 'What should the book know?',
            TellNote: 'This stays with the scribe. It is never sent to the chat.',
            Work: 'Work it out',
            TellMissing: 'Write what the book should know.',
            ReadingWords: 'Reading your words...',
            Understood: 'The scribe understood:',
            RefusedOne: ' line of the answer could not be used.',
            RefusedMany: ' lines of the answer could not be used.',
            NothingUnderstood: 'Nothing was understood. Say it another way.',
            NothingChanges: 'Nothing in the book would change.',
            LineBreak: '\n',
            Forget: 'Forget',
            File: 'File it',
            Statuses: Object.freeze({
                Open: 'Open',
                Dismissed: 'Dismissed',
                Accepted: 'Accepted into the book',
                Told: 'Marked as told',
                Reminded: "The book's value went out in a reminder.",
            }),
            UseCloud: "Use the cloud's",
            KeepHere: "Keep this PC's book",
            ForceStop: 'Force stop',
            StoppedCall: 'Stopped by the operator: ',
            CostUnknown: '; cost unknown',
            ChoiceHere: 'This PC: ',
            ChoiceThere: ' Your Worker: ',
            ReadOne: ' message read.',
            ReadMany: ' messages read.',
            NoBookThere: 'no book.',
            NoNotes: 'No operator notes for this chat in your Worker.',
            NotesGoOne: ' character of the operator notes goes to the models.',
            NotesGoMany: ' characters of the operator notes go to the models.',
            NotesCutOpen: ' They were cut from ',
            NotesCutClose: ' characters.',
            KeySaved: 'An OpenRouter key is saved',
            NoKey: 'No key yet',
            KeyUnreadable: 'The key could not be read',
            KeyLabel: 'OpenRouter key',
            SaveKey: 'Save key',
            KeyMissing: 'Enter the OpenRouter key.',
            KeySuperseded: 'The saved key changed. Enter your key again to replace it.',
            ModelMissing: 'Enter a model.',
            CountWrong: Object.freeze({
                size: 'Messages per stretch must be a whole number of at least 1.',
                refresh: 'User messages between reminders must be a whole number of at least 1.',
            }),
            BudgetWrong: 'The budget must be a number of dollars, more than 0.',
            FixFields: 'Nothing was saved: a field above needs attention.',
            AdoptFix: 'A field on the Settings tab needs attention.',
            NoPullHere: 'This tab has not pulled the chat; another tab is reading it.',
            SettingsSaved: 'Settings saved.',
            SaveSettings: 'Save settings',
            Adopt: 'Adopt this chat',
            StartOver: 'Start the book over',
            StartOverQuestion: 'Start a new book? It replaces the saved book for this chat.',
            Pause: 'Pause',
            Resume: 'Resume',
            Pull: 'Pull the chat again',
            Export: 'Export',
            Exported: 'Exported ',
            LastPullOpen: 'Last pull: ',
            MessageOne: ' message',
            MessageMany: ' messages',
            Ended: ', ended ',
            UnreadClose: ' could not be read',
            LinesHeading: 'Readings',
            DisputedHeading: 'Unread messages with unresolved authorship',
            PlayerMessage: 'Player message #',
            CallsHeading: 'Last calls',
            LiveCallsHeading: 'Last live calls',
            TokensIn: ': in ',
            TokensOut: ', out ',
            Reasoning: ', reasoning ',
            FinishOpen: ', finish ',
            CutAnswer: 'The start of the cut answer',
            ContradictionsHeading: 'Contradictions the Analyzer read',
            Refused: 'Refused lines',
            CallOpen: 'Call ',
            Unreadable: 'Unreadable answer',
            AnswerText: 'The answer',
            Saving: 'Saving...',
            Working: 'Working...',
            MeterLabel: 'Messages read',
            StepOpen: 'This step: ',
            LastFinished: 'Last finished: ',
            Empty: 'None.',
            PageOpen: 'Page ',
            PageOf: ' of ',
            Previous: 'Previous',
            Next: 'Next',
            Required: ' *',
            Hash: '#',
            Colon: ': ',
            Comma: ', ',
            Joiner: ' | ',
            And: ' and ',
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

        /**
         * @return {RegExp}
         */
        get Unsafe() {
            return /[^A-Za-z0-9_-]/g;
        },

        /**
         * @return {RegExp}
         */
        get Directions() {
            return /\p{Bidi_Control}/gu;
        },
    }),

    /**
     * @param {{ document: object, keeper: object, live: object, cloud: object, calls: { due: () => boolean, stop: () => void }, storage: object, confirm: (text: string) => boolean, download: (name: string, text: string) => void, clock: { now: () => number } }} environment
     * @return {Readonly<{ redraw: () => void, unmount: () => void, host: object }>}
     */
    mount(environment) {
        const settings = ScribePanel.Settings;
        const document = environment.document;
        const earlier = document.getElementById(settings.Ids.Host);
        if (earlier !== null) {
            earlier.remove();
        }
        const host = document.createElement(settings.Tags.Block);
        host.id = settings.Ids.Host;
        const wide = document.defaultView.innerWidth >= settings.NarrowWindow;
        let remembered = null;
        let trouble = settings.Nothing;
        try {
            remembered = environment.storage.get(settings.Remembered, null);
        } catch (error) {
            trouble = settings.Words.Trouble + ScribePanel.reason(error);
        }
        const panel = {
            document,
            keeper: environment.keeper,
            live: environment.live,
            cloud: environment.cloud,
            calls: environment.calls,
            keyVersion: environment.keyVersion,
            keyProblem: environment.keyProblem,
            keyRecoveryProblem: environment.keyRecoveryProblem,
            saveKey: environment.saveKey,
            draftVersion: environment.keyVersion(),
            storage: environment.storage,
            confirm: environment.confirm,
            download: environment.download,
            clock: environment.clock,
            host,
            root: host.attachShadow({ mode: settings.ShadowMode }),
            open: wide && remembered !== settings.Shown.Collapsed,
            mounted: true,
            building: false,
            making: null,
            tab: settings.FirstTab,
            drawnTab: settings.FirstTab,
            pages: {},
            query: settings.Nothing,
            chosen: null,
            ticks: new Set(),
            parts: {},
            setup: {},
            lists: {},
            sections: {},
            titles: {},
            failures: {},
            tabs: {},
            fixed: new Map(),
            keyed: new Map(),
            keys: new WeakMap(),
            opened: new WeakSet(),
            fields: [],
            rowOf: {},
            existing: {},
            stale: {},
            follow: null,
            selection: null,
            typed: new Map(),
            lastKey: null,
            outcomes: new Map(),
            signed: new Map(),
            outlets: new Map(),
            outletTabs: new Map(),
            shown: new Set(),
            fleeting: new Set(),
            pending: new Map(),
            held: { Book: [], Change: [], Loose: [] },
            guarded: { Book: [], Change: [], Loose: [] },
            waiting: new Map(),
            marked: new Set(),
            last: new Map(),
            busy: 0,
            storyRetry: null,
            step: null,
            timer: null,
            began: null,
            hollows: {},
            filled: null,
            trouble,
            troubled: null,
            fixing: null,
            composing: false,
            editing: false,
            resendId: null,
            editShown: false,
            editStale: false,
            editAgainst: undefined,
            editSelection: null,
            editFrom: settings.Nothing,
            heldDraw: false,
            workedOut: null,
            rulingOrigins: new Map(),
            factDraft: null,
            factInput: null,
        };
        ScribePanel.build(panel);
        panel.root.addEventListener(
            settings.Events.CompositionStart,
            /**
             * @return {void}
             */
            () => {
                panel.composing = true;
            },
        );
        for (const type of [settings.Events.CompositionEnd, settings.Events.FocusOut]) {
            panel.root.addEventListener(
                type,
                /**
                 * @return {void}
                 */
                () => {
                    ScribePanel.release(panel);
                },
            );
        }
        document.body.append(host);
        ScribePanel.redraw(panel);
        return Object.freeze({
            /**
             * @return {void}
             */
            redraw: () => {
                ScribePanel.redraw(panel);
            },
            /**
             * @return {void}
             */
            keyChanged: () => {
                const field = panel.parts.Key;
                const notice = field.value ? settings.Words.KeySuperseded : settings.Nothing;
                field.value = settings.Nothing;
                panel.draftVersion = panel.keyVersion();
                ScribePanel.mark(panel, settings.Ids.Key, false);
                ScribePanel.say(panel, settings.Outlets.Key, notice);
            },
            /**
             * @return {void}
             */
            unmount: () => {
                ScribePanel.unmount(panel);
            },
            host,
        });
    },

    /**
     * @param {object} panel
     * @return {void}
     */
    unmount(panel) {
        if (!panel.mounted) {
            return;
        }
        panel.mounted = false;
        ScribePanel.stopClock(panel);
        panel.host.remove();
    },

    /**
     * @param {object} panel
     * @return {void}
     */
    release(panel) {
        panel.composing = false;
        if (panel.heldDraw) {
            panel.heldDraw = false;
            ScribePanel.redraw(panel);
        }
    },

    /**
     * @param {object} panel
     * @param {Promise<*>} task
     * @return {void}
     */
    track(panel, task) {
        task.then(
            null,
            /**
             * @param {*} error
             * @return {void}
             */
            (error) => {
                panel.trouble = ScribePanel.Settings.Words.Trouble + ScribePanel.reason(error);
                ScribePanel.redraw(panel);
            },
        );
    },

    /**
     * @param {object} panel
     * @param {object} element
     * @param {string} type
     * @param {() => Promise<*>} act
     * @return {void}
     */
    listen(panel, element, type, act) {
        element.addEventListener(
            type,
            /**
             * @return {void}
             */
            () => {
                ScribePanel.track(panel, act());
            },
        );
    },

    /**
     * @param {*} error
     * @return {string}
     */
    reason(error) {
        const settings = ScribePanel.Settings;
        try {
            const described =
                error !== null && typeof error === settings.ObjectType && typeof error.message === settings.StringType;
            return described ? error.message : String(error);
        } catch {
            return settings.Words.Unknown;
        }
    },

    /**
     * @param {*} error
     * @return {string}
     */
    refusal(error) {
        const refusals = ScribePanel.Settings.Refusals;
        const message = ScribePanel.reason(error);
        return Object.hasOwn(refusals, message) ? refusals[message] : message;
    },

    /**
     * @param {string} text
     * @return {number|null}
     */
    whole(text) {
        const trimmed = text.trim();
        if (!ScribePanel.Settings.WholeNumber.test(trimmed)) {
            return null;
        }
        const number = Number(trimmed);
        return Number.isSafeInteger(number) ? number : null;
    },

    /**
     * @param {...(string|number)} parts
     * @return {string}
     */
    key(...parts) {
        return JSON.stringify(parts);
    },

    /**
     * @param {object} panel
     * @param {string} outlet
     * @param {string} text
     * @return {void}
     */
    say(panel, outlet, text) {
        panel.signed.delete(outlet);
        if (text === ScribePanel.Settings.Nothing) {
            panel.outcomes.delete(outlet);
            return;
        }
        panel.outcomes.set(outlet, text);
    },

    /**
     * @param {object} panel
     * @param {string} outlet
     * @param {string} text
     * @return {void}
     */
    fail(panel, outlet, text) {
        ScribePanel.say(panel, outlet, text);
        panel.signed.set(outlet, panel.composing ? ScribePanel.signature(panel.keeper.view()) : null);
    },

    /**
     * @param {object} view
     * @return {boolean}
     */
    passing(view) {
        return view.busy !== null || view.flight !== null;
    },

    /**
     * @param {object} view
     * @return {string}
     */
    signature(view) {
        return JSON.stringify([
            view.phase,
            view.reader,
            view.busy,
            view.adoptBlock,
            view.stop?.reason ?? null,
            view.pulled?.at ?? null,
        ]);
    },

    /**
     * @param {object} panel
     * @param {object} view
     * @return {void}
     */
    clearFailures(panel, view) {
        const settings = ScribePanel.Settings;
        const current = ScribePanel.signature(view);
        const passing = ScribePanel.passing(view);
        for (const [outlet, taken] of [...panel.signed]) {
            if (taken === null) {
                panel.signed.set(outlet, current);
            } else if (!passing && taken !== current) {
                const text = panel.outcomes.get(outlet);
                ScribePanel.say(panel, outlet, settings.Nothing);
                if (panel.troubled === outlet && panel.trouble === text) {
                    panel.trouble = settings.Nothing;
                    panel.troubled = null;
                }
            }
        }
    },

    /**
     * @param {*} text
     * @return {string}
     */
    clean(text) {
        return String(text).replace(ScribePanel.Settings.Directions, ScribePanel.Settings.Nothing);
    },

    /**
     * @param {object} element
     * @param {*} text
     * @return {void}
     */
    write(element, text) {
        element.textContent = ScribePanel.clean(text);
    },

    /**
     * @param {object} panel
     * @param {string} tag
     * @param {*} text
     * @param {...string} classes
     * @return {object}
     */
    make(panel, tag, text, ...classes) {
        const element = panel.document.createElement(tag);
        ScribePanel.write(element, text);
        if (classes.length > 0) {
            element.classList.add(...classes);
        }
        return element;
    },

    /**
     * @param {object} panel
     * @param {string} name
     * @param {object} element
     * @return {object}
     */
    own(panel, name, element) {
        element.id = ScribePanel.Settings.Ids[name];
        panel.parts[name] = element;
        return element;
    },

    /**
     * @param {object} panel
     * @param {object} element
     * @param {boolean} hide
     * @return {object}
     */
    stale(panel, element, hide) {
        panel.stale[panel.making].push({ element, hide });
        return element;
    },

    /**
     * @param {object} panel
     * @param {object} element
     * @param {string} key
     * @return {object}
     */
    keyed(panel, element, key) {
        panel.keys.set(element, key);
        if (panel.building) {
            panel.fixed.set(key, element);
        } else {
            panel.keyed.set(key, element);
        }
        return element;
    },

    /**
     * @param {object} panel
     * @param {object} element
     * @param {string} guard
     * @return {object}
     */
    guard(panel, element, guard) {
        if (guard === ScribePanel.Settings.Guard.Free) {
            return element;
        }
        element.disabled = true;
        const lists = panel.building ? panel.held : panel.guarded;
        lists[guard].push(element);
        return element;
    },

    /**
     * @param {object} panel
     * @param {string} text
     * @param {() => Promise<*>} act
     * @param {string} guard
     * @param {string} key
     * @param {...string} classes
     * @return {object}
     */
    button(panel, text, act, guard, key, ...classes) {
        const settings = ScribePanel.Settings;
        const button = ScribePanel.make(panel, settings.Tags.Button, text, ...classes);
        button.setAttribute(settings.Attributes.Type, settings.InputTypes.Button);
        ScribePanel.keyed(panel, button, key);
        ScribePanel.listen(panel, button, settings.Events.Click, act);
        return ScribePanel.guard(panel, button, guard);
    },

    /**
     * @param {object} panel
     * @param {string} type
     * @param {string} text
     * @param {string} key
     * @param {boolean} required
     * @param {boolean} kept
     * @return {{ label: object, input: object }}
     */
    field(panel, type, text, key, required, kept) {
        const settings = ScribePanel.Settings;
        const attributes = settings.Attributes;
        const tick = type === settings.InputTypes.Checkbox;
        const label = ScribePanel.make(
            panel,
            settings.Tags.Label,
            settings.Nothing,
            tick ? settings.Classes.Tick : settings.Classes.Field,
        );
        const area = type === settings.InputTypes.Area;
        const input = ScribePanel.make(panel, area ? settings.Tags.Area : settings.Tags.Input, settings.Nothing);
        if (!area) {
            input.setAttribute(attributes.Type, type);
        }
        ScribePanel.keyed(panel, input, key);
        input.addEventListener(
            settings.Events.Blur,
            /**
             * @return {void}
             */
            () => {
                ScribePanel.release(panel);
            },
        );
        if (kept) {
            panel.fields.push(input);
        }
        if (panel.marked.has(key)) {
            input.setAttribute(attributes.Invalid, settings.True);
        }
        const caption = ScribePanel.make(panel, settings.Tags.Span, text);
        if (tick) {
            label.append(input, caption);
            return { label, input };
        }
        input.setAttribute(attributes.Autocomplete, settings.Off);
        if (required) {
            const marker = ScribePanel.make(
                panel,
                settings.Tags.Span,
                settings.Words.Required,
                settings.Classes.Required,
            );
            marker.setAttribute(attributes.Hidden, settings.True);
            input.setAttribute(attributes.Required, settings.True);
            caption.append(marker);
        }
        label.append(caption, input);
        return { label, input };
    },

    /**
     * @param {object} panel
     * @param {string} text
     * @param {string} key
     * @param {boolean} kept
     * @return {{ label: object, select: object }}
     */
    select(panel, text, key, kept) {
        const settings = ScribePanel.Settings;
        const label = ScribePanel.make(panel, settings.Tags.Label, settings.Nothing, settings.Classes.Field);
        const select = ScribePanel.make(panel, settings.Tags.Select, settings.Nothing);
        ScribePanel.keyed(panel, select, key);
        if (kept) {
            panel.fields.push(select);
        }
        label.append(ScribePanel.make(panel, settings.Tags.Span, text), select);
        return { label, select };
    },

    /**
     * @param {object} panel
     * @param {object} select
     * @param {Array<[string, string]>} pairs
     * @param {string} chosen
     * @return {void}
     */
    options(panel, select, pairs, chosen) {
        const settings = ScribePanel.Settings;
        select.replaceChildren(
            ...pairs.map(
                /**
                 * @param {[string, string]} pair
                 * @return {object}
                 */
                ([value, text]) => {
                    const option = ScribePanel.make(panel, settings.Tags.Option, text);
                    option.value = value;
                    return option;
                },
            ),
        );
        select.value = chosen;
    },

    /**
     * @param {object} panel
     * @param {object} parent
     * @param {string} title
     * @return {object}
     */
    group(panel, parent, title) {
        const settings = ScribePanel.Settings;
        const group = ScribePanel.make(panel, settings.Tags.Block, settings.Nothing, settings.Classes.Group);
        group.append(ScribePanel.make(panel, settings.Tags.Group, title));
        parent.append(group);
        return group;
    },

    /**
     * @param {object} panel
     * @param {string} name
     * @param {string} key
     * @return {object}
     */
    outlet(panel, name, key) {
        const settings = ScribePanel.Settings;
        const outcome = ScribePanel.make(panel, settings.Tags.Paragraph, settings.Nothing, settings.Classes.Outcome);
        outcome.setAttribute(settings.Attributes.Role, settings.Aria.Status);
        panel.outlets.set(key, outcome);
        panel.outletTabs.set(key, panel.making);
        return ScribePanel.own(panel, name, outcome);
    },

    /**
     * @param {object} panel
     * @param {string} key
     * @param {boolean} bad
     * @return {void}
     */
    mark(panel, key, bad) {
        const settings = ScribePanel.Settings;
        const invalid = settings.Attributes.Invalid;
        const element = panel.keyed.get(key) ?? panel.fixed.get(key);
        if (bad) {
            panel.marked.add(key);
        } else {
            panel.marked.delete(key);
        }
        if (element === undefined) {
            return;
        }
        if (bad) {
            element.setAttribute(invalid, settings.True);
        } else {
            element.removeAttribute(invalid);
        }
    },

    /**
     * @param {object} panel
     * @param {string} name
     * @return {boolean}
     */
    again(panel, name) {
        const last = panel.last.get(name);
        return last !== undefined && panel.clock.now() - last < ScribePanel.Settings.RepeatMs;
    },

    /**
     * @param {object} panel
     * @param {string} outlet
     * @param {object} control
     * @return {object}
     */
    wait(panel, outlet, control) {
        const controls = panel.waiting.get(outlet) ?? [];
        controls.push(control);
        panel.waiting.set(outlet, controls);
        return ScribePanel.belong(panel, outlet, control);
    },

    /**
     * @param {object} panel
     * @param {string} outlet
     * @param {object} element
     * @return {object}
     */
    belong(panel, outlet, element) {
        panel.rowOf[panel.tab].set(panel.keys.get(element), outlet);
        return element;
    },

    /**
     * @param {object} panel
     * @param {string} name
     * @param {object} parent
     * @return {void}
     */
    pager(panel, name, parent) {
        const settings = ScribePanel.Settings;
        const words = settings.Words;
        const free = settings.Guard.Free;
        const suffixes = settings.Suffixes;
        const id = settings.Prefixes.List + name;
        const list = ScribePanel.make(panel, settings.Tags.List, settings.Nothing, settings.Classes.Rows);
        list.id = id;
        const nav = ScribePanel.make(panel, settings.Tags.Nav, settings.Nothing, settings.Classes.Pager);
        nav.id = id + suffixes.Pager;
        const previous = ScribePanel.button(
            panel,
            words.Previous,
            /**
             * @return {Promise<void>}
             */
            async () => {
                panel.pages[name]--;
                ScribePanel.redraw(panel);
            },
            free,
            id + suffixes.Previous,
        );
        previous.id = id + suffixes.Previous;
        const place = ScribePanel.make(panel, settings.Tags.Paragraph, settings.Nothing, settings.Classes.Place);
        place.id = id + suffixes.Place;
        const next = ScribePanel.button(
            panel,
            words.Next,
            /**
             * @return {Promise<void>}
             */
            async () => {
                panel.pages[name]++;
                ScribePanel.redraw(panel);
            },
            free,
            id + suffixes.Next,
        );
        next.id = id + suffixes.Next;
        nav.append(previous, place, next);
        parent.append(ScribePanel.stale(panel, list, false), ScribePanel.stale(panel, nav, true));
        panel.lists[name] = { list, nav, previous, place, next };
        panel.pages[name] = settings.FirstPage;
    },

    /**
     * @param {object} panel
     * @param {Array<*>} rows
     * @param {(row: *, index: number) => object} build
     * @return {object[]}
     */
    items(panel, rows, build) {
        const settings = ScribePanel.Settings;
        const classes = settings.Classes;
        const items = rows.map(
            /**
             * @param {*} row
             * @param {number} index
             * @return {object}
             */
            (row, index) => {
                let item = null;
                try {
                    item = row === null ? null : build(row, index);
                } catch {
                    item = null;
                }
                return (
                    item ??
                    ScribePanel.make(panel, settings.Tags.Item, settings.Words.RowFailed, classes.Row, classes.Problem)
                );
            },
        );
        if (items.length === 0) {
            items.push(ScribePanel.make(panel, settings.Tags.Item, settings.Words.Empty, classes.Empty));
        }
        return items;
    },

    /**
     * @param {object} panel
     * @param {string} name
     * @param {{ rows: Array<*>, pages: number }} result
     * @param {(row: *, index: number) => object} build
     * @return {void}
     */
    show(panel, name, result, build) {
        const settings = ScribePanel.Settings;
        const words = settings.Words;
        const parts = panel.lists[name];
        const current = BenchView.clamp(panel.pages[name], result.pages);
        panel.pages[name] = current;
        const rows = ScribePanel.items(panel, result.rows, build);
        parts.list.replaceChildren(...rows);
        parts.previous.disabled = current <= settings.FirstPage;
        parts.next.disabled = current >= result.pages;
        ScribePanel.write(parts.place, words.PageOpen + current + words.PageOf + result.pages);
        parts.nav.hidden = result.pages <= settings.FirstPage;
    },

    /**
     * @param {object} panel
     * @param {string} name
     * @param {ReadonlyArray<*>} items
     * @param {(row: *, index: number) => object} build
     * @param {((item: object) => string)|null} identify
     * @param {number} size
     * @return {void}
     */
    paged(panel, name, items, build, identify, size = BenchView.PageSize) {
        const settings = ScribePanel.Settings;
        let rows = items;
        if (identify !== null) {
            const existing = panel.existing[panel.tab];
            let follow = -1;
            rows = items.map(
                /**
                 * @param {object|null} item
                 * @param {number} index
                 * @return {object|null}
                 */
                (item, index) => {
                    if (item === null) {
                        return null;
                    }
                    try {
                        const row = identify(item);
                        existing.add(row);
                        if (row === panel.follow) {
                            follow = index;
                        }
                        return item;
                    } catch {
                        return null;
                    }
                },
            );
            if (follow >= settings.NoCount) {
                panel.pages[name] = Math.floor(follow / size) + settings.FirstPage;
            }
        }
        ScribePanel.show(panel, name, BenchView.page(rows, panel.pages[name], size), build);
    },

    /**
     * @param {object} panel
     * @return {void}
     */
    fold(panel) {
        const settings = ScribePanel.Settings;
        const parts = panel.parts;
        parts.Body.hidden = !panel.open;
        ScribePanel.write(parts.Toggle, panel.open ? settings.Words.Hide : settings.Words.Show);
        parts.Toggle.setAttribute(settings.Attributes.Expanded, String(panel.open));
        if (panel.open) {
            parts.Panel.classList.remove(settings.Classes.Collapsed);
        } else {
            parts.Panel.classList.add(settings.Classes.Collapsed);
        }
    },

    /**
     * @param {object} panel
     * @return {void}
     */
    build(panel) {
        const settings = ScribePanel.Settings;
        const tags = settings.Tags;
        const classes = settings.Classes;
        const attributes = settings.Attributes;
        const aria = settings.Aria;
        const words = settings.Words;
        const shown = settings.Shown;
        panel.building = true;
        const aside = ScribePanel.own(
            panel,
            'Panel',
            ScribePanel.make(panel, tags.Aside, settings.Nothing, classes.Panel),
        );
        aside.setAttribute(attributes.Label, words.Title);
        const header = ScribePanel.make(panel, tags.Header, settings.Nothing, classes.Header);
        const toggle = ScribePanel.button(
            panel,
            words.Hide,
            /**
             * @return {Promise<void>}
             */
            async () => {
                panel.open = !panel.open;
                ScribePanel.fold(panel);
                if (panel.document.defaultView.innerWidth >= settings.NarrowWindow) {
                    panel.storage.set(settings.Remembered, panel.open ? shown.Open : shown.Collapsed);
                }
                panel.trouble = settings.Nothing;
                ScribePanel.redraw(panel);
            },
            settings.Guard.Free,
            settings.Ids.Toggle,
            classes.Toggle,
        );
        ScribePanel.own(panel, 'Toggle', toggle);
        toggle.setAttribute(attributes.Controls, settings.Ids.Body);
        const trouble = ScribePanel.make(panel, tags.Paragraph, settings.Nothing, classes.Trouble);
        trouble.setAttribute(attributes.Role, aria.Alert);
        const next = ScribePanel.button(
            panel,
            settings.Nothing,
            /**
             * @return {Promise<void>}
             */
            async () => {
                if (panel.step === PanelView.Step.Adopt) {
                    await ScribePanel.adopt(panel, settings.Outlets.Next);
                } else if (panel.step === PanelView.Step.Resume) {
                    await ScribePanel.resume(panel, settings.Outlets.Next);
                }
            },
            settings.Guard.Free,
            settings.Ids.Next,
            classes.Primary,
        );
        next.hidden = true;
        const activity = ScribePanel.own(
            panel,
            'Activity',
            ScribePanel.make(panel, tags.Block, settings.Nothing, classes.Activity),
        );
        const meter = ScribePanel.own(
            panel,
            'Meter',
            ScribePanel.make(panel, tags.Progress, settings.Nothing, classes.Meter),
        );
        meter.setAttribute(attributes.Label, words.MeterLabel);
        activity.hidden = true;
        activity.append(
            meter,
            ScribePanel.own(panel, 'Counts', ScribePanel.make(panel, tags.Paragraph, settings.Nothing)),
            ScribePanel.own(panel, 'Clock', ScribePanel.make(panel, tags.Paragraph, settings.Nothing)),
            ScribePanel.own(panel, 'Finished', ScribePanel.make(panel, tags.Paragraph, settings.Nothing)),
        );
        const choice = ScribePanel.own(
            panel,
            'Choice',
            ScribePanel.make(panel, tags.Block, settings.Nothing, classes.Choice),
        );
        choice.hidden = true;
        const choosing = ScribePanel.make(panel, tags.Block, settings.Nothing, classes.Actions);
        choosing.append(
            ScribePanel.own(
                panel,
                'UseCloud',
                ScribePanel.button(
                    panel,
                    words.UseCloud,
                    /**
                     * @return {Promise<boolean>}
                     */
                    () => ScribePanel.choose(panel, settings.Choices.UseCloud),
                    settings.Guard.Free,
                    settings.Ids.UseCloud,
                ),
            ),
            ScribePanel.own(
                panel,
                'KeepHere',
                ScribePanel.button(
                    panel,
                    words.KeepHere,
                    /**
                     * @return {Promise<boolean>}
                     */
                    () => ScribePanel.choose(panel, settings.Choices.KeepHere),
                    settings.Guard.Free,
                    settings.Ids.KeepHere,
                    classes.Primary,
                ),
            ),
        );
        choice.append(
            ScribePanel.own(panel, 'ChoiceCounts', ScribePanel.make(panel, tags.Paragraph, settings.Nothing)),
            choosing,
            ScribePanel.outlet(panel, 'ChoiceOutcome', settings.Outlets.Choice),
        );
        const forceStop = ScribePanel.button(
            panel,
            words.ForceStop,
            /**
             * @return {Promise<void>}
             */
            async () => {
                panel.calls.stop();
                ScribePanel.redraw(panel);
            },
            settings.Guard.Free,
            settings.Ids.ForceStop,
        );
        forceStop.hidden = true;
        const problems = ScribePanel.own(panel, 'Problems', ScribePanel.make(panel, tags.Block, settings.Nothing, classes.Problem));
        problems.setAttribute(attributes.Role, aria.Status);
        const compact = ScribePanel.own(panel, 'ProblemsCompact', ScribePanel.make(panel, tags.Span, settings.Nothing, classes.Problem));
        compact.setAttribute(attributes.Role, aria.Status);
        header.append(
            ScribePanel.own(
                panel,
                'Headline',
                ScribePanel.make(panel, tags.Paragraph, settings.Nothing, classes.Headline),
            ),
            problems,
            compact,
            ScribePanel.own(panel, 'ForceStop', forceStop),
            choice,
            ScribePanel.own(panel, 'Next', next),
            ScribePanel.outlet(panel, 'NextOutcome', settings.Outlets.Next),
            activity,
            ScribePanel.own(panel, 'Badge', ScribePanel.make(panel, tags.Span, settings.Nothing, classes.Badge)),
            ScribePanel.own(panel, 'Spend', ScribePanel.make(panel, tags.Span, settings.Nothing, classes.Spend)),
            toggle,
            ScribePanel.own(panel, 'Trouble', trouble),
        );
        const body = ScribePanel.own(
            panel,
            'Body',
            ScribePanel.make(panel, tags.Block, settings.Nothing, classes.Body),
        );
        const nav = ScribePanel.make(panel, tags.Nav, settings.Nothing, classes.Tabs);
        nav.setAttribute(attributes.Role, aria.Tablist);
        nav.setAttribute(attributes.Label, words.Views);
        body.append(nav);
        for (const name of settings.Tabs) {
            const lower = name.toLowerCase();
            const tabId = settings.Prefixes.Tab + lower;
            const sectionId = settings.Prefixes.Section + lower;
            const tab = ScribePanel.button(
                panel,
                name,
                /**
                 * @return {Promise<void>}
                 */
                async () => {
                    panel.tab = name;
                    ScribePanel.redraw(panel);
                },
                settings.Guard.Free,
                tabId,
            );
            tab.id = tabId;
            tab.setAttribute(attributes.Role, aria.Tab);
            tab.setAttribute(attributes.Controls, sectionId);
            nav.append(tab);
            const section = ScribePanel.make(panel, tags.Section, settings.Nothing);
            section.id = sectionId;
            section.setAttribute(attributes.Role, aria.Tabpanel);
            section.setAttribute(attributes.LabelledBy, tabId);
            const title = ScribePanel.make(panel, tags.Title, name, classes.Title);
            title.id = settings.Prefixes.Title + lower;
            title.setAttribute(attributes.TabIndex, settings.Unfocusable);
            ScribePanel.keyed(panel, title, title.id);
            const failure = ScribePanel.make(panel, tags.Paragraph, settings.Nothing, classes.Problem);
            failure.id = settings.Prefixes.Failure + lower;
            failure.setAttribute(attributes.Role, aria.Alert);
            failure.hidden = true;
            section.append(title, failure);
            if (settings.Hollow.includes(name)) {
                const hollow = ScribePanel.make(panel, tags.Paragraph, settings.Nothing, classes.Hollow);
                hollow.id = settings.Prefixes.Empty + lower;
                hollow.hidden = true;
                panel.hollows[name] = hollow;
                section.append(hollow);
            }
            panel.making = name;
            panel.stale[name] = [];
            ScribePanel.Builders[name](panel, section);
            body.append(section);
            panel.tabs[name] = tab;
            panel.sections[name] = section;
            panel.titles[name] = title;
            panel.failures[name] = failure;
            panel.rowOf[name] = new Map();
            panel.existing[name] = new Set();
        }
        panel.making = null;
        aside.append(header, body);
        panel.root.append(ScribePanel.make(panel, tags.Style, PanelStyle.Text), aside);
        panel.building = false;
    },

    Builders: Object.freeze({
        /**
         * @param {object} panel
         * @param {object} section
         * @return {void}
         */
        Summary(panel, section) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const lists = settings.Lists;
            const needs = ScribePanel.group(panel, section, words.NeedsHeading);
            needs.append(
                ScribePanel.stale(
                    panel,
                    ScribePanel.own(
                        panel,
                        'Needs',
                        ScribePanel.make(panel, settings.Tags.Block, settings.Nothing, settings.Classes.Choices),
                    ),
                    false,
                ),
            );
            ScribePanel.pager(panel, lists.Cast, ScribePanel.group(panel, section, words.CastHeading));
            ScribePanel.group(panel, section, words.StandingHeading).append(
                ScribePanel.stale(
                    panel,
                    ScribePanel.own(
                        panel,
                        'Standing',
                        ScribePanel.make(panel, settings.Tags.List, settings.Nothing, settings.Classes.Rows),
                    ),
                    false,
                ),
            );
            ScribePanel.pager(panel, lists.Days, ScribePanel.group(panel, section, words.DaysHeading));
            ScribePanel.pager(panel, lists.Threads, ScribePanel.group(panel, section, words.ThreadsHeading));
        },

        /**
         * @param {object} panel
         * @param {object} section
         * @return {void}
         */
        Book(panel, section) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const tags = settings.Tags;
            const classes = settings.Classes;
            const ids = settings.Ids;
            const types = settings.InputTypes;
            const search = ScribePanel.field(panel, types.Text, words.Search, ids.Search, false, false);
            ScribePanel.own(panel, 'Search', search.input);
            ScribePanel.listen(
                panel,
                search.input,
                settings.Events.Input,
                /**
                 * @return {Promise<void>}
                 */
                async () => {
                    panel.query = search.input.value;
                    panel.pages[settings.Lists.Subjects] = settings.FirstPage;
                    ScribePanel.redraw(panel);
                },
            );
            section.append(search.label);
            ScribePanel.pager(panel, settings.Lists.Subjects, section);
            section.append(ScribePanel.own(panel, 'Recovered', ScribePanel.make(panel, tags.Block, settings.Nothing)));
            const detail = ScribePanel.stale(
                panel,
                ScribePanel.own(panel, 'Detail', ScribePanel.make(panel, tags.Block, settings.Nothing, classes.Detail)),
                true,
            );
            detail.hidden = true;
            detail.append(
                ScribePanel.own(panel, 'Heading', ScribePanel.make(panel, tags.Group, settings.Nothing)),
                ScribePanel.own(
                    panel,
                    'Names',
                    ScribePanel.make(panel, tags.Paragraph, settings.Nothing, classes.Meta),
                ),
            );
            ScribePanel.pager(panel, settings.Lists.Facts, detail);
            const categories = [];
            for (const [kind, names] of Object.entries(ScribeCategory.Settings.Words)) {
                if (kind !== ScribeCategory.Kind.Fixed) {
                    categories.push(...names);
                }
            }
            categories.push(ScribeCategory.Settings.RelationCategory);
            const add = ScribePanel.make(panel, tags.Block, settings.Nothing, classes.Form);
            const category = ScribePanel.select(panel, words.Category, ids.AddCategory, false);
            ScribePanel.own(panel, 'AddCategory', category.select);
            ScribePanel.options(
                panel,
                category.select,
                categories.map(
                    /**
                     * @param {string} name
                     * @return {[string, string]}
                     */
                    (name) => [name, name],
                ),
                categories[0],
            );
            const target = ScribePanel.select(panel, words.Target, ids.AddTarget, false);
            ScribePanel.own(panel, 'AddTarget', target.select);
            ScribePanel.own(panel, 'AddTargetField', target.label).hidden = true;
            ScribePanel.listen(
                panel,
                category.select,
                settings.Events.Change,
                /**
                 * @return {Promise<void>}
                 */
                async () => {
                    target.label.hidden = category.select.value !== ScribeCategory.Settings.RelationCategory;
                },
            );
            const text = ScribePanel.field(panel, types.Text, words.FactText, ids.AddText, true, false);
            ScribePanel.own(panel, 'AddText', text.input);
            const hidden = ScribePanel.field(panel, types.Checkbox, words.Hidden, ids.AddHidden, false, false);
            ScribePanel.own(panel, 'AddHidden', hidden.input);
            const adding = ScribePanel.make(panel, tags.Block, settings.Nothing, classes.Actions);
            adding.append(
                ScribePanel.own(
                    panel,
                    'AddFile',
                    ScribePanel.button(
                        panel,
                        words.AddButton,
                        /**
                         * @return {Promise<void>}
                         */
                        () => ScribePanel.addFact(panel),
                        settings.Guard.Book,
                        ids.AddFile,
                        classes.Primary,
                    ),
                ),
            );
            add.append(
                ScribePanel.make(panel, tags.Form, words.AddHeading),
                category.label,
                target.label,
                text.label,
                hidden.label,
                adding,
                ScribePanel.outlet(panel, 'AddOutcome', settings.Outlets.Add),
            );
            const split = ScribePanel.make(panel, tags.Block, settings.Nothing, classes.Form);
            const label = ScribePanel.field(panel, types.Text, words.SplitLabel, ids.SplitLabel, true, false);
            ScribePanel.own(panel, 'SplitLabel', label.input);
            const kind = ScribePanel.select(panel, words.SplitKind, ids.SplitKind, false);
            ScribePanel.own(panel, 'SplitKind', kind.select);
            const kinds = Object.values(ScribeCategory.SubjectKinds);
            ScribePanel.options(
                panel,
                kind.select,
                kinds.map(
                    /**
                     * @param {string} name
                     * @return {[string, string]}
                     */
                    (name) => [name, name],
                ),
                kinds[0],
            );
            const splitting = ScribePanel.make(panel, tags.Block, settings.Nothing, classes.Actions);
            splitting.append(
                ScribePanel.own(
                    panel,
                    'SplitFile',
                    ScribePanel.button(
                        panel,
                        words.SplitButton,
                        /**
                         * @return {Promise<void>}
                         */
                        () => ScribePanel.split(panel),
                        settings.Guard.Book,
                        ids.SplitFile,
                        classes.Danger,
                    ),
                ),
            );
            split.append(
                ScribePanel.make(panel, tags.Form, words.SplitHeading),
                label.label,
                kind.label,
                splitting,
                ScribePanel.outlet(panel, 'SplitOutcome', settings.Outlets.Split),
            );
            detail.append(add, split);
            section.append(detail);
        },

        /**
         * @param {object} panel
         * @param {object} section
         * @return {void}
         */
        Timeline(panel, section) {
            ScribePanel.pager(panel, ScribePanel.Settings.Lists.Timeline, section);
        },

        /**
         * @param {object} panel
         * @param {object} section
         * @return {void}
         */
        Rulings(panel, section) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const lists = settings.Lists;
            const tags = settings.Tags;
            const classes = settings.Classes;
            const telling = ScribePanel.group(panel, section, words.TellHeading);
            const field = ScribePanel.field(
                panel,
                settings.InputTypes.Area,
                words.TellLabel,
                settings.Ids.Tell,
                true,
                false,
            );
            ScribePanel.own(panel, 'Tell', field.input);
            const working = ScribePanel.make(panel, tags.Block, settings.Nothing, classes.Actions);
            working.append(
                ScribePanel.own(
                    panel,
                    'Work',
                    ScribePanel.button(
                        panel,
                        words.Work,
                        /**
                         * @return {Promise<void>}
                         */
                        () => ScribePanel.tell(panel),
                        settings.Guard.Change,
                        settings.Ids.Work,
                        classes.Primary,
                    ),
                ),
            );
            telling.append(
                field.label,
                ScribePanel.make(panel, tags.Paragraph, words.TellNote, classes.Meta),
                working,
                ScribePanel.outlet(panel, 'TellOutcome', settings.Outlets.Tell),
                ScribePanel.stale(
                    panel,
                    ScribePanel.own(panel, 'Understood', ScribePanel.make(panel, tags.Block, settings.Nothing)),
                    false,
                ),
            );
            const keeping = ScribePanel.make(panel, tags.Block, settings.Nothing, classes.Actions);
            keeping.append(
                ScribePanel.own(
                    panel,
                    'KeepFirst',
                    ScribePanel.button(
                        panel,
                        words.KeepFirst,
                        /**
                         * @return {Promise<void>}
                         */
                        () => ScribePanel.keepFirst(panel),
                        settings.Guard.Book,
                        settings.Ids.KeepFirst,
                    ),
                ),
            );
            section.append(keeping, ScribePanel.outlet(panel, 'KeepOutcome', settings.Outlets.Keep));
            ScribePanel.pager(panel, lists.Conflicts, ScribePanel.group(panel, section, words.ConflictsHeading));
            ScribePanel.pager(panel, lists.Likes, ScribePanel.group(panel, section, words.LikesHeading));
            ScribePanel.pager(panel, lists.Scenes, ScribePanel.group(panel, section, words.ScenesHeading));
            ScribePanel.pager(panel, lists.Questions, ScribePanel.group(panel, section, words.QuestionsHeading));
            ScribePanel.pager(panel, lists.Processing, ScribePanel.group(panel, section, 'Answers awaiting processing'));
            ScribePanel.pager(
                panel,
                lists.Contradictions,
                ScribePanel.group(panel, section, words.ContradictionsHeading),
            );
            ScribePanel.pager(panel, lists.Aliases, ScribePanel.group(panel, section, words.AliasesHeading));
            ScribePanel.pager(panel, lists.Refinements, ScribePanel.group(panel, section, words.RefinementsHeading));
            ScribePanel.pager(panel, lists.Made, ScribePanel.group(panel, section, words.MadeHeading));
        },

        /**
         * @param {object} panel
         * @param {object} section
         * @return {void}
         */
        Findings(panel, section) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const next = ScribePanel.group(panel, section, words.NextHeading);
            const reminder = ScribePanel.field(
                panel,
                settings.InputTypes.Area,
                words.ReminderLabel,
                settings.Ids.Reminder,
                false,
                false,
            );
            ScribePanel.own(panel, 'Reminder', reminder.input);
            const editing = ScribePanel.make(panel, settings.Tags.Block, settings.Nothing, settings.Classes.Actions);
            editing.append(
                ScribePanel.own(
                    panel,
                    'Edit',
                    ScribePanel.button(
                        panel,
                        words.Edit,
                        /**
                         * @return {Promise<void>}
                         */
                        async () => ScribePanel.openEdit(panel),
                        settings.Guard.Free,
                        settings.Ids.Edit,
                    ),
                ),
                ScribePanel.own(
                    panel,
                    'EditCancel',
                    ScribePanel.button(
                        panel,
                        words.EditCancel,
                        /**
                         * @return {Promise<void>}
                         */
                        async () => ScribePanel.closeEdit(panel, false),
                        settings.Guard.Free,
                        settings.Ids.EditCancel,
                    ),
                ),
                ScribePanel.own(
                    panel,
                    'EditSave',
                    ScribePanel.button(
                        panel,
                        words.EditSave,
                        /**
                         * @return {Promise<void>}
                         */
                        async () => ScribePanel.closeEdit(panel, true),
                        settings.Guard.Free,
                        settings.Ids.EditSave,
                        settings.Classes.Primary,
                    ),
                ),
            );
            next.append(
                reminder.label,
                ScribePanel.outlet(panel, 'ReminderOutcome', settings.Outlets.Reminder),
                editing,
            );
            ScribePanel.pager(panel, settings.Lists.Queued, next);
            const clearing = ScribePanel.make(panel, settings.Tags.Block, settings.Nothing, settings.Classes.Actions);
            clearing.append(
                ScribePanel.own(
                    panel,
                    'Clear',
                    ScribePanel.button(
                        panel,
                        words.Clear,
                        /**
                         * @return {Promise<boolean>}
                         */
                        () =>
                            ScribePanel.perform(panel, {
                                outlet: settings.Outlets.Clear,
                                /**
                                 * @return {void}
                                 */
                                call: () => {
                                    panel.editing = false;
                                    ScribePanel.say(panel, settings.Outlets.Reminder, settings.Nothing);
                                    panel.live.clear();
                                },
                                question: null,
                                done: settings.Nothing,
                                pending: words.Saving,
                                book: false,
                            }),
                        settings.Guard.Change,
                        settings.Ids.Clear,
                    ),
                ),
                ScribePanel.own(
                    panel,
                    'Force',
                    ScribePanel.button(
                        panel,
                        words.Force,
                        /**
                         * @return {Promise<void>}
                         */
                        () => ScribePanel.force(panel),
                        settings.Guard.Free,
                        settings.Ids.Force,
                        settings.Classes.Primary,
                    ),
                ),
            );
            next.append(
                clearing,
                ScribePanel.outlet(panel, 'ClearOutcome', settings.Outlets.Clear),
                ScribePanel.outlet(panel, 'ForceOutcome', settings.Outlets.Force),
                ScribePanel.stale(
                    panel,
                    ScribePanel.own(
                        panel,
                        'ForceReason',
                        ScribePanel.make(panel, settings.Tags.Paragraph, settings.Nothing, settings.Classes.Meta),
                    ),
                    true,
                ),
                ScribePanel.stale(
                    panel,
                    ScribePanel.own(
                        panel,
                        'Held',
                        ScribePanel.make(panel, settings.Tags.Paragraph, settings.Nothing, settings.Classes.Meta),
                    ),
                    true,
                ),
            );
            const offer = ScribePanel.group(panel, section, words.OfferHeading);
            offer.append(
                ScribePanel.stale(
                    panel,
                    ScribePanel.own(
                        panel,
                        'OfferText',
                        ScribePanel.make(panel, settings.Tags.Paragraph, settings.Nothing, settings.Classes.Offer),
                    ),
                    true,
                ),
                ScribePanel.stale(
                    panel,
                    ScribePanel.own(
                        panel,
                        'OfferActions',
                        ScribePanel.make(panel, settings.Tags.Block, settings.Nothing, settings.Classes.Actions),
                    ),
                    false,
                ),
                ScribePanel.outlet(panel, 'OfferOutcome', settings.Outlets.Offer),
            );
            ScribePanel.pager(panel, settings.Lists.Findings, ScribePanel.group(panel, section, words.FindingsHeading));
            ScribePanel.pager(panel, settings.Lists.RuledFindings, ScribePanel.group(panel, section, 'Ruled findings'));
        },

        /**
         * @param {object} panel
         * @param {object} section
         * @return {void}
         */
        Progress(panel, section) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const tags = settings.Tags;
            const classes = settings.Classes;
            const ids = settings.Ids;
            const guards = settings.Guard;
            const outlets = settings.Outlets;
            const keeper = panel.keeper;

            /**
             * @param {() => *} call
             * @param {boolean} book
             * @return {() => Promise<boolean>}
             */
            const command = (call, book) =>
                /**
                 * @return {Promise<boolean>}
                 */
                () =>
                    ScribePanel.perform(panel, {
                        outlet: outlets.Controls,
                        call,
                        question: null,
                        done: settings.Nothing,
                        pending: words.Working,
                        book,
                    });
            const controls = ScribePanel.make(panel, tags.Block, settings.Nothing, classes.Actions);
            controls.append(
                ScribePanel.own(
                    panel,
                    'Pull',
                    ScribePanel.button(
                        panel,
                        words.Pull,
                        command(
                            /**
                             * @return {Promise<void>}
                             */
                            () => keeper.pull(),
                            true,
                        ),
                        guards.Book,
                        ids.Pull,
                    ),
                ),
                ScribePanel.own(
                    panel,
                    'Pause',
                    ScribePanel.button(
                        panel,
                        words.Pause,
                        command(
                            /**
                             * @return {void}
                             */
                            () => keeper.pause(),
                            false,
                        ),
                        guards.Change,
                        ids.Pause,
                    ),
                ),
                ScribePanel.own(
                    panel,
                    'Resume',
                    ScribePanel.button(
                        panel,
                        words.Resume,
                        () => ScribePanel.resume(panel, outlets.Controls),
                        guards.Book,
                        ids.Resume,
                    ),
                ),
                ScribePanel.own(
                    panel,
                    'Export',
                    ScribePanel.button(
                        panel,
                        words.Export,
                        /**
                         * @return {Promise<void>}
                         */
                        () => ScribePanel.exportChat(panel),
                        guards.Free,
                        ids.Export,
                    ),
                ),
                ScribePanel.own(
                    panel,
                    'Adopt',
                    ScribePanel.button(
                        panel,
                        words.StartOver,
                        /**
                         * @return {Promise<void>}
                         */
                        () => ScribePanel.adopt(panel, outlets.Controls),
                        guards.Book,
                        ids.Adopt,
                    ),
                ),
            );
            const pulled = ScribePanel.stale(
                panel,
                ScribePanel.own(
                    panel,
                    'Pulled',
                    ScribePanel.make(panel, tags.Paragraph, settings.Nothing, classes.Meta),
                ),
                true,
            );
            pulled.hidden = true;
            const story = ScribePanel.stale(
                panel,
                ScribePanel.own(
                    panel,
                    'Story',
                    ScribePanel.make(panel, tags.Paragraph, settings.Nothing, classes.Meta),
                ),
                true,
            );
            story.hidden = true;
            const checked = ScribePanel.own(panel, 'Checked', ScribePanel.make(panel, tags.Paragraph, settings.Nothing, classes.Meta));
            checked.hidden = true;
            const details = ScribePanel.own(panel, 'ProblemDetails', ScribePanel.make(panel, tags.Block, settings.Nothing, classes.Meta));
            const retry = ScribePanel.own(panel, 'StoryRetry', ScribePanel.button(panel, 'Retry', async () => {
                const displayed = panel.storyRetry;
                if (displayed) {
                    return command(() => keeper.retryStory(displayed), true)();
                }
            }, guards.Book, ids.StoryRetry));
            retry.hidden = true;
            const inputRetry = ScribePanel.own(panel, 'InputRetry', ScribePanel.button(panel, 'Retry input', async () => {
                if (panel.inputRetry) {
                    return command(() => keeper.retryStory(panel.inputRetry), true)();
                }
            }, guards.Book, ids.InputRetry));
            inputRetry.hidden = true;
            section.append(controls, ScribePanel.outlet(panel, 'ControlsOutcome', outlets.Controls), details, retry, inputRetry, checked, story, pulled);
            const filing = ScribePanel.own(panel, 'FilingGroup', ScribePanel.group(panel, section, 'Pending book entries, checker rows and operator input'));
            filing.hidden = true;
            ScribePanel.pager(panel, settings.Lists.Filing, filing);
            const disputed = ScribePanel.own(panel, 'DisputedGroup', ScribePanel.group(panel, section, words.DisputedHeading));
            disputed.hidden = true;
            ScribePanel.pager(panel, settings.Lists.Disputed, disputed);
            ScribePanel.pager(panel, settings.Lists.Lines, ScribePanel.group(panel, section, words.LinesHeading));
            ScribePanel.pager(panel, settings.Lists.Calls, ScribePanel.group(panel, section, words.CallsHeading));
            ScribePanel.pager(
                panel,
                settings.Lists.LiveCalls,
                ScribePanel.group(panel, section, words.LiveCallsHeading),
            );
        },

        /**
         * @param {object} panel
         * @param {object} section
         * @return {void}
         */
        Settings(panel, section) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const tags = settings.Tags;
            const classes = settings.Classes;
            const attributes = settings.Attributes;
            const ids = settings.Ids;
            const guards = settings.Guard;
            const outlets = settings.Outlets;
            const notes = ScribePanel.own(panel, 'Notes', ScribePanel.make(panel, tags.Paragraph, settings.Nothing));
            notes.hidden = true;
            section.append(
                ScribePanel.own(panel, 'CloudState', ScribePanel.make(panel, tags.Paragraph, settings.Nothing)),
                notes,
                ScribePanel.own(panel, 'KeyState', ScribePanel.make(panel, tags.Paragraph, settings.Nothing)),
            );
            const key = ScribePanel.field(panel, settings.InputTypes.Password, words.KeyLabel, ids.Key, false, false);
            ScribePanel.own(panel, 'Key', key.input);
            key.input.addEventListener(settings.Events.Input, () => {
                panel.draftVersion = panel.keyVersion();
                ScribePanel.mark(panel, ids.Key, false);
                ScribePanel.say(panel, outlets.Key, settings.Nothing);
            });
            const keying = ScribePanel.make(panel, tags.Block, settings.Nothing, classes.Actions);
            keying.append(
                ScribePanel.own(
                    panel,
                    'SaveKey',
                    ScribePanel.button(
                        panel,
                        words.SaveKey,
                        /**
                         * @return {Promise<void>}
                         */
                        () => ScribePanel.saveKey(panel),
                        guards.Loose,
                        ids.SaveKey,
                        classes.Primary,
                    ),
                ),
            );
            section.append(key.label, keying, ScribePanel.outlet(panel, 'KeyOutcome', outlets.Key));
            for (const item of settings.Setup) {
                const id = settings.Prefixes.Setting + item.name;
                const entry = ScribePanel.field(panel, settings.InputTypes.Text, item.label, id, true, false);
                entry.input.id = id;
                entry.input.setAttribute(attributes.InputMode, item.mode);
                const problem = ScribePanel.make(panel, tags.Paragraph, settings.Nothing, classes.Problem);
                problem.id = id + settings.Suffixes.Problem;
                panel.setup[item.name] = { input: entry.input, problem };
                ScribePanel.listen(
                    panel,
                    entry.input,
                    settings.Events.Input,
                    /**
                     * @return {Promise<void>}
                     */
                    async () => {
                        const refused = [outlets.Next, outlets.Controls].filter(
                            /**
                             * @param {string} outlet
                             * @return {boolean}
                             */
                            (outlet) => panel.outcomes.get(outlet) === words.AdoptFix,
                        );
                        if (
                            refused.length === settings.NoCount ||
                            panel.fixing !== item.name ||
                            ScribePanel.form(panel).problems.has(item.name)
                        ) {
                            return;
                        }
                        panel.fixing = null;
                        for (const outlet of refused) {
                            ScribePanel.say(panel, outlet, settings.Nothing);
                        }
                        ScribePanel.redraw(panel);
                    },
                );
                section.append(entry.label, problem);
            }
            const saving = ScribePanel.make(panel, tags.Block, settings.Nothing, classes.Actions);
            saving.append(
                ScribePanel.own(
                    panel,
                    'SaveSettings',
                    ScribePanel.button(
                        panel,
                        words.SaveSettings,
                        /**
                         * @return {Promise<void>}
                         */
                        () => ScribePanel.saveSettings(panel),
                        guards.Book,
                        ids.SaveSettings,
                        classes.Primary,
                    ),
                ),
            );
            section.append(saving, ScribePanel.outlet(panel, 'SettingsOutcome', outlets.Settings));
        },
    }),

    /**
     * @param {object} panel
     * @return {void}
     */
    lockAll(panel) {
        panel.storyRetry = null;
        panel.parts.StoryRetry.hidden = true;
        panel.inputRetry = null;
        panel.parts.InputRetry.hidden = true;
        for (const lists of [panel.held, panel.guarded]) {
            for (const controls of Object.values(lists)) {
                for (const control of controls) {
                    control.disabled = true;
                }
            }
        }
        panel.parts.Reminder.disabled = true;
        panel.parts.Edit.disabled = true;
        panel.parts.EditCancel.disabled = true;
        panel.parts.EditSave.disabled = true;
        panel.parts.Force.disabled = true;
        panel.parts.UseCloud.disabled = true;
        panel.parts.KeepHere.disabled = true;
    },

    /**
     * @param {object} panel
     * @param {string} text
     * @return {void}
     */
    alarm(panel, text) {
        ScribePanel.write(panel.parts.Trouble, ScribeStore.diagnostic(panel.storage, text));
        panel.parts.Trouble.hidden = false;
    },

    /**
     * @param {object} panel
     * @return {void}
     */
    redraw(panel) {
        if (!panel.mounted) {
            return;
        }
        if (panel.composing) {
            panel.heldDraw = true;
            return;
        }
        const settings = ScribePanel.Settings;
        const words = settings.Words;
        panel.shown = new Set();
        let view = null;
        let live = null;
        let cloud = null;
        try {
            const kept = panel.keeper.view();
            if (panel.factDraft && panel.factDraft.room !== kept.roomId) {
                panel.factDraft = null;
                panel.factInput = null;
            }
            const heard = panel.live.view();
            if (panel.editing && panel.editOffer && (heard.settledOffers?.includes(panel.editOffer) ||
                heard.lastDelivery === panel.editOffer) && panel.parts.Reminder.value === panel.editFrom) {
                panel.editing = false;
            }
            const synced = panel.cloud.view();
            let hasKey = null;
            try {
                hasKey = ScribeStore.key(panel.storage) !== settings.Nothing;
            } catch {
                hasKey = null;
            }
            const mask = (text) => ScribeStore.diagnostic(panel.storage, text ?? null);
            cloud = {
                ...synced,
                keyed: synced.keyed === true,
                conflict: synced.conflict ?? null,
                notes: synced.notes ?? null,
                problem: mask(synced.problem),
            };
            view = {
                ...kept,
                hasKey,
                previousKey: PanelView.previousKey(kept),
                keyProblem: panel.keyProblem(),
                keyRecoveryProblem: panel.keyRecoveryProblem(),
                made: kept.made ?? [],
                lastRead: kept.lastRead ?? null,
                checkerFindings: PanelView.checkerFindings(kept.state, kept.checkerFindings, heard.findings),
                unread: kept.unread ?? [],
                pulled: kept.pulled ?? null,
                adoptBlock: mask(kept.adoptBlock),
                busy: kept.busy ?? null,
                flight: kept.flight ?? null,
                stop: kept.stop ? { ...kept.stop, problem: mask(kept.stop.problem) } : null,
                problem: mask(kept.problem),
                checkerProblem: kept.checkerProblem ? { ...kept.checkerProblem, reason: mask(kept.checkerProblem.reason) } : null,
                calls: kept.calls ?? [],
                lines: kept.lines ?? [],
            };
            live = {
                ...heard,
                offer: heard.offer ?? null,
                understood: heard.understood ?? null,
                findings: PanelView.listed(heard.findings).filter((finding) => !view.checkerFindings.some((check) =>
                    check.id && PanelView.sameFinding(kept.state, check, finding))),
                problem: mask(heard.problem),
                ready: heard.ready ?? null,
                edited: heard.edited ?? false,
                prepared: heard.prepared ?? false,
                due: heard.due ?? false,
                forced: heard.forced ?? false,
                forceBlock: mask(heard.forceBlock),
                suggestion: heard.suggestion ?? null,
                notice: mask(heard.notice),
                held: mask(heard.held),
                draft: heard.draft ?? null,
                stale: heard.stale ?? false,
                failing: PanelView.listed(heard.failing).filter((failure) => failure && typeof failure.reason === 'string')
                    .map((failure) => ({ ...failure, reason: mask(failure.reason) })),
                calls: heard.calls ?? [],
            };
        } catch (error) {
            ScribePanel.lockAll(panel);
            ScribePanel.alarm(panel, words.Trouble + ScribePanel.reason(error));
            return;
        }
        ScribePanel.clearFailures(panel, view);
        try {
            ScribePanel.header(panel, view, live, cloud);
        } catch (error) {
            for (const name of ['Headline', 'Badge', 'Spend']) {
                ScribePanel.write(panel.parts[name], settings.Nothing);
            }
            panel.parts.Badge.hidden = true;
            panel.parts.Next.hidden = true;
            panel.parts.Choice.hidden = true;
            panel.parts.Activity.hidden = true;
            ScribePanel.stopClock(panel);
            ScribePanel.fold(panel);
            ScribePanel.alarm(panel, words.Trouble + ScribePanel.reason(error));
        }
        if (!panel.open) {
            return;
        }
        try {
            ScribePanel.draw(panel, view, live, cloud);
        } catch (error) {
            ScribePanel.lockAll(panel);
            ScribePanel.alarm(panel, words.Trouble + ScribePanel.reason(error));
        }
    },

    /**
     * @param {number|null} count
     * @return {string}
     */
    readCount(count) {
        const words = ScribePanel.Settings.Words;
        if (count === null) {
            return words.NoBookThere;
        }
        return PanelView.number(count) + (count === ScribePanel.Settings.Single ? words.ReadOne : words.ReadMany);
    },

    /**
     * @param {object} panel
     * @param {object} view
     * @param {object} live
     * @param {object} cloud
     * @return {void}
     */
    header(panel, view, live, cloud) {
        const settings = ScribePanel.Settings;
        const words = settings.Words;
        const parts = panel.parts;
        ScribePanel.fold(panel);
        ScribePanel.write(parts.Headline, PanelView.headline(view, live, cloud));
        const problems = PanelView.problems(view, live, cloud);
        const paragraph = (text) => ScribePanel.make(panel, settings.Tags.Paragraph, text);
        const summaries = problems.map((problem) => problem.explanation);
        if (panel.problemSummary !== JSON.stringify(summaries)) {
            panel.problemSummary = JSON.stringify(summaries);
            parts.Problems.replaceChildren(...summaries.map(paragraph));
        }
        parts.Problems.hidden = !panel.open || problems.length === 0;
        parts.ProblemsCompact.hidden = panel.open || problems.length === 0;
        const compact = problems.length === 1 ? problems[0].label : problems.length + ' problems';
        ScribePanel.write(parts.ProblemsCompact, problems.length ? compact : settings.Nothing);
        const details = problems.flatMap((problem) => problem.details.map((detail) =>
            paragraph(problem.service + ' · ' + problem.operations.join(', ') + ' · ' + detail),
        ));
        parts.ProblemDetails.replaceChildren(...details);
        parts.ProblemDetails.hidden = details.length === 0;
        panel.storyRetry = view.reader && view.hasKey && !view.keyProblem ? view.storyRetry ?? null : null;
        panel.inputRetry = view.reader && view.hasKey && !view.keyProblem ? view.inputRetry ?? null : null;
        parts.InputRetry.hidden = panel.inputRetry === null;
        if (panel.inputRetry) {
            ScribePanel.write(parts.InputRetry, 'Retry operator input at #' + panel.inputRetry.first);
        }
        parts.StoryRetry.hidden = panel.storyRetry === null;
        if (panel.storyRetry) {
            const { first, through } = panel.storyRetry;
            ScribePanel.write(parts.StoryRetry, first === through ? 'Retry #' + first : 'Retry #' + first + '–#' + through);
        }
        const choiceOutlet = settings.Outlets.Choice;
        const conflict = cloud.phase === ScribeCloud.Phase.Conflict ? cloud.conflict : null;
        parts.Choice.hidden = conflict === null;
        if (conflict !== null) {
            const here = words.ChoiceHere + ScribePanel.readCount(conflict.here ?? null);
            const there = words.ChoiceThere + ScribePanel.readCount(conflict.there ?? null);
            ScribePanel.write(parts.ChoiceCounts, here + there);
            panel.shown.add(choiceOutlet);
        }
        const choosing = panel.pending.has(choiceOutlet);
        parts.UseCloud.disabled = choosing;
        parts.KeepHere.disabled = choosing;
        const forcing = panel.calls.due();
        if (!forcing && panel.root.activeElement === parts.ForceStop) {
            parts.Toggle.focus();
        }
        parts.ForceStop.hidden = !forcing;
        ScribePanel.write(parts.ChoiceOutcome, panel.outcomes.get(choiceOutlet) ?? settings.Nothing);
        const step = PanelView.next(view);
        ScribePanel.fill(panel, view);
        panel.step = step;
        if (step === null && panel.root.activeElement === parts.Next) {
            parts.Toggle.focus();
        }
        parts.Next.hidden = step === null;
        const adopting = step === PanelView.Step.Adopt;
        const routine = view.flight === ScribeKeeper.Settings.Flight.Looking;
        const ruled = routine ? !view.reader || panel.busy > 0 : ScribePanel.ruled(panel, view);
        const resuming = step === PanelView.Step.Resume && view.reader && view.stop?.reason === ScribeAdoption.Stop.Paused;
        parts.Next.disabled = !resuming && (ruled || (adopting && view.adoptBlock !== null));
        const adoptLabel = cloud.bookRevision === 0 && !cloud.lookupFailed && !cloud.unreadable && [ScribeCloud.Phase.Leading, ScribeCloud.Phase.Watching].includes(cloud.phase)
            ? words.Adopt : 'Start a new local book';
        ScribePanel.write(parts.Next, adopting ? adoptLabel : words.Resume);
        let said = panel.outcomes.get(settings.Outlets.Next) ?? settings.Nothing;
        if (said === settings.Nothing && adopting) {
            said = view.adoptBlock === view.problem ? settings.Nothing : view.adoptBlock ?? settings.Nothing;
        }
        ScribePanel.write(parts.NextOutcome, said);
        parts.NextOutcome.hidden = said === settings.Nothing;
        panel.shown.add(settings.Outlets.Next);
        const flying = view.flight !== null;
        parts.Activity.hidden = !flying;
        if (flying) {
            const reading =
                view.flight.startsWith(ScribeKeeper.Settings.Flight.ReadOpen) ||
                [ScribeKeeper.Settings.Flight.Answers, ScribeKeeper.Settings.Flight.Finishing].includes(view.flight);
            if (reading && view.total > settings.NoCount) {
                parts.Meter.setAttribute(settings.Attributes.Max, String(view.total));
                parts.Meter.setAttribute(settings.Attributes.Value, String(view.read));
            } else {
                parts.Meter.removeAttribute(settings.Attributes.Max);
                parts.Meter.removeAttribute(settings.Attributes.Value);
            }
            ScribePanel.write(parts.Counts, PanelView.progress(view));
            const newest = PanelView.listed(view.lines)[0];
            parts.Finished.hidden = !PanelView.entry(newest);
            ScribePanel.write(
                parts.Finished,
                PanelView.entry(newest) ? words.LastFinished + ScribeStore.diagnostic(panel.storage, PanelView.finished(newest)) : settings.Nothing,
            );
            panel.began = view.began ?? null;
            ScribePanel.tick(panel);
            if (panel.timer === null) {
                panel.timer = panel.document.defaultView.setInterval(
                    /**
                     * @return {void}
                     */
                    () => ScribePanel.tick(panel),
                    settings.ClockMs,
                );
            }
        } else {
            ScribePanel.stopClock(panel);
        }
        for (const name of settings.Hollow) {
            const sentence = PanelView.empty(view, cloud);
            ScribePanel.write(panel.hollows[name], sentence ?? settings.Nothing);
            panel.hollows[name].hidden = sentence === null;
        }
        const needs = PanelView.needs(view.state);
        const ruling = needs.conflicts + needs.lookAlikes + needs.questions;
        const open = PanelView.listed(view.checkerFindings).filter((finding) => finding.status !== 'settled').length + PanelView.tally(
            live.findings,
            /**
             * @param {{ status: string }} finding
             * @return {boolean}
             */
            (finding) => finding.status === ScribeLive.Status.Open,
        );
        const badge = [];
        if (ruling > 0) {
            badge.push(BenchView.count(ruling) + words.ToRule);
        }
        if (open > 0) {
            badge.push(BenchView.count(open) + (open === settings.Single ? words.Finding : words.Findings));
        }
        ScribePanel.write(parts.Badge, badge.join(words.Comma));
        parts.Badge.hidden = badge.length === 0;
        const spent = view.spentToday;
        const priced = typeof spent === settings.NumberType && Number.isFinite(spent);
        ScribePanel.write(parts.Spend, priced ? BenchView.money(spent) + words.Today : settings.Nothing);
        ScribePanel.write(parts.Trouble, panel.trouble);
        parts.Trouble.hidden = panel.trouble === settings.Nothing;
    },

    /**
     * @param {object} panel
     * @param {object} view
     * @param {object} live
     * @param {object} cloud
     * @return {void}
     */
    draw(panel, view, live, cloud) {
        const settings = ScribePanel.Settings;
        const words = settings.Words;
        const focused = ScribePanel.remember(panel);
        const previous = panel.rowOf[panel.tab];
        panel.follow = focused === null ? null : (previous.get(focused) ?? null);
        panel.fields = [];
        panel.keyed = new Map();
        panel.guarded = { Book: [], Change: [], Loose: [] };
        panel.waiting = new Map();
        panel.rowOf[panel.tab] = new Map();
        panel.existing[panel.tab] = new Set();
        for (const name of settings.Tabs) {
            const open = name === panel.tab;
            panel.sections[name].hidden = !open;
            panel.tabs[name].setAttribute(settings.Attributes.Selected, String(open));
        }
        const failure = panel.failures[panel.tab];
        try {
            ScribePanel.Drawers[panel.tab](panel, view, live, cloud);
            ScribePanel.write(failure, settings.Nothing);
            failure.hidden = true;
        } catch (error) {
            for (const left of panel.stale[panel.tab]) {
                if (left.hide) {
                    left.element.hidden = true;
                } else {
                    left.element.replaceChildren();
                }
            }
            ScribePanel.write(failure, words.TabFailed + ScribeStore.diagnostic(panel.storage, ScribePanel.reason(error)));
            failure.hidden = false;
        }
        for (const [key, outlet] of panel.outlets) {
            if (settings.HeaderOutlets.includes(key)) {
                continue;
            }
            ScribePanel.write(outlet, panel.outcomes.get(key) ?? settings.Nothing);
            if (panel.outletTabs.get(key) === panel.tab) {
                panel.shown.add(key);
            }
        }
        for (const outlet of [...panel.fleeting]) {
            if (panel.outletTabs.get(outlet) === panel.tab) {
                panel.outcomes.delete(outlet);
                panel.fleeting.delete(outlet);
            }
        }
        ScribePanel.lock(panel, view);
        ScribePanel.restore(panel, focused);
        panel.drawnTab = panel.tab;
        panel.follow = null;
        const existing = new Set();
        for (const rows of Object.values(panel.existing)) {
            for (const row of rows) {
                existing.add(row);
            }
        }
        for (const [key, kept] of [...panel.typed]) {
            if (!existing.has(kept.row)) {
                panel.typed.delete(key);
            }
        }
    },

    /**
     * @param {object} panel
     * @return {void}
     */
    tick(panel) {
        const settings = ScribePanel.Settings;
        const span = panel.began === null ? settings.NoCount : panel.clock.now() - panel.began;
        ScribePanel.write(panel.parts.Clock, settings.Words.StepOpen + PanelView.elapsed(span));
    },

    /**
     * @param {object} panel
     * @return {void}
     */
    stopClock(panel) {
        if (panel.timer === null) {
            return;
        }
        panel.document.defaultView.clearInterval(panel.timer);
        panel.timer = null;
    },

    /**
     * @param {object} panel
     * @param {object} view
     * @return {void}
     */
    fill(panel, view) {
        const settings = ScribePanel.Settings;
        const filled = JSON.stringify(view.settings);
        if (filled === panel.filled) {
            return;
        }
        for (const item of settings.Setup) {
            const value = view.settings[item.name];
            const shown = typeof value === settings.StringType || typeof value === settings.NumberType;
            panel.setup[item.name].input.value = shown ? String(value) : settings.Nothing;
        }
        panel.filled = filled;
    },

    /**
     * @param {object} panel
     * @param {object} view
     * @return {boolean}
     */
    ruled(panel, view) {
        return !view.reader || (view.flight !== null && view.busy !== ScribeKeeper.Busy.Checking) || panel.busy > 0;
    },

    /**
     * @param {object} panel
     * @param {object} view
     * @return {void}
     */
    lock(panel, view) {
        const phases = ScribeKeeper.Phase;
        const parts = panel.parts;
        const ruled = ScribePanel.ruled(panel, view) || (view.busy !== null && view.busy !== ScribeKeeper.Busy.Checking);
        for (const control of [...panel.held.Book, ...panel.guarded.Book]) {
            control.disabled = ruled;
        }
        for (const control of [...panel.held.Change, ...panel.guarded.Change]) {
            control.disabled = !view.reader;
        }
        for (const control of [...panel.held.Loose, ...panel.guarded.Loose]) {
            control.disabled = false;
        }
        if (view.phase === phases.Loading || view.phase === phases.NoBook) {
            parts.Resume.disabled = true;
        }
        for (const [outlet, controls] of panel.waiting) {
            if (!panel.pending.has(outlet)) {
                continue;
            }
            for (const control of controls) {
                control.disabled = true;
            }
        }
        if (view.reader && view.phase === phases.Stopped && view.stop?.reason === ScribeAdoption.Stop.Paused) {
            parts.Resume.disabled = false;
        }
    },

    /**
     * @param {object} panel
     * @return {string|null}
     */
    remember(panel) {
        const settings = ScribePanel.Settings;
        if (panel.factDraft && panel.factInput) {
            panel.factDraft.text = panel.factInput.value;
        }
        panel.factInput = null;
        const rows = panel.rowOf[panel.drawnTab];
        for (const field of panel.fields) {
            const key = panel.keys.get(field);
            panel.typed.set(key, { value: field.value, checked: field.checked, row: rows.get(key) ?? null });
        }
        panel.selection = null;
        const pending = panel.lastKey;
        panel.lastKey = null;
        const inside = panel.root.activeElement;
        if (inside === null) {
            return null;
        }
        if (typeof inside.selectionStart === settings.NumberType) {
            panel.selection = {
                start: inside.selectionStart,
                end: inside.selectionEnd,
                direction: inside.selectionDirection,
            };
        }
        if (pending !== null && inside === panel.titles[panel.tab]) {
            return pending;
        }
        return panel.keys.get(inside) ?? null;
    },

    /**
     * @param {object} panel
     * @param {string|null} focused
     * @return {void}
     */
    restore(panel, focused) {
        const settings = ScribePanel.Settings;
        for (const field of panel.fields) {
            const kept = panel.typed.get(panel.keys.get(field));
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
        let target = panel.keyed.get(focused) ?? panel.fixed.get(focused);
        const row = [panel.parts.Edit, panel.parts.EditCancel, panel.parts.EditSave];
        if (target !== undefined && target.hidden && row.includes(target)) {
            target = row.find((control) => !control.hidden && !control.disabled) ?? panel.parts.Reminder;
        }
        if (target !== undefined && !target.disabled) {
            target.focus();
            const selection = panel.selection;
            if (selection !== null && typeof target.setSelectionRange === settings.FunctionType) {
                target.setSelectionRange(selection.start, selection.end, selection.direction);
            }
            return;
        }
        if (target !== undefined) {
            panel.lastKey = focused;
        }
        panel.titles[panel.tab].focus({ preventScroll: true });
    },

    /**
     * @param {object} panel
     * @param {{ outlet: string, call: () => *, question: string|null, done: string, pending: string, book: boolean }} request
     * @return {Promise<boolean>}
     */
    async perform(panel, request) {
        const settings = ScribePanel.Settings;
        const outlet = request.outlet;
        if (request.question !== null && !panel.confirm(request.question)) {
            ScribePanel.say(panel, outlet, settings.Nothing);
            ScribePanel.redraw(panel);
            return false;
        }
        if (request.book) {
            panel.busy++;
        }
        panel.pending.set(outlet, (panel.pending.get(outlet) ?? settings.NoCount) + 1);
        let filed = false;
        let outcome = settings.Nothing;
        try {
            ScribePanel.say(panel, outlet, request.pending);
            ScribePanel.redraw(panel);
            try {
                await request.call();
                filed = true;
                outcome = request.done;
            } catch (error) {
                outcome = ScribePanel.refusal(error);
            }
        } finally {
            if (request.book) {
                panel.busy--;
            }
            const left = panel.pending.get(outlet) - 1;
            if (left > settings.NoCount) {
                panel.pending.set(outlet, left);
            } else {
                panel.pending.delete(outlet);
            }
        }
        if (filed) {
            ScribePanel.say(panel, outlet, outcome);
            panel.trouble = settings.Nothing;
        } else {
            ScribePanel.fail(panel, outlet, outcome);
        }
        ScribePanel.redraw(panel);
        if (!filed && !panel.shown.has(outlet)) {
            panel.trouble = outcome;
            panel.troubled = outlet;
            ScribePanel.redraw(panel);
        }
        return filed;
    },

    /**
     * @param {object} panel
     * @param {string} outlet
     * @param {object} operation
     * @param {string|null} question
     * @return {Promise<boolean>}
     */
    rule(panel, outlet, operation, question) {
        const settings = ScribePanel.Settings;
        const findings = ScribePanel.openFindings(panel);
        return ScribePanel.perform(panel, {
            outlet,
            /**
             * @return {Promise<void>}
             */
            call: () => findings.length ? panel.keeper.rule(operation, findings) : panel.keeper.rule(operation),
            question,
            done: settings.Nothing,
            pending: settings.Words.Saving,
            book: true,
        });
    },

    /**
     * @param {object} panel
     * @param {string} method
     * @return {Promise<boolean>}
     */
    choose(panel, method) {
        const settings = ScribePanel.Settings;
        return ScribePanel.perform(panel, {
            outlet: settings.Outlets.Choice,
            /**
             * @return {Promise<void>}
             */
            call: () => panel.cloud[method](),
            question: null,
            done: settings.Nothing,
            pending: settings.Words.Working,
            book: false,
        });
    },

    /**
     * @param {object} panel
     * @return {object[]}
     */
    openFindings(panel) {
        return (panel.live.view().findings ?? []).filter((item) => item?.fingerprint &&
            [ScribeLive.Status.Open, ScribeLive.Status.Reminded].includes(item.status));
    },

    /**
     * @param {object} panel
     * @param {string} outlet
     * @param {string} key
     * @param {string} problem
     * @return {void}
     */
    refuse(panel, outlet, key, problem) {
        ScribePanel.mark(panel, key, true);
        ScribePanel.say(panel, outlet, problem);
        ScribePanel.redraw(panel);
    },

    /**
     * @param {object} panel
     * @param {() => Promise<void>} call
     * @return {Promise<void>}
     */
    async offering(panel, call) {
        const settings = ScribePanel.Settings;
        const words = settings.Words;
        const outlet = settings.Outlets.Offer;
        const filed = await ScribePanel.perform(panel, {
            outlet,
            call,
            question: null,
            done: settings.Nothing,
            pending: words.Thinking,
            book: false,
        });
        if (filed && (panel.live.view().offer ?? null) === null) {
            ScribePanel.say(panel, outlet, words.NothingFits);
            panel.fleeting.add(outlet);
            ScribePanel.redraw(panel);
        }
    },

    /**
     * @param {object} panel
     * @return {void}
     */
    openEdit(panel) {
        const settings = ScribePanel.Settings;
        const view = panel.live.view();
        const shown = panel.parts.Reminder.value;
        panel.editing = true;
        panel.editShown = shown !== settings.Nothing;
        panel.editStale = view.stale === true;
        panel.editAgainst = view.latest;
        panel.editSelection = panel.displayedSelection;
        panel.editOffer = panel.displayedOffer;
        panel.editFrom = shown;
        panel.parts.Reminder.value = shown;
        ScribePanel.say(panel, settings.Outlets.Reminder, settings.Nothing);
        ScribePanel.redraw(panel);
        panel.parts.Reminder.focus();
    },

    /**
     * @param {object} panel
     * @param {boolean} save
     * @return {void}
     */
    closeEdit(panel, save) {
        const settings = ScribePanel.Settings;
        const outlet = settings.Outlets.Reminder;
        const changed = panel.editSelection !== null || panel.live.view().selected != null
            ? panel.parts.Reminder.value !== panel.editFrom
            : ScribeLive.line(panel.parts.Reminder.value) !== ScribeLive.line(panel.editFrom);
        if (save && (changed || panel.editStale)) {
            try {
                panel.live.edit(panel.parts.Reminder.value, panel.editShown, panel.editAgainst, panel.editSelection);
            } catch (error) {
                ScribePanel.fail(panel, outlet, ScribePanel.refusal(error));
                ScribePanel.redraw(panel);
                return;
            }
        }
        panel.editing = false;
        ScribePanel.say(panel, outlet, settings.Nothing);
        const force = settings.Outlets.Force;
        const error = panel.outcomes.get(force);
        if ([ScribeLive.Settings.Messages.EmptyEdit, ScribeLive.Settings.Messages.LongEdit].includes(error)) {
            ScribePanel.say(panel, force, settings.Nothing);
            if (panel.troubled === force && panel.trouble === error) {
                panel.trouble = settings.Nothing;
                panel.troubled = null;
            }
        }
        ScribePanel.redraw(panel);
        panel.parts.Edit.focus();
    },

    /**
     * @param {object} panel
     * @return {Promise<void>}
     */
    async force(panel) {
        const settings = ScribePanel.Settings;
        const words = settings.Words;
        const outlet = settings.Outlets.Force;
        const resendId = panel.resendId;
        const visible = panel.parts.Reminder.value;
        const selectedText = resendId === null && (panel.editing || visible !== settings.Nothing) ? visible : null;
        const filed = await ScribePanel.perform(panel, {
            outlet,
            /**
             * @return {Promise<void>}
             */
            call: () => panel.live.force(resendId, selectedText),
            question: null,
            done: words.Forced,
            pending: words.Working,
            book: false,
        });
        if (filed && selectedText !== null && panel.live.view().selected === selectedText && panel.parts.Reminder.value === selectedText) {
            panel.editing = false;
            ScribePanel.redraw(panel);
        }
        if (filed && (panel.live.view().ready ?? null) === null) {
            ScribePanel.say(panel, outlet, words.PreparedLater);
            ScribePanel.redraw(panel);
        }
    },

    /**
     * @param {object} panel
     * @return {Promise<void>}
     */
    async tell(panel) {
        const settings = ScribePanel.Settings;
        const words = settings.Words;
        const outlet = settings.Outlets.Tell;
        const text = panel.parts.Tell.value;
        if (text.trim() === settings.Nothing) {
            ScribePanel.refuse(panel, outlet, settings.Ids.Tell, words.TellMissing);
            return;
        }
        ScribePanel.mark(panel, settings.Ids.Tell, false);
        const lines = new Set(text.split(words.LineBreak).map((line) => line.trim()));
        for (const [key, origin] of panel.rulingOrigins) {
            if (!lines.has(origin.line.trim())) {
                panel.rulingOrigins.delete(key);
            }
        }
        const filed = await ScribePanel.perform(panel, {
            outlet,
            /**
             * @return {Promise<void>}
             */
            call: () => panel.rulingOrigins.size ? panel.live.tell(text, [...panel.rulingOrigins.values()]) : panel.live.tell(text),
            question: null,
            done: settings.Nothing,
            pending: words.ReadingWords,
            book: false,
        });
        if (filed) {
            panel.workedOut = text;
        }
    },

    /**
     * @param {object} panel
     * @return {Promise<void>}
     */
    async file(panel) {
        const settings = ScribePanel.Settings;
        if (panel.workedOut !== null && panel.parts.Tell.value !== panel.workedOut) {
            panel.live.forget();
            panel.rulingOrigins.clear();
            ScribePanel.say(panel, settings.Outlets.Tell, 'Work out the edited text before filing.');
            ScribePanel.redraw(panel);
            return;
        }
        const filed = await ScribePanel.perform(panel, {
            outlet: settings.Outlets.Tell,
            /**
             * @return {Promise<void>}
             */
            call: () => panel.live.confirm(),
            question: null,
            done: settings.Nothing,
            pending: settings.Words.Saving,
            book: true,
        });
        if (filed && (!panel.rulingOrigins.size || panel.live.view().understood === null) &&
            panel.parts.Tell.value === panel.workedOut) {
            panel.parts.Tell.value = settings.Nothing;
            panel.workedOut = null;
            panel.rulingOrigins.clear();
        }
    },

    /**
     * @param {object} panel
     * @return {Promise<void>}
     */
    async addFact(panel) {
        const settings = ScribePanel.Settings;
        const words = settings.Words;
        const parts = panel.parts;
        const outlet = settings.Outlets.Add;
        const text = parts.AddText.value.trim();
        if (text === settings.Nothing) {
            ScribePanel.refuse(panel, outlet, settings.Ids.AddText, words.AddMissing);
            return;
        }
        ScribePanel.mark(panel, settings.Ids.AddText, false);
        const anchor = panel.keeper.view().lastRead ?? null;
        const relation = parts.AddCategory.value === ScribeCategory.Settings.RelationCategory;
        const findings = ScribePanel.openFindings(panel);
        const operation = {
            type: ScribeLog.Ruling.AddFact,
            subject: panel.chosen,
            category: parts.AddCategory.value,
            target: relation ? parts.AddTarget.value : null,
            text,
            hidden: parts.AddHidden.checked,
            cite: anchor === null ? null : anchor.id,
            position: anchor === null ? settings.NoPosition : anchor.position,
        };
        const filed = await ScribePanel.perform(panel, {
            outlet,
            /**
             * @return {Promise<void>}
             */
            call: () => findings.length ? panel.keeper.rule(operation, findings) : panel.keeper.rule(operation),
            question: null,
            done: words.Added,
            pending: words.Saving,
            book: true,
        });
        if (filed) {
            parts.AddText.value = settings.Nothing;
            parts.AddHidden.checked = false;
        }
    },

    /**
     * @param {object} panel
     * @return {Promise<void>}
     */
    async split(panel) {
        const settings = ScribePanel.Settings;
        const words = settings.Words;
        const parts = panel.parts;
        const outlet = settings.Outlets.Split;
        const label = parts.SplitLabel.value.trim();
        const facts = [...panel.ticks];
        if (label === settings.Nothing) {
            ScribePanel.refuse(panel, outlet, settings.Ids.SplitLabel, words.SplitNameMissing);
            return;
        }
        ScribePanel.mark(panel, settings.Ids.SplitLabel, false);
        if (facts.length === settings.NoCount) {
            ScribePanel.say(panel, outlet, words.SplitTickMissing);
            ScribePanel.redraw(panel);
            return;
        }
        const operation = {
            type: ScribeLog.Ruling.Split,
            subject: panel.chosen,
            label,
            kind: parts.SplitKind.value,
            facts,
        };
        const filed = await ScribePanel.perform(panel, {
            outlet,
            /**
             * @return {Promise<void>}
             */
            call: () => panel.keeper.rule(operation),
            question: words.SplitOpen + facts.length + words.SplitMiddle + label + words.SplitClose,
            done: words.SplitDone,
            pending: words.Saving,
            book: true,
        });
        if (filed) {
            panel.ticks.clear();
            parts.SplitLabel.value = settings.Nothing;
            ScribePanel.redraw(panel);
        }
    },

    /**
     * @param {object} panel
     * @return {Promise<void>}
     */
    async keepFirst(panel) {
        const settings = ScribePanel.Settings;
        const words = settings.Words;
        const established = panel.keeper.view().state.conflicts.filter(
            /**
             * @param {{ established: string|null }} conflict
             * @return {boolean}
             */
            (conflict) => conflict.established !== null,
        ).length;
        if (established === settings.NoCount) {
            ScribePanel.say(panel, settings.Outlets.Keep, words.NothingToKeep);
            ScribePanel.redraw(panel);
            return;
        }
        await ScribePanel.perform(panel, {
            outlet: settings.Outlets.Keep,
            /**
             * @return {Promise<void>}
             */
            call: () => {
                const findings = ScribePanel.openFindings(panel);
                return findings.length ? panel.keeper.keepFirst(findings) : panel.keeper.keepFirst();
            },
            question: null,
            done:
                words.KeptOpen +
                BenchView.count(established) +
                (established === settings.Single ? words.KeptOne : words.KeptMany),
            pending: words.Saving,
            book: true,
        });
    },

    /**
     * @param {object} panel
     * @return {{ given: object, problems: Map<string, string> }}
     */
    form(panel) {
        const settings = ScribePanel.Settings;
        const words = settings.Words;
        const problems = new Map();
        const given = {};
        for (const name of settings.Models) {
            const text = panel.setup[name].input.value.trim();
            if (text === settings.Nothing) {
                problems.set(name, words.ModelMissing);
            }
            given[name] = text;
        }
        for (const name of settings.Counts) {
            const number = ScribePanel.whole(panel.setup[name].input.value);
            if (number === null || number < settings.LeastCount) {
                problems.set(name, words.CountWrong[name]);
            }
            given[name] = number;
        }
        const text = panel.setup[settings.Amount].input.value.trim();
        const budget = Number(text);
        if (!settings.Decimal.test(text) || !Number.isFinite(budget) || budget <= settings.NoBudget) {
            problems.set(settings.Amount, words.BudgetWrong);
        }
        given[settings.Amount] = budget;
        for (const item of settings.Setup) {
            const entry = panel.setup[item.name];
            const problem = problems.get(item.name) ?? settings.Nothing;
            ScribePanel.write(entry.problem, problem);
            ScribePanel.mark(panel, entry.input.id, problem !== settings.Nothing);
        }
        return { given, problems };
    },

    /**
     * @param {object} panel
     * @param {string} outlet
     * @return {Promise<boolean>}
     */
    resume(panel, outlet) {
        const settings = ScribePanel.Settings;
        return ScribePanel.perform(panel, {
            outlet,
            /**
             * @return {Promise<void>}
             */
            call: () => panel.keeper.resume(),
            question: null,
            done: settings.Nothing,
            pending: settings.Words.Working,
            book: true,
        });
    },

    /**
     * @param {object} panel
     * @param {string} outlet
     * @return {Promise<void>}
     */
    async adopt(panel, outlet) {
        const settings = ScribePanel.Settings;
        const words = settings.Words;
        const view = panel.keeper.view();
        const form = ScribePanel.form(panel);
        if (form.problems.size > settings.NoCount) {
            const first = settings.Setup.find(
                /**
                 * @param {{ name: string }} item
                 * @return {boolean}
                 */
                (item) => form.problems.has(item.name),
            );
            panel.tab = settings.SettingsTab;
            panel.open = true;
            panel.fixing = first.name;
            ScribePanel.fail(panel, outlet, words.AdoptFix);
            ScribePanel.redraw(panel);
            panel.setup[first.name].input.focus();
            return;
        }
        await ScribePanel.perform(panel, {
            outlet,
            /**
             * @return {Promise<void>}
             */
            call: () => panel.keeper.adopt(form.given),
            question: view.phase === ScribeKeeper.Phase.NoBook ? null : words.StartOverQuestion,
            done: settings.Nothing,
            pending: words.Working,
            book: true,
        });
    },

    /**
     * @param {object} panel
     * @return {Promise<void>}
     */
    async saveKey(panel) {
        const settings = ScribePanel.Settings;
        const words = settings.Words;
        const outlet = settings.Outlets.Key;
        const field = panel.parts.Key;
        if (!field.value && (ScribePanel.again(panel, settings.Ids.SaveKey) || panel.outcomes.get(outlet) === words.KeySuperseded)) {
            return;
        }
        const typed = field.value;
        field.value = settings.Nothing;
        ScribePanel.mark(panel, settings.Ids.Key, false);
        let outcome = settings.Nothing;
        try {
            if (!panel.saveKey(typed, panel.draftVersion)) {
                outcome = words.KeySuperseded;
            } else if (!typed.trim()) {
                ScribePanel.refuse(panel, outlet, settings.Ids.Key, words.KeyMissing);
                return;
            } else {
                panel.last.set(settings.Ids.SaveKey, panel.clock.now());
                panel.trouble = settings.Nothing;
            }
        } catch (error) {
            outcome = ScribePanel.reason(error);
        }
        ScribePanel.say(panel, outlet, outcome);
        ScribePanel.redraw(panel);
    },

    /**
     * @param {object} panel
     * @return {Promise<void>}
     */
    async saveSettings(panel) {
        const settings = ScribePanel.Settings;
        const words = settings.Words;
        const form = ScribePanel.form(panel);
        if (form.problems.size > settings.NoCount) {
            ScribePanel.say(panel, settings.Outlets.Settings, words.FixFields);
            ScribePanel.redraw(panel);
            return;
        }
        await ScribePanel.perform(panel, {
            outlet: settings.Outlets.Settings,
            /**
             * @return {Promise<void>}
             */
            call: () => panel.keeper.configure(form.given),
            question: null,
            done: words.SettingsSaved,
            pending: words.Saving,
            book: true,
        });
    },

    /**
     * @param {object} panel
     * @return {Promise<void>}
     */
    async exportChat(panel) {
        const settings = ScribePanel.Settings;
        const words = settings.Words;
        if (ScribePanel.again(panel, settings.Ids.Export)) {
            return;
        }
        const roomId = panel.keeper.view().roomId;
        const safe = PanelView.said(roomId)
            .replace(settings.Unsafe, settings.Replacement)
            .slice(0, settings.RoomLength);
        const name = settings.FileOpen + safe + settings.FileClose;
        let outcome = words.Exported + name + words.FullStop;
        try {
            panel.download(name, ScribeStore.exportText(panel.storage, roomId));
            panel.last.set(settings.Ids.Export, panel.clock.now());
            panel.trouble = settings.Nothing;
        } catch (error) {
            outcome = ScribePanel.reason(error);
        }
        ScribePanel.say(panel, settings.Outlets.Controls, outcome);
        ScribePanel.redraw(panel);
    },

    Drawers: Object.freeze({
        /**
         * @param {object} panel
         * @param {object} view
         * @return {void}
         */
        Summary(panel, view) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const lists = settings.Lists;
            const rows = ScribePanel.Rows;
            const summary = PanelView.summary(view.state);
            const needs = settings.Needs.filter(
                /**
                 * @param {{ field: string }} need
                 * @return {boolean}
                 */
                (need) => summary.needs[need.field] > 0,
            ).map(
                /**
                 * @param {{ field: string, one: string, many: string }} need
                 * @return {object}
                 */
                (need) => {
                    const count = summary.needs[need.field];
                    return ScribePanel.button(
                        panel,
                        BenchView.count(count) + (count === settings.Single ? need.one : need.many),
                        /**
                         * @return {Promise<void>}
                         */
                        async () => {
                            panel.tab = settings.RulingsTab;
                            ScribePanel.redraw(panel);
                        },
                        settings.Guard.Free,
                        ScribePanel.key(settings.Sections.Needs, need.field),
                    );
                },
            );
            if (needs.length === 0) {
                needs.push(ScribePanel.make(panel, settings.Tags.Paragraph, words.NothingNeeds, settings.Classes.Meta));
            }
            panel.parts.Needs.replaceChildren(...needs);
            ScribePanel.paged(
                panel,
                lists.Cast,
                summary.cast,
                /**
                 * @param {{ id: string, label: string, kind: string, lines: string[] }} member
                 * @return {object}
                 */
                (member) => rows.cast(panel, member),
                null,
            );
            panel.parts.Standing.replaceChildren(
                ...ScribePanel.items(
                    panel,
                    summary.standing,
                    /**
                     * @param {object} row
                     * @return {object}
                     */
                    (row) => rows.scene(panel, row, false),
                ),
            );
            const days = [];
            for (const group of summary.days) {
                group.scenes.forEach(
                    /**
                     * @param {object|null} row
                     * @param {number} index
                     * @return {void}
                     */
                    (row, index) => {
                        days.push(row === null ? null : { day: group.day, row, opens: index === 0 });
                    },
                );
            }
            ScribePanel.paged(
                panel,
                lists.Days,
                days,
                /**
                 * @param {{ day: number, row: object, opens: boolean }} item
                 * @param {number} index
                 * @return {object}
                 */
                (item, index) => rows.day(panel, item, index),
                null,
            );
            ScribePanel.paged(
                panel,
                lists.Threads,
                summary.threads,
                /**
                 * @param {{ id: string, text: string, position: number }} thread
                 * @return {object}
                 */
                (thread) => rows.thread(panel, thread),
                null,
            );
        },

        /**
         * @param {object} panel
         * @param {object} view
         * @return {void}
         */
        Book(panel, view) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const lists = settings.Lists;
            const parts = panel.parts;
            const state = view.state;
            ScribePanel.show(
                panel,
                lists.Subjects,
                PanelView.subjects(state, panel.query, panel.pages[lists.Subjects]),
                /**
                 * @param {object} row
                 * @return {object}
                 */
                (row) => ScribePanel.Rows.subject(panel, row),
            );
            const subject = panel.chosen === null ? null : PanelView.subject(state, panel.chosen);
            const draft = panel.factDraft;
            parts.Recovered.replaceChildren();
            if (draft && !state.facts.some((fact) => fact?.id === draft.id && fact.subject === draft.subject && ScribeReplay.live(fact))) {
                const field = ScribePanel.field(panel, settings.InputTypes.Area, 'Unsaved wording for ' + draft.id, 'recovered-wording', false, false);
                field.input.value = draft.text;
                field.input.readOnly = true;
                parts.Recovered.append(ScribePanel.make(panel, settings.Tags.Paragraph,
                    'This fact changed or left the book. Copy your draft and open Edit on the current fact.'),
                    field.label, ScribePanel.button(panel, words.EditCancel, async () => {
                        panel.factDraft = null;
                        panel.factInput = null;
                        ScribePanel.redraw(panel);
                    }, settings.Guard.Free, 'discard-recovered-wording'));
            }
            parts.Detail.hidden = subject === null;
            if (subject === null) {
                panel.chosen = null;
                return;
            }
            panel.chosen = subject.id;
            ScribePanel.write(
                parts.Heading,
                [PanelView.named(subject.heading) + words.Open + PanelView.named(subject.kind) + words.Close, subject.source].filter(Boolean).join(' · '),
            );
            const aka = PanelView.lines(subject.aka).map(
                /**
                 * @param {string|null} name
                 * @return {string}
                 */
                (name) => PanelView.named(name),
            );
            ScribePanel.write(
                parts.Names,
                words.OtherNames + (aka.length === 0 ? words.NoOtherNames : aka.join(words.Comma)),
            );
            ScribePanel.paged(
                panel,
                lists.Facts,
                subject.facts,
                /**
                 * @param {object} fact
                 * @return {object}
                 */
                (fact) => ScribePanel.Rows.fact(panel, fact, view.roomId),
                /**
                 * @param {{ id: string }} fact
                 * @return {string}
                 */
                (fact) => ScribePanel.key(settings.Sections.Facts, fact.id),
            );
            const targets = PanelView.each(
                state.subjects,
                /**
                 * @param {{ id: string, label: string, mergedInto: string|null }} candidate
                 * @return {Array<[string, string]>}
                 */
                (candidate) =>
                    candidate.mergedInto === null ? [[candidate.id, PanelView.named(candidate.label)]] : [],
            ).filter(
                /**
                 * @param {[string, string]|null} pair
                 * @return {boolean}
                 */
                (pair) => pair !== null,
            );
            const current = parts.AddTarget.value;
            const kept = targets.some(
                /**
                 * @param {[string, string]} pair
                 * @return {boolean}
                 */
                ([id]) => id === current,
            );
            ScribePanel.options(panel, parts.AddTarget, targets, kept ? current : targets[0][0]);
        },

        /**
         * @param {object} panel
         * @param {object} view
         * @return {void}
         */
        Timeline(panel, view) {
            const name = ScribePanel.Settings.Lists.Timeline;
            ScribePanel.show(
                panel,
                name,
                PanelView.timeline(view.state, panel.pages[name]),
                /**
                 * @param {object} row
                 * @return {object}
                 */
                (row) => ScribePanel.Rows.scene(panel, row, false),
            );
        },

        /**
         * @param {object} panel
         * @param {object} view
         * @param {{ understood: { lines: readonly string[], refused: readonly object[], count: number }|null }} live
         * @return {void}
         */
        Rulings(panel, view, live) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const tags = settings.Tags;
            const classes = settings.Classes;
            const sections = settings.Sections;
            const outlet = settings.Outlets.Tell;
            const lists = settings.Lists;
            const rows = ScribePanel.Rows;
            const understood = live.understood;
            const shown = [];
            ScribePanel.wait(panel, outlet, panel.parts.Work);
            if (understood !== null) {
                const actions = ScribePanel.make(panel, tags.Block, settings.Nothing, classes.Actions);
                actions.append(
                    ScribePanel.wait(
                        panel,
                        outlet,
                        ScribePanel.button(
                            panel,
                            words.Forget,
                            /**
                             * @return {Promise<boolean>}
                             */
                            () =>
                                ScribePanel.perform(panel, {
                                    outlet,
                                    /**
                                     * @return {void}
                                     */
                                    call: () => {
                                        panel.rulingOrigins.clear();
                                        panel.live.forget();
                                    },
                                    question: null,
                                    done: settings.Nothing,
                                    pending: settings.Nothing,
                                    book: false,
                                }),
                            settings.Guard.Loose,
                            ScribePanel.key(sections.Tell, settings.Acts.Forget),
                        ),
                    ),
                );
                const lines = PanelView.lines(understood.lines);
                const unchanged = lines.length === settings.Single && lines[0] === words.NothingChanges;
                if (unchanged && !understood.operatorText) {
                    shown.push(ScribePanel.make(panel, tags.Paragraph, words.NothingChanges, classes.Meta));
                } else if (understood.operatorText || understood.count > 0) {
                    const list = ScribePanel.make(panel, tags.List, settings.Nothing, classes.Lines);
                    list.append(
                        ...ScribePanel.items(
                            panel,
                            lines,
                            /**
                             * @param {string} line
                             * @return {object}
                             */
                            (line) => ScribePanel.make(panel, tags.Item, line),
                        ),
                    );
                    shown.push(ScribePanel.make(panel, tags.Form, words.Understood), list);
                    if (understood.operatorText) {
                        shown.push(ScribePanel.make(panel, tags.Paragraph, understood.operatorText));
                    }
                    if (understood.modelResponse) {
                        shown.push(ScribePanel.make(panel, tags.Paragraph, understood.modelResponse));
                    }
                    const refused = PanelView.listed(understood.refused).length;
                    if (refused > 0) {
                        const counted = refused === settings.Single ? words.RefusedOne : words.RefusedMany;
                        shown.push(
                            ScribePanel.make(panel, tags.Paragraph, BenchView.count(refused) + counted, classes.Meta),
                        );
                    }
                    actions.append(
                        ScribePanel.wait(
                            panel,
                            outlet,
                            ScribePanel.button(
                                panel,
                                words.File,
                                /**
                                 * @return {Promise<void>}
                                 */
                                () => ScribePanel.file(panel),
                                settings.Guard.Book,
                                ScribePanel.key(sections.Tell, settings.Acts.File),
                                classes.Primary,
                            ),
                        ),
                    );
                } else {
                    shown.push(ScribePanel.make(panel, tags.Paragraph, words.NothingUnderstood, classes.Meta));
                }
                shown.push(actions);
            }
            panel.parts.Understood.replaceChildren(...shown);
            const rulings = PanelView.rulings(view.state);
            ScribePanel.paged(
                panel,
                lists.Conflicts,
                rulings.conflicts,
                /**
                 * @param {object} conflict
                 * @return {object}
                 */
                (conflict) => rows.conflict(panel, conflict),
                /**
                 * @param {{ subject: string, category: string }} conflict
                 * @return {string}
                 */
                (conflict) => ScribePanel.key(sections.Conflicts, ...BenchView.conflictKey(conflict)),
            );
            ScribePanel.paged(
                panel,
                lists.Likes,
                rulings.lookAlikes,
                /**
                 * @param {object} likeness
                 * @return {object}
                 */
                (likeness) => rows.likeness(panel, likeness),
                /**
                 * @param {{ first: string, second: string }} likeness
                 * @return {string}
                 */
                (likeness) => ScribePanel.key(sections.Likes, likeness.first, likeness.second),
            );
            ScribePanel.paged(
                panel,
                lists.Scenes,
                rulings.publicScenes,
                /**
                 * @param {object} scene
                 * @return {object}
                 */
                (scene) => rows.scene(panel, scene, true),
                /**
                 * @param {{ id: string }} scene
                 * @return {string}
                 */
                (scene) => ScribePanel.key(sections.Scenes, scene.id),
            );
            const unanswered = rulings.questions.filter(
                /**
                 * @param {{ answer: string|null }|null} question
                 * @return {boolean}
                 */
                (question) => question !== null && question.answer === null,
            );
            const answered = rulings.questions.filter(
                /**
                 * @param {{ answer: string|null }|null} question
                 * @return {boolean}
                 */
                (question) => question !== null && question.answer !== null,
            );
            const unreadable = rulings.questions.filter(
                /**
                 * @param {object|null} question
                 * @return {boolean}
                 */
                (question) => question === null,
            );
            ScribePanel.paged(
                panel,
                lists.Questions,
                [...unanswered, ...unreadable],
                /**
                 * @param {object} question
                 * @return {object}
                 */
                (question) => rows.question(panel, question),
                /**
                 * @param {{ id: string }} question
                 * @return {string}
                 */
                (question) => ScribePanel.key(sections.Questions, question.id),
            );
            ScribePanel.paged(panel, lists.Processing, answered,
                (question) => rows.question(panel, question, view.stop?.problem?.startsWith(ScribeAdoption.Settings.Unreadable.Answers)),
                (question) => ScribePanel.key(lists.Processing, question.id));
            ScribePanel.paged(
                panel,
                lists.Contradictions,
                PanelView.contradictions(view.state),
                /**
                 * @param {object} contradiction
                 * @return {object}
                 */
                (contradiction) => rows.contradiction(panel, contradiction),
                /**
                 * @param {{ id: string }} contradiction
                 * @return {string}
                 */
                (contradiction) => ScribePanel.key(sections.Contradictions, contradiction.id),
            );
            ScribePanel.paged(
                panel,
                lists.Aliases,
                rulings.aliases,
                /**
                 * @param {object} alias
                 * @return {object}
                 */
                (alias) => rows.alias(panel, alias),
                /**
                 * @param {{ subject: string, name: string }} alias
                 * @return {string}
                 */
                (alias) => ScribePanel.key(sections.Aliases, alias.subject, alias.name),
            );
            ScribePanel.paged(
                panel,
                lists.Refinements,
                rulings.refinements,
                /**
                 * @param {object} refinement
                 * @return {object}
                 */
                (refinement) => rows.refinement(panel, refinement),
                null,
            );
            ScribePanel.paged(
                panel,
                lists.Made,
                PanelView.each(
                    view.made,
                    /**
                     * @param {object} made
                     * @return {object[]}
                     */
                    (made) => [made],
                ),
                /**
                 * @param {object} made
                 * @return {object}
                 */
                (made) => rows.made(panel, made),
                /**
                 * @param {{ sequence: number }} made
                 * @return {string}
                 */
                (made) => ScribePanel.key(sections.Made, made.sequence),
            );
        },

        /**
         * @param {object} panel
         * @param {object} view
         * @param {object} live
         * @return {void}
         */
        Findings(panel, view, live) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const queued = [];
            const parts = panel.parts;
            const blocked = live.forceBlock !== null;
            const editing = panel.editing;
            const unconfirmed = live.unconfirmed ?? null;
            panel.resendId = unconfirmed?.id ?? null;
            if (!editing) {
                parts.Reminder.value = unconfirmed?.text ?? live.selected ?? live.ready ?? (live.stale ? live.draft : null) ?? settings.Nothing;
                panel.displayedSelection = live.selectionId ?? null;
                panel.displayedOffer = unconfirmed?.id ?? panel.displayedSelection ?? live.offerId ?? null;
            }
            parts.Reminder.readOnly = !editing;
            let placeholder = words.NothingWaiting;
            if (live.ready === null && live.held !== null && !blocked) {
                placeholder = live.held;
            } else if (live.ready === null && live.edited) {
                placeholder = words.EditHeld;
            } else if (live.ready === null && blocked && (live.forced || (live.due && live.prepared))) {
                placeholder = words.HeldReady;
            } else if (live.ready === null && live.forced) {
                placeholder = words.PreparedLater;
            }
            parts.Reminder.setAttribute(settings.Attributes.Placeholder, placeholder);
            parts.Reminder.disabled = blocked;
            parts.Edit.hidden = editing;
            parts.Edit.disabled = blocked || (unconfirmed !== null && live.selected == null);
            parts.EditCancel.hidden = !editing;
            parts.EditCancel.disabled = false;
            parts.EditSave.hidden = !editing;
            parts.EditSave.disabled = blocked;
            parts.Force.disabled = blocked;
            ScribePanel.write(parts.Force, unconfirmed ? words.Resend : words.Force);
            ScribePanel.wait(panel, settings.Outlets.Force, parts.Force);
            parts.ForceReason.hidden = !blocked;
            ScribePanel.write(parts.ForceReason, blocked ? live.forceBlock : settings.Nothing);
            const held = blocked ? null : PanelView.reminderStatus(view, live);
            parts.Held.hidden = held === null;
            ScribePanel.write(parts.Held, held ?? settings.Nothing);
            const forceOutcome = panel.outcomes.get(settings.Outlets.Force);
            if ([words.Forced, words.PreparedLater].includes(forceOutcome) ||
                (live.selected != null && !unconfirmed && !forceOutcome)) {
                const going = live.ready !== null || live.edited || (blocked && live.prepared);
                let outcome = settings.Nothing;
                if (live.forced) {
                    outcome = going ? words.Forced : words.PreparedLater;
                }
                if (outcome !== forceOutcome) {
                    ScribePanel.say(panel, settings.Outlets.Force, outcome);
                }
            }
            if (live.suggestion !== null) {
                queued.push(words.Suggestion + PanelView.said(live.suggestion));
            }
            ScribePanel.paged(
                panel,
                settings.Lists.Queued,
                queued,
                /**
                 * @param {string} text
                 * @return {object}
                 */
                (text) => ScribePanel.Rows.text(panel, text),
                null,
            );
            const acts = settings.Acts;
            const outlet = settings.Outlets.Offer;
            const offer = live.offer;

            /**
             * @param {() => *} call
             * @return {() => Promise<boolean>}
             */
            const quick = (call) =>
                /**
                 * @return {Promise<boolean>}
                 */
                () =>
                    ScribePanel.perform(panel, {
                        outlet,
                        call,
                        question: null,
                        done: settings.Nothing,
                        pending: settings.Nothing,
                        book: false,
                    });
            parts.OfferText.hidden = offer === null;
            ScribePanel.write(parts.OfferText, offer === null ? settings.Nothing : PanelView.said(offer.text));
            const offering =
                offer === null
                    ? [
                          ScribePanel.button(
                              panel,
                              words.Suggest,
                              /**
                               * @return {Promise<void>}
                               */
                              () =>
                                  ScribePanel.offering(
                                      panel,
                                      /**
                                       * @return {Promise<void>}
                                       */
                                      () => panel.live.suggest(),
                                  ),
                              settings.Guard.Change,
                              ScribePanel.key(settings.Sections.Offer, acts.Suggest),
                              settings.Classes.Primary,
                          ),
                      ]
                    : [
                          ScribePanel.button(
                              panel,
                              words.Ignore,
                              quick(
                                  /**
                                   * @return {void}
                                   */
                                  () => panel.live.ignore(),
                              ),
                              settings.Guard.Loose,
                              ScribePanel.key(settings.Sections.Offer, acts.Ignore),
                          ),
                          ScribePanel.button(
                              panel,
                              words.Another,
                              /**
                               * @return {Promise<void>}
                               */
                              () =>
                                  ScribePanel.offering(
                                      panel,
                                      /**
                                       * @return {Promise<void>}
                                       */
                                      () => panel.live.another(),
                                  ),
                              settings.Guard.Change,
                              ScribePanel.key(settings.Sections.Offer, acts.Another),
                          ),
                          ScribePanel.button(
                              panel,
                              words.Use,
                              quick(
                                  /**
                                   * @return {void}
                                   */
                                  () => panel.live.use(offer.text),
                              ),
                              settings.Guard.Loose,
                              ScribePanel.key(settings.Sections.Offer, acts.Use),
                              settings.Classes.Primary,
                          ),
                      ];
            for (const control of offering) {
                ScribePanel.wait(panel, outlet, control);
            }
            parts.OfferActions.replaceChildren(...offering);
            const findings = PanelView.findings(view.state, live);
            for (const finding of PanelView.listed(view.checkerFindings)) {
                if (finding.id) {
                    findings.push({ key: finding.id, check: finding, state: view.state, messages: view.messages,
                        ...(finding.status === 'settled' ? { ruling: finding.ruling } : {}) });
                    continue;
                }
                const citations = [finding.source, finding.earlier].filter(Boolean);
                const notes = citations.map((citation) => '#' + citation.position + ' · ' + citation.speaker + ' “' + citation.quote + '”');
                if (finding.record) {
                    notes.push('Book entry: ' + finding.record.text);
                }
                findings.push({
                    key: JSON.stringify(['checker', finding.kind, finding.source, finding.earlier, finding.record]),
                    kind: finding.kind, status: ScribeLive.Status.Open, title: finding.kind,
                    detail: BenchView.checkerTitle(finding), notes, actions: [], draft: null,
                });
            }
            ScribePanel.paged(
                panel,
                settings.Lists.Findings,
                findings.filter((item) => item?.ruling === undefined),
                /**
                 * @param {object} item
                 * @return {object}
                 */
                (item) => item.check ? ScribePanel.Rows.checker(panel, item) : ScribePanel.Rows.finding(panel, item),
                /**
                 * @param {{ key: string }} item
                 * @return {string}
                 */
                (item) => ScribePanel.key(settings.Sections.Findings, item.key),
                findings.some((item) => item?.check && item.ruling === undefined) ? 1 : BenchView.PageSize,
            );
            ScribePanel.paged(panel, settings.Lists.RuledFindings, findings.filter((item) => item?.ruling !== undefined),
                (item) => item.check ? ScribePanel.Rows.checker(panel, item) : ScribePanel.Rows.finding(panel, item),
                (item) => ScribePanel.key(settings.Sections.Findings, item.key),
                findings.some((item) => item?.check && item.ruling !== undefined) ? 1 : BenchView.PageSize);
        },

        /**
         * @param {object} panel
         * @param {object} view
         * @param {object} live
         * @return {void}
         */
        Progress(panel, view, live) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const parts = panel.parts;
            parts.Adopt.hidden =
                !view.booked || [ScribeKeeper.Phase.NoBook, ScribeKeeper.Phase.Loading].includes(view.phase);
            parts.Story.hidden = live.notice === null;
            parts.Checked.hidden = !view.booked || !view.checksEnabled;
            let schedule = settings.Nothing;
            if (Number.isFinite(view.expensiveCheckAt) && view.expensiveCheckAt > panel.clock.now()) {
                const time = new Date(view.expensiveCheckAt).toLocaleTimeString();
                schedule = ' Zeta expired the links to older messages. The next background history check is due at ' + time + ' (local time).';
            }
            const pending = [...PanelView.listed(view.pendingFiling)];
            const readings = [...PanelView.listed(view.modelReadings)];
            const displayed = new Set(readings.filter((item) => item.role === 'Checker')
                .map((item) => JSON.stringify([item.first, item.statement])));
            for (const item of PanelView.listed(view.checkerReview)) {
                if (item.section === 'answer' && (item.reason === 'Checker response' ||
                    item.reason === 'The Checker returned text outside its JSON format.')) {
                    if (!displayed.has(JSON.stringify([item.position, item.statement]))) {
                        readings.push({ role: 'Checker', first: item.position, last: item.position, statement: item.statement });
                    }
                } else {
                    pending.push({ ...item, kind: 'checker' });
                }
            }
            for (const item of PanelView.listed(live.checkerRows)) {
                if (item.modelReading) {
                    readings.push({ role: 'Checker', first: item.position, last: item.position, statement: item.statement });
                } else {
                    pending.push({ ...item, kind: 'checker', section: 'live answer',
                        reason: 'The model returned this statement without a matching link.' });
                }
            }
            parts.FilingGroup.hidden = pending.length === 0;
            const reasons = ScribeAdoption.Settings.StoryReasons;
            const retriable = new Set();
            ScribePanel.paged(panel, settings.Lists.Filing, pending, (item) => {
                const reason = item.kind === 'checker' ? 'Checker · ' + item.section + ' · ' + item.reason :
                    item.reason === 'answerPending' ? 'The model has not filed this answer.' :
                    item.reason === 'notePending' ? 'The model has not filed this operator note.' :
                    reasons[item.reason] ?? 'The model returned a row that still needs filing.';
                const statements = item.statement ? [item.statement] : item.statements ?? [];
                const detail = [reason, ...statements.map((text) => ScribeStore.diagnostic(panel.storage, text))].join(' · ');
                const row = ScribePanel.make(panel, settings.Tags.Item, '#' + item.position + (item.row ? ' · ' + item.row : '') + ' · ' + detail, settings.Classes.Row);
                const first = item.kind === 'story' ? panel.storyRetry : panel.inputRetry;
                const key = item.kind + ':' + item.id;
                if (first && first.first !== item.position && item.kind !== 'checker' && !retriable.has(key)) {
                    retriable.add(key);
                    const scope = panel.keeper.filingRetry(item.kind, item.id);
                    if (scope) {
                        row.append(ScribePanel.button(panel, 'Retry #' + item.position, () => ScribePanel.perform(panel, {
                            outlet: settings.Outlets.Controls, call: () => panel.keeper.retryStory(scope), question: null,
                            done: settings.Nothing, pending: words.Working, book: true,
                        }), settings.Guard.Book));
                    }
                }
                return row;
            }, null);
            const coverage = Number.isSafeInteger(view.linkedEntries) ?
                ' ' + view.linkedEntries + ' book entries with linked quotes, ' + view.unlinkedEntries + ' without. ' +
                Math.max(0, view.read - (view.processedChecks ?? view.checkedThrough)) + ' processed messages await the Checker.' : '';
            const checked = view.checkedCount ?? view.checkedThrough;
            const unjudged = (view.processedChecks ?? view.checkedThrough) - checked;
            ScribePanel.write(parts.Checked, parts.Checked.hidden ? settings.Nothing :
                'Checker: ' + checked + ' of ' + view.total + ' messages checked.' +
                (unjudged ? ' ' + unjudged + ' processed without a completed judgment.' : '') + coverage + schedule);
            ScribePanel.write(parts.Story, live.notice ?? settings.Nothing);
            const pulled = view.pulled;
            let line = pulled === null && !view.reader ? words.NoPullHere : settings.Nothing;
            if (pulled !== null) {
                line =
                    words.LastPullOpen +
                    PanelView.number(pulled.count) +
                    (pulled.count === settings.Single ? words.MessageOne : words.MessageMany) +
                    words.Ended +
                    PanelView.said(pulled.end);
                if (pulled.skipped > settings.NoCount) {
                    line += words.Comma + PanelView.number(pulled.skipped) + words.UnreadClose;
                }
            }
            parts.Pulled.hidden = line === settings.Nothing;
            ScribePanel.write(parts.Pulled, line);
            const disputed = PanelView.listed(view.unread).filter((message) => message?.attributionPending);
            parts.DisputedGroup.hidden = disputed.length === settings.NoCount;
            ScribePanel.paged(panel, settings.Lists.Disputed, disputed,
                (message) => ScribePanel.make(panel, settings.Tags.Item, words.PlayerMessage + message.position, settings.Classes.Row),
                null,
            );
            /**
             * @param {object} item
             * @return {object[]}
             */
            const whole = (item) => [item];
            const mask = ScribeStore.redactor(panel.storage);
            ScribePanel.paged(
                panel,
                settings.Lists.Lines,
                [...readings.reverse(), ...PanelView.each(view.lines, whole)],
                /**
                 * @param {object} report
                 * @return {object}
                 */
                (report) => report.statement === undefined ? ScribePanel.Rows.line(panel, report, mask) :
                    ScribePanel.make(panel, settings.Tags.Item, report.role + (report.first == null ? '' : ' · #' + report.first +
                        (report.first === report.last ? '' : '–#' + report.last)) + ' · ' + mask(report.statement), settings.Classes.Row),
                null,
            );
            ScribePanel.paged(
                panel,
                settings.Lists.Calls,
                PanelView.each(view.calls, whole),
                /**
                 * @param {object} record
                 * @return {object}
                 */
                (record) => ScribePanel.Rows.call(panel, record, mask),
                null,
            );
            ScribePanel.paged(
                panel,
                settings.Lists.LiveCalls,
                PanelView.each(live.calls, whole),
                /**
                 * @param {object} record
                 * @return {object}
                 */
                (record) => ScribePanel.Rows.liveCall(panel, record),
                null,
            );
        },

        /**
         * @param {object} panel
         * @param {object} view
         * @param {object} live
         * @param {{ keyed: boolean, notes: { length: number, cut: number|null }|null }} cloud
         * @return {void}
         */
        Settings(panel, view, live, cloud) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const parts = panel.parts;
            const book = PanelView.workerBook(view, cloud);
            ScribePanel.write(parts.CloudState, book.status + ' ' + book.action);
            parts.Notes.hidden = !cloud.keyed || !cloud.checkedNotes;
            const notes = cloud.notes;
            let told = words.NoNotes;
            if (notes !== null && notes.length > settings.NoCount) {
                const going = notes.length === settings.Single ? words.NotesGoOne : words.NotesGoMany;
                told = PanelView.number(notes.length) + going;
                if (notes.cut !== null) {
                    told += words.NotesCutOpen + PanelView.number(notes.cut) + words.NotesCutClose;
                }
            }
            ScribePanel.write(parts.Notes, told);
            ScribePanel.write(panel.parts.KeyState, view.hasKey === null ? words.KeyUnreadable : view.hasKey ? words.KeySaved : words.NoKey);
        },
    }),

    Rows: Object.freeze({
        /**
         * @param {object} panel
         * @param {string} outlet
         * @return {{ item: object, outcome: object, actions: object }}
         */
        frame(panel, outlet) {
            const settings = ScribePanel.Settings;
            const tags = settings.Tags;
            const classes = settings.Classes;
            panel.shown.add(outlet);
            const outcome = ScribePanel.make(
                panel,
                tags.Paragraph,
                panel.outcomes.get(outlet) ?? settings.Nothing,
                classes.Outcome,
            );
            outcome.setAttribute(settings.Attributes.Role, settings.Aria.Status);
            return {
                item: ScribePanel.make(panel, tags.Item, settings.Nothing, classes.Row),
                outcome,
                actions: ScribePanel.make(panel, tags.Block, settings.Nothing, classes.Actions),
            };
        },

        /**
         * @param {object} panel
         * @param {string} text
         * @return {object}
         */
        text(panel, text) {
            const settings = ScribePanel.Settings;
            const item = ScribePanel.make(panel, settings.Tags.Item, settings.Nothing, settings.Classes.Row);
            item.append(ScribePanel.make(panel, settings.Tags.Paragraph, text));
            return item;
        },

        /**
         * @param {object} panel
         * @param {{ id: string, label: string, kind: string, lines: string[] }} member
         * @return {object}
         */
        cast(panel, member) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const tags = settings.Tags;
            const item = ScribePanel.make(panel, tags.Item, settings.Nothing, settings.Classes.Row);
            const lines = ScribePanel.make(panel, tags.List, settings.Nothing, settings.Classes.Lines);
            lines.append(
                ...member.lines.map(
                    /**
                     * @param {string} line
                     * @return {object}
                     */
                    (line) => ScribePanel.make(panel, tags.Item, line),
                ),
            );
            item.append(
                ScribePanel.make(
                    panel,
                    tags.Paragraph,
                    member.label + words.Open + member.kind + words.Close,
                    settings.Classes.Strong,
                ),
                lines,
            );
            return item;
        },

        /**
         * @param {object} panel
         * @param {{ day: number, row: { range: string, place: string, reach: string, present: string, summary: string }, opens: boolean }} entry
         * @param {number} index
         * @return {object}
         */
        day(panel, entry, index) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const tags = settings.Tags;
            const row = entry.row;
            const item = ScribePanel.make(panel, tags.Item, settings.Nothing, settings.Classes.Row);
            if (entry.opens || index === 0) {
                item.append(
                    ScribePanel.make(
                        panel,
                        tags.Paragraph,
                        words.Day + PanelView.said(entry.day),
                        settings.Classes.Day,
                    ),
                );
            }
            const text = [
                PanelView.said(row.range),
                PanelView.said(row.place),
                PanelView.said(row.reach),
                words.Present + PanelView.said(row.present),
                PanelView.said(row.summary),
            ];
            item.append(ScribePanel.make(panel, tags.Paragraph, text.join(words.Joiner)));
            return item;
        },

        /**
         * @param {object} panel
         * @param {{ text: string, position: number }} thread
         * @return {object}
         */
        thread(panel, thread) {
            const words = ScribePanel.Settings.Words;
            return ScribePanel.Rows.text(
                panel,
                PanelView.said(thread.text) + words.Open + words.Hash + PanelView.said(thread.position) + words.Close,
            );
        },

        /**
         * @param {object} panel
         * @param {{ id: string, label: string, kind: string, facts: number, present: boolean }} row
         * @return {object}
         */
        subject(panel, row) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const item = ScribePanel.make(panel, settings.Tags.Item, settings.Nothing, settings.Classes.Row);
            const choose = ScribePanel.button(
                panel,
                PanelView.named(row.label),
                /**
                 * @return {Promise<void>}
                 */
                async () => {
                    panel.chosen = row.id;
                    panel.pages[settings.Lists.Facts] = settings.FirstPage;
                    panel.ticks.clear();
                    ScribePanel.say(panel, settings.Outlets.Add, settings.Nothing);
                    ScribePanel.say(panel, settings.Outlets.Split, settings.Nothing);
                    ScribePanel.redraw(panel);
                },
                settings.Guard.Free,
                ScribePanel.key(settings.Sections.Subjects, row.id, settings.Acts.Open),
            );
            if (row.id === panel.chosen) {
                choose.setAttribute(settings.Attributes.Current, settings.True);
            }
            const meta =
                PanelView.named(row.kind) +
                words.Comma +
                PanelView.said(row.facts) +
                words.InForce +
                (row.present ? words.RunningScene : settings.Nothing);
            item.append(choose, ScribePanel.make(panel, settings.Tags.Span, words.Space + meta, settings.Classes.Meta));
            return item;
        },

        /**
         * @param {object} panel
         * @param {{ id: string, category: string, text: string, source: string, status: string, audience: string, hidden: boolean, pinned: boolean }} fact
         * @return {object}
         */
        fact(panel, fact, room) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const acts = settings.Acts;
            const section = settings.Sections.Facts;
            const ruling = ScribeLog.Ruling;
            const outlet = ScribePanel.key(section, fact.id);
            const { item, outcome, actions } = ScribePanel.Rows.frame(panel, outlet);
            const editKey = ScribePanel.key(section, fact.id, 'edit');
            const wordingKey = ScribePanel.key(section, fact.id, 'wording');
            const draft = panel.factDraft;
            const editing = fact.expected && draft && draft.id === fact.id && draft.subject === panel.chosen && draft.room === room;
            item.setAttribute(settings.Attributes.Fact, fact.id);
            const parts = [
                PanelView.said(fact.id),
                PanelView.said(fact.category),
                PanelView.said(fact.text),
                PanelView.said(fact.source),
                PanelView.said(fact.status),
                words.KnownTo + PanelView.said(fact.audience),
            ];
            if (fact.hidden) {
                parts.push(words.HiddenMark);
            }
            if (fact.pinned) {
                parts.push(words.PinnedMark);
            }
            const tick = ScribePanel.field(
                panel,
                settings.InputTypes.Checkbox,
                words.SecondPerson,
                ScribePanel.key(section, fact.id, acts.Tick),
                false,
                false,
            );
            ScribePanel.belong(panel, outlet, tick.input);
            tick.input.checked = panel.ticks.has(fact.id);
            ScribePanel.listen(
                panel,
                tick.input,
                settings.Events.Change,
                /**
                 * @return {Promise<void>}
                 */
                async () => {
                    if (tick.input.checked) {
                        panel.ticks.add(fact.id);
                    } else {
                        panel.ticks.delete(fact.id);
                    }
                },
            );
            actions.append(
                ScribePanel.wait(
                    panel,
                    outlet,
                    ScribePanel.button(
                        panel,
                        words.Remove,
                        /**
                         * @return {Promise<boolean>}
                         */
                        () =>
                            ScribePanel.rule(
                                panel,
                                outlet,
                                { type: ruling.RemoveFact, fact: fact.id },
                                words.RemoveOpen +
                                    PanelView.said(fact.id) +
                                    words.Open +
                                    PanelView.said(fact.text) +
                                    words.Close +
                                    words.RemoveClose,
                            ),
                        settings.Guard.Book,
                        ScribePanel.key(section, fact.id, acts.Remove),
                        settings.Classes.Danger,
                    ),
                ),
                ScribePanel.wait(
                    panel,
                    outlet,
                    ScribePanel.button(
                        panel,
                        words.MakePublic,
                        /**
                         * @return {Promise<boolean>}
                         */
                        () =>
                            ScribePanel.rule(
                                panel,
                                outlet,
                                { type: ruling.Widen, fact: fact.id, to: ScribeKnowledge.Everyone },
                                null,
                            ),
                        settings.Guard.Book,
                        ScribePanel.key(section, fact.id, acts.Public),
                    ),
                ),
            );
            if (editing) {
                const field = ScribePanel.field(panel, settings.InputTypes.Area, 'Wording', wordingKey, true, false);
                panel.factInput = field.input;
                field.input.value = draft.text;
                ScribePanel.guard(panel, field.input, settings.Guard.Book);
                ScribePanel.wait(panel, outlet, field.input);
                const finish = async () => {
                    if (panel.factDraft !== draft) {
                        return;
                    }
                    panel.factDraft = null;
                    panel.factInput = null;
                    ScribePanel.mark(panel, wordingKey, false);
                    ScribePanel.say(panel, outlet, settings.Nothing);
                    ScribePanel.redraw(panel);
                    panel.keyed.get(editKey)?.focus();
                };
                const save = async () => {
                    if (panel.pending.has(outlet) || panel.factDraft !== draft) {
                        return;
                    }
                    const text = field.input.value.trim();
                    if (!ScribeLog.worded(text)) {
                        ScribePanel.refuse(panel, outlet, wordingKey, 'Write the corrected wording.');
                        return;
                    }
                    if (text !== draft.expected.text && !await ScribePanel.rule(panel, outlet, {
                        type: ruling.EditFact, fact: fact.id, expected: draft.expected, text,
                    }, null)) {
                        return;
                    }
                    finish();
                };
                actions.replaceChildren(
                    ScribePanel.wait(panel, outlet, ScribePanel.button(panel, words.EditCancel, finish, settings.Guard.Free,
                        ScribePanel.key(section, fact.id, 'cancel-edit'))),
                    ScribePanel.wait(panel, outlet, ScribePanel.button(panel, words.EditSave, save, settings.Guard.Book,
                        ScribePanel.key(section, fact.id, 'save-edit'), settings.Classes.Primary)),
                );
                item.append(field.label);
            } else if (fact.expected) {
                actions.append(ScribePanel.wait(panel, outlet, ScribePanel.button(panel, words.Edit, async () => {
                    panel.factDraft = { id: fact.id, subject: panel.chosen, room, expected: fact.expected, text: fact.expected.text };
                    panel.factInput = null;
                    ScribePanel.say(panel, outlet, settings.Nothing);
                    ScribePanel.redraw(panel);
                    panel.keyed.get(wordingKey)?.focus();
                }, settings.Guard.Book, editKey)));
            }
            item.append(
                ScribePanel.make(panel, settings.Tags.Paragraph, parts.join(words.Joiner)),
                tick.label,
                actions,
                outcome,
            );
            return item;
        },

        /**
         * @param {object} panel
         * @param {{ id: string, day: number, range: string, place: string, reach: string, present: string, summary: string }} row
         * @param {boolean} narrowing
         * @return {object}
         */
        scene(panel, row, narrowing) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const tags = settings.Tags;
            const text = [
                words.Day + PanelView.said(row.day),
                PanelView.said(row.range),
                PanelView.said(row.place),
                PanelView.said(row.reach),
                words.Present + PanelView.said(row.present),
                PanelView.said(row.summary),
            ];
            if (!narrowing) {
                const item = ScribePanel.make(panel, tags.Item, settings.Nothing, settings.Classes.Row);
                item.append(ScribePanel.make(panel, tags.Paragraph, text.join(words.Joiner)));
                return item;
            }
            const outlet = ScribePanel.key(settings.Sections.Scenes, row.id);
            const { item, outcome, actions } = ScribePanel.Rows.frame(panel, outlet);
            item.append(ScribePanel.make(panel, tags.Paragraph, text.join(words.Joiner)));
            actions.append(
                ScribePanel.wait(
                    panel,
                    outlet,
                    ScribePanel.button(
                        panel,
                        words.OnlyPresent,
                        /**
                         * @return {Promise<boolean>}
                         */
                        () => ScribePanel.rule(panel, outlet, { type: ScribeLog.Ruling.Narrow, scene: row.id }, null),
                        settings.Guard.Book,
                        ScribePanel.key(settings.Sections.Scenes, row.id, settings.Acts.Narrow),
                    ),
                ),
            );
            item.append(actions, outcome);
            return item;
        },

        /**
         * @param {object} panel
         * @param {{ subject: string, label: string, category: string, values: ReadonlyArray<{ fact: string, text: string, source: string, hidden: boolean, established: boolean }> }} conflict
         * @return {object}
         */
        conflict(panel, conflict) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const acts = settings.Acts;
            const section = settings.Sections.Conflicts;
            const point = BenchView.conflictKey(conflict);
            const outlet = ScribePanel.key(section, ...point);
            const { item, outcome, actions } = ScribePanel.Rows.frame(panel, outlet);

            /**
             * @param {string} act
             * @param {...string} more
             * @return {string}
             */
            const key = (act, ...more) => ScribePanel.key(section, ...point, act, ...more);

            /**
             * @param {string} text
             * @param {boolean} hidden
             * @return {Promise<boolean>}
             */
            const pin = (text, hidden) =>
                ScribePanel.rule(
                    panel,
                    outlet,
                    BenchView.pin(conflict, text, hidden),
                    null,
                );
            const choices = ScribePanel.make(panel, settings.Tags.Block, settings.Nothing, settings.Classes.Choices);
            for (const value of conflict.values) {
                const marks = [PanelView.said(value.text) + words.Open + PanelView.said(value.source) + words.Close];
                if (value.hidden) {
                    marks.push(words.HiddenMark);
                }
                if (value.established) {
                    marks.push(words.EstablishedMark);
                }
                choices.append(
                    ScribePanel.wait(
                        panel,
                        outlet,
                        ScribePanel.button(
                            panel,
                            marks.join(words.Comma),
                            /**
                             * @return {Promise<boolean>}
                             */
                            () => pin(value.text, value.hidden),
                            settings.Guard.Book,
                            key(acts.Value, value.fact),
                        ),
                    ),
                );
            }
            const other = ScribePanel.field(panel, settings.InputTypes.Text, words.Other, key(acts.Other), true, true);
            ScribePanel.belong(panel, outlet, other.input);
            const hidden = ScribePanel.field(
                panel,
                settings.InputTypes.Checkbox,
                words.HiddenMark,
                key(acts.Hidden),
                false,
                true,
            );
            ScribePanel.belong(panel, outlet, hidden.input);
            actions.append(
                ScribePanel.wait(
                    panel,
                    outlet,
                    ScribePanel.button(
                        panel,
                        words.PinOther,
                        /**
                         * @return {Promise<*>}
                         */
                        async () => {
                            const text = other.input.value.trim();
                            if (text === settings.Nothing) {
                                ScribePanel.refuse(panel, outlet, key(acts.Other), words.OtherMissing);
                                return false;
                            }
                            ScribePanel.mark(panel, key(acts.Other), false);
                            return pin(text, hidden.input.checked);
                        },
                        settings.Guard.Book,
                        key(acts.Pin),
                        settings.Classes.Primary,
                    ),
                ),
            );
            item.append(
                ScribePanel.make(
                    panel,
                    settings.Tags.Paragraph,
                    PanelView.named(conflict.label) + words.Comma + BenchView.scoped(conflict, PanelView.said(conflict.category)),
                ),
                choices,
                other.label,
                hidden.label,
                actions,
                outcome,
            );
            return item;
        },

        /**
         * @param {object} panel
         * @param {{ first: string, second: string, firstLabel: string, secondLabel: string, reason: string }} likeness
         * @return {object}
         */
        likeness(panel, likeness) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const acts = settings.Acts;
            const ruling = ScribeLog.Ruling;
            const outlet = ScribePanel.key(settings.Sections.Likes, likeness.first, likeness.second);
            const { item, outcome, actions } = ScribePanel.Rows.frame(panel, outlet);
            const firstLabel = PanelView.named(likeness.firstLabel);
            const secondLabel = PanelView.named(likeness.secondLabel);
            const pair = firstLabel + words.And + secondLabel;

            /**
             * @param {string} act
             * @return {string}
             */
            const key = (act) => ScribePanel.key(settings.Sections.Likes, likeness.first, likeness.second, act);
            const keep = ScribePanel.select(panel, words.KeepLabel, key(acts.Keep), true);
            ScribePanel.belong(panel, outlet, keep.select);
            ScribePanel.options(
                panel,
                keep.select,
                [
                    [likeness.first, firstLabel],
                    [likeness.second, secondLabel],
                ],
                likeness.first,
            );
            actions.append(
                ScribePanel.wait(
                    panel,
                    outlet,
                    ScribePanel.button(
                        panel,
                        words.SamePerson,
                        /**
                         * @return {Promise<boolean>}
                         */
                        () => {
                            const into = keep.select.value;
                            const first = into === likeness.first;
                            const from = first ? likeness.second : likeness.first;
                            const kept = first ? firstLabel : secondLabel;
                            return ScribePanel.rule(
                                panel,
                                outlet,
                                { type: ruling.Merge, from, into },
                                words.MergeOpen + pair + words.MergeKeeping + kept + words.Question,
                            );
                        },
                        settings.Guard.Book,
                        key(acts.Merge),
                    ),
                ),
                ScribePanel.wait(
                    panel,
                    outlet,
                    ScribePanel.button(
                        panel,
                        words.TwoPeople,
                        /**
                         * @return {Promise<boolean>}
                         */
                        () =>
                            ScribePanel.rule(
                                panel,
                                outlet,
                                { type: ruling.Distinct, first: likeness.first, second: likeness.second },
                                null,
                            ),
                        settings.Guard.Book,
                        key(acts.Distinct),
                    ),
                ),
            );
            item.append(
                ScribePanel.make(
                    panel,
                    settings.Tags.Paragraph,
                    pair +
                        words.Colon +
                        (Object.hasOwn(settings.Likeness, likeness.reason)
                            ? settings.Likeness[likeness.reason]
                            : PanelView.Settings.Words.Unknown),
                ),
                keep.label,
                actions,
                outcome,
            );
            return item;
        },

        /**
         * @param {object} panel
         * @param {{ id: string, text: string, position: number, answer: string|null }} question
         * @param {boolean} recovery
         * @return {object}
         */
        question(panel, question, recovery = false) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const acts = settings.Acts;
            const ruling = ScribeLog.Ruling;
            const section = settings.Sections.Questions;
            const outlet = ScribePanel.key(section, question.id);
            const { item, outcome, actions } = ScribePanel.Rows.frame(panel, outlet);
            item.append(
                ScribePanel.make(
                    panel,
                    settings.Tags.Paragraph,
                    PanelView.said(question.text) +
                        words.Open +
                        words.Hash +
                        PanelView.said(question.position) +
                        words.Close,
                ),
            );
            if (question.answer !== null) {
                item.append(
                    ScribePanel.make(
                        panel,
                        settings.Tags.Paragraph,
                        words.YourAnswer + PanelView.said(question.answer),
                        settings.Classes.Meta,
                    ),
                    ScribePanel.make(panel, settings.Tags.Paragraph, words.Answered, settings.Classes.Meta),
                );
                if (!recovery) {
                    return item;
                }
            }
            const textKey = ScribePanel.key(section, question.id, acts.Text);
            const field = ScribePanel.field(panel, settings.InputTypes.Text, words.AnswerLabel, textKey, true, true);
            ScribePanel.belong(panel, outlet, field.input);
            actions.append(
                ScribePanel.wait(
                    panel,
                    outlet,
                    ScribePanel.button(
                        panel,
                        words.Dismiss,
                        /**
                         * @return {Promise<boolean>}
                         */
                        () => ScribePanel.rule(panel, outlet, { type: ruling.Dismiss, question: question.id }, null),
                        settings.Guard.Book,
                        ScribePanel.key(section, question.id, acts.Dismiss),
                    ),
                ),
                ScribePanel.wait(
                    panel,
                    outlet,
                    ScribePanel.button(
                        panel,
                        words.Answer,
                        /**
                         * @return {Promise<*>}
                         */
                        async () => {
                            const text = field.input.value.trim();
                            if (text === settings.Nothing) {
                                ScribePanel.refuse(panel, outlet, textKey, words.AnswerMissing);
                                return false;
                            }
                            ScribePanel.mark(panel, textKey, false);
                            return ScribePanel.rule(
                                panel,
                                outlet,
                                { type: ruling.Answer, question: question.id, text },
                                null,
                            );
                        },
                        settings.Guard.Book,
                        ScribePanel.key(section, question.id, acts.Answer),
                        settings.Classes.Primary,
                    ),
                ),
            );
            item.append(field.label, actions, outcome);
            return item;
        },

        /**
         * @param {object} panel
         * @param {{ id: string, text: string, why: string }} contradiction
         * @return {object}
         */
        contradiction(panel, contradiction) {
            const settings = ScribePanel.Settings;
            const section = settings.Sections.Contradictions;
            const outlet = ScribePanel.key(section, contradiction.id);
            const { item, outcome, actions } = ScribePanel.Rows.frame(panel, outlet);
            actions.append(
                ScribePanel.wait(
                    panel,
                    outlet,
                    ScribePanel.button(
                        panel,
                        settings.Words.Dismiss,
                        /**
                         * @return {Promise<boolean>}
                         */
                        () =>
                            ScribePanel.rule(
                                panel,
                                outlet,
                                { type: ScribeLog.Ruling.DismissContradiction, contradiction: contradiction.id },
                                null,
                            ),
                        settings.Guard.Book,
                        ScribePanel.key(section, contradiction.id, settings.Acts.Dismiss),
                    ),
                ),
            );
            item.append(
                ScribePanel.make(panel, settings.Tags.Paragraph, contradiction.text),
                ScribePanel.make(panel, settings.Tags.Paragraph, contradiction.why, settings.Classes.Meta),
                actions,
                outcome,
            );
            return item;
        },

        /**
         * @param {object} panel
         * @param {{ subject: string, label: string, name: string }} alias
         * @return {object}
         */
        alias(panel, alias) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const section = settings.Sections.Aliases;
            const outlet = ScribePanel.key(section, alias.subject, alias.name);
            const { item, outcome, actions } = ScribePanel.Rows.frame(panel, outlet);
            actions.append(
                ScribePanel.wait(
                    panel,
                    outlet,
                    ScribePanel.button(
                        panel,
                        words.NotSame,
                        /**
                         * @return {Promise<boolean>}
                         */
                        () =>
                            ScribePanel.rule(
                                panel,
                                outlet,
                                { type: ScribeLog.Ruling.Unalias, subject: alias.subject, name: alias.name },
                                null,
                            ),
                        settings.Guard.Book,
                        ScribePanel.key(section, alias.subject, alias.name, settings.Acts.Unalias),
                    ),
                ),
            );
            item.append(
                ScribePanel.make(
                    panel,
                    settings.Tags.Paragraph,
                    [PanelView.said(alias.name) + words.JoinedTo + PanelView.named(alias.label), alias.source].filter(Boolean).join(' · '),
                ),
                actions,
                outcome,
            );
            return item;
        },

        /**
         * @param {object} panel
         * @param {{ label: string, category: string, from: string, to: string }} refinement
         * @return {object}
         */
        refinement(panel, refinement) {
            const words = ScribePanel.Settings.Words;
            return ScribePanel.Rows.text(
                panel,
                PanelView.named(refinement.label) +
                    words.Comma +
                    PanelView.said(refinement.category) +
                    words.Colon +
                    PanelView.said(refinement.from) +
                    words.Becomes +
                    PanelView.said(refinement.to),
            );
        },

        /**
         * @param {object} panel
         * @param {{ sequence: number, type: string, summary: string }} made
         * @return {object}
         */
        made(panel, made) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const section = settings.Sections.Made;
            const outlet = ScribePanel.key(section, made.sequence);
            const { item, outcome, actions } = ScribePanel.Rows.frame(panel, outlet);
            actions.append(
                ScribePanel.wait(
                    panel,
                    outlet,
                    ScribePanel.button(
                        panel,
                        words.Revoke,
                        /**
                         * @return {Promise<boolean>}
                         */
                        () =>
                            ScribePanel.perform(panel, {
                                outlet,
                                /**
                                 * @return {Promise<void>}
                                 */
                                call: () => panel.keeper.revoke(made.sequence),
                                question:
                                    words.RevokeOpen +
                                    PanelView.said(made.sequence) +
                                    words.Open +
                                    PanelView.said(made.summary) +
                                    words.Close +
                                    words.Question,
                                done: settings.Nothing,
                                pending: words.Saving,
                                book: true,
                            }),
                        settings.Guard.Book,
                        ScribePanel.key(section, made.sequence, settings.Acts.Revoke),
                        settings.Classes.Danger,
                    ),
                ),
            );
            item.append(
                ScribePanel.make(
                    panel,
                    settings.Tags.Paragraph,
                    PanelView.said(made.sequence) +
                        words.Dot +
                        PanelView.said(made.type) +
                        words.Colon +
                        PanelView.said(made.summary),
                ),
                actions,
                outcome,
            );
            return item;
        },

        /**
         * @param {object} panel
         * @param {{check:object, accounts:object[]}} row
         * @return {object}
         */
        checker(panel, row) {
            const settings = ScribePanel.Settings;
            const { check } = row;
            const accounts = BenchView.accounts(check, row.state);
            const outlet = ScribePanel.key(settings.Sections.Findings, check.id);
            const key = (role) => ScribePanel.key(outlet, check.version, role);
            const { item, actions, outcome } = ScribePanel.Rows.frame(panel, outlet);
            item.append(ScribePanel.make(panel, settings.Tags.Paragraph, BenchView.checkerTitle(check), settings.Classes.Strong));
            if (check.kind === 'Omission' && !check.diagnostic) {
                item.append(ScribePanel.make(panel, settings.Tags.Paragraph, 'Missing from the book'));
            }
            for (const account of accounts) {
                item.append(ScribePanel.make(panel, settings.Tags.Paragraph, account.text));
            }
            if (check.ruling) {
                item.append(ScribePanel.make(panel, settings.Tags.Paragraph, BenchView.checkerDecision(check.ruling), settings.Classes.Meta));
            }
            if (check.status === 'reopened') {
                item.append(ScribePanel.make(panel, settings.Tags.Paragraph, check.actionable === false ?
                    'Evidence changed. Waiting for the Checker to verify the current passages.' :
                    'Evidence changed. Review the current passages.', settings.Classes.Meta));
            }
            if (check.status === 'settled' || (check.actionable === false && !check.correctable)) {
                item.append(outcome);
                return item;
            }
            const share = !check.correctable && ScribeKnowledge.shareableFinding(row.state, check, row.messages) ? ScribePanel.field(panel,
                settings.InputTypes.Checkbox, 'Include this ruling in reminders for everyone', key('share'), false, true) : null;
            if (share) {
                ScribePanel.belong(panel, outlet, share.input);
                item.append(share.label);
            }
            const apply = (change) => ScribePanel.perform(panel, { outlet, question: null, book: true,
                pending: settings.Words.Saving, done: check.correctable ? 'Book updated.' : 'Ruling saved.',
                call: () => panel.keeper.ruling({ finding: check.id, version: check.version, ...change,
                    ...(change.action !== 'open' && share?.input.checked ? { shareInReminder: true } : {}) }) });
            const button = (label, act) => ScribePanel.wait(panel, outlet,
                ScribePanel.button(panel, label, act, settings.Guard.Book, key(label)));
            if (check.correctable) {
                const label = check.kind === 'Omission' ? 'File cited claim' : 'Correct book entry';
                item.append(button(label, () => apply({ action: 'choose', account: 'source' })), outcome);
                return item;
            }
            const choices = check.choices ? accounts.filter((option) => check.choices.includes(option.key)) : accounts;
            const account = ScribePanel.select(panel, 'Account to keep', key('account'), true);
            ScribePanel.options(panel, account.select, choices.map((option) => [option.key, option.text]), choices[0].key);
            ScribePanel.belong(panel, outlet, account.select);
            const explanation = ScribePanel.field(panel, settings.InputTypes.Text, 'Explanation for keeping both accounts',
                key('explanation'), false, true);
            ScribePanel.belong(panel, outlet, explanation.input);
            const choose = button('Choose account', () => apply({ action: 'choose', account: account.select.value }));
            const explain = button('Explain how both fit', async () => {
                const text = explanation.input.value.trim();
                if (!text) {
                    ScribePanel.refuse(panel, outlet, key('explanation'), 'Enter how the two accounts fit together.');
                    return false;
                }
                return apply({ action: 'explain', explanation: text });
            });
            item.append(account.label, choose, explanation.label, explain);
            if (check.status !== 'deferred') {
                actions.append(button('Leave open', () => apply({ action: 'open' })));
            }
            item.append(actions, outcome);
            return item;
        },

        /**
         * @param {object} panel
         * @param {{ key: string, status: string, title: string, detail: string, actions: string[], notes: string[] }} finding
         * @return {object}
         */
        finding(panel, finding) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const tags = settings.Tags;
            const section = settings.Sections.Findings;
            const outlet = ScribePanel.key(section, finding.key);
            const { item, outcome, actions } = ScribePanel.Rows.frame(panel, outlet);
            item.append(ScribePanel.make(panel, tags.Paragraph, finding.title, settings.Classes.Strong));
            if (finding.detail !== settings.Nothing) {
                item.append(ScribePanel.make(panel, tags.Paragraph, finding.detail));
            }
            for (const note of finding.notes) {
                item.append(ScribePanel.make(panel, tags.Paragraph, note, settings.Classes.Meta));
            }
            if (finding.status !== ScribeLive.Status.Open) {
                const named = Object.keys(ScribeLive.Status).find(
                    /**
                     * @param {string} name
                     * @return {boolean}
                     */
                    (name) => ScribeLive.Status[name] === finding.status,
                );
                item.append(
                    ScribePanel.make(
                        panel,
                        tags.Paragraph,
                        named === undefined ? PanelView.said(finding.status) : words.Statuses[named],
                        settings.Classes.Meta,
                    ),
                );
            }
            for (const [name, text] of Object.entries(PanelView.Settings.Actions)) {
                if (!finding.actions.includes(text)) {
                    continue;
                }
                if (name === settings.Ruling) {
                    actions.append(
                        ScribePanel.wait(
                            panel,
                            outlet,
                            ScribePanel.button(
                                panel,
                                text,
                                /**
                                 * @return {Promise<void>}
                                 */
                                async () => {
                                    const field = panel.parts.Tell;
                                    const telling = settings.Outlets.Tell;
                                    const line = ScribePanel.clean(finding.draft);
                                    const there = field.value.split(words.LineBreak).some(
                                        /**
                                         * @param {string} written
                                         * @return {boolean}
                                         */
                                        (written) => written.trim() === line.trim(),
                                    );
                                    const empty = field.value.trim() === settings.Nothing;
                                    const value = empty ? line : field.value + words.LineBreak + line;
                                    if (!there) {
                                        field.value = value;
                                    }
                                    if (finding.fingerprint) {
                                        panel.rulingOrigins.set(finding.key, { key: finding.key, fingerprint: finding.fingerprint, line });
                                    }
                                    panel.tab = settings.RulingsTab;
                                    ScribePanel.redraw(panel);
                                    field.focus();
                                },
                                settings.Guard.Free,
                                ScribePanel.key(section, finding.key, name),
                            ),
                        ),
                    );
                    continue;
                }
                const remedy = settings.Remedies[name];
                actions.append(
                    ScribePanel.wait(
                        panel,
                        outlet,
                        ScribePanel.button(
                            panel,
                            text,
                            /**
                             * @return {Promise<boolean>}
                             */
                            () =>
                                ScribePanel.perform(panel, {
                                    outlet,
                                    /**
                                     * @return {*}
                                     */
                                    call: () => panel.live[remedy.method](finding.key),
                                    question: null,
                                    done: settings.Nothing,
                                    pending: words.Saving,
                                    book: remedy.book,
                                }),
                            remedy.guard,
                            ScribePanel.key(section, finding.key, name),
                        ),
                    ),
                );
            }
            item.append(actions, outcome);
            return item;
        },

        /**
         * @param {object} panel
         * @param {{ pass: string, first: number|null, last: number|null, read: number, refusedLines: ReadonlyArray<{ line: string, reason: string }>, refusedOperations: ReadonlyArray<{ operation: object, reason: string }> }} source
         * @param {(text: string) => string} mask
         * @return {object}
         */
        line(panel, source, mask) {
            const report = ScribeStore.diagnosticCopy(source, mask);
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const tags = settings.Tags;
            const item = ScribePanel.make(panel, tags.Item, settings.Nothing, settings.Classes.Row);
            const refusedLines = PanelView.listed(report.refusedLines);
            const refusedOperations = PanelView.listed(report.refusedOperations);
            item.append(
                ScribePanel.make(panel, tags.Paragraph, PanelView.finished(report)),
            );
            const refused = [
                ...PanelView.each(
                    refusedLines,
                    /**
                     * @param {{ line: string, reason: string }} entry
                     * @return {string[]}
                     */
                    (entry) => [PanelView.said(entry.line) + words.Open + PanelView.said(entry.reason) + words.Close],
                ),
                ...PanelView.each(
                    refusedOperations,
                    /**
                     * @param {{ operation: object, reason: string }} entry
                     * @return {string[]}
                     */
                    (entry) => {
                        const operation = entry.operation;
                        const parts = [
                            operation.type,
                            operation.fact,
                            operation.label,
                            operation.name,
                            operation.category,
                            operation.text,
                            ...PanelView.sides(operation),
                        ];
                        const text = parts
                            .filter(
                                /**
                                 * @param {*} part
                                 * @return {boolean}
                                 */
                                (part) => typeof part === settings.StringType,
                            )
                            .join(words.Joiner);
                        return [text + words.Open + PanelView.said(entry.reason) + words.Close];
                    },
                ),
            ];
            if (refused.length === 0) {
                return item;
            }
            const list = ScribePanel.make(panel, tags.List, settings.Nothing);
            list.append(
                ...ScribePanel.items(
                    panel,
                    refused,
                    /**
                     * @param {string} text
                     * @return {object}
                     */
                    (text) => ScribePanel.make(panel, tags.Item, text),
                ),
            );
            item.append(
                ScribePanel.Rows.opening(
                    panel,
                    source,
                    words.Refused,
                    ScribePanel.key(settings.Sections.Lines, report.pass, report.first, report.last, report.read),
                    list,
                ),
            );
            return item;
        },

        /**
         * @param {object} panel
         * @param {{ sequence: number|null, pass: string, answer?: string, readable: boolean, stopped?: boolean }} source
         * @param {(text: string) => string} mask
         * @return {object}
         */
        call(panel, source, mask) {
            const { sequence, pass, answer: output, readable, stopped } = source;
            const record = ScribeStore.diagnosticCopy({ sequence, pass, answer: output, readable, stopped }, mask);
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const tags = settings.Tags;
            const answer = typeof record.answer === settings.StringType ? record.answer : settings.Nothing;
            const item = ScribePanel.make(panel, tags.Item, settings.Nothing, settings.Classes.Row);
            if (record.stopped === true) {
                const stopped = words.StoppedCall + PanelView.said(record.pass) + words.CostUnknown;
                item.append(ScribePanel.make(panel, tags.Paragraph, stopped, settings.Classes.Unreadable));
                return item;
            }
            const heading = record.readable
                ? ScribePanel.make(
                      panel,
                      tags.Paragraph,
                      words.CallOpen + PanelView.said(record.sequence) + words.Colon + PanelView.said(record.pass),
                  )
                : ScribePanel.make(
                      panel,
                      tags.Paragraph,
                      words.Unreadable + words.Colon + PanelView.said(record.pass),
                      settings.Classes.Unreadable,
                  );
            item.append(
                heading,
                ScribePanel.Rows.opening(
                    panel,
                    source,
                    words.AnswerText,
                    ScribePanel.key(settings.Sections.Calls, record.sequence, record.pass, answer.length),
                    ScribePanel.make(panel, tags.Preformatted, answer, settings.Classes.Message),
                ),
            );
            return item;
        },

        /**
         * @param {object} panel
         * @param {{ role: *, tokensIn: *, tokensOut: *, reasoningTokens: *, finish: *, answer: *, problem: * }} record
         * @return {object}
         */
        liveCall(panel, record) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const tags = settings.Tags;
            const item = ScribePanel.make(panel, tags.Item, settings.Nothing, settings.Classes.Row);
            let line =
                PanelView.said(record.role) +
                words.TokensIn +
                PanelView.said(record.tokensIn) +
                words.TokensOut +
                PanelView.said(record.tokensOut);
            if (typeof record.reasoningTokens === settings.NumberType) {
                line += words.Reasoning + PanelView.said(record.reasoningTokens);
            }
            const finish = typeof record.finish === settings.StringType ? ScribeStore.diagnostic(panel.storage, record.finish) : record.finish;
            line += words.FinishOpen + PanelView.said(finish);
            item.append(ScribePanel.make(panel, tags.Paragraph, line));
            if (typeof record.problem === settings.StringType) {
                item.append(ScribePanel.make(panel, tags.Paragraph, ScribeStore.diagnostic(panel.storage, record.problem), settings.Classes.Meta));
            }
            if (typeof record.answer === settings.StringType) {
                item.append(
                    ScribePanel.Rows.opening(
                        panel,
                        record,
                        words.CutAnswer,
                        ScribePanel.key(settings.Sections.LiveCalls, record.role, record.answer.length),
                        ScribePanel.make(panel, tags.Preformatted, ScribeStore.diagnostic(panel.storage, record.answer), settings.Classes.Message),
                    ),
                );
            }
            return item;
        },

        /**
         * @param {object} panel
         * @param {object} source
         * @param {string} title
         * @param {string} key
         * @param {object} content
         * @return {object}
         */
        opening(panel, source, title, key, content) {
            const settings = ScribePanel.Settings;
            const details = ScribePanel.make(panel, settings.Tags.Details, settings.Nothing);
            details.open = panel.opened.has(source);
            const summary = ScribePanel.make(panel, settings.Tags.Summary, title);
            ScribePanel.keyed(panel, summary, key);
            ScribePanel.listen(
                panel,
                details,
                settings.Events.Toggle,
                /**
                 * @return {Promise<void>}
                 */
                async () => {
                    if (details.open) {
                        panel.opened.add(source);
                    } else {
                        panel.opened.delete(source);
                    }
                },
            );
            details.append(summary, content);
            return details;
        },
    }),
});
