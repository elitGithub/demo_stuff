import assert from 'node:assert/strict';
import test from 'node:test';
import CampaignBuilder from './support/CampaignBuilder.mjs';
import ScribeCore from './support/ScribeCore.mjs';

const { ScribeText, ScribeIntake, ScribeAnswer, ScribeLog, ScribeReplay, ScribeAnalyzer } = ScribeCore.load([
    'ScribeText',
    'ScribeCategory',
    'ScribeIntake',
    'ScribeAnswer',
    'ScribeLog',
    'ScribeReplay',
    'ScribeAnalyzer',
]);

/**
 * @param {Object<number, string|[string, string]>} lines
 * @return {object[]}
 */
function storyWith(lines) {
    const builder = new CampaignBuilder('Orla');
    for (let number = 1; number <= 100; number++) {
        const line = lines[number] ?? `The tale goes on, line ${number}.`;
        if (Array.isArray(line)) {
            builder.says(line[0], line[1]);
        } else {
            builder.narrator(line);
        }
    }
    return ScribeIntake.read(builder.messages).messages;
}

const story = storyWith({});
const storyOrder = story.map((message) => message.id);

/**
 * @param {*} value
 * @return {*}
 */
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

/**
 * @param {Object<string, string[]>} blocks
 * @return {string}
 */
function answer(blocks) {
    return Object.entries(blocks)
        .map(([block, lines]) => [`=== ${block}`, ...lines].join('\n'))
        .join('\n');
}

/**
 * @param {...number} positions
 * @return {object[]}
 */
function pick(...positions) {
    return positions.map((position) => story[position - 1]);
}

/**
 * @param {number} first
 * @param {number} last
 * @return {object[]}
 */
function stretch(first, last) {
    return story.slice(first - 1, last);
}

/**
 * @param {object} log
 * @param {string} answerText
 * @param {object[]} messages
 * @param {string} origin
 * @return {object}
 */
function apply(log, answerText, messages, origin = 'Story') {
    const parsed = ScribeAnswer.parse(answerText);
    assert.deepEqual(plain(parsed.refused), [], answerText);
    const result = ScribeLog.append(log, ScribeReplay.run(log, storyOrder), parsed.operations, { messages, origin });
    assert.deepEqual(plain(result.refused), [], answerText);
    return ScribeReplay.run(log, storyOrder);
}

/**
 * @param {object} log
 * @param {object} operation
 * @return {object}
 */
function rule(log, operation) {
    ScribeLog.rule(log, ScribeReplay.run(log, storyOrder), operation);
    return ScribeReplay.run(log, storyOrder);
}

/**
 * @param {object} state
 * @param {...string} labels
 * @return {string[]}
 */
function idsOf(state, ...labels) {
    return labels.map((label) => {
        const found = state.subjects.filter((subject) => subject.label === label);
        assert.equal(found.length, 1, `subjects labelled ${label}`);
        return found[0].id;
    });
}

/**
 * @param {string} text
 * @param {string} heading
 * @return {string[]}
 */
function sectionOf(text, heading) {
    const chunk = text.split('\n\n').find((part) => part.startsWith(`${heading}\n`));
    assert.notEqual(chunk, undefined, `no ${heading} section in:\n${text}`);
    return chunk.split('\n').slice(1);
}

/**
 * @param {object} state
 * @param {string} text
 * @return {string[]}
 */
function ledgerOf(state, text) {
    return sectionOf(ScribeAnalyzer.input(state, 'Orla', storyWith({ 60: text }).slice(59, 60)), 'LEDGER:');
}

/**
 * @return {object}
 */
function richBook() {
    const log = ScribeLog.create();
    apply(
        log,
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Tamsin | character', 'Corvane | world'],
            FACTS: [
                'Halvard | age | forty | #2',
                'Halvard | relation to Tamsin | trusts her | #5',
                'Mirelle | trait | proud | hidden | #6',
                'Halvard | condition | a fever | #7',
                'Tamsin | relation to Halvard | resents him | #20',
            ],
            SCENES: [
                'Day 1 | #10-#40 | The mill | public | present: Halvard, Mirelle (from #12) | They argue',
                'Day 1 | #15-#20 | The yard | private | present: Tamsin | She trains',
            ],
            NIGHTS: ['#30 | they sleep at the mill'],
            THREADS: ['OPEN | the debt to Brandt | #8', 'OPEN | the missing ring | #9'],
            QUESTIONS: ['Does Mirelle trust Halvard? | #11'],
        }),
        stretch(1, 44),
    );
    apply(log, answer({ THREADS: ['CLOSE T1 | paid in full | #45'] }), pick(45));
    rule(log, { type: 'Answer', question: 'Q1', text: 'Only a little' });
    return rule(log, {
        type: 'AddFact',
        subject: 'S2',
        category: 'trait',
        target: null,
        text: 'hates the cold',
        hidden: false,
        cite: null,
        position: 0,
    });
}

/**
 * @param {string} prompt
 * @return {string[]}
 */
function examples(prompt) {
    const lines = prompt.split('\n');
    const first = lines.findIndex((line) => line.startsWith('=== '));
    const categories = lines.findIndex((line) => line.startsWith('Categories.'));
    return lines.slice(first, categories);
}

test('selection matches whole names only', () => {
    const log = ScribeLog.create();
    const state = apply(
        log,
        answer({
            SUBJECTS: [
                'Oswin | character',
                'Mirelle | character',
                "D'Arvel | character",
                'Aldric | character',
                'Ox | place',
                "'Nonette' | character",
                '& (Kira) | character',
            ],
        }),
        pick(1),
    );
    assert.equal(state.subjects.at(-1).name, '&');
    const [oswin, mirelle, darvel, aldric, ox, nonette] = idsOf(
        state,
        'Oswin',
        'Mirelle',
        "D'Arvel",
        'Aldric',
        'Ox',
        "'Nonette'",
    );
    /**
     * @param {string} text
     * @return {string[]}
     */
    const chosen = (text) => plain(ScribeAnalyzer.select(state, text, 'Orla', 1));
    assert.deepEqual(chosen('the children ran'), []);
    assert.deepEqual(chosen("Mirelle's blouse"), [mirelle]);
    assert.deepEqual(chosen('Mirelle-san bowed'), [mirelle]);
    assert.deepEqual(chosen("to D'Arvel."), [darvel]);
    assert.deepEqual(chosen("the D'Arvels came"), []);
    assert.deepEqual(chosen('Aldrich nods'), []);
    assert.deepEqual(chosen('a box of nails'), []);
    assert.deepEqual(chosen('They rode to Ox.'), [ox]);
    assert.deepEqual(chosen('MIRELLE called oswin and aLDRIC'), [oswin, mirelle, aldric]);
    assert.deepEqual(chosen("they rang for 'Nonette' twice"), [nonette]);
    assert.deepEqual(chosen("its'Nonette' rang"), []);
    assert.deepEqual(chosen("s'Nonette' rang"), []);
    assert.deepEqual(chosen("𝒳'Nonette' rang"), []);
    assert.deepEqual(chosen("'Nonette'𝒳 rang"), []);
    assert.deepEqual(chosen("e̳'Nonette' rang"), []);
    assert.deepEqual(chosen("'Nonette'̳ rang"), []);
    assert.deepEqual(chosen("'Nonette's bell"), []);
    assert.deepEqual(chosen('Nonette rang'), []);
});

