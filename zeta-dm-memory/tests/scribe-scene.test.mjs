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
        ['page', 'ScribeScene'],
    ];
    for (const [folder, name] of files) {
        const url = new URL(`../scribe/${folder}/${name}.js`, import.meta.url);
        vm.runInContext(readFileSync(url, 'utf8'), context, { filename: url.pathname });
        loaded[name] = vm.runInContext(name, context);
    }
    return loaded;
}

const { ScribeIntake, ScribeAnswer, ScribeLog, ScribeReplay, ScribeScene } = loadAll();

/**
 * @param {number} count
 * @return {object[]}
 */
function storyOf(count) {
    const builder = new CampaignBuilder('Orla');
    for (let number = 1; number <= count; number++) {
        builder.narrator(`The tale goes on, line ${number}.`);
    }
    return ScribeIntake.read(builder.messages).messages;
}

const story = storyOf(60);
const storyOrder = story.map((message) => message.id);
const thirty = story.slice(0, 30);

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
 * @param {string} text
 * @param {object[]} messages
 * @return {object}
 */
function apply(log, text, messages) {
    const parsed = ScribeAnswer.parse(text);
    assert.deepEqual(plain(parsed.refused), [], text);
    const result = ScribeLog.append(log, ScribeReplay.run(log, storyOrder), parsed.operations, {
        messages,
        origin: 'Story',
    });
    assert.deepEqual(plain(result.refused), [], text);
    return ScribeReplay.run(log, storyOrder);
}

/**
 * @param {object} state
 * @param {...string} labels
 * @return {string[]}
 */
function idsOf(state, ...labels) {
    return labels.map((label) => {
        const found = state.subjects.filter((subject) => subject.label === label);
        assert.equal(found.length, 1, `subjects labelled ${label}`);
        return found[0].id;
    });
}

/**
 * @return {object}
 */
function emptyBook() {
    return ScribeReplay.run(ScribeLog.create(), storyOrder);
}

/**
 * @return {object}
 */
function book() {
    const log = ScribeLog.create();
    const before = apply(
        log,
        answer({
            SUBJECTS: [
                'Halvard | character',
                'Mirelle | character',
                'Tamsin | character',
                "Oswin (Tamsin's uncle) | character",
                'Aldrich | character',
                'Aldric | character',
                'Brandt (the elder) | character',
                'Brandt (the younger) | character',
                'Corvane | place',
            ],
            FACTS: ['Mirelle | aka | Mira | #1', 'Brandt (the elder) | aka | Old Brandt | #1'],
            SCENES: [
                'Day 1 | #1-#9 | The yard | private | present: Tamsin | She trains',
                'Day 1 | #10-#20 | The mill | public | present: Halvard, Mirelle | They argue',
            ],
        }),
        story.slice(0, 44),
    );
    const [aldrich, aldric] = idsOf(before, 'Aldrich', 'Aldric');
    ScribeLog.rule(log, ScribeReplay.run(log, storyOrder), { type: 'Merge', from: aldrich, into: aldric });
    return ScribeReplay.run(log, storyOrder);
}

const state = book();
const [halvard, mirelle, oswin, aldricId] = idsOf(state, 'Halvard', 'Mirelle', "Oswin (Tamsin's uncle)", 'Aldric');

const SCENE_LINE = 'Day 3 | The mill | private | present: Halvard, Mirelle | They argue over the ledger';
const SCENE = {
    day: 3,
    place: 'The mill',
    reach: 'Private',
    present: ['Halvard', 'Mirelle'],
    summary: 'They argue over the ledger',
    changed: true,
};

/**
 * @param {string} text
 * @return {function(string, string): Promise<{ text: string, cost: number }>}
 */
function scripted(text) {
    return async () => ({ text, cost: 0 });
}

/**
 * @param {object} state
 * @param {string} heading
 * @return {string[]}
 */
function sectionOf(text, heading) {
    const chunk = text.split('\n\n').find((part) => part.startsWith(`${heading}\n`));
    assert.notEqual(chunk, undefined, `no ${heading} section`);
    return chunk.split('\n').slice(1);
}

