import assert from 'node:assert/strict';
import test from 'node:test';
import CampaignBuilder from './support/CampaignBuilder.mjs';
import ScribeCore from './support/ScribeCore.mjs';

const { ScribeIntake, ScribeAnswer, ScribeLog, ScribeReplay, ScribeKnowledge } = ScribeCore.load([
    'ScribeText',
    'ScribeCategory',
    'ScribeIntake',
    'ScribeAnswer',
    'ScribeLog',
    'ScribeReplay',
    'ScribeKnowledge',
]);

const builder = new CampaignBuilder('Orla');
for (let number = 1; number <= 100; number++) {
    builder.narrator(`The tale goes on, line ${number}.`);
}
const story = ScribeIntake.read(builder.messages).messages;
const storyOrder = story.map((message) => message.id);

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
 * @param {string} label
 * @return {string}
 */
function idOf(state, label) {
    const found = state.subjects.filter((subject) => subject.label === label);
    assert.equal(found.length, 1, `subjects labelled ${label}`);
    return found[0].id;
}

/**
 * @param {object} state
 * @param {string} text
 * @return {object}
 */
function factSaying(state, text) {
    const found = state.facts.filter((fact) => fact.text === text);
    assert.equal(found.length, 1, `facts saying ${text}`);
    return found[0];
}

/**
 * @param {object} state
 * @param {number} position
 * @return {object}
 */
function factAt(state, position) {
    const found = state.facts.filter((fact) => fact.position === position);
    assert.equal(found.length, 1, `facts at #${position}`);
    return found[0];
}

/**
 * @param {object} state
 * @param {string} place
 * @return {object}
 */
function scenePlaced(state, place) {
    const found = state.scenes.filter((scene) => scene.place === place);
    assert.equal(found.length, 1, `scenes at ${place}`);
    return found[0];
}

/**
 * @param {readonly object[]} facts
 * @return {string[]}
 */
function texts(facts) {
    return plain(facts.map((fact) => fact.text));
}

/**
 * @param {object} state
 * @param {string[]} knowers
 * @param {string} subject
 * @return {void}
 */
function assertAboutAgrees(state, knowers, subject) {
    for (const knower of knowers) {
        const expected = state.facts.filter(
            (fact) =>
                fact.subject === subject &&
                fact.status === ScribeReplay.Status.InForce &&
                ScribeKnowledge.knows(state, knower, fact),
        );
        const found = ScribeKnowledge.about(state, knower, subject).facts;
        assert.deepEqual(
            plain(found.map((fact) => fact.id)),
            plain(expected.map((fact) => fact.id)),
            `about ${subject} for ${knower}`,
        );
    }
}

/**
 * @param {object} state
 * @param {string[]} knowers
 * @param {string} subject
 * @return {void}
 */
function assertScenesAgree(state, knowers, subject) {
    for (const knower of knowers) {
        const expected = state.scenes.filter((scene) => {
            const listed = scene.present.some((entry) => entry.subject === subject);
            const open = scene.reach === 'Public' && !scene.narrowed;
            let whole = true;
            for (let position = scene.firstPosition; position <= scene.lastPosition; position++) {
                whole =
                    whole &&
                    scene.present.some(
                        (entry) =>
                            entry.subject === knower &&
                            (entry.from === null || entry.from <= position) &&
                            (entry.until === null || entry.until >= position),
                    );
            }
            return listed && (open || whole);
        });
        const found = ScribeKnowledge.about(state, knower, subject).scenes;
        assert.deepEqual(
            plain(found.map((scene) => scene.id)),
            plain(expected.map((scene) => scene.id)),
            `scenes of ${subject} for ${knower}`,
        );
    }
}

const cast = [
    'Halvard | character',
    'Isolde | character',
    'Aldric | character',
    'Brandt | character',
    'Mirelle | character',
    'Kira | character',
    'Maren | character',
    'Oswin | character',
];

/**
 * @param {string[]} facts
 * @param {string[]} scenes
 * @param {number} last
 * @return {object}
 */
function book(facts, scenes, last) {
    return apply(ScribeLog.create(), answer({ SUBJECTS: cast, FACTS: facts, SCENES: scenes }), stretch(1, last));
}

/**
 * @param {object} state
 * @param {number} position
 * @return {*}
 */
function heardAt(state, position) {
    return plain(ScribeKnowledge.audience(state, factAt(state, position)));
}

/**
 * @param {object} state
 * @param {string[]} labels
 * @return {string[]}
 */
function idsOf(state, labels) {
    return labels.map((label) => idOf(state, label));
}

/**
 * @param {object} state
 * @return {string[]}
 */
function everyoneIn(state) {
    return state.subjects.map((subject) => subject.id);
}

/**
 * @return {object}
 */
function hallWithAlcove() {
    return book(
        [10, 19, 20, 22, 25, 26].map((position) => `Halvard | trait | sign ${position} | #${position}`),
        [
            'Day 1 | #1-#40 | The hall | public | present: Halvard, Isolde, Aldric, Brandt | They feast',
            'Day 1 | #20-#25 | The alcove | private | present: Isolde, Aldric | They whisper',
        ],
        40,
    );
}

/**
 * @return {object}
 */
function tentAndSquare() {
    return book(
        ['Halvard | trait | sign 27 | #27'],
        [
            'Day 1 | #1-#30 | The tent | private | present: Halvard, Isolde | They rest',
            'Day 1 | #25-#90 | The square | public | present: Brandt, Mirelle | They meet',
        ],
        90,
    );
}

/**
 * @return {object}
 */
function alcoveOutlastingHall() {
    return book(
        ['Halvard | trait | sign 22 | #22'],
        [
            'Day 1 | #1-#40 | The hall | public | present: Brandt, Mirelle | They feast',
            'Day 1 | #20-#80 | The alcove | private | present: Halvard, Isolde | They whisper',
        ],
        80,
    );
}

/**
 * @return {object}
 */
function doorwayInTent() {
    return book(
        ['Halvard | trait | sign 11 | #11'],
        [
            'Day 1 | #1-#40 | The tent | private | present: Halvard, Isolde | They rest',
            'Day 1 | #10-#12 | The doorway | public | present: Brandt, Mirelle | They pass',
        ],
        40,
    );
}

/**
 * @return {object}
 */
function stairAndStudy() {
    return book(
        ['Kira | trait | sign 35 | #35', 'Maren | trait | sign 62 | #62'],
        [
            'Day 1 | #20-#50 | The stair | private | present: Halvard, Brandt | They climb',
            'Day 1 | #30-#40 | The study | private | present: Halvard, Isolde | They read',
            'Day 2 | #55-#80 | The room | private | present: Halvard, Isolde, Aldric | They talk',
            'Day 2 | #60-#65 | The aside | private | present: Isolde, Halvard | They whisper',
        ],
        80,
    );
}

/**
 * @return {{ open: object, narrowed: object }}
 */
