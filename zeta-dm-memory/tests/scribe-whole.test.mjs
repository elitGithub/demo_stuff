import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import CampaignBuilder from './support/CampaignBuilder.mjs';
import FakeLocks from './support/FakeLocks.mjs';
import FakeScribeWorker from './support/FakeScribeWorker.mjs';
import FakeStorage from './support/FakeStorage.mjs';
import FakeTimers from './support/FakeTimers.mjs';
import WholeModel from './support/WholeModel.mjs';
import WholeSite from './support/WholeSite.mjs';
import WholeTab from './support/WholeTab.mjs';

const PACKED = readFileSync(new URL('../scribe/scribe.user.js', import.meta.url), 'utf8');
const START = Date.UTC(2026, 10, 15, 9, 0, 0);
const KEY = 'sk-test-KEY-123';
const BARE_TOKEN = WholeSite.Token.slice('Bearer '.length);
const ROOM = 'harbour';
const CHAT = '/rooms/harbour';
const PLAYER = 'Halvard';
const CHAT_LENGTH = 91;
const MOST_STEPS = 4000;
const STEP_MS = 100;
const TICK_MS = 20000;
const MOST_QUIET = 10;
const WIDE = 1280;
const NARROW = 390;
const QUARRY = 'quarry';
const QUARRY_LENGTH = 61;
const TOP_ORIGIN = 'https://zeta-ai.io';
const FRAME_ORIGIN = 'https://frame.pingpong.ai';
const BRIDGE = 'scribe-bridge';
const BRIDGE_READ = 'GM_getValue("scribe-bridge", null)';
const OFFICE = 'Day 1 | The ledger office | private | present: Halvard, Mirelle | They settle the debt\nCHANGED: yes';
const LOOKS =
    'Mirelle: brown eyes, black hair, worn in a braid, short and broad-shouldered, a scar across her left palm.';
const PARTY = 'The party: a stranger asks after Oswin.';
const TOLD = 'Halvard came to the harbour to keep the peace, and Mirelle owes Brandt.';
const LEAD = `[Scribe] The story so far: ${TOLD}`;
const FIRST_READY = `${LEAD} ${LOOKS} ${PARTY}`;
const HAIR = `${LEAD} Mirelle has black hair, worn in a braid.`;
const LOOKS_LEFT = 'Mirelle: brown eyes, short and broad-shouldered, a scar across her left palm.';
const OLD_HAIR = 'black, worn in a braid';
const APRON = 'an ink-stained apron';
const NEW_HAIR = 'black, cut short';
const GOES_FIRST = "The book's value goes first in the next reminder, if this room may hear it.";
const WENT_OUT = "The book's value went out in a reminder.";
const RIDER = 'A rider arrives at the gate.';
const COMPASS = 'a brass compass from her father';
const ASKED = 'I ask Mirelle whether the debt is settled.';
const REPLY = Object.freeze([
    ['Narrator', 'Mirelle shakes out hair as red as rust and opens the red ledger.'],
    ['Mirelle', 'The debt to Brandt is paid, Halvard.'],
]);
const CALM_REPLY = Object.freeze([['Narrator', 'Mirelle shrugs and opens the red ledger without a word.']]);

/**
 * @return {Object<string, object>}
 */
function reference() {
    const context = vm.createContext({ TextEncoder, URL, URLSearchParams });
    const loaded = {};
    const files = [
        'core/ScribeText',
        'core/ScribeCategory',
        'core/ScribeIntake',
        'core/ScribeAnswer',
        'core/ScribeLog',
        'core/ScribeReplay',
        'core/ScribeKnowledge',
        'core/ScribeAnalyzer',
        'page/ScribeStore',
        'page/ScribeScene',
        'page/ScribeReminder',
        'page/ScribePedant',
        'page/ScribeMuse',
    ];
    for (const file of files) {
        const url = new URL(`../scribe/${file}.js`, import.meta.url);
        vm.runInContext(readFileSync(url, 'utf8'), context, { filename: url.pathname });
        const name = file.split('/').at(-1);
        loaded[name] = vm.runInContext(name, context);
    }
    return loaded;
}

const REFERENCE = reference();
const PROMPTS = new Map([
    [REFERENCE.ScribeAnalyzer.Prompt, 'Story'],
    [REFERENCE.ScribeAnalyzer.NotesPrompt, 'Notes'],
    [REFERENCE.ScribeAnalyzer.AnswersPrompt, 'Answers'],
    [REFERENCE.ScribeScene.Prompt, 'Scene'],
    [REFERENCE.ScribePedant.Prompt, 'Pedant'],
    [REFERENCE.ScribeMuse.SuggestPrompt, 'Suggest'],
    [REFERENCE.ScribeReminder.StoryPrompt, 'Told'],
]);

const NARRATION = Object.freeze({
    1: [['Narrator', 'The harbour market wakes. Mirelle, her black hair worn in a braid, counts coins at her stall.']],
    3: [['Narrator', 'Tamsin, grey-eyed, mends nets by the water.']],
    5: [['Oswin', 'I am Oswin, harbourmaster here. Keep the peace, guard.']],
    7: [['Narrator', 'Mirelle changes foreign coin for the traders.']],
    9: [['Mirelle', 'I owe Brandt more than this stall earns in a season.']],
    11: [['Narrator', 'Mirelle looks up, her brown eyes narrowed.']],
    13: [['Narrator', 'Mirelle is short and broad-shouldered.']],
    15: [['Narrator', 'Mirelle counts every coin twice, as always.']],
    17: [['Narrator', 'Halvard remembers the siege he ran from, and tells no one.']],
    41: [['Narrator', 'Tamsin turns, her blue eyes bright in the sun.']],
    43: [['Oswin', 'Fifty-one years I have kept this harbour.']],
    45: [['Narrator', 'Mirelle opens a ledger bound in red.']],
    47: [['Narrator', 'A scar runs across the palm of her left hand, Mirelle says.']],
    71: [['Narrator', 'Halvard hums, as he does when he is nervous.']],
    73: [['Mirelle', 'I sleep in a room above the market.']],
    81: [['Narrator', 'A stranger in a grey hood asks after Oswin.']],
});
const SPOKEN = Object.freeze({
    2: 'I am Halvard, thirty-four winters old, and I guard this harbour.',
});
const SUBJECTS = Object.freeze([
    [1, 'Mirelle | character'],
    [1, 'The harbour market | place'],
    [2, 'Halvard | character'],
    [3, 'Tamsin | character'],
    [5, 'Oswin | character'],
]);
const FACTS = Object.freeze([
    [1, 'Mirelle | hair | black, worn in a braid'],
    [2, 'Halvard | age | 34'],
    [2, 'Halvard | role | harbour guard'],
    [3, 'Tamsin | eyes | grey'],
    [3, 'Tamsin | role | net-mender'],
    [5, 'Oswin | role | harbourmaster'],
    [7, 'Mirelle | role | money-changer'],
    [11, 'Mirelle | eyes | brown'],
    [13, 'Mirelle | build | short and broad-shouldered'],
    [15, 'Mirelle | trait | counts every coin twice'],
    [17, 'Halvard | background | deserted at the siege | hidden'],
    [41, 'Tamsin | eyes | blue'],
    [43, 'Oswin | age | 51'],
    [45, 'Mirelle | belonging | a ledger bound in red'],
    [47, 'Mirelle | appearance | a scar across her left palm'],
    [71, 'Halvard | trait | hums when he is nervous'],
    [73, 'Mirelle | location | a room above the market'],
]);
const SCENES = Object.freeze([
    [1, 30, 'Day 1 | #1-#30 | The harbour market | public | present: Halvard, Mirelle, Tamsin, Oswin | The market opens and Mirelle changes coin'],
    [31, 60, 'Day 1 | #31-#60 | The harbour market | public | present: Halvard, Mirelle, Tamsin, Oswin | Oswin inspects the stalls'],
    [61, 90, 'Day 1 | #61-#90 | The harbour market | public | present: Halvard, Mirelle, Tamsin | Night falls over the market'],
]);
const THREADS = Object.freeze([
    [9, 'OPEN | the debt Mirelle owes to Brandt'],
    [81, 'OPEN | a stranger asks after Oswin'],
]);
const COSTS = Object.freeze({
    Story: 0.25,
    Answers: 0.25,
    Notes: 0.04,
    Scene: 0.01,
    Pedant: 0.02,
    Suggest: 0.03,
});

/**
 * @param {number} length
 * @return {CampaignBuilder}
 */
function campaign(length = CHAT_LENGTH) {
    const builder = new CampaignBuilder(PLAYER);
    for (let number = 1; number <= length; number++) {
        if (number % 2 === 0) {
            builder.player(SPOKEN[number] ?? `Halvard keeps watch by the quay, turn ${number}.`);
        } else {
            builder.reply(NARRATION[number] ?? [['Narrator', `The harbour market goes on, line ${number}.`]]);
        }
    }
    return builder;
}

/**
 * @param {ReadonlyArray<[number, string]>} known
 * @return {(user: string) => string}
 */
function storyFrom(known) {
    /**
     * @param {string} user
     * @return {string}
     */
    return (user) => storyAnswer(user, known);
}

/**
 * @param {string} user
 * @param {ReadonlyArray<[number, string]>} known
 * @return {string}
 */
function storyAnswer(user, known) {
    const heading = /NEW MESSAGES \(#(\d+) to #(\d+)\):/.exec(user);
    if (heading === null) {
        return '=== FACTS';
    }
    const first = Number(heading[1]);
    const last = Number(heading[2]);
    /**
     * @param {number} position
     * @return {boolean}
     */
    const inside = (position) => position >= first && position <= last;
    const blocks = [];
    const subjects = SUBJECTS.filter(([position]) => inside(position)).map(([, line]) => line);
    const facts = known.filter(([position]) => inside(position)).map(([position, line]) => `${line} | #${position}`);
    const scenes = SCENES.filter(([from, to]) => from >= first && to <= last).map(([, , line]) => line);
    const threads = THREADS.filter(([position]) => inside(position)).map(([position, line]) => `${line} | #${position}`);
    for (const [name, lines] of [
        ['SUBJECTS', subjects],
        ['FACTS', facts],
        ['SCENES', scenes],
        ['THREADS', threads],
    ]) {
        if (lines.length > 0) {
            blocks.push([`=== ${name}`, ...lines].join('\n'));
        }
    }
    return blocks.length === 0 ? '=== FACTS' : blocks.join('\n');
}

/**
 * @return {string}
 */
function sceneAnswer() {
    return 'Day 1 | The harbour market | public | present: Halvard, Mirelle, a fishwife | Mirelle talks of the debt\nCHANGED: no';
}

/**
 * @param {string} user
 * @return {string}
 */
function pedantAnswer(user) {
    const fact = /^(F\d+) \| Mirelle \| hair \| /m.exec(user);
    const reply = user.slice(user.indexOf('REPLY (#'));
    if (fact === null || !reply.includes('red as rust')) {
        return '=== CONTRADICTIONS\n(none)\n=== LEAKS\n(none)';
    }
    return `=== CONTRADICTIONS\n${fact[1]} | Mirelle | hair | red as rust`;
}

/**
 * @param {string} user
 * @return {string}
 */
function notesAnswer(user) {
    const cited = /^\[#(\d+)\] /m.exec(user);
    return cited === null ? '=== FACTS' : `=== FACTS\nMirelle | belonging | ${COMPASS} | #${cited[1]}`;
}

const ANSWERS = Object.freeze({
    Story: storyFrom(FACTS),
    Answers: () => '=== FACTS',
    Notes: notesAnswer,
    Scene: sceneAnswer,
    Pedant: pedantAnswer,
    Suggest: () => `LINE: ${RIDER}`,
    Told: () => TOLD,
});

/**
 * @param {{ locks?: boolean, query?: boolean, layout?: string }} options
 * @return {{ clock: FakeTimers, site: WholeSite, model: WholeModel, storage: FakeStorage, locks: FakeLocks|null, query: boolean, layout: string, posts: object[], tabs: WholeTab[], made: number }}
 */
function world(options = {}) {
    const clock = new FakeTimers(START);
    const site = new WholeSite(campaign());
    site.clock = clock;
    return {
        clock,
        site,
        model: new WholeModel(PROMPTS, ANSWERS, COSTS),
        worker: new FakeScribeWorker(clock),
        storage: new FakeStorage(),
        locks: options.locks === false ? null : new FakeLocks(),
        query: options.query !== false,
        layout: options.layout ?? 'frame',
        posts: [],
        tabs: [],
        made: 0,
    };
}

/**
 * @param {object} walk
 * @param {string} path
 * @param {number} width
 * @param {{ origin?: string, layout?: string, storage?: FakeStorage, locks?: FakeLocks|null }} extra
 * @return {WholeTab}
 */
function install(walk, path, width = WIDE, extra = {}) {
    walk.made++;
    const tab = new WholeTab({
        name: `tab-${walk.made}`,
        tabId: `tab-${walk.made}`,
        packed: PACKED,
        clock: walk.clock,
        storage: extra.storage ?? walk.storage,
        site: walk.site,
        model: walk.model,
        worker: walk.worker,
        locks: extra.locks === undefined ? walk.locks : extra.locks,
        path,
        width,
        query: walk.query,
        layout: extra.layout ?? walk.layout,
        origin: extra.origin,
        posts: walk.posts,
    });
    walk.tabs.push(tab);
    tab.run();
    return tab;
}

/**
 * @return {Promise<void>}
 */
function settle() {
    return new Promise((resolve) => setImmediate(resolve));
}

/**
 * @param {object} walk
 * @param {number} milliseconds
 * @return {Promise<void>}
 */
async function pass(walk, milliseconds) {
    await settle();
    const target = walk.clock.now() + milliseconds;
    for (let step = 0; step < MOST_STEPS; step++) {
        const next = walk.clock.next;
        if (next === null || next > target) {
            walk.clock.advance(target - walk.clock.now());
            await settle();
            return;
        }
        walk.clock.advance(Math.max(0, next - walk.clock.now()));
        await settle();
    }
    assert.fail(`Time did not come to rest within ${MOST_STEPS} timers`);
}

/**
 * @param {() => boolean} condition
 * @return {boolean}
 */
function holds(condition) {
    try {
        return condition() === true;
    } catch {
        return false;
    }
}

/**
 * @param {object} walk
 * @param {string} label
 * @param {() => boolean} condition
 * @param {number} most
 * @return {Promise<void>}
 */
async function until(walk, label, condition, most) {
    await settle();
    for (let waited = 0; waited <= most; waited += STEP_MS) {
        if (holds(condition)) {
            return;
        }
        await pass(walk, STEP_MS);
    }
    assert.fail(`${label}: it did not happen within ${most} ms of scripted time`);
}

/**
 * @param {object} walk
 * @param {string} kind
 * @param {string} room
 * @return {object|null}
 */
function stored(walk, kind, room = ROOM) {
    return REFERENCE.ScribeStore.read(walk.storage, room, kind);
}

/**
 * @param {object} walk
 * @return {object}
 */
function bookState(walk) {
    const book = stored(walk, 'book');
    const order = REFERENCE.ScribeIntake.read(stored(walk, 'campaign').messages).messages.map((message) => message.id);
    return REFERENCE.ScribeReplay.run(book.log, order);
}

/**
 * @param {object} walk
 * @param {string} role
 * @param {number} from
 * @return {number}
 */
function asked(walk, role, from) {
    return walk.model.calls.slice(from).filter((call) => call.role === role).length;
}

/**
 * @param {object} walk
 * @param {number} from
 * @return {string[]}
 */
function rolesSince(walk, from) {
    return walk.model.calls.slice(from).map((call) => call.role);
}

/**
 * @param {string} user
 * @return {string}
 */
function rangeOf(user) {
    const heading = /NEW MESSAGES \(#(\d+) to #(\d+)\):/.exec(user);
    return heading === null ? 'none' : `${heading[1]}-${heading[2]}`;
}

/**
 * @param {object} walk
 * @param {(role: string, input: string) => boolean} match
 * @return {{ release: Function|null }}
 */
function holdCompletion(walk, match) {
    const held = { release: null };
    const request = walk.model.request.bind(walk.model);
    walk.model.request = (tab, details) => {
        const [system, user] = JSON.parse(details.data).messages;
        if (match(walk.model.roleOf(system.content), user.content)) {
            walk.model.request = request;
            return request(tab, { ...details, onload: (response) => { held.release = () => details.onload(response); } });
        }
        return request(tab, details);
    };
    return held;
}

/**
 * @param {*} value
 * @return {*}
 */
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

/**
 * @param {object} walk
 * @return {number}
 */
function billed(walk) {
    return walk.model.calls.reduce((sum, call) => sum + (walk.model.costs[call.role] ?? 0), 0);
}

/**
 * @param {object} walk
 * @return {number}
 */
function spentToday(walk) {
    const date = new Date(walk.clock.now());
    const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part) => String(part).padStart(2, '0')).join('-');
    return REFERENCE.ScribeStore.spent(walk.storage, ROOM, day);
}

/**
 * @param {object} walk
 * @return {string}
 */
function storageText(walk) {
    const text = JSON.stringify([...walk.storage.values.entries()]);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    }
    return `${text.length}:${(hash >>> 0).toString(16)}`;
}

/**
 * @param {object} walk
 * @return {string[]}
 */
function storedNames(walk) {
    return [...walk.storage.values.keys()];
}

/**
 * @param {WholeTab} tab
 * @return {string[]}
 */
function queued(tab) {
    tab.panel.tab('Findings');
    const reminder = tab.panel.byId('scribe-reminder').value;
    const rows = tab.panel.rowTexts('queued');
    return reminder === '' ? rows : [`Reminder: ${reminder}`, ...rows];
}

/**
 * @param {WholeTab} tab
 * @return {object[]}
 */
function findingRows(tab) {
    tab.panel.tab('Findings');
    return tab.panel.rows('findings');
}

/**
 * @param {object} walk
 * @return {Promise<WholeTab>}
 */
async function opened(walk) {
    const tab = install(walk, '/');
    tab.ready();
    await pass(walk, 1000);
    tab.go(CHAT);
    await tab.openPage();
    await until(walk, 'the chat to be pulled', () => tab.panel.headline().startsWith('No book for this chat yet'), 15000);
    return tab;
}

/**
 * @param {object} walk
 * @param {WholeTab} tab
 * @return {Promise<void>}
 */
async function saveKey(walk, tab) {
    tab.panel.tab('Settings');
    tab.panel.type('scribe-key', KEY);
    tab.panel.click('scribe-save-key');
    await settle();
}

/**
 * @param {object} walk
 * @param {WholeTab} tab
 * @param {string} budget
 * @return {Promise<void>}
 */
async function adopt(walk, tab, budget) {
    tab.panel.tab('Settings');
    tab.panel.type('scribe-setting-size', '30');
    tab.panel.type('scribe-setting-budget', budget);
    tab.panel.click('scribe-next');
    await until(walk, 'the adoption to finish', () => tab.panel.headline().startsWith('Up to date'), 15000);
    await until(
        walk,
        'the newest reply to be checked after the first reading',
        () => stored(walk, 'live', tab.room())?.seen?.id === walk.site.messagesIn(tab.room()).at(-1).id,
        TICK_MS * 2,
    );
    await quiet(walk, 'the first check after adopting');
}

/**
 * @param {object} walk
 * @param {string} label
 * @return {Promise<void>}
 */
async function quiet(walk, label) {
    for (let round = 0; round < MOST_QUIET; round++) {
        const before = walk.model.calls.length;
        await pass(walk, TICK_MS);
        if (walk.model.calls.length === before) {
            return;
        }
    }
    assert.fail(`${label}: the tab did not come to rest within ${MOST_QUIET} ticks`);
}

/**
 * @param {object} walk
 * @param {WholeTab} tab
 * @return {Promise<void>}
 */
async function forceReminder(walk, tab) {
    tab.panel.tab('Findings');
    tab.panel.click('scribe-force');
    await until(
        walk,
        'the forced reminder to be ready',
        () => typeof stored(walk, 'live', tab.room())?.ready === 'string',
        TICK_MS * 2,
    );
    await quiet(walk, 'after the forced reminder');
}

/**
 * @param {string} budget
 * @param {{ locks?: boolean }} options
 * @return {Promise<{ walk: object, tab: WholeTab }>}
 */
async function adopted(budget = '2', options = {}) {
    const walk = world(options);
    const tab = await opened(walk);
    await saveKey(walk, tab);
    await adopt(walk, tab, budget);
    await forceReminder(walk, tab);
    return { walk, tab };
}

/**
 * @param {object} walk
 * @param {WholeTab} tab
 * @param {number} width
 * @return {Promise<WholeTab>}
 */
async function reload(walk, tab, width = WIDE) {
    tab.unload();
    const fresh = install(walk, CHAT, width);
    await fresh.openPage();
    fresh.ready();
    await until(walk, 'the reloaded tab to show its panel', () => fresh.panel.host() !== null, 5000);
    await until(
        walk,
        'the reloaded tab to settle',
        () => /^(?:Up to date|Waiting to read|Unresolved authorship|Stopped)/.test(fresh.panel.headline()),
        15000,
    );
    return fresh;
}

/**
 * @param {object} walk
 * @param {WholeTab} tab
 * @param {string} said
 * @param {ReadonlyArray<[string, string]>} blocks
 * @return {Promise<void>}
 */
async function arrive(walk, tab, said, blocks) {
    await tab.pagePost(said);
    walk.site.reply(
        blocks.map((block) => [...block]),
        tab.room(),
    );
}

/**
 * @param {string} budget
 * @param {{ layout?: string }} options
 * @return {Promise<{ walk: object, tab: WholeTab }>}
 */
async function replied(budget = '2', options = {}) {
    const { walk, tab } = await adopted(budget, options);
    await arrive(walk, tab, ASKED, REPLY);
    await until(
        walk,
        'step 6: the new reply to be checked',
        () => stored(walk, 'live')?.seen?.id === walk.site.messages.at(-1).id && typeof stored(walk, 'live')?.ready === 'string',
        TICK_MS * 2,
    );
    await quiet(walk, 'step 6: after the check');
    return { walk, tab };
}

/**
 * @param {object} walk
 * @param {WholeTab} tab
 * @param {string} text
 * @return {Promise<string>}
 */
async function send(walk, tab, text) {
    const before = tab.sent.length;
    tab.type(text);
    tab.enter();
    await until(walk, 'the page to send the message', () => tab.sent.length > before, 2000);
    await pass(walk, 1000);
    return tab.sent.at(-1);
}

/**
 * @param {object} walk
 * @param {number} after
 * @return {object[]}
 */
function playerReceipts(walk, after) {
    return plain(REFERENCE.ScribeIntake.read(walk.site.messages).messages
        .slice(after)
        .filter((message) => message.fromPlayer)
        .map(({ id, fingerprint }) => ({ id, fingerprint })));
}

test('1. installed on a page that is not a chat', async () => {
    const walk = world();
    let tab = null;
    assert.doesNotThrow(() => {
        tab = install(walk, '/');
    });
    tab.ready();
    await pass(walk, 5000);
    assert.deepEqual(tab.logs, []);
    assert.equal(walk.model.calls.length, 0);
    assert.equal(walk.model.strays.length, 0);
    assert.equal(tab.panel.hosts(), 0);
    assert.equal(walk.site.requests.length, 0);
    assert.equal(tab.document.documentElement.hasAttribute('data-zeta-scribe'), true);
});

test('2. a chat opens', async () => {
    const walk = world();
    const tab = install(walk, '/');
    tab.ready();
    await pass(walk, 1000);
    tab.go(CHAT);
    await tab.openPage();
    await until(walk, 'step 2: a panel on the page', () => tab.panel.host() !== null, 2000);
    const first = tab.panel.headlines()[0];
    assert.equal(first === 'Loading the chat...' || first.startsWith('Reading chat history from Zeta'), true, first);
    await until(walk, 'step 2: the chat to be pulled', () => tab.panel.headline().startsWith('No book for this chat yet'), 15000);
    assert.equal(tab.panel.headline(), 'No book for this chat yet: 91 messages.');
    const reads = walk.site.pageRequests();
    assert.equal(reads.length, 3);
    assert.equal(walk.site.scribeRequests().length, 3);
    for (const read of reads) {
        assert.equal(read.method, 'GET');
        assert.equal(read.authorization, WholeSite.Token);
        assert.equal(new URL(read.url).searchParams.get('limit'), '31');
        assert.equal(new URL(read.url).pathname, '/v1/rooms/harbour/messages');
    }
    assert.deepEqual(
        reads.map((read) => new URL(read.url).searchParams.get('cursor') === null),
        [true, false, false],
    );
    tab.panel.tab('Progress');
    assert.equal(tab.panel.text('scribe-pulled'), 'Last pull: 91 messages, ended NoCursor');
    const names = storedNames(walk);
    assert.equal(names.includes('scribe:head:harbour:campaign'), true);
    assert.deepEqual(
        names.filter((name) => name.startsWith('scribe:') && name.split(':')[2] !== ROOM),
        [],
    );
    assert.deepEqual(
        names.filter((name) => !name.startsWith('scribe:')),
        [BRIDGE],
    );
    assert.equal(stored(walk, 'campaign').messages.length, CHAT_LENGTH);
    assert.equal(walk.model.calls.length, 0);
    assert.deepEqual(tab.logs, []);
});

