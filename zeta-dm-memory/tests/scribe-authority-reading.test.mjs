import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import CampaignBuilder from './support/CampaignBuilder.mjs';

const installed = readFileSync(new URL('../scribe/scribe.user.js', import.meta.url), 'utf8');
const boundary = installed.indexOf('/** @file scribe/page/ScribeStart.js */');
assert.ok(boundary > 0);
const { ScribeIntake, ScribeAdoption, ScribeAnswer, ScribeAnalyzer, ScribeReplay, ScribeLog, ScribeGateway } =
    vm.runInNewContext(installed.slice(0, boundary) +
        'return { ScribeIntake, ScribeAdoption, ScribeAnswer, ScribeAnalyzer, ScribeReplay, ScribeLog, ScribeGateway };})();',
    { TextEncoder, AbortController, setTimeout, clearTimeout });

/**
 * @param {object} room
 * @param {Function} answer
 * @param {object} options
 * @return {Promise<object>}
 */
async function run(room, answer, options = {}) {
    const log = options.log ?? ScribeLog.create();
    const calls = [];
    const result = await ScribeAdoption.run({
        ...room, log, size: 40, budget: 10, spent: 0,
        ask: async (system, user) => {
            calls.push({ system, user });
            return { cost: 0, ...await answer(system, user) };
        },
        paused: () => false, save() {}, record() {}, progress() {}, ...options,
    });
    assert.equal(result.stop, 'Done', result.problem);
    return { log, calls, state: ScribeReplay.run(log, room.messages.map((message) => message.id)) };
}

/**
 * @param {string} section
 * @param {number} messageNumber
 * @param {string} quote
 * @param {object} detail
 * @return {string}
 */
function evidence(section, messageNumber, quote, detail = {}) {
    return JSON.stringify({ section, row: 1, messageNumber, blockNumber: 1, quote,
        attribution: 'witnessed', form: null, dimension: null, ...detail });
}

test('installed intake preserves marker-looking NPC and player lines and ordinary italic narration for the Scribe', async () => {
    const player = '*I open the door.*\n*I hide the key.*\n*I step outside.*';
    const aside = '*(The guard waits.\nThe key falls.)*';
    const room = ScribeIntake.read(new CampaignBuilder('Orla').says('Archivist', '[Scribe] The queen is alive.')
        .player(player).player(aside).player('[Scribe] This was my own line.').messages);
    const runResult = await run(room, () => ({ text: '=== READ\n#1 | read\n#2 | read\n#3 | read\n#4 | read' }));
    for (const line of ['[Scribe] The queen is alive.', player, aside, '[Scribe] This was my own line.']) {
        assert.ok(runResult.calls[0].user.includes(line), line);
    }
    assert.equal(room.notes.length, 0);
    assert.equal(runResult.calls.length, 1);
});

test('installed player text reaches the Story model in full and a mixed reply is saved once', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Orla').player('[Operator note] Stop, Ada.')
        .player('[Operator note] Stop Ada.').messages);
    assert.equal(room.notes.length, 0);
    const mixed = ['The player provided directions.', '=== FACTS', 'Lamp | feature | brass | #1', 'invalid row',
        'Bell | feature | bronze | #2', '=== EVIDENCE', evidence('FACTS', 1, 'Stop, Ada.'),
        evidence('FACTS', 2, 'Stop Ada.', {row: 2})].join('\n');
    const runResult = await run(room, (system, user) => {
        assert.equal(system, ScribeAnalyzer.Prompt);
        assert.ok(user.includes('[Operator note] Stop, Ada.'));
        assert.ok(user.includes('[Operator note] Stop Ada.'));
        return {text: mixed};
    });
    assert.deepEqual(Array.from(runResult.state.facts, (fact) => fact.text), ['brass', 'bronze']);
    assert.equal(runResult.calls.length, 1);
    assert.deepEqual(Array.from(runResult.log.entries.at(-1).sources, (source) => source.result), ['processed', 'processed']);
    assert.equal(runResult.log.entries[0].modelResponse, mixed);
    assert.ok(runResult.log.entries.some((entry) => entry.unfiledRows?.some((row) => row.line === 'invalid row')));
    const legacy = JSON.parse(JSON.stringify(runResult.log));
    delete legacy.entries[0].modelResponse;
    for (const source of legacy.entries[0].sources) {
        source.result = 'unverified';
        source.filingPending = [{reason: 'missingRead'}, {reason: 'format'}];
    }
    assert.equal(ScribeAdoption.pendingSources(legacy, room.messages).length, 0);
    const rerun = await run(room, () => assert.fail('A pending note was charged again'), { log: runResult.log });
    assert.equal(rerun.calls.length, 0);
});

