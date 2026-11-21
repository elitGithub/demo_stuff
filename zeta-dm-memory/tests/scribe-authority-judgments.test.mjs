import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import CampaignBuilder from './support/CampaignBuilder.mjs';

const bundle = readFileSync(new URL('../scribe/scribe.user.js', import.meta.url), 'utf8');
const entry = bundle.indexOf('/** @file scribe/page/ScribeStart.js */');
assert.ok(entry > 0);
const { ScribeIntake, ScribeAnswer, ScribeLog, ScribeReplay, ScribePedant, ScribeLive, ScribeScene, ScribeMuse, ScribeReminder } =
    vm.runInNewContext(bundle.slice(0, entry) +
        'return { ScribeIntake, ScribeAnswer, ScribeLog, ScribeReplay, ScribePedant, ScribeLive, ScribeScene, ScribeMuse, ScribeReminder }; })();',
    { TextEncoder });

function room(lines, filing = '') {
    const builder = new CampaignBuilder('Orla');
    for (const line of lines) {
        builder.narrator(line);
    }
    const messages = ScribeIntake.read(builder.messages).messages;
    const order = messages.map((message) => message.id);
    const log = ScribeLog.create();
    const book = { log, fingerprints: Object.fromEntries(messages.map((item) => [item.id, item.fingerprint])) };
    const state = () => ScribeReplay.run(log, order);
    ScribeLog.append(log, state(), ScribeAnswer.parse(filing).operations, { messages, origin: 'Story' });
    return { messages, book, state: state() };
}

test('installed automatic historical Checker sends only the current passage, saved accounts and operator rulings', async () => {
    const sentinel = 'unfiled-original-only-7fa3';
    const {book, messages} = room(['The pennant is green. The bell rang. ' + sentinel, 'The bell was silent.', 'They leave.']);
    book.log = ScribeLog.create();
    const state = () => ScribeReplay.run(book.log, messages.map((message) => message.id));
    const filing = '=== FACTS\nPennant | colour | green | #1\n=== QUESTIONS\nWho owns the bell? | #1';
    ScribeLog.append(book.log, state(), ScribeAnswer.parse(filing).operations, {messages: messages.slice(0, 1), origin: 'Story'});
    ScribeLog.rule(book.log, state(), {type: 'Answer', question: state().questions[0].id, text: 'The bell belongs to the village.'});
    ScribeLog.append(book.log, state(), [], {messages: messages.slice(1), origin: 'Story'});
    const prompts = [];
    for (const message of messages) {
        const work = ScribeLog.checkWork(book, messages);
        assert.equal(work.message.id, message.id);
        await ScribePedant.checkPassage({...work, ask: async (_system, input) => {
            prompts.push(input);
            const packet = JSON.parse(input);
            const claims = message.position === 1 ? [
                {attribution: 'witnessed', source: {ref: 'm1b1', quote: 'The bell rang.'}, value: 'bell rang'}] : [];
            const findings = message.position === 2 ? [{kind: 'Conflict', question: 'Did the bell ring?',
                source: {ref: 'm2b1', quote: 'The bell was silent.'}, earlier: {ref: 'm1b1', quote: 'The bell rang.'}}] : [];
            return {text: JSON.stringify({page: packet.page, complete: true, claims, findings})};
        }, savePage: (page) => assert.equal(ScribeLog.saveCheck(book, messages, work, page), true)});
    }
    assert.equal(prompts.length, 3);
    assert.ok(prompts[0].includes(sentinel));
    for (const input of prompts.slice(1)) {
        assert.ok(!input.includes(sentinel));
        for (const filed of ['green', 'The bell rang.', 'The bell belongs to the village.']) {
            assert.ok(input.includes(filed), filed);
        }
    }
    const reloaded = ScribeLog.checkWork(JSON.parse(JSON.stringify(book)), messages);
    assert.equal(reloaded.message, null);
    assert.equal(reloaded.checkedThrough, 3);
    const finding = reloaded.findings.find((item) => item.question === 'Did the bell ring?');
    assert.equal(finding.earlier.quote, 'The bell rang.');
    assert.equal(finding.earlier.messageId, messages[0].id);
});

