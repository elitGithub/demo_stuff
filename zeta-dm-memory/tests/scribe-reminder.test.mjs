import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import CampaignBuilder from './support/CampaignBuilder.mjs';

/**
 * @param {string[]} core
 * @param {string[]} page
 * @return {Object<string, object>}
 */
function load(core, page) {
    const context = vm.createContext({ TextEncoder });
    const loaded = {};
    const sources = [...core.map((name) => ['core', name]), ...page.map((name) => ['page', name])];
    for (const [folder, name] of sources) {
        const url = new URL(`../scribe/${folder}/${name}.js`, import.meta.url);
        vm.runInContext(readFileSync(url, 'utf8'), context, { filename: url.pathname });
        loaded[name] = vm.runInContext(name, context);
    }
    return loaded;
}

const { ScribeText, ScribeIntake, ScribeAnswer, ScribeLog, ScribeReplay, ScribeKnowledge, ScribeReminder, ScribeSender } = load(
    [
        'ScribeText',
        'ScribeCategory',
        'ScribeIntake',
        'ScribeAnswer',
        'ScribeLog',
        'ScribeReplay',
        'ScribeKnowledge',
        'ScribeAnalyzer',
    ],
    ['ScribePedant', 'ScribeReminder', 'ScribeSender'],
);

const builder = new CampaignBuilder('Halvard');
for (let number = 1; number <= 60; number++) {
    builder.narrator(`The tale goes on, line ${number}.`);
}
const story = ScribeIntake.read(builder.messages).messages;
const storyOrder = story.map((message) => message.id);
const curly = String.fromCodePoint(0x2019);
const deseret = String.fromCodePoint(0x10400);
const LEAD = '[Scribe] ';

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
 * @param {...number} positions
 * @return {object[]}
 */
function pick(...positions) {
    return positions.map((position) => story[position - 1]);
}

/**
 * @param {number} first
 * @param {number} last
 * @return {object[]}
 */
function stretch(first, last) {
    return story.slice(first - 1, last);
}

/**
 * @param {object} log
 * @param {Object<string, string[]>} blocks
 * @param {object[]} messages
 * @return {object}
 */