test('3. the key', async () => {
    const walk = world();
    const tab = await opened(walk);
    await saveKey(walk, tab);
    assert.equal(tab.panel.text('scribe-key-state'), 'A key is saved');
    assert.equal(tab.panel.byId('scribe-key').value, '');
    assert.equal(tab.panel.shownTexts().some((text) => text.includes(KEY)), false);
    assert.equal(tab.panel.everWritten().some((text) => text.includes(KEY)), false);
    assert.equal(tab.logs.some((line) => line.includes(KEY)), false);
    assert.deepEqual(
        [...walk.storage.values.entries()].filter(([, value]) => String(value).includes(KEY)).map(([name]) => name),
        ['scribe:key'],
    );
    assert.equal(walk.model.calls.length, 0);
});

test('4. adopt', async () => {
    const walk = world();
    const tab = await opened(walk);
    await saveKey(walk, tab);
    tab.panel.tab('Summary');
    tab.panel.type('scribe-setting-size', '30');
    tab.panel.type('scribe-setting-budget', '0');
    tab.panel.click('scribe-next');
    await pass(walk, 2000);
    assert.equal(tab.panel.text('scribe-setting-budget-problem'), 'The budget must be a number of dollars, more than 0.');
    assert.equal(tab.panel.text('scribe-next-outcome'), 'A field on the Settings tab needs attention.');
    assert.equal(tab.panel.byId('scribe-section-settings').hidden, false);
    assert.equal(walk.model.calls.length, 0);
    assert.equal(stored(walk, 'book'), null);
    await adopt(walk, tab, '1.2');
    assert.deepEqual(
        walk.model.calls.filter((call) => call.role === 'Story').map((call) => rangeOf(call.user)),
        ['1-30', '31-60', '61-90', '91-91'],
    );
    for (const call of walk.model.calls) {
        assert.equal(call.url, WholeModel.Endpoint);
        assert.equal(call.authorization, `Bearer ${KEY}`);
    }
    for (const call of walk.model.of('Story')) {
        assert.equal(call.model, 'mistralai/mistral-large-4-0');
    }
    assert.deepEqual(walk.model.strays, []);
    const seen = tab.panel.headlines();
    assert.equal(seen.some((line) => line.startsWith('Reading #1 to #30')), true, seen.join(' / '));
    assert.equal(tab.panel.headline(), 'Up to date: 91 of 91 read.');
    const book = stored(walk, 'book');
    assert.equal(book.adopted, true);
    assert.equal(Object.keys(book.log.read).length, 91);
    assert.equal(Object.hasOwn(book.log.read, `MESSAGE-${CHAT_LENGTH}`), true);
    assert.equal(tab.panel.spend(), `$${billed(walk).toFixed(4)} today`);
    assert.equal(Math.abs(spentToday(walk) - billed(walk)) < 1e-9, true);
    tab.panel.tab('Summary');
    const cast = tab.panel.rows('cast').map((row) => row.children[0].textContent).sort();
    assert.deepEqual(cast, [
        'Halvard (character)',
        'Mirelle (character)',
        'Oswin (character)',
        'Tamsin (character)',
        'The harbour market (place)',
    ]);
});

for (const change of ['quiet room', 'new reply', 'edit ahead of the current batch', 'edit between scheduled polls']) {
    test(`the installed reader drains 400 of 441 on its own with ${change}`, async () => {
        const walk = world();
        walk.site.open(ROOM, campaign(400));
        let tab = await opened(walk);
        await saveKey(walk, tab);
        tab.panel.tab('Settings');
        tab.panel.type('scribe-setting-size', '40');
        tab.panel.type('scribe-setting-budget', '8');
        tab.panel.click('scribe-next');
        await until(walk, 'the initial saved book', () => tab.panel.headline() === 'Up to date: 400 of 400 read.', 4 * TICK_MS);
        const published = [];
        const previous = plain(stored(walk, 'book').log.read);
        walk.site.open(ROOM, campaign(441));
        walk.model.watch = (call) => {
            if (call.role === 'Story') {
                const batch = rangeOf(call.user);
                published.push([batch, Object.keys(stored(walk, 'book').log.read).length]);
                if (change === 'new reply' && batch === '401-440') {
                    walk.site.reply(CALM_REPLY);
                }
            }
        };
        const held = change.startsWith('edit ') ? holdCompletion(walk,
            (role, input) => role === 'Story' && rangeOf(input) === '401-440') : null;
        tab = await reload(walk, tab);
        assert.equal(tab.panel.headline(), 'Waiting to read: 400 of 441 read.');
        if (held) {
            await until(walk, 'the full batch in flight', () => held.release !== null, 2 * TICK_MS);
            walk.site.edit(441, 'The lamp is now dark.');
            await pass(walk, change === 'edit between scheduled polls' ? 100 : TICK_MS + 100);
            assert.deepEqual(published, [['401-440', 400]]);
            held.release();
        }
        const total = change === 'new reply' ? 442 : 441;
        const complete = `Up to date: ${total} of ${total} read.`;
        await until(walk, 'the automatic polls to save every available row', () => tab.panel.headline() === complete, 4 * TICK_MS);
        const batches = [['401-440', 400], [`441-${total}`, 440]];
        await pass(walk, 2 * TICK_MS);
        assert.deepEqual(published, batches);
        const saved = stored(walk, 'book');
        if (held) {
            const tail = walk.model.of('Story').filter((call) => rangeOf(call.user) === '441-441');
            assert.equal(tail.length, 1);
            assert.ok(tail[0].user.includes('The lamp is now dark.'));
            const latest = REFERENCE.ScribeIntake.read(walk.site.messages).messages.at(-1);
            assert.equal(saved.fingerprints[latest.id], latest.fingerprint);
        }
        for (const [id, sequence] of Object.entries(previous)) {
            assert.equal(saved.log.read[id], sequence);
        }
        const reopened = await reload(walk, tab);
        assert.equal(reopened.panel.headline(), complete);
        assert.deepEqual(plain(stored(walk, 'book')), plain(saved));
        assert.deepEqual(published, batches);
    });
}

const OLD_LEDGER = 'Mirelle keeps the harbour ledger.';
const NEW_LEDGER = 'Mirelle keeps the clocktower logs.';
const KEY_NOTE = 'Oswin holds the spare key.';
const NARRATIVE = 'I shut the cover.';
const noteBlock = (text) => `*(\n${text}\n)*`;

for (const { name, size, original, edit, extra, notes, story } of [
    { name: 'an edited note-only #441', size: 40, original: noteBlock(OLD_LEDGER), edit: noteBlock(NEW_LEDGER), notes: [NEW_LEDGER] },
    { name: 'an empty row edited into a note', original: noteBlock(''), edit: noteBlock(NEW_LEDGER), notes: [NEW_LEDGER] },
    { name: 'a note edited into narrative', original: noteBlock(OLD_LEDGER), edit: NARRATIVE, notes: [], story: true },
    { name: 'a deleted note', original: noteBlock(OLD_LEDGER), edit: null, notes: [] },
    { name: 'notes and narrative in the same stretch', original: noteBlock(OLD_LEDGER), edit: noteBlock(NEW_LEDGER),
        extra: NARRATIVE + '\n' + noteBlock(KEY_NOTE), notes: [NEW_LEDGER, KEY_NOTE], story: true },
]) {
    test(`the installed reader verifies ${name} before paying at the next boundary`, async () => {
        const batch = size ?? 2;
        const prefix = size ? 400 : 2;
        const boundary = prefix + batch;
        const walk = world();
        walk.site.open(ROOM, campaign(prefix));
        let tab = await opened(walk);
        await saveKey(walk, tab);
        tab.panel.tab('Settings');
        tab.panel.type('scribe-setting-size', String(batch));
        tab.panel.type('scribe-setting-budget', '8');
        tab.panel.click('scribe-next');
        await until(walk, 'the saved prefix', () => tab.panel.headline() === `Up to date: ${prefix} of ${prefix} read.`, 4 * TICK_MS);
        await quiet(walk, 'the saved prefix');
        const firstCall = walk.model.calls.length;
        const initialSpend = spentToday(walk);
        const room = campaign(boundary).player(original);
        if (extra) {
            room.player(extra);
        }
        walk.site.open(ROOM, room);
        const firstRange = `${prefix + 1}-${boundary}`;
        const savedAtNotes = [];
        walk.model.watch = (call) => {
            if (call.role === 'Notes') {
                savedAtNotes.push(Object.keys(stored(walk, 'book').log.read).length);
            }
        };
        const held = holdCompletion(walk, (role, input) => role === 'Story' && rangeOf(input) === firstRange);
        tab = await reload(walk, tab);
        await until(walk, 'the first Story stretch in flight', () => held.release !== null, 2 * TICK_MS);
        if (edit === null) {
            walk.site.open(ROOM, campaign(boundary));
        } else {
            walk.site.edit(boundary + 1, edit);
        }
        await pass(walk, 100);
        assert.equal(asked(walk, 'Notes', firstCall), 0);
        assert.equal(Object.keys(stored(walk, 'book').log.read).length, prefix);
        held.release();
        const total = walk.site.messages.length;
        const complete = `Up to date: ${total} of ${total} read.`;
        await pass(walk, 4 * TICK_MS);
        assert.equal(tab.panel.headline(), complete);
        const saved = plain(stored(walk, 'book'));
        assert.deepEqual(saved.log.notes, notes);
        assert.equal(Object.keys(saved.log.read).length, total);
        for (const row of REFERENCE.ScribeIntake.read(walk.site.messages).messages) {
            assert.equal(saved.fingerprints[row.id], row.fingerprint);
        }
        tab = await reload(walk, tab);
        await pass(walk, 2 * TICK_MS);
        assert.equal(tab.panel.headline(), complete);
        assert.deepEqual(plain(stored(walk, 'book')), saved);
        const calls = walk.model.calls.slice(firstCall);
        const storyCalls = calls.filter((call) => call.role === 'Story');
        const noteCalls = calls.filter((call) => call.role === 'Notes');
        assert.deepEqual(storyCalls.map((call) => rangeOf(call.user)), story ? [firstRange, `${boundary + 1}-${total}`] : [firstRange]);
        if (story) {
            assert.ok(storyCalls.at(-1).user.includes(NARRATIVE));
        }
        assert.equal(noteCalls.length, notes.length ? 1 : 0);
        assert.deepEqual(savedAtNotes, notes.length ? [boundary] : []);
        for (const [index, note] of notes.entries()) {
            assert.ok(noteCalls[0].user.includes(`[#${boundary + index + 1}] ${note}`));
        }
        assert.ok([...storyCalls, ...noteCalls].every((call) => !call.user.includes(OLD_LEDGER)));
        const otherCharges = calls.filter((call) => call.role !== 'Notes').reduce((sum, call) => sum + (walk.model.costs[call.role] ?? 0), 0);
        const noteSpend = spentToday(walk) - initialSpend - otherCharges;
        assert.ok(Math.abs(noteSpend - (notes.length ? COSTS.Notes : 0)) < 1e-9);
    });
}

test('an authoritative empty room withdraws the last saved passage and its facts across reload', async () => {
    const walk = world();
    walk.site.open(ROOM, campaign(1));
    let tab = await opened(walk);
    await saveKey(walk, tab);
    await adopt(walk, tab, '2');
    const was = stored(walk, 'book');
    assert.ok(Object.hasOwn(was.log.read, 'MESSAGE-1'));
    assert.ok(bookState(walk).facts.some((fact) => fact.cite === 'MESSAGE-1'));
    const ruling = REFERENCE.ScribeLog.rule(was.log, bookState(walk), {
        type: 'Pin', subject: bookState(walk).subjects.find((subject) => subject.label === 'Mirelle').id,
        category: 'age', target: null, text: 'forty', hidden: false,
    });
    REFERENCE.ScribeStore.write(walk.storage, ROOM, 'book', was);
    tab = await reload(walk, tab);
    walk.site.open(ROOM, campaign(0));
    walk.site.rooms.get(ROOM).zeta.endless = true;
    await pass(walk, 2 * TICK_MS);
    assert.deepEqual(plain(stored(walk, 'book')), plain(was));
    walk.site.rooms.get(ROOM).zeta.endless = false;
    await pass(walk, 3 * TICK_MS);
    assert.equal(tab.panel.headline(), 'Up to date: 0 of 0 read.');
    tab = await reload(walk, tab);
    assert.equal(tab.panel.headline(), 'Up to date: 0 of 0 read.');
    const saved = stored(walk, 'book');
    assert.deepEqual(plain(saved.log.read), {});
    assert.deepEqual(plain(saved.fingerprints), {});
    assert.ok(!bookState(walk).facts.some((fact) => fact.cite === 'MESSAGE-1'));
    assert.deepEqual(plain(saved.log.entries.find((entry) => entry.sequence === ruling.sequence)), plain(ruling));
    assert.ok(saved.log.entries.find((entry) => entry.messageIds?.includes('MESSAGE-1')).withdrawn);
});

test('4. while the book is first read, only the Analyzer is asked; then the newest reply is checked once', async () => {
    const walk = world();
    const tab = await opened(walk);
    await saveKey(walk, tab);
    const seen = [];
    walk.model.watch = (call) => {
        seen.push({ role: call.role, ready: stored(walk, 'live')?.ready ?? null, headline: tab.panel.headline() });
    };
    await adopt(walk, tab, '2');
    walk.model.watch = null;
    const last = seen.findLastIndex((entry) => entry.role === 'Story');
    const reading = seen.slice(0, last + 1);
    assert.deepEqual(
        reading.map((entry) => entry.role),
        ['Story', 'Story', 'Story', 'Story'],
    );
    assert.equal(reading.every((entry) => entry.ready === null), true);
    assert.equal(reading.some((entry) => entry.headline.startsWith('Up to date')), false);
    const after = seen.slice(last + 1).map((entry) => entry.role);
    assert.equal(after.filter((role) => role === 'Scene').length, 1);
    assert.equal(after.filter((role) => role === 'Pedant').length, 1);
    assert.deepEqual(
        after.filter((role) => !['Scene', 'Pedant'].includes(role)),
        [],
    );
    assert.equal(seen[last + 1].ready, null);
    assert.equal(stored(walk, 'live').ready, null);
    assert.deepEqual(queued(tab), []);
    assert.equal(tab.panel.byId('scribe-reminder').value, '');
    assert.equal(tab.panel.byId('scribe-force').disabled, false);
    const asked = walk.model.calls.length;
    await forceReminder(walk, tab);
    const ready = stored(walk, 'live').ready;
    assert.equal(ready, FIRST_READY);
    assert.deepEqual(rolesSince(walk, asked), ['Told']);
    assert.deepEqual(queued(tab), [`Reminder: ${ready}`]);
    assert.equal(tab.panel.byId('scribe-reminder').value, ready);
    assert.deepEqual(tab.panel.rowTexts('queued'), []);
});

test('4. the first message after adopting carries a reminder built from the book just read', async () => {
    const { walk, tab } = await adopted('2');
    const ready = stored(walk, 'live').ready;
    const went = await send(walk, tab, 'I look around.');
    assert.equal(went, `I look around.\n@: ${ready}`);
    assert.equal(went, `I look around.\n@: ${FIRST_READY}`);
});

test('4. without the press nothing goes before the count, and at the count the next reply makes one', async () => {
    const walk = world();
    const tab = await opened(walk);
    await saveKey(walk, tab);
    tab.panel.tab('Settings');
    tab.panel.type('scribe-setting-refresh', '2');
    await adopt(walk, tab, '2');
    assert.equal(stored(walk, 'live').ready, null);
    assert.equal(stored(walk, 'live').sends, 0);
    assert.equal(await send(walk, tab, 'I look around.'), 'I look around.');
    assert.equal(await send(walk, tab, 'I wait.'), 'I wait.');
    assert.equal(stored(walk, 'live').sends, 2);
    await arrive(walk, tab, ASKED, REPLY);
    await until(
        walk,
        'the reply after the count to be checked',
        () =>
            stored(walk, 'live')?.seen?.id === walk.site.messages.at(-1).id &&
            typeof stored(walk, 'live')?.ready === 'string',
        TICK_MS * 2,
    );
    await quiet(walk, 'after the reply at the count');
    const ready = stored(walk, 'live').ready;
    assert.equal(ready.startsWith('[Scribe] '), true, ready);
    assert.deepEqual(queued(tab), [`Reminder: ${ready}`]);
    assert.equal(await send(walk, tab, 'I nod.'), `I nod.\n@: ${ready}`);
    assert.equal(stored(walk, 'live').ready, null);
    assert.equal(stored(walk, 'live').sends, 0);
    assert.equal(await send(walk, tab, 'I wait again.'), 'I wait again.');
});

for (const layout of ['top', 'frame']) {
    test(`a due ${layout} reminder waits for the saved reply and uses its new evidence`, async () => {
        const walk = world({ layout });
        let tab = await opened(walk);
        await saveKey(walk, tab);
        tab.panel.tab('Settings');
        tab.panel.type('scribe-setting-refresh', '2');
        await adopt(walk, tab, '8');
        await send(walk, tab, 'I look around.');
        await send(walk, tab, 'I wait.');
        await pass(walk, 2 * TICK_MS);
        const clue = 'the lantern has gone dark';
        const reply = 'The lantern keeper needs a new flame.';
        const previous = walk.model.answers.Story;
        walk.model.answers.Story = (input) => input.includes(reply)
            ? '=== THREADS\nOPEN | ' + clue + ' | #95' : previous(input);
        walk.model.answers.Told = (input) => input.includes(clue) ? 'The lantern has gone dark.' : 'The lantern is burning.';
        const held = holdCompletion(walk, (role, input) => role === 'Story' && input.includes(reply));
        const first = walk.model.calls.length;
        await arrive(walk, tab, ASKED, [['Narrator', reply]]);
        await until(walk, 'the reader to hold the new evidence', () => held.release !== null, 2 * TICK_MS);
        await pass(walk, TICK_MS);
        assert.equal(asked(walk, 'Told', first), 0);
        assert.equal(Object.keys(stored(walk, 'book').log.read).length, 93);
        assert.equal(stored(walk, 'live').ready, null);
        assert.equal(await send(walk, tab, 'I listen.'), 'I listen.');
        assert.ok(stored(walk, 'live').sends >= 2);
        if (layout === 'frame') {
            tab = await reload(walk, tab);
        }
        held.release();
        await until(walk, 'the due reminder with the saved evidence', () =>
            stored(walk, 'live').ready?.includes('The lantern has gone dark.') === true, 4 * TICK_MS);
        const recaps = walk.model.calls.slice(first).filter((call) => call.role === 'Told');
        assert.equal(recaps.length, 1);
        assert.ok(recaps[0].user.includes(clue));
        const ready = stored(walk, 'live').ready;
        assert.equal(await send(walk, tab, 'I bring a match.'), 'I bring a match.\n@: ' + ready);
        assert.equal(stored(walk, 'live').sends, 0);
    });
}

test('5. a reload keeps everything', async () => {
    const { walk, tab } = await adopted('2');
    tab.panel.tab('Summary');
    const before = {
        headline: tab.panel.headline(),
        badge: tab.panel.text('scribe-badge'),
        needs: tab.panel.text('scribe-needs'),
        cast: tab.panel.rows('cast').length,
        threads: tab.panel.rows('threads').length,
        days: tab.panel.rows('days').length,
    };
    const calls = walk.model.calls.length;
    const fresh = await reload(walk, tab);
    await pass(walk, TICK_MS * 2);
    fresh.panel.tab('Summary');
    assert.equal(walk.model.calls.length, calls);
    assert.equal(fresh.panel.headline(), 'Up to date: 91 of 91 read.');
    assert.deepEqual(
        {
            headline: fresh.panel.headline(),
            badge: fresh.panel.text('scribe-badge'),
            needs: fresh.panel.text('scribe-needs'),
            cast: fresh.panel.rows('cast').length,
            threads: fresh.panel.rows('threads').length,
            days: fresh.panel.rows('days').length,
        },
        before,
    );
});

test('6. a new reply arrives', async () => {
    const { walk, tab } = await adopted('2');
    const from = walk.model.calls.length;
    const reads = walk.site.pageRequests().length;
    await arrive(walk, tab, ASKED, REPLY);
    await until(
        walk,
        'step 6: the new reply to be checked',
        () => stored(walk, 'live')?.seen?.id === walk.site.messages.at(-1).id && typeof stored(walk, 'live')?.ready === 'string',
        TICK_MS * 2,
    );
    await quiet(walk, 'step 6: after the check');
    const pulled = walk.site.pageRequests().slice(reads);
    assert.equal(pulled.length > 0, true);
    assert.equal(new URL(pulled[0].url).searchParams.get('cursor'), null);
    assert.equal(asked(walk, 'Scene', from), 1);
    assert.equal(asked(walk, 'Pedant', from), 1);
    assert.equal(asked(walk, 'Story', from), 1);
    const pedant = walk.model.calls.slice(from).find((call) => call.role === 'Pedant');
    assert.equal(pedant.user.includes('REPLY (#93):'), true);
    const profiled = `PLAYER CHARACTER PROFILE:\n${WholeSite.Profile}`;
    for (const role of ['Story', 'Scene', 'Pedant']) {
        const calls = walk.model.calls.filter((call) => call.role === role);
        assert.equal(calls.length > 0, true, role);
        assert.equal(calls.every((call) => call.user.includes(profiled)), true, role);
    }
    const story = walk.site
        .scribeRequests()
        .filter((request) => !WholeSite.paged(request.url))
        .map((request) => new URL(request.url).pathname)
        .sort();
    assert.deepEqual(story, ['/v1/plots/plot-harbour/rooms/harbour/user-personas/selected', '/v1/rooms/harbour']);
    tab.panel.tab('Progress');
    assert.equal(tab.panel.byId('scribe-story').hidden, true);
    tab.panel.tab('Findings');
    const ready = stored(walk, 'live').ready;
    const rows = queued(tab);
    assert.equal(rows.length, 1);
    assert.equal(rows[0], `Reminder: ${ready}`);
    assert.equal(ready.startsWith('[Scribe] '), true);
    assert.equal(ready, `${HAIR} ${LOOKS_LEFT} ${PARTY}`);
    const findings = findingRows(tab);
    assert.equal(findings.length, 1);
    const texts = tab.panel.walk(findings[0]).map((element) => element.ownText);
    assert.equal(texts.includes('The reply contradicts the book'), true);
    assert.equal(texts.includes(GOES_FIRST), true);
    assert.deepEqual(tab.panel.buttonTexts(findings[0]), ['Dismiss', 'Rule it...']);
});

test('6. a story character is told only what the chat added, and an unreadable story says so once', async () => {
    const told = world();
    told.site.rooms.get(ROOM).zeta.characters = [
        { name: 'Mirelle', description: 'A money-changer with brown eyes and black hair worn in a braid.' },
    ];
    const tab = await opened(told);
    await saveKey(told, tab);
    await adopt(told, tab, '2');
    await forceReminder(told, tab);
    assert.equal(
        stored(told, 'live').ready,
        `${LEAD} Mirelle: short and broad-shouldered, a scar across her left palm. ${PARTY}`,
    );
    tab.panel.tab('Progress');
    assert.equal(tab.panel.byId('scribe-story').hidden, true);

    const unread = world();
    const zeta = unread.site.rooms.get(ROOM).zeta;
    zeta.characters = told.site.rooms.get(ROOM).zeta.characters;
    zeta.plot = null;
    zeta.profile = null;
    const lost = await opened(unread);
    await saveKey(unread, lost);
    await adopt(unread, lost, '2');
    await forceReminder(unread, lost);
    assert.equal(stored(unread, 'live').ready, FIRST_READY);
    await arrive(unread, lost, ASKED, REPLY);
    await until(
        unread,
        'the reply after an unreadable story to be checked',
        () => stored(unread, 'live')?.seen?.id === unread.site.messages.at(-1).id,
        TICK_MS * 2,
    );
    await quiet(unread, 'after the reply with an unreadable story');
    lost.panel.tab('Progress');
    assert.equal(lost.panel.byId('scribe-story').hidden, false);
    assert.equal(
        lost.panel.text('scribe-story'),
        "The story's characters could not be read, so every character counts as custom: Zeta answered HTTP 404",
    );
    const story = unread.site.scribeRequests().filter((request) => !WholeSite.paged(request.url));
    assert.deepEqual(
        story.map((request) => new URL(request.url).pathname).sort(),
        ['/v1/rooms/harbour'],
    );
    assert.equal(unread.model.calls.some((call) => call.user.includes('PLAYER CHARACTER PROFILE:')), false);
});

test('7. sending', async () => {
    const { walk, tab } = await replied('2');
    const ready = stored(walk, 'live').ready;
    const posts = walk.site.requests.filter((request) => request.method === 'POST').length;
    tab.type('I nod.');
    const pressed = tab.enter();
    const at = walk.clock.now();
    assert.equal(pressed.defaultPrevented, true);
    assert.equal(tab.keys.length, 0);
    await pass(walk, 0);
    assert.equal(tab.box.value, `I nod.\n@: ${ready}`);
    await pass(walk, 24);
    assert.equal(tab.keys.length, 0);
    await pass(walk, 1);
    assert.deepEqual(
        tab.keys.map((key) => [key.key, key.at - at]),
        [['Enter', 25]],
    );
    await pass(walk, 2000);
    assert.equal(tab.keys.length, 1);
    assert.equal(tab.sent.length, 1);
    const went = tab.sent[0];
    assert.equal(went.startsWith('I nod.\n@: [Scribe] '), true);
    assert.equal(went, `I nod.\n@: ${ready}`);
    assert.equal(Buffer.byteLength(went, 'utf8') < 4500, true);
    assert.equal(tab.box.value, '');
    assert.equal(stored(walk, 'live').ready, null);
    assert.deepEqual(queued(tab), []);
    const findings = findingRows(tab);
    assert.equal(findings.length, 1);
    assert.equal(tab.panel.walk(findings[0]).some((element) => element.ownText === WENT_OUT), true);
    const allPosts = walk.site.requests.filter((request) => request.method === 'POST');
    assert.equal(allPosts.length, posts + 1);
    assert.equal(allPosts.every((request) => request.own), true);
});

