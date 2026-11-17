import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import CampaignBuilder from './support/CampaignBuilder.mjs';

/**
 * @param {string[]} core
 * @param {string[]} page
 * @return {Object<string, object>}
 */
function load(core, page) {
    const context = vm.createContext({ TextEncoder });
    const loaded = {};
    const sources = [...core.map((name) => ['core', name]), ...page.map((name) => ['page', name])];
    for (const [folder, name] of sources) {
        const url = new URL(`../scribe/${folder}/${name}.js`, import.meta.url);
        vm.runInContext(readFileSync(url, 'utf8'), context, { filename: url.pathname });
        loaded[name] = vm.runInContext(name, context);
    }
    return loaded;
}

const { ScribeText, ScribeIntake, ScribeAnswer, ScribeLog, ScribeReplay, ScribeKnowledge, ScribeReminder } = load(
    [
        'ScribeText',
        'ScribeCategory',
        'ScribeIntake',
        'ScribeAnswer',
        'ScribeLog',
        'ScribeReplay',
        'ScribeKnowledge',
        'ScribeAnalyzer',
    ],
    ['ScribeReminder'],
);

const builder = new CampaignBuilder('Halvard');
for (let number = 1; number <= 60; number++) {
    builder.narrator(`The tale goes on, line ${number}.`);
}
const story = ScribeIntake.read(builder.messages).messages;
const storyOrder = story.map((message) => message.id);
const opening = '[Scribe] Day 3, "the mill", private. Present: Halvard, Mirelle.';
const secret = 'Halvard keeps this secret and no one here knows it: ';
const onlyMirelle = 'Of those here only Mirelle knows this about Halvard, the others do not: ';
const notWhole = 'No one here knows the whole of this about Halvard: ';
const curly = String.fromCodePoint(0x2019);
const deseret = String.fromCodePoint(0x10400);
const deseretOther = String.fromCodePoint(0x10401);

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
 * @param {Object<string, string[]>} blocks
 * @param {object[]} messages
 * @return {object}
 */
function apply(log, blocks, messages) {
    const text = Object.entries(blocks)
        .map(([block, lines]) => [`=== ${block}`, ...lines].join('\n'))
        .join('\n');
    const parsed = ScribeAnswer.parse(text);
    assert.deepEqual(plain(parsed.refused), [], text);
    const result = ScribeLog.append(log, ScribeReplay.run(log, storyOrder), parsed.operations, {
        messages,
        origin: 'Story',
    });
    assert.deepEqual(plain(result.refused), [], text);
    return ScribeReplay.run(log, storyOrder);
}

/**
 * @param {Object<string, string[]>} blocks
 * @param {number} last
 * @return {object}
 */
function book(blocks, last) {
    return apply(ScribeLog.create(), blocks, stretch(1, last));
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
 * @param {string[]} labels
 * @return {object}
 */
function scene(state, labels) {
    return {
        day: 3,
        place: 'the mill',
        reach: 'Private',
        present: labels.map((label) => {
            const found = state.subjects.find((subject) => subject.label === label);
            return { subject: found === undefined ? null : found.id, label };
        }),
        summary: 'They talk by the wheel',
    };
}

/**
 * @param {object} state
 * @param {string[]} labels
 * @param {object[]} unread
 * @return {readonly object[]}
 */
function offered(state, labels, unread = []) {
    return ScribeReminder.candidates(state, scene(state, labels), 'Halvard', unread);
}

/**
 * @param {readonly object[]} candidates
 * @param {string|null} kind
 * @return {string[]}
 */
function lines(candidates, kind = null) {
    return plain(candidates.filter((candidate) => kind === null || candidate.kind === kind).map((candidate) => candidate.line));
}

/**
 * @param {readonly object[]} candidates
 * @param {string} id
 * @return {string[]}
 */
function about(candidates, id) {
    return plain(candidates.filter((candidate) => candidate.fact === id).map((candidate) => `${candidate.kind}|${candidate.line}`));
}

/**
 * @param {readonly object[]|null} candidates
 * @return {number[]|null}
 */
function numbers(candidates) {
    return candidates === null ? null : plain(candidates.map((candidate) => candidate.number));
}

/**
 * @param {string} text
 * @return {object[]}
 */
function unreadSaying(text) {
    return ScribeIntake.read(new CampaignBuilder('Halvard').narrator(text).messages).messages;
}

/**
 * @param {Array<object|Error>} answers
 * @return {{ calls: Array<{ system: string, user: string }>, ask: function(string, string): Promise<object> }}
 */
function scripted(answers) {
    const calls = [];
    return {
        calls,
        ask: async (system, user) => {
            calls.push({ system, user });
            const next = answers.shift();
            if (next instanceof Error) {
                throw next;
            }
            return next;
        },
    };
}

/**
 * @param {object} state
 * @param {object} now
 * @param {string} answer
 * @return {Promise<object>}
 */
function composed(state, now, answer = 'USE: none') {
    return ScribeReminder.compose({
        state,
        now,
        player: 'Halvard',
        recent: [],
        unread: [],
        ask: scripted([{ text: answer }]).ask,
    });
}

/**
 * @param {number} habits
 * @param {number} length
 * @return {object}
 */
function crowd(habits, length = 0) {
    const facts = [
        'Halvard | trait | snores | #2',
        'Halvard | background | deserted at the siege | hidden | #3',
        'Halvard | trait | fears the dark | hidden | #4',
    ];
    for (let index = 0; index < habits; index++) {
        facts.push(`Mirelle | trait | habit ${index + 1}${' and more'.repeat(length)} | #${index + 5}`);
    }
    return book(
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character'],
            FACTS: facts,
            SCENES: ['Day 1 | #1-#50 | The cellar | private | present: Halvard, Mirelle | They talk'],
        },
        50,
    );
}

/**
 * @return {object}
 */
function confession() {
    return book(
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Isolde | character'],
            FACTS: [
                'Mirelle | background | poisoned the old king | #5',
                'Mirelle | trait | hums | #15',
                'Mirelle | trait | hoards silver | #25',
            ],
            SCENES: [
                'Day 1 | #1-#10 | The cellar | private | present: Halvard, Mirelle | They confess',
                'Day 1 | #11-#20 | The hall | public | present: Halvard, Mirelle, Isolde | They feast',
                'Day 2 | #21-#30 | The garden | private | present: Mirelle, Isolde | They whisper',
            ],
        },
        30,
    );
}

/**
 * @return {{ log: object, thin: string, full: string, state: object }}
 */
function battle() {
    const log = ScribeLog.create();
    const first = apply(
        log,
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Isolde | character', 'Kira | character'],
            FACTS: ['Halvard | background | fled a battle | hidden | #8'],
            SCENES: ['Day 1 | #1-#10 | The cellar | private | present: Halvard | He broods'],
        },
        stretch(1, 10),
    );
    const thin = factSaying(first, 'fled a battle').id;
    apply(log, { TOLD: [`${thin} | Halvard | Kira | #12`] }, pick(12));
    const state = apply(
        log,
        { CHANGES: [`${thin} | Halvard | background | FULLER: fled a battle at the ford | #15`] },
        pick(15),
    );
    return { log, thin, full: factSaying(state, 'fled a battle at the ford').id, state };
}

/**
 * @param {Array<[string, string]>} texts
 * @return {object}
 */
function added(texts) {
    const log = ScribeLog.create();
    let state = apply(
        log,
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character'],
            SCENES: ['Day 1 | #1-#50 | The hall | public | present: Halvard, Mirelle | They feast'],
        },
        stretch(1, 50),
    );
    const mirelle = idOf(state, 'Mirelle');
    for (const [index, [category, text]] of texts.entries()) {
        state = rule(log, {
            type: 'AddFact',
            subject: mirelle,
            category,
            target: null,
            text,
            hidden: false,
            cite: `MESSAGE-${index + 2}`,
            position: index + 2,
        });
    }
    return state;
}

/**
 * @param {Array<{ subject: string|null, label: string }>} present
 * @param {object} changes
 * @return {object}
 */
function bare(present, changes = {}) {
    return { day: 3, place: 'the mill', reach: 'Private', present, summary: 'They talk', ...changes };
}

test('facts of those present are offered', () => {
    const state = book(
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Isolde | character', 'Brandt | character'],
            FACTS: [
                'Mirelle | eyes | grey | #2',
                'Brandt | trait | snores | #3',
                'Mirelle | relation to Halvard | old friends | #4',
                'Mirelle | relation to Brandt | rivals | #5',
                'Mirelle | trait | hums when nervous | #6',
                'Halvard | trait | laughs loudly | #7',
                'Isolde | eyes | green | #8',
            ],
            SCENES: ['Day 1 | #1-#20 | The mill | public | present: Halvard, Mirelle | They talk'],
        },
        20,
    );
    const expected = [
        'Mirelle, eyes: "grey"',
        'Mirelle toward Halvard: "old friends"',
        'Mirelle, trait: "hums when nervous"',
        'Halvard, trait: "laughs loudly"',
    ];
    const found = offered(state, ['Mirelle', 'a stranger', 'Halvard', 'Mirelle']);
    assert.deepEqual(lines(found), expected);
    assert.deepEqual(numbers(found), [1, 2, 3, 4]);
    assert.deepEqual(plain(found[0]), {
        number: 1,
        kind: 'Fact',
        subject: idOf(state, 'Mirelle'),
        fact: factSaying(state, 'grey').id,
        line: 'Mirelle, eyes: "grey"',
    });
    assertFrozenDeep(found, 'candidates');
    assert.deepEqual(lines(offered(state, ['Mirelle', 'Halvard'])), expected);
    assert.deepEqual(lines(offered(state, ['Halvard', 'Mirelle'])), expected);
    assert.deepEqual(lines(offered(state, ['Mirelle'])), expected);
    assert.deepEqual(lines(offered(state, ['a stranger', 'Corvane'])), ['Halvard, trait: "laughs loudly"']);
    assert.deepEqual(lines(offered(state, ['Halvard', 'Mirelle', 'Brandt'])), [
        'Mirelle, eyes: "grey"',
        'Mirelle toward Halvard: "old friends"',
        'Mirelle toward Brandt: "rivals"',
        'Mirelle, trait: "hums when nervous"',
        'Brandt, trait: "snores"',
        'Halvard, trait: "laughs loudly"',
    ]);
});

test('only what stands is offered', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character'],
            FACTS: [
                'Mirelle | age | forty | #2',
                'Mirelle | belonging | a silver ring | #3',
                'Mirelle | age | fifty | #4',
                'Mirelle | condition | a fever | #5',
                'Mirelle | trait | sly | #6',
                'Mirelle | location | the mill | #7',
                'Halvard | condition | a hidden fever | hidden | #5',
                'Halvard | location | a secret room | hidden | #7',
                'Halvard | belonging | a stolen key | hidden | #9',
                'Halvard | trait | a hidden grudge | hidden | #9',
            ],
            NIGHTS: ['#8 | they sleep at the inn'],
            SCENES: ['Day 1 | #1-#9 | The square | public | present: Halvard, Mirelle | They meet'],
        },
        stretch(1, 9),
    );
    const ring = factSaying(first, 'a silver ring').id;
    const key = factSaying(first, 'a stolen key').id;
    apply(
        log,
        {
            FACTS: ['Mirelle | location | the harbour | #11', 'Halvard | location | the cellar | hidden | #11'],
            CHANGES: [
                `${ring} | Mirelle | belonging | ENDED: lost it | #10`,
                `${key} | Halvard | belonging | ENDED: gave it back | #10`,
            ],
            SCENES: ['Day 1 | #1-#11 | The square | public | present: Halvard, Mirelle | They meet'],
        },
        pick(10, 11),
    );
    rule(log, { type: 'RemoveFact', fact: factSaying(first, 'sly').id });
    rule(log, { type: 'RemoveFact', fact: factSaying(first, 'a hidden grudge').id });
    const state = rule(log, {
        type: 'Pin',
        subject: idOf(first, 'Mirelle'),
        category: 'age',
        target: null,
        text: 'forty',
        hidden: false,
    });
    const gone = [
        ['fifty', 'Disputed'],
        ['a silver ring', 'Ended'],
        ['a fever', 'Expired'],
        ['sly', 'Removed'],
        ['the mill', 'Replaced'],
        ['a hidden fever', 'Expired'],
        ['a secret room', 'Replaced'],
        ['a stolen key', 'Ended'],
        ['a hidden grudge', 'Removed'],
    ];
    for (const [text, status] of gone) {
        assert.equal(factSaying(state, text).status, status, text);
    }
    assert.equal(state.conflicts.length, 0);
    const found = offered(state, ['Halvard', 'Mirelle']);
    assert.deepEqual(lines(found), [
        `${secret}location: "the cellar"`,
        'Mirelle, age: "forty"',
        'Mirelle, location: "the harbour"',
    ]);
    const goneIds = new Set(gone.map(([text]) => factSaying(state, text).id));
    for (const candidate of found) {
        assert.equal(goneIds.has(candidate.fact), false, candidate.line);
    }
});

