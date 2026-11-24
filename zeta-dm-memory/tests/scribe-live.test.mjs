import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
    const context = vm.createContext({ TextEncoder, crypto: { randomUUID } });
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
    ZetaSource,
    ScribeText,
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
    [
        'ZetaSource',
        'ScribeStore',
        'ScribeScene',
        'ScribeReminder',
        'ScribePedant',
        'ScribeMuse',
        'ScribeSender',
        'ScribeLive',
    ],
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
const TALE = 'Orla came to the mill for work.';
const TOLD = `[Scribe] The story so far: ${TALE}`;
const CROWDED = `${TALE} `.repeat(83).trim();

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
 * @param {...string} names
 * @return {boolean}
 */
function reminds(text, ...names) {
    return (
        typeof text === 'string' &&
        text.startsWith('[Scribe] ') &&
        ScribeIntake.own(text) &&
        !text.includes('\n') &&
        names.every((name) => text.includes(name))
    );
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
function decisionsForReply(verdicts) {
    return (input) => {
        const reply = input.split(/REPLY \(#\d+\):\n/).at(-1);
        const sections = {};
        for (const [fixtureText, section, verdict] of verdicts) {
            if (reply.includes(fixtureText)) {
                (sections[section] ??= []).push(verdict);
            }
        }
        return answer(sections);
    };
}

const PEDANT = decisionsForReply([
    ['forty winters old', 'CONTRADICTIONS', `${AGE} | Halvard | age | forty`],
    ['thirty winters old', 'CONTRADICTIONS', `${AGE} | Halvard | age | thirty`],
    ['eyes green tonight', 'CONTRADICTIONS', `${EYES} | Halvard | eyes | green`],
    ['Your scars ache', 'LEAKS', `${BUILD} | Mirelle | Your scars ache`],
    ['Halvart', 'MISSPELLINGS', 'Halvart | Halvard'],
]);

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
const PEDANT_MANY = decisionsForReply([
    [MANY_REPLIES[0][0][1], 'CONTRADICTIONS', `${MANY_IDS.halvardAge} | Halvard | age | forty`],
    ['Halvard, fifty winters old, waits.', 'CONTRADICTIONS', `${MANY_IDS.halvardAge} | Halvard | age | fifty`],
    [MANY_REPLIES[1][0][1], 'CONTRADICTIONS', `${MANY_IDS.halvardEyes} | Halvard | eyes | green`],
    [MANY_REPLIES[2][0][1], 'CONTRADICTIONS', `${MANY_IDS.halvardHair} | Halvard | hair | white`],
    [MANY_REPLIES[3][0][1], 'CONTRADICTIONS', `${MANY_IDS.mirelleAge} | Mirelle | age | sixty`],
    [MANY_REPLIES[4][0][1], 'CONTRADICTIONS', `${MANY_IDS.mirelleEyes} | Mirelle | eyes | blue`],
    [MANY_REPLIES[5][0][1], 'CONTRADICTIONS', `${MANY_IDS.mirelleHair} | Mirelle | hair | gold`],
    [MANY_REPLIES[6][0][1], 'CONTRADICTIONS', `${MANY_IDS.mirelleBuild} | Mirelle | build | broad and heavy`],
    ['Your scars must ache, Orla.', 'LEAKS', `${MANY_IDS.orlaBuild} | Mirelle | Your scars must ache`],
]);

const SUMMER = Array(33).fill('夏夏夏夏夏').join(' ');
const ALREADY = Array(33).fill('既既既既既').join(' ');
const LONG = Object.freeze([
    `Halvard | build | ${SUMMER} | #5`,
    `Mirelle | build | ${ALREADY} | #6`,
    'Halvard | age | 34 | #7',
]);
const long = bookState(LONG);
const LONG_IDS = Object.freeze({ halvard: factIn(long, SUMMER), mirelle: factIn(long, ALREADY) });
const PEDANT_LONG = decisionsForReply([
    ['Halvard is broad as a barn tonight.', 'CONTRADICTIONS', `${LONG_IDS.halvard} | Halvard | build | broad as a barn`],
    ['Mirelle is thin as a reed now.', 'CONTRADICTIONS', `${LONG_IDS.mirelle} | Mirelle | build | thin as a reed`],
]);

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
        story: TALE,
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
            const refused = model.refusals.get(system);
            throw typeof refused === 'function' ? refused() : Object.assign(new Error(refused), { retryable: true });
        }
        let text = '';
        if (system === ScribeScene.Prompt) {
            text = model.scene;
        } else if (system === ScribePedant.Prompt) {
            text = typeof model.pedant === 'function' ? model.pedant(user) : model.pedant;
        } else if (system === ScribeMuse.SuggestPrompt) {
            text = model.line;
        } else if (system === ScribeAnalyzer.NotesPrompt) {
            text = model.understood;
        } else if (system === ScribeReminder.StoryPrompt) {
            text = model.rawStory ?? JSON.stringify({ status: 'recap', text: model.story });
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
    const keeper = new StandInKeeper({
        reader: true,
        trusted: true,
        readerCurrent: true,
        booked: true,
        problem: null,
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
    const fixture = modelOf();
    keeper.savedAlerts = (message, current) => savedAlerts(fixture, message, current);
    return keeper;
}

/**
 * @param {object} model
 * @param {object} message
 * @param {object} current
 * @return {object[]}
 */
function savedAlerts(model, message, current) {
    if (model.failing.has('Pedant') || model.refusals.has(ScribePedant.Prompt)) {
        return [];
    }
    const input = 'REPLY (#' + message.position + '):\n' + ScribeIntake.transcript([message]);
    const text = typeof model.pedant === 'function' ? model.pedant(input) : model.pedant;
    const parsed = ScribePedant.parse(text);
    const confirmed = ScribePedant.confirm(current, 'Orla', message, parsed, []);
    const situations = ScribePedant.situated(message, parsed.situations, []);
    const spellings = parsed.misspellings.flatMap((item) => {
        const subject = ScribePedant.find(current, item.intended);
        return subject ? [ScribePedant.finding(message, { kind: 'Spelling', subject: subject.id,
            label: subject.label, written: item.written })] : [];
    });
    return [...confirmed, ...situations, ...spellings].map((finding) => ({ ...finding, fingerprint: message.fingerprint }));
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
                const checkerAlerts = (keeper.current.checkerAlerts ?? []).filter((alert) => alert.message !== message.id);
                if (keeper.savedAlerts && keeper.current.reader && keeper.current.trusted && !keeper.current.stop && !message.fromPlayer) {
                    checkerAlerts.push(...keeper.savedAlerts(message, keeper.current.state));
                }
                keeper.change({ messages, unread: messages.slice(40), checkerAlerts });
            }
            return live.reply(message);
        },
    };
}

/**
 * @return {object}
 */
function castOf() {
    const cast = {
        reads: { story: 0, profile: 0 },
        characters: [],
        text: 'Orla is a sellsword from the northern marches.',
        storyFailures: [],
        profileFailures: [],
        gate: null,
        plots: [],
    };
    cast.story = async () => {
        cast.reads.story++;
        const failure = cast.storyFailures.length > 0 ? cast.storyFailures.shift() : null;
        if (failure !== null) {
            throw failure;
        }
        if (cast.gate !== null) {
            await cast.gate;
        }
        return { characters: cast.characters, plotId: 'plot-harbour' };
    };
    cast.profile = async (plotId) => {
        cast.reads.profile++;
        cast.plots.push(plotId);
        const failure = cast.profileFailures.length > 0 ? cast.profileFailures.shift() : null;
        if (failure !== null) {
            throw failure;
        }
        if (cast.gate !== null) {
            await cast.gate;
        }
        return cast.text;
    };
    cast.unseen = (count) => {
        for (let read = 0; read < count; read++) {
            cast.storyFailures.push(new Error(ZetaSource.Settings.Messages.NoLogin));
            cast.profileFailures.push(new Error(ZetaSource.Settings.Messages.NoLogin));
        }
    };
    cast.hold = () => {
        let release = null;
        cast.gate = new Promise((resolve) => {
            release = resolve;
        });
        return () => {
            cast.gate = null;
            release();
        };
    };
    cast.readers = { story: cast.story, profile: cast.profile };
    return cast;
}

const QUIET = castOf();

/**
 * @param {object} fields
 * @param {FakeStorage} storage
 * @return {{ keeper: object, storage: object, model: object, notices: object, live: object, raw: object, cast: object }}
 */
function rig(fields = {}, storage = new FakeStorage()) {
    const keeper = keeperOf(fields);
    const model = modelOf();
    keeper.savedAlerts = (message, current) => savedAlerts(model, message, current);
    const cast = castOf();
    const notices = { count: 0 };
    const notify = () => {
        notices.count++;
    };
    const raw = ScribeLive.open({
        keeper,
        storage,
        roomId: ROOM,
        ask: model.ask,
        clock: CLOCK,
        notify,
        story: cast.story,
        profile: cast.profile,
    });
    const live = following(keeper, raw);
    return { keeper, storage, model, notices, live, raw, notify, cast };
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
    const known = [
        ScribeScene.Prompt,
        ScribePedant.Prompt,
        ScribeMuse.SuggestPrompt,
        ScribeAnalyzer.NotesPrompt,
        ScribeReminder.StoryPrompt,
    ];
    return model.calls.filter((call) => !known.includes(call.system)).length;
}

/**
 * @param {object} model
 * @return {number}
 */
function tellings(model) {
    return model.calls.filter((call) => call.system === ScribeReminder.StoryPrompt).length;
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
            changed: false,
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
        ],
    );
    assert.equal(countOf(model, ScribePedant.Prompt), 0);
    assert.equal(view.problem, null);
});

test('a forced reminder is made for those in the scene, and a changed scene alone makes none', async () => {
    const { model, live } = rig();
    await live.reply(at(41));
    assert.equal(live.view().ready, null);
    assert.equal(live.view().due, false);
    await live.force();
    const first = live.view().ready;
    assert.ok(reminds(first, 'Halvard', 'Mirelle'), first);
    assert.equal(live.view().due, true);
    live.outgoing('Onward.');
    live.sent();
    assert.equal(live.view().ready, null);
    await live.reply(at(45));
    assert.equal(live.view().ready, null);
    assert.equal(live.view().sends, 0);
    assert.equal(live.view().due, false);
    model.scene = TENT.replace('Halvard, Mirelle, Orla', 'Mirelle, Orla');
    await live.reply(at(49));
    assert.equal(live.view().now.place, 'The tent');
    assert.equal(live.view().ready, null);
    await live.force();
    const tent = live.view().ready;
    assert.ok(reminds(tent, 'Mirelle'), tent);
    assert.equal(tent.includes('Halvard'), false, tent);
    live.outgoing('Onward.');
    live.sent();
    model.scene = TENT_AGAIN;
    await live.reply(at(51));
    assert.equal(live.view().ready, null);
    assert.equal(live.view().now.summary, 'Night falls');

    const unreminded = rig();
    const healthy = breakView(unreminded.keeper, { messages: story.slice(0, 41) }, 'unread');
    await unreminded.live.reply(at(41));
    await unreminded.live.force();
    assert.equal(unreminded.live.view().now.place, 'The mill');
    assert.equal(unreminded.live.view().ready, null);
    assert.equal(unreminded.live.view().due, true);
    unreminded.keeper.current = healthy;
    unreminded.keeper.pinned = false;
    await unreminded.live.reply(at(45));
    assert.equal(unreminded.live.view().now.changed, false);
    assert.ok(reminds(unreminded.live.view().ready, 'Halvard'));
    assert.equal(unreminded.live.view().due, true);
});

test('the refresh count makes a reminder due for the send that reaches it', async () => {
    const { model, live } = rig({ settings: { refresh: 3 } });
    await live.reply(at(41));
    assert.equal(live.view().ready, null);
    assert.equal(live.view().due, false);
    assert.equal(chooses(model), 0);
    live.outgoing('One.');
    live.sent();
    assert.equal(live.view().sends, 1);
    assert.equal(live.view().due, false);
    model.scene = TENT;
    await live.reply(at(45));
    assert.equal(live.view().now.changed, true);
    assert.equal(live.view().ready, null);
    assert.equal(chooses(model), 0);
    live.outgoing('Two.');
    live.sent();
    assert.equal(live.view().sends, 2);
    assert.equal(live.view().due, true);
    model.scene = TENT.replace('CHANGED: yes', 'CHANGED: no');
    await live.reply(at(51));
    assert.equal(live.view().now.changed, false);
    assert.ok(reminds(live.view().ready, 'Halvard'));
    assert.equal(live.outgoing('Three.'), `Three.${lineOf(live.view().ready)}`);
    live.sent();
    assert.equal(live.view().sends, 0);
    assert.equal(live.view().ready, null);
    model.scene = YARD;
    await live.reply(at(53));
    assert.equal(live.view().now.changed, true);
    assert.equal(live.view().ready, null);
    assert.equal(live.view().due, false);
});

test('a failed check raises no spelling finding', async () => {
    const { model, live } = rig();
    model.failing.add('Pedant');
    await live.reply(at(43));
    assert.deepEqual(model.roles(), ['Scribe']);
    assert.deepEqual(statuses(live), []);
    assert.equal(live.view().problem, null);

    const working = rig();
    await working.live.reply(at(43));
    assert.equal(
        working.live.view().findings.some((finding) => finding.kind === 'Spelling'),
        true,
    );

    const later = rig();
    await later.live.reply(at(45));
    later.model.failing.add('Pedant');
    await later.live.reply(at(47));
    assert.deepEqual(statuses(later.live), []);
    assert.equal(later.live.view().problem, null);
    later.model.failing.clear();
    await later.live.reply(variant(47, [['Narrator', 'Rain falls on the tent.']], 'OTHER-47'));
    await later.live.reply(at(47));
    assert.equal(
        later.live.view().findings.some((finding) => finding.kind === 'Spelling' && finding.message === 'MESSAGE-47'),
        true,
    );
});

test("a regenerated reply takes back the old one's findings", async () => {
    const { model, live } = rig();
    await live.reply(at(45));
    assert.equal(live.view().now.place, 'The mill');
    model.scene = TENT;
    await live.reply(at(47));
    assert.equal(live.view().now.place, 'The tent');
    assert.deepEqual(statuses(live), [
        ['Contradiction', 'MESSAGE-47', 'Open'],
        ['Spelling', 'MESSAGE-47', 'Open'],
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
    assert.equal(model.calls.length, calls + 1);

    const copy = variant(43, scripted[41], 'COPY-43');
    assert.equal(copy.fingerprint, at(41).fingerprint);
    const twin = rig();
    await twin.live.reply(at(41));
    await twin.live.reply(copy);
    assert.deepEqual(
        twin.model.calls.map((call) => `${call.role}:${replyOf(call.user)}`),
        ['Scribe:', 'Scribe:'],
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
        ['Scribe:', 'Scribe:'],
    );
    assert.deepEqual(statuses(live), [
        ['Contradiction', 'MESSAGE-43', 'Open'],
        ['Leak', 'MESSAGE-43', 'Open'],
        ['Spelling', 'MESSAGE-43', 'Open'],
        ['Contradiction', 'MESSAGE-41', 'Open'],
    ]);
    await live.reply(at(47));
    assert.equal(countOf(model, ScribePedant.Prompt), 0);
});

test('a failing model changes nothing it should not', async () => {
    const { keeper, storage, model, notices, live } = rig();
    await live.reply(at(41));
    await live.force();
    live.outgoing('Onward.');
    live.sent();
    model.failing.add('Scribe');
    await live.reply(at(43));
    assert.equal(live.view().now.message, 'MESSAGE-41');
    assert.equal(live.view().now.place, 'The mill');
    assert.equal(ScribeStore.read(storage, ROOM, 'live').seen.position, 43);
    assert.equal(model.calls.at(-1).role, 'Scribe');
    assert.deepEqual(statuses(live), [
        ['Contradiction', 'MESSAGE-43', 'Open'],
        ['Leak', 'MESSAGE-43', 'Open'],
        ['Spelling', 'MESSAGE-43', 'Open'],
        ['Contradiction', 'MESSAGE-41', 'Reminded'],
    ]);
    const kept = statuses(live);
    model.failing.delete('Scribe');
    model.failing.add('Pedant');
    model.scene = TENT;
    await live.force();
    await live.reply(at(45));
    assert.deepEqual(statuses(live), kept);
    assert.equal(live.view().now.place, 'The tent');
    assert.ok(reminds(live.view().ready, 'Halvard'));
    model.failing.clear();

    const tentReminder = live.view().ready;
    keeper.pinned = true;
    keeper.change({ messages: null });
    const saves = storage.count('set');
    const told = notices.count;
    await live.reply(at(47));
    assert.equal(live.view().now.place, 'The tent');
    assert.equal(model.calls.at(-1).role, 'Scribe');
    assert.equal(countOf(model, ScribePedant.Prompt), 0);
    assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).seen.id, 'MESSAGE-47');
    assert.ok(storage.count('set') > saves);
    assert.equal(notices.count, told + 1);
    assert.equal(typeof live.view().problem, 'string');
    const rebuilt = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).ready;
    assert.equal(rebuilt, tentReminder);
    assert.ok(reminds(rebuilt, 'Halvard: age: 34'), rebuilt);
    assert.equal(live.outgoing('Onward.'), `Onward.${lineOf(rebuilt)}`);

    breakView(keeper, { messages: [...story.slice(0, 48), at(49)] }, 'unread');
    model.scene = ROAD;
    await live.reply(at(49));
    assert.equal(live.view().now.place, 'The road');
    await ticks();
    assert.equal(live.view().ready, null);
    assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).now.place, 'The road');
    assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).ready, null);
    assert.equal(notices.count, told + 3);
});

test("the player's words go first and unchanged", async () => {
    const { storage, live } = rig();
    await live.reply(at(41));
    await live.force();
    live.use(GULL);
    const view = live.view();
    assert.ok(reminds(view.ready, 'Halvard'));
    const text = 'I draw my blade.  ';
    const saves = storage.count('set');
    const result = live.outgoing(text);
    assert.equal(result, `${text}\n@: ${view.ready}\n@: ${GULL}`);
    assert.equal(result.slice(0, text.length), text);
    const sending = storage.count('set');
    assert.equal(sending > saves, true);
    assert.equal(live.outgoing(text), result);
    assert.equal(storage.count('set'), sending);
    assert.equal(live.view().ready, view.ready);
    assert.equal(live.view().suggestion, GULL);
    const spaced = '\n  *I wait.*\t\n';
    assert.equal(live.outgoing(spaced).slice(0, spaced.length), spaced);
});

test('the size guard never cuts the player', async () => {
    const { live } = rig();
    await live.reply(at(41));
    await live.force();
    const ready = live.view().ready;
    assert.ok(reminds(ready, 'Halvard'));
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
            [50, 'whole'],
            [51, 'trimmed'],
            [room, 'none'],
        ]) {
            const suggestion = suggestionOf(lineSize);
            assert.equal(bytes(lineOf(suggestion)), lineSize);
            live.use(suggestion);
            const result = live.outgoing(player);
            assert.ok(result.startsWith(player), `stage ${lineSize}`);
            assert.ok(result.endsWith(lineOf(suggestion)), `stage ${lineSize}`);
            const carried = result.slice(player.length, result.length - lineOf(suggestion).length);
            if (withReady === 'whole') {
                assert.equal(carried, lineOf(ready));
            } else if (withReady === 'trimmed') {
                assert.equal(carried.startsWith(lineOf(TOLD)), true, carried);
                assert.equal(ready.startsWith(carried.slice(lineOf('').length)), true);
                assert.equal(carried.length < lineOf(ready).length, true);
                assert.equal(carried.endsWith('.'), true, carried);
            } else {
                assert.equal(carried, '');
                assert.equal(live.view().held, 'No reminder: your message leaves no room for it.');
            }
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
    await live.force();
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
    await live.force();
    await live.reply(at(45));
    const fresh = live.view().ready;
    assert.ok(reminds(fresh, 'Halvard'));
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
        ['Contradiction', 'MESSAGE-43', 'Open'],
        ['Leak', 'MESSAGE-43', 'Open'],
        ['Spelling', 'MESSAGE-43', 'Open'],
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
            story: QUIET.story,
            profile: QUIET.profile,
        }),
    );
    await reader.reply(at(41));
    await reader.force();
    const millReminder = reader.view().ready;
    assert.ok(reminds(millReminder, 'Halvard'));

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
            story: QUIET.story,
            profile: QUIET.profile,
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
    await assert.rejects(watcher.force(), /^Error: Another tab is reading this chat$/);
    assert.equal(watcher.view().forceBlock, 'Another tab is reading this chat');
    assert.equal(watcherModel.calls.length, 0);
    const key = watcher.view().findings[0].key;
    watcher.dismiss(key);
    watcher.use(GULL);
    watcher.edit('[Scribe] Mine.');
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
    assert.ok(reminds(tentReminder, 'Halvard'));
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
    const filed = statuses(flight.live);
    assert.deepEqual(filed, [['Contradiction', 'MESSAGE-41', 'Open']]);
    flight.keeper.change({ reader: false, trusted: false });
    flight.live.view();
    flight.keeper.change({ reader: true, trusted: true });
    flight.live.view();
    const quiet = flight.storage.count('set');
    release();
    await pending;
    await ticks();
    assert.equal(flight.storage.count('set'), quiet);
    assert.deepEqual(statuses(flight.live), filed);
    assert.equal(flight.live.view().now, null);
    assert.equal(ScribeStore.read(flight.storage, ROOM, ScribeStore.Kind.Live).seen, null);
});

