import assert from 'node:assert/strict';
import test from 'node:test';
import { room, plain, ScribeAnswer, ScribeLog, ScribePedant, ScribeKnowledge } from './support/AuthorityBook.mjs';

test('article and honorific declarations survive reload as separate identities and ambiguous references never pick one', () => {
    const scene = room(['The cast gathers.', 'Each gives their occupation.', 'Two more arrive.', 'One carries a seal.']);
    const cast = [['Crown', 'character'], ['The Crown', 'group'], ['Hana-san', 'character'], ['Hana', 'character']];
    scene.file(['=== SUBJECTS', ...cast.map((entry) => entry.join(' | '))].join('\n'), scene.messages.slice(0, 1));
    scene.file(['=== FACTS', ...cast.map(([label], index) => label + ' | role | occupation ' + index + ' | #2')].join('\n'), scene.messages.slice(1, 2));
    const first = scene.state();
    assert.deepEqual(plain(first.subjects.map(({ label, kind }) => [label, kind])), cast);
    assert.deepEqual(plain(first.facts.map(({ subject }) => subject)), ['S1', 'S2', 'S3', 'S4']);
    assert.deepEqual(plain(first.lookAlikes), []);
    scene.file('=== SUBJECTS\nSeal | character\nSeal | group', scene.messages.slice(2, 3));
    const same = scene.state();
    assert.deepEqual(plain(same.subjects.slice(4).map(({ id, label, kind }) => [id, label, kind])),
        [['S5', 'Seal', 'character'], ['S6', 'Seal', 'group']]);
    const response = ScribeAnswer.parse('=== FACTS\nSeal | role | keeper | #4');
    const saved = ScribeLog.append(scene.book.log, same, response.operations, { messages: scene.messages.slice(3), origin: 'Story' });
    assert.equal(saved.refused[0].operation.text, 'keeper');
    assert.equal(saved.refused[0].reason, 'Ambiguous');
    assert.equal(scene.state().facts.length, 4);
});

test('reload only suggests identity pairs explicitly linked in the book and honors final identity rulings', () => {
    for (const decision of ['Merge', 'Distinct']) {
        const scene = room(['The cast assembles.', 'The aide uses another name.']);
        scene.file('=== SUBJECTS\nClavicular Aide | character\nClavicular Maids | group\nAldrich | character\nAldric | character\nOswin | character\nOswin (the miller) | character', scene.messages.slice(0, 1));
        assert.deepEqual(plain(scene.state().lookAlikes), []);
        scene.file('=== NAMES\nClavicular Aide | Clavicular Maids | #2', scene.messages.slice(1));
        assert.deepEqual(plain(scene.state().lookAlikes), [{ first: 'S1', second: 'S2', reason: 'Alias' }]);
        const before = JSON.stringify(scene.book.log.read);
        ScribeLog.rule(scene.book.log, scene.state(), decision === 'Merge' ?
            { type: decision, from: 'S1', into: 'S2' } : { type: decision, first: 'S1', second: 'S2' });
        assert.deepEqual(plain(scene.state().lookAlikes), []);
        assert.equal(scene.state().subjects[0].mergedInto, decision === 'Merge' ? 'S2' : null);
        assert.equal(JSON.stringify(scene.book.log.read), before);
    }
});

test('built Checker links its chosen exact label when two subjects share a normalized name', async () => {
    const scene = room(['Crown and The Crown arrive.', 'Cross waits nearby.']);
    scene.file('=== SUBJECTS\nCrown | place\nThe Crown | group\nHarbor | place', scene.messages.slice(0, 1));
    const state = scene.state();
    assert.equal(state.subjects.length, 3);
    const reviewed = await ScribePedant.review({ state, message: scene.messages[1], messages: scene.messages,
        unread: [], player: 'Orla', ask: async () => ({ text: '=== MISSPELLINGS\nCross | _The Crown_\nUnlinked | The Harbor' }) });
    assert.deepEqual(plain(reviewed.findings.map((row) => [row.written, row.subject, row.label])), [['Cross', 'S2', 'The Crown']]);
    assert.deepEqual(plain(reviewed.unfiled), ['MISSPELLINGS: Unlinked | The Harbor']);
});

test('built Checker independently judges names, fact IDs, leaks, paraphrases and current appearance', async () => {
    const scene = room(['Nia has blue eyes.', 'The traveler arrives at the dock.']);
    scene.file('=== SUBJECTS\nNia | character\nTraveler | character\n=== FACTS\nNia | eyes | blue | #1', scene.messages.slice(0, 1));
    const answer = '=== MISSPELLINGS\nNyarra | Nia\n=== CONTRADICTIONS\nF1 | Nia | eye colour | green\n=== LEAKS\nF1 | _Traveler_ | he knows her eyes\n=== SITUATION\narrives late | had already arrived\n=== NOW\nNia | wearing | a silk scarf';
    const state = scene.state();
    const reviewed = await ScribePedant.review({ state, message: scene.messages[1], messages: scene.messages,
        unread: scene.messages, player: 'Orla', ask: async (_prompt, input) => {
            assert.match(input, /SUBJECT ROSTER[\s\S]*S1 \| Nia \| character/);
            return { text: answer };
        } });
    assert.deepEqual(plain(reviewed.findings.map((row) => [row.kind, row.said ?? row.written])),
        [['Contradiction', 'green'], ['Leak', 'he knows her eyes'], ['Spelling', 'Nyarra'], ['Situation', 'arrives late']]);
    assert.equal(reviewed.findings[0].fact, 'F1');
    assert.equal(reviewed.findings[0].statedCategory, 'eye colour');
    assert.equal(reviewed.findings[2].subject, 'S1');
    assert.equal(ScribePedant.spent(state, reviewed.findings[2]), false);
    assert.equal(ScribePedant.spent(state, reviewed.findings[1]), false);
    assert.equal(ScribePedant.told(state, reviewed.findings[1]), null);
    assert.equal(reviewed.notes[0].text, 'a silk scarf');
    assert.equal(reviewed.unfiled, undefined);
});

