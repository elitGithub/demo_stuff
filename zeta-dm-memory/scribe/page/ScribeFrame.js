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
            Sent: 'sent',
        }),
        ReadyRepeatMs: 1000,
        MessageBytes: 4500,
        LongestLine: 6000,
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
        }),
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
     * @param {*} data
     * @return {Readonly<{ zetaScribe: number, kind: string, seq: number, token: string, ready: string|null, suggestion: string|null }>|null}
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
        if (!ScribeFrame.counted(seq) || !keyed || !lines) {
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
        return Object.freeze({ [bridge.TagName]: bridge.Tag, kind, seq, token, ready, suggestion, ends });
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
        if (!ScribeFrame.tagged(data, bridge.Kind.Sent)) {
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
        return Object.freeze({
            [bridge.TagName]: bridge.Tag,
            kind: bridge.Kind.Sent,
            seq,
            ready,
            suggestion,
            cut,
            crowded,
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
            repeat: null,
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
            const arm = ScribeFrame.arm(event.data);
            if (arm === null || arm.token !== token()) {
                return;
            }
            frame.seq = arm.seq;
            frame.offer = Object.freeze({ ready: arm.ready, suggestion: arm.suggestion, ends: arm.ends });
            window.clearInterval(frame.repeat);
            frame.repeat = null;
        };
        /**
         * @param {string} text
         * @return {string}
         */
        const outgoing = (text) => {
            if (frame.seq === settings.NoSeq) {
                return text;
            }
            const offer = frame.offer;
            const made = ScribeSender.compose(text, offer, bridge.MessageBytes);
            frame.went = Object.freeze({
                seq: frame.seq,
                ready: made.ready ? offer.ready : null,
                suggestion: made.suggestion ? offer.suggestion : null,
                cut: made.carried === null || made.carried === offer.ready ? null : made.carried.length,
                crowded: made.crowded,
            });
            return made.text;
        };
        /**
         * @return {void}
         */
        const sent = () => {
            const went = frame.went;
            if (went === null) {
                return;
            }
            post({
                [bridge.TagName]: bridge.Tag,
                kind: bridge.Kind.Sent,
                seq: went.seq,
                ready: went.ready !== null,
                suggestion: went.suggestion !== null,
                cut: went.cut,
                crowded: went.crowded,
            });
            const offer = frame.offer;
            const kept = offer.ready === went.ready ? null : offer.ready;
            frame.offer = Object.freeze({
                ready: kept,
                suggestion: offer.suggestion === went.suggestion ? null : offer.suggestion,
                ends: kept === null ? Object.freeze([]) : offer.ends,
            });
        };
        const hook = ScribeSender.attach({ document, window, outgoing, sent, ignore: null });
        window.addEventListener(settings.Message, heard);
        ready();
        frame.repeat = window.setInterval(ready, bridge.ReadyRepeatMs);
        return Object.freeze({
            /**
             * @return {void}
             */
            stop: () => {
                hook.detach();
                window.removeEventListener(settings.Message, heard);
                window.clearInterval(frame.repeat);
                frame.repeat = null;
            },
        });
    },
});