function apply(log, blocks, messages) {
    const text = Object.entries(blocks)
        .map(([block, lines]) => [`=== ${block}`, ...lines].join('\n'))
        .join('\n');
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
 * @param {Object<string, string[]>} blocks
 * @param {number} last
 * @return {object}
 */
function book(blocks, last) {
    return apply(ScribeLog.create(), blocks, stretch(1, last));
}

/**
 * @param {object} log
 * @param {object} operation
 * @return {object}
 */
function rule(log, operation) {
    ScribeLog.rule(log, ScribeReplay.run(log, storyOrder), operation);
    return ScribeReplay.run(log, storyOrder);
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
 * @param {string[]} labels
 * @param {object} changes
 * @return {object}
 */
function scene(state, labels, changes = {}) {
    return {
        day: 3,
        place: 'the mill',
        reach: 'Private',
        present: labels.map((label) => {
            const found = state.subjects.find((subject) => subject.label === label);
            return { subject: found === undefined ? null : found.id, label };
        }),
        summary: 'They talk by the wheel',
        ...changes,
    };
}

/**
 * @param {string} text
 * @return {object[]}
 */
function unreadSaying(text) {
    return ScribeIntake.read(new CampaignBuilder('Halvard').narrator(text).messages).messages;
}

/**
 * @param {object} state
 * @param {string[]|null} labels
 * @param {object} changes
 * @return {object|null}
 */
function composed(state, labels, changes = {}) {
    return ScribeReminder.compose({
        state,
        now: labels === null ? null : scene(state, labels),
        player: 'Halvard',
        unread: [],
        notes: [],
        characters: null,
        first: [],
        ...changes,
    });
}

/**
 * @param {object} state
 * @param {string[]|null} labels
 * @param {object} changes
 * @return {string|null}
 */
function said(state, labels, changes = {}) {
    const result = composed(state, labels, changes);
    return result === null ? null : result.text;
}

/**
 * @param {string|null} text
 * @return {string[]}
 */
function sentences(text) {
    return text === null ? [] : text.slice(LEAD.length).split(/(?<=\.) /);
}

test('story corrections expose only current public wording with the owner and relation target in the scene', () => {
    const log = ScribeLog.create();
    const original = apply(log, {
        SUBJECTS: ['Mira | character', 'Mirra | character', 'Oren | character'],
        FACTS: ['Mira | relation to Mirra | old bounty | #1', 'Mira | trait | hidden habit | hidden | #2',
            'Mira | hair | black | #4', 'Oren | role | unknown trade | #2', 'Mira | trait | personal history | #5'],
        SCENES: ['Day 1 | #1-#4 | The market | public | present: Mira, Mirra, Oren | They wait'],
    }, stretch(1, 5));
    const edits = { 'old bounty': 'offers 50,000 gold', 'hidden habit': 'quietly copies keys', black: 'copper',
        'unknown trade': 'builds bridges', 'personal history': 'knows the private route' };
    for (const fact of original.facts) {
        rule(log, { type: 'EditFact', fact: fact.id, expected: ScribeLog.editExpected(fact), text: edits[fact.text] });
    }
    const state = ScribeReplay.run(log, storyOrder);
    const words = (labels) => ScribeReminder.storyCorrections(state, scene(state, labels), 'Halvard').join('\n');
    const publicRoom = words(['Mira', 'Mirra']);
    assert.ok(publicRoom.includes('offers 50,000 gold'));
    assert.ok(!publicRoom.includes('quietly copies keys'));
    assert.ok(!publicRoom.includes('builds bridges'));
    assert.ok(!publicRoom.includes('knows the private route'));
    assert.ok(!words(['Mira']).includes('offers 50,000 gold'));
    assert.ok(!words(['Mirra']).includes('offers 50,000 gold'));
    assert.ok(!said(state, ['Mira', 'Mirra'], { first: ['F5'] })?.includes('knows the private route'));
});

/**
 * @param {string} name
 * @param {string} kind
 * @param {string} text
 * @param {number} position
 * @return {object}
 */
function note(name, kind, text, position = 45) {
    const message = `MESSAGE-${position}`;
    return Object.freeze({ name, kind, text, message, fingerprint: `print-${position}`, position });
}

/**
 * @param {string} name
 * @param {string} text
 * @param {number} position
 * @return {object}
 */
function wears(name, text, position = 45) {
    return note(name, 'Wearing', text, position);
}

/**
 * @param {string} name
 * @param {string} text
 * @param {number} position
 * @return {object}
 */
function looks(name, text, position = 45) {
    return note(name, 'Looks', text, position);
}

const FIXED = Object.freeze(['kind', 'age', 'eyes', 'hair', 'build', 'skin']);

/**
 * @param {Array<[string, string]>} texts
 * @return {object}
 */
function filed(texts) {
    const log = ScribeLog.create();
    let state = apply(
        log,
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character'],
            SCENES: ['Day 1 | #1-#50 | The hall | public | present: Halvard, Mirelle | They feast'],
        },
        stretch(1, 50),
    );
    const mirelle = idOf(state, 'Mirelle');
    for (const [index, [category, text]] of texts.entries()) {
        const operation = FIXED.includes(category)
            ? { type: 'Pin', subject: mirelle, category, target: null, text, hidden: false }
            : {
                  type: 'AddFact',
                  subject: mirelle,
                  category,
                  target: null,
                  text,
                  hidden: false,
                  cite: `MESSAGE-${index + 2}`,
                  position: index + 2,
              };
        state = rule(log, operation);
    }
    return state;
}

/**
 * @param {object} state
 * @param {string[]} labels
 * @param {string} player
 * @return {Array<string|null>}
 */
function labelsOf(state, labels, player = 'Halvard') {
    return plain(ScribeReminder.people(state, scene(state, labels), player).map((person) => person.label));
}

/**
 * @param {string} text
 * @return {void}
 */
function assertFramed(text) {
    assert.equal(text.startsWith(LEAD), true, text);
    assert.equal(ScribeIntake.own(text), true, text);
    assert.equal(/[\r\n\u2028\u2029]/.test(text), false, text);
    assert.equal(/[\[\]@]/.test(text.slice(LEAD.length).normalize('NFKC')), false, text);
    assert.equal(Array.from(text).length <= 3000, true, text);
}

/**
 * @return {object}
 */
function frost() {
    return book(
        {
            SUBJECTS: [
                'Frost | character',
                'Thessaly | character',
                'Veyra | character',
                'Selene | character',
                'Mavan the Gray | character',
                "Frost's apartment | place",
                'Ashenmaw Ruins | place',
            ],
            FACTS: [
                'Frost | background | knows a Malachai connected to the Staff of Elders | hidden | #3',
                'Frost | eyes | blue-gray | #4',
                'Thessaly | eyes | teal | #5',
                'Thessaly | hair | silver | #6',
                'Thessaly | build | tall | #7',
                'Thessaly | condition | pajamas | #8',
                'Mavan the Gray | hair | gray | #9',
                'Mavan the Gray | feature | a fresh scar across his jaw | #10',
                "Frost's apartment | appearance | a cramped loft above a tannery | #11",
                'Ashenmaw Ruins | appearance | a broken tower over a flooded courtyard | #12',
            ],
            THREADS: [
                'OPEN | Frost owes Selene a favour | #13',
                'OPEN | the guild sent Frost and Mavan to the Ashenmaw Ruins job | #20',
            ],
            SCENES: [
                "Day 1 | #1-#20 | Frost's apartment | private | present: Frost, Thessaly, Veyra, Selene | They wake",
            ],
        },
        20,
    );
}

const FROST_NOTES = Object.freeze([
    wears('Frost', 'a travel cloak over leather armour', 40),
    wears('Thessaly', 'a dented breastplate and a travel cloak', 41),
    wears('Veyra', "a hunter's green coat", 42),
    wears('Mavan the Gray', 'plate armour', 30),
    wears('Mavan', 'a sleeping robe', 43),
]);
const MAVAN = Object.freeze([
    Object.freeze({
        name: 'Mavan the Gray',
        description: 'An old wizard with long grey hair and a staff of ash wood.',
    }),
]);

test("the operator's three reminders are rebuilt in plain sentences", () => {
    const state = frost();
    const asFrost = { player: 'Frost', notes: FROST_NOTES, characters: MAVAN };
    const apartment = ScribeReminder.compose({
        state,
        now: { ...scene(state, ['Frost', 'Thessaly', 'Veyra', 'Selene']), day: 1, place: "Frost's apartment" },
        unread: [],
        first: [],
        ...asFrost,
    });
    const alone = ScribeReminder.compose({
        state,
        now: { ...scene(state, ['Frost']), day: 1, place: "Frost's apartment" },
        unread: [],
        first: [],
        ...asFrost,
    });
    const ruins = ScribeReminder.compose({
        state,
        now: {
            ...scene(state, ['Frost', 'Mavan the Gray', 'Thessaly', 'Veyra', 'Selene']),
            day: 2,
            place: 'Ashenmaw Ruins',
        },
        unread: [],
        first: [],
        ...asFrost,
    });
    const job = 'The party: the guild sent Frost and Mavan to the Ashenmaw Ruins job.';
    const ruinsLine = 'Ashenmaw Ruins: a broken tower over a flooded courtyard.';
    assert.equal(
        apartment.text,
        '[Scribe] Frost wears a travel cloak over leather armour. ' +
            'Thessaly wears a dented breastplate and a travel cloak; eyes: teal, hair: silver, build: tall. ' +
            `Veyra wears a hunter's green coat. ${job} ${ruinsLine}`,
    );
    assert.equal(alone.text, `[Scribe] Frost wears a travel cloak over leather armour. ${job} ${ruinsLine}`);
    assert.equal(
        ruins.text,
        '[Scribe] Frost wears a travel cloak over leather armour. ' +
            'Mavan the Gray wears a sleeping robe; hair: gray, feature: a fresh scar across his jaw. ' +
            'Thessaly wears a dented breastplate and a travel cloak; eyes: teal, hair: silver, build: tall. ' +
            `Veyra wears a hunter's green coat. ${job} ${ruinsLine}`,
    );
    for (const result of [apartment, alone, ruins]) {
        const text = result.text;
        assertFramed(text);
        assert.deepEqual(plain(result.led), []);
        assert.equal(/Day \d|Present:|private|public/.test(text), false, text);
        assert.equal(/Frost's apartment|cramped loft/.test(text), false, text);
        assert.equal(/Malachai|blue-gray|Frost (secretly|has|is) /.test(text), false, text);
        const frostSentences = sentences(text).filter((sentence) => sentence.startsWith('Frost '));
        assert.deepEqual(frostSentences, ['Frost wears a travel cloak over leather armour.'], text);
        const labelled = /\b(age|eyes|hair|build|skin|appearance|feature|background|condition|trait|location):/;
        assert.equal(labelled.test(text), result !== alone, text);
        assert.equal(/pajamas/.test(text), false, text);
        assert.equal(text.includes('"'), false, text);
        assert.equal(/only .* know/.test(text), false, text);
        assert.equal(text.includes(job), true, text);
        assertFrozenDeep(result, 'result');
    }
    assert.equal(/plate armour|gray hair/.test(ruins.text), false, ruins.text);
});

test('the cast description cannot override independently worded book or model details', () => {
    const state = book(
        {
            SUBJECTS: [
                'Halvard | character',
                'Mavan the Gray | character',
                'Isolde | character',
                'The Old Mill | place',
            ],
            FACTS: [
                'Mavan the Gray | hair | gray | #2',
                'Mavan the Gray | feature | a scar across his cheek | #3',
                'Isolde | hair | grey | #4',
                'Isolde | eyes | green | #5',
            ],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Mavan the Gray, Isolde | They feast'],
        },
        10,
    );
    const room = ['Halvard', 'Mavan the Gray', 'Isolde'];
    const description = 'An old wizard with long grey hair and a staff.';
    const story = [{ name: 'Mavan the Gray', description }];
    const mavan = (characters, notes = []) =>
        sentences(said(state, room, { characters, notes })).filter((sentence) => sentence.startsWith('Mavan'));
    const both = ['Mavan the Gray: hair: gray, feature: a scar across his cheek.'];
    assert.deepEqual(mavan(story), both);
    assert.deepEqual(mavan(null), both);
    assert.deepEqual(mavan([{ name: 'Mavan', description }]), both);
    assert.deepEqual(mavan([{ name: 'Mava', description }]), both);
    assert.deepEqual(mavan([{ name: 'Corvane', description }]), both);
    assert.deepEqual(mavan([{ name: 'Mavan the Gray', description: '' }]), both);
    assert.deepEqual(
        sentences(said(state, room, { characters: story })).filter((sentence) => sentence.startsWith('Isolde')),
        ['Isolde: eyes: green, hair: grey.'],
    );
    const inside = [looks('Mavan', 'long grey hair', 1), looks('Isolde', 'long grey hair', 1)];
    assert.deepEqual(mavan(story, inside), ['Mavan the Gray: hair: gray, feature: a scar across his cheek, long grey hair.']);
    assert.deepEqual(mavan(null, inside), ['Mavan the Gray: hair: gray, feature: a scar across his cheek, long grey hair.']);
    const custom = said(state, room, { characters: story, notes: inside });
    assert.equal(custom.includes('Isolde: eyes: green, hair: grey, long grey hair.'), true, custom);
    const scarred = [looks('Mavan the Gray', 'a burn on his hand', 1)];
    assert.deepEqual(mavan(story, scarred), ['Mavan the Gray: hair: gray, feature: a scar across his cheek, a burn on his hand.']);
    assert.deepEqual(mavan(story, [looks('Mavan the Gray', 'long grey hair', 46)]), ['Mavan the Gray: long grey hair.']);
    assert.deepEqual(mavan(story, [looks('Mavan the Gray', 'a burn on his hand', 46)]), [
        'Mavan the Gray: a burn on his hand.',
    ]);
    const mavanId = idOf(state, 'Mavan the Gray');
    assert.equal(ScribeReminder.writer(state, mavanId, story), description);
    assert.equal(ScribeReminder.writer(state, mavanId, null), null);
    assert.equal(ScribeReminder.writer(state, mavanId, [{ name: 'Mava', description }]), null);
    assert.equal(ScribeReminder.writer(state, idOf(state, 'Isolde'), story), null);
    const mill = idOf(state, 'The Old Mill');
    assert.equal(ScribeReminder.writer(state, mill, [{ name: 'The Old Mill', description }]), null);
    assert.equal(
        ScribeReminder.writer(state, mavanId, [
            { name: 'Mavan', description: 'the first' },
            { name: 'Mavan the Gray', description: 'the exact one' },
        ]),
        'the exact one',
    );
    assert.equal(ScribeReminder.added('gray', 'long grey hair'), true);
    assert.equal(ScribeReminder.added('a scar', 'long grey hair'), true);
    assert.equal(ScribeReminder.added('the and of', 'nothing'), true);
    assert.equal(ScribeReminder.added('Long GREY hair', 'long grey hair'), true);
});

test('only an identical description is treated as duplicate reminder text', () => {
    const state = book(
        {
            SUBJECTS: ['Halvard | character', 'Selene | character'],
            FACTS: ['Selene | eyes | blue | #5', 'Selene | hair | short and black | #6', 'Selene | build | tall | #7'],
            SCENES: ['Day 1 | #1-#20 | The hall | public | present: Halvard, Selene | They wake'],
        },
        20,
    );
    const description = 'Selene is a priestess with green eyes, long black hair and a short blue cloak. She is tall.';
    const characters = [{ name: 'Selene', description }];
    const told = said(state, ['Halvard', 'Selene'], { characters });
    assert.equal(told, '[Scribe] Selene: eyes: blue, hair: short and black, build: tall.');
    assert.equal(said(state, ['Halvard', 'Selene']), '[Scribe] Selene: eyes: blue, hair: short and black, build: tall.');
    assert.equal(ScribeReminder.added('blue eyes', description), true);
    assert.equal(ScribeReminder.added('green eyes', description), true);
    assert.equal(ScribeReminder.added('black hair', description), true);
    assert.equal(ScribeReminder.added('short and black hair', description), true);
    assert.equal(ScribeReminder.added('a short blue cloak', description), true);
    assert.equal(ScribeReminder.added('a blue short cloak', description), true);
    const matching = [{ name: 'Selene', description: 'Blue eyes and short, black hair; very tall.' }];
    assert.equal(said(state, ['Halvard', 'Selene'], { characters: matching }), told);
    assert.equal(ScribeReminder.added(description, description), false);
});

test('a looks note newer than every book look stands alone, and an older one joins them', () => {
    const state = book(
        {
            SUBJECTS: ['Halvard | character', 'Brandt | character', 'Thessaly | character'],
            FACTS: [
                'Brandt | hair | red | #7',
                'Brandt | age | 42 | #8',
                'Brandt | build | stocky | #9',
                'Brandt | feature | a scar on his chin | hidden | #12',
                'Thessaly | eyes | teal | #5',
                'Thessaly | hair | silver | #6',
            ],
            SCENES: ['Day 1 | #1-#20 | The hall | public | present: Halvard, Brandt, Thessaly | They wake'],
        },
        20,
    );
    const secret = 'Brandt (private): feature: a scar on his chin; no one else here knows.';
    const brandt = (position) =>
        said(state, ['Halvard', 'Brandt'], { notes: [looks('Brandt', 'twenty, tall, with black hair', position)] });
    assert.equal(brandt(45), `[Scribe] ${secret} Brandt: twenty, tall, with black hair.`);
    assert.equal(brandt(10), `[Scribe] ${secret} Brandt: twenty, tall, with black hair.`);
    assert.equal(brandt(9), `[Scribe] ${secret} Brandt: age: 42, hair: red, build: stocky, twenty, tall, with black hair.`);
    assert.equal(brandt(3), `[Scribe] ${secret} Brandt: age: 42, hair: red, build: stocky, twenty, tall, with black hair.`);
    assert.equal(said(state, ['Halvard', 'Brandt']), `[Scribe] ${secret} Brandt: age: 42, hair: red, build: stocky.`);
    const worn = said(state, ['Halvard', 'Brandt'], {
        notes: [looks('Brandt', 'a shaved head', 45), wears('Brandt', 'a leather apron', 45)],
    });
    assert.equal(worn, `[Scribe] Brandt wears a leather apron; a shaved head. ${secret}`);
    const both = said(state, ['Halvard', 'Brandt', 'Thessaly'], {
        notes: [looks('Brandt', 'a shaved head', 45), looks('Thessaly', 'a silver circlet', 2)],
    });
    assert.equal(
        both,
        `[Scribe] ${secret} Brandt: a shaved head. Thessaly: eyes: teal, hair: silver, a silver circlet.`,
    );
});

test('a looks note that restates the book is not said twice', () => {
    const state = book(
        {
            SUBJECTS: ['Halvard | character', 'Thessaly | character'],
            FACTS: ['Thessaly | eyes | teal | #5', 'Thessaly | hair | silver | #6'],
            SCENES: ['Day 1 | #1-#20 | The hall | public | present: Halvard, Thessaly | They wake'],
        },
        20,
    );
    const thessaly = (text, position) =>
        said(state, ['Halvard', 'Thessaly'], { notes: [looks('Thessaly', text, position)] });
    assert.equal(thessaly('teal eyes and silver hair', 5), '[Scribe] Thessaly: eyes: teal, hair: silver, teal eyes and silver hair.');
    assert.equal(thessaly('Silver hair; teal eyes', 5), '[Scribe] Thessaly: eyes: teal, hair: silver, Silver hair; teal eyes.');
    assert.equal(thessaly('teal eyes', 5), '[Scribe] Thessaly: eyes: teal, hair: silver, teal eyes.');
    assert.equal(thessaly('teal eyes and silver hair', 45), '[Scribe] Thessaly: teal eyes and silver hair.');
    assert.equal(
        thessaly('silver eyes and teal hair', 5),
        '[Scribe] Thessaly: eyes: teal, hair: silver, silver eyes and teal hair.',
    );
    assert.equal(thessaly('long silver hair', 5), '[Scribe] Thessaly: eyes: teal, hair: silver, long silver hair.');
    const pinned = filed([['eyes', 'grey']]);
    const restated = said(pinned, ['Halvard', 'Mirelle'], { notes: [looks('Mirelle', 'grey eyes', 45)] });
    assert.equal(restated, '[Scribe] Mirelle: eyes: grey. Mirelle: grey eyes.');
    const added = said(pinned, ['Halvard', 'Mirelle'], { notes: [looks('Mirelle', 'grey eyes, a crooked nose', 45)] });
    assert.equal(added, '[Scribe] Mirelle: eyes: grey. Mirelle: grey eyes, a crooked nose.');
});

test('a secret says who here knows it, and only when someone here does not', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        {
            SUBJECTS: [
                'Halvard | character',
                'Mirelle | character',
                'Isolde | character',
                'Kira | character',
                'Dr! Venn | character',
            ],
            FACTS: [
                'Mirelle | background | poisoned the old king | hidden | #5',
                'Mirelle | feature | a scar under her collar | hidden | #6',
                'Mirelle | eyes | brown | #7',
            ],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Mirelle, Isolde, Kira | They feast'],
        },
        stretch(1, 10),
    );
    const king = factSaying(first, 'poisoned the old king').id;
    const poisoned = (state, room, player = 'Halvard') =>
        sentences(said(state, room, { player })).filter((sentence) => sentence.includes('poisoned'));
    assert.deepEqual(poisoned(first, ['Halvard', 'Mirelle', 'Isolde']), [
        'Mirelle (private): background: poisoned the old king; no one else here knows.',
    ]);
    const scar = sentences(said(first, ['Halvard', 'Mirelle', 'Isolde']));
    assert.deepEqual(scar, [
        'Mirelle (private): background: poisoned the old king; no one else here knows.',
        'Mirelle (private): feature: a scar under her collar; no one else here knows.',
        'Mirelle: eyes: brown.',
    ]);
    const toHalvard = apply(log, { TOLD: [`${king} | Mirelle | Halvard | #12`] }, pick(12));
    assert.deepEqual(poisoned(toHalvard, ['Halvard', 'Mirelle', 'Isolde']), [
        'Mirelle (private): background: poisoned the old king; only Halvard knows.',
    ]);
    assert.deepEqual(poisoned(toHalvard, ['Mirelle', 'Isolde']), [
        'Mirelle (private): background: poisoned the old king; only Halvard knows.',
    ]);
    const toIsolde = apply(log, { TOLD: [`${king} | Mirelle | Isolde | #14`] }, pick(14));
    assert.deepEqual(poisoned(toIsolde, ['Halvard', 'Mirelle', 'Isolde', 'Kira']), [
        'Mirelle (private): background: poisoned the old king; only Halvard and Isolde know.',
    ]);
    assert.deepEqual(poisoned(toIsolde, ['Halvard', 'Mirelle', 'Isolde']), []);
    assert.deepEqual(poisoned(toIsolde, ['Halvard', 'Mirelle', 'Isolde', 'a guard']), [
        'Mirelle (private): background: poisoned the old king; only Halvard and Isolde know.',
    ]);
    const toKira = apply(log, { TOLD: [`${king} | Mirelle | Kira | #16`] }, pick(16));
    assert.deepEqual(poisoned(toKira, ['Halvard', 'Mirelle', 'Isolde', 'Kira', 'a guard']), [
        'Mirelle (private): background: poisoned the old king; only Halvard, Isolde and Kira know.',
    ]);
    const toVenn = apply(log, { TOLD: [`${king} | Mirelle | Dr! Venn | #18`] }, pick(18));
    assert.deepEqual(poisoned(toVenn, ['Halvard', 'Mirelle', 'Isolde', 'Kira', 'Dr! Venn', 'a guard']), []);
    assert.deepEqual(poisoned(first, ['Mirelle'], 'Corvane'), []);
    assert.deepEqual(poisoned(first, ['Mirelle', 'a guard'], 'Corvane'), [
        'Mirelle (private): background: poisoned the old king; no one else here knows.',
    ]);
    for (const state of [first, toHalvard, toIsolde, toKira, toVenn]) {
        const text = said(state, ['Halvard', 'Mirelle', 'Isolde', 'Kira']);
        assert.ok(sentences(text).filter((line) => line.includes('scar')).every((line) => line.startsWith('Mirelle (private): feature: ')), text);
    }
    const halvardSecret = book(
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character'],
            FACTS: ['Halvard | background | deserted at the siege | hidden | #5'],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Mirelle | They feast'],
        },
        10,
    );
    assert.equal(said(halvardSecret, ['Halvard', 'Mirelle']), null);
});

