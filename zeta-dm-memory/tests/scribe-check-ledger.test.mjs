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
        const raw = JSON.parse(proposed.answer);
        proposed.claims = (Array.isArray(fields) ? fields : [fields]).map((claim) => ({
            ...proposed.claims[0], ...claim, text: claim.source?.quote ?? proposed.claims[0].text }));
        raw.claims = proposed.claims.map(({ source: passage, text, ...claim }) =>
            ({ ...claim, source: { ref: 'm' + passage.position + 'b' + passage.blockNumber, quote: passage.quote } }));
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

test('a book paraphrase of its own source is a citation diagnostic on reload, even when the Checker called it a Question', () => {
    const room = disputed(['Frost stands by the gate of the dragon stables.'],
        '=== FACTS\nDragon Stables | feature | where Frost works and stands by the gate | #1');
    const source = room.source(1);
    const fact = room.book.log.entries[0].operations.find((operation) => operation.fact);
    const record = { ref: 'w9', text: JSON.stringify(fact) + '\nFiled citation: ' + JSON.stringify(source) };
    const question = 'Does this passage support the assertion that Frost works at the stables?';
    room.certify(1, { subject: 'Frost', attribute: 'location', value: 'at the gate' }, [
        { kind: 'Question', source, earlier: null, record, question },
        { kind: 'Contradiction', source, earlier: { ...source, quote: 'the gate of the dragon stables' }, record, question },
    ]);
    room.book.log = JSON.parse(JSON.stringify(room.book.log));
    for (const row of room.rows()) {
        assert.equal(row.diagnostic, true);
        assert.equal(row.actionable, false);
        assert.equal(row.correctable, false);
        for (const change of [{ action: 'choose', account: 'record' }, { action: 'choose', account: 'source' },
            { action: 'explain', explanation: 'Both.' }, { action: 'open' }]) {
            assert.throws(() => room.rule(row, change), /changed/);
        }
    }
    assert.equal(room.book.log.entries.some((entry) => entry.checkerRuling), false);
    assert.equal(ScribeLog.checkProgress(room.book, room.messages).checkedThrough, 1);
});

test('a generic question about matching flag sentences leaves the two accounts out of Rulings', () => {
    const room = disputed(['The flag is red.', 'The flag is blue.']);
    const point = { subject: 'Flag', attribute: 'color' };
    room.certify(1, { ...point, value: 'red' });
    room.certify(2, { ...point, value: 'blue' }, [{ kind: 'Question', question: 'Which flag color stands?',
        source: room.source(2), earlier: room.source(1), record: null }]);
    room.book.log = JSON.parse(JSON.stringify(room.book.log));
    const [finding] = room.rows();
    assert.equal(finding.actionable, false);
    assert.equal(finding.diagnostic, true);
    assert.throws(() => room.rule(finding, { action: 'choose', account: 'source' }), /changed/);
});

test('only the bound original quote can turn an earlier book entry into an opposing account', () => {
    const room = disputed(['The flag is blue.', 'The flag is red.'],
        '=== FACTS\nFlag | color | blue | #1');
    const fact = room.book.log.entries[0].operations.find((operation) => operation.fact);
    const source = room.source(2);
    room.certify(1, { subject: 'Flag', attribute: 'color', value: 'blue' });
    const variants = [null, { ...room.source(1), quote: 'The flag is gold.' }, room.source(1)];
    room.certify(2, { subject: 'Flag', attribute: 'color', value: 'red' }, variants.map((citation, index) => ({
        kind: 'Contradiction', source, earlier: null, question: 'Is the flag color blue or red? ' + index,
        record: { ref: 'h1', text: JSON.stringify(fact) + (citation ? '\nFiled citation: ' + JSON.stringify(citation) : '') },
    })));
    const [loose, invented, bound] = room.rows();
    assert.deepEqual([loose, invented, bound].map((row) => row.actionable), [false, false, true]);
    assert.deepEqual(Array.from(bound.choices), ['source', 'record']);
    assert.deepEqual(Array.from(bound.support, (passage) => passage.position), [2, 1]);
    room.rule(bound, { action: 'choose', account: 'record' });
    assert.equal(room.state().checkerRulings[0].canonical, 'blue');
});

