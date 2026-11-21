import assert from 'node:assert/strict';
import test from 'node:test';
import CampaignBuilder from './support/CampaignBuilder.mjs';
import CitedStory from './support/CitedStory.mjs';
import ScribeCore from './support/ScribeCore.mjs';

const { ScribeIntake, ScribeAnswer, ScribeLog, ScribeReplay, ScribeAnalyzer, ScribeAdoption } = ScribeCore.load([
    'ScribeText',
    'ScribeCategory',
    'ScribeIntake',
    'ScribeAnswer',
    'ScribeLog',
    'ScribeReplay',
    'ScribeAnalyzer',
    'ScribeAdoption',
]);

const firstNote = 'Halvard served ten years with the pikes.';
const laterNote = 'Mirelle keeps the harbour ledger.';
const prose = 'I could not tell which lines matter | the story runs long.';
const questions = [
    'Does Mirelle trust Halvard? | #12',
    'Who rang the harbour bell? | #30',
    'Is the ledger forged? | #35',
];

/**
 * @param {Object<number, string>} written
 * @param {number[]} without
 * @return {{ messages: readonly object[], notes: readonly object[], player: string }}
 */
function campaign(written = {}, without = []) {
    const builder = new CampaignBuilder('Orla');
    for (let number = 1; number <= 100; number++) {
        const duties = `Halvard keeps watch from line ${number}. Mirelle counts coins to line ${number}.`;
        if (Object.hasOwn(written, number)) {
            builder.player(written[number]);
        } else if (number % 2 === 0) {
            builder.player(`I answer the ferryman, line ${number}. ${duties}`);
        } else {
            builder.narrator(`The tale goes on, line ${number}. ${duties}`);
        }
    }
    return ScribeIntake.read(builder.messages.filter((raw, index) => !without.includes(index + 1)));
}

const plainCampaign = campaign();

test('restored legacy rooms resume at their saved source prefix and leave evidence verification pending', () => {
    const builder = new CampaignBuilder('Frost');
    for (let position = 1; position <= 896; position++) {
        builder.narrator('The company rests at station ' + position + '.');
    }
    const room = ScribeIntake.read(builder.messages);
    for (const through of [212, 502, 360, 863, 894]) {
        const log = ScribeLog.create();
        for (let start = 1; start <= through; start += 40) {
            markRead(log, room, start, Math.min(start + 39, through));
        }
        const restored = plain({ log, adopted: true, fingerprints: Object.fromEntries(
            room.messages.slice(0, through).map((message) => [message.id, message.fingerprint])),
            scene: { through: 896 } });
        const coverage = ScribeLog.coverage(restored, room.messages);
        assert.equal(coverage.writtenThrough, through);
        assert.deepEqual(plain(coverage.verificationPending), orderOf(room).slice(0, through));
        assert.equal(ScribeAdoption.next(restored.log, room.messages, 40)[0].position, through + 1);
        assert.equal(ScribeLog.invalidated(restored, room.messages, []).size, 0);
        delete restored.fingerprints[room.messages[14].id];
        assert.equal(ScribeLog.coverage(restored, room.messages).writtenThrough, 14);
        assert.equal(ScribeLog.invalidated(restored, room.messages, []).size, through - 14);
    }
});

test('restored source receipts invalidate the dependent suffix and retain the original partial reading', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Frost').narrator('Sera has green eyes.')
        .narrator('Tima has silver hair.').narrator('The rain continues.').messages);
    const written = await adopt({ campaign: room, answering: () => cited(
        ['Sera | eyes | green | #1', 'Tima | hair | silver | #2'],
        [{ messageNumber: 1, quote: 'Sera has green eyes.' }, { messageNumber: 2, quote: 'Tima has silver hair.' }],
        ['#1 | read', '#2 | read', '#3 | no change']) });
    assert.equal(written.result.stop, 'Done');
    const book = { log: plain(written.log), fingerprints: Object.fromEntries(room.messages.map((m) => [m.id, m.fingerprint])) };
    assert.deepEqual(plain(ScribeLog.coverage(book, room.messages)), { writtenThrough: 3, verificationPending: [], legacyClaims: [] });
    const earlierBook = plain(book);
    delete earlierBook.log.entries[0].sources;
    const prior = ScribeLog.coverage(earlierBook, room.messages);
    assert.deepEqual(plain(prior.verificationPending), orderOf(room));
    assert.equal(prior.legacyClaims.find((claim) => claim.text === 'green').candidates[0].quote, 'Sera has green eyes.');
    assert.equal(prior.legacyClaims.find((claim) => claim.text === 'green').candidates[0].attribution, 'witnessed');
    assert.equal(ScribeLog.invalidated(book, room.messages.slice(1), [], room.messages).size, 0);
    assert.equal(ScribeLog.invalidated(book, room.messages, [], room.messages.slice(1)).size, 0);
    const reordered = [room.messages[0], room.messages[2], room.messages[1]];
    assert.deepEqual([...ScribeLog.invalidated(book, reordered, [], reordered)].sort(), ['MESSAGE-2', 'MESSAGE-3']);
    assert.deepEqual([...ScribeLog.invalidated(book, room.messages.slice(1), ['MESSAGE-1'])].sort(), orderOf(room));
    const changed = [room.messages[0], { ...room.messages[1], fingerprint: 'edited' }, room.messages[2]];
    const freed = ScribeLog.withdrawSources(book.log, ScribeLog.invalidated(book, changed, []));
    assert.deepEqual([...freed], ['MESSAGE-2', 'MESSAGE-3']);
    assert.equal(ScribeLog.coverage(book, changed).writtenThrough, 1);
    assert.deepEqual(plain(book.log.entries[0].messageIds), orderOf(room));
    assert.ok(book.log.entries[0].operations.some((operation) => operation.text === 'silver'));
    assert.deepEqual(plain(ScribeReplay.run(plain(book.log), orderOf(room)).facts.map((fact) => fact.text)), ['green']);
});

test('old batches detect insertion from known campaign order and deletion beside a saved source', () => {
    const room = plainCampaign;
    const log = ScribeLog.create();
    markRead(log, room, 1, 2);
    markRead(log, room, 3, 4);
    const messages = room.messages.slice(0, 4);
    const book = { log: plain(log), fingerprints: Object.fromEntries(messages.map((message) => [message.id, message.fingerprint])) };
    const inserted = [...messages.slice(0, 2), { ...messages[0], id: 'NEW' }, ...messages.slice(2)];
    assert.deepEqual([...ScribeLog.invalidated(book, inserted, [], messages)], ['MESSAGE-3', 'MESSAGE-4']);
    const prefixed = [{ ...messages[0], id: 'NEW' }, ...messages];
    assert.deepEqual([...ScribeLog.invalidated(book, prefixed, [], messages)], messages.map((message) => message.id));
    assert.deepEqual([...ScribeLog.invalidated(book, prefixed, [], messages, false)], []);
    assert.deepEqual([...ScribeLog.invalidated(book, messages, [], messages.slice(2))], []);
    const insideBatch = [messages[0], { ...messages[0], id: 'NEW' }, ...messages.slice(1)];
    assert.deepEqual([...ScribeLog.invalidated(book, insideBatch, [])], ['MESSAGE-2', 'MESSAGE-3', 'MESSAGE-4']);
    const remaining = [messages[0], ...messages.slice(2)];
    assert.deepEqual([...ScribeLog.invalidated(book, remaining, ['MESSAGE-2'])], ['MESSAGE-2', 'MESSAGE-3', 'MESSAGE-4']);
});

test('a completed legacy gap retains all four written sources when its last read happened out of order', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Frost').narrator('First.').narrator('Second.')
        .narrator('Third.').narrator('Fourth.').messages);
    const log = ScribeLog.create();
    for (const position of [1, 3, 4, 2]) {
        markRead(log, room, position, position);
    }
    const book = plain({ log, fingerprints: Object.fromEntries(room.messages.map((message) => [message.id, message.fingerprint])) });
    for (const previous of [[], room.messages]) {
        const retired = ScribeLog.invalidated(book, room.messages, [], previous);
        assert.deepEqual([...retired], []);
        ScribeLog.withdrawSources(book.log, retired);
    }
    assert.equal(ScribeLog.coverage(book, room.messages).writtenThrough, 4);
    const result = await adopt({ log: book.log, campaign: room, answering: () => { throw Error('Unexpected paid read'); } });
    assert.equal(result.result.stop, 'Done');
    assert.equal(result.calls.length, 0);
    const changed = room.messages.map((message, index) => index === 1 ? { ...message, fingerprint: 'edited' } : message);
    assert.deepEqual([...ScribeLog.invalidated(book, changed, [])], ['MESSAGE-2', 'MESSAGE-3', 'MESSAGE-4']);
});

test('legacy quote reconstruction returns only exact source candidates and leaves an unsupported statement open', () => {
    const room = ScribeIntake.read(new CampaignBuilder('Frost').narrator('Sera has silver hair.').messages);
    const log = ScribeLog.create();
    const parsed = ScribeAnswer.parse('=== FACTS\nSera | hair | silver | #1\nSera | eyes | emerald | #1');
    ScribeLog.append(log, ScribeReplay.run(log, orderOf(room)), parsed.operations, { messages: room.messages, origin: 'Story' });
    const message = room.messages[0];
    const book = { log: plain(log), fingerprints: { [message.id]: message.fingerprint } };
    const claims = ScribeLog.coverage(book, [message]).legacyClaims;
    assert.deepEqual(plain(claims.map((claim) => claim.candidates)), [
        [{ blockNumber: 1, speaker: message.blocks[0].speaker, quote: 'silver' }], [],
    ]);
    assert.deepEqual(plain(ScribeLog.coverage(book, room.messages).verificationPending), [message.id]);
    assert.equal(ScribeLog.coverage(book, [{ ...message, fingerprint: 'edited' }]).legacyClaims.length, 0);
});

/**
 * @param {string[]} facts
 * @param {object[]} records
 * @param {string[]} marks
 * @param {string} section
 * @return {string}
 */
function cited(facts, records, marks, section = 'FACTS') {
    return answer({ [section]: facts, EVIDENCE: records.map((record, index) => JSON.stringify({
        section, row: index + 1, blockNumber: 1, attribution: 'witnessed', form: null, dimension: null, ...record,
    })), READ: marks });
}

test('reading reports count context messages and a filed source without a repeated READ line', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Orla').narrator('They reach the harbour.')
        .narrator('They look around.').narrator('The gate has a bronze bell.').messages);
    const run = await adopt({ campaign: room, answering: () => cited(['Harbour gate | feature | bronze bell | #3'],
        [{ messageNumber: 3, quote: 'a bronze bell' }], ['#1 | read', '#2 | read']) });
    assert.equal(run.result.stop, 'Done', run.result.problem);
    assert.equal(run.calls.length, 1);
    const restored = plain(run.log);
    assert.deepEqual(restored.entries[0].sources.map((source) => [source.position, source.result]),
        [[1, 'read'], [2, 'read'], [3, 'processed']]);
    assert.equal(ScribeReplay.run(restored, orderOf(room)).facts[0].text, 'bronze bell');
    const book = { log: restored, fingerprints: Object.fromEntries(room.messages.map((row) => [row.id, row.fingerprint])) };
    assert.deepEqual(plain(ScribeLog.coverage(book, room.messages)), { writtenThrough: 3, verificationPending: ['MESSAGE-3'], legacyClaims: [] });
});

test('at #1037 an earlier scene, Night and Thread survive an imperfect answer and the next batch runs', async () => {
    const builder = new CampaignBuilder('Orla');
    for (const position of numbers(1, 1039)) {
        builder.narrator('The party crosses station ' + position + '.');
    }
    const room = ScribeIntake.read(builder.messages);
    const log = ScribeLog.create();
    markRead(log, room, 1, 1036);
    const evidence = (section, row, messageNumber, quote) => JSON.stringify({ section, row, messageNumber,
        blockNumber: 1, quote, attribution: 'witnessed', form: null, dimension: null });
    const content = answer({ SCENES: ['Day 3 | #1017-#1037 | Quay | public | present: Orla | The party crosses the quay.'],
        NIGHTS: ['#1037 | Camp on the quay.'], THREADS: ['OPEN | Who follows the party? | #1038'],
        FACTS: ['unauthorized shape'], EVIDENCE: [evidence('SCENES', 1, 1037, 'station 1037'),
            evidence('NIGHTS', 1, 1037, 'The camp'), evidence('THREADS', 1, 1038, 'A visitor'),
            evidence('FACTS', 1, 1038, 'station 1038')], READ: ['#1037 | read', '#1038 | read'] });
    const run = await adopt({ campaign: room, log, size: 2, rawStory: true, answering: (_call, index) => index === 1 ?
        '```text\n' + content + '\n```' : answer({READ: ['#1039 | no change']}) });
    assert.equal(run.result.stop, 'Done', run.result.problem);
    assert.deepEqual(passes(run.calls), [['Story', [1037, 1038]], ['Story', [1039, 1039]]]);
    const restored = plain(log);
    const replay = ScribeReplay.run(restored, orderOf(room));
    assert.deepEqual([replay.scenes[0].firstPosition, replay.scenes[0].lastPosition], [1017, 1037]);
    assert.equal(replay.nights[0].marker, 'Camp on the quay.');
    assert.equal(replay.threads[0].text, 'Who follows the party?');
    const rows = ScribeLog.checkIndex({ log: restored }, room.messages).rows;
    for (const [position, quote] of [[1037, 'The camp'], [1038, 'A visitor']]) {
        const record = rows[position - 1].written.find((item) => item.modelCitation?.quote === quote);
        assert.equal(record.source, undefined);
        assert.deepEqual(plain(record.modelCitation.original.pieces), [{offset: 0, quote: 'The party crosses station ' + position + '.'}]);
        assert.equal(record.modelCitation.attribution, 'witnessed');
    }
    assert.equal(rows[1036].written.some((item) => item.text === 'unauthorized shape'), false);
    assert.equal(rows[1037].written.filter((item) => item.text === 'unauthorized shape').length, 1);
    assert.equal((await adopt({campaign: room, log: restored})).calls.length, 0);
});

