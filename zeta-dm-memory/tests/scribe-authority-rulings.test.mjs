import assert from 'node:assert/strict';
import test from 'node:test';
import { room, plain, ScribeLog, ScribePedant, ScribeKnowledge, ScribeAnalyzer } from './support/AuthorityBook.mjs';

for (const compound of [false, true]) {
    test('built operator selection retains ' + (compound ? 'a complete compound account' : 'a new subject and its chosen fact'), async () => {
        const passage = compound ? 'Nia has green eyes and Ada has grey eyes.' : 'Nia has green eyes.';
        const scene = room([passage, 'Later they leave.']);
        scene.file(compound ? '=== FACTS\nNia | eyes | blue | #1' : '', scene.messages.slice(0, 1));
        const work = ScribeLog.checkWork(scene.book, scene.messages);
        const checked = await ScribePedant.checkPassage({ ...work, ask: async (system, input) => {
            const page = JSON.parse(input);
            const source = { ref: 'm1b1', quote: passage };
            const claims = [{ source, subject: 'Nia', attribute: 'eyes', value: 'green', attribution: 'claimed' }];
            if (compound) {
                claims.push({ source, subject: 'Ada', attribute: 'eyes', value: 'grey', attribution: 'claimed' });
            }
            return { text: JSON.stringify({ page: page.page, complete: true, claims, findings: [{
                kind: compound ? 'Citation' : 'Omission', source, question: 'Which account stands?',
                record: compound ? page.written.find((row) => row.text.includes('"fact"')).ref : null }] }) };
        } });
        for (const page of checked.pages) {
            assert.ok(ScribeLog.saveCheck(scene.book, scene.messages, ScribeLog.checkWork(scene.book, scene.messages), page));
        }
        const [finding] = ScribeLog.checkProgress(scene.book, scene.messages).findings;
        ScribeLog.ruleFinding(scene.book, scene.state(), scene.messages,
            { finding: finding.id, version: finding.version, action: 'choose', account: 'source' });
        scene.book.log = plain(scene.book.log);
        const state = scene.state();
        const [ruling] = state.checkerRulings;
        assert.equal(ruling.status, 'settled');
        if (compound) {
            assert.equal(ruling.canonical, passage);
            assert.deepEqual(plain(ruling.claims.map((claim) => [claim.subject, claim.value])), [['Nia', 'green'], ['Ada', 'grey']]);
            assert.deepEqual(plain(state.facts.map((fact) => [state.subjects.find((subject) => subject.id === fact.subject).label,
                fact.text, fact.evidence?.attribution])), [['Nia', 'green', 'claimed'], ['Ada', 'grey', 'claimed']]);
            scene.file('=== FACTS\nNia | eyes | dark | #2', scene.messages.slice(1));
            const next = ScribeLog.checkWork(scene.book, scene.messages);
            assert.equal(next.message.position, 2);
            assert.equal(JSON.parse(next.rulings.at(-1).text).decision, passage);
            assert.equal(scene.state().facts.find((fact) => fact.id === 'F1').text, 'green');
        } else {
            assert.equal(state.subjects[0].label, 'Nia');
            assert.equal(state.facts[0].subject, state.subjects[0].id);
            assert.equal(state.facts[0].text, 'green');
            assert.equal(state.facts[0].evidence.attribution, 'claimed');
            assert.equal(scene.book.log.nextSubject, 2);
        }
    });
}

for (const [section, row, result] of [
    ['CHANGES', 'F1 | Nia | eye colour | green | #1', 'Replaced'],
    ['CHANGES', 'F1 | Nia | eyes | FULLER: green | #1', 'Replaced'],
    ['CHANGES', 'F1 | Nia | eyes | ENDED: left the room | #1', 'Ended'],
    ['TOLD', 'F1 | Nia | Mara | #1', 'InForce'],
]) {
    test('an earlier model citation survives later filing and reload: ' + row, () => {
        const scene = room(['Mara heard her say the eyes are green.', 'Nia has blue eyes.']);
        scene.file('=== SUBJECTS\nNia | character\nMara | character\n=== FACTS\nNia | eyes | blue | #2', scene.messages.slice(1));
        const entry = scene.file('=== ' + section + '\n' + row, scene.messages.slice(0, 1));
        assert.equal(entry.operations.at(-1).cite, scene.messages[0].id);
        scene.book.log = plain(scene.book.log);
        const state = scene.state();
        const [original] = state.facts;
        assert.equal(original.status, result);
        if (result === 'Replaced') {
            assert.deepEqual([state.facts[1].text, state.facts[1].position, state.facts[1].category], ['green', 1, row.split(' | ')[2]]);
        } else if (result === 'Ended') {
            assert.equal(original.ended.position, 1);
        } else {
            assert.deepEqual(plain(original.told), [state.subjects.find((subject) => subject.label === 'Mara').id]);
        }
    });
}

