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
 * @param {*} value
 * @param {string} path
 * @return {void}
 */
function assertJsonSafe(value, path) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return;
    }
    if (typeof value === 'number') {
        assert.equal(Number.isFinite(value), true, `${path} is not a finite number`);
        return;
    }
    assert.equal(typeof value, 'object', `${path} is ${typeof value}`);
    if (Array.isArray(value)) {
        value.forEach((child, index) => assertJsonSafe(child, `${path}[${index}]`));
        return;
    }
    assert.equal(Object.getPrototypeOf(Object.getPrototypeOf(value)), null, `${path} is not a plain object`);
    for (const [key, child] of Object.entries(value)) {
        assertJsonSafe(child, `${path}.${key}`);
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
 * @param {number} first
 * @param {number} last
 * @return {string[]}
 */
function idsOf(first, last) {
    return stretch(first, last).map((message) => message.id);
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
 * @param {object} log
 * @param {object} operation
 * @return {{ entry: object, state: object }}
 */
function rule(log, operation) {
    const entry = ScribeLog.rule(log, ScribeReplay.run(log, storyOrder), operation);
    return { entry, state: ScribeReplay.run(log, storyOrder) };
}

/**
 * @param {object} log
 * @param {*} operation
 * @param {string} message
 * @return {void}
 */
function refuses(log, operation, message) {
    const before = plain(log);
    assert.throws(
        () => ScribeLog.rule(log, ScribeReplay.run(log, storyOrder), operation),
        { name: 'Error', message },
        JSON.stringify(operation) ?? String(operation),
    );
    assert.deepEqual(plain(log), before);
}

/**
 * @param {object} log
 * @param {object} old
 * @return {void}
 */
function assertStale(log, old) {
    const before = plain(log);
    const operations = ScribeAnswer.parse(answer({ FACTS: ['Halvard | trait | calm | #9'] })).operations;
    const attempts = [
        () => ScribeLog.rule(log, old, pin('S1', 'age', 'thirty')),
        () => ScribeLog.rule(log, old, { type: 'Rumour' }),
        () => ScribeLog.append(log, old, operations, { messages: pick(9), origin: 'Story' }),
        () => ScribeLog.keepFirst(log, old),
    ];
    for (const attempt of attempts) {
        assert.throws(attempt, { name: 'Error', message: 'StaleState' });
        assert.deepEqual(plain(log), before);
    }
}

/**
 * @param {string} subject
 * @param {string} category
 * @param {string} text
 * @param {boolean} hidden
 * @return {object}
 */
function pin(subject, category, text, hidden = false) {
    return { type: 'Pin', subject, category, target: null, text, hidden };
}

/**
 * @param {object} state
 * @param {string} label
 * @param {string} category
 * @return {object[]}
 */
function slotOf(state, label, category) {
    const subject = subjectLabelled(state, label).id;
    return state.facts.filter((fact) => fact.subject === subject && fact.category === category);
}

/**
 * @param {object} state
 * @return {object}
 */
function unrevised(state) {
    return { ...plain(state), revision: null };
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
 * @param {object} state
 * @return {string[]}
 */
function labels(state) {
    return plain(state.subjects.map((subject) => subject.label));
}

/**
 * @param {object} result
 * @return {string[]}
 */
function reasons(result) {
    return plain(result.refused.map((item) => item.reason));
}

test('a pin settles a conflict', () => {
    const log = ScribeLog.create();
    const { state } = apply(
        log,
        storyOrder,
        answer({
            FACTS: [
                'Halvard | age | twenty-five | #3',
                'Halvard | age | thirty | #5',
                'Halvard | age | thirty-five | #9',
            ],
        }),
        stretch(1, 10),
    );
    assert.equal(state.conflicts.length, 1);
    const before = plain(factSaying(state, 'thirty-five'));
    assert.equal(before.cite, 'MESSAGE-9');
    assert.equal(before.origin, 'Story');
    const { entry, state: pinned } = rule(log, pin('S1', 'age', 'Thirty-five', true));
    assert.deepEqual(plain(entry), {
        sequence: 2,
        kind: 'Operator',
        origin: 'Operator',
        messageIds: [],
        operations: [
            {
                type: 'Pin',
                subject: 'S1',
                category: 'age',
                target: null,
                text: 'Thirty-five',
                hidden: false,
                fact: 'F4',
                winner: 'F3',
                told: [],
                origin: 'Story',
                cite: 'MESSAGE-9',
                position: 9,
            },
        ],
        withdrawn: false,
    });
    assert.equal(entry, log.entries.at(-1));
    assert.equal(Object.isFrozen(entry), false);
    assert.equal(log.nextFact, 5);
    assert.equal(log.nextSequence, 3);
    assert.equal(log.revision, 2);
    assert.deepEqual(plain(factSaying(pinned, 'thirty-five')), { ...before, status: 'InForce', pinned: true });
    assert.deepEqual(statuses(pinned), [
        ['F1', 'twenty-five', 'Disputed'],
        ['F2', 'thirty', 'Disputed'],
        ['F3', 'thirty-five', 'InForce'],
    ]);
    assert.deepEqual(plain(pinned.facts.map((fact) => fact.pinned)), [false, false, true]);
    assert.deepEqual(plain(pinned.conflicts), []);
    assert.equal(pinned.facts.length, 3);
});

test('a pin of a value nobody said makes a fact', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            FACTS: [
                'Halvard | age | twenty-five | #3',
                'Halvard | age | thirty | #5',
                'Halvard | age | thirty-five | #9',
            ],
        }),
        stretch(1, 10),
    );
    const { entry, state } = rule(log, pin('S1', 'age', 'forty'));
    const stored = plain(entry.operations[0]);
    assert.deepEqual([stored.fact, stored.winner, stored.told, stored.hidden], ['F4', null, [], false]);
    assert.deepEqual(plain(factNumbered(state, 'F4')), {
        id: 'F4',
        subject: 'S1',
        category: 'age',
        target: null,
        targetText: null,
        text: 'forty',
        cite: null,
        position: 0,
        origin: 'Operator',
        hidden: false,
        told: [],
        widened: null,
        status: 'InForce',
        replacedBy: null,
        ended: null,
        pinned: true,
        made: true,
    });
    assert.deepEqual(statuses(state), [
        ['F1', 'twenty-five', 'Disputed'],
        ['F2', 'thirty', 'Disputed'],
        ['F3', 'thirty-five', 'Disputed'],
        ['F4', 'forty', 'InForce'],
    ]);
    assert.deepEqual(plain(state.conflicts), []);
    refuses(log, { type: 'RemoveFact', fact: 'F4' }, 'InvalidOperation');
});

test('a pinned value is not reopened', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | age | twenty-five | #3', 'Halvard | age | forty | #5'] }),
        pick(3, 5),
    );
    rule(log, pin('S1', 'age', 'forty'));
    const later = apply(log, storyOrder, answer({ FACTS: ['Halvard | age | thirty | #9'] }), pick(9));
    assert.deepEqual(statuses(later.state), [
        ['F1', 'twenty-five', 'Disputed'],
        ['F2', 'forty', 'InForce'],
        ['F4', 'thirty', 'Disputed'],
    ]);
    assert.deepEqual(plain(later.state.facts.map((fact) => fact.pinned)), [false, true, false]);
    assert.deepEqual(plain(later.state.conflicts), []);
    const { state } = rule(log, pin('S1', 'age', 'twenty-five'));
    assert.deepEqual(statuses(state), [
        ['F1', 'twenty-five', 'InForce'],
        ['F2', 'forty', 'Disputed'],
        ['F4', 'thirty', 'Disputed'],
    ]);
    assert.deepEqual(plain(state.facts.map((fact) => fact.pinned)), [true, false, false]);
    assert.deepEqual(plain(state.conflicts), []);
});

test('keep the first value for all', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            FACTS: [
                'Halvard | age | twenty-five | #1',
                'Halvard | age | thirty | #2',
                'Mirelle | eyes | grey | hidden | #1',
                'Mirelle | eyes | blue | #2',
                'Tamsin | hair | black | #1',
                'Tamsin | hair | brown | #2',
            ],
        }),
        pick(1, 2),
    );
    apply(
        log,
        storyOrder,
        answer({ CHANGES: ['F5 | Tamsin | hair | ENDED | #3'], TOLD: ['F3 | Mirelle | Kira | #3'] }),
        pick(3),
    );
    const before = ScribeReplay.run(log, storyOrder);
    assert.deepEqual(plain(before.conflicts.map((conflict) => conflict.established)), ['F1', 'F3', null]);
    const entries = ScribeLog.keepFirst(log, before);
    assert.equal(entries.length, 2);
    assert.equal(entries[0], log.entries.at(-2));
    assert.equal(entries[1], log.entries.at(-1));
    assert.deepEqual(plain(entries.map((entry) => [entry.sequence, entry.kind, entry.origin])), [
        [3, 'Operator', 'Operator'],
        [4, 'Operator', 'Operator'],
    ]);
    assert.deepEqual(plain(entries.map((entry) => entry.operations)), [
        [
            {
                type: 'Pin',
                subject: 'S1',
                category: 'age',
                target: null,
                text: 'twenty-five',
                hidden: false,
                fact: 'F7',
                winner: 'F1',
                told: [],
                origin: 'Story',
                cite: 'MESSAGE-1',
                position: 1,
            },
        ],
        [
            {
                type: 'Pin',
                subject: 'S2',
                category: 'eyes',
                target: null,
                text: 'grey',
                hidden: true,
                fact: 'F8',
                winner: 'F3',
                told: ['S4'],
                origin: 'Story',
                cite: 'MESSAGE-1',
                position: 1,
            },
        ],
    ]);
    assert.equal(log.nextFact, 9);
    assert.equal(log.revision, 4);
    const after = ScribeReplay.run(log, storyOrder);
    assert.deepEqual(plain(after.conflicts), [
        { subject: 'S3', category: 'hair', target: null, established: null, others: ['F6'] },
    ]);
    assert.deepEqual(plain(after.facts.map((fact) => [fact.id, fact.status, fact.pinned])), [
        ['F1', 'InForce', true],
        ['F3', 'InForce', true],
        ['F5', 'Ended', false],
        ['F2', 'Disputed', false],
        ['F4', 'Disputed', false],
        ['F6', 'Disputed', false],
    ]);
    const kept = plain(log);
    assert.deepEqual(plain(ScribeLog.keepFirst(log, after)), []);
    assert.deepEqual(plain(log), kept);
});

test('merge joins two subjects and compares again', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Aldrich | character', 'Aldric | character'],
            NAMES: ['Drich | Aldrich | #2'],
            FACTS: [
                'Aldrich | age | mid-thirties | #2',
                'Aldric | age | late forties | #3',
                'Halvard | relation to Aldrich | owes him | #3',
            ],
            SCENES: ['Day 1 | #2-#3 | The mill | public | present: Aldrich, Halvard | They haggle'],
        }),
        pick(2, 3),
    );
    const { state } = apply(log, storyOrder, answer({ TOLD: ['F3 | Halvard | Aldrich | #4'] }), pick(4));
    assert.deepEqual(plain(state.lookAlikes), [{ first: 'S1', second: 'S2', reason: 'Spelling' }]);
    assert.deepEqual(plain(state.conflicts), []);
    const { entry, state: merged } = rule(log, { type: 'Merge', from: 'S1', into: 'S2' });
    assert.deepEqual(plain(entry.operations), [{ type: 'Merge', from: 'S1', into: 'S2' }]);
    assert.deepEqual(plain(merged.subjects), [
        { id: 'S1', label: 'Aldrich', name: 'Aldrich', kind: 'character', assumed: false, aka: [], mergedInto: 'S2' },
        {
            id: 'S2',
            label: 'Aldric',
            name: 'Aldric',
            kind: 'character',
            assumed: false,
            aka: ['Drich', 'Aldrich'],
            mergedInto: null,
        },
        { id: 'S3', label: 'Halvard', name: 'Halvard', kind: 'character', assumed: true, aka: [], mergedInto: null },
    ]);
    assert.deepEqual(plain(merged.facts.map((fact) => [fact.id, fact.subject, fact.target, fact.status, fact.told])), [
        ['F1', 'S2', null, 'InForce', []],
        ['F2', 'S2', null, 'Disputed', []],
        ['F3', 'S3', 'S2', 'InForce', ['S2']],
    ]);
    assert.deepEqual(plain(merged.conflicts), [
        { subject: 'S2', category: 'age', target: null, established: 'F1', others: ['F2'] },
    ]);
    assert.deepEqual(plain(merged.lookAlikes), []);
    assert.deepEqual(plain(merged.aliases), [{ subject: 'S2', name: 'Drich', cite: 'MESSAGE-2' }]);
    assert.deepEqual(plain(merged.scenes[0].present.map((attendee) => attendee.subject)), ['S2', 'S3']);
});

test('after a merge every name finds the survivor', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Aldrich | character', 'Aldric | character'],
            FACTS: ['Aldrich | age | mid-thirties | #2', 'Aldric | age | late forties | #3'],
        }),
        pick(2, 3),
    );
    rule(log, { type: 'Merge', from: 'S1', into: 'S2' });
    const { state, result } = apply(
        log,
        storyOrder,
        answer({
            FACTS: ['Aldrich | trait | stubborn | #10', 'Halvard | relation to Aldrich | owes him | #10'],
            CHANGES: ['F2 | Aldrich | age | FULLER: late forties and greying | #10'],
        }),
        pick(10),
    );
    assert.deepEqual(reasons(result), []);
    const stored = plain(result.entry.operations);
    assert.equal(stored.find((operation) => operation.text === 'stubborn').subject, 'S2');
    assert.equal(stored.find((operation) => operation.text === 'owes him').target, 'S2');
    const refine = stored.find((operation) => operation.type === 'Refine');
    assert.deepEqual([refine.fact, refine.subject, refine.label], ['F2', 'S2', 'Aldrich']);
    assert.deepEqual(labels(state), ['Aldrich', 'Aldric', 'Halvard']);
    assert.equal(factSaying(state, 'stubborn').subject, 'S2');
    assert.equal(factSaying(state, 'owes him').target, 'S2');
    assert.equal(factNumbered(state, 'F2').status, 'Replaced');
});