test('a closed live part is silent', async () => {
    const { storage, model, notices, live } = rig();
    await live.reply(at(41));
    await live.force();
    const key = live.view().findings[0].key;
    assert.notEqual(live.view().ready, null);
    const release = model.hold('Scribe');
    const pending = live.reply(at(43));
    await ticks();
    assert.deepEqual(plain(model.roles()), ['Scribe', 'Scribe', 'Scribe']);
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
    live.edit('[Scribe] Late.');
    live.clear();
    await live.force();
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
    await live.force();
    live.dismiss(keyOf(live, 'Spelling', 'MESSAGE-43'));
    live.outgoing('Onward.');
    live.sent();
    model.scene = TENT;
    await live.force();
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
        ['Reminded', 'Open', 'Dismissed', 'Reminded'],
    );
    live.close();
    const again = following(
        keeper,
        ScribeLive.open({ keeper, storage, roomId: ROOM, ask: model.ask, clock: CLOCK, notify, ...QUIET.readers }),
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
    await waiting.live.force();
    assert.deepEqual(ledOf(waiting.storage), [AGE]);
    waiting.live.close();
    const reopened = rig({ messages: story.slice(0, 41), unread: story.slice(40, 41) }, waiting.storage);
    reopened.live.outgoing('Hello.');
    reopened.live.sent();
    assert.equal(statusOf(reopened.live, keyOf(reopened.live, 'Contradiction', 'MESSAGE-41')), 'Reminded');

    const shaped = new FakeStorage();
    keeper.change({ checkerAlerts: [] });
    ScribeStore.write(shaped, ROOM, ScribeStore.Kind.Live, { findings: 'none', sends: 3 });
    const odd = ScribeLive.open({
        keeper,
        storage: shaped,
        roomId: ROOM,
        ask: model.ask,
        clock: CLOCK,
        notify,
        ...QUIET.readers,
    });
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
    assert.equal(live.view().offer.text, 'none');
    assert.equal(offers().length, 5);
    model.line = `LINE: ${COURIER}`;
    await live.suggest();
    assert.deepEqual(plain(live.view().offer), { thread: 'T1', text: COURIER });
    assert.deepEqual(plain([...new Set(offers().map((call) => call.role))]), ['Scribe']);

    live.use('Something else entirely.');
    assert.deepEqual(plain(live.view().offer), { thread: 'T1', text: COURIER });
    live.use('A gull\n  cries over\tthe mill.');
    assert.equal(live.view().suggestion, 'A gull\n  cries over\tthe mill.');
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
    assert.equal(keeper.filed.length, 3);
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
    const reopened = ScribeLive.open({
        keeper,
        storage: older,
        roomId: ROOM,
        ask: model.ask,
        clock: CLOCK,
        notify,
        ...QUIET.readers,
    });
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
    await live.force();
    await live.reply(variant(41, MANY_REPLIES[0], null));
    assert.deepEqual(ledOf(storage), [MANY_IDS.halvardAge]);
    await live.reply(variant(43, [['Mirelle', 'Your scars must ache, Orla.']], null));
    assert.deepEqual(statuses(live), [
        ['Leak', 'MESSAGE-43', 'Open'],
        ['Contradiction', 'MESSAGE-41', 'Open'],
    ]);
    await live.reply(variant(45, MANY_REPLIES[1], null));
    assert.deepEqual(ledOf(storage), [MANY_IDS.halvardEyes, MANY_IDS.halvardAge]);
    const led = live.view().ready;
    assert.ok(led.startsWith(`${TOLD} Halvard: eyes: grey. Halvard: age: 34. `), led);
    assert.equal(led.includes('scarred'), false, led);

    live.dismiss(keyOf(live, 'Contradiction', 'MESSAGE-45'));
    await live.reply(variant(47, MANY_REPLIES[3], null));
    assert.deepEqual(ledOf(storage), [MANY_IDS.mirelleAge, MANY_IDS.halvardAge]);

    const counted = rig({ state: many });
    counted.model.pedant = PEDANT_MANY;
    await counted.live.force();
    for (const [index, blocks] of MANY_REPLIES.entries()) {
        await counted.live.reply(variant(41 + 2 * index, blocks, null));
    }
    assert.equal(counted.live.view().findings.length, 7);
    assert.deepEqual(ledOf(counted.storage), [...MANY_ORDER].reverse().slice(0, 5));

    const spent = rig({ state: many });
    spent.model.pedant = PEDANT_MANY;
    await spent.live.force();
    await spent.live.reply(variant(41, MANY_REPLIES[0], null));
    await spent.live.reply(variant(43, MANY_REPLIES[3], null));
    assert.deepEqual(ledOf(spent.storage), [MANY_IDS.mirelleAge, MANY_IDS.halvardAge]);
    spent.keeper.change({ state: bookState(MANY.map((fact) => fact.replace('Halvard | age | 34', 'Halvard | age | 35'))) });
    await spent.live.reply(variant(45, MANY_REPLIES[4], null));
    assert.deepEqual(ledOf(spent.storage), [MANY_IDS.mirelleEyes, MANY_IDS.mirelleAge]);

    const repeated = rig({ state: many });
    repeated.model.pedant = PEDANT_MANY;
    await repeated.live.force();
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
    await leaking.live.force();
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
    model.story = CROWDED;
    await live.force();
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
    await live.force();
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
    await cleared.live.force();
    await cleared.live.reply(variant(41, [['Narrator', 'Halvard is broad as a barn tonight.']], null));
    assert.deepEqual(ledOf(cleared.storage), [LONG_IDS.halvard]);
    cleared.live.clear();
    assert.deepEqual(ledOf(cleared.storage), []);
    cleared.live.outgoing('Onward.');
    cleared.live.sent();
    assert.equal(statusOf(cleared.live, keyOf(cleared.live, 'Contradiction', 'MESSAGE-41')), 'Open');

    const twice = rig();
    await twice.live.force();
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
    await own.live.force();
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
    assert.deepEqual(ledOf(own.storage), []);
    const line = own.live.outgoing('Onward.');
    assert.equal(/scarred/.test(line), false, line);
    own.live.sent();
    assert.deepEqual(statuses(own.live), [
        ['Leak', 'MESSAGE-43', 'Open'],
        ['Contradiction', 'MESSAGE-41', 'Open'],
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
    assert.equal(direct.operations.length, 2);
    assert.deepEqual(plain(direct.refused), []);
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
    assert.deepEqual(plain(understood.refused.map((item) => item.reason)), ['Held back']);
    assert.equal(understood.count, 2);

    model.understood = answer({ FACTS: ['Mirelle | build | tall | #12'] });
    await live.tell('Mirelle is tall.');
    assert.equal(keeper.previews.length, 2);
    assert.equal(live.view().understood.count, 1);
    assert.deepEqual(plain(live.view().understood.refused.map((item) => item.reason)), ['Held back']);

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
    const privatePreview = (rows) => previewFrom(moved)(rows.map((row) => ({ ...row, hidden: true })));
    keeper.previewer = privatePreview;
    await live.confirm();
    assert.equal(keeper.filed.length, 1);
    const fresh = plain(live.view().understood.lines);
    assert.notDeepEqual(fresh, shown);
    const seen = privatePreview(operations);
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
    const hiddenPreview = (rows) => previewFrom(aged)(rows.map((row) => ({ ...row, hidden: true })));
    keeper.previewer = hiddenPreview;
    await live.confirm();
    assert.equal(keeper.filed.length, 0);
    const other = hiddenPreview(operations);
    const shown = plain(ScribeMuse.changes(other.before, other.state));
    assert.notDeepEqual(shown, expected);
    assert.notDeepEqual(shown, plain(ScribeMuse.changes(state, other.state)));
    assert.deepEqual(plain(live.view().understood.lines), shown);
});

test('an unmarked answer offers all the returned words', async () => {
    const { model, live } = rig();
    await live.reply(at(41));
    model.line = RIDER;
    await live.suggest();
    assert.equal(live.view().offer.text, RIDER);
    model.line = 'LINE: none';
    await live.suggest();
    assert.equal(live.view().offer.text, 'none');
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
    await live.force();
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
        assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).ready, ready);
        assert.equal(live.view().now.place, 'The mill');
        assert.equal(storage.count('set'), saves);
        keeper.change({ read: 40, state, trusted: true, edition: 1 });
        assert.equal(live.view().ready, ready);
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
        model.calls.slice(startedOver).some((call) => call.role === 'Pedant'),
        false,
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
    await live.force();
    await live.reply(at(41));
    live.outgoing('Onward.');
    live.sent();
    assert.equal(live.view().ready, null);
    model.pedant = answer({ CONTRADICTIONS: [`${AGE} | Halvard | age | forty`] });
    await live.force();
    await live.reply(variant(45, [['Narrator', 'Halvard, forty winters old, waits.']], null));
    const old = live.view().ready;
    assert.ok(reminds(old, 'Halvard'), old);
    assert.deepEqual(ledOf(storage), [AGE]);
    model.pedant = answer({ CONTRADICTIONS: [] });
    await live.reply(variant(45, [['Narrator', 'Halvard hums by the fire.']], 'OTHER-45'));
    assert.deepEqual(statuses(live), []);
    const renewed = live.view().ready;
    assert.ok(reminds(renewed, 'Halvard'), renewed);
    assert.deepEqual(ledOf(storage), []);
    assert.equal(live.outgoing('I listen.'), `I listen.${lineOf(renewed)}`);

    const moved = rig();
    await moved.live.force();
    await moved.live.reply(at(41));
    const said = moved.live.view().ready;
    assert.ok(said.includes('Halvard: age: 34.'), said);
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
    assert.ok(reminds(fresh, 'Halvard'), fresh);
    assert.ok(!fresh.includes('34'), fresh);
    assert.ok(fresh.includes('age: forty'), fresh);
    assert.equal(moved.live.outgoing('Again.'), `Again.${lineOf(fresh)}`);

    const between = rig();
    await between.live.force();
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
    await later.live.force();
    await later.live.reply(at(41));
    const kept = later.live.view().ready;
    later.live.use(GULL);
    later.keeper.change({ state: revised(state) });
    assert.equal(later.live.outgoing('Hello.'), `Hello.${lineOf(GULL)}`);
    later.keeper.change({ state });
    assert.equal(later.live.outgoing('Hello.'), `Hello.${lineOf(kept)}${lineOf(GULL)}`);

    const moving = rig();
    await moving.live.force();
    await moving.live.reply(at(41));
    const mill = moving.live.view().ready;
    breakView(moving.keeper, { messages: story.slice(0, 43) }, 'unread');
    moving.model.scene = TENT;
    await moving.live.reply(at(43));
    assert.equal(moving.live.view().now.place, 'The tent');
    assert.equal(ScribeStore.read(moving.storage, ROOM, ScribeStore.Kind.Live).ready, mill);
    assert.equal(moving.live.outgoing('Hello.'), 'Hello.');
});

test('nothing goes out while the book cannot be trusted', async () => {
    const { keeper, model, live } = rig();
    await live.reply(at(41));
    await live.force();
    live.use(GULL);
    const ready = live.view().ready;
    const whole = `Hello.${lineOf(ready)}${lineOf(GULL)}`;
    assert.equal(live.outgoing('Hello.'), whole);
    live.cancelled();
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
        live.cancelled();
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
    await live.force();
    await live.reply(at(41));
    live.outgoing('Onward.');
    live.sent();
    model.scene = TENT;
    await live.force();
    await live.reply(at(43));
    live.outgoing('Onward.');
    live.sent();
    assert.deepEqual(statuses(live), [
        ['Contradiction', 'MESSAGE-43', 'Reminded'],
        ['Leak', 'MESSAGE-43', 'Open'],
        ['Spelling', 'MESSAGE-43', 'Open'],
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
    assert.equal(edits.model.calls.length, calls + 1);
    assert.ok(edits.model.calls.at(-1).user.includes('whistles again'));
    assert.deepEqual(statuses(edits.live), [
        ['Contradiction', 'MESSAGE-43', 'Open'],
        ['Spelling', 'MESSAGE-43', 'Open'],
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
        ['Scribe:', 'Scribe:'],
    );
    assert.deepEqual(statuses(swiping.live), [['Contradiction', 'MESSAGE-41', 'Open']]);
    assert.equal(findingOf(swiping.live, keyOf(swiping.live, 'Contradiction', 'MESSAGE-41')).said, 'forty');
    swiping.keeper.change({ state: revised(state) });
    await swiping.live.reply(other);
    assert.equal(swiping.model.calls.length, 3);
    assert.deepEqual(statuses(swiping.live), [['Contradiction', 'OTHER-41', 'Open']]);

    const moved = rig();
    await moved.live.reply(at(41));
    moved.keeper.change({ state: revised(state) });
    await moved.live.reply(at(41));
    moved.live.view();
    await ticks();
    assert.deepEqual(plain(moved.model.roles()), ['Scribe']);

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
    assert.deepEqual(reopened.model.roles(), ['Scribe']);
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
    assert.equal(live.view().findings.length, 202);
    assert.equal(live.view().findings.find((finding) => finding.fault === spelling.fault)?.status, 'Dismissed');
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
    assert.equal(live.view().findings.length, 202);
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
    assert.deepEqual(plain([keptKeys.length, keptKeys[0], keptKeys.at(-1)]), [600, 'old-0', 'old-599']);
    const leak = keyOf(capped.live, 'Leak', 'MESSAGE-43');
    const leakFault = findingOf(capped.live, leak).fault;
    capped.live.dismiss(leak);
    const later = ScribeStore.read(crowded, ROOM, ScribeStore.Kind.Live).dismissed;
    assert.deepEqual(plain([later.length, later[0], later.at(-1)]), [601, 'old-0', leakFault]);
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
            ['Scribe:'],
        );
        live.view();
        await ticks();
        assert.equal(model.calls.length, 1);
        assert.equal(live.view().now.message, 'MESSAGE-49');
    }

    const midway = rig();
    const release = midway.model.hold('Scribe');
    const pending = midway.live.reply(at(41));
    await ticks();
    const confirmed = statuses(midway.live);
    assert.deepEqual(confirmed, [['Contradiction', 'MESSAGE-41', 'Open']]);
    midway.keeper.change(PAUSED);
    release();
    await pending;
    assert.deepEqual(plain(midway.model.roles()), ['Scribe']);
    assert.deepEqual(statuses(midway.live), confirmed);
    assert.equal(midway.live.view().now, null);
    midway.keeper.change(READING);
    midway.live.view();
    await ticks();
    assert.deepEqual(plain(midway.model.roles()), ['Scribe', 'Scribe']);
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
        ['Scribe:', 'Scribe:'],
    );

    const passed = rig(PAUSED);
    await passed.live.reply(at(41));
    passed.keeper.change({ ...READING, messages: story.slice(0, 43) });
    passed.live.view();
    await ticks();
    assert.deepEqual(
        passed.model.calls.map((call) => `${call.role}:${replyOf(call.user)}`),
        ['Scribe:'],
    );
    passed.keeper.change({ messages: story.slice(0, 41) });
    passed.live.view();
    await ticks();
    assert.deepEqual(
        passed.model.calls.map((call) => `${call.role}:${replyOf(call.user)}`),
        ['Scribe:', 'Scribe:'],
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
    await first.live.force();
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
        ['Contradiction', 'Reminded'],
        ['Leak', 'Open'],
        ['Spelling', 'Dismissed'],
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
            const status = index === 0 ? 'Corrected' : finding.status;
            return { ...rest, correction: '[Scribe] Correction: x', status };
        }),
        corrections: ['[Scribe] Correction: x'],
        suggestion: null,
        seen: { id: saved.seen.id, fingerprint: saved.seen.fingerprint, position: saved.seen.position, before: null },
        reminded: saved.reminded,
    });
    const reopened = rig({}, ancient);
    assert.equal(reopened.live.view().problem, null);
    assert.deepEqual(statuses(reopened.live), [
        ['Contradiction', 'MESSAGE-43', 'Corrected'],
        ['Leak', 'MESSAGE-43', 'Open'],
        ['Spelling', 'MESSAGE-43', 'Dismissed'],
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
        assert.deepEqual(plain(model.roles()), ['Scribe'], named);
        assert.equal(live.view().now.place, 'The mill', named);
        await live.force();
        assert.ok(reminds(live.view().ready, 'Halvard'), named);
        assert.deepEqual(statuses(live), [['Contradiction', 'MESSAGE-41', 'Open']], named);
    }
});

test('only a blank message is blank', async () => {
    const { live } = rig();
    await live.reply(at(41));
    await live.force();
    const blank = String.fromCodePoint(0x85, 0xa0, 0x200b, 0x2028);
    for (const text of [blank, `  ${String.fromCodePoint(0x85)}  `, String.fromCodePoint(0xfeff, 0x2029, 0x3000, 0x9)]) {
        assert.ok(live.outgoing(text) === text);
    }
    assert.equal(live.outgoing(`${blank}x`), `${blank}x${lineOf(live.view().ready)}`);
});

test('only a higher edition is a new book', async () => {
    const { keeper, storage, live } = rig();
    await live.reply(at(43));
    await live.force();
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
    await live.force();
    await live.reply(at(41));
    model.pedant = answer({ MISSPELLINGS: ['Halvart | Halvard'] });
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
    const refreshing = rig({ state: big, messages: [] });
    refreshing.cast.unseen(2);
    await refreshing.live.force();
    await refreshing.live.reply(at(41));
    assert.equal(refreshing.cast.reads.story, 2);
    const release = refreshing.cast.hold();
    refreshing.keeper.change({ state: revised(bookState(BIG.map((fact) => fact.replace('skin | pale', 'skin | dark')))) });
    refreshing.live.view();
    await ticks();
    assert.equal(refreshing.cast.reads.story, 3);
    const saves = refreshing.storage.count('set');
    const ready = ScribeStore.read(refreshing.storage, ROOM, ScribeStore.Kind.Live).ready;
    assert.notEqual(ready, null);
    const told = refreshing.notices.count;
    refreshing.keeper.change({ trusted: false });
    release();
    await ticks();
    assert.equal(refreshing.storage.count('set'), saves);
    assert.equal(refreshing.notices.count, told);
    assert.equal(ScribeStore.read(refreshing.storage, ROOM, ScribeStore.Kind.Live).ready, ready);

    const replying = rig({ state: big, messages: [] });
    replying.cast.unseen(4);
    await replying.live.force();
    await replying.live.reply(at(41));
    replying.live.outgoing('One.');
    replying.live.sent();
    await replying.live.force();
    assert.equal(replying.cast.reads.story, 3);
    const hold = replying.cast.hold();
    const pending = replying.live.reply(at(43));
    await ticks();
    assert.equal(replying.cast.reads.story, 5);
    assert.deepEqual(plain(replying.model.roles().slice(-1)), ['Scribe']);
    const before = statuses(replying.live);
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
    assert.equal(live.view().findings.some((finding) => finding.fault === fault && finding.status === 'Open'), false);
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
    assert.deepEqual(asked(model), ['Scribe:']);
    live.view();
    live.outgoing('Hello.');
    live.view();
    await ticks();
    assert.deepEqual(asked(model), ['Scribe:']);
    assert.equal(live.view().now.message, 'MESSAGE-43');

    const failing = rig({ messages: story.slice(0, 43) });
    failing.model.failing.add('Scribe');
    failing.model.failing.add('Pedant');
    failing.live.view();
    await ticks();
    assert.deepEqual(asked(failing.model), ['Scribe:']);
    failing.live.view();
    await ticks();
    assert.deepEqual(asked(failing.model), ['Scribe:']);
    failing.model.failing.clear();
    failing.keeper.change({ state: revised(state) });
    failing.live.view();
    await ticks();
    assert.deepEqual(asked(failing.model), ['Scribe:']);
    failing.keeper.change({ edition: 2 });
    failing.live.view();
    await ticks();
    assert.deepEqual(asked(failing.model), ['Scribe:', 'Scribe:']);
    assert.equal(failing.live.view().now.message, 'MESSAGE-43');
    failing.live.view();
    await ticks();
    assert.equal(failing.model.calls.length, 2);

    const loading = rig({ messages: story.slice(0, 43), phase: 'Loading', stop: PAUSED.stop });
    loading.live.view();
    await ticks();
    assert.deepEqual(asked(loading.model), []);
    loading.keeper.change({ phase: 'Idle', stop: { reason: 'Done', problem: null } });
    loading.live.view();
    await ticks();
    assert.deepEqual(asked(loading.model), ['Scribe:']);

    const refused = rig({ messages: story.slice(0, 43), trusted: false });
    refused.live.view();
    await ticks();
    assert.deepEqual(asked(refused.model), []);
    refused.keeper.change({ trusted: true });
    refused.live.view();
    await ticks();
    assert.deepEqual(asked(refused.model), ['Scribe:']);
});

test('a reminder is made with no model call of its own', async () => {
    const big = bookState(BIG);
    const { keeper, model, live } = rig({ state: big });
    await live.force();
    await live.reply(at(41));
    assert.notEqual(live.view().ready, null);
    await live.reply(variant(41, [['Narrator', 'Halvard, thirty winters old, hums a sad tune.']], 'OTHER-41'));
    const back = model.calls.length;
    await live.reply(at(41));
    assert.equal(model.calls.length, back);
    assert.notEqual(live.view().ready, null);
    keeper.change({ state: revised(bookState(BIG.map((fact) => fact.replace('skin | pale', 'skin | dark')))) });
    live.view();
    await ticks();
    assert.equal(live.view().ready.includes('skin: dark'), true, live.view().ready);
    keeper.change({ edition: 2 });
    live.view();
    await ticks();
    assert.equal(live.view().now.message, 'MESSAGE-41');
    await live.force();
    assert.notEqual(live.view().ready, null);
    assert.equal(chooses(model), 0);
    assert.equal(tellings(model), 2);
    assert.deepEqual(plain([...new Set(model.calls.map((call) => call.role))]), ['Scribe']);
    assert.equal(Object.hasOwn(ScribeReminder, 'ChoosePrompt'), false);
    assert.equal(Object.hasOwn(ScribeLive.Settings, 'AnswersKept'), false);
});

test('a spent budget is said', async () => {
    const { keeper, model, notices, live } = rig();
    await live.reply(at(41));
    await live.force();
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
    assert.equal(live.outgoing('Hello.'), 'Hello.');
    assert.equal(live.view().ready, null);
    assert.equal(live.view().held, 'No reminder: the scene was last read at #41; the latest reply is #43.');
    await assert.rejects(live.suggest(), /^Error: The day's budget is spent: /);
    assert.equal(model.calls.length, calls);
    keeper.change({ spentToday: 2.5 });
    assert.equal(live.view().problem, null);
    await ticks();
    assert.deepEqual(asked(model).slice(-1), ['Scribe:']);
    assert.equal(live.view().problem, null);
});

test('a refused call is said', async () => {
    const big = bookState(BIG);
    for (const [system, words, role] of [
        [ScribeScene.Prompt, 'The scene was refused', 'Scribe'],
    ]) {
        const { model, live } = rig({ state: big, messages: [] });
        model.refusals.set(system, words);
        await live.force();
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
    await noticed.live.force();
    noticed.live.outgoing('Onward.');
    noticed.live.sent();
    noticed.model.refusals.set(ScribeScene.Prompt, 'The check was refused');
    noticed.live.view();
    const counted = noticed.notices.count;
    await noticed.live.reply(at(45));
    assert.equal(noticed.live.view().problem, 'The check was refused');
    assert.equal(noticed.notices.count > counted, true);
});

test('a step ending never undoes the player', async () => {
    const big = bookState(BIG);
    const { keeper, model, storage, live, cast } = rig({ state: big, messages: [] });
    cast.unseen(3);
    await live.force();
    await live.reply(at(41));
    live.use(GULL);
    const age = keyOf(live, 'Contradiction', 'MESSAGE-41');
    model.scene = TENT;
    const release = cast.hold();
    const pending = live.reply(at(43));
    await ticks();
    assert.equal(cast.reads.story, 4);
    assert.deepEqual(plain(model.roles().slice(-1)), ['Scribe']);
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

    const steady = rig({ state: big, messages: [] });
    steady.cast.unseen(3);
    await steady.live.force();
    await steady.live.reply(variant(41, [['Narrator', 'Halvart, forty winters old, hums by the fire.']], null));
    steady.live.use(GULL);
    const spelt = keyOf(steady.live, 'Spelling', 'MESSAGE-41');
    const steadyAge = keyOf(steady.live, 'Contradiction', 'MESSAGE-41');
    steady.model.scene = TENT;
    const laterFindings = steady.keeper.savedAlerts(at(43), steady.keeper.current.state);
    steady.keeper.savedAlerts = () => [];
    const free = steady.cast.hold();
    const going = steady.live.reply(at(43));
    await ticks();
    assert.equal(steady.cast.reads.story, 4);
    assert.equal(steady.live.outgoing('I wave.').includes(lineOf(GULL)), true);
    steady.live.sent();
    steady.live.dismiss(spelt);
    steady.live.dismiss(steadyAge);
    steady.keeper.change({ checkerAlerts: [...steady.keeper.current.checkerAlerts, ...laterFindings] });
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
});

test('a thrown-away step leaves no problem', async () => {
    const { keeper, model, live } = rig();
    await live.reply(at(41));
    assert.equal(live.view().problem, null);
    model.refusals.set(ScribeScene.Prompt, 'The scene was refused');
    const release = model.holdSystem(ScribeScene.Prompt);
    const pending = live.reply(at(43));
    await ticks();
    assert.equal(countOf(model, ScribeScene.Prompt), 2);
    keeper.change({ trusted: false });
    release();
    await pending;
    assert.equal(live.view().problem, null);
    assert.equal(live.view().now.message, 'MESSAGE-41');
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
    await live.force();
    const ready = live.view().ready;
    assert.ok(reminds(ready, 'Halvard'));
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
    await unread.live.force();
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
    await live.force();
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
    assert.equal(live.view().forced, false);
    assert.equal(live.view().ready, null);
    assert.equal(live.view().suggestion, GULL);
    assert.equal(statusOf(live, age), 'Open');
    assert.deepEqual(ledOf(storage), [AGE]);
    assert.equal(live.view().sends, 0);
    await live.force();
    assert.equal(live.view().ready, ready);

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
    assert.equal(notices.count, told + 6);

    const away = rig();
    await away.live.reply(at(41));
    await away.live.force();
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
    const basis = { revision: state.revision, first: [AGE], notes: ScribeLive.marked([]), story: 'recap2:abcd1234' };
    ScribeStore.write(kept, ROOM, ScribeStore.Kind.Live, {
        now: null,
        ready: `${TOLD} Halvard: age: 34.`,
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
        await side.live.force();
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
    await twice.live.force();
    assert.notEqual(twice.live.outgoing('Onward.'), 'Onward.');
    twice.live.sent();
    assert.equal(twice.live.view().sends, 0);
    twice.live.sent();
    assert.equal(twice.live.view().sends, 1);
});

test('a contradiction makes nothing go early, leads at the count, and is marked only once it went', async () => {
    const { storage, live } = rig({ settings: { refresh: 2 } });
    await live.reply(at(41));
    const age = keyOf(live, 'Contradiction', 'MESSAGE-41');
    assert.equal(live.view().ready, null);
    assert.deepEqual(ledOf(storage), []);
    assert.equal(live.outgoing('One.'), 'One.');
    live.sent();
    assert.equal(statusOf(live, age), 'Open');
    assert.equal(live.view().sends, 1);
    live.sent();
    assert.equal(live.view().sends, 2);
    await live.reply(at(45));
    const ready = live.view().ready;
    assert.ok(ready.startsWith(`${TOLD} Halvard: age: 34. `), ready);
    assert.deepEqual(ledOf(storage), [AGE]);
    assert.equal(statusOf(live, age), 'Open');
    assert.equal(live.outgoing('Three.'), `Three.${lineOf(ready)}`);
    assert.equal(statusOf(live, age), 'Open');
    live.sent();
    assert.equal(statusOf(live, age), 'Reminded');
    assert.deepEqual(ledOf(storage), []);
});

test('force prepares a reminder now, and the send resets the count and the flag', async () => {
    const { storage, live } = rig();
    await live.reply(at(41));
    assert.equal(live.view().due, false);
    assert.equal(live.view().forced, false);
    assert.equal(live.view().forceBlock, null);
    await live.force();
    const view = live.view();
    assert.equal(view.forced, true);
    assert.equal(view.due, true);
    assert.equal(view.edited, false);
    assert.ok(reminds(view.ready, 'Halvard'), view.ready);
    assert.equal(live.lines().ready, view.ready);
    assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).forced, true);
    live.sent();
    assert.equal(live.view().sends, 1);
    assert.equal(live.view().forced, true);
    assert.equal(live.outgoing('Go.'), `Go.${lineOf(view.ready)}`);
    live.sent();
    const after = live.view();
    assert.equal(after.forced, false);
    assert.equal(after.sends, 0);
    assert.equal(after.due, false);
    assert.equal(after.ready, null);
    assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).forced, false);
});

