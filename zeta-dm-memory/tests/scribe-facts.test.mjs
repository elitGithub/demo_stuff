import assert from 'node:assert/strict';
import test from 'node:test';
import CampaignBuilder from './support/CampaignBuilder.mjs';
import ScribeCore from './support/ScribeCore.mjs';

const { ScribeText, ScribeCategory, ScribeIntake, ScribeAnswer, ScribeLog, ScribeReplay } = ScribeCore.load([
    'ScribeText',
    'ScribeCategory',
    'ScribeIntake',
    'ScribeAnswer',
    'ScribeLog',
    'ScribeReplay',
]);

const builder = new CampaignBuilder('Orla');
for (let number = 1; number <= 30; number++) {
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
 * @param {object[]} rows
 * @param {string[]} subjects
 * @param {string} fact
 * @return {object}
 */
function citedCorrection(rows, subjects, fact) {
    const campaign = new CampaignBuilder('Frost');
    for (const row of rows) {
        if (row.speaker) {
            campaign.says(row.speaker, row.words);
        } else {
            campaign.narrator(row.words);
        }
    }
    const messages = ScribeIntake.read(campaign.messages).messages;
    const order = messages.map((message) => message.id);
    const prints = new Map(messages.map((message) => [message.id, message.fingerprint]));
    const book = { log: ScribeLog.create(), fingerprints: Object.fromEntries(prints) };
    const replay = () => ScribeReplay.run(JSON.parse(JSON.stringify(book.log)), order, null, prints, null, null, messages);
    const filed = apply(book.log, order, answer({ SUBJECTS: subjects.map((owner) => owner + ' | character'), FACTS: [fact] }), messages);
    const operation = filed.result.entry.operations.find((item) => item.fact);
    const sources = messages.map((message) => ({ messageId: message.id, fingerprint: message.fingerprint, position: message.position,
        blockNumber: message.blocks[0].blockNumber, speaker: message.blocks[0].speaker, quote: message.blocks[0].text }));
    for (const [index, message] of messages.entries()) {
        const { claim } = rows[index];
        const source = sources[index];
        const record = { ref: 'w1', text: JSON.stringify(operation) };
        const earlier = index > 0 ? sources[0] : null;
        const compact = (passage) => passage && ({ ref: 'm' + passage.position + 'b' + passage.blockNumber, quote: passage.quote });
        const findings = index === rows.length - 1 ?
            [{ kind: 'Citation', question: 'Which account should correct the book entry?', source, earlier, record }] : [];
        const id = 'cited-' + index;
        const receipt = { id, index: 0, total: 1, complete: true, claims: claim ? [{ ...claim, source, text: source.quote }] : [], findings,
            answer: JSON.stringify({ complete: true, page: id, claims: claim ? [{ ...claim, source: compact(source) }] : [],
                findings: findings.map((finding) => ({ ...finding, source: compact(source), earlier: compact(earlier), record: record.ref })) }) };
        assert.equal(ScribeLog.saveCheck(book, messages, ScribeLog.checkWork(book, messages), receipt), true);
    }
    const decide = () => {
        const [row] = ScribeLog.checkProgress(book, messages).findings;
        return ScribeLog.ruleFinding(book, replay(), messages, { finding: row.id, version: row.version, action: 'choose', account: 'source' });
    };
    return { decide, replay, book, sources };
}

test('a ruled debt binds the named creditor even when the old creditor was only unresolved text', () => {
    const claim = { subject: 'Frost', attribute: 'owes', value: 'fifty gold', attribution: 'witnessed' };
    for (const subjects of [['Frost', 'Mirra', 'Aldren'], ['Frost', 'Mirra']]) {
        const room = citedCorrection([{ words: 'Frost owes Mirra fifty gold.', claim }], subjects, 'Frost | toward Aldren | owes him fifty gold | #1');
        assert.equal(room.replay().facts[0].targetText, 'Aldren');
        room.decide();
        const { subjects: known, facts } = room.replay();
        assert.equal(facts[0].subject, known.find((owner) => owner.label === 'Frost').id);
        assert.equal(facts[0].target, known.find((owner) => owner.label === 'Mirra').id);
        assert.equal(facts[0].targetText, 'Mirra');
        assert.equal(facts[0].text, 'fifty gold');
        assert.equal(ScribeCategory.displayValue(facts[0]), 'owes fifty gold');
        assert.equal(facts[0].evidence.quote, 'Frost owes Mirra fifty gold.');
    }
    for (const words of ['Mirra owes Frost fifty gold.', 'Frost owes Mirra and Aldren fifty gold.', 'Mirra told Aldren that Frost owes him fifty gold.']) {
        const room = citedCorrection([{ words, claim }], ['Frost', 'Mirra', 'Aldren'], 'Frost | toward Aldren | owes him fifty gold | #1');
        const before = JSON.stringify(room.book);
        assert.throws(room.decide, /single target/);
        assert.equal(JSON.stringify(room.book), before);
    }
});

test('a citation correction keeps the separately witnessed weapon clause when the earlier Checker page has no structured claim', () => {
    const original = 'Magera was raised as a weapon.';
    const later = 'Magera received the staff as a reward.';
    const room = citedCorrection([{ words: original }, { words: later, claim: {
        subject: 'Magera', attribute: 'received', value: 'reward', attribution: 'witnessed' } }],
        ['Magera'], 'Magera | background | Raised as a weapon and given the staff as a reward | #1');
    room.decide();
    const facts = room.replay().facts;
    assert.deepEqual(Array.from(facts, (item) => [item.text, item.evidence.quote, item.cite, item.evidence.attribution]),
        [['Raised as a weapon', original, room.sources[0].messageId, 'witnessed'], ['reward', later, room.sources[1].messageId, 'witnessed']]);
    const noAttribute = citedCorrection([{ words: original }, { words: later, claim: {
        subject: 'Magera', attribute: null, value: 'reward', attribution: 'witnessed' } }],
        ['Magera'], 'Magera | background | Raised as a weapon and given the staff as a reward | #1');
    noAttribute.decide();
    assert.deepEqual(Array.from(noAttribute.replay().facts, (item) => [item.text, item.cite]),
        [['Raised as a weapon', noAttribute.sources[0].messageId], ['reward', noAttribute.sources[1].messageId]]);
    for (const wording of ['Raised as a weapon / given the staff as a reward', 'Raised as a weapon (given the staff as a reward)',
        'Raised as a weapon • given the staff as a reward', 'Raised as a weapon given the staff as a reward']) {
        const ambiguous = citedCorrection([{ words: original }, { words: later, claim: {
            subject: 'Magera', attribute: 'received', value: 'reward', attribution: 'witnessed' } }],
            ['Magera'], 'Magera | background | ' + wording + ' | #1');
        const before = JSON.stringify(ambiguous.book);
        assert.throws(ambiguous.decide, /whole book entry/);
        assert.equal(JSON.stringify(ambiguous.book), before);
        assert.equal(ambiguous.replay().facts[0].text, wording);
    }
    const single = citedCorrection([{ words: original }, { words: later, claim: {
        subject: 'Magera', attribute: 'received', value: 'reward', attribution: 'witnessed' } }],
        ['Magera'], 'Magera | background | reward | #1');
    single.decide();
    assert.equal(single.replay().facts[0].text, 'reward');
    assert.equal(single.replay().facts[0].cite, single.sources[1].messageId);
    const extra = citedCorrection([{ words: original }, { words: later, claim: {
        subject: 'Magera', attribute: 'received', value: 'reward', attribution: 'witnessed' } }],
        ['Magera'], 'Magera | background | Raised as a weapon and given the staff as a reward / guards the vault | #1');
    const saved = JSON.stringify(extra.book);
    assert.throws(extra.decide, /entire part/);
    assert.equal(JSON.stringify(extra.book), saved);
    for (const wording of ['Raised as a weapon / guarded the vault and given the staff as a reward',
        'Raised as a weapon guarded the vault and given the staff as a reward',
        'Raised as a weapon (training the guard) and given the staff as a reward',
        'Raised as a weapon and given the staff as a reward she guarded the vault',
        'Raised as a weapon and given the vault as a reward']) {
        const contested = citedCorrection([{ words: 'Magera was raised as a weapon. She guarded the vault.', claim: {
            subject: 'Magera', attribute: 'raised', value: 'weapon', attribution: 'witnessed' } },
        { words: later + ' She guarded the vault.', claim: {
            subject: 'Magera', attribute: 'received', value: 'reward', attribution: 'witnessed' } }],
        ['Magera'], 'Magera | background | ' + wording + ' | #1');
        const initial = JSON.stringify(contested.book);
        assert.throws(contested.decide, /separate source support|entire part/);
        assert.equal(JSON.stringify(contested.book), initial);
        assert.equal(contested.replay().facts[0].text, wording);
    }
    for (const earlier of ['Magera might have been raised as a weapon.', 'Magera denies she was raised as a weapon.']) {
        const uncertain = citedCorrection([{ words: earlier }, { words: later, claim: {
            subject: 'Magera', attribute: 'received', value: 'reward', attribution: 'witnessed' } }],
            ['Magera'], 'Magera | background | Raised as a weapon and given the staff as a reward | #1');
        const before = JSON.stringify(uncertain.book);
        assert.throws(uncertain.decide, /earlier source/);
        assert.equal(JSON.stringify(uncertain.book), before);
    }
});

test('canonical hair value is exactly the supported value, with the ring only in the separately preserved quote', () => {
    const words = 'Frost has dark hair and a silver ring.';
    const room = citedCorrection([{ words, claim: { subject: 'Frost', attribute: 'hair', value: 'dark', attribution: 'witnessed' } }],
        ['Frost'], 'Frost | hair | grey | #1');
    room.decide();
    const state = room.replay();
    assert.equal(state.facts[0].text, 'dark');
    assert.equal(state.facts[0].category, 'hair');
    assert.equal(state.facts[0].subject, state.subjects[0].id);
    assert.equal(state.facts[0].evidence.value, 'dark');
    assert.equal(state.facts[0].evidence.quote, words);
    assert.equal(state.checkerRulings[0].canonical, 'dark');
    assert.equal(ScribeCategory.displayValue(state.facts[0]), 'dark');
    const bounty = citedCorrection([{ words: 'Mirra has a bounty of 50,000 gold.', claim: {
        subject: 'Mirra', attribute: 'bounty', value: '50,000 gold', attribution: 'witnessed' } }],
        ['Acnademia', 'Mirra'], 'Acnademia | status | bounty of 50,000 gold | #1');
    bounty.decide();
    const corrected = bounty.replay();
    assert.equal(corrected.facts[0].subject, corrected.subjects.find((owner) => owner.label === 'Mirra').id);
    assert.equal(corrected.facts[0].text, '50,000 gold');
    assert.equal(ScribeCategory.displayValue(corrected.facts[0]), 'bounty 50,000 gold');
});

test('Sera keeps both cited forms through a transformation and compares only matching measurements', () => {
    const campaign = new CampaignBuilder('Sera');
    const readings = new Map([[148, '5 ft 9 in'], [196, '20 m'], [197, '2,000 cm'], [198, '12 m']]);
    for (let position = 1; position <= 199; position++) {
        campaign.narrator(readings.get(position) ?? 'She takes human form.');
    }
    const messages = ScribeIntake.read(campaign.messages).messages;
    const order = messages.map((message) => message.id);
    const log = ScribeLog.create();
    const replay = () => ScribeReplay.run(plain(log), order);
    for (const [position, text] of readings) {
        const message = messages[position - 1];
        const scope = position === 148 ? { form: 'human', dimension: 'height' } : { form: 'full dragon', dimension: 'length' };
        const evidence = { ...scope, section: 'FACTS', row: 1, messageId: message.id, messageNumber: position,
            fingerprint: message.fingerprint, blockNumber: 1, speaker: message.blocks[0].speaker,
            attribution: position === 197 ? 'claimed' : 'witnessed', quote: text };
        const [fact] = ScribeAnswer.parse(answer({ FACTS: [`Sera | build | ${text} | #${position}`] })).operations;
        const result = ScribeLog.append(log, replay(), [{ ...fact, ...scope, evidence }], { messages: [message], origin: 'Story' });
        assert.equal(result.refused.length, 0);
        const state = replay();
        assert.equal(state.conflicts.length, Number(position === 198));
        if (position >= 196) {
            assert.deepEqual(plain(state.facts.filter((item) => item.status === 'InForce').map((item) =>
                [item.text, item.form, item.dimension, item.evidence.messageNumber])),
            [['5 ft 9 in', 'human', 'height', 148], ['20 m', 'full dragon', 'length', 196]]);
        }
    }
    apply(log, order, answer({ FACTS: ['Sera | status | takes human form | #199'] }), [messages[198]]);
    const state = replay();
    const dragon = state.facts.find((item) => item.text === '20 m');
    assert.deepEqual(plain(dragon.claims.map(({ id, text, cite, evidence }) => [id, text, cite, evidence.quote, evidence.attribution])),
        [['F2', '20 m', order[195], '20 m', 'witnessed'], ['F3', '2,000 cm', order[196], '2,000 cm', 'claimed']]);
    assert.deepEqual(plain(state.conflicts), [{ subject: 'S1', category: 'build', target: null, form: 'full dragon',
        dimension: 'length', established: 'F2', others: ['F4'] }]);
    assert.deepEqual(plain(state.claims.map((claim) => claim.evidence.messageId)), [order[147], order[195], order[196], order[197]]);
});

test('legacy build wording identifies the two forms without guessing a form for unqualified records', () => {
    const log = ScribeLog.create();
    const human = 'five foot nine in human form';
    const dragon = 'twenty meters long in full dragon form';
    const state = apply(log, storyOrder, answer({ FACTS: [
        `Sera | build | ${human} | #1`, `Sera | build | ${dragon} | #2`,
        'Sera | build | 2,000 cm long in full dragon form | #3', 'Sera | build | 12 m long | #4',
    ] }), pick(1, 2, 3, 4)).state;
    for (const entry of log.entries) {
        for (const operation of entry.operations) {
            delete operation.form;
            delete operation.dimension;
        }
    }
    const old = ScribeReplay.run(plain(log), storyOrder);
    assert.deepEqual(plain(old.facts), plain(state.facts));
    assert.deepEqual(plain(old.facts.map((item) => [item.id, item.status, item.form, item.dimension])),
        [['F1', 'InForce', 'human', 'height'], ['F2', 'InForce', 'full dragon', 'length'], ['F4', 'InForce', null, 'length']]);
    assert.equal(old.conflicts.length, 0);
    const savedAdvice = contradiction(`#2 "${dragon}" | #1 "${human}" | conflicting measurements`, 'MESSAGE-1');
    ScribeLog.append(log, old, [savedAdvice], { origin: 'Notes', messages: pick(2) });
    assert.equal(ScribeReplay.run(plain(log), storyOrder).contradictions.length, 0);
    assert.ok(log.entries.at(-1).operations.some((operation) => operation.type === 'Contradiction'));
});

test('a sentence and a bare quantity agree while ranges, approximations and additional values stay distinct', () => {
    const log = ScribeLog.create();
    const values = ['Her full dragon form is 20 m long', 'Her full dragon form is 2,000 cm long', '2,000 cm long',
        'Her full dragon form is at least 20 m long', 'Her full dragon form is 19–20 m long',
        'Her full dragon form is 20 m long with a 3 m tail'];
    const rows = ScribeAnswer.parse(answer({ FACTS: values.map((text, index) => `Sera | build | ${text} | #${index + 1}`) })).operations;
    const operations = rows.map((row, index) => index === 2 ? { ...row, form: 'full dragon', dimension: 'length' } : row);
    ScribeLog.append(log, ScribeReplay.run(log, storyOrder), operations, { origin: 'Story', messages: story.slice(0, rows.length) });
    const state = ScribeReplay.run(plain(log), storyOrder);
    assert.deepEqual(plain(state.facts[0].claims.map((claim) => [claim.text, claim.position])), values.slice(0, 3).map((text, index) => [text, index + 1]));
    assert.deepEqual(plain(state.conflicts[0].others), ['F4', 'F5', 'F6']);
});

test('only accepted matching operations carry resolution evidence and material supporting edits reopen the issue', () => {
    const log = ScribeLog.create();
    const state = apply(log, storyOrder, answer({ FACTS: ['Mira | eyes | blue | #1', 'Mira | hair | black | #2'] }),
        story.slice(0, 4)).state;
    const reply = story[3];
    const [eyes, hair] = state.facts;
    const issue = (fact, said) => ({ kind: 'Contradiction', message: reply.id, fingerprint: reply.fingerprint,
        fact: fact.id, subject: fact.subject, category: fact.category, book: fact.text, said });
    const drafted = apply(log, storyOrder, answer({ FACTS: ['Mira | eyes | line 4 | #4', 'Mira | trait | alert | #4',
        'Mira | hair | tale | #8'] }), [reply], 'Notes');
    assert.equal(drafted.result.refused.length, 1);
    const entry = drafted.result.entry;
    ScribeLog.link(entry, state, [issue(eyes, 'line 4'), issue(hair, 'tale')], story);
    assert.deepEqual(plain(entry.operations.map((operation) => operation.resolutions?.map((item) => item.fact) ?? [])),
        [[eyes.id], []]);
    const prints = new Map(story.map((message) => [message.id, message.fingerprint]));
    const replay = () => ScribeReplay.run(JSON.parse(JSON.stringify(log)), storyOrder, null, prints);
    assert.equal(replay().resolutions.length, 1);
    assert.equal(replay().conflicts.length, 0);
    prints.set(story[2].id, 'unrelated revision');
    assert.equal(replay().resolutions.length, 1);
    for (const support of [reply, story[0]]) {
        prints.set(support.id, 'regenerated');
        assert.equal(replay().resolutions.length, 0);
        assert.equal(replay().conflicts.length, 1);
        prints.set(support.id, support.fingerprint);
    }
    ScribeLog.revoke(log, entry.sequence);
    assert.equal(replay().resolutions.length, 0);
    assert.equal(replay().facts.some((fact) => fact.text === 'alert'), true);
});

test('a filed ending must name the disputed fact and explain its quoted change at the same passage', () => {
    const cases = [
        ['F1', 'she calls it line 4 now', 4, true],
        ['F2', 'she calls it line 4 now', 4, false],
        ['F1', 'she calls it line 4 now', 3, false],
        ['F1', 'she changed her name', 4, false],
    ];
    for (const [id, reason, position, accepted] of cases) {
        const log = ScribeLog.create();
        const state = apply(log, storyOrder, answer({ FACTS: ['Mira | eyes | blue | #1', 'Mira | hair | black | #2'] }),
            story.slice(0, 4)).state;
        const [fact] = state.facts;
        const category = id === 'F1' ? 'eyes' : 'hair';
        const drafted = apply(log, storyOrder, answer({ CHANGES: [id + ' | Mira | ' + category + ' | ENDED: ' +
            reason + ' | #' + position] }), story.slice(0, 4), 'Notes');
        const entry = drafted.result.entry;
        ScribeLog.link(entry, state, [{ kind: 'Contradiction', message: 'MESSAGE-4', fingerprint: story[3].fingerprint,
            fact: fact.id, subject: fact.subject, category: fact.category, book: fact.text, said: 'line 4' }], story);
        const prints = new Map(story.map((message) => [message.id, message.fingerprint]));
        const replay = () => ScribeReplay.run(log, storyOrder, null, prints);
        assert.equal(replay().resolutions.length, Number(accepted));
        prints.set('MESSAGE-4', 'material edit');
        assert.equal(replay().resolutions.length, 0);
        prints.set('MESSAGE-4', story[3].fingerprint);
        ScribeLog.revoke(log, entry.sequence);
        assert.equal(replay().resolutions.length, 0);
    }
});

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

test('a new log is empty and survives JSON', () => {
    const literal = {
        version: 1,
        nextFact: 1,
        nextSubject: 1,
        nextThread: 1,
        nextQuestion: 1,
        nextSequence: 1,
        revision: 0,
        entries: [],
        read: {},
        notes: [],
    };
    const first = ScribeLog.create();
    const second = ScribeLog.create();
    assert.deepEqual(plain(first), literal);
    assert.deepEqual(Object.keys(first).sort(), Object.keys(literal).sort());
    assertJsonSafe(first, 'log');
    assert.equal(Object.isFrozen(first), false);
    assert.notEqual(first, second);
    assert.notEqual(first.entries, second.entries);
    assert.notEqual(first.read, second.read);
    assert.notEqual(first.notes, second.notes);
    first.entries.push({ sequence: 1 });
    first.read['MESSAGE-1'] = 1;
    first.notes.push('a note');
    assert.deepEqual(plain(second), literal);
});

test('messages are marked read even with no operations', () => {
    const log = ScribeLog.create();
    const empty = apply(log, storyOrder, '', pick(1, 2, 3));
    assert.deepEqual(plain(empty.result.entry), {
        sequence: 1,
        kind: 'Update',
        origin: 'Story',
        messageIds: ['MESSAGE-1', 'MESSAGE-2', 'MESSAGE-3'],
        operations: [],
        withdrawn: false,
    });
    assert.deepEqual(plain(log.read), { 'MESSAGE-1': 1, 'MESSAGE-2': 1, 'MESSAGE-3': 1 });
    assert.deepEqual(plain(empty.result.refused), []);
    const refusedOnly = apply(log, storyOrder, answer({ FACTS: ['Halvard | age | thirty | #99'] }), pick(4, 5, 6));
    assert.deepEqual(reasons(refusedOnly.result), ['Citation']);
    assert.deepEqual(plain(refusedOnly.result.entry.operations), []);
    assert.deepEqual(plain(refusedOnly.result.entry.messageIds), ['MESSAGE-4', 'MESSAGE-5', 'MESSAGE-6']);
    assert.deepEqual(plain(log.read), {
        'MESSAGE-1': 1,
        'MESSAGE-2': 1,
        'MESSAGE-3': 1,
        'MESSAGE-4': 2,
        'MESSAGE-5': 2,
        'MESSAGE-6': 2,
    });
    assert.equal(log.entries.length, 2);
    assert.equal(log.entries[1], refusedOnly.result.entry);
    assert.equal(log.nextSequence, 3);
});

test('the same messages cannot be read twice', () => {
    const log = ScribeLog.create();
    const first = apply(log, storyOrder, answer({ FACTS: ['Halvard | age | thirty | #2'] }), pick(1, 2, 3));
    const before = plain(log);
    const operations = ScribeAnswer.parse(
        answer({
            SUBJECTS: ['Mirelle | character'],
            FACTS: ['Mirelle | trait | proud | #5', 'Kira | trait | quick | #4'],
            THREADS: ['OPEN | the missing ledger | #4'],
            QUESTIONS: ['Who rang the bell? | #4'],
        }),
    ).operations;
    assert.equal(operations.length, 5);
    assert.throws(
        () => ScribeLog.append(log, first.state, operations, { messages: pick(1, 2, 3), origin: 'Story' }),
        { name: 'Error', message: 'AlreadyRead' },
    );
    assert.deepEqual(plain(log), before);
    assert.throws(
        () => ScribeLog.append(log, first.state, operations, { messages: pick(3, 4, 5), origin: 'Story' }),
        { name: 'Error', message: 'AlreadyRead' },
    );
    assert.deepEqual(plain(log), before);
    assert.throws(
        () => ScribeLog.append(log, first.state, operations, { messages: pick(4, 5, 2), origin: 'Story' }),
        { name: 'Error', message: 'AlreadyRead' },
    );
    assert.deepEqual(plain(log), before);
    for (const type of ['Rumour', 'toString', 'constructor']) {
        const unknown = [...operations, Object.freeze({ type, text: 'a rumour', position: 4 })];
        assert.throws(
            () => ScribeLog.append(log, first.state, unknown, { messages: pick(4, 5), origin: 'Story' }),
            { name: 'Error', message: 'UnknownOperation' },
        );
        assert.deepEqual(plain(log), before);
    }
    const later = ScribeLog.append(log, first.state, operations, { messages: pick(4, 5), origin: 'Story' });
    assert.deepEqual(plain(later.refused), []);
    assert.equal(log.entries.length, 2);
});

test('notes are filed without marking messages read', () => {
    const log = ScribeLog.create();
    const notes = apply(log, storyOrder, answer({ FACTS: ['Halvard | trait | proud | #2'] }), pick(2), 'Notes');
    assert.equal(notes.result.entry.origin, 'Notes');
    assert.deepEqual(plain(notes.result.entry.messageIds), []);
    assert.deepEqual(plain(log.read), {});
    const filed = factSaying(notes.state, 'proud');
    assert.equal(filed.origin, 'Notes');
    assert.equal(filed.cite, 'MESSAGE-2');
    assert.equal(filed.position, 2);
    const later = apply(log, storyOrder, answer({ FACTS: ['Halvard | trait | loyal | #2'] }), pick(2));
    assert.deepEqual(plain(later.result.entry.messageIds), ['MESSAGE-2']);
    assert.deepEqual(plain(log.read), { 'MESSAGE-2': 2 });
    assert.equal(factSaying(later.state, 'loyal').origin, 'Story');
    assert.equal(factSaying(later.state, 'proud').origin, 'Notes');
});

test('answers are filed without marking messages read', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | trait | proud | #2'] }), pick(1, 2, 3));
    const read = { 'MESSAGE-1': 1, 'MESSAGE-2': 1, 'MESSAGE-3': 1 };
    const filed = apply(log, storyOrder, answer({ FACTS: ['Halvard | trait | loyal | #2'] }), pick(2), 'Answers');
    assert.equal(filed.result.entry.origin, 'Answers');
    assert.deepEqual(plain(filed.result.entry.messageIds), []);
    assert.deepEqual(plain(filed.result.refused), []);
    assert.deepEqual(plain(log.read), read);
    const loyal = factSaying(filed.state, 'loyal');
    assert.equal(loyal.origin, 'Answers');
    assert.equal(loyal.cite, 'MESSAGE-2');
    assert.equal(loyal.position, 2);
    apply(log, storyOrder, answer({ FACTS: ['Halvard | trait | calm | #5'] }), pick(5), 'Answers');
    assert.deepEqual(plain(log.read), read);
    const later = apply(log, storyOrder, answer({ FACTS: ['Halvard | trait | brave | #5'] }), pick(5));
    assert.deepEqual(plain(later.result.entry.messageIds), ['MESSAGE-5']);
    assert.deepEqual(plain(log.read), { ...read, 'MESSAGE-5': 4 });
    assert.equal(factSaying(later.state, 'calm').origin, 'Answers');
    const without = ScribeReplay.run(
        log,
        storyOrder.filter((id) => id !== 'MESSAGE-5'),
    );
    assert.deepEqual(plain(without.facts.map((fact) => [fact.text, fact.position, fact.origin])), [
        ['proud', 2, 'Story'],
        ['loyal', 2, 'Answers'],
    ]);
});

