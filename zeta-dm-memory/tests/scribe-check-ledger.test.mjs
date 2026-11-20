import assert from 'node:assert/strict';
import test from 'node:test';
import CampaignBuilder from './support/CampaignBuilder.mjs';
import ScribeCore from './support/ScribeCore.mjs';

const { ScribeIntake, ScribeAnswer, ScribeLog, ScribeReplay } = ScribeCore.load([
    'ScribeText', 'ScribeCategory', 'ScribeIntake', 'ScribeAnswer', 'ScribeLog', 'ScribeReplay',
]);

/**
 * @return {object}
 */
function campaign() {
    const builder = new CampaignBuilder('Frost');
    builder.player('I promise I will bring the staff back.');
    builder.narrator('Magera takes the staff.');
    builder.narrator('Thessaly returns to the guild.');
    const messages = ScribeIntake.read(builder.messages).messages;
    const log = ScribeLog.create();
    const book = { log, adopted: true, fingerprints: Object.fromEntries(messages.map((message) => [message.id, message.fingerprint])) };
    return { book, messages, order: messages.map((message) => message.id) };
}

/**
 * @param {object} message
 * @param {number} index
 * @param {number} total
 * @return {object}
 */
function page(message, index = 0, total = 1) {
    const block = message.blocks[0];
    const source = { messageId: message.id, fingerprint: message.fingerprint, position: message.position,
        blockNumber: block.blockNumber, speaker: block.speaker, quote: block.text };
    const id = 'passage-' + message.position + '-page-' + index;
    const rawClaim = { attribution: message.fromPlayer ? 'promised' : 'witnessed', subject: block.speaker,
        source: { ref: 'm' + message.position + 'b' + block.blockNumber, quote: block.text } };
    return { id, index, total, complete: true, answer: JSON.stringify({ page: id, complete: true, claims: [rawClaim], findings: [] }),
        claims: [{ source, text: block.text, attribution: message.fromPlayer ? 'promised' : 'witnessed',
            subject: block.speaker, attribute: null, value: null }], findings: [] };
}

/**
 * @param {string[]} words
 * @param {string} filing
 * @return {object}
 */
function disputed(words, filing = '') {
    const builder = new CampaignBuilder('Frost');
    for (const line of words) {
        builder.narrator(line);
    }
    const messages = ScribeIntake.read(builder.messages).messages;
    const order = messages.map((message) => message.id);
    const fingerprints = new Map(messages.map((message) => [message.id, message.fingerprint]));
    const book = { log: ScribeLog.create(), fingerprints: Object.fromEntries(fingerprints) };
    const state = () => ScribeReplay.run(book.log, order, null, fingerprints, null, null, messages);
    const result = ScribeLog.append(book.log, state(), ScribeAnswer.parse(filing).operations, { messages, origin: 'Story' });
    assert.equal(result.refused.length, 0);
    const source = (number) => page(messages[number - 1]).claims[0].source;
    const certify = (number, fields, findings = []) => {
        const proposed = page(messages[number - 1]);
        Object.assign(proposed.claims[0], fields);
        const raw = JSON.parse(proposed.answer);
        Object.assign(raw.claims[0], fields);
        raw.findings = findings.map((item) => ({ kind: item.kind, question: item.question,
            source: { ref: 'm' + number + 'b1', quote: item.source.quote },
            earlier: item.earlier && { ref: 'm' + item.earlier.position + 'b1', quote: item.earlier.quote },
            record: item.record?.ref ?? null }));
        proposed.answer = JSON.stringify(raw);
        proposed.findings = findings;
        assert.equal(ScribeLog.saveCheck(book, messages, ScribeLog.checkWork(book, messages), proposed), true);
    };
    const rows = () => ScribeLog.checkProgress(book, messages).findings;
    const rule = (row, fields) => ScribeLog.ruleFinding(book, state(), messages, { finding: row.id, version: row.version, ...fields });
    return { book, messages, order, fingerprints, state, source, certify, rule, rows };
}