test('short aka are ignored', () => {
    const log = ScribeLog.create();
    const state = apply(
        log,
        answer({
            SUBJECTS: ['Aldric | character', 'Kira | character'],
            FACTS: ['Aldric | aka | Al | #1', 'Kira | aka | Fox | #1'],
        }),
        pick(1),
    );
    const [aldric, kira] = idsOf(state, 'Aldric', 'Kira');
    assert.deepEqual(plain(state.subjects.map((subject) => subject.aka)), [['Al'], ['Fox']]);
    /**
     * @param {string} text
     * @return {string[]}
     */
    const chosen = (text) => plain(ScribeAnalyzer.select(state, text, 'Orla', 1));
    assert.deepEqual(chosen('Al went home.'), []);
    assert.deepEqual(chosen('Then al and AL left.'), []);
    assert.deepEqual(chosen('Fox went home.'), [kira]);
    assert.deepEqual(chosen('the fox and the FOX'), [kira]);
    assert.deepEqual(chosen('Aldric and Kira'), [aldric, kira]);
});

test('the world, the player and those present are always sent', () => {
    const log = ScribeLog.create();
    const state = apply(
        log,
        answer({
            SUBJECTS: [
                'Corvane | world',
                'Orla | character',
                'Halvard | character',
                'Isolde | character',
                'Kira | character',
                'Tamsin | character',
                'Brandt | character',
                'Mirelle | character',
            ],
            FACTS: ['Orla | aka | Nonette | #1'],
            SCENES: [
                'Day 1 | #5-#8 | The mill | public | present: Isolde | She waits',
                'Day 1 | #10-#30 | The yard | public | present: Halvard | He trains',
                'Day 1 | #15-#20 | The inn | private | present: Kira | She drinks',
                'Day 2 | #40-#50 | The hall | public | present: Tamsin | They feast',
                'Day 3 | #52-#56 | The road | public | present: Brandt | They ride',
                'Day 3 | #54-#56 | The camp | private | present: Mirelle | She rests',
            ],
        }),
        stretch(1, 59),
    );
    const [corvane, orla, halvard, tamsin, mirelle] = idsOf(state, 'Corvane', 'Orla', 'Halvard', 'Tamsin', 'Mirelle');
    /**
     * @param {string} player
     * @param {number} before
     * @return {string[]}
     */
    const chosen = (player, before) => plain(ScribeAnalyzer.select(state, 'the rain fell', player, before));
    assert.deepEqual(chosen('Maren', 1), [corvane]);
    assert.deepEqual(chosen('Orla', 1), [corvane, orla]);
    assert.deepEqual(chosen('Nonette', 1), [corvane, orla]);
    assert.deepEqual(chosen('NONETTE', 1), [corvane, orla]);
    assert.deepEqual(chosen('Orla-san', 1), [corvane, orla]);
    assert.deepEqual(chosen('Maren', 40), [corvane, halvard]);
    assert.deepEqual(chosen('Maren', 41), [corvane, tamsin]);
    assert.deepEqual(chosen('Maren', 58), [corvane, mirelle]);
});

test('merged subjects are not offered', () => {
    const log = ScribeLog.create();
    const before = apply(
        log,
        answer({
            SUBJECTS: ['Aldrich | character', 'Aldric | character'],
            FACTS: ['Aldrich | trait | stubborn | #2', 'Aldric | age | forty | #3'],
        }),
        pick(2, 3),
    );
    const [aldrich, aldric] = idsOf(before, 'Aldrich', 'Aldric');
    assert.deepEqual(plain(ScribeAnalyzer.select(before, 'Aldrich waits.', 'Orla', 1)), [aldrich]);
    const state = rule(log, { type: 'Merge', from: aldrich, into: aldric });
    assert.deepEqual(plain(ScribeAnalyzer.select(state, 'Aldrich waits.', 'Orla', 1)), [aldric]);
    assert.deepEqual(plain(ScribeAnalyzer.select(state, 'Aldric waits.', 'Orla', 1)), [aldric]);
    const text = ScribeAnalyzer.input(state, 'Orla', storyWith({ 60: 'Aldrich waits.' }).slice(59, 60));
    assert.deepEqual(sectionOf(text, 'SUBJECTS:'), ['- Aldric (character; aka Aldrich)']);
    assert.deepEqual(sectionOf(text, 'LEDGER:'), ['## Aldric', 'F1 trait: stubborn (#2)', 'F2 age: forty (#3)']);
});

test('only in-force facts are sent', () => {
    const log = ScribeLog.create();
    apply(
        log,
        answer({
            FACTS: [
                'Halvard | age | forty | #2',
                'Halvard | age | fifty | #3',
                'Halvard | location | the mill | #2',
                'Halvard | location | the inn | #3',
                'Halvard | trait | proud | #2',
                'Halvard | belonging | a silver ring | #2',
                'Halvard | condition | a fever | #2',
                'Halvard | trait | stubborn | #3',
            ],
            NIGHTS: ['#4 | they sleep at the inn'],
        }),
        pick(2, 3, 4),
    );
    apply(log, answer({ CHANGES: ['F6 | Halvard | belonging | ENDED: sold it | #5'] }), pick(5));
    const state = rule(log, { type: 'RemoveFact', fact: 'F8' });
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.status])), [
        ['F1', 'InForce'],
        ['F3', 'Replaced'],
        ['F5', 'InForce'],
        ['F6', 'Ended'],
        ['F7', 'Expired'],
        ['F2', 'Disputed'],
        ['F4', 'InForce'],
        ['F8', 'Removed'],
    ]);
    assert.deepEqual(ledgerOf(state, 'Halvard waits.'), [
        '## Halvard',
        'F1 age: forty (#2)',
        'F5 trait: proud (#2)',
        'F4 location: the inn (#3)',
    ]);
});

test('relations name their target', () => {
    const log = ScribeLog.create();
    const state = apply(
        log,
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character'],
            FACTS: [
                'Halvard | relation to Mirelle-san | trusts her | #2',
                'Halvard | relation to Brandt | owes him money | #2',
            ],
        }),
        pick(2),
    );
    const [mirelle] = idsOf(state, 'Mirelle');
    assert.deepEqual(plain(state.facts.map((fact) => [fact.target, fact.targetText])), [
        [mirelle, 'Mirelle-san'],
        [null, 'Brandt'],
    ]);
    assert.deepEqual(ledgerOf(state, 'Halvard waits.'), [
        '## Halvard',
        'F1 relation to Mirelle: trusts her (#2)',
        'F2 relation to Brandt: owes him money (#2)',
    ]);
});

test('a stale relation is marked', () => {
    const log = ScribeLog.create();
    apply(log, answer({ SUBJECTS: ['Halvard | character', 'Tamsin | character'] }), pick(1));
    apply(log, answer({ FACTS: ['Halvard | relation to Tamsin | trusts her | hidden | #5'] }), pick(5));
    const state = apply(log, answer({ FACTS: ['Tamsin | relation to Halvard | resents him | #20'] }), pick(20));
    const [halvard, tamsin] = idsOf(state, 'Halvard', 'Tamsin');
    assert.deepEqual(plain(state.stale), [{ subject: halvard, target: tamsin }]);
    assert.deepEqual(ledgerOf(state, 'Halvard and Tamsin wait.'), [
        '## Halvard',
        'F1 relation to Tamsin: trusts her (#5) hidden (check: the other side has changed)',
        '## Tamsin',
        'F2 relation to Halvard: resents him (#20)',
    ]);
});