test('a citation outside the stretch is refused', () => {
    const log = ScribeLog.create();
    const { state, result, parsed } = apply(
        log,
        storyOrder,
        answer({
            NAMES: ['Hal | Mirelle | #99'],
            FACTS: ['Halvard | age | thirty | #99', 'Mirelle | trait | proud | #2'],
            THREADS: ['OPEN | the missing ledger | #99', 'OPEN | the broken seal | #3'],
            QUESTIONS: ['Who rang the bell? | #99', 'Who sent the letter? | #1'],
            NIGHTS: ['#99 | the lamps go out', '#3 | the lamps go out'],
        }),
        pick(1, 2, 3),
    );
    const outside = parsed.operations.filter((operation) => operation.position === 99);
    assert.equal(outside.length, 5);
    assert.deepEqual(reasons(result), ['Citation', 'Citation', 'Citation', 'Citation', 'Citation']);
    result.refused.forEach((item, index) => assert.equal(item.operation, outside[index]));
    assert.deepEqual(labels(state), ['Mirelle']);
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.subject, fact.text])), [['F1', 'S1', 'proud']]);
    assert.deepEqual(plain(state.threads.map((thread) => [thread.id, thread.text])), [['T1', 'the broken seal']]);
    assert.deepEqual(plain(state.questions.map((question) => [question.id, question.text])), [
        ['Q1', 'Who sent the letter?'],
    ]);
    assert.deepEqual(plain(result.entry.operations.map((operation) => operation.type)), [
        'Subject',
        'Fact',
        'ThreadOpen',
        'Question',
        'Night',
    ]);
    assert.deepEqual(
        plain([log.nextSubject, log.nextFact, log.nextThread, log.nextQuestion]),
        [2, 2, 2, 2],
    );
});

test('a reference to an unknown fact or thread is refused', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | eyes | grey | #1'], THREADS: ['OPEN | the missing ledger | #1'] }),
        pick(1),
    );
    const { state, result, parsed } = apply(
        log,
        storyOrder,
        answer({
            CHANGES: [
                'F999 | Halvard | eyes | new | #2',
                'F999 | Halvard | eyes | FULLER: more | #2',
                'F999 | Halvard | eyes | ENDED: gone | #2',
            ],
            TOLD: ['F999 | Halvard | Kira | #2'],
            THREADS: ['CLOSE T9 | done | #2'],
        }),
        pick(2),
    );
    assert.deepEqual(plain(parsed.operations.map((operation) => operation.type)), [
        'Change',
        'Refine',
        'End',
        'Told',
        'ThreadClose',
    ]);
    assert.deepEqual(reasons(result), ['Reference', 'Reference', 'Reference', 'Reference', 'Reference']);
    result.refused.forEach((item, index) => assert.equal(item.operation, parsed.operations[index]));
    assert.deepEqual(plain(result.entry.operations), []);
    assert.deepEqual(labels(state), ['Halvard']);
    assert.deepEqual(plain([log.nextSubject, log.nextFact]), [2, 2]);
    const known = apply(
        log,
        storyOrder,
        answer({
            CHANGES: ['F1 | Halvard | eyes | ENDED: gone | #3'],
            TOLD: ['F1 | Halvard | Kira | #3'],
            THREADS: ['CLOSE T1 | done | #3'],
        }),
        pick(3),
    );
    assert.deepEqual(plain(known.result.refused), []);
    assert.deepEqual(plain(known.result.entry.operations.map((operation) => operation.type)), [
        'End',
        'Subject',
        'Told',
        'ThreadClose',
    ]);
});