test('a bound bounty ruling corrects the subject, preserves the original and reopens on loss of its sole source', () => {
    const room = disputed(['Mirra has a bounty of 50,000 gold.'],
        '=== SUBJECTS\nMirra | character\nAcnademia | character\n=== FACTS\nAcnademia | status | bounty of 50,000 gold | #1');
    const operation = room.book.log.entries[0].operations.find((item) => item.fact);
    const record = { ref: 'w1', text: JSON.stringify(operation) };
    room.certify(1, { subject: 'Mirra', attribute: 'bounty', value: '50,000 gold' }, [
        { kind: 'Citation', question: 'Whose bounty is it?', source: room.source(1), earlier: null, record }]);
    const initial = room.rows()[0];
    const decision = room.rule(initial, { action: 'choose', account: 'source' });
    assert.throws(() => room.rule(initial, { action: 'choose', account: 'record' }), /changed/);
    const fact = room.state().facts[0];
    assert.equal(fact.subject, room.state().subjects.find((owner) => owner.label === 'Mirra').id);
    assert.equal(fact.evidence.value, '50,000 gold');
    assert.equal(fact.cite, room.messages[0].id);
    assert.equal(room.book.log.entries[0].operations.find((item) => item.fact).subject, operation.subject);
    assert.equal(room.rows()[0].status, 'settled');
    const newBook = JSON.parse(JSON.stringify(room.book));
    const changed = [{ ...room.messages[0], fingerprint: 'new', blocks: [{ ...room.messages[0].blocks[0], text: 'Mirra has no bounty.' }] }];
    const state = ScribeReplay.run(newBook.log, room.order, null, new Map([[room.order[0], 'new']]), null, null, changed);
    assert.equal(state.checkerRulings[0].sequence, decision.sequence);
    assert.equal(state.checkerRulings[0].status, 'reopened');
    assert.ok(state.facts.every((item) => item.status !== 'InForce'));
    assert.equal(ScribeLog.checkProgress(newBook, changed).findings[0].actionable, false);
    const cosmetic = [{ ...room.messages[0], fingerprint: 'new', blocks: [{ ...room.messages[0].blocks[0],
        text: room.messages[0].blocks[0].text + ' A dog runs outside.' }] }];
    assert.equal(ScribeReplay.run(newBook.log, room.order, null, null, null, null, cosmetic).checkerRulings[0].status, 'settled');
});

test('two points with identical witnesses and text are ruled independently, and an open point remains actionable after reload', () => {
    const room = disputed(['Mirra wears the red crown.', 'Orla wears the blue crown.']);
    room.certify(1, { subject: 'Mirra', attribute: 'crown', value: 'red' });
    const shared = { kind: 'Question', source: room.source(2), earlier: room.source(1), record: null };
    room.certify(2, { subject: 'Orla', attribute: 'crown', value: 'blue' }, [
        { ...shared, question: 'Who wears the crown?' }, { ...shared, question: 'What color is the crown?' }]);
    const [wearer, color] = room.rows();
    assert.notEqual(wearer.id, color.id);
    room.rule(wearer, { action: 'explain', explanation: 'They each wear a separate crown.' });
    room.rule(color, { action: 'open' });
    assert.deepEqual(Array.from(room.rows(), (row) => row.status), ['settled', 'deferred']);
    room.book.log = JSON.parse(JSON.stringify(room.book.log));
    room.rule(room.rows()[1], { action: 'choose', account: 'earlier' });
    assert.deepEqual(Array.from(room.state().checkerRulings, (row) => row.status), ['settled', 'superseded', 'settled']);
});

test('a later incompatible hair account reopens the affected ruling while a town question stays deferred', () => {
    const room = disputed(['Galahan has dark hair.', 'Galahan has silver hair.', 'They arrive in Thornwall.', 'Galahan has red hair.']);
    room.certify(1, { subject: 'Galahan', attribute: 'hair', value: 'dark' });
    const question = (number) => ({ kind: 'Question', question: 'What color is Galahan’s hair?',
        source: room.source(number), earlier: room.source(1), record: null });
    room.certify(2, { subject: 'Galahan', attribute: 'hair', value: 'silver' }, [question(2)]);
    room.certify(3, {}, [{ kind: 'Omission', source: room.source(3), question: 'Which town?', earlier: null, record: null }]);
    const [hair, town] = room.rows();
    room.rule(hair, { action: 'choose', account: 'earlier' });
    room.rule(town, { action: 'open' });
    room.certify(4, { subject: 'Galahan', attribute: 'hair', value: 'red' }, [question(4)]);
    assert.deepEqual(Array.from(room.rows(), (row) => [row.id, row.status]), [[hair.id, 'reopened'], [town.id, 'deferred']]);
    assert.equal(room.state().checkerRulings[0].status, 'reopened');
    room.rule(room.rows()[0], { action: 'choose', account: 'earlier' });
    assert.deepEqual(Array.from(room.rows(), (row) => row.status), ['settled', 'deferred']);
});