test('the input holds the sections in order', () => {
    const text = ScribeScene.input(state, 'Orla', thirty, null);
    const headings = ['PLAYER CHARACTER:', 'SUBJECTS:', 'LAST KNOWN SCENE:', 'RECENT MESSAGES (#11 to #30):'];
    const places = headings.map((heading) => text.indexOf(`${heading}\n`));
    assert.ok(places.every((place) => place >= 0), 'every heading present');
    assert.deepEqual(
        places,
        [...places].sort((first, second) => first - second),
    );
    assert.equal(
        text.split('\n\n').filter((part) => headings.slice(0, 3).some((heading) => part.startsWith(`${heading}\n`)))
            .length,
        3,
    );
    assert.deepEqual(sectionOf(text, 'PLAYER CHARACTER:'), ['Orla']);
    assert.deepEqual(sectionOf(text, 'SUBJECTS:'), [
        '- Halvard (character)',
        '- Mirelle (character)',
        '- Tamsin (character)',
        "- Oswin (Tamsin's uncle) (character)",
        '- Aldric (character)',
        '- Brandt (the elder) (character)',
        '- Brandt (the younger) (character)',
        '- Corvane (place)',
    ]);
    assert.deepEqual(sectionOf(text, 'LAST KNOWN SCENE:'), [
        'Day 1 | The mill | public | present: Halvard, Mirelle | They argue',
    ]);
    const tail = text.slice(text.indexOf('RECENT MESSAGES'));
    assert.equal(tail.split('[#').length - 1, 20);
    assert.ok(tail.includes('[#11] Narrator: The tale goes on, line 11.'));
    assert.ok(tail.includes('[#30] Narrator: The tale goes on, line 30.'));
    assert.ok(!tail.includes('[#10] '));

    const previous = Object.freeze({
        message: 'MESSAGE-5',
        position: 5,
        day: 4,
        place: 'The ford',
        reach: 'Public',
        present: Object.freeze([
            Object.freeze({ subject: halvard, label: 'Halvard' }),
            Object.freeze({ subject: null, label: 'Isolde' }),
        ]),
        summary: 'They wade across',
        changed: false,
    });
    assert.deepEqual(sectionOf(ScribeScene.input(state, 'Orla', thirty, previous), 'LAST KNOWN SCENE:'), [
        'Day 4 | The ford | public | present: Halvard, Isolde | They wade across',
    ]);
    const nobody = Object.freeze({ ...previous, present: Object.freeze([]) });
    assert.ok(ScribeScene.input(state, 'Orla', thirty, nobody).includes('| present: nobody | They wade across'));
    assert.deepEqual(sectionOf(ScribeScene.input(emptyBook(), 'Orla', thirty, null), 'LAST KNOWN SCENE:'), ['(none)']);
    assert.deepEqual(sectionOf(ScribeScene.input(emptyBook(), 'Orla', thirty, null), 'SUBJECTS:'), ['(none)']);
    assert.ok(ScribeScene.input(state, 'Orla', thirty.slice(0, 5), null).includes('RECENT MESSAGES (#1 to #5):'));
});

test('a scene line is read', () => {
    assert.deepEqual(plain(ScribeScene.parse(`${SCENE_LINE}\nCHANGED: yes`)), SCENE);
    assert.deepEqual(plain(ScribeScene.parse('DAY 12 | The mill | PUBLIC | PRESENT: Halvard | x\nCHANGED: no')), {
        day: 12,
        place: 'The mill',
        reach: 'Public',
        present: ['Halvard'],
        summary: 'x',
        changed: false,
    });
    const piped = ScribeScene.parse('Day 3 | The mill | private | present: Halvard | They argue | then split\nCHANGED: yes');
    assert.equal(piped.summary, 'They argue | then split');
    for (const empty of ['nobody', 'None', 'No one', '']) {
        const parsed = ScribeScene.parse(`Day 3 | The mill | private | present: ${empty} | Silence\nCHANGED: yes`);
        assert.deepEqual(plain(parsed.present), [], empty);
    }
    const spaced = ScribeScene.parse('Day 3 | The mill | private | present: Halvard, , Mirelle,  | x');
    assert.deepEqual(plain(spaced.present), ['Halvard', 'Mirelle']);
    assert.equal(ScribeScene.parse('Day 3 | The mill | private | present: Halvard | ').summary, '');
    assert.deepEqual(plain(ScribeScene.parse('Day 3 | The mill | private | present: Halvard\nCHANGED: no')), {
        day: 3,
        place: 'The mill',
        reach: 'Private',
        present: ['Halvard'],
        summary: '',
        changed: false,
    });
});