test('force with a reminder waiting makes no model call, and with no scene waits for the next reply', async () => {
    const waiting = rig({ settings: { refresh: 1 } });
    await waiting.live.reply(at(41));
    waiting.live.sent();
    await waiting.live.reply(at(45));
    const ready = waiting.live.view().ready;
    assert.ok(reminds(ready, 'Halvard'), ready);
    const calls = waiting.model.calls.length;
    await waiting.live.force();
    assert.equal(waiting.model.calls.length, calls);
    assert.equal(waiting.live.view().forced, true);
    assert.equal(waiting.live.view().ready, ready);

    const early = rig({ messages: [] });
    await early.live.force();
    assert.equal(early.model.calls.length, 0);
    assert.equal(early.live.view().forced, true);
    assert.equal(early.live.view().due, true);
    assert.equal(early.live.view().ready, null);
    await early.live.reply(at(41));
    assert.ok(reminds(early.live.view().ready, 'Halvard'), early.live.view().ready);
    early.keeper.change({ edition: 2 });
    assert.equal(early.live.view().forced, true);
});

test('empty clicks start the latest available reply once and a choice wins over its writer', async () => {
    const messages = [...story.slice(0, 41), { ...at(42), fromPlayer: true }];
    const { live, cast, keeper, model, storage } = rig({ messages });
    const release = cast.hold();
    const preparation = live.force(null, null);
    await ticks();
    await live.force(null, null);
    assert.equal(cast.reads.story, 1);
    const text = '  <b>Orla</b>  held\n雪.  ';
    await live.force(null, text);
    const first = live.lines().reminder;
    await live.force(null, text);
    assert.equal(live.lines().reminder, first);
    release();
    await preparation;
    assert.equal(model.calls.filter((call) => call.system === ScribeScene.Prompt).length, 1);
    assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).seen.id, at(41).id);
    assert.equal(live.lines().ready, text);
    for (const invalid of ['\t  ', '@: [Scribe]', 'x'.repeat(3001)]) {
        await assert.rejects(live.force(null, invalid));
        assert.equal(live.lines().reminder, first);
        assert.equal(live.lines().ready, text);
    }
    keeper.change({ reader: false });
    assert.equal(live.lines().ready, null);
    await assert.rejects(live.force(null, 'wrong tab'));
    keeper.change({ reader: true });
    live.view();
    await live.reply(at(45));
    assert.equal(live.view().selected, text);
    assert.equal(live.lines().ready, text);
    live.edit(text + ' more');
    assert.notEqual(live.lines().reminder, first);
    const second = live.lines().reminder;
    live.close();
    const opened = rig({}, storage);
    assert.equal(opened.live.lines().ready, text + ' more');
    assert.equal(opened.live.lines().reminder, second);
});

test('an empty click while stopped resumes preparation from the same scene', async () => {
    const { keeper, live } = rig();
    await live.reply(at(41));
    keeper.change({ phase: 'Stopped' });
    await live.force();
    assert.ok(live.view().preparationBlock);
    assert.equal(live.lines().ready, null);
    keeper.change({ phase: 'Idle' });
    live.view();
    await ticks();
    assert.ok(reminds(live.lines().ready));
});

test('a paused manual preparation survives reopening and draws resume it once', async () => {
    const fields = { messages: story.slice(0, 41) };
    const first = rig(fields);
    await first.live.reply(at(41));
    first.keeper.change(PAUSED);
    await first.live.force(null, null);
    assert.equal(ScribeStore.read(first.storage, ROOM, ScribeStore.Kind.Live).preparing, true);
    first.live.close();
    const reopened = rig({ ...fields, ...PAUSED }, first.storage);
    reopened.live.view();
    await ticks();
    assert.equal(reopened.model.calls.length, 0);
    reopened.keeper.change(READING);
    for (let redraw = 0; redraw < 8; redraw++) {
        reopened.live.view();
        await ticks();
    }
    assert.ok(reminds(reopened.live.lines().ready));
    assert.equal(tellings(reopened.model), 1);
    assert.equal(ScribeStore.read(first.storage, ROOM, ScribeStore.Kind.Live).preparing, false);
});

test('a refused prepared paragraph stays unattached until a successful retry after reload', async () => {
    const fields = { messages: story.slice(0, 41) };
    const room = rig(fields);
    room.cast.unseen(1);
    await room.live.reply(at(41));
    const release = room.cast.hold();
    const attempt = room.live.force();
    await ticks();
    assert.equal(ScribeStore.read(room.storage, ROOM, ScribeStore.Kind.Live).preparing, true);
    room.storage.refuseSetsMatching(/live/);
    release();
    await assert.rejects(attempt);
    const saved = ScribeStore.read(room.storage, ROOM, ScribeStore.Kind.Live);
    assert.equal(saved.ready, null);
    assert.equal(saved.preparing, true);
    assert.equal(room.live.view().ready, null);
    assert.equal(room.live.outgoing('I wait.'), 'I wait.');
    const calls = room.model.calls.length;
    room.live.view();
    await ticks();
    assert.equal(room.model.calls.length, calls);
    room.live.close();
    room.storage.allow();
    const reopened = rig(fields, room.storage);
    reopened.live.view();
    await ticks();
    assert.ok(reminds(reopened.live.lines().ready));
    assert.equal(reopened.live.lines().ready, ScribeStore.read(room.storage, ROOM, ScribeStore.Kind.Live).ready);
});

test('a reply and a failed replacement save preserve the selected reminder', async () => {
    const { live, storage } = rig();
    await live.reply(at(41));
    live.edit('one reminder');
    await live.reply(at(43));
    const older = 'one reminder';
    assert.equal(live.view().draft, null);
    assert.equal(live.lines().ready, older);
    await live.force(null, older);
    const first = live.lines().reminder;
    await live.reply(at(45));
    assert.equal(live.view().selected, older);
    assert.equal(live.lines().ready, older);
    storage.refuseSetsMatching(/live/);
    await assert.rejects(live.force(null, 'new reminder'));
    assert.equal(live.lines().reminder, first);
    assert.equal(live.lines().ready, older);
});

test('two empty clicks share the same preparation', async () => {
    const { model, live, cast } = rig({ state: bookState(BIG) });
    cast.unseen(1);
    await live.reply(at(41));
    const release = cast.hold();
    const first = live.force();
    await ticks();
    assert.equal(cast.reads.story, 2);
    await live.force();
    release();
    await first;
    assert.ok(reminds(live.view().ready, 'Halvard'), live.view().ready);
    await live.force();
    assert.equal(cast.reads.story, 2);
    assert.equal(chooses(model), 0);
});

test('force is refused, with the reason, while the book cannot be trusted', async () => {
    for (const [fields, words] of [
        [{ booked: false, trusted: false }, 'No book yet: adopt this chat first.'],
        [{ trusted: false }, 'The book has not finished its first reading.'],
        [{ trusted: false, mismatch: true, problem: 'The book is for another chat' }, 'The book is for another chat'],
        [{ trusted: false, problem: 'The book holds only part of the chat' }, 'The book holds only part of the chat'],
        [{ reader: false, trusted: false }, 'Another tab is reading this chat'],
    ]) {
        const { storage, model, live } = rig(fields);
        assert.equal(live.view().forceBlock, words, words);
        const saves = storage.count('set');
        await assert.rejects(live.force(), new RegExp(`^Error: ${words}$`), words);
        assert.equal(live.view().forced, false, words);
        assert.equal(storage.count('set'), saves, words);
        assert.equal(model.calls.length, 0, words);
        assert.deepEqual(linesOf(live.lines()), NO_LINES, words);
    }
});

test('an edited reminder is what goes, and nothing replaces it until it is sent or cleared', async () => {
    const big = bookState(BIG);
    const edit = '[Scribe] Mine, not yours.';
    const { keeper, storage, model, live } = rig({ state: big, settings: { refresh: 1 } });
    await live.reply(at(41));
    live.sent();
    assert.equal(live.view().due, true);
    live.edit(edit);
    const view = live.view();
    assert.equal(view.ready, edit);
    assert.equal(view.edited, true);
    assert.equal(live.lines().ready, edit);
    assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).edited, edit);
    await live.reply(at(43));
    assert.equal(live.lines().ready, edit);
    assert.equal(live.view().edited, true);
    assert.equal(live.view().draft, null);
    assert.equal(live.view().ready, edit);
    assert.equal(live.view().held, null);
    await live.reply(variant(43, [['Narrator', 'Halvard, thirty winters old, hums a sad tune.']], 'OTHER-43'));
    assert.equal(live.view().ready, edit);
    keeper.change({ state: revised(big) });
    live.view();
    await ticks();
    assert.equal(live.view().ready, edit);
    assert.equal(live.lines().ready, edit);
    assert.equal(chooses(model), 0);
    await live.force();
    assert.equal(live.view().ready, edit);
    assert.equal(chooses(model), 0);

    live.close();
    const reopened = rig({ state: big, settings: { refresh: 1 }, messages: keeper.current.messages }, storage);
    assert.equal(reopened.live.view().ready, edit);
    assert.equal(reopened.live.view().forced, true);
    reopened.keeper.change({ edition: 2 });
    assert.equal(reopened.live.view().ready, edit);
    assert.equal(reopened.live.view().edited, true);
    assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).edited, edit);
    assert.equal(reopened.live.outgoing('Go.'), `Go.${lineOf(edit)}`);
    reopened.live.sent();
    const sent = reopened.live.view();
    assert.equal(sent.ready, null);
    assert.equal(sent.edited, false);
    assert.equal(sent.forced, false);
    assert.equal(sent.sends, 0);
    assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).edited, null);
});

test('clear drops the edited reminder and the suggestion and resets the count', async () => {
    const { live } = rig();
    await live.reply(at(41));
    live.sent();
    live.sent();
    assert.equal(live.view().sends, 2);
    live.use(GULL);
    live.edit('[Scribe] Mine.');
    live.clear();
    const view = live.view();
    assert.equal(view.ready, null);
    assert.equal(view.edited, false);
    assert.equal(view.suggestion, null);
    assert.equal(view.sends, 0);
    assert.equal(live.outgoing('Go.'), 'Go.');
});

test('emptying a box that shows nothing keeps the forced flag, the count and the waiting reminder', async () => {
    const spent = rig({ settings: { refresh: 1, budget: 3 } });
    await spent.live.reply(at(41));
    spent.live.sent();
    await spent.live.reply(at(43));
    const stale = spent.keeper.view().state;
    spent.keeper.change({ spentToday: 5, state: { ...stale, revision: stale.revision + 1 } });
    assert.equal(spent.live.view().ready, null);
    const spentSends = spent.live.view().sends;
    spent.live.edit(' ', false);
    assert.equal(spent.live.view().sends, spentSends);
    spent.keeper.change({ spentToday: 0 });
    spent.live.view();
    await ticks();
    assert.notEqual(spent.live.view().ready, null);
    assert.notEqual(spent.live.outgoing('Go.'), 'Go.');

    const raised = rig({ settings: { refresh: 1, budget: 3 } });
    await raised.live.reply(at(41));
    raised.live.sent();
    await raised.live.reply(at(43));
    assert.notEqual(raised.live.view().ready, null);
    raised.keeper.change({ settings: { refresh: 3, budget: 3 } });
    assert.equal(raised.live.view().ready, null);
    assert.equal(raised.live.view().sends, 1);
    raised.live.edit(' ', false);
    assert.equal(raised.live.view().sends, 1);
    raised.live.sent();
    raised.live.sent();
    assert.equal(raised.live.view().sends, 3);
    assert.notEqual(raised.live.view().ready, null);

    const big = bookState(BIG);
    const rebuilding = rig({ settings: { refresh: 1, budget: 3 }, state: big });
    await rebuilding.live.reply(at(41));
    rebuilding.live.sent();
    await rebuilding.live.reply(at(43));
    const release = rebuilding.model.holdSystem(ScribeScene.Prompt);
    rebuilding.model.scene = TENT;
    const writing = rebuilding.live.reply(at(45));
    await ticks();
    assert.equal(rebuilding.live.view().ready, null);
    rebuilding.live.edit(' ', false);
    release();
    await writing;
    await ticks();
    assert.notEqual(rebuilding.live.view().ready, null);
    assert.equal(rebuilding.live.view().sends, 1);

    const shown = rig({ settings: { refresh: 1, budget: 3 } });
    await shown.live.reply(at(41));
    shown.live.sent();
    await shown.live.reply(at(43));
    assert.notEqual(shown.live.view().ready, null);
    shown.live.edit(' ', true);
    assert.equal(shown.live.view().ready, null);
    assert.equal(shown.live.view().sends, 0);
});

test('saving an empty box is Clear only when a line was shown when Edit was pressed', async () => {
    const { live } = rig();
    live.sent();
    live.sent();
    live.sent();
    await live.force();
    assert.equal(live.view().forced, true);
    live.edit('', false);
    const none = live.view();
    assert.equal(none.forced, true);
    assert.equal(none.sends, 3);
    assert.equal(none.edited, false);
    live.edit('a');
    assert.equal(live.view().edited, true);
    live.edit('', false);
    const kept = live.view();
    assert.equal(kept.edited, true);
    assert.equal(kept.forced, true);
    assert.equal(kept.sends, 3);
    live.edit('', true);
    const cleared = live.view();
    assert.equal(cleared.edited, false);
    assert.equal(cleared.forced, false);
    assert.equal(cleared.sends, 0);
});

test('a reminder that arrives while the box is open keeps its led list when an empty save follows', async () => {
    const { storage, live } = rig({ settings: { refresh: 1, budget: 3 } });
    await live.reply(at(41));
    live.outgoing('Hm.');
    live.sent();
    await live.reply(at(43));
    const led = ledOf(storage);
    assert.equal(led.includes(EYES), true);
    live.edit('', false);
    assert.deepEqual(ledOf(storage), led);
    assert.notEqual(live.view().ready, null);
    const text = live.outgoing('Go.');
    assert.notEqual(text, 'Go.');
    live.sent();
    assert.equal(
        statuses(live).some(([kind, , status]) => kind === 'Contradiction' && status === 'Reminded'),
        true,
    );
});

test('a forced reminder that is prepared while the box is open still goes after an empty save', async () => {
    const { live } = rig({ settings: { refresh: 6, budget: 3 } });
    live.sent();
    await live.force();
    await live.reply(at(41));
    const ready = live.view().ready;
    assert.notEqual(ready, null);
    live.edit('', false);
    const view = live.view();
    assert.equal(view.ready, ready);
    assert.equal(view.forced, true);
    assert.equal(live.outgoing('Go.'), `Go.${lineOf(ready)}`);
});

test('a forced reminder is made when the check it was pressed in discards its own compose', async () => {
    const big = bookState(BIG);
    for (const late of [false, true]) {
        const { live, keeper, model, storage } = rig({ settings: { refresh: 6, budget: 3 }, state: big });
        await live.reply(at(41));
        const release = model.holdSystem(ScribePedant.Prompt);
        const pending = live.reply(at(43));
        await ticks();
        if (!late) {
            await live.force();
        }
        const book = keeper.view().state;
        keeper.change({ state: revised(book) });
        release();
        await pending;
        await ticks();
        if (late) {
            await live.force();
        }
        live.view();
        await ticks();
        const view = live.view();
        assert.equal(view.forced, true, String(late));
        assert.notEqual(view.ready, null, String(late));
        const basis = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).basis;
        assert.equal(basis.revision, book.revision + 1, String(late));
        assert.equal(chooses(model), 0, String(late));
        assert.notEqual(live.outgoing('Go.'), 'Go.', String(late));
        live.sent();
        assert.equal(live.outgoing('Again.'), 'Again.', String(late));
    }
});

test('force does not start a second rebuild while one is running', async () => {
    const big = bookState(BIG);
    const { live, keeper, model, cast } = rig({ settings: { refresh: 1, budget: 3 }, state: big });
    cast.unseen(3);
    await live.reply(at(41));
    live.sent();
    await live.reply(at(43));
    const release = cast.hold();
    keeper.change({ state: revised(bookState(BIG.map((fact) => fact.replace('skin | pale', 'skin | dark')))) });
    live.view();
    await ticks();
    assert.equal(cast.reads.story, 4);
    await live.force();
    assert.equal(cast.reads.story, 4);
    assert.equal(live.view().forced, true);
    release();
    await ticks();
    assert.equal(cast.reads.story, 4);
    assert.notEqual(live.view().ready, null);
    assert.equal(live.view().ready.includes('skin: dark'), true, live.view().ready);
    assert.equal(chooses(model), 0);
});

test('a due automatic paragraph uses the saved tail when the book advances during the check', async () => {
    const { live, model, keeper, storage } = rig({ settings: { refresh: 1, budget: 3 } });
    const release = model.holdSystem(ScribeScene.Prompt);
    const checking = live.reply(at(41));
    await ticks();
    const newer = revised(bookState(FACTS.map((fact) => fact.replace('Halvard | age | 34', 'Halvard | age | forty'))));
    keeper.change({ state: newer, read: 41, lastRead: { id: at(41).id, position: 41 }, unread: [] });
    release();
    await checking;
    await ticks();
    assert.equal(live.view().forced, false);
    assert.equal(ScribeStore.read(storage, ROOM, 'live').basis.revision, newer.revision);
    assert.ok(live.lines().ready.includes('age: forty'));
    assert.equal(countOf(model, ScribePedant.Prompt), 0);
});

test('an automatic writer in flight cannot arm an unread version or authorize a stale frame offer', async () => {
    const { live, model, keeper, storage } = rig({ settings: { refresh: 1, budget: 3 } });
    const held = model.holdSystem(ScribeReminder.StoryPrompt);
    const checking = live.reply(at(41));
    await ticks();
    assert.equal(tellings(model), 1);
    keeper.change({ readerCurrent: false });
    held();
    await checking;
    await ticks();
    assert.equal(live.lines().ready, null);
    assert.equal(ScribeStore.read(storage, ROOM, 'live').ready, null);
    keeper.change({ readerCurrent: true, state: revised(keeper.view().state) });
    live.view();
    await ticks();
    const offer = live.lines();
    assert.ok(offer.ready);
    keeper.change({ readerCurrent: false });
    assert.equal(live.lines().ready, null);
    assert.equal(live.starting({ ...offer, key: 'stale-frame' }), false);
    await live.force(null, 'Use my own paragraph.');
    assert.equal(live.lines().ready, 'Use my own paragraph.');
});

test('an edited reminder preserves the textarea text through sending and excludes the attached paragraph from the Book', () => {
    const { storage, live } = rig();
    for (const typed of ['Hello there', 'line one\nline two\r\n\tline three', '@: [Scribe] x', '  separated  words  ']) {
        live.edit(typed);
        assert.equal(live.view().ready, typed);
        assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).edited, typed);
        const sent = live.outgoing('I wave.');
        assert.equal(sent, 'I wave.' + lineOf(ScribeSender.paragraph(typed)));
        const post = { ...live.posting(), floor: 0, after: null, confirmed: true };
        const builder = new CampaignBuilder('Orla').player(sent);
        const read = ScribeIntake.read(builder.messages, { posts: [post] });
        assert.equal(read.messages[0].text, 'Orla (player): I wave.');
        live.sent();
        assert.equal(live.lines().ready, null);
    }
});

test('an emptied box clears the reminder and keeps the suggestion', async () => {
    const { live } = rig();
    await live.reply(at(41));
    await live.force();
    live.use(GULL);
    for (const empty of ['', '   ', '[Scribe]', '@: [Scribe]   ', '@:', ' \n\t ', '@: @: [Scribe]', '@:@: @:']) {
        live.edit('[Scribe] Mine.');
        live.sent();
        assert.equal(live.view().edited, true);
        live.edit(empty);
        const view = live.view();
        assert.equal(view.ready, null, JSON.stringify(empty));
        assert.equal(view.edited, false, JSON.stringify(empty));
        assert.equal(view.forced, false, JSON.stringify(empty));
        assert.equal(view.sends, 0, JSON.stringify(empty));
        assert.equal(view.suggestion, GULL, JSON.stringify(empty));
    }
});