test('contested facts are left out', () => {
    const state = book(
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Isolde | character'],
            FACTS: [
                'Mirelle | age | forty | #2',
                'Halvard | eyes | grey | #3',
                'Mirelle | age | fifty | #4',
                'Halvard | eyes | blue | #5',
                'Halvard | hair | black | hidden | #6',
                'Halvard | hair | red | hidden | #7',
                'Mirelle | trait | hums | #8',
                'Halvard | trait | laughs loudly | #9',
                'Halvard | background | deserted | hidden | #10',
            ],
            SCENES: ['Day 1 | #1-#20 | The cellar | private | present: Halvard, Mirelle | They hide'],
        },
        20,
    );
    assert.equal(state.conflicts.length, 3);
    const contested = new Set();
    for (const conflict of state.conflicts) {
        contested.add(conflict.established);
        for (const id of conflict.others) {
            contested.add(id);
        }
    }
    for (const text of ['forty', 'fifty', 'grey', 'blue', 'black', 'red']) {
        assert.equal(contested.has(factSaying(state, text).id), true, text);
    }
    const alone = offered(state, ['Halvard', 'Mirelle']);
    assert.deepEqual(lines(alone), [
        `${secret}background: "deserted"`,
        'Mirelle, trait: "hums"',
        'Halvard, trait: "laughs loudly"',
    ]);
    const watched = offered(state, ['Halvard', 'Mirelle', 'Isolde']);
    assert.deepEqual(lines(watched), [`${onlyMirelle}trait: "laughs loudly"`, `${secret}background: "deserted"`]);
    for (const candidate of [...alone, ...watched]) {
        assert.equal(contested.has(candidate.fact), false, candidate.line);
    }
});

test('hidden facts are never offered as plain facts', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character'],
            FACTS: [
                'Mirelle | background | grew up by the sea | hidden | #2',
                'Halvard | background | deserted at the siege | hidden | #3',
                'Mirelle | trait | hums | #4',
                'Halvard | trait | snores | #5',
                'Halvard | trait | fears the dark | hidden | #6',
            ],
            SCENES: ['Day 1 | #1-#20 | The mill | public | present: Halvard, Mirelle | They talk'],
        },
        stretch(1, 20),
    );
    const sea = factSaying(first, 'grew up by the sea').id;
    const dark = factSaying(first, 'fears the dark').id;
    const state = apply(
        log,
        { TOLD: [`${sea} | Mirelle | Halvard | #25`, `${dark} | Halvard | Mirelle | #25`] },
        pick(25),
    );
    assert.equal(ScribeKnowledge.knows(state, idOf(state, 'Halvard'), factSaying(state, 'grew up by the sea')), true);
    const found = offered(state, ['Halvard', 'Mirelle']);
    assert.deepEqual(lines(found, 'Fact'), ['Mirelle, trait: "hums"', 'Halvard, trait: "snores"']);
    assert.deepEqual(lines(found, 'Unknown'), [`${secret}background: "deserted at the siege"`]);
    assert.deepEqual(lines(found, 'Knows'), []);
    for (const candidate of found) {
        assert.equal([sea, dark].includes(candidate.fact), false, candidate.line);
    }
});

test('a hidden fact made public is an ordinary fact', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Isolde | character'],
            FACTS: [
                'Mirelle | background | grew up by the sea | hidden | #2',
                'Halvard | background | deserted at the siege | hidden | #3',
                'Halvard | trait | fears the dark | hidden | #4',
                'Mirelle | trait | hums | #5',
            ],
            SCENES: ['Day 1 | #1-#20 | The mill | public | present: Halvard, Mirelle | They talk'],
        },
        stretch(1, 20),
    );
    rule(log, { type: 'Widen', fact: factSaying(first, 'grew up by the sea').id, to: 'Everyone' });
    rule(log, { type: 'Widen', fact: factSaying(first, 'deserted at the siege').id, to: 'Everyone' });
    const state = rule(log, {
        type: 'Widen',
        fact: factSaying(first, 'fears the dark').id,
        to: [idOf(first, 'Isolde')],
    });
    assert.deepEqual(
        plain(['grew up by the sea', 'deserted at the siege', 'fears the dark'].map((text) => factSaying(state, text).hidden)),
        [true, true, true],
    );
    const found = offered(state, ['Halvard', 'Mirelle']);
    assert.deepEqual(lines(found, 'Fact'), [
        'Mirelle, background: "grew up by the sea"',
        'Mirelle, trait: "hums"',
        'Halvard, background: "deserted at the siege"',
    ]);
    assert.deepEqual(lines(found, 'Unknown'), [`${secret}trait: "fears the dark"`]);
    assert.deepEqual(lines(found, 'Knows'), []);
    const listed = offered(state, ['Halvard', 'Isolde']);
    assert.deepEqual(lines(listed), ['Halvard, background: "deserted at the siege"']);
    const mixed = offered(state, ['Halvard', 'Isolde', 'Mirelle']);
    assert.deepEqual(lines(mixed, 'Fact'), [
        'Mirelle, background: "grew up by the sea"',
        'Mirelle, trait: "hums"',
        'Halvard, background: "deserted at the siege"',
    ]);
    assert.deepEqual(lines(mixed, 'Knows'), [
        'Of those here only Isolde knows this about Halvard, the others do not: trait: "fears the dark"',
    ]);
});

test('what someone knows about the player', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Isolde | character', 'Kira | character'],
            FACTS: [
                'Halvard | trait | snores | #5',
                'Halvard | relation to Kira | owes her money | #6',
                'Halvard | relation to Corvane | fears him | #7',
                'Halvard | background | fled a battle | hidden | #8',
            ],
            SCENES: ['Day 1 | #1-#10 | The cellar | private | present: Halvard, Mirelle | They hide'],
        },
        stretch(1, 10),
    );
    const fled = factSaying(first, 'fled a battle').id;
    apply(log, { TOLD: [`${fled} | Halvard | Kira | #12`] }, pick(12));
    apply(log, { CHANGES: [`${fled} | Halvard | background | FULLER: fled a battle at the ford | #15`] }, pick(15));
    const state = apply(
        log,
        {
            FACTS: ['Halvard | trait | laughs loudly | #25'],
            SCENES: ['Day 2 | #20-#30 | The square | public | present: Halvard, Isolde, Mirelle | They meet'],
        },
        stretch(20, 30),
    );
    assert.equal(ScribeKnowledge.audience(state, factSaying(state, 'laughs loudly')), 'Everyone');
    const found = offered(state, ['Halvard', 'Mirelle', 'Isolde', 'Kira']);
    assert.deepEqual(lines(found), [
        `${onlyMirelle}trait: "snores"`,
        `${onlyMirelle}toward Kira: "owes her money"`,
        `${notWhole}background: "fled a battle at the ford"; only Kira knows a part of it: background: "fled a battle"; the others know nothing of it`,
        'Halvard, trait: "laughs loudly"',
    ]);
    assert.deepEqual(plain(found.map((candidate) => candidate.kind)), ['Knows', 'Knows', 'Unknown', 'Fact']);
    const halvard = idOf(state, 'Halvard');
    assert.deepEqual(plain(found.slice(0, 3).map((candidate) => candidate.subject)), [halvard, halvard, halvard]);
    assert.equal(found[2].fact, factSaying(state, 'fled a battle at the ford').id);
    const isolde = offered(state, ['Halvard', 'Isolde']);
    assert.deepEqual(lines(isolde, 'Knows'), []);
    assert.deepEqual(lines(isolde, 'Unknown'), [
        'No one here knows this about Halvard: trait: "snores"',
        `${secret}background: "fled a battle at the ford"`,
    ]);
});

test('what no one here knows', () => {
    const log = ScribeLog.create();
    const before = apply(
        log,
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Isolde | character'],
            FACTS: [
                'Halvard | aka | Hal | #2',
                'Halvard | background | deserted at the siege | hidden | #5',
                'Halvard | relation to Isolde | loves her | hidden | #6',
            ],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Mirelle, Isolde | They feast'],
        },
        stretch(1, 10),
    );
    const deserted = `${secret}background: "deserted at the siege"`;
    const loves = `${secret}toward Isolde: "loves her"`;
    const first = offered(before, ['Halvard', 'Mirelle']);
    assert.deepEqual(lines(first, 'Unknown'), [deserted]);
    assert.deepEqual(lines(first, 'Knows'), []);
    assert.equal(first[0].subject, idOf(before, 'Halvard'));
    assert.deepEqual(lines(offered(before, ['Halvard', 'Mirelle', 'Isolde']), 'Unknown'), [deserted, loves]);
    for (const player of ['hal', 'HALVARD']) {
        const named = ScribeReminder.candidates(before, scene(before, ['Halvard', 'Mirelle']), player, []);
        assert.deepEqual(lines(named, 'Unknown'), [deserted], player);
    }
    const stranger = ScribeReminder.candidates(before, scene(before, ['Halvard', 'Mirelle']), 'Corvane', []);
    assert.deepEqual(lines(stranger, 'Unknown'), []);
    assert.deepEqual(lines(stranger, 'Knows'), []);
    const after = apply(log, { TOLD: [`${factSaying(before, 'deserted at the siege').id} | Halvard | Mirelle | #12`] }, pick(12));
    assert.deepEqual(lines(offered(after, ['Halvard', 'Mirelle'])), ['Halvard, aka: "Hal"']);
    const watched = offered(after, ['Halvard', 'Mirelle', 'Isolde']);
    assert.deepEqual(lines(watched, 'Knows'), [`${onlyMirelle}background: "deserted at the siege"`]);
    assert.deepEqual(lines(watched, 'Unknown'), [loves]);
    assert.deepEqual(lines(offered(after, ['Mirelle', 'Isolde'])), lines(watched));
    assert.deepEqual(lines(offered(after, ['Halvard', 'Isolde']), 'Unknown'), [deserted, loves]);
});

test('nothing that may have changed is said', () => {
    const state = book(
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Isolde | character'],
            FACTS: [
                'Mirelle | eyes | grey | #2',
                'Mirelle | location | the mill | #3',
                'Mirelle | condition | a split lip | #4',
                'Mirelle | relation to Halvard | old friends | #5',
                'Halvard | trait | laughs loudly | #6',
                'Halvard | condition | badly wounded | #12',
                'Halvard | trait | snores | #13',
                'Halvard | location | hiding in the loft | hidden | #14',
                'Halvard | background | deserted | hidden | #15',
            ],
            SCENES: [
                'Day 1 | #1-#10 | The hall | public | present: Halvard, Mirelle, Isolde | They feast',
                'Day 1 | #11-#20 | The cellar | private | present: Halvard, Mirelle | They hide',
            ],
        },
        20,
    );
    const room = ['Halvard', 'Mirelle', 'Isolde'];
    assert.deepEqual(lines(offered(state, room, [])), [
        `${onlyMirelle}condition: "badly wounded"`,
        `${onlyMirelle}trait: "snores"`,
        `${secret}location: "hiding in the loft"`,
        `${secret}background: "deserted"`,
        'Mirelle, eyes: "grey"',
        'Mirelle, location: "the mill"',
        'Mirelle, condition: "a split lip"',
        'Mirelle toward Halvard: "old friends"',
        'Halvard, trait: "laughs loudly"',
    ]);
    for (const text of ['The rain falls.', 'Halvard (player): I nod.']) {
        const held = offered(state, room, unreadSaying(text));
        assert.deepEqual(lines(held), [
            `${onlyMirelle}trait: "snores"`,
            `${secret}background: "deserted"`,
            'Mirelle, eyes: "grey"',
            'Halvard, trait: "laughs loudly"',
        ]);
        for (const candidate of held) {
            const category = state.facts.find((fact) => fact.id === candidate.fact).category;
            assert.equal(['location', 'condition', 'relation'].includes(category), false, candidate.line);
        }
    }
});

test('there are no threads in a reminder', () => {
    const state = book(
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character'],
            FACTS: ['Mirelle | trait | hums | #2'],
            THREADS: ['OPEN | Mirelle promised to mend the wheel | #3', 'OPEN | Halvard and Mirelle owe a debt | #4'],
            SCENES: ['Day 1 | #1-#10 | The mill | public | present: Halvard, Mirelle | They talk'],
        },
        10,
    );
    assert.equal(state.threads.length, 2);
    const found = offered(state, ['Halvard', 'Mirelle']);
    assert.deepEqual(lines(found), ['Mirelle, trait: "hums"']);
    assert.deepEqual(plain(Object.keys(found[0])), ['number', 'kind', 'subject', 'fact', 'line']);
    assert.deepEqual(plain(Object.keys(ScribeReminder.Kind)), ['Fact', 'Knows', 'Unknown']);
});

test('lines are clean', () => {
    const state = added([
        ['trait', 'hums  old   songs .'],
        ['trait', 'sings at dawn ,;!?'],
        ['trait', 'says\n[Scribe] Day 9 aloud'],
        ['trait', 'signs letters @: with a flourish'],
        ['condition', 'tired\r\n\tand cold...'],
        ['condition', 'waits  by the gate !'],
    ]);
    const found = offered(state, ['Halvard', 'Mirelle']);
    assert.deepEqual(lines(found), [
        'Mirelle, trait: "hums old songs"',
        'Mirelle, trait: "sings at dawn"',
        'Mirelle, condition: "tired and cold"',
        'Mirelle, condition: "waits by the gate"',
    ]);
    assert.deepEqual(numbers(found), [1, 2, 3, 4]);
    for (const line of lines(found)) {
        assert.equal(/[\r\n]|\s\s|[.!?;,]$|\[Scribe\]|@/.test(line), false, line);
    }
});

