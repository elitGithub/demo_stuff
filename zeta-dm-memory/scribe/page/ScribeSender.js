const ScribeSender = Object.freeze({
    Settings: Object.freeze({
        SettleMs: 1500,
        CheckMs: 100,
        ResendMs: 25,
        NoWait: 0,
        Start: 0,
        ComposingKeyCode: 229,
        EnterKeyCode: 13,
        Capture: true,
        Bubbles: true,
        Cancelable: true,
        Nothing: '',
        EnterKey: 'Enter',
        EnterCode: 'Enter',
        KeyDown: 'keydown',
        PointerDown: 'pointerdown',
        Input: 'input',
        Change: 'change',
        InputType: 'insertText',
        Value: 'value',
        Tracker: '_valueTracker',
        FunctionType: 'function',
        Newline: '\n',
        NarratorLead: '@: ',
        NoLength: 0,
        Box: 'textarea[name="message"]',
        SendButton: 'button[aria-label="Send"]',
        Modifiers: Object.freeze(['Shift', 'Control', 'Alt', 'Meta']),
        Edits: Object.freeze(['beforeinput', 'paste', 'cut', 'drop', 'compositionstart']),

        /**
         * @return {RegExp}
         */
        get Blank() {
            return /^[\p{Z}\p{Cc}\p{Cf}]*$/u;
        },
    }),

    /**
     * @param {string} text
     * @param {{ ready: string|null, suggestion: string|null, ends?: readonly number[] }} lines
     * @param {number} limit
     * @return {Readonly<{ text: string, ready: boolean, suggestion: boolean, carried: string|null, crowded: boolean }>}
     */
    compose(text, lines, limit) {
        const settings = ScribeSender.Settings;
        const ready = lines.ready;
        if (settings.Blank.test(text)) {
            return Object.freeze({ text, ready: false, suggestion: false, carried: null, crowded: false });
        }
        const ends = ready !== null && Array.isArray(lines.ends) ? lines.ends : [];
        const versions = ready === null ? [] : [ready];
        for (const end of [...ends].reverse()) {
            if (Number.isSafeInteger(end) && end > settings.NoLength && end < ready.length) {
                versions.push(ready.slice(settings.NoLength, end));
            }
        }
        /**
         * @param {string|null} carried
         * @param {string|null} suggestion
         * @return {string}
         */
        const whole = (carried, suggestion) => {
            let joined = text;
            for (const line of [carried, suggestion]) {
                if (line !== null) {
                    joined += settings.Newline + settings.NarratorLead + line;
                }
            }
            return joined;
        };
        let suggestion = lines.suggestion;
        let carried = null;
        for (const version of versions) {
            if (carried === null && ScribeText.bytes(whole(version, suggestion)) <= limit) {
                carried = version;
            }
        }
        if (carried === null && suggestion !== null && ScribeText.bytes(whole(null, suggestion)) > limit) {
            suggestion = null;
        }
        return Object.freeze({
            text: whole(carried, suggestion),
            ready: carried !== null,
            suggestion: suggestion !== null,
            carried,
            crowded: ready !== null && carried === null,
        });
    },

    /**
     * @param {Document} document
     * @param {Element|null} ignore
     * @return {HTMLTextAreaElement|null}
     */
    find(document, ignore) {
        for (const element of document.querySelectorAll(ScribeSender.Settings.Box)) {
            if (ignore === null || !ignore.contains(element)) {
                return element;
            }
        }
        return null;
    },

    /**
     * @param {Event} event
     * @param {Element|null} ignore
     * @return {boolean}
     */
    inside(event, ignore) {
        if (ignore === null) {
            return false;
        }
        const path = typeof event.composedPath === ScribeSender.Settings.FunctionType ? event.composedPath() : [];
        return path.includes(ignore) || ignore.contains(event.target);
    },

    /**
     * @param {Event} event
     * @param {HTMLTextAreaElement|null} box
     * @return {boolean}
     */
    on(event, box) {
        const path = typeof event.composedPath === ScribeSender.Settings.FunctionType ? event.composedPath() : [];
        return box !== null && (event.target === box || path.includes(box));
    },

    /**
     * @param {Window} window
     * @param {HTMLTextAreaElement} box
     * @param {string} value
     * @return {void}
     */
    write(window, box, value) {
        const settings = ScribeSender.Settings;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, settings.Value)?.set;
        const tracker = box[settings.Tracker];
        if (tracker !== undefined && tracker !== null) {
            tracker.setValue(box.value);
        }
        if (setter === undefined) {
            box.value = value;
        } else {
            setter.call(box, value);
        }
        box.dispatchEvent(
            new window.InputEvent(settings.Input, {
                bubbles: settings.Bubbles,
                inputType: settings.InputType,
                data: value,
            }),
        );
        box.dispatchEvent(new window.Event(settings.Change, { bubbles: settings.Bubbles }));
    },

    /**
     * @param {Window} window
     * @param {HTMLTextAreaElement} box
     * @param {string} added
     * @return {void}
     */
    withdraw(window, box, added) {
        const start = ScribeSender.Settings.Start;
        const value = box.value;
        const at = value.lastIndexOf(added);
        if (at >= start) {
            ScribeSender.write(window, box, value.slice(start, at) + value.slice(at + added.length));
        }
    },

    /**
     * @param {{ added: string|null, original: string }} pending
     * @return {string}
     */
    tracked(pending) {
        return pending.added === null ? pending.original : pending.added;
    },

    /**
     * @param {object} sender
     * @return {void}
     */
    watch(sender) {
        if (sender.pending !== null && sender.resend === null && sender.timer === null) {
            sender.timer = sender.window.setTimeout(sender.tick, ScribeSender.Settings.CheckMs);
        }
    },

    /**
     * @param {object} sender
     * @param {HTMLTextAreaElement} box
     * @return {boolean}
     */
    prepare(sender, box) {
        const settings = ScribeSender.Settings;
        const text = box.value;
        if (text.trim() === settings.Nothing) {
            return false;
        }
        const pending = sender.pending;
        if (pending !== null) {
            if (text.includes(ScribeSender.tracked(pending))) {
                pending.waited = settings.NoWait;
                return sender.resend !== null;
            }
            sender.window.clearTimeout(sender.timer);
            sender.timer = null;
            sender.pending = null;
            sender.sent();
        }
        const result = sender.outgoing(text);
        const added = result.slice(text.length);
        const writes = result.startsWith(text) && !text.endsWith(added);
        if (writes) {
            ScribeSender.write(sender.window, box, result);
        }
        sender.pending = { added: writes ? added : null, original: text, waited: settings.NoWait };
        return writes;
    },

    /**
     * @param {{ document: Document, window: Window, outgoing: function(string): string, sent: function(): void, ignore: Element|null }} options
     * @return {Readonly<{ detach: function(): void }>}
     */
    attach(options) {
        const { document, window, outgoing, sent, ignore } = options;
        const settings = ScribeSender.Settings;
        const sender = {
            document,
            window,
            outgoing,
            sent,
            pending: null,
            timer: null,
            resend: null,
            resending: false,
            tick: null,
        };
        /**
         * @return {void}
         */
        sender.tick = () => {
            const pending = sender.pending;
            sender.timer = null;
            try {
                const box = ScribeSender.find(document, ignore);
                if (box !== null && !box.value.includes(ScribeSender.tracked(pending))) {
                    sender.pending = null;
                    sent();
                    return;
                }
                pending.waited += settings.CheckMs;
                if (pending.waited < settings.SettleMs) {
                    ScribeSender.watch(sender);
                    return;
                }
                sender.pending = null;
                if (box !== null && pending.added !== null) {
                    ScribeSender.withdraw(window, box, pending.added);
                }
            } catch {
                sender.pending = null;
            }
        };
        /**
         * @param {Event} event
         * @return {void}
         */
        const touched = (event) => {
            const pending = sender.pending;
            if (sender.resending || pending === null) {
                return;
            }
            try {
                const box = ScribeSender.find(document, ignore);
                if (!ScribeSender.on(event, box)) {
                    return;
                }
                window.clearTimeout(sender.timer);
                sender.timer = null;
                sender.pending = null;
                if (!box.value.includes(ScribeSender.tracked(pending))) {
                    sent();
                    return;
                }
                if (pending.added !== null) {
                    const end = pending.original.length;
                    ScribeSender.write(window, box, pending.original);
                    if (typeof box.setSelectionRange === settings.FunctionType) {
                        box.setSelectionRange(end, end);
                    }
                }
            } catch {
                return;
            }
        };
        /**
         * @param {InputEvent} event
         * @return {void}
         */
        const typed = (event) => {
            const pending = sender.pending;
            if (pending === null) {
                return;
            }
            try {
                const box = ScribeSender.find(document, ignore);
                if (!ScribeSender.on(event, box)) {
                    return;
                }
                window.clearTimeout(sender.timer);
                sender.timer = null;
                sender.pending = null;
                const value = box.value;
                const original = pending.original;
                const added = pending.added;
                if (added === null) {
                    return;
                }
                const at = value.startsWith(original + added) ? original.length : value.lastIndexOf(added);
                if (at >= settings.Start) {
                    ScribeSender.write(window, box, value.slice(settings.Start, at) + value.slice(at + added.length));
                    return;
                }
                if (!value.startsWith(original)) {
                    return;
                }
                const rest = value.slice(original.length);
                for (let run = Math.min(added.length, rest.length); run > settings.Start; run--) {
                    if (added.startsWith(rest.slice(settings.Start, run))) {
                        ScribeSender.write(window, box, original + rest.slice(run));
                        return;
                    }
                }
            } catch {
                return;
            }
        };
        /**
         * @param {HTMLTextAreaElement} box
         * @return {void}
         */
        const again = (box) => {
            try {
                sender.resending = true;
                try {
                    box.dispatchEvent(
                        new window.KeyboardEvent(settings.KeyDown, {
                            key: settings.EnterKey,
                            code: settings.EnterCode,
                            keyCode: settings.EnterKeyCode,
                            which: settings.EnterKeyCode,
                            bubbles: settings.Bubbles,
                            cancelable: settings.Cancelable,
                        }),
                    );
                } finally {
                    sender.resending = false;
                    sender.resend = null;
                }
                ScribeSender.watch(sender);
            } catch {
                sender.pending = null;
            }
        };
        /**
         * @param {KeyboardEvent} event
         * @return {void}
         */
        const key = (event) => {
            if (sender.resending) {
                return;
            }
            try {
                const entered =
                    event.key === settings.EnterKey &&
                    !event.shiftKey &&
                    !event.ctrlKey &&
                    !event.altKey &&
                    !event.metaKey &&
                    !event.isComposing &&
                    event.keyCode !== settings.ComposingKeyCode;
                if (!entered) {
                    if (!settings.Modifiers.includes(event.key)) {
                        touched(event);
                    }
                    return;
                }
                const active = ScribeSender.find(document, ignore);
                if (active === null || document.activeElement !== active) {
                    return;
                }
                if (!ScribeSender.prepare(sender, active)) {
                    ScribeSender.watch(sender);
                    return;
                }
                event.preventDefault();
                event.stopImmediatePropagation();
                if (sender.resend === null) {
                    sender.resend = window.setTimeout(
                        /**
                         * @return {void}
                         */
                        () => {
                            again(active);
                        },
                        settings.ResendMs,
                    );
                }
            } catch {
                return;
            }
        };
        /**
         * @param {PointerEvent} event
         * @return {void}
         */
        const press = (event) => {
            try {
                if (ScribeSender.inside(event, ignore)) {
                    return;
                }
                const button = event.target.closest(settings.SendButton);
                const box = ScribeSender.find(document, ignore);
                if (button !== null && box !== null) {
                    ScribeSender.prepare(sender, box);
                    ScribeSender.watch(sender);
                }
            } catch {
                return;
            }
        };
        window.addEventListener(settings.KeyDown, key, settings.Capture);
        window.addEventListener(settings.PointerDown, press, settings.Capture);
        window.addEventListener(settings.Input, typed, settings.Capture);
        for (const type of settings.Edits) {
            window.addEventListener(type, touched, settings.Capture);
        }
        return Object.freeze({
            /**
             * @return {void}
             */
            detach: () => {
                window.removeEventListener(settings.KeyDown, key, settings.Capture);
                window.removeEventListener(settings.PointerDown, press, settings.Capture);
                window.removeEventListener(settings.Input, typed, settings.Capture);
                for (const type of settings.Edits) {
                    window.removeEventListener(type, touched, settings.Capture);
                }
                window.clearTimeout(sender.resend);
                window.clearTimeout(sender.timer);
                const pending = sender.pending;
                sender.resend = null;
                sender.timer = null;
                sender.pending = null;
                try {
                    const box = ScribeSender.find(document, ignore);
                    if (pending !== null && pending.added !== null && box !== null) {
                        ScribeSender.withdraw(window, box, pending.added);
                    }
                } catch {
                    return;
                }
            },
        });
    },
});
