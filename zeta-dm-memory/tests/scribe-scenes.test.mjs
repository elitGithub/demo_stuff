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
 * @param {string[]} order
 * @param {string} answerText
 * @param {object[]} messages
 * @param {string} origin
 * @return {{ state: object, result: object, parsed: object }}
 */
function apply(log, order, answerText, messages, origin = 'Story') {
    const before = ScribeReplay.run(log, order);
    const parsed = ScribeAnswer.parse(answerText);
    assert.deepEqual(plain(parsed.refused), [], answerText);
    const result = ScribeLog.append(log, before, parsed.operations, { messages, origin });
    return { state: ScribeReplay.run(log, order), result, parsed };
}

/**
 * @param {object} state
 * @param {string} label
 * @return {object}
 */
function subjectLabelled(state, label) {
    const found = state.subjects.filter((subject) => subject.label === label);
    assert.equal(found.length, 1, `subjects labelled ${label}`);
    return found[0];
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
 * @param {string} id
 * @return {object}
 */
function factNumbered(state, id) {
    const found = state.facts.filter((fact) => fact.id === id);
    assert.equal(found.length, 1, `facts numbered ${id}`);
    return found[0];
}

/**
 * @param {object} state
 * @return {Array<[string, string, string]>}
 */
function statuses(state) {
    return plain(state.facts.map((fact) => [fact.id, fact.text, fact.status]));
}

/**
 * @param {object} result
 * @return {string[]}
 */
function reasons(result) {
    return plain(result.refused.map((item) => item.reason));
}

test("a numbered line must name its fact's subject", () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: [
                'Halvard | character',
                'Mirelle | character',
                'Oswin (the miller) | character',
                "Oswin (Tamsin's uncle) | character",
            ],
            FACTS: [
                'Halvard | location | the mill | #1',
                'Oswin (the miller) | trait | quiet | #1',
                'Halvard | aka | Hal | #1',
            ],
        }),
        pick(1),
    );
    const halvard = subjectLabelled(first.state, 'Halvard');
    const miller = subjectLabelled(first.state, 'Oswin (the miller)');
    const before = plain(factNumbered(first.state, 'F1'));
    const wrong = apply(
        log,
        storyOrder,
        answer({
            CHANGES: [
                'F1 | Mirelle | location | the inn | #5',
                'F1 | Mirelle | location | ENDED: it burned | #5',
                'F1 | Mirelle | location | FULLER: the mill loft | #5',
                'F1 | Oswin | location | the inn | #5',
            ],
        }),
        pick(5),
    );
    assert.deepEqual(reasons(wrong.result), ['Mismatch', 'Mismatch', 'Mismatch', 'Mismatch']);
    wrong.result.refused.forEach((item, index) => assert.equal(item.operation, wrong.parsed.operations[index]));
    assert.deepEqual(plain(wrong.result.entry.operations), []);
    assert.deepEqual(plain(factNumbered(wrong.state, 'F1')), before);
    assert.equal(wrong.state.facts.length, 3);
    assert.equal(log.nextFact, 4);
    const right = apply(log, storyOrder, answer({ CHANGES: ['F1 | Halvard | location | the inn | #6'] }), pick(6));
    assert.deepEqual(plain(right.result.refused), []);
    assert.deepEqual(plain(right.result.entry.operations), [
        {
            type: 'Change',
            fact: 'F1',
            becomes: 'F4',
            subject: halvard.id,
            label: 'Halvard',
            category: 'location',
            target: null,
            targetText: null,
            other: null,
            hidden: false,
            text: 'the inn',
            cite: 'MESSAGE-6',
            position: 6,
        },
    ]);
    assert.equal(factNumbered(right.state, 'F1').status, 'Replaced');
    assert.equal(factSaying(right.state, 'the inn').status, 'InForce');
    const byAka = apply(log, storyOrder, answer({ CHANGES: ['F4 | Hal | location | the harbour | #7'] }), pick(7));
    assert.deepEqual(plain(byAka.result.refused), []);
    assert.equal(byAka.result.entry.operations[0].label, 'Hal');
    assert.equal(factSaying(byAka.state, 'the harbour').subject, halvard.id);
    assert.equal(factSaying(byAka.state, 'the harbour').status, 'InForce');
    const shared = apply(
        log,
        storyOrder,
        answer({
            CHANGES: [
                'F2 | Oswin | trait | FULLER: quiet and watchful | #8',
                "F2 | Oswin (Tamsin's uncle) | trait | ENDED | #8",
            ],
        }),
        pick(8),
    );
    assert.deepEqual(reasons(shared.result), ['Mismatch']);
    assert.equal(shared.result.refused[0].operation, shared.parsed.operations[1]);
    assert.equal(factSaying(shared.state, 'quiet and watchful').subject, miller.id);
    assert.equal(factSaying(shared.state, 'quiet and watchful').status, 'InForce');
    const full = apply(log, storyOrder, answer({ CHANGES: ['F2 | Oswin (the miller) | trait | ENDED | #9'] }), pick(9));
    assert.deepEqual(plain(full.result.refused), []);
    assert.equal(factSaying(full.state, 'quiet and watchful').status, 'Ended');
    const marked = apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Halvard | place'],
            CHANGES: ['F5 | Halvard | location | the quay | #10'],
            TOLD: ['F5 | Halvard | Mirelle | #10'],
        }),
        pick(10),
    );
    assert.deepEqual(reasons(marked.result), ['Mismatch', 'Mismatch', 'Mismatch']);
    assert.equal(factSaying(marked.state, 'the harbour').status, 'InForce');
    assert.deepEqual(plain(factSaying(marked.state, 'the harbour').told), []);
});

test("a numbered line must name its fact's category", () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Tamsin | character'],
            FACTS: [
                'Halvard | location | the mill | #1',
                'Mirelle | aka | Mirry | #1',
                'Halvard | relation to Mirelle | trusts her | #1',
                'Halvard | relation to Brandt | owes him | #1',
                'Halvard | relation to ** | fears it | #1',
            ],
        }),
        pick(1),
    );
    const mirelle = subjectLabelled(first.state, 'Mirelle');
    assert.equal(factNumbered(first.state, 'F3').target, mirelle.id);
    assert.equal(factNumbered(first.state, 'F4').target, null);
    const wrong = apply(
        log,
        storyOrder,
        answer({
            CHANGES: [
                'F1 | Halvard | role | the inn | #5',
                'F1 | Halvard | location | FULLER: the mill loft | #5',
                'F3 | Halvard | relation to Tamsin | cold | #5',
                'F3 | Halvard | trait | cold | #5',
                'F4 | Halvard | relation to Mirelle | square with him | #5',
                'F4 | Halvard | relation to Corvane | square with him | #5',
                'F5 | Halvard | relation to ** | calm about it | #5',
            ],
        }),
        pick(5),
    );
    assert.deepEqual(reasons(wrong.result), ['Mismatch', 'Mismatch', 'Mismatch', 'Mismatch', 'Mismatch', 'Mismatch']);
    assert.deepEqual(
        plain(wrong.result.refused.map((item) => wrong.parsed.operations.indexOf(item.operation))),
        [0, 2, 3, 4, 5, 6],
    );
    assert.equal(factSaying(wrong.state, 'the mill loft').status, 'InForce');
    assert.equal(factSaying(wrong.state, 'trusts her').status, 'InForce');
    const right = apply(
        log,
        storyOrder,
        answer({
            CHANGES: [
                'F3 | Halvard | relation to Mirelle | cold | #6',
                'F4 | Halvard | relation to brandt | square with him | #6',
            ],
        }),
        pick(6),
    );
    assert.deepEqual(plain(right.result.refused), []);
    assert.equal(factSaying(right.state, 'trusts her').status, 'Replaced');
    assert.equal(factSaying(right.state, 'cold').status, 'InForce');
    assert.equal(factSaying(right.state, 'cold').target, mirelle.id);
    assert.equal(factSaying(right.state, 'square with him').status, 'InForce');
    const cold = factSaying(right.state, 'cold').id;
    const byAka = apply(
        log,
        storyOrder,
        answer({ CHANGES: [`${cold} | Halvard | relation to Mirry | warm again | #7`] }),
        pick(7),
    );
    assert.deepEqual(plain(byAka.result.refused), []);
    assert.equal(factSaying(byAka.state, 'warm again').target, mirelle.id);
    const warm = factSaying(byAka.state, 'warm again').id;
    const marked = apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Mirry | place'],
            CHANGES: [`${warm} | Halvard | relation to Mirry | wary of her | #8`],
        }),
        pick(8),
    );
    assert.deepEqual(reasons(marked.result), ['Mismatch', 'Mismatch']);
    assert.equal(factSaying(marked.state, 'warm again').status, 'InForce');
});

test("a told line must name the fact's owner", () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ SUBJECTS: ['Halvard | character', 'Mirelle | character'], FACTS: ['Halvard | age | forty | #1'] }),
        pick(1),
    );
    const wrong = apply(log, storyOrder, answer({ TOLD: ['F1 | Mirelle | Kira | #5'] }), pick(5));
    assert.deepEqual(reasons(wrong.result), ['Mismatch']);
    assert.deepEqual(plain(wrong.result.entry.operations), []);
    assert.deepEqual(plain(wrong.state.subjects.map((subject) => subject.label)), ['Halvard', 'Mirelle']);
    assert.equal(log.nextSubject, 3);
    assert.deepEqual(plain(factNumbered(wrong.state, 'F1').told), []);
    const right = apply(log, storyOrder, answer({ TOLD: ['F1 | Halvard | Kira | #6'] }), pick(6));
    assert.deepEqual(plain(right.result.refused), []);
    const kira = subjectLabelled(right.state, 'Kira');
    assert.deepEqual(plain(right.result.entry.operations), [
        { type: 'Subject', subject: kira.id, label: 'Kira', kind: null },
        {
            type: 'Told',
            fact: 'F1',
            subject: kira.id,
            owner: 'Halvard',
            label: 'Kira',
            cite: 'MESSAGE-6',
            position: 6,
        },
    ]);
    assert.deepEqual(plain(factNumbered(right.state, 'F1').told), [kira.id]);
});

