import assert from 'node:assert/strict';
import test from 'node:test';
import ScribeCore from './support/ScribeCore.mjs';

const { ScribeAnswer } = ScribeCore.load(['ScribeText', 'ScribeCategory', 'ScribeAnswer']);

const factLine = 'Halvard | trait | stubborn | #1';
const sceneBase = ['Day 4', '#12', 'The hall', 'public', 'present: Halvard', 'They talk'];

/**
 * @param {*} value
 * @return {*}
 */
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

/**
 * @param {*} value
 * @param {string} path
 * @return {void}
 */
function assertFrozenDeep(value, path) {
    if (value === null || typeof value !== 'object') {
        return;
    }
    assert.equal(Object.isFrozen(value), true, `${path} is not frozen`);
    for (const [key, child] of Object.entries(value)) {
        assertFrozenDeep(child, `${path}.${key}`);
    }
}

/**
 * @param {string} block
 * @param {string[]} lines
 * @return {*}
 */
function inBlock(block, lines) {
    return plain(ScribeAnswer.parse([`=== ${block}`, ...lines].join('\n')));
}

/**
 * @param {string} block
 * @param {string} line
 * @return {*}
 */
function only(block, line) {
    const result = inBlock(block, [line]);
    assert.equal(result.operations.length + result.refused.length, 1, line);
    assert.deepEqual(result.refused, [], line);
    return result.operations[0];
}

/**
 * @param {string} block
 * @param {string} line
 * @param {string} reason
 * @return {void}
 */
function assertRefused(block, line, reason) {
    const result = inBlock(block, [line]);
    assert.deepEqual(result.operations, [], line);
    assert.deepEqual(result.refused, [{ block, line: line.trim(), reason }], line);
}

/**
 * @param {string[]} fields
 * @param {Object<number, string>} replacements
 * @return {string}
 */
function scene(fields, replacements) {
    return fields.map((field, index) => replacements[index] ?? field).join(' | ');
}

/**
 * @param {string} list
 * @return {string}
 */
function sceneWithPresent(list) {
    return scene(sceneBase, { 4: `present: ${list}` });
}

const fullAnswer = [
    '=== SUBJECTS',
    'Halvard | character',
    '=== NAMES',
    'Aldrich | Aldric | #50',
    '=== FACTS',
    'Halvard | trait | stubborn to a fault | #12',
    '=== CHANGES',
    'F1 | Halvard | location | lives in the mill | #30',
    'F1 | Halvard | eyes | FULLER: pale grey ringed with amber | #31',
    'F1 | Mirelle | relation to Halvard | ENDED: they drank it | #32',
    '=== TOLD',
    'F2 | Halvard | Mirelle | #33',
    '=== SCENES',
    'Day 3 | #10-#14 | The old mill | public | present: Halvard, Mirelle (from #11) | They argue about the river',
    '=== NIGHTS',
    '#15 | they sleep',
    '=== THREADS',
    'OPEN | the missing ledger | #17',
    'CLOSE T3 | the ledger was found | #26',
    '=== QUESTIONS',
    'Does Mirelle trust Halvard? | #18',
].join('\n');

const fullOperations = [
    { type: 'Subject', label: 'Halvard', kind: 'character' },
    { type: 'Alias', name: 'Aldrich', label: 'Aldric', position: 50 },
    {
        type: 'Fact',
        label: 'Halvard',
        category: 'trait',
        target: null,
        text: 'stubborn to a fault',
        position: 12,
        hidden: false,
    },
    {
        type: 'Change',
        fact: 'F1',
        label: 'Halvard',
        category: 'location',
        target: null,
        text: 'lives in the mill',
        position: 30,
    },
    {
        type: 'Refine',
        fact: 'F1',
        label: 'Halvard',
        category: 'eyes',
        target: null,
        text: 'pale grey ringed with amber',
        position: 31,
    },
    {
        type: 'End',
        fact: 'F1',
        label: 'Mirelle',
        category: 'relation',
        target: 'Halvard',
        reason: 'they drank it',
        position: 32,
    },
    { type: 'Told', fact: 'F2', owner: 'Halvard', label: 'Mirelle', position: 33 },
    {
        type: 'Scene',
        day: 3,
        first: 10,
        last: 14,
        place: 'The old mill',
        reach: 'Public',
        present: [
            { label: 'Halvard', from: null, until: null },
            { label: 'Mirelle', from: 11, until: null },
        ],
        summary: 'They argue about the river',
    },
    { type: 'Night', position: 15, marker: 'they sleep' },
    { type: 'ThreadOpen', text: 'the missing ledger', position: 17 },
    { type: 'ThreadClose', thread: 'T3', how: 'the ledger was found', position: 26 },
    { type: 'Question', text: 'Does Mirelle trust Halvard?', position: 18 },
];

test('enumerations carry their own names', () => {
    for (const group of [ScribeAnswer.Reason, ScribeAnswer.Type, ScribeAnswer.Reach]) {
        for (const [name, value] of Object.entries(group)) {
            assert.equal(value, name);
        }
    }
    assert.deepEqual(plain(Object.keys(ScribeAnswer.Reason)), ['Shape', 'Category', 'Citation', 'Name']);
    assert.equal(Object.keys(ScribeAnswer.Type).length, 13);
    assert.deepEqual(plain(Object.keys(ScribeAnswer.Reach)), ['Public', 'Private']);
    assert.deepEqual(plain(ScribeAnswer.Blocks), [
        'SUBJECTS',
        'NAMES',
        'FACTS',
        'CHANGES',
        'TOLD',
        'SCENES',
        'NIGHTS',
        'THREADS',
        'QUESTIONS',
        'CONTRADICTIONS',
    ]);
});

test('a full answer parses', () => {
    const result = plain(ScribeAnswer.parse(fullAnswer));
    assert.deepEqual(result.refused, []);
    assert.deepEqual(result.operations, fullOperations);
});

test('a header in any dress opens its block', () => {
    for (const header of [
        '=== FACTS',
        '=== FACTS ===',
        '===FACTS',
        '=== FACTS:',
        '### FACTS',
        '**FACTS**',
        'FACTS:',
        'facts',
        '1. === FACTS',
        '> === FACTS',
        '​=== FACTS',
        '- === facts ===',
        '**=== FACTS ===**',
    ]) {
        const result = plain(ScribeAnswer.parse(`${header}\n${factLine}`));
        assert.equal(result.operations.length, 1, header);
        assert.equal(result.operations[0].type, 'Fact', header);
        assert.deepEqual(result.refused, [], header);
    }
});

test('a repeated block keeps reading', () => {
    const result = plain(
        ScribeAnswer.parse(
            ['=== FACTS', factLine, '=== THREADS', 'OPEN | a | #2', '=== FACTS', 'Halvard | trait | b | #3'].join('\n'),
        ),
    );
    assert.deepEqual(
        result.operations.map((operation) => operation.type),
        ['Fact', 'ThreadOpen', 'Fact'],
    );
    assert.deepEqual(result.refused, []);
});

test('a header slip never files lines under the wrong block', () => {
    const changeLine = 'F1 | Halvard | location | lives in the mill | #30';
    const toldLine = 'F2 | Halvard | Mirelle | #33';
    const first = plain(ScribeAnswer.parse(['=== CHANGES', changeLine, '### TOLD', toldLine].join('\n')));
    assert.deepEqual(
        first.operations.map((operation) => operation.type),
        ['Change', 'Told'],
    );
    assert.deepEqual(first.refused, []);
    const second = plain(ScribeAnswer.parse(['=== TOLD', toldLine, '**CHANGES**', changeLine].join('\n')));
    assert.deepEqual(
        second.operations.map((operation) => operation.type),
        ['Told', 'Change'],
    );
    assert.deepEqual(second.refused, []);
});