test('7. an Enter the page refuses, then typing on', async () => {
    const { walk, tab } = await replied('2');
    const ready = stored(walk, 'live').ready;
    tab.refusing = true;
    tab.type('I wait.');
    tab.enter();
    await pass(walk, 30);
    assert.equal(tab.refused, 1);
    assert.equal(tab.box.value, `I wait.\n@: ${ready}`);
    await pass(walk, 200);
    tab.keyDown('a');
    assert.equal(tab.box.value, 'I wait.');
    tab.land('a');
    assert.equal(tab.box.value, 'I wait.a');
    await pass(walk, 3000);
    assert.equal(tab.box.value, 'I wait.a');
    assert.equal(tab.sent.length, 0);
    assert.equal(stored(walk, 'live').ready, ready);
    assert.deepEqual(plain(stored(walk, 'live').findings.map((finding) => finding.status)), ['Open']);
});

test('8. a regenerated reply', async () => {
    const { walk, tab } = await replied('2');
    const original = walk.site.messages[92];
    assert.equal(original.id, 'MESSAGE-93');
    const from = walk.model.calls.length;
    walk.site.put(93, {
        ...original,
        id: 'MESSAGE-93-B',
        contents: CALM_REPLY.map(([speaker, text]) => ({ type: 'TEXT', speakerName: speaker, position: 'NARRATOR', text })),
    });
    await tab.pageRegenerate('MESSAGE-93');
    await until(walk, 'step 8: the new reply to be checked', () => stored(walk, 'live').seen.id === 'MESSAGE-93-B', 20000);
    await pass(walk, TICK_MS);
    assert.equal(asked(walk, 'Story', from), 1);
    assert.equal(asked(walk, 'Scene', from), 1);
    assert.equal(asked(walk, 'Pedant', from), 1);
    assert.equal(
        walk.model.calls.slice(from).find((call) => call.role === 'Pedant').user.includes('opens the red ledger without a word'),
        true,
    );
    assert.deepEqual(findingRows(tab), []);
    assert.equal(stored(walk, 'live').findings.length, 0);
});

test('8. switching back rereads the changed stretch and checks the restored version once', async () => {
    const { walk, tab } = await replied('2');
    const original = walk.site.messages[92];
    walk.site.put(93, {
        ...original,
        id: 'MESSAGE-93-B',
        contents: CALM_REPLY.map(([speaker, text]) => ({ type: 'TEXT', speakerName: speaker, position: 'NARRATOR', text })),
    });
    await tab.pageRegenerate('MESSAGE-93');
    await until(walk, 'step 8: the new reply to be checked', () => stored(walk, 'live').seen.id === 'MESSAGE-93-B', 20000);
    await pass(walk, TICK_MS);
    const back = walk.model.calls.length;
    walk.site.put(93, original);
    await tab.pageRegenerate('MESSAGE-93-B');
    await until(walk, 'step 8: the first version to be back', () => stored(walk, 'live').seen.id === 'MESSAGE-93', 20000);
    await pass(walk, TICK_MS);
    assert.equal(asked(walk, 'Scene', back), 1);
    assert.equal(asked(walk, 'Pedant', back), 1);
    assert.equal(findingRows(tab).length, 1);
    assert.deepEqual(rolesSince(walk, back).sort(), ['Pedant', 'Scene', 'Story']);
});

test('10. a ruling', async () => {
    const { walk, tab } = await adopted('2');
    tab.panel.tab('Summary');
    assert.equal(tab.panel.text('scribe-needs'), '1 conflict');
    tab.panel.tab('Rulings');
    const rows = tab.panel.rows('conflicts');
    assert.equal(rows.length, 1);
    const value = tab.panel.buttonStarting(rows[0], 'grey');
    const from = walk.model.calls.length;
    value.click();
    await until(walk, 'step 10: the ruling to be saved', () => tab.panel.rows('made').length === 1, 5000);
    await quiet(walk, 'step 10: after the ruling');
    const roles = rolesSince(walk, from);
    assert.deepEqual(roles, []);
    tab.panel.tab('Rulings');
    assert.equal(tab.panel.rows('conflicts').length, 0);
    assert.equal(tab.panel.rowTexts('made')[0].includes('Pin'), true);
    tab.panel.tab('Summary');
    assert.equal(tab.panel.text('scribe-needs'), 'Nothing needs a ruling.');
    const fresh = await reload(walk, tab);
    fresh.panel.tab('Rulings');
    assert.equal(fresh.panel.rows('made').length, 1);
    assert.equal(fresh.panel.rows('conflicts').length, 0);
});

test('9. an edited old message', async () => {
    const { walk, tab } = await adopted('2');
    tab.panel.tab('Rulings');
    tab.panel.buttonStarting(tab.panel.rows('conflicts')[0], 'grey').click();
    await until(walk, 'step 9: the ruling to be saved first', () => tab.panel.rows('made').length === 1, 5000);
    const from = walk.model.calls.length;
    walk.site.edit(5, 'I am Oswin, harbourmaster of this port. Keep the peace, guard.');
    await pass(walk, TICK_MS * 2);
    assert.equal(asked(walk, 'Story', from), 0);
    tab.panel.tab('Progress');
    tab.panel.click('scribe-pull');
    await until(walk, 'step 9: the stretch to be read again', () => asked(walk, 'Story', from) >= 1, TICK_MS * 3);
    await until(walk, 'step 9: the reading to finish', () => tab.panel.headline().startsWith('Up to date'), TICK_MS * 2);
    await pass(walk, TICK_MS * 3);
    assert.deepEqual(
        walk.model.calls.slice(from).filter((call) => call.role === 'Story').map((call) => rangeOf(call.user)),
        ['1-30'],
    );
    const roles = rolesSince(walk, from);
    assert.deepEqual(
        roles.filter((role) => role !== 'Story' && role !== 'Told'),
        [],
    );
    assert.equal(tab.panel.headline(), 'Up to date: 91 of 91 read.');
    tab.panel.tab('Rulings');
    assert.equal(tab.panel.rows('made').length, 1);
    const book = stored(walk, 'book');
    assert.equal(book.log.entries.filter((entry) => entry.kind === 'Operator' && !entry.withdrawn).length, 1);
});

test('11. telling the scribe', async () => {
    const { walk, tab } = await adopted('2');
    const from = walk.model.calls.length;
    const posts = walk.site.requests.filter((request) => request.method !== 'GET').length;
    tab.panel.tab('Rulings');
    tab.panel.type('scribe-tell', 'Mirelle keeps a brass compass from her father.');
    tab.panel.click('scribe-tell-work');
    await until(walk, 'step 11: the words to be worked out', () => tab.panel.text('scribe-understood').startsWith('The scribe understood:'), 5000);
    assert.deepEqual(rolesSince(walk, from), ['Notes']);
    assert.equal(walk.model.calls[from].user.includes('[#91] Mirelle keeps a brass compass from her father.'), true);
    const understood = tab.panel.byId('scribe-understood');
    const lines = tab.panel.walk(understood).filter((element) => element.tagName === 'LI').map((element) => element.textContent);
    assert.deepEqual(lines, [`Not hidden, new: "Mirelle", belonging: "${COMPASS}"`]);
    tab.panel.button(understood, 'File it').click();
    const again = tab.panel.buttonsIn(tab.panel.byId('scribe-understood')).filter((button) => button.textContent === 'File it');
    assert.equal(again.length, 1);
    again[0].click();
    await until(walk, 'step 11: the words to be filed', () => tab.panel.text('scribe-understood') === '', 5000);
    await pass(walk, 2000);
    const book = stored(walk, 'book');
    assert.equal(book.log.entries.filter((entry) => entry.origin === 'Notes' && !entry.withdrawn).length, 1);
    const facts = bookState(walk).facts.filter((fact) => fact.text === COMPASS);
    assert.equal(facts.length, 1);
    assert.equal(facts[0].status, 'InForce');
    assert.equal(facts[0].hidden, false);
    assert.equal(walk.site.requests.filter((request) => request.method !== 'GET').length, posts);
    const roles = rolesSince(walk, from);
    assert.equal(roles.filter((role) => role === 'Notes').length, 1);
    assert.deepEqual(
        roles.filter((role) => role !== 'Notes'),
        [],
    );
});

test('12. a suggestion not chosen does not go out', async () => {
    const { walk, tab } = await replied('2');
    const from = walk.model.calls.length;
    tab.panel.tab('Findings');
    tab.panel.button(tab.panel.byId('scribe-offer-actions'), 'Suggest one').click();
    await until(walk, 'step 12: an offer', () => tab.panel.text('scribe-offer-text') === RIDER, 5000);
    assert.deepEqual(rolesSince(walk, from), ['Suggest']);
    assert.deepEqual(tab.panel.buttonTexts(tab.panel.byId('scribe-offer-actions')), ['Ignore', 'Another', 'Use']);
    assert.equal(queued(tab).some((row) => row.includes(RIDER)), false);
    const went = await send(walk, tab, 'I listen.');
    assert.equal(went.includes(RIDER), false);
});

test('12. a chosen suggestion goes out once, after the reminder', async () => {
    const { walk, tab } = await replied('2');
    const ready = stored(walk, 'live').ready;
    tab.panel.tab('Findings');
    tab.panel.button(tab.panel.byId('scribe-offer-actions'), 'Suggest one').click();
    await until(walk, 'step 12: an offer', () => tab.panel.text('scribe-offer-text') === RIDER, 5000);
    tab.panel.button(tab.panel.byId('scribe-offer-actions'), 'Use').click();
    await settle();
    assert.deepEqual(queued(tab), [`Reminder: ${ready}`, `Suggestion: ${RIDER}`]);
    const first = await send(walk, tab, 'I listen.');
    assert.equal(first, `I listen.\n@: ${ready}\n@: ${RIDER}`);
    const second = await send(walk, tab, 'I wait for the rider.');
    assert.equal(second.includes(RIDER), false);
});

test('12. an answer without the mark offers nothing', async () => {
    const { walk, tab } = await replied('2');
    walk.model.answers.Suggest = () => RIDER;
    const from = walk.model.calls.length;
    tab.panel.tab('Findings');
    tab.panel.button(tab.panel.byId('scribe-offer-actions'), 'Suggest one').click();
    await until(walk, 'step 12: the answer to be weighed', () => asked(walk, 'Suggest', from) === 1, 5000);
    await pass(walk, 500);
    assert.equal(tab.panel.text('scribe-offer-text'), '');
    assert.equal(tab.panel.byId('scribe-offer-text').hidden, true);
    assert.equal(tab.panel.text('scribe-offer-outcome'), 'Nothing fits this scene right now.');
    assert.deepEqual(tab.panel.buttonTexts(tab.panel.byId('scribe-offer-actions')), ['Suggest one']);
});

/**
 * @return {Promise<{ walk: object, tab: WholeTab, from: number, before: number }>}
 */
async function exhausted() {
    const { walk, tab } = await replied('1.95');
    const before = spentToday(walk);
    walk.model.answers.Pedant = () => '';
    walk.model.costs.Pedant = 0.15;
    const from = walk.model.calls.length;
    await arrive(walk, tab, 'I ask Mirelle about the red ledger.', [['Narrator', 'Mirelle taps the red ledger and smiles.']]);
    await until(walk, 'step 13: three attempts at the pedant', () => asked(walk, 'Pedant', from) === 3, 30000);
    await pass(walk, TICK_MS * 2);
    return { walk, tab, from, before };
}

test('saved scene and check auth failures reopen as one warning with private detail masked in Progress', async () => {
    const { walk, tab } = await adopted('5');
    const live = stored(walk, 'live');
    const reason = 'unexpected HTTP status; status 401; finish none; reason: user not found ' + KEY;
    live.failing = { scene: reason, check: reason };
    REFERENCE.ScribeStore.write(walk.storage, ROOM, 'live', live);
    const openedAgain = await reload(walk, tab);
    assert.equal(openedAgain.panel.text('scribe-problems'), 'OpenRouter rejected the saved API key. Scene updates and story checks could not run. Open Settings, enter your current OpenRouter key, and press Save key.');
    openedAgain.panel.tab('Progress');
    const detail = openedAgain.panel.text('scribe-problem-details');
    assert.match(detail, /user not found \[key\]/);
    assert.ok(!detail.includes(KEY));
    assert.doesNotMatch(openedAgain.panel.headline(), /status 401/);
    assert.doesNotMatch(openedAgain.panel.text('scribe-list-liveCalls'), /user not found/);
});

test('13. every billed attempt of a failed answer is counted', async () => {
    const { walk, from, before } = await exhausted();
    assert.equal(asked(walk, 'Pedant', from), 3);
    const expected = before + asked(walk, 'Story', from) * COSTS.Story + asked(walk, 'Scene', from) * COSTS.Scene + 3 * 0.15;
    assert.equal(Math.abs(spentToday(walk) - expected) < 1e-9, true, `${before} -> ${spentToday(walk)}`);
    assert.equal(spentToday(walk) >= 1.95, true);
});

test('13. the header shows what was spent', async () => {
    const { walk, tab } = await exhausted();
    assert.equal(tab.panel.spend(), `$${spentToday(walk).toFixed(4)} today`);
});

test("13. the panel distinguishes Scribe's local budget from a provider limit", async () => {
    const { tab } = await exhausted();
    assert.match(tab.panel.text('scribe-problems'), /local daily budget/);
    assert.doesNotMatch(tab.panel.text('scribe-problems'), /OpenRouter reported a credit/);
});

test('13. once the budget is spent, new replies cause no model request', async () => {
    const { walk, tab } = await exhausted();
    const later = walk.model.calls.length;
    await arrive(walk, tab, 'I wait for an answer.', [['Narrator', 'Mirelle closes the red ledger.']]);
    await pass(walk, TICK_MS * 2);
    assert.equal(walk.site.messages.length, 97);
    assert.equal(stored(walk, 'campaign').messages.length, 97);
    assert.deepEqual(rolesSince(walk, later), []);
});

/**
 * @param {object} walk
 * @return {Promise<WholeTab>}
 */
async function secondTab(walk) {
    const second = install(walk, CHAT);
    await second.openPage();
    second.ready();
    await until(walk, 'step 14: the second tab to show the book', () => second.panel.headline() === 'Another tab is reading this chat.', 15000);
    return second;
}

test('14. a second tab watches', async () => {
    const { walk, tab } = await adopted('2');
    const second = await secondTab(walk);
    second.panel.tab('Summary');
    tab.panel.tab('Summary');
    assert.equal(second.panel.rows('cast').length, 5);
    assert.deepEqual(
        second.panel.rows('cast').map((row) => row.children[0].textContent),
        tab.panel.rows('cast').map((row) => row.children[0].textContent),
    );
    second.panel.tab('Rulings');
    const value = second.panel.buttonStarting(second.panel.rows('conflicts')[0], 'grey');
    const before = storageText(walk);
    const sets = walk.storage.count('set');
    const removes = walk.storage.count('remove');
    value.click();
    await settle();
    assert.equal(value.disabled, true);
    assert.equal(walk.storage.count('set'), sets);
    assert.equal(walk.storage.count('remove'), removes);
    assert.equal(storageText(walk), before);
    await pass(walk, TICK_MS * 2);
    second.panel.tab('Rulings');
    assert.equal(second.panel.rows('conflicts').length, 1);
    assert.equal(second.panel.rows('made').length, 0);
    assert.equal(walk.model.by(second.name).length, 0);
    assert.equal(second.panel.headline(), 'Another tab is reading this chat.');
});

test('14. when the first tab is hidden while the second waits, the second becomes the reader', async () => {
    const { walk, tab } = await adopted('2');
    const second = await secondTab(walk);
    assert.equal(walk.locks.waiting('scribe:reader:harbour'), 1);
    const hidden = walk.model.calls.length;
    tab.show('hidden');
    await until(walk, 'step 14: the second tab to become the reader', () => second.panel.headline().startsWith('Up to date'), TICK_MS * 2);
    await until(walk, 'step 14: the hidden tab to say another tab reads', () => tab.panel.headline() === 'Another tab is reading this chat.', TICK_MS * 2);
    const from = walk.model.calls.length;
    await arrive(walk, second, ASKED, REPLY);
    await until(walk, 'step 14: the reply to be checked', () => asked(walk, 'Pedant', from) >= 1, TICK_MS * 2);
    await pass(walk, TICK_MS * 2);
    assert.equal(walk.model.calls.slice(hidden).filter((call) => call.tab === tab.name).length, 0);
    const since = walk.model.calls.slice(from);
    assert.equal(since.filter((call) => call.tab === second.name && call.role === 'Scene').length, 1);
    assert.equal(since.filter((call) => call.tab === second.name && call.role === 'Pedant').length, 1);
    assert.equal(second.panel.headline(), 'Up to date: 93 of 93 read.');
});

test('14. with a lock manager that has no query, the hidden first tab keeps the chat', async () => {
    const { walk, tab } = await adopted('2', { query: false });
    const second = await secondTab(walk);
    tab.show('hidden');
    await pass(walk, TICK_MS * 3);
    assert.equal(second.panel.headline(), 'Another tab is reading this chat.');
    assert.equal(tab.panel.headline(), 'Up to date: 91 of 91 read.');
    const from = walk.model.calls.length;
    await arrive(walk, second, ASKED, REPLY);
    await until(walk, 'step 14: the hidden reader to check the reply', () => asked(walk, 'Pedant', from) >= 1, TICK_MS * 3);
    await pass(walk, TICK_MS * 2);
    const since = walk.model.calls.slice(from);
    assert.equal(since.filter((call) => call.tab === second.name).length, 0);
    assert.equal(since.filter((call) => call.tab === tab.name && call.role === 'Scene').length, 1);
    assert.equal(since.filter((call) => call.tab === tab.name && call.role === 'Pedant').length, 1);
    assert.equal(stored(walk, 'live').seen.id, walk.site.messages.at(-1).id);
    assert.equal(second.panel.headline(), 'Another tab is reading this chat.');
});

test('14. without browser locks, the second tab is still a watcher', async () => {
    const { walk } = await adopted('2', { locks: false });
    const second = await secondTab(walk);
    await pass(walk, TICK_MS * 3);
    assert.equal(second.panel.headline(), 'Another tab is reading this chat.');
    assert.equal(walk.model.by(second.name).length, 0);
});

/**
 * @param {WholeTab} tab
 * @return {void}
 */
function assertAdoptReady(tab) {
    assert.equal(tab.panel.headline().startsWith('No book for this chat yet'), true);
    assert.equal(tab.panel.byId('scribe-next').hidden, false);
    assert.equal(tab.panel.byId('scribe-next').disabled, false);
    assert.equal(tab.panel.text('scribe-next-outcome'), '');
}

test('21. once the first pull has landed, Adopt is enabled with no line under it, locks or none', async () => {
    for (const locks of [true, false]) {
        const walk = world({ locks });
        const tab = await opened(walk);
        assertAdoptReady(tab);
        await pass(walk, TICK_MS * 3);
        assertAdoptReady(tab);
    }
});

test('21. a second tab that takes over a chat with no book ends with Adopt enabled', async () => {
    const walk = world();
    const tab = await opened(walk);
    const second = await secondTab(walk);
    tab.show('hidden');
    await until(
        walk,
        'step 21: the second tab to take over',
        () => second.panel.headline().startsWith('No book for this chat yet'),
        TICK_MS * 2,
    );
    assertAdoptReady(second);
    await pass(walk, TICK_MS * 3);
    assertAdoptReady(second);
});

/**
 * @param {object} walk
 * @param {WholeTab} tab
 * @return {Promise<void>}
 */
async function pause(walk, tab) {
    tab.panel.tab('Progress');
    tab.panel.click('scribe-pause');
    await until(walk, 'step 15: paused', () => tab.panel.headline() === 'Stopped: Paused.', 5000);
}

/**
 * @param {object} walk
 * @param {WholeTab} tab
 * @return {Promise<void>}
 */
async function resume(walk, tab) {
    tab.panel.tab('Progress');
    tab.panel.click('scribe-resume');
    await until(walk, 'step 15: resumed', () => tab.panel.headline().startsWith('Up to date'), 5000);
}

test('15. pausing, a reply, resuming', async () => {
    const { walk, tab } = await adopted('2');
    await pause(walk, tab);
    const from = walk.model.calls.length;
    await arrive(walk, tab, ASKED, REPLY);
    await pass(walk, TICK_MS * 3);
    assert.equal(stored(walk, 'campaign').messages.length, 93);
    assert.deepEqual(rolesSince(walk, from), []);
    assert.equal(tab.panel.headline(), 'Stopped: Paused.');
    await resume(walk, tab);
    await pass(walk, TICK_MS * 2);
    assert.equal(asked(walk, 'Scene', from), 1);
    assert.equal(asked(walk, 'Pedant', from), 1);
    assert.equal(asked(walk, 'Story', from), 1);
});

test('15. the pause survives a reload, and resuming checks the newest reply', async () => {
    const { walk, tab } = await adopted('2');
    await pause(walk, tab);
    const from = walk.model.calls.length;
    await arrive(walk, tab, ASKED, REPLY);
    await pass(walk, TICK_MS * 3);
    const fresh = await reload(walk, tab);
    await pass(walk, TICK_MS * 2);
    assert.equal(fresh.panel.headline(), 'Stopped: Paused.');
    assert.deepEqual(rolesSince(walk, from), []);
    await resume(walk, fresh);
    await pass(walk, TICK_MS * 3);
    assert.equal(asked(walk, 'Story', from), 1);
    assert.equal(asked(walk, 'Scene', from), 1);
    assert.equal(asked(walk, 'Pedant', from), 1);
});

test('16. starting the book over', async () => {
    const { walk, tab } = await replied('3');
    tab.panel.tab('Findings');
    tab.panel.button(tab.panel.byId('scribe-offer-actions'), 'Suggest one').click();
    await until(walk, 'step 16: an offer', () => tab.panel.text('scribe-offer-text') === RIDER, 5000);
    tab.panel.button(tab.panel.byId('scribe-offer-actions'), 'Use').click();
    await settle();
    const oldReady = stored(walk, 'live').ready;
    assert.equal(oldReady.startsWith(`${HAIR} `), true, oldReady);
    assert.deepEqual(queued(tab), [`Reminder: ${oldReady}`, `Suggestion: ${RIDER}`]);
    const oldFindings = findingRows(tab).map((row) => row.textContent);
    assert.equal(oldFindings.length, 1);
    assert.equal(oldFindings[0].includes(OLD_HAIR), true);
    walk.model.answers.Story = storyFrom(FACTS.map(([position, line]) => [position, line.replace(OLD_HAIR, NEW_HAIR)]));
    const from = walk.model.calls.length;
    tab.panel.tab('Progress');
    assert.equal(tab.panel.text('scribe-adopt'), 'Start the book over');
    tab.panel.click('scribe-adopt');
    await until(walk, 'step 16: the new book to be read', () => asked(walk, 'Story', from) >= 1 && tab.panel.headline().startsWith('Up to date'), 15000);
    await until(walk, 'step 16: the newest reply to be checked against the new book', () => asked(walk, 'Pedant', from) >= 1, TICK_MS * 2);
    await quiet(walk, 'step 16: the first check of the new book');
    assert.deepEqual(tab.questions, ['Start a new book? It replaces the saved book for this chat.']);
    assert.deepEqual(
        walk.model.calls.slice(from).filter((call) => call.role === 'Story').map((call) => rangeOf(call.user)),
        ['1-30', '31-60', '61-90', '91-93'],
    );
    const lastStory = walk.model.calls.findLastIndex((call) => call.role === 'Story');
    assert.deepEqual(
        walk.model.calls.slice(from, lastStory + 1).map((call) => call.role),
        ['Story', 'Story', 'Story', 'Story'],
    );
    assert.equal(asked(walk, 'Scene', from), 1);
    assert.equal(asked(walk, 'Pedant', from), 1);
    assert.equal(asked(walk, 'Unknown', from), 0);
    const live = stored(walk, 'live');
    assert.equal(live.suggestion, null);
    const newReady = live.ready;
    assert.equal(typeof newReady, 'string');
    assert.equal(newReady === oldReady, false);
    assert.equal(newReady, `${LEAD} Mirelle has black hair, cut short. ${LOOKS_LEFT} ${PARTY}`);
    assert.equal(newReady.includes('worn in a braid'), false);
    assert.deepEqual(queued(tab), [`Reminder: ${newReady}`]);
    const newFindings = findingRows(tab).map((row) => row.textContent);
    assert.equal(newFindings.some((text) => text.includes(OLD_HAIR)), false);
    assert.equal(newFindings.length, 1);
    assert.equal(newFindings[0].includes(NEW_HAIR), true);
    const went = await send(walk, tab, 'I begin again.');
    assert.equal(went.includes(oldReady), false);
    assert.equal(went.includes('worn in a braid'), false);
    assert.equal(went.includes(RIDER), false);
    assert.equal(went, `I begin again.\n@: ${newReady}`);
});

test('17. leaving the chat', async () => {
    const { walk, tab } = await replied('2');
    tab.go('/');
    await pass(walk, 1000);
    assert.equal(tab.panel.hosts(), 0);
    assert.equal(tab.scriptTimers.count, 1);
    assert.equal(tab.pageTimers.count, 0);
    assert.equal(tab.document.documentElement.hasAttribute('data-zeta-scribe'), true);
    const reads = walk.site.scribeRequests().length;
    const calls = walk.model.calls.length;
    await arrive(walk, tab, 'I walk away from the market.', [['Narrator', 'Mirelle watches Halvard go.']]);
    await pass(walk, TICK_MS * 3);
    assert.equal(walk.site.scribeRequests().length, reads);
    assert.equal(walk.model.calls.length, calls);
    assert.equal(tab.scriptTimers.count, 1);
    assert.equal(tab.document.documentElement.hasAttribute('data-zeta-scribe'), true);
    assert.deepEqual(tab.logs, []);
});