test('built live Checker keeps every cited contradiction, including location and two ages on one source', async () => {
    const { state, messages } = room(['Mira is thirty and lives in the harbor.', 'Mira says fifty, then sixty, in the citadel.'],
        '=== FACTS\nMira | age | thirty | #1\nMira | location | harbor | #1');
    const [age, location] = state.facts;
    const reviewed = await ScribePedant.review({ state, player: 'Orla', messages, message: messages[1], unread: messages, detailsOnly: true,
        ask: async (system, input) => {
            assert.equal(system, ScribePedant.Prompt);
            assert.ok(input.includes(location.id + ' | Mira | location | harbor'));
            return { text: ['=== CONTRADICTIONS', age.id + ' | Mira | age | fifty', age.id + ' | Mira | age | sixty',
                location.id + ' | Mira | location | the citadel', '=== NOW', 'Mira | wearing | a cloak', 'Mira | wearing | a hat',
                'Mira | wearing | not stated', 'Mira | wearing'].join('\n') };
        } });
    const kept = ScribeLive.merged([], [], reviewed.findings, messages[1], false);
    assert.deepEqual(Array.from(kept, (item) => item.said), ['fifty', 'sixty', 'the citadel']);
    assert.deepEqual(Array.from(ScribeLive.noted([], reviewed.notes, messages[1]), (item) => item.text), ['a cloak', 'a hat', 'not stated']);
    assert.deepEqual(Array.from(reviewed.unfiled), ['Mira | wearing']);
});

for (const changed of [false, true]) {
    test('installed unfinished historical Checker keeps paid judgments across an upgrade, changed page ' + changed, async () => {
        const {book, messages} = room(['Talon is red. ' + 'The town is quiet. '.repeat(360), 'They leave.']);
        const bytes = ScribePedant.minimumPassageBytes() + 1800;
        const work = ScribeLog.checkWork(book, messages);
        const paid = [];
        const first = 'Should the old bell be restored?';
        await assert.rejects(ScribePedant.checkPassage({...work, pageBytes: bytes, ask: async (_system, input) => {
            const page = JSON.parse(input);
            paid.push(page.page);
            const source = {ref: page.target[0].ref, quote: 'Talon is red.'};
            return {text: JSON.stringify({page: page.page, complete: true, claims: [{source, attribution: 'claimed', value: 'red'}],
                findings: [{kind: 'Question', source, question: first}]})};
        }, savePage: (page) => {
            assert.equal(ScribeLog.saveCheck(book, messages, work, page), true);
            throw new Error('Tab closed');
        }}), /Tab closed/);
        const receipt = book.log.entries.at(-1).check;
        receipt.planVersion = 2;
        const old = receipt.pages[0];
        if (changed) {
            old.id = 'previous-evidence-layout:0';
            old.answer = JSON.stringify({...JSON.parse(old.answer), page: old.id});
            old.seal = ScribeLog.checkSeal(old);
        }
        const restored = JSON.parse(JSON.stringify(book));
        const resume = ScribeLog.checkWork(restored, messages);
        assert.ok(resume.modelReadings.some((row) => row.statement.includes(first)));
        const calls = [];
        await ScribePedant.checkPassage({...resume, pageBytes: bytes, completedPages: resume.completed,
            completedSegments: resume.segments, ask: async (_system, input) => {
                const page = JSON.parse(input);
                calls.push(page.page);
                return {text: JSON.stringify({page: page.page, complete: true, claims: [], findings: []})};
            }, savePage: (page) => assert.equal(ScribeLog.saveCheck(restored, messages, resume, page), true)});
        assert.equal(calls.includes(paid[0]), changed);
        const after = ScribeLog.checkWork(JSON.parse(JSON.stringify(restored)), messages);
        assert.equal(after.message.position, 2);
        assert.equal(after.checkedThrough, 1);
        assert.equal(after.modelReadings.filter((row) => row.statement.includes(first)).length, 1);
        assert.ok(after.findings.some((row) => row.question === first));
        assert.ok(after.earlierClaims.some((row) => row.value === 'red' && row.source?.quote === 'Talon is red.'));
    });
}