test('an edit over 3,000 characters is refused and the last accepted text stays', async () => {
    const { storage, live } = rig();
    const padded = (size) => `[Scribe] ${'x'.repeat(size - '[Scribe] '.length)}`;
    const refused = /^Error: A reminder may be at most 3,000 characters; nothing was saved\.$/;
    live.edit(padded(3000));
    assert.equal(live.view().ready.length, 3000);
    assert.throws(() => live.edit(padded(3001)), refused);
    assert.equal(live.view().ready, padded(3000));
    assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).edited, padded(3000));
    const deseret = String.fromCodePoint(0x10400);
    const edge = `[Scribe] ${deseret.repeat(2991)}`;
    assert.equal(Array.from(edge).length, 3000);
    assert.equal(bytes(edge) > 3000, true);
    live.edit(edge);
    assert.equal(live.view().ready, edge);
    const over = `[Scribe] ${deseret.repeat(2992)}`;
    assert.throws(() => live.edit(over), refused);
    assert.equal(live.view().ready, edge);
});

test('a clear or a send while a reminder is being made keeps what that check makes out', async () => {
    const big = bookState(BIG);
    const went = [];
    for (const [name, act] of [
        ['clear', (live) => live.clear()],
        [
            'send',
            (live) => {
                went.push(live.outgoing('Go.'));
                live.sent();
            },
        ],
    ]) {
        const { storage, model, live, cast } = rig({ state: big });
        cast.unseen(3);
        await live.reply(at(41));
        await live.force();
        assert.notEqual(live.view().ready, null, name);
        model.scene = TENT;
        const hold = cast.hold();
        const pending = live.reply(at(43));
        await ticks();
        assert.equal(cast.reads.story, 4, name);
        act(live);
        hold();
        await pending;
        await ticks();
        const view = live.view();
        assert.equal(view.now.place, 'The tent', name);
        assert.equal(cast.reads.story, 4, name);
        assert.equal(chooses(model), 0, name);
        if (name === 'clear') {
            assert.equal(view.ready, null, name);
            assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).ready, null, name);
            assert.equal(view.forced, false, name);
        } else {
            assert.deepEqual(went, ['Go.']);
            assert.equal(view.forced, true, name);
            assert.equal(reminds(view.ready, 'The story so far: '), true, view.ready);
        }
    }
});

test('a record saved before the edit and the flag loads without them, and bad ones are dropped', async () => {
    const base = {
        now: null,
        ready: null,
        led: [],
        sends: 2,
        findings: [],
        suggestion: null,
        seen: null,
        reminded: null,
    };
    const old = new FakeStorage();
    ScribeStore.write(old, ROOM, ScribeStore.Kind.Live, base);
    const loaded = rig({}, old).live.view();
    assert.equal(loaded.edited, false);
    assert.equal(loaded.forced, false);
    assert.equal(loaded.ready, null);
    assert.equal(loaded.sends, 2);
    const stored = [
        [{ edited: 5 }, false],
        [{ edited: null }, false],
        [{ edited: '[Scribe] one\ntwo' }, false],
        [{ edited: 'no marker here' }, false],
        [{ edited: '[Scribe]x' }, false],
        [{ edited: '[Scribe] ' }, false],
        [{ edited: '[Scribe]' }, false],
        [{ edited: `[Scribe] ${'x'.repeat(2992)}` }, false],
        [{ edited: '@: [Scribe] ok' }, false],
        [{ edited: '@:[Scribe] ok' }, false],
        [{ edited: '@: @: [Scribe] ok' }, false],
        [{ edited: '[Scribe]  ok' }, false],
        [{ edited: '[Scribe] ok' }, true],
        [{ edited: `[Scribe] ${'x'.repeat(2991)}` }, true],
    ];
    for (const [fields, kept] of stored) {
        const storage = new FakeStorage();
        const editedFor = { id: at(59).id, fingerprint: at(59).fingerprint };
        ScribeStore.write(storage, ROOM, ScribeStore.Kind.Live, { ...base, ...fields, editedFor });
        const view = rig({}, storage).live.view();
        assert.equal(view.unconfirmed?.text ?? null, kept ? fields.edited : null, JSON.stringify(fields).slice(0, 40));
        assert.equal(view.ready, null);
        assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).edited, kept ? fields.edited : null);
    }
    const unplaced = new FakeStorage();
    ScribeStore.write(unplaced, ROOM, ScribeStore.Kind.Live, { ...base, edited: '[Scribe] ok' });
    const unplacedView = rig({}, unplaced).live.view();
    assert.equal(unplacedView.ready, null);
    assert.equal(unplacedView.stale, true);
    assert.equal(unplacedView.draft, '[Scribe] ok');
    for (const [forced, kept] of [
        [true, true],
        ['yes', false],
        [1, false],
        [null, false],
    ]) {
        const storage = new FakeStorage();
        ScribeStore.write(storage, ROOM, ScribeStore.Kind.Live, { ...base, forced });
        assert.equal(rig({}, storage).live.view().forced, kept, String(forced));
    }
});

test('a doubled lead is stripped, the edit goes out with one lead, and the next reading lifts it', async () => {
    const { live } = rig();
    for (const typed of ['@: @: [Scribe] Halvard has grey eyes.', '@:@:[Scribe] x', '@: @: Plain words']) {
        live.edit(typed);
        const stored = live.view().ready;
        assert.equal(stored, typed);
        const sent = live.outgoing('I wave.');
        assert.equal(sent, `I wave.${lineOf(ScribeSender.paragraph(stored))}`, typed);
        const builder = new CampaignBuilder('Orla');
        builder.player(sent);
        const post = { ...live.posting(), floor: 0, after: null, confirmed: true };
        const read = ScribeIntake.read(builder.messages, { posts: [post] });
        assert.equal(read.messages[0].text, 'Orla (player): I wave.', typed);
        live.sent();
    }
});

test('a doubled lead with nothing after the marker acts as Clear', async () => {
    const { live } = rig();
    live.edit('[Scribe] Mine.');
    live.edit('@: @: [Scribe]');
    const view = live.view();
    assert.equal(view.edited, false);
    assert.equal(view.ready, null);
    assert.equal(live.outgoing('I wave.'), 'I wave.');
});

test('emptying a box that held nothing changes nothing, and emptying one that held a reminder clears it', async () => {
    const { storage, live } = rig({ messages: [] });
    live.sent();
    live.sent();
    live.sent();
    await live.force();
    const before = live.view();
    assert.equal(before.forced, true);
    assert.equal(before.sends, 3);
    const saves = storage.count('set');
    for (const empty of [' ', '', '@: @:', '[Scribe]']) {
        live.edit(empty);
        const view = live.view();
        assert.equal(view.forced, true, JSON.stringify(empty));
        assert.equal(view.sends, 3, JSON.stringify(empty));
        assert.equal(view.edited, false, JSON.stringify(empty));
    }
    assert.equal(storage.count('set'), saves);
    await live.reply(at(41));
    assert.ok(reminds(live.view().ready, 'Halvard'), live.view().ready);
    live.edit(' ');
    const cleared = live.view();
    assert.equal(cleared.ready, null);
    assert.equal(cleared.forced, false);
    assert.equal(cleared.sends, 0);
});

test('a forced reminder goes once, even if it was rebuilt between the take and the send', async () => {
    const { keeper, live } = rig();
    await live.reply(at(41));
    await live.force();
    const first = live.view().ready;
    assert.equal(live.outgoing('Go.'), `Go.${lineOf(first)}`);
    keeper.change({ state: revised(bookState(FACTS)) });
    live.view();
    await ticks();
    live.sent();
    const after = live.view();
    assert.equal(after.forced, false);
    assert.equal(after.sends, 0);
    assert.equal(live.outgoing('Again.'), 'Again.');
});

test('the box shows only what will go: nothing while the book is held or another tab is reading', async () => {
    const edited = rig();
    edited.live.edit('[Scribe] Mine.');
    assert.equal(edited.live.view().ready, '[Scribe] Mine.');
    edited.keeper.change({ trusted: false, problem: 'The book holds only part of the chat' });
    assert.equal(edited.live.view().ready, null);
    assert.equal(edited.live.lines().ready, null);
    edited.keeper.change({ trusted: true, problem: null });
    assert.equal(edited.live.view().ready, '[Scribe] Mine.');
    assert.equal(edited.live.view().ready, edited.live.lines().ready);

    const prepared = rig();
    await prepared.live.reply(at(41));
    await prepared.live.force();
    assert.notEqual(prepared.live.view().ready, null);
    prepared.keeper.change({ reader: false, trusted: false });
    assert.equal(prepared.live.view().ready, null);
    assert.equal(prepared.live.lines().ready, null);
});

test('a Checker ruling preserves the selected paragraph across a reply and reload', async () => {
    const { live, keeper, model, storage } = rig({ settings: { refresh: 1, budget: 3 } });
    await live.reply(at(41));
    const before = live.view().ready;
    assert.ok(before);
    await live.force(null, 'The old version of my paragraph.');
    const previous = live.lines();
    const calls = model.calls.filter((call) => call.system === ScribeReminder.StoryPrompt).length;
    const decision = { finding: 'eyes', sequence: 18, version: 'one', status: 'settled', factIds: [AGE, factIn(state, 'scarred and lean')] };
    keeper.change({ state: { ...state, checkerRulings: [decision] } });
    model.story = 'The new account has reached the mill.';
    assert.equal(live.lines().ready, previous.ready);
    assert.equal(live.view().selected, previous.ready);
    assert.equal(live.view().draft, null);
    await ticks();
    assert.equal(live.view().ready, previous.ready);
    assert.equal(model.calls.filter((call) => call.system === ScribeReminder.StoryPrompt).length, calls);
    live.close();
    const reopened = rig({ ...keeper.view(), state: { ...state, checkerRulings: [{ ...decision, status: 'reopened' }] } }, storage);
    assert.equal(reopened.live.view().selected, previous.ready);
    assert.equal(reopened.live.lines().ready, previous.ready);
    assert.equal(reopened.live.outgoing('Go.'), 'Go.' + lineOf(ScribeSender.paragraph(previous.ready)));
    reopened.live.sent();
    assert.equal(reopened.live.lines().ready, null);
});

test('narrowing public evidence withdraws a shared ruling before send and reloads without telling the writer private or unknown claims', async () => {
    const fixture = (number, wording, finding) => {
        const passage = at(number);
        const block = passage.blocks[0];
        const source = { messageId: passage.id, blockNumber: block.blockNumber, position: number,
            fingerprint: passage.fingerprint, speaker: block.speaker, quote: block.text };
        return { finding, sequence: number, version: 'saved', status: 'settled', action: 'explain',
            shareInReminder: true, canonical: wording, source, earlier: null, support: [ScribeLog.passage(source, passage)], factIds: [] };
    };
    const publicRuling = fixture(13, 'The noon bell marks the handover.', 'watch');
    const hidden = fixture(7, 'The scar identifies the deserter.', 'scar');
    const uncovered = fixture(41, 'A private letter names the courier.', 'letter');
    const mentioned = { ...fixture(15, 'Halvard is scarred and lean.', 'appearance'), factIds: [BUILD] };
    const ruled = { ...state, checkerRulings: [publicRuling, hidden, uncovered, mentioned] };
    const first = rig({ state: ruled, settings: { refresh: 1, budget: 3 } });
    await first.live.reply(at(41));
    const request = first.model.calls.filter((call) => call.system === ScribeReminder.StoryPrompt).at(-1).user;
    assert.ok(request.includes(publicRuling.canonical));
    for (const decision of [hidden, uncovered, mentioned]) {
        assert.ok(!request.includes(decision.canonical));
    }
    const narrowed = { ...ruled, scenes: ruled.scenes.map((scene) => ({ ...scene, narrowed: true })) };
    first.keeper.change({ state: narrowed });
    assert.equal(first.live.lines().ready, null);
    first.live.close();
    const reloaded = rig({ ...first.keeper.view(), state: narrowed }, first.storage);
    reloaded.live.view();
    await ticks();
    const next = reloaded.model.calls.filter((call) => call.system === ScribeReminder.StoryPrompt);
    assert.equal(next.length, 1);
    assert.ok(!next[0].user.includes('SHARED RULINGS:'));
    assert.ok(!next[0].user.includes(publicRuling.canonical));
});

test('force with a stale waiting reminder rebuilds it, with or without budget left', async () => {
    for (const spent of [0, 5]) {
        const { keeper, live } = rig({ settings: { refresh: 1, budget: 3 } });
        await live.reply(at(41));
        live.sent();
        await live.reply(at(43));
        const waiting = live.view().ready;
        assert.notEqual(waiting, null, String(spent));
        keeper.change({ spentToday: spent, state: revised(bookState(FACTS)) });
        await live.force();
        await ticks();
        const view = live.view();
        assert.equal(view.forced, true, String(spent));
        assert.notEqual(view.ready, null, String(spent));
        assert.equal(live.lines().ready, view.ready, String(spent));
    }
});

const SITUATION_SAID = 'hums by the fire';
const SITUATION_BOOK = 'The tale goes on, line 39.';
const PEDANT_SITUATION = answer({ SITUATION: [`${SITUATION_SAID} | ${SITUATION_BOOK}`] });

test('a situation finding is raised, kept, dismissed and dropped with its reply', async () => {
    const { keeper, storage, model, notify, live } = rig();
    model.pedant = PEDANT_SITUATION;
    await live.reply(at(41));
    assert.deepEqual(statuses(live), [['Situation', 'MESSAGE-41', 'Open']]);
    const key = keyOf(live, 'Situation', 'MESSAGE-41');
    const raised = findingOf(live, key);
    assert.equal(raised.said, SITUATION_SAID);
    assert.equal(raised.book, SITUATION_BOOK);
    assert.deepEqual(plain(raised.can), { told: false, spent: false });

    assert.equal(model.calls.filter((call) => call.role === 'Pedant').length, 0);

    assert.deepEqual(ledOf(storage), []);
    live.outgoing('Onward.');
    live.sent();
    assert.equal(statusOf(live, key), 'Open');
    assert.equal(live.view().due, false);

    live.close();
    const again = following(
        keeper,
        ScribeLive.open({ keeper, storage, roomId: ROOM, ask: model.ask, clock: CLOCK, notify, ...QUIET.readers }),
    );
    assert.deepEqual(statuses(again), [['Situation', 'MESSAGE-41', 'Open']]);
    assert.equal(findingOf(again, key).said, SITUATION_SAID);
    assert.equal(findingOf(again, key).book, SITUATION_BOOK);

    again.dismiss(key);
    assert.equal(statusOf(again, key), 'Dismissed');
    const pedantCalls = () => model.calls.filter((call) => call.role === 'Pedant').length;
    for (const said of [SITUATION_SAID, `${SITUATION_SAID}.`]) {
        model.pedant = answer({ SITUATION: [`${said} | ${SITUATION_BOOK}`] });
        await again.reply(at(45));
        keeper.change({ state: revised(keeper.current.state) });
        const checked = pedantCalls();
        await again.reply(at(41));
        assert.equal(pedantCalls(), checked, `durable result for ${said}`);
        assert.equal(statusOf(again, key), 'Dismissed', said);
        assert.deepEqual(
            statuses(again).filter((entry) => entry[1] === 'MESSAGE-41'),
            [...(said === SITUATION_SAID ? [] : [['Situation', 'MESSAGE-41', 'Open']]), ['Situation', 'MESSAGE-41', 'Dismissed']],
            said,
        );
    }
    await again.told(key);
    assert.equal(statusOf(again, key), 'Dismissed');

    model.pedant = 'All of it fits.';
    const regenerated = variant(41, [['Narrator', 'Halvard, forty winters old, sleeps by the fire.']], 'OTHER-41');
    await again.reply(regenerated);
    assert.deepEqual(statuses(again), []);
});

test('a situation finding with a missing quote is not kept', () => {
    const { keeper, model, notify } = rig();
    const shaped = new FakeStorage();
    const finding = {
        kind: 'Situation',
        message: 'MESSAGE-41',
        position: 41,
        said: SITUATION_SAID,
        key: 'situation-key',
        status: 'Open',
    };
    ScribeStore.write(shaped, ROOM, ScribeStore.Kind.Live, { findings: [finding], sends: 0 });
    const reopened = ScribeLive.open({
        keeper,
        storage: shaped,
        roomId: ROOM,
        ask: model.ask,
        clock: CLOCK,
        notify,
        ...QUIET.readers,
    });
    assert.equal(reopened.view().findings.length, 0);
});

/**
 * @param {FakeStorage} storage
 * @return {object[]}
 */
function notesOf(storage) {
    return plain(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).notes);
}

/**
 * @param {{ id: string, fingerprint: string, position: number }} message
 * @param {string} name
 * @param {string} kind
 * @param {string} text
 * @return {object}
 */
function stamped(message, name, kind, text) {
    return { name, kind, text, message: message.id, fingerprint: message.fingerprint, position: message.position };
}

/**
 * @param {...string} lines
 * @return {string}
 */
function nowOf(...lines) {
    return answer({ NOW: lines });
}

const BARE = Object.freeze({
    now: null,
    ready: null,
    led: [],
    sends: 0,
    findings: [],
    suggestion: null,
    seen: null,
    reminded: null,
});

function withSavedNotes(notes, fields = {}) {
    const storage = new FakeStorage();
    ScribeStore.write(storage, ROOM, ScribeStore.Kind.Live, { ...BARE, notes });
    return rig(fields, storage);
}

for (const [subject, kind, value] of [
    ['Halvard', 'Wearing', 'a dented breastplate'], ['Halvard', 'Looks', 'silver hair'],
    ['Orla (player)', 'Wearing', 'a grey cloak'], ['Mirelle', 'Looks', 'unknown'],
]) {
    test('a current reply does not start a second Checker or collect inventory for ' + subject + ' ' + value, async () => {
        const { model, storage, live } = rig();
        model.pedant = nowOf(subject + ' | ' + kind + ' | ' + value);
        await live.reply(at(41));
        assert.deepEqual(notesOf(storage), []);
        assert.deepEqual(plain(live.view().checkerRows), []);
        assert.equal(countOf(model, ScribePedant.Prompt), 0);
        live.close();
        const restored = rig({}, storage);
        await restored.live.reply(at(43));
        assert.deepEqual(notesOf(storage), []);
        assert.equal(countOf(restored.model, ScribePedant.Prompt), 0);
    });
}

test('noted keys a note by its name without case or a leading the, and by its kind', () => {
    const first = { id: 'A', fingerprint: 'fa', position: 5 };
    const base = [stamped(first, 'Thessaly', 'Wearing', 'a cloak')];
    const given = (name, text, kind = 'Wearing') => [{ name, kind, text }];
    const at4 = { id: 'B', fingerprint: 'fb', position: 4 };
    assert.deepEqual(plain(ScribeLive.noted(base, given('Thessaly', 'a coat'), at4)), plain(base));
    const same = { id: 'C', fingerprint: 'fc', position: 5 };
    assert.deepEqual(plain(ScribeLive.noted(base, given('THESSALY', 'a coat'), same)), [
        stamped(same, 'THESSALY', 'Wearing', 'a coat'),
    ]);
    const newer = { id: 'D', fingerprint: 'fd', position: 6 };
    assert.deepEqual(plain(ScribeLive.noted(base, given('The Thessaly', 'a coat'), newer)), [
        stamped(newer, 'The Thessaly', 'Wearing', 'a coat'),
    ]);
    assert.equal(ScribeLive.noted(base, given('Thessaly', 'tall', 'Looks'), newer).length, 2);
    assert.deepEqual(plain(ScribeLive.noted(base, [], first)), []);
    const other = [...base, stamped(newer, 'Veyra', 'Looks', 'short')];
    assert.deepEqual(plain(ScribeLive.noted(other, given('Thessaly', 'a coat'), first)), [
        stamped(newer, 'Veyra', 'Looks', 'short'),
        stamped(first, 'Thessaly', 'Wearing', 'a coat'),
    ]);
});

test('noted retains all named subjects and multiple distinct notes from one Checker answer', () => {
    const notes = Array.from({ length: 100 }, (unused, index) =>
        stamped({ id: `M${index + 1}`, fingerprint: 'f', position: index + 1 }, `Name${index + 1}`, 'Wearing', 'x'),
    );
    const newest = { id: 'M101', fingerprint: 'f', position: 101 };
    const added = ScribeLive.noted(notes, [{ name: 'Fresh', kind: 'Wearing', text: 'y' }], newest);
    assert.equal(added.length, 101);
    assert.equal(added.some((note) => note.name === 'Name1'), true);
    assert.equal(added.some((note) => note.name === 'Fresh'), true);
    const oldest = { id: 'M0', fingerprint: 'f', position: 0 };
    const refused = ScribeLive.noted(notes, [{ name: 'Stale', kind: 'Wearing', text: 'y' }], oldest);
    assert.equal(refused.length, 101);
    assert.equal(refused.some((note) => note.name === 'Stale'), true);
    const garments = ScribeLive.noted([], ['a cloak', 'a hat'].map((text) => ({ name: 'Ada', kind: 'Wearing', text })), newest);
    assert.deepEqual(plain(garments.map((note) => note.text)), ['a cloak', 'a hat']);
});

for (const id of ['OTHER-47', null]) {
    test('a regenerated or edited reply drops legacy appearance data without collecting a replacement · ' + id, async () => {
        const original = at(47);
        const note = stamped(original, 'Halvard', 'Wearing', 'a coat');
        const { storage, model, live } = withSavedNotes([note]);
        await live.reply(original);
        assert.deepEqual(notesOf(storage), [note]);
        model.pedant = nowOf('Halvard | wearing | a hood');
        await live.reply(variant(47, [['Narrator', 'The guard turns up his hood.']], id));
        assert.deepEqual(notesOf(storage), []);
        assert.equal(countOf(model, ScribePedant.Prompt), 0);
    });
}

test('a looks note goes when the book has read its message and a wearing note stays', async () => {
    const { keeper, storage, model, live } = withSavedNotes([stamped(at(43), 'Halvart', 'Wearing', 'a cloak'),
        stamped(at(43), 'Halvart', 'Looks', 'green eyes')]);
    await live.reply(at(43));
    const both = notesOf(storage);
    assert.equal(both.length, 2);
    keeper.change({ lastRead: { id: 'MESSAGE-42', position: 42 } });
    live.view();
    assert.deepEqual(notesOf(storage), both);
    keeper.change({ lastRead: null });
    live.view();
    assert.deepEqual(notesOf(storage), both);
    const saves = storage.count('set');
    keeper.change({ lastRead: { id: 'MESSAGE-43', position: 43 } });
    live.view();
    assert.deepEqual(notesOf(storage), [stamped(at(43), 'Halvart', 'Wearing', 'a cloak')]);
    assert.equal(storage.count('set') > saves, true);

    model.scene = ROAD;
    model.pedant = '';
    await live.reply(at(47));
    assert.equal(live.view().now.day, 2);
    assert.deepEqual(notesOf(storage), [stamped(at(43), 'Halvart', 'Wearing', 'a cloak')]);
});

test('a checker that did not run leaves the notes as they were and asks for nothing new', async () => {
    const { keeper, storage, model, live } = withSavedNotes([stamped(at(41), 'Halvard', 'Wearing', 'a cloak')]);
    await live.reply(at(41));
    const before = notesOf(storage);
    assert.equal(before.length, 1);

    model.pedant = nowOf('Halvart | wearing | a hat');
    model.failing.add('Pedant');
    await live.reply(at(43));
    assert.deepEqual(notesOf(storage), before);
    assert.equal(model.calls.filter((call) => call.system === ScribePedant.Prompt).length, 0);
    model.failing.clear();

    model.refusals.set(ScribePedant.Prompt, 'The model refused');
    await live.reply(at(47));
    assert.deepEqual(notesOf(storage), before);
    model.refusals.clear();

    keeper.change({ spentToday: 3 });
    const calls = model.calls.length;
    await live.reply(at(49));
    assert.equal(model.calls.length, calls);
    assert.deepEqual(notesOf(storage), before);
});

