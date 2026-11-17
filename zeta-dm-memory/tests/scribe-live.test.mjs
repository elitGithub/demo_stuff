import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import CampaignBuilder from './support/CampaignBuilder.mjs';
import FakeStorage from './support/FakeStorage.mjs';
import StandInKeeper from './support/StandInKeeper.mjs';

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

const {
    ScribeIntake,
    ScribeAnswer,
    ScribeLog,
    ScribeReplay,
    ScribeAnalyzer,
    ScribeStore,
    ScribeScene,
    ScribePedant,
    ScribeReminder,
    ScribeMuse,
    ScribeSender,
    ScribeLive,
} = load(
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
    ['ScribeStore', 'ScribeScene', 'ScribeReminder', 'ScribePedant', 'ScribeMuse', 'ScribeSender', 'ScribeLive'],
);

const ROOM = 'harbour';
const MOST_TICKS = 20;
const LIMIT = 4500;
const MILL = 'Day 1 | The mill | private | present: Halvard, Mirelle, Orla | They talk\nCHANGED: no';
const TENT = 'Day 1 | The tent | private | present: Halvard, Mirelle, Orla | They rest\nCHANGED: yes';
const TENT_AGAIN = 'Day 1 | The tent | private | present: Halvard, Mirelle, Orla | Night falls\nCHANGED: yes';
const ROAD = 'Day 2 | The road | public | present: Halvard, Mirelle, Orla | They ride\nCHANGED: yes';
const YARD = 'Day 1 | The yard | public | present: Halvard, Mirelle, Orla | They part\nCHANGED: yes';
const COURIER = 'A courier from the guild knocks at the door.';
const COLLECTOR = 'Brandt comes to collect his debt.';
const RIDER = 'A rider arrives.';
const GULL = 'A gull cries over the mill.';
const CLOCK = Object.freeze({ now: () => 0 });

const scripted = {
    41: [['Narrator', 'Halvard, forty winters old, hums by the fire.']],
    43: [
        ['Narrator', 'Halvart, his eyes green tonight, whistles.'],
        ['Mirelle', 'Your scars ache in the rain, I know.'],
    ],
    47: [['Narrator', 'Halvard, forty winters old, walks out past Halvart.']],
    49: [['Narrator', 'Halvart nods once.']],
};

/**
 * @param {Object<number, Array<[string, string]>>} changes
 * @return {object[]}
 */
function rawStory(changes = {}) {
    const builder = new CampaignBuilder('Orla');
    for (let number = 1; number <= 60; number++) {
        const blocks = changes[number] ?? scripted[number];
        if (number > 40 && number % 2 === 0) {
            builder.player(`I wait, turn ${number}.`);
        } else if (blocks !== undefined) {
            builder.reply(blocks);
        } else {
            builder.narrator(`The tale goes on, line ${number}.`);
        }
    }
    return builder.messages;
}

const story = ScribeIntake.read(rawStory()).messages;
const storyOrder = story.map((message) => message.id);

/**
 * @param {number} position
 * @param {Array<[string, string]>} blocks
 * @param {string|null} id
 * @return {object}
 */
function variant(position, blocks, id) {
    const raw = rawStory({ [position]: blocks });
    if (id !== null) {
        raw[position - 1].id = id;
    }
    return ScribeIntake.read(raw).messages[position - 1];
}

/**
 * @param {number} position
 * @return {object}
 */
function at(position) {
    return story[position - 1];
}

/**
 * @param {*} value
 * @return {*}
 */
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

/**
 * @param {string} text
 * @return {number}
 */
function bytes(text) {
    return Buffer.byteLength(text, 'utf8');
}

/**
 * @param {*} text
 * @param {string} place
 * @return {boolean}
 */
function reminds(text, place) {
    return typeof text === 'string' && text.startsWith('[Scribe] ') && text.includes(place);
}

/**
 * @param {string} text
 * @return {string}
 */
function lineOf(text) {
    return `\n@: ${text}`;
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

const FACTS = Object.freeze([
    'Halvard | age | 34 | #5',
    'Halvard | eyes | grey | #6',
    'Halvard | build | scarred and lean | hidden | #7',
    'Mirelle | eyes | brown | #8',
]);

/**
 * @param {readonly string[]} facts
 * @param {object[]} rulings
 * @param {string} halvard
 * @return {object}
 */
function bookState(facts, rulings = [], halvard = 'Halvard') {
    return bookLog(facts, rulings, halvard).state;
}

/**
 * @param {readonly string[]} facts
 * @param {object[]} rulings
 * @param {string} halvard
 * @return {{ log: object, state: object }}
 */
function bookLog(facts, rulings = [], halvard = 'Halvard') {
    const log = ScribeLog.create();
    const parsed = ScribeAnswer.parse(
        answer({
            SUBJECTS: [`${halvard} | character`, 'Mirelle | character', 'Orla | character'],
            FACTS: [...facts],
            SCENES: ['Day 1 | #1-#40 | The mill | public | present: Halvard, Mirelle, Orla | They talk'],
            THREADS: ['OPEN | the debt to Brandt | #9', 'OPEN | Mirelle owes a favour to the guild | #10'],
        }),
    );
    assert.deepEqual(plain(parsed.refused), []);
    const result = ScribeLog.append(log, ScribeReplay.run(log, storyOrder), parsed.operations, {
        messages: story.slice(0, 40),
        origin: 'Story',
    });
    assert.deepEqual(plain(result.refused), []);
    for (const ruling of rulings) {
        ScribeLog.rule(log, ScribeReplay.run(log, storyOrder), ruling);
    }
    return { log, state: ScribeReplay.run(log, storyOrder) };
}

/**
 * @param {readonly string[]} facts
 * @return {function(readonly object[]): { before: object, state: object, refused: object[] }}
 */
function previewFrom(facts) {
    return (operations) => {
        const { log, state: before } = bookLog(facts);
        const result = ScribeLog.append(log, before, operations, {
            messages: story.slice(0, 40),
            origin: ScribeLog.Origin.Notes,
        });
        return { before, state: ScribeReplay.run(log, storyOrder), refused: [...result.refused] };
    };
}

/**
 * @param {StandInKeeper} keeper
 * @param {object} fields
 * @param {string} broken
 * @return {object}
 */
function breakView(keeper, fields, broken) {
    const healthy = keeper.current;
    const current = { ...healthy, ...fields };
    Object.defineProperty(current, broken, {
        enumerable: true,
        get() {
            throw new Error(`The ${broken} could not be read`);
        },
    });
    keeper.pinned = true;
    keeper.current = current;
    return healthy;
}

const state = bookState(FACTS);

/**
 * @param {object} book
 * @param {string} text
 * @return {string}
 */
function factIn(book, text) {
    const found = book.facts.filter((fact) => fact.text === text);
    assert.equal(found.length, 1, `facts saying ${text}`);
    return found[0].id;
}

const AGE = factIn(state, '34');
const EYES = factIn(state, 'grey');
const BUILD = factIn(state, 'scarred and lean');
const MIRELLE = state.subjects.find((subject) => subject.label === 'Mirelle').id;
const PEDANT = answer({
    CONTRADICTIONS: [
        `${AGE} | Halvard | age | forty`,
        `${AGE} | Halvard | age | thirty`,
        `${EYES} | Halvard | eyes | green`,
    ],
    LEAKS: [`${BUILD} | Mirelle | Your scars ache`],
});

const MANY = Object.freeze([
    'Halvard | age | 34 | #5',
    'Halvard | eyes | grey | #6',
    'Halvard | hair | black | #7',
    'Mirelle | age | 30 | #8',
    'Mirelle | eyes | brown | #11',
    'Mirelle | hair | red | #12',
    'Mirelle | build | slight | #13',
    'Orla | build | scarred | hidden | #14',
]);
const many = bookState(MANY);
const MANY_IDS = Object.freeze({
    halvardAge: factIn(many, '34'),
    halvardEyes: factIn(many, 'grey'),
    halvardHair: factIn(many, 'black'),
    mirelleAge: factIn(many, '30'),
    mirelleEyes: factIn(many, 'brown'),
    mirelleHair: factIn(many, 'red'),
    mirelleBuild: factIn(many, 'slight'),
    orlaBuild: factIn(many, 'scarred'),
});
const MANY_REPLIES = Object.freeze([
    [['Narrator', 'Halvard, forty winters old, waits.']],
    [['Narrator', 'Halvard looks up, his eyes green.']],
    [['Narrator', 'Halvard brushes back hair gone white.']],
    [['Narrator', 'Mirelle, sixty winters old, laughs.']],
    [['Narrator', 'Mirelle blinks, her eyes blue.']],
    [['Narrator', 'Mirelle shakes out hair of gold.']],
    [['Narrator', 'Mirelle stands, broad and heavy.']],
]);
const MANY_ORDER = Object.freeze([
    MANY_IDS.halvardAge,
    MANY_IDS.halvardEyes,
    MANY_IDS.halvardHair,
    MANY_IDS.mirelleAge,
    MANY_IDS.mirelleEyes,
    MANY_IDS.mirelleHair,
    MANY_IDS.mirelleBuild,
]);
const PEDANT_MANY = answer({
    CONTRADICTIONS: [
        `${MANY_IDS.halvardAge} | Halvard | age | forty`,
        `${MANY_IDS.halvardEyes} | Halvard | eyes | green`,
        `${MANY_IDS.halvardHair} | Halvard | hair | white`,
        `${MANY_IDS.mirelleAge} | Mirelle | age | sixty`,
        `${MANY_IDS.mirelleEyes} | Mirelle | eyes | blue`,
        `${MANY_IDS.mirelleHair} | Mirelle | hair | gold`,
        `${MANY_IDS.mirelleBuild} | Mirelle | build | broad and heavy`,
    ],
    LEAKS: [`${MANY_IDS.orlaBuild} | Mirelle | Your scars must ache`],
});

const SUMMER = Array(45).fill('été').join(' ');
const ALREADY = Array(40).fill('déjà').join(' ');
const LONG = Object.freeze([
    `Halvard | build | ${SUMMER} | #5`,
    `Mirelle | build | ${ALREADY} | #6`,
    'Halvard | age | 34 | #7',
]);
const long = bookState(LONG);
const LONG_IDS = Object.freeze({ halvard: factIn(long, SUMMER), mirelle: factIn(long, ALREADY) });
const PEDANT_LONG = answer({
    CONTRADICTIONS: [
        `${LONG_IDS.halvard} | Halvard | build | broad as a barn`,
        `${LONG_IDS.mirelle} | Mirelle | build | thin as a reed`,
    ],
});

/**
 * @param {string} user
 * @return {string}
 */
function replyOf(user) {
    const found = /REPLY \(#(\d+)\)/.exec(user);
    return found === null ? '' : found[1];
}

/**
 * @return {object}
 */
function modelOf() {
    const model = {
        calls: [],
        scene: MILL,
        pedant: PEDANT,
        line: `LINE: ${COURIER}`,
        understood: answer({ FACTS: ['Mirelle | hair | black | #40'] }),
        failing: new Set(),
        held: null,
        heldSystem: null,
        refusals: new Map(),
    };
    model.ask = async (role, system, user) => {
        model.calls.push({ role, system, user });
        if (model.held !== null && model.held.role === role) {
            const gate = model.held;
            model.held = null;
            await gate.promise;
        }
        if (model.heldSystem !== null && model.heldSystem.system === system) {
            const gate = model.heldSystem;
            model.heldSystem = null;
            await gate.promise;
        }
        if (model.failing.has(role)) {
            throw new Error(`${role} is offline`);
        }
        if (model.refusals.has(system)) {
            throw new Error(model.refusals.get(system));
        }
        let text = '';
        if (system === ScribeScene.Prompt) {
            text = model.scene;
        } else if (system === ScribePedant.Prompt) {
            text = model.pedant;
        } else if (system === ScribeMuse.SuggestPrompt) {
            text = model.line;
        } else if (system === ScribeAnalyzer.NotesPrompt) {
            text = model.understood;
        }
        return { text, cost: 0.001 };
    };
    model.hold = (role) => {
        let release = null;
        const promise = new Promise((resolve) => {
            release = resolve;
        });
        model.held = { role, promise };
        return release;
    };
    model.holdSystem = (system) => {
        let release = null;
        const promise = new Promise((resolve) => {
            release = resolve;
        });
        model.heldSystem = { system, promise };
        return release;
    };
    model.roles = () => model.calls.map((call) => call.role);
    return model;
}

/**
 * @param {object} fields
 * @return {StandInKeeper}
 */
function keeperOf(fields = {}) {
    return new StandInKeeper({
        reader: true,
        trusted: true,
        edition: 1,
        phase: 'Idle',
        stop: null,
        read: 40,
        state,
        player: 'Orla',
        messages: story,
        settings: { refresh: 6, budget: 3 },
        spentToday: 0,
        unread: story.slice(40),
        lastRead: { id: 'MESSAGE-40', position: 40 },
        ...fields,
    });
}

/**
 * @param {StandInKeeper} keeper
 * @param {object} live
 * @return {object}
 */
function following(keeper, live) {
    return {
        ...live,
        reply: (message) => {
            if (!keeper.pinned) {
                const known = Array.isArray(keeper.current.messages) ? keeper.current.messages : story;
                const earlier = story
                    .slice(0, message.position - 1)
                    .map((original) => known.find((item) => item.position === original.position) ?? original);
                const messages = [...earlier, message];
                keeper.change({ messages, unread: messages.slice(40) });
            }
            return live.reply(message);
        },
    };
}

/**
 * @param {object} fields
 * @param {FakeStorage} storage
 * @return {{ keeper: StandInKeeper, storage: FakeStorage, model: object, notices: { count: number }, live: object, raw: object, notify: function(): void }}
 */
function rig(fields = {}, storage = new FakeStorage()) {
    const keeper = keeperOf(fields);
    const model = modelOf();
    const notices = { count: 0 };
    const notify = () => {
        notices.count++;
    };
    const raw = ScribeLive.open({ keeper, storage, roomId: ROOM, ask: model.ask, clock: CLOCK, notify });
    const live = following(keeper, raw);
    return { keeper, storage, model, notices, live, raw, notify };
}

/**
 * @return {Promise<void>}
 */
async function ticks() {
    for (let tick = 0; tick < MOST_TICKS; tick++) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

/**
 * @param {object} live
 * @return {Array<[string, string, string]>}
 */
function statuses(live) {
    return plain(live.view().findings.map((finding) => [finding.kind, finding.message, finding.status]));
}

/**
 * @param {object} live
 * @param {string} kind
 * @param {string} message
 * @return {string}
 */
function keyOf(live, kind, message) {
    const found = live.view().findings.filter((finding) => finding.kind === kind && finding.message === message);
    assert.equal(found.length, 1, `${kind} findings of ${message}`);
    return found[0].key;
}

/**
 * @param {object} live
 * @param {string} key
 * @return {object}
 */
function findingOf(live, key) {
    return live.view().findings.find((finding) => finding.key === key);
}

/**
 * @param {object} live
 * @param {string} key
 * @return {string}
 */
function statusOf(live, key) {
    return findingOf(live, key).status;
}

/**
 * @param {FakeStorage} storage
 * @return {string[]}
 */
function ledOf(storage) {
    return plain(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).led);
}

/**
 * @return {object}
 */
function greenState() {
    return bookState(FACTS.map((fact) => fact.replace('eyes | grey', 'eyes | green')));
}

/**
 * @param {object} book
 * @return {object}
 */
function revised(book) {
    return Object.freeze({ ...book, revision: book.revision + 1 });
}

const BUSY = /^Error: The last request of this kind has not finished yet$/;
const STOPPED = /^Error: The keeper is stopped$/;
const UNTRUSTED = /^Error: The book of this chat cannot be trusted right now$/;
const PAUSED = Object.freeze({ phase: 'Stopped', stop: Object.freeze({ reason: 'Paused', problem: null }) });
const BUDGET = Object.freeze({ phase: 'Stopped', stop: Object.freeze({ reason: 'Budget', problem: null }) });
const READING = Object.freeze({ reader: true, trusted: true, mismatch: false, phase: 'Idle', stop: null });
const HALVARD = state.subjects.find((subject) => subject.label === 'Halvard').id;
const BIG = Object.freeze([
    'Halvard | age | 34 | #5',
    'Halvard | eyes | grey | #6',
    'Halvard | hair | black | #7',
    'Halvard | build | lean | #8',
    'Halvard | skin | pale | #11',
    'Mirelle | age | 30 | #12',
    'Mirelle | eyes | brown | #13',
    'Mirelle | hair | red | #14',
    'Mirelle | build | slight | #15',
    'Mirelle | skin | freckled | #16',
    'Orla | age | 25 | #17',
    'Orla | eyes | green | #18',
]);

/**
 * @param {object} model
 * @return {number}
 */
function chooses(model) {
    return model.calls.filter((call) => call.system === ScribeReminder.ChoosePrompt).length;
}

test('a reply gives a scene and findings', async () => {
    const { storage, model, notices, live } = rig();
    await live.reply(at(41));
    const view = live.view();
    assert.deepEqual(
        plain({
            message: view.now.message,
            position: view.now.position,
            day: view.now.day,
            place: view.now.place,
            reach: view.now.reach,
            present: view.now.present.map((person) => person.label),
            summary: view.now.summary,
            changed: view.now.changed,
        }),
        {
            message: 'MESSAGE-41',
            position: 41,
            day: 1,
            place: 'The mill',
            reach: 'Private',
            present: ['Halvard', 'Mirelle', 'Orla'],
            summary: 'They talk',
            changed: true,
        },
    );
    assert.deepEqual(statuses(live), [['Contradiction', 'MESSAGE-41', 'Open']]);
    const finding = view.findings[0];
    assert.equal(finding.fault, ScribePedant.key(finding));
    assert.equal(finding.key, JSON.stringify([finding.fault, 'MESSAGE-41']));
    assert.equal(finding.fact, AGE);
    assert.equal(finding.said, 'forty');
    const saved = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
    assert.equal(saved.now.place, 'The mill');
    assert.deepEqual(plain(saved.findings.map((kept) => [kept.key, kept.status])), [[finding.key, 'Open']]);
    assert.equal(saved.ready, view.ready);
    assert.equal(saved.seen.id, 'MESSAGE-41');
    assert.ok(storage.list().includes(`scribe:head:${ROOM}:live`));
    assert.equal(notices.count, 1);
    assert.deepEqual(
        model.calls.map((call) => [call.role, call.system === ScribeScene.Prompt, call.system === ScribePedant.Prompt]),
        [
            ['Scribe', true, false],
            ['Pedant', false, true],
        ],
    );
    assert.equal(replyOf(model.calls[1].user), '41');
    assert.equal(view.problem, null);
});

test('the first scene and a changed scene make a reminder ready', async () => {
    const { model, live } = rig();
    await live.reply(at(41));
    const first = live.view().ready;
    assert.ok(reminds(first, 'The mill'), first);
    live.outgoing('Onward.');
    live.sent();
    assert.equal(live.view().ready, null);
    await live.reply(at(45));
    assert.equal(live.view().ready, null);
    assert.equal(live.view().sends, 0);
    assert.equal(live.view().due, false);
    model.scene = TENT;
    await live.reply(at(49));
    const tent = live.view().ready;
    assert.ok(reminds(tent, 'The tent'), tent);
    live.outgoing('Onward.');
    live.sent();
    model.scene = TENT_AGAIN;
    await live.reply(at(51));
    assert.ok(reminds(live.view().ready, 'The tent'));
    assert.equal(live.view().now.summary, 'Night falls');

    const unreminded = rig();
    const healthy = breakView(unreminded.keeper, { messages: story.slice(0, 41) }, 'unread');
    await unreminded.live.reply(at(41));
    assert.equal(unreminded.live.view().now.place, 'The mill');
    assert.equal(unreminded.live.view().ready, null);
    assert.equal(unreminded.live.view().due, true);
    unreminded.keeper.current = healthy;
    unreminded.keeper.pinned = false;
    await unreminded.live.reply(at(45));
    assert.equal(unreminded.live.view().now.changed, false);
    assert.ok(reminds(unreminded.live.view().ready, 'The mill'));
    assert.equal(unreminded.live.view().due, false);
});

test('the refresh count makes a reminder due', async () => {
    const { live } = rig({ settings: { refresh: 3 } });
    await live.reply(at(41));
    assert.notEqual(live.view().ready, null);
    live.outgoing('One.');
    live.sent();
    assert.equal(live.view().sends, 0);
    live.outgoing('Two.');
    live.sent();
    await live.reply(at(45));
    assert.equal(live.view().ready, null);
    live.outgoing('Three.');
    live.sent();
    await live.reply(at(49));
    assert.equal(live.view().ready, null);
    assert.equal(live.view().sends, 2);
    assert.equal(live.view().due, false);
    live.outgoing('Four.');
    live.sent();
    assert.equal(live.view().sends, 3);
    assert.equal(live.view().due, true);
    await live.reply(at(51));
    assert.ok(reminds(live.view().ready, 'The mill'));
    assert.equal(live.view().now.changed, false);
});

test("a regenerated reply takes back the old one's findings", async () => {
    const { model, live } = rig();
    await live.reply(at(45));
    assert.equal(live.view().now.place, 'The mill');
    model.scene = TENT;
    await live.reply(at(47));
    assert.equal(live.view().now.place, 'The tent');
    assert.deepEqual(statuses(live), [
        ['Spelling', 'MESSAGE-47', 'Open'],
        ['Contradiction', 'MESSAGE-47', 'Open'],
    ]);
    live.dismiss(keyOf(live, 'Spelling', 'MESSAGE-47'));
    model.scene = YARD;
    const regenerated = variant(47, [['Narrator', 'Halvard, thirty winters old, walks out past Halvart.']], 'OTHER-47');
    assert.equal(regenerated.position, 47);
    await live.reply(regenerated);
    assert.deepEqual(statuses(live), [['Contradiction', 'OTHER-47', 'Open']]);
    assert.equal(live.view().findings[0].said, 'thirty');
    const scenes = model.calls.filter((call) => call.system === ScribeScene.Prompt);
    assert.equal(scenes.length, 3);
    assert.ok(scenes[2].user.includes('LAST KNOWN SCENE:\nDay 1 | The mill | private |'));
    assert.ok(!scenes[2].user.includes('The tent'));
    assert.equal(live.view().now.place, 'The yard');
    assert.equal(live.view().now.message, 'OTHER-47');

    model.scene = TENT;
    const again = variant(47, [['Narrator', 'Halvard, forty winters old, walks out past Halvart.']], 'THIRD-47');
    await live.reply(again);
    const latest = model.calls.filter((call) => call.system === ScribeScene.Prompt).at(-1);
    assert.ok(latest.user.includes('LAST KNOWN SCENE:\nDay 1 | The mill | private |'));
    assert.deepEqual(statuses(live), [['Contradiction', 'THIRD-47', 'Open']]);
});

test('the same reply twice is handled once', async () => {
    const { storage, model, notices, live } = rig();
    await live.reply(at(41));
    const calls = model.calls.length;
    const saves = storage.count('set');
    const told = notices.count;
    await live.reply(at(41));
    assert.equal(at(42).fromPlayer, true);
    await live.reply(at(42));
    assert.equal(model.calls.length, calls);
    assert.equal(storage.count('set'), saves);
    assert.equal(notices.count, told);
    const edited = variant(41, [['Narrator', 'Halvard, forty winters old, hums by the fire, smiling.']], null);
    assert.equal(edited.id, 'MESSAGE-41');
    assert.notEqual(edited.fingerprint, at(41).fingerprint);
    await live.reply(edited);
    assert.equal(model.calls.length, calls + 2);

    const copy = variant(43, scripted[41], 'COPY-43');
    assert.equal(copy.fingerprint, at(41).fingerprint);
    const twin = rig();
    await twin.live.reply(at(41));
    await twin.live.reply(copy);
    assert.deepEqual(
        twin.model.calls.map((call) => `${call.role}:${replyOf(call.user)}`),
        ['Scribe:', 'Pedant:41', 'Scribe:', 'Pedant:43'],
    );
});

test('replies are handled one at a time', async () => {
    const { model, live } = rig();
    const release = model.hold('Scribe');
    const first = live.reply(at(41));
    await ticks();
    assert.deepEqual(plain(model.roles()), ['Scribe']);
    const second = live.reply(at(43));
    const third = live.reply(at(45));
    await ticks();
    assert.deepEqual(plain(model.roles()), ['Scribe']);
    release();
    await Promise.all([first, second, third]);
    assert.deepEqual(
        plain(model.calls.map((call) => `${call.role}:${replyOf(call.user)}`)),
        ['Scribe:', 'Pedant:41', 'Scribe:', 'Pedant:45'],
    );
    assert.deepEqual(statuses(live), [['Contradiction', 'MESSAGE-41', 'Open']]);
    await live.reply(at(47));
    assert.equal(replyOf(model.calls.at(-1).user), '47');
});

test('a failing model changes nothing it should not', async () => {
    const { keeper, storage, model, notices, live } = rig();
    await live.reply(at(41));
    live.outgoing('Onward.');
    live.sent();
    model.failing.add('Scribe');
    await live.reply(at(43));
    assert.equal(live.view().now.message, 'MESSAGE-41');
    assert.equal(live.view().now.place, 'The mill');
    assert.equal(replyOf(model.calls.at(-1).user), '43');
    assert.equal(model.calls.at(-1).role, 'Pedant');
    assert.deepEqual(statuses(live), [
        ['Spelling', 'MESSAGE-43', 'Open'],
        ['Contradiction', 'MESSAGE-43', 'Open'],
        ['Leak', 'MESSAGE-43', 'Open'],
        ['Contradiction', 'MESSAGE-41', 'Reminded'],
    ]);
    const kept = statuses(live);
    model.failing.delete('Scribe');
    model.failing.add('Pedant');
    model.scene = TENT;
    await live.reply(at(45));
    assert.deepEqual(statuses(live), kept);
    assert.equal(live.view().now.place, 'The tent');
    assert.ok(reminds(live.view().ready, 'The tent'));
    model.failing.clear();

    const tentReminder = live.view().ready;
    keeper.pinned = true;
    keeper.change({ messages: null });
    const saves = storage.count('set');
    const told = notices.count;
    await live.reply(at(47));
    assert.equal(live.view().now.place, 'The tent');
    assert.equal(model.calls.at(-1).role, 'Pedant');
    assert.equal(replyOf(model.calls.at(-1).user), '47');
    assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).seen.id, 'MESSAGE-47');
    assert.ok(storage.count('set') > saves);
    assert.equal(notices.count, told + 1);
    assert.equal(typeof live.view().problem, 'string');
    assert.equal(live.view().ready, tentReminder);
    assert.equal(live.outgoing('Onward.'), 'Onward.');

    breakView(keeper, { messages: [...story.slice(0, 48), at(49)] }, 'unread');
    model.scene = ROAD;
    await live.reply(at(49));
    assert.equal(live.view().now.place, 'The road');
    assert.equal(live.view().ready, null);
    assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).now.place, 'The road');
    assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).ready, null);
    assert.equal(notices.count, told + 3);
});