test('an unknown header quarantines its lines', () => {
    for (const trigger of ['=== FACTS are fun', '### TIMELINE', 'Some remark here']) {
        const after = 'Mirelle | trait | proud | #2';
        const result = plain(
            ScribeAnswer.parse(
                ['=== FACTS', factLine, trigger, after, 'no pipe here', '=== THREADS', 'OPEN | the missing ledger | #17'].join(
                    '\n',
                ),
            ),
        );
        assert.deepEqual(
            result.operations.map((operation) => operation.type),
            ['Fact', 'ThreadOpen'],
            trigger,
        );
        assert.deepEqual(
            result.refused,
            [trigger, after, 'no pipe here'].map((line) => ({ block: 'UNKNOWN', line, reason: 'Shape' })),
            trigger,
        );
    }
});

test('preamble', () => {
    const result = plain(
        ScribeAnswer.parse(['Here is the update:', factLine, '=== FACTS', factLine].join('\n')),
    );
    assert.deepEqual(result.refused, [
        { block: 'PREAMBLE', line: 'Here is the update:', reason: 'Shape' },
        { block: 'PREAMBLE', line: factLine, reason: 'Shape' },
    ]);
    assert.equal(result.operations.length, 1);
    assert.equal(result.operations[0].type, 'Fact');
});

test('none lines', () => {
    const skipped = plain(
        ScribeAnswer.parse(
            [
                'None in this stretch.',
                '=== FACTS',
                '(none)',
                '- None',
                'No new facts.',
                'Nothing.',
                '(None this time)',
                factLine,
            ].join('\n'),
        ),
    );
    assert.equal(skipped.operations.length, 1);
    assert.deepEqual(skipped.refused, []);
    for (const line of ['Nonetheless', 'No newcomers arrived', 'Nothing new, but Halvard is proud #1']) {
        assert.deepEqual(inBlock('FACTS', [line]).refused, [{ block: 'UNKNOWN', line, reason: 'Shape' }], line);
    }
    assert.equal(only('FACTS', 'Nonette | age | twelve | #3').label, 'Nonette');
    assert.equal(only('FACTS', 'Nothing | kind | item | #4').type, 'Fact');
    assert.equal(only('FACTS', 'None | kind | item | #4').type, 'Fact');
});

test('hidden on either side of the citation', () => {
    for (const line of [
        'Halvard | background | charged a line of pikes | #40 | hidden',
        'Halvard | background | charged a line of pikes | hidden | #40',
        'Halvard | background | charged a line of pikes | #40 | HIDDEN',
        'Halvard | background | charged a line of pikes | Hidden | #40 | hidden',
    ]) {
        const fact = only('FACTS', line);
        assert.equal(fact.hidden, true, line);
        assert.equal(fact.text, 'charged a line of pikes', line);
        assert.equal(fact.position, 40, line);
    }
    const plainFact = only('FACTS', 'Halvard | background | charged a line of pikes | #40');
    assert.equal(plainFact.hidden, false);
    assert.equal(only('FACTS', 'Halvard | background | hidden fears | #40').hidden, false);
    assertRefused('FACTS', 'Halvard | background | charged a line | #40 | not hidden', 'Shape');
    assertRefused('FACTS', 'Halvard | background | hidden | #40', 'Shape');
    assertRefused('FACTS', 'Halvard | background | charged a line | hidden', 'Shape');
    assertRefused('FACTS', 'Halvard | background | hidden', 'Shape');
});

test('glued records are refused', () => {
    assertRefused('FACTS', 'Halvard | trait | proud | #1 Mirelle | trait | brave | #2', 'Shape');
    assertRefused('FACTS', 'Halvard | trait | proud | #1 | Mirelle | trait | brave | #2', 'Shape');
    assertRefused('CHANGES', 'F1 | Halvard | trait | x | #5 F2 | Mirelle | trait | y | #6', 'Shape');
    assertRefused('CHANGES', 'F1 | Halvard | trait | x | #5 | y | #6', 'Shape');
    assertRefused('THREADS', 'OPEN | a | #5 OPEN | b | #6', 'Shape');
    assertRefused('QUESTIONS', 'Why? | #1 Who? | #2', 'Shape');
    assertRefused('NIGHTS', '#5 | they sleep | #6 | they sleep again', 'Shape');
    assertRefused('SCENES', scene(sceneBase, { 5: 'They talk | #13 | They part' }), 'Shape');
});

test('pipes and markers inside a statement', () => {
    const fact = only('FACTS', 'Halvard | trait | says "a | b" === loudly | #12');
    assert.deepEqual(fact, {
        type: 'Fact',
        label: 'Halvard',
        category: 'trait',
        target: null,
        text: 'says "a | b" === loudly',
        position: 12,
        hidden: false,
    });
    const quoted = only('FACTS', 'Halvard | trait | swore at #12 that he would return | #13');
    assert.equal(quoted.text, 'swore at #12 that he would return');
    assert.equal(quoted.position, 13);
    const leading = only('FACTS', 'Halvard | title | #1 swordsman of the realm | #2');
    assert.equal(leading.text, '#1 swordsman of the realm');
    assert.equal(leading.position, 2);
    assert.equal(only('FACTS', 'Halvard | trait |   says   |  x   | #12').text, 'says | x');
    assert.equal(only('CHANGES', 'F1 | Halvard | trait | one | two | #6').text, 'one | two');
});

test('empty text fields are refused', () => {
    assertRefused('FACTS', 'Halvard | trait |  |  | #1', 'Shape');
    assertRefused('FACTS', 'Halvard | trait | proud || #1', 'Shape');
    assertRefused('FACTS', 'Halvard | trait | | #1', 'Shape');
    assertRefused('CHANGES', 'F1 | Halvard | location || lives in the mill | #5', 'Shape');
    assertRefused('CHANGES', 'F12 | Mirelle | belonging || ENDED: they drank it | #33', 'Shape');
    assertRefused('CHANGES', 'F1 | Halvard | location |  | #5', 'Shape');
    assertRefused('THREADS', 'OPEN |  |  | #1', 'Shape');
    assertRefused('THREADS', 'CLOSE T3 |  | #1', 'Shape');
    assertRefused('QUESTIONS', '| | #1', 'Shape');
    assertRefused('QUESTIONS', '| #88', 'Shape');
    assertRefused('NIGHTS', '#1 | |', 'Shape');
    assertRefused('NIGHTS', '#1 |', 'Shape');
    assertRefused('SCENES', scene(sceneBase, { 5: '' }), 'Shape');
    assertRefused('SCENES', `${scene(sceneBase, { 5: '' })} | `, 'Shape');
});