test('the owner name is read as a filing name', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Oswin | character', 'Oswin (the miller) | character'],
            FACTS: ['Oswin (the miller) | trait | quiet | #1'],
        }),
        pick(1),
    );
    const plainName = apply(
        log,
        storyOrder,
        answer({ CHANGES: ['F1 | Oswin | trait | ENDED: grew talkative | #3'], TOLD: ['F1 | Oswin | Kira | #3'] }),
        pick(3),
    );
    assert.deepEqual(reasons(plainName.result), ['Mismatch', 'Mismatch']);
    assert.deepEqual(plain(plainName.result.entry.operations), []);
    assert.equal(factNumbered(plainName.state, 'F1').status, 'InForce');
    assert.equal(plainName.state.subjects.length, 2);
    const fullName = apply(
        log,
        storyOrder,
        answer({
            CHANGES: ['F1 | Oswin (the miller) | trait | ENDED: grew talkative | #4'],
            TOLD: ['F1 | Oswin (the miller) | Kira | #4'],
        }),
        pick(4),
    );
    assert.deepEqual(plain(fullName.result.refused), []);
    assert.equal(factNumbered(fullName.state, 'F1').status, 'Ended');
    assert.deepEqual(plain(factNumbered(fullName.state, 'F1').told), [subjectLabelled(fullName.state, 'Kira').id]);
    const bracketed = ScribeLog.create();
    apply(
        bracketed,
        storyOrder,
        answer({
            SUBJECTS: ['Oswin (the miller) | character', "Oswin (Tamsin's uncle) | character"],
            FACTS: ['Oswin (the miller) | trait | quiet | #1', "Oswin (Tamsin's uncle) | trait | loud | #1"],
        }),
        pick(1),
    );
    const either = apply(
        bracketed,
        storyOrder,
        answer({ CHANGES: ['F1 | Oswin | trait | ENDED | #3', 'F2 | Oswin | trait | FULLER: loud and merry | #3'] }),
        pick(3),
    );
    assert.deepEqual(plain(either.result.refused), []);
    assert.deepEqual(statuses(either.state), [
        ['F1', 'quiet', 'Ended'],
        ['F2', 'loud', 'Replaced'],
        ['F3', 'loud and merry', 'InForce'],
    ]);
    const hal = ScribeLog.create();
    apply(
        hal,
        storyOrder,
        answer({
            SUBJECTS: ['Hal | character', 'Halvard | character'],
            FACTS: ['Halvard | aka | Hal | #1', 'Halvard | belonging | a knife | #1'],
        }),
        pick(1),
    );
    const taken = apply(
        hal,
        storyOrder,
        answer({ CHANGES: ['F2 | Hal | belonging | ENDED: lost it | #3'] }),
        pick(3),
    );
    assert.deepEqual(plain(subjectLabelled(taken.state, 'Halvard').aka), ['Hal']);
    assert.deepEqual(reasons(taken.result), ['Mismatch']);
    assert.equal(factNumbered(taken.state, 'F2').status, 'InForce');
});

test('a numbered line cannot reach a fact stated later', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | age | forty | #50', 'Halvard | belonging | a lantern | #50'] }),
        stretch(50, 60),
    );
    const early = apply(
        log,
        storyOrder,
        answer({
            TOLD: ['F1 | Halvard | Kira | #25'],
            CHANGES: ['F2 | Halvard | belonging | ENDED: sold it | #30', 'F2 | Halvard | belonging | a lamp | #29'],
        }),
        stretch(20, 30),
    );
    assert.deepEqual(reasons(early.result), ['Citation', 'Citation', 'Citation']);
    assert.deepEqual(plain(early.result.entry.operations), []);
    assert.deepEqual(plain(early.state.subjects.map((subject) => subject.label)), ['Halvard']);
    assert.deepEqual(statuses(early.state), [
        ['F1', 'forty', 'InForce'],
        ['F2', 'a lantern', 'InForce'],
    ]);
    const same = apply(
        log,
        storyOrder,
        answer({
            TOLD: ['F1 | Halvard | Kira | #50'],
            CHANGES: [
                'F2 | Halvard | belonging | ENDED: sold it | #50',
                'F1 | Halvard | age | FULLER: forty winters | #50',
            ],
        }),
        pick(50),
        'Notes',
    );
    assert.deepEqual(plain(same.result.refused), []);
    assert.deepEqual(plain(factNumbered(same.state, 'F1').told), [subjectLabelled(same.state, 'Kira').id]);
    assert.equal(factNumbered(same.state, 'F2').status, 'Ended');
    assert.deepEqual(statuses(same.state), [
        ['F1', 'forty', 'Replaced'],
        ['F2', 'a lantern', 'Ended'],
        ['F3', 'forty winters', 'InForce'],
    ]);
});

test('a change follows a fuller wording', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | eyes | grey | #1'] }), pick(1));
    const { state, result } = apply(
        log,
        storyOrder,
        answer({
            CHANGES: ['F1 | Halvard | eyes | FULLER: grey as slate | #2', 'F1 | Halvard | eyes | milky white | #3'],
        }),
        pick(2, 3),
    );
    assert.deepEqual(plain(result.refused), []);
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.text, fact.status, fact.replacedBy])), [
        ['F1', 'grey', 'Replaced', 'F2'],
        ['F2', 'grey as slate', 'Replaced', 'F3'],
        ['F3', 'milky white', 'InForce', null],
    ]);
    assert.deepEqual(plain(state.conflicts), []);
    const back = apply(log, storyOrder, answer({ FACTS: ['Halvard | eyes | grey | #4'] }), pick(4));
    assert.equal(factNumbered(back.state, 'F4').status, 'Disputed');
    assert.deepEqual(plain(back.state.conflicts), [
        { subject: 'S1', category: 'eyes', target: null, established: 'F3', others: ['F4'] },
    ]);
    const second = ScribeLog.create();
    apply(second, storyOrder, answer({ FACTS: ['Halvard | eyes | grey | #1'] }), pick(1));
    const twice = apply(
        second,
        storyOrder,
        answer({
            CHANGES: [
                'F1 | Halvard | eyes | FULLER: grey as slate | #2',
                'F1 | Halvard | eyes | FULLER: grey flecked with green | #3',
            ],
        }),
        pick(2, 3),
    );
    assert.deepEqual(statuses(twice.state), [
        ['F1', 'grey', 'Replaced'],
        ['F2', 'grey as slate', 'InForce'],
        ['F3', 'grey flecked with green', 'Disputed'],
    ]);
});

test("an end must name the fact's category", () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | location | the mill | #1', 'Halvard | trait | proud | #1'] }),
        pick(1),
    );
    const { state, result } = apply(
        log,
        storyOrder,
        answer({ CHANGES: ['F1 | Halvard | trait | ENDED: humbled | #5'] }),
        pick(5),
    );
    assert.deepEqual(reasons(result), ['Mismatch']);
    assert.deepEqual(statuses(state), [
        ['F1', 'the mill', 'InForce'],
        ['F2', 'proud', 'InForce'],
    ]);
});

test('changes of list and passing facts replace them', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            FACTS: [
                'Halvard | trait | timid | #1',
                'Halvard | condition | a fever | #1',
                'Halvard | location | the mill | #1',
            ],
        }),
        pick(1),
    );
    apply(
        log,
        storyOrder,
        answer({
            CHANGES: [
                'F1 | Halvard | trait | bold | #3',
                'F2 | Halvard | condition | a worse fever | #3',
                'F3 | Halvard | location | ENDED: it burned | #5',
            ],
        }),
        pick(3, 5),
    );
    const { state } = apply(log, storyOrder, answer({ FACTS: ['Halvard | location | the inn | #9'] }), pick(9));
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.text, fact.status, fact.replacedBy])), [
        ['F1', 'timid', 'Replaced', 'F4'],
        ['F2', 'a fever', 'Replaced', 'F5'],
        ['F3', 'the mill', 'Ended', null],
        ['F4', 'bold', 'InForce', null],
        ['F5', 'a worse fever', 'InForce', null],
        ['F6', 'the inn', 'InForce', null],
    ]);
    const timid = apply(log, storyOrder, answer({ FACTS: ['Halvard | trait | timid | #10'] }), pick(10));
    assert.equal(factNumbered(timid.state, 'F7').status, 'InForce');
    const night = apply(log, storyOrder, answer({ NIGHTS: ['#11 | they sleep'] }), pick(11));
    assert.deepEqual(plain([factNumbered(night.state, 'F2').status, factNumbered(night.state, 'F5').status]), [
        'Replaced',
        'Expired',
    ]);
});

test('a change or end of a disputed value un-says it', () => {
    for (const line of ['F2 | Halvard | age | forty | #30', 'F2 | Halvard | age | ENDED | #30']) {
        const log = ScribeLog.create();
        apply(
            log,
            storyOrder,
            answer({ FACTS: ['Halvard | age | twenty-five | #1', 'Halvard | age | thirty | #2'] }),
            pick(1, 2),
        );
        apply(log, storyOrder, answer({ CHANGES: [line] }), pick(30));
        const { state, result } = apply(log, storyOrder, answer({ FACTS: ['Halvard | age | thirty | #40'] }), pick(40));
        assert.equal(result.entry.operations.length, 1, line);
        const restated = factNumbered(state, result.entry.operations[0].fact);
        assert.deepEqual([restated.text, restated.status], ['thirty', 'Disputed'], line);
        assert.equal(factNumbered(state, 'F1').status, 'InForce', line);
    }
});