test('the same claim remains agreement across attributions, and an additional conflicting point survives', () => {
    for (const colors of [false, true]) {
        const room = disputed(['Nia says the green flag flew in the market.', 'Nia says the red flag flew in the market.']);
        const claim = { subject: 'Flag', attribute: 'location', value: 'market' };
        const color = { subject: 'Flag', attribute: 'color' };
        room.certify(1, [{ ...claim, attribution: 'claimed' }, ...(colors ? [{ ...color, value: 'green' }] : [])]);
        room.certify(2, [{ ...claim, attribution: 'witnessed' }, ...(colors ? [{ ...color, value: 'red' }] : [])], [
            { kind: 'Question', question: 'Is the flag color green or red?', source: room.source(2), earlier: room.source(1), record: null }]);
        room.book.log = JSON.parse(JSON.stringify(room.book.log));
        assert.equal(room.rows()[0].actionable, colors);
    }
});

test('unrelated quotes cannot create a Frost employment dispute through save, restore, or a direct ruling request', () => {
    for (const invent of [false, true]) {
        const room = disputed(['Frost stands by the gate of the dragon stables.', 'The Crown Prince turns away from the railing.']);
        room.certify(1, { subject: 'Frost', attribute: 'location', value: 'dragon stables' });
        room.certify(2, invent ? { subject: 'Frost', attribute: 'location', value: 'railing' } :
            { subject: 'Crown Prince', attribute: 'action', value: 'turns away' }, [
            { kind: 'Question', question: 'Does Frost work at the stables?', source: room.source(2), earlier: room.source(1), record: null }]);
        room.book.log = JSON.parse(JSON.stringify(room.book.log));
        const [row] = room.rows();
        assert.equal(row.actionable, false);
        assert.equal(row.diagnostic, true);
        assert.throws(() => room.rule(row, { action: 'choose', account: 'earlier' }), /changed/);
        assert.equal(room.book.log.entries.some((entry) => entry.checkerRuling), false);
    }
});

test('a verified operator ruling supplies an opposing value on its own point after reload', () => {
    const room = disputed(['The flag is red.', 'The flag is blue.', 'The flag is gold.']);
    const point = { subject: 'Flag', attribute: 'color' };
    room.certify(1, { ...point, value: 'red' });
    room.certify(2, { ...point, value: 'blue' }, [{ kind: 'Question', question: 'Is the flag color red or blue?',
        source: room.source(2), earlier: room.source(1), record: null }]);
    room.rule(room.rows()[0], { action: 'choose', account: 'source' });
    const work = ScribeLog.checkWork(room.book, room.messages);
    const { text, ...meta } = work.rulings.at(-1);
    const record = { ref: 'r1', text: JSON.stringify(meta) + '\n' + text };
    room.certify(3, { ...point, value: 'gold' }, [{ kind: 'Contradiction', question: 'Is the flag color blue or gold?',
        source: room.source(3), earlier: null, record }]);
    room.book.log = JSON.parse(JSON.stringify(room.book.log));
    assert.deepEqual(Array.from(room.rows()[1].choices), ['source', 'record']);
    room.rule(room.rows()[1], { action: 'choose', account: 'record' });
    assert.equal(room.state().checkerRulings.at(-1).canonical, 'The flag is blue.');
});

