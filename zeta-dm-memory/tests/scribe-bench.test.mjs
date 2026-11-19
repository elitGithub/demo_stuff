import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import CampaignBuilder from './support/CampaignBuilder.mjs';
import FakePage from './support/FakePage.mjs';
import FakeServer from './support/FakeServer.mjs';

const { ScribeIntake, ScribeAnswer, ScribeLog, ScribeReplay, ScribeAnalyzer, BenchView, BenchPage } = FakePage.load();

const builder = new CampaignBuilder('Orla');
for (let number = 1; number <= 100; number++) {
    if (number % 2 === 0) {
        builder.player(`I answer the ferryman, line ${number}.`);
    } else {
        builder.narrator(`The tale goes on, line ${number}.`);
    }
}
const story = ScribeIntake.read(builder.messages).messages;
const storyOrder = story.map((message) => message.id);
const exported = JSON.stringify({ messages: builder.messages });
const prose = 'I could not tell which lines matter | the story runs long.';

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
 * @param {object} log
 * @return {object}
 */
function replay(log) {
    return ScribeReplay.run(log, storyOrder);
}

/**
 * @param {object} log
 * @param {string} text
 * @param {number} first
 * @param {number} last
 * @param {string} origin
 * @return {object}
 */
function apply(log, text, first, last, origin = 'Story') {
    const parsed = ScribeAnswer.parse(text);
    assert.deepEqual(plain(parsed.refused), [], text);
    const result = ScribeLog.append(log, replay(log), parsed.operations, {
        messages: story.slice(first - 1, last),
        origin,
    });
    assert.deepEqual(plain(result.refused), [], text);
    return log;
}

/**
 * @param {object} log
 * @param {object} operation
 * @return {object}
 */
function rule(log, operation) {
    ScribeLog.rule(log, replay(log), operation);
    return log;
}

/**
 * @param {object} log
 * @param {number} last
 * @return {object}
 */
function readTo(log, last) {
    const unread = story.slice(0, last).filter((message) => !Object.hasOwn(log.read, message.id));
    if (unread.length > 0) {
        ScribeLog.append(log, replay(log), [], { messages: unread, origin: 'Story' });
    }
    return log;
}

/**
 * @param {number} count
 * @return {object}
 */
function habits(count) {
    const lines = Array.from({ length: count }, (unused, index) => {
        const number = index + 1;
        return `Halvard | trait | habit number ${number} | #${number}`;
    });
    return apply(ScribeLog.create(), answer({ FACTS: lines }), 1, count);
}

/**
 * @param {readonly object[]} rows
 * @return {string[]}
 */
function factIds(rows) {
    return rows.map((row) => row.fact);
}

/**
 * @param {{ user: string }} call
 * @return {{ content: string, cost: number|null }}
 */