test('a change of an aka lends the new name', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | aka | Hal | #1'] }), pick(1));
    const { state, result } = apply(
        log,
        storyOrder,
        answer({ CHANGES: ['F1 | Halvard | aka | Valdi | #5'], FACTS: ['Valdi | trait | stern | #5'] }),
        pick(5),
    );
    assert.deepEqual(plain(result.refused), []);
    assert.deepEqual(plain(state.subjects.map((subject) => subject.label)), ['Halvard']);
    const halvard = subjectLabelled(state, 'Halvard');
    assert.equal(factSaying(state, 'stern').subject, halvard.id);
    assert.deepEqual(plain(halvard.aka), ['Hal', 'Valdi']);
});

test('a story change is not a conflict', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | age | twenty | #5'] }), pick(5));
    const { state } = apply(log, storyOrder, answer({ CHANGES: ['F1 | Halvard | age | twenty-one | #30'] }), pick(30));
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.text, fact.status, fact.replacedBy])), [
        ['F1', 'twenty', 'Replaced', 'F2'],
        ['F2', 'twenty-one', 'InForce', null],
    ]);
    const changed = factNumbered(state, 'F2');
    assert.deepEqual([changed.subject, changed.category, changed.position], ['S1', 'age', 30]);
    assert.deepEqual(plain(state.conflicts), []);
    assert.deepEqual(plain(state.refinements), []);
});

test('the old value returning after a change is a conflict', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | age | twenty | #5'] }), pick(5));
    apply(log, storyOrder, answer({ CHANGES: ['F1 | Halvard | age | twenty-one | #30'] }), pick(30));
    const back = apply(log, storyOrder, answer({ FACTS: ['Halvard | age | Twenty. | #40'] }), pick(40));
    assert.deepEqual(statuses(back.state), [
        ['F1', 'twenty', 'Replaced'],
        ['F2', 'twenty-one', 'InForce'],
        ['F3', 'Twenty.', 'Disputed'],
    ]);
    assert.deepEqual(plain(back.state.conflicts), [
        { subject: 'S1', category: 'age', target: null, established: 'F2', others: ['F3'] },
    ]);
    const early = apply(log, storyOrder, answer({ FACTS: ['Halvard | age | twenty | #10'] }), pick(10));
    assert.equal(early.result.entry.operations.length, 1);
    assert.deepEqual(statuses(early.state), statuses(back.state));
    const chain = ScribeLog.create();
    apply(chain, storyOrder, answer({ FACTS: ['Halvard | eyes | grey | #1'] }), pick(1));
    apply(chain, storyOrder, answer({ CHANGES: ['F1 | Halvard | eyes | FULLER: grey as slate | #2'] }), pick(2));
    apply(chain, storyOrder, answer({ CHANGES: ['F1 | Halvard | eyes | ENDED: lost an eye | #3'] }), pick(3));
    apply(chain, storyOrder, answer({ FACTS: ['Halvard | eyes | grey | #4'] }), pick(4));
    apply(chain, storyOrder, answer({ CHANGES: ['F3 | Halvard | eyes | FULLER: grey as rain | #5'] }), pick(5));
    apply(chain, storyOrder, answer({ CHANGES: ['F4 | Halvard | eyes | milky white | #6'] }), pick(6));
    const returned = apply(
        chain,
        storyOrder,
        answer({ FACTS: ['Halvard | eyes | grey | #7', 'Halvard | eyes | grey as rain | #7'] }),
        pick(7),
    );
    assert.deepEqual(statuses(returned.state), [
        ['F1', 'grey', 'Replaced'],
        ['F2', 'grey as slate', 'Ended'],
        ['F3', 'grey', 'Replaced'],
        ['F4', 'grey as rain', 'Replaced'],
        ['F5', 'milky white', 'InForce'],
        ['F6', 'grey', 'Disputed'],
        ['F7', 'grey as rain', 'Disputed'],
    ]);
});

test('a change whose fact has gone stands as a fact', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | age | twenty | #1'] }), pick(1));
    apply(log, storyOrder, answer({ FACTS: ['Mirelle | age | nineteen | #2'] }), pick(2));
    apply(log, storyOrder, answer({ CHANGES: ['F1 | Halvard | age | twenty-one | #5'] }), pick(5));
    log.entries[0].withdrawn = true;
    const state = ScribeReplay.run(log, storyOrder);
    assert.deepEqual(plain(state.facts.filter((fact) => fact.subject === 'S1')), [
        {
            id: 'F3',
            subject: 'S1',
            category: 'age',
            target: null,
            targetText: null,
            text: 'twenty-one',
            cite: 'MESSAGE-5',
            position: 5,
            origin: 'Story',
            hidden: false,
            told: [],
            widened: null,
            status: 'InForce',
            replacedBy: null,
            ended: null,
            pinned: false,
            made: false,
        },
    ]);
    assert.deepEqual(plain(state.refinements), []);
    assert.deepEqual(plain(state.conflicts), []);
});

test('a change does not pass on who was told', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | age | twenty | #1'] }), pick(1));
    const told = apply(log, storyOrder, answer({ TOLD: ['F1 | Halvard | Kira | #2'] }), pick(2));
    const kira = subjectLabelled(told.state, 'Kira');
    const { state } = apply(log, storyOrder, answer({ CHANGES: ['F1 | Halvard | age | twenty-one | #3'] }), pick(3));
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.text, fact.status, fact.told])), [
        ['F1', 'twenty', 'Replaced', [kira.id]],
        ['F2', 'twenty-one', 'InForce', []],
    ]);
});

test('a fuller line does not pass on who was told', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | eyes | grey | #1'] }), pick(1));
    const told = apply(log, storyOrder, answer({ TOLD: ['F1 | Halvard | Kira | #2'] }), pick(2));
    const kira = subjectLabelled(told.state, 'Kira');
    const fuller = apply(
        log,
        storyOrder,
        answer({ CHANGES: ['F1 | Halvard | eyes | FULLER: grey as slate | #3'] }),
        pick(3),
    );
    assert.deepEqual(plain(fuller.state.facts.map((fact) => [fact.id, fact.status, fact.told])), [
        ['F1', 'Replaced', [kira.id]],
        ['F2', 'InForce', []],
    ]);
    const later = apply(log, storyOrder, answer({ TOLD: ['F1 | Halvard | Mirelle | #4'] }), pick(4));
    const mirelle = subjectLabelled(later.state, 'Mirelle');
    assert.deepEqual(plain(later.state.facts.map((fact) => [fact.id, fact.status, fact.told])), [
        ['F1', 'Replaced', [kira.id, mirelle.id]],
        ['F2', 'InForce', []],
    ]);
});

test('a story change leaves an earlier dispute open', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | age | twenty-five | #1', 'Halvard | age | thirty | #2'] }),
        pick(1, 2),
    );
    const { state } = apply(log, storyOrder, answer({ CHANGES: ['F1 | Halvard | age | thirty | #90'] }), pick(90));
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.text, fact.status, fact.replacedBy])), [
        ['F1', 'twenty-five', 'Replaced', 'F3'],
        ['F2', 'thirty', 'Disputed', null],
        ['F3', 'thirty', 'InForce', null],
    ]);
    assert.deepEqual(plain(state.conflicts), [
        { subject: 'S1', category: 'age', target: null, established: 'F3', others: ['F2'] },
    ]);
    const kept = ScribeLog.create();
    apply(
        kept,
        storyOrder,
        answer({ FACTS: ['Halvard | age | twenty-five | #1', 'Halvard | age | thirty | #2'] }),
        pick(1, 2),
    );
    const disputedChange = apply(kept, storyOrder, answer({ CHANGES: ['F2 | Halvard | age | forty | #30'] }), pick(30));
    assert.deepEqual(plain(disputedChange.state.conflicts), [
        { subject: 'S1', category: 'age', target: null, established: 'F1', others: ['F3'] },
    ]);
});

test('a fuller line settles a same-worded dispute', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | eyes | grey | #1', 'Halvard | eyes | grey as slate | #2'] }),
        pick(1, 2),
    );
    const { state } = apply(
        log,
        storyOrder,
        answer({ CHANGES: ['F1 | Halvard | eyes | FULLER: Grey as slate. | #3'] }),
        pick(3),
    );
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.status, fact.replacedBy])), [
        ['F1', 'Replaced', 'F3'],
        ['F2', 'Replaced', 'F3'],
        ['F3', 'InForce', null],
    ]);
    assert.deepEqual(plain(state.conflicts), []);
    const mixed = ScribeLog.create();
    apply(
        mixed,
        storyOrder,
        answer({
            FACTS: ['Halvard | eyes | grey | #1', 'Halvard | eyes | grey as slate | #2', 'Halvard | eyes | blue | #2'],
        }),
        pick(1, 2),
    );
    const partly = apply(
        mixed,
        storyOrder,
        answer({ CHANGES: ['F1 | Halvard | eyes | FULLER: grey as slate | #3'] }),
        pick(3),
    );
    assert.deepEqual(statuses(partly.state), [
        ['F1', 'grey', 'Replaced'],
        ['F2', 'grey as slate', 'Replaced'],
        ['F3', 'blue', 'Disputed'],
        ['F4', 'grey as slate', 'InForce'],
    ]);
    assert.deepEqual(plain(partly.state.conflicts), [
        { subject: 'S1', category: 'eyes', target: null, established: 'F4', others: ['F3'] },
    ]);
});