test('an explicit source retry repairs one citation in place and retains an unresolved model proposal', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Orla').narrator('The quay is quiet.').narrator('A bell rings.').messages);
    const initial = await adopt({ campaign: room, answering: () => answer({
        FACTS: ['Quay | feature | quiet | #1'], CHANGES: ['F999 | Quay | feature | FULLER: old bell | #2'],
        EVIDENCE: ['FACTS', 'CHANGES'].map((section, index) => JSON.stringify({ section, row: 1,
            messageNumber: index + 1, blockNumber: 1, quote: index ? 'bell' : 'silent',
            attribution: 'witnessed', form: null, dimension: null })), READ: ['#1 | read', '#2 | read'],
    }) });
    const ids = orderOf(room);
    const log = plain(initial.log);
    const id = ScribeReplay.run(log, ids).facts[0].id;
    const retry = await adopt({ campaign: room, log, retrySources: [ids[0]], rawStory: true, answering: () =>
        cited(['Quay | feature | quiet | #1'], [{ messageNumber: 1, quote: 'quiet' }], ['#1 | read']) });
    assert.equal(retry.result.stop, 'Done', retry.result.problem);
    assert.deepEqual(passes(retry.calls), [['Story', [1, 1]]]);
    const repaired = ScribeReplay.run(log, ids).facts;
    assert.deepEqual(plain(repaired.map((fact) => [fact.id, fact.evidence.quote])), [[id, 'quiet']]);
    const unchanged = await adopt({ campaign: room, log, retrySources: [ids[1]], rawStory: true,
        answering: () => answer({READ: ['#2 | no change']}) });
    assert.equal(unchanged.calls.length, 1);
    assert.deepEqual(plain(ScribeAdoption.pendingSources(log, room.messages).map((item) => item.id)), [ids[1]]);
    assert.equal(log.entries[0].proposals[0].operation.fact, 'F999');
    assert.equal((await adopt({campaign: room, log})).calls.length, 0);
});

test('two explicit notes sharing a source retain their full responses and cost one call each', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Orla').narrator('The quay is quiet.').narrator('A bell rings.').messages);
    const campaign = { ...room, notes: [{position: 1, text: 'The horn is brass.'}, {position: 1, text: 'The bell is bronze.'}] };
    const notes = (call) => call.user.includes('The horn is brass.') ? answer({ FACTS: ['Horn | feature | brass | #1'],
        CHANGES: ['F999 | Horn | feature | FULLER: brass | #1'] }) : answer({ FACTS: ['Bell | feature | bronze | #1'] });
    const first = await adopt({ campaign, answering: (call) => call.pass === 'Notes' ? notes(call) : answer({ READ: ['#1 | read', '#2 | read'] }) });
    assert.equal(first.result.stop, 'Done', first.result.problem);
    assert.deepEqual(plain(first.log.notes), ['The horn is brass.', 'The bell is bronze.']);
    const key = ScribeAdoption.inputKey(campaign.notes[0], room.messages[0]);
    const retry = await adopt({ campaign, log: first.log, retryInputs: [key], answering: () => answer({ FACTS: ['Horn | feature | brass | #1'] }) });
    assert.equal(retry.calls.length, 0);
    assert.equal(first.log.entries.filter((entry) => entry.origin === 'Notes' && entry.modelResponse).length, 2);
    assert.deepEqual(plain(ScribeReplay.run(first.log, orderOf(room)).facts.map((fact) => fact.text)), ['brass', 'bronze']);
});

test('repairing the same source and row keeps the original model response in history and removes only its active filing issue', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Orla').narrator('The guard has red hair.')
        .narrator('The guard has blue eyes.').messages);
    for (const independent of [false, true]) {
        const unfiled = ['Guard | hair | #1', 'Guard | eyes | #2', ...(independent ? ['Guard | clothing | #1'] : [])];
        const citations = [{ messageNumber: 1, quote: 'red' }, { messageNumber: 2, quote: 'blue' },
            ...(independent ? [{ messageNumber: 1, quote: 'guard' }] : [])];
        const first = await adopt({ campaign: room, answering: () => cited(unfiled, citations, ['#1 | read', '#2 | read']) });
        const repaired = await adopt({ campaign: room, log: first.log, retrySources: ['MESSAGE-1'],
            answering: () => cited(['Guard | hair | red | #1'], [{messageNumber: 1, quote: 'red'}], ['#1 | read']) });
        assert.equal(repaired.result.stop, 'Done', repaired.result.problem);
        assert.equal(ScribeReplay.run(first.log, orderOf(room)).facts[0].text, 'red');
        const historical = first.log.entries[0].unfiledRows;
        assert.equal(historical[0].line, unfiled[0]);
        assert.equal(historical[0].resolvedBy, 2);
        assert.ok(historical.slice(1).every((line) => !line.resolvedBy));
        const rows = ScribeLog.checkIndex({log: first.log}, room.messages).rows;
        const active = rows.flatMap((row) => row.written.filter((item) => item.filing === 'unfiled model answer').map((item) => item.text));
        assert.deepEqual([...active].sort(), unfiled.slice(1).sort());
        assert.deepEqual(plain(ScribeAdoption.pendingSources(first.log, room.messages).map((item) => item.position)), [2]);
    }
});

test('standalone readings remain available without paid re-reading; a mixed answer keeps its independent unresolved rows', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Orla').narrator('The guard had red hair.').messages);
    const prose = 'The guard had red hair.';
    const fact = cited(['Guard | hair | red | #1'], [{messageNumber: 1, quote: 'red'}], ['#1 | read']);
    for (const [initial, retried, remains, facts, legacy] of [
        [prose, fact, false, 0, false],
        [prose, fact, false, 0, true],
        [prose, answer({READ: ['#1 | no change']}), false, 0, false],
        [prose + '\n' + fact, fact, true, 1, false],
        [prose, 'Still an unstructured answer.', false, 0, false],
    ]) {
        const first = await adopt({campaign: room, rawStory: true, answering: () => initial});
        const log = plain(first.log);
        if (legacy) {
            delete log.entries[0].modelReading;
            log.entries[0].unfiledRows = [{ block: 'PREAMBLE', line: prose, reason: 'Shape', reviewAt: 'MESSAGE-1', wholeAnswer: true }];
            log.entries[0].sources[0].result = 'unverified';
            log.entries[0].sources[0].filingPending = [{ reason: 'format' }, { reason: 'missingRead' }];
        }
        const repeat = await adopt({campaign: room, log, retrySources: ['MESSAGE-1'], rawStory: true, answering: () => retried});
        assert.equal(repeat.calls.length, 0);
        assert.equal(repeat.result.stop, 'Done');
        if (!remains) {
            assert.equal(ScribeLog.modelReading(log.entries[0]), prose);
        } else {
            assert.equal(log.entries[0].unfiledRows[0].line, prose);
        }
        assert.equal(ScribeReplay.run(log, orderOf(room)).facts.length, facts);
        assert.equal(ScribeAdoption.pendingSources(log, room.messages).length, 0);
        assert.ok(ScribeLog.checkIndex({log}, room.messages).rows[0].written.some((item) => item.text === prose));
        assert.equal((await adopt({campaign: room, log})).calls.length, 0);
    }
});

test('correcting the target of a reference proposal retires only the corresponding model change', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Orla').narrator('The guard has red hair.')
        .narrator('The hair is red and long.').messages);
    for (const independent of [false, true]) {
        const first = await adopt({ campaign: room, readThrough: 1, answering: () =>
            cited(['Guard | hair | red | #1'], [{messageNumber: 1, quote: 'red'}], ['#1 | read']) });
        const bad = ['F999 | Guard | hair | FULLER: red and long | #2',
            ...(independent ? ['F998 | Guard | hair | FULLER: tied back | #2'] : [])];
        const records = bad.map(() => ({messageNumber: 2, quote: 'red and long'}));
        await adopt({ campaign: room, log: first.log, answering: () => cited(bad, records, ['#2 | read'], 'CHANGES') });
        const retried = await adopt({ campaign: room, log: first.log, retrySources: ['MESSAGE-2'], answering: () =>
            cited([bad[0].replace('F999', 'F1')], [records[0]], ['#2 | read'], 'CHANGES') });
        assert.equal(retried.result.stop, 'Done', retried.result.problem);
        assert.ok(ScribeReplay.run(first.log, orderOf(room)).facts.some((fact) => fact.id === 'F2' && fact.text === 'red and long'));
        assert.equal(first.log.entries[1].proposals[0].operation.fact, 'F999');
        assert.equal(first.log.entries[1].proposals[0].resolvedBy, 3);
        const open = ScribeLog.checkIndex({log:first.log}, room.messages).rows[1].written.filter((row) => row.filing === 'unfiled proposal');
        assert.deepEqual(plain(open.map((row) => JSON.parse(row.text).fact)), independent ? ['F998'] : []);
        assert.deepEqual(plain(ScribeAdoption.pendingSources(first.log, room.messages).map((item) => item.position)), independent ? [2] : []);
    }
});

test('different row and evidence citations retain the original positions and disputed quote', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Orla').says('Mirelle', 'I keep the seals.')
        .says('Oswin', 'I keep the seals.').messages);
    const run = await adopt({ campaign: room, answering: () => cited(['Mirelle | role | keeper of seals | #2'],
        [{ messageNumber: 1, quote: 'I keep the seals.', attribution: 'claimed' }], []) });
    assert.equal(run.result.stop, 'Done');
    assert.ok(run.log.entries[0].sources[1].filingPending.some((item) => item.reason === 'Citation'));
    assert.deepEqual(Object.keys(run.log.read), ['MESSAGE-1', 'MESSAGE-2']);
    const fact = ScribeReplay.run(plain(run.log), orderOf(room)).facts[0];
    assert.deepEqual([fact.cite, fact.position, fact.evidence.speaker, fact.evidence.messageId],
        ['MESSAGE-2', 2, null, 'MESSAGE-2']);
    assert.equal(fact.evidence.citedMessage, 1);
    assert.equal(fact.evidence.verified, false);
});

test('a mismatching row citation cannot bypass the shown batch, exact block or source quote', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Orla').narrator('The quay is quiet.')
        .narrator('The gate has a bell.').messages);
    for (const [position, messageNumber, blockNumber, quote, reason] of [
        [9, 1, 1, 'quay', 'proposal'],
        [2, 9, 1, 'quay', 'Citation'],
        [2, 2, 4, 'quay', 'Block'],
        [2, 2, 1, 'no bell at all', 'Quote'],
    ]) {
        const run = await adopt({ campaign: room, answering: () => cited(['Quay | feature | quiet | #' + position],
            [{ messageNumber, blockNumber, quote }], ['#1 | read', '#2 | read']) });
        assert.equal(run.result.stop, 'Done');
        const [fact] = ScribeReplay.run(run.log, orderOf(room)).facts;
        if (reason === 'proposal') {
            assert.equal(fact, undefined);
            assert.equal(run.log.entries[0].proposals[0].operation.modelEvidence.messageNumber, 1);
            continue;
        }
        assert.equal(fact.evidence.issue ?? null, reason);
        assert.equal(fact.evidence.quote, reason ? null : quote);
        if (reason) {
            assert.equal(fact.evidence.modelQuote, quote);
        }
    }
});

test('a missing numbered receipt leaves the source processed and keeps the later receipt', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Orla').narrator('Ships arrive.')
        .narrator('The tide turns.').narrator('Ropes are cast.').messages);
    const run = await adopt({ campaign: room, answering: () => answer({ READ: ['#1 | read', '#3 | no change'] }) });
    assert.equal(run.result.stop, 'Done');
    assert.deepEqual(plain(run.log.entries[0].sources.map((item) => item.result)), ['read', 'processed', 'no change']);
    assert.deepEqual(plain(ScribeAdoption.pendingSources(run.log, room.messages)), []);
});

test('a truncated or repeated numbered result leaves the valid prefix read and the defective message pending', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Orla').narrator('The tide turns.')
        .narrator('Ships arrive.').narrator('The gate has a bronze bell.').messages);
    for (const [last, reason] of [
        [['#3 | rea'], 'invalidRead'], [['#3'], 'invalidRead'],
        [['#3 | read', '#3 | read'], 'duplicateRead'], [['#3 | read', '#3 | no change'], 'duplicateRead'],
    ]) {
        const run = await adopt({ campaign: room, answering: () => cited(['Gate | feature | bronze bell | #3'],
            [{ messageNumber: 3, quote: 'a bronze bell' }], ['#1 | read', '#2 | read', ...last]) });
        assert.equal(run.result.stop, 'Done');
        assert.ok(run.log.entries[0].sources[2].filingPending.some((item) => item.reason === reason));
        assert.deepEqual(Object.keys(run.log.read), ['MESSAGE-1', 'MESSAGE-2', 'MESSAGE-3']);
        assert.equal(ScribeReplay.run(run.log, orderOf(room)).facts.length, 1);
    }
    for (const malformed of ['unfinished', '#4 | rea', '#2 | read #3 | rea']) {
        const run = await adopt({ campaign: room, answering: () => answer({ READ: ['#1 | read', '#2 | read', '#3 | read', malformed] }) });
        assert.equal(run.result.stop, 'Done');
        assert.equal(run.log.entries[0].unfiledRows[0].line, malformed);
    }
});

test('a model source row acknowledges the reading while preserving conflicts and unresolved references', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Orla').narrator('The ships sail.')
        .narrator('The gate has a bronze bell.').messages);
    for (const [section, row, quote, finalMark, reason] of [
        ['FACTS', 'Gate | feature | bronze bell | #2', 'a bronze bell', '#2 | no change', 'conflictingRead'],
        ['FACTS', 'Gate | feature | a stone wall | #2', 'a stone wall', '#2 | read', 'Quote'],
        ['CHANGES', 'F999 | Gate | feature | FULLER: bronze bell | #2', 'a bronze bell', null, 'Reference'],
    ]) {
        const run = await adopt({ campaign: room, answering: () => cited([row], [{ messageNumber: 2, quote }],
            ['#1 | read', ...(finalMark ? [finalMark] : [])], section) });
        assert.equal(run.result.stop, 'Done');
        assert.ok(run.log.entries[0].sources[1].filingPending.some((item) => item.reason === reason));
        assert.equal(run.log.entries[0].sources[1].result, reason === 'conflictingRead' ? 'no change' : finalMark ? 'read' : 'processed');
        assert.equal(ScribeReplay.run(run.log, orderOf(room)).facts.length, reason === 'Reference' ? 0 : 1);
        if (reason === 'Reference') {
            assert.equal(run.log.entries[0].proposals[0].operation.fact, 'F999');
        }
    }
});