function hallWithToast() {
    const log = ScribeLog.create();
    const open = apply(
        log,
        answer({
            SUBJECTS: cast,
            FACTS: ['Halvard | trait | sign 22 | #22'],
            SCENES: [
                'Day 1 | #1-#40 | The hall | public | present: Halvard, Isolde, Aldric | They feast',
                'Day 1 | #20-#25 | The toast | public | present: Halvard, Brandt | They drink',
            ],
        }),
        stretch(1, 40),
    );
    return { open, narrowed: rule(log, { type: 'Narrow', scene: 'MESSAGE-1' }) };
}

/**
 * @return {object}
 */
function emptyVault() {
    return book(
        ['Halvard | trait | sign 10 | #10', 'Halvard | trait | sign 22 | #22'],
        [
            'Day 1 | #1-#40 | The hall | public | present: Halvard, Isolde | They feast',
            'Day 1 | #20-#25 | The vault | private | present: nobody | It waits',
        ],
        40,
    );
}

/**
 * @return {{ open: object, narrowed: object }}
 */
function boundedHall() {
    const log = ScribeLog.create();
    const open = apply(
        log,
        answer({
            SUBJECTS: cast,
            FACTS: ['Halvard | trait | sign 10 | #10', 'Halvard | trait | sign 35 | #35'],
            SCENES: ['Day 1 | #1-#40 | The hall | public | present: Halvard, Isolde (from #30) | They feast'],
        }),
        stretch(1, 40),
    );
    return { open, narrowed: rule(log, { type: 'Narrow', scene: 'MESSAGE-1' }) };
}

/**
 * @param {string} reach
 * @return {{ log: object, state: object }}
 */
function cellar(reach) {
    const log = ScribeLog.create();
    const state = apply(
        log,
        answer({
            SUBJECTS: ['Halvard | character', 'Isolde | character', 'Aldric | character', 'Brandt | character'],
            FACTS: ['Halvard | trait | fears the dark | #20'],
            SCENES: [`Day 1 | #1-#40 | The cellar | ${reach} | present: Isolde, Halvard, Aldric | They whisper`],
        }),
        stretch(1, 40),
    );
    return { log, state };
}

/**
 * @return {object}
 */
function bounded() {
    const habits = {
        5: 'counts coins',
        20: 'fears the dark',
        25: 'hums when nervous',
        26: 'bites his nails',
        27: 'talks in his sleep',
        30: 'sleeps lightly',
        35: 'hates turnips',
    };
    return apply(
        ScribeLog.create(),
        answer({
            SUBJECTS: ['Halvard | character', 'Isolde | character', 'Aldric | character', 'Kira | character'],
            FACTS: Object.entries(habits).map(([position, text]) => `Halvard | trait | ${text} | #${position}`),
            SCENES: [
                'Day 1 | #1-#40 | The cellar | private | present: Halvard, Isolde (until #26), Aldric (from #25), Kira (until #10), Kira (from #30) | They whisper',
            ],
        }),
        stretch(1, 40),
    );
}

/**
 * @return {object}
 */
function nested() {
    const positions = [10, 19, 20, 22, 25, 26, 50, 54, 55, 57, 60, 61, 65, 75, 77, 80, 81, 90];
    return apply(
        ScribeLog.create(),
        answer({
            SUBJECTS: [
                'Halvard | character',
                'Isolde | character',
                'Aldric | character',
                'Brandt | character',
                'Mirelle | character',
            ],
            FACTS: positions.map((position) => `Halvard | trait | sign ${position} | #${position}`),
            SCENES: [
                'Day 1 | #1-#40 | The hall | public | present: Halvard, Isolde, Aldric, Brandt | They feast',
                'Day 1 | #20-#25 | The alcove | private | present: Isolde, Aldric | They whisper',
                'Day 2 | #50-#60 | The stable | private | present: Halvard, Isolde | They saddle',
                'Day 2 | #55-#65 | The yard | public | present: Halvard, Mirelle | They ride',
                'Day 3 | #70-#80 | The road | public | present: Halvard, Brandt | They march',
                'Day 3 | #75-#85 | The tent | private | present: Halvard, Aldric | They rest',
            ],
        }),
        stretch(1, 90),
    );
}

test('a private scene is known to those present', () => {
    const { state } = cellar('private');
    const fact = factSaying(state, 'fears the dark');
    assert.equal(fact.position, 20);
    assert.deepEqual(plain(ScribeKnowledge.audience(state, fact)), [
        idOf(state, 'Halvard'),
        idOf(state, 'Isolde'),
        idOf(state, 'Aldric'),
    ]);
    assert.equal(ScribeKnowledge.knows(state, idOf(state, 'Isolde'), fact), true);
    assert.equal(ScribeKnowledge.knows(state, idOf(state, 'Aldric'), fact), true);
    assert.equal(ScribeKnowledge.knows(state, idOf(state, 'Halvard'), fact), true);
    assert.equal(ScribeKnowledge.knows(state, idOf(state, 'Brandt'), fact), false);
});

test('a public scene reaches everyone', () => {
    const { state } = cellar('public');
    const fact = factSaying(state, 'fears the dark');
    assert.equal(ScribeKnowledge.Everyone, 'Everyone');
    assert.equal(ScribeKnowledge.audience(state, fact), 'Everyone');
    assert.equal(ScribeKnowledge.knows(state, idOf(state, 'Brandt'), fact), true);
    assert.equal(ScribeKnowledge.knows(state, idOf(state, 'Isolde'), fact), true);
});

test('a narrowed public scene reaches only those present', () => {
    const { log, state } = cellar('public');
    assert.equal(ScribeKnowledge.knows(state, idOf(state, 'Brandt'), factSaying(state, 'fears the dark')), true);
    const narrowed = rule(log, { type: 'Narrow', scene: 'MESSAGE-1' });
    const fact = factSaying(narrowed, 'fears the dark');
    assert.equal(narrowed.scenes[0].narrowed, true);
    assert.equal(ScribeKnowledge.knows(narrowed, idOf(narrowed, 'Brandt'), fact), false);
    assert.equal(ScribeKnowledge.knows(narrowed, idOf(narrowed, 'Isolde'), fact), true);
    assert.deepEqual(plain(ScribeKnowledge.audience(narrowed, fact)), [
        idOf(narrowed, 'Halvard'),
        idOf(narrowed, 'Isolde'),
        idOf(narrowed, 'Aldric'),
    ]);
});

test('hidden facts stay with their subject', () => {
    const state = apply(
        ScribeLog.create(),
        answer({
            SUBJECTS: ['Halvard | character', 'Isolde | character', 'Aldric | character', 'Brandt | character'],
            FACTS: [
                'Halvard | background | ran from a battle | hidden | #20',
                'Halvard | trait | fears his father | hidden | #50',
            ],
            SCENES: [
                'Day 1 | #1-#40 | The square | public | present: Halvard, Isolde, Aldric | They meet',
                'Day 1 | #41-#60 | The tent | private | present: Halvard, Isolde | They rest',
            ],
        }),
        stretch(1, 60),
    );
    const halvard = idOf(state, 'Halvard');
    for (const text of ['ran from a battle', 'fears his father']) {
        const fact = factSaying(state, text);
        assert.equal(fact.hidden, true);
        assert.deepEqual(plain(ScribeKnowledge.audience(state, fact)), [halvard], text);
        assert.equal(ScribeKnowledge.knows(state, halvard, fact), true, text);
        for (const other of ['Isolde', 'Aldric', 'Brandt']) {
            assert.equal(ScribeKnowledge.knows(state, idOf(state, other), fact), false, `${other} ${text}`);
        }
    }
    assert.equal(ScribeKnowledge.sceneAt(state, 20).reach, 'Public');
    assert.equal(ScribeKnowledge.sceneAt(state, 50).reach, 'Private');
});

