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
 * @return {CampaignBuilder}
 */
function campaign() {
    const builder = new CampaignBuilder(PLAYER);
    for (let number = 1; number <= CHAT_LENGTH; number++) {
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
 * @param {{ locks?: boolean }} options
 * @return {{ clock: FakeTimers, site: WholeSite, model: WholeModel, storage: FakeStorage, locks: FakeLocks|null, tabs: WholeTab[], made: number }}
 */
function world(options = {}) {
    return {
        clock: new FakeTimers(START),
        site: new WholeSite(campaign()),
        model: new WholeModel(PROMPTS, ANSWERS, COSTS),
        storage: new FakeStorage(),
        locks: options.locks === false ? null : new FakeLocks(),
        tabs: [],
        made: 0,
    };
}

/**
 * @param {object} walk
 * @param {string} path
 * @param {number} width
 * @return {WholeTab}
 */
function install(walk, path, width = WIDE) {
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
 * @return {object|null}
 */
function stored(walk, kind) {
    return REFERENCE.ScribeStore.read(walk.storage, ROOM, kind);
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
    return tab.panel.rowTexts('queued');
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
    tab.panel.tab('Progress');
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
    tab.panel.tab('Progress');
    tab.panel.type('scribe-setting-size', '30');
    tab.panel.type('scribe-setting-budget', budget);
    tab.panel.click('scribe-adopt');
    await until(walk, 'the adoption to finish', () => tab.panel.headline().startsWith('Up to date'), 15000);
    await until(
        walk,
        'the newest reply to be checked after the first reading',
        () => stored(walk, 'live')?.seen?.id === walk.site.messages.at(-1).id,
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
 * @param {string} budget
 * @param {{ locks?: boolean }} options
 * @return {Promise<{ walk: object, tab: WholeTab }>}
 */
async function adopted(budget = '2', options = {}) {
    const walk = world(options);
    const tab = await opened(walk);
    await saveKey(walk, tab);
    await adopt(walk, tab, budget);
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
    walk.site.reply(blocks.map((block) => [...block]));
}

/**
 * @param {string} budget
 * @return {Promise<{ walk: object, tab: WholeTab }>}
 */
async function replied(budget = '2') {
    const { walk, tab } = await adopted(budget);
    await arrive(walk, tab, ASKED, REPLY);
    await until(walk, 'step 6: a reminder to be ready', () => typeof stored(walk, 'live')?.ready === 'string', 20000);
    await pass(walk, TICK_MS);
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
        names.filter((name) => name.split(':')[2] !== ROOM),
        [],
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
    tab.panel.tab('Progress');
    tab.panel.type('scribe-setting-size', '30');
    tab.panel.type('scribe-setting-budget', '0');
    tab.panel.click('scribe-adopt');
    await pass(walk, 2000);
    assert.equal(tab.panel.text('scribe-setting-budget-problem'), 'The budget must be a number of dollars, more than 0.');
    assert.equal(tab.panel.text('scribe-controls-outcome'), 'Nothing was started: a field above needs attention.');
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
    const ready = stored(walk, 'live').ready;
    assert.equal(ready.startsWith(`${OPENING} `), true, ready);
    assert.equal(ready.includes('Present: 3 people'), false);
    assert.deepEqual(queued(tab), [`Reminder: ${ready}`]);
});

test('4. the first message after adopting carries a reminder built from the book just read', async () => {
    const { walk, tab } = await adopted('2');
    const ready = stored(walk, 'live').ready;
    const went = await send(walk, tab, 'I look around.');
    assert.equal(went, `I look around.\n@: ${ready}`);
    assert.equal(went.startsWith(`I look around.\n@: ${OPENING} `), true, went);
    assert.equal(went.includes('Present: 3 people'), false);
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
    await until(walk, 'step 6: a reminder to be ready', () => typeof stored(walk, 'live')?.ready === 'string', 20000);
    await pass(walk, TICK_MS);
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

test('14. when the first tab is hidden, the second becomes the reader', async () => {
    const { walk, tab } = await adopted('2');
    const second = await secondTab(walk);
    tab.show('hidden');
    await until(walk, 'step 14: the second tab to become the reader', () => second.panel.headline().startsWith('Up to date'), TICK_MS * 2);
    const from = walk.model.calls.length;
    await arrive(walk, second, ASKED, REPLY);
    await until(walk, 'step 14: the reply to be checked', () => asked(walk, 'Pedant', from) >= 1, TICK_MS * 2);
    await pass(walk, TICK_MS * 2);
    const since = walk.model.calls.slice(from);
    assert.equal(since.filter((call) => call.tab === tab.name).length, 0);
    assert.equal(since.filter((call) => call.tab === second.name && call.role === 'Scene').length, 1);
    assert.equal(since.filter((call) => call.tab === second.name && call.role === 'Pedant').length, 1);
});

test('14. without browser locks, the second tab is still a watcher', async () => {
    const { walk } = await adopted('2', { locks: false });
    const second = await secondTab(walk);
    await pass(walk, TICK_MS * 3);
    assert.equal(second.panel.headline(), 'Another tab is reading this chat.');
    assert.equal(walk.model.by(second.name).length, 0);
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

/**
 * @param {string} text
 * @param {readonly string[]} secrets
 * @return {boolean}
 */
function carries(text, secrets) {
    return secrets.some((secret) => String(text).includes(secret));
}

test('18. secrets over the whole walk', async () => {
    const walk = world();
    const first = install(walk, '/');
    first.ready();
    await pass(walk, 1000);
    first.go(CHAT);
    await first.openPage();
    await pass(walk, 3000);
    await saveKey(walk, first);
    first.panel.tab('Progress');
    first.panel.type('scribe-setting-budget', '0');
    first.panel.click('scribe-adopt');
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
    tab.panel.tab('Progress');
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
    tab.panel.tab('Progress');
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
    third.show('hidden');
    await pass(walk, TICK_MS * 2);
    await arrive(walk, fourth, ASKED, REPLY);
    await pass(walk, TICK_MS * 2);
    fourth.panel.tab('Progress');
    fourth.panel.click('scribe-adopt');
    await pass(walk, TICK_MS * 2);
    fourth.go('/');
    third.go('/');
    await pass(walk, TICK_MS);
    assert.equal(walk.model.silenced, 0);
    assert.deepEqual(walk.model.strays, []);
    assert.equal(walk.model.of('Notes').length, 1);
    assert.equal(walk.model.of('Suggest').length, 2);
    assert.equal(
        walk.model.calls.slice(failing, spent).filter((call) => call.role === 'Pedant' && call.tab === tab.name).length,
        3,
    );
    assert.equal(afterSpent, spent);
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
