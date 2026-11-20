import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import CampaignBuilder from './support/CampaignBuilder.mjs';

/**
 * @return {Object<string, object>}
 */
function loadAll() {
    const context = vm.createContext({ TextEncoder });
    const loaded = {};
    const files = [
        ['core', 'ScribeText'],
        ['core', 'ScribeCategory'],
        ['core', 'ScribeIntake'],
        ['core', 'ScribeAnswer'],
        ['core', 'ScribeLog'],
        ['core', 'ScribeReplay'],
        ['core', 'ScribeKnowledge'],
        ['core', 'ScribeAnalyzer'],
        ['page', 'ScribePedant'],
    ];
    for (const [folder, name] of files) {
        const url = new URL(`../scribe/${folder}/${name}.js`, import.meta.url);
        vm.runInContext(readFileSync(url, 'utf8'), context, { filename: url.pathname });
        loaded[name] = vm.runInContext(name, context);
    }
    return loaded;
}

const { ScribeIntake, ScribeAnswer, ScribeLog, ScribeReplay, ScribeKnowledge, ScribePedant } = loadAll();

function passage(position, lines, fromPlayer = false) {
    return { id: 'room-' + position, position, fingerprint: 'print-' + position, fromPlayer,
        blocks: lines.map(([speaker, text], index) => ({ speaker, text, blockNumber: index + 1 })) };
}

function earlier(position, speaker, quote) {
    return { messageId: 'room-' + position, fingerprint: 'print-' + position, position, blockNumber: 1, speaker, quote };
}

function checkInput(position, lines, extra = {}) {
    return { message: passage(position, lines), written: [], earlierClaims: [], rulings: [], ...extra };
}

test('two different disputes on the very same pair of quotes survive the paid page while a repeated question collapses', async () => {
    const before = 'Mirra wears the red crown.';
    const after = 'Orla wears the blue crown.';
    const result = await ScribePedant.checkPassage(checkInput(2, [['Narrator', after]], {
        earlierClaims: [earlier(1, 'Narrator', before)],
        ask: async (system, input) => {
            const { page } = JSON.parse(input);
            const findings = ['Who wears the crown?', 'What color is the crown?', 'Who wears the crown?'].map((question) =>
                ({ kind: 'Question', question, source: { ref: 'm2b1', quote: after }, earlier: { ref: 'm1b1', quote: before }, record: null }));
            return { text: JSON.stringify({ page, complete: true, claims: [], findings }) };
        },
    }));
    assert.deepEqual(Array.from(result.findings, (row) => row.question), ['Who wears the crown?', 'What color is the crown?']);
});

test('character testimony and observed speech retain their distinct attributions through real intake blocks', async () => {
    const history = new CampaignBuilder('Frost');
    for (let number = 1; number < 209; number++) {
        history.narrator('It rains.');
    }
    const report = 'I have guarded it for a thousand years.';
    history.says('Magera', report).narrator('Magera guarded the staff for a thousand years.').player('I take the staff.');
    const { messages } = ScribeIntake.read(history.messages);
    const run = (index, role, quote, fields) => ScribePedant.checkPassage(checkInput(209, [], {
        message: messages[index], ask: async (system, input) => {
            const page = JSON.parse(input);
            assert.equal(page.target[0].role, role);
            return { text: JSON.stringify({ page: page.page, complete: true, findings: [], claims: [{
                source: { ref: page.target[0].ref, quote }, ...fields,
            }] }) };
        },
    }));
    const claim = { subject: 'Magera', attribute: 'guarded', value: 'a thousand years' };
    for (const quote of [report, 'guarded it for a thousand years']) {
        await assert.rejects(run(208, 'Character', quote, { ...claim, attribution: 'witnessed' }), /unsupported/);
        assert.equal((await run(208, 'Character', quote, { ...claim, attribution: 'claimed' })).claims[0].attribution, 'claimed');
    }
    assert.equal((await run(208, 'Character', report, { subject: 'Magera', attribute: 'said', value: report, attribution: 'witnessed' }))
        .claims[0].attribute, 'said');
    assert.equal((await run(209, 'Narrator', messages[209].blocks[0].text, { ...claim, attribution: 'witnessed' })).claims.length, 1);
    assert.equal((await run(210, 'Player', 'I take the staff.', { subject: 'Frost', attribute: 'take', value: 'the staff',
        attribution: 'witnessed' })).claims.length, 1);
});

test('source phrases require complete Unicode words and quantities', async () => {
    const line = 'Joanna and Élodie May saw an undead guardian carrying 2,000 gold.';
    const run = (fields) => ScribePedant.checkPassage(checkInput(12, [['Narrator', line]], {
        ask: async (system, input) => {
            const page = JSON.parse(input);
            return { text: JSON.stringify({ page: page.page, complete: true, findings: [],
                claims: [{ source: { ref: 'm12b1', quote: line }, attribution: 'witnessed', ...fields }] }) };
        },
    }));
    for (const fields of [{ subject: 'Ann' }, { value: 'dead' }, { subject: 'lodie' }, { value: '2' }, { value: '000' }]) {
        await assert.rejects(run(fields), /unsupported/);
    }
    assert.equal((await run({ subject: 'E\u0301lodie May', attribute: 'carrying', value: '2,000 gold' })).claims.length, 1);
});

test('removed reminder text cannot bridge an original citation in either current or historical evidence', async () => {
    const history = new CampaignBuilder('Frost');
    history.player('The gate was closed.\n[Scribe] The secret reminder.\nThe sea was calm.').narrator('The gate opened.');
    const { messages } = ScribeIntake.read(history.messages);
    const block = messages[0].blocks[0];
    const original = history.messages[0].contents[0].text;
    const pieces = ScribeIntake.sourcePieces(block);
    assert.equal(pieces.map((piece) => piece.quote).join(''), block.text);
    assert.ok(pieces.length > 1 && pieces.every((piece) => original.includes(piece.quote) && !piece.quote.includes('secret reminder')));
    const old = pieces.map((piece) => ({ ...earlier(1, block.speaker, piece.quote), ...piece }));
    for (const [index, previous] of [[0, []], [1, old]]) {
        const run = (quote) => ScribePedant.checkPassage(checkInput(1, [], { message: messages[index], earlierClaims: previous,
            ask: async (system, input) => {
                const row = JSON.parse(input);
                const actual = index ? row.evidence : row.target;
                assert.ok(actual.every((source) => original.includes(source.quote)));
                const source = { ref: 'm1b1', quote };
                return { text: JSON.stringify({ page: row.page, complete: true, claims: index ? [] :
                    [{ source, attribution: 'claimed' }], findings: index ? [{ kind: 'Question',
                        question: 'When was it opened?', source: { ref: 'm2b1', quote: 'The gate opened.' }, earlier: source }] : [] }) };
            } }));
        await assert.rejects(run(block.text), /unsupported/);
        assert.equal((await run('The gate was closed.')).complete, true);
    }
});

test('context-limit refusals shrink the page and a restart keeps previously certified parents and segments', async () => {
    const work = checkInput(99, [['Riven', 'The gate has changed.']], {
        earlierClaims: Array.from({ length: 45 }, (_, index) => earlier(index + 1, 'Narrator',
            'The gate appears in the earlier record ' + index + '. ' + 'Wet stones. '.repeat(116))),
    });
    let bound = 24576;
    const good = new Set();
    const bad = new Set();
    const saved = [];
    const segments = [];
    let first = true;
    const ask = async (system, input) => {
        const row = JSON.parse(input);
        assert.ok(!good.has(row.page), 'a paid successful page ran twice');
        assert.ok(!bad.has(row.page), 'the identical rejected request was retried');
        if (!first && Buffer.byteLength(input) > 4096) {
            bad.add(row.page);
            throw Object.assign(new Error('context_length_exceeded'), { status: 400 });
        }
        first = false;
        good.add(row.page);
        return { text: JSON.stringify({ page: row.page, complete: true, claims: [], findings: [] }) };
    };
    const invoke = (interrupt) => ScribePedant.checkPassage({ ...work, ask, pageBytes: bound,
        completedPages: JSON.parse(JSON.stringify(saved)), completedSegments: JSON.parse(JSON.stringify(segments)),
        savePage: (page) => saved.push(page), learnLimit: (next) => {
            assert.ok(next < bound);
            bound = next;
        },
        saveSegment: (segment) => {
            segments.push(segment);
            if (interrupt) { throw new Error('reader yielded after a checkpoint'); }
        } });
    await assert.rejects(invoke(true), /yielded after a checkpoint/);
    assert.equal(saved.length, 1);
    assert.equal(segments.length, 1);
    assert.ok(bad.size && bound < 24576);
    const final = await invoke(false);
    assert.equal(final.complete, true);
    assert.equal(final.pages.length, saved.length);
    assert.ok(saved.length > 1 && segments.length > 1);
    let calls = 0;
    await assert.rejects(ScribePedant.checkPassage({ ...work, ask: () => {
        calls++;
        throw Object.assign(new Error('User not found.'), { status: 401 });
    }, learnLimit: () => assert.fail('an auth error must not reduce context') }), /User not found/);
    assert.equal(calls, 1);
    const tiny = checkInput(1, [['Riven', 'No.']]);
    await assert.rejects(ScribePedant.checkPassage({ ...tiny, ask: () => {
        throw Object.assign(new Error('context_length_exceeded'), { status: 400 });
    } }), (error) => error.checkerContextFloor === true);
});

test('the checker distinguishes a reported fact from witnessing the report and requires an independently extracted omission', async () => {
    const line = 'Magera claimed Frost stole the orb. Frost then opens the gate.';
    const run = (quote, subject, attribute, attribution, extra = {}) => ScribePedant.checkPassage(checkInput(9,
        [['Narrator', line]], { ask: async (system, input) => {
            const page = JSON.parse(input);
            const source = { ref: page.target[0].ref, quote };
            return { text: JSON.stringify({ page: page.page, complete: true,
                claims: [{ source, subject, attribute, attribution }], findings: [], ...extra }) };
        } }));
    for (const quote of ['Magera claimed Frost stole the orb.', 'Frost stole the orb.']) {
        await assert.rejects(run(quote, 'Frost', 'stole', 'witnessed'), /unsupported/);
        assert.equal((await run(quote, 'Frost', 'stole', 'claimed')).claims[0].attribution, 'claimed');
    }
    assert.equal((await run('Magera claimed Frost stole the orb.', 'Magera', 'claimed', 'witnessed')).claims.length, 1);
    assert.equal((await run('Frost then opens the gate.', 'Frost', 'opens', 'witnessed')).claims.length, 1);
    await assert.rejects(run('the orb', null, null, 'claimed', { claims: [], findings: [{ kind: 'Omission', source:
        { ref: 'm9b1', quote: 'the orb' }, question: 'Who sank the ship?' }] }), /unsupported/);
});

test('all pages fit a UTF-8 request budget; the last failed page alone retries after persisted progress is restored', async () => {
    const cap = 3600;
    const first = 'The chain is red. '.repeat(12);
    const second = 'A second length of rope remains on the bank. '.repeat(14);
    const prior = Array.from({ length: 13 }, (_, i) => earlier(i + 1, 'Keeper',
        'Café remains open. ' + '\u{1d11e}'.repeat(140) + ' End of source ' + (i + 1)));
    const input = checkInput(15, [['Narrator', first], ['Keeper', second]], { earlierClaims: prior, pageBytes: cap });
    const expected = [...ScribePedant.passagePages(input)];
    assert.ok(expected.length > 2);
    const covered = new Map();
    const target = new Map();
    let comparedEarlierInMessage = false;
    for (const row of expected) {
        assert.ok(Buffer.byteLength(ScribePedant.CheckPrompt + row.input) <= cap);
        const request = JSON.parse(row.input);
        for (const block of request.target) {
            if (!target.has(block.ref)) { target.set(block.ref, new Map()); }
            target.get(block.ref).set(block.offset ?? 0, block.quote);
        }
        for (const block of request.evidence) {
            if (block.messageId === 'room-15') {
                comparedEarlierInMessage = true;
            } else {
                if (!covered.has(block.messageId)) { covered.set(block.messageId, new Map()); }
                covered.get(block.messageId).set(block.offset ?? 0, block.quote);
            }
        }
    }
    const full = (pieces) => [...pieces].sort(([left], [right]) => left - right).map(([, text]) => text).join('');
    for (const block of prior) {
        assert.equal(full(covered.get(block.messageId)), block.quote);
    }
    assert.equal(full(target.get('m15b1')), first);
    assert.equal(full(target.get('m15b2')), second);
    assert.ok(comparedEarlierInMessage);
    let attempts = 0;
    const saved = [];
    const ask = async (system, user) => {
        attempts++;
        assert.equal(system, ScribePedant.CheckPrompt);
        assert.ok(Buffer.byteLength(system + user) <= cap);
        const page = JSON.parse(user);
        if (attempts === expected.length) {
            return { text: 'The last comparison could not finish.' };
        }
        return { text: JSON.stringify({ page: page.page, complete: true, claims: [], findings: [] }) };
    };
    await assert.rejects(ScribePedant.checkPassage({ ...input, ask, savePage: (page) => saved.push(page) }));
    assert.equal(saved.length, expected.length - 1);
    const final = await ScribePedant.checkPassage({ ...input, ask, completedPages: JSON.parse(JSON.stringify(saved)), savePage: (page) => saved.push(page) });
    assert.equal(final.complete, true);
    assert.equal(saved.length, expected.length);
    assert.equal(attempts, expected.length + 1);
    assert.equal(new Set(saved.map((page) => page.id)).size, expected.length);
    await assert.rejects(ScribePedant.checkPassage({ ...input, pageBytes: 1, ask: () => assert.fail('oversize request issued') }), /too small/);
});

test('a claim present on a different written page never becomes a durable omission', async () => {
    const work = checkInput(55, [['Riven', 'I own a bell.']], { pageBytes: 3600,
        written: Array.from({ length: 9 }, (_, i) => ({ text: ('Old entry ' + i + '. ').repeat(28) +
            (i === 8 ? 'Riven owns a bell.' : '') })) });
    const pages = [];
    const result = await ScribePedant.checkPassage({ ...work, savePage: (page) => pages.push(page),
        ask: async (system, input) => {
            const row = JSON.parse(input);
            const source = { ref: row.target[0].ref, quote: 'I own a bell.' };
            return { text: JSON.stringify({ page: row.page, complete: true, claims: [{ source, attribution: 'claimed' }],
                findings: row.written.some((item) => item.text.includes('Riven owns a bell.')) ? [] :
                    [{ kind: 'Omission', question: 'Add the bell?', source }] }) };
        } });
    assert.ok(pages.length > 1);
    assert.equal(result.claims.length, 1);
    assert.equal(result.findings.length, 0);
    assert.ok(pages.every((page) => !page.findings.length));
});

test('independent comparison receives old attributed and ended facts, current entry and original before its verdict', async () => {
    const prior = [
        earlier(129, 'Mavan', "I've used it on dozens of mages."),
        earlier(131, 'Mavan', "I've had that Staff for two centuries."),
        earlier(166, 'Frost', 'Destroy the lich, spell and phylactery.'),
        earlier(167, 'Narrator', 'The staff was gone.'),
        earlier(174, 'Frost', 'Something is guarding that staff.'),
        earlier(188, 'Frost', 'Probably a hatchling they set.'),
        earlier(192, 'Frost', 'The Lichj used it.'),
        earlier(199, 'Magera', 'They meant to raise me as a weapon for their war.'),
        { id: 'F67', text: 'Ended: the Staff belonged to the former elven owners.' },
        { id: 'F120', text: 'Filed at #199: raised to be a weapon and given the artifact as a reward.' },
    ];
    const work = checkInput(209, [['Magera', 'I have guarded it for a thousand years. They gave it to me as a reward.']], {
        earlierClaims: prior, written: [{ text: 'She mentions the artifact.' }],
        rulings: [{ text: 'Mavan and the lich are aliases.' }],
        ask: async (system, input) => {
            assert.equal(system, ScribePedant.CheckPrompt);
            const page = JSON.parse(input);
            for (const row of prior) {
                assert.ok(page.evidence.some((entry) => row.quote ? entry.quote === row.quote : entry.text?.includes(row.id)));
            }
            assert.ok(page.evidence.some((entry) => entry.text === 'Mavan and the lich are aliases.'));
            assert.equal(page.written[0].text, 'She mentions the artifact.');
            assert.equal(page.target[0].speaker, 'Magera');
            const source = { ref: page.target[0].ref, quote: 'I have guarded it for a thousand years.' };
            return { text: JSON.stringify({ page: page.page, complete: true,
                claims: [{ source, attribution: 'claimed', subject: 'Magera' }],
                findings: [
                    { kind: 'Question', question: 'How did Mavan gain access?', source,
                        earlier: { ref: 'm131b1', quote: prior[1].quote } },
                    { kind: 'Citation', question: 'Was the reward first mentioned at #209?', source: {
                        ref: page.target[0].ref, quote: 'They gave it to me as a reward.' },
                        record: page.evidence.find((entry) => entry.text?.includes('F120')).ref },
                    { kind: 'Omission', question: 'Did the book omit her account of guarding it?', source },
                ] }) };
        },
    });
    const checked = await ScribePedant.checkPassage(work);
    assert.equal(checked.findings.length, 3);
    assert.equal(checked.findings[0].earlier.messageId, 'room-131');
    assert.equal(checked.findings[1].source.messageId, 'room-209');
    assert.equal(checked.claims[0].source.speaker, 'Magera');
    assert.equal(checked.claims[0].attribution, 'claimed');
});

test('a filed destruction is challenged at the original player passage without borrowing the next narration', async () => {
    const work = checkInput(166, [], { message: passage(166, [['Frost', 'Destroy the lich, spell and phylactery.']], true),
        written: [{ id: 'T2', text: 'Staff of Elders destroyed with Mavan.' }],
        ask: async (system, input) => {
            const page = JSON.parse(input);
            assert.equal(page.fromPlayer, true);
            assert.equal(page.target.length, 1);
            assert.equal(page.evidence.length, 0);
            assert.ok(page.written[0].text.includes('Staff of Elders'));
            return { text: JSON.stringify({ page: page.page, complete: true, claims: [], findings: [
                { kind: 'Citation', source: { ref: 'm166b1', quote: 'lich, spell and phylactery' },
                    record: page.written[0].ref, question: 'Which words establish that the Staff of Elders was destroyed?' },
            ] }) };
        } });
    const result = await ScribePedant.checkPassage(work);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].source.fingerprint, 'print-166');
    await assert.rejects(ScribePedant.checkPassage({ ...work, earlierClaims: [earlier(167, 'Narrator', 'The staff was gone.')] }), /future/);
});

test('compatible accounts reach the checker with the chronology, speaker and form visible', async () => {
    for (const [position, lines, evidence, written] of [
        [33, [['Narrator', 'She has amber eyes.']], [earlier(3, 'Narrator', 'Her eyes are amber.')], [{ text: 'eyes: amber' }]],
        [196, [['Narrator', 'In full dragon form Sera is 20 m long.']], [earlier(148, 'Narrator', 'In human form Sera is 5 ft 9 in tall.')],
            [{ text: 'Sera build [full dragon / length] 20 m' }]],
        [223, [['Narrator', 'Thessaly stands holding the staff.']], [earlier(217, 'Narrator', 'The chains break. Magera takes cat form.'),
            earlier(221, 'Narrator', 'Thessaly takes the staff.')], [{ text: 'current carrier: Thessaly' }]],
    ]) {
        const checked = await ScribePedant.checkPassage(checkInput(position, lines, { earlierClaims: evidence, written,
            ask: async (system, input) => {
                const page = JSON.parse(input);
                assert.ok(evidence.every((row) => page.evidence.some((candidate) => candidate.quote === row.quote)));
                assert.equal(page.target[0].quote, lines[0][1]);
                assert.equal(page.written[0].text, written[0].text);
                return { text: JSON.stringify({ page: page.page, complete: true, claims: [
                    { source: { ref: page.target[0].ref, quote: lines[0][1] }, attribution: 'witnessed' },
                ], findings: [] }) };
            } }));
        assert.equal(checked.claims.length, 1);
        assert.equal(checked.findings.length, 0);
    }
});