test('ended facts leave the book', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ FACTS: ['Mirelle | belonging | a silver ring | #1', 'Mirelle | belonging | a lantern | #1'] }),
        pick(1),
    );
    const ended = apply(
        log,
        storyOrder,
        answer({
            CHANGES: ['F2 | Mirelle | belonging | ENDED: gave it to Kira | #30', 'F1 | Mirelle | belonging | ENDED | #30'],
        }),
        pick(30),
    );
    assert.deepEqual(plain(ended.state.facts.map((fact) => [fact.id, fact.status, fact.ended])), [
        ['F1', 'Ended', { reason: '', cite: 'MESSAGE-30', position: 30 }],
        ['F2', 'Ended', { reason: 'gave it to Kira', cite: 'MESSAGE-30', position: 30 }],
    ]);
    const twice = apply(
        log,
        storyOrder,
        answer({ CHANGES: ['F2 | Mirelle | belonging | ENDED: lost it | #31'] }),
        pick(31),
    );
    assert.deepEqual(plain(twice.result.refused), []);
    assert.deepEqual(plain(twice.state.facts), plain(ended.state.facts));
    const back = apply(log, storyOrder, answer({ FACTS: ['Mirelle | belonging | a lantern | #40'] }), pick(40));
    assert.deepEqual(statuses(back.state), [
        ['F1', 'a silver ring', 'Ended'],
        ['F2', 'a lantern', 'Ended'],
        ['F3', 'a lantern', 'InForce'],
    ]);
    assert.equal(factNumbered(back.state, 'F3').ended, null);
});

test('ending follows a fuller wording', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | eyes | grey | #1'] }), pick(1));
    apply(log, storyOrder, answer({ CHANGES: ['F1 | Halvard | eyes | FULLER: grey as slate | #2'] }), pick(2));
    apply(log, storyOrder, answer({ CHANGES: ['F2 | Halvard | eyes | FULLER: grey as slate in winter | #3'] }), pick(3));
    const ended = apply(
        log,
        storyOrder,
        answer({ CHANGES: ['F1 | Halvard | eyes | ENDED: lost an eye | #4'] }),
        pick(4),
    );
    assert.deepEqual(plain(ended.state.facts.map((fact) => [fact.id, fact.status, fact.replacedBy, fact.ended])), [
        ['F1', 'Replaced', 'F2', null],
        ['F2', 'Replaced', 'F3', null],
        ['F3', 'Ended', null, { reason: 'lost an eye', cite: 'MESSAGE-4', position: 4 }],
    ]);
    const moving = ScribeLog.create();
    apply(
        moving,
        storyOrder,
        answer({
            FACTS: ['Halvard | location | the mill | #1', 'Halvard | location | the inn | #2', 'Halvard | age | twenty | #2'],
        }),
        pick(1, 2),
    );
    apply(moving, storyOrder, answer({ CHANGES: ['F3 | Halvard | age | twenty-one | #3'] }), pick(3));
    const passed = apply(
        moving,
        storyOrder,
        answer({
            CHANGES: ['F1 | Halvard | location | ENDED: it burned | #5', 'F3 | Halvard | age | ENDED: he died | #5'],
        }),
        pick(5),
    );
    assert.deepEqual(plain(passed.result.refused), []);
    assert.deepEqual(statuses(passed.state), [
        ['F1', 'the mill', 'Replaced'],
        ['F2', 'the inn', 'InForce'],
        ['F3', 'twenty', 'Replaced'],
        ['F4', 'twenty-one', 'InForce'],
    ]);
    assert.ok(passed.state.facts.every((fact) => fact.ended === null));
});

test('ending the established value leaves the dispute open', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            FACTS: ['Halvard | hair | black | #1', 'Halvard | hair | brown | #2', 'Halvard | hair | auburn | #3'],
        }),
        pick(1, 2, 3),
    );
    const ended = apply(log, storyOrder, answer({ CHANGES: ['F1 | Halvard | hair | ENDED | #10'] }), pick(10));
    assert.deepEqual(statuses(ended.state), [
        ['F1', 'black', 'Ended'],
        ['F2', 'brown', 'Disputed'],
        ['F3', 'auburn', 'Disputed'],
    ]);
    assert.deepEqual(plain(ended.state.conflicts), [
        { subject: 'S1', category: 'hair', target: null, established: null, others: ['F2', 'F3'] },
    ]);
    const grey = apply(log, storyOrder, answer({ FACTS: ['Halvard | hair | grey | #11'] }), pick(11));
    assert.equal(factSaying(grey.state, 'grey').status, 'InForce');
    assert.deepEqual(plain(grey.state.conflicts), [
        { subject: 'S1', category: 'hair', target: null, established: 'F4', others: ['F2', 'F3'] },
    ]);
    const brown = apply(log, storyOrder, answer({ CHANGES: ['F2 | Halvard | hair | ENDED | #12'] }), pick(12));
    assert.deepEqual(plain(brown.state.conflicts), [
        { subject: 'S1', category: 'hair', target: null, established: 'F4', others: ['F3'] },
    ]);
    const auburn = apply(log, storyOrder, answer({ CHANGES: ['F3 | Halvard | hair | ENDED | #13'] }), pick(13));
    assert.deepEqual(plain(auburn.state.conflicts), []);
    assert.equal(factNumbered(auburn.state, 'F4').status, 'InForce');
    const order = ScribeLog.create();
    apply(
        order,
        storyOrder,
        answer({
            FACTS: [
                'Halvard | hair | black | #1',
                'Halvard | hair | brown | #2',
                'Halvard | age | twenty-five | #3',
                'Halvard | age | thirty | #4',
            ],
        }),
        pick(1, 2, 3, 4),
    );
    const first = ScribeReplay.run(order, storyOrder);
    assert.deepEqual(plain(first.conflicts.map((conflict) => conflict.category)), ['hair', 'age']);
    apply(order, storyOrder, answer({ CHANGES: ['F2 | Halvard | hair | ENDED | #5'] }), pick(5));
    const reopened = apply(order, storyOrder, answer({ FACTS: ['Halvard | hair | red | #6'] }), pick(6));
    assert.deepEqual(plain(reopened.state.conflicts), [
        { subject: 'S1', category: 'age', target: null, established: 'F3', others: ['F4'] },
        { subject: 'S1', category: 'hair', target: null, established: 'F1', others: ['F5'] },
    ]);
});

test('told adds one person', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Halvard | character', 'Kira | character'],
            FACTS: [
                'Halvard | age | forty | #1',
                'Halvard | eyes | grey | #1',
                'Halvard | trait | proud | #1',
                'Halvard | location | the mill | #1',
                'Halvard | location | the inn | #2',
            ],
        }),
        pick(1, 2),
    );
    const once = apply(
        log,
        storyOrder,
        answer({ TOLD: ['F3 | Halvard | Kira | #90', 'F3 | Halvard | Kira | #90'] }),
        pick(90),
    );
    const kira = subjectLabelled(once.state, 'Kira');
    assert.equal(once.result.entry.operations.length, 2);
    assert.deepEqual(plain(factNumbered(once.state, 'F3').told), [kira.id]);
    const repeated = apply(log, storyOrder, answer({ TOLD: ['F3 | Halvard | Kira | #91'] }), pick(91));
    assert.deepEqual(plain(factNumbered(repeated.state, 'F3').told), [kira.id]);
    apply(log, storyOrder, answer({ CHANGES: ['F2 | Halvard | eyes | FULLER: grey as slate | #3'] }), pick(3));
    const refined = apply(
        log,
        storyOrder,
        answer({ TOLD: ['F2 | Halvard | Kira | #92', 'F4 | Halvard | Kira | #92'] }),
        pick(92),
    );
    assert.equal(factNumbered(refined.state, 'F2').status, 'Replaced');
    assert.deepEqual(plain(factNumbered(refined.state, 'F2').told), [kira.id]);
    assert.deepEqual(plain(factSaying(refined.state, 'grey as slate').told), []);
    assert.equal(factNumbered(refined.state, 'F4').status, 'Replaced');
    assert.deepEqual(plain(factNumbered(refined.state, 'F4').told), [kira.id]);
    apply(log, storyOrder, answer({ FACTS: ['Halvard | hair | dark | #4'] }), pick(4));
    const toldHair = apply(log, storyOrder, answer({ TOLD: ['F7 | Halvard | Kira | #93'] }), pick(93));
    assert.deepEqual(plain(factNumbered(toldHair.state, 'F7').told), [kira.id]);
    log.entries.at(-2).withdrawn = true;
    const withdrawn = ScribeReplay.run(log, storyOrder);
    assert.equal(withdrawn.facts.some((fact) => fact.id === 'F7'), false);
    assert.deepEqual(
        plain(withdrawn.facts.filter((fact) => fact.told.length > 0).map((fact) => fact.id)),
        ['F2', 'F3', 'F4'],
    );
});

test('conditions expire at the next night', () => {
    const log = ScribeLog.create();
    const { state } = apply(
        log,
        storyOrder,
        answer({
            FACTS: ['Halvard | condition | bruised ribs | #78', 'Halvard | condition | a fever | #84'],
            NIGHTS: ['#80 | they sleep at the inn'],
        }),
        stretch(78, 84),
    );
    assert.equal(factSaying(state, 'bruised ribs').status, 'Expired');
    assert.equal(factSaying(state, 'a fever').status, 'InForce');
    assert.deepEqual(plain(state.nights), [{ cite: 'MESSAGE-80', position: 80, marker: 'they sleep at the inn' }]);
    const reversed = ScribeLog.create();
    apply(reversed, storyOrder, answer({ NIGHTS: ['#80 | they sleep at the inn'] }), pick(80));
    apply(reversed, storyOrder, answer({ FACTS: ['Halvard | condition | a fever | #84'] }), pick(84));
    const late = apply(
        reversed,
        storyOrder,
        answer({ FACTS: ['Halvard | condition | bruised ribs | #78'] }),
        pick(78),
    );
    assert.equal(factSaying(late.state, 'bruised ribs').status, 'Expired');
    assert.equal(factSaying(late.state, 'a fever').status, 'InForce');
    const other = ScribeLog.create();
    const kept = apply(
        other,
        storyOrder,
        answer({
            FACTS: ['Halvard | trait | proud | #70', 'Halvard | age | forty | #70', 'Halvard | condition | weary | #70'],
            NIGHTS: ['#80 | they sleep at the inn'],
        }),
        pick(70, 80),
    );
    assert.deepEqual(statuses(kept.state), [
        ['F1', 'proud', 'InForce'],
        ['F2', 'forty', 'InForce'],
        ['F3', 'weary', 'Expired'],
    ]);
    const anew = apply(other, storyOrder, answer({ FACTS: ['Halvard | condition | weary | #85'] }), pick(85));
    assert.equal(factNumbered(anew.state, 'F4').status, 'InForce');
});

