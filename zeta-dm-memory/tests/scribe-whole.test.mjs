import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { ScribePack } from '../scribe/pack.mjs';
import CampaignBuilder from './support/CampaignBuilder.mjs';
import FakeLocks from './support/FakeLocks.mjs';
import FakeStorage from './support/FakeStorage.mjs';
import FakeTimers from './support/FakeTimers.mjs';
import WholeModel from './support/WholeModel.mjs';
import WholeSite from './support/WholeSite.mjs';
import WholeTab from './support/WholeTab.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PACKED = ScribePack.build((relativePath) => readFileSync(`${ROOT}${relativePath}`, 'utf8'));
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
const OPENING = '[Scribe] Day 1, "The harbour market", public. Present: Halvard, Mirelle, and 1 other.';
const HAIR = 'Mirelle, hair: "black, worn in a braid".';
const OLD_HAIR = 'black, worn in a braid';
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
    [REFERENCE.ScribeReminder.ChoosePrompt, 'Choose'],
    [REFERENCE.ScribeMuse.SuggestPrompt, 'Suggest'],
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
    Choose: 0.005,
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
function chooseAnswer(user) {
    const numbers = [...user.matchAll(/^(\d+)\. /gm)].map((match) => match[1]).slice(0, 3);
    return numbers.length === 0 ? 'USE: none' : `USE: ${numbers.join(', ')}`;
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
    Choose: chooseAnswer,
    Suggest: () => `LINE: ${RIDER}`,
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
 * @param {{ origin?: string, layout?: string }} extra
 * @return {WholeTab}
 */
function install(walk, path, width = WIDE, extra = {}) {
    walk.made++;
    const tab = new WholeTab({
        name: `tab-${walk.made}`,
        tabId: `tab-${walk.made}`,
        packed: PACKED,
        clock: walk.clock,
        storage: walk.storage,
        site: walk.site,
        model: walk.model,
        locks: walk.locks,
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
        () => fresh.panel.headline().startsWith('Up to date') || fresh.panel.headline().startsWith('Stopped'),
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
    assert.equal(first === 'Loading the chat...' || first.startsWith('Pulling the chat'), true, first);
    await until(walk, 'step 2: the chat to be pulled', () => tab.panel.headline().startsWith('No book for this chat yet'), 15000);
    assert.equal(tab.panel.headline(), 'No book for this chat yet: 91 messages.');
    const reads = walk.site.scribeRequests();
    assert.equal(reads.length, 3);
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
        ['1-30', '31-60', '61-90'],
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
    assert.equal(tab.panel.headline(), 'Up to date: 90 of 91 read.');
    const book = stored(walk, 'book');
    assert.equal(book.adopted, true);
    assert.equal(Object.keys(book.log.read).length, 90);
    assert.equal(Object.hasOwn(book.log.read, `MESSAGE-${CHAT_LENGTH}`), false);
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
        ['Story', 'Story', 'Story'],
    );
    assert.equal(reading.every((entry) => entry.ready === null), true);
    assert.equal(reading.some((entry) => entry.headline.startsWith('Up to date')), false);
    const after = seen.slice(last + 1).map((entry) => entry.role);
    assert.equal(after.filter((role) => role === 'Scene').length, 1);
    assert.equal(after.filter((role) => role === 'Pedant').length, 1);
    assert.equal(after.filter((role) => role === 'Choose').length <= 1, true);
    assert.deepEqual(
        after.filter((role) => !['Scene', 'Pedant', 'Choose'].includes(role)),
        [],
    );
    assert.equal(seen[last + 1].ready, null);
    assert.equal(stored(walk, 'live').ready, null);
    assert.deepEqual(queued(tab), []);
    assert.equal(tab.panel.byId('scribe-reminder').value, '');
    assert.equal(tab.panel.byId('scribe-force').disabled, false);
    await forceReminder(walk, tab);
    const ready = stored(walk, 'live').ready;
    assert.equal(ready.startsWith(`${OPENING} `), true, ready);
    assert.equal(ready.includes('Present: 3 people'), false);
    assert.deepEqual(queued(tab), [`Reminder: ${ready}`]);
    assert.equal(tab.panel.byId('scribe-reminder').value, ready);
    assert.deepEqual(tab.panel.rowTexts('queued'), []);
});

test('4. the first message after adopting carries a reminder built from the book just read', async () => {
    const { walk, tab } = await adopted('2');
    const ready = stored(walk, 'live').ready;
    const went = await send(walk, tab, 'I look around.');
    assert.equal(went, `I look around.\n@: ${ready}`);
    assert.equal(went.startsWith(`I look around.\n@: ${OPENING} `), true, went);
    assert.equal(went.includes('Present: 3 people'), false);
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
    assert.equal(fresh.panel.headline(), 'Up to date: 90 of 91 read.');
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
    const reads = walk.site.scribeRequests().length;
    await arrive(walk, tab, ASKED, REPLY);
    await until(
        walk,
        'step 6: the new reply to be checked',
        () => stored(walk, 'live')?.seen?.id === walk.site.messages.at(-1).id && typeof stored(walk, 'live')?.ready === 'string',
        TICK_MS * 2,
    );
    await quiet(walk, 'step 6: after the check');
    const pulled = walk.site.scribeRequests().slice(reads);
    assert.equal(pulled.length > 0, true);
    assert.equal(new URL(pulled[0].url).searchParams.get('cursor'), null);
    assert.equal(asked(walk, 'Scene', from), 1);
    assert.equal(asked(walk, 'Pedant', from), 1);
    assert.equal(asked(walk, 'Story', from), 0);
    const pedant = walk.model.calls.slice(from).find((call) => call.role === 'Pedant');
    assert.equal(pedant.user.includes('REPLY (#93):'), true);
    const ready = stored(walk, 'live').ready;
    const rows = queued(tab);
    assert.equal(rows.length, 1);
    assert.equal(rows[0], `Reminder: ${ready}`);
    assert.equal(ready.startsWith('[Scribe] '), true);
    assert.equal(ready.startsWith(`${OPENING} ${HAIR}`), true, ready);
    const findings = findingRows(tab);
    assert.equal(findings.length, 1);
    const texts = tab.panel.walk(findings[0]).map((element) => element.ownText);
    assert.equal(texts.includes('The reply contradicts the book'), true);
    assert.equal(texts.includes(GOES_FIRST), true);
    assert.deepEqual(tab.panel.buttonTexts(findings[0]), ['Dismiss', 'Rule it...']);
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
    assert.equal(asked(walk, 'Story', from), 0);
    assert.equal(asked(walk, 'Scene', from), 1);
    assert.equal(asked(walk, 'Pedant', from), 1);
    assert.equal(
        walk.model.calls.slice(from).find((call) => call.role === 'Pedant').user.includes('opens the red ledger without a word'),
        true,
    );
    assert.deepEqual(findingRows(tab), []);
    assert.equal(stored(walk, 'live').findings.length, 0);
});

test('8. switching back to the first version costs no further model request', async () => {
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
    assert.equal(asked(walk, 'Scene', back), 0);
    assert.equal(asked(walk, 'Pedant', back), 0);
    assert.equal(findingRows(tab).length, 1);
    assert.deepEqual(rolesSince(walk, back), []);
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
    assert.equal(roles.filter((role) => role === 'Choose').length <= 1, true);
    assert.deepEqual(
        roles.filter((role) => role !== 'Choose'),
        [],
    );
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
    assert.equal(roles.filter((role) => role === 'Choose').length <= 1, true);
    assert.deepEqual(
        roles.filter((role) => role !== 'Story' && role !== 'Choose'),
        [],
    );
    assert.equal(tab.panel.headline(), 'Up to date: 90 of 91 read.');
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
    assert.equal(walk.model.calls[from].user.includes('[#90] Mirelle keeps a brass compass from her father.'), true);
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
    assert.equal(roles.filter((role) => role === 'Choose').length <= 1, true);
    assert.deepEqual(
        roles.filter((role) => role !== 'Notes' && role !== 'Choose'),
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
    const { walk, tab } = await replied('1.2');
    const before = spentToday(walk);
    walk.model.answers.Pedant = () => '';
    walk.model.costs.Pedant = 0.15;
    const from = walk.model.calls.length;
    await arrive(walk, tab, 'I ask Mirelle about the red ledger.', [['Narrator', 'Mirelle taps the red ledger and smiles.']]);
    await until(walk, 'step 13: three attempts at the pedant', () => asked(walk, 'Pedant', from) === 3, 30000);
    await pass(walk, TICK_MS * 2);
    return { walk, tab, from, before };
}

test('13. every billed attempt of a failed answer is counted', async () => {
    const { walk, from, before } = await exhausted();
    assert.equal(asked(walk, 'Pedant', from), 3);
    const expected = before + asked(walk, 'Scene', from) * COSTS.Scene + 3 * 0.15;
    assert.equal(Math.abs(spentToday(walk) - expected) < 1e-9, true, `${before} -> ${spentToday(walk)}`);
    assert.equal(spentToday(walk) >= 1.2, true);
});

test('13. the header shows what was spent', async () => {
    const { walk, tab } = await exhausted();
    assert.equal(tab.panel.spend(), `$${spentToday(walk).toFixed(4)} today`);
});

test("13. the headline says the day's budget is spent", async () => {
    const { tab } = await exhausted();
    assert.equal(tab.panel.headline().includes('budget is spent'), true, tab.panel.headline());
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
    assert.equal(second.panel.headline(), 'Up to date: 90 of 93 read.');
});

test('14. with a lock manager that has no query, the hidden first tab keeps the chat', async () => {
    const { walk, tab } = await adopted('2', { query: false });
    const second = await secondTab(walk);
    tab.show('hidden');
    await pass(walk, TICK_MS * 3);
    assert.equal(second.panel.headline(), 'Another tab is reading this chat.');
    assert.equal(tab.panel.headline(), 'Up to date: 90 of 91 read.');
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
    assert.equal(asked(walk, 'Story', from), 0);
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
    assert.equal(asked(walk, 'Story', from), 0);
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
    assert.equal(oldReady.includes(OLD_HAIR), true, oldReady);
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
        ['1-30', '31-60', '61-90', '91-92'],
    );
    const lastStory = walk.model.calls.findLastIndex((call) => call.role === 'Story');
    assert.deepEqual(
        walk.model.calls.slice(from, lastStory + 1).map((call) => call.role),
        ['Story', 'Story', 'Story', 'Story'],
    );
    assert.equal(asked(walk, 'Scene', from), 1);
    assert.equal(asked(walk, 'Pedant', from), 1);
    assert.equal(asked(walk, 'Choose', from) <= 1, true);
    const live = stored(walk, 'live');
    assert.equal(live.suggestion, null);
    const newReady = live.ready;
    assert.equal(typeof newReady, 'string');
    assert.equal(newReady === oldReady, false);
    assert.equal(newReady.startsWith(`${OPENING} Mirelle, hair: "${NEW_HAIR}".`), true, newReady);
    assert.equal(newReady.includes(OLD_HAIR), false);
    assert.deepEqual(queued(tab), [`Reminder: ${newReady}`]);
    const newFindings = findingRows(tab).map((row) => row.textContent);
    assert.equal(newFindings.some((text) => text.includes(OLD_HAIR)), false);
    assert.equal(newFindings.length, 1);
    assert.equal(newFindings[0].includes(NEW_HAIR), true);
    const went = await send(walk, tab, 'I begin again.');
    assert.equal(went.includes(oldReady), false);
    assert.equal(went.includes(OLD_HAIR), false);
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
    assert.equal(asked(walk, 'Story', from), 0);
    const live = stored(walk, 'live');
    assert.equal(typeof live.ready, 'string');
    assert.equal(live.ready.startsWith(`${OPENING} ${HAIR}`), true, live.ready);
    assert.deepEqual(plain(live.findings.map((finding) => [finding.kind, finding.said, finding.status])), [['Contradiction', 'red as rust', 'Open']]);
    assert.equal(tab.panel.text('scribe-badge'), '1 to rule, 1 finding');
    assert.equal(tab.panel.byId('scribe-badge').hidden, false);
    assert.equal(tab.panel.headline(), 'Up to date: 90 of 93 read.');
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
    assert.equal(other.panel.headline(), 'Up to date: 60 of 61 read.');
    assert.equal(tab.panel.headline(), 'Up to date: 90 of 91 read.');
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
    assert.equal(since.filter((call) => call.role === 'Story').length, 0);
    assert.equal(tab.document.visibilityState, 'hidden');
    assert.equal(tab.panel.headline(), 'Up to date: 90 of 93 read.');
    assert.equal(other.panel.headline(), 'Up to date: 60 of 63 read.');
    const hiddenReady = stored(walk, 'live').ready;
    const visibleReady = stored(walk, 'live', QUARRY).ready;
    assert.equal(hiddenReady.startsWith(`${OPENING} ${HAIR}`), true, hiddenReady);
    assert.equal(visibleReady.startsWith(`${OPENING} ${HAIR}`), true, visibleReady);
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
    assert.deepEqual(arms[0], { zetaScribe: 1, kind: 'arm', seq: 1, token, ready: null, suggestion: null });
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
    const before = walk.site.scribeRequests().length;
    await until(walk, 'a tick of the reading tab', () => walk.site.scribeRequests().length > before, most);
    return walk.site.scribeRequests().length;
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
    assert.equal(walk.site.scribeRequests().length, reads);
    assert.equal(stored(walk, 'live').ready, ready);
    assert.equal(stored(walk, 'live').sends, sends);
    assert.deepEqual(plain(stored(walk, 'live').findings.map((finding) => finding.status)), ['Open']);
    assert.deepEqual(tab.logs, []);
    tab.frame.toTop.postMessage({ zetaScribe: 1, kind: 'sent', seq: last, ready: false, suggestion: false }, TOP_ORIGIN);
    await pass(walk, 1000);
    assert.equal(walk.site.scribeRequests().length > reads, true);
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
    assert.equal(present.includes('"The ledger office"'), true, present);
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
    assert.equal(first.includes(OLD_HAIR), true, first);
    const harbourArm = armsTo(walk, tab).at(-1);
    assert.equal(harbourArm.ready, first);
    const mark = walk.posts.length;
    tab.go(`/rooms/${QUARRY}`);
    await until(walk, 'step F10: the second chat to be open again', () => tab.panel.headline().startsWith('Up to date: 60 of'), TICK_MS * 2);
    await quiet(walk, 'step F10: back in the second chat');
    const reads = walk.site.scribeRequests().length;
    const reported = walk.posts.length;
    tab.frame.toTop.postMessage({ zetaScribe: 1, kind: 'sent', seq: harbourArm.seq, ready: true, suggestion: false }, TOP_ORIGIN);
    await pass(walk, 2000);
    const late = walk.posts.slice(reported).filter((post) => post.fromLabel === `${tab.name}/frame`);
    assert.equal(late.length, 1);
    assert.equal(late[0].delivered, true);
    assert.equal(walk.site.scribeRequests().length > reads, true);
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
    assert.equal(went.includes(OLD_HAIR), false);
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