test('installed older split Checker checkpoint is reused and shown once after its parent completes', async () => {
    const {book, messages} = room(['The bell rang. '.repeat(240), 'They leave.']);
    const work = ScribeLog.checkWork(book, messages);
    const bytes = 12500;
    const marker = 'The stored segment heard the bell.';
    let oldId;
    await assert.rejects(ScribePedant.checkPassage({...work, pageBytes: bytes, ask: async (_system, input) => {
        const page = JSON.parse(input);
        if (!page.page.includes('/')) {
            throw Object.assign(new Error('maximum context length exceeded'), {status: 400});
        }
        oldId = page.page;
        return {text: JSON.stringify({page: page.page, complete: true, claims: [], findings: [], observation: marker})};
    }, saveSegment: (segment) => {
        assert.equal(ScribeLog.saveCheck(book, messages, work, segment), true);
        throw new Error('Tab closed');
    }}), /Tab closed/);
    book.log.entries.at(-1).check.planVersion = 2;
    const resume = ScribeLog.checkWork(book, messages);
    assert.equal(resume.priorPages[0].id, oldId);
    const requests = [];
    await ScribePedant.checkPassage({...resume, pageBytes: bytes, ask: async (_system, input) => {
        const page = JSON.parse(input);
        requests.push(page.page);
        return {text: JSON.stringify({page: page.page, complete: true, claims: [], findings: []})};
    }, saveSegment: (piece) => assert.equal(ScribeLog.saveCheck(book, messages, resume, piece), true),
    savePage: (page) => assert.equal(ScribeLog.saveCheck(book, messages, resume, page), true)});
    assert.ok(!requests.includes(oldId));
    const progress = ScribeLog.checkWork(book, messages);
    assert.equal(progress.checkedThrough, 1);
    assert.equal(progress.modelReadings.filter((row) => row.statement.includes(marker)).length, 1);
});

for (const legacy of [false, true]) {
    test('installed nested Checker counts identically worded paid leaves once across reload and completion, legacy ' + legacy, async () => {
        const {book, messages} = room(['The bell rang at noon. '.repeat(245), 'They leave.']);
        const bytes = 16000;
        const statement = '{"complete":true,"claims":[],"findings":[]}';
        const paid = new Set();
        const ask = async (_system, input) => {
            const id = JSON.parse(input).page;
            if (id.split('/').length < 3) {
                throw Object.assign(new Error('maximum context length exceeded'), {status: 400});
            }
            assert.ok(!paid.has(id));
            paid.add(id);
            return {text: statement};
        };
        const work = ScribeLog.checkWork(book, messages);
        await assert.rejects(ScribePedant.checkPassage({...work, pageBytes: bytes, ask, saveSegment: (piece) => {
            assert.equal(ScribeLog.saveCheck(book, messages, work, piece), true);
            if (piece.id.split('/').length === 2) {
                throw new Error('Tab closed after intermediate parent');
            }
        }}), /Tab closed after intermediate parent/);
        assert.ok(paid.size > 1);
        if (legacy) {
            book.log.entries.at(-1).check.planVersion = 2;
        }
        const count = (state) => state.modelReadings.filter((row) => row.statement === statement).length;
        assert.equal(count(ScribeLog.checkProgress(book, messages)), paid.size);
        const restored = JSON.parse(JSON.stringify(book));
        const resume = ScribeLog.checkWork(restored, messages);
        assert.equal(count(resume), paid.size);
        await ScribePedant.checkPassage({...resume, pageBytes: bytes, completedPages: resume.completed,
            completedSegments: resume.segments, ask, saveSegment: (piece) => {
                assert.equal(ScribeLog.saveCheck(restored, messages, resume, piece), true);
            }, savePage: (page) => assert.equal(ScribeLog.saveCheck(restored, messages, resume, page), true)});
        const next = ScribeLog.checkWork(JSON.parse(JSON.stringify(restored)), messages);
        assert.equal(next.checkedThrough, 1);
        assert.equal(count(next), paid.size);
    });
}