test('hidden and owner facts are marked', () => {
    const log = ScribeLog.create();
    apply(log, answer({ FACTS: ['Halvard | trait | proud | hidden | #2', 'Halvard | trait | brave | #2'] }), pick(2));
    const added = {
        type: 'AddFact',
        subject: 'S1',
        category: 'trait',
        target: null,
        text: 'kind to strangers',
        hidden: false,
        cite: null,
        position: 0,
    };
    rule(log, added);
    rule(log, { ...added, text: 'fears the sea', hidden: true, cite: 'MESSAGE-3', position: 3 });
    const state = apply(log, answer({ FACTS: ['Halvard | trait | loyal | #4'] }), pick(4), 'Notes');
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.origin, fact.hidden])), [
        ['F3', 'Operator', false],
        ['F1', 'Story', true],
        ['F2', 'Story', false],
        ['F4', 'Operator', true],
        ['F5', 'Notes', false],
    ]);
    const ledger = ledgerOf(state, 'Halvard waits.');
    assert.deepEqual(ledger, [
        '## Halvard',
        'F3 trait: kind to strangers (owner)',
        'F1 trait: proud (#2) hidden',
        'F2 trait: brave (#2)',
        'F4 trait: fears the sea (owner) hidden',
        'F5 trait: loyal (#4)',
    ]);
    for (const line of ledger.filter((entry) => entry.includes('(owner)'))) {
        assert.equal(line.includes('#'), false, line);
    }
});

test('shared names get distinct labels', () => {
    const log = ScribeLog.create();
    const state = apply(
        log,
        answer({
            SUBJECTS: ['Oswin | character', "Oswin (Tamsin's uncle) | character", 'Corvane | place'],
            FACTS: ['Oswin | aka | the Ferryman | #2', 'Oswin | aka | Old Oswin | #2'],
        }),
        pick(2),
    );
    assert.deepEqual(plain(state.subjects.map((subject) => subject.name)), ['Oswin', 'Oswin', 'Corvane']);
    const subjects = sectionOf(ScribeAnalyzer.input(state, 'Orla', stretch(60, 60)), 'SUBJECTS:');
    assert.deepEqual(subjects, [
        '- Oswin (character; aka the Ferryman, Old Oswin)',
        "- Oswin (Tamsin's uncle) (character)",
        '- Corvane (place)',
    ]);
    assert.equal(new Set(subjects).size, 3);
});

test('last scenes and nights come before the stretch', () => {
    const log = ScribeLog.create();
    apply(
        log,
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Tamsin | character', 'Brandt | character'],
            SCENES: [
                'Day 1 | #2-#5 | The mill | public | present: Halvard | They meet',
                'Day 1 | #6-#20 | The yard | private | present: Halvard, Mirelle (from #8) | They train',
                'Day 2 | #21-#30 | The inn | public | present: nobody | The fire dies',
                'Day 2 | #22-#55 | The road | private | present: Brandt (from #30) | He rides north',
                'Day 2 | #31-#50 | The hall | public | present: Mirelle (until #40), Tamsin (from #35 until #45), Halvard | They feast',
            ],
            NIGHTS: [
                '#10 | they sleep at the mill',
                '#25 | they camp',
                '#40 | they sleep in the hall',
                '#52 | a week passes',
            ],
        }),
        stretch(1, 59),
    );
    const state = apply(
        log,
        answer({
            SCENES: ['Day 3 | #60-#70 | The harbour | public | present: Tamsin | She sails'],
            NIGHTS: ['#60 | they sleep aboard', '#65 | another night'],
        }),
        stretch(60, 70),
    );
    assert.equal(state.scenes.length, 6);
    assert.equal(state.nights.length, 6);
    const text = ScribeAnalyzer.input(state, 'Orla', stretch(60, 61));
    assert.deepEqual(sectionOf(text, 'LAST SCENES:'), [
        'Day 2 | #21-#30 | The inn | public | present: nobody | The fire dies',
        'Day 2 | #31-#50 | The hall | public | present: Mirelle (until #40), Tamsin (from #35 until #45), Halvard | They feast',
        'Day 2 | #22-#55 | The road | private | present: Brandt (from #30) | He rides north',
    ]);
    assert.deepEqual(sectionOf(text, 'NIGHTS:'), [
        '#25 | they camp',
        '#40 | they sleep in the hall',
        '#52 | a week passes',
    ]);
});

test('open threads only', () => {
    const log = ScribeLog.create();
    apply(
        log,
        answer({ THREADS: ['OPEN | the debt to Brandt | #2', 'OPEN | the missing ring | #3'] }),
        pick(2, 3),
    );
    const state = apply(log, answer({ THREADS: ['CLOSE T1 | paid in full | #4'] }), pick(4));
    assert.deepEqual(plain(state.threads.map((thread) => [thread.id, thread.closed === null])), [
        ['T1', false],
        ['T2', true],
    ]);
    assert.deepEqual(sectionOf(ScribeAnalyzer.input(state, 'Orla', stretch(60, 60)), 'OPEN THREADS:'), [
        'T2: the missing ring',
    ]);
});