test('a real eye-color dispute cannot label an operator decision as a ruling about employment', () => {
    const room = disputed(['Frost’s eyes are brown.', 'Frost’s eyes are blue.']);
    const question = 'Does Frost work at the stables?';
    room.certify(1, { subject: 'Frost', attribute: 'eyes', value: 'brown' });
    room.certify(2, { subject: 'Frost', attribute: 'eyes', value: 'blue' }, [
        { kind: 'Question', question, source: room.source(2), earlier: room.source(1), record: null }]);
    const [finding] = room.rows();
    assert.equal(finding.question, question);
    assert.equal(finding.rulingQuestion, 'Which account should the book keep for Frost (eyes), “blue” or “brown”?');
    room.rule(finding, { action: 'choose', account: 'earlier' });
    room.book.log = JSON.parse(JSON.stringify(room.book.log));
    const [restored] = room.rows();
    assert.equal(restored.status, 'settled');
    assert.equal(restored.ruling.question, finding.rulingQuestion);
    assert.equal(restored.ruling.canonical, 'Frost’s eyes are brown.');
    assert.equal(room.book.log.entries.find((entry) => entry.check?.messageId === room.order[1]).check.pages[0].findings[0].question, question);
});

test('settling an eye-color dispute leaves an unrelated job intact even when the job cites the same compound passage', () => {
    for (const linked of [false, true]) {
        const room = disputed(['Frost has brown eyes and tends the stables.', 'Frost has blue eyes and wears a green coat.'],
            '=== FACTS\nFrost | role | tends the stables | #1');
        const job = room.book.log.entries[0].operations.find((item) => item.fact);
        const record = { ref: 'w1', text: JSON.stringify(job) + (linked ? '\nFiled citation: ' + JSON.stringify(room.source(1)) : '') };
        room.certify(1, [{ subject: 'Frost', attribute: 'eyes', value: 'brown' },
            { subject: 'Frost', attribute: 'role', value: 'tends the stables' }]);
        room.certify(2, [{ subject: 'Frost', attribute: 'eyes', value: 'blue' },
            { subject: 'Frost', attribute: 'coat', value: 'green' }], [
            { kind: 'Question', question: 'Does Frost work at the stables?', source: room.source(2), earlier: room.source(1), record }]);
        const [row] = room.rows();
        assert.deepEqual(Array.from(row.choices), ['source', 'earlier']);
        assert.equal(row.record, null);
        room.rule(row, { action: 'choose', account: 'source' });
        room.book.log = JSON.parse(JSON.stringify(room.book.log));
        const [decision] = room.state().checkerRulings;
        assert.deepEqual(Array.from(decision.claims, (claim) => claim.attribute), ['eyes']);
        assert.deepEqual(Array.from(decision.pointClaims, (claim) => claim.attribute), ['eyes']);
        assert.equal(decision.record, null);
        assert.deepEqual(Array.from(room.state().facts, (fact) => [fact.category, fact.text]), [['role', 'tends the stables'], ['eyes', 'blue']]);
        assert.equal(room.book.log.entries.find((entry) => entry.check?.messageId === room.order[1]).check.pages[0].findings[0].record.text, record.text);
    }
});