test('separately sourced forms survive adoption, serialization and replay at #196', async () => {
    const builder = new CampaignBuilder('Frost');
    while (builder.messages.length < 196) {
        const position = builder.messages.length + 1;
        builder.narrator(position === 148 ? 'Sera is five foot nine in human form.' :
            position === 196 ? 'Sera is twenty meters long in full dragon form.' : 'The road is quiet.');
    }
    const book = ScribeIntake.read(builder.messages);
    const log = ScribeLog.create();
    markRead(log, book, 1, 147);
    const rows = ['Sera | build | five foot nine in human form | #148', 'Sera | build | twenty meters long in full dragon form | #196'];
    const run = await adopt({ campaign: book, log, size: 80, answering: () => cited(rows, [
        { messageNumber: 148, quote: 'five foot nine in human form', form: 'human', dimension: 'height' },
        { messageNumber: 196, quote: 'twenty meters long in full dragon form', form: 'full dragon', dimension: 'length' },
    ], numbers(148, 196).map((position) => '#' + position + ([148, 196].includes(position) ? ' | read' : ' | no change'))) });
    assert.equal(run.result.stop, 'Done', run.result.problem);
    const state = ScribeReplay.run(plain(log), orderOf(book));
    assert.deepEqual(plain(state.facts.map((fact) => [fact.status, fact.form, fact.dimension, fact.evidence.messageId,
        fact.evidence.fingerprint, fact.evidence.quote])), [
        ['InForce', 'human', 'height', 'MESSAGE-148', book.messages[147].fingerprint, 'five foot nine in human form'],
        ['InForce', 'full dragon', 'length', 'MESSAGE-196', book.messages[195].fingerprint, 'twenty meters long in full dragon form'],
    ]);
    assert.equal(state.conflicts.length, 0);
});

test('the weapon account at #199 persists separately from the reward at #209', async () => {
    const builder = new CampaignBuilder('Frost');
    const weapon = 'They meant to raise me as a weapon for their war.';
    const reward = 'They gave me the artifact as a reward.';
    while (builder.messages.length < 209) {
        const number = builder.messages.length + 1;
        if (number === 199 || number === 209) {
            builder.says('Magera', number === 199 ? weapon : reward);
        } else {
            builder.narrator('The road is quiet.');
        }
    }
    const book = ScribeIntake.read(builder.messages);
    const log = ScribeLog.create();
    markRead(log, book, 1, 197);
    const marks = numbers(198, 209).map((number) => '#' + number + ([199, 209].includes(number) ? ' | read' : ' | no change'));
    const records = [{ messageNumber: 199, quote: weapon, attribution: 'claimed' },
        { messageNumber: 209, quote: reward, attribution: 'claimed' }];
    const summary = 'Her captors intended to turn her into a weapon of war.';
    const run = await adopt({ campaign: book, log, answering: () => cited([
        'Magera | background | ' + summary + ' | #199', 'Magera | background | ' + reward + ' | #209',
    ], records, marks) });
    assert.equal(run.result.stop, 'Done', run.result.problem);
    assert.equal(readCount(log, book), 209);
    assert.deepEqual(plain(ScribeReplay.run(plain(log), orderOf(book)).facts.map((fact) =>
        [fact.evidence.speaker, fact.evidence.attribution, fact.evidence.messageNumber, fact.evidence.quote, fact.text])), [
        ['Magera', 'claimed', 199, weapon, summary], ['Magera', 'claimed', 209, reward, reward],
    ]);
});

test('model-declared measurement scopes and change references survive replay', async () => {
    const book = ScribeIntake.read(new CampaignBuilder('Frost').narrator('In human form Sera is five foot nine.')
        .narrator('In full dragon form Sera is 20 m long.').messages);
    const first = await adopt({ campaign: book, readThrough: 1, answering: () =>
        cited(['Sera | build | five foot nine | #1'], [{ messageNumber: 1, quote: 'five foot nine',
            form: 'humanoid', dimension: 'stature' }], ['#1 | read']) });
    assert.equal(first.result.stop, 'Done', first.result.problem);
    const log = first.saved[0];
    const source = { messageNumber: 2, quote: '20 m', form: 'draconic', dimension: 'body length' };
    for (const id of ['F1', 'F999']) {
        const change = await adopt({ campaign: book, log: plain(log), readThrough: 2, answering: () => cited([
            id + ' | Sera | build | 20 m | #2',
        ], [source], ['#2 | read'], 'CHANGES') });
        assert.equal(change.result.stop, 'Done');
        assert.equal(readCount(change.log, book), 2);
        if (id === 'F1') {
            assert.equal(change.reports.at(-1).refusedOperations.length, 0);
            assert.deepEqual(plain(change.log.entries.at(-1).operations[0].declared), {
                label: 'Sera', category: 'build', target: null, form: 'draconic', dimension: 'body length',
            });
        } else {
            assert.equal(change.reports.at(-1).refusedOperations[0].reason, 'Reference');
        }
    }
    const second = await adopt({ campaign: book, log: plain(log), answering: () =>
        cited(['Sera | build | 20 m | #2'], [source], ['#2 | read']) });
    assert.equal(second.result.stop, 'Done', second.result.problem);
    const replay = ScribeReplay.run(plain(second.log), orderOf(book));
    assert.deepEqual(plain(replay.facts.map((fact) => [fact.form, fact.dimension])),
        [['humanoid', 'stature'], ['draconic', 'body length']]);
    assert.equal(replay.conflicts.length, 0);
    const noScope = await adopt({ campaign: book, readThrough: 1, answering: () => cited([
        'Sera | build | five foot nine in human form | #1',
    ], [{ messageNumber: 1, quote: 'five foot nine' }], ['#1 | read']) });
    const [fact] = ScribeReplay.run(plain(noScope.log), orderOf(book)).facts;
    assert.deepEqual([fact.form, fact.dimension], [null, null]);
});

test('model readings distinguish measurements even when the quoted numbers convert to the same quantity', async () => {
    const book = ScribeIntake.read(new CampaignBuilder('Frost').narrator('Its length was guessed at twenty meters.')
        .narrator('Its regulated limit is two thousand centimeters.').messages);
    const records = book.messages.map((message, index) => ({ messageNumber: message.position,
        quote: message.blocks[0].text, attribution: index ? 'claimed' : 'inferred', form: 'draconic', dimension: 'length',
        value: index ? 'allowed limit' : 'estimated size', related: null }));
    const run = await adopt({ campaign: book, answering: () => cited([
        'Sera | build | 20 m | #1', 'Sera | build | 2,000 cm | #2',
    ], records, ['#1 | read', '#2 | read']) });
    assert.equal(run.result.stop, 'Done', run.result.problem);
    const state = ScribeReplay.run(plain(run.log), orderOf(book));
    assert.deepEqual(plain(state.facts.map((fact) => [fact.text, fact.evidence.value])),
        [['20 m', 'estimated size'], ['2,000 cm', 'allowed limit']]);
    assert.ok(state.facts.every((fact) => fact.status === 'InForce'));
    assert.equal(state.conflicts.length, 0);
});

test('matching model values retain both citations and different accounts remain available to the Checker', async () => {
    const book = ScribeIntake.read(new CampaignBuilder('Frost').narrator('Her eyes are green.')
        .narrator('Her irises were emeralds.').says('Cole', 'I saw amber eyes.').messages);
    const records = book.messages.map((message, index) => ({ messageNumber: message.position,
        quote: message.blocks[0].text, value: index === 2 ? 'amber' : 'green', attribution: index === 2 ? 'claimed' : 'witnessed' }));
    const run = await adopt({ campaign: book, answering: () => cited(['Sera | eyes | green eyes | #1',
        'Sera | eyes | emerald irises | #2', 'Sera | eyes | amber eyes | #3'], records, ['#1 | read', '#2 | read', '#3 | read']) });
    assert.equal(run.result.stop, 'Done', run.result.problem);
    const state = ScribeReplay.run(plain(run.log), orderOf(book));
    assert.deepEqual(plain(state.facts.map((fact) => [fact.status, fact.claims.map((claim) => claim.evidence.messageNumber)])),
        [['InForce', [1]], ['InForce', [2]], ['InForce', [3]]]);
    assert.equal(state.conflicts.length, 0);
});

test('identical measurements in a saved book and a new reading retain both source receipts', async () => {
    const book = ScribeIntake.read(new CampaignBuilder('Frost').narrator('She stands five feet tall.')
        .narrator('She measures five feet in human form.').messages);
    const fact = (number) => cited(['Sera | build | 5 ft | #' + number], [{ messageNumber: number,
        quote: book.messages[number - 1].blocks[0].text, form: 'human', dimension: 'height', value: '5 ft' }], ['#' + number + ' | read']);
    const first = await adopt({ campaign: book, readThrough: 1, answering: () => fact(1) });
    const saved = plain(first.log);
    for (const entry of saved.entries) {
        for (const operation of entry.operations) {
            if (operation.evidence) {
                delete operation.evidence.valueSupplied;
            }
        }
    }
    const next = await adopt({ campaign: book, log: saved, answering: () => fact(2) });
    assert.equal(next.result.stop, 'Done', next.result.problem);
    const state = ScribeReplay.run(plain(next.log), orderOf(book));
    assert.equal(state.facts.length, 2);
    assert.deepEqual(plain(state.facts.flatMap((fact) => fact.claims.map((claim) => claim.evidence.messageNumber))), [1, 2]);
    assert.equal(state.conflicts.length, 0);
});

test('only a genuine citation to the right block binds; a player ruling requires a player source', async () => {
    const builder = new CampaignBuilder('Frost').player('I suspect Malachai guarded the staff.')
        .says('Mavan', 'I will give you the staff.').reply([['Sera', 'I wait.'], ['Narrator', 'Sera has silver hair.']]);
    const book = ScribeIntake.read(builder.messages);
    for (const [record, reason, detail] of [
        [{ blockNumber: 1, quote: 'silver hair' }, 'Quote', /does not appear verbatim in the cited block/],
        [{ blockNumber: 2, quote: 'golden hair' }, 'Quote', /does not appear verbatim in the cited block/],
        [{ blockNumber: 9, quote: 'silver hair' }, 'Block', /block that does not exist/],
        [{ blockNumber: 2, quote: 'silver hair', attribution: 'ruled' }, 'Player', /non-player source/],
    ]) {
        const log = ScribeLog.create();
        markRead(log, book, 1, 2);
        const run = await adopt({ campaign: book, log, answering: () =>
            cited(['Sera | hair | silver | #3'], [{ messageNumber: 3, ...record }], ['#3 | read']) });
        assert.equal(run.result.stop, 'Done');
        const fact = ScribeReplay.run(log, orderOf(book)).facts[0];
        assert.equal(fact.evidence.issue, reason);
        assert.equal(fact.evidence.quote, null);
        assert.match(ScribeAdoption.Settings.StoryReasons[reason], detail);
        assert.equal(readCount(log, book), 3);
    }
    const run = await adopt({ campaign: book, answering: () => answer({
        FACTS: ['Frost | background | Suspects Malachai served as the staff’s guardian | #1', 'Sera | hair | silver | #3'],
        THREADS: ['OPEN | Mavan has pledged his staff | #2'],
        EVIDENCE: [
            { section: 'FACTS', row: 1, messageNumber: 1, blockNumber: 1, quote: 'I suspect Malachai guarded the staff.', attribution: 'inferred' },
            { section: 'FACTS', row: 2, messageNumber: 3, blockNumber: 2, quote: 'Sera has silver hair.', attribution: 'witnessed' },
            { section: 'THREADS', row: 1, messageNumber: 2, blockNumber: 1, quote: 'I will give you the staff.', attribution: 'promised',
                event: 'a proposed inheritance', subject: 'the wizard', attribute: 'bequest', value: 'a future gift', related: ['his heir'] },
        ].map((item) => JSON.stringify({ ...item, form: null, dimension: null })),
        READ: ['#1 | read', '#2 | read', '#3 | read'],
    }) });
    assert.equal(run.result.stop, 'Done', run.result.problem);
    const state = ScribeReplay.run(plain(run.log), orderOf(book));
    const { attribution, event, subject, attribute, value, related } = state.threads[0].evidence;
    assert.deepEqual(plain([attribution, event, subject, attribute, value, related]),
        ['promised', 'a proposed inheritance', 'the wizard', 'bequest', 'a future gift', ['his heir']]);
    assert.deepEqual(plain(state.facts.map((fact) => [fact.evidence.attribution, fact.evidence.speaker, fact.evidence.blockNumber])),
        [['inferred', 'Frost', 1], ['witnessed', 'Narrator', 2]]);
});

test('the reader labels an account and a witnessed act independently', async () => {
    const account = 'Magera claimed Frost stole the sword.';
    const book = ScribeIntake.read(new CampaignBuilder('Frost').narrator(account).narrator(
        'Magera claimed Frost stole the sword, then Frost dropped the sword.').messages);
    const row = 'Frost | background | stole the sword | #1';
    const run = await adopt({ campaign: book, answering: () => cited([
        row, 'Magera | background | claimed Frost stole the sword | #1', 'Frost | background | dropped the sword | #2',
    ], [{ messageNumber: 1, quote: account, attribution: 'claimed' },
        { messageNumber: 1, quote: account, attribution: 'witnessed' },
        { messageNumber: 2, quote: 'Frost dropped the sword.', attribution: 'witnessed' }],
    ['#1 | read', '#2 | read']) });
    assert.equal(run.result.stop, 'Done', run.result.problem);
    assert.deepEqual(plain(ScribeReplay.run(run.log, orderOf(book)).facts.map((fact) => fact.evidence.attribution)),
        ['claimed', 'witnessed', 'witnessed']);
});
const notedCampaign = { ...campaign({
    6: '',
    50: 'I wave to the ferryman.',
    55: 'I count the crates.',
}), notes: [{ text: firstNote, position: 6 }, { text: laterNote, position: 55 }] };
const prompts = new Map([
    [ScribeAnalyzer.Prompt, 'Story'],
    [ScribeAnalyzer.NotesPrompt, 'Notes'],
    [ScribeAnalyzer.AnswersPrompt, 'Answers'],
]);

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
 * @param {{ messages: readonly object[] }} chosen
 * @return {string[]}
 */