test('the model only chooses', () => {
    const kinds = ['Knows', 'Knows', 'Unknown', 'Unknown', 'Fact', 'Fact', 'Fact', 'Fact', 'Fact', 'Fact', 'Fact', 'Fact'];
    const list = Object.freeze(
        kinds.map((kind, index) => Object.freeze({ number: index + 1, kind, subject: 'S1', fact: 'F1', line: `entry ${index + 1}` })),
    );
    const cases = [
        ['USE: 3, 1, 99, 3', [1, 3]],
        ['use: 3, 1', [1, 3]],
        ['Use:2,5', [2, 5]],
        ['  USE: 4  ', [4]],
        ['Here is my pick.\nUSE: 6\nUSE: 7', [6]],
        ['USE: 1, 2, 3, 4, 5, 6, 7, 8, 10, 12', [1, 2, 3, 4, 5, 6, 7, 8]],
        ['USE: 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1', [1, 2, 3, 4, 5, 6, 7, 8]],
        ['USE: 9, 11, 12', [9, 11, 12]],
        ['USE: none', []],
        ['use: None', []],
        ['I would remind them of three and seven.', null],
        ['', null],
        ['USE: 99', null],
        ['USE: 0, 13', null],
        ['USEFUL: 3', null],
        ['USE: some', null],
        ['USE:', null],
        ['The answer: USE: 3', null],
        ['use none', null],
    ];
    for (const [text, expected] of cases) {
        assert.deepEqual(numbers(ScribeReminder.chosen(text, list)), expected, text);
    }
    for (const answer of [undefined, null, 42, {}]) {
        assert.equal(ScribeReminder.chosen(answer, list), null, String(answer));
    }
    assertFrozenDeep(ScribeReminder.chosen('USE: 1, 9', list), 'chosen');
    assert.equal(Object.isFrozen(ScribeReminder.chosen('USE: none', list)), true);
});

test("the model's choice is read strictly", async () => {
    const list = Object.freeze(
        Array.from({ length: 9 }, (_, index) =>
            Object.freeze({ number: index + 1, kind: 'Fact', subject: 'S1', fact: 'F1', line: `entry ${index + 1}` }),
        ),
    );
    const cases = [
        ['USE: 3, 7', [3, 7]],
        ['**USE: 5**', [5]],
        ['- USE: 6', [6]],
        ['> `USE: 2`', [2]],
        ['Use these: 4', null],
        ['USE: 1-20', null],
        ['USE: 1.5', null],
        ['USE 3', null],
        ['USE: 3, 7,', null],
        ['USE: the best ones\nUSE: 3', [3]],
    ];
    for (const [text, expected] of cases) {
        assert.deepEqual(numbers(ScribeReminder.chosen(text, list)), expected, text);
    }
    const eight = crowd(5);
    const eightNow = scene(eight, ['Halvard', 'Mirelle']);
    assert.equal(ScribeReminder.candidates(eight, eightNow, 'Halvard', []).length, 8);
    const quiet = scripted([{ text: 'USE: 1' }]);
    const all = await ScribeReminder.compose({
        state: eight,
        now: eightNow,
        player: 'Halvard',
        recent: [],
        unread: [],
        ask: quiet.ask,
    });
    assert.equal(quiet.calls.length, 0);
    assert.deepEqual(numbers(all.used), [1, 2, 3, 4, 5, 6, 7, 8]);
    const nine = crowd(6);
    const fallen = await ScribeReminder.compose({
        state: nine,
        now: scene(nine, ['Halvard', 'Mirelle']),
        player: 'Halvard',
        recent: [],
        unread: [],
        ask: scripted([{ text: 'USE: 1-20' }]).ask,
    });
    assert.deepEqual(plain(fallen.used.map((candidate) => candidate.kind)), [
        'Unknown',
        'Unknown',
        'Fact',
        'Fact',
        'Fact',
        'Fact',
        'Fact',
        'Fact',
    ]);
    assert.deepEqual(numbers(fallen.used), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('the reminder is one line that fits', () => {
    const now = bare([
        { subject: 'S1', label: 'Halvard' },
        { subject: 'S2', label: 'Mirelle' },
    ]);
    const two = ScribeReminder.write(now, [{ line: 'Mirelle: eyes grey' }, { line: 'Halvard: trait snores' }]);
    assert.equal(two, `${opening} Mirelle: eyes grey. Halvard: trait snores.`);
    assert.equal(two.includes('\n'), false);
    assert.equal(ScribeReminder.write(now, []), opening);
    const long = (index) => ({ line: `Mirelle: trait keeps lantern ${index} ${'burning low '.repeat(7).trim()}` });
    const entries = [long(1), long(2), long(3), long(4), long(5), { line: 'Kira: eyes grey' }];
    const fitted = ScribeReminder.fit(now, entries);
    assert.equal(fitted.text, `${opening}${entries.slice(0, 4).map((entry) => ` ${entry.line}.`).join('')} Kira: eyes grey.`);
    assert.deepEqual(plain(fitted.used.map((entry) => entry.line)), plain([...entries.slice(0, 4), entries[5]].map((entry) => entry.line)));
    assert.equal(ScribeText.bytes(fitted.text) <= 600, true);
    assert.equal(ScribeText.bytes(`${fitted.text} ${long(5).line}.`) > 600, true);
    const crowded = Array.from({ length: 40 }, (_, index) => `Isolde Corvane ${index + 1}`);
    const many = ScribeReminder.write(
        bare(crowded.map((label, index) => ({ subject: `S${index + 1}`, label }))),
        [{ line: 'Mirelle: eyes grey' }],
    );
    const lead = '[Scribe] Day 3, "the mill", private. Present: ';
    const head = many.slice(0, many.indexOf(' Mirelle: eyes grey.'));
    assert.equal(many.endsWith(' Mirelle: eyes grey.'), true);
    assert.equal(ScribeText.bytes(head) <= 200, true);
    const counted = head.match(/, and (\d+) others\.$/);
    const names = head.slice(lead.length, head.length - counted[0].length).split(', ');
    assert.deepEqual(names, crowded.slice(0, names.length));
    assert.equal(Number(counted[1]), 40 - names.length);
    const longer = `${lead}${crowded.slice(0, names.length + 1).join(', ')}, and ${39 - names.length} others.`;
    assert.equal(ScribeText.bytes(longer) > 200, true);
    const accentA = { line: `Mirelle: trait ${'ü'.repeat(200)}` };
    const accentB = { line: `Mirelle: eyes ${'é'.repeat(60)}` };
    const accented = ScribeReminder.write(now, [accentA, accentB]);
    assert.equal(accented, `${opening} ${accentA.line}.`);
    assert.equal(`${accented} ${accentB.line}.`.length < 600, true);
    assert.equal(ScribeReminder.write(now, [{ line: `Mirelle: trait ${'ü'.repeat(280)}` }]), opening);
    const noBreak = String.fromCodePoint(0xa0);
    assert.equal(
        ScribeReminder.write(
            bare(
                [
                    { subject: 'S1', label: `Halvard  the${noBreak}Bold` },
                    { subject: 'S2', label: 'Mirelle' },
                ],
                { place: `the${noBreak} mill ` },
            ),
            [],
        ),
        '[Scribe] Day 3, "the mill", private. Present: Halvard the Bold, Mirelle.',
    );
    assert.equal(ScribeReminder.write(bare([]), []), '[Scribe] Day 3, "the mill", private. Present: nobody.');
});

test('compose asks only when there is a choice', async () => {
    const recent = story.slice(0, 12);
    const small = crowd(1);
    const smallNow = scene(small, ['Halvard', 'Mirelle']);
    const smallOffered = ScribeReminder.candidates(small, smallNow, 'Halvard', []);
    assert.deepEqual(lines(smallOffered), [
        `${secret}background: "deserted at the siege"`,
        `${secret}trait: "fears the dark"`,
        'Mirelle, trait: "habit 1"',
        'Halvard, trait: "snores"',
    ]);
    const quiet = scripted([{ text: 'USE: 1' }]);
    const smallResult = await ScribeReminder.compose({
        state: small,
        now: smallNow,
        player: 'Halvard',
        recent,
        unread: [],
        ask: quiet.ask,
    });
    assert.equal(quiet.calls.length, 0);
    assert.deepEqual(numbers(smallResult.used), [1, 2, 3, 4]);
    assert.equal(smallResult.text, ScribeReminder.write(smallNow, smallOffered));
    assert.deepEqual(plain(smallResult.led), []);
    assertFrozenDeep(smallResult, 'result');

    const many = crowd(17);
    const manyNow = scene(many, ['Halvard', 'Mirelle']);
    const manyOffered = ScribeReminder.candidates(many, manyNow, 'Halvard', []);
    assert.equal(manyOffered.length, 20);
    assert.deepEqual(plain(manyOffered.slice(0, 3).map((candidate) => candidate.kind)), ['Unknown', 'Unknown', 'Fact']);
    const asked = scripted([{ text: 'USE: 9, 2, 19' }]);
    const chosen = await ScribeReminder.compose({
        state: many,
        now: manyNow,
        player: 'Halvard',
        recent,
        unread: [],
        ask: asked.ask,
    });
    assert.equal(asked.calls.length, 1);
    assert.equal(asked.calls[0].system, ScribeReminder.ChoosePrompt);
    assert.equal(asked.calls[0].user, ScribeReminder.chooseInput(manyNow, manyOffered, recent));
    assert.deepEqual(numbers(chosen.used), [2, 9, 19]);
    assert.equal(chosen.text, ScribeReminder.write(manyNow, chosen.used));
    assertFrozenDeep(chosen, 'chosen');

    const fallbacks = [{ text: 'Let me think about it.' }, new Error('the model is down'), null, { text: 7 }, { text: 'USE: 99' }];
    for (const answer of fallbacks) {
        const failing = scripted([answer]);
        const result = await ScribeReminder.compose({
            state: many,
            now: manyNow,
            player: 'Halvard',
            recent,
            unread: [],
            ask: failing.ask,
        });
        assert.equal(failing.calls.length, 1);
        assert.deepEqual(numbers(result.used), [1, 2, 3, 4, 5, 6, 7, 8], String(answer));
        assert.equal(result.text, ScribeReminder.write(manyNow, result.used));
    }

    const wordy = crowd(17, 12);
    const wordyNow = scene(wordy, ['Halvard', 'Mirelle']);
    const wordyResult = await ScribeReminder.compose({
        state: wordy,
        now: wordyNow,
        player: 'Halvard',
        recent,
        unread: [],
        ask: scripted([{ text: 'nothing useful' }]).ask,
    });
    const wordyOffered = ScribeReminder.candidates(wordy, wordyNow, 'Halvard', []);
    const usedNumbers = numbers(wordyResult.used);
    assert.equal(usedNumbers.length >= 3 && usedNumbers.length < 8, true, String(usedNumbers));
    assert.deepEqual(usedNumbers.slice(0, 2), [1, 2]);
    assert.equal(wordyResult.text, ScribeReminder.write(wordyNow, wordyResult.used));
    assert.equal(ScribeText.bytes(wordyResult.text) <= 600, true);
    for (const candidate of wordyOffered.slice(0, 8)) {
        const kept = usedNumbers.includes(candidate.number);
        assert.equal(wordyResult.text.includes(` ${candidate.line}.`), kept, candidate.line);
        if (!kept) {
            assert.equal(ScribeText.bytes(`${wordyResult.text} ${candidate.line}.`) > 600, true, candidate.line);
        }
    }

    const idle = scripted([{ text: 'USE: 1' }]);
    const nothing = await ScribeReminder.compose({
        state: many,
        now: null,
        player: 'Halvard',
        recent,
        unread: [],
        ask: idle.ask,
    });
    assert.equal(nothing, null);
    assert.equal(idle.calls.length, 0);
});

test('the choose input and prompt are exact', () => {
    const now = bare(
        [
            { subject: 'S1', label: 'Halvard' },
            { subject: 'S2', label: 'Mirelle' },
            { subject: null, label: 'a stranger' },
        ],
        { summary: 'They talk by the wheel' },
    );
    const candidates = [
        { number: 1, line: 'Mirelle: eyes grey' },
        { number: 2, line: `${onlyMirelle}trait snores` },
    ];
    const lastTen = Array.from(
        { length: 10 },
        (_, index) => `[#${index + 3}] Narrator: The tale goes on, line ${index + 3}.`,
    ).join('\n\n');
    assert.equal(
        ScribeReminder.chooseInput(now, candidates, story.slice(0, 12)),
        'SCENE:\nDay 3 | the mill | private | present: Halvard, Mirelle, a stranger | They talk by the wheel\n\n' +
            `ENTRIES:\n1. Mirelle: eyes grey\n2. ${onlyMirelle}trait snores\n\n` +
            `RECENT MESSAGES:\n${lastTen}`,
    );
    assert.equal(
        ScribeReminder.chooseInput({ ...now, reach: 'Public', present: [] }, candidates.slice(0, 1), story.slice(0, 2)),
        'SCENE:\nDay 3 | the mill | public | present: nobody | They talk by the wheel\n\n' +
            'ENTRIES:\n1. Mirelle: eyes grey\n\n' +
            'RECENT MESSAGES:\n[#1] Narrator: The tale goes on, line 1.\n\n[#2] Narrator: The tale goes on, line 2.',
    );
    const prompt = [
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
    ].join('\n');
    assert.equal(ScribeReminder.ChoosePrompt, prompt);
    assert.equal(ScribeReminder.ChoosePrompt.startsWith('You help a storyteller keep'), true);
    assert.equal(ScribeReminder.ChoosePrompt.endsWith('answer USE: none'), true);
    assert.equal(ScribeReminder.ChoosePrompt.match(/^\d+\. /gm).length, 3);
    assert.equal(ScribeReminder.Settings.MaxBytes, 600);
    assert.equal(ScribeReminder.Settings.MostChosen, 8);
    assert.deepEqual(plain(ScribeReminder.Kind), { Fact: 'Fact', Knows: 'Knows', Unknown: 'Unknown' });
});

test('nothing is leaked by construction', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        {
            SUBJECTS: [
                'Halvard | character',
                'Mirelle | character',
                'Isolde | character',
                'Brandt | character',
                'Kira | character',
            ],
            FACTS: [
                'Halvard | background | deserted at the siege | hidden | #3',
                'Mirelle | trait | steals from the till | hidden | #4',
                'Isolde | background | was once a spy | hidden | #5',
                'Halvard | trait | snores | #6',
                'Mirelle | eyes | grey | #7',
                'Halvard | trait | hums old songs | #14',
                'Halvard | relation to Kira | owes her money | #15',
                'Kira | trait | laughs loudly | #16',
            ],
            SCENES: [
                'Day 1 | #1-#10 | The cellar | private | present: Halvard, Mirelle, Isolde | They hide',
                'Day 1 | #11-#20 | The loft | private | present: Halvard, Brandt | They plan',
            ],
        },
        stretch(1, 20),
    );
    const deserted = factSaying(first, 'deserted at the siege').id;
    const state = apply(log, { TOLD: [`${deserted} | Halvard | Mirelle | #25`] }, pick(25));
    const halvard = idOf(state, 'Halvard');
    const cast = ['Halvard', 'Mirelle', 'Isolde', 'Brandt', 'Kira'];
    const byId = new Map(state.facts.map((fact) => [fact.id, fact]));
    const seen = { Fact: 0, Knows: 0, Unknown: 0 };
    for (let mask = 0; mask < 2 ** cast.length; mask++) {
        const labels = cast.filter((_, index) => (mask & (2 ** index)) !== 0);
        const others = labels.filter((label) => label !== 'Halvard');
        for (const candidate of offered(state, labels)) {
            const where = `${labels.join(',')}: ${candidate.line}`;
            const fact = byId.get(candidate.fact);
            const knowers = others.filter((label) => ScribeKnowledge.knows(state, idOf(state, label), fact));
            seen[candidate.kind]++;
            assert.equal(fact.hidden && fact.widened !== 'Everyone' && fact.subject !== halvard, false, where);
            assert.equal(/steals from the till|was once a spy/.test(candidate.line), false, where);
            if (candidate.kind === 'Fact') {
                assert.equal(knowers.length === others.length, true, where);
                assert.equal(ScribeKnowledge.knows(state, halvard, fact), true, where);
            }
            if (candidate.kind === 'Knows') {
                const start = 'Of those here only '.length;
                const named = candidate.line.slice(start, candidate.line.indexOf(' know', start)).split(/, | and /);
                assert.deepEqual(named, knowers, where);
                assert.equal(knowers.length < others.length, true, where);
            }
            if (candidate.kind === 'Unknown') {
                assert.deepEqual(knowers, [], where);
                assert.equal(others.length > 0, true, where);
            }
        }
    }
    assert.equal(seen.Fact > 0 && seen.Knows > 0 && seen.Unknown > 0, true, JSON.stringify(seen));
});

test('a private confession is not stated in front of others', () => {
    const state = confession();
    assert.deepEqual(lines(offered(state, ['Halvard', 'Mirelle', 'Isolde']), 'Fact'), ['Mirelle, trait: "hums"']);
    assert.deepEqual(lines(offered(state, ['Mirelle', 'Isolde']), 'Fact'), ['Mirelle, trait: "hums"']);
    assert.deepEqual(lines(offered(state, ['Halvard', 'Mirelle']), 'Fact'), [
        'Mirelle, background: "poisoned the old king"',
        'Mirelle, trait: "hums"',
    ]);
    assert.deepEqual(lines(offered(state, ['Halvard', 'Isolde']), 'Fact'), []);
    assert.equal(ScribeKnowledge.knows(state, idOf(state, 'Isolde'), factSaying(state, 'hoards silver')), true);
    assert.equal(ScribeKnowledge.knows(state, idOf(state, 'Halvard'), factSaying(state, 'hoards silver')), false);
});

test('a stranger knows only what everyone knows', () => {
    const state = confession();
    assert.deepEqual(lines(offered(state, ['Halvard', 'Mirelle', 'a stranger']), 'Fact'), ['Mirelle, trait: "hums"']);
    assert.deepEqual(lines(offered(state, ['Halvard', 'Mirelle']), 'Fact'), [
        'Mirelle, background: "poisoned the old king"',
        'Mirelle, trait: "hums"',
    ]);
});

test('one knower does not remove the warning', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        {
            SUBJECTS: [
                'Halvard | character',
                'Mirelle | character',
                'Isolde | character',
                'Brandt | character',
                'Kira | character',
            ],
            FACTS: ['Halvard | background | deserted at the siege | hidden | #5', 'Halvard | trait | snores | #7'],
            SCENES: [
                'Day 1 | #1-#10 | The hall | public | present: Halvard, Mirelle, Isolde, Brandt | They feast',
                'Day 1 | #6-#8 | The alcove | private | present: Halvard, Mirelle | They whisper',
            ],
        },
        stretch(1, 10),
    );
    const id = factSaying(first, 'deserted at the siege').id;
    const snores = factSaying(first, 'snores').id;
    const said = 'background: "deserted at the siege"';
    const toMirelle = apply(log, { TOLD: [`${id} | Halvard | Mirelle | #12`] }, pick(12));
    const watched = offered(toMirelle, ['Halvard', 'Mirelle', 'Isolde', 'Brandt']);
    assert.deepEqual(about(watched, id), [`Knows|${onlyMirelle}${said}`]);
    assert.deepEqual(about(watched, snores), [`Knows|${onlyMirelle}trait: "snores"`]);
    const unaware = offered(toMirelle, ['Halvard', 'Isolde', 'Brandt']);
    assert.deepEqual(about(unaware, id), [`Unknown|${secret}${said}`]);
    assert.deepEqual(about(unaware, snores), ['Unknown|No one here knows this about Halvard: trait: "snores"']);
    assert.deepEqual(about(offered(toMirelle, ['Halvard', 'Mirelle']), id), []);
    const toKira = apply(log, { TOLD: [`${id} | Halvard | Kira | #14`] }, pick(14));
    assert.deepEqual(about(offered(toKira, ['Halvard', 'Mirelle', 'Isolde', 'Brandt', 'Kira']), id), [
        `Knows|Of those here only Mirelle and Kira know this about Halvard, the others do not: ${said}`,
    ]);
    const toIsolde = apply(log, { TOLD: [`${id} | Halvard | Isolde | #16`] }, pick(16));
    assert.deepEqual(about(offered(toIsolde, ['Halvard', 'Mirelle', 'Isolde', 'Brandt', 'Kira']), id), [
        `Knows|Of those here only Mirelle, Isolde and Kira know this about Halvard, the others do not: ${said}`,
    ]);
});