function scripted(call) {
    const range = call.user.match(/NEW MESSAGES \(#(\d+) to #(\d+)\):/);
    if (range !== null) {
        const first = Number(range[1]);
        const last = Number(range[2]);
        return {
            content: answer({
                SUBJECTS: ['Halvard | character', 'Mirelle | character'],
                FACTS: [
                    `Halvard | trait | keeps watch from line ${first} | #${first}`,
                    `Mirelle | trait | counts coins to line ${last} | #${last}`,
                    'Halvard | trait | #5',
                    'Halvard | trait | stern | #999',
                ],
            }),
            cost: 0.01,
        };
    }
    const marks = [...call.user.matchAll(/^\[#(\d+)\] /gm)].map((match) => Number(match[1]));
    return {
        content: answer({ FACTS: marks.map((mark) => `Halvard | background | settled at line ${mark} | #${mark}`) }),
        cost: 0.01,
    };
}

/**
 * @return {{ promise: Promise<void>, open: () => void }}
 */
function gate() {
    let open = null;
    const promise = new Promise((resolve) => {
        open = resolve;
    });
    return { promise, open };
}

/**
 * @param {object|null} log
 * @return {Object<string, string>}
 */
function folder(log) {
    const files = { 'campaign-a.json': exported };
    if (log !== null) {
        files['log-a.json'] = JSON.stringify(log);
    }
    return files;
}

/**
 * @param {object|null} log
 * @return {Promise<FakePage>}
 */
async function opened(log) {
    const page = await new FakePage(folder(log)).start();
    await page.choose('campaign-a.json');
    page.server.model = scripted;
    page.byId('key').value = 'sk-or-test-key';
    return page;
}

/**
 * @param {FakePage} page
 * @param {string} name
 * @return {object}
 */
function lastPosted(page, name) {
    return JSON.parse(page.server.postsOf(name).at(-1).body);
}

/**
 * @param {object} log
 * @return {object}
 */
function lastOperation(log) {
    return log.entries.at(-1).operations[0];
}

/**
 * @param {object} log
 * @return {number}
 */
function readCount(log) {
    return story.filter((message) => Object.hasOwn(log.read, message.id)).length;
}

/**
 * @param {FakePage} page
 * @param {string} label
 * @return {Promise<void>}
 */
async function openSubject(page, label) {
    page.click('tab-book');
    page.button(page.byId('subjects-list'), label).click();
    await page.idle();
}

/**
 * @param {FakePage} page
 * @param {string} id
 * @param {string} fact
 * @return {import('./support/FakeElement.mjs').default}
 */
function rowOf(page, id, fact) {
    const found = page.rows(id).filter((row) => row.getAttribute('data-fact') === fact);
    assert.equal(found.length, 1, `rows for ${fact}`);
    return found[0];
}

/**
 * @param {FakePage} page
 * @param {string} id
 * @param {string} text
 * @return {import('./support/FakeElement.mjs').default}
 */
function rowSaying(page, id, text) {
    const found = page.rows(id).filter((row) => row.textContent.includes(text));
    assert.equal(found.length, 1, `rows saying ${text}`);
    return found[0];
}

test('subjects are paged at twenty', () => {
    const lines = Array.from({ length: 45 }, (unused, index) => `Lantern ${index + 1} | item`);
    const state = replay(apply(ScribeLog.create(), answer({ SUBJECTS: lines }), 1, 1));
    assert.equal(state.subjects.length, 45);
    const first = BenchView.subjects(state, '', 1);
    const second = BenchView.subjects(state, '', 2);
    const third = BenchView.subjects(state, '', 3);
    assert.equal(first.pages, 3);
    assert.equal(first.rows.length, 20);
    assert.equal(second.rows.length, 20);
    assert.equal(third.rows.length, 5);
    assert.deepEqual(plain(BenchView.subjects(state, '', 9)), plain(third));
    assert.deepEqual(plain(BenchView.subjects(state, '', 0)), plain(first));
    const seen = [...first.rows, ...second.rows, ...third.rows].map((row) => row.id);
    assert.equal(new Set(seen).size, 45);
    const empty = BenchView.subjects(replay(ScribeLog.create()), '', 1);
    assert.deepEqual(plain(empty), { rows: [], pages: 1 });
});

test('people in the running scene come first', () => {
    const log = apply(
        ScribeLog.create(),
        answer({
            SUBJECTS: [
                'Halvard | character',
                'Mirelle | character',
                'Tamsin | character',
                'Oswin | character',
                'Aldrich | character',
                'Aldric | character',
            ],
            FACTS: [
                'Halvard | trait | brave | #2',
                'Halvard | trait | loud | #3',
                'Halvard | location | the mill | #4',
                'Tamsin | trait | quick | #2',
                'Tamsin | trait | sly | #3',
                'Oswin | trait | quiet | #2',
                'Oswin | trait | gruff | #3',
                'Mirelle | trait | shy | #5',
                'Aldrich | trait | old | #2',
                'Aldrich | trait | grey | #3',
                'Aldrich | trait | slow | #4',
                'Aldrich | trait | kind | #5',
            ],
            SCENES: [
                'Day 1 | #1-#9 | The harbour | public | present: Mirelle | She counts',
                'Day 1 | #2-#5 | The mill | private | present: Halvard | He waits',
            ],
        }),
        1,
        10,
    );
    rule(log, { type: 'Merge', from: 'S5', into: 'S6' });
    const state = replay(log);
    assert.deepEqual(
        plain(state.scenes.map((scene) => scene.place)),
        ['The harbour', 'The mill'],
    );
    const rows = BenchView.subjects(state, '', 1).rows;
    assert.deepEqual(plain(rows), [
        { id: 'S2', label: 'Mirelle', kind: 'character', facts: 1, present: true },
        { id: 'S6', label: 'Aldric', kind: 'character', facts: 4, present: false },
        { id: 'S1', label: 'Halvard', kind: 'character', facts: 3, present: false },
        { id: 'S4', label: 'Oswin', kind: 'character', facts: 2, present: false },
        { id: 'S3', label: 'Tamsin', kind: 'character', facts: 2, present: false },
    ]);
});

test('search matches names and other names', () => {
    const state = replay(
        apply(
            ScribeLog.create(),
            answer({
                SUBJECTS: ['Tamsin | character', 'Oswin (the miller) | character', 'Halvard | character'],
                NAMES: ['Nonette | Tamsin | #2'],
            }),
            1,
            5,
        ),
    );
    /**
     * @param {string} query
     * @return {string[]}
     */
    const found = (query) => plain(BenchView.subjects(state, query, 1).rows.map((row) => row.label));
    assert.deepEqual(found('NONETTE'), ['Tamsin']);
    assert.deepEqual(found('  Miller '), ['Oswin (the miller)']);
    assert.deepEqual(found('oSWIN'), ['Oswin (the miller)']);
    assert.deepEqual(found('brandt'), []);
    assert.deepEqual(found('   '), ['Halvard', 'Oswin (the miller)', 'Tamsin']);
});

test('a subject shows status, source and audience', () => {
    const log = apply(
        ScribeLog.create(),
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Aldrich | character', 'Aldric | character'],
            FACTS: [
                'Halvard | age | twenty-five | #2',
                'Halvard | age | thirty | #3',
                'Halvard | trait | fears the dark | hidden | #4',
                'Halvard | trait | sings at work | #4',
                'Halvard | relation to Mirelle | owes her a debt | #5',
                'Halvard | relation to the old king | fears him | #5',
                'Halvard | trait | hides a coin | hidden | #6',
                'Aldrich | trait | sly | #6',
            ],
            SCENES: ['Day 1 | #1-#6 | The mill | public | present: Halvard, Mirelle | They talk'],
        }),
        1,
        6,
    );
    apply(log, answer({ TOLD: ['F7 | Halvard | Mirelle | #7'] }), 7, 10);
    apply(log, answer({ FACTS: ['Halvard | background | served with the pikes | #12'] }), 12, 12, 'Notes');
    rule(log, {
        type: 'AddFact',
        subject: 'S1',
        category: 'trait',
        target: null,
        text: 'stubborn',
        hidden: false,
        cite: null,
        position: 0,
    });
    rule(log, { type: 'Merge', from: 'S3', into: 'S4' });
    const state = replay(log);
    const shown = BenchView.subject(state, 'S1');
    assert.equal(shown.id, 'S1');
    assert.equal(shown.heading, 'Halvard');
    assert.equal(shown.kind, 'character');
    assert.deepEqual(
        plain(shown.facts.map((fact) => fact.id)),
        plain(state.facts.filter((fact) => fact.subject === 'S1').map((fact) => fact.id)),
    );
    const byText = new Map(shown.facts.map((fact) => [fact.text, plain(fact)]));
    assert.deepEqual(byText.get('thirty'), {
        id: 'F2',
        category: 'age',
        text: 'thirty',
        source: '#3',
        status: 'Disputed',
        audience: 'Everyone',
        hidden: false,
        pinned: false,
    });
    assert.equal(byText.get('twenty-five').status, 'InForce');
    assert.equal(byText.get('fears the dark').audience, 'Halvard');
    assert.equal(byText.get('fears the dark').hidden, true);
    assert.equal(byText.get('hides a coin').audience, 'Halvard, Mirelle');
    assert.equal(byText.get('sings at work').audience, 'Everyone');
    assert.equal(byText.get('sings at work').source, '#4');
    assert.equal(byText.get('served with the pikes').source, 'notes #12');
    assert.equal(byText.get('stubborn').source, 'owner');
    assert.equal(byText.get('owes her a debt').category, 'relation to Mirelle');
    assert.equal(byText.get('fears him').category, 'relation to the old king');
    assert.equal(BenchView.subject(state, 'S99'), null);
    const merged = BenchView.subject(state, 'S3');
    assert.equal(merged.id, 'S4');
    assert.equal(merged.heading, 'Aldric');
    assert.deepEqual(plain(merged.aka), ['Aldrich']);
    assert.deepEqual(plain(merged.facts.map((fact) => fact.text)), ['sly']);
});

test('the timeline pages scenes', () => {
    const scenes = Array.from({ length: 25 }, (unused, index) => {
        const first = index * 2 + 1;
        let present = 'present: Halvard';
        if (index === 0) {
            present = 'present: Halvard (from #1 until #2), Mirelle (from #2), Tamsin (until #1), Oswin';
        } else if (index === 1) {
            present = 'present: nobody';
        }
        const reach = index === 3 ? 'private' : 'public';
        return `Day ${index + 1} | #${first}-#${first + 1} | The mill | ${reach} | ${present} | They talk`;
    });
    const log = apply(ScribeLog.create(), answer({ SCENES: scenes }), 1, 50);
    rule(log, { type: 'Narrow', scene: 'MESSAGE-5' });
    const state = replay(log);
    const first = BenchView.timeline(state, 1);
    const second = BenchView.timeline(state, 2);
    assert.equal(first.pages, 2);
    assert.equal(first.rows.length, 20);
    assert.equal(second.rows.length, 5);
    assert.deepEqual(plain(first.rows[0]), {
        id: 'MESSAGE-1',
        day: 1,
        range: '#1-#2',
        place: 'The mill',
        reach: 'public',
        present: 'Halvard (from #1 until #2), Mirelle (from #2), Tamsin (until #1), Oswin',
        summary: 'They talk',
    });
    assert.equal(first.rows[1].present, 'nobody');
    assert.equal(first.rows[2].reach, 'public, narrowed');
    assert.equal(first.rows[3].reach, 'private');
    assert.equal(second.rows[0].range, '#41-#42');
    assert.deepEqual(plain(BenchView.timeline(state, 7)), plain(second));
});

test('rulings lists what the owner must decide', () => {
    const log = apply(
        ScribeLog.create(),
        answer({
            SUBJECTS: [
                'Halvard | character',
                'Oswin | character',
                'Oswin (the miller) | character',
                'Aldrich | character',
                'Aldric | character',
            ],
            NAMES: ['Brandt | Halvard | #2'],
            FACTS: ['Halvard | age | twenty-five | #2', 'Halvard | age | thirty | hidden | #3'],
            SCENES: ['Day 1 | #1-#4 | The mill | public | present: Halvard | He waits'],
            QUESTIONS: ['Does Mirelle trust Halvard? | #3', 'Who rang the bell? | #4'],
        }),
        1,
        5,
    );
    apply(log, answer({ CHANGES: ['F1 | Halvard | age | FULLER: twenty-five at most | #6'] }), 6, 6);
    rule(log, { type: 'Answer', question: 'Q1', text: 'She does not' });
    const state = replay(log);
    const rulings = plain(BenchView.rulings(state));
    assert.deepEqual(rulings.conflicts, [
        {
            subject: 'S1',
            label: 'Halvard',
            category: 'age',
            established: 'F3',
            values: [
                { fact: 'F3', text: 'twenty-five at most', source: '#6', hidden: false, established: true },
                { fact: 'F2', text: 'thirty', source: '#3', hidden: true, established: false },
            ],
        },
    ]);
    assert.deepEqual(rulings.lookAlikes, [
        { first: 'S2', second: 'S3', firstLabel: 'Oswin', secondLabel: 'Oswin (the miller)', reason: 'SameName' },
        { first: 'S4', second: 'S5', firstLabel: 'Aldrich', secondLabel: 'Aldric', reason: 'Spelling' },
    ]);
    assert.deepEqual(rulings.publicScenes, [
        {
            id: 'MESSAGE-1',
            day: 1,
            range: '#1-#4',
            place: 'The mill',
            reach: 'public',
            present: 'Halvard',
            summary: 'He waits',
        },
    ]);
    assert.deepEqual(rulings.questions, [
        { id: 'Q1', text: 'Does Mirelle trust Halvard?', position: 3, answer: 'She does not' },
        { id: 'Q2', text: 'Who rang the bell?', position: 4, answer: null },
    ]);
    assert.deepEqual(rulings.refinements, [
        { label: 'Halvard', category: 'age', from: 'twenty-five', to: 'twenty-five at most' },
    ]);
    assert.deepEqual(rulings.aliases, [{ subject: 'S1', label: 'Halvard', name: 'Brandt' }]);
    assert.equal(BenchView.blocking(state), 2);
    rule(log, { type: 'Dismiss', question: 'Q2' });
    rule(log, { type: 'Narrow', scene: 'MESSAGE-1' });
    rule(log, { type: 'Distinct', first: 'S4', second: 'S5' });
    const later = replay(log);
    const after = plain(BenchView.rulings(later));
    assert.deepEqual(after.questions.map((question) => question.id), ['Q1']);
    assert.deepEqual(after.publicScenes, []);
    assert.equal(BenchView.blocking(later), 2);
    rule(log, { type: 'Distinct', first: 'S2', second: 'S3' });
    assert.equal(BenchView.blocking(replay(log)), 1);
});

test('rulings made are listed newest first', () => {
    const log = apply(
        ScribeLog.create(),
        answer({
            SUBJECTS: ['Halvard | character', 'Aldrich | character', 'Aldric | character'],
            FACTS: ['Halvard | age | twenty-five | #2', 'Halvard | age | thirty | #3'],
            SCENES: ['Day 1 | #1-#4 | The mill | public | present: Halvard | He waits'],
        }),
        1,
        5,
    );
    rule(log, { type: 'Pin', subject: 'S1', category: 'age', target: null, text: 'forty', hidden: false });
    rule(log, { type: 'Merge', from: 'S2', into: 'S3' });
    rule(log, { type: 'Narrow', scene: 'MESSAGE-1' });
    assert.equal(ScribeLog.revoke(log, 4).sequence, 4);
    assert.deepEqual(plain(BenchView.made(log)), [
        { sequence: 3, type: 'Merge', summary: 'Merge S2 into S3' },
        { sequence: 2, type: 'Pin', summary: 'Pin age: forty' },
    ]);
});

test('the audit draws thirty and is repeatable', () => {
    const many = replay(habits(45));
    const drawn = BenchView.audit(many, story, 7);
    assert.equal(drawn.length, 30);
    assert.equal(new Set(factIds(drawn)).size, 30);
    assert.deepEqual(factIds(BenchView.audit(many, story, 7)), factIds(drawn));
    assert.notDeepEqual(factIds(BenchView.audit(many, story, 8)), factIds(drawn));
    assert.notDeepEqual(factIds(drawn), many.facts.slice(0, 30).map((fact) => fact.id));
    const few = replay(habits(12));
    const all = BenchView.audit(few, story, 7);
    assert.equal(all.length, 12);
    assert.deepEqual(new Set(factIds(all)), new Set(few.facts.map((fact) => fact.id)));
});

test('the audit shows the cited message', () => {
    const state = replay(habits(12));
    const drawn = BenchView.audit(state, story, 3);
    assert.equal(drawn.length, 12);
    for (const row of drawn) {
        assert.equal(row.message, story[row.position - 1].text);
        assert.equal(row.subject, 'Halvard');
        assert.equal(row.category, 'trait');
        assert.equal(row.text, `habit number ${row.position}`);
    }
    const without = story.filter((message) => message.position !== 5);
    const gone = BenchView.audit(state, without, 3);
    for (const row of gone) {
        assert.equal(row.message, row.position === 5 ? '' : story[row.position - 1].text);
    }
    assert.equal(gone.filter((row) => row.message === '').length, 1);
});

test('the audit excludes what is not in force or not from the story', () => {
    const log = apply(
        ScribeLog.create(),
        answer({
            SUBJECTS: ['Halvard | character'],
            FACTS: [
                'Halvard | trait | keeps watch | #1',
                'Halvard | status | awake | #1',
                'Halvard | age | twenty-five | #2',
                'Halvard | age | thirty | #3',
                'Halvard | condition | tired | #4',
                'Halvard | location | the mill | #5',
                'Halvard | trait | hums | #6',
            ],
            NIGHTS: ['#8 | Night falls'],
        }),
        1,
        10,
    );
    apply(
        log,
        answer({ CHANGES: ['F6 | Halvard | location | ENDED: he left | #11', 'F2 | Halvard | status | asleep | #11'] }),
        11,
        11,
    );
    apply(log, answer({ FACTS: ['Halvard | background | served with the pikes | #12'] }), 12, 12, 'Notes');
    rule(log, { type: 'RemoveFact', fact: 'F7' });
    rule(log, {
        type: 'AddFact',
        subject: 'S1',
        category: 'trait',
        target: null,
        text: 'stubborn',
        hidden: false,
        cite: 'MESSAGE-11',
        position: 11,
    });
    const state = replay(log);
    const kinds = new Set(state.facts.map((fact) => fact.status).concat(state.facts.map((fact) => fact.origin)));
    for (const kind of ['Disputed', 'Expired', 'Ended', 'Removed', 'Replaced', 'Notes', 'Operator']) {
        assert.equal(kinds.has(kind), true, kind);
    }
    const drawn = BenchView.audit(state, story, 5);
    assert.deepEqual(plain(drawn.map((row) => row.text)).sort(), ['asleep', 'keeps watch', 'twenty-five']);
});

test('progress lines', () => {
    const story41 = {
        pass: 'Story',
        first: 41,
        last: 80,
        read: 80,
        total: 100,
        spent: 0.12,
        calls: 2,
        unpriced: 0,
        stored: 23,
        refusedLines: [{ block: 'FACTS', line: 'Halvard | trait | #45', reason: 'Shape' }],
        refusedOperations: [{ operation: { type: 'Fact' }, reason: 'Citation' }],
    };
    assert.equal(BenchView.progress(story41), '#41 to #80: 23 stored, 2 refused, $0.1200 spent, 80 of 100 read');
    const quiet = { refusedLines: [], refusedOperations: [], read: 40, spent: 0.25, stored: 3 };
    assert.equal(
        BenchView.progress({ ...story41, ...quiet, pass: 'Notes' }),
        'Notes: 3 stored, 0 refused, $0.2500 spent, 40 of 100 read',
    );
    assert.equal(
        BenchView.progress({ ...story41, ...quiet, pass: 'Notes', first: null, last: null }),
        'Notes: 3 stored, 0 refused, $0.2500 spent, 40 of 100 read',
    );
    assert.equal(
        BenchView.progress({ ...story41, ...quiet, pass: 'Answers', first: null, last: null }),
        'Answers: 3 stored, 0 refused, $0.2500 spent, 40 of 100 read',
    );
    assert.equal(
        BenchView.progress({ ...story41, unpriced: 2 }),
        '#41 to #80: 23 stored, 2 refused, $0.1200 spent, 2 calls unpriced, 80 of 100 read',
    );
    assert.equal(
        BenchView.progress({ ...story41, unpriced: 1, read: 1200, total: 1326 }),
        '#41 to #80: 23 stored, 2 refused, $0.1200 spent, 1 call unpriced, 1,200 of 1,326 read',
    );
    assert.equal(BenchView.money(3), '$3.0000');
    assert.equal(BenchView.money(0.1), '$0.1000');
    assert.equal(BenchView.money(12.5), '$12.5000');
});

test('every element the page asks for exists in the markup', () => {
    const markup = readFileSync(new URL('../scribe/bench/adopt.html', import.meta.url), 'utf8');
    for (const id of Object.values(BenchPage.Settings.Ids)) {
        assert.equal(markup.split(`id="${id}"`).length - 1, 1, id);
    }
    assert.doesNotMatch(markup, /\sstyle\s*=/i);
    assert.doesNotMatch(markup, /\son[a-z]+\s*=/i);
    const scripts = [...markup.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    for (const [, attributes, body] of scripts) {
        assert.match(attributes, /\ssrc="[^"]+"/);
        assert.equal(body.trim(), '');
    }
    const sources = scripts.map(([, attributes]) => attributes.match(/\ssrc="([^"]+)"/)[1]);
    const core = sources.filter((source) => source.startsWith('../core/'));
    assert.equal(
        sources.slice(0, core.length).every((source) => source.startsWith('../core/')),
        true,
    );
    assert.deepEqual(sources.slice(core.length), ['BenchView.js', 'BenchPage.js', 'BenchStart.js']);
    const folder = new URL('../scribe/core/', import.meta.url);
    const files = readdirSync(folder)
        .filter((name) => name.endsWith('.js'))
        .sort();
    assert.deepEqual(core.map((source) => source.slice('../core/'.length)).sort(), files);
    const names = core.map((source) => source.slice('../core/'.length, -'.js'.length));
    const uses = new Map(
        names.map((name) => {
            const text = readFileSync(new URL(`${name}.js`, folder), 'utf8');
            const used = [...text.matchAll(/\bScribe[A-Z][A-Za-z]+\b/g)].map((match) => match[0]);
            return [name, new Set(used.filter((other) => other !== name && names.includes(other)))];
        }),
    );
    names.forEach((name, index) => {
        for (const used of uses.get(name)) {
            const mutual = uses.get(used).has(name);
            assert.equal(names.indexOf(used) < index || mutual, true, `${used} loads before ${name}`);
        }
    });
    const css = readFileSync(new URL('../scribe/bench/bench.css', import.meta.url), 'utf8');
    const colour =
        /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![\w-])(?:black|white|red|green|blue|yellow|orange|purple|pink|gr[ae]y|silver|navy|maroon|teal|olive|lime|aqua|fuchsia)(?![\w-])/i;
    let tokens = 0;
    for (const line of css.split('\n')) {
        if (colour.test(line)) {
            assert.match(line, /^\s*--[\w-]+\s*:/, line);
            tokens++;
        }
    }
    assert.equal(tokens > 0, true);
});

/**
 * @param {FakePage} page
 * @param {number} count
 * @return {Promise<void>}
 */
async function arrival(page, count) {
    for (let turn = 0; turn < 200 && page.server.modelCalls.length < count; turn++) {
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(page.server.modelCalls.length >= count, true, `${count} model calls`);
}

/**
 * @return {Promise<void>}
 */
async function flush() {
    for (let turn = 0; turn < 20; turn++) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

/**
 * @param {import('./support/FakeElement.mjs').default} element
 * @return {string}
 */
function named(element) {
    return element.id || element.getAttribute('data-key') || element.textContent;
}

/**
 * @param {FakePage} page
 * @return {import('./support/FakeElement.mjs').default[]}
 */
function lockable(page) {
    const ids = ['campaign', 'model', 'size', 'stop', 'budget', 'start', 'continue', 'keep-first', 'add-file', 'split-file'];
    return [...ids.map((id) => page.byId(id)), ...controlsIn(page.byId('panel-rulings'))];
}

/**
 * @param {FakePage} page
 * @return {Promise<string[]>}
 */
async function auditIds(page) {
    const ids = page.rows('audit-list').map((row) => row.getAttribute('data-fact'));
    if (!page.byId('audit-next').disabled) {
        page.click('audit-next');
        await page.idle();
        ids.push(...page.rows('audit-list').map((row) => row.getAttribute('data-fact')));
        page.click('audit-previous');
        await page.idle();
    }
    return ids;
}

/**
 * @param {FakePage} page
 * @param {{ promise: Promise<void> }} held
 * @return {void}
 */
function holdFirst(page, held) {
    page.server.model = async (call, count) => {
        if (count === 1) {
            await held.promise;
        }
        return scripted(call);
    };
}

/**
 * @return {object}
 */
function disputedBook() {
    const log = apply(
        ScribeLog.create(),
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character'],
            FACTS: [
                'Halvard | age | twenty-five | #2',
                'Halvard | age | thirty | hidden | #3',
                'Mirelle | eyes | grey | #2',
                'Mirelle | eyes | blue | #3',
            ],
        }),
        1,
        3,
    );
    return readTo(log, 40);
}

/**
 * @return {object}
 */
function oswinBook() {
    const log = apply(
        ScribeLog.create(),
        answer({
            SUBJECTS: ['Oswin | character', 'Halvard | character'],
            FACTS: [
                'Oswin | trait | quiet | #1',
                'Oswin | trait | gruff | #2',
                'Oswin | belonging | a fishing rod | #3',
                'Oswin | location | the mill | #4',
            ],
        }),
        1,
        4,
    );
    return readTo(log, 40);
}

/**
 * @param {FakePage} page
 * @param {string} fact
 * @return {void}
 */
function tick(page, fact) {
    const [box] = page.inputs(rowOf(page, 'facts-list', fact), 'checkbox');
    box.checked = true;
    box.dispatchEvent({ type: 'change' });
}

/**
 * @param {import('./support/FakeElement.mjs').default} root
 * @return {import('./support/FakeElement.mjs').default[]}
 */
function controlsIn(root) {
    return root
        .descendants()
        .filter((element) => ['BUTTON', 'INPUT', 'SELECT'].includes(element.tagName))
        .filter((element) => !/-(previous|next)$/.test(element.id));
}

test('choosing a campaign shows a saved book', async () => {
    const saved = apply(
        ScribeLog.create(),
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character'],
            FACTS: ['Halvard | trait | brave | #2', 'Mirelle | trait | shy | #3'],
        }),
        1,
        3,
    );
    readTo(saved, 80);
    const files = {
        ...folder(saved),
        'campaign-c.json': '{"messages": 3}',
        'campaign-d.txt': 'plain text',
        'calls-of-the-harbour-1.json': '{}',
        'log-b.json': '{}',
        'notes.txt': 'plain notes',
    };
    const page = await new FakePage(files).start();
    assert.equal(page.text('status'), 'Choose a campaign.');
    assert.deepEqual(
        page.byId('campaign').children.map((option) => option.value),
        ['', 'campaign-a.json', 'campaign-c.json'],
    );
    assert.equal(page.byId('start').disabled, true);
    assert.equal(page.byId('continue').disabled, true);
    page.set('campaign', 'campaign-a.json', 'change');
    assert.equal(page.text('status'), 'Loading campaign-a.json...');
    assert.equal(page.byId('campaign').disabled, true);
    await page.idle();
    assert.equal(page.text('status'), 'A saved book exists: 80 of 100 messages read.');
    assert.equal(page.byId('continue').disabled, false);
    assert.equal(page.byId('start').disabled, false);
    page.click('tab-book');
    await page.idle();
    assert.equal(page.byId('panel-book').hidden, false);
    assert.equal(page.byId('panel-progress').hidden, true);
    assert.deepEqual(page.rows('subjects-list').map((row) => row.children[0].textContent).sort(), [
        'Halvard',
        'Mirelle',
    ]);
    await page.choose('campaign-c.json');
    assert.equal(page.text('status'), 'campaign-c.json cannot be used: it is not an export with a list of messages');
    assert.equal(page.byId('start').disabled, true);
    assert.equal(page.byId('continue').disabled, true);
    assert.equal(page.rows('subjects-list').length, 0);
    assert.deepEqual(page.server.modelCalls, []);
});

test('a run saves after every step', async () => {
    const page = await opened(null);
    assert.equal(page.text('status'), 'No saved book for this campaign yet: Start begins one.');
    page.click('start');
    assert.equal(page.text('status'), 'Building the book.');
    await page.idle();
    assert.deepEqual(page.questions, []);
    const endpoint = FakeServer.Endpoint;
    assert.deepEqual(
        page.server.requests.filter((request) => request.method === 'POST').map((request) => request.url),
        [
            endpoint,
            '/private/log-a.json',
            '/private/calls-a-1.json',
            endpoint,
            '/private/log-a.json',
            '/private/calls-a-2.json',
            endpoint,
            '/private/log-a.json',
            '/private/calls-a-3.json',
        ],
    );
    assert.deepEqual(
        page.server.postsOf('log-a.json').map((request) => readCount(JSON.parse(request.body))),
        [40, 80, 100],
    );
    for (const [index, call] of page.server.modelCalls.entries()) {
        const record = page.saved(`calls-a-${index + 1}.json`);
        assert.deepEqual(Object.keys(record), [
            'sequence',
            'pass',
            'system',
            'input',
            'answer',
            'readable',
            'refusedLines',
            'refusedOperations',
        ]);
        assert.equal(record.sequence, index + 1);
        assert.equal(record.pass, 'Story');
        assert.equal(record.system, ScribeAnalyzer.Prompt);
        assert.equal(record.input, call.user);
        assert.equal(record.answer, scripted(call).content);
        assert.equal(record.readable, true);
        assert.deepEqual(record.refusedLines, [{ block: 'FACTS', line: 'Halvard | trait | #5', reason: 'Shape' }]);
        assert.deepEqual(
            record.refusedOperations.map((item) => [item.operation.text, item.reason]),
            [['stern', 'Citation']],
        );
    }
    assert.equal(page.text('status'), 'Done: every message is read.');
    const rows = page.rows('progress-list');
    assert.deepEqual(
        rows.map((row) => row.children[0].textContent),
        [
            'Done: every message is read.',
            '#81 to #100: 2 stored, 2 refused, $0.0300 spent, 100 of 100 read',
            '#41 to #80: 2 stored, 2 refused, $0.0200 spent, 80 of 100 read',
            '#1 to #40: 4 stored, 2 refused, $0.0100 spent, 40 of 100 read',
        ],
    );
    assert.deepEqual(
        rows[1]
            .descendants()
            .filter((element) => element.tagName === 'LI')
            .map((element) => element.textContent),
        ['Halvard | trait | #5 (Shape)', 'Fact | Halvard | trait | stern (Citation)'],
    );
});

test('the key is not saved', async () => {
    const first = 'sk-or-v1-halvard-0123456789abcdef';
    const second = 'sk-or-v1-mirelle-fedcba9876543210';
    const page = await opened(null);
    page.byId('key').value = first;
    const held = gate();
    holdFirst(page, held);
    page.server.refusing.add('calls-a-2.json');
    page.click('start');
    await arrival(page, 1);
    page.byId('key').value = second;
    held.open();
    await page.idle();
    const calls = page.server.modelCalls;
    assert.equal(calls.length, 3);
    assert.deepEqual(
        calls.map((call) => call.headers.Authorization),
        [`Bearer ${first}`, `Bearer ${second}`, `Bearer ${second}`],
    );
    for (const key of [first, second]) {
        for (const request of page.server.requests) {
            assert.equal(request.url.includes(key), false, request.url);
            assert.equal(String(request.body).includes(key), false, request.url);
            const headers = Object.entries(request.headers).filter(([name]) => name !== 'Authorization');
            assert.equal(JSON.stringify(headers).includes(key), false, request.url);
            if (request.url !== FakeServer.Endpoint) {
                assert.equal(JSON.stringify(request.headers).includes(key), false, request.url);
            }
        }
        for (const content of page.server.files.values()) {
            assert.equal(content.includes(key), false);
        }
        for (const element of page.document.elements) {
            assert.equal(element.textContent.includes(key), false, element.tagName);
            const written = element.written.filter((item) => element.id !== 'key' || item.kind !== 'value');
            assert.equal(written.some((item) => item.text.includes(key)), false, element.tagName);
        }
    }
    assert.deepEqual(page.stored, []);
    assert.deepEqual(page.logged, []);
    assert.equal(
        page.text('progress-list').includes('The call record calls-a-2.json was not saved: the server answered 500'),
        true,
    );
    assert.equal(page.text('status'), 'Done: every message is read.');
});

test('continue resumes a saved book', async () => {
    const page = await opened(readTo(ScribeLog.create(), 40));
    assert.equal(page.text('status'), 'A saved book exists: 40 of 100 messages read.');
    page.click('continue');
    await page.idle();
    assert.deepEqual(page.questions, []);
    assert.equal(page.server.modelCalls.length, 2);
    assert.match(page.server.modelCalls[0].user, /NEW MESSAGES \(#41 to #80\):/);
    assert.equal(readCount(page.saved('log-a.json')), 100);
    assert.equal(page.saved('log-a.json').entries[0].messageIds.length, 40);
});

test('start over asks first', async () => {
    const page = await opened(readTo(ScribeLog.create(), 40));
    page.confirming = false;
    page.click('start');
    await page.idle();
    assert.deepEqual(page.questions, ['Start a new book? It replaces the saved book for this campaign.']);
    assert.deepEqual(page.server.modelCalls, []);
    assert.deepEqual(page.server.posts, []);
    page.confirming = true;
    page.click('start');
    await page.idle();
    assert.equal(page.questions.length, 2);
    assert.match(page.server.modelCalls[0].user, /NEW MESSAGES \(#1 to #40\):/);
    const saved = page.saved('log-a.json');
    assert.deepEqual(
        saved.entries.map((entry) => [entry.sequence, entry.messageIds[0]]),
        [
            [1, 'MESSAGE-1'],
            [2, 'MESSAGE-41'],
            [3, 'MESSAGE-81'],
        ],
    );
});

test('stop after a message', async () => {
    const page = await opened(null);
    page.byId('stop').value = '40';
    page.click('start');
    await page.idle();
    assert.equal(page.server.modelCalls.length, 1);
    assert.match(page.server.modelCalls[0].user, /NEW MESSAGES \(#1 to #40\):/);
    assert.equal(page.text('status'), 'Done: every message up to #40 is read; 40 of 100 in the campaign.');
    assert.equal(readCount(page.saved('log-a.json')), 40);
});

test('a field that cannot be used is marked and nothing starts', async () => {
    const page = await opened(null);
    page.byId('key').value = '   ';
    page.byId('model').value = ' ';
    page.byId('size').value = '2.5';
    page.byId('stop').value = 'forty';
    page.byId('budget').value = '-1';
    page.click('start');
    await page.idle();
    assert.equal(page.text('key-problem'), 'Enter the OpenRouter key.');
    assert.equal(page.text('model-problem'), 'Enter a model.');
    assert.equal(page.text('size-problem'), 'Messages per stretch must be a whole number of at least 1.');
    assert.equal(page.text('stop-problem'), 'Stop after message must be blank or a whole number of at least 1.');
    assert.equal(page.text('budget-problem'), 'The budget must be a number of dollars, 0 or more.');
    assert.equal(page.text('status'), 'Nothing was started: a field above needs attention.');
    assert.deepEqual(page.server.modelCalls, []);
    page.byId('size').value = '0';
    page.click('start');
    await page.idle();
    assert.equal(page.text('size-problem'), 'Messages per stretch must be a whole number of at least 1.');
    page.byId('key').value = 'sk-or-test-key';
    page.byId('model').value = 'mistralai/mistral-large-4-0';
    page.byId('size').value = '40';
    page.byId('stop').value = '';
    page.byId('budget').value = '0.5';
    page.click('start');
    await page.idle();
    for (const id of ['key-problem', 'model-problem', 'size-problem', 'stop-problem', 'budget-problem']) {
        assert.equal(page.text(id), '', id);
    }
    assert.equal(page.server.modelCalls.length, 3);
});

test('a failed call shows why and can be resumed', async () => {
    const page = await opened(null);
    page.server.model = (call, count) => (count === 2 ? { status: 400 } : scripted(call));
    page.click('start');
    await page.idle();
    const problem = 'Stopped: unexpected HTTP status; status 400; finish none; reason: Refused by the fake provider';
    assert.equal(page.text('status'), problem);
    assert.equal(page.rows('progress-list')[0].textContent, problem);
    assert.equal(page.byId('continue').disabled, false);
    assert.equal(page.byId('start').disabled, false);
    assert.equal(readCount(page.saved('log-a.json')), 40);
    page.server.model = scripted;
    page.click('continue');
    await page.idle();
    assert.equal(page.server.modelCalls.length, 4);
    assert.match(page.server.modelCalls[2].user, /NEW MESSAGES \(#41 to #80\):/);
    assert.equal(page.text('status'), 'Done: every message is read.');
});

test('a failed save reloads the saved book', async () => {
    const page = await opened(readTo(ScribeLog.create(), 40));
    page.server.model = (call, count) => {
        if (count === 2) {
            page.server.refusing.add('log-a.json');
        }
        return scripted(call);
    };
    page.click('continue');
    await page.idle();
    assert.equal(page.text('status'), 'Stopped: the server answered 500');
    assert.equal(page.server.postsOf('log-a.json').length, 2);
    assert.equal(readCount(page.saved('log-a.json')), 80);
    assert.equal(page.server.requests.at(-1).url, '/private/log-a.json');
    assert.equal(page.server.requests.at(-1).method, 'GET');
    assert.equal(page.server.postsOf('calls-a-3.json').length, 0);
    assert.equal(page.byId('continue').disabled, false);
    page.server.refusing.clear();
    page.server.model = scripted;
    page.click('continue');
    await page.idle();
    assert.match(page.server.modelCalls[2].user, /NEW MESSAGES \(#81 to #100\):/);
    assert.equal(readCount(page.saved('log-a.json')), 100);
});

test('the waiting line appears at once and counts', async () => {
    const page = await opened(null);
    const held = gate();
    holdFirst(page, held);
    page.byId('stop').value = '40';
    page.click('start');
    await arrival(page, 1);
    assert.equal(page.text('waiting'), 'Waiting for the model on #1 to #40: 0s');
    assert.equal(page.byId('waiting').hidden, false);
    page.clock.advance(2000);
    assert.equal(page.text('waiting'), 'Waiting for the model on #1 to #40: 2s');
    held.open();
    await page.idle();
    assert.equal(page.text('waiting'), '');
    assert.equal(page.byId('waiting').hidden, true);
    assert.equal(page.clock.intervals, 0);
});

test('pause stops after the stretch in flight', async () => {
    const page = await opened(null);
    const held = gate();
    holdFirst(page, held);
    page.click('start');
    await arrival(page, 1);
    assert.equal(page.byId('pause').disabled, false);
    page.click('pause');
    assert.equal(page.text('status'), 'Pausing after the stretch in flight.');
    assert.equal(page.byId('pause').disabled, true);
    held.open();
    await page.idle();
    assert.equal(page.server.modelCalls.length, 1);
    assert.equal(page.text('status'), 'Paused after #40.');
    assert.equal(readCount(page.saved('log-a.json')), 40);
    assert.equal(page.byId('continue').disabled, false);
    assert.equal(page.byId('pause').disabled, true);
});

test('controls are locked while a run is in flight', async () => {
    const log = apply(
        ScribeLog.create(),
        answer({
            SUBJECTS: ['Halvard | character', 'Oswin | character', 'Oswin (the miller) | character'],
            NAMES: ['Brandt | Halvard | #2'],
            FACTS: ['Halvard | age | twenty-five | #2', 'Halvard | age | thirty | #3', 'Halvard | trait | brave | #3'],
            SCENES: ['Day 1 | #1-#4 | The mill | public | present: Halvard | He waits'],
            QUESTIONS: ['Who rang the bell? | #4'],
        }),
        1,
        4,
    );
    rule(log, { type: 'Widen', fact: 'F3', to: 'Everyone' });
    const page = await opened(readTo(log, 40));
    await openSubject(page, 'Halvard');
    page.click('tab-rulings');
    await page.idle();
    const held = gate();
    holdFirst(page, held);
    page.click('continue');
    await arrival(page, 1);
    assert.equal(page.byId('start').disabled, true);
    assert.equal(page.byId('continue').disabled, true);
    assert.equal(page.byId('pause').disabled, false);
    for (const id of ['campaign', 'model', 'size', 'stop', 'budget']) {
        assert.equal(page.byId(id).disabled, true, id);
    }
    assert.equal(page.byId('key').disabled, false);
    const rulings = controlsIn(page.byId('panel-rulings'));
    assert.equal(rulings.length, 15);
    assert.deepEqual(
        rulings.filter((control) => !control.disabled).map((control) => control.textContent),
        [],
    );
    page.click('tab-book');
    await new Promise((resolve) => setImmediate(resolve));
    const book = controlsIn(page.byId('detail'));
    assert.equal(book.length, 17);
    assert.deepEqual(
        book.filter((control) => !control.disabled).map((control) => control.id || control.textContent),
        [],
    );
    held.open();
    await page.idle();
    assert.equal(page.byId('continue').disabled, false);
    assert.equal(page.byId('start').disabled, false);
    assert.deepEqual(
        controlsIn(page.byId('detail')).filter((control) => control.disabled).map((control) => control.id),
        [],
    );
    page.click('tab-rulings');
    await page.idle();
    assert.deepEqual(
        controlsIn(page.byId('panel-rulings')).filter((control) => control.disabled).map((control) => control.id),
        [],
    );
});

test('choosing a value pins it', async () => {
    const page = await opened(disputedBook());
    page.click('tab-rulings');
    await page.idle();
    assert.equal(page.text('tab-rulings'), 'Rulings (2)');
    assert.equal(page.rows('conflicts-list').length, 2);
    page.server.refusing.add('log-a.json');
    const refused = rowSaying(page, 'conflicts-list', 'Halvard, age');
    page.button(refused, 'thirty (#3), hidden').click();
    await page.idle();
    assert.equal(refused.textContent.includes('The ruling was not saved: the server answered 500'), true);
    assert.equal(page.rows('conflicts-list').length, 2);
    page.server.refusing.clear();
    const halvard = rowSaying(page, 'conflicts-list', 'Halvard, age');
    page.button(halvard, 'thirty (#3), hidden').click();
    assert.equal(halvard.textContent.includes('Saving...'), true);
    await page.idle();
    assert.equal(page.server.postsOf('log-a.json').length, 2);
    const pinned = lastOperation(page.saved('log-a.json'));
    assert.deepEqual(
        [pinned.type, pinned.subject, pinned.category, pinned.text, pinned.hidden],
        ['Pin', 'S1', 'age', 'thirty', true],
    );
    assert.equal(page.rows('conflicts-list').length, 1);
    assert.equal(page.text('tab-rulings'), 'Rulings (1)');
    const mirelle = rowSaying(page, 'conflicts-list', 'Mirelle, eyes');
    page.inputs(mirelle, 'text')[0].value = 'green';
    page.inputs(mirelle, 'checkbox')[0].checked = true;
    page.button(mirelle, 'Pin this value').click();
    await page.idle();
    const other = lastOperation(page.saved('log-a.json'));
    assert.deepEqual(
        [other.type, other.subject, other.category, other.text, other.hidden],
        ['Pin', 'S2', 'eyes', 'green', true],
    );
    assert.equal(page.rows('conflicts-list').length, 0);
    assert.equal(page.text('tab-rulings'), 'Rulings');
    assert.deepEqual(plain(replay(page.saved('log-a.json')).conflicts), []);
});

test('keep the first value clears every conflict', async () => {
    const book = disputedBook();
    const page = await opened(book);
    page.click('tab-rulings');
    await page.idle();
    assert.equal(page.rows('conflicts-list').length, 2);
    page.click('keep-first');
    await page.idle();
    assert.equal(page.server.postsOf('log-a.json').length, 1);
    const saved = page.saved('log-a.json');
    assert.equal(saved.entries.length, book.entries.length + 2);
    assert.deepEqual(
        saved.entries.slice(-2).map((entry) => [entry.kind, entry.operations[0].type, entry.operations[0].text]),
        [
            ['Operator', 'Pin', 'twenty-five'],
            ['Operator', 'Pin', 'grey'],
        ],
    );
    assert.equal(page.rows('conflicts-list').length, 0);
    assert.equal(page.text('keep-outcome'), 'Kept the first value for 2 conflicts.');
    assert.deepEqual(plain(replay(saved).conflicts), []);
    page.click('keep-first');
    await page.idle();
    assert.equal(page.server.postsOf('log-a.json').length, 1);
    assert.equal(page.text('keep-outcome'), 'No conflict has an established value to keep.');
});

test('merge and distinct clear a look-alike', async () => {
    const log = apply(
        ScribeLog.create(),
        answer({
            SUBJECTS: [
                'Oswin | character',
                'Oswin (the miller) | character',
                'Aldrich | character',
                'Aldric | character',
            ],
            FACTS: [
                'Oswin | trait | quiet | #2',
                'Oswin (the miller) | trait | floury | #3',
                'Aldrich | trait | sly | #2',
                'Aldric | trait | slow | #3',
            ],
        }),
        1,
        3,
    );
    const page = await opened(readTo(log, 40));
    page.click('tab-rulings');
    await page.idle();
    assert.equal(page.rows('likes-list').length, 2);
    const same = rowSaying(page, 'likes-list', 'Oswin and Oswin (the miller)');
    same.descendants().find((element) => element.tagName === 'SELECT').value = 'S2';
    page.confirming = false;
    page.button(same, 'Same person').click();
    await page.idle();
    assert.deepEqual(page.questions, ['Treat Oswin and Oswin (the miller) as one subject, keeping Oswin (the miller)?']);
    assert.deepEqual(page.server.posts, []);
    page.confirming = true;
    page.button(same, 'Same person').click();
    await page.idle();
    const merged = page.saved('log-a.json');
    assert.deepEqual(lastOperation(merged), { type: 'Merge', from: 'S1', into: 'S2' });
    const joined = replay(merged);
    assert.deepEqual(plain(joined.subjects.slice(0, 2).map((subject) => subject.mergedInto)), ['S2', null]);
    assert.equal(page.rows('likes-list').length, 1);
    const apart = rowSaying(page, 'likes-list', 'Aldrich and Aldric');
    page.button(apart, 'Two people').click();
    await page.idle();
    const kept = page.saved('log-a.json');
    assert.deepEqual(lastOperation(kept), { type: 'Distinct', first: 'S3', second: 'S4' });
    const separate = replay(kept);
    assert.deepEqual(plain(separate.subjects.slice(2).map((subject) => subject.mergedInto)), [null, null]);
    assert.deepEqual(plain(separate.lookAlikes), []);
    assert.equal(page.rows('likes-list').length, 0);
});

test('narrowing a public scene changes an audience', async () => {
    const log = apply(
        ScribeLog.create(),
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character'],
            FACTS: ['Halvard | trait | hums while working | #5', 'Mirelle | trait | quiet | #20'],
            SCENES: ['Day 1 | #1-#10 | The mill | public | present: Halvard | He works'],
        }),
        1,
        20,
    );
    const page = await opened(readTo(log, 40));
    await openSubject(page, 'Halvard');
    assert.equal(rowOf(page, 'facts-list', 'F1').textContent.includes('known to Everyone'), true);
    page.click('tab-rulings');
    await page.idle();
    assert.equal(page.rows('scenes-list').length, 1);
    page.button(page.rows('scenes-list')[0], 'Only those present').click();
    await page.idle();
    assert.deepEqual(lastOperation(page.saved('log-a.json')), { type: 'Narrow', scene: 'MESSAGE-1' });
    assert.equal(page.rows('scenes-list').length, 0);
    page.click('tab-book');
    await page.idle();
    const text = rowOf(page, 'facts-list', 'F1').textContent;
    assert.equal(text.includes('known to Halvard'), true);
    assert.equal(text.includes('Everyone'), false);
});

test('answering a question', async () => {
    const log = apply(
        ScribeLog.create(),
        answer({ QUESTIONS: ['Does Mirelle trust Halvard? | #12', 'Who rang the bell? | #30'] }),
        1,
        40,
    );
    const page = await opened(log);
    page.click('tab-rulings');
    await page.idle();
    const asked = rowSaying(page, 'questions-list', 'Does Mirelle trust Halvard? (#12)');
    page.inputs(asked, 'text')[0].value = 'She does';
    page.button(asked, 'Answer').click();
    await page.idle();
    assert.deepEqual(lastOperation(page.saved('log-a.json')), {
        type: 'Answer',
        question: 'Q1',
        text: 'She does',
        questionText: 'Does Mirelle trust Halvard?',
    });
    assert.equal(
        rowSaying(page, 'questions-list', 'Does Mirelle').textContent.includes(
            'Answered: She does (will be filed on the next run)',
        ),
        true,
    );
    page.button(rowSaying(page, 'questions-list', 'Who rang the bell?'), 'Dismiss').click();
    await page.idle();
    assert.deepEqual(lastOperation(page.saved('log-a.json')), {
        type: 'Dismiss',
        question: 'Q2',
        questionText: 'Who rang the bell?',
    });
    assert.equal(page.rows('questions-list').length, 1);
    const held = gate();
    holdFirst(page, held);
    page.click('continue');
    await arrival(page, 1);
    assert.equal(page.server.modelCalls[0].system, ScribeAnalyzer.AnswersPrompt);
    assert.equal(page.text('waiting'), 'Waiting for the model on the answers: 0s');
    held.open();
    await page.idle();
    assert.equal(page.rows('questions-list').length, 0);
});

test('unalias and revoke', async () => {
    const log = apply(
        ScribeLog.create(),
        answer({
            SUBJECTS: ['Halvard | character', 'Aldrich | character', 'Aldric | character'],
            NAMES: ['Brandt | Halvard | #2'],
            FACTS: ['Halvard | trait | brave | #2', 'Aldrich | trait | sly | #3', 'Aldric | trait | slow | #3'],
        }),
        1,
        3,
    );
    rule(log, { type: 'Merge', from: 'S2', into: 'S3' });
    const page = await opened(readTo(log, 40));
    await openSubject(page, 'Halvard');
    assert.equal(page.text('names'), 'Other names: Brandt');
    page.click('tab-rulings');
    await page.idle();
    page.button(rowSaying(page, 'aliases-list', 'Brandt is a name of Halvard'), 'Not the same').click();
    await page.idle();
    assert.deepEqual(lastOperation(page.saved('log-a.json')), { type: 'Unalias', subject: 'S1', name: 'Brandt' });
    assert.equal(page.rows('aliases-list').length, 0);
    page.click('tab-book');
    await page.idle();
    assert.equal(page.text('names'), 'Other names: none');
    assert.deepEqual(page.rows('subjects-list').map((row) => row.children[0].textContent).sort(), [
        'Aldric',
        'Halvard',
    ]);
    page.click('tab-rulings');
    await page.idle();
    assert.equal(page.rows('made-list')[0].textContent.includes('Unalias Brandt from S1'), true);
    const made = rowSaying(page, 'made-list', 'Merge S2 into S3');
    page.confirming = false;
    page.button(made, 'Revoke').click();
    await page.idle();
    assert.equal(page.questions.at(-1), 'Revoke ruling 2 (Merge S2 into S3)?');
    assert.equal(page.server.postsOf('log-a.json').length, 1);
    page.confirming = true;
    page.button(made, 'Revoke').click();
    await page.idle();
    const revoked = page.saved('log-a.json');
    assert.equal(revoked.entries.find((entry) => entry.sequence === 2).withdrawn, true);
    assert.deepEqual(plain(replay(revoked).subjects.map((subject) => subject.mergedInto)), [null, null, null]);
    page.click('tab-book');
    await page.idle();
    assert.deepEqual(page.rows('subjects-list').map((row) => row.children[0].textContent).sort(), [
        'Aldric',
        'Aldrich',
        'Halvard',
    ]);
});

test('adding, removing and splitting by hand', async () => {
    const page = await opened(oswinBook());
    await openSubject(page, 'Oswin');
    assert.equal(page.text('heading'), 'Oswin (character)');
    assert.equal(page.rows('facts-list').length, 4);
    page.set('add-category', 'trait', 'change');
    assert.equal(page.byId('add-target-field').hidden, true);
    page.byId('add-text').value = 'stubborn';
    page.click('add-file');
    await page.idle();
    assert.deepEqual(lastOperation(page.saved('log-a.json')), {
        type: 'AddFact',
        subject: 'S1',
        category: 'trait',
        target: null,
        text: 'stubborn',
        hidden: false,
        cite: 'MESSAGE-40',
        position: 40,
        targetText: null,
        fact: 'F5',
    });
    assert.equal(page.text('add-outcome'), 'Added F5.');
    assert.equal(page.byId('add-text').value, '');
    assert.equal(page.rows('facts-list').length, 5);
    page.set('add-category', 'relation', 'change');
    assert.equal(page.byId('add-target-field').hidden, false);
    page.byId('add-target').value = 'S2';
    page.byId('add-text').value = 'owes him';
    page.byId('add-hidden').checked = true;
    page.click('add-file');
    await page.idle();
    const related = lastOperation(page.saved('log-a.json'));
    assert.deepEqual(
        [related.category, related.target, related.targetText, related.text, related.hidden, related.cite],
        ['relation', 'S2', 'Halvard', 'owes him', true, 'MESSAGE-40'],
    );
    page.confirming = false;
    page.button(rowOf(page, 'facts-list', 'F4'), 'Remove').click();
    await page.idle();
    assert.deepEqual(page.questions, ['Remove F4 (the mill) from the book?']);
    assert.equal(page.server.postsOf('log-a.json').length, 2);
    assert.equal(rowOf(page, 'facts-list', 'F4').textContent.includes('Removed'), false);
    page.confirming = true;
    page.button(rowOf(page, 'facts-list', 'F4'), 'Remove').click();
    await page.idle();
    assert.equal(page.server.postsOf('log-a.json').length, 3);
    assert.equal(replay(page.saved('log-a.json')).facts.find((fact) => fact.id === 'F4').status, 'Removed');
    assert.equal(rowOf(page, 'facts-list', 'F4').textContent.includes('| Removed |'), true);
    tick(page, 'F2');
    tick(page, 'F3');
    page.byId('split-label').value = "Oswin (Tamsin's uncle)";
    page.byId('split-kind').value = 'character';
    page.click('split-file');
    await page.idle();
    assert.equal(page.questions.at(-1), "Move 2 facts to a new subject named Oswin (Tamsin's uncle)?");
    assert.deepEqual(lastOperation(page.saved('log-a.json')), {
        type: 'Split',
        subject: 'S1',
        label: "Oswin (Tamsin's uncle)",
        kind: 'character',
        facts: ['F2', 'F3'],
        becomes: 'S3',
    });
    assert.equal(page.text('split-outcome'), 'Split: the new subject is S3.');
    const state = replay(page.saved('log-a.json'));
    assert.equal(state.subjects.find((subject) => subject.id === 'S3').label, "Oswin (Tamsin's uncle)");
    assert.deepEqual(
        plain(state.facts.filter((fact) => fact.subject === 'S3').map((fact) => fact.id)),
        ['F2', 'F3'],
    );
    assert.deepEqual(page.rows('facts-list').map((row) => row.getAttribute('data-fact')).sort(), [
        'F1',
        'F4',
        'F5',
        'F6',
    ]);
});

test('a ruling the engine refuses is shown, not saved', async () => {
    const page = await opened(oswinBook());
    await openSubject(page, 'Oswin');
    tick(page, 'F1');
    page.byId('split-label').value = 'Halvard';
    page.click('split-file');
    await page.idle();
    assert.equal(page.text('split-outcome'), BenchPage.Settings.Refusals.Ambiguous);
    assert.equal(
        page.text('split-outcome'),
        'The engine refused this: that name already belongs to a subject or could mean more than one.',
    );
    assert.deepEqual(page.server.posts, []);
    assert.deepEqual(page.questions, []);
});

test('saving an audit', async () => {
    const log = readTo(habits(40), 40);
    const page = await opened(log);
    page.click('tab-audit');
    await page.idle();
    assert.equal(page.text('audit-tally'), '0 right, 0 wrong, 30 to go');
    assert.equal(page.rows('audit-list').length, 20);
    assert.equal(page.text('audit-place'), 'Page 1 of 2');
    const expected = plain(BenchView.audit(replay(log), story, 1));
    const [first, second, third] = expected.map((item) => item.fact);
    assert.equal(rowOf(page, 'audit-list', first).textContent.includes(expected[0].message), true);
    page.button(rowOf(page, 'audit-list', first), 'Right').click();
    await page.idle();
    page.button(rowOf(page, 'audit-list', second), 'Right').click();
    await page.idle();
    page.button(rowOf(page, 'audit-list', third), 'Wrong').click();
    await page.idle();
    assert.equal(page.text('audit-tally'), '2 right, 1 wrong, 27 to go');
    page.click('audit-save');
    await page.idle();
    assert.equal(page.server.postsOf('audit-a.json').length, 1);
    assert.equal(page.text('audit-outcome'), 'Saved audit-a.json.');
    const verdicts = new Map([
        [first, 'Right'],
        [second, 'Right'],
        [third, 'Wrong'],
    ]);
    assert.deepEqual(page.saved('audit-a.json'), {
        room: 'a',
        seed: 1,
        drawn: 30,
        right: 2,
        wrong: 1,
        items: expected.map((item) => ({
            fact: item.fact,
            subject: item.subject,
            category: item.category,
            text: item.text,
            position: item.position,
            verdict: verdicts.get(item.fact) ?? null,
        })),
    });
    page.byId('audit-seed').value = '2';
    page.click('audit-draw');
    await page.idle();
    assert.equal(page.text('audit-tally'), '0 right, 0 wrong, 30 to go');
    assert.notDeepEqual(
        page.rows('audit-list').map((row) => row.getAttribute('data-fact')),
        expected.slice(0, 20).map((item) => item.fact),
    );
});

test('an unreadable answer is kept and shown', async () => {
    const page = await opened(null);
    page.server.model = () => ({ content: prose, cost: 0.01 });
    page.click('start');
    await page.idle();
    const problem = 'Stopped: The answer for #1 to #40 held no line that could be read.';
    assert.equal(page.text('status'), problem);
    const name = `calls-a-unreadable-${FakePage.StartTime}.json`;
    assert.deepEqual(
        page.server.posts.map((request) => request.url),
        [`/private/${name}`],
    );
    assert.deepEqual(page.saved(name), {
        sequence: null,
        pass: 'Story',
        system: ScribeAnalyzer.Prompt,
        input: page.server.modelCalls[0].user,
        answer: prose,
        readable: false,
        refusedLines: [{ block: 'PREAMBLE', line: prose, reason: 'Shape' }],
        refusedOperations: [],
    });
    const [stopped, step] = page.rows('progress-list');
    assert.equal(stopped.textContent, problem);
    assert.equal(step.children[0].textContent, '#1 to #40: 0 stored, 1 refused, $0.0100 spent, 0 of 100 read');
    assert.deepEqual(
        step
            .descendants()
            .filter((element) => element.tagName === 'LI')
            .map((element) => element.textContent),
        [`${prose} (Shape)`],
    );
    assert.equal(page.byId('continue').disabled, true);
});

test('calls without a price are counted', async () => {
    const page = await opened(null);
    page.server.model = (call, count) => ({ ...scripted(call), cost: count === 1 ? 0.01 : null });
    page.click('start');
    await page.idle();
    const done = 'Done: every message is read. The budget could not count 2 calls that carried no price.';
    assert.equal(page.text('status'), done);
    assert.deepEqual(
        page.rows('progress-list').map((row) => row.children[0].textContent),
        [
            done,
            '#81 to #100: 2 stored, 2 refused, $0.0100 spent, 2 calls unpriced, 100 of 100 read',
            '#41 to #80: 2 stored, 2 refused, $0.0100 spent, 1 call unpriced, 80 of 100 read',
            '#1 to #40: 4 stored, 2 refused, $0.0100 spent, 40 of 100 read',
        ],
    );
});

test('everything is locked while anything is in flight', async () => {
    const page = await opened(disputedBook());
    page.click('tab-rulings');
    await page.idle();
    assert.deepEqual(lockable(page).filter((element) => element.disabled).map(named), []);
    const saving = page.server.hold('log-a.json', 'POST');
    page.button(rowSaying(page, 'conflicts-list', 'Halvard, age'), 'thirty (#3), hidden').click();
    await saving.reached;
    assert.deepEqual(lockable(page).filter((element) => !element.disabled).map(named), []);
    assert.equal(page.byId('key').disabled, false);
    saving.open();
    await page.idle();
    assert.deepEqual(lockable(page).filter((element) => element.disabled).map(named), []);
    const loading = page.server.hold('campaign-a.json', 'GET');
    page.set('campaign', 'campaign-a.json', 'change');
    await loading.reached;
    assert.deepEqual(lockable(page).filter((element) => !element.disabled).map(named), []);
    assert.equal(page.byId('key').disabled, false);
    loading.open();
    await page.idle();
    assert.deepEqual(lockable(page).filter((element) => element.disabled).map(named), []);
    page.server.refusing.add('log-a.json');
    const reloading = page.server.hold('log-a.json', 'GET');
    page.click('continue');
    await reloading.reached;
    assert.equal(page.text('status'), 'Reloading the saved book...');
    assert.deepEqual(lockable(page).filter((element) => !element.disabled).map(named), []);
    assert.equal(page.byId('key').disabled, false);
    reloading.open();
    await page.idle();
    page.server.refusing.clear();
    assert.equal(page.text('status'), 'Stopped: the server answered 500');
    assert.deepEqual(lockable(page).filter((element) => element.disabled).map(named), []);
});

test('a result for another campaign is thrown away', async () => {
    const other = apply(
        ScribeLog.create(),
        answer({ SUBJECTS: ['Oswin | character', 'Tamsin | character'], FACTS: ['Oswin | trait | quiet | #2'] }),
        1,
        3,
    );
    readTo(other, 40);
    const files = { ...folder(disputedBook()), 'campaign-b.json': exported, 'log-b.json': JSON.stringify(other) };
    const page = await new FakePage(files).start();
    await page.choose('campaign-a.json');
    page.server.model = scripted;
    page.byId('key').value = 'sk-or-test-key';
    page.click('tab-rulings');
    await page.idle();
    const saving = page.server.hold('log-a.json', 'POST');
    page.button(rowSaying(page, 'conflicts-list', 'Halvard, age'), 'thirty (#3), hidden').click();
    await saving.reached;
    const select = page.byId('campaign');
    assert.equal(select.disabled, true);
    select.value = 'campaign-b.json';
    select.dispatchEvent({ type: 'change' });
    await flush();
    assert.equal(page.text('status'), 'A saved book exists: 40 of 100 messages read.');
    saving.open();
    await page.idle();
    assert.equal(lastOperation(page.saved('log-a.json')).text, 'thirty');
    assert.equal(page.text('tab-rulings'), 'Rulings');
    page.click('tab-book');
    await page.idle();
    assert.deepEqual(page.rows('subjects-list').map((row) => row.children[0].textContent).sort(), [
        'Oswin',
        'Tamsin',
    ]);
    await page.choose('campaign-a.json');
    const held = gate();
    holdFirst(page, held);
    page.click('continue');
    await arrival(page, 1);
    select.value = 'campaign-b.json';
    select.dispatchEvent({ type: 'change' });
    await flush();
    held.open();
    await page.idle();
    assert.equal(page.server.modelCalls.length, 1);
    assert.equal(readCount(page.saved('log-a.json')), 80);
    assert.deepEqual(page.server.postsOf('log-b.json'), []);
    assert.equal(page.saved('log-b.json').entries.length, other.entries.length);
    assert.deepEqual(page.rows('subjects-list').map((row) => row.children[0].textContent).sort(), [
        'Oswin',
        'Tamsin',
    ]);
    assert.equal(page.text('status'), 'A saved book exists: 40 of 100 messages read.');
    page.click('tab-progress');
    await page.idle();
    assert.equal(page.rows('progress-list').length, 0);
    const slow = page.server.hold('log-b.json', 'GET');
    await page.choose('campaign-a.json');
    select.value = 'campaign-b.json';
    select.dispatchEvent({ type: 'change' });
    await slow.reached;
    select.value = 'campaign-a.json';
    select.dispatchEvent({ type: 'change' });
    await flush();
    slow.open();
    await page.idle();
    assert.equal(page.text('status'), 'A saved book exists: 80 of 100 messages read.');
    page.click('tab-book');
    await page.idle();
    assert.deepEqual(page.rows('subjects-list').map((row) => row.children[0].textContent).sort(), [
        'Halvard',
        'Mirelle',
    ]);
});

test('a ruling is shown only after it is saved', async () => {
    const book = disputedBook();
    const page = await opened(book);
    page.click('tab-rulings');
    await page.idle();
    page.server.refusing.add('log-a.json');
    page.button(rowSaying(page, 'conflicts-list', 'Halvard, age'), 'thirty (#3), hidden').click();
    await page.idle();
    page.click('tab-book');
    await page.idle();
    page.click('tab-rulings');
    await page.idle();
    assert.equal(page.rows('conflicts-list').length, 2);
    assert.equal(page.text('tab-rulings'), 'Rulings (2)');
    assert.equal(page.server.files.get('log-a.json'), JSON.stringify(book));
    page.server.refusing.clear();
    const first = page.button(rowSaying(page, 'conflicts-list', 'Halvard, age'), 'twenty-five (#2), established');
    const second = page.button(rowSaying(page, 'conflicts-list', 'Mirelle, eyes'), 'grey (#2), established');
    first.click();
    second.click();
    assert.equal(second.disabled, true);
    await page.idle();
    assert.equal(page.server.postsOf('log-a.json').length, 2);
    assert.equal(page.rows('conflicts-list').length, 1);
    assert.equal(lastOperation(page.saved('log-a.json')).text, 'twenty-five');
});

test('the fields the owner typed are the ones used', async () => {
    const sized = await opened(null);
    sized.byId('size').value = '25';
    sized.byId('model').value = 'mistralai/test-model';
    sized.click('start');
    await sized.idle();
    assert.equal(sized.server.modelCalls.length, 4);
    assert.match(sized.server.modelCalls[0].user, /NEW MESSAGES \(#1 to #25\):/);
    assert.deepEqual([...new Set(sized.server.modelCalls.map((call) => call.model))], ['mistralai/test-model']);
    const budgeted = await opened(null);
    budgeted.byId('budget').value = '0.015';
    budgeted.click('start');
    await budgeted.idle();
    assert.equal(budgeted.text('status'), 'Stopped: the budget of $0.0150 is spent.');
    assert.equal(budgeted.server.modelCalls.length, 2);
    const nothing = await opened(null);
    nothing.byId('budget').value = '0';
    nothing.click('start');
    await nothing.idle();
    assert.equal(nothing.text('budget-problem'), '');
    assert.equal(nothing.text('status'), 'Stopped: the budget of $0.0000 is spent.');
    assert.equal(nothing.server.modelCalls.length, 0);
    for (const value of ['0', '-3', '2.5', '4e', 'forty']) {
        const refused = await opened(null);
        refused.byId('stop').value = value;
        refused.click('start');
        await refused.idle();
        assert.equal(
            refused.text('stop-problem'),
            'Stop after message must be blank or a whole number of at least 1.',
            value,
        );
        assert.deepEqual(refused.server.modelCalls, [], value);
        assert.deepEqual(refused.server.posts, [], value);
    }
    const whole = await opened(null);
    whole.byId('stop').value = '';
    whole.click('start');
    await whole.idle();
    assert.equal(whole.server.modelCalls.length, 3);
    assert.equal(whole.text('status'), 'Done: every message is read.');
});

test('the markup uses text fields for numbers', () => {
    const markup = readFileSync(new URL('../scribe/bench/adopt.html', import.meta.url), 'utf8');
    const modes = { size: 'numeric', stop: 'numeric', budget: 'decimal', 'audit-seed': 'numeric' };
    for (const [id, mode] of Object.entries(modes)) {
        const tag = markup.match(new RegExp(`<input id="${id}"[^>]*>`))[0];
        assert.match(tag, /\stype="text"/, id);
        assert.match(tag, new RegExp(`\\sinputmode="${mode}"`), id);
    }
    assert.doesNotMatch(markup, /type="number"/);
});

test('a new book starts clean', async () => {
    const files = { ...folder(readTo(habits(40), 40)), 'campaign-b.json': exported };
    const page = await new FakePage(files).start();
    await page.choose('campaign-a.json');
    page.byId('key').value = 'sk-or-test-key';
    page.server.model = scripted;
    page.click('continue');
    await page.idle();
    assert.equal(page.rows('progress-list').length, 3);
    page.click('tab-audit');
    await page.idle();
    page.button(page.rows('audit-list')[0], 'Right').click();
    await page.idle();
    assert.equal(page.text('audit-tally'), '1 right, 0 wrong, 29 to go');
    await openSubject(page, 'Halvard');
    tick(page, 'F1');
    page.click('tab-progress');
    await page.idle();
    page.byId('budget').value = '0.025';
    const held = gate();
    page.server.model = async (call, count) => {
        if (count === 3) {
            await held.promise;
        }
        return scripted(call);
    };
    page.click('start');
    await arrival(page, 3);
    assert.equal(page.rows('progress-list').length, 0);
    held.open();
    await page.idle();
    assert.equal(page.text('status'), 'Done: every message is read.');
    assert.equal(
        page.rows('progress-list').at(-1).children[0].textContent,
        '#1 to #40: 4 stored, 2 refused, $0.0100 spent, 40 of 100 read',
    );
    page.click('tab-book');
    await page.idle();
    const ticked = page.inputs(page.byId('facts-list'), 'checkbox').filter((box) => box.checked).length;
    assert.equal(page.byId('detail').hidden || ticked === 0, true, 'no tick survives a new book');
    page.click('tab-audit');
    await page.idle();
    assert.match(page.text('audit-tally'), /^0 right, 0 wrong, /);
    page.byId('budget').value = '0.015';
    page.click('start');
    await page.idle();
    assert.equal(page.text('status'), 'Stopped: the budget of $0.0150 is spent.');
    page.button(page.rows('audit-list')[0], 'Wrong').click();
    await page.idle();
    assert.match(page.text('audit-tally'), /^0 right, 1 wrong, /);
    const before = page.server.modelCalls.length;
    await page.choose('campaign-b.json');
    page.click('tab-progress');
    await page.idle();
    assert.equal(page.rows('progress-list').length, 0);
    page.click('start');
    await page.idle();
    assert.equal(page.server.modelCalls.length > before, true);
    assert.equal(page.text('status'), 'Stopped: the budget of $0.0150 is spent.');
    page.click('tab-audit');
    await page.idle();
    assert.match(page.text('audit-tally'), /^0 right, 0 wrong, /);
});

test('an abandoned request is aborted', async () => {
    const page = await opened(null);
    page.byId('stop').value = '40';
    page.server.model = (call, count) => (count === 1 ? new Promise(() => {}) : scripted(call));
    page.click('start');
    await arrival(page, 1);
    page.clock.advance(180000);
    await flush();
    page.clock.advance(10000);
    await arrival(page, 2);
    await page.idle();
    const calls = page.server.modelCalls;
    assert.equal(calls.length, 2);
    for (const call of calls) {
        assert.notEqual(call.signal, null);
        assert.equal(typeof call.signal.aborted, 'boolean');
    }
    assert.notEqual(calls[0].signal, calls[1].signal);
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(calls[1].signal.aborted, true);
    assert.equal(page.text('status'), 'Done: every message up to #40 is read; 40 of 100 in the campaign.');
});

test('the audit holds its thirty', async () => {
    const log = readTo(habits(40), 40);
    const page = await opened(log);
    page.click('tab-audit');
    await page.idle();
    const drawn = await auditIds(page);
    assert.equal(new Set(drawn).size, 30);
    const marked = drawn.slice(0, 10);
    for (const fact of marked) {
        page.button(rowOf(page, 'audit-list', fact), 'Right').click();
        await page.idle();
    }
    assert.equal(page.text('audit-tally'), '10 right, 0 wrong, 20 to go');
    const target = marked.find((fact) => Number(fact.slice(1)) <= 20);
    await openSubject(page, 'Halvard');
    page.button(rowOf(page, 'facts-list', target), 'Remove').click();
    await page.idle();
    assert.equal(replay(page.saved('log-a.json')).facts.find((fact) => fact.id === target).status, 'Removed');
    page.click('tab-audit');
    await page.idle();
    assert.deepEqual(await auditIds(page), drawn);
    assert.equal(page.text('audit-tally'), '10 right, 0 wrong, 20 to go');
    const gone = rowOf(page, 'audit-list', target).textContent;
    assert.equal(gone.includes('no longer in force'), true);
    assert.equal(gone.includes('Marked right'), true);
    assert.equal(
        page.rows('audit-list').filter((row) => row.textContent.includes('no longer in force')).length,
        1,
    );
    page.click('audit-save');
    await page.idle();
    const saved = page.saved('audit-a.json');
    assert.deepEqual(
        saved.items.map((item) => item.fact),
        drawn,
    );
    assert.equal(saved.items.find((item) => item.fact === target).verdict, 'Right');
    assert.equal(saved.right, 10);
    page.click('audit-draw');
    await page.idle();
    const again = await auditIds(page);
    assert.equal(again.includes(target), false);
    assert.notDeepEqual(again, drawn);
    assert.equal(page.text('audit-tally'), '0 right, 0 wrong, 30 to go');
    page.button(page.rows('audit-list')[0], 'Wrong').click();
    await page.idle();
    assert.equal(page.text('audit-tally'), '0 right, 1 wrong, 29 to go');
    page.set('audit-seed', '5', 'change');
    await page.idle();
    assert.equal(page.text('audit-tally'), '0 right, 0 wrong, 30 to go');
    assert.notDeepEqual(await auditIds(page), again);
    page.set('audit-seed', 'five', 'change');
    await page.idle();
    assert.equal(page.text('audit-outcome'), 'The seed must be a whole number of at least 0.');
});

test('unreadable records never overwrite', async () => {
    const page = await opened(null);
    page.server.model = () => ({ content: prose, cost: 0.01 });
    page.click('start');
    await page.idle();
    page.clock.advance(1000);
    page.click('start');
    await page.idle();
    const first = `calls-a-unreadable-${FakePage.StartTime}.json`;
    const second = `calls-a-unreadable-${FakePage.StartTime + 1000}.json`;
    assert.deepEqual(
        page.server.posts.map((request) => request.url),
        [`/private/${first}`, `/private/${second}`],
    );
    assert.equal(page.saved(first).readable, false);
    assert.equal(page.saved(second).readable, false);
});

test('a redraw keeps what was typed and where the focus was', async () => {
    const scenes = Array.from(
        { length: 21 },
        (unused, index) => `Day 1 | #${index + 1}-#${index + 1} | The mill | public | present: Halvard | He waits`,
    );
    const log = apply(
        ScribeLog.create(),
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character'],
            FACTS: [
                'Halvard | age | twenty-five | #2',
                'Halvard | age | thirty | hidden | #3',
                'Mirelle | eyes | grey | #2',
                'Mirelle | eyes | blue | #3',
            ],
            SCENES: scenes,
            QUESTIONS: ['Does Mirelle trust Halvard? | #12'],
        }),
        1,
        40,
    );
    const page = await opened(log);
    page.click('tab-rulings');
    await page.idle();
    /**
     * @return {string[]}
     */
    const typed = () => [
        page.inputs(rowSaying(page, 'conflicts-list', 'Mirelle, eyes'), 'text')[0].value,
        page.inputs(rowSaying(page, 'questions-list', 'Does Mirelle trust Halvard?'), 'text')[0].value,
    ];
    page.inputs(rowSaying(page, 'conflicts-list', 'Mirelle, eyes'), 'text')[0].value = 'green';
    page.inputs(rowSaying(page, 'questions-list', 'Does Mirelle trust Halvard?'), 'text')[0].value = 'She does';
    page.button(rowSaying(page, 'conflicts-list', 'Halvard, age'), 'thirty (#3), hidden').click();
    await page.idle();
    assert.equal(page.rows('conflicts-list').length, 1);
    assert.deepEqual(typed(), ['green', 'She does']);
    assert.equal(page.byId('scenes-next').disabled, false);
    page.click('scenes-next');
    await page.idle();
    assert.equal(page.text('scenes-place'), 'Page 2 of 2');
    assert.deepEqual(typed(), ['green', 'She does']);
    const pin = page.button(rowSaying(page, 'conflicts-list', 'Mirelle, eyes'), 'Pin this value');
    pin.focus();
    assert.equal(page.document.activeElement === pin, true, 'the pin button has the focus');
    pin.click();
    await page.idle();
    assert.equal(lastOperation(page.saved('log-a.json')).text, 'green');
    assert.equal(page.rows('conflicts-list').length, 0);
    assert.equal(page.document.activeElement.id, 'rulings-title');
    assert.equal(page.document.activeElement === page.document.body, false, 'the focus is not on the body');
    page.click('tab-audit');
    await page.idle();
    const [row] = page.rows('audit-list');
    const fact = row.getAttribute('data-fact');
    const right = page.button(row, 'Right');
    right.focus();
    right.click();
    await page.idle();
    const active = page.document.activeElement;
    assert.equal(active === right, false, 'the focus is on the redrawn control');
    assert.equal(active.getAttribute('data-key'), right.getAttribute('data-key'));
    assert.equal(active.parent.parent.getAttribute('data-fact'), fact);
    assert.equal(active.textContent, 'Right');
});

test('the stop line tells the truth', async () => {
    const cut = await opened(null);
    cut.byId('stop').value = '40';
    cut.click('start');
    await cut.idle();
    assert.equal(cut.text('status'), 'Done: every message up to #40 is read; 40 of 100 in the campaign.');
    assert.equal(cut.rows('progress-list')[0].textContent, cut.text('status'));
    const whole = await opened(null);
    whole.click('start');
    await whole.idle();
    assert.equal(whole.text('status'), 'Done: every message is read.');
    const all = await opened(null);
    all.byId('stop').value = '100';
    all.click('start');
    await all.idle();
    assert.equal(all.text('status'), 'Done: every message is read.');
});

test("rulings made leaves out the engine's own dismissals", async () => {
    const log = apply(
        ScribeLog.create(),
        answer({ QUESTIONS: ['Does Mirelle trust Halvard? | #12', 'Who rang the bell? | #30'] }),
        1,
        40,
    );
    const page = await opened(log);
    page.click('tab-rulings');
    await page.idle();
    const asked = rowSaying(page, 'questions-list', 'Does Mirelle trust Halvard?');
    page.inputs(asked, 'text')[0].value = 'She does';
    page.button(asked, 'Answer').click();
    await page.idle();
    page.click('continue');
    await page.idle();
    const saved = page.saved('log-a.json');
    const operations = saved.entries
        .filter((entry) => entry.kind === 'Operator')
        .map((entry) => [entry.operations[0].type, entry.operations[0].question]);
    assert.deepEqual(operations, [
        ['Answer', 'Q1'],
        ['Dismiss', 'Q1'],
    ]);
    /**
     * @return {string[]}
     */
    const made = () => page.rows('made-list').map((row) => row.children[0].textContent);
    assert.deepEqual(made(), ['2. Answer: Answer Q1: She does']);
    page.button(rowSaying(page, 'questions-list', 'Who rang the bell?'), 'Dismiss').click();
    await page.idle();
    assert.equal(made()[0].endsWith('Dismiss: Dismiss Q2: Who rang the bell?'), true);
    assert.equal(made().length, 2);
    assert.deepEqual(
        plain(BenchView.made(page.saved('log-a.json')).map((row) => row.type)),
        ['Dismiss', 'Answer'],
    );
});

test('the waiting line stops after a failure', async () => {
    const page = await opened(null);
    page.server.model = () => ({ status: 400 });
    page.click('start');
    await page.idle();
    assert.equal(
        page.text('status'),
        'Stopped: unexpected HTTP status; status 400; finish none; reason: Refused by the fake provider',
    );
    assert.equal(page.clock.intervals, 0);
    assert.equal(page.byId('waiting').hidden, true);
    page.clock.advance(5000);
    assert.equal(page.text('waiting'), '');
    assert.equal(page.byId('waiting').hidden, true);
});

test('an unreadable saved book is still guarded', async () => {
    const page = await new FakePage({ 'campaign-a.json': exported, 'log-a.json': '{ not a book' }).start();
    await page.choose('campaign-a.json');
    assert.match(page.text('status'), /^The saved book could not be read: /);
    assert.equal(page.byId('continue').disabled, true);
    assert.equal(page.byId('start').disabled, false);
    page.server.model = scripted;
    page.byId('key').value = 'sk-or-test-key';
    page.confirming = false;
    page.click('start');
    await page.idle();
    assert.deepEqual(page.questions, ['Start a new book? It replaces the saved book for this campaign.']);
    assert.deepEqual(page.server.modelCalls, []);
    assert.deepEqual(page.server.posts, []);
    page.confirming = true;
    page.click('start');
    await page.idle();
    assert.equal(page.server.modelCalls.length, 3);
    assert.equal(readCount(page.saved('log-a.json')), 100);
});

test('a dismissed contradiction is listed among the rulings made', () => {
    const operation = {
        type: 'DismissContradiction',
        contradiction: '["MESSAGE-2","MESSAGE-1","guarded it","held it"]',
        said: 'guarded it',
        before: 'held it',
    };
    const log = {
        entries: [{ sequence: 4, kind: 'Operator', origin: 'Operator', messageIds: [], operations: [operation], withdrawn: false }],
    };
    const rows = BenchView.made(log);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].summary.endsWith('Dismiss the contradiction "guarded it" against "held it"'), true, rows[0].summary);
});