function orderOf(chosen) {
    return chosen.messages.map((message) => message.id);
}

/**
 * @param {{ messages: readonly object[] }} chosen
 * @param {number} first
 * @param {number} last
 * @return {object[]}
 */
function stretchOf(chosen, first, last) {
    return chosen.messages.slice(first - 1, last);
}

/**
 * @param {{ messages: readonly object[] }} chosen
 * @param {number} first
 * @param {number} last
 * @return {string[]}
 */
function idsOf(chosen, first, last) {
    return stretchOf(chosen, first, last).map((message) => message.id);
}

/**
 * @param {number} first
 * @param {number} last
 * @return {number[]}
 */
function numbers(first, last) {
    return Array.from({ length: last - first + 1 }, (unused, index) => first + index);
}

/**
 * @param {readonly object[]} stretch
 * @return {number[]}
 */
function positionsOf(stretch) {
    return plain(stretch.map((message) => message.position));
}

/**
 * @param {object} log
 * @param {{ messages: readonly object[] }} chosen
 * @param {number} first
 * @param {number} last
 * @return {void}
 */
function markRead(log, chosen, first, last) {
    ScribeLog.append(log, ScribeReplay.run(log, orderOf(chosen)), [], {
        messages: stretchOf(chosen, first, last),
        origin: 'Story',
    });
}

/**
 * @param {object} log
 * @param {{ messages: readonly object[] }} chosen
 * @return {number}
 */
function readCount(log, chosen) {
    return chosen.messages.filter((message) => Object.hasOwn(log.read, message.id)).length;
}

/**
 * @param {object} state
 * @param {string} text
 * @return {number}
 */
function timesSaid(state, text) {
    return state.facts.filter((fact) => fact.text === text).length;
}

/**
 * @param {string} pass
 * @param {string} user
 * @return {number[]}
 */
function marksOf(pass, user) {
    if (pass === 'Story') {
        const positions = [...CitedStory.messages(user).keys()];
        return [positions[0], positions.at(-1)];
    }
    return [...user.matchAll(/^\[#(\d+)\] /gm)].map((match) => Number(match[1]));
}

/**
 * @param {{ pass: string, marks: number[] }} call
 * @return {string}
 */
function scripted(call) {
    if (call.pass === 'Story') {
        const [first, last] = call.marks;
        const source = CitedStory.messages(call.user);
        const watch = source.get(first)?.[0]?.quote.match(/keeps watch from line \d+/)?.[0];
        const coins = source.get(last)?.[0]?.quote.match(/counts coins to line \d+/)?.[0];
        return answer({
            ...(first === 1 ? { SUBJECTS: ['Halvard | character', 'Mirelle | character'] } : {}),
            FACTS: [
                ...(watch ? [ 'Halvard | trait | ' + watch + ' | #' + first ] : []),
                ...(coins ? [ 'Mirelle | trait | ' + coins + ' | #' + last ] : []),
            ],
        });
    }
    const category = call.pass === 'Notes' ? 'background' : 'trait';
    const word = call.pass.toLowerCase();
    return answer({
        FACTS: call.marks.map((mark) => `Halvard | ${category} | settled by the ${word} at line ${mark} | #${mark}`),
    });
}

/**
 * @param {{ pass: string, marks: number[] }} call
 * @return {string}
 */
function questioning(call) {
    const text = scripted(call);
    if (call.pass === 'Story' && call.marks[0] === 1) {
        return `${text}\n${answer({ QUESTIONS: questions })}`;
    }
    return text;
}

/**
 * @param {object} log
 * @param {string} question
 * @param {string} text
 * @return {void}
 */
function reply(log, question, text) {
    ScribeLog.rule(log, ScribeReplay.run(log, orderOf(plainCampaign)), { type: 'Answer', question, text });
}

/**
 * @return {Promise<void>}
 */
function tick() {
    return new Promise((resolve) => setImmediate(resolve));
}

/**
 * @return {void}
 */
function nothing() {}

/**
 * @return {boolean}
 */
function never() {
    return false;
}

/**
 * @param {object} chosen
 * @return {Promise<{ result: object, log: object, calls: object[], saved: object[], records: object[], reports: object[], events: string[], savesAtReport: number[] }>}
 */
async function adopt(chosen = {}) {
    const book = chosen.campaign ?? plainCampaign;
    const answering = chosen.answering ?? scripted;
    const costing = chosen.costing ?? (() => 0.25);
    const context = {
        log: chosen.log ?? ScribeLog.create(),
        calls: [],
        saved: [],
        records: [],
        reports: [],
        events: [],
        savesAtReport: [],
        pauses: 0,
    };
    const result = await ScribeAdoption.run({
        messages: book.messages,
        readThrough: chosen.readThrough,
        retrySources: chosen.retrySources,
        retryInputs: chosen.retryInputs,
        diagnostic: chosen.diagnostic,
        notes: book.notes,
        player: book.player,
        profile: chosen.profile,
        log: context.log,
        size: chosen.size ?? 40,
        budget: chosen.budget ?? 100,
        spent: chosen.spent ?? 0,
        /**
         * @param {string} system
         * @param {string} user
         * @return {Promise<{ text: string, cost: * }>}
         */
        ask: async (system, user) => {
            const pass = prompts.get(system);
            const call = { system, user, pass, marks: marksOf(pass, user), answer: null };
            context.calls.push(call);
            context.events.push('ask');
            call.answer = answering(call, context.calls.length);
            if (pass === 'Story' && !chosen.rawStory && !call.answer.includes('=== READ') &&
                (call.answer.trimStart().startsWith('=== ') || ['', 'none'].includes(call.answer))) {
                const subjects = [...call.answer.matchAll(/=== SUBJECTS\n([^=]+?)(?=\n===|$)/g)]
                    .flatMap((match) => match[1].split('\n').map((line) => {
                        const label = line.split(' | ')[0];
                        const source = [...CitedStory.messages(user)].find(([, blocks]) =>
                            blocks.some((block) => block.quote.includes(label)));
                        return source?.[0] ?? call.marks[0];
                    }));
                call.answer = CitedStory.answer(user, call.answer === 'none' ? '' : call.answer.trim(), subjects);
            }
            const stopped = (chosen.stopping ?? (() => 0))(call, context.calls.length);
            return { text: call.answer, cost: costing(call, context.calls.length), stopped };
        },
        /**
         * @param {object} kept
         * @return {Promise<void>}
         */
        save: async (kept) => {
            const copy = plain(kept);
            context.events.push('save');
            await (chosen.saving ?? nothing)(context.saved.length + 1, context);
            context.saved.push(copy);
        },
        /**
         * @param {object} item
         * @return {Promise<void>}
         */
        record: async (item) => {
            context.events.push('record');
            await (chosen.recording ?? nothing)(item, context);
            context.records.push(item);
        },
        /**
         * @param {object} report
         * @return {*}
         */
        progress: (report) => {
            context.reports.push(report);
            context.savesAtReport.push(context.saved.length);
            context.events.push('progress');
            return (chosen.reporting ?? nothing)(report, context);
        },
        /**
         * @return {*}
         */
        paused: () => {
            context.pauses++;
            return (chosen.pausing ?? never)(context);
        },
    });
    return { result, ...context };
}

/**
 * @return {{ options: object, touched: string[] }}
 */
function spied() {
    const touched = [];
    const options = {
        messages: plainCampaign.messages,
        notes: plainCampaign.notes,
        player: plainCampaign.player,
        log: ScribeLog.create(),
        size: 40,
        budget: 1,
        spent: 0.5,
        /**
         * @return {Promise<{ text: string, cost: number }>}
         */
        ask: async () => {
            touched.push('ask');
            return { text: '', cost: 0 };
        },
        /**
         * @return {Promise<void>}
         */
        save: async () => {
            touched.push('save');
        },
        /**
         * @return {Promise<void>}
         */
        record: async () => {
            touched.push('record');
        },
        /**
         * @return {void}
         */
        progress: () => {
            touched.push('progress');
        },
        /**
         * @return {boolean}
         */
        paused: () => {
            touched.push('paused');
            return false;
        },
    };
    return { options, touched };
}

/**
 * @param {object[]} calls
 * @return {Array<[string, number[]]>}
 */
function passes(calls) {
    return calls.map((call) => [call.pass, call.marks]);
}

/**
 * @param {string} stop
 * @param {string|null} problem
 * @param {number} spent
 * @param {number} calls
 * @param {number} unpriced
 * @return {{ stop: string, problem: string|null, spent: number, calls: number, unpriced: number }}
 */
function ended(stop, problem, spent, calls, unpriced = 0) {
    return { stop, problem, spent, calls, unpriced };
}

/**
 * @return {Promise<object>}
 */
async function answeredLog() {
    const run = await adopt({ answering: questioning });
    reply(run.log, 'Q1', 'She trusts him with the ledger');
    return run.log;
}

test('the next stretch packs the earliest unread messages up to the room batch size', () => {
    const messages = plainCampaign.messages;
    const log = ScribeLog.create();
    const fresh = ScribeAdoption.next(log, messages, 40);
    assert.deepEqual(positionsOf(fresh), numbers(1, 40));
    assert.equal(fresh[0], messages[0]);
    markRead(log, plainCampaign, 1, 40);
    assert.deepEqual(positionsOf(ScribeAdoption.next(log, messages, 40)), numbers(41, 80));
    markRead(log, plainCampaign, 41, 50);
    assert.deepEqual(positionsOf(ScribeAdoption.next(log, messages, 40)), numbers(51, 90));
    const gapped = ScribeLog.create();
    markRead(gapped, plainCampaign, 1, 40);
    markRead(gapped, plainCampaign, 61, 100);
    assert.deepEqual(positionsOf(ScribeAdoption.next(gapped, messages, 40)), numbers(41, 60));
    const islanded = ScribeLog.create();
    markRead(islanded, plainCampaign, 1, 40);
    markRead(islanded, plainCampaign, 61, 70);
    assert.deepEqual(positionsOf(ScribeAdoption.next(islanded, messages, 40)), [...numbers(41, 60), ...numbers(71, 90)]);
    const whole = ScribeLog.create();
    markRead(whole, plainCampaign, 1, 100);
    assert.deepEqual(plain(ScribeAdoption.next(whole, messages, 40)), []);
    for (const size of [0, -3, Number.NaN]) {
        assert.deepEqual(positionsOf(ScribeAdoption.next(ScribeLog.create(), messages, size)), [1], String(size));
    }
    assert.deepEqual(positionsOf(ScribeAdoption.next(ScribeLog.create(), messages, 2.9)), [1, 2]);
    assert.deepEqual(positionsOf(ScribeAdoption.next(gapped, messages, 0)), [41]);
});

test('a campaign is read in stretches', async () => {
    const order = orderOf(plainCampaign);
    const run = await adopt();
    assert.deepEqual(plain(run.result), ended('Done', null, 0.75, 3));
    assert.deepEqual(passes(run.calls), [
        ['Story', [1, 40]],
        ['Story', [41, 80]],
        ['Story', [81, 100]],
    ]);
    for (const [index, call] of run.calls.entries()) {
        const before = index === 0 ? ScribeLog.create() : run.saved[index - 1];
        const [first, last] = call.marks;
        assert.equal(call.system, ScribeAnalyzer.Prompt);
        assert.equal(
            call.user,
            ScribeAnalyzer.input(ScribeReplay.run(before, order), 'Orla', stretchOf(plainCampaign, first, last)),
        );
    }
    assert.equal(order.every((id) => Object.hasOwn(run.log.read, id)), true);
    assert.equal(run.saved.length, 3);
    assert.deepEqual(plain(run.log), run.saved[2]);
    const state = ScribeReplay.run(run.log, order);
    assert.deepEqual(plain(state.facts.map((fact) => [fact.text, fact.cite, fact.origin])), [
        ['keeps watch from line 1', 'MESSAGE-1', 'Story'],
        ['counts coins to line 40', 'MESSAGE-40', 'Story'],
        ['keeps watch from line 41', 'MESSAGE-41', 'Story'],
        ['counts coins to line 80', 'MESSAGE-80', 'Story'],
        ['keeps watch from line 81', 'MESSAGE-81', 'Story'],
        ['counts coins to line 100', 'MESSAGE-100', 'Story'],
    ]);
});

test('notes are filed once', async () => {
    const order = orderOf(notedCampaign);
    assert.deepEqual(plain(notedCampaign.notes), [
        { text: firstNote, position: 6 },
        { text: laterNote, position: 55 },
    ]);
    assert.equal(notedCampaign.messages[5].text, '');
    /**
     * @param {{ pass: string, marks: number[] }} call
     * @return {string}
     */
    const straying = (call) =>
        call.pass === 'Notes' ? `${scripted(call)}\nHalvard | trait | heard beside the note | #7` : scripted(call);
    const run = await adopt({ campaign: notedCampaign, answering: straying });
    assert.deepEqual(plain(run.result), ended('Done', null, 1.25, 5));
    assert.deepEqual(passes(run.calls), [
        ['Notes', [6]],
        ['Story', [1, 40]],
        ['Notes', [55]],
        ['Story', [41, 80]],
        ['Story', [81, 100]],
    ]);
    assert.equal(run.calls[0].system, ScribeAnalyzer.NotesPrompt);
    assert.equal(
        run.calls[0].user,
        ScribeAnalyzer.notesInput(ScribeReplay.run(ScribeLog.create(), order), 'Orla', [notedCampaign.notes[0]]),
    );
    assert.equal(
        run.calls[2].user,
        ScribeAnalyzer.notesInput(ScribeReplay.run(run.saved[1], order), 'Orla', [notedCampaign.notes[1]]),
    );
    assert.deepEqual(plain(run.log.notes), [firstNote, laterNote]);
    assert.deepEqual(plain(run.saved[0].notes), [firstNote]);
    assert.deepEqual(plain(run.saved[0].read), {});
    const state = ScribeReplay.run(run.log, order);
    const filed = state.facts.filter((fact) => fact.text.startsWith('settled by the notes'));
    assert.deepEqual(plain(filed.map((fact) => [fact.text, fact.origin, fact.cite])), [
        ['settled by the notes at line 6', 'Notes', 'MESSAGE-6'],
        ['settled by the notes at line 55', 'Notes', 'MESSAGE-55'],
    ]);
    assert.equal(timesSaid(state, 'heard beside the note'), 0);
    assert.deepEqual(plain(run.reports[0].refusedOperations.map((item) => item.reason)), ['Citation']);
    assert.deepEqual(plain(ScribeLog.withdraw(run.log, 'MESSAGE-3')), idsOf(notedCampaign, 1, 40));
    const again = await adopt({ campaign: notedCampaign, log: run.log });
    assert.deepEqual(plain(again.result), ended('Done', null, 0.25, 1));
    assert.deepEqual(passes(again.calls), [['Story', [1, 40]]]);
    assert.deepEqual(plain(run.log.notes), [firstNote, laterNote]);
});

test('marker text in a mixed stretch reaches the model with its original blocks', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Frost').narrator('[Scribe] Mavan waits.')
        .reply([['Mavan', '[Scribe] Mavan stands beside the chains.'], ['Narrator', 'The chains break.']]).messages);
    const result = await adopt({campaign: room, answering: () => answer({ READ: ['#1 | read', '#2 | read'] })});
    assert.ok(result.calls[0].user.includes('[#1] Narrator: [Scribe] Mavan waits.'));
    assert.ok(result.calls[0].user.includes('[block 1] Mavan: [Scribe] Mavan stands beside the chains.'));
    assert.ok(result.calls[0].user.includes('[block 2] Narrator: The chains break.'));
});

test('a disputed position stays out of Story, legacy notes and historical attendance citations', async () => {
    const builder = new CampaignBuilder('Frost').player('I enter the Inn and wait for Mavan.')
        .player('A disputed account.').narrator('A gate opens.').narrator('Rain falls.');
    const intake = ScribeIntake.read(builder.messages);
    const chosen = { ...intake, notes: [{ position: 2, text: 'A disputed legacy note.' }],
        messages: intake.messages.map((message) => message.position === 2 ? { ...message, attributionPending: true } : message) };
    const run = await adopt({
        campaign: chosen,
        answering: () => answer({ SCENES: [
            'Day 1 | #1-#4 | Inn | public | present: Mavan (from #2 until #4) | Rain falls',
            'Day 1 | #1-#4 | Inn | public | present: Frost (from #1 until #4) | Rain falls',
        ] }),
    });
    assert.equal(run.result.stop, 'Done');
    assert.deepEqual(run.calls.map((call) => [call.pass, [...CitedStory.messages(call.user).keys()]]), [['Story', [1, 3, 4]]]);
    assert.ok(run.calls.every((call) => !call.user.includes('disputed')));
    assert.deepEqual(plain(run.reports.at(-1).refusedOperations.map((item) => item.reason)), ['Citation']);
    assert.deepEqual(Object.keys(run.log.read), ['MESSAGE-1', 'MESSAGE-3', 'MESSAGE-4']);
    assert.deepEqual(plain(run.log.notes), []);
    const state = ScribeReplay.run(run.log, orderOf(chosen));
    assert.deepEqual(plain(state.subjects.map((subject) => subject.label)), ['Frost']);
    assert.equal(state.scenes[0].lastPosition, 4);
});

test('a marker-only message waits for a funded Story pass before accepting a model receipt', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Frost').narrator('[Scribe] Mavan is here.').messages);
    const waiting = await adopt({ campaign: room, budget: 0 });
    assert.deepEqual(plain(waiting.result), ended('Budget', null, 0, 0));
    assert.equal(waiting.log.read['MESSAGE-1'], undefined);
    const read = await adopt({ campaign: room, log: waiting.log, answering: () => answer({ READ: ['#1 | read'] }) });
    assert.ok(read.calls[0].user.includes('[Scribe] Mavan is here.'));
    assert.equal(read.log.entries[0].sources[0].result, 'read');
});