test('the same hair question and common earlier citation keep two subjects separate across reload and a later contradiction', () => {
    const room = disputed(['Galahan and Mirra have dark hair.', 'Galahan has silver hair.', 'Mirra has red hair.', 'Galahan has blue hair.']);
    const question = (position) => ({ kind: 'Question', question: 'What color is the hair?',
        source: room.source(position), earlier: room.source(1), record: null });
    room.certify(1, { subject: 'Mirra', attribute: 'hair', value: 'dark' });
    room.certify(2, { subject: 'Galahan', attribute: 'hair', value: 'silver' }, [question(2)]);
    const galahan = room.rows()[0];
    room.rule(galahan, { action: 'choose', account: 'source' });
    room.book.log = JSON.parse(JSON.stringify(room.book.log));
    room.certify(3, { subject: 'Mirra', attribute: 'hair', value: 'red' }, [question(3)]);
    assert.deepEqual(Array.from(room.rows(), (item) => [item.source.position, item.status]), [[2, 'settled'], [3, 'open']]);
    const mirra = room.rows()[1];
    room.rule(mirra, { action: 'choose', account: 'earlier' });
    room.certify(4, { subject: 'Galahan', attribute: 'hair', value: 'blue' }, [question(4)]);
    const current = new Map(room.rows().map((item) => [item.id, [item.source.position, item.status]]));
    assert.deepEqual(current.get(galahan.id), [4, 'reopened']);
    assert.deepEqual(current.get(mirra.id), [3, 'settled']);
});

test('the next Checker call excludes the challenged ruling and sees only its replacement after reload', () => {
    const room = disputed(['Galahan has dark hair.', 'Galahan has silver hair.', 'Galahan has red hair.', 'Dawn breaks.']);
    const question = (number) => ({ kind: 'Question', source: room.source(number), earlier: room.source(1),
        record: null, question: 'What color is Galahan’s hair?' });
    const context = () => ScribeLog.checkWork(room.book, room.messages);
    const canonical = () => Array.from(context().rulings, (row) => JSON.parse(row.text).decision);
    room.certify(1, { subject: 'Galahan', attribute: 'hair', value: 'dark' });
    room.certify(2, { subject: 'Galahan', attribute: 'hair', value: 'silver' }, [question(2)]);
    room.rule(room.rows()[0], { action: 'choose', account: 'earlier' });
    assert.deepEqual(canonical(), ['Galahan has dark hair.']);
    room.certify(3, { subject: 'Galahan', attribute: 'hair', value: 'red' }, [question(3)]);
    assert.equal(context().checkedThrough, 3);
    assert.deepEqual(canonical(), []);
    const unfinished = context();
    room.rule(room.rows()[0], { action: 'choose', account: 'source' });
    room.book.log = JSON.parse(JSON.stringify(room.book.log));
    assert.equal(context().message.position, 4);
    assert.deepEqual(canonical(), ['Galahan has red hair.']);
    assert.equal(ScribeLog.saveCheck(room.book, room.messages, unfinished, page(room.messages[3])), false);
    assert.deepEqual(Array.from(room.state().checkerRulings, (row) => row.status), ['superseded', 'settled']);
    room.certify(4, {});
    assert.equal(context().checkedThrough, 4);
});