test("the player's words go first and unchanged", async () => {
    const { storage, live } = rig();
    await live.reply(at(41));
    live.use(GULL);
    const view = live.view();
    assert.ok(reminds(view.ready, 'The mill'));
    const text = 'I draw my blade.  ';
    const saves = storage.count('set');
    const result = live.outgoing(text);
    assert.equal(result, `${text}\n@: ${view.ready}\n@: ${GULL}`);
    assert.equal(result.slice(0, text.length), text);
    assert.equal(live.outgoing(text), result);
    assert.equal(storage.count('set'), saves);
    assert.equal(live.view().ready, view.ready);
    assert.equal(live.view().suggestion, GULL);
    const spaced = '\n  *I wait.*\t\n';
    assert.equal(live.outgoing(spaced).slice(0, spaced.length), spaced);
});

test('the size guard never cuts the player', async () => {
    const { live } = rig();
    await live.reply(at(41));
    const ready = live.view().ready;
    assert.ok(reminds(ready, 'The mill'));
    /**
     * @param {number} size
     * @return {string}
     */
    const suggestionOf = (size) => `S${'o'.repeat(size - bytes(lineOf('')) - 1)}`;
    const size = LIMIT - bytes(lineOf(ready)) - 50;
    const room = LIMIT - size;
    for (const player of ['x'.repeat(size), 'é'.repeat(Math.floor(size / 2)) + 'x'.repeat(size % 2)]) {
        assert.equal(bytes(player), size);
        for (const [lineSize, withReady] of [
            [50, true],
            [51, false],
            [room, false],
        ]) {
            const suggestion = suggestionOf(lineSize);
            assert.equal(bytes(lineOf(suggestion)), lineSize);
            live.use(suggestion);
            const result = live.outgoing(player);
            const expected = player + (withReady ? lineOf(ready) : '') + lineOf(suggestion);
            assert.ok(result === expected, `stage ${lineSize}`);
            assert.ok(bytes(result) <= LIMIT);
        }
        live.use(suggestionOf(room + 1));
        assert.ok(live.outgoing(player) === player);
    }
    for (const text of ['x'.repeat(4600), 'x'.repeat(LIMIT), 'é'.repeat(2300), '', '   ', ' \n\t ']) {
        assert.ok(live.outgoing(text) === text, `length ${text.length}`);
    }
    assert.equal(live.view().ready, ready);
});

test('sent forgets what went and keeps what did not', async () => {
    const { model, live } = rig();
    await live.reply(at(41));
    const age = keyOf(live, 'Contradiction', 'MESSAGE-41');
    live.use(GULL);
    const ready = live.view().ready;
    const player = 'x'.repeat(LIMIT - bytes(lineOf(GULL)));
    assert.ok(live.outgoing(player) === player + lineOf(GULL));
    live.sent();
    assert.equal(live.view().ready, ready);
    assert.equal(live.view().suggestion, null);
    assert.equal(live.view().sends, 1);
    assert.equal(statusOf(live, age), 'Open');
    assert.equal(live.outgoing('Onward.'), `Onward.${lineOf(ready)}`);
    live.sent();
    assert.equal(live.view().ready, null);
    assert.equal(live.view().sends, 0);
    assert.equal(statusOf(live, age), 'Reminded');
    live.outgoing('Quiet.');
    live.sent();
    assert.equal(live.view().sends, 1);
    live.sent();
    assert.equal(live.view().sends, 2);

    assert.equal(live.outgoing('Waiting.'), 'Waiting.');
    model.scene = TENT;
    await live.reply(at(45));
    const fresh = live.view().ready;
    assert.ok(reminds(fresh, 'The tent'));
    live.sent();
    assert.equal(live.view().ready, fresh);
    assert.equal(live.view().sends, 3);

    live.use(GULL);
    assert.equal(live.outgoing('Hi.'), `Hi.${lineOf(fresh)}${lineOf(GULL)}`);
    live.use(COURIER);
    live.sent();
    assert.equal(live.view().suggestion, COURIER);
    assert.equal(live.view().ready, null);
});