test('an empty stretch and an empty answer are both read', async () => {
    const log = ScribeLog.create();
    markRead(log, notedCampaign, 1, 5);
    markRead(log, notedCampaign, 7, 100);
    log.notes.push(laterNote);
    const lone = await adopt({ campaign: notedCampaign, log });
    assert.deepEqual(plain(lone.result), ended('Done', null, 0.25, 1));
    assert.deepEqual(passes(lone.calls), [['Notes', [6]]]);
    assert.equal(readCount(log, notedCampaign), 100);
    assert.deepEqual(plain(log.entries.at(-1)), {
        sequence: 4,
        sourceAuthority: true,
        kind: 'Update',
        origin: 'Story',
        messageIds: ['MESSAGE-6'],
        operations: [],
        sources: [{ id: 'MESSAGE-6', position: 6, fingerprint: notedCampaign.messages[5].fingerprint, result: 'processed' }],
        withdrawn: false,
    });
    assert.deepEqual(plain(lone.saved.at(-1)), plain(log));
    /**
     * @param {{ pass: string, marks: number[] }} call
     * @param {number} index
     * @return {string}
     */
    const quiet = (call, index) => ['', 'none'][index - 1] ?? scripted(call);
    const run = await adopt({ answering: quiet });
    assert.deepEqual(plain(run.result), ended('Done', null, 0.75, 3));
    assert.deepEqual(passes(run.calls), [
        ['Story', [1, 40]],
        ['Story', [41, 80]],
        ['Story', [81, 100]],
    ]);
    assert.deepEqual(plain(run.log.entries.slice(0, 2).map((entry) => [entry.messageIds, entry.operations])), [
        [idsOf(plainCampaign, 1, 40), []],
        [idsOf(plainCampaign, 41, 80), []],
    ]);
    assert.equal(readCount(run.log, plainCampaign), 100);
    const state = ScribeReplay.run(run.log, orderOf(plainCampaign));
    assert.deepEqual(plain(state.facts.map((fact) => fact.text)), [
        'keeps watch from line 81',
        'counts coins to line 100',
    ]);
});

test('a plain model reading is saved while later messages finish once', async () => {
    const run = await adopt({ answering: (call, index) => index === 2 ? prose : scripted(call) });
    assert.deepEqual(plain(run.result), ended('Done', null, 0.75, 3));
    assert.equal(readCount(run.log, plainCampaign), 100);
    assert.equal(run.saved.length, 3);
    assert.deepEqual(plain(run.records.map((item) => [item.sequence, item.readable])), [[1, true], [2, true], [3, true]]);
    assert.equal(run.records[1].answer, prose);
    assert.equal(run.reports[1].read, 80);
    assert.equal(run.log.entries[1].modelReading, prose);
    assert.ok(run.records[2].input.includes(prose));
    const checked = ScribeLog.checkIndex({log: run.log}, plainCampaign.messages).rows;
    assert.deepEqual(plain(checked.flatMap((row, index) => row.written.filter((item) => item.text === prose).map(() => index + 1))), [80]);
    assert.deepEqual(plain(ScribeAdoption.pendingSources(run.log, plainCampaign.messages)), []);
    const single = await adopt({ log: plain(run.saved.at(-1)), retrySources: ['MESSAGE-41'], rawStory: true,
        answering: () => answer({ READ: ['#41 | no change'] }) });
    assert.equal(single.calls.length, 0);
    assert.deepEqual(plain(ScribeAdoption.pendingSources(single.log, plainCampaign.messages)), []);
    const again = await adopt({ log: plain(run.saved.at(-1)) });
    assert.deepEqual(plain(again.result), ended('Done', null, 0, 0));
    const noted = await adopt({ campaign: notedCampaign, answering: (call) => call.pass === 'Notes' ? prose : scripted(call) });
    assert.equal(noted.result.stop, 'Done');
    assert.deepEqual(plain(noted.log.notes), [firstNote, laterNote]);
    assert.ok(noted.log.entries.some((entry) => entry.origin === 'Notes' && entry.modelResponse === prose));
    const log = await answeredLog();
    const answers = await adopt({ log, answering: (call) => call.pass === 'Answers' ? prose : scripted(call) });
    assert.equal(answers.result.stop, 'Done');
    assert.ok(log.entries.some((entry) => entry.origin === 'Answers' && entry.modelResponse === prose));
    assert.ok(ScribeReplay.run(log, orderOf(plainCampaign)).questions.some((item) => item.answer && item.dismissed));
    const refresh = await adopt({ log: plain(log) });
    assert.equal(refresh.calls.length, 0);
});

test('free prose and empty protocol headers cannot claim an acknowledgment or stop later reading', async () => {
    for (const refusal of ['None of this is something I am able to summarise for you.',
        'Nothing here can be processed: the text appears to be cut off.', 'No new information can be extracted.']) {
        const run = await adopt({ answering: (call, index) => index === 1 ? refusal : scripted(call) });
        assert.equal(run.result.stop, 'Done');
        assert.equal(run.records[0].readable, true);
        assert.equal(run.records[0].answer, refusal);
        assert.ok(run.log.entries[0].sources.every((item) => item.result === 'processed'));
        assert.equal(run.calls.length, 3);
    }
    for (const empty of ['none', '(none)', 'No new facts.', '=== SUBJECTS\n=== NAMES\n=== FACTS']) {
        const run = await adopt({ rawStory: true, answering: () => empty });
        assert.equal(run.result.stop, 'Done');
        assert.equal(ScribeAdoption.pendingSources(run.log, plainCampaign.messages).length, 0);
        assert.equal(run.calls.length, 3);
    }
});

test('pause stops between stretches', async () => {
    const run = await adopt({ pausing: (context) => context.reports.length >= 1 });
    assert.deepEqual(plain(run.result), ended('Paused', null, 0.25, 1));
    assert.equal(readCount(run.log, plainCampaign), 40);
    assert.deepEqual(plain(run.log), run.saved.at(-1));
    const rest = await adopt({ log: run.log });
    assert.deepEqual(plain(rest.result), ended('Done', null, 0.5, 2));
    assert.deepEqual(passes(rest.calls), [
        ['Story', [41, 80]],
        ['Story', [81, 100]],
    ]);
    assert.equal(readCount(run.log, plainCampaign), 100);
    const held = await adopt({ pausing: () => true });
    assert.deepEqual(plain(held.result), ended('Paused', null, 0, 0));
    assert.deepEqual(held.saved, []);
    assert.deepEqual(plain(held.log), plain(ScribeLog.create()));
});

test('a pause is honoured before every call', async () => {
    const run = await adopt({
        campaign: notedCampaign,
        pausing: (context) => context.calls.some((call) => call.pass === 'Notes'),
    });
    assert.deepEqual(plain(run.result), ended('Paused', null, 0.25, 1));
    assert.deepEqual(passes(run.calls), [['Notes', [6]]]);
    assert.equal(run.saved.length, 1);
    assert.deepEqual(plain(run.saved[0].notes), [firstNote]);
    assert.deepEqual(plain(run.saved[0].read), {});
    const rest = await adopt({ campaign: notedCampaign, log: plain(run.saved[0]) });
    assert.deepEqual(plain(rest.result), ended('Done', null, 1, 4));
    assert.deepEqual(passes(rest.calls), [
        ['Story', [1, 40]],
        ['Notes', [55]],
        ['Story', [41, 80]],
        ['Story', [81, 100]],
    ]);
    const log = await answeredLog();
    const kept = plain(log);
    const asked = await adopt({ log, pausing: (context) => context.pauses >= 2 });
    assert.deepEqual(plain(asked.result), ended('Paused', null, 0, 0));
    assert.deepEqual(asked.calls, []);
    assert.deepEqual(plain(log), kept);
});

test('the budget stops the run', async () => {
    const run = await adopt({ budget: 0.05, costing: () => 0.04 });
    assert.deepEqual(plain(run.result), ended('Budget', null, 0.08, 2));
    assert.equal(run.calls.length, 2);
    assert.equal(readCount(run.log, plainCampaign), 80);
    assert.deepEqual(plain(run.log), run.saved.at(-1));
    const unpriced = await adopt({ budget: 0.05, costing: (call, index) => (index === 2 ? null : 0.04) });
    assert.deepEqual(plain(unpriced.result), ended('Done', null, 0.08, 3, 1));
    assert.deepEqual(plain(unpriced.reports.map((report) => report.spent)), [0.04, 0.04, 0.08]);
    const spentAlready = await adopt({ budget: 0.05, spent: 0.05 });
    assert.deepEqual(plain(spentAlready.result), ended('Budget', null, 0.05, 0));
    assert.deepEqual(spentAlready.calls, []);
});

test('the budget guards every pass', async () => {
    const noted = await adopt({ campaign: notedCampaign, budget: 0 });
    assert.deepEqual(plain(noted.result), ended('Budget', null, 0, 0));
    assert.deepEqual(noted.calls, []);
    const log = await answeredLog();
    const kept = plain(log);
    const asked = await adopt({ log, budget: 0 });
    assert.deepEqual(plain(asked.result), ended('Budget', null, 0, 0));
    assert.deepEqual(plain(log), kept);
    const empty = ScribeLog.create();
    markRead(empty, notedCampaign, 1, 5);
    markRead(empty, notedCampaign, 7, 100);
    empty.notes.push(firstNote, laterNote);
    const lone = await adopt({ campaign: notedCampaign, log: empty, budget: 0 });
    assert.deepEqual(plain(lone.result), ended('Done', null, 0, 0));
    assert.equal(empty.entries.at(-1).sources[0].result, 'processed');
    assert.equal(lone.saved.length, 1);
});