test('told adds one knower', () => {
    const log = ScribeLog.create();
    apply(
        log,
        answer({
            SUBJECTS: [
                'Halvard | character',
                'Mirelle | character',
                'Isolde | character',
                'Aldric | character',
                'Brandt | character',
            ],
            FACTS: ['Halvard | background | ran from a battle | hidden | #20', 'Halvard | trait | snores | #30'],
            SCENES: [
                'Day 1 | #1-#25 | The square | public | present: Halvard, Isolde | They meet',
                'Day 1 | #26-#40 | The tent | private | present: Halvard, Isolde, Aldric | They rest',
            ],
        }),
        stretch(1, 40),
    );
    const state = apply(
        log,
        answer({ TOLD: ['F1 | Halvard | Mirelle | #45', 'F2 | Halvard | Mirelle | #45'] }),
        pick(45),
    );
    const hidden = factSaying(state, 'ran from a battle');
    const snores = factSaying(state, 'snores');
    const mirelle = idOf(state, 'Mirelle');
    assert.deepEqual(plain(ScribeKnowledge.audience(state, hidden)), [idOf(state, 'Halvard'), mirelle]);
    assert.deepEqual(plain(ScribeKnowledge.audience(state, snores)), [
        idOf(state, 'Halvard'),
        idOf(state, 'Isolde'),
        idOf(state, 'Aldric'),
        mirelle,
    ]);
    assert.equal(ScribeKnowledge.knows(state, mirelle, hidden), true);
    assert.equal(ScribeKnowledge.knows(state, mirelle, snores), true);
    assert.equal(ScribeKnowledge.knows(state, idOf(state, 'Isolde'), hidden), false);
    assert.equal(ScribeKnowledge.knows(state, idOf(state, 'Brandt'), hidden), false);
    assert.equal(ScribeKnowledge.knows(state, idOf(state, 'Brandt'), snores), false);
});

test('widening', () => {
    const log = ScribeLog.create();
    apply(
        log,
        answer({
            SUBJECTS: [
                'Halvard | character',
                'Mirelle | character',
                'Tamsin | character',
                'Oswin | character',
                'Isolde | character',
                'Brandt | character',
            ],
            FACTS: ['Halvard | background | ran from a battle | hidden | #20', 'Halvard | trait | snores | #55'],
            SCENES: [
                'Day 1 | #1-#40 | The square | public | present: Halvard, Isolde | They meet',
                'Day 1 | #50-#60 | The tent | private | present: Halvard, Isolde | They rest',
            ],
        }),
        stretch(1, 60),
    );
    const told = apply(
        log,
        answer({ TOLD: ['F1 | Halvard | Mirelle | #65', 'F2 | Halvard | Mirelle | #65'] }),
        pick(65),
    );
    const halvard = idOf(told, 'Halvard');
    const mirelle = idOf(told, 'Mirelle');
    const tamsin = idOf(told, 'Tamsin');
    const oswin = idOf(told, 'Oswin');
    const isolde = idOf(told, 'Isolde');
    const brandt = idOf(told, 'Brandt');
    const two = rule(log, { type: 'Widen', fact: 'F1', to: [oswin, tamsin] });
    assert.deepEqual(plain(ScribeKnowledge.audience(two, factSaying(two, 'ran from a battle'))), [
        halvard,
        mirelle,
        oswin,
        tamsin,
    ]);
    assert.equal(ScribeKnowledge.knows(two, oswin, factSaying(two, 'ran from a battle')), true);
    assert.equal(ScribeKnowledge.knows(two, brandt, factSaying(two, 'ran from a battle')), false);
    const repeated = rule(log, { type: 'Widen', fact: 'F1', to: [tamsin, mirelle, halvard, oswin] });
    assert.deepEqual(plain(ScribeKnowledge.audience(repeated, factSaying(repeated, 'ran from a battle'))), [
        halvard,
        mirelle,
        tamsin,
        oswin,
    ]);
    const tent = rule(log, { type: 'Widen', fact: 'F2', to: [brandt, isolde] });
    assert.deepEqual(plain(ScribeKnowledge.audience(tent, factSaying(tent, 'snores'))), [
        halvard,
        isolde,
        mirelle,
        brandt,
    ]);
    const everyone = rule(log, { type: 'Widen', fact: 'F1', to: 'Everyone' });
    const fact = factSaying(everyone, 'ran from a battle');
    assert.equal(fact.hidden, true);
    assert.equal(ScribeKnowledge.audience(everyone, fact), 'Everyone');
    assert.equal(ScribeKnowledge.knows(everyone, brandt, fact), true);
});

test('late arrival misses what came before', () => {
    const state = bounded();
    const aldric = idOf(state, 'Aldric');
    assert.equal(ScribeKnowledge.knows(state, aldric, factAt(state, 20)), false);
    assert.equal(ScribeKnowledge.knows(state, aldric, factAt(state, 25)), true);
    assert.equal(ScribeKnowledge.knows(state, aldric, factAt(state, 30)), true);
});

test('early leaver misses what came after', () => {
    const state = bounded();
    const isolde = idOf(state, 'Isolde');
    assert.equal(ScribeKnowledge.knows(state, isolde, factAt(state, 26)), true);
    assert.equal(ScribeKnowledge.knows(state, isolde, factAt(state, 27)), false);
});

test('someone who left and came back', () => {
    const state = bounded();
    const halvard = idOf(state, 'Halvard');
    const isolde = idOf(state, 'Isolde');
    const aldric = idOf(state, 'Aldric');
    const kira = idOf(state, 'Kira');
    assert.equal(ScribeKnowledge.knows(state, kira, factAt(state, 5)), true);
    assert.equal(ScribeKnowledge.knows(state, kira, factAt(state, 35)), true);
    assert.equal(ScribeKnowledge.knows(state, kira, factAt(state, 20)), false);
    assert.deepEqual(plain(ScribeKnowledge.audience(state, factAt(state, 5))), [halvard, isolde, kira]);
    assert.deepEqual(plain(ScribeKnowledge.audience(state, factAt(state, 20))), [halvard, isolde]);
    assert.deepEqual(plain(ScribeKnowledge.audience(state, factAt(state, 35))), [halvard, aldric, kira]);
    for (const position of [5, 35]) {
        const heard = plain(ScribeKnowledge.audience(state, factAt(state, position)));
        assert.equal(heard.filter((id) => id === kira).length, 1, `#${position}`);
    }
});