test('a checked reply seen again gives its notes back without a call, and an old entry gives none', async () => {
    const first = rig();
    first.model.pedant = (input) => PEDANT(input) + '\n' + nowOf('Halvard | wearing | a cloak');
    await first.live.reply(at(41));
    first.live.close();
    const saved = ScribeStore.read(first.storage, ROOM, ScribeStore.Kind.Live);
    assert.deepEqual(plain(saved.checked[0].notes), []);
    saved.checked[0].notes = [stamped(at(41), 'Halvard', 'Wearing', 'a cloak')];
    const findings = statuses(first.live);
    assert.equal(findings.length > 0, true);

    const storage = new FakeStorage();
    ScribeStore.write(storage, ROOM, ScribeStore.Kind.Live, { ...saved, notes: [], seen: null });
    const reopened = rig({}, storage);
    await reopened.live.reply(at(41));
    assert.equal(reopened.model.calls.length, 0);
    assert.deepEqual(notesOf(storage), [stamped(at(41), 'Halvard', 'Wearing', 'a cloak')]);
    assert.deepEqual(statuses(reopened.live), findings);

    const older = new FakeStorage();
    const checked = saved.checked.map(({ notes, ...entry }) => entry);
    ScribeStore.write(older, ROOM, ScribeStore.Kind.Live, { ...saved, notes: [], seen: null, checked });
    const legacy = rig({}, older);
    await legacy.live.reply(at(41));
    assert.equal(legacy.model.calls.length, 0);
    assert.deepEqual(notesOf(older), []);
    assert.deepEqual(statuses(legacy.live), findings);
    for (const junk of [null, 'many', { 0: 1 }, 7]) {
        const odd = new FakeStorage();
        const broken = saved.checked.map((entry) => ({ ...entry, notes: junk }));
        ScribeStore.write(odd, ROOM, ScribeStore.Kind.Live, { ...saved, notes: [], seen: null, checked: broken });
        const tolerant = rig({}, odd);
        await tolerant.live.reply(at(41));
        assert.equal(tolerant.model.calls.length, 0, JSON.stringify(junk));
        assert.deepEqual(notesOf(odd), [], JSON.stringify(junk));
    }
});

test('all saved subject notes are kept and malformed records are dropped one by one', async () => {
    const seeded = Array.from({ length: 100 }, (unused, index) => ({
        name: `Seed${index}`,
        kind: 'Wearing',
        text: 'a coat',
        message: `OLD-${index}`,
        fingerprint: 'f',
        position: index - 99,
    }));
    const storage = new FakeStorage();
    ScribeStore.write(storage, ROOM, ScribeStore.Kind.Live, { ...BARE, notes: seeded });
    const { model, live } = rig({}, storage);
    model.pedant = nowOf('Halvard | wearing | a cloak');
    await live.reply(at(41));
    const kept = notesOf(storage);
    assert.equal(kept.length, 100);
    assert.equal(kept.some((note) => note.name === 'Seed0'), true);
    assert.equal(kept.some((note) => note.name === 'Seed1'), true);
    assert.equal(kept.some((note) => note.name === 'Halvard'), false);

    const junk = [
        null,
        7,
        'note',
        [seeded[3]],
        { ...seeded[3], kind: 12 },
        { ...seeded[3], kind: null },
        { ...seeded[3], position: undefined },
        { ...seeded[3], position: 1.5 },
        { ...seeded[3], name: 5 },
        { ...seeded[3], name: '' },
        { ...seeded[3], text: '' },
        { ...seeded[3], text: null },
        { ...seeded[3], message: 3 },
        { ...seeded[3], fingerprint: 3 },
        { ...seeded[3], fingerprint: undefined },
    ];
    const mixed = new FakeStorage();
    ScribeStore.write(mixed, ROOM, ScribeStore.Kind.Live, { ...BARE, notes: [...junk, seeded[5]] });
    const other = rig({}, mixed);
    other.model.pedant = '';
    await other.live.reply(at(41));
    assert.deepEqual(notesOf(mixed), [seeded[5]]);

    for (const value of [undefined, null, 'notes', 5, { 0: seeded[0] }]) {
        const plainStorage = new FakeStorage();
        ScribeStore.write(plainStorage, ROOM, ScribeStore.Kind.Live, { ...BARE, notes: value });
        const bare = rig({}, plainStorage);
        bare.model.pedant = '';
        await bare.live.reply(at(41));
        assert.deepEqual(notesOf(plainStorage), [], String(value));
    }
});

test('a new edition keeps the legacy notes', async () => {
    const { keeper, storage, live } = withSavedNotes([stamped(at(41), 'Halvard', 'Wearing', 'a cloak'),
        stamped(at(41), 'Halvard', 'Looks', 'silver hair')]);
    await live.reply(at(41));
    const before = notesOf(storage);
    assert.equal(before.length, 2);
    keeper.change({ edition: 2 });
    live.view();
    assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).edition, 2);
    assert.deepEqual(notesOf(storage), before);
});

const PROFILE_HEADING = 'PLAYER CHARACTER PROFILE:';

/**
 * @param {object} model
 * @param {string} system
 * @return {string[]}
 */
function inputsOf(model, system) {
    return plain(model.calls.filter((call) => call.system === system).map((call) => call.user));
}

test('the story and the profile are read once, for many preparations and for two at once', async () => {
    const { live, raw, cast, model, keeper } = rig();
    const release = cast.hold();
    const replying = live.reply(at(41));
    await ticks();
    assert.deepEqual(plain(cast.reads), { story: 1, profile: 0 });
    assert.equal(model.calls.length, 0);
    const asked = raw.profile();
    const forcing = live.force();
    await ticks();
    assert.deepEqual(plain(cast.reads), { story: 1, profile: 0 });
    release();
    await replying;
    await forcing;
    assert.equal(await asked, cast.text);
    assert.deepEqual(plain(cast.plots), ['plot-harbour']);
    await live.force();
    await live.reply(at(47));
    keeper.change({ state: revised(state) });
    live.view();
    await ticks();
    assert.equal(await raw.profile(), cast.text);
    assert.deepEqual(plain(cast.reads), { story: 1, profile: 1 });
    assert.equal(live.view().notice, null);
    assert.notEqual(live.view().ready, null);
    const profiled = `${PROFILE_HEADING}\n${cast.text}`;
    assert.equal(inputsOf(model, ScribePedant.Prompt).length, 0);
    for (const system of [ScribeScene.Prompt]) {
        const inputs = inputsOf(model, system);
        assert.equal(inputs.length, 2, system);
        for (const input of inputs) {
            assert.equal(input.startsWith(`PLAYER CHARACTER:\nOrla\n\n${profiled}\n\n`), true, input.slice(0, 200));
        }
    }
    raw.close();
    assert.equal(await raw.profile(), cast.text);
});

test('a failed read makes everyone custom with a notice, leaves the profile out and is not tried again', async () => {
    const { live, raw, cast, model } = rig();
    cast.characters = [{ name: 'Mirelle', description: 'A tall woman with brown eyes.' }];
    cast.storyFailures.push(Object.assign(new Error('Zeta answered HTTP 404'), { status: 404 }));
    cast.profileFailures.push(new Error('Zeta gave no profile text for this chat'));
    await live.reply(at(41));
    await live.force();
    const notice =
        "The story's characters could not be read, so every character counts as custom: Zeta answered HTTP 404 " +
        'The chat profile could not be read, so it is left out of the calls: Zeta gave no profile text for this chat';
    assert.equal(live.view().notice, notice);
    assert.equal(live.view().ready.includes('Mirelle: eyes: brown.'), true, live.view().ready);
    await live.reply(at(47));
    assert.deepEqual(plain(cast.reads), { story: 1, profile: 1 });
    assert.deepEqual(plain(cast.plots), [null]);
    assert.equal(await raw.profile(), null);
    for (const system of [ScribeScene.Prompt, ScribePedant.Prompt]) {
        for (const input of inputsOf(model, system)) {
            assert.equal(input.includes(PROFILE_HEADING), false, system);
        }
    }

    const read = rig();
    read.cast.characters = [{ name: 'Mirelle', description: 'A tall woman with brown eyes.' }];
    await read.live.reply(at(41));
    await read.live.force();
    assert.equal(read.live.view().notice, null);
    assert.equal(read.live.view().ready.includes('brown eyes'), false, read.live.view().ready);
    assert.equal(read.live.view().ready.includes('Halvard'), true, read.live.view().ready);

    const halfway = rig();
    halfway.cast.profileFailures.push(new Error('Zeta answered HTTP 500'));
    await halfway.live.reply(at(41));
    assert.equal(
        halfway.live.view().notice,
        'The chat profile could not be read, so it is left out of the calls: Zeta answered HTTP 500',
    );
    assert.equal(await halfway.raw.profile(), null);
    assert.deepEqual(plain(halfway.cast.reads), { story: 1, profile: 1 });
});

test('a missing login gives no notice, and the next preparation reads again', async () => {
    const { live, raw, cast, model } = rig();
    cast.unseen(1);
    await live.reply(at(41));
    assert.equal(live.view().notice, null);
    assert.deepEqual(plain(cast.reads), { story: 1, profile: 1 });
    assert.equal(inputsOf(model, ScribeScene.Prompt)[0].includes(PROFILE_HEADING), false);
    await live.force();
    assert.deepEqual(plain(cast.reads), { story: 2, profile: 2 });
    assert.notEqual(live.view().ready, null);
    await live.reply(at(47));
    assert.deepEqual(plain(cast.reads), { story: 2, profile: 2 });
    assert.equal(inputsOf(model, ScribeScene.Prompt)[1].includes(PROFILE_HEADING), true);
    assert.equal(live.view().notice, null);
    assert.equal(await raw.profile(), cast.text);

    const closing = rig();
    const release = closing.cast.hold();
    const late = closing.raw.profile();
    closing.raw.close();
    release();
    assert.equal(await late, null);
    assert.equal(closing.raw.view().notice, null);
    assert.equal(await closing.raw.profile(), null);
    assert.deepEqual(plain(closing.cast.reads), { story: 2, profile: 2 });
});

test('saved appearance notes keep their original reminder behavior without collecting new ones', async () => {
    const { live, model, keeper, storage } = withSavedNotes([stamped(at(41), 'Halvard', 'Wearing', 'a dented breastplate'),
        stamped(at(41), 'Halvard', 'Looks', 'a fresh scar on his chin')]);
    await live.reply(at(41));
    await live.force();
    const first = live.view().ready;
    assert.ok(first.includes('Halvard wears a dented breastplate; '));
    assert.ok(first.includes('a fresh scar on his chin'));
    model.pedant = nowOf('Halvard | wearing | a travel cloak');
    await live.reply(at(47));
    assert.ok(!live.view().ready.includes('travel cloak'));
    const basis = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).basis;
    keeper.change({ lastRead: { id: 'MESSAGE-41', position: 41 } });
    live.view();
    await ticks();
    const next = live.view().ready;
    assert.ok(!next.includes('a fresh scar'));
    assert.ok(next.includes('Halvard wears a dented breastplate'));
    assert.notEqual(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).basis.notes, basis.notes);
    assert.equal(countOf(model, ScribePedant.Prompt), 0);
});

test('an edited reminder is not replaced by a note, a story answer or a reading', async () => {
    const { live, model, keeper, cast } = rig({ messages: story.slice(0, 41), unread: story.slice(40, 41) });
    cast.characters = [{ name: 'Mirelle', description: 'brown eyes' }];
    live.edit('[Scribe] Mine.');
    const release = cast.hold();
    model.pedant = nowOf('Halvard | wearing | a dented breastplate');
    const pending = live.reply(at(41));
    await ticks();
    release();
    await pending;
    assert.equal(live.view().ready, '[Scribe] Mine.');
    await live.force();
    model.pedant = nowOf('Halvard | wearing | a travel cloak');
    await live.reply(at(47));
    assert.equal(live.view().stale, false);
    assert.equal(live.view().draft, null);
    assert.equal(live.view().ready, '[Scribe] Mine.');
    keeper.change({ state: revised(state), lastRead: { id: 'MESSAGE-47', position: 47 } });
    live.view();
    await ticks();
    assert.equal(live.view().ready, '[Scribe] Mine.');
    assert.equal(live.outgoing('Go.'), `Go.${lineOf('[Scribe] Mine.')}`);
    assert.equal(chooses(model), 0);
});

test('a reminder saved before notes were part of its basis is rebuilt before it goes', async () => {
    const halvard = state.subjects.find((subject) => subject.label === 'Halvard').id;
    const orla = state.subjects.find((subject) => subject.label === 'Orla').id;
    const mill = {
        message: 'MESSAGE-41',
        fingerprint: at(41).fingerprint,
        position: 41,
        day: 1,
        place: 'The mill',
        reach: 'Private',
        present: [
            { subject: halvard, label: 'Halvard' },
            { subject: MIRELLE, label: 'Mirelle' },
            { subject: orla, label: 'Orla' },
        ],
        summary: 'They talk',
        changed: false,
    };
    const old = '[Scribe] Day 1, "The mill", private. Present: Halvard, Mirelle, Orla.';
    const storage = new FakeStorage();
    ScribeStore.write(storage, ROOM, ScribeStore.Kind.Live, {
        ...BARE,
        now: mill,
        reminded: mill,
        ready: old,
        basis: { revision: state.revision, first: [] },
        forced: true,
        edition: 1,
    });
    const { live, model } = rig({ messages: story.slice(0, 42), unread: story.slice(40, 42) }, storage);
    assert.equal(live.lines().ready, null);
    assert.equal(live.outgoing('Go.'), 'Go.');
    live.view();
    await ticks();
    const rebuilt = live.view().ready;
    assert.notEqual(rebuilt, old);
    assert.ok(reminds(rebuilt, 'Halvard'), rebuilt);
    assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).basis.notes, ScribeLive.marked([]));
    assert.equal(chooses(model), 0);
    assert.equal(tellings(model), 1);
    assert.equal(model.calls.length, 1);
});

/**
 * @param {object} fields
 * @param {Function|null} ask
 * @return {object}
 */
function timed(fields = {}, ask = null) {
    const moment = { value: 0 };
    const keeper = keeperOf(fields);
    const model = modelOf();
    keeper.savedAlerts = (message, current) => savedAlerts(model, message, current);
    const cast = castOf();
    const storage = new FakeStorage();
    const raw = ScribeLive.open({
        keeper,
        storage,
        roomId: ROOM,
        ask: ask ?? model.ask,
        clock: { now: () => moment.value },
        notify: () => {},
        story: cast.story,
        profile: cast.profile,
    });
    return { keeper, model, storage, moment, raw, live: following(keeper, raw) };
}

/**
 * @param {object} live
 * @param {object} moment
 * @param {number} value
 * @return {Promise<void>}
 */
async function moveTo(live, moment, value) {
    moment.value = value;
    live.view();
    await ticks();
}

/**
 * @param {object} model
 * @param {string} system
 * @return {number}
 */
function countOf(model, system) {
    return model.calls.filter((call) => call.system === system).length;
}

test('a scene one reply behind attaches nothing and says why; a current one attaches', async () => {
    const { model, live } = rig();
    await live.reply(at(41));
    await live.force();
    assert.equal(reminds(live.view().ready, TALE), true, live.view().ready);
    assert.equal(live.view().held, null);
    model.refusals.set(ScribeScene.Prompt, 'scene offline');
    await live.reply(at(43));
    assert.equal(live.view().now.message, 'MESSAGE-41');
    assert.equal(live.view().ready, null);
    assert.equal(live.view().held, 'No reminder: the scene was last read at #41; the latest reply is #43.');
    assert.equal(live.outgoing('Go.'), 'Go.');
    live.sent();
    await live.force();
    assert.equal(live.view().forced, true);
    assert.equal(live.view().ready, null);
    model.refusals.delete(ScribeScene.Prompt);
    await live.reply(at(45));
    assert.equal(live.view().now.message, 'MESSAGE-45');
    assert.equal(live.view().held, null);
    const ready = live.view().ready;
    assert.equal(ready.startsWith(TOLD), true, ready);
    assert.equal(live.outgoing('Go.'), `Go.${lineOf(ready)}`);
    live.sent();

    const typed = rig();
    await typed.live.reply(at(41));
    typed.model.refusals.set(ScribeScene.Prompt, 'scene offline');
    await typed.live.reply(at(43));
    typed.live.edit('[Scribe] My own words.');
    assert.equal(typed.live.view().held, null);
    assert.equal(typed.live.outgoing('Go.'), `Go.${lineOf('[Scribe] My own words.')}`);
});

test("the operator's room shape, scene at #157 and the latest reply at #225, attaches nothing", async () => {
    const builder = new CampaignBuilder('Orla');
    for (let number = 1; number <= 225; number++) {
        builder.narrator(`The tale goes on, line ${number}.`);
    }
    const long = ScribeIntake.read(builder.messages).messages;
    const scene = {
        message: 'MESSAGE-157',
        fingerprint: long[156].fingerprint,
        position: 157,
        day: 2,
        place: 'The ruins',
        reach: 'Private',
        present: [
            { subject: HALVARD, label: 'Halvard' },
            { subject: null, label: 'The grey lich' },
        ],
        summary: 'Halvard taunts the lich',
        changed: false,
    };
    const latest = long.at(-1);
    const storage = new FakeStorage();
    ScribeStore.write(storage, ROOM, ScribeStore.Kind.Live, {
        ...BARE,
        now: scene,
        reminded: scene,
        ready: '[Scribe] The story so far: The lich waits. The grey lich is here.',
        basis: { revision: state.revision, first: [], notes: ScribeLive.marked([]) },
        sends: 6,
        seen: { id: latest.id, fingerprint: latest.fingerprint, position: 225, before: scene },
        edition: 1,
    });
    const { live, model } = rig({ messages: long, unread: long.slice(40) }, storage);
    assert.equal(live.lines().ready, null);
    assert.equal(live.outgoing('Go.'), 'Go.');
    assert.equal(live.view().ready, null);
    assert.equal(live.view().held, 'No reminder: the scene was last read at #157; the latest reply is #225.');
    await live.force();
    await ticks();
    assert.equal(live.view().forced, true);
    assert.equal(live.view().ready, null);
    assert.equal(model.calls.length, 0);
});

test('an unavailable scene is retried at 15 s, 60 s and 300 s, never a fourth time, and the header says so', async () => {
    const { model, moment, live } = timed();
    model.refusals.set(ScribeScene.Prompt, 'Scene is offline');
    await live.reply(at(41));
    assert.equal(countOf(model, ScribeScene.Prompt), 1);
    assert.deepEqual(plain(live.view().failing), [{ role: 'scene', reason: 'Scene is offline', retrying: true }]);
    for (const [before, due, count] of [
        [14999, 15000, 2],
        [74999, 75000, 3],
        [374999, 375000, 4],
    ]) {
        await moveTo(live, moment, before);
        assert.equal(countOf(model, ScribeScene.Prompt), count - 1, String(before));
        await moveTo(live, moment, due);
        assert.equal(countOf(model, ScribeScene.Prompt), count, String(due));
    }
    assert.deepEqual(plain(live.view().failing), [{ role: 'scene', reason: 'Scene is offline', retrying: false }]);
    await moveTo(live, moment, 10000000);
    assert.equal(countOf(model, ScribeScene.Prompt), 4);
    assert.equal(countOf(model, ScribePedant.CheckPrompt), 0);
    model.refusals.delete(ScribeScene.Prompt);
    await live.reply(at(43));
    assert.equal(countOf(model, ScribeScene.Prompt), 5);
    assert.deepEqual(plain(live.view().failing), []);
});

test('a later durable finding is available while the previous reply has no judgment, and Live never schedules a second comparison', async () => {
    const { model, moment, live } = timed();
    model.failing.add('Pedant');
    await live.reply(at(41));
    assert.deepEqual(statuses(live), []);
    model.failing.clear();
    await live.reply(at(43));
    assert.ok(live.view().findings.some((finding) => finding.message === at(43).id));
    for (const value of [15000, 75000, 375000]) {
        await moveTo(live, moment, value);
    }
    assert.equal(countOf(model, ScribePedant.Prompt), 0);
    assert.equal(countOf(model, ScribePedant.CheckPrompt), 0);
    assert.ok(!live.view().findings.some((finding) => finding.message === at(41).id));
});

test('a failed scene is retried until it is current, a forced reminder waits for it, and failing goes on success', async () => {
    const { model, moment, live } = timed();
    await live.reply(at(41));
    model.refusals.set(ScribeScene.Prompt, 'scene offline');
    await live.reply(at(43));
    await live.force();
    assert.equal(live.view().ready, null);
    assert.equal(live.view().forced, true);
    for (const value of [15000, 75000, 375000]) {
        await moveTo(live, moment, value);
    }
    assert.equal(countOf(model, ScribeScene.Prompt), 5);
    assert.deepEqual(plain(live.view().failing), [{ role: 'scene', reason: 'scene offline', retrying: false }]);
    assert.equal(countOf(model, ScribePedant.Prompt), 0);
    model.refusals.delete(ScribeScene.Prompt);
    await live.reply(at(45));
    assert.deepEqual(plain(live.view().failing), []);
    assert.equal(live.view().now.message, 'MESSAGE-45');
    assert.equal(live.view().ready.startsWith(TOLD), true, live.view().ready);

    const recovered = timed();
    await recovered.live.reply(at(41));
    recovered.model.refusals.set(ScribeScene.Prompt, 'scene offline');
    await recovered.live.reply(at(43));
    await recovered.live.force();
    recovered.model.refusals.delete(ScribeScene.Prompt);
    await moveTo(recovered.live, recovered.moment, 15000);
    assert.equal(recovered.live.view().now.message, 'MESSAGE-43');
    assert.equal(recovered.live.view().ready.startsWith(TOLD), true, recovered.live.view().ready);
    assert.equal(countOf(recovered.model, ScribePedant.Prompt), 0);
});

test('live calls are listed with their tokens and finish, and a cut-off answer keeps its first 2,000 characters', async () => {
    const cut = Object.assign(new Error('answer was cut off; status 200; finish length'), {
        finish: 'length',
        answer: 'w'.repeat(2000),
        tokensIn: 900,
        tokensOut: 4000,
        reasoningTokens: 3100,
    });
    let cutNext = false;
    const ask = async (role, system) => {
        if (cutNext && system === ScribeScene.Prompt) {
            cutNext = false;
            throw cut;
        }
        const text = system === ScribeScene.Prompt ? MILL : '';
        return { text, cost: 0, tokensIn: 10, tokensOut: 20, reasoningTokens: null, finish: 'stop' };
    };
    const { live, keeper } = timed({}, ask);
    keeper.savedAlerts = () => [];
    await live.reply(at(41));
    cutNext = true;
    await live.reply(at(43));
    assert.deepEqual(plain(live.view().calls), [
        {
            role: 'Scribe',
            tokensIn: 900,
            tokensOut: 4000,
            reasoningTokens: 3100,
            finish: 'length',
            answer: 'w'.repeat(2000),
            problem: 'answer was cut off; status 200; finish length',
        },
        {
            role: 'Scribe',
            tokensIn: 10,
            tokensOut: 20,
            reasoningTokens: null,
            finish: 'stop',
            answer: null,
            problem: null,
        },
    ]);
    assert.deepEqual(statuses(live), []);
    for (let revision = 1; revision <= 20; revision++) {
        await live.reply(variant(45, [['Narrator', `The wind changes, revision ${revision}.`]], null));
    }
    assert.equal(live.view().calls.length, 20);
});

