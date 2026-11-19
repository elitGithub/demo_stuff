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
        Unauthorized: 401,
        AcceptedForProcessing: 202,
        Refused: Object.freeze([400, 403, 404, 405, 413, 415, 422, 429]),
        Bubbles: true,
        Cancelable: true,
        Nothing: '',
        EnterKey: 'Enter',
        EnterCode: 'Enter',
        KeyDown: 'keydown',
        PointerDown: 'pointerdown',
        Click: 'click',
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
     * @param {{ ready: string|null, suggestion: string|null, manual?: boolean, ends?: readonly number[] }} lines
     * @param {number} limit
     * @return {Readonly<{ text: string, ready: boolean, suggestion: boolean, carried: string|null, crowded: boolean }>}
     */
    compose(text, lines, limit) {
        const settings = ScribeSender.Settings;
        const ready = lines.ready;
        if (settings.Blank.test(text)) {
            return Object.freeze({ text, ready: false, suggestion: false, carried: null, crowded: false });
        }
        const manual = ready !== null && lines.manual === true;
        const ends = !manual && ready !== null && Array.isArray(lines.ends) ? lines.ends : [];
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
        if (manual) {
            const paragraph = ScribeSender.paragraph(ready);
            const fits = ScribeText.bytes(whole(paragraph, null)) <= limit;
            if (!fits || ScribeText.bytes(whole(paragraph, suggestion)) > limit) {
                suggestion = null;
            }
            return Object.freeze({
                text: whole(fits ? paragraph : null, suggestion),
                ready: fits,
                suggestion: suggestion !== null,
                carried: fits ? paragraph : null,
                crowded: !fits,
            });
        }
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
     * @param {string} text
     * @return {string}
     */
    paragraph(text) {
        const bare = text.replace(/^([\p{Zs}\t]*)(?:@:[\p{Zs}\t]*)+(?=\[Scribe\](?:\s|$))/u, '$1');
        return ScribeText.reminderLine(bare.split(/\r?\n/, 1)[0]) ? bare : '[Scribe] ' + bare;
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
            const delay = sender.pending.sampled ? ScribeSender.Settings.CheckMs : ScribeSender.Settings.NoWait;
            sender.timer = sender.window.setTimeout(sender.tick, delay);
        }
    },

    /**
     * @param {object} sender
     * @param {HTMLTextAreaElement} box
     * @param {{text: string, receipt: object}|null} authorized
     * @return {boolean}
     */
    prepare(sender, box, authorized = null) {
        const settings = ScribeSender.Settings;
        const text = box.value;
        if (sender.reservation) {
            return true;
        }
        if (text.trim() === settings.Nothing) {
            return false;
        }
        const pending = sender.pending;
        if (pending !== null) {
            if (!pending.cleared && text.includes(ScribeSender.tracked(pending))) {
                pending.waited = settings.NoWait;
                return sender.resend !== null;
            }
            sender.window.clearTimeout(sender.timer);
            sender.timer = null;
            sender.pending = null;
            ScribeSender.finish(sender, pending, true);
        }
        const result = authorized ? authorized.text : sender.outgoing(text);
        const receipt = authorized ? authorized.receipt : sender.receipt?.();
        if (!authorized && receipt?.reserve) {
            const reservation = { box, cancel: null };
            sender.reservation = reservation;
            reservation.cancel = receipt.reserve((allowed) => {
                sender.reservation = null;
                if (sender.detached || allowed === null ||
                    box !== ScribeSender.find(sender.document, sender.ignore) || box.value !== text) {
                    receipt.cancelled();
                    return;
                }
                let send = { text: result, receipt };
                if (!allowed) {
                    receipt.cancelled();
                    send = { text: sender.outgoing(text, true), receipt: sender.receipt?.() };
                }
                ScribeSender.prepare(sender, box, send);
                sender.resend = sender.window.setTimeout(() => sender.again(box), settings.ResendMs);
            });
            return true;
        }
        const added = result.slice(text.length);
        const writes = result.startsWith(text) && added.length > settings.NoLength && (receipt?.manual || !text.endsWith(added));
        if (writes) {
            const { selectionStart, selectionEnd, selectionDirection } = box;
            ScribeSender.write(sender.window, box, result);
            if (typeof box.setSelectionRange === settings.FunctionType &&
                (box.selectionStart !== selectionStart || box.selectionEnd !== selectionEnd)) {
                box.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
            }
        }
        sender.pending = {
            box, added: writes ? added : null, original: text, waited: settings.NoWait, sampled: false, cleared: false,
            receipt, event: null, bound: false, ambiguous: false, status: null, finished: false, outcome: null,
        };
        return writes;
    },

    /**
     * @param {object} sender
     * @param {object} pending
     * @param {boolean} consumed
     * @return {void}
     */
    finish(sender, pending, consumed) {
        if (!pending.receipt) {
            if (consumed) {
                sender.sent();
            } else {
                sender.cancelled?.();
            }
            return;
        }
        pending.finished = true;
        let outcome = 'uncertain';
        if (!consumed && !pending.bound) {
            outcome = 'cancelled';
        } else if (!pending.ambiguous && pending.status === ScribeSender.Settings.Unauthorized) {
            outcome = 'rejected';
        } else if (!pending.ambiguous && ScribeSender.Settings.Refused.includes(pending.status)) {
            outcome = 'cancelled';
        } else if (!pending.ambiguous && pending.status >= 200 && pending.status < 300 && pending.status !== ScribeSender.Settings.AcceptedForProcessing) {
            outcome = 'confirmed';
        }
        if (outcome !== pending.outcome && !sender.detached) {
            pending.outcome = outcome;
            if ((outcome === 'rejected' || outcome === 'cancelled') && sender.pending === pending) {
                sender.window.clearTimeout(sender.resend);
                sender.window.clearTimeout(sender.timer);
                sender.resend = null;
                sender.timer = null;
                sender.pending = null;
                const box = pending.box;
                if (pending.added !== null && box === ScribeSender.find(sender.document, sender.ignore) &&
                    box.value.startsWith(pending.original + pending.added)) {
                    const start = pending.original.length;
                    const end = start + pending.added.length;
                    const mapped = (position) => position <= start ? position : Math.max(start, position - pending.added.length);
                    const caret = [mapped(box.selectionStart), mapped(box.selectionEnd), box.selectionDirection];
                    ScribeSender.write(sender.window, box, pending.original + box.value.slice(end));
                    if (typeof box.setSelectionRange === ScribeSender.Settings.FunctionType) {
                        box.setSelectionRange(...caret);
                    }
                }
            }
            pending.receipt[outcome]();
        }
    },

    /**
     * @param {{ document: Document, window: Window, outgoing: function(string): string, sent: function(): void, cancelled?: function(): void, ignore: Element|null }} options
     * @return {Readonly<{ detach: function(): void }>}
     */
    attach(options) {
        const { document, window, outgoing, sent, ignore } = options;
        const settings = ScribeSender.Settings;
        const sender = {
            document,
            window,
            ignore,
            outgoing,
            sent,
            receipt: options.receipt,
            cancelled: options.cancelled,
            detached: false,
            pending: null,
            timer: null,
            resend: null,
            resending: false,
            reservation: null,
            tick: null,
        };
        /**
         * @return {void}
         */
        const cancelled = (pending) => {
            window.clearTimeout(sender.resend);
            sender.resend = null;
            ScribeSender.finish(sender, pending, false);
        };
        /**
         * @return {void}
         */
        sender.tick = () => {
            const pending = sender.pending;
            sender.timer = null;
            try {
                const box = ScribeSender.find(document, ignore);
                if (!pending.sampled) {
                    pending.sampled = true;
                    pending.cleared = box !== null && box.value === settings.Nothing;
                    ScribeSender.watch(sender);
                    return;
                }
                if (pending.cleared || (box !== null && !box.value.includes(ScribeSender.tracked(pending)))) {
                    sender.pending = null;
                    ScribeSender.finish(sender, pending, true);
                    return;
                }
                pending.waited += settings.CheckMs;
                if (pending.waited < settings.SettleMs) {
                    ScribeSender.watch(sender);
                    return;
                }
                sender.pending = null;
                if (box !== null) {
                    cancelled(pending);
                    if (pending.added !== null) {
                        ScribeSender.withdraw(window, box, pending.added);
                    }
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
            if (sender.reservation && ScribeSender.on(event, sender.reservation.box)) {
                sender.reservation.cancel();
            }
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
                if (pending.cleared || !box.value.includes(ScribeSender.tracked(pending))) {
                    ScribeSender.finish(sender, pending, true);
                    return;
                }
                cancelled(pending);
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
            if (sender.reservation && ScribeSender.on(event, sender.reservation.box)) {
                sender.reservation.cancel();
            }
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
                if (pending.cleared) {
                    ScribeSender.finish(sender, pending, true);
                    return;
                }
                cancelled(pending);
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
        sender.again = (box) => {
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
                if (sender.pending) {
                    sender.pending.event = event;
                }
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
                    if (sender.pending) {
                        sender.pending.event = event;
                    }
                    ScribeSender.watch(sender);
                    return;
                }
                event.preventDefault();
                event.stopImmediatePropagation();
                if (sender.resend === null && !sender.reservation) {
                    sender.resend = window.setTimeout(
                        /**
                         * @return {void}
                         */
                        () => {
                            sender.again(active);
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
                    if (options.manualClick?.()) {
                        event.stopImmediatePropagation();
                        return;
                    }
                    ScribeSender.prepare(sender, box);
                    if (sender.pending) {
                        sender.pending.event = event;
                    }
                    ScribeSender.watch(sender);
                }
            } catch {
                return;
            }
        };
        const click = (event) => {
            if (!event.target?.closest?.(settings.SendButton) || ScribeSender.inside(event, ignore)) {
                return;
            }
            if (options.manualClick?.()) {
                const box = ScribeSender.find(document, ignore);
                if (box && ScribeSender.prepare(sender, box)) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    return;
                }
                ScribeSender.watch(sender);
            }
            if (sender.pending) {
                sender.pending.event = event;
            }
        };
        window.addEventListener(settings.KeyDown, key, settings.Capture);
        window.addEventListener(settings.PointerDown, press, settings.Capture);
        if (options.receipt) {
            window.addEventListener(settings.Click, click, settings.Capture);
        }
        window.addEventListener(settings.Input, typed, settings.Capture);
        for (const type of settings.Edits) {
            window.addEventListener(type, touched, settings.Capture);
        }
        return Object.freeze({
            /**
             * @param {string} room
             * @return {Function|null}
             */
            posting: (room) => {
                const pending = sender.pending;
                if (!pending?.receipt || !(pending.event?.eventPhase > 0) || !pending.receipt.room(room)) {
                    return null;
                }
                if (pending.bound) {
                    pending.ambiguous = true;
                }
                pending.bound = true;
                return (status) => {
                    pending.status = Number.isInteger(status) ? status : null;
                    if (pending.finished || status === settings.Unauthorized || settings.Refused.includes(status)) {
                        if (pending.event?.eventPhase > 0) {
                            Promise.resolve().then(() => ScribeSender.finish(sender, pending, true));
                        } else {
                            ScribeSender.finish(sender, pending, true);
                        }
                    }
                };
            },
            /**
             * @return {void}
             */
            detach: () => {
                window.removeEventListener(settings.KeyDown, key, settings.Capture);
                window.removeEventListener(settings.PointerDown, press, settings.Capture);
                if (options.receipt) {
                    window.removeEventListener(settings.Click, click, settings.Capture);
                }
                window.removeEventListener(settings.Input, typed, settings.Capture);
                for (const type of settings.Edits) {
                    window.removeEventListener(type, touched, settings.Capture);
                }
                window.clearTimeout(sender.resend);
                window.clearTimeout(sender.timer);
                const pending = sender.pending;
                if (pending !== null && sender.resend !== null) {
                    cancelled(pending);
                }
                sender.detached = true;
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