test('notes and hand-added facts are public', () => {
    const log = ScribeLog.create();
    const halvard = idOf(
        apply(
            log,
            answer({
                SUBJECTS: ['Halvard | character', 'Isolde | character', 'Brandt | character'],
                FACTS: ['Halvard | trait | fears the dark | #10'],
                SCENES: ['Day 1 | #1-#40 | The cellar | private | present: Halvard, Isolde | They whisper'],
            }),
            stretch(1, 40),
        ),
        'Halvard',
    );
    apply(
        log,
        answer({
            FACTS: ['Halvard | trait | keeps a diary | #20', 'Halvard | trait | owes a debt | hidden | #22'],
        }),
        pick(20, 22),
        'Notes',
    );
    rule(log, {
        type: 'AddFact',
        subject: halvard,
        category: 'trait',
        target: null,
        text: 'collects coins',
        hidden: false,
        cite: 'MESSAGE-24',
        position: 24,
    });
    const state = rule(log, {
        type: 'AddFact',
        subject: halvard,
        category: 'trait',
        target: null,
        text: 'fears his father',
        hidden: true,
        cite: 'MESSAGE-26',
        position: 26,
    });
    const cellarScene = scenePlaced(state, 'The cellar');
    const cases = [
        ['keeps a diary', 'Notes', 20, false],
        ['owes a debt', 'Notes', 22, true],
        ['collects coins', 'Operator', 24, false],
        ['fears his father', 'Operator', 26, true],
    ];
    for (const [text, origin, position, hidden] of cases) {
        const fact = factSaying(state, text);
        assert.deepEqual([fact.origin, fact.position, fact.hidden], [origin, position, hidden], text);
        assert.equal(ScribeKnowledge.sceneAt(state, fact.position), cellarScene, text);
        if (hidden) {
            assert.deepEqual(plain(ScribeKnowledge.audience(state, fact)), [halvard], text);
            assert.equal(ScribeKnowledge.knows(state, idOf(state, 'Isolde'), fact), false, text);
        } else {
            assert.equal(ScribeKnowledge.audience(state, fact), 'Everyone', text);
            assert.equal(ScribeKnowledge.knows(state, idOf(state, 'Brandt'), fact), true, text);
        }
    }
    assert.deepEqual(plain(ScribeKnowledge.audience(state, factSaying(state, 'fears the dark'))), [
        halvard,
        idOf(state, 'Isolde'),
    ]);
});

test('a fact outside any scene is known only to its subject', () => {
    const log = ScribeLog.create();
    const state = apply(
        log,
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Tamsin | character', 'Brandt | character'],
            FACTS: ['Halvard | trait | fears the dark | #50', 'Halvard | trait | hums | #20'],
            SCENES: ['Day 1 | #1-#40 | The square | public | present: Halvard, Brandt | They meet'],
        }),
        stretch(1, 50),
    );
    const halvard = idOf(state, 'Halvard');
    const mirelle = idOf(state, 'Mirelle');
    const tamsin = idOf(state, 'Tamsin');
    const brandt = idOf(state, 'Brandt');
    assert.equal(ScribeKnowledge.sceneAt(state, 50), null);
    assert.equal(ScribeKnowledge.audience(state, factSaying(state, 'hums')), 'Everyone');
    assert.deepEqual(plain(ScribeKnowledge.audience(state, factSaying(state, 'fears the dark'))), [halvard]);
    assert.equal(ScribeKnowledge.knows(state, brandt, factSaying(state, 'fears the dark')), false);
    const told = apply(log, answer({ TOLD: ['F1 | Halvard | Mirelle | #55'] }), pick(55));
    assert.deepEqual(plain(ScribeKnowledge.audience(told, factSaying(told, 'fears the dark'))), [halvard, mirelle]);
    const widened = rule(log, { type: 'Widen', fact: 'F1', to: [tamsin] });
    const fact = factSaying(widened, 'fears the dark');
    assert.deepEqual(plain(ScribeKnowledge.audience(widened, fact)), [halvard, mirelle, tamsin]);
    assert.equal(ScribeKnowledge.knows(widened, halvard, fact), true);
    assert.equal(ScribeKnowledge.knows(widened, brandt, fact), false);
});

test('a closed scene beats an open one', () => {
    const inside = hallWithAlcove();
    assert.deepEqual(heardAt(inside, 22), idsOf(inside, ['Halvard', 'Isolde', 'Aldric']));
    assert.equal(heardAt(inside, 10), 'Everyone');
    assert.equal(ScribeKnowledge.knows(inside, idOf(inside, 'Brandt'), factAt(inside, 22)), false);
    const across = tentAndSquare();
    assert.deepEqual(heardAt(across, 27), idsOf(across, ['Halvard', 'Isolde']));
    assert.equal(ScribeKnowledge.knows(across, idOf(across, 'Brandt'), factAt(across, 27)), false);
    const outlasting = alcoveOutlastingHall();
    assert.deepEqual(heardAt(outlasting, 22), idsOf(outlasting, ['Halvard', 'Isolde']));
    assert.equal(ScribeKnowledge.knows(outlasting, idOf(outlasting, 'Brandt'), factAt(outlasting, 22)), false);
    const doorway = doorwayInTent();
    assert.deepEqual(heardAt(doorway, 11), idsOf(doorway, ['Halvard', 'Isolde']));
    assert.equal(ScribeKnowledge.knows(doorway, idOf(doorway, 'Mirelle'), factAt(doorway, 11)), false);
    for (const state of [inside, across, outlasting, doorway]) {
        assertAboutAgrees(state, everyoneIn(state), idOf(state, 'Halvard'));
    }
});

test('several closed scenes: only those in all of them', () => {
    const state = stairAndStudy();
    const kira = factAt(state, 35);
    const maren = factAt(state, 62);
    assert.deepEqual(heardAt(state, 35), idsOf(state, ['Kira', 'Halvard']));
    assert.deepEqual(heardAt(state, 62), idsOf(state, ['Maren', 'Isolde', 'Halvard']));
    assert.equal(ScribeKnowledge.knows(state, idOf(state, 'Halvard'), kira), true);
    assert.equal(ScribeKnowledge.knows(state, idOf(state, 'Isolde'), kira), false);
    assert.equal(ScribeKnowledge.knows(state, idOf(state, 'Brandt'), kira), false);
    assert.equal(ScribeKnowledge.knows(state, idOf(state, 'Aldric'), maren), false);
    assertAboutAgrees(state, everyoneIn(state), idOf(state, 'Kira'));
    assertAboutAgrees(state, everyoneIn(state), idOf(state, 'Maren'));
});

test('narrowing covers what lies inside', () => {
    const { open, narrowed } = hallWithToast();
    assert.equal(heardAt(open, 22), 'Everyone');
    const fact = factAt(narrowed, 22);
    assert.deepEqual(heardAt(narrowed, 22), idsOf(narrowed, ['Halvard', 'Isolde', 'Aldric']));
    assert.equal(ScribeKnowledge.knows(narrowed, idOf(narrowed, 'Isolde'), fact), true);
    assert.equal(ScribeKnowledge.knows(narrowed, idOf(narrowed, 'Brandt'), fact), false);
    assert.equal(ScribeKnowledge.knows(narrowed, idOf(narrowed, 'Mirelle'), fact), false);
    assertAboutAgrees(narrowed, everyoneIn(narrowed), idOf(narrowed, 'Halvard'));
});