test('leaving a reopened correction open keeps the discredited book value out until an account is chosen', () => {
    const room = disputed(['Frost owns a black horse.', 'Frost owns a brown horse.', 'Mirra owns a white mare.'],
        '=== SUBJECTS\nFrost | character\nMirra | character\n=== FACTS\nFrost | belonging | a white horse | #1\nMirra | belonging | a white mare | #3');
    const record = { ref: 'w1', text: JSON.stringify(room.book.log.entries[0].operations.find((operation) => operation.fact)) };
    const citation = (number) => ({ kind: 'Citation', question: 'What horse belongs to Frost?',
        source: room.source(number), earlier: null, record });
    room.certify(1, { subject: 'Frost', attribute: 'owns', value: 'black horse' }, [citation(1)]);
    room.rule(room.rows()[0], { action: 'choose', account: 'source' });
    room.certify(2, { subject: 'Frost', attribute: 'owns', value: 'brown horse' }, [citation(2)]);
    assert.equal(room.rows()[0].status, 'reopened');
    room.rule(room.rows()[0], { action: 'open' });
    room.book.log = JSON.parse(JSON.stringify(room.book.log));
    const facts = room.state().facts;
    assert.equal(facts.find((fact) => fact.text === 'a white horse').status, 'Removed');
    assert.equal(facts.find((fact) => fact.text === 'a white mare').status, 'InForce');
    assert.equal(room.rows()[0].status, 'deferred');
    const deferred = JSON.stringify(room.book.log);
    room.rule(room.rows()[0], { action: 'explain', explanation: 'Frost sold the black horse and later bought the brown horse.' });
    assert.equal(room.state().facts.find((fact) => fact.text === 'a white horse').status, 'Removed');
    room.book.log = JSON.parse(deferred);
    room.rule(room.rows()[0], { action: 'choose', account: 'record' });
    assert.equal(room.state().facts.find((fact) => fact.text === 'a white horse').status, 'InForce');
    assert.deepEqual(Array.from(room.state().checkerRulings, (row) => row.status), ['superseded', 'superseded', 'settled']);
});

test('the Last Mage combined weapon and reward entry splits into independently cited accounts without creating a transfer', () => {
    const room = disputed(['Magera says they raised her as a weapon.', 'Magera says the artifact was a reward.'],
        '=== SUBJECTS\nMagera | character\n=== FACTS\nMagera | background | raised as a weapon and received the artifact as a reward | #1');
    const record = { ref: 'h1', text: JSON.stringify(room.book.log.entries[0].operations.find((item) => item.fact)) };
    room.certify(1, { attribution: 'claimed', subject: 'Magera', attribute: 'raised', value: 'weapon' });
    room.certify(2, { attribution: 'claimed', subject: 'Magera', attribute: 'artifact', value: 'reward' }, [{
        kind: 'Citation', source: room.source(2), earlier: room.source(1), record, question: 'Which source supports the reward?',
    }]);
    room.rule(room.rows()[0], { action: 'choose', account: 'source' });
    assert.deepEqual(Array.from(room.state().facts, (fact) => [fact.cite, fact.evidence.value, fact.evidence.attribution]),
        [[room.order[0], 'weapon', 'claimed'], [room.order[1], 'reward', 'claimed']]);
    assert.equal(room.state().facts.some((item) => item.category === 'belonging'), false);
});

test('Finally Unsealed keeps Morwen’s chosen watch separate from the hearing question and the confirmed crown transfer', () => {
    const room = disputed(['Morwen takes third watch.', 'Morwen asks for second watch.', 'Lysandra hears a sound outside.',
        'The crown was given to Sylphira.'], '=== SUBJECTS\nSylphira | character\n=== FACTS\nSylphira | belonging | crown | #4');
    room.certify(1, { subject: 'Morwen', attribute: 'watch', value: 'third' });
    room.certify(2, { subject: 'Morwen', attribute: 'watch', value: 'second' }, [{
        kind: 'Question', source: room.source(2), earlier: room.source(1), record: null, question: 'Which watch is Morwen on?',
    }]);
    room.certify(3, {}, [{ kind: 'Omission', source: room.source(3), earlier: null, record: null, question: 'What did she hear?' }]);
    room.certify(4, {});
    room.rule(room.rows()[0], { action: 'choose', account: 'earlier' });
    const state = room.state();
    assert.equal(state.checkerRulings[0].canonical, 'Morwen takes third watch.');
    assert.equal(room.rows()[1].status, 'open');
    assert.equal(state.facts.find((fact) => fact.text === 'crown').status, 'InForce');
});