const FOLDED = Object.freeze({ toggle: 'Scribe', expanded: 'false', body: true, collapsed: true });
const UNFOLDED = Object.freeze({ toggle: 'Hide', expanded: 'true', body: false, collapsed: false });

/**
 * @param {WholeTab} tab
 * @return {{ toggle: string, expanded: string|null, body: boolean, collapsed: boolean }}
 */
function folded(tab) {
    return {
        toggle: tab.panel.text('scribe-toggle'),
        expanded: tab.panel.byId('scribe-toggle').getAttribute('aria-expanded'),
        body: tab.panel.byId('scribe-body').hidden,
        collapsed: tab.panel.byId('scribe-panel').classes.has('collapsed'),
    };
}

/**
 * @return {Promise<{ walk: object, tab: WholeTab }>}
 */
async function narrowed() {
    const adopting = await adopted('2');
    const tab = await reload(adopting.walk, adopting.tab, NARROW);
    await quiet(adopting.walk, 'step 19: the narrow tab at rest');
    assert.equal(tab.window.innerWidth, NARROW);
    assert.equal(tab.panel.hosts(), 1);
    assert.deepEqual(folded(tab), FOLDED);
    return { walk: adopting.walk, tab };
}

/**
 * @return {Promise<{ walk: object, tab: WholeTab }>}
 */
async function hiddenWide() {
    const { walk, tab } = await adopted('2');
    assert.deepEqual(folded(tab), UNFOLDED);
    tab.panel.click('scribe-toggle');
    await settle();
    assert.deepEqual(folded(tab), FOLDED);
    assert.equal(walk.storage.get('scribe:panel', null), 'collapsed');
    return { walk, tab };
}

/**
 * @param {object} walk
 * @param {WholeTab} tab
 * @param {string} label
 * @return {Promise<string>}
 */
async function checkedWhileFolded(walk, tab, label) {
    assert.equal(tab.panel.text('scribe-badge'), '1 to rule');
    const from = walk.model.calls.length;
    await arrive(walk, tab, ASKED, REPLY);
    await until(
        walk,
        `${label}: the new reply to be checked`,
        () => stored(walk, 'live').seen?.id === walk.site.messages.at(-1).id,
        TICK_MS * 2,
    );
    await quiet(walk, label);
    assert.deepEqual(folded(tab), FOLDED);
    assert.equal(asked(walk, 'Scene', from), 1);
    assert.equal(asked(walk, 'Pedant', from), 1);
    assert.equal(asked(walk, 'Story', from), 1);
    const live = stored(walk, 'live');
    assert.equal(typeof live.ready, 'string');
    assert.equal(live.ready, `${HAIR} ${LOOKS_LEFT} ${PARTY}`);
    assert.deepEqual(plain(live.findings.map((finding) => [finding.kind, finding.said, finding.status])), [['Contradiction', 'red as rust', 'Open']]);
    assert.equal(tab.panel.text('scribe-badge'), '1 to rule, 1 finding');
    assert.equal(tab.panel.byId('scribe-badge').hidden, false);
    assert.equal(tab.panel.headline(), 'Up to date: 93 of 93 read.');
    return live.ready;
}

/**
 * @param {object} walk
 * @param {WholeTab} tab
 * @param {string} ready
 * @return {Promise<void>}
 */
async function openedAgain(walk, tab, ready) {
    const before = walk.model.calls.length;
    tab.panel.click('scribe-toggle');
    await settle();
    assert.deepEqual(folded(tab), UNFOLDED);
    assert.deepEqual(queued(tab), [`Reminder: ${ready}`]);
    const findings = findingRows(tab);
    assert.equal(findings.length, 1);
    const texts = tab.panel.walk(findings[0]).map((element) => element.ownText);
    assert.equal(texts.includes('The reply contradicts the book'), true);
    assert.equal(texts.some((text) => text.includes('red as rust')), true);
    assert.equal(texts.includes(GOES_FIRST), true);
    assert.deepEqual(tab.panel.buttonTexts(findings[0]), ['Dismiss', 'Rule it...']);
    await pass(walk, TICK_MS);
    assert.deepEqual(rolesSince(walk, before), []);
    assert.equal(stored(walk, 'live').ready, ready);
}

test('19. a narrow window: never opened, a new reply is still checked and its reminder goes out', async () => {
    const { walk, tab } = await narrowed();
    const ready = await checkedWhileFolded(walk, tab, 'step 19 narrow');
    const went = await send(walk, tab, 'I nod.');
    assert.equal(went, `I nod.\n@: ${ready}`);
    assert.equal(went.startsWith('I nod.\n@: [Scribe] '), true);
    assert.deepEqual(folded(tab), FOLDED);
    assert.equal(tab.panel.text('scribe-badge'), '1 to rule');
});

test('19. a narrow window: opened after the check, the panel shows the same finding and reminder, and opening asks nothing', async () => {
    const { walk, tab } = await narrowed();
    const ready = await checkedWhileFolded(walk, tab, 'step 19 narrow');
    await openedAgain(walk, tab, ready);
});

test('19. hidden by its Hide button at a wide window: a new reply is still checked and its reminder goes out', async () => {
    const { walk, tab } = await hiddenWide();
    const ready = await checkedWhileFolded(walk, tab, 'step 19 hidden');
    const went = await send(walk, tab, 'I nod.');
    assert.equal(went, `I nod.\n@: ${ready}`);
    assert.deepEqual(folded(tab), FOLDED);
    assert.equal(tab.panel.text('scribe-badge'), '1 to rule');
});

test('19. hidden by its Hide button: shown again, the panel shows the same finding and reminder, and showing asks nothing', async () => {
    const { walk, tab } = await hiddenWide();
    const ready = await checkedWhileFolded(walk, tab, 'step 19 hidden');
    await openedAgain(walk, tab, ready);
    assert.equal(walk.storage.get('scribe:panel', null), 'open');
});