test('a fact made in the same answer cannot be named', () => {
    const log = ScribeLog.create();
    assert.equal(log.nextFact, 1);
    const { state, result, parsed } = apply(
        log,
        storyOrder,
        answer({
            FACTS: ['Halvard | eyes | grey | #2'],
            CHANGES: ['F1 | Halvard | eyes | FULLER: grey as slate | #2'],
            TOLD: ['F1 | Halvard | Kira | #2'],
        }),
        pick(2),
    );
    assert.deepEqual(reasons(result), ['Reference', 'Reference']);
    assert.equal(result.refused[0].operation, parsed.operations[1]);
    assert.equal(result.refused[0].operation.type, 'Refine');
    assert.equal(result.refused[1].operation.type, 'Told');
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.text, fact.status])), [['F1', 'grey', 'InForce']]);
    assert.deepEqual(plain(state.refinements), []);
    assert.deepEqual(labels(state), ['Halvard']);
    assert.equal(log.nextFact, 2);
});

test('labels reach subjects by label, name and aka', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Oswin (the miller) | character', 'Halvard | character'],
            FACTS: [
                'Oswin | trait | quiet | #1',
                'Halvard-san | trait | stern | #1',
                'Halvard | aka | Hal | #1',
                'Hal | trait | proud | #2',
            ],
        }),
        pick(1, 2),
    );
    assert.deepEqual(plain(first.result.refused), []);
    assert.deepEqual(labels(first.state), ['Oswin (the miller)', 'Halvard']);
    const oswin = subjectLabelled(first.state, 'Oswin (the miller)');
    const halvard = subjectLabelled(first.state, 'Halvard');
    assert.equal(oswin.name, 'Oswin');
    assert.equal(factSaying(first.state, 'quiet').subject, oswin.id);
    assert.equal(factSaying(first.state, 'stern').subject, halvard.id);
    assert.equal(factSaying(first.state, 'Hal').subject, halvard.id);
    assert.equal(factSaying(first.state, 'proud').subject, halvard.id);
    assert.deepEqual(plain(halvard.aka), ['Hal']);
    const second = apply(log, storyOrder, answer({ FACTS: ['Hal | trait | brave | #3'] }), pick(3));
    assert.deepEqual(plain(second.result.refused), []);
    assert.deepEqual(labels(second.state), ['Oswin (the miller)', 'Halvard']);
    assert.equal(factSaying(second.state, 'brave').subject, halvard.id);
});

test('second subject with the same name stays separate', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ SUBJECTS: ['Oswin | character'] }), pick(1));
    const { state, result } = apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ["Oswin (Tamsin's uncle) | character"],
            FACTS: ['Oswin | trait | quiet | #2', "Oswin (Tamsin's uncle) | trait | loud | #2"],
        }),
        pick(2),
    );
    assert.deepEqual(plain(result.refused), []);
    assert.deepEqual(labels(state), ['Oswin', "Oswin (Tamsin's uncle)"]);
    const first = subjectLabelled(state, 'Oswin');
    const second = subjectLabelled(state, "Oswin (Tamsin's uncle)");
    assert.notEqual(first.id, second.id);
    assert.equal(second.name, 'Oswin');
    assert.deepEqual(plain(state.lookAlikes), [{ first: first.id, second: second.id, reason: 'SameName' }]);
    assert.equal(factSaying(state, 'quiet').subject, first.id);
    assert.equal(factSaying(state, 'loud').subject, second.id);
});

test('a name shared by two subjects is refused', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Oswin (the miller) | character', "Oswin (Tamsin's uncle) | character"],
            FACTS: ['Oswin (the miller) | trait | quiet | #1'],
        }),
        pick(1),
    );
    const shared = apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Oswin | character'],
            NAMES: ['Oswin | Oswin (the miller) | #2', 'Corvane | Oswin | #2'],
            FACTS: ['Oswin | trait | loud | #2'],
            TOLD: ['F1 | Oswin (the miller) | Oswin | #2'],
        }),
        pick(2),
    );
    assert.deepEqual(reasons(shared.result), ['Ambiguous', 'Ambiguous', 'Ambiguous', 'Ambiguous', 'Ambiguous']);
    shared.result.refused.forEach((item, index) => assert.equal(item.operation, shared.parsed.operations[index]));
    assert.deepEqual(plain(shared.result.entry.operations), []);
    assert.deepEqual(labels(shared.state), ['Oswin (the miller)', "Oswin (Tamsin's uncle)"]);
    assert.equal(log.nextSubject, 3);
    const inCall = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | aka | Hal | #3', 'Brandt | aka | Hal | #3', 'Hal | trait | proud | #3'] }),
        pick(3),
    );
    assert.deepEqual(reasons(inCall.result), ['Ambiguous']);
    assert.equal(inCall.result.refused[0].operation.label, 'Hal');
    const fromState = apply(log, storyOrder, answer({ FACTS: ['Hal | trait | brave | #4'] }), pick(4));
    assert.deepEqual(reasons(fromState.result), ['Ambiguous']);
    assert.deepEqual(labels(fromState.state), ['Oswin (the miller)', "Oswin (Tamsin's uncle)", 'Halvard', 'Brandt']);
    assert.deepEqual(plain(subjectLabelled(fromState.state, 'Brandt').aka), ['Hal']);
});

test('a repeated subject line adds nothing', () => {
    const log = ScribeLog.create();
    const first = apply(log, storyOrder, answer({ SUBJECTS: ['Halvard | character'] }), pick(1));
    const second = apply(log, storyOrder, answer({ SUBJECTS: ['Halvard | character'] }), pick(2));
    assert.deepEqual(plain(first.result.refused), []);
    assert.deepEqual(plain(second.result.refused), []);
    assert.deepEqual(plain(second.result.entry.operations), []);
    assert.deepEqual(plain(second.state.subjects), [
        { id: 'S1', label: 'Halvard', name: 'Halvard', kind: 'character', assumed: false, aka: [], mergedInto: null },
    ]);
    assert.equal(log.nextSubject, 2);
});

test('an unknown label makes a character, and kind facts set the kind', () => {
    const log = ScribeLog.create();
    const first = apply(log, storyOrder, answer({ FACTS: ['Isolde | trait | calm | #1'] }), pick(1));
    assert.deepEqual(plain(first.result.entry.operations), [
        { type: 'Subject', subject: 'S1', label: 'Isolde', kind: null },
        {
            type: 'Fact',
            fact: 'F1',
            subject: 'S1',
            label: 'Isolde',
            category: 'trait',
            target: null,
            targetText: null,
            other: null,
            text: 'calm',
            cite: 'MESSAGE-1',
            position: 1,
            hidden: false,
        },
    ]);
    assert.equal(subjectLabelled(first.state, 'Isolde').kind, 'character');
    assert.equal(subjectLabelled(first.state, 'Isolde').assumed, true);
    const second = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Isolde | kind | Place | #2', 'Brandt | kind | giant | #2'] }),
        pick(2),
    );
    assert.equal(subjectLabelled(second.state, 'Isolde').kind, 'place');
    assert.equal(subjectLabelled(second.state, 'Isolde').assumed, true);
    assert.equal(subjectLabelled(second.state, 'Brandt').kind, 'character');
    assert.equal(subjectLabelled(second.state, 'Brandt').assumed, true);
    const giant = factSaying(second.state, 'giant');
    assert.equal(giant.status, 'InForce');
    assert.equal(giant.category, 'kind');
    assert.equal(giant.subject, subjectLabelled(second.state, 'Brandt').id);
});

test('joint labels are subjects as written', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ SUBJECTS: ['Halvard | character', 'Mirelle | character'] }), pick(1));
    const { state, result } = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard and Mirelle | trait | inseparable | #2'] }),
        pick(2),
    );
    assert.deepEqual(plain(result.refused), []);
    assert.deepEqual(labels(state), ['Halvard', 'Mirelle', 'Halvard and Mirelle']);
    const joint = subjectLabelled(state, 'Halvard and Mirelle');
    assert.equal(factSaying(state, 'inseparable').subject, joint.id);
    assert.deepEqual(
        plain(state.facts.filter((fact) => fact.subject !== joint.id)),
        [],
    );
});

test('near spellings are listed', () => {
    const log = ScribeLog.create();
    const { state } = apply(
        log,
        storyOrder,
        answer({ SUBJECTS: ['Aldrich | character', 'Aldric | character'] }),
        pick(1),
    );
    const aldrich = subjectLabelled(state, 'Aldrich');
    const aldric = subjectLabelled(state, 'Aldric');
    assert.deepEqual(plain(state.lookAlikes), [{ first: aldrich.id, second: aldric.id, reason: 'Spelling' }]);
});

test('an alias joins a name to a subject', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ SUBJECTS: ['Aldric | character'] }), pick(1));
    const second = apply(
        log,
        storyOrder,
        answer({ NAMES: ['Aldrich | Aldric | #2'], FACTS: ['Aldrich | trait | wary | #2'] }),
        pick(2),
    );
    assert.deepEqual(plain(second.result.entry.operations[0]), {
        type: 'Alias',
        subject: 'S1',
        name: 'Aldrich',
        cite: 'MESSAGE-2',
        position: 2,
        other: null,
    });
    const third = apply(log, storyOrder, answer({ FACTS: ['Aldrich | age | forty | #3'] }), pick(3));
    const state = third.state;
    assert.deepEqual(labels(state), ['Aldric']);
    const aldric = subjectLabelled(state, 'Aldric');
    assert.deepEqual(plain(aldric.aka), ['Aldrich']);
    assert.deepEqual(plain(state.aliases), [{ subject: aldric.id, name: 'Aldrich', cite: 'MESSAGE-2' }]);
    assert.deepEqual(plain(state.lookAlikes), []);
    assert.equal(factSaying(state, 'wary').subject, aldric.id);
    assert.equal(factSaying(state, 'forty').subject, aldric.id);
});

test('an alias to an unknown subject is refused', () => {
    const log = ScribeLog.create();
    const { state, result, parsed } = apply(log, storyOrder, answer({ NAMES: ['Tamsin | Nonette | #1'] }), pick(1));
    assert.deepEqual(reasons(result), ['Reference']);
    assert.equal(result.refused[0].operation, parsed.operations[0]);
    assert.deepEqual(plain(result.entry.operations), []);
    assert.deepEqual(labels(state), []);
    assert.equal(log.nextSubject, 1);
});

test('an alias between two known subjects is a suspected merge', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Aldrich | character', 'Aldric | character'],
            FACTS: ['Aldrich | trait | wary | #1', 'Aldric | trait | bold | #1'],
        }),
        pick(1),
    );
    assert.deepEqual(plain(first.state.lookAlikes.map((item) => item.reason)), ['Spelling']);
    const { state, result } = apply(log, storyOrder, answer({ NAMES: ['Aldrich | Aldric | #2'] }), pick(2));
    const aldrich = subjectLabelled(state, 'Aldrich');
    const aldric = subjectLabelled(state, 'Aldric');
    assert.deepEqual(plain(result.refused), []);
    assert.deepEqual(plain(result.entry.operations), [
        { type: 'Alias', subject: aldric.id, name: 'Aldrich', cite: 'MESSAGE-2', position: 2, other: aldrich.id },
    ]);
    assert.deepEqual(labels(state), ['Aldrich', 'Aldric']);
    assert.equal(factSaying(state, 'wary').subject, aldrich.id);
    assert.equal(factSaying(state, 'bold').subject, aldric.id);
    assert.deepEqual(plain(aldrich.aka), []);
    assert.deepEqual(plain(aldric.aka), ['Aldrich']);
    assert.deepEqual(plain(state.aliases), [{ subject: aldric.id, name: 'Aldrich', cite: 'MESSAGE-2' }]);
    assert.deepEqual(plain(state.lookAlikes), [{ first: aldrich.id, second: aldric.id, reason: 'Alias' }]);
    const later = apply(log, storyOrder, answer({ FACTS: ['Aldrich | age | forty | #3'] }), pick(3));
    assert.deepEqual(plain(later.result.refused), []);
    assert.equal(factSaying(later.state, 'forty').subject, aldrich.id);
    assert.deepEqual(labels(later.state), ['Aldrich', 'Aldric']);
    const reverse = ScribeLog.create();
    apply(
        reverse,
        storyOrder,
        answer({ SUBJECTS: ['Corvane | character', 'Brandt | character'], NAMES: ['Brandt | Corvane | #1'] }),
        pick(1),
    );
    const turned = ScribeReplay.run(reverse, storyOrder);
    assert.deepEqual(plain(turned.lookAlikes), [{ first: 'S1', second: 'S2', reason: 'Alias' }]);
    assert.deepEqual(plain(subjectLabelled(turned, 'Corvane').aka), ['Brandt']);
});

test('an alias that says nothing new is dropped', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ SUBJECTS: ['Aldric | character'] }), pick(1));
    const same = apply(log, storyOrder, answer({ NAMES: ['Aldric | Aldric | #2'] }), pick(2));
    assert.deepEqual(plain(same.result.refused), []);
    assert.deepEqual(plain(same.result.entry.operations), []);
    assert.deepEqual(plain(subjectLabelled(same.state, 'Aldric').aka), []);
    const joined = apply(
        log,
        storyOrder,
        answer({ NAMES: ['Aldrich | Aldric | #3', 'Aldrich | Aldric | #3'] }),
        pick(3),
    );
    assert.deepEqual(plain(joined.result.refused), []);
    assert.equal(joined.result.entry.operations.length, 1);
    const repeat = apply(log, storyOrder, answer({ NAMES: ['Aldrich | Aldric | #4'] }), pick(4));
    assert.deepEqual(plain(repeat.result.refused), []);
    assert.deepEqual(plain(repeat.result.entry.operations), []);
    assert.equal(repeat.state.aliases.length, 1);
    assert.deepEqual(plain(subjectLabelled(repeat.state, 'Aldric').aka), ['Aldrich']);
    assert.deepEqual(labels(repeat.state), ['Aldric']);
});

test('first established stays in force', () => {
    const log = ScribeLog.create();
    const { state } = apply(
        log,
        storyOrder,
        answer({
            FACTS: [
                'Halvard | age | thirty-five | #9',
                'Halvard | age | twenty-five | #3',
                'Halvard | age | thirty | #5',
            ],
        }),
        pick(3, 5, 9),
    );
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.text, fact.status])), [
        ['F2', 'twenty-five', 'InForce'],
        ['F3', 'thirty', 'Disputed'],
        ['F1', 'thirty-five', 'Disputed'],
    ]);
    assert.deepEqual(plain(state.conflicts), [
        { subject: 'S1', category: 'age', target: null, established: 'F2', others: ['F3', 'F1'] },
    ]);
});