test('merges chain and never loop', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            FACTS: [
                'Halvard (the smith) | trait | brave | #1',
                'Mirelle | trait | shy | #1',
                'Tamsin | trait | quick | #1',
            ],
        }),
        pick(1),
    );
    rule(log, { type: 'Merge', from: 'S1', into: 'S2' });
    const { state } = rule(log, { type: 'Merge', from: 'S2', into: 'S3' });
    assert.deepEqual(plain(state.subjects.map((subject) => [subject.id, subject.mergedInto, subject.aka])), [
        ['S1', 'S3', []],
        ['S2', 'S3', []],
        ['S3', null, ['Halvard (the smith)', 'Halvard', 'Mirelle']],
    ]);
    assert.deepEqual(plain(state.facts.map((fact) => fact.subject)), ['S3', 'S3', 'S3']);
    refuses(log, { type: 'Merge', from: 'S3', into: 'S1' }, 'InvalidOperation');
    refuses(log, { type: 'Merge', from: 'S1', into: 'S2' }, 'InvalidOperation');
    refuses(log, { type: 'Merge', from: 'S3', into: 'S3' }, 'InvalidOperation');
    const looped = plain(log);
    looped.entries.push({
        sequence: looped.nextSequence,
        kind: 'Operator',
        origin: 'Operator',
        messageIds: [],
        operations: [{ type: 'Merge', from: 'S3', into: 'S1' }],
        withdrawn: false,
    });
    const replayed = ScribeReplay.run(looped, storyOrder);
    assert.deepEqual(plain(replayed.subjects), plain(state.subjects));
    assert.deepEqual(plain(replayed.facts), plain(state.facts));
});

test('distinct keeps two subjects', () => {
    const log = ScribeLog.create();
    const { state } = apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: [
                'Oswin | character',
                "Oswin (Tamsin's uncle) | character",
                'Halvard | character',
                'Brandt | character',
            ],
            NAMES: ['Brandt | Halvard | #2'],
        }),
        pick(2),
    );
    assert.deepEqual(plain(state.lookAlikes), [
        { first: 'S1', second: 'S2', reason: 'SameName' },
        { first: 'S3', second: 'S4', reason: 'Alias' },
    ]);
    const named = rule(log, { type: 'Distinct', first: 'S1', second: 'S2' });
    assert.deepEqual(plain(named.entry.operations), [{ type: 'Distinct', first: 'S1', second: 'S2' }]);
    assert.deepEqual(plain(named.state.lookAlikes), [{ first: 'S3', second: 'S4', reason: 'Alias' }]);
    assert.deepEqual(labels(named.state), ['Oswin', "Oswin (Tamsin's uncle)", 'Halvard', 'Brandt']);
    assert.deepEqual(plain(named.state.subjects.map((subject) => subject.mergedInto)), [null, null, null, null]);
    const aliased = rule(log, { type: 'Distinct', first: 'S4', second: 'S3' });
    assert.deepEqual(plain(aliased.state.lookAlikes), []);
    assert.equal(aliased.state.subjects.length, 4);
    refuses(log, { type: 'Distinct', first: 'S1', second: 'S1' }, 'InvalidOperation');
    const merging = ScribeLog.create();
    apply(
        merging,
        storyOrder,
        answer({ SUBJECTS: ['Oswin | character', "Oswin (Tamsin's uncle) | character", 'Kira | character'] }),
        pick(2),
    );
    const apart = rule(merging, { type: 'Distinct', first: 'S3', second: 'S2' });
    assert.deepEqual(plain(apart.state.lookAlikes), [{ first: 'S1', second: 'S2', reason: 'SameName' }]);
    const joined = rule(merging, { type: 'Merge', from: 'S3', into: 'S1' });
    assert.deepEqual(plain(joined.state.lookAlikes), []);
});

test('split moves the listed facts', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Oswin | character'],
            FACTS: [
                'Oswin | trait | quiet | #1',
                'Oswin | trait | gruff | #2',
                'Oswin | location | the mill | #1',
                'Oswin | belonging | a fishing rod | #2',
                'Halvard | trait | brave | #1',
            ],
        }),
        pick(1, 2),
    );
    const uncle = "Oswin (Tamsin's uncle)";
    const { entry, state } = rule(log, {
        type: 'Split',
        subject: 'S1',
        label: uncle,
        kind: 'character',
        facts: ['F2', 'F4'],
    });
    assert.deepEqual(plain(entry.operations), [
        { type: 'Split', subject: 'S1', label: uncle, kind: 'character', facts: ['F2', 'F4'], becomes: 'S3' },
    ]);
    assert.equal(log.nextSubject, 4);
    assert.deepEqual(plain(subjectLabelled(state, uncle)), {
        id: 'S3',
        label: uncle,
        name: 'Oswin',
        kind: 'character',
        assumed: false,
        aka: [],
        mergedInto: null,
    });
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.subject, fact.status])), [
        ['F1', 'S1', 'InForce'],
        ['F3', 'S1', 'InForce'],
        ['F5', 'S2', 'InForce'],
        ['F2', 'S3', 'InForce'],
        ['F4', 'S3', 'InForce'],
    ]);
    assert.deepEqual(plain(state.lookAlikes), []);
    const later = apply(
        log,
        storyOrder,
        answer({ CHANGES: [`F2 | ${uncle} | trait | FULLER: gruff but kind | #5`] }),
        pick(5),
    );
    assert.deepEqual(reasons(later.result), []);
    assert.equal(factSaying(later.state, 'gruff but kind').subject, 'S3');
    assert.equal(factNumbered(later.state, 'F2').status, 'Replaced');
    refuses(log, { type: 'Split', subject: 'S1', label: 'Oswin', kind: 'character', facts: ['F1'] }, 'Ambiguous');
    refuses(log, { type: 'Split', subject: 'S1', label: 'Halvard', kind: 'character', facts: ['F1'] }, 'Ambiguous');
    refuses(
        log,
        { type: 'Split', subject: 'S1', label: 'Oswin the elder', kind: 'character', facts: ['F1', 'F5'] },
        'Reference',
    );
    refuses(log, { type: 'Split', subject: 'S1', label: 'Halvard', kind: 'character', facts: ['F5'] }, 'Reference');
    refuses(
        log,
        { type: 'Split', subject: 'S1', label: 'Oswin the elder', kind: 'character', facts: ['F2'] },
        'Reference',
    );
    const unsplit = plain(log);
    unsplit.entries[1].withdrawn = true;
    const withdrawn = ScribeReplay.run(unsplit, storyOrder);
    assert.deepEqual(plain(subjectLabelled(withdrawn, uncle)), plain(subjectLabelled(state, uncle)));
    assert.deepEqual(plain(withdrawn.facts.filter((fact) => fact.subject === 'S3')), []);
    assert.deepEqual(plain(withdrawn.facts.map((fact) => fact.subject)), ['S1', 'S1', 'S2', 'S1', 'S1', 'S1']);
    assert.deepEqual(plain(withdrawn.lookAlikes), [{ first: 'S1', second: 'S3', reason: 'SameName' }]);
    const early = ScribeLog.create();
    apply(early, storyOrder, answer({ FACTS: ['Oswin | trait | quiet | #1', 'Oswin | eyes | grey | #1'] }), pick(1));
    apply(early, storyOrder, answer({ CHANGES: ['F2 | Oswin | eyes | FULLER: grey as slate | #3'] }), pick(3));
    const fuller = plain(early);
    const named = rule(early, {
        type: 'Split',
        subject: 'S1',
        label: 'Oswin (the miller)',
        kind: 'character',
        facts: ['F2'],
    });
    assert.deepEqual(plain(named.state.facts.map((fact) => [fact.id, fact.subject, fact.status])), [
        ['F1', 'S1', 'InForce'],
        ['F2', 'S2', 'Replaced'],
        ['F3', 'S2', 'InForce'],
    ]);
    const successor = rule(fuller, {
        type: 'Split',
        subject: 'S1',
        label: 'Oswin (the miller)',
        kind: 'character',
        facts: ['F3'],
    });
    assert.deepEqual(plain(successor.state.facts.map((fact) => [fact.id, fact.subject, fact.status])), [
        ['F1', 'S1', 'InForce'],
        ['F2', 'S1', 'InForce'],
        ['F3', 'S2', 'InForce'],
    ]);
    assert.deepEqual(plain(successor.state.refinements), []);
});

test('unalias takes the name back', () => {
    const log = ScribeLog.create();
    const { state } = apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Aldric | character', 'Halvard | character', 'Brandt | character'],
            NAMES: ['Aldrich | Aldric | #2', 'Brandt | Halvard | #3'],
        }),
        pick(2, 3),
    );
    assert.deepEqual(plain(state.subjects.map((subject) => subject.aka)), [['Aldrich'], ['Brandt'], []]);
    assert.deepEqual(plain(state.aliases), [
        { subject: 'S1', name: 'Aldrich', cite: 'MESSAGE-2' },
        { subject: 'S2', name: 'Brandt', cite: 'MESSAGE-3' },
    ]);
    assert.deepEqual(plain(state.lookAlikes), [{ first: 'S2', second: 'S3', reason: 'Alias' }]);
    refuses(log, { type: 'Unalias', subject: 'S1', name: 'Brandt' }, 'Reference');
    refuses(log, { type: 'Unalias', subject: 'S1', name: 'Halvard' }, 'Reference');
    const first = rule(log, { type: 'Unalias', subject: 'S1', name: 'aldrich' });
    assert.deepEqual(plain(first.entry.operations), [{ type: 'Unalias', subject: 'S1', name: 'aldrich' }]);
    assert.deepEqual(plain(first.state.subjects.map((subject) => subject.aka)), [[], ['Brandt'], []]);
    assert.deepEqual(plain(first.state.aliases), [{ subject: 'S2', name: 'Brandt', cite: 'MESSAGE-3' }]);
    const second = rule(log, { type: 'Unalias', subject: 'S2', name: 'Brandt' });
    assert.deepEqual(plain(second.state.subjects.map((subject) => subject.aka)), [[], [], []]);
    assert.deepEqual(plain(second.state.aliases), []);
    assert.deepEqual(plain(second.state.lookAlikes), []);
    const later = apply(log, storyOrder, answer({ FACTS: ['Aldrich | trait | sly | #5'] }), pick(5));
    assert.deepEqual(labels(later.state), ['Aldric', 'Halvard', 'Brandt', 'Aldrich']);
    assert.equal(factSaying(later.state, 'sly').subject, 'S4');
    refuses(log, { type: 'Unalias', subject: 'S1', name: 'Aldrich' }, 'Reference');
});

test('answering and dismissing questions', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ QUESTIONS: ['Does Mirelle trust Halvard? | #2', 'Who rang the bell? | #3'] }),
        pick(2, 3),
    );
    const first = rule(log, { type: 'Answer', question: 'Q1', text: 'She does not' });
    assert.deepEqual(plain(first.entry.operations), [
        { type: 'Answer', question: 'Q1', text: 'She does not', questionText: 'Does Mirelle trust Halvard?' },
    ]);
    /**
     * @param {object} replayed
     * @return {Array<[string, string|null, boolean]>}
     */
    const asked = (replayed) =>
        plain(replayed.questions.map((question) => [question.id, question.answer, question.dismissed]));
    assert.deepEqual(asked(first.state), [
        ['Q1', 'She does not', false],
        ['Q2', null, false],
    ]);
    rule(log, { type: 'Answer', question: 'Q1', text: 'Only a little' });
    const { entry, state } = rule(log, { type: 'Dismiss', question: 'Q2' });
    assert.deepEqual(plain(entry.operations), [
        { type: 'Dismiss', question: 'Q2', questionText: 'Who rang the bell?' },
    ]);
    assert.deepEqual(asked(state), [
        ['Q1', 'Only a little', false],
        ['Q2', null, true],
    ]);
    refuses(log, { type: 'Answer', question: 'Q9', text: 'nobody' }, 'Reference');
    refuses(log, { type: 'Dismiss', question: 'Q9' }, 'Reference');
    refuses(log, { type: 'Answer', question: 'Q1', text: ' -- ' }, 'InvalidOperation');
});

test('a corrected answer reopens the question', () => {
    const log = ScribeLog.create();
    const questions = answer({ QUESTIONS: ['Does Mirelle trust Halvard? | #2', 'Who rang the bell? | #3'] });
    apply(log, storyOrder, questions, stretch(1, 10));
    /**
     * @param {object} replayed
     * @return {Array<[string, string|null, boolean]>}
     */
    const asked = (replayed) =>
        plain(replayed.questions.map((question) => [question.id, question.answer, question.dismissed]));
    rule(log, { type: 'Answer', question: 'Q1', text: 'She does not' });
    const filed = rule(log, { type: 'Dismiss', question: 'Q1' });
    assert.deepEqual(asked(filed.state), [
        ['Q1', 'She does not', true],
        ['Q2', null, false],
    ]);
    const corrected = rule(log, { type: 'Answer', question: 'Q1', text: 'Only a little' });
    assert.deepEqual(asked(corrected.state), [
        ['Q1', 'Only a little', false],
        ['Q2', null, false],
    ]);
    const again = rule(log, { type: 'Dismiss', question: 'Q1' });
    assert.deepEqual(asked(again.state), [
        ['Q1', 'Only a little', true],
        ['Q2', null, false],
    ]);
    ScribeLog.withdraw(log, 'MESSAGE-2');
    const reread = apply(log, storyOrder, questions, stretch(1, 10));
    assert.deepEqual(asked(reread.state), [
        ['Q3', 'Only a little', true],
        ['Q4', null, false],
    ]);
    rule(log, { type: 'Answer', question: 'Q3', text: 'She trusts him now' });
    ScribeLog.withdraw(log, 'MESSAGE-2');
    const third = apply(log, storyOrder, questions, stretch(1, 10));
    assert.deepEqual(asked(third.state), [
        ['Q5', 'She trusts him now', false],
        ['Q6', null, false],
    ]);
});