test('dress is tolerated', () => {
    const expected = plain(ScribeScene.parse(`${SCENE_LINE}\nCHANGED: yes`));
    assert.equal(expected.changed, true);
    const variants = [
        `\`\`\`\n${SCENE_LINE}\nCHANGED: yes\n\`\`\``,
        `\`\`\`text\n${SCENE_LINE}\nCHANGED: yes\n\`\`\``,
        `- ${SCENE_LINE}\nCHANGED: yes`,
        `**${SCENE_LINE}**\nCHANGED: yes`,
        `- **${SCENE_LINE}**\n- **CHANGED: yes**`,
        `${SCENE_LINE}\nchanged: YES`,
        `Here is the scene as it stands.\n${SCENE_LINE}\nCHANGED: yes`,
        `\n\n  ${SCENE_LINE}  \n\n  CHANGED: yes  \n`,
        `${SCENE_LINE}\r\nCHANGED: yes\r\n`,
    ];
    for (const variant of variants) {
        assert.deepEqual(plain(ScribeScene.parse(variant)), expected, variant);
    }
    assert.equal(ScribeScene.parse(`${SCENE_LINE}\nchanged: NO`).changed, false);
    assert.equal(ScribeScene.parse(`CHANGED: no\n${SCENE_LINE}`).changed, false);
});

test('what does not fit is refused', () => {
    const refused = [
        '',
        'The mill is quiet tonight.\nCHANGED: yes',
        'Day zero | The mill | private | present: Halvard | x',
        'Day 0 | The mill | private | present: Halvard | x',
        'Day -2 | The mill | private | present: Halvard | x',
        'Day 2.5 | The mill | private | present: Halvard | x',
        'Day | The mill | private | present: Halvard | x',
        'Third day | The mill | private | present: Halvard | x',
        'Day 3 |  | private | present: Halvard | x',
        'Day 3 | The mill | secret | present: Halvard | x',
        'Day 3 | The mill | | present: Halvard | x',
        'Day 3 | The mill | private | Halvard | x',
        'Day 3 | The mill | private | with Halvard | x | y',
        'Day 3 | The mill | private',
    ];
    for (const text of refused) {
        assert.equal(ScribeScene.parse(text), null, text);
    }
    assert.equal(ScribeScene.parse(SCENE_LINE).changed, null);
    assert.equal(ScribeScene.parse(`${SCENE_LINE}\nCHANGED: maybe`).changed, null);
    assert.equal(ScribeScene.parse(`${SCENE_LINE}\nCHANGED:`).changed, null);
    assert.equal(ScribeScene.parse(`${SCENE_LINE}\nUNCHANGED: yes`).changed, null);
    assert.equal(ScribeScene.parse(null), null);
    assert.equal(ScribeScene.parse(undefined), null);
});

test('labels become subjects', () => {
    /**
     * @param {...string} written
     * @return {Array<{ subject: string|null, label: string }>}
     */
    const resolved = (...written) => plain(ScribeScene.resolve(state, written));
    assert.deepEqual(resolved('Halvard'), [{ subject: halvard, label: 'Halvard' }]);
    assert.deepEqual(resolved("Oswin (Tamsin's uncle)"), [{ subject: oswin, label: "Oswin (Tamsin's uncle)" }]);
    assert.deepEqual(resolved('Oswin'), [{ subject: oswin, label: "Oswin (Tamsin's uncle)" }]);
    assert.deepEqual(resolved('Mira'), [{ subject: mirelle, label: 'Mirelle' }]);
    assert.deepEqual(resolved('Halvard-san'), [{ subject: halvard, label: 'Halvard' }]);
    assert.deepEqual(resolved('  HALVARD '), [{ subject: halvard, label: 'Halvard' }]);
    assert.deepEqual(resolved('Isolde'), [{ subject: null, label: 'Isolde' }]);
    assert.deepEqual(resolved('Brandt'), [{ subject: null, label: 'Brandt' }]);
    assert.deepEqual(resolved('Aldrich'), [{ subject: aldricId, label: 'Aldric' }]);
    assert.deepEqual(resolved('Aldric'), [{ subject: aldricId, label: 'Aldric' }]);
    assert.deepEqual(resolved('Halvard', 'halvard', 'Halvard-san', 'Mira', 'Mirelle'), [
        { subject: halvard, label: 'Halvard' },
        { subject: mirelle, label: 'Mirelle' },
    ]);
    assert.deepEqual(resolved('Aldrich', 'Aldric'), [{ subject: aldricId, label: 'Aldric' }]);
    assert.deepEqual(resolved('Kira', 'Halvard', 'Orla'), [
        { subject: null, label: 'Kira' },
        { subject: halvard, label: 'Halvard' },
        { subject: null, label: 'Orla' },
    ]);
    assert.deepEqual(resolved(), []);
    assert.deepEqual(plain(ScribeScene.resolve(emptyBook(), ['Halvard'])), [{ subject: null, label: 'Halvard' }]);
});