test('story order beats reading order', () => {
    const log = ScribeLog.create();
    const early = apply(log, storyOrder, answer({ FACTS: ['Halvard | age | thirty | #9'] }), pick(9));
    assert.equal(factSaying(early.state, 'thirty').status, 'InForce');
    const { state } = apply(log, storyOrder, answer({ FACTS: ['Halvard | age | twenty-five | #3'] }), pick(3));
    const twentyFive = factSaying(state, 'twenty-five');
    const thirty = factSaying(state, 'thirty');
    assert.equal(twentyFive.status, 'InForce');
    assert.equal(thirty.status, 'Disputed');
    assert.deepEqual(plain(state.conflicts), [
        { subject: 'S1', category: 'age', target: null, established: twentyFive.id, others: [thirty.id] },
    ]);
});

test('a repeated fixed value is dropped', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | eyes | grey | #1'] }), pick(1));
    const repeat = apply(log, storyOrder, answer({ FACTS: ['Halvard | eyes | Grey. | #2'] }), pick(2));
    assert.equal(repeat.result.entry.operations.length, 1);
    assert.deepEqual(plain(repeat.state.facts.map((fact) => [fact.id, fact.status])), [['F1', 'InForce']]);
    apply(log, storyOrder, answer({ FACTS: ['Halvard | eyes | blue | #3'] }), pick(3));
    const disputed = apply(log, storyOrder, answer({ FACTS: ['Halvard | eyes | Blue | #4'] }), pick(4));
    assert.deepEqual(plain(disputed.state.facts.map((fact) => [fact.id, fact.text, fact.status])), [
        ['F1', 'grey', 'InForce'],
        ['F3', 'blue', 'Disputed'],
    ]);
    assert.deepEqual(plain(disputed.state.conflicts), [
        { subject: 'S1', category: 'eyes', target: null, established: 'F1', others: ['F3'] },
    ]);
});

test('the code never judges a fuller wording', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | eyes | pale grey | #1'] }), pick(1));
    const { state } = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | eyes | pale grey ringed with amber | #2'] }),
        pick(2),
    );
    assert.equal(factSaying(state, 'pale grey').status, 'InForce');
    assert.equal(factSaying(state, 'pale grey ringed with amber').status, 'Disputed');
    assert.deepEqual(plain(state.conflicts), [
        { subject: 'S1', category: 'eyes', target: null, established: 'F1', others: ['F2'] },
    ]);
    assert.deepEqual(plain(state.refinements), []);
});

test("a fuller statement replaces by the Analyzer's word", () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | eyes | pale grey | #1'] }), pick(1));
    const { state, result } = apply(
        log,
        storyOrder,
        answer({ CHANGES: ['F1 | Halvard | eyes | FULLER: pale grey ringed with amber | #5'] }),
        pick(5),
    );
    assert.deepEqual(plain(result.entry.operations), [
        {
            type: 'Refine',
            fact: 'F1',
            becomes: 'F2',
            subject: 'S1',
            label: 'Halvard',
            category: 'eyes',
            target: null,
            targetText: null,
            other: null,
            hidden: false,
            text: 'pale grey ringed with amber',
            cite: 'MESSAGE-5',
            position: 5,
        },
    ]);
    const fuller = factSaying(state, 'pale grey ringed with amber');
    const plainer = factSaying(state, 'pale grey');
    assert.equal(fuller.id, 'F2');
    assert.equal(fuller.status, 'InForce');
    assert.equal(fuller.subject, plainer.subject);
    assert.equal(fuller.category, 'eyes');
    assert.equal(fuller.position, 5);
    assert.equal(plainer.status, 'Replaced');
    assert.equal(plainer.replacedBy, 'F2');
    assert.deepEqual(plain(state.conflicts), []);
    assert.deepEqual(plain(state.refinements), [{ from: 'F1', to: 'F2' }]);
});

test('a refinement of a disputed value keeps the dispute', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | age | twenty-five | #1', 'Halvard | age | thirty | #2'] }),
        pick(1, 2),
    );
    const { state } = apply(
        log,
        storyOrder,
        answer({ CHANGES: ['F2 | Halvard | age | FULLER: thirty winters | #3'] }),
        pick(3),
    );
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.text, fact.status, fact.replacedBy])), [
        ['F1', 'twenty-five', 'InForce', null],
        ['F2', 'thirty', 'Replaced', 'F3'],
        ['F3', 'thirty winters', 'Disputed', null],
    ]);
    assert.deepEqual(plain(state.conflicts), [
        { subject: 'S1', category: 'age', target: null, established: 'F1', others: ['F3'] },
    ]);
    assert.deepEqual(plain(state.refinements), [{ from: 'F2', to: 'F3' }]);
});

test('the thinner wording after a refinement is dropped', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | eyes | pale grey | #1'] }), pick(1));
    apply(
        log,
        storyOrder,
        answer({ CHANGES: ['F1 | Halvard | eyes | FULLER: pale grey ringed with amber | #5'] }),
        pick(5),
    );
    const { state } = apply(log, storyOrder, answer({ FACTS: ['Halvard | eyes | pale grey | #7'] }), pick(7));
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.status])), [
        ['F1', 'Replaced'],
        ['F2', 'InForce'],
    ]);
    assert.deepEqual(plain(state.conflicts), []);
});

test('a refinement whose fact has gone stands as a fact', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | eyes | pale grey | #1'] }), pick(1));
    apply(
        log,
        storyOrder,
        answer({ CHANGES: ['F1 | Halvard | eyes | FULLER: pale grey ringed with amber | #5'] }),
        pick(5),
    );
    log.entries[0].withdrawn = true;
    const state = ScribeReplay.run(log, storyOrder);
    assert.deepEqual(plain(state.facts), [
        {
            id: 'F2',
            subject: 'S1',
            category: 'eyes',
            target: null,
            targetText: null,
            text: 'pale grey ringed with amber',
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
    assert.deepEqual(labels(state), ['Halvard']);
});

test('moving values move on', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | location | the mill | #1', 'Halvard | location | the harbour | #3'] }),
        pick(1, 3),
    );
    const second = ScribeReplay.run(log, storyOrder);
    assert.deepEqual(plain(second.facts.map((fact) => [fact.id, fact.status, fact.replacedBy])), [
        ['F1', 'Replaced', 'F2'],
        ['F2', 'InForce', null],
    ]);
    const { state } = apply(log, storyOrder, answer({ FACTS: ['Halvard | location | the harbour | #5'] }), pick(5));
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.status, fact.replacedBy])), [
        ['F1', 'Replaced', 'F2'],
        ['F2', 'Replaced', 'F3'],
        ['F3', 'InForce', null],
    ]);
    assert.deepEqual(plain(state.conflicts), []);
});

test('relations are kept per target', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Tamsin | character'],
            FACTS: ['Halvard | relation to Mirelle | sworn allies | #1', 'Halvard | relation to Tamsin | wary of her | #2'],
        }),
        pick(1, 2),
    );
    const both = ScribeReplay.run(log, storyOrder);
    assert.deepEqual(plain(both.facts.map((fact) => [fact.id, fact.target, fact.status])), [
        ['F1', 'S2', 'InForce'],
        ['F2', 'S3', 'InForce'],
    ]);
    const { state } = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | relation to Mirelle | bitter rivals | #3'] }),
        pick(3),
    );
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.status, fact.replacedBy])), [
        ['F1', 'Replaced', 'F3'],
        ['F2', 'InForce', null],
        ['F3', 'InForce', null],
    ]);
});

test('a relation target is kept as written', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: [
                'Halvard | character',
                'Orla | character',
                'Maren | character',
                'Mirelle | character',
                'Oswin (the miller) | character',
                "Oswin (Tamsin's uncle) | character",
            ],
        }),
        pick(1),
    );
    const { state, result } = apply(
        log,
        storyOrder,
        answer({
            FACTS: [
                'Halvard | relation to Orla and Maren | protective of them | #2',
                'Halvard | relation to Mirelle | sworn allies | #2',
                'Halvard | relation to Brandt | owes him a debt | #2',
                'Halvard | relation to Oswin | buys his flour | #2',
            ],
        }),
        pick(2),
    );
    assert.deepEqual(plain(result.refused), []);
    assert.deepEqual(labels(state), [
        'Halvard',
        'Orla',
        'Maren',
        'Mirelle',
        'Oswin (the miller)',
        "Oswin (Tamsin's uncle)",
    ]);
    const mirelle = subjectLabelled(state, 'Mirelle');
    assert.deepEqual(plain(state.facts.map((fact) => [fact.text, fact.category, fact.target, fact.targetText, fact.status])), [
        ['protective of them', 'relation', null, 'Orla and Maren', 'InForce'],
        ['sworn allies', 'relation', mirelle.id, 'Mirelle', 'InForce'],
        ['owes him a debt', 'relation', null, 'Brandt', 'InForce'],
        ['buys his flour', 'relation', null, 'Oswin', 'InForce'],
    ]);
});

test('a relation written before its target was known is replaced', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | relation to Maren | old friends | #1'] }),
        pick(1),
    );
    assert.equal(factSaying(first.state, 'old friends').target, null);
    apply(log, storyOrder, answer({ SUBJECTS: ['Maren | character'] }), pick(2));
    const { state } = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | relation to Maren | estranged | #3'] }),
        pick(3),
    );
    const maren = subjectLabelled(state, 'Maren');
    const older = factSaying(state, 'old friends');
    const newer = factSaying(state, 'estranged');
    assert.equal(older.status, 'Replaced');
    assert.equal(older.replacedBy, newer.id);
    assert.equal(newer.status, 'InForce');
    assert.equal(newer.target, maren.id);
});

test('one side of a relation goes stale', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ SUBJECTS: ['Halvard | character', 'Tamsin | character'] }), pick(1));
    apply(log, storyOrder, answer({ FACTS: ['Halvard | relation to Tamsin | trusts her | #5'] }), pick(5));
    const reply = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Tamsin | relation to Halvard | resents him | #20'] }),
        pick(20),
    );
    assert.deepEqual(plain(reply.state.stale), [{ subject: 'S1', target: 'S2' }]);
    const restated = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | relation to Tamsin | trusts her still | #21'] }),
        pick(21),
    );
    assert.deepEqual(plain(restated.state.stale), []);
    const fresh = ScribeLog.create();
    const together = apply(
        fresh,
        storyOrder,
        answer({
            SUBJECTS: ['Kira | character', 'Brandt | character'],
            FACTS: ['Kira | relation to Brandt | owes him | #7', 'Brandt | relation to Kira | trusts her | #7'],
        }),
        pick(7),
    );
    assert.deepEqual(plain(together.state.stale), []);
});

test('list repeats are dropped', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | trait | teases younger girls | #1'] }), pick(1));
    const repeat = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | trait | Teases younger girls. | #2'] }),
        pick(2),
    );
    assert.deepEqual(plain(repeat.state.facts.map((fact) => fact.id)), ['F1']);
    const other = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | trait | hums when nervous | #3', 'Halvard | condition | bruised ribs | #3'] }),
        pick(3),
    );
    assert.deepEqual(plain(other.state.facts.map((fact) => [fact.id, fact.text, fact.status])), [
        ['F1', 'teases younger girls', 'InForce'],
        ['F3', 'hums when nervous', 'InForce'],
        ['F4', 'bruised ribs', 'InForce'],
    ]);
    apply(
        log,
        storyOrder,
        answer({ CHANGES: ['F1 | Halvard | trait | FULLER: teases younger girls without mercy | #4'] }),
        pick(4),
    );
    const back = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | trait | teases younger girls | #5'] }),
        pick(5),
    );
    assert.deepEqual(plain(back.state.facts.map((fact) => [fact.id, fact.status])), [
        ['F1', 'Replaced'],
        ['F3', 'InForce'],
        ['F4', 'InForce'],
        ['F5', 'InForce'],
        ['F6', 'InForce'],
    ]);
});

test("a withdrawn entry's facts vanish and its subjects stay", () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | age | twenty-five | #1'] }), pick(1));
    const both = apply(log, storyOrder, answer({ FACTS: ['Halvard | age | thirty | #2'] }), pick(2));
    assert.equal(factSaying(both.state, 'thirty').status, 'Disputed');
    assert.deepEqual(plain(both.result.entry.operations.map((operation) => operation.type)), ['Fact']);
    log.entries[0].withdrawn = true;
    const state = ScribeReplay.run(log, storyOrder);
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.text, fact.status])), [['F2', 'thirty', 'InForce']]);
    assert.deepEqual(plain(state.conflicts), []);
    assert.deepEqual(plain(state.subjects), [
        { id: 'S1', label: 'Halvard', name: 'Halvard', kind: 'character', assumed: true, aka: [], mergedInto: null },
    ]);
});

test('a fact whose message has gone is skipped', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | trait | proud | #4'] }), pick(4));
    apply(log, storyOrder, answer({ FACTS: ['Halvard | trait | loyal | #4'] }), pick(4), 'Notes');
    const whole = ScribeReplay.run(log, storyOrder);
    assert.deepEqual(plain(whole.facts.map((fact) => [fact.text, fact.position, fact.origin])), [
        ['proud', 4, 'Story'],
        ['loyal', 4, 'Notes'],
    ]);
    const without = storyOrder.filter((id) => id !== 'MESSAGE-4');
    const state = ScribeReplay.run(log, without);
    assert.deepEqual(plain(state.facts.map((fact) => [fact.text, fact.position, fact.origin, fact.cite])), [
        ['loyal', 4, 'Notes', 'MESSAGE-4'],
    ]);
    assert.deepEqual(labels(state), ['Halvard']);
});

test('questions are numbered and kept', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ QUESTIONS: ['Does Mirelle trust Halvard? | #5', 'Who sent the letter? | #3'] }),
        pick(3, 5),
    );
    const { state } = apply(log, storyOrder, answer({ QUESTIONS: ['Where did Kira go? | #4'] }), pick(4));
    assert.deepEqual(plain(state.questions), [
        { id: 'Q2', text: 'Who sent the letter?', cite: 'MESSAGE-3', position: 3, answer: null, dismissed: false },
        { id: 'Q3', text: 'Where did Kira go?', cite: 'MESSAGE-4', position: 4, answer: null, dismissed: false },
        { id: 'Q1', text: 'Does Mirelle trust Halvard?', cite: 'MESSAGE-5', position: 5, answer: null, dismissed: false },
    ]);
    assert.equal(log.nextQuestion, 4);
});