test('equally worded questions inherit rulings only from a reread of the same citation', () => {
    const log = ScribeLog.create();
    const askAt = (positions) => answer({ QUESTIONS: positions.map((position) => 'Who has the key? | #' + position) });
    apply(log, storyOrder, askAt([2, 3]), stretch(1, 10));
    rule(log, { type: 'Answer', question: 'Q1', text: 'The miller.' });
    rule(log, { type: 'Dismiss', question: 'Q1' });
    rule(log, { type: 'Answer', question: 'Q2', text: 'The ferryman.' });
    ScribeLog.withdraw(log, 'MESSAGE-2');
    const { state } = apply(log, storyOrder, askAt([3, 4, 2]), stretch(1, 10));
    assert.deepEqual(plain(state.questions.map((question) => [question.id, question.position, question.answer, question.dismissed])), [
        ['Q5', 2, 'The miller.', true],
        ['Q3', 3, 'The ferryman.', false],
        ['Q4', 4, null, false],
    ]);
});

test('removing and adding by hand', () => {
    const log = ScribeLog.create();
    const { state } = apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character'],
            FACTS: ['Halvard | location | the mill | #2', 'Halvard | location | the inn | #5'],
        }),
        pick(2, 5),
    );
    assert.deepEqual(statuses(state), [
        ['F1', 'the mill', 'Replaced'],
        ['F2', 'the inn', 'InForce'],
    ]);
    const removed = rule(log, { type: 'RemoveFact', fact: 'F2' });
    assert.deepEqual(plain(removed.entry.operations), [
        {
            type: 'RemoveFact',
            fact: 'F2',
            mark: { subject: 'S1', category: 'location', target: null, targetText: null, text: 'the inn' },
        },
    ]);
    assert.deepEqual(plain(removed.state.facts), [
        { ...plain(factNumbered(state, 'F1')), status: 'InForce', replacedBy: null },
        {
            id: 'F2',
            subject: 'S1',
            category: 'location',
            target: null,
            targetText: null,
            text: 'the inn',
            cite: 'MESSAGE-5',
            position: 5,
            origin: 'Story',
            hidden: false,
            told: [],
            widened: null,
            status: 'Removed',
            replacedBy: null,
            ended: null,
            pinned: false,
            made: false,
        },
    ]);
    const trait = {
        type: 'AddFact',
        subject: 'S1',
        category: 'trait',
        target: null,
        text: 'stubborn',
        hidden: false,
        cite: null,
        position: 0,
    };
    const added = rule(log, trait);
    assert.deepEqual(plain(added.entry.operations), [{ ...trait, targetText: null, fact: 'F3' }]);
    assert.deepEqual(plain(factNumbered(added.state, 'F3')), {
        id: 'F3',
        subject: 'S1',
        category: 'trait',
        target: null,
        targetText: null,
        text: 'stubborn',
        cite: null,
        position: 0,
        origin: 'Operator',
        hidden: false,
        told: [],
        widened: null,
        status: 'InForce',
        replacedBy: null,
        ended: null,
        pinned: false,
        made: false,
    });
    const relation = {
        type: 'AddFact',
        subject: 'S1',
        category: 'relation',
        target: 'S2',
        text: 'trusts her',
        hidden: true,
        cite: 'MESSAGE-3',
        position: 3,
    };
    const related = rule(log, relation);
    assert.deepEqual(plain(related.entry.operations), [{ ...relation, targetText: 'Mirelle', fact: 'F4' }]);
    const linked = plain(factNumbered(related.state, 'F4'));
    assert.deepEqual(
        {
            subject: linked.subject,
            target: linked.target,
            targetText: linked.targetText,
            hidden: linked.hidden,
            position: linked.position,
            origin: linked.origin,
            status: linked.status,
        },
        {
            subject: 'S1',
            target: 'S2',
            targetText: 'Mirelle',
            hidden: true,
            position: 3,
            origin: 'Operator',
            status: 'InForce',
        },
    );
    refuses(log, { ...trait, category: 'age', text: 'forty' }, 'InvalidOperation');
});

test('a removed fact was never said', () => {
    const log = ScribeLog.create();
    const { state } = apply(
        log,
        storyOrder,
        answer({
            FACTS: [
                'Halvard | age | twenty-five | #3',
                'Halvard | age | thirty | #5',
                'Halvard | eyes | grey | #3',
                'Halvard | location | the mill | #3',
                'Halvard | location | the inn | #5',
            ],
        }),
        pick(3, 5, 6),
    );
    apply(
        log,
        storyOrder,
        answer({
            CHANGES: ['F3 | Halvard | eyes | FULLER: grey as slate | #8'],
            TOLD: ['F1 | Halvard | Kira | #8'],
        }),
        pick(8),
    );
    assert.deepEqual(statuses(state), [
        ['F1', 'twenty-five', 'InForce'],
        ['F3', 'grey', 'InForce'],
        ['F4', 'the mill', 'Replaced'],
        ['F2', 'thirty', 'Disputed'],
        ['F5', 'the inn', 'InForce'],
    ]);
    assert.equal(state.conflicts.length, 1);
    rule(log, { type: 'RemoveFact', fact: 'F1' });
    rule(log, { type: 'RemoveFact', fact: 'F5' });
    const { state: cleared } = rule(log, { type: 'RemoveFact', fact: 'F3' });
    assert.deepEqual(statuses(cleared), [
        ['F1', 'twenty-five', 'Removed'],
        ['F3', 'grey', 'Removed'],
        ['F4', 'the mill', 'InForce'],
        ['F2', 'thirty', 'InForce'],
        ['F5', 'the inn', 'Removed'],
        ['F6', 'grey as slate', 'InForce'],
    ]);
    assert.deepEqual(plain(factNumbered(cleared, 'F1').told), []);
    assert.deepEqual(plain(cleared.refinements), []);
    assert.deepEqual(plain(cleared.conflicts), []);
});

test('a fact added by hand takes its place in the story', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | location | the mill | #20', 'Halvard | location | the harbour | #40'] }),
        pick(20, 40),
    );
    const { state } = rule(log, {
        type: 'AddFact',
        subject: 'S1',
        category: 'location',
        target: null,
        text: 'the inn',
        hidden: false,
        cite: 'MESSAGE-30',
        position: 30,
    });
    /**
     * @param {object} replayed
     * @return {Array<[string, number, string, string|null]>}
     */
    const chain = (replayed) =>
        plain(replayed.facts.map((fact) => [fact.id, fact.position, fact.status, fact.replacedBy]));
    assert.deepEqual(chain(state), [
        ['F1', 20, 'Replaced', 'F3'],
        ['F3', 30, 'Replaced', 'F2'],
        ['F2', 40, 'InForce', null],
    ]);
    assert.equal(factNumbered(state, 'F3').origin, 'Operator');
    assert.equal(factNumbered(state, 'F3').cite, 'MESSAGE-30');
    const gone = ScribeReplay.run(
        log,
        storyOrder.filter((id) => id !== 'MESSAGE-30'),
    );
    assert.deepEqual(chain(gone), [
        ['F1', 20, 'Replaced', 'F3'],
        ['F3', 30, 'Replaced', 'F2'],
        ['F2', 39, 'InForce', null],
    ]);
    const shifted = ScribeReplay.run(
        log,
        storyOrder.filter((id) => id !== 'MESSAGE-10'),
    );
    assert.deepEqual(chain(shifted), [
        ['F1', 19, 'Replaced', 'F3'],
        ['F3', 29, 'Replaced', 'F2'],
        ['F2', 39, 'InForce', null],
    ]);
    const same = apply(log, storyOrder, answer({ FACTS: ['Halvard | location | the stable | #30'] }), pick(30));
    assert.deepEqual(chain(same.state), [
        ['F1', 20, 'Replaced', 'F4'],
        ['F4', 30, 'Replaced', 'F3'],
        ['F3', 30, 'Replaced', 'F2'],
        ['F2', 40, 'InForce', null],
    ]);
});

test('widen and narrow', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Mirelle | character', 'Tamsin | character'],
            FACTS: ['Halvard | background | charged a line of pikes | hidden | #2'],
            SCENES: ['Day 1 | #1-#5 | The mill | public | present: Halvard, Mirelle | They talk'],
        }),
        stretch(1, 5),
    );
    const everyone = rule(log, { type: 'Widen', fact: 'F1', to: 'Everyone' });
    const mark = {
        subject: 'S3',
        category: 'background',
        target: null,
        targetText: null,
        text: 'charged a line of pikes',
    };
    assert.deepEqual(plain(everyone.entry.operations), [{ type: 'Widen', fact: 'F1', to: 'Everyone', mark }]);
    assert.equal(factNumbered(everyone.state, 'F1').widened, 'Everyone');
    const two = rule(log, { type: 'Widen', fact: 'F1', to: ['S1', 'S2'] });
    assert.deepEqual(plain(factNumbered(two.state, 'F1').widened), ['S1', 'S2']);
    const merged = rule(log, { type: 'Merge', from: 'S2', into: 'S1' });
    assert.deepEqual(plain(factNumbered(merged.state, 'F1').widened), ['S1']);
    const again = rule(log, { type: 'Widen', fact: 'F1', to: ['S2', 'S3', 'S1'] });
    assert.deepEqual(plain(factNumbered(again.state, 'F1').widened), ['S1', 'S3']);
    assert.equal(again.state.scenes[0].narrowed, false);
    const narrowed = rule(log, { type: 'Narrow', scene: 'MESSAGE-1' });
    assert.deepEqual(plain(narrowed.entry.operations), [{ type: 'Narrow', scene: 'MESSAGE-1' }]);
    assert.equal(narrowed.state.scenes[0].narrowed, true);
    refuses(log, { type: 'Narrow', scene: 'MESSAGE-2' }, 'Reference');
    const moved = ScribeLog.create();
    apply(
        moved,
        storyOrder,
        answer({
            SUBJECTS: ['Mirelle | character'],
            FACTS: ['Halvard | location | the inn | #2', 'Halvard | location | the inn | #5'],
        }),
        stretch(1, 5),
    );
    rule(moved, { type: 'Widen', fact: 'F1', to: 'Everyone' });
    const later = rule(moved, { type: 'Widen', fact: 'F2', to: ['S1'] });
    assert.deepEqual(plain(later.state.facts.map((fact) => [fact.id, fact.status, fact.widened])), [
        ['F1', 'Replaced', ['S1']],
        ['F2', 'InForce', ['S1']],
    ]);
});

test('withdrawal brings back what was displaced', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | location | the village | #5'] }), stretch(1, 10));
    const { state } = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | location | the mansion | #50'] }),
        stretch(41, 60),
    );
    assert.deepEqual(statuses(state), [
        ['F1', 'the village', 'Replaced'],
        ['F2', 'the mansion', 'InForce'],
    ]);
    const returned = ScribeLog.withdraw(log, 'MESSAGE-45');
    assert.deepEqual(plain(returned), idsOf(41, 60));
    assert.deepEqual(plain(log.entries.map((entry) => entry.withdrawn)), [false, true]);
    assert.deepEqual(plain(log.read), Object.fromEntries(idsOf(1, 10).map((id) => [id, 1])));
    assert.equal(log.revision, 3);
    const after = ScribeReplay.run(log, storyOrder);
    assert.deepEqual(statuses(after), [['F1', 'the village', 'InForce']]);
    assert.equal(factNumbered(after, 'F1').replacedBy, null);
});

test('withdrawn messages can be read again', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | location | the village | #5'] }), stretch(1, 10));
    apply(log, storyOrder, answer({ FACTS: ['Halvard | location | the mansion | #50'] }), stretch(41, 60));
    ScribeLog.withdraw(log, 'MESSAGE-45');
    const { state, result } = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | location | the manor | #50'] }),
        stretch(41, 60),
    );
    assert.deepEqual(reasons(result), []);
    assert.equal(result.entry.sequence, 3);
    assert.deepEqual(
        plain(log.read),
        Object.fromEntries([...idsOf(1, 10).map((id) => [id, 1]), ...idsOf(41, 60).map((id) => [id, 3])]),
    );
    assert.deepEqual(statuses(state), [
        ['F1', 'the village', 'Replaced'],
        ['F3', 'the manor', 'InForce'],
    ]);
    assert.deepEqual(plain(ScribeLog.withdraw(log, 'MESSAGE-60')), idsOf(41, 60));
    assert.deepEqual(plain(log.entries.map((entry) => entry.withdrawn)), [false, true, true]);
});

test('withdrawing an unread message does nothing', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | location | the village | #5'] }), stretch(1, 10));
    apply(log, storyOrder, answer({ FACTS: ['Halvard | trait | proud | #20'] }), pick(20), 'Notes');
    rule(log, pin('S1', 'age', 'forty'));
    const before = plain(log);
    assert.equal(ScribeLog.withdraw(log, 'MESSAGE-30'), null);
    assert.deepEqual(plain(log), before);
    assert.equal(ScribeLog.withdraw(log, 'MESSAGE-20'), null);
    assert.deepEqual(plain(log), before);
    assert.equal(log.revision, 3);
    assert.deepEqual(plain(ScribeLog.withdraw(log, 'MESSAGE-5')), idsOf(1, 10));
    const withdrawn = plain(log);
    assert.equal(ScribeLog.withdraw(log, 'MESSAGE-5'), null);
    assert.deepEqual(plain(log), withdrawn);
});

