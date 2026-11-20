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
            token,
            ready,
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
            ...(stamped ? { submission: data.submission } : {}),
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
                ready: arm.ready,
                manual: arm.manual === true,
                suggestion: arm.suggestion,
                ends: arm.ends,
                reminder: arm.reminder,
                attempt: arm.attempt,
            });
            window.clearInterval(frame.repeat);
            frame.repeat = null;
        };
        /**
         * @param {string} kind
         * @return {void}
         */
        const report = (kind, went = frame.went) => {
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
                ...(kind === bridge.Kind.Starting ? { submission: went.submission } : {}),
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
                ...(made.ready && offer.manual ? ScribeText.playerSubmission(text) : { submission: ScribeText.submission(made.text) }),
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
            const kept = same ? null : offer.ready;
            frame.offer = Object.freeze({
                room: offer.room,
                ready: kept,
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
                rejected: () => report(bridge.Kind.Rejected, went),
                cancelled: () => report(bridge.Kind.Cancelled, went),
            };
        };
        const hook = ScribeSender.attach({ document, window, outgoing, sent, cancelled, receipt: options.watch ? receipt : null,
            manualClick: () => Boolean(options.watch && (frame.offer.reminder || frame.reserve)), ignore: null });
        const watcher = options.watch?.();
        watcher?.onPost(hook.posting);
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