test('the built book retains independent roles, distinct equally worded attributes, and an open category', () => {
    const scene = room(['Nia heals the guard.', 'Nia is also a captain.', 'Her pulse and aim are steady.', 'She has the sapphire seal.']);
    scene.file('=== FACTS\nNia | role | healer | #1\nNia | role | captain | #2\nNia | trait | steady | #3\nNia | trait | steady | #3\nNia | possession | sapphire seal | #4', scene.messages,
        [null, null, { attribute: 'pulse', value: 'steady' }, { attribute: 'aim', value: 'steady' }]);
    assert.deepEqual(plain(scene.state().facts.map((fact) => [fact.text, fact.status, fact.evidence?.attribute ?? fact.category])),
        [['healer', 'InForce', 'role'], ['captain', 'InForce', 'role'], ['steady', 'InForce', 'pulse'],
            ['steady', 'InForce', 'aim'], ['sapphire seal', 'InForce', 'possession']]);
});

test('two nights in one source stay in the built timeline; neither heals an operator-corrected injury', () => {
    const scene = room(['Nia broke her arm.', 'Two nights pass.']);
    scene.file('=== FACTS\nNia | condition | broken arm | #1', scene.messages.slice(0, 1));
    const fact = scene.state().facts[0];
    ScribeLog.rule(scene.book.log, scene.state(), { type: 'EditFact', fact: fact.id, expected: ScribeLog.editExpected(fact),
        text: 'broken arm; six weeks to heal' });
    scene.file('=== NIGHTS\n#2 | first night\n#2 | second night', scene.messages.slice(1));
    assert.deepEqual(plain(scene.state().nights.map((night) => night.marker)), ['first night', 'second night']);
    assert.deepEqual([scene.state().facts[0].status, scene.state().facts[0].text], ['InForce', 'broken arm; six weeks to heal']);
});

for (const kind of ['Citation', 'Omission']) {
    test('the built book files the chosen ' + kind + ' account verbatim with its source attribution', async () => {
        const scene = room(['Nia says her eyes are green.']);
        const entry = scene.file('=== SUBJECTS\nNia | character' + (kind === 'Citation' ? '\n=== FACTS\nNia | eyes | blue | #1' : ''), scene.messages);
        const current = ScribeLog.checkWork(scene.book, scene.messages);
        const { message } = current;
        const checked = await ScribePedant.checkPassage({ ...current, message, ask: async (system, payload) => {
            const page = JSON.parse(payload);
            const source = { ref: 'm1b1', quote: 'Nia says her eyes are green.' };
            const record = kind === 'Citation' ? page.written.find((row) => row.text.includes('"fact"')).ref : null;
            return { finish: 'stop', text: JSON.stringify({ page: page.page, complete: true, claims: [
                { source, attribution: 'claimed', subject: 'Nia', attribute: 'eye colour', value: 'green' }
            ], findings: [{ kind, question: 'What colour are her eyes?', source, record }] }) };
        } });
        for (const page of checked.pages) {
            assert.equal(ScribeLog.saveCheck(scene.book, scene.messages, ScribeLog.checkWork(scene.book, scene.messages), page), true);
        }
        const [finding] = ScribeLog.checkProgress(scene.book, scene.messages).findings;
        ScribeLog.ruleFinding(scene.book, scene.state(), scene.messages,
            { action: 'choose', account: 'source', finding: finding.id, version: finding.version });
        const [saved] = scene.state().facts;
        assert.equal(saved.text, 'green');
        assert.equal(saved.evidence.attribution, 'claimed');
        assert.equal(saved.evidence.attribute, 'eye colour');
        assert.equal(saved.cite, message.id);
        assert.ok(entry.operations.length);
    });
}

test('sharing a public finding checks linked evidence without scanning unrelated private wording', () => {
    const scene = room(['Nia has red eyes.', 'Mara carries a red lantern.']);
    scene.file('=== FACTS\nNia | eyes | red | hidden | #1\nMara | belonging | lantern | #2\n=== SCENES\nDay 1 | #1-#2 | Greenmarket | public | present: Nia, Mara | They pass at the market', scene.messages);
    const passage = (message) => ({ messageId: message.id, position: message.position, fingerprint: message.fingerprint,
        blockNumber: 1, speaker: message.blocks[0].speaker, quote: message.blocks[0].text });
    for (const [index, expected] of [[0, false], [1, true]]) {
        const source = passage(scene.messages[index]);
        const support = [ScribeLog.passage(source, scene.messages[index])];
        assert.equal(ScribeKnowledge.shareableFinding(scene.state(), { source, support }, scene.messages, 'Mara owns the red lantern.'), expected);
    }
});