test('rulings survive withdrawal and re-reading', () => {
    const log = ScribeLog.create();
    const lines = [
        'Halvard | age | twenty-five | #3',
        'Halvard | age | thirty | #5',
        'Aldrich | trait | wary | #4',
        'Aldric | trait | loud | #6',
        'Halvard | trait | proud | #7',
        'Halvard | background | charged a line of pikes | hidden | #8',
    ];
    const asked = ['Who rang the bell? | #9', 'Is the mill locked? | #9'];
    apply(log, storyOrder, answer({ FACTS: lines, QUESTIONS: asked }), stretch(1, 10));
    rule(log, pin('S1', 'age', 'thirty'));
    rule(log, { type: 'Merge', from: 'S2', into: 'S3' });
    rule(log, { type: 'RemoveFact', fact: 'F5' });
    rule(log, { type: 'Widen', fact: 'F6', to: 'Everyone' });
    rule(log, { type: 'Dismiss', question: 'Q2' });
    const { state } = rule(log, { type: 'Answer', question: 'Q1', text: 'the miller' });
    assert.equal(factNumbered(state, 'F2').pinned, true);
    assert.equal(factNumbered(state, 'F5').status, 'Removed');
    assert.equal(factNumbered(state, 'F6').widened, 'Everyone');
    assert.equal(state.questions[0].answer, 'the miller');
    assert.deepEqual(plain(ScribeLog.withdraw(log, 'MESSAGE-3')), idsOf(1, 10));
    const between = ScribeReplay.run(log, storyOrder);
    assert.deepEqual(plain(between.facts.map((fact) => [fact.id, fact.text, fact.status, fact.pinned, fact.origin])), [
        ['F7', 'thirty', 'InForce', true, 'Story'],
    ]);
    assert.equal(subjectLabelled(between, 'Aldrich').mergedInto, 'S3');
    const reread = apply(log, storyOrder, answer({ FACTS: lines, QUESTIONS: asked }), stretch(1, 10));
    assert.deepEqual(reasons(reread.result), []);
    assert.equal(plain(reread.result.entry.operations).find((operation) => operation.text === 'wary').subject, 'S3');
    assert.deepEqual(labels(reread.state), ['Halvard', 'Aldrich', 'Aldric']);
    /**
     * @param {object} fact
     * @return {Array<string|boolean|null>}
     */
    const shown = (fact) => [fact.id, fact.subject, fact.text, fact.status, fact.pinned, fact.widened];
    assert.deepEqual(
        plain(reread.state.facts.map(shown)),
        [
            ['F8', 'S1', 'twenty-five', 'Disputed', false, null],
            ['F10', 'S3', 'wary', 'InForce', false, null],
            ['F9', 'S1', 'thirty', 'InForce', true, null],
            ['F11', 'S3', 'loud', 'InForce', false, null],
            ['F12', 'S1', 'proud', 'Removed', false, null],
            ['F13', 'S1', 'charged a line of pikes', 'InForce', false, 'Everyone'],
        ],
    );
    assert.deepEqual(
        plain(reread.state.questions.map((question) => [question.id, question.answer, question.dismissed])),
        [
            ['Q3', 'the miller', false],
            ['Q4', null, true],
        ],
    );
    assert.deepEqual(plain(reread.state.conflicts), []);
    ScribeLog.withdraw(log, 'MESSAGE-7');
    const reworded = lines.map((line) => line.replace('| proud |', '| proud of his scars |'));
    const third = apply(log, storyOrder, answer({ FACTS: reworded, QUESTIONS: asked }), stretch(1, 10));
    assert.equal(factSaying(third.state, 'proud of his scars').status, 'InForce');
    assert.equal(factSaying(third.state, 'charged a line of pikes').widened, 'Everyone');
});

test('a stale state is refused everywhere', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | age | twenty-five | #1', 'Halvard | age | thirty | #2'] }),
        pick(1, 2),
    );
    const beforeRule = ScribeReplay.run(log, storyOrder);
    ScribeLog.rule(log, ScribeReplay.run(log, storyOrder), pin('S1', 'age', 'thirty'));
    assertStale(log, beforeRule);
    const beforeWithdraw = ScribeReplay.run(log, storyOrder);
    ScribeLog.withdraw(log, 'MESSAGE-1');
    assertStale(log, beforeWithdraw);
    const beforeAppend = ScribeReplay.run(log, storyOrder);
    ScribeLog.append(
        log,
        ScribeReplay.run(log, storyOrder),
        ScribeAnswer.parse(answer({ FACTS: ['Halvard | trait | proud | #3'] })).operations,
        { messages: pick(3), origin: 'Story' },
    );
    assertStale(log, beforeAppend);
    const fresh = ScribeReplay.run(log, storyOrder);
    assert.equal(fresh.revision, log.revision);
    assert.equal(fresh.revision, 4);
    ScribeLog.rule(log, fresh, pin('S1', 'age', 'forty'));
    assert.equal(log.revision, 5);
});

test('rule refuses what it cannot file', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character'],
            FACTS: ['Halvard | age | twenty-five | #1', 'Halvard | location | the mill | #2'],
            SCENES: ['Day 1 | #1-#2 | The mill | public | present: Halvard | He waits'],
            QUESTIONS: ['Who rang the bell? | #2'],
        }),
        pick(1, 2),
    );
    for (const operation of [{ type: 'Rumour' }, { type: 'toString' }, { type: 'constructor' }, { text: 'x' }, null]) {
        refuses(log, operation, 'UnknownOperation');
    }
    const pinned = pin('S1', 'age', 'thirty');
    const trait = {
        type: 'AddFact',
        subject: 'S1',
        category: 'trait',
        target: null,
        text: 'stern',
        hidden: false,
        cite: null,
        position: 0,
    };
    const split = { type: 'Split', subject: 'S1', label: 'Halvard (the younger)', kind: 'character', facts: ['F1'] };
    const invalid = [
        { ...pinned, target: 'S2' },
        { ...pinned, category: 'location' },
        { ...pinned, category: 'Age' },
        { ...pinned, text: ' ** ' },
        { ...pinned, hidden: 'no' },
        { type: 'Pin', subject: 'S1', category: 'age', text: 'thirty', hidden: false },
        { type: 'Pin', subject: 'S1', category: 'age', target: null, text: 'thirty' },
        { type: 'Widen', fact: 'F1', to: [] },
        { type: 'Widen', fact: 'F1', to: 'everyone' },
        { type: 'Widen', fact: 'F1', to: [7] },
        { ...trait, position: -1 },
        { ...trait, position: 1.5 },
        { ...trait, category: 'age' },
        { ...trait, target: 'S2' },
        { ...trait, hidden: 'no' },
        { ...trait, cite: 5 },
        { ...trait, category: 'relation' },
        { ...trait, category: 'mood' },
        { ...split, label: 'H'.repeat(61) },
        { ...split, label: '(( ))' },
        { ...split, kind: 'giant' },
        { ...split, facts: [] },
        { ...split, facts: ['F1', 'F1'] },
        { type: 'Merge', from: 'S1', into: 'S1' },
        { type: 'Merge', from: 'S1' },
        { type: 'Distinct', first: 'S2', second: 'S2' },
        { type: 'Narrow', scene: 1 },
        { type: 'RemoveFact', fact: null },
        { type: 'Unalias', subject: 'S1' },
        { type: 'Answer', question: 'Q1', text: '' },
        { type: 'Dismiss' },
        { ...pinned, subject: 'S99', category: 'location' },
    ];
    for (const operation of invalid) {
        refuses(log, operation, 'InvalidOperation');
    }
    const unknown = [
        { ...pinned, subject: 'S99' },
        { type: 'Merge', from: 'S99', into: 'S1' },
        { type: 'Merge', from: 'S1', into: 'S99' },
        { type: 'Distinct', first: 'S1', second: 'S99' },
        { ...split, subject: 'S99' },
        { ...split, facts: ['F99'] },
        { type: 'Widen', fact: 'F99', to: 'Everyone' },
        { type: 'Widen', fact: 'F1', to: ['S2', 'S99'] },
        { ...trait, subject: 'S99' },
        { ...trait, category: 'relation', target: 'S99' },
        { type: 'RemoveFact', fact: 'F99' },
        { type: 'Narrow', scene: 'MESSAGE-2' },
        { type: 'Unalias', subject: 'S99', name: 'Hal' },
        { type: 'Answer', question: 'Q9', text: 'nobody' },
        { type: 'Dismiss', question: 'Q9' },
    ];
    for (const operation of unknown) {
        refuses(log, operation, 'Reference');
    }
    assert.equal(log.entries.length, 1);
    assert.equal(log.revision, 1);
    const kept = rule(log, { ...split, label: 'H'.repeat(60) });
    assert.equal(kept.entry.operations[0].becomes, 'S3');
});

test('replay passes over rulings that point at nothing', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Aldric | character'],
            NAMES: ['Aldrich | Aldric | #2'],
            FACTS: ['Halvard | age | twenty-five | #1', 'Halvard | age | thirty | #2', 'Mirelle | trait | shy | #1'],
            SCENES: ['Day 1 | #1-#2 | The mill | public | present: Halvard, Mirelle | They talk'],
            QUESTIONS: ['Who rang the bell? | #2'],
        }),
        pick(1, 2),
    );
    const bare = plain(log);
    const rulings = [
        [pin('S1', 'age', 'thirty'), ['subject']],
        [{ type: 'Merge', from: 'S2', into: 'S1' }, ['into']],
        [
            { type: 'Split', subject: 'S1', label: 'Halvard (the younger)', kind: 'character', facts: ['F1'] },
            ['subject'],
        ],
        [{ type: 'Distinct', first: 'S1', second: 'S3' }, ['second']],
        [{ type: 'Narrow', scene: 'MESSAGE-1' }, ['scene']],
        [{ type: 'Widen', fact: 'F3', to: ['S3'] }, ['fact', 'mark']],
        [{ type: 'Widen', fact: 'F3', to: ['S3'] }, ['to']],
        [
            {
                type: 'AddFact',
                subject: 'S1',
                category: 'trait',
                target: null,
                text: 'stern',
                hidden: false,
                cite: null,
                position: 0,
            },
            ['subject'],
        ],
        [
            {
                type: 'AddFact',
                subject: 'S1',
                category: 'relation',
                target: 'S3',
                text: 'owes him',
                hidden: false,
                cite: null,
                position: 0,
            },
            ['target'],
        ],
        [{ type: 'RemoveFact', fact: 'F2' }, ['fact', 'mark']],
        [{ type: 'Unalias', subject: 'S3', name: 'Aldrich' }, ['subject']],
        [{ type: 'Answer', question: 'Q1', text: 'the miller' }, ['question', 'questionText']],
        [{ type: 'Dismiss', question: 'Q1' }, ['question', 'questionText']],
    ];
    for (const [operation] of rulings) {
        rule(log, operation);
    }
    const missing = {
        subject: 'S99',
        into: 'S99',
        second: 'S99',
        target: 'S99',
        scene: 'MESSAGE-999',
        fact: 'F99',
        mark: { subject: 'S99', category: 'trait', target: null, targetText: null, text: 'shy' },
        to: ['S99'],
        question: 'Q99',
        questionText: 'Who asked nothing?',
    };
    const without = unrevised(ScribeReplay.run(bare, storyOrder));
    const full = ScribeReplay.run(log, storyOrder);
    assert.notDeepEqual(unrevised(full), without);
    const edited = plain(log);
    for (const [index, [, fields]] of rulings.entries()) {
        const operation = edited.entries[index + 1].operations[0];
        assert.equal(operation.type, rulings[index][0].type);
        for (const field of fields) {
            operation[field] = missing[field];
        }
    }
    const before = plain(edited);
    const state = ScribeReplay.run(edited, storyOrder);
    assert.deepEqual(plain(edited), before);
    assert.deepEqual(unrevised(state), without);
    for (const [index, [, fields]] of rulings.entries()) {
        const single = plain(log);
        for (const field of fields) {
            single.entries[index + 1].operations[0][field] = missing[field];
        }
        assert.doesNotThrow(() => ScribeReplay.run(single, storyOrder), `${rulings[index][0].type} ${fields}`);
    }
});

test('a removed statement stays removed however it is made', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | eyes | grey | #3'] }), stretch(1, 10));
    const fuller = answer({ CHANGES: ['F1 | Halvard | eyes | FULLER: grey as slate | #15'] });
    apply(log, storyOrder, fuller, stretch(11, 20));
    const { state } = rule(log, { type: 'RemoveFact', fact: 'F2' });
    assert.deepEqual(statuses(state), [
        ['F1', 'grey', 'InForce'],
        ['F2', 'grey as slate', 'Removed'],
    ]);
    assert.deepEqual(plain(ScribeLog.withdraw(log, 'MESSAGE-15')), idsOf(11, 20));
    const reread = apply(log, storyOrder, fuller, stretch(11, 20));
    assert.deepEqual(statuses(reread.state), [
        ['F1', 'grey', 'InForce'],
        ['F3', 'grey as slate', 'Removed'],
    ]);
    assert.equal(factNumbered(reread.state, 'F1').replacedBy, null);
    assert.deepEqual(plain(reread.state.refinements), []);
    const changed = apply(
        log,
        storyOrder,
        answer({ CHANGES: ['F1 | Halvard | eyes | grey as slate | #25'] }),
        stretch(21, 30),
    );
    assert.deepEqual(statuses(changed.state), [
        ['F1', 'grey', 'InForce'],
        ['F3', 'grey as slate', 'Removed'],
        ['F4', 'grey as slate', 'Removed'],
    ]);
    const plainLine = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | eyes | Grey as slate. | #35', 'Halvard | eyes | grey | #36'] }),
        stretch(31, 40),
    );
    assert.deepEqual(statuses(plainLine.state), [
        ['F1', 'grey', 'InForce'],
        ['F3', 'grey as slate', 'Removed'],
        ['F4', 'grey as slate', 'Removed'],
        ['F5', 'Grey as slate.', 'Removed'],
    ]);
    assert.deepEqual(plain(plainLine.state.conflicts), []);
    const related = ScribeLog.create();
    apply(
        related,
        storyOrder,
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Tamsin | character'],
            FACTS: [
                'Halvard | relation to Mirelle | trusts her | #1',
                'Halvard | relation to Tamsin | trusts her | #1',
                'Halvard | relation to Brandt | owes him | #1',
            ],
        }),
        pick(1),
    );
    rule(related, { type: 'RemoveFact', fact: 'F1' });
    rule(related, { type: 'RemoveFact', fact: 'F3' });
    const again = apply(
        related,
        storyOrder,
        answer({
            FACTS: [
                'Halvard | relation to Mirelle | Trusts her. | #2',
                'Halvard | relation to brandt | Owes him. | #2',
                'Halvard | relation to Kira | owes him | #2',
            ],
        }),
        pick(2),
    );
    assert.deepEqual(statuses(again.state), [
        ['F1', 'trusts her', 'Removed'],
        ['F2', 'trusts her', 'InForce'],
        ['F3', 'owes him', 'Removed'],
        ['F4', 'Trusts her.', 'Removed'],
        ['F5', 'Owes him.', 'Removed'],
        ['F6', 'owes him', 'InForce'],
    ]);
    const added = rule(related, {
        type: 'AddFact',
        subject: 'S1',
        category: 'relation',
        target: 'S2',
        text: 'trusts her',
        hidden: false,
        cite: 'MESSAGE-3',
        position: 3,
    });
    assert.equal(factNumbered(added.state, added.entry.operations[0].fact).status, 'InForce');
});