test('an empty closed scene hides from everyone', () => {
    const state = emptyVault();
    const halvard = idOf(state, 'Halvard');
    assert.equal(scenePlaced(state, 'The vault').present.length, 0);
    assert.deepEqual(heardAt(state, 22), [halvard]);
    assert.equal(heardAt(state, 10), 'Everyone');
    for (const knower of everyoneIn(state)) {
        assert.equal(ScribeKnowledge.knows(state, knower, factAt(state, 22)), knower === halvard, knower);
    }
    assertAboutAgrees(state, everyoneIn(state), halvard);
});

test('bounds count in a narrowed scene', () => {
    const { open, narrowed } = boundedHall();
    const isolde = idOf(narrowed, 'Isolde');
    assert.equal(ScribeKnowledge.knows(open, isolde, factAt(open, 10)), true);
    assert.equal(ScribeKnowledge.knows(narrowed, isolde, factAt(narrowed, 10)), false);
    assert.equal(ScribeKnowledge.knows(narrowed, isolde, factAt(narrowed, 35)), true);
    assert.deepEqual(heardAt(narrowed, 10), idsOf(narrowed, ['Halvard']));
    assert.deepEqual(heardAt(narrowed, 35), idsOf(narrowed, ['Halvard', 'Isolde']));
    assertAboutAgrees(narrowed, everyoneIn(narrowed), idOf(narrowed, 'Halvard'));
});

test('sceneAt returns the deciding scene', () => {
    /**
     * @param {object} state
     * @param {Array<[number, string|null]>} expected
     * @return {void}
     */
    const assertDeciding = (state, expected) => {
        for (const [position, place] of expected) {
            const scene = place === null ? null : scenePlaced(state, place);
            assert.equal(ScribeKnowledge.sceneAt(state, position), scene, `#${position}`);
        }
    };
    assertDeciding(hallWithAlcove(), [
        [1, 'The hall'],
        [19, 'The hall'],
        [20, 'The alcove'],
        [22, 'The alcove'],
        [25, 'The alcove'],
        [26, 'The hall'],
        [40, 'The hall'],
        [41, null],
    ]);
    assertDeciding(tentAndSquare(), [
        [24, 'The tent'],
        [25, 'The tent'],
        [27, 'The tent'],
        [30, 'The tent'],
        [31, 'The square'],
        [90, 'The square'],
        [91, null],
    ]);
    assertDeciding(alcoveOutlastingHall(), [
        [19, 'The hall'],
        [20, 'The alcove'],
        [22, 'The alcove'],
        [40, 'The alcove'],
        [41, 'The alcove'],
        [80, 'The alcove'],
        [81, null],
    ]);
    assertDeciding(doorwayInTent(), [
        [9, 'The tent'],
        [10, 'The tent'],
        [11, 'The tent'],
        [12, 'The tent'],
        [13, 'The tent'],
        [41, null],
    ]);
    assertDeciding(stairAndStudy(), [
        [19, null],
        [20, 'The stair'],
        [30, 'The study'],
        [35, 'The study'],
        [40, 'The study'],
        [41, 'The stair'],
        [52, null],
        [55, 'The room'],
        [60, 'The aside'],
        [62, 'The aside'],
        [66, 'The room'],
        [81, null],
    ]);
    const toast = hallWithToast();
    assertDeciding(toast.open, [
        [19, 'The hall'],
        [22, 'The toast'],
        [26, 'The hall'],
    ]);
    assertDeciding(toast.narrowed, [
        [19, 'The hall'],
        [22, 'The hall'],
        [26, 'The hall'],
        [41, null],
    ]);
    assertDeciding(emptyVault(), [
        [10, 'The hall'],
        [22, 'The vault'],
        [41, null],
    ]);
    assertDeciding(boundedHall().narrowed, [
        [10, 'The hall'],
        [35, 'The hall'],
        [41, null],
    ]);
    const ties = book(
        [],
        [
            'Day 1 | #10-#20 | The barn | private | present: Halvard | They hide',
            'Day 1 | #15-#25 | The loft | private | present: Isolde | She hides',
            'Day 1 | #40-#50 | The green | public | present: Halvard | They play',
            'Day 1 | #45-#55 | The lane | public | present: Isolde | She walks',
            'Day 1 | #60-#99 | The keep | private | present: Halvard | They wait',
            'Day 1 | #70-#72 | The gate | public | present: Isolde | She passes',
        ],
        99,
    );
    assertDeciding(ties, [
        [12, 'The barn'],
        [15, 'The loft'],
        [17, 'The loft'],
        [20, 'The loft'],
        [21, 'The loft'],
        [30, null],
        [42, 'The green'],
        [45, 'The lane'],
        [50, 'The lane'],
        [52, 'The lane'],
        [71, 'The keep'],
        [100, null],
    ]);
});

test('groups know as groups', () => {
    const state = apply(
        ScribeLog.create(),
        answer({
            SUBJECTS: ['Halvard | character', 'Corvane | group', 'Nonette | character'],
            FACTS: ['Nonette | relation to Corvane | sworn to it | #5', 'Halvard | trait | fears the dark | #20'],
            SCENES: ['Day 1 | #10-#30 | The barracks | private | present: Halvard, Corvane | They plan'],
        }),
        stretch(1, 30),
    );
    const halvard = idOf(state, 'Halvard');
    const corvane = idOf(state, 'Corvane');
    const nonette = idOf(state, 'Nonette');
    assert.equal(factSaying(state, 'sworn to it').target, corvane);
    const fact = factSaying(state, 'fears the dark');
    assert.deepEqual(plain(ScribeKnowledge.audience(state, fact)), [halvard, corvane]);
    assert.equal(ScribeKnowledge.knows(state, corvane, fact), true);
    assert.equal(ScribeKnowledge.knows(state, nonette, fact), false);
    assert.deepEqual(texts(ScribeKnowledge.about(state, corvane, halvard).facts), ['fears the dark']);
    assert.deepEqual(texts(ScribeKnowledge.about(state, nonette, halvard).facts), []);
});

