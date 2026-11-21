import assert from 'node:assert/strict';
import test from 'node:test';
import ScribeCore from './support/ScribeCore.mjs';

const { ScribeText, ScribeCategory } = ScribeCore.load(['ScribeText', 'ScribeCategory']);

const spellingTable = [
    ['grey', 'gray'], ['blonde', 'blond'], ['colour', 'color'], ['armour', 'armor'], ['honour', 'honor'],
    ['favour', 'favor'], ['flavour', 'flavor'], ['neighbour', 'neighbor'], ['jewellery', 'jewelry'],
    ['moustache', 'mustache'], ['centre', 'center'], ['metre', 'meter'], ['fibre', 'fiber'],
    ['lustre', 'luster'], ['ochre', 'ocher'], ['pyjama', 'pajama'], ['dishevelled', 'disheveled'],
    ['ageing', 'aging'],
];

/**
 * @param {*} value
 * @return {*}
 */
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

/**
 * @param {*} value
 * @return {boolean}
 */
function isRegularExpression(value) {
    return Object.prototype.toString.call(value) === '[object RegExp]';
}

/**
 * @param {*} value
 * @param {string} path
 * @return {void}
 */
function assertFrozenDeep(value, path) {
    if (value === null || typeof value !== 'object' || isRegularExpression(value)) {
        return;
    }
    assert.equal(Object.isFrozen(value), true, `${path} is not frozen`);
    for (const [key, member] of Object.entries(value)) {
        assertFrozenDeep(member, `${path}.${key}`);
    }
}

const patternSettings = [];
for (const settings of [ScribeText.Settings, ScribeCategory.Settings]) {
    for (const key of Object.keys(settings)) {
        if (isRegularExpression(settings[key])) {
            patternSettings.push({ settings, key });
        }
    }
}

test('a possessive is not a plural', () => {
    assert.equal(ScribeText.normaliseName("Corvane's"), "corvane's");
    assert.equal(ScribeText.normaliseName('The Corvanes'), 'corvanes');
    assert.equal(ScribeText.normaliseName("Orla's"), "orla's");
    assert.equal(ScribeText.normaliseName('Orla’s'), "orla's");
    assert.equal(ScribeText.normaliseName('Orla'), 'orla');
});

test('a full stop becomes a space', () => {
    assert.equal(ScribeText.normaliseName('Unit 1.2'), 'unit 1 2');
    assert.equal(ScribeText.normaliseName('Unit 12'), 'unit 12');
    assert.equal(ScribeText.normaliseName('Mrs. Halloran'), ScribeText.normaliseName('Mrs Halloran'));
    assert.equal(ScribeText.normaliseName('Mrs. Halloran'), 'mrs halloran');
    assert.equal(ScribeText.normaliseName("Orla's."), ScribeText.normaliseName("Orla's"));
    assert.equal(ScribeText.normaliseName('A. Corvane'), 'a corvane');
    assert.equal(ScribeText.normaliseName('...Orla...'), 'orla');
});

test('an inner possessive stays part of the name', () => {
    assert.equal(ScribeText.normaliseName("Orla's Mother"), "orla's mother");
});

test('a name wrapped in single quotes', () => {
    assert.equal(ScribeText.normaliseName("'Orla'"), 'orla');
    assert.equal(ScribeText.normaliseName("' Orla '"), 'orla');
    assert.equal(ScribeText.normaliseName("'Orla's'"), "orla's");
    assert.equal(ScribeText.normaliseName("'The Kar’Athun'"), "kar'athun");
    assert.equal(ScribeText.normaliseName('‘Orla’'), 'orla');
    assert.equal(ScribeText.normaliseName("'Orla"), "'orla");
    assert.equal(ScribeText.normaliseName("Orla'"), "orla'");
    assert.equal(ScribeText.normaliseName("'"), "'");
    assert.equal(ScribeText.normaliseName("''"), '');
});

test('every stripped mark', () => {
    assert.equal(ScribeText.normaliseName('“Orla” "*`#'), 'orla');
});