test('findings can be dismissed and told', async () => {
    const { keeper, live } = rig();
    await live.reply(at(43));
    assert.deepEqual(statuses(live), [
        ['Spelling', 'MESSAGE-43', 'Open'],
        ['Contradiction', 'MESSAGE-43', 'Open'],
        ['Leak', 'MESSAGE-43', 'Open'],
    ]);
    const spelling = keyOf(live, 'Spelling', 'MESSAGE-43');
    const contradiction = keyOf(live, 'Contradiction', 'MESSAGE-43');
    const leak = keyOf(live, 'Leak', 'MESSAGE-43');
    live.dismiss(spelling);
    assert.equal(statusOf(live, spelling), 'Dismissed');

    keeper.refuseRule = true;
    await assert.rejects(live.told(leak), /The ruling was refused/);
    assert.equal(statusOf(live, leak), 'Open');
    keeper.refuseRule = false;
    keeper.ruled.length = 0;
    await live.told(leak);
    assert.deepEqual(plain(keeper.ruled), [{ type: 'Widen', fact: BUILD, to: [MIRELLE] }]);
    assert.equal(statusOf(live, leak), 'Told');
    await live.told(spelling);
    await live.told(contradiction);
    assert.equal(keeper.ruled.length, 1);
    assert.equal(statusOf(live, spelling), 'Dismissed');
    assert.equal(statusOf(live, contradiction), 'Open');

    const edited = variant(
        43,
        [
            ['Narrator', 'Halvart, his eyes green tonight, whistles again.'],
            ['Mirelle', 'Your scars ache in the rain, I know.'],
        ],
        null,
    );
    assert.equal(edited.id, 'MESSAGE-43');
    assert.notEqual(edited.fingerprint, at(43).fingerprint);
    await live.reply(edited);
    assert.deepEqual(statuses(live), [
        ['Contradiction', 'MESSAGE-43', 'Open'],
        ['Leak', 'MESSAGE-43', 'Open'],
    ]);

    const orla = state.subjects.find((subject) => subject.label === 'Orla').id;
    const widened = rig({ state: bookState(FACTS, [{ type: 'Widen', fact: BUILD, to: [orla] }]) });
    await widened.live.reply(at(43));
    await widened.live.told(keyOf(widened.live, 'Leak', 'MESSAGE-43'));
    assert.deepEqual(plain(widened.keeper.ruled), [{ type: 'Widen', fact: BUILD, to: [orla, MIRELLE] }]);
});

test('a watching tab does nothing', async () => {
    const storage = new FakeStorage();
    const readerKeeper = keeperOf();
    const readerModel = modelOf();
    const reader = following(
        readerKeeper,
        ScribeLive.open({
            keeper: readerKeeper,
            storage,
            roomId: ROOM,
            ask: readerModel.ask,
            clock: CLOCK,
            notify: () => {},
        }),
    );
    await reader.reply(at(41));
    const millReminder = reader.view().ready;
    assert.ok(reminds(millReminder, 'The mill'));

    const watcherKeeper = keeperOf({ reader: false, trusted: false });
    const watcherModel = modelOf();
    const notices = { count: 0 };
    const watcher = following(
        watcherKeeper,
        ScribeLive.open({
            keeper: watcherKeeper,
            storage,
            roomId: ROOM,
            ask: watcherModel.ask,
            clock: CLOCK,
            notify: () => {
                notices.count++;
            },
        }),
    );
    const saves = storage.count('set');
    await watcher.reply(at(43));
    assert.equal(watcherModel.calls.length, 0);
    assert.equal(storage.count('set'), saves);
    assert.equal(watcher.outgoing('Hello.'), 'Hello.');
    await assert.rejects(watcher.suggest(), /^Error: Another tab is reading this chat$/);
    await assert.rejects(watcher.another(), /^Error: Another tab is reading this chat$/);
    await assert.rejects(watcher.tell('Mirelle has black hair.'), /^Error: Another tab is reading this chat$/);
    assert.equal(watcherModel.calls.length, 0);
    const key = watcher.view().findings[0].key;
    watcher.dismiss(key);
    watcher.use(GULL);
    watcher.clear();
    watcher.sent();
    watcher.ignore();
    watcher.forget();
    await watcher.told(key);
    await watcher.confirm();
    assert.equal(storage.count('set'), saves);
    assert.equal(watcherKeeper.ruled.length, 0);
    assert.equal(watcherKeeper.filed.length, 0);
    assert.equal(notices.count, 0);
    assert.equal(watcher.view().findings[0].status, 'Open');

    readerModel.scene = TENT;
    await reader.reply(at(43));
    const tentReminder = reader.view().ready;
    assert.ok(reminds(tentReminder, 'The tent'));
    reader.close();
    watcherKeeper.change({ reader: true, trusted: true });
    assert.equal(watcher.outgoing('Hello.'), `Hello.${lineOf(tentReminder)}`);
    assert.equal(watcher.view().findings.length, 4);
    watcherKeeper.change({ reader: false, trusted: false });
    assert.equal(watcher.outgoing('Hello.'), 'Hello.');

    const flight = rig();
    const release = flight.model.hold('Scribe');
    const pending = flight.live.reply(at(41));
    await ticks();
    flight.keeper.change({ reader: false, trusted: false });
    flight.live.view();
    flight.keeper.change({ reader: true, trusted: true });
    flight.live.view();
    const quiet = flight.storage.count('set');
    release();
    await pending;
    await ticks();
    assert.equal(flight.storage.count('set'), quiet);
    assert.equal(flight.live.view().findings.length, 0);
    assert.equal(flight.live.view().now, null);
    assert.equal(ScribeStore.read(flight.storage, ROOM, ScribeStore.Kind.Live).seen, null);
});

test('a closed live part is silent', async () => {
    const { storage, model, notices, live } = rig();
    await live.reply(at(41));
    const key = live.view().findings[0].key;
    assert.notEqual(live.view().ready, null);
    const release = model.hold('Scribe');
    const pending = live.reply(at(43));
    await ticks();
    assert.deepEqual(plain(model.roles()), ['Scribe', 'Pedant', 'Scribe']);
    live.close();
    const calls = model.calls.length;
    const saves = storage.count('set');
    const told = notices.count;
    release();
    await pending;
    await ticks();
    assert.equal(model.calls.length, calls);
    assert.equal(storage.count('set'), saves);
    assert.equal(notices.count, told);
    assert.equal(live.view().now.message, 'MESSAGE-41');
    assert.equal(live.outgoing('Hello.'), 'Hello.');
    live.sent();
    live.dismiss(key);
    live.use(GULL);
    live.clear();
    await live.suggest();
    await live.tell('Mirelle has black hair.');
    await live.told(key);
    await live.confirm();
    await live.reply(at(45));
    assert.equal(model.calls.length, calls);
    assert.equal(storage.count('set'), saves);
    assert.equal(notices.count, told);
    assert.equal(statusOf(live, key), 'Open');

    const ruling = rig();
    await ruling.live.reply(at(43));
    const leak = keyOf(ruling.live, 'Leak', 'MESSAGE-43');
    ruling.keeper.refuseRule = true;
    const telling = ruling.live.told(leak);
    ruling.live.close();
    await telling;
    assert.equal(ruling.keeper.ruled.length, 1);
    assert.equal(statusOf(ruling.live, leak), 'Open');
});

test('what is kept survives a reload', async () => {
    const { keeper, storage, model, notify, live } = rig();
    await live.reply(at(41));
    await live.reply(at(43));
    live.dismiss(keyOf(live, 'Spelling', 'MESSAGE-43'));
    live.outgoing('Onward.');
    live.sent();
    model.scene = TENT;
    await live.reply(at(45));
    live.use(GULL);
    /**
     * @param {object} view
     * @return {object}
     */
    const kept = (view) =>
        plain({
            now: view.now,
            ready: view.ready,
            sends: view.sends,
            suggestion: view.suggestion,
            findings: view.findings.map((finding) => [finding.key, finding.status]),
        });
    const before = kept(live.view());
    assert.equal(before.now.place, 'The tent');
    assert.notEqual(before.ready, null);
    assert.deepEqual(
        before.findings.map(([, status]) => status),
        ['Dismissed', 'Reminded', 'Open', 'Reminded'],
    );
    live.close();
    const again = following(
        keeper,
        ScribeLive.open({ keeper, storage, roomId: ROOM, ask: model.ask, clock: CLOCK, notify }),
    );
    assert.deepEqual(kept(again.view()), before);
    assert.equal(again.view().problem, null);
    assert.equal(before.suggestion, GULL);
    assert.equal(again.outgoing('Hello.'), `Hello.${lineOf(before.ready)}${lineOf(GULL)}`);
    const calls = model.calls.length;
    await again.reply(at(45));
    assert.equal(model.calls.length, calls);

    const waiting = rig();
    await waiting.live.reply(at(41));
    assert.deepEqual(ledOf(waiting.storage), [AGE]);
    waiting.live.close();
    const reopened = rig({}, waiting.storage);
    reopened.live.outgoing('Hello.');
    reopened.live.sent();
    assert.equal(statusOf(reopened.live, keyOf(reopened.live, 'Contradiction', 'MESSAGE-41')), 'Reminded');

    const shaped = new FakeStorage();
    ScribeStore.write(shaped, ROOM, ScribeStore.Kind.Live, { findings: 'none', sends: 3 });
    const odd = ScribeLive.open({ keeper, storage: shaped, roomId: ROOM, ask: model.ask, clock: CLOCK, notify });
    assert.equal(odd.view().problem, null);
    assert.equal(odd.view().findings.length, 0);
    assert.equal(odd.view().sends, 3);

    const damaged = new FakeStorage();
    ScribeStore.write(damaged, ROOM, ScribeStore.Kind.Live, { findings: [], sends: 0 });
    for (const name of damaged.list()) {
        if (name.includes(':live') && !name.includes(':head:')) {
            damaged.values.set(name, 'garbage');
        }
    }
    const broken = rig({}, damaged);
    assert.equal(broken.live.view().problem, 'The saved live of this chat is damaged');
    assert.equal(broken.live.view().now, null);
    assert.equal(broken.live.view().findings.length, 0);
    await broken.live.reply(at(41));
    assert.equal(ScribeStore.read(damaged, ROOM, ScribeStore.Kind.Live).seen.id, 'MESSAGE-41');
});

test('a suggestion is offered and never repeated in a scene', async () => {
    const { model, live } = rig();
    /**
     * @return {object[]}
     */
    const offers = () => model.calls.filter((call) => call.system === ScribeMuse.SuggestPrompt);
    await live.reply(at(41));
    await live.suggest();
    assert.deepEqual(plain(live.view().offer), { thread: 'T2', text: COURIER });
    assert.ok(offers()[0].user.includes('THREAD:\nMirelle owes a favour to the guild'));
    await live.reply(at(43));
    model.line = `LINE: ${COLLECTOR}`;
    await live.another();
    assert.deepEqual(plain(live.view().offer), { thread: 'T1', text: COLLECTOR });
    assert.ok(offers()[1].user.includes('THREAD:\nthe debt to Brandt'));
    await live.another();
    assert.equal(live.view().offer, null);
    assert.equal(offers().length, 2);

    model.scene = TENT;
    await live.reply(at(45));
    model.line = `LINE: ${COURIER}`;
    await live.suggest();
    assert.deepEqual(plain(live.view().offer), { thread: 'T2', text: COURIER });
    assert.equal(offers().length, 3);
    live.ignore();
    assert.equal(live.view().offer, null);
    model.line = `LINE: ${COLLECTOR}`;
    await live.another();
    assert.deepEqual(plain(live.view().offer), { thread: 'T1', text: COLLECTOR });
    live.use(live.view().offer.text);
    assert.equal(live.view().offer, null);
    assert.equal(live.view().suggestion, COLLECTOR);

    model.scene = ROAD;
    await live.reply(at(47));
    model.line = 'LINE: none';
    await live.suggest();
    assert.equal(live.view().offer, null);
    assert.equal(offers().length, 5);
    model.line = `LINE: ${COURIER}`;
    await live.suggest();
    assert.deepEqual(plain(live.view().offer), { thread: 'T2', text: COURIER });
    assert.deepEqual(plain([...new Set(offers().map((call) => call.role))]), ['Scribe']);

    live.use('Something else entirely.');
    assert.deepEqual(plain(live.view().offer), { thread: 'T2', text: COURIER });
    live.use('A gull\n  cries over\tthe mill.');
    assert.equal(live.view().suggestion, GULL);
    model.scene = YARD;
    await live.reply(at(49));
    assert.equal(live.view().now.place, 'The yard');
    assert.equal(live.view().offer, null);
});

test("the player's words are filed only on confirmation", async () => {
    const { keeper, model, live } = rig();
    /**
     * @return {object[]}
     */
    const analyses = () => model.calls.filter((call) => call.system === ScribeAnalyzer.NotesPrompt);
    const anchor = { id: 'MESSAGE-40', position: 40 };
    keeper.previewer = previewFrom(FACTS);
    await live.tell('Mirelle has black hair.');
    assert.equal(live.view().understood.count, 1);
    assert.ok(live.view().understood.lines.some((line) => line.includes('black')));
    assert.equal(keeper.filed.length, 0);
    assert.equal(analyses().length, 1);
    assert.equal(analyses()[0].role, 'Analyzer');
    assert.ok(analyses()[0].user.includes('PLAYER NOTES:\n[#40] Mirelle has black hair.'));
    await live.confirm();
    assert.equal(keeper.filed.length, 1);
    assert.deepEqual(
        plain(keeper.filed[0].operations.map((operation) => [operation.type, operation.label, operation.text])),
        [['Fact', 'Mirelle', 'black']],
    );
    assert.deepEqual(plain(keeper.filed[0].anchor), anchor);
    assert.equal(live.view().understood, null);
    await live.confirm();
    assert.equal(keeper.filed.length, 1);

    await live.tell('Mirelle has black hair.');
    keeper.refuseFile = true;
    await assert.rejects(live.confirm(), /The filing was refused/);
    assert.equal(live.view().understood.count, 1);
    keeper.refuseFile = false;
    live.forget();
    assert.equal(live.view().understood, null);
    assert.equal(keeper.filed.length, 2);

    await live.tell('   \n ');
    assert.equal(live.view().understood, null);
    keeper.change({ lastRead: null });
    await live.tell('Mirelle has black hair.');
    assert.equal(live.view().understood, null);
    assert.equal(analyses().length, 2);
    keeper.change({ lastRead: { id: 'MESSAGE-40', position: 40 } });
    model.understood = 'Nothing to file.';
    const previews = keeper.previews.length;
    await live.tell('Mirelle has black hair.');
    assert.deepEqual(plain(live.view().understood.lines), []);
    assert.equal(live.view().understood.count, 0);
    await live.confirm();
    assert.equal(keeper.filed.length, 2);
    assert.equal(keeper.previews.length, previews);
    assert.deepEqual(plain([...new Set(analyses().map((call) => call.role))]), ['Analyzer']);
});

test('what can be done is told with each finding', async () => {
    const { keeper, live } = rig();
    await live.reply(at(43));
    const eyes = keyOf(live, 'Contradiction', 'MESSAGE-43');
    const leak = keyOf(live, 'Leak', 'MESSAGE-43');
    const spelling = keyOf(live, 'Spelling', 'MESSAGE-43');
    const open = findingOf(live, eyes).can;
    assert.deepEqual(plain(open), { told: false, spent: false });
    assert.deepEqual(plain(findingOf(live, leak).can), { told: true, spent: false });

    const first = live.view();
    const second = live.view();
    const same = [eyes, leak, spelling].map(
        (key) =>
            first.findings.find((finding) => finding.key === key).can ===
            second.findings.find((finding) => finding.key === key).can,
    );
    assert.deepEqual(same, [true, true, true]);

    live.dismiss(spelling);
    assert.equal(findingOf(live, spelling).can, null);
    assert.equal(findingOf(live, spelling).status, 'Dismissed');

    keeper.change({ state: greenState() });
    const changed = findingOf(live, eyes).can;
    assert.ok(changed !== open);
    assert.deepEqual(plain(changed), { told: false, spent: true });
    assert.equal(findingOf(live, leak).can.told, true);

    keeper.change({ state: bookState(FACTS, [{ type: 'Widen', fact: BUILD, to: [MIRELLE] }]) });
    assert.deepEqual(plain(findingOf(live, leak).can), { told: false, spent: true });
});

