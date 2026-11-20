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