test('apostrophes are kept in one form', () => {
    for (const raw of ["Kar'Athun", 'Kar’Athun', 'Kar‘Athun', 'Kar´Athun', 'KarʼAthun']) {
        assert.equal(ScribeText.normaliseName(raw), "kar'athun", raw);
    }
    assert.equal(ScribeText.normaliseName('Karathun'), 'karathun');
});

test('honorifics with any dash and any case', () => {
    const raws = [
        'Maren-san', 'Maren-kun', 'Maren-chan', 'Maren-sama', 'MAREN-SAN', 'Maren‑chan', 'Maren–san',
        'Maren‐kun', 'Maren‒sama', 'Maren—chan',
    ];
    for (const raw of raws) {
        assert.equal(ScribeText.normaliseName(raw), 'maren', raw);
    }
});

test('honorifics with the added dashes', () => {
    assert.equal(ScribeText.normaliseName('Maren−san'), 'maren');
    assert.equal(ScribeText.normaliseName('Maren－san'), 'maren');
});

test('an honorific inside a longer name', () => {
    assert.equal(ScribeText.normaliseName("Maren-chan's Mother"), ScribeText.normaliseName("Maren's Mother"));
    assert.equal(ScribeText.normaliseName("Maren's Mother"), "maren's mother");
    assert.equal(ScribeText.normaliseName('Maren-san Corvane'), 'maren corvane');
    assert.equal(ScribeText.normaliseName('Maren-san.'), 'maren');
    assert.equal(ScribeText.normaliseName('Maren-san-kun'), 'maren');
});

test('letters that only look like an honorific stay', () => {
    assert.equal(ScribeText.normaliseName('Susan'), 'susan');
    assert.equal(ScribeText.normaliseName('Chan'), 'chan');
    assert.equal(ScribeText.normaliseName('Maren-sandor'), 'maren-sandor');
    assert.equal(ScribeText.normaliseName('Maren-chan7'), 'maren-chan7');
});

test('only a leading the is dropped', () => {
    assert.equal(ScribeText.normaliseName('The Kar’Athun'), "kar'athun");
    assert.equal(ScribeText.normaliseName('An Li'), 'an li');
    assert.equal(ScribeText.normaliseName('A. Corvane'), 'a corvane');
    assert.equal(ScribeText.normaliseName('Orla the Brandt'), 'orla the brandt');
});

test('the after leading whitespace', () => {
    assert.equal(ScribeText.normaliseName('  The Kar’Athun'), "kar'athun");
    assert.equal(ScribeText.normaliseName('\n The Orla'), 'orla');
});

test('spacing and accents in names', () => {
    assert.equal(ScribeText.normaliseName('  Élodie  Moreau '), 'élodie moreau');
    assert.equal(ScribeText.normaliseName('Zo\u{EB}'), ScribeText.normaliseName('Zoe\u{308}'));
    assert.equal(ScribeText.normaliseName('Li\n\tWen'), 'li wen');
    assert.equal(ScribeText.normaliseName(''), '');
});

test('composed and decomposed letters match', () => {
    assert.deepEqual(plain(ScribeText.words('Zo\u{EB}')), plain(ScribeText.words('Zoe\u{308}')));
});

test('words fold accents, spelling and units', () => {
    assert.deepEqual(plain(ScribeText.words('Slate-grey, BLONDE colour')), ['slate', 'gray', 'blond', 'color']);
    assert.deepEqual(plain(ScribeText.words('Café au lait')), ['cafe', 'au', 'lait']);
    assert.deepEqual(plain(ScribeText.words('180cm')), ['180', 'cm']);
    assert.deepEqual(plain(ScribeText.words('abc123def')), ['abc', '123', 'def']);
});

test('symbols are words', () => {
    assert.deepEqual(plain(ScribeText.words('18+')), ['18', '+']);
    assert.deepEqual(plain(ScribeText.words('+-+')), ['+', '+']);
    assert.equal(ScribeCategory.same('age 18+', 'age 18'), false);
    assert.equal(ScribeCategory.same('human ♀', 'human ♂'), false);
    assert.equal(ScribeCategory.same('~20', '20'), false);
    assert.equal(ScribeCategory.same('£50', '$50'), false);
    assert.equal(ScribeCategory.same('age 18+', 'Age 18 +'), true);
});