test('a thinner wording is said as such', () => {
    const { thin, full, state } = battle();
    const found = offered(state, ['Halvard', 'Kira', 'Isolde']);
    assert.deepEqual(about(found, full), [
        `Unknown|${notWhole}background: "fled a battle at the ford"; only Kira knows a part of it: background: "fled a battle"; the others know nothing of it`,
    ]);
    assert.deepEqual(about(found, thin), []);
    assert.equal(found.length, 1);
});

test('a part known to some is said with what the others know', () => {
    const { log, thin, full, state } = battle();
    const ford = 'background: "fled a battle at the ford"';
    const night = 'background: "fled a battle at the ford by night"';
    const part = 'background: "fled a battle"';
    assert.deepEqual(lines(offered(state, ['Halvard', 'Kira', 'Isolde'])), [
        `${notWhole}${ford}; only Kira knows a part of it: ${part}; the others know nothing of it`,
    ]);
    assert.deepEqual(lines(offered(state, ['Halvard', 'Kira'])), [`${notWhole}${ford}; only Kira knows a part of it: ${part}`]);
    const toMirelle = apply(log, { TOLD: [`${full} | Halvard | Mirelle | #18`] }, pick(18));
    assert.deepEqual(lines(offered(toMirelle, ['Halvard', 'Mirelle', 'Kira', 'Isolde'])), [
        `Of those here only Mirelle knows this about Halvard: ${ford}; only Kira knows a part of it: ${part}; the others know nothing of it`,
    ]);
    assert.deepEqual(lines(offered(toMirelle, ['Halvard', 'Mirelle', 'Kira'])), [
        `Of those here only Mirelle knows this about Halvard: ${ford}; only Kira knows a part of it: ${part}`,
    ]);
    const refined = apply(
        log,
        { CHANGES: [`${full} | Halvard | background | FULLER: fled a battle at the ford by night | #20`] },
        pick(20),
    );
    assert.deepEqual(lines(offered(refined, ['Halvard', 'Mirelle', 'Kira', 'Isolde'])), [
        `${notWhole}${night}; only Mirelle knows a part of it: ${ford}; only Kira knows a part of it: ${part}; the others know nothing of it`,
    ]);
    const toIsolde = apply(log, { TOLD: [`${thin} | Halvard | Isolde | #22`] }, pick(22));
    assert.deepEqual(lines(offered(toIsolde, ['Halvard', 'Kira', 'Isolde'])), [
        `${notWhole}${night}; only Kira and Isolde know a part of it: ${part}`,
    ]);
    assert.deepEqual(lines(offered(toIsolde, ['Halvard', 'Kira', 'Isolde', 'a stranger'])), [
        `${notWhole}${night}; only Kira and Isolde know a part of it: ${part}; the others know nothing of it`,
    ]);
});

test('the warnings are written first and kept', async () => {
    const eight = crowd(5);
    const now = scene(eight, ['Halvard', 'Mirelle']);
    const found = ScribeReminder.candidates(eight, now, 'Halvard', []);
    assert.equal(found.length, 8);
    assert.deepEqual(plain(found.map((candidate) => candidate.kind)), [
        'Unknown',
        'Unknown',
        'Fact',
        'Fact',
        'Fact',
        'Fact',
        'Fact',
        'Fact',
    ]);
    const written = await composed(eight, now);
    const first = written.text.indexOf(`${secret}background: "deserted at the siege".`);
    assert.equal(first, opening.length + 1);
    assert.equal(
        written.text.indexOf(`${secret}trait: "fears the dark".`) < written.text.indexOf('Mirelle, trait: "habit 1".'),
        true,
    );
    const tight = crowd(5, 12);
    const tightResult = await composed(tight, scene(tight, ['Halvard', 'Mirelle']));
    assert.deepEqual(numbers(tightResult.used).slice(0, 2), [1, 2]);
    assert.equal(tightResult.used.length < 8, true);
    assert.equal(tightResult.text.includes(`${secret}trait: "fears the dark".`), true);
    const short = ScribeReminder.fit(scene(eight, ['Halvard', 'Mirelle']), [
        { line: `Mirelle, trait: "${'h'.repeat(600)}"` },
        { line: 'Mirelle, eyes: "grey"' },
        { line: 'Halvard, trait: "snores"' },
    ]);
    assert.equal(short.text, `${opening} Mirelle, eyes: "grey". Halvard, trait: "snores".`);
    assert.deepEqual(plain(short.used.map((entry) => entry.line)), ['Mirelle, eyes: "grey"', 'Halvard, trait: "snores"']);
});

test('the opening names the room', async () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        {
            SUBJECTS: ['Halvard | character', 'Hal | character', 'Kira | character', 'Kiki | character', 'Isolde | character'],
            FACTS: ['Halvard | background | deserted at the siege | hidden | #5'],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Kira, Isolde | They feast'],
        },
        stretch(1, 10),
    );
    const told = apply(log, { TOLD: [`${factSaying(first, 'deserted at the siege').id} | Halvard | Kiki | #12`] }, pick(12));
    const before = scene(told, ['Halvard', 'Hal', 'Kiki', 'Kira', 'Isolde', 'a guard', 'A Guard']);
    rule(log, { type: 'Merge', from: idOf(told, 'Kiki'), into: idOf(told, 'Kira') });
    const merged = rule(log, { type: 'Merge', from: idOf(told, 'Hal'), into: idOf(told, 'Halvard') });
    const result = await composed(merged, before);
    assert.equal(
        result.text,
        '[Scribe] Day 3, "the mill", private. Present: Halvard, Kira, Isolde, and 1 other. ' +
            'Of those here only Kira knows this about Halvard, the others do not: background: "deserted at the siege".',
    );
    const underAlias = await composed(merged, scene(told, ['Hal', 'Isolde']));
    assert.equal(underAlias.text.startsWith('[Scribe] Day 3, "the mill", private. Present: Halvard, Isolde. '), true);
    assert.deepEqual(plain(ScribeReminder.people(merged, before, 'Halvard').map((person) => person.label)), [
        'Halvard',
        'Kira',
        'Isolde',
        null,
    ]);
});