test('the cap drops places, the job, looks last first, filed facts, secrets, wearing, never a correction', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        {
            SUBJECTS: [
                'Halvard | character',
                'Mirelle | character',
                'Isolde | character',
                'Brandt | character',
                'Ashby | place',
                'Corvane Keep | place',
            ],
            FACTS: [
                'Mirelle | age | 30 | #2',
                'Mirelle | eyes | lookmir brown | #3',
                'Isolde | eyes | lookiso green | #4',
                'Brandt | build | lookbra broad and heavy | #5',
                'Brandt | background | secretbra deserted the guard | hidden | #6',
                'Ashby | appearance | placeone a village of grey stone | #7',
                'Corvane Keep | appearance | placetwo a keep on a black crag | #8',
            ],
            THREADS: ['OPEN | jobword ride from Ashby to Corvane Keep before the snow | #9'],
            SCENES: ['Day 1 | #1-#20 | The hall | public | present: Halvard, Mirelle, Isolde, Brandt | They feast'],
        },
        stretch(1, 20),
    );
    const state = rule(log, {
        type: 'AddFact',
        subject: idOf(first, 'Isolde'),
        category: 'trait',
        target: null,
        text: 'hums when nervous filediso',
        hidden: false,
        cite: 'MESSAGE-21',
        position: 21,
    });
    const age = factSaying(state, '30').id;
    const notes = [
        wears('Halvard', 'wearhal a long grey cloak with a fur collar over leather armour and riding boots', 41),
        wears('Mirelle', 'wearmir a red dress with a laced bodice and a black shawl', 42),
        wears('Isolde', 'weariso a green tunic belted with silver over grey breeches', 43),
        wears('Brandt', 'wearbra a leather apron over a sweat-stained shirt', 44),
    ];
    const order = [
        'placetwo',
        'placeone',
        'jobword',
        'lookbra',
        'lookiso',
        'lookmir',
        'filediso',
        'secretbra',
        'wearbra',
        'weariso',
        'wearmir',
        'wearhal',
    ];
    const room = ['Halvard', 'Mirelle', 'Isolde', 'Brandt'];
    const whole = composed(state, room, { notes, first: [age] });
    assert.equal(
        whole.text,
        '[Scribe] Mirelle: age: 30. ' +
            'Halvard wears wearhal a long grey cloak with a fur collar over leather armour and riding boots. ' +
            'Mirelle wears wearmir a red dress with a laced bodice and a black shawl; eyes: lookmir brown. ' +
            'Isolde wears weariso a green tunic belted with silver over grey breeches; eyes: lookiso green. ' +
            'Brandt wears wearbra a leather apron over a sweat-stained shirt; build: lookbra broad and heavy. ' +
            'Brandt (private): background: secretbra deserted the guard; no one else here knows. ' +
            'Isolde: trait: hums when nervous filediso. ' +
            'The party: jobword ride from Ashby to Corvane Keep before the snow. ' +
            'Ashby: placeone a village of grey stone. Corvane Keep: placetwo a keep on a black crag.',
    );
    assert.deepEqual(plain(whole.led), [age]);
    const gone = [];
    let longest = 0;
    const opening = '[Scribe] The story so far: ';
    const correction = ' Mirelle: age: 30.';
    const widest = 3000 - Array.from(opening).length - Array.from(correction).length;
    const narrowest = 3000 - Array.from(whole.text).length - Array.from(opening).length;
    for (let size = narrowest; size <= widest; size++) {
        const story = `${deseret.repeat(size - 1)}.`;
        const result = composed(state, room, { notes, first: [age], story });
        assertFramed(result.text);
        assert.deepEqual(plain(result.led), [age], String(size));
        assert.equal(result.text.startsWith(`${opening}${story}${correction}`), true, String(size));
        longest = Math.max(longest, Array.from(result.text).length);
        for (const marker of order) {
            const here = result.text.includes(marker);
            if (!here && !gone.includes(marker)) {
                gone.push(marker);
            }
            assert.equal(here, !gone.includes(marker), `${marker} came back at ${size}`);
        }
        for (const person of ['Mirelle', 'Isolde', 'Brandt']) {
            const marker = `look${person.slice(0, 3).toLowerCase()}`;
            const wear = `wear${person.slice(0, 3).toLowerCase()}`;
            if (result.text.includes(marker) && result.text.includes(wear)) {
                assert.match(result.text, new RegExp(`${person} wears ${wear} [^.;]*; (?:eyes|build): ${marker} [^.]*\\.`));
            }
        }
    }
    assert.deepEqual(gone, order);
    assert.equal(longest, 3000);
    const crowded = `${deseret.repeat(widest)}.`;
    const storyOnly = composed(state, room, { notes, first: [age], story: crowded });
    assert.equal(storyOnly.text, `${opening}${crowded}`);
    assert.deepEqual(plain(storyOnly.led), []);
    const again = composed(state, room, { notes, first: [age] });
    assert.deepEqual(plain(again), plain(whole));
    const over = state.facts.map((fact) => (fact.id === age ? { ...fact, text: `30${deseret.repeat(199)}` } : fact));
    assert.deepEqual(plain(composed({ ...state, facts: over }, room, { notes, first: [age] }).led), [age]);
});