test('a Dawn ruling on a wager neither awards a tournament result nor settles an unrelated point in the same block', () => {
    const room = disputed(['Thessi accepts the wager. There are two chairs.', 'Thessi disputes the terms. She asks for another chair.']);
    room.certify(1, { subject: 'Thessi', attribute: 'wager', value: 'accepts' });
    const shared = { kind: 'Question', source: room.source(2), earlier: room.source(1), record: null };
    room.certify(2, { subject: 'Thessi', attribute: 'terms', value: 'disputes' }, [
        { ...shared, question: 'What terms were accepted?' }, { ...shared, question: 'How many chairs are there?' }]);
    room.rule(room.rows()[0], { action: 'explain', explanation: 'Thessi accepted the original wager. The contest is still open.' });
    assert.equal(room.rows()[1].status, 'open');
    assert.equal(room.state().facts.length, 0);
    assert.equal(room.state().checkerRulings[0].canonical, 'Thessi accepted the original wager. The contest is still open.');
});

test('existing Aedelas and Galahan answers settle their own cited questions and do not settle the town question', () => {
    const room = disputed(['Mirra calls Aedelas her father.', 'Mirra calls Aldren her father.',
        'Galahan has dark hair.', 'Galahan has silver hair.', 'They arrive in a different town.'],
        '=== QUESTIONS\nWho is Mirra’s father? | #2\nWhat color is Galahan’s hair? | #4');
    for (const [question, text] of [['Q1', 'Aedelas'], ['Q2', 'dark']]) {
        const state = room.state();
        const entry = ScribeLog.rule(room.book.log, state, { type: 'Answer', question, text });
        ScribeLog.link(entry, state, [], room.messages);
    }
    const pair = (number, earlier, question) => ({ kind: 'Question', question,
        source: room.source(number), earlier: room.source(earlier), record: null });
    room.certify(1, { subject: 'Mirra', attribute: 'father', value: 'Aedelas' });
    room.certify(2, { subject: 'Mirra', attribute: 'father', value: 'Aldren' }, [pair(2, 1, 'Who is Mirra’s father?')]);
    room.certify(3, { subject: 'Galahan', attribute: 'hair', value: 'dark' });
    room.certify(4, { subject: 'Galahan', attribute: 'hair', value: 'silver' }, [pair(4, 3, 'What color is Galahan’s hair?')]);
    room.certify(5, {}, [pair(5, 4, 'Did the town change?')]);
    assert.deepEqual(Array.from(room.rows(), (item) => [item.status, item.ruling?.canonical ?? null]),
        [['settled', 'Aedelas'], ['settled', 'dark'], ['open', null]]);
    assert.equal(room.state().checkerRulings.length, 2);
    const hair = room.rows()[1];
    const town = room.rows()[2];
    room.book.log.entries.at(-1).check.challenges = [{ finding: hair.id, sequence: hair.ruling.sequence, support: town.support }];
    room.book.log = JSON.parse(JSON.stringify(room.book.log));
    assert.equal(room.rows().filter((item) => item.status === 'settled').length, 2);
    assert.equal(room.rows().find((item) => item.id === town.id).status, 'open');
    assert.equal(room.state().checkerRulings.find((item) => item.finding === hair.id).status, 'settled');
});

test('an identical general question on a newly identified subject leaves the earlier ruling alone', () => {
    const room = disputed(['Galahan has dark hair.', 'Galahan has silver hair.', 'The shop is in another town.']);
    room.certify(1, { subject: 'Galahan', attribute: 'hair', value: 'dark' });
    const pair = (number) => ({ kind: 'Question', source: room.source(number), earlier: room.source(number - 1),
        record: null, question: 'Which account is accurate?' });
    room.certify(2, { subject: 'Galahan', attribute: 'hair', value: 'silver' }, [pair(2)]);
    room.rule(room.rows()[0], { action: 'choose', account: 'earlier' });
    room.certify(3, { subject: 'shop', attribute: 'town', value: 'another' }, [pair(3)]);
    assert.deepEqual(Array.from(room.rows(), (row) => row.status), ['settled', 'open']);
});