test('installed historical Checker persists its complete fenced verdict, retains unlinked judgments, and accepts the operator ruling', async () => {
    const { book, messages } = room(['The bell rang.', 'Rain fell.']);
    const work = ScribeLog.checkWork(book, messages);
    let original;
    const source = { ref: 'm1b1', quote: 'The bell rang.' };
    await ScribePedant.checkPassage({ ...work, ask: async () => {
        original = '\n```json\n' + JSON.stringify({ complete: true, confidence: 'uncertain', claims: [
            { attribution: 'overheard', source, context: 'an echo' }], findings: [
            { kind: 'Timing', question: 'Which bell?', record: 'missing', source },
            { kind: 'Timing', question: 'When?', source: { ref: 'missing', quote: 'at dawn' } },
            { kind: 'Other', question: 'A bell or a chime?' }] }, null, 2) + '\n```\n';
        return { text: original };
    }, savePage: (page) => assert.equal(ScribeLog.saveCheck(book, messages, work, page), true) });
    const restored = JSON.parse(JSON.stringify(book));
    const progress = ScribeLog.checkProgress(restored, messages);
    assert.equal(progress.processedThrough ?? progress.checkedThrough, 1);
    assert.equal(ScribeLog.checkWork(restored, messages).message.id, messages[1].id);
    assert.deepEqual(Array.from(progress.modelReadings, (row) => [row.first, row.last, row.statement]), [[1, 1, original]]);
    assert.deepEqual(Array.from(progress.findings, (row) => row.question), ['Which bell?', 'When?', 'A bell or a chime?']);
    assert.equal(progress.findings[0].accounts.source[0].attribution, 'overheard');
    assert.ok(progress.findings.every((row) => row.incompleteLinks));
    const row = progress.findings[2];
    assert.equal(row.support.length, 0);
    assert.equal(row.source.unlinked, true);
    const state = ScribeReplay.run(restored.log, messages.map((message) => message.id));
    ScribeLog.ruleFinding(restored, state, messages, { finding: row.id, version: row.version, action: 'explain', explanation: 'The bell.' });
    assert.equal(ScribeLog.checkProgress(restored, messages).findings.find((item) => item.id === row.id).status, 'settled');
    assert.equal(restored.log.entries.at(-1).checkerRuling.explanation, 'The bell.');
});

test('built historical Checker distinguishes unjudged from processed and preserves both questions on one passage', async () => {
    const { book, messages } = room(['The crier departs.', 'The silver crown is missing.']);
    let calls = 0;
    for (const message of messages) {
        const work = ScribeLog.checkWork(book, messages);
        assert.equal(work.message.id, message.id);
        await ScribePedant.checkPassage({ ...work, ask: async (_system, input) => {
            calls++;
            if (message.position === 1) { return { text: 'I did not check this passage.' }; }
            const page = JSON.parse(input);
            const source = { ref: page.target[0].ref, quote: page.target[0].quote };
            return { text: JSON.stringify({ page: page.page, complete: true, claims: [{ source, attribution: 'witnessed' }],
                findings: ['Where is the crown?', 'Who has the crown?'].map((question) => ({ kind: 'Omission', question, source })) }) };
        }, savePage: (page) => assert.equal(ScribeLog.saveCheck(book, messages, work, page), true) });
    }
    const restored = JSON.parse(JSON.stringify(book));
    const progress = ScribeLog.checkProgress(restored, messages);
    assert.equal(calls, 2);
    assert.equal(progress.checkedThrough, 0);
    assert.equal(progress.checkedCount, 1);
    assert.equal(progress.processedThrough, 2);
    assert.equal(ScribeLog.checkWork(restored, messages).message, null);
    assert.deepEqual(Array.from(progress.findings, (row) => row.question), ['Where is the crown?', 'Who has the crown?']);
    assert.equal(progress.reviewRows[0].statement, 'I did not check this passage.');

    const receipt = restored.log.entries.findLast((candidate) => candidate.check).check.pages[0];
    delete receipt.judged;
    receipt.findings.splice(1);
    receipt.seal = ScribeLog.checkSeal(receipt);
    assert.deepEqual(Array.from(ScribeLog.checkProgress(restored, messages).findings, (item) => item.question),
        ['Where is the crown?', 'Who has the crown?']);
});