test('a pin keeps a hidden value hidden', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | age | thirty | hidden | #3', 'Halvard | age | forty | #5'] }),
        stretch(1, 10),
    );
    apply(log, storyOrder, answer({ TOLD: ['F1 | Halvard | Kira | #12'] }), stretch(11, 20));
    const { entry, state } = rule(log, pin('S1', 'age', 'thirty'));
    const stored = plain(entry.operations[0]);
    assert.deepEqual([stored.hidden, stored.winner, stored.told, stored.fact], [true, 'F1', ['S2'], 'F3']);
    /**
     * @param {object} replayed
     * @param {string} id
     * @return {void}
     */
    const assertHidden = (replayed, id) => {
        const standing = replayed.facts.filter((fact) => fact.pinned);
        assert.deepEqual(
            plain(standing.map((fact) => [fact.id, fact.text, fact.status, fact.hidden, fact.told])),
            [[id, 'thirty', 'InForce', true, ['S2']]],
        );
        assert.equal(
            replayed.facts.some((fact) => fact.text === 'thirty' && fact.status === 'InForce' && !fact.hidden),
            false,
        );
        assert.deepEqual(plain(replayed.conflicts), []);
    };
    assertHidden(state, 'F1');
    const changed = plain(log);
    apply(changed, storyOrder, answer({ CHANGES: ['F1 | Halvard | age | fifty | #25'] }), stretch(21, 30));
    assertHidden(ScribeReplay.run(changed, storyOrder), 'F3');
    const ended = plain(log);
    apply(ended, storyOrder, answer({ CHANGES: ['F1 | Halvard | age | ENDED | #25'] }), stretch(21, 30));
    assertHidden(ScribeReplay.run(ended, storyOrder), 'F3');
    const withdrawn = plain(log);
    ScribeLog.withdraw(withdrawn, 'MESSAGE-3');
    assertHidden(ScribeReplay.run(withdrawn, storyOrder), 'F3');
    const removed = plain(log);
    const struck = rule(removed, { type: 'RemoveFact', fact: 'F1' });
    assert.equal(factNumbered(struck.state, 'F1').status, 'Removed');
    assertHidden(struck.state, 'F3');
});

test('a pin holds the fuller wording', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | eyes | grey | #1', 'Halvard | eyes | blue | #2'] }), pick(1, 2));
    const [kept] = ScribeLog.keepFirst(log, ScribeReplay.run(log, storyOrder));
    assert.deepEqual([kept.operations[0].text, kept.operations[0].winner], ['grey', 'F1']);
    const { state } = apply(
        log,
        storyOrder,
        answer({ CHANGES: ['F1 | Halvard | eyes | FULLER: grey as slate | #5'] }),
        pick(5),
    );
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.text, fact.status, fact.pinned])), [
        ['F1', 'grey', 'Replaced', false],
        ['F2', 'blue', 'Disputed', false],
        ['F4', 'grey as slate', 'InForce', true],
    ]);
    assert.deepEqual(plain(state.conflicts), []);
});

test('a pin can set a hidden value nobody said', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | age | twenty-five | #1', 'Halvard | age | thirty | #2'] }),
        pick(1, 2),
    );
    const { state } = rule(log, pin('S1', 'age', 'fifty', true));
    const made = factNumbered(state, 'F3');
    assert.deepEqual([made.text, made.hidden, made.status, made.pinned, made.origin], [
        'fifty',
        true,
        'InForce',
        true,
        'Operator',
    ]);
    refuses(log, { type: 'Pin', subject: 'S1', category: 'age', target: null, text: 'sixty' }, 'InvalidOperation');
    refuses(log, { ...pin('S1', 'age', 'sixty'), hidden: 'yes' }, 'InvalidOperation');
    refuses(log, { ...pin('S1', 'age', 'sixty'), hidden: null }, 'InvalidOperation');
});

test('pinning again can hide a value the owner made', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | age | twenty-five | #1', 'Halvard | age | thirty | #2'] }),
        pick(1, 2),
    );
    const first = rule(log, pin('S1', 'age', 'forty', false));
    assert.equal(factNumbered(first.state, 'F3').hidden, false);
    const second = rule(log, pin('S1', 'age', 'forty', true));
    const stored = plain(second.entry.operations[0]);
    assert.deepEqual([stored.winner, stored.hidden, stored.told, stored.fact], [null, true, [], 'F4']);
    const standing = second.state.facts.filter((fact) => fact.pinned && fact.status === 'InForce');
    assert.deepEqual(plain(standing.map((fact) => [fact.id, fact.text, fact.hidden, fact.origin])), [
        ['F4', 'forty', true, 'Operator'],
    ]);
    assert.equal(second.state.facts.some((fact) => fact.text === 'forty' && !fact.hidden), false);
});

test('keep the first keeps that very fact', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | age | thirty | #1', 'Halvard | age | forty | hidden | #2'] }),
        pick(1, 2),
    );
    const { state } = apply(log, storyOrder, answer({ CHANGES: ['F1 | Halvard | age | forty | #3'] }), pick(3));
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.text, fact.status, fact.hidden])), [
        ['F1', 'thirty', 'Replaced', false],
        ['F2', 'forty', 'Disputed', true],
        ['F3', 'forty', 'InForce', false],
    ]);
    assert.deepEqual(plain(state.conflicts), [
        { subject: 'S1', category: 'age', target: null, established: 'F3', others: ['F2'] },
    ]);
    const [kept] = ScribeLog.keepFirst(log, state);
    assert.deepEqual([kept.operations[0].winner, kept.operations[0].hidden], ['F3', false]);
    const after = ScribeReplay.run(log, storyOrder);
    assert.deepEqual(plain(after.facts.map((fact) => [fact.id, fact.status, fact.pinned])), [
        ['F1', 'Replaced', false],
        ['F2', 'Disputed', false],
        ['F3', 'InForce', true],
    ]);
    assert.deepEqual(plain(after.conflicts), []);
});

test('a fact a pin made cannot be named', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | age | twenty-five | #1', 'Halvard | age | thirty | #2'] }),
        pick(1, 2),
    );
    rule(log, pin('S1', 'age', 'forty'));
    const before = plain(log);
    const { result, state } = apply(
        log,
        storyOrder,
        answer({
            CHANGES: [
                'F3 | Halvard | age | FULLER: forty or so | #5',
                'F3 | Halvard | age | fifty | #5',
                'F3 | Halvard | age | ENDED | #5',
            ],
            TOLD: ['F3 | Halvard | Kira | #5'],
        }),
        pick(5),
    );
    assert.deepEqual(reasons(result), ['Reference', 'Reference', 'Reference', 'Reference']);
    assert.deepEqual(plain(result.entry.operations), []);
    assert.deepEqual(labels(state), ['Halvard']);
    assert.equal(factNumbered(state, 'F3').status, 'InForce');
    assert.equal(log.entries.length, before.entries.length + 1);
    refuses(log, { type: 'Widen', fact: 'F3', to: 'Everyone' }, 'InvalidOperation');
    refuses(log, { type: 'RemoveFact', fact: 'F3' }, 'InvalidOperation');
    refuses(
        log,
        { type: 'Split', subject: 'S1', label: 'Halvard (the younger)', kind: 'character', facts: ['F3'] },
        'InvalidOperation',
    );
    rule(log, pin('S1', 'age', 'twenty-five'));
    const named = rule(log, { type: 'Widen', fact: 'F1', to: 'Everyone' });
    assert.equal(factNumbered(named.state, 'F1').pinned, true);
    const told = apply(log, storyOrder, answer({ TOLD: ['F1 | Halvard | Kira | #6'] }), pick(6));
    assert.deepEqual(reasons(told.result), []);
});

test('a pin is not reopened by the story', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | age | thirty | hidden | #3', 'Halvard | age | forty | #5'] }),
        stretch(1, 10),
    );
    rule(log, pin('S1', 'age', 'thirty'));
    const changed = plain(log);
    const change = apply(
        changed,
        storyOrder,
        answer({ CHANGES: ['F1 | Halvard | age | fifty | #25'] }),
        stretch(21, 30),
    );
    assert.deepEqual(
        plain(change.state.facts.map((fact) => [fact.id, fact.text, fact.status, fact.pinned, fact.hidden])),
        [
            ['F1', 'thirty', 'Replaced', false, true],
            ['F2', 'forty', 'Disputed', false, false],
            ['F4', 'fifty', 'Disputed', false, true],
            ['F3', 'thirty', 'InForce', true, true],
        ],
    );
    assert.deepEqual(plain(change.state.conflicts), []);
    const moved = rule(changed, pin('S1', 'age', 'fifty'));
    assert.deepEqual(plain(moved.state.facts.map((fact) => [fact.id, fact.status, fact.pinned])), [
        ['F1', 'Replaced', false],
        ['F2', 'Disputed', false],
        ['F4', 'InForce', true],
    ]);
    assert.deepEqual(plain(moved.state.conflicts), []);
    const ended = plain(log);
    const end = apply(ended, storyOrder, answer({ CHANGES: ['F1 | Halvard | age | ENDED | #25'] }), stretch(21, 30));
    assert.deepEqual(
        plain(end.state.facts.map((fact) => [fact.id, fact.text, fact.status, fact.pinned, fact.hidden])),
        [
            ['F1', 'thirty', 'Ended', false, true],
            ['F2', 'forty', 'Disputed', false, false],
            ['F3', 'thirty', 'InForce', true, true],
        ],
    );
    assert.deepEqual(plain(end.state.conflicts), []);
});

test('a pin made from a story value keeps where it was said', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | age | forty | #20', 'Halvard | age | fifty | #22'] }),
        pick(20, 22),
    );
    apply(
        log,
        storyOrder,
        answer({ SCENES: ['Day 1 | #1-#40 | The hall | private | present: Halvard, Isolde | They talk'] }),
        stretch(1, 40).filter((message) => message.position !== 20 && message.position !== 22),
    );
    const [kept] = ScribeLog.keepFirst(log, ScribeReplay.run(log, storyOrder));
    const stored = plain(kept.operations[0]);
    assert.deepEqual(
        [stored.winner, stored.origin, stored.cite, stored.position],
        ['F1', 'Story', 'MESSAGE-20', 20],
    );
    const { state } = apply(
        log,
        storyOrder,
        answer({
            CHANGES: ['F1 | Halvard | age | forty-one | #55'],
            SCENES: ['Day 2 | #50-#60 | The cellar | private | present: Halvard | He broods'],
        }),
        stretch(41, 80),
    );
    assert.deepEqual(statuses(state), [
        ['F1', 'forty', 'Replaced'],
        ['F2', 'fifty', 'Disputed'],
        ['F4', 'forty-one', 'Disputed'],
        ['F3', 'forty', 'InForce'],
    ]);
    const halvard = subjectLabelled(state, 'Halvard').id;
    const isolde = subjectLabelled(state, 'Isolde').id;
    /**
     * @param {object} replayed
     * @param {number} position
     * @return {void}
     */
    const assertSaid = (replayed, position) => {
        const made = factNumbered(replayed, stored.fact);
        assert.deepEqual(
            plain([made.text, made.origin, made.cite, made.position, made.made, made.pinned, made.status]),
            ['forty', 'Story', 'MESSAGE-20', position, true, true, 'InForce'],
        );
        assert.deepEqual(plain(ScribeKnowledge.audience(replayed, made)), [halvard, isolde]);
    };
    assertSaid(state, 20);
    assertSaid(
        ScribeReplay.run(
            log,
            storyOrder.filter((id) => id !== 'MESSAGE-10'),
        ),
        19,
    );
    const withdrawn = plain(log);
    ScribeLog.withdraw(withdrawn, 'MESSAGE-20');
    const away = ScribeReplay.run(withdrawn, storyOrder);
    assert.equal(away.facts.some((fact) => fact.id === 'F1'), false);
    assertSaid(away, 20);
    const missing = ScribeReplay.run(
        log,
        storyOrder.filter((id) => id !== 'MESSAGE-20'),
    );
    assert.equal(missing.facts.some((fact) => fact.id === 'F1'), false);
    assertSaid(missing, 20);
});

test("a pin of a value nobody said is the owner's", () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            FACTS: ['Halvard | age | forty | #20', 'Halvard | age | fifty | #22'],
            SCENES: ['Day 1 | #1-#40 | The hall | private | present: Halvard, Isolde | They talk'],
        }),
        stretch(1, 40),
    );
    const { entry, state } = rule(log, pin('S1', 'age', 'sixty'));
    const stored = plain(entry.operations[0]);
    assert.deepEqual([stored.winner, stored.origin, stored.cite, stored.position], [null, 'Operator', null, 0]);
    const made = factNumbered(state, stored.fact);
    assert.deepEqual(
        plain([made.text, made.origin, made.cite, made.position, made.made, made.pinned, made.status]),
        ['sixty', 'Operator', null, 0, true, true, 'InForce'],
    );
    assert.equal(ScribeKnowledge.audience(state, made), 'Everyone');
    const legacy = plain(log);
    const saved = legacy.entries.at(-1).operations[0];
    delete saved.origin;
    delete saved.cite;
    delete saved.position;
    const replayed = factNumbered(ScribeReplay.run(legacy, storyOrder), stored.fact);
    assert.deepEqual(
        plain([replayed.origin, replayed.cite, replayed.position, replayed.made, replayed.status]),
        ['Operator', null, 0, true, 'InForce'],
    );
});