test('adaptive segments survive restart without publishing and are removed only after the nominal page is completed', () => {
    const { book, messages, order } = campaign();
    ScribeLog.append(book.log, ScribeReplay.run(book.log, order), [], { messages, origin: 'Story' });
    const original = page(messages[0]);
    const make = (suffix, index) => {
        const id = original.id + '/' + suffix;
        const raw = JSON.parse(original.answer);
        return { ...original, id, index, total: 2, planBytes: 12000, verifyFrom: 1, parentId: original.id, parentIndex: 0,
            answer: JSON.stringify({ ...raw, page: id }) };
    };
    const work = ScribeLog.checkWork(book, messages);
    const source = make('nested/0', 0);
    assert.equal(ScribeLog.saveCheck(book, messages, work, source), true);
    const copy = JSON.parse(JSON.stringify(book));
    const current = ScribeLog.checkWork(copy, messages);
    assert.equal(current.checkedThrough, 0);
    assert.equal(current.segments[0].id, source.id);
    assert.equal(ScribeLog.saveCheck(copy, messages, current, source), false);
    const invalid = make('other', 1);
    invalid.parentIndex = 1;
    assert.equal(ScribeLog.saveCheck(copy, messages, current, invalid), false);
    assert.equal(ScribeLog.saveCheck(copy, messages, current, make('nested/1', 1)), true);
    assert.equal(ScribeLog.saveCheck(copy, messages, current, original), true);
    assert.equal(ScribeLog.checkWork(copy, messages).checkedThrough, 1);
    assert.equal(copy.log.entries.at(-1).check.segments, undefined);
    book.log.entries.at(-1).check.segments[0].planBytes = 8000;
    assert.equal(ScribeLog.checkWork(book, messages).segments.length, 0);
});

test('the final page publishes checked progress and findings together without changing canonical replay or writing receipts', () => {
    const { book, messages, order } = campaign();
    ScribeLog.append(book.log, ScribeReplay.run(book.log, order), [], { messages, origin: 'Story' });
    const canonical = JSON.stringify(ScribeReplay.run(book.log, order));
    const originalMarks = JSON.stringify(book.log.read);
    const work = ScribeLog.checkWork(book, messages);
    assert.equal(work.message.id, messages[0].id);
    assert.equal(work.checkedThrough, 0);
    assert.equal(work.writtenThrough, 3);
    const first = page(messages[0], 0, 2);
    first.findings.push({ kind: 'Omission', source: first.claims[0].source, earlier: null,
        question: 'Was the promise recorded?' });
    assert.equal(ScribeLog.saveCheck(book, messages, work, page(messages[0], 1, 2)), false);
    assert.equal(ScribeLog.saveCheck(book, messages, work, first), true);
    const restored = JSON.parse(JSON.stringify(book));
    const retry = ScribeLog.checkWork(restored, messages);
    assert.equal(retry.version, work.version);
    assert.equal(retry.checkedThrough, 0);
    assert.equal(retry.completed.length, 1);
    assert.equal(retry.findings.length, 0);
    assert.equal(ScribeLog.saveCheck(restored, messages, work, first), false);
    assert.equal(ScribeLog.saveCheck(restored, messages, retry, page(messages[0], 1, 2)), true);
    const second = ScribeLog.checkWork(restored, messages);
    assert.equal(second.checkedThrough, 1);
    assert.equal(second.message.id, messages[1].id);
    assert.equal(second.findings.length, 1);
    assert.equal(second.earlierClaims.filter((row) => row.attribution === 'promised').length, 1);
    assert.equal(JSON.stringify(ScribeReplay.run(restored.log, order)), canonical);
    assert.equal(JSON.stringify(restored.log.read), originalMarks);
    assert.equal(restored.log.entries.filter((entry) => entry.origin === 'Checker').length, 1);
});