test('the cap is exact at 3,000 characters, an astral character counted once', () => {
    const job = deseret.repeat(200);
    const state = book(
        {
            SUBJECTS: ['Halvard | character'],
            THREADS: [`OPEN | ${job} | #3`],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard | He waits'],
        },
        10,
    );
    const opening = '[Scribe] The story so far: ';
    const tail = ` Halvard wears ${'x'.repeat(100)}. The party: ${job}.`;
    const fill = 3000 - Array.from(opening).length - Array.from(tail).length;
    const wearing = (story) => said(state, ['Halvard'], { notes: [wears('Halvard', 'x'.repeat(100))], story });
    const fitting = `${deseret.repeat(fill - 1)}.`;
    const exact = wearing(fitting);
    assert.equal(Array.from(exact).length, 3000);
    assert.equal(exact, `${opening}${fitting}${tail}`);
    const longer = `${deseret.repeat(fill)}.`;
    assert.equal(wearing(longer), `${opening}${longer} Halvard wears ${'x'.repeat(100)}.`);
    assert.equal(said(state, ['Halvard'], { notes: [wears('Halvard', 'x'.repeat(164))] }).includes('The party: '), true);
    const lone = book(
        {
            SUBJECTS: ['Halvard | character', `${deseret.repeat(4)} | character`],
            FACTS: [`${deseret.repeat(4)} | trait | ${deseret.repeat(200)} | #2`],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard | He waits'],
        },
        10,
    );
    const owner = factSaying(lone, deseret.repeat(200)).id;
    const big = said(lone, ['Halvard', deseret.repeat(4)], { first: [owner] });
    assert.equal(big, `[Scribe] ${deseret.repeat(4)}: trait: ${deseret.repeat(200)}.`);
    assert.equal(ScribeText.bytes(big) <= 1000, true);
});

test('public model wording survives frame-like characters and the former per-value length boundary', () => {
    const values = ['writes [Scribe] on walls', 'hums ] softly', 'signs @Isolde', 'waves ＠Isolde', 'h'.repeat(201),
        'keeps notes in C:\\ledgers', 'quiet', ' .;, '];
    const state = filed(values.slice(0, -1).map((text) => ['trait', text]));
    const text = said(state, ['Halvard', 'Mirelle']);
    for (const value of values.slice(0, -1)) {
        assert.ok(text.includes(value), value);
    }
    for (const value of values) {
        assert.equal(ScribeReminder.guarded(value), value);
    }
});

test('no wearing note means no clothing, and the scene names a person the book does not know', () => {
    const state = book(
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Isolde | character'],
            FACTS: ['Mirelle | condition | in pajamas | #5', 'Mirelle | eyes | grey | #6'],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Mirelle, Isolde | They feast'],
        },
        10,
    );
    assert.equal(said(state, ['Halvard', 'Mirelle', 'Isolde']), '[Scribe] Mirelle: eyes: grey.');
    const stranger = said(state, ['Halvard', 'Mirelle', 'Garrick'], {
        notes: [wears('Garrick', 'a guardsman tabard'), looks('Garrick', 'a broken nose')],
    });
    assert.equal(stranger, '[Scribe] Garrick wears a guardsman tabard; a broken nose. Mirelle: eyes: grey.');
    assert.deepEqual(labelsOf(state, ['Halvard', 'Garrick', 'Dr! Venn', 'mirelle', 'HALVARD', 'Isolde knows it too']), [
        'Halvard',
        'Garrick',
        null,
        null,
        null,
        null,
    ]);
    for (const name of ['Dr! Venn', 'Isolde knows it too']) {
        const text = said(state, ['Halvard', name], { notes: [wears(name, 'a cloak')] });
        assert.equal(text, null, name);
    }
    assert.equal(
        said(state, ['Halvard', 'Garrick', 'garrick'], { notes: [wears('Garrick', 'a cloak')] }),
        '[Scribe] Garrick wears a cloak.',
    );
    assert.equal(said(state, ['Halvard', 'Mirelle'], { notes: [wears('Halvard', 'wearing a grey cloak')] }).startsWith(
        '[Scribe] Halvard wears a grey cloak.',
    ), true);
});

test('wearing notes are matched to the people here, newest first, across the forms the book knows', () => {
    const state = book(
        {
            SUBJECTS: [
                'Halvard | character',
                'Mavan the Gray | character',
                'Isolde | character',
                'Kira Vell | character',
                'Kira Moss | character',
            ],
            FACTS: ['Isolde | aka | Izzy | #2'],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Mavan the Gray, Isolde | They feast'],
        },
        10,
    );
    const worn = (room, notes, player = 'Halvard') =>
        sentences(said(state, room, { notes, player })).filter((sentence) => sentence.includes(' wears '));
    const notes = [
        wears('Mavan the Gray', 'plate armour', 10),
        wears('Mavan', 'a sleeping robe', 12),
        wears('Izzy', 'a riding coat', 13),
        wears('isolde', 'a silk gown', 11),
        wears('The Halvard', 'a grey cloak', 14),
    ];
    assert.deepEqual(worn(['Halvard', 'Mavan the Gray', 'Isolde'], notes), [
        'Halvard wears a grey cloak.',
        'Mavan the Gray wears a sleeping robe.',
        'Isolde wears a riding coat.',
    ]);
    assert.deepEqual(worn(['Halvard', 'Mavan the Gray', 'Isolde'], notes.slice(0, 1)), [
        'Mavan the Gray wears plate armour.',
    ]);
    const kiras = [wears('Kira', 'an apron', 20), wears('Kira Vell', 'a smock', 15)];
    assert.deepEqual(worn(['Halvard', 'Kira Vell', 'Kira Moss'], kiras), ['Kira Vell wears a smock.']);
    assert.deepEqual(worn(['Halvard', 'Kira Vell'], kiras), ['Kira Vell wears an apron.']);
    assert.deepEqual(worn(['Mavan the Gray'], [wears('Hal', 'a grey cloak'), wears('Halvard', 'a blue cloak', 9)]), [
        'Halvard wears a blue cloak.',
    ]);
    assert.deepEqual(worn(['Mavan the Gray', 'Isolde'], [wears('Orla', 'a hood')], 'Orla'), []);
    const orla = book(
        {
            SUBJECTS: ['Orla | character', 'Isolde | character'],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Orla, Isolde | They feast'],
        },
        10,
    );
    assert.equal(
        said(orla, ['Isolde'], { player: 'Orla', notes: [wears('Orla', 'a hood')] }),
        '[Scribe] Orla wears a hood.',
    );
    assert.equal(said(orla, null, { player: 'Orla', notes: [wears('Orla', 'a hood')] }), '[Scribe] Orla wears a hood.');
    assert.equal(said(orla, null, { player: 'Corvane', notes: [wears('Orla', 'a hood')] }), null);
});