test('permuting compound claims and choosing either account can only change the matching eye fact', () => {
    const eyes = { subject: 'Frost', attribute: 'eyes' };
    const current = [{ ...eyes, value: 'blue' }, { subject: 'Frost', attribute: 'coat', value: 'leather' }];
    const prior = [{ ...eyes, value: 'hazel' }, { subject: 'Frost', attribute: 'role', value: 'tends the stables' }];
    for (const before of [prior, [...prior].reverse()]) {
        for (const after of [current, [...current].reverse()]) {
            for (const pick of ['source', 'earlier']) {
                for (const recordKind of ['role', 'eyes']) {
                    const room = disputed(['Frost has hazel eyes, wears a coat and tends the stables.',
                        'Frost puts on a leather coat and his eyes are blue.'],
                    '=== FACTS\nFrost | role | tends the stables | #1\nFrost | eyes | hazel | #1');
                    const fact = room.book.log.entries[0].operations.find((item) => item.fact && item.category === recordKind);
                    const record = { ref: 'w1', text: JSON.stringify(fact) + '\nFiled citation: ' + JSON.stringify(room.source(1)) };
                    room.certify(1, before);
                    room.certify(2, after, [{ kind: 'Question', question: 'Does Frost work at the stables?',
                        source: room.source(2), earlier: room.source(1), record }]);
                    const [row] = room.rows();
                    assert.equal(row.rulingQuestion, 'Which account should the book keep for Frost (eyes), “blue” or “hazel”?');
                    assert.deepEqual(Array.from(row.choices), recordKind === 'eyes' ? ['source', 'earlier', 'record'] : ['source', 'earlier']);
                    room.rule(row, { action: 'choose', account: pick });
                    room.book.log = JSON.parse(JSON.stringify(room.book.log));
                    const state = room.state();
                    const [decision] = state.checkerRulings;
                    assert.deepEqual(Array.from(decision.claims, (claim) => claim.attribute), ['eyes']);
                    assert.deepEqual(Array.from(decision.pointClaims, (claim) => claim.attribute), ['eyes']);
                    assert.equal(state.facts.find((item) => item.category === 'role').text, 'tends the stables');
                    assert.equal(state.facts.some((item) => item.category === 'coat'), false);
                    assert.equal(state.facts.find((item) => item.category === 'eyes' && item.status === 'InForce').text,
                        pick === 'source' ? 'blue' : 'hazel');
                }
            }
        }
    }
});

test('shop continuity and Galahan’s hair remain genuine disputes when short quotes rely on their original sentences', () => {
    const room = disputed(['On entering the shop Ironvein Supply, the party finds its shelves stocked in Valenmere.',
        'Stepping straight out of the same shop, they enter the market district of Thornwall.',
        'Galahan removes his hood, revealing dark hair.', 'On his return, Galahan wears his silver-grey hair cropped short.']);
    const seen = (value, position) => ({ ...room.source(position), quote: value });
    room.certify(1, { subject: 'Shop', attribute: 'town', value: 'Valenmere' });
    room.certify(2, { subject: 'Shop', attribute: 'town', value: 'Thornwall' }, [{ kind: 'Question',
        question: 'Did the shop’s town change from Valenmere to Thornwall?', source: seen('the market district of Thornwall.', 2),
        earlier: seen('its shelves stocked in Valenmere.', 1), record: null }]);
    room.certify(3, { subject: 'Galahan', attribute: 'hair', value: 'dark' });
    room.certify(4, { subject: 'Galahan', attribute: 'hair', value: 'silver-grey' }, [{ kind: 'Contradiction',
        question: 'What colour is Galahan’s hair?', source: seen('silver-grey hair cropped short.', 4),
        earlier: seen('dark hair.', 3), record: null }]);
    room.book.log = JSON.parse(JSON.stringify(room.book.log));
    assert.deepEqual(Array.from(room.rows(), (row) => Array.from(row.choices)), [['source', 'earlier'], ['source', 'earlier']]);
    room.rule(room.rows()[1], { action: 'choose', account: 'earlier' });
    assert.equal(room.state().checkerRulings[0].canonical, 'dark hair.');
});

test('amber eyes and amber describe the same value', () => {
    const room = disputed(['Orla has amber eyes.', 'Observers report Orla’s eyes are amber.']);
    room.certify(1, { subject: 'Orla', attribute: 'eyes', value: 'amber eyes' });
    room.certify(2, { subject: 'Orla', attribute: 'eyes', value: 'amber' }, [{ kind: 'Question', question: 'Which eye color?',
        source: room.source(2), earlier: room.source(1), record: null }]);
    room.book.log = JSON.parse(JSON.stringify(room.book.log));
    assert.equal(room.rows()[0].actionable, false);
});