test('threads open and close', () => {
    const log = ScribeLog.create();
    const first = apply(log, storyOrder, answer({ THREADS: ['OPEN | the missing ledger | #3'] }), pick(3));
    assert.deepEqual(plain(first.state.threads), [
        { id: 'T1', text: 'the missing ledger', cite: 'MESSAGE-3', position: 3, closed: null },
    ]);
    const second = apply(
        log,
        storyOrder,
        answer({ THREADS: ['OPEN | the broken seal | #4', 'CLOSE T1 | the ledger was found | #5'] }),
        pick(4, 5),
    );
    assert.deepEqual(plain(second.state.threads.map((thread) => [thread.id, thread.closed])), [
        ['T1', { how: 'the ledger was found', cite: 'MESSAGE-5', position: 5 }],
        ['T2', null],
    ]);
    const third = apply(
        log,
        storyOrder,
        answer({ THREADS: ['CLOSE T2 | #6', 'CLOSE T1 | found a second time | #7'] }),
        pick(6, 7),
    );
    assert.deepEqual(plain(third.result.refused), []);
    assert.deepEqual(plain(third.state.threads), [
        {
            id: 'T1',
            text: 'the missing ledger',
            cite: 'MESSAGE-3',
            position: 3,
            closed: { how: 'the ledger was found', cite: 'MESSAGE-5', position: 5 },
        },
        {
            id: 'T2',
            text: 'the broken seal',
            cite: 'MESSAGE-4',
            position: 4,
            closed: { how: '', cite: 'MESSAGE-6', position: 6 },
        },
    ]);
});

test('scenes resolve their people', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Halvard | character', 'Oswin (the miller) | character', "Oswin (Tamsin's uncle) | character"],
        }),
        pick(1),
    );
    const { state, result, parsed } = apply(
        log,
        storyOrder,
        answer({
            SCENES: [
                'Day 4 | #2-#3 | The hall | public | present: Halvard, Kira (from #3), Halvard | They talk',
                'Day 4 | #2-#9 | The hall | public | present: Halvard, Isolde | They talk',
                'Day 4 | #1-#3 | The hall | public | present: Halvard, Isolde | They talk',
                'Day 5 | #3 | The yard | private | present: Nonette, Oswin | They argue',
            ],
            FACTS: ['Maren | trait | calm | #3'],
        }),
        pick(2, 3),
    );
    assert.deepEqual(reasons(result), ['Citation', 'Citation', 'Ambiguous']);
    result.refused.forEach((item, index) => assert.equal(item.operation, parsed.operations[index + 1]));
    assert.deepEqual(plain(result.entry.operations), [
        { type: 'Subject', subject: 'S4', label: 'Kira', kind: null },
        {
            type: 'Scene',
            day: 4,
            first: 'MESSAGE-2',
            last: 'MESSAGE-3',
            firstPosition: 2,
            lastPosition: 3,
            place: 'The hall',
            reach: 'Public',
            present: [
                { subject: 'S1', label: 'Halvard', from: null, until: null },
                { subject: 'S4', label: 'Kira', from: 3, until: null },
                { subject: 'S1', label: 'Halvard', from: null, until: null },
            ],
            summary: 'They talk',
        },
        { type: 'Subject', subject: 'S5', label: 'Maren', kind: null },
        {
            type: 'Fact',
            fact: 'F1',
            subject: 'S5',
            label: 'Maren',
            category: 'trait',
            target: null,
            targetText: null,
            other: null,
            text: 'calm',
            cite: 'MESSAGE-3',
            position: 3,
            hidden: false,
        },
    ]);
    assert.deepEqual(labels(state), [
        'Halvard',
        'Oswin (the miller)',
        "Oswin (Tamsin's uncle)",
        'Kira',
        'Maren',
    ]);
    assert.deepEqual(plain(state.scenes), [
        {
            id: 'MESSAGE-2',
            day: 4,
            first: 'MESSAGE-2',
            last: 'MESSAGE-3',
            firstPosition: 2,
            lastPosition: 3,
            place: 'The hall',
            reach: 'Public',
            narrowed: false,
            present: [
                { subject: 'S1', from: null, until: null },
                { subject: 'S4', from: 3, until: null },
                { subject: 'S1', from: null, until: null },
            ],
            summary: 'They talk',
        },
    ]);
});

test('the state is frozen and the log survives JSON', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Aldrich | character', 'Aldric | character', 'Halvard | character', 'Tamsin | character'],
            NAMES: ['Hal | Halvard | #1'],
            FACTS: [
                'Halvard | age | twenty-five | #1',
                'Halvard | age | thirty | #2',
                'Halvard | eyes | pale grey | #1',
                'Halvard | relation to Tamsin | trusts her | #1',
                'Halvard | aka | the Hawk | #2',
                'Halvard | background | charged a line of pikes | hidden | #2',
            ],
            THREADS: ['OPEN | the missing ledger | #1'],
            QUESTIONS: ['Does Tamsin trust Halvard? | #2'],
            NIGHTS: ['#2 | the lamps go out'],
            SCENES: ['Day 1 | #1-#2 | The hall | public | present: Halvard, Tamsin (until #2) | They talk'],
        }),
        pick(1, 2),
    );
    const { state, result } = apply(
        log,
        storyOrder,
        answer({
            FACTS: ['Tamsin | relation to Halvard | wary of him | #4', 'Corvane | trait | sly | #99'],
            CHANGES: ['F3 | Halvard | eyes | FULLER: pale grey ringed with amber | #3'],
            TOLD: ['F1 | Halvard | Tamsin | #3'],
            THREADS: ['CLOSE T1 | the ledger was found | #4'],
        }),
        pick(3, 4),
    );
    assert.deepEqual(reasons(result), ['Citation']);
    assert.ok(state.subjects.length > 0);
    assert.deepEqual(plain(subjectLabelled(state, 'Halvard').aka), ['Hal', 'the Hawk']);
    assert.ok(state.facts.length > 0);
    assert.ok(state.threads[0].closed !== null);
    assert.ok(state.conflicts.length > 0);
    assert.ok(state.lookAlikes.length > 0);
    assert.ok(state.stale.length > 0);
    assert.ok(state.refinements.length > 0);
    assert.ok(state.aliases.length > 0);
    assert.ok(state.questions.length > 0);
    assert.equal(factSaying(state, 'charged a line of pikes').hidden, true);
    assertFrozenDeep(state, 'state');
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.refused), true);
    assert.equal(Object.isFrozen(result.refused[0]), true);
    assert.equal(Object.isFrozen(result.entry), false);
    assert.equal(result.entry, log.entries.at(-1));
    assert.equal(Object.isFrozen(log), false);
    assert.equal(Object.isFrozen(log.entries[0]), false);
    assert.equal(Object.isFrozen(log.entries[0].operations), false);
    assert.equal(Object.isFrozen(log.entries[0].operations[0]), false);
    assertJsonSafe(log, 'log');
    const before = plain(log);
    const replayed = ScribeReplay.run(log, storyOrder);
    assert.deepEqual(plain(log), before);
    assert.deepEqual(replayed, state);
    const copy = plain(log);
    assert.deepEqual(copy, before);
    assert.deepEqual(ScribeReplay.run(copy, storyOrder), state);
    assert.deepEqual(plain(ScribeReplay.run(copy, storyOrder)), plain(state));
});

test('a large log replays quickly', () => {
    const large = new CampaignBuilder('Orla');
    for (let number = 1; number <= 50; number++) {
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
    const subjects = Array.from({ length: 300 }, (unused, index) => `${names[index % names.length]} ${index + 1}`);
    const early = 50;
    const log = ScribeLog.create();
    for (let round = 0; round < 50; round++) {
        const last = round === 49;
        const lines = [];
        for (let count = 0; count < 100; count++) {
            const serial = round * 100 + count;
            const subject = last ? subjects[early + ((count * 5) % (300 - early))] : subjects[serial % early];
            const categories = ['trait', 'location', `relation to ${subjects[(serial + 7) % early]}`, 'age'];
            lines.push(`${subject} | ${categories[serial % 4]} | detail ${serial} | #${round + 1}`);
        }
        const blocks = last
            ? { SUBJECTS: subjects.slice(early).map((label) => `${label} | character`), FACTS: lines }
            : { FACTS: lines };
        const parsed = ScribeAnswer.parse(answer(blocks));
        assert.equal(parsed.operations.length, last ? 350 : 100);
        const result = ScribeLog.append(log, ScribeReplay.run(log, order), parsed.operations, {
            messages: [messages[round]],
            origin: 'Story',
        });
        assert.deepEqual(plain(result.refused), []);
    }
    const started = performance.now();
    const state = ScribeReplay.run(log, order);
    const elapsed = performance.now() - started;
    assert.equal(state.subjects.length, 300);
    assert.equal(state.facts.length, 5000);
    assert.ok(elapsed < 20000, `replay took ${elapsed} ms`);
});

test("an alias that takes another subject's aka makes the name ambiguous", () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ SUBJECTS: ['Halvard | character', 'Brandt | character'], FACTS: ['Halvard | aka | Hal | #1'] }),
        pick(1),
    );
    const taken = apply(
        log,
        storyOrder,
        answer({ NAMES: ['Hal | Brandt | #2'], FACTS: ['Hal | trait | grumpy | #2'] }),
        pick(2),
    );
    const halvard = subjectLabelled(taken.state, 'Halvard');
    const brandt = subjectLabelled(taken.state, 'Brandt');
    assert.deepEqual(reasons(taken.result), ['Ambiguous']);
    assert.equal(taken.result.refused[0].operation, taken.parsed.operations[1]);
    assert.deepEqual(plain(taken.result.entry.operations), [
        { type: 'Alias', subject: brandt.id, name: 'Hal', cite: 'MESSAGE-2', position: 2, other: halvard.id },
    ]);
    assert.deepEqual(plain(taken.state.facts.map((fact) => fact.text)), ['Hal']);
    assert.deepEqual(plain(halvard.aka), ['Hal']);
    assert.deepEqual(plain(brandt.aka), ['Hal']);
    assert.deepEqual(plain(taken.state.lookAlikes), [{ first: halvard.id, second: brandt.id, reason: 'Alias' }]);
    const later = apply(log, storyOrder, answer({ FACTS: ['Hal | trait | weary | #3'] }), pick(3));
    assert.deepEqual(reasons(later.result), ['Ambiguous']);
    assert.deepEqual(plain(later.result.entry.operations), []);
    assert.deepEqual(labels(later.state), ['Halvard', 'Brandt']);
});

test('an aka fact that names another subject raises a look-alike', () => {
    const log = ScribeLog.create();
    const first = apply(log, storyOrder, answer({ SUBJECTS: ['Hal | character', 'Halvard | character'] }), pick(1));
    assert.deepEqual(plain(first.state.lookAlikes), []);
    const hal = subjectLabelled(first.state, 'Hal');
    const halvard = subjectLabelled(first.state, 'Halvard');
    const named = apply(log, storyOrder, answer({ FACTS: ['Halvard | aka | Hal | #2'] }), pick(2));
    assert.equal(named.result.entry.operations[0].other, hal.id);
    assert.equal(named.result.entry.operations[0].subject, halvard.id);
    assert.deepEqual(plain(named.state.lookAlikes), [{ first: hal.id, second: halvard.id, reason: 'Alias' }]);
    assert.deepEqual(plain(subjectLabelled(named.state, 'Halvard').aka), ['Hal']);
    const later = apply(log, storyOrder, answer({ FACTS: ['Hal | trait | small | #3'] }), pick(3));
    assert.deepEqual(plain(later.result.refused), []);
    assert.equal(factSaying(later.state, 'small').subject, hal.id);
    assert.deepEqual(labels(later.state), ['Hal', 'Halvard']);
});

test('only an aka fact lends a name', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | title | Captain | #1'] }), pick(1));
    const { state } = apply(log, storyOrder, answer({ FACTS: ['Captain | trait | stern | #2'] }), pick(2));
    assert.deepEqual(labels(state), ['Halvard', 'Captain']);
    const halvard = subjectLabelled(state, 'Halvard');
    assert.equal(factSaying(state, 'stern').subject, subjectLabelled(state, 'Captain').id);
    assert.notEqual(factSaying(state, 'stern').subject, halvard.id);
    assert.deepEqual(plain(halvard.aka), []);
    const same = apply(
        ScribeLog.create(),
        storyOrder,
        answer({ FACTS: ['Halvard | title | Captain | #1', 'Captain | trait | loud | #1'] }),
        pick(1),
    );
    assert.deepEqual(labels(same.state), ['Halvard', 'Captain']);
    assert.equal(factSaying(same.state, 'loud').subject, subjectLabelled(same.state, 'Captain').id);
});

test('a renamed aka keeps the old name', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | aka | Hal | #1'] }), pick(1));
    const fuller = apply(
        log,
        storyOrder,
        answer({ CHANGES: ['F1 | Halvard | aka | FULLER: Hal the Bold | #2'] }),
        pick(2),
    );
    assert.equal(factSaying(fuller.state, 'Hal').status, 'Replaced');
    assert.equal(factSaying(fuller.state, 'Hal the Bold').status, 'InForce');
    assert.deepEqual(plain(subjectLabelled(fuller.state, 'Halvard').aka), ['Hal', 'Hal the Bold']);
    const later = apply(log, storyOrder, answer({ FACTS: ['Hal | trait | brave | #3'] }), pick(3));
    assert.deepEqual(plain(later.result.refused), []);
    assert.deepEqual(labels(later.state), ['Halvard']);
    assert.equal(factSaying(later.state, 'brave').subject, subjectLabelled(later.state, 'Halvard').id);
});

test('a name that becomes ambiguous later in the answer refuses the earlier lines', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ SUBJECTS: ['Oswin (the miller) | character'] }), pick(1));
    const { state, result, parsed } = apply(
        log,
        storyOrder,
        answer({
            SCENES: ['Day 1 | #2 | The mill | public | present: Nonette, Oswin | They talk'],
            FACTS: ['Oswin | trait | quiet | #2', "Oswin (Tamsin's uncle) | trait | loud | #2"],
        }),
        pick(2),
    );
    const uncle = subjectLabelled(state, "Oswin (Tamsin's uncle)");
    assert.deepEqual(reasons(result), ['Ambiguous', 'Ambiguous']);
    assert.equal(result.refused[0].operation, parsed.operations[0]);
    assert.equal(result.refused[1].operation, parsed.operations[1]);
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.text, fact.subject])), [['F1', 'loud', uncle.id]]);
    assert.deepEqual(plain(result.entry.operations.map((operation) => [operation.type, operation.label ?? null])), [
        ['Subject', "Oswin (Tamsin's uncle)"],
        ['Fact', "Oswin (Tamsin's uncle)"],
    ]);
    assert.deepEqual(labels(state), ['Oswin (the miller)', "Oswin (Tamsin's uncle)"]);
    assert.equal(uncle.id, 'S2');
    assert.equal(log.nextFact, 2);
    const other = ScribeLog.create();
    apply(other, storyOrder, answer({ FACTS: ['Halvard | aka | Hal | #1'] }), pick(1));
    const second = apply(
        other,
        storyOrder,
        answer({ FACTS: ['Hal | trait | brave | #2', 'Brandt | aka | Hal | #2', 'Hal | trait | proud | #2'] }),
        pick(2),
    );
    assert.deepEqual(reasons(second.result), ['Ambiguous', 'Ambiguous']);
    assert.equal(second.result.refused[0].operation, second.parsed.operations[0]);
    assert.equal(second.result.refused[1].operation, second.parsed.operations[2]);
    assert.deepEqual(plain(second.state.facts.map((fact) => [fact.id, fact.text, fact.subject])), [
        ['F1', 'Hal', 'S1'],
        ['F2', 'Hal', 'S2'],
    ]);
    assert.equal(other.nextFact, 3);
});