test('only a made fact is refused by name', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            FACTS: [
                'Halvard | age | forty | #2',
                'Halvard | age | fifty | #3',
                'Mirelle | eyes | grey | #2',
                'Mirelle | eyes | blue | #3',
            ],
        }),
        pick(2, 3),
    );
    const kept = ScribeLog.keepFirst(log, ScribeReplay.run(log, storyOrder));
    assert.deepEqual(plain(kept.map((item) => [item.operations[0].fact, item.operations[0].winner])), [
        ['F5', 'F1'],
        ['F6', 'F3'],
    ]);
    apply(log, storyOrder, answer({ CHANGES: ['F1 | Halvard | age | forty-one | #5'] }), pick(5));
    const added = rule(log, {
        type: 'AddFact',
        subject: 'S1',
        category: 'trait',
        target: null,
        text: 'stern',
        hidden: false,
        cite: null,
        position: 0,
    });
    assert.equal(added.entry.operations[0].fact, 'F8');
    const made = factNumbered(added.state, 'F5');
    assert.deepEqual(plain([made.origin, made.made, made.pinned]), ['Story', true, true]);
    assert.deepEqual(plain([factNumbered(added.state, 'F3').pinned, factNumbered(added.state, 'F8').origin]), [
        true,
        'Operator',
    ]);
    assert.equal(
        added.state.facts.every((fact) => typeof fact.made === 'boolean'),
        true,
    );
    assert.deepEqual(plain(added.state.facts.filter((fact) => fact.made).map((fact) => fact.id)), ['F5']);
    const refused = apply(
        log,
        storyOrder,
        answer({
            CHANGES: ['F5 | Halvard | age | FULLER: forty or so | #6', 'F5 | Halvard | age | ENDED | #6'],
            TOLD: ['F5 | Halvard | Kira | #6'],
        }),
        pick(6),
    );
    assert.deepEqual(reasons(refused.result), ['Reference', 'Reference', 'Reference']);
    assert.deepEqual(plain(refused.result.entry.operations), []);
    const accepted = apply(
        log,
        storyOrder,
        answer({ TOLD: ['F3 | Mirelle | Kira | #7', 'F8 | Halvard | Kira | #7'] }),
        pick(7),
    );
    assert.deepEqual(reasons(accepted.result), []);
    const kira = subjectLabelled(accepted.state, 'Kira').id;
    assert.deepEqual(plain([factNumbered(accepted.state, 'F3').told, factNumbered(accepted.state, 'F8').told]), [
        [kira],
        [kira],
    ]);
    refuses(log, { type: 'Widen', fact: 'F5', to: 'Everyone' }, 'InvalidOperation');
    refuses(log, { type: 'RemoveFact', fact: 'F5' }, 'InvalidOperation');
    refuses(
        log,
        { type: 'Split', subject: 'S1', label: 'Halvard (the younger)', kind: 'character', facts: ['F5'] },
        'InvalidOperation',
    );
    const widened = rule(log, { type: 'Widen', fact: 'F8', to: 'Everyone' });
    assert.equal(factNumbered(widened.state, 'F8').widened, 'Everyone');
    const again = rule(log, pin('S1', 'age', 'forty'));
    assert.equal(again.entry.operations[0].winner, null);
});

test('re-pinning a made value keeps where it was said', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | age | forty | #20', 'Halvard | age | fifty | #22'] }),
        pick(20, 22),
    );
    apply(
        log,
        storyOrder,
        answer({ SCENES: ['Day 1 | #1-#40 | The hall | private | present: Halvard, Isolde | They talk'] }),
        stretch(1, 40).filter((message) => message.position !== 20 && message.position !== 22),
    );
    apply(log, storyOrder, answer({ TOLD: ['F1 | Halvard | Kira | #45'] }), pick(45));
    ScribeLog.keepFirst(log, ScribeReplay.run(log, storyOrder));
    const changed = apply(log, storyOrder, answer({ CHANGES: ['F1 | Halvard | age | forty-one | #55'] }), pick(55));
    const kira = subjectLabelled(changed.state, 'Kira').id;
    const first = factNumbered(changed.state, 'F3');
    assert.deepEqual(plain([first.origin, first.cite, first.position, first.hidden, first.made]), [
        'Story',
        'MESSAGE-20',
        20,
        false,
        true,
    ]);
    const { entry, state } = rule(log, pin('S1', 'age', 'forty', true));
    const stored = plain(entry.operations[0]);
    assert.deepEqual(
        [stored.winner, stored.hidden, stored.told, stored.origin, stored.cite, stored.position],
        [null, true, [kira], 'Story', 'MESSAGE-20', 20],
    );
    const made = factNumbered(state, stored.fact);
    assert.deepEqual(
        plain([made.text, made.origin, made.cite, made.position, made.hidden, made.told, made.made, made.status]),
        ['forty', 'Story', 'MESSAGE-20', 20, true, [kira], true, 'InForce'],
    );
    assert.equal(
        state.facts.some((fact) => fact.text === 'forty' && fact.status === 'InForce' && !fact.hidden),
        false,
    );
    assert.deepEqual(plain(ScribeKnowledge.audience(state, made)), ['S1', kira]);
    const other = rule(log, pin('S1', 'age', 'sixty', true));
    const owned = plain(other.entry.operations[0]);
    assert.deepEqual(
        [owned.winner, owned.told, owned.origin, owned.cite, owned.position],
        [null, [], 'Operator', null, 0],
    );
});

test('a ruling can be revoked', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Aldrich | character', 'Aldric | character'],
            FACTS: [
                'Aldrich | trait | wary | #1',
                'Aldric | trait | loud | #1',
                'Halvard | age | twenty-five | #1',
                'Halvard | age | thirty | #2',
                'Oswin | trait | quiet | #1',
            ],
        }),
        pick(1, 2),
    );
    const merge = rule(log, { type: 'Merge', from: 'S1', into: 'S2' }).entry;
    rule(log, pin('S3', 'age', 'thirty'));
    const pinned = log.entries.at(-1);
    const split = rule(log, {
        type: 'Split',
        subject: 'S4',
        label: 'Oswin (the miller)',
        kind: 'character',
        facts: ['F5'],
    }).entry;
    const ruled = ScribeReplay.run(log, storyOrder);
    assert.equal(subjectLabelled(ruled, 'Aldrich').mergedInto, 'S2');
    assert.deepEqual(plain(ruled.conflicts), []);
    assert.equal(factNumbered(ruled, 'F5').subject, 'S5');
    const revision = log.revision;
    assert.equal(ScribeLog.revoke(log, merge.sequence), merge);
    assert.equal(merge.withdrawn, true);
    assert.equal(log.revision, revision + 1);
    const apart = ScribeReplay.run(log, storyOrder);
    const pair = apart.subjects.slice(0, 2);
    assert.deepEqual(plain(pair.map((subject) => [subject.id, subject.mergedInto, subject.aka])), [
        ['S1', null, []],
        ['S2', null, []],
    ]);
    assert.deepEqual(plain([factNumbered(apart, 'F1').subject, factNumbered(apart, 'F2').subject]), ['S1', 'S2']);
    const later = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Aldrich | trait | stubborn | #5', 'Aldric | trait | calm | #5'] }),
        pick(5),
    );
    assert.deepEqual(
        plain(later.result.entry.operations.map((operation) => [operation.type, operation.subject])),
        [
            ['Fact', 'S1'],
            ['Fact', 'S2'],
        ],
    );
    ScribeLog.revoke(log, pinned.sequence);
    const unpinned = ScribeReplay.run(log, storyOrder);
    assert.deepEqual(plain(unpinned.conflicts), [
        { subject: 'S3', category: 'age', target: null, established: 'F3', others: ['F4'] },
    ]);
    ScribeLog.revoke(log, split.sequence);
    const unsplit = ScribeReplay.run(log, storyOrder);
    assert.equal(subjectLabelled(unsplit, 'Oswin (the miller)').id, 'S5');
    assert.deepEqual(plain(unsplit.facts.filter((fact) => fact.subject === 'S5')), []);
    assert.equal(factNumbered(unsplit, 'F5').subject, 'S4');
    const settled = plain(log);
    for (const sequence of [1, 99, merge.sequence, split.sequence]) {
        assert.equal(ScribeLog.revoke(log, sequence), null);
        assert.deepEqual(plain(log), settled);
    }
});

test('a merged-away subject cannot be merged again', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Aldrich | character', 'Aldric | character', 'Kira | character', 'Halvard | character'],
            NAMES: ['Kiri | Kira | #1'],
            FACTS: [
                'Aldrich | trait | wary | #1',
                'Aldric | trait | loud | #1',
                'Kira | trait | quick | #1',
                'Halvard | trait | brave | #1',
                'Halvard | age | thirty | #1',
            ],
        }),
        pick(1),
    );
    const first = rule(log, { type: 'Merge', from: 'S1', into: 'S2' }).entry;
    refuses(log, { type: 'Merge', from: 'S1', into: 'S3' }, 'InvalidOperation');
    ScribeLog.revoke(log, first.sequence);
    const second = rule(log, { type: 'Merge', from: 'S1', into: 'S3' });
    /**
     * @param {object} replayed
     * @return {Array<[string, string]>}
     */
    const owners = (replayed) => plain(replayed.facts.map((fact) => [fact.id, fact.subject]));
    assert.deepEqual(owners(second.state), [
        ['F1', 'S3'],
        ['F2', 'S2'],
        ['F3', 'S3'],
        ['F4', 'S4'],
        ['F5', 'S4'],
    ]);
    const both = plain(log);
    both.entries[1].withdrawn = false;
    const earlier = ScribeReplay.run(both, storyOrder);
    assert.equal(subjectLabelled(earlier, 'Aldrich').mergedInto, 'S2');
    assert.equal(factNumbered(earlier, 'F1').subject, 'S2');
    assert.equal(subjectLabelled(earlier, 'Kira').mergedInto, null);
    const onto = rule(log, { type: 'Merge', from: 'S4', into: 'S1' });
    assert.equal(subjectLabelled(onto.state, 'Halvard').mergedInto, 'S3');
    assert.deepEqual(owners(onto.state), [
        ['F1', 'S3'],
        ['F2', 'S2'],
        ['F3', 'S3'],
        ['F4', 'S3'],
        ['F5', 'S3'],
    ]);
    const picked = rule(log, pin('S1', 'age', 'thirty'));
    assert.equal(picked.entry.operations[0].winner, 'F5');
    assert.equal(factNumbered(picked.state, 'F5').pinned, true);
    const made = rule(log, pin('S4', 'eyes', 'grey'));
    assert.equal(factNumbered(made.state, made.entry.operations[0].fact).subject, 'S3');
    const split = rule(log, {
        type: 'Split',
        subject: 'S4',
        label: 'Halvard (the younger)',
        kind: 'character',
        facts: ['F4'],
    });
    assert.equal(factNumbered(split.state, 'F4').subject, split.entry.operations[0].becomes);
    assert.deepEqual(plain(split.state.distinct), []);
    const unaliased = rule(log, { type: 'Unalias', subject: 'S1', name: 'Kiri' });
    assert.deepEqual(plain(unaliased.state.aliases), []);
    assert.deepEqual(plain(unaliased.state.unaliased), [{ subject: 'S3', name: 'Kiri' }]);
});

test('a merged label still finds its subject as a label', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Oswin | character', 'Oswin (the miller) | character', "Oswin (Tamsin's uncle) | character"],
            FACTS: ['Oswin (the miller) | trait | quiet | #1', "Oswin (Tamsin's uncle) | trait | loud | #1"],
        }),
        pick(1),
    );
    rule(log, { type: 'Merge', from: 'S1', into: 'S2' });
    const { state, result } = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Oswin | trait | stern | #5'], CHANGES: ['F2 | Oswin | trait | ENDED: calmer | #5'] }),
        pick(5),
    );
    assert.deepEqual(reasons(result), ['Mismatch']);
    assert.equal(factSaying(state, 'stern').subject, 'S2');
    assert.equal(factNumbered(state, 'F2').status, 'InForce');
    assert.equal(state.subjects.length, 3);
});

test('an unalias binds later answers', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ SUBJECTS: ['Aldric | character'], NAMES: ['Aldrich | Aldric | #2'] }), pick(2));
    const { state } = rule(log, { type: 'Unalias', subject: 'S1', name: 'Aldrich' });
    assert.deepEqual(plain(state.unaliased), [{ subject: 'S1', name: 'Aldrich' }]);
    const later = apply(
        log,
        storyOrder,
        answer({ NAMES: ['Aldrich | Aldric | #9'], FACTS: ['Aldrich | trait | sly | #9'] }),
        pick(9),
    );
    assert.deepEqual(reasons(later.result), ['Ruled']);
    assert.deepEqual(labels(later.state), ['Aldric', 'Aldrich']);
    assert.equal(factSaying(later.state, 'sly').subject, 'S2');
    assert.deepEqual(plain(subjectLabelled(later.state, 'Aldric').aka), []);
    assert.deepEqual(plain(later.state.aliases), []);
    const next = apply(log, storyOrder, answer({ FACTS: ['Aldrich | trait | quick | #10'] }), pick(10));
    assert.equal(factSaying(next.state, 'quick').subject, 'S2');
    assert.deepEqual(labels(next.state), ['Aldric', 'Aldrich']);
    assert.deepEqual(plain(next.state.unaliased), [{ subject: 'S1', name: 'Aldrich' }]);
});

test('a distinct pair is not joined by an alias', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ SUBJECTS: ['Halvard | character', 'Brandt | character'] }), pick(1));
    const { state } = rule(log, { type: 'Distinct', first: 'S1', second: 'S2' });
    assert.deepEqual(plain(state.distinct), [{ first: 'S1', second: 'S2' }]);
    const later = apply(
        log,
        storyOrder,
        answer({ NAMES: ['Brandt | Halvard | #3', 'Halvard | Brandt | #3'] }),
        pick(3),
    );
    assert.deepEqual(reasons(later.result), ['Ruled', 'Ruled']);
    assert.deepEqual(plain(later.state.subjects.map((subject) => subject.aka)), [[], []]);
    assert.deepEqual(plain(later.state.aliases), []);
    assert.deepEqual(plain(later.state.lookAlikes), []);
    const merging = ScribeLog.create();
    apply(
        merging,
        storyOrder,
        answer({ SUBJECTS: ['Halvard | character', 'Brandt | character', 'Kira | character'] }),
        pick(1),
    );
    rule(merging, { type: 'Distinct', first: 'S3', second: 'S2' });
    const merged = rule(merging, { type: 'Merge', from: 'S3', into: 'S1' });
    assert.deepEqual(plain(merged.state.distinct), [{ first: 'S1', second: 'S2' }]);
    const joined = apply(merging, storyOrder, answer({ NAMES: ['Brandt | Halvard | #3'] }), pick(3));
    assert.deepEqual(reasons(joined.result), ['Ruled']);
});

