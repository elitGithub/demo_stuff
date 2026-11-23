const ScribeFrame = Object.freeze({
    Bridge: Object.freeze({
        TopOrigin: 'https://zeta-ai.io',
        FrameOrigin: 'https://frame.pingpong.ai',
        FramePrefix: 'https://frame.pingpong.ai/',
        TagName: 'zetaScribe',
        Tag: 1,
        TokenName: 'scribe-bridge',
        Kind: Object.freeze({
            Ready: 'ready',
            Arm: 'arm',
            Starting: 'starting',
            Reserved: 'reserved',
            Cancelled: 'cancelled',
            Rejected: 'rejected',
            Uncertain: 'uncertain',
            Sent: 'sent',
            Activity: 'activity',
            Messages: 'messages',
        }),
        ReadyRepeatMs: 1000,
        MessageBytes: 4500,
        LongestLine: 6000,
        LongestIdentity: 200,
    }),

    Role: Object.freeze({
        Top: 'Top',
        Frame: 'Frame',
        None: 'None',
    }),

    Settings: Object.freeze({
        Message: 'message',
        NoSeq: -1,
        LowestSeq: 0,
        ShortestToken: 16,
        LongestToken: 200,
        Nearest: 0,
        NoLength: 0,
        ObjectType: 'object',
        StringType: 'string',
        BooleanType: 'boolean',
        NothingOffered: Object.freeze({
            ready: null,
            suggestion: null,
            ends: Object.freeze([]),
            reminder: null,
            attempt: null,
        }),
        FirstIndex: 0,
        OneIndex: 1,
    }),

    /**
     * @param {{ origin: string, top: boolean, ancestors: ArrayLike<string>|null, parented: boolean }} where
     * @return {string}
     */
    role(where) {
        const bridge = ScribeFrame.Bridge;
        if (where.origin === bridge.TopOrigin && where.top === true) {
            return ScribeFrame.Role.Top;
        }
        const underTop =
            where.ancestors === null
                ? where.parented === true
                : where.ancestors[ScribeFrame.Settings.Nearest] === bridge.TopOrigin;
        if (where.origin === bridge.FrameOrigin && underTop) {
            return ScribeFrame.Role.Frame;
        }
        return ScribeFrame.Role.None;
    },

    /**
     * @param {*} data
     * @param {string} kind
     * @return {boolean}
     */
    tagged(data, kind) {
        const bridge = ScribeFrame.Bridge;
        return (
            typeof data === ScribeFrame.Settings.ObjectType &&
            data !== null &&
            data[bridge.TagName] === bridge.Tag &&
            data.kind === kind
        );
    },

    /**
     * @param {*} seq
     * @return {boolean}
     */
    counted(seq) {
        return Number.isSafeInteger(seq) && seq >= ScribeFrame.Settings.LowestSeq;
    },

    /**
     * @param {*} identity
     * @return {boolean}
     */
    named(identity) {
        const settings = ScribeFrame.Settings;
        return (
            identity === null ||
            (typeof identity === settings.StringType &&
                identity.length > settings.NoLength &&
                identity.length <= ScribeFrame.Bridge.LongestIdentity)
        );
    },

    /**
     * @param {*} data
     * @return {Readonly<{ zetaScribe: number, kind: string, seq: number, token: string, ready: string|null, suggestion: string|null, ends: readonly number[], reminder: string|null, attempt: string|null }>|null}
     */
    arm(data) {
        const bridge = ScribeFrame.Bridge;
        const settings = ScribeFrame.Settings;
        if (!ScribeFrame.tagged(data, bridge.Kind.Arm)) {
            return null;
        }
        const { seq, token, ready, suggestion } = data;
        const lines = [ready, suggestion].every(
            /**
             * @param {*} line
             * @return {boolean}
             */
            (line) => line === null || (typeof line === settings.StringType && line.length <= bridge.LongestLine),
        );
        const keyed =
            typeof token === settings.StringType &&
            token.length >= settings.ShortestToken &&
            token.length <= settings.LongestToken;
        const reminder = data.reminder === undefined ? null : data.reminder;
        const attempt = data.attempt === undefined ? null : data.attempt;
        const identified =
            ScribeFrame.named(reminder) && ScribeFrame.named(attempt) && (reminder === null) === (attempt === null);
        if (!ScribeFrame.counted(seq) || !keyed || !lines || !identified) {
            return null;
        }
        const given = Array.isArray(data.ends) && ready !== null ? data.ends : [];
        const ordered = given.every(
            /**
             * @param {*} end
             * @param {number} index
             * @return {boolean}
             */
            (end, index) =>
                Number.isSafeInteger(end) &&
                end > settings.NoLength &&
                end < ready.length &&
                (index === settings.NoLength || end > given[index - 1]),
        );
        const ends = Object.freeze(ordered ? [...given] : []);
        const kind = bridge.Kind.Arm;
        return Object.freeze({
            [bridge.TagName]: bridge.Tag,
            kind,
            seq,
            ...(typeof data.room === 'string' && ScribeFrame.named(data.room) ? { room: data.room } : {}),
            ...(typeof data.observationToken === 'string' && data.observationToken.length >= settings.ShortestToken &&
                data.observationToken.length <= settings.LongestToken ? { observationToken: data.observationToken } : {}),
            token,
            ready,
            ...(data.onlyExisting === true ? { onlyExisting: true } : {}),
            ...(typeof data.previous === 'string' && data.previous.length <= bridge.LongestLine ? { previous: data.previous } : {}),
            ...(typeof data.previousSuggestion === 'string' && data.previousSuggestion.length <= bridge.LongestLine ? { previousSuggestion: data.previousSuggestion } : {}),
            ...(data.manual === true && ready !== null && reminder !== null ? { manual: true } : {}),
            suggestion,
            ends,
            reminder: ready === null ? null : reminder,
            attempt: ready === null ? null : attempt,
        });
    },

    /**
     * @param {*} data
     * @return {Readonly<{ zetaScribe: number, kind: string, seq?: number, ready?: boolean, suggestion?: boolean }>|null}
     */
    report(data) {
        const bridge = ScribeFrame.Bridge;
        const settings = ScribeFrame.Settings;
        if (ScribeFrame.tagged(data, bridge.Kind.Ready)) {
            return Object.freeze({ [bridge.TagName]: bridge.Tag, kind: bridge.Kind.Ready });
        }
        if (ScribeFrame.tagged(data, bridge.Kind.Messages)) {
            const { seq, room, token, page } = data;
            if (!ScribeFrame.counted(seq) || typeof room !== 'string' || !ScribeFrame.named(room) ||
                typeof token !== 'string' || token.length < settings.ShortestToken || token.length > settings.LongestToken ||
                !ZetaSource.validPage(room, page)) {
                return null;
            }
            return { [bridge.TagName]: bridge.Tag, kind: bridge.Kind.Messages, seq, room, token, page };
        }
        if (ScribeFrame.tagged(data, bridge.Kind.Activity)) {
            const { seq, index, room, message, outcome } = data;
            const outcomes = message === null ? ['start', 'forbidden', 'ok'] : ['start', 'rateLimited', 'chatAbused', 'ok'];
            if (!ScribeFrame.counted(seq) || !ScribeFrame.counted(index) || typeof room !== 'string' ||
                !ScribeFrame.named(room) || !ScribeFrame.named(message) || !outcomes.includes(outcome)) {
                return null;
            }
            return Object.freeze({ [bridge.TagName]: bridge.Tag, kind: bridge.Kind.Activity, seq, index, room, message, outcome });
        }
        if (![bridge.Kind.Starting, bridge.Kind.Sent, bridge.Kind.Cancelled, bridge.Kind.Uncertain, bridge.Kind.Rejected].some((kind) => ScribeFrame.tagged(data, kind))) {
            return null;
        }
        const { seq, ready, suggestion } = data;
        const flags = [ready, suggestion].every(
            /**
             * @param {*} flag
             * @return {boolean}
             */
            (flag) => typeof flag === settings.BooleanType,
        );
        if (!ScribeFrame.counted(seq) || !flags) {
            return null;
        }
        const cut = ready && Number.isSafeInteger(data.cut) && data.cut > settings.NoLength ? data.cut : null;
        const crowded = !ready && data.crowded === true;
        const reminder = data.reminder === undefined ? null : data.reminder;
        const attempt = data.attempt === undefined ? null : data.attempt;
        const index = Number.isSafeInteger(data.index) && data.index >= settings.FirstIndex ? data.index : null;
        const stamped = data.kind === bridge.Kind.Starting && data.submission !== undefined;
        if (data.kind === bridge.Kind.Rejected && data.status !== undefined && ![401, 403].includes(data.status)) {
            return null;
        }
        const trimmed = stamped && data.trimmedSubmission !== undefined;
        if (
            (stamped && (typeof data.submission !== settings.StringType || !/^[0-9a-f]{8}$/.test(data.submission))) ||
            (trimmed && (typeof data.trimmedSubmission !== settings.StringType || !/^[0-9a-f]{8}$/.test(data.trimmedSubmission))) ||
            !ScribeFrame.named(reminder) ||
            !ScribeFrame.named(attempt) ||
            (reminder === null) !== (attempt === null) ||
            (data.kind !== bridge.Kind.Sent && index === null)
        ) {
            return null;
        }
        return Object.freeze({
            [bridge.TagName]: bridge.Tag,
            kind: data.kind,
            seq,
            ready,
            suggestion,
            cut,
            crowded,
            reminder: ready ? reminder : null,
            attempt: ready ? attempt : null,
            index,
            ...(data.kind === bridge.Kind.Rejected && data.status === 403 ? { status: 403 } : {}),
            ...(stamped ? { submission: data.submission } : {}),
            ...(stamped && (ready || data.previous === true) && data.retained === true ? { retained: true } : {}),
            ...(!ready && data.previous === true ? { previous: true, previousSuggestion: data.previousSuggestion === true } : {}),
            ...(trimmed ? { trimmedSubmission: data.trimmedSubmission } : {}),
        });
    },

    /**
     * @param {{ window: Window, document: Document, token: function(): (string|null) }} options
     * @return {Readonly<{ stop: function(): void }>}
     */
    start(options) {
        const { window, document, token } = options;
        const bridge = ScribeFrame.Bridge;
        const settings = ScribeFrame.Settings;
        const frame = {
            seq: settings.NoSeq,
            offer: settings.NothingOffered,
            went: null,
            reserve: null,
            repeat: null,
            index: settings.FirstIndex,
            activity: settings.FirstIndex,
            firstArm: null,
            pages: [],
        };
        /**
         * @param {object} message
         * @return {void}
         */
        const post = (message) => {
            window.parent.postMessage(message, bridge.TopOrigin);
        };
        /**
         * @return {void}
         */
        const ready = () => {
            post({ [bridge.TagName]: bridge.Tag, kind: bridge.Kind.Ready });
        };
        /**
         * @param {string} room
         * @param {object} page
         * @param {object|null} arm
         * @return {void}
         */
        const relay = (room, page, arm) => {
            if (room === arm?.room && room === frame.offer.room && arm.observationToken &&
                arm.observationToken === frame.offer.observationToken) {
                post({ [bridge.TagName]: bridge.Tag, kind: bridge.Kind.Messages, seq: arm.seq,
                    room, token: arm.observationToken, page });
            }
        };
        /**
         * @param {MessageEvent} event
         * @return {void}
         */
        const heard = (event) => {
            if (event.isTrusted !== true || event.origin !== bridge.TopOrigin || event.source !== window.parent) {
                return;
            }
            if (ScribeFrame.tagged(event.data, bridge.Kind.Reserved)) {
                const grant = event.data;
                const waiting = frame.reserve;
                if (waiting && grant.token === token() && grant.room === waiting.went.room && grant.seq === waiting.went.seq &&
                    grant.index === waiting.went.index && typeof grant.allowed === settings.BooleanType) {
                    waiting.finish(grant.allowed);
                }
                return;
            }
            const arm = ScribeFrame.arm(event.data);
            if (arm === null || arm.token !== token()) {
                return;
            }
            if (arm.seq !== frame.seq) {
                frame.seq = arm.seq;
                frame.index = settings.FirstIndex;
            }
            frame.offer = Object.freeze({
                room: arm.room,
                observationToken: arm.observationToken,
                ready: arm.ready,
                manual: arm.manual === true,
                onlyExisting: arm.onlyExisting === true,
                previous: arm.previous,
                previousSuggestion: arm.previousSuggestion,
                suggestion: arm.suggestion,
                ends: arm.ends,
                reminder: arm.reminder,
                attempt: arm.attempt,
            });
            if (!frame.firstArm && arm.room && arm.observationToken) {
                frame.firstArm = { seq: arm.seq, room: arm.room, observationToken: arm.observationToken };
                for (const received of frame.pages) {
                    relay(received.room, received.page, frame.firstArm);
                }
                frame.pages = [];
            }
            window.clearInterval(frame.repeat);
            frame.repeat = null;
        };
        /**
         * @param {string} kind
         * @return {void}
         */
        const report = (kind, went = frame.went, status = null) => {
            post({
                [bridge.TagName]: bridge.Tag,
                kind,
                seq: went.seq,
                ready: went.ready !== null,
                suggestion: went.suggestion !== null,
                cut: went.cut,
                crowded: went.crowded,
                reminder: went.reminder,
                attempt: went.attempt,
                index: went.index,
                ...(kind === bridge.Kind.Rejected && status === 403 ? { status } : {}),
                ...(kind === bridge.Kind.Starting ? { submission: went.submission } : {}),
                ...(kind === bridge.Kind.Starting && went.retained ? { retained: true } : {}),
                ...(went.previous ? { previous: true, previousSuggestion: went.previousSuggestion } : {}),
                ...(kind === bridge.Kind.Starting && went.trimmedSubmission ? { trimmedSubmission: went.trimmedSubmission } : {}),
            });
        };
        /**
         * @param {string} text
         * @return {string}
         */
        const outgoing = (text, bare = false) => {
            if (frame.seq === settings.NoSeq) {
                return text;
            }
            const offer = frame.offer;
            const made = ScribeSender.compose(text, bare ? settings.NothingOffered : offer, bridge.MessageBytes);
            frame.went = Object.freeze({
                room: offer.room,
                seq: frame.seq,
                index: frame.index,
                manual: made.ready && offer.manual === true,
                ...(made.previous || (made.ready && offer.manual) ? ScribeText.playerSubmission(made.playerText ?? text) : { submission: ScribeText.submission(made.text) }),
                ...(made.playerText !== undefined ? { retained: true } : {}),
                ...(made.previous ? { previous: true, previousSuggestion: made.previousSuggestion } : {}),
                ready: made.ready ? offer.ready : null,
                suggestion: made.suggestion ? offer.suggestion : null,
                cut: offer.manual || made.carried === null || made.carried === offer.ready ? null : made.carried.length,
                crowded: made.crowded,
                reminder: made.ready ? offer.reminder : null,
                attempt: made.ready ? offer.attempt : null,
            });
            frame.index += settings.OneIndex;
            report(bridge.Kind.Starting);
            return made.text;
        };
        /**
         * @return {void}
         */
        const sent = (went = frame.went, kind = bridge.Kind.Sent) => {
            if (went === null) {
                return;
            }
            report(kind, went);
            if (frame.went === went) {
                frame.went = null;
            }
            const offer = frame.offer;
            const same = offer.ready === went.ready && offer.reminder === went.reminder && offer.attempt === went.attempt;
            if (kind === bridge.Kind.Uncertain && same && went.ready) {
                frame.offer = Object.freeze({ ...offer, onlyExisting: true });
                return;
            }
            const kept = same ? null : offer.ready;
            frame.offer = Object.freeze({
                room: offer.room,
                observationToken: offer.observationToken,
                ready: kept,
                previous: offer.previous,
                previousSuggestion: offer.previousSuggestion,
                onlyExisting: kept !== null && offer.onlyExisting,
                manual: kept !== null && offer.manual,
                suggestion: offer.suggestion === went.suggestion ? null : offer.suggestion,
                ends: kept === null ? Object.freeze([]) : offer.ends,
                reminder: kept === null ? null : offer.reminder,
                attempt: kept === null ? null : offer.attempt,
            });
        };
        /**
         * @return {void}
         */
        const cancelled = () => {
            if (frame.went !== null) {
                report(bridge.Kind.Cancelled);
                frame.went = null;
            }
        };
        const receipt = () => {
            const went = frame.went;
            if (!went) {
                return null;
            }
            return {
                room: (roomId) => went.room === roomId,
                manual: went.manual,
                reserve: went.reminder !== null ? (resume) => {
                    const finish = (allowed) => {
                        window.clearTimeout(timer);
                        frame.reserve = null;
                        const current = frame.offer.reminder === went.reminder && frame.offer.attempt === went.attempt;
                        resume(frame.offer.room === went.room ? allowed && current : null);
                    };
                    const timer = window.setTimeout(() => finish(false), ScribeSender.Settings.SettleMs);
                    frame.reserve = { went, finish };
                    return () => finish(null);
                } : null,
                confirmed: () => sent(went),
                uncertain: () => sent(went, bridge.Kind.Uncertain),
                rejected: (status) => report(bridge.Kind.Rejected, went, status),
                cancelled: () => report(bridge.Kind.Cancelled, went),
            };
        };
        const hook = ScribeSender.attach({ document, window, outgoing, sent, cancelled, receipt: options.watch ? receipt : null,
            manualClick: () => Boolean(options.watch && (frame.offer.reminder || frame.reserve)), ignore: null });
        const watcher = options.watch?.();
        const activity = (room, message) => {
            if (room !== frame.offer.room || !ScribeFrame.named(message) || frame.seq === settings.NoSeq) {
                return null;
            }
            const seq = frame.seq;
            const index = ++frame.activity;
            const announce = (outcome) => post({ [bridge.TagName]: bridge.Tag, kind: bridge.Kind.Activity, seq, index, room, message, outcome });
            announce('start');
            return announce;
        };
        watcher?.onStream?.(activity);
        watcher?.onMessages?.((room) => {
            if (!frame.firstArm) {
                return (page) => {
                    if (frame.firstArm) {
                        relay(room, page, frame.firstArm);
                    } else {
                        frame.pages.push({ room, page });
                    }
                };
            }
            if (room !== frame.offer.room || !frame.offer.observationToken) {
                return null;
            }
            const scope = { seq: frame.seq, room, observationToken: frame.offer.observationToken };
            return (page) => relay(room, page, scope);
        });
        watcher?.onPost((room) => {
            const receipt = hook.posting(room);
            return ScribeSender.observePost(receipt, activity(room, null));
        });
        window.addEventListener(settings.Message, heard);
        ready();
        frame.repeat = window.setInterval(ready, bridge.ReadyRepeatMs);
        return Object.freeze({
            /**
             * @return {void}
             */
            stop: () => {
                hook.detach();
                frame.reserve?.finish(null);
                watcher?.stop();
                window.removeEventListener(settings.Message, heard);
                window.clearInterval(frame.repeat);
                frame.repeat = null;
            },
        });
    },
});
