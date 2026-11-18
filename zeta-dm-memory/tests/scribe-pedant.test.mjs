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
    'You receive PLAYER CHARACTER, a LEDGER of established facts (each with an id like F12, its subject, its category and its text), a list of what certain speakers DO NOT KNOW, the messages SINCE THE BOOK WAS LAST READ, one REPLY from the storyteller, and NAME CANDIDATES: words in the REPLY that look like known names, each line giving the name, the word of that name it looks like, and the word in the REPLY.',
    'Find where the REPLY disagrees with the LEDGER, where a speaker uses something they do not know, and which NAME CANDIDATES are misspellings.',
    '',
    'Answer with these three blocks, each starting with its === line. Leave a block out if it has nothing. Write nothing else.',
    '',
    '=== CONTRADICTIONS',
    'F12 | Label | category | the words of the reply that say otherwise',
    '=== LEAKS',
    'F7 | Label of the speaker | the words of theirs that show they know it',
    '=== MISSPELLINGS',
    'N21',
    'N22',
    '',
    'Rules.',
    "1. A contradiction is a statement in the REPLY, about the LEDGER fact's own subject, that cannot be true together with that fact: another age, number, colour, name, place or description of the same thing. Give the fact's id, its subject's label and its category exactly as the LEDGER shows them, and copy the reply's own words for the other value. Never report a fact marked (hidden) as contradicted.",
    '2. More detail about the same thing is not a contradiction. Less detail is not a contradiction. The same thing in other words is not a contradiction. Something the story has plainly changed (a move, a promotion, a wound), in the REPLY or in the messages since the book was last read, is not a contradiction.',
    "3. A leak is a line spoken by a speaker that states or uses a fact listed for that speaker under DOES NOT KNOW. Copy the few words of that speaker's own line that show it, exactly as the REPLY has them. What the narrator says, or what another character says or thinks, is not that speaker's leak.",
    '4. It is not a leak if the speaker was told or shown the fact earlier in the REPLY, or anywhere in the messages since the book was last read.',
    '5. Report only what the REPLY itself shows. Never guess. When in doubt, leave it out.',
    '6. A misspelling is a word in the REPLY that is meant as the listed known name but is written another way. An ordinary word, a word at the start of a sentence that is not meant as the name, and a different or new name are not misspellings. Report only numbers from NAME CANDIDATES. In the MISSPELLINGS block write only the numbers of the misspellings, one per line, nothing else on the line.',
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
    });
    const dressed = ['**=== contradictions ===**', 'F7 | Mirelle | build | tall', '#LEAKS:', 'F8 | Orla | it'].join(
        '\r\n',
    );
    assert.deepEqual(plain(ScribePedant.parse(dressed)), {
        contradictions: [{ fact: 'F7', label: 'Mirelle', category: 'build', said: 'tall' }],
        leaks: [{ fact: 'F8', speaker: 'Orla', words: 'it' }],
        misspellings: [],
    });
    for (const unreadable of ['', 'All of it agrees with the book.', null, 42]) {
        assert.deepEqual(plain(ScribePedant.parse(unreadable)), { contradictions: [], leaks: [], misspellings: [] });
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
    const found = await ScribePedant.review({ state, player: 'Orla', message: reply, unread, ask: good.ask });
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
        assert.deepEqual(plain(kept), [], `${index}`);
    }

    const played = scriptedAsk({ text });
    const own = at(47);
    assert.equal(own.fromPlayer, true);
    const none = await ScribePedant.review({ state, player: 'Orla', message: own, unread: [own], ask: played.ask });
    assert.equal(none.length, 0);
    assert.equal(played.calls.length, 0);

    const empty = subjectsOnly(['Halvard', 'Mirelle', 'Orla']).state;
    const idle = scriptedAsk({ text: answer({ MISSPELLINGS: ['N1'] }) });
    const alone = await ScribePedant.review({ state: empty, player: 'Orla', message: reply, unread, ask: idle.ask });
    assert.deepEqual(plain(alone.map((finding) => finding.kind)), ['Spelling']);
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
    assert.equal(nothing.length, 0);
    assert.equal(silent.calls.length, 0);
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
function reviewed(state, message, text) {
    return ScribePedant.review({
        state,
        player: 'Orla',
        message,
        unread: [message],
        ask: scriptedAsk({ text }).ask,
    });
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
    const found = await ScribePedant.review({
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
    const found = await ScribePedant.review({
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
    const found = await ScribePedant.review({
        state,
        player: 'Orla',
        message: reply,
        unread: [reply],
        ask: scriptedAsk({ text }).ask,
    });
    assert.deepEqual(plain(found.map((finding) => finding.kind)), ['Contradiction', 'Leak', 'Spelling']);
    assertFrozenDeep(found, 'review');
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