test('the same scene is recognised', () => {
    /**
     * @param {object} changes
     * @return {object}
     */
    const now = (changes = {}) => ({
        day: 3,
        place: 'The mill',
        reach: 'Private',
        present: [
            { subject: halvard, label: 'Halvard' },
            { subject: mirelle, label: 'Mirelle' },
            { subject: null, label: 'Isolde' },
        ],
        summary: 'Anything',
        changed: false,
        ...changes,
    });
    assert.equal(ScribeScene.same(now(), now()), true);
    assert.equal(ScribeScene.same(now(), now({ place: 'the MILL', summary: 'Other words', changed: true })), true);
    assert.equal(
        ScribeScene.same(
            now(),
            now({
                present: [
                    { subject: null, label: ' ISOLDE' },
                    { subject: mirelle, label: 'Mira' },
                    { subject: halvard, label: 'Halvard' },
                ],
            }),
        ),
        true,
    );
    assert.equal(ScribeScene.same(now(), now({ day: 4 })), false);
    assert.equal(ScribeScene.same(now(), now({ place: 'The yard' })), false);
    assert.equal(ScribeScene.same(now(), now({ reach: 'Public' })), false);
    assert.equal(ScribeScene.same(now(), now({ present: now().present.slice(0, 2) })), false);
    assert.equal(
        ScribeScene.same(now(), now({ present: [...now().present, { subject: oswin, label: 'Oswin' }] })),
        false,
    );
    assert.equal(
        ScribeScene.same(
            now(),
            now({ present: [now().present[0], now().present[1], { subject: null, label: 'Kira' }] }),
        ),
        false,
    );
    assert.equal(
        ScribeScene.same(
            now({ present: [{ subject: halvard, label: 'Halvard' }] }),
            now({ present: [{ subject: null, label: 'Halvard' }] }),
        ),
        false,
    );
    assert.equal(ScribeScene.same(null, null), true);
    assert.equal(ScribeScene.same(now(), null), false);
    assert.equal(ScribeScene.same(null, now()), false);
});

test('code decides whether the scene changed', async () => {
    const asked = [];
    const request = (text, previous) => ({
        state,
        player: 'Orla',
        messages: thirty,
        previous,
        ask: async (prompt, input) => {
            asked.push([prompt, input]);
            return { text, cost: 0 };
        },
    });
    const first = await ScribeScene.now(request(`${SCENE_LINE}\nCHANGED: no`, null));
    assert.equal(first.changed, true);
    assert.equal(asked.length, 1);
    assert.equal(asked[0][0], ScribeScene.Prompt);
    assert.ok(asked[0][1].includes('RECENT MESSAGES (#11 to #30):'));
    assert.equal(first.message, 'MESSAGE-30');
    assert.equal(first.position, 30);
    assert.deepEqual(plain(first.present), [
        { subject: halvard, label: 'Halvard' },
        { subject: mirelle, label: 'Mirelle' },
    ]);
    assert.equal(first.place, 'The mill');
    assert.equal(first.reach, 'Private');
    assert.equal(first.day, 3);

    const equal = await ScribeScene.now(request(`${SCENE_LINE}\nCHANGED: no`, first));
    assert.equal(equal.changed, false);
    const insisted = await ScribeScene.now(request(`${SCENE_LINE}\nCHANGED: yes`, first));
    assert.equal(insisted.changed, true);
    const silent = await ScribeScene.now(request(SCENE_LINE, first));
    assert.equal(silent.changed, false);
    const moved = await ScribeScene.now(
        request('Day 3 | The yard | private | present: Halvard, Mirelle | They argue over the ledger\nCHANGED: no', first),
    );
    assert.equal(moved.changed, true);
    assert.equal(moved.place, 'The yard');
    const left = await ScribeScene.now(
        request('Day 3 | The mill | private | present: Halvard | They argue over the ledger\nCHANGED: no', first),
    );
    assert.equal(left.changed, true);
    const later = await ScribeScene.now(
        request('Day 4 | The mill | private | present: Mira, Halvard | They argue over the ledger\nCHANGED: no', first),
    );
    assert.equal(later.changed, true);
    const reordered = await ScribeScene.now(
        request('Day 3 | the mill | PRIVATE | present: Mira, Halvard-san | Other words\nCHANGED: no', first),
    );
    assert.equal(reordered.changed, false);
});