test('refusals, invented or wrong-speaker quotes, future block comparisons and incomplete answers never checkpoint', async () => {
    const parts = [['Narrator', 'The gate was closed.'], ['Riven', 'I saw the gate open.']];
    const good = { ref: 'm12b2', quote: 'I saw the gate open.' };
    const askWith = (verdict) => async (system, input) => {
        const page = JSON.parse(input);
        const answer = { page: page.page, complete: true, claims: [], findings: [] };
        return { text: verdict(answer) };
    };
    for (const verdict of [
        () => 'I can summarize instead.', (answer) => JSON.stringify({ ...answer, page: 'another page' }),
        (answer) => JSON.stringify({ ...answer, complete: false }), (answer) => JSON.stringify({ ...answer, error: 'No history' }),
        (answer) => JSON.stringify({ ...answer, claims: [{ source: { ...good, ref: 'm12b1' }, attribution: 'claimed' }] }),
        (answer) => JSON.stringify({ ...answer, claims: [{ source: good, attribution: 'claimed', value: 'steel' }] }),
        (answer) => JSON.stringify({ ...answer, findings: [{ kind: 'Citation', source: good, question: 'Which gate?', record: 'w999' }] }),
        (answer) => JSON.stringify({ ...answer, findings: [{ kind: 'Question', question: 'Who closed it?', source: {
            ref: 'm12b1', quote: 'The gate was closed.' }, earlier: good }] }),
    ]) {
        let saved = 0;
        const work = checkInput(12, parts, { ask: askWith(verdict), savePage: () => { saved++; } });
        await assert.rejects(ScribePedant.checkPassage(work), /incomplete|unsupported/);
        assert.equal(saved, 0);
    }
    const checked = await ScribePedant.checkPassage(checkInput(12, parts, { ask: askWith((answer) => JSON.stringify({
        ...answer, findings: [{ kind: 'Question', question: 'When did it open?', source: good,
            earlier: { ref: 'm12b1', quote: 'The gate was closed.' } }],
    })) }));
    assert.equal(checked.findings[0].earlier.blockNumber, 1);
});

const separator = String.fromCodePoint(0x2028);
const zeroWidth = String.fromCodePoint(0x200b);
const astral = String.fromCodePoint(0x1d400);

const narration50 =
    'Halvard, forty now and not 34, stands by the tower door with blue eyes, red hair gone black, and smooth skin. ' +
    'He’s a baker these days, pardoned, and he whistles when nervous. He has a black eye, ten years old. ' +
    'The bell rings 31 times. He deserted the army once.';
const speech50 =
    'You look tired, Halvard. You deserted, I know it, you ran at the siege. You pick locks, you are so thin. ' +
    'Brandt is a ferryman. She poisoned her first husband. We are bitter rivals now, and you are square with him.';
const longLine = `${'went down the long road '.repeat(5).trim()}s! and more.`;
const exactPrefix = '[#64] Narrator: ';

const scripted = {
    41: [['Narrator', 'NARRATOR', 'Halvard speaks with Mirelle in the yard.']],
    42: [['Narrator', 'NARRATOR', 'In the yard Halvard shows his hair.']],
    43: [['Narrator', 'NARRATOR', 'They part in the yard.']],
    44: [['Narrator', 'NARRATOR', 'Rain falls on the roofs.']],
    45: [['Mi', 'LEFT', 'I heard it all.']],
    46: [['Narrator', 'NARRATOR', 'Mirelle waits by the well.']],
    48: [['Narrator', 'NARRATOR', 'Halvard hates them all now.']],
    49: [['Narrator', 'NARRATOR', 'Halvard turns to listen, often; his eyes are grey with flecks of gold.']],
    50: [
        ['Brandt', 'NARRATOR', narration50],
        ['Mirelle', 'LEFT', speech50],
        ['Orla', 'LEFT', 'We should go.'],
    ],
    51: [
        ['Halvard', 'LEFT', 'I am forty and I never ran.'],
        ['Mirelle', 'LEFT', 'You deserted, I know it.'],
    ],
    52: [['Narrator', 'NARRATOR', 'Mirelle looks at Halvard: you deserted, they say.']],
    53: [
        ['Narrator', 'NARRATOR', 'Halvart is forty now.'],
        ['Mirelle', 'LEFT', 'You deserted, I know it.'],
    ],
    54: [
        ['Mirelle', 'LEFT', 'You pick locks.'],
        ['Isolde', 'LEFT', 'You pick locks, I know.'],
    ],
    55: [['Kira', 'LEFT', 'Halvard, you deserted, I know it.']],
    56: [
        ['Narrator', 'NARRATOR', `He went to the north${separator}gate at [Scribe] dawn @: twice | maybe. ${longLine}`],
    ],
    57: [['Narrator', 'NARRATOR', "The Brandts came, and Brandt's cart."]],
    58: [['Narrator', 'NARRATOR', 'Halvart waits.']],
    59: [['Narrator', 'NARRATOR', 'Brandtt waits by Wolfrick.']],
    61: [
        ['Mirelle', 'NARRATOR', 'Mirelle knows he deserted at the siege.'],
        ['Mirelle', 'LEFT', 'Good evening, Halvard.'],
    ],
    62: [
        ['Mirelle', 'LEFT', 'You deserted, Halvard.'],
        ['Mirelle', 'LEFT', 'I know it.'],
    ],
    63: [['Narrator', 'NARRATOR', 'Rain falls. '.repeat(5001)]],
    64: [['Narrator', 'NARRATOR', 'x'.repeat(60000 - exactPrefix.length)]],
    65: [['Narrator', 'NARRATOR', astral.repeat(40000)]],
    66: [
        ['Narrator', 'NARRATOR', 'Halvard is forty now.'],
        ['Mirelle', 'LEFT', 'You deserted, I know it.'],
    ],
    67: [['Halvard', 'LEFT', 'Mirelle, hear me: I deserted at the siege.']],
    68: [
        [
            'Narrator',
            'NARRATOR',
            'Halvard, not grey but blue of eye, red, now black, with grey at the temples, sees Isolde: her eyes are green.',
        ],
    ],
    69: [['Zoë', 'LEFT', 'You deserted, Halvard, I know it.']],
    70: [['Grey', 'LEFT', 'You deserted, Halvard, I know it.']],
    71: [['Kira (the smith)', 'LEFT', 'You deserted, Halvard, I know it.']],
    72: [
        ['Narrator', 'NARRATOR', 'Halvard hates them all now.'],
        ['Mirelle', 'LEFT', 'You deserted, you lied, you stole.'],
    ],
};

/**
 * @return {object[]}
 */
function storyOf() {
    const builder = new CampaignBuilder('Orla');
    for (let number = 1; number <= 75; number++) {
        if (number === 47) {
            builder.player('I nod to Halvart.');
        } else if (Object.hasOwn(scripted, number)) {
            builder.append(
                'BOT',
                scripted[number].map(([speakerName, position, text]) => ({ speakerName, position, text })),
            );
        } else {
            builder.narrator(`The tale goes on, line ${number}.`);
        }
    }
    return ScribeIntake.read(builder.messages).messages;
}

const story = storyOf();
const storyOrder = story.map((message) => message.id);

const shape = [
    'kind',
    'message',
    'position',
    'subject',
    'label',
    'fact',
    'category',
    'book',
    'said',
    'speaker',
    'speakerLabel',
    'written',
];

const longLocation = 'a farm beyond the river where the old mill once stood '.repeat(4).trim();
const longRole = 'keeper of the ledgers of every debt owed to her family '.repeat(7).trim();

const cast = [
    'Halvard | character',
    'Mirelle | character',
    'Isolde | character',
    'Brandt | character',
    'Orla | character',
    'Tamsin | character',
];

const facts = [
    'Mirelle | aka | Mi | #3',
    'Halvard | age | 34 | #5',
    'Halvard | eyes | grey | #6',
    'Halvard | location | the mill | #7',
    'Halvard | trait | hums when nervous | #8',
    'Halvard | relation to Isolde | sworn friends | #9',
    'Halvard | relation to the miller | owes him money | #10',
    'Halvard | condition | a split lip | #11',
    'Halvard | hair | red | #12',
    'Halvard | role | a smith | #14',
    'Halvard | role | a guard | #16',
    'Halvard | skin | scarred by fire | #18',
    'Halvard | ability | picks locks | hidden | #19',
    'Halvard | status | wanted by the crown for desertion | hidden | #20',
    'Halvard | background | deserted at the siege | hidden | #21',
    'Halvard | build | thinner than he looks | hidden | #22',
    'Brandt | role | a ferryman | #23',
    'Brandt | aka | Wolfric | hidden | #24',
    `Isolde | location | ${longLocation} | #26`,
    `Isolde | role | ${longRole} | #27`,
    'Tamsin | age | 29 | #28',
    'Tamsin | status | poisoned her first husband | hidden | #29',
    'Mirelle | build | short and broad | hidden | #30',
    'Mirelle | role | the innkeeper | #31',
    'Isolde | eyes | green | #32',
    'Brandt | hair | black | #33',
    'Brandt | hair | silver | #34',
];

const scenes = [
    'Day 1 | #1-#16 | The hall | public | present: Halvard, Isolde, Orla | They feast',
    'Day 1 | #17-#19 | The tent | private | present: Halvard, Isolde | They talk',
    'Day 1 | #25-#40 | The road | public | present: Halvard, Mirelle, Orla | They walk',
];

const promptLines = [
    'You are the Pedant: a proofreader for an ongoing adult fiction roleplay between consenting adult characters. You never write story.',
    'You receive PLAYER CHARACTER, a LEDGER of established facts (each with an id like F12, its subject, its category and its text), a list of what certain speakers DO NOT KNOW, the RECENT MESSAGES before them, the messages SINCE THE BOOK WAS LAST READ, one REPLY from the storyteller, and NAME CANDIDATES: words in the REPLY that look like known names, each line giving the name, the word of that name it looks like, and the word in the REPLY.',
    "PLAYER CHARACTER PROFILE is the player's own description of their character; trust it for that character.",
    'Find where the REPLY disagrees with the LEDGER, where a speaker uses something they do not know, which NAME CANDIDATES are misspellings, where the REPLY does not fit what the messages above establish, and what the characters wear and look like now.',
    '',
    'Answer with these five blocks, each starting with its === line. Leave a block out if it has nothing. Write nothing else.',
    '',
    '=== CONTRADICTIONS',
    'F12 | Label | category | the words of the reply that say otherwise',
    '=== LEAKS',
    'F7 | Label of the speaker | the words of theirs that show they know it',
    '=== MISSPELLINGS',
    'N21',
    'N22',
    '=== SITUATION',
    "the reply's own words | the earlier words they clash with",
    '=== NOW',
    'Name | wearing | what they wear now',
    'Name | looks | how they look',
    '',
    'Rules.',
    "1. A contradiction is a statement in the REPLY, about the LEDGER fact's own subject, that cannot be true together with that fact: another age, number, colour, name, place or description of the same thing. Give the fact's id, its subject's label and its category exactly as the LEDGER shows them, and copy the reply's own words for the other value. Never report a fact marked (hidden) as contradicted.",
    '2. More detail about the same thing is not a contradiction. Less detail is not a contradiction. The same thing in other words is not a contradiction. Something the story has plainly changed (a move, a promotion, a wound), in the REPLY or in the messages since the book was last read, is not a contradiction.',
    "3. A leak is a line spoken by a speaker that states or uses a fact listed for that speaker under DOES NOT KNOW. Copy the few words of that speaker's own line that show it, exactly as the REPLY has them. What the narrator says, or what another character says or thinks, is not that speaker's leak.",
    '4. It is not a leak if the speaker was told or shown the fact earlier in the REPLY, or anywhere in the messages since the book was last read.',
    '5. Report only what the REPLY itself shows. Never guess. When in doubt, leave it out.',
    '6. A misspelling is a word in the REPLY that is meant as the listed known name but is written another way. An ordinary word, a word at the start of a sentence that is not meant as the name, and a different or new name are not misspellings. Report only numbers from NAME CANDIDATES. In the MISSPELLINGS block write only the numbers of the misspellings, one per line, nothing else on the line.',
    "7. A situation clash is a statement in the REPLY that cannot be true given what the messages above establish: where the characters are, who is present, what they are doing or holding, the time, or what was just agreed or planned. Copy the reply's own words exactly, then the earlier words that establish the situation, exactly as a message above has them; each quote at most 40 words, from one sentence. Something the REPLY or a message above plainly changes (they walk to the table, the plan changes) is not a clash. Not style, not taste, not something you would have written differently. When in doubt, leave it out.",
    '8. NOW: for each character present in the REPLY whose clothing the REPLY or the messages above state, write one wearing line with what they wear now; for any character whose looks the REPLY or the messages above state, write one looks line. Only what is stated; never guess. At most 12 lines. Write each name as the messages write it.',
];

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
 * @param {Object<string, string[]>} blocks
 * @return {string}
 */
function answer(blocks) {
    return Object.entries(blocks)
        .map(([block, lines]) => [`=== ${block}`, ...lines].join('\n'))
        .join('\n');
}

/**
 * @param {number} position
 * @return {object}
 */
function at(position) {
    return story[position - 1];
}

/**
 * @param {object} log
 * @param {string} answerText
 * @param {object[]} messages
 * @return {object}
 */
function apply(log, answerText, messages) {
    const parsed = ScribeAnswer.parse(answerText);
    assert.deepEqual(plain(parsed.refused), [], answerText);
    const result = ScribeLog.append(log, ScribeReplay.run(log, storyOrder), parsed.operations, {
        messages,
        origin: 'Story',
    });
    assert.deepEqual(plain(result.refused), [], answerText);
    return ScribeReplay.run(log, storyOrder);
}

/**
 * @param {object} log
 * @param {object} operation
 * @return {object}
 */