test('ended facts and closed threads reach the story input with their numbers', () => {
    const log = ScribeLog.create();
    apply(
        log,
        answer({
            SUBJECTS: ['Brannoc | character', 'Sela | character', 'Kira | character', 'Staff of Tides | item'],
            FACTS: [
                'Brannoc | belonging | the Staff of Tides | #2',
                'Brannoc | relation to Sela | trusts her | #3',
                'Kira | trait | hums at night | #4',
                'Staff of Tides | feature | carved from driftwood | #4',
            ],
            THREADS: ['OPEN | who stole the lantern | #5', 'OPEN | the toll owed at the ford | #6'],
        }),
        stretch(1, 9),
    );
    rule(log, {
        type: 'AddFact',
        subject: 'S1',
        category: 'trait',
        target: null,
        text: 'fears deep water',
        hidden: false,
        cite: null,
        position: 0,
    });
    apply(
        log,
        answer({
            CHANGES: [
                'F1 | Brannoc | belonging | ENDED: gave it to Sela | #10',
                'F2 | Brannoc | relation to Sela | ENDED | #11',
                'F3 | Kira | trait | ENDED: stopped humming | #12',
                'F5 | Brannoc | trait | ENDED: learned to swim | #15',
            ],
            THREADS: ['CLOSE T1 | Kira confessed | #13', 'CLOSE T2 | #14'],
        }),
        stretch(10, 20),
    );
    apply(
        log,
        answer({ FACTS: ['Brannoc | trait | sings badly | #70'], THREADS: ['OPEN | the debt to the miller | #70'] }),
        pick(70),
    );
    const state = apply(
        log,
        answer({ CHANGES: ['F6 | Brannoc | trait | ENDED: took lessons | #71'], THREADS: ['CLOSE T3 | paid | #71'] }),
        pick(71),
    );
    assert.deepEqual(
        plain(state.facts.filter((fact) => fact.status === 'Ended').map((fact) => [fact.id, fact.ended.position])),
        [
            ['F5', 15],
            ['F1', 10],
            ['F2', 11],
            ['F3', 12],
            ['F6', 71],
        ],
    );
    const messages = storyWith({ 60: 'Brannoc hands the Staff of Tides to Sela.' }).slice(59, 62);
    const text = ScribeAnalyzer.input(state, 'Orla', messages);
    assert.deepEqual(sectionOf(text, 'ENDED FACTS:'), [
        'F5 Brannoc trait: fears deep water (owner) ENDED: learned to swim (#15)',
        'F1 Brannoc belonging: the Staff of Tides (#2) ENDED: gave it to Sela (#10)',
        'F2 Brannoc relation to Sela: trusts her (#3) ENDED (#11)',
    ]);
    assert.deepEqual(sectionOf(text, 'CLOSED THREADS:'), [
        'T1: who stole the lantern (#5) CLOSED: Kira confessed (#13)',
        'T2: the toll owed at the ford (#6) CLOSED (#14)',
    ]);
    assert.deepEqual(sectionOf(text, 'OPEN THREADS:'), ['(none)']);
    assert.deepEqual(sectionOf(text, 'LEDGER:'), [
        '## Brannoc',
        '(no facts yet)',
        '## Sela',
        '(no facts yet)',
        '## Staff of Tides',
        'F4 feature: carved from driftwood (#4)',
    ]);
    const later = ScribeAnalyzer.input(state, 'Orla', storyWith({ 80: 'Brannoc waits.' }).slice(79, 80));
    assert.deepEqual(
        [sectionOf(later, 'ENDED FACTS:').at(-1), sectionOf(later, 'CLOSED THREADS:').at(-1)],
        [
            'F6 Brannoc trait: sings badly (#70) ENDED: took lessons (#71)',
            'T3: the debt to the miller (#70) CLOSED: paid (#71)',
        ],
    );
    const shifted = ScribeReplay.run(log, storyOrder.filter((id) => id !== 'MESSAGE-1'));
    const moved = ScribeAnalyzer.input(shifted, 'Orla', storyWith({ 60: 'Brannoc and Sela.' }).slice(59, 60));
    assert.deepEqual(sectionOf(moved, 'ENDED FACTS:'), [
        'F5 Brannoc trait: fears deep water (owner) ENDED: learned to swim (#14)',
        'F1 Brannoc belonging: the Staff of Tides (#1) ENDED: gave it to Sela (#9)',
        'F2 Brannoc relation to Sela: trusts her (#2) ENDED (#10)',
    ]);
    assert.deepEqual(sectionOf(moved, 'CLOSED THREADS:'), [
        'T1: who stole the lantern (#4) CLOSED: Kira confessed (#12)',
        'T2: the toll owed at the ford (#5) CLOSED (#13)',
    ]);
    for (const other of [
        ScribeAnalyzer.notesInput(state, 'Orla', [{ text: 'Brannoc and Sela are cousins', position: 12 }]),
        ScribeAnalyzer.answersInput(state, 'Orla', []),
    ]) {
        assert.equal(other.includes('ENDED FACTS:'), false);
        assert.equal(other.includes('CLOSED THREADS:'), false);
    }
});

test('sections are in order', () => {
    const state = richBook();
    const messages = storyWith({ 60: 'Mirelle waves.' }).slice(59, 62);
    const text = ScribeAnalyzer.input(state, 'Orla', messages);
    const headings = [
        'SUBJECTS:',
        'LEDGER:',
        'LAST SCENES:',
        'NIGHTS:',
        'OPEN THREADS:',
        'ENDED FACTS:',
        'CLOSED THREADS:',
        'NEW MESSAGES (#60 to #62):',
    ];
    assert.equal(text.startsWith('PLAYER CHARACTER:\nOrla\n\n'), true);
    let previous = 0;
    for (const heading of headings) {
        const index = text.indexOf(`\n\n${heading}\n`);
        assert.ok(index > previous, `${heading} at ${index}, after ${previous}`);
        previous = index;
    }
    assert.equal(text.endsWith(`\n\nNEW MESSAGES (#60 to #62):\n${ScribeIntake.transcript(messages)}`), true);
    assert.equal(
        text,
        [
            'PLAYER CHARACTER:',
            'Orla',
            '',
            'SUBJECTS:',
            '- Halvard (character)',
            '- Mirelle (character)',
            '- Tamsin (character)',
            '- Corvane (world)',
            '',
            'LEDGER:',
            '## Halvard',
            'F1 age: forty (#2)',
            'F2 relation to Tamsin: trusts her (#5) (check: the other side has changed)',
            '## Mirelle',
            'F6 trait: hates the cold (owner)',
            'F3 trait: proud (#6) hidden',
            '## Corvane',
            '(no facts yet)',
            '',
            'LAST SCENES:',
            'Day 1 | #15-#20 | The yard | private | present: Tamsin | She trains',
            'Day 1 | #10-#40 | The mill | public | present: Halvard, Mirelle (from #12) | They argue',
            '',
            'NIGHTS:',
            '#30 | they sleep at the mill',
            '',
            'OPEN THREADS:',
            'T2: the missing ring',
            '',
            'ENDED FACTS:',
            '(none)',
            '',
            'CLOSED THREADS:',
            'T1: the debt to Brandt (#8) CLOSED: paid in full (#45)',
            '',
            'NEW MESSAGES (#60 to #62):',
            '[#60] Narrator: Mirelle waves.',
            '',
            '[#61] Narrator: The tale goes on, line 61.',
            '',
            '[#62] Narrator: The tale goes on, line 62.',
        ].join('\n'),
    );
    const empty = ScribeReplay.run(ScribeLog.create(), storyOrder);
    assert.equal(
        ScribeAnalyzer.input(empty, 'Orla', stretch(61, 63)),
        [
            'PLAYER CHARACTER:',
            'Orla',
            '',
            'SUBJECTS:',
            '(none)',
            '',
            'LEDGER:',
            '(none)',
            '',
            'LAST SCENES:',
            '(none)',
            '',
            'NIGHTS:',
            '(none)',
            '',
            'OPEN THREADS:',
            '(none)',
            '',
            'ENDED FACTS:',
            '(none)',
            '',
            'CLOSED THREADS:',
            '(none)',
            '',
            'NEW MESSAGES (#61 to #63):',
            '[#61] Narrator: The tale goes on, line 61.',
            '',
            '[#62] Narrator: The tale goes on, line 62.',
            '',
            '[#63] Narrator: The tale goes on, line 63.',
        ].join('\n'),
    );
});

test('the chat profile follows the player character when it was read, and is left out when not', () => {
    const state = richBook();
    const messages = storyWith({ 60: 'Mirelle waves.' }).slice(59, 62);
    const plainText = ScribeAnalyzer.input(state, 'Orla', messages);
    assert.equal(ScribeAnalyzer.input(state, 'Orla', messages, null), plainText);
    assert.equal(plainText.includes('PLAYER CHARACTER PROFILE:'), false);
    const profile = 'Orla is a sellsword from the north.\nShe carries a scarred shield.';
    const profiled = ScribeAnalyzer.input(state, 'Orla', messages, profile);
    assert.equal(profiled.startsWith(`PLAYER CHARACTER:\nOrla\n\nPLAYER CHARACTER PROFILE:\n${profile}\n\nSUBJECTS:\n`), true);
    assert.equal(profiled.replace(`PLAYER CHARACTER PROFILE:\n${profile}\n\n`, ''), plainText);
    assert.equal(ScribeAnalyzer.Settings.Headings.Profile, 'PLAYER CHARACTER PROFILE:');
    const notes = [{ text: 'Mirelle is tired', position: 12 }];
    assert.equal(ScribeAnalyzer.notesInput(state, 'Orla', notes).includes('PLAYER CHARACTER PROFILE:'), false);
});

