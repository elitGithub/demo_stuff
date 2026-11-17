// ==UserScript==
// @name         Zeta Scribe
// @namespace    zeta-scribe
// @version      0.1.0
// @description  Keeps the book of a Zeta campaign, tells the scene what it knows, and checks replies against the book.
// @match        https://zeta-ai.io/*
// @match        https://frame.pingpong.ai/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      openrouter.ai
// ==/UserScript==

(() => {
'use strict';
/** @file scribe/core/ScribeText.js */
const ScribeText = Object.freeze({
    Settings: Object.freeze({
        NormalForm: 'NFC',
        DecomposedForm: 'NFD',
        Nothing: '',
        Space: ' ',
        PlainApostrophe: "'",
        FirstCapture: '$1',

        /**
         * @return {RegExp}
         */
        get StrippedMarks() {
            return /[“”"*`#]/g;
        },

        /**
         * @return {RegExp}
         */
        get HonorificSuffix() {
            return /[-‐‑‒–—−－](?:san|kun|chan|sama)(?![\p{L}\p{N}])/gu;
        },

        /**
         * @return {RegExp}
         */
        get Apostrophes() {
            return /[’‘´ʼ]/g;
        },

        /**
         * @return {RegExp}
         */
        get WrappingQuotes() {
            return /^'\s*(.*?)\s*'$/;
        },

        /**
         * @return {RegExp}
         */
        get FullStops() {
            return /\./g;
        },

        /**
         * @return {RegExp}
         */
        get Whitespace() {
            return /\s+/g;
        },

        /**
         * @return {RegExp}
         */
        get Digits() {
            return /\d/g;
        },

        /**
         * @return {RegExp}
         */
        get LeadingThe() {
            return /^the /;
        },

        /**
         * @return {RegExp}
         */
        get LatinAccents() {
            return /(\p{Script=Latin})[\u{300}-\u{333}\u{339}-\u{36F}]+/gu;
        },

        /**
         * @return {RegExp}
         */
        get WordPattern() {
            return /[\p{L}\p{M}]+|\p{N}+|\p{S}/gu;
        },

        Spellings: Object.freeze([
            Object.freeze({ British: 'grey', American: 'gray' }),
            Object.freeze({ British: 'blonde', American: 'blond' }),
            Object.freeze({ British: 'colour', American: 'color' }),
            Object.freeze({ British: 'armour', American: 'armor' }),
            Object.freeze({ British: 'honour', American: 'honor' }),
            Object.freeze({ British: 'favour', American: 'favor' }),
            Object.freeze({ British: 'flavour', American: 'flavor' }),
            Object.freeze({ British: 'neighbour', American: 'neighbor' }),
            Object.freeze({ British: 'jewellery', American: 'jewelry' }),
            Object.freeze({ British: 'moustache', American: 'mustache' }),
            Object.freeze({ British: 'centre', American: 'center' }),
            Object.freeze({ British: 'metre', American: 'meter' }),
            Object.freeze({ British: 'fibre', American: 'fiber' }),
            Object.freeze({ British: 'lustre', American: 'luster' }),
            Object.freeze({ British: 'ochre', American: 'ocher' }),
            Object.freeze({ British: 'pyjama', American: 'pajama' }),
            Object.freeze({ British: 'dishevelled', American: 'disheveled' }),
            Object.freeze({ British: 'ageing', American: 'aging' }),
        ]),
        ShortestResemblingLength: 4,
        LongNameLength: 8,
        ShortNameDistance: 1,
        LongNameDistance: 2,
        FnvOffset: 0x811c9dc5,
        FnvPrime: 0x01000193,
        HexRadix: 16,
        HexWidth: 8,
        HexPad: '0',
    }),

    /**
     * @param {string} name
     * @return {string}
     */
    normaliseName(name) {
        const settings = ScribeText.Settings;
        return name
            .normalize(settings.NormalForm)
            .replace(settings.StrippedMarks, settings.Nothing)
            .toLowerCase()
            .replace(settings.HonorificSuffix, settings.Nothing)
            .replace(settings.Apostrophes, settings.PlainApostrophe)
            .replace(settings.FullStops, settings.Space)
            .replace(settings.Whitespace, settings.Space)
            .trim()
            .replace(settings.WrappingQuotes, settings.FirstCapture)
            .replace(settings.LeadingThe, settings.Nothing);
    },

    /**
     * @param {string} text
     * @return {readonly string[]}
     */
    words(text) {
        const settings = ScribeText.Settings;
        const folded = text
            .toLowerCase()
            .normalize(settings.DecomposedForm)
            .replace(settings.LatinAccents, settings.FirstCapture)
            .normalize(settings.NormalForm);
        const found = [];
        for (const [matched] of folded.matchAll(settings.WordPattern)) {
            let word = matched;
            for (const spelling of settings.Spellings) {
                word = word.replaceAll(spelling.British, spelling.American);
            }
            found.push(word);
        }
        return Object.freeze(found);
    },

    /**
     * @param {string} first
     * @param {string} second
     * @return {number}
     */
    distance(first, second) {
        const firstUnits = Array.from(first);
        const secondUnits = Array.from(second);
        let previous = [];
        for (let index = 0; index <= secondUnits.length; index++) {
            previous.push(index);
        }
        for (let row = 1; row <= firstUnits.length; row++) {
            const current = [row];
            for (let column = 1; column <= secondUnits.length; column++) {
                const substitution = previous[column - 1] + (firstUnits[row - 1] === secondUnits[column - 1] ? 0 : 1);
                current.push(Math.min(previous[column] + 1, current[column - 1] + 1, substitution));
            }
            previous = current;
        }
        return previous[secondUnits.length];
    },

    /**
     * @param {string} first
     * @param {string} second
     * @return {boolean}
     */
    resembles(first, second) {
        const settings = ScribeText.Settings;
        const firstName = ScribeText.normaliseName(first);
        const secondName = ScribeText.normaliseName(second);
        const firstWithoutDigits = firstName.replace(settings.Digits, settings.Nothing);
        const secondWithoutDigits = secondName.replace(settings.Digits, settings.Nothing);
        if (firstName === secondName || firstWithoutDigits === secondWithoutDigits) {
            return false;
        }
        const shorter = Math.min(Array.from(firstName).length, Array.from(secondName).length);
        if (shorter < settings.ShortestResemblingLength) {
            return false;
        }
        const allowed = shorter < settings.LongNameLength ? settings.ShortNameDistance : settings.LongNameDistance;
        return ScribeText.distance(firstName, secondName) <= allowed;
    },

    /**
     * @param {string} text
     * @return {string}
     */
    fingerprint(text) {
        const settings = ScribeText.Settings;
        let hash = settings.FnvOffset;
        for (let index = 0; index < text.length; index++) {
            hash = Math.imul(hash ^ text.charCodeAt(index), settings.FnvPrime);
        }
        return (hash >>> 0).toString(settings.HexRadix).padStart(settings.HexWidth, settings.HexPad);
    },

    /**
     * @param {string} text
     * @return {number}
     */
    bytes(text) {
        return new TextEncoder().encode(text).length;
    },
});
/** @file scribe/core/ScribeCategory.js */
const ScribeCategory = Object.freeze({
    Kind: Object.freeze({
        Fixed: 'Fixed',
        Moving: 'Moving',
        List: 'List',
        Passing: 'Passing',
    }),

    SubjectKinds: Object.freeze({
        Character: 'character',
        Group: 'group',
        Place: 'place',
        Item: 'item',
        World: 'world',
    }),

    Settings: Object.freeze({
        Words: Object.freeze({
            Fixed: Object.freeze(['kind', 'age', 'eyes', 'hair', 'build', 'skin']),
            Moving: Object.freeze(['status', 'location', 'role']),
            List: Object.freeze(['aka', 'title', 'appearance', 'ability', 'belonging', 'background', 'trait', 'feature', 'rule']),
            Passing: Object.freeze(['condition']),
        }),
        RelationCategory: 'relation',

        /**
         * @return {RegExp}
         */
        get RelationPattern() {
            return /^(?:relation\s+(?:to|with|towards?)|towards?)\s+(.+)$/i;
        },
        TargetGroup: 1,
    }),

    /**
     * @param {string} raw
     * @return {Readonly<{ category: string, kind: string, target: string|null }>|null}
     */
    parse(raw) {
        const settings = ScribeCategory.Settings;
        const trimmed = raw.trim();
        const relation = trimmed.match(settings.RelationPattern);
        if (relation !== null) {
            return Object.freeze({
                category: settings.RelationCategory,
                kind: ScribeCategory.Kind.Moving,
                target: relation[settings.TargetGroup],
            });
        }
        const category = trimmed.toLowerCase();
        for (const [kindName, words] of Object.entries(settings.Words)) {
            if (words.includes(category)) {
                return Object.freeze({ category, kind: ScribeCategory.Kind[kindName], target: null });
            }
        }
        return null;
    },

    /**
     * @param {string} earlier
     * @param {string} later
     * @return {boolean}
     */
    same(earlier, later) {
        const earlierWords = ScribeText.words(earlier);
        const laterWords = ScribeText.words(later);
        if (earlierWords.length !== laterWords.length) {
            return false;
        }
        for (let index = 0; index < earlierWords.length; index++) {
            if (earlierWords[index] !== laterWords[index]) {
                return false;
            }
        }
        return true;
    },
});
/** @file scribe/core/ScribeIntake.js */
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
/** @file scribe/core/ScribeAnswer.js */
const ScribeAnswer = Object.freeze({
    Reason: Object.freeze({
        Shape: 'Shape',
        Category: 'Category',
        Citation: 'Citation',
        Name: 'Name',
    }),

    Type: Object.freeze({
        Subject: 'Subject',
        Alias: 'Alias',
        Fact: 'Fact',
        Change: 'Change',
        Refine: 'Refine',
        End: 'End',
        Told: 'Told',
        Scene: 'Scene',
        Night: 'Night',
        ThreadOpen: 'ThreadOpen',
        ThreadClose: 'ThreadClose',
        Question: 'Question',
    }),

    Reach: Object.freeze({
        Public: 'Public',
        Private: 'Private',
    }),

    Blocks: Object.freeze([
        'SUBJECTS',
        'NAMES',
        'FACTS',
        'CHANGES',
        'TOLD',
        'SCENES',
        'NIGHTS',
        'THREADS',
        'QUESTIONS',
    ]),

    Settings: Object.freeze({
        Preamble: 'PREAMBLE',
        Unknown: 'UNKNOWN',
        Nights: 'NIGHTS',
        Nothing: '',
        Pipe: '|',
        Joiner: ' | ',
        Comma: ',',
        Colon: ':',
        OpenBracket: '(',
        CloseBracket: ')',
        FromWord: 'from',
        EndedWord: 'ended',
        FullerWord: 'fuller',
        NarratorName: 'narrator',
        HiddenWord: 'hidden',
        LabelEdges: '*_`',
        LabelStart: '*_`-–—+•·> ',
        MarkerWrappers: '*_`])',
        MarkerLeaders: ' :|-–—.;*_`])"',
        MarkerTrailers: '*_`"',
        BoldInner: '$1',
        NotFound: -1,
        MinPosition: 1,
        MaxLabel: 60,
        SecondField: 1,
        ThirdField: 2,
        StatementStart: 3,
        SummaryStart: 5,
        Last: -1,
        SubjectFields: 2,
        NameFields: 3,
        FactFields: 3,
        ChangeFields: 5,
        ToldFields: 4,
        SceneFields: 6,
        NightFields: 2,
        ThreadFields: 3,
        CloseOnlyFields: 2,
        QuestionFields: 2,

        /**
         * @return {RegExp}
         */
        get LineBreak() {
            return /\r\n|\n|\r/;
        },

        /**
         * @return {RegExp}
         */
        get FormatCharacter() {
            return /\p{Cf}/gu;
        },

        /**
         * @return {RegExp}
         */
        get ListMarkers() {
            return /^(?:(?:[-*+•>]|\d+[.)]) )+/;
        },

        /**
         * @return {RegExp}
         */
        get Bold() {
            return /^\*\*([\s\S]*)\*\*$/;
        },

        /**
         * @return {RegExp}
         */
        get Fence() {
            return /^```\w*$/;
        },

        /**
         * @return {RegExp}
         */
        get NoneLine() {
            return /^(?:none|\(none|no new|nothing)(?!\p{L})/iu;
        },

        /**
         * @return {RegExp}
         */
        get HashDigit() {
            return /#\d/;
        },

        /**
         * @return {RegExp}
         */
        get LeadingHashDigit() {
            return /^(?:#|\[#|\(#)\d/;
        },

        /**
         * @return {RegExp}
         */
        get NonAlphanumerics() {
            return /[^\p{L}\p{N}]/gu;
        },

        /**
         * @return {RegExp}
         */
        get Bracketed() {
            return /^\[([\s\S]*)\]$/;
        },

        /**
         * @return {RegExp}
         */
        get CitationSeparator() {
            return /,\s*and\b|,|\band\b/i;
        },

        /**
         * @return {RegExp}
         */
        get CitationItem() {
            return /^#(\d+)(?:\s*[-‐–—−]\s*#?(\d+))?$/;
        },

        /**
         * @return {RegExp}
         */
        get HasContent() {
            return /[\p{L}\p{N}]/u;
        },

        /**
         * @return {RegExp}
         */
        get FactId() {
            return /^F\d+$/i;
        },

        /**
         * @return {RegExp}
         */
        get MarkerWord() {
            return /^[^\p{L}\p{N}]*(\p{L}+)(?![\p{L}\p{N}])/u;
        },

        /**
         * @return {RegExp}
         */
        get GluedHeader() {
            return /^[^\p{L}]*(\p{L}+)(?![\p{L}\p{N}])/u;
        },

        /**
         * @return {RegExp}
         */
        get EntrySplitters() {
            return /\band\b|[&;]/i;
        },

        /**
         * @return {RegExp}
         */
        get UnmarkedBound() {
            return /\(\s*(?:from|until)\b[^()\d]*\d[^()]*\)/i;
        },

        /**
         * @return {RegExp}
         */
        get DayField() {
            return /^day\s+(\d+)$/i;
        },

        /**
         * @return {RegExp}
         */
        get PresentField() {
            return /^present:([\s\S]*)$/i;
        },

        /**
         * @return {RegExp}
         */
        get EmptyAttendance() {
            return /^(?:|none|nobody|noone)$/;
        },

        /**
         * @return {RegExp}
         */
        get BoundBoth() {
            return /\(\s*from\s+#(\d+)(?:\s*,)?\s*until\s+#(\d+)\s*\)$/i;
        },

        /**
         * @return {RegExp}
         */
        get BoundOne() {
            return /\(\s*(from|until)\s+#(\d+)\s*\)$/i;
        },

        /**
         * @return {RegExp}
         */
        get OpenThread() {
            return /^open$/i;
        },

        /**
         * @return {RegExp}
         */
        get CloseThread() {
            return /^close\s+(T\d+)$/i;
        },
    }),

    /**
     * @param {string} digits
     * @return {number|null}
     */
    positiveInteger(digits) {
        const number = Number(digits);
        if (!Number.isSafeInteger(number) || number < ScribeAnswer.Settings.MinPosition) {
            return null;
        }
        return number;
    },

    /**
     * @param {string} field
     * @return {Readonly<{ first: number, last: number, count: number }>|null}
     */
    citation(field) {
        const settings = ScribeAnswer.Settings;
        const wrapped = field.match(settings.Bracketed);
        const attempts = wrapped === null ? [[field, true]] : [[field, true], [wrapped[1], false]];
        for (const [body, itemBrackets] of attempts) {
            const items = body.split(settings.CitationSeparator);
            let head = null;
            let valid = true;
            for (const item of items) {
                const trimmed = item.trim();
                const own = itemBrackets ? trimmed.match(settings.Bracketed) : null;
                const match = (own === null ? trimmed : own[1].trim()).match(settings.CitationItem);
                if (match === null) {
                    valid = false;
                    break;
                }
                const first = ScribeAnswer.positiveInteger(match[1]);
                const last = match[2] === undefined ? first : ScribeAnswer.positiveInteger(match[2]);
                if (first === null || last === null || last < first) {
                    valid = false;
                    break;
                }
                if (head === null) {
                    head = { first, last };
                }
            }
            if (valid) {
                return Object.freeze({ first: head.first, last: head.last, count: items.length });
            }
        }
        return null;
    },

    /**
     * @param {string} text
     * @return {string}
     */
    bare(text) {
        return text.replace(ScribeAnswer.Settings.NonAlphanumerics, ScribeAnswer.Settings.Nothing).toLowerCase();
    },

    /**
     * @param {string} raw
     * @return {string|null}
     */
    label(raw) {
        const settings = ScribeAnswer.Settings;
        const trimmed = raw.trim();
        let start = 0;
        let end = trimmed.length;
        while (start < end && settings.LabelStart.includes(trimmed[start])) {
            start++;
        }
        while (end > start && settings.LabelEdges.includes(trimmed[end - 1])) {
            end--;
        }
        const label = trimmed.slice(start, end).trim();
        if (label.length > settings.MaxLabel) {
            return null;
        }
        const name = ScribeText.normaliseName(label);
        if (!settings.HasContent.test(name) || name === settings.NarratorName) {
            return null;
        }
        return label;
    },

    /**
     * @param {string[]} fields
     * @return {string|null}
     */
    text(fields) {
        const settings = ScribeAnswer.Settings;
        const unusable = fields.some(
            /**
             * @param {string} field
             * @param {number} index
             * @return {boolean}
             */
            (field, index) =>
                !settings.HasContent.test(field) ||
                ScribeAnswer.bare(field) === settings.HiddenWord ||
                (index > 0 && settings.LeadingHashDigit.test(field)),
        );
        if (fields.length === 0 || unusable) {
            return null;
        }
        return fields.join(settings.Joiner);
    },

    Readers: Object.freeze({
        /**
         * @param {string[]} fields
         * @return {object|string}
         */
        SUBJECTS(fields) {
            const settings = ScribeAnswer.Settings;
            const reasons = ScribeAnswer.Reason;
            if (fields.length !== settings.SubjectFields) {
                return reasons.Shape;
            }
            const [labelField, kindField] = fields;
            const kind = Object.values(ScribeCategory.SubjectKinds).find(
                /**
                 * @param {string} value
                 * @return {boolean}
                 */
                (value) => value === kindField.toLowerCase(),
            );
            if (kind === undefined) {
                return reasons.Shape;
            }
            const label = ScribeAnswer.label(labelField);
            if (label === null) {
                return reasons.Name;
            }
            return Object.freeze({ type: ScribeAnswer.Type.Subject, label, kind });
        },

        /**
         * @param {string[]} fields
         * @return {object|string}
         */
        NAMES(fields) {
            const settings = ScribeAnswer.Settings;
            const reasons = ScribeAnswer.Reason;
            if (fields.length !== settings.NameFields) {
                return reasons.Shape;
            }
            const [nameField, labelField, citationField] = fields;
            const name = ScribeAnswer.label(nameField);
            const label = ScribeAnswer.label(labelField);
            if (name === null || label === null) {
                return reasons.Name;
            }
            const cited = ScribeAnswer.citation(citationField);
            if (cited === null) {
                return reasons.Citation;
            }
            return Object.freeze({ type: ScribeAnswer.Type.Alias, name, label, position: cited.first });
        },

        /**
         * @param {string[]} fields
         * @return {object|string}
         */
        FACTS(fields) {
            const settings = ScribeAnswer.Settings;
            const reasons = ScribeAnswer.Reason;
            const hiddenAfter = ScribeAnswer.bare(fields.at(settings.Last)) === settings.HiddenWord;
            const withoutTail = hiddenAfter ? fields.slice(0, settings.Last) : fields;
            const citationField = withoutTail.at(settings.Last);
            const body = withoutTail.slice(0, settings.Last);
            const hiddenBefore = body.length > 0 && ScribeAnswer.bare(body.at(settings.Last)) === settings.HiddenWord;
            const core = hiddenBefore ? body.slice(0, settings.Last) : body;
            if (core.length < settings.FactFields) {
                return reasons.Shape;
            }
            const [labelField, categoryField] = core;
            const text = ScribeAnswer.text(core.slice(settings.ThirdField));
            if (text === null) {
                return reasons.Shape;
            }
            const label = ScribeAnswer.label(labelField);
            if (label === null) {
                return reasons.Name;
            }
            const parsed = ScribeCategory.parse(categoryField);
            if (parsed === null) {
                return reasons.Category;
            }
            const cited = ScribeAnswer.citation(citationField);
            if (cited === null) {
                return reasons.Citation;
            }
            return Object.freeze({
                type: ScribeAnswer.Type.Fact,
                label,
                category: parsed.category,
                target: parsed.target,
                text,
                position: cited.first,
                hidden: hiddenAfter || hiddenBefore,
            });
        },

        /**
         * @param {string[]} fields
         * @return {object|string}
         */
        CHANGES(fields) {
            const settings = ScribeAnswer.Settings;
            const reasons = ScribeAnswer.Reason;
            const types = ScribeAnswer.Type;
            if (fields.length < settings.ChangeFields || !settings.FactId.test(fields[0])) {
                return reasons.Shape;
            }
            const statement = ScribeAnswer.text(fields.slice(settings.StatementStart, settings.Last));
            if (statement === null) {
                return reasons.Shape;
            }
            const word = statement.match(settings.MarkerWord);
            const lower = word === null ? settings.Nothing : word[1].toLowerCase();
            const marked = lower === settings.EndedWord || lower === settings.FullerWord;
            let hasMarker = false;
            if (marked) {
                let after = word[0].length;
                while (after < statement.length && settings.MarkerWrappers.includes(statement[after])) {
                    after++;
                }
                hasMarker = word[1] === word[1].toUpperCase() || statement[after] === settings.Colon;
                if (!hasMarker) {
                    return reasons.Shape;
                }
            }
            let rest = settings.Nothing;
            if (hasMarker) {
                let start = word[0].length;
                let end = statement.length;
                while (start < end && settings.MarkerLeaders.includes(statement[start])) {
                    start++;
                }
                while (end > start && settings.MarkerTrailers.includes(statement[end - 1])) {
                    end--;
                }
                rest = statement.slice(start, end).trim();
                const hollow = rest !== settings.Nothing && !settings.HasContent.test(rest);
                if (hollow || (lower === settings.FullerWord && rest === settings.Nothing)) {
                    return reasons.Shape;
                }
            }
            const label = ScribeAnswer.label(fields[settings.SecondField]);
            if (label === null) {
                return reasons.Name;
            }
            const parsed = ScribeCategory.parse(fields[settings.ThirdField]);
            if (parsed === null) {
                return reasons.Category;
            }
            const cited = ScribeAnswer.citation(fields.at(settings.Last));
            if (cited === null) {
                return reasons.Citation;
            }
            const named = {
                fact: fields[0].toUpperCase(),
                label,
                category: parsed.category,
                target: parsed.target,
            };
            if (hasMarker && lower === settings.EndedWord) {
                return Object.freeze({ type: types.End, ...named, reason: rest, position: cited.first });
            }
            if (hasMarker) {
                return Object.freeze({ type: types.Refine, ...named, text: rest, position: cited.first });
            }
            return Object.freeze({ type: types.Change, ...named, text: statement, position: cited.first });
        },

        /**
         * @param {string[]} fields
         * @return {object|string}
         */
        TOLD(fields) {
            const settings = ScribeAnswer.Settings;
            const reasons = ScribeAnswer.Reason;
            if (fields.length !== settings.ToldFields || !settings.FactId.test(fields[0])) {
                return reasons.Shape;
            }
            const [fact, ownerField, labelField, citationField] = fields;
            const owner = ScribeAnswer.label(ownerField);
            const label = ScribeAnswer.label(labelField);
            if (owner === null || label === null) {
                return reasons.Name;
            }
            const cited = ScribeAnswer.citation(citationField);
            if (cited === null) {
                return reasons.Citation;
            }
            return Object.freeze({
                type: ScribeAnswer.Type.Told,
                fact: fact.toUpperCase(),
                owner,
                label,
                position: cited.first,
            });
        },

        /**
         * @param {string[]} fields
         * @return {object|string}
         */
        SCENES(fields) {
            const settings = ScribeAnswer.Settings;
            const reasons = ScribeAnswer.Reason;
            if (fields.length < settings.SceneFields) {
                return reasons.Shape;
            }
            const [dayField, spanField, place, reachField, presentField] = fields;
            const dayMatch = dayField.match(settings.DayField);
            const day = dayMatch === null ? null : ScribeAnswer.positiveInteger(dayMatch[1]);
            const reach = Object.values(ScribeAnswer.Reach).find(
                /**
                 * @param {string} value
                 * @return {boolean}
                 */
                (value) => value.toLowerCase() === reachField.toLowerCase(),
            );
            const presentMatch = presentField.match(settings.PresentField);
            const summary = ScribeAnswer.text(fields.slice(settings.SummaryStart));
            if (
                day === null ||
                place === settings.Nothing ||
                reach === undefined ||
                presentMatch === null ||
                summary === null
            ) {
                return reasons.Shape;
            }
            const attendance = presentMatch[1].trim();
            const entries = [];
            if (!settings.EmptyAttendance.test(ScribeAnswer.bare(attendance))) {
                const pieces = [];
                let depth = 0;
                let piece = settings.Nothing;
                let outside = settings.Nothing;
                for (const character of attendance) {
                    if (character === settings.OpenBracket) {
                        depth++;
                    } else if (character === settings.CloseBracket) {
                        depth--;
                        if (depth < 0) {
                            return reasons.Shape;
                        }
                    }
                    if (character === settings.Comma && depth === 0) {
                        pieces.push({ piece, outside });
                        piece = settings.Nothing;
                        outside = settings.Nothing;
                    } else {
                        piece += character;
                        if (depth === 0 && character !== settings.CloseBracket) {
                            outside += character;
                        }
                    }
                }
                if (depth !== 0) {
                    return reasons.Shape;
                }
                pieces.push({ piece, outside });
                for (const entry of pieces) {
                    let rest = entry.piece.trim();
                    if (rest === settings.Nothing) {
                        continue;
                    }
                    if (settings.EntrySplitters.test(entry.outside)) {
                        return reasons.Shape;
                    }
                    let from = null;
                    let until = null;
                    let both = rest.match(settings.BoundBoth);
                    let one = both === null ? rest.match(settings.BoundOne) : null;
                    while (both !== null || one !== null) {
                        let found = null;
                        let newFrom = null;
                        let newUntil = null;
                        if (both !== null) {
                            found = both;
                            newFrom = ScribeAnswer.positiveInteger(both[1]);
                            newUntil = ScribeAnswer.positiveInteger(both[2]);
                            if (newFrom === null || newUntil === null) {
                                return reasons.Shape;
                            }
                        } else {
                            found = one;
                            const bound = ScribeAnswer.positiveInteger(one[2]);
                            if (bound === null) {
                                return reasons.Shape;
                            }
                            newFrom = one[1].toLowerCase() === settings.FromWord ? bound : null;
                            newUntil = newFrom === null ? bound : null;
                        }
                        if ((newFrom !== null && from !== null) || (newUntil !== null && until !== null)) {
                            return reasons.Shape;
                        }
                        from = newFrom ?? from;
                        until = newUntil ?? until;
                        rest = rest.slice(0, found.index).trim();
                        both = rest.match(settings.BoundBoth);
                        one = both === null ? rest.match(settings.BoundOne) : null;
                    }
                    const backwards = from !== null && until !== null && from > until;
                    if (backwards || settings.HashDigit.test(rest) || settings.UnmarkedBound.test(rest)) {
                        return reasons.Shape;
                    }
                    entries.push({ rest, from, until });
                }
            }
            const present = [];
            for (const { rest, from, until } of entries) {
                const label = ScribeAnswer.label(rest);
                if (label === null) {
                    return reasons.Name;
                }
                present.push(Object.freeze({ label, from, until }));
            }
            const cited = ScribeAnswer.citation(spanField);
            if (cited === null || cited.count !== 1) {
                return reasons.Citation;
            }
            return Object.freeze({
                type: ScribeAnswer.Type.Scene,
                day,
                first: cited.first,
                last: cited.last,
                place,
                reach,
                present: Object.freeze(present),
                summary,
            });
        },

        /**
         * @param {string[]} fields
         * @return {object|string}
         */
        NIGHTS(fields) {
            const settings = ScribeAnswer.Settings;
            const reasons = ScribeAnswer.Reason;
            if (fields.length < settings.NightFields) {
                return reasons.Shape;
            }
            const marker = ScribeAnswer.text(fields.slice(settings.SecondField));
            if (marker === null) {
                return reasons.Shape;
            }
            const cited = ScribeAnswer.citation(fields[0]);
            if (cited === null) {
                return reasons.Citation;
            }
            return Object.freeze({ type: ScribeAnswer.Type.Night, position: cited.first, marker });
        },

        /**
         * @param {string[]} fields
         * @return {object|string}
         */
        THREADS(fields) {
            const settings = ScribeAnswer.Settings;
            const reasons = ScribeAnswer.Reason;
            const opening = settings.OpenThread.test(fields[0]);
            const closing = fields[0].match(settings.CloseThread);
            const accountless = fields.length === settings.CloseOnlyFields && closing !== null;
            if (fields.length < settings.ThreadFields && !accountless) {
                return reasons.Shape;
            }
            const body = accountless
                ? settings.Nothing
                : ScribeAnswer.text(fields.slice(settings.SecondField, settings.Last));
            if ((!opening && closing === null) || body === null) {
                return reasons.Shape;
            }
            const cited = ScribeAnswer.citation(fields.at(settings.Last));
            if (cited === null) {
                return reasons.Citation;
            }
            if (opening) {
                return Object.freeze({ type: ScribeAnswer.Type.ThreadOpen, text: body, position: cited.first });
            }
            return Object.freeze({
                type: ScribeAnswer.Type.ThreadClose,
                thread: closing[1].toUpperCase(),
                how: body,
                position: cited.first,
            });
        },

        /**
         * @param {string[]} fields
         * @return {object|string}
         */
        QUESTIONS(fields) {
            const settings = ScribeAnswer.Settings;
            const reasons = ScribeAnswer.Reason;
            if (fields.length < settings.QuestionFields) {
                return reasons.Shape;
            }
            const text = ScribeAnswer.text(fields.slice(0, settings.Last));
            if (text === null) {
                return reasons.Shape;
            }
            const cited = ScribeAnswer.citation(fields.at(settings.Last));
            if (cited === null) {
                return reasons.Citation;
            }
            return Object.freeze({ type: ScribeAnswer.Type.Question, text, position: cited.first });
        },
    }),

    /**
     * @param {string} text
     * @return {Readonly<{ operations: readonly object[], refused: ReadonlyArray<Readonly<{ block: string, line: string, reason: string }>> }>}
     */
    parse(text) {
        const settings = ScribeAnswer.Settings;
        const operations = [];
        const refused = [];
        let block = settings.Preamble;
        for (const raw of text.split(settings.LineBreak)) {
            const line = raw
                .replace(settings.FormatCharacter, settings.Nothing)
                .trim()
                .replace(settings.ListMarkers, settings.Nothing)
                .replace(settings.Bold, settings.BoldInner)
                .replace(settings.ListMarkers, settings.Nothing)
                .trim();
            const piped = line.includes(settings.Pipe);
            let fields = null;
            if (piped) {
                fields = line.split(settings.Pipe).map(
                    /**
                     * @param {string} field
                     * @return {string}
                     */
                    (field) => field.trim(),
                );
            } else if (block === settings.Nights) {
                const colon = line.indexOf(settings.Colon);
                const lead = line.slice(0, colon);
                const cited = colon === settings.NotFound ? null : ScribeAnswer.citation(lead);
                if (cited !== null && cited.count === 1 && lead === lead.trim()) {
                    fields = [lead, line.slice(colon + 1).trim()];
                }
            }
            let reason = null;
            let quarantine = false;
            if (fields === null) {
                const name = ScribeAnswer.bare(line).toUpperCase();
                if (ScribeAnswer.Blocks.includes(name)) {
                    block = name;
                    continue;
                }
                if (
                    line === settings.Nothing ||
                    settings.Fence.test(line) ||
                    (!settings.HashDigit.test(line) && settings.NoneLine.test(line))
                ) {
                    continue;
                }
                quarantine = true;
            } else {
                const glued = fields[0].match(settings.GluedHeader);
                quarantine = glued !== null && ScribeAnswer.Blocks.includes(glued[1]);
            }
            if (quarantine) {
                reason = ScribeAnswer.Reason.Shape;
                if (block !== settings.Preamble) {
                    block = settings.Unknown;
                }
            } else if (ScribeAnswer.Readers[block] === undefined) {
                reason = ScribeAnswer.Reason.Shape;
            } else {
                const result = ScribeAnswer.Readers[block](fields);
                if (typeof result === 'string') {
                    reason = result;
                } else {
                    operations.push(result);
                }
            }
            if (reason !== null) {
                refused.push(Object.freeze({ block, line, reason }));
            }
        }
        return Object.freeze({ operations: Object.freeze(operations), refused: Object.freeze(refused) });
    },
});
/** @file scribe/core/ScribeLog.js */
const ScribeLog = Object.freeze({
    Reason: Object.freeze({
        Citation: 'Citation',
        Reference: 'Reference',
        Ambiguous: 'Ambiguous',
        Mismatch: 'Mismatch',
        Ruled: 'Ruled',
    }),

    Kind: Object.freeze({
        Update: 'Update',
        Operator: 'Operator',
    }),

    Origin: Object.freeze({
        Story: 'Story',
        Notes: 'Notes',
        Answers: 'Answers',
        Operator: 'Operator',
    }),

    Ruling: Object.freeze({
        Pin: 'Pin',
        Merge: 'Merge',
        Split: 'Split',
        Distinct: 'Distinct',
        Narrow: 'Narrow',
        Widen: 'Widen',
        AddFact: 'AddFact',
        RemoveFact: 'RemoveFact',
        Unalias: 'Unalias',
        Answer: 'Answer',
        Dismiss: 'Dismiss',
    }),

    Settings: Object.freeze({
        Version: 1,
        FirstNumber: 1,
        FirstRevision: 0,
        LeastPosition: 0,
        Everyone: 'Everyone',
        SubjectPrefix: 'S',
        FactPrefix: 'F',
        ThreadPrefix: 'T',
        QuestionPrefix: 'Q',
        AkaCategory: 'aka',
        Nothing: '',
        Space: ' ',
        OpenBrackets: '([',
        CloseBrackets: ')]',
        AlreadyRead: 'AlreadyRead',
        UnknownOperation: 'UnknownOperation',
        UnknownOrigin: 'UnknownOrigin',
        StaleState: 'StaleState',
        InvalidOperation: 'InvalidOperation',

        /**
         * @return {RegExp}
         */
        get Blank() {
            return /\s/u;
        },
    }),

    /**
     * @return {{ version: number, nextFact: number, nextSubject: number, nextThread: number, nextQuestion: number, nextSequence: number, revision: number, entries: object[], read: Object<string, number>, notes: string[] }}
     */
    create() {
        const settings = ScribeLog.Settings;
        return {
            version: settings.Version,
            nextFact: settings.FirstNumber,
            nextSubject: settings.FirstNumber,
            nextThread: settings.FirstNumber,
            nextQuestion: settings.FirstNumber,
            nextSequence: settings.FirstNumber,
            revision: settings.FirstRevision,
            entries: [],
            read: {},
            notes: [],
        };
    },

    /**
     * @param {string} label
     * @return {string}
     */
    name(label) {
        const settings = ScribeLog.Settings;
        let depth = 0;
        let gap = false;
        let name = settings.Nothing;
        for (const character of label) {
            if (settings.OpenBrackets.includes(character)) {
                depth++;
            } else if (depth > 0 && settings.CloseBrackets.includes(character)) {
                depth--;
            } else if (depth === 0 && settings.Blank.test(character)) {
                gap = true;
            } else if (depth === 0) {
                name += (gap && name !== settings.Nothing ? settings.Space : settings.Nothing) + character;
                gap = false;
            }
        }
        return name === settings.Nothing ? label : name;
    },

    /**
     * @param {object} context
     * @param {string} written
     * @param {string} subject
     * @return {void}
     */
    index(context, written, subject) {
        const key = ScribeText.normaliseName(written);
        const holders = context.names.get(key) ?? [];
        if (key !== ScribeLog.Settings.Nothing && !holders.includes(subject)) {
            context.names.set(key, [...holders, subject]);
        }
    },

    /**
     * @param {object} context
     * @param {string} subject
     * @param {string} label
     * @param {string} name
     * @return {void}
     */
    enrol(context, subject, label, name) {
        const key = ScribeText.normaliseName(label);
        if (key !== ScribeLog.Settings.Nothing && !context.labels.has(key)) {
            context.labels.set(key, subject);
        }
        ScribeLog.index(context, name, subject);
    },

    /**
     * @param {object} context
     * @param {string} written
     * @return {Readonly<{ subject: string|null, ambiguous: boolean }>}
     */
    find(context, written) {
        const key = ScribeText.normaliseName(written);
        const labelled = context.labels.get(key);
        if (labelled !== undefined) {
            return Object.freeze({ subject: labelled, ambiguous: false });
        }
        const holders = context.names.get(key) ?? [];
        return Object.freeze({
            subject: holders.length === 1 ? holders[0] : null,
            ambiguous: holders.length > 1,
        });
    },

    /**
     * @param {object} context
     * @param {string} written
     * @return {boolean}
     */
    clashes(context, written) {
        return context.mismatched.has(ScribeText.normaliseName(written));
    },

    /**
     * @param {object} context
     * @param {string} written
     * @param {string} subject
     * @return {boolean}
     */
    owns(context, written, subject) {
        const key = ScribeText.normaliseName(written);
        const labelled = context.labels.get(key);
        const reached =
            labelled === undefined ? (context.names.get(key) ?? []).includes(subject) : labelled === subject;
        return !ScribeLog.clashes(context, written) && reached;
    },

    /**
     * @param {object} context
     * @param {{ label: string, category: string, target: string|null }} operation
     * @param {object} named
     * @return {boolean}
     */
    fits(context, operation, named) {
        if (!ScribeLog.owns(context, operation.label, named.subject) || operation.category !== named.category) {
            return false;
        }
        if (named.category !== ScribeCategory.Settings.RelationCategory) {
            return true;
        }
        const written = ScribeText.normaliseName(operation.target);
        const sameText =
            written !== ScribeLog.Settings.Nothing && written === ScribeText.normaliseName(named.targetText);
        const sameSubject =
            named.target !== null &&
            !ScribeLog.clashes(context, operation.target) &&
            ScribeLog.find(context, operation.target).subject === named.target;
        return sameText || sameSubject;
    },

    /**
     * @param {object} context
     * @param {string} label
     * @param {string|null} kind
     * @return {{ type: string, subject: string, label: string, kind: string|null }}
     */
    make(context, label, kind) {
        const subject = ScribeLog.Settings.SubjectPrefix + context.counters.nextSubject;
        context.counters.nextSubject++;
        ScribeLog.enrol(context, subject, label, ScribeLog.name(label));
        context.subjects.set(subject, { label, kind, assumed: kind === null });
        return { type: ScribeAnswer.Type.Subject, subject, label, kind };
    },

    /**
     * @param {object} context
     * @param {string} label
     * @param {object[]} made
     * @return {string|null}
     */
    reach(context, label, made) {
        const match = ScribeLog.find(context, label);
        if (match.ambiguous || match.subject !== null) {
            return match.subject;
        }
        const subject = ScribeLog.make(context, label, null);
        made.push(subject);
        return subject.subject;
    },

    /**
     * @param {object} context
     * @param {object} state
     * @return {void}
     */
    learn(context, state) {
        for (const subject of state.subjects) {
            if (subject.mergedInto !== null) {
                ScribeLog.enrol(context, subject.mergedInto, subject.label, subject.name);
                continue;
            }
            ScribeLog.enrol(context, subject.id, subject.label, subject.name);
            for (const aka of subject.aka) {
                ScribeLog.index(context, aka, subject.id);
            }
            context.subjects.set(subject.id, { label: subject.label, kind: subject.kind, assumed: subject.assumed });
        }
    },

    /**
     * @param {*} value
     * @return {boolean}
     */
    worded(value) {
        return typeof value === 'string' && ScribeAnswer.Settings.HasContent.test(value);
    },

    /**
     * @param {*} category
     * @return {string|null}
     */
    categoryKind(category) {
        for (const [kind, words] of Object.entries(ScribeCategory.Settings.Words)) {
            if (words.includes(category)) {
                return ScribeCategory.Kind[kind];
            }
        }
        return null;
    },

    /**
     * @param {object} state
     * @return {{ state: object, subjects: Map<string, object>, facts: Map<string, object> }}
     */
    view(state) {
        const subjects = new Map();
        const facts = new Map();
        for (const subject of state.subjects) {
            subjects.set(subject.id, subject);
        }
        for (const fact of state.facts) {
            facts.set(fact.id, fact);
        }
        return { state, subjects, facts };
    },

    /**
     * @param {{ subjects: Map<string, object> }} view
     * @param {*} id
     * @return {*}
     */
    root(view, id) {
        const subject = view.subjects.get(id);
        return subject === undefined || subject.mergedInto === null ? id : subject.mergedInto;
    },

    /**
     * @param {{ subjects: Map<string, object> }} view
     * @param {*} first
     * @param {*} second
     * @return {string|null}
     */
    twoSubjects(view, first, second) {
        const sameAlready = ScribeLog.root(view, first) === ScribeLog.root(view, second);
        if (typeof first !== 'string' || typeof second !== 'string' || sameAlready) {
            return ScribeLog.Settings.InvalidOperation;
        }
        if (!view.subjects.has(first) || !view.subjects.has(second)) {
            return ScribeLog.Reason.Reference;
        }
        return null;
    },

    /**
     * @param {ReadonlyArray<{ id: string }>} items
     * @param {string} id
     * @return {object|undefined}
     */
    lookup(items, id) {
        return items.find(
            /**
             * @param {{ id: string }} item
             * @return {boolean}
             */
            (item) => item.id === id,
        );
    },

    /**
     * @param {string} subject
     * @param {string} name
     * @return {string}
     */
    aliasKey(subject, name) {
        return JSON.stringify([subject, ScribeText.normaliseName(name)]);
    },

    /**
     * @param {string} first
     * @param {string} second
     * @return {string}
     */
    pair(first, second) {
        return JSON.stringify(first < second ? [first, second] : [second, first]);
    },

    /**
     * @param {object|undefined} fact
     * @return {boolean}
     */
    unnamed(fact) {
        return fact !== undefined && (fact.status === ScribeReplay.Status.Removed || fact.made);
    },

    /**
     * @param {*} list
     * @return {boolean}
     */
    ids(list) {
        if (!Array.isArray(list) || list.length === 0 || new Set(list).size !== list.length) {
            return false;
        }
        for (let index = 0; index < list.length; index++) {
            if (!Object.hasOwn(list, index) || typeof list[index] !== 'string') {
                return false;
            }
        }
        return true;
    },

    /**
     * @param {object} fact
     * @return {{ subject: string, category: string, target: string|null, targetText: string|null, text: string }}
     */
    mark(fact) {
        return {
            subject: fact.subject,
            category: fact.category,
            target: fact.target,
            targetText: fact.targetText,
            text: fact.text,
        };
    },

    /**
     * @param {{ nextFact: number }} counters
     * @return {string}
     */
    nextFactId(counters) {
        const id = ScribeLog.Settings.FactPrefix + counters.nextFact;
        counters.nextFact++;
        return id;
    },

    Resolvers: Object.freeze({
        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        Subject(operation, context, outcome) {
            const reasons = ScribeLog.Reason;
            if (ScribeLog.clashes(context, operation.label)) {
                return reasons.Mismatch;
            }
            const match = ScribeLog.find(context, operation.label);
            if (match.ambiguous) {
                return reasons.Ambiguous;
            }
            if (match.subject === null) {
                outcome.subjects.push(ScribeLog.make(context, operation.label, operation.kind));
                return null;
            }
            const known = context.subjects.get(match.subject);
            if (known.assumed) {
                known.kind = operation.kind;
                known.assumed = false;
                outcome.checks.push({ written: operation.label, subject: match.subject });
                outcome.draft = {
                    type: ScribeAnswer.Type.Subject,
                    subject: match.subject,
                    label: known.label,
                    kind: operation.kind,
                };
                return null;
            }
            if (known.kind === operation.kind) {
                return null;
            }
            context.mismatched.add(ScribeText.normaliseName(operation.label));
            return reasons.Mismatch;
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        Alias(operation, context, outcome) {
            const reasons = ScribeLog.Reason;
            const cite = context.cites.get(operation.position);
            if (cite === undefined) {
                return reasons.Citation;
            }
            if (ScribeLog.clashes(context, operation.label) || ScribeLog.clashes(context, operation.name)) {
                return reasons.Mismatch;
            }
            const known = ScribeLog.find(context, operation.label);
            if (known.ambiguous) {
                return reasons.Ambiguous;
            }
            if (known.subject === null) {
                return reasons.Reference;
            }
            const named = ScribeLog.find(context, operation.name);
            if (named.ambiguous) {
                return reasons.Ambiguous;
            }
            if (named.subject === known.subject) {
                return null;
            }
            const unaliased = context.unaliased.has(ScribeLog.aliasKey(known.subject, operation.name));
            const apart = named.subject !== null && context.distinct.has(ScribeLog.pair(known.subject, named.subject));
            if (unaliased || apart) {
                return reasons.Ruled;
            }
            ScribeLog.index(context, operation.name, known.subject);
            outcome.checks.push({ written: operation.label, subject: known.subject });
            outcome.draft = {
                type: ScribeAnswer.Type.Alias,
                subject: known.subject,
                name: operation.name,
                cite,
                position: operation.position,
                other: named.subject,
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        Fact(operation, context, outcome) {
            const reasons = ScribeLog.Reason;
            const cite = context.cites.get(operation.position);
            if (cite === undefined) {
                return reasons.Citation;
            }
            if (ScribeLog.clashes(context, operation.label)) {
                return reasons.Mismatch;
            }
            const subject = ScribeLog.reach(context, operation.label, outcome.subjects);
            if (subject === null) {
                return reasons.Ambiguous;
            }
            let other = null;
            if (operation.category === ScribeLog.Settings.AkaCategory) {
                const named = ScribeLog.find(context, operation.text).subject;
                other = named === subject ? null : named;
                ScribeLog.index(context, operation.text, subject);
            }
            outcome.checks.push({ written: operation.label, subject });
            outcome.draft = {
                type: ScribeAnswer.Type.Fact,
                fact: null,
                subject,
                label: operation.label,
                category: operation.category,
                target: null,
                targetText: operation.target,
                other,
                text: operation.text,
                cite,
                position: operation.position,
                hidden: operation.hidden,
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        Refine(operation, context, outcome) {
            const reasons = ScribeLog.Reason;
            const cite = context.cites.get(operation.position);
            if (cite === undefined) {
                return reasons.Citation;
            }
            const named = context.facts.get(operation.fact);
            if (named === undefined || ScribeLog.unnamed(named)) {
                return reasons.Reference;
            }
            if (operation.position < named.position) {
                return reasons.Citation;
            }
            if (!ScribeLog.fits(context, operation, named)) {
                return reasons.Mismatch;
            }
            let other = null;
            if (named.category === ScribeLog.Settings.AkaCategory) {
                const found = ScribeLog.find(context, operation.text).subject;
                other = found === named.subject ? null : found;
                ScribeLog.index(context, operation.text, named.subject);
            }
            outcome.draft = {
                type: operation.type,
                fact: operation.fact,
                becomes: null,
                subject: named.subject,
                label: operation.label,
                category: named.category,
                target: named.target,
                targetText: named.targetText,
                other,
                hidden: named.hidden,
                text: operation.text,
                cite,
                position: operation.position,
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        Change(operation, context, outcome) {
            return ScribeLog.Resolvers.Refine(operation, context, outcome);
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        End(operation, context, outcome) {
            const reasons = ScribeLog.Reason;
            const cite = context.cites.get(operation.position);
            if (cite === undefined) {
                return reasons.Citation;
            }
            const named = context.facts.get(operation.fact);
            if (named === undefined || ScribeLog.unnamed(named)) {
                return reasons.Reference;
            }
            if (operation.position < named.position) {
                return reasons.Citation;
            }
            if (!ScribeLog.fits(context, operation, named)) {
                return reasons.Mismatch;
            }
            outcome.draft = {
                type: ScribeAnswer.Type.End,
                fact: operation.fact,
                label: operation.label,
                reason: operation.reason,
                cite,
                position: operation.position,
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        Told(operation, context, outcome) {
            const reasons = ScribeLog.Reason;
            const cite = context.cites.get(operation.position);
            if (cite === undefined) {
                return reasons.Citation;
            }
            const named = context.facts.get(operation.fact);
            if (named === undefined || ScribeLog.unnamed(named)) {
                return reasons.Reference;
            }
            if (operation.position < named.position) {
                return reasons.Citation;
            }
            const owned = ScribeLog.owns(context, operation.owner, named.subject);
            if (!owned || ScribeLog.clashes(context, operation.label)) {
                return reasons.Mismatch;
            }
            const subject = ScribeLog.reach(context, operation.label, outcome.subjects);
            if (subject === null) {
                return reasons.Ambiguous;
            }
            outcome.checks.push({ written: operation.label, subject });
            outcome.draft = {
                type: ScribeAnswer.Type.Told,
                fact: operation.fact,
                subject,
                owner: operation.owner,
                label: operation.label,
                cite,
                position: operation.position,
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        Scene(operation, context, outcome) {
            const reasons = ScribeLog.Reason;
            const reachesBack = context.before !== null && operation.first === context.before.firstPosition;
            const first = reachesBack ? context.before.first : context.cites.get(operation.first);
            const last = context.cites.get(operation.last);
            if (first === undefined || last === undefined || context.starts.has(first)) {
                return reasons.Citation;
            }
            for (const attendee of operation.present) {
                if (ScribeLog.clashes(context, attendee.label)) {
                    return reasons.Mismatch;
                }
            }
            const trial = {
                ...context,
                labels: new Map(context.labels),
                names: new Map(context.names),
                counters: { ...context.counters },
            };
            const present = [];
            for (const attendee of operation.present) {
                const subject = ScribeLog.reach(trial, attendee.label, outcome.subjects);
                if (subject === null) {
                    return reasons.Ambiguous;
                }
                outcome.checks.push({ written: attendee.label, subject });
                present.push({ subject, label: attendee.label, from: attendee.from, until: attendee.until });
            }
            context.labels = trial.labels;
            context.names = trial.names;
            context.counters = trial.counters;
            context.starts.add(first);
            outcome.draft = {
                type: ScribeAnswer.Type.Scene,
                day: operation.day,
                first,
                last,
                firstPosition: operation.first,
                lastPosition: operation.last,
                place: operation.place,
                reach: operation.reach,
                present,
                summary: operation.summary,
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        Night(operation, context, outcome) {
            const cite = context.cites.get(operation.position);
            if (cite === undefined) {
                return ScribeLog.Reason.Citation;
            }
            outcome.draft = {
                type: ScribeAnswer.Type.Night,
                cite,
                position: operation.position,
                marker: operation.marker,
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        ThreadOpen(operation, context, outcome) {
            const cite = context.cites.get(operation.position);
            if (cite === undefined) {
                return ScribeLog.Reason.Citation;
            }
            outcome.draft = {
                type: ScribeAnswer.Type.ThreadOpen,
                thread: null,
                text: operation.text,
                cite,
                position: operation.position,
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        ThreadClose(operation, context, outcome) {
            const reasons = ScribeLog.Reason;
            const cite = context.cites.get(operation.position);
            if (cite === undefined) {
                return reasons.Citation;
            }
            if (!context.threads.has(operation.thread)) {
                return reasons.Reference;
            }
            outcome.draft = {
                type: ScribeAnswer.Type.ThreadClose,
                thread: operation.thread,
                how: operation.how,
                cite,
                position: operation.position,
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} context
         * @param {{ subjects: object[], draft: object|null, checks: object[] }} outcome
         * @return {string|null}
         */
        Question(operation, context, outcome) {
            const cite = context.cites.get(operation.position);
            if (cite === undefined) {
                return ScribeLog.Reason.Citation;
            }
            outcome.draft = {
                type: ScribeAnswer.Type.Question,
                question: null,
                text: operation.text,
                cite,
                position: operation.position,
            };
            return null;
        },
    }),

    Finishers: Object.freeze({
        /**
         * @param {object} draft
         * @param {object} context
         * @return {void}
         */
        Fact(draft, context) {
            if (draft.targetText !== null && !ScribeLog.clashes(context, draft.targetText)) {
                draft.target = ScribeLog.find(context, draft.targetText).subject;
            }
            draft.fact = ScribeLog.Settings.FactPrefix + context.counters.nextFact;
            context.counters.nextFact++;
        },

        /**
         * @param {object} draft
         * @param {object} context
         * @return {void}
         */
        Refine(draft, context) {
            draft.becomes = ScribeLog.Settings.FactPrefix + context.counters.nextFact;
            context.counters.nextFact++;
        },

        /**
         * @param {object} draft
         * @param {object} context
         * @return {void}
         */
        Change(draft, context) {
            ScribeLog.Finishers.Refine(draft, context);
        },

        /**
         * @param {object} draft
         * @param {object} context
         * @return {void}
         */
        ThreadOpen(draft, context) {
            draft.thread = ScribeLog.Settings.ThreadPrefix + context.counters.nextThread;
            context.counters.nextThread++;
        },

        /**
         * @param {object} draft
         * @param {object} context
         * @return {void}
         */
        Question(draft, context) {
            draft.question = ScribeLog.Settings.QuestionPrefix + context.counters.nextQuestion;
            context.counters.nextQuestion++;
        },
    }),

    Rulers: Object.freeze({
        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        Pin(operation, view, outcome) {
            const { subject, category, target, text, hidden } = operation;
            const fixed = ScribeLog.categoryKind(category) === ScribeCategory.Kind.Fixed;
            const valid =
                typeof subject === 'string' &&
                fixed &&
                target === null &&
                ScribeLog.worded(text) &&
                typeof hidden === 'boolean';
            if (!valid) {
                return ScribeLog.Settings.InvalidOperation;
            }
            if (!view.subjects.has(subject)) {
                return ScribeLog.Reason.Reference;
            }
            const owner = ScribeLog.root(view, subject);
            const winner = view.state.facts.find(
                /**
                 * @param {object} fact
                 * @return {boolean}
                 */
                (fact) =>
                    fact.subject === owner &&
                    fact.category === category &&
                    ScribeReplay.live(fact) &&
                    !ScribeLog.unnamed(fact) &&
                    ScribeCategory.same(fact.text, text),
            );
            const source =
                winner ??
                view.state.facts.find(
                    /**
                     * @param {object} fact
                     * @return {boolean}
                     */
                    (fact) =>
                        fact.made &&
                        fact.subject === owner &&
                        fact.category === category &&
                        fact.status === ScribeReplay.Status.InForce &&
                        ScribeCategory.same(fact.text, text),
                );
            outcome.stored = {
                type: operation.type,
                subject,
                category,
                target: null,
                text,
                hidden: winner === undefined ? hidden : winner.hidden,
                fact: ScribeLog.nextFactId(outcome.counters),
                winner: winner === undefined ? null : winner.id,
                told: source === undefined ? [] : [...source.told],
                origin: source === undefined ? ScribeLog.Origin.Operator : source.origin,
                cite: source === undefined ? null : source.cite,
                position: source === undefined ? ScribeReplay.Settings.PinnedPosition : source.position,
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        Merge(operation, view, outcome) {
            const { from, into } = operation;
            if (ScribeLog.root(view, from) !== from) {
                return ScribeLog.Settings.InvalidOperation;
            }
            const reason = ScribeLog.twoSubjects(view, from, into);
            if (reason === null) {
                outcome.stored = { type: operation.type, from, into };
            }
            return reason;
        },

        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        Split(operation, view, outcome) {
            const settings = ScribeLog.Settings;
            const reasons = ScribeLog.Reason;
            const { subject, label, kind, facts } = operation;
            const listing =
                ScribeLog.ids(facts) &&
                !facts.some(
                    /**
                     * @param {string} id
                     * @return {boolean}
                     */
                    (id) => ScribeLog.unnamed(view.facts.get(id)),
                );
            const valid =
                typeof subject === 'string' &&
                typeof label === 'string' &&
                label.length <= ScribeAnswer.Settings.MaxLabel &&
                ScribeLog.worded(ScribeText.normaliseName(label)) &&
                Object.values(ScribeCategory.SubjectKinds).includes(kind) &&
                listing;
            if (!valid) {
                return settings.InvalidOperation;
            }
            if (!view.subjects.has(subject)) {
                return reasons.Reference;
            }
            const owner = ScribeLog.root(view, subject);
            for (const id of facts) {
                const fact = view.facts.get(id);
                if (fact === undefined || fact.subject !== owner) {
                    return reasons.Reference;
                }
            }
            const context = { labels: new Map(), names: new Map(), subjects: new Map() };
            ScribeLog.learn(context, view.state);
            const found = ScribeLog.find(context, label);
            if (found.ambiguous || found.subject !== null) {
                return reasons.Ambiguous;
            }
            const becomes = settings.SubjectPrefix + outcome.counters.nextSubject;
            outcome.counters.nextSubject++;
            outcome.stored = { type: operation.type, subject, label, kind, facts: [...facts], becomes };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        Distinct(operation, view, outcome) {
            const { first, second } = operation;
            const reason = ScribeLog.twoSubjects(view, first, second);
            if (reason === null) {
                outcome.stored = { type: operation.type, first, second };
            }
            return reason;
        },

        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        Narrow(operation, view, outcome) {
            const { scene } = operation;
            if (typeof scene !== 'string') {
                return ScribeLog.Settings.InvalidOperation;
            }
            if (ScribeLog.lookup(view.state.scenes, scene) === undefined) {
                return ScribeLog.Reason.Reference;
            }
            outcome.stored = { type: operation.type, scene };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        Widen(operation, view, outcome) {
            const { fact, to } = operation;
            const everyone = to === ScribeLog.Settings.Everyone;
            const named = view.facts.get(fact);
            if (typeof fact !== 'string' || (!everyone && !ScribeLog.ids(to)) || ScribeLog.unnamed(named)) {
                return ScribeLog.Settings.InvalidOperation;
            }
            const known =
                everyone ||
                to.every(
                    /**
                     * @param {string} id
                     * @return {boolean}
                     */
                    (id) => view.subjects.has(id),
                );
            if (named === undefined || !known) {
                return ScribeLog.Reason.Reference;
            }
            outcome.stored = {
                type: operation.type,
                fact,
                to: everyone ? to : [...to],
                mark: ScribeLog.mark(named),
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        AddFact(operation, view, outcome) {
            const { subject, category, target, text, hidden, cite, position } = operation;
            const relation = category === ScribeCategory.Settings.RelationCategory;
            const kind = ScribeLog.categoryKind(category);
            const valid =
                typeof subject === 'string' &&
                (relation || (kind !== null && kind !== ScribeCategory.Kind.Fixed)) &&
                (relation ? typeof target === 'string' : target === null) &&
                ScribeLog.worded(text) &&
                typeof hidden === 'boolean' &&
                (cite === null || typeof cite === 'string') &&
                Number.isSafeInteger(position) &&
                position >= ScribeLog.Settings.LeastPosition;
            if (!valid) {
                return ScribeLog.Settings.InvalidOperation;
            }
            const owner = ScribeLog.root(view, subject);
            const aimed = relation ? view.subjects.get(target) : undefined;
            const aimedName = aimed === undefined ? ScribeLog.Settings.Nothing : ScribeText.normaliseName(aimed.label);
            const present = view.state.facts.some(
                /**
                 * @param {object} fact
                 * @return {boolean}
                 */
                (fact) => {
                    const written = fact.targetText === null ? null : ScribeText.normaliseName(fact.targetText);
                    const aimedAlike =
                        aimed !== undefined &&
                        (fact.target === ScribeLog.root(view, target) ||
                            (aimedName !== ScribeLog.Settings.Nothing && written === aimedName));
                    return (
                        fact.subject === owner &&
                        fact.category === category &&
                        fact.status === ScribeReplay.Status.InForce &&
                        (!relation || aimedAlike) &&
                        ScribeCategory.same(fact.text, text)
                    );
                },
            );
            if (present) {
                return ScribeLog.Settings.InvalidOperation;
            }
            if (!view.subjects.has(subject) || (relation && aimed === undefined)) {
                return ScribeLog.Reason.Reference;
            }
            outcome.stored = {
                type: operation.type,
                subject,
                category,
                target,
                targetText: relation ? view.subjects.get(target).label : null,
                text,
                hidden,
                cite,
                position,
                fact: ScribeLog.nextFactId(outcome.counters),
            };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        RemoveFact(operation, view, outcome) {
            const { fact } = operation;
            const named = view.facts.get(fact);
            if (typeof fact !== 'string' || ScribeLog.unnamed(named)) {
                return ScribeLog.Settings.InvalidOperation;
            }
            if (named === undefined) {
                return ScribeLog.Reason.Reference;
            }
            outcome.stored = { type: operation.type, fact, mark: ScribeLog.mark(named) };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        Unalias(operation, view, outcome) {
            const { subject, name } = operation;
            if (typeof subject !== 'string' || typeof name !== 'string') {
                return ScribeLog.Settings.InvalidOperation;
            }
            const owner = ScribeLog.root(view, subject);
            const key = ScribeText.normaliseName(name);
            const held = view.state.aliases.some(
                /**
                 * @param {{ subject: string, name: string }} item
                 * @return {boolean}
                 */
                (item) => item.subject === owner && ScribeText.normaliseName(item.name) === key,
            );
            if (!view.subjects.has(subject) || !held) {
                return ScribeLog.Reason.Reference;
            }
            outcome.stored = { type: operation.type, subject, name };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        Answer(operation, view, outcome) {
            const { question, text } = operation;
            if (typeof question !== 'string' || !ScribeLog.worded(text)) {
                return ScribeLog.Settings.InvalidOperation;
            }
            const asked = ScribeLog.lookup(view.state.questions, question);
            if (asked === undefined) {
                return ScribeLog.Reason.Reference;
            }
            outcome.stored = { type: operation.type, question, text, questionText: asked.text };
            return null;
        },

        /**
         * @param {object} operation
         * @param {object} view
         * @param {{ counters: object, stored: object|null }} outcome
         * @return {string|null}
         */
        Dismiss(operation, view, outcome) {
            const { question } = operation;
            if (typeof question !== 'string') {
                return ScribeLog.Settings.InvalidOperation;
            }
            const asked = ScribeLog.lookup(view.state.questions, question);
            if (asked === undefined) {
                return ScribeLog.Reason.Reference;
            }
            outcome.stored = { type: operation.type, question, questionText: asked.text };
            return null;
        },
    }),

    /**
     * @param {object} log
     * @param {object} state
     * @param {readonly object[]} operations
     * @param {{ messages: readonly object[], origin: string }} stretch
     * @return {Readonly<{ entry: object, refused: ReadonlyArray<Readonly<{ operation: object, reason: string }>> }>}
     * @throws {Error}
     */
    append(log, state, operations, stretch) {
        const settings = ScribeLog.Settings;
        const origins = ScribeLog.Origin;
        if (
            stretch.origin !== origins.Story &&
            stretch.origin !== origins.Notes &&
            stretch.origin !== origins.Answers
        ) {
            throw new Error(settings.UnknownOrigin);
        }
        if (state.revision !== log.revision) {
            throw new Error(settings.StaleState);
        }
        const story = stretch.origin === origins.Story;
        const messageIds = [];
        const cites = new Map();
        let earliest = Number.POSITIVE_INFINITY;
        for (const message of stretch.messages) {
            messageIds.push(message.id);
            cites.set(message.position, message.id);
            earliest = Math.min(earliest, message.position);
        }
        let before = null;
        for (const scene of state.scenes) {
            const running =
                before === null ||
                scene.lastPosition > before.lastPosition ||
                (scene.lastPosition === before.lastPosition && scene.firstPosition > before.firstPosition);
            if (scene.firstPosition < earliest && running) {
                before = scene;
            }
        }
        if (story) {
            for (const id of messageIds) {
                if (Object.hasOwn(log.read, id)) {
                    throw new Error(settings.AlreadyRead);
                }
            }
        }
        const unaliased = new Set();
        for (const item of state.unaliased) {
            unaliased.add(ScribeLog.aliasKey(item.subject, item.name));
        }
        const distinct = new Set();
        for (const item of state.distinct) {
            distinct.add(ScribeLog.pair(item.first, item.second));
        }
        const settled = new Map();
        let marked = new Set();
        let context = null;
        let results = [];
        let unsettled = true;
        while (unsettled) {
            context = {
                cites,
                before,
                unaliased,
                distinct,
                starts: new Set(),
                facts: new Map(),
                threads: new Set(),
                labels: new Map(),
                names: new Map(),
                subjects: new Map(),
                mismatched: new Set(marked),
                counters: {
                    nextSubject: log.nextSubject,
                    nextFact: log.nextFact,
                    nextThread: log.nextThread,
                    nextQuestion: log.nextQuestion,
                },
            };
            for (const fact of state.facts) {
                context.facts.set(fact.id, fact);
            }
            for (const thread of state.threads) {
                context.threads.add(thread.id);
            }
            ScribeLog.learn(context, state);
            results = [];
            for (const [index, operation] of operations.entries()) {
                if (!Object.hasOwn(ScribeLog.Resolvers, operation.type)) {
                    throw new Error(settings.UnknownOperation);
                }
                const outcome = { subjects: [], draft: null, checks: [] };
                const reason = settled.get(index) ?? ScribeLog.Resolvers[operation.type](operation, context, outcome);
                results.push({ operation, outcome, reason });
            }
            let refusedAtEnd = false;
            for (const [index, { outcome, reason }] of results.entries()) {
                const shifted =
                    reason === null &&
                    outcome.checks.some(
                        /**
                         * @param {{ written: string, subject: string }} check
                         * @return {boolean}
                         */
                        (check) => ScribeLog.find(context, check.written).subject !== check.subject,
                    );
                if (shifted) {
                    settled.set(index, ScribeLog.Reason.Ambiguous);
                    refusedAtEnd = true;
                }
            }
            unsettled = refusedAtEnd || context.mismatched.size > marked.size;
            marked = context.mismatched;
        }
        const resolved = [];
        const refused = [];
        for (const { operation, outcome, reason } of results) {
            if (reason !== null) {
                refused.push(Object.freeze({ operation, reason }));
                continue;
            }
            resolved.push(...outcome.subjects);
            if (outcome.draft === null) {
                continue;
            }
            if (Object.hasOwn(ScribeLog.Finishers, outcome.draft.type)) {
                ScribeLog.Finishers[outcome.draft.type](outcome.draft, context);
            }
            resolved.push(outcome.draft);
        }
        const entry = {
            sequence: log.nextSequence,
            kind: ScribeLog.Kind.Update,
            origin: stretch.origin,
            messageIds: story ? messageIds : [],
            operations: resolved,
            withdrawn: false,
        };
        Object.assign(log, context.counters);
        log.nextSequence++;
        log.revision++;
        log.entries.push(entry);
        for (const id of entry.messageIds) {
            log.read[id] = entry.sequence;
        }
        return Object.freeze({ entry, refused: Object.freeze(refused) });
    },

    /**
     * @param {object} log
     * @param {object} operation
     * @return {object}
     */
    file(log, operation) {
        const entry = {
            sequence: log.nextSequence,
            kind: ScribeLog.Kind.Operator,
            origin: ScribeLog.Origin.Operator,
            messageIds: [],
            operations: [operation],
            withdrawn: false,
        };
        log.nextSequence++;
        log.revision++;
        log.entries.push(entry);
        return entry;
    },

    /**
     * @param {object} log
     * @param {object} state
     * @param {object} operation
     * @return {object}
     * @throws {Error}
     */
    rule(log, state, operation) {
        const settings = ScribeLog.Settings;
        if (state.revision !== log.revision) {
            throw new Error(settings.StaleState);
        }
        if (operation === null || typeof operation !== 'object' || !Object.hasOwn(ScribeLog.Ruling, operation.type)) {
            throw new Error(settings.UnknownOperation);
        }
        const outcome = { counters: { nextFact: log.nextFact, nextSubject: log.nextSubject }, stored: null };
        const reason = ScribeLog.Rulers[operation.type](operation, ScribeLog.view(state), outcome);
        if (reason !== null) {
            throw new Error(reason);
        }
        Object.assign(log, outcome.counters);
        return ScribeLog.file(log, outcome.stored);
    },

    /**
     * @param {object} log
     * @param {object} state
     * @return {readonly object[]}
     * @throws {Error}
     */
    keepFirst(log, state) {
        if (state.revision !== log.revision) {
            throw new Error(ScribeLog.Settings.StaleState);
        }
        const facts = ScribeLog.view(state).facts;
        const counters = { nextFact: log.nextFact };
        const pins = [];
        for (const conflict of state.conflicts) {
            if (conflict.established === null) {
                continue;
            }
            const fact = facts.get(conflict.established);
            pins.push({
                type: ScribeLog.Ruling.Pin,
                subject: fact.subject,
                category: fact.category,
                target: null,
                text: fact.text,
                hidden: fact.hidden,
                fact: ScribeLog.nextFactId(counters),
                winner: fact.id,
                told: [...fact.told],
                origin: fact.origin,
                cite: fact.cite,
                position: fact.position,
            });
        }
        log.nextFact = counters.nextFact;
        const entries = [];
        for (const pin of pins) {
            entries.push(ScribeLog.file(log, pin));
        }
        return Object.freeze(entries);
    },

    /**
     * @param {object} log
     * @param {string} messageId
     * @return {readonly string[]|null}
     */
    withdraw(log, messageId) {
        let found = null;
        for (const entry of log.entries) {
            const story = entry.kind === ScribeLog.Kind.Update && entry.origin === ScribeLog.Origin.Story;
            if (story && !entry.withdrawn && entry.messageIds.includes(messageId)) {
                found = entry;
                break;
            }
        }
        if (found === null) {
            return null;
        }
        found.withdrawn = true;
        for (const id of found.messageIds) {
            if (log.read[id] === found.sequence) {
                delete log.read[id];
            }
        }
        log.revision++;
        return Object.freeze([...found.messageIds]);
    },

    /**
     * @param {object} log
     * @param {number} sequence
     * @return {object|null}
     */
    revoke(log, sequence) {
        for (const entry of log.entries) {
            if (entry.sequence === sequence && entry.kind === ScribeLog.Kind.Operator && !entry.withdrawn) {
                entry.withdrawn = true;
                log.revision++;
                return entry;
            }
        }
        return null;
    },
});
/** @file scribe/core/ScribeReplay.js */
const ScribeReplay = Object.freeze({
    Status: Object.freeze({
        InForce: 'InForce',
        Disputed: 'Disputed',
        Replaced: 'Replaced',
        Ended: 'Ended',
        Expired: 'Expired',
        Removed: 'Removed',
    }),

    Likeness: Object.freeze({
        Spelling: 'Spelling',
        SameName: 'SameName',
        Alias: 'Alias',
    }),

    Settings: Object.freeze({
        KindCategory: 'kind',
        TargetKey: 'target',
        TextKey: 'text',
        WordJoiner: ' ',
        Nothing: '',
        PinnedPosition: 0,
    }),

    /**
     * @param {object} book
     * @param {string} id
     * @return {string}
     */
    resolve(book, id) {
        const passed = [];
        let current = id;
        while (book.merged.has(current)) {
            passed.push(current);
            current = book.merged.get(current);
        }
        for (const step of passed) {
            book.merged.set(step, current);
        }
        return current;
    },

    /**
     * @param {object} book
     * @param {string} id
     * @param {string} subject
     * @return {string}
     */
    owner(book, id, subject) {
        return ScribeReplay.resolve(book, book.split.get(id) ?? subject);
    },

    /**
     * @param {object} book
     * @param {string} first
     * @param {string} second
     * @return {string}
     */
    pairKey(book, first, second) {
        return ScribeLog.pair(ScribeReplay.resolve(book, first), ScribeReplay.resolve(book, second));
    },

    /**
     * @param {{ subject: string, category: string, target: string|null, targetText: string|null, text: string }} statement
     * @return {string[]}
     */
    statementKeys(statement) {
        const settings = ScribeReplay.Settings;
        const wording = ScribeReplay.wording(statement.text);
        if (statement.category !== ScribeCategory.Settings.RelationCategory) {
            return [JSON.stringify([statement.subject, statement.category, wording])];
        }
        const keys = [];
        if (statement.target !== null) {
            keys.push(
                JSON.stringify([statement.subject, statement.category, settings.TargetKey, statement.target, wording]),
            );
        }
        const name = statement.targetText === null ? settings.Nothing : ScribeText.normaliseName(statement.targetText);
        if (name !== settings.Nothing) {
            keys.push(JSON.stringify([statement.subject, statement.category, settings.TextKey, name, wording]));
        }
        return keys;
    },

    /**
     * @param {object} book
     * @param {{ subject: string, category: string, target: string|null, targetText: string|null, text: string }} mark
     * @return {string[]}
     */
    markKeys(book, mark) {
        return ScribeReplay.statementKeys({
            subject: ScribeReplay.resolve(book, mark.subject),
            category: mark.category,
            target: mark.target === null ? null : ScribeReplay.resolve(book, mark.target),
            targetText: mark.targetText,
            text: mark.text,
        });
    },

    /**
     * @param {object} book
     * @param {object} fact
     * @return {boolean}
     */
    erase(book, fact) {
        const struck =
            book.removed.has(fact.id) ||
            (book.struck.size > 0 &&
                fact.origin !== ScribeLog.Origin.Operator &&
                !fact.made &&
                ScribeReplay.statementKeys(fact).some(
                    /**
                     * @param {string} key
                     * @return {boolean}
                     */
                    (key) => book.struck.has(key),
                ));
        if (struck) {
            fact.status = ScribeReplay.Status.Removed;
            book.facts.push(fact);
        }
        return struck;
    },

    /**
     * @param {object} book
     * @param {readonly object[]} rulings
     * @param {Object<string, Function>} handlers
     * @return {void}
     */
    apply(book, rulings, handlers) {
        for (const [order, operation] of rulings.entries()) {
            if (Object.hasOwn(handlers, operation.type)) {
                handlers[operation.type](book, operation, order);
            }
        }
    },

    /**
     * @param {Map<string, { order: number }>} rulings
     * @param {string[]} keys
     * @param {{ order: number }|undefined} found
     * @return {{ order: number }|undefined}
     */
    latest(rulings, keys, found) {
        let latest = found;
        for (const key of keys) {
            const candidate = rulings.get(key);
            if (candidate !== undefined && (latest === undefined || candidate.order > latest.order)) {
                latest = candidate;
            }
        }
        return latest;
    },

    /**
     * @param {object} book
     * @param {object} operation
     * @return {string|null}
     */
    pinSlot(book, operation) {
        const fixed = ScribeLog.categoryKind(operation.category) === ScribeCategory.Kind.Fixed;
        if (!fixed || !book.subjects.has(operation.subject)) {
            return null;
        }
        return JSON.stringify([ScribeReplay.resolve(book, operation.subject), operation.category]);
    },

    /**
     * @param {string} category
     * @return {string|null}
     */
    kindOf(category) {
        if (category === ScribeCategory.Settings.RelationCategory) {
            return ScribeCategory.Kind.Moving;
        }
        const parsed = ScribeCategory.parse(category);
        return parsed === null ? null : parsed.kind;
    },

    /**
     * @param {string} text
     * @return {string}
     */
    wording(text) {
        return ScribeText.words(text).join(ScribeReplay.Settings.WordJoiner);
    },

    /**
     * @param {string} subject
     * @param {string} target
     * @return {string}
     */
    targetKey(subject, target) {
        return JSON.stringify([
            subject,
            ScribeCategory.Settings.RelationCategory,
            ScribeReplay.Settings.TargetKey,
            target,
        ]);
    },

    /**
     * @param {object} fact
     * @return {string|null}
     */
    textKey(fact) {
        const settings = ScribeReplay.Settings;
        const name = fact.targetText === null ? settings.Nothing : ScribeText.normaliseName(fact.targetText);
        if (name === settings.Nothing) {
            return null;
        }
        return JSON.stringify([fact.subject, fact.category, settings.TextKey, name]);
    },

    /**
     * @param {object} fact
     * @param {string} kind
     * @return {string[]}
     */
    keys(fact, kind) {
        if (fact.category === ScribeCategory.Settings.RelationCategory) {
            if (fact.target !== null) {
                return [ScribeReplay.targetKey(fact.subject, fact.target)];
            }
            const text = ScribeReplay.textKey(fact);
            return text === null ? [] : [text];
        }
        if (kind === ScribeCategory.Kind.List) {
            return [JSON.stringify([fact.subject, fact.category, ScribeReplay.wording(fact.text)])];
        }
        return [JSON.stringify([fact.subject, fact.category])];
    },

    /**
     * @param {object} book
     * @param {object} fact
     * @param {string[]} keys
     * @return {void}
     */
    enter(book, fact, keys) {
        for (const key of keys) {
            const holders = book.inForce.get(key) ?? new Set();
            holders.add(fact);
            book.inForce.set(key, holders);
        }
        if (ScribeReplay.kindOf(fact.category) === ScribeCategory.Kind.Passing) {
            book.passing.add(fact);
        }
    },

    /**
     * @param {object} book
     * @param {object} fact
     * @param {string[]} keys
     * @return {void}
     */
    leave(book, fact, keys) {
        for (const key of keys) {
            book.inForce.get(key).delete(fact);
        }
    },

    /**
     * @param {object|undefined} fact
     * @return {boolean}
     */
    live(fact) {
        const status = ScribeReplay.Status;
        return fact !== undefined && (fact.status === status.InForce || fact.status === status.Disputed);
    },

    /**
     * @param {object} book
     * @param {string} slot
     * @param {string} wording
     * @return {void}
     */
    say(book, slot, wording) {
        const said = book.said.get(slot) ?? new Map();
        said.set(wording, (said.get(wording) ?? 0) + 1);
        book.said.set(slot, said);
    },

    /**
     * @param {object} book
     * @param {object} fact
     * @return {void}
     */
    unsay(book, fact) {
        const [slot] = ScribeReplay.keys(fact, ScribeCategory.Kind.Fixed);
        const said = book.said.get(slot);
        const pending = [fact.id];
        while (pending.length > 0) {
            const id = pending.pop();
            const wording = book.wordings.get(id);
            const left = said.get(wording) - 1;
            if (left === 0) {
                said.delete(wording);
            } else {
                said.set(wording, left);
            }
            for (const former of book.behind.get(id) ?? []) {
                pending.push(former);
            }
        }
    },

    /**
     * @param {object} fact
     * @param {string} wording
     * @return {string}
     */
    disputeKey(fact, wording) {
        return JSON.stringify([fact.subject, fact.category, wording]);
    },

    /**
     * @param {object} book
     * @param {object} fact
     * @return {void}
     */
    contest(book, fact) {
        const key = ScribeReplay.disputeKey(fact, book.wordings.get(fact.id));
        const contested = book.disputes.get(key) ?? new Set();
        contested.add(fact);
        book.disputes.set(key, contested);
    },

    /**
     * @param {object} book
     * @param {string} holder
     * @param {string} former
     * @return {void}
     */
    attach(book, holder, former) {
        const formers = book.behind.get(holder) ?? [];
        formers.push(former);
        book.behind.set(holder, formers);
    },

    /**
     * @param {object} book
     * @param {string} id
     * @return {object|undefined}
     */
    follow(book, id) {
        const passed = [];
        let current = id;
        while (book.fuller.has(current)) {
            passed.push(current);
            current = book.fuller.get(current);
        }
        for (const step of passed) {
            book.fuller.set(step, current);
        }
        return book.byId.get(current);
    },

    /**
     * @param {object} book
     * @param {string} subject
     * @param {string} text
     * @param {object|null} fact
     * @return {void}
     */
    mention(book, subject, text, fact) {
        const mentions = book.mentions.get(subject) ?? [];
        mentions.push({ text, fact });
        book.mentions.set(subject, mentions);
    },

    /**
     * @param {object} book
     * @param {string} first
     * @param {string} second
     * @return {void}
     */
    link(book, first, second) {
        for (const [one, two] of [
            [first, second],
            [second, first],
        ]) {
            const partners = book.pairs.get(one) ?? new Set();
            partners.add(two);
            book.pairs.set(one, partners);
        }
    },

    /**
     * @param {object} book
     * @param {object} fact
     * @return {void}
     */
    keep(book, fact) {
        book.facts.push(fact);
        book.byId.set(fact.id, fact);
        if (fact.category === ScribeLog.Settings.AkaCategory) {
            ScribeReplay.mention(book, fact.subject, fact.text, fact);
        }
    },

    /**
     * @param {object} book
     * @param {object} fact
     * @param {number} position
     * @return {void}
     */
    mark(book, fact, position) {
        if (
            fact.category !== ScribeCategory.Settings.RelationCategory ||
            fact.target === null ||
            fact.target === fact.subject
        ) {
            return;
        }
        const forward = JSON.stringify([fact.subject, fact.target]);
        if (book.stale.has(forward)) {
            book.stale.delete(forward);
            return;
        }
        for (const back of book.inForce.get(ScribeReplay.targetKey(fact.target, fact.subject)) ?? []) {
            if (back.position < position) {
                book.stale.set(JSON.stringify([fact.target, fact.subject]), {
                    subject: fact.target,
                    target: fact.subject,
                });
            }
        }
    },

    Rules: Object.freeze({
        /**
         * @param {object} book
         * @param {object} fact
         * @param {string[]} keys
         * @return {boolean}
         */
        Fixed(book, fact, keys) {
            const status = ScribeReplay.Status;
            const [slot] = keys;
            const wording = ScribeReplay.wording(fact.text);
            const said = book.said.get(slot);
            if (said !== undefined && said.has(wording)) {
                return false;
            }
            ScribeReplay.say(book, slot, wording);
            book.wordings.set(fact.id, wording);
            const holders = book.inForce.get(slot) ?? new Set();
            if (holders.size === 0) {
                fact.status = status.InForce;
                return true;
            }
            fact.status = status.Disputed;
            ScribeReplay.contest(book, fact);
            return true;
        },

        /**
         * @param {object} book
         * @param {object} fact
         * @param {string[]} keys
         * @return {boolean}
         */
        Moving(book, fact, keys) {
            const status = ScribeReplay.Status;
            const sought = [...keys];
            const text = ScribeReplay.textKey(fact);
            if (fact.target !== null && text !== null) {
                sought.push(text);
            }
            const displaced = new Set();
            for (const key of sought) {
                for (const holder of book.inForce.get(key) ?? []) {
                    displaced.add(holder);
                }
            }
            for (const holder of displaced) {
                ScribeReplay.leave(book, holder, ScribeReplay.keys(holder, ScribeCategory.Kind.Moving));
                holder.status = status.Replaced;
                holder.replacedBy = fact.id;
            }
            fact.status = status.InForce;
            return true;
        },

        /**
         * @param {object} book
         * @param {object} fact
         * @param {string[]} keys
         * @return {boolean}
         */
        List(book, fact, keys) {
            const [slot] = keys;
            const holders = book.inForce.get(slot) ?? new Set();
            if (holders.size > 0) {
                return false;
            }
            fact.status = ScribeReplay.Status.InForce;
            return true;
        },

        /**
         * @param {object} book
         * @param {object} fact
         * @return {boolean}
         */
        Passing(book, fact) {
            fact.status = ScribeReplay.Status.InForce;
            return true;
        },
    }),

    /**
     * @param {object} book
     * @param {{ operation: object, position: number, origin: string }} item
     * @param {string} id
     * @return {object|null}
     */
    file(book, item, id) {
        const operation = item.operation;
        const kind = ScribeReplay.kindOf(operation.category);
        if (kind === null) {
            return null;
        }
        const fact = {
            id,
            subject: ScribeReplay.owner(book, id, operation.subject),
            category: operation.category,
            target: operation.target === null ? null : ScribeReplay.resolve(book, operation.target),
            targetText: operation.targetText,
            text: operation.text,
            cite: operation.cite,
            position: item.position,
            origin: item.origin,
            hidden: operation.hidden,
            told: [],
            widened: null,
            status: null,
            replacedBy: null,
            ended: null,
            pinned: false,
            made: false,
        };
        if (ScribeReplay.erase(book, fact)) {
            return null;
        }
        const keys = ScribeReplay.keys(fact, kind);
        if (!ScribeReplay.Rules[kind](book, fact, keys)) {
            return null;
        }
        if (fact.status === ScribeReplay.Status.InForce) {
            ScribeReplay.enter(book, fact, keys);
        }
        ScribeReplay.keep(book, fact);
        if (typeof operation.other === 'string') {
            ScribeReplay.link(book, fact.subject, ScribeReplay.resolve(book, operation.other));
        }
        ScribeReplay.mark(book, fact, fact.position);
        return fact;
    },

    /**
     * @param {object} book
     * @param {object} operation
     * @param {object|undefined} named
     * @return {boolean}
     */
    takes(book, operation, named) {
        return (
            ScribeReplay.live(named) && ScribeReplay.owner(book, operation.becomes, named.subject) === named.subject
        );
    },

    /**
     * @param {object} book
     * @param {{ operation: object, position: number, origin: string }} item
     * @param {object} named
     * @return {object|null}
     */
    succeed(book, item, named) {
        const status = ScribeReplay.Status;
        const operation = item.operation;
        const fact = {
            id: operation.becomes,
            subject: named.subject,
            category: named.category,
            target: named.target,
            targetText: named.targetText,
            text: operation.text,
            cite: operation.cite,
            position: item.position,
            origin: item.origin,
            hidden: named.hidden,
            told: [],
            widened: null,
            status: null,
            replacedBy: null,
            ended: null,
            pinned: false,
            made: false,
        };
        if (ScribeReplay.erase(book, fact)) {
            return null;
        }
        fact.status = named.status;
        fact.replacedBy = named.replacedBy;
        const kind = ScribeReplay.kindOf(named.category);
        if (named.status === status.InForce) {
            ScribeReplay.leave(book, named, ScribeReplay.keys(named, kind));
            ScribeReplay.enter(book, fact, ScribeReplay.keys(fact, kind));
        }
        named.status = status.Replaced;
        named.replacedBy = fact.id;
        ScribeReplay.keep(book, fact);
        if (operation.other !== null) {
            ScribeReplay.link(book, fact.subject, ScribeReplay.resolve(book, operation.other));
        }
        if (kind === ScribeCategory.Kind.Fixed) {
            const [slot] = ScribeReplay.keys(fact, kind);
            const wording = ScribeReplay.wording(fact.text);
            ScribeReplay.say(book, slot, wording);
            book.wordings.set(fact.id, wording);
            if (fact.status === status.Disputed) {
                ScribeReplay.contest(book, fact);
            }
        }
        return fact;
    },

    Handlers: Object.freeze({
        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        Fact(book, item) {
            ScribeReplay.file(book, item, item.operation.fact);
        },

        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        Refine(book, item) {
            const status = ScribeReplay.Status;
            const operation = item.operation;
            const named = book.byId.get(operation.fact);
            if (!ScribeReplay.takes(book, operation, named)) {
                ScribeReplay.file(book, item, operation.becomes);
                return;
            }
            const fact = ScribeReplay.succeed(book, item, named);
            if (fact === null) {
                return;
            }
            book.fuller.set(named.id, fact.id);
            ScribeReplay.attach(book, fact.id, named.id);
            book.refinements.push({ from: named.id, to: fact.id });
            if (named.category === ScribeCategory.Settings.RelationCategory && named.target !== null) {
                book.stale.delete(JSON.stringify([named.subject, named.target]));
            }
            if (fact.status !== status.InForce || ScribeReplay.kindOf(fact.category) !== ScribeCategory.Kind.Fixed) {
                return;
            }
            const key = ScribeReplay.disputeKey(fact, book.wordings.get(fact.id));
            for (const disputed of book.disputes.get(key) ?? []) {
                if (disputed.status === status.Disputed) {
                    disputed.status = status.Replaced;
                    disputed.replacedBy = fact.id;
                    ScribeReplay.attach(book, fact.id, disputed.id);
                }
            }
            book.disputes.delete(key);
        },

        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        Change(book, item) {
            const operation = item.operation;
            const named = ScribeReplay.follow(book, operation.fact);
            if (!ScribeReplay.takes(book, operation, named)) {
                ScribeReplay.file(book, item, operation.becomes);
                return;
            }
            const fact = ScribeReplay.succeed(book, item, named);
            if (fact === null) {
                return;
            }
            if (ScribeReplay.kindOf(named.category) === ScribeCategory.Kind.Fixed) {
                ScribeReplay.unsay(book, named);
            }
            ScribeReplay.mark(book, fact, fact.position);
        },

        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        End(book, item) {
            const status = ScribeReplay.Status;
            const operation = item.operation;
            const fact = ScribeReplay.follow(book, operation.fact);
            if (!ScribeReplay.live(fact)) {
                return;
            }
            const kind = ScribeReplay.kindOf(fact.category);
            if (fact.status === status.InForce) {
                ScribeReplay.leave(book, fact, ScribeReplay.keys(fact, kind));
            }
            if (kind === ScribeCategory.Kind.Fixed) {
                ScribeReplay.unsay(book, fact);
            }
            fact.status = status.Ended;
            fact.ended = { reason: operation.reason, cite: operation.cite };
            ScribeReplay.mark(book, fact, item.position);
        },

        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        Told(book, item) {
            const operation = item.operation;
            const fact = book.byId.get(operation.fact);
            const subject = ScribeReplay.resolve(book, operation.subject);
            if (fact !== undefined && !fact.told.includes(subject)) {
                fact.told.push(subject);
            }
        },

        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        Night(book, item) {
            const status = ScribeReplay.Status;
            const operation = item.operation;
            if (book.nights.has(operation.cite)) {
                return;
            }
            book.nights.set(operation.cite, {
                cite: operation.cite,
                position: item.position,
                marker: operation.marker,
            });
            for (const fact of book.passing) {
                if (fact.status === status.InForce && fact.position < item.position) {
                    fact.status = status.Expired;
                    ScribeReplay.leave(book, fact, ScribeReplay.keys(fact, ScribeCategory.Kind.Passing));
                }
                if (fact.status !== status.InForce) {
                    book.passing.delete(fact);
                }
            }
        },

        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        Alias(book, item) {
            const operation = item.operation;
            const subject = ScribeReplay.resolve(book, operation.subject);
            const key = ScribeLog.aliasKey(subject, operation.name);
            if (book.unaliased.has(key)) {
                return;
            }
            if (operation.other !== null) {
                ScribeReplay.link(book, subject, ScribeReplay.resolve(book, operation.other));
            }
            ScribeReplay.mention(book, subject, operation.name, null);
            if (!book.aliased.has(key)) {
                book.aliased.add(key);
                book.aliases.push({ subject, name: operation.name, cite: operation.cite });
            }
        },

        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        AddFact(book, item) {
            const operation = item.operation;
            const target = operation.target;
            if (book.subjects.has(operation.subject) && (target === null || book.subjects.has(target))) {
                ScribeReplay.file(book, item, operation.fact);
            }
        },

        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        ThreadOpen(book, item) {
            const operation = item.operation;
            book.threads.set(operation.thread, {
                id: operation.thread,
                text: operation.text,
                cite: operation.cite,
                position: item.position,
                closed: null,
            });
        },

        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        ThreadClose(book, item) {
            book.closes.push(item.operation);
        },

        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        Question(book, item) {
            const operation = item.operation;
            book.questions.push({
                id: operation.question,
                text: operation.text,
                cite: operation.cite,
                position: item.position,
                answer: null,
                dismissed: false,
            });
        },
    }),

    Merging: Object.freeze({
        /**
         * @param {object} book
         * @param {object} operation
         * @return {void}
         */
        Merge(book, operation) {
            const known = book.subjects.has(operation.from) && book.subjects.has(operation.into);
            if (!known || book.merged.has(operation.from)) {
                return;
            }
            const into = ScribeReplay.resolve(book, operation.into);
            if (into !== operation.from) {
                book.merged.set(operation.from, into);
            }
        },
    }),

    Shaping: Object.freeze({
        /**
         * @param {object} book
         * @param {object} operation
         * @return {void}
         */
        Split(book, operation) {
            if (!book.subjects.has(operation.subject) || !book.subjects.has(operation.becomes)) {
                return;
            }
            for (const id of operation.facts) {
                book.split.set(id, operation.becomes);
            }
            book.distinct.add(ScribeReplay.pairKey(book, operation.subject, operation.becomes));
        },

        /**
         * @param {object} book
         * @param {object} operation
         * @return {void}
         */
        RemoveFact(book, operation) {
            book.removed.add(operation.fact);
            for (const key of ScribeReplay.markKeys(book, operation.mark)) {
                book.struck.add(key);
            }
        },

        /**
         * @param {object} book
         * @param {object} operation
         * @return {void}
         */
        Unalias(book, operation) {
            if (book.subjects.has(operation.subject)) {
                const subject = ScribeReplay.resolve(book, operation.subject);
                book.unaliased.add(ScribeLog.aliasKey(subject, operation.name));
                book.unaliasings.push({ subject, name: operation.name });
            }
        },

        /**
         * @param {object} book
         * @param {object} operation
         * @return {void}
         */
        Distinct(book, operation) {
            if (book.subjects.has(operation.first) && book.subjects.has(operation.second)) {
                book.distinct.add(ScribeReplay.pairKey(book, operation.first, operation.second));
                book.distinctions.push({
                    first: ScribeReplay.resolve(book, operation.first),
                    second: ScribeReplay.resolve(book, operation.second),
                });
            }
        },
    }),

    Pinning: Object.freeze({
        /**
         * @param {object} book
         * @param {object} operation
         * @return {void}
         */
        Pin(book, operation) {
            const status = ScribeReplay.Status;
            const slot = ScribeReplay.pinSlot(book, operation);
            if (slot === null || book.pins.get(slot) !== operation) {
                return;
            }
            const held = book.held.get(slot) ?? [];
            const candidates = new Set();
            for (const fact of held) {
                const standing = ScribeReplay.follow(book, fact.id);
                if (ScribeCategory.same(fact.text, operation.text) && ScribeReplay.live(standing)) {
                    candidates.add(standing);
                }
            }
            const preferred = operation.winner === null ? undefined : ScribeReplay.follow(book, operation.winner);
            let winner = candidates.has(preferred) ? preferred : candidates.values().next().value;
            if (winner === undefined) {
                const told = [];
                for (const id of operation.told) {
                    const subject = ScribeReplay.resolve(book, id);
                    if (!told.includes(subject)) {
                        told.push(subject);
                    }
                }
                const located = operation.origin !== undefined;
                winner = {
                    id: operation.fact,
                    subject: ScribeReplay.resolve(book, operation.subject),
                    category: operation.category,
                    target: null,
                    targetText: null,
                    text: operation.text,
                    cite: located ? operation.cite : null,
                    position: located
                        ? (book.positions.get(operation.cite) ?? operation.position)
                        : ScribeReplay.Settings.PinnedPosition,
                    origin: located ? operation.origin : ScribeLog.Origin.Operator,
                    hidden: operation.hidden,
                    told,
                    widened: null,
                    status: null,
                    replacedBy: null,
                    ended: null,
                    pinned: false,
                    made: true,
                };
                if (ScribeReplay.erase(book, winner)) {
                    return;
                }
                ScribeReplay.keep(book, winner);
            }
            for (const fact of held) {
                if (fact !== winner && fact.status === status.InForce) {
                    ScribeReplay.leave(book, fact, [slot]);
                    fact.status = status.Disputed;
                }
            }
            if (winner.status !== status.InForce) {
                winner.status = status.InForce;
                ScribeReplay.enter(book, winner, [slot]);
            }
            winner.pinned = true;
            book.pinned.add(slot);
        },
    }),

    Finishing: Object.freeze({
        /**
         * @param {object} book
         * @param {object} operation
         * @param {number} order
         * @return {void}
         */
        Widen(book, operation, order) {
            const known =
                operation.to === ScribeLog.Settings.Everyone ||
                operation.to.every(
                    /**
                     * @param {string} id
                     * @return {boolean}
                     */
                    (id) => book.subjects.has(id),
                );
            if (!known) {
                return;
            }
            const ruling = { order, operation };
            book.widenings.set(operation.fact, ruling);
            for (const key of ScribeReplay.markKeys(book, operation.mark)) {
                book.widenedMarks.set(key, ruling);
            }
        },

        /**
         * @param {object} book
         * @param {object} operation
         * @return {void}
         */
        Narrow(book, operation) {
            const scene = book.scenes.get(operation.scene);
            if (scene !== undefined) {
                scene.narrowed = true;
            }
        },

        /**
         * @param {object} book
         * @param {object} operation
         * @param {number} order
         * @return {void}
         */
        Answer(book, operation, order) {
            const ruling = { order, text: operation.text };
            book.answers.set(operation.question, ruling);
            book.answeredTexts.set(ScribeReplay.wording(operation.questionText), ruling);
        },

        /**
         * @param {object} book
         * @param {object} operation
         * @param {number} order
         * @return {void}
         */
        Dismiss(book, operation, order) {
            const ruling = { order };
            book.dismissals.set(operation.question, ruling);
            book.dismissedTexts.set(ScribeReplay.wording(operation.questionText), ruling);
        },
    }),

    /**
     * @param {*} value
     * @return {*}
     */
    seal(value) {
        if (value !== null && typeof value === 'object') {
            for (const child of Object.values(value)) {
                ScribeReplay.seal(child);
            }
            Object.freeze(value);
        }
        return value;
    },

    /**
     * @param {object} log
     * @param {string[]} order
     * @return {Readonly<{ revision: number, subjects: readonly object[], facts: readonly object[], scenes: readonly object[], nights: readonly object[], threads: readonly object[], conflicts: readonly object[], lookAlikes: readonly object[], stale: readonly object[], refinements: readonly object[], aliases: readonly object[], questions: readonly object[], unaliased: readonly object[], distinct: readonly object[] }>}
     */
    run(log, order) {
        const settings = ScribeReplay.Settings;
        const status = ScribeReplay.Status;
        const likeness = ScribeReplay.Likeness;
        const types = ScribeAnswer.Type;
        const rulingTypes = ScribeLog.Ruling;
        const positions = new Map();
        for (const [index, id] of order.entries()) {
            positions.set(id, index + 1);
        }
        const book = {
            positions,
            subjects: new Map(),
            facts: [],
            byId: new Map(),
            inForce: new Map(),
            said: new Map(),
            wordings: new Map(),
            behind: new Map(),
            fuller: new Map(),
            passing: new Set(),
            disputes: new Map(),
            stale: new Map(),
            refinements: [],
            mentions: new Map(),
            aliases: [],
            aliased: new Set(),
            pairs: new Map(),
            threads: new Map(),
            closes: [],
            questions: [],
            nights: new Map(),
            scenes: new Map(),
            merged: new Map(),
            split: new Map(),
            removed: new Set(),
            struck: new Set(),
            unaliased: new Set(),
            unaliasings: [],
            distinct: new Set(),
            distinctions: [],
            pins: new Map(),
            held: new Map(),
            pinned: new Set(),
            widenings: new Map(),
            widenedMarks: new Map(),
            answers: new Map(),
            answeredTexts: new Map(),
            dismissals: new Map(),
            dismissedTexts: new Map(),
        };
        const counted = [];
        const showings = [];
        const rulings = [];
        for (const entry of log.entries) {
            const ruled = entry.kind === ScribeLog.Kind.Operator;
            for (const [index, operation] of entry.operations.entries()) {
                if (operation.type === types.Subject) {
                    const declared = book.subjects.get(operation.subject) ?? { label: operation.label, kind: null };
                    if (!entry.withdrawn && declared.kind === null) {
                        declared.kind = operation.kind;
                    }
                    book.subjects.set(operation.subject, declared);
                    continue;
                }
                const ruling = Object.hasOwn(rulingTypes, operation.type);
                const splitting =
                    ruled &&
                    operation.type === rulingTypes.Split &&
                    book.subjects.has(operation.subject) &&
                    !book.subjects.has(operation.becomes);
                if (splitting) {
                    book.subjects.set(operation.becomes, { label: operation.label, kind: operation.kind });
                }
                if (entry.withdrawn || (ruling && !ruled)) {
                    continue;
                }
                if (operation.type === rulingTypes.AddFact) {
                    const position = positions.get(operation.cite) ?? operation.position;
                    counted.push({ operation, position, ruled, sequence: entry.sequence, index, origin: entry.origin });
                    continue;
                }
                if (ruling) {
                    rulings.push(operation);
                    continue;
                }
                if (operation.type === types.Scene) {
                    const firstFound = positions.get(operation.first);
                    const lastFound = positions.get(operation.last);
                    const whole = firstFound !== undefined && lastFound !== undefined;
                    const firstPosition = whole ? firstFound : operation.firstPosition;
                    const lastPosition = whole ? lastFound : operation.lastPosition;
                    if (firstPosition !== undefined && lastPosition !== undefined) {
                        showings.push({ operation, firstPosition, lastPosition, sequence: entry.sequence, index });
                    }
                    continue;
                }
                if (!Object.hasOwn(ScribeReplay.Handlers, operation.type)) {
                    continue;
                }
                let position = positions.get(operation.cite);
                if (position === undefined && entry.origin === ScribeLog.Origin.Notes) {
                    position = operation.position;
                }
                if (position !== undefined) {
                    counted.push({ operation, position, ruled, sequence: entry.sequence, index, origin: entry.origin });
                }
            }
        }
        ScribeReplay.apply(book, rulings, ScribeReplay.Merging);
        ScribeReplay.apply(book, rulings, ScribeReplay.Shaping);
        counted.sort(
            /**
             * @param {{ position: number, ruled: boolean, sequence: number, index: number }} first
             * @param {{ position: number, ruled: boolean, sequence: number, index: number }} second
             * @return {number}
             */
            (first, second) =>
                first.position - second.position ||
                Number(first.ruled) - Number(second.ruled) ||
                first.sequence - second.sequence ||
                first.index - second.index,
        );
        for (const item of counted) {
            ScribeReplay.Handlers[item.operation.type](book, item);
        }
        for (const operation of book.closes) {
            const thread = book.threads.get(operation.thread);
            if (thread !== undefined && thread.closed === null) {
                thread.closed = { how: operation.how, cite: operation.cite };
            }
        }
        for (const operation of rulings) {
            const slot = operation.type === rulingTypes.Pin ? ScribeReplay.pinSlot(book, operation) : null;
            if (slot !== null) {
                book.pins.set(slot, operation);
            }
        }
        for (const fact of book.facts) {
            const [slot] = ScribeReplay.keys(fact, ScribeCategory.Kind.Fixed);
            if (book.pins.has(slot) && fact.status !== status.Removed) {
                const held = book.held.get(slot) ?? [];
                held.push(fact);
                book.held.set(slot, held);
            }
        }
        ScribeReplay.apply(book, rulings, ScribeReplay.Pinning);
        showings.sort(
            /**
             * @param {{ lastPosition: number, sequence: number, index: number }} first
             * @param {{ lastPosition: number, sequence: number, index: number }} second
             * @return {number}
             */
            (first, second) =>
                first.lastPosition - second.lastPosition ||
                first.sequence - second.sequence ||
                first.index - second.index,
        );
        for (const showing of showings) {
            const operation = showing.operation;
            const replaced = book.scenes.get(operation.first);
            const present = [];
            for (const attendee of replaced === undefined ? [] : replaced.present) {
                present.push({
                    subject: attendee.subject,
                    from: attendee.from,
                    until: Math.min(attendee.until ?? replaced.lastPosition, replaced.lastPosition),
                });
            }
            const kept = present.length;
            for (const attendee of operation.present) {
                const subject = ScribeReplay.resolve(book, attendee.subject);
                if (replaced === undefined) {
                    present.push({ subject, from: attendee.from, until: attendee.until });
                    continue;
                }
                const floor = replaced.lastPosition + 1;
                const from = Math.max(attendee.from ?? showing.firstPosition, floor);
                if (from > (attendee.until ?? showing.lastPosition)) {
                    continue;
                }
                const joined =
                    from === floor
                        ? present.find(
                              /**
                               * @param {{ subject: string, from: number|null, until: number|null }} entry
                               * @return {boolean}
                               */
                              (entry) => entry.subject === subject && entry.until === replaced.lastPosition,
                          )
                        : undefined;
                if (joined === undefined) {
                    present.push({ subject, from, until: attendee.until });
                } else {
                    joined.until = attendee.until;
                }
            }
            for (const entry of present.slice(0, kept)) {
                if (entry.from === showing.firstPosition) {
                    entry.from = null;
                }
                if (entry.until !== null && entry.until >= showing.lastPosition) {
                    entry.until = null;
                }
            }
            const wasPrivate = replaced !== undefined && replaced.reach === ScribeAnswer.Reach.Private;
            book.scenes.set(operation.first, {
                id: operation.first,
                day: operation.day,
                first: operation.first,
                last: operation.last,
                firstPosition: showing.firstPosition,
                lastPosition: showing.lastPosition,
                place: operation.place,
                reach: wasPrivate ? replaced.reach : operation.reach,
                narrowed: false,
                present,
                summary: operation.summary,
            });
        }
        const scenes = [...book.scenes.values()].sort(
            /**
             * @param {{ firstPosition: number, lastPosition: number }} first
             * @param {{ firstPosition: number, lastPosition: number }} second
             * @return {number}
             */
            (first, second) => first.firstPosition - second.firstPosition || first.lastPosition - second.lastPosition,
        );
        ScribeReplay.apply(book, rulings, ScribeReplay.Finishing);
        for (const fact of book.facts) {
            if (book.widenings.size === 0 || fact.status === status.Removed) {
                continue;
            }
            const keys = ScribeReplay.statementKeys(fact);
            const ruling = ScribeReplay.latest(book.widenedMarks, keys, book.widenings.get(fact.id));
            if (ruling === undefined) {
                continue;
            }
            if (ruling.operation.to === ScribeLog.Settings.Everyone) {
                fact.widened = ruling.operation.to;
                continue;
            }
            const widened = [];
            for (const id of ruling.operation.to) {
                const subject = ScribeReplay.resolve(book, id);
                if (!widened.includes(subject)) {
                    widened.push(subject);
                }
            }
            fact.widened = widened;
        }
        for (const question of book.questions) {
            const wording = ScribeReplay.wording(question.text);
            const answered = ScribeReplay.latest(book.answeredTexts, [wording], book.answers.get(question.id));
            const dismissed = ScribeReplay.latest(book.dismissedTexts, [wording], book.dismissals.get(question.id));
            if (answered !== undefined) {
                question.answer = answered.text;
            }
            question.dismissed = dismissed !== undefined && (answered === undefined || dismissed.order > answered.order);
        }
        const members = new Map();
        for (const id of book.subjects.keys()) {
            const root = ScribeReplay.resolve(book, id);
            if (root !== id) {
                const merged = members.get(root) ?? [];
                merged.push(id);
                members.set(root, merged);
            }
        }
        const kinds = Object.values(ScribeCategory.SubjectKinds);
        const subjects = [];
        const survivors = [];
        const names = [];
        const lengths = [];
        for (const [id, declared] of book.subjects) {
            const name = ScribeLog.name(declared.label);
            const seen = new Set([ScribeText.normaliseName(declared.label), ScribeText.normaliseName(name)]);
            const offered = [];
            for (const mention of book.mentions.get(id) ?? []) {
                const live =
                    mention.fact === null ||
                    mention.fact.status === status.InForce ||
                    mention.fact.status === status.Replaced;
                if (live) {
                    offered.push(mention.text);
                }
            }
            for (const member of members.get(id) ?? []) {
                const label = book.subjects.get(member).label;
                offered.push(label, ScribeLog.name(label));
            }
            const aka = [];
            for (const text of offered) {
                const key = ScribeText.normaliseName(text);
                if (key !== settings.Nothing && !seen.has(key)) {
                    seen.add(key);
                    aka.push(text);
                }
            }
            const assumed = declared.kind === null;
            let kind = assumed ? ScribeCategory.SubjectKinds.Character : declared.kind;
            for (const fact of book.inForce.get(JSON.stringify([id, settings.KindCategory])) ?? []) {
                const stated = fact.text.trim().toLowerCase();
                if (assumed && kinds.includes(stated)) {
                    kind = stated;
                }
            }
            const root = ScribeReplay.resolve(book, id);
            const subject = {
                id,
                label: declared.label,
                name,
                kind,
                assumed,
                aka,
                mergedInto: root === id ? null : root,
            };
            subjects.push(subject);
            if (root === id) {
                const normal = ScribeText.normaliseName(name);
                survivors.push(subject);
                names.push(normal);
                lengths.push(Array.from(normal).length);
            }
        }
        const limit = Math.max(ScribeText.Settings.ShortNameDistance, ScribeText.Settings.LongNameDistance);
        const lookAlikes = [];
        for (let later = 0; later < survivors.length; later++) {
            const second = survivors[later];
            const partners = book.pairs.get(second.id);
            for (let earlier = 0; earlier < later; earlier++) {
                const first = survivors[earlier];
                const gap = lengths[later] - lengths[earlier];
                let reason = null;
                if (names[earlier] === names[later]) {
                    reason = likeness.SameName;
                } else if (partners !== undefined && partners.has(first.id)) {
                    reason = likeness.Alias;
                } else if (gap <= limit && gap >= -limit && ScribeText.resembles(first.name, second.name)) {
                    reason = likeness.Spelling;
                }
                if (reason !== null && !book.distinct.has(ScribeReplay.pairKey(book, first.id, second.id))) {
                    lookAlikes.push({ first: first.id, second: second.id, reason });
                }
            }
        }
        const stale = [];
        for (const mark of book.stale.values()) {
            const holders = book.inForce.get(ScribeReplay.targetKey(mark.subject, mark.target));
            if (holders !== undefined && holders.size > 0) {
                stale.push(mark);
            }
        }
        const conflicts = new Map();
        for (const fact of book.facts) {
            if (fact.status !== status.Disputed) {
                continue;
            }
            const [slot] = ScribeReplay.keys(fact, ScribeCategory.Kind.Fixed);
            if (book.pinned.has(slot)) {
                continue;
            }
            if (!conflicts.has(slot)) {
                const [holder] = book.inForce.get(slot);
                conflicts.set(slot, {
                    subject: fact.subject,
                    category: fact.category,
                    target: null,
                    established: holder === undefined ? null : holder.id,
                    others: [],
                });
            }
            conflicts.get(slot).others.push(fact.id);
        }
        return ScribeReplay.seal({
            revision: log.revision,
            subjects,
            facts: book.facts,
            scenes,
            nights: [...book.nights.values()],
            threads: [...book.threads.values()],
            conflicts: [...conflicts.values()],
            lookAlikes,
            stale,
            refinements: book.refinements,
            aliases: book.aliases,
            questions: book.questions,
            unaliased: book.unaliasings,
            distinct: book.distinctions,
        });
    },
});
/** @file scribe/core/ScribeKnowledge.js */
const ScribeKnowledge = Object.freeze({
    Cover: Object.freeze({
        None: 'None',
        Open: 'Open',
        Closed: 'Closed',
    }),

    Layer: Object.freeze({
        Scene: 'Scene',
        Closed: 'Closed',
        Absent: 'Absent',
    }),

    Settings: Object.freeze({
        Opening: 1,
        Closing: -1,
    }),

    /**
     * @return {string}
     */
    get Everyone() {
        return ScribeLog.Settings.Everyone;
    },

    /**
     * @param {{ reach: string, narrowed: boolean }} scene
     * @return {boolean}
     */
    open(scene) {
        return scene.reach === ScribeAnswer.Reach.Public && !scene.narrowed;
    },

    /**
     * @param {{ from: number|null, until: number|null }} entry
     * @param {number} position
     * @return {boolean}
     */
    within(entry, position) {
        return (entry.from === null || entry.from <= position) && (entry.until === null || entry.until >= position);
    },

    /**
     * @param {readonly object[]} scenes
     * @return {object|null}
     */
    narrowest(scenes) {
        let found = null;
        for (const scene of scenes) {
            const span = scene.lastPosition - scene.firstPosition;
            const shorter = found === null || span < found.lastPosition - found.firstPosition;
            const tied = found !== null && span === found.lastPosition - found.firstPosition;
            if (shorter || (tied && scene.firstPosition > found.firstPosition)) {
                found = scene;
            }
        }
        return found;
    },

    /**
     * @param {object} state
     * @param {number} position
     * @return {{ closed: object[], open: object[] }}
     */
    covering(state, position) {
        const closed = [];
        const open = [];
        for (const scene of state.scenes) {
            if (scene.firstPosition > position || position > scene.lastPosition) {
                continue;
            }
            if (ScribeKnowledge.open(scene)) {
                open.push(scene);
            } else {
                closed.push(scene);
            }
        }
        return { closed, open };
    },

    /**
     * @param {object} state
     * @param {string} id
     * @return {string}
     */
    survivor(state, id) {
        const subject = state.subjects.find(
            /**
             * @param {{ id: string }} candidate
             * @return {boolean}
             */
            (candidate) => candidate.id === id,
        );
        return subject === undefined || subject.mergedInto === null ? id : subject.mergedInto;
    },

    /**
     * @param {object} fact
     * @param {string} cover
     * @param {readonly string[]} there
     * @return {string|readonly string[]}
     */
    listeners(fact, cover, there) {
        const everyone = ScribeKnowledge.Everyone;
        const origins = ScribeLog.Origin;
        if (fact.widened === everyone) {
            return everyone;
        }
        const noted = fact.origin === origins.Notes || fact.origin === origins.Operator;
        if (!fact.hidden && (noted || cover === ScribeKnowledge.Cover.Open)) {
            return everyone;
        }
        const named = new Set([fact.subject]);
        if (!fact.hidden && cover === ScribeKnowledge.Cover.Closed) {
            for (const id of there) {
                named.add(id);
            }
        }
        for (const id of fact.told) {
            named.add(id);
        }
        if (fact.widened !== null) {
            for (const id of fact.widened) {
                named.add(id);
            }
        }
        return Object.freeze([...named]);
    },

    /**
     * @param {string|readonly string[]} audience
     * @param {string} knower
     * @return {boolean}
     */
    heard(audience, knower) {
        return audience === ScribeKnowledge.Everyone || audience.includes(knower);
    },

    /**
     * @param {object} state
     * @param {number} position
     * @return {object|null}
     */
    sceneAt(state, position) {
        const { closed, open } = ScribeKnowledge.covering(state, position);
        return ScribeKnowledge.narrowest(closed.length > 0 ? closed : open);
    },

    /**
     * @param {object} state
     * @param {object} fact
     * @return {string|readonly string[]}
     */
    audience(state, fact) {
        const cover = ScribeKnowledge.Cover;
        const { closed, open } = ScribeKnowledge.covering(state, fact.position);
        if (closed.length === 0) {
            return ScribeKnowledge.listeners(fact, open.length > 0 ? cover.Open : cover.None, []);
        }
        const there = [];
        for (const attendee of ScribeKnowledge.narrowest(closed).present) {
            const everywhere = closed.every(
                /**
                 * @param {object} scene
                 * @return {boolean}
                 */
                (scene) =>
                    scene.present.some(
                        /**
                         * @param {{ subject: string, from: number|null, until: number|null }} entry
                         * @return {boolean}
                         */
                        (entry) => entry.subject === attendee.subject && ScribeKnowledge.within(entry, fact.position),
                    ),
            );
            if (ScribeKnowledge.within(attendee, fact.position) && everywhere) {
                there.push(attendee.subject);
            }
        }
        return ScribeKnowledge.listeners(fact, cover.Closed, there);
    },

    /**
     * @param {object} state
     * @param {string} knower
     * @param {object} fact
     * @return {boolean}
     */
    knows(state, knower, fact) {
        return ScribeKnowledge.heard(ScribeKnowledge.audience(state, fact), ScribeKnowledge.survivor(state, knower));
    },

    /**
     * @param {object} state
     * @param {string} knower
     * @param {string} subject
     * @return {Readonly<{ facts: readonly object[], scenes: readonly object[] }>}
     */
    about(state, knower, subject) {
        const layers = ScribeKnowledge.Layer;
        const cover = ScribeKnowledge.Cover;
        const settings = ScribeKnowledge.Settings;
        const reader = ScribeKnowledge.survivor(state, knower);
        const owner = ScribeKnowledge.survivor(state, subject);
        const byId = new Map();
        for (const fact of state.facts) {
            byId.set(fact.id, fact);
        }
        const thinner = new Map();
        for (const refinement of state.refinements) {
            thinner.set(refinement.to, byId.get(refinement.from));
        }
        const chains = [];
        const positions = new Set();
        for (const fact of state.facts) {
            if (fact.subject !== owner || fact.status !== ScribeReplay.Status.InForce) {
                continue;
            }
            const chain = [];
            for (let wording = fact; wording !== undefined; wording = thinner.get(wording.id)) {
                chain.push(wording);
                positions.add(wording.position);
            }
            chains.push(chain);
        }
        const stretches = [];
        const attended = [];
        for (const scene of state.scenes) {
            const spans = [];
            let listed = false;
            for (const attendee of scene.present) {
                const start = Math.max(attendee.from ?? scene.firstPosition, scene.firstPosition);
                const end = Math.min(attendee.until ?? scene.lastPosition, scene.lastPosition);
                listed = listed || attendee.subject === owner;
                if (attendee.subject === reader && start <= end) {
                    spans.push({ start, end });
                }
            }
            spans.sort(
                /**
                 * @param {{ start: number }} first
                 * @param {{ start: number }} second
                 * @return {number}
                 */
                (first, second) => first.start - second.start,
            );
            const missing = [];
            let reached = scene.firstPosition;
            for (const span of spans) {
                if (span.start > reached) {
                    missing.push({ start: reached, end: span.start - 1 });
                }
                reached = Math.max(reached, span.end + 1);
            }
            if (reached <= scene.lastPosition) {
                missing.push({ start: reached, end: scene.lastPosition });
            }
            const open = ScribeKnowledge.open(scene);
            stretches.push({ start: scene.firstPosition, end: scene.lastPosition, layer: layers.Scene });
            if (!open) {
                stretches.push({ start: scene.firstPosition, end: scene.lastPosition, layer: layers.Closed });
                for (const gap of missing) {
                    stretches.push({ start: gap.start, end: gap.end, layer: layers.Absent });
                }
            }
            if (listed && (open || missing.length === 0)) {
                attended.push(scene);
            }
        }
        const events = [];
        for (const stretch of stretches) {
            events.push(
                { at: stretch.start, layer: stretch.layer, step: settings.Opening },
                { at: stretch.end + 1, layer: stretch.layer, step: settings.Closing },
            );
        }
        events.sort(
            /**
             * @param {{ at: number }} first
             * @param {{ at: number }} second
             * @return {number}
             */
            (first, second) => first.at - second.at,
        );
        const sorted = [...positions].sort(
            /**
             * @param {number} first
             * @param {number} second
             * @return {number}
             */
            (first, second) => first - second,
        );
        const depth = { [layers.Scene]: 0, [layers.Closed]: 0, [layers.Absent]: 0 };
        const places = new Map();
        let pointer = 0;
        for (const position of sorted) {
            while (pointer < events.length && events[pointer].at <= position) {
                depth[events[pointer].layer] += events[pointer].step;
                pointer++;
            }
            let covered = cover.None;
            if (depth[layers.Closed] > 0) {
                covered = cover.Closed;
            } else if (depth[layers.Scene] > 0) {
                covered = cover.Open;
            }
            places.set(position, { cover: covered, there: depth[layers.Absent] === 0 ? [reader] : [] });
        }
        const facts = [];
        for (const chain of chains) {
            const known = chain.find(
                /**
                 * @param {object} wording
                 * @return {boolean}
                 */
                (wording) => {
                    const place = places.get(wording.position);
                    return ScribeKnowledge.heard(ScribeKnowledge.listeners(wording, place.cover, place.there), reader);
                },
            );
            if (known !== undefined) {
                facts.push(known);
            }
        }
        return Object.freeze({ facts: Object.freeze(facts), scenes: Object.freeze(attended) });
    },
});
/** @file scribe/core/ScribeAnalyzer.js */
const ScribeAnalyzer = Object.freeze({
    Settings: Object.freeze({
        Newline: '\n',
        BlankLine: '\n\n',
        Nothing: '',
        Space: ' ',
        None: '(none)',
        NoFacts: '(no facts yet)',
        Nobody: 'nobody',
        Headings: Object.freeze({
            Player: 'PLAYER CHARACTER:',
            Subjects: 'SUBJECTS:',
            Ledger: 'LEDGER:',
            Scenes: 'LAST SCENES:',
            Nights: 'NIGHTS:',
            Threads: 'OPEN THREADS:',
            Notes: 'PLAYER NOTES:',
            Answers: 'ANSWERED QUESTIONS:',
        }),
        MessagesOpen: 'NEW MESSAGES (#',
        MessagesTo: ' to #',
        MessagesClose: '):',
        ListMarker: '- ',
        SubjectMarker: '## ',
        Opening: ' (',
        Closing: ')',
        AkaOpen: '; aka ',
        Comma: ', ',
        Colon: ': ',
        RelationTo: 'relation to ',
        CiteOpen: ' (#',
        Owner: ' (owner)',
        Pinned: ' pinned',
        Hidden: ' hidden',
        Stale: ' (check: the other side has changed)',
        Joiner: ' | ',
        Day: 'Day ',
        Hash: '#',
        Span: '-#',
        Present: 'present: ',
        From: 'from #',
        Until: 'until #',
        NumberOpen: '[#',
        NumberClose: '] ',
        AnswerMarker: ' ANSWER: ',
        NormalForm: 'NFC',
        Apostrophe: "'",
        CommonWords: Object.freeze(['the', 'and', 'of']),
        ShortestAka: 3,
        ShortestWord: 3,
        CasedWord: 2,
        ShownScenes: 3,
        ShownNights: 3,
        NoSceneBefore: 1,
        NoLimit: Number.POSITIVE_INFINITY,
        BoundaryWidth: 2,
        Last: -1,

        /**
         * @return {RegExp}
         */
        get Apostrophes() {
            return /[’‘ʼ]/gu;
        },

        /**
         * @return {RegExp}
         */
        get Whitespace() {
            return /\s+/gu;
        },

        /**
         * @return {RegExp}
         */
        get Word() {
            return /[\p{L}\p{M}\p{N}]+/gu;
        },

        /**
         * @return {RegExp}
         */
        get WordBefore() {
            return /[\p{L}\p{M}\p{N}]$/u;
        },

        /**
         * @return {RegExp}
         */
        get WordAfter() {
            return /^[\p{L}\p{M}\p{N}]/u;
        },

        PromptLines: Object.freeze([
            'You are the Analyzer: keeper of the campaign book for an ongoing adult fiction roleplay between consenting adult characters.',
            'You never write story. After each stretch of play you add what is new to the book.',
            'Record intimate, profane and violent facts plainly; never soften, omit or judge. Never invent.',
            "Messages are numbered [#n]. Lines marked (player) are spoken or done by the player's character.",
            '"Narrator" is the storyteller\'s narration, not a character.',
            '',
            'The book is a list of single facts. Each has an id like F12, a subject, a category, a statement and the message number that established it. You never rewrite the book. You only add facts, and say when the story has changed or ended one.',
            '',
            'You receive PLAYER CHARACTER, SUBJECTS (everyone and everything that has an entry), LEDGER (the facts now in force for the subjects named in the new messages), LAST SCENES, NIGHTS, OPEN THREADS and the NEW MESSAGES.',
            'In the LEDGER each fact ends with (#n), the message that established it, or (owner) when the player added it by hand. After that it may be marked pinned, hidden, or (check: the other side has changed).',
            '',
            'Answer with these blocks, in this order, each starting with its === line. Leave a block out if it has nothing. Write nothing else: no headings, no remarks, no notes inside or between blocks.',
            '',
            '=== SUBJECTS',
            'Label | kind',
            '=== NAMES',
            'Name as the story writes it | Label of the known subject | #n',
            '=== FACTS',
            'Label | category | statement | #n',
            'Label | category | statement | hidden | #n',
            '=== CHANGES',
            'F12 | Label | category | the new statement | #n',
            'F12 | Label | category | FULLER: the same fact with more detail | #n',
            'F45 | Label | category | ENDED: why it is no longer true | #n',
            '=== TOLD',
            'F12 | Label of the subject the fact is about | Label of the one who was told | #n',
            '=== SCENES',
            'Day N | #first-#last | Place | public or private | present: Label, Label (from #n), Label (until #n) | what happened',
            '=== NIGHTS',
            '#n | what marks the night or the time skip',
            '=== THREADS',
            'OPEN | something left hanging | #n',
            'CLOSE T3 | how it resolved | #n',
            '=== QUESTIONS',
            'A question for the player | #n',
            '',
            'Categories. Use exactly these words.',
            'One value at a time:',
            '  kind (character, group, place, item or world), age (a plain number whenever the story gives one), eyes, hair (colour and usual style), build (height and body shape), skin, status (alive, dead or missing), location (where they live or are staying), role (what they are or do for a living), relation to <Label> (where they stand with that person: lovers, rivals, friends, enemies, family; one short sentence, not what they last did to each other)',
            'Any number of values:',
            '  aka (a full name, another name or a nickname they go by)',
            '  title (a rank or honour they hold)',
            '  appearance (permanent looks only: scars, tattoos, piercings, birthmarks, the way they habitually dress)',
            '  ability (a skill or power they have, or a limit on one)',
            '  belonging (something they own and keep)',
            '  background (their life before the story began)',
            '  trait (a lasting habit, taste, fear or preference: shown more than once, or stated as how they always are)',
            '  condition (a passing state that will be gone in days: bruises, soreness, a wound that will heal, what they are wearing right now, drunk, exhausted, a mood)',
            '  feature (of a place or item), rule (how the world works; the subject is the world)',
            '',
            'What is a fact and what is not. Before adding a line ask: if nothing new happens, is this still true a month from now?',
            'Yes: it is a fact. No, it will fade: it is a condition. It is something that happened: it goes in SCENES only.',
            'Right:',
            '  Mirelle | hair | black, worn in a long braid | #46',
            '  Mirelle | build | short and broad-shouldered | #41',
            '  Isolde | appearance | always wears a green travelling cloak | #24',
            '  Mirelle | condition | a split lip from the brawl | #78',
            "  Mirelle | condition | wearing a borrowed guard's coat | #12",
            '  Halvard | background | deserted at the siege | hidden | #20',
            'Wrong, and why:',
            '  Mirelle | appearance | flushed cheeks, hair in disarray      (passing: condition)',
            '  Isolde | appearance | her cloak slips from one shoulder       (one moment: not a fact at all)',
            '  Mirelle | trait | tells Halvard to turn down the post         (one reaction: SCENES)',
            '  Halvard | relation to Kira | she slapped him                  (an event: SCENES)',
            '',
            'Rules.',
            '1. One fact per line, one detail per fact, under 25 words. Every FACTS, NAMES, CHANGES, TOLD, THREADS and QUESTIONS line ends with exactly one message number: the message that established it. A SUBJECTS line has no number. A SCENES line has only its range. A NIGHTS line starts with its number.',
            '2. Facts are what stays true: what a storyteller must know to keep this person consistent next month. Things that happened (a kiss, a fight, a walk, a talk) go in SCENES, never in FACTS. An event produces a fact only through what it leaves behind: a title, a belonging, a scar, a changed relation.',
            '3. Read the LEDGER before adding. Never repeat what it holds, even in other words.',
            "4. Subjects. Use a label from SUBJECTS exactly. For someone or something new, add a SUBJECTS line first; its kind is exactly one of character, group, place, item, world. If a new person has the same name as an existing subject, give them a label with a short distinguishing note in brackets, such as Oswin (Tamsin's uncle). A label never contains # or a comma. Give an entry to every named character who speaks or acts and to named places that are used. Unnamed passers-by get none.",
            "5. NAMES. When the story writes a known subject's name another way (a misspelling, a nickname, a first name alone, a full name used for the first time), do not make a new subject: write a NAMES line the first time, then use the known label.",
            '6. Fixed attributes (kind, age, eyes, hair, build, skin). When the new messages state one that the LEDGER already holds for that subject: if it means the same (another spelling, a synonym, the same age said another way) write nothing; if it adds detail to the same thing write a FULLER line in CHANGES; if it contradicts the LEDGER and the story gives no reason, write it as a plain FACTS line and the player will be asked to rule. Never decide who is right.',
            "7. CHANGES is for what the story itself changes or ends: someone is promoted, scarred for good, loses a belonging, breaks a habit. Give the id from the LEDGER, then the subject's label and the category exactly as the LEDGER shows them. For status, location, role and relation you need no id: add the new fact in FACTS and it replaces the old one; write hidden on it when it is still a secret.",
            "8. hidden. Mark a fact hidden when it is the subject's own thought, or something the subject conceals from everyone present. What a character learns, is told or is shown in a scene is not hidden: the scene's list of who was present decides who knows it. Something the narrator states that even its subject does not know is filed, hidden, under the one who does know it, or under the world when nobody does. Write a TOLD line when the new messages show a character being told or shown a fact the LEDGER marks hidden. One TOLD line per person. A FULLER line keeps the hidden mark of the fact it extends; when the added detail is more secret than the fact, write it as a separate hidden fact instead.",
            '9. A relation marked (check: the other side has changed) must be restated in FACTS as it stands now, hidden if it is marked hidden.',
            "10. A fact marked pinned is the player's ruling. Write nothing that changes, ends, extends or contradicts it. A TOLD line on it is still written.",
            "11. SCENES: one line per scene in the new messages, in order, at most four, each summary under 35 words, naming every death, fight, first, revelation, deal and promise. A scene is a stretch in one place with one main thing going on. If the first new messages continue the last scene shown in LAST SCENES, repeat that scene's line with the same first number and the new last number. public means bystanders could see or hear; private means only those listed. List everyone present, separated by commas only. Add (from #n) for someone who arrived after the scene began, (until #n) for someone who left before it ended, (from #a until #b) for both; someone who left and came back is listed twice. Continue the day count from LAST SCENES. A night belongs to the day it ends.",
            '12. NIGHTS: only nights slept through and stated time skips. Conditions need no tidying: they expire at the next night by themselves.',
            '13. THREADS: something left hanging that the story could pick up later: a threat, a promise, a plan, a mystery, someone due back. A fact, a feeling or something already finished is not a thread. At most two new threads per stretch. Never repeat the open list.',
            '14. QUESTIONS. When the story leaves something unclear and a guess would matter (does she like him or love him; is this the same man as before), write no fact for it. Ask the player one short question instead. At most two questions per stretch.',
        ]),

        NotesPromptLines: Object.freeze([
            'You are the Analyzer: keeper of the campaign book for an ongoing adult fiction roleplay between consenting adult characters.',
            'You never write story. Record intimate, profane and violent facts plainly; never soften, omit or judge. Never invent.',
            '',
            'The PLAYER NOTES below were written by the player. They are true and they outrank the story. Each line is numbered [#n].',
            'File what they say in the book. You receive PLAYER CHARACTER, SUBJECTS (everyone and everything that has an entry), LEDGER (the facts now in force for the subjects the notes name) and the PLAYER NOTES.',
            'In the LEDGER each fact ends with (#n) or (owner), and may then be marked pinned or hidden.',
            '',
            'Answer with these blocks, in this order, each starting with its === line. Leave a block out if it has nothing. Write nothing else.',
            '',
            '=== SUBJECTS',
            'Label | kind',
            '=== NAMES',
            'Name as the notes write it | Label of the known subject | #n',
            '=== FACTS',
            'Label | category | statement | #n',
            'Label | category | statement | hidden | #n',
            '=== CHANGES',
            'F12 | Label | category | the new statement | #n',
            'F12 | Label | category | FULLER: the same fact with more detail | #n',
            'F45 | Label | category | ENDED: why it is no longer true | #n',
            '=== THREADS',
            'OPEN | something left hanging | #n',
            '',
            'Categories. Use exactly these words.',
            'One value at a time:',
            '  kind (character, group, place, item or world), age (a plain number whenever the notes give one), eyes, hair (colour and usual style), build (height and body shape), skin, status (alive, dead or missing), location (where they live or are staying), role (what they are or do for a living), relation to <Label> (where they stand with that person; one short sentence)',
            'Any number of values:',
            '  aka (a full name, another name or a nickname they go by)',
            '  title (a rank or honour they hold)',
            '  appearance (permanent looks only)',
            '  ability (a skill or power they have, or a limit on one)',
            '  belonging (something they own and keep)',
            '  background (their life before the story began)',
            '  trait (a lasting habit, taste, fear or preference)',
            '  condition (a passing state that will be gone in days)',
            '  feature (of a place or item), rule (how the world works; the subject is the world)',
            '',
            'Rules.',
            '1. One fact per line, one detail per fact, under 25 words. Every FACTS, NAMES, CHANGES and THREADS line ends with exactly one number: the number of the note line it came from. A SUBJECTS line has no number.',
            '2. Read the LEDGER before adding. Never repeat what it holds, even in other words.',
            "3. When a note contradicts a fact in the LEDGER, or says it is no longer true, do not add a second fact: write a CHANGES line for that fact, with its id, the subject's label and the category exactly as the LEDGER shows them. When a note adds detail to a fact, write a FULLER line. A fact marked pinned is never changed.",
            '4. Use a label from SUBJECTS exactly. For someone or something new, add a SUBJECTS line first; its kind is exactly one of character, group, place, item, world. A label never contains # or a comma.',
            "5. When a note writes a known subject's name another way, write a NAMES line, then use the known label.",
            '6. Mark a fact hidden when the note says it is a secret or known only to the subject.',
            '7. A note that cannot be read as a fact about a subject is left out. Never guess.',
        ]),

        AnswersPromptLines: Object.freeze([
            'You are the Analyzer: keeper of the campaign book for an ongoing adult fiction roleplay between consenting adult characters.',
            'You never write story. Record intimate, profane and violent facts plainly; never soften, omit or judge. Never invent.',
            '',
            "Earlier you asked the player questions about things the story left unclear. ANSWERED QUESTIONS holds each question with the player's answer, numbered [#n] by the message it was about.",
            'File each answer in the book, exactly as the player answered. You receive PLAYER CHARACTER, SUBJECTS (everyone and everything that has an entry), LEDGER (the facts now in force for the subjects named) and the ANSWERED QUESTIONS.',
            'In the LEDGER each fact ends with (#n) or (owner), and may then be marked pinned or hidden.',
            '',
            'Answer with these blocks, in this order, each starting with its === line. Leave a block out if it has nothing. Write nothing else.',
            '',
            '=== SUBJECTS',
            'Label | kind',
            '=== NAMES',
            'Name as written | Label of the known subject | #n',
            '=== FACTS',
            'Label | category | statement | #n',
            'Label | category | statement | hidden | #n',
            '=== CHANGES',
            'F12 | Label | category | the new statement | #n',
            'F12 | Label | category | FULLER: the same fact with more detail | #n',
            'F45 | Label | category | ENDED: why it is no longer true | #n',
            '',
            'Categories. Use exactly these words.',
            'One value at a time:',
            '  kind (character, group, place, item or world), age, eyes, hair, build, skin, status, location, role, relation to <Label>',
            'Any number of values:',
            '  aka, title, appearance, ability, belonging, background, trait, condition, feature, rule',
            '',
            'Rules.',
            '1. One fact per line, one detail per fact, under 25 words. Every FACTS, NAMES and CHANGES line ends with exactly one number: the number shown for the question it answers. A SUBJECTS line has no number.',
            '2. Read the LEDGER before adding. Never repeat what it holds, even in other words.',
            "3. When an answer contradicts a fact in the LEDGER, or says it is no longer true, do not add a second fact: write a CHANGES line for that fact, with its id, the subject's label and the category exactly as the LEDGER shows them. When an answer adds detail to a fact, write a FULLER line. A fact marked pinned is never changed.",
            '4. Use a label from SUBJECTS exactly. For someone or something new, add a SUBJECTS line first; its kind is exactly one of character, group, place, item, world. A label never contains # or a comma.',
            '5. Mark a fact hidden when the answer says it is a secret, a thought, or known only to the subject.',
            '6. An answer that settles nothing ("leave it open", "not decided") produces no line. Never guess.',
        ]),
    }),

    /**
     * @return {string}
     */
    get Prompt() {
        return ScribeAnalyzer.Settings.PromptLines.join(ScribeAnalyzer.Settings.Newline);
    },

    /**
     * @return {string}
     */
    get NotesPrompt() {
        return ScribeAnalyzer.Settings.NotesPromptLines.join(ScribeAnalyzer.Settings.Newline);
    },

    /**
     * @return {string}
     */
    get AnswersPrompt() {
        return ScribeAnalyzer.Settings.AnswersPromptLines.join(ScribeAnalyzer.Settings.Newline);
    },

    /**
     * @param {string} heading
     * @param {readonly string[]} lines
     * @return {string}
     */
    section(heading, lines) {
        const settings = ScribeAnalyzer.Settings;
        const body = lines.length === 0 ? settings.None : lines.join(settings.Newline);
        return heading + settings.Newline + body;
    },

    /**
     * @param {object} state
     * @return {Map<string, string>}
     */
    labels(state) {
        const labels = new Map();
        for (const subject of state.subjects) {
            labels.set(subject.id, subject.label);
        }
        return labels;
    },

    /**
     * @param {object} state
     * @param {number} before
     * @return {readonly object[]}
     */
    earlier(state, before) {
        return Object.freeze(
            state.scenes
                .filter(
                    /**
                     * @param {{ firstPosition: number }} scene
                     * @return {boolean}
                     */
                    (scene) => scene.firstPosition < before,
                )
                .sort(
                    /**
                     * @param {{ firstPosition: number, lastPosition: number }} first
                     * @param {{ firstPosition: number, lastPosition: number }} second
                     * @return {number}
                     */
                    (first, second) =>
                        first.lastPosition - second.lastPosition || first.firstPosition - second.firstPosition,
                ),
        );
    },

    /**
     * @param {string} text
     * @return {string}
     */
    fold(text) {
        const settings = ScribeAnalyzer.Settings;
        return text
            .normalize(settings.NormalForm)
            .replace(settings.Apostrophes, settings.Apostrophe)
            .replace(settings.Whitespace, settings.Space);
    },

    /**
     * @param {string} text
     * @return {Map<string, number[]>}
     */
    index(text) {
        const starts = new Map();
        for (const match of text.matchAll(ScribeAnalyzer.Settings.Word)) {
            const offsets = starts.get(match[0]) ?? [];
            offsets.push(match.index);
            starts.set(match[0], offsets);
        }
        return starts;
    },

    /**
     * @param {string} text
     * @param {Map<string, number[]>} starts
     * @param {string} wanted
     * @return {boolean}
     */
    found(text, starts, wanted) {
        const settings = ScribeAnalyzer.Settings;
        let rarest = null;
        for (const run of wanted.matchAll(settings.Word)) {
            const offsets = starts.get(run[0]) ?? [];
            if (rarest === null || offsets.length < rarest.offsets.length) {
                rarest = { offsets, at: run.index };
            }
        }
        if (rarest === null) {
            return false;
        }
        return rarest.offsets.some(
            /**
             * @param {number} offset
             * @return {boolean}
             */
            (offset) => {
                const start = offset - rarest.at;
                const end = start + wanted.length;
                return (
                    start >= 0 &&
                    text.startsWith(wanted, start) &&
                    !settings.WordBefore.test(text.slice(Math.max(0, start - settings.BoundaryWidth), start)) &&
                    !settings.WordAfter.test(text.slice(end, end + settings.BoundaryWidth))
                );
            },
        );
    },

    /**
     * @param {object} state
     * @param {string} text
     * @param {string} player
     * @param {number} before
     * @return {readonly string[]}
     */
    select(state, text, player, before) {
        const settings = ScribeAnalyzer.Settings;
        const kept = ScribeAnalyzer.fold(text);
        const folded = kept.toLowerCase();
        const starts = ScribeAnalyzer.index(folded);
        let exact = null;
        const playerName = ScribeText.normaliseName(player);
        const running = ScribeAnalyzer.earlier(state, before).at(settings.Last);
        const present = new Set();
        for (const attendee of running === undefined ? [] : running.present) {
            present.add(attendee.subject);
        }
        const chosen = [];
        for (const subject of state.subjects) {
            if (subject.mergedInto !== null) {
                continue;
            }
            const playing = [subject.name, ...subject.aka].some(
                /**
                 * @param {string} name
                 * @return {boolean}
                 */
                (name) => ScribeText.normaliseName(name) === playerName,
            );
            const spelled = ScribeAnalyzer.fold(subject.name);
            const words = spelled.split(settings.Space).filter(
                /**
                 * @param {string} word
                 * @return {boolean}
                 */
                (word) => !settings.CommonWords.includes(word.toLowerCase()),
            );
            const sought = [
                spelled.toLowerCase(),
                ...words
                    .filter(
                        /**
                         * @param {string} word
                         * @return {boolean}
                         */
                        (word) => Array.from(word).length >= settings.ShortestWord,
                    )
                    .map(
                        /**
                         * @param {string} word
                         * @return {string}
                         */
                        (word) => word.toLowerCase(),
                    ),
                ...subject.aka
                    .map(
                        /**
                         * @param {string} aka
                         * @return {string}
                         */
                        (aka) => ScribeAnalyzer.fold(aka).toLowerCase(),
                    )
                    .filter(
                        /**
                         * @param {string} aka
                         * @return {boolean}
                         */
                        (aka) => Array.from(aka).length >= settings.ShortestAka,
                    ),
            ];
            const cased = words.filter(
                /**
                 * @param {string} word
                 * @return {boolean}
                 */
                (word) => Array.from(word).length === settings.CasedWord,
            );
            const always = subject.kind === ScribeCategory.SubjectKinds.World || playing || present.has(subject.id);
            const named =
                sought.some(
                    /**
                     * @param {string} wanted
                     * @return {boolean}
                     */
                    (wanted) => ScribeAnalyzer.found(folded, starts, wanted),
                ) ||
                cased.some(
                    /**
                     * @param {string} word
                     * @return {boolean}
                     */
                    (word) => {
                        if (exact === null) {
                            exact = ScribeAnalyzer.index(kept);
                        }
                        return ScribeAnalyzer.found(kept, exact, word);
                    },
                );
            if (always || named) {
                chosen.push(subject.id);
            }
        }
        return Object.freeze(chosen);
    },

    /**
     * @param {object} state
     * @param {string} player
     * @param {string} text
     * @param {number} before
     * @param {number} through
     * @return {readonly string[]}
     */
    opening(state, player, text, before, through) {
        const settings = ScribeAnalyzer.Settings;
        const headings = settings.Headings;
        const labels = ScribeAnalyzer.labels(state);
        const subjects = [];
        for (const subject of state.subjects) {
            if (subject.mergedInto === null) {
                const aka =
                    subject.aka.length === 0 ? settings.Nothing : settings.AkaOpen + subject.aka.join(settings.Comma);
                subjects.push(
                    settings.ListMarker + subject.label + settings.Opening + subject.kind + aka + settings.Closing,
                );
            }
        }
        const stale = new Set();
        for (const mark of state.stale) {
            stale.add(JSON.stringify([mark.subject, mark.target]));
        }
        const ledgers = new Map();
        for (const id of ScribeAnalyzer.select(state, text, player, before)) {
            ledgers.set(id, []);
        }
        for (const fact of state.facts) {
            const lines = ledgers.get(fact.subject);
            if (lines === undefined || fact.status !== ScribeReplay.Status.InForce || fact.position > through) {
                continue;
            }
            let category = fact.category;
            if (category === ScribeCategory.Settings.RelationCategory) {
                category = settings.RelationTo + (fact.target === null ? fact.targetText : labels.get(fact.target));
            }
            let line = fact.id + settings.Space + category + settings.Colon + fact.text;
            if (fact.origin === ScribeLog.Origin.Operator) {
                line += settings.Owner;
            } else {
                line += settings.CiteOpen + fact.position + settings.Closing;
            }
            if (fact.pinned) {
                line += settings.Pinned;
            }
            if (fact.hidden && fact.widened !== ScribeLog.Settings.Everyone) {
                line += settings.Hidden;
            }
            if (stale.has(JSON.stringify([fact.subject, fact.target]))) {
                line += settings.Stale;
            }
            lines.push(line);
        }
        const ledger = [];
        for (const [id, lines] of ledgers) {
            ledger.push(settings.SubjectMarker + labels.get(id), ...(lines.length === 0 ? [settings.NoFacts] : lines));
        }
        return Object.freeze([
            ScribeAnalyzer.section(headings.Player, [player]),
            ScribeAnalyzer.section(headings.Subjects, subjects),
            ScribeAnalyzer.section(headings.Ledger, ledger),
        ]);
    },

    /**
     * @param {object} state
     * @param {string} player
     * @param {readonly object[]} stretch
     * @return {string}
     */
    input(state, player, stretch) {
        const settings = ScribeAnalyzer.Settings;
        const headings = settings.Headings;
        const first = stretch[0].position;
        const last = stretch.at(settings.Last).position;
        const transcript = ScribeIntake.transcript(stretch);
        const labels = ScribeAnalyzer.labels(state);
        const scenes = [];
        for (const scene of ScribeAnalyzer.earlier(state, first).slice(-settings.ShownScenes)) {
            const attendance = scene.present.map(
                /**
                 * @param {{ subject: string, from: number|null, until: number|null }} attendee
                 * @return {string}
                 */
                (attendee) => {
                    const bounds = [];
                    if (attendee.from !== null) {
                        bounds.push(settings.From + attendee.from);
                    }
                    if (attendee.until !== null) {
                        bounds.push(settings.Until + attendee.until);
                    }
                    const bounded =
                        bounds.length === 0
                            ? settings.Nothing
                            : settings.Opening + bounds.join(settings.Space) + settings.Closing;
                    return labels.get(attendee.subject) + bounded;
                },
            );
            scenes.push(
                [
                    settings.Day + scene.day,
                    settings.Hash + scene.firstPosition + settings.Span + scene.lastPosition,
                    scene.place,
                    scene.reach.toLowerCase(),
                    settings.Present + (attendance.length === 0 ? settings.Nobody : attendance.join(settings.Comma)),
                    scene.summary,
                ].join(settings.Joiner),
            );
        }
        const nights = state.nights
            .filter(
                /**
                 * @param {{ position: number }} night
                 * @return {boolean}
                 */
                (night) => night.position < first,
            )
            .slice(-settings.ShownNights)
            .map(
                /**
                 * @param {{ position: number, marker: string }} night
                 * @return {string}
                 */
                (night) => settings.Hash + night.position + settings.Joiner + night.marker,
            );
        const threads = state.threads
            .filter(
                /**
                 * @param {{ closed: object|null, position: number }} thread
                 * @return {boolean}
                 */
                (thread) => thread.closed === null && thread.position <= last,
            )
            .map(
                /**
                 * @param {{ id: string, text: string }} thread
                 * @return {string}
                 */
                (thread) => thread.id + settings.Colon + thread.text,
            );
        const messages = settings.MessagesOpen + first + settings.MessagesTo + last + settings.MessagesClose;
        return [
            ...ScribeAnalyzer.opening(state, player, transcript, first, last),
            ScribeAnalyzer.section(headings.Scenes, scenes),
            ScribeAnalyzer.section(headings.Nights, nights),
            ScribeAnalyzer.section(headings.Threads, threads),
            ScribeAnalyzer.section(messages, [transcript]),
        ].join(settings.BlankLine);
    },

    /**
     * @param {object} state
     * @param {string} player
     * @param {readonly object[]} notes
     * @return {string}
     */
    notesInput(state, player, notes) {
        const settings = ScribeAnalyzer.Settings;
        const text = notes
            .map(
                /**
                 * @param {{ text: string }} note
                 * @return {string}
                 */
                (note) => note.text,
            )
            .join(settings.Newline);
        const lines = notes.map(
            /**
             * @param {{ text: string, position: number }} note
             * @return {string}
             */
            (note) => settings.NumberOpen + note.position + settings.NumberClose + note.text,
        );
        return [
            ...ScribeAnalyzer.opening(state, player, text, settings.NoSceneBefore, settings.NoLimit),
            ScribeAnalyzer.section(settings.Headings.Notes, lines),
        ].join(settings.BlankLine);
    },

    /**
     * @param {object} state
     * @param {string} player
     * @param {readonly object[]} questions
     * @return {string}
     */
    answersInput(state, player, questions) {
        const settings = ScribeAnalyzer.Settings;
        const answered = questions.filter(
            /**
             * @param {{ answer: string|null }} question
             * @return {boolean}
             */
            (question) => question.answer !== null,
        );
        const text = answered
            .flatMap(
                /**
                 * @param {{ text: string, answer: string }} question
                 * @return {string[]}
                 */
                (question) => [question.text, question.answer],
            )
            .join(settings.Newline);
        const lines = answered.map(
            /**
             * @param {{ text: string, answer: string, position: number }} question
             * @return {string}
             */
            (question) =>
                settings.NumberOpen +
                question.position +
                settings.NumberClose +
                question.text +
                settings.AnswerMarker +
                question.answer,
        );
        return [
            ...ScribeAnalyzer.opening(state, player, text, settings.NoSceneBefore, settings.NoLimit),
            ScribeAnalyzer.section(settings.Headings.Answers, lines),
        ].join(settings.BlankLine);
    },
});
/** @file scribe/core/ScribeGateway.js */
const ScribeGateway = Object.freeze({
    Endpoint: 'https://openrouter.ai/api/v1/chat/completions',

    Settings: Object.freeze({
        Method: 'POST',
        AuthorizationHeader: 'Authorization',
        BearerPrefix: 'Bearer ',
        ContentTypeHeader: 'Content-Type',
        JsonType: 'application/json',
        Temperature: 0.2,
        ReasoningEffort: 'low',
        SystemRole: 'system',
        UserRole: 'user',
        Finish: Object.freeze({
            Stop: 'stop',
            Length: 'length',
            Error: 'error',
        }),
        FirstSuccess: 200,
        LastSuccess: 299,
        FirstStatus: 100,
        TimedOut: 408,
        RateLimited: 429,
        FirstServerError: 500,
        MaxReasonLength: 300,
        MaxFinishLength: 40,
        TimeoutMs: 180000,
        PauseMs: 10000,
        MillisecondsPerSecond: 1000,
        FirstAttempt: 1,
        NoPause: 0,
        KeyMask: '[key]',
        Space: ' ',
        Nothing: '',
        ByteOrderMark: '﻿',
        ObjectType: 'object',
        NumberType: 'number',
        StringType: 'string',
        FunctionType: 'function',
        NoStatus: 'no response',
        NoFinish: 'none',

        /**
         * @return {RegExp}
         */
        get Whitespace() {
            return /\s+/g;
        },

        /**
         * @return {RegExp}
         */
        get ForbiddenInKey() {
            return /[\s\u0000-\u001f\u007f]/;
        },

        /**
         * @return {RegExp}
         */
        get Digits() {
            return /^\d+$/;
        },
        Messages: Object.freeze({
            Network: 'request failed',
            NoResponse: 'no usable response',
            NoReader: 'response has no readable body',
            Unreadable: 'response body could not be read',
            BadStatus: 'unexpected HTTP status',
            NotObject: 'response body is not a JSON object',
            ProviderError: 'provider reported an error',
            Cut: 'answer was cut off',
            Errored: 'answer ended in an error',
            WrongFinish: 'answer did not finish with stop',
            Empty: 'answer has no usable content',
            BadArgument: 'invalid argument',
            BadSleep: 'sleep is not a function',
            TimeoutPrefix: 'no answer within ',
            TimeoutSuffix: ' seconds',
        }),
    }),

    /**
     * @param {string|null} key
     * @param {string} text
     * @return {string}
     */
    mask(key, text) {
        const settings = ScribeGateway.Settings;
        if (typeof key !== settings.StringType || key === settings.Nothing) {
            return text;
        }
        return text.replaceAll(key, settings.KeyMask);
    },

    /**
     * @param {*} value
     * @return {boolean}
     */
    isObject(value) {
        return typeof value === ScribeGateway.Settings.ObjectType && value !== null && !Array.isArray(value);
    },

    /**
     * @param {*} value
     * @return {boolean}
     */
    filled(value) {
        const settings = ScribeGateway.Settings;
        return typeof value === settings.StringType && value !== settings.Nothing;
    },

    /**
     * @param {number} status
     * @return {boolean}
     */
    transient(status) {
        const settings = ScribeGateway.Settings;
        return status === settings.TimedOut || status === settings.RateLimited || status >= settings.FirstServerError;
    },

    /**
     * @param {string|null} key
     * @param {*} value
     * @return {string|null}
     */
    finishOf(key, value) {
        const settings = ScribeGateway.Settings;
        if (typeof value !== settings.StringType) {
            return null;
        }
        return ScribeGateway.mask(key, value).slice(0, settings.MaxFinishLength);
    },

    /**
     * @param {*} value
     * @return {{ code: number|null, reason: string|null }|null}
     */
    reported(value) {
        const settings = ScribeGateway.Settings;
        if (typeof value === settings.StringType) {
            return value === settings.Nothing ? null : { code: null, reason: value };
        }
        if (!ScribeGateway.isObject(value)) {
            return null;
        }
        const hasCode = value.code !== undefined && value.code !== null;
        const hasMessage = value.message !== undefined && value.message !== null;
        if (!hasCode && !hasMessage) {
            return null;
        }
        let code = null;
        if (typeof value.code === settings.NumberType) {
            code = value.code;
        } else if (typeof value.code === settings.StringType && settings.Digits.test(value.code)) {
            code = Number(value.code);
        }
        return { code, reason: typeof value.message === settings.StringType ? value.message : null };
    },

    /**
     * @param {string|null} key
     * @param {string} what
     * @param {{ retryable: boolean, status: number|null, finish: string|null, reason: string|null }} detail
     * @return {Error}
     */
    failure(key, what, detail) {
        const settings = ScribeGateway.Settings;
        const status = detail.status === null ? settings.NoStatus : String(detail.status);
        const finish = detail.finish === null ? settings.NoFinish : detail.finish;
        let message = `${what}; status ${status}; finish ${finish}`;
        if (detail.reason !== null) {
            const masked = ScribeGateway.mask(key, detail.reason);
            message += `; reason: ${masked.slice(0, settings.MaxReasonLength)}`;
        }
        const error = new Error(ScribeGateway.mask(key, message).replace(settings.Whitespace, settings.Space));
        error.retryable = detail.retryable;
        error.status = detail.status;
        error.finish = detail.finish === null ? null : ScribeGateway.mask(key, detail.finish);
        return error;
    },

    /**
     * @param {{ fetch: Function, sleep: Function, key: string, model: string, system: string, user: string, maxTokens: number, timeoutMs?: number, signal?: object }} request
     * @return {Promise<{ text: string, tokensIn: number, tokensOut: number, cost: number|null }>}
     */
    async call(request) {
        const settings = ScribeGateway.Settings;
        const checks = [
            ['fetch', typeof request.fetch === settings.FunctionType],
            ['sleep', typeof request.sleep === settings.FunctionType],
            ['key', ScribeGateway.filled(request.key) && !settings.ForbiddenInKey.test(request.key)],
            ['model', ScribeGateway.filled(request.model)],
            ['system', ScribeGateway.filled(request.system)],
            ['user', ScribeGateway.filled(request.user)],
            ['maxTokens', Number.isSafeInteger(request.maxTokens) && request.maxTokens > 0],
        ];
        for (const [name, valid] of checks) {
            if (!valid) {
                throw ScribeGateway.failure(null, `${settings.Messages.BadArgument}: ${name}`, {
                    retryable: false,
                    status: null,
                    finish: null,
                    reason: null,
                });
            }
        }
        const key = request.key;
        const send = request.fetch;
        const timeoutMs = Number.isFinite(request.timeoutMs) && request.timeoutMs > 0 ? request.timeoutMs : settings.TimeoutMs;
        const options = {
            method: settings.Method,
            headers: {
                [settings.AuthorizationHeader]: `${settings.BearerPrefix}${key}`,
                [settings.ContentTypeHeader]: settings.JsonType,
            },
            body: JSON.stringify({
                model: request.model,
                temperature: settings.Temperature,
                max_tokens: request.maxTokens,
                reasoning: { effort: settings.ReasoningEffort },
                usage: { include: true },
                messages: [
                    { role: settings.SystemRole, content: request.system },
                    { role: settings.UserRole, content: request.user },
                ],
            }),
        };
        if (request.signal !== undefined && request.signal !== null) {
            options.signal = request.signal;
        }

        /**
         * @return {Promise<{ status: number, raw: string }>}
         */
        const exchange = async () => {
            let response = null;
            try {
                response = await send(ScribeGateway.Endpoint, options);
            } catch (cause) {
                throw ScribeGateway.failure(key, settings.Messages.Network, {
                    retryable: true,
                    status: null,
                    finish: null,
                    reason: typeof cause?.message === settings.StringType ? cause.message : null,
                });
            }
            if (!ScribeGateway.isObject(response) || !Number.isFinite(response.status) || response.status < settings.FirstStatus) {
                throw ScribeGateway.failure(key, settings.Messages.NoResponse, {
                    retryable: true,
                    status: null,
                    finish: null,
                    reason: null,
                });
            }
            const received = response.status;
            if (typeof response.text !== settings.FunctionType) {
                throw ScribeGateway.failure(key, settings.Messages.NoReader, {
                    retryable: false,
                    status: received,
                    finish: null,
                    reason: null,
                });
            }
            try {
                return { status: received, raw: await response.text() };
            } catch (cause) {
                throw ScribeGateway.failure(key, settings.Messages.Unreadable, {
                    retryable: true,
                    status: received,
                    finish: null,
                    reason: typeof cause?.message === settings.StringType ? cause.message : null,
                });
            }
        };

        const exchanged = exchange();
        const timer = Promise.resolve(request.sleep(timeoutMs)).then(() => null);
        const outcome = await Promise.race([exchanged, timer]);
        if (outcome === null) {
            const seconds = timeoutMs / settings.MillisecondsPerSecond;
            throw ScribeGateway.failure(key, `${settings.Messages.TimeoutPrefix}${seconds}${settings.Messages.TimeoutSuffix}`, {
                retryable: true,
                status: null,
                finish: null,
                reason: null,
            });
        }
        const status = outcome.status;
        if (status < settings.FirstSuccess || status > settings.LastSuccess) {
            throw ScribeGateway.failure(key, settings.Messages.BadStatus, {
                retryable: ScribeGateway.transient(status),
                status,
                finish: null,
                reason: null,
            });
        }
        let parsed = null;
        try {
            const text = outcome.raw.startsWith(settings.ByteOrderMark) ? outcome.raw.slice(settings.ByteOrderMark.length) : outcome.raw;
            parsed = JSON.parse(text);
        } catch {
            parsed = null;
        }
        if (!ScribeGateway.isObject(parsed)) {
            throw ScribeGateway.failure(key, settings.Messages.NotObject, {
                retryable: true,
                status,
                finish: null,
                reason: null,
            });
        }
        const choice = Array.isArray(parsed.choices) && ScribeGateway.isObject(parsed.choices[0]) ? parsed.choices[0] : null;
        const finish = ScribeGateway.finishOf(key, choice?.finish_reason);
        for (const candidate of [parsed.error, choice?.error]) {
            const provider = ScribeGateway.reported(candidate);
            if (provider !== null) {
                throw ScribeGateway.failure(key, settings.Messages.ProviderError, {
                    retryable: provider.code !== null && ScribeGateway.transient(provider.code),
                    status,
                    finish,
                    reason: provider.reason,
                });
            }
        }
        if (finish === settings.Finish.Length) {
            throw ScribeGateway.failure(key, settings.Messages.Cut, { retryable: false, status, finish, reason: null });
        }
        if (finish === settings.Finish.Error) {
            throw ScribeGateway.failure(key, settings.Messages.Errored, { retryable: true, status, finish, reason: null });
        }
        if (finish !== settings.Finish.Stop) {
            throw ScribeGateway.failure(key, settings.Messages.WrongFinish, { retryable: false, status, finish, reason: null });
        }
        const content = choice.message?.content;
        if (typeof content !== settings.StringType || content.trim() === settings.Nothing) {
            throw ScribeGateway.failure(key, settings.Messages.Empty, { retryable: true, status, finish, reason: null });
        }
        const usage = ScribeGateway.isObject(parsed.usage) ? parsed.usage : {};
        return {
            text: content,
            tokensIn: Number.isSafeInteger(usage.prompt_tokens) && usage.prompt_tokens >= 0 ? usage.prompt_tokens : 0,
            tokensOut: Number.isSafeInteger(usage.completion_tokens) && usage.completion_tokens >= 0 ? usage.completion_tokens : 0,
            cost: Number.isFinite(usage.cost) && usage.cost >= 0 ? usage.cost : null,
        };
    },

    /**
     * @param {() => Promise<object>} attempt
     * @param {{ attempts: number, pauseMs: number, sleep: (milliseconds: number) => Promise<void> }} options
     * @return {Promise<object>}
     * @throws {Error}
     */
    async retry(attempt, options) {
        const settings = ScribeGateway.Settings;
        const given = ScribeGateway.isObject(options) ? options : {};
        if (typeof given.sleep !== settings.FunctionType) {
            throw ScribeGateway.failure(null, settings.Messages.BadSleep, {
                retryable: false,
                status: null,
                finish: null,
                reason: null,
            });
        }
        const requested = Number(given.attempts);
        const limit = Number.isFinite(requested) && requested >= settings.FirstAttempt ? Math.floor(requested) : settings.FirstAttempt;
        const pause = Number.isFinite(given.pauseMs) && given.pauseMs >= settings.NoPause ? given.pauseMs : settings.PauseMs;
        for (let number = settings.FirstAttempt; ; number++) {
            try {
                return await attempt();
            } catch (error) {
                if (error?.retryable !== true || number >= limit) {
                    throw error;
                }
                await given.sleep(pause * number);
            }
        }
    },
});
/** @file scribe/core/ScribeAdoption.js */
const ScribeAdoption = Object.freeze({
    Stop: Object.freeze({
        Done: 'Done',
        Paused: 'Paused',
        Budget: 'Budget',
        Failed: 'Failed',
    }),

    Pass: Object.freeze({
        Answers: 'Answers',
        Notes: 'Notes',
        Story: 'Story',
    }),

    Settings: Object.freeze({
        LeastSize: 1,
        LeastAmount: 0,
        LongestEmptyLine: 40,
        NotFound: -1,
        Last: -1,
        Nothing: '',
        Space: ' ',
        Unreadable: Object.freeze({
            Answers: 'The answer for the answered questions',
            Notes: 'The answer for the notes',
            Story: 'The answer for',
        }),
        Stretch: Object.freeze({
            Notes: ' in #',
            Story: ' #',
        }),
        RangeTo: ' to #',
        NoLine: ' held no line that could be read.',
        Arguments: Object.freeze({
            Options: 'The options are missing.',
            Messages: 'messages is not a list.',
            Notes: 'notes is not a list.',
            Player: 'player is not a string.',
            Log: 'log is not an object.',
            Size: 'size is not a positive whole number.',
        }),
        Amounts: Object.freeze(['budget', 'spent']),
        NotAmount: ' is not a finite number of at least 0.',
        Callbacks: Object.freeze(['ask', 'save', 'record', 'progress', 'paused']),
        NotFunction: ' is not a function.',
        SharedId: 'Two messages share the id ',
        FullStop: '.',
    }),

    /**
     * @param {{ read: Object<string, number> }} log
     * @param {readonly object[]} messages
     * @param {number} size
     * @return {readonly object[]}
     */
    next(log, messages, size) {
        const settings = ScribeAdoption.Settings;
        const count = size >= settings.LeastSize ? Math.floor(size) : settings.LeastSize;
        const start = messages.findIndex(
            /**
             * @param {{ id: string }} message
             * @return {boolean}
             */
            (message) => !Object.hasOwn(log.read, message.id),
        );
        const stretch = [];
        if (start === settings.NotFound) {
            return Object.freeze(stretch);
        }
        for (const message of messages.slice(start, start + count)) {
            if (Object.hasOwn(log.read, message.id)) {
                break;
            }
            stretch.push(message);
        }
        return Object.freeze(stretch);
    },

    /**
     * @param {*} value
     * @return {boolean}
     */
    amount(value) {
        return Number.isFinite(value) && value >= ScribeAdoption.Settings.LeastAmount;
    },

    /**
     * @param {{ spent: number, calls: number, unpriced: number }} job
     * @param {string} stop
     * @param {string|null} problem
     * @return {Readonly<{ stop: string, problem: string|null, spent: number, calls: number, unpriced: number }>}
     */
    finish(job, stop, problem) {
        return Object.freeze({ stop, problem, spent: job.spent, calls: job.calls, unpriced: job.unpriced });
    },

    /**
     * @param {*} options
     * @return {string|null}
     */
    check(options) {
        const settings = ScribeAdoption.Settings;
        const problems = settings.Arguments;
        if (options === null || typeof options !== 'object') {
            return problems.Options;
        }
        if (!Array.isArray(options.messages)) {
            return problems.Messages;
        }
        const seen = new Set();
        for (const message of options.messages) {
            if (seen.has(message.id)) {
                return settings.SharedId + message.id + settings.FullStop;
            }
            seen.add(message.id);
        }
        if (!Array.isArray(options.notes)) {
            return problems.Notes;
        }
        if (typeof options.player !== 'string') {
            return problems.Player;
        }
        if (options.log === null || typeof options.log !== 'object') {
            return problems.Log;
        }
        if (!Number.isSafeInteger(options.size) || options.size < settings.LeastSize) {
            return problems.Size;
        }
        for (const name of settings.Amounts) {
            if (!ScribeAdoption.amount(options[name])) {
                return name + settings.NotAmount;
            }
        }
        for (const name of settings.Callbacks) {
            if (typeof options[name] !== 'function') {
                return name + settings.NotFunction;
            }
        }
        return null;
    },

    /**
     * @param {object} job
     * @param {{ pass: string, first: number|null, last: number|null }} step
     * @param {number} stored
     * @param {readonly object[]} refusedLines
     * @param {readonly object[]} refusedOperations
     * @return {Promise<void>}
     */
    async report(job, step, stored, refusedLines, refusedOperations) {
        const read = job.messages.filter(
            /**
             * @param {{ id: string }} message
             * @return {boolean}
             */
            (message) => Object.hasOwn(job.log.read, message.id),
        ).length;
        await job.progress(
            Object.freeze({
                pass: step.pass,
                first: step.first,
                last: step.last,
                read,
                total: job.messages.length,
                spent: job.spent,
                calls: job.calls,
                unpriced: job.unpriced,
                stored,
                refusedLines,
                refusedOperations,
            }),
        );
    },

    /**
     * @param {object} job
     * @param {{ pass: string, origin: string, first: number|null, last: number|null, system: string, user: string, messages: readonly object[], state: object, notes: readonly object[], questions: readonly object[] }} step
     * @return {Promise<Readonly<{ stop: string, problem: string|null, spent: number, calls: number, unpriced: number }>|null>}
     * @throws {Error}
     */
    async consult(job, step) {
        const settings = ScribeAdoption.Settings;
        const stops = ScribeAdoption.Stop;
        if (await job.paused()) {
            return ScribeAdoption.finish(job, stops.Paused, null);
        }
        if (job.spent >= job.budget) {
            return ScribeAdoption.finish(job, stops.Budget, null);
        }
        job.calls++;
        const answer = await job.ask(step.system, step.user);
        if (ScribeAdoption.amount(answer.cost)) {
            job.spent += answer.cost;
        } else {
            job.unpriced++;
        }
        const parsed = ScribeAnswer.parse(answer.text);
        const wordy = answer.text.split(ScribeAnswer.Settings.LineBreak).some(
            /**
             * @param {string} line
             * @return {boolean}
             */
            (line) => Array.from(line.trim()).length > settings.LongestEmptyLine,
        );
        const kept = { pass: step.pass, system: step.system, input: step.user, answer: answer.text };
        if (parsed.operations.length === 0 && (parsed.refused.length > 0 || wordy)) {
            await job.record(Object.freeze({ sequence: null, ...kept, readable: false }));
            await ScribeAdoption.report(job, step, 0, parsed.refused, []);
            const range =
                step.first === null
                    ? settings.Nothing
                    : settings.Stretch[step.pass] + step.first + settings.RangeTo + step.last;
            return ScribeAdoption.finish(job, stops.Failed, settings.Unreadable[step.pass] + range + settings.NoLine);
        }
        const stretch = { messages: step.messages, origin: step.origin };
        let result = null;
        try {
            result = ScribeLog.append(job.log, step.state, parsed.operations, stretch);
        } catch (error) {
            if (error.message !== ScribeLog.Settings.StaleState) {
                throw error;
            }
            result = ScribeLog.append(job.log, ScribeReplay.run(job.log, job.order), parsed.operations, stretch);
        }
        for (const note of step.notes) {
            job.log.notes.push(note.text);
        }
        for (const question of step.questions) {
            ScribeLog.rule(job.log, ScribeReplay.run(job.log, job.order), {
                type: ScribeLog.Ruling.Dismiss,
                question: question.id,
            });
        }
        await job.save(job.log);
        await job.record(Object.freeze({ sequence: result.entry.sequence, ...kept, readable: true }));
        await ScribeAdoption.report(job, step, result.entry.operations.length, parsed.refused, result.refused);
        return null;
    },

    /**
     * @param {{ messages: readonly object[], notes: readonly object[], player: string, log: object, size: number, budget: number, spent: number, ask: Function, save: Function, record: Function, progress: Function, paused: Function }} options
     * @return {Promise<Readonly<{ stop: string, problem: string|null, spent: number, calls: number, unpriced: number }>>}
     */
    async run(options) {
        const settings = ScribeAdoption.Settings;
        const stops = ScribeAdoption.Stop;
        const passes = ScribeAdoption.Pass;
        const origins = ScribeLog.Origin;
        const job = { spent: settings.LeastAmount, calls: 0, unpriced: 0 };
        try {
            const problem = ScribeAdoption.check(options);
            if (problem !== null) {
                const given = options !== null && typeof options === 'object' ? options.spent : null;
                job.spent = ScribeAdoption.amount(given) ? given : settings.LeastAmount;
                return ScribeAdoption.finish(job, stops.Failed, problem);
            }
            Object.assign(job, options, { order: [], places: new Map(), calls: 0, unpriced: 0 });
            for (const message of job.messages) {
                job.order.push(message.id);
                job.places.set(message.position, message);
            }
            while (!(await job.paused())) {
                let state = ScribeReplay.run(job.log, job.order);
                const answered = state.questions.filter(
                    /**
                     * @param {{ answer: string|null, dismissed: boolean }} question
                     * @return {boolean}
                     */
                    (question) => question.answer !== null && !question.dismissed,
                );
                if (answered.length > 0) {
                    const cited = new Set();
                    for (const question of answered) {
                        cited.add(question.cite);
                    }
                    const answersStop = await ScribeAdoption.consult(job, {
                        pass: passes.Answers,
                        origin: origins.Answers,
                        first: null,
                        last: null,
                        system: ScribeAnalyzer.AnswersPrompt,
                        user: ScribeAnalyzer.answersInput(state, job.player, answered),
                        messages: job.messages.filter(
                            /**
                             * @param {{ id: string }} message
                             * @return {boolean}
                             */
                            (message) => cited.has(message.id),
                        ),
                        state,
                        notes: [],
                        questions: answered,
                    });
                    if (answersStop !== null) {
                        return answersStop;
                    }
                    continue;
                }
                const stretch = ScribeAdoption.next(job.log, job.messages, job.size);
                const reading = stretch.length > 0;
                const first = reading ? stretch[0].position : null;
                const last = reading ? stretch.at(settings.Last).position : null;
                const filed = new Set();
                for (const text of job.log.notes) {
                    filed.add(ScribeText.words(text).join(settings.Space));
                }
                const fresh = job.notes.filter(
                    /**
                     * @param {{ text: string, position: number }} note
                     * @return {boolean}
                     */
                    (note) =>
                        job.places.has(note.position) &&
                        (!reading || note.position <= last) &&
                        !filed.has(ScribeText.words(note.text).join(settings.Space)),
                );
                if (fresh.length > 0) {
                    const positions = new Set();
                    for (const note of fresh) {
                        positions.add(note.position);
                    }
                    const notesStop = await ScribeAdoption.consult(job, {
                        pass: passes.Notes,
                        origin: origins.Notes,
                        first,
                        last,
                        system: ScribeAnalyzer.NotesPrompt,
                        user: ScribeAnalyzer.notesInput(state, job.player, fresh),
                        messages: job.messages.filter(
                            /**
                             * @param {{ position: number }} message
                             * @return {boolean}
                             */
                            (message) => positions.has(message.position),
                        ),
                        state,
                        notes: fresh,
                        questions: [],
                    });
                    if (notesStop !== null) {
                        return notesStop;
                    }
                    state = ScribeReplay.run(job.log, job.order);
                }
                if (!reading) {
                    return ScribeAdoption.finish(job, stops.Done, null);
                }
                if (ScribeIntake.transcript(stretch) === settings.Nothing) {
                    const result = ScribeLog.append(job.log, state, [], { messages: stretch, origin: origins.Story });
                    await job.save(job.log);
                    await ScribeAdoption.report(
                        job,
                        { pass: passes.Story, first, last },
                        result.entry.operations.length,
                        [],
                        result.refused,
                    );
                    continue;
                }
                const storyStop = await ScribeAdoption.consult(job, {
                    pass: passes.Story,
                    origin: origins.Story,
                    first,
                    last,
                    system: ScribeAnalyzer.Prompt,
                    user: ScribeAnalyzer.input(state, job.player, stretch),
                    messages: stretch,
                    state,
                    notes: [],
                    questions: [],
                });
                if (storyStop !== null) {
                    return storyStop;
                }
            }
            return ScribeAdoption.finish(job, stops.Paused, null);
        } catch (error) {
            const described = error !== null && typeof error === 'object' && typeof error.message === 'string';
            return ScribeAdoption.finish(job, stops.Failed, described ? error.message : String(error));
        }
    },
});
/** @file scribe/bench/BenchView.js */
const BenchView = Object.freeze({
    PageSize: 20,

    Settings: Object.freeze({
        FirstPage: 1,
        AuditSize: 30,
        Nothing: '',
        Hash: '#',
        RangeTo: ' to #',
        Span: '-#',
        Joiner: ', ',
        Colon: ': ',
        Space: ' ',
        RelationTo: 'relation to ',
        NotesSource: 'notes #',
        OwnerSource: 'owner',
        Public: 'public',
        Private: 'private',
        Narrowed: 'public, narrowed',
        Nobody: 'nobody',
        FromOpen: ' (from #',
        UntilOpen: ' (until #',
        UntilInside: ' until #',
        Close: ')',
        Stored: ' stored, ',
        Refused: ' refused, ',
        Spent: ' spent, ',
        Single: 1,
        Call: ' call',
        Calls: ' calls',
        Unpriced: ' unpriced, ',
        Of: ' of ',
        Read: ' read',
        Dollar: '$',
        Decimals: 4,
        ThousandsSeparator: ',',
        Words: Object.freeze({
            Pin: 'Pin ',
            Merge: 'Merge ',
            Into: ' into ',
            Split: 'Split ',
            FromSubject: ' from ',
            As: ' as ',
            Distinct: 'Keep ',
            And: ' and ',
            Apart: ' apart',
            Narrow: 'Narrow the scene starting at ',
            Widen: 'Widen ',
            To: ' to ',
            Add: 'Add ',
            Remove: 'Remove ',
            Unalias: 'Unalias ',
            Answer: 'Answer ',
            Dismiss: 'Dismiss ',
        }),
        Random: Object.freeze({
            Increment: 0x6d2b79f5,
            FirstShift: 15,
            SecondShift: 7,
            ThirdShift: 14,
            Odd: 1,
            Mixer: 61,
            Range: 4294967296,
        }),

        /**
         * @return {RegExp}
         */
        get Thousands() {
            return /\B(?=(\d{3})+(?!\d))/g;
        },
    }),

    /**
     * @param {*} page
     * @param {number} pages
     * @return {number}
     */
    clamp(page, pages) {
        const first = BenchView.Settings.FirstPage;
        const asked = Number.isSafeInteger(page) && page >= first ? page : first;
        return Math.min(asked, pages);
    },

    /**
     * @param {readonly object[]} items
     * @param {number} page
     * @return {{ rows: object[], pages: number }}
     */
    page(items, page) {
        const size = BenchView.PageSize;
        const pages = Math.max(BenchView.Settings.FirstPage, Math.ceil(items.length / size));
        const current = BenchView.clamp(page, pages);
        return { rows: items.slice((current - 1) * size, current * size), pages };
    },

    /**
     * @param {object} state
     * @return {Map<string, string>}
     */
    labels(state) {
        const labels = new Map();
        for (const subject of state.subjects) {
            labels.set(subject.id, subject.label);
        }
        return labels;
    },

    /**
     * @param {object} state
     * @return {Map<string, object>}
     */
    facts(state) {
        const facts = new Map();
        for (const fact of state.facts) {
            facts.set(fact.id, fact);
        }
        return facts;
    },

    /**
     * @param {number} number
     * @return {string}
     */
    count(number) {
        const settings = BenchView.Settings;
        return String(number).replace(settings.Thousands, settings.ThousandsSeparator);
    },

    /**
     * @param {object} state
     * @return {object|null}
     */
    running(state) {
        let found = null;
        for (const scene of state.scenes) {
            if (found === null || scene.lastPosition >= found.lastPosition) {
                found = scene;
            }
        }
        return found;
    },

    /**
     * @param {{ category: string, target: string|null, targetText: string|null }} fact
     * @param {Map<string, string>} labels
     * @return {string}
     */
    category(fact, labels) {
        if (fact.category !== ScribeCategory.Settings.RelationCategory) {
            return fact.category;
        }
        return BenchView.Settings.RelationTo + (fact.target === null ? fact.targetText : labels.get(fact.target));
    },

    /**
     * @param {{ origin: string, position: number }} fact
     * @return {string}
     */
    source(fact) {
        const settings = BenchView.Settings;
        if (fact.origin === ScribeLog.Origin.Operator) {
            return settings.OwnerSource;
        }
        if (fact.origin === ScribeLog.Origin.Notes) {
            return settings.NotesSource + fact.position;
        }
        return settings.Hash + fact.position;
    },

    /**
     * @param {object} state
     * @param {object} fact
     * @param {Map<string, string>} labels
     * @return {string}
     */
    audience(state, fact, labels) {
        const heard = ScribeKnowledge.audience(state, fact);
        if (heard === ScribeKnowledge.Everyone) {
            return ScribeKnowledge.Everyone;
        }
        return heard
            .map(
                /**
                 * @param {string} id
                 * @return {string}
                 */
                (id) => labels.get(id),
            )
            .join(BenchView.Settings.Joiner);
    },

    /**
     * @param {object} state
     * @param {string} query
     * @param {number} page
     * @return {{ rows: Array<{ id: string, label: string, kind: string, facts: number, present: boolean }>, pages: number }}
     */
    subjects(state, query, page) {
        const settings = BenchView.Settings;
        const running = BenchView.running(state);
        const present = new Set();
        for (const attendee of running === null ? [] : running.present) {
            present.add(attendee.subject);
        }
        const counts = new Map();
        for (const fact of state.facts) {
            if (fact.status === ScribeReplay.Status.InForce) {
                counts.set(fact.subject, (counts.get(fact.subject) ?? 0) + 1);
            }
        }
        const wanted = query.trim().toLowerCase();
        const rows = state.subjects
            .filter(
                /**
                 * @param {{ label: string, name: string, aka: readonly string[], mergedInto: string|null }} subject
                 * @return {boolean}
                 */
                (subject) =>
                    subject.mergedInto === null &&
                    (wanted === settings.Nothing ||
                        [subject.label, subject.name, ...subject.aka].some(
                            /**
                             * @param {string} written
                             * @return {boolean}
                             */
                            (written) => written.toLowerCase().includes(wanted),
                        )),
            )
            .map(
                /**
                 * @param {{ id: string, label: string, kind: string }} subject
                 * @return {{ id: string, label: string, kind: string, facts: number, present: boolean }}
                 */
                (subject) => ({
                    id: subject.id,
                    label: subject.label,
                    kind: subject.kind,
                    facts: counts.get(subject.id) ?? 0,
                    present: present.has(subject.id),
                }),
            );
        rows.sort(
            /**
             * @param {{ label: string, facts: number, present: boolean }} first
             * @param {{ label: string, facts: number, present: boolean }} second
             * @return {number}
             */
            (first, second) =>
                Number(second.present) - Number(first.present) ||
                second.facts - first.facts ||
                first.label.localeCompare(second.label),
        );
        return BenchView.page(rows, page);
    },

    /**
     * @param {object} state
     * @param {string} id
     * @return {{ id: string, heading: string, kind: string, aka: readonly string[], facts: object[] }|null}
     */
    subject(state, id) {
        const found = state.subjects.find(
            /**
             * @param {{ id: string }} candidate
             * @return {boolean}
             */
            (candidate) => candidate.id === id,
        );
        if (found === undefined) {
            return null;
        }
        const subject =
            found.mergedInto === null
                ? found
                : state.subjects.find(
                      /**
                       * @param {{ id: string }} candidate
                       * @return {boolean}
                       */
                      (candidate) => candidate.id === found.mergedInto,
                  );
        const labels = BenchView.labels(state);
        const facts = state.facts
            .filter(
                /**
                 * @param {{ subject: string }} fact
                 * @return {boolean}
                 */
                (fact) => fact.subject === subject.id,
            )
            .map(
                /**
                 * @param {object} fact
                 * @return {object}
                 */
                (fact) => ({
                    id: fact.id,
                    category: BenchView.category(fact, labels),
                    text: fact.text,
                    source: BenchView.source(fact),
                    status: fact.status,
                    audience: BenchView.audience(state, fact, labels),
                    hidden: fact.hidden,
                    pinned: fact.pinned,
                }),
            );
        return { id: subject.id, heading: subject.label, kind: subject.kind, aka: subject.aka, facts };
    },

    /**
     * @param {object} scene
     * @param {Map<string, string>} labels
     * @return {{ id: string, day: number, range: string, place: string, reach: string, present: string, summary: string }}
     */
    scene(scene, labels) {
        const settings = BenchView.Settings;
        let reach = settings.Private;
        if (scene.reach === ScribeAnswer.Reach.Public) {
            reach = scene.narrowed ? settings.Narrowed : settings.Public;
        }
        const present = scene.present.map(
            /**
             * @param {{ subject: string, from: number|null, until: number|null }} attendee
             * @return {string}
             */
            (attendee) => {
                const label = labels.get(attendee.subject);
                if (attendee.from !== null && attendee.until !== null) {
                    return label + settings.FromOpen + attendee.from + settings.UntilInside + attendee.until + settings.Close;
                }
                if (attendee.from !== null) {
                    return label + settings.FromOpen + attendee.from + settings.Close;
                }
                if (attendee.until !== null) {
                    return label + settings.UntilOpen + attendee.until + settings.Close;
                }
                return label;
            },
        );
        return {
            id: scene.id,
            day: scene.day,
            range: settings.Hash + scene.firstPosition + settings.Span + scene.lastPosition,
            place: scene.place,
            reach,
            present: present.length === 0 ? settings.Nobody : present.join(settings.Joiner),
            summary: scene.summary,
        };
    },

    /**
     * @param {object} state
     * @param {number} page
     * @return {{ rows: object[], pages: number }}
     */
    timeline(state, page) {
        const labels = BenchView.labels(state);
        return BenchView.page(
            state.scenes.map(
                /**
                 * @param {object} scene
                 * @return {object}
                 */
                (scene) => BenchView.scene(scene, labels),
            ),
            page,
        );
    },

    /**
     * @param {object} state
     * @return {{ conflicts: object[], lookAlikes: object[], publicScenes: object[], questions: object[], refinements: object[], aliases: object[] }}
     */
    rulings(state) {
        const labels = BenchView.labels(state);
        const facts = BenchView.facts(state);
        const conflicts = state.conflicts.map(
            /**
             * @param {{ subject: string, category: string, established: string|null, others: readonly string[] }} conflict
             * @return {object}
             */
            (conflict) => {
                const ids = conflict.established === null ? conflict.others : [conflict.established, ...conflict.others];
                return {
                    subject: conflict.subject,
                    label: labels.get(conflict.subject),
                    category: conflict.category,
                    established: conflict.established,
                    values: ids.map(
                        /**
                         * @param {string} id
                         * @return {{ fact: string, text: string, source: string, hidden: boolean, established: boolean }}
                         */
                        (id) => {
                            const fact = facts.get(id);
                            return {
                                fact: id,
                                text: fact.text,
                                source: BenchView.source(fact),
                                hidden: fact.hidden,
                                established: id === conflict.established,
                            };
                        },
                    ),
                };
            },
        );
        const lookAlikes = state.lookAlikes.map(
            /**
             * @param {{ first: string, second: string, reason: string }} likeness
             * @return {object}
             */
            (likeness) => ({
                first: likeness.first,
                second: likeness.second,
                firstLabel: labels.get(likeness.first),
                secondLabel: labels.get(likeness.second),
                reason: likeness.reason,
            }),
        );
        const publicScenes = state.scenes
            .filter(
                /**
                 * @param {object} scene
                 * @return {boolean}
                 */
                (scene) => ScribeKnowledge.open(scene),
            )
            .map(
                /**
                 * @param {object} scene
                 * @return {object}
                 */
                (scene) => BenchView.scene(scene, labels),
            );
        const questions = state.questions
            .filter(
                /**
                 * @param {{ dismissed: boolean }} question
                 * @return {boolean}
                 */
                (question) => !question.dismissed,
            )
            .map(
                /**
                 * @param {{ id: string, text: string, position: number, answer: string|null }} question
                 * @return {object}
                 */
                (question) => ({
                    id: question.id,
                    text: question.text,
                    position: question.position,
                    answer: question.answer,
                }),
            );
        const refinements = state.refinements.map(
            /**
             * @param {{ from: string, to: string }} refinement
             * @return {object}
             */
            (refinement) => {
                const fuller = facts.get(refinement.to);
                return {
                    label: labels.get(fuller.subject),
                    category: BenchView.category(fuller, labels),
                    from: facts.get(refinement.from).text,
                    to: fuller.text,
                };
            },
        );
        const aliases = state.aliases.map(
            /**
             * @param {{ subject: string, name: string }} alias
             * @return {object}
             */
            (alias) => ({ subject: alias.subject, label: labels.get(alias.subject), name: alias.name }),
        );
        return { conflicts, lookAlikes, publicScenes, questions, refinements, aliases };
    },

    Summaries: Object.freeze({
        /**
         * @param {{ category: string, text: string }} operation
         * @return {string}
         */
        Pin(operation) {
            const settings = BenchView.Settings;
            return settings.Words.Pin + operation.category + settings.Colon + operation.text;
        },

        /**
         * @param {{ from: string, into: string }} operation
         * @return {string}
         */
        Merge(operation) {
            const words = BenchView.Settings.Words;
            return words.Merge + operation.from + words.Into + operation.into;
        },

        /**
         * @param {{ subject: string, label: string, facts: readonly string[] }} operation
         * @return {string}
         */
        Split(operation) {
            const settings = BenchView.Settings;
            const words = settings.Words;
            return (
                words.Split +
                operation.facts.join(settings.Joiner) +
                words.FromSubject +
                operation.subject +
                words.As +
                operation.label
            );
        },

        /**
         * @param {{ first: string, second: string }} operation
         * @return {string}
         */
        Distinct(operation) {
            const words = BenchView.Settings.Words;
            return words.Distinct + operation.first + words.And + operation.second + words.Apart;
        },

        /**
         * @param {{ scene: string }} operation
         * @return {string}
         */
        Narrow(operation) {
            return BenchView.Settings.Words.Narrow + operation.scene;
        },

        /**
         * @param {{ fact: string, to: string|readonly string[] }} operation
         * @return {string}
         */
        Widen(operation) {
            const settings = BenchView.Settings;
            const to = operation.to === ScribeKnowledge.Everyone ? operation.to : operation.to.join(settings.Joiner);
            return settings.Words.Widen + operation.fact + settings.Words.To + to;
        },

        /**
         * @param {{ category: string, targetText: string|null, text: string }} operation
         * @return {string}
         */
        AddFact(operation) {
            const settings = BenchView.Settings;
            const category =
                operation.category === ScribeCategory.Settings.RelationCategory
                    ? settings.RelationTo + operation.targetText
                    : operation.category;
            return settings.Words.Add + category + settings.Colon + operation.text;
        },

        /**
         * @param {{ fact: string, mark: { text: string } }} operation
         * @return {string}
         */
        RemoveFact(operation) {
            const settings = BenchView.Settings;
            return settings.Words.Remove + operation.fact + settings.Colon + operation.mark.text;
        },

        /**
         * @param {{ subject: string, name: string }} operation
         * @return {string}
         */
        Unalias(operation) {
            const words = BenchView.Settings.Words;
            return words.Unalias + operation.name + words.FromSubject + operation.subject;
        },

        /**
         * @param {{ question: string, text: string }} operation
         * @return {string}
         */
        Answer(operation) {
            const settings = BenchView.Settings;
            return settings.Words.Answer + operation.question + settings.Colon + operation.text;
        },

        /**
         * @param {{ question: string, questionText: string }} operation
         * @return {string}
         */
        Dismiss(operation) {
            const settings = BenchView.Settings;
            return settings.Words.Dismiss + operation.question + settings.Colon + operation.questionText;
        },
    }),

    /**
     * @param {{ entries: readonly object[] }} log
     * @return {Array<{ sequence: number, type: string, summary: string }>}
     */
    made(log) {
        const rulings = ScribeLog.Ruling;
        const owned = log.entries.filter(
            /**
             * @param {{ kind: string, withdrawn: boolean }} entry
             * @return {boolean}
             */
            (entry) => entry.kind === ScribeLog.Kind.Operator && !entry.withdrawn,
        );
        const answeredIds = new Set();
        const answeredWordings = new Set();
        for (const entry of owned) {
            const [operation] = entry.operations;
            if (operation.type === rulings.Answer) {
                answeredIds.add(operation.question);
                answeredWordings.add(ScribeReplay.wording(operation.questionText));
            }
        }
        const rows = [];
        for (const entry of owned) {
            const [operation] = entry.operations;
            const filed =
                operation.type === rulings.Dismiss &&
                (answeredIds.has(operation.question) ||
                    answeredWordings.has(ScribeReplay.wording(operation.questionText)));
            if (filed) {
                continue;
            }
            rows.unshift({
                sequence: entry.sequence,
                type: operation.type,
                summary: BenchView.Summaries[operation.type](operation),
            });
        }
        return rows;
    },

    /**
     * @param {object} state
     * @return {number}
     */
    blocking(state) {
        const likeness = ScribeReplay.Likeness;
        const blocked = state.lookAlikes.filter(
            /**
             * @param {{ reason: string }} item
             * @return {boolean}
             */
            (item) => item.reason === likeness.SameName || item.reason === likeness.Alias,
        );
        return state.conflicts.length + blocked.length;
    },

    /**
     * @param {number} seed
     * @return {() => number}
     */
    random(seed) {
        const settings = BenchView.Settings.Random;
        let current = seed >>> 0;
        return (
            /**
             * @return {number}
             */
            () => {
                current = (current + settings.Increment) >>> 0;
                let mixed = Math.imul(current ^ (current >>> settings.FirstShift), settings.Odd | current);
                mixed = (mixed + Math.imul(mixed ^ (mixed >>> settings.SecondShift), settings.Mixer | mixed)) ^ mixed;
                return ((mixed ^ (mixed >>> settings.ThirdShift)) >>> 0) / settings.Range;
            }
        );
    },

    /**
     * @param {object} state
     * @param {readonly object[]} messages
     * @param {number} seed
     * @return {Array<{ fact: string, subject: string, category: string, text: string, position: number, message: string }>}
     */
    audit(state, messages, seed) {
        const settings = BenchView.Settings;
        const pool = state.facts.filter(
            /**
             * @param {{ status: string, origin: string }} fact
             * @return {boolean}
             */
            (fact) => fact.status === ScribeReplay.Status.InForce && fact.origin === ScribeLog.Origin.Story,
        );
        const next = BenchView.random(seed);
        for (let index = pool.length - 1; index > 0; index--) {
            const swap = Math.floor(next() * (index + 1));
            [pool[index], pool[swap]] = [pool[swap], pool[index]];
        }
        const texts = new Map();
        for (const message of messages) {
            texts.set(message.id, message.text);
        }
        const labels = BenchView.labels(state);
        return pool.slice(0, settings.AuditSize).map(
            /**
             * @param {object} fact
             * @return {{ fact: string, subject: string, category: string, text: string, position: number, message: string }}
             */
            (fact) => ({
                fact: fact.id,
                subject: labels.get(fact.subject),
                category: BenchView.category(fact, labels),
                text: fact.text,
                position: fact.position,
                message: texts.get(fact.cite) ?? settings.Nothing,
            }),
        );
    },

    /**
     * @param {number} amount
     * @return {string}
     */
    money(amount) {
        const settings = BenchView.Settings;
        return settings.Dollar + amount.toFixed(settings.Decimals);
    },

    /**
     * @param {{ pass: string, first: number|null, last: number|null, read: number, total: number, spent: number, unpriced: number, stored: number, refusedLines: readonly object[], refusedOperations: readonly object[] }} report
     * @return {string}
     */
    progress(report) {
        const settings = BenchView.Settings;
        const where =
            report.pass === ScribeAdoption.Pass.Story
                ? settings.Hash + report.first + settings.RangeTo + report.last
                : report.pass;
        const refused = report.refusedLines.length + report.refusedOperations.length;
        const unpriced =
            report.unpriced === 0
                ? settings.Nothing
                : BenchView.calls(report.unpriced) + settings.Unpriced;
        return (
            where +
            settings.Colon +
            report.stored +
            settings.Stored +
            refused +
            settings.Refused +
            BenchView.money(report.spent) +
            settings.Spent +
            unpriced +
            BenchView.count(report.read) +
            settings.Of +
            BenchView.count(report.total) +
            settings.Read
        );
    },

    /**
     * @param {number} count
     * @return {string}
     */
    calls(count) {
        const settings = BenchView.Settings;
        return BenchView.count(count) + (count === settings.Single ? settings.Call : settings.Calls);
    },
});
/** @file scribe/page/ZetaSource.js */
const ZetaSource = Object.freeze({
    End: Object.freeze({
        NoCursor: 'NoCursor',
        EmptyPage: 'EmptyPage',
        RepeatedCursor: 'RepeatedCursor',
        NothingNew: 'NothingNew',
        Limit: 'Limit',
        Failed: 'Failed',
    }),

    Settings: Object.freeze({
        ApiOrigin: 'https://api.zeta-ai.io',
        PageSize: 31,
        PauseMs: 500,
        MostPages: 2000,
        Tries: 3,
        FirstTry: 1,
        RetryPauseMs: 2000,
        TimeoutMs: 30000,
        TooMany: 429,
        FirstServerError: 500,
        FirstSuccess: 200,
        LastSuccess: 299,
        RoomsPath: '/v1/rooms/',
        MessagesPath: '/messages',
        QueryMark: '?',
        LimitName: 'limit',
        CursorName: 'cursor',
        AuthorizationHeader: 'Authorization',
        AuthorizationName: 'authorization',
        ReadMethod: 'GET',
        ReadMethods: Object.freeze(['GET', 'HEAD', 'OPTIONS']),
        ShortestToken: 16,
        Finished: 'loadend',
        Once: Object.freeze({ once: true }),
        InitPosition: 1,
        RequestTag: '[object Request]',
        MapTag: '[object Map]',
        IdGroup: 1,
        Nothing: '',
        ObjectType: 'object',
        StringType: 'string',
        NumberType: 'number',
        FunctionType: 'function',

        /**
         * @return {RegExp}
         */
        get RoomPath() {
            return /^(?:\/[a-z]{2,3}(?:-[a-z0-9]{2,8})?)?\/rooms\/([^/]+)/i;
        },

        /**
         * @return {RegExp}
         */
        get Scheme() {
            return /^\S+\s+/;
        },

        /**
         * @return {RegExp}
         */
        get Junk() {
            return /(?:^|[^a-z0-9\-._~+/=])(?:undefined|null|\[object|false|nan)(?![a-z0-9\-._~+/=])/;
        },
        Messages: Object.freeze({
            HttpPrefix: 'Zeta answered HTTP ',
            Shape: 'Zeta answered in an unexpected shape',
            Unreachable: 'Zeta could not be reached',
            Timeout: 'Zeta did not answer in time',
            NoPause: 'Could not pause between requests',
            NoLogin: 'No login seen yet',
            NoRoom: 'No chat is open',
        }),
    }),

    Watchers: new WeakMap(),

    Requests: new WeakMap(),

    /**
     * @param {string} pathname
     * @return {string|null}
     */
    room(pathname) {
        const settings = ZetaSource.Settings;
        const match = settings.RoomPath.exec(pathname);
        if (match === null) {
            return null;
        }
        return ZetaSource.quietly(null, decodeURIComponent, match[settings.IdGroup]);
    },

    /**
     * @param {*} value
     * @return {boolean}
     */
    isObject(value) {
        return typeof value === ZetaSource.Settings.ObjectType && value !== null && !Array.isArray(value);
    },

    /**
     * @param {*} value
     * @return {boolean}
     */
    filled(value) {
        const settings = ZetaSource.Settings;
        return typeof value === settings.StringType && value !== settings.Nothing;
    },

    /**
     * @param {*} fallback
     * @param {Function} action
     * @param {...*} values
     * @return {*}
     */
    quietly(fallback, action, ...values) {
        try {
            return action(...values);
        } catch {
            return fallback;
        }
    },

    /**
     * @param {string} message
     * @param {number|null} status
     * @param {boolean} retryable
     * @return {Error}
     */
    failure(message, status, retryable) {
        const error = new Error(message);
        error.status = status;
        error.retryable = retryable;
        return error;
    },

    /**
     * @param {{ pageWindow: object }} state
     * @param {string} address
     * @return {string|null}
     */
    apiPath(state, address) {
        const resolved = new URL(address, state.pageWindow.location.href);
        return resolved.origin === ZetaSource.Settings.ApiOrigin ? resolved.pathname : null;
    },

    /**
     * @param {string} path
     * @param {*} method
     * @return {Readonly<{ method: string, path: string }>|null}
     */
    traffic(path, method) {
        const verb = String(method).toUpperCase();
        return ZetaSource.Settings.ReadMethods.includes(verb) ? null : Object.freeze({ method: verb, path });
    },

    /**
     * @param {{ token: string|null }} state
     * @param {*} value
     * @return {void}
     */
    remember(state, value) {
        const settings = ZetaSource.Settings;
        if (typeof value !== settings.StringType) {
            return;
        }
        const text = value.trim();
        const credentials = text.toLowerCase().replace(settings.Scheme, settings.Nothing);
        if (text.length >= settings.ShortestToken && !settings.Junk.test(credentials)) {
            state.token = text;
        }
    },

    /**
     * @param {*} headers
     * @return {*}
     */
    authorization(headers) {
        const settings = ZetaSource.Settings;
        if (headers === undefined || headers === null) {
            return null;
        }
        const listed = Array.isArray(headers) || Object.prototype.toString.call(headers) === settings.MapTag;
        const pairs = listed && typeof headers[Symbol.iterator] === settings.FunctionType;
        if (!pairs && typeof headers.get === settings.FunctionType) {
            return headers.get(settings.AuthorizationName);
        }
        let found = null;
        for (const [name, value] of pairs ? headers : Object.entries(headers)) {
            if (String(name).toLowerCase() === settings.AuthorizationName) {
                found = value;
            }
        }
        return found;
    },

    /**
     * @param {{ pageWindow: object, token: string|null, stopped: boolean }} state
     * @param {*} input
     * @param {*} init
     * @return {Readonly<{ method: string, path: string }>|null}
     */
    fetched(state, input, init) {
        const settings = ZetaSource.Settings;
        if (state.stopped) {
            return null;
        }
        const carried =
            typeof input === settings.ObjectType && input !== null && Object.prototype.toString.call(input) === settings.RequestTag;
        const path = ZetaSource.apiPath(state, carried ? input.url : String(input));
        if (path === null) {
            return null;
        }
        const given = init?.headers;
        const headers = given === undefined || given === null ? (carried ? input.headers : null) : given;
        ZetaSource.remember(state, ZetaSource.authorization(headers));
        return ZetaSource.traffic(path, init?.method ?? (carried ? input.method : settings.ReadMethod));
    },

    /**
     * @param {{ callbacks: Function[], stopped: boolean }} state
     * @param {Readonly<{ method: string, path: string }>} traffic
     * @return {void}
     */
    notify(state, traffic) {
        if (state.stopped) {
            return;
        }
        for (const callback of state.callbacks) {
            ZetaSource.quietly(null, callback, traffic);
        }
    },

    /**
     * @param {{ callbacks: Function[], stopped: boolean }} state
     * @param {*} result
     * @param {Readonly<{ method: string, path: string }>|null} traffic
     * @return {void}
     */
    settled(state, result, traffic) {
        if (traffic === null) {
            return;
        }

        /**
         * @return {void}
         */
        const finished = () => {
            ZetaSource.notify(state, traffic);
        };
        result.then(finished, finished);
    },

    /**
     * @param {object} request
     * @return {void}
     */
    forget(request) {
        const record = ZetaSource.Requests.get(request);
        ZetaSource.Requests.delete(request);
        if (record !== undefined && record.listener !== null) {
            request.removeEventListener(ZetaSource.Settings.Finished, record.listener);
        }
    },

    /**
     * @param {{ pageWindow: object, stopped: boolean }} state
     * @param {object} request
     * @param {*} method
     * @param {*} address
     * @return {void}
     */
    opened(state, request, method, address) {
        if (state.stopped) {
            return;
        }
        ZetaSource.forget(request);
        const path = ZetaSource.apiPath(state, String(address));
        if (path !== null) {
            ZetaSource.Requests.set(request, { traffic: ZetaSource.traffic(path, method), listener: null });
        }
    },

    /**
     * @param {{ token: string|null, stopped: boolean }} state
     * @param {object} request
     * @param {*} name
     * @param {*} value
     * @return {void}
     */
    headed(state, request, name, value) {
        if (!state.stopped && ZetaSource.Requests.has(request) && String(name).toLowerCase() === ZetaSource.Settings.AuthorizationName) {
            ZetaSource.remember(state, value);
        }
    },

    /**
     * @param {{ callbacks: Function[], stopped: boolean }} state
     * @param {object} request
     * @return {boolean}
     */
    sending(state, request) {
        const settings = ZetaSource.Settings;
        const record = ZetaSource.Requests.get(request);
        if (state.stopped || record === undefined || record.traffic === null || record.listener !== null) {
            return false;
        }

        /**
         * @return {void}
         */
        record.listener = () => {
            if (ZetaSource.Requests.get(request) === record) {
                ZetaSource.Requests.delete(request);
            }
            ZetaSource.notify(state, record.traffic);
        };
        request.addEventListener(settings.Finished, record.listener, settings.Once);
        return true;
    },

    /**
     * @param {object} owner
     * @param {string} name
     * @return {Function|null}
     */
    held(owner, name) {
        const value = owner[name];
        return typeof value === ZetaSource.Settings.FunctionType ? value : null;
    },

    /**
     * @param {object} owner
     * @param {string} name
     * @param {Function} wrapper
     * @param {*} exporter
     * @return {Function|null}
     */
    install(owner, name, wrapper, exporter) {
        const settings = ZetaSource.Settings;
        const exported = typeof exporter === settings.FunctionType ? exporter(wrapper) : wrapper;
        if (typeof exported !== settings.FunctionType) {
            return null;
        }
        owner[name] = exported;
        return exported;
    },

    /**
     * @param {object} owner
     * @param {string} name
     * @param {Function|null} current
     * @param {Function|null} original
     * @return {void}
     */
    restore(owner, name, current, original) {
        if (current !== null && owner[name] === current) {
            owner[name] = original;
        }
    },

    /**
     * @param {object} pageWindow
     * @param {(wrapper: Function) => Function} [exporter]
     * @return {Readonly<{ token: () => string|null, onTraffic: (callback: Function) => void, stop: () => void }>}
     */
    watch(pageWindow, exporter) {
        const known = ZetaSource.Watchers.get(pageWindow);
        if (known !== undefined) {
            return known;
        }
        const prototype = ZetaSource.quietly(
            null,
            /**
             * @param {object} target
             * @return {object}
             */
            (target) => target.XMLHttpRequest.prototype,
            pageWindow,
        );
        const owners = { fetch: pageWindow, open: prototype, setRequestHeader: prototype, send: prototype };
        const originals = {};
        const installed = {};
        for (const name of Object.keys(owners)) {
            originals[name] = ZetaSource.quietly(null, ZetaSource.held, owners[name], name);
        }
        const state = { pageWindow, token: null, callbacks: [], stopped: false };
        const wrappers = {
            /**
             * @param {*} input
             * @return {*}
             */
            fetch(input) {
                'use strict';
                const init = arguments[ZetaSource.Settings.InitPosition];
                const traffic = ZetaSource.quietly(null, ZetaSource.fetched, state, input, init);
                const result = originals.fetch.apply(this, arguments);
                ZetaSource.quietly(null, ZetaSource.settled, state, result, traffic);
                return result;
            },

            /**
             * @param {*} method
             * @param {*} url
             * @return {*}
             */
            open(method, url) {
                'use strict';
                const result = originals.open.apply(this, arguments);
                ZetaSource.quietly(null, ZetaSource.opened, state, this, method, url);
                return result;
            },

            /**
             * @param {*} name
             * @param {*} value
             * @return {*}
             */
            setRequestHeader(name, value) {
                'use strict';
                const result = originals.setRequestHeader.apply(this, arguments);
                ZetaSource.quietly(null, ZetaSource.headed, state, this, name, value);
                return result;
            },

            /**
             * @return {*}
             * @throws {*}
             */
            send() {
                'use strict';
                const created = ZetaSource.quietly(false, ZetaSource.sending, state, this);
                try {
                    return originals.send.apply(this, arguments);
                } catch (error) {
                    if (created) {
                        ZetaSource.quietly(null, ZetaSource.forget, this);
                    }
                    throw error;
                }
            },
        };
        for (const name of Object.keys(owners)) {
            installed[name] =
                originals[name] === null ? null : ZetaSource.quietly(null, ZetaSource.install, owners[name], name, wrappers[name], exporter);
        }
        const handle = Object.freeze({
            /**
             * @return {string|null}
             */
            token: () => state.token,

            /**
             * @param {(traffic: Readonly<{ method: string, path: string }>) => void} callback
             * @return {void}
             */
            onTraffic: (callback) => {
                state.callbacks.push(callback);
            },

            /**
             * @return {void}
             */
            stop: () => {
                state.stopped = true;
                for (const name of Object.keys(owners)) {
                    ZetaSource.quietly(null, ZetaSource.restore, owners[name], name, installed[name], originals[name]);
                }
                if (ZetaSource.Watchers.get(pageWindow) === handle) {
                    ZetaSource.Watchers.delete(pageWindow);
                }
            },
        });
        ZetaSource.quietly(
            null,
            /**
             * @param {object} target
             * @return {WeakMap<object, object>}
             */
            (target) => ZetaSource.Watchers.set(target, handle),
            pageWindow,
        );
        return handle;
    },

    /**
     * @param {{ token: *, roomId: *, pause: * }} request
     * @return {void}
     * @throws {Error}
     */
    ready(request) {
        const settings = ZetaSource.Settings;
        const words = settings.Messages;
        if (!ZetaSource.filled(request.token)) {
            throw ZetaSource.failure(words.NoLogin, null, false);
        }
        if (!ZetaSource.filled(request.roomId) || ZetaSource.quietly(null, encodeURIComponent, request.roomId) === null) {
            throw ZetaSource.failure(words.NoRoom, null, false);
        }
        if (typeof request.pause !== settings.FunctionType) {
            throw ZetaSource.failure(words.NoPause, null, false);
        }
    },

    /**
     * @param {{ pause: (milliseconds: number) => Promise<void> }} request
     * @param {number} milliseconds
     * @return {Promise<void>}
     * @throws {Error}
     */
    async wait(request, milliseconds) {
        const pause = request.pause;
        try {
            await pause(milliseconds);
        } catch {
            throw ZetaSource.failure(ZetaSource.Settings.Messages.NoPause, null, false);
        }
    },

    /**
     * @param {{ fetch: Function, token: string, roomId: string, pause: (milliseconds: number) => Promise<void> }} request
     * @param {string|null} cursor
     * @return {Promise<{ messages: object[], nextCursor: string|null, skipped: number }>}
     * @throws {Error}
     */
    async exchange(request, cursor) {
        const settings = ZetaSource.Settings;
        const words = settings.Messages;
        const query = new URLSearchParams();
        query.set(settings.LimitName, String(settings.PageSize));
        if (cursor !== null) {
            query.set(settings.CursorName, cursor);
        }
        const room = encodeURIComponent(request.roomId);
        const address = `${settings.ApiOrigin}${settings.RoomsPath}${room}${settings.MessagesPath}${settings.QueryMark}${query.toString()}`;
        const send = request.fetch;

        /**
         * @return {Promise<{ status: number, raw: string }>}
         */
        const reach = async () => {
            let response = null;
            try {
                response = await send(address, { headers: { [settings.AuthorizationHeader]: request.token } });
            } catch {
                throw ZetaSource.failure(words.Unreachable, null, true);
            }
            let status = null;
            try {
                const given = response.status;
                status = Number.isFinite(given) ? given : null;
            } catch {
                status = null;
            }
            if (status === null) {
                throw ZetaSource.failure(words.Shape, null, false);
            }
            if (status < settings.FirstSuccess || status > settings.LastSuccess) {
                const busy = status === settings.TooMany || status >= settings.FirstServerError;
                throw ZetaSource.failure(`${words.HttpPrefix}${status}`, status, busy);
            }
            try {
                return { status, raw: await response.text() };
            } catch {
                throw ZetaSource.failure(words.Shape, status, false);
            }
        };
        const answered = await Promise.race([
            reach(),
            ZetaSource.wait(request, settings.TimeoutMs).then(
                /**
                 * @return {null}
                 */
                () => null,
            ),
        ]);
        if (answered === null) {
            throw ZetaSource.failure(words.Timeout, null, true);
        }
        let body = null;
        try {
            body = JSON.parse(answered.raw);
        } catch {
            body = null;
        }
        if (!ZetaSource.isObject(body) || !Array.isArray(body.messages)) {
            throw ZetaSource.failure(words.Shape, answered.status, false);
        }
        const messages = [];
        for (const message of body.messages) {
            if (!ZetaSource.isObject(message)) {
                continue;
            }
            if (typeof message.id === settings.NumberType) {
                message.id = String(message.id);
            }
            if (ZetaSource.filled(message.id)) {
                messages.push(message);
            }
        }
        const skipped = body.messages.length - messages.length;
        if (messages.length === 0 && skipped > 0) {
            throw ZetaSource.failure(words.Shape, answered.status, false);
        }
        const offered = body.nextCursor;
        const finite = typeof offered === settings.NumberType && Number.isFinite(offered);
        const absent = offered === undefined || offered === null || offered === false;
        if (!finite && !absent && typeof offered !== settings.StringType) {
            throw ZetaSource.failure(words.Shape, answered.status, false);
        }
        const nextCursor = finite || ZetaSource.filled(offered) ? String(offered) : null;
        return { messages, nextCursor, skipped };
    },

    /**
     * @param {{ fetch: Function, token: string, roomId: string, pause: (milliseconds: number) => Promise<void> }} request
     * @param {string|null} cursor
     * @return {Promise<{ messages: object[], nextCursor: string|null, skipped: number }>}
     * @throws {Error}
     */
    async page(request, cursor) {
        const settings = ZetaSource.Settings;
        let failed = null;
        for (let number = settings.FirstTry; number <= settings.Tries; number++) {
            if (failed !== null) {
                await ZetaSource.wait(request, settings.RetryPauseMs * (number - settings.FirstTry));
            }
            try {
                return await ZetaSource.exchange(request, cursor);
            } catch (error) {
                if (error.retryable !== true) {
                    throw error;
                }
                failed = error;
            }
        }
        throw failed;
    },

    /**
     * @param {Array<{ id: string, messageTime: * }>} messages
     * @return {object[]}
     */
    ordered(messages) {
        const settings = ZetaSource.Settings;
        const seen = new Set();
        const kept = [];
        for (const message of messages) {
            if (!seen.has(message.id)) {
                seen.add(message.id);
                kept.push(message);
            }
        }
        const timed = [];
        let previous = Number.NEGATIVE_INFINITY;
        for (const message of kept.reverse()) {
            const parsed = typeof message.messageTime === settings.StringType ? Date.parse(message.messageTime) : Number.NaN;
            previous = Number.isNaN(parsed) ? previous : parsed;
            timed.push({ message, time: previous });
        }
        timed.sort(
            /**
             * @param {{ time: number }} first
             * @param {{ time: number }} second
             * @return {number}
             */
            (first, second) => Number(first.time > second.time) - Number(first.time < second.time),
        );
        return timed.map(
            /**
             * @param {{ message: object }} entry
             * @return {object}
             */
            (entry) => entry.message,
        );
    },

    /**
     * @param {object[]} received
     * @param {string} end
     * @param {string|null} problem
     * @param {number} skipped
     * @return {Readonly<{ messages: object[], end: string, problem: string|null, skipped: number }>}
     */
    outcome(received, end, problem, skipped) {
        return Object.freeze({ messages: ZetaSource.ordered(received), end, problem, skipped });
    },

    /**
     * @param {{ fetch: Function, token: string|null, roomId: string|null, pause: (milliseconds: number) => Promise<void>, onPage?: (count: number) => void }} request
     * @return {Promise<Readonly<{ messages: object[], end: string, problem: string|null, skipped: number }>>}
     * @throws {Error}
     */
    async history(request) {
        const settings = ZetaSource.Settings;
        const ends = ZetaSource.End;
        ZetaSource.ready(request);
        const received = [];
        const distinct = new Set();
        const used = new Set();
        let skipped = 0;
        let cursor = null;
        for (let read = 0; read < settings.MostPages; read++) {
            let page = null;
            try {
                if (cursor !== null) {
                    await ZetaSource.wait(request, settings.PauseMs);
                }
                page = await ZetaSource.page(request, cursor);
            } catch (error) {
                if (received.length === 0) {
                    throw error;
                }
                return ZetaSource.outcome(received, ends.Failed, error.message, skipped);
            }
            skipped += page.skipped;
            const before = distinct.size;
            for (const message of page.messages) {
                received.push(message);
                distinct.add(message.id);
            }
            if (typeof request.onPage === settings.FunctionType) {
                Promise.resolve(ZetaSource.quietly(null, request.onPage, distinct.size)).catch(
                    /**
                     * @return {null}
                     */
                    () => null,
                );
            }
            const next = page.nextCursor;
            let end = null;
            if (page.messages.length === 0) {
                end = ends.EmptyPage;
            } else if (distinct.size === before) {
                end = ends.NothingNew;
            } else if (next === null) {
                end = ends.NoCursor;
            } else if (used.has(next)) {
                end = ends.RepeatedCursor;
            }
            if (end !== null) {
                return ZetaSource.outcome(received, end, null, skipped);
            }
            cursor = next;
            used.add(cursor);
        }
        return ZetaSource.outcome(received, ends.Limit, null, skipped);
    },

    /**
     * @param {{ fetch: Function, token: string|null, roomId: string|null, pause: (milliseconds: number) => Promise<void> }} request
     * @return {Promise<Readonly<{ messages: object[], end: string, problem: string|null, skipped: number }>>}
     * @throws {Error}
     */
    async newest(request) {
        const ends = ZetaSource.End;
        ZetaSource.ready(request);
        const page = await ZetaSource.page(request, null);
        return ZetaSource.outcome(page.messages, page.messages.length === 0 ? ends.EmptyPage : ends.NoCursor, null, page.skipped);
    },
});
/** @file scribe/page/ScribeStore.js */
const ScribeStore = Object.freeze({
    Kind: Object.freeze({
        Campaign: 'campaign',
        Book: 'book',
        Live: 'live',
        Settings: 'settings',
    }),

    Settings: Object.freeze({
        Prefix: 'scribe',
        Separator: ':',
        Key: 'key',
        Types: Object.freeze({
            Head: 'head',
            Part: 'part',
            Claim: 'claim',
            Spent: 'spent',
        }),
        Segments: Object.freeze({
            Head: Object.freeze([4]),
            Part: Object.freeze([6, 7, 8]),
            Claim: Object.freeze([3]),
            Spent: Object.freeze([3]),
        }),
        Position: Object.freeze({
            Prefix: 0,
            Type: 1,
            Room: 2,
            Kind: 3,
            Generation: 4,
            Digest: 5,
            Length: 6,
        }),
        Forms: Object.freeze({
            First: 0,
            Digest: 1,
            Sized: 2,
        }),
        PartCharacters: 500000,
        ClaimStaleMs: 90000,
        FirstGeneration: 1,
        NoGeneration: 0,
        FirstPart: 0,
        LeastParts: 1,
        NoCharacters: 0,
        NoSpending: 0,
        FirstAttempt: 1,
        Attempts: 2,
        FirstHighSurrogate: 0xd800,
        LastHighSurrogate: 0xdbff,
        DigestOffset: 0x811c9dc5,
        DigestPrime: 16777619,
        DigestLength: 8,
        DigestPad: '0',
        Hexadecimal: 16,
        Unsigned: 0,
        Nothing: '',
        ObjectType: 'object',
        StringType: 'string',

        /**
         * @return {RegExp}
         */
        get Count() {
            return /^(?:0|[1-9]\d*)$/;
        },

        /**
         * @return {RegExp}
         */
        get DigestPattern() {
            return /^[0-9a-f]{8}$/;
        },
        Messages: Object.freeze({
            SaveFailed: 'The save failed',
            Unreadable: 'The storage could not be read',
            DamagedPrefix: 'The saved ',
            DamagedSuffix: ' of this chat is damaged',
            KeyFailed: 'The key could not be saved',
            BadArgument: 'The argument is not valid',
            NoGeneration: 'The next generation is out of range',
            PartNotKept: 'A part did not read back as written',
            HeadNotKept: 'The head did not read back as written',
            Overtaken: 'Another save came first',
        }),
    }),

    /**
     * @param {boolean} valid
     * @param {string} argument
     * @return {void}
     * @throws {Error}
     */
    check(valid, argument) {
        if (!valid) {
            throw new Error(`${ScribeStore.Settings.Messages.BadArgument}: ${argument}`);
        }
    },

    /**
     * @param {*} roomId
     * @return {string}
     * @throws {Error}
     */
    room(roomId) {
        ScribeStore.check(typeof roomId === ScribeStore.Settings.StringType && roomId.isWellFormed(), 'roomId');
        return encodeURIComponent(roomId);
    },

    /**
     * @param {*} kind
     * @return {void}
     * @throws {Error}
     */
    checkKind(kind) {
        ScribeStore.check(Object.values(ScribeStore.Kind).includes(kind), 'kind');
    },

    /**
     * @param {...(string|number)} segments
     * @return {string}
     */
    name(...segments) {
        const settings = ScribeStore.Settings;
        return [settings.Prefix, ...segments].join(settings.Separator);
    },

    /**
     * @param {string} room
     * @param {string} kind
     * @param {{ generation: number, characters: number, digest: string|null, form: number }} head
     * @param {number} part
     * @return {string}
     */
    partName(room, kind, head, part) {
        const settings = ScribeStore.Settings;
        const type = settings.Types.Part;
        if (head.form === settings.Forms.Sized) {
            return ScribeStore.name(type, room, kind, head.generation, head.digest, head.characters, part);
        }
        if (head.form === settings.Forms.Digest) {
            return ScribeStore.name(type, room, kind, head.generation, head.digest, part);
        }
        return ScribeStore.name(type, room, kind, head.generation, part);
    },

    /**
     * @param {string} text
     * @return {string}
     */
    digest(text) {
        const settings = ScribeStore.Settings;
        const prime = settings.DigestPrime;
        const length = text.length;
        const multiply = Math.imul;
        let hash = settings.DigestOffset;
        for (let index = settings.NoCharacters; index < length; index++) {
            hash = multiply(hash ^ text.charCodeAt(index), prime);
        }
        return (hash >>> settings.Unsigned).toString(settings.Hexadecimal).padStart(settings.DigestLength, settings.DigestPad);
    },

    /**
     * @param {*} name
     * @return {{ name: string, type: string, room: string, roomId: string, kind: string|null, generation: number|null, digest: string|null, part: number|null }|null}
     */
    describe(name) {
        const settings = ScribeStore.Settings;
        const position = settings.Position;
        if (typeof name !== settings.StringType) {
            return null;
        }
        const segments = name.split(settings.Separator);
        if (segments[position.Prefix] !== settings.Prefix) {
            return null;
        }
        let typeName = null;
        for (const [candidate, value] of Object.entries(settings.Types)) {
            if (segments[position.Type] === value) {
                typeName = candidate;
            }
        }
        if (typeName === null || !settings.Segments[typeName].includes(segments.length)) {
            return null;
        }
        const room = segments[position.Room];
        let roomId = null;
        try {
            roomId = decodeURIComponent(room);
        } catch {
            return null;
        }
        if (encodeURIComponent(roomId) !== room) {
            return null;
        }
        const described = {
            name,
            type: settings.Types[typeName],
            room,
            roomId,
            kind: null,
            generation: null,
            digest: null,
            part: null,
        };
        if (segments.length > position.Kind) {
            described.kind = segments[position.Kind];
            if (!Object.values(ScribeStore.Kind).includes(described.kind)) {
                return null;
            }
        }
        if (described.type === settings.Types.Part) {
            const last = segments.length - 1;
            const counts = [segments[position.Generation], segments[last]];
            if (last > position.Length) {
                counts.push(segments[position.Length]);
            }
            for (const count of counts) {
                if (!settings.Count.test(count) || !Number.isSafeInteger(Number(count))) {
                    return null;
                }
            }
            if (last > position.Digest) {
                described.digest = segments[position.Digest];
                if (!settings.DigestPattern.test(described.digest)) {
                    return null;
                }
            }
            described.generation = Number(segments[position.Generation]);
            described.part = Number(segments[last]);
            if (described.generation < settings.FirstGeneration) {
                return null;
            }
        }
        return described;
    },

    /**
     * @param {{ list: Function }} storage
     * @return {Array<{ name: string, type: string, room: string, roomId: string, kind: string|null, generation: number|null, digest: string|null, part: number|null }>}
     * @throws {Error}
     */
    stored(storage) {
        let names = null;
        try {
            names = storage.list();
        } catch (cause) {
            throw new Error(ScribeStore.Settings.Messages.Unreadable, { cause });
        }
        const found = [];
        for (const name of names) {
            const described = ScribeStore.describe(name);
            if (described !== null) {
                found.push(described);
            }
        }
        return found;
    },

    /**
     * @param {{ get: Function }} storage
     * @param {string} name
     * @return {*}
     * @throws {Error}
     */
    fetch(storage, name) {
        try {
            return storage.get(name, null);
        } catch (cause) {
            throw new Error(ScribeStore.Settings.Messages.Unreadable, { cause });
        }
    },

    /**
     * @param {*} text
     * @return {Object|null}
     */
    decode(text) {
        const settings = ScribeStore.Settings;
        if (typeof text !== settings.StringType) {
            return null;
        }
        let value = null;
        try {
            value = JSON.parse(text);
        } catch {
            return null;
        }
        if (typeof value !== settings.ObjectType || value === null || Array.isArray(value)) {
            return null;
        }
        return value;
    },

    /**
     * @param {*} text
     * @return {{ generation: number, parts: number, characters: number, digest: string|null, form: number }|null}
     */
    headOf(text) {
        const settings = ScribeStore.Settings;
        const forms = settings.Forms;
        const head = ScribeStore.decode(text);
        if (
            head === null
            || !Number.isSafeInteger(head.generation)
            || !Number.isSafeInteger(head.parts)
            || !Number.isSafeInteger(head.characters)
            || head.generation < settings.FirstGeneration
            || head.parts < settings.LeastParts
            || head.characters < settings.NoCharacters
        ) {
            return null;
        }
        const digested = head.digest !== undefined;
        if (digested && (typeof head.digest !== settings.StringType || !settings.DigestPattern.test(head.digest))) {
            return null;
        }
        let form = digested ? forms.Digest : forms.First;
        if (head.form !== undefined) {
            if (head.form !== forms.Sized || !digested) {
                return null;
            }
            form = forms.Sized;
        }
        return {
            generation: head.generation,
            parts: head.parts,
            characters: head.characters,
            digest: digested ? head.digest : null,
            form,
        };
    },

    /**
     * @param {*} text
     * @return {{ tabId: string, at: number }|null}
     */
    claimOf(text) {
        const claim = ScribeStore.decode(text);
        if (claim === null || typeof claim.tabId !== ScribeStore.Settings.StringType || !Number.isFinite(claim.at)) {
            return null;
        }
        return { tabId: claim.tabId, at: claim.at };
    },

    /**
     * @param {string} kind
     * @return {Error}
     */
    damaged(kind) {
        const messages = ScribeStore.Settings.Messages;
        const error = new Error(`${messages.DamagedPrefix}${kind}${messages.DamagedSuffix}`);
        error.damaged = true;
        return error;
    },

    /**
     * @param {{ get: Function, list: Function }} storage
     * @param {string} room
     * @param {string} kind
     * @return {{ value: Object, head: { generation: number, parts: number, characters: number, digest: string|null, form: number } }|null}
     * @throws {Error}
     */
    load(storage, room, kind) {
        const settings = ScribeStore.Settings;
        const types = settings.Types;
        const headName = ScribeStore.name(types.Head, room, kind);
        let text = ScribeStore.fetch(storage, headName);
        for (let attempt = settings.FirstAttempt; ; attempt++) {
            try {
                if (text === null) {
                    for (const described of ScribeStore.stored(storage)) {
                        if (described.type === types.Part && described.room === room && described.kind === kind) {
                            throw ScribeStore.damaged(kind);
                        }
                    }
                    return null;
                }
                const head = ScribeStore.headOf(text);
                if (head === null) {
                    throw ScribeStore.damaged(kind);
                }
                const pieces = [];
                for (let part = settings.FirstPart; part < head.parts; part++) {
                    const piece = ScribeStore.fetch(storage, ScribeStore.partName(room, kind, head, part));
                    if (typeof piece !== settings.StringType) {
                        throw ScribeStore.damaged(kind);
                    }
                    pieces.push(piece);
                }
                const joined = pieces.join(settings.Nothing);
                if (joined.length !== head.characters || (head.digest !== null && ScribeStore.digest(joined) !== head.digest)) {
                    throw ScribeStore.damaged(kind);
                }
                const value = ScribeStore.decode(joined);
                if (value === null) {
                    throw ScribeStore.damaged(kind);
                }
                return { value, head };
            } catch (error) {
                if (error?.damaged !== true || attempt >= settings.Attempts) {
                    throw error;
                }
                const again = ScribeStore.fetch(storage, headName);
                if (again === text) {
                    throw error;
                }
                text = again;
            }
        }
    },

    /**
     * @param {{ get: Function, set: Function, remove: Function, list: Function }} storage
     * @param {string} roomId
     * @param {string} kind
     * @return {Object|null}
     * @throws {Error}
     */
    read(storage, roomId, kind) {
        const room = ScribeStore.room(roomId);
        ScribeStore.checkKind(kind);
        const loaded = ScribeStore.load(storage, room, kind);
        return loaded === null ? null : loaded.value;
    },

    /**
     * @param {{ get: Function, set: Function, remove: Function, list: Function }} storage
     * @param {string} roomId
     * @param {string} kind
     * @param {Object} value
     * @return {number}
     * @throws {Error}
     */
    write(storage, roomId, kind, value) {
        const settings = ScribeStore.Settings;
        const messages = settings.Messages;
        const types = settings.Types;
        const room = ScribeStore.room(roomId);
        ScribeStore.checkKind(kind);
        let text = null;
        try {
            text = JSON.stringify(value);
        } catch {
            text = null;
        }
        ScribeStore.check(typeof text === settings.StringType && ScribeStore.decode(text) !== null, 'value');
        const pieces = [];
        for (let start = settings.NoCharacters; start < text.length; ) {
            let end = Math.min(start + settings.PartCharacters, text.length);
            const last = text.charCodeAt(end - 1);
            if (end < text.length && last >= settings.FirstHighSurrogate && last <= settings.LastHighSurrogate) {
                end--;
            }
            pieces.push(text.slice(start, end));
            start = end;
        }
        const headName = ScribeStore.name(types.Head, room, kind);
        const written = new Map();
        const superseded = [];
        let headText = null;
        let leave = false;
        try {
            const previous = ScribeStore.headOf(ScribeStore.fetch(storage, headName));
            let highest = settings.NoGeneration;
            for (const described of ScribeStore.stored(storage)) {
                if (described.type !== types.Part || described.room !== room || described.kind !== kind) {
                    continue;
                }
                highest = Math.max(highest, described.generation);
                if (
                    previous !== null
                    && described.part < previous.parts
                    && described.name === ScribeStore.partName(room, kind, previous, described.part)
                ) {
                    superseded.push(described.name);
                }
            }
            const generation = (previous === null ? highest : previous.generation) + 1;
            if (!Number.isSafeInteger(generation)) {
                throw new Error(messages.NoGeneration);
            }
            const head = {
                generation,
                parts: pieces.length,
                characters: text.length,
                digest: ScribeStore.digest(text),
                form: settings.Forms.Sized,
            };
            headText = JSON.stringify(head);
            for (let part = settings.FirstPart; part < pieces.length; part++) {
                const partName = ScribeStore.partName(room, kind, head, part);
                written.set(partName, pieces[part]);
                storage.set(partName, pieces[part]);
            }
            for (const [partName, piece] of written) {
                if (ScribeStore.fetch(storage, partName) !== piece) {
                    throw new Error(messages.PartNotKept);
                }
            }
            const standing = ScribeStore.headOf(ScribeStore.fetch(storage, headName));
            leave = true;
            if (standing !== null && standing.generation >= generation) {
                throw new Error(messages.Overtaken);
            }
            let refused = null;
            try {
                storage.set(headName, headText);
            } catch (cause) {
                refused = cause;
            }
            if (ScribeStore.fetch(storage, headName) !== headText) {
                throw refused === null ? new Error(messages.HeadNotKept) : refused;
            }
        } catch (cause) {
            if (!leave) {
                let committed = true;
                try {
                    committed = ScribeStore.fetch(storage, headName) === headText;
                } catch {
                    committed = true;
                }
                if (!committed) {
                    for (const [partName, piece] of written) {
                        try {
                            if (storage.get(partName, null) === piece) {
                                storage.remove(partName);
                            }
                        } catch {
                            continue;
                        }
                    }
                }
            }
            throw new Error(messages.SaveFailed, { cause });
        }
        for (const partName of superseded) {
            try {
                storage.remove(partName);
            } catch {
                continue;
            }
        }
        return text.length;
    },

    /**
     * @param {{ get: Function, set: Function, remove: Function, list: Function }} storage
     * @param {string} roomId
     * @return {void}
     * @throws {Error}
     */
    drop(storage, roomId) {
        const room = ScribeStore.room(roomId);
        const heads = [];
        const others = [];
        for (const described of ScribeStore.stored(storage)) {
            if (described.room !== room) {
                continue;
            }
            if (described.type === ScribeStore.Settings.Types.Head) {
                heads.push(described.name);
            } else {
                others.push(described.name);
            }
        }
        for (const name of [...heads, ...others]) {
            storage.remove(name);
        }
    },

    /**
     * @param {{ get: Function, set: Function, remove: Function, list: Function }} storage
     * @return {Array<{ roomId: string, kinds: string[], characters: number, damaged: string[] }>}
     * @throws {Error}
     */
    rooms(storage) {
        const settings = ScribeStore.Settings;
        const found = new Map();
        for (const described of ScribeStore.stored(storage)) {
            if (described.kind === null) {
                continue;
            }
            if (!found.has(described.room)) {
                found.set(described.room, { roomId: described.roomId, kinds: new Set() });
            }
            found.get(described.room).kinds.add(described.kind);
        }
        const listed = [];
        for (const [room, entry] of found) {
            const kinds = [];
            const damaged = [];
            let characters = settings.NoCharacters;
            for (const kind of Object.values(ScribeStore.Kind)) {
                if (!entry.kinds.has(kind)) {
                    continue;
                }
                kinds.push(kind);
                try {
                    const loaded = ScribeStore.load(storage, room, kind);
                    if (loaded !== null) {
                        characters += loaded.head.characters;
                    }
                } catch (error) {
                    if (error?.damaged !== true) {
                        throw error;
                    }
                    damaged.push(kind);
                }
            }
            listed.push({ roomId: entry.roomId, kinds, characters, damaged });
        }
        return listed;
    },

    /**
     * @param {{ get: Function, set: Function, remove: Function, list: Function }} storage
     * @param {string} roomId
     * @return {number}
     * @throws {Error}
     */
    sweep(storage, roomId) {
        const types = ScribeStore.Settings.Types;
        const room = ScribeStore.room(roomId);
        const parts = [];
        const kinds = new Set();
        for (const described of ScribeStore.stored(storage)) {
            if (described.room === room && described.type === types.Part) {
                parts.push(described);
                kinds.add(described.kind);
            }
        }
        const floors = new Map();
        for (const kind of kinds) {
            try {
                const loaded = ScribeStore.load(storage, room, kind);
                if (loaded !== null) {
                    floors.set(kind, loaded.head.generation);
                }
            } catch (error) {
                if (error?.damaged !== true) {
                    throw error;
                }
            }
        }
        let removed = 0;
        for (const described of parts) {
            if (!floors.has(described.kind) || described.generation >= floors.get(described.kind)) {
                continue;
            }
            const standing = ScribeStore.headOf(ScribeStore.fetch(storage, ScribeStore.name(types.Head, room, described.kind)));
            if (standing === null || described.generation >= standing.generation) {
                continue;
            }
            storage.remove(described.name);
            removed++;
        }
        return removed;
    },

    /**
     * @param {{ get: Function }} storage
     * @return {string}
     * @throws {Error}
     */
    key(storage) {
        const settings = ScribeStore.Settings;
        const stored = ScribeStore.fetch(storage, ScribeStore.name(settings.Key));
        return typeof stored === settings.StringType ? stored : settings.Nothing;
    },

    /**
     * @param {{ set: Function, remove: Function }} storage
     * @param {string} key
     * @return {void}
     * @throws {Error}
     */
    setKey(storage, key) {
        const settings = ScribeStore.Settings;
        ScribeStore.check(typeof key === settings.StringType, 'key');
        const trimmed = key.trim();
        const name = ScribeStore.name(settings.Key);
        try {
            if (trimmed === settings.Nothing) {
                storage.remove(name);
            } else {
                storage.set(name, trimmed);
            }
        } catch {
            throw new Error(settings.Messages.KeyFailed);
        }
    },

    /**
     * @param {{ get: Function, set: Function }} storage
     * @param {string} roomId
     * @param {string} tabId
     * @param {number} now
     * @return {boolean}
     * @throws {Error}
     */
    claim(storage, roomId, tabId, now) {
        const settings = ScribeStore.Settings;
        const name = ScribeStore.name(settings.Types.Claim, ScribeStore.room(roomId));
        ScribeStore.check(typeof tabId === settings.StringType && tabId !== settings.Nothing, 'tabId');
        ScribeStore.check(Number.isFinite(now), 'now');
        const held = ScribeStore.claimOf(ScribeStore.fetch(storage, name));
        if (
            held !== null
            && held.tabId !== tabId
            && now - held.at <= settings.ClaimStaleMs
            && held.at - now <= settings.ClaimStaleMs
        ) {
            return false;
        }
        storage.set(name, JSON.stringify({ tabId, at: now }));
        return true;
    },

    /**
     * @param {{ get: Function, remove: Function }} storage
     * @param {string} roomId
     * @param {string} tabId
     * @return {void}
     * @throws {Error}
     */
    release(storage, roomId, tabId) {
        const name = ScribeStore.name(ScribeStore.Settings.Types.Claim, ScribeStore.room(roomId));
        const first = ScribeStore.fetch(storage, name);
        const held = ScribeStore.claimOf(first);
        if (held === null || held.tabId !== tabId || ScribeStore.fetch(storage, name) !== first) {
            return;
        }
        storage.remove(name);
    },

    /**
     * @param {{ get: Function }} storage
     * @param {string} roomId
     * @param {string} day
     * @return {number}
     * @throws {Error}
     */
    spent(storage, roomId, day) {
        const settings = ScribeStore.Settings;
        const name = ScribeStore.name(settings.Types.Spent, ScribeStore.room(roomId));
        ScribeStore.check(typeof day === settings.StringType, 'day');
        const record = ScribeStore.decode(ScribeStore.fetch(storage, name));
        if (record === null || record.day !== day || !Number.isFinite(record.amount) || record.amount < settings.NoSpending) {
            return settings.NoSpending;
        }
        return record.amount;
    },

    /**
     * @param {{ get: Function, set: Function }} storage
     * @param {string} roomId
     * @param {string} day
     * @param {*} amount
     * @return {number}
     * @throws {Error}
     */
    spend(storage, roomId, day, amount) {
        const settings = ScribeStore.Settings;
        const total = ScribeStore.spent(storage, roomId, day);
        if (!Number.isFinite(amount) || amount <= settings.NoSpending) {
            return total;
        }
        const sum = total + amount;
        storage.set(ScribeStore.name(settings.Types.Spent, ScribeStore.room(roomId)), JSON.stringify({ day, amount: sum }));
        return sum;
    },

    /**
     * @param {{ get: Function, list: Function }} storage
     * @param {string} roomId
     * @return {string}
     * @throws {Error}
     */
    exportText(storage, roomId) {
        const types = ScribeStore.Settings.Types;
        const room = ScribeStore.room(roomId);
        const bundle = { roomId, generations: {}, damaged: [], raw: {} };
        for (const kind of Object.values(ScribeStore.Kind)) {
            let loaded = null;
            try {
                loaded = ScribeStore.load(storage, room, kind);
            } catch (error) {
                if (error?.damaged !== true) {
                    throw error;
                }
                bundle.damaged.push(kind);
                const parts = [];
                for (const described of ScribeStore.stored(storage)) {
                    if (described.type === types.Part && described.room === room && described.kind === kind) {
                        parts.push({ name: described.name, text: ScribeStore.fetch(storage, described.name) });
                    }
                }
                bundle.raw[kind] = { head: ScribeStore.fetch(storage, ScribeStore.name(types.Head, room, kind)), parts };
            }
            bundle.generations[kind] = loaded === null ? null : loaded.head.generation;
            bundle[kind] = loaded === null ? null : loaded.value;
        }
        return JSON.stringify(bundle);
    },
});
/** @file scribe/page/ScribeKeeper.js */
const ScribeKeeper = Object.freeze({
    Phase: Object.freeze({
        Loading: 'Loading',
        NoBook: 'NoBook',
        Reading: 'Reading',
        Idle: 'Idle',
        Stopped: 'Stopped',
        Watching: 'Watching',
    }),

    Event: Object.freeze({
        Changed: 'Changed',
        Progress: 'Progress',
        Reply: 'Reply',
    }),

    Busy: Object.freeze({
        Pulling: 'Pulling',
        Reading: 'Reading',
    }),

    Defaults: Object.freeze({
        analyzer: 'mistralai/mistral-large-4-0',
        scribe: 'mistralai/mistral-small-3.2-24b-instruct',
        pedant: 'mistralai/mistral-small-3.2-24b-instruct',
        size: 40,
        budget: 3,
        refresh: 6,
    }),

    Settings: Object.freeze({
        Role: 'Analyzer',
        LastCalls: 20,
        LastLines: 50,
        KeptAnswers: 8,
        RepullMs: 60000,
        FirstEpoch: 0,
        NoCount: 0,
        NoSpending: 0,
        NoEdition: 0,
        LeastCount: 1,
        One: 1,
        Last: -1,
        NotFound: -1,
        Models: Object.freeze(['analyzer', 'scribe', 'pedant']),
        Counts: Object.freeze(['size', 'refresh']),
        Amount: 'budget',
        Counters: Object.freeze(['version', 'nextFact', 'nextSubject', 'nextThread', 'nextQuestion', 'nextSequence', 'revision']),
        Lasting: Object.freeze(['Paused', 'Failed']),
        WholeEnds: Object.freeze(['NoCursor', 'EmptyPage']),
        Ends: Object.freeze({
            Failed: 'Failed',
            Limit: 'Limit',
        }),
        KeyJoint: '\n',
        SentenceJoint: ' ',
        Nothing: '',
        ObjectType: 'object',
        StringType: 'string',
        BooleanType: 'boolean',
        FunctionType: 'function',
        UndefinedType: 'undefined',
        Messages: Object.freeze({
            Watching: 'Another tab is reading this chat',
            Reading: 'The book is being read; try again when it has finished this stretch',
            Pulling: 'The chat is being pulled; try again when it has finished',
            Closed: 'This chat has been closed',
            NoBook: 'No book has been started for this chat',
            Disorder: 'The messages of this chat are not in time order',
            Unreadable: 'The messages of this chat could not be read',
            Unsettled: 'The chat could not be compared with the book',
            NoSettings: 'The settings are missing',
            BadSetting: 'The settings are not valid: ',
            ThrownAway: 'The reading was thrown away',
            PartOpen: 'The chat was pulled only in part: ',
            PartClose: '; it will be pulled again.',
            PullFailed: 'the pull failed',
            TooLong: 'the chat has more pages than one pull may read',
            StoppedEarly: 'it stopped early',
            FarOpen: 'The chat could not be pulled far enough to join what is saved: ',
            FarClose: '. It is pulled again every minute; the book is kept as it is.',
            SkippedOne: ' message could not be read from the site.',
            SkippedMany: ' messages could not be read from the site.',
            NothingPulled: 'Nothing has been pulled from the chat yet',
            Unjoined: 'The newest messages do not join what is saved yet; the chat is being pulled again.',
            Suspect: 'The chat on the site does not match what is saved. It will be checked again in a minute.',
            Mismatch:
                'The chat on the site no longer matches what is saved (checked twice). Starting the book over discards the book and your rulings.',
            Unconfirmed: 'The save could not be confirmed; the book was loaded again',
            BadAnchor: 'The argument is not valid: anchor',
            BadOperations: 'The argument is not valid: operations',
            BadClaim: 'The argument is not valid: claim',
        }),
        Flight: Object.freeze({
            PullOpen: 'Pulling the chat: ',
            PullClose: ' messages',
            Looking: 'Looking for new messages',
            ReadOpen: 'Reading #',
            ReadMiddle: ' to #',
            Answers: 'Filing the answered questions',
            Finishing: 'Finishing the reading',
            Ruling: 'Saving a ruling',
            Filing: 'Saving what the player told the scribe',
        }),
    }),

    /**
     * @param {*} value
     * @return {boolean}
     */
    isObject(value) {
        return typeof value === ScribeKeeper.Settings.ObjectType && value !== null && !Array.isArray(value);
    },

    /**
     * @param {*} error
     * @return {string}
     */
    words(error) {
        const settings = ScribeKeeper.Settings;
        const described = error !== null && typeof error === settings.ObjectType && typeof error.message === settings.StringType;
        return described ? error.message : String(error);
    },

    /**
     * @param {*} value
     * @return {*}
     */
    copy(value) {
        return JSON.parse(JSON.stringify(value));
    },

    /**
     * @return {string}
     */
    damagedBook() {
        return ScribeStore.damaged(ScribeStore.Kind.Book).message;
    },

    /**
     * @param {Readonly<object>} base
     * @param {*} given
     * @return {Readonly<{ analyzer: string, scribe: string, pedant: string, size: number, budget: number, refresh: number }>}
     * @throws {Error}
     */
    settle(base, given) {
        const settings = ScribeKeeper.Settings;
        const messages = settings.Messages;
        if (!ScribeKeeper.isObject(given)) {
            throw new Error(messages.NoSettings);
        }
        const merged = {};
        for (const name of Object.keys(ScribeKeeper.Defaults)) {
            merged[name] = Object.hasOwn(given, name) ? given[name] : base[name];
        }
        for (const name of settings.Models) {
            if (typeof merged[name] !== settings.StringType || merged[name].trim() === settings.Nothing) {
                throw new Error(messages.BadSetting + name);
            }
        }
        for (const name of settings.Counts) {
            if (!Number.isSafeInteger(merged[name]) || merged[name] < settings.LeastCount) {
                throw new Error(messages.BadSetting + name);
            }
        }
        if (!Number.isFinite(merged[settings.Amount]) || merged[settings.Amount] < settings.NoSpending) {
            throw new Error(messages.BadSetting + settings.Amount);
        }
        return Object.freeze(merged);
    },

    /**
     * @param {*} value
     * @return {Readonly<{ reason: string, problem: string|null }>|null}
     */
    stopOf(value) {
        const settings = ScribeKeeper.Settings;
        if (!ScribeKeeper.isObject(value) || !settings.Lasting.includes(value.reason)) {
            return null;
        }
        if (value.problem !== null && typeof value.problem !== settings.StringType) {
            return null;
        }
        return Object.freeze({ reason: value.reason, problem: value.problem });
    },

    /**
     * @param {object[]} messages
     * @return {object[]}
     */
    strings(messages) {
        return messages.map(
            /**
             * @param {{ id: * }} message
             * @return {object}
             */
            (message) => (typeof message.id === ScribeKeeper.Settings.StringType ? message : { ...message, id: String(message.id) }),
        );
    },

    /**
     * @param {object[]} messages
     * @return {object[]}
     */
    single(messages) {
        const seen = new Set();
        const kept = [];
        for (const message of ScribeKeeper.strings(messages)) {
            if (!seen.has(message.id)) {
                seen.add(message.id);
                kept.push(message);
            }
        }
        return kept;
    },

    /**
     * @param {object[]} rawMessages
     * @return {{ intake: Readonly<{ messages: readonly object[], notes: readonly object[], player: string }>|null, disorder: string|null }}
     */
    take(rawMessages) {
        const messages = ScribeKeeper.Settings.Messages;
        try {
            return { intake: ScribeIntake.read(rawMessages), disorder: null };
        } catch (error) {
            const unordered = ScribeKeeper.words(error) === ScribeIntake.Settings.UnorderedMessage;
            return { intake: null, disorder: unordered ? messages.Disorder : messages.Unreadable };
        }
    },

    /**
     * @param {Readonly<{ messages: readonly object[] }>} intake
     * @return {string|null}
     */
    newestKey(intake) {
        const message = intake.messages.at(ScribeKeeper.Settings.Last);
        return message === undefined ? null : message.id + ScribeKeeper.Settings.KeyJoint + message.fingerprint;
    },

    /**
     * @param {Readonly<{ questions: readonly object[] }>} state
     * @return {boolean}
     */
    answered(state) {
        return state.questions.some(
            /**
             * @param {{ answer: string|null, dismissed: boolean }} question
             * @return {boolean}
             */
            (question) => question.answer !== null && !question.dismissed,
        );
    },

    /**
     * @param {object} keeper
     * @param {{ kind: string, message?: object }} event
     * @return {void}
     */
    tell(keeper, event) {
        if (keeper.closed) {
            return;
        }
        try {
            keeper.notify(Object.freeze(event));
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
        }
    },

    /**
     * @param {object} keeper
     * @return {void}
     * @throws {Error}
     */
    show(keeper) {
        const messages = keeper.intake === null ? [] : keeper.intake.messages;
        const log = keeper.book === null ? ScribeLog.create() : keeper.book.log;
        const order = [];
        const unread = [];
        let lastRead = null;
        for (const message of messages) {
            order.push(message.id);
            if (Object.hasOwn(log.read, message.id)) {
                lastRead = Object.freeze({ id: message.id, position: message.position });
            } else {
                unread.push(message);
            }
        }
        keeper.state = ScribeReplay.run(log, order);
        keeper.read = messages.length - unread.length;
        keeper.unread = Object.freeze(unread);
        keeper.lastRead = lastRead;
        keeper.made = Object.freeze([]);
        if (typeof BenchView !== ScribeKeeper.Settings.UndefinedType) {
            keeper.made = Object.freeze(
                BenchView.made(log).map(
                    /**
                     * @param {{ sequence: number, type: string, summary: string }} row
                     * @return {Readonly<{ sequence: number, type: string, summary: string }>}
                     */
                    (row) => Object.freeze(row),
                ),
            );
        }
    },

    /**
     * @param {object} keeper
     * @return {Readonly<object>}
     */
    view(keeper) {
        const messages = keeper.intake === null ? Object.freeze([]) : keeper.intake.messages;
        ScribeKeeper.recount(keeper);
        return Object.freeze({
            phase: keeper.phase,
            roomId: keeper.roomId,
            reader: keeper.reader,
            total: messages.length,
            settled: Math.max(messages.length - 1, ScribeKeeper.Settings.NoCount),
            read: keeper.read,
            unread: keeper.unread,
            lastRead: keeper.lastRead,
            made: keeper.made,
            state: keeper.state,
            messages,
            player: keeper.intake === null ? ScribeIntake.Settings.UnknownPlayer : keeper.intake.player,
            settings: keeper.settings,
            spentToday: keeper.spentToday,
            flight: keeper.flight,
            stop: keeper.stop,
            pulled: keeper.lastPull,
            mismatch: keeper.mismatch !== null,
            trusted: keeper.reader && keeper.unloaded === null && keeper.book !== null && keeper.book.adopted && ScribeKeeper.held(keeper) === null,
            edition: keeper.edition,
            calls: Object.freeze([...keeper.calls]),
            lines: Object.freeze([...keeper.lines]),
            problem:
                keeper.unloaded ??
                keeper.problem ??
                (keeper.blank ? null : ScribeKeeper.held(keeper)) ??
                (keeper.owed.size === ScribeKeeper.Settings.NoCount ? null : keeper.owing) ??
                keeper.damaged ??
                keeper.cut,
        });
    },

    /**
     * @param {object} keeper
     * @return {string}
     */
    glance(keeper) {
        const view = ScribeKeeper.view(keeper);
        return JSON.stringify([
            view.phase,
            view.reader,
            view.total,
            view.read,
            view.problem,
            view.spentToday,
            view.flight,
            view.stop,
            view.pulled,
            view.mismatch,
            view.settings,
            view.lastRead,
            view.unread.length,
            view.made.length,
            view.state.revision,
            view.state.facts.length,
            keeper.newest,
            view.edition,
        ]);
    },

    /**
     * @param {object} keeper
     * @param {string} kind
     * @return {{ value: Object|null, damage: string|null }}
     * @throws {Error}
     */
    readKind(keeper, kind) {
        try {
            return { value: ScribeStore.read(keeper.storage, keeper.roomId, kind), damage: null };
        } catch (error) {
            if (error?.damaged !== true) {
                throw error;
            }
            return { value: null, damage: ScribeKeeper.words(error) };
        }
    },

    /**
     * @param {*} value
     * @return {boolean}
     */
    soundBook(value) {
        const settings = ScribeKeeper.Settings;
        if (
            !ScribeKeeper.isObject(value) ||
            typeof value.adopted !== settings.BooleanType ||
            !ScribeKeeper.isObject(value.fingerprints) ||
            !ScribeKeeper.isObject(value.log)
        ) {
            return false;
        }
        const log = value.log;
        if (!Array.isArray(log.entries) || !ScribeKeeper.isObject(log.read) || !Array.isArray(log.notes)) {
            return false;
        }
        for (const name of settings.Counters) {
            if (!Number.isSafeInteger(log[name])) {
                return false;
            }
        }
        for (const fingerprint of Object.values(value.fingerprints)) {
            if (typeof fingerprint !== settings.StringType) {
                return false;
            }
        }
        for (const sequence of Object.values(log.read)) {
            if (!Number.isSafeInteger(sequence)) {
                return false;
            }
        }
        for (const note of log.notes) {
            if (typeof note !== settings.StringType) {
                return false;
            }
        }
        for (const entry of log.entries) {
            const sound =
                ScribeKeeper.isObject(entry) &&
                Number.isSafeInteger(entry.sequence) &&
                typeof entry.kind === settings.StringType &&
                typeof entry.origin === settings.StringType &&
                typeof entry.withdrawn === settings.BooleanType &&
                Array.isArray(entry.messageIds) &&
                Array.isArray(entry.operations);
            if (!sound) {
                return false;
            }
            for (const id of entry.messageIds) {
                if (typeof id !== settings.StringType) {
                    return false;
                }
            }
            for (const operation of entry.operations) {
                if (!ScribeKeeper.isObject(operation) || typeof operation.type !== settings.StringType) {
                    return false;
                }
            }
        }
        return true;
    },

    /**
     * @param {object} keeper
     * @param {Object|null} value
     * @param {string|null} damage
     * @return {void}
     */
    takeBook(keeper, value, damage) {
        keeper.book = null;
        keeper.damaged = damage;
        if (damage === null && value !== null) {
            if (ScribeKeeper.soundBook(value)) {
                keeper.book = value;
            } else {
                keeper.damaged = ScribeKeeper.damagedBook();
            }
        }
        try {
            ScribeKeeper.show(keeper);
        } catch (error) {
            keeper.book = null;
            keeper.damaged = ScribeKeeper.damagedBook();
            ScribeKeeper.show(keeper);
        }
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    damage(keeper) {
        keeper.book = null;
        keeper.damaged = ScribeKeeper.damagedBook();
        keeper.compared = false;
        if (keeper.reader) {
            keeper.phase = ScribeKeeper.Phase.Stopped;
        }
        ScribeKeeper.show(keeper);
    },

    /**
     * @param {object} keeper
     * @param {Object|null} value
     * @return {void}
     */
    takeCampaign(keeper, value) {
        keeper.blank = value === null || !Array.isArray(value.messages);
        const messages = keeper.blank ? [] : ScribeKeeper.strings(value.messages);
        const gone = !keeper.blank && Array.isArray(value.gone) ? value.gone.map(String) : [];
        keeper.campaign = { messages, gone };
        keeper.compared = false;
        const taken = ScribeKeeper.take(messages);
        if (taken.intake === null) {
            keeper.problem = taken.disorder;
            return;
        }
        keeper.intake = taken.intake;
        keeper.newest = ScribeKeeper.newestKey(taken.intake);
    },

    /**
     * @param {object} keeper
     * @return {boolean}
     */
    load(keeper) {
        const kinds = ScribeStore.Kind;
        const none = ScribeKeeper.Settings.NoEdition;
        let settingsRead = null;
        let campaignRead = null;
        let bookRead = null;
        try {
            settingsRead = ScribeKeeper.readKind(keeper, kinds.Settings);
            if (settingsRead.damage === null) {
                const edition = settingsRead.value === null ? none : settingsRead.value.edition;
                keeper.edition = Number.isSafeInteger(edition) && edition >= none ? edition : none;
            }
            campaignRead = ScribeKeeper.readKind(keeper, kinds.Campaign);
            bookRead = ScribeKeeper.readKind(keeper, kinds.Book);
        } catch (error) {
            keeper.unloaded = ScribeKeeper.words(error);
            return false;
        }
        keeper.unloaded = null;
        keeper.pullDone = false;
        keeper.partial = false;
        keeper.cutShort = false;
        keeper.unjoined = false;
        keeper.suspectAt = null;
        keeper.mismatch = null;
        keeper.cut = null;
        keeper.settings = ScribeKeeper.Defaults;
        keeper.savedStop = null;
        const record = settingsRead.value;
        if (settingsRead.damage !== null) {
            keeper.problem = settingsRead.damage;
        } else if (record !== null) {
            try {
                keeper.settings = ScribeKeeper.settle(ScribeKeeper.Defaults, record);
            } catch (error) {
                keeper.problem = ScribeKeeper.words(error);
            }
            keeper.savedStop = ScribeKeeper.stopOf(record.stop);
        }
        keeper.stop = keeper.savedStop;
        keeper.retryAt = null;
        keeper.intake = null;
        keeper.newest = null;
        ScribeKeeper.takeCampaign(keeper, campaignRead.value);
        ScribeKeeper.takeBook(keeper, bookRead.value, bookRead.damage);
        ScribeKeeper.counted(keeper);
        return true;
    },

    /**
     * @param {object} keeper
     * @return {number}
     */
    owedToday(keeper) {
        const today = keeper.clock.today();
        return keeper.owed.has(today) ? keeper.owed.get(today) : ScribeKeeper.Settings.NoSpending;
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    counted(keeper) {
        const failure = ScribeKeeper.recount(keeper);
        if (failure !== null) {
            keeper.problem = failure;
        }
    },

    /**
     * @param {object} keeper
     * @return {string|null}
     */
    recount(keeper) {
        try {
            keeper.spentToday = ScribeStore.spent(keeper.storage, keeper.roomId, keeper.clock.today()) + ScribeKeeper.owedToday(keeper);
        } catch (error) {
            return ScribeKeeper.words(error);
        }
        return null;
    },

    /**
     * @param {object} keeper
     * @param {string} day
     * @param {number} amount
     * @return {number|null}
     */
    spend(keeper, day, amount) {
        let before = null;
        try {
            before = ScribeStore.spent(keeper.storage, keeper.roomId, day);
            return ScribeStore.spend(keeper.storage, keeper.roomId, day, amount);
        } catch (error) {
            keeper.owing = ScribeKeeper.words(error);
        }
        if (before === null) {
            return null;
        }
        try {
            const total = ScribeStore.spent(keeper.storage, keeper.roomId, day);
            return total === before + amount ? total : null;
        } catch (error) {
            keeper.owing = ScribeKeeper.words(error);
            return null;
        }
    },

    /**
     * @param {object} keeper
     * @param {number} amount
     * @return {boolean}
     */
    pay(keeper, amount) {
        const day = keeper.clock.today();
        const total = ScribeKeeper.spend(keeper, day, amount);
        if (total !== null) {
            keeper.spentToday = total + ScribeKeeper.owedToday(keeper);
            return true;
        }
        const owed = keeper.owed.has(day) ? keeper.owed.get(day) : ScribeKeeper.Settings.NoSpending;
        keeper.owed.set(day, owed + amount);
        keeper.spentToday += amount;
        return false;
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    repay(keeper) {
        const settings = ScribeKeeper.Settings;
        const today = keeper.clock.today();
        for (const [day, amount] of [...keeper.owed.entries()]) {
            let later = false;
            try {
                later = day !== today && ScribeStore.spent(keeper.storage, keeper.roomId, today) > settings.NoSpending;
            } catch (error) {
                keeper.owing = ScribeKeeper.words(error);
                continue;
            }
            if (later || ScribeKeeper.spend(keeper, day, amount) !== null) {
                keeper.owed.delete(day);
            }
        }
        ScribeKeeper.counted(keeper);
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    reloadBook(keeper) {
        try {
            const read = ScribeKeeper.readKind(keeper, ScribeStore.Kind.Book);
            ScribeKeeper.takeBook(keeper, read.value, read.damage);
        } catch (error) {
            keeper.unloaded = ScribeKeeper.words(error);
        }
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    reloadCampaign(keeper) {
        try {
            const read = ScribeKeeper.readKind(keeper, ScribeStore.Kind.Campaign);
            ScribeKeeper.takeCampaign(keeper, read.value);
            ScribeKeeper.show(keeper);
        } catch (error) {
            keeper.unloaded = ScribeKeeper.words(error);
        }
    },

    /**
     * @param {object} keeper
     * @return {boolean}
     * @throws {Error}
     */
    claimed(keeper) {
        if (keeper.claim !== null) {
            return keeper.claim() === true;
        }
        return ScribeStore.claim(keeper.storage, keeper.roomId, keeper.tabId, keeper.clock.now());
    },

    /**
     * @param {object} keeper
     * @return {boolean}
     * @throws {Error}
     */
    still(keeper) {
        if (keeper.claim !== null) {
            return keeper.claim() === true;
        }
        const name = ScribeStore.name(ScribeStore.Settings.Types.Claim, ScribeStore.room(keeper.roomId));
        const held = ScribeStore.claimOf(ScribeStore.fetch(keeper.storage, name));
        return held !== null && held.tabId === keeper.tabId;
    },

    /**
     * @param {object} keeper
     * @return {boolean}
     */
    writable(keeper) {
        let still = true;
        try {
            still = ScribeKeeper.still(keeper);
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
        }
        if (!still) {
            ScribeKeeper.lose(keeper);
        }
        return still;
    },

    /**
     * @param {object} keeper
     * @param {readonly object[]} messages
     * @return {{ log: object, fingerprints: Object<string, string>, adopted: boolean }|null}
     * @throws {Error}
     */
    withdrawn(keeper, messages) {
        const book = keeper.book;
        const present = new Set();
        for (const message of messages) {
            present.add(message.id);
        }
        const known = [];
        for (const id of Object.keys(book.log.read)) {
            known.push({ id, fingerprint: book.fingerprints[id] });
        }
        const targets = ScribeIntake.changed(known, messages).withdrawn.filter(
            /**
             * @param {string} id
             * @return {boolean}
             */
            (id) => present.has(id),
        );
        for (const id of keeper.campaign.gone) {
            if (Object.hasOwn(book.log.read, id)) {
                targets.push(id);
            }
        }
        if (targets.length === ScribeKeeper.Settings.NoCount) {
            return null;
        }
        const log = ScribeKeeper.copy(book.log);
        const fingerprints = { ...book.fingerprints };
        for (const id of targets) {
            const freed = ScribeLog.withdraw(log, id);
            if (freed !== null) {
                for (const freedId of freed) {
                    delete fingerprints[freedId];
                }
            }
        }
        return { log, fingerprints, adopted: book.adopted };
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    compare(keeper) {
        const settings = ScribeKeeper.Settings;
        const taken = ScribeKeeper.take(keeper.campaign.messages);
        keeper.compared = false;
        if (taken.intake === null) {
            keeper.problem = taken.disorder;
            return;
        }
        if (keeper.book !== null) {
            let changed = null;
            try {
                changed = ScribeKeeper.withdrawn(keeper, taken.intake.messages);
            } catch (error) {
                ScribeKeeper.damage(keeper);
                return;
            }
            if (changed !== null) {
                if (!ScribeKeeper.writable(keeper)) {
                    return;
                }
                try {
                    ScribeStore.write(keeper.storage, keeper.roomId, ScribeStore.Kind.Book, changed);
                } catch (error) {
                    keeper.problem = ScribeKeeper.words(error);
                    ScribeKeeper.reloadBook(keeper);
                    return;
                }
                keeper.book = changed;
            }
        }
        const gone = keeper.campaign.gone;
        if (gone.length > settings.NoCount && (keeper.book !== null || keeper.damaged === null)) {
            if (!ScribeKeeper.writable(keeper)) {
                return;
            }
            const cleared = { messages: keeper.campaign.messages, gone: [] };
            try {
                ScribeStore.write(keeper.storage, keeper.roomId, ScribeStore.Kind.Campaign, cleared);
            } catch (error) {
                keeper.problem = ScribeKeeper.words(error);
                ScribeKeeper.reloadCampaign(keeper);
                return;
            }
            keeper.campaign = cleared;
        }
        keeper.intake = taken.intake;
        try {
            ScribeKeeper.show(keeper);
        } catch (error) {
            ScribeKeeper.damage(keeper);
            return;
        }
        keeper.compared = true;
        const newest = ScribeKeeper.newestKey(taken.intake);
        if (newest !== keeper.newest) {
            keeper.newest = newest;
            const message = taken.intake.messages.at(settings.Last);
            if (message !== undefined) {
                ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Reply, message });
            }
        }
    },

    /**
     * @param {object} keeper
     * @param {object[]} rawMessages
     * @param {string[]} gone
     * @return {boolean}
     */
    absorb(keeper, rawMessages, gone) {
        if (!ScribeKeeper.writable(keeper)) {
            return false;
        }
        const campaign = { messages: rawMessages, gone };
        try {
            ScribeStore.write(keeper.storage, keeper.roomId, ScribeStore.Kind.Campaign, campaign);
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
            ScribeKeeper.reloadCampaign(keeper);
            return false;
        }
        keeper.campaign = campaign;
        keeper.blank = false;
        keeper.problem = null;
        ScribeKeeper.compare(keeper);
        return true;
    },

    /**
     * @param {object[]} saved
     * @param {object[]} pulled
     * @param {boolean} keepAll
     * @return {{ messages: object[], removed: string[], joined: boolean, shared: boolean, changed: boolean }}
     */
    merge(saved, pulled, keepAll) {
        const settings = ScribeKeeper.Settings;
        if (pulled.length === settings.NoCount) {
            return { messages: saved, removed: [], joined: true, shared: false, changed: false };
        }
        const inPulled = new Set();
        for (const message of pulled) {
            inPulled.add(message.id);
        }
        const join = saved.findIndex(
            /**
             * @param {{ id: string }} message
             * @return {boolean}
             */
            (message) => inPulled.has(message.id),
        );
        if (join === settings.NotFound) {
            if (saved.length === settings.NoCount) {
                return { messages: pulled, removed: [], joined: true, shared: false, changed: true };
            }
            return { messages: saved, removed: [], joined: false, shared: false, changed: false };
        }
        const known = new Map();
        const removed = [];
        const tail = [];
        let next = settings.NoCount;
        let changed = false;
        for (const message of saved.slice(join)) {
            if (inPulled.has(message.id)) {
                known.set(message.id, message);
                for (; next < pulled.length; next++) {
                    tail.push(pulled[next]);
                    if (pulled[next].id === message.id) {
                        next++;
                        break;
                    }
                }
            } else if (keepAll) {
                tail.push(message);
            } else {
                removed.push(message.id);
                changed = true;
            }
        }
        for (; next < pulled.length; next++) {
            tail.push(pulled[next]);
        }
        for (const message of pulled) {
            const before = known.get(message.id);
            if (before === undefined || JSON.stringify(before) !== JSON.stringify(message)) {
                changed = true;
            }
        }
        return { messages: [...saved.slice(0, join), ...tail], removed, joined: true, shared: true, changed };
    },

    /**
     * @param {object} keeper
     * @param {object[]} pulled
     * @param {boolean} keepAll
     * @return {{ fresh: boolean, joined: boolean, shared: boolean, changed: boolean }}
     */
    takeIn(keeper, pulled, keepAll) {
        const merged = ScribeKeeper.merge(keeper.campaign.messages, pulled, keepAll);
        if (!merged.joined) {
            return { fresh: false, joined: false, shared: false, changed: false };
        }
        if (!merged.changed) {
            if (!keeper.compared && !keeper.blank) {
                ScribeKeeper.compare(keeper);
            }
            return { fresh: true, joined: true, shared: merged.shared, changed: false };
        }
        const gone = [...keeper.campaign.gone];
        for (const id of merged.removed) {
            if (!gone.includes(id)) {
                gone.push(id);
            }
        }
        const fresh = ScribeKeeper.absorb(keeper, merged.messages, gone);
        return { fresh, joined: true, shared: merged.shared, changed: true };
    },

    /**
     * @param {number} skipped
     * @return {string|null}
     */
    skippedWords(skipped) {
        const settings = ScribeKeeper.Settings;
        if (!(skipped > settings.NoCount)) {
            return null;
        }
        return skipped + (skipped === settings.One ? settings.Messages.SkippedOne : settings.Messages.SkippedMany);
    },

    /**
     * @param {{ end: string, problem: string|null, skipped: number }} pulled
     * @param {boolean} apart
     * @return {string|null}
     */
    shortfall(pulled, apart) {
        const settings = ScribeKeeper.Settings;
        const messages = settings.Messages;
        const ends = settings.Ends;
        const sentences = [];
        if (!ScribeKeeper.whole(pulled)) {
            const given = typeof pulled.problem === settings.StringType ? pulled.problem : null;
            let reason = messages.StoppedEarly;
            if (pulled.end === ends.Limit) {
                reason = messages.TooLong;
            }
            if (pulled.end === ends.Failed) {
                reason = messages.PullFailed;
            }
            if (apart) {
                sentences.push(messages.FarOpen + (given ?? messages.StoppedEarly) + messages.FarClose);
            } else {
                sentences.push(messages.PartOpen + (given ?? reason) + messages.PartClose);
            }
        }
        const skipped = ScribeKeeper.skippedWords(pulled.skipped);
        if (skipped !== null) {
            sentences.push(skipped);
        }
        return sentences.length === settings.NoCount ? null : sentences.join(settings.SentenceJoint);
    },

    /**
     * @param {object} keeper
     * @return {boolean}
     */
    mayRepull(keeper) {
        const now = keeper.clock.now();
        return keeper.pulledAt === null || now < keeper.pulledAt || now - keeper.pulledAt >= ScribeKeeper.Settings.RepullMs;
    },

    /**
     * @param {{ end: string }} pulled
     * @return {boolean}
     */
    whole(pulled) {
        return ScribeKeeper.Settings.WholeEnds.includes(pulled.end);
    },

    /**
     * @param {object} keeper
     * @return {string|null}
     */
    held(keeper) {
        const messages = ScribeKeeper.Settings.Messages;
        if (keeper.blank) {
            return messages.NothingPulled;
        }
        if (keeper.partial) {
            return keeper.cut;
        }
        if (keeper.mismatch !== null) {
            return messages.Mismatch;
        }
        if (keeper.suspectAt !== null) {
            return messages.Suspect;
        }
        if (keeper.unjoined) {
            return messages.Unjoined;
        }
        return null;
    },

    /**
     * @param {object} keeper
     * @return {boolean}
     */
    holding(keeper) {
        return keeper.partial || keeper.unjoined || keeper.suspectAt !== null || keeper.mismatch !== null;
    },

    /**
     * @param {object} keeper
     * @return {Promise<boolean>}
     */
    async history(keeper) {
        const settings = ScribeKeeper.Settings;
        const flight = settings.Flight;
        const epoch = keeper.epoch;
        keeper.pulledAt = keeper.clock.now();
        keeper.flight = flight.PullOpen + settings.NoCount + flight.PullClose;
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
        let result = null;
        try {
            result = await keeper.zeta.history(
                /**
                 * @param {number} count
                 * @return {void}
                 */
                (count) => {
                    if (keeper.epoch === epoch) {
                        keeper.flight = flight.PullOpen + count + flight.PullClose;
                        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
                    }
                },
            );
        } catch (error) {
            if (keeper.epoch === epoch) {
                keeper.problem = ScribeKeeper.words(error);
            }
        }
        if (keeper.epoch !== epoch) {
            return false;
        }
        keeper.flight = null;
        if (result === null) {
            ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            return false;
        }
        const pulled = ScribeKeeper.single(result.messages);
        const whole = ScribeKeeper.whole(result);
        const natural = result.end !== settings.Ends.Failed && result.end !== settings.Ends.Limit;
        const now = keeper.clock.now();
        keeper.pullDone = true;
        keeper.problem = null;
        keeper.cutShort = !whole;
        keeper.lastPull = Object.freeze({ end: result.end, count: pulled.length, skipped: result.skipped, at: now });
        const taken = ScribeKeeper.takeIn(keeper, pulled, result.skipped > settings.NoCount);
        if (keeper.epoch !== epoch) {
            return false;
        }
        keeper.cut = ScribeKeeper.shortfall(result, !taken.joined);
        keeper.partial = !whole && !taken.shared && !(keeper.book === null && natural && taken.joined);
        if (taken.shared || (taken.joined && whole)) {
            keeper.unjoined = false;
            keeper.suspectAt = null;
            keeper.mismatch = null;
        } else if (!taken.joined && whole) {
            if (keeper.mismatch !== null || (keeper.suspectAt !== null && now - keeper.suspectAt >= settings.RepullMs)) {
                keeper.mismatch = pulled;
            } else if (keeper.suspectAt === null || now < keeper.suspectAt) {
                keeper.suspectAt = now;
            }
        }
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
        return taken.fresh;
    },

    /**
     * @param {object} keeper
     * @return {Promise<boolean>}
     */
    async newest(keeper) {
        const epoch = keeper.epoch;
        const before = keeper.problem;
        keeper.flight = ScribeKeeper.Settings.Flight.Looking;
        let page = null;
        try {
            page = await keeper.zeta.newest();
        } catch (error) {
            if (keeper.epoch === epoch) {
                keeper.problem = ScribeKeeper.words(error);
            }
        }
        if (keeper.epoch !== epoch) {
            return false;
        }
        keeper.flight = null;
        if (page === null) {
            if (keeper.problem !== before) {
                ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            }
            return false;
        }
        keeper.problem = null;
        const taken = ScribeKeeper.takeIn(keeper, ScribeKeeper.single(page.messages), page.skipped > ScribeKeeper.Settings.NoCount);
        if (keeper.epoch !== epoch) {
            return false;
        }
        if (!taken.joined) {
            keeper.unjoined = true;
            if (ScribeKeeper.mayRepull(keeper)) {
                return ScribeKeeper.history(keeper);
            }
            ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            return false;
        }
        if (taken.shared) {
            keeper.suspectAt = null;
        }
        const skipped = ScribeKeeper.skippedWords(page.skipped);
        if (skipped !== null) {
            keeper.problem = skipped;
        }
        if (taken.changed || keeper.problem !== before) {
            ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
        }
        return taken.fresh;
    },

    /**
     * @param {object} keeper
     * @return {{ settled: readonly object[], end: number }}
     */
    plan(keeper) {
        const settings = ScribeKeeper.Settings;
        const settled = keeper.intake.messages.slice(0, settings.Last);
        const read = keeper.book.log.read;
        if (!keeper.book.adopted) {
            return { settled, end: settled.length };
        }
        const size = keeper.settings.size;
        let end = settings.NoCount;
        let lastRead = settings.NotFound;
        let runStart = settings.NotFound;
        for (let index = 0; index <= settled.length; index++) {
            const closing = index === settled.length || Object.hasOwn(read, settled[index].id);
            if (!closing) {
                if (runStart === settings.NotFound) {
                    runStart = index;
                }
                continue;
            }
            if (index < settled.length) {
                lastRead = index;
            }
            if (runStart !== settings.NotFound) {
                const length = index - runStart;
                const taken = index === settled.length ? Math.floor(length / size) * size : length;
                if (taken > settings.NoCount) {
                    end = runStart + taken;
                }
                runStart = settings.NotFound;
            }
        }
        if (ScribeKeeper.answered(keeper.state)) {
            end = Math.max(end, lastRead + 1);
        }
        return { settled, end };
    },

    /**
     * @param {object} keeper
     * @return {boolean}
     */
    due(keeper) {
        const book = keeper.book;
        const blocked = keeper.unloaded !== null || keeper.owed.size > ScribeKeeper.Settings.NoCount;
        if (book === null || !keeper.compared || blocked || ScribeKeeper.held(keeper) !== null) {
            return false;
        }
        if (keeper.phase === ScribeKeeper.Phase.Stopped) {
            const stop = keeper.stop;
            if (stop === null) {
                return false;
            }
            if (stop.reason === ScribeAdoption.Stop.Budget) {
                return keeper.spentToday < keeper.settings.budget;
            }
            return keeper.retryAt !== null && keeper.clock.now() >= keeper.retryAt;
        }
        if (!book.adopted || ScribeKeeper.answered(keeper.state)) {
            return true;
        }
        return ScribeKeeper.plan(keeper).end > ScribeKeeper.Settings.NoCount;
    },

    /**
     * @param {object} keeper
     * @param {readonly object[]} chosen
     * @return {string}
     */
    reading(keeper, chosen) {
        const flight = ScribeKeeper.Settings.Flight;
        if (ScribeKeeper.answered(keeper.state)) {
            return flight.Answers;
        }
        const stretch = ScribeAdoption.next(keeper.book.log, chosen, keeper.settings.size);
        if (stretch.length === ScribeKeeper.Settings.NoCount) {
            return flight.Finishing;
        }
        return flight.ReadOpen + stretch[0].position + flight.ReadMiddle + stretch.at(ScribeKeeper.Settings.Last).position;
    },

    /**
     * @param {object} keeper
     * @param {Readonly<{ reason: string, problem: string|null }>|null} stop
     * @param {boolean} storageCaused
     * @return {void}
     */
    keepStop(keeper, stop, storageCaused) {
        const settings = ScribeKeeper.Settings;
        keeper.stop = stop;
        keeper.retryAt = storageCaused ? keeper.clock.now() + settings.RepullMs : null;
        const saved = stop !== null && settings.Lasting.includes(stop.reason) && !storageCaused ? stop : null;
        if (JSON.stringify(saved) === JSON.stringify(keeper.savedStop) || keeper.unloaded !== null) {
            return;
        }
        if (!ScribeKeeper.writable(keeper)) {
            return;
        }
        try {
            ScribeKeeper.saveStop(keeper, saved);
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
        }
    },

    /**
     * @param {object} keeper
     * @param {Readonly<{ reason: string, problem: string|null }>|null} saved
     * @return {void}
     * @throws {Error}
     */
    saveStop(keeper, saved) {
        ScribeKeeper.writeSettings(keeper, keeper.settings, saved, keeper.edition);
        keeper.savedStop = saved;
    },

    /**
     * @param {object} keeper
     * @param {Readonly<object>} settings
     * @param {Readonly<{ reason: string, problem: string|null }>|null} stop
     * @param {number} edition
     * @return {void}
     * @throws {Error}
     */
    writeSettings(keeper, settings, stop, edition) {
        ScribeStore.write(keeper.storage, keeper.roomId, ScribeStore.Kind.Settings, { ...settings, stop, edition });
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    restoreEdition(keeper) {
        try {
            ScribeKeeper.writeSettings(keeper, keeper.settings, keeper.savedStop, keeper.edition);
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
        }
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    holdPause(keeper) {
        const phases = ScribeKeeper.Phase;
        ScribeKeeper.keepStop(keeper, Object.freeze({ reason: ScribeAdoption.Stop.Paused, problem: null }), false);
        if (keeper.reader && keeper.busy !== ScribeKeeper.Busy.Reading && keeper.phase !== phases.Loading) {
            keeper.phase = phases.Stopped;
        }
    },

    /**
     * @param {object} keeper
     * @return {Promise<void>}
     */
    async read(keeper) {
        const settings = ScribeKeeper.Settings;
        const stops = ScribeAdoption.Stop;
        const epoch = keeper.epoch;
        const book = keeper.book;
        const size = keeper.settings.size;
        const { settled, end } = ScribeKeeper.plan(keeper);
        const chosen = settled.slice(0, end);
        const notes = keeper.intake.notes.filter(
            /**
             * @param {{ position: number }} note
             * @return {boolean}
             */
            (note) => note.position <= end,
        );
        const prints = new Map();
        for (const message of keeper.intake.messages) {
            prints.set(message.id, message.fingerprint);
        }
        const job = { recorded: settings.NoSpending, saveFailed: false, storage: false };
        keeper.busy = ScribeKeeper.Busy.Reading;
        keeper.phase = ScribeKeeper.Phase.Reading;
        keeper.flight = ScribeKeeper.reading(keeper, chosen);
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
        let result = null;
        try {
            job.recorded = ScribeStore.spent(keeper.storage, keeper.roomId, keeper.clock.today());
            result = await ScribeAdoption.run({
                messages: chosen,
                notes,
                player: keeper.intake.player,
                log: book.log,
                size,
                budget: keeper.settings.budget,
                spent: job.recorded,
                /**
                 * @param {string} system
                 * @param {string} user
                 * @return {Promise<{ text: string, cost: * }>}
                 */
                ask: async (system, user) => {
                    const key = JSON.stringify([system, user]);
                    const found = keeper.kept.find(
                        /**
                         * @param {{ key: string }} answer
                         * @return {boolean}
                         */
                        (answer) => answer.key === key,
                    );
                    if (found !== undefined) {
                        return { text: found.text, cost: settings.NoSpending };
                    }
                    const answer = await keeper.ask(settings.Role, system, user);
                    if (!keeper.closed) {
                        keeper.kept.push({ key, text: answer.text });
                        keeper.kept.splice(settings.NoCount, Math.max(keeper.kept.length - settings.KeptAnswers, settings.NoCount));
                    }
                    return answer;
                },
                /**
                 * @param {object} log
                 * @return {Promise<void>}
                 * @throws {Error}
                 */
                save: async (log) => {
                    if (keeper.epoch !== epoch || !ScribeKeeper.writable(keeper)) {
                        throw new Error(settings.Messages.ThrownAway);
                    }
                    const fingerprints = {};
                    for (const id of Object.keys(log.read)) {
                        fingerprints[id] = prints.has(id) ? prints.get(id) : book.fingerprints[id];
                    }
                    try {
                        ScribeStore.write(keeper.storage, keeper.roomId, ScribeStore.Kind.Book, {
                            log,
                            fingerprints,
                            adopted: book.adopted,
                        });
                    } catch (error) {
                        job.saveFailed = true;
                        job.storage = true;
                        throw error;
                    }
                    book.fingerprints = fingerprints;
                    keeper.kept = [];
                    ScribeKeeper.show(keeper);
                },
                /**
                 * @param {{ readable: boolean, system: string, input: string }} item
                 * @return {Promise<void>}
                 */
                record: async (item) => {
                    if (!item.readable) {
                        const key = JSON.stringify([item.system, item.input]);
                        keeper.kept = keeper.kept.filter(
                            /**
                             * @param {{ key: string }} answer
                             * @return {boolean}
                             */
                            (answer) => answer.key !== key,
                        );
                    }
                    if (keeper.epoch !== epoch) {
                        return;
                    }
                    const calls = keeper.calls;
                    calls.unshift(item);
                    for (let index = calls.length - 1; index >= 0 && calls.length > settings.LastCalls; index--) {
                        if (calls[index].readable) {
                            calls.splice(index, 1);
                        }
                    }
                },
                /**
                 * @param {{ spent: number }} report
                 * @return {Promise<void>}
                 * @throws {Error}
                 */
                progress: async (report) => {
                    const amount = report.spent - job.recorded;
                    if (amount > settings.NoSpending) {
                        const recorded = ScribeKeeper.pay(keeper, amount);
                        job.recorded = report.spent;
                        if (!recorded) {
                            job.storage = true;
                            throw new Error(keeper.owing);
                        }
                    }
                    if (keeper.epoch !== epoch) {
                        return;
                    }
                    keeper.lines.unshift(report);
                    keeper.lines.splice(settings.LastLines);
                    keeper.flight = ScribeKeeper.reading(keeper, chosen);
                    ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Progress });
                },
                /**
                 * @return {boolean}
                 */
                paused: () => keeper.pausing || keeper.epoch !== epoch,
            });
        } catch (error) {
            job.storage = true;
            result = { stop: stops.Failed, problem: ScribeKeeper.words(error), spent: job.recorded };
        }
        let stop = result.stop;
        let problem = result.problem;
        const unrecorded = result.spent - job.recorded;
        if (unrecorded > settings.NoSpending) {
            ScribeKeeper.pay(keeper, unrecorded);
        }
        if (keeper.epoch !== epoch) {
            return;
        }
        if (job.saveFailed) {
            ScribeKeeper.reloadBook(keeper);
        }
        if (stop === stops.Done && !book.adopted && keeper.book === book) {
            if (!ScribeKeeper.writable(keeper)) {
                return;
            }
            const finished = { log: book.log, fingerprints: book.fingerprints, adopted: true };
            try {
                ScribeStore.write(keeper.storage, keeper.roomId, ScribeStore.Kind.Book, finished);
                keeper.book = finished;
            } catch (error) {
                stop = stops.Failed;
                problem = ScribeKeeper.words(error);
                job.storage = true;
                ScribeKeeper.reloadBook(keeper);
            }
        }
        if (keeper.pausing) {
            stop = stops.Paused;
            problem = null;
            job.storage = false;
        }
        keeper.busy = null;
        keeper.flight = null;
        ScribeKeeper.keepStop(keeper, Object.freeze({ reason: stop, problem }), job.storage);
        if (keeper.epoch !== epoch) {
            return;
        }
        keeper.phase = stop === stops.Done ? ScribeKeeper.Phase.Idle : ScribeKeeper.Phase.Stopped;
        if (keeper.unloaded === null) {
            ScribeKeeper.show(keeper);
        }
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
    },

    /**
     * @param {object} keeper
     * @return {string}
     */
    resting(keeper) {
        const phases = ScribeKeeper.Phase;
        const stopped = keeper.stop !== null && keeper.stop.reason !== ScribeAdoption.Stop.Done;
        if (keeper.unloaded !== null || keeper.damaged !== null || stopped) {
            return phases.Stopped;
        }
        return keeper.book === null ? phases.NoBook : phases.Idle;
    },

    /**
     * @param {object} keeper
     * @return {Promise<boolean>}
     */
    async start(keeper) {
        const epoch = keeper.epoch;
        keeper.phase = ScribeKeeper.Phase.Loading;
        try {
            ScribeStore.sweep(keeper.storage, keeper.roomId);
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
        }
        if (!keeper.blank) {
            ScribeKeeper.compare(keeper);
        }
        if (keeper.epoch !== epoch) {
            return false;
        }
        let fresh = false;
        try {
            fresh = await ScribeKeeper.history(keeper);
        } finally {
            if (keeper.epoch === epoch) {
                keeper.phase = ScribeKeeper.resting(keeper);
                ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            }
        }
        return keeper.epoch === epoch && fresh;
    },

    /**
     * @param {object} keeper
     * @return {Promise<void>}
     */
    async begin(keeper) {
        const epoch = keeper.epoch;
        keeper.busy = ScribeKeeper.Busy.Pulling;
        try {
            await ScribeKeeper.start(keeper);
        } finally {
            if (keeper.epoch === epoch) {
                keeper.busy = null;
            }
        }
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    lose(keeper) {
        keeper.epoch++;
        keeper.reader = false;
        keeper.busy = null;
        keeper.flight = null;
        keeper.phase = ScribeKeeper.Phase.Watching;
        ScribeKeeper.load(keeper);
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
    },

    /**
     * @param {object} keeper
     * @return {Promise<void>}
     */
    async watch(keeper) {
        const before = ScribeKeeper.glance(keeper);
        ScribeKeeper.load(keeper);
        let claimed = false;
        try {
            claimed = ScribeKeeper.claimed(keeper);
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
        }
        if (!claimed) {
            if (ScribeKeeper.glance(keeper) !== before) {
                ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            }
            return;
        }
        keeper.reader = true;
        if (keeper.unloaded !== null) {
            keeper.phase = ScribeKeeper.Phase.Stopped;
            ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            return;
        }
        await ScribeKeeper.begin(keeper);
    },

    /**
     * @param {object} keeper
     * @return {Promise<void>}
     */
    async step(keeper) {
        if (keeper.owed.size > ScribeKeeper.Settings.NoCount) {
            ScribeKeeper.repay(keeper);
        }
        if (!keeper.reader) {
            await ScribeKeeper.watch(keeper);
            return;
        }
        let claimed = true;
        try {
            claimed = ScribeKeeper.claimed(keeper);
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
        }
        if (!claimed) {
            ScribeKeeper.lose(keeper);
            return;
        }
        if (keeper.busy !== null) {
            return;
        }
        const epoch = keeper.epoch;
        keeper.busy = ScribeKeeper.Busy.Pulling;
        try {
            let fresh = false;
            const reloading = keeper.unloaded !== null;
            if (reloading && !ScribeKeeper.load(keeper)) {
                return;
            }
            if (keeper.pausing) {
                ScribeKeeper.holdPause(keeper);
                if (keeper.epoch !== epoch) {
                    return;
                }
            }
            if (reloading) {
                fresh = await ScribeKeeper.start(keeper);
            } else {
                ScribeKeeper.counted(keeper);
                const holding = ScribeKeeper.holding(keeper);
                if (!keeper.pullDone || ((holding || keeper.cutShort) && ScribeKeeper.mayRepull(keeper))) {
                    fresh = await ScribeKeeper.history(keeper);
                } else if (!holding) {
                    fresh = await ScribeKeeper.newest(keeper);
                }
            }
            if (keeper.epoch === epoch && fresh && ScribeKeeper.due(keeper)) {
                await ScribeKeeper.read(keeper);
            }
        } finally {
            if (keeper.epoch === epoch) {
                keeper.busy = null;
            }
        }
    },

    /**
     * @param {object} keeper
     * @return {Promise<void>}
     */
    async tick(keeper) {
        if (keeper.closed) {
            return;
        }
        try {
            await ScribeKeeper.step(keeper);
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
        }
    },

    /**
     * @param {object} keeper
     * @return {void}
     * @throws {Error}
     */
    guard(keeper) {
        const messages = ScribeKeeper.Settings.Messages;
        const busy = ScribeKeeper.Busy;
        if (keeper.closed) {
            throw new Error(messages.Closed);
        }
        if (!keeper.reader) {
            throw new Error(messages.Watching);
        }
        if (keeper.unloaded !== null) {
            throw new Error(keeper.unloaded);
        }
        if (keeper.busy === busy.Reading) {
            throw new Error(messages.Reading);
        }
        if (keeper.busy === busy.Pulling) {
            throw new Error(messages.Pulling);
        }
    },

    /**
     * @param {object} keeper
     * @return {void}
     * @throws {Error}
     */
    needBook(keeper) {
        if (keeper.damaged !== null) {
            throw new Error(keeper.damaged);
        }
        if (keeper.book === null) {
            throw new Error(ScribeKeeper.Settings.Messages.NoBook);
        }
    },

    /**
     * @param {object} keeper
     * @return {void}
     * @throws {Error}
     */
    readable(keeper) {
        const hold = ScribeKeeper.held(keeper);
        if (hold !== null) {
            throw new Error(hold);
        }
        if (!keeper.compared) {
            throw new Error(keeper.problem ?? ScribeKeeper.Settings.Messages.Unsettled);
        }
    },

    /**
     * @param {object} keeper
     * @param {*} given
     * @return {Promise<void>}
     * @throws {Error}
     */
    async adopt(keeper, given) {
        const messages = ScribeKeeper.Settings.Messages;
        ScribeKeeper.guard(keeper);
        const replacing = keeper.mismatch !== null && !keeper.partial;
        if (!replacing) {
            ScribeKeeper.readable(keeper);
        }
        const settings = ScribeKeeper.settle(keeper.settings, given);
        ScribeKeeper.solvent(keeper);
        if (!ScribeKeeper.writable(keeper)) {
            throw new Error(messages.Watching);
        }
        const edition = keeper.edition + ScribeKeeper.Settings.One;
        ScribeKeeper.writeSettings(keeper, settings, null, edition);
        keeper.settings = settings;
        keeper.savedStop = null;
        keeper.kept = [];
        if (replacing) {
            const campaign = { messages: keeper.mismatch, gone: [] };
            try {
                ScribeStore.write(keeper.storage, keeper.roomId, ScribeStore.Kind.Campaign, campaign);
            } catch (error) {
                ScribeKeeper.restoreEdition(keeper);
                ScribeKeeper.reloadCampaign(keeper);
                ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
                throw new Error(ScribeKeeper.words(error));
            }
            keeper.campaign = campaign;
            keeper.blank = false;
            keeper.mismatch = null;
            keeper.suspectAt = null;
            keeper.unjoined = false;
            keeper.compared = false;
        }
        const book = { log: ScribeLog.create(), fingerprints: {}, adopted: false };
        try {
            ScribeStore.write(keeper.storage, keeper.roomId, ScribeStore.Kind.Book, book);
        } catch (error) {
            ScribeKeeper.restoreEdition(keeper);
            ScribeKeeper.reloadBook(keeper);
            ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            throw new Error(messages.Unconfirmed);
        }
        keeper.edition = edition;
        keeper.book = book;
        keeper.damaged = null;
        keeper.stop = null;
        keeper.retryAt = null;
        keeper.pausing = false;
        if (!keeper.compared) {
            ScribeKeeper.compare(keeper);
            if (!keeper.compared) {
                throw new Error(keeper.problem ?? messages.Unsettled);
            }
        }
        ScribeKeeper.show(keeper);
        await ScribeKeeper.read(keeper);
    },

    /**
     * @param {object} keeper
     * @return {Promise<void>}
     * @throws {Error}
     */
    async resume(keeper) {
        ScribeKeeper.guard(keeper);
        ScribeKeeper.needBook(keeper);
        ScribeKeeper.readable(keeper);
        ScribeKeeper.solvent(keeper);
        if (!ScribeKeeper.writable(keeper)) {
            throw new Error(ScribeKeeper.Settings.Messages.Watching);
        }
        if (keeper.savedStop !== null) {
            ScribeKeeper.saveStop(keeper, null);
        }
        keeper.pausing = false;
        ScribeKeeper.keepStop(keeper, null, false);
        await ScribeKeeper.read(keeper);
    },

    /**
     * @param {object} keeper
     * @return {void}
     * @throws {Error}
     */
    solvent(keeper) {
        if (keeper.owed.size > ScribeKeeper.Settings.NoCount) {
            ScribeKeeper.repay(keeper);
        }
        if (keeper.owed.size > ScribeKeeper.Settings.NoCount) {
            throw new Error(keeper.owing);
        }
    },

    /**
     * @param {object} keeper
     * @return {void}
     * @throws {Error}
     */
    pause(keeper) {
        const messages = ScribeKeeper.Settings.Messages;
        if (keeper.closed) {
            throw new Error(messages.Closed);
        }
        if (!keeper.reader || !ScribeKeeper.writable(keeper)) {
            throw new Error(messages.Watching);
        }
        keeper.pausing = true;
        ScribeKeeper.holdPause(keeper);
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
    },

    /**
     * @param {object} keeper
     * @param {object} book
     * @param {string} flight
     * @return {void}
     * @throws {Error}
     */
    saveBook(keeper, book, flight) {
        const messages = ScribeKeeper.Settings.Messages;
        if (!ScribeKeeper.writable(keeper)) {
            throw new Error(messages.Watching);
        }
        keeper.flight = flight;
        try {
            ScribeStore.write(keeper.storage, keeper.roomId, ScribeStore.Kind.Book, book);
        } catch (error) {
            keeper.flight = null;
            ScribeKeeper.reloadBook(keeper);
            ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
            throw new Error(messages.Unconfirmed);
        }
        keeper.flight = null;
        keeper.book = book;
        ScribeKeeper.show(keeper);
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
    },

    /**
     * @param {object} keeper
     * @return {string[]}
     */
    order(keeper) {
        const order = [];
        if (keeper.intake !== null) {
            for (const message of keeper.intake.messages) {
                order.push(message.id);
            }
        }
        return order;
    },

    /**
     * @param {object} keeper
     * @param {(log: object, state: object) => *} change
     * @return {Promise<void>}
     * @throws {Error}
     */
    async ruling(keeper, change) {
        ScribeKeeper.guard(keeper);
        ScribeKeeper.needBook(keeper);
        const log = ScribeKeeper.copy(keeper.book.log);
        if (change(log, ScribeReplay.run(log, ScribeKeeper.order(keeper))) === null) {
            return;
        }
        const book = { log, fingerprints: keeper.book.fingerprints, adopted: keeper.book.adopted };
        ScribeKeeper.saveBook(keeper, book, ScribeKeeper.Settings.Flight.Ruling);
    },

    /**
     * @param {object} keeper
     * @param {*} operations
     * @param {*} anchor
     * @return {{ log: object, result: Readonly<{ entry: object, refused: ReadonlyArray<Readonly<{ operation: object, reason: string }>> }> }|null}
     * @throws {Error}
     */
    draft(keeper, operations, anchor) {
        const settings = ScribeKeeper.Settings;
        ScribeKeeper.guard(keeper);
        ScribeKeeper.needBook(keeper);
        if (!Array.isArray(operations)) {
            throw new Error(settings.Messages.BadOperations);
        }
        let cited = null;
        if (ScribeKeeper.isObject(anchor) && keeper.intake !== null) {
            for (const message of keeper.intake.messages) {
                if (message.id === String(anchor.id) && Object.hasOwn(keeper.book.log.read, message.id)) {
                    cited = message;
                }
            }
        }
        if (cited === null) {
            throw new Error(settings.Messages.BadAnchor);
        }
        if (operations.length === settings.NoCount) {
            return null;
        }
        const log = ScribeKeeper.copy(keeper.book.log);
        const stretch = { messages: keeper.intake.messages.slice(0, cited.position), origin: ScribeLog.Origin.Notes };
        let result = null;
        try {
            result = ScribeLog.append(log, keeper.state, operations, stretch);
        } catch (error) {
            if (ScribeKeeper.words(error) !== ScribeLog.Settings.StaleState) {
                throw error;
            }
            result = ScribeLog.append(log, ScribeReplay.run(log, ScribeKeeper.order(keeper)), operations, stretch);
        }
        return { log, result };
    },

    /**
     * @param {object} keeper
     * @param {*} operations
     * @param {*} anchor
     * @return {Promise<ReadonlyArray<Readonly<{ operation: object, reason: string }>>>}
     * @throws {Error}
     */
    async file(keeper, operations, anchor) {
        const settings = ScribeKeeper.Settings;
        const drafted = ScribeKeeper.draft(keeper, operations, anchor);
        if (drafted === null) {
            return Object.freeze([]);
        }
        if (drafted.result.entry.operations.length === settings.NoCount) {
            return drafted.result.refused;
        }
        const book = { log: drafted.log, fingerprints: keeper.book.fingerprints, adopted: keeper.book.adopted };
        ScribeKeeper.saveBook(keeper, book, settings.Flight.Filing);
        return drafted.result.refused;
    },

    /**
     * @param {object} keeper
     * @param {*} operations
     * @param {*} anchor
     * @return {Promise<Readonly<{ before: object, state: object, refused: ReadonlyArray<Readonly<{ operation: object, reason: string }>> }>>}
     * @throws {Error}
     */
    async preview(keeper, operations, anchor) {
        const drafted = ScribeKeeper.draft(keeper, operations, anchor);
        const order = ScribeKeeper.order(keeper);
        const before = ScribeReplay.run(keeper.book.log, order);
        if (drafted === null) {
            return Object.freeze({ before, state: before, refused: Object.freeze([]) });
        }
        if (drafted.result.entry.operations.length === ScribeKeeper.Settings.NoCount) {
            return Object.freeze({ before, state: before, refused: drafted.result.refused });
        }
        const state = ScribeReplay.run(drafted.log, order);
        return Object.freeze({ before, state, refused: drafted.result.refused });
    },

    /**
     * @param {object} keeper
     * @param {*} given
     * @return {Promise<void>}
     * @throws {Error}
     */
    async configure(keeper, given) {
        ScribeKeeper.guard(keeper);
        const settings = ScribeKeeper.settle(keeper.settings, given);
        if (!ScribeKeeper.writable(keeper)) {
            throw new Error(ScribeKeeper.Settings.Messages.Watching);
        }
        ScribeKeeper.writeSettings(keeper, settings, keeper.savedStop, keeper.edition);
        keeper.settings = settings;
        ScribeKeeper.tell(keeper, { kind: ScribeKeeper.Event.Changed });
    },

    /**
     * @param {object} keeper
     * @return {void}
     */
    close(keeper) {
        if (keeper.closed) {
            return;
        }
        keeper.closed = true;
        keeper.epoch++;
        keeper.busy = null;
        keeper.flight = null;
        keeper.kept = [];
        if (keeper.reader && keeper.claim === null) {
            try {
                ScribeStore.release(keeper.storage, keeper.roomId, keeper.tabId);
            } catch (error) {
                keeper.problem = ScribeKeeper.words(error);
            }
        }
        keeper.reader = false;
    },

    /**
     * @param {object} keeper
     * @return {Readonly<object>}
     */
    handle(keeper) {
        return Object.freeze({
            /**
             * @return {Readonly<object>}
             */
            view: () => ScribeKeeper.view(keeper),

            /**
             * @param {*} settings
             * @return {Promise<void>}
             */
            adopt: (settings) => ScribeKeeper.adopt(keeper, settings),

            /**
             * @return {Promise<void>}
             */
            resume: () => ScribeKeeper.resume(keeper),

            /**
             * @return {void}
             * @throws {Error}
             */
            pause: () => {
                ScribeKeeper.pause(keeper);
            },

            /**
             * @return {Promise<void>}
             */
            tick: () => ScribeKeeper.tick(keeper),

            /**
             * @return {Promise<void>}
             */
            pull: async () => {
                ScribeKeeper.guard(keeper);
                const epoch = keeper.epoch;
                keeper.busy = ScribeKeeper.Busy.Pulling;
                try {
                    await ScribeKeeper.history(keeper);
                } finally {
                    if (keeper.epoch === epoch) {
                        keeper.busy = null;
                    }
                }
            },

            /**
             * @param {object} operation
             * @return {Promise<void>}
             */
            rule: (operation) =>
                ScribeKeeper.ruling(
                    keeper,
                    /**
                     * @param {object} log
                     * @param {object} state
                     * @return {object}
                     */
                    (log, state) => ScribeLog.rule(log, state, operation),
                ),

            /**
             * @return {Promise<void>}
             */
            keepFirst: () =>
                ScribeKeeper.ruling(
                    keeper,
                    /**
                     * @param {object} log
                     * @param {object} state
                     * @return {readonly object[]}
                     */
                    (log, state) => ScribeLog.keepFirst(log, state),
                ),

            /**
             * @param {number} sequence
             * @return {Promise<void>}
             */
            revoke: (sequence) =>
                ScribeKeeper.ruling(
                    keeper,
                    /**
                     * @param {object} log
                     * @return {object|null}
                     */
                    (log) => ScribeLog.revoke(log, sequence),
                ),

            /**
             * @param {object[]} operations
             * @param {{ id: string, position: number }} anchor
             * @return {Promise<ReadonlyArray<Readonly<{ operation: object, reason: string }>>>}
             */
            file: (operations, anchor) => ScribeKeeper.file(keeper, operations, anchor),

            /**
             * @param {object[]} operations
             * @param {{ id: string, position: number }} anchor
             * @return {Promise<Readonly<{ before: object, state: object, refused: ReadonlyArray<Readonly<{ operation: object, reason: string }>> }>>}
             */
            preview: (operations, anchor) => ScribeKeeper.preview(keeper, operations, anchor),

            /**
             * @param {*} settings
             * @return {Promise<void>}
             */
            configure: (settings) => ScribeKeeper.configure(keeper, settings),

            /**
             * @return {void}
             */
            close: () => {
                ScribeKeeper.close(keeper);
            },
        });
    },

    /**
     * @param {{ storage: { get: Function, set: Function, remove: Function, list: Function }, roomId: string, tabId: string, zeta: { history: Function, newest: Function }, ask: Function, clock: { now: Function, today: Function }, notify: Function, claim?: () => boolean }} options
     * @return {Promise<Readonly<object>>}
     * @throws {Error}
     */
    async open(options) {
        const { storage, roomId, tabId, zeta, ask, clock, notify } = options;
        const settings = ScribeKeeper.Settings;
        const claim = options.claim === undefined || options.claim === null ? null : options.claim;
        if (claim !== null && typeof claim !== settings.FunctionType) {
            throw new Error(settings.Messages.BadClaim);
        }
        const keeper = {
            storage,
            roomId,
            tabId,
            zeta,
            ask,
            clock,
            notify,
            claim,
            phase: ScribeKeeper.Phase.Loading,
            reader: false,
            closed: false,
            epoch: settings.FirstEpoch,
            settings: ScribeKeeper.Defaults,
            savedStop: null,
            stop: null,
            retryAt: null,
            pausing: false,
            campaign: { messages: [], gone: [] },
            blank: true,
            intake: null,
            compared: false,
            newest: null,
            book: null,
            damaged: null,
            unloaded: null,
            pullDone: false,
            partial: false,
            cutShort: false,
            unjoined: false,
            suspectAt: null,
            mismatch: null,
            kept: [],
            owed: new Map(),
            owing: null,
            pulledAt: null,
            lastPull: null,
            cut: null,
            state: null,
            read: settings.NoCount,
            unread: Object.freeze([]),
            lastRead: null,
            made: Object.freeze([]),
            busy: null,
            flight: null,
            problem: null,
            calls: [],
            lines: [],
            spentToday: settings.NoSpending,
            edition: settings.NoEdition,
        };
        ScribeKeeper.show(keeper);
        try {
            keeper.reader = ScribeKeeper.claimed(keeper);
        } catch (error) {
            keeper.problem = ScribeKeeper.words(error);
        }
        ScribeKeeper.load(keeper);
        if (!keeper.reader) {
            keeper.phase = ScribeKeeper.Phase.Watching;
        } else if (keeper.unloaded !== null) {
            keeper.phase = ScribeKeeper.Phase.Stopped;
        } else {
            ScribeKeeper.begin(keeper).catch(
                /**
                 * @param {*} error
                 * @return {void}
                 */
                (error) => {
                    keeper.problem = ScribeKeeper.words(error);
                },
            );
        }
        return ScribeKeeper.handle(keeper);
    },
});
/** @file scribe/page/ScribeScene.js */
const ScribeScene = Object.freeze({
    Settings: Object.freeze({
        Recent: 20,
        Newline: '\n',
        BlankLine: '\n\n',
        Nothing: '',
        None: '(none)',
        Nobody: 'nobody',
        Pipe: '|',
        Joiner: ' | ',
        Comma: ', ',
        ListMarker: '- ',
        Opening: ' (',
        Closing: ')',
        Day: 'Day ',
        Present: 'present: ',
        SubjectPrefix: 'subject:',
        LabelPrefix: 'label:',
        BoldInner: '$1',
        AndWord: ' and ',
        MinPipes: 3,
        PresentField: 3,
        SummaryStart: 4,
        PlaceField: 1,
        ReachField: 2,
        DayField: 0,
        ChangedYes: 'yes',
        Last: -1,
        Headings: Object.freeze({
            Player: 'PLAYER CHARACTER:',
            Subjects: 'SUBJECTS:',
            Scene: 'LAST KNOWN SCENE:',
        }),
        MessagesOpen: 'RECENT MESSAGES (#',
        MessagesTo: ' to #',
        MessagesClose: '):',

        /**
         * @return {RegExp}
         */
        get ChangedLine() {
            return /^changed:\s*(yes|no)(?![\p{L}\p{N}])/iu;
        },

        /**
         * @return {RegExp}
         */
        get ListSplit() {
            return /,|;/;
        },

        /**
         * @return {RegExp}
         */
        get Ampersand() {
            return /\s*&\s*/g;
        },

        /**
         * @return {RegExp}
         */
        get AndSplit() {
            return /\s+and\s+|\s+&\s+/i;
        },

        /**
         * @return {RegExp}
         */
        get Title() {
            return /^(?:lady|lord|sir|dame|dr|doctor|master|mistress|miss|mr|mrs|ms)\.?\s+/i;
        },

        /**
         * @return {RegExp}
         */
        get LeadingAnd() {
            return /^and\s+/i;
        },

        /**
         * @return {RegExp}
         */
        get PlayerSuffix() {
            return /\s*\(player\)$/i;
        },

        PromptLines: Object.freeze([
            'You are the Scribe: you say what is happening right now in an ongoing adult fiction roleplay between consenting adult characters.',
            'You never write story and never judge it. You read the most recent messages and report the scene as it stands at the last message.',
            'Messages are numbered [#n]. Lines marked (player) are spoken or done by the player\'s character. "Narrator" is the storyteller\'s narration, not a character.',
            '',
            'You receive PLAYER CHARACTER, SUBJECTS (everyone and everything known so far), LAST KNOWN SCENE and the RECENT MESSAGES.',
            '',
            'Answer with exactly two lines and nothing else:',
            '',
            'Day N | Place | public or private | present: Label, Label | what is going on, in under 25 words',
            'CHANGED: yes or no',
            '',
            'Rules.',
            '1. Report the scene at the last message, not earlier ones.',
            '2. Day N continues the day count of LAST KNOWN SCENE. Raise it only when the characters have slept through a night or the story has plainly skipped to another day.',
            '3. Place is where the characters are now, in a few words.',
            '4. public means bystanders could see or hear; private means only those present.',
            '5. present lists everyone who is there at the last message, the player\'s character included, separated by commas. Use a label from SUBJECTS exactly when the person has one; otherwise the name the story uses. Someone who has left is not present. Write nobody when no one is there.',
            '6. CHANGED is yes when the place, the day, or who is present differs from LAST KNOWN SCENE, or when there is no LAST KNOWN SCENE. Otherwise no.',
            '7. Never invent. If the messages do not say where the characters are, keep the place of LAST KNOWN SCENE.',
        ]),
    }),

    /**
     * @return {string}
     */
    get Prompt() {
        return ScribeScene.Settings.PromptLines.join(ScribeScene.Settings.Newline);
    },

    /**
     * @param {string} heading
     * @param {readonly string[]} lines
     * @return {string}
     */
    section(heading, lines) {
        const settings = ScribeScene.Settings;
        const body = lines.length === 0 ? settings.None : lines.join(settings.Newline);
        return heading + settings.Newline + body;
    },

    /**
     * @param {number} day
     * @param {string} place
     * @param {string} reach
     * @param {readonly string[]} labels
     * @param {string} summary
     * @return {string}
     */
    line(day, place, reach, labels, summary) {
        const settings = ScribeScene.Settings;
        return [
            settings.Day + day,
            place,
            reach.toLowerCase(),
            settings.Present + (labels.length === 0 ? settings.Nobody : labels.join(settings.Comma)),
            summary,
        ].join(settings.Joiner);
    },

    /**
     * @param {object} state
     * @param {string} player
     * @param {readonly object[]} messages
     * @param {object|null} previous
     * @return {string}
     */
    input(state, player, messages, previous) {
        const settings = ScribeScene.Settings;
        const headings = settings.Headings;
        const subjects = [];
        const labels = new Map();
        for (const subject of state.subjects) {
            labels.set(subject.id, subject.label);
            if (subject.mergedInto === null) {
                subjects.push(settings.ListMarker + subject.label + settings.Opening + subject.kind + settings.Closing);
            }
        }
        const scenes = [];
        if (previous !== null) {
            scenes.push(
                ScribeScene.line(
                    previous.day,
                    previous.place,
                    previous.reach,
                    previous.present.map(
                        /**
                         * @param {{ label: string }} person
                         * @return {string}
                         */
                        (person) => person.label,
                    ),
                    previous.summary,
                ),
            );
        } else {
            let latest = null;
            for (const scene of state.scenes) {
                if (
                    latest === null ||
                    scene.lastPosition > latest.lastPosition ||
                    (scene.lastPosition === latest.lastPosition && scene.firstPosition > latest.firstPosition)
                ) {
                    latest = scene;
                }
            }
            if (latest !== null) {
                scenes.push(
                    ScribeScene.line(
                        latest.day,
                        latest.place,
                        latest.reach,
                        latest.present
                            .filter(
                                /**
                                 * @param {{ until: number|null }} attendee
                                 * @return {boolean}
                                 */
                                (attendee) => attendee.until === null || attendee.until >= latest.lastPosition,
                            )
                            .map(
                                /**
                                 * @param {{ subject: string }} attendee
                                 * @return {string}
                                 */
                                (attendee) => labels.get(attendee.subject),
                            ),
                        latest.summary,
                    ),
                );
            }
        }
        const recent = messages.slice(-settings.Recent);
        const heading =
            settings.MessagesOpen +
            recent[0].position +
            settings.MessagesTo +
            recent.at(settings.Last).position +
            settings.MessagesClose;
        return [
            ScribeScene.section(headings.Player, [player]),
            ScribeScene.section(headings.Subjects, subjects),
            ScribeScene.section(headings.Scene, scenes),
            ScribeScene.section(heading, [ScribeIntake.transcript(recent)]),
        ].join(settings.BlankLine);
    },

    /**
     * @param {string} text
     * @return {readonly string[]}
     */
    lines(text) {
        const settings = ScribeAnswer.Settings;
        const kept = [];
        for (const raw of text.split(settings.LineBreak)) {
            const line = raw
                .replace(settings.FormatCharacter, settings.Nothing)
                .trim()
                .replace(settings.ListMarkers, settings.Nothing)
                .replace(settings.Bold, settings.BoldInner)
                .replace(settings.ListMarkers, settings.Nothing)
                .trim();
            if (line !== settings.Nothing && !settings.Fence.test(line)) {
                kept.push(line);
            }
        }
        return Object.freeze(kept);
    },

    /**
     * @param {string} text
     * @return {Readonly<{ day: number, place: string, reach: string, present: readonly string[], summary: string, changed: boolean|null }>|null}
     */
    parse(text) {
        const settings = ScribeScene.Settings;
        const answer = ScribeAnswer.Settings;
        if (typeof text !== 'string') {
            return null;
        }
        const lines = ScribeScene.lines(text);
        let changed = null;
        for (const line of lines) {
            const found = line.match(settings.ChangedLine);
            if (found !== null) {
                changed = found[1].toLowerCase() === settings.ChangedYes;
                break;
            }
        }
        const sceneLine = lines.find(
            /**
             * @param {string} line
             * @return {boolean}
             */
            (line) => line.split(settings.Pipe).length > settings.MinPipes,
        );
        if (sceneLine === undefined) {
            return null;
        }
        const fields = sceneLine.split(settings.Pipe).map(
            /**
             * @param {string} field
             * @return {string}
             */
            (field) => field.trim(),
        );
        const dayMatch = fields[settings.DayField].match(answer.DayField);
        const day = dayMatch === null ? null : ScribeAnswer.positiveInteger(dayMatch[1]);
        const place = fields[settings.PlaceField];
        const reach = Object.values(ScribeAnswer.Reach).find(
            /**
             * @param {string} value
             * @return {boolean}
             */
            (value) => value.toLowerCase() === fields[settings.ReachField].toLowerCase(),
        );
        const presentMatch = fields[settings.PresentField].match(answer.PresentField);
        if (day === null || place === settings.Nothing || reach === undefined || presentMatch === null) {
            return null;
        }
        const listed = presentMatch[1].trim().match(answer.Bracketed);
        const written = listed === null ? presentMatch[1].trim() : listed[1].trim();
        const present = answer.EmptyAttendance.test(ScribeAnswer.bare(written))
            ? []
            : written
                  .split(settings.ListSplit)
                  .map(
                      /**
                       * @param {string} label
                       * @return {string}
                       */
                      (label) => label.trim(),
                  )
                  .filter(
                      /**
                       * @param {string} label
                       * @return {boolean}
                       */
                      (label) => label !== settings.Nothing,
                  );
        return Object.freeze({
            day,
            place,
            reach,
            present: Object.freeze(present),
            summary: fields.slice(settings.SummaryStart).join(settings.Joiner),
            changed,
        });
    },

    /**
     * @param {string} text
     * @return {string}
     */
    fold(text) {
        const settings = ScribeScene.Settings;
        return ScribeText.normaliseName(text.replace(settings.Ampersand, settings.AndWord));
    },

    /**
     * @param {readonly object[]} active
     * @param {string} text
     * @return {object|null}
     */
    exact(active, text) {
        const key = ScribeScene.fold(text);
        let matches = active.filter(
            /**
             * @param {{ label: string }} subject
             * @return {boolean}
             */
            (subject) => ScribeScene.fold(subject.label) === key,
        );
        if (matches.length === 0) {
            matches = active.filter(
                /**
                 * @param {{ name: string, aka: readonly string[] }} subject
                 * @return {boolean}
                 */
                (subject) =>
                    [subject.name, ...subject.aka].some(
                        /**
                         * @param {string} name
                         * @return {boolean}
                         */
                        (name) => ScribeScene.fold(name) === key,
                    ),
            );
        }
        return matches.length === 1 ? matches[0] : null;
    },

    /**
     * @param {readonly object[]} active
     * @param {string} item
     * @return {ReadonlyArray<Readonly<{ subject: string|null, label: string }>>}
     */
    people(active, item) {
        const settings = ScribeScene.Settings;
        const text = item
            .trim()
            .replace(settings.LeadingAnd, settings.Nothing)
            .replace(settings.PlayerSuffix, settings.Nothing)
            .trim();
        if (text === settings.Nothing) {
            return [];
        }
        const untitled = text.replace(settings.Title, settings.Nothing);
        let subject = ScribeScene.exact(active, text);
        if (subject === null && untitled !== text) {
            subject = ScribeScene.exact(active, untitled);
        }
        if (subject !== null) {
            return [Object.freeze({ subject: subject.id, label: subject.label })];
        }
        const parts = text.split(settings.AndSplit);
        if (parts.length > 1) {
            return parts.flatMap(
                /**
                 * @param {string} part
                 * @return {ReadonlyArray<Readonly<{ subject: string|null, label: string }>>}
                 */
                (part) => ScribeScene.people(active, part),
            );
        }
        return [Object.freeze({ subject: null, label: text })];
    },

    /**
     * @param {object} state
     * @param {readonly string[]} labels
     * @return {ReadonlyArray<Readonly<{ subject: string|null, label: string }>>}
     */
    resolve(state, labels) {
        const active = state.subjects.filter(
            /**
             * @param {{ mergedInto: string|null }} subject
             * @return {boolean}
             */
            (subject) => subject.mergedInto === null,
        );
        const people = [];
        const seen = new Set();
        for (const written of labels) {
            for (const person of ScribeScene.people(active, written)) {
                const identity =
                    person.subject === null
                        ? ScribeScene.Settings.LabelPrefix + ScribeText.normaliseName(person.label)
                        : person.subject;
                if (!seen.has(identity)) {
                    seen.add(identity);
                    people.push(person);
                }
            }
        }
        return Object.freeze(people);
    },

    /**
     * @param {object|null} now
     * @return {Set<string>}
     */
    identities(now) {
        const settings = ScribeScene.Settings;
        return new Set(
            now.present.map(
                /**
                 * @param {{ subject: string|null, label: string }} person
                 * @return {string}
                 */
                (person) =>
                    person.subject === null
                        ? settings.LabelPrefix + ScribeText.normaliseName(person.label)
                        : settings.SubjectPrefix + person.subject,
            ),
        );
    },

    /**
     * @param {object|null} first
     * @param {object|null} second
     * @return {boolean}
     */
    same(first, second) {
        if (first === null || second === null) {
            return first === second;
        }
        if (
            first.day !== second.day ||
            first.reach !== second.reach ||
            ScribeText.normaliseName(first.place) !== ScribeText.normaliseName(second.place)
        ) {
            return false;
        }
        const firstPeople = ScribeScene.identities(first);
        const secondPeople = ScribeScene.identities(second);
        return (
            firstPeople.size === secondPeople.size &&
            [...firstPeople].every(
                /**
                 * @param {string} identity
                 * @return {boolean}
                 */
                (identity) => secondPeople.has(identity),
            )
        );
    },

    /**
     * @param {{ state: object, player: string, messages: readonly object[], previous: object|null, ask: function(string, string): Promise<{ text: string }> }} request
     * @return {Promise<Readonly<object>|null>}
     */
    async now({ state, player, messages, previous, ask }) {
        if (messages.length === 0) {
            return null;
        }
        let text = null;
        try {
            text = (await ask(ScribeScene.Prompt, ScribeScene.input(state, player, messages, previous))).text;
        } catch {
            return null;
        }
        const parsed = ScribeScene.parse(text);
        if (parsed === null) {
            return null;
        }
        const newest = messages.at(ScribeScene.Settings.Last);
        const found = {
            message: newest.id,
            position: newest.position,
            day: parsed.day,
            place: parsed.place,
            reach: parsed.reach,
            present: ScribeScene.resolve(state, parsed.present),
            summary: parsed.summary,
            changed: false,
        };
        const changed = previous === null || !ScribeScene.same(previous, found) || parsed.changed === true;
        return Object.freeze({ ...found, changed });
    },
});
/** @file scribe/page/ScribeReminder.js */
const ScribeReminder = Object.freeze({
    Kind: Object.freeze({
        Fact: 'Fact',
        Knows: 'Knows',
        Unknown: 'Unknown',
    }),

    Settings: Object.freeze({
        MaxBytes: 600,
        MostOpening: 200,
        MostChosen: 8,
        RecentShown: 10,
        LongestText: 200,
        LongestPlace: 60,
        LongestCategory: 30,
        LongestLabel: 60,
        MostLabelWords: 4,
        FewestTestedWords: 3,
        FewestLetters: 3,
        MostPlaceBytes: 80,
        NormalForm: 'NFKC',
        WrittenForm: 'NFC',
        ListWord: 'and',
        Article: 'the',
        Slash: '/',
        LookAlikeQuotes: String.fromCodePoint(
            0x2ba,
            0x2ee,
            0x5f4,
            0x2033,
            0x2036,
            0x275d,
            0x275e,
            0x3003,
            0x1f676,
            0x1f677,
            0x1f678,
        ),
        ListGroup: 1,
        Nothing: '',
        Space: ' ',
        Newline: '\n',
        BlankLine: '\n\n',
        Apostrophe: "'",
        Quote: '"',
        Comma: ', ',
        Colon: ': ',
        Joiner: ' | ',
        FullStop: '.',
        NumberClose: '. ',
        And: ' and ',
        AndCount: ', and ',
        OneOther: ' other',
        ManyOthers: ' others',
        OnePerson: ' person',
        ManyPeople: ' people',
        Toward: 'toward ',
        Day: 'Day ',
        Present: 'Present: ',
        ScenePresent: 'present: ',
        Nobody: 'nobody',
        OnlyOpen: 'Of those here only ',
        KnowsOne: ' knows this about ',
        KnowsMany: ' know this about ',
        OthersDoNot: ', the others do not: ',
        KeepsSecret: ' keeps this secret and no one here knows it: ',
        NoOneKnows: 'No one here knows this about ',
        NotWhole: 'No one here knows the whole of this about ',
        PartOpen: '; only ',
        PartOne: ' knows a part of it: ',
        PartMany: ' know a part of it: ',
        NothingOfIt: '; the others know nothing of it',
        Headings: Object.freeze({
            Scene: 'SCENE:',
            Entries: 'ENTRIES:',
            Recent: 'RECENT MESSAGES:',
        }),

        /**
         * @return {RegExp}
         */
        get LineBreak() {
            return /\r?\n/;
        },

        /**
         * @return {RegExp}
         */
        get TrailingMarks() {
            return /[\s.!?;,]+$/u;
        },

        /**
         * @return {RegExp}
         */
        get Breaking() {
            return /[\p{Cc}\p{Zl}\p{Zp}]/gu;
        },

        /**
         * @return {RegExp}
         */
        get Invisible() {
            return /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
        },

        /**
         * @return {RegExp}
         */
        get QuotationMarks() {
            return /[\p{Quotation_Mark}--[\u{27}\u{2019}]]/gv;
        },

        /**
         * @return {RegExp}
         */
        get Frame() {
            return /[\[\]@]/u;
        },

        /**
         * @return {RegExp}
         */
        get Backslashes() {
            return /\\/g;
        },

        /**
         * @return {RegExp}
         */
        get Words() {
            return /[\p{L}\p{M}\p{N}]+/gu;
        },

        /**
         * @return {RegExp}
         */
        get Letters() {
            return /\p{L}/gu;
        },

        /**
         * @return {RegExp}
         */
        get Bracketed() {
            return /\([^)]*\)|\[[^\]]*\]/gu;
        },

        /**
         * @return {RegExp}
         */
        get FullStops() {
            return /\./g;
        },

        /**
         * @return {RegExp}
         */
        get CategoryCharacters() {
            return /^[\p{Lu}\p{Ll}\p{Lt}0-9 '\u{2019}-]+$/u;
        },

        /**
         * @return {RegExp}
         */
        get LabelCharacters() {
            return /^[\p{Lu}\p{Ll}\p{Lt}\p{Mn}0-9 '\u{2019}-]+$/u;
        },

        /**
         * @return {RegExp}
         */
        get AnswerDress() {
            return /^[\s*>`-]+|[\s*>`-]+$/gu;
        },

        /**
         * @return {RegExp}
         */
        get UseHead() {
            return /^use\**[:\u{FF1A}]\s*\**\s*(.*)$/iu;
        },

        /**
         * @return {RegExp}
         */
        get NoneList() {
            return /^none\.?$/iu;
        },

        /**
         * @return {RegExp}
         */
        get NumberList() {
            return /^\[?\s*#?\d+(?:(?:\s|,|;|(?<!\p{L})and(?!\p{L}))+#?\d+)*\s*\]?\.?$/iu;
        },

        /**
         * @return {RegExp}
         */
        get Digits() {
            return /\d+/g;
        },

        PromptLines: Object.freeze([
            'You help a storyteller keep an ongoing adult fiction roleplay consistent. You never write story.',
            'You receive the SCENE as it stands, a numbered list of ENTRIES that are known to be true, and the RECENT MESSAGES.',
            'Choose the entries the storyteller most needs to be reminded of for this scene: what bears on what is happening now.',
            'Answer with one line and nothing else:',
            '',
            'USE: 3, 7, 12',
            '',
            'Rules.',
            '1. Use only numbers from ENTRIES. At most 8.',
            '2. Prefer entries about what someone here knows or does not know, then lasting facts the recent messages touch on.',
            '3. If nothing is worth reminding, answer USE: none',
        ]),
    }),

    /**
     * @return {string}
     */
    get ChoosePrompt() {
        return ScribeReminder.Settings.PromptLines.join(ScribeReminder.Settings.Newline);
    },

    /**
     * @param {string} text
     * @param {string} form
     * @return {string}
     */
    clean(text, form) {
        const settings = ScribeReminder.Settings;
        return ScribeIntake.collapse(
            text.normalize(form).replace(settings.Breaking, settings.Space).replace(settings.Invisible, settings.Nothing),
        );
    },

    /**
     * @param {string} text
     * @param {number} longest
     * @return {string|null}
     */
    quoted(text, longest) {
        const settings = ScribeReminder.Settings;
        const lookAlikes = Array.from(settings.LookAlikeQuotes);
        const said = Array.from(
            ScribeReminder.clean(text, settings.WrittenForm)
                .replace(settings.TrailingMarks, settings.Nothing)
                .replace(settings.QuotationMarks, settings.Apostrophe)
                .replace(settings.Backslashes, settings.Slash),
            /**
             * @param {string} character
             * @return {string}
             */
            (character) => (lookAlikes.includes(character) ? settings.Apostrophe : character),
        ).join(settings.Nothing);
        const fits =
            said !== settings.Nothing &&
            !settings.Frame.test(said.normalize(settings.NormalForm)) &&
            Array.from(said).length <= longest;
        return fits ? settings.Quote + said + settings.Quote : null;
    },

    /**
     * @param {string} label
     * @return {string|null}
     */
    printed(label) {
        const settings = ScribeReminder.Settings;
        const bare = ScribeIntake.collapse(
            ScribeReminder.clean(label, settings.NormalForm)
                .replace(settings.Bracketed, settings.Space)
                .replace(settings.FullStops, settings.Nothing),
        );
        const words = bare.split(settings.Space);
        const fits =
            settings.LabelCharacters.test(bare) &&
            words.length <= settings.MostLabelWords &&
            Array.from(bare).length <= settings.LongestLabel &&
            !words.some(
                /**
                 * @param {string} word
                 * @return {boolean}
                 */
                (word) => word.toLowerCase() === settings.ListWord,
            );
        return fits ? bare : null;
    },

    /**
     * @param {ReadonlyArray<{ subject: string|null, label: string|null }>} persons
     * @return {ReadonlyArray<string|null>}
     */
    named(persons) {
        const labels = persons.map(
            /**
             * @param {{ subject: string|null, label: string|null }} person
             * @return {string|null}
             */
            (person) => (person.subject === null || person.label === null ? null : ScribeReminder.printed(person.label)),
        );
        const counts = new Map();
        for (const label of labels) {
            if (label !== null) {
                const key = ScribeText.normaliseName(label);
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
        }
        return Object.freeze(
            labels.map(
                /**
                 * @param {string|null} label
                 * @return {string|null}
                 */
                (label) => (label !== null && counts.get(ScribeText.normaliseName(label)) === 1 ? label : null),
            ),
        );
    },

    /**
     * @param {object} state
     * @param {string} player
     * @return {readonly string[]}
     */
    namesakes(state, player) {
        const wanted = ScribeText.normaliseName(player);
        return Object.freeze(
            state.subjects
                .filter(
                    /**
                     * @param {{ label: string, name: string, aka: readonly string[], mergedInto: string|null }} subject
                     * @return {boolean}
                     */
                    (subject) =>
                        subject.mergedInto === null &&
                        [subject.label, subject.name, ...subject.aka].some(
                            /**
                             * @param {string} name
                             * @return {boolean}
                             */
                            (name) => ScribeText.normaliseName(name) === wanted,
                        ),
                )
                .map(
                    /**
                     * @param {{ id: string }} subject
                     * @return {string}
                     */
                    (subject) => subject.id,
                ),
        );
    },

    /**
     * @param {object} state
     * @param {{ present: ReadonlyArray<{ subject: string|null, label: string }> }} now
     * @param {string} player
     * @return {ReadonlyArray<Readonly<{ subject: string|null, label: string|null }>>}
     */
    people(state, now, player) {
        const settings = ScribeReminder.Settings;
        const namesakes = ScribeReminder.namesakes(state, player);
        const self = namesakes.length === 1 ? namesakes[0] : null;
        /**
         * @param {string} text
         * @return {string}
         */
        const keyOf = (text) => ScribeText.normaliseName(ScribeReminder.clean(text, settings.NormalForm));
        const books = new Map();
        const names = new Map();
        const words = new Map();
        /**
         * @param {Map<string, Set<string>>} index
         * @param {string} key
         * @param {string} owner
         * @return {void}
         */
        const enter = (index, key, owner) => {
            const owners = index.get(key) ?? new Set();
            owners.add(owner);
            index.set(key, owners);
        };
        for (const subject of state.subjects) {
            const owner = subject.mergedInto === null ? subject.id : subject.mergedInto;
            const spoken = [subject.label, subject.name, ...subject.aka];
            const printed = ScribeReminder.printed(subject.label);
            books.set(subject.id, subject.label);
            for (const name of printed === null ? spoken : [...spoken, printed]) {
                enter(names, keyOf(name), owner);
            }
            for (const name of spoken) {
                for (const [word] of ScribeReminder.clean(name, settings.NormalForm).matchAll(settings.Words)) {
                    enter(words, ScribeText.normaliseName(word), owner);
                }
            }
        }
        /**
         * @param {Map<string, Set<string>>} index
         * @param {string} key
         * @param {string} owner
         * @return {boolean}
         */
        const elsewhere = (index, key, owner) => {
            const owners = index.get(key);
            return owners !== undefined && (owners.size > 1 || !owners.has(owner));
        };
        const playerKey = keyOf(player);
        const article = ScribeText.normaliseName(settings.Article);
        /**
         * @param {string} subject
         * @return {string|null}
         */
        const allowed = (subject) => {
            const printed = books.has(subject) ? ScribeReminder.printed(books.get(subject)) : null;
            if (printed === null) {
                return null;
            }
            const key = ScribeText.normaliseName(printed);
            const taken = elsewhere(names, key, subject) || (key === playerKey && subject !== self);
            const tested = printed.split(settings.Space).length >= settings.FewestTestedWords;
            const speaks =
                tested &&
                Array.from(printed.matchAll(settings.Words)).some(
                    /**
                     * @param {string[]} match
                     * @return {boolean}
                     */
                    ([word]) => {
                        const wordKey = ScribeText.normaliseName(word);
                        return (
                            Array.from(word.matchAll(settings.Letters)).length >= settings.FewestLetters &&
                            wordKey !== article &&
                            elsewhere(words, wordKey, subject)
                        );
                    },
                );
            return taken || speaks ? null : printed;
        };
        const found = [];
        const seen = new Set();
        const strangers = new Set();
        for (const person of now.present) {
            if (person.subject === null) {
                const key = ScribeText.normaliseName(person.label);
                if (!strangers.has(key)) {
                    strangers.add(key);
                    found.push({ subject: null, label: null });
                }
                continue;
            }
            const subject = ScribeKnowledge.survivor(state, person.subject);
            if (!seen.has(subject)) {
                seen.add(subject);
                found.push({ subject, label: allowed(subject) });
            }
        }
        const labels = ScribeReminder.named(found);
        return Object.freeze(
            found.map(
                /**
                 * @param {{ subject: string|null }} person
                 * @param {number} index
                 * @return {Readonly<{ subject: string|null, label: string|null }>}
                 */
                (person, index) => Object.freeze({ subject: person.subject, label: labels[index] }),
            ),
        );
    },

    /**
     * @param {object} state
     * @param {{ present: ReadonlyArray<{ subject: string|null, label: string }> }} now
     * @param {string} player
     * @param {readonly object[]} unread
     * @return {ReadonlyArray<Readonly<{ number: number, kind: string, subject: string, fact: string, line: string }>>}
     */
    candidates(state, now, player, unread) {
        const settings = ScribeReminder.Settings;
        const kinds = ScribeReminder.Kind;
        const relation = ScribeCategory.Settings.RelationCategory;
        const everyone = ScribeKnowledge.Everyone;
        const namesakes = ScribeReminder.namesakes(state, player);
        const self = namesakes.length === 1 ? namesakes[0] : null;
        const heard = self === null ? now.present : [...now.present, { subject: self, label: settings.Nothing }];
        const present = ScribeReminder.people(state, { present: heard }, player);
        const names = new Map();
        for (const person of present) {
            if (person.subject !== null) {
                names.set(person.subject, person.label);
            }
        }
        const room = present.filter(
            /**
             * @param {{ subject: string|null }} person
             * @return {boolean}
             */
            (person) => self === null || person.subject !== self,
        );
        const owners = room.filter(
            /**
             * @param {{ subject: string|null }} person
             * @return {boolean}
             */
            (person) => person.subject !== null,
        );
        const inRoom = new Set(
            owners.map(
                /**
                 * @param {{ subject: string }} person
                 * @return {string}
                 */
                (person) => person.subject,
            ),
        );
        const contested = new Set();
        for (const conflict of state.conflicts) {
            contested.add(conflict.established);
            for (const id of conflict.others) {
                contested.add(id);
            }
        }
        const byId = new Map();
        for (const fact of state.facts) {
            byId.set(fact.id, fact);
        }
        const thinner = new Map();
        for (const refinement of state.refinements) {
            thinner.set(refinement.to, byId.get(refinement.from));
        }
        /**
         * @param {object} fact
         * @return {object[]}
         */
        const chainOf = (fact) => {
            const chain = [];
            for (let wording = fact; wording !== undefined; wording = thinner.get(wording.id)) {
                chain.push(wording);
            }
            return chain;
        };
        /**
         * @param {{ subject: string|null }} person
         * @param {object} fact
         * @return {boolean}
         */
        const knowing = (person, fact) =>
            person.subject === null
                ? ScribeKnowledge.audience(state, fact) === everyone
                : ScribeKnowledge.knows(state, person.subject, fact);
        /**
         * @param {object} fact
         * @return {boolean}
         */
        const usable = (fact) => {
            const kind = ScribeReplay.kindOf(fact.category);
            const changing = kind === ScribeCategory.Kind.Moving || kind === ScribeCategory.Kind.Passing;
            const target = fact.target === null ? null : ScribeKnowledge.survivor(state, fact.target);
            const aimed = fact.category !== relation || (target !== null && (inRoom.has(target) || target === self));
            const quarrel = chainOf(fact).some(
                /**
                 * @param {{ id: string }} wording
                 * @return {boolean}
                 */
                (wording) => contested.has(wording.id),
            );
            return fact.status === ScribeReplay.Status.InForce && !(changing && unread.length > 0) && aimed && !quarrel;
        };
        /**
         * @param {object} fact
         * @return {string|null}
         */
        const statement = (fact) => {
            const text = ScribeReminder.quoted(fact.text, settings.LongestText);
            const category = ScribeReminder.clean(fact.category, settings.NormalForm);
            const plain =
                settings.CategoryCharacters.test(category) && Array.from(category).length <= settings.LongestCategory;
            if (text === null || !plain) {
                return null;
            }
            if (fact.category !== relation) {
                return category + settings.Colon + text;
            }
            const target = names.get(ScribeKnowledge.survivor(state, fact.target));
            return target === null ? null : settings.Toward + target + settings.Colon + text;
        };
        /**
         * @param {ReadonlyArray<{ label: string|null }>} people
         * @return {string|null}
         */
        const listed = (people) => {
            const labels = people.map(
                /**
                 * @param {{ label: string|null }} person
                 * @return {string|null}
                 */
                (person) => person.label,
            );
            if (labels.includes(null)) {
                return null;
            }
            const last = labels.pop();
            return labels.length === 0 ? last : labels.join(settings.Comma) + settings.And + last;
        };
        const offered = [];
        /**
         * @param {string} kind
         * @param {string} subject
         * @param {string} fact
         * @param {string} line
         * @return {void}
         */
        const offer = (kind, subject, fact, line) => {
            offered.push(Object.freeze({ number: offered.length + 1, kind, subject, fact, line }));
        };
        const playerLabel = self === null ? null : names.get(self);
        if (playerLabel !== null && room.length > 0) {
            const wordings = new Map();
            for (const person of owners) {
                const known = new Set();
                for (const fact of ScribeKnowledge.about(state, person.subject, self).facts) {
                    known.add(fact.id);
                }
                wordings.set(person.subject, known);
            }
            for (const fact of state.facts) {
                if (fact.subject !== self || !usable(fact)) {
                    continue;
                }
                const holders = room.filter(
                    /**
                     * @param {{ subject: string|null }} person
                     * @return {boolean}
                     */
                    (person) => knowing(person, fact),
                );
                if (holders.length === room.length) {
                    continue;
                }
                const placed = new Set(holders);
                const groups = [];
                for (const wording of chainOf(fact).slice(1)) {
                    const people = room.filter(
                        /**
                         * @param {{ subject: string|null }} person
                         * @return {boolean}
                         */
                        (person) =>
                            !placed.has(person) &&
                            (person.subject === null
                                ? ScribeKnowledge.audience(state, wording) === everyone
                                : wordings.get(person.subject).has(wording.id)),
                    );
                    for (const person of people) {
                        placed.add(person);
                    }
                    if (people.length > 0) {
                        groups.push({ wording, people });
                    }
                }
                const parts = groups.map(
                    /**
                     * @param {{ wording: object, people: ReadonlyArray<{ label: string|null }> }} group
                     * @return {string|null}
                     */
                    (group) => {
                        const knowers = listed(group.people);
                        const thin = statement(group.wording);
                        const verb = group.people.length === 1 ? settings.PartOne : settings.PartMany;
                        return knowers === null || thin === null ? null : settings.PartOpen + knowers + verb + thin;
                    },
                );
                const said = statement(fact);
                const knowers = holders.length === 0 ? settings.Nothing : listed(holders);
                if (said === null || knowers === null || parts.includes(null)) {
                    continue;
                }
                let line = settings.NoOneKnows + playerLabel + settings.Colon + said;
                if (holders.length > 0) {
                    const verb = holders.length === 1 ? settings.KnowsOne : settings.KnowsMany;
                    const tail = groups.length === 0 ? settings.OthersDoNot : settings.Colon;
                    line = settings.OnlyOpen + knowers + verb + playerLabel + tail + said;
                } else if (groups.length > 0) {
                    line = settings.NotWhole + playerLabel + settings.Colon + said;
                } else if (fact.hidden && fact.widened !== everyone) {
                    line = playerLabel + settings.KeepsSecret + said;
                }
                const ending = groups.length > 0 && placed.size < room.length ? settings.NothingOfIt : settings.Nothing;
                const kind = holders.length === 0 ? kinds.Unknown : kinds.Knows;
                offer(kind, self, fact.id, line + parts.join(settings.Nothing) + ending);
            }
        }
        for (const owner of self === null ? owners : [...owners, { subject: self, label: playerLabel }]) {
            if (owner.label === null) {
                continue;
            }
            for (const fact of state.facts) {
                const open = !fact.hidden || fact.widened === everyone;
                if (fact.subject !== owner.subject || !open || !usable(fact)) {
                    continue;
                }
                const told =
                    room.every(
                        /**
                         * @param {{ subject: string|null }} person
                         * @return {boolean}
                         */
                        (person) => knowing(person, fact),
                    ) &&
                    namesakes.every(
                        /**
                         * @param {string} namesake
                         * @return {boolean}
                         */
                        (namesake) => ScribeKnowledge.knows(state, namesake, fact),
                    );
                const said = statement(fact);
                if (told && said !== null) {
                    const joiner = fact.category === relation ? settings.Space : settings.Comma;
                    offer(kinds.Fact, owner.subject, fact.id, owner.label + joiner + said);
                }
            }
        }
        return Object.freeze(offered);
    },

    /**
     * @param {{ day: number, place: string, reach: string, present: ReadonlyArray<{ label: string }>, summary: string }} now
     * @param {ReadonlyArray<{ number: number, line: string }>} candidates
     * @param {readonly object[]} recent
     * @return {string}
     */
    chooseInput(now, candidates, recent) {
        const settings = ScribeReminder.Settings;
        const headings = settings.Headings;
        const labels = now.present.map(
            /**
             * @param {{ label: string }} person
             * @return {string}
             */
            (person) => ScribeIntake.collapse(person.label),
        );
        const scene = [
            settings.Day + now.day,
            ScribeIntake.collapse(now.place),
            now.reach.toLowerCase(),
            settings.ScenePresent + (labels.length === 0 ? settings.Nobody : labels.join(settings.Comma)),
            ScribeIntake.collapse(now.summary),
        ].join(settings.Joiner);
        const entries = candidates.map(
            /**
             * @param {{ number: number, line: string }} candidate
             * @return {string}
             */
            (candidate) => candidate.number + settings.NumberClose + candidate.line,
        );
        return [
            headings.Scene + settings.Newline + scene,
            [headings.Entries, ...entries].join(settings.Newline),
            headings.Recent + settings.Newline + ScribeIntake.transcript(recent.slice(-settings.RecentShown)),
        ].join(settings.BlankLine);
    },

    /**
     * @param {*} text
     * @param {ReadonlyArray<{ number: number }>} candidates
     * @return {readonly object[]|null}
     */
    chosen(text, candidates) {
        const settings = ScribeReminder.Settings;
        if (typeof text !== 'string') {
            return null;
        }
        const lines = text.split(settings.LineBreak).map(
            /**
             * @param {string} line
             * @return {string}
             */
            (line) => line.replace(settings.AnswerDress, settings.Nothing),
        );
        for (const [index, line] of lines.entries()) {
            const head = line.match(settings.UseHead);
            if (head === null) {
                continue;
            }
            let listed = head[settings.ListGroup];
            if (listed === settings.Nothing) {
                const next = lines.slice(index + 1).find(
                    /**
                     * @param {string} later
                     * @return {boolean}
                     */
                    (later) => later !== settings.Nothing,
                );
                listed = next === undefined ? settings.Nothing : next;
            }
            if (settings.NoneList.test(listed)) {
                return Object.freeze([]);
            }
            if (!settings.NumberList.test(listed)) {
                continue;
            }
            const numbers = new Set();
            for (const [digits] of listed.matchAll(settings.Digits)) {
                numbers.add(Number(digits));
            }
            const kept = candidates
                .filter(
                    /**
                     * @param {{ number: number }} candidate
                     * @return {boolean}
                     */
                    (candidate) => numbers.has(candidate.number),
                )
                .slice(0, settings.MostChosen);
            return kept.length === 0 ? null : Object.freeze(kept);
        }
        return null;
    },

    /**
     * @param {{ day: number, place: string, reach: string, present: ReadonlyArray<{ subject: string|null, label: string|null }> }} now
     * @param {ReadonlyArray<{ line: string }>} entries
     * @return {Readonly<{ text: string, used: readonly object[] }>}
     */
    fit(now, entries) {
        const settings = ScribeReminder.Settings;
        const labels = ScribeReminder.named(now.present);
        const shown = labels.filter(
            /**
             * @param {string|null} label
             * @return {boolean}
             */
            (label) => label !== null,
        );
        /**
         * @param {number} kept
         * @return {string}
         */
        const list = (kept) => {
            const counted = labels.length - kept;
            if (kept === 0) {
                if (counted === 0) {
                    return settings.Nobody;
                }
                return counted + (counted === 1 ? settings.OnePerson : settings.ManyPeople);
            }
            const names = shown.slice(0, kept).join(settings.Comma);
            if (counted === 0) {
                return names;
            }
            return names + settings.AndCount + counted + (counted === 1 ? settings.OneOther : settings.ManyOthers);
        };
        /**
         * @param {string|null} place
         * @param {number} kept
         * @return {string}
         */
        const open = (place, kept) =>
            ScribeIntake.Settings.OwnMarker +
            settings.Space +
            settings.Day +
            now.day +
            settings.Comma +
            (place === null ? settings.Nothing : place + settings.Comma) +
            now.reach.toLowerCase() +
            settings.FullStop +
            settings.Space +
            settings.Present +
            list(kept) +
            settings.FullStop;
        const written = ScribeReminder.quoted(now.place, settings.LongestPlace);
        const place = written === null || ScribeText.bytes(written) > settings.MostPlaceBytes ? null : written;
        let kept = shown.length;
        let text = open(place, kept);
        while (kept > 0 && ScribeText.bytes(text) > settings.MostOpening) {
            kept--;
            text = open(place, kept);
        }
        if (ScribeText.bytes(text) > settings.MostOpening) {
            text = open(null, kept);
        }
        const used = [];
        for (const entry of entries) {
            const longer = text + settings.Space + entry.line + settings.FullStop;
            if (ScribeText.bytes(longer) <= settings.MaxBytes) {
                text = longer;
                used.push(entry);
            }
        }
        return Object.freeze({ text, used: Object.freeze(used) });
    },

    /**
     * @param {{ day: number, place: string, reach: string, present: ReadonlyArray<{ subject: string|null, label: string|null }> }} now
     * @param {ReadonlyArray<{ line: string }>} entries
     * @return {string}
     */
    write(now, entries) {
        return ScribeReminder.fit(now, entries).text;
    },

    /**
     * @param {{ state: object, now: object|null, player: string, recent: readonly object[], unread: readonly object[], ask: function(string, string): Promise<{ text: string }>, first?: * }} request
     * @return {Promise<Readonly<{ text: string, used: readonly object[], led: readonly string[] }>|null>}
     */
    async compose({ state, now, player, recent, unread, ask, first }) {
        const settings = ScribeReminder.Settings;
        if (now === null) {
            return null;
        }
        const wanted = Array.isArray(first) ? first : [];
        const offered = ScribeReminder.candidates(state, now, player, unread);
        const scene = Object.freeze({ ...now, present: ScribeReminder.people(state, now, player) });
        const leading = [];
        for (const id of wanted) {
            const found = offered.find(
                /**
                 * @param {{ fact: string }} candidate
                 * @return {boolean}
                 */
                (candidate) => candidate.fact === id,
            );
            if (found !== undefined && !leading.includes(found) && leading.length < settings.MostChosen) {
                leading.push(found);
            }
        }
        const rest = offered.filter(
            /**
             * @param {object} candidate
             * @return {boolean}
             */
            (candidate) => !leading.includes(candidate),
        );
        const places = settings.MostChosen - leading.length;
        let picked = rest.slice(0, places);
        if (places > 0 && rest.length > places) {
            const input = ScribeReminder.chooseInput(now, rest, recent);
            let text;
            try {
                text = (await ask(ScribeReminder.ChoosePrompt, input)).text;
            } catch {
                text = null;
            }
            const chosen = ScribeReminder.chosen(text, rest);
            picked = chosen === null ? rest.slice(0, places) : chosen.slice(0, places);
        }
        const fitted = ScribeReminder.fit(scene, [...leading, ...picked]);
        const led = [];
        for (const id of wanted) {
            const said = fitted.used.some(
                /**
                 * @param {{ fact: string }} candidate
                 * @return {boolean}
                 */
                (candidate) => candidate.fact === id,
            );
            if (said && !led.includes(id)) {
                led.push(id);
            }
        }
        return Object.freeze({ text: fitted.text, used: fitted.used, led: Object.freeze(led) });
    },
});
/** @file scribe/page/ScribePedant.js */
const ScribePedant = Object.freeze({
    Kind: Object.freeze({
        Spelling: 'Spelling',
        Contradiction: 'Contradiction',
        Leak: 'Leak',
    }),

    Block: Object.freeze({
        Contradictions: 'CONTRADICTIONS',
        Leaks: 'LEAKS',
    }),

    Settings: Object.freeze({
        Newline: '\n',
        BlankLine: '\n\n',
        Nothing: '',
        Space: ' ',
        Pipe: '|',
        Joiner: ' | ',
        Apostrophe: "'",
        Unquoted: '$1',
        Unwrapped: '$2',
        Hidden: ' (hidden)',
        RelationTo: 'relation to ',
        DoesNotKnow: ' does not know ',
        ReplyOpen: 'REPLY (#',
        ReplyClose: '):',
        TooLong: '(too long to show)',
        Headings: Object.freeze({
            Player: 'PLAYER CHARACTER:',
            Ledger: 'LEDGER:',
            Unknown: 'DOES NOT KNOW:',
            Since: 'SINCE THE BOOK WAS LAST READ:',
        }),
        MostWords: 120,
        UnreadCharacters: 60000,
        FindingsPerFact: 1,
        FindingsPerKind: 20,
        DressPasses: 4,
        EdgeWidth: 3,
        NormalForm: 'NFC',
        NotFound: -1,
        ShortestNameWord: 4,
        ContradictionFields: 4,
        LeakFields: 3,
        FactField: 0,
        LabelField: 1,
        CategoryField: 2,
        SaidStart: 3,
        SpeakerField: 1,
        WordsStart: 2,
        NumberGroup: 1,
        Finding: Object.freeze({
            kind: null,
            message: null,
            position: null,
            subject: null,
            label: null,
            fact: null,
            category: null,
            book: null,
            said: null,
            speaker: null,
            speakerLabel: null,
            written: null,
        }),

        /**
         * @return {RegExp}
         */
        get Word() {
            return /[\p{L}\p{M}]+(?:['’ʼ‐‑-][\p{L}\p{M}]+)*/gu;
        },

        /**
         * @return {RegExp}
         */
        get Capital() {
            return /^[\p{Lu}\p{Lt}]/u;
        },

        /**
         * @return {RegExp}
         */
        get Possessive() {
            return /['’ʼ]s$/iu;
        },

        /**
         * @return {RegExp}
         */
        get Plural() {
            return /s$/u;
        },

        /**
         * @return {RegExp}
         */
        get NonLetters() {
            return /[^\p{L}]/gu;
        },

        /**
         * @return {RegExp}
         */
        get NoneLine() {
            return /^\(?none/iu;
        },

        /**
         * @return {RegExp}
         */
        get TableEdges() {
            return /^\|\s*|\s*\|$/gu;
        },

        /**
         * @return {RegExp}
         */
        get IdDress() {
            return /[`\[\]*_]|:+(?=[`\[\]*_]*$)/gu;
        },

        /**
         * @return {RegExp}
         */
        get FactNumber() {
            return /^F0*(\d+)$/iu;
        },

        /**
         * @return {RegExp}
         */
        get Forbidden() {
            return /[|\[\]@\p{Zl}\p{Zp}\p{Cc}]/u;
        },

        /**
         * @return {RegExp}
         */
        get Tab() {
            return /\t/gu;
        },

        /**
         * @return {RegExp}
         */
        get Format() {
            return /\p{Cf}/gu;
        },

        /**
         * @return {RegExp}
         */
        get Spacing() {
            return /[\s\p{Cc}]+/gu;
        },

        /**
         * @return {RegExp}
         */
        get Wrapped() {
            return /^(\*\*|\*|_|`)([\s\S]*)\1$/u;
        },

        /**
         * @return {RegExp}
         */
        get Quoted() {
            return /^["'“‘]([\s\S]*)["'”’]$/u;
        },

        /**
         * @return {RegExp}
         */
        get LeadingEllipsis() {
            return /^(?:\.\.\.|…)/u;
        },

        /**
         * @return {RegExp}
         */
        get TrailingEllipsis() {
            return /(?:\.\.\.|…)$/u;
        },

        /**
         * @return {RegExp}
         */
        get Apostrophes() {
            return /[’‘ʼ]/gu;
        },

        /**
         * @return {RegExp}
         */
        get WordBefore() {
            return /(?:[\p{L}\p{N}\p{M}]|\p{L}['’])$/u;
        },

        /**
         * @return {RegExp}
         */
        get WordAfter() {
            return /^(?:[\p{L}\p{N}\p{M}]|['’]\p{L})/u;
        },

        PromptLines: Object.freeze([
            'You are the Pedant: a proofreader for an ongoing adult fiction roleplay between consenting adult characters. You never write story.',
            'You receive PLAYER CHARACTER, a LEDGER of established facts (each with an id like F12, its subject, its category and its text), a list of what certain speakers DO NOT KNOW, the messages SINCE THE BOOK WAS LAST READ, and one REPLY from the storyteller.',
            'Find where the REPLY disagrees with the LEDGER, and where a speaker uses something they do not know.',
            '',
            'Answer with these two blocks, each starting with its === line. Leave a block out if it has nothing. Write nothing else.',
            '',
            '=== CONTRADICTIONS',
            'F12 | Label | category | the words of the reply that say otherwise',
            '=== LEAKS',
            'F7 | Label of the speaker | the words of theirs that show they know it',
            '',
            'Rules.',
            "1. A contradiction is a statement in the REPLY, about the LEDGER fact's own subject, that cannot be true together with that fact: another age, number, colour, name, place or description of the same thing. Give the fact's id, its subject's label and its category exactly as the LEDGER shows them, and copy the reply's own words for the other value. Never report a fact marked (hidden) as contradicted.",
            '2. More detail about the same thing is not a contradiction. Less detail is not a contradiction. The same thing in other words is not a contradiction. Something the story has plainly changed (a move, a promotion, a wound), in the REPLY or in the messages since the book was last read, is not a contradiction.',
            "3. A leak is a line spoken by a speaker that states, uses or reacts to a fact listed for that speaker under DOES NOT KNOW. Copy the few words of that speaker's own line that show it, exactly as the REPLY has them. What the narrator says, or what another character says or thinks, is not that speaker's leak.",
            '4. It is not a leak if the speaker was told or shown the fact earlier in the REPLY, or anywhere in the messages since the book was last read.',
            '5. Report only what the REPLY itself shows. Never guess. When in doubt, leave it out.',
        ]),
    }),

    /**
     * @return {string}
     */
    get Prompt() {
        return ScribePedant.Settings.PromptLines.join(ScribePedant.Settings.Newline);
    },

    Keys: Object.freeze({
        /**
         * @param {object} finding
         * @return {string[]}
         */
        Spelling(finding) {
            return [ScribeText.normaliseName(finding.written), finding.subject];
        },

        /**
         * @param {object} finding
         * @return {string[]}
         */
        Contradiction(finding) {
            return [finding.message, finding.fact, ScribeReplay.wording(finding.said)];
        },

        /**
         * @param {object} finding
         * @return {string[]}
         */
        Leak(finding) {
            return [finding.message, finding.fact, finding.speaker];
        },
    }),

    /**
     * @param {object} message
     * @param {object} fields
     * @return {Readonly<object>}
     */
    finding(message, fields) {
        return Object.freeze({
            ...ScribePedant.Settings.Finding,
            message: message.id,
            position: message.position,
            ...fields,
        });
    },

    /**
     * @param {string} text
     * @return {string}
     */
    clean(text) {
        const settings = ScribePedant.Settings;
        return text.replace(settings.Format, settings.Nothing).replace(settings.Spacing, settings.Space).trim();
    },

    /**
     * @param {string} text
     * @return {string}
     */
    folded(text) {
        const settings = ScribePedant.Settings;
        return ScribePedant.clean(text)
            .replace(settings.Apostrophes, settings.Apostrophe)
            .toLowerCase()
            .normalize(settings.NormalForm);
    },

    /**
     * @param {string} text
     * @return {string}
     */
    undress(text) {
        const settings = ScribePedant.Settings;
        let current = ScribePedant.clean(text.replace(settings.Tab, settings.Space));
        for (let pass = 0; pass < settings.DressPasses; pass++) {
            const next = current
                .replace(settings.Wrapped, settings.Unwrapped)
                .trim()
                .replace(settings.Quoted, settings.Unquoted)
                .trim()
                .replace(settings.LeadingEllipsis, settings.Nothing)
                .trim()
                .replace(settings.TrailingEllipsis, settings.Nothing)
                .trim();
            if (next === current) {
                break;
            }
            current = next;
        }
        return current;
    },

    /**
     * @param {object} fact
     * @return {boolean}
     */
    veiled(fact) {
        return fact.hidden && fact.widened !== ScribeKnowledge.Everyone;
    },

    /**
     * @param {object} state
     * @param {string} written
     * @return {object|null}
     */
    find(state, written) {
        const key = ScribeText.normaliseName(written);
        const active = state.subjects.filter(
            /**
             * @param {{ mergedInto: string|null }} subject
             * @return {boolean}
             */
            (subject) => subject.mergedInto === null,
        );
        let matches = active.filter(
            /**
             * @param {{ label: string }} subject
             * @return {boolean}
             */
            (subject) => ScribeText.normaliseName(subject.label) === key,
        );
        if (matches.length === 0) {
            matches = active.filter(
                /**
                 * @param {{ name: string, aka: readonly string[] }} subject
                 * @return {boolean}
                 */
                (subject) =>
                    [subject.name, ...subject.aka].some(
                        /**
                         * @param {string} name
                         * @return {boolean}
                         */
                        (name) => ScribeText.normaliseName(name) === key,
                    ),
            );
        }
        return matches.length === 1 ? matches[0] : null;
    },

    /**
     * @param {object} state
     * @return {Set<string>}
     */
    names(state) {
        const known = new Set();
        for (const subject of state.subjects) {
            for (const name of [subject.name, ...subject.aka]) {
                for (const [word] of name.matchAll(ScribePedant.Settings.Word)) {
                    known.add(ScribeText.normaliseName(word));
                }
            }
        }
        return known;
    },

    /**
     * @param {object} state
     * @param {object} subject
     * @return {string[]}
     */
    openWords(state, subject) {
        const settings = ScribePedant.Settings;
        const secret = new Set();
        const open = new Set();
        for (const fact of state.facts) {
            if (fact.subject === subject.id && fact.category === ScribeLog.Settings.AkaCategory) {
                (ScribePedant.veiled(fact) ? secret : open).add(ScribeText.normaliseName(fact.text));
            }
        }
        for (const alias of state.aliases) {
            if (alias.subject === subject.id) {
                open.add(ScribeText.normaliseName(alias.name));
            }
        }
        const told = subject.aka.filter(
            /**
             * @param {string} name
             * @return {boolean}
             */
            (name) => {
                const key = ScribeText.normaliseName(name);
                return open.has(key) || !secret.has(key);
            },
        );
        const words = [];
        for (const name of [subject.name, ...told]) {
            for (const [word] of name.matchAll(settings.Word)) {
                if (Array.from(word).length >= settings.ShortestNameWord) {
                    words.push(word);
                }
            }
        }
        return words;
    },

    /**
     * @param {object} state
     * @param {string} player
     * @param {object} message
     * @return {object[]}
     */
    speakers(state, player, message) {
        const playing = ScribePedant.find(state, player);
        const found = [];
        for (const block of message.blocks) {
            const subject =
                block.role === ScribeIntake.Role.Character ? ScribePedant.find(state, block.speaker) : null;
            if (subject !== null && subject !== playing && !found.includes(subject)) {
                found.push(subject);
            }
        }
        return found;
    },

    /**
     * @param {object} state
     * @return {Set<string|null>}
     */
    contested(state) {
        const ids = new Set();
        for (const conflict of state.conflicts) {
            for (const id of [conflict.established, ...conflict.others]) {
                ids.add(id);
            }
        }
        return ids;
    },

    /**
     * @param {object} state
     * @param {object} fact
     * @return {object[]}
     */
    wordings(state, fact) {
        const thinner = new Map();
        for (const refinement of state.refinements) {
            thinner.set(refinement.to, refinement.from);
        }
        const chain = [];
        let wording = fact;
        while (wording !== undefined) {
            chain.push(wording);
            wording = ScribeLog.lookup(state.facts, thinner.get(wording.id));
        }
        return chain;
    },

    /**
     * @param {object} state
     * @param {string} knower
     * @param {object} fact
     * @return {boolean}
     */
    aware(state, knower, fact) {
        if (ScribeKnowledge.knows(state, knower, fact)) {
            return true;
        }
        const chain = ScribePedant.wordings(state, fact);
        return ScribeKnowledge.about(state, knower, fact.subject).facts.some(
            /**
             * @param {object} wording
             * @return {boolean}
             */
            (wording) => chain.includes(wording),
        );
    },

    /**
     * @param {object} state
     * @param {string} player
     * @param {object} message
     * @param {readonly object[]} unread
     * @return {{ ledger: object[], candidates: object[], pairs: Array<{ speaker: object, fact: object }>, since: string|null }}
     */
    survey(state, player, message, unread) {
        const settings = ScribePedant.Settings;
        const kinds = ScribeCategory.Kind;
        const contested = ScribePedant.contested(state);
        const groups = new Map();
        for (const id of ScribeAnalyzer.select(state, ScribeIntake.transcript([message]), player, message.position)) {
            groups.set(id, []);
        }
        for (const fact of state.facts) {
            const group = groups.get(fact.subject);
            if (group !== undefined && fact.status === ScribeReplay.Status.InForce && !contested.has(fact.id)) {
                group.push(fact);
            }
        }
        const facts = [...groups.values()].flat();
        const candidates = facts.filter(
            /**
             * @param {object} fact
             * @return {boolean}
             */
            (fact) => {
                const kind = ScribeReplay.kindOf(fact.category);
                return (kind === kinds.Fixed || kind === kinds.Moving) && !ScribePedant.veiled(fact);
            },
        );
        const earlier = unread
            .filter(
                /**
                 * @param {{ position: number }} item
                 * @return {boolean}
                 */
                (item) => item.position < message.position,
            )
            .sort(
                /**
                 * @param {{ position: number }} first
                 * @param {{ position: number }} second
                 * @return {number}
                 */
                (first, second) => first.position - second.position,
            );
        const transcript = ScribeIntake.transcript(earlier);
        const since = Array.from(transcript).length > settings.UnreadCharacters ? null : transcript;
        const pairs = [];
        for (const speaker of since === null ? [] : ScribePedant.speakers(state, player, message)) {
            for (const fact of facts) {
                const secret = ScribePedant.veiled(fact) && !fact.made;
                if (secret && !ScribePedant.aware(state, speaker.id, fact)) {
                    pairs.push({ speaker, fact });
                }
            }
        }
        const ledger = facts.filter(
            /**
             * @param {object} fact
             * @return {boolean}
             */
            (fact) =>
                candidates.includes(fact) ||
                pairs.some(
                    /**
                     * @param {{ fact: object }} pair
                     * @return {boolean}
                     */
                    (pair) => pair.fact === fact,
                ),
        );
        return { ledger, candidates, pairs, since };
    },

    /**
     * @param {Map<string, string>} labels
     * @param {object} fact
     * @return {string}
     */
    target(labels, fact) {
        return fact.target === null ? fact.targetText : labels.get(fact.target);
    },

    /**
     * @param {object} state
     * @param {object} fact
     * @param {string} written
     * @return {boolean}
     */
    aimed(state, fact, written) {
        const key = ScribeText.normaliseName(written);
        const textual = fact.targetText !== null && ScribeText.normaliseName(fact.targetText) === key;
        const found = ScribePedant.find(state, written);
        return textual || (found !== null && found.id === fact.target);
    },

    /**
     * @param {string} place
     * @param {string} sought
     * @return {boolean}
     */
    holds(place, sought) {
        const settings = ScribePedant.Settings;
        let start = place.indexOf(sought);
        while (start !== settings.NotFound) {
            const end = start + sought.length;
            const before = place.slice(Math.max(0, start - settings.EdgeWidth), start);
            const after = place.slice(end, end + settings.EdgeWidth);
            if (!settings.WordBefore.test(before) && !settings.WordAfter.test(after)) {
                return true;
            }
            const next = place.indexOf(sought, start + 1);
            start = next > start ? next : settings.NotFound;
        }
        return false;
    },

    /**
     * @param {string} first
     * @param {string} second
     * @return {boolean}
     */
    sameLabel(first, second) {
        const form = ScribePedant.Settings.NormalForm;
        return first.normalize(form) === second.normalize(form);
    },

    /**
     * @param {readonly string[]} outer
     * @param {readonly string[]} inner
     * @return {boolean}
     */
    contains(outer, inner) {
        for (let start = 0; start + inner.length <= outer.length; start++) {
            const matched = inner.every(
                /**
                 * @param {string} word
                 * @param {number} index
                 * @return {boolean}
                 */
                (word, index) => outer[start + index] === word,
            );
            if (matched) {
                return true;
            }
        }
        return false;
    },

    /**
     * @param {string} text
     * @param {readonly string[]} places
     * @return {string|null}
     */
    claimed(text, places) {
        const settings = ScribePedant.Settings;
        const spaced = text.replace(settings.Tab, settings.Space);
        if (settings.Forbidden.test(spaced)) {
            return null;
        }
        const words = ScribePedant.undress(spaced);
        const sought = ScribePedant.folded(words);
        const usable =
            ScribeAnswer.Settings.HasContent.test(words) &&
            Array.from(words).length <= settings.MostWords &&
            places.some(
                /**
                 * @param {string} place
                 * @return {boolean}
                 */
                (place) => ScribePedant.holds(place, sought),
            );
        return usable ? words : null;
    },

    /**
     * @param {object} state
     * @param {object} message
     * @return {readonly object[]}
     */
    spellings(state, message) {
        const settings = ScribePedant.Settings;
        const known = ScribePedant.names(state);
        const compared = [];
        for (const subject of state.subjects) {
            if (subject.mergedInto !== null) {
                continue;
            }
            for (const word of ScribePedant.openWords(state, subject)) {
                compared.push({ subject, word });
            }
        }
        const seen = new Set();
        const findings = [];
        for (const [found] of message.text.matchAll(settings.Word)) {
            const written = found.replace(settings.Possessive, settings.Nothing);
            const normal = ScribeText.normaliseName(written);
            const stem = normal.replace(settings.Plural, settings.Nothing);
            if (!settings.Capital.test(written) || known.has(normal) || known.has(stem)) {
                continue;
            }
            for (const { subject, word } of compared) {
                const key = JSON.stringify([normal, subject.id]);
                if (!seen.has(key) && ScribeText.resembles(written, word)) {
                    seen.add(key);
                    findings.push(
                        ScribePedant.finding(message, {
                            kind: ScribePedant.Kind.Spelling,
                            subject: subject.id,
                            label: subject.label,
                            written,
                        }),
                    );
                }
            }
        }
        return Object.freeze(findings);
    },

    /**
     * @param {object} state
     * @param {string} player
     * @param {object} message
     * @param {readonly object[]} unread
     * @return {string}
     */
    input(state, player, message, unread) {
        const settings = ScribePedant.Settings;
        const headings = settings.Headings;
        const labels = ScribeAnalyzer.labels(state);
        const survey = ScribePedant.survey(state, player, message, unread);
        const ledger = survey.ledger.map(
            /**
             * @param {object} fact
             * @return {string}
             */
            (fact) => {
                const category =
                    fact.category === ScribeCategory.Settings.RelationCategory
                        ? settings.RelationTo + ScribePedant.target(labels, fact)
                        : fact.category;
                return (
                    [fact.id, labels.get(fact.subject), category, fact.text].join(settings.Joiner) +
                    (ScribePedant.veiled(fact) ? settings.Hidden : settings.Nothing)
                );
            },
        );
        const unknown = survey.pairs.map(
            /**
             * @param {{ speaker: object, fact: object }} pair
             * @return {string}
             */
            (pair) => pair.speaker.label + settings.DoesNotKnow + pair.fact.id,
        );
        let since = [];
        if (survey.since === null) {
            since = [settings.TooLong];
        } else if (survey.since !== settings.Nothing) {
            since = [survey.since];
        }
        const reply = settings.ReplyOpen + message.position + settings.ReplyClose;
        return [
            ScribeAnalyzer.section(headings.Player, [player]),
            ScribeAnalyzer.section(headings.Ledger, ledger),
            ScribeAnalyzer.section(headings.Unknown, unknown),
            ScribeAnalyzer.section(headings.Since, since),
            ScribeAnalyzer.section(reply, [ScribeIntake.transcript([message])]),
        ].join(settings.BlankLine);
    },

    /**
     * @param {string} text
     * @return {Readonly<{ contradictions: readonly object[], leaks: readonly object[] }>}
     */
    parse(text) {
        const settings = ScribePedant.Settings;
        const answer = ScribeAnswer.Settings;
        const blocks = ScribePedant.Block;
        const contradictions = [];
        const leaks = [];
        let block = null;
        for (const raw of typeof text === 'string' ? text.split(answer.LineBreak) : []) {
            const line = raw
                .replace(answer.FormatCharacter, settings.Nothing)
                .trim()
                .replace(answer.ListMarkers, settings.Nothing)
                .replace(answer.Bold, answer.BoldInner)
                .replace(answer.ListMarkers, settings.Nothing)
                .trim();
            const letters = line.replace(settings.NonLetters, settings.Nothing).toUpperCase();
            if (Object.values(blocks).includes(letters)) {
                block = letters;
                continue;
            }
            if (
                block === null ||
                line === settings.Nothing ||
                answer.Fence.test(line) ||
                settings.NoneLine.test(line)
            ) {
                continue;
            }
            const fields = line
                .replace(settings.TableEdges, settings.Nothing)
                .split(settings.Pipe)
                .map(
                    /**
                     * @param {string} field
                     * @return {string}
                     */
                    (field) => field.trim(),
                );
            const number = fields[settings.FactField]
                .replace(settings.IdDress, settings.Nothing)
                .trim()
                .match(settings.FactNumber);
            if (number === null) {
                continue;
            }
            const fact = ScribeLog.Settings.FactPrefix + number[settings.NumberGroup];
            if (block === blocks.Contradictions && fields.length >= settings.ContradictionFields) {
                contradictions.push(
                    Object.freeze({
                        fact,
                        label: fields[settings.LabelField],
                        category: fields[settings.CategoryField],
                        said: fields.slice(settings.SaidStart).join(settings.Joiner),
                    }),
                );
            } else if (block === blocks.Leaks && fields.length >= settings.LeakFields) {
                leaks.push(
                    Object.freeze({
                        fact,
                        speaker: fields[settings.SpeakerField],
                        words: fields.slice(settings.WordsStart).join(settings.Joiner),
                    }),
                );
            }
        }
        return Object.freeze({ contradictions: Object.freeze(contradictions), leaks: Object.freeze(leaks) });
    },

    /**
     * @param {object} state
     * @param {string} player
     * @param {object} message
     * @param {{ contradictions: readonly object[], leaks: readonly object[] }} parsed
     * @param {readonly object[]} unread
     * @return {readonly object[]}
     */
    confirm(state, player, message, parsed, unread) {
        const settings = ScribePedant.Settings;
        const kinds = ScribePedant.Kind;
        const survey = ScribePedant.survey(state, player, message, unread);
        const blocks = message.blocks.map(
            /**
             * @param {{ text: string }} block
             * @return {string}
             */
            (block) => ScribePedant.folded(block.text),
        );
        const found = [];
        for (const claim of parsed.contradictions) {
            const fact = survey.candidates.find(
                /**
                 * @param {{ id: string }} candidate
                 * @return {boolean}
                 */
                (candidate) => candidate.id === claim.fact,
            );
            const said = ScribePedant.claimed(claim.said, blocks);
            if (fact === undefined || said === null) {
                continue;
            }
            const owner = ScribeLog.lookup(state.subjects, fact.subject);
            const written = ScribeText.normaliseName(ScribePedant.undress(claim.label));
            const named = [owner.label, owner.name, ...owner.aka].some(
                /**
                 * @param {string} name
                 * @return {boolean}
                 */
                (name) => ScribeText.normaliseName(name) === written,
            );
            const category = ScribeCategory.parse(ScribePedant.undress(claim.category));
            const relation = fact.category === ScribeCategory.Settings.RelationCategory;
            const fits =
                category !== null &&
                category.category === fact.category &&
                (!relation || ScribePedant.aimed(state, fact, category.target));
            const saidWords = ScribeText.words(said);
            const thinner = ScribePedant.wordings(state, fact).some(
                /**
                 * @param {{ text: string }} wording
                 * @return {boolean}
                 */
                (wording) => ScribePedant.contains(ScribeText.words(wording.text), saidWords),
            );
            if (named && fits && !thinner) {
                found.push(
                    ScribePedant.finding(message, {
                        kind: kinds.Contradiction,
                        subject: owner.id,
                        label: owner.label,
                        fact: fact.id,
                        category: fact.category,
                        book: fact.text,
                        said,
                    }),
                );
            }
        }
        for (const claim of parsed.leaks) {
            const speaker = ScribePedant.find(state, ScribePedant.undress(claim.speaker));
            const pair = survey.pairs.find(
                /**
                 * @param {{ speaker: object, fact: object }} candidate
                 * @return {boolean}
                 */
                (candidate) => candidate.speaker === speaker && candidate.fact.id === claim.fact,
            );
            if (pair === undefined) {
                continue;
            }
            const own = [];
            for (const block of message.blocks) {
                const spoken = block.role === ScribeIntake.Role.Character;
                if (spoken && ScribePedant.find(state, block.speaker) === speaker) {
                    own.push(ScribePedant.folded(block.text));
                }
            }
            const words = ScribePedant.claimed(claim.words, own);
            if (words !== null) {
                const owner = ScribeLog.lookup(state.subjects, pair.fact.subject);
                found.push(
                    ScribePedant.finding(message, {
                        kind: kinds.Leak,
                        subject: owner.id,
                        label: owner.label,
                        fact: pair.fact.id,
                        category: pair.fact.category,
                        book: pair.fact.text,
                        said: words,
                        speaker: speaker.id,
                        speakerLabel: speaker.label,
                    }),
                );
            }
        }
        const counts = new Map();
        const totals = new Map();
        const kept = [];
        for (const candidate of found) {
            const leaked = candidate.kind === kinds.Leak;
            const slot = JSON.stringify(leaked ? [candidate.fact, candidate.speaker] : [candidate.fact]);
            const count = counts.get(slot) ?? 0;
            const total = totals.get(candidate.kind) ?? 0;
            if (count < settings.FindingsPerFact && total < settings.FindingsPerKind) {
                kept.push(candidate);
                totals.set(candidate.kind, total + 1);
            }
            counts.set(slot, count + 1);
        }
        return Object.freeze(kept);
    },

    /**
     * @param {{ state: object, player: string, message: object, unread: readonly object[], ask: function(string, string): Promise<{ text: string }> }} request
     * @return {Promise<readonly object[]>}
     */
    async review({ state, player, message, unread, ask }) {
        if (message.fromPlayer) {
            return Object.freeze([]);
        }
        const spellings = ScribePedant.spellings(state, message);
        if (ScribePedant.survey(state, player, message, unread).ledger.length === 0) {
            return spellings;
        }
        const input = ScribePedant.input(state, player, message, unread);
        let text = null;
        try {
            text = (await ask(ScribePedant.Prompt, input)).text;
        } catch {
            return spellings;
        }
        const confirmed = ScribePedant.confirm(state, player, message, ScribePedant.parse(text), unread);
        return Object.freeze([...spellings, ...confirmed]);
    },

    /**
     * @param {object} finding
     * @return {string}
     */
    key(finding) {
        return JSON.stringify([finding.kind, ...ScribePedant.Keys[finding.kind](finding)]);
    },

    /**
     * @param {object} state
     * @param {object} finding
     * @return {boolean}
     */
    spent(state, finding) {
        const kinds = ScribePedant.Kind;
        if (finding.kind === kinds.Spelling) {
            const subject = ScribeLog.lookup(state.subjects, finding.subject);
            return (
                subject === undefined ||
                subject.mergedInto !== null ||
                !ScribePedant.sameLabel(subject.label, finding.label) ||
                ScribePedant.names(state).has(ScribeText.normaliseName(finding.written))
            );
        }
        const fact = ScribeLog.lookup(state.facts, finding.fact);
        const owner = fact === undefined ? undefined : ScribeLog.lookup(state.subjects, fact.subject);
        const standing =
            owner !== undefined &&
            fact.category === finding.category &&
            ScribeCategory.same(fact.text, finding.book) &&
            fact.status === ScribeReplay.Status.InForce &&
            !ScribePedant.contested(state).has(fact.id) &&
            fact.subject === ScribeKnowledge.survivor(state, finding.subject) &&
            ScribePedant.sameLabel(owner.label, finding.label);
        if (!standing || finding.kind === kinds.Contradiction) {
            return !standing;
        }
        const speaker = ScribeLog.lookup(state.subjects, finding.speaker);
        return (
            speaker === undefined ||
            speaker.mergedInto !== null ||
            !ScribePedant.sameLabel(speaker.label, finding.speakerLabel) ||
            !ScribePedant.veiled(fact) ||
            ScribePedant.aware(state, speaker.id, fact)
        );
    },

    /**
     * @param {object} state
     * @param {object} finding
     * @return {Readonly<{ type: string, fact: string, to: readonly string[] }>|null}
     */
    told(state, finding) {
        if (finding.kind !== ScribePedant.Kind.Leak || ScribePedant.spent(state, finding)) {
            return null;
        }
        const fact = ScribeLog.lookup(state.facts, finding.fact);
        if (fact.made) {
            return null;
        }
        const to = fact.widened === null ? [] : [...fact.widened];
        if (!to.includes(finding.speaker)) {
            to.push(finding.speaker);
        }
        return Object.freeze({ type: ScribeLog.Ruling.Widen, fact: fact.id, to: Object.freeze(to) });
    },
});
/** @file scribe/page/ScribeMuse.js */
const ScribeMuse = Object.freeze({
    Settings: Object.freeze({
        LineBytes: 300,
        Recent: 10,
        WordsLimit: 2000,
        LabelLimit: 60,
        TextLimit: 200,
        FirstEntry: 0,
        NoSceneBefore: 0,
        ContentGroup: 1,
        LabelReach: 40,
        OneMarked: 1,
        Nothing: '',
        Space: ' ',
        Newline: '\n',
        BlankLine: '\n\n',
        Comma: ', ',
        Colon: ': ',
        Marker: '@',
        ScribeStart: '[scribe',
        Joiner: ' | ',
        Day: 'Day ',
        Present: 'present: ',
        Nobody: 'nobody',
        Unknown: '(unknown)',
        Toward: ' toward ',
        Cut: '...',
        NewSubject: 'New ',
        AnotherName: 'Another name for ',
        NoLongerName: 'No longer a name for ',
        BecomesA: 'Becomes a ',
        Renamed: 'Renamed: ',
        IsNow: ' is now ',
        Leaves: 'Leaves the book: ',
        SubjectElse: 'Something else changes: ',
        HiddenMark: 'Hidden',
        NotHiddenMark: 'Not hidden',
        NewFact: ', new',
        NewNotInForce: ', new but not in force (',
        NotInForceClose: ')',
        FactEnd: ': ',
        RemovedFact: ', removed: ',
        WasStatus: ', was ',
        BecomesStatus: ', becomes ',
        HiddenToOpen: 'Was hidden, becomes not hidden: ',
        OpenToHidden: 'Was not hidden, becomes hidden: ',
        WhoKnows: ', who knows it changes: ',
        FactAlso: ', also changes (',
        FactAlsoClose: '): ',
        AliasMember: 'aliases',
        NameKey: '|',
        Conflict: 'A conflict for you to rule: ',
        Settled: 'A conflict would be settled: ',
        ConflictChanges: 'A conflict changes: ',
        OpenThread: 'Open thread: ',
        ClosedNew: 'New thread, already closed: ',
        ThreadClosed: 'Thread closed: ',
        ThreadReopened: 'Thread reopened: ',
        ThreadChanges: 'Thread changes: ',
        ThreadRemoved: 'Thread removed: ',
        LookAlike: 'A look-alike for you to rule: ',
        And: ' and ',
        BookElse: 'Something else in the book would change: ',
        NothingChanges: 'Nothing in the book would change.',
        Covered: Object.freeze(['revision', 'subjects', 'facts', 'threads', 'conflicts', 'lookAlikes']),
        SubjectCovered: Object.freeze(['id', 'kind', 'label', 'aka']),
        FactCovered: Object.freeze(['id', 'status', 'hidden', 'told', 'widened']),
        FactLinks: Object.freeze(['replacedBy', 'ended']),
        MapTag: '[object Map]',
        SetTag: '[object Set]',
        Headings: Object.freeze({
            Scene: 'SCENE:',
            Thread: 'THREAD:',
            Recent: 'RECENT MESSAGES:',
        }),
        Reasons: Object.freeze({
            NotFromANote: 'NotFromANote',
            WrongPosition: 'WrongPosition',
        }),
        Brackets: Object.freeze(['()', '[]']),
        NormalForm: 'NFKC',
        Quote: '"',
        Apostrophe: "'",
        ReasonGiven: ', reason given for the end: ',
        PinnedMark: ', pinned',
        LookSettled: 'A look-alike would be settled: ',
        LookChanges: 'A look-alike changes: ',
        EndedStatus: 'Ended',

        /**
         * @return {RegExp}
         */
        get LineBreak() {
            return /\r\n|(?!\t)[\p{Cc}\p{Zl}\p{Zp}]/u;
        },

        /**
         * @return {RegExp}
         */
        get Controls() {
            return /[\p{Cc}\p{Zl}\p{Zp}]/gu;
        },

        /**
         * @return {RegExp}
         */
        get FormatCharacter() {
            return /\p{Cf}/gu;
        },

        /**
         * @return {RegExp}
         */
        get LeadingCitation() {
            return /^(?:\[#\d+\]\s*)+/;
        },

        /**
         * @return {RegExp}
         */
        get MarkedLine() {
            return /^[ >*_#`]*LINE:\s*(.*)$/;
        },

        /**
         * @return {RegExp}
         */
        get Ignorable() {
            return /[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu;
        },

        /**
         * @return {RegExp}
         */
        get DressStart() {
            return /^[*_`]+/;
        },

        /**
         * @return {RegExp}
         */
        get DressEnd() {
            return /[*_`]+$/;
        },

        /**
         * @return {RegExp}
         */
        get DressMarks() {
            return /[*_`]/g;
        },

        /**
         * @return {RegExp}
         */
        get QuoteMark() {
            return /^\p{Quotation_Mark}$/u;
        },

        /**
         * @return {RegExp}
         */
        get QuoteMarks() {
            return /(?!['’])\p{Quotation_Mark}/gu;
        },

        /**
         * @return {RegExp}
         */
        get Letters() {
            return /[\p{L}\p{N}]/u;
        },

        /**
         * @return {RegExp}
         */
        get LabelInside() {
            return /^(?:[^\s:]+ ){0,3}[^\s:]+ ?:(?!\d)/;
        },

        /**
         * @return {RegExp}
         */
        get NoneAnswer() {
            return /^none(?:[\p{P}\s]*$|[.,:;]| \p{Pd} )/iu;
        },

        /**
         * @return {RegExp}
         */
        get Refusal() {
            return /^(?:(?:i['’]m sorry|i am sorry|i can['’]t|i cannot|i won['’]t|as an ai)(?!\p{L})|(?:sorry|sure|certainly)[,.!]|here(?: is|['’]s) (?:a|the|your) (?:\S+ ){0,3}(?:line|suggestion|narrator|option|version)(?!\p{L}))/iu;
        },

        PromptLines: Object.freeze([
            'You help a storyteller keep an ongoing adult fiction roleplay moving. You do not continue the story yourself.',
            'You receive the SCENE as it stands, one open THREAD the story left hanging, and the RECENT MESSAGES.',
            'Write one narrator line, at most 40 words, that brings the THREAD back into this scene as a development the characters must react to: an arrival, a discovery, a message, a consequence. It must fit the scene and contradict nothing in the recent messages.',
            'Answer with exactly one line that begins with LINE: followed by the narrator line, all on that one line. No quotation marks around it, no label inside it, nothing before it and nothing after it.',
            'If the thread cannot fit this scene at all, answer with exactly: NONE',
        ]),

        /**
         * @return {readonly string[]}
         */
        get Filed() {
            const types = ScribeAnswer.Type;
            return [
                types.Subject,
                types.Alias,
                types.Fact,
                types.Change,
                types.Refine,
                types.End,
                types.ThreadOpen,
            ];
        },
    }),

    /**
     * @return {string}
     */
    get SuggestPrompt() {
        return ScribeMuse.Settings.PromptLines.join(ScribeMuse.Settings.Newline);
    },

    /**
     * @param {object} state
     * @param {{ present: ReadonlyArray<{ subject: string|null }> }|null} now
     * @param {readonly string[]} exclude
     * @return {object|null}
     */
    thread(state, now, exclude) {
        const settings = ScribeMuse.Settings;
        const open = state.threads.filter(
            /**
             * @param {{ id: string, closed: object|null }} thread
             * @return {boolean}
             */
            (thread) => thread.closed === null && !exclude.includes(thread.id),
        );
        if (open.length === 0) {
            return null;
        }
        if (now === null) {
            return open[settings.FirstEntry];
        }
        const worlds = new Set();
        for (const subject of state.subjects) {
            if (subject.kind === ScribeCategory.SubjectKinds.World) {
                worlds.add(subject.id);
            }
        }
        const present = new Set();
        for (const person of now.present) {
            if (person.subject !== null && !worlds.has(person.subject)) {
                present.add(person.subject);
            }
        }
        const near = open.find(
            /**
             * @param {{ text: string }} thread
             * @return {boolean}
             */
            (thread) =>
                ScribeAnalyzer.select(state, thread.text, settings.Nothing, settings.NoSceneBefore).some(
                    /**
                     * @param {string} id
                     * @return {boolean}
                     */
                    (id) => present.has(id),
                ),
        );
        return near === undefined ? open[settings.FirstEntry] : near;
    },

    /**
     * @param {{ day: number, place: string, reach: string, present: ReadonlyArray<{ label: string }>, summary: string }|null} now
     * @param {{ text: string }} thread
     * @param {readonly object[]} recent
     * @return {string}
     */
    suggestInput(now, thread, recent) {
        const settings = ScribeMuse.Settings;
        const headings = settings.Headings;
        let scene = settings.Unknown;
        if (now !== null) {
            const labels = now.present.map(
                /**
                 * @param {{ label: string }} person
                 * @return {string}
                 */
                (person) => ScribeIntake.collapse(person.label),
            );
            scene = [
                settings.Day + now.day,
                ScribeIntake.collapse(now.place),
                now.reach.toLowerCase(),
                settings.Present + (labels.length === 0 ? settings.Nobody : labels.join(settings.Comma)),
                ScribeIntake.collapse(now.summary),
            ].join(settings.Joiner);
        }
        return [
            headings.Scene + settings.Newline + scene,
            headings.Thread + settings.Newline + thread.text,
            headings.Recent + settings.Newline + ScribeIntake.transcript(recent.slice(-settings.Recent)),
        ].join(settings.BlankLine);
    },

    /**
     * @param {*} text
     * @return {string|null}
     */
    line(text) {
        const settings = ScribeMuse.Settings;
        if (typeof text !== 'string') {
            return null;
        }
        const lines = text.split(settings.LineBreak).map(
            /**
             * @param {string} raw
             * @return {string}
             */
            (raw) => raw.replace(settings.FormatCharacter, settings.Nothing).trim(),
        );
        const marked = [];
        for (const [index, candidate] of lines.entries()) {
            const found = candidate.match(settings.MarkedLine);
            if (found !== null) {
                marked.push({ index, content: found[settings.ContentGroup] });
            }
        }
        if (marked.length !== settings.OneMarked) {
            return null;
        }
        const following = lines[marked[settings.FirstEntry].index + 1];
        if (following !== undefined && following !== settings.Nothing) {
            return null;
        }
        let kept = marked[settings.FirstEntry].content
            .normalize(settings.NormalForm)
            .replace(settings.Ignorable, settings.Nothing);
        let changed = true;
        while (changed) {
            const before = kept;
            kept = kept
                .trim()
                .replace(settings.DressStart, settings.Nothing)
                .replace(settings.DressEnd, settings.Nothing)
                .trim();
            const points = Array.from(kept);
            const first = points[settings.FirstEntry];
            const last = points.at(-1);
            const inner = points.slice(1, -1).join(settings.Nothing);
            const wrapped =
                points.length >= 2 &&
                ((settings.QuoteMark.test(first) && settings.QuoteMark.test(last)) ||
                    settings.Brackets.some(
                        /**
                         * @param {string} pair
                         * @return {boolean}
                         */
                        (pair) => first === pair[0] && last === pair[1],
                    ));
            if (wrapped && !inner.includes(first) && !inner.includes(last)) {
                kept = inner.trim();
            }
            changed = kept !== before;
        }
        kept = ScribeIntake.collapse(kept);
        const label = kept.replace(settings.DressMarks, settings.Nothing).match(settings.LabelInside);
        const refused =
            !settings.Letters.test(kept) ||
            settings.NoneAnswer.test(kept) ||
            kept.toLowerCase().includes(settings.ScribeStart) ||
            kept.includes(settings.Marker) ||
            (label !== null && Array.from(label[settings.FirstEntry]).length <= settings.LabelReach) ||
            settings.Refusal.test(kept) ||
            ScribeText.bytes(kept) > settings.LineBytes;
        return refused ? null : kept;
    },

    /**
     * @param {{ state: object, now: object|null, recent: readonly object[], exclude: readonly string[], ask: function(string, string): Promise<{ text: string }> }} request
     * @return {Promise<Readonly<{ thread: string, text: string }>|null>}
     */
    async suggest({ state, now, recent, exclude, ask }) {
        const chosen = ScribeMuse.thread(state, now, exclude);
        if (chosen === null) {
            return null;
        }
        let answer;
        try {
            answer = (await ask(ScribeMuse.SuggestPrompt, ScribeMuse.suggestInput(now, chosen, recent))).text;
        } catch {
            answer = null;
        }
        const text = ScribeMuse.line(answer);
        return text === null ? null : Object.freeze({ thread: chosen.id, text });
    },

    /**
     * @param {{ state: object, player: string, words: string, anchor: { id: string, position: number }|null, ask: function(string, string): Promise<{ text: string }> }} request
     * @return {Promise<Readonly<{ operations: readonly object[], refused: readonly object[] }>|null>}
     */
    async tell({ state, player, words, anchor, ask }) {
        const settings = ScribeMuse.Settings;
        const note = Array.from(
            ScribeIntake.collapse(
                words
                    .replace(settings.FormatCharacter, settings.Nothing)
                    .replace(settings.Controls, settings.Space)
                    .trim()
                    .replace(settings.LeadingCitation, settings.Nothing),
            ),
        )
            .slice(settings.FirstEntry, settings.WordsLimit)
            .join(settings.Nothing)
            .trim();
        if (note === settings.Nothing || anchor === null) {
            return null;
        }
        let answer;
        try {
            const notes = [{ text: note, position: anchor.position }];
            answer = (await ask(ScribeAnalyzer.NotesPrompt, ScribeAnalyzer.notesInput(state, player, notes))).text;
        } catch {
            answer = null;
        }
        const parsed = ScribeAnswer.parse(typeof answer === 'string' ? answer : settings.Nothing);
        const operations = [];
        const refused = [...parsed.refused];
        for (const operation of parsed.operations) {
            if (!settings.Filed.includes(operation.type)) {
                refused.push(Object.freeze({ operation, reason: settings.Reasons.NotFromANote }));
            } else if (operation.type !== ScribeAnswer.Type.Subject && operation.position !== anchor.position) {
                refused.push(Object.freeze({ operation, reason: settings.Reasons.WrongPosition }));
            } else {
                operations.push(operation);
            }
        }
        return Object.freeze({ operations: Object.freeze(operations), refused: Object.freeze(refused) });
    },

    /**
     * @param {*} text
     * @param {number} limit
     * @return {string}
     */
    clean(text, limit) {
        const settings = ScribeMuse.Settings;
        const flat = ScribeIntake.collapse(
            String(text).replace(settings.Controls, settings.Space).replace(settings.FormatCharacter, settings.Nothing),
        );
        const points = Array.from(flat);
        if (points.length <= limit) {
            return flat;
        }
        return points.slice(settings.FirstEntry, limit - settings.Cut.length).join(settings.Nothing) + settings.Cut;
    },

    /**
     * @param {ReadonlyMap<string, string>} labels
     * @param {object} fact
     * @return {string}
     */
    describeFact(labels, fact) {
        const settings = ScribeMuse.Settings;
        const label = ScribeMuse.quote(labels.get(fact.subject), settings.LabelLimit);
        const text = settings.Colon + ScribeMuse.quote(fact.text, settings.TextLimit);
        if (fact.category !== ScribeCategory.Settings.RelationCategory) {
            return label + settings.Comma + ScribeMuse.clean(fact.category, settings.LabelLimit) + text;
        }
        const target = fact.target === null ? fact.targetText : labels.get(fact.target);
        return label + settings.Toward + ScribeMuse.quote(target, settings.LabelLimit) + text;
    },

    /**
     * @param {*} text
     * @param {number} limit
     * @return {string}
     */
    quote(text, limit) {
        const settings = ScribeMuse.Settings;
        const inside = ScribeMuse.clean(text, limit).replace(settings.QuoteMarks, settings.Apostrophe);
        return settings.Quote + inside + settings.Quote;
    },

    /**
     * @param {object} entry
     * @param {readonly string[]} omitted
     * @return {string}
     */
    serial(entry, omitted) {
        const settings = ScribeMuse.Settings;
        const kept = {};
        for (const key of Object.keys(entry)) {
            if (!omitted.includes(key)) {
                kept[key] = entry[key];
            }
        }
        return JSON.stringify(
            kept,
            /**
             * @param {string} key
             * @param {*} value
             * @return {*}
             */
            (key, value) => {
                const tag = Object.prototype.toString.call(value);
                if (tag === settings.MapTag || tag === settings.SetTag) {
                    return Array.from(
                        value,
                        /**
                         * @param {*} item
                         * @return {string}
                         */
                        (item) => JSON.stringify(item),
                    ).sort();
                }
                return value;
            },
        );
    },

    /**
     * @param {object} before
     * @param {object} after
     * @return {readonly string[]}
     */
    changes(before, after) {
        const settings = ScribeMuse.Settings;
        const status = ScribeReplay.Status;
        const lines = [];
        const labelOf = new Map();
        const subjects = new Map();
        const facts = new Map();
        const threads = new Map();
        const conflicts = new Map();
        for (const subject of before.subjects) {
            subjects.set(subject.id, subject);
            labelOf.set(subject.id, subject.label);
        }
        for (const subject of after.subjects) {
            labelOf.set(subject.id, subject.label);
        }
        const kept = new Map();
        for (const subject of after.subjects) {
            kept.set(subject.id, subject);
        }
        for (const fact of before.facts) {
            facts.set(fact.id, fact);
        }
        const finals = new Map();
        for (const fact of after.facts) {
            finals.set(fact.id, fact);
        }
        for (const thread of before.threads) {
            threads.set(thread.id, thread);
        }
        /**
         * @param {{ subject: string, category: string }} conflict
         * @return {string}
         */
        const conflictKey = (conflict) => JSON.stringify([conflict.subject, conflict.category]);
        for (const conflict of before.conflicts) {
            conflicts.set(conflictKey(conflict), conflict);
        }
        /**
         * @param {string} text
         * @return {string}
         */
        const label = (text) => ScribeMuse.clean(text, settings.LabelLimit);
        /**
         * @param {string} text
         * @return {string}
         */
        const book = (text) => ScribeMuse.quote(text, settings.LabelLimit);
        /**
         * @param {{ hidden: boolean }} fact
         * @return {string}
         */
        const mark = (fact) => (fact.hidden ? settings.HiddenMark : settings.NotHiddenMark);
        const named = new Set();
        /**
         * @param {string} subject
         * @param {string} name
         * @return {string}
         */
        const nameKey = (subject, name) => subject + settings.NameKey + ScribeText.normaliseName(name);
        for (const subject of after.subjects) {
            if (!subjects.has(subject.id)) {
                lines.push(settings.NewSubject + label(subject.kind) + settings.Colon + book(subject.label));
                const own = [ScribeText.normaliseName(subject.label), ScribeText.normaliseName(subject.name)];
                for (const name of subject.aka) {
                    if (!own.includes(ScribeText.normaliseName(name))) {
                        named.add(nameKey(subject.id, name));
                        lines.push(settings.AnotherName + book(subject.label) + settings.Colon + book(name));
                    }
                }
            }
        }
        for (const subject of after.subjects) {
            const earlier = subjects.get(subject.id);
            if (earlier !== undefined && earlier.kind !== subject.kind) {
                lines.push(settings.BecomesA + label(subject.kind) + settings.Colon + book(subject.label));
            }
        }
        for (const subject of after.subjects) {
            const earlier = subjects.get(subject.id);
            if (earlier !== undefined && earlier.label !== subject.label) {
                lines.push(settings.Renamed + book(earlier.label) + settings.IsNow + book(subject.label));
            }
        }
        for (const subject of after.subjects) {
            const earlier = subjects.get(subject.id);
            if (earlier === undefined) {
                continue;
            }
            for (const name of subject.aka) {
                if (!earlier.aka.includes(name)) {
                    named.add(nameKey(subject.id, name));
                    lines.push(settings.AnotherName + book(subject.label) + settings.Colon + book(name));
                }
            }
            for (const name of earlier.aka) {
                if (!subject.aka.includes(name)) {
                    named.add(nameKey(subject.id, name));
                    lines.push(settings.NoLongerName + book(subject.label) + settings.Colon + book(name));
                }
            }
        }
        for (const subject of before.subjects) {
            if (!kept.has(subject.id)) {
                lines.push(settings.Leaves + book(subject.label));
            }
        }
        for (const subject of after.subjects) {
            const earlier = subjects.get(subject.id);
            const differs =
                earlier !== undefined &&
                ScribeMuse.serial(earlier, settings.SubjectCovered) !== ScribeMuse.serial(subject, settings.SubjectCovered);
            if (differs) {
                lines.push(settings.SubjectElse + book(subject.label));
            }
        }
        for (const fact of after.facts) {
            if (facts.has(fact.id)) {
                continue;
            }
            const said = settings.FactEnd + ScribeMuse.describeFact(labelOf, fact);
            const pinned = fact.made || fact.pinned ? settings.PinnedMark : settings.Nothing;
            lines.push(
                fact.status === status.InForce
                    ? mark(fact) + settings.NewFact + pinned + said
                    : mark(fact) +
                          settings.NewNotInForce +
                          label(fact.status) +
                          settings.NotInForceClose +
                          pinned +
                          said,
            );
        }
        for (const fact of before.facts) {
            if (!finals.has(fact.id)) {
                lines.push(mark(fact) + settings.RemovedFact + ScribeMuse.describeFact(labelOf, fact));
            }
        }
        for (const fact of after.facts) {
            const earlier = facts.get(fact.id);
            if (earlier !== undefined && earlier.status !== fact.status) {
                lines.push(
                    mark(fact) +
                        settings.WasStatus +
                        label(earlier.status) +
                        settings.BecomesStatus +
                        label(fact.status) +
                        settings.Colon +
                        ScribeMuse.describeFact(labelOf, fact),
                );
                const reason = fact.status === settings.EndedStatus && fact.ended ? fact.ended.reason : settings.Nothing;
                if (ScribeMuse.clean(reason, settings.TextLimit) !== settings.Nothing) {
                    lines.push(
                        mark(fact) +
                            settings.ReasonGiven +
                            ScribeMuse.describeFact(labelOf, fact) +
                            settings.Colon +
                            ScribeMuse.quote(reason, settings.TextLimit),
                    );
                }
            }
        }
        for (const fact of after.facts) {
            const earlier = facts.get(fact.id);
            if (earlier !== undefined && earlier.hidden !== fact.hidden) {
                lines.push(
                    (earlier.hidden ? settings.HiddenToOpen : settings.OpenToHidden) +
                        ScribeMuse.describeFact(labelOf, fact),
                );
            }
        }
        for (const fact of after.facts) {
            const earlier = facts.get(fact.id);
            const differs =
                earlier !== undefined &&
                JSON.stringify([earlier.told, earlier.widened]) !== JSON.stringify([fact.told, fact.widened]);
            if (differs) {
                lines.push(mark(fact) + settings.WhoKnows + ScribeMuse.describeFact(labelOf, fact));
            }
        }
        for (const fact of after.facts) {
            const earlier = facts.get(fact.id);
            if (earlier === undefined) {
                continue;
            }
            const omitted =
                earlier.status === fact.status ? settings.FactCovered : [...settings.FactCovered, ...settings.FactLinks];
            const members = Object.keys(fact).filter(
                /**
                 * @param {string} member
                 * @return {boolean}
                 */
                (member) =>
                    !omitted.includes(member) &&
                    ScribeMuse.serial({ member: earlier[member] }, []) !== ScribeMuse.serial({ member: fact[member] }, []),
            );
            if (members.length > 0) {
                lines.push(
                    mark(fact) +
                        settings.FactAlso +
                        members.join(settings.Comma) +
                        settings.FactAlsoClose +
                        ScribeMuse.describeFact(labelOf, fact),
                );
            }
        }
        const present = new Set();
        for (const conflict of after.conflicts) {
            present.add(conflictKey(conflict));
            const earlier = conflicts.get(conflictKey(conflict));
            const said = book(labelOf.get(conflict.subject)) + settings.Comma + label(conflict.category);
            if (earlier === undefined) {
                lines.push(settings.Conflict + said);
            } else if (ScribeMuse.serial(earlier, []) !== ScribeMuse.serial(conflict, [])) {
                lines.push(settings.ConflictChanges + said);
            }
        }
        for (const conflict of before.conflicts) {
            if (!present.has(conflictKey(conflict))) {
                lines.push(
                    settings.Settled + book(labelOf.get(conflict.subject)) + settings.Comma + label(conflict.category),
                );
            }
        }
        /**
         * @param {{ text: string }} thread
         * @return {string}
         */
        const text = (thread) => ScribeMuse.quote(thread.text, settings.TextLimit);
        const remaining = new Set();
        for (const thread of after.threads) {
            remaining.add(thread.id);
            const earlier = threads.get(thread.id);
            if (earlier === undefined) {
                lines.push((thread.closed === null ? settings.OpenThread : settings.ClosedNew) + text(thread));
            } else if (earlier.closed === null && thread.closed !== null) {
                lines.push(settings.ThreadClosed + text(thread));
            } else if (earlier.closed !== null && thread.closed === null) {
                lines.push(settings.ThreadReopened + text(thread));
            } else if (ScribeMuse.serial(earlier, []) !== ScribeMuse.serial(thread, [])) {
                lines.push(settings.ThreadChanges + text(thread));
            }
        }
        for (const thread of before.threads) {
            if (!remaining.has(thread.id)) {
                lines.push(settings.ThreadRemoved + text(thread));
            }
        }
        /**
         * @param {{ first: string, second: string }} pair
         * @return {string}
         */
        const pairKey = (pair) => JSON.stringify([pair.first, pair.second]);
        /**
         * @param {{ first: string, second: string }} pair
         * @return {string}
         */
        const pairText = (pair) => book(labelOf.get(pair.first)) + settings.And + book(labelOf.get(pair.second));
        const pairs = new Map();
        for (const pair of before.lookAlikes) {
            pairs.set(pairKey(pair), pair);
        }
        const standing = new Set();
        for (const pair of after.lookAlikes) {
            standing.add(pairKey(pair));
            const earlier = pairs.get(pairKey(pair));
            if (earlier === undefined) {
                lines.push(settings.LookAlike + pairText(pair));
            } else if (ScribeMuse.serial(earlier, []) !== ScribeMuse.serial(pair, [])) {
                lines.push(settings.LookChanges + pairText(pair));
            }
        }
        for (const pair of before.lookAlikes) {
            if (!standing.has(pairKey(pair))) {
                lines.push(settings.LookSettled + pairText(pair));
            }
        }
        for (const member of Object.keys(after)) {
            const same = ScribeMuse.serial({ member: before[member] }, []) === ScribeMuse.serial({ member: after[member] }, []);
            if (settings.Covered.includes(member) || same) {
                continue;
            }
            let said = false;
            if (member === settings.AliasMember) {
                const known = new Set();
                const final = new Set();
                for (const entry of before[member]) {
                    known.add(JSON.stringify(entry));
                }
                for (const entry of after[member]) {
                    final.add(JSON.stringify(entry));
                }
                const moved = [
                    ...after[member].filter(
                        /**
                         * @param {object} entry
                         * @return {boolean}
                         */
                        (entry) => !known.has(JSON.stringify(entry)),
                    ),
                    ...before[member].filter(
                        /**
                         * @param {object} entry
                         * @return {boolean}
                         */
                        (entry) => !final.has(JSON.stringify(entry)),
                    ),
                ];
                said = moved.every(
                    /**
                     * @param {{ subject: string, name: string }} entry
                     * @return {boolean}
                     */
                    (entry) => named.has(nameKey(entry.subject, entry.name)),
                );
            }
            if (!said) {
                lines.push(settings.BookElse + label(member));
            }
        }
        return Object.freeze(lines.length === 0 ? [settings.NothingChanges] : lines);
    },
});
/** @file scribe/page/ScribeLive.js */
const ScribeLive = Object.freeze({
    Status: Object.freeze({
        Open: 'Open',
        Dismissed: 'Dismissed',
        Accepted: 'Accepted',
        Told: 'Told',
        Reminded: 'Reminded',
    }),

    Settings: Object.freeze({
        MessageBytes: 4500,
        Recent: 20,
        FindingsKept: 200,
        DismissedKept: 500,
        CheckedKept: 8,
        AnswersKept: 16,
        FirstMost: 5,
        FirstFinding: 0,
        FirstEpoch: 0,
        FirstDay: 1,
        NoSends: 0,
        OneSend: 1,
        NoCount: 0,
        Last: -1,
        Nothing: '',
        StoppedPhase: 'Stopped',
        DoneStop: 'Done',
        ObjectType: 'object',
        StringType: 'string',
        BooleanType: 'boolean',
        Roles: Object.freeze({
            Scribe: 'Scribe',
            Pedant: 'Pedant',
            Analyzer: 'Analyzer',
        }),
        Needs: Object.freeze({
            Spelling: Object.freeze(['subject', 'label', 'written']),
            Contradiction: Object.freeze(['subject', 'label', 'fact', 'category', 'book', 'said']),
            Leak: Object.freeze(['subject', 'label', 'fact', 'category', 'book', 'speaker', 'speakerLabel']),
        }),
        SceneTexts: Object.freeze(['message', 'place', 'reach', 'summary']),
        Messages: Object.freeze({
            Watching: 'Another tab is reading this chat',
            Unread: 'The saved live part of this chat could not be read; it is tried again',
            Untrusted: 'The book of this chat cannot be trusted right now',
            Stopped: 'The keeper is stopped',
            Busy: 'The last request of this kind has not finished yet',
            Budget: "The day's budget is spent: replies are not checked and no new reminder is made until tomorrow.",
        }),
        NothingAppended: Object.freeze({
            ready: null,
            suggestion: null,
        }),
    }),

    /**
     * @param {*} error
     * @return {string}
     */
    words(error) {
        const settings = ScribeLive.Settings;
        const described =
            error !== null && typeof error === settings.ObjectType && typeof error.message === settings.StringType;
        return described ? error.message : String(error);
    },

    /**
     * @param {*} value
     * @return {boolean}
     */
    isObject(value) {
        return typeof value === ScribeLive.Settings.ObjectType && value !== null && !Array.isArray(value);
    },

    /**
     * @param {*} value
     * @return {boolean}
     */
    isText(value) {
        return typeof value === ScribeLive.Settings.StringType;
    },

    /**
     * @param {*} value
     * @return {boolean}
     */
    isTexts(value) {
        return Array.isArray(value) && value.every(ScribeLive.isText);
    },

    /**
     * @param {*} value
     * @return {object|null}
     */
    scene(value) {
        const settings = ScribeLive.Settings;
        if (!ScribeLive.isObject(value)) {
            return null;
        }
        const sound =
            settings.SceneTexts.every(
                /**
                 * @param {string} name
                 * @return {boolean}
                 */
                (name) => ScribeLive.isText(value[name]),
            ) &&
            value.place !== settings.Nothing &&
            Number.isSafeInteger(value.position) &&
            Number.isSafeInteger(value.day) &&
            value.day >= settings.FirstDay &&
            typeof value.changed === settings.BooleanType &&
            Array.isArray(value.present) &&
            value.present.every(
                /**
                 * @param {*} person
                 * @return {boolean}
                 */
                (person) =>
                    ScribeLive.isObject(person) &&
                    ScribeLive.isText(person.label) &&
                    (person.subject === null || ScribeLive.isText(person.subject)),
            );
        return sound ? value : null;
    },

    /**
     * @param {*} value
     * @return {object|null}
     */
    finding(value) {
        const settings = ScribeLive.Settings;
        const sound =
            ScribeLive.isObject(value) &&
            ScribeLive.isText(value.kind) &&
            Object.hasOwn(settings.Needs, value.kind) &&
            ScribeLive.isText(value.key) &&
            (value.fault === undefined || ScribeLive.isText(value.fault)) &&
            ScribeLive.isText(value.status) &&
            ScribeLive.isText(value.message) &&
            Number.isSafeInteger(value.position) &&
            (value.fingerprint === undefined || value.fingerprint === null || ScribeLive.isText(value.fingerprint)) &&
            settings.Needs[value.kind].every(
                /**
                 * @param {string} name
                 * @return {boolean}
                 */
                (name) => ScribeLive.isText(value[name]),
            );
        if (!sound) {
            return null;
        }
        const fault = value.fault === undefined ? value.key : value.fault;
        const kept = {
            ...value,
            fault,
            key: ScribeLive.identity(fault, value.message),
            fingerprint: ScribeLive.isText(value.fingerprint) ? value.fingerprint : null,
        };
        delete kept.correction;
        return kept;
    },

    /**
     * @param {string} fault
     * @param {string} message
     * @return {string}
     */
    identity(fault, message) {
        return JSON.stringify([fault, message]);
    },

    /**
     * @param {*} value
     * @return {object[]}
     */
    findings(value) {
        if (!Array.isArray(value)) {
            return [];
        }
        const kept = [];
        for (const item of value) {
            const finding = ScribeLive.finding(item);
            if (finding !== null) {
                kept.push(finding);
            }
        }
        return kept;
    },

    /**
     * @param {object[]} findings
     * @param {*} messages
     * @return {object[]}
     */
    pruned(findings, messages) {
        const settings = ScribeLive.Settings;
        if (!Array.isArray(messages) || messages.length === settings.NoCount) {
            return findings;
        }
        const prints = new Map(
            messages.map(
                /**
                 * @param {{ id: string, fingerprint: string }} item
                 * @return {Array<string>}
                 */
                (item) => [item.id, item.fingerprint],
            ),
        );
        const earliest = messages[settings.FirstFinding].position;
        return findings.filter(
            /**
             * @param {{ message: string, fingerprint: string|null, position: number }} finding
             * @return {boolean}
             */
            (finding) => {
                if (prints.has(finding.message)) {
                    return finding.fingerprint === null || prints.get(finding.message) === finding.fingerprint;
                }
                return finding.position < earliest;
            },
        );
    },

    /**
     * @param {readonly object[]} findings
     * @param {string[]} dismissed
     * @param {readonly object[]|null} raised
     * @param {object} message
     * @param {boolean} remembered
     * @return {{ findings: object[], contradicted: boolean }}
     */
    merged(findings, dismissed, raised, message, remembered) {
        const settings = ScribeLive.Settings;
        const statuses = ScribeLive.Status;
        if (raised === null) {
            return { findings: [...findings], contradicted: false };
        }
        const kept = new Set(
            findings.map(
                /**
                 * @param {{ key: string }} finding
                 * @return {string}
                 */
                (finding) => finding.key,
            ),
        );
        const added = [];
        let contradicted = false;
        for (const finding of raised) {
            const fault = ScribePedant.key(finding);
            const key = ScribeLive.identity(fault, message.id);
            const known = dismissed.includes(fault);
            if (!kept.has(key) && (!known || remembered)) {
                kept.add(key);
                added.push({
                    ...finding,
                    fault,
                    key,
                    fingerprint: message.fingerprint,
                    status: known ? statuses.Dismissed : statuses.Open,
                });
                contradicted = contradicted || (!known && finding.kind === ScribePedant.Kind.Contradiction);
            }
        }
        const all = [...added, ...findings];
        const youngest = [...all]
            .sort(
                /**
                 * @param {{ position: number }} first
                 * @param {{ position: number }} second
                 * @return {number}
                 */
                (first, second) => second.position - first.position,
            )
            .slice(settings.FirstFinding, settings.FindingsKept);
        return {
            findings: all.filter(
                /**
                 * @param {object} finding
                 * @return {boolean}
                 */
                (finding) => youngest.includes(finding),
            ),
            contradicted,
        };
    },

    /**
     * @param {object} live
     * @return {void}
     */
    load(live) {
        const settings = ScribeLive.Settings;
        live.record = {
            now: null,
            ready: null,
            led: [],
            basis: null,
            sends: settings.NoSends,
            findings: [],
            dismissed: [],
            suggestion: null,
            seen: null,
            reminded: null,
            edition: null,
            checked: [],
        };
        live.problem = null;
        let saved = null;
        try {
            saved = ScribeStore.read(live.storage, live.roomId, ScribeStore.Kind.Live);
        } catch (error) {
            live.problem = ScribeLive.words(error);
            live.loaded = ScribeLive.isObject(error) && error.damaged === true;
            return;
        }
        live.loaded = true;
        if (!ScribeLive.isObject(saved)) {
            return;
        }
        const record = live.record;
        record.now = ScribeLive.scene(saved.now);
        record.reminded = ScribeLive.scene(saved.reminded);
        record.ready = ScribeLive.isText(saved.ready) ? saved.ready : null;
        record.led = record.ready !== null && ScribeLive.isTexts(saved.led) ? [...saved.led] : [];
        const basis = saved.basis;
        const sound =
            ScribeLive.isObject(basis) && Number.isSafeInteger(basis.revision) && ScribeLive.isTexts(basis.first);
        record.basis = sound ? { revision: basis.revision, first: [...basis.first] } : null;
        record.sends = Number.isSafeInteger(saved.sends) && saved.sends >= settings.NoSends ? saved.sends : settings.NoSends;
        record.findings = ScribeLive.findings(saved.findings);
        const dismissed = ScribeLive.isTexts(saved.dismissed) ? [...saved.dismissed] : [];
        for (const finding of [...record.findings].reverse()) {
            if (finding.status === ScribeLive.Status.Dismissed && !dismissed.includes(finding.fault)) {
                dismissed.push(finding.fault);
            }
        }
        record.dismissed = dismissed.slice(-settings.DismissedKept);
        record.suggestion = ScribeLive.isText(saved.suggestion) ? saved.suggestion : null;
        const seen = saved.seen;
        if (
            ScribeLive.isObject(seen) &&
            ScribeLive.isText(seen.id) &&
            ScribeLive.isText(seen.fingerprint) &&
            Number.isSafeInteger(seen.position)
        ) {
            record.seen = {
                id: seen.id,
                fingerprint: seen.fingerprint,
                position: seen.position,
                before: ScribeLive.scene(seen.before),
            };
        }
        record.edition = Number.isSafeInteger(saved.edition) ? saved.edition : null;
        if (Array.isArray(saved.checked)) {
            for (const entry of saved.checked.slice(settings.FirstFinding, settings.CheckedKept)) {
                const usable =
                    ScribeLive.isObject(entry) &&
                    ScribeLive.isText(entry.id) &&
                    ScribeLive.isText(entry.fingerprint) &&
                    Number.isSafeInteger(entry.revision) &&
                    ScribeLive.scene(entry.now) !== null &&
                    Array.isArray(entry.findings) &&
                    ScribeLive.findings(entry.findings).length === entry.findings.length;
                if (usable) {
                    record.checked.push({
                        id: entry.id,
                        fingerprint: entry.fingerprint,
                        revision: entry.revision,
                        now: entry.now,
                        findings: ScribeLive.findings(entry.findings),
                    });
                }
            }
        }
    },

    /**
     * @param {object} live
     * @return {void}
     */
    announce(live) {
        live.shown = live.problem;
        try {
            live.notify();
        } catch (error) {
            live.problem = ScribeLive.words(error);
        }
    },

    /**
     * @param {object} live
     * @return {void}
     */
    heard(live) {
        if (!live.closed && live.problem !== live.shown) {
            ScribeLive.announce(live);
        }
    },

    /**
     * @param {object} live
     * @return {void}
     */
    save(live) {
        try {
            ScribeStore.write(live.storage, live.roomId, ScribeStore.Kind.Live, live.record);
        } catch (error) {
            live.problem = ScribeLive.words(error);
        }
    },

    /**
     * @param {object} live
     * @return {void}
     */
    changed(live) {
        ScribeLive.save(live);
        ScribeLive.announce(live);
    },

    /**
     * @param {object} live
     * @return {boolean}
     */
    active(live) {
        if (live.closed) {
            return false;
        }
        const view = live.keeper.view();
        if (!view.reader) {
            live.watching = true;
            return false;
        }
        if (live.watching || !live.loaded) {
            live.watching = false;
            live.epoch++;
            ScribeLive.load(live);
        }
        if (!live.loaded || view.trusted !== true) {
            return live.loaded;
        }
        const record = live.record;
        if (record.edition === null) {
            record.edition = view.edition;
            ScribeLive.save(live);
        } else if (view.edition > record.edition) {
            live.epoch++;
            record.findings = [];
            record.dismissed = [];
            record.now = null;
            record.reminded = null;
            record.ready = null;
            record.led = [];
            record.basis = null;
            record.seen = null;
            record.suggestion = null;
            record.checked = [];
            record.edition = view.edition;
            live.offer = null;
            live.excluded = [];
            live.understood = null;
            live.appended = ScribeLive.Settings.NothingAppended;
            live.answers = [];
            ScribeLive.changed(live);
        }
        try {
            const kept = ScribeLive.pruned(record.findings, view.messages);
            if (kept.length !== record.findings.length) {
                record.findings = kept;
                ScribeLive.save(live);
            }
        } catch (error) {
            live.problem = ScribeLive.words(error);
        }
        return true;
    },

    /**
     * @param {object} live
     * @return {string|null}
     */
    refusal(live) {
        const settings = ScribeLive.Settings;
        const messages = settings.Messages;
        const doubt = ScribeLive.distrust(live);
        if (doubt !== null) {
            return doubt;
        }
        const view = live.keeper.view();
        const stopped = ScribeLive.isObject(view.stop) && view.stop.reason !== settings.DoneStop;
        if (view.phase === settings.StoppedPhase || stopped) {
            return messages.Stopped;
        }
        const spent =
            Number.isFinite(view.spentToday) &&
            ScribeLive.isObject(view.settings) &&
            Number.isFinite(view.settings.budget) &&
            view.spentToday >= view.settings.budget;
        if (spent) {
            live.problem = messages.Budget;
            return messages.Budget;
        }
        if (live.problem === messages.Budget) {
            live.problem = null;
        }
        return null;
    },

    /**
     * @param {object} live
     * @param {number} epoch
     * @return {boolean}
     */
    current(live, epoch) {
        return ScribeLive.active(live) && live.epoch === epoch;
    },

    /**
     * @param {object} live
     * @param {string} role
     * @param {{ failure: string|null }} noted
     * @return {function(string, string): Promise<{ text: string, cost: * }>}
     */
    asker(live, role, noted) {
        /**
         * @param {string} system
         * @param {string} user
         * @return {Promise<{ text: string, cost: * }>}
         * @throws {Error}
         */
        const ask = async (system, user) => {
            const refused = ScribeLive.refusal(live);
            if (refused !== null) {
                throw new Error(refused);
            }
            try {
                return await live.ask(role, system, user);
            } catch (error) {
                noted.failure = ScribeLive.words(error);
                throw error;
            }
        };
        return ask;
    },

    /**
     * @param {object} live
     * @param {{ failure: string|null }} noted
     * @return {void}
     */
    report(live, noted) {
        if (noted.failure !== null) {
            live.problem = noted.failure;
        }
    },

    /**
     * @param {{ findings: object[] }} record
     * @param {string} key
     * @return {object|undefined}
     */
    find(record, key) {
        return record.findings.find(
            /**
             * @param {{ key: string }} finding
             * @return {boolean}
             */
            (finding) => finding.key === key,
        );
    },

    /**
     * @param {object} live
     * @param {Readonly<object>} view
     * @param {object} finding
     * @return {Readonly<{ told: boolean, spent: boolean }>}
     */
    can(live, view, finding) {
        if (live.cans.state !== view.state) {
            live.cans = { state: view.state, byKey: new Map() };
        }
        const known = live.cans.byKey.get(finding.key);
        if (known !== undefined) {
            return known;
        }
        const can = Object.freeze({
            told: ScribePedant.told(view.state, finding) !== null,
            spent: ScribePedant.spent(view.state, finding),
        });
        live.cans.byKey.set(finding.key, can);
        return can;
    },

    /**
     * @param {readonly object[]} findings
     * @param {object} state
     * @return {string[]}
     */
    first(findings, state) {
        const settings = ScribeLive.Settings;
        const first = [];
        for (const finding of findings) {
            const open =
                finding.kind === ScribePedant.Kind.Contradiction &&
                finding.status === ScribeLive.Status.Open &&
                !ScribePedant.spent(state, finding);
            if (open && !first.includes(finding.fact) && first.length < settings.FirstMost) {
                first.push(finding.fact);
            }
        }
        return first;
    },

    /**
     * @param {{ revision: number, first: string[] }|null} basis
     * @param {object|null} reminded
     * @param {object|null} now
     * @param {readonly object[]} findings
     * @param {object} state
     * @return {boolean}
     */
    holds(basis, reminded, now, findings, state) {
        if (basis === null || state.revision !== basis.revision || !ScribeScene.same(reminded, now)) {
            return false;
        }
        const first = ScribeLive.first(findings, state);
        return (
            first.length === basis.first.length &&
            first.every(
                /**
                 * @param {string} fact
                 * @param {number} index
                 * @return {boolean}
                 */
                (fact, index) => fact === basis.first[index],
            )
        );
    },

    /**
     * @param {object} live
     * @param {Readonly<object>} view
     * @return {boolean}
     */
    fresh(live, view) {
        const record = live.record;
        return (
            record.ready !== null &&
            ScribeLive.holds(record.basis, record.reminded, record.now, record.findings, view.state)
        );
    },

    /**
     * @param {object} live
     * @param {Readonly<object>} view
     * @param {object|null} now
     * @param {readonly object[]} findings
     * @param {{ failure: string|null }} noted
     * @return {Promise<{ composed: Readonly<{ text: string, led: readonly string[] }>|null, basis: { revision: number, first: string[] } }>}
     */
    async remind(live, view, now, findings, noted) {
        const settings = ScribeLive.Settings;
        const first = ScribeLive.first(findings, view.state);
        const basis = { revision: view.state.revision, first };
        const asked = ScribeLive.asker(live, settings.Roles.Scribe, noted);
        /**
         * @param {string} system
         * @param {string} user
         * @return {Promise<{ text: string, cost: * }>}
         * @throws {Error}
         */
        const ask = async (system, user) => {
            const request = JSON.stringify([system, user]);
            const known = live.answers.find(
                /**
                 * @param {{ request: string }} entry
                 * @return {boolean}
                 */
                (entry) => entry.request === request,
            );
            if (known !== undefined) {
                return known.answer;
            }
            const answer = await asked(system, user);
            live.answers = [
                ...live.answers.filter(
                    /**
                     * @param {{ request: string }} entry
                     * @return {boolean}
                     */
                    (entry) => entry.request !== request,
                ),
                { request, answer },
            ].slice(-settings.AnswersKept);
            return answer;
        };
        const composed = await ScribeReminder.compose({
            state: view.state,
            now,
            player: view.player,
            recent: view.messages.slice(-settings.Recent),
            unread: view.unread,
            ask,
            first: [...first],
        });
        return { composed, basis };
    },

    /**
     * @param {object} record
     * @param {{ composed: Readonly<{ text: string, led: readonly string[] }>|null, basis: { revision: number, first: string[] } }|null} made
     * @return {void}
     */
    keep(record, made) {
        if (made === null || made.composed === null) {
            record.ready = null;
            record.led = [];
            record.basis = null;
            return;
        }
        record.ready = made.composed.text;
        record.led = [...made.composed.led];
        record.basis = made.basis;
        record.reminded = record.now;
    },

    /**
     * @param {object} live
     * @param {object} message
     * @return {Promise<void>}
     */
    async consider(live, message) {
        const settings = ScribeLive.Settings;
        const roles = settings.Roles;
        const statuses = ScribeLive.Status;
        if (live.closed || message.fromPlayer || ScribeLive.refusal(live) !== null) {
            return;
        }
        const record = live.record;
        const view = live.keeper.view();
        const revision = view.state.revision;
        const seen = record.seen;
        if (seen !== null && seen.id === message.id && seen.fingerprint === message.fingerprint) {
            return;
        }
        const epoch = live.epoch;
        const earlier = live.problem;
        live.problem = null;
        const replaced = seen !== null && seen.position === message.position;
        const previous = replaced ? seen.before : record.now;
        const remembered = record.checked.find(
            /**
             * @param {{ id: string, fingerprint: string, revision: number }} entry
             * @return {boolean}
             */
            (entry) => entry.id === message.id && entry.fingerprint === message.fingerprint && entry.revision === revision,
        );
        record.seen = {
            id: message.id,
            fingerprint: message.fingerprint,
            position: message.position,
            before: previous,
        };
        let found = null;
        let raised = null;
        if (remembered === undefined) {
            const sceneNoted = { failure: null };
            try {
                found = await ScribeScene.now({
                    state: view.state,
                    player: view.player,
                    messages: view.messages,
                    previous,
                    ask: ScribeLive.asker(live, roles.Scribe, sceneNoted),
                });
            } catch (error) {
                live.problem = ScribeLive.words(error);
            }
            ScribeLive.report(live, sceneNoted);
            if (!ScribeLive.current(live, epoch)) {
                return;
            }
            const pedantNoted = { failure: null };
            try {
                raised = await ScribePedant.review({
                    state: view.state,
                    player: view.player,
                    message,
                    unread: view.unread,
                    ask: ScribeLive.asker(live, roles.Pedant, pedantNoted),
                });
            } catch (error) {
                live.problem = ScribeLive.words(error);
            }
            ScribeLive.report(live, pedantNoted);
            if (!ScribeLive.current(live, epoch)) {
                return;
            }
            if (ScribeLive.refusal(live) !== null) {
                record.seen = seen;
                if (ScribeLive.distrust(live) !== null) {
                    live.problem = earlier;
                }
                return;
            }
        } else {
            found = remembered.now;
            raised = remembered.findings;
        }
        const now = found === null ? previous : found;
        const draft = ScribeLive.merged(
            ScribeLive.pruned(record.findings, view.messages),
            record.dismissed,
            raised,
            message,
            remembered !== undefined,
        );
        let made = null;
        const remindNoted = { failure: null };
        try {
            const due =
                (found !== null && found.changed) ||
                draft.contradicted ||
                record.sends >= view.settings.refresh ||
                !ScribeScene.same(record.reminded, now) ||
                (record.ready !== null &&
                    !ScribeLive.holds(record.basis, record.reminded, now, draft.findings, view.state));
            if (due) {
                made = await ScribeLive.remind(live, view, now, draft.findings, remindNoted);
            }
        } catch (error) {
            live.problem = ScribeLive.words(error);
        }
        ScribeLive.report(live, remindNoted);
        if (!ScribeLive.current(live, epoch)) {
            return;
        }
        if (!ScribeLive.trusted(live)) {
            record.seen = seen;
            live.problem = earlier;
            return;
        }
        const latest = live.keeper.view();
        if (found !== null && !ScribeScene.same(previous, found)) {
            live.offer = null;
            live.excluded = [];
        }
        record.now = now;
        record.findings = ScribeLive.merged(
            ScribeLive.pruned(record.findings, latest.messages),
            record.dismissed,
            raised,
            message,
            remembered !== undefined,
        ).findings;
        if (remembered === undefined && found !== null && raised !== null) {
            const entry = {
                id: message.id,
                fingerprint: message.fingerprint,
                revision,
                now: found,
                findings: raised.map(
                    /**
                     * @param {object} finding
                     * @return {object}
                     */
                    (finding) => ({
                        ...finding,
                        fault: ScribePedant.key(finding),
                        key: ScribeLive.identity(ScribePedant.key(finding), message.id),
                        fingerprint: message.fingerprint,
                        status: statuses.Open,
                    }),
                ),
            };
            record.checked = [
                entry,
                ...record.checked.filter(
                    /**
                     * @param {{ id: string, fingerprint: string }} other
                     * @return {boolean}
                     */
                    (other) => other.id !== message.id || other.fingerprint !== message.fingerprint,
                ),
            ].slice(settings.FirstFinding, settings.CheckedKept);
        }
        const ready =
            made !== null &&
            made.composed !== null &&
            ScribeLive.holds(made.basis, now, record.now, record.findings, latest.state);
        if (ready) {
            ScribeLive.keep(record, made);
        }
        ScribeLive.changed(live);
    },

    /**
     * @param {object} live
     * @return {Promise<void>}
     */
    async refresh(live) {
        if (ScribeLive.refusal(live) !== null) {
            return;
        }
        const view = live.keeper.view();
        const record = live.record;
        if (record.ready === null || ScribeLive.fresh(live, view)) {
            return;
        }
        const epoch = live.epoch;
        const now = record.now;
        const noted = { failure: null };
        let made = null;
        try {
            made = await ScribeLive.remind(live, view, now, record.findings, noted);
        } catch (error) {
            live.problem = ScribeLive.words(error);
        }
        if (!ScribeLive.current(live, epoch) || !ScribeLive.trusted(live)) {
            return;
        }
        ScribeLive.report(live, noted);
        const latest = live.keeper.view();
        if (made === null || made.composed === null) {
            if (record.ready !== null && !ScribeLive.fresh(live, latest)) {
                ScribeLive.keep(record, null);
            }
        } else if (ScribeLive.holds(made.basis, now, record.now, record.findings, latest.state)) {
            ScribeLive.keep(record, made);
        }
        ScribeLive.changed(live);
    },

    /**
     * @param {object} live
     * @return {Promise<void>}
     */
    async drain(live) {
        while (!live.closed && (live.waiting !== null || live.refreshing)) {
            if (live.waiting !== null) {
                const next = live.waiting;
                live.waiting = null;
                try {
                    await ScribeLive.consider(live, next);
                } catch (error) {
                    live.problem = ScribeLive.words(error);
                }
            } else {
                live.refreshing = false;
                try {
                    await ScribeLive.refresh(live);
                } catch (error) {
                    live.problem = ScribeLive.words(error);
                }
            }
            ScribeLive.heard(live);
        }
        live.running = null;
    },

    /**
     * @param {object} live
     * @return {Promise<void>}
     */
    kick(live) {
        if (live.running === null) {
            live.running = ScribeLive.drain(live);
        }
        return live.running;
    },

    /**
     * @param {object} live
     * @param {object} message
     * @return {Promise<void>}
     */
    async reply(live, message) {
        if (live.closed) {
            return;
        }
        live.waiting = message;
        await ScribeLive.kick(live);
    },

    /**
     * @param {object} live
     * @param {string} text
     * @return {string}
     */
    outgoing(live, text) {
        const settings = ScribeLive.Settings;
        live.appended = settings.NothingAppended;
        ScribeLive.active(live);
        const offer = ScribeLive.lines(live);
        const made = ScribeSender.compose(text, offer, settings.MessageBytes);
        live.appended = Object.freeze({
            ready: made.ready ? offer.ready : null,
            suggestion: made.suggestion ? offer.suggestion : null,
        });
        return made.text;
    },

    /**
     * @param {object} live
     * @return {Readonly<{ ready: string|null, suggestion: string|null }>}
     */
    lines(live) {
        const nothing = ScribeLive.Settings.NothingAppended;
        if (live.closed || !live.loaded || live.watching) {
            return nothing;
        }
        const view = live.keeper.view();
        const record = live.record;
        const renewed = record.edition !== null && view.edition > record.edition;
        if (!view.reader || view.trusted !== true || renewed) {
            return nothing;
        }
        return Object.freeze({
            ready: ScribeLive.fresh(live, view) ? record.ready : null,
            suggestion: record.suggestion,
        });
    },

    /**
     * @param {object} live
     * @param {{ ready: string|null, suggestion: string|null }} lines
     * @return {void}
     */
    went(live, lines) {
        const settings = ScribeLive.Settings;
        if (!ScribeLive.active(live)) {
            return;
        }
        const record = live.record;
        const state = live.keeper.view().state;
        if (lines.ready !== null && record.ready === lines.ready) {
            const led = record.led;
            record.ready = null;
            record.led = [];
            record.basis = null;
            for (const finding of record.findings) {
                const reminded =
                    finding.kind === ScribePedant.Kind.Contradiction &&
                    finding.status === ScribeLive.Status.Open &&
                    led.includes(finding.fact) &&
                    !ScribePedant.spent(state, finding);
                if (reminded) {
                    finding.status = ScribeLive.Status.Reminded;
                }
            }
        }
        if (record.suggestion === lines.suggestion) {
            record.suggestion = null;
        }
        record.sends = lines.ready === null ? record.sends + settings.OneSend : settings.NoSends;
        ScribeLive.changed(live);
    },

    /**
     * @param {object} live
     * @return {void}
     */
    sent(live) {
        const went = live.appended;
        live.appended = ScribeLive.Settings.NothingAppended;
        ScribeLive.went(live, went);
    },

    /**
     * @param {object} live
     * @param {string} key
     * @return {void}
     */
    dismiss(live, key) {
        if (!ScribeLive.active(live)) {
            return;
        }
        const record = live.record;
        const finding = ScribeLive.find(record, key);
        if (finding === undefined) {
            return;
        }
        const fault = finding.fault;
        for (const each of record.findings) {
            if (each.fault === fault) {
                each.status = ScribeLive.Status.Dismissed;
            }
        }
        record.dismissed = [
            ...record.dismissed.filter(
                /**
                 * @param {string} kept
                 * @return {boolean}
                 */
                (kept) => kept !== fault,
            ),
            fault,
        ].slice(-ScribeLive.Settings.DismissedKept);
        ScribeLive.changed(live);
    },

    /**
     * @param {object} live
     * @param {string} key
     * @return {Promise<void>}
     * @throws {Error}
     */
    async told(live, key) {
        if (!ScribeLive.trusted(live)) {
            return;
        }
        const finding = ScribeLive.find(live.record, key);
        if (finding === undefined || finding.status !== ScribeLive.Status.Open) {
            return;
        }
        if (live.ruling) {
            throw new Error(ScribeLive.Settings.Messages.Busy);
        }
        const ruling = ScribePedant.told(live.keeper.view().state, finding);
        if (ruling === null) {
            return;
        }
        live.ruling = true;
        try {
            await live.keeper.rule(ruling);
        } catch (error) {
            if (live.closed) {
                return;
            }
            throw error;
        } finally {
            live.ruling = false;
        }
        if (!ScribeLive.active(live)) {
            return;
        }
        const ruled = ScribeLive.find(live.record, key);
        if (ruled === undefined) {
            return;
        }
        ruled.status = ScribeLive.Status.Told;
        ScribeLive.changed(live);
    },

    /**
     * @param {object} live
     * @param {string} text
     * @return {void}
     */
    use(live, text) {
        if (!ScribeLive.active(live)) {
            return;
        }
        const line = ScribeIntake.collapse(text);
        if (line === ScribeLive.Settings.Nothing) {
            return;
        }
        live.record.suggestion = line;
        if (live.offer !== null && live.offer.text === line) {
            live.offer = null;
        }
        ScribeLive.changed(live);
    },

    /**
     * @param {object} live
     * @return {void}
     */
    clear(live) {
        if (!ScribeLive.active(live)) {
            return;
        }
        const record = live.record;
        record.ready = null;
        record.led = [];
        record.basis = null;
        record.suggestion = null;
        ScribeLive.changed(live);
    },

    /**
     * @param {object} live
     * @return {Promise<void>}
     * @throws {Error}
     */
    async suggest(live) {
        const settings = ScribeLive.Settings;
        if (live.closed) {
            return;
        }
        const refused = ScribeLive.refusal(live);
        if (refused !== null) {
            throw new Error(refused);
        }
        if (live.suggesting) {
            throw new Error(settings.Messages.Busy);
        }
        const epoch = live.epoch;
        const excluded = live.excluded;
        const view = live.keeper.view();
        live.suggesting = true;
        const noted = { failure: null };
        let offer = null;
        try {
            offer = await ScribeMuse.suggest({
                state: view.state,
                now: live.record.now,
                recent: view.messages.slice(-settings.Recent),
                exclude: [...excluded],
                ask: ScribeLive.asker(live, settings.Roles.Scribe, noted),
            });
        } finally {
            live.suggesting = false;
        }
        if (!ScribeLive.current(live, epoch) || !ScribeLive.trusted(live) || live.excluded !== excluded) {
            return;
        }
        ScribeLive.report(live, noted);
        live.offer = offer;
        if (offer !== null) {
            excluded.push(offer.thread);
        }
        ScribeLive.announce(live);
    },

    /**
     * @param {object} live
     * @return {void}
     */
    ignore(live) {
        if (!ScribeLive.active(live)) {
            return;
        }
        live.offer = null;
        ScribeLive.announce(live);
    },

    /**
     * @param {object} live
     * @param {string} words
     * @return {Promise<void>}
     * @throws {Error}
     */
    async tell(live, words) {
        const settings = ScribeLive.Settings;
        if (live.closed) {
            return;
        }
        const refused = ScribeLive.refusal(live);
        if (refused !== null) {
            throw new Error(refused);
        }
        if (live.telling) {
            throw new Error(settings.Messages.Busy);
        }
        live.telling = true;
        try {
            const epoch = live.epoch;
            const view = live.keeper.view();
            const anchor = view.lastRead;
            const noted = { failure: null };
            const result = await ScribeMuse.tell({
                state: view.state,
                player: view.player,
                words,
                anchor,
                ask: ScribeLive.asker(live, settings.Roles.Analyzer, noted),
            });
            if (!ScribeLive.current(live, epoch) || !ScribeLive.trusted(live)) {
                return;
            }
            ScribeLive.report(live, noted);
            if (result === null) {
                live.understood = null;
                ScribeLive.announce(live);
                return;
            }
            let foreseen = { lines: Object.freeze([]), refused: Object.freeze([]) };
            if (result.operations.length > settings.NoCount) {
                try {
                    foreseen = await ScribeLive.foresee(live, result.operations, anchor);
                } catch (error) {
                    if (live.closed) {
                        return;
                    }
                    live.understood = null;
                    ScribeLive.announce(live);
                    throw error;
                }
                if (!ScribeLive.current(live, epoch) || !ScribeLive.trusted(live)) {
                    return;
                }
            }
            live.understood = {
                operations: result.operations,
                anchor,
                mused: result.refused,
                lines: foreseen.lines,
                refused: Object.freeze([...result.refused, ...foreseen.refused]),
            };
            ScribeLive.announce(live);
        } finally {
            live.telling = false;
        }
    },

    /**
     * @param {object} live
     * @param {readonly object[]} operations
     * @param {{ id: string, position: number }} anchor
     * @return {Promise<{ lines: readonly string[], refused: readonly object[] }>}
     * @throws {Error}
     */
    async foresee(live, operations, anchor) {
        const preview = await live.keeper.preview(operations, anchor);
        return { lines: ScribeMuse.changes(preview.before, preview.state), refused: preview.refused };
    },

    /**
     * @param {object} live
     * @return {string|null}
     */
    distrust(live) {
        const messages = ScribeLive.Settings.Messages;
        if (!ScribeLive.active(live)) {
            return live.loaded ? messages.Watching : messages.Unread;
        }
        return live.keeper.view().trusted === true ? null : messages.Untrusted;
    },

    /**
     * @param {object} live
     * @return {boolean}
     */
    trusted(live) {
        return ScribeLive.distrust(live) === null;
    },

    /**
     * @param {object} live
     * @return {Promise<void>}
     * @throws {Error}
     */
    async confirm(live) {
        if (live.closed) {
            return;
        }
        const doubt = ScribeLive.distrust(live);
        const understood = live.understood;
        if (understood === null || understood.operations.length === ScribeLive.Settings.NoCount) {
            return;
        }
        if (doubt !== null) {
            throw new Error(doubt);
        }
        if (live.confirming) {
            throw new Error(ScribeLive.Settings.Messages.Busy);
        }
        live.confirming = true;
        try {
            let foreseen = null;
            try {
                foreseen = await ScribeLive.foresee(live, understood.operations, understood.anchor);
            } catch (error) {
                if (live.closed) {
                    return;
                }
                throw error;
            }
            if (live.closed) {
                return;
            }
            const lost = ScribeLive.distrust(live);
            if (lost !== null) {
                throw new Error(lost);
            }
            if (live.understood !== understood) {
                return;
            }
            const unchanged =
                foreseen.lines.length === understood.lines.length &&
                foreseen.lines.every(
                    /**
                     * @param {string} line
                     * @param {number} index
                     * @return {boolean}
                     */
                    (line, index) => line === understood.lines[index],
                );
            if (!unchanged) {
                live.understood = {
                    ...understood,
                    lines: foreseen.lines,
                    refused: Object.freeze([...understood.mused, ...foreseen.refused]),
                };
                ScribeLive.announce(live);
                return;
            }
            try {
                await live.keeper.file(understood.operations, understood.anchor);
            } catch (error) {
                if (live.closed) {
                    return;
                }
                throw error;
            }
            if (live.understood === understood) {
                live.understood = null;
            }
            if (!ScribeLive.active(live)) {
                return;
            }
            ScribeLive.announce(live);
        } finally {
            live.confirming = false;
        }
    },

    /**
     * @param {object} live
     * @return {void}
     */
    forget(live) {
        if (!ScribeLive.active(live)) {
            return;
        }
        live.understood = null;
        ScribeLive.announce(live);
    },

    /**
     * @param {object} live
     * @return {void}
     */
    close(live) {
        live.closed = true;
        live.epoch++;
        live.waiting = null;
        live.refreshing = false;
    },

    /**
     * @param {object} live
     * @return {Readonly<object>}
     */
    view(live) {
        const settings = ScribeLive.Settings;
        const reading = ScribeLive.refusal(live) === null;
        const record = live.record;
        const understood = live.understood;
        const keeperView = live.keeper.view();
        if (reading) {
            const newest = Array.isArray(keeperView.messages) ? keeperView.messages.at(settings.Last) : undefined;
            const seen = record.seen;
            const unchecked =
                ScribeLive.isObject(newest) &&
                newest.fromPlayer !== true &&
                (seen === null ||
                    seen.id !== newest.id ||
                    seen.fingerprint !== newest.fingerprint);
            if (unchecked && live.running === null && live.waiting === null) {
                live.waiting = newest;
            }
            live.refreshing = live.refreshing || (record.ready !== null && !ScribeLive.fresh(live, keeperView));
            if (live.waiting !== null || live.refreshing) {
                Promise.resolve().then(
                    /**
                     * @return {Promise<void>}
                     */
                    () => ScribeLive.kick(live),
                );
            }
        }
        live.shown = live.problem;
        return Object.freeze({
            now: record.now,
            ready: record.ready,
            due: record.sends >= keeperView.settings.refresh || !ScribeScene.same(record.reminded, record.now),
            sends: record.sends,
            findings: Object.freeze(
                record.findings.map(
                    /**
                     * @param {object} finding
                     * @return {Readonly<object>}
                     */
                    (finding) =>
                        Object.freeze({
                            ...finding,
                            can:
                                finding.status === ScribeLive.Status.Open
                                    ? ScribeLive.can(live, keeperView, finding)
                                    : null,
                        }),
                ),
            ),
            suggestion: record.suggestion,
            offer: live.offer,
            understood:
                understood === null
                    ? null
                    : Object.freeze({
                          lines: understood.lines,
                          refused: understood.refused,
                          count: understood.operations.length,
                      }),
            problem: live.problem,
        });
    },

    /**
     * @param {object} live
     * @return {Readonly<object>}
     */
    handle(live) {
        return Object.freeze({
            /**
             * @return {Readonly<object>}
             */
            view: () => ScribeLive.view(live),

            /**
             * @param {object} message
             * @return {Promise<void>}
             */
            reply: (message) => ScribeLive.reply(live, message),

            /**
             * @param {string} text
             * @return {string}
             */
            outgoing: (text) => ScribeLive.outgoing(live, text),

            /**
             * @return {void}
             */
            sent: () => {
                ScribeLive.sent(live);
            },

            /**
             * @return {Readonly<{ ready: string|null, suggestion: string|null }>}
             */
            lines: () => ScribeLive.lines(live),

            /**
             * @param {{ ready: string|null, suggestion: string|null }} lines
             * @return {void}
             */
            went: (lines) => {
                ScribeLive.went(live, lines);
            },

            /**
             * @param {string} key
             * @return {void}
             */
            dismiss: (key) => {
                ScribeLive.dismiss(live, key);
            },

            /**
             * @param {string} key
             * @return {Promise<void>}
             */
            told: (key) => ScribeLive.told(live, key),

            /**
             * @param {string} text
             * @return {void}
             */
            use: (text) => {
                ScribeLive.use(live, text);
            },

            /**
             * @return {void}
             */
            clear: () => {
                ScribeLive.clear(live);
            },

            /**
             * @return {Promise<void>}
             */
            suggest: () => ScribeLive.suggest(live),

            /**
             * @return {Promise<void>}
             */
            another: () => ScribeLive.suggest(live),

            /**
             * @return {void}
             */
            ignore: () => {
                ScribeLive.ignore(live);
            },

            /**
             * @param {string} words
             * @return {Promise<void>}
             */
            tell: (words) => ScribeLive.tell(live, words),

            /**
             * @return {Promise<void>}
             */
            confirm: () => ScribeLive.confirm(live),

            /**
             * @return {void}
             */
            forget: () => {
                ScribeLive.forget(live);
            },

            /**
             * @return {void}
             */
            close: () => {
                ScribeLive.close(live);
            },
        });
    },

    /**
     * @param {{ keeper: { view: Function, rule: Function, file: Function, preview: Function }, storage: { get: Function, set: Function, remove: Function, list: Function }, roomId: string, ask: Function, clock: object, notify: Function }} options
     * @return {Readonly<object>}
     */
    open(options) {
        const { keeper, storage, roomId, ask, notify } = options;
        const settings = ScribeLive.Settings;
        const live = {
            keeper,
            storage,
            roomId,
            ask,
            notify,
            record: null,
            problem: null,
            shown: null,
            loaded: false,
            closed: false,
            watching: false,
            epoch: settings.FirstEpoch,
            running: null,
            waiting: null,
            answers: [],
            refreshing: false,
            appended: settings.NothingAppended,
            offer: null,
            excluded: [],
            understood: null,
            suggesting: false,
            telling: false,
            confirming: false,
            ruling: false,
            cans: { state: null, byKey: new Map() },
        };
        ScribeLive.load(live);
        live.watching = !keeper.view().reader;
        return ScribeLive.handle(live);
    },
});
/** @file scribe/page/ScribeSender.js */
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
     * @param {{ ready: string|null, suggestion: string|null }} lines
     * @param {number} limit
     * @return {Readonly<{ text: string, ready: boolean, suggestion: boolean }>}
     */
    compose(text, lines, limit) {
        const settings = ScribeSender.Settings;
        if (settings.Blank.test(text)) {
            return Object.freeze({ text, ready: false, suggestion: false });
        }
        const chosen = { ready: lines.ready, suggestion: lines.suggestion };
        /**
         * @return {string}
         */
        const whole = () => {
            let joined = text;
            for (const line of [chosen.ready, chosen.suggestion]) {
                if (line !== null) {
                    joined += settings.Newline + settings.NarratorLead + line;
                }
            }
            return joined;
        };
        while (ScribeText.bytes(whole()) > limit) {
            if (chosen.ready !== null) {
                chosen.ready = null;
            } else if (chosen.suggestion !== null) {
                chosen.suggestion = null;
            } else {
                break;
            }
        }
        return Object.freeze({ text: whole(), ready: chosen.ready !== null, suggestion: chosen.suggestion !== null });
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
/** @file scribe/page/ScribeFrame.js */
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
        ObjectType: 'object',
        StringType: 'string',
        BooleanType: 'boolean',
        NothingOffered: Object.freeze({
            ready: null,
            suggestion: null,
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
        return Object.freeze({ [bridge.TagName]: bridge.Tag, kind: bridge.Kind.Arm, seq, token, ready, suggestion });
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
        return Object.freeze({ [bridge.TagName]: bridge.Tag, kind: bridge.Kind.Sent, seq, ready, suggestion });
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
            frame.offer = Object.freeze({ ready: arm.ready, suggestion: arm.suggestion });
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
            });
            const offer = frame.offer;
            frame.offer = Object.freeze({
                ready: offer.ready === went.ready ? null : offer.ready,
                suggestion: offer.suggestion === went.suggestion ? null : offer.suggestion,
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
/** @file scribe/page/PanelStyle.js */
const PanelStyle = Object.freeze({
    Text: `:host {
    all: initial;
    --scribe-width: 360px;
    --scribe-tab-width: 3rem;
    --scribe-layer: 2147483000;
    --scribe-surface: #f5f3ee;
    --scribe-panel: #ffffff;
    --scribe-ink: #1f1e1b;
    --scribe-muted: #5c5a54;
    --scribe-line: #d4d0c6;
    --scribe-accent: #2c5a85;
    --scribe-accent-hover: #1f4466;
    --scribe-accent-ink: #ffffff;
    --scribe-danger: #8f2a2a;
    --scribe-focus: #b9561a;
    --scribe-quote: #efece4;
    --scribe-disabled: #9a978f;
    --scribe-shadow: rgba(0, 0, 0, 0.25);
    --scribe-gap: 0.75rem;
    --scribe-gap-small: 0.375rem;
    --scribe-radius: 0.375rem;
    --scribe-font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --scribe-mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
}

@media (prefers-color-scheme: dark) {
    :host {
        --scribe-surface: #1b1a18;
        --scribe-panel: #262522;
        --scribe-ink: #ece9e1;
        --scribe-muted: #b0ada4;
        --scribe-line: #45433e;
        --scribe-accent: #8db8e0;
        --scribe-accent-hover: #b3d1ec;
        --scribe-accent-ink: #12202d;
        --scribe-danger: #e39a9a;
        --scribe-focus: #f0a46c;
        --scribe-quote: #302e2a;
        --scribe-disabled: #77746c;
        --scribe-shadow: rgba(0, 0, 0, 0.6);
    }
}

*,
*::before,
*::after {
    box-sizing: border-box;
}

[hidden] {
    display: none !important;
}

p,
li,
span,
label,
summary,
pre,
button,
h2,
h3,
h4 {
    unicode-bidi: isolate;
}

.panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: var(--scribe-layer);
    display: flex;
    flex-direction: column;
    width: min(var(--scribe-width), 100vw);
    background: var(--scribe-panel);
    color: var(--scribe-ink);
    border-left: 1px solid var(--scribe-line);
    box-shadow: -2px 0 8px var(--scribe-shadow);
    font-family: var(--scribe-font);
    font-size: 14px;
    line-height: 1.45;
    text-align: left;
}

.panel.collapsed {
    top: 35vh;
    bottom: auto;
    width: var(--scribe-tab-width);
    border: 1px solid var(--scribe-line);
    border-right: 0;
    border-radius: var(--scribe-radius) 0 0 var(--scribe-radius);
}

.header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--scribe-gap-small);
    padding: var(--scribe-gap-small) var(--scribe-gap);
    border-bottom: 1px solid var(--scribe-line);
    background: var(--scribe-surface);
}

.panel.collapsed .header {
    flex-direction: column;
    flex-wrap: nowrap;
    padding: var(--scribe-gap-small);
    border-bottom: 0;
}

.panel.collapsed .headline,
.panel.collapsed .spend,
.panel.collapsed .trouble {
    display: none;
}

.panel.collapsed .badge,
.panel.collapsed .toggle {
    writing-mode: vertical-rl;
}

.headline {
    flex: 1 1 100%;
    margin: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
}

.badge {
    padding: 0 var(--scribe-gap-small);
    border-radius: var(--scribe-radius);
    background: var(--scribe-accent);
    color: var(--scribe-accent-ink);
    font-weight: 600;
}

.spend {
    color: var(--scribe-muted);
    margin-right: auto;
}

.trouble {
    flex: 1 1 100%;
    margin: 0;
    color: var(--scribe-danger);
    overflow-wrap: anywhere;
}

.body {
    flex: 1 1 auto;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--scribe-gap-small) var(--scribe-gap) var(--scribe-gap);
}

.tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--scribe-gap-small);
    margin-bottom: var(--scribe-gap-small);
}

.tabs [role="tab"][aria-selected="true"] {
    background: var(--scribe-accent);
    border-color: var(--scribe-accent);
    color: var(--scribe-accent-ink);
}

.panel-title {
    font-size: 1.125rem;
    margin: var(--scribe-gap-small) 0;
}

.group + .group {
    margin-top: var(--scribe-gap);
}

.group h3,
.detail h3,
.form h4 {
    font-size: 1rem;
    margin: var(--scribe-gap-small) 0;
}

.field {
    display: flex;
    flex-direction: column;
    gap: var(--scribe-gap-small);
    margin-bottom: var(--scribe-gap-small);
}

.tick {
    display: flex;
    align-items: center;
    gap: var(--scribe-gap-small);
    margin-bottom: var(--scribe-gap-small);
}

.required {
    color: var(--scribe-danger);
    font-weight: 700;
}

input,
textarea,
select,
button {
    font: inherit;
    color: var(--scribe-ink);
    background: var(--scribe-panel);
    border: 1px solid var(--scribe-line);
    border-radius: var(--scribe-radius);
    padding: var(--scribe-gap-small) var(--scribe-gap);
    min-height: 2.25rem;
}

textarea {
    width: 100%;
    min-height: 5rem;
    resize: vertical;
}

input[aria-invalid="true"],
textarea[aria-invalid="true"] {
    border-color: var(--scribe-danger);
}

button {
    cursor: pointer;
    transition: background-color 120ms ease;
}

button:hover:not(:disabled) {
    background: var(--scribe-quote);
}

button.primary {
    background: var(--scribe-accent);
    border-color: var(--scribe-accent);
    color: var(--scribe-accent-ink);
}

button.primary:hover:not(:disabled) {
    background: var(--scribe-accent-hover);
    border-color: var(--scribe-accent-hover);
}

button.danger {
    border-color: var(--scribe-danger);
    color: var(--scribe-danger);
}

button:disabled,
input:disabled,
textarea:disabled,
select:disabled {
    color: var(--scribe-disabled);
    border-color: var(--scribe-line);
    background: var(--scribe-surface);
    cursor: not-allowed;
}

button:focus-visible,
input:focus-visible,
textarea:focus-visible,
select:focus-visible,
summary:focus-visible,
.panel-title:focus-visible {
    outline: 3px solid var(--scribe-focus);
    outline-offset: 2px;
}

.actions {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: var(--scribe-gap-small);
    margin: var(--scribe-gap-small) 0;
}

.choices {
    display: flex;
    flex-wrap: wrap;
    gap: var(--scribe-gap-small);
}

.rows {
    list-style: none;
    margin: 0;
    padding: 0;
}

.rows > li {
    border-bottom: 1px solid var(--scribe-line);
    padding: var(--scribe-gap-small) 0;
    overflow-wrap: anywhere;
}

.rows > li.empty,
.meta,
.place,
details summary {
    color: var(--scribe-muted);
}

.rows p {
    margin: var(--scribe-gap-small) 0;
}

.lines {
    margin: 0;
    padding-left: var(--scribe-gap);
}

.day {
    font-weight: 600;
}

.title {
    font-weight: 600;
}

.problem,
.unreadable {
    color: var(--scribe-danger);
    overflow-wrap: anywhere;
}

.outcome {
    min-height: 1.45em;
    margin: var(--scribe-gap-small) 0;
    overflow-wrap: anywhere;
}

.offer {
    margin: var(--scribe-gap-small) 0;
    padding: var(--scribe-gap-small) var(--scribe-gap);
    background: var(--scribe-quote);
    border-left: 3px solid var(--scribe-accent);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.message {
    margin: var(--scribe-gap-small) 0;
    padding: var(--scribe-gap-small) var(--scribe-gap);
    background: var(--scribe-quote);
    border-left: 3px solid var(--scribe-line);
    font-family: var(--scribe-mono);
    font-size: 0.8125rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--scribe-gap);
    margin-top: var(--scribe-gap-small);
}

.pager .place {
    margin: 0;
}

.form,
.setup {
    border: 1px solid var(--scribe-line);
    border-radius: var(--scribe-radius);
    margin: var(--scribe-gap) 0;
    padding: var(--scribe-gap);
}

details summary {
    cursor: pointer;
}

@media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
        transition: none !important;
        animation: none !important;
        scroll-behavior: auto !important;
    }
}
`,
});
/** @file scribe/page/PanelView.js */
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
            NoBookOpen: 'No book for this chat yet: ',
            NoBookOne: ' message.',
            NoBookMany: ' messages.',
            Reading: 'Reading the chat...',
            UpToDateOpen: 'Up to date: ',
            Of: ' of ',
            ReadClose: ' read.',
            StoppedOpen: 'Stopped: ',
            Stopped: 'Stopped.',
            Paused: 'Paused.',
            Budget: "the day's budget is spent.",
            NoReason: 'the reason was not recorded.',
            Watching: 'Another tab is reading this chat.',
            ProblemOpen: ' Problem: ',
            ScribeOpen: ' Scribe: ',
            Hidden: ' (hidden)',
            Toward: ' toward ',
            TowardLine: 'toward ',
            Colon: ': ',
            Comma: ', ',
            Quote: '"',
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
        }),
        Titles: Object.freeze({
            Spelling: 'Name spelt another way',
            Contradiction: 'The reply contradicts the book',
            Leak: 'Someone knows what they were not told',
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
    }),

    /**
     * @param {{ phase: string, total: number, read: number, flight: string|null, stop: { reason: string, problem: string|null }|null, problem: string|null }} keeperView
     * @param {{ problem?: string|null }} liveView
     * @return {string}
     */
    headline(keeperView, liveView) {
        const settings = PanelView.Settings;
        const words = settings.Words;
        const phases = ScribeKeeper.Phase;
        const stops = ScribeAdoption.Stop;
        const flight = keeperView.flight ?? null;
        const problem = keeperView.problem ?? null;
        let line = words.Reading;
        if (keeperView.phase === phases.Watching) {
            line = words.Watching;
        } else if (flight !== null) {
            line = PanelView.said(flight);
        } else if (keeperView.phase === phases.Loading) {
            line = words.Loading;
        } else if (keeperView.phase === phases.NoBook) {
            line =
                words.NoBookOpen +
                PanelView.number(keeperView.total) +
                (keeperView.total === settings.Single ? words.NoBookOne : words.NoBookMany);
        } else if (keeperView.phase === phases.Idle) {
            line =
                words.UpToDateOpen +
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
            const reason = keeperView.stop.problem;
            const recorded = typeof reason === settings.StringType && reason.trim() !== words.Nothing;
            line = words.StoppedOpen + (recorded ? reason : words.NoReason);
        }
        if (problem !== null) {
            line += words.ProblemOpen + PanelView.said(problem);
        }
        const scribe = liveView.problem ?? null;
        if (scribe !== null) {
            line += words.ScribeOpen + PanelView.said(scribe);
        }
        return line;
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
                            return PanelView.said(fact.category) + words.Colon + PanelView.said(fact.text) + mark;
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
            (scene) => [{ day: scene.day, last: scene.lastPosition, row: BenchView.scene(scene, names) }],
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
                thread.closed === null ? [{ id: thread.id, text: thread.text, position: thread.position }] : [],
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
        return whole
            ? PanelView.attempt(
                  /**
                   * @return {object|null}
                   */
                  () => BenchView.subject(state, id),
                  apart,
              )
            : apart();
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
                (scene) => [BenchView.scene(scene, names)],
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
                const known = [kinds.Spelling, kinds.Contradiction, kinds.Leak].includes(finding.kind);
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
                }
                return [
                    {
                        key: finding.key,
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
/** @file scribe/page/ScribePanel.js */
const ScribePanel = Object.freeze({
    Settings: Object.freeze({
        Remembered: 'scribe:panel',
        Shown: Object.freeze({
            Open: 'open',
            Collapsed: 'collapsed',
        }),
        NarrowWindow: 1100,
        TellLimit: 2000,
        RepeatMs: 1000,
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
        Tabs: Object.freeze(['Summary', 'Book', 'Timeline', 'Rulings', 'Findings', 'Progress']),
        FirstTab: 'Summary',
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
            Aliases: 'aliases',
            Refinements: 'refinements',
            Made: 'made',
            Queued: 'queued',
            Findings: 'findings',
            Lines: 'lines',
            Calls: 'calls',
        }),
        Ids: Object.freeze({
            Host: 'scribe-host',
            Panel: 'scribe-panel',
            Headline: 'scribe-headline',
            Badge: 'scribe-badge',
            Spend: 'scribe-spend',
            Trouble: 'scribe-trouble',
            Toggle: 'scribe-toggle',
            Body: 'scribe-body',
            Needs: 'scribe-needs',
            Standing: 'scribe-standing',
            Search: 'scribe-search',
            Detail: 'scribe-detail',
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
            OfferText: 'scribe-offer-text',
            OfferActions: 'scribe-offer-actions',
            OfferOutcome: 'scribe-offer-outcome',
            Tell: 'scribe-tell',
            Work: 'scribe-tell-work',
            TellOutcome: 'scribe-tell-outcome',
            Understood: 'scribe-understood',
            Setup: 'scribe-setup',
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
            ControlsOutcome: 'scribe-controls-outcome',
            Pulled: 'scribe-pulled',
        }),
        Prefixes: Object.freeze({
            Tab: 'scribe-tab-',
            Section: 'scribe-section-',
            Title: 'scribe-title-',
            Failure: 'scribe-failure-',
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
            Key: 'key',
            Settings: 'settings',
            Controls: 'controls',
            Offer: 'offer',
            Tell: 'tell',
        }),
        Setup: Object.freeze([
            Object.freeze({ name: 'analyzer', label: 'Reading model', mode: 'text' }),
            Object.freeze({ name: 'scribe', label: 'Scribe model', mode: 'text' }),
            Object.freeze({ name: 'pedant', label: 'Pedant model', mode: 'text' }),
            Object.freeze({ name: 'size', label: 'Messages per stretch', mode: 'numeric' }),
            Object.freeze({ name: 'budget', label: 'Daily budget in dollars', mode: 'decimal' }),
            Object.freeze({ name: 'refresh', label: 'Sends between reminders', mode: 'numeric' }),
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
            Setup: 'setup',
            Detail: 'detail',
            Primary: 'primary',
            Danger: 'danger',
            Field: 'field',
            Tick: 'tick',
            Required: 'required',
        }),
        Attributes: Object.freeze({
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
            Reminder: 'Reminder: ',
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
            TellLong: 'Write at most 2,000 characters.',
            FieldFull: 'The field is full: clear it or file it first.',
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
            SetupHeading: 'Key and settings',
            KeySaved: 'A key is saved',
            NoKey: 'No key yet',
            KeyUnreadable: 'The key could not be read',
            KeyLabel: 'OpenRouter key',
            SaveKey: 'Save key',
            KeyMissing: 'Enter the OpenRouter key.',
            ModelMissing: 'Enter a model.',
            CountWrong: Object.freeze({
                size: 'Messages per stretch must be a whole number of at least 1.',
                refresh: 'Sends between reminders must be a whole number of at least 1.',
            }),
            BudgetWrong: 'The budget must be a number of dollars, more than 0.',
            FixFields: 'Nothing was saved: a field above needs attention.',
            AdoptFix: 'Nothing was started: a field above needs attention.',
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
            CallsHeading: 'Last calls',
            Refused: 'Refused lines',
            CallOpen: 'Call ',
            Unreadable: 'Unreadable answer',
            AnswerText: 'The answer',
            Saving: 'Saving...',
            Working: 'Working...',
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
     * @param {{ document: object, keeper: object, live: object, storage: object, confirm: (text: string) => boolean, download: (name: string, text: string) => void, clock: { now: () => number } }} environment
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
            filled: null,
            trouble,
            composing: false,
            heldDraw: false,
            workedOut: null,
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
        if (text === ScribePanel.Settings.Nothing) {
            panel.outcomes.delete(outlet);
            return;
        }
        panel.outcomes.set(outlet, text);
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
     * @return {void}
     */
    paged(panel, name, items, build, identify) {
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
                panel.pages[name] = Math.floor(follow / BenchView.PageSize) + settings.FirstPage;
            }
        }
        ScribePanel.show(panel, name, BenchView.page(rows, panel.pages[name]), build);
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
        header.append(
            ScribePanel.own(
                panel,
                'Headline',
                ScribePanel.make(panel, tags.Paragraph, settings.Nothing, classes.Headline),
            ),
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
            field.input.setAttribute(settings.Attributes.MaxLength, String(settings.TellLimit));
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
                                call: () => panel.live.clear(),
                                question: null,
                                done: settings.Nothing,
                                pending: words.Saving,
                                book: false,
                            }),
                        settings.Guard.Change,
                        settings.Ids.Clear,
                    ),
                ),
            );
            next.append(clearing, ScribePanel.outlet(panel, 'ClearOutcome', settings.Outlets.Clear));
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
            const attributes = settings.Attributes;
            const ids = settings.Ids;
            const guards = settings.Guard;
            const outlets = settings.Outlets;
            const setup = ScribePanel.own(
                panel,
                'Setup',
                ScribePanel.make(panel, tags.Details, settings.Nothing, classes.Setup),
            );
            const opener = ScribePanel.make(panel, tags.Summary, words.SetupHeading);
            ScribePanel.keyed(panel, opener, ids.Setup);
            setup.append(
                opener,
                ScribePanel.own(panel, 'KeyState', ScribePanel.make(panel, tags.Paragraph, settings.Nothing)),
            );
            const key = ScribePanel.field(panel, settings.InputTypes.Password, words.KeyLabel, ids.Key, false, false);
            ScribePanel.own(panel, 'Key', key.input);
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
                        guards.Change,
                        ids.SaveKey,
                        classes.Primary,
                    ),
                ),
            );
            setup.append(key.label, keying, ScribePanel.outlet(panel, 'KeyOutcome', outlets.Key));
            for (const item of settings.Setup) {
                const id = settings.Prefixes.Setting + item.name;
                const entry = ScribePanel.field(panel, settings.InputTypes.Text, item.label, id, true, false);
                entry.input.id = id;
                entry.input.setAttribute(attributes.InputMode, item.mode);
                const problem = ScribePanel.make(panel, tags.Paragraph, settings.Nothing, classes.Problem);
                problem.id = id + settings.Suffixes.Problem;
                panel.setup[item.name] = { input: entry.input, problem };
                setup.append(entry.label, problem);
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
            setup.append(saving, ScribePanel.outlet(panel, 'SettingsOutcome', outlets.Settings));
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
                    'Adopt',
                    ScribePanel.button(
                        panel,
                        words.Adopt,
                        /**
                         * @return {Promise<void>}
                         */
                        () => ScribePanel.adopt(panel),
                        guards.Book,
                        ids.Adopt,
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
                        command(
                            /**
                             * @return {Promise<void>}
                             */
                            () => keeper.resume(),
                            true,
                        ),
                        guards.Book,
                        ids.Resume,
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
            section.append(setup, controls, ScribePanel.outlet(panel, 'ControlsOutcome', outlets.Controls), pulled);
            ScribePanel.pager(panel, settings.Lists.Lines, ScribePanel.group(panel, section, words.LinesHeading));
            ScribePanel.pager(panel, settings.Lists.Calls, ScribePanel.group(panel, section, words.CallsHeading));
        },
    }),

    /**
     * @param {object} panel
     * @return {void}
     */
    lockAll(panel) {
        for (const lists of [panel.held, panel.guarded]) {
            for (const controls of Object.values(lists)) {
                for (const control of controls) {
                    control.disabled = true;
                }
            }
        }
    },

    /**
     * @param {object} panel
     * @param {string} text
     * @return {void}
     */
    alarm(panel, text) {
        ScribePanel.write(panel.parts.Trouble, text);
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
        try {
            const kept = panel.keeper.view();
            const heard = panel.live.view();
            view = {
                ...kept,
                made: kept.made ?? [],
                lastRead: kept.lastRead ?? null,
                unread: kept.unread ?? [],
                pulled: kept.pulled ?? null,
                flight: kept.flight ?? null,
                stop: kept.stop ?? null,
                problem: kept.problem ?? null,
                calls: kept.calls ?? [],
                lines: kept.lines ?? [],
            };
            live = {
                ...heard,
                offer: heard.offer ?? null,
                understood: heard.understood ?? null,
                findings: heard.findings ?? [],
                problem: heard.problem ?? null,
                ready: heard.ready ?? null,
                suggestion: heard.suggestion ?? null,
            };
        } catch (error) {
            ScribePanel.lockAll(panel);
            ScribePanel.alarm(panel, words.Trouble + ScribePanel.reason(error));
            return;
        }
        try {
            ScribePanel.header(panel, view, live);
        } catch (error) {
            for (const name of ['Headline', 'Badge', 'Spend']) {
                ScribePanel.write(panel.parts[name], settings.Nothing);
            }
            panel.parts.Badge.hidden = true;
            ScribePanel.fold(panel);
            ScribePanel.alarm(panel, words.Trouble + ScribePanel.reason(error));
        }
        if (!panel.open) {
            return;
        }
        try {
            ScribePanel.draw(panel, view, live);
        } catch (error) {
            ScribePanel.lockAll(panel);
            ScribePanel.alarm(panel, words.Trouble + ScribePanel.reason(error));
        }
    },

    /**
     * @param {object} panel
     * @param {object} view
     * @param {object} live
     * @return {void}
     */
    header(panel, view, live) {
        const settings = ScribePanel.Settings;
        const words = settings.Words;
        const parts = panel.parts;
        ScribePanel.fold(panel);
        ScribePanel.write(parts.Headline, PanelView.headline(view, live));
        const needs = PanelView.needs(view.state);
        const ruling = needs.conflicts + needs.lookAlikes + needs.questions;
        const open = PanelView.tally(
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
     * @return {void}
     */
    draw(panel, view, live) {
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
            ScribePanel.Drawers[panel.tab](panel, view, live);
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
            ScribePanel.write(failure, words.TabFailed + ScribePanel.reason(error));
            failure.hidden = false;
        }
        for (const [key, outlet] of panel.outlets) {
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
     * @param {object} view
     * @return {void}
     */
    lock(panel, view) {
        const phases = ScribeKeeper.Phase;
        const parts = panel.parts;
        const ruled = !view.reader || view.flight !== null || panel.busy > 0;
        for (const control of [...panel.held.Book, ...panel.guarded.Book]) {
            control.disabled = ruled;
        }
        for (const control of [...panel.held.Change, ...panel.guarded.Change]) {
            control.disabled = !view.reader;
        }
        for (const control of [...panel.held.Loose, ...panel.guarded.Loose]) {
            control.disabled = false;
        }
        if (view.phase === phases.Loading) {
            parts.Adopt.disabled = true;
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
    },

    /**
     * @param {object} panel
     * @return {string|null}
     */
    remember(panel) {
        const settings = ScribePanel.Settings;
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
        const target = panel.keyed.get(focused) ?? panel.fixed.get(focused);
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
        ScribePanel.say(panel, outlet, outcome);
        if (filed) {
            panel.trouble = settings.Nothing;
        }
        ScribePanel.redraw(panel);
        if (!filed && !panel.shown.has(outlet)) {
            panel.trouble = outcome;
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
        return ScribePanel.perform(panel, {
            outlet,
            /**
             * @return {Promise<void>}
             */
            call: () => panel.keeper.rule(operation),
            question,
            done: settings.Nothing,
            pending: settings.Words.Saving,
            book: true,
        });
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
        if (text.length > settings.TellLimit) {
            ScribePanel.refuse(panel, outlet, settings.Ids.Tell, words.TellLong);
            return;
        }
        ScribePanel.mark(panel, settings.Ids.Tell, false);
        const filed = await ScribePanel.perform(panel, {
            outlet,
            /**
             * @return {Promise<void>}
             */
            call: () => panel.live.tell(text),
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
        if (filed && panel.parts.Tell.value === panel.workedOut) {
            panel.parts.Tell.value = settings.Nothing;
            panel.workedOut = null;
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
            call: () => panel.keeper.rule(operation),
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
            call: () => panel.keeper.keepFirst(),
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
     * @return {Promise<void>}
     */
    async adopt(panel) {
        const settings = ScribePanel.Settings;
        const words = settings.Words;
        const outlet = settings.Outlets.Controls;
        const view = panel.keeper.view();
        const form = ScribePanel.form(panel);
        if (form.problems.size > settings.NoCount) {
            panel.parts.Setup.open = true;
            ScribePanel.say(panel, outlet, words.AdoptFix);
            ScribePanel.redraw(panel);
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
        if (ScribePanel.again(panel, settings.Ids.SaveKey)) {
            return;
        }
        const field = panel.parts.Key;
        const typed = field.value;
        field.value = settings.Nothing;
        if (typed.trim() === settings.Nothing) {
            ScribePanel.refuse(panel, outlet, settings.Ids.Key, words.KeyMissing);
            return;
        }
        ScribePanel.mark(panel, settings.Ids.Key, false);
        let outcome = settings.Nothing;
        try {
            ScribeStore.setKey(panel.storage, typed);
            panel.last.set(settings.Ids.SaveKey, panel.clock.now());
            panel.trouble = settings.Nothing;
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
            parts.Detail.hidden = subject === null;
            if (subject === null) {
                panel.chosen = null;
                return;
            }
            panel.chosen = subject.id;
            ScribePanel.write(
                parts.Heading,
                PanelView.named(subject.heading) + words.Open + PanelView.named(subject.kind) + words.Close,
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
                (fact) => ScribePanel.Rows.fact(panel, fact),
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
                                    call: () => panel.live.forget(),
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
                if (unchanged) {
                    shown.push(ScribePanel.make(panel, tags.Paragraph, words.NothingChanges, classes.Meta));
                } else if (understood.count > 0) {
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
                (conflict) => ScribePanel.key(sections.Conflicts, conflict.subject, conflict.category),
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
                [...unanswered, ...answered, ...unreadable],
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
            if (live.ready !== null) {
                queued.push(words.Reminder + PanelView.said(live.ready));
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
            const parts = panel.parts;
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
            ScribePanel.paged(
                panel,
                settings.Lists.Findings,
                PanelView.findings(view.state, live),
                /**
                 * @param {object} item
                 * @return {object}
                 */
                (item) => ScribePanel.Rows.finding(panel, item),
                /**
                 * @param {{ key: string }} item
                 * @return {string}
                 */
                (item) => ScribePanel.key(settings.Sections.Findings, item.key),
            );
        },

        /**
         * @param {object} panel
         * @param {object} view
         * @return {void}
         */
        Progress(panel, view) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const parts = panel.parts;
            const noBook = view.phase === ScribeKeeper.Phase.NoBook;
            let keyState = words.KeyUnreadable;
            try {
                keyState = ScribeStore.key(panel.storage) === settings.Nothing ? words.NoKey : words.KeySaved;
            } catch {
                keyState = words.KeyUnreadable;
            }
            ScribePanel.write(parts.KeyState, keyState);
            const filled = JSON.stringify(view.settings);
            if (filled !== panel.filled) {
                for (const item of settings.Setup) {
                    const value = view.settings[item.name];
                    const shown = typeof value === settings.StringType || typeof value === settings.NumberType;
                    panel.setup[item.name].input.value = shown ? String(value) : settings.Nothing;
                }
                panel.filled = filled;
            }
            if (noBook) {
                parts.Setup.open = true;
                parts.Adopt.classList.add(settings.Classes.Primary);
            } else {
                parts.Adopt.classList.remove(settings.Classes.Primary);
            }
            ScribePanel.write(parts.Adopt, noBook ? words.Adopt : words.StartOver);
            const pulled = view.pulled;
            parts.Pulled.hidden = pulled === null;
            if (pulled !== null) {
                let line =
                    words.LastPullOpen +
                    PanelView.number(pulled.count) +
                    (pulled.count === settings.Single ? words.MessageOne : words.MessageMany) +
                    words.Ended +
                    PanelView.said(pulled.end);
                if (pulled.skipped > settings.NoCount) {
                    line += words.Comma + PanelView.number(pulled.skipped) + words.UnreadClose;
                }
                ScribePanel.write(parts.Pulled, line);
            }
            /**
             * @param {object} item
             * @return {object[]}
             */
            const whole = (item) => [item];
            ScribePanel.paged(
                panel,
                settings.Lists.Lines,
                PanelView.each(view.lines, whole),
                /**
                 * @param {object} report
                 * @return {object}
                 */
                (report) => ScribePanel.Rows.line(panel, report),
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
                (record) => ScribePanel.Rows.call(panel, record),
                null,
            );
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
        fact(panel, fact) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const acts = settings.Acts;
            const section = settings.Sections.Facts;
            const ruling = ScribeLog.Ruling;
            const outlet = ScribePanel.key(section, fact.id);
            const { item, outcome, actions } = ScribePanel.Rows.frame(panel, outlet);
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
            const outlet = ScribePanel.key(section, conflict.subject, conflict.category);
            const { item, outcome, actions } = ScribePanel.Rows.frame(panel, outlet);

            /**
             * @param {string} act
             * @param {...string} more
             * @return {string}
             */
            const key = (act, ...more) => ScribePanel.key(section, conflict.subject, conflict.category, act, ...more);

            /**
             * @param {string} text
             * @param {boolean} hidden
             * @return {Promise<boolean>}
             */
            const pin = (text, hidden) =>
                ScribePanel.rule(
                    panel,
                    outlet,
                    {
                        type: ScribeLog.Ruling.Pin,
                        subject: conflict.subject,
                        category: conflict.category,
                        target: null,
                        text,
                        hidden,
                    },
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
                    PanelView.named(conflict.label) + words.Comma + PanelView.said(conflict.category),
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
         * @return {object}
         */
        question(panel, question) {
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
                    PanelView.said(alias.name) + words.JoinedTo + PanelView.named(alias.label),
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
                                    const full = !there && value.length > settings.TellLimit;
                                    if (full) {
                                        ScribePanel.say(panel, telling, words.FieldFull);
                                    } else if (!there) {
                                        field.value = value;
                                        if (panel.outcomes.get(telling) === words.FieldFull) {
                                            ScribePanel.say(panel, telling, settings.Nothing);
                                        }
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
         * @param {{ pass: string, first: number|null, last: number|null, read: number, refusedLines: ReadonlyArray<{ line: string, reason: string }>, refusedOperations: ReadonlyArray<{ operation: object, reason: string }> }} report
         * @return {object}
         */
        line(panel, report) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const tags = settings.Tags;
            const item = ScribePanel.make(panel, tags.Item, settings.Nothing, settings.Classes.Row);
            const refusedLines = PanelView.listed(report.refusedLines);
            const refusedOperations = PanelView.listed(report.refusedOperations);
            item.append(
                ScribePanel.make(
                    panel,
                    tags.Paragraph,
                    BenchView.progress({ ...report, refusedLines, refusedOperations }),
                ),
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
                    report,
                    words.Refused,
                    ScribePanel.key(settings.Sections.Lines, report.pass, report.first, report.last, report.read),
                    list,
                ),
            );
            return item;
        },

        /**
         * @param {object} panel
         * @param {{ sequence: number|null, pass: string, answer?: string, readable: boolean }} record
         * @return {object}
         */
        call(panel, record) {
            const settings = ScribePanel.Settings;
            const words = settings.Words;
            const tags = settings.Tags;
            const answer = typeof record.answer === settings.StringType ? record.answer : settings.Nothing;
            const item = ScribePanel.make(panel, tags.Item, settings.Nothing, settings.Classes.Row);
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
                    record,
                    words.AnswerText,
                    ScribePanel.key(settings.Sections.Calls, record.sequence, record.pass, answer.length),
                    ScribePanel.make(panel, tags.Preformatted, answer, settings.Classes.Message),
                ),
            );
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
/** @file scribe/page/ScribeBoot.js */
const ScribeBoot = Object.freeze({
    Role: Object.freeze({
        Analyzer: 'Analyzer',
        Scribe: 'Scribe',
        Pedant: 'Pedant',
    }),

    Settings: Object.freeze({
        TickMs: 20000,
        AfterTraffic: Object.freeze([0, 5000, 15000]),
        TickGapMs: 3000,
        RouteMs: 1000,
        RetryMs: 10000,
        Attempts: 3,
        PauseMs: 2000,
        TimeoutMs: Object.freeze({
            Analyzer: 600000,
            Scribe: 180000,
            Pedant: 180000,
        }),
        TransportMarginMs: 5000,
        LockWaitMs: 2000,
        LockRetryMs: 10000,
        ModelOrigin: 'https://openrouter.ai',
        MaxTokens: Object.freeze({
            Analyzer: 40000,
            Scribe: 700,
            Pedant: 1500,
        }),
        LockPrefix: 'scribe:reader:',
        Models: Object.freeze({
            Analyzer: 'analyzer',
            Scribe: 'scribe',
            Pedant: 'pedant',
        }),
        Budget: 'budget',
        Parts: Object.freeze([
            Object.freeze({ name: 'sender', ending: 'detach' }),
            Object.freeze({ name: 'panel', ending: 'unmount' }),
            Object.freeze({ name: 'live', ending: 'close' }),
            Object.freeze({ name: 'keeper', ending: 'close' }),
        ]),
        IfAvailable: Object.freeze({ ifAvailable: true }),
        Once: Object.freeze({ once: true }),
        AbortEvent: 'abort',
        KeyEvents: Object.freeze(['keydown', 'keyup', 'keypress']),
        VisibilityEvent: 'visibilitychange',
        MessageEvent: 'message',
        FrameTag: 'iframe',
        KeptArms: 8,
        KeptFrames: 16,
        SentLimit: 10,
        SentWindowMs: 10000,
        TokenShortest: 16,
        TokenLongest: 200,
        NothingOffered: Object.freeze({ ready: null, suggestion: null }),
        Capture: true,
        Hidden: 'hidden',
        ResponseType: 'text',
        Redirect: 'error',
        PathStart: '/',
        RoomsPath: '/v1/rooms/',
        Mark: 'data-zeta-scribe',
        Mask: '[hidden]',
        KeptTokens: 5,
        Space: ' ',
        ByteOrderMark: '﻿',
        LogPrefix: '[Scribe] ',
        LinkTag: 'a',
        RevokeMs: 60000,
        MonthOffset: 1,
        DateDigits: 2,
        DatePad: '0',
        DateJoint: '-',
        FirstEntry: 0,
        NotFound: -1,
        Last: -1,
        NoSpending: 0,
        Nothing: '',
        ObjectType: 'object',
        StringType: 'string',
        FunctionType: 'function',
        Messages: Object.freeze({
            Refused: 'The request was refused',
            Failed: 'The request failed',
            TimedOut: 'The request timed out',
            Stopped: 'The request was stopped',
            NoKey: 'No key',
            Spent: "The day's budget is spent",
            Left: 'The chat has been left',
            Running: 'The scribe is already running on this page',
            NotStarted: 'The scribe could not start: ',
            NotWatched: 'The page could not be watched: ',
            NotFollowed: 'The chat could not be followed: ',
            NotChecked: 'The check failed: ',
            NotDrawn: 'The panel could not be drawn: ',
            NotHanded: 'The reply could not be handed on: ',
            NotClosed: 'A part of the scribe could not be closed: ',
            NotLocked: 'The reader lock failed: ',
            NoLock: 'The browser lock could not be used, so the stored claim decides who reads: ',
            Silent: 'it did not answer',
            NotRecorded: 'The spending could not be saved; it is kept until it can be: ',
            Unrecorded: 'The spending could not be recorded, so nothing more is asked until it is',
            NotArmed: 'The chat frame could not be armed: ',
            NotHeard: 'A message from the chat frame could not be handled: ',
            NotTold: 'The live part could not be told what went: ',
            NoBridge: 'The bridge to the chat frame could not be keyed: ',
            NoToken: 'no usable token was made',
            NoStore: 'the token could not be read, made or saved',
        }),
    }),

    /**
     * @param {*} error
     * @return {string}
     */
    words(error) {
        const settings = ScribeBoot.Settings;
        const described = error !== null && typeof error === settings.ObjectType && typeof error.message === settings.StringType;
        return described ? error.message : String(error);
    },

    /**
     * @param {string} token
     * @return {string}
     */
    bare(token) {
        const settings = ScribeBoot.Settings;
        const space = token.indexOf(settings.Space);
        return space === settings.NotFound ? token : token.slice(space + settings.Space.length).trim();
    },

    /**
     * @param {{ watcher: object|null, tokens: string[] }} boot
     * @return {string|null}
     */
    token(boot) {
        const settings = ScribeBoot.Settings;
        if (boot.watcher === null) {
            return null;
        }
        const token = boot.watcher.token();
        if (typeof token === settings.StringType && token !== settings.Nothing && !boot.tokens.includes(token)) {
            boot.tokens.push(token);
            boot.tokens.splice(settings.FirstEntry, Math.max(boot.tokens.length - settings.KeptTokens, settings.FirstEntry));
        }
        return token;
    },

    /**
     * @param {object} boot
     * @param {string} text
     * @return {void}
     */
    say(boot, text) {
        const settings = ScribeBoot.Settings;
        ScribeBoot.token(boot);
        let stored = null;
        try {
            stored = boot.environment.storage.get(ScribeFrame.Bridge.TokenName, null);
        } catch {
            stored = null;
        }
        let told = text;
        for (const secret of [boot.bridge, stored]) {
            if (ScribeBoot.usable(secret)) {
                told = told.replaceAll(secret, settings.Mask);
            }
        }
        for (const token of boot.tokens) {
            for (const secret of [token, ScribeBoot.bare(token)]) {
                if (secret !== settings.Nothing) {
                    told = told.replaceAll(secret, settings.Mask);
                }
            }
        }
        boot.environment.log(told);
    },

    /**
     * @param {object} boot
     * @param {string} prefix
     * @param {Function} action
     * @return {void}
     */
    attempt(boot, prefix, action) {
        new Promise(
            /**
             * @param {Function} resolve
             * @return {void}
             */
            (resolve) => {
                resolve(action());
            },
        ).then(
            null,
            /**
             * @param {*} error
             * @return {void}
             */
            (error) => {
                ScribeBoot.say(boot, `${prefix}${ScribeBoot.words(error)}`);
            },
        );
    },

    /**
     * @param {object} session
     * @param {number} milliseconds
     * @param {Function} action
     * @param {Function|null} ended
     * @return {void}
     */
    later(session, milliseconds, action, ended) {
        if (session.closed) {
            if (ended !== null) {
                ended();
            }
            return;
        }
        const timer = session.boot.environment.timers.setTimeout(
            /**
             * @return {void}
             */
            () => {
                session.timers.delete(timer);
                action();
            },
            milliseconds,
        );
        session.timers.set(timer, ended);
    },

    /**
     * @param {object} session
     * @param {number} milliseconds
     * @return {Promise<void>}
     */
    pause(session, milliseconds) {
        return new Promise(
            /**
             * @param {Function} resolve
             * @param {Function} reject
             * @return {void}
             */
            (resolve, reject) => {
                ScribeBoot.later(
                    session,
                    milliseconds,
                    resolve,
                    /**
                     * @return {void}
                     */
                    () => {
                        reject(new Error(ScribeBoot.Settings.Messages.Left));
                    },
                );
            },
        );
    },

    /**
     * @param {object} session
     * @param {string} member
     * @return {*}
     * @throws {Error}
     */
    setting(session, member) {
        const saved = ScribeStore.read(session.boot.environment.storage, session.roomId, ScribeStore.Kind.Settings);
        return saved !== null && Object.hasOwn(saved, member) ? saved[member] : ScribeKeeper.Defaults[member];
    },

    /**
     * @param {string} text
     * @return {number}
     */
    billed(text) {
        const settings = ScribeBoot.Settings;
        let body = null;
        try {
            body = JSON.parse(text.startsWith(settings.ByteOrderMark) ? text.slice(settings.ByteOrderMark.length) : text);
        } catch {
            body = null;
        }
        const cost = body?.usage?.cost;
        return Number.isFinite(cost) && cost > settings.NoSpending ? cost : settings.NoSpending;
    },

    /**
     * @param {object} session
     * @return {number}
     */
    owed(session) {
        const debt = session.boot.debts.get(session.roomId);
        return debt !== undefined && debt.day === session.boot.environment.clock.today() ? debt.amount : ScribeBoot.Settings.NoSpending;
    },

    /**
     * @param {object} session
     * @return {void}
     */
    repay(session) {
        const boot = session.boot;
        const environment = boot.environment;
        const debt = boot.debts.get(session.roomId);
        if (debt === undefined) {
            return;
        }
        const day = environment.clock.today();
        if (debt.day !== day) {
            boot.debts.delete(session.roomId);
            return;
        }
        let before = null;
        let failure = null;
        try {
            before = ScribeStore.spent(environment.storage, session.roomId, day);
            ScribeStore.spend(environment.storage, session.roomId, day, debt.amount);
            boot.debts.delete(session.roomId);
            return;
        } catch (error) {
            failure = error;
        }
        if (before !== null && ScribeBoot.landed(session, day, before + debt.amount)) {
            boot.debts.delete(session.roomId);
            return;
        }
        ScribeBoot.say(boot, `${ScribeBoot.Settings.Messages.NotRecorded}${ScribeBoot.words(failure)}`);
    },

    /**
     * @param {object} session
     * @param {string} day
     * @param {number} total
     * @return {boolean}
     */
    landed(session, day, total) {
        try {
            return ScribeStore.spent(session.boot.environment.storage, session.roomId, day) === total;
        } catch {
            return false;
        }
    },

    /**
     * @param {object} session
     * @return {void}
     * @throws {Error}
     */
    solvent(session) {
        ScribeBoot.repay(session);
        if (session.boot.debts.has(session.roomId)) {
            throw new Error(ScribeBoot.Settings.Messages.Unrecorded);
        }
    },

    /**
     * @param {object} session
     * @param {number} amount
     * @return {void}
     */
    charge(session, amount) {
        if (amount <= ScribeBoot.Settings.NoSpending) {
            return;
        }
        session.boot.debts.set(session.roomId, { day: session.boot.environment.clock.today(), amount: ScribeBoot.owed(session) + amount });
        ScribeBoot.repay(session);
    },

    /**
     * @param {object} session
     * @param {string} role
     * @param {string} system
     * @param {string} user
     * @param {{ amount: number, settled: boolean }} bill
     * @return {Promise<string>}
     * @throws {Error}
     */
    async call(session, role, system, user, bill) {
        const settings = ScribeBoot.Settings;
        const messages = settings.Messages;
        const environment = session.boot.environment;
        if (session.closed) {
            throw new Error(messages.Left);
        }
        const key = ScribeStore.key(environment.storage);
        if (key === settings.Nothing) {
            throw new Error(messages.NoKey);
        }
        const model = ScribeBoot.setting(session, settings.Models[role]);
        const timeoutMs = settings.TimeoutMs[role];
        const transportMs = timeoutMs - settings.TransportMarginMs;

        /**
         * @param {number} milliseconds
         * @return {Promise<void>}
         */
        const pause = (milliseconds) => ScribeBoot.pause(session, milliseconds);
        let ended = Promise.resolve();

        /**
         * @return {null}
         */
        const over = () => null;

        /**
         * @param {string} url
         * @param {object} options
         * @return {Promise<{ status: number, text: () => Promise<string> }>}
         */
        const fetch = (url, options) => {
            const sending = ended.then(
                /**
                 * @return {Promise<{ status: number, text: () => Promise<string> }>}
                 * @throws {Error}
                 */
                () => {
                    if (bill.settled) {
                        throw new Error(messages.Stopped);
                    }
                    const stopper = new environment.pageWindow.AbortController();
                    let done = false;
                    ScribeBoot.later(
                        session,
                        transportMs,
                        /**
                         * @return {void}
                         */
                        () => {
                            if (!done) {
                                stopper.abort();
                            }
                        },
                        null,
                    );
                    return session.boot
                        .request(url, {
                            method: options.method,
                            headers: options.headers,
                            body: options.body,
                            timeout: transportMs,
                            signal: stopper.signal,
                        })
                        .finally(
                            /**
                             * @return {void}
                             */
                            () => {
                                done = true;
                            },
                        );
                },
            );
            ended = sending.then(over, over);
            return sending.then(
                /**
                 * @param {{ status: number, text: () => Promise<string> }} response
                 * @return {Promise<{ status: number, text: () => Promise<string> }>}
                 */
                async (response) => {
                    const text = await response.text();
                    const cost = ScribeBoot.billed(text);
                    if (bill.settled) {
                        ScribeBoot.charge(session, cost);
                    } else {
                        bill.amount += cost;
                    }
                    return {
                        status: response.status,

                        /**
                         * @return {Promise<string>}
                         */
                        text: async () => text,
                    };
                },
            );
        };
        const answer = await ScribeGateway.retry(
            /**
             * @return {Promise<object>}
             */
            () =>
                ScribeGateway.call({
                    fetch,
                    key,
                    model,
                    system,
                    user,
                    maxTokens: settings.MaxTokens[role],
                    sleep: pause,
                    timeoutMs,
                }),
            { attempts: settings.Attempts, pauseMs: settings.PauseMs, sleep: pause },
        );
        return answer.text;
    },

    /**
     * @param {object} session
     * @param {string} role
     * @param {string} system
     * @param {string} user
     * @return {Promise<{ text: string, cost: number }>}
     * @throws {Error}
     */
    async ask(session, role, system, user) {
        const bill = { amount: ScribeBoot.Settings.NoSpending, settled: false };
        ScribeBoot.solvent(session);
        try {
            const text = await ScribeBoot.call(session, role, system, user, bill);
            bill.settled = true;
            return { text, cost: bill.amount };
        } catch (error) {
            bill.settled = true;
            ScribeBoot.charge(session, bill.amount);
            throw error;
        }
    },

    /**
     * @param {object} session
     * @param {string} role
     * @param {string} system
     * @param {string} user
     * @return {Promise<{ text: string, cost: number }>}
     * @throws {Error}
     */
    async counted(session, role, system, user) {
        const settings = ScribeBoot.Settings;
        const environment = session.boot.environment;
        ScribeBoot.solvent(session);
        const budget = ScribeBoot.setting(session, settings.Budget);
        if (ScribeStore.spent(environment.storage, session.roomId, environment.clock.today()) >= budget) {
            throw new Error(settings.Messages.Spent);
        }
        const bill = { amount: settings.NoSpending, settled: false };
        try {
            const text = await ScribeBoot.call(session, role, system, user, bill);
            return { text, cost: bill.amount };
        } finally {
            bill.settled = true;
            ScribeBoot.charge(session, bill.amount);
        }
    },

    /**
     * @param {Function} xmlHttpRequest
     * @return {(url: string, options: { method: string, headers: object, body: string, timeout?: number, signal?: object }) => Promise<{ status: number, text: () => Promise<string> }>}
     */
    request(xmlHttpRequest) {
        const settings = ScribeBoot.Settings;
        const messages = settings.Messages;

        /**
         * @param {*} url
         * @param {{ method: string, headers: object, body: string, timeout?: number, signal?: object }} options
         * @return {Promise<{ status: number, text: () => Promise<string> }>}
         */
        return (url, options) =>
            new Promise(
                /**
                 * @param {Function} resolve
                 * @param {Function} reject
                 * @return {void}
                 */
                (resolve, reject) => {
                    if (typeof url !== settings.StringType || !url.startsWith(`${settings.ModelOrigin}${settings.PathStart}`)) {
                        reject(new Error(messages.Refused));
                        return;
                    }
                    const signal = options.signal ?? null;
                    if (signal !== null && signal.aborted) {
                        reject(new Error(messages.Stopped));
                        return;
                    }
                    const details = Object.create(null);
                    details.method = options.method;
                    details.url = url;
                    details.headers = { __proto__: null, ...options.headers };
                    details.data = options.body;
                    details.responseType = settings.ResponseType;
                    details.anonymous = true;
                    details.timeout = options.timeout;
                    details.redirect = settings.Redirect;

                    /**
                     * @param {{ status: number, responseText: * }} response
                     * @return {void}
                     */
                    details.onload = (response) => {
                        const text = typeof response.responseText === settings.StringType ? response.responseText : settings.Nothing;
                        resolve({
                            status: response.status,

                            /**
                             * @return {Promise<string>}
                             */
                            text: async () => text,
                        });
                    };

                    /**
                     * @return {void}
                     */
                    details.onerror = () => {
                        reject(new Error(messages.Failed));
                    };

                    /**
                     * @return {void}
                     */
                    details.ontimeout = () => {
                        reject(new Error(messages.TimedOut));
                    };

                    /**
                     * @return {void}
                     */
                    details.onabort = () => {
                        reject(new Error(messages.Stopped));
                    };
                    let handle = null;
                    try {
                        handle = xmlHttpRequest(details);
                    } catch {
                        reject(new Error(messages.Failed));
                        return;
                    }
                    if (signal !== null) {
                        signal.addEventListener(
                            settings.AbortEvent,
                            /**
                             * @return {void}
                             */
                            () => {
                                if (typeof handle?.abort !== settings.FunctionType) {
                                    reject(new Error(messages.Stopped));
                                    return;
                                }
                                try {
                                    handle.abort();
                                } catch {
                                    reject(new Error(messages.Stopped));
                                }
                            },
                            settings.Once,
                        );
                    }
                },
            );
    },

    /**
     * @param {object} session
     * @return {void}
     */
    redraw(session) {
        const panel = session.panel;
        if (panel !== null) {
            ScribeBoot.attempt(
                session.boot,
                ScribeBoot.Settings.Messages.NotDrawn,
                /**
                 * @return {*}
                 */
                () => panel.redraw(),
            );
        }
    },

    /**
     * @param {{ session: object|null }} boot
     * @param {{ composedPath?: Function, target?: object, stopImmediatePropagation: Function }} event
     * @return {void}
     */
    shield(boot, event) {
        const settings = ScribeBoot.Settings;
        try {
            const panel = boot.session === null ? null : boot.session.panel;
            const host = panel === null ? null : (panel.host ?? null);
            if (host === null) {
                return;
            }
            let path = [];
            if (typeof event.composedPath === settings.FunctionType) {
                path = event.composedPath();
            } else {
                for (let node = event.target; node !== null && node !== undefined; node = node.parentNode) {
                    path.push(node);
                }
            }
            if (path.includes(host)) {
                event.stopImmediatePropagation();
            }
        } catch {
            return;
        }
    },

    /**
     * @param {object} session
     * @return {void}
     */
    stir(session) {
        if (!session.ticking) {
            return;
        }
        for (const delay of ScribeBoot.Settings.AfterTraffic) {
            ScribeBoot.later(
                session,
                delay,
                /**
                 * @return {void}
                 */
                () => {
                    ScribeBoot.askTick(session);
                },
                null,
            );
        }
    },

    /**
     * @param {object} boot
     * @return {object[]}
     */
    prune(boot) {
        const settings = ScribeBoot.Settings;
        const present = [];
        for (const frame of boot.environment.document.querySelectorAll(settings.FrameTag)) {
            if (typeof frame.src === settings.StringType && frame.src.startsWith(ScribeFrame.Bridge.FramePrefix)) {
                present.push(frame.contentWindow);
            }
        }
        boot.frames = boot.frames.filter(
            /**
             * @param {{ target: object }} entry
             * @return {boolean}
             */
            (entry) => present.includes(entry.target),
        );
        return present;
    },

    /**
     * @param {object} boot
     * @return {object[]}
     */
    targets(boot) {
        return boot.frames.map(
            /**
             * @param {{ target: object }} entry
             * @return {object}
             */
            (entry) => entry.target,
        );
    },

    /**
     * @param {*} token
     * @return {boolean}
     */
    usable(token) {
        const settings = ScribeBoot.Settings;
        return typeof token === settings.StringType && token.length >= settings.TokenShortest && token.length <= settings.TokenLongest;
    },

    /**
     * @param {object} boot
     * @return {string|null}
     */
    keyed(boot) {
        const messages = ScribeBoot.Settings.Messages;
        const environment = boot.environment;
        const name = ScribeFrame.Bridge.TokenName;
        let token = null;
        let reason = messages.NoStore;
        try {
            const stored = environment.storage.get(name, null);
            if (ScribeBoot.usable(stored)) {
                token = stored;
            } else {
                const made = environment.random();
                if (ScribeBoot.usable(made)) {
                    environment.storage.set(name, made);
                    token = made;
                } else {
                    reason = messages.NoToken;
                }
            }
        } catch {
            token = null;
        }
        if (token === null) {
            if (!boot.unkeyed) {
                ScribeBoot.say(boot, `${messages.NoBridge}${reason}`);
            }
            boot.unkeyed = true;
            return null;
        }
        boot.unkeyed = false;
        boot.bridge = token;
        return token;
    },

    /**
     * @param {object} boot
     * @param {object} target
     * @return {?{ target: object, last: ?object, kept: object[], sends: number[], failed: boolean }}
     */
    remember(boot, target) {
        const known = boot.frames.find(
            /**
             * @param {{ target: object }} entry
             * @return {boolean}
             */
            (entry) => entry.target === target,
        );
        if (known !== undefined) {
            return known;
        }
        if (boot.frames.length >= ScribeBoot.Settings.KeptFrames) {
            return null;
        }
        const entry = { target, last: null, kept: [], sends: [], failed: false };
        boot.frames.push(entry);
        return entry;
    },

    /**
     * @param {*} line
     * @return {string|null}
     */
    fit(line) {
        return typeof line === ScribeBoot.Settings.StringType && line.length <= ScribeFrame.Bridge.LongestLine ? line : null;
    },

    /**
     * @param {object} boot
     * @return {Readonly<{ ready: string|null, suggestion: string|null }>}
     */
    offered(boot) {
        const session = boot.session;
        if (session === null || session.closed || session.live === null || session.keeper.view().reader !== true) {
            return ScribeBoot.Settings.NothingOffered;
        }
        session.live.view();
        const lines = session.live.lines();
        return Object.freeze({ ready: ScribeBoot.fit(lines.ready), suggestion: ScribeBoot.fit(lines.suggestion) });
    },

    /**
     * @param {object} boot
     * @param {{ target: object, last: ?object, kept: object[], failed: boolean }} entry
     * @param {Readonly<{ ready: string|null, suggestion: string|null }>} lines
     * @return {void}
     */
    post(boot, entry, lines) {
        const settings = ScribeBoot.Settings;
        const bridge = ScribeFrame.Bridge;
        const seq = boot.seq + 1;
        const message = {
            [bridge.TagName]: bridge.Tag,
            kind: bridge.Kind.Arm,
            seq,
            token: boot.bridge,
            ready: lines.ready,
            suggestion: lines.suggestion,
        };
        const clone = boot.environment.clone;
        try {
            entry.target.postMessage(clone === null ? message : clone(message), bridge.FrameOrigin);
        } catch (error) {
            if (!entry.failed) {
                ScribeBoot.say(boot, `${settings.Messages.NotArmed}${ScribeBoot.words(error)}`);
            }
            entry.failed = true;
            return;
        }
        entry.failed = false;
        boot.seq = seq;
        const session = boot.session !== null && !boot.session.closed ? boot.session : null;
        const arm = Object.freeze({ seq, ready: lines.ready, suggestion: lines.suggestion, session });
        entry.last = arm;
        entry.kept.push(arm);
        entry.kept.splice(settings.FirstEntry, Math.max(entry.kept.length - settings.KeptArms, settings.FirstEntry));
    },

    /**
     * @param {object} boot
     * @param {object[]} forced
     * @return {void}
     */
    arm(boot, forced) {
        const settings = ScribeBoot.Settings;
        if (boot.frames.length === settings.FirstEntry || boot.arming) {
            return;
        }
        boot.arming = true;
        try {
            ScribeBoot.prune(boot);
            if (boot.frames.length === settings.FirstEntry || ScribeBoot.keyed(boot) === null) {
                return;
            }
            const lines = ScribeBoot.offered(boot);
            for (const entry of boot.frames) {
                const last = entry.last;
                const same = last !== null && last.ready === lines.ready && last.suggestion === lines.suggestion;
                if (!same || forced.includes(entry.target)) {
                    ScribeBoot.post(boot, entry, lines);
                }
            }
        } catch (error) {
            ScribeBoot.say(boot, `${settings.Messages.NotArmed}${ScribeBoot.words(error)}`);
        } finally {
            boot.arming = false;
        }
    },

    /**
     * @param {object} boot
     * @param {{ kept: object[] }} entry
     * @param {{ seq: number, ready: boolean, suggestion: boolean }} report
     * @return {void}
     */
    reported(boot, entry, report) {
        const session = boot.session;
        if (session === null || session.closed) {
            return;
        }
        const kept = entry.kept.find(
            /**
             * @param {{ seq: number }} arm
             * @return {boolean}
             */
            (arm) => arm.seq === report.seq,
        );
        const live = session.live;
        if (kept !== undefined && kept.session === session && live !== null) {
            const lines = Object.freeze({ ready: report.ready ? kept.ready : null, suggestion: report.suggestion ? kept.suggestion : null });
            ScribeBoot.attempt(
                boot,
                ScribeBoot.Settings.Messages.NotTold,
                /**
                 * @return {*}
                 */
                () => live.went(lines),
            );
        }
        ScribeBoot.stir(session);
    },

    /**
     * @param {object} boot
     * @param {{ origin: *, source: *, data: * }} event
     * @return {void}
     */
    hear(boot, event) {
        const bridge = ScribeFrame.Bridge;
        try {
            if (event.isTrusted !== true || event.origin !== bridge.FrameOrigin) {
                return;
            }
            const report = ScribeFrame.report(event.data);
            if (report === null) {
                return;
            }
            const source = event.source;
            if (!ScribeBoot.prune(boot).includes(source)) {
                return;
            }
            const entry = ScribeBoot.remember(boot, source);
            if (entry === null) {
                return;
            }
            if (report.kind === bridge.Kind.Sent) {
                const settings = ScribeBoot.Settings;
                const now = boot.environment.clock.now();
                if (
                    entry.sends.some(
                        /**
                         * @param {number} time
                         * @return {boolean}
                         */
                        (time) => time > now,
                    )
                ) {
                    entry.sends = [];
                }
                entry.sends = entry.sends.filter(
                    /**
                     * @param {number} time
                     * @return {boolean}
                     */
                    (time) => now - time <= settings.SentWindowMs,
                );
                if (entry.sends.length >= settings.SentLimit) {
                    return;
                }
                entry.sends.push(now);
                ScribeBoot.reported(boot, entry, report);
            }
            ScribeBoot.arm(boot, [source]);
        } catch (error) {
            ScribeBoot.say(boot, `${ScribeBoot.Settings.Messages.NotHeard}${ScribeBoot.words(error)}`);
        }
    },

    /**
     * @param {object} session
     * @param {*} path
     * @return {boolean}
     */
    ours(session, path) {
        const settings = ScribeBoot.Settings;
        if (typeof path !== settings.StringType || !path.startsWith(settings.RoomsPath)) {
            return false;
        }
        const segment = path.slice(settings.RoomsPath.length).split(settings.PathStart)[settings.FirstEntry];
        let roomId = null;
        try {
            roomId = decodeURIComponent(segment);
        } catch {
            roomId = null;
        }
        return roomId === session.roomId;
    },

    /**
     * @param {object} session
     * @return {void}
     */
    tick(session) {
        const keeper = session.keeper;
        session.gapping = true;
        session.owed = false;
        ScribeBoot.later(
            session,
            ScribeBoot.Settings.TickGapMs,
            /**
             * @return {void}
             */
            () => {
                session.gapping = false;
                if (session.owed) {
                    ScribeBoot.tick(session);
                }
            },
            null,
        );
        ScribeBoot.contest(session);
        ScribeBoot.arm(session.boot, []);
        ScribeBoot.attempt(
            session.boot,
            ScribeBoot.Settings.Messages.NotChecked,
            /**
             * @return {Promise<void>}
             */
            () => keeper.tick(),
        );
    },

    /**
     * @param {object} session
     * @return {void}
     */
    askTick(session) {
        if (!session.ticking) {
            return;
        }
        if (session.gapping) {
            session.owed = true;
            return;
        }
        ScribeBoot.tick(session);
    },

    /**
     * @param {object} boot
     * @return {boolean}
     */
    hidden(boot) {
        return boot.environment.document.visibilityState === ScribeBoot.Settings.Hidden;
    },

    /**
     * @param {object} session
     * @return {boolean}
     */
    reading(session) {
        return session.keeper !== null && session.keeper.view().phase === ScribeKeeper.Phase.Reading;
    },

    /**
     * @param {object} session
     * @return {Promise<void>}
     */
    hold(session) {
        session.reader = true;
        return new Promise(
            /**
             * @param {Function} release
             * @return {void}
             */
            (release) => {
                session.release = release;
            },
        );
    },

    /**
     * @param {object} session
     * @return {void}
     */
    giveBack(session) {
        session.reader = false;
        if (session.release !== null) {
            const release = session.release;
            session.release = null;
            release();
        }
    },

    /**
     * @param {object} session
     * @return {void}
     */
    withdraw(session) {
        if (session.asking !== null) {
            const asking = session.asking;
            session.asking = null;
            asking.abort();
        }
    },

    /**
     * @param {object} session
     * @param {*} error
     * @return {void}
     */
    rest(session, error) {
        const settings = ScribeBoot.Settings;
        if (!session.warned) {
            session.warned = true;
            ScribeBoot.say(session.boot, `${settings.Messages.NotLocked}${ScribeBoot.words(error)}`);
        }
        session.resting = true;
        ScribeBoot.later(
            session,
            settings.LockRetryMs,
            /**
             * @return {void}
             */
            () => {
                session.resting = false;
                ScribeBoot.look(session);
            },
            null,
        );
    },

    /**
     * @param {object} session
     * @return {void}
     */
    wait(session) {
        const settings = ScribeBoot.Settings;
        const boot = session.boot;
        const environment = boot.environment;
        if (session.closed || session.reader || session.resting || session.asking !== null) {
            return;
        }
        let asking = null;
        let asked = null;
        try {
            asking = new environment.pageWindow.AbortController();
            session.asking = asking;
            asked = environment.locks.request(
                `${settings.LockPrefix}${session.roomId}`,
                { signal: asking.signal },
                /**
                 * @return {Promise<void>|null}
                 */
                () => {
                    if (session.asking === asking) {
                        session.asking = null;
                    }
                    if (session.closed || !session.locking) {
                        return null;
                    }
                    const held = ScribeBoot.hold(session);
                    ScribeBoot.askTick(session);
                    return held;
                },
            );
        } catch (error) {
            session.asking = null;
            ScribeBoot.rest(session, error);
            return;
        }
        Promise.resolve(asked).then(
            null,
            /**
             * @param {*} error
             * @return {void}
             */
            (error) => {
                if (session.asking === asking) {
                    session.asking = null;
                }
                if (!asking.signal.aborted) {
                    ScribeBoot.rest(session, error);
                }
            },
        );
    },

    /**
     * @param {object} session
     * @return {Promise<void>}
     */
    lock(session) {
        const settings = ScribeBoot.Settings;
        const messages = settings.Messages;
        const boot = session.boot;
        return new Promise(
            /**
             * @param {Function} answered
             * @return {void}
             */
            (answered) => {
                let known = false;

                /**
                 * @param {string|null} failure
                 * @return {void}
                 */
                const answer = (failure) => {
                    if (known) {
                        return;
                    }
                    known = true;
                    if (failure !== null) {
                        session.locking = false;
                        ScribeBoot.say(boot, `${messages.NoLock}${failure}`);
                    }
                    answered();
                };
                ScribeBoot.later(
                    session,
                    settings.LockWaitMs,
                    /**
                     * @return {void}
                     */
                    () => {
                        answer(messages.Silent);
                    },
                    /**
                     * @return {void}
                     */
                    () => {
                        answer(null);
                    },
                );
                let asked = null;
                try {
                    asked = boot.environment.locks.request(
                        `${settings.LockPrefix}${session.roomId}`,
                        settings.IfAvailable,
                        /**
                         * @param {object|null} lock
                         * @return {Promise<void>|null}
                         */
                        (lock) => {
                            if (known || session.closed) {
                                answer(null);
                                return null;
                            }
                            session.locking = true;
                            answer(null);
                            if (lock === null) {
                                ScribeBoot.wait(session);
                                return null;
                            }
                            return ScribeBoot.hold(session);
                        },
                    );
                } catch (error) {
                    answer(ScribeBoot.words(error));
                    return;
                }
                Promise.resolve(asked).then(
                    null,
                    /**
                     * @param {*} error
                     * @return {void}
                     */
                    (error) => {
                        answer(ScribeBoot.words(error));
                    },
                );
            },
        );
    },

    /**
     * @param {object} session
     * @return {void}
     */
    look(session) {
        if (!session.closed && session.locking) {
            ScribeBoot.wait(session);
        }
    },

    /**
     * @param {object} session
     * @param {*} state
     * @return {void}
     */
    yieldTo(session, state) {
        const settings = ScribeBoot.Settings;
        const name = `${settings.LockPrefix}${session.roomId}`;
        const pending = state?.pending;
        session.wanted =
            Array.isArray(pending) &&
            pending.some(
                /**
                 * @param {*} request
                 * @return {boolean}
                 */
                (request) => request?.name === name,
            );
        if (!session.wanted || session.closed || session.release === null || !ScribeBoot.hidden(session.boot) || ScribeBoot.reading(session)) {
            return;
        }
        session.wanted = false;
        ScribeBoot.giveBack(session);
        ScribeBoot.wait(session);
    },

    /**
     * @param {object} session
     * @return {void}
     */
    contest(session) {
        const settings = ScribeBoot.Settings;
        const boot = session.boot;
        const locks = boot.environment.locks;
        if (session.closed || !session.locking || session.release === null || !ScribeBoot.hidden(boot) || typeof locks.query !== settings.FunctionType) {
            return;
        }
        let asked = null;
        try {
            asked = locks.query();
        } catch {
            return;
        }
        Promise.resolve(asked)
            .then(
                /**
                 * @param {*} state
                 * @return {void}
                 */
                (state) => {
                    ScribeBoot.yieldTo(session, state);
                },
                /**
                 * @return {null}
                 */
                () => null,
            )
            .then(
                null,
                /**
                 * @param {*} error
                 * @return {void}
                 */
                (error) => {
                    ScribeBoot.say(boot, `${settings.Messages.NotLocked}${ScribeBoot.words(error)}`);
                },
            );
    },

    /**
     * @param {object} session
     * @return {void}
     */
    close(session) {
        const settings = ScribeBoot.Settings;
        const boot = session.boot;
        const timers = boot.environment.timers;
        session.closed = true;
        session.ticking = false;
        if (session.interval !== null) {
            timers.clearInterval(session.interval);
            session.interval = null;
        }
        const endings = [...session.timers.values()];
        for (const timer of session.timers.keys()) {
            timers.clearTimeout(timer);
        }
        session.timers.clear();
        session.held = null;
        for (const part of settings.Parts) {
            const built = session[part.name];
            session[part.name] = null;
            if (built !== null) {
                ScribeBoot.attempt(
                    boot,
                    settings.Messages.NotClosed,
                    /**
                     * @return {*}
                     */
                    () => built[part.ending](),
                );
            }
        }
        ScribeBoot.withdraw(session);
        ScribeBoot.giveBack(session);
        ScribeBoot.repay(session);
        for (const entry of boot.frames) {
            entry.kept = [];
        }
        ScribeBoot.arm(boot, ScribeBoot.targets(boot));
        for (const ended of endings) {
            if (ended !== null) {
                ended();
            }
        }
    },

    /**
     * @param {object} session
     * @return {Promise<void>}
     */
    async begin(session) {
        const settings = ScribeBoot.Settings;
        const messages = settings.Messages;
        const boot = session.boot;
        const environment = boot.environment;
        try {
            if (environment.locks !== null) {
                await ScribeBoot.lock(session);
            }
            if (session.closed) {
                return;
            }

            /**
             * @param {string} url
             * @param {object} init
             * @return {Promise<object>}
             */
            const fetch = (url, init) =>
                boot.pageFetch.call(environment.pageWindow, url, environment.clone === null ? init : environment.clone(init));

            /**
             * @param {number} milliseconds
             * @return {Promise<void>}
             */
            const pause = (milliseconds) => ScribeBoot.pause(session, milliseconds);
            const options = {
                storage: environment.storage,
                roomId: session.roomId,
                tabId: environment.tabId,
                zeta: Object.freeze({
                    /**
                     * @param {(count: number) => void} onPage
                     * @return {Promise<object>}
                     */
                    history: (onPage) =>
                        ZetaSource.history({ fetch, token: ScribeBoot.token(boot), roomId: session.roomId, pause, onPage }),

                    /**
                     * @return {Promise<object>}
                     */
                    newest: () => ZetaSource.newest({ fetch, token: ScribeBoot.token(boot), roomId: session.roomId, pause }),
                }),

                /**
                 * @param {string} role
                 * @param {string} system
                 * @param {string} user
                 * @return {Promise<{ text: string, cost: number }>}
                 */
                ask: (role, system, user) => ScribeBoot.ask(session, role, system, user),
                clock: environment.clock,

                /**
                 * @param {{ kind: string, message?: * }} event
                 * @return {void}
                 */
                notify: (event) => {
                    if (session.closed) {
                        return;
                    }
                    if (event.kind === ScribeKeeper.Event.Reply) {
                        const live = session.live;
                        if (live === null) {
                            session.held = { message: event.message };
                        } else {
                            ScribeBoot.attempt(
                                boot,
                                messages.NotHanded,
                                /**
                                 * @return {*}
                                 */
                                () => live.reply(event.message),
                            );
                        }
                    }
                    ScribeBoot.redraw(session);
                    ScribeBoot.arm(boot, []);
                    if (session.wanted) {
                        ScribeBoot.contest(session);
                    }
                },
            };
            if (session.locking) {
                /**
                 * @return {boolean}
                 */
                options.claim = () => session.reader;
            }
            const keeper = await ScribeKeeper.open(options);
            if (session.closed) {
                ScribeBoot.attempt(
                    boot,
                    messages.NotClosed,
                    /**
                     * @return {*}
                     */
                    () => keeper.close(),
                );
                return;
            }
            session.keeper = keeper;
            const live = ScribeLive.open({
                keeper,
                storage: environment.storage,
                roomId: session.roomId,

                /**
                 * @param {string} role
                 * @param {string} system
                 * @param {string} user
                 * @return {Promise<{ text: string, cost: number }>}
                 */
                ask: (role, system, user) => ScribeBoot.counted(session, role, system, user),
                clock: environment.clock,

                /**
                 * @return {void}
                 */
                notify: () => {
                    ScribeBoot.redraw(session);
                    ScribeBoot.arm(boot, []);
                },
            });
            session.live = live;
            if (session.held !== null) {
                const message = session.held.message;
                session.held = null;
                ScribeBoot.attempt(
                    boot,
                    messages.NotHanded,
                    /**
                     * @return {*}
                     */
                    () => live.reply(message),
                );
            }
            session.panel = ScribePanel.mount({
                document: environment.document,
                keeper,
                live,
                storage: environment.storage,
                confirm: environment.confirm,
                download: environment.download,
                clock: environment.clock,
            });
            session.sender = ScribeSender.attach({
                document: environment.document,
                window: environment.pageWindow,
                ignore: session.panel.host ?? null,

                /**
                 * @param {...*} values
                 * @return {*}
                 */
                outgoing: (...values) => live.outgoing(...values),

                /**
                 * @param {...*} values
                 * @return {*}
                 */
                sent: (...values) => live.sent(...values),
            });
            session.interval = environment.timers.setInterval(
                /**
                 * @return {void}
                 */
                () => {
                    ScribeBoot.askTick(session);
                },
                settings.TickMs,
            );
            session.ticking = true;
            ScribeBoot.arm(boot, ScribeBoot.targets(boot));
        } catch (error) {
            const abandoned = session.closed;
            ScribeBoot.close(session);
            ScribeBoot.say(boot, `${messages.NotStarted}${ScribeBoot.words(error)}`);
            if (!abandoned) {
                boot.retry = environment.timers.setTimeout(
                    /**
                     * @return {void}
                     */
                    () => {
                        boot.retry = null;
                        if (boot.session === session) {
                            boot.session = null;
                            ScribeBoot.follow(boot);
                        }
                    },
                    settings.RetryMs,
                );
            }
        }
    },

    /**
     * @param {object} boot
     * @return {void}
     */
    forget(boot) {
        if (boot.retry !== null) {
            boot.environment.timers.clearTimeout(boot.retry);
            boot.retry = null;
        }
    },

    /**
     * @param {object} boot
     * @return {void}
     */
    follow(boot) {
        const environment = boot.environment;
        try {
            ScribeBoot.token(boot);
            if (environment.document.body === null) {
                return;
            }
            const roomId = ZetaSource.room(environment.pageWindow.location.pathname);
            const current = boot.session;
            if ((current === null ? null : current.roomId) === roomId) {
                if (current !== null) {
                    ScribeBoot.look(current);
                }
                return;
            }
            ScribeBoot.forget(boot);
            if (current !== null) {
                boot.session = null;
                ScribeBoot.close(current);
            }
            if (roomId !== null) {
                const session = {
                    boot,
                    roomId,
                    closed: false,
                    ticking: false,
                    locking: false,
                    reader: false,
                    release: null,
                    asking: null,
                    resting: false,
                    warned: false,
                    wanted: false,
                    keeper: null,
                    live: null,
                    panel: null,
                    sender: null,
                    held: null,
                    interval: null,
                    timers: new Map(),
                    gapping: false,
                    owed: false,
                };
                boot.session = session;
                ScribeBoot.begin(session);
            }
        } catch (error) {
            ScribeBoot.say(boot, `${ScribeBoot.Settings.Messages.NotFollowed}${ScribeBoot.words(error)}`);
        }
    },

    /**
     * @param {Date} date
     * @return {string}
     */
    day(date) {
        const settings = ScribeBoot.Settings;
        return [date.getFullYear(), date.getMonth() + settings.MonthOffset, date.getDate()]
            .map(
                /**
                 * @param {number} part
                 * @return {string}
                 */
                (part) => String(part).padStart(settings.DateDigits, settings.DatePad),
            )
            .join(settings.DateJoint);
    },

    /**
     * @param {{ pageWindow: object, document: object, storage: object, xmlHttpRequest: Function, exporter: Function|null, clone: Function|null, timers: { setTimeout: Function, clearTimeout: Function, setInterval: Function, clearInterval: Function }, clock: { now: () => number, today: () => string }, tabId: string, locks: object|null, confirm: (text: string) => boolean, download: (name: string, text: string) => void, log: (text: string) => void }} environment
     * @return {Readonly<{ stop: () => void }>}
     */
    start(environment) {
        const settings = ScribeBoot.Settings;
        const messages = settings.Messages;
        const boot = {
            environment,
            root: environment.document.documentElement ?? null,
            pageFetch: null,
            watcher: null,
            shield: null,
            visibility: null,
            request: null,
            session: null,
            route: null,
            retry: null,
            tokens: [],
            debts: new Map(),
            listener: null,
            bridge: null,
            unkeyed: false,
            frames: [],
            arming: false,
            seq: 0,
        };
        if (boot.root !== null && boot.root.hasAttribute(settings.Mark)) {
            ScribeBoot.say(boot, messages.Running);
            return Object.freeze({
                /**
                 * @return {void}
                 */
                stop: () => {},
            });
        }
        try {
            boot.pageFetch = environment.pageWindow.fetch;
            boot.watcher = ZetaSource.watch(environment.pageWindow, environment.exporter === null ? undefined : environment.exporter);

            /**
             * @param {object} event
             * @return {void}
             */
            const shield = (event) => {
                ScribeBoot.shield(boot, event);
            };
            for (const type of settings.KeyEvents) {
                environment.pageWindow.addEventListener(type, shield, settings.Capture);
            }
            boot.shield = shield;

            /**
             * @param {{ origin: *, source: *, data: * }} event
             * @return {void}
             */
            const listener = (event) => {
                ScribeBoot.hear(boot, event);
            };
            environment.pageWindow.addEventListener(settings.MessageEvent, listener);
            boot.listener = listener;
        } catch (error) {
            ScribeBoot.say(boot, `${messages.NotWatched}${ScribeBoot.words(error)}`);
        }
        if (boot.root !== null) {
            boot.root.setAttribute(settings.Mark, settings.Nothing);
        }

        /**
         * @return {void}
         */
        const visibility = () => {
            if (boot.session !== null) {
                ScribeBoot.contest(boot.session);
            }
        };
        environment.document.addEventListener(settings.VisibilityEvent, visibility);
        boot.visibility = visibility;
        ScribeBoot.keyed(boot);
        boot.request = ScribeBoot.request(environment.xmlHttpRequest);
        if (boot.watcher !== null) {
            boot.watcher.onTraffic(
                /**
                 * @param {{ method: string, path: string }} traffic
                 * @return {void}
                 */
                (traffic) => {
                    const session = boot.session;
                    if (session !== null && ScribeBoot.ours(session, traffic.path)) {
                        ScribeBoot.stir(session);
                    }
                },
            );
        }
        ScribeBoot.follow(boot);
        boot.route = environment.timers.setInterval(
            /**
             * @return {void}
             */
            () => {
                ScribeBoot.follow(boot);
            },
            settings.RouteMs,
        );
        return Object.freeze({
            /**
             * @return {void}
             */
            stop: () => {
                if (boot.session !== null) {
                    ScribeBoot.close(boot.session);
                    boot.session = null;
                }
                environment.timers.clearInterval(boot.route);
                ScribeBoot.forget(boot);
                if (boot.watcher !== null) {
                    boot.watcher.stop();
                }
                if (boot.shield !== null) {
                    for (const type of settings.KeyEvents) {
                        environment.pageWindow.removeEventListener(type, boot.shield, settings.Capture);
                    }
                    boot.shield = null;
                }
                if (boot.visibility !== null) {
                    environment.document.removeEventListener(settings.VisibilityEvent, boot.visibility);
                    boot.visibility = null;
                }
                if (boot.listener !== null) {
                    environment.pageWindow.removeEventListener(settings.MessageEvent, boot.listener);
                    boot.listener = null;
                }
                if (boot.root !== null) {
                    boot.root.removeAttribute(settings.Mark);
                    boot.root = null;
                }
            },
        });
    },
});
/** @file scribe/page/ScribeStart.js */
switch (
    ScribeFrame.role({
        origin: unsafeWindow.location.origin,
        top: unsafeWindow.top === unsafeWindow,
        ancestors: unsafeWindow.location.ancestorOrigins === undefined ? null : Array.from(unsafeWindow.location.ancestorOrigins),
        parented: unsafeWindow.parent !== unsafeWindow,
    })
) {
    case ScribeFrame.Role.Top:
        ScribeBoot.start({
            pageWindow: unsafeWindow,
            document,
            storage: {
                /**
                 * @param {string} name
                 * @param {*} fallback
                 * @return {*}
                 */
                get: (name, fallback) => GM_getValue(name, fallback),

                /**
                 * @param {string} name
                 * @param {*} value
                 * @return {void}
                 */
                set: (name, value) => {
                    GM_setValue(name, value);
                },

                /**
                 * @param {string} name
                 * @return {void}
                 */
                remove: (name) => {
                    GM_deleteValue(name);
                },

                /**
                 * @return {string[]}
                 */
                list: () => GM_listValues(),
            },
            xmlHttpRequest: GM_xmlhttpRequest,
            exporter:
                typeof exportFunction === ScribeBoot.Settings.FunctionType
                    ? /**
                       * @param {Function} wrapper
                       * @return {Function}
                       */
                      (wrapper) => exportFunction(wrapper, unsafeWindow)
                    : null,
            clone:
                typeof cloneInto === ScribeBoot.Settings.FunctionType
                    ? /**
                       * @param {*} value
                       * @return {*}
                       */
                      (value) => cloneInto(value, unsafeWindow)
                    : null,
            timers: {
                /**
                 * @param {Function} callback
                 * @param {number} delay
                 * @return {number}
                 */
                setTimeout: (callback, delay) => setTimeout(callback, delay),

                /**
                 * @param {number} timer
                 * @return {void}
                 */
                clearTimeout: (timer) => {
                    clearTimeout(timer);
                },

                /**
                 * @param {Function} callback
                 * @param {number} delay
                 * @return {number}
                 */
                setInterval: (callback, delay) => setInterval(callback, delay),

                /**
                 * @param {number} timer
                 * @return {void}
                 */
                clearInterval: (timer) => {
                    clearInterval(timer);
                },
            },
            clock: {
                /**
                 * @return {number}
                 */
                now: () => Date.now(),

                /**
                 * @return {string}
                 */
                today: () => ScribeBoot.day(new Date()),
            },
            tabId: crypto.randomUUID(),

            /**
             * @return {string}
             */
            random: () => crypto.randomUUID(),
            locks: navigator.locks ?? null,

            /**
             * @param {string} text
             * @return {boolean}
             */
            confirm: (text) => window.confirm(text),

            /**
             * @param {string} name
             * @param {string} text
             * @return {void}
             */
            download: (name, text) => {
                const address = URL.createObjectURL(new Blob([text]));
                const link = document.createElement(ScribeBoot.Settings.LinkTag);
                link.href = address;
                link.download = name;
                link.click();
                setTimeout(
                    /**
                     * @return {void}
                     */
                    () => {
                        URL.revokeObjectURL(address);
                    },
                    ScribeBoot.Settings.RevokeMs,
                );
            },

            /**
             * @param {string} text
             * @return {void}
             */
            log: (text) => {
                console.warn(`${ScribeBoot.Settings.LogPrefix}${text}`);
            },
        });
        break;
    case ScribeFrame.Role.Frame:
        ScribeFrame.start({
            window: unsafeWindow,
            document,

            /**
             * @return {*}
             */
            token: () => GM_getValue(ScribeFrame.Bridge.TokenName, null),
        });
        break;
    default:
        break;
}
})();