test('target-version checks refuse stale jobs, invented excerpts, bad speaker and later-source references', () => {
    const { book, messages, order } = campaign();
    ScribeLog.append(book.log, ScribeReplay.run(book.log, order), [], { messages: messages.slice(0, 1), origin: 'Story' });
    const work = ScribeLog.checkWork(book, messages);
    for (const source of [{ quote: 'was gifted a diamond' }, { speaker: 'Thessaly' }, { blockNumber: 30 }]) {
        const invalid = page(messages[0]);
        Object.assign(invalid.claims[0].source, source);
        assert.equal(ScribeLog.saveCheck(book, messages, work, invalid), false);
    }
    const later = page(messages[0]);
    later.findings.push({ kind: 'Contradiction', question: 'Who took it?', source: later.claims[0].source,
        earlier: page(messages[2]).claims[0].source });
    assert.equal(ScribeLog.saveCheck(book, messages, work, later), false);
    assert.equal(ScribeLog.saveCheck(book, messages, work, { ...page(messages[0]), answer: '{' }), false);
    assert.equal(ScribeLog.saveCheck(book, messages, work, { ...page(messages[0]), answer: '{}' }), false);
    ScribeLog.file(book.log, { type: 'AddFact', subject: 'S1', category: 'rule', text: 'Only Frost may promise.', hidden: false });
    assert.equal(ScribeLog.saveCheck(book, messages, work, page(messages[0])), false);
    const current = ScribeLog.checkWork(book, messages);
    assert.notEqual(current.version, work.version);
    assert.match(JSON.stringify(current.rulings), /Only Frost/);
    assert.equal(ScribeLog.saveCheck(book, messages, current, page(messages[0])), true);
    const archive = JSON.stringify(book);
    const reference = page(messages[0]);
    for (const bad of ['No comparison was possible.', '{}', JSON.stringify({ page: reference.id, complete: false, claims: [], findings: [] }),
        JSON.stringify({ page: 'wrong', complete: true, claims: [], findings: [] }),
        JSON.stringify({ page: reference.id, complete: true, claims: [], findings: [] })]) {
        const restored = JSON.parse(archive);
        restored.log.entries.at(-1).check.pages[0].answer = bad;
        const pending = ScribeLog.checkWork(restored, messages);
        assert.equal(pending.checkedThrough, 0);
        assert.equal(pending.completed.length, 0);
        assert.equal(ScribeLog.saveCheck(restored, messages, pending, reference), true);
        assert.equal(ScribeLog.checkProgress(restored, messages).checkedThrough, 1);
    }
    book.log.entries.at(-1).check.pages[0].claims[0].source.quote = 'Invented excerpt';
    const damaged = ScribeLog.checkWork(book, messages);
    assert.equal(damaged.checkedThrough, 0);
    assert.equal(damaged.completed.length, 0);
    assert.equal(ScribeLog.saveCheck(book, messages, damaged, page(messages[0])), true);
    assert.equal(ScribeLog.checkProgress(book, messages).checkedThrough, 1);
});

test('historical review contains the filed operation at its source, older independent claims, and no later facts or rulings', () => {
    const { book, messages, order } = campaign();
    const facts = ScribeAnswer.parse('=== FACTS\nMagera | belonging | staff | #2').operations;
    ScribeLog.append(book.log, ScribeReplay.run(book.log, order), facts, { messages: messages.slice(0, 2), origin: 'Story' });
    ScribeLog.append(book.log, ScribeReplay.run(book.log, order), [], { messages: messages.slice(2), origin: 'Story' });
    ScribeLog.file(book.log, { type: 'AddFact', subject: 'S1', category: 'trait', text: 'Future ruling', hidden: false });
    const first = ScribeLog.checkWork(book, messages);
    assert.equal(first.message.fromPlayer, true);
    assert.doesNotMatch(JSON.stringify([first.written, first.earlierClaims, first.rulings]), /staff|Magera|Future ruling/);
    assert.equal(ScribeLog.saveCheck(book, messages, first, page(messages[0])), true);
    const second = ScribeLog.checkWork(book, messages);
    assert.match(JSON.stringify(second.written), /Magera/);
    assert.match(JSON.stringify(second.earlierClaims), /promised/);
    assert.doesNotMatch(JSON.stringify([second.written, second.earlierClaims, second.rulings]), /returns to the guild|Future ruling/);
    assert.equal(ScribeLog.saveCheck(book, messages, second, page(messages[1])), true);
    assert.match(JSON.stringify(ScribeLog.checkWork(book, messages).rulings), /Future ruling/);
    delete book.log.read[messages[0].id];
    const gap = ScribeLog.checkProgress(book, messages);
    assert.equal(gap.writtenThrough, 0);
    assert.equal(gap.checkedThrough, 0);
});