test('a merged subject knows as its survivor', () => {
    const log = ScribeLog.create();
    const before = apply(
        log,
        answer({
            SUBJECTS: ['Halvard | character', 'Aldric | character', 'Aldrich | character', 'Brandt | character'],
            FACTS: ['Halvard | trait | fears the dark | #20', 'Aldrich | trait | limps | #22'],
            SCENES: ['Day 1 | #1-#40 | The cellar | private | present: Halvard, Aldrich | They whisper'],
        }),
        stretch(1, 40),
    );
    const halvard = idOf(before, 'Halvard');
    const aldric = idOf(before, 'Aldric');
    const aldrich = idOf(before, 'Aldrich');
    assert.equal(ScribeKnowledge.knows(before, aldric, factSaying(before, 'fears the dark')), false);
    assert.equal(ScribeKnowledge.knows(before, aldrich, factSaying(before, 'fears the dark')), true);
    const state = rule(log, { type: 'Merge', from: aldrich, into: aldric });
    const fact = factSaying(state, 'fears the dark');
    assert.equal(state.subjects.find((subject) => subject.id === aldrich).mergedInto, aldric);
    assert.equal(ScribeKnowledge.knows(state, aldrich, fact), true);
    assert.equal(ScribeKnowledge.knows(state, aldric, fact), true);
    assert.equal(ScribeKnowledge.knows(state, idOf(state, 'Brandt'), fact), false);
    const asKnower = ScribeKnowledge.about(state, aldric, halvard);
    assert.deepEqual(texts(asKnower.facts), ['fears the dark']);
    assert.deepEqual(plain(asKnower.scenes.map((scene) => scene.place)), ['The cellar']);
    assert.deepEqual(plain(ScribeKnowledge.about(state, aldrich, halvard)), plain(asKnower));
    const asSubject = ScribeKnowledge.about(state, halvard, aldric);
    assert.deepEqual(texts(asSubject.facts), ['limps']);
    assert.deepEqual(plain(asSubject.scenes.map((scene) => scene.place)), ['The cellar']);
    assert.deepEqual(plain(ScribeKnowledge.about(state, halvard, aldrich)), plain(asSubject));
    const itself = ScribeKnowledge.about(state, aldric, aldric);
    assert.deepEqual(texts(itself.facts), ['limps']);
    assert.deepEqual(plain(ScribeKnowledge.about(state, aldrich, aldrich)), plain(itself));
});

test('a listener of the short version knows only the short version', () => {
    const log = ScribeLog.create();
    apply(
        log,
        answer({
            SUBJECTS: [
                'Halvard | character',
                'Kira | character',
                'Mirelle | character',
                'Tamsin | character',
                'Isolde | character',
                'Oswin | character',
            ],
            FACTS: ['Halvard | background | fled a battle | hidden | #2', 'Halvard | trait | hums old songs | #3'],
            SCENES: ['Day 1 | #1-#10 | The kitchen | private | present: Halvard, Isolde | They cook'],
        }),
        stretch(1, 10),
    );
    apply(log, answer({ TOLD: ['F1 | Halvard | Kira | #12', 'F1 | Halvard | Mirelle | #12'] }), pick(12));
    const once = apply(
        log,
        answer({
            CHANGES: [
                'F1 | Halvard | background | FULLER: fled a battle at the ford | #20',
                'F2 | Halvard | trait | FULLER: hums old songs of the north | #20',
            ],
        }),
        pick(20),
    );
    const halvard = idOf(once, 'Halvard');
    const kira = idOf(once, 'Kira');
    const mirelle = idOf(once, 'Mirelle');
    const tamsin = idOf(once, 'Tamsin');
    const isolde = idOf(once, 'Isolde');
    const oswin = idOf(once, 'Oswin');
    assert.equal(factSaying(once, 'fled a battle').status, 'Replaced');
    assert.equal(factSaying(once, 'fled a battle at the ford').status, 'InForce');
    const short = ScribeKnowledge.about(once, kira, halvard).facts;
    assert.deepEqual(texts(short), ['fled a battle']);
    assert.equal(short[0].status, 'Replaced');
    assert.deepEqual(texts(ScribeKnowledge.about(once, halvard, halvard).facts), [
        'fled a battle at the ford',
        'hums old songs of the north',
    ]);
    assert.deepEqual(texts(ScribeKnowledge.about(once, isolde, halvard).facts), ['hums old songs']);
    const fullerId = factSaying(once, 'fled a battle at the ford').id;
    apply(
        log,
        answer({ TOLD: [`${fullerId} | Halvard | Mirelle | #25`, `${fullerId} | Halvard | Tamsin | #25`] }),
        pick(25),
    );
    const twice = apply(
        log,
        answer({ CHANGES: [`${fullerId} | Halvard | background | FULLER: fled a battle at the ford by night | #30`] }),
        pick(30),
    );
    assert.equal(twice.refinements.length, 3);
    assert.equal(factSaying(twice, 'fled a battle at the ford').status, 'Replaced');
    assert.deepEqual(texts(ScribeKnowledge.about(twice, kira, halvard).facts), ['fled a battle']);
    assert.deepEqual(texts(ScribeKnowledge.about(twice, mirelle, halvard).facts), ['fled a battle at the ford']);
    assert.deepEqual(texts(ScribeKnowledge.about(twice, tamsin, halvard).facts), ['fled a battle at the ford']);
    assert.deepEqual(texts(ScribeKnowledge.about(twice, isolde, halvard).facts), ['hums old songs']);
    assert.deepEqual(texts(ScribeKnowledge.about(twice, oswin, halvard).facts), []);
    assert.deepEqual(texts(ScribeKnowledge.about(twice, halvard, halvard).facts), [
        'hums old songs of the north',
        'fled a battle at the ford by night',
    ]);
    assert.equal(ScribeKnowledge.knows(twice, kira, factSaying(twice, 'fled a battle at the ford by night')), false);
});

test('about returns only what stands', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        answer({
            SUBJECTS: ['Halvard | character', 'Isolde | character'],
            FACTS: [
                'Halvard | age | forty | #2',
                'Halvard | belonging | a silver ring | #3',
                'Halvard | age | fifty | #4',
                'Halvard | condition | a fever | #5',
                'Halvard | trait | sly | #6',
                'Halvard | location | the mill | #7',
                'Halvard | role | a guard | #9',
            ],
            NIGHTS: ['#8 | they sleep at the inn'],
            SCENES: ['Day 1 | #1-#60 | The square | public | present: Halvard, Isolde | They meet'],
        }),
        pick(1, 2, 3, 4, 5, 6, 7, 8, 9, 60),
    );
    const ring = factSaying(first, 'a silver ring').id;
    const mill = factSaying(first, 'the mill').id;
    apply(
        log,
        answer({
            CHANGES: [`${ring} | Halvard | belonging | ENDED: lost it | #10`, `${mill} | Halvard | location | the inn | #70`],
            FACTS: ['Halvard | location | the harbour | #75', 'Halvard | role | a smuggler | #76'],
        }),
        pick(10, 70, 75, 76),
    );
    const state = rule(log, { type: 'RemoveFact', fact: factSaying(first, 'sly').id });
    const halvard = idOf(state, 'Halvard');
    const isolde = idOf(state, 'Isolde');
    const expected = [
        ['forty', 'InForce'],
        ['a silver ring', 'Ended'],
        ['fifty', 'Disputed'],
        ['a fever', 'Expired'],
        ['sly', 'Removed'],
        ['the mill', 'Replaced'],
        ['a guard', 'Replaced'],
        ['the inn', 'Replaced'],
        ['the harbour', 'InForce'],
        ['a smuggler', 'InForce'],
    ];
    for (const [text, status] of expected) {
        const fact = factSaying(state, text);
        assert.equal(fact.status, status, text);
        if (fact.position < 60) {
            assert.equal(ScribeKnowledge.knows(state, isolde, fact), true, text);
        }
    }
    assert.deepEqual(plain(state.refinements), []);
    assert.equal(ScribeKnowledge.knows(state, isolde, factSaying(state, 'the harbour')), false);
    assert.equal(ScribeKnowledge.knows(state, isolde, factSaying(state, 'a smuggler')), false);
    assert.deepEqual(texts(ScribeKnowledge.about(state, isolde, halvard).facts), ['forty']);
    assert.deepEqual(texts(ScribeKnowledge.about(state, halvard, halvard).facts), [
        'forty',
        'the harbour',
        'a smuggler',
    ]);
});