test('the chat profile follows the player character when it was read, and is left out when not', async () => {
    const profile = 'Orla is a sellsword from the north.';
    const plainText = ScribeScene.input(state, 'Orla', thirty, null);
    assert.equal(ScribeScene.input(state, 'Orla', thirty, null, null), plainText);
    assert.equal(plainText.includes('PLAYER CHARACTER PROFILE:'), false);
    const profiled = ScribeScene.input(state, 'Orla', thirty, null, profile);
    assert.equal(profiled.startsWith(`PLAYER CHARACTER:\nOrla\n\nPLAYER CHARACTER PROFILE:\n${profile}\n\nSUBJECTS:\n`), true);
    assert.equal(profiled.replace(`PLAYER CHARACTER PROFILE:\n${profile}\n\n`, ''), plainText);
    const asked = [];
    /**
     * @param {string} prompt
     * @param {string} input
     * @return {Promise<{ text: string, cost: number }>}
     */
    const ask = async (prompt, input) => {
        asked.push(input);
        return { text: `${SCENE_LINE}\nCHANGED: no`, cost: 0 };
    };
    await ScribeScene.now({ state, player: 'Orla', messages: thirty, previous: null, ask, profile });
    await ScribeScene.now({ state, player: 'Orla', messages: thirty, previous: null, ask, profile: null });
    await ScribeScene.now({ state, player: 'Orla', messages: thirty, previous: null, ask });
    assert.deepEqual(asked, [profiled, plainText, plainText]);
});

test('an answer that cannot be read changes nothing', async () => {
    let calls = 0;
    /**
     * @param {function(): Promise<*>} reply
     * @param {object[]} messages
     * @return {Promise<object|null>}
     */
    const attempt = (reply, messages = thirty) =>
        ScribeScene.now({
            state,
            player: 'Orla',
            messages,
            previous: null,
            ask: () => {
                calls++;
                return reply();
            },
        });
    assert.equal(await attempt(async () => ({ text: 'It is a quiet night at the mill.', cost: 0 })), null);
    assert.equal(await attempt(async () => ({ text: '', cost: 0 })), null);
    assert.equal(await attempt(async () => ({ text: 'Day 3 | The mill | secret | present: Halvard | x', cost: 0 })), null);
    assert.equal(await attempt(async () => ({ cost: 0 })), null);
    assert.equal(await attempt(async () => null), null);
    assert.equal(
        await attempt(async () => {
            throw new Error('the model is down');
        }),
        null,
    );
    assert.equal(
        await attempt(() => {
            throw new Error('the model is down');
        }),
        null,
    );
    assert.equal(calls, 7);
    assert.equal(await attempt(async () => ({ text: SCENE_LINE, cost: 0 }), []), null);
    assert.equal(calls, 7);
});

test('the prompt is exact', () => {
    const prompt = ScribeScene.Prompt;
    const lines = prompt.split('\n');
    assert.ok(prompt.startsWith('You are the Scribe:'));
    assert.ok(prompt.endsWith('7. Never invent. If the messages do not say where the characters are, keep the place of LAST KNOWN SCENE.'));
    const numbered = lines.filter((line) => /^\d+\. /.test(line));
    assert.equal(numbered.length, 7);
    assert.deepEqual(
        numbered.map((line) => line.split('.')[0]),
        ['1', '2', '3', '4', '5', '6', '7'],
    );
    assert.ok(!prompt.includes('\t'));
    assert.ok(!prompt.includes('\r'));
    assert.deepEqual(
        lines.filter((line) => line.endsWith(' ')),
        [],
    );
    const example = lines.find((line) => line.startsWith('Day N | '));
    assert.notEqual(example, undefined);
    const filled = example
        .replace('Day N', 'Day 3')
        .replace('Place', 'The mill')
        .replace('public or private', 'private')
        .replace('Label, Label', 'Halvard, Mirelle')
        .replace(/what is going on.*$/, 'They argue');
    assert.deepEqual(plain(ScribeScene.parse(filled)), { ...SCENE, summary: 'They argue', changed: null });
    assert.ok(lines.includes('CHANGED: yes or no'));
    const received = lines.findIndex((line) => line.startsWith('You receive PLAYER CHARACTER,'));
    assert.equal(
        lines[received + 1],
        "PLAYER CHARACTER PROFILE is the player's own description of their character; trust it for that character.",
    );
    assert.equal(ScribeScene.Settings.Recent, 20);
});