test('a note goes to a present person by its exact name, and by a prefix only when no one else holds the name', () => {
    const state = book(
        {
            SUBJECTS: [
                'Halvard | character',
                'Kira | character',
                'Kira Vell | character',
                'Mavan | character',
                'Mavan the Gray | character',
            ],
            FACTS: ['Mavan the Gray | feature | a fresh scar across his jaw | #5'],
            SCENES: ['Day 1 | #1-#20 | The hall | public | present: Halvard, Kira, Kira Vell | They wake'],
        },
        20,
    );
    const notes = [
        wears('Kira Vell', 'a smock', 15),
        wears('Kira', 'an apron', 20),
        wears('Mavan the Gray', 'grey robes', 15),
        wears('Mavan', 'a page uniform', 20),
    ];
    assert.equal(said(state, ['Halvard', 'Kira Vell'], { notes }), '[Scribe] Kira Vell wears a smock.');
    assert.equal(
        said(state, ['Halvard', 'Kira', 'Kira Vell'], { notes }),
        '[Scribe] Kira wears an apron. Kira Vell wears a smock.',
    );
    assert.equal(said(state, ['Halvard', 'Kira Vell'], { notes: notes.slice(1, 2) }), null);
    assert.equal(
        said(state, ['Halvard', 'Mavan the Gray'], { notes }),
        '[Scribe] Mavan the Gray wears grey robes; feature: a fresh scar across his jaw.',
    );
    const frost = book(
        {
            SUBJECTS: ['Frost Hammer | character', 'Frost Valen | character', 'Isolde | character'],
            FACTS: ['Isolde | eyes | green | #5'],
            SCENES: ['Day 1 | #1-#20 | The hall | public | present: Frost Hammer, Isolde | They feast'],
        },
        20,
    );
    assert.equal(ScribeReminder.namesakes(frost, 'Frost').length, 2);
    const unresolved = said(frost, ['Frost Hammer', 'Isolde'], {
        player: 'Frost',
        notes: [wears('Frost', 'a travel cloak over leather armour', 50), wears('Frost Hammer', 'a smith apron', 40)],
    });
    assert.equal(unresolved, '[Scribe] Frost Hammer wears a smith apron. Isolde: eyes: green.');
    const alone = said(frost, ['Frost Hammer', 'Isolde'], {
        player: 'Frost',
        notes: [wears('Frost', 'a travel cloak over leather armour', 50)],
    });
    assert.equal(alone, '[Scribe] Isolde: eyes: green.');
});

test('a label that holds another subject name still carries its own clothing and looks', () => {
    const state = book(
        {
            SUBJECTS: [
                'Halvard | character',
                'Mavan | character',
                'Mavan the Gray | character',
                'Thessaly | character',
            ],
            FACTS: [
                'Mavan the Gray | feature | a fresh scar across his jaw | #5',
                'Mavan the Gray | trait | hoards silver | hidden | #6',
            ],
            SCENES: ['Day 1 | #1-#20 | The hall | public | present: Halvard, Mavan the Gray, Thessaly | They wake'],
        },
        20,
    );
    const room = ['Halvard', 'Mavan the Gray', 'Thessaly'];
    assert.deepEqual(labelsOf(state, room), ['Halvard', null, 'Thessaly']);
    const notes = [
        wears('Mavan the Gray', 'grey robes', 15),
        wears('Thessaly', 'a dented breastplate', 16),
        wears('Mavan', 'a page uniform', 20),
    ];
    assert.equal(
        said(state, room, { notes }),
        '[Scribe] Mavan the Gray wears grey robes; feature: a fresh scar across his jaw. Thessaly wears a dented breastplate.',
    );
    assert.equal(said(state, room), '[Scribe] Mavan the Gray: feature: a fresh scar across his jaw.');
    const both = said(state, ['Halvard', 'Mavan', 'Mavan the Gray'], { notes });
    assert.equal(
        both,
        '[Scribe] Mavan wears a page uniform. Mavan the Gray wears grey robes; feature: a fresh scar across his jaw.',
    );
});

test('the job is the newest open thread that names a place, with up to two of its places', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        {
            SUBJECTS: [
                'Halvard | character',
                'Ashby | place',
                'Corvane Keep | place',
                'the Salt Road | place',
                'Brightwater | place',
                'Mirelle | character',
            ],
            FACTS: [
                'Ashby | appearance | a village of grey stone | #2',
                'Ashby | location | on the river bend | #3',
                'Corvane Keep | appearance | a keep on a black crag | #4',
                'Corvane Keep | feature | a bridge of rope | hidden | #5',
                'the Salt Road | trait | dusty | #6',
                'Brightwater | location | by the lake | #7',
            ],
            THREADS: [
                'OPEN | carry the letter through Brightwater | #8',
                'OPEN | ride the Salt Road past Corvane Keep and Ashby to Brightwater | #10',
                'OPEN | Mirelle owes a favour | #12',
            ],
            SCENES: ['Day 1 | #1-#20 | The hall | public | present: Halvard, Mirelle | They feast'],
        },
        stretch(1, 20),
    );
    assert.equal(
        said(first, ['Halvard']),
        '[Scribe] The party: ride the Salt Road past Corvane Keep and Ashby to Brightwater. ' +
            'Corvane Keep: a keep on a black crag. Ashby: on the river bend.',
    );
    const ride = first.threads.find((thread) => thread.text.startsWith('ride the Salt Road')).id;
    const closing = apply(log, { THREADS: [`CLOSE ${ride} | they reached Brightwater | #22`] }, pick(22));
    const left = said(closing, ['Halvard']);
    assert.equal(left, '[Scribe] The party: carry the letter through Brightwater. Brightwater: by the lake.');
    const plainThreads = book(
        {
            SUBJECTS: ['Halvard | character', 'Ashby | place'],
            THREADS: ['OPEN | find the thief | #2', 'OPEN | pay the smith | #4'],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard | He waits'],
        },
        10,
    );
    assert.equal(said(plainThreads, ['Halvard']), '[Scribe] The party: pay the smith.');
    const none = book(
        {
            SUBJECTS: ['Halvard | character', 'Ashby | place'],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard | He waits'],
        },
        10,
    );
    assert.equal(said(none, ['Halvard']), null);
    assert.equal(said(none, ['Halvard'], { notes: [wears('Halvard', 'a cloak')] }), '[Scribe] Halvard wears a cloak.');
});

test('a place is found by its whole name, longest first, and a name inside a longer one is skipped', () => {
    const places = (threads) =>
        said(
            book(
                {
                    SUBJECTS: [
                        'Halvard | character',
                        'Ashenmaw Ruins | place',
                        'Ashenmaw | place',
                        'Ruins of the Old Keep | place',
                        'Old Keep | place',
                        'Keep | place',
                        'Salt and Stone | place',
                        'Ashen | place',
                        'Inn @ the Ford | place',
                    ],
                    NAMES: ['Inn by the Ford | Inn @ the Ford | #3'],
                    FACTS: [
                        'Ashenmaw Ruins | appearance | a broken tower over a flooded courtyard | #2',
                        'Ashenmaw | appearance | a mining town in the hills | #3',
                        'Ruins of the Old Keep | appearance | a shell of black stone | #4',
                        'Old Keep | appearance | a hill fort | #5',
                        'Keep | appearance | the duke keep in the capital | #6',
                        'Salt and Stone | appearance | a smugglers inn on the cliffs | #7',
                        'Ashen | appearance | a burnt village | #9',
                        'Inn @ the Ford | appearance | a low inn of grey stone | #9',
                    ],
                    THREADS: threads.map((thread, index) => `OPEN | ${thread} | #${index + 10}`),
                    SCENES: ['Day 1 | #1-#20 | The hall | public | present: Halvard | He waits'],
                },
                20,
            ),
            ['Halvard'],
        );
    assert.equal(
        places(['the guild sent Halvard to the Ashenmaw Ruins job']),
        '[Scribe] The party: the guild sent Halvard to the Ashenmaw Ruins job. ' +
            'Ashenmaw Ruins: a broken tower over a flooded courtyard.',
    );
    assert.equal(
        places(['the guild sent Halvard to the Ruins of the Old Keep']),
        '[Scribe] The party: the guild sent Halvard to the Ruins of the Old Keep. ' +
            'Ruins of the Old Keep: a shell of black stone.',
    );
    assert.equal(
        places(['ride from Ashenmaw to the Ashenmaw Ruins']),
        '[Scribe] The party: ride from Ashenmaw to the Ashenmaw Ruins. ' +
            'Ashenmaw: a mining town in the hills. Ashenmaw Ruins: a broken tower over a flooded courtyard.',
    );
    assert.equal(
        places(['the Old Keep and the Keep both burn']),
        '[Scribe] The party: the Old Keep and the Keep both burn. ' +
            'Old Keep: a hill fort. Keep: the duke keep in the capital.',
    );
    assert.equal(
        places(['meet the fence at Salt and Stone']),
        '[Scribe] The party: meet the fence at Salt and Stone. Salt and Stone: a smugglers inn on the cliffs.',
    );
    assert.equal(places(['walk the Ashenmawish road']), '[Scribe] The party: walk the Ashenmawish road.');
    assert.equal(places(['wait at the Inn by the Ford']), '[Scribe] The party: wait at the Inn by the Ford. Inn @ the Ford: a low inn of grey stone.');
});