test('installed filing keeps free categories, both source declarations, complete orphan evidence and explicit acknowledgments', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Orla').narrator('Mara holds the ruby.')
        .narrator('The ferry arrived.').messages);
    const text = ['=== FACTS', 'Mara | possession | ruby | #1', '=== EVIDENCE',
        evidence('FACTS', 2, 'The ferry arrived.'),
        evidence('FACTS', 2, 'The ferry arrived.', { row: 2, subject: 'Ada', attribute: 'job', value: 'ferrymaster' }),
        '=== READ', '#2 | read'].join('\n');
    const result = await run(room, () => ({ text }));
    const fact = result.state.facts[0];
    assert.deepEqual([fact.category, fact.cite, fact.evidence.verified, fact.evidence.citedMessage, fact.evidence.modelQuote],
        ['possession', room.messages[0].id, false, 2, 'The ferry arrived.']);
    const entry = result.log.entries[0];
    assert.equal(entry.sources[0].result, 'processed');
    assert.equal(entry.sources[1].result, 'read');
    const book = { log: result.log, fingerprints: Object.fromEntries(room.messages.map((m) => [m.id, m.fingerprint])) };
    const row = ScribeLog.checkIndex(book, room.messages).rows[1].written.find((item) => item.section === 'EVIDENCE');
    assert.equal(JSON.parse(row.text).value, 'ferrymaster');
    assert.equal(JSON.parse(row.text).quote, 'The ferry arrived.');
});

test('installed filing accepts range and list citations and preserves the two different declarations if the cited block lies outside', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Orla').narrator('One.').narrator('Two.').narrator('Three.').messages);
    const rows = ['=== SUBJECTS ===', 'Gate | place', '=== FACTS ===',
        'Gate | colour | green | #1-#3', 'Gate | trait | open | #1, #3', 'Gate | trait | old | #1, #3',
        '=== EVIDENCE ===', evidence('FACTS', 3, 'Three.'), evidence('FACTS', 3, 'Three.', { row: 2 }),
        evidence('FACTS', 2, 'Two.', { row: 3 }), '=== READ ===', '#1 | read', '#2 | read', '#3 | read'];
    const { state } = await run(room, () => ({ text: rows.join('\n') }));
    assert.deepEqual(Array.from(state.facts, (fact) => [fact.text, fact.cite, fact.evidence.sourceCitation, fact.evidence.verified !== false]),
        [['old', 'MESSAGE-1', '#1, #3', false], ['green', 'MESSAGE-3', '#1-#3', true], ['open', 'MESSAGE-3', '#1, #3', true]]);
    assert.equal(state.facts.find((fact) => fact.text === 'old').evidence.citedMessage, 2);
});

test('installed reader saves the exact plain response for its batch, presents it to both models, and continues without a retry', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Orla').narrator('They enter.').narrator('They leave.').messages);
    const narrative = 'The party visits the keep.\n\nThey leave the torches outside.';
    const result = await run(room, (_system, input) => ({ text: input.includes(narrative) ? '=== READ\n#2 | read' : narrative }), {size: 1});
    assert.equal(result.calls.length, 2);
    assert.equal(result.log.entries[0].sources[0].result, 'processed');
    assert.equal(result.log.entries[1].sources[0].result, 'read');
    assert.equal(result.log.entries[0].modelReading, narrative);
    assert.equal(result.log.entries[0].unfiledRows, undefined);
    assert.equal(ScribeLog.checkIndex({ log: result.log }, room.messages).rows[0].written[0].text, narrative);
    assert.equal(ScribeAdoption.pendingSources(result.log, room.messages).length, 0);
});