test('the notes input lists numbered notes', () => {
    const log = ScribeLog.create();
    const state = apply(
        log,
        answer({
            SUBJECTS: ['Halvard | character', 'Isolde | character', 'Tamsin | character'],
            FACTS: ['Halvard | trait | proud | #2', 'Isolde | trait | quiet | #3'],
            SCENES: ['Day 1 | #1-#5 | The mill | public | present: Halvard | They talk'],
        }),
        stretch(1, 10),
    );
    const notes = [
        { text: 'Her sword was a gift from Isolde', position: 12 },
        { text: 'Tamsin fears deep water', position: 14 },
    ];
    assert.equal(
        ScribeAnalyzer.notesInput(state, 'Orla', notes),
        [
            'PLAYER CHARACTER:',
            'Orla',
            '',
            'SUBJECTS:',
            '- Halvard (character)',
            '- Isolde (character)',
            '- Tamsin (character)',
            '',
            'LEDGER:',
            '## Isolde',
            'F2 trait: quiet (#3)',
            '## Tamsin',
            '(no facts yet)',
            '',
            'PLAYER NOTES:',
            '[#12] Her sword was a gift from Isolde',
            '[#14] Tamsin fears deep water',
        ].join('\n'),
    );
});

test('the answers input lists questions with answers', () => {
    const log = ScribeLog.create();
    apply(
        log,
        answer({
            SUBJECTS: ['Halvard | character', 'Brandt | character', 'Isolde | character'],
            FACTS: ['Halvard | trait | proud | #2', 'Brandt | role | bell-ringer | #3'],
            QUESTIONS: ['Does Halvard trust Kira? | #2', 'Who rang the bell? | #3'],
        }),
        pick(2, 3),
    );
    rule(log, { type: 'Answer', question: 'Q1', text: 'He does not' });
    const state = rule(log, { type: 'Answer', question: 'Q2', text: 'Brandt rang it' });
    assert.equal(
        ScribeAnalyzer.answersInput(state, 'Orla', state.questions),
        [
            'PLAYER CHARACTER:',
            'Orla',
            '',
            'SUBJECTS:',
            '- Halvard (character)',
            '- Brandt (character)',
            '- Isolde (character)',
            '',
            'LEDGER:',
            '## Halvard',
            'F1 trait: proud (#2)',
            '## Brandt',
            'F2 role: bell-ringer (#3)',
            '',
            'ANSWERED QUESTIONS:',
            '[#2] Does Halvard trust Kira? ANSWER: He does not',
            '[#3] Who rang the bell? ANSWER: Brandt rang it',
        ].join('\n'),
    );
});

test('owner and pinned facts are marked apart', () => {
    const log = ScribeLog.create();
    const disputed = apply(
        log,
        answer({
            FACTS: [
                'Halvard | age | forty | #2',
                'Halvard | age | fifty | #3',
                'Halvard | eyes | grey | hidden | #2',
                'Halvard | eyes | blue | #3',
            ],
        }),
        pick(2, 3),
    );
    assert.equal(ScribeLog.keepFirst(log, disputed).length, 2);
    const pin = { type: 'Pin', subject: 'S1', category: 'hair', target: null, text: 'black', hidden: false };
    rule(log, pin);
    rule(log, { ...pin, category: 'skin', text: 'pale', hidden: true });
    const added = {
        type: 'AddFact',
        subject: 'S1',
        category: 'trait',
        target: null,
        text: 'kind to strangers',
        hidden: false,
        cite: null,
        position: 0,
    };
    rule(log, added);
    const state = rule(log, { ...added, text: 'fears the sea', hidden: true });
    assert.deepEqual(
        plain(
            state.facts
                .filter((fact) => fact.status === 'InForce')
                .map((fact) => [fact.id, fact.origin, fact.pinned, fact.hidden]),
        ),
        [
            ['F9', 'Operator', false, false],
            ['F10', 'Operator', false, true],
            ['F1', 'Story', true, false],
            ['F3', 'Story', true, true],
            ['F7', 'Operator', true, false],
            ['F8', 'Operator', true, true],
        ],
    );
    assert.deepEqual(ledgerOf(state, 'Halvard waits.'), [
        '## Halvard',
        'F9 trait: kind to strangers (owner)',
        'F10 trait: fears the sea (owner) hidden',
        'F1 age: forty (#2) pinned',
        'F3 eyes: grey (#2) pinned hidden',
        'F7 hair: black (owner) pinned',
        'F8 skin: pale (owner) pinned hidden',
    ]);
});

test('a hidden fact made public is not marked hidden', () => {
    const log = ScribeLog.create();
    apply(
        log,
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character'],
            FACTS: [
                'Halvard | background | deserted at the siege | hidden | #2',
                'Halvard | trait | fears fire | hidden | #2',
                'Halvard | trait | hums when nervous | hidden | #2',
            ],
        }),
        pick(2),
    );
    const [mirelle] = idsOf(ScribeReplay.run(log, storyOrder), 'Mirelle');
    rule(log, { type: 'Widen', fact: 'F1', to: 'Everyone' });
    const state = rule(log, { type: 'Widen', fact: 'F2', to: [mirelle] });
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.hidden, fact.widened])), [
        ['F1', true, 'Everyone'],
        ['F2', true, [mirelle]],
        ['F3', true, null],
    ]);
    assert.deepEqual(ledgerOf(state, 'Halvard waits.'), [
        '## Halvard',
        'F1 background: deserted at the siege (#2)',
        'F2 trait: fears fire (#2) hidden',
        'F3 trait: hums when nervous (#2) hidden',
    ]);
});