test('20. two chats in two tabs of one window, the first hidden: each reads its own chat', async () => {
    const { walk, tab } = await adopted('2');
    walk.site.open(QUARRY, campaign(QUARRY_LENGTH));
    const other = install(walk, '/');
    other.ready();
    await pass(walk, 1000);
    other.go(`/rooms/${QUARRY}`);
    await other.openPage();
    await until(walk, 'step 20: the second chat to be pulled', () => other.panel.headline() === 'No book for this chat yet: 61 messages.', 15000);
    await adopt(walk, other, '2');
    await forceReminder(walk, other);
    assert.equal(other.panel.headline(), 'Up to date: 61 of 61 read.');
    assert.equal(tab.panel.headline(), 'Up to date: 91 of 91 read.');
    await tab.pagePost(ASKED);
    tab.show('hidden');
    walk.site.reply(REPLY.map((block) => [...block]));
    const from = walk.model.calls.length;
    await arrive(walk, other, 'I ask Mirelle about the quarry.', REPLY);
    await until(
        walk,
        'step 20: both new replies to be checked',
        () =>
            stored(walk, 'live').seen?.id === walk.site.messages.at(-1).id &&
            stored(walk, 'live', QUARRY).seen?.id === walk.site.messagesIn(QUARRY).at(-1).id,
        TICK_MS * 3,
    );
    await quiet(walk, 'step 20: both tabs at rest');
    assert.equal(walk.locks.held('scribe:reader:harbour'), true);
    assert.equal(walk.locks.held('scribe:reader:quarry'), true);
    assert.equal(walk.locks.waiting('scribe:reader:harbour'), 0);
    assert.equal(walk.locks.waiting('scribe:reader:quarry'), 0);
    const since = walk.model.calls.slice(from);
    /**
     * @param {WholeTab} each
     * @param {string} role
     * @return {string[]}
     */
    const replies = (each, role) => since.filter((call) => call.tab === each.name && call.role === role).map((call) => /REPLY \(#(\d+)\)/.exec(call.user)?.[1] ?? 'scene');
    assert.deepEqual(replies(tab, 'Scene'), ['scene']);
    assert.deepEqual(replies(tab, 'Pedant'), ['93']);
    assert.deepEqual(replies(other, 'Scene'), ['scene']);
    assert.deepEqual(replies(other, 'Pedant'), ['63']);
    assert.equal(since.filter((call) => call.role === 'Story').length, 2);
    assert.equal(tab.document.visibilityState, 'hidden');
    assert.equal(tab.panel.headline(), 'Up to date: 93 of 93 read.');
    assert.equal(other.panel.headline(), 'Up to date: 63 of 63 read.');
    const hiddenReady = stored(walk, 'live').ready;
    const visibleReady = stored(walk, 'live', QUARRY).ready;
    assert.equal(hiddenReady, `${HAIR} ${LOOKS_LEFT} ${PARTY}`);
    assert.equal(visibleReady.startsWith(`${HAIR} `), true, visibleReady);
    assert.deepEqual(plain(stored(walk, 'live').findings.map((finding) => [finding.message, finding.status])), [['MESSAGE-93', 'Open']]);
    assert.deepEqual(plain(stored(walk, 'live', QUARRY).findings.map((finding) => [finding.message, finding.status])), [['MESSAGE-63', 'Open']]);
    const went = await send(walk, other, 'I nod.');
    assert.equal(went, `I nod.\n@: ${visibleReady}`);
    assert.equal(stored(walk, 'live', QUARRY).ready, null);
    assert.equal(stored(walk, 'live').ready, hiddenReady);
    assert.equal(tab.panel.hosts(), 1);
    assert.equal(other.panel.hosts(), 1);
});

/**
 * @param {string} text
 * @param {readonly string[]} secrets
 * @return {boolean}
 */
function carries(text, secrets) {
    return secrets.some((secret) => String(text).includes(secret));
}

/**
 * @return {Promise<{ walk: object, tab: WholeTab, third: WholeTab, fourth: WholeTab, failing: number, spent: number, afterSpent: number, handed: number, handover: string }>}
 */
async function wholeWalk() {
    const walk = world();
    const first = install(walk, '/');
    first.ready();
    await pass(walk, 1000);
    first.go(CHAT);
    await first.openPage();
    await pass(walk, 3000);
    await saveKey(walk, first);
    first.panel.tab('Settings');
    first.panel.type('scribe-setting-budget', '0');
    first.panel.click('scribe-next');
    await pass(walk, 1000);
    await adopt(walk, first, '3');
    const tab = await reload(walk, first);
    tab.panel.tab('Rulings');
    tab.panel.buttonStarting(tab.panel.rows('conflicts')[0], 'grey').click();
    await pass(walk, 1000);
    walk.site.edit(5, 'I am Oswin, harbourmaster of this port. Keep the peace, guard.');
    tab.panel.tab('Progress');
    tab.panel.click('scribe-pull');
    await pass(walk, TICK_MS * 3);
    await arrive(walk, tab, ASKED, REPLY);
    await pass(walk, TICK_MS * 2);
    const original = walk.site.messages[92];
    walk.site.put(93, {
        ...original,
        id: 'MESSAGE-93-B',
        contents: CALM_REPLY.map(([speaker, text]) => ({ type: 'TEXT', speakerName: speaker, position: 'NARRATOR', text })),
    });
    await tab.pageRegenerate('MESSAGE-93');
    await pass(walk, TICK_MS);
    walk.site.put(93, original);
    await tab.pageRegenerate('MESSAGE-93-B');
    await pass(walk, TICK_MS);
    await send(walk, tab, 'I nod.');
    tab.refusing = true;
    tab.type('I wait.');
    tab.enter();
    await pass(walk, 200);
    tab.keyDown('a');
    tab.land('a');
    await pass(walk, 3000);
    tab.refusing = false;
    tab.panel.tab('Rulings');
    tab.panel.type('scribe-tell', 'Mirelle keeps a brass compass from her father.');
    tab.panel.click('scribe-tell-work');
    await pass(walk, 1000);
    tab.panel.button(tab.panel.byId('scribe-understood'), 'File it').click();
    await pass(walk, 1000);
    tab.panel.tab('Findings');
    tab.panel.button(tab.panel.byId('scribe-offer-actions'), 'Suggest one').click();
    await pass(walk, 1000);
    tab.panel.button(tab.panel.byId('scribe-offer-actions'), 'Use').click();
    await pass(walk, 1000);
    await send(walk, tab, 'I listen.');
    walk.model.answers.Suggest = () => RIDER;
    tab.panel.tab('Findings');
    tab.panel.button(tab.panel.byId('scribe-offer-actions'), 'Suggest one').click();
    await pass(walk, 1000);
    await quiet(walk, 'step 18: before the failing answer');
    const budget = (spentToday(walk) + 0.3).toFixed(2);
    tab.panel.tab('Settings');
    tab.panel.type('scribe-setting-budget', budget);
    tab.panel.click('scribe-save-settings');
    await pass(walk, 1000);
    walk.model.answers.Pedant = () => '';
    walk.model.costs.Pedant = 0.15;
    const failing = walk.model.calls.length;
    await arrive(walk, tab, 'I ask Mirelle about the red ledger.', [['Narrator', 'Mirelle taps the red ledger and smiles.']]);
    await pass(walk, TICK_MS * 2);
    const spent = walk.model.calls.length;
    await arrive(walk, tab, 'I wait for an answer.', [['Narrator', 'Mirelle closes the red ledger.']]);
    await pass(walk, TICK_MS * 2);
    const afterSpent = walk.model.calls.length;
    walk.model.answers.Pedant = pedantAnswer;
    tab.panel.tab('Settings');
    tab.panel.type('scribe-setting-budget', '6');
    tab.panel.click('scribe-save-settings');
    await pass(walk, 1000);
    await pause(walk, tab);
    await arrive(walk, tab, 'I sit down by the stall.', [['Narrator', 'Mirelle pours two cups of tea.']]);
    await pass(walk, TICK_MS * 2);
    const third = await reload(walk, tab);
    await pass(walk, TICK_MS);
    await resume(walk, third);
    await pass(walk, TICK_MS);
    const fourth = await secondTab(walk);
    fourth.panel.tab('Rulings');
    for (const button of fourth.panel.buttonsIn(fourth.panel.byId('scribe-list-made'))) {
        button.click();
    }
    await pass(walk, 1000);
    const handed = walk.model.calls.length;
    third.show('hidden');
    await pass(walk, TICK_MS * 2);
    const handover = fourth.panel.headline();
    await arrive(walk, fourth, ASKED, REPLY);
    await pass(walk, TICK_MS * 2);
    fourth.panel.tab('Progress');
    fourth.panel.click('scribe-adopt');
    await pass(walk, TICK_MS * 2);
    fourth.go('/');
    third.go('/');
    await pass(walk, TICK_MS);
    return { walk, tab, third, fourth, failing, spent, afterSpent, handed, handover };
}

test('18. secrets over the whole walk', async () => {
    const { walk, tab, third, fourth, failing, spent, afterSpent, handed, handover } = await wholeWalk();
    assert.equal(walk.model.silenced, 0);
    assert.deepEqual(walk.model.strays, []);
    assert.equal(walk.model.of('Notes').length, 1);
    assert.equal(walk.model.of('Suggest').length, 2);
    assert.equal(
        walk.model.calls.slice(failing, spent).filter((call) => call.role === 'Pedant' && call.tab === tab.name).length,
        3,
    );
    assert.equal(afterSpent, spent);
    assert.equal(handover.startsWith('Up to date'), true, handover);
    assert.equal(walk.model.calls.slice(handed).filter((call) => call.tab === third.name).length, 0);
    assert.deepEqual(fourth.questions, ['Start a new book? It replaces the saved book for this chat.']);
    assert.equal(walk.model.by(fourth.name).filter((call) => call.role === 'Story').length >= 4, true);
    assert.equal(walk.model.by(fourth.name).filter((call) => call.role === 'Pedant').length >= 1, true);
    assert.equal(fourth.panel.hosts(), 0);
    assert.equal(third.panel.hosts(), 0);
    assert.deepEqual(
        walk.tabs.map((each) => each.logs.length),
        [0, 0, 0, 0],
    );
    assert.equal(walk.model.of('Scene').filter((call) => call.tab === tab.name).length >= 3, true);
    const tokens = [WholeSite.Token, BARE_TOKEN];
    for (const each of walk.tabs) {
        assert.equal(each.logs.some((line) => carries(line, [KEY, ...tokens])), false, `${each.name} logs`);
        assert.equal(each.panel.everWritten().some((text) => carries(text, [KEY, ...tokens])), false, `${each.name} element text`);
    }
    for (const request of walk.site.requests) {
        assert.equal(carries(request.url, [KEY]), false);
        assert.equal(carries(request.headers, [KEY]), false);
        assert.equal(carries(request.body ?? '', [KEY]), false);
    }
    assert.deepEqual(
        [...walk.storage.values.entries()].filter(([, value]) => carries(value, [KEY])).map(([name]) => name),
        ['scribe:key'],
    );
    assert.deepEqual(
        [...walk.storage.values.entries()].filter(([name, value]) => carries(name, tokens) || carries(value, tokens)).map(([name]) => name),
        [],
    );
    for (const call of walk.model.calls) {
        assert.equal(carries(call.url, tokens), false);
        assert.equal(carries(call.headers, tokens), false);
        assert.equal(carries(call.data, tokens), false);
    }
});

/**
 * @param {object} walk
 * @param {string} label
 * @param {string} direction
 * @return {object[]}
 */
function bridged(walk, label, direction) {
    return walk.posts
        .filter((post) => post.delivered && (direction === 'to' ? post.toLabel === label : post.fromLabel === label))
        .map((post) => JSON.parse(post.data));
}

/**
 * @param {object} walk
 * @param {WholeTab} tab
 * @return {object[]}
 */
function armsTo(walk, tab) {
    return bridged(walk, `${tab.name}/frame`, 'to').filter((message) => message.kind === 'arm');
}

/**
 * @param {object} walk
 * @param {WholeTab} tab
 * @return {object[]}
 */
function reportsFrom(walk, tab) {
    return bridged(walk, `${tab.name}/frame`, 'from');
}

/**
 * @param {object} walk
 * @return {number}
 */
function posted(walk) {
    return walk.site.requests.filter((request) => request.method === 'POST').length;
}

test('F1. the two copies start as they should', async () => {
    const walk = world();
    const tab = install(walk, '/');
    tab.ready();
    assert.deepEqual(tab.frame.gm, []);
    assert.equal(tab.gm[0], 'GM_getValue("scribe-bridge", null)');
    assert.equal(tab.gm[1], 'GM_setValue("scribe-bridge")');
    await pass(walk, 1000);
    tab.go(CHAT);
    await tab.openPage();
    await until(walk, 'step F1: the chat to be pulled', () => tab.panel.headline().startsWith('No book for this chat yet'), 15000);
    await pass(walk, 5000);
    const token = walk.storage.get(BRIDGE, null);
    assert.equal(typeof token === 'string' && token.length >= 16 && token.length <= 200, true);
    assert.equal(tab.panel.hosts(), 1);
    assert.equal(tab.gm.some((call) => call.startsWith('GM_getValue("scribe:')), true);
    assert.equal(tab.document.documentElement.hasAttribute('data-zeta-scribe'), true);
    assert.equal(tab.window.listening('message'), 1);
    assert.equal(tab.frame.gm.length > 0, true);
    assert.equal(tab.frame.gm.every((call) => call === BRIDGE_READ), true);
    assert.deepEqual(tab.frame.logs, []);
    assert.equal(tab.frame.document.elements.length, 2);
    assert.equal(tab.frame.document.documentElement.hasAttribute('data-zeta-scribe'), false);
    assert.equal(tab.frame.window.listening('message'), 1);
    const first = walk.posts.find((post) => post.fromLabel === `${tab.name}/frame`);
    assert.deepEqual(JSON.parse(first.data), { zetaScribe: 1, kind: 'ready' });
    assert.equal(first.target, TOP_ORIGIN);
    assert.equal(first.delivered, true);
    const arms = armsTo(walk, tab);
    assert.equal(arms.length >= 1, true);
    assert.deepEqual(arms[0], {
        zetaScribe: 1,
        kind: 'arm',
        seq: 1,
        token,
        ready: null,
        suggestion: null,
        ends: [],
        reminder: null,
        attempt: null,
    });
    assert.equal(arms.every((arm) => arm.token === token), true);
    assert.equal(
        walk.posts.filter((post) => post.toLabel === `${tab.name}/frame`).every((post) => post.target === FRAME_ORIGIN),
        true,
    );
    const readies = reportsFrom(walk, tab).filter((message) => message.kind === 'ready').length;
    await pass(walk, 5000);
    assert.equal(reportsFrom(walk, tab).filter((message) => message.kind === 'ready').length, readies);
    assert.equal(walk.site.requests.filter((request) => request.origin === FRAME_ORIGIN).length, 0);
    const alone = install(walk, '/v1/index.html', WIDE, { origin: FRAME_ORIGIN, layout: 'none' });
    alone.ready();
    await pass(walk, 3000);
    assert.deepEqual(alone.gm, []);
    assert.deepEqual(alone.logs, []);
    assert.equal(alone.window.listening('message'), 0);
    assert.equal(alone.window.listening('keydown'), 0);
    assert.equal(alone.scriptTimers.count, 0);
    assert.equal(alone.pageTimers.count, 0);
    assert.equal(alone.document.elements.length, 2);
    assert.equal(alone.document.documentElement.hasAttribute('data-zeta-scribe'), false);
    assert.equal(walk.posts.filter((post) => post.fromLabel === alone.name).length, 0);
    assert.equal(walk.storage.get(BRIDGE, null), token);
});

/**
 * @param {boolean} button
 * @return {Promise<void>}
 */
async function throughFrame(button) {
    const { walk, tab } = await replied('2');
    const ready = stored(walk, 'live').ready;
    const armed = armsTo(walk, tab).at(-1);
    assert.equal(armed.ready, ready);
    const posts = posted(walk);
    const reports = reportsFrom(walk, tab).length;
    tab.type('I nod.');
    if (button) {
        tab.press('Send', true);
    } else {
        tab.enter();
    }
    await pass(walk, 2000);
    const went = walk.site.requests.filter((request) => request.method === 'POST').slice(posts);
    assert.equal(went.length, 1);
    assert.equal(went[0].origin, FRAME_ORIGIN);
    const text = JSON.parse(went[0].body).text;
    assert.equal(text, `I nod.\n@: ${ready}`);
    assert.equal(text.split('\n@: [Scribe] ').length - 1, 1);
    assert.deepEqual(
        reportsFrom(walk, tab)
            .slice(reports)
            .filter((message) => message.kind === 'sent')
            .map((message) => [message.seq, message.ready, message.suggestion]),
        [[armed.seq, true, false]],
    );
    assert.equal(stored(walk, 'live').ready, null);
    assert.deepEqual(plain(stored(walk, 'live').findings.map((finding) => finding.status)), ['Reminded']);
    assert.deepEqual(queued(tab), []);
    const findings = findingRows(tab);
    assert.equal(findings.length, 1);
    assert.equal(tab.panel.walk(findings[0]).some((element) => element.ownText === WENT_OUT), true);
    assert.equal(tab.box.value, '');
    assert.deepEqual(tab.logs, []);
    assert.deepEqual(tab.frame.logs, []);
}

test('F2. a reminder goes out through the frame by Enter', async () => {
    await throughFrame(false);
});

test('F2. a reminder goes out through the frame by a press on Send', async () => {
    await throughFrame(true);
});

test('F2. a reminder typed with a doubled lead goes out through the frame with one lead', async () => {
    const { walk, tab } = await replied('2');
    tab.panel.tab('Findings');
    const box = tab.panel.byId('scribe-reminder');
    assert.equal(box.readOnly, true);
    tab.panel.click('scribe-edit');
    await pass(walk, 200);
    assert.equal(box.readOnly, false);
    box.value = '@: @: [Scribe] Mirelle wears a green coat.';
    box.dispatchEvent({ type: 'input' });
    await pass(walk, 500);
    assert.equal(stored(walk, 'live').edited, null);
    tab.panel.click('scribe-edit-save');
    await pass(walk, 200);
    assert.equal(box.readOnly, true);
    assert.equal(box.value, '[Scribe] Mirelle wears a green coat.');
    assert.equal(stored(walk, 'live').edited, '[Scribe] Mirelle wears a green coat.');
    const posts = posted(walk);
    const text = await send(walk, tab, 'I nod.');
    assert.equal(posted(walk), posts + 1);
    const body = JSON.parse(walk.site.requests.filter((request) => request.method === 'POST').at(-1).body).text;
    assert.equal(body.endsWith('\n@: [Scribe] Mirelle wears a green coat.'), true, body);
    assert.equal(body.includes('@: @:'), false, body);
    assert.equal(text.includes('I nod.'), true);
    assert.equal(stored(walk, 'live').edited, null);
});

test('F3. nothing lands in any other field of the top page or the frame', async () => {
    const { walk, tab } = await replied('2');
    const ready = stored(walk, 'live').ready;
    const posts = posted(walk);
    const reports = reportsFrom(walk, tab).length;
    const { notes, title } = tab.addTool();
    for (const field of [notes, title]) {
        tab.enterIn(field, tab.document, tab.window, 'A note of my own.');
        await pass(walk, 100);
        assert.equal(field.value, 'A note of my own.');
    }
    for (const input of tab.inputs) {
        tab.enterIn(input, tab.chatDocument, tab.chatWindow, 'Some other words.');
        await pass(walk, 100);
        assert.equal(input.value, 'Some other words.');
    }
    tab.type('I hesitate.');
    const written = tab.box.writes.length;
    tab.press('Suggested replies');
    await pass(walk, 100);
    tab.press('Insert asterisk');
    await pass(walk, 2000);
    assert.equal(tab.box.value, 'I hesitate.');
    assert.equal(tab.box.writes.length, written);
    for (const field of [notes, title, ...tab.inputs]) {
        assert.equal(field.writes.length, 1, field.name);
    }
    assert.deepEqual(tab.presses, ['Suggested replies', 'Insert asterisk']);
    assert.equal(tab.elsewhere.length, 5);
    assert.equal(posted(walk), posts);
    assert.deepEqual(
        reportsFrom(walk, tab)
            .slice(reports)
            .filter((message) => message.kind === 'sent'),
        [],
    );
    assert.equal(stored(walk, 'live').ready, ready);
    assert.deepEqual(tab.logs, []);
    assert.deepEqual(tab.frame.logs, []);
});

test('F4. the secrets stay on top over the whole walk', async () => {
    const { walk } = await wholeWalk();
    const secrets = [KEY, WholeSite.Token, BARE_TOKEN];
    const framed = walk.tabs.filter((each) => each.frame !== null);
    assert.equal(framed.length, 4);
    const crossing = walk.posts.filter((post) => post.to === FRAME_ORIGIN || post.from === FRAME_ORIGIN);
    assert.equal(crossing.length > 0, true);
    assert.equal(crossing.some((post) => carries(post.data, secrets)), false);
    assert.equal(
        walk.posts.filter((post) => post.to === FRAME_ORIGIN).every((post) => post.target === FRAME_ORIGIN),
        true,
    );
    const token = walk.storage.get(BRIDGE, null);
    assert.equal(typeof token === 'string' && token.length >= 16, true);
    const carrying = walk.posts.filter((post) => post.data.includes(token));
    assert.equal(carrying.length > 0, true);
    assert.equal(
        carrying.every((post) => post.toLabel.endsWith('/frame') && JSON.parse(post.data).kind === 'arm'),
        true,
    );
    assert.deepEqual(
        [...walk.storage.values.entries()].filter(([name, value]) => carries(name, [token]) || carries(value, [token])).map(([name]) => name),
        [BRIDGE],
    );
    for (const request of walk.site.requests) {
        assert.equal(carries(`${request.url} ${request.headers} ${request.body ?? ''}`, [token]), false);
    }
    for (const call of walk.model.calls) {
        assert.equal(carries(`${call.url} ${call.headers} ${call.data}`, [token]), false);
    }
    for (const each of walk.tabs) {
        assert.equal(each.logs.some((line) => carries(line, [token])), false, `${each.name} logs`);
        assert.equal(each.panel.everWritten().some((text) => carries(text, [token])), false, `${each.name} elements`);
    }
    for (const each of framed) {
        assert.equal(each.frame.gm.every((call) => call === BRIDGE_READ), true, `${each.name} frame calls`);
        assert.deepEqual(each.frame.logs, [], `${each.name} frame logs`);
        assert.equal(each.frame.document.elements.some((element) => carries(element.textContent, [token])), false);
        for (const field of [each.box, ...each.inputs]) {
            assert.equal(field.writes.some((write) => carries(write, [token])), false, `${each.name} ${field.name} token`);
        }
        assert.equal(each.frame.document.elements.length, 2, `${each.name} frame elements`);
        for (const field of [each.box, ...each.inputs]) {
            assert.equal(carries(field.value, secrets), false);
            assert.equal(field.writes.some((write) => carries(write, secrets)), false, `${each.name} ${field.name}`);
        }
    }
    assert.equal(walk.site.requests.filter((request) => request.origin === FRAME_ORIGIN && !request.own).length, 0);
    assert.equal(walk.site.requests.filter((request) => request.origin === FRAME_ORIGIN).length > 0, true);
});

test('F5. forged reports to the top page change nothing', async () => {
    const { walk, tab } = await replied('2');
    const ready = stored(walk, 'live').ready;
    const arms = armsTo(walk, tab);
    const last = arms.at(-1).seq;
    const stale = arms[0].seq;
    assert.equal(arms[0].ready, null);
    /**
     * @param {*} seq
     * @return {object}
     */
    const report = (seq) => ({ zetaScribe: 1, kind: 'sent', seq, ready: true, suggestion: false });
    const mark = walk.posts.length;
    tab.outsider('https://ads.example', 'top').postMessage(report(last), '*');
    tab.outsider(FRAME_ORIGIN, 'top').postMessage(report(last), TOP_ORIGIN);
    tab.frame.toTop.postMessage(report(stale), TOP_ORIGIN);
    tab.frame.toTop.postMessage({ zetaScribe: 1, kind: 'sent', seq: String(last), ready: 'yes', suggestion: false }, TOP_ORIGIN);
    tab.frame.toTop.postMessage({ zetaScribe: 2, kind: 'sent', seq: last, ready: true, suggestion: false }, TOP_ORIGIN);
    tab.frame.toTop.postMessage({ zetaScribe: 1, kind: 'sent', seq: -1, ready: true, suggestion: false }, TOP_ORIGIN);
    tab.frame.toTop.postMessage('sent', TOP_ORIGIN);
    await pass(walk, 2000);
    const forged = walk.posts.slice(mark);
    assert.equal(forged.filter((post) => post.fromLabel === 'outsider' && post.toLabel === tab.name && post.delivered).length, 2);
    assert.equal(forged.filter((post) => post.fromLabel === `${tab.name}/frame` && post.toLabel === tab.name && post.delivered).length, 5);
    assert.equal(stored(walk, 'live').ready, ready);
    assert.deepEqual(plain(stored(walk, 'live').findings.map((finding) => finding.status)), ['Open']);
    assert.deepEqual(queued(tab), [`Reminder: ${ready}`]);
    assert.deepEqual(tab.logs, []);
    const went = await send(walk, tab, 'I nod.');
    assert.equal(went, `I nod.\n@: ${ready}`);
});

test('F5. forged arms to the frame change nothing', async () => {
    const { walk, tab } = await replied('2');
    await send(walk, tab, 'I nod.');
    await pass(walk, 1000);
    const last = armsTo(walk, tab).at(-1);
    assert.equal(last.ready, null);
    assert.equal(last.suggestion, null);
    const forged = { zetaScribe: 1, kind: 'arm', seq: last.seq + 100, ready: '[Scribe] A forged line.', suggestion: 'A forged suggestion.' };
    tab.outsider('https://ads.example', 'frame').postMessage(forged, '*');
    tab.outsider(TOP_ORIGIN, 'frame').postMessage({ ...forged, seq: last.seq + 101 }, FRAME_ORIGIN);
    await pass(walk, 1000);
    assert.equal(walk.posts.filter((post) => post.fromLabel === 'outsider' && post.toLabel === `${tab.name}/frame` && post.delivered).length, 2);
    const went = await send(walk, tab, 'I wait.');
    assert.equal(went, 'I wait.');
    assert.deepEqual(tab.frame.logs, []);
});

/**
 * @param {object} walk
 * @param {number} most
 * @return {Promise<number>}
 */
async function afterTick(walk, most) {
    const before = walk.site.pageRequests().length;
    await until(walk, 'a tick of the reading tab', () => walk.site.pageRequests().length > before, most);
    return walk.site.pageRequests().length;
}

test('F5. a script-made message event on the top page tells nothing and causes no tick', async () => {
    const { walk, tab } = await replied('2');
    const ready = stored(walk, 'live').ready;
    const sends = stored(walk, 'live').sends;
    const last = armsTo(walk, tab).at(-1).seq;
    const reads = await afterTick(walk, TICK_MS + 1000);
    await pass(walk, 300);
    tab.window.receive({
        type: 'message',
        isTrusted: false,
        origin: FRAME_ORIGIN,
        source: tab.iframe.contentWindow,
        data: { zetaScribe: 1, kind: 'sent', seq: last, ready: true, suggestion: false },
    });
    await pass(walk, 3000);
    assert.equal(walk.site.pageRequests().length, reads);
    assert.equal(stored(walk, 'live').ready, ready);
    assert.equal(stored(walk, 'live').sends, sends);
    assert.deepEqual(plain(stored(walk, 'live').findings.map((finding) => finding.status)), ['Open']);
    assert.deepEqual(tab.logs, []);
    tab.frame.toTop.postMessage({ zetaScribe: 1, kind: 'sent', seq: last, ready: false, suggestion: false }, TOP_ORIGIN);
    await pass(walk, 1000);
    assert.equal(walk.site.pageRequests().length > reads, true);
    assert.equal(stored(walk, 'live').ready, ready);
});

test('F5. arms posted to the frame by a script in the top page change nothing and lock nothing out', async () => {
    const { walk, tab } = await replied('2');
    const ready = stored(walk, 'live').ready;
    const real = armsTo(walk, tab).at(-1);
    assert.equal(real.ready, ready);
    const page = tab.iframe.contentWindow;
    const mark = walk.posts.length;
    page.postMessage({ zetaScribe: 1, kind: 'arm', seq: real.seq + 1, ready: '[Scribe] Forged without a token.', suggestion: null }, FRAME_ORIGIN);
    page.postMessage(
        { zetaScribe: 1, kind: 'arm', seq: real.seq + 2, token: 'a-wrong-token-of-length', ready: '[Scribe] Forged with a wrong token.', suggestion: 'A forged suggestion.' },
        FRAME_ORIGIN,
    );
    page.postMessage(
        { zetaScribe: 1, kind: 'arm', seq: Number.MAX_SAFE_INTEGER, token: 'another-wrong-token-0000', ready: '[Scribe] Forged at the highest seq.', suggestion: null },
        FRAME_ORIGIN,
    );
    await pass(walk, 500);
    assert.equal(walk.posts.slice(mark).filter((post) => post.fromLabel === tab.name && post.delivered).length, 3);
    tab.panel.tab('Findings');
    tab.panel.button(tab.panel.byId('scribe-offer-actions'), 'Suggest one').click();
    await until(walk, 'step F5: an offer', () => tab.panel.text('scribe-offer-text') === RIDER, 5000);
    tab.panel.button(tab.panel.byId('scribe-offer-actions'), 'Use').click();
    await until(walk, 'step F5: a real arm with the suggestion', () => armsTo(walk, tab).at(-1).suggestion === RIDER, 5000);
    assert.equal(armsTo(walk, tab).at(-1).seq < Number.MAX_SAFE_INTEGER, true);
    const went = await send(walk, tab, 'I listen.');
    assert.equal(went, `I listen.\n@: ${ready}\n@: ${RIDER}`);
    assert.equal(went.includes('Forged'), false);
    assert.equal(went.includes('forged'), false);
    assert.equal(tab.frame.gm.every((call) => call === BRIDGE_READ), true);
});

/**
 * @param {object} walk
 * @param {WholeTab} tab
 * @return {Promise<string>}
 */
async function moved(walk, tab) {
    const old = stored(walk, 'live').ready;
    walk.model.answers.Scene = () => OFFICE;
    walk.model.answers.Pedant = () => `=== NOW\nMirelle | wearing | ${APRON}`;
    await arrive(walk, tab, 'I follow Mirelle inside.', [['Narrator', 'Mirelle leads Halvard into the ledger office.']]);
    await until(
        walk,
        'step F9: the new reply to be checked',
        () => stored(walk, 'live').seen?.id === walk.site.messages.at(-1).id && stored(walk, 'live').ready !== old,
        TICK_MS * 2,
    );
    await quiet(walk, 'step F9: after the check');
    return stored(walk, 'live').ready;
}

test('F9. a chat frame hidden while the reminder changes appends the present reminder, never the old one', async () => {
    const { walk, tab } = await replied('2');
    const old = stored(walk, 'live').ready;
    tab.frameShown(false);
    const present = await moved(walk, tab);
    assert.equal(typeof present, 'string');
    assert.equal(present.includes(`Mirelle wears ${APRON}; brown eyes`), true, present);
    assert.equal(present === old, false);
    assert.equal(armsTo(walk, tab).at(-1).ready, present);
    tab.frameShown(true);
    const went = await send(walk, tab, 'I sit down.');
    assert.equal(went, `I sit down.\n@: ${present}`);
    assert.equal(went.includes(old), false);
});

test('F9. a reminder dropped while the chat frame is hidden is not appended when it is shown again', async () => {
    const { walk, tab } = await replied('2');
    tab.frameShown(false);
    tab.panel.tab('Findings');
    tab.panel.click('scribe-clear');
    await pass(walk, 1000);
    assert.equal(stored(walk, 'live').ready, null);
    assert.equal(armsTo(walk, tab).at(-1).ready, null);
    tab.frameShown(true);
    const went = await send(walk, tab, 'I sit down.');
    assert.equal(went, 'I sit down.');
});

test('F9. a send reported while the chat frame is hidden still clears the reminder', async () => {
    const { walk, tab } = await replied('2');
    const ready = stored(walk, 'live').ready;
    tab.frameShown(false);
    const went = await send(walk, tab, 'I nod.');
    assert.equal(went, `I nod.\n@: ${ready}`);
    assert.equal(stored(walk, 'live').ready, null);
    assert.deepEqual(plain(stored(walk, 'live').findings.map((finding) => finding.status)), ['Reminded']);
    tab.frameShown(true);
    const next = await send(walk, tab, 'I wait.');
    assert.equal(next, 'I wait.');
});

test("F10. leaving one chat for another: the second chat's messages never carry the first chat's reminder", async () => {
    const walk = world();
    walk.site.open(QUARRY, campaign(QUARRY_LENGTH));
    walk.model.answers.Story = storyFrom(FACTS.map(([position, line]) => [position, line.replace(OLD_HAIR, NEW_HAIR)]));
    const tab = install(walk, '/');
    tab.ready();
    await pass(walk, 1000);
    tab.go(`/rooms/${QUARRY}`);
    await tab.openPage();
    await until(walk, 'step F10: the second chat to be pulled', () => tab.panel.headline() === 'No book for this chat yet: 61 messages.', 15000);
    await saveKey(walk, tab);
    await adopt(walk, tab, '3');
    await forceReminder(walk, tab);
    const quarryReady = stored(walk, 'live', QUARRY).ready;
    assert.equal(typeof quarryReady, 'string');
    await send(walk, tab, 'I look at the quarry wall.');
    await send(walk, tab, 'I wait by the cart.');
    await quiet(walk, 'step F10: the second chat at rest');
    const before = plain(stored(walk, 'live', QUARRY));
    assert.equal(before.ready, null);
    assert.equal(before.sends, 1);
    walk.model.answers.Story = storyFrom(FACTS);
    tab.go(CHAT);
    await tab.openPage();
    await until(walk, 'step F10: the first chat to be pulled', () => tab.panel.headline() === 'No book for this chat yet: 91 messages.', TICK_MS * 2);
    await adopt(walk, tab, '3');
    await forceReminder(walk, tab);
    const first = stored(walk, 'live').ready;
    assert.equal(typeof first, 'string');
    assert.equal(first.includes('black hair, worn in a braid'), true, first);
    const harbourArm = armsTo(walk, tab).at(-1);
    assert.equal(harbourArm.ready, first);
    const mark = walk.posts.length;
    tab.go(`/rooms/${QUARRY}`);
    await until(walk, 'step F10: the second chat to be open again', () => tab.panel.headline() === 'Up to date: 63 of 63 read.', TICK_MS * 2);
    await quiet(walk, 'step F10: back in the second chat');
    const reads = walk.site.pageRequests().length;
    const reported = walk.posts.length;
    tab.frame.toTop.postMessage({ zetaScribe: 1, kind: 'sent', seq: harbourArm.seq, ready: true, suggestion: false }, TOP_ORIGIN);
    await pass(walk, 2000);
    const late = walk.posts.slice(reported).filter((post) => post.fromLabel === `${tab.name}/frame`);
    assert.equal(late.length, 1);
    assert.equal(late[0].delivered, true);
    assert.equal(walk.site.pageRequests().length > reads, true);
    assert.deepEqual(tab.logs, []);
    assert.deepEqual(tab.frame.logs, []);
    const after = plain(stored(walk, 'live', QUARRY));
    assert.equal(after.sends, before.sends);
    assert.equal(after.ready, before.ready);
    assert.equal(after.suggestion, before.suggestion);
    assert.equal(stored(walk, 'live').ready, first);
    const since = walk.posts
        .slice(mark)
        .filter((post) => post.toLabel === `${tab.name}/frame`)
        .map((post) => JSON.parse(post.data));
    assert.equal(since.length > 0, true);
    assert.equal(since.every((arm) => arm.ready !== first), true);
    const went = await send(walk, tab, 'I climb the quarry path.');
    assert.equal(went.includes(first), false);
    assert.equal(went.includes('worn in a braid'), false);
});

test('F6. leaving the chat disarms the frame, and returning arms it again', async () => {
    const { walk, tab } = await replied('2');
    const ready = stored(walk, 'live').ready;
    tab.go('/');
    await pass(walk, 2000);
    assert.equal(tab.panel.hosts(), 0);
    const left = armsTo(walk, tab).at(-1);
    assert.equal(left.ready, null);
    assert.equal(left.suggestion, null);
    const away = await send(walk, tab, 'I step outside.');
    assert.equal(away, 'I step outside.');
    tab.go(CHAT);
    await until(walk, 'step F6: the frame to be armed again', () => armsTo(walk, tab).at(-1).ready === ready, TICK_MS * 2);
    const back = await send(walk, tab, 'I come back in.');
    assert.equal(back, `I come back in.\n@: ${ready}`);
    assert.equal(stored(walk, 'live').ready, null);
});

test('F11. a check left running gets Force stop at 4 minutes, and the call asked again answers now', async () => {
    const { walk, tab } = await adopted('2');
    walk.model.holding = 'Pedant';
    const checks = walk.model.of('Pedant').length;
    await arrive(walk, tab, ASKED, REPLY);
    await until(walk, 'the check to be held', () => walk.model.of('Pedant').length === checks + 1, TICK_MS * 2);
    const held = walk.model.of('Pedant').at(-1);
    await pass(walk, held.at + 239999 - walk.clock.now());
    assert.equal(tab.panel.byId('scribe-force-stop').hidden, true);
    await pass(walk, 1);
    assert.equal(tab.panel.byId('scribe-force-stop').hidden, false);
    assert.equal(tab.panel.text('scribe-force-stop'), 'Force stop');
    walk.model.holding = null;
    tab.panel.click('scribe-force-stop');
    await pass(walk, 1000);
    assert.equal(held.ended, true);
    const asked = walk.model.of('Pedant').slice(checks + 1);
    assert.equal(asked.length, 1);
    assert.equal(asked[0].user, `${held.user}\n\nAnswer now, without more thinking.`);
    assert.equal(asked[0].system, held.system);
    assert.equal(tab.panel.byId('scribe-force-stop').hidden, true);
    await until(walk, 'the reply to be checked', () => typeof stored(walk, 'live')?.ready === 'string', TICK_MS * 2);
    await tab.panel.tab('Progress');
    const rows = tab.panel.rowTexts('liveCalls');
    const stopped = rows.filter((row) => row.startsWith('Pedant: in (unknown), out (unknown), finish (unknown)'));
    assert.equal(stopped.length, 1, rows.join(' | '));
    assert.equal(stopped[0].endsWith('Stopped by the operator; cost unknown'), true, stopped[0]);
});

test('F12. Force stop once the day is spent asks nothing more, and the stopped check is still listed', async () => {
    const { walk, tab } = await adopted('2');
    walk.model.holding = 'Pedant';
    const checks = walk.model.of('Pedant').length;
    await arrive(walk, tab, ASKED, REPLY);
    await until(walk, 'the check to be held', () => walk.model.of('Pedant').length === checks + 1, TICK_MS * 2);
    const held = walk.model.of('Pedant').at(-1);
    REFERENCE.ScribeStore.spend(walk.storage, ROOM, dayOf(walk), 2);
    await pass(walk, held.at + 240000 - walk.clock.now());
    assert.equal(tab.panel.byId('scribe-force-stop').hidden, false);
    const before = walk.model.calls.length;
    tab.panel.click('scribe-force-stop');
    await pass(walk, 1000);
    assert.equal(held.ended, true);
    assert.equal(walk.model.calls.length, before);
    assert.equal(tab.panel.byId('scribe-force-stop').hidden, true);
    await tab.panel.tab('Progress');
    const rows = tab.panel.rowTexts('liveCalls');
    assert.equal(rows[0].startsWith('Pedant: in (unknown), out (unknown), finish (unknown)'), true, rows.join(' | '));
    assert.equal(rows[0].endsWith("The day's budget is spent"), true, rows[0]);
    assert.equal(rows[1].startsWith('Pedant: in (unknown), out (unknown), finish (unknown)'), true, rows.join(' | '));
    assert.equal(rows[1].endsWith('Stopped by the operator; cost unknown'), true, rows[1]);
});

test('F7. a second tab that only watches arms its frame with nothing', async () => {
    const { walk, tab } = await replied('2');
    const ready = stored(walk, 'live').ready;
    const second = await secondTab(walk);
    await pass(walk, 2000);
    const arms = armsTo(walk, second);
    assert.equal(arms.length >= 1, true);
    assert.equal(arms.every((arm) => arm.ready === null && arm.suggestion === null), true);
    const went = await send(walk, second, 'I watch quietly.');
    assert.equal(went, 'I watch quietly.');
    await pass(walk, 1000);
    assert.equal(stored(walk, 'live').ready, ready);
    assert.equal(armsTo(walk, tab).at(-1).ready, ready);
});

const DM_KEY = FakeScribeWorker.Key;
const CLOUD_ROOM = '/rooms/harbour';
const SYNCED = Object.freeze(['settings', 'book', 'live']);

/**
 * @param {FakeStorage} storage
 * @param {string} kind
 * @return {string|null}
 */
function localText(storage, kind) {
    return REFERENCE.ScribeStore.snapshot(storage, ROOM, kind)?.text ?? null;
}

/**
 * @param {object} walk
 * @param {FakeStorage} storage
 * @return {boolean}
 */
function inWorker(walk, storage) {
    return SYNCED.every((kind) => localText(storage, kind) !== null && walk.worker.textOf(CLOUD_ROOM, kind) === localText(storage, kind));
}

/**
 * @param {object} walk
 * @return {Promise<WholeTab>}
 */
async function adoptedInWorker(walk) {
    const tab = await opened(walk);
    tab.setDmKey(DM_KEY);
    assert.deepEqual(tab.prompts, ['Enter DM API key']);
    assert.deepEqual(tab.alerts, []);
    await until(walk, 'PC A to hold the lease', () => walk.worker.leases.get(CLOUD_ROOM)?.browser.startsWith('tab-1-') === true, TICK_MS);
    await until(walk, 'the chat to be pulled again', () => tab.panel.headline().startsWith('No book for this chat yet'), 15000);
    await saveKey(walk, tab);
    await adopt(walk, tab, '2');
    await until(walk, "PC A's book, settings and live to reach the Worker", () => inWorker(walk, walk.storage), TICK_MS * 3);
    await until(
        walk,
        "PC A's spending to reach the Worker",
        () => walk.worker.spentOf(CLOUD_ROOM, dayOf(walk), 'nobody').sum === spentToday(walk),
        TICK_MS * 3,
    );
    return tab;
}

/**
 * @param {object} walk
 * @return {string}
 */
function dayOf(walk) {
    const date = new Date(walk.clock.now());
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part) => String(part).padStart(2, '0')).join('-');
}

/**
 * @param {object} walk
 * @param {FakeStorage} storage
 * @return {WholeTab}
 */
function otherPc(walk, storage) {
    REFERENCE.ScribeStore.setCloudKey(storage, DM_KEY);
    return install(walk, CHAT, WIDE, { storage, locks: new FakeLocks() });
}

test('C1. two PCs, one book: the second PC opens what the first read and reads nothing again', async () => {
    const walk = world();
    const tab = await adoptedInWorker(walk);
    assert.equal(walk.model.by(tab.name).filter((call) => call.role === 'Story').length > 0, true);
    assert.equal(spentToday(walk) > 0, true);
    const storageB = new FakeStorage();
    const second = otherPc(walk, storageB);
    await second.openPage();
    second.ready();
    await until(walk, 'PC B to say another PC reads', () => second.panel.headline() === 'Another PC is reading this chat.', 15000);
    assert.equal(walk.model.by(second.name).length, 0);
    for (const kind of SYNCED) {
        assert.equal(localText(storageB, kind), localText(walk.storage, kind), kind);
    }
    assert.equal(second.panel.spend(), `$${spentToday(walk).toFixed(4)} today`);
    assert.equal(tab.panel.headline().startsWith('Up to date'), true);
    const before = walk.model.calls.length;
    tab.unload();
    await pass(walk, 60000);
    assert.equal(second.panel.headline(), 'Another PC is reading this chat.');
    await until(walk, 'PC B to take the lease and read', () => second.panel.headline().startsWith('Up to date'), 60000);
    assert.equal(second.panel.headline(), 'Up to date: 91 of 91 read.');
    assert.equal(walk.worker.leases.get(CLOUD_ROOM).browser.startsWith('tab-2-'), true);
    await quiet(walk, 'PC B after taking over');
    assert.deepEqual(rolesSince(walk, before), []);
    assert.equal(localText(storageB, 'book'), localText(walk.storage, 'book'));
    assert.deepEqual(second.alerts, []);
});