test('one match or none', () => {
    const state = book(
        {
            SUBJECTS: ['Hal | character', 'Halvard | character', 'Mirelle | character'],
            FACTS: [
                'Halvard | aka | Hal | #2',
                'Hal | background | drowned his brother | hidden | #4',
                'Halvard | background | deserted at the siege | hidden | #5',
                'Mirelle | trait | hums | #6',
            ],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Hal, Mirelle | They feast'],
        },
        10,
    );
    assert.deepEqual(plain(state.subjects.find((subject) => subject.label === 'Halvard').aka), ['Hal']);
    assert.equal(ScribeReminder.namesakes(state, 'Hal').length, 2);
    const found = ScribeReminder.candidates(state, scene(state, ['Halvard', 'Hal', 'Mirelle']), 'Hal', []);
    assert.deepEqual(lines(found), ['Halvard, aka: "Hal"', 'Mirelle, trait: "hums"']);
    assert.equal(lines(found).some((line) => /drowned|deserted/.test(line)), false);
});

test('a player not found still guards', () => {
    const state = book(
        {
            SUBJECTS: ['Hal (the ferryman) | character', 'Halvard | character', 'Mirelle | character', 'Isolde | character'],
            NAMES: ['Hal | Halvard | #2'],
            FACTS: ['Mirelle | background | poisoned the old king | #6', 'Mirelle | trait | hums | #15'],
            SCENES: [
                'Day 1 | #1-#10 | The vault | private | present: Mirelle, Isolde | They plot',
                'Day 1 | #11-#20 | The hall | public | present: Mirelle, Isolde | They feast',
            ],
        },
        20,
    );
    assert.equal(ScribeReminder.namesakes(state, 'Hal').length, 2);
    const found = ScribeReminder.candidates(state, scene(state, ['Mirelle', 'Isolde']), 'Hal', []);
    assert.deepEqual(lines(found), ['Mirelle, trait: "hums"']);
});

test('ordinary text is kept', async () => {
    const texts = [
        'studied under Dr. Venn at the college',
        'Sister of the Order of St. Orla',
        'about 5 ft. 4 and slender',
        'lives at No. 7 Harrow Row',
        'the Kings Road, near mile 3.5',
        'quotes scripture, e.g. the Book of Ash',
    ];
    const state = added(texts.map((text) => ['trait', text]));
    assert.deepEqual(lines(offered(state, ['Halvard', 'Mirelle'])), texts.map((text) => `Mirelle, trait: "${text}"`));
    const oswin = `Oswin (Tamsin${curly}s uncle)`;
    const labelled = book(
        {
            SUBJECTS: ['Halvard | character', 'Dr. Venn | character', `${oswin} | character`],
            FACTS: ['Dr. Venn | trait | quiet | #2', `${oswin} | trait | gruff | #3`],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard | They feast'],
        },
        10,
    );
    const now = scene(labelled, ['Halvard', 'Dr. Venn', oswin]);
    assert.deepEqual(lines(ScribeReminder.candidates(labelled, now, 'Halvard', [])), [
        'Dr Venn, trait: "quiet"',
        'Oswin, trait: "gruff"',
    ]);
    const result = await composed(labelled, now);
    assert.equal(
        result.text,
        '[Scribe] Day 3, "the mill", private. Present: Halvard, Dr Venn, Oswin. Dr Venn, trait: "quiet". Oswin, trait: "gruff".',
    );
});

test("the chooser's answer is read as a model writes it", async () => {
    const list = Object.freeze(
        Array.from({ length: 14 }, (_, index) =>
            Object.freeze({ number: index + 1, kind: 'Fact', subject: 'S1', fact: 'F1', line: `entry ${index + 1}` }),
        ),
    );
    const read = [
        'USE: 3, 7, 12.',
        'USE: 3 7 12',
        'USE: [3, 7, 12]',
        '**USE:** 3, 7, 12',
        'USE: #3, #7, #12',
        'USE: 3, 7 and 12',
        `USE${String.fromCodePoint(0xff1a)}3, 7, 12`,
        'USE: 3; 7; 12',
        'USE:\n3, 7, 12',
        'USE:\n\n- 3, 7, 12',
    ];
    for (const text of read) {
        assert.deepEqual(numbers(ScribeReminder.chosen(text, list)), [3, 7, 12], text);
    }
    assert.deepEqual(numbers(ScribeReminder.chosen('USE: None.', list)), []);
    for (const text of ['USE: 1-20', 'USE: 1.5', 'USE: 3, 7, 12 (the secrets first)', 'Answer: USE: 3', 'USE 3']) {
        assert.equal(ScribeReminder.chosen(text, list), null, text);
    }
    const many = crowd(17);
    const now = scene(many, ['Halvard', 'Mirelle']);
    const asked = scripted([{ text: 'USE: None.' }]);
    const result = await ScribeReminder.compose({
        state: many,
        now,
        player: 'Halvard',
        recent: [],
        unread: [],
        ask: asked.ask,
    });
    assert.equal(asked.calls.length, 1);
    assert.deepEqual(plain(result.used), []);
    assert.equal(result.text, opening);
});

test('lengths are counted in code points', () => {
    const state = added([
        ['trait', deseret.repeat(128)],
        ['trait', deseretOther.repeat(201)],
    ]);
    assert.equal(deseret.repeat(128).length, 256);
    assert.deepEqual(lines(offered(state, ['Halvard', 'Mirelle'])), [`Mirelle, trait: "${deseret.repeat(128)}"`]);
});

test('a contested value is never said, in any wording', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Isolde | character'],
            FACTS: ['Halvard | age | thirty | #3', 'Halvard | trait | snores | #4'],
            SCENES: ['Day 1 | #1-#10 | The cellar | private | present: Halvard, Mirelle | They hide'],
        },
        stretch(1, 10),
    );
    const thirty = factSaying(first, 'thirty').id;
    const state = apply(
        log,
        {
            CHANGES: [`${thirty} | Halvard | age | FULLER: thirty winters | #12`],
            FACTS: ['Halvard | age | forty-one | #20'],
            SCENES: ['Day 1 | #11-#20 | The study | private | present: Halvard, Isolde | They read'],
        },
        stretch(11, 20),
    );
    const wordings = ['thirty', 'thirty winters', 'forty-one'].map((text) => factSaying(state, text).id);
    assert.equal(state.conflicts.length, 1);
    assert.equal(state.conflicts[0].established, wordings[1]);
    assert.deepEqual(plain(state.conflicts[0].others), [wordings[2]]);
    assert.equal(factSaying(state, 'thirty').status, 'Replaced');
    for (const room of [['Halvard', 'Mirelle', 'Isolde'], ['Halvard', 'Mirelle'], ['Halvard', 'Isolde']]) {
        const found = offered(state, room);
        assert.equal(found.length > 0, true, room.join(','));
        for (const candidate of found) {
            assert.equal(wordings.includes(candidate.fact), false, candidate.line);
            assert.equal(/thirty|forty/.test(candidate.line), false, candidate.line);
        }
    }
});

test('a fact of the player known to some is not stated plainly', () => {
    const state = book(
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Isolde | character'],
            FACTS: ['Halvard | trait | snores | #5'],
            SCENES: ['Day 1 | #1-#10 | The cellar | private | present: Halvard, Mirelle | They hide'],
        },
        10,
    );
    const watched = offered(state, ['Halvard', 'Mirelle', 'Isolde']);
    assert.deepEqual(lines(watched), [`${onlyMirelle}trait: "snores"`]);
    assert.deepEqual(lines(watched, 'Fact'), []);
    const alone = offered(state, ['Halvard', 'Mirelle']);
    assert.deepEqual(lines(alone), ['Halvard, trait: "snores"']);
    assert.deepEqual(plain(alone.map((candidate) => candidate.kind)), ['Fact']);
});

test('a relation needs its target in the room', () => {
    const state = book(
        {
            SUBJECTS: [
                'Halvard | character',
                'Mirelle | character',
                'Isolde | character',
                'Kira | character',
                'Brandt | character',
            ],
            FACTS: [
                'Halvard | relation to Kira | owes her money | #5',
                'Halvard | relation to Corvane | fears him | #6',
                'Halvard | relation to Brandt | hates him | hidden | #7',
                'Mirelle | relation to Brandt | rivals | #15',
                'Mirelle | relation to Halvard | old friends | #16',
            ],
            SCENES: [
                'Day 1 | #1-#10 | The cellar | private | present: Halvard, Mirelle | They hide',
                'Day 1 | #11-#20 | The hall | public | present: Halvard, Mirelle, Brandt | They feast',
            ],
        },
        20,
    );
    assert.equal(factSaying(state, 'fears him').target, null);
    assert.deepEqual(lines(offered(state, ['Halvard', 'Mirelle', 'Isolde'])), ['Mirelle toward Halvard: "old friends"']);
    assert.deepEqual(lines(offered(state, ['Halvard', 'Mirelle', 'Isolde', 'Kira', 'Brandt'])), [
        `${onlyMirelle}toward Kira: "owes her money"`,
        `${secret}toward Brandt: "hates him"`,
        'Mirelle toward Brandt: "rivals"',
        'Mirelle toward Halvard: "old friends"',
    ]);
});

test('the player is one subject or none', () => {
    const ferry = book(
        {
            SUBJECTS: ['Hal (the ferryman) | character', 'Halvard | character', 'Mirelle | character'],
            NAMES: ['Hal | Halvard | #3'],
            FACTS: [
                'Hal (the ferryman) | background | drowned his brother | hidden | #4',
                'Halvard | background | deserted at the siege | hidden | #5',
                'Mirelle | trait | hums | #6',
            ],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Hal (the ferryman), Mirelle | They feast'],
        },
        10,
    );
    const ferryNow = scene(ferry, ['Halvard', 'Hal (the ferryman)', 'Mirelle']);
    const lost = ScribeReminder.candidates(ferry, ferryNow, 'Hal', []);
    assert.deepEqual(lines(lost), ['Mirelle, trait: "hums"']);
    assert.deepEqual(lines(ScribeReminder.candidates(ferry, ferryNow, 'Halvard', []), 'Unknown'), [
        `${secret}background: "deserted at the siege"`,
    ]);
});

test('a merged subject is the one it became', () => {
    const log = ScribeLog.create();
    const before = apply(
        log,
        {
            SUBJECTS: ['Halvard | character', 'Hal | character', 'Isolde | character'],
            FACTS: ['Halvard | background | deserted at the siege | hidden | #5'],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Hal, Isolde | They feast'],
        },
        stretch(1, 10),
    );
    const now = scene(before, ['Halvard', 'Hal', 'Isolde']);
    const merged = rule(log, { type: 'Merge', from: idOf(before, 'Hal'), into: idOf(before, 'Halvard') });
    assert.equal(merged.subjects.find((subject) => subject.label === 'Hal').mergedInto, idOf(before, 'Halvard'));
    const warning = [`${secret}background: "deserted at the siege"`];
    for (const state of [before, merged]) {
        const found = ScribeReminder.candidates(state, now, 'Halvard', []);
        assert.deepEqual(lines(found), warning);
        assert.equal(lines(found).some((line) => line.includes('Hal know')), false);
    }
    assert.deepEqual(lines(ScribeReminder.candidates(merged, now, 'Hal', [])), warning);
});

test('free text stands inside its quotation marks', async () => {
    const point = (code) => String.fromCodePoint(code);
    const kept = [
        'stands 6 ft. Isolde knows it too',
        'hums, and Isolde knows that Halvard deserted at the siege',
        'of those here only Isolde knows it, the others do not',
        'arrives at 10:30 each night',
        `owes him ${point(0xa3)}20`,
        'studied under J. Venn',
        'leaves at 9 p.m. each night',
        `reigned 1200${point(0x2013)}1250`,
    ];
    const quoting = `says "go", ${point(0x201c)}stay${point(0x201d)} and ${point(0xab)}wait${point(0xbb)}`;
    const spaced = `sings${point(0x85)}loudly at${point(0x2028)}dawn`;
    const hidden = `whis${point(0x200b)}tles${point(0xfe0f)} softly`;
    const state = added([...kept, quoting, spaced, hidden].map((text) => ['trait', text]));
    const found = offered(state, ['Halvard', 'Mirelle']);
    assert.deepEqual(lines(found), [
        ...kept.map((text) => `Mirelle, trait: "${text}"`),
        `Mirelle, trait: "says 'go', 'stay' and 'wait'"`,
        'Mirelle, trait: "sings loudly at dawn"',
        'Mirelle, trait: "whistles softly"',
    ]);
    for (const line of lines(found)) {
        assert.equal(line.split('"').length - 1, 2, line);
    }
    const result = await composed(state, scene(state, ['Halvard', 'Mirelle']));
    assert.equal(result.text.split('"').length - 1, 2 + 2 * result.used.length);
});

