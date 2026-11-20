const ScribeIntake = Object.freeze({
    Submissions: new WeakMap(),
    Originals: new WeakMap(),
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
        return ScribeText.reminderLine(text);
    },

    /**
     * @param {object} message
     * @param {object} post
     * @return {boolean}
     */
    carried(message, post) {
        return ScribeIntake.playerLength(ScribeIntake.Submissions.get(message), post) !== null;
    },

    /**
     * @param {string|undefined} wire
     * @param {object} post
     * @return {number|null}
     */
    playerLength(wire, post) {
        return ScribeIntake.playerRange(wire, post)?.start ?? null;
    },

    /**
     * @param {string|undefined} wire
     * @param {object} post
     * @return {object|null}
     */
    playerRange(wire, post) {
        if (typeof wire !== 'string') {
            return null;
        }
        if (post.retained) {
            const span = ScribeText.reminderSpan(wire, post.carried, post.suggestion);
            if (!span || (Boolean(post.suggestion) !== span.suggestion)) {
                return null;
            }
            const player = wire.slice(0, span.start) + wire.slice(span.end);
            const hashes = [player, player.replace(/\r\n/g, '\n')].map(ScribeText.fingerprint);
            return hashes.some((hash) => hash === post.submission || hash === post.trimmedSubmission) ? span : null;
        }
        const tail = '\n@: ' + post.carried + (post.suggestion === null ? '' : '\n@: ' + post.suggestion);
        if (!wire.endsWith(tail)) {
            return null;
        }
        const prefix = wire.slice(0, -tail.length);
        const fingerprint = ScribeText.fingerprint(prefix);
        return (fingerprint === post.submission || fingerprint === post.trimmedSubmission) ? { start: prefix.length, end: wire.length } : null;
    },

    /**
     * @param {object|null} range
     * @param {string} wire
     * @return {string|number|null}
     */
    projection(range, wire) {
        return !range ? null : range.end === wire.length ? range.start : range.start + ':' + range.end;
    },

    /**
     * @param {object[]} rawMessages
     * @param {object|null} evidence
     * @return {Readonly<{ messages: readonly object[], notes: readonly object[], own: readonly object[], player: string }>}
     * @throws {Error}
     */
    read(rawMessages, evidence = null) {
        const settings = ScribeIntake.Settings;
        for (let index = 1; index < rawMessages.length; index++) {
            if (Date.parse(rawMessages[index - 1].messageTime) > Date.parse(rawMessages[index].messageTime)) {
                throw new Error(settings.UnorderedMessage);
            }
        }
        const copies = new Map();
        const parsed = rawMessages.map((raw, index) => {
            const blocks = raw.contents.flatMap((block, index) =>
                block.type === settings.TextType ? [{ ...block, blockNumber: index + 1 }] : []);
            const fromPlayer = raw.sender.type === settings.PlayerSender;
            const posted = fromPlayer ? blocks.map((block) => block.text).join(settings.Newline) : null;
            const parts = posted?.includes(settings.OwnMarker) ? blocks.map((block) =>
                block.position === settings.NarratorPosition && !block.text.startsWith('@: ') ? '@: ' + block.text : block.text) : null;
            const wire = parts?.join(settings.Newline) ?? null;
            const position = index + 1;
            if (wire !== null) {
                if (!copies.has(wire)) {
                    copies.set(wire, []);
                }
                copies.get(wire).push(position);
            }
            return { id: raw.id, position, fromPlayer, edited: raw.edited === true, blocks, parts, wire, posted };
        });

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
        const saved = new Map((Array.isArray(evidence?.attachments) ? evidence.attachments : [])
            .filter((entry) => entry && Number.isSafeInteger(entry.length) && entry.length >= 0)
            .map((entry) => [entry.id, entry]));
        const pending = (Array.isArray(evidence?.posts) ? evidence.posts : []).filter((post) => post?.manual === true &&
            typeof post.carried === 'string' && Number.isSafeInteger(post.floor) && post.floor >= 0);
        const uncertainCopies = new Set();
        for (const message of parsed) {
            const alternatives = saved.get(message.id)?.alternatives;
            if (!Array.isArray(alternatives) || !message.wire || copies.get(message.wire).length < 2) {
                continue;
            }
            if (pending.some((post) => alternatives.includes(post.key) && post.floor < message.position &&
                ScribeIntake.playerLength(message.wire, post) !== null &&
                copies.get(message.wire).some((position) => position !== message.position && post.floor < position))) {
                uncertainCopies.add(message.wire);
            }
        }
        const messages = parsed.map((message) => {
            const found = [];
            const original = message.blocks.map((block) => [block.speakerName, block.position, block.text].join(settings.Newline)).join(settings.Newline);
            const fingerprint = ScribeText.fingerprint(original);
            const { posted, parts, wire } = message;
            const bound = saved.get(message.id);
            let length = null;
            let end = wire?.length;
            let interchangeable = uncertainCopies.has(wire);
            let awaiting = interchangeable;
            if (wire !== null && !awaiting) {
                if (bound?.fingerprint === fingerprint && bound.length < wire.length &&
                    (bound.end === undefined || (Number.isSafeInteger(bound.end) && bound.length < bound.end && bound.end <= wire.length)) &&
                    ScribeIntake.own(wire.slice(bound.length).replace(/^\r?\n/, '').split(settings.LineBreak, 1)[0])) {
                    awaiting = bound.contested === true;
                    length = awaiting ? null : bound.length;
                    end = bound.end ?? wire.length;
                } else {
                    const matches = pending.filter((post) => post.floor < message.position &&
                        (post.after === null || parsed[post.floor - 1]?.id === post.after) && ScribeIntake.playerLength(wire, post) !== null);
                    const confirmed = matches.filter((post) => post.confirmed);
                    const candidates = confirmed.length ? confirmed : matches;
                    const projection = (post) => ScribeIntake.projection(ScribeIntake.playerRange(wire, post), wire);
                    const lengths = new Set(candidates.map(projection));
                    interchangeable = new Set(matches.map(projection)).size > 1 &&
                        copies.get(wire).some((position) => position !== message.position &&
                            matches.filter((post) => post.floor < position).length > 1);
                    awaiting = lengths.size > 1 || interchangeable || candidates.some((post) => post.contested);
                    if (!awaiting && candidates.length) {
                        const range = ScribeIntake.playerRange(wire, candidates[0]);
                        length = range.start;
                        end = range.end;
                        pending.splice(pending.indexOf(candidates[0]), 1);
                    }
                }
            }
            let offset = 0;
            const sources = message.blocks.flatMap((block, index) => {
                if (awaiting) {
                    return [];
                }
                if (length === null) {
                    return [{ block, kept: block.text }];
                }
                const start = offset + parts[index].length - block.text.length;
                offset += parts[index].length + settings.Newline.length;
                const kept = block.text.slice(0, Math.max(0, length - start)) + block.text.slice(Math.max(0, end - start));
                return kept ? [{ block, kept }] : [];
            });
            if (length !== null) {
                lifted.push(Object.freeze({ text: wire.slice(length).replace(/^\r?\n/, '').split(settings.LineBreak, 1)[0], position: message.position }));
            } else if (message.fromPlayer && !bound) {
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
                }
                if (length === null && !bound && text.includes(settings.OwnMarker)) {
                    const pieces = text.split(settings.LineBreakParts);
                    text = settings.Nothing;
                    for (let part = 0; part < pieces.length; part += 2) {
                        if (!ScribeIntake.own(pieces[part])) {
                            text += pieces.slice(part, part + 2).join(settings.Nothing);
                        }
                    }
                }
                if (text !== kept || (length === null && text !== block.text)) {
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
                const retained = Object.freeze({ blockNumber: block.blockNumber, speaker: block.speakerName, role, text });
                if (text !== block.text) {
                    ScribeIntake.Originals.set(retained, block.text);
                }
                blocks.push(retained);
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
            const entry = Object.freeze({
                id: message.id,
                position: message.position,
                fromPlayer: message.fromPlayer,
                edited: message.edited,
                submission: posted === null ? null : ScribeText.submission(posted),
                completeSubmission: posted === null ? null : ScribeText.submission(posted, true),
                ...(length === null ? {} : { projection: ScribeIntake.projection({ start: length, end }, wire) }),
                ...(awaiting ? { attributionPending: true } : {}),
                ...(interchangeable ? { interchangeable: true } : {}),
                blocks: Object.freeze(blocks),
                text: lines.join(settings.Newline),
                fingerprint,
            });
            if (wire !== null) {
                ScribeIntake.Submissions.set(entry, wire);
            }
            return entry;
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
     * @param {object} block
     * @return {object[]}
     */
    sourcePieces(block) {
        const original = ScribeIntake.Originals.get(block);
        const text = block.text;
        if (original === undefined || original.includes(text)) {
            return [{ offset: 0, quote: text }];
        }
        const pieces = [];
        let offset = 0;
        while (offset < text.length) {
            let minimum = 1;
            let maximum = text.length - offset;
            let fit = 0;
            while (minimum <= maximum) {
                const size = Math.floor((minimum + maximum) / 2);
                if (original.includes(text.slice(offset, offset + size))) {
                    fit = size;
                    minimum = size + 1;
                } else {
                    maximum = size - 1;
                }
            }
            if (!fit) {
                throw new Error('The original passage could not be matched to the retained chat text.');
            }
            pieces.push({ offset, quote: text.slice(offset, offset + fit) });
            offset += fit;
        }
        return pieces;
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