test('a bound bounty ruling corrects the subject and preserves the operator decision when its citation changes', () => {
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
    assert.equal(state.checkerRulings[0].status, 'settled');
    assert.equal(state.checkerRulings[0].sourceStale, true);
    assert.equal(state.checkerRulings[0].shareInReminder, false);
    assert.equal(state.facts[0].text, '50,000 gold');
    assert.equal(state.facts[0].evidence, undefined);
    assert.equal(ScribeLog.checkProgress(newBook, changed).findings[0].actionable, false);
    const cosmetic = [{ ...room.messages[0], fingerprint: 'new', blocks: [{ ...room.messages[0].blocks[0],
        text: room.messages[0].blocks[0].text + ' A dog runs outside.' }] }];
    assert.equal(ScribeReplay.run(newBook.log, room.order, null, null, null, null, cosmetic).checkerRulings[0].status, 'settled');
});

test('operator-selected fixed and moving values survive a later Story claim and remain distinct from other attributes', () => {
    for (const [category, attribute] of [['eyes', 'iris'], ['location', 'location']]) {
        const room = disputed(['Nia is described.', 'Nia is described differently.'],
            '=== SUBJECTS\nNia | character\n=== FACTS\nNia | ' + category + ' | original | #1');
        const item = room.book.log.entries[0].operations.find((operation) => operation.fact);
        item.evidence = { ...room.source(1), valueSupplied: true, value: 'original', attribute, attribution: 'witnessed' };
        const record = { ref: 'w1', text: JSON.stringify(item) };
        room.certify(1, { subject: 'Nia', attribute, value: 'chosen' }, [{
            kind: 'Citation', source: room.source(1), earlier: null, record, question: 'Which account stands?' }]);
        room.rule(room.rows()[0], { action: 'choose', account: 'source' });
        const operation = { ...item, fact: 'F2', cite: room.order[1], position: 2, text: 'different',
            evidence: { ...room.source(2), valueSupplied: true, value: 'different', attribute, attribution: 'witnessed' } };
        room.book.log.entries[0].operations.push(operation);
        if (category === 'eyes') {
            room.book.log.entries[0].operations.push({ ...operation, fact: 'F3', text: 'different sclera',
                evidence: { ...operation.evidence, attribute: 'sclera' } });
        }
        room.book.log = JSON.parse(JSON.stringify(room.book.log));
        const state = room.state();
        assert.equal(state.checkerRulings[0].canonical, 'chosen');
        assert.equal(state.facts.find((row) => row.id === 'F1').status, 'InForce');
        assert.equal(state.facts.find((row) => row.id === 'F2').status, 'Reported');
        if (category === 'eyes') {
            assert.equal(state.facts.find((row) => row.id === 'F3').status, 'InForce');
        }
    }
});