test("a condition on the night's own message survives it", () => {
    const log = ScribeLog.create();
    const same = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | condition | a fever | #80'], NIGHTS: ['#80 | they sleep at the inn'] }),
        pick(80),
    );
    assert.equal(factSaying(same.state, 'a fever').status, 'InForce');
    const later = apply(log, storyOrder, answer({ NIGHTS: ['#90 | they sleep again'] }), pick(90));
    assert.equal(factSaying(later.state, 'a fever').status, 'Expired');
});

test("a night on a notes condition's own message", () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | condition | a fever | #80'] }), pick(80), 'Notes');
    const night = apply(log, storyOrder, answer({ NIGHTS: ['#80 | they sleep at the inn'] }), pick(80));
    assert.equal(factSaying(night.state, 'a fever').status, 'InForce');
    assert.equal(factSaying(night.state, 'a fever').origin, 'Notes');
    const reversed = ScribeLog.create();
    apply(reversed, storyOrder, answer({ NIGHTS: ['#80 | they sleep at the inn'] }), pick(80));
    const notes = apply(
        reversed,
        storyOrder,
        answer({ FACTS: ['Halvard | condition | a fever | #80'] }),
        pick(80),
        'Notes',
    );
    assert.equal(factSaying(notes.state, 'a fever').status, 'InForce');
    const later = apply(reversed, storyOrder, answer({ NIGHTS: ['#81 | they sleep again'] }), pick(81));
    assert.equal(factSaying(later.state, 'a fever').status, 'Expired');
});

test('nights are listed once in story order', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ NIGHTS: ['#80 | they sleep at the inn', '#80 | they sleep again'] }),
        pick(80),
    );
    apply(log, storyOrder, answer({ NIGHTS: ['#40 | they camp by the road'] }), pick(40));
    const notes = apply(log, storyOrder, answer({ NIGHTS: ['#80 | a third telling'] }), pick(80), 'Notes');
    assert.deepEqual(plain(notes.state.nights), [
        { cite: 'MESSAGE-40', position: 40, marker: 'they camp by the road' },
        { cite: 'MESSAGE-80', position: 80, marker: 'they sleep at the inn' },
    ]);
    apply(log, storyOrder, answer({ FACTS: ['Halvard | condition | weary | #85'] }), pick(85));
    const expired = apply(log, storyOrder, answer({ NIGHTS: ['#90 | they rest'] }), pick(90));
    assert.equal(factSaying(expired.state, 'weary').status, 'Expired');
    assert.equal(expired.state.nights.length, 3);
    log.entries.at(-1).withdrawn = true;
    const state = ScribeReplay.run(log, storyOrder);
    assert.deepEqual(plain(state.nights.map((night) => night.position)), [40, 80]);
    assert.equal(factSaying(state, 'weary').status, 'InForce');
});

test('direct scene appends distinguish empty Story sources from notes, answers and legacy positions', () => {
    const messages = pick(1, 2, 3);
    messages[1] = { ...messages[1], text: '' };
    const text = answer({ SCENES: ['Day 1 | #1-#3 | The mill | public | present: Halvard (from #2) | A visit'] });
    const denied = apply(ScribeLog.create(), storyOrder, text, messages);
    assert.deepEqual(plain(denied.result.refused.map((item) => item.reason)), ['Citation']);
    assert.deepEqual(plain(denied.state.subjects), []);
    assert.deepEqual(plain(denied.state.scenes), []);
    for (const origin of ['Notes', 'Answers']) {
        const accepted = apply(ScribeLog.create(), storyOrder, text, messages, origin);
        assert.deepEqual(plain(accepted.result.refused), []);
        assert.equal(accepted.state.scenes[0].present[0].from, 2);
    }
    const legacy = messages.map(({ id, position }) => ({ id, position }));
    const accepted = apply(ScribeLog.create(), storyOrder, text, legacy);
    assert.deepEqual(plain(accepted.result.refused), []);
    assert.equal(accepted.state.scenes[0].present[0].from, 2);
});

test('a scene continues across stretches', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Tamsin | character'],
            SCENES: ['Day 1 | #1-#40 | The mill | public | present: Halvard, Mirelle | They talk'],
        }),
        stretch(1, 40),
    );
    assert.equal(first.state.scenes.length, 1);
    const second = apply(
        log,
        storyOrder,
        answer({
            SCENES: [
                'Day 1 | #1-#52 | The mill | public | present: Halvard, Mirelle, Tamsin (from #45) | They talk on',
            ],
        }),
        stretch(41, 80),
    );
    assert.deepEqual(plain(second.result.refused), []);
    assert.equal(second.result.entry.operations[0].first, 'MESSAGE-1');
    assert.equal(second.result.entry.operations[0].last, 'MESSAGE-52');
    const halvard = subjectLabelled(second.state, 'Halvard');
    const mirelle = subjectLabelled(second.state, 'Mirelle');
    const tamsin = subjectLabelled(second.state, 'Tamsin');
    const continued = {
        id: 'MESSAGE-1',
        day: 1,
        first: 'MESSAGE-1',
        last: 'MESSAGE-52',
        firstPosition: 1,
        lastPosition: 52,
        place: 'The mill',
        reach: 'Public',
        narrowed: false,
        present: [
            { subject: halvard.id, from: null, until: null },
            { subject: mirelle.id, from: null, until: null },
            { subject: tamsin.id, from: 45, until: null },
        ],
        summary: 'They talk on',
    };
    assert.deepEqual(plain(second.state.scenes), [continued]);
    const notes = apply(
        log,
        storyOrder,
        answer({ SCENES: ['Day 1 | #1-#45 | The mill | public | present: Halvard | They begin'] }),
        stretch(41, 45),
        'Notes',
    );
    assert.deepEqual(plain(notes.result.refused), []);
    assert.deepEqual(plain(notes.state.scenes), [
        {
            ...continued,
            present: [
                { subject: halvard.id, from: null, until: null },
                { subject: mirelle.id, from: null, until: 40 },
                { subject: mirelle.id, from: 46, until: null },
                { subject: tamsin.id, from: 46, until: null },
            ],
        },
    ]);
});

test('a scene continues the scene still running', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SCENES: [
                'Day 1 | #1-#40 | The mill | public | present: Halvard | They talk',
                'Day 1 | #35-#38 | The loft | private | present: Mirelle | She hides',
            ],
        }),
        stretch(1, 40),
    );
    const { state, result, parsed } = apply(
        log,
        storyOrder,
        answer({
            SCENES: [
                'Day 1 | #1-#50 | The mill | public | present: Halvard | They talk on',
                'Day 1 | #35-#50 | The loft | private | present: Mirelle | She hides on',
                'Day 1 | #12-#52 | The mill | public | present: Halvard | They talk on',
            ],
        }),
        stretch(41, 80),
    );
    assert.deepEqual(reasons(result), ['Citation', 'Citation']);
    assert.deepEqual(
        plain(result.refused.map((item) => parsed.operations.indexOf(item.operation))),
        [1, 2],
    );
    assert.deepEqual(plain(state.scenes.map((scene) => [scene.first, scene.last])), [
        ['MESSAGE-1', 'MESSAGE-50'],
        ['MESSAGE-35', 'MESSAGE-38'],
    ]);
    const two = ScribeLog.create();
    apply(
        two,
        storyOrder,
        answer({
            SCENES: [
                'Day 1 | #1-#20 | The yard | public | present: Halvard | They train',
                'Day 1 | #21-#40 | The mill | public | present: Halvard | They talk',
            ],
        }),
        stretch(1, 40),
    );
    const back = apply(
        two,
        storyOrder,
        answer({
            SCENES: [
                'Day 1 | #1-#52 | The yard | public | present: Halvard | They train on',
                'Day 1 | #21-#52 | The mill | public | present: Halvard | They talk on',
                'Day 1 | #30-#35 | The mill | public | present: Halvard | They argue',
            ],
        }),
        stretch(41, 80),
    );
    assert.deepEqual(reasons(back.result), ['Citation', 'Citation']);
    assert.deepEqual(
        plain(back.result.refused.map((item) => back.parsed.operations.indexOf(item.operation))),
        [0, 2],
    );
    assert.deepEqual(plain(back.state.scenes.map((scene) => [scene.first, scene.last])), [
        ['MESSAGE-1', 'MESSAGE-20'],
        ['MESSAGE-21', 'MESSAGE-52'],
    ]);
    const tied = ScribeLog.create();
    apply(
        tied,
        storyOrder,
        answer({
            SCENES: [
                'Day 1 | #1-#40 | The yard | public | present: Halvard | They train',
                'Day 1 | #20-#40 | The mill | public | present: Mirelle | She waits',
            ],
        }),
        stretch(1, 40),
    );
    const latest = apply(
        tied,
        storyOrder,
        answer({
            SCENES: [
                'Day 1 | #1-#45 | The yard | public | present: Halvard | They train on',
                'Day 1 | #20-#45 | The mill | public | present: Mirelle | She waits on',
            ],
        }),
        stretch(41, 80),
    );
    assert.deepEqual(reasons(latest.result), ['Citation']);
    assert.equal(latest.result.refused[0].operation, latest.parsed.operations[0]);
});