test('a relation to someone named later in the answer is linked', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | relation to Mirelle | sends her letters | #1', 'Mirelle | trait | shy | #1'] }),
        pick(1),
    );
    const halvard = subjectLabelled(first.state, 'Halvard');
    const mirelle = subjectLabelled(first.state, 'Mirelle');
    assert.equal(factSaying(first.state, 'sends her letters').target, mirelle.id);
    assert.equal(first.result.entry.operations[1].target, mirelle.id);
    const second = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Mirelle | relation to Halvard | wary of him | #5'] }),
        pick(5),
    );
    assert.deepEqual(plain(second.state.stale), [{ subject: halvard.id, target: mirelle.id }]);
});

test('subject names drop every bracket', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: [
                'Sir (Lord) Halvard | character',
                'Oswin (the (old) miller) | character',
                'Orla (aunt) (the elder) | character',
                'Kira [the smith] | character',
                'Oswin (the miller | character',
                '(the miller) | character',
                'Brandt  the   Elder [of the watch] | character',
            ],
        }),
        pick(1),
    );
    const { state, result } = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Kira | trait | strong | #2', 'Sir | trait | bold | #2'] }),
        pick(2),
    );
    assert.deepEqual(plain(state.subjects.map((subject) => [subject.label, subject.name])), [
        ['Sir (Lord) Halvard', 'Sir Halvard'],
        ['Oswin (the (old) miller)', 'Oswin'],
        ['Orla (aunt) (the elder)', 'Orla'],
        ['Kira [the smith]', 'Kira'],
        ['Oswin (the miller', 'Oswin'],
        ['(the miller)', '(the miller)'],
        ['Brandt  the   Elder [of the watch]', 'Brandt the Elder'],
        ['Sir', 'Sir'],
    ]);
    assert.deepEqual(plain(result.refused), []);
    assert.equal(factSaying(state, 'strong').subject, subjectLabelled(state, 'Kira [the smith]').id);
    assert.equal(factSaying(state, 'bold').subject, subjectLabelled(state, 'Sir').id);
    assert.notEqual(factSaying(state, 'bold').subject, subjectLabelled(state, 'Sir (Lord) Halvard').id);
});

test('kinds are declared or assumed', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        storyOrder,
        answer({ SUBJECTS: ['Halvard | character'], FACTS: ['Corvane | trait | windswept | #1'] }),
        pick(1),
    );
    const corvane = subjectLabelled(first.state, 'Corvane');
    assert.equal(corvane.kind, 'character');
    assert.equal(corvane.assumed, true);
    assert.equal(subjectLabelled(first.state, 'Halvard').assumed, false);
    assert.deepEqual(plain(first.result.entry.operations.filter((operation) => operation.type === 'Subject')), [
        { type: 'Subject', subject: 'S1', label: 'Halvard', kind: 'character' },
        { type: 'Subject', subject: 'S2', label: 'Corvane', kind: null },
    ]);
    const declared = apply(log, storyOrder, answer({ SUBJECTS: ['Corvane | place'] }), pick(2));
    assert.deepEqual(plain(declared.result.refused), []);
    assert.deepEqual(plain(declared.result.entry.operations), [
        { type: 'Subject', subject: corvane.id, label: 'Corvane', kind: 'place' },
    ]);
    assert.deepEqual(labels(declared.state), ['Halvard', 'Corvane']);
    assert.equal(subjectLabelled(declared.state, 'Corvane').kind, 'place');
    assert.equal(subjectLabelled(declared.state, 'Corvane').assumed, false);
    assert.equal(log.nextSubject, 3);
    const stated = apply(log, storyOrder, answer({ FACTS: ['Isolde | kind | place | #3'] }), pick(3));
    assert.equal(subjectLabelled(stated.state, 'Isolde').kind, 'place');
    assert.equal(subjectLabelled(stated.state, 'Isolde').assumed, true);
});

test('a subject line of another kind is refused with its lines', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Corvane | place', 'Halvard | character'],
            FACTS: ['Corvane | feature | a ruined tower | #1', 'Halvard | age | forty | #1'],
        }),
        pick(1),
    );
    const clash = apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Corvane | character'],
            NAMES: ['Corvane | Halvard | #2', 'Hal | Corvane | #2'],
            FACTS: ['Corvane | trait | sly | #2', 'Halvard | trait | patient | #2'],
            TOLD: ['F2 | Halvard | Corvane | #2'],
            SCENES: ['Day 2 | #2 | The road | public | present: Halvard, Corvane | They meet'],
        }),
        pick(2),
    );
    assert.deepEqual(reasons(clash.result), ['Mismatch', 'Mismatch', 'Mismatch', 'Mismatch', 'Mismatch', 'Mismatch']);
    assert.deepEqual(plain(clash.result.refused.map((item) => item.operation.type)), [
        'Subject',
        'Alias',
        'Alias',
        'Fact',
        'Told',
        'Scene',
    ]);
    assert.deepEqual(plain(clash.result.entry.operations.map((operation) => operation.type)), ['Fact']);
    const corvane = subjectLabelled(clash.state, 'Corvane');
    assert.equal(factSaying(clash.state, 'patient').subject, subjectLabelled(clash.state, 'Halvard').id);
    assert.deepEqual(labels(clash.state), ['Corvane', 'Halvard']);
    assert.equal(corvane.kind, 'place');
    const later = apply(log, storyOrder, answer({ FACTS: ['Corvane | trait | windswept | #3'] }), pick(3));
    assert.deepEqual(plain(later.result.refused), []);
    assert.equal(factSaying(later.state, 'windswept').subject, corvane.id);
    const repeat = apply(log, storyOrder, answer({ SUBJECTS: ['Corvane | place'] }), pick(4));
    assert.deepEqual(plain(repeat.result.refused), []);
    assert.deepEqual(plain(repeat.result.entry.operations), []);
    assert.deepEqual(labels(repeat.state), ['Corvane', 'Halvard']);
});

test('written labels are kept', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Halvard | character'],
            FACTS: ['Halvard | aka | Hal | #1'],
            THREADS: ['OPEN | the missing ledger | #1'],
        }),
        pick(1),
    );
    const halvard = subjectLabelled(first.state, 'Halvard');
    const { result } = apply(
        log,
        storyOrder,
        answer({
            NAMES: ['Hawk | Hal | #2'],
            FACTS: ['Hal | trait | proud | #3'],
            CHANGES: ['F1 | Hal | aka | FULLER: Hal the Bold | #2', 'F1 | Hal | aka | ENDED: dropped it | #3'],
            TOLD: ['F1 | Hal | Hal | #3'],
            SCENES: ['Day 1 | #2-#3 | The hall | public | present: Hal | They talk'],
            NIGHTS: ['#3 | the lamps go out'],
            THREADS: ['OPEN | the broken seal | #2', 'CLOSE T1 | found | #3'],
            QUESTIONS: ['Who is the Hawk? | #2'],
        }),
        pick(2, 3),
    );
    assert.deepEqual(plain(result.refused), []);
    const operations = plain(result.entry.operations);
    const fact = operations.find((operation) => operation.type === 'Fact');
    const told = operations.find((operation) => operation.type === 'Told');
    const scene = operations.find((operation) => operation.type === 'Scene');
    const refine = operations.find((operation) => operation.type === 'Refine');
    const end = operations.find((operation) => operation.type === 'End');
    assert.deepEqual([fact.label, fact.subject], ['Hal', halvard.id]);
    assert.deepEqual([told.owner, told.label, told.subject], ['Hal', 'Hal', halvard.id]);
    assert.deepEqual([refine.label, refine.subject], ['Hal', halvard.id]);
    assert.equal(end.label, 'Hal');
    assert.deepEqual(scene.present, [{ subject: halvard.id, label: 'Hal', from: null, until: null }]);
    const cited = operations.filter((operation) => Object.hasOwn(operation, 'cite'));
    assert.equal(cited.length, 9);
    for (const operation of cited) {
        assert.equal(operation.position, Number(operation.cite.slice('MESSAGE-'.length)), operation.type);
    }
});

test('append refuses a stale state or an unknown origin', () => {
    const log = ScribeLog.create();
    const old = ScribeReplay.run(log, storyOrder);
    const making = ScribeAnswer.parse(answer({ FACTS: ['Halvard | trait | proud | #1'] })).operations;
    ScribeLog.append(log, old, making, { messages: pick(1), origin: 'Story' });
    const before = plain(log);
    const next = ScribeAnswer.parse(answer({ FACTS: ['Mirelle | trait | shy | #2'] })).operations;
    for (const messages of [pick(2), pick(1)]) {
        assert.throws(() => ScribeLog.append(log, old, next, { messages, origin: 'Story' }), {
            name: 'Error',
            message: 'StaleState',
        });
        assert.deepEqual(plain(log), before);
    }
    const fresh = ScribeReplay.run(log, storyOrder);
    for (const [state, origin] of [
        [fresh, 'story'],
        [fresh, undefined],
        [fresh, 'Operator'],
        [old, 'story'],
    ]) {
        assert.throws(() => ScribeLog.append(log, state, next, { messages: pick(2), origin }), {
            name: 'Error',
            message: 'UnknownOrigin',
        });
        assert.deepEqual(plain(log), before);
    }
    const done = ScribeLog.append(log, fresh, next, { messages: pick(2), origin: 'Story' });
    assert.deepEqual(plain(done.refused), []);
    assert.equal(log.entries.length, 2);
    const quiet = ScribeReplay.run(log, storyOrder);
    assert.equal(quiet.revision, log.revision);
    const calm = ScribeAnswer.parse(answer({ FACTS: ['Halvard | trait | calm | #3'] })).operations;
    const kept = ScribeLog.append(log, quiet, calm, { messages: pick(3), origin: 'Story' });
    assert.deepEqual(plain(kept.entry.operations.map((operation) => operation.type)), ['Fact']);
    const after = plain(log);
    const wary = ScribeAnswer.parse(answer({ FACTS: ['Halvard | trait | wary | #4'] })).operations;
    assert.throws(() => ScribeLog.append(log, quiet, wary, { messages: pick(4), origin: 'Story' }), {
        name: 'Error',
        message: 'StaleState',
    });
    assert.deepEqual(plain(log), after);
    const shorter = ScribeReplay.run(log, storyOrder.slice(0, 2));
    assert.equal(shorter.revision, log.revision);
    const accepted = ScribeLog.append(log, shorter, wary, { messages: pick(4), origin: 'Story' });
    assert.deepEqual(plain(accepted.refused), []);
    const copied = ScribeReplay.run(plain(log), storyOrder);
    assert.equal(copied.revision, log.revision);
    const brave = ScribeAnswer.parse(answer({ FACTS: ['Halvard | trait | brave | #5'] })).operations;
    const last = ScribeLog.append(log, copied, brave, { messages: pick(5), origin: 'Story' });
    assert.deepEqual(plain(last.refused), []);
    assert.equal(log.entries.length, 5);
    assert.equal(ScribeReplay.run(log, storyOrder).revision, 5);
});

test('a second fuller line is not hidden', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | eyes | grey | #1'] }), pick(1));
    apply(log, storyOrder, answer({ CHANGES: ['F1 | Halvard | eyes | FULLER: grey as slate | #3'] }), pick(3));
    const { state } = apply(
        log,
        storyOrder,
        answer({ CHANGES: ['F1 | Halvard | eyes | FULLER: grey flecked with green | #5'] }),
        pick(5),
    );
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.text, fact.status, fact.replacedBy])), [
        ['F1', 'grey', 'Replaced', 'F2'],
        ['F2', 'grey as slate', 'InForce', null],
        ['F3', 'grey flecked with green', 'Disputed', null],
    ]);
    assert.deepEqual(plain(state.conflicts), [
        { subject: 'S1', category: 'eyes', target: null, established: 'F2', others: ['F3'] },
    ]);
    assert.deepEqual(plain(state.refinements), [{ from: 'F1', to: 'F2' }]);
    const moving = ScribeLog.create();
    apply(moving, storyOrder, answer({ FACTS: ['Halvard | location | the mill | #1'] }), pick(1));
    apply(
        moving,
        storyOrder,
        answer({ CHANGES: ['F1 | Halvard | location | FULLER: the mill by the weir | #9'] }),
        pick(9),
    );
    const moved = apply(
        moving,
        storyOrder,
        answer({ CHANGES: ['F1 | Halvard | location | FULLER: the mill loft | #5'] }),
        pick(5),
    );
    assert.deepEqual(plain(moved.state.facts.map((fact) => [fact.id, fact.text, fact.status, fact.replacedBy])), [
        ['F1', 'the mill', 'Replaced', 'F3'],
        ['F3', 'the mill loft', 'Replaced', 'F2'],
        ['F2', 'the mill by the weir', 'InForce', null],
    ]);
});

test('a refinement keeps the slot', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | eyes | grey | #1'] }), pick(1));
    apply(log, storyOrder, answer({ CHANGES: ['F1 | Halvard | eyes | FULLER: grey as slate | #2'] }), pick(2));
    const blue = apply(log, storyOrder, answer({ FACTS: ['Halvard | eyes | blue | #3'] }), pick(3));
    assert.equal(factSaying(blue.state, 'blue').status, 'Disputed');
    assert.deepEqual(
        plain(blue.state.facts.filter((fact) => fact.status === 'InForce').map((fact) => fact.id)),
        ['F2'],
    );
    assert.deepEqual(plain(blue.state.conflicts), [
        { subject: 'S1', category: 'eyes', target: null, established: 'F2', others: ['F3'] },
    ]);
    const repeat = apply(log, storyOrder, answer({ FACTS: ['Halvard | eyes | Grey as slate. | #4'] }), pick(4));
    assert.equal(repeat.state.facts.length, 3);
});

test('a refinement of the established value moves the conflict', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | age | twenty-five | #1', 'Halvard | age | thirty | #2'] }),
        pick(1, 2),
    );
    const { state } = apply(
        log,
        storyOrder,
        answer({ CHANGES: ['F1 | Halvard | age | FULLER: twenty-five winters | #3'] }),
        pick(3),
    );
    assert.deepEqual(plain(state.conflicts), [
        { subject: 'S1', category: 'age', target: null, established: 'F3', others: ['F2'] },
    ]);
    assert.deepEqual(plain(state.facts.map((fact) => [fact.id, fact.status])), [
        ['F1', 'Replaced'],
        ['F2', 'Disputed'],
        ['F3', 'InForce'],
    ]);
    for (const conflict of state.conflicts) {
        assert.notEqual(state.facts.find((fact) => fact.id === conflict.established).status, 'Replaced');
    }
});