test('an action with nothing to do changes nothing', async () => {
    const { keeper, storage, notices, live } = rig();
    await live.reply(at(43));
    const leak = keyOf(live, 'Leak', 'MESSAGE-43');
    const eyes = keyOf(live, 'Contradiction', 'MESSAGE-43');
    assert.equal(findingOf(live, eyes).can.told, false);
    const saves = storage.count('set');
    const told = notices.count;
    await live.told(eyes);
    assert.deepEqual([statusOf(live, leak), statusOf(live, eyes)], ['Open', 'Open']);
    assert.equal(keeper.ruled.length, 0);
    assert.equal(storage.count('set'), saves);
    assert.equal(notices.count, told);

    live.dismiss(leak);
    await live.told(leak);
    assert.equal(keeper.ruled.length, 0);
    assert.equal(statusOf(live, leak), 'Dismissed');
});

test('there is no accept', async () => {
    const { live, raw } = rig();
    assert.equal(Object.hasOwn(raw, 'accept'), false);
    assert.equal(typeof raw.accept, 'undefined');
    await live.reply(at(43));
    const eyes = findingOf(live, keyOf(live, 'Contradiction', 'MESSAGE-43'));
    assert.equal(eyes.status, 'Open');
    assert.equal(Object.hasOwn(eyes.can, 'accept'), false);
});

test('there are no corrections', async () => {
    const { live, raw, storage, keeper, model, notify } = rig();
    assert.equal(Object.hasOwn(raw, 'correct'), false);
    assert.equal(typeof raw.correct, 'undefined');
    await live.reply(at(41));
    await live.reply(at(43));
    const view = live.view();
    assert.equal(Object.hasOwn(view, 'corrections'), false);
    const open = view.findings.filter((finding) => finding.status === 'Open');
    assert.equal(open.length, 4);
    assert.deepEqual(plain(open.map((finding) => Object.keys(finding.can).sort())), [
        ['spent', 'told'],
        ['spent', 'told'],
        ['spent', 'told'],
        ['spent', 'told'],
    ]);
    const texts = [live.outgoing('Onward.'), live.outgoing('x'.repeat(4400)), live.outgoing('Once more.')];
    assert.deepEqual(
        texts.map((text) => text.includes('Correction:')),
        [false, false, false],
    );

    const line = '[Scribe] Correction: Halvard, age: 34.';
    const saved = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
    const older = new FakeStorage();
    ScribeStore.write(older, ROOM, ScribeStore.Kind.Live, {
        ...saved,
        ready: null,
        led: [],
        corrections: [line],
        findings: saved.findings.map((finding) => ({ ...finding, correction: line })),
    });
    const reopened = ScribeLive.open({ keeper, storage: older, roomId: ROOM, ask: model.ask, clock: CLOCK, notify });
    const loaded = reopened.view();
    assert.equal(loaded.problem, null);
    assert.equal(loaded.findings.length, saved.findings.length);
    assert.deepEqual(
        loaded.findings.map((finding) => Object.hasOwn(finding, 'correction')),
        saved.findings.map(() => false),
    );
    assert.equal(Object.hasOwn(loaded, 'corrections'), false);
    assert.equal(reopened.outgoing('Hello.'), 'Hello.');
    reopened.dismiss(loaded.findings[0].key);
    const rewritten = ScribeStore.read(older, ROOM, ScribeStore.Kind.Live);
    assert.equal(Object.hasOwn(rewritten, 'corrections'), false);
    assert.deepEqual(
        rewritten.findings.map((finding) => Object.hasOwn(finding, 'correction')),
        saved.findings.map(() => false),
    );
});

test('a contradicted fact goes first', async () => {
    const { storage, model, live } = rig({ state: many });
    model.pedant = PEDANT_MANY;
    await live.reply(variant(41, MANY_REPLIES[0], null));
    assert.deepEqual(ledOf(storage), [MANY_IDS.halvardAge]);
    await live.reply(variant(43, [['Mirelle', 'Your scars must ache, Orla.']], null));
    assert.deepEqual(statuses(live), [
        ['Leak', 'MESSAGE-43', 'Open'],
        ['Contradiction', 'MESSAGE-41', 'Open'],
    ]);
    await live.reply(variant(45, MANY_REPLIES[1], null));
    assert.deepEqual(ledOf(storage), [MANY_IDS.halvardEyes, MANY_IDS.halvardAge]);
    assert.ok(live.view().ready.includes('scarred'), live.view().ready);

    live.dismiss(keyOf(live, 'Contradiction', 'MESSAGE-45'));
    await live.reply(variant(47, MANY_REPLIES[3], null));
    assert.deepEqual(ledOf(storage), [MANY_IDS.mirelleAge, MANY_IDS.halvardAge]);

    const counted = rig({ state: many });
    counted.model.pedant = PEDANT_MANY;
    for (const [index, blocks] of MANY_REPLIES.entries()) {
        await counted.live.reply(variant(41 + 2 * index, blocks, null));
    }
    assert.equal(counted.live.view().findings.length, 7);
    assert.deepEqual(ledOf(counted.storage), [...MANY_ORDER].reverse().slice(0, 5));

    const spent = rig({ state: many });
    spent.model.pedant = PEDANT_MANY;
    await spent.live.reply(variant(41, MANY_REPLIES[0], null));
    await spent.live.reply(variant(43, MANY_REPLIES[3], null));
    assert.deepEqual(ledOf(spent.storage), [MANY_IDS.mirelleAge, MANY_IDS.halvardAge]);
    spent.keeper.change({ state: bookState(MANY.map((fact) => fact.replace('Halvard | age | 34', 'Halvard | age | 35'))) });
    await spent.live.reply(variant(45, MANY_REPLIES[4], null));
    assert.deepEqual(ledOf(spent.storage), [MANY_IDS.mirelleEyes, MANY_IDS.mirelleAge]);

    const repeated = rig({ state: many });
    repeated.model.pedant = answer({
        CONTRADICTIONS: [
            `${MANY_IDS.halvardAge} | Halvard | age | forty`,
            `${MANY_IDS.halvardAge} | Halvard | age | fifty`,
            `${MANY_IDS.halvardEyes} | Halvard | eyes | green`,
            `${MANY_IDS.halvardHair} | Halvard | hair | white`,
            `${MANY_IDS.mirelleAge} | Mirelle | age | sixty`,
            `${MANY_IDS.mirelleEyes} | Mirelle | eyes | blue`,
        ],
    });
    for (const [index, blocks] of [
        MANY_REPLIES[4],
        MANY_REPLIES[3],
        MANY_REPLIES[0],
        MANY_REPLIES[2],
        [['Narrator', 'Halvard, fifty winters old, waits.']],
        MANY_REPLIES[1],
    ].entries()) {
        await repeated.live.reply(variant(41 + 2 * index, blocks, null));
    }
    assert.deepEqual(
        plain(repeated.live.view().findings.map((finding) => finding.fact)),
        [
            MANY_IDS.halvardEyes,
            MANY_IDS.halvardAge,
            MANY_IDS.halvardHair,
            MANY_IDS.halvardAge,
            MANY_IDS.mirelleAge,
            MANY_IDS.mirelleEyes,
        ],
    );
    assert.deepEqual(ledOf(repeated.storage), [
        MANY_IDS.halvardEyes,
        MANY_IDS.halvardAge,
        MANY_IDS.halvardHair,
        MANY_IDS.mirelleAge,
        MANY_IDS.mirelleEyes,
    ]);

    const leaking = rig();
    await leaking.live.reply(at(41));
    leaking.live.outgoing('Onward.');
    leaking.live.sent();
    assert.equal(leaking.live.view().ready, null);
    leaking.model.pedant = answer({ LEAKS: [`${BUILD} | Mirelle | Your scars ache`] });
    await leaking.live.reply(variant(43, [['Mirelle', 'Your scars ache in the rain, I know.']], null));
    assert.deepEqual(statuses(leaking.live), [
        ['Leak', 'MESSAGE-43', 'Open'],
        ['Contradiction', 'MESSAGE-41', 'Reminded'],
    ]);
    assert.equal(leaking.live.view().ready, null);
});

test('reminded when it went out', async () => {
    const { storage, model, live } = rig({ state: long });
    model.pedant = PEDANT_LONG;
    await live.reply(variant(41, [['Narrator', 'Halvard is broad as a barn tonight.']], null));
    const halvard = keyOf(live, 'Contradiction', 'MESSAGE-41');
    assert.deepEqual(ledOf(storage), [LONG_IDS.halvard]);
    await live.reply(variant(43, [['Narrator', 'Mirelle is thin as a reed now.']], null));
    const mirelle = keyOf(live, 'Contradiction', 'MESSAGE-43');
    assert.deepEqual(ledOf(storage), [LONG_IDS.mirelle]);
    live.outgoing('Onward.');
    live.sent();
    assert.equal(statusOf(live, mirelle), 'Reminded');
    assert.equal(statusOf(live, halvard), 'Open');
    assert.equal(findingOf(live, mirelle).can, null);
    model.scene = TENT;
    await live.reply(at(45));
    assert.deepEqual(ledOf(storage), [LONG_IDS.halvard]);
    live.outgoing('Onward.');
    live.sent();
    assert.equal(statusOf(live, halvard), 'Reminded');
    live.dismiss(mirelle);
    assert.equal(statusOf(live, mirelle), 'Dismissed');
    assert.equal(ScribeLive.Status.Reminded, 'Reminded');

    const cleared = rig({ state: long });
    cleared.model.pedant = PEDANT_LONG;
    await cleared.live.reply(variant(41, [['Narrator', 'Halvard is broad as a barn tonight.']], null));
    assert.deepEqual(ledOf(cleared.storage), [LONG_IDS.halvard]);
    cleared.live.clear();
    assert.deepEqual(ledOf(cleared.storage), []);
    cleared.live.outgoing('Onward.');
    cleared.live.sent();
    assert.equal(statusOf(cleared.live, keyOf(cleared.live, 'Contradiction', 'MESSAGE-41')), 'Open');

    const twice = rig();
    await twice.live.reply(at(41));
    const first = keyOf(twice.live, 'Contradiction', 'MESSAGE-41');
    twice.live.dismiss(first);
    twice.model.pedant = answer({ CONTRADICTIONS: [`${AGE} | Halvard | age | forty`] });
    await twice.live.reply(at(47));
    const second = keyOf(twice.live, 'Contradiction', 'MESSAGE-47');
    assert.deepEqual(ledOf(twice.storage), [AGE]);
    twice.live.outgoing('Onward.');
    twice.live.sent();
    assert.equal(statusOf(twice.live, second), 'Reminded');
    assert.equal(statusOf(twice.live, first), 'Dismissed');

    const open = bookState(MANY.map((fact) => fact.replace('scarred | hidden', 'scarred')));
    assert.equal(factIn(open, 'scarred'), MANY_IDS.orlaBuild);
    const own = rig({ state: open });
    own.model.pedant = answer({ CONTRADICTIONS: [`${MANY_IDS.orlaBuild} | Orla | build | smooth`] });
    await own.live.reply(variant(41, [['Narrator', 'Orla stands, smooth of skin.']], null));
    assert.deepEqual(ledOf(own.storage), [MANY_IDS.orlaBuild]);
    own.keeper.change({ state: many });
    own.model.pedant = answer({ LEAKS: [`${MANY_IDS.orlaBuild} | Mirelle | Your scars must ache`] });
    await own.live.reply(variant(43, [['Mirelle', 'Your scars must ache, Orla.']], null));
    assert.deepEqual(statuses(own.live), [
        ['Leak', 'MESSAGE-43', 'Open'],
        ['Contradiction', 'MESSAGE-41', 'Open'],
    ]);
    assert.equal(findingOf(own.live, keyOf(own.live, 'Leak', 'MESSAGE-43')).can.spent, false);
    assert.deepEqual(ledOf(own.storage), [MANY_IDS.orlaBuild]);
    assert.notEqual(own.live.outgoing('Onward.'), 'Onward.');
    own.live.sent();
    assert.deepEqual(statuses(own.live), [
        ['Leak', 'MESSAGE-43', 'Open'],
        ['Contradiction', 'MESSAGE-41', 'Reminded'],
    ]);
});

test('what is understood is what the engine would do', async () => {
    const { keeper, model, live } = rig();
    const anchor = { id: 'MESSAGE-40', position: 40 };
    /**
     * @param {readonly object[]} operations
     * @return {{ before: object, state: object, refused: object[] }}
     */
    const holding = (operations) => {
        const seen = previewFrom(FACTS)(operations);
        return { ...seen, refused: [...seen.refused, { operation: null, reason: 'Held back' }] };
    };
    keeper.previewer = holding;
    model.understood = answer({ FACTS: ['Mirelle | hair | black | #40', 'Mirelle | build | tall | #12'] });
    const direct = await ScribeMuse.tell({
        state,
        player: 'Orla',
        words: 'Mirelle has black hair.',
        anchor,
        ask: async () => ({ text: model.understood }),
    });
    assert.equal(direct.operations.length, 1);
    assert.deepEqual(plain(direct.refused.map((item) => item.reason)), ['WrongPosition']);
    await live.tell('Mirelle has black hair.');
    assert.deepEqual(plain(model.roles()), ['Analyzer']);
    assert.equal(keeper.previews.length, 1);
    assert.deepEqual(plain(keeper.previews[0].operations), plain(direct.operations));
    assert.deepEqual(plain(keeper.previews[0].anchor), anchor);
    const seen = holding(direct.operations);
    const expected = plain(ScribeMuse.changes(seen.before, seen.state));
    assert.ok(expected.some((line) => line.includes('black')), expected.join(' / '));
    const understood = live.view().understood;
    assert.deepEqual(plain(understood.lines), expected);
    assert.deepEqual(plain(understood.refused.map((item) => item.reason)), ['WrongPosition', 'Held back']);
    assert.equal(understood.count, 1);

    model.understood = answer({ FACTS: ['Mirelle | build | tall | #12'] });
    await live.tell('Mirelle is tall.');
    assert.equal(keeper.previews.length, 1);
    assert.deepEqual(plain(live.view().understood.lines), []);
    assert.equal(live.view().understood.count, 0);
    assert.deepEqual(plain(live.view().understood.refused.map((item) => item.reason)), ['WrongPosition']);

    model.understood = answer({ FACTS: ['Mirelle | hair | black | #40'] });
    keeper.refusePreview = true;
    await assert.rejects(live.tell('Mirelle has black hair.'), /The preview was refused/);
    assert.equal(live.view().understood, null);
    assert.equal(keeper.filed.length, 0);
});