test('installed Answers saves the operator ruling before a call and files only the question actually submitted', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Orla').narrator('They raised the flag.').messages);
    const result = await run(room, () => ({ text: ['=== QUESTIONS', 'What colour is the flag? | #1', 'Who owns the flag? | #1',
        '=== EVIDENCE', evidence('QUESTIONS', 1, 'They raised the flag.'), evidence('QUESTIONS', 1, 'They raised the flag.', { row: 2 }),
        '=== READ', '#1 | read'].join('\n') }));
    const question = result.state.questions[0];
    ScribeLog.rule(result.log, result.state, { type: 'Answer', question: question.id, text: 'blue' });
    const ruled = ScribeReplay.run(result.log, room.messages.map((message) => message.id));
    assert.ok(ScribeAnalyzer.input(ruled, room.player, room.messages).includes('"answer":"blue"'));
    const goat = '=== FACTS\nGoat | trait | sleepy | #1\nThis is a second paragraph.';
    const saved = await run(room, () => ({text: goat}), {log: result.log});
    assert.equal(saved.calls.length, 1);
    assert.equal(saved.log.entries.find((entry) => entry.origin === 'Answers').modelResponse, goat);
    assert.deepEqual(Array.from(saved.state.questions, (row) => [row.answer, row.dismissed]), [['blue', true], [null, false]]);
    assert.ok(ScribeAnalyzer.input(saved.state, room.player, room.messages).includes('"answer":"blue"'));
    const legacy = JSON.parse(JSON.stringify(saved.log));
    const last = legacy.entries.pop();
    assert.equal(last.operations[0].type, 'Dismiss');
    const paid = legacy.entries.at(-1);
    paid.pendingInputs = [ScribeAdoption.inputKey(saved.state.questions[0], room.messages[0])];
    delete paid.modelResponse;
    const upgraded = await run(room, () => assert.fail('An already paid answer was requested again'), {log: legacy});
    assert.deepEqual(Array.from(upgraded.state.questions, (row) => [row.answer, row.dismissed]), [['blue', true], [null, false]]);
});

test('installed updates honor the named fact ID and retain model category and subject wording for the Checker', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Orla').narrator('Nia has blue eyes.').narrator('Her eyes turn green.')
        .narrator('The spell is over.').messages);
    const scripts = [
        ['FACTS', 'Nia | eyes | blue | #1', 'Nia has blue eyes.'],
        ['CHANGES', 'F1 | The watcher | eye colour | green | #2', 'Her eyes turn green.'],
        ['CHANGES', 'F2 | Nia | eye color | ENDED: spell over | #3', 'The spell is over.'],
    ];
    let index = 0;
    const result = await run(room, () => {
        const [section, row, quote] = scripts[index++];
        return { text: ['=== ' + section, row, '=== EVIDENCE', evidence(section, index, quote),
            '=== READ', '#' + index + ' | read'].join('\n') };
    }, { size: 1 });
    assert.deepEqual(Array.from(result.state.facts, (fact) => [fact.text, fact.status]), [['blue', 'Replaced'], ['green', 'Ended']]);
    const change = result.log.entries[1].operations.find((item) => item.type === 'Change');
    assert.equal(change.declared.label, 'The watcher');
    assert.equal(change.evidence.declared.category, 'eye colour');
    const chosen = result.state.facts.find((fact) => fact.id === change.becomes);
    assert.equal(result.state.subjects.find((subject) => subject.id === chosen.subject).label, 'The watcher');
    assert.equal(chosen.category, 'eye colour');
    assert.equal(result.log.entries[2].operations[0].evidence.declared.category, 'eye color');
});