test('nothing is changed', async () => {
    const before = {
        revision: state.revision,
        subjects: state.subjects.length,
        scenes: state.scenes.length,
        labels: state.subjects.map((subject) => subject.label).join('|'),
        akas: state.subjects.map((subject) => subject.aka.join(',')).join('|'),
        merged: state.subjects.map((subject) => subject.mergedInto).join('|'),
        scenePlaces: state.scenes.map((scene) => scene.place).join('|'),
        messages: thirty.length,
        texts: thirty.map((message) => message.text).join('|'),
    };
    const previous = Object.freeze({
        message: 'MESSAGE-5',
        position: 5,
        day: 4,
        place: 'The ford',
        reach: 'Public',
        present: Object.freeze([Object.freeze({ subject: halvard, label: 'Halvard' })]),
        summary: 'They wade across',
        changed: false,
    });
    const previousBefore = JSON.stringify(previous);
    const written = ['Halvard', 'Isolde'];
    const parsed = ScribeScene.parse(`${SCENE_LINE}\nCHANGED: yes`);
    const resolved = ScribeScene.resolve(state, written);
    const found = await ScribeScene.now({
        state,
        player: 'Orla',
        messages: thirty,
        previous,
        ask: scripted(`${SCENE_LINE}\nCHANGED: yes`),
    });
    ScribeScene.input(state, 'Orla', thirty, previous);
    ScribeScene.same(previous, found);
    assert.deepEqual(written, ['Halvard', 'Isolde']);
    assert.equal(JSON.stringify(previous), previousBefore);
    assert.deepEqual(
        {
            revision: state.revision,
            subjects: state.subjects.length,
            scenes: state.scenes.length,
            labels: state.subjects.map((subject) => subject.label).join('|'),
            akas: state.subjects.map((subject) => subject.aka.join(',')).join('|'),
            merged: state.subjects.map((subject) => subject.mergedInto).join('|'),
            scenePlaces: state.scenes.map((scene) => scene.place).join('|'),
            messages: thirty.length,
            texts: thirty.map((message) => message.text).join('|'),
        },
        before,
    );
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(Object.isFrozen(parsed.present), true);
    assert.equal(Object.isFrozen(resolved), true);
    assert.equal(
        resolved.every((person) => Object.isFrozen(person)),
        true,
    );
    assert.equal(Object.isFrozen(found), true);
    assert.equal(Object.isFrozen(found.present), true);
    assert.equal(
        found.present.every((person) => Object.isFrozen(person)),
        true,
    );
});

/**
 * @param {object} book
 * @param {string} list
 * @return {Array<{ subject: string|null, label: string }>}
 */
function readList(book, list) {
    const parsed = ScribeScene.parse(`Day 3 | The mill | private | present: ${list} | x`);
    assert.notEqual(parsed, null, list);
    return plain(ScribeScene.resolve(book, parsed.present));
}

test('dressed lists still find their people', () => {
    const halvardAndMirelle = [
        { subject: halvard, label: 'Halvard' },
        { subject: mirelle, label: 'Mirelle' },
    ];
    const withKira = [...halvardAndMirelle, { subject: null, label: 'Kira' }];
    assert.deepEqual(readList(state, 'Halvard (player), Mirelle'), halvardAndMirelle);
    assert.deepEqual(readList(state, 'Halvard (PLAYER), Mirelle'), halvardAndMirelle);
    assert.deepEqual(readList(state, 'Halvard and Mirelle'), halvardAndMirelle);
    assert.deepEqual(readList(state, 'Halvard AND Mirelle'), halvardAndMirelle);
    assert.deepEqual(readList(state, 'Halvard, Mirelle, and Kira'), withKira);
    assert.deepEqual(readList(state, '[Halvard, Mirelle]'), halvardAndMirelle);
    assert.deepEqual(readList(state, 'Halvard; Mirelle & Kira'), withKira);
    assert.deepEqual(readList(state, 'Lady Mirelle'), [{ subject: mirelle, label: 'Mirelle' }]);
    assert.deepEqual(readList(state, 'Mirelle the miller'), [{ subject: null, label: 'Mirelle the miller' }]);
    assert.deepEqual(readList(state, 'Oswin (smith)'), [{ subject: null, label: 'Oswin (smith)' }]);
    assert.deepEqual(readList(state, 'Lady Mirelle, Oswin and Halvard (player)'), [
        { subject: mirelle, label: 'Mirelle' },
        { subject: oswin, label: "Oswin (Tamsin's uncle)" },
        { subject: halvard, label: 'Halvard' },
    ]);
    assert.deepEqual(readList(state, 'and Kira, Halvard'), [
        { subject: null, label: 'Kira' },
        { subject: halvard, label: 'Halvard' },
    ]);
    assert.deepEqual(readList(state, '[Kira, Orla]'), [
        { subject: null, label: 'Kira' },
        { subject: null, label: 'Orla' },
    ]);
    assert.deepEqual(readList(state, '[nobody]'), []);
    assert.deepEqual(readList(state, 'Kira (player)'), [{ subject: null, label: 'Kira' }]);
});