test('confirm files only what was shown', async () => {
    const { keeper, live } = rig();
    keeper.previewer = previewFrom(FACTS);
    await live.tell('Mirelle has black hair.');
    const shown = plain(live.view().understood.lines);
    assert.equal(keeper.previews.length, 1);
    await live.confirm();
    assert.equal(keeper.previews.length, 2);
    assert.equal(keeper.filed.length, 1);
    assert.equal(live.view().understood, null);

    await live.tell('Mirelle has black hair.');
    const operations = keeper.previews.at(-1).operations;
    const moved = [...FACTS, 'Mirelle | hair | brown | #9'];
    keeper.change({ state: bookState(moved) });
    keeper.previewer = previewFrom(moved);
    await live.confirm();
    assert.equal(keeper.filed.length, 1);
    const fresh = plain(live.view().understood.lines);
    assert.notDeepEqual(fresh, shown);
    const seen = previewFrom(moved)(operations);
    assert.deepEqual(fresh, plain(ScribeMuse.changes(seen.before, seen.state)));
    assert.equal(live.view().understood.count, 1);
    await live.confirm();
    assert.equal(keeper.filed.length, 2);
    assert.equal(live.view().understood, null);

    await live.tell('Mirelle has black hair.');
    keeper.refuseFile = true;
    await assert.rejects(live.confirm(), /The filing was refused/);
    assert.equal(live.view().understood.count, 1);
    keeper.refuseFile = false;
    keeper.refusePreview = true;
    await assert.rejects(live.confirm(), /The preview was refused/);
    assert.equal(live.view().understood.count, 1);
    assert.equal(keeper.filed.length, 3);
});

test("the lines come from the preview's own states", async () => {
    const { keeper, live } = rig();
    const moved = [...FACTS, 'Mirelle | hair | brown | #9'];
    keeper.previewer = previewFrom(moved);
    await live.tell('Mirelle has black hair.');
    const operations = keeper.previews[0].operations;
    const seen = previewFrom(moved)(operations);
    const expected = plain(ScribeMuse.changes(seen.before, seen.state));
    assert.notDeepEqual(expected, plain(ScribeMuse.changes(state, seen.state)));
    assert.deepEqual(plain(live.view().understood.lines), expected);

    const aged = [...FACTS, 'Mirelle | age | 30 | #9'];
    keeper.previewer = previewFrom(aged);
    await live.confirm();
    assert.equal(keeper.filed.length, 0);
    const other = previewFrom(aged)(operations);
    const shown = plain(ScribeMuse.changes(other.before, other.state));
    assert.notDeepEqual(shown, expected);
    assert.notDeepEqual(shown, plain(ScribeMuse.changes(state, other.state)));
    assert.deepEqual(plain(live.view().understood.lines), shown);
});

test('an unmarked answer offers nothing', async () => {
    const { model, notices, live } = rig();
    await live.reply(at(41));
    await live.suggest();
    assert.deepEqual(plain(live.view().offer), { thread: 'T2', text: COURIER });
    model.line = RIDER;
    const told = notices.count;
    await live.suggest();
    assert.equal(live.view().offer, null);
    assert.equal(notices.count, told + 1);
    model.line = 'LINE: none';
    await live.suggest();
    assert.equal(live.view().offer, null);
    assert.equal(notices.count, told + 2);
    model.line = `LINE: ${RIDER}`;
    await live.suggest();
    assert.deepEqual(plain(live.view().offer), { thread: 'T1', text: RIDER });
});

test('starting over is told by the edition', async () => {
    const empty = ScribeReplay.run(ScribeLog.create(), storyOrder);
    assert.ok(empty.revision < state.revision);
    const { log } = bookLog(FACTS);
    assert.notEqual(ScribeLog.withdraw(log, 'MESSAGE-30'), null);
    const withdrawn = ScribeReplay.run(log, storyOrder);
    assert.ok(withdrawn.revision > state.revision);
    const { keeper, storage, model, notify, live } = rig();
    await live.reply(at(43));
    live.dismiss(keyOf(live, 'Spelling', 'MESSAGE-43'));
    const before = statuses(live);
    const ready = live.view().ready;
    assert.notEqual(ready, null);
    const saves = storage.count('set');
    for (const fields of [
        { read: 0, state: withdrawn },
        { read: 0, state: empty, trusted: false },
        { read: 0, state: empty, trusted: false, edition: 2 },
        { state: empty },
    ]) {
        keeper.change(fields);
        assert.deepEqual(statuses(live), before, JSON.stringify(Object.keys(fields)));
        assert.equal(live.view().ready, ready);
        assert.equal(live.view().now.place, 'The mill');
        assert.equal(storage.count('set'), saves);
        keeper.change({ read: 40, state, trusted: true, edition: 1 });
    }
    await ticks();
    assert.equal(storage.count('set'), saves);

    await live.suggest();
    live.use(GULL);
    await live.suggest();
    assert.equal(live.view().offer.thread, 'T1');
    keeper.previewer = previewFrom(FACTS);
    await live.tell('Mirelle has black hair.');
    assert.equal(live.view().understood.count, 1);
    keeper.change({ read: 0, state: empty, edition: 2 });
    const startedOver = model.calls.length;
    const restarted = live.view();
    assert.deepEqual(
        plain([
            restarted.findings.length,
            restarted.ready,
            restarted.now,
            restarted.suggestion,
            restarted.offer,
            restarted.understood,
        ]),
        [0, null, null, null, null, null],
    );
    const saved = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
    assert.deepEqual(
        plain([saved.findings.length, saved.dismissed, saved.led, saved.seen, saved.now, saved.suggestion, saved.edition]),
        [0, [], [], null, null, null, 2],
    );
    assert.equal(live.outgoing('I listen.'), 'I listen.');
    keeper.change({ read: 40, state });
    await live.suggest();
    assert.deepEqual(plain(live.view().offer), { thread: 'T1', text: COURIER });
    await live.reply(at(43));
    assert.equal(
        model.calls.slice(startedOver).some((call) => call.role === 'Pedant' && replyOf(call.user) === '43'),
        true,
    );
    assert.equal(live.view().findings.length, 3);

    live.close();
    keeper.change({ edition: 3 });
    const reopened = rig({ edition: 3 }, storage);
    assert.equal(reopened.live.view().findings.length, 0);
    assert.equal(reopened.live.view().now, null);
    reopened.live.close();

    const prior = rig();
    await prior.live.reply(at(43));
    prior.live.close();
    const unmarked = Object.fromEntries(
        Object.entries(ScribeStore.read(prior.storage, ROOM, ScribeStore.Kind.Live)).filter(([name]) => name !== 'edition'),
    );
    const olderStorage = new FakeStorage();
    ScribeStore.write(olderStorage, ROOM, ScribeStore.Kind.Live, unmarked);
    const older = rig({ edition: 4 }, olderStorage);
    assert.equal(older.live.view().findings.length, 3);
    assert.equal(ScribeStore.read(olderStorage, ROOM, ScribeStore.Kind.Live).edition, 4);
    older.keeper.change({ edition: 5 });
    assert.equal(older.live.view().findings.length, 0);

    const flying = rig();
    await flying.live.reply(at(41));
    const release = flying.model.hold('Scribe');
    const pending = flying.live.reply(at(43));
    await ticks();
    flying.keeper.change({ edition: 2 });
    assert.equal(flying.live.view().findings.length, 0);
    release();
    await pending;
    await ticks();
    assert.equal(flying.live.view().findings.length, 0);
    assert.equal(ScribeStore.read(flying.storage, ROOM, ScribeStore.Kind.Live).seen, null);
});

test('a reminder goes out only if it is still true', async () => {
    const { storage, model, live } = rig();
    model.pedant = answer({ CONTRADICTIONS: [] });
    await live.reply(at(41));
    live.outgoing('Onward.');
    live.sent();
    assert.equal(live.view().ready, null);
    model.pedant = answer({ CONTRADICTIONS: [`${AGE} | Halvard | age | forty`] });
    await live.reply(variant(45, [['Narrator', 'Halvard, forty winters old, waits.']], null));
    const old = live.view().ready;
    assert.ok(reminds(old, 'The mill'), old);
    assert.deepEqual(ledOf(storage), [AGE]);
    model.pedant = answer({ CONTRADICTIONS: [] });
    await live.reply(variant(45, [['Narrator', 'Halvard hums by the fire.']], 'OTHER-45'));
    assert.deepEqual(statuses(live), []);
    const renewed = live.view().ready;
    assert.ok(reminds(renewed, 'The mill'), renewed);
    assert.deepEqual(ledOf(storage), []);
    assert.equal(live.outgoing('I listen.'), `I listen.${lineOf(renewed)}`);

    const moved = rig();
    await moved.live.reply(at(41));
    const said = moved.live.view().ready;
    assert.ok(said.includes('"34"'), said);
    const age = keyOf(moved.live, 'Contradiction', 'MESSAGE-41');
    moved.keeper.change({
        state: revised(bookState(FACTS.map((fact) => fact.replace('Halvard | age | 34', 'Halvard | age | forty')))),
    });
    assert.equal(findingOf(moved.live, age).can.spent, true);
    assert.equal(moved.live.outgoing('I raise my cup.'), 'I raise my cup.');
    moved.live.sent();
    assert.equal(statusOf(moved.live, age), 'Open');
    assert.equal(moved.live.view().sends, 1);
    await ticks();
    const fresh = moved.live.view().ready;
    assert.ok(reminds(fresh, 'The mill'), fresh);
    assert.ok(!fresh.includes('"34"'), fresh);
    assert.equal(moved.live.outgoing('Again.'), `Again.${lineOf(fresh)}`);

    const between = rig();
    await between.live.reply(at(41));
    const ageKey = keyOf(between.live, 'Contradiction', 'MESSAGE-41');
    assert.notEqual(between.live.outgoing('I raise my cup.'), 'I raise my cup.');
    between.keeper.change({
        state: revised(bookState(FACTS.map((fact) => fact.replace('Halvard | age | 34', 'Halvard | age | forty')))),
    });
    between.live.sent();
    assert.equal(statusOf(between.live, ageKey), 'Open');
    assert.equal(between.live.view().ready, null);

    const later = rig();
    await later.live.reply(at(41));
    const kept = later.live.view().ready;
    later.live.use(GULL);
    later.keeper.change({ state: revised(state) });
    assert.equal(later.live.outgoing('Hello.'), `Hello.${lineOf(GULL)}`);
    later.keeper.change({ state });
    assert.equal(later.live.outgoing('Hello.'), `Hello.${lineOf(kept)}${lineOf(GULL)}`);

    const moving = rig();
    await moving.live.reply(at(41));
    const mill = moving.live.view().ready;
    breakView(moving.keeper, { messages: story.slice(0, 43) }, 'unread');
    moving.model.scene = TENT;
    await moving.live.reply(at(43));
    assert.equal(moving.live.view().now.place, 'The tent');
    assert.equal(moving.live.view().ready, mill);
    assert.equal(moving.live.outgoing('Hello.'), 'Hello.');
});

test('nothing goes out while the book cannot be trusted', async () => {
    const { keeper, model, live } = rig();
    await live.reply(at(41));
    live.use(GULL);
    const ready = live.view().ready;
    const whole = `Hello.${lineOf(ready)}${lineOf(GULL)}`;
    assert.equal(live.outgoing('Hello.'), whole);
    for (const fields of [
        { trusted: false, mismatch: true },
        { trusted: false, phase: 'NoBook' },
        { trusted: false },
        { trusted: false, reader: false },
    ]) {
        keeper.change(fields);
        assert.equal(live.outgoing('Hello.'), 'Hello.', JSON.stringify(fields));
        live.sent();
        keeper.change(READING);
        assert.equal(live.view().ready, ready);
        assert.equal(live.view().suggestion, GULL);
        assert.equal(live.outgoing('Hello.'), whole);
    }
    for (const stopped of [PAUSED, BUDGET]) {
        keeper.change(stopped);
        const calls = model.calls.length;
        assert.equal(live.outgoing('Hello.'), whole);
        live.view();
        await ticks();
        assert.equal(model.calls.length, calls);
        keeper.change(READING);
    }
});

test('a finding belongs to its reply', async () => {
    const { model, live } = rig();
    await live.reply(at(41));
    live.outgoing('Onward.');
    live.sent();
    model.scene = TENT;
    await live.reply(at(43));
    live.outgoing('Onward.');
    live.sent();
    assert.deepEqual(statuses(live), [
        ['Spelling', 'MESSAGE-43', 'Open'],
        ['Contradiction', 'MESSAGE-43', 'Reminded'],
        ['Leak', 'MESSAGE-43', 'Open'],
        ['Contradiction', 'MESSAGE-41', 'Reminded'],
    ]);
    await live.reply(at(41));
    assert.deepEqual(statuses(live), [['Contradiction', 'MESSAGE-41', 'Reminded']]);
    await live.reply(variant(43, [['Narrator', 'Mirelle laughs.']], 'OTHER-43'));
    assert.deepEqual(statuses(live), [['Contradiction', 'MESSAGE-41', 'Reminded']]);

    const edits = rig();
    await edits.live.reply(at(43));
    const calls = edits.model.calls.length;
    const edited = variant(43, [['Narrator', 'Halvart, his eyes green tonight, whistles again.']], null);
    assert.equal(edited.id, 'MESSAGE-43');
    await edits.live.reply(edited);
    assert.equal(edits.model.calls.length, calls + 2);
    assert.ok(edits.model.calls.at(-1).user.includes('whistles again'));
    assert.deepEqual(statuses(edits.live), [
        ['Spelling', 'MESSAGE-43', 'Open'],
        ['Contradiction', 'MESSAGE-43', 'Open'],
    ]);
    assert.deepEqual(
        plain(edits.live.view().findings.map((finding) => finding.fingerprint === edited.fingerprint)),
        [true, true],
    );

    const span = rig();
    await span.live.reply(at(41));
    span.keeper.pinned = true;
    span.keeper.change({ messages: story.slice(42, 45) });
    await span.live.reply(at(45));
    assert.deepEqual(statuses(span.live), [['Contradiction', 'MESSAGE-41', 'Open']]);
});

test('a checked reply is not paid for twice', async () => {
    const { model, live } = rig();
    await live.reply(at(41));
    model.scene = TENT;
    await live.reply(at(43));
    const calls = model.calls.length;
    await live.reply(at(41));
    assert.equal(model.calls.length, calls);
    assert.equal(live.view().now.place, 'The mill');
    assert.deepEqual(statuses(live), [['Contradiction', 'MESSAGE-41', 'Open']]);

    const swiping = rig();
    const other = variant(41, [['Narrator', 'Halvard, thirty winters old, hums by the fire.']], 'OTHER-41');
    for (const message of [at(41), other, at(41), other, at(41)]) {
        await swiping.live.reply(message);
    }
    assert.deepEqual(
        swiping.model.calls.map((call) => `${call.role}:${replyOf(call.user)}`),
        ['Scribe:', 'Pedant:41', 'Scribe:', 'Pedant:41'],
    );
    assert.deepEqual(statuses(swiping.live), [['Contradiction', 'MESSAGE-41', 'Open']]);
    assert.equal(findingOf(swiping.live, keyOf(swiping.live, 'Contradiction', 'MESSAGE-41')).said, 'forty');
    swiping.keeper.change({ state: revised(state) });
    await swiping.live.reply(other);
    assert.equal(swiping.model.calls.length, 6);
    assert.deepEqual(statuses(swiping.live), [['Contradiction', 'OTHER-41', 'Open']]);

    const moved = rig();
    await moved.live.reply(at(41));
    moved.keeper.change({ state: revised(state) });
    await moved.live.reply(at(41));
    moved.live.view();
    await ticks();
    assert.deepEqual(plain(moved.model.roles()), ['Scribe', 'Pedant']);

    const failed = rig();
    failed.model.failing.add('Scribe');
    await failed.live.reply(at(41));
    assert.equal(failed.live.view().now, null);
    failed.model.failing.delete('Scribe');
    await failed.live.reply(at(43));
    const before = failed.model.calls.length;
    await failed.live.reply(at(41));
    assert.equal(
        failed.model.calls.slice(before).some((call) => call.system === ScribeScene.Prompt),
        true,
    );
    assert.equal(failed.live.view().now.message, 'MESSAGE-41');

    const stored = rig();
    await stored.live.reply(at(43));
    stored.live.close();
    const reopened = rig({}, stored.storage);
    await reopened.live.reply(variant(43, [['Narrator', 'Halvard whistles.']], 'OTHER-43'));
    const paid = reopened.model.calls.length;
    assert.equal(paid, 2);
    await reopened.live.reply(at(43));
    assert.equal(reopened.model.calls.length, paid);
    assert.equal(reopened.live.view().findings.length, 3);
});