test('changes: plain, fuller and ended', () => {
    assert.deepEqual(only('CHANGES', 'F12 | Halvard | location | lives in the mill | #30'), {
        type: 'Change',
        fact: 'F12',
        label: 'Halvard',
        category: 'location',
        target: null,
        text: 'lives in the mill',
        position: 30,
    });
    for (const line of [
        'F12 | Halvard | eyes | FULLER: pale grey ringed with amber | #31',
        'F12 | Halvard | eyes | FULLER | pale grey ringed with amber | #31',
        'F12 | Halvard | eyes | FULLER - pale grey ringed with amber | #31',
        'F12 | Halvard | eyes | fuller: pale grey ringed with amber | #31',
    ]) {
        assert.deepEqual(
            only('CHANGES', line),
            {
                type: 'Refine',
                fact: 'F12',
                label: 'Halvard',
                category: 'eyes',
                target: null,
                text: 'pale grey ringed with amber',
                position: 31,
            },
            line,
        );
    }
    for (const [line, reason] of [
        ['f12 | Mirelle | belonging | ended: they drank it | #32', 'they drank it'],
        ['F12 | Mirelle | belonging | ENDED | they drank it | #32', 'they drank it'],
        ['F12 | Mirelle | belonging | ENDED - they drank it | #32', 'they drank it'],
        ['F12 | Mirelle | belonging | ENDED (they drank it) | #32', '(they drank it)'],
        ['F12 | Mirelle | belonging | Ended:   they drank it   | #32', 'they drank it'],
        ['F12 | Mirelle | belonging | ENDED | #33', ''],
        ['F12 | Mirelle | belonging | ENDED: | #33', ''],
        ['F12 | Mirelle | belonging | ENDED: a | b | #33', 'a | b'],
    ]) {
        assert.deepEqual(
            only('CHANGES', line),
            {
                type: 'End',
                fact: 'F12',
                label: 'Mirelle',
                category: 'belonging',
                target: null,
                reason,
                position: Number(line.match(/#(\d+)$/)[1]),
            },
            line,
        );
    }
    for (const line of [
        'F12 | Halvard | eyes | FULLER: | #34',
        'F12 | Halvard | eyes | FULLER | #34',
        'F12 | Halvard | location | ended up in the mill | #33',
        'F12 | Halvard | eyes | fuller in the face now | #33',
        'F12 | Mirelle | belonging | Ended | #33',
        'X12 | Halvard | location | new | #35',
        'F | Halvard | location | new | #35',
        'F12x | Halvard | location | new | #35',
        'F12 | Halvard | location | #35',
    ]) {
        assertRefused('CHANGES', line, 'Shape');
    }
    assert.deepEqual(only('CHANGES', 'F12 | Halvard | trait | ENDEDX is a word | #36'), {
        type: 'Change',
        fact: 'F12',
        label: 'Halvard',
        category: 'trait',
        target: null,
        text: 'ENDEDX is a word',
        position: 36,
    });
    assert.equal(only('CHANGES', 'F12 | Halvard | trait | she was FULLER: x | #33').type, 'Change');
    assertRefused('CHANGES', 'F12 | Halvard | location | new | soon', 'Citation');
    assertRefused('CHANGES', 'F12 | Mirelle | belonging | ENDED | soon', 'Citation');
    assertRefused('CHANGES', 'X12 | Halvard | eyes | FULLER: | soon', 'Shape');
});

test('changes name the subject and the category', () => {
    assert.deepEqual(only('CHANGES', 'F12 | Halvard | location | the mill loft | #33'), {
        type: 'Change',
        fact: 'F12',
        label: 'Halvard',
        category: 'location',
        target: null,
        text: 'the mill loft',
        position: 33,
    });
    assert.deepEqual(only('CHANGES', 'F12 | Halvard | eyes | FULLER: pale grey ringed with amber | #31'), {
        type: 'Refine',
        fact: 'F12',
        label: 'Halvard',
        category: 'eyes',
        target: null,
        text: 'pale grey ringed with amber',
        position: 31,
    });
    assert.deepEqual(only('CHANGES', 'F7 | Mirelle | belonging | ENDED: gave it to Kira | #40'), {
        type: 'End',
        fact: 'F7',
        label: 'Mirelle',
        category: 'belonging',
        target: null,
        reason: 'gave it to Kira',
        position: 40,
    });
    assert.deepEqual(only('CHANGES', 'F7 | Mirelle | belonging | ENDED | #40'), {
        type: 'End',
        fact: 'F7',
        label: 'Mirelle',
        category: 'belonging',
        target: null,
        reason: '',
        position: 40,
    });
    assert.deepEqual(only('CHANGES', 'F3 | Halvard | relation to Mirelle | wary of her now | #52'), {
        type: 'Change',
        fact: 'F3',
        label: 'Halvard',
        category: 'relation',
        target: 'Mirelle',
        text: 'wary of her now',
        position: 52,
    });
    assert.equal(only('CHANGES', 'F12 | **Halvard** | LOCATION | the mill loft | #33').category, 'location');
    assert.equal(only('CHANGES', 'F12 | **Halvard** | LOCATION | the mill loft | #33').label, 'Halvard');
    for (const line of [
        'F12 | the mill loft | #33',
        'F12 | Halvard | the mill loft | #33',
        'F12 | Halvard | location | #33',
        'F12 | Narrator | location | #33',
    ]) {
        assertRefused('CHANGES', line, 'Shape');
    }
    assertRefused('CHANGES', 'F12 | Narrator | location | the mill | #33', 'Name');
    assertRefused('CHANGES', 'F12 |  | location | the mill | #33', 'Name');
    assertRefused('CHANGES', 'F12 | Narrator | mood | sad | soon', 'Name');
    assertRefused('CHANGES', 'F12 | Halvard | mood | sad | #33', 'Category');
    assertRefused('CHANGES', 'F12 | Halvard | mood | sad | soon', 'Category');
    assertRefused('CHANGES', 'F12 | Halvard | relation to | sad | #33', 'Category');
});

test('told lines name the owner', () => {
    assert.deepEqual(only('TOLD', 'F3 | Halvard | Kira | #90'), {
        type: 'Told',
        fact: 'F3',
        owner: 'Halvard',
        label: 'Kira',
        position: 90,
    });
    assert.deepEqual(only('TOLD', 'f3 | *Halvard* | `Kira` | #90'), {
        type: 'Told',
        fact: 'F3',
        owner: 'Halvard',
        label: 'Kira',
        position: 90,
    });
    assertRefused('TOLD', 'F3 | Kira | #90', 'Shape');
    assertRefused('TOLD', 'F3 | Halvard | Kira | Orla | #90', 'Shape');
    assertRefused('TOLD', 'F3 | Narrator | Kira | #90', 'Name');
    assertRefused('TOLD', 'F3 | Halvard | Narrator | #90', 'Name');
    assertRefused('TOLD', 'F3 | Narrator | Kira | soon', 'Name');
    assertRefused('TOLD', 'F3 | Halvard | Kira | soon', 'Citation');
});

test('citation forms', () => {
    for (const field of ['#7', '#7-#9', '#7-9', '#7 – #9', '#7−#9', '#7‐#9', '#7—#9', '[#7]', '#7, #9', '#7 and #9', '#7-#8, #12', '#007']) {
        assert.equal(only('QUESTIONS', `Why? | ${field}`).position, 7, field);
    }
    for (const field of [
        '(#7)',
        'notes',
        '7',
        '#0',
        '#',
        '#7a',
        '#7.',
        '#9-#7',
        '#99999999999999999999',
        '#7,',
        '#7-',
        '#7-#',
        '#0-#5',
        '##7',
        '#7 #8',
        '[[#7]]',
        '[#7',
        '#7 and',
        '#7 band #9',
    ]) {
        assertRefused('QUESTIONS', `Why? | ${field}`, 'Citation');
    }
});

test('a range cites its first number in every form', () => {
    for (const [block, line] of [
        ['NAMES', 'Aldrich | Aldric | #7-#9'],
        ['FACTS', 'Halvard | trait | proud | #7-#9'],
        ['CHANGES', 'F1 | Halvard | trait | x | #7-#9'],
        ['CHANGES', 'F1 | Halvard | trait | FULLER: x | #7-#9'],
        ['CHANGES', 'F1 | Halvard | trait | ENDED: x | #7-#9'],
        ['TOLD', 'F1 | Halvard | Mirelle | #7-#9'],
        ['NIGHTS', '#7-#9 | they sleep'],
        ['THREADS', 'OPEN | the missing ledger | #7-#9'],
        ['THREADS', 'CLOSE T1 | the ledger was found | #7-#9'],
        ['QUESTIONS', 'Why? | #7-#9'],
    ]) {
        assert.equal(only(block, line).position, 7, line);
    }
});

test('unsafe numbers are refused', () => {
    const huge = '9'.repeat(400);
    assertRefused('QUESTIONS', 'Why? | #9007199254740993', 'Citation');
    assert.equal(only('QUESTIONS', 'Why? | #9007199254740991').position, 9007199254740991);
    assertRefused('QUESTIONS', `Why? | #${huge}`, 'Citation');
    assertRefused('QUESTIONS', `Why? | #1-#${huge}`, 'Citation');
    assertRefused('SCENES', scene(sceneBase, { 0: `Day ${huge}` }), 'Shape');
    assertRefused('SCENES', sceneWithPresent(`Halvard (from #${huge})`), 'Shape');
    assertRefused('SCENES', sceneWithPresent(`Halvard (until #${huge})`), 'Shape');
});

test('unknown category refuses only that line', () => {
    const result = inBlock('FACTS', [
        factLine,
        'Halvard | knows | the way | #2',
        'Mirelle | trait | proud | #3',
    ]);
    assert.deepEqual(
        result.operations.map((operation) => operation.position),
        [1, 3],
    );
    assert.deepEqual(result.refused, [{ block: 'FACTS', line: 'Halvard | knows | the way | #2', reason: 'Category' }]);
    assertRefused('FACTS', 'Halvard |  | the way | #2', 'Category');
});

test('labels', () => {
    for (const label of ['Narrator', 'the narrator', 'THE NARRATOR', '', '?', '***', '**Narrator**', 'A'.repeat(61)]) {
        assertRefused('FACTS', `${label} | trait | proud | #1`, 'Name');
        assertRefused('SUBJECTS', `${label} | character`, 'Name');
        assertRefused('TOLD', `F1 | Halvard | ${label} | #1`, 'Name');
        assertRefused('TOLD', `F1 | ${label} | Kira | #1`, 'Name');
        assertRefused('CHANGES', `F1 | ${label} | trait | proud | #1`, 'Name');
        assertRefused('NAMES', `${label} | Aldric | #1`, 'Name');
        assertRefused('NAMES', `Aldrich | ${label} | #1`, 'Name');
    }
    const long = 'A'.repeat(60);
    assert.equal(only('FACTS', `${long} | trait | proud | #1`).label, long);
    for (const written of ['**Halvard**', '*Halvard*', '`Halvard`', '_Halvard_', 'Hal‍vard', '​Halvard']) {
        assert.equal(only('FACTS', `${written} | trait | proud | #1`).label, 'Halvard', written);
    }
    assert.equal(only('FACTS', 'Halvard and Mirelle | trait | proud | #1').label, 'Halvard and Mirelle');
    assert.equal(only('FACTS', 'Halvard, Mirelle | trait | proud | #1').label, 'Halvard, Mirelle');
    assert.equal(only('SUBJECTS', 'Halvard, Mirelle | group').label, 'Halvard, Mirelle');
    assert.equal(only('FACTS', 'The Narrator Guild | trait | proud | #1').label, 'The Narrator Guild');
    assert.equal(only('FACTS', 'Halvard (the *tall* one) | trait | proud | #1').label, 'Halvard (the *tall* one)');
    assert.equal(only('NAMES', '**Aldrich** | *Aldric* | #1').name, 'Aldrich');
    assert.equal(only('NAMES', '**Aldrich** | *Aldric* | #1').label, 'Aldric');
});

test('list markers are not part of a label', () => {
    for (const marker of ['1. ', '2) ', '+ ', '• ', '> ', '- - ', '* - 12. ', '- ']) {
        assert.equal(only('FACTS', `${marker}Halvard | trait | proud | #1`).label, 'Halvard', marker);
    }
});

test('relation target', () => {
    const relation = only('FACTS', 'Mirelle | relation to Halvard | sworn allies | #61');
    assert.equal(relation.category, 'relation');
    assert.equal(relation.target, 'Halvard');
    assert.equal(relation.text, 'sworn allies');
    assert.equal(relation.position, 61);
    const joint = only('FACTS', 'Mirelle | relation to Halvard and Tamsin | trusts them | #62');
    assert.equal(joint.category, 'relation');
    assert.equal(joint.target, 'Halvard and Tamsin');
    assert.equal(only('FACTS', 'Mirelle | trait | sworn allies | #63').target, null);
    assertRefused('FACTS', 'Mirelle | relation to | sworn allies | #64', 'Category');
});

test('names block', () => {
    assert.deepEqual(only('NAMES', 'Aldrich | Aldric | #50'), {
        type: 'Alias',
        name: 'Aldrich',
        label: 'Aldric',
        position: 50,
    });
    assertRefused('NAMES', 'Aldrich | #50', 'Shape');
    assertRefused('NAMES', 'Aldrich | Aldric | #50 | #51', 'Shape');
    assertRefused('NAMES', 'Narrator | Aldric | #50', 'Name');
    assertRefused('NAMES', 'Aldrich | Aldric | soon', 'Citation');
    assertRefused('NAMES', 'Narrator | Aldric | soon', 'Name');
});

test('subjects block', () => {
    assert.deepEqual(only('SUBJECTS', 'Halvard | CHARACTER'), { type: 'Subject', label: 'Halvard', kind: 'character' });
    for (const kind of ['character', 'group', 'place', 'item', 'world']) {
        assert.equal(only('SUBJECTS', `Corvane | ${kind}`).kind, kind);
    }
    assertRefused('SUBJECTS', 'Halvard | person', 'Shape');
    assertRefused('SUBJECTS', 'Halvard | character | extra', 'Shape');
    assertRefused('SUBJECTS', 'Narrator | person', 'Shape');
    assertRefused('SUBJECTS', 'Narrator | character', 'Name');
});

test('told block', () => {
    assert.deepEqual(only('TOLD', 'f7 | Halvard | Mirelle | #12'), {
        type: 'Told',
        fact: 'F7',
        owner: 'Halvard',
        label: 'Mirelle',
        position: 12,
    });
    assertRefused('TOLD', 'F7 | Halvard | Mirelle', 'Shape');
    assertRefused('TOLD', 'G7 | Halvard | Mirelle | #12', 'Shape');
    assertRefused('TOLD', 'F7 | Halvard | Mirelle | #12 | extra', 'Shape');
    assertRefused('TOLD', 'F7 | Halvard | Mirelle | later', 'Citation');
});

test('questions block', () => {
    assert.deepEqual(only('QUESTIONS', 'Does Mirelle like Halvard | or love him? | #88'), {
        type: 'Question',
        text: 'Does Mirelle like Halvard | or love him?',
        position: 88,
    });
    assertRefused('QUESTIONS', 'Does Mirelle like Halvard | or love him?', 'Citation');
    assertRefused('QUESTIONS', 'Halvard | trait | #2 | #1', 'Shape');
});

test('nights forms', () => {
    const expected = { type: 'Night', position: 80, marker: 'they sleep at the inn' };
    assert.deepEqual(only('NIGHTS', '#80 | they sleep at the inn'), expected);
    assert.deepEqual(only('NIGHTS', '#80: they sleep at the inn'), expected);
    assert.deepEqual(only('NIGHTS', '#80:they sleep at the inn'), expected);
    assert.deepEqual(only('NIGHTS', '#80: they sleep: at the inn'), { ...expected, marker: 'they sleep: at the inn' });
    assert.deepEqual(only('NIGHTS', '#15 | they sleep | in the loft'), {
        type: 'Night',
        position: 15,
        marker: 'they sleep | in the loft',
    });
    for (const line of ['#80:', '80: they sleep', '#80 : they sleep', '#80, #81: they sleep', 'night | they sleep']) {
        const result = inBlock('NIGHTS', [line]);
        assert.deepEqual(result.operations, [], line);
        assert.equal(result.refused.length, 1, line);
    }
    assertRefused('NIGHTS', 'night | they sleep', 'Citation');
});

test('a night line with a colon only counts in the nights block', () => {
    const result = plain(ScribeAnswer.parse('=== FACTS\n#80: facts\nHalvard | trait | proud | #3'));
    assert.deepEqual(result.operations, []);
    assert.equal(result.refused.length, 2);
    const inNights = plain(ScribeAnswer.parse('=== NIGHTS\n#80: facts\n=== FACTS\n#80: facts'));
    assert.deepEqual(inNights.operations, [{ type: 'Night', position: 80, marker: 'facts' }]);
    assert.deepEqual(inNights.refused, [{ block: 'UNKNOWN', line: '#80: facts', reason: 'Shape' }]);
    const nightsOnly = plain(ScribeAnswer.parse('=== NIGHTS\n#80: facts'));
    assert.deepEqual(nightsOnly.operations, [{ type: 'Night', position: 80, marker: 'facts' }]);
    assert.deepEqual(nightsOnly.refused, []);
});

test('digits do not make a header', () => {
    for (const line of ['#80: facts', '12 FACTS', 'FACTS 3']) {
        const result = plain(ScribeAnswer.parse(['=== THREADS', line, factLine].join('\n')));
        assert.deepEqual(result.operations, [], line);
        assert.deepEqual(
            result.refused,
            [line, factLine].map((entry) => ({ block: 'UNKNOWN', line: entry, reason: 'Shape' })),
            line,
        );
    }
    const preamble = plain(ScribeAnswer.parse(`12 FACTS\n${factLine}`));
    assert.deepEqual(
        preamble.refused.map((entry) => entry.block),
        ['PREAMBLE', 'PREAMBLE'],
    );
});

test('scene attendance bounds', () => {
    const hall = only('SCENES', sceneWithPresent('Halvard, King Aldric (from #251), Isolde (until #260)'));
    assert.deepEqual(hall.present, [
        { label: 'Halvard', from: null, until: null },
        { label: 'King Aldric', from: 251, until: null },
        { label: 'Isolde', from: null, until: 260 },
    ]);
    assert.equal(hall.reach, 'Public');
    assert.equal(hall.first, 12);
    assert.equal(hall.last, 12);
    assert.equal(hall.day, 4);
    for (const bounds of [
        '(from #11, until #13)',
        '(from #11 until #13)',
        '(from #11) (until #13)',
        '(until #13) (from #11)',
        '(FROM #11) (UNTIL #13)',
        '( from #11 ,  until #13 )',
        '(from #11)(until #13)',
    ]) {
        const present = only('SCENES', sceneWithPresent(`Halvard ${bounds}`)).present;
        assert.deepEqual(present, [{ label: 'Halvard', from: 11, until: 13 }], bounds);
    }
    const range = only('SCENES', scene([...sceneBase, 'at length'], { 1: '#12-#14', 3: 'PRIVATE' }));
    assert.equal(range.reach, 'Private');
    assert.equal(range.first, 12);
    assert.equal(range.last, 14);
    assert.equal(range.summary, 'They talk | at length');
    assert.deepEqual(only('SCENES', sceneWithPresent('Isolde ( from #3 ) ,, Orla')).present, [
        { label: 'Isolde', from: 3, until: null },
        { label: 'Orla', from: null, until: null },
    ]);
});

test('scene labels with brackets', () => {
    const brackets = only('SCENES', sceneWithPresent("Oswin (Tamsin's uncle) (from #251), Oswin (tall, grey)"));
    assert.deepEqual(brackets.present, [
        { label: "Oswin (Tamsin's uncle)", from: 251, until: null },
        { label: 'Oswin (tall, grey)', from: null, until: null },
    ]);
    for (const list of ['', 'none', 'NONE', '(none)', 'nobody', 'No one']) {
        assert.deepEqual(only('SCENES', sceneWithPresent(list)).present, [], list);
    }
    assert.deepEqual(only('SCENES', sceneWithPresent('Nonette')).present, [{ label: 'Nonette', from: null, until: null }]);
    assertRefused('SCENES', sceneWithPresent('Halvard, Narrator'), 'Name');
    assertRefused('SCENES', sceneWithPresent('Halvard, (from #3)'), 'Name');
    assertRefused('SCENES', sceneWithPresent('Halvard, Narrator (from #3)'), 'Name');
    assertRefused('SCENES', sceneWithPresent('Halvard, **Narrator**'), 'Name');
});

test('attendance that could make a wrong name is refused', () => {
    for (const list of [
        'Halvard (from 11)',
        'Halvard (#11-#13)',
        'Halvard (arrives #14)',
        'Halvard [from #14]',
        'Halvard from #14',
        'Halvard (from #16) (the tall one)',
        'Halvard (from #0)',
        'Halvard (until #0)',
        'Halvard (from #14) (from #16)',
        'Halvard (until #14) (until #18)',
        'Halvard (from #14, until #15) (from #16)',
        'Halvard, Oswin (tall, Mirelle',
        'Oswin (tall, grey)), Orla',
        ')Halvard, Mirelle',
        'Halvard (from #14',
        'Halvard #14',
    ]) {
        assertRefused('SCENES', sceneWithPresent(list), 'Shape');
    }
    assertRefused('SCENES', sceneWithPresent('Narrator (tall, grey)), Orla'), 'Shape');
});

test('scene shape faults', () => {
    assert.equal(only('SCENES', sceneBase.join(' | ')).type, 'Scene');
    for (const day of ['Day two', 'Day 4 evening', 'Day 0', 'Day', 'Tuesday 4', '', 'Day 99999999999999999999', 'Day -4']) {
        assertRefused('SCENES', scene(sceneBase, { 0: day }), 'Shape');
    }
    assert.equal(only('SCENES', scene(sceneBase, { 0: 'dAy   12' })).day, 12);
    assertRefused('SCENES', scene(sceneBase, { 2: '' }), 'Shape');
    assertRefused('SCENES', scene(sceneBase, { 3: 'open' }), 'Shape');
    assertRefused('SCENES', scene(sceneBase, { 4: 'Halvard' }), 'Shape');
    assertRefused('SCENES', sceneBase.slice(0, 5).join(' | '), 'Shape');
    assertRefused('SCENES', scene(sceneBase, { 5: '' }), 'Shape');
    for (const range of ['12-14', '#20-#12', '#12, #14', 'x', '#0']) {
        assertRefused('SCENES', scene(sceneBase, { 1: range }), 'Citation');
    }
    assertRefused('SCENES', scene(sceneBase, { 1: '12-14', 4: 'present: Narrator' }), 'Name');
    assertRefused('SCENES', scene(sceneBase, { 1: '12-14', 3: 'open' }), 'Shape');
    assertRefused('SCENES', scene(sceneBase, { 1: '12-14', 4: 'present: Halvard (from #0)' }), 'Shape');
});

test('threads forms', () => {
    assert.deepEqual(only('THREADS', 'open | the missing ledger | #17'), {
        type: 'ThreadOpen',
        text: 'the missing ledger',
        position: 17,
    });
    assert.deepEqual(only('THREADS', 'close t3 | the ledger was found | #26'), {
        type: 'ThreadClose',
        thread: 'T3',
        how: 'the ledger was found',
        position: 26,
    });
    assert.equal(only('THREADS', 'OPEN | a | b | #1').text, 'a | b');
    assert.equal(only('THREADS', 'CLOSE   T12 | a | b | #1').how, 'a | b');
    for (const line of [
        'CLOSE | how | #1',
        'REOPEN T3 | how | #1',
        'REOPEN | how | #1',
        'CLOSE T3x | how | #1',
        'CLOSE T | how | #1',
        'OPEN T3 | how | #1',
        'OPENED | how | #1',
        'OPEN | #1',
        'OPEN |  | #1',
    ]) {
        assertRefused('THREADS', line, 'Shape');
    }
    assertRefused('THREADS', 'OPEN | text | soon', 'Citation');
    assertRefused('THREADS', 'CLOSE T3 | how | soon', 'Citation');
});

test('a line in the wrong block is refused', () => {
    assertRefused('SUBJECTS', factLine, 'Shape');
    assertRefused('FACTS', 'Halvard | character', 'Shape');
    assertRefused('FACTS', 'OPEN | the missing ledger | #17', 'Shape');
    assertRefused('TOLD', factLine, 'Shape');
    assertRefused('THREADS', factLine, 'Shape');
    assertRefused('NAMES', 'F1 | Mirelle | #3 | #4', 'Shape');
});

test('several faults report the first in order', () => {
    assertRefused('FACTS', 'Narrator | knows | the way | soon', 'Name');
    assertRefused('FACTS', 'Halvard | knows | the way | soon', 'Category');
    assertRefused('FACTS', 'Halvard | trait | the way | soon', 'Citation');
    assertRefused('FACTS', 'Narrator | knows |  | soon', 'Shape');
    assertRefused('FACTS', 'Narrator | knows | soon', 'Shape');
    assertRefused('TOLD', 'F1 | Halvard | Narrator | soon', 'Name');
    assertRefused('TOLD', 'F1 | Narrator | Mirelle | soon', 'Name');
    assertRefused('TOLD', 'F1 | Halvard | Mirelle | soon', 'Citation');
    assertRefused('NAMES', 'Narrator | Aldric | soon', 'Name');
    assertRefused('CHANGES', 'F1 | Narrator | mood | x | soon', 'Name');
    assertRefused('CHANGES', 'F1 | Halvard | mood | x | soon', 'Category');
    assertRefused('CHANGES', 'F1 | Halvard | trait | x | soon', 'Citation');
    assertRefused('CHANGES', 'F1 | Narrator | mood |  | soon', 'Shape');
});

test('line endings, bullets and fences', () => {
    const expected = plain(ScribeAnswer.parse(fullAnswer));
    assert.equal(expected.operations.length, 12);
    assert.deepEqual(expected.refused, []);
    assert.deepEqual(plain(ScribeAnswer.parse(fullAnswer.replaceAll('\n', '\r\n'))), expected);
    assert.deepEqual(plain(ScribeAnswer.parse(fullAnswer.replaceAll('\n', '\r'))), expected);
    const bulleted = fullAnswer
        .split('\n')
        .map((line, index) => (index % 2 === 0 ? `- ${line}` : `* ${line}`))
        .join('\r\n');
    assert.deepEqual(plain(ScribeAnswer.parse(bulleted)), expected);
    const bold = fullAnswer
        .split('\n')
        .map((line) => `  - **${line}**  `)
        .join('\n');
    assert.deepEqual(plain(ScribeAnswer.parse(bold)), expected);
    assert.deepEqual(plain(ScribeAnswer.parse(`\`\`\`text\n${fullAnswer}\n\`\`\``)), expected);
    assert.deepEqual(plain(ScribeAnswer.parse(`\`\`\`\n\n${fullAnswer.replaceAll('\n', '\r\n')}\r\n\r\n\`\`\`\r\n`)), expected);
    const twoWords = plain(ScribeAnswer.parse('```text more\n=== FACTS'));
    assert.deepEqual(twoWords.refused, [{ block: 'PREAMBLE', line: '```text more', reason: 'Shape' }]);
});

test('prepared lines are what refusals carry', () => {
    const result = plain(
        ScribeAnswer.parse('=== FACTS\n  - **Halvard | knows | the way | #1**  \n   Halvard | knows | x | #2   '),
    );
    assert.deepEqual(
        result.refused.map((entry) => entry.line),
        ['Halvard | knows | the way | #1', 'Halvard | knows | x | #2'],
    );
    assert.deepEqual(plain(ScribeAnswer.parse('=== FACTS\n**')).refused, [
        { block: 'UNKNOWN', line: '**', reason: 'Shape' },
    ]);
});

test('empty answer', () => {
    assert.deepEqual(plain(ScribeAnswer.parse('')), { operations: [], refused: [] });
    assert.deepEqual(plain(ScribeAnswer.parse('\n  \r\n\t\n​\n')), { operations: [], refused: [] });
});

test('operations come out in line order across blocks', () => {
    const result = plain(
        ScribeAnswer.parse(
            ['=== QUESTIONS', 'Why? | #1', '=== SUBJECTS', 'Halvard | character', '=== QUESTIONS', 'Who? | #2'].join('\n'),
        ),
    );
    assert.deepEqual(
        result.operations.map((operation) => operation.type),
        ['Question', 'Subject', 'Question'],
    );
});

test('results are read-only', () => {
    const result = ScribeAnswer.parse(`${fullAnswer}\nstray line\n=== NOPE`);
    assert.equal(result.operations.length, 12);
    assert.equal(result.refused.length, 2);
    assertFrozenDeep(result, 'result');
    const sceneOperation = result.operations.find((operation) => operation.type === 'Scene');
    const typeError = { name: 'TypeError' };
    assert.throws(() => result.operations.push({}), typeError);
    assert.throws(() => result.refused.push({}), typeError);
    assert.throws(() => {
        result.operations[0].label = 'changed';
    }, typeError);
    assert.throws(() => {
        sceneOperation.present[0].label = 'changed';
    }, typeError);
    assert.throws(() => {
        sceneOperation.present.push({});
    }, typeError);
    assert.throws(() => {
        result.refused[0].reason = 'changed';
    }, typeError);
    assertFrozenDeep(ScribeAnswer.parse(''), 'empty');
});

test('hidden in any dress, either side', () => {
    for (const mark of ['`hidden`', '*hidden*', '**hidden**', '(hidden)', '[hidden]', 'hidden.', 'HIDDEN:']) {
        for (const line of [
            `Halvard | background | charged a line of pikes | ${mark} | #40`,
            `Halvard | background | charged a line of pikes | #40 | ${mark}`,
        ]) {
            assert.deepEqual(
                only('FACTS', line),
                {
                    type: 'Fact',
                    label: 'Halvard',
                    category: 'background',
                    target: null,
                    text: 'charged a line of pikes',
                    position: 40,
                    hidden: true,
                },
                line,
            );
        }
    }
});

test('hidden outside its place is refused', () => {
    assertRefused('CHANGES', 'F12 | Halvard | location | now sleeps in the cellar | hidden | #33', 'Shape');
    assertRefused('THREADS', 'OPEN | the missing ledger | hidden | #17', 'Shape');
    assertRefused('NIGHTS', '#80 | they sleep | hidden', 'Shape');
    assertRefused('FACTS', 'Halvard | background | hidden | charged a line of pikes | #40', 'Shape');
    assertRefused('QUESTIONS', 'Who? | **Hidden** | #3', 'Shape');
});

test('ended and fuller in any dress', () => {
    for (const [statement, reason] of [
        ['**ENDED**: they drank it', 'they drank it'],
        ['`ENDED:` they drank it', 'they drank it'],
        ['`ENDED`', ''],
        ['*ENDED*', ''],
        ['_ENDED_: they drank it', 'they drank it'],
        ['[ENDED] they drank it', 'they drank it'],
        ['(ENDED) they drank it', 'they drank it'],
        ['"ENDED: they drank it"', 'they drank it'],
        ['- ENDED: they drank it', 'they drank it'],
        ['ENDED — they drank it', 'they drank it'],
        ['ENDED. they drank it', 'they drank it'],
        ['ENDED; they drank it', 'they drank it'],
        ['**Ended**: they drank it', 'they drank it'],
    ]) {
        assert.deepEqual(
            only('CHANGES', `F12 | Mirelle | belonging | ${statement} | #33`),
            { type: 'End', fact: 'F12', label: 'Mirelle', category: 'belonging', target: null, reason, position: 33 },
            statement,
        );
    }
    for (const statement of [
        '**FULLER**: pale grey ringed with amber',
        '`FULLER:` pale grey ringed with amber',
        '[FULLER] pale grey ringed with amber',
    ]) {
        assert.deepEqual(
            only('CHANGES', `F12 | Halvard | eyes | ${statement} | #34`),
            {
                type: 'Refine',
                fact: 'F12',
                label: 'Halvard',
                category: 'eyes',
                target: null,
                text: 'pale grey ringed with amber',
                position: 34,
            },
            statement,
        );
    }
    assertRefused('CHANGES', 'F12 | Halvard | location | *ended* up in the mill | #33', 'Shape');
    assertRefused('CHANGES', 'F12 | Mirelle | belonging | ENDED: ?! | #33', 'Shape');
    assert.equal(only('CHANGES', 'F12 | Halvard | trait | ENDED2 is a word | #33').type, 'Change');
});

test('a text with no letter or digit is refused', () => {
    assertRefused('CHANGES', 'F12 | Halvard | location | - | #33', 'Shape');
    assertRefused('CHANGES', 'F12 | Halvard | location | — | #33', 'Shape');
    assertRefused('CHANGES', 'F12 | Halvard | eyes | FULLER: ** | #31', 'Shape');
    assertRefused('THREADS', 'OPEN | ... | #4', 'Shape');
    assertRefused('FACTS', 'Halvard | trait | ?! | #2', 'Shape');
    assertRefused('NIGHTS', '#4 | **', 'Shape');
    assertRefused('QUESTIONS', '?? | #4', 'Shape');
});

test('glued records in bracket form are refused', () => {
    assertRefused('FACTS', 'Halvard | trait | proud | [#1] Mirelle | trait | brave | [#2]', 'Shape');
    assertRefused('CHANGES', 'F1 | Halvard | trait | x | [#5] F2 | Mirelle | trait | y | [#6]', 'Shape');
    assertRefused('QUESTIONS', 'Why? | (#1) Who? | #2', 'Shape');
    assert.equal(only('FACTS', 'Halvard | title | [#1] swordsman | #2').text, '[#1] swordsman');
});

test('a header glued to a line quarantines', () => {
    for (const [block, glued, next] of [
        ['CHANGES', 'TOLD: F2 | Halvard | Mirelle | #33', 'F5 | Tamsin | location | the inn | #34'],
        ['CHANGES', '=== TOLD F2 | Halvard | Mirelle | #33', 'F5 | Tamsin | location | the inn | #34'],
        ['NAMES', 'FACTS: Halvard | trait | proud | #12', 'F2 | moved to the inn | #31'],
        ['FACTS', '**NIGHTS** #5 | they sleep', factLine],
    ]) {
        const result = inBlock(block, [glued, next]);
        assert.deepEqual(result.operations, [], glued);
        assert.deepEqual(
            result.refused,
            [glued, next].map((line) => ({ block: 'UNKNOWN', line, reason: 'Shape' })),
            glued,
        );
    }
    const preamble = plain(ScribeAnswer.parse('TOLD: F2 | Halvard | Mirelle | #33'));
    assert.deepEqual(preamble.refused, [
        { block: 'PREAMBLE', line: 'TOLD: F2 | Halvard | Mirelle | #33', reason: 'Shape' },
    ]);
    assert.equal(only('FACTS', 'Toldric | trait | proud | #1').label, 'Toldric');
    assert.equal(only('FACTS', 'Factor | trait | proud | #1').label, 'Factor');
    assert.equal(only('FACTS', 'Told | trait | proud | #1').label, 'Told');
});

test('a fence naming a block opens it', () => {
    const result = plain(ScribeAnswer.parse('=== CHANGES\n```told\nF2 | Halvard | Mirelle | #33'));
    assert.deepEqual(result.operations, [
        { type: 'Told', fact: 'F2', owner: 'Halvard', label: 'Mirelle', position: 33 },
    ]);
    assert.deepEqual(result.refused, []);
});

test('list markers inside bold', () => {
    for (const line of [
        '**1. Halvard | trait | proud | #1**',
        '**- Halvard | trait | proud | #1**',
        '- **2) Halvard | trait | proud | #1**',
    ]) {
        assert.equal(only('FACTS', line).label, 'Halvard', line);
    }
});

test('dashes and dots before a label', () => {
    for (const written of ['-Halvard', '– Halvard', '· Halvard', '+Halvard', '—Halvard', '> Halvard']) {
        assert.equal(only('FACTS', `${written} | trait | proud | #1`).label, 'Halvard', written);
    }
    assertRefused('FACTS', '– | trait | proud | #1', 'Name');
});

test('citation lists', () => {
    for (const field of ['#7, #8, and #9', '[#7], [#9]', '[#7] and [#9]', '[#7, #9]', '#7 and #9']) {
        assert.equal(only('QUESTIONS', `Why? | ${field}`).position, 7, field);
    }
    for (const field of ['[#7][#9]', '#7 band #9', '[#7], #9]', '#7, and']) {
        assertRefused('QUESTIONS', `Why? | ${field}`, 'Citation');
    }
});

test('a thread closed with no account', () => {
    assert.deepEqual(only('THREADS', 'CLOSE T3 | #26'), { type: 'ThreadClose', thread: 'T3', how: '', position: 26 });
    assertRefused('THREADS', 'CLOSE T3 | | #26', 'Shape');
    assertRefused('THREADS', 'CLOSE T3 | soon', 'Citation');
    assertRefused('THREADS', 'OPEN | #26', 'Shape');
    assertRefused('THREADS', 'CLOSE | #26', 'Shape');
});

test('attendance: bounds must run forward', () => {
    for (const bounds of ['(until #13) (from #18)', '(from #18 until #13)', '(from #18, until #13)']) {
        assertRefused('SCENES', sceneWithPresent(`Halvard ${bounds}`), 'Shape');
    }
    assert.deepEqual(only('SCENES', sceneWithPresent('Halvard (from #13 until #13)')).present, [
        { label: 'Halvard', from: 13, until: 13 },
    ]);
    assert.deepEqual(only('SCENES', sceneWithPresent('Isolde (until #14), Isolde (from #18)')).present, [
        { label: 'Isolde', from: null, until: 14 },
        { label: 'Isolde', from: 18, until: null },
    ]);
});

test('attendance: one entry is one name', () => {
    for (const list of ['Halvard, Mirelle and Tamsin', 'Halvard and Mirelle', 'Halvard & Mirelle', 'Halvard; Mirelle']) {
        assertRefused('SCENES', sceneWithPresent(list), 'Shape');
    }
    assert.deepEqual(only('SCENES', sceneWithPresent("Oswin (Tamsin and Kira's uncle), Orla")).present, [
        { label: "Oswin (Tamsin and Kira's uncle)", from: null, until: null },
        { label: 'Orla', from: null, until: null },
    ]);
    assert.equal(only('SCENES', sceneWithPresent('Brandt Andersen, Orlando')).present.length, 2);
});

test('attendance: a bound without its mark is refused', () => {
    for (const list of ['Halvard (from 11)', 'Halvard (from message 11)', 'Halvard (until 13)']) {
        assertRefused('SCENES', sceneWithPresent(list), 'Shape');
    }
    assert.deepEqual(only('SCENES', sceneWithPresent('Oswin (from the mill)')).present, [
        { label: 'Oswin (from the mill)', from: null, until: null },
    ]);
});

test('attendance: empty in any dress', () => {
    for (const list of ['None.', '(none)', 'No one', 'nobody', 'NO ONE.', ' ']) {
        assert.deepEqual(only('SCENES', sceneWithPresent(list)).present, [], list);
    }
});

test('rules the earlier tests left undefended', () => {
    assertRefused('SCENES', sceneWithPresent('Halvard), Mirelle (tall'), 'Shape');
    assertRefused('SCENES', sceneWithPresent(`Halvard (from #${'1'.repeat(30)} until #13)`), 'Shape');
    const result = plain(ScribeAnswer.parse(`=== THREADS\n=== FACTS (none)\n${factLine}`));
    assert.deepEqual(result.operations, []);
    assert.deepEqual(
        result.refused,
        ['=== FACTS (none)', factLine].map((line) => ({ block: 'UNKNOWN', line, reason: 'Shape' })),
    );
    assert.deepEqual(only('SUBJECTS', 'None | character'), { type: 'Subject', label: 'None', kind: 'character' });
});

test('a hostile attendance list stays fast', () => {
    const size = 100000;
    const hostile = [
        ['repeated bounds', sceneWithPresent(`Halvard${'(from #1)'.repeat(Math.ceil(size / 9))}`)],
        ['open brackets', sceneWithPresent(`Halvard${'('.repeat(size)}`)],
        ['spaces after a bound', sceneWithPresent(`Halvard (from #1${' '.repeat(size)}x`)],
        ['spaces after an until', sceneWithPresent(`Halvard (from #1 ${' '.repeat(size)}until`)],
        ['commas', sceneWithPresent(','.repeat(size))],
        ['edge marks', sceneWithPresent(`${'*_'.repeat(size / 2)}x${'*_'.repeat(size / 2)}`)],
        ['digits in a bound', sceneWithPresent(`Halvard (from #${'1'.repeat(size)}`)],
    ];
    for (const [name, line] of hostile) {
        const started = performance.now();
        ScribeAnswer.parse(`=== SCENES\n${line}`);
        assert.ok(performance.now() - started < 500, name);
    }
    const repeated = inBlock('SCENES', [hostile[0][1]]);
    assert.deepEqual(repeated.operations, []);
    assert.equal(repeated.refused[0].reason, 'Shape');
});

test('other hostile lines stay fast', () => {
    const size = 100000;
    const lines = [
        `- `.repeat(size / 2) + 'Halvard | trait | proud | #1',
        `1. `.repeat(size / 3) + 'x',
        `${' '.repeat(size)}x`,
        `Halvard | trait | proud | #1${' '.repeat(size)}x`,
        `Why? | #1${' '.repeat(size)}x`,
        `Why? | ${'#1, '.repeat(size / 4)}`,
        `Why? | ${'#1 and '.repeat(size / 6)}`,
        `**${'*'.repeat(size)}`,
        'F1 | Halvard | trait | ENDED' + ' :|-.;'.repeat(size / 6) + ' | #1',
        'F1 | Halvard | trait | ENDED' + ' :-.;'.repeat(size / 5) + ' | #1',
        `​`.repeat(size),
        `${'='.repeat(size)}`,
        `${'a'.repeat(size)} | trait | proud | #1`,
        `${'a'.repeat(size)}:`,
    ];
    for (const block of ['SUBJECTS', 'FACTS', 'CHANGES', 'NIGHTS', 'QUESTIONS', 'THREADS', 'CONTRADICTIONS']) {
        for (const line of lines) {
            const started = performance.now();
            ScribeAnswer.parse(`=== ${block}\n${line}`);
            assert.ok(performance.now() - started < 500, `${block} ${line.slice(0, 20)}`);
        }
    }
});

test('a contradiction line is read', () => {
    assert.deepEqual(
        only('CONTRADICTIONS', '#2 "guarded the Staff of Tides" | #1 "held the Staff of Tides" | Two keepers for one staff'),
        {
            type: 'Contradiction',
            position: 2,
            said: 'guarded the Staff of Tides',
            earlier: 1,
            before: 'held the Staff of Tides',
            entry: null,
            why: 'Two keepers for one staff',
        },
    );
    assert.deepEqual(only('CONTRADICTIONS', '#9 "guarded the Staff of Tides" | f67 | Two keepers for one staff'), {
        type: 'Contradiction',
        position: 9,
        said: 'guarded the Staff of Tides',
        earlier: null,
        before: null,
        entry: 'F67',
        why: 'Two keepers for one staff',
    });
    assert.equal(only('CONTRADICTIONS', '#9 "guarded the staff" | T8 | A promise broken').entry, 'T8');
    for (const written of ['F1 (#5)', '"F1"', 'F1.', '#5 F1', '“f1”', 'F1 ( #5 )']) {
        assert.equal(only('CONTRADICTIONS', `#9 "guarded the staff" | ${written} | Two keepers`).entry, 'F1', written);
    }
    for (const bad of ['#9 "guarded" | F67 x | why', '#9 "guarded" | G67 | why', '#9 "guarded" | F | why']) {
        assert.deepEqual(plain(ScribeAnswer.parse(`=== CONTRADICTIONS\n${bad}`).refused).length, 1, bad);
    }
    const cases = [
        ['#12 “the gate” | #3 ”the bar“ | open or barred', ['the gate', 'the bar']],
        ['#12"the gate" | #3"the bar" | open or barred', ['the gate', 'the bar']],
        ['#12 "  the gate  " | #3 "the bar " | open or barred', ['the gate', 'the bar']],
        ['#12 "she said "no" twice" | #3 "she said yes" | yes or no', ['she said "no" twice', 'she said yes']],
        ['- **#012 "the gate" | #3 "the bar" | open or barred**', ['the gate', 'the bar']],
    ];
    for (const [line, quotes] of cases) {
        const operation = only('CONTRADICTIONS', line);
        assert.deepEqual([operation.said, operation.before], quotes, line);
        assert.deepEqual([operation.position, operation.earlier], [12, 3], line);
    }
    const lines = [
        '=== QUESTIONS',
        'Who holds the staff? | #2',
        '=== CONTRADICTIONS',
        '#2 "the staff" | #1 "an oar" | which',
    ];
    const result = ScribeAnswer.parse(lines.join('\n'));
    assert.deepEqual(plain(result.operations.map((operation) => operation.type)), ['Question', 'Contradiction']);
    assertFrozenDeep(result, 'result');
});

test('a contradiction line of the wrong shape or numbers is refused', () => {
    const shapes = [
        '#2 "the gate stood open" | #1 "the gate was barred"',
        '#2 "the gate stood open" | #1 "the gate was barred" | open or barred | #2',
        '#2 the gate stood open | #1 "the gate was barred" | open or barred',
        "#2 'the gate stood open' | #1 \"the gate was barred\" | open or barred",
        '#2 "the gate stood open | #1 "the gate was barred" | open or barred',
        '#2 "" | #1 "the gate was barred" | open or barred',
        '#2 "..." | #1 "the gate was barred" | open or barred',
        '#2 "the gate stood open" | #1 " " | open or barred',
        '#2 "the gate stood open" | #1 "the gate was barred" |',
        '#2 "the gate stood open" | #1 "the gate was barred" | ...',
        '#2 "the gate stood open" #1 "the gate was barred" | open | barred',
    ];
    for (const line of shapes) {
        assertRefused('CONTRADICTIONS', line, 'Shape');
    }
    const citations = [
        '#0 "the gate stood open" | #1 "the gate was barred" | open or barred',
        '#2 "the gate stood open" | #0 "the gate was barred" | open or barred',
        '#2 "the gate stood open" | #2 "the gate was barred" | open or barred',
        '#2 "the gate stood open" | #3 "the gate was barred" | open or barred',
        '"the gate stood open" | #1 "the gate was barred" | open or barred',
        '#x "the gate stood open" | #1 "the gate was barred" | open or barred',
        '#2 "the gate stood open" | 1 "the gate was barred" | open or barred',
        '[#2] "the gate stood open" | #1 "the gate was barred" | open or barred',
        '#-2 "the gate stood open" | #1 "the gate was barred" | open or barred',
        '#99999999999999999999 "the gate stood open" | #1 "the gate was barred" | open or barred',
        '#2-#4 "the gate stood open" | #1 "the gate was barred" | open or barred',
    ];
    for (const line of citations) {
        assertRefused('CONTRADICTIONS', line, 'Citation');
    }
    assertRefused('QUESTIONS', '#2 "the gate stood open" | #1 "the gate was barred" | open or barred', 'Shape');
});

test('a hostile contradiction line stays fast', () => {
    const size = 100000;
    const lines = [
        `#2 "${'a'.repeat(size)} | #1 "b c" | why`,
        `#2 ${'"'.repeat(size)} | #1 "b c" | why`,
        `#2 "${'" '.repeat(size / 2)}x | #1 "b c" | why`,
        `${'#'.repeat(size)} "a b" | #1 "b c" | why`,
        `#2${' '.repeat(size)}x"a b" | #1 "b c" | why`,
        `#2 "a b" | #1 "b c" | ${'"'.repeat(size)}`,
    ];
    for (const line of lines) {
        const started = performance.now();
        ScribeAnswer.parse(`=== CONTRADICTIONS\n${line}`);
        assert.ok(performance.now() - started < 500, line.slice(0, 20));
    }
});