test('a dressed label is never guessed between two', () => {
    const log = ScribeLog.create();
    const twins = apply(
        log,
        answer({
            SUBJECTS: ['Oswin (the smith) | character', 'Oswin (the clerk) | character', 'Mirelle | character'],
            FACTS: ['Mirelle | aka | Mi | #1'],
        }),
        story.slice(0, 5),
    );
    assert.deepEqual(readList(twins, 'Old Oswin'), [{ subject: null, label: 'Old Oswin' }]);
    assert.deepEqual(readList(twins, 'Oswin (smith)'), [{ subject: null, label: 'Oswin (smith)' }]);
    assert.deepEqual(readList(twins, 'Mi at the door'), [{ subject: null, label: 'Mi at the door' }]);
    assert.deepEqual(readList(state, "Mirelle of Oswin's forge"), [{ subject: null, label: "Mirelle of Oswin's forge" }]);
    assert.deepEqual(readList(state, 'Old Brandt of the mill'), [{ subject: null, label: 'Old Brandt of the mill' }]);
});

/**
 * @param {string[]} subjects
 * @return {object}
 */
function bookOf(subjects) {
    return apply(
        ScribeLog.create(),
        answer({ SUBJECTS: subjects.map((label) => `${label} | character`) }),
        story.slice(0, 5),
    );
}

test('another person is never taken for a subject', () => {
    const cast = bookOf(['Halvard', 'Mirelle', 'Rose', 'Will', 'The Captain', 'Oswin', 'Kira']);
    const strangers = [
        "Mirelle's maid",
        "Halvard's squire",
        'Mirelle with her maid',
        'a guard loyal to Mirelle',
        'the rose seller',
        'Will Turner',
        "the captain's mate",
        'Oswin the Elder',
        'young Oswin',
        'Rosemary the cook',
        'Kirana',
    ];
    for (const stranger of strangers) {
        assert.deepEqual(readList(cast, stranger), [{ subject: null, label: stranger }], stranger);
    }
});

test('a title is set aside, and only a title', () => {
    const people = bookOf(['Mirelle', 'Brandt', 'Oswin']);
    const [brandtId, oswinId] = idsOf(people, 'Brandt', 'Oswin');
    const [peopleMirelle] = idsOf(people, 'Mirelle');
    assert.deepEqual(readList(people, 'Lady Mirelle'), [{ subject: peopleMirelle, label: 'Mirelle' }]);
    assert.deepEqual(readList(people, 'Dr. Brandt'), [{ subject: brandtId, label: 'Brandt' }]);
    assert.deepEqual(readList(people, 'dr Brandt'), [{ subject: brandtId, label: 'Brandt' }]);
    assert.deepEqual(readList(people, 'sir Oswin'), [{ subject: oswinId, label: 'Oswin' }]);
    assert.deepEqual(readList(people, 'MISTRESS Mirelle'), [{ subject: peopleMirelle, label: 'Mirelle' }]);
    assert.deepEqual(readList(people, 'Old Oswin'), [{ subject: null, label: 'Old Oswin' }]);
    assert.deepEqual(readList(people, 'Captain Brandt'), [{ subject: null, label: 'Captain Brandt' }]);
    assert.deepEqual(readList(people, 'Lady Lady Mirelle'), [{ subject: null, label: 'Lady Lady Mirelle' }]);
    const ladyOnly = bookOf(['Lady Mirelle']);
    assert.deepEqual(readList(ladyOnly, 'Lady Mirelle'), [
        { subject: idsOf(ladyOnly, 'Lady Mirelle')[0], label: 'Lady Mirelle' },
    ]);
    const both = bookOf(['Mirelle', 'Lady Mirelle']);
    assert.deepEqual(readList(both, 'Lady Mirelle'), [{ subject: idsOf(both, 'Lady Mirelle')[0], label: 'Lady Mirelle' }]);
    assert.deepEqual(readList(both, 'Mirelle'), [{ subject: idsOf(both, 'Mirelle')[0], label: 'Mirelle' }]);
});