test("corrections lead for anyone here but the main character's secrets, and led holds what was said", () => {
    const state = book(
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Isolde | character'],
            FACTS: [
                'Halvard | age | 34 | #2',
                'Halvard | build | scarred and lean | hidden | #3',
                'Mirelle | eyes | brown | #4',
                'Mirelle | relation to Halvard | old friends | #5',
                'Mirelle | location | the mill | #6',
                'Isolde | hair | black | #7',
            ],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Mirelle | They feast'],
        },
        10,
    );
    const texts = ['34', 'scarred and lean', 'brown', 'old friends', 'the mill', 'black'];
    const ids = texts.map((text) => factSaying(state, text).id);
    const result = composed(state, ['Halvard', 'Mirelle'], { first: [...ids, 'F999', ids[0]] });
    assert.deepEqual(sentences(result.text), [
        'Halvard: age: 34.',
        'Mirelle: eyes: brown.',
        'Mirelle toward Halvard: old friends.',
        'Mirelle: location: the mill.',
    ]);
    assert.deepEqual(plain(result.led), [ids[0], ids[2], ids[3], ids[4]]);
    assert.equal(/scarred/.test(result.text), false, result.text);
    const unread = composed(state, ['Halvard', 'Mirelle'], { first: ids, unread: unreadSaying('The rain falls.') });
    assert.deepEqual(plain(unread.led), [ids[0], ids[2]]);
    assert.equal(/old friends|the mill/.test(unread.text), false, unread.text);
    const plainResult = composed(state, ['Halvard', 'Mirelle']);
    for (const odd of [undefined, null, ids[0], new Set([ids[0]]), { 0: ids[0], length: 1 }, 9]) {
        assert.deepEqual(plain(composed(state, ['Halvard', 'Mirelle'], { first: odd })), plain(plainResult));
    }
});

test('a hidden fact that leads as a correction says who here knows it, once', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        {
            SUBJECTS: [
                'Halvard | character',
                'Mirelle | character',
                'Isolde | character',
                'Thessaly | character',
                'Dr! Venn | character',
            ],
            FACTS: [
                'Mirelle | background | poisoned the old king | hidden | #5',
                'Halvard | background | deserted at the siege | hidden | #6',
                'Thessaly | relation to Isolde | is secretly in love with her | hidden | #7',
            ],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Mirelle, Isolde, Thessaly | They feast'],
        },
        stretch(1, 10),
    );
    const king = factSaying(first, 'poisoned the old king').id;
    const siege = factSaying(first, 'deserted at the siege').id;
    const love = factSaying(first, 'is secretly in love with her').id;
    const room = ['Halvard', 'Mirelle', 'Isolde'];
    const alone = 'Mirelle (private): background: poisoned the old king; no one else here knows.';
    const led = composed(first, room, { first: [king] });
    assert.deepEqual(sentences(led.text), [alone]);
    assert.deepEqual(plain(led.led), [king]);
    assert.deepEqual(sentences(said(first, room)), [alone]);
    const own = composed(first, room, { first: [siege] });
    assert.deepEqual(sentences(own.text), [alone]);
    assert.deepEqual(plain(own.led), []);
    const toIsolde = apply(log, { TOLD: [`${king} | Mirelle | Isolde | #12`] }, pick(12));
    assert.deepEqual(sentences(said(toIsolde, room, { first: [king] })), [
        'Mirelle (private): background: poisoned the old king; only Isolde knows.',
    ]);
    const toAll = apply(log, { TOLD: [`${king} | Mirelle | Halvard | #14`] }, pick(14));
    assert.equal(said(toAll, room), null);
    const everyone = composed(toAll, room, { first: [king] });
    assert.deepEqual(sentences(everyone.text), [
        'Mirelle (private): background: poisoned the old king; only Halvard and Isolde know.',
    ]);
    assert.deepEqual(plain(everyone.led), [king]);
    const toVenn = apply(log, { TOLD: [`${king} | Mirelle | Dr! Venn | #16`] }, pick(16));
    const unnamed = composed(toVenn, ['Halvard', 'Mirelle', 'Isolde', 'Dr! Venn'], { first: [king] });
    assert.equal(unnamed, null);
    const lover = composed(first, ['Halvard', 'Thessaly', 'Isolde'], { first: [love] });
    assert.deepEqual(sentences(lover.text), [
        'Thessaly toward Isolde: is secretly in love with her; no one else here knows.',
    ]);
    assert.deepEqual(plain(lover.led), [love]);
});

test('facts the operator filed lead while their character is here', () => {
    const state = filed([
        ['trait', 'hums old songs'],
        ['eyes', 'grey'],
        ['condition', 'drunk'],
    ]);
    const room = ['Halvard', 'Mirelle'];
    assert.equal(said(state, room), '[Scribe] Mirelle: trait: hums old songs. Mirelle: condition: drunk. Mirelle: eyes: grey.');
    assert.equal(said(state, ['Halvard']), null);
    const unread = unreadSaying('The rain falls.');
    assert.equal(said(state, room, { unread }), '[Scribe] Mirelle: trait: hums old songs. Mirelle: eyes: grey.');
    const asMirelle = said(state, ['Halvard', 'Mirelle'], { player: 'Mirelle' });
    assert.equal(asMirelle, null);
});

test('only what stands is said', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character'],
            FACTS: [
                'Mirelle | age | forty | #2',
                'Mirelle | eyes | grey | #3',
                'Mirelle | age | fifty | #4',
                'Mirelle | hair | red | #5',
                'Mirelle | build | sly | #6',
            ],
            SCENES: ['Day 1 | #1-#9 | The square | public | present: Halvard, Mirelle | They meet'],
        },
        stretch(1, 9),
    );
    rule(log, { type: 'RemoveFact', fact: factSaying(first, 'sly').id });
    const state = rule(log, {
        type: 'Pin',
        subject: idOf(first, 'Mirelle'),
        category: 'age',
        target: null,
        text: 'forty',
        hidden: false,
    });
    assert.equal(factSaying(state, 'fifty').status, 'Disputed');
    assert.equal(said(state, ['Halvard', 'Mirelle']), '[Scribe] Mirelle: age: forty, eyes: grey, hair: red.');
});

test('a contested value is never said, in any wording', () => {
    const log = ScribeLog.create();
    const first = apply(
        log,
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Isolde | character'],
            FACTS: ['Mirelle | age | thirty | #3', 'Mirelle | trait | snores | #4', 'Mirelle | eyes | brown | #5'],
            SCENES: ['Day 1 | #1-#10 | The cellar | private | present: Halvard, Mirelle | They hide'],
        },
        stretch(1, 10),
    );
    const thirty = factSaying(first, 'thirty').id;
    const state = apply(
        log,
        {
            CHANGES: [`${thirty} | Mirelle | age | FULLER: thirty winters | #12`],
            FACTS: ['Mirelle | age | forty-one | #20'],
            SCENES: ['Day 1 | #11-#20 | The study | private | present: Mirelle, Isolde | They read'],
        },
        stretch(11, 20),
    );
    const wordings = ['thirty', 'thirty winters', 'forty-one'].map((text) => factSaying(state, text).id);
    const contested = { ...state, conflicts: [{ subject: factSaying(state, 'thirty').subject, category: 'age', target: null,
        established: wordings[0], others: wordings.slice(1) }] };
    for (const room of [['Halvard', 'Mirelle', 'Isolde'], ['Halvard', 'Mirelle'], ['Mirelle', 'Isolde']]) {
        const result = composed(contested, room, { first: wordings });
        assert.equal(/thirty|forty/.test(result.text), false, result.text);
        assert.deepEqual(plain(result.led), []);
        assert.equal(result.text.includes('eyes: brown'), true, result.text);
    }
});

test('a relation needs its target here or the main character', () => {
    const log = ScribeLog.create();
    const room = apply(
        log,
        {
            SUBJECTS: [
                'Halvard | character',
                'Mirelle | character',
                'Brandt | character',
                'Kira (the smith) | character',
                'Kira (the baker) | character',
            ],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Mirelle | They feast'],
        },
        stretch(1, 10),
    );
    let ruled = room;
    for (const [index, [target, text]] of [
        ['Halvard', 'old friends'],
        ['Brandt', 'rivals'],
        ['Kira (the smith)', 'owes her money'],
    ].entries()) {
        ruled = rule(log, {
            type: 'AddFact',
            subject: idOf(room, 'Mirelle'),
            category: 'relation',
            target: idOf(room, target),
            text,
            hidden: false,
            cite: `MESSAGE-${index + 12}`,
            position: index + 12,
        });
    }
    assert.equal(said(ruled, ['Halvard', 'Mirelle']), '[Scribe] Mirelle toward Halvard: old friends.');
    assert.equal(said(ruled, ['Mirelle'], { player: 'Halvard' }), '[Scribe] Mirelle toward Halvard: old friends.');
    assert.equal(
        said(ruled, ['Halvard', 'Mirelle', 'Brandt']),
        '[Scribe] Mirelle toward Halvard: old friends. Mirelle toward Brandt: rivals.',
    );
    assert.equal(
        said(ruled, ['Halvard', 'Mirelle', 'Kira (the smith)', 'Kira (the baker)']),
        '[Scribe] Mirelle toward Halvard: old friends.',
    );
    assert.equal(said(ruled, ['Mirelle'], { player: 'Corvane' }), null);
});

test('a merged subject is the one it became', () => {
    const log = ScribeLog.create();
    const before = apply(
        log,
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Mira | character', 'Isolde | character'],
            FACTS: ['Mirelle | background | poisoned the old king | hidden | #5', 'Mira | eyes | brown | #6'],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Mirelle, Mira, Isolde | They feast'],
        },
        stretch(1, 10),
    );
    const now = scene(before, ['Halvard', 'Mira', 'Mirelle', 'Isolde']);
    const merged = rule(log, { type: 'Merge', from: idOf(before, 'Mira'), into: idOf(before, 'Mirelle') });
    const request = { now, player: 'Halvard', unread: [], notes: [wears('Mira', 'a red dress')], characters: null };
    const secret = 'Mirelle (private): background: poisoned the old king; no one else here knows.';
    assert.equal(
        ScribeReminder.compose({ state: merged, ...request }).text,
        `[Scribe] Mirelle wears a red dress; eyes: brown. ${secret}`,
    );
    const apart = ScribeReminder.compose({ state: before, ...request }).text;
    assert.equal(apart, `[Scribe] Mira wears a red dress; eyes: brown. ${secret}`);
    assert.deepEqual(labelsOf(merged, ['Halvard', 'Mira', 'Mirelle', 'Isolde']), ['Halvard', 'Mirelle', 'Isolde']);
});