test('about returns facts and attended scenes', () => {
    const state = apply(
        ScribeLog.create(),
        answer({
            SUBJECTS: ['Halvard | character', 'Aldric | character', 'Mirelle | character', 'Isolde | character'],
            FACTS: [
                'Halvard | trait | laughs loudly | #5',
                'Mirelle | trait | sings | #6',
                'Halvard | trait | drinks wine | #22',
                'Halvard | trait | hates turnips | #25',
                'Halvard | trait | whistles | #35',
                'Halvard | trait | reads at night | #55',
            ],
            SCENES: [
                'Day 1 | #1-#40 | The hall | public | present: Halvard, Mirelle | They feast',
                'Day 1 | #20-#30 | The dinner | private | present: Halvard, Aldric | They dine',
                'Day 2 | #50-#60 | The study | private | present: Halvard, Isolde | They read',
                'Day 3 | #70-#80 | The market | public | present: Aldric, Mirelle | They trade',
                'Day 3 | #85-#95 | The forge | private | present: Aldric, Isolde | They work',
            ],
        }),
        stretch(1, 95),
    );
    const halvard = idOf(state, 'Halvard');
    const aldric = idOf(state, 'Aldric');
    const mirelle = idOf(state, 'Mirelle');
    const isolde = idOf(state, 'Isolde');
    const seen = ScribeKnowledge.about(state, aldric, halvard);
    assert.deepEqual(texts(seen.facts), ['laughs loudly', 'drinks wine', 'hates turnips', 'whistles']);
    assert.deepEqual(plain(seen.scenes.map((scene) => scene.place)), ['The hall', 'The dinner']);
    assert.equal(seen.scenes[0], scenePlaced(state, 'The hall'));
    assert.equal(seen.scenes[1], scenePlaced(state, 'The dinner'));
    const studied = ScribeKnowledge.about(state, isolde, halvard);
    assert.deepEqual(texts(studied.facts), ['laughs loudly', 'whistles', 'reads at night']);
    assert.deepEqual(plain(studied.scenes.map((scene) => scene.place)), ['The hall', 'The study']);
    const watched = ScribeKnowledge.about(state, mirelle, halvard);
    assert.deepEqual(texts(watched.facts), ['laughs loudly', 'whistles']);
    assert.deepEqual(plain(watched.scenes.map((scene) => scene.place)), ['The hall']);
    assertAboutAgrees(state, [halvard, aldric, mirelle, isolde], halvard);
    assertScenesAgree(state, [halvard, aldric, mirelle, isolde], halvard);
});

test('a summary needs the whole scene', () => {
    const state = book(
        [],
        [
            'Day 1 | #1-#40 | The cellar | private | present: Halvard (until #15), Aldric, Isolde (from #30), Kira (until #20), Kira (from #21), Oswin (until #20), Oswin (from #22) | They hide',
        ],
        40,
    );
    const halvard = idOf(state, 'Halvard');
    /**
     * @param {object} replayed
     * @param {string} label
     * @return {string[]}
     */
    const summaries = (replayed, label) =>
        plain(ScribeKnowledge.about(replayed, idOf(replayed, label), idOf(replayed, 'Halvard')).scenes.map((scene) => scene.place));
    assert.deepEqual(summaries(state, 'Isolde'), []);
    assert.deepEqual(summaries(state, 'Aldric'), ['The cellar']);
    assert.equal(ScribeKnowledge.about(state, idOf(state, 'Aldric'), halvard).scenes[0], scenePlaced(state, 'The cellar'));
    assert.deepEqual(summaries(state, 'Kira'), ['The cellar']);
    assert.deepEqual(summaries(state, 'Oswin'), []);
    assert.deepEqual(summaries(state, 'Halvard'), []);
    assert.deepEqual(summaries(state, 'Brandt'), []);
    assertScenesAgree(state, everyoneIn(state), halvard);
    const log = ScribeLog.create();
    const open = apply(
        log,
        answer({
            SUBJECTS: cast,
            SCENES: [
                'Day 1 | #1-#20 | The square | public | present: Halvard, Isolde | They meet',
                'Day 1 | #30-#50 | The yard | public | present: Halvard, Isolde | They train',
            ],
        }),
        stretch(1, 50),
    );
    assert.deepEqual(summaries(open, 'Brandt'), ['The square', 'The yard']);
    const narrowed = rule(log, { type: 'Narrow', scene: 'MESSAGE-30' });
    assert.deepEqual(summaries(narrowed, 'Brandt'), ['The square']);
    assert.deepEqual(summaries(narrowed, 'Isolde'), ['The square', 'The yard']);
    assertScenesAgree(narrowed, everyoneIn(narrowed), idOf(narrowed, 'Halvard'));
});

test("about lists facts in book order and only the subject's own", () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        answer({
            SUBJECTS: cast,
            FACTS: [
                'Halvard | trait | laughs loudly | #5',
                'Isolde | relation to Halvard | trusts him | #6',
                'Halvard | trait | whistles | #10',
            ],
            SCENES: ['Day 1 | #1-#40 | The hall | public | present: Halvard, Isolde | They feast'],
        }),
        stretch(1, 40),
    );
    const halvard = idOf(first, 'Halvard');
    const isolde = idOf(first, 'Isolde');
    assert.equal(factSaying(first, 'trusts him').target, halvard);
    const state = rule(log, { type: 'Pin', subject: halvard, category: 'age', target: null, text: 'forty', hidden: false });
    const pinned = state.facts.at(-1);
    assert.deepEqual(
        [pinned.text, pinned.position, pinned.origin, pinned.pinned, pinned.status],
        ['forty', 0, 'Operator', true, 'InForce'],
    );
    assert.deepEqual(texts(ScribeKnowledge.about(state, isolde, halvard).facts), [
        'laughs loudly',
        'whistles',
        'forty',
    ]);
    assert.deepEqual(texts(ScribeKnowledge.about(state, halvard, halvard).facts), [
        'laughs loudly',
        'whistles',
        'forty',
    ]);
    assert.deepEqual(texts(ScribeKnowledge.about(state, halvard, isolde).facts), ['trusts him']);
});