test('only Latin accents fold', () => {
    assert.equal(ScribeCategory.same('café', 'cafe'), true);
    assert.equal(ScribeCategory.same('İstanbul', 'istanbul'), true);
    assert.equal(ScribeCategory.same('が', 'か'), false);
    assert.equal(ScribeCategory.same('мой', 'мои'), false);
    assert.equal(ScribeCategory.same('t\u{336}all', 'tall'), false);
    assert.equal(ScribeCategory.same('a\u{301}\u{302}', 'a'), true);
});

test('words returns a read-only list', () => {
    assert.equal(Object.isFrozen(ScribeText.words('teal hair')), true);
    assert.equal(Object.isFrozen(ScribeText.words('')), true);
});

test('spelling fragments are replaced inside a word', () => {
    assert.deepEqual(plain(ScribeText.words('greying greyhound ageing centimetres')), [
        'graying', 'grayhound', 'aging', 'centimeters',
    ]);
});

test('words of empty and punctuation-only input', () => {
    assert.deepEqual(plain(ScribeText.words('')), []);
    assert.deepEqual(plain(ScribeText.words('...!!')), []);
});

test('a short misspelling is flagged', () => {
    assert.equal(ScribeText.resembles('Orrla', 'Orla'), true);
    assert.equal(ScribeText.resembles('Aldrich', 'Aldric'), true);
    assert.equal(ScribeText.resembles('Annette', 'Anette'), true);
});

test('numbered names are not flagged', () => {
    assert.equal(ScribeText.resembles('Sentry 1', 'Sentry 2'), false);
    assert.equal(ScribeText.resembles('Dock Hand 1', 'Dock Hand 2'), false);
    assert.equal(ScribeText.resembles('Dock Hand 12', 'Dock Hand 1'), false);
});

test('different short names are not flagged', () => {
    assert.equal(ScribeText.resembles('Maren', 'Mara'), false);
    assert.equal(ScribeText.resembles('Tov', 'Tiv'), false);
    assert.equal(ScribeText.resembles('Brandt', 'Forest'), false);
});

test('equal names do not resemble', () => {
    assert.equal(ScribeText.resembles('Maren-san', 'Maren'), false);
    assert.equal(ScribeText.resembles('The Corvane', 'Corvane'), false);
    assert.equal(ScribeText.resembles('', ''), false);
});

test('a possessive against the plain name', () => {
    assert.equal(ScribeText.resembles("Maren's", 'Maren'), false);
    assert.equal(ScribeText.resembles('Maren', 'maren'), false);
});

test('the shorter name decides the allowance', () => {
    assert.equal(ScribeText.resembles('Ori', 'Oria'), false);
    assert.equal(ScribeText.resembles('Orla', 'Orlan'), true);
});

test('the hint is simple on purpose', () => {
    assert.equal(ScribeText.resembles('Aldrich', 'Aldwick'), false);
    assert.equal(ScribeText.resembles('Maren', 'Marne'), false);
});

test('long names allow two letters', () => {
    assert.equal(ScribeText.resembles('Mrs. Halloran', 'Mrs. Hallorann'), true);
    assert.equal(ScribeText.resembles('Mrs. Halloran', 'Mrs. Hallorannn'), true);
    assert.equal(ScribeText.resembles('Mrs. Halloran', 'Mrs. Hallorannnn'), false);
    assert.equal(ScribeText.resembles('Mrs. Halloran', 'Mrs. Pennington'), false);
});

test('the length limits sit exactly at their edges', () => {
    assert.equal(ScribeText.resembles('Orla', 'Orlo'), true);
    assert.equal(ScribeText.resembles('Orla', 'Olro'), false);
    assert.equal(ScribeText.resembles('Ori', 'Orl'), false);
    assert.equal(ScribeText.resembles('Forests', 'Forestx'), true);
    assert.equal(ScribeText.resembles('Forests', 'Forexxs'), false);
    assert.equal(ScribeText.resembles('Forester', 'Forestxx'), true);
    assert.equal(ScribeText.resembles('Forester', 'Foresxxx'), false);
});