test('dismissed stays dismissed', async () => {
    const scratch = rig();
    await scratch.live.reply(at(43));
    const spelling = plain(findingOf(scratch.live, keyOf(scratch.live, 'Spelling', 'MESSAGE-43')));
    delete spelling.can;
    delete spelling.fingerprint;
    const filler = [];
    for (let index = 0; index < 199; index++) {
        filler.push({
            kind: 'Contradiction',
            message: 'MESSAGE-10',
            position: 10,
            subject: HALVARD,
            label: 'Halvard',
            fact: EYES,
            category: 'eyes',
            book: 'grey',
            said: `shade ${index}`,
            key: `filler-${index}`,
            status: 'Dismissed',
        });
    }
    const storage = new FakeStorage();
    ScribeStore.write(storage, ROOM, ScribeStore.Kind.Live, {
        now: null,
        ready: null,
        led: [],
        sends: 0,
        findings: [{ ...spelling, message: 'MESSAGE-5', position: 5, status: 'Dismissed' }, ...filler],
        suggestion: null,
        seen: null,
        reminded: null,
        revision: null,
    });
    const { live } = rig({}, storage);
    assert.equal(live.view().findings.length, 200);
    await live.reply(at(43));
    assert.equal(live.view().findings.length, 200);
    assert.equal(live.view().findings.some((finding) => finding.fault === spelling.fault), false);
    /**
     * @return {string[][]}
     */
    const open = () =>
        plain(
            live
                .view()
                .findings.filter((finding) => finding.status === 'Open')
                .map((finding) => [finding.kind, finding.message]),
        );
    assert.deepEqual(open(), [
        ['Contradiction', 'MESSAGE-43'],
        ['Leak', 'MESSAGE-43'],
    ]);
    await live.reply(at(49));
    assert.deepEqual(open(), [
        ['Contradiction', 'MESSAGE-43'],
        ['Leak', 'MESSAGE-43'],
    ]);
    assert.equal(live.view().findings.length, 200);
    assert.ok(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).dismissed.includes(spelling.fault));
    live.close();
    const again = rig({}, storage);
    await again.live.reply(variant(51, [['Narrator', 'Halvart nods once more.']], null));
    assert.equal(
        again.live.view().findings.some((finding) => finding.kind === 'Spelling' && finding.status === 'Open'),
        false,
    );
    assert.equal(again.model.calls.length > 0, true);

    const crowded = new FakeStorage();
    ScribeStore.write(crowded, ROOM, ScribeStore.Kind.Live, {
        findings: [],
        sends: 0,
        dismissed: Array.from({ length: 600 }, (unused, index) => `old-${index}`),
    });
    const capped = rig({}, crowded);
    await capped.live.reply(at(43));
    const keptKeys = ScribeStore.read(crowded, ROOM, ScribeStore.Kind.Live).dismissed;
    assert.deepEqual(plain([keptKeys.length, keptKeys[0], keptKeys.at(-1)]), [500, 'old-100', 'old-599']);
    const leak = keyOf(capped.live, 'Leak', 'MESSAGE-43');
    const leakFault = findingOf(capped.live, leak).fault;
    capped.live.dismiss(leak);
    const later = ScribeStore.read(crowded, ROOM, ScribeStore.Kind.Live).dismissed;
    assert.deepEqual(plain([later.length, later[0], later.at(-1)]), [500, 'old-101', leakFault]);
});

test('no model call while the keeper is not reading', async () => {
    for (const [fields, refused] of [
        [PAUSED, STOPPED],
        [BUDGET, STOPPED],
        [{ trusted: false, phase: 'NoBook' }, UNTRUSTED],
        [{ trusted: false, mismatch: true }, UNTRUSTED],
    ]) {
        const { keeper, model, live } = rig(fields);
        for (const position of [41, 43, 45, 47, 49]) {
            await live.reply(at(position));
        }
        assert.equal(model.calls.length, 0);
        await assert.rejects(live.suggest(), refused);
        await assert.rejects(live.another(), refused);
        await assert.rejects(live.tell('Mirelle has black hair.'), refused);
        live.view();
        await ticks();
        assert.equal(model.calls.length, 0);
        assert.equal(live.view().now, null);
        keeper.change(READING);
        live.view();
        await ticks();
        assert.deepEqual(
            model.calls.map((call) => `${call.role}:${replyOf(call.user)}`),
            ['Scribe:', 'Pedant:49'],
        );
        live.view();
        await ticks();
        assert.equal(model.calls.length, 2);
        assert.equal(live.view().now.message, 'MESSAGE-49');
    }

    const midway = rig();
    const release = midway.model.hold('Scribe');
    const pending = midway.live.reply(at(41));
    await ticks();
    midway.keeper.change(PAUSED);
    release();
    await pending;
    assert.deepEqual(plain(midway.model.roles()), ['Scribe']);
    assert.equal(midway.live.view().findings.length, 0);
    assert.equal(midway.live.view().now, null);
    midway.keeper.change(READING);
    midway.live.view();
    await ticks();
    assert.deepEqual(plain(midway.model.roles()), ['Scribe', 'Scribe', 'Pedant']);
    assert.equal(midway.live.view().findings.length, 1);

    const moved = rig();
    await moved.live.reply(at(41));
    moved.keeper.change(PAUSED);
    await moved.live.reply(at(43));
    moved.keeper.change(READING);
    await moved.live.reply(at(45));
    moved.live.view();
    await ticks();
    assert.deepEqual(
        moved.model.calls.map((call) => `${call.role}:${replyOf(call.user)}`),
        ['Scribe:', 'Pedant:41', 'Scribe:', 'Pedant:45'],
    );

    const passed = rig(PAUSED);
    await passed.live.reply(at(41));
    passed.keeper.change({ ...READING, messages: story.slice(0, 43) });
    passed.live.view();
    await ticks();
    assert.deepEqual(
        passed.model.calls.map((call) => `${call.role}:${replyOf(call.user)}`),
        ['Scribe:', 'Pedant:43'],
    );
    passed.keeper.change({ messages: story.slice(0, 41) });
    passed.live.view();
    await ticks();
    assert.deepEqual(
        passed.model.calls.map((call) => `${call.role}:${replyOf(call.user)}`),
        ['Scribe:', 'Pedant:43', 'Scribe:', 'Pedant:41'],
    );

    const known = rig();
    await known.live.reply(at(41));
    await known.live.reply(at(43));
    const held = statuses(known.live);
    const saves = known.storage.count('set');
    known.keeper.change({ trusted: false });
    await known.live.reply(at(41));
    known.keeper.change(PAUSED);
    await known.live.reply(at(41));
    assert.equal(known.storage.count('set'), saves);
    assert.deepEqual(statuses(known.live), held);
});

test('one of each at a time', async () => {
    const { keeper, live } = rig();
    keeper.previewer = previewFrom(FACTS);
    await live.tell('Mirelle has black hair.');
    const confirms = await Promise.allSettled([live.confirm(), live.confirm()]);
    assert.deepEqual(
        confirms.map((result) => result.status),
        ['fulfilled', 'rejected'],
    );
    assert.match(String(confirms[1].reason), BUSY);
    assert.equal(keeper.filed.length, 1);
    assert.equal(keeper.previews.length, 2);
    assert.equal(live.view().understood, null);
    await live.confirm();
    assert.equal(keeper.filed.length, 1);

    const lost = rig();
    lost.keeper.previewer = previewFrom(FACTS);
    await lost.live.tell('Mirelle has black hair.');
    let land = null;
    lost.keeper.filing = new Promise((resolve) => {
        land = resolve;
    });
    const filing = lost.live.confirm();
    await ticks();
    assert.equal(lost.keeper.filed.length, 1);
    lost.keeper.change({ reader: false, trusted: false });
    land();
    await filing;
    lost.keeper.change(READING);
    await lost.live.confirm();
    assert.equal(lost.keeper.filed.length, 1);
    assert.equal(lost.live.view().understood, null);

    const ruling = rig();
    await ruling.live.reply(at(43));
    const leak = keyOf(ruling.live, 'Leak', 'MESSAGE-43');
    const tolds = await Promise.allSettled([ruling.live.told(leak), ruling.live.told(leak)]);
    assert.deepEqual(
        tolds.map((result) => result.status),
        ['fulfilled', 'rejected'],
    );
    assert.match(String(tolds[1].reason), BUSY);
    assert.equal(ruling.keeper.ruled.length, 1);
    assert.equal(statusOf(ruling.live, leak), 'Told');
    await ruling.live.told(leak);
    assert.equal(ruling.keeper.ruled.length, 1);

    const offering = rig();
    await offering.live.reply(at(41));
    const offers = await Promise.allSettled([offering.live.suggest(), offering.live.another()]);
    assert.deepEqual(
        offers.map((result) => result.status),
        ['fulfilled', 'rejected'],
    );
    assert.match(String(offers[1].reason), BUSY);
    assert.equal(offering.model.calls.filter((call) => call.system === ScribeMuse.SuggestPrompt).length, 1);
    assert.deepEqual(plain(offering.live.view().offer), { thread: 'T2', text: COURIER });
    await offering.live.another();
    assert.equal(offering.model.calls.filter((call) => call.system === ScribeMuse.SuggestPrompt).length, 2);

    const telling = rig();
    telling.keeper.previewer = previewFrom(FACTS);
    const release = telling.model.hold('Analyzer');
    const older = telling.live.tell('Mirelle has black hair.');
    await ticks();
    await assert.rejects(telling.live.tell('Mirelle has red hair.'), BUSY);
    release();
    await older;
    assert.ok(telling.live.view().understood.lines.some((line) => line.includes('black')));
    assert.equal(telling.model.calls.length, 1);
    telling.model.understood = answer({ FACTS: ['Mirelle | hair | red | #40'] });
    await telling.live.tell('Mirelle has red hair.');
    assert.ok(telling.live.view().understood.lines.some((line) => line.includes('red')));
});

test('confirm files what was shown', async () => {
    const anchor = { id: 'MESSAGE-40', position: 40 };
    const { keeper, model, live } = rig();
    keeper.previewer = previewFrom(FACTS);
    await live.tell('Mirelle has black hair.');
    keeper.change({ lastRead: { id: 'MESSAGE-41', position: 41 } });
    await live.confirm();
    assert.equal(keeper.filed.length, 1);
    assert.deepEqual(plain(keeper.filed[0].anchor), anchor);
    keeper.change({ lastRead: anchor });

    await live.tell('Mirelle has black hair.');
    const shown = plain(live.view().understood.lines);
    const red = ScribeAnswer.parse(answer({ FACTS: ['Mirelle | hair | red | #40'] })).operations;
    keeper.previewer = () => {
        const seen = previewFrom(FACTS)(red);
        return { ...seen, refused: [{ operation: null, reason: 'Held back' }] };
    };
    await live.confirm();
    assert.equal(keeper.filed.length, 1);
    const fresh = plain(live.view().understood.lines);
    assert.equal(fresh.length, shown.length);
    assert.notDeepEqual(fresh, shown);
    assert.deepEqual(plain(live.view().understood.refused.map((item) => item.reason)), ['Held back']);
    keeper.previewer = previewFrom(FACTS);
    live.forget();

    await live.tell('Mirelle has black hair.');
    let open = null;
    keeper.gate = new Promise((resolve) => {
        open = resolve;
    });
    const confirming = live.confirm();
    await ticks();
    model.understood = answer({ FACTS: ['Mirelle | hair | red | #40'] });
    await live.tell('Mirelle has red hair.');
    open();
    await confirming;
    assert.equal(keeper.filed.length, 1);
    assert.ok(live.view().understood.lines.some((line) => line.includes('red')));
    await live.confirm();
    assert.equal(keeper.filed.length, 2);
    assert.deepEqual(
        plain(keeper.filed[1].operations.map((operation) => operation.text)),
        ['red'],
    );

    await live.tell('Mirelle has red hair.');
    assert.notEqual(live.view().understood, null);
    await live.tell('   \n ');
    assert.equal(live.view().understood, null);

    const release = model.hold('Analyzer');
    const telling = live.tell('Mirelle has red hair.');
    await ticks();
    keeper.change({ lastRead: { id: 'MESSAGE-41', position: 41 } });
    release();
    await telling;
    assert.deepEqual(plain(keeper.previews.at(-1).anchor), anchor);
    keeper.change({ lastRead: anchor });

    await live.reply(at(43));
    const leak = keyOf(live, 'Leak', 'MESSAGE-43');
    await live.tell('Mirelle has red hair.');
    const previews = keeper.previews.length;
    for (const [fields, refused] of [
        [{ reader: false, trusted: false }, /^Error: Another tab is reading this chat$/],
        [{ reader: true, trusted: false }, UNTRUSTED],
    ]) {
        keeper.change(fields);
        await live.told(leak);
        await assert.rejects(live.confirm(), refused);
        assert.equal(keeper.ruled.length, 0);
        assert.equal(keeper.filed.length, 2);
        assert.equal(keeper.previews.length, previews);
    }
    keeper.change(READING);
    assert.equal(statusOf(live, leak), 'Open');
});

test('a failed read is not an empty record', async () => {
    const first = rig();
    await first.live.reply(at(43));
    first.live.dismiss(keyOf(first.live, 'Spelling', 'MESSAGE-43'));
    first.live.outgoing('Onward.');
    first.live.sent();
    first.live.close();
    const storage = first.storage;
    /**
     * @return {string[][]}
     */
    const stored = () =>
        plain(
            ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).findings.map((finding) => [
                finding.kind,
                finding.status,
            ]),
        );
    const before = stored();
    assert.deepEqual(before, [
        ['Spelling', 'Dismissed'],
        ['Contradiction', 'Reminded'],
        ['Leak', 'Open'],
    ]);
    storage.refuseGetsMatching(/live/);
    const { model, live } = rig({}, storage);
    assert.equal(typeof live.view().problem, 'string');
    assert.equal(live.view().findings.length, 0);
    const saves = storage.count('set');
    await live.reply(at(45));
    live.dismiss('none');
    live.outgoing('Hello.');
    live.sent();
    assert.equal(storage.count('set'), saves);
    assert.equal(model.calls.length, 0);
    storage.allow();
    assert.equal(stored().length, 3);
    await live.reply(at(47));
    assert.ok(model.calls.length > 0);
    assert.deepEqual(stored().slice(-3), before);
    assert.equal(
        live.view().findings.some((finding) => finding.kind === 'Spelling' && finding.status === 'Open'),
        false,
    );

    const old = rig();
    await old.live.reply(at(41));
    await old.live.reply(at(43));
    old.live.dismiss(keyOf(old.live, 'Spelling', 'MESSAGE-43'));
    old.live.close();
    const saved = ScribeStore.read(old.storage, ROOM, ScribeStore.Kind.Live);
    const ancient = new FakeStorage();
    ScribeStore.write(ancient, ROOM, ScribeStore.Kind.Live, {
        now: saved.now,
        ready: null,
        sends: 0,
        findings: saved.findings.map((finding, index) => {
            const { fingerprint, ...rest } = finding;
            return { ...rest, correction: '[Scribe] Correction: x', status: index === 1 ? 'Corrected' : finding.status };
        }),
        corrections: ['[Scribe] Correction: x'],
        suggestion: null,
        seen: { id: saved.seen.id, fingerprint: saved.seen.fingerprint, position: saved.seen.position, before: null },
        reminded: saved.reminded,
    });
    const reopened = rig({}, ancient);
    assert.equal(reopened.live.view().problem, null);
    assert.deepEqual(statuses(reopened.live), [
        ['Spelling', 'MESSAGE-43', 'Dismissed'],
        ['Contradiction', 'MESSAGE-43', 'Corrected'],
        ['Leak', 'MESSAGE-43', 'Open'],
        ['Contradiction', 'MESSAGE-41', 'Open'],
    ]);
    assert.equal(reopened.live.view().now.place, 'The mill');
});