test('money is counted only when it has a price', async () => {
    for (const cost of [Number.NaN, -1, '1', undefined]) {
        const run = await adopt({ costing: (call, index) => (index === 2 ? cost : 0.25) });
        assert.deepEqual(plain(run.result), ended('Done', null, 0.5, 3, 1), String(cost));
        assert.deepEqual(
            plain(run.reports.map((report) => [report.spent, report.unpriced])),
            [
                [0.25, 0],
                [0.25, 1],
                [0.5, 1],
            ],
            String(cost),
        );
    }
    const free = await adopt({ costing: () => null });
    assert.deepEqual(plain(free.result), ended('Done', null, 0, 3, 3));
    for (const [name, value] of [
        ['budget', Number.NaN],
        ['spent', '1'],
    ]) {
        const { options, touched } = spied();
        const result = await ScribeAdoption.run({ ...options, [name]: value });
        const spent = name === 'spent' ? 0 : 0.5;
        assert.deepEqual(plain(result), ended('Failed', `${name} is not a finite number of at least 0.`, spent, 0));
        assert.deepEqual(touched, []);
    }
    const { options, touched } = spied();
    const { budget, ...unbudgeted } = options;
    assert.equal(budget, 1);
    assert.deepEqual(
        plain(await ScribeAdoption.run(unbudgeted)),
        ended('Failed', 'budget is not a finite number of at least 0.', 0.5, 0),
    );
    assert.deepEqual(touched, []);
});

test('a failed call applies nothing', async () => {
    /**
     * @param {{ pass: string, marks: number[] }} call
     * @param {number} index
     * @return {string}
     */
    const silent = (call, index) => {
        if (index === 2) {
            throw new Error('the model went quiet');
        }
        return scripted(call);
    };
    const run = await adopt({ answering: silent });
    assert.deepEqual(plain(run.result), ended('Failed', 'the model went quiet', 0.25, 2));
    assert.deepEqual(passes(run.calls), [
        ['Story', [1, 40]],
        ['Story', [41, 80]],
    ]);
    assert.equal(readCount(run.log, plainCampaign), 40);
    assert.equal(run.saved.length, 1);
    assert.deepEqual(plain(run.log), run.saved[0]);
    assert.equal(run.records.length, 1);
    assert.equal(run.reports.length, 1);
});

test('a call stopped by the operator is recorded before the call that answered, its cost unknown', async () => {
    const run = await adopt({ stopping: (call, index) => (index === 1 ? 1 : 0) });
    assert.deepEqual(plain(run.result), ended('Done', null, 0.75, 4, 1));
    assert.deepEqual(
        plain(run.records.map((item) => [item.sequence, item.pass, item.readable, item.stopped === true, item.answer])),
        [
            [null, 'Story', true, true, null],
            [1, 'Story', true, false, run.calls[0].answer],
            [2, 'Story', true, false, run.calls[1].answer],
            [3, 'Story', true, false, run.calls[2].answer],
        ],
    );
    assert.equal(run.records[0].input, run.calls[0].user);
    /**
     * @param {{ pass: string, marks: number[] }} call
     * @param {number} index
     * @return {string}
     */
    const quiet = (call, index) => {
        if (index === 2) {
            throw Object.assign(new Error('the model went quiet'), { stopped: 1 });
        }
        return scripted(call);
    };
    const failed = await adopt({ answering: quiet });
    assert.deepEqual(plain(failed.result), ended('Failed', 'the model went quiet', 0.25, 3, 1));
    assert.deepEqual(plain(failed.records.map((item) => [item.sequence, item.stopped === true])), [
        [1, false],
        [null, true],
    ]);
});

test('resume after a failed save reads the stretch once', async () => {
    /**
     * @param {number} count
     * @return {void}
     */
    const full = (count) => {
        if (count === 2) {
            throw new Error('the disk is full');
        }
    };
    const run = await adopt({ saving: full });
    assert.deepEqual(plain(run.result), ended('Failed', 'the disk is full', 0.5, 2));
    assert.equal(run.saved.length, 1);
    assert.equal(readCount(run.saved[0], plainCampaign), 40);
    const resumed = await adopt({ log: plain(run.saved[0]) });
    assert.deepEqual(plain(resumed.result), ended('Done', null, 0.5, 2));
    assert.deepEqual(passes(resumed.calls), [
        ['Story', [41, 80]],
        ['Story', [81, 100]],
    ]);
    const state = ScribeReplay.run(resumed.log, orderOf(plainCampaign));
    const texts = [
        'keeps watch from line 1',
        'counts coins to line 40',
        'keeps watch from line 41',
        'counts coins to line 80',
        'keeps watch from line 81',
        'counts coins to line 100',
    ];
    assert.deepEqual(texts.map((text) => timesSaid(state, text)), [1, 1, 1, 1, 1, 1]);
    assert.equal(state.facts.length, 6);
    assert.equal(readCount(resumed.log, plainCampaign), 100);
});

test('a step is saved before it is recorded', async () => {
    const run = await adopt();
    assert.deepEqual(run.events, [
        ...['ask', 'save', 'record', 'progress'],
        ...['ask', 'save', 'record', 'progress'],
        ...['ask', 'save', 'record', 'progress'],
    ]);
    const broken = await adopt({
        saving: (count) => {
            if (count === 2) {
                throw new Error('the disk is full');
            }
        },
    });
    assert.deepEqual(plain(broken.result), ended('Failed', 'the disk is full', 0.5, 2));
    assert.deepEqual(plain(broken.records.map((item) => item.sequence)), [1]);
    const resumed = await adopt({ log: plain(broken.saved[0]) });
    assert.deepEqual(plain([...broken.records, ...resumed.records].map((item) => item.sequence)), [1, 2, 3]);
    const unrecorded = await adopt({
        recording: (item) => {
            if (item.sequence === 2) {
                throw new Error('the record shelf is full');
            }
        },
    });
    assert.deepEqual(plain(unrecorded.result), ended('Failed', 'the record shelf is full', 0.5, 2));
    assert.equal(unrecorded.saved.length, 2);
    assert.equal(readCount(unrecorded.saved[1], plainCampaign), 80);
    const restarted = await adopt({ log: plain(unrecorded.saved[1]) });
    assert.deepEqual(plain(restarted.result), ended('Done', null, 0.25, 1));
    assert.deepEqual(passes(restarted.calls), [['Story', [81, 100]]]);
});

test('a completion marker cannot launder malformed or uncited rows', async () => {
    const malformed = 'Halvard | trait | #45';
    const outside = 'Halvard | trait | stern | #12';
    /**
     * @param {{ pass: string, marks: number[] }} call
     * @param {number} index
     * @return {string}
     */
    const mixed = (call, index) =>
        index === 2
            ? answer({
                  FACTS: [
                      malformed,
                      outside,
                      'Halvard | trait | patient with the ferry | #45',
                      'Mirelle | trait | fond of salt fish | #46',
                  ],
              }) + '\n=== READ\n#45 | no change'
            : scripted(call);
    const run = await adopt({ answering: mixed });
    assert.equal(run.result.stop, 'Done');
    assert.deepEqual(plain(run.reports[1].refusedLines), [{ block: 'FACTS', line: malformed, reason: 'Shape' }]);
    assert.ok(run.reports[1].stored >= 2);
    const state = ScribeReplay.run(run.log, orderOf(plainCampaign));
    assert.equal(timesSaid(state, 'patient with the ferry'), 1);
    assert.equal(timesSaid(state, 'fond of salt fish'), 1);
    assert.equal(timesSaid(state, 'stern'), 0);
    assert.equal(readCount(run.log, plainCampaign), 100);
});

test('every call is recorded', async () => {
    /**
     * @param {{ pass: string, marks: number[] }} call
     * @return {string}
     */
    const padded = (call) => `\n${scripted(call)}\n\n`;
    const run = await adopt({ campaign: notedCampaign, answering: padded });
    assert.equal(run.calls.length, 5);
    assert.deepEqual(
        plain(run.records),
        run.calls.map((call, index) => ({
            sequence: index + 1,
            pass: call.pass,
            system: call.system,
            input: call.user,
            answer: call.answer,
            readable: true,
        })),
    );
    assert.deepEqual(plain(run.log.entries.map((entry) => [entry.sequence, entry.origin])), [
        [1, 'Notes'],
        [2, 'Story'],
        [3, 'Notes'],
        [4, 'Story'],
        [5, 'Story'],
    ]);
    const log = ScribeLog.create();
    markRead(log, notedCampaign, 1, 5);
    markRead(log, notedCampaign, 7, 100);
    log.notes.push(laterNote);
    const lone = await adopt({ campaign: notedCampaign, log, answering: padded });
    assert.deepEqual(lone.calls.map((call) => call.pass), ['Notes']);
    assert.deepEqual(plain(lone.records), lone.calls.map((call, index) => ({
        sequence: index + 3, pass: call.pass, system: call.system, input: call.user, answer: call.answer, readable: true,
    })));
    assert.deepEqual(plain(lone.reports.map((report) => report.pass)), ['Notes', 'Story']);
});

test('progress is reported after every step', async () => {
    const run = await adopt();
    assert.deepEqual(plain(run.reports), [
        {
            pass: 'Story',
            first: 1,
            last: 40,
            read: 40,
            total: 100,
            spent: 0.25,
            calls: 1,
            unpriced: 0,
            stored: 4,
            refusedLines: [],
            refusedOperations: [],
        },
        {
            pass: 'Story',
            first: 41,
            last: 80,
            read: 80,
            total: 100,
            spent: 0.5,
            calls: 2,
            unpriced: 0,
            stored: 2,
            refusedLines: [],
            refusedOperations: [],
        },
        {
            pass: 'Story',
            first: 81,
            last: 100,
            read: 100,
            total: 100,
            spent: 0.75,
            calls: 3,
            unpriced: 0,
            stored: 2,
            refusedLines: [],
            refusedOperations: [],
        },
    ]);
    assert.deepEqual(run.savesAtReport, [1, 2, 3]);
    const noted = await adopt({ campaign: notedCampaign, spent: 1 });
    assert.deepEqual(
        plain(noted.reports.map((report) => [report.pass, report.first, report.last, report.read, report.spent])),
        [
            ['Notes', 1, 40, 0, 1.25],
            ['Story', 1, 40, 40, 1.5],
            ['Notes', 41, 80, 40, 1.75],
            ['Story', 41, 80, 80, 2],
            ['Story', 81, 100, 100, 2.25],
        ],
    );
    assert.deepEqual(noted.savesAtReport, [1, 2, 3, 4, 5]);
});

test('progress counts what is read in this campaign', async () => {
    const run = await adopt();
    assert.deepEqual(plain(ScribeLog.withdraw(run.log, 'MESSAGE-90')), idsOf(plainCampaign, 81, 100));
    const shorter = campaign({}, [12]);
    const again = await adopt({ campaign: shorter, log: run.log });
    assert.deepEqual(plain(again.result), ended('Done', null, 0.25, 1));
    assert.deepEqual(passes(again.calls), [['Story', [80, 99]]]);
    assert.deepEqual(plain(again.reports.map((report) => [report.read, report.total])), [[99, 99]]);
    assert.equal(Object.hasOwn(run.log.read, 'MESSAGE-12'), true);
});

test('withdrawn messages are read again', async () => {
    const run = await adopt();
    assert.deepEqual(plain(ScribeLog.withdraw(run.log, 'MESSAGE-12')), idsOf(plainCampaign, 1, 40));
    assert.deepEqual(positionsOf(ScribeAdoption.next(run.log, plainCampaign.messages, 40)), numbers(1, 40));
    const again = await adopt({ log: run.log });
    assert.deepEqual(plain(again.result), ended('Done', null, 0.25, 1));
    assert.deepEqual(passes(again.calls), [['Story', [1, 40]]]);
    assert.deepEqual(
        plain(run.log.read),
        Object.fromEntries([
            ...idsOf(plainCampaign, 1, 40).map((id) => [id, 4]),
            ...idsOf(plainCampaign, 41, 80).map((id) => [id, 2]),
            ...idsOf(plainCampaign, 81, 100).map((id) => [id, 3]),
        ]),
    );
    const state = ScribeReplay.run(run.log, orderOf(plainCampaign));
    assert.equal(timesSaid(state, 'keeps watch from line 1'), 1);
    assert.equal(state.facts.length, 6);
});

test('reading an interior gap reports saved coverage across the entire room', async () => {
    const first = await adopt();
    ScribeLog.withdraw(first.log, 'MESSAGE-41');
    const second = await adopt({ log: first.log, readThrough: 80 });
    assert.deepEqual(passes(second.calls), [['Story', [41, 80]]]);
    assert.deepEqual(plain(second.reports.map(({ read, total }) => [read, total])), [[100, 100]]);
});