test("the owner's word comes last on a message", () => {
    const log = ScribeLog.create();
    const storyLine = answer({ FACTS: ['Halvard | location | the mill | #30'] });
    apply(log, storyOrder, storyLine, stretch(21, 40));
    const { state } = rule(log, {
        type: 'AddFact',
        subject: 'S1',
        category: 'location',
        target: null,
        text: 'the inn',
        hidden: false,
        cite: 'MESSAGE-30',
        position: 30,
    });
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.text, fact.status, fact.replacedBy])), [
        ['F1', 'the mill', 'Replaced', 'F2'],
        ['F2', 'the inn', 'InForce', null],
    ]);
    assert.deepEqual(plain(ScribeLog.withdraw(log, 'MESSAGE-30')), idsOf(21, 40));
    const reread = apply(log, storyOrder, storyLine, stretch(21, 40));
    assert.deepEqual(plain(reread.state.facts.map((fact) => [fact.id, fact.text, fact.status, fact.replacedBy])), [
        ['F3', 'the mill', 'Replaced', 'F2'],
        ['F2', 'the inn', 'InForce', null],
    ]);
});

test('adding what is already in force is refused', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Tamsin | character'],
            FACTS: [
                'Halvard | trait | stubborn | #1',
                'Halvard | relation to Mirelle | trusts her | #1',
                'Halvard | location | the mill | #1',
                'Halvard | location | the inn | #2',
            ],
        }),
        pick(1, 2),
    );
    const trait = {
        type: 'AddFact',
        subject: 'S1',
        category: 'trait',
        target: null,
        text: 'Stubborn.',
        hidden: false,
        cite: null,
        position: 0,
    };
    refuses(log, trait, 'InvalidOperation');
    const relation = { ...trait, category: 'relation', target: 'S2', text: 'Trusts her' };
    refuses(log, relation, 'InvalidOperation');
    const mill = rule(log, { ...trait, category: 'location', text: 'the mill', cite: 'MESSAGE-3', position: 3 });
    assert.equal(factNumbered(mill.state, mill.entry.operations[0].fact).status, 'InForce');
    const fuller = rule(log, { ...trait, text: 'stubborn as a mule' });
    assert.equal(factNumbered(fuller.state, fuller.entry.operations[0].fact).status, 'InForce');
    const other = rule(log, { ...relation, target: 'S3' });
    assert.equal(factNumbered(other.state, other.entry.operations[0].fact).status, 'InForce');
});

test('removed facts cannot be named', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | trait | proud | #1', 'Halvard | trait | calm | #1'] }), pick(1));
    rule(log, { type: 'RemoveFact', fact: 'F1' });
    refuses(log, { type: 'Widen', fact: 'F1', to: 'Everyone' }, 'InvalidOperation');
    refuses(log, { type: 'RemoveFact', fact: 'F1' }, 'InvalidOperation');
    refuses(
        log,
        { type: 'Split', subject: 'S1', label: 'Halvard (the younger)', kind: 'character', facts: ['F1'] },
        'InvalidOperation',
    );
    const { state, result } = apply(
        log,
        storyOrder,
        answer({ TOLD: ['F1 | Halvard | Kira | #3'], CHANGES: ['F1 | Halvard | trait | ENDED | #3'] }),
        pick(3),
    );
    assert.deepEqual(reasons(result), ['Reference', 'Reference']);
    assert.deepEqual(labels(state), ['Halvard']);
    assert.equal(factNumbered(state, 'F1').status, 'Removed');
    const named = rule(log, { type: 'Widen', fact: 'F2', to: 'Everyone' });
    assert.equal(factNumbered(named.state, 'F2').widened, 'Everyone');
});

test('lists are checked entry by entry', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character'],
            FACTS: ['Halvard | trait | proud | #1', 'Halvard | trait | calm | #1'],
        }),
        pick(1),
    );
    const holed = [];
    holed[0] = 'S2';
    holed[2] = 'S1';
    const holedFacts = [];
    holedFacts[0] = 'F1';
    holedFacts[2] = 'F2';
    const split = { type: 'Split', subject: 'S1', label: 'Halvard (the younger)', kind: 'character' };
    for (const operation of [
        { type: 'Widen', fact: 'F1', to: holed },
        { type: 'Widen', fact: 'F1', to: ['S2', 5] },
        { type: 'Widen', fact: 'F1', to: ['S2', 'S2'] },
        { ...split, facts: holedFacts },
        { ...split, facts: ['F1', 7] },
    ]) {
        refuses(log, operation, 'InvalidOperation');
    }
    assert.equal(log.entries.length, 1);
    const widened = rule(log, { type: 'Widen', fact: 'F1', to: ['S2', 'S1'] });
    assert.deepEqual(plain(factNumbered(widened.state, 'F1').widened), ['S2', 'S1']);
});

test('a pin reads the subject as it stands', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Aldrich | character', 'Aldric | character'],
            FACTS: [
                'Aldric | age | forty | #1',
                'Corvane | kind | place | #1',
                'Corvane | kind | group | #2',
                'Halvard | age | thirty | #1',
            ],
        }),
        pick(1, 2),
    );
    rule(log, { type: 'Merge', from: 'S1', into: 'S2' });
    const picked = rule(log, pin('S1', 'age', 'forty'));
    assert.equal(picked.entry.operations[0].winner, 'F1');
    assert.deepEqual(plain(picked.state.facts.filter((fact) => fact.pinned).map((fact) => fact.id)), ['F1']);
    const made = rule(log, pin('S1', 'eyes', 'grey'));
    const grey = factNumbered(made.state, made.entry.operations[0].fact);
    assert.deepEqual([grey.subject, grey.status, grey.pinned], ['S2', 'InForce', true]);
    const corvane = subjectLabelled(made.state, 'Corvane');
    assert.deepEqual([corvane.kind, corvane.assumed], ['place', true]);
    const kind = rule(log, pin(corvane.id, 'kind', 'giant'));
    assert.deepEqual(plain(slotOf(kind.state, 'Corvane', 'kind').map((fact) => [fact.text, fact.status])), [
        ['place', 'Disputed'],
        ['group', 'Disputed'],
        ['giant', 'InForce'],
    ]);
    assert.deepEqual(
        [subjectLabelled(kind.state, 'Corvane').kind, subjectLabelled(kind.state, 'Corvane').assumed],
        ['character', true],
    );
    apply(log, storyOrder, answer({ CHANGES: ['F4 | Halvard | age | fifty | #5'] }), pick(5));
    const replaced = rule(log, pin('S4', 'age', 'thirty'));
    assert.equal(replaced.entry.operations[0].winner, null);
    const ages = slotOf(replaced.state, 'Halvard', 'age');
    assert.deepEqual(plain(ages.map((fact) => [fact.text, fact.status, fact.pinned])), [
        ['thirty', 'Replaced', false],
        ['fifty', 'Disputed', false],
        ['thirty', 'InForce', true],
    ]);
});

test('wording edits retain the same fact and provenance through rereading and independent revocation', () => {
    const log = ScribeLog.create();
    const original = 'offers 100,000 gold';
    const wording = answer({ SUBJECTS: ['Crown | group', 'Mirra | character', 'Oren | character'],
        FACTS: ['Crown | relation to Mirra | ' + original + ' | hidden | #1',
            'Crown | relation to Oren | offers 50,000 gold | #2'] });
    apply(log, storyOrder, wording, stretch(1, 3));
    const prints = new Map(story.map((message) => [message.id, message.fingerprint]));
    const replay = () => ScribeReplay.run(JSON.parse(JSON.stringify(log)), storyOrder, null, prints);
    const edit = (fact, text) => {
        const before = replay();
        const entry = ScribeLog.rule(log, before, { type: 'EditFact', fact: fact.id, expected: ScribeLog.editExpected(fact), text });
        if (entry) {
            ScribeLog.link(entry, before, [], story);
        }
        return entry;
    };
    const prior = replay().facts[0];
    assert.equal(edit(prior, ' ' + original + ' '), null);
    const first = edit(prior, 'offers 50,000 gold');
    assert.throws(() => edit(prior, 'stale'), /StaleState/);
    assert.deepEqual(plain(replay().facts[0]), { ...plain(prior), text: 'offers 50,000 gold' });
    const second = edit(replay().facts[0], 'offers 60,000 gold');
    const frozen = replay().facts[0];
    rule(log, { type: 'Widen', fact: prior.id, to: ['S3'] });
    assert.throws(() => edit(frozen, 'out of date'), /StaleState/);
    ScribeLog.revoke(log, first.sequence);
    assert.equal(replay().facts[0].text, 'offers 60,000 gold');
    assert.deepEqual(plain(replay().facts[0].widened), ['S3']);
    ScribeLog.withdraw(log, 'MESSAGE-3');
    apply(log, storyOrder, wording, stretch(1, 3));
    const remapped = replay().facts.find((fact) => fact.target === prior.target);
    assert.notEqual(remapped.id, prior.id);
    assert.equal(remapped.text, 'offers 60,000 gold');
    assert.deepEqual(plain(remapped.widened), ['S3']);
    ScribeLog.revoke(log, second.sequence);
    assert.deepEqual(plain(replay().facts.find((fact) => fact.target === prior.target).widened), ['S3']);
    log.entries.find((entry) => entry.sequence === second.sequence).withdrawn = false;
    prints.set('MESSAGE-1', 'new supporting passage');
    assert.equal(replay().facts.find((fact) => fact.target === prior.target).text, original);
    ScribeLog.revoke(log, second.sequence);
    assert.equal(replay().facts.find((fact) => fact.target === prior.target).text, original);
});

test('edits preserve pin winners and refuse fixed or list collisions with another fact', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Mira | hair | black | #1', 'Mira | hair | auburn | #2',
        'Mira | trait | calm | #1', 'Mira | trait | sly | #2'] }), stretch(1, 2));
    const edit = (id, text) => {
        const state = ScribeReplay.run(log, storyOrder);
        const expected = ScribeLog.editExpected(factNumbered(state, id));
        return ScribeLog.rule(log, state, { type: 'EditFact', fact: id, expected, text });
    };
    assert.throws(() => edit('F1', 'auburn'), /combine two facts/);
    assert.throws(() => edit('F3', 'sly'), /combine two facts/);
    rule(log, pin('S1', 'hair', 'auburn'));
    edit('F2', 'copper');
    const pinned = factNumbered(ScribeReplay.run(log, storyOrder), 'F2');
    assert.deepEqual([pinned.status, pinned.pinned, pinned.text], ['InForce', true, 'copper']);
    rule(log, pin('S1', 'hair', 'copper'));
    edit('F2', 'golden-red');
    const again = factNumbered(ScribeReplay.run(log, storyOrder), 'F2');
    assert.deepEqual([again.status, again.pinned, again.text], ['InForce', true, 'golden-red']);
    rule(log, pin('S1', 'hair', 'silver'));
    const synthetic = ScribeReplay.run(log, storyOrder).facts.find((fact) => fact.made);
    edit(synthetic.id, 'golden');
    assert.equal(factNumbered(ScribeReplay.run(log, storyOrder), synthetic.id).text, 'golden');
    apply(log, storyOrder, answer({ CHANGES: ['F3 | Mira | trait | quiet | #3'] }), pick(3));
    assert.throws(() => edit('F3', 'other'), /StaleState/);
});

test('the open editor refuses an intervening change in the source scene audience or who was told', () => {
    const log = ScribeLog.create();
    const before = apply(log, storyOrder, answer({ SUBJECTS: ['Mira | character', 'Oren | character', 'Hal | character'],
        FACTS: ['Mira | trait | calm | #1'], SCENES: ['Day 1 | #1-#2 | The mill | public | present: Mira | Mira waits'] }), stretch(1, 2)).state;
    const operation = (state) => ({ type: 'EditFact', fact: 'F1', text: 'quiet', expected: ScribeLog.editExpected(state.facts[0], state) });
    const publicDraft = operation(before);
    const narrow = rule(log, { type: 'Narrow', scene: 'MESSAGE-1' });
    assert.throws(() => rule(log, publicDraft), /StaleState/);
    const privateDraft = operation(narrow.state);
    ScribeLog.revoke(log, narrow.entry.sequence);
    assert.throws(() => rule(log, privateDraft), /StaleState/);
    const told = apply(log, storyOrder, answer({ TOLD: ['F1 | Mira | Oren | #3', 'F1 | Mira | Hal | #3'] }), pick(3)).state;
    assert.deepEqual(plain(told.facts[0].told), ['S2', 'S3']);
    assert.throws(() => rule(log, publicDraft), /StaleState/);
    const sorted = ScribeLog.editExpected({ ...told.facts[0], told: [...told.facts[0].told].reverse() }, told);
    assert.deepEqual(plain(sorted), plain(ScribeLog.editExpected(told.facts[0], told)));
});

test('two independently edited source facts can start with identical wording', () => {
    const log = ScribeLog.create();
    const initial = apply(log, storyOrder, answer({ FACTS: ['Mira | trait | calm | #1'] }), pick(1)).state;
    rule(log, { type: 'EditFact', fact: 'F1', expected: ScribeLog.editExpected(initial.facts[0]), text: 'quiet' });
    const next = apply(log, storyOrder, answer({ FACTS: ['Mira | trait | calm | hidden | #2'] }), pick(2)).state;
    const { state } = rule(log, { type: 'EditFact', fact: 'F2', expected: ScribeLog.editExpected(next.facts[1]), text: 'sly' });
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.text, fact.hidden])), [['F1', 'quiet', false], ['F2', 'sly', true]]);
});