test('nothing from after the stretch is shown', () => {
    const log = ScribeLog.create();
    apply(
        log,
        answer({
            SUBJECTS: ['Halvard | character'],
            FACTS: [
                'Halvard | trait | proud | #10',
                'Halvard | trait | wary | #40',
                'Halvard | trait | vengeful | #70',
                'Halvard | belonging | a stolen ship | #70',
            ],
            THREADS: [
                'OPEN | the debt to Brandt | #5',
                'OPEN | the sealed letter | #40',
                'OPEN | the stolen ship | #75',
            ],
            QUESTIONS: ['Does Halvard trust Kira? | #12'],
        }),
        stretch(1, 80),
    );
    const state = rule(log, { type: 'Answer', question: 'Q1', text: 'He does not' });
    const early = ScribeAnalyzer.input(state, 'Orla', storyWith({ 1: 'Halvard waits.' }).slice(0, 40));
    assert.deepEqual(sectionOf(early, 'LEDGER:'), ['## Halvard', 'F1 trait: proud (#10)', 'F2 trait: wary (#40)']);
    assert.deepEqual(sectionOf(early, 'OPEN THREADS:'), ['T1: the debt to Brandt', 'T2: the sealed letter']);
    const late = ScribeAnalyzer.input(state, 'Orla', storyWith({ 41: 'Halvard waits.' }).slice(40, 80));
    const everything = [
        '## Halvard',
        'F1 trait: proud (#10)',
        'F2 trait: wary (#40)',
        'F3 trait: vengeful (#70)',
        'F4 belonging: a stolen ship (#70)',
    ];
    assert.deepEqual(sectionOf(late, 'LEDGER:'), everything);
    assert.deepEqual(sectionOf(late, 'OPEN THREADS:'), [
        'T1: the debt to Brandt',
        'T2: the sealed letter',
        'T3: the stolen ship',
    ]);
    const notes = ScribeAnalyzer.notesInput(state, 'Orla', [{ text: 'Halvard is tired', position: 12 }]);
    assert.deepEqual(sectionOf(notes, 'LEDGER:'), everything);
    assert.deepEqual(sectionOf(ScribeAnalyzer.answersInput(state, 'Orla', state.questions), 'LEDGER:'), everything);
});

test('answers input skips unanswered questions', () => {
    const log = ScribeLog.create();
    apply(
        log,
        answer({
            SUBJECTS: ['Halvard | character', 'Isolde | character'],
            QUESTIONS: ['Does Halvard trust Kira? | #2', 'Is Isolde a spy? | #3', 'Who rang the bell? | #4'],
        }),
        pick(2, 3, 4),
    );
    rule(log, { type: 'Answer', question: 'Q1', text: 'He does not' });
    const state = rule(log, { type: 'Answer', question: 'Q3', text: 'Nobody did' });
    assert.deepEqual(plain(state.questions.map((question) => question.answer)), ['He does not', null, 'Nobody did']);
    const text = ScribeAnalyzer.answersInput(state, 'Orla', state.questions);
    assert.deepEqual(sectionOf(text, 'ANSWERED QUESTIONS:'), [
        '[#2] Does Halvard trust Kira? ANSWER: He does not',
        '[#4] Who rang the bell? ANSWER: Nobody did',
    ]);
    assert.deepEqual(sectionOf(text, 'LEDGER:'), ['## Halvard', '(no facts yet)']);
});

test('short forms select', () => {
    const log = ScribeLog.create();
    const state = apply(
        log,
        answer({
            SUBJECTS: [
                'Halvard Brandt | character',
                'Lady Isolde | character',
                'The Ferryman | character',
                'Kira Brandt | character',
                'Maren of the Vale | character',
                'Tamsin and Oswin | group',
                'Orla du Corvane | character',
                'The Oak | place',
            ],
        }),
        pick(1),
    );
    const [halvard, isolde, ferryman, kira, maren, pair, orla, oak] = idsOf(
        state,
        'Halvard Brandt',
        'Lady Isolde',
        'The Ferryman',
        'Kira Brandt',
        'Maren of the Vale',
        'Tamsin and Oswin',
        'Orla du Corvane',
        'The Oak',
    );
    /**
     * @param {string} text
     * @return {string[]}
     */
    const chosen = (text) => plain(ScribeAnalyzer.select(state, text, 'Aldric', 1));
    assert.deepEqual(chosen('Halvard waits'), [halvard]);
    assert.deepEqual(chosen('Isolde waits'), [isolde]);
    assert.deepEqual(chosen('the ferryman waits'), [ferryman]);
    assert.deepEqual(chosen('Ferryman!'), [ferryman]);
    assert.deepEqual(chosen('Brandt waits'), [halvard, kira]);
    assert.deepEqual(chosen('the Vale and Oswin'), [maren, pair]);
    assert.deepEqual(chosen('Corvane'), [orla]);
    assert.deepEqual(chosen('an oak waits'), [oak]);
    assert.deepEqual(chosen('of the and Du'), []);
    assert.deepEqual(chosen('her ladyship hired a valet'), []);
    assert.deepEqual(chosen('Brandtson and Halvardine'), []);
});

test('a two-letter name word selects only with its capitals', () => {
    const log = ScribeLog.create();
    const state = apply(
        log,
        answer({
            SUBJECTS: [
                'Jo Vance | character',
                'An Orla | character',
                'Maren Of Vale | character',
                'Oswin X | character',
                'Jö Brandt | character',
            ],
        }),
        pick(1),
    );
    const [jo, an, maren, oswin, umlaut] = idsOf(
        state,
        'Jo Vance',
        'An Orla',
        'Maren Of Vale',
        'Oswin X',
        'Jö Brandt',
    );
    /**
     * @param {string} text
     * @return {string[]}
     */
    const chosen = (text) => plain(ScribeAnalyzer.select(state, text, 'Aldric', 1));
    assert.deepEqual(chosen('Jo waits'), [jo]);
    assert.deepEqual(chosen("Jo's hat"), [jo]);
    assert.deepEqual(chosen('They called\nJo twice'), [jo]);
    assert.deepEqual(chosen('jo waits'), []);
    assert.deepEqual(chosen('JO waits'), []);
    assert.deepEqual(chosen('Job waits'), []);
    assert.deepEqual(chosen('an old inn'), []);
    assert.deepEqual(chosen('An waits'), [an]);
    assert.deepEqual(chosen('Of course'), []);
    assert.deepEqual(chosen('X marks the spot'), []);
    assert.deepEqual(chosen('Jö waits'), [umlaut]);
    assert.deepEqual(chosen('VANCE and orla and vale and oswin'), [jo, an, maren, oswin]);
});

test('names are folded like the log folds them', () => {
    const log = ScribeLog.create();
    const state = apply(
        log,
        answer({
            SUBJECTS: ["D'Arvel | character", 'The Ox | place', 'Anã | character', 'Ana | character'],
        }),
        pick(1),
    );
    const [darvel, ox, tilde, ana] = idsOf(state, "D'Arvel", 'The Ox', 'Anã', 'Ana');
    /**
     * @param {object} book
     * @param {string} text
     * @return {string[]}
     */
    const chosen = (book, text) => plain(ScribeAnalyzer.select(book, text, 'Aldric', 1));
    assert.deepEqual(chosen(state, 'to D’Arvel.'), [darvel]);
    assert.deepEqual(chosen(state, 'to D‘Arvel.'), [darvel]);
    assert.deepEqual(chosen(state, 'to Dʼarvel.'), [darvel]);
    assert.deepEqual(chosen(state, 'They reached The\nOx at dusk.'), [ox]);
    assert.deepEqual(chosen(state, 'They reached the  ox at dusk.'), [ox]);
    assert.deepEqual(chosen(state, 'They reached the\r\n\tOx at dusk.'), [ox]);
    assert.deepEqual(chosen(state, 'Anã waits'), [tilde]);
    assert.deepEqual(chosen(state, 'Anã waits'), [tilde]);
    assert.deepEqual(chosen(state, 'Ana waits'), [ana]);
    assert.deepEqual(chosen(state, 'Ana̳ waits'), []);
    assert.deepEqual(chosen(state, 'Ａｎａ waits'), []);
    const reverse = ScribeLog.create();
    const turned = apply(reverse, answer({ SUBJECTS: ['D’Arvel | character', 'Anã | character'] }), pick(1));
    const [curly, decomposed] = idsOf(turned, 'D’Arvel', 'Anã');
    assert.deepEqual(chosen(turned, "to D'Arvel."), [curly]);
    assert.deepEqual(chosen(turned, 'Anã waits'), [decomposed]);
    assert.deepEqual(chosen(turned, 'Ana waits'), []);
});