test('installed filing preserves the TOLD owner and missing fact ID, and keeps the next message eligible', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Orla').narrator('Nia is the captain.')
        .narrator('Ada learns that Nia is the captain.').narrator('The ship sails.').messages);
    const scripts = [
        '=== FACTS\nNia | role | captain | #1\n=== EVIDENCE\n' + evidence('FACTS', 1, 'Nia is the captain.'),
        '=== TOLD\nF1 | The captain | Ada | #2\n=== CHANGES\nF999 | Nia | rank | captain | #2\n=== EVIDENCE\n' +
            evidence('TOLD', 2, 'Ada learns that Nia is the captain.') + '\n' + evidence('CHANGES', 2, 'Nia is the captain.'),
        '=== FACTS\nShip | status | sailing | #3\n=== EVIDENCE\n' + evidence('FACTS', 3, 'The ship sails.'),
    ];
    let count = 0;
    const result = await run(room, () => ({ text: scripts[count++] + '\n=== READ\n#' + count + ' | read' }), { size: 1 });
    assert.equal(count, 3);
    assert.equal(result.state.facts[0].told[0], result.state.subjects.find((subject) => subject.label === 'Ada').id);
    const changed = result.log.entries[1];
    assert.equal(changed.operations.find((operation) => operation.type === 'Told').declared.owner, 'The captain');
    assert.equal(changed.proposals[0].operation.fact, 'F999');
    assert.equal(result.state.facts.at(-1).text, 'sailing');
    const row = ScribeLog.checkIndex({ log: result.log }, room.messages).rows[1];
    assert.ok(row.written.some((item) => item.text.includes('The captain')));
    assert.ok(row.written.some((item) => item.text.includes('F999')));
});

test('installed player direction is read by the Story model with no required note classification', async () => {
    const room = ScribeIntake.read(new CampaignBuilder('Orla').player('[Operator note] The lamp is blue.').messages);
    const result = await run(room, (system) => {
        assert.equal(system, ScribeAnalyzer.Prompt);
        return { text: '=== FACTS\nLamp | colour | blue | #1\n=== READ\n#1 | read' };
    });
    assert.equal(result.calls.length, 1);
    assert.equal(result.log.entries.at(-1).sources[0].result, 'read');
});

test('installed explicit queued notes save prose unchanged and stay filed on refresh', async () => {
    const intake = ScribeIntake.read(new CampaignBuilder('Orla').narrator('The lamp flickers.').messages);
    const room = {...intake, notes: [{position: 1, text: 'The lamp is blue.'}]};
    const prose = '  The lamp has a blue flame.\n\nThe players noticed.  ';
    const result = await run(room, (system) => ({text: system === ScribeAnalyzer.NotesPrompt ? prose : '=== READ\n#1 | read'}));
    assert.equal(result.log.entries.find((entry) => entry.origin === 'Notes').modelResponse, prose);
    assert.deepEqual(Array.from(result.log.notes), ['The lamp is blue.']);
    assert.ok(ScribeLog.checkIndex({log: result.log}, room.messages).rows[0].written.some((row) => row.text === prose));
    assert.equal((await run(room, () => assert.fail('Duplicate call'), {log: result.log})).calls.length, 0);
});

for (const finish of ['length', 'content_filter', 'upstream_new_status', null, 'stop']) {
    test('installed gateway and adoption preserve successful response text and continue after ' + finish, async () => {
        const room = ScribeIntake.read(new CampaignBuilder('Orla').narrator('The flag is blue.').narrator('They leave.').messages);
        const text = ['=== FACTS', 'Flag | colour | blue | #1', '=== EVIDENCE', evidence('FACTS', 1, 'The flag is blue.'),
            '=== READ', '#1 | read'].join('\n');
        let requests = 0;
        const result = await run(room, (system, user) => ScribeGateway.call({ system, user, model: 'test', key: 'test-token',
            reading: true, timeoutMs: null, sleep: async () => {}, fetch: async () => ({ status: 200,
                text: async () => JSON.stringify({ choices: [{ finish_reason: finish, message: { content: requests++ ? '' : text } }] }) }),
        }), { size: 1 });
        assert.equal(requests, 2);
        if (finish !== 'stop') {
            assert.equal(result.log.entries[0].providerFinish, finish);
        }
        assert.equal(result.state.facts[0].text, 'blue');
        assert.equal(result.log.entries[0].sources[0].result, 'read');
        assert.equal(result.log.entries[1].sources[0].result, 'unverified');
        assert.equal(Object.keys(result.log.read).length, 2);
    });
}