test('two scenes cannot start on one message', () => {
    const log = ScribeLog.create();
    const { state, result, parsed } = apply(
        log,
        storyOrder,
        answer({
            SCENES: [
                'Day 2 | #41-#50 | The road | public | present: Halvard | They ride',
                'Day 2 | #41-#45 | The inn | public | present: Mirelle | She waits',
            ],
        }),
        stretch(41, 80),
    );
    assert.deepEqual(reasons(result), ['Citation']);
    assert.equal(result.refused[0].operation, parsed.operations[1]);
    assert.deepEqual(plain(state.scenes.map((scene) => [scene.first, scene.last, scene.place])), [
        ['MESSAGE-41', 'MESSAGE-50', 'The road'],
    ]);
    const back = ScribeLog.create();
    apply(
        back,
        storyOrder,
        answer({ SCENES: ['Day 1 | #1-#40 | The mill | public | present: Halvard | They talk'] }),
        stretch(1, 40),
    );
    const twice = apply(
        back,
        storyOrder,
        answer({
            SCENES: [
                'Day 1 | #1-#50 | The mill | public | present: Halvard | They talk on',
                'Day 1 | #1-#60 | The mill | public | present: Halvard | They talk longer',
            ],
        }),
        stretch(41, 80),
    );
    assert.deepEqual(reasons(twice.result), ['Citation']);
    assert.equal(twice.result.refused[0].operation, twice.parsed.operations[1]);
    assert.equal(twice.state.scenes[0].lastPosition, 50);
    const refused = ScribeLog.create();
    apply(refused, storyOrder, answer({ SUBJECTS: ['Halvard | character'] }), pick(1));
    const kept = apply(
        refused,
        storyOrder,
        answer({
            SUBJECTS: ['Halvard | place'],
            SCENES: [
                'Day 2 | #41-#50 | The road | public | present: Halvard | They ride',
                'Day 2 | #41-#45 | The inn | public | present: Mirelle | She waits',
            ],
        }),
        stretch(41, 80),
    );
    assert.deepEqual(reasons(kept.result), ['Mismatch', 'Mismatch']);
    assert.deepEqual(plain(kept.state.scenes.map((scene) => [scene.first, scene.place])), [['MESSAGE-41', 'The inn']]);
});

test('a continued scene keeps those who were there', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Isolde | character', 'Tamsin | character'],
            SCENES: ['Day 1 | #1-#40 | The mill | public | present: Halvard, Mirelle (until #30), Isolde | They talk'],
        }),
        stretch(1, 40),
    );
    const echoed = plain(log);
    const second = apply(
        log,
        storyOrder,
        answer({ SCENES: ['Day 1 | #1-#52 | The mill | public | present: Halvard, Tamsin (from #45) | They talk on'] }),
        stretch(41, 80),
    );
    const halvard = subjectLabelled(second.state, 'Halvard');
    const mirelle = subjectLabelled(second.state, 'Mirelle');
    const isolde = subjectLabelled(second.state, 'Isolde');
    const tamsin = subjectLabelled(second.state, 'Tamsin');
    const continued = [
        { subject: halvard.id, from: null, until: null },
        { subject: mirelle.id, from: null, until: 30 },
        { subject: isolde.id, from: null, until: 40 },
        { subject: tamsin.id, from: 45, until: null },
    ];
    assert.deepEqual(plain(second.state.scenes[0].present), continued);
    const echo = apply(
        echoed,
        storyOrder,
        answer({
            SCENES: [
                'Day 1 | #1-#52 | The mill | public | present: Halvard, Mirelle (until #30), Tamsin (from #45) | They talk on',
            ],
        }),
        stretch(41, 80),
    );
    assert.deepEqual(plain(echo.result.refused), []);
    assert.deepEqual(plain(echo.state.scenes[0].present), continued);
    const third = apply(
        log,
        storyOrder,
        answer({ SCENES: ['Day 1 | #1-#90 | The mill | public | present: Halvard (until #60) | They part'] }),
        stretch(81, 100),
    );
    assert.deepEqual(plain(third.state.scenes[0].present), [
        { subject: halvard.id, from: null, until: 60 },
        { subject: mirelle.id, from: null, until: 30 },
        { subject: isolde.id, from: null, until: 40 },
        { subject: tamsin.id, from: 45, until: 52 },
    ]);
    assert.equal(third.state.scenes[0].lastPosition, 90);
    const beyond = ScribeLog.create();
    apply(
        beyond,
        storyOrder,
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character'],
            SCENES: ['Day 1 | #1-#40 | The mill | public | present: Halvard, Mirelle (until #60) | They talk'],
        }),
        stretch(1, 40),
    );
    const cut = apply(
        beyond,
        storyOrder,
        answer({ SCENES: ['Day 1 | #1-#80 | The mill | public | present: Halvard | They talk on'] }),
        stretch(41, 80),
    );
    assert.deepEqual(plain(cut.state.scenes[0].present), [
        { subject: 'S1', from: null, until: null },
        { subject: 'S2', from: null, until: 40 },
    ]);
});

test('a continued scene keeps its earlier part as it was', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            FACTS: ['Halvard | trait | sign 10 | #10'],
            SCENES: [
                'Day 1 | #1-#40 | The cellar | private | present: Halvard, Aldric, Isolde (from #30) | They whisper',
            ],
        }),
        stretch(1, 40),
    );
    const { state } = apply(
        log,
        storyOrder,
        answer({
            SCENES: ['Day 1 | #1-#80 | The cellar | private | present: Halvard, Aldric, Isolde | They whisper on'],
        }),
        stretch(41, 80),
    );
    const halvard = subjectLabelled(state, 'Halvard').id;
    const aldric = subjectLabelled(state, 'Aldric').id;
    const isolde = subjectLabelled(state, 'Isolde').id;
    assert.equal(state.scenes.length, 1);
    assert.equal(state.scenes[0].lastPosition, 80);
    assert.deepEqual(plain(state.scenes[0].present), [
        { subject: halvard, from: null, until: null },
        { subject: aldric, from: null, until: null },
        { subject: isolde, from: 30, until: null },
    ]);
    const early = factSaying(state, 'sign 10');
    assert.equal(ScribeKnowledge.knows(state, isolde, early), false);
    assert.equal(ScribeKnowledge.knows(state, aldric, early), true);
    const unbroken = [
        { subject: halvard, from: null, until: null },
        { subject: aldric, from: null, until: null },
        { subject: isolde, from: 30, until: null },
    ];
    const notes = apply(
        log,
        storyOrder,
        answer({ SCENES: ['Day 1 | #1-#80 | The cellar | private | present: Brandt | They whisper still'] }),
        stretch(41, 80),
        'Notes',
    );
    assert.deepEqual(plain(notes.result.refused), []);
    assert.deepEqual(plain(notes.state.scenes[0].present), unbroken);
    assert.equal(notes.state.scenes[0].summary, 'They whisper still');
    const bounded = ScribeLog.create();
    apply(
        bounded,
        storyOrder,
        answer({
            SCENES: [
                'Day 1 | #1-#40 | The cellar | private | present: Halvard (from #1), Aldric, Isolde (from #30) | They whisper',
            ],
        }),
        stretch(1, 40),
    );
    const written = apply(
        bounded,
        storyOrder,
        answer({
            SCENES: [
                'Day 1 | #1-#80 | The cellar | private | present: Halvard, Aldric (until #80), Isolde | They whisper on',
            ],
        }),
        stretch(41, 80),
    );
    assert.deepEqual(plain(written.state.scenes[0].present), unbroken);
});

test('a person who steps out and returns', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            FACTS: ['Halvard | trait | sign 10 | #10'],
            SCENES: ['Day 1 | #1-#40 | The cellar | private | present: Halvard, Isolde | They whisper'],
        }),
        stretch(1, 40),
    );
    const { state } = apply(
        log,
        storyOrder,
        answer({
            FACTS: ['Halvard | trait | sign 45 | #45', 'Halvard | trait | sign 60 | #60'],
            SCENES: ['Day 1 | #1-#80 | The cellar | private | present: Halvard, Isolde (from #50) | They whisper on'],
        }),
        stretch(41, 80),
    );
    const halvard = subjectLabelled(state, 'Halvard').id;
    const isolde = subjectLabelled(state, 'Isolde').id;
    assert.deepEqual(plain(state.scenes[0].present), [
        { subject: halvard, from: null, until: null },
        { subject: isolde, from: null, until: 40 },
        { subject: isolde, from: 50, until: null },
    ]);
    assert.deepEqual(
        ['sign 10', 'sign 45', 'sign 60'].map((text) => ScribeKnowledge.knows(state, isolde, factSaying(state, text))),
        [true, false, true],
    );
});