test('the main character is one subject or none', () => {
    const ferry = book(
        {
            SUBJECTS: ['Hal (the ferryman) | character', 'Halvard | character', 'Mirelle | character'],
            NAMES: ['Hal | Halvard | #3'],
            FACTS: ['Mirelle | trait | hums | hidden | #6'],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Hal (the ferryman), Mirelle | They feast'],
        },
        10,
    );
    const room = ['Halvard', 'Hal (the ferryman)', 'Mirelle'];
    assert.equal(ScribeReminder.namesakes(ferry, 'Hal').length, 2);
    assert.equal(ScribeReminder.namesakes(ferry, 'Halvard').length, 1);
    assert.deepEqual(labelsOf(ferry, room, 'Hal'), ['Halvard', null, 'Mirelle']);
    const asHal = said(ferry, room, { player: 'Hal', notes: [wears('Hal', 'a grey cloak')] });
    assert.equal(asHal.includes('grey cloak'), false, asHal);
    const asHalvard = said(ferry, room, { player: 'Halvard', notes: [wears('Halvard', 'a grey cloak')] });
    assert.equal(asHalvard.startsWith('[Scribe] Halvard wears a grey cloak.'), true, asHalvard);
    assert.equal(said(ferry, ['Mirelle'], { player: 'Hal', notes: [wears('Hal', 'a grey cloak')] }), null);
    const bold = book(
        {
            SUBJECTS: ['Halvard the Bold! | character', 'Mirelle | character'],
            FACTS: ['Mirelle | eyes | brown | #7'],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard the Bold!, Mirelle | They feast'],
        },
        10,
    );
    const unnamed = said(bold, ['Halvard the Bold!', 'Mirelle'], {
        player: 'Halvard the Bold!',
        notes: [wears('Halvard the Bold!', 'a grey cloak')],
    });
    assert.equal(unnamed, '[Scribe] Mirelle: eyes: brown.');
});

test('a name is made of allowed characters, and a label that speaks of someone else names only its looks', () => {
    const point = (code) => String.fromCodePoint(code);
    const printed = (label) => ScribeReminder.printed(label);
    assert.equal(printed('Hal (the ferryman)'), 'Hal');
    assert.equal(printed('Hal [the ferryman]'), 'Hal');
    assert.equal(printed('Dr. Venn'), 'Dr Venn');
    assert.equal(printed(`Oswin (Tamsin${curly}s uncle)`), 'Oswin');
    assert.equal(printed(`Iso${point(0x3164)}lde`), 'Isolde');
    assert.equal(printed(`O${curly}Brien-Hale`), `O${curly}Brien-Hale`);
    assert.equal(printed('x'.repeat(60)), 'x'.repeat(60));
    const refused = ['Mirelle, Isolde', 'Venn: the elder', 'a b c d e', 'x'.repeat(61), 'Brandt and Sons'];
    for (const label of [...refused, 'Halvard the Bold!', '']) {
        assert.equal(printed(label), null, label);
    }
    const cast = [
        'Halvard',
        'Isolde',
        'the men who saw Halvard desert',
        'guards of Halvard',
        'Isolde knows it too',
        "Halvard's sworn guard",
        'Isolde Venn',
        'Tamsin the Elder',
        'Brandt (the ferryman)',
    ];
    const state = book(
        {
            SUBJECTS: cast.map((label) => `${label} | character`),
            FACTS: [
                'the men who saw Halvard desert | eyes | grey | #12',
                'Isolde knows it too | eyes | green | #13',
                'Isolde Venn | eyes | blue | #14',
                'Isolde knows it too | trait | hums | hidden | #15',
            ],
            SCENES: ['Day 1 | #1-#20 | The hall | public | present: Halvard, Isolde | They feast'],
        },
        20,
    );
    assert.deepEqual(labelsOf(state, cast), [
        'Halvard',
        'Isolde',
        null,
        null,
        null,
        null,
        'Isolde Venn',
        'Tamsin the Elder',
        'Brandt',
    ]);
    const text = said(state, cast, {
        notes: [wears('the men who saw Halvard desert', 'a cloak'), wears('Isolde knows it too', 'a hood')],
    });
    assert.equal(text, '[Scribe] Isolde knows it too wears a hood; eyes: green. Isolde Venn: eyes: blue.');
    assert.equal(said(state, ['Halvard', 'Isolde knows it too', 'Isolde Venn']).includes('hums'), false);
    const doctor = book(
        {
            SUBJECTS: ['Halvard | character', 'Dr. Venn | character', 'Mirelle, Isolde | group'],
            FACTS: ['Dr. Venn | eyes | grey | #2', 'Mirelle, Isolde | trait | loud | hidden | #3'],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard | They feast'],
        },
        10,
    );
    assert.equal(said(doctor, ['Halvard', 'Dr. Venn', 'Mirelle, Isolde']), '[Scribe] Dr Venn: eyes: grey.');
});

test('with no scene only the main character can be named, and nothing to say gives nothing', () => {
    const state = book(
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character'],
            FACTS: ['Mirelle | eyes | grey | #2', 'Halvard | eyes | blue | #3'],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard, Mirelle | They feast'],
        },
        10,
    );
    const notes = [wears('Halvard', 'a grey cloak'), wears('Mirelle', 'a red dress')];
    assert.equal(said(state, null, { notes }), '[Scribe] Halvard wears a grey cloak.');
    assert.equal(said(state, null), null);
    assert.equal(said(state, ['Halvard']), null);
    assert.equal(said(state, [], { notes }), '[Scribe] Halvard wears a grey cloak.');
    const result = composed(state, ['Halvard', 'Mirelle'], { notes });
    assert.equal(result.text, '[Scribe] Halvard wears a grey cloak. Mirelle wears a red dress; eyes: grey.');
    assertFrozenDeep(result, 'result');
    assert.deepEqual(plain(Object.keys(result)), ['text', 'led']);
    assert.deepEqual(plain(Object.keys(ScribeReminder.Part)), [
        'Correction',
        'Wearing',
        'Secret',
        'Filed',
        'Looks',
        'Job',
        'Place',
    ]);
    for (const gone of ['candidates', 'chooseInput', 'chosen', 'ChoosePrompt', 'fit', 'write', 'quoted', 'Kind']) {
        assert.equal(ScribeReminder[gone], undefined, gone);
    }
});

test('clauses read as sentences', () => {
    const state = filed([
        ['age', 'forty winters old'],
        ['eyes', 'one blue eye and one green'],
        ['hair', 'short and grey'],
        ['skin', 'pale'],
        ['build', 'tall and gaunt'],
        ['aka', 'Mira'],
        ['belonging', 'a silver ring'],
        ['background', 'grew up by the sea'],
        ['location', 'the harbour'],
    ]);
    assert.deepEqual(sentences(said(state, ['Halvard', 'Mirelle'])), [
        'Mirelle: aka: Mira.',
        'Mirelle: belonging: a silver ring.',
        'Mirelle: background: grew up by the sea.',
        'Mirelle: location: the harbour.',
        'Mirelle: age: forty winters old.',
        'Mirelle: eyes: one blue eye and one green.',
        'Mirelle: hair: short and grey.',
        'Mirelle: skin: pale.',
        'Mirelle: build: tall and gaunt.',
    ]);
});

test('each clause that read badly is a plain sentence', () => {
    const state = book(
        {
            SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Thessaly | character', 'Isolde | character'],
            FACTS: [
                'Mirelle | hair | bald | #5',
                'Mirelle | appearance | a scar across her cheek | #6',
                'Mirelle | location | in the cellar | #7',
                'Mirelle | trait | brave | #8',
                'Mirelle | condition | pajamas | #9',
                'Mirelle | ability | skilled with a bow | #10',
                'Mirelle | background | a former soldier | #11',
                'Thessaly | relation to Isolde | is secretly in love with her | hidden | #12',
            ],
            SCENES: ['Day 1 | #1-#20 | The hall | public | present: Halvard, Mirelle, Thessaly, Isolde | They wake'],
        },
        20,
    );
    const lead = (text) => sentences(said(state, ['Halvard', 'Mirelle'], { first: [factSaying(state, text).id] }))[0];
    assert.equal(lead('bald'), 'Mirelle: hair: bald.');
    assert.equal(lead('a scar across her cheek'), 'Mirelle: appearance: a scar across her cheek.');
    assert.equal(lead('in the cellar'), 'Mirelle: location: in the cellar.');
    assert.equal(lead('brave'), 'Mirelle: trait: brave.');
    assert.equal(lead('pajamas'), 'Mirelle: condition: pajamas.');
    assert.equal(lead('skilled with a bow'), 'Mirelle: ability: skilled with a bow.');
    assert.equal(lead('a former soldier'), 'Mirelle: background: a former soldier.');
    assert.deepEqual(sentences(said(state, ['Halvard', 'Thessaly', 'Isolde'])), [
        'Thessaly toward Isolde: is secretly in love with her; no one else here knows.',
    ]);
    for (const [category, value] of [['trait', 'no longer fears the sea'], ['location', 'no longer at the mill']]) {
        const changed = book({
            SUBJECTS: ['Mirelle | character'],
            FACTS: ['Mirelle | ' + category + ' | ' + value + ' | #5'],
            SCENES: ['Day 1 | #1-#20 | The hall | public | present: Mirelle | She arrives'],
        }, 20);
        const fact = factSaying(changed, value);
        assert.ok(sentences(said(changed, ['Mirelle'], { first: [fact.id] })).includes('Mirelle: ' + category + ': ' + value + '.'));
    }
});