test('a linked relation is not replaced by an ambiguous one', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        storyOrder,
        answer({
            SUBJECTS: ['Halvard | character', 'Oswin (the miller) | character'],
            FACTS: ['Halvard | relation to Oswin | buys his flour | #1'],
        }),
        pick(1),
    );
    const miller = subjectLabelled(first.state, 'Oswin (the miller)');
    assert.equal(factSaying(first.state, 'buys his flour').target, miller.id);
    apply(log, storyOrder, answer({ SUBJECTS: ["Oswin (Tamsin's uncle) | character"] }), pick(2));
    const owes = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | relation to Oswin | owes him money | #3'] }),
        pick(3),
    );
    assert.deepEqual(plain(owes.result.refused), []);
    assert.equal(factSaying(owes.state, 'owes him money').target, null);
    assert.equal(factSaying(owes.state, 'owes him money').status, 'InForce');
    assert.equal(factSaying(owes.state, 'buys his flour').status, 'InForce');
    assert.equal(factSaying(owes.state, 'buys his flour').target, miller.id);
    apply(log, storyOrder, answer({ FACTS: ['Halvard | relation to the Hawk | fears him | #4'] }), pick(4));
    const hawk = apply(log, storyOrder, answer({ FACTS: ['Halvard | relation to Hawk | hunts him | #5'] }), pick(5));
    const fears = factSaying(hawk.state, 'fears him');
    const hunts = factSaying(hawk.state, 'hunts him');
    assert.equal(fears.status, 'Replaced');
    assert.equal(fears.replacedBy, hunts.id);
    assert.equal(hunts.status, 'InForce');
    assert.equal(factSaying(hawk.state, 'buys his flour').status, 'InForce');
});

test('stale marks do not outlive their relation', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ SUBJECTS: ['Halvard | character', 'Tamsin | character'] }), pick(1));
    apply(log, storyOrder, answer({ FACTS: ['Tamsin | relation to Halvard | trusts him | #5'] }), pick(5));
    const marked = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Halvard | relation to Tamsin | wary of her | #20'] }),
        pick(20),
    );
    assert.deepEqual(plain(marked.state.stale), [{ subject: 'S2', target: 'S1' }]);
    const fuller = apply(
        log,
        storyOrder,
        answer({ CHANGES: ['F1 | Tamsin | relation to Halvard | FULLER: trusts him with her life | #22'] }),
        pick(22),
    );
    assert.deepEqual(plain(fuller.state.refinements), [{ from: 'F1', to: 'F3' }]);
    assert.deepEqual(plain(fuller.state.stale), []);
    const other = ScribeLog.create();
    apply(other, storyOrder, answer({ SUBJECTS: ['Halvard | character', 'Tamsin | character'] }), pick(1));
    apply(other, storyOrder, answer({ FACTS: ['Tamsin | relation to Halvard | trusts him | #5'] }), pick(5));
    const before = apply(
        other,
        storyOrder,
        answer({ FACTS: ['Halvard | relation to Tamsin | wary of her | #20'] }),
        pick(20),
    );
    assert.equal(before.state.stale.length, 1);
    other.entries[1].withdrawn = true;
    assert.deepEqual(plain(ScribeReplay.run(other, storyOrder).stale), []);
});

test('a notes fact keeps its place when its message goes', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | age | twenty-five | #3'] }), pick(3));
    apply(log, storyOrder, answer({ FACTS: ['Halvard | age | thirty | #30'] }), pick(30), 'Notes');
    const state = ScribeReplay.run(
        log,
        storyOrder.filter((id) => id !== 'MESSAGE-30'),
    );
    const twentyFive = factSaying(state, 'twenty-five');
    const thirty = factSaying(state, 'thirty');
    assert.equal(twentyFive.status, 'InForce');
    assert.equal(thirty.status, 'Disputed');
    assert.equal(thirty.position, 30);
    assert.deepEqual(plain(state.conflicts), [
        { subject: 'S1', category: 'age', target: null, established: twentyFive.id, others: [thirty.id] },
    ]);
});

test('threads keep story order and a close always counts', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ THREADS: ['OPEN | the missing ledger | #9'] }), pick(9));
    const second = apply(log, storyOrder, answer({ THREADS: ['OPEN | the broken seal | #2'] }), pick(2));
    assert.deepEqual(plain(second.state.threads.map((thread) => [thread.id, thread.position])), [
        ['T2', 2],
        ['T1', 9],
    ]);
    apply(log, storyOrder, answer({ THREADS: ['CLOSE T1 | lost again | #12'] }), pick(12));
    const closed = apply(log, storyOrder, answer({ THREADS: ['CLOSE T1 | found | #4'] }), pick(4));
    assert.deepEqual(plain(closed.state.threads), [
        { id: 'T2', text: 'the broken seal', cite: 'MESSAGE-2', position: 2, closed: null },
        {
            id: 'T1',
            text: 'the missing ledger',
            cite: 'MESSAGE-9',
            position: 9,
            closed: { how: 'found', cite: 'MESSAGE-4', position: 4 },
        },
    ]);
});

test('aliases and look-alikes are listed once', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ SUBJECTS: ['Aldric | character'] }), pick(1));
    apply(log, storyOrder, answer({ NAMES: ['Aldrich | Aldric | #2'] }), pick(2));
    const again = apply(
        log,
        storyOrder.filter((id) => id !== 'MESSAGE-2'),
        answer({ NAMES: ['Aldrich | Aldric | #3'] }),
        pick(3),
    );
    assert.equal(again.result.entry.operations.length, 1);
    const state = ScribeReplay.run(log, storyOrder);
    const aldric = subjectLabelled(state, 'Aldric');
    assert.deepEqual(plain(state.aliases), [{ subject: aldric.id, name: 'Aldrich', cite: 'MESSAGE-2' }]);
    assert.deepEqual(plain(aldric.aka), ['Aldrich']);
    const pair = ScribeLog.create();
    const merged = apply(
        pair,
        storyOrder,
        answer({ SUBJECTS: ['Corvane | character', 'Brandt | character'], NAMES: ['Brandt | Corvane | #1'] }),
        pick(1),
    );
    assert.equal(merged.result.entry.operations[2].other, 'S2');
    assert.deepEqual(plain(merged.state.lookAlikes), [{ first: 'S1', second: 'S2', reason: 'Alias' }]);
    const own = apply(
        ScribeLog.create(),
        storyOrder,
        answer({
            SUBJECTS: ['Oswin (the miller) | character'],
            FACTS: ['Oswin (the miller) | aka | Oswin | #1', 'Oswin (the miller) | aka | the Miller | #1'],
        }),
        pick(1),
    );
    assert.deepEqual(plain(subjectLabelled(own.state, 'Oswin (the miller)').aka), ['the Miller']);
});

test('an operator fact whose message has gone is skipped', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Halvard | trait | proud | #4'] }), pick(4));
    apply(log, storyOrder, answer({ FACTS: ['Halvard | trait | loyal | #5'] }), pick(5));
    log.entries[0].origin = 'Operator';
    const whole = ScribeReplay.run(log, storyOrder);
    assert.deepEqual(plain(whole.facts.map((fact) => [fact.text, fact.position, fact.origin])), [
        ['proud', 4, 'Operator'],
        ['loyal', 5, 'Story'],
    ]);
    const state = ScribeReplay.run(
        log,
        storyOrder.filter((id) => id !== 'MESSAGE-4'),
    );
    assert.deepEqual(plain(state.facts.map((fact) => fact.text)), ['loyal']);
    assert.deepEqual(labels(state), ['Halvard']);
});

test('many distinct names replay quickly', () => {
    const syllables = ['ka', 'ral', 'dal', 'mi', 'thor', 'vel', 'os', 'bri', 'sun', 'el', 'gar', 'wyn', 'a', 'lo', 'ster'];
    const generated = [];
    const taken = new Set();
    let seed = 7;
    while (generated.length < 600) {
        seed = (seed * 48271) % 2147483647;
        let rest = Math.floor(seed / 4);
        let word = '';
        for (let part = 0; part <= seed % 4; part++) {
            word += syllables[rest % syllables.length];
            rest = Math.floor(rest / syllables.length);
        }
        const name = word[0].toUpperCase() + word.slice(1);
        if (!taken.has(ScribeText.normaliseName(name))) {
            taken.add(ScribeText.normaliseName(name));
            generated.push(name);
        }
    }
    assert.ok(new Set(generated.map((name) => name.length)).size >= 8);
    const log = ScribeLog.create();
    const parsed = ScribeAnswer.parse(answer({ SUBJECTS: generated.map((name) => `${name} | character`) }));
    assert.equal(parsed.operations.length, 600);
    const result = ScribeLog.append(log, ScribeReplay.run(log, storyOrder), parsed.operations, {
        messages: pick(1),
        origin: 'Story',
    });
    assert.deepEqual(plain(result.refused), []);
    const started = performance.now();
    const state = ScribeReplay.run(log, storyOrder);
    const elapsed = performance.now() - started;
    assert.equal(state.subjects.length, 600);
    assert.ok(elapsed < 30000, `replay took ${elapsed} ms`);
    const expected = [];
    for (let later = 0; later < state.subjects.length; later++) {
        for (let earlier = 0; earlier < later; earlier++) {
            const first = state.subjects[earlier];
            const second = state.subjects[later];
            if (ScribeText.resembles(first.name, second.name)) {
                expected.push({ first: first.id, second: second.id, reason: 'Spelling' });
            }
        }
    }
    assert.ok(expected.length > 0);
    assert.deepEqual(plain(state.lookAlikes), expected);
});

test('a name lent by a refused line lends nothing', () => {
    const uncleLine = "Oswin (Tamsin's uncle) | trait | loud | #2";
    const aliasLog = ScribeLog.create();
    apply(aliasLog, storyOrder, answer({ SUBJECTS: ['Oswin (the miller) | character'] }), pick(1));
    const aliased = apply(
        aliasLog,
        storyOrder,
        answer({ NAMES: ['Ozzy | Oswin | #2'], FACTS: ['Ozzy | trait | limps | #2', uncleLine] }),
        pick(2),
    );
    assert.deepEqual(reasons(aliased.result), ['Ambiguous']);
    assert.equal(aliased.result.refused[0].operation, aliased.parsed.operations[0]);
    const miller = subjectLabelled(aliased.state, 'Oswin (the miller)');
    const ozzy = subjectLabelled(aliased.state, 'Ozzy');
    assert.equal(factSaying(aliased.state, 'limps').subject, ozzy.id);
    assert.notEqual(ozzy.id, miller.id);
    assert.deepEqual(plain(aliased.state.aliases), []);
    assert.deepEqual(plain(miller.aka), []);
    assert.deepEqual(labels(aliased.state), ['Oswin (the miller)', 'Ozzy', "Oswin (Tamsin's uncle)"]);
    const akaLog = ScribeLog.create();
    apply(akaLog, storyOrder, answer({ SUBJECTS: ['Oswin (the miller) | character'] }), pick(1));
    const named = apply(
        akaLog,
        storyOrder,
        answer({ FACTS: ['Oswin | aka | Ozzy | #2', 'Ozzy | trait | limps | #2', uncleLine] }),
        pick(2),
    );
    assert.deepEqual(reasons(named.result), ['Ambiguous']);
    assert.equal(named.result.refused[0].operation, named.parsed.operations[0]);
    assert.equal(factSaying(named.state, 'limps').subject, subjectLabelled(named.state, 'Ozzy').id);
    assert.deepEqual(plain(subjectLabelled(named.state, 'Oswin (the miller)').aka), []);
    assert.deepEqual(plain(named.state.facts.map((fact) => fact.text)), ['limps', 'loud']);
    const relationLog = ScribeLog.create();
    apply(
        relationLog,
        storyOrder,
        answer({ SUBJECTS: ['Oswin (the miller) | character', 'Mirelle | character'] }),
        pick(1),
    );
    const related = apply(
        relationLog,
        storyOrder,
        answer({ NAMES: ['Ozzy | Oswin | #2'], FACTS: ['Mirelle | relation to Ozzy | owes him | #2', uncleLine] }),
        pick(2),
    );
    assert.deepEqual(reasons(related.result), ['Ambiguous']);
    const owes = factSaying(related.state, 'owes him');
    assert.notEqual(owes.target, subjectLabelled(related.state, 'Oswin (the miller)').id);
    assert.equal(owes.target, null);
    assert.deepEqual(labels(related.state), ['Oswin (the miller)', 'Mirelle', "Oswin (Tamsin's uncle)"]);
});

test('the end check covers aliases, told lines and declarations', () => {
    const uncleLine = "Oswin (Tamsin's uncle) | trait | loud | #2";
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Oswin (the miller) | trait | quiet | #1'] }), pick(1));
    const told = apply(
        log,
        storyOrder,
        answer({ TOLD: ['F1 | Oswin (the miller) | Oswin | #2'], FACTS: [uncleLine] }),
        pick(2),
    );
    assert.deepEqual(reasons(told.result), ['Ambiguous']);
    assert.equal(told.result.refused[0].operation, told.parsed.operations[0]);
    assert.deepEqual(plain(told.result.entry.operations.map((operation) => operation.type)), ['Subject', 'Fact']);
    const aliasLog = ScribeLog.create();
    apply(aliasLog, storyOrder, answer({ FACTS: ['Oswin (the miller) | trait | quiet | #1'] }), pick(1));
    const aliased = apply(
        aliasLog,
        storyOrder,
        answer({ NAMES: ['Ozzy | Oswin | #2'], FACTS: [uncleLine] }),
        pick(2),
    );
    assert.deepEqual(reasons(aliased.result), ['Ambiguous']);
    assert.deepEqual(plain(aliased.state.aliases), []);
    const other = ScribeLog.create();
    apply(other, storyOrder, answer({ FACTS: ['Oswin (the miller) | trait | quiet | #1'] }), pick(1));
    const declared = apply(
        other,
        storyOrder,
        answer({ SUBJECTS: ['Oswin | place', "Oswin (Tamsin's uncle) | character"] }),
        pick(2),
    );
    assert.deepEqual(reasons(declared.result), ['Ambiguous']);
    assert.equal(declared.result.refused[0].operation, declared.parsed.operations[0]);
    assert.deepEqual(plain(declared.result.entry.operations), [
        { type: 'Subject', subject: 'S2', label: "Oswin (Tamsin's uncle)", kind: 'character' },
    ]);
    const miller = subjectLabelled(declared.state, 'Oswin (the miller)');
    assert.equal(miller.kind, 'character');
    assert.equal(miller.assumed, true);
});