test('answered questions are filed and retired', async () => {
    const order = orderOf(plainCampaign);
    const log = await answeredLog();
    const read = plain(log.read);
    const before = ScribeReplay.run(log, order);
    const sequence = log.nextSequence;
    const second = await adopt({ log });
    assert.deepEqual(plain(second.result), ended('Done', null, 0.25, 1));
    assert.equal(second.calls[0].system, ScribeAnalyzer.AnswersPrompt);
    assert.equal(
        second.calls[0].user,
        ScribeAnalyzer.answersInput(before, 'Orla', before.questions.filter((question) => question.id === 'Q1')),
    );
    assert.deepEqual(passes(second.calls), [['Answers', [12]]]);
    assert.deepEqual(
        plain(log.entries.slice(-2).map((entry) => [entry.sequence, entry.kind, entry.origin, entry.messageIds])),
        [
            [sequence, 'Update', 'Answers', []],
            [sequence + 1, 'Operator', 'Operator', []],
        ],
    );
    assert.deepEqual(plain(log.entries.at(-1).operations), [
        { type: 'Dismiss', question: 'Q1', questionText: 'Does Mirelle trust Halvard?',
            passages: [{ id: 'MESSAGE-12', fingerprint: plainCampaign.messages[11].fingerprint }] },
    ]);
    assert.deepEqual(plain(log.read), read);
    assert.deepEqual(plain(log), second.saved.at(-1));
    const state = ScribeReplay.run(log, order);
    const filed = state.facts.filter((fact) => fact.text === 'settled by the answers at line 12');
    assert.deepEqual(plain(filed.map((fact) => [fact.origin, fact.cite, fact.position])), [
        ['Answers', 'MESSAGE-12', 12],
    ]);
    assert.deepEqual(plain(state.questions.map((question) => [question.id, question.answer, question.dismissed])), [
        ['Q1', 'She trusts him with the ledger', true],
        ['Q2', null, false],
        ['Q3', null, false],
    ]);
    assert.deepEqual(plain(second.records), [
        {
            sequence,
            pass: 'Answers',
            system: ScribeAnalyzer.AnswersPrompt,
            input: second.calls[0].user,
            answer: second.calls[0].answer,
            readable: true,
        },
    ]);
    assert.deepEqual(plain(second.reports), [
        {
            pass: 'Answers',
            first: null,
            last: null,
            read: 100,
            total: 100,
            spent: 0.25,
            calls: 1,
            unpriced: 0,
            stored: 1,
            refusedLines: [],
            refusedOperations: [],
        },
    ]);
    const third = await adopt({ log });
    assert.deepEqual(plain(third.result), ended('Done', null, 0, 0));
    reply(log, 'Q2', 'The miller rang it');
    reply(log, 'Q3', 'It is forged');
    const both = ScribeReplay.run(log, order);
    const fourth = await adopt({ log });
    assert.deepEqual(plain(fourth.result), ended('Done', null, 0.25, 1));
    assert.equal(
        fourth.calls[0].user,
        ScribeAnalyzer.answersInput(both, 'Orla', both.questions.filter((question) => question.id !== 'Q1')),
    );
    assert.deepEqual(passes(fourth.calls), [['Answers', [30, 35]]]);
    const after = ScribeReplay.run(log, order);
    assert.deepEqual(plain(after.questions.map((question) => question.dismissed)), [true, true, true]);
    assert.deepEqual(
        plain(after.facts.filter((fact) => fact.origin === 'Answers').map((fact) => [fact.text, fact.cite])),
        [
            ['settled by the answers at line 12', 'MESSAGE-12'],
            ['settled by the answers at line 30', 'MESSAGE-30'],
            ['settled by the answers at line 35', 'MESSAGE-35'],
        ],
    );
    assert.deepEqual(plain(log.read), read);
    const fifth = await adopt({ log });
    assert.deepEqual(plain(fifth.result), ended('Done', null, 0, 0));
});

test('the answers pass sends only what it was asked', async () => {
    const log = await answeredLog();
    const beside = 'Halvard | trait | wary of the bell | #13';
    const run = await adopt({
        log,
        answering: (call) =>
            call.pass === 'Answers'
                ? answer({ FACTS: ['Halvard | trait | sure of her at line 12 | #12', beside] })
                : scripted(call),
    });
    assert.deepEqual(plain(run.result), ended('Done', null, 0.25, 1));
    assert.deepEqual(plain(run.reports[0].refusedOperations), [
        { operation: plain(ScribeAnswer.parse(answer({ FACTS: [beside] })).operations[0]), reason: 'Citation' },
    ]);
    assert.equal(run.reports[0].stored, 1);
    const state = ScribeReplay.run(log, orderOf(plainCampaign));
    assert.equal(timesSaid(state, 'sure of her at line 12'), 1);
    assert.equal(timesSaid(state, 'wary of the bell'), 0);
});

test('after the answers pass the loop starts again', async () => {
    const order = orderOf(plainCampaign);
    const first = await adopt({ answering: questioning, pausing: (context) => context.reports.length >= 1 });
    reply(first.log, 'Q1', 'She trusts him with the ledger');
    const run = await adopt({
        log: first.log,
        answering: (call) =>
            call.pass === 'Answers'
                ? answer({ FACTS: ['Kira | trait | rang the bell at line 12 | #12'] }) + '\n=== FILED\nQ1 | #12'
                : scripted(call),
    });
    assert.deepEqual(plain(run.result), ended('Done', null, 0.75, 3));
    assert.deepEqual(passes(run.calls), [
        ['Answers', [12]],
        ['Story', [41, 80]],
        ['Story', [81, 100]],
    ]);
    assert.equal(
        run.calls[1].user,
        ScribeAnalyzer.input(ScribeReplay.run(run.saved[0], order), 'Orla', stretchOf(plainCampaign, 41, 80)),
    );
    assert.equal(run.calls[1].user.includes('- Kira (character)'), true);
    assert.deepEqual(plain(run.log.entries.map((entry) => entry.origin)), [
        'Story',
        'Operator',
        'Answers',
        'Operator',
        'Story',
        'Story',
    ]);
    assert.equal(readCount(run.log, plainCampaign), 100);
});

test('a stale state is retried once', async () => {
    const first = await adopt({ answering: questioning, pausing: (context) => context.reports.length >= 1 });
    const log = first.log;
    let ruled = false;
    const run = await adopt({
        log,
        answering: (call) => {
            if (!ruled && call.pass === 'Story') {
                ruled = true;
                reply(log, 'Q2', 'The miller rang it');
            }
            return scripted(call);
        },
    });
    assert.equal(ruled, true);
    assert.deepEqual(plain(run.result), ended('Done', null, 0.75, 3));
    assert.deepEqual(passes(run.calls), [
        ['Story', [41, 80]],
        ['Answers', [30]],
        ['Story', [81, 100]],
    ]);
    const stretchEntries = log.entries.filter((entry) => entry.messageIds.includes('MESSAGE-41'));
    assert.equal(stretchEntries.length, 1);
    assert.equal(run.records.filter((item) => item.sequence === stretchEntries[0].sequence).length, 1);
    assert.equal(run.records.length, 3);
    assert.equal(run.saved.length, 3);
    assert.equal(readCount(log, plainCampaign), 100);
});

test('a question whose message is gone is not asked about', async () => {
    const first = await adopt({ answering: questioning, pausing: (context) => context.reports.length >= 1 });
    const log = first.log;
    reply(log, 'Q1', 'She trusts him with the ledger');
    const shorter = campaign({}, [12]);
    const second = await adopt({ campaign: shorter, log });
    assert.deepEqual(plain(second.result), ended('Done', null, 0.5, 2));
    assert.deepEqual(passes(second.calls), [
        ['Story', [40, 79]],
        ['Story', [80, 99]],
    ]);
    assert.equal(readCount(log, shorter), 99);
    assert.equal(log.entries.some((entry) => entry.origin === 'Answers'), false);
    const state = ScribeReplay.run(log, orderOf(shorter));
    assert.deepEqual(plain(state.questions.map((question) => [question.id, question.dismissed])), [
        ['Q2', false],
        ['Q3', false],
    ]);
});

test('answers run even when every message is read', async () => {
    const log = await answeredLog();
    assert.deepEqual(plain(ScribeAdoption.next(log, plainCampaign.messages, 40)), []);
    const second = await adopt({ log });
    assert.deepEqual(plain(second.result), ended('Done', null, 0.25, 1));
    assert.deepEqual(passes(second.calls), [['Answers', [12]]]);
});

test('a changed explicit note is filed separately from the saved wording', async () => {
    const run = await adopt({ campaign: notedCampaign });
    const shouted = { ...campaign({
        6: '[Operator note] HALVARD served ten years, with the pikes!',
        50: 'I wave to the ferryman.',
        55: `I count the crates.\n[Operator note] ${laterNote}`,
    }), notes: [{ text: 'HALVARD served ten years, with the pikes!', position: 6 }, { text: laterNote, position: 55 }] };
    assert.deepEqual(plain(shouted.notes.map((note) => note.text)), [
        'HALVARD served ten years, with the pikes!',
        laterNote,
    ]);
    const entries = run.log.entries.length;
    const settled = await adopt({ campaign: shouted, log: run.log });
    assert.deepEqual(plain(settled.result), ended('Done', null, 0.25, 1));
    assert.equal(run.log.entries.length, entries + 1);
    ScribeLog.withdraw(run.log, 'MESSAGE-3');
    const again = await adopt({ campaign: shouted, log: run.log });
    assert.deepEqual(passes(again.calls), [['Story', [1, 40]]]);
    assert.equal(run.log.entries.filter((entry) => entry.origin === 'Notes').length, 3);
});

test('no note is left behind', async () => {
    const behind = ScribeLog.create();
    markRead(behind, notedCampaign, 1, 40);
    const caught = await adopt({ campaign: notedCampaign, log: behind });
    assert.deepEqual(plain(caught.result), ended('Done', null, 0.75, 3));
    assert.deepEqual(passes(caught.calls), [
        ['Notes', [6, 55]],
        ['Story', [41, 80]],
        ['Story', [81, 100]],
    ]);
    assert.deepEqual(plain(behind.notes), [firstNote, laterNote]);
    const single = { ...campaign({ 6: firstNote }), notes: [{ text: firstNote, position: 6 }] };
    const whole = ScribeLog.create();
    markRead(whole, single, 1, 100);
    const last = await adopt({ campaign: single, log: whole });
    assert.deepEqual(plain(last.result), ended('Done', null, 0.25, 1));
    assert.deepEqual(passes(last.calls), [['Notes', [6]]]);
    assert.deepEqual(plain(last.reports.map((report) => [report.pass, report.first, report.last])), [
        ['Notes', null, null],
    ]);
    assert.deepEqual(plain(whole.notes), [firstNote]);
    const stray = { ...plainCampaign, notes: [{ text: 'Kira hates the ferry.', position: 140 }] };
    const passed = await adopt({ campaign: stray });
    assert.deepEqual(plain(passed.result), ended('Done', null, 0.75, 3));
    assert.deepEqual(passed.calls.map((call) => call.pass), ['Story', 'Story', 'Story']);
    assert.deepEqual(plain(passed.log.notes), []);
});

test('the size given is the size used', async () => {
    const thirty = { ...plainCampaign, messages: plainCampaign.messages.slice(0, 30) };
    const run = await adopt({ campaign: thirty, size: 10 });
    assert.deepEqual(plain(run.result), ended('Done', null, 0.75, 3));
    assert.deepEqual(passes(run.calls), [
        ['Story', [1, 10]],
        ['Story', [11, 20]],
        ['Story', [21, 30]],
    ]);
    for (const size of [undefined, '10', 0, 2.5]) {
        const { options, touched } = spied();
        const result = await ScribeAdoption.run({ ...options, size });
        assert.deepEqual(plain(result), ended('Failed', 'size is not a positive whole number.', 0.5, 0), String(size));
        assert.deepEqual(touched, []);
    }
});

test('every message id must be its own', async () => {
    const { options, touched } = spied();
    const twice = plainCampaign.messages.map((message) =>
        message.position === 6 ? { ...message, id: 'MESSAGE-3' } : message,
    );
    const result = await ScribeAdoption.run({ ...options, messages: twice });
    assert.deepEqual(plain(result), ended('Failed', 'Two messages share the id MESSAGE-3.', 0.5, 0));
    assert.deepEqual(touched, []);
    assert.deepEqual(plain(options.log), plain(ScribeLog.create()));
});

test('bad arguments stop before any call', async () => {
    const twice = [...plainCampaign.messages.slice(0, 3), plainCampaign.messages[0]];
    const cases = [
        [{ messages: 'all of them' }, 'messages is not a list.'],
        [{ messages: twice }, 'Two messages share the id MESSAGE-1.'],
        [{ readThrough: -1 }, 'readThrough is not a whole number within the message list.'],
        [{ readThrough: 1.5 }, 'readThrough is not a whole number within the message list.'],
        [{ readThrough: plainCampaign.messages.length + 1 }, 'readThrough is not a whole number within the message list.'],
        [{ notes: null }, 'notes is not a list.'],
        [{ atBudget: true }, 'atBudget is not a function.'],
        [{ player: 7 }, 'player is not a string.'],
        [{ profile: 7 }, 'profile is neither a string nor null.'],
        [{ profile: { text: 'Orla' } }, 'profile is neither a string nor null.'],
        [{ log: null }, 'log is not an object.'],
        [{ log: 'the book' }, 'log is not an object.'],
        [{ size: Number.POSITIVE_INFINITY }, 'size is not a positive whole number.'],
        [{ size: -40 }, 'size is not a positive whole number.'],
        [{ budget: -1 }, 'budget is not a finite number of at least 0.'],
        [{ budget: Number.POSITIVE_INFINITY }, 'budget is not a finite number of at least 0.'],
        [{ spent: -0.5 }, 'spent is not a finite number of at least 0.'],
        [{ spent: Number.NaN }, 'spent is not a finite number of at least 0.'],
        [{ ask: 'a model' }, 'ask is not a function.'],
        [{ save: undefined }, 'save is not a function.'],
        [{ record: null }, 'record is not a function.'],
        [{ progress: {} }, 'progress is not a function.'],
        [{ paused: false }, 'paused is not a function.'],
    ];
    for (const [bad, problem] of cases) {
        const { options, touched } = spied();
        const spent = Object.hasOwn(bad, 'spent') ? 0 : 0.5;
        const result = await ScribeAdoption.run({ ...options, ...bad });
        assert.deepEqual(plain(result), ended('Failed', problem, spent, 0), problem);
        assert.deepEqual(touched, [], problem);
        if (options.log !== null && typeof options.log === 'object') {
            assert.deepEqual(plain(options.log), plain(ScribeLog.create()), problem);
        }
    }
    for (const missing of [undefined, null, 'options']) {
        const result = await ScribeAdoption.run(missing);
        assert.deepEqual(plain(result), ended('Failed', 'The options are missing.', 0, 0), String(missing));
    }
    assert.deepEqual(plain(await ScribeAdoption.run({})), ended('Failed', 'messages is not a list.', 0, 0));
    await assert.doesNotReject(ScribeAdoption.run());
});