test('the main character is found by a name that begins his, or that his begins, when only one does', () => {
    const state = book(
        {
            SUBJECTS: ['Frost | character', 'Thessaly | character', 'Isolde | character'],
            FACTS: [
                'Frost | background | knows a Malachai connected to the Staff of Elders | hidden | #3',
                'Frost | eyes | blue-gray | #4',
                'Thessaly | eyes | teal | #6',
            ],
            SCENES: ['Day 1 | #1-#20 | The hall | public | present: Frost, Thessaly, Isolde | They wake'],
        },
        20,
    );
    assert.deepEqual(plain(ScribeReminder.namesakes(state, 'Frost Valen')), [idOf(state, 'Frost')]);
    const valen = said(state, ['Frost', 'Thessaly', 'Isolde'], {
        player: 'Frost Valen',
        notes: [wears('Frost Valen', 'a travel cloak', 40)],
    });
    assert.equal(valen, '[Scribe] Frost wears a travel cloak. Thessaly: eyes: teal.');
    const longer = book(
        {
            SUBJECTS: ['Frost Valen | character', 'Frost Keep | place', 'Frostmere | character'],
            SCENES: ['Day 1 | #1-#20 | The hall | public | present: Frost Valen | They wake'],
        },
        20,
    );
    assert.deepEqual(plain(ScribeReminder.namesakes(longer, 'Frost')), [idOf(longer, 'Frost Valen')]);
    assert.deepEqual(plain(ScribeReminder.namesakes(longer, 'Frost Valen the Bold')), [idOf(longer, 'Frost Valen')]);
    assert.deepEqual(plain(ScribeReminder.namesakes(longer, 'Fro')), []);
    const both = book(
        {
            SUBJECTS: ['Frost | character', 'Frost Valen | character'],
            SCENES: ['Day 1 | #1-#20 | The hall | public | present: Frost | They wake'],
        },
        20,
    );
    assert.deepEqual(plain(ScribeReminder.namesakes(both, 'Frost')), [idOf(both, 'Frost')]);
});

test('the story so far reads every scene in order, the open threads and the current scene', () => {
    const log = ScribeLog.create();
    apply(
        log,
        {
            SUBJECTS: ['Halvard | character'],
            SCENES: [
                'Day 1 | #1-#5 | The door | private | present: Halvard | Three elves ask Halvard for a mage',
                'Day 1 | #6-#10 | The road | public | present: Halvard | They ride north',
            ],
            THREADS: ['OPEN | find the lost mage | #3', 'OPEN | repay the ferryman | #8'],
        },
        stretch(1, 10),
    );
    const state = apply(
        log,
        {
            SCENES: ['Day 2 | #11-#20 | The ford | public | present: Halvard | They cross the river'],
            THREADS: ['CLOSE T2 | paid in silver | #15'],
        },
        stretch(11, 20),
    );
    assert.equal(
        ScribeReminder.storyInput(state, scene(state, ['Halvard'])),
        [
            'TIMELINE:',
            'Day 1 | The door | Three elves ask Halvard for a mage',
            'Day 1 | The road | They ride north',
            'Day 2 | The ford | They cross the river',
            '',
            'OPEN THREADS:',
            '- find the lost mage',
            '',
            'NOW:',
            'They talk by the wheel',
        ].join('\n'),
    );
    assert.equal(ScribeReminder.storyInput(state, null).endsWith('NOW:\n(none)'), true);
    assert.equal(
        ScribeReminder.storyInput(book({ SUBJECTS: ['Halvard | character'] }, 2), null),
        'TIMELINE:\n(none)\n\nOPEN THREADS:\n(none)\n\nNOW:\n(none)',
    );
    assert.equal(ScribeReminder.StoryPrompt.includes('No name, place, object or event that they do not hold.'), true);
    assert.equal(ScribeReminder.StoryPrompt.includes('Past tense for what happened'), true);
});

test('a long timeline keeps the first five scenes and the newest that fit in 12,000 characters', () => {
    const scenes = [];
    for (let number = 1; number <= 20; number++) {
        scenes.push(
            `Day 1 | #${number}-#${number} | Place ${number} | private | present: Halvard | Scene ${number} ${'far '.repeat(250).trim()}`,
        );
    }
    const state = book({ SUBJECTS: ['Halvard | character'], SCENES: scenes }, 20);
    const timeline = ScribeReminder.storyInput(state, null).split('\n\n')[0].split('\n').slice(1);
    const places = timeline.map((line) => line.split(' | ')[1]);
    assert.deepEqual(
        places,
        [1, 2, 3, 4, 5, 15, 16, 17, 18, 19, 20].map((number) => `Place ${number}`),
    );
    assert.equal(Array.from(timeline.join('\n')).length <= 12000, true);
    const added = `Day 1 | Place 14 | Scene 14 ${'far '.repeat(250).trim()}`;
    assert.equal(Array.from([...timeline, added].join('\n')).length > 12000, true);
    const fewer = book({ SUBJECTS: ['Halvard | character'], SCENES: scenes.slice(0, 11) }, 20);
    const all = ScribeReminder.storyInput(fewer, null).split('\n\n')[0].split('\n').slice(1);
    assert.equal(all.length, 11);
});

test('a story so far alone over 3,000 characters is cut at a sentence end, and the specifics go first', () => {
    const state = book(
        {
            SUBJECTS: ['Halvard | character'],
            THREADS: ['OPEN | find the lost mage | #3'],
            SCENES: ['Day 1 | #1-#10 | The hall | public | present: Halvard | He waits'],
        },
        10,
    );
    const told = 'Halvard rode on through the rain. '.repeat(120).trim();
    const result = said(state, ['Halvard'], { story: told });
    assertFramed(result);
    assert.equal(result.startsWith('[Scribe] The story so far: Halvard rode on'), true);
    assert.equal(result.endsWith('through the rain.'), true);
    assert.equal(result.includes('The party: '), false);
    assert.equal(told.startsWith(result.slice('[Scribe] The story so far: '.length)), true);
    const wordy = said(state, ['Halvard'], { story: 'word '.repeat(700).trim() });
    assert.equal(wordy.endsWith(' word'), true);
    assertFramed(wordy);
    assert.equal(ScribeReminder.cut('Halvard paid 3.5 crowns. Then more', 22), 'Halvard paid 3.5');
    assert.equal(ScribeReminder.cut('Halvard paid. Then more', 22), 'Halvard paid.');
    assert.equal(ScribeReminder.cut('Halvard', 3), 'Hal');
    assert.equal(ScribeReminder.cut('short', 3000), 'short');
    const brief = said(state, ['Halvard'], { story: 'Halvard came to the hall.' });
    assert.equal(brief, '[Scribe] The story so far: Halvard came to the hall. The party: find the lost mage.');
});

test('recaps accept prose and JSON envelopes without judging the wording', () => {
    const narrative = 'I can offer a summary of the siege, the captain said.';
    const json = JSON.stringify({ status: 'recap', text: narrative });
    for (const answer of [narrative, json, '```json\n' + json + '\n```', '~~~~ JSON\r\n' + json + '\r\n~~~~~',
        JSON.stringify({ text: narrative }), JSON.stringify({ status: 'declined', text: narrative })]) {
        assert.equal(ScribeReminder.recap(answer).text, narrative);
    }
    for (const prose of ['"Wait."', '{Later that day} the travelers returned.', '@[]', '{}', '{"status":"recap",',
        '{"status":"recap","text":[]}', '```json\n{incomplete\n```', '```json\n{"text":"almost"}']) {
        assert.equal(ScribeReminder.recap(prose).text, prose);
    }
    assert.equal(ScribeReminder.recap('{"status":"declined"}').status, 'declined');
    assert.equal(ScribeReminder.recap('```json\n{"status":"declined"}\n```').status, 'declined');
    for (const answer of ['```json\n\n```', '{"status":"recap","text":" "}', '{"status":"declined","summary":"Actual narrative"}']) {
        assert.equal(ScribeReminder.recap(answer).text, answer);
    }
    for (const empty of ['', ' \n ']) {
        assert.equal(ScribeReminder.recap(empty), null, empty);
    }
});

test('text and JSON recaps preserve their paragraph breaks, whitespace and punctuation', () => {
    const text = '  "The story so far:"\n@Mira said, [wait].  ';
    assert.equal(ScribeReminder.recap(text).text, text);
    assert.equal(ScribeReminder.recap(JSON.stringify({ status: 'recap', text })).text, text);
});

test('the reminder is trimmed to the room a message leaves, the specifics first, then the story at a sentence end', () => {
    const text = '[Scribe] The story so far: Halvard came. He waited. Mirelle: brown eyes. The party: find the mage.';
    const ends = [...ScribeReminder.ends(text)];
    assert.deepEqual(
        ends.map((end) => text.slice(0, end)),
        [
            '[Scribe] The story so far: Halvard came.',
            '[Scribe] The story so far: Halvard came. He waited.',
            '[Scribe] The story so far: Halvard came. He waited. Mirelle: brown eyes.',
        ],
    );
    /**
     * @param {number} room
     * @return {string|null}
     */
    const sent = (room) => {
        const limit = Buffer.byteLength('Go.\n@: ') + room;
        return ScribeSender.compose('Go.', { ready: text, suggestion: null, ends }, limit).carried;
    };
    assert.equal(sent(1000), text);
    assert.equal(sent(Buffer.byteLength(text) - 1), text.slice(0, ends[2]));
    assert.equal(sent(52), text.slice(0, ends[1]));
    assert.equal(sent(40), text.slice(0, ends[0]));
    assert.equal(sent(39), null);
    const wide = `[Scribe] The story so far: ${'é'.repeat(10)}. More.`;
    assert.deepEqual([...ScribeReminder.ends(wide)], [wide.length - ' More.'.length]);
});