test('speakers and bracketed labels are selected', () => {
    const log = ScribeLog.create();
    apply(
        log,
        answer({
            SUBJECTS: [
                'Halvard | character',
                'Tamsin | character',
                'Oswin | character',
                "Oswin (Tamsin's uncle) | character",
                'Mirelle | character',
            ],
            FACTS: [
                'Mirelle | aka | the Red Hand | #2',
                'Halvard | relation to Oswin | trusts him | #5',
                "Halvard | relation to Oswin (Tamsin's uncle) | fears him | #5",
                'Mirelle | aka | the Wolf’s Daughter | #5',
            ],
        }),
        pick(2, 5),
    );
    const state = apply(
        log,
        answer({ FACTS: ["Oswin (Tamsin's uncle) | relation to Halvard | despises him | #20"] }),
        pick(20),
    );
    const [halvard, tamsin, oswin, uncle, mirelle] = idsOf(
        state,
        'Halvard',
        'Tamsin',
        'Oswin',
        "Oswin (Tamsin's uncle)",
        'Mirelle',
    );
    assert.deepEqual(plain(state.stale), [{ subject: halvard, target: uncle }]);
    const spoken = storyWith({ 61: ['Tamsin', 'I will go alone.'] }).slice(60, 61);
    assert.equal(ScribeIntake.transcript(spoken), '[#61] Tamsin: I will go alone.');
    assert.deepEqual(sectionOf(ScribeAnalyzer.input(state, 'Orla', spoken), 'LEDGER:'), [
        '## Tamsin',
        '(no facts yet)',
    ]);
    /**
     * @param {string} text
     * @return {string[]}
     */
    const chosen = (text) => plain(ScribeAnalyzer.select(state, text, 'Orla', 1));
    assert.deepEqual(chosen('Oswin waits'), [oswin, uncle]);
    assert.deepEqual(chosen('the red  hand waits'), [mirelle]);
    assert.deepEqual(chosen('The Red\nHand waits'), [mirelle]);
    assert.deepEqual(chosen('a red cloth in his hand'), []);
    assert.deepEqual(chosen("they fear the wolf's daughter"), [mirelle]);
    assert.deepEqual(chosen('Tamsin waits'), [tamsin]);
    assert.deepEqual(ledgerOf(state, 'Halvard waits.'), [
        '## Halvard',
        'F2 relation to Oswin: trusts him (#5)',
        "F3 relation to Oswin (Tamsin's uncle): fears him (#5) (check: the other side has changed)",
    ]);
});

test('the running scene stays in last scenes', () => {
    const log = ScribeLog.create();
    const state = apply(
        log,
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Tamsin | character', 'Kira | character'],
            SCENES: [
                'Day 1 | #2-#40 | The mill | public | present: Halvard | The long watch',
                'Day 1 | #5-#10 | The yard | public | present: Mirelle | She trains',
                'Day 1 | #12-#20 | The inn | private | present: Tamsin | She drinks',
                'Day 1 | #22-#30 | The road | public | present: Kira | She rides',
            ],
        }),
        stretch(1, 45),
    );
    const text = ScribeAnalyzer.input(state, 'Orla', stretch(50, 50));
    assert.deepEqual(sectionOf(text, 'LAST SCENES:'), [
        'Day 1 | #12-#20 | The inn | private | present: Tamsin | She drinks',
        'Day 1 | #22-#30 | The road | public | present: Kira | She rides',
        'Day 1 | #2-#40 | The mill | public | present: Halvard | The long watch',
    ]);
    assert.deepEqual(sectionOf(text, 'LEDGER:'), ['## Halvard', '(no facts yet)']);
});

test('the prompts teach only what the parser accepts', () => {
    const placeholders = [
        ['#first-#last', '#3-#5'],
        ['#n "words copied from an earlier message', '#2 "words copied from an earlier message'],
        ['#n', '#4'],
        ['Day N', 'Day 2'],
        ['public or private', 'public'],
        ['| kind', '| character'],
    ];
    let text = examples(ScribeAnalyzer.Prompt).join('\n');
    for (const [placeholder, value] of placeholders) {
        text = text.replaceAll(placeholder, value);
    }
    const lines = text.split('\n');
    for (const [block, trailer] of [
        ['SUBJECTS', ' | #3'],
        ['SCENES', ' | #5'],
        ['NIGHTS', ' | #5'],
    ]) {
        const own = lines[lines.indexOf(`=== ${block}`) + 1];
        const accepted = ScribeAnswer.parse(`=== ${block}\n${own}`);
        assert.deepEqual([accepted.operations.length, accepted.refused.length], [1, 0], own);
        const numbered = ScribeAnswer.parse(`=== ${block}\n${own}${trailer}`);
        assert.deepEqual([numbered.operations.length, numbered.refused.length], [0, 1], own + trailer);
    }
    for (const prompt of [ScribeAnalyzer.Prompt, ScribeAnalyzer.NotesPrompt, ScribeAnalyzer.AnswersPrompt]) {
        assert.equal(prompt.includes('A SUBJECTS line has no number.'), true);
        assert.equal(prompt.includes('A label never contains # or a comma.'), true);
    }
});

test('the prompt names every block and no removed one', () => {
    const prompt = ScribeAnalyzer.Prompt;
    let previous = -1;
    assert.equal(prompt.includes('=== CONTRADICTIONS'), false);
    for (const block of ScribeAnswer.Blocks.filter((block) => block !== 'CONTRADICTIONS')) {
        const index = prompt.indexOf(`\n=== ${block}\n`);
        assert.ok(index > previous, `=== ${block} at ${index}, after ${previous}`);
        previous = index;
    }
    for (const text of [ScribeAnalyzer.Prompt, ScribeAnalyzer.NotesPrompt, ScribeAnalyzer.AnswersPrompt]) {
        for (const removed of ['=== NOW', '=== TIMELINE', 'knows (', 'secret (', 'name (']) {
            assert.equal(text.includes(removed), false, removed);
        }
    }
    for (const text of [ScribeAnalyzer.NotesPrompt, ScribeAnalyzer.AnswersPrompt]) {
        for (const storyOnly of ['CONTRADICTIONS', 'ENDED FACTS', 'CLOSED THREADS']) {
            assert.equal(text.includes(storyOnly), false, storyOnly);
        }
    }
});