test('resembles does not depend on order', () => {
    const pairs = [
        ['Orrla', 'Orla'], ['Aldrich', 'Aldric'], ['Annette', 'Anette'], ['Sentry 1', 'Sentry 2'],
        ['Dock Hand 1', 'Dock Hand 2'], ['Maren', 'Mara'], ['Tov', 'Tiv'], ['Brandt', 'Forest'],
        ['Maren', 'maren'], ["Maren's", 'Maren'], ['Mrs. Halloran', 'Mrs. Hallorann'],
        ['Mrs. Halloran', 'Mrs. Pennington'], ['Orla', 'Orlo'], ['Mrs. Halloran', 'Mrs. Hallorannnn'],
        ['Susan', 'Chan'], ['', 'Orla'], ['Aldrich', 'Aldwick'], ['Maren', 'Marne'],
    ];
    for (const [first, second] of pairs) {
        assert.equal(ScribeText.resembles(first, second), ScribeText.resembles(second, first), `${first} / ${second}`);
    }
});

test('distance is Levenshtein', () => {
    assert.equal(ScribeText.distance('', ''), 0);
    assert.equal(ScribeText.distance('', 'abc'), 3);
    assert.equal(ScribeText.distance('abc', ''), 3);
    assert.equal(ScribeText.distance('kitten', 'sitting'), 3);
    assert.equal(ScribeText.distance('ab', 'ba'), 2);
    assert.equal(ScribeText.distance('élodie', 'elodie'), 1);
});

test('same: every form of a British word', () => {
    const pairs = [
        ['greying at the temples', 'graying at the temples'], ['greyish', 'grayish'],
        ['two metres tall', 'two meters tall'], ['185 centimetres', '185 centimeters'],
        ['colours', 'colors'], ['multicoloured', 'multicolored'], ['neighbour', 'neighbor'],
        ['dishevelled', 'disheveled'],
    ];
    for (const [british, american] of pairs) {
        assert.equal(ScribeCategory.same(british, american), true, british);
        assert.equal(ScribeCategory.same(american, british), true, american);
    }
});

test('same: every table entry folds', () => {
    assert.equal(ScribeText.Settings.Spellings.length, 18);
    assert.equal(spellingTable.length, 18);
    for (const [index, [british, american]] of spellingTable.entries()) {
        assert.equal(ScribeText.Settings.Spellings[index].British, british);
        assert.equal(ScribeText.Settings.Spellings[index].American, american);
        assert.equal(ScribeCategory.same(british, american), true, british);
        assert.equal(ScribeCategory.same(british.toUpperCase(), american), true, british);
    }
});

test('same: accents and spacing', () => {
    assert.equal(ScribeCategory.same('café au lait', 'cafe au lait'), true);
    assert.equal(ScribeCategory.same('naïve', 'naive'), true);
    assert.equal(ScribeCategory.same('180cm', '180 cm'), true);
    assert.equal(ScribeCategory.same('1.5 tons', '15 tons'), false);
    assert.equal(ScribeCategory.same('blue green', 'bluegreen'), false);
});

test('same: spelling and punctuation', () => {
    assert.equal(ScribeCategory.same('slate grey', 'Slate gray.'), true);
    assert.equal(ScribeCategory.same('blonde braid', 'blond braid'), true);
    assert.equal(ScribeCategory.same('X-shaped scar', 'x shaped scar'), true);
});

test('same: a negation is not the same', () => {
    assert.equal(ScribeCategory.same('tall', 'not tall'), false);
    assert.equal(ScribeCategory.same('not tall', 'tall'), false);
});

test('same: a part is not the whole', () => {
    assert.equal(ScribeCategory.same('black flecked with gray', 'gray'), false);
    assert.equal(ScribeCategory.same('gray', 'black flecked with gray'), false);
});

test('same: word order matters', () => {
    assert.equal(
        ScribeCategory.same('left eye blue, right eye green', 'left eye green, right eye blue'),
        false,
    );
});

test('same: meaning is not judged', () => {
    assert.equal(ScribeCategory.same('slim', 'slender'), false);
    assert.equal(ScribeCategory.same('twenty', '20'), false);
});

test('same: empty values', () => {
    assert.equal(ScribeCategory.same('', ''), true);
    assert.equal(ScribeCategory.same('', 'tall'), false);
    assert.equal(ScribeCategory.same('tall', ''), false);
    assert.equal(ScribeCategory.same('!!', '...'), true);
});