test('a saved record cannot make the view throw', async () => {
    const base = { now: null, ready: null, led: [], sends: 0, findings: [], suggestion: null, seen: null, reminded: null };
    for (const record of [
        { ...base, now: {}, reminded: {} },
        {
            ...base,
            findings: [
                { key: 'k1', kind: 'Spelling', status: 'Open', message: 'MESSAGE-41', position: 41, subject: HALVARD, label: 'Halvard' },
                null,
            ],
        },
        { ...base, now: { day: 1, reach: 'Private', present: [] } },
        { ...base, seen: { id: 'MESSAGE-41', fingerprint: 'other', position: 41, before: 'garbage' } },
        { ...base, sends: -3 },
        { ...base, led: 'F1', ready: 7, basis: 'x', checked: [null, { id: 'MESSAGE-41' }], dismissed: [3] },
    ]) {
        const storage = new FakeStorage();
        ScribeStore.write(storage, ROOM, ScribeStore.Kind.Live, record);
        const { model, live } = rig({}, storage);
        const view = live.view();
        const named = JSON.stringify(record).slice(0, 60);
        assert.equal(view.problem, null, named);
        assert.equal(view.findings.length, 0, named);
        assert.equal(view.now, null, named);
        assert.equal(view.sends, 0, named);
        assert.equal(view.ready, null, named);
        await live.reply(at(41));
        assert.deepEqual(plain(model.roles()), ['Scribe', 'Pedant'], named);
        assert.equal(live.view().now.place, 'The mill', named);
        assert.ok(reminds(live.view().ready, 'The mill'), named);
        assert.deepEqual(statuses(live), [['Contradiction', 'MESSAGE-41', 'Open']], named);
    }
});

test('only a blank message is blank', async () => {
    const { live } = rig();
    await live.reply(at(41));
    const blank = String.fromCodePoint(0x85, 0xa0, 0x200b, 0x2028);
    for (const text of [blank, `  ${String.fromCodePoint(0x85)}  `, String.fromCodePoint(0xfeff, 0x2029, 0x3000, 0x9)]) {
        assert.ok(live.outgoing(text) === text);
    }
    assert.equal(live.outgoing(`${blank}x`), `${blank}x${lineOf(live.view().ready)}`);
});

test('only a higher edition is a new book', async () => {
    const { keeper, storage, live } = rig();
    await live.reply(at(43));
    const spelling = keyOf(live, 'Spelling', 'MESSAGE-43');
    const fault = findingOf(live, spelling).fault;
    live.dismiss(spelling);
    live.use(GULL);
    const before = statuses(live);
    const ready = live.view().ready;
    assert.notEqual(ready, null);
    const saves = storage.count('set');
    for (const edition of [0, 1]) {
        keeper.change({ edition });
        assert.deepEqual(statuses(live), before, `edition ${edition}`);
        assert.equal(live.view().ready, ready);
        assert.equal(live.view().suggestion, GULL);
        assert.equal(storage.count('set'), saves);
        const kept = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
        assert.deepEqual(plain([kept.edition, kept.dismissed]), [1, [fault]]);
    }
    await live.reply(at(49));
    assert.equal(
        live.view().findings.some((finding) => finding.kind === 'Spelling' && finding.status === 'Open'),
        false,
    );

    keeper.change({ edition: 2 });
    const restarted = live.view();
    assert.deepEqual(plain([restarted.findings.length, restarted.ready, restarted.suggestion]), [0, null, null]);
    const saved = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
    assert.deepEqual(plain([saved.edition, saved.dismissed, saved.findings.length]), [2, [], 0]);
});

test('an older reply edited loses its findings at once', async () => {
    const { keeper, storage, model, live } = rig();
    await live.reply(at(41));
    model.pedant = answer({ CONTRADICTIONS: [] });
    await live.reply(at(43));
    assert.deepEqual(statuses(live), [
        ['Spelling', 'MESSAGE-43', 'Open'],
        ['Contradiction', 'MESSAGE-41', 'Open'],
    ]);
    assert.deepEqual(ledOf(storage), [AGE]);
    const edited = variant(41, [['Narrator', 'Halvard, thirty-four winters old, hums by the fire.']], null);
    keeper.change({
        messages: keeper.current.messages.map((message) => (message.id === 'MESSAGE-41' ? edited : message)),
    });
    live.view();
    assert.deepEqual(statuses(live), [['Spelling', 'MESSAGE-43', 'Open']]);
    assert.deepEqual(
        plain(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).findings.map((finding) => finding.message)),
        ['MESSAGE-43'],
    );
    assert.equal(live.outgoing('I raise my cup.'), 'I raise my cup.');
    live.sent();
    assert.equal(
        live.view().findings.some((finding) => finding.status === 'Reminded'),
        false,
    );
    await ticks();
    const renewed = live.view().ready;
    assert.deepEqual(ledOf(storage), []);
    assert.equal(live.outgoing('Again.'), `Again.${lineOf(renewed)}`);
});

test('the same fault in two replies is two findings', async () => {
    const { keeper, live } = rig();
    await live.reply(variant(41, [['Narrator', 'Halvart hums by the fire.']], null));
    await live.reply(at(43));
    const later = keyOf(live, 'Spelling', 'MESSAGE-43');
    const earlier = keyOf(live, 'Spelling', 'MESSAGE-41');
    assert.notEqual(later, earlier);
    assert.equal(findingOf(live, later).fault, findingOf(live, earlier).fault);
    const fault = findingOf(live, later).fault;

    const fixed = variant(41, [['Narrator', 'Halvard hums by the fire.']], null);
    keeper.change({
        messages: keeper.current.messages.map((message) => (message.id === 'MESSAGE-41' ? fixed : message)),
    });
    assert.equal(statusOf(live, later), 'Open');
    assert.equal(findingOf(live, earlier), undefined);

    const both = rig();
    await both.live.reply(variant(41, [['Narrator', 'Halvart hums by the fire.']], null));
    await both.live.reply(at(43));
    const one = keyOf(both.live, 'Spelling', 'MESSAGE-43');
    const other = keyOf(both.live, 'Spelling', 'MESSAGE-41');
    both.live.dismiss(one);
    assert.deepEqual(plain([statusOf(both.live, one), statusOf(both.live, other)]), ['Dismissed', 'Dismissed']);
    assert.deepEqual(plain(ScribeStore.read(both.storage, ROOM, ScribeStore.Kind.Live).dismissed), [fault]);
});

test('one told at a time', async () => {
    const { keeper, model, live } = rig();
    model.pedant = answer({ LEAKS: [`${BUILD} | Mirelle | Your scars ache`] });
    await live.reply(at(43));
    await live.reply(variant(45, [['Mirelle', 'Your scars ache again, Orla.']], null));
    const first = keyOf(live, 'Leak', 'MESSAGE-43');
    const second = keyOf(live, 'Leak', 'MESSAGE-45');
    const results = await Promise.allSettled([live.told(first), live.told(second)]);
    assert.deepEqual(
        results.map((result) => result.status),
        ['fulfilled', 'rejected'],
    );
    assert.match(String(results[1].reason), BUSY);
    assert.equal(keeper.ruled.length, 1);
    assert.equal(statusOf(live, first), 'Told');
    assert.equal(statusOf(live, second), 'Open');
});

test('a result for an untrusted book is thrown away', async () => {
    const big = bookState(BIG);
    const refreshing = rig({ state: big });
    await refreshing.live.reply(at(41));
    assert.equal(chooses(refreshing.model), 1);
    const release = refreshing.model.holdSystem(ScribeReminder.ChoosePrompt);
    refreshing.keeper.change({ state: revised(bookState(BIG.map((fact) => fact.replace('skin | pale', 'skin | dark')))) });
    refreshing.live.view();
    await ticks();
    assert.equal(chooses(refreshing.model), 2);
    const saves = refreshing.storage.count('set');
    const ready = refreshing.live.view().ready;
    const told = refreshing.notices.count;
    refreshing.keeper.change({ trusted: false });
    release();
    await ticks();
    assert.equal(refreshing.storage.count('set'), saves);
    assert.equal(refreshing.notices.count, told);
    assert.equal(refreshing.live.view().ready, ready);

    const replying = rig({ state: big });
    await replying.live.reply(at(41));
    replying.live.outgoing('One.');
    replying.live.sent();
    const before = statuses(replying.live);
    const hold = replying.model.holdSystem(ScribeReminder.ChoosePrompt);
    const pending = replying.live.reply(at(43));
    await ticks();
    const quiet = replying.storage.count('set');
    const notices = replying.notices.count;
    replying.keeper.change({ trusted: false, mismatch: true });
    hold();
    await pending;
    await ticks();
    assert.equal(replying.storage.count('set'), quiet);
    assert.equal(replying.notices.count, notices);
    assert.deepEqual(statuses(replying.live), before);
    assert.equal(replying.live.view().now.message, 'MESSAGE-41');
    replying.keeper.change(READING);
    replying.live.view();
    await ticks();
    assert.equal(replying.live.view().findings.some((finding) => finding.message === 'MESSAGE-43'), true);

    const offering = rig();
    await offering.live.reply(at(41));
    const offerGate = offering.model.holdSystem(ScribeMuse.SuggestPrompt);
    const suggesting = offering.live.suggest();
    await ticks();
    const offerNotices = offering.notices.count;
    offering.keeper.change({ trusted: false });
    offerGate();
    await suggesting;
    assert.equal(offering.notices.count, offerNotices);
    offering.keeper.change(READING);
    assert.equal(offering.live.view().offer, null);

    const telling = rig();
    telling.keeper.previewer = previewFrom(FACTS);
    const tellGate = telling.model.hold('Analyzer');
    const pendingTell = telling.live.tell('Mirelle has black hair.');
    await ticks();
    const tellNotices = telling.notices.count;
    telling.keeper.change({ trusted: false });
    tellGate();
    await pendingTell;
    assert.equal(telling.notices.count, tellNotices);
    assert.equal(telling.keeper.previews.length, 0);
    telling.keeper.change(READING);
    assert.equal(telling.live.view().understood, null);

    let previewed = null;
    telling.keeper.gate = new Promise((resolve) => {
        previewed = resolve;
    });
    const foreseeing = telling.live.tell('Mirelle has black hair.');
    await ticks();
    assert.equal(telling.keeper.previews.length, 1);
    const previewNotices = telling.notices.count;
    telling.keeper.change({ trusted: false });
    previewed();
    await foreseeing;
    assert.equal(telling.notices.count, previewNotices);
    telling.keeper.change(READING);
    assert.equal(telling.live.view().understood, null);
});

test('confirm checks trust before it files', async () => {
    const { keeper, live } = rig();
    keeper.previewer = previewFrom(FACTS);
    await live.tell('Mirelle has black hair.');
    keeper.change({ trusted: false });
    await assert.rejects(live.confirm(), UNTRUSTED);
    assert.equal(keeper.filed.length, 0);
    assert.equal(keeper.previews.length, 1);
    assert.equal(live.view().understood.count, 1);

    keeper.change(READING);
    let open = null;
    keeper.gate = new Promise((resolve) => {
        open = resolve;
    });
    const confirming = live.confirm();
    await ticks();
    keeper.change({ trusted: false, mismatch: true });
    open();
    await assert.rejects(confirming, UNTRUSTED);
    assert.equal(keeper.filed.length, 0);
    assert.equal(live.view().understood.count, 1);
    keeper.change(READING);
    await live.confirm();
    assert.equal(keeper.filed.length, 1);
});

test('what was dismissed stays dismissed in memory', async () => {
    const { storage, model, live } = rig();
    await live.reply(at(43));
    const spelling = keyOf(live, 'Spelling', 'MESSAGE-43');
    const fault = findingOf(live, spelling).fault;
    live.dismiss(spelling);
    await live.reply(variant(43, [['Narrator', 'Halvard whistles.']], 'OTHER-43'));
    assert.equal(findingOf(live, spelling), undefined);
    const calls = model.calls.length;
    await live.reply(at(43));
    assert.equal(model.calls.length, calls);
    assert.equal(statusOf(live, spelling), 'Dismissed');
    assert.deepEqual(
        plain(live.view().findings.filter((finding) => finding.status === 'Open').map((finding) => finding.kind)),
        ['Contradiction', 'Leak'],
    );
    assert.ok(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).dismissed.includes(fault));
});

const BUDGET_WORDS = "The day's budget is spent: replies are not checked and no new reminder is made until tomorrow.";

/**
 * @param {object} model
 * @return {string[]}
 */
function asked(model) {
    return plain(model.calls.map((call) => `${call.role}:${replyOf(call.user)}`));
}

test('the newest reply is checked without an event', async () => {
    const { keeper, model, live } = rig({ ...PAUSED, messages: story.slice(0, 43) });
    live.view();
    await ticks();
    assert.deepEqual(asked(model), []);
    keeper.change(READING);
    live.view();
    await ticks();
    assert.deepEqual(asked(model), ['Scribe:', 'Pedant:43']);
    live.view();
    live.outgoing('Hello.');
    live.view();
    await ticks();
    assert.deepEqual(asked(model), ['Scribe:', 'Pedant:43']);
    assert.equal(live.view().now.message, 'MESSAGE-43');

    const failing = rig({ messages: story.slice(0, 43) });
    failing.model.failing.add('Scribe');
    failing.model.failing.add('Pedant');
    failing.live.view();
    await ticks();
    assert.deepEqual(asked(failing.model), ['Scribe:', 'Pedant:43']);
    failing.live.view();
    await ticks();
    assert.deepEqual(asked(failing.model), ['Scribe:', 'Pedant:43']);
    failing.model.failing.clear();
    failing.keeper.change({ state: revised(state) });
    failing.live.view();
    await ticks();
    assert.deepEqual(asked(failing.model), ['Scribe:', 'Pedant:43']);
    failing.keeper.change({ edition: 2 });
    failing.live.view();
    await ticks();
    assert.deepEqual(asked(failing.model), ['Scribe:', 'Pedant:43', 'Scribe:', 'Pedant:43']);
    assert.equal(failing.live.view().now.message, 'MESSAGE-43');
    failing.live.view();
    await ticks();
    assert.equal(failing.model.calls.length, 4);

    const loading = rig({ messages: story.slice(0, 43), phase: 'Loading', stop: PAUSED.stop });
    loading.live.view();
    await ticks();
    assert.deepEqual(asked(loading.model), []);
    loading.keeper.change({ phase: 'Idle', stop: { reason: 'Done', problem: null } });
    loading.live.view();
    await ticks();
    assert.deepEqual(asked(loading.model), ['Scribe:', 'Pedant:43']);

    const refused = rig({ messages: story.slice(0, 43), trusted: false });
    refused.live.view();
    await ticks();
    assert.deepEqual(asked(refused.model), []);
    refused.keeper.change({ trusted: true });
    refused.live.view();
    await ticks();
    assert.deepEqual(asked(refused.model), ['Scribe:', 'Pedant:43']);
});

