const ScribeSetup = Object.freeze({
    Settings: Object.freeze({
        StoryCap: 6000,
        Format: 'zeta-scribe-plot',
        Version: 1,
        FilePrefix: 'zeta-plot-',
        ChatFilePrefix: 'zeta-plot-chat-',
        FileSuffix: '.json',
        MaxSlugLength: 60,
        FallbackSlug: 'plot',
        UnknownPlayer: 'unknown',
        Nothing: '',
        Space: ' ',
        LineBreak: '\n',
        CarriageReturn: '\r',
        SectionSeparator: '\n\n',
        TitleSeparator: ': ',
        BulletPrefix: '- ',
        Hyphen: '-',
        FirstIndex: 0,
        Zero: 0,
        One: 1,
        StringType: 'string',
        ObjectType: 'object',
        Headings: Object.freeze({
            Background: 'BACKGROUND (never a source on its own: no fact, subject, thread or NOW line comes from it alone; the messages and the book are what happened, and where they differ from it they are right):',
            Story: "STORY SETUP (the writer's starting point; the story has moved on since):",
            Profile: "PLAYER CHARACTER PROFILE (the player's own description of their character; trust it for that character):",
            About: 'About:',
            Characters: 'Story characters:',
            Opening: 'Opening:',
            Lore: 'Lore:',
        }),
        Messages: Object.freeze({
            IncompleteChat: 'Chat history is incomplete and cannot be exported.',
        }),

        /**
         * @return {RegExp}
         */
        get UserPlaceholder() {
            return /\{\{user\}\}/gi;
        },

        /**
         * @return {RegExp}
         */
        get LineBreaks() {
            return /(?:\r\n|\r|\n)+/g;
        },

        /**
         * @return {RegExp}
         */
        get UnsafeSlug() {
            return /[^a-z0-9]+/g;
        },

        /**
         * @return {RegExp}
         */
        get EdgeHyphens() {
            return /^-+|-+$/g;
        },

        /**
         * @return {RegExp}
         */
        get TrailingHyphens() {
            return /-+$/g;
        },
    }),

    /**
     * @param {*} player
     * @param {object|null} profile
     * @return {string|null}
     */
    resolvePlayer(player, profile) {
        const settings = ScribeSetup.Settings;
        const unknown =
            typeof ScribeIntake !== 'undefined' && typeof ScribeIntake?.Settings?.UnknownPlayer === settings.StringType
                ? ScribeIntake.Settings.UnknownPlayer.trim().toLowerCase()
                : settings.UnknownPlayer.toLowerCase();
        if (typeof player === settings.StringType) {
            const trimmedPlayer = player.trim();
            if (trimmedPlayer !== settings.Nothing && trimmedPlayer.toLowerCase() !== unknown) {
                return trimmedPlayer;
            }
        }
        if (typeof profile?.name === settings.StringType) {
            const trimmedProfile = profile.name.trim();
            if (trimmedProfile !== settings.Nothing) {
                return trimmedProfile;
            }
        }
        return null;
    },

    /**
     * @param {*} text
     * @param {string|null} playerName
     * @return {*}
     */
    substitute(text, playerName) {
        const settings = ScribeSetup.Settings;
        if (
            typeof text !== settings.StringType ||
            typeof playerName !== settings.StringType ||
            playerName === settings.Nothing
        ) {
            return text;
        }
        return text.replace(settings.UserPlaceholder, () => playerName);
    },

    /**
     * @param {*} text
     * @return {string}
     */
    flatten(text) {
        const settings = ScribeSetup.Settings;
        if (typeof text !== settings.StringType) {
            return settings.Nothing;
        }
        return text.replace(settings.LineBreaks, settings.Space).trim();
    },

    /**
     * @param {*} text
     * @param {number} limit
     * @return {Readonly<{ text: string, shown: number, whole: number }>}
     */
    cap(text, limit = ScribeSetup.Settings.StoryCap) {
        const settings = ScribeSetup.Settings;
        if (typeof text !== settings.StringType) {
            return Object.freeze({ text: settings.Nothing, shown: settings.Zero, whole: settings.Zero });
        }
        const points = Array.from(text);
        const capLimit = Number.isFinite(limit) ? Math.floor(limit) : settings.Zero;
        if (capLimit <= settings.Zero) {
            return Object.freeze({ text: settings.Nothing, shown: settings.Zero, whole: points.length });
        }
        if (points.length <= capLimit) {
            return Object.freeze({ text, shown: points.length, whole: points.length });
        }
        const head = points.slice(settings.FirstIndex, capLimit).join(settings.Nothing);
        const end = head.lastIndexOf(settings.LineBreak);
        let kept = head;
        if (end > settings.FirstIndex) {
            const cut = head.slice(settings.FirstIndex, end);
            const stripped = cut.endsWith(settings.CarriageReturn)
                ? cut.slice(settings.FirstIndex, cut.length - settings.One)
                : cut;
            if (stripped !== settings.Nothing) {
                kept = stripped;
            }
        }
        if (kept.endsWith(settings.CarriageReturn)) {
            kept = kept.slice(settings.FirstIndex, kept.length - settings.One);
        }
        return Object.freeze({ text: kept, shown: Array.from(kept).length, whole: points.length });
    },

    /**
     * @param {object|null} story
     * @param {object|null} profile
     * @param {string} player
     * @return {Readonly<{ text: string|null, storyText: string|null, profileText: string|null, shown: number, whole: number, source: string|null, persona: string|null }>}
     */
    build(story, profile, player = '') {
        const settings = ScribeSetup.Settings;
        const headings = settings.Headings;
        const profileObject = profile !== null && typeof profile === settings.ObjectType && !Array.isArray(profile) ? profile : null;
        const playerName = ScribeSetup.resolvePlayer(player, profileObject);
        const sections = [];
        if (story !== null && typeof story === settings.ObjectType && !Array.isArray(story)) {
            const title = ScribeSetup.flatten(story.name);
            const summary = ScribeSetup.flatten(story.summary);
            if (title !== settings.Nothing && summary !== settings.Nothing) {
                sections.push(`${title}${settings.TitleSeparator}${summary}`);
            } else if (title !== settings.Nothing) {
                sections.push(title);
            } else if (summary !== settings.Nothing) {
                sections.push(summary);
            }
            const description = typeof story.description === settings.StringType ? story.description.trim() : settings.Nothing;
            if (description !== settings.Nothing) {
                sections.push(description);
            }
            const about = typeof story.about === settings.StringType ? story.about.trim() : settings.Nothing;
            if (about !== settings.Nothing) {
                sections.push(`${headings.About}${settings.LineBreak}${about}`);
            }
            if (Array.isArray(story.characters)) {
                const characterLines = [];
                for (const entry of story.characters) {
                    if (entry === null || typeof entry !== settings.ObjectType) {
                        continue;
                    }
                    const entryName = ScribeSetup.flatten(entry.name);
                    if (entryName === settings.Nothing) {
                        continue;
                    }
                    const entryDescription = ScribeSetup.flatten(entry.description);
                    if (entryDescription !== settings.Nothing) {
                        characterLines.push(`${settings.BulletPrefix}${entryName}${settings.TitleSeparator}${entryDescription}`);
                    } else {
                        characterLines.push(`${settings.BulletPrefix}${entryName}`);
                    }
                }
                if (characterLines.length > settings.Zero) {
                    sections.push(`${headings.Characters}${settings.LineBreak}${characterLines.join(settings.LineBreak)}`);
                }
            }
            if (Array.isArray(story.opening)) {
                const openingLines = [];
                for (const entry of story.opening) {
                    if (entry === null || typeof entry !== settings.ObjectType) {
                        continue;
                    }
                    const messageText = ScribeSetup.flatten(entry.text);
                    if (messageText === settings.Nothing) {
                        continue;
                    }
                    const speaker = ScribeSetup.flatten(entry.speaker);
                    if (speaker !== settings.Nothing) {
                        openingLines.push(`${speaker}${settings.TitleSeparator}${messageText}`);
                    } else {
                        openingLines.push(messageText);
                    }
                }
                if (openingLines.length > settings.Zero) {
                    sections.push(`${headings.Opening}${settings.LineBreak}${openingLines.join(settings.LineBreak)}`);
                }
            }
            if (Array.isArray(story.lore)) {
                const loreLines = [];
                for (const entry of story.lore) {
                    if (entry === null || typeof entry !== settings.ObjectType) {
                        continue;
                    }
                    const loreText = ScribeSetup.flatten(entry.text);
                    if (loreText === settings.Nothing) {
                        continue;
                    }
                    const loreName = ScribeSetup.flatten(entry.name);
                    if (loreName !== settings.Nothing) {
                        loreLines.push(`${settings.BulletPrefix}${loreName}${settings.TitleSeparator}${loreText}`);
                    } else {
                        loreLines.push(`${settings.BulletPrefix}${loreText}`);
                    }
                }
                if (loreLines.length > settings.Zero) {
                    sections.push(`${headings.Lore}${settings.LineBreak}${loreLines.join(settings.LineBreak)}`);
                }
            }
        }
        let storyText = null;
        let shown = settings.Zero;
        let whole = settings.Zero;
        if (sections.length > settings.Zero) {
            const rawBody = sections.join(settings.SectionSeparator);
            const substituted = ScribeSetup.substitute(rawBody, playerName);
            const capped = ScribeSetup.cap(substituted, settings.StoryCap);
            storyText = capped.text;
            shown = capped.shown;
            whole = capped.whole;
        }
        const rawProfile = typeof profileObject?.text === settings.StringType ? profileObject.text.trim() : settings.Nothing;
        const profileText = rawProfile === settings.Nothing ? null : rawProfile;
        const profileSource = typeof profileObject?.source === settings.StringType ? profileObject.source.trim() : settings.Nothing;
        const profilePersona = typeof profileObject?.name === settings.StringType ? profileObject.name.trim() : settings.Nothing;
        let text = null;
        if (storyText !== null || profileText !== null) {
            const blocks = [headings.Background];
            if (storyText !== null) {
                blocks.push(`${headings.Story}${settings.LineBreak}${storyText}`);
            }
            if (profileText !== null) {
                blocks.push(`${headings.Profile}${settings.LineBreak}${profileText}`);
            }
            text = blocks.join(settings.SectionSeparator);
        }
        return Object.freeze({
            text,
            storyText,
            profileText,
            shown,
            whole,
            source: profileSource === settings.Nothing ? null : profileSource,
            persona: profilePersona === settings.Nothing ? null : profilePersona,
        });
    },

    /**
     * @param {{ plot?: object|null, roomId?: string|null, roomTitle?: string|null, introId?: string|null, profile?: object|null, notes?: string|null, chat?: { completeHistory: boolean, messages: object[] }|null, exportedAt?: string|null }|null} options
     * @return {object}
     * @throws {Error}
     */
    exportBundle(options = {}) {
        const settings = ScribeSetup.Settings;
        const source = options !== null && typeof options === settings.ObjectType && !Array.isArray(options) ? options : {};
        const {
            plot = null,
            roomId = null,
            roomTitle = null,
            introId = null,
            profile = null,
            notes = null,
            chat = null,
            exportedAt = null,
        } = source;

        /**
         * @param {*} value
         * @return {string|null}
         */
        const nullableString = (value) => (typeof value === settings.StringType ? value : null);

        /**
         * @param {*} value
         * @return {string}
         */
        const stringValue = (value) => (typeof value === settings.StringType ? value : settings.Nothing);

        /**
         * @param {*} value
         * @return {*}
         */
        const clone = (value) => {
            const serialized = JSON.stringify(value);
            return serialized === undefined ? null : JSON.parse(serialized);
        };

        let exportedChat = null;
        if (chat !== null && chat !== undefined) {
            if (
                typeof chat !== settings.ObjectType ||
                Array.isArray(chat) ||
                chat.completeHistory !== true ||
                !Array.isArray(chat.messages)
            ) {
                throw new Error(settings.Messages.IncompleteChat);
            }
            exportedChat = {
                completeHistory: true,
                messageCount: chat.messages.length,
                messages: clone(chat.messages),
            };
        }
        let exportedProfile = null;
        if (profile !== null && typeof profile === settings.ObjectType && !Array.isArray(profile)) {
            exportedProfile = {
                source: nullableString(profile.source),
                name: nullableString(profile.name),
                description: stringValue(profile.description),
            };
        }
        const plotObject = plot !== null && typeof plot === settings.ObjectType && !Array.isArray(plot) ? plot : null;
        const plotId = nullableString(plotObject?.plotId);
        return {
            format: settings.Format,
            version: settings.Version,
            exportedAt: nullableString(exportedAt),
            plotId,
            roomId: nullableString(roomId),
            roomTitle: nullableString(roomTitle),
            introId: nullableString(introId),
            plot: {
                id: plotId,
                name: stringValue(plotObject?.name),
                shortDescription: stringValue(plotObject?.summary),
                longDescription: stringValue(plotObject?.description),
                about: stringValue(plotObject?.about),
                creatorComment: stringValue(plotObject?.creatorComment),
                language: nullableString(plotObject?.language),
                mode: nullableString(plotObject?.mode),
                hashtags: clone(Array.isArray(plotObject?.hashtags) ? plotObject.hashtags : []),
                characters: clone(Array.isArray(plotObject?.characters) ? plotObject.characters : []),
                chatProfiles: clone(Array.isArray(plotObject?.chatProfiles) ? plotObject.chatProfiles : []),
                opening: clone(Array.isArray(plotObject?.opening) ? plotObject.opening : []),
                lore: clone(Array.isArray(plotObject?.lore) ? plotObject.lore : []),
                raw: plotObject?.raw !== undefined && plotObject?.raw !== null ? clone(plotObject.raw) : null,
            },
            profile: exportedProfile,
            notes: nullableString(notes),
            chat: exportedChat,
        };
    },

    /**
     * @param {*} name
     * @param {*} plotId
     * @param {boolean} withChat
     * @return {string}
     */
    filename(name, plotId, withChat = false) {
        const settings = ScribeSetup.Settings;
        let chosen = settings.Nothing;
        for (const candidate of [name, plotId]) {
            if (typeof candidate !== settings.StringType) {
                continue;
            }
            const cleaned = candidate
                .toLowerCase()
                .replace(settings.UnsafeSlug, settings.Hyphen)
                .replace(settings.EdgeHyphens, settings.Nothing)
                .slice(settings.FirstIndex, settings.MaxSlugLength)
                .replace(settings.TrailingHyphens, settings.Nothing);
            if (cleaned !== settings.Nothing) {
                chosen = cleaned;
                break;
            }
        }
        const prefix = withChat === true ? settings.ChatFilePrefix : settings.FilePrefix;
        const slug = chosen === settings.Nothing ? settings.FallbackSlug : chosen;
        return `${prefix}${slug}${settings.FileSuffix}`;
    },
});