test('a label holding and is found whole', () => {
    const house = bookOf(['Brandt', 'Brandt and Sons', 'Mirelle']);
    const [brandtId, sonsId, mirelleHouse] = idsOf(house, 'Brandt', 'Brandt and Sons', 'Mirelle');
    assert.deepEqual(readList(house, 'Brandt and Sons'), [{ subject: sonsId, label: 'Brandt and Sons' }]);
    assert.deepEqual(readList(house, 'Brandt & Sons'), [{ subject: sonsId, label: 'Brandt and Sons' }]);
    assert.deepEqual(readList(house, 'Brandt AND Sons'), [{ subject: sonsId, label: 'Brandt and Sons' }]);
    assert.deepEqual(readList(house, 'Brandt and Mirelle'), [
        { subject: brandtId, label: 'Brandt' },
        { subject: mirelleHouse, label: 'Mirelle' },
    ]);
    assert.deepEqual(readList(house, 'Brandt & Mirelle, Halvard'), [
        { subject: brandtId, label: 'Brandt' },
        { subject: mirelleHouse, label: 'Mirelle' },
        { subject: null, label: 'Halvard' },
    ]);
});

test("the player's mark is read in any case", () => {
    assert.deepEqual(readList(state, 'Halvard (Player)'), [{ subject: halvard, label: 'Halvard' }]);
    assert.deepEqual(readList(state, 'Halvard (PLAYER)'), [{ subject: halvard, label: 'Halvard' }]);
    assert.deepEqual(readList(state, 'Kira (Player)'), [{ subject: null, label: 'Kira' }]);
});

test('the last known scene lists who was still there', () => {
    const log = ScribeLog.create();
    const bounded = apply(
        log,
        answer({
            SUBJECTS: ['Halvard | character', 'Isolde | character', 'Mirelle | character', 'Kira | character'],
            SCENES: [
                'Day 1 | #1-#10 | The hall | public | present: Halvard, Isolde (until #4), Mirelle (from #6), Kira (until #10) | They feast',
            ],
        }),
        story.slice(0, 12),
    );
    assert.deepEqual(sectionOf(ScribeScene.input(bounded, 'Orla', thirty, null), 'LAST KNOWN SCENE:'), [
        'Day 1 | The hall | public | present: Halvard, Mirelle, Kira | They feast',
    ]);
});

test('changed needs a whole word', () => {
    assert.equal(ScribeScene.parse(`${SCENE_LINE}\nCHANGED: yesterday was different`).changed, null);
    assert.equal(ScribeScene.parse(`${SCENE_LINE}\nCHANGED: nobody left`).changed, null);
    assert.equal(ScribeScene.parse(`${SCENE_LINE}\nCHANGED: yes.`).changed, true);
    assert.equal(ScribeScene.parse(`${SCENE_LINE}\nchanged: NO`).changed, false);
    assert.equal(ScribeScene.parse(`${SCENE_LINE}\nCHANGED: yes, the place`).changed, true);
});

test('unresolved labels are one person whatever their case', async () => {
    assert.deepEqual(plain(ScribeScene.resolve(state, ['a stranger', 'A Stranger', 'A STRANGER'])), [
        { subject: null, label: 'a stranger' },
    ]);
    const parsed = ScribeScene.parse('Day 3 | The mill | private | present: a stranger, A Stranger | x');
    assert.equal(ScribeScene.resolve(state, parsed.present).length, 1);
});

test('the inner scene is the last known one', () => {
    const log = ScribeLog.create();
    const nested = apply(
        log,
        answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character'],
            SCENES: [
                'Day 1 | #1-#10 | The hall | public | present: Halvard, Mirelle | They feast',
                'Day 1 | #6-#10 | The alcove | private | present: Mirelle | A quiet word',
            ],
        }),
        story.slice(0, 12),
    );
    assert.deepEqual(sectionOf(ScribeScene.input(nested, 'Orla', thirty, null), 'LAST KNOWN SCENE:'), [
        'Day 1 | The alcove | private | present: Mirelle | A quiet word',
    ]);
});
