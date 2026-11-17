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