test('installed Checker files a nonliteral Omission with no duplicate claim; an operator can rule without certifying the quote', async () => {
    const { book, messages } = room(['Nia has hazel eyes.', 'Nia waits.']);
    const work = ScribeLog.checkWork(book, messages);
    let asked = 0;
    await ScribePedant.checkPassage({ ...work, ask: async (_system, input) => {
        asked++;
        const page = JSON.parse(input);
        const source = { ref: page.target[0].ref, quote: 'Nia has hazel eyes!' };
        return { text: JSON.stringify({ page: page.page, complete: true, summary: 'Done', claims: [], findings: [
            { kind: 'Omission', question: 'What are her eyes like?', source, confidence: 0.91 }] }) };
    }, savePage: (page) => assert.equal(ScribeLog.saveCheck(book, messages, work, page), true) });
    const progress = ScribeLog.checkProgress(book, messages);
    assert.equal(progress.checkedThrough, 1);
    assert.equal(progress.findings[0].source.verified, false);
    assert.equal(progress.findings[0].support.length, 0);
    const receipt = book.log.entries.find((entry) => entry.check).check.pages[0];
    const finding = receipt.findings[0];
    const ref = { ref: 'm1b1', quote: finding.source.quote };
    receipt.answer = JSON.stringify({page: receipt.id, complete: true, claims: [], findings: []});
    receipt.findings = [];
    receipt.judged = false;
    receipt.reviewRows = [
        {section: 'answer', reason: 'The Checker returned an incomplete or unrecognized response envelope.', statement: JSON.stringify({page: receipt.id, complete: true, claims: [], findings: [], extra: 'done'})},
        {section: 'claims', reason: 'The cited words are unavailable at the named source or precede an invalid comparison.',
            statement: JSON.stringify({source: ref, subject: 'Nia', attribute: 'eyes', value: 'hazel', attribution: 'witnessed'})},
        {section: 'findings', reason: 'A referenced filing, earlier passage or matching source claim is missing.',
            statement: JSON.stringify({kind: finding.kind, question: finding.question, source: ref})},
    ];
    receipt.seal = ScribeLog.checkSeal(receipt);
    const restored = JSON.parse(JSON.stringify(book));
    const recovered = ScribeLog.checkProgress(restored, messages);
    assert.equal(recovered.checkedThrough, 1);
    assert.equal(recovered.findings[0].accounts.source[0].value, 'hazel');
    const row = recovered.findings[0];
    const state = ScribeReplay.run(restored.log, messages.map((message) => message.id));
    ScribeLog.ruleFinding(restored, state, messages, { finding: row.id, version: row.version, action: 'choose', account: 'source' });
    const fact = ScribeReplay.run(restored.log, messages.map((message) => message.id)).facts[0];
    assert.equal(fact.text, 'hazel');
    assert.equal(fact.evidence.verified, false);
    assert.equal(fact.hidden, true);
    const order = messages.map((message) => message.id);
    const replayWith = (current) => ScribeReplay.run(restored.log, order, null,
        new Map(current.map((message) => [message.id, message.fingerprint])), null, null, current);
    assert.equal(Boolean(replayWith(messages).checkerRulings[0].sourceStale), false);
    const regenerated = [{ ...messages[0], fingerprint: 'changed',
        blocks: [{ ...messages[0].blocks[0], text: 'Nia opens the door.' }] }, messages[1]];
    const after = replayWith(regenerated);
    assert.equal(after.checkerRulings[0].sourceStale, true);
    assert.equal(after.checkerRulings[0].status, 'settled');
    assert.equal(after.checkerRulings[0].source.verified, false);
    assert.equal(after.checkerRulings[0].shareInReminder, false);
    assert.equal(after.facts[0].text, 'hazel');
    assert.equal(after.facts[0].hidden, true);
    assert.equal(ScribeLog.checkWork(restored, messages).message.id, messages[1].id);
    assert.equal(asked, 1);
});

test('built scene, development and reminder retain explicit model judgments and distinct wording', async () => {
    const { state, messages } = room(['Mira shows Orla her tattoo.'],
        '=== FACTS\nMira | appearance | tattoo of Ada | #1\n=== THREADS\nOPEN | The caravan is late | #1\n' +
        '=== SCENES\nDay 1 | #1-#1 | The Copper Inn | public | present: Mira, Orla | They talk');
    const observe = (place, changed, previous) => ScribeScene.now({ state, messages, previous, player: 'Orla',
        ask: async () => ({ text: 'Day 1 | ' + place + ' | public | present: Mira, Orla | They talk\nCHANGED: ' + changed }) });
    const previous = await observe('The Copper Inn', 'yes', null);
    const now = await observe('Copper Inn', 'no', previous);
    assert.equal(previous.changed, true);
    assert.equal(now.changed, false);
    const line = 'I cannot hear the caravan bells over the storm.';
    const suggestion = await ScribeMuse.suggest({ state, now, recent: messages, exclude: [],
        ask: async () => ({ text: 'LINE: ' + line }) });
    assert.equal(suggestion.text, line);
    const reminder = ScribeReminder.compose({ state, now, player: 'Orla', unread: [], notes: [], first: [],
        characters: [{ name: 'Mira', description: 'tattoo by Ada' }], story: 'They meet.' });
    assert.ok(reminder.text.includes('tattoo of Ada'), reminder.text);
});