test('every example line in the prompts parses', () => {
    const placeholders = [
        ['#first-#last', '#3-#5'],
        ['#n "words copied from an earlier message', '#2 "words copied from an earlier message'],
        ['#n', '#4'],
        ['Day N', 'Day 2'],
        ['public or private', 'public'],
        ['| kind', '| character'],
        ['| category |', '| trait |'],
    ];
    const expected = [
        [
            ScribeAnalyzer.Prompt,
            [
                'Subject',
                'Alias',
                'Fact',
                'Fact',
                'Change',
                'Refine',
                'End',
                'Told',
                'Scene',
                'Night',
                'ThreadOpen',
                'ThreadClose',
                'Question',
            ],
        ],
        [
            ScribeAnalyzer.NotesPrompt,
            ['Subject', 'Alias', 'Fact', 'Fact', 'Change', 'Refine', 'End', 'ThreadOpen'],
        ],
        [ScribeAnalyzer.AnswersPrompt, ['Subject', 'Alias', 'Fact', 'Fact', 'Change', 'Refine', 'End']],
    ];
    for (const [prompt, types] of expected) {
        let text = examples(prompt).join('\n');
        assert.equal(text.startsWith('=== SUBJECTS\n'), true);
        for (const [placeholder, value] of placeholders) {
            text = text.replaceAll(placeholder, value);
        }
        const parsed = ScribeAnswer.parse(text);
        assert.deepEqual(plain(parsed.refused), [], text);
        assert.deepEqual(
            plain(parsed.operations.map((operation) => operation.type)),
            types,
            text,
        );
    }
    const lines = ScribeAnalyzer.Prompt.split('\n');
    const right = lines.slice(lines.indexOf('Right:') + 1, lines.indexOf('Wrong, and why:'));
    assert.equal(right.length, 6);
    const parsed = ScribeAnswer.parse(['=== FACTS', ...right].join('\n'));
    assert.deepEqual(plain(parsed.refused), []);
    assert.deepEqual(
        plain(parsed.operations.map((operation) => operation.type)),
        ['Fact', 'Fact', 'Fact', 'Fact', 'Fact', 'Fact'],
    );
    assert.equal(parsed.operations.filter((operation) => operation.hidden).length, 1);
});

test('the prompts are exact', () => {
    assert.match(ScribeAnalyzer.Prompt, /=== EVIDENCE\n/);
    assert.match(ScribeAnalyzer.Prompt, /=== READ\n/);
    assert.ok(ScribeAnalyzer.Prompt.includes('blockNumber'));
    assert.ok(ScribeAnalyzer.Prompt.includes('full dragon / length'));
    const prompts = [
        [
            ScribeAnalyzer.Prompt.split('\nEvery row in every block')[0],
            '15. Preserve each account and its speaker when the sources disagree. Leave comparisons and discrepancy findings to the independent Checker.',
            15,
            9352,
            '9454efae',
        ],
        [
            ScribeAnalyzer.NotesPrompt,
            '7. A note that cannot be read as a fact about a subject is left out. Never guess.',
            7,
            3222,
            'e81d5b63',
        ],
        [
            ScribeAnalyzer.AnswersPrompt,
            '6. An answer that settles nothing ("leave it open", "not decided") produces no line. Never guess.',
            6,
            2553,
            'b3928396',
        ],
    ];
    for (const [prompt, lastRule, ruleCount, length, fingerprint] of prompts) {
        assert.equal(typeof prompt, 'string');
        assert.equal(prompt.startsWith('You are the Analyzer:'), true);
        assert.equal(prompt.endsWith(`\n${lastRule}`), true);
        const lines = prompt.split('\n');
        const rules = lines.slice(lines.indexOf('Rules.') + 1);
        assert.deepEqual(
            rules.map((line) => Number(line.match(/^(\d+)\. /)?.[1])),
            Array.from({ length: ruleCount }, (unused, index) => index + 1),
        );
        assert.equal(/\t/.test(prompt), false);
        assert.equal(/ $/m.test(prompt), false);
        assert.deepEqual([prompt.length, ScribeText.fingerprint(prompt)], [length, fingerprint]);
    }
    const profiled =
        "PLAYER CHARACTER PROFILE is the player's own description of their character; trust it for that character.";
    const lines = ScribeAnalyzer.Prompt.split('\n');
    const received = lines.findIndex((line) => line.startsWith('You receive PLAYER CHARACTER,'));
    assert.equal(lines[received + 1], profiled);
    assert.equal(ScribeAnalyzer.NotesPrompt.includes('PLAYER CHARACTER PROFILE'), false);
    assert.equal(ScribeAnalyzer.AnswersPrompt.includes('PLAYER CHARACTER PROFILE'), false);
});

test('selection is quick on a long text', () => {
    const firsts = [
        'Silent',
        'Grey',
        'Red',
        'Black',
        'White',
        'Golden',
        'Hollow',
        'Broken',
        'Hidden',
        'Iron',
        'Salt',
        'Amber',
        'Pale',
        'Bitter',
        'Quiet',
        'Crooked',
        'Burning',
        'Frozen',
        'Wandering',
        'Sunken',
    ];
    const seconds = [
        'Mill',
        'Ferry',
        'Tower',
        'Gate',
        'Lantern',
        'Anchor',
        'Crown',
        'Harbour',
        'Bridge',
        'Forge',
        'Chapel',
        'Market',
        'Orchard',
        'Well',
        'Barrow',
        'Cellar',
        'Stable',
        'Granary',
        'Quarry',
        'Abbey',
        'Garrison',
        'Tannery',
        'Wharf',
        'Kiln',
        'Spire',
    ];
    const labels = firsts.flatMap((first) => seconds.map((second) => `The ${first} ${second}`));
    assert.equal(labels.length, 500);
    const log = ScribeLog.create();
    const state = apply(log, answer({ SUBJECTS: labels.map((label) => `${label} | place`) }), pick(1));
    assert.equal(state.subjects.length, 500);
    const tail = ' The Silent Mill stood empty.';
    const prose = 'the wind moved over the hill and the rain fell on the road. '.repeat(2500);
    const filler = 'a cart rolled past slowly. '.repeat(2000).slice(0, 200000 - prose.length - tail.length);
    const text = prose + filler + tail;
    assert.equal(text.length, 200000);
    assert.equal(text.slice(0, -tail.length).match(/\bthe\b/g).length, 10000);
    const started = performance.now();
    const chosen = ScribeAnalyzer.select(state, text, 'Orla', 1);
    const elapsed = performance.now() - started;
    const expected = labels.filter((label) => label.split(' ').includes('Silent') || label.split(' ').includes('Mill'));
    assert.equal(expected.length, 44);
    assert.deepEqual(plain(chosen), idsOf(state, ...expected));
    assert.ok(elapsed < 20000, `select took ${elapsed} ms`);
});

test('nothing is changed', () => {
    const state = plain(richBook());
    const kept = plain(state);
    const messages = plain(storyWith({ 60: 'Mirelle waves to Halvard.' }).slice(59, 62));
    const keptMessages = plain(messages);
    const notes = [{ text: 'Tamsin keeps a dagger', position: 12 }];
    const keptNotes = plain(notes);
    const questions = plain(state.questions);
    const keptQuestions = plain(questions);
    const chosen = ScribeAnalyzer.select(state, 'Mirelle and Tamsin', 'Orla', 60);
    assert.equal(Object.isFrozen(chosen), true);
    assert.deepEqual(plain(chosen), ['S1', 'S2', 'S3', 'S4']);
    ScribeAnalyzer.input(state, 'Orla', messages);
    ScribeAnalyzer.notesInput(state, 'Orla', notes);
    ScribeAnalyzer.answersInput(state, 'Orla', questions);
    assert.deepEqual(state, kept);
    assert.deepEqual(messages, keptMessages);
    assert.deepEqual(notes, keptNotes);
    assert.deepEqual(questions, keptQuestions);
});