test('two points with identical witnesses and text are ruled independently, and an open point remains actionable after reload', () => {
    const room = disputed(['Mirra wears the red Dawn Crown.', 'Orla put on the blue Dawn Crown.']);
    room.certify(1, { subject: 'Mirra', attribute: 'wearer', target: 'Dawn Crown', value: 'red' });
    const shared = { kind: 'Question', source: room.source(2), earlier: room.source(1), record: null };
    room.certify(2, { subject: 'Orla', attribute: 'wearer', target: 'Dawn Crown', value: 'blue' }, [
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

test('a later incompatible hair account creates a separate finding and keeps the chosen account', () => {
    const room = disputed(['Galahan has dark hair.', 'Galahan has silver hair.', 'They arrive in Thornwall.', 'Galahan has red hair.']);
    room.certify(1, { subject: 'Galahan', attribute: 'hair', value: 'dark' });
    const question = (number) => ({ kind: 'Question', question: 'What color is Galahan’s hair?',
        source: room.source(number), earlier: room.source(1), record: null });
    room.certify(2, { subject: 'Galahan', attribute: 'hair', value: 'silver' }, [question(2)]);
    room.certify(3, {}, [{ kind: 'Omission', source: room.source(3), question: 'Which town?', earlier: null, record: null }]);
    const [hair, town] = room.rows();
    room.rule(hair, { action: 'choose', account: 'earlier' });
    assert.equal(town.actionable, false);
    room.certify(4, { subject: 'Galahan', attribute: 'hair', value: 'red' }, [question(4)]);
    assert.deepEqual(Array.from(room.rows(), (row) => row.status), ['settled', 'open', 'open']);
    assert.deepEqual(Array.from(room.rows().slice(0, 2), (row) => row.id), [hair.id, town.id]);
    assert.notEqual(room.rows()[2].id, hair.id);
    assert.equal(room.state().checkerRulings[0].canonical, 'Galahan has dark hair.');
});

test('the same hair question and common earlier citation keep two subjects separate across reload and a later contradiction', () => {
    const room = disputed(['Galahan and Mirra have dark hair.', 'Galahan has silver hair.', 'Mirra has red hair.', 'Galahan has blue hair.']);
    const question = (position) => ({ kind: 'Question', question: 'What color is the hair?',
        source: room.source(position), earlier: room.source(1), record: null });
    room.certify(1, ['Mirra', 'Galahan'].map((subject) => ({ subject, attribute: 'hair', value: 'dark' })));
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
    assert.deepEqual(current.get(galahan.id), [2, 'settled']);
    assert.ok(room.rows().some((row) => row.source.position === 4 && row.status === 'open'));
    assert.deepEqual(current.get(mirra.id), [3, 'settled']);
});

test('the next Checker call retains an existing ruling and receives a second operator decision after reload', () => {
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
    assert.deepEqual(canonical(), ['Galahan has dark hair.']);
    const unfinished = context();
    room.rule(room.rows()[1], { action: 'explain', explanation: 'The red claim refers to dye.' });
    room.book.log = JSON.parse(JSON.stringify(room.book.log));
    assert.equal(context().message.position, 4);
    assert.deepEqual(canonical(), ['Galahan has dark hair.', 'The red claim refers to dye.']);
    assert.equal(ScribeLog.saveCheck(room.book, room.messages, unfinished, page(room.messages[3])), false);
    assert.deepEqual(Array.from(room.state().checkerRulings, (row) => row.status), ['settled', 'settled']);
    room.certify(4, {});
    assert.equal(context().checkedThrough, 4);
});

test('a new citation finding cannot undo an operator correction when left open', () => {
    const room = disputed(['Frost owns a black horse.', 'Frost owns a brown horse.', 'Mirra owns a white mare.'],
        '=== SUBJECTS\nFrost | character\nMirra | character\n=== FACTS\nFrost | belonging | a white horse | #1\nMirra | belonging | a white mare | #3');
    const record = { ref: 'w1', text: JSON.stringify(room.book.log.entries[0].operations.find((operation) => operation.fact)) };
    const citation = (number) => ({ kind: 'Citation', question: 'What horse belongs to Frost?',
        source: room.source(number), earlier: null, record });
    room.certify(1, { subject: 'Frost', attribute: 'owns', value: 'black horse' }, [citation(1)]);
    room.rule(room.rows()[0], { action: 'choose', account: 'source' });
    room.certify(2, { subject: 'Frost', attribute: 'owns', value: 'brown horse' }, [citation(2)]);
    assert.equal(room.rows()[0].status, 'settled');
    assert.equal(room.rows()[1].status, 'open');
    assert.throws(() => room.rule(room.rows()[1], { action: 'open' }), /changed/);
    room.book.log = JSON.parse(JSON.stringify(room.book.log));
    assert.equal(room.state().facts.find((fact) => fact.text === 'black horse').status, 'InForce');
    assert.equal(room.state().facts.find((fact) => fact.text === 'a white mare').status, 'InForce');
    assert.deepEqual(Array.from(room.rows(), (row) => row.status), ['settled', 'open']);
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
    const room = disputed(['Thessi accepts the wager. There are two chairs.', 'Thessi disputes the wager terms. She asks for another chair.']);
    room.certify(1, { subject: 'Thessi', attribute: 'wager', value: 'accepts' });
    const shared = { kind: 'Question', source: room.source(2), earlier: room.source(1), record: null };
    room.certify(2, { subject: 'Thessi', attribute: 'wager', value: 'disputes' }, [
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

test('a blue crown ruling never answers who stole it, including after loading a cached legacy binding', () => {
    const color = 'What color is Ada’s crown?';
    const theft = 'Who stole the crown from Ada?';
    for (const legacy of [true, false]) {
        const room = disputed(['Ada owns a blue crown. Mara insists Ada’s crown is red.', 'A thief stole the crown from Ada.'],
            legacy ? '=== QUESTIONS\n' + color + ' | #1' : '');
        if (legacy) {
            const state = room.state();
            const entry = ScribeLog.rule(room.book.log, state, { type: 'Answer', question: 'Q1', text: 'blue' });
            ScribeLog.link(entry, state, [], room.messages);
        }
        const blue = { ...room.source(1), quote: 'Ada owns a blue crown.' };
        const red = { ...room.source(1), quote: 'Mara insists Ada’s crown is red.' };
        room.certify(1, [{ source: blue, subject: 'Ada', attribute: 'crown', value: 'blue' },
            { source: red, subject: 'Ada', attribute: 'crown', value: 'red' }], [{
            kind: 'Question', source: blue, earlier: red, record: null, question: color }]);
        if (!legacy) {
            room.rule(room.rows()[0], { action: 'explain', explanation: 'blue' });
        }
        room.certify(2, { subject: 'Ada', attribute: 'crown', value: 'blue' }, [{
            kind: 'Question', source: room.source(2), earlier: room.source(1), record: null, question: theft }]);
        const [settled, open] = room.rows();
        if (legacy) {
            room.book.log.entries.at(-1).check.legacyRulings = [{ ...settled.ruling, finding: open.id, version: open.version,
                question: theft, support: open.support }];
        }
        room.book.log = JSON.parse(JSON.stringify(room.book.log));
        assert.deepEqual(Array.from(room.rows(), (row) => [row.question, row.status, row.ruling?.canonical]),
            [[color, 'settled', 'blue'], [theft, 'open', undefined]]);
    }
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

test('upgrading keeps finished Checker messages and restarts only an unfinished comparison with the new page plan', () => {
    const { book, messages, order } = campaign();
    ScribeLog.append(book.log, ScribeReplay.run(book.log, order), [], { messages, origin: 'Story' });
    for (const [index, total] of [[0, 1], [1, 3]]) {
        const work = ScribeLog.checkWork(book, messages);
        assert.equal(ScribeLog.saveCheck(book, messages, work, page(messages[index], 0, total)), true);
        delete book.log.entries.at(-1).check.planVersion;
    }
    const work = ScribeLog.checkWork(book, messages);
    assert.equal(work.checkedThrough, 1);
    assert.equal(work.completed.length, 0);
    const fresh = page(messages[1]);
    const interpretation = { subject: 'Magera', attribute: 'ownership', value: 'the staff has a new holder' };
    Object.assign(fresh.claims[0], interpretation);
    const raw = JSON.parse(fresh.answer);
    Object.assign(raw.claims[0], interpretation);
    fresh.answer = JSON.stringify(raw);
    assert.equal(ScribeLog.saveCheck(book, messages, work, fresh), true);
    const resumed = ScribeLog.checkWork(JSON.parse(JSON.stringify(book)), messages);
    assert.equal(resumed.checkedThrough, 2);
    assert.ok(resumed.earlierClaims.some((claim) => claim.value === interpretation.value && claim.text === 'Magera takes the staff.'));
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