test('the chooser is not asked the same twice', async () => {
    const big = bookState(BIG);
    const { keeper, model, live } = rig({ state: big });
    await live.reply(at(41));
    assert.equal(chooses(model), 1);
    await live.reply(variant(41, [['Narrator', 'Halvard, thirty winters old, hums a sad tune.']], 'OTHER-41'));
    assert.equal(chooses(model), 2);
    const back = model.calls.length;
    await live.reply(at(41));
    assert.equal(model.calls.length, back);
    assert.equal(chooses(model), 2);
    assert.notEqual(live.view().ready, null);
    keeper.change({ edition: 2 });
    live.view();
    await ticks();
    const restarted = chooses(model);
    assert.equal(restarted, 3);
    assert.equal(live.view().now.message, 'MESSAGE-41');

    const many = rig({ state: big });
    const versions = [];
    for (let index = 0; index < 17; index++) {
        versions.push(variant(41, [['Narrator', `Halvard hums tune ${index}.`]], `V-${index}`));
    }
    for (const version of versions) {
        await many.live.reply(version);
    }
    assert.equal(chooses(many.model), 17);
    await many.live.reply(versions[16]);
    assert.equal(chooses(many.model), 17);
    await many.live.reply(versions[1]);
    assert.equal(chooses(many.model), 17);
    await many.live.reply(versions[0]);
    assert.equal(chooses(many.model), 18);
});

test('a spent budget is said', async () => {
    const { keeper, model, notices, live } = rig();
    await live.reply(at(41));
    const ready = live.view().ready;
    assert.notEqual(ready, null);
    keeper.change({ spentToday: 3 });
    const calls = model.calls.length;
    const told = notices.count;
    await live.reply(at(43));
    assert.equal(notices.count, told + 1);
    live.view();
    await ticks();
    assert.equal(model.calls.length, calls);
    assert.equal(live.view().problem, BUDGET_WORDS);
    assert.equal(live.outgoing('Hello.'), `Hello.${lineOf(ready)}`);
    await assert.rejects(live.suggest(), /^Error: The day's budget is spent: /);
    assert.equal(model.calls.length, calls);
    keeper.change({ spentToday: 2.5 });
    assert.equal(live.view().problem, null);
    await ticks();
    assert.deepEqual(asked(model).slice(-2), ['Scribe:', 'Pedant:43']);
    assert.equal(live.view().problem, null);
});

test('a refused call is said', async () => {
    const big = bookState(BIG);
    for (const [system, words, role] of [
        [ScribeScene.Prompt, 'The scene was refused', 'Scribe'],
        [ScribePedant.Prompt, 'The check was refused', 'Pedant'],
        [ScribeReminder.ChoosePrompt, "The day's budget is spent", 'Scribe'],
    ]) {
        const { model, live } = rig({ state: big });
        model.refusals.set(system, words);
        await live.reply(at(41));
        assert.equal(live.view().problem, words, words);
        assert.equal(model.calls.filter((call) => call.system === system && call.role === role).length, 1, words);
    }
    const scene = rig();
    scene.model.refusals.set(ScribeScene.Prompt, 'The scene was refused');
    await scene.live.reply(at(41));
    assert.equal(scene.live.view().now, null);

    const noticed = rig();
    await noticed.live.reply(at(41));
    noticed.live.outgoing('Onward.');
    noticed.live.sent();
    noticed.model.refusals.set(ScribePedant.Prompt, 'The check was refused');
    noticed.live.view();
    const counted = noticed.notices.count;
    await noticed.live.reply(at(45));
    assert.equal(noticed.live.view().problem, 'The check was refused');
    assert.equal(noticed.notices.count > counted, true);
});

test('a step ending never undoes the player', async () => {
    const big = bookState(BIG);
    const { keeper, model, storage, live } = rig({ state: big });
    await live.reply(at(41));
    live.use(GULL);
    const age = keyOf(live, 'Contradiction', 'MESSAGE-41');
    model.scene = TENT;
    const release = model.holdSystem(ScribeReminder.ChoosePrompt);
    const pending = live.reply(at(43));
    await ticks();
    assert.equal(chooses(model), 2);
    assert.equal(live.outgoing('I wave.').includes(lineOf(GULL)), true);
    live.sent();
    live.dismiss(age);
    keeper.change({ trusted: false, mismatch: true });
    release();
    await pending;
    keeper.change(READING);
    assert.equal(live.view().suggestion, null);
    assert.equal(statusOf(live, age), 'Dismissed');
    assert.equal(live.outgoing('Again.').includes(GULL), false);
    await ticks();
    assert.equal(live.view().now.place, 'The tent');
    assert.equal(live.view().suggestion, null);
    assert.equal(statusOf(live, age), 'Dismissed');
    const stored = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
    assert.equal(stored.suggestion, null);
    assert.deepEqual(
        plain(stored.findings.filter((finding) => finding.key === age).map((finding) => finding.status)),
        ['Dismissed'],
    );
    live.close();
    const reopened = rig({ state: big }, storage);
    assert.equal(reopened.live.view().suggestion, null);
    assert.equal(statusOf(reopened.live, age), 'Dismissed');
    assert.equal(reopened.live.outgoing('Hello.').includes(GULL), false);

    const steady = rig({ state: big });
    await steady.live.reply(variant(41, [['Narrator', 'Halvart, forty winters old, hums by the fire.']], null));
    steady.live.use(GULL);
    const spelt = keyOf(steady.live, 'Spelling', 'MESSAGE-41');
    const steadyAge = keyOf(steady.live, 'Contradiction', 'MESSAGE-41');
    steady.model.scene = TENT;
    const free = steady.model.holdSystem(ScribeReminder.ChoosePrompt);
    const going = steady.live.reply(at(43));
    await ticks();
    assert.equal(steady.live.outgoing('I wave.').includes(lineOf(GULL)), true);
    steady.live.sent();
    steady.live.dismiss(spelt);
    steady.live.dismiss(steadyAge);
    free();
    await going;
    assert.equal(steady.live.view().now.place, 'The tent');
    assert.equal(steady.live.view().suggestion, null);
    assert.equal(statusOf(steady.live, steadyAge), 'Dismissed');
    assert.equal(statusOf(steady.live, spelt), 'Dismissed');
    assert.equal(statusOf(steady.live, keyOf(steady.live, 'Contradiction', 'MESSAGE-43')), 'Open');
    assert.equal(
        steady.live.view().findings.some((finding) => finding.kind === 'Spelling' && finding.message === 'MESSAGE-43'),
        false,
    );
    assert.equal(steady.live.view().ready, null);
});

test("a failure's words are shown for every kind of step", async () => {
    const offering = rig();
    await offering.live.reply(at(41));
    offering.model.refusals.set(ScribeMuse.SuggestPrompt, 'The suggestion was refused');
    await offering.live.suggest();
    assert.equal(offering.live.view().problem, 'The suggestion was refused');

    const telling = rig();
    telling.model.refusals.set(ScribeAnalyzer.NotesPrompt, 'The words were refused');
    await telling.live.tell('Mirelle has black hair.');
    assert.equal(telling.live.view().problem, 'The words were refused');

    const big = bookState(BIG);
    const renewing = rig({ state: big });
    await renewing.live.reply(at(41));
    assert.equal(renewing.live.view().problem, null);
    renewing.model.refusals.set(ScribeReminder.ChoosePrompt, 'The choice was refused');
    renewing.keeper.change({ state: revised(bookState(BIG.map((fact) => fact.replace('skin | pale', 'skin | dark')))) });
    renewing.live.view();
    await ticks();
    assert.equal(chooses(renewing.model), 2);
    assert.equal(renewing.live.view().problem, 'The choice was refused');
});

test('a thrown-away step leaves no problem', async () => {
    const big = bookState(BIG);
    const { keeper, model, live } = rig({ state: big });
    await live.reply(at(41));
    assert.equal(live.view().problem, null);
    model.refusals.set(ScribePedant.Prompt, 'The check was refused');
    model.scene = TENT;
    const release = model.holdSystem(ScribeReminder.ChoosePrompt);
    const pending = live.reply(at(43));
    await ticks();
    assert.equal(chooses(model), 2);
    assert.equal(live.view().problem, 'The check was refused');
    keeper.change({ trusted: false });
    release();
    await pending;
    assert.equal(live.view().problem, null);
});

test("a failed call's answer is not remembered", async () => {
    const big = bookState(BIG);
    const { model, live } = rig({ state: big });
    model.refusals.set(ScribeReminder.ChoosePrompt, 'Not now');
    await live.reply(at(41));
    assert.equal(chooses(model), 1);
    await live.reply(variant(41, [['Narrator', 'Halvard, thirty winters old, hums a sad tune.']], 'OTHER-41'));
    assert.equal(chooses(model), 2);
    await live.reply(at(41));
    assert.equal(chooses(model), 3);
});

/**
 * @param {object} lines
 * @return {{ ready: string|null, suggestion: string|null }}
 */
function linesOf(lines) {
    assert.equal(Object.isFrozen(lines), true);
    return { ready: lines.ready, suggestion: lines.suggestion };
}

const NO_LINES = Object.freeze({ ready: null, suggestion: null });

test('lines offers what may go', async () => {
    const { storage, keeper, notices, live } = rig();
    await live.reply(at(41));
    const ready = live.view().ready;
    assert.ok(reminds(ready, 'The mill'));
    assert.deepEqual(linesOf(live.lines()), { ready, suggestion: null });
    live.use(GULL);
    live.view();
    const saves = storage.count('set');
    const told = notices.count;
    assert.deepEqual(linesOf(live.lines()), { ready, suggestion: GULL });

    for (const fields of [{ trusted: false }, { trusted: false, mismatch: true }, { trusted: false, reader: false }, { reader: false }]) {
        keeper.change(fields);
        assert.deepEqual(linesOf(live.lines()), NO_LINES, JSON.stringify(fields));
        keeper.change(READING);
        assert.deepEqual(linesOf(live.lines()), { ready, suggestion: GULL }, JSON.stringify(fields));
    }
    for (const stopped of [PAUSED, BUDGET]) {
        keeper.change(stopped);
        assert.deepEqual(linesOf(live.lines()), { ready, suggestion: GULL });
        keeper.change(READING);
    }
    keeper.change({ state: revised(state) });
    assert.deepEqual(linesOf(live.lines()), { ready: null, suggestion: GULL });
    keeper.change({ state });
    assert.deepEqual(linesOf(live.lines()), { ready, suggestion: GULL });
    keeper.change({ edition: 2 });
    assert.deepEqual(linesOf(live.lines()), NO_LINES);
    keeper.change({ edition: 1 });
    assert.equal(storage.count('set'), saves);
    assert.equal(notices.count, told);
    assert.equal(live.view().ready, ready);
    assert.equal(live.view().suggestion, GULL);
    assert.equal(live.view().sends, 0);

    live.close();
    assert.deepEqual(linesOf(live.lines()), NO_LINES);

    const away = rig({ reader: false });
    const reads = away.storage.calls.length;
    assert.deepEqual(linesOf(away.live.lines()), NO_LINES);
    assert.equal(away.storage.calls.length, reads);
    const unread = rig();
    await unread.live.reply(at(41));
    unread.keeper.change({ reader: false });
    unread.live.view();
    unread.keeper.change(READING);
    assert.deepEqual(linesOf(unread.live.lines()), NO_LINES);
    unread.live.view();
    assert.deepEqual(linesOf(unread.live.lines()), { ready: unread.live.view().ready, suggestion: null });
});

test('went marks only what went', async () => {
    const { storage, notices, live } = rig();
    await live.reply(at(41));
    const age = keyOf(live, 'Contradiction', 'MESSAGE-41');
    const ready = live.view().ready;
    assert.deepEqual(ledOf(storage), [AGE]);
    live.use(GULL);
    const told = notices.count;

    live.went(NO_LINES);
    live.went({ ready: null, suggestion: null });
    assert.equal(live.view().sends, 2);
    assert.equal(live.view().ready, ready);
    assert.equal(live.view().suggestion, GULL);
    assert.equal(statusOf(live, age), 'Open');
    assert.deepEqual(ledOf(storage), [AGE]);
    assert.equal(notices.count, told + 2);

    live.went({ ready: `${ready} `, suggestion: 'A gull cries over the mill' });
    assert.equal(live.view().ready, ready);
    assert.equal(live.view().suggestion, GULL);
    assert.equal(statusOf(live, age), 'Open');
    assert.deepEqual(ledOf(storage), [AGE]);
    assert.equal(live.view().sends, 0);

    live.went({ ready: null, suggestion: GULL });
    assert.equal(live.view().suggestion, null);
    assert.equal(live.view().ready, ready);
    assert.equal(statusOf(live, age), 'Open');
    assert.equal(live.view().sends, 1);

    live.went({ ready, suggestion: null });
    assert.equal(live.view().ready, null);
    assert.deepEqual(ledOf(storage), []);
    assert.equal(statusOf(live, age), 'Reminded');
    assert.equal(live.view().sends, 0);
    assert.equal(notices.count, told + 5);

    const away = rig();
    await away.live.reply(at(41));
    const awayReady = away.live.view().ready;
    away.live.use(GULL);
    away.keeper.change({ reader: false });
    const awayTold = away.notices.count;
    away.live.went({ ready: awayReady, suggestion: GULL });
    away.keeper.change(READING);
    assert.equal(away.live.view().ready, awayReady);
    assert.equal(away.live.view().suggestion, GULL);
    assert.equal(away.live.view().sends, 0);
    assert.equal(away.notices.count, awayTold);
    away.live.close();
    away.live.went({ ready: awayReady, suggestion: GULL });
    assert.equal(away.notices.count, awayTold);

    const kept = new FakeStorage();
    const basis = { revision: state.revision, first: [AGE] };
    ScribeStore.write(kept, ROOM, ScribeStore.Kind.Live, {
        now: null,
        ready: null,
        led: [],
        basis,
        sends: 0,
        findings: [],
        suggestion: null,
        seen: null,
        reminded: null,
        edition: 1,
    });
    const odd = rig({}, kept);
    odd.live.view();
    odd.live.went(NO_LINES);
    const stored = ScribeStore.read(kept, ROOM, ScribeStore.Kind.Live);
    assert.equal(stored.sends, 1);
    assert.deepEqual(plain(stored.basis), basis);
});

test('outgoing and sent are the same pieces', async () => {
    const one = rig();
    const two = rig();
    for (const side of [one, two]) {
        await side.live.reply(at(41));
        side.live.use(GULL);
    }
    const age = [one, two].map((side) => keyOf(side.live, 'Contradiction', 'MESSAGE-41'));
    const full = 'x'.repeat(LIMIT - bytes(lineOf(GULL)));
    for (const text of [full, 'Onward.', 'Quiet.', '', '  ']) {
        const offered = two.live.lines();
        const made = ScribeSender.compose(text, offered, 4500);
        assert.ok(one.live.outgoing(text) === made.text, `text of ${text.length}`);
        one.live.sent();
        two.live.went({
            ready: made.ready ? offered.ready : null,
            suggestion: made.suggestion ? offered.suggestion : null,
        });
        for (const field of ['ready', 'suggestion', 'sends']) {
            assert.equal(one.live.view()[field], two.live.view()[field], `${field} after ${text.length}`);
        }
        assert.deepEqual(statuses(one.live), statuses(two.live));
        assert.deepEqual(ledOf(one.storage), ledOf(two.storage));
        assert.equal(statusOf(one.live, age[0]), statusOf(two.live, age[1]));
    }
    assert.equal(one.live.view().ready, null);
    assert.equal(one.live.view().suggestion, null);
    assert.equal(statusOf(one.live, age[0]), 'Reminded');
    assert.equal(one.live.view().sends, 3);
    one.live.sent();
    assert.equal(one.live.view().sends, 4);

    const twice = rig();
    await twice.live.reply(at(41));
    assert.notEqual(twice.live.outgoing('Onward.'), 'Onward.');
    twice.live.sent();
    assert.equal(twice.live.view().sends, 0);
    twice.live.sent();
    assert.equal(twice.live.view().sends, 1);
});