test('a call stopped by the operator is listed before the one that answered, with its cost unknown', async () => {
    const stoppedCall = {
        tokensIn: null,
        tokensOut: null,
        reasoningTokens: null,
        finish: null,
        answer: null,
        problem: 'Stopped by the operator; cost unknown',
    };
    const failed = Object.assign(new Error('Scene is offline'), { stopped: 1 });
    let offline = false;
    const ask = async (role, system) => {
        if (offline && system === ScribeScene.Prompt) {
            throw failed;
        }
        const text = system === ScribeScene.Prompt ? MILL : '';
        return { text, cost: 0.01, tokensIn: 10, tokensOut: 20, reasoningTokens: null, finish: 'stop', stopped: 2 };
    };
    const { live } = timed({}, ask);
    await live.reply(at(41));
    offline = true;
    await live.reply(at(43));
    const answered = { role: 'Scribe', tokensIn: 10, tokensOut: 20, reasoningTokens: null, finish: 'stop' };
    assert.deepEqual(plain(live.view().calls), [
        { role: 'Scribe', ...stoppedCall, problem: 'Scene is offline' },
        { role: 'Scribe', ...stoppedCall },
        { ...answered, answer: null, problem: null },
        { role: 'Scribe', ...stoppedCall },
        { role: 'Scribe', ...stoppedCall },
    ]);
});

test('the story so far leads the reminder, is reused while the timeline and the scene stand, and is asked again on a change', async () => {
    const { model, live } = rig();
    await live.reply(at(41));
    await live.force();
    const ready = live.view().ready;
    assert.equal(ready.startsWith(`${TOLD} Halvard: age: 34.`), true, ready);
    assert.equal(tellings(model), 1);
    const [input] = inputsOf(model, ScribeReminder.StoryPrompt);
    assert.equal(input.startsWith('TIMELINE:\nDay 1 | The mill | They talk\n\nOPEN THREADS:\n- the debt to Brandt\n'), true, input);
    assert.equal(input.endsWith('\n\nNOW:\nThey talk'), true, input);
    live.outgoing('Go.');
    live.sent();
    await live.reply(at(43));
    await live.force();
    assert.equal(tellings(model), 1);
    assert.equal(live.view().ready.startsWith(TOLD), true);
    live.outgoing('Go.');
    live.sent();
    model.scene = TENT;
    model.story = 'Orla came to the mill, then pitched a tent.';
    await live.reply(at(45));
    await live.force();
    assert.equal(tellings(model), 2);
    assert.equal(live.view().ready.startsWith('[Scribe] The story so far: Orla came to the mill, then pitched a tent. '), true);
});

test('a writer refusal parks its paid input until an intentional retry', async () => {
    const { model, moment, storage, live } = timed();
    model.rawStory = '{"status":"declined"}';
    await live.reply(at(41));
    await live.force();
    const calls = model.calls.length;
    const reason = ScribeLive.Settings.Messages.StoryDeclined;
    assert.deepEqual(plain(live.view().failing), [{ role: 'recap', reason, retrying: false }]);
    assert.equal(live.view().held, null);
    assert.equal(live.outgoing('I wait.'), 'I wait.');
    live.sent();
    for (const time of [15000, 75000, 5000000]) {
        await moveTo(live, moment, time);
    }
    const saved = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
    assert.equal(saved.story, null);
    assert.equal(saved.ready, null);
    assert.equal(saved.forced, true);
    assert.equal(saved.sends, 1);
    assert.equal(saved.untold.tries, ScribeLive.Settings.RetryMs.length);
    assert.equal(model.calls.length, calls);
    assert.equal(tellings(model), 1);
    model.rawStory = null;
    model.story = 'I can offer a summary of the siege, the captain said.';
    live.rekey();
    await ticks();
    assert.equal(model.calls.length, calls + 1);
    assert.deepEqual(plain(live.view().failing), []);
    const ready = live.lines().ready;
    assert.ok(ready.includes(model.story));
    assert.equal(live.outgoing('Go.'), 'Go.' + lineOf(ready));
    live.sent();
    assert.equal(live.view().sends, 0);
    assert.equal(live.outgoing('Again.'), 'Again.');
});

test('the Writer’s plain dialogue reaches the outgoing message unchanged', async () => {
    const { live, model } = rig();
    model.rawStory = '“Unable to assist with that request,” Mirelle said.';
    await live.reply(at(41));
    await live.force();
    const ready = live.lines().ready;
    assert.ok(ready.includes(model.rawStory));
    assert.equal(live.outgoing('Go.'), 'Go.\n@: ' + ready);
    assert.deepEqual(plain(live.view().failing), []);
});

test('cold automatic cache and preview cleanup leaves edits, selections, drafts and independent offers intact', async () => {
    const fields = { messages: story.slice(0, 41), unread: story.slice(40, 41) };
    const original = await preparedRoom(fields);
    const base = ScribeStore.read(original.storage, ROOM, ScribeStore.Kind.Live);
    original.live.close();
    const text = 'I can’t write this story.';
    const preview = '[Scribe] The story so far: ' + text;
    const legacyKey = 'legacy story';
    const cache = { key: legacyKey, text };
    for (const variant of ['cache only', 'preview only', 'edit', 'selection', 'failed write', 'different cache', 'development']) {
        const storage = new FakeStorage();
        const saved = { ...base, ready: preview, basis: { ...base.basis, story: legacyKey }, story: cache, draft: '[Scribe] My unsaved draft.' };
        if (variant === 'cache only') {
            Object.assign(saved, { ready: null, basis: null });
        } else if (variant === 'preview only') {
            saved.story = null;
        } else if (variant === 'edit') {
            Object.assign(saved, { selection: null, edited: preview, editedFor: { id: at(41).id, fingerprint: at(41).fingerprint } });
        } else if (variant === 'selection') {
            saved.selection = { id: base.delivery.id, text: preview };
        } else if (variant === 'different cache') {
            saved.story = { key: 'older story', text };
            saved.ready = base.ready;
            saved.basis = base.basis;
        } else if (variant === 'development') {
            saved.suggestion = COURIER;
        }
        ScribeStore.write(storage, ROOM, ScribeStore.Kind.Live, saved);
        if (variant === 'failed write') {
            storage.refuseSetsMatching(/live/);
        }
        const { live, model } = rig(fields, storage);
        const expected = ['selection', 'edit'].includes(variant) ? preview :
            variant === 'different cache' ? base.ready : null;
        assert.equal(live.lines().ready, expected, variant);
        if (variant === 'different cache') {
            assert.deepEqual(plain(live.view().failing), []);
        }
        const result = 'Now.' + (expected ? lineOf(expected) : '') + (variant === 'development' ? '\n@: ' + COURIER : '');
        assert.equal(live.outgoing('Now.'), result, variant);
        live.sent();
        assert.equal(live.outgoing('Later.'), 'Later.', variant);
        assert.equal(live.view().due, expected === null, variant);
        if (variant !== 'failed write') {
            const kept = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
            assert.equal(kept.draft, saved.draft, variant);
            assert.equal(kept.sends, expected ? 0 : 1, variant);
            assert.equal(kept.ready, null, variant);
            assert.equal(kept.story, null, variant);
        }
        await ticks();
        assert.equal(model.calls.length, expected === null ? 1 : 0, variant);
        live.close();
    }
});

test('confirming a manual replacement clears the refusal warning while its original key stays parked', async () => {
    const { live, model } = rig({ settings: { refresh: 1, budget: 3 } });
    model.rawStory = '{"status":"declined"}';
    await live.reply(at(41));
    assert.equal(live.view().failing.length, 1);
    await live.force(null, 'Orla stayed at the mill.');
    assert.deepEqual(plain(live.view().failing), []);
    assert.equal(live.outgoing('First.'), 'First.' + lineOf('[Scribe] Orla stayed at the mill.'));
    live.sent();
    live.view();
    await ticks();
    assert.deepEqual(plain(live.view().failing), []);
    assert.equal(live.outgoing('Next.'), 'Next.');
    assert.equal(tellings(model), 1);
});

test('a refusal from another story key cannot disturb the current one-send interval', async () => {
    const fields = { messages: story.slice(0, 41), unread: story.slice(40, 41), settings: { refresh: 1, budget: 3 } };
    for (const rejected of ['cache', 'preview']) {
        const original = await preparedRoom(fields);
        original.live.close();
        const saved = ScribeStore.read(original.storage, ROOM, ScribeStore.Kind.Live);
        const valid = saved.ready;
        const refusal = "I can't write this story.";
        if (rejected === 'cache') {
            saved.story = { key: 'earlier story key', text: refusal };
        } else {
            saved.basis.story = 'earlier story key';
            saved.ready = '[Scribe] The story so far: ' + refusal;
        }
        ScribeStore.write(original.storage, ROOM, ScribeStore.Kind.Live, saved);
        const { live, model } = rig(fields, original.storage);
        live.view();
        await ticks();
        assert.equal(live.outgoing('First.'), 'First.' + lineOf(valid));
        live.sent();
        live.view();
        await ticks();
        assert.equal(live.outgoing('Again.'), 'Again.');
        assert.equal(model.calls.length, 0);
    }
});

test('a legacy delivery does not replace text selected after reload', async () => {
    const fields = { messages: story.slice(0, 41), unread: story.slice(40, 41) };
    for (const resend of [false, true]) {
        const { live, storage } = await preparedRoom(fields);
        live.outgoing('Originally.');
        const post = live.posting();
        live.uncertain(post);
        live.close();
        const saved = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
        saved.story.key = saved.basis.story = 'legacy key';
        saved.story.text = "I can't write this story.";
        saved.ready = '[Scribe] The story so far: ' + saved.story.text;
        Object.assign(saved.posts[0], { ready: saved.ready, carried: saved.ready });
        ScribeStore.write(storage, ROOM, ScribeStore.Kind.Live, saved);
        const restored = rig(fields, storage);
        assert.equal(restored.live.view().unconfirmed.text, saved.ready);
        assert.equal(restored.live.lines().ready, null);
        const receipts = [];
        if (resend) {
            const selected = 'Replacement from the textarea.';
            await restored.live.force(null, selected);
            receipts.push(restored.live.lines().reminder);
            assert.equal(restored.live.lines().ready, selected);
            assert.equal(restored.live.outgoing('Retry.'), 'Retry.' + lineOf('[Scribe] ' + selected));
            restored.live.sent();
        }
        restored.live.went(post);
        restored.live.went(post);
        const after = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
        assert.deepEqual(plain(after.settled), [...receipts, post.reminder]);
        assert.equal(after.sends, 0);
        assert.equal(restored.live.outgoing('After.'), 'After.');
        assert.equal(tellings(restored.model), 0);
    }
});

test('a legacy cache with a normalized quoted heading preserves the named character’s refusal', async () => {
    const fields = { messages: story.slice(0, 41), unread: story.slice(40, 41) };
    const generated = rig(fields);
    generated.model.story = "“The story so far: I can't write this story,” Mirra admitted.";
    await generated.live.reply(at(41));
    await generated.live.force();
    const ready = generated.live.lines().ready;
    assert.ok(ready.includes("I can't write this story,” Mirra admitted."));
    generated.live.close();
    const restored = rig(fields, generated.storage);
    assert.deepEqual(plain(restored.live.view().failing), []);
    assert.equal(restored.live.outgoing('Yes.'), 'Yes.' + lineOf(ready));
    assert.equal(restored.model.calls.length, 0);
});

test('no story so far, no reminder: the failure is said, retried on the schedule, and the reminder follows', async () => {
    const { model, moment, live } = timed();
    model.refusals.set(ScribeReminder.StoryPrompt, 'story offline');
    await live.reply(at(41));
    await live.force();
    assert.equal(live.view().ready, null);
    assert.equal(live.view().held, 'The story recap is unavailable. See Progress for details.');
    assert.equal(live.outgoing('Go.'), 'Go.');
    await moveTo(live, moment, 14999);
    assert.equal(tellings(model), 1);
    await moveTo(live, moment, 15000);
    assert.equal(tellings(model), 2);
    model.refusals.delete(ScribeReminder.StoryPrompt);
    await moveTo(live, moment, 75000);
    assert.equal(tellings(model), 3);
    assert.equal(live.view().held, null);
    assert.equal(live.view().ready.startsWith(TOLD), true);

    const empty = timed();
    empty.model.rawStory = '  ';
    await empty.live.reply(at(41));
    await empty.live.force();
    assert.equal(empty.live.view().ready, null);
    assert.equal(empty.live.view().held, 'The story recap is unavailable. See Progress for details.');
    assert.deepEqual(plain(empty.live.view().failing), [{ role: 'recap', reason: ScribeLive.Settings.Messages.StoryEmpty, retrying: false }]);
    for (const value of [15000, 75000, 375000, 5000000]) {
        await moveTo(empty.live, empty.moment, value);
    }
    assert.equal(tellings(empty.model), 1);
});

/**
 * @return {Error}
 */
function cutOff() {
    return Object.assign(new Error('answer was cut off; status 200; finish length'), {
        retryable: false,
        finish: 'length',
        answer: 'w'.repeat(2000),
    });
}

test('a failed live call masks the partial answer and finish in memory before either GM key rotates', async () => {
    const { live, model, storage } = timed();
    ScribeStore.setKey(storage, 'opaque-provider-token');
    ScribeStore.setCloudKey(storage, 'opaque-worker-token');
    model.refusals.set(ScribeScene.Prompt, () => Object.assign(cutOff(), {
        status: 200,
        finish: 'length opaque-worker-token',
        answer: '<i>opaque-provider-token / opaque-worker-token</i>',
    }));
    await live.reply(at(41));
    ScribeStore.setKey(storage, 'next-provider');
    ScribeStore.setCloudKey(storage, 'next-worker');
    const record = live.view().calls.find((call) => call.role === 'Scribe');
    assert.equal(record.finish, 'length [key]');
    assert.equal(record.answer, '<i>[key] / [key]</i>');
});

test('a legacy scene refresh stays quiet until its scheduled reader actually fails', async () => {
    const { live, storage } = rig();
    await live.reply(at(41));
    live.close();
    const saved = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
    delete saved.now.fingerprint;
    ScribeStore.write(storage, ROOM, ScribeStore.Kind.Live, saved);
    const next = rig({}, storage);
    const release = next.model.holdSystem(ScribeScene.Prompt);
    next.model.refusals.set(ScribeScene.Prompt, () => Object.assign(new Error('local read refused'), { source: 'Scribe' }));
    assert.deepEqual(plain(next.live.view().failing), []);
    await ticks();
    release();
    await ticks();
    assert.equal(countOf(next.model, ScribeScene.Prompt), 1);
    assert.deepEqual(plain(next.live.view().failing), [{ role: 'scene', reason: 'local read refused', retrying: false, source: 'Scribe' }]);
    next.live.close();
    const after = rig({}, storage);
    assert.deepEqual(plain(after.live.view().failing), [{ role: 'scene', reason: 'local read refused', retrying: false, source: 'Scribe' }]);
    after.live.close();
});

test('a cut-off answer is not retried: one paid call, and the header says so at once', async () => {
    const checks = timed();
    checks.model.refusals.set(ScribePedant.Prompt, cutOff);
    await checks.live.reply(at(41));
    assert.deepEqual(plain(checks.live.view().failing), []);
    for (const value of [15000, 75000, 375000, 10000000]) {
        await moveTo(checks.live, checks.moment, value);
    }
    assert.equal(countOf(checks.model, ScribePedant.Prompt), 0);

    const scenes = timed();
    scenes.model.refusals.set(ScribeScene.Prompt, cutOff);
    await scenes.live.reply(at(41));
    assert.deepEqual(plain(scenes.live.view().failing), [{ role: 'scene', reason: 'answer was cut off; status 200; finish length', retrying: false }]);
    for (const value of [15000, 75000, 375000]) {
        await moveTo(scenes.live, scenes.moment, value);
    }
    assert.equal(countOf(scenes.model, ScribeScene.Prompt), 1);

    const told = timed();
    told.model.refusals.set(ScribeReminder.StoryPrompt, cutOff);
    await told.live.reply(at(41));
    await told.live.force();
    assert.deepEqual(plain(told.live.view().failing), [{ role: 'recap', reason: 'answer was cut off; status 200; finish length', retrying: false }]);
    for (const value of [15000, 75000, 375000, 10000000]) {
        await moveTo(told.live, told.moment, value);
    }
    assert.equal(tellings(told.model), 1);
    assert.equal(told.live.view().ready, null);
    await told.live.force();
    assert.equal(tellings(told.model), 1);
});

test('an edited latest reply makes the scene not current until it is read again', async () => {
    const edited = variant(41, [['Narrator', 'Halvard falls dead at the mill door; Mirelle runs.']], null);
    assert.equal(edited.id, at(41).id);
    const reread = timed();
    await reread.live.reply(at(41));
    await reread.live.force();
    const prepared = reread.live.view().ready;
    assert.equal(prepared.includes('Halvard'), true, prepared);
    const release = reread.model.holdSystem(ScribeScene.Prompt);
    reread.model.scene = 'Day 1 | The mill | private | present: Mirelle, Orla | Halvard lies dead\nCHANGED: yes';
    const pending = reread.live.reply(edited);
    await ticks();
    assert.equal(reread.live.lines().ready, null);
    assert.equal(reread.live.outgoing('Go.'), 'Go.');
    assert.equal(reread.live.view().held, 'No reminder: the latest reply #41 changed and is being read again.');
    release();
    await pending;
    await ticks();
    assert.equal(reread.live.view().now.fingerprint, edited.fingerprint);

    const second = timed();
    await second.live.reply(at(41));
    await second.live.force();
    const gate = second.model.holdSystem(ScribeScene.Prompt);
    second.model.scene = 'Day 1 | The mill | private | present: Mirelle, Orla | Halvard lies dead\nCHANGED: yes';
    const waiting = second.live.reply(edited);
    await ticks();
    assert.equal(second.live.lines().ready, null);
    gate();
    await waiting;
    await ticks();
    assert.equal(second.live.view().held, null);
    const after = second.live.view().ready;
    assert.equal(after === null || !after.includes('Halvard has'), true, after);
});

test('saving a key clears what failed and runs the failed calls at once', async () => {
    const recovered = timed();
    recovered.model.refusals.set(ScribeScene.Prompt, 'HTTP 401: User not found.');
    await recovered.live.reply(at(41));
    for (const value of [15000, 75000, 375000]) {
        await moveTo(recovered.live, recovered.moment, value);
    }
    assert.equal(countOf(recovered.model, ScribeScene.Prompt), 4);
    assert.deepEqual(plain(recovered.live.view().failing), [{ role: 'scene', reason: 'HTTP 401: User not found.', retrying: false }]);
    await recovered.live.force();
    recovered.model.refusals.delete(ScribeScene.Prompt);
    await moveTo(recovered.live, recovered.moment, 400000);
    assert.equal(countOf(recovered.model, ScribeScene.Prompt), 4);
    recovered.live.rekey();
    await ticks();
    assert.equal(countOf(recovered.model, ScribeScene.Prompt), 5);
    assert.deepEqual(plain(recovered.live.view().failing), []);
    assert.equal(recovered.live.view().held, null);
    assert.equal(recovered.live.outgoing('Go.').includes(TOLD), true);

    const silent = timed();
    silent.model.refusals.set(ScribeReminder.StoryPrompt, cutOff);
    silent.model.refusals.set(ScribePedant.Prompt, cutOff);
    await silent.live.reply(at(41));
    await silent.live.force();
    silent.model.refusals.clear();
    silent.live.rekey();
    await ticks();
    assert.equal(countOf(silent.model, ScribePedant.Prompt), 0);
    assert.equal(tellings(silent.model), 2);
    assert.deepEqual(plain(silent.live.view().failing), []);
    assert.equal(silent.live.view().ready.startsWith(TOLD), true);
});

test('fifty incoming replies leave zero live Checker retries on the retired route', async () => {
    const { model, storage, live } = timed();
    model.refusals.set(ScribePedant.Prompt, 'Pedant is offline');
    const replies = story.filter((message) => message.fromPlayer !== true);
    assert.equal(replies.length, 50);
    for (const message of replies) {
        await live.reply(message);
    }
    /**
     * @return {object[]}
     */
    const kept = () => ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).retries;
    assert.deepEqual(plain(kept()), []);
    assert.deepEqual(plain(live.view().failing), []);
    await live.reply(variant(59, [['Narrator', 'A fifty-first reply.']], 'OTHER-59'));
    assert.deepEqual(plain(kept()), []);
    assert.equal(countOf(model, ScribePedant.Prompt), 0);
    assert.deepEqual(plain(live.view().failing), []);
});

test('the scene is current when it belongs to the latest Zeta reply, whatever player messages follow', () => {
    const now = { message: at(41).id, fingerprint: at(41).fingerprint, position: 41 };
    const twice = { messages: [...story.slice(0, 42), { ...at(42), id: 'MESSAGE-42-B', position: 43 }] };
    assert.equal(ScribeLive.behind(now, twice), null);
    const atPlayer = { message: 'MESSAGE-42-B', fingerprint: at(42).fingerprint, position: 43 };
    assert.equal(ScribeLive.behind(atPlayer, twice), null);
    const older = { message: at(39).id, fingerprint: at(39).fingerprint, position: 39 };
    assert.equal(
        ScribeLive.behind(older, twice),
        'No reminder: the scene was last read at #39; the latest reply is #41.',
    );
    assert.equal(ScribeLive.behind(null, twice), 'No reminder: the scene has not been read yet; the latest reply is #41.');
});

test('one story call per key at a time', async () => {
    const race = timed();
    await race.live.reply(at(41));
    race.live.outgoing('Go.');
    race.live.sent();
    const release = race.model.holdSystem(ScribeReminder.StoryPrompt);
    const forcing = race.raw.force();
    await ticks();
    const arriving = race.live.reply(at(43));
    await ticks();
    release();
    await forcing;
    await arriving;
    await ticks();
    assert.equal(tellings(race.model), 1);
    assert.equal(race.live.view().ready.startsWith(TOLD), true);
});

test('a room without its characters still gives the plot id, so the profile is read and only the story notice shows', async () => {
    const { live, cast } = rig();
    cast.storyFailures.push(
        Object.assign(new Error('Zeta answered in an unexpected shape'), { status: 200, plotId: 'plot-9' }),
    );
    await live.reply(at(41));
    assert.deepEqual(plain(cast.plots), ['plot-9']);
    assert.equal(
        live.view().notice,
        "The story's characters could not be read, so every character counts as custom: Zeta answered in an unexpected shape",
    );
});

test('a trimmed reminder marks as reminded only what it carried, on both paths', async () => {
    const { model, live } = rig();
    model.story = CROWDED;
    await live.reply(at(41));
    await live.force();
    const ready = live.view().ready;
    assert.equal(ready.includes('Halvard: age: 34.'), true, ready);
    const story = `[Scribe] The story so far: ${CROWDED}`;
    const player = 'x'.repeat(LIMIT - bytes(lineOf(story)) - 5);
    const sent = live.outgoing(player);
    assert.equal(sent, player + lineOf(story));
    live.sent();
    assert.equal(statuses(live).some(([, , status]) => status === 'Reminded'), false);

    const framed = rig();
    framed.model.story = CROWDED;
    await framed.live.reply(at(41));
    await framed.live.force();
    const offered = framed.live.lines();
    assert.equal(offered.ends.length > 0, true);
    framed.live.went({ ready: offered.ready, suggestion: null, carried: story, crowded: false });
    assert.equal(statuses(framed.live).some(([, , status]) => status === 'Reminded'), false);

    const crowded = rig();
    await crowded.live.reply(at(41));
    await crowded.live.force();
    crowded.live.went({ ready: null, suggestion: null, carried: null, crowded: true });
    assert.equal(crowded.live.view().held, 'No reminder: your message leaves no room for it.');
    const whole = crowded.live.lines();
    crowded.live.went({ ready: whole.ready, suggestion: null, carried: whole.ready, crowded: false });
    assert.equal(crowded.live.view().held, null);
    assert.equal(statuses(crowded.live).some(([, , status]) => status === 'Reminded'), true);
});