test('C2. offline and back: the second PC works offline at 15 s and its unsent work goes up', async () => {
    const walk = world();
    const tab = await adoptedInWorker(walk);
    tab.unload();
    await pass(walk, 91000);
    const storageB = new FakeStorage();
    const second = otherPc(walk, storageB);
    second.cut = true;
    await second.openPage();
    second.ready();
    await until(walk, 'PC B to load from the Worker', () => second.panel.headline() === 'Loading the book from your Worker...', 5000);
    await until(walk, 'PC B to work offline', () => second.panel.text('scribe-problems').includes('working offline'), 16000);
    await until(
        walk,
        'PC B to pull the chat offline',
        () => second.panel.headline() === 'No book for this chat yet: 91 messages.' && second.panel.text('scribe-problems').includes('working offline'),
        15000,
    );
    second.panel.tab('Settings');
    second.panel.type('scribe-setting-budget', '5');
    second.panel.click('scribe-save-settings');
    await settle();
    assert.equal(stored({ storage: storageB }, 'settings').budget, 5);
    assert.equal(second.unanswered > 0, true);
    const before = walk.model.calls.length;
    second.cut = false;
    await until(walk, "PC B's settings to go up", () => walk.worker.textOf(CLOUD_ROOM, 'settings') === localText(storageB, 'settings'), TICK_MS * 4);
    await until(walk, 'PC B to read the book from the Worker', () => second.panel.headline().startsWith('Up to date'), TICK_MS * 4);
    assert.equal(second.panel.headline(), 'Up to date: 91 of 91 read.');
    assert.equal(localText(storageB, 'book'), walk.worker.textOf(CLOUD_ROOM, 'book'));
    assert.equal(JSON.parse(walk.worker.textOf(CLOUD_ROOM, 'settings')).budget, 5);
    await quiet(walk, 'PC B back online');
    assert.equal(rolesSince(walk, before).includes('Story'), false);
});

test('C3. offline and back: a book read on both PCs asks which to keep', async () => {
    const walk = world();
    const tab = await adoptedInWorker(walk);
    const storageB = new FakeStorage();
    const second = otherPc(walk, storageB);
    second.cut = true;
    await second.openPage();
    second.ready();
    await until(
        walk,
        'PC B to pull the chat offline',
        () => second.panel.headline() === 'No book for this chat yet: 91 messages.' && second.panel.text('scribe-problems').includes('working offline'),
        40000,
    );
    await saveKey(walk, second);
    second.panel.tab('Settings');
    second.panel.type('scribe-setting-size', '40');
    second.panel.type('scribe-setting-budget', '2');
    second.panel.click('scribe-next');
    await until(walk, 'PC B to read its own book offline', () => second.panel.headline().startsWith('Up to date'), 30000);
    await quiet(walk, 'PC B after its own reading');
    assert.equal(walk.model.by(second.name).filter((call) => call.role === 'Story').length > 0, true);
    assert.notEqual(localText(storageB, 'book'), localText(walk.storage, 'book'));
    second.cut = false;
    await until(
        walk,
        'PC B to ask which book to keep',
        () => second.panel.headline() === 'This PC and your Worker hold different books for this chat.',
        TICK_MS * 4,
    );
    assert.equal(second.panel.byId('scribe-choice').hidden, false);
    assert.equal(second.panel.text('scribe-choice-counts'), 'This PC: 91 messages read. Your Worker: 91 messages read.');
    assert.equal(tab.panel.headline().startsWith('Up to date'), true);
    const cloudBook = walk.worker.textOf(CLOUD_ROOM, 'book');
    second.panel.click('scribe-keep-here');
    await settle();
    assert.equal(
        second.panel.text('scribe-choice-outcome'),
        "Another PC is reading this chat; this PC's book is kept as soon as it lets go.",
    );
    assert.equal(walk.worker.textOf(CLOUD_ROOM, 'book'), cloudBook);
    second.panel.click('scribe-use-cloud');
    await until(walk, "PC B to take the Worker's book", () => second.panel.headline() === 'Another PC is reading this chat.', TICK_MS);
    assert.equal(localText(storageB, 'book'), cloudBook);
    assert.equal(second.panel.byId('scribe-choice').hidden, true);
});

test('an empty Findings click reports a refused request save and leaves the next send bare', async () => {
    const walk = world();
    const tab = await opened(walk);
    await saveKey(walk, tab);
    await adopt(walk, tab, '2');
    tab.panel.tab('Findings');
    assert.equal(tab.panel.byId('scribe-reminder').value, '');
    walk.storage.refuseSetsMatching(/live/);
    tab.panel.click('scribe-force');
    await settle();
    assert.match(tab.panel.text('scribe-force-outcome'), /storage|save|write/i);
    assert.equal(tab.panel.byId('scribe-reminder').value, '');
    assert.equal(stored(walk, 'live').forced, false);
    assert.equal(stored(walk, 'live').ready, null);
    walk.storage.allow();
    assert.equal(await send(walk, tab, 'I wait.'), 'I wait.');
});

test('Cancel and Save replace an obsolete Force validation with the queued status', async () => {
    const { walk, tab } = await adopted();
    tab.panel.tab('Findings');
    tab.panel.click('scribe-force');
    await settle();
    const first = stored(walk, 'live').selection;
    tab.panel.click('scribe-edit');
    tab.panel.type('scribe-reminder', 'A different choice');
    walk.storage.refuseSetsMatching(/live/);
    tab.panel.click('scribe-force');
    await settle();
    const refused = tab.panel.text('scribe-force-outcome');
    assert.match(refused, /storage|save|write/i);
    tab.panel.click('scribe-edit-cancel');
    await settle();
    assert.equal(tab.panel.text('scribe-force-outcome'), refused);
    walk.storage.allow();
    for (const action of ['scribe-edit-cancel', 'scribe-edit-save']) {
        tab.panel.click('scribe-edit');
        tab.panel.type('scribe-reminder', ' ');
        tab.panel.click('scribe-force');
        await settle();
        assert.match(tab.panel.text('scribe-force-outcome'), /Enter a reminder/);
        if (action === 'scribe-edit-save') {
            tab.panel.type('scribe-reminder', 'A revised choice');
        }
        tab.panel.click(action);
        await settle();
        assert.equal(tab.panel.text('scribe-force-outcome'), 'Queued for your next message');
        const selected = stored(walk, 'live').selection;
        if (action === 'scribe-edit-save') {
            assert.equal(selected.text, 'A revised choice');
            assert.notEqual(selected.id, first.id);
        } else {
            assert.equal(selected.id, first.id);
        }
    }
});

test('Findings keeps an unsaved choice across a newer writer result, reload and a room switch', async () => {
    const { walk, tab } = await adopted();
    const chosen = '[Scribe] <ledger>  open\nby the quay 雪';
    tab.panel.tab('Findings');
    tab.panel.click('scribe-edit');
    tab.panel.type('scribe-reminder', chosen);
    tab.panel.click('scribe-force');
    await settle();
    const selected = plain(stored(walk, 'live').selection);
    assert.equal(selected.text, chosen);
    tab.panel.click('scribe-edit');
    for (const invalid of ['   ', '@: [Scribe]', '\u0085', '\u200B', '[Scribe] [Scribe]', 'x'.repeat(3001)]) {
        tab.panel.type('scribe-reminder', invalid);
        tab.panel.click('scribe-force');
        await settle();
        assert.match(tab.panel.text('scribe-force-outcome'), /Enter a reminder|3,000 characters/);
        assert.equal(tab.panel.byId('scribe-reminder').readOnly, false);
        assert.deepEqual(plain(stored(walk, 'live').selection), selected);
    }
    tab.panel.click('scribe-edit-cancel');
    assert.equal(tab.panel.byId('scribe-reminder').value, chosen);
    const reply = walk.site.reply(CALM_REPLY);
    await until(walk, 'the newer reply to be checked', () => stored(walk, 'live').now?.message === reply.id, TICK_MS * 2);
    await quiet(walk, 'after the newer writer result');
    assert.notEqual(stored(walk, 'live').ready, chosen);
    assert.equal(tab.panel.byId('scribe-reminder').value, chosen);
    const fresh = await reload(walk, tab);
    fresh.panel.tab('Findings');
    assert.equal(fresh.panel.byId('scribe-reminder').value, chosen);
    assert.deepEqual(plain(stored(walk, 'live').selection), selected);
    walk.site.open(QUARRY, campaign(QUARRY_LENGTH));
    fresh.go(`/rooms/${QUARRY}`);
    await fresh.openPage();
    await until(walk, 'the other room to open', () => fresh.panel.headline().startsWith('No book for this chat yet'), TICK_MS * 2);
    assert.equal(await send(walk, fresh, 'I wait here.'), 'I wait here.');
    assert.deepEqual(plain(stored(walk, 'live').selection), selected);
});

test('F8. the old layout, the chat box in the top document, still works', async () => {
    const { walk, tab } = await replied('2', { layout: 'top' });
    assert.equal(tab.frame, null);
    assert.equal(tab.iframe, null);
    assert.equal(walk.posts.length, 0);
    const ready = stored(walk, 'live').ready;
    const posts = posted(walk);
    const went = await send(walk, tab, 'I nod.');
    assert.equal(went, `I nod.\n@: ${ready}`);
    const sent = walk.site.requests.filter((request) => request.method === 'POST').slice(posts);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].origin, TOP_ORIGIN);
    assert.equal(stored(walk, 'live').ready, null);
    assert.deepEqual(plain(stored(walk, 'live').findings.map((finding) => finding.status)), ['Reminded']);
});

for (const layout of ['frame', 'top']) {
    test(`D1. through the ${layout} path a forced reminder clears with its one send, and the next send carries nothing`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        const ready = stored(walk, 'live').ready;
        assert.equal(stored(walk, 'live').forced, true);
        assert.deepEqual(queued(tab), [`Reminder: ${ready}`]);
        assert.equal(await send(walk, tab, 'I step forward.'), `I step forward.\n@: ${ready}`);
        await quiet(walk, 'after the reminder went');
        const live = stored(walk, 'live');
        assert.equal(live.ready, null);
        assert.equal(live.forced, false);
        assert.equal(live.edited, null);
        assert.equal(live.delivery, null);
        assert.equal(live.sends, 0);
        assert.deepEqual(queued(tab), []);
        assert.equal(tab.panel.byId('scribe-reminder').value, '');
        assert.equal(await send(walk, tab, 'I step again.'), 'I step again.');
        assert.equal(stored(walk, 'live').sends, 1);
    });

    test(`D2. through the ${layout} path Enter and a press on Send together deliver the reminder once`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        const ready = stored(walk, 'live').ready;
        const before = tab.sent.length;
        tab.type('I step forward.');
        tab.press('Send', true);
        tab.enter();
        await pass(walk, 2000);
        assert.equal(tab.sent.length, before + 1);
        assert.equal(tab.sent.at(-1), `I step forward.\n@: ${ready}`);
        assert.equal(tab.sent.at(-1).split('\n@: [Scribe] ').length - 1, 1);
        assert.equal(stored(walk, 'live').sends, 0);
        assert.equal(stored(walk, 'live').ready, null);
        assert.equal(await send(walk, tab, 'I step again.'), 'I step again.');
    });

    for (const interval of [6, 8, 10]) {
        test(`D3. the ${layout} path delivers exactly on sends ${interval} and ${2 * interval} across a reload`, async () => {
            const walk = world({ layout });
            let tab = await opened(walk);
            await saveKey(walk, tab);
            tab.panel.tab('Settings');
            tab.panel.type('scribe-setting-refresh', String(interval));
            await adopt(walk, tab, '5');
            const beginning = walk.site.messages.length;
            for (let turn = 1; turn <= 2 * interval + 1; turn++) {
                if (turn === interval + 2) {
                    tab = await reload(walk, tab);
                }
                const text = `I watch the market, turn ${turn}.`;
                const sent = await send(walk, tab, text);
                const due = turn % interval === 0;
                if (due) {
                    assert.ok(sent.startsWith(`${text}\n@: [Scribe] The story so far:`), sent);
                } else {
                    assert.equal(sent, text);
                }
                assert.equal(stored(walk, 'live').sends, turn % interval, `after send ${turn}`);
                if ((turn + 1) % interval === 0) {
                    const reply = walk.site.reply(CALM_REPLY);
                    await until(
                        walk,
                        `the reminder for send ${turn + 1}`,
                        () => stored(walk, 'live').seen?.id === reply.id && typeof stored(walk, 'live').ready === 'string',
                        TICK_MS * 2,
                    );
                }
            }
            const players = walk.site.messages.slice(beginning).filter((message) => message.sender.type === 'USER');
            assert.equal(players.length, 2 * interval + 1);
            const deliveries = players.flatMap((message, index) => message.contents[0].text.includes('[Scribe]') ? [index + 1] : []);
            assert.deepEqual(deliveries, [interval, 2 * interval]);
        });
    }

    test(`D5. the ${layout} path recovers a delivered reminder and counts two rapid player sends across reloads`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        const offer = stored(walk, 'live').delivery.id;
        const start = walk.site.messages.length;
        tab.type('I approach.');
        tab.enter();
        await pass(walk, 30);
        assert.ok(walk.site.messages[start].contents[0].text.includes('[Scribe]'));
        assert.equal(stored(walk, 'live').settled.includes(offer), false);
        const second = await reload(walk, tab);
        await until(walk, 'the accepted paragraph to clear after reload', () => stored(walk, 'live').settled.includes(offer), TICK_MS * 2);
        assert.equal(stored(walk, 'live').sends, 0);
        assert.deepEqual(queued(second), []);
        for (const text of ['I wait.', 'I listen.']) {
            second.type(text);
            second.enter();
            await pass(walk, 30);
            assert.equal(walk.site.messages.at(-1).contents[0].text, text);
        }
        const fresh = await reload(walk, second);
        const expected = REFERENCE.ScribeIntake.read(walk.site.messages).messages.slice(start)
            .map(({ id, fingerprint }) => ({ id, fingerprint }));
        assert.equal(expected.length, 3);
        await until(walk, 'both rapid player messages to count', () => stored(walk, 'live').sends === 2, TICK_MS * 2);
        assert.deepEqual(plain(stored(walk, 'live').counted.slice(-3)), plain(expected));
        await pass(walk, TICK_MS * 2);
        assert.equal(stored(walk, 'live').sends, 2);
        assert.equal(await send(walk, fresh, 'I turn around.'), 'I turn around.');
        assert.equal(stored(walk, 'live').sends, 3);
    });

    test(`D6. the ${layout} path offers the same reminder after a refused send, withdrawal, and reload`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        const { ready, delivery } = stored(walk, 'live');
        const before = walk.site.messages.length;
        tab.refusing = true;
        tab.type('I listen.');
        tab.enter();
        await pass(walk, 3000);
        assert.ok(tab.refused > 0);
        assert.equal(walk.site.messages.length, before);
        assert.equal(tab.box.value, 'I listen.');
        const fresh = await reload(walk, tab);
        assert.equal(stored(walk, 'live').delivery.id, delivery.id);
        assert.equal(await send(walk, fresh, 'I try again.'), `I try again.\n@: ${ready}`);
        assert.equal(walk.site.messages.length, before + 1);
        assert.equal(stored(walk, 'live').sends, 0);
        assert.equal(stored(walk, 'live').ready, null);
    });

    test(`D7. a manual reminder on send 3 moves the next ${layout} reminder to send 11`, async () => {
        const walk = world({ layout });
        const tab = await opened(walk);
        await saveKey(walk, tab);
        tab.panel.tab('Settings');
        tab.panel.type('scribe-setting-refresh', '8');
        await adopt(walk, tab, '7');
        assert.equal(await send(walk, tab, 'I look around.'), 'I look around.');
        assert.equal(await send(walk, tab, 'I wait.'), 'I wait.');
        assert.equal(stored(walk, 'live').sends, 2);
        await forceReminder(walk, tab);
        assert.equal(await send(walk, tab, 'I nod.'), `I nod.\n@: ${FIRST_READY}`);
        const fresh = await reload(walk, tab);
        for (let turn = 4; turn <= 10; turn++) {
            const text = `I wait, turn ${turn}.`;
            assert.equal(await send(walk, fresh, text), text);
            assert.equal(stored(walk, 'live').sends, turn - 3);
        }
        const reply = walk.site.reply(CALM_REPLY);
        await until(
            walk,
            'the reminder for send 11',
            () => stored(walk, 'live').seen?.id === reply.id && typeof stored(walk, 'live').ready === 'string',
            TICK_MS * 2,
        );
        const ready = stored(walk, 'live').ready;
        assert.equal(await send(walk, fresh, 'I step forward.'), `I step forward.\n@: ${ready}`);
        assert.equal(stored(walk, 'live').sends, 0);
        assert.equal(await send(walk, fresh, 'I wait again.'), 'I wait again.');
    });

    test(`D8. the ${layout} acknowledgement preserves a sentence added to the sent reminder`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        const first = '[Scribe] Mirelle opens the ledger and examines the figures.';
        const newer = `${first} Halvard listens at the door.`;
        tab.panel.tab('Findings');
        tab.panel.click('scribe-edit');
        tab.panel.type('scribe-reminder', first);
        tab.panel.click('scribe-edit-save');
        await pass(walk, 500);
        tab.type('I wait.');
        tab.enter();
        await pass(walk, 30);
        assert.equal(walk.site.messages.at(-1).contents[0].text, `I wait.\n@: ${first}`);
        tab.panel.click('scribe-edit');
        tab.panel.type('scribe-reminder', newer);
        tab.panel.click('scribe-edit-save');
        await settle();
        assert.equal(stored(walk, 'live').edited, newer);
        await pass(walk, 1000);
        assert.equal(stored(walk, 'live').draft, newer);
        assert.equal(stored(walk, 'live').ready, null);
        assert.equal(await send(walk, tab, 'I keep watch.'), 'I keep watch.');
    });

    test(`D9. the ${layout} recovery requires the entire carried paragraph on the player message`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        const { ready, delivery } = stored(walk, 'live');
        const prefix = ready.slice(0, ready.indexOf('. ') + 1);
        assert.ok(prefix.length > '[Scribe]'.length && prefix.length < ready.length);
        tab.type('I search the room.');
        tab.enter();
        await pass(walk, 30);
        assert.equal(walk.site.messages.at(-1).contents[0].text, `I search the room.\n@: ${ready}`);
        walk.site.edit(walk.site.messages.length, `I search the room.\n@: ${prefix}`);
        const fresh = await reload(walk, tab);
        await until(walk, 'the player message with a different block to count', () => stored(walk, 'live').sends === 1, TICK_MS * 2);
        assert.equal(stored(walk, 'live').delivery.id, delivery.id);
        assert.equal(stored(walk, 'live').forced, true);
        assert.equal(stored(walk, 'live').settled.includes(delivery.id), false);
        await until(walk, 'the changed player row to be saved and the offer rearmed', () =>
            Object.hasOwn(stored(walk, 'book').log.read, walk.site.messages.at(-1).id) && queued(fresh).includes(`Reminder: ${ready}`), TICK_MS * 2);
        assert.equal(await send(walk, fresh, 'I wait.'), `I wait.\n@: ${ready}`);
        assert.equal(stored(walk, 'live').sends, 0);
    });

    test(`D10. reloading before the ${layout} submission counts only the next accepted send`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        const start = walk.site.messages.length;
        const offer = stored(walk, 'live').delivery.id;
        tab.type('First.');
        tab.enter();
        await pass(walk, 1);
        assert.equal(walk.site.messages.length, start);
        const fresh = await reload(walk, tab);
        assert.equal(await send(walk, fresh, 'Second.'), 'Second.');
        await pass(walk, 2 * TICK_MS);
        assert.equal(walk.site.messages.length, start + 1);
        const saved = stored(walk, 'live');
        assert.equal(saved.sends, 1);
        assert.deepEqual(plain(saved.counted), playerReceipts(walk, start));
        assert.deepEqual(plain(saved.posts), []);
        assert.equal(saved.delivery.id, offer);
        assert.equal(saved.settled.includes(offer), false);
    });

    for (const [splitPolls, sameBody] of [[false, false], [true, false], [false, true], [true, true]]) {
        const timing = splitPolls ? 'separate polls' : 'one poll';
        const wording = sameBody ? 'identical' : 'different';
        test(`D11. the ${layout} path finds its reminder after a second device uses ${wording} player text in ${timing}`, async () => {
            const { walk, tab } = await adopted('2', { layout });
            const { ready, delivery } = stored(walk, 'live');
            const start = walk.site.messages.length;
            await tab.pagePost(sameBody ? 'I wait.' : 'A message from a second device.');
            tab.type('I wait.');
            tab.enter();
            await pass(walk, 30);
            assert.equal(walk.site.messages.length, start + 2);
            assert.equal(walk.site.messages.at(-1).contents[0].text, `I wait.\n@: ${ready}`);
            assert.equal(stored(walk, 'live').settled.includes(delivery.id), false);
            const api = walk.site.rooms.get(ROOM).zeta;
            if (splitPolls) {
                api.messages = walk.site.messages.slice(0, start + 1);
            }
            const fresh = await reload(walk, tab);
            if (splitPolls) {
                await pass(walk, 2 * TICK_MS);
                assert.equal(stored(walk, 'campaign').messages.length, start + 1);
                assert.equal(stored(walk, 'live').sends, 1);
                assert.equal(stored(walk, 'live').settled.includes(delivery.id), false);
                assert.equal(await send(walk, fresh, 'I listen while the history is catching up.'), 'I listen while the history is catching up.');
                assert.equal(walk.site.messages.length, start + 3);
                api.messages = walk.site.messages;
            }
            await pass(walk, 2 * TICK_MS);
            const delivered = stored(walk, 'live');
            assert.equal(delivered.sends, splitPolls ? 1 : 0);
            assert.deepEqual(plain(delivered.settled), [delivery.id]);
            assert.deepEqual(plain(delivered.counted), playerReceipts(walk, start));
            assert.equal(await send(walk, fresh, 'Once more.'), 'Once more.');
            await pass(walk, 2 * TICK_MS);
            assert.equal(stored(walk, 'live').sends, splitPolls ? 2 : 1);
            assert.deepEqual(plain(stored(walk, 'live').counted), playerReceipts(walk, start));
        });
    }
}

for (const layout of ['top', 'frame']) {
    test(`D13. the ${layout} counter binds a confirmed ordinary send to its edited history row`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        const start = walk.site.messages.length;
        await send(walk, tab, 'First.');
        await pass(walk, 2 * TICK_MS);
        const api = walk.site.rooms.get(ROOM).zeta;
        api.messages = walk.site.messages.slice();
        tab.type('I stand.');
        tab.enter();
        await pass(walk, 200);
        assert.equal(stored(walk, 'live').sends, 1);
        assert.equal(stored(walk, 'live').posts.at(-1).confirmed, true);
        walk.site.edit(start + 2, 'I stood.');
        api.messages = walk.site.messages;
        await pass(walk, 2 * TICK_MS);
        await reload(walk, tab);
        await pass(walk, 2 * TICK_MS);
        const live = stored(walk, 'live');
        assert.equal(live.sends, 1);
        assert.deepEqual(plain(live.posts), []);
        assert.deepEqual(plain(live.counted), playerReceipts(walk, start));
    });
}

for (const layout of ['top', 'frame']) {
    test(`D13. two identical ${layout} sends have two receipts when the first is edited before the poll`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        const start = walk.site.messages.length;
        await send(walk, tab, 'First.');
        await pass(walk, 2 * TICK_MS);
        const api = walk.site.rooms.get(ROOM).zeta;
        api.messages = walk.site.messages.slice();
        for (let turn = 0; turn < 2; turn++) {
            assert.equal(await send(walk, tab, 'I stand.'), 'I stand.');
        }
        assert.equal(stored(walk, 'live').sends, 2);
        walk.site.edit(start + 2, 'I stood.');
        api.messages = walk.site.messages;
        await pass(walk, 2 * TICK_MS);
        await reload(walk, tab);
        await pass(walk, 2 * TICK_MS);
        const live = stored(walk, 'live');
        assert.equal(live.sends, 2);
        assert.deepEqual(plain(live.posts), []);
        assert.deepEqual(plain(live.counted), playerReceipts(walk, start));
    });
}

/**
 * @param {WholeTab} tab
 * @param {string} text
 * @return {Promise<void>}
 */
async function queueSelection(tab, text) {
    tab.panel.tab('Findings');
    tab.panel.click('scribe-edit');
    tab.panel.type('scribe-reminder', text);
    tab.panel.click('scribe-force');
    await settle();
}

test('a manual frame send requires click or Enter after a cancelled or abandoned pointer gesture', async () => {
    const { walk, tab } = await adopted('2', { layout: 'frame' });
    await queueSelection(tab, 'Keep.');
    tab.type('Still my draft.');
    const first = walk.site.messages.length;
    for (const end of ['pointercancel', 'pointerup']) {
        tab.chatWindow.dispatch(tab.icon, 'pointerdown', {});
        await pass(walk, 100);
        tab.chatWindow.dispatch(end === 'pointercancel' ? tab.icon : tab.box, end, {});
        await pass(walk, 2000);
        assert.equal(walk.site.messages.length, first);
        assert.equal(tab.box.value, 'Still my draft.');
        assert.equal(stored(walk, 'live').posts.length, 0);
        assert.equal(stored(walk, 'live').selection.text, 'Keep.');
    }
    tab.chatWindow.dispatch(tab.icon, 'click', {});
    tab.chatWindow.dispatch(tab.icon, 'click', {});
    await pass(walk, 2000);
    assert.equal(walk.site.messages.length, first + 1);
    assert.equal(walk.site.messages.at(-1).contents[0].text, 'Still my draft.\n@: [Scribe] Keep.');
    assert.equal(stored(walk, 'live').selection, null);
});