function ruled(log, operation) {
    ScribeLog.rule(log, ScribeReplay.run(log, storyOrder), operation);
    return ScribeReplay.run(log, storyOrder);
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
 * @return {Object<string, string>}
 */
function known(state) {
    const id = (text) => factSaying(state, text).id;
    return {
        mi: id('Mi'),
        age: id('34'),
        eyes: id('grey'),
        location: id('the mill'),
        hums: id('hums when nervous'),
        friends: id('sworn friends'),
        miller: id('owes him money'),
        lip: id('a split lip'),
        thinHair: id('red'),
        hair: id('red with grey at the temples'),
        smith: id('a smith'),
        guard: id('a guard'),
        skin: id('scarred by fire'),
        thinAbility: id('picks locks'),
        ability: id('picks locks with a bent pin'),
        status: id('wanted by the crown for desertion'),
        background: id('deserted at the siege'),
        thin: id('thinner than he looks'),
        ferry: id('a ferryman'),
        wolfric: id('Wolfric'),
        farm: id(longLocation),
        keeper: id(longRole),
        tamsinAge: id('29'),
        poison: id('poisoned her first husband'),
        broad: id('short and broad'),
        inn: id('the innkeeper'),
        black: id('black'),
        isoldeEyes: id('the colour of moss after rain'),
    };
}

/**
 * @param {object} state
 * @param {string} label
 * @return {string}
 */
function idOf(state, label) {
    const found = state.subjects.filter((subject) => subject.label === label);
    assert.equal(found.length, 1, `subjects labelled ${label}`);
    return found[0].id;
}

/**
 * @return {{ log: object, state: object }}
 */
function book() {
    const log = ScribeLog.create();
    const read = apply(log, answer({ SUBJECTS: cast, FACTS: facts, SCENES: scenes }), story.slice(0, 40));
    const hair = factSaying(read, 'red').id;
    const ability = factSaying(read, 'picks locks').id;
    const build = factSaying(read, 'thinner than he looks').id;
    const green = factSaying(read, 'green').id;
    const state = apply(
        log,
        answer({
            CHANGES: [
                `${hair} | Halvard | hair | FULLER: red with grey at the temples | #42`,
                `${ability} | Halvard | ability | FULLER: picks locks with a bent pin | #42`,
                `${green} | Isolde | eyes | FULLER: the colour of moss after rain | #42`,
            ],
            TOLD: [`${build} | Halvard | Mirelle | #41`, `${ability} | Halvard | Isolde | #41`],
            SCENES: ['Day 2 | #42-#43 | The yard | public | present: Halvard, Mirelle, Orla | They part'],
        }),
        story.slice(40, 43),
    );
    return { log, state };
}

/**
 * @param {string[]} labels
 * @return {{ log: object, state: object }}
 */
function subjectsOnly(labels) {
    const log = ScribeLog.create();
    const state = apply(
        log,
        answer({ SUBJECTS: labels.map((label) => `${label} | character`) }),
        story.slice(0, 1),
    );
    return { log, state };
}

test('a legacy decision requires a unique finding with saved passage and fact identities', () => {
    const { log, state } = book();
    apply(log, answer({ FACTS: [] }), story.slice(43, 51));
    const fact = factSaying(state, 'deserted at the siege');
    const speaker = idOf(state, 'Mirelle');
    const finding = (position) => ({ kind: 'Leak', message: at(position).id, fingerprint: at(position).fingerprint,
        subject: fact.subject, fact: fact.id, category: fact.category, book: fact.text, said: 'you deserted', speaker });
    const first = finding(50);
    const second = finding(51);
    const prints = new Map(story.map((message) => [message.id, message.fingerprint]));
    const ruling = ScribeLog.rule(log, ScribeReplay.run(log, storyOrder), { type: 'Widen', fact: fact.id, to: [speaker] });
    const replay = () => ScribeReplay.run(log, storyOrder, null, prints);
    assert.equal(ScribePedant.decisions(replay(), [first]).get(first), ruling.sequence);
    assert.equal(ScribePedant.decisions(replay(), [first, second]).size, 0);
    assert.equal(ScribePedant.decisions(replay(), [{ ...first, book: 'another secret' }]).size, 0);
    ScribeLog.revoke(log, ruling.sequence);
    assert.equal(ScribePedant.decisions(replay(), [first]).size, 0);
});

test('an older filed change settles the uniquely cited previous value', () => {
    const { log, state } = book();
    apply(log, answer({ FACTS: [] }), story.slice(43, 51));
    const fact = factSaying(state, 'grey');
    const note = ScribeAnswer.parse(answer({ CHANGES: [fact.id + ' | Halvard | eyes | blue | #50'] }));
    const saved = ScribeLog.append(log, ScribeReplay.run(log, storyOrder), note.operations, {
        messages: [at(50)], origin: 'Notes',
    });
    const finding = { kind: 'Contradiction', fact: fact.id, subject: fact.subject, category: fact.category,
        book: fact.text, said: 'blue', message: at(50).id, fingerprint: at(50).fingerprint };
    const prints = new Map(story.map((message) => [message.id, message.fingerprint]));
    const replayed = ScribeReplay.run(log, storyOrder, null, prints);
    assert.equal(ScribePedant.decisions(replayed, [finding]).get(finding), saved.entry.sequence);
    assert.equal(ScribePedant.decisions(replayed, [{ ...finding, message: at(51).id }]).size, 0);
    assert.equal(ScribePedant.decisions(replayed, [{ ...finding, said: 'brown' }]).size, 0);
});

test('revoking the first widening keeps both leaks settled while another widening still grants them', () => {
    const { log, state } = book();
    const fact = factSaying(state, 'picks locks with a bent pin');
    const prints = new Map(story.map((message) => [message.id, message.fingerprint]));
    const replay = () => ScribeReplay.run(log, storyOrder, null, prints);
    const leak = (speaker) => ({ kind: 'Leak', subject: fact.subject, fact: fact.id, category: fact.category,
        book: fact.text, message: at(54).id, fingerprint: at(54).fingerprint, said: 'You pick locks',
        speaker: idOf(state, speaker) });
    const mirelle = leak('Mirelle');
    const isolde = leak('Isolde');
    const widen = (finding, to) => {
        const before = replay();
        const entry = ScribeLog.rule(log, before, { type: 'Widen', fact: fact.id, to });
        ScribeLog.link(entry, before, [finding], story);
        return entry.sequence;
    };
    const first = widen(mirelle, [mirelle.speaker]);
    const second = widen(isolde, [mirelle.speaker, isolde.speaker]);
    assert.equal(ScribePedant.decisions(replay(), [mirelle, isolde]).size, 2);
    ScribeLog.revoke(log, first);
    assert.equal(ScribePedant.decisions(replay(), [mirelle, isolde]).size, 2);
    ScribeLog.revoke(log, second);
    assert.equal(ScribePedant.decisions(replay(), [mirelle, isolde]).size, 0);
});

/**
 * @param {Object<string, string[]>} blocks
 * @return {object}
 */
function smallBook(blocks) {
    return apply(ScribeLog.create(), answer(blocks), story.slice(0, 40));
}

/**
 * @param {string} text
 * @return {object}
 */
function narration(text) {
    const builder = new CampaignBuilder('Orla');
    builder.narrator(text);
    return ScribeIntake.read(builder.messages).messages[0];
}

/**
 * @param {object} finding
 * @return {Array<*>}
 */
function fields(finding) {
    return shape.map((name) => finding[name]);
}

/**
 * @param {string} fact
 * @param {string} label
 * @param {string} category
 * @param {string} said
 * @return {{ fact: string, label: string, category: string, said: string }}
 */
function contradiction(fact, label, category, said) {
    return { fact, label, category, said };
}

/**
 * @param {string} fact
 * @param {string} speaker
 * @param {string} words
 * @return {{ fact: string, speaker: string, words: string }}
 */
function leak(fact, speaker, words) {
    return { fact, speaker, words };
}

/**
 * @param {object} state
 * @param {object} message
 * @param {object[]} contradictions
 * @param {object[]} leaks
 * @param {object[]|null} unread
 * @return {readonly object[]}
 */
function check(state, message, contradictions, leaks = [], unread = null) {
    return ScribePedant.confirm(state, 'Orla', message, { contradictions, leaks }, unread ?? [message]);
}

/**
 * @param {object} state
 * @param {string} id
 * @param {object} fields
 * @return {object}
 */
function about(state, id, fields) {
    const fact = ScribeLog.lookup(state.facts, id);
    return {
        ...ScribePedant.Settings.Finding,
        kind: 'Contradiction',
        message: 'MESSAGE-50',
        position: 50,
        subject: fact.subject,
        label: ScribeLog.lookup(state.subjects, fact.subject).label,
        fact: id,
        category: fact.category,
        book: fact.text,
        said: 'unused',
        ...fields,
    };
}

/**
 * @param {*} reply
 * @return {{ calls: Array<[string, string]>, ask: function(string, string): Promise<*> }}
 */
function scriptedAsk(reply) {
    const calls = [];
    return {
        calls,
        ask: async (system, user) => {
            calls.push([system, user]);
            return reply;
        },
    };
}

/**
 * @param {object} state
 * @param {string} section
 * @param {object} message
 * @param {object[]} unread
 * @return {string}
 */
function sectionOf(state, section, message, unread) {
    const order = ['PLAYER CHARACTER:', 'LEDGER:', 'DOES NOT KNOW:', 'SINCE THE BOOK WAS LAST READ:', 'REPLY (#'];
    const text = ScribePedant.input(state, 'Orla', message, unread, []);
    const start = text.indexOf(`${section}\n`);
    const end = text.indexOf(`\n\n${order[order.indexOf(section) + 1]}`, start);
    assert.notEqual(start, -1, section);
    assert.notEqual(end, -1, section);
    return text.slice(start, end);
}

test('a near-miss name is flagged', () => {
    const { state } = subjectsOnly(['Aldric', 'Brandt', 'Orla']);
    const aldric = idOf(state, 'Aldric');
    const flagged = ScribePedant.spellings(state, narration('Aldrich bows to Aldric, and Aldrich waits by the gate.'));
    assert.deepEqual(plain(flagged.map(fields)), [
        ['Spelling', 'MESSAGE-1', 1, aldric, 'Aldric', null, null, null, null, null, null, 'Aldrich'],
    ]);
    assert.deepEqual(plain(Object.keys(flagged[0])), [...shape, 'looksLike']);
    assert.equal(flagged[0].looksLike, 'Aldric');
    assert.equal(ScribePedant.spellings(state, narration('Aldric bows.')).length, 0);
    assert.equal(ScribePedant.spellings(state, narration('Then aldrich bows.')).length, 0);
    const possessive = ScribePedant.spellings(state, narration('Aldrich’s cloak sways.'));
    assert.deepEqual(plain(possessive.map((finding) => [finding.subject, finding.written])), [[aldric, 'Aldrich']]);

    const short = subjectsOnly(['Kira', 'Orla']).state;
    const kiro = ScribePedant.spellings(short, narration('Kiro waits.'));
    assert.deepEqual(plain(kiro.map((finding) => [finding.label, finding.written])), [['Kira', 'Kiro']]);

    const both = subjectsOnly(['Aldric', 'Aldrich']).state;
    assert.equal(ScribePedant.spellings(both, narration('Aldrich bows to Aldric.')).length, 0);
    const twice = ScribePedant.spellings(both, narration('Aldrick bows.'));
    assert.deepEqual(plain(twice.map((finding) => [finding.label, finding.written])), [
        ['Aldric', 'Aldrick'],
        ['Aldrich', 'Aldrick'],
    ]);

    const named = subjectsOnly(['Isolde Corvane', 'Maren Corvane-Nonette']).state;
    const corvane = idOf(named, 'Isolde Corvane');
    const worded = ScribePedant.spellings(named, narration('Corvanne rides in. Isolde follows.'));
    assert.deepEqual(plain(worded.map((finding) => [finding.subject, finding.label, finding.written])), [
        [corvane, 'Isolde Corvane', 'Corvanne'],
    ]);
    const owned = narration("Corvane-Nonette’s horse and Corvane-Nonette's saddle wait.");
    assert.equal(ScribePedant.spellings(named, owned).length, 0);

    const merging = subjectsOnly(['Aldric', 'Brandt']);
    const merged = ruled(merging.log, {
        type: 'Merge',
        from: idOf(merging.state, 'Aldric'),
        into: idOf(merging.state, 'Brandt'),
    });
    const survivor = ScribePedant.spellings(merged, narration('Aldrich bows.'));
    assert.deepEqual(plain(survivor.map((finding) => [finding.subject, finding.label])), [
        [idOf(merged, 'Brandt'), 'Brandt'],
    ]);

    const aliased = smallBook({
        SUBJECTS: ['Brandt | character', 'Orla | character'],
        NAMES: ['Wolfric | Brandt | #3'],
        FACTS: ['Brandt | aka | Wolfric | hidden | #4'],
    });
    const spoken = ScribePedant.spellings(aliased, narration('Wolfrick waits.'));
    assert.deepEqual(plain(spoken.map((finding) => [finding.label, finding.written])), [['Brandt', 'Wolfrick']]);
});

test('a location is never a checkable contradiction', () => {
    const state = smallBook({
        SUBJECTS: cast,
        FACTS: [
            'Halvard | role | a guard | #7',
            'Halvard | location | the mill | #8',
            'Brandt | location | the cellar | hidden | #9',
        ],
    });
    const reply = at(50);
    const survey = ScribePedant.survey(state, 'Orla', reply, [reply]);
    const categories = (facts) => plain(facts.map((fact) => fact.category));
    assert.deepEqual(categories(survey.candidates), ['role']);
    assert.deepEqual(categories(survey.ledger), ['role', 'location']);
    assert.equal(survey.ledger.some((fact) => fact.text === 'the cellar'), true);
    assert.equal(survey.ledger.some((fact) => fact.text === 'the mill'), false);
    const mill = factSaying(state, 'the mill');
    assert.equal(check(state, reply, [contradiction(mill.id, 'Halvard', 'location', 'the tower')]).length, 0);
    const guard = factSaying(state, 'a guard');
    assert.equal(check(state, reply, [contradiction(guard.id, 'Halvard', 'role', 'a baker')]).length, 1);
});

test('the input shows the ledger and who does not know', () => {
    const { log, state } = book();
    const ids = known(state);
    const reply = at(50);
    const expected = [
        'PLAYER CHARACTER:',
        'Orla',
        '',
        'LEDGER:',
        `${ids.age} | Halvard | age | 34`,
        `${ids.eyes} | Halvard | eyes | grey`,
        `${ids.friends} | Halvard | relation to Isolde | sworn friends`,
        `${ids.miller} | Halvard | relation to the miller | owes him money`,
        `${ids.guard} | Halvard | role | a guard`,
        `${ids.skin} | Halvard | skin | scarred by fire`,
        `${ids.status} | Halvard | status | wanted by the crown for desertion (hidden)`,
        `${ids.background} | Halvard | background | deserted at the siege (hidden)`,
        `${ids.hair} | Halvard | hair | red with grey at the temples`,
        `${ids.ability} | Halvard | ability | picks locks with a bent pin (hidden)`,
        `${ids.inn} | Mirelle | role | the innkeeper`,
        `${ids.ferry} | Brandt | role | a ferryman`,
        `${ids.wolfric} | Brandt | aka | Wolfric (hidden)`,
        '',
        'DOES NOT KNOW:',
        `Mirelle does not know ${ids.status}`,
        `Mirelle does not know ${ids.background}`,
        `Mirelle does not know ${ids.ability}`,
        `Mirelle does not know ${ids.wolfric}`,
        '',
        'SINCE THE BOOK WAS LAST READ:',
        '(none)',
        '',
        'REPLY (#50):',
        `[#50] Brandt: ${narration50}`,
        `Mirelle: ${speech50}`,
        'Orla: We should go.',
    ].join('\n');
    assert.equal(ScribePedant.input(state, 'Orla', reply, [reply], []), expected);

    const twice = sectionOf(state, 'DOES NOT KNOW:', at(62), [at(62)]).split('\n').slice(1);
    assert.equal(twice.length > 0, true);
    assert.equal(new Set(twice).size, twice.length);

    const widened = ruled(log, { type: 'Widen', fact: ids.status, to: 'Everyone' });
    const lines = ScribePedant.input(widened, 'Orla', reply, [reply], []).split('\n');
    assert.equal(lines.includes(`${ids.status} | Halvard | status | wanted by the crown for desertion`), true);
    assert.deepEqual(
        lines.filter((line) => line.includes(' does not know ')),
        [ids.background, ids.ability, ids.wolfric].map((id) => `Mirelle does not know ${id}`),
    );

    const empty = subjectsOnly(['Halvard', 'Mirelle', 'Orla']).state;
    const bare = ScribePedant.input(empty, 'Orla', reply, [reply], []).split('\n\n');
    assert.deepEqual(bare.slice(0, 4), [
        'PLAYER CHARACTER:\nOrla',
        'LEDGER:\n(none)',
        'DOES NOT KNOW:\n(none)',
        'SINCE THE BOOK WAS LAST READ:\n(none)',
    ]);
});

test('the chat profile follows the player character when it was read, and is left out when not', async () => {
    const { state } = book();
    const reply = at(50);
    const profile = 'Orla is a sellsword from the north.\nShe owes Brandt a crossing.';
    const plainText = ScribePedant.input(state, 'Orla', reply, [reply], [], story);
    assert.equal(ScribePedant.input(state, 'Orla', reply, [reply], [], story, null), plainText);
    assert.equal(plainText.includes('PLAYER CHARACTER PROFILE:'), false);
    const profiled = ScribePedant.input(state, 'Orla', reply, [reply], [], story, profile);
    assert.equal(profiled.startsWith(`PLAYER CHARACTER:\nOrla\n\nPLAYER CHARACTER PROFILE:\n${profile}\n\nLEDGER:\n`), true);
    assert.equal(profiled.replace(`PLAYER CHARACTER PROFILE:\n${profile}\n\n`, ''), plainText);
    const asked = [];
    /**
     * @param {string} prompt
     * @param {string} input
     * @return {Promise<{ text: string, cost: number }>}
     */
    const ask = async (prompt, input) => {
        asked.push(input);
        return { text: '=== CONTRADICTIONS\n(none)', cost: 0 };
    };
    const request = { state, player: 'Orla', message: reply, unread: [reply], messages: story, ask };
    await ScribePedant.review({ ...request, profile });
    await ScribePedant.review({ ...request, profile: null });
    await ScribePedant.review(request);
    assert.equal(asked[0].includes(`PLAYER CHARACTER PROFILE:\n${profile}\n\nLEDGER:\n`), true);
    assert.equal(asked[0].replace(`PLAYER CHARACTER PROFILE:\n${profile}\n\n`, ''), asked[1]);
    assert.equal(asked[1], asked[2]);
    assert.equal(asked[1].includes('PLAYER CHARACTER PROFILE:'), false);
});

test('the answer is read', () => {
    const text = [
        'Here is what I found.',
        'F9 | Halvard | age | 40',
        '```text',
        '=== CONTRADICTIONS',
        '- F1 | Halvard | age | forty | or so',
        '**f5 | Halvard | relation to Isolde | bitter rivals**',
        '1. F2 | Halvard | eyes | green',
        'F3 | Halvard | location',
        'Halvard | age | 40 | more',
        `F3${zeroWidth} | Halvard | age | forty`,
        'none',
        '',
        '## Leaks ##',
        '(none yet)',
        '* F13 | Mirelle | you ran from the siege',
        'F12 | Mirelle',
        '```',
    ].join('\n');
    assert.deepEqual(plain(ScribePedant.parse(text)), {
        contradictions: [
            { fact: 'F1', label: 'Halvard', category: 'age', said: 'forty | or so' },
            { fact: 'F5', label: 'Halvard', category: 'relation to Isolde', said: 'bitter rivals' },
            { fact: 'F2', label: 'Halvard', category: 'eyes', said: 'green' },
            { fact: 'F3', label: 'Halvard', category: 'age', said: 'forty' },
        ],
        leaks: [{ fact: 'F13', speaker: 'Mirelle', words: 'you ran from the siege' }],
        misspellings: [],
        situations: [],
        now: [],
    });
    const dressed = ['**=== contradictions ===**', 'F7 | Mirelle | build | tall', '#LEAKS:', 'F8 | Orla | it'].join(
        '\r\n',
    );
    assert.deepEqual(plain(ScribePedant.parse(dressed)), {
        contradictions: [{ fact: 'F7', label: 'Mirelle', category: 'build', said: 'tall' }],
        leaks: [{ fact: 'F8', speaker: 'Orla', words: 'it' }],
        misspellings: [],
        situations: [],
        now: [],
    });
    for (const unreadable of ['', 'All of it agrees with the book.', null, 42]) {
        assert.deepEqual(plain(ScribePedant.parse(unreadable)), {
            contradictions: [],
            leaks: [],
            misspellings: [],
            situations: [],
            now: [],
        });
    }
});

test('the misspelling numbers are read', () => {
    const numbers = (text) => plain(ScribePedant.parse(text).misspellings);
    const lines = ['N1', 'n 2', '**N3**', '- N4', 'N007'];
    assert.deepEqual(numbers(['=== MISSPELLINGS', ...lines].join('\n')), [1, 2, 3, 4, 7]);
    for (const unreadable of ['N0', 'N-1', 'X5', 'N1 | Thessaly | Thessely', 'N', 'N1.5']) {
        assert.deepEqual(numbers(`=== MISSPELLINGS\n${unreadable}`), [], unreadable);
    }
    for (const dressed of ['`N3`', '[N3]', 'N3:', '*N3*', '**N3**', '#N3', 'N3.', 'N3,']) {
        assert.deepEqual(numbers(`=== MISSPELLINGS\n${dressed}`), [3], dressed);
    }
    for (const listed of ['N1, N3', 'N1 N3', 'N1; N3', 'N1 and N3', 'N1 AND N3', 'N1,N3']) {
        assert.deepEqual(numbers(`=== MISSPELLINGS\n${listed}`), [1, 3], listed);
    }
    const voided = [
        'N1 | no',
        'N2 | yes',
        'N1 | Nine Quarter | Fine',
        'N3 - note',
        'N3 (Thessely)',
        'N3: Thessely for Thessaly',
        'N1, N3 and Thessely',
        'N1, , N3',
        'Nine Quarter',
    ];
    for (const line of voided) {
        assert.deepEqual(numbers(`=== MISSPELLINGS\n${line}`), [], line);
    }
    const echoed = '=== MISSPELLINGS\nN2\nNAME CANDIDATES:\nN1 | Nine Quarter | Nine | Fine\nN2 | Thessaly | Thessaly | Thessely';
    assert.deepEqual(numbers(echoed), [2]);
    assert.deepEqual(numbers('=== MISSPELLING\nN4'), [4]);
    assert.deepEqual(numbers('MISSPELLING:\nN4'), [4]);
    assert.deepEqual(numbers('=== MISSPELLINGS\n(none)'), []);
    assert.deepEqual(numbers('=== MISSPELLINGS\nnone'), []);
    assert.deepEqual(numbers('N1\nN2'), []);
    assert.deepEqual(numbers('=== MISSPELLINGS\nF1 | Halvard | age | forty'), []);
    assert.deepEqual(numbers('=== MISSPELLINGS\n[N1], [N3]'), [1, 3]);
    assert.deepEqual(numbers('=== MISSPELLINGS\n[N1] [N3]'), [1, 3]);
    assert.deepEqual(numbers('=== MISSPELLINGS\nN3:'), [3]);

    const ids = known(book().state);
    const first = ScribePedant.parse(`=== MISSPELLINGS\nN2\n=== CONTRADICTIONS\n${ids.age} | Halvard | age | forty`);
    assert.deepEqual(plain(first.misspellings), [2]);
    assert.deepEqual(plain(first.contradictions.map((claim) => claim.fact)), [ids.age]);
    const last = ScribePedant.parse(
        [
            `=== LEAKS\n${ids.status} | Mirelle | You deserted`,
            `=== CONTRADICTIONS\n${ids.age} | Halvard | age | forty`,
            '=== MISSPELLINGS\nN5',
        ].join('\n'),
    );
    assert.deepEqual(plain(last.misspellings), [5]);
    assert.deepEqual(plain(last.leaks.map((claim) => claim.fact)), [ids.status]);
    assert.deepEqual(plain(last.contradictions.map((claim) => claim.fact)), [ids.age]);
});

test('a line that is not numbers ends the misspellings block', () => {
    const numbers = (text) => plain(ScribePedant.parse(text).misspellings);
    assert.deepEqual(numbers('=== MISSPELLINGS\nNone. These are ordinary words or new names:\nN1\nN3'), []);
    assert.deepEqual(numbers('=== MISSPELLINGS\nN2\nNone of the following are misspellings:\nN1\nN3\nN4\nN5'), [2]);
    for (const label of [
        '*Not misspellings:*',
        '_Not misspellings:_',
        '__Not misspellings:__',
        '`Not misspellings:`',
        '***Not misspellings:***',
    ]) {
        assert.deepEqual(numbers(`=== MISSPELLINGS\nN2\n${label}\n- N1\n- N3\n- N4\n- N5`), [2], label);
    }
    for (const label of ['**Not misspellings**', 'Not misspellings', 'Not misspellings\n---']) {
        assert.deepEqual(numbers(`=== MISSPELLINGS\nN2\n\n${label}\n- N1\n- N3`), [2], label);
    }
    assert.deepEqual(numbers('=== MISSPELLINGS\n(none)\nN1'), []);
    assert.deepEqual(numbers('=== MISSPELLINGS\n\nN2\n\nN3'), [2, 3]);
    assert.deepEqual(numbers('=== MISSPELLINGS\nN1\n=== NOT MISSPELLINGS\nN2\nN3\nN4\nN5'), [1]);
    assert.deepEqual(numbers('=== MISSPELLINGS\nN2\n\nNot misspellings:\n- N1\n- N3'), [2]);
    assert.deepEqual(numbers('=== MISSPELLINGS\nN2\n=== ORDINARY WORDS\nN1\nN3'), [2]);
    assert.deepEqual(numbers('=== MISSPELLINGS\nN2\nN1 | no\nN3'), [2]);
    assert.deepEqual(numbers('=== MISSPELLINGS\nN2\nsome prose here\nN3'), [2]);
    assert.deepEqual(numbers('=== MISSPELLINGS\nN2\n**Correct (not misspellings):**\n- N1'), [2]);
    assert.deepEqual(numbers('=== MISSPELLINGS\nN2\n## Ordinary words\nN1'), [2]);
    assert.deepEqual(numbers('=== MISSPELLINGS\nN2\n=== NOT MISSPELLINGS\nN1\n=== MISSPELLINGS\nN3'), [2, 3]);
    assert.deepEqual(numbers('=== MISSPELLINGS\nN3:'), [3]);
    assert.deepEqual(numbers('=== MISSPELLINGS\n#N3'), [3]);
    const ids = known(book().state);
    const after = ScribePedant.parse(
        `=== MISSPELLINGS\nN2\nNot misspellings:\nN1\n=== LEAKS\n${ids.status} | Mirelle | You deserted`,
    );
    assert.deepEqual(plain(after.misspellings), [2]);
    assert.deepEqual(plain(after.leaks.map((claim) => claim.fact)), [ids.status]);
});

test('a markdown heading ends the misspellings block', async () => {
    const numbers = (text) => plain(ScribePedant.parse(text).misspellings);
    const heading = '=== MISSPELLINGS\n## N1\nNot a misspelling: Fine is a new name.\n## N3\nMisspelling of Thessaly.';
    assert.deepEqual(numbers(heading), []);
    assert.deepEqual(numbers('=== MISSPELLINGS\n# N3'), []);
    assert.deepEqual(numbers('=== MISSPELLINGS\n###\tN3'), []);
    assert.deepEqual(numbers('=== MISSPELLINGS\nN2\n## N1\nN3'), [2]);
    assert.deepEqual(numbers('=== MISSPELLINGS\n#N3'), [3]);
    assert.deepEqual(numbers('### Misspellings\nN2'), [2]);
    const quarter = smallBook({ SUBJECTS: ['Nine Quarter | place', 'Thessaly | character', 'Orla | character'] });
    const reply = narration('Fine, said Thessely.');
    assert.equal((await reviewed(quarter, reply, heading)).length, 0);
});

test('an Oxford comma is one separator', () => {
    const numbers = (text) => plain(ScribePedant.parse(text).misspellings);
    assert.deepEqual(numbers('=== MISSPELLINGS\nN1, N3, and N5'), [1, 3, 5]);
    assert.deepEqual(numbers('=== MISSPELLINGS\nN1, N3, and N5\nN2'), [1, 3, 5, 2]);
    assert.deepEqual(numbers('=== MISSPELLINGS\nN1; N3; and N5'), [1, 3, 5]);
    assert.deepEqual(numbers('=== MISSPELLINGS\nN1, N3,\nand N5'), [1, 3]);
    assert.deepEqual(numbers('=== MISSPELLINGS\nN1, , N3'), []);
    assert.deepEqual(numbers('=== MISSPELLINGS\nN1, , N3\nN2'), []);
});

test('a checkbox line ends the misspellings block', () => {
    const numbers = (text) => plain(ScribePedant.parse(text).misspellings);
    assert.deepEqual(numbers('=== MISSPELLINGS\n- [x] N1\n- [ ] N2\n- [ ] N3\n- [ ] N4\n- [ ] N5'), []);
    assert.deepEqual(numbers('=== MISSPELLINGS\n- [X] N1\n[ ] N2\n[x] N3'), []);
    assert.deepEqual(numbers('=== MISSPELLINGS\nN1 [ ]\nN2 [x]\nN3 [X]'), []);
    assert.deepEqual(numbers('=== MISSPELLINGS\n[N3]'), [3]);
    assert.deepEqual(numbers('=== MISSPELLINGS\n- [N3]\n[ ] N1\nN2'), [3]);
    assert.deepEqual(numbers('=== MISSPELLINGS\n[N1] [N3]'), [1, 3]);
});

test('the prompt example confirms nothing', async () => {
    const most = ScribePedant.Settings.MostCandidates;
    const names = Array.from({ length: most }, (_, index) => `Name${String.fromCharCode(97 + index)}x`);
    const full = smallBook({ SUBJECTS: [...names.map((name) => `${name} | character`), 'Orla | character'] });
    const reply = narration(names.map((name) => `${name}y`).join(' and ') + ' wait.');
    assert.equal(ScribePedant.spellings(full, reply).length >= most, true);
    const template = promptLines
        .slice(promptLines.indexOf('=== CONTRADICTIONS'), promptLines.indexOf('N22') + 1)
        .join('\n');
    const example = ScribePedant.parse(template).misspellings;
    assert.equal(example.length > 0, true);
    assert.equal(
        example.every((number) => number > most),
        true,
    );
    assert.equal((await reviewed(full, reply, template)).length, 0);
});

test('dressed ids are read', () => {
    const text = [
        '=== CONTRADICTIONS',
        '`F4` | Halvard | age | forty',
        '[F4] | Halvard | age | forty',
        'F4: | Halvard | age | forty',
        '| F4 | Halvard | age | forty |',
        'F04 | Halvard | age | forty',
        '=== LEAKS',
        '`[F04]:` | Mirelle | You deserted',
    ].join('\n');
    const parsed = ScribePedant.parse(text);
    assert.deepEqual(
        plain(parsed.contradictions),
        Array.from({ length: 5 }, () => ({ fact: 'F4', label: 'Halvard', category: 'age', said: 'forty' })),
    );
    assert.deepEqual(plain(parsed.leaks), [{ fact: 'F4', speaker: 'Mirelle', words: 'You deserted' }]);

    const { state } = book();
    const ids = known(state);
    const tabled = ScribePedant.parse(`=== CONTRADICTIONS\n| \`${ids.age}\` | Halvard | age | forty |`);
    const found = ScribePedant.confirm(state, 'Orla', at(50), tabled, [at(50)]);
    assert.deepEqual(plain(found.map((finding) => [finding.fact, finding.said])), [[ids.age, 'forty']]);
});

test('dressed words are read', () => {
    const { state } = book();
    const ids = known(state);
    const reply = at(50);
    const forms = ['"forty"', 'forty...', 'forty…', '“forty”', '"forty"...', '"forty..."', '*forty*', '...forty'];
    for (const said of [...forms, '**forty**', '_forty_', '`forty`', '…forty', '"*forty*"...']) {
        const found = check(state, reply, [contradiction(ids.age, 'Halvard', 'age', said)]);
        assert.deepEqual(plain(found.map((finding) => finding.said)), ['forty'], said);
    }
    const tabbed = check(state, reply, [contradiction(ids.age, 'Halvard', 'age', 'forty\tnow')]);
    assert.deepEqual(plain(tabbed.map((finding) => finding.said)), ['forty now']);
    const curly = check(state, reply, [contradiction(ids.guard, 'Halvard', 'role', "He's a baker")]);
    assert.deepEqual(plain(curly.map((finding) => finding.said)), ["He's a baker"]);
    const quoted = check(state, reply, [], [leak(ids.status, 'Mirelle', '“You deserted”')]);
    assert.deepEqual(plain(quoted.map((finding) => finding.said)), ['You deserted']);
    const bold = ScribePedant.parse(`=== CONTRADICTIONS\n**${ids.age}** | **Halvard** | **age** | forty`);
    assert.deepEqual(plain(bold.contradictions.map((claim) => claim.fact)), [ids.age]);
    assert.equal(ScribePedant.confirm(state, 'Orla', reply, bold, [reply]).length, 1);
    const underlined = ScribePedant.parse(`=== CONTRADICTIONS\n_${ids.age}_ | _Halvard_ | _age_ | forty`);
    assert.equal(ScribePedant.confirm(state, 'Orla', reply, underlined, [reply]).length, 1);
    const marked = ScribePedant.parse(`=== LEAKS\n${ids.status} | _Mirelle_ | You deserted`);
    assert.equal(ScribePedant.confirm(state, 'Orla', reply, marked, [reply]).length, 1);
});

test('only single-valued facts can be contradicted', () => {
    const { state } = book();
    const ids = known(state);
    const reply = at(50);
    const ledger = sectionOf(state, 'LEDGER:', reply, [reply]);
    for (const category of ['trait', 'condition']) {
        assert.equal(ledger.includes(` | ${category} | `), false, category);
    }
    assert.equal(check(state, reply, [contradiction(ids.hums, 'Halvard', 'trait', 'whistles when nervous')]).length, 0);
    assert.equal(check(state, reply, [contradiction(ids.lip, 'Halvard', 'condition', 'a black eye')]).length, 0);
    const kept = check(state, reply, [
        contradiction(ids.age, 'Halvard', 'age', 'forty'),
        contradiction(ids.inn, 'Mirelle', 'role', 'the tower'),
    ]);
    assert.deepEqual(plain(kept.map((finding) => finding.fact)), [ids.age, ids.inn]);
});

test('a thinner wording is not a contradiction', () => {
    const { state } = book();
    const ids = known(state);
    const reply = at(50);
    assert.equal(factSaying(state, 'red').status, 'Replaced');
    assert.equal(check(state, reply, [contradiction(ids.hair, 'Halvard', 'hair', 'red')]).length, 0);
    const black = check(state, reply, [contradiction(ids.hair, 'Halvard', 'hair', 'black')]);
    assert.deepEqual(plain(black.map((finding) => [finding.fact, finding.said])), [[ids.hair, 'black']]);
});

test("a contradiction that names the book's value stays", () => {
    const { state } = book();
    const ids = known(state);
    const reply = at(68);
    const said = (fact, label, category, words) =>
        plain(check(state, reply, [contradiction(fact, label, category, words)]).map((finding) => finding.said));
    assert.deepEqual(said(ids.eyes, 'Halvard', 'eyes', 'not grey but blue'), ['not grey but blue']);
    assert.deepEqual(said(ids.hair, 'Halvard', 'hair', 'red, now black'), ['red, now black']);
    assert.deepEqual(said(ids.hair, 'Halvard', 'hair', 'red'), []);
    assert.deepEqual(said(ids.hair, 'Halvard', 'hair', 'grey at the temples'), []);
    assert.equal(factSaying(state, 'green').status, 'Replaced');
    assert.deepEqual(said(ids.isoldeEyes, 'Isolde', 'eyes', 'green'), []);
});

test('a word is a word', () => {
    const found = (text, words) => ScribePedant.claimed(words, [ScribePedant.folded(text)]);
    const acute = String.fromCodePoint(0x301);
    assert.equal(found('a tender heart', 'ten'), null);
    assert.equal(found('he turns to listen', 'ten'), null);
    assert.equal(found('he is 34 winters old', '4'), null);
    assert.equal(found("it's so", 's'), null);
    assert.equal(found('it’s so', 's'), null);
    assert.equal(found("it's so", 'it'), null);
    assert.equal(found("the guards' horses", 'guards'), 'guards');
    assert.equal(found(`the cafe${acute} is open`, 'cafe'), null);
    assert.equal(found('the café is open', `cafe${acute}`), `cafe${acute}`);
    assert.equal(found(`the coq${acute} crows`, 'coq'), null);
    assert.equal(found(`ten${astral} more`, 'ten'), null);
    assert.equal(found(`the ${astral}'s and the`, 's'), null);
    assert.equal(found('ten years', 'ten'), 'ten');
    assert.equal(found('a ten-year-old horse', 'year'), 'year');
});

test('each kind has its own twenty', () => {
    const lines = [];
    for (let number = 1; number <= 25; number++) {
        lines.push(`Halvard | relation to the stranger ${number} | trusts him | #${number}`);
    }
    const state = smallBook({
        SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Orla | character'],
        FACTS: [
            ...lines,
            'Halvard | status | wanted for desertion | hidden | #26',
            'Halvard | trait | lies to everyone | hidden | #27',
            'Halvard | background | stole a horse | hidden | #28',
        ],
        SCENES: ['Day 1 | #1-#40 | The hall | public | present: Halvard, Orla | They meet'],
    });
    const relations = state.facts.filter((fact) => fact.category === 'relation' && fact.status === 'InForce');
    assert.equal(relations.length, 25);
    const claims = relations.map((fact) =>
        contradiction(fact.id, 'Halvard', `relation to ${fact.targetText}`, 'hates them all'),
    );
    const leaks = [
        leak(factSaying(state, 'wanted for desertion').id, 'Mirelle', 'You deserted'),
        leak(factSaying(state, 'lies to everyone').id, 'Mirelle', 'you lied'),
        leak(factSaying(state, 'stole a horse').id, 'Mirelle', 'you stole'),
    ];
    const found = check(state, at(72), claims, leaks);
    const counts = { Contradiction: 0, Leak: 0 };
    for (const finding of found) {
        counts[finding.kind] += 1;
    }
    assert.deepEqual(counts, { Contradiction: 20, Leak: 3 });
});

test('empty words confirm nothing', () => {
    const { state } = book();
    const ids = known(state);
    const reply = at(50);
    for (const words of ['', '...', '…', '""', '**']) {
        assert.equal(check(state, reply, [], [leak(ids.status, 'Mirelle', words)]).length, 0, words);
    }
    assert.equal(check(state, reply, [], [leak(ids.status, 'Mirelle', 'You deserted')]).length, 1);
});

test("a speaker's second leak is kept", () => {
    const { state } = book();
    const ids = known(state);
    const found = check(state, at(50), [], [
        leak(ids.status, 'Mirelle', 'You deserted'),
        leak(ids.background, 'Mirelle', 'you ran at the siege'),
    ]);
    assert.deepEqual(plain(found.map((finding) => [finding.fact, finding.speakerLabel])), [
        [ids.status, 'Mirelle'],
        [ids.background, 'Mirelle'],
    ]);
});

test('a missing speaker is spent, not a crash', () => {
    const { state } = book();
    const ids = known(state);
    const finding = about(state, ids.status, {
        kind: 'Leak',
        said: 'You deserted',
        speaker: 'S99',
        speakerLabel: 'Mirelle',
    });
    assert.equal(ScribeLog.lookup(state.subjects, 'S99'), undefined);
    assert.equal(ScribePedant.spent(state, finding), true);
    assert.equal(ScribePedant.told(state, finding), null);
});

test('a label is the same only letter for letter', () => {
    /**
     * @param {string[]} labels
     * @return {object}
     */
    function bookOf(labels) {
        return smallBook({
            SUBJECTS: ['Halvard', ...labels, 'Orla'].map((label) => `${label} | character`),
            FACTS: ['Halvard | status | wanted for desertion | hidden | #5'],
        });
    }

    const pairs = [
        ['Zoë', 'Zoe', 69],
        ['Grey', 'Gray', 70],
        ['Kira (the smith)', 'Kira the smith', 71],
    ];
    for (const [first, second, position] of pairs) {
        const original = bookOf([first, second]);
        const status = factSaying(original, 'wanted for desertion').id;
        const [found] = check(original, at(position), [], [leak(status, first, 'You deserted')]);
        assert.notEqual(found, undefined, first);
        assert.equal(found.speakerLabel, first);
        const swapped = bookOf([second, first]);
        assert.equal(ScribeLog.lookup(swapped.subjects, found.speaker).label, second);
        assert.equal(ScribePedant.spent(swapped, found), true, first);
        assert.equal(ScribePedant.told(swapped, found), null, first);
        const same = bookOf([first, second]);
        assert.equal(ScribePedant.spent(same, found), false, first);
        assert.notEqual(ScribePedant.told(same, found), null, first);
    }
});

test('a contradiction must check out', () => {
    const { state } = book();
    const ids = known(state);
    const reply = at(50);
    const halvard = idOf(state, 'Halvard');
    assert.equal(factSaying(state, 'a smith').status, 'Replaced');
    assert.deepEqual(plain(state.conflicts.map((conflict) => conflict.established)), [ids.black]);

    const confirmed = check(state, reply, [contradiction(ids.age, 'Halvard', 'age', 'forty')]);
    assert.deepEqual(plain(confirmed.map(fields)), [
        ['Contradiction', 'MESSAGE-50', 50, halvard, 'Halvard', ids.age, 'age', '34', 'forty', null, null, null],
    ]);
    const variants = check(state, reply, [
        contradiction(ids.age, 'halvard', 'Age', 'FORTY'),
        contradiction(ids.friends, 'Halvard', 'relation to Isolde', 'bitter rivals'),
        contradiction(ids.inn, 'Mi', 'role', 'the tower'),
    ]);
    assert.deepEqual(plain(variants.map((finding) => [finding.fact, finding.category, finding.said])), [
        [ids.age, 'age', 'FORTY'],
        [ids.friends, 'relation', 'bitter rivals'],
        [ids.inn, 'role', 'the tower'],
    ]);

    const dropped = {
        'an unknown fact id': contradiction('F999', 'Halvard', 'age', 'forty'),
        'a Replaced fact': contradiction(ids.smith, 'Halvard', 'role', 'a baker'),
        'a contested fact': contradiction(ids.black, 'Brandt', 'hair', 'red'),
        'a label of another subject': contradiction(ids.age, 'Isolde', 'age', 'forty'),
        'another category': contradiction(ids.age, 'Halvard', 'eyes', 'forty'),
        'a category that is no category': contradiction(ids.age, 'Halvard', 'years', 'forty'),
        'the same words': contradiction(ids.age, 'Halvard', 'age', '34'),
        'an empty said': contradiction(ids.age, 'Halvard', 'age', ''),
        'a said without a letter or digit': contradiction(ids.age, 'Halvard', 'age', '...'),
    };
    for (const [name, claim] of Object.entries(dropped)) {
        assert.equal(check(state, reply, [claim]).length, 0, name);
    }
});

test("the reply's words are the reply's", () => {
    const { state } = book();
    const ids = known(state);
    const reply = at(50);
    const said = (message, words) => check(state, message, [contradiction(ids.age, 'Halvard', 'age', words)]);
    assert.equal(said(reply, '50').length, 0);
    assert.equal(said(reply, '#50').length, 0);
    assert.equal(check(state, reply, [contradiction(ids.guard, 'Halvard', 'role', 'Orla')]).length, 0);
    assert.equal(said(reply, 'He deserted the army once. You look tired').length, 0);
    assert.equal(said(at(49), 'ten').length, 0);
    assert.deepEqual(plain(said(reply, 'ten').map((finding) => finding.said)), ['ten']);
    assert.deepEqual(plain(said(reply, 'ten years').map((finding) => finding.said)), ['ten years']);
    assert.equal(ScribePedant.holds('listen to ten bells', 'ten'), true);
    assert.equal(ScribePedant.holds('listen often', 'ten'), false);
});

test('hidden facts are never contradicted, and only hidden facts leak', () => {
    const { state } = book();
    const ids = known(state);
    const reply = at(50);
    assert.equal(check(state, reply, [contradiction(ids.status, 'Halvard', 'status', 'pardoned')]).length, 0);
    const unknown = sectionOf(state, 'DOES NOT KNOW:', reply, [reply]);
    assert.equal(unknown.includes(ids.skin), false);
    assert.equal(unknown.includes(ids.ferry), false);
    assert.equal(ScribeKnowledge.knows(state, idOf(state, 'Mirelle'), factSaying(state, 'scarred by fire')), false);
    assert.equal(check(state, reply, [], [leak(ids.skin, 'Mirelle', 'You look tired')]).length, 0);
    assert.equal(check(state, reply, [], [leak(ids.ferry, 'Mirelle', 'Brandt is a ferryman')]).length, 0);
    const plainLeak = about(state, ids.skin, {
        kind: 'Leak',
        said: 'You look tired',
        speaker: idOf(state, 'Mirelle'),
        speakerLabel: 'Mirelle',
    });
    assert.equal(ScribePedant.spent(state, plainLeak), true);
    assert.equal(ScribePedant.told(state, plainLeak), null);
    assert.equal(unknown.includes(`Mirelle does not know ${ids.background}`), true);
    const background = check(state, reply, [], [leak(ids.background, 'Mirelle', 'you ran at the siege')]);
    assert.deepEqual(plain(background.map((finding) => [finding.fact, finding.category])), [
        [ids.background, 'background'],
    ]);
});

test('a leak must check out', () => {
    const { state } = book();
    const ids = known(state);
    const reply = at(50);
    const halvard = idOf(state, 'Halvard');
    const mirelle = idOf(state, 'Mirelle');
    const claim = leak(ids.status, 'Mirelle', 'You deserted');
    const confirmed = check(state, reply, [], [claim], [at(44), reply]);
    assert.deepEqual(plain(confirmed.map(fields)), [
        [
            'Leak',
            'MESSAGE-50',
            50,
            halvard,
            'Halvard',
            ids.status,
            'status',
            'wanted by the crown for desertion',
            'You deserted',
            mirelle,
            'Mirelle',
            null,
        ],
    ]);
    assert.equal(check(state, at(51), [], [claim]).length, 1);

    const dropped = [
        ['she was told', leak(ids.thin, 'Mirelle', 'so thin'), reply],
        ['the fact is known to Everyone', leak(ids.age, 'Mirelle', 'You look tired'), reply],
        ['the speaker is the fact own subject', leak(ids.status, 'Halvard', 'I never ran'), at(51)],
        ['the speaker is the player character', leak(ids.status, 'Orla', 'We should go'), reply],
        ['she is not a speaker of the reply', leak(ids.status, 'Mirelle', 'you deserted'), at(52)],
        ['the speaker is unknown', leak(ids.status, 'Kira', 'You deserted'), reply],
        ['the speaker is a subject who does not speak', leak(ids.status, 'Tamsin', 'You deserted'), reply],
        ['the fact is unknown', leak('F999', 'Mirelle', 'You deserted'), reply],
    ];
    for (const [name, item, message] of dropped) {
        assert.equal(check(state, message, [], [item]).length, 0, name);
    }
});

test("a leak must be in the speaker's own mouth", () => {
    const { state } = book();
    const ids = known(state);
    const reply = at(50);
    assert.equal(check(state, reply, [], [leak(ids.status, 'Mirelle', 'He deserted the army')]).length, 0);
    assert.equal(check(state, reply, [], [leak(ids.status, 'Mirelle', 'We should go')]).length, 0);
    assert.equal(check(state, reply, [], [leak(ids.status, 'Mirelle', 'You deserted')]).length, 1);
});

test("narration under a speaker's name is not their mouth", () => {
    const { state } = book();
    const ids = known(state);
    const reply = at(61);
    assert.equal(reply.blocks[0].role, 'Narrator');
    assert.equal(reply.blocks[0].speaker, 'Mirelle');
    assert.equal(check(state, reply, [], [leak(ids.status, 'Mirelle', 'Mirelle knows he deserted')]).length, 0);
    assert.equal(check(state, reply, [], [leak(ids.status, 'Mirelle', 'Good evening')]).length, 1);
});

test('a thinner wording known is known', () => {
    const { state } = book();
    const ids = known(state);
    const pair = at(54);
    const isolde = idOf(state, 'Isolde');
    assert.equal(ScribeKnowledge.knows(state, isolde, factSaying(state, 'picks locks with a bent pin')), false);
    assert.equal(ScribeKnowledge.knows(state, isolde, factSaying(state, 'picks locks')), true);
    const unknown = sectionOf(state, 'DOES NOT KNOW:', pair, [pair]);
    assert.equal(unknown.includes(`Mirelle does not know ${ids.ability}`), true);
    assert.equal(unknown.includes(`Isolde does not know ${ids.status}`), true);
    assert.equal(unknown.includes(`Isolde does not know ${ids.ability}`), false);
    assert.equal(check(state, pair, [], [leak(ids.ability, 'Isolde', 'You pick locks')]).length, 0);
    assert.equal(check(state, pair, [], [leak(ids.ability, 'Mirelle', 'You pick locks')]).length, 1);
    const against = about(state, ids.ability, {
        kind: 'Leak',
        message: 'MESSAGE-54',
        position: 54,
        said: 'You pick locks',
        speaker: isolde,
        speakerLabel: 'Isolde',
    });
    assert.equal(ScribePedant.spent(state, against), true);
    assert.equal(ScribePedant.told(state, against), null);
});

test('all the unread is shown or no leak is raised', () => {
    const { state } = book();
    const ids = known(state);
    const reply = at(50);
    const since = 'SINCE THE BOOK WAS LAST READ:';
    assert.equal(sectionOf(state, since, reply, [reply]), `${since}\n(none)`);
    assert.equal(
        sectionOf(state, since, reply, [at(46), at(44), reply, at(45)]),
        `${since}\n${ScribeIntake.transcript([at(44), at(45), at(46)])}`,
    );
    const many = story.slice(10, 49);
    assert.equal(many.length, 39);
    assert.equal(sectionOf(state, since, reply, [...many, reply]), `${since}\n${ScribeIntake.transcript(many)}`);

    const named = [at(45), at(46), reply];
    const unknown = sectionOf(state, 'DOES NOT KNOW:', reply, named);
    assert.equal(unknown.includes(`Mirelle does not know ${ids.status}`), true);
    assert.equal(check(state, reply, [], [leak(ids.status, 'Mirelle', 'You deserted')], named).length, 1);

    const later = at(66);
    const deserted = leak(ids.status, 'Mirelle', 'You deserted');
    const flood = [at(63), later];
    assert.equal(Array.from(ScribeIntake.transcript([at(63)])).length > 60000, true);
    assert.equal(sectionOf(state, since, later, flood), `${since}\n(too long to show)`);
    assert.equal(sectionOf(state, 'DOES NOT KNOW:', later, flood), 'DOES NOT KNOW:\n(none)');
    assert.equal(sectionOf(state, 'LEDGER:', later, flood).includes('(hidden)'), false);
    assert.equal(check(state, later, [], [deserted], flood).length, 0);
    assert.equal(check(state, later, [contradiction(ids.age, 'Halvard', 'age', 'forty')], [], flood).length, 1);

    const exact = ScribeIntake.transcript([at(64)]);
    assert.equal(exact.startsWith(exactPrefix), true);
    assert.equal(Array.from(exact).length, 60000);
    assert.equal(check(state, later, [], [deserted], [at(64), later]).length, 1);
    const wide = ScribeIntake.transcript([at(65)]);
    assert.deepEqual([Array.from(wide).length < 60000, wide.length > 60000], [true, true]);
    assert.equal(check(state, later, [], [deserted], [at(65), later]).length, 1);
});

test('only what came before the reply is shown', () => {
    const { state } = book();
    const ids = known(state);
    const since = 'SINCE THE BOOK WAS LAST READ:';
    const reply = at(50);
    assert.equal(
        sectionOf(state, since, reply, [at(44), reply, at(52)]),
        `${since}\n${ScribeIntake.transcript([at(44)])}`,
    );
    const later = at(66);
    const shown = sectionOf(state, since, later, [at(46), later, at(67)]);
    assert.equal(shown, `${since}\n${ScribeIntake.transcript([at(46)])}`);
    assert.equal(shown.includes('I deserted at the siege'), false);
    assert.equal(sectionOf(state, since, later, [later, at(67)]), `${since}\n(none)`);
    assert.equal(check(state, later, [], [leak(ids.status, 'Mirelle', 'You deserted')], [later, at(67)]).length, 1);
});

test('only what was shown can be claimed', () => {
    const { state } = book();
    const ids = known(state);
    const reply = at(50);
    assert.equal(factSaying(state, '29').status, 'InForce');
    assert.equal(sectionOf(state, 'LEDGER:', reply, [reply]).includes(ids.tamsinAge), false);
    assert.equal(check(state, reply, [contradiction(ids.tamsinAge, 'Tamsin', 'age', '31')]).length, 0);
    const poison = leak(ids.poison, 'Mirelle', 'She poisoned her first husband');
    assert.equal(check(state, reply, [], [poison]).length, 0);
    assert.equal(factSaying(state, 'poisoned her first husband').status, 'InForce');
});

test('a relation is checked against its target', () => {
    const { state } = book();
    const ids = known(state);
    const reply = at(50);
    const rivals = (written) => check(state, reply, [contradiction(ids.friends, 'Halvard', written, 'bitter rivals')]);
    const square = (written) => check(state, reply, [contradiction(ids.miller, 'Halvard', written, 'square with him')]);
    assert.equal(rivals('relation to Brandt').length, 0);
    assert.equal(rivals('relation to Isolde').length, 1);
    assert.equal(rivals('toward Isolde').length, 1);
    assert.equal(square('relation to the miller').length, 1);
    assert.equal(square('relation to the baker').length, 0);

    const healer = smallBook({
        SUBJECTS: ['Halvard | character', 'Isolde (the healer) | character', 'Orla | character'],
        FACTS: ['Halvard | relation to Isolde | sworn friends | #5'],
        SCENES: ['Day 1 | #1-#40 | The hall | public | present: Halvard, Orla | They meet'],
    });
    const friends = factSaying(healer, 'sworn friends');
    assert.equal(friends.target, idOf(healer, 'Isolde (the healer)'));
    const byLabel = contradiction(friends.id, 'Halvard', 'relation to Isolde (the healer)', 'bitter rivals');
    assert.equal(check(healer, reply, [byLabel]).length, 1);
});

test('the claimed words must be in the reply', () => {
    const { state } = book();
    const ids = known(state);
    const north = at(56);
    const said = (words) => check(state, north, [contradiction(ids.guard, 'Halvard', 'role', words)]);
    assert.equal(said('the harbour').length, 0);
    assert.deepEqual(plain(said('THE   NORTH GATE').map((finding) => finding.said)), ['THE NORTH GATE']);
    for (const words of ['at [Scribe] dawn', 'dawn @: twice', 'twice | maybe', `north${separator}gate`]) {
        assert.equal(said(words).length, 0, words);
    }
    const fitting = longLine.slice(0, 120);
    const over = longLine.slice(0, 121);
    assert.deepEqual([fitting.length, over.length, over.at(-1)], [120, 121, '!']);
    assert.equal(said(fitting).length, 1);
    assert.equal(said(over).length, 0);
    const reply = at(50);
    assert.equal(check(state, reply, [], [leak(ids.status, 'Mirelle', 'you   DESERTED')]).length, 1);
    assert.equal(check(state, reply, [], [leak(ids.status, 'Mirelle', 'you fled')]).length, 0);
});

test('family names and dismissed names', () => {
    const { state } = book();
    assert.equal(ScribePedant.spellings(state, at(57)).length, 0);
    const [first] = ScribePedant.spellings(state, at(53));
    const [second] = ScribePedant.spellings(state, at(58));
    assert.deepEqual(plain([first.written, second.written, first.message, second.message]), [
        'Halvart',
        'Halvart',
        'MESSAGE-53',
        'MESSAGE-58',
    ]);
    assert.equal(ScribePedant.key(first), ScribePedant.key(second));
    const spelled = ScribePedant.spellings(state, at(59));
    assert.deepEqual(plain(spelled.map((finding) => [finding.written, finding.label])), [['Brandtt', 'Brandt']]);
});

test('review joins both and passes a failed model call on', async () => {
    const { state } = book();
    const ids = known(state);
    const reply = at(53);
    const unread = [reply];
    const text = answer({
        CONTRADICTIONS: [`${ids.age} | Halvard | age | forty`],
        LEAKS: [`${ids.status} | Mirelle | You deserted`],
        MISSPELLINGS: ['N1'],
    });
    const good = scriptedAsk({ text });
    const reviewedBoth = await ScribePedant.review({ state, player: 'Orla', message: reply, unread, ask: good.ask });
    const found = reviewedBoth.findings;
    assert.deepEqual(plain(reviewedBoth.notes), []);
    assert.deepEqual(plain(found.map((finding) => [finding.kind, finding.written ?? finding.fact])), [
        ['Contradiction', ids.age],
        ['Leak', ids.status],
        ['Spelling', 'Halvart'],
    ]);
    assert.equal(good.calls.length, 1);
    assert.equal(good.calls[0][0], ScribePedant.Prompt);
    const candidates = ScribePedant.spellings(state, reply);
    assert.equal(good.calls[0][1], ScribePedant.input(state, 'Orla', reply, unread, candidates));

    const failing = async () => {
        throw new Error('the model is down');
    };
    await assert.rejects(
        ScribePedant.review({ state, player: 'Orla', message: reply, unread, ask: failing }),
        /the model is down/u,
    );
    const answers = [{ text: 'All of it agrees with the book.' }, { text: '' }, { text: null }];
    for (const [index, given] of answers.entries()) {
        const ask = scriptedAsk(given).ask;
        const kept = await ScribePedant.review({ state, player: 'Orla', message: reply, unread, ask });
        assert.deepEqual(plain(kept), { findings: [], notes: [] }, `${index}`);
    }

    const played = scriptedAsk({ text });
    const own = at(47);
    assert.equal(own.fromPlayer, true);
    const none = await ScribePedant.review({ state, player: 'Orla', message: own, unread: [own], ask: played.ask });
    assert.deepEqual(plain(none), { findings: [], notes: [] });
    assert.equal(played.calls.length, 0);

    const empty = subjectsOnly(['Halvard', 'Mirelle', 'Orla']).state;
    const idle = scriptedAsk({ text: answer({ MISSPELLINGS: ['N1'] }) });
    const alone = await ScribePedant.review({ state: empty, player: 'Orla', message: reply, unread, ask: idle.ask });
    assert.deepEqual(plain(alone.findings.map((finding) => finding.kind)), ['Spelling']);
    assert.equal(idle.calls.length, 1);
    assert.equal(idle.calls[0][1].includes('NAME CANDIDATES:\nN1 | Halvard | Halvard | Halvart'), true);

    const quiet = narration('Rain falls on the roofs.');
    const silent = scriptedAsk({ text });
    const nothing = await ScribePedant.review({
        state: empty,
        player: 'Orla',
        message: quiet,
        unread: [quiet],
        ask: silent.ask,
    });
    assert.equal(nothing.findings.length, 0);
    assert.equal(silent.calls.length, 1);
    assert.equal(silent.calls[0][1].includes('NAME CANDIDATES:'), false);
});

/**
 * @param {object} candidate
 * @return {object}
 */
function withoutLook(candidate) {
    const { looksLike, ...finding } = candidate;
    return finding;
}

/**
 * @param {object} state
 * @param {object} message
 * @param {string} text
 * @return {Promise<readonly object[]>}
 */
async function reviewed(state, message, text) {
    const result = await ScribePedant.review({
        state,
        player: 'Orla',
        message,
        unread: [message],
        ask: scriptedAsk({ text }).ask,
    });
    return result.findings;
}

test('the model judges which candidates are misspellings', async () => {
    const quarter = smallBook({ SUBJECTS: ['Nine Quarter | place', 'Thessaly | character', 'Orla | character'] });
    const reply = narration('Fine, said Thessely.');
    const candidates = ScribePedant.spellings(quarter, reply);
    assert.deepEqual(plain(candidates.map((finding) => [finding.label, finding.written])), [
        ['Nine Quarter', 'Fine'],
        ['Thessaly', 'Thessely'],
    ]);

    const second = await reviewed(quarter, reply, 'MISSPELLINGS\nN2');
    assert.deepEqual(plain(second.map((finding) => [finding.kind, finding.label, finding.written])), [
        ['Spelling', 'Thessaly', 'Thessely'],
    ]);
    assert.deepEqual(plain(second[0]), plain(withoutLook(candidates[1])));

    assert.equal((await reviewed(quarter, reply, 'All of it is spelt right.')).length, 0);
    assert.equal((await reviewed(quarter, reply, '=== MISSPELLINGS\n(none)')).length, 0);

    const odd = await reviewed(quarter, reply, '=== MISSPELLINGS\nN9\nN2\nN2\nN0');
    assert.deepEqual(plain(odd.map((finding) => finding.written)), ['Thessely']);

    const both = await reviewed(quarter, reply, '=== MISSPELLINGS\nN2\nN1');
    assert.deepEqual(plain(both.map((finding) => finding.written)), ['Fine', 'Thessely']);
});

test('the model answers contradictions and no misspellings', async () => {
    const { state } = book();
    const ids = known(state);
    const reply = at(53);
    const text = answer({ CONTRADICTIONS: [`${ids.age} | Halvard | age | forty`] });
    const found = await reviewed(state, reply, text);
    assert.deepEqual(plain(found.map((finding) => [finding.kind, finding.fact])), [['Contradiction', ids.age]]);
});

test('every confirmed candidate is a finding, with no cap between them', async () => {
    const twins = smallBook({ SUBJECTS: ['Aldric | character', 'Aldrich | character', 'Orla | character'] });
    const reply = narration('Aldrick bows.');
    assert.equal(ScribePedant.spellings(twins, reply).length, 2);
    const found = await reviewed(twins, reply, '=== MISSPELLINGS\nN1\nN2');
    assert.deepEqual(plain(found.map((finding) => [finding.label, finding.written])), [
        ['Aldric', 'Aldrick'],
        ['Aldrich', 'Aldrick'],
    ]);
    const first = await reviewed(twins, reply, '=== MISSPELLINGS\nN1');
    assert.deepEqual(plain(first.map((finding) => finding.label)), ['Aldric']);
});

test('at most twenty candidates are sent', async () => {
    const names = Array.from({ length: 25 }, (_, index) => `Name${String.fromCharCode(97 + index)}x`);
    const book25 = smallBook({ SUBJECTS: [...names.map((name) => `${name} | character`), 'Orla | character'] });
    const typos = names.map((name) => `${name}y`);
    const reply = narration(typos.join(' and ') + ' wait.');
    assert.equal(ScribePedant.spellings(book25, reply).length >= 25, true);
    const asked = scriptedAsk({ text: '=== MISSPELLINGS\nN20\nN21\nN25' });
    const { findings: found } = await ScribePedant.review({
        state: book25,
        player: 'Orla',
        message: reply,
        unread: [reply],
        ask: asked.ask,
    });
    const section = asked.calls[0][1].split('NAME CANDIDATES:\n')[1].split('\n');
    assert.equal(section.length, 20);
    assert.equal(section[0].startsWith('N1 | '), true);
    assert.equal(section[19].startsWith('N20 | '), true);
    assert.equal(asked.calls[0][1].includes('N21 | '), false);
    assert.equal(found.length, 1);
    assert.deepEqual(plain(found[0]), plain(withoutLook(ScribePedant.spellings(book25, reply)[19])));
});

test('the candidates are numbered in the input and left out when there are none', () => {
    const { state } = book();
    const reply = at(53);
    const candidates = ScribePedant.spellings(state, reply);
    const text = ScribePedant.input(state, 'Orla', reply, [reply], candidates);
    assert.equal(text.endsWith('\n\nNAME CANDIDATES:\nN1 | Halvard | Halvard | Halvart'), true);
    const plainText = ScribePedant.input(state, 'Orla', reply, [reply], []);
    assert.equal(plainText.includes('NAME CANDIDATES'), false);
    assert.equal(plainText.endsWith('You deserted, I know it.'), true);

    const twins = smallBook({ SUBJECTS: ['Aldric | character', 'Aldrich | character', 'Orla | character'] });
    const twice = narration('Aldrick bows.');
    const both = ScribePedant.input(twins, 'Orla', twice, [twice], ScribePedant.spellings(twins, twice));
    assert.equal(
        both.endsWith('NAME CANDIDATES:\nN1 | Aldric | Aldric | Aldrick\nN2 | Aldrich | Aldrich | Aldrick'),
        true,
    );
});

test('a candidate line gives the name word it looks like, alias and merged names included', async () => {
    const aliased = smallBook({
        SUBJECTS: ['Brandt | character', 'Orla | character'],
        NAMES: ['Wolfric | Brandt | #3'],
    });
    const spoken = narration('Wolfrick waits by the boat.');
    const asked = scriptedAsk({ text: '=== MISSPELLINGS\nN1' });
    const { findings: found } = await ScribePedant.review({
        state: aliased,
        player: 'Orla',
        message: spoken,
        unread: [spoken],
        ask: asked.ask,
    });
    assert.equal(asked.calls[0][1].includes('NAME CANDIDATES:\nN1 | Brandt | Wolfric | Wolfrick'), true);
    assert.deepEqual(plain(found.map((finding) => [finding.label, finding.written])), [['Brandt', 'Wolfrick']]);
    assert.deepEqual(plain(Object.keys(found[0])), shape);

    const merging = subjectsOnly(['Aldric', 'Brandt']);
    const merged = ruled(merging.log, {
        type: 'Merge',
        from: idOf(merging.state, 'Aldric'),
        into: idOf(merging.state, 'Brandt'),
    });
    const bowing = narration('Aldrich bows.');
    const inputText = ScribePedant.input(merged, 'Orla', bowing, [bowing], ScribePedant.spellings(merged, bowing));
    assert.equal(inputText.endsWith('NAME CANDIDATES:\nN1 | Brandt | Aldric | Aldrich'), true);
});

test('a confirmed spelling keeps its key and is spent as before', async () => {
    const { log, state } = subjectsOnly(['Aldric', 'Brandt']);
    const reply = narration('Aldrich bows.');
    const found = await reviewed(state, reply, '=== MISSPELLINGS\nN1');
    const [spelling] = ScribePedant.spellings(state, reply);
    assert.deepEqual(plain(found), plain([withoutLook(spelling)]));
    assert.deepEqual(plain(Object.keys(found[0])), shape);
    assert.equal(ScribePedant.key(found[0]), ScribePedant.key(spelling));
    assert.equal(ScribePedant.spent(state, found[0]), false);
    const joined = ruled(log, { type: 'Merge', from: found[0].subject, into: idOf(state, 'Brandt') });
    assert.equal(ScribePedant.spent(joined, found[0]), true);
});

test('the same finding is one finding', () => {
    const { state } = book();
    const ids = known(state);
    const once = check(
        state,
        at(50),
        [contradiction(ids.age, 'Halvard', 'age', 'forty'), contradiction(ids.age, 'halvard', 'Age', 'Forty')],
        [leak(ids.status, 'Mirelle', 'You deserted'), leak(ids.status, 'Mirelle', 'you ran at the siege')],
    );
    assert.deepEqual(plain(once.map((finding) => finding.kind)), ['Contradiction', 'Leak']);
    const later = check(state, at(51), [contradiction(ids.age, 'Halvard', 'age', 'forty')]);
    assert.equal(later.length, 1);
    assert.notEqual(ScribePedant.key(once[0]), ScribePedant.key(later[0]));
    const [first] = check(state, at(51), [], [leak(ids.status, 'Mirelle', 'You deserted')]);
    const [second] = check(state, at(53), [], [leak(ids.status, 'Mirelle', 'You deserted')]);
    assert.notEqual(ScribePedant.key(first), ScribePedant.key(second));

    const blank = ScribePedant.Settings.Finding;
    const asContradiction = { ...blank, kind: 'Contradiction', message: 'MESSAGE-50', fact: 'F3', said: 'calm' };
    const asLeak = { ...blank, kind: 'Leak', message: 'MESSAGE-50', fact: 'F3', speaker: 'calm' };
    assert.notEqual(ScribePedant.key(asContradiction), ScribePedant.key(asLeak));
});

test('one finding per fact, twenty per reply', () => {
    const lines = [];
    for (let number = 1; number <= 25; number++) {
        lines.push(`Halvard | relation to the stranger ${number} | trusts him | #${number}`);
    }
    const state = smallBook({
        SUBJECTS: ['Halvard | character', 'Orla | character'],
        FACTS: lines,
        SCENES: ['Day 1 | #1-#40 | The hall | public | present: Halvard, Orla | They meet'],
    });
    const reply = at(48);
    const relations = state.facts.filter((fact) => fact.category === 'relation' && fact.status === 'InForce');
    assert.equal(relations.length, 25);
    const claims = relations.map((fact) =>
        contradiction(fact.id, 'Halvard', `relation to ${fact.targetText}`, 'hates them all'),
    );
    const found = check(state, reply, claims);
    assert.equal(found.length, 20);
    assert.deepEqual(
        plain(found.map((finding) => finding.fact)),
        plain(relations.slice(0, 20).map((fact) => fact.id)),
    );
    const first = relations[0];
    const thrice = check(state, reply, [
        contradiction(first.id, 'Halvard', `relation to ${first.targetText}`, 'hates them all'),
        contradiction(first.id, 'Halvard', `relation to ${first.targetText}`, 'hates them'),
        contradiction(first.id, 'Halvard', `relation to ${first.targetText}`, 'them all'),
    ]);
    assert.deepEqual(plain(thrice.map((finding) => finding.said)), ['hates them all']);
});

test('two mouths, two leaks', () => {
    const { state } = book();
    const ids = known(state);
    const pair = at(54);
    const mirelle = idOf(state, 'Mirelle');
    const isolde = idOf(state, 'Isolde');
    const both = check(state, pair, [], [
        leak(ids.status, 'Mirelle', 'You pick locks'),
        leak(ids.status, 'Isolde', 'You pick locks'),
    ]);
    assert.deepEqual(plain(both.map((finding) => [finding.fact, finding.speaker])), [
        [ids.status, mirelle],
        [ids.status, isolde],
    ]);
    const twice = check(state, pair, [], [
        leak(ids.status, 'Mirelle', 'You pick locks'),
        leak(ids.status, 'Mirelle', 'pick locks'),
    ]);
    assert.deepEqual(plain(twice.map((finding) => [finding.speaker, finding.said])), [[mirelle, 'You pick locks']]);
});

test('they were told', () => {
    const first = book();
    const ids = known(first.state);
    const mirelle = idOf(first.state, 'Mirelle');
    const isolde = idOf(first.state, 'Isolde');
    const claim = leak(ids.status, 'Mirelle', 'You deserted');

    const [found] = check(first.state, at(50), [], [claim]);
    const widen = ScribePedant.told(first.state, found);
    assert.deepEqual(plain(widen), { type: 'Widen', fact: ids.status, to: [mirelle] });
    const after = ruled(first.log, widen);
    const status = factSaying(after, 'wanted by the crown for desertion');
    assert.equal(ScribeKnowledge.knows(after, mirelle, status), true);
    assert.equal(ScribePedant.told(after, found), null);

    const second = book();
    const listed = ruled(second.log, { type: 'Widen', fact: ids.status, to: [isolde] });
    const [again] = check(listed, at(50), [], [claim]);
    const wider = ScribePedant.told(listed, again);
    assert.deepEqual(plain(wider), { type: 'Widen', fact: ids.status, to: [isolde, mirelle] });
    const told = ruled(second.log, wider);
    const fact = factSaying(told, 'wanted by the crown for desertion');
    assert.equal(ScribeKnowledge.knows(told, mirelle, fact), true);
    assert.equal(ScribeKnowledge.knows(told, isolde, fact), true);

    const third = book();
    const [before] = check(third.state, at(50), [], [claim]);
    const everyone = ruled(third.log, { type: 'Widen', fact: ids.status, to: 'Everyone' });
    assert.equal(ScribePedant.told(everyone, before), null);

    const [aged] = check(first.state, at(50), [contradiction(ids.age, 'Halvard', 'age', 'forty')]);
    const [spelling] = ScribePedant.spellings(first.state, at(53));
    assert.equal(ScribePedant.told(first.state, aged), null);
    assert.equal(ScribePedant.told(first.state, spelling), null);
});

test('a pinned value is never widened', () => {
    const { log, state } = book();
    const halvard = idOf(state, 'Halvard');
    const mirelle = idOf(state, 'Mirelle');
    const pinned = ruled(log, {
        type: 'Pin',
        subject: halvard,
        category: 'eyes',
        target: null,
        text: 'blue as ice',
        hidden: true,
    });
    const made = factSaying(pinned, 'blue as ice');
    assert.deepEqual(plain([made.made, made.hidden, made.status]), [true, true, 'InForce']);
    const reply = at(50);
    assert.equal(sectionOf(pinned, 'DOES NOT KNOW:', reply, [reply]).includes(made.id), false);
    assert.equal(sectionOf(pinned, 'LEDGER:', reply, [reply]).includes(made.id), false);
    assert.equal(check(pinned, reply, [], [leak(made.id, 'Mirelle', 'You deserted')]).length, 0);
    const finding = about(pinned, made.id, {
        kind: 'Leak',
        said: 'You deserted',
        speaker: mirelle,
        speakerLabel: 'Mirelle',
    });
    assert.equal(ScribePedant.spent(pinned, finding), false);
    assert.equal(ScribePedant.told(pinned, finding), null);
});

test('a spent finding does nothing', () => {
    const reply = at(50);

    /**
     * @param {object} state
     * @return {Object<string, object>}
     */
    function findingsOf(state) {
        const ids = known(state);
        const [aged] = check(state, reply, [contradiction(ids.age, 'Halvard', 'age', 'forty')]);
        const [placed] = check(state, reply, [contradiction(ids.inn, 'Mirelle', 'role', 'the tower')]);
        const [guarded] = check(state, reply, [contradiction(ids.guard, 'Halvard', 'role', 'a baker')]);
        const [leaked] = check(state, reply, [], [leak(ids.status, 'Mirelle', 'You deserted')]);
        const [spelling] = ScribePedant.spellings(state, at(53));
        const found = { aged, placed, guarded, leaked, spelling };
        for (const [name, finding] of Object.entries(found)) {
            assert.notEqual(finding, undefined, name);
            assert.equal(ScribePedant.spent(state, finding), false, `${name} is live`);
        }
        assert.notEqual(ScribePedant.told(state, leaked), null);
        return found;
    }

    /**
     * @param {object} state
     * @param {object} finding
     * @param {string} name
     * @return {void}
     */
    function assertSpent(state, finding, name) {
        assert.equal(ScribePedant.spent(state, finding), true, `${name}: spent`);
        assert.equal(ScribePedant.told(state, finding), null, `${name}: told`);
    }

    /**
     * @param {function(object, object, Object<string, string>): object} change
     * @param {string[]} spent
     * @param {string} name
     * @return {void}
     */
    function after(change, spent, name) {
        const { log, state } = book();
        const found = findingsOf(state);
        const later = change(log, state, known(state));
        for (const key of spent) {
            assertSpent(later, found[key], `${name} ${key}`);
        }
    }

    const next = story.slice(43, 44);
    after(
        (log, state) =>
            ruled(log, {
                type: 'AddFact',
                subject: idOf(state, 'Mirelle'),
                category: 'role',
                target: null,
                text: 'the cook',
                hidden: false,
                cite: 'MESSAGE-44',
                position: 44,
            }),
        ['placed'],
        'replaced',
    );
    after(
        (log, state, ids) =>
            apply(log, answer({ CHANGES: [`${ids.guard} | Halvard | role | ENDED: he left | #44`] }), next),
        ['guarded'],
        'ended',
    );
    after(
        (log, state, ids) =>
            apply(log, answer({ CHANGES: [`${ids.age} | Halvard | age | FULLER: 34 and a half | #44`] }), next),
        ['aged'],
        'made fuller',
    );
    after((log) => apply(log, answer({ FACTS: ['Halvard | age | 35 | #44'] }), next), ['aged'], 'contested');
    after(
        (log, state, ids) =>
            ruled(log, {
                type: 'Split',
                subject: idOf(state, 'Halvard'),
                label: 'Halvard (the younger)',
                kind: 'character',
                facts: [ids.age],
            }),
        ['aged'],
        'split away',
    );
    after(
        (log, state, ids) => apply(log, answer({ TOLD: [`${ids.status} | Halvard | Mirelle | #44`] }), next),
        ['leaked'],
        'told',
    );
    after((log) => apply(log, answer({ FACTS: ['Halvard | aka | Halvart | #44'] }), next), ['spelling'], 'aka');
    after((log, state, ids) => ruled(log, { type: 'RemoveFact', fact: ids.age }), ['aged'], 'removed');
    after(
        (log) => {
            ScribeLog.withdraw(log, 'MESSAGE-1');
            return ScribeReplay.run(log, storyOrder);
        },
        ['aged', 'leaked'],
        'withdrawn',
    );
    after(
        (log, state) => ruled(log, { type: 'Merge', from: idOf(state, 'Mirelle'), into: idOf(state, 'Isolde') }),
        ['leaked'],
        'speaker merged away',
    );
    after(
        (log, state) => ruled(log, { type: 'Merge', from: idOf(state, 'Halvard'), into: idOf(state, 'Brandt') }),
        ['aged', 'leaked'],
        'owner merged into another',
    );
    after(() => ScribeReplay.run(ScribeLog.create(), storyOrder), ['aged', 'leaked', 'spelling'], 'empty book');

    const naming = subjectsOnly(['Aldric', 'Brandt']);
    const [spelling] = ScribePedant.spellings(naming.state, narration('Aldrich bows.'));
    assert.equal(ScribePedant.spent(naming.state, spelling), false);
    const joined = ruled(naming.log, { type: 'Merge', from: spelling.subject, into: idOf(naming.state, 'Brandt') });
    assertSpent(joined, spelling, 'spelling subject merged away');
});

test('a finding is about one fact', () => {
    const { state } = book();
    const ids = known(state);
    const [aged] = check(state, at(50), [contradiction(ids.age, 'Halvard', 'age', 'forty')]);
    const [leaked] = check(state, at(50), [], [leak(ids.status, 'Mirelle', 'You deserted')]);

    /**
     * @param {string} id
     * @param {string} line
     * @return {object}
     */
    function restarted(id, line) {
        const fillers = [];
        for (let number = 1; number < Number(id.slice(1)); number++) {
            fillers.push(`Isolde | trait | habit ${number} | #${number}`);
        }
        const hall = 'Day 1 | #1-#40 | The hall | public | present: Halvard, Mirelle, Orla | They meet';
        const restart = smallBook({ SUBJECTS: cast, FACTS: [...fillers, line], SCENES: [hall] });
        assert.equal(ScribeLog.lookup(restart.facts, id).position, 39);
        return restart;
    }

    for (const line of ['Halvard | eyes | 34 | #39', 'Halvard | age | 50 | #39']) {
        assert.equal(ScribePedant.spent(restarted(aged.fact, line), aged), true, line);
    }
    assert.equal(ScribePedant.spent(restarted(aged.fact, 'Halvard | age | 34 | #39'), aged), false);

    const others = [
        'Halvard | trait | wanted by the crown for desertion | hidden | #39',
        'Halvard | status | pardoned | hidden | #39',
        'Halvard | status | wanted by the crown for desertion | #39',
    ];
    for (const line of others) {
        const other = restarted(leaked.fact, line);
        assert.equal(ScribePedant.spent(other, leaked), true, line);
        assert.equal(ScribePedant.told(other, leaked), null, line);
    }
    const kept = restarted(leaked.fact, 'Halvard | status | wanted by the crown for desertion | hidden | #39');
    assert.equal(ScribePedant.spent(kept, leaked), false);
    assert.notEqual(ScribePedant.told(kept, leaked), null);
});

test('a finding is about one subject and one speaker', () => {
    const reply = at(51);
    const hall = 'Day 1 | #1-#40 | The hall | public | present: Halvard, Mirelle, Isolde, Orla | They meet';

    /**
     * @param {string[]} labels
     * @param {string} owner
     * @return {object}
     */
    function bookOf(labels, owner) {
        return smallBook({
            SUBJECTS: labels.map((label) => `${label} | character`),
            FACTS: [`${owner} | status | wanted for desertion | hidden | #5`, `${owner} | age | 34 | #6`],
            SCENES: [hall],
        });
    }

    const first = bookOf(['Halvard', 'Mirelle', 'Isolde', 'Orla'], 'Halvard');
    const status = factSaying(first, 'wanted for desertion').id;
    const age = factSaying(first, '34').id;
    const [aged] = check(first, reply, [contradiction(age, 'Halvard', 'age', 'forty')]);
    const [leaked] = check(first, reply, [], [leak(status, 'Mirelle', 'You deserted')]);
    const [spelling] = ScribePedant.spellings(first, narration('Halvart waits.'));
    assert.deepEqual(plain([aged.label, leaked.label, leaked.speakerLabel, spelling.label]), [
        'Halvard',
        'Halvard',
        'Mirelle',
        'Halvard',
    ]);

    const swapped = bookOf(['Halvard', 'Isolde', 'Mirelle', 'Orla'], 'Halvard');
    assert.equal(ScribeLog.lookup(swapped.subjects, leaked.speaker).label, 'Isolde');
    assert.equal(ScribePedant.spent(swapped, leaked), true);
    assert.equal(ScribePedant.told(swapped, leaked), null);

    const moved = bookOf(['Mirelle', 'Halvard', 'Isolde', 'Orla'], 'Mirelle');
    assert.equal(ScribeLog.lookup(moved.facts, age).subject, aged.subject);
    assert.equal(ScribePedant.spent(moved, aged), true);
    assert.equal(ScribePedant.spent(moved, leaked), true);
    assert.equal(ScribePedant.told(moved, leaked), null);
    assert.equal(ScribePedant.spent(moved, spelling), true);

    const same = bookOf(['Halvard', 'Mirelle', 'Isolde', 'Orla'], 'Halvard');
    assert.equal(ScribePedant.spent(same, aged), false);
    assert.equal(ScribePedant.spent(same, leaked), false);
    assert.equal(ScribePedant.spent(same, spelling), false);
    assert.notEqual(ScribePedant.told(same, leaked), null);
});

test("the first review's surviving mutants", () => {
    const state = smallBook({
        SUBJECTS: [
            'Halvard | character',
            'Kira (the smith) | character',
            'Kira (the baker) | character',
            'Orla | character',
        ],
        FACTS: ['Halvard | status | wanted for desertion | hidden | #5'],
    });
    const reply = at(55);
    const status = factSaying(state, 'wanted for desertion').id;
    assert.equal(ScribePedant.find(state, 'Kira'), null);
    assert.equal(sectionOf(state, 'DOES NOT KNOW:', reply, [reply]), 'DOES NOT KNOW:\n(none)');
    assert.equal(check(state, reply, [], [leak(status, 'Kira', 'you deserted')]).length, 0);
    assert.equal(check(state, reply, [], [leak(status, 'Kira (the smith)', 'you deserted')]).length, 0);
});

test('the pedant offers no ruling but told', () => {
    const { state } = book();
    const ids = known(state);
    assert.equal('accept' in ScribePedant, false);
    const [aged] = check(state, at(50), [contradiction(ids.age, 'Halvard', 'age', 'forty')]);
    assert.equal(ScribePedant.told(state, aged), null);
    assert.equal(typeof ScribePedant.spent(state, aged), 'boolean');
    assert.equal(typeof ScribePedant.key(aged), 'string');
});

test('the pedant writes nothing for the site', async () => {
    const { state } = book();
    const ids = known(state);
    assert.equal('correction' in ScribePedant, false);
    const reply = at(50);
    const aged = contradiction(ids.age, 'Halvard', 'age', 'forty');
    const deserted = leak(ids.status, 'Mirelle', 'You deserted');
    const findings = [...check(state, reply, [aged], [deserted]), ...ScribePedant.spellings(state, at(53))];
    assert.equal(findings.length, 3);
    const calls = [
        [state, 'Orla', reply, [reply]],
        [ScribePedant.Prompt],
        [state, reply],
        ...findings.map((finding) => [state, finding]),
    ];
    for (const [name, member] of Object.entries(ScribePedant)) {
        if (typeof member === 'string') {
            assert.equal(member.startsWith('[Scribe]'), false, name);
        }
        if (typeof member !== 'function') {
            continue;
        }
        for (const parameters of calls) {
            let result = null;
            try {
                result = await member(...parameters);
            } catch {
                result = null;
            }
            if (typeof result === 'string') {
                assert.equal(result.startsWith('[Scribe]'), false, name);
            }
        }
    }
    const source = readFileSync(new URL('../scribe/page/ScribePedant.js', import.meta.url), 'utf8');
    assert.equal(source.includes('OwnMarker'), false);
});

test('the prompt is exact', () => {
    const prompt = ScribePedant.Prompt;
    const lines = prompt.split('\n');
    assert.equal(lines.length, promptLines.length);
    for (const [index, line] of promptLines.entries()) {
        assert.equal(lines[index], line, `line ${index + 1}`);
    }
    assert.equal(prompt.includes('states or uses'), true);
    assert.equal(prompt.includes('reacts to'), false);
    assert.equal(prompt.includes('\t'), false);
    assert.equal(lines.some((line) => line.endsWith(' ')), false);
});

test('nothing is changed', async () => {
    const { state } = book();
    const ids = known(state);
    const reply = at(53);
    const stateBefore = JSON.stringify(state);
    const replyBefore = JSON.stringify(reply);
    const text = answer({
        CONTRADICTIONS: [`${ids.age} | Halvard | age | forty`],
        LEAKS: [`${ids.status} | Mirelle | You deserted`],
        MISSPELLINGS: ['N1'],
    });
    const reviewedAll = await ScribePedant.review({
        state,
        player: 'Orla',
        message: reply,
        unread: [reply],
        ask: scriptedAsk({ text }).ask,
    });
    const found = reviewedAll.findings;
    assert.deepEqual(plain(found.map((finding) => finding.kind)), ['Contradiction', 'Leak', 'Spelling']);
    assertFrozenDeep(reviewedAll, 'review');
    assertFrozenDeep(ScribePedant.spellings(state, reply), 'spellings');
    const parsed = ScribePedant.parse(text);
    assertFrozenDeep(parsed, 'parse');
    assertFrozenDeep(ScribePedant.confirm(state, 'Orla', reply, parsed, [reply]), 'confirm');
    const played = await ScribePedant.review({ state, player: 'Orla', message: at(47), unread: [], ask: null });
    assertFrozenDeep(played, 'played');
    assertFrozenDeep(ScribePedant.misspelt(ScribePedant.spellings(state, reply), parsed.misspellings), 'misspelt');
    ScribePedant.input(state, 'Orla', reply, [reply], ScribePedant.spellings(state, reply));
    for (const finding of found) {
        ScribePedant.key(finding);
        ScribePedant.spent(state, finding);
        assertFrozenDeep(ScribePedant.told(state, finding), `told ${finding.kind}`);
    }
    assert.equal(ScribePedant.told(state, found[1]) !== null, true);
    for (const member of [ScribePedant, ScribePedant.Kind, ScribePedant.Block, ScribePedant.Settings]) {
        assert.equal(Object.isFrozen(member), true);
    }
    assert.equal(JSON.stringify(state) === stateBefore, true);
    assert.equal(JSON.stringify(reply) === replyBefore, true);
});

/**
 * @param {string[]} texts
 * @return {object[]}
 */
function chatOf(texts) {
    const builder = new CampaignBuilder('Orla');
    for (const text of texts) {
        builder.narrator(text);
    }
    return ScribeIntake.read(builder.messages).messages;
}

/**
 * @param {number} count
 * @return {string[]}
 */
function fillers(count) {
    return Array.from({ length: count }, (unused, index) => `Filler line ${index + 1} of the road.`);
}

/**
 * @param {object[]} messages
 * @param {string[]} lines
 * @param {object[]|null} unread
 * @return {Promise<{ found: readonly object[], calls: Array<Array<string>> }>}
 */
async function judged(messages, lines, unread = null) {
    const reply = messages[messages.length - 1];
    const asked = scriptedAsk({ text: answer({ SITUATION: lines }) });
    const { findings: found } = await ScribePedant.review({
        state: subjectsOnly(['Orla']).state,
        player: 'Orla',
        message: reply,
        unread: unread ?? [reply],
        messages,
        ask: asked.ask,
    });
    return { found, calls: asked.calls };
}

/**
 * @param {string} input
 * @return {string|null}
 */
function recentOf(input) {
    const heading = 'RECENT MESSAGES:\n';
    const start = input.indexOf(heading);
    if (start === -1) {
        return null;
    }
    return input.slice(start + heading.length, input.indexOf('\n\nSINCE THE BOOK WAS LAST READ:', start));
}

test('the prompt carries the situation check', () => {
    const prompt = ScribePedant.Prompt;
    assert.equal(prompt.includes('the RECENT MESSAGES before them, the messages SINCE THE BOOK WAS LAST READ'), true);
    assert.equal(
        prompt.includes(
            'which NAME CANDIDATES are misspellings, where the REPLY does not fit what the messages above establish, and what the characters wear and look like now.',
        ),
        true,
    );
    assert.equal(prompt.includes('Answer with these five blocks'), true);
    assert.equal(prompt.includes("=== SITUATION\nthe reply's own words | the earlier words they clash with"), true);
    assert.equal(prompt.split('\n').includes(promptLines[promptLines.length - 2]), true);
    assert.equal(promptLines[promptLines.length - 2].startsWith('7. A situation clash'), true);
});

test('the prompt asks for the live notes', () => {
    const prompt = ScribePedant.Prompt;
    const lines = prompt.split('\n');
    const example = lines.indexOf('=== NOW');
    assert.equal(lines[example - 1], "the reply's own words | the earlier words they clash with");
    assert.equal(lines[example + 1], 'Name | wearing | what they wear now');
    assert.equal(lines[example + 2], 'Name | looks | how they look');
    assert.equal(lines[lines.length - 1], promptLines[promptLines.length - 1]);
    assert.equal(lines[lines.length - 1].startsWith('8. NOW: '), true);
    assert.equal(lines[lines.length - 1].includes('At most 12 lines.'), true);
    assert.equal(prompt, promptLines.join('\n'));
});

test('recent messages fill what the since section does not show', () => {
    const { state } = subjectsOnly(['Orla']);
    const messages = chatOf(fillers(15));
    const reply = messages[14];
    const input = (unread) => ScribePedant.input(state, 'Orla', reply, unread, [], messages);

    const caught = input([reply]);
    assert.equal(recentOf(caught), ScribeIntake.transcript(messages.slice(4, 14)));
    assert.equal(caught.includes('SINCE THE BOOK WAS LAST READ:\n(none)'), true);
    assert.equal(caught.indexOf('RECENT MESSAGES:') < caught.indexOf('SINCE THE BOOK WAS LAST READ:'), true);

    const three = input([...messages.slice(11, 14), reply]);
    assert.equal(recentOf(three), ScribeIntake.transcript(messages.slice(4, 11)));
    assert.equal(three.includes(`SINCE THE BOOK WAS LAST READ:\n${ScribeIntake.transcript(messages.slice(11, 14))}`), true);

    const long = chatOf(fillers(40));
    const longReply = long[39];
    const thirty = ScribePedant.input(state, 'Orla', longReply, [...long.slice(9, 39), longReply], [], long);
    assert.equal(thirty.includes('RECENT MESSAGES:'), false);
    assert.equal(thirty.includes(ScribeIntake.transcript(long.slice(9, 39))), true);

    const heavyTexts = fillers(15);
    heavyTexts[2] = 'y'.repeat(61000);
    const heavy = chatOf(heavyTexts);
    const heavyReply = heavy[14];
    const tooLong = ScribePedant.input(state, 'Orla', heavyReply, [...heavy.slice(0, 14), heavyReply], [], heavy);
    assert.equal(tooLong.includes('SINCE THE BOOK WAS LAST READ:\n(too long to show)'), true);
    assert.equal(recentOf(tooLong), ScribeIntake.transcript(heavy.slice(4, 14)));

    const bare = ScribePedant.input(state, 'Orla', reply, [reply], [], []);
    assert.equal(bare.includes('RECENT MESSAGES:'), false);
    for (const missing of [undefined, null, 'not a list', {}]) {
        assert.equal(ScribePedant.input(state, 'Orla', reply, [reply], [], missing), bare, String(missing));
    }
});

test('the recent section is capped by characters', () => {
    const { state } = subjectsOnly(['Orla']);
    const texts = fillers(15);
    for (let index = 4; index < 14; index++) {
        texts[index] = String.fromCharCode(97 + index).repeat(3000);
    }
    const messages = chatOf(texts);
    const reply = messages[14];
    const capped = recentOf(ScribePedant.input(state, 'Orla', reply, [reply], [], messages));
    assert.equal(capped, ScribeIntake.transcript(messages.slice(8, 14)));
    assert.equal(Array.from(capped).length <= 20000, true);
    assert.equal(Array.from(ScribeIntake.transcript(messages.slice(7, 14))).length > 20000, true);

    const long = fillers(15);
    long[13] = `${'a'.repeat(5000)}${'b'.repeat(20000)}`;
    const over = chatOf(long);
    const overReply = over[14];
    const tail = recentOf(ScribePedant.input(state, 'Orla', overReply, [overReply], [], over));
    assert.equal(Array.from(tail).length, 20000);
    assert.equal(tail.startsWith('[#14] '), true);
    assert.equal(tail.endsWith('b'.repeat(19000)), true);
    assert.equal(tail.includes('a'.repeat(100)), false);
    assert.equal(tail.includes('Narrator:'), false);

    const giant = fillers(15);
    giant[13] = 'c'.repeat(25000);
    const huge = chatOf(giant);
    const hugeReply = huge[14];
    const section = recentOf(ScribePedant.input(state, 'Orla', hugeReply, [hugeReply], [], huge));
    assert.equal(Array.from(section).length <= 20000, true);
    assert.equal(section.startsWith('[#14] '), true);
    assert.equal(section.endsWith('c'.repeat(1000)), true);
});

test('the earlier words of an over-long recent message are only the kept end', async () => {
    const texts = fillers(15);
    const reply = 'The lantern hangs here, says nobody.';
    texts[14] = reply;
    const filler = 'c'.repeat(23000);
    const cases = [
        [`The red lantern hangs here. ${filler}`, 'The red lantern hangs here', 0],
        [`${filler} The blue lantern hangs here.`, 'The blue lantern hangs here', 1],
    ];
    for (const [text, quote, expected] of cases) {
        const long = [...texts];
        long[13] = text;
        const chat = chatOf(long);
        const found = (await judged(chat, [`The lantern hangs here | ${quote}`])).found;
        assert.equal(found.length, expected, quote);
    }
});

test('every reply is checked once', async () => {
    const messages = chatOf(['The wind drops.', 'Rain falls on the roofs.']);
    const { found, calls } = await judged(messages, ['(none)']);
    assert.equal(calls.length, 1);
    assert.equal(found.length, 0);
    assert.equal(calls[0][1].includes('NAME CANDIDATES:'), false);
    assert.equal(calls[0][1].includes('RECENT MESSAGES:'), true);
});

test('the situation block is read', () => {
    const situations = (text) => plain(ScribePedant.parse(text).situations);
    assert.deepEqual(situations('=== SITUATION\nYou have a bed? | We camp for three nights'), [
        { said: 'You have a bed?', earlier: 'We camp for three nights' },
    ]);
    assert.deepEqual(situations('=== SITUATION\nreply words | earlier one | and more'), [
        { said: 'reply words', earlier: 'earlier one | and more' },
    ]);
    for (const skipped of ['just one field', '(none)', 'None.', 'none', 'NONE', '(None).', '', '| |']) {
        assert.deepEqual(situations(`=== SITUATION\n${skipped}`), [], skipped);
    }
    assert.deepEqual(situations('=== SITUATION\nNonetheless he waits | They stood at the door'), [
        { said: 'Nonetheless he waits', earlier: 'They stood at the door' },
    ]);
    assert.deepEqual(situations('=== SITUATION\nNone of them sleep | We camp'), [
        { said: 'None of them sleep', earlier: 'We camp' },
    ]);
    assert.deepEqual(situations('=== SITUATION\n| a | b |\n- c | d\n**e | f**'), [
        { said: 'a', earlier: 'b' },
        { said: 'c', earlier: 'd' },
        { said: 'e', earlier: 'f' },
    ]);
    assert.deepEqual(situations('=== SITUATION\nsolo\nnext | pair'), [{ said: 'next', earlier: 'pair' }]);

    const before = ScribePedant.parse('=== SITUATION\nx | y\n=== CONTRADICTIONS\nF1 | Halvard | age | forty\n=== LEAKS\nF2 | Orla | it');
    assert.equal(before.situations.length, 1);
    assert.equal(before.contradictions.length, 1);
    assert.equal(before.leaks.length, 1);
    const after = ScribePedant.parse('=== CONTRADICTIONS\nF1 | Halvard | age | forty\n=== SITUATION\nx | y\nF3 | Orla | it');
    assert.equal(after.situations.length, 2);
    assert.equal(after.contradictions.length, 1);
    const switched = ScribePedant.parse('=== MISSPELLINGS\nN2\n=== SITUATION\nx | y');
    assert.deepEqual(plain(switched.misspellings), [2]);
    assert.deepEqual(plain(switched.situations), [{ said: 'x', earlier: 'y' }]);
    const reversed = ScribePedant.parse('=== SITUATION\nx | y\n=== MISSPELLINGS\nN4\nN1 | z');
    assert.deepEqual(plain(reversed.misspellings), [4]);
    assert.deepEqual(plain(reversed.situations), [{ said: 'x', earlier: 'y' }]);
    assert.equal(ScribePedant.parse('=== SITUATIONS\nx | y').situations.length, 1);
    assertFrozenDeep(before, 'parse');
});

test('the operator cases are caught', async () => {
    const camping = chatOf([
        'The party agrees the dungeon mission: We camp for three nights getting there.',
        'Frost nods and checks the map.',
        'Selene smiles. You have a bed? she asks. Four people, one apartment, one bed.',
    ]);
    const bed = await judged(camping, ['You have a bed? | We camp for three nights getting there']);
    assert.equal(bed.calls.length, 1);
    assert.deepEqual(plain(bed.found.map(fields)), [
        [
            'Situation',
            'MESSAGE-3',
            3,
            null,
            null,
            null,
            null,
            'We camp for three nights getting there',
            'You have a bed?',
            null,
            null,
            null,
        ],
    ]);
    assertFrozenDeep(bed.found, 'situation');

    const door = chatOf([
        'They stood at the door.',
        'Frost listens.',
        "Selene's free hand drifts, reaching past Frost's arm toward the bedroom. Toward the table.",
    ]);
    const reach = await judged(door, ["reaching past Frost's arm toward the bedroom | They stood at the door"]);
    assert.deepEqual(plain(reach.found.map((finding) => [finding.kind, finding.said, finding.book])), [
        ['Situation', "reaching past Frost's arm toward the bedroom", 'They stood at the door'],
    ]);
});

test('a situation line that cannot be shown is dropped', async () => {
    const texts = [...fillers(13), 'The reply holds the words about the door.'];
    texts[0] = 'The old plan: we camp for three nights.';
    texts[3] = 'Near enough: they stood at the door.';
    const messages = chatOf(texts);
    const reply = 'the reply holds the words about the door';
    const caught = async (line, chat = messages, unread = null) => (await judged(chat, [line], unread)).found;

    assert.equal((await caught(`${reply} | they stood at the door`)).length, 1);
    assert.equal((await caught('words not in it at all | they stood at the door')).length, 0);
    assert.equal((await caught(`${reply} | nobody said this anywhere`)).length, 0);
    assert.equal((await caught(`${reply} | we camp for three nights`)).length, 0);
    assert.equal((await caught(`${reply} | we camp for three nights`, messages, [messages[0], messages[13]])).length, 1);
    assert.equal((await caught(`${reply} | they stood at the door | extra`)).length, 0);

    const sized = (length) => {
        const text = 'ab '.repeat(length).slice(0, length);
        return text.endsWith(' ') ? `${text.slice(0, -1)}b` : text;
    };
    const wide = sized(200);
    const over = sized(301);
    const edge = sized(300);
    const wideChat = (quote) => chatOf([`Before ${quote} after.`, `A reply with ${quote} inside.`]);
    assert.equal((await caught(`${wide} | ${wide}`, wideChat(wide))).length, 1);
    assert.equal((await caught(`${edge} | ${edge}`, wideChat(edge))).length, 1);
    assert.equal((await caught(`${over} | ${over}`, wideChat(over))).length, 0);
    assert.equal((await caught(`${wide} | ${over}`, wideChat(over))).length, 0);
});

test('at most three situations are kept, once each', async () => {
    const words = ['first', 'second', 'third', 'fourth', 'fifth'];
    const messages = chatOf([
        ...words.map((word) => `The ${word} fact holds.`),
        words.map((word) => `The ${word} holds.`).join(' '),
    ]);
    const clash = (word) => `The ${word} holds. | The ${word} fact holds.`;
    const five = await judged(messages, words.map(clash));
    assert.deepEqual(plain(five.found.map((finding) => finding.said)), [
        'The first holds.',
        'The second holds.',
        'The third holds.',
    ]);
    const repeated = await judged(messages, [clash('first'), 'THE FIRST HOLDS. | The second fact holds.', clash('third')]);
    assert.deepEqual(plain(repeated.found.map((finding) => finding.said)), ['The first holds.', 'The third holds.']);
});

test('review returns contradictions, leaks, spellings, then situations', async () => {
    const { state } = book();
    const ids = known(state);
    const reply = at(53);
    const text = answer({
        SITUATION: ['Halvart is forty now. | Mirelle looks at Halvard: you deserted, they say.'],
        MISSPELLINGS: ['N1'],
        LEAKS: [`${ids.status} | Mirelle | You deserted`],
        CONTRADICTIONS: [`${ids.age} | Halvard | age | forty`],
    });
    const asked = scriptedAsk({ text });
    const result = await ScribePedant.review({
        state,
        player: 'Orla',
        message: reply,
        unread: [reply],
        messages: story,
        ask: asked.ask,
    });
    const found = result.findings;
    assert.deepEqual(plain(found.map((finding) => finding.kind)), ['Contradiction', 'Leak', 'Spelling', 'Situation']);
    assert.equal(asked.calls[0][1].includes('RECENT MESSAGES:'), true);
    assertFrozenDeep(result, 'review');
});

test('a situation finding has a stable key and is never spent', async () => {
    const messages = chatOf(['They stood at the door.', 'Selene reaches toward the bedroom.']);
    const first = (await judged(messages, ['reaches toward the bedroom | They stood at the door'])).found[0];
    const second = (await judged(messages, ['Reaches  toward the BEDROOM | They stood at the door'])).found[0];
    assert.equal(ScribePedant.key(first), JSON.stringify(['Situation', 'MESSAGE-2', 'reaches toward the bedroom']));
    assert.equal(ScribePedant.key(second), ScribePedant.key(first));
    const other = (await judged(messages, ['Selene reaches toward | They stood at the door'])).found[0];
    assert.notEqual(ScribePedant.key(other), ScribePedant.key(first));
    for (const state of [book().state, subjectsOnly(['Orla']).state]) {
        assert.equal(ScribePedant.spent(state, first), false);
        assert.equal(ScribePedant.told(state, first), null);
    }
});

test('double quotation marks of every form fold to one', async () => {
    const straightSource = new CampaignBuilder('Orla');
    straightSource.player('"We camp for three nights getting there," Frost says.');
    straightSource.reply([['Narrator', 'Selene tilts her head. “You have a bed?” she asks. Four people, one bed.']]);
    const curlySource = new CampaignBuilder('Orla');
    curlySource.player('“We camp for three nights getting there,” Frost says.');
    curlySource.reply([['Narrator', 'Selene tilts her head. "You have a bed?" she asks. Four people, one bed.']]);
    const straight = ScribeIntake.read(straightSource.messages).messages;
    const curly = ScribeIntake.read(curlySource.messages).messages;
    const cases = [
        [straight, '"You have a bed?" she asks. | We camp for three nights getting there'],
        [straight, '“You have a bed?” she asks. | "We camp for three nights getting there," Frost says.'],
        [straight, '„You have a bed?” she asks. | «We camp for three nights getting there,» Frost says.'],
        [curly, '“You have a bed?” she asks. | “We camp for three nights getting there,” Frost says.'],
        [curly, '"You have a bed?" she asks. | "We camp for three nights getting there," Frost says.'],
    ];
    for (const [chat, line] of cases) {
        assert.equal((await judged(chat, [line])).found.length, 1, line);
    }
    assert.equal(ScribePedant.folded('“a” „b‟ «c» ”d"'), '"a" "b" "c" "d"');
});

test('bold and italic dress on a situation field is removed', async () => {
    const chat = chatOf(['We camp for three nights getting there.', 'Selene asks: You have a bed? Just one.']);
    const lines = [
        '**You have a bed?** | **We camp for three nights getting there**',
        '- **You have a bed?** | **We camp for three nights getting there**',
        '*You have a bed?* | _We camp for three nights getting there_',
        '__You have a bed?__ | __We camp for three nights getting there__',
        '**You have a bed? | We camp for three nights getting there**',
    ];
    for (const line of lines) {
        assert.equal((await judged(chat, [line])).found.length, 1, line);
    }
    assert.deepEqual(plain(ScribePedant.parse('=== SITUATION\n*x* | *y*').situations), [{ said: 'x', earlier: 'y' }]);
    assert.deepEqual(plain(ScribePedant.parse('=== SITUATION\n**a** | **b**').situations), [{ said: 'a', earlier: 'b' }]);
});

test('only unbalanced bold edges are stripped from a situation field', async () => {
    const stop = '**Stop.** She raises a hand, palm out.';
    const chat = chatOf(['We camp for three nights getting there.', stop]);
    const parsed = plain(ScribePedant.parse(`=== SITUATION\n${stop} | We camp for three nights getting there`).situations);
    assert.deepEqual(parsed, [{ said: stop, earlier: 'We camp for three nights getting there' }]);
    const found = (await judged(chat, [`${stop} | We camp for three nights getting there`])).found;
    assert.equal(found.length, 1);
    assert.equal(found[0].said, stop);
    assert.deepEqual(plain(ScribePedant.parse('=== SITUATION\n__Stop__ now | x__').situations), [
        { said: '__Stop__ now', earlier: 'x' },
    ]);
});

test('speaker labels never count as words of a message', async () => {
    const builder = new CampaignBuilder('Orla');
    builder.player('I wave at Selene from the doorway.');
    builder.narrator('Selene waits by the road.');
    builder.narrator('Selene waits by the road and looks around.');
    const chat = ScribeIntake.read(builder.messages).messages;
    assert.equal((await judged(chat, ['Selene waits by the road | Narrator'])).found.length, 0);
    assert.equal((await judged(chat, ['Selene waits by the road | Orla (player)'])).found.length, 0);
    assert.equal((await judged(chat, ['Selene waits by the road | Narrator: Selene waits by the road'])).found.length, 0);
    assert.equal((await judged(chat, ['Selene waits by the road | I wave at Selene from the doorway'])).found.length, 1);
    assert.equal((await judged(chat, ['Narrator: Selene waits by the road | I wave at Selene'])).found.length, 0);
});

test('a situation is keyed by the words of the reply, not its punctuation', async () => {
    const chat = chatOf(['We camp for three nights getting there.', 'Selene asks: You have a bed? Just one.']);
    const both = await judged(chat, [
        'You have a bed | We camp for three nights',
        'You have a bed? | We camp for three nights getting there',
    ]);
    assert.equal(both.found.length, 1);
    const plainKey = ScribePedant.key((await judged(chat, ['You have a bed | We camp for three nights'])).found[0]);
    const marked = ScribePedant.key((await judged(chat, ['**You have a BED?** | We camp for three nights'])).found[0]);
    const dotted = ScribePedant.key(
        ScribePedant.finding(chat[1], { kind: ScribePedant.Kind.Situation, said: 'You have a *bed*.', book: 'x' }),
    );
    assert.equal(marked, plainKey);
    assert.equal(dotted, plainKey);
});

test('each situation quote needs at least two words', async () => {
    const chat = chatOf([
        'We camp tonight. We camp for three nights getting there.',
        'Selene asks: You have a bed? Just one. A a.',
    ]);
    const caught = async (line) => (await judged(chat, [line])).found.length;
    assert.equal(await caught('A | a'), 0);
    assert.equal(await caught('the | the'), 0);
    assert.equal(await caught('You have a bed? | We'), 0);
    assert.equal(await caught('You | We camp for three nights'), 0);
    assert.equal(await caught('You have a bed? | We camp'), 1);
    assert.equal(await caught('You have | We camp for three nights'), 1);
    assert.equal(await caught('You have a bed? | We camp tonight'), 1);
    assert.equal(await caught('You have a | We camp for'), 1);
});

test('short clashes of two words are caught', async () => {
    const builder = new CampaignBuilder('Orla');
    builder.narrator('Night falls. The fire burns low.');
    builder.narrator('Selene left.');
    builder.player('I stay by the fire.');
    builder.reply([
        ['Selene', '“Good morning!”'],
        ['Narrator', 'Selene nods. She sits.'],
    ]);
    const chat = ScribeIntake.read(builder.messages).messages;
    const caught = async (line) => (await judged(chat, [line])).found.length;
    assert.equal(await caught('Good morning! | Night falls. The fire burns low.'), 1);
    assert.equal(await caught('Selene nods. | Selene left.'), 1);
    assert.equal(await caught('Good morning! | Night'), 0);
    assert.equal(await caught('Good | Night falls. The fire burns low.'), 0);
});

test('the live notes are read', () => {
    const notes = (text) => plain(ScribePedant.parse(text).now);
    assert.deepEqual(notes('=== NOW\nThessaly | wearing | a dented breastplate\nThessaly | looks | teal eyes, tall'), [
        { name: 'Thessaly', kind: 'wearing', text: 'a dented breastplate' },
        { name: 'Thessaly', kind: 'looks', text: 'teal eyes, tall' },
    ]);
    assert.deepEqual(notes('=== NOW\n| **Thessaly** | `Wearing:` | _a travel cloak_ |\n- Veyra | Looks: | grey'), [
        { name: 'Thessaly', kind: 'wearing', text: 'a travel cloak' },
        { name: 'Veyra', kind: 'looks', text: 'grey' },
    ]);
    assert.deepEqual(notes('=== NOW\nThessaly | wearing\nThessaly'), []);
    assert.deepEqual(notes('=== NOW\nThessaly | wearing | a cloak | and boots'), [
        { name: 'Thessaly', kind: 'wearing', text: 'a cloak | and boots' },
    ]);
    assert.deepEqual(notes('=== NOW\n(none)\nnone\n(None).'), []);
    assert.deepEqual(notes('=== NOW\n\n```\nThessaly | wearing | a cloak\n```'), [
        { name: 'Thessaly', kind: 'wearing', text: 'a cloak' },
    ]);
    const before = ScribePedant.parse('=== NOW\nA | wearing | x\n=== CONTRADICTIONS\nF1 | Halvard | age | forty');
    assert.equal(before.now.length, 1);
    assert.equal(before.contradictions.length, 1);
    const after = ScribePedant.parse('=== CONTRADICTIONS\nF1 | Halvard | age | forty\n=== NOW\nA | wearing | x\nF2 | B | c');
    assert.equal(after.now.length, 2);
    assert.equal(after.contradictions.length, 1);
    const switched = ScribePedant.parse('=== MISSPELLINGS\nN2\n=== NOW\nA | looks | tall');
    assert.deepEqual(plain(switched.misspellings), [2]);
    assert.deepEqual(plain(switched.now), [{ name: 'A', kind: 'looks', text: 'tall' }]);
    const reversed = ScribePedant.parse('=== NOW\nA | looks | tall\n=== MISSPELLINGS\nN4');
    assert.deepEqual(plain(reversed.misspellings), [4]);
    assert.equal(reversed.now.length, 1);
    assert.equal(Object.isFrozen(before.now), true);
    assert.equal(Object.isFrozen(before.now[0]), true);
});

/**
 * @param {string[]} texts
 * @return {object}
 */
function placed(texts) {
    return { blocks: texts.map((text) => ({ text, speaker: 'Narrator', role: 'Narrator' })) };
}

/**
 * @param {object[]} lines
 * @param {object} message
 * @param {object[]} shown
 * @return {object[]}
 */
function keptNotes(lines, message = placed(['Thessaly stands by the door with Veyra.']), shown = []) {
    return plain(ScribePedant.noted(message, lines, shown));
}

/**
 * @param {string} name
 * @param {string} kind
 * @param {string} text
 * @return {{ name: string, kind: string, text: string }}
 */
function line(name, kind, text) {
    return { name, kind, text };
}

test('a note is kept only when its name is in the reply or the messages shown', () => {
    const reply = placed(['Thessaly stands by the door.']);
    const shown = [placed(['Earlier, Veyra waited.'])];
    const found = keptNotes(
        [
            line('Thessaly', 'wearing', 'a cloak'),
            line('veyra', 'looks', 'tall'),
            line('Selene', 'wearing', 'a hat'),
        ],
        reply,
        shown,
    );
    assert.deepEqual(found, [
        { name: 'Thessaly', kind: 'Wearing', text: 'a cloak' },
        { name: 'veyra', kind: 'Looks', text: 'tall' },
    ]);
    assert.equal(keptNotes([line('Thessaly', 'wearing', 'a cloak')], reply, []).length, 1);
    assert.equal(keptNotes([line('Veyra', 'wearing', 'a cloak')], reply, []).length, 0);
    const speaking = { blocks: [{ text: 'Hello there.', speaker: 'Selene', role: 'Character' }] };
    assert.equal(keptNotes([line('Selene', 'looks', 'small')], speaking, []).length, 1);
    assert.equal(keptNotes([line('Sele', 'looks', 'small')], speaking, []).length, 0);
    assert.equal(keptNotes([line('Selene', 'looks', 'small')], placed(['Hello there.']), []).length, 0);
});

test('a name must have a letter and a word of its own in the messages', () => {
    const reply = placed(['Room 123 holds Thessalyn and the Brand-new door.']);
    assert.deepEqual(keptNotes([line('123', 'looks', 'tall')], reply), []);
    assert.deepEqual(keptNotes([line('Thessaly', 'looks', 'tall')], reply), []);
    assert.deepEqual(keptNotes([line('', 'looks', 'tall')], reply), []);
    assert.equal(keptNotes([line('Thessalyn', 'looks', 'tall')], reply).length, 1);
});

test('a note text is at most 120 characters and an astral character counts once', () => {
    const body = (count) => 'a'.repeat(count);
    assert.equal(keptNotes([line('Thessaly', 'looks', body(120))]).length, 1);
    assert.equal(keptNotes([line('Thessaly', 'looks', body(121))]).length, 0);
    assert.equal(keptNotes([line('Thessaly', 'looks', body(119) + astral)]).length, 1);
    assert.equal(keptNotes([line('Thessaly', 'looks', body(120) + astral)]).length, 0);
    assert.equal(keptNotes([line('Thessaly', 'looks', '')]).length, 0);
});

test('a note with a bracket, an at sign or a line break in the text or the name is dropped', () => {
    const reply = placed(['Thessaly stands by the door. Thes[saly and Thes@aly and Thes]saly wait.']);
    for (const text of ['a [red] cloak', 'a red] cloak', 'tall @ night', `tall${separator}grey`, 'tall\ngrey']) {
        assert.deepEqual(keptNotes([line('Thessaly', 'looks', text)], reply), [], JSON.stringify(text));
    }
    for (const name of ['Thes[saly', 'Thes@aly', 'Thes]saly']) {
        assert.deepEqual(keptNotes([line(name, 'looks', 'tall')], reply), [], name);
    }
    assert.equal(keptNotes([line('Thessaly', 'looks', 'tall | grey, he said: "x"')], reply).length, 1);
});

test('a name in the possessive or a contraction is found, a longer word is not', () => {
    const reply = placed(["Selene's silver hair glints; Thessaly'll wait; Veyra’d go; Orla’re here; Mavan’ve; Brin's."]);
    const names = ['Selene', 'Thessaly', 'Veyra', 'Orla', 'Mavan', 'Brin'];
    const found = keptNotes(
        names.map((name) => line(name, 'looks', 'tall')),
        reply,
    );
    assert.deepEqual(
        found.map((note) => note.name),
        names,
    );
    assert.equal(keptNotes([line('Selene', 'looks', 'tall')], placed(['Selenes hair glints.'])).length, 0);
    assert.equal(keptNotes([line('Selene', 'looks', 'tall')], placed(["Selene'sx hair glints."])).length, 0);
    assert.equal(keptNotes([line('Selene', 'looks', 'tall')], placed(["Selene's"])).length, 1);
    assert.equal(keptNotes([line('Selene', 'looks', 'tall')], placed(["Selene'llx"])).length, 0);
});

test('the player written with the transcript suffix is kept without it', () => {
    const speaking = { blocks: [{ text: 'I wait.', speaker: 'Orla', role: 'Player' }] };
    assert.deepEqual(keptNotes([line('Orla (player)', 'wearing', 'a grey travel cloak')], speaking), [
        { name: 'Orla', kind: 'Wearing', text: 'a grey travel cloak' },
    ]);
    assert.equal(keptNotes([line('Orla (player)', 'wearing', 'a cloak'), line('Orla', 'wearing', 'a hat')], speaking).length, 1);
    assert.equal(keptNotes([line('Orla (player)', 'wearing', 'a cloak')], placed(['Hello there.'])).length, 0);
    assert.equal(keptNotes([line(' (player)', 'wearing', 'a cloak')], speaking).length, 0);
});

test('a block with no speaker name does not stop the note check', () => {
    const blocks = [
        { text: 'Thessaly stands here.', speaker: null, role: 'Narrator' },
        { text: 'Hello.', role: 'Narrator' },
        { text: 'Hello.', speaker: 7, role: 'Narrator' },
    ];
    assert.equal(keptNotes([line('Thessaly', 'looks', 'tall')], { blocks }, [{ blocks }]).length, 1);
    assert.equal(keptNotes([line('Selene', 'looks', 'tall')], { blocks }, [{ blocks }]).length, 0);
});

test('a filler text says nothing and is dropped', () => {
    const fillers = [
        'not stated',
        'Unknown',
        'UNCLEAR.',
        'none',
        '(none)',
        'N/A',
        '-',
        '?',
        'not mentioned',
        'Not described.',
        'same',
        'unchanged',
        '(None).',
        '...',
        '  ',
    ];
    for (const filler of fillers) {
        assert.deepEqual(keptNotes([line('Thessaly', 'wearing', filler)]), [], JSON.stringify(filler));
    }
    assert.equal(keptNotes([line('Thessaly', 'wearing', 'the same grey cloak')]).length, 1);
    assert.equal(keptNotes([line('Thessaly', 'wearing', 'nonetheless dressed')]).length, 1);
});

test('an unknown kind is dropped', () => {
    assert.deepEqual(keptNotes([line('Thessaly', 'hair', 'silver'), line('Thessaly', 'Wearing', 'a cloak')]), []);
    assert.equal(keptNotes([line('Thessaly', 'wearing', 'a cloak'), line('Thessaly', 'looks', 'tall')]).length, 2);
});

test('at most twelve notes are kept, in answer order, and a repeat keeps the first', () => {
    const names = ['Alder', 'Birch', 'Cedar', 'Dogwood', 'Elm', 'Fir', 'Gorse', 'Hazel', 'Ivy', 'Juniper', 'Larch', 'Maple', 'Nettle'];
    const reply = placed([names.join(' and ')]);
    const lines = names.map((name) => line(name, 'wearing', `${name} coat`));
    const found = keptNotes(lines, reply);
    assert.equal(found.length, 12);
    assert.deepEqual(
        found.map((note) => note.name),
        names.slice(0, 12),
    );
    const repeats = keptNotes(
        [
            line('Thessaly', 'wearing', 'a cloak'),
            line('THESSALY', 'wearing', 'a coat'),
            line('Thessaly', 'looks', 'tall'),
            line('thessaly', 'looks', 'short'),
        ],
        placed(['Thessaly stands here.']),
    );
    assert.deepEqual(repeats, [
        { name: 'Thessaly', kind: 'Wearing', text: 'a cloak' },
        { name: 'Thessaly', kind: 'Looks', text: 'tall' },
    ]);
    const crowded = keptNotes(
        [...names.map((name) => line(name, 'wearing', 'x')), line('Alder', 'wearing', 'y')],
        reply,
    );
    assert.equal(crowded.length, 12);
    const repeated = [
        ...names.slice(0, 11).map((name) => line(name, 'wearing', 'x')),
        line('Alder', 'wearing', 'again'),
        line('Maple', 'wearing', 'last'),
    ];
    assert.deepEqual(
        keptNotes(repeated, reply).map((note) => note.name),
        [...names.slice(0, 11), 'Maple'],
    );
    assertFrozenDeep(ScribePedant.noted(reply, lines, []), 'noted');
});

test('review returns the notes beside the findings', async () => {
    const { state } = book();
    const reply = at(53);
    const text = answer({
        NOW: ['Halvart | wearing | a dented breastplate', 'Mirelle | looks | grey hair, short', 'Zorbax | wearing | a hood'],
    });
    const found = await ScribePedant.review({
        state,
        player: 'Orla',
        message: reply,
        unread: [reply],
        messages: story,
        ask: scriptedAsk({ text }).ask,
    });
    assertFrozenDeep(found, 'review');
    assert.deepEqual(plain(found.findings), []);
    assert.deepEqual(plain(found.notes), [
        { name: 'Halvart', kind: 'Wearing', text: 'a dented breastplate' },
        { name: 'Mirelle', kind: 'Looks', text: 'grey hair, short' },
    ]);
});

test('a name only in an older message outside the recent ones is dropped', async () => {
    const texts = ['Thessaly hums.', ...fillers(9), 'Veyra waits.', ...fillers(3), 'The reply.'];
    const messages = chatOf(texts);
    const reply = messages[messages.length - 1];
    const asked = scriptedAsk({
        text: answer({ NOW: ['Thessaly | wearing | a cloak', 'Veyra | wearing | a coat'] }),
    });
    const found = await ScribePedant.review({
        state: subjectsOnly(['Orla']).state,
        player: 'Orla',
        message: reply,
        unread: [reply],
        messages,
        ask: asked.ask,
    });
    assert.equal(asked.calls[0][1].includes('Thessaly hums.'), false);
    assert.deepEqual(plain(found.notes), [{ name: 'Veyra', kind: 'Wearing', text: 'a coat' }]);
});

test('a name only as a speaker label of the reply is kept, and a name in no message is dropped', async () => {
    const builder = new CampaignBuilder('Orla');
    builder.reply([
        ['Thessaly', '“Hello there.”'],
        ['Narrator', 'The door opens.'],
    ]);
    const [reply] = ScribeIntake.read(builder.messages).messages;
    const asked = scriptedAsk({ text: answer({ NOW: ['Thessaly | looks | tall', 'Zorbax | wearing | a hat'] }) });
    const found = await ScribePedant.review({
        state: subjectsOnly(['Orla']).state,
        player: 'Orla',
        message: reply,
        unread: [reply],
        messages: [reply],
        ask: asked.ask,
    });
    assert.deepEqual(plain(found.notes), [{ name: 'Thessaly', kind: 'Looks', text: 'tall' }]);
});

test('a player message gives no notes and the model failing gives none', async () => {
    const own = at(47);
    const played = await ScribePedant.review({ state: book().state, player: 'Orla', message: own, unread: [own], ask: null });
    assert.deepEqual(plain(played), { findings: [], notes: [] });
    await assert.rejects(
        ScribePedant.review({
            state: book().state,
            player: 'Orla',
            message: at(53),
            unread: [at(53)],
            ask: async () => {
                throw new Error('the model is down');
            },
        }),
        /the model is down/u,
    );
});