test('same: repeated and extra words count', () => {
    assert.equal(ScribeCategory.same('tall tall', 'tall'), false);
    assert.equal(ScribeCategory.same('tall', 'tall tall'), false);
    assert.equal(ScribeCategory.same('TALL', 'tall'), true);
});

test('a dirtied pattern changes nothing', () => {
    assert.equal(patternSettings.length > 0, true);
    for (const { settings, key } of patternSettings) {
        const pattern = settings[key];
        pattern.test('hello world');
        pattern.lastIndex = 5;
        pattern.compile('x');
    }
    assert.equal(ScribeCategory.same('teal hair', 'coral hair'), false);
    assert.deepEqual(plain(ScribeText.words('slate grey eyes')), ['slate', 'gray', 'eyes']);
    assert.equal(ScribeText.normaliseName('Mrs. Halloran'), 'mrs halloran');
    assert.equal(ScribeCategory.parse('relation to Orla and Maren').target, 'Orla and Maren');
    assert.equal(ScribeCategory.parse('relation to Orla').target, 'Orla');
    assert.equal(ScribeText.normaliseName('Maren-san'), 'maren');
});

test('each read of a pattern is a fresh object', () => {
    assert.equal(patternSettings.length > 0, true);
    for (const { settings, key } of patternSettings) {
        assert.notEqual(settings[key], settings[key], key);
    }
});

test('removed members stay removed', () => {
    assert.equal(ScribeText.normaliseValue, undefined);
    assert.equal(ScribeText.numbersIn, undefined);
    assert.equal(ScribeCategory.compare, undefined);
    assert.equal(ScribeCategory.Verdict, undefined);
});

test('exact category words only', () => {
    const expected = {
        Fixed: ['kind', 'age', 'eyes', 'hair', 'build', 'skin'],
        Moving: ['status', 'location', 'role'],
        List: ['aka', 'title', 'appearance', 'ability', 'belonging', 'background', 'trait', 'feature', 'rule'],
        Passing: ['condition'],
    };
    let count = 0;
    for (const [kind, words] of Object.entries(expected)) {
        for (const word of words) {
            count++;
            assert.deepEqual(plain(ScribeCategory.parse(word)), { category: word, kind, target: null });
        }
    }
    assert.equal(count, 19);
    for (const category of ['abilities', 'age:', 'knows', 'secret', 'eye', 'hairs', 'eyes hair']) {
        assert.deepEqual(plain(ScribeCategory.parse(category)), { category, kind: 'List', target: null });
    }
    for (const empty of ['', '   ']) {
        assert.equal(ScribeCategory.parse(empty), null);
    }
    assert.deepEqual(plain(ScribeCategory.parse('  EYES \n')), { category: 'eyes', kind: 'Fixed', target: null });
});

test('the model can name categories beyond the suggested vocabulary', () => {
    for (const category of ['name', 'knows']) {
        assert.deepEqual(plain(ScribeCategory.parse(category)), { category, kind: 'List', target: null });
    }
});

test('every relation form', () => {
    const raws = [
        'Relation to Orla', 'relation with Orla', 'relation toward Orla', 'RELATION TOWARDS Orla',
        'toward Orla', 'TOWARDS Orla', '  Relation   To   Orla  ',
    ];
    for (const raw of raws) {
        assert.deepEqual(plain(ScribeCategory.parse(raw)), { category: 'relation', kind: 'Moving', target: 'Orla' }, raw);
    }
});

test('a joint target is kept as written', () => {
    const expected = {
        'relation to Orla and Maren': 'Orla and Maren',
        'relation to Orla, Maren': 'Orla, Maren',
        'relation to Orla & Maren': 'Orla & Maren',
        'toward the Anvil and Ember': 'the Anvil and Ember',
        'relation to Orla:': 'Orla:',
    };
    for (const [raw, target] of Object.entries(expected)) {
        assert.deepEqual(plain(ScribeCategory.parse(raw)), { category: 'relation', kind: 'Moving', target }, raw);
    }
});