test('a scene once private stays private', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            FACTS: ['Halvard | trait | sign 10 | #10'],
            SCENES: ['Day 1 | #1-#40 | The cellar | private | present: Halvard, Isolde | They whisper'],
        }),
        stretch(1, 40),
    );
    const opened = apply(
        log,
        storyOrder,
        answer({
            SCENES: [
                'Day 1 | #1-#80 | The cellar | public | present: Halvard, Isolde, Brandt (from #50) | They open the doors',
            ],
        }),
        stretch(41, 80),
    );
    const isolde = subjectLabelled(opened.state, 'Isolde').id;
    const brandt = subjectLabelled(opened.state, 'Brandt').id;
    const scene = opened.state.scenes[0];
    assert.deepEqual(plain([scene.reach, scene.lastPosition, scene.summary]), ['Private', 80, 'They open the doors']);
    const early = factSaying(opened.state, 'sign 10');
    assert.equal(ScribeKnowledge.knows(opened.state, brandt, early), false);
    assert.equal(ScribeKnowledge.knows(opened.state, isolde, early), true);
    /**
     * @param {string} before
     * @param {string} after
     * @return {string}
     */
    const reachOf = (before, after) => {
        const other = ScribeLog.create();
        apply(
            other,
            storyOrder,
            answer({ SCENES: [`Day 1 | #1-#40 | The hall | ${before} | present: Halvard | They feast`] }),
            stretch(1, 40),
        );
        const continued = apply(
            other,
            storyOrder,
            answer({ SCENES: [`Day 1 | #1-#80 | The hall | ${after} | present: Halvard | They feast on`] }),
            stretch(41, 80),
        );
        return continued.state.scenes[0].reach;
    };
    assert.deepEqual(
        [reachOf('public', 'private'), reachOf('public', 'public'), reachOf('private', 'private')],
        ['Private', 'Public', 'Private'],
    );
});

test('a scene that ends outside the stretch is refused', () => {
    const log = ScribeLog.create();
    const { state, result } = apply(
        log,
        storyOrder,
        answer({
            SCENES: [
                'Day 2 | #41-#99 | The road | public | present: Halvard | They ride',
                'Day 2 | #41-#80 | The road | public | present: Halvard | They ride',
            ],
        }),
        stretch(41, 80),
    );
    assert.deepEqual(reasons(result), ['Citation']);
    assert.equal(result.refused[0].operation.last, 99);
    assert.deepEqual(plain(state.scenes.map((scene) => [scene.first, scene.last])), [['MESSAGE-41', 'MESSAGE-80']]);
});

test('scenes are kept in story order', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ SCENES: ['Day 3 | #50-#60 | The hall | public | present: Halvard | They feast'] }),
        stretch(50, 60),
    );
    apply(
        log,
        storyOrder,
        answer({
            SCENES: [
                'Day 1 | #20-#30 | The yard | public | present: Halvard | They train',
                'Day 1 | #12-#45 | The mill | public | present: Mirelle | She waits',
            ],
        }),
        stretch(10, 48),
    );
    const whole = ScribeReplay.run(log, storyOrder);
    assert.deepEqual(plain(whole.scenes.map((scene) => [scene.id, scene.firstPosition, scene.lastPosition])), [
        ['MESSAGE-12', 12, 45],
        ['MESSAGE-20', 20, 30],
        ['MESSAGE-50', 50, 60],
    ]);
    const noFirst = ScribeReplay.run(
        log,
        storyOrder.filter((id) => id !== 'MESSAGE-12'),
    );
    assert.deepEqual(plain(noFirst.scenes.map((scene) => [scene.id, scene.firstPosition, scene.lastPosition])), [
        ['MESSAGE-12', 12, 45],
        ['MESSAGE-20', 19, 29],
        ['MESSAGE-50', 49, 59],
    ]);
    const noLast = ScribeReplay.run(
        log,
        storyOrder.filter((id) => id !== 'MESSAGE-60'),
    );
    assert.deepEqual(plain(noLast.scenes.map((scene) => [scene.id, scene.firstPosition, scene.lastPosition])), [
        ['MESSAGE-12', 12, 45],
        ['MESSAGE-20', 20, 30],
        ['MESSAGE-50', 50, 60],
    ]);
    log.entries[0].withdrawn = true;
    const withdrawn = ScribeReplay.run(log, storyOrder);
    assert.deepEqual(plain(withdrawn.scenes.map((scene) => scene.id)), ['MESSAGE-12', 'MESSAGE-20']);
});

test('a scene whose first message is gone is kept', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Halvard | character', 'Isolde | character', 'Aldric | character', 'Brandt | character'],
            FACTS: ['Halvard | trait | sign 22 | #22'],
            SCENES: [
                'Day 1 | #1-#40 | The hall | public | present: Halvard, Isolde, Aldric, Brandt | They feast',
                'Day 1 | #20-#25 | The alcove | private | present: Halvard, Isolde | They whisper',
            ],
        }),
        stretch(1, 40),
    );
    const order = storyOrder.filter((id) => id !== 'MESSAGE-20');
    const gone = ScribeReplay.run(log, order);
    const halvard = subjectLabelled(gone, 'Halvard').id;
    const isolde = subjectLabelled(gone, 'Isolde').id;
    assert.deepEqual(
        plain(
            gone.scenes.map((scene) => [scene.place, scene.id, scene.first, scene.firstPosition, scene.lastPosition]),
        ),
        [
            ['The hall', 'MESSAGE-1', 'MESSAGE-1', 1, 39],
            ['The alcove', 'MESSAGE-20', 'MESSAGE-20', 20, 25],
        ],
    );
    const alcove = gone.scenes[1];
    assert.deepEqual(plain([alcove.reach, alcove.present]), [
        'Private',
        [
            { subject: halvard, from: null, until: null },
            { subject: isolde, from: null, until: null },
        ],
    ]);
    const inside = factSaying(gone, 'sign 22');
    assert.equal(inside.position, 21);
    const covering = gone.scenes.filter(
        (scene) => scene.firstPosition <= inside.position && inside.position <= scene.lastPosition,
    );
    assert.deepEqual(plain(covering.map((scene) => scene.place)), ['The hall', 'The alcove']);
    const bothGone = storyOrder.filter((id) => id !== 'MESSAGE-20' && id !== 'MESSAGE-25');
    const neither = ScribeReplay.run(log, bothGone);
    assert.deepEqual(
        plain(
            neither.scenes.map((scene) => [scene.place, scene.first, scene.last, scene.firstPosition, scene.lastPosition]),
        ),
        [
            ['The hall', 'MESSAGE-1', 'MESSAGE-40', 1, 38],
            ['The alcove', 'MESSAGE-20', 'MESSAGE-25', 20, 25],
        ],
    );
    assert.equal(neither.scenes[1].reach, 'Private');
    ScribeLog.withdraw(log, 'MESSAGE-1');
    assert.deepEqual(plain(ScribeReplay.run(log, bothGone).scenes), []);
    assert.deepEqual(plain(ScribeReplay.run(log, order).scenes), []);
});

test('a scene with one missing end keeps a forward range', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ SCENES: ['Day 1 | #20-#30 | The alcove | private | present: Isolde | She hides'] }),
        stretch(20, 30),
    );
    /**
     * @param {string[]} missing
     * @return {number[]}
     */
    const range = (missing) => {
        const [scene] = ScribeReplay.run(
            log,
            storyOrder.filter((id) => !missing.includes(id)),
        ).scenes;
        assert.ok(scene.firstPosition <= scene.lastPosition, missing.join(' '));
        return [scene.firstPosition, scene.lastPosition];
    };
    const earlier = ['MESSAGE-5', 'MESSAGE-6', 'MESSAGE-7', 'MESSAGE-8', 'MESSAGE-9'];
    assert.deepEqual(range([...earlier, 'MESSAGE-20']), [20, 30]);
    const many = Array.from({ length: 14 }, (unused, index) => `MESSAGE-${index + 2}`);
    assert.deepEqual(range([...many, 'MESSAGE-20']), [20, 30]);
    assert.deepEqual(range([...earlier, 'MESSAGE-30']), [20, 30]);
    assert.deepEqual(range(earlier), [15, 25]);
});

test('scene operations keep their written numbers', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SCENES: [
                'Day 1 | #1-#40 | The hall | public | present: Halvard | They feast',
                'Day 1 | #20-#25 | The alcove | private | present: Isolde | She hides',
            ],
        }),
        stretch(1, 40),
    );
    apply(
        log,
        storyOrder,
        answer({ SCENES: ['Day 1 | #1-#52 | The hall | public | present: Halvard | They feast on'] }),
        stretch(41, 80),
    );
    const stored = log.entries
        .flatMap((entry) => entry.operations)
        .filter((operation) => operation.type === 'Scene');
    assert.deepEqual(
        plain(
            stored.map((operation) => [operation.first, operation.last, operation.firstPosition, operation.lastPosition]),
        ),
        [
            ['MESSAGE-1', 'MESSAGE-40', 1, 40],
            ['MESSAGE-20', 'MESSAGE-25', 20, 25],
            ['MESSAGE-1', 'MESSAGE-52', 1, 52],
        ],
    );
    const legacy = plain(log);
    for (const entry of legacy.entries) {
        for (const operation of entry.operations.filter((item) => item.type === 'Scene')) {
            delete operation.firstPosition;
            delete operation.lastPosition;
        }
    }
    assert.deepEqual(ScribeReplay.run(legacy, storyOrder), ScribeReplay.run(log, storyOrder));
    const order = storyOrder.filter((id) => id !== 'MESSAGE-20');
    assert.deepEqual(plain(ScribeReplay.run(log, order).scenes.map((scene) => scene.place)), [
        'The hall',
        'The alcove',
    ]);
    const old = ScribeReplay.run(legacy, order);
    assert.deepEqual(plain(old.scenes.map((scene) => [scene.place, scene.firstPosition, scene.lastPosition])), [
        ['The hall', 1, 51],
    ]);
});

test('attendance bounds are kept', () => {
    const log = ScribeLog.create();
    const { state } = apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Aldric | character'],
            SCENES: ['Day 3 | #50-#55 | The hall | public | present: Aldric (from #51), Isolde (until #53) | They feast'],
        }),
        stretch(50, 60),
    );
    const aldric = subjectLabelled(state, 'Aldric');
    const isolde = subjectLabelled(state, 'Isolde');
    assert.deepEqual(plain(state.scenes[0].present), [
        { subject: aldric.id, from: 51, until: null },
        { subject: isolde.id, from: null, until: 53 },
    ]);
});