for (const kind of ['Contradiction', 'Question', 'Citation']) {
    test('built Book materializes the selected ' + kind + ' account with its own attribute', async () => {
        const citation = kind === 'Citation';
        const lines = ['Nia has green eyes and Ada has grey eyes.', 'Nia has blue eyes.', 'Nia and Ada enter the market.'];
        const scene = room(lines);
        scene.file('=== SUBJECTS\nNia | character\nNia (the miller) | character\n=== FACTS\n' +
            (citation ? 'Nia | role | sells maps | #1' : 'Nia | eyes | blue | #2\nNia (the miller) | eyes | brown | #2'), scene.messages);
        for (const [index, words] of lines.slice(0, 2).entries()) {
            const work = ScribeLog.checkWork(scene.book, scene.messages);
            const checked = await ScribePedant.checkPassage({ ...work, ask: async (system, input) => {
                const page = JSON.parse(input);
                const source = { ref: 'm' + (index + 1) + 'b1', quote: words };
                const claims = [{ source, subject: 'Nia', attribute: !citation && !index ? 'eye colour' : 'eyes', value: index ? 'blue' : 'green', attribution: 'witnessed' }];
                if (!index && !citation) {
                    claims.push({ source, subject: 'Ada', attribute: 'eyes', value: 'grey', attribution: 'claimed' });
                }
                const findings = citation && !index ? [{ kind, source, question: 'Which account corrects the book?', record: page.written.find((row) => row.text.includes('"fact"')).ref }] :
                    !citation && index ? [{ kind, source, earlier: { ref: 'm1b1', quote: lines[0] }, record: null, question: 'Which account stands?' }] : [];
                return { text: JSON.stringify({ page: page.page, complete: true, claims, findings }) };
            } });
            for (const page of checked.pages) {
                assert.ok(ScribeLog.saveCheck(scene.book, scene.messages, ScribeLog.checkWork(scene.book, scene.messages), page));
            }
        }
        const [finding] = ScribeLog.checkProgress(scene.book, scene.messages).findings;
        assert.ok(finding);
        ScribeLog.ruleFinding(scene.book, scene.state(), scene.messages,
            { finding: finding.id, version: finding.version, action: 'choose', account: citation ? 'source' : 'earlier' });
        scene.book.log = plain(scene.book.log);
        const state = scene.state();
        const [ruling] = state.checkerRulings;
        const active = state.facts.filter((fact) => fact.status === 'InForce');
        const chosen = active.find((fact) => fact.text === 'green');
        assert.ok(ruling.factIds.includes(chosen.id));
        assert.equal(chosen.category, citation ? 'eyes' : 'eye colour');
        assert.equal(state.subjects.find((person) => person.id === chosen.subject).label, 'Nia');
        assert.equal(chosen.evidence.attribution, 'witnessed');
        assert.equal(active.some((fact) => fact.text === 'blue'), false);
        if (!citation) {
            assert.equal(ruling.canonical, lines[0]);
            const next = ScribeLog.checkWork(scene.book, scene.messages);
            assert.equal(next.message.position, 3);
            assert.equal(JSON.parse(next.rulings.at(-1).text).decision, lines[0]);
            const prompt = ScribeAnalyzer.input(state, 'Orla', scene.messages.slice(2));
            assert.match(prompt, /^F\d+ eye colour: green/mu);
            assert.doesNotMatch(prompt, /^F\d+ eyes: blue/mu);
            assert.ok(active.some((fact) => fact.text === 'brown' && state.subjects.find((subject) => subject.id === fact.subject).label === 'Nia (the miller)'));
            assert.equal(active.some((fact) => fact.text === 'grey'), false);
            assert.deepEqual(plain(ruling.claims.map((claim) => [claim.subject, claim.value, claim.attribution])), [['Nia', 'green', 'witnessed']]);
        }
    });
}

test('installed Book keeps both model scenes that open in one message, including separate privacy rulings', () => {
    const scene = room(['Nia waits in the library. Mara waits at the market.', 'The clock strikes noon.']);
    scene.file('=== SCENES\nDay 1 | #1-#2 | Library | public | present: Nia | Nia reads\nDay 1 | #1-#1 | Market | public | present: Mara | Mara waits', scene.messages);
    const before = scene.state();
    const market = before.scenes.find((row) => row.place === 'Market');
    assert.ok(market);
    ScribeLog.rule(scene.book.log, before, { type: 'Narrow', scene: market.id });
    scene.book.log = plain(scene.book.log);
    const state = scene.state();
    assert.deepEqual(plain(state.scenes.map((row) => [row.place, row.narrowed, row.summary,
        row.present.map((member) => state.subjects.find((person) => member.subject === person.id).label)])),
        [['Market', true, 'Mara waits', ['Mara']], ['Library', false, 'Nia reads', ['Nia']]]);
});

test('sharing distinguishes disjoint public and hidden quotes in the same stored block', () => {
    const hidden = 'Nia secretly has red eyes.';
    const visible = 'Mara publicly carries the red lantern.';
    const scene = room([hidden + ' ' + visible]);
    scene.file('=== FACTS\nNia | eyes | red | hidden | #1\nMara | belonging | lantern | #1\n=== SCENES\nDay 1 | #1-#1 | Market | public | present: Nia, Mara | They are at the market', scene.messages,
        [{ quote: hidden }, { quote: visible }]);
    const message = scene.messages[0];
    for (const [quote, fact, shared] of [[visible,'F2',true], [hidden,'F1',false], [hidden + ' ' + visible,'F2',false]]) {
        const source = { messageId: message.id, position: 1, fingerprint: message.fingerprint, blockNumber: 1, speaker: message.blocks[0].speaker, quote };
        const support = [ScribeLog.passage(source, message)];
        assert.equal(ScribeKnowledge.shareableFinding(scene.state(), { source, support, factIds: [fact] }, scene.messages, visible), shared);
    }
});