test('a mismatch reaches the lines before it', () => {
    const log = ScribeLog.create();
    apply(
        log,
        storyOrder,
        answer({ SUBJECTS: ['Corvane | place'], FACTS: ['Corvane | feature | a ruined tower | #1'] }),
        pick(1),
    );
    const text = [
        '=== FACTS',
        'Corvane | trait | windswept | #2',
        'Corvane | feature | a broken gate | #2',
        'Corvane-san | trait | cold | #2',
        'Halvard | trait | patient | #2',
        'Halvard | relation to Corvane | owes him a debt | #2',
        '=== SUBJECTS',
        'Corvane | character',
        '=== FACTS',
        'Corvane | trait | sly | #2',
    ].join('\n');
    const { state, result, parsed } = apply(log, storyOrder, text, pick(2));
    assert.deepEqual(reasons(result), ['Mismatch', 'Mismatch', 'Mismatch', 'Mismatch', 'Mismatch']);
    const refusedAt = result.refused.map((item) => parsed.operations.indexOf(item.operation));
    assert.deepEqual(plain(refusedAt), [0, 1, 2, 5, 6]);
    const corvane = subjectLabelled(state, 'Corvane');
    assert.equal(corvane.kind, 'place');
    assert.deepEqual(
        plain(state.facts.filter((fact) => fact.subject === corvane.id).map((fact) => fact.text)),
        ['a ruined tower'],
    );
    const halvard = subjectLabelled(state, 'Halvard');
    assert.equal(factSaying(state, 'patient').subject, halvard.id);
    const owes = factSaying(state, 'owes him a debt');
    assert.equal(owes.subject, halvard.id);
    assert.equal(owes.target, null);
    assert.equal(owes.targetText, 'Corvane');
    assert.deepEqual(labels(state), ['Corvane', 'Halvard']);
});

test('two subject lines of different kinds in one answer', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Corvane | trait | windswept | #1'] }), pick(1));
    const clash = apply(
        log,
        storyOrder,
        answer({ SUBJECTS: ['Corvane | place', 'Corvane | group'], FACTS: ['Corvane | trait | cold | #2'] }),
        pick(2),
    );
    assert.deepEqual(reasons(clash.result), ['Mismatch', 'Mismatch', 'Mismatch']);
    assert.deepEqual(plain(clash.result.entry.operations), []);
    const corvane = subjectLabelled(clash.state, 'Corvane');
    assert.equal(corvane.kind, 'character');
    assert.equal(corvane.assumed, true);
    assert.deepEqual(plain(clash.state.facts.map((fact) => fact.text)), ['windswept']);
    const twice = ScribeLog.create();
    apply(twice, storyOrder, answer({ FACTS: ['Corvane | trait | windswept | #1'] }), pick(1));
    const same = apply(twice, storyOrder, answer({ SUBJECTS: ['Corvane | place', 'Corvane | place'] }), pick(2));
    assert.deepEqual(plain(same.result.refused), []);
    assert.deepEqual(plain(same.result.entry.operations), [
        { type: 'Subject', subject: 'S1', label: 'Corvane', kind: 'place' },
    ]);
    assert.equal(subjectLabelled(same.state, 'Corvane').kind, 'place');
    assert.equal(subjectLabelled(same.state, 'Corvane').assumed, false);
});

test('a declared kind beats a kind fact', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ SUBJECTS: ['Corvane | place'] }), pick(1));
    const stated = apply(log, storyOrder, answer({ FACTS: ['Corvane | kind | character | #5'] }), pick(5));
    const corvane = subjectLabelled(stated.state, 'Corvane');
    assert.equal(corvane.kind, 'place');
    assert.equal(corvane.assumed, false);
    const kindFact = factSaying(stated.state, 'character');
    assert.deepEqual([kindFact.category, kindFact.status, kindFact.subject], ['kind', 'InForce', corvane.id]);
    const repeat = apply(log, storyOrder, answer({ SUBJECTS: ['Corvane | place'] }), pick(6));
    assert.deepEqual(plain(repeat.result.refused), []);
    assert.deepEqual(plain(repeat.result.entry.operations), []);
    const other = ScribeLog.create();
    const made = apply(other, storyOrder, answer({ FACTS: ['Isolde | kind | place | #1'] }), pick(1));
    assert.equal(subjectLabelled(made.state, 'Isolde').kind, 'place');
    assert.equal(subjectLabelled(made.state, 'Isolde').assumed, true);
    const wins = apply(other, storyOrder, answer({ SUBJECTS: ['Isolde | character'] }), pick(2));
    assert.deepEqual(plain(wins.result.refused), []);
    assert.deepEqual(plain(wins.result.entry.operations), [
        { type: 'Subject', subject: 'S1', label: 'Isolde', kind: 'character' },
    ]);
    assert.equal(subjectLabelled(wins.state, 'Isolde').kind, 'character');
    assert.equal(subjectLabelled(wins.state, 'Isolde').assumed, false);
});

test('a withdrawn declaration stops counting', () => {
    const log = ScribeLog.create();
    apply(log, storyOrder, answer({ FACTS: ['Corvane | trait | windswept | #1'] }), pick(1));
    const declared = apply(log, storyOrder, answer({ SUBJECTS: ['Corvane | place'] }), pick(2));
    assert.equal(subjectLabelled(declared.state, 'Corvane').kind, 'place');
    log.entries[1].withdrawn = true;
    const withdrawn = ScribeReplay.run(log, storyOrder);
    assert.deepEqual(plain(subjectLabelled(withdrawn, 'Corvane')), {
        id: 'S1',
        label: 'Corvane',
        name: 'Corvane',
        kind: 'character',
        assumed: true,
        aka: [],
        mergedInto: null,
    });
    const later = apply(
        log,
        storyOrder,
        answer({ SUBJECTS: ['Corvane | character'], FACTS: ['Corvane | trait | cold | #3'] }),
        pick(3),
    );
    assert.deepEqual(plain(later.result.refused), []);
    assert.deepEqual(plain(later.result.entry.operations.map((operation) => operation.type)), ['Subject', 'Fact']);
    assert.equal(factSaying(later.state, 'cold').subject, 'S1');
    assert.equal(subjectLabelled(later.state, 'Corvane').kind, 'character');
    assert.equal(subjectLabelled(later.state, 'Corvane').assumed, false);
    log.entries[0].withdrawn = true;
    const unmade = ScribeReplay.run(log, storyOrder);
    assert.deepEqual(labels(unmade), ['Corvane']);
    assert.equal(subjectLabelled(unmade, 'Corvane').id, 'S1');
    assert.deepEqual(plain(unmade.facts.map((fact) => fact.text)), ['cold']);
});

test('a fuller line that renames an aka is an aka line', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        storyOrder,
        answer({ SUBJECTS: ['Halvard | character', 'Brandt | character'], FACTS: ['Halvard | aka | Hal | #1'] }),
        pick(1),
    );
    assert.deepEqual(plain(first.state.lookAlikes), []);
    const halvard = subjectLabelled(first.state, 'Halvard');
    const brandt = subjectLabelled(first.state, 'Brandt');
    const renamed = apply(log, storyOrder, answer({ CHANGES: ['F1 | Halvard | aka | FULLER: Brandt | #2'] }), pick(2));
    assert.equal(renamed.result.entry.operations[0].other, brandt.id);
    assert.deepEqual(plain(renamed.state.lookAlikes), [{ first: halvard.id, second: brandt.id, reason: 'Alias' }]);
    assert.deepEqual(plain(subjectLabelled(renamed.state, 'Halvard').aka), ['Hal', 'Brandt']);
    const inCall = ScribeLog.create();
    apply(inCall, storyOrder, answer({ FACTS: ['Halvard | aka | Hal | #1'] }), pick(1));
    const joined = apply(
        inCall,
        storyOrder,
        answer({
            CHANGES: ['F1 | Halvard | aka | FULLER: Hal the Bold | #2'],
            FACTS: ['Hal the Bold | trait | loud | #2'],
        }),
        pick(2),
    );
    assert.deepEqual(plain(joined.result.refused), []);
    assert.deepEqual(labels(joined.state), ['Halvard']);
    assert.equal(factSaying(joined.state, 'loud').subject, subjectLabelled(joined.state, 'Halvard').id);
    const other = ScribeLog.create();
    const smith = apply(
        other,
        storyOrder,
        answer({ SUBJECTS: ['Hal (the smith) | character', 'Halvard | character'], FACTS: ['Halvard | aka | Hal | #1'] }),
        pick(1),
    );
    assert.deepEqual(plain(smith.state.lookAlikes), [{ first: 'S1', second: 'S2', reason: 'Alias' }]);
});

test('a relation to oneself is linked to oneself', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Kira | relation to Kira | doubts herself | #1'] }),
        pick(1),
    );
    const kira = subjectLabelled(first.state, 'Kira');
    assert.deepEqual(labels(first.state), ['Kira']);
    assert.equal(factSaying(first.state, 'doubts herself').target, kira.id);
    assert.deepEqual(plain(first.state.stale), []);
    const second = apply(
        log,
        storyOrder,
        answer({ FACTS: ['Kira | relation to Kira | trusts herself | #2'] }),
        pick(2),
    );
    assert.equal(factSaying(second.state, 'doubts herself').status, 'Replaced');
    assert.equal(factSaying(second.state, 'trusts herself').target, kira.id);
    assert.deepEqual(plain(second.state.stale), []);
});

/**
 * @param {string} line
 * @param {*} earlierCite
 * @return {object}
 */
function contradiction(line, earlierCite = undefined) {
    const [operation] = ScribeAnswer.parse(answer({ CONTRADICTIONS: [line] })).operations;
    return earlierCite === undefined ? operation : { ...operation, earlierCite };
}

test('a contradiction is filed only with its earlier message named', () => {
    const log = ScribeLog.create();
    const kept = contradiction('#12 "the gate stood open" | #3 "the gate was barred" | open or barred', 'MESSAGE-3');
    const operations = [
        kept,
        contradiction('#12 "the gate stood open" | #4 "the bar was down" | open or down'),
        contradiction('#12 "the gate stood open" | #4 "the bar was down" | open or down', 4),
        contradiction('#12 "the gate stood open" | #4 "the bar was down" | open or down', null),
        contradiction('#13 "the gate stood open" | #4 "the bar was down" | not in the stretch', 'MESSAGE-4'),
    ];
    const result = ScribeLog.append(log, ScribeReplay.run(log, storyOrder), operations, {
        messages: pick(10, 11, 12),
        origin: 'Story',
    });
    assert.deepEqual(
        plain(result.refused),
        operations.slice(1).map((operation) => ({ operation: plain(operation), reason: 'Citation' })),
    );
    assert.deepEqual(plain(result.entry.operations), [
        {
            type: 'Contradiction',
            cite: 'MESSAGE-12',
            position: 12,
            earlier: 'MESSAGE-3',
            earlierPosition: 3,
            said: 'the gate stood open',
            before: 'the gate was barred',
            why: 'open or barred',
        },
    ]);
    assert.deepEqual(plain(result.entry.messageIds), ['MESSAGE-10', 'MESSAGE-11', 'MESSAGE-12']);
});

test('contradictions replay in story order, once each, with the current numbers', () => {
    const log = ScribeLog.create();
    const gate = contradiction('#20 "the gate stood open" | #3 "the gate was barred" | open or barred', 'MESSAGE-3');
    const bell = contradiction('#20 "the bell was silent" | #2 "the bell rang" | rang or silent', 'MESSAGE-2');
    const boat = contradiction('#25 "the boat sank" | #9 "the boat sailed" | sank or sailed', 'MESSAGE-9');
    for (const [operations, messages] of [
        [[boat], pick(25)],
        [[gate, bell, gate], pick(20)],
    ]) {
        const stretch = { messages, origin: 'Story' };
        const result = ScribeLog.append(log, ScribeReplay.run(log, storyOrder), operations, stretch);
        assert.deepEqual(plain(result.refused), []);
    }
    /**
     * @param {string[]} order
     * @return {Array<[string, number, string, number, string, boolean]>}
     */
    const listed = (order) =>
        plain(
            ScribeReplay.run(log, order).contradictions.map((item) => [
                item.cite,
                item.position,
                item.earlier,
                item.earlierPosition,
                item.said,
                item.dismissed,
            ]),
        );
    assert.deepEqual(listed(storyOrder), [
        ['MESSAGE-20', 20, 'MESSAGE-2', 2, 'the bell was silent', false],
        ['MESSAGE-20', 20, 'MESSAGE-3', 3, 'the gate stood open', false],
        ['MESSAGE-25', 25, 'MESSAGE-9', 9, 'the boat sank', false],
    ]);
    assert.deepEqual(listed(storyOrder.filter((id) => id !== 'MESSAGE-1')), [
        ['MESSAGE-20', 19, 'MESSAGE-2', 1, 'the bell was silent', false],
        ['MESSAGE-20', 19, 'MESSAGE-3', 2, 'the gate stood open', false],
        ['MESSAGE-25', 24, 'MESSAGE-9', 8, 'the boat sank', false],
    ]);
    assert.deepEqual(listed(storyOrder.filter((id) => id !== 'MESSAGE-3')), [
        ['MESSAGE-20', 19, 'MESSAGE-2', 2, 'the bell was silent', false],
        ['MESSAGE-20', 19, 'MESSAGE-3', 3, 'the gate stood open', false],
        ['MESSAGE-25', 24, 'MESSAGE-9', 8, 'the boat sank', false],
    ]);
    assert.deepEqual(listed(storyOrder.filter((id) => id !== 'MESSAGE-25')), [
        ['MESSAGE-20', 20, 'MESSAGE-2', 2, 'the bell was silent', false],
        ['MESSAGE-20', 20, 'MESSAGE-3', 3, 'the gate stood open', false],
    ]);
    const state = ScribeReplay.run(log, storyOrder);
    assert.deepEqual(
        plain(state.contradictions.map((item) => item.id)),
        [
            ['MESSAGE-20', 'MESSAGE-2', 'the bell was silent', 'the bell rang'],
            ['MESSAGE-20', 'MESSAGE-3', 'the gate stood open', 'the gate was barred'],
            ['MESSAGE-25', 'MESSAGE-9', 'the boat sank', 'the boat sailed'],
        ].map((parts) => JSON.stringify(parts)),
    );
    assert.equal(state.contradictions[2].why, 'sank or sailed');
    assertFrozenDeep(state.contradictions, 'contradictions');
    assertJsonSafe(state.contradictions, 'contradictions');
    const gateId = state.contradictions[1].id;
    const ruling = ScribeLog.rule(log, state, { type: 'DismissContradiction', contradiction: gateId });
    assert.deepEqual(plain(listed(storyOrder).map((row) => row[5])), [false, true, false]);
    assert.deepEqual(plain(listed(storyOrder.filter((id) => id !== 'MESSAGE-1')).map((row) => row[5])), [
        false,
        true,
        false,
    ]);
    assert.equal(ScribeLog.revoke(log, ruling.sequence), ruling);
    assert.deepEqual(plain(listed(storyOrder).map((row) => row[5])), [false, false, false]);
    const stale = ScribeReplay.run(log, storyOrder);
    ScribeLog.rule(log, stale, { type: 'DismissContradiction', contradiction: gateId });
    assert.throws(() => ScribeLog.rule(log, stale, { type: 'DismissContradiction', contradiction: gateId }), {
        message: 'StaleState',
    });
});