test('a relation that ends stops being stale and marks the other side', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ SUBJECTS: ['Halvard | character', 'Tamsin | character'] }), pick(1));
    apply(log, storyOrder, answer({ FACTS: ['Halvard | relation to Tamsin | trusts her | #5'] }), pick(5));
    const reply = apply(log, storyOrder, answer({ FACTS: ['Tamsin | relation to Halvard | resents him | #20'] }), pick(20));
    assert.deepEqual(plain(reply.state.stale), [{ subject: 'S1', target: 'S2' }]);
    const ended = apply(
        log,
        storyOrder,
        answer({ CHANGES: ['F1 | Halvard | relation to Tamsin | ENDED: they parted | #30'] }),
        pick(30),
    );
    assert.equal(factNumbered(ended.state, 'F1').status, 'Ended');
    assert.deepEqual(plain(ended.state.stale), []);
    const anew = apply(log, storyOrder, answer({ FACTS: ['Halvard | relation to Tamsin | misses her | #40'] }), pick(40));
    assert.deepEqual(plain(anew.state.stale), [{ subject: 'S2', target: 'S1' }]);
    const other = ScribeLog.create();
    apply(other, storyOrder, answer({ SUBJECTS: ['Halvard | character', 'Tamsin | character'] }), pick(1));
    apply(other, storyOrder, answer({ FACTS: ['Halvard | relation to Tamsin | trusts her | #5'] }), pick(5));
    const marked = apply(other, storyOrder, answer({ FACTS: ['Tamsin | relation to Halvard | owes him | #10'] }), pick(10));
    assert.deepEqual(plain(marked.state.stale), [{ subject: 'S1', target: 'S2' }]);
    const restated = apply(
        other,
        storyOrder,
        answer({ FACTS: ['Halvard | relation to Tamsin | trusts her still | #15'] }),
        pick(15),
    );
    assert.deepEqual(plain(restated.state.stale), []);
    const gone = apply(
        other,
        storyOrder,
        answer({ CHANGES: ['F2 | Tamsin | relation to Halvard | ENDED: paid him back | #30'] }),
        pick(30),
    );
    assert.deepEqual(plain(gone.state.stale), [{ subject: 'S1', target: 'S2' }]);
});

test('a changed relation counts as set', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ SUBJECTS: ['Halvard | character', 'Tamsin | character'] }), pick(1));
    apply(log, storyOrder, answer({ FACTS: ['Halvard | relation to Tamsin | trusts her | #5'] }), pick(5));
    apply(log, storyOrder, answer({ FACTS: ['Tamsin | relation to Halvard | owes him | #8'] }), pick(8));
    const restated = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | relation to Tamsin | trusts her still | #10'] }),
        pick(10),
    );
    assert.deepEqual(plain(restated.state.stale), []);
    const theirs = apply(
        log,
        storyOrder,
        answer({ CHANGES: ['F2 | Tamsin | relation to Halvard | resents him | #20'] }),
        pick(20),
    );
    assert.equal(factSaying(theirs.state, 'resents him').status, 'InForce');
    assert.deepEqual(plain(theirs.state.stale), [{ subject: 'S1', target: 'S2' }]);
    const his = apply(
        log,
        storyOrder,
        answer({ CHANGES: ['F3 | Halvard | relation to Tamsin | wary of her | #25'] }),
        pick(25),
    );
    assert.equal(factSaying(his.state, 'wary of her').status, 'InForce');
    assert.deepEqual(plain(his.state.stale), []);
});

test('an ended fixed value can be stated again', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | build | slight | #1'] }), pick(1));
    apply(log, storyOrder, answer({ CHANGES: ['F1 | Halvard | build | ENDED: grew strong | #30'] }), pick(30));
    const { state } = apply(log, storyOrder, answer({ FACTS: ['Halvard | build | slight | #40'] }), pick(40));
    assert.deepEqual(statuses(state), [
        ['F1', 'slight', 'Ended'],
        ['F2', 'slight', 'InForce'],
    ]);
    const chain = ScribeLog.create();
    apply(chain, storyOrder, answer({ FACTS: ['Halvard | eyes | grey | #1'] }), pick(1));
    apply(chain, storyOrder, answer({ CHANGES: ['F1 | Halvard | eyes | FULLER: grey as slate | #2'] }), pick(2));
    apply(chain, storyOrder, answer({ CHANGES: ['F1 | Halvard | eyes | ENDED: lost an eye | #3'] }), pick(3));
    const again = apply(
        chain,
        storyOrder,
        answer({ FACTS: ['Halvard | eyes | grey | #4', 'Halvard | eyes | grey as slate | #4'] }),
        pick(4),
    );
    assert.deepEqual(statuses(again.state), [
        ['F1', 'grey', 'Replaced'],
        ['F2', 'grey as slate', 'Ended'],
        ['F3', 'grey', 'InForce'],
        ['F4', 'grey as slate', 'Disputed'],
    ]);
    const settled = ScribeLog.create();
    apply(
        settled,
        storyOrder,
        answer({ FACTS: ['Halvard | eyes | grey | #1', 'Halvard | eyes | grey as slate | #2'] }),
        pick(1, 2),
    );
    apply(settled, storyOrder, answer({ CHANGES: ['F1 | Halvard | eyes | FULLER: grey as slate | #3'] }), pick(3));
    apply(settled, storyOrder, answer({ CHANGES: ['F3 | Halvard | eyes | ENDED | #4'] }), pick(4));
    const slate = apply(settled, storyOrder, answer({ FACTS: ['Halvard | eyes | grey as slate | #5'] }), pick(5));
    assert.deepEqual(statuses(slate.state), [
        ['F1', 'grey', 'Replaced'],
        ['F2', 'grey as slate', 'Replaced'],
        ['F3', 'grey as slate', 'Ended'],
        ['F4', 'grey as slate', 'InForce'],
    ]);
});

test('the state is frozen and the log survives JSON', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Halvard | character', 'Tamsin | character'],
            FACTS: [
                'Halvard | age | twenty | #1',
                'Halvard | eyes | grey | #1',
                'Halvard | condition | bruised ribs | #2',
                'Halvard | relation to Tamsin | trusts her | #2',
                'Tamsin | belonging | a lantern | #3',
            ],
            SCENES: ['Day 1 | #1-#40 | The mill | public | present: Halvard, Tamsin (from #2) | They talk'],
            NIGHTS: ['#20 | they sleep at the inn'],
        }),
        stretch(1, 40),
    );
    const { state, result } = apply(
        log,
        storyOrder,
        answer({
            CHANGES: [
                'F1 | Halvard | age | twenty-one | #45',
                'F2 | Halvard | eyes | FULLER: grey as slate | #45',
                'F5 | Tamsin | belonging | ENDED: gave it away | #46',
            ],
            TOLD: ['F2 | Halvard | Tamsin | #46'],
            FACTS: ['Tamsin | relation to Halvard | wary of him | #47', 'Halvard | condition | a fever | #48'],
            SCENES: ['Day 1 | #1-#50 | The mill | private | present: Halvard, Tamsin, Kira (until #49) | They part'],
            NIGHTS: ['#50 | they sleep again'],
        }),
        stretch(41, 80),
    );
    assert.deepEqual(plain(result.refused), []);
    assert.equal(state.scenes.length, 1);
    assert.equal(state.nights.length, 2);
    assert.ok(state.facts.some((fact) => fact.status === 'Ended' && fact.ended !== null));
    assert.ok(state.facts.some((fact) => fact.status === 'Expired'));
    assert.ok(state.facts.some((fact) => fact.told.length > 0));
    assert.ok(state.stale.length > 0);
    assertFrozenDeep(state, 'state');
    const before = plain(log);
    const replayed = ScribeReplay.run(log, storyOrder);
    assert.deepEqual(plain(log), before);
    assert.deepEqual(replayed, state);
    const copy = plain(log);
    assert.deepEqual(ScribeReplay.run(copy, storyOrder), state);
    assert.deepEqual(plain(copy), before);
    assert.equal(Object.isFrozen(log.entries[1].operations[0]), false);
});

test('many nights and conditions replay quickly', () => {
    const large = new CampaignBuilder('Orla');
    for (let number = 1; number <= 3000; number++) {
        large.narrator(`The long tale goes on, line ${number}.`);
    }
    const messages = ScribeIntake.read(large.messages).messages;
    const order = messages.map((message) => message.id);
    const names = ['Halvard', 'Mirelle', 'Tamsin', 'Oswin', 'Aldric', 'Isolde', 'Kira', 'Orla', 'Maren', 'Brandt'];
    const log = ScribeLog.create();
    let serial = 0;
    for (let block = 0; block < 10; block++) {
        const facts = [];
        const nights = [];
        for (let offset = 0; offset < 300; offset++) {
            const position = block * 300 + offset + 1;
            if (offset % 6 === 5) {
                nights.push(`#${position} | they sleep, night ${position}`);
            } else if (offset % 6 < 4) {
                facts.push(`${names[serial % names.length]} | condition | weary ${serial} | #${position}`);
                serial++;
            }
        }
        const parsed = ScribeAnswer.parse(answer({ FACTS: facts, NIGHTS: nights }));
        assert.equal(parsed.operations.length, 250);
        const result = ScribeLog.append(log, ScribeReplay.run(log, order), parsed.operations, {
            messages: messages.slice(block * 300, block * 300 + 300),
            origin: 'Story',
        });
        assert.deepEqual(plain(result.refused), []);
    }
    const started = performance.now();
    const state = ScribeReplay.run(log, order);
    const elapsed = performance.now() - started;
    assert.equal(state.facts.length, 2000);
    assert.equal(state.nights.length, 500);
    assert.ok(state.facts.every((fact) => fact.status === 'Expired'));
    assert.ok(elapsed < 20000, `replay took ${elapsed} ms`);
});