test('results are frozen all the way down', () => {
    const state = nested();
    const snapshot = plain(state);
    const halvard = idOf(state, 'Halvard');
    let checked = 0;
    for (const knower of everyoneIn(state)) {
        const result = ScribeKnowledge.about(state, knower, halvard);
        assertFrozenDeep(result, `about for ${knower}`);
        for (const fact of result.facts) {
            const text = fact.text;
            assert.throws(() => {
                fact.text = 'changed';
            }, { name: 'TypeError' });
            assert.throws(() => {
                fact.told.push(knower);
            }, { name: 'TypeError' });
            assert.equal(fact.text, text);
            checked++;
        }
        for (const scene of result.scenes) {
            const place = scene.place;
            assert.ok(scene.present.length > 0, place);
            assert.throws(() => {
                scene.place = 'elsewhere';
            }, { name: 'TypeError' });
            assert.throws(() => {
                scene.present[0].until = 1;
            }, { name: 'TypeError' });
            assert.equal(scene.place, place);
            checked++;
        }
    }
    for (const fact of state.facts) {
        const scene = ScribeKnowledge.sceneAt(state, fact.position);
        if (scene === null) {
            continue;
        }
        assertFrozenDeep(scene, `scene at #${fact.position}`);
        assert.throws(() => {
            scene.narrowed = true;
        }, { name: 'TypeError' });
        checked++;
    }
    assert.ok(checked > 0);
    assert.deepEqual(plain(state), snapshot);
});

test('everything returned is frozen and the state is untouched', () => {
    const state = nested();
    const snapshot = plain(state);
    const halvard = idOf(state, 'Halvard');
    const knowers = state.subjects.map((subject) => subject.id);
    assert.equal(Object.isFrozen(ScribeKnowledge), true);
    for (const fact of state.facts) {
        const heard = ScribeKnowledge.audience(state, fact);
        assert.deepEqual(plain(state), snapshot);
        assertFrozenDeep(heard, `audience of ${fact.id}`);
        ScribeKnowledge.sceneAt(state, fact.position);
        assert.deepEqual(plain(state), snapshot);
        for (const knower of knowers) {
            ScribeKnowledge.knows(state, knower, fact);
            assert.deepEqual(plain(state), snapshot);
        }
    }
    assert.ok(state.facts.some((fact) => Array.isArray(ScribeKnowledge.audience(state, fact))));
    for (const knower of knowers) {
        const result = ScribeKnowledge.about(state, knower, halvard);
        assert.deepEqual(plain(state), snapshot);
        assert.equal(Object.isFrozen(result), true);
        assert.equal(Object.isFrozen(result.facts), true);
        assert.equal(Object.isFrozen(result.scenes), true);
        assertFrozenDeep(result, `about for ${knower}`);
    }
    assertFrozenDeep(state, 'state');
});

test('about is quick on a large book', () => {
    const large = new CampaignBuilder('Orla');
    for (let number = 1; number <= 5000; number++) {
        large.narrator(`The long tale goes on, line ${number}.`);
    }
    const messages = ScribeIntake.read(large.messages).messages;
    const order = messages.map((message) => message.id);
    const names = ['Halvard', 'Mirelle', 'Tamsin', 'Oswin', 'Aldric', 'Isolde', 'Kira', 'Orla', 'Maren', 'Brandt'];
    const log = ScribeLog.create();
    let serial = 0;
    for (let block = 0; block < 10; block++) {
        const facts = [];
        const scenes = [];
        for (let offset = 1; offset <= 500; offset++) {
            const hidden = serial % 9 === 0 ? ' | hidden' : '';
            facts.push(`${names[serial % names.length]} | trait | habit ${serial}${hidden} | #${block * 500 + offset}`);
            serial++;
        }
        for (let unit = 0; unit < 20; unit++) {
            const base = block * 500 + unit * 25;
            const first = names[(block + unit) % names.length];
            const second = names[(block + unit + 3) % names.length];
            const third = names[(block + unit + 6) % names.length];
            const fourth = names[(block + unit + 8) % names.length];
            const day = `Day ${block + 1}`;
            if (unit % 4 === 0) {
                scenes.push(
                    `${day} | #${base + 1}-#${base + 25} | The hall | public | present: ${first}, ${second}, ${third} | They gather`,
                    `${day} | #${base + 8}-#${base + 16} | The alcove | private | present: ${first}, ${second} (from #${base + 11}) | They whisper`,
                );
            } else if (unit % 4 === 1) {
                scenes.push(
                    `${day} | #${base + 1}-#${base + 25} | The tent | private | present: ${first}, ${second} (until #${base + 18}), ${third} (from #${base + 5}), ${fourth} (until #${base + 6}), ${fourth} (from #${base + 20}) | They rest`,
                    `${day} | #${base + 10}-#${base + 12} | The doorway | public | present: ${fourth}, ${first} | They pass`,
                );
            } else if (unit % 4 === 2) {
                scenes.push(
                    `${day} | #${base + 1}-#${base + 18} | The loft | private | present: ${first} (until #${base + 9}), ${first} (from #${base + 10}), ${second}, ${third} (until #${base + 12}) | They hide`,
                    `${day} | #${base + 10}-#${base + 22} | The cellar | private | present: ${second}, ${third}, ${fourth} (from #${base + 14}) | They wait`,
                );
            } else {
                scenes.push(
                    `${day} | #${base + 1}-#${base + 15} | The yard | public | present: ${first}, ${third} | They spar`,
                    `${day} | #${base + 11}-#${base + 25} | The stable | private | present: ${second}, ${third} (until #${base + 20}) | They hide`,
                );
            }
        }
        const parsed = ScribeAnswer.parse(answer({ FACTS: facts, SCENES: scenes }));
        assert.equal(parsed.operations.length, 540);
        const result = ScribeLog.append(log, ScribeReplay.run(log, order), parsed.operations, {
            messages: messages.slice(block * 500, block * 500 + 500),
            origin: 'Story',
        });
        assert.deepEqual(plain(result.refused), []);
    }
    const state = ScribeReplay.run(log, order);
    assert.equal(state.facts.length, 5000);
    assert.equal(state.scenes.length, 400);
    assert.ok(state.facts.every((fact) => fact.status === 'InForce'));
    const ids = names.map((name) => idOf(state, name));
    for (let pair = 0; pair < 4; pair++) {
        const knower = ids[pair];
        const subject = ids[pair + 5];
        const known = ScribeKnowledge.about(state, knower, subject).facts.length;
        const owned = state.facts.filter((fact) => fact.subject === subject).length;
        assert.ok(known > 0 && known < owned, `${knower} knows ${known} of ${owned}`);
        assert.ok(ScribeKnowledge.about(state, knower, subject).scenes.length > 0);
        assertAboutAgrees(state, [knower], subject);
        assertScenesAgree(state, [knower], subject);
    }
    let reads = 0;
    const counted = new Proxy(state.scenes, {
        /**
         * @param {object[]} target
         * @param {string|symbol} key
         * @param {*} receiver
         * @return {*}
         */
        get(target, key, receiver) {
            if (typeof key === 'string' && /^\d+$/.test(key)) {
                reads++;
            }
            return Reflect.get(target, key, receiver);
        },
    });
    const observed = ScribeKnowledge.about({ ...state, scenes: counted }, ids[0], ids[1]);
    assert.deepEqual(plain(observed), plain(ScribeKnowledge.about(state, ids[0], ids[1])));
    assert.ok(reads <= 4 * state.scenes.length, `about read ${reads} scenes`);
    const started = performance.now();
    for (let call = 0; call < 200; call++) {
        ScribeKnowledge.about(state, ids[call % ids.length], ids[(call * 7 + 3) % ids.length]);
    }
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 20000, `200 calls took ${elapsed} ms`);
});