test('an old recovery snapshot cannot rerun newer identical failures at the same instant after rehydration', async () => {
    const { live, model, keeper, moment } = timed();
    model.refusals.set(ScribePedant.Prompt, cutOff);
    model.refusals.set(ScribeReminder.StoryPrompt, cutOff);
    await live.reply(at(41));
    await live.force();
    live.rekey();
    await ticks();
    const previous = live.keyWork();
    keeper.change({ reader: false, trusted: false });
    live.view();
    keeper.change({ reader: true, trusted: true });
    live.view();
    const before = model.calls.length;
    live.rekey();
    await ticks();
    assert.equal(model.calls.length, before + 1);
    for (let duplicate = 0; duplicate < 3; duplicate++) {
        live.rekey(previous);
        await ticks();
        assert.equal(model.calls.length, before + 1);
    }
    live.rekey();
    await ticks();
    assert.equal(model.calls.length, before + 2);
    assert.equal(moment.value, 0);
});

test('a key change does not start a second Checker for any source, including a previously parked Live retry', async () => {
    const first = timed();
    await first.live.reply(at(41));
    first.live.close();
    const saved = ScribeStore.read(first.storage, ROOM, ScribeStore.Kind.Live);
    saved.retries = [41, 43, 45, 47, 49].map((position) => ({ role: 'check', id: at(position).id,
        fingerprint: at(position).fingerprint, position, at: 0, tries: 1, reason: 'Old provider failure' }));
    saved.failing = { scene: null, check: 'Old provider failure' };
    ScribeStore.write(first.storage, ROOM, ScribeStore.Kind.Live, saved);
    const next = rig({}, first.storage);
    for (const position of [41, 43, 45, 47, 49]) {
        await next.live.reply(at(position));
        next.live.rekey();
        await ticks();
    }
    assert.equal(countOf(next.model, ScribePedant.Prompt), 0);
    assert.equal(countOf(next.model, ScribePedant.CheckPrompt), 0);
    assert.deepEqual(plain(next.live.view().failing), []);
    assert.equal(ScribeStore.read(next.storage, ROOM, 'live').retries.some((retry) => retry.role === 'check'), false);
});

test('only a failure with no answer is retried on the schedule; an unusable answer is parked at once', async () => {
    const paid = timed();
    paid.model.refusals.set(ScribeScene.Prompt, () =>
        Object.assign(new Error('answer has no usable content; status 200; finish stop'), { retryable: true, status: 200 }),
    );
    await paid.live.reply(at(41));
    for (const value of [15000, 75000, 375000]) {
        await moveTo(paid.live, paid.moment, value);
    }
    assert.equal(countOf(paid.model, ScribeScene.Prompt), 1);
    assert.deepEqual(plain(paid.live.view().failing), [
        { role: 'scene', reason: 'answer has no usable content; status 200; finish stop', retrying: false },
    ]);
    const unpaid = timed();
    unpaid.model.refusals.set(ScribeScene.Prompt, () =>
        Object.assign(new Error('unexpected HTTP status; status 503'), { retryable: true, status: 503 }),
    );
    await unpaid.live.reply(at(41));
    await moveTo(unpaid.live, unpaid.moment, 15000);
    assert.equal(countOf(unpaid.model, ScribeScene.Prompt), 2);
});

test('saving an edit after a reply changes sends the operator wording', async () => {
    const { model, live } = rig();
    await live.reply(at(41));
    await live.force();
    const opened = live.view().latest;
    assert.equal(opened.id, at(41).id);
    model.scene = 'Day 1 | The mill | private | present: Mirelle, Orla | Halvard lies dead\nCHANGED: yes';
    await live.reply(variant(41, [['Narrator', 'Halvard falls dead at the mill door.']], null));
    live.edit('[Scribe] Halvard waits at the mill, alive.', true, opened);
    assert.equal(live.view().edited, true);
    assert.equal(live.view().draft, null);
    const going = live.lines().ready;
    assert.equal(going, '[Scribe] Halvard waits at the mill, alive.');
    assert.equal(live.outgoing('Go.'), `Go.${lineOf(going)}`);
    live.sent();
    assert.equal(live.view().forced, false);
    assert.equal(live.view().ready, null);
    assert.equal(live.view().draft, null);
});

test('a stored scene with no fingerprint is read again once, and then a reminder can go', async () => {
    const halvard = state.subjects.find((subject) => subject.label === 'Halvard').id;
    const old = {
        message: 'MESSAGE-41',
        position: 41,
        day: 1,
        place: 'The mill',
        reach: 'Private',
        present: [{ subject: halvard, label: 'Halvard' }],
        summary: 'They talk',
        changed: false,
    };
    const latest = at(41);
    const storage = new FakeStorage();
    ScribeStore.write(storage, ROOM, ScribeStore.Kind.Live, {
        ...BARE,
        now: old,
        reminded: old,
        forced: true,
        seen: { id: latest.id, fingerprint: latest.fingerprint, position: 41, before: null },
        edition: 1,
    });
    const { live, model } = rig({ messages: story.slice(0, 42), unread: story.slice(40, 42) }, storage);
    live.view();
    await ticks();
    live.view();
    await ticks();
    assert.equal(countOf(model, ScribeScene.Prompt), 1);
    assert.equal(countOf(model, ScribePedant.Prompt), 0);
    assert.equal(live.view().now.fingerprint, at(42).fingerprint);
    assert.equal(live.view().held, null);
    assert.equal(live.view().ready.startsWith(TOLD), true);
});

test('a newer failed scene replaces the older scene retry, so one chain runs', async () => {
    const { model, moment, live } = timed();
    model.refusals.set(ScribeScene.Prompt, 'scene offline');
    for (const position of [41, 43, 45, 47, 49]) {
        await live.reply(at(position));
    }
    assert.equal(countOf(model, ScribeScene.Prompt), 5);
    for (const value of [15000, 75000, 375000, 5000000]) {
        await moveTo(live, moment, value);
    }
    assert.equal(countOf(model, ScribeScene.Prompt), 8);
    assert.deepEqual(plain(live.view().failing), [{ role: 'scene', reason: 'scene offline', retrying: false }]);
});

test('a reminder or an edit saved by an older build is never sent: the reminder is made again, the edit waits', async () => {
    const halvard = state.subjects.find((subject) => subject.label === 'Halvard').id;
    const current = {
        message: at(41).id,
        fingerprint: at(41).fingerprint,
        position: 41,
        day: 4,
        place: 'Guild Inn room',
        reach: 'Private',
        present: [{ subject: halvard, label: 'Halvard' }],
        summary: 'They talk',
        changed: false,
    };
    const old = '[Scribe] Day 4, "Guild Inn room", private. Present: Halvard. Of those here only Mirelle knows this.';
    const storage = new FakeStorage();
    ScribeStore.write(storage, ROOM, ScribeStore.Kind.Live, {
        ...BARE,
        now: current,
        reminded: current,
        ready: old,
        led: [AGE],
        basis: { revision: state.revision, first: [AGE], notes: ScribeLive.marked([]) },
        sends: 6,
        seen: { id: at(41).id, fingerprint: at(41).fingerprint, position: 41, before: null },
        edition: 1,
    });
    const { live, model } = rig({ messages: story.slice(0, 41), unread: story.slice(40, 41) }, storage);
    assert.equal(live.lines().ready, null);
    assert.equal(live.outgoing('Go.'), 'Go.');
    live.view();
    await ticks();
    const remade = live.view().ready;
    assert.equal(remade.startsWith('[Scribe] The story so far: '), true, remade);
    assert.equal(live.outgoing('Go.'), `Go.${lineOf(remade)}`);
    assert.equal(tellings(model), 1);
    const stored = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
    assert.equal(typeof stored.basis.story, 'string');

    const edits = new FakeStorage();
    ScribeStore.write(edits, ROOM, ScribeStore.Kind.Live, { ...BARE, edited: old, edition: 1 });
    const loaded = rig({ messages: story.slice(0, 41), unread: story.slice(40, 41) }, edits).live;
    assert.equal(loaded.lines().ready, null);
    assert.equal(loaded.view().edited, false);
    assert.equal(loaded.view().draft, old);
    assert.equal(loaded.view().held, 'Your edit was written before the latest reply. Click “Send a reminder with my next message” to use it.');
    assert.equal(loaded.outgoing('Go.'), 'Go.');
});

/**
 * @param {Object<number, string>} carried
 * @param {number} length
 * @param {number} parity
 * @param {Object<number, string>} spoken
 * @return {{ messages: readonly object[], own: readonly object[] }}
 */
function carriedStory(carried, length = 60, parity = 0, spoken = {}) {
    const builder = new CampaignBuilder('Orla');
    for (let number = 1; number <= length; number++) {
        const blocks = scripted[number];
        if (number > 40 && number % 2 === parity) {
            const note = carried[number] === undefined ? '' : `\n@: ${carried[number]}`;
            builder.player((spoken[number] ?? `I wait, turn ${number}.`) + note);
        } else if (blocks !== undefined) {
            builder.reply(blocks);
        } else {
            builder.narrator(`The tale goes on, line ${number}.`);
        }
    }
    const read = ScribeIntake.read(builder.messages);
    return { messages: read.messages, own: read.own };
}

/**
 * @param {object} fields
 * @param {FakeStorage} storage
 * @return {Promise<object>}
 */
async function preparedRoom(fields = {}, storage = new FakeStorage()) {
    const room = rig(fields, storage);
    await room.live.reply(at(41));
    await room.live.force();
    return room;
}

/**
 * @return {Promise<{ storage: FakeStorage, ready: string, reminder: string, attempt: string }>}
 */
async function interrupted() {
    const room = await preparedRoom();
    const ready = room.live.view().ready;
    const player = 'I wait, turn 42.';
    assert.equal(room.live.outgoing(player), player + lineOf(ready));
    const delivery = ScribeStore.read(room.storage, ROOM, ScribeStore.Kind.Live).delivery;
    room.live.close();
    return { storage: room.storage, ready, reminder: delivery.id, attempt: delivery.attempt };
}

test('a forced reminder clears the moment it goes, and the next message carries nothing', async () => {
    const { storage, live } = await preparedRoom();
    const ready = live.view().ready;
    assert.ok(reminds(ready, 'Halvard'), ready);
    const offered = live.lines();
    assert.equal(offered.reminder, `${ROOM}#reminder-1`);
    assert.equal(offered.attempt, `${ROOM}#attempt-1`);
    assert.equal(live.outgoing('Go.'), `Go.${lineOf(ready)}`);
    live.sent();
    const after = live.view();
    assert.equal(after.ready, null);
    assert.equal(after.forced, false);
    assert.equal(after.edited, false);
    assert.equal(after.draft, null);
    assert.equal(after.prepared, false);
    assert.equal(after.sends, 0);
    const none = live.lines();
    assert.deepEqual([none.ready, none.reminder, none.attempt], [null, null, null]);
    assert.equal(live.outgoing('Again.'), 'Again.');
    const stored = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
    assert.equal(stored.ready, null);
    assert.equal(stored.forced, false);
    assert.equal(stored.delivery, null);
    assert.deepEqual(plain(stored.settled), [`${ROOM}#reminder-1`]);
    await live.force();
    assert.equal(live.lines().reminder, `${ROOM}#reminder-2`);
});

for (const interval of [6, 8, 10]) {
    test(`with ${interval} user messages between reminders the reminder goes on send ${interval} and ${interval * 2}, also after a reload`, async () => {
        const fields = { settings: { refresh: interval, budget: 3 } };
        let room = rig(fields);
        const storage = room.storage;
        await room.live.reply(at(41));
        for (let count = 1; count <= interval * 2; count++) {
            const text = `Message ${count}.`;
            const regular = count % interval === 0;
            let ready = null;
            if (regular) {
                await room.live.reply(at(count === interval ? 43 : 45));
                ready = room.live.view().ready;
                assert.ok(reminds(ready), `a reminder is ready before message ${count}`);
                room.live.close();
                room = rig({ ...fields, messages: room.keeper.current.messages }, storage);
                assert.equal(room.live.view().ready, ready, `the reminder survives a reload before message ${count}`);
            }
            assert.equal(room.live.outgoing(text), regular ? `${text}${lineOf(ready)}` : text, `message ${count}`);
            room.live.sent();
            assert.equal(room.live.view().sends, regular ? 0 : count % interval, `count after message ${count}`);
        }
    });
}

test('a manual delivery on turn 3 with an interval of 8 makes turn 11 the next regular target', async () => {
    const { live } = rig({ settings: { refresh: 8, budget: 3 } });
    await live.reply(at(41));
    for (const turn of [1, 2]) {
        assert.equal(live.outgoing(`Turn ${turn}.`), `Turn ${turn}.`);
        live.sent();
    }
    await live.force();
    const manual = live.view().ready;
    assert.equal(live.outgoing('Turn 3.'), `Turn 3.${lineOf(manual)}`);
    live.sent();
    assert.equal(live.view().sends, 0);
    for (let turn = 4; turn <= 10; turn++) {
        assert.equal(live.outgoing(`Turn ${turn}.`), `Turn ${turn}.`);
        live.sent();
    }
    assert.equal(live.view().sends, 7);
    await live.reply(at(43));
    const regular = live.view().ready;
    assert.ok(reminds(regular));
    assert.equal(live.outgoing('Turn 11.'), `Turn 11.${lineOf(regular)}`);
});

test('setting the interval to one after an earlier delivery prepares the next send, then the delivered offer stays cleared on reload', async () => {
    const { keeper, live, storage } = await preparedRoom();
    live.outgoing('First.');
    live.sent();
    assert.equal(live.view().sends, 0);
    const settings = { refresh: 1, budget: 3 };
    keeper.change({ settings });
    live.view();
    await ticks();
    const ready = live.view().ready;
    assert.ok(ready);
    assert.equal(live.outgoing('Second.'), 'Second.' + lineOf(ready));
    live.sent();
    live.close();
    const reopened = rig({ messages: keeper.current.messages, settings }, storage);
    reopened.live.view();
    await ticks();
    assert.equal(reopened.live.view().ready, null);
    assert.equal(reopened.live.view().sends, 0);
});

test('changing the interval keeps the count, and lowering it below the count makes the next send eligible', async () => {
    const { keeper, live } = rig({ settings: { refresh: 8, budget: 3 } });
    for (let count = 1; count <= 5; count++) {
        live.outgoing(`Message ${count}.`);
        live.sent();
    }
    assert.equal(live.view().sends, 5);
    assert.equal(live.view().due, false);
    keeper.change({ settings: { refresh: 3, budget: 3 } });
    assert.equal(live.view().sends, 5);
    assert.equal(live.view().due, true);
    keeper.change({ settings: { refresh: 10, budget: 3 } });
    assert.equal(live.view().sends, 5);
    assert.equal(live.view().due, false);
    keeper.change({ settings: { refresh: 6, budget: 3 } });
    assert.equal(live.view().sends, 5);
    assert.equal(live.view().due, true);
});

test('replies, regenerations, redraws and Force are not user messages', async () => {
    const { live } = rig({ settings: { refresh: 8, budget: 3 } });
    live.outgoing('One.');
    live.sent();
    await live.reply(at(41));
    await live.reply(at(43));
    await live.reply(variant(43, [['Narrator', 'A different third line.']], 'OTHER-43'));
    for (let looks = 0; looks < 3; looks++) {
        live.view();
        live.lines();
    }
    await live.force();
    await live.force();
    assert.equal(live.view().sends, 1);
    assert.equal(live.view().forced, true);
});

test('a delivery report settles its own reminder once, whatever repeats it or comes from elsewhere', async () => {
    const { live } = await preparedRoom();
    const ready = live.view().ready;
    const offered = live.lines();
    const report = {
        ready,
        suggestion: null,
        carried: ready,
        crowded: false,
        reminder: offered.reminder,
        attempt: offered.attempt,
    };
    live.went({ ready: null, suggestion: null });
    assert.equal(live.view().sends, 1);
    live.went({ ...report, reminder: 'elsewhere#reminder-1', attempt: 'elsewhere#attempt-1' });
    assert.equal(live.view().sends, 1);
    assert.equal(live.view().ready, ready);
    assert.equal(live.view().forced, true);
    live.went(report);
    assert.equal(live.view().ready, null);
    assert.equal(live.view().forced, false);
    assert.equal(live.view().sends, 0);
    live.went(report);
    live.went(report);
    assert.equal(live.view().sends, 0);

    await live.force();
    live.edit(ready);
    const again = live.lines();
    assert.notEqual(again.ready, null);
    assert.notEqual(again.reminder, offered.reminder);
    assert.notEqual(again.attempt, offered.attempt);
    live.went(report);
    assert.equal(live.view().ready, again.ready);
    assert.equal(live.view().forced, true);
    assert.equal(live.view().sends, 0);
    live.went({ ...report, reminder: again.reminder, attempt: again.attempt });
    assert.equal(live.view().ready, null);
    assert.equal(live.view().edited, false);
    assert.equal(live.view().forced, false);
    live.went({ ...report, reminder: again.reminder, attempt: again.attempt });
    assert.equal(live.view().sends, 0);
});

test('a late manual receipt settles its attempt and preserves another choice with identical text', async () => {
    const { live, storage } = await preparedRoom();
    const selected = 'A  changed\nline 雪.';
    await live.force(null, selected);
    const original = live.lines();
    assert.equal(live.outgoing('First.'), 'First.\n@: [Scribe] ' + selected);
    const post = live.posting();
    live.uncertain(post);
    live.edit('Intermediate choice.');
    live.edit(selected);
    const newer = live.lines();
    assert.notEqual(newer.reminder, original.reminder);
    live.went({ ...post, attempt: newer.attempt });
    assert.deepEqual(plain(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).settled), []);
    live.went(post);
    live.went(post);
    const saved = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
    assert.deepEqual(plain(saved.selection), { id: newer.reminder, text: selected });
    assert.deepEqual(plain(saved.settled), [original.reminder]);
    assert.equal(saved.forced, true);
    assert.equal(saved.sends, 0);
    assert.equal(live.outgoing('Next.'), 'Next.\n@: [Scribe] ' + selected);
    live.sent();
    assert.equal(live.view().selected, null);
    assert.equal(live.view().draft, null);
    assert.equal(live.outgoing('Again.'), 'Again.');
});

test('a near-match does not consume a manual reminder and a new selection uses the actual textarea', async () => {
    const fields = { messages: story.slice(0, 41), unread: story.slice(40, 41) };
    for (const resend of [true, false]) {
        const { live, storage } = await preparedRoom(fields);
        const selected = 'Two  spaces.\nA second line.';
        await live.force(null, selected);
        const { reminder } = live.lines();
        const player = 'I wait, turn 42.';
        const carried = '[Scribe] ' + selected;
        assert.equal(live.outgoing(player), player + lineOf(carried));
        live.uncertain(live.posting());
        live.close();
        const other = carriedStory({ 42: carried.replace('  ', ' '), 44: carried }, 44, 0, { 44: player });
        const room = rig({ ...fields, messages: other.messages.slice(0, 42), own: other.own }, storage);
        assert.equal(room.live.view().unconfirmed.id, reminder);
        assert.equal(room.live.lines().ready, null);
        let sentReminder = reminder;
        if (resend) {
            const replacement = 'Completely different text.';
            await room.live.force(null, replacement);
            sentReminder = room.live.lines().reminder;
            assert.notEqual(sentReminder, reminder);
            assert.equal(room.live.outgoing('My retry.'), 'My retry.' + lineOf('[Scribe] ' + replacement));
            room.live.sent();
        } else {
            room.keeper.change({ messages: other.messages, own: other.own });
            room.live.view();
        }
        const saved = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
        assert.deepEqual(plain(saved.settled), [sentReminder]);
        assert.equal(saved.selection, null);
        assert.equal(saved.edited, null);
        assert.equal(saved.draft, null);
        assert.equal(saved.sends, 0);
    }
});

test('reopening two indistinguishable attempts cannot consume either selection on history alone', async () => {
    const fields = { messages: story.slice(0, 41), unread: story.slice(40, 41) };
    const { live, storage } = await preparedRoom(fields);
    await live.force(null, 'Keep.');
    const first = live.lines().reminder;
    live.outgoing('I wait, turn 42.');
    const original = live.posting();
    live.uncertain(original);
    live.edit('Changed.');
    live.edit('Keep.');
    const second = live.lines().reminder;
    live.outgoing('I wait, turn 42.');
    live.uncertain(live.posting());
    live.close();
    const history = carriedStory({ 42: '[Scribe] Keep.' }, 42);
    const room = rig({ ...fields, messages: history.messages, own: history.own }, storage);
    assert.equal(room.live.view().unconfirmed.id, second);
    assert.deepEqual(plain(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).settled), []);
    assert.equal(room.live.outgoing('Still waiting.'), 'Still waiting.');
    room.live.went(original);
    room.live.view();
    assert.deepEqual(plain(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).settled), [first]);
    assert.equal(room.live.view().unconfirmed.id, second);
});

/**
 * @param {object} fields
 * @return {Promise<object>}
 */
async function legacyTwoAttempts(fields) {
    const originalRoom = await preparedRoom(fields);
    await originalRoom.live.force(null, 'Known.');
    originalRoom.live.outgoing('Original.');
    const original = originalRoom.live.posting();
    originalRoom.live.uncertain(original);
    originalRoom.live.close();
    const saved = ScribeStore.read(originalRoom.storage, ROOM, ScribeStore.Kind.Live);
    saved.posts[0].retryAllowed = true;
    ScribeStore.write(originalRoom.storage, ROOM, ScribeStore.Kind.Live, saved);
    const room = rig(fields, originalRoom.storage);
    assert.equal(room.live.outgoing('Retry.'), 'Retry.' + lineOf('[Scribe] Known.'));
    const retry = room.live.posting();
    assert.equal(retry.reminder, original.reminder);
    room.live.uncertain(retry);
    return { room, original, retry };
}

for (const reports of ['original first', 'retry first', 'history only', 'retry then history']) {
    test(`one reminder on two accepted attempts resets at its first room position with ${reports}`, async () => {
        const fields = { messages: story.slice(0, 41), own: [], unread: [], settings: { refresh: 2, budget: 3 } };
        const legacy = await legacyTwoAttempts(fields);
        let room = legacy.room;
        const storage = room.storage;
        const { original, retry } = legacy;
        const id = original.reminder;
        if (reports === 'original first' || reports === 'retry first') {
            const order = reports === 'original first' ? [original, retry] : [retry, original];
            for (const post of order) {
                room.live.went(post);
            }
            assert.equal(room.live.view().sends, 1);
        } else if (reports === 'retry then history') {
            room.live.went(retry);
            assert.equal(room.live.view().sends, 0);
        }
        const history = carriedStory({ 42: '[Scribe] Known.', 44: '[Scribe] Known.' }, 44, 0,
            { 42: 'Original.', 44: 'Retry.' });
        const partial = { ...fields, messages: history.messages.slice(0, 42), own: history.own.filter((item) => item.position <= 42) };
        room.live.close();
        room = rig(partial, storage);
        assert.equal(room.live.view().sends, reports === 'history only' ? 0 : 1);
        room.live.close();
        room = rig({ ...fields, messages: history.messages, own: history.own }, storage);
        assert.equal(room.live.view().sends, 1);
        assert.equal(room.live.view().due, true);
        room.live.went(original);
        room.live.went(retry);
        const saved = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
        assert.equal(saved.sends, 1);
        assert.deepEqual(plain(saved.settled), [id]);
        assert.deepEqual(plain(saved.posts), []);
        assert.deepEqual(plain(saved.observedReminders), []);
    });
}