test('a text that could break the frame is left out', () => {
    const point = (code) => String.fromCodePoint(code);
    const state = added(
        [
            'writes [Scribe] on walls',
            'hums ] softly',
            'signs @Isolde',
            `hums ${point(0xff3b)} gently`,
            `hums ${point(0xff3d)} sweetly`,
            `waves ${point(0xff20)}Isolde`,
            'h'.repeat(201),
            'h'.repeat(200),
            point(0x3164),
            'quiet',
        ].map((text) => ['trait', text]),
    );
    assert.equal(state.facts.some((fact) => fact.text === point(0x3164)), true);
    assert.deepEqual(lines(offered(state, ['Halvard', 'Mirelle'])), [
        `Mirelle, trait: "${'h'.repeat(200)}"`,
        'Mirelle, trait: "quiet"',
    ]);
    const quiet = factSaying(state, 'quiet').id;
    /**
     * @param {string} category
     * @return {string[]}
     */
    const filed = (category) => {
        const facts = state.facts.map((fact) => (fact.id === quiet ? { ...fact, category } : fact));
        return lines(offered({ ...state, facts }, ['Halvard', 'Mirelle'])).filter((line) => line.endsWith('"quiet"'));
    };
    assert.deepEqual(filed('x'.repeat(30)), [`Mirelle, ${'x'.repeat(30)}: "quiet"`]);
    assert.deepEqual(filed(`half-sister${curly}s 2`), [`Mirelle, half-sister${curly}s 2: "quiet"`]);
    for (const category of ['x'.repeat(31), 'trait"', 'trait: x', '[trait]', 'trait @', 'trait.', `trait ${point(0x663)}`]) {
        assert.deepEqual(filed(category), [], category);
    }
});

test('a place is quoted or left out', () => {
    const now = bare([
        { subject: 'S1', label: 'Halvard' },
        { subject: 'S2', label: 'Mirelle' },
    ]);
    const without = '[Scribe] Day 3, private. Present: Halvard, Mirelle.';
    assert.equal(
        ScribeReminder.write({ ...now, place: 'the mill, Isolde knows Halvard deserted' }, []),
        '[Scribe] Day 3, "the mill, Isolde knows Halvard deserted", private. Present: Halvard, Mirelle.',
    );
    const sixty = [...Array(5).fill('riverside'), 'riversides'].join(' ');
    assert.equal(Array.from(sixty).length, 60);
    assert.equal(
        ScribeReminder.write({ ...now, place: sixty }, []),
        `[Scribe] Day 3, "${sixty}", private. Present: Halvard, Mirelle.`,
    );
    assert.equal(ScribeReminder.write({ ...now, place: `${sixty}s` }, []), without);
    assert.equal(ScribeReminder.write({ ...now, place: 'the mill @ night' }, []), without);
    assert.equal(ScribeReminder.write({ ...now, place: 'the [old] mill' }, []), without);
    assert.equal(
        ScribeReminder.write({ ...now, place: 'the "old" mill' }, []),
        `[Scribe] Day 3, "the 'old' mill", private. Present: Halvard, Mirelle.`,
    );
});

test('a name is made of allowed characters', async () => {
    const point = (code) => String.fromCodePoint(code);
    const printed = (label) => ScribeReminder.printed(label);
    assert.equal(printed('Hal (the ferryman)'), 'Hal');
    assert.equal(printed('Hal [the ferryman]'), 'Hal');
    assert.equal(printed('Dr. Venn'), 'Dr Venn');
    assert.equal(printed(`Oswin (Tamsin${curly}s uncle)`), 'Oswin');
    assert.equal(printed(`Iso${point(0x3164)}lde`), 'Isolde');
    assert.equal(printed(`Zoe${point(0x308)}`), `Zo${point(0xeb)}`);
    assert.equal(printed(`O${curly}Brien-Hale`), `O${curly}Brien-Hale`);
    assert.equal(printed('a b c d'), 'a b c d');
    assert.equal(printed('x'.repeat(60)), 'x'.repeat(60));
    assert.equal(printed("O'Brien"), "O'Brien");
    assert.equal(printed(`Kira${point(0x331)}`), `Kira${point(0x331)}`);
    assert.equal(printed(`${point(0x1f88)}gathe`), `${point(0x1f88)}gathe`);
    const refused = [
        'Mirelle, Isolde',
        'Venn: the elder',
        `Kira ${point(0x663)}`,
        point(0x92a, 0x94d, 0x930, 0x93f, 0x92f, 0x93e),
        'a b c d e',
        'x'.repeat(61),
        'Brandt and Sons',
        'Brandt AND Sons',
        'Brandt & Sons',
        'Hal (the ferryman',
        'Halvard the Bold!',
        '',
    ];
    for (const label of refused) {
        assert.equal(printed(label), null, label);
    }
    const state = book(
        {
            SUBJECTS: ['Halvard | character', 'Dr. Venn | character', 'Hal (the ferryman) | character', 'Mirelle, Isolde | group'],
            FACTS: ['Dr. Venn | trait | quiet | #2', 'Hal (the ferryman) | trait | rows | #3'],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard | They feast'],
        },
        10,
    );
    const now = scene(state, ['Halvard', 'Dr. Venn', 'Hal (the ferryman)', 'Mirelle, Isolde']);
    const result = await composed(state, now);
    assert.equal(
        result.text,
        '[Scribe] Day 3, "the mill", private. Present: Halvard, Dr Venn, Hal, and 1 other. Dr Venn, trait: "quiet". Hal, trait: "rows".',
    );
});

test('strangers are counted', async () => {
    const point = (code) => String.fromCodePoint(code);
    const filler = point(0x3164);
    const state = book(
        {
            SUBJECTS: ['Halvard | character', 'Isolde | character', 'Mirelle | character', 'Brandt and Sons | group'],
            FACTS: ['Isolde | trait | sings | #2', 'Halvard | background | deserted at the siege | hidden | #3'],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Isolde, Mirelle | They feast'],
        },
        10,
    );
    const text = async (labels) => (await composed(state, scene(state, labels))).text;
    const three = await text(['Halvard', 'Isolde', 'a guard', 'everyone knows it', 'Brandt and Sons']);
    assert.equal(
        three,
        '[Scribe] Day 3, "the mill", private. Present: Halvard, Isolde, and 3 others. ' +
            `${secret}background: "deserted at the siege". Isolde, trait: "sings".`,
    );
    assert.equal((await text(['Halvard', 'Isolde', 'a guard'])).startsWith('[Scribe] Day 3, "the mill", private. Present: Halvard, Isolde, and 1 other.'), true);
    assert.equal((await text(['a guard', 'two sailors'])).startsWith('[Scribe] Day 3, "the mill", private. Present: 2 people.'), true);
    assert.equal((await text(['a guard'])).startsWith('[Scribe] Day 3, "the mill", private. Present: 1 person.'), true);
    const hostile = await text([
        'Halvard',
        `a${filler}guard${filler}who${filler}saw${filler}Halvard${filler}flee`,
        'Al knows it all',
        'Isolde knows Halvard deserted',
        'a guard',
        'A Guard',
    ]);
    assert.equal(hostile.startsWith('[Scribe] Day 3, "the mill", private. Present: Halvard, and 4 others.'), true);
    assert.equal(/guard|knows it all|Isolde knows|Brandt/.test(hostile), false, hostile);
    assert.equal(
        ScribeReminder.write(
            bare([
                { subject: 'S1', label: 'Halvard' },
                { subject: null, label: 'Mirelle' },
            ]),
            [],
        ),
        '[Scribe] Day 3, "the mill", private. Present: Halvard, and 1 other.',
    );
});

test('one label, one person', async () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        {
            SUBJECTS: [
                'Halvard | character',
                'Kira (the smith) | character',
                'Kira (the baker) | character',
                'Isolde | character',
            ],
            FACTS: [
                'Halvard | aka | Hal | #2',
                'Halvard | background | deserted at the siege | hidden | #5',
                'Kira (the smith) | trait | whistles | #6',
                'Kira (the baker) | trait | kneads | #7',
            ],
            SCENES: [
                'Day 1 | #1-#10 | The hall | public | present: Halvard, Kira (the smith), Kira (the baker), Isolde | They feast',
            ],
        },
        stretch(1, 10),
    );
    const state = apply(
        log,
        { TOLD: [`${factSaying(first, 'deserted at the siege').id} | Halvard | Kira (the smith) | #12`] },
        pick(12),
    );
    assert.equal(ScribeReminder.namesakes(state, 'Hal').length, 1);
    /**
     * @param {object} now
     * @return {Promise<object>}
     */
    const asHal = (now) =>
        ScribeReminder.compose({ state, now, player: 'Hal', recent: [], unread: [], ask: scripted([]).ask });
    const twins = scene(state, ['Halvard', 'Kira (the smith)', 'Kira (the baker)', 'Isolde']);
    const found = ScribeReminder.candidates(state, twins, 'Hal', []);
    assert.deepEqual(lines(found), ['Halvard, aka: "Hal"']);
    assert.equal(
        (await asHal(twins)).text,
        '[Scribe] Day 3, "the mill", private. Present: Halvard, Isolde, and 2 others. Halvard, aka: "Hal".',
    );
    const alone = scene(state, ['Halvard', 'Kira (the smith)', 'Isolde']);
    assert.deepEqual(lines(ScribeReminder.candidates(state, alone, 'Hal', [])), ['Halvard, aka: "Hal"']);
    assert.deepEqual(lines(ScribeReminder.candidates(state, scene(state, ['Isolde']), 'Hal', [])), [
        `${secret}background: "deserted at the siege"`,
        'Halvard, aka: "Hal"',
    ]);
    /**
     * @param {string[]} labels
     * @return {string}
     */
    const opened = (labels) =>
        ScribeReminder.write(
            bare(labels.map((label, index) => ({ subject: `S${index + 1}`, label }))),
            [],
        );
    assert.equal(opened(['Kira', 'Isolde', 'Kira']), '[Scribe] Day 3, "the mill", private. Present: Isolde, and 2 others.');
    assert.equal(opened(['Kira', 'KIRA']), '[Scribe] Day 3, "the mill", private. Present: 2 people.');
    assert.equal(
        opened(['Kira (the smith)', `Kira${curly}s`, "Kira's"]),
        '[Scribe] Day 3, "the mill", private. Present: Kira, and 2 others.',
    );
    assert.equal(opened(['Kira', 'Isolde']), '[Scribe] Day 3, "the mill", private. Present: Kira, Isolde.');
});

test('no line names someone it cannot name', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        {
            SUBJECTS: [
                'Halvard | character',
                'Isolde | character',
                'Dr! Venn | character',
                'Brandt | character',
                'Brandt and Sons | group',
            ],
            FACTS: ['Halvard | background | deserted at the siege | hidden | #5'],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Isolde, Brandt | They feast'],
        },
        stretch(1, 10),
    );
    const id = factSaying(first, 'deserted at the siege').id;
    const state = apply(
        log,
        { TOLD: [`${id} | Halvard | Dr! Venn | #12`, `${id} | Halvard | Brandt and Sons | #12`] },
        pick(12),
    );
    for (const room of [
        ['Halvard', 'Dr! Venn', 'Isolde'],
        ['Halvard', 'Brandt', 'Brandt and Sons', 'Isolde'],
        ['Halvard', 'Dr! Venn'],
    ]) {
        const found = offered(state, room);
        assert.deepEqual(about(found, id), [], room.join(','));
        assert.equal(lines(found).some((line) => /someone|Brandt and Sons|null/.test(line)), false, room.join(','));
    }
    assert.deepEqual(about(offered(state, ['Halvard', 'Isolde']), id), [`Unknown|${secret}background: "deserted at the siege"`]);
    const told = ScribeLog.create();
    apply(
        told,
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Isolde | character'],
            FACTS: ['Halvard | background | fled a battle | #5'],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Mirelle, Isolde | They feast'],
        },
        stretch(1, 10),
    );
    const fled = factSaying(ScribeReplay.run(told, storyOrder), 'fled a battle').id;
    const fuller = apply(
        told,
        {
            CHANGES: [`${fled} | Halvard | background | FULLER: fled a battle at the ford | #15`],
            SCENES: ['Day 1 | #11-#20 | The cellar | private | present: Halvard, Mirelle | They hide'],
        },
        stretch(11, 20),
    );
    const full = factSaying(fuller, 'fled a battle at the ford').id;
    assert.deepEqual(about(offered(fuller, ['Halvard', 'Mirelle', 'Isolde', 'a guard']), full), []);
    assert.deepEqual(about(offered(fuller, ['Halvard', 'Mirelle', 'Isolde']), full), [
        'Knows|Of those here only Mirelle knows this about Halvard: background: "fled a battle at the ford"; only Isolde knows a part of it: background: "fled a battle"',
    ]);
});

test('no line for the player without a name', () => {
    const state = book(
        {
            SUBJECTS: ['Halvard the Bold! | character', 'Mirelle | character', 'Isolde | character'],
            FACTS: [
                'Halvard the Bold! | background | deserted at the siege | hidden | #5',
                'Halvard the Bold! | trait | snores | #6',
                'Mirelle | trait | hums | #7',
            ],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard the Bold!, Mirelle, Isolde | They feast'],
        },
        10,
    );
    assert.equal(ScribeReminder.namesakes(state, 'Halvard the Bold!').length, 1);
    const found = ScribeReminder.candidates(
        state,
        scene(state, ['Halvard the Bold!', 'Mirelle', 'Isolde']),
        'Halvard the Bold!',
        [],
    );
    assert.deepEqual(lines(found), ['Mirelle, trait: "hums"']);
    assert.equal(lines(found).some((line) => line.includes('null')), false);
    assert.deepEqual(lines(found, 'Knows').concat(lines(found, 'Unknown')), []);
});