test('a frame reservation abandoned by an input change sends nothing and retains the chosen reminder', async () => {
    const { walk, tab } = await adopted('2', { layout: 'frame' });
    await queueSelection(tab, 'Keep.');
    const before = walk.site.messages.length;
    tab.type('Original.');
    tab.enter();
    tab.type('My new message.');
    await pass(walk, 2000);
    assert.equal(tab.box.value, 'My new message.');
    assert.equal(walk.site.messages.length, before);
    assert.equal(stored(walk, 'live').posts.length, 0);
    assert.equal(stored(walk, 'live').selection.text, 'Keep.');
    assert.equal(await send(walk, tab, 'My new message.'), 'My new message.\n@: [Scribe] Keep.');
});

test('a lost frame grant sends bare text only for an activated click and an edited reservation can be replaced immediately', async () => {
    const { walk, tab } = await adopted('2', { layout: 'frame' });
    await queueSelection(tab, 'Keep.');
    const before = walk.site.messages.length;
    const receive = tab.chatWindow.receive.bind(tab.chatWindow);
    tab.chatWindow.receive = (event) => {
        if (event.data?.kind !== 'reserved') {
            receive(event);
        }
    };
    tab.type('Do not send.');
    tab.chatWindow.dispatch(tab.icon, 'pointerdown', {});
    await pass(walk, 2000);
    assert.equal(walk.site.messages.length, before);
    tab.chatWindow.dispatch(tab.icon, 'click', {});
    tab.type('My actual click.');
    tab.chatWindow.dispatch(tab.icon, 'click', {});
    await pass(walk, 3000);
    assert.equal(walk.site.messages.length, before + 1);
    assert.equal(walk.site.messages.at(-1).contents[0].text, 'My actual click.');
    assert.equal(stored(walk, 'live').selection.text, 'Keep.');
    tab.chatWindow.receive = receive;
    assert.equal(await send(walk, tab, 'Once.'), 'Once.\n@: [Scribe] Keep.');
});

for (const layout of ['top', 'frame']) {
    test(`a later unique ${layout} history row settles while an older receipt is ambiguous after reload`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        await queueSelection(tab, 'Keep.');
        const pending = [];
        const respond = walk.site.respond.bind(walk.site);
        walk.site.respond = (receiver, url, options) => url === WholeSite.Messages && options?.method === 'POST'
            ? new Promise((resolve) => pending.push({ receiver, url, options, resolve })) : respond(receiver, url, options);
        assert.equal(await send(walk, tab, 'Go.'), 'Go.\n@: [Scribe] Keep.');
        tab.panel.click('scribe-force');
        await settle();
        for (const text of ['Changed.', 'Keep.']) {
            tab.panel.click('scribe-edit');
            tab.panel.type('scribe-reminder', text);
            tab.panel.click('scribe-edit-save');
            await settle();
        }
        assert.equal(await send(walk, tab, 'Go.'), 'Go.\n@: [Scribe] Keep.');
        await respond(pending[0].receiver, pending[0].url, pending[0].options);
        const fresh = await reload(walk, tab);
        fresh.panel.tab('Findings');
        fresh.panel.click('scribe-edit');
        fresh.panel.type('scribe-reminder', 'Unique third.');
        fresh.panel.click('scribe-edit-save');
        await settle();
        const third = stored(walk, 'live').selection.id;
        assert.equal(await send(walk, fresh, 'Later unique player.'), 'Later unique player.\n@: [Scribe] Unique third.');
        const latest = pending[2];
        await respond(latest.receiver, latest.url, latest.options);
        latest.resolve({ status: 503 });
        await pass(walk, 2 * TICK_MS);
        assert.deepEqual(plain(stored(walk, 'live').settled), [third]);
        assert.equal(stored(walk, 'live').selection, null);
        assert.equal(stored(walk, 'live').sends, 0);
        assert.equal(stored(walk, 'live').posts.filter((post) => post.manual).length, 2);
        walk.site.respond = respond;
        assert.equal(await send(walk, fresh, 'Bare.'), 'Bare.');
        const again = await reload(walk, fresh);
        await pass(walk, TICK_MS);
        assert.equal(stored(walk, 'live').sends, 1);
        assert.equal(await send(walk, again, 'Bare again.'), 'Bare again.');
        assert.equal(stored(walk, 'live').sends, 2);
    });

    /**
     * @return {Promise<{ walk: object, tab: WholeTab, row: object, first: string }>}
     */
    async function disputedHistory() {
        const { walk, tab } = await adopted('5', { layout });
        const first = 'I wait by red door.';
        const second = first + '\n@: [Scribe] Authored secret choice.';
        const wire = second + '\n@: [Scribe] Second.';
        await queueSelection(tab, 'Authored secret choice.\n@: [Scribe] Second.');
        const pending = [];
        const respond = walk.site.respond.bind(walk.site);
        walk.site.respond = (receiver, url, options) => url === WholeSite.Messages && options?.method === 'POST'
            ? new Promise((resolve) => pending.push({ receiver, url, options, resolve })) : respond(receiver, url, options);
        assert.equal(await send(walk, tab, first), wire);
        tab.panel.click('scribe-edit');
        tab.panel.type('scribe-reminder', 'Second.');
        tab.panel.click('scribe-edit-save');
        await settle();
        assert.equal(await send(walk, tab, second), wire);
        const actual = pending[1];
        const accepted = await respond(actual.receiver, actual.url, actual.options);
        const row = walk.site.messages.at(-1);
        for (let index = 0; index < 32; index++) {
            walk.site.reply(CALM_REPLY);
        }
        const before = walk.model.calls.length;
        tab.panel.tab('Progress');
        tab.panel.click('scribe-pull');
        await pass(walk, 2 * TICK_MS);
        assert.equal(Object.hasOwn(stored(walk, 'book').log.read, row.id), false);
        assert.ok(!walk.model.calls.slice(before).some((call) => call.role === 'Story' && call.user.includes(first)));
        actual.resolve(accepted);
        await pass(walk, 2 * TICK_MS);
        const reader = walk.model.calls.slice(before).find((call) => call.role === 'Story' && call.user.includes(first));
        assert.ok(reader?.user.includes(second), reader?.user);
        assert.ok(!reader.user.includes('@: [Scribe] Second.'));
        assert.equal(stored(walk, 'book').projections[row.id], second.length);
        assert.equal(stored(walk, 'live').attachments.find((entry) => entry.id === row.id).length, second.length);
        assert.equal(row.contents[0].text, wire);
        const fingerprint = stored(walk, 'book').fingerprints[row.id];
        const rival = pending[0];
        rival.resolve(await respond(rival.receiver, rival.url, rival.options));
        await pass(walk, 2 * TICK_MS);
        assert.equal(stored(walk, 'live').attachments.find((entry) => entry.id === row.id).contested, true);
        assert.equal(Object.hasOwn(stored(walk, 'book').log.read, row.id), false);
        assert.equal(REFERENCE.ScribeIntake.read(walk.site.messages).messages.find((message) => message.id === row.id).fingerprint, fingerprint);
        return { walk, tab, row, first };
    }

    test(`different ${layout} authored boundaries wait for an identified receipt before Keeper files the passage`, async () => {
        const { walk, tab, row, first } = await disputedHistory();
        const fresh = await reload(walk, tab);
        const disputed = [row, walk.site.messages.at(-1)];
        const positions = disputed.map((message) => walk.site.messages.indexOf(message) + 1);
        assert.deepEqual(positions, [92, 125]);
        const baseline = walk.model.calls.length;
        const later = [];
        for (let index = 1; index <= 65; index++) {
            later.push(walk.site.reply([['Narrator', `The public ledger contains later entry ${index}.`]]));
        }
        fresh.panel.tab('Progress');
        fresh.panel.click('scribe-pull');
        await pass(walk, 4 * TICK_MS);
        const calls = walk.model.calls.slice(baseline).filter((call) => call.role === 'Story');
        const newBatches = calls.filter((call) => call.user.includes('The public ledger contains later entry'));
        assert.deepEqual(newBatches.map((call) => rangeOf(call.user)), ['126-155', '156-185', '186-190']);
        for (const call of calls) {
            assert.ok(!call.user.includes(first) && !call.user.includes('Authored secret choice.'), call.user);
        }
        const book = stored(walk, 'book');
        const ids = later.map((message) => message.id);
        for (const message of later) {
            assert.equal(Object.hasOwn(book.log.read, message.id), ids.includes(message.id));
            assert.equal(Object.hasOwn(book.fingerprints, message.id), ids.includes(message.id));
        }
        for (const message of disputed) {
            assert.ok(!Object.hasOwn(book.log.read, message.id));
        }
        assert.equal(fresh.panel.headline(), 'Unresolved authorship: 188 of 190 read.');
        assert.match(fresh.panel.text('scribe-counts'), /2 unread messages have unresolved authorship/);
        assert.deepEqual(fresh.panel.rowTexts('disputed'), ['Player message #92', 'Player message #125']);
        const counted = walk.model.calls.length;
        const charged = spentToday(walk);
        const reopened = await reload(walk, fresh);
        reopened.panel.tab('Progress');
        await pass(walk, 4 * TICK_MS);
        assert.deepEqual(rolesSince(walk, counted), []);
        assert.equal(spentToday(walk), charged);
        assert.deepEqual(plain(stored(walk, 'book').log.read), plain(book.log.read));
        assert.deepEqual(reopened.panel.rowTexts('disputed'), ['Player message #92', 'Player message #125']);
        const corrected = 'I wrote the corrected account myself.';
        walk.site.edit(positions[0], corrected);
        reopened.panel.click('scribe-pull');
        await pass(walk, 4 * TICK_MS);
        const repaired = walk.model.calls.slice(counted).filter((call) => call.role === 'Story');
        assert.deepEqual(repaired.map((call) => rangeOf(call.user)), ['92-92']);
        assert.ok(repaired[0].user.includes(corrected));
        assert.deepEqual(reopened.panel.rowTexts('disputed'), ['Player message #125']);
        assert.equal(reopened.panel.headline(), 'Unresolved authorship: 189 of 190 read.');
        assert.match(reopened.panel.text('scribe-counts'), /1 unread message has unresolved authorship/);
        const saved = stored(walk, 'book').log.read;
        assert.ok(Object.hasOwn(saved, row.id));
        assert.ok(!Object.hasOwn(saved, disputed[1].id));
        for (const id of ids) {
            assert.equal(saved[id], book.log.read[id]);
        }
    });

    /**
     * @param {boolean} sameWording
     * @return {Promise<void>}
     */
    async function fileAnsweredPair(sameWording) {
        const { walk, tab } = await disputedHistory();
        const { ScribeIntake, ScribeLog, ScribeReplay, ScribeStore } = REFERENCE;
        const rows = ScribeIntake.read(walk.site.messages, stored(walk, 'live')).messages;
        assert.equal(rows.length, 125);
        assert.ok(!rows[92].attributionPending);
        assert.equal(rows[124].attributionPending, true);
        const questions = [
            { type: 'Question', text: 'What is the weather at the quay?', position: 93 },
            { type: 'Question', text: sameWording ? 'What is the weather at the quay?' : 'When does the ferry depart?', position: 125 },
        ];
        const answers = ['The weather is clear.', 'The ferry departs at sunset.'];
        const book = stored(walk, 'book');
        const order = rows.map((row) => row.id);
        const replay = () => ScribeReplay.run(book.log, order);
        const original = ScribeIntake.read(walk.site.messages).messages;
        const result = ScribeLog.append(book.log, replay(), questions, {
            origin: 'Notes', messages: [original[92], original[124]],
        });
        assert.equal(result.entry.operations.length, 2);
        const disputedFact = 'keeps an uncertified harbour ledger';
        ScribeLog.append(book.log, replay(), REFERENCE.ScribeAnswer.parse(
            '=== FACTS\nHalvard | trait | ' + disputedFact + ' | #125',
        ).operations, { origin: 'Notes', messages: [original[124]] });
        const ids = questions.map(({ position }) => replay().questions.find((question) => question.position === position).id);
        for (const [index, id] of ids.entries()) {
            ScribeLog.rule(book.log, replay(), { type: 'Answer', question: id, text: answers[index] });
        }
        ScribeStore.write(walk.storage, ROOM, 'book', book);
        walk.model.answers.Answers = () =>
            '=== FACTS\nHalvard | trait | observes the harbour forecast | #93\nHalvard | trait | knows the sailing schedule | #125';
        const before = walk.model.of('Answers').length;
        const requests = () => walk.model.of('Answers').slice(before).map((call) => call.user);
        const dismissed = () => ids.map((id) => bookState(walk).questions.find((question) => question.id === id).dismissed);
        const dismissedIds = () => plain(stored(walk, 'book').log.entries.flatMap((entry) => entry.operations)
            .filter((operation) => operation.type === 'Dismiss' && ids.includes(operation.question))
            .map((operation) => operation.question));
        const filed = () => plain(bookState(walk).facts.filter((fact) => fact.origin === 'Answers').map((fact) => fact.cite));
        const fresh = await reload(walk, tab);
        await pass(walk, 2 * TICK_MS);
        assert.equal(requests().length, 1);
        assert.ok(requests()[0].includes('[#93] ' + questions[0].text));
        assert.ok(requests()[0].includes(answers[0]));
        assert.ok(!requests()[0].includes(disputedFact));
        assert.ok(!requests()[0].includes('[#125]') && !requests()[0].includes(answers[1]));
        assert.ok(sameWording || !requests()[0].includes(questions[1].text));
        assert.deepEqual(dismissed(), [true, false]);
        assert.deepEqual(dismissedIds(), [ids[0]]);
        assert.deepEqual(filed(), [rows[92].id]);
        const spent = spentToday(walk);
        const reopened = await reload(walk, fresh);
        await pass(walk, 3 * TICK_MS);
        assert.equal(requests().length, 1);
        assert.equal(spentToday(walk), spent);
        assert.deepEqual(dismissed(), [true, false]);
        walk.site.edit(125, 'I wrote the ferry timetable myself.');
        reopened.panel.tab('Progress');
        reopened.panel.click('scribe-pull');
        await pass(walk, 3 * TICK_MS);
        assert.equal(requests().length, 2);
        assert.ok(requests()[1].includes('[#125] ' + questions[1].text));
        assert.ok(requests()[1].includes(answers[1]));
        assert.ok(requests()[1].includes(disputedFact));
        assert.ok(!requests()[1].includes('[#93]') && !requests()[1].includes(answers[0]));
        assert.ok(sameWording || !requests()[1].includes(questions[0].text));
        assert.deepEqual(dismissed(), [true, true]);
        assert.deepEqual(filed(), [rows[92].id, rows[124].id]);
        await reload(walk, reopened);
        await pass(walk, 2 * TICK_MS);
        assert.equal(requests().length, 2);
        assert.deepEqual(dismissedIds(), ids);
    }

    test(`Answers files #93 and leaves disputed #125 pending across ${layout} reloads until its authorship resolves`,
        () => fileAnsweredPair(false));

    test(`Answers keeps equally worded questions at #93 and disputed #125 independent across ${layout} reloads`,
        () => fileAnsweredPair(true));

    test(`a failed ${layout} attempt journal sends only the player's text and preserves the queue across reload`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        await queueSelection(tab, 'Keep this.');
        const selected = plain(stored(walk, 'live').selection);
        walk.storage.refuseSetsMatching(/live/);
        assert.equal(await send(walk, tab, 'I wait.'), 'I wait.');
        assert.equal(walk.site.messages.at(-1).contents[0].text, 'I wait.');
        assert.match(tab.panel.text('scribe-held'), /attempt could not be saved/);
        walk.storage.allow();
        const fresh = await reload(walk, tab);
        assert.deepEqual(plain(stored(walk, 'live').selection), selected);
        assert.equal(await send(walk, fresh, 'Again.'), 'Again.\n@: [Scribe] Keep this.');
        assert.equal(await send(walk, fresh, 'Third.'), 'Third.');
    });

    test(`a failed ${layout} final write reopens the durable attempt and reconciles its accepted message`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        await queueSelection(tab, 'Keep this.');
        const selected = plain(stored(walk, 'live').selection);
        const respond = walk.site.respond.bind(walk.site);
        walk.site.respond = (receiver, url, options) => {
            if (url === WholeSite.Messages && options?.method === 'POST') {
                assert.ok(stored(walk, 'live').posts.some((post) => post.reminder === selected.id && post.submission));
                walk.storage.refuseSetsMatching(/live/);
            }
            return respond(receiver, url, options);
        };
        assert.equal(await send(walk, tab, 'I wait.'), 'I wait.\n@: [Scribe] Keep this.');
        assert.equal(walk.site.messages.at(-1).contents[0].text, 'I wait.\n@: [Scribe] Keep this.');
        walk.site.respond = respond;
        walk.storage.allow();
        const fresh = await reload(walk, tab);
        await pass(walk, TICK_MS);
        assert.equal(await send(walk, fresh, 'Again.'), 'Again.');
        assert.deepEqual(plain(stored(walk, 'live').settled), [selected.id]);
    });

    test(`ambiguous ${layout} history waits for the receipt identifying the first of two identical attempts`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        await queueSelection(tab, 'Keep.');
        const first = plain(stored(walk, 'live').selection);
        const pending = [];
        const respond = walk.site.respond.bind(walk.site);
        walk.site.respond = (receiver, url, options) => url === WholeSite.Messages && options?.method === 'POST'
            ? new Promise((resolve) => pending.push({ receiver, url, options, resolve })) : respond(receiver, url, options);
        assert.equal(await send(walk, tab, 'Go.'), 'Go.\n@: [Scribe] Keep.');
        tab.panel.click('scribe-force');
        await settle();
        for (const text of ['Changed.', 'Keep.']) {
            tab.panel.click('scribe-edit');
            tab.panel.type('scribe-reminder', text);
            tab.panel.click('scribe-edit-save');
            await settle();
        }
        const second = plain(stored(walk, 'live').selection);
        assert.notEqual(first.id, second.id);
        assert.equal(await send(walk, tab, 'Go.'), 'Go.\n@: [Scribe] Keep.');
        assert.equal(pending.length, 2);
        const [original] = pending;
        const response = await respond(original.receiver, original.url, original.options);
        await pass(walk, 2 * TICK_MS);
        assert.deepEqual(plain(stored(walk, 'live').settled), []);
        assert.deepEqual(plain(stored(walk, 'live').selection), second);
        original.resolve(response);
        await pass(walk, TICK_MS);
        assert.deepEqual(plain(stored(walk, 'live').settled), [first.id]);
        assert.deepEqual(plain(stored(walk, 'live').selection), second);
        walk.site.respond = respond;
        const fresh = await reload(walk, tab);
        assert.deepEqual(plain(stored(walk, 'live').selection), second);
        assert.equal(await send(walk, fresh, 'Bare.'), 'Bare.');
        assert.equal(stored(walk, 'live').sends, 1);
    });

    test(`the reader receives only the authored portion of a verified ${layout} manual attachment after reload`, async () => {
        const { walk, tab } = await adopted('5', { layout });
        const player = 'I wait.\n@: [Scribe] First.';
        const selected = 'First.\nMira lost the key.';
        await queueSelection(tab, selected);
        await pause(walk, tab);
        const wire = player + '\n@: [Scribe] ' + selected;
        assert.equal(await send(walk, tab, player), wire);
        const raw = walk.site.messages.at(-1);
        assert.equal(raw.contents[0].text, wire);
        await pass(walk, TICK_MS * 2);
        const bound = stored(walk, 'live').attachments.find((entry) => entry.id === raw.id);
        assert.equal(bound.length, player.length);
        const fresh = await reload(walk, tab);
        const before = walk.model.calls.length;
        await resume(walk, fresh);
        await until(walk, 'Keeper to send the verified player passage to the reader', () =>
            walk.model.calls.slice(before).some((call) => call.role === 'Story' && call.user.includes('I wait.')), TICK_MS * 3);
        const passage = walk.model.calls.slice(before).find((call) => call.role === 'Story' && call.user.includes('I wait.')).user;
        assert.ok(passage.includes(player), passage);
        assert.equal(passage.includes('Mira lost the key.'), false, passage);
        assert.equal(walk.site.messages.find((message) => message.id === raw.id).contents[0].text, wire);
    });

    test(`the ${layout} composer submits the full manual selection once and clears its preview`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        const selected = '雪  on the quay.\nHold here. ';
        await queueSelection(tab, selected);
        const { id } = stored(walk, 'live').selection;
        const player = 'I  wait.\nThen I move.';
        const tail = '\n@: [Scribe] ' + selected;
        const crowded = 'x'.repeat(4501 - Buffer.byteLength(tail));
        assert.equal(await send(walk, tab, crowded), crowded);
        assert.equal(walk.site.messages.at(-1).contents[0].text, crowded);
        assert.equal(stored(walk, 'live').selection.id, id);
        assert.match(tab.panel.text('scribe-held'), /still queued/);
        const before = walk.site.messages.length;
        tab.type(player);
        if (layout === 'top') {
            tab.enter();
        }
        tab.press('Send', true);
        await pass(walk, 1200);
        assert.equal(walk.site.messages.length, before + 1);
        assert.equal(walk.site.messages.at(-1).contents[0].text, player + tail);
        const accepted = walk.site.requests.filter((request) => request.method === 'POST' && request.url === WholeSite.Messages).at(-1);
        assert.equal(JSON.parse(accepted.body).text, player + tail);
        const saved = stored(walk, 'live');
        assert.deepEqual([saved.selection, saved.draft, saved.ready, saved.forced, saved.sends], [null, null, null, false, 0]);
        assert.deepEqual(plain(saved.settled), [id]);
        assert.equal(tab.panel.byId('scribe-reminder').value, '');
        assert.equal(tab.panel.text('scribe-force-outcome'), '');
        assert.equal(await send(walk, tab, 'Again.'), 'Again.');
    });

    test(`a pending ${layout} manual send permits saving a new choice, even with identical final text`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        const original = 'Keep  two spaces.\nAnd this line.';
        await queueSelection(tab, original);
        const first = stored(walk, 'live').selection;
        const respond = walk.site.respond.bind(walk.site);
        let release;
        walk.site.respond = (receiver, url, options) => url === WholeSite.Messages && options?.method === 'POST'
            ? new Promise((resolve) => { release = () => resolve(respond(receiver, url, options)); }) : respond(receiver, url, options);
        assert.equal(await send(walk, tab, 'First.'), 'First.\n@: [Scribe] ' + original);
        for (const text of ['An intermediate draft.', original]) {
            assert.equal(tab.panel.byId('scribe-edit').disabled, false);
            tab.panel.click('scribe-edit');
            tab.panel.type('scribe-reminder', text);
            tab.panel.click('scribe-edit-save');
            await settle();
        }
        const newer = stored(walk, 'live').selection;
        assert.notEqual(newer.id, first.id);
        walk.site.respond = respond;
        release();
        await pass(walk, 1000);
        assert.equal(walk.site.messages.at(-1).contents[0].text, 'First.\n@: [Scribe] ' + original);
        assert.deepEqual(plain(stored(walk, 'live').selection), plain(newer));
        assert.deepEqual(plain(stored(walk, 'live').settled), [first.id]);
        assert.equal(stored(walk, 'live').sends, 0);
        assert.equal(await send(walk, tab, 'Second.'), 'Second.\n@: [Scribe] ' + original);
        assert.equal(stored(walk, 'live').selection, null);
    });

    test(`an open manual edit survives ${layout} delivery and Save keeps its exact spacing`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        const original = '[Scribe] At the quay.';
        const newer = '[Scribe] At  the\nquay.';
        await queueSelection(tab, original);
        tab.panel.click('scribe-edit');
        tab.panel.type('scribe-reminder', newer);
        assert.equal(await send(walk, tab, 'Go.'), 'Go.\n@: ' + original);
        assert.equal(stored(walk, 'live').selection, null);
        assert.equal(tab.panel.byId('scribe-reminder').value, newer);
        tab.panel.click('scribe-edit-save');
        await settle();
        assert.equal(stored(walk, 'live').selection.text, newer);
        assert.equal(await send(walk, tab, 'Next.'), 'Next.\n@: ' + newer);
    });

    test(`a ${layout} POST returning 401 keeps the unsent reminder for a manual retry, even across reload`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        const chosen = 'A full  choice.\nKeep this line.';
        await queueSelection(tab, chosen);
        const ready = '[Scribe] ' + chosen;
        const { delivery } = stored(walk, 'live');
        const start = walk.site.messages.length;
        const respond = walk.site.respond.bind(walk.site);
        let attempts = 0;
        walk.site.respond = (receiver, url, options) => {
            if (url === WholeSite.Messages && options?.method === 'POST') {
                attempts++;
                return Promise.resolve({ status: 401 });
            }
            return respond(receiver, url, options);
        };
        tab.type('I try.');
        tab.enter();
        await pass(walk, 30);
        assert.equal(attempts, 1);
        assert.equal(tab.box.value, '');
        assert.equal(walk.site.messages.length, start);
        assert.equal(stored(walk, 'live').unauthorizedSend, true);
        assert.deepEqual(plain(stored(walk, 'live').posts), []);
        const fresh = await reload(walk, tab);
        await pass(walk, 2 * TICK_MS);
        const rejected = stored(walk, 'live');
        assert.equal(attempts, 1);
        assert.equal(rejected.delivery.id, delivery.id);
        assert.deepEqual(plain(rejected.selection), { id: delivery.id, text: chosen });
        assert.equal(rejected.sends, 0);
        assert.equal(rejected.forced, true);
        assert.equal(rejected.settled.includes(delivery.id), false);
        walk.site.respond = respond;
        assert.equal(await send(walk, fresh, 'Again.'), `Again.\n@: ${ready}`);
        assert.equal(stored(walk, 'live').unauthorizedSend, false);
        assert.equal(walk.site.messages.length, start + 1);
        assert.deepEqual(plain(stored(walk, 'live').settled), [delivery.id]);
    });

    test(`a delayed ${layout} rejection releases only the POST whose composer cleared`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        const { ready, delivery } = stored(walk, 'live');
        const start = walk.site.messages.length;
        const respond = walk.site.respond.bind(walk.site);
        let release;
        const pending = new Promise((resolve) => { release = resolve; });
        walk.site.respond = (receiver, url, options) => url === WholeSite.Messages && options?.method === 'POST'
            ? pending : respond(receiver, url, options);
        assert.equal(await send(walk, tab, 'First.'), `First.\n@: ${ready}`);
        assert.equal(stored(walk, 'live').sends, 0);
        walk.site.respond = respond;
        assert.equal(await send(walk, tab, 'Second.'), 'Second.');
        assert.equal(walk.site.messages.length, start + 1);
        assert.equal(stored(walk, 'live').sends, 1);
        release({ status: 401 });
        await pass(walk, 500);
        assert.equal(stored(walk, 'live').delivery.id, delivery.id);
        assert.equal(stored(walk, 'live').unauthorizedSend, true);
        assert.equal(await send(walk, tab, 'Retry.'), `Retry.\n@: ${ready}`);
        await pass(walk, 2 * TICK_MS);
        const accepted = stored(walk, 'live');
        assert.equal(accepted.sends, 0);
        assert.deepEqual(plain(accepted.counted), playerReceipts(walk, start));
        assert.deepEqual(plain(accepted.settled), [delivery.id]);
    });

    test(`a 401 with text left in the ${layout} composer can be retried immediately without retyping`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        const start = walk.site.messages.length;
        const { ready, delivery } = stored(walk, 'live');
        const normalSend = tab.send.bind(tab);
        const respond = walk.site.respond.bind(walk.site);
        const submissions = [];
        tab.send = () => {
            submissions.push(tab.state);
            return tab.pagePost(tab.state);
        };
        walk.site.respond = (receiver, url, options) => url === WholeSite.Messages && options?.method === 'POST'
            ? Promise.resolve({ status: 401 }) : respond(receiver, url, options);
        tab.type('Stayed.');
        tab.box.setSelectionRange(2, 5);
        tab.enter();
        await pass(walk, 1);
        const first = stored(walk, 'live').posts[0].key;
        await pass(walk, 34);
        assert.deepEqual(submissions, [`Stayed.\n@: ${ready}`]);
        assert.equal(walk.site.messages.length, start);
        assert.equal(stored(walk, 'live').unauthorizedSend, true);
        assert.deepEqual(plain(stored(walk, 'live').posts), []);
        assert.equal(tab.state, 'Stayed.');
        assert.equal(tab.box.value, 'Stayed.');
        assert.deepEqual([tab.box.selectionStart, tab.box.selectionEnd], [2, 5]);
        tab.send = normalSend;
        walk.site.respond = respond;
        tab.enter();
        await pass(walk, 1);
        assert.notEqual(stored(walk, 'live').posts[0].key, first);
        await pass(walk, 200);
        assert.equal(walk.site.messages.length, start + 1);
        assert.equal(walk.site.messages.at(-1).contents[0].text, `Stayed.\n@: ${ready}`);
        assert.deepEqual(plain(stored(walk, 'live').settled), [delivery.id]);
        assert.equal(stored(walk, 'live').sends, 0);
        const fresh = await reload(walk, tab);
        await pass(walk, TICK_MS * 2);
        assert.deepEqual(plain(stored(walk, 'live').counted), playerReceipts(walk, start));
        assert.equal(await send(walk, fresh, 'Next.'), 'Next.');
        assert.equal(stored(walk, 'live').sends, 1);
    });

    test(`a delayed 401 keeps a newer manually typed draft in the ${layout} composer`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        const start = walk.site.messages.length;
        const { ready } = stored(walk, 'live');
        const respond = walk.site.respond.bind(walk.site);
        let release;
        const pending = new Promise((resolve) => { release = resolve; });
        walk.site.respond = (receiver, url, options) => url === WholeSite.Messages && options?.method === 'POST'
            ? pending : respond(receiver, url, options);
        assert.equal(await send(walk, tab, 'First.'), `First.\n@: ${ready}`);
        const newer = `First.\n@: ${ready} — keep my addition.`;
        tab.type(newer);
        tab.box.setSelectionRange(3, 5);
        release({ status: 401 });
        await pass(walk, 3000);
        assert.equal(stored(walk, 'live').unauthorizedSend, true);
        assert.equal(tab.box.value, newer);
        assert.equal(tab.state, newer);
        assert.deepEqual([tab.box.selectionStart, tab.box.selectionEnd], [3, 5]);
        assert.equal(walk.site.messages.length, start);
    });

    test(`a transient ${layout} POST stays uncertain after reload until the player message appears`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        const { ready, delivery } = stored(walk, 'live');
        const start = walk.site.messages.length;
        const respond = walk.site.respond.bind(walk.site);
        let status = 503;
        walk.site.respond = (receiver, url, options) => url === WholeSite.Messages && options?.method === 'POST'
            ? Promise.resolve({ status }) : respond(receiver, url, options);
        assert.equal(await send(walk, tab, 'I wait.'), `I wait.\n@: ${ready}`);
        status = 200;
        await tab.pagePost('A separate POST outside the original send event.');
        await pass(walk, 500);
        assert.equal(walk.site.messages.length, start);
        const fresh = await reload(walk, tab);
        assert.equal(stored(walk, 'live').sends, 0);
        assert.equal(stored(walk, 'live').unauthorizedSend, false);
        assert.equal(stored(walk, 'live').settled.includes(delivery.id), false);
        walk.site.respond = respond;
        await fresh.pagePost(`I wait.\n@: ${ready}`);
        await pass(walk, 2 * TICK_MS);
        assert.deepEqual(plain(stored(walk, 'live').settled), [delivery.id]);
        assert.deepEqual(plain(stored(walk, 'live').counted), playerReceipts(walk, start));
        assert.equal(await send(walk, fresh, 'Next.'), 'Next.');
    });

    test(`when the ${layout} host starts its fetch after the send event, a 200 alone cannot settle the reminder`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        const { ready, delivery } = stored(walk, 'live');
        const start = walk.site.messages.length;
        const pagePost = tab.pagePost.bind(tab);
        tab.pagePost = (text) => Promise.resolve().then(() => pagePost(text));
        const respond = walk.site.respond.bind(walk.site);
        let calls = 0;
        walk.site.respond = (receiver, url, options) => {
            if (url === WholeSite.Messages && options?.method === 'POST') {
                calls++;
                return Promise.resolve({ status: 200 });
            }
            return respond(receiver, url, options);
        };
        assert.equal(await send(walk, tab, 'I wait.'), `I wait.\n@: ${ready}`);
        assert.equal(calls, 1);
        assert.equal(walk.site.messages.length, start);
        const fresh = await reload(walk, tab);
        assert.equal(stored(walk, 'live').sends, 0);
        assert.equal(stored(walk, 'live').delivery.id, delivery.id);
        assert.equal(stored(walk, 'live').posts.length, 1);
        walk.site.respond = respond;
        await fresh.pagePost(`I wait.\n@: ${ready}`);
        await pass(walk, TICK_MS * 2);
        assert.deepEqual(plain(stored(walk, 'live').settled), [delivery.id]);
        assert.deepEqual(plain(stored(walk, 'live').counted), playerReceipts(walk, start));
    });

    test(`a history GET returning 401 leaves the interrupted ${layout} send pending until the player row can be read`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        const start = walk.site.messages.length;
        const { ready, delivery } = stored(walk, 'live');
        tab.type('I wait.');
        tab.enter();
        await pass(walk, 1);
        assert.equal(walk.site.messages.length, start);
        assert.equal(stored(walk, 'live').posts.length, 1);
        tab.unload();
        const api = walk.site.rooms.get(ROOM).zeta;
        const respond = api.respond.bind(api);
        let refused = 0;
        api.respond = (receiver, url, options) => {
            if (WholeSite.paged(url)) {
                refused++;
                return Promise.resolve({ status: 401, ok: false, text: async () => 'Login required.' });
            }
            return respond(receiver, url, options);
        };
        const fresh = install(walk, CHAT);
        await fresh.openPage();
        fresh.ready();
        await pass(walk, 2 * TICK_MS);
        assert.ok(refused > 0);
        assert.equal(stored(walk, 'live').delivery.id, delivery.id);
        assert.equal(stored(walk, 'live').sends, 0);
        assert.equal(stored(walk, 'live').unauthorizedSend, false);
        assert.equal(stored(walk, 'live').posts.length, 1);
        await fresh.pagePost(`I wait.\n@: ${ready}`);
        await pass(walk, 2 * TICK_MS);
        assert.equal(stored(walk, 'live').settled.includes(delivery.id), false);
        assert.equal(walk.site.messages.length, start + 1);
        api.respond = respond;
        await until(walk, 'the restored history to identify the original player send', () =>
            stored(walk, 'live').settled.includes(delivery.id), 4 * TICK_MS);
        assert.equal(stored(walk, 'live').sends, 0);
        assert.deepEqual(plain(stored(walk, 'live').counted), playerReceipts(walk, start));
        assert.equal(await send(walk, fresh, 'I stand.'), 'I stand.');
        assert.equal(stored(walk, 'live').sends, 1);
        assert.equal(walk.site.messages.length, start + 2);
    });
}