test('when the retry reaches room history first, the outstanding original still counts when its receipt arrives', async () => {
    const fields = { messages: story.slice(0, 41), own: [], unread: [], settings: { refresh: 2, budget: 3 } };
    const { room, original, retry } = await legacyTwoAttempts(fields);
    const { live, keeper, storage } = room;
    const id = original.reminder;
    const history = carriedStory({ 42: '[Scribe] Known.', 44: '[Scribe] Known.' }, 44, 0, { 42: 'Retry.', 44: 'Original.' });
    keeper.change({ messages: history.messages.slice(0, 42), own: history.own.filter((item) => item.position <= 42) });
    assert.equal(live.view().sends, 0);
    live.went(original);
    assert.equal(live.view().sends, 1);
    live.close();
    const fresh = rig({ ...fields, messages: history.messages, own: history.own }, storage);
    fresh.live.went(retry);
    assert.equal(fresh.live.view().sends, 1);
    const saved = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
    assert.deepEqual(plain(saved.settled), [id]);
    assert.deepEqual(plain(saved.posts), []);
    assert.deepEqual(plain(saved.attachments.map((row) => row.id)), [history.messages[41].id, history.messages[43].id]);
});

test('late and repeated receipts preserve accepted send order before room history catches up', async () => {
    const fields = { messages: story.slice(0, 41), own: [], unread: [] };
    const { live, storage } = await preparedRoom(fields);
    await live.force(null, 'The door is open.');
    live.outgoing('First.');
    const first = live.posting();
    live.uncertain(first);
    assert.equal(live.outgoing('Second.'), 'Second.');
    const second = live.posting();
    const other = rig({ ...fields, reader: false, trusted: false }, storage);
    other.live.went(second);
    assert.equal(live.view().sends, 0);
    live.went(second);
    live.went(first);
    assert.equal(live.view().sends, 1);
    live.close();
    other.keeper.change({ reader: true, trusted: true });
    other.live.went(first);
    other.live.went(second);
    assert.equal(other.live.view().sends, 1);
    for (let turn = 0; turn <= ScribeLive.Settings.CountedKept; turn++) {
        other.live.outgoing('Following ' + turn);
        other.live.sent();
    }
    const expected = ScribeLive.Settings.CountedKept + 2;
    assert.equal(other.live.view().sends, expected);
    other.live.went(second);
    assert.equal(other.live.view().sends, expected);
});

test('a late receipt replays the interval in room order after later independent deliveries and bare messages', async () => {
    const fields = { messages: story.slice(0, 41), unread: story.slice(40, 41) };
    const { live, storage, keeper } = await preparedRoom(fields);
    await live.force(null, 'Keep.');
    const first = live.lines().reminder;
    live.outgoing('Same.');
    const initial = live.posting();
    live.uncertain(initial);
    await live.force(first);
    live.edit('Changed.');
    live.edit('Keep.');
    live.outgoing('Same.');
    live.uncertain(live.posting());
    live.edit('Later.');
    const third = live.lines().reminder;
    live.outgoing('Distinct.');
    live.uncertain(live.posting());
    const history = carriedStory({ 42: '[Scribe] Keep.', 44: '[Scribe] Later.' }, 46, 0,
        { 42: 'Same.', 44: 'Distinct.', 46: 'Bare.' });
    keeper.change({ messages: history.messages, own: history.own });
    assert.equal(live.view().sends, 1);
    assert.deepEqual(plain(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).settled), [third]);
    live.went(initial);
    live.went(initial);
    assert.equal(live.view().sends, 1);
    const saved = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
    assert.deepEqual(plain(saved.settled), [third, first]);
    assert.deepEqual(plain(saved.historyTail), []);
    assert.equal(new Set(saved.counted.map((entry) => entry.id)).size, 3);
});

test('settling the replacement selection clears the matching edit after reload', async () => {
    const { live, storage } = rig();
    await live.reply(at(41));
    live.edit('Older draft.');
    await live.reply(at(43));
    assert.equal(live.view().draft, null);
    await live.force(null, live.view().ready);
    live.edit('Chosen instead.');
    const reminder = live.lines().reminder;
    live.close();
    const reopened = rig({}, storage);
    assert.equal(reopened.live.lines().reminder, reminder);
    reopened.live.outgoing('Go.');
    reopened.live.sent();
    const saved = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
    assert.deepEqual([saved.draft, saved.edited, saved.selection, saved.ready, saved.forced], [null, null, null, null, false]);
    assert.equal(reopened.live.outgoing('Bare.'), 'Bare.');
});

test('a send that never completes leaves the reminder pending, with the same identities for the retry', async () => {
    const { live } = await preparedRoom();
    const ready = live.view().ready;
    const first = live.lines();
    live.went({ ready: null, suggestion: null });
    assert.equal(live.outgoing('Try.'), `Try.${lineOf(ready)}`);
    assert.equal(live.view().ready, ready);
    assert.equal(live.view().forced, true);
    assert.equal(live.view().sends, 1);
    assert.equal(live.outgoing('Try again.'), `Try again.${lineOf(ready)}`);
    const retry = live.lines();
    assert.deepEqual([retry.reminder, retry.attempt], [first.reminder, first.attempt]);
    live.sent();
    assert.equal(live.view().ready, null);
    assert.equal(live.view().sends, 0);
});

test('a send with no room for the reminder counts once and leaves the reminder due', async () => {
    const { live } = await preparedRoom();
    const ready = live.view().ready;
    const first = live.lines();
    const long = 'x'.repeat(4600);
    assert.equal(live.outgoing(long), long);
    live.sent();
    const view = live.view();
    assert.equal(view.sends, 1);
    assert.equal(view.forced, true);
    assert.equal(view.ready, ready);
    assert.equal(live.lines().reminder, first.reminder);
    assert.equal(live.outgoing('Short.'), `Short.${lineOf(ready)}`);
    live.sent();
    assert.equal(live.view().ready, null);
    assert.equal(live.view().sends, 0);
});

test('a delayed unauthorized response releases only its own pending attempt and leaves the reminder queued', async () => {
    const { live, storage } = await preparedRoom();
    const offer = live.lines();
    live.outgoing('I wait.');
    const attempt = live.posting();
    live.uncertain(attempt);
    assert.equal(live.view().awaiting, true);
    assert.equal(live.lines().ready, null);
    assert.equal(live.outgoing('I listen.'), 'I listen.');
    const ordinary = live.posting();
    live.went(ordinary);
    assert.equal(live.view().sends, 1);
    live.rejected(attempt);
    const rejected = live.view();
    assert.equal(rejected.sends, 1);
    assert.equal(rejected.awaiting, false);
    assert.match(rejected.held, /HTTP 401/);
    assert.deepEqual([live.lines().reminder, live.lines().ready], [offer.reminder, offer.ready]);
    assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).settled.length, 0);
    live.went(attempt);
    assert.equal(live.view().sends, 1);
    assert.equal(live.outgoing('Please retry.'), `Please retry.${lineOf(offer.ready)}`);
    live.sent();
    assert.equal(live.view().sends, 0);
    assert.equal(live.view().ready, null);
    assert.equal(live.view().held, null);
});

test('a forbidden send keeps the exact selection across reload until a later send is accepted', async () => {
    const { live, storage, keeper } = await preparedRoom();
    await live.force(null, 'Count the ships before dawn.');
    const selected = live.lines();
    live.outgoing('I wait.');
    live.sendForbidden();
    live.rejected(live.posting(), 403);
    assert.equal(live.view().forbiddenSend, true);
    assert.equal(live.lines().reminder, selected.reminder);
    assert.equal(live.view().awaiting, false);
    live.close();
    const after = rig(keeper.view(), storage).live;
    assert.equal(after.view().forbiddenSend, true);
    const retry = after.outgoing('I wait again.');
    assert.equal(retry.split('Count the ships before dawn.').length, 2);
    assert.equal(after.view().forbiddenSend, true);
    after.sent();
    after.sendAllowed();
    assert.equal(after.view().forbiddenSend, false);
    assert.equal(after.view().selectionId, null);
    assert.equal(after.view().lastDelivery, selected.reminder);
});

test('settling an older journal entry preserves the latest observed native send warning', async () => {
    for (const forbidden of [true, false]) {
        const { live } = await preparedRoom();
        live.outgoing('I wait.');
        const first = live.posting();
        live.uncertain(first);
        if (forbidden) {
            live.sendForbidden();
            live.went(first);
            assert.equal(live.view().forbiddenSend, true);
        } else {
            live.sendAllowed();
            live.rejected(first, 403);
            assert.equal(live.view().forbiddenSend, false);
        }
    }
});

test('stream outcomes change only the room warning on an accepted delivery and keep a newer choice queued', async () => {
    const { live, storage } = await preparedRoom();
    const sent = live.lines().reminder;
    live.outgoing('I wait.');
    live.sent();
    const record = () => JSON.parse(JSON.stringify(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live)));
    const before = record();
    for (const cause of ['rateLimited', 'chatAbused', 'ok']) {
        live.streamResult('MESSAGE-42', cause);
        const expected = cause === 'ok' ? null : cause;
        assert.equal(live.view().streamWarning, expected);
        assert.deepEqual(record(), { ...before, streamWarning: expected });
        assert.equal(live.view().ready, null);
        assert.equal(live.view().lastDelivery, sent);
    }
    await live.force(null, 'Bring enough water.');
    const newer = live.lines().reminder;
    live.streamResult('MESSAGE-42', 'chatAbused');
    assert.equal(live.lines().reminder, newer);
    assert.equal(live.view().selected, 'Bring enough water.');
});

test('a Zeta warning seen by a watching tab stays visible locally without overwriting the reader’s record', async () => {
    const { live, storage } = await preparedRoom();
    const watcher = rig({ reader: false, trusted: false }, storage).live;
    const saved = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
    watcher.sendForbidden();
    watcher.streamResult('MESSAGE-42', 'rateLimited');
    assert.equal(watcher.view().forbiddenSend, true);
    assert.equal(watcher.view().streamWarning, 'rateLimited');
    assert.equal(live.view().streamWarning, null);
    assert.deepEqual(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live), saved);
    watcher.sendAllowed();
    watcher.streamResult('MESSAGE-42', 'ok');
    assert.equal(watcher.view().forbiddenSend, false);
    assert.equal(watcher.view().streamWarning, null);
    assert.deepEqual(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live), saved);
});

test('an edited reminder clears when it goes, and a newer edit made meanwhile remains selected for the next send', async () => {
    const { live } = await preparedRoom();
    const mine = '[Scribe] Mine, not yours.';
    live.edit(mine);
    assert.equal(live.outgoing('Go.'), `Go.${lineOf(mine)}`);
    live.sent();
    const gone = live.view();
    assert.equal(gone.ready, null);
    assert.equal(gone.edited, false);
    assert.equal(gone.draft, null);
    assert.equal(gone.forced, false);
    assert.equal(live.outgoing('Again.'), 'Again.');

    const room = await preparedRoom();
    const first = '[Scribe] First wording.';
    const newer = first + ' I saved this new sentence while confirmation was pending.';
    room.live.edit(first);
    assert.equal(room.live.outgoing('Go.'), `Go.${lineOf(first)}`);
    room.live.edit(newer);
    room.live.sent();
    const view = room.live.view();
    assert.equal(view.ready, newer);
    assert.equal(view.edited, true);
    assert.equal(view.draft, null);
    assert.equal(room.live.outgoing('Next.'), 'Next.' + lineOf(newer));
});

test('a writer response that arrives after the send is dropped', async () => {
    const big = bookState(BIG);
    const { storage, keeper, model, live } = rig({ state: big, settings: { refresh: 1, budget: 3 } });
    await live.reply(at(41));
    const first = live.view().ready;
    assert.notEqual(first, null);
    const offered = live.lines();
    assert.equal(offered.ready, first);
    const release = model.holdSystem(ScribeReminder.StoryPrompt);
    keeper.change({ state: revised(bookState(BIG.map((fact) => fact.replace('skin | pale', 'skin | dark')))) });
    live.view();
    await ticks();
    live.went({
        ready: first,
        suggestion: null,
        carried: first,
        crowded: false,
        reminder: offered.reminder,
        attempt: offered.attempt,
    });
    release();
    await ticks();
    assert.equal(live.view().ready, null);
    assert.equal(live.lines().ready, null);
    assert.equal(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).ready, null);
});

test('two tabs: a watcher neither counts nor settles a delivery, and takes the settled state when it reads', async () => {
    const reader = await preparedRoom();
    const ready = reader.live.view().ready;
    const offered = reader.live.lines();
    const report = {
        ready,
        suggestion: null,
        carried: ready,
        crowded: false,
        reminder: offered.reminder,
        attempt: offered.attempt,
    };
    const watching = rig({ reader: false, trusted: false }, reader.storage);
    watching.live.went(report);
    watching.live.sent();
    assert.equal(ScribeStore.read(reader.storage, ROOM, ScribeStore.Kind.Live).ready, ready);
    assert.equal(reader.live.view().ready, ready);
    reader.live.went(report);
    assert.equal(reader.live.view().ready, null);
    reader.live.close();
    watching.keeper.change({ reader: true, trusted: true });
    const taken = watching.live.view();
    assert.equal(taken.ready, null);
    assert.equal(taken.forced, false);
    assert.equal(taken.awaiting, false);
    assert.equal(watching.live.outgoing('Hello.'), 'Hello.');
});

test('a reload between the send and its acknowledgement waits, and a matching new player message settles it once', async () => {
    const { storage, ready, reminder, attempt } = await interrupted();
    const saved = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
    assert.equal(saved.posts[0].carried, ready);
    assert.equal(saved.posts[0].floor, 41);
    const chat = carriedStory({ 42: ready });
    const room = rig({ messages: story.slice(0, 41), unread: story.slice(40, 41) }, storage);
    const waiting = room.live.view();
    assert.equal(waiting.awaiting, true);
    assert.equal(waiting.ready, null);
    assert.equal(waiting.held, null);
    assert.equal(room.live.outgoing('Typed.'), 'Typed.');
    assert.equal(room.live.lines().ready, null);

    const echo = new CampaignBuilder('Orla');
    for (let number = 1; number <= 42; number++) {
        if (number === 42) {
            echo.narrator(`The echo of ${ready}`);
        } else if (scripted[number] !== undefined) {
            echo.reply(scripted[number]);
        } else {
            echo.narrator(`The tale goes on, line ${number}.`);
        }
    }
    const echoed = ScribeIntake.read(echo.messages);
    room.keeper.change({ messages: echoed.messages, own: [{ text: `@: ${ready}`, position: 42 }] });
    assert.equal(room.live.view().awaiting, true);
    assert.equal(room.live.view().ready, null);
    room.keeper.change({ messages: chat.messages.slice(0, 42), own: chat.own });
    const settled = room.live.view();
    assert.equal(settled.awaiting, false);
    assert.equal(settled.ready, null);
    assert.equal(settled.edited, false);
    assert.equal(settled.forced, false);
    assert.equal(settled.sends, 0);
    const stored = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
    assert.equal(stored.ready, null);
    assert.equal(stored.delivery, null);
    assert.deepEqual(plain(stored.settled), [reminder]);
    assert.deepEqual(plain(stored.counted), [{ id: chat.messages[41].id, fingerprint: chat.messages[41].fingerprint }]);
    room.live.went({ ready, suggestion: null, carried: ready, crowded: false, reminder, attempt });
    assert.equal(room.live.view().sends, 0);
});

test('plain player wording shared with an interrupted reminder counts once and cannot identify the delivery', async () => {
    const { storage } = await interrupted();
    const plainChat = carriedStory({});
    const room = rig({ messages: story.slice(0, 41), unread: story.slice(40, 41) }, storage);
    assert.equal(room.live.view().awaiting, true);
    assert.equal(room.live.lines().ready, null);
    room.keeper.change({ messages: plainChat.messages.slice(0, 42), own: plainChat.own });
    const view = room.live.view();
    assert.equal(view.awaiting, true);
    assert.equal(view.forced, true);
    assert.equal(view.sends, 1);
    assert.equal(room.live.lines().ready, null);
    assert.equal(room.live.outgoing('Next.'), 'Next.');
});

test('the first sentence of an interrupted full paragraph is a different block', async () => {
    const { storage, ready } = await interrupted();
    const shorter = ready.slice(0, ready.indexOf('. ') + 1);
    assert.ok(shorter.length > 0 && shorter.length < ready.length);
    const chat = carriedStory({ 42: shorter });
    const room = rig({ messages: chat.messages.slice(0, 42), own: chat.own }, storage);
    assert.equal(room.live.view().sends, 1);
    assert.equal(room.live.view().forced, true);
    assert.equal(room.live.lines().ready, ready);
    assert.deepEqual(plain(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).settled), []);
});

test('a different player submission quoting the full paragraph leaves its interrupted delivery pending across reload', async () => {
    const { storage, ready, reminder } = await interrupted();
    const chat = carriedStory({ 42: ready, 44: ready }, 44, 0, { 42: 'Someone else copies the reminder.', 44: 'I wait, turn 42.' });
    const partial = { messages: chat.messages.slice(0, 42), own: chat.own };
    const first = rig(partial, storage);
    assert.equal(first.live.view().sends, 1);
    assert.equal(first.live.view().awaiting, true);
    first.live.close();
    const next = rig(partial, storage);
    assert.equal(next.live.view().awaiting, true);
    next.keeper.change({ messages: chat.messages, own: chat.own });
    assert.equal(next.live.view().sends, 0);
    assert.equal(next.live.view().awaiting, false);
    assert.deepEqual(plain(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).settled), [reminder]);
});

test('a saved offer that matches the block on the player message after its target is consumed once, and counts later messages', async () => {
    const offer = '[Scribe] Dark Wings, the pursuit, and Mirra still inside.';
    const target = 896;
    const chat = carriedStory({ 897: offer }, 900, 1);
    const messages = chat.messages;
    assert.equal(messages[target - 1].fromPlayer, false);
    assert.equal(messages[target].fromPlayer, true);
    const scene = {
        message: messages[target - 1].id,
        fingerprint: messages[target - 1].fingerprint,
        position: target,
        day: 1,
        place: 'The inn room',
        reach: 'private',
        present: [{ subject: null, label: 'Kira' }],
        summary: 'They plan a ride',
        changed: false,
    };
    const record = {
        now: scene,
        reminded: scene,
        ready: offer,
        led: [],
        basis: { revision: state.revision, first: [], notes: ScribeLive.marked([]), story: 'abcd1234' },
        story: { key: 'abcd1234', text: 'They plan a ride.' },
        sends: 6,
        findings: [],
        seen: { id: scene.message, fingerprint: scene.fingerprint, position: target, before: null },
        edition: 1,
    };
    const fields = { messages, own: chat.own, unread: [], read: 900, lastRead: { id: scene.message, position: target } };
    const storage = new FakeStorage();
    ScribeStore.write(storage, ROOM, ScribeStore.Kind.Live, record);
    const room = rig(fields, storage);
    const view = room.live.view();
    assert.equal(view.prepared, false);
    assert.equal(view.ready, null);
    assert.equal(view.sends, 1);
    const stored = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
    assert.equal(stored.ready, null);
    assert.equal(stored.sends, 1);
    const counted = messages.slice(target).filter((message) => message.fromPlayer)
        .map(({ id, fingerprint }) => ({ id, fingerprint }));
    assert.deepEqual(plain(stored.counted), plain(counted));
    room.live.close();
    const again = rig(fields, storage);
    assert.equal(again.live.view().prepared, false);
    assert.equal(again.live.view().sends, 1);

    const other = carriedStory({ 897: '[Scribe] A different reminder altogether.' }, 900, 1);
    const uncertain = new FakeStorage();
    ScribeStore.write(uncertain, ROOM, ScribeStore.Kind.Live, record);
    const stays = rig({ ...fields, messages: other.messages, own: other.own }, uncertain);
    assert.equal(stays.live.view().unconfirmed.text, offer);
    assert.equal(stays.live.lines().ready, null);
});

test('records saved before delivery identities, and damaged identity fields, load as empty and mint from one', async () => {
    const base = {
        now: null,
        ready: null,
        led: [],
        sends: 2,
        findings: [],
        suggestion: null,
        seen: null,
        reminded: null,
        edition: 1,
    };
    for (const fields of [
        {},
        { delivery: 'x', serial: -4, settled: [7], counted: 'y' },
        { delivery: { id: 'a' }, serial: 1.5 },
        { delivery: { id: 'a', attempt: 'b', sending: { text: 5, after: null } } },
        { delivery: { id: 'a', attempt: 'b', sending: { text: 't', after: { id: 1, position: 'x' } } } },
        { delivery: { id: 'a', attempt: 'b' } },
    ]) {
        const storage = new FakeStorage();
        ScribeStore.write(storage, ROOM, ScribeStore.Kind.Live, { ...base, ...fields });
        const view = rig({}, storage).live.view();
        const named = JSON.stringify(fields);
        assert.equal(view.awaiting, false, named);
        assert.equal(view.sends, 2, named);
        assert.equal(view.ready, null, named);
    }
    const storage = new FakeStorage();
    ScribeStore.write(storage, ROOM, ScribeStore.Kind.Live, { ...base, serial: -4, delivery: 'x' });
    const { live } = rig({}, storage);
    await live.reply(at(41));
    await live.force();
    const stored = ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live);
    assert.equal(stored.serial, 1);
    assert.equal(stored.delivery.id, `${ROOM}#reminder-1`);
    assert.equal(stored.delivery.attempt, `${ROOM}#attempt-1`);
    const pending = new FakeStorage();
    ScribeStore.write(pending, ROOM, ScribeStore.Kind.Live, {
        ...base,
        delivery: { id: 'a', attempt: 'b', sending: { text: '[Scribe] x', after: { id: story.at(-1).id, position: 60 } } },
    });
    assert.equal(rig({}, pending).live.view().awaiting, true);
});

test('a late receipt cannot clear text selected for a later send', async () => {
    const { storage, ready, reminder } = await interrupted();
    const waiting = { messages: story.slice(0, 41), unread: story.slice(40, 41) };
    const room = rig(waiting, storage);
    assert.equal(room.live.view().unconfirmed.id, reminder);
    await room.live.force('an-obsolete-reminder');
    assert.equal(room.live.lines().ready, null);
    const text = 'Now send this instead.';
    await room.live.force(null, text);
    assert.equal(room.live.lines().ready, text);
    room.live.close();
    const opened = rig(waiting, storage);
    assert.equal(opened.live.view().unconfirmed, null);
    const history = carriedStory({ 42: ready });
    opened.keeper.change({ messages: history.messages.slice(0, 42), own: history.own });
    assert.equal(opened.live.view().sends, 0);
    assert.deepEqual(plain(ScribeStore.read(storage, ROOM, ScribeStore.Kind.Live).settled), [reminder]);
    assert.equal(opened.live.lines().ready, text);
    assert.equal(opened.live.outgoing('After confirmation.'), 'After confirmation.' + lineOf('[Scribe] ' + text));
});