test('the chat profile goes to every story reading and to no other pass', async () => {
    const profile = 'Orla is a sellsword from the north.';
    const read = await adopt({ campaign: notedCampaign, profile });
    const passes = [...new Set(read.calls.map((call) => call.pass))].sort();
    assert.deepEqual(passes, ['Notes', 'Story']);
    for (const call of read.calls) {
        const carries = call.user.includes(`PLAYER CHARACTER:\nOrla\n\nPLAYER CHARACTER PROFILE:\n${profile}\n\nSUBJECTS:`);
        assert.equal(carries, call.pass === 'Story', call.pass);
    }
    const bare = await adopt({ campaign: notedCampaign });
    const empty = await adopt({ campaign: notedCampaign, profile: null });
    assert.deepEqual(
        bare.calls.map((call) => call.user),
        empty.calls.map((call) => call.user),
    );
    assert.equal(bare.calls.some((call) => call.user.includes('PLAYER CHARACTER PROFILE:')), false);
    assert.deepEqual(
        read.calls.map((call) => call.user.replace(`PLAYER CHARACTER PROFILE:\n${profile}\n\n`, '')),
        bare.calls.map((call) => call.user),
    );
});

test('callbacks may be asynchronous', async () => {
    const waiting = await adopt({
        pausing: async () => {
            await tick();
            return false;
        },
    });
    assert.deepEqual(plain(waiting.result), ended('Done', null, 0.75, 3));
    const rejecting = await adopt({
        reporting: async () => {
            await tick();
            throw new Error('the dial jammed');
        },
    });
    assert.deepEqual(plain(rejecting.result), ended('Failed', 'the dial jammed', 0.25, 1));
    const ordered = await adopt({
        saving: async (count, context) => {
            await tick();
            context.events.push('saved');
        },
        recording: async (item, context) => {
            await tick();
            context.events.push('recorded');
        },
    });
    assert.deepEqual(plain(ordered.result), ended('Done', null, 0.75, 3));
    const step = ['ask', 'save', 'saved', 'record', 'recorded', 'progress'];
    assert.deepEqual(ordered.events, [...step, ...step, ...step]);
});

test('run never rejects', async () => {
    const recorded = await adopt({
        recording: () => {
            throw new Error('the record shelf is full');
        },
    });
    assert.deepEqual(plain(recorded.result), ended('Failed', 'the record shelf is full', 0.25, 1));
    assert.equal(recorded.saved.length, 1);
    const reported = await adopt({
        reporting: () => {
            throw new Error('the progress bar broke');
        },
    });
    assert.deepEqual(plain(reported.result), ended('Failed', 'the progress bar broke', 0.25, 1));
    assert.equal(reported.saved.length, 1);
    const bare = await adopt({
        answering: () => {
            throw 'a bare complaint';
        },
    });
    assert.deepEqual(plain(bare.result), ended('Failed', 'a bare complaint', 0, 1));
});

const staffKept = {
    said: 'guarded the Staff of Tides for a thousand years',
    before: 'the Staff of Tides, held for two centuries',
    why: 'Two keepers and two spans for one staff',
};
const oathKept = {
    said: `...Sela's oath binds her to the "Tide Hall"...`,
    before: 'Sela has guarded the Staff of Tides',
    why: 'She is bound to the hall, not the staff',
};
const staffLines = [
    `#45 "${staffKept.said}" | F3 | ${staffKept.why}`,
    `#46 "${oathKept.said}" | #45 "${oathKept.before}" | ${oathKept.why}`,
    '#45 "guarded the Staff of Tides for ten years" | #5 "held the Staff of Tides" | The span differs',
    `#45 "${staffKept.said}" | #4 "${staffKept.before}" | The earlier words are in another message`,
    '#45 "uarded the Staff of Tides" | #5 "held the Staff of Tides" | A word cut in half',
    '#45 "Sela" | #5 "held the Staff of Tides" | One word is no quote',
    '#150 "guarded the Staff of Tides" | #5 "held the Staff of Tides" | No such message',
    '#5 "held the Staff of Tides for two centuries" | #4 "The tide bell rang" | Both before the stretch',
];

/**
 * @return {{ messages: readonly object[], notes: readonly object[], player: string }}
 */
function staffCampaign() {
    const builder = new CampaignBuilder('Orla');
    const written = {
        3: 'Who will guard the Staff of Tides?',
        4: 'The tide bell rang at dusk over the harbour.',
        5: 'Old Brannoc has held the Sta​ff of Tides for two centuries.',
        10: 'Brannoc has grey eyes.',
        30: 'Brannoc packed his bag; he left it at the tide hall.',
        31: 'Brannoc keeps the Staff of Tides for good.',
        45: 'Sela has guarded the Staff of Tides for a thousand years. She keeps a long vigil.',
        46: 'Sela’s oath binds her to the “Tide Hall” forever.',
    };
    for (let number = 1; number <= 100; number++) {
        builder.narrator(written[number] ?? `Halvard keeps watch from line ${number}. Mirelle counts coins to line ${number}.`);
    }
    return ScribeIntake.read(builder.messages);
}

/**
 * @param {{ pass: string, marks: number[] }} call
 * @return {string}
 */
function staffAnswer(call) {
    if (call.pass === 'Story' && call.marks[0] === 1) {
        const held = answer({ SUBJECTS: ['Brannoc | character'], FACTS: [`Brannoc | belonging | ${staffKept.before} | #5`] });
        return `${scripted(call)}\n${held}`;
    }
    if (call.pass !== 'Story' || call.marks[0] !== 41) {
        return scripted(call);
    }
    return answer({
        SUBJECTS: ['Sela | character'],
        FACTS: ['Sela | trait | keeps a long vigil | #45'],
        CONTRADICTIONS: staffLines.slice(0, 1),
    });
}

/**
 * @param {object} run
 * @return {void}
 */
function assertStaffRead(run) {
    const report = run.reports.find((item) => item.first === 41);
    assert.deepEqual(plain([report.pass, report.last, report.stored, report.refusedLines]), ['Story', 80, 2, []]);
    const state = ScribeReplay.run(run.log, orderOf(staffCampaign()));
    assert.equal(timesSaid(state, 'keeps a long vigil'), 1);
    assert.deepEqual(plain(state.contradictions), []);
}

/**
 * @param {object} log
 * @return {void}
 */
function archivedStaffReports(log) {
    const entry = log.entries.find((item) => item.messageIds.includes('MESSAGE-45') && !item.withdrawn);
    entry.operations.push(
        { type: 'Contradiction', cite: 'MESSAGE-45', position: 45, earlier: 'MESSAGE-5', earlierPosition: 5, ...staffKept },
        { type: 'Contradiction', cite: 'MESSAGE-46', position: 46, earlier: 'MESSAGE-45', earlierPosition: 45, ...oathKept },
    );
}

test('the current writer files its cited facts and leaves discrepancy findings to the Checker', async () => {
    const chosen = staffCampaign();
    assert.equal(chosen.messages[4].text.includes('​'), true);
    const run = await adopt({ campaign: chosen, answering: staffAnswer });
    assert.deepEqual(plain(run.result), ended('Done', null, 0.75, 3));
    assert.equal(readCount(run.log, chosen), 100);
    assertStaffRead(run);
    assert.deepEqual(
        plain(run.reports.filter((item) => item.first !== 41).map((item) => item.refusedOperations)),
        [[], []],
    );
});

test('unsupported adverse reports remain owed even with a valid completion marker', async () => {
    const chosen = staffCampaign();
    for (const [index, line] of staffLines.slice(2).entries()) {
        const initial = await adopt({ campaign: chosen, answering: staffAnswer, readThrough: 40 });
        const seen = index === 5 ? 5 : index === 4 ? 150 : 45;
        const bad = cited([line], [{ messageNumber: seen, quote: 'Sela has guarded the Staff of Tides' }],
            numbers(41, 80).map((number) => '#' + number + (number === seen ? ' | read' : ' | no change')), 'CONTRADICTIONS');
        const failed = await adopt({ campaign: chosen, log: initial.log, answering: () => bad });
        assert.equal(failed.result.stop, 'Done', line);
        assert.ok(Object.hasOwn(failed.log.read, 'MESSAGE-45'), line);
        assert.ok(failed.log.entries.some((entry) => entry.proposals?.some((item) => item.reason === 'checkerOnly') ||
            entry.unfiledRows?.some((item) => item.block === 'CONTRADICTIONS')), line);
        assert.equal(ScribeReplay.run(failed.log, orderOf(chosen)).contradictions.length, 0, line);
    }
});

test('a stale state retry also files no writer discrepancy findings', async () => {
    const chosen = staffCampaign();
    const order = orderOf(chosen);
    const log = ScribeLog.create();
    let ruled = false;
    const run = await adopt({
        campaign: chosen,
        log,
        answering: (call) => {
            if (!ruled && call.pass === 'Story' && call.marks[0] === 41) {
                ruled = true;
                ScribeLog.rule(log, ScribeReplay.run(log, order), {
                    type: 'AddFact',
                    subject: 'S1',
                    category: 'trait',
                    target: null,
                    text: 'hums while rowing',
                    hidden: false,
                    cite: null,
                    position: 0,
                });
            }
            return staffAnswer(call);
        },
    });
    assert.equal(ruled, true);
    assert.deepEqual(plain(run.result), ended('Done', null, 0.75, 3));
    assertStaffRead(run);
});

test('a contradiction can be dismissed and goes with its stretch', async () => {
    const chosen = staffCampaign();
    const order = orderOf(chosen);
    const run = await adopt({ campaign: chosen, answering: staffAnswer });
    const log = run.log;
    archivedStaffReports(log);
    const before = ScribeReplay.run(log, order);
    const [staff, oath] = before.contradictions;
    const ruling = ScribeLog.rule(log, before, { type: 'DismissContradiction', contradiction: staff.id });
    assert.deepEqual(plain(ruling.operations), [
        {
            type: 'DismissContradiction',
            contradiction: staff.id,
            said: 'guarded the Staff of Tides for a thousand years',
            before: staffKept.before,
        },
    ]);
    /**
     * @return {Array<[string, boolean]>}
     */
    const marks = () => plain(ScribeReplay.run(log, order).contradictions.map((item) => [item.id, item.dismissed]));
    assert.deepEqual(marks(), [
        [staff.id, true],
        [oath.id, false],
    ]);
    const dismissed = ScribeReplay.run(log, order);
    assert.throws(
        () => ScribeLog.rule(log, dismissed, { type: 'DismissContradiction', contradiction: `${staff.id} ` }),
        { message: 'Reference' },
    );
    for (const contradiction of [undefined, null, 4, [staff.id], { id: staff.id }]) {
        assert.throws(
            () => ScribeLog.rule(log, dismissed, { type: 'DismissContradiction', contradiction }),
            { message: 'InvalidOperation' },
            String(contradiction),
        );
    }
    assert.deepEqual(plain(ScribeLog.withdraw(log, 'MESSAGE-45')), idsOf(chosen, 41, 80));
    const withdrawn = ScribeReplay.run(log, order);
    assert.deepEqual(plain(withdrawn.contradictions), []);
    assert.throws(
        () => ScribeLog.rule(log, withdrawn, { type: 'DismissContradiction', contradiction: oath.id }),
        { message: 'Reference' },
    );
    const again = await adopt({ campaign: chosen, log, answering: staffAnswer });
    assert.deepEqual(plain(again.result), ended('Done', null, 0.25, 1));
    assert.deepEqual(passes(again.calls), [['Story', [41, 80]]]);
    assert.deepEqual(marks(), []);
    assert.equal(ScribeLog.revoke(log, ruling.sequence), ruling);
    assert.deepEqual(marks(), []);
});

test('the saved writer advisory stays readable without another model call', () => {
    const log = ScribeLog.create();
    const messages = staffCampaign().messages;
    ScribeLog.append(log, ScribeReplay.run(log, orderOf(staffCampaign())), [], { messages, origin: 'Story' });
    archivedStaffReports(log);
    const state = ScribeReplay.run(plain(log), messages.map((message) => message.id));
    assert.deepEqual(plain(state.contradictions.map((issue) => [issue.position, issue.earlierPosition, issue.before])), [
        [45, 5, staffKept.before], [46, 45, oathKept.before],
    ]);
});

test('the notes and answers passes keep no contradiction', async () => {
    const noteLine = '#55 "I count the crates" | #2 "I answer the ferryman" | Crates or the ferryman';
    const noted = await adopt({
        campaign: notedCampaign,
        answering: (call) =>
            call.pass === 'Notes' && call.marks[0] === 55
                ? `${scripted(call)}\n${answer({ CONTRADICTIONS: [noteLine] })}`
                : scripted(call),
    });
    assert.deepEqual(plain(noted.result), ended('Done', null, 1.25, 5));
    const notesReport = noted.reports.find((report) => report.pass === 'Notes' && report.first === 41);
    const [noteOperation] = ScribeAnswer.parse(answer({ CONTRADICTIONS: [noteLine] })).operations;
    assert.deepEqual(plain(notesReport.refusedOperations), [{ operation: plain(noteOperation), reason: 'Citation' }]);
    assert.deepEqual(plain(ScribeReplay.run(noted.log, orderOf(notedCampaign)).contradictions), []);
    const log = await answeredLog();
    const answersLine = '#12 "I answer the ferryman" | #2 "I answer the ferryman" | Said twice';
    const answered = await adopt({
        log,
        answering: (call) => (call.pass === 'Answers' ? answer({ CONTRADICTIONS: [answersLine] }) : scripted(call)),
    });
    assert.deepEqual(plain(answered.result), ended('Done', null, 0.25, 1));
    const [answersOperation] = ScribeAnswer.parse(answer({ CONTRADICTIONS: [answersLine] })).operations;
    assert.deepEqual(plain(answered.reports[0].refusedOperations), [
        { operation: plain(answersOperation), reason: 'Citation' },
    ]);
    assert.equal(answered.reports[0].stored, 0);
    assert.deepEqual(plain(ScribeReplay.run(log, orderOf(plainCampaign)).contradictions), []);
});