test('historical fixed and list facts retain both identities when proposed wording would collapse them', () => {
    for (const category of ['trait', 'hair']) {
        const log = ScribeLog.create();
        apply(log, storyOrder, answer({ FACTS: ['Mira | ' + category + ' | calm | hidden | #1',
            'Mira | ' + category + ' | sly | #2'] }), stretch(1, 2));
        const { state } = apply(log, storyOrder, answer({ CHANGES: ['F1 | Mira | ' + category + ' | ENDED: changed | #3'] }), pick(3));
        const count = log.entries.length;
        assert.throws(() => rule(log, { type: 'EditFact', fact: 'F2', expected: ScribeLog.editExpected(state.facts[1]), text: 'calm' }),
            /combine two facts/);
        assert.equal(log.entries.length, count);
        assert.deepEqual(plain(ScribeReplay.run(log, storyOrder).facts), plain(state.facts));
    }
});

test('an older widening or removal does not match an independent corrected relation by display text', () => {
    for (const decision of [{ type: 'Widen', fact: 'F1', to: 'Everyone' }, { type: 'RemoveFact', fact: 'F1' }]) {
        const log = ScribeLog.create();
        apply(log, storyOrder, answer({ FACTS: ['Mira | relation to Oren | offers 50,000 gold | hidden | #1'] }), pick(1));
        rule(log, decision);
        const next = apply(log, storyOrder, answer({ FACTS: ['Mira | relation to Oren | offers 100,000 gold | hidden | #2'] }), pick(2)).state;
        const current = next.facts.find((fact) => fact.id === 'F2');
        const { state } = rule(log, { type: 'EditFact', fact: 'F2', expected: ScribeLog.editExpected(current), text: 'offers 50,000 gold' });
        const corrected = state.facts.find((fact) => fact.id === 'F2');
        assert.deepEqual([corrected.status, corrected.widened, corrected.hidden], ['InForce', null, true]);
    }
});

test('a pin filed after a remapped edit retains the same winner through another reread and edit', () => {
    const log = ScribeLog.create();
    const prints = new Map(story.map((message) => [message.id, message.fingerprint]));
    const replay = () => ScribeReplay.run(log, storyOrder, null, prints);
    const wording = answer({ FACTS: ['Mira | hair | black | #1', 'Mira | hair | red | hidden | #2'] });
    const read = () => apply(log, storyOrder, wording, stretch(1, 3));
    const edit = (text) => {
        const state = replay();
        const fact = state.facts.find((row) => row.cite === 'MESSAGE-2');
        const entry = ScribeLog.rule(log, state, { type: 'EditFact', fact: fact.id, expected: ScribeLog.editExpected(fact), text });
        ScribeLog.link(entry, state, [], story);
    };
    read();
    edit('copper');
    ScribeLog.withdraw(log, 'MESSAGE-3');
    read();
    const pinned = ScribeLog.rule(log, replay(), pin('S1', 'hair', 'copper'));
    assert.equal(pinned.operations[0].winner, 'F4');
    edit('golden');
    ScribeLog.withdraw(log, 'MESSAGE-3');
    read();
    const facts = replay().facts;
    assert.equal(facts.length, 2);
    assert.deepEqual(plain(facts.filter((fact) => fact.pinned).map((fact) => [fact.id, fact.text, fact.hidden, fact.status])),
        [['F7', 'golden', true, 'InForce']]);
});

test('a widening filed before an edit follows only the original cited fact on reread', () => {
    const log = ScribeLog.create();
    const wording = answer({ SUBJECTS: ['Mira | character', 'Oren | character'], FACTS: ['Mira | trait | quiet | hidden | #1'] });
    apply(log, storyOrder, wording, stretch(1, 2));
    const widened = rule(log, { type: 'Widen', fact: 'F1', to: ['S2'] }).state;
    const edit = ScribeLog.rule(log, widened, { type: 'EditFact', fact: 'F1', expected: ScribeLog.editExpected(widened.facts[0]), text: 'calm' });
    ScribeLog.link(edit, widened, [], story);
    ScribeLog.withdraw(log, 'MESSAGE-2');
    apply(log, storyOrder, wording, stretch(1, 2));
    const prints = new Map(story.map((message) => [message.id, message.fingerprint]));
    const [current] = ScribeReplay.run(log, storyOrder, null, prints).facts;
    assert.deepEqual(plain([current.id, current.text, current.widened]), ['F2', 'calm', ['S2']]);
});

test('choosing a third value settles only claims evidenced by the two alternatives on that conflict card', () => {
    const log = ScribeLog.create();
    const state = apply(log, storyOrder, answer({ FACTS: ['Mira | hair | auburn | #1', 'Mira | hair | line 3 | #3'] }),
        stretch(1, 4)).state;
    const [fact] = state.facts;
    const issue = (position) => ({ kind: 'Contradiction', fact: fact.id, subject: fact.subject,
        category: fact.category, book: fact.text, said: 'line ' + position, message: story[position-1].id,
        fingerprint: story[position-1].fingerprint });
    const entry = ScribeLog.rule(log, state, pin(fact.subject, 'hair', 'copper'));
    ScribeLog.link(entry, state, [issue(3), issue(4)], story);
    const result = ScribeReplay.run(log, storyOrder, null, new Map(story.map((message) => [message.id, message.fingerprint])));
    assert.deepEqual(plain(result.resolutions.map((item) => item.message)), ['MESSAGE-3']);
    assert.equal(result.conflicts.length, 0);
});

test('a second split moves a fact again', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Oswin | trait | quiet | #1', 'Oswin | trait | gruff | #1'] }), pick(1));
    rule(log, { type: 'Split', subject: 'S1', label: 'Oswin (the miller)', kind: 'character', facts: ['F1'] });
    const { state } = rule(log, {
        type: 'Split',
        subject: 'S2',
        label: "Oswin (Tamsin's uncle)",
        kind: 'character',
        facts: ['F1'],
    });
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.subject])), [
        ['F1', 'S3'],
        ['F2', 'S1'],
    ]);
});

test('the state is frozen and the log survives JSON', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: [
                'Halvard | character',
                'Mirelle | character',
                'Tamsin | character',
                'Oswin | character',
                'Aldric | character',
            ],
            NAMES: ['Aldrich | Aldric | #1'],
            FACTS: [
                'Halvard | age | twenty-five | #1',
                'Halvard | age | thirty | #2',
                'Mirelle | eyes | grey | #1',
                'Mirelle | eyes | blue | #2',
                'Oswin | trait | quiet | #1',
                'Oswin | trait | gruff | #2',
                'Tamsin | location | the mill | #2',
            ],
            SCENES: ['Day 1 | #1-#2 | The mill | public | present: Halvard, Tamsin | They talk'],
            QUESTIONS: ['Who rang the bell? | #2', 'Is the mill locked? | #2'],
        }),
        pick(1, 2),
    );
    assert.equal(ScribeLog.keepFirst(log, ScribeReplay.run(log, storyOrder)).length, 2);
    const operations = [
        pin('S2', 'eyes', 'blue'),
        { type: 'Merge', from: 'S3', into: 'S2' },
        { type: 'Split', subject: 'S4', label: 'Oswin (the miller)', kind: 'character', facts: ['F6'] },
        { type: 'Distinct', first: 'S1', second: 'S4' },
        { type: 'Narrow', scene: 'MESSAGE-1' },
        { type: 'Widen', fact: 'F1', to: ['S2', 'S4'] },
        { type: 'Widen', fact: 'F2', to: 'Everyone' },
        {
            type: 'AddFact',
            subject: 'S1',
            category: 'relation',
            target: 'S5',
            text: 'owes him',
            hidden: false,
            cite: 'MESSAGE-2',
            position: 2,
        },
        { type: 'RemoveFact', fact: 'F7' },
        { type: 'Unalias', subject: 'S5', name: 'Aldrich' },
        { type: 'Answer', question: 'Q1', text: 'the miller' },
        { type: 'Dismiss', question: 'Q2' },
    ];
    for (const operation of operations) {
        rule(log, operation);
    }
    const state = ScribeReplay.run(log, storyOrder);
    const types = new Set(log.entries.flatMap((entry) => entry.operations.map((operation) => operation.type)));
    assert.deepEqual(
        types,
        new Set([
            'Subject',
            'Alias',
            'Fact',
            'Scene',
            'Question',
            'Pin',
            'Merge',
            'Split',
            'Distinct',
            'Narrow',
            'Widen',
            'AddFact',
            'RemoveFact',
            'Unalias',
            'Answer',
            'Dismiss',
        ]),
    );
    assert.ok(state.facts.some((fact) => fact.pinned));
    assert.ok(state.facts.some((fact) => fact.status === 'Removed'));
    assert.ok(state.facts.some((fact) => Array.isArray(fact.widened)));
    assert.ok(state.facts.some((fact) => fact.origin === 'Operator'));
    assert.ok(state.subjects.some((subject) => subject.mergedInto !== null));
    assert.ok(state.subjects.some((subject) => subject.label === 'Oswin (the miller)'));
    assert.ok(state.scenes.some((scene) => scene.narrowed));
    assert.ok(state.questions.some((question) => question.answer !== null));
    assert.ok(state.questions.some((question) => question.dismissed));
    assert.deepEqual(plain(state.unaliased), [{ subject: 'S5', name: 'Aldrich' }]);
    assert.deepEqual(plain(state.distinct), [{ first: 'S1', second: 'S4' }]);
    assertFrozenDeep(state, 'state');
    assertJsonSafe(log, 'log');
    assert.equal(Object.isFrozen(log.entries.at(-1)), false);
    assert.equal(Object.isFrozen(log.entries.at(-1).operations[0]), false);
    assert.equal(Object.isFrozen(log.entries.at(-7).operations[0].to), false);
    const before = plain(log);
    const replayed = ScribeReplay.run(log, storyOrder);
    assert.deepEqual(plain(log), before);
    assert.deepEqual(replayed, state);
    const copy = plain(log);
    assert.deepEqual(ScribeReplay.run(copy, storyOrder), state);
    assert.deepEqual(plain(copy), before);
});

test('many rulings replay quickly', () => {
    const large = new CampaignBuilder('Orla');
    for (let number = 1; number <= 200; number++) {
        large.narrator(`The long tale goes on, line ${number}.`);
    }
    const messages = ScribeIntake.read(large.messages).messages;
    const order = messages.map((message) => message.id);
    const names = [
        'Halvard',
        'Mirelle',
        'Tamsin',
        'Oswin',
        'Aldric',
        'Aldrich',
        'Isolde',
        'Kira',
        'Orla',
        'Maren',
        'Brandt',
        'Corvane',
        'Nonette',
    ];
    const subjects = Array.from({ length: 200 }, (unused, index) => `${names[index % names.length]} ${index + 1}`);
    const log = ScribeLog.create();
    for (let round = 0; round < 20; round++) {
        const first = round * 10 + 1;
        const lines = [];
        for (let offset = 0; offset < 10; offset++) {
            const serial = round * 10 + offset;
            const label = subjects[serial];
            lines.push(
                `${label} | age | ${20 + (serial % 7)} winters | #${first}`,
                `${label} | age | ${40 + (serial % 7)} winters | #${first + 1}`,
                `${label} | eyes | grey ${serial} | #${first}`,
                `${label} | eyes | blue ${serial} | #${first + 1}`,
                `${label} | hair | black ${serial} | #${first}`,
                `${label} | hair | brown ${serial} | #${first + 1}`,
                `${label} | trait | quiet ${serial} | #${first}`,
                `${label} | trait | loud ${serial} | #${first + 1}`,
                `${label} | location | the mill ${serial} | #${first}`,
                `${label} | location | the inn ${serial} | #${first + 1}`,
            );
        }
        const parsed = ScribeAnswer.parse(answer({ FACTS: lines }));
        assert.equal(parsed.operations.length, 100);
        const result = ScribeLog.append(log, ScribeReplay.run(log, order), parsed.operations, {
            messages: messages.slice(first - 1, first + 9),
            origin: 'Story',
        });
        assert.deepEqual(plain(result.refused), []);
    }
    const base = ScribeReplay.run(log, order);
    assert.equal(base.facts.length, 2000);
    assert.equal(base.conflicts.length, 600);
    const bySubject = new Map();
    for (const fact of base.facts) {
        bySubject.set(`${fact.subject} ${fact.category} ${fact.text}`, fact.id);
    }
    /**
     * @param {number} serial
     * @return {string}
     */
    const idOf = (serial) => `S${serial + 1}`;
    /**
     * @param {number} serial
     * @param {string} category
     * @param {string} text
     * @return {string}
     */
    const factOf = (serial, category, text) => bySubject.get(`${idOf(serial)} ${category} ${text}`);
    const operations = [];
    for (let serial = 0; serial < 200; serial++) {
        operations.push(pin(idOf(serial), 'age', `${40 + (serial % 7)} winters`));
    }
    for (let serial = 0; serial < 200; serial++) {
        operations.push(pin(idOf(serial), 'eyes', `blue ${serial}`));
    }
    for (let serial = 0; serial < 100; serial++) {
        operations.push(pin(idOf(serial), 'hair', `brown ${serial}`));
    }
    for (let pair = 0; pair < 100; pair++) {
        operations.push({ type: 'Merge', from: idOf(pair * 2 + 1), into: idOf(pair * 2) });
    }
    for (let serial = 0; serial < 200; serial++) {
        operations.push({ type: 'RemoveFact', fact: factOf(serial, 'trait', `quiet ${serial}`) });
        operations.push({ type: 'RemoveFact', fact: factOf(serial, 'trait', `loud ${serial}`) });
    }
    for (let serial = 0; serial < 100; serial++) {
        operations.push({ type: 'RemoveFact', fact: factOf(serial, 'location', `the mill ${serial}`) });
    }
    assert.equal(operations.length, 1100);
    for (const operation of operations) {
        ScribeLog.rule(log, { ...base, revision: log.revision }, operation);
    }
    const started = performance.now();
    const state = ScribeReplay.run(log, order);
    const elapsed = performance.now() - started;
    assert.equal(state.facts.length, 2000);
    assert.equal(state.facts.filter((fact) => fact.status === 'Removed').length, 500);
    assert.equal(state.facts.filter((fact) => fact.pinned).length, 250);
    assert.equal(state.subjects.filter((subject) => subject.mergedInto !== null).length, 100);
    assert.equal(state.conflicts.length, 50);
    assert.ok(elapsed < 20000, `replay took ${elapsed} ms`);
});