test('a delayed frame rejection survives nine newer unresolved sends', async () => {
    const { walk, tab } = await adopted('2', { layout: 'frame' });
    const { ready, delivery } = stored(walk, 'live');
    const start = walk.site.messages.length;
    const respond = walk.site.respond.bind(walk.site);
    let release;
    let posts = 0;
    const delayed = new Promise((resolve) => { release = resolve; });
    walk.site.respond = (receiver, url, options) => {
        if (url === WholeSite.Messages && options?.method === 'POST') {
            posts++;
            return posts === 1 ? delayed : Promise.resolve({ status: 503 });
        }
        return respond(receiver, url, options);
    };
    assert.equal(await send(walk, tab, 'First.'), `First.\n@: ${ready}`);
    const key = stored(walk, 'live').posts[0].key;
    for (let index = 1; index <= 9; index++) {
        const text = `Another send ${index}.`;
        assert.equal(await send(walk, tab, text), text);
        await pass(walk, 2600);
    }
    assert.equal(stored(walk, 'live').posts.length, 10);
    release({ status: 401 });
    await pass(walk, 500);
    const refused = stored(walk, 'live');
    assert.equal(refused.unauthorizedSend, true);
    assert.equal(refused.posts.some((entry) => entry.key === key), false);
    assert.equal(refused.posts.length, 9);
    assert.equal(refused.sends, 0);
    assert.equal(walk.site.messages.length, start);
    assert.equal(posts, 10);
    walk.site.respond = respond;
    assert.equal(await send(walk, tab, 'Retry.'), `Retry.\n@: ${ready}`);
    assert.deepEqual(plain(stored(walk, 'live').settled), [delivery.id]);
    assert.equal(await send(walk, tab, 'Next.'), 'Next.');
    assert.equal(stored(walk, 'live').sends, 1);
});

test('a frame receipt from an earlier visit cannot reject an attempt on returning to the room', async () => {
    const { walk, tab } = await adopted('2', { layout: 'frame' });
    const respond = walk.site.respond.bind(walk.site);
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    walk.site.respond = (receiver, url, options) =>
        url === WholeSite.Messages && options?.method === 'POST' ? pending : respond(receiver, url, options);
    await send(walk, tab, 'Pending.');
    const key = stored(walk, 'live').posts[0].key;
    tab.go('/');
    await pass(walk, 2000);
    tab.go(CHAT);
    await tab.openPage();
    await pass(walk, 2 * TICK_MS);
    release({ status: 401 });
    await pass(walk, 2000);
    const live = stored(walk, 'live');
    assert.equal(live.unauthorizedSend, false);
    assert.equal(live.posts.some((post) => post.key === key), true);
    assert.equal(live.sends, 0);
});

test('a refused history refresh leaves a prepared reminder and its counter alone', async () => {
    const { walk, tab } = await adopted('2');
    const { ready, delivery, sends } = stored(walk, 'live');
    const start = walk.site.messages.length;
    const api = walk.site.rooms.get(ROOM).zeta;
    const respond = api.respond.bind(api);
    let refused = 0;
    api.respond = (receiver, url, options) => {
        if (WholeSite.paged(url)) {
            refused++;
            return Promise.resolve({ status: 401, ok: false, text: async () => 'Unauthorized.' });
        }
        return respond(receiver, url, options);
    };
    await pass(walk, 2 * TICK_MS);
    assert.ok(refused > 0);
    assert.equal(stored(walk, 'live').ready, ready);
    assert.equal(stored(walk, 'live').sends, sends);
    assert.equal(stored(walk, 'live').unauthorizedSend, false);
    assert.deepEqual(plain(stored(walk, 'live').posts), []);
    assert.equal(walk.site.messages.length, start);
    api.respond = respond;
    await pass(walk, 2 * TICK_MS);
    assert.equal(await send(walk, tab, 'I wait.'), `I wait.\n@: ${ready}`);
    assert.deepEqual(plain(stored(walk, 'live').settled), [delivery.id]);
});

test('an external edit and a confirmed ordinary send count as two distinct player messages', async () => {
    const { walk, tab } = await adopted('2');
    const start = walk.site.messages.length;
    await send(walk, tab, 'First.');
    await pass(walk, 2 * TICK_MS);
    await tab.pagePost('A different player message.');
    walk.site.edit(start + 2, 'A corrected player message.');
    await send(walk, tab, 'I stand.');
    await pass(walk, 2 * TICK_MS);
    const live = stored(walk, 'live');
    assert.equal(live.sends, 2);
    assert.deepEqual(plain(live.counted), playerReceipts(walk, start));
    assert.deepEqual(plain(live.posts), []);
});

test('D12. history counts all thirteen frame sends when the notification rate limit is reached', async () => {
    const { walk, tab } = await adopted('2', { layout: 'frame' });
    const start = walk.site.messages.length;
    const offer = stored(walk, 'live').delivery.id;
    for (let index = 0; index < 13; index++) {
        tab.type('I wait.');
        tab.enter();
        await pass(walk, 180);
    }
    const accepted = walk.site.messages.slice(start);
    assert.equal(accepted.length, 13);
    assert.equal(accepted[0].contents[0].text.includes('[Scribe]'), true);
    assert.equal(accepted.slice(1).every((message) => message.contents[0].text === 'I wait.'), true);
    await pass(walk, 2 * TICK_MS);
    const saved = stored(walk, 'live');
    assert.equal(saved.sends, 12);
    assert.deepEqual(plain(saved.settled), [offer]);
    assert.deepEqual(plain(saved.counted), playerReceipts(walk, start));
    assert.deepEqual(plain(saved.posts), []);
    await reload(walk, tab);
    await pass(walk, 2 * TICK_MS);
    assert.equal(stored(walk, 'live').sends, 12);
    assert.deepEqual(plain(stored(walk, 'live').counted), playerReceipts(walk, start));
});

for (const afterAcknowledgement of [false, true]) {
    const timing = afterAcknowledgement ? 'after' : 'before';
    test(`D12. a new reminder at the frame rate limit survives reload ${timing} acknowledgement`, async () => {
        const { walk, tab } = await adopted('2', { layout: 'frame' });
        const start = walk.site.messages.length;
        const first = stored(walk, 'live').delivery.id;
        for (let index = 0; index < 10; index++) {
            tab.type(`Turn ${index + 1}.`);
            tab.enter();
            await pass(walk, 180);
        }
        assert.equal(walk.site.messages.length, start + 10);
        const ready = '[Scribe] The bell rings.';
        tab.panel.tab('Findings');
        tab.panel.click('scribe-edit');
        tab.panel.type('scribe-reminder', ready);
        tab.panel.click('scribe-edit-save');
        await pass(walk, 100);
        const second = stored(walk, 'live').delivery.id;
        assert.notEqual(first, second);
        tab.type('Eleven.');
        tab.enter();
        await pass(walk, afterAcknowledgement ? 400 : 30);
        assert.equal(walk.site.messages.length, start + 11);
        assert.equal(walk.site.messages.at(-1).contents[0].text, `Eleven.\n@: ${ready}`);
        assert.equal(stored(walk, 'live').settled.includes(second), afterAcknowledgement);
        const fresh = await reload(walk, tab);
        await pass(walk, 2 * TICK_MS);
        const saved = stored(walk, 'live');
        assert.deepEqual(plain(saved.settled), [first, second]);
        assert.equal(saved.sends, 0);
        assert.equal(saved.edited, null);
        assert.equal(saved.draft, null);
        assert.deepEqual(plain(saved.counted), playerReceipts(walk, start));
        assert.deepEqual(queued(fresh), []);
        assert.equal(await send(walk, fresh, 'Twelve.'), 'Twelve.');
        assert.equal(stored(walk, 'live').sends, 1);
    });
}

test('D4. a repeated report of one frame send tells the live part once', async () => {
    const { walk, tab } = await adopted('2');
    const ready = stored(walk, 'live').ready;
    const armed = armsTo(walk, tab).at(-1);
    assert.equal(armed.ready, ready);
    assert.equal(typeof armed.reminder, 'string');
    assert.equal(typeof armed.attempt, 'string');
    assert.equal(await send(walk, tab, 'I step forward.'), `I step forward.\n@: ${ready}`);
    await quiet(walk, 'after the reminder went');
    const first = reportsFrom(walk, tab).filter((message) => message.kind === 'sent').at(-1);
    assert.deepEqual([first.seq, first.ready, first.reminder, first.attempt], [armed.seq, true, armed.reminder, armed.attempt]);
    tab.frame.toTop.postMessage(first, TOP_ORIGIN);
    await pass(walk, 2000);
    assert.equal(stored(walk, 'live').sends, 0);
    assert.equal(stored(walk, 'live').ready, null);
    assert.equal(await send(walk, tab, 'I step again.'), 'I step again.');
    const plainReport = reportsFrom(walk, tab).filter((message) => message.kind === 'sent').at(-1);
    assert.equal(plainReport.ready, false);
    assert.equal(stored(walk, 'live').sends, 1);
    tab.frame.toTop.postMessage(plainReport, TOP_ORIGIN);
    tab.frame.toTop.postMessage(plainReport, TOP_ORIGIN);
    await pass(walk, 2000);
    assert.equal(stored(walk, 'live').sends, 1);
    assert.deepEqual(tab.logs, []);
    assert.deepEqual(tab.frame.logs, []);
});

for (const layout of ['top', 'frame']) {
    for (const state of ['already sent', 'delayed receipt', 'unsent']) {
        test(`the ${layout} path migrates an ${state} legacy reminder against fresh room history`, async () => {
            const { walk, tab } = await adopted('2', { layout });
            const start = walk.site.messages.length;
            const modern = stored(walk, 'live');
            const contemporary = new Set(['serial', 'delivery', 'settled', 'counted', 'posts', 'postSerial', 'observed', 'observedSends', 'receipts']);
            const legacy = Object.fromEntries(Object.entries(modern).filter(([key]) => !contemporary.has(key)));
            if (state !== 'unsent') {
                await tab.pagePost(`From version one.\n@: ${legacy.ready}`);
            }
            tab.unload();
            const api = walk.site.rooms.get(ROOM).zeta;
            if (state === 'delayed receipt') {
                api.messages = walk.site.messages.slice(0, start);
            }
            REFERENCE.ScribeStore.write(walk.storage, ROOM, 'live', legacy);
            let fresh = install(walk, CHAT);
            await fresh.openPage();
            fresh.ready();
            await pass(walk, 2000);
            if (state === 'delayed receipt') {
                await pass(walk, 4 * TICK_MS);
                fresh.panel.tab('Findings');
                assert.equal(fresh.panel.byId('scribe-reminder').value, legacy.ready);
                assert.equal(fresh.panel.text('scribe-force'), 'Resend this reminder with my next message');
                const ceiling = api.most;
                const attempts = api.requests.length;
                api.most = attempts;
                await pass(walk, 2 * TICK_MS);
                assert.ok(api.requests.length > attempts);
                api.most = ceiling;
                assert.equal(stored(walk, 'campaign').messages.length, start);
                assert.equal(await send(walk, fresh, 'While history catches up.'), 'While history catches up.');
                api.messages = walk.site.messages;
            }
            await pass(walk, 3 * TICK_MS);
            if (state === 'unsent') {
                assert.equal(await send(walk, fresh, 'Still holding.'), 'Still holding.');
                fresh = await reload(walk, fresh);
                await pass(walk, 3 * TICK_MS);
                fresh.panel.tab('Findings');
                assert.equal(fresh.panel.byId('scribe-reminder').value, legacy.ready);
                assert.match(fresh.panel.text('scribe-held'), /no delivery receipt/);
                assert.equal(fresh.panel.text('scribe-force'), 'Resend this reminder with my next message');
                fresh.panel.click('scribe-force');
                await pass(walk, 200);
                assert.equal(walk.site.messages.length, start + 1);
                fresh.refusing = true;
                fresh.type('Refused.');
                fresh.enter();
                await pass(walk, 3000);
                assert.ok(fresh.refused > 0);
                fresh = await reload(walk, fresh);
                assert.equal(await send(walk, fresh, 'Resend now.'), `Resend now.\n@: ${legacy.ready}`);
            }
            await pass(walk, 2 * TICK_MS);
            const recovered = stored(walk, 'live');
            assert.equal(recovered.ready, null);
            assert.equal(recovered.forced, false);
            assert.equal(recovered.sends, state === 'delayed receipt' ? 1 : 0);
            assert.deepEqual(plain(recovered.counted), playerReceipts(walk, start));
            assert.deepEqual(plain(recovered.posts), []);
            assert.equal(await send(walk, fresh, 'After migration.'), 'After migration.');
            assert.equal(walk.site.messages.slice(start).filter((message) => message.contents[0].text.includes(legacy.ready)).length, 1);
        });
    }
}

for (const layout of ['top', 'frame']) {
    test(`the ${layout} panel explicitly retries a send whose result was lost on reload`, async () => {
        const { walk, tab } = await adopted('2', { layout });
        const start = walk.site.messages.length;
        const offer = stored(walk, 'live').ready;
        tab.type('An interrupted send.');
        tab.enter();
        await pass(walk, 1);
        let fresh = await reload(walk, tab);
        await pass(walk, TICK_MS * 3);
        fresh.panel.tab('Findings');
        assert.equal(fresh.panel.byId('scribe-reminder').value, offer);
        assert.equal(fresh.panel.text('scribe-force'), 'Resend this reminder with my next message');
        assert.match(fresh.panel.text('scribe-held'), /Awaiting confirmation/);
        fresh.panel.click('scribe-force');
        await pass(walk, 100);
        assert.equal(walk.site.messages.length, start);
        fresh = await reload(walk, fresh);
        assert.equal(await send(walk, fresh, 'Deliberate retry.'), `Deliberate retry.\n@: ${offer}`);
        await pass(walk, TICK_MS * 2);
        assert.equal(stored(walk, 'live').sends, 0);
        assert.equal(stored(walk, 'live').ready, null);
        assert.equal(await send(walk, fresh, 'After retry.'), 'After retry.');
        assert.equal(stored(walk, 'live').sends, 1);
    });
}

for (const layout of ['top', 'frame']) {
    for (const recovery of ['deliberate retry', 'history receipt']) {
        test(`a redirected ${layout} POST stays pending across reload until a ${recovery}`, async () => {
            const { walk, tab } = await adopted('2', { layout });
            const start = walk.site.messages.length;
            const { ready, delivery } = stored(walk, 'live');
            const respond = walk.site.respond.bind(walk.site);
            const result = recovery === 'deliberate retry'
                ? { status: 200, redirected: true, url: 'https://zeta-ai.io/login' }
                : { status: 200, redirected: false, url: WholeSite.Messages.replace(/\/messages$/, '/members') };
            let attempts = 0;
            walk.site.respond = (receiver, url, options) => {
                if (url === WholeSite.Messages && options?.method === 'POST') {
                    attempts++;
                    return Promise.resolve(result);
                }
                return respond(receiver, url, options);
            };
            const original = `Waiting.\n@: ${ready}`;
            assert.equal(await send(walk, tab, 'Waiting.'), original);
            assert.equal(tab.box.value, '');
            assert.equal(stored(walk, 'live').ready, ready);
            const fresh = await reload(walk, tab);
            await pass(walk, 2 * TICK_MS);
            const pending = stored(walk, 'live');
            assert.equal(pending.ready, ready);
            assert.equal(pending.delivery.id, delivery.id);
            assert.equal(pending.settled.includes(delivery.id), false);
            assert.equal(pending.sends, 0);
            assert.equal(pending.unauthorizedSend, false);
            assert.equal(attempts, 1);
            assert.equal(walk.site.messages.length, start);
            walk.site.respond = respond;
            if (recovery === 'deliberate retry') {
                fresh.panel.tab('Findings');
                assert.equal(fresh.panel.text('scribe-force'), 'Resend this reminder with my next message');
                fresh.panel.click('scribe-force');
                await pass(walk, 200);
                assert.equal(walk.site.messages.length, start);
                assert.equal(await send(walk, fresh, 'Trying again.'), `Trying again.\n@: ${ready}`);
            } else {
                await fresh.pagePost(original);
            }
            await pass(walk, 2 * TICK_MS);
            const recovered = stored(walk, 'live');
            assert.deepEqual(plain(recovered.settled), [delivery.id]);
            assert.deepEqual(plain(recovered.counted), playerReceipts(walk, start));
            assert.equal(recovered.ready, null);
            assert.equal(recovered.sends, 0);
            assert.equal(walk.site.messages.length, start + 1);
            assert.equal(await send(walk, fresh, 'After recovery.'), 'After recovery.');
        });
    }
}