test('a crowded room still hears its entries', () => {
    const crowded = Array.from({ length: 31 }, (_, index) => `Mirelle Tamsin ${index + 1}`);
    const warning = `Of those here only Mirelle Tamsin 1 knows this about Halvard, the others do not: background: "deserted at the siege"`;
    const result = ScribeReminder.fit(
        bare(
            crowded.map((label, index) => ({ subject: `S${index + 1}`, label })),
            { place: 'the great hall', reach: 'Public' },
        ),
        [{ line: warning }],
    );
    assert.equal(result.text.endsWith(` ${warning}.`), true);
    assert.equal(result.used.length, 1);
    const head = result.text.slice(0, result.text.length - warning.length - 2);
    assert.equal(ScribeText.bytes(head) <= 200, true);
    const lead = '[Scribe] Day 3, "the great hall", public. Present: ';
    const counted = head.match(/, and (\d+) others\.$/);
    const names = head.slice(lead.length, head.length - counted[0].length).split(', ');
    assert.deepEqual(names, crowded.slice(0, names.length));
    assert.equal(names.length > 0, true);
    assert.equal(Number(counted[1]), 31 - names.length);
    assert.equal(
        ScribeText.bytes(`${lead}${crowded.slice(0, names.length + 1).join(', ')}, and ${30 - names.length} others.`) > 200,
        true,
    );
});

test('a contradicted fact goes first', async () => {
    const recent = story.slice(0, 12);
    const state = crowd(9);
    const now = scene(state, ['Halvard', 'Mirelle']);
    const found = ScribeReminder.candidates(state, now, 'Halvard', []);
    assert.equal(found.length, 12);
    const ninth = found[8];
    const asked = scripted([{ text: 'USE: 1, 2' }]);
    const result = await ScribeReminder.compose({
        state,
        now,
        player: 'Halvard',
        recent,
        unread: [],
        ask: asked.ask,
        first: [ninth.fact],
    });
    const rest = found.filter((candidate) => candidate !== ninth);
    assert.equal(asked.calls.length, 1);
    assert.equal(asked.calls[0].user, ScribeReminder.chooseInput(now, rest, recent));
    const entries = asked.calls[0].user.split('\n').filter((line) => /^\d+\. /.test(line));
    assert.equal(entries.length, 11);
    assert.equal(entries.some((line) => line.startsWith('9. ')), false);
    assert.equal(result.text.startsWith(`${opening} ${ninth.line}.`), true);
    assert.deepEqual(numbers(result.used), [9, 1, 2]);
    assert.deepEqual(plain(result.led), [ninth.fact]);
    assertFrozenDeep(result, 'result');
    const order = [12, 3, 3, 10, 1, 5, 7, 2, 11, 4];
    const silent = scripted([{ text: 'USE: 1' }]);
    const filled = await ScribeReminder.compose({
        state,
        now,
        player: 'Halvard',
        recent,
        unread: [],
        ask: silent.ask,
        first: order.map((number) => found[number - 1].fact),
    });
    assert.equal(silent.calls.length, 0);
    assert.deepEqual(numbers(filled.used), [12, 3, 10, 1, 5, 7, 2, 11]);
    assert.deepEqual(plain(filled.led), [12, 3, 10, 1, 5, 7, 2, 11].map((number) => found[number - 1].fact));
    const log = ScribeLog.create();
    const long = apply(
        log,
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character'],
            FACTS: Array.from(
                { length: 12 },
                (_, index) => `Mirelle | trait | habit ${index + 1} ${String.fromCodePoint(0xe9).repeat(185)} | #${index + 2}`,
            ),
            SCENES: ['Day 1 | #1-#20 | The hall | public | present: Halvard, Mirelle | They feast'],
        },
        stretch(1, 20),
    );
    const longNow = { ...scene(long, ['Halvard', 'Mirelle']), place: 'ü'.repeat(60) };
    const longFound = ScribeReminder.candidates(long, longNow, 'Halvard', []);
    assert.equal(longFound.length, 12);
    const full = await ScribeReminder.compose({
        state: long,
        now: longNow,
        player: 'Halvard',
        recent,
        unread: [],
        ask: scripted([{ text: 'USE: 1, 2' }]).ask,
        first: [longFound[8].fact],
    });
    assert.deepEqual(numbers(full.used), [9]);
    assert.deepEqual(plain(full.led), [longFound[8].fact]);
    assert.equal(full.text.endsWith(` ${longFound[8].line}.`), true);
    assert.equal(ScribeText.bytes(`${full.text} ${longFound[0].line}.`) > 600, true);
});

test('first makes nothing sayable', async () => {
    const state = book(
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Isolde | character'],
            FACTS: [
                'Mirelle | background | poisoned the old king | hidden | #5',
                'Mirelle | location | the mill | #6',
                'Mirelle | trait | hums | #7',
            ],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Mirelle, Isolde | They feast'],
        },
        10,
    );
    const now = scene(state, ['Halvard', 'Mirelle', 'Isolde']);
    const unread = unreadSaying('The rain falls.');
    const request = { state, now, player: 'Halvard', recent: [], unread, ask: scripted([]).ask };
    const plainResult = await ScribeReminder.compose(request);
    const ids = [factSaying(state, 'poisoned the old king').id, factSaying(state, 'the mill').id, 'F999'];
    const firstResult = await ScribeReminder.compose({ ...request, first: ids });
    assert.equal(firstResult.text, plainResult.text);
    assert.deepEqual(plain(firstResult.led), []);
    assert.equal(firstResult.used.some((candidate) => ids.includes(candidate.fact)), false);
    assert.equal(/poisoned|location/.test(firstResult.text), false);
    assert.equal(firstResult.text.endsWith('Mirelle, trait: "hums".'), true);
});

test('the worst opening still leaves room', () => {
    const place = deseret.repeat(60);
    const result = ScribeReminder.fit(
        bare(
            [
                { subject: 'S1', label: deseret.repeat(60) },
                { subject: 'S2', label: deseretOther.repeat(60) },
                { subject: null, label: 'a guard' },
            ],
            { day: Number.MAX_SAFE_INTEGER, place },
        ),
        [{ line: 'Mirelle, eyes: "grey"' }],
    );
    const head = `[Scribe] Day ${Number.MAX_SAFE_INTEGER}, private. Present: 3 people.`;
    assert.equal(result.text, `${head} Mirelle, eyes: "grey".`);
    assert.equal(ScribeText.bytes(head) <= 200, true);
    assert.equal(ScribeText.bytes(result.text) <= 600, true);
    assert.equal(ScribeReminder.printed(deseret.repeat(60)), deseret.repeat(60));
    assert.equal(ScribeReminder.quoted(place, 60), `"${place}"`);
});

/**
 * @param {object} state
 * @param {string[]} labels
 * @param {string} player
 * @return {Array<string|null>}
 */
function labelsOf(state, labels, player = 'Halvard') {
    return plain(ScribeReminder.people(state, scene(state, labels), player).map((person) => person.label));
}

test('a longer label may not speak of someone else', async () => {
    const cast = [
        'Halvard',
        'Isolde',
        'the men who saw Halvard desert',
        'guards of Halvard',
        'Isolde knows it too',
        "Halvard's sworn guard",
        'friends of Wren',
        'sons of Corvane',
        'ferryman of Ashby',
        'Isolde Venn',
        'Halvard Venn',
        'Tamsin the Elder',
        'Ida of Ash Vale',
        'the old smith of Ashford',
        'Brandt (the ferryman)',
    ];
    const state = book(
        {
            SUBJECTS: cast.map((label) => `${label} | character`),
            FACTS: [
                'Isolde | aka | Wren | hidden | #2',
                `Isolde Venn | aka | ${Array.from('Corvane', (letter) => String.fromCodePoint(letter.codePointAt(0) + 0xfee0)).join('')} | #3`,
                'Halvard | background | deserted at the siege | hidden | #5',
                'the men who saw Halvard desert | trait | loud | #12',
                'Isolde knows it too | trait | quiet | #13',
            ],
            SCENES: [
                'Day 1 | #1-#10 | The cellar | private | present: Halvard | He broods',
                'Day 1 | #11-#20 | The hall | public | present: Halvard, the men who saw Halvard desert, Isolde, Isolde knows it too | They feast',
            ],
        },
        20,
    );
    assert.deepEqual(labelsOf(state, cast), [
        'Halvard',
        'Isolde',
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        'Isolde Venn',
        'Halvard Venn',
        'Tamsin the Elder',
        'Ida of Ash Vale',
        null,
        'Brandt',
    ]);
    const warning = `${secret}background: "deserted at the siege".`;
    const men = await composed(state, scene(state, ['Halvard', 'the men who saw Halvard desert', 'Isolde']));
    assert.equal(men.text, `[Scribe] Day 3, "the mill", private. Present: Halvard, Isolde, and 1 other. ${warning}`);
    const echo = await composed(state, scene(state, ['Halvard', 'Isolde', 'Isolde knows it too']));
    assert.equal(echo.text, `[Scribe] Day 3, "the mill", private. Present: Halvard, Isolde, and 1 other. ${warning}`);
    for (const text of [men.text, echo.text]) {
        assert.equal(/men who saw|knows it too|loud|quiet/.test(text), false, text);
    }
    const lord = book(
        {
            SUBJECTS: ['Halvard Lord of Ash | character', 'Isolde | character'],
            FACTS: ['Halvard Lord of Ash | trait | stern | #2'],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard Lord of Ash, Isolde | They feast'],
        },
        10,
    );
    const lordResult = await composed(lord, scene(lord, ['Halvard Lord of Ash', 'Isolde']));
    assert.equal(
        lordResult.text,
        '[Scribe] Day 3, "the mill", private. Present: Halvard Lord of Ash, Isolde. Halvard Lord of Ash, trait: "stern".',
    );
});