test('a category with no explicit target is filed as written', () => {
    for (const raw of ['relation', 'relation to', 'relation with', 'toward', 'towards', 'relation to   ', 'relation of Orla', 'relationto Orla']) {
        assert.deepEqual(plain(ScribeCategory.parse(raw)), { category: raw.trim(), kind: 'List', target: null }, raw);
    }
    assert.equal(ScribeCategory.parse('relation to Island').target, 'Island');
    assert.equal(ScribeCategory.parse('relation to Candor').target, 'Candor');
});

test('a target on two lines is not a relation', () => {
    assert.equal(ScribeCategory.parse('relation to Orla\nMaren'), null);
    assert.equal(ScribeCategory.parse('relation to Orla\nand\nMaren'), null);
});

test('a multi-word target is kept as written', () => {
    assert.equal(ScribeCategory.parse('relation to Mrs. Halloran').target, 'Mrs. Halloran');
    assert.equal(ScribeCategory.parse('relation to  The Kar’Athun ').target, 'The Kar’Athun');
});

test('kind values are the shared ones', () => {
    assert.equal(ScribeCategory.parse('age').kind, ScribeCategory.Kind.Fixed);
    assert.equal(ScribeCategory.parse('role').kind, ScribeCategory.Kind.Moving);
    assert.equal(ScribeCategory.parse('rule').kind, ScribeCategory.Kind.List);
    assert.equal(ScribeCategory.parse('condition').kind, ScribeCategory.Kind.Passing);
    assert.equal(ScribeCategory.parse('toward Orla').kind, ScribeCategory.Kind.Moving);
});

test('results and tables are read-only', () => {
    assertFrozenDeep(ScribeText, 'ScribeText');
    assertFrozenDeep(ScribeCategory, 'ScribeCategory');
    assert.equal(Object.isFrozen(ScribeCategory.Kind), true);
    assert.equal(Object.isFrozen(ScribeCategory.SubjectKinds), true);
    assert.equal(Object.isFrozen(ScribeText.Settings), true);
    assert.equal(Object.isFrozen(ScribeCategory.Settings), true);
    assert.equal(Object.isFrozen(ScribeCategory.Settings.Words.Fixed), true);
    assert.equal(Object.isFrozen(ScribeText.Settings.Spellings), true);
    for (const raw of ['age', 'relation to Orla']) {
        const result = ScribeCategory.parse(raw);
        assert.equal(Object.isFrozen(result), true);
        assert.throws(() => {
            result.category = 'other';
        }, { name: 'TypeError' });
        assert.throws(() => {
            result.target = 'other';
        }, { name: 'TypeError' });
    }
});

test('fingerprint known values', () => {
    assert.equal(ScribeText.fingerprint(''), '811c9dc5');
    assert.equal(ScribeText.fingerprint('a'), 'e40c292c');
    assert.equal(ScribeText.fingerprint('foobar'), 'bf9cf968');
});

test('fingerprint is pinned for non-English text', () => {
    assert.equal(ScribeText.fingerprint('Élodie 東京'), '43e4373e');
    assert.equal(ScribeText.fingerprint('face \u{1F600} end'), '617c7f30');
});

test('fingerprint changes with one character', () => {
    assert.notEqual(ScribeText.fingerprint('a'), ScribeText.fingerprint('b'));
    assert.notEqual(ScribeText.fingerprint('abc'), ScribeText.fingerprint('abd'));
    assert.notEqual(ScribeText.fingerprint('A'), ScribeText.fingerprint('a'));
    assert.equal(ScribeText.fingerprint('same text'), ScribeText.fingerprint('same text'));
    assert.match(ScribeText.fingerprint('x'.repeat(100000)), /^[0-9a-f]{8}$/);
});

test('bytes counts UTF-8', () => {
    assert.equal(ScribeText.bytes('a'), 1);
    assert.equal(ScribeText.bytes('é'), 2);
    assert.equal(ScribeText.bytes('東'), 3);
    assert.equal(ScribeText.bytes('\u{1F600}'), 4);
    assert.equal(ScribeText.bytes(''), 0);
});

test('bytes of a lone surrogate', () => {
    assert.equal(ScribeText.bytes('\uD83D'), 3);
});
