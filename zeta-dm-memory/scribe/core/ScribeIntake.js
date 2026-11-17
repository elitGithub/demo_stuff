const ScribeIntake = Object.freeze({
    Role: Object.freeze({
        Player: 'Player',
        Narrator: 'Narrator',
        Character: 'Character',
    }),

    Settings: Object.freeze({
        TextType: 'TEXT',
        PlayerSender: 'USER',
        RightPosition: 'RIGHT',
        NarratorPosition: 'NARRATOR',
        NarratorName: 'Narrator',
        UnknownPlayer: 'unknown',
        MinWrappedLength: 2,
        MinPasteLines: 3,
        InnerGroup: 1,
        Nothing: '',
        Space: ' ',
        Newline: '\n',
        BlankLine: '\n\n',
        PlayerSuffix: ' (player)',
        SpeakerSeparator: ': ',
        PositionOpen: '[#',
        PositionClose: '] ',
        UnorderedMessage: 'Messages must be given oldest first.',
        OwnMarker: '[Scribe]',

        /**
         * @return {RegExp}
         */
        get OwnLead() {
            return /^[\p{Zs}\t]*(?:@:[\p{Zs}\t]*)?/u;
        },

        /**
         * @return {RegExp}
         */
        get OwnFollow() {
            return /^(?:[\p{Zs}\t]|$)/u;
        },

        /**
         * @return {RegExp}
         */
        get LineBreakParts() {
            return /(\r?\n)/;
        },

        /**
         * @return {RegExp}
         */
        get LineBreak() {
            return /\r?\n/;
        },

        /**
         * @return {RegExp}
         */
        get ExcessBreaks() {
            return /(?:\r?\n){3,}/g;
        },

        /**
         * @return {RegExp}
         */
        get WrappedLine() {
            return /^\*.*\*$/;
        },

        /**
         * @return {RegExp}
         */
        get WordCharacter() {
            return /[\p{L}\p{N}]/u;
        },

        /**
         * @return {RegExp}
         */
        get ParenthesisedPaste() {
            return /\*\(([^*]*?)\)\*/g;
        },

        /**
         * @return {RegExp}
         */
        get Whitespace() {
            return /\s+/g;
        },
    }),

    /**
     * @param {string} text
     * @return {string}
     */
    collapse(text) {
        const settings = ScribeIntake.Settings;
        return text.replace(settings.Whitespace, settings.Space).trim();
    },

    /**
     * @param {string} text
     * @return {boolean}
     */
    own(text) {
        const settings = ScribeIntake.Settings;
        const rest = text.replace(settings.OwnLead, settings.Nothing);
        return rest.startsWith(settings.OwnMarker) && settings.OwnFollow.test(rest.slice(settings.OwnMarker.length));
    },

    /**
     * @param {object[]} rawMessages
     * @return {Readonly<{ messages: readonly object[], notes: readonly object[], own: readonly object[], player: string }>}
     * @throws {Error}
     */
    read(rawMessages) {
        const settings = ScribeIntake.Settings;
        for (let index = 1; index < rawMessages.length; index++) {
            if (Date.parse(rawMessages[index - 1].messageTime) > Date.parse(rawMessages[index].messageTime)) {
                throw new Error(settings.UnorderedMessage);
            }
        }
        const parsed = rawMessages.map((raw, index) => ({
            id: raw.id,
            position: index + 1,
            fromPlayer: raw.sender.type === settings.PlayerSender,
            blocks: raw.contents.filter((block) => block.type === settings.TextType),
        }));

        const rightCounts = new Map();
        for (const message of parsed.filter((entry) => entry.fromPlayer)) {
            for (const block of message.blocks) {
                if (block.position === settings.RightPosition) {
                    rightCounts.set(block.speakerName, (rightCounts.get(block.speakerName) ?? 0) + 1);
                }
            }
        }
        let player = settings.UnknownPlayer;
        let highest = 0;
        for (const [speaker, count] of rightCounts) {
            if (count > highest) {
                player = speaker;
                highest = count;
            }
        }

        const notePositions = new Map();
        const lifted = [];
        const messages = parsed.map((message) => {
            const found = [];
            const sources = message.blocks.map((block) => ({ block, kept: block.text }));
            if (message.fromPlayer) {
                for (const { block } of sources) {
                    for (const line of block.text.split(settings.LineBreak)) {
                        if (ScribeIntake.own(line)) {
                            lifted.push(Object.freeze({ text: line.trim(), position: message.position }));
                        }
                    }
                }
                while (sources.length > 0) {
                    const written = sources[sources.length - 1].kept
                        .split(settings.LineBreak)
                        .filter((line) => line.trim() !== settings.Nothing);
                    if (!written.every((line) => ScribeIntake.own(line))) {
                        break;
                    }
                    sources.pop();
                }
                if (sources.length > 0) {
                    const last = sources[sources.length - 1];
                    const parts = last.kept.split(settings.LineBreakParts);
                    let end = parts.length - 1;
                    let owned = false;
                    while (end >= 0 && (parts[end].trim() === settings.Nothing || ScribeIntake.own(parts[end]))) {
                        owned = owned || ScribeIntake.own(parts[end]);
                        end -= 2;
                    }
                    if (owned) {
                        last.kept = parts.slice(0, end + 1).join(settings.Nothing);
                    }
                }
            }
            const lastIndex = sources.length - 1;
            const blocks = [];
            sources.forEach(({ block, kept }, index) => {
                let text = kept;
                if (message.fromPlayer) {
                    const closing = [];
                    const inside = [];
                    if (index === lastIndex) {
                        const parts = text.split(settings.LineBreakParts);
                        let last = parts.length - 1;
                        while (last >= 0 && parts[last].trim() === settings.Nothing) {
                            last -= 2;
                        }
                        let runStart = last + 2;
                        while (runStart >= 2) {
                            const line = parts[runStart - 2].trim();
                            if (
                                line.length <= settings.MinWrappedLength ||
                                !settings.WrappedLine.test(line) ||
                                !settings.WordCharacter.test(line)
                            ) {
                                break;
                            }
                            runStart -= 2;
                        }
                        if ((last + 2 - runStart) / 2 >= settings.MinPasteLines) {
                            for (let part = runStart; part <= last; part += 2) {
                                closing.push(ScribeIntake.collapse(parts[part].trim().slice(1, -1)));
                            }
                            text = parts.slice(0, runStart).join(settings.Nothing);
                        }
                    }
                    text = text.replace(settings.ParenthesisedPaste, (whole, inner) => {
                        if (!settings.LineBreak.test(inner)) {
                            return whole;
                        }
                        for (const line of inner.split(settings.LineBreak)) {
                            const note = ScribeIntake.collapse(line);
                            if (note !== settings.Nothing && !ScribeIntake.own(line)) {
                                inside.push(note);
                            }
                        }
                        return settings.Nothing;
                    });
                    found.push(...inside, ...closing);
                    const pieces = text.split(settings.LineBreakParts);
                    text = settings.Nothing;
                    for (let part = 0; part < pieces.length; part += 2) {
                        if (!ScribeIntake.own(pieces[part])) {
                            text += pieces.slice(part, part + 2).join(settings.Nothing);
                        }
                    }
                }
                if (text !== block.text) {
                    text = text.replace(settings.ExcessBreaks, settings.BlankLine);
                }
                text = text.trim();
                if (text === settings.Nothing) {
                    return;
                }
                let role = ScribeIntake.Role.Character;
                if (message.fromPlayer && block.position === settings.RightPosition && block.speakerName === player) {
                    role = ScribeIntake.Role.Player;
                } else if (block.position === settings.NarratorPosition || block.speakerName === settings.NarratorName) {
                    role = ScribeIntake.Role.Narrator;
                }
                blocks.push(Object.freeze({ speaker: block.speakerName, role, text }));
            });
            for (const note of found) {
                const key = ScribeText.words(note).join(settings.Space);
                if (!notePositions.has(key)) {
                    notePositions.set(key, { text: note, position: message.position });
                }
            }
            const lines = blocks.map((block) => {
                const suffix = block.role === ScribeIntake.Role.Player ? settings.PlayerSuffix : settings.Nothing;
                return block.speaker + suffix + settings.SpeakerSeparator + block.text;
            });
            const original = message.blocks
                .map((block) => [block.speakerName, block.position, block.text].join(settings.Newline))
                .join(settings.Newline);
            return Object.freeze({
                id: message.id,
                position: message.position,
                fromPlayer: message.fromPlayer,
                blocks: Object.freeze(blocks),
                text: lines.join(settings.Newline),
                fingerprint: ScribeText.fingerprint(original),
            });
        });

        const notes = [];
        for (const { text, position } of notePositions.values()) {
            notes.push(Object.freeze({ text, position }));
        }
        return Object.freeze({
            messages: Object.freeze(messages),
            notes: Object.freeze(notes),
            own: Object.freeze(lifted),
            player,
        });
    },

    /**
     * @param {readonly object[]} messages
     * @return {string}
     */
    transcript(messages) {
        const settings = ScribeIntake.Settings;
        return messages
            .filter((message) => message.text !== settings.Nothing)
            .map((message) => settings.PositionOpen + message.position + settings.PositionClose + message.text)
            .join(settings.BlankLine);
    },

    /**
     * @param {ReadonlyArray<{ id: string, fingerprint: string }>} known
     * @param {readonly object[]} current
     * @return {Readonly<{ withdrawn: readonly string[], unread: readonly string[] }>}
     */
    changed(known, current) {
        const currentPrints = new Map(current.map((message) => [message.id, message.fingerprint]));
        const knownIds = new Set(known.map((entry) => entry.id));
        return Object.freeze({
            withdrawn: Object.freeze(
                known.filter((entry) => currentPrints.get(entry.id) !== entry.fingerprint).map((entry) => entry.id),
            ),
            unread: Object.freeze(current.filter((message) => !knownIds.has(message.id)).map((message) => message.id)),
        });
    },
});