test("a printed label may not be someone else's name", async () => {
    /**
     * @param {string} text
     * @return {string}
     */
    const widen = (text) =>
        Array.from(text, (letter) => (letter === ' ' ? letter : String.fromCodePoint(letter.codePointAt(0) + 0xfee0))).join('');
    /**
     * @param {string} aka
     * @param {boolean} hidden
     * @return {object}
     */
    const cook = (aka, hidden) => {
        const log = ScribeLog.create();
        const first = apply(
            log,
            {
                SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Mira (the cook) | character', 'Isolde | character'],
                FACTS: [`Mirelle | aka | ${aka}${hidden ? ' | hidden' : ''} | #2`, 'Halvard | background | deserted at the siege | hidden | #5'],
                SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Mirelle, Mira (the cook), Isolde | They feast'],
            },
            stretch(1, 10),
        );
        return apply(
            log,
            { TOLD: [`${factSaying(first, 'deserted at the siege').id} | Halvard | Mira (the cook) | #12`] },
            pick(12),
        );
    };
    const room = ['Halvard', 'Mirelle', 'Mira (the cook)', 'Isolde'];
    const open = cook('Mira', false);
    const result = await composed(open, scene(open, room));
    assert.equal(
        result.text,
        '[Scribe] Day 3, "the mill", private. Present: Halvard, Mirelle, Isolde, and 1 other. Mirelle, aka: "Mira".',
    );
    assert.equal(result.text.includes('only Mira know'), false);
    assert.deepEqual(labelsOf(cook('Mira', true), room), ['Halvard', 'Mirelle', null, 'Isolde']);
    assert.deepEqual(labelsOf(cook(widen('Mira'), false), room), ['Halvard', 'Mirelle', null, 'Isolde']);
    const ferry = book(
        {
            SUBJECTS: ['Halvard | character', 'Hal (the ferryman) | character', 'Isolde | character'],
            NAMES: ['Hal | Halvard | #2'],
            FACTS: ['Hal (the ferryman) | trait | rows | #3'],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Hal (the ferryman), Isolde | They feast'],
        },
        10,
    );
    assert.deepEqual(labelsOf(ferry, ['Halvard', 'Hal (the ferryman)', 'Isolde']), ['Halvard', null, 'Isolde']);
    const elder = book(
        {
            SUBJECTS: ['Halvard | character', 'Halvard (the elder) | character', 'Isolde | character'],
            FACTS: ['Halvard | background | deserted at the siege | hidden | #5', 'Halvard (the elder) | trait | limps | #6'],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Halvard (the elder), Isolde | They feast'],
        },
        10,
    );
    assert.equal(ScribeReminder.namesakes(elder, 'Halvard').length, 2);
    const omitted = await composed(elder, scene(elder, ['Halvard (the elder)', 'Isolde']));
    assert.equal(omitted.text, '[Scribe] Day 3, "the mill", private. Present: Isolde, and 1 other.');
    const listed = await composed(elder, scene(elder, ['Halvard', 'Halvard (the elder)', 'Isolde']));
    assert.equal(listed.text, '[Scribe] Day 3, "the mill", private. Present: Isolde, and 2 others.');
    const wide = widen('Halvard');
    const stranger = book(
        {
            SUBJECTS: [`${wide} (the elder) | character`, 'Isolde | character'],
            FACTS: [`${wide} (the elder) | trait | limps | #6`],
            SCENES: [`Day 1 | #1-#10 | The hall | public | present: ${wide} (the elder), Isolde | They feast`],
        },
        10,
    );
    assert.equal(ScribeReminder.printed(`${wide} (the elder)`), 'Halvard');
    assert.equal(ScribeReminder.namesakes(stranger, 'Halvard').length, 0);
    const unfound = await composed(stranger, scene(stranger, [`${wide} (the elder)`, 'Isolde']));
    assert.equal(unfound.text, '[Scribe] Day 3, "the mill", private. Present: Isolde, and 1 other.');
    assert.deepEqual(labelsOf(stranger, [`${wide} (the elder)`, 'Isolde'], 'Isolde'), ['Halvard', 'Isolde']);
    const doctor = widen('Dr Venn');
    const stops = book(
        {
            SUBJECTS: [
                'Halvard | character',
                'J.Venn | character',
                'JVenn | character',
                'Dr.Venn (the elder) | character',
                `${doctor} | character`,
                'Isolde | character',
            ],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Isolde | They feast'],
        },
        10,
    );
    assert.equal(stops.subjects.length, 6);
    assert.equal(ScribeReminder.printed(doctor), 'Dr Venn');
    assert.deepEqual(labelsOf(stops, ['Halvard', 'J.Venn', 'JVenn', 'Dr.Venn (the elder)', doctor, 'Isolde']), [
        'Halvard',
        null,
        null,
        'DrVenn',
        null,
        'Isolde',
    ]);
    const joined = ScribeLog.create();
    const apart = apply(
        joined,
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Mirelle (the cook) | character'],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Mirelle | They feast'],
        },
        stretch(1, 10),
    );
    assert.deepEqual(labelsOf(apart, ['Halvard', 'Mirelle']), ['Halvard', null]);
    const merged = rule(joined, { type: 'Merge', from: idOf(apart, 'Mirelle (the cook)'), into: idOf(apart, 'Mirelle') });
    assert.deepEqual(labelsOf(merged, ['Halvard', 'Mirelle', 'Mirelle (the cook)']), ['Halvard', 'Mirelle']);
    const kiras = ScribeLog.create();
    const twins = apply(
        kiras,
        {
            SUBJECTS: ['Halvard | character', 'Kira (the smith) | character', 'KIRA (the baker) | character', 'Isolde | character'],
            FACTS: ['Halvard | background | deserted at the siege | hidden | #5'],
            SCENES: ['Day 1 | #1-#10 | The cellar | private | present: Halvard | He broods'],
        },
        stretch(1, 10),
    );
    const told = apply(
        kiras,
        { TOLD: [`${factSaying(twins, 'deserted at the siege').id} | Halvard | KIRA (the baker) | #12`] },
        pick(12),
    );
    const both = await composed(told, scene(told, ['Halvard', 'Kira (the smith)', 'KIRA (the baker)', 'Isolde']));
    assert.equal(both.text, '[Scribe] Day 3, "the mill", private. Present: Halvard, Isolde, and 2 others.');
    assert.equal(
        ScribeReminder.write(
            bare([
                { subject: 'S1', label: 'Kira' },
                { subject: 'S2', label: 'KIRA' },
            ]),
            [],
        ),
        '[Scribe] Day 3, "the mill", private. Present: 2 people.',
    );
});

test('a backslash cannot stand in a quoted text', () => {
    const state = added([
        ['trait', 'hums an old tune \\'],
        ['trait', 'keeps notes in C:\\ledgers'],
    ]);
    assert.deepEqual(lines(offered(state, ['Halvard', 'Mirelle'])), [
        'Mirelle, trait: "hums an old tune /"',
        'Mirelle, trait: "keeps notes in C:/ledgers"',
    ]);
    const now = bare([
        { subject: 'S1', label: 'Halvard' },
        { subject: 'S2', label: 'Mirelle' },
    ]);
    assert.equal(
        ScribeReminder.write({ ...now, place: 'the mill \\' }, []),
        '[Scribe] Day 3, "the mill /", private. Present: Halvard, Mirelle.',
    );
});

test('look-alike quotation marks are replaced', async () => {
    const point = (code) => String.fromCodePoint(code);
    const marks = [0x2ba, 0x2ee, 0x5f4, 0x2033, 0x2036, 0x275d, 0x275e, 0x3003, 0x1f676, 0x1f677, 0x1f678];
    const texts = marks.map((code, index) => `hums ${point(code)}tune ${index + 1}${point(code)} softly`);
    const kept = [`wears Tamsin${curly}s ring`, "keeps O'Brien's key"];
    const state = added([...texts, ...kept].map((text) => ['trait', text]));
    const found = lines(offered(state, ['Halvard', 'Mirelle']));
    assert.deepEqual(found, [
        ...marks.map((_, index) => `Mirelle, trait: "hums 'tune ${index + 1}' softly"`),
        ...kept.map((text) => `Mirelle, trait: "${text}"`),
    ]);
    for (const line of found) {
        assert.equal(line.split('"').length - 1, 2, line);
    }
    const result = await composed(state, scene(state, ['Halvard', 'Mirelle']));
    assert.equal(result.text.split('"').length - 1, 2 + 2 * result.used.length);
    assert.equal(
        ScribeReminder.quoted(`the ${point(0x275d)}old${point(0x275e)} mill`, 60),
        `"the 'old' mill"`,
    );
});

test("the book's own characters are written", () => {
    const point = (...codes) => String.fromCodePoint(...codes);
    const kept = [
        `stands 5${point(0xbd)} ft`,
        `a debt of 10${point(0xb9, 0x2070)} crowns`,
        `owes 2${point(0xb3)} favours`,
        `lives at ${point(0x2116)}7`,
        `came on the ${point(0x2462)} day`,
    ];
    const refused = [`hums ${point(0xff3b)} gently`, `waves ${point(0xff20)}Isolde`, `signs ${point(0xfe6b)}Isolde`];
    const state = added([...kept, ...refused, `Zoe${point(0x308)} hums`].map((text) => ['trait', text]));
    assert.deepEqual(lines(offered(state, ['Halvard', 'Mirelle'])), [
        ...kept.map((text) => `Mirelle, trait: "${text}"`),
        `Mirelle, trait: "Zo${point(0xeb)} hums"`,
    ]);
    const now = bare([{ subject: 'S1', label: 'Halvard' }]);
    assert.equal(
        ScribeReminder.write({ ...now, place: `the 5${point(0xbd)} mile inn` }, []),
        `[Scribe] Day 3, "the 5${point(0xbd)} mile inn", private. Present: Halvard.`,
    );
    assert.equal(ScribeReminder.write({ ...now, place: `the ${point(0xff20)} inn` }, []), '[Scribe] Day 3, private. Present: Halvard.');
});

test('a long place does not cost the names', () => {
    const umlaut = String.fromCodePoint(0xfc);
    const now = bare([
        { subject: 'S1', label: 'Halvard' },
        { subject: 'S2', label: 'Mirelle' },
        { subject: 'S3', label: 'Isolde' },
    ]);
    assert.equal(
        ScribeReminder.write({ ...now, place: deseret.repeat(60) }, []),
        '[Scribe] Day 3, private. Present: Halvard, Mirelle, Isolde.',
    );
    const eighty = umlaut.repeat(39);
    assert.equal(ScribeText.bytes(`"${eighty}"`), 80);
    assert.equal(
        ScribeReminder.write({ ...now, place: eighty }, []),
        `[Scribe] Day 3, "${eighty}", private. Present: Halvard, Mirelle, Isolde.`,
    );
    assert.equal(
        ScribeReminder.write({ ...now, place: `${eighty}a` }, []),
        '[Scribe] Day 3, private. Present: Halvard, Mirelle, Isolde.',
    );
});

test('no line toward nobody', () => {
    const state = book(
        {
            SUBJECTS: [
                'Halvard | character',
                'Mirelle | character',
                'Kira (the smith) | character',
                'Kira (the baker) | character',
                'Brandt Sons! | group',
            ],
            FACTS: [
                'Mirelle | relation to Kira (the smith) | owes her money | #2',
                'Mirelle | relation to Brandt Sons! | buys their grain | #3',
                'Mirelle | relation to Halvard | old friends | #4',
                'Mirelle | trait | hums | #5',
            ],
            SCENES: [
                'Day 1 | #1-#10 | The hall | public | present: Halvard, Mirelle, Kira (the smith), Kira (the baker), Brandt Sons! | They feast',
            ],
        },
        10,
    );
    assert.notEqual(factSaying(state, 'owes her money').target, null);
    assert.notEqual(factSaying(state, 'buys their grain').target, null);
    for (const room of [
        ['Halvard', 'Mirelle', 'Kira (the smith)', 'Kira (the baker)', 'Brandt Sons!'],
        ['Halvard', 'Mirelle', 'Kira (the smith)', 'Brandt Sons!'],
    ]) {
        const found = lines(offered(state, room));
        assert.deepEqual(found, ['Mirelle toward Halvard: "old friends"', 'Mirelle, trait: "hums"'], room.join(','));
        assert.equal(found.some((line) => /null|toward Kira|toward Brandt/.test(line)), false, room.join(','));
    }
});

test('at most eight entries', async () => {
    const state = crowd(9);
    const now = scene(state, ['Halvard', 'Mirelle']);
    const found = ScribeReminder.candidates(state, now, 'Halvard', []);
    assert.equal(found.length, 12);
    const first = [12, 5, 7].map((number) => found[number - 1].fact);
    assert.equal(ScribeText.bytes(ScribeReminder.write(now, found)) <= 600, true);
    for (const answer of ['USE: 1, 2, 3, 4, 6, 8, 9, 10', 'nothing useful']) {
        const result = await ScribeReminder.compose({
            state,
            now,
            player: 'Halvard',
            recent: [],
            unread: [],
            ask: scripted([{ text: answer }]).ask,
            first,
        });
        assert.deepEqual(numbers(result.used), [12, 5, 7, 1, 2, 3, 4, 6], answer);
        assert.equal(result.text, ScribeReminder.write(now, result.used), answer);
        assert.deepEqual(plain(result.led), first, answer);
    }
});

test('the limits are exact', () => {
    const lead = '[Scribe] Day 3, "the mill", private. Present: ';
    const name = deseret.repeat(36);
    const exact = ScribeReminder.write(
        bare([
            { subject: 'S1', label: 'Halvard' },
            { subject: 'S2', label: name },
        ]),
        [],
    );
    assert.equal(exact, `${lead}Halvard, ${name}.`);
    assert.equal(ScribeText.bytes(exact), 200);
    assert.equal(
        ScribeReminder.write(
            bare([
                { subject: 'S1', label: 'Halvard' },
                { subject: 'S2', label: `a${name}` },
            ]),
            [],
        ),
        `${lead}Halvard, and 1 other.`,
    );
    const pair = bare([
        { subject: 'S1', label: 'Halvard' },
        { subject: 'S2', label: 'Mirelle' },
    ]);
    const opening = ScribeReminder.write(pair, []);
    const fill = 600 - ScribeText.bytes(opening) - 2;
    const full = ScribeReminder.fit(pair, [{ line: 'x'.repeat(fill) }]);
    assert.equal(ScribeText.bytes(full.text), 600);
    assert.equal(full.used.length, 1);
    const over = ScribeReminder.fit(pair, [{ line: 'x'.repeat(fill + 1) }]);
    assert.equal(over.text, opening);
    assert.equal(over.used.length, 0);
    const alone = [{ subject: null, label: 'a guard' }];
    const kept = ScribeReminder.write(bare(alone, { reach: 'x'.repeat(152) }), []);
    assert.equal(kept, `[Scribe] Day 3, "the mill", ${'x'.repeat(152)}. Present: 1 person.`);
    assert.equal(ScribeText.bytes(kept), 200);
    const dropped = ScribeReminder.write(bare(alone, { reach: 'x'.repeat(153) }), []);
    assert.equal(dropped, `[Scribe] Day 3, ${'x'.repeat(153)}. Present: 1 person.`);
});

test('first may be absent', async () => {
    const state = crowd(9);
    const now = scene(state, ['Halvard', 'Mirelle']);
    const ninth = ScribeReminder.candidates(state, now, 'Halvard', [])[8].fact;
    const request = { state, now, player: 'Halvard', recent: [], unread: [], ask: async () => ({ text: 'USE: 1, 2' }) };
    const expected = await ScribeReminder.compose({ ...request, first: [] });
    assert.deepEqual(numbers(expected.used), [1, 2]);
    const led = await ScribeReminder.compose({ ...request, first: [ninth] });
    assert.deepEqual(numbers(led.used), [9, 1, 2]);
    const odd = [null, ninth, new Set([ninth]), { 0: ninth, length: 1 }, 9];
    for (const result of [await ScribeReminder.compose(request), ...(await Promise.all(odd.map((first) => ScribeReminder.compose({ ...request, first }))))]) {
        assert.equal(result.text, expected.text);
        assert.deepEqual(numbers(result.used), [1, 2]);
        assert.deepEqual(plain(result.led), []);
    }
});
