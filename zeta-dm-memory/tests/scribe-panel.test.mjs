import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import CampaignBuilder from './support/CampaignBuilder.mjs';
import FakeChat from './support/FakeChat.mjs';
import FakeStorage from './support/FakeStorage.mjs';
import PanelHarness from './support/PanelHarness.mjs';
import PanelLive from './support/PanelLive.mjs';

const scripts = PanelHarness.load();
const { ScribeIntake, ScribeAnswer, ScribeLog, ScribeReplay, BenchView, ScribeStore, PanelStyle, PanelView } = scripts;
const Phase = scripts.ScribeKeeper.Phase;
const Status = scripts.ScribeLive.Status;
const Kind = scripts.ScribePedant.Kind;

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
const room = 'harbour-room';
const settings = {
    analyzer: 'mistralai/mistral-large-4-0',
    scribe: 'mistralai/mistral-small-3.2-24b-instruct',
    pedant: 'mistralai/mistral-small-3.2-24b-instruct',
    size: 40,
    budget: 3,
    refresh: 6,
};

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
 * @return {object}
 */
function apply(log, text, first, last) {
    const parsed = ScribeAnswer.parse(text);
    assert.deepEqual(plain(parsed.refused), [], text);
    const result = ScribeLog.append(log, replay(log), parsed.operations, {
        messages: story.slice(first - 1, last),
        origin: 'Story',
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
 * @param {object} log
 * @param {object} changes
 * @return {object}
 */
function keeperView(log, changes = {}) {
    let lastRead = null;
    for (const message of story) {
        if (Object.hasOwn(log.read, message.id)) {
            lastRead = { id: message.id, position: message.position };
        }
    }
    return {
        phase: Phase.Idle,
        roomId: room,
        reader: true,
        booked: true,
        total: story.length,
        settled: story.length - 1,
        read: story.filter((message) => Object.hasOwn(log.read, message.id)).length,
        state: replay(log),
        messages: story,
        player: 'Orla',
        settings,
        spentToday: 0.12,
        flight: null,
        stop: null,
        calls: [],
        lines: [],
        problem: null,
        made: BenchView.made(log),
        lastRead,
        unread: story.filter((message) => !Object.hasOwn(log.read, message.id)),
        ...changes,
    };
}

/**
 * @param {object[]} findings
 * @param {object} changes
 * @return {object}
 */
function liveView(findings = [], changes = {}) {
    return {
        now: null,
        ready: null,
        due: false,
        edited: false,
        forced: false,
        forceBlock: null,
        sends: 0,
        findings,
        suggestion: null,
        offer: null,
        understood: null,
        ...changes,
    };
}

/**
 * @param {object} log
 * @param {{ keeper?: object, live?: object, width?: number, storage?: FakeStorage }} options
 * @return {PanelHarness}
 */
function mounted(log, options = {}) {
    return new PanelHarness(scripts, {
        keeper: keeperView(log, options.keeper ?? {}),
        live: options.live ?? liveView(),
        cloud: options.cloud,
        width: options.width,
        storage: options.storage,
    }).mount();
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
function rulingsBook() {
    const log = apply(
        ScribeLog.create(),
        answer({
            SUBJECTS: [
                'Halvard | character',
                'Mirelle | character',
                'Oswin | character',
                'Oswin (the miller) | character',
                'Aldrich | character',
                'Aldric | character',
            ],
            NAMES: ['Brandt | Halvard | #2'],
            FACTS: [
                'Halvard | age | twenty-five | #2',
                'Halvard | age | thirty | #3',
                'Halvard | trait | brave | #3',
                'Halvard | location | the mill | #4',
            ],
            SCENES: ['Day 1 | #1-#4 | The mill | public | present: Halvard | He waits'],
            QUESTIONS: ['Who rang the bell? | #4', 'Does Mirelle trust Halvard? | #3'],
        }),
        1,
        5,
    );
    rule(log, { type: 'Widen', fact: 'F3', to: 'Everyone' });
    return readTo(log, 40);
}

/**
 * @param {string} key
 * @param {string} status
 * @return {object}
 */
function spelling(key, status = Status.Open) {
    return {
        kind: Kind.Spelling,
        message: 'MESSAGE-99',
        position: 99,
        subject: 'S6',
        label: 'Aldric',
        fact: null,
        category: null,
        book: null,
        said: null,
        speaker: null,
        speakerLabel: null,
        written: 'Aldrich',
        key,
        status,
        can: status === Status.Open ? { told: false, spent: false } : null,
    };
}

/**
 * @return {object}
 */
function contradiction() {
    return {
        kind: Kind.Contradiction,
        message: 'MESSAGE-99',
        position: 99,
        subject: 'S2',
        label: 'Mirelle',
        fact: 'F3',
        category: 'eyes',
        book: 'grey',
        said: 'blue',
        speaker: null,
        speakerLabel: null,
        written: null,
        key: 'Contradiction|MESSAGE-99|F3|blue',
        status: Status.Open,
        can: { told: false, spent: false },
    };
}

/**
 * @return {object}
 */
function leak() {
    return {
        kind: Kind.Leak,
        message: 'MESSAGE-99',
        position: 99,
        subject: 'S1',
        label: 'Halvard',
        fact: 'F2',
        category: 'background',
        book: 'deserted at the siege',
        said: 'you ran from the siege',
        speaker: 'S2',
        speakerLabel: 'Mirelle',
        written: null,
        key: 'Leak|MESSAGE-99|F2|S2',
        status: Status.Open,
        can: { told: true, spent: false },
    };
}

/**
 * @return {object}
 */
function findingsBook() {
    const log = apply(
        ScribeLog.create(),
        answer({
            SUBJECTS: [
                'Halvard | character',
                'Mirelle | character',
                'Tamsin | character',
                'Oswin | character',
                'Isolde | character',
                'Aldric | character',
            ],
            FACTS: [
                'Halvard | trait | brave | #2',
                'Halvard | background | deserted at the siege | hidden | #2',
                'Mirelle | eyes | grey | #3',
                'Mirelle | relation to Halvard | owes him a debt | #3',
            ],
        }),
        1,
        3,
    );
    return readTo(log, 40);
}

/**
 * @param {import('./support/PanelElement.mjs').default} element
 * @return {string[]}
 */
function attributeTexts(element) {
    return [...element.attributes.values(), ...element.classes, element.id];
}

test('the headline says what is going on', (context) => {
    context.diagnostic(PanelHarness.used.join('; '));
    const empty = keeperView(ScribeLog.create());
    const live = liveView();
    /**
     * @param {object} changes
     * @return {string}
     */
    const line = (changes) => PanelView.headline({ ...empty, ...changes }, live);
    assert.equal(line({ phase: Phase.Loading }), 'Loading the chat...');
    assert.equal(line({ phase: Phase.NoBook, total: 1326 }), 'No local book: 1,326 messages. Worker unchecked. No DM API key on this PC.');
    assert.equal(line({ phase: Phase.NoBook, total: 999 }), 'No local book: 999 messages. Worker unchecked. No DM API key on this PC.');
    assert.equal(line({ phase: Phase.Reading, flight: 'Reading #81 to #120' }), 'Reading #81 to #120');
    assert.equal(line({ phase: Phase.Idle, flight: 'Pulling the chat: 1,620 messages' }), 'Pulling the chat: 1,620 messages');
    assert.equal(line({ phase: Phase.Idle, read: 1325, total: 1326 }), 'Waiting to read: 1,325 of 1,326 read.');
    assert.equal(line({ phase: Phase.Stopped, stop: { reason: 'Paused', problem: null } }), 'Stopped: Paused.');
    assert.equal(
        line({ phase: Phase.Stopped, stop: { reason: 'Budget', problem: null } }),
        "Stopped: the day's budget is spent.",
    );
    assert.equal(line({ phase: Phase.Stopped, stop: { reason: 'Failed', problem: 'No key' } }), 'Stopped.');
    assert.equal(line({ phase: Phase.Watching, reader: false }), 'Another tab is reading this chat.');
    assert.equal(
        line({ phase: Phase.Idle, read: 1325, total: 1326, problem: 'Zeta answered HTTP 401' }),
        'Waiting to read: 1,325 of 1,326 read.',
    );
    assert.equal(
        line({ phase: Phase.Stopped, stop: null, problem: 'The saved book of this chat is damaged' }),
        'Stopped.',
    );
    assert.equal(
        line({ phase: Phase.Watching, reader: false, flight: 'Looking for new messages' }),
        'Another tab is reading this chat.',
    );
    const panel = mounted(ScribeLog.create(), { keeper: { phase: Phase.NoBook, total: 1326 } });
    assert.equal(panel.text('scribe-headline'), 'No local book: 1,326 messages. Worker unchecked. No DM API key on this PC.');
    assert.equal(panel.text('scribe-spend'), '$0.1200 today');
});

test('the summary is written from the book', () => {
    const log = apply(
        ScribeLog.create(),
        answer({
            SUBJECTS: [
                'Halvard | character',
                'Mirelle | character',
                'Tamsin | character',
                'Oswin | character',
                'Oswin (the miller) | character',
                'Aldrich | character',
                'Aldric | character',
                'Kira | character',
            ],
            FACTS: [
                'Halvard | age | twenty-five | #2',
                'Halvard | age | thirty | #3',
                'Halvard | trait | brave | #2',
                'Halvard | background | served with the pikes | #2',
                'Halvard | relation to Mirelle | owes her a debt | #3',
                'Halvard | title | Warden of the Gate | #3',
                'Halvard | location | the mill | #4',
                'Halvard | role | ferryman | #4',
                'Halvard | trait | fears the dark | hidden | #4',
                'Mirelle | eyes | grey | #2',
                'Mirelle | status | awake | #2',
                'Mirelle | role | innkeeper | #3',
                'Mirelle | trait | keeps a knife | hidden | #3',
                'Tamsin | trait | quick | #5',
                'Kira | trait | sly | #5',
                'Oswin | trait | quiet | #5',
                'Oswin (the miller) | trait | floury | #5',
            ],
            SCENES: [
                'Day 1 | #1-#4 | The mill | public | present: Halvard | He waits',
                'Day 1 | #2-#30 | The long watch | private | present: Halvard | He keeps watch',
                'Day 1 | #5-#8 | The harbour | private | present: Mirelle | She counts',
                'Day 2 | #9-#12 | The gate | public | present: Halvard, Mirelle | They talk',
                'Day 2 | #13-#20 | The road | private | present: Tamsin | She walks',
            ],
            THREADS: ['OPEN | the debt to Brandt | #8', 'OPEN | the missing ring | #9'],
            QUESTIONS: ['Does Mirelle trust Halvard? | #3', 'Who rang the bell? | #4', 'Where is the ring? | #5'],
        }),
        1,
        40,
    );
    apply(log, answer({ THREADS: ['CLOSE T1 | paid in full | #45'] }), 45, 45);
    rule(log, { type: 'Merge', from: 'S8', into: 'S3' });
    rule(log, { type: 'Answer', question: 'Q1', text: 'She does' });
    rule(log, { type: 'Dismiss', question: 'Q3' });
    const state = replay(log);
    assert.deepEqual(
        plain(state.lookAlikes.map((item) => item.reason)).sort(),
        ['SameName', 'Spelling'],
    );
    const summary = plain(PanelView.summary(state));
    assert.deepEqual(summary.needs, { conflicts: 1, lookAlikes: 2, questions: 1 });
    assert.deepEqual(
        summary.cast.map((member) => member.label),
        ['Halvard', 'Mirelle', 'Tamsin', 'Oswin', 'Oswin (the miller)', 'Aldric', 'Aldrich'],
    );
    assert.deepEqual(summary.cast[0], {
        id: 'S1',
        label: 'Halvard',
        kind: 'character',
        lines: ['role: ferryman', 'location: the mill', 'title: Warden of the Gate', 'toward Mirelle: owes her a debt'],
    });
    assert.deepEqual(summary.cast[1].lines, [
        'role: innkeeper',
        'status: awake',
        'eyes: grey',
        'trait: keeps a knife (hidden)',
    ]);
    assert.deepEqual(summary.cast[2].lines, ['trait: quick', 'trait: sly']);
    assert.deepEqual(summary.cast[5].lines, []);
    assert.equal(JSON.stringify(summary.cast).includes('Kira'), false);
    assert.deepEqual(
        summary.standing.map((row) => row.range),
        ['#9-#12', '#13-#20', '#2-#30'],
    );
    assert.deepEqual(summary.standing[2], {
        id: 'MESSAGE-2',
        day: 1,
        range: '#2-#30',
        place: 'The long watch',
        reach: 'private',
        present: 'Halvard',
        summary: 'He keeps watch',
    });
    assert.deepEqual(
        summary.days.map((group) => [group.day, group.scenes.map((row) => row.range)]),
        [
            [1, ['#1-#4', '#2-#30', '#5-#8']],
            [2, ['#9-#12', '#13-#20']],
        ],
    );
    assert.deepEqual(summary.threads, [{ id: 'T2', text: 'the missing ring', position: 9 }]);
    const panel = mounted(log);
    assert.deepEqual(panel.rowTexts('cast').slice(0, 2), [
        'Halvard (character)role: ferrymanlocation: the milltitle: Warden of the Gatetoward Mirelle: owes her a debt',
        'Mirelle (character)role: innkeeperstatus: awakeeyes: greytrait: keeps a knife (hidden)',
    ]);
    assert.deepEqual(panel.rowTexts('threads'), ['the missing ring (#9)']);
    assert.equal(panel.rowTexts('days')[0].startsWith('Day 1'), true);
    assert.equal(panel.rowTexts('days')[3].startsWith('Day 2'), true);
    assert.equal(panel.rowTexts('days')[1].startsWith('Day'), false);
});

test('findings are described in words', () => {
    const state = replay(findingsBook());
    const findings = [
        spelling('Spelling|MESSAGE-99|Aldrich|S6'),
        contradiction(),
        leak(),
        spelling('Spelling|MESSAGE-98|Aldrich|S6', Status.Dismissed),
    ];
    const described = plain(PanelView.findings(state, liveView(findings)));
    assert.deepEqual(described, [
        {
            key: 'Spelling|MESSAGE-99|Aldrich|S6',
            kind: Kind.Spelling,
            status: Status.Open,
            title: 'Name spelt another way',
            detail: '"Aldrich" in the reply; the book has Aldric.',
            actions: ['Dismiss'],
            notes: [],
            draft: null,
        },
        {
            key: 'Contradiction|MESSAGE-99|F3|blue',
            kind: Kind.Contradiction,
            status: Status.Open,
            title: 'The reply contradicts the book',
            detail: 'Mirelle, eyes: the book has grey; the reply says blue.',
            actions: ['Dismiss', 'Rule it...'],
            notes: ["The book's value goes first in the next reminder, if this room may hear it."],
            draft: 'Mirelle, eyes: blue',
        },
        {
            key: 'Leak|MESSAGE-99|F2|S2',
            kind: Kind.Leak,
            status: Status.Open,
            title: 'Someone knows what they were not told',
            detail: 'Mirelle uses that Halvard, background: deserted at the siege. Mirelle was never told.',
            actions: ['Dismiss', 'They were told'],
            notes: ['If the reply should not stand, regenerate it. The next reminder will say who does not know.'],
            draft: null,
        },
        {
            key: 'Spelling|MESSAGE-98|Aldrich|S6',
            kind: Kind.Spelling,
            status: Status.Dismissed,
            title: 'Name spelt another way',
            detail: '"Aldrich" in the reply; the book has Aldric.',
            actions: [],
            notes: [],
            draft: null,
        },
    ]);
    const related = {
        ...contradiction(),
        subject: 'S2',
        fact: 'F4',
        category: 'relation',
        book: 'owes him a debt',
        said: 'paid him back',
        key: 'Contradiction|MESSAGE-99|F4|paid him back',
    };
    assert.equal(
        PanelView.findings(state, liveView([related]))[0].detail,
        'Mirelle toward Halvard: the book has owes him a debt; the reply says paid him back.',
    );
    for (const status of [Status.Dismissed, Status.Accepted, Status.Told]) {
        assert.deepEqual(plain(PanelView.findings(state, liveView([{ ...leak(), status }]))[0].actions), [], status);
    }
});

test('the panel mounts in a shadow root and collapses', () => {
    const log = disputedBook();
    const storage = new FakeStorage();
    const first = mounted(log, { storage });
    assert.equal(first.document.body.children.length, 1);
    assert.equal(first.hosts().length, 1);
    const root = first.root;
    assert.equal(root.mode, 'closed');
    const styles = root.descendants().filter((element) => element.tagName === 'STYLE');
    assert.equal(styles.length, 1);
    assert.equal(root.children.filter((element) => element.tagName === 'STYLE').length, 1);
    assert.equal(styles[0].textContent === PanelStyle.Text, true);
    assert.equal(PanelStyle.Text.length > 1000, true);
    for (const element of first.document.elements) {
        assert.equal(element.attributes.has('style'), false, element.tagName);
        assert.equal([...element.attributes.keys()].some((name) => /^on/i.test(name)), false, element.tagName);
    }
    const colour =
        /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![\w-])(?:black|white|red|green|blue|yellow|orange|purple|pink|gr[ae]y|silver|navy|maroon|teal|olive|lime|aqua|fuchsia)(?![\w-])/i;
    for (const line of PanelStyle.Text.split('\n')) {
        if (colour.test(line)) {
            assert.match(line, /^\s*--[\w-]+\s*:/, line);
        }
    }
    assert.match(PanelStyle.Text, /prefers-reduced-motion/);
    assert.match(PanelStyle.Text, /:focus-visible/);
    assert.equal(first.byId('scribe-body').hidden, false);
    assert.equal(first.text('scribe-toggle'), 'Hide');
    first.click('scribe-toggle');
    assert.equal(first.byId('scribe-body').hidden, true);
    assert.equal(first.byId('scribe-panel').classes.has('collapsed'), true);
    assert.equal(first.byId('scribe-headline').parent.hidden, false);
    assert.equal(first.byId('scribe-headline').hidden, false);
    assert.equal(first.byId('scribe-toggle').hidden, false);
    assert.equal(first.text('scribe-toggle'), 'Scribe');
    assert.equal(first.byId('scribe-toggle').getAttribute('aria-expanded'), 'false');
    assert.equal(first.text('scribe-headline'), 'Waiting to read: 40 of 100 read.');
    assert.equal(storage.values.get('scribe:panel'), 'collapsed');
    const second = mounted(log, { storage });
    assert.equal(second.byId('scribe-body').hidden, true);
    second.click('scribe-toggle');
    assert.equal(second.byId('scribe-body').hidden, false);
    assert.equal(storage.values.get('scribe:panel'), 'open');
    assert.equal(mounted(log, { storage }).byId('scribe-body').hidden, false);
    assert.equal(mounted(log, { storage, width: 900 }).byId('scribe-body').hidden, true);
    assert.equal(mounted(log, { width: 900 }).byId('scribe-body').hidden, true);
    assert.equal(mounted(log, { width: 1099 }).byId('scribe-body').hidden, true);
    assert.equal(mounted(log, { width: 1100 }).byId('scribe-body').hidden, false);
    first.handle.unmount();
    assert.equal(first.document.body.children.length, 0);
    first.redraw();
    assert.equal(first.document.body.children.length, 0);
});

test('a collapsed panel draws only its header', async () => {
    const log = disputedBook();
    const panel = mounted(log);
    await panel.tab('Rulings');
    assert.equal(panel.rows('conflicts').length, 2);
    panel.click('scribe-toggle');
    const built = panel.document.elements.length;
    panel.keeper.current = keeperView(log, { phase: Phase.Reading, flight: 'Reading #41 to #80', spentToday: 0.5 });
    panel.redraw();
    assert.equal(panel.text('scribe-headline'), 'Reading #41 to #80');
    assert.equal(panel.text('scribe-spend'), '$0.5000 today');
    assert.equal(panel.text('scribe-badge'), '2 to rule');
    assert.equal(panel.document.elements.length, built);
    panel.click('scribe-toggle');
    assert.equal(panel.document.elements.length > built, true);
    assert.equal(panel.rows('conflicts').length, 2);
    /**
     * @return {number}
     */
    const items = () => panel.document.elements.filter((element) => element.tagName === 'LI').length;
    await panel.tab('Timeline');
    const before = items();
    panel.redraw();
    assert.equal(items() - before, 1);
});

test('the key is saved and never shown', async () => {
    const key = 'sk-or-v1-halvard-0123456789abcdef';
    const panel = mounted(disputedBook());
    await panel.tab('Settings');
    assert.equal(panel.text('scribe-key-state'), 'No key yet');
    const field = panel.byId('scribe-key');
    assert.equal(field.type, 'password');
    field.value = '   ';
    panel.click('scribe-save-key');
    await panel.flush();
    assert.equal(ScribeStore.key(panel.storage), '');
    assert.equal(panel.storage.count('set'), 0);
    assert.equal(panel.text('scribe-key-outcome'), 'Enter the OpenRouter key.');
    field.value = key;
    panel.click('scribe-save-key');
    await panel.flush();
    assert.equal(ScribeStore.key(panel.storage), key);
    assert.deepEqual(
        panel.storage.calls.filter((call) => call.operation === 'set').map((call) => call.name),
        ['scribe:key'],
    );
    assert.equal(field.value, '');
    assert.equal(panel.text('scribe-key-state'), 'An OpenRouter key is saved');
    assert.equal(panel.text('scribe-key-outcome'), '');
    panel.redraw();
    await panel.tab('Summary');
    await panel.tab('Settings');
    assert.equal(panel.text('scribe-key-state'), 'An OpenRouter key is saved');
    for (const element of panel.document.elements) {
        assert.equal(element.textContent.includes(key), false, element.tagName);
        assert.equal(element.value.includes(key), false, element.tagName);
        assert.equal(attributeTexts(element).some((text) => text.includes(key)), false, element.tagName);
        const written = element.written.filter((item) => element !== field || item.kind !== 'value');
        assert.equal(written.some((item) => item.text.includes(key)), false, element.tagName);
    }
    assert.deepEqual(panel.downloads, []);
});

test('settings are validated before they are saved', async () => {
    const panel = mounted(disputedBook());
    await panel.tab('Settings');
    /**
     * @param {string} name
     * @return {import('./support/PanelElement.mjs').default}
     */
    const field = (name) => panel.byId(`scribe-setting-${name}`);
    const good = {
        analyzer: 'mistralai/test-model',
        scribe: 'mistralai/test-scribe',
        pedant: 'mistralai/test-pedant',
        size: '25',
        budget: '0.5',
        refresh: '4',
    };
    assert.deepEqual(
        Object.keys(good).map((name) => field(name).value),
        ['mistralai/mistral-large-4-0', 'mistralai/mistral-small-3.2-24b-instruct', 'mistralai/mistral-small-3.2-24b-instruct', '40', '3', '6'],
    );
    assert.equal(
        plain(scripts.ScribePanel.Settings.Setup).find((entry) => entry.name === 'refresh').label,
        'User messages between reminders',
    );
    const wrong = [
        ['size', '0', 'Messages per stretch must be a whole number of at least 1.'],
        ['size', '2.5', 'Messages per stretch must be a whole number of at least 1.'],
        ['size', 'forty', 'Messages per stretch must be a whole number of at least 1.'],
        ['refresh', '0', 'User messages between reminders must be a whole number of at least 1.'],
        ['budget', '-1', 'The budget must be a number of dollars, more than 0.'],
        ['budget', 'two', 'The budget must be a number of dollars, more than 0.'],
        ['budget', '0', 'The budget must be a number of dollars, more than 0.'],
        ['analyzer', '', 'Enter a model.'],
        ['pedant', '   ', 'Enter a model.'],
    ];
    for (const [name, value, problem] of wrong) {
        for (const [other, text] of Object.entries(good)) {
            field(other).value = text;
        }
        field(name).value = value;
        panel.click('scribe-save-settings');
        await panel.flush();
        assert.equal(panel.text(`scribe-setting-${name}-problem`), problem, `${name} ${value}`);
        assert.equal(field(name).getAttribute('aria-invalid'), 'true', `${name} ${value}`);
        const marked = Object.keys(good).filter((other) => panel.text(`scribe-setting-${other}-problem`) !== '');
        assert.deepEqual(marked, [name], `${name} ${value}`);
        assert.equal(panel.text('scribe-settings-outcome'), 'Nothing was saved: a field above needs attention.');
        assert.deepEqual(panel.keeper.calls, [], `${name} ${value}`);
    }
    for (const [other, text] of Object.entries(good)) {
        field(other).value = text;
    }
    field('budget').value = '0.01';
    panel.click('scribe-save-settings');
    await panel.flush();
    assert.deepEqual(panel.keeper.called('configure'), [[{ ...good, size: 25, budget: 0.01, refresh: 4 }]]);
    field('budget').value = ' 0.5 ';
    panel.click('scribe-save-settings');
    await panel.flush();
    assert.deepEqual(panel.keeper.calls.length, 2);
    assert.deepEqual(panel.keeper.called('configure')[1], [{ ...good, size: 25, budget: 0.5, refresh: 4 }]);
    for (const name of Object.keys(good)) {
        assert.equal(panel.text(`scribe-setting-${name}-problem`), '', name);
        assert.equal(field(name).getAttribute('aria-invalid'), null, name);
    }
    assert.equal(panel.text('scribe-settings-outcome'), 'Settings saved.');
});

test('adopting asks before replacing a book', async () => {
    const fresh = mounted(ScribeLog.create(), { keeper: { phase: Phase.NoBook } });
    await fresh.tab('Progress');
    assert.equal(fresh.byId('scribe-adopt').hidden, true);
    assert.equal(fresh.text('scribe-next'), 'Start a new local book');
    fresh.confirming = false;
    fresh.click('scribe-next');
    await fresh.flush();
    assert.deepEqual(fresh.questions, []);
    assert.deepEqual(fresh.keeper.called('adopt'), [[settings]]);
    const log = disputedBook();
    const kept = mounted(log);
    await kept.tab('Progress');
    assert.equal(kept.byId('scribe-adopt').hidden, false);
    assert.equal(kept.text('scribe-adopt'), 'Start the book over');
    kept.confirming = false;
    kept.click('scribe-adopt');
    await kept.flush();
    assert.deepEqual(kept.questions, ['Start a new book? It replaces the saved book for this chat.']);
    assert.deepEqual(kept.keeper.calls, []);
    kept.confirming = true;
    kept.click('scribe-adopt');
    await kept.flush();
    assert.equal(kept.questions.length, 2);
    assert.deepEqual(kept.keeper.called('adopt'), [[settings]]);
    const damaged = mounted(ScribeLog.create(), {
        keeper: { phase: Phase.Stopped, problem: 'The saved book of this chat is damaged' },
    });
    await damaged.tab('Progress');
    assert.equal(damaged.text('scribe-adopt'), 'Start the book over');
    damaged.confirming = false;
    damaged.click('scribe-adopt');
    await damaged.flush();
    assert.deepEqual(damaged.keeper.calls, []);
});

test("the summary's counts lead to the rulings", async () => {
    const panel = mounted(rulingsBook());
    assert.equal(panel.section('Summary').hidden, false);
    assert.deepEqual(
        panel.byId('scribe-needs').children.map((element) => element.textContent),
        ['1 conflict', '2 look-alikes', '2 questions'],
    );
    assert.equal(panel.text('scribe-badge'), '5 to rule');
    panel.button(panel.byId('scribe-needs'), '1 conflict').click();
    await panel.flush();
    assert.equal(panel.section('Rulings').hidden, false);
    assert.equal(panel.section('Summary').hidden, true);
    assert.equal(panel.byId('scribe-tab-rulings').getAttribute('aria-selected'), 'true');
    assert.equal(panel.rows('conflicts').length, 1);
    await panel.tab('Summary');
    panel.button(panel.byId('scribe-needs'), '2 questions').click();
    await panel.flush();
    assert.equal(panel.section('Rulings').hidden, false);
    const quiet = mounted(ScribeLog.create());
    assert.equal(quiet.text('scribe-needs'), 'Nothing needs a ruling.');
    assert.equal(quiet.byId('scribe-badge').hidden, true);
});

test('a ruling goes through the keeper and is shown after it is saved', async () => {
    const log = disputedBook();
    const panel = mounted(log);
    await panel.tab('Rulings');
    assert.equal(panel.rows('conflicts').length, 2);
    const held = panel.keeper.hold();
    panel.button(panel.rowSaying('conflicts', 'Halvard, age'), 'thirty (#3), hidden').click();
    assert.deepEqual(panel.keeper.calls, [
        {
            name: 'rule',
            args: [{ type: 'Pin', subject: 'S1', category: 'age', target: null, text: 'thirty', hidden: true }],
        },
    ]);
    assert.equal(panel.rowSaying('conflicts', 'Halvard, age').textContent.includes('Saving...'), true);
    assert.equal(panel.button(panel.rowSaying('conflicts', 'Mirelle, eyes'), 'grey (#2), established').disabled, true);
    held.open();
    await panel.flush();
    assert.equal(panel.rows('conflicts').length, 2);
    assert.equal(panel.rowSaying('conflicts', 'Halvard, age').textContent.includes('Saving...'), false);
    const pinned = rule(disputedBook(), { type: 'Pin', subject: 'S1', category: 'age', target: null, text: 'thirty', hidden: true });
    panel.keeper.current = keeperView(pinned);
    panel.redraw();
    assert.equal(panel.rows('conflicts').length, 1);
    assert.equal(panel.rowTexts('conflicts')[0].startsWith('Mirelle, eyes'), true);
    panel.keeper.failure = new Error('InvalidOperation');
    panel.button(panel.rowSaying('conflicts', 'Mirelle, eyes'), 'blue (#3)').click();
    await panel.flush();
    assert.equal(panel.rows('conflicts').length, 1);
    const refused = panel.rowSaying('conflicts', 'Mirelle, eyes');
    const outcome = refused.children.filter((element) => element.classes.has('outcome'));
    assert.deepEqual(
        outcome.map((element) => element.textContent),
        ['The engine refused this: it is not a valid ruling here.'],
    );
    assert.equal(panel.button(refused, 'blue (#3)').disabled, false);
    panel.keeper.failure = new Error('The book is being read; try again when it has finished this stretch');
    panel.button(panel.rowSaying('conflicts', 'Mirelle, eyes'), 'grey (#2), established').click();
    await panel.flush();
    assert.equal(
        panel.rowSaying('conflicts', 'Mirelle, eyes').textContent.includes(
            'The book is being read; try again when it has finished this stretch',
        ),
        true,
    );
    assert.equal(panel.keeper.calls.length, 3);
});

test('every ruling control reaches the keeper', async () => {
    const log = rulingsBook();
    const panel = mounted(log);
    /**
     * @return {object}
     */
    const last = () => panel.keeper.calls.at(-1);
    await panel.tab('Rulings');
    panel.click('scribe-keep-first');
    await panel.flush();
    assert.deepEqual(last(), { name: 'keepFirst', args: [] });
    assert.equal(panel.text('scribe-keep-outcome'), 'Kept the first value for 1 conflict.');
    const same = panel.rowSaying('likes', 'Oswin and Oswin (the miller)');
    same.descendants().find((element) => element.tagName === 'SELECT').value = 'S4';
    panel.confirming = false;
    panel.button(same, 'Same person').click();
    await panel.flush();
    assert.deepEqual(panel.questions, ['Treat Oswin and Oswin (the miller) as one subject, keeping Oswin (the miller)?']);
    assert.equal(panel.keeper.calls.length, 1);
    panel.confirming = true;
    panel.button(panel.rowSaying('likes', 'Oswin and Oswin (the miller)'), 'Same person').click();
    await panel.flush();
    assert.deepEqual(last(), { name: 'rule', args: [{ type: 'Merge', from: 'S3', into: 'S4' }] });
    panel.button(panel.rowSaying('likes', 'Aldrich and Aldric'), 'Two people').click();
    await panel.flush();
    assert.deepEqual(last(), { name: 'rule', args: [{ type: 'Distinct', first: 'S5', second: 'S6' }] });
    panel.button(panel.rowSaying('scenes', 'The mill'), 'Only those present').click();
    await panel.flush();
    assert.deepEqual(last(), { name: 'rule', args: [{ type: 'Narrow', scene: 'MESSAGE-1' }] });
    const asked = panel.rowSaying('questions', 'Who rang the bell? (#4)');
    panel.inputs(asked, 'text')[0].value = '  Halvard did  ';
    panel.button(asked, 'Answer').click();
    await panel.flush();
    assert.deepEqual(last(), { name: 'rule', args: [{ type: 'Answer', question: 'Q1', text: 'Halvard did' }] });
    panel.button(panel.rowSaying('questions', 'Does Mirelle trust Halvard?'), 'Dismiss').click();
    await panel.flush();
    assert.deepEqual(last(), { name: 'rule', args: [{ type: 'Dismiss', question: 'Q2' }] });
    panel.button(panel.rowSaying('aliases', 'Brandt is a name of Halvard'), 'Not the same').click();
    await panel.flush();
    assert.deepEqual(last(), { name: 'rule', args: [{ type: 'Unalias', subject: 'S1', name: 'Brandt' }] });
    const made = panel.rowSaying('made', 'Widen F3 to Everyone');
    const sequence = panel.keeper.current.made[0].sequence;
    panel.confirming = false;
    panel.button(made, 'Revoke').click();
    await panel.flush();
    assert.equal(panel.questions.at(-1), `Revoke ruling ${sequence} (Widen F3 to Everyone)?`);
    assert.equal(last().name, 'rule');
    panel.confirming = true;
    panel.button(panel.rowSaying('made', 'Widen F3 to Everyone'), 'Revoke').click();
    await panel.flush();
    assert.deepEqual(last(), { name: 'revoke', args: [sequence] });
    await panel.tab('Book');
    panel.button(panel.byId('scribe-list-subjects'), 'Halvard').click();
    await panel.flush();
    assert.equal(panel.text('scribe-subject'), 'Halvard (character)');
    assert.equal(panel.text('scribe-names'), 'Other names: Brandt');
    assert.equal(panel.rows('facts').length, 4);
    panel.byId('scribe-add-category').value = 'trait';
    panel.byId('scribe-add-text').value = ' stubborn ';
    panel.click('scribe-add-file');
    await panel.flush();
    assert.deepEqual(last(), {
        name: 'rule',
        args: [
            {
                type: 'AddFact',
                subject: 'S1',
                category: 'trait',
                target: null,
                text: 'stubborn',
                hidden: false,
                cite: 'MESSAGE-40',
                position: 40,
            },
        ],
    });
    assert.equal(panel.byId('scribe-add-text').value, '');
    assert.equal(panel.text('scribe-add-outcome'), 'Added.');
    const relation = panel.byId('scribe-add-category');
    relation.value = 'relation';
    relation.dispatchEvent({ type: 'change' });
    await panel.flush();
    assert.equal(panel.byId('scribe-add-target-field').hidden, false);
    panel.byId('scribe-add-target').value = 'S2';
    panel.byId('scribe-add-text').value = 'owes her a debt';
    panel.byId('scribe-add-hidden').checked = true;
    panel.keeper.current = { ...panel.keeper.current, lastRead: null };
    panel.click('scribe-add-file');
    await panel.flush();
    assert.deepEqual(last(), {
        name: 'rule',
        args: [
            {
                type: 'AddFact',
                subject: 'S1',
                category: 'relation',
                target: 'S2',
                text: 'owes her a debt',
                hidden: true,
                cite: null,
                position: 0,
            },
        ],
    });
    panel.confirming = false;
    const before = panel.keeper.calls.length;
    panel.button(panel.rowSaying('facts', 'the mill'), 'Remove').click();
    await panel.flush();
    assert.equal(panel.questions.at(-1), 'Remove F4 (the mill) from the book?');
    assert.equal(panel.keeper.calls.length, before);
    panel.confirming = true;
    panel.button(panel.rowSaying('facts', 'the mill'), 'Remove').click();
    await panel.flush();
    assert.deepEqual(last(), { name: 'rule', args: [{ type: 'RemoveFact', fact: 'F4' }] });
    panel.button(panel.rowSaying('facts', 'twenty-five'), 'Make public').click();
    await panel.flush();
    assert.deepEqual(last(), { name: 'rule', args: [{ type: 'Widen', fact: 'F1', to: 'Everyone' }] });
    for (const fact of ['F3', 'F4']) {
        const row = panel.rows('facts').find((item) => item.getAttribute('data-fact') === fact);
        const [box] = panel.inputs(row, 'checkbox');
        box.checked = true;
        box.dispatchEvent({ type: 'change' });
    }
    await panel.flush();
    panel.byId('scribe-split-label').value = 'Halvard the younger';
    panel.byId('scribe-split-kind').value = 'character';
    panel.confirming = false;
    panel.click('scribe-split-file');
    await panel.flush();
    assert.equal(panel.questions.at(-1), 'Move 2 facts to a new subject named Halvard the younger?');
    assert.equal(last().args[0].type, 'Widen');
    panel.confirming = true;
    panel.click('scribe-split-file');
    await panel.flush();
    assert.deepEqual(last(), {
        name: 'rule',
        args: [{ type: 'Split', subject: 'S1', label: 'Halvard the younger', kind: 'character', facts: ['F3', 'F4'] }],
    });
    assert.equal(panel.byId('scribe-split-label').value, '');
    assert.equal(
        panel.rows('facts').filter((row) => panel.inputs(row, 'checkbox').some((box) => box.checked)).length,
        0,
    );
});

test('findings act through the live part', async () => {
    const log = findingsBook();
    const findings = [contradiction(), leak(), spelling('Spelling|MESSAGE-99|Aldrich|S6')];
    const panel = mounted(log, {
        live: liveView(findings, {
            ready: '[Scribe] Mirelle has grey eyes.',
            suggestion: '[Scribe] The bell rings at the gate.',
        }),
    });
    assert.equal(panel.text('scribe-badge'), '3 findings');
    await panel.tab('Findings');
    assert.deepEqual(panel.rowTexts('queued'), ['Suggestion: [Scribe] The bell rings at the gate.']);
    assert.equal(panel.byId('scribe-reminder').value, '[Scribe] Mirelle has grey eyes.');
    assert.equal(panel.rows('findings').length, 3);
    panel.button(panel.rowSaying('findings', 'Aldrich'), 'Dismiss').click();
    await panel.flush();
    assert.deepEqual(panel.live.calls.at(-1), { name: 'dismiss', args: ['Spelling|MESSAGE-99|Aldrich|S6'] });
    panel.button(panel.rowSaying('findings', 'never told'), 'They were told').click();
    await panel.flush();
    assert.deepEqual(panel.live.calls.at(-1), { name: 'told', args: ['Leak|MESSAGE-99|F2|S2'] });
    panel.live.failure = new Error('StaleState');
    panel.button(panel.rowSaying('findings', 'never told'), 'They were told').click();
    await panel.flush();
    assert.equal(
        panel.rowSaying('findings', 'never told').textContent.includes(
            'The engine refused this: the book changed underneath it. Try again.',
        ),
        true,
    );
    assert.equal(panel.rowSaying('findings', 'the reply says blue').textContent.includes('The engine refused'), false);
    panel.live.failure = new Error('Reference');
    panel.button(panel.rowSaying('findings', 'never told'), 'They were told').click();
    await panel.flush();
    assert.equal(
        panel.rowSaying('findings', 'never told').textContent.includes(
            'The engine refused this: it names something the book does not hold.',
        ),
        true,
    );
    panel.click('scribe-clear');
    await panel.flush();
    assert.deepEqual(panel.live.calls.at(-1), { name: 'clear', args: [] });
    assert.deepEqual(
        panel.live.calls.map((call) => call.name),
        ['dismiss', 'told', 'told', 'told', 'clear'],
    );
    assert.deepEqual(panel.keeper.calls, []);
    panel.live.current = liveView([{ ...leak(), status: Status.Told }]);
    panel.redraw();
    assert.deepEqual(panel.actionsWhere('Findings', false), [
        'Edit',
        'Cancel',
        'Save',
        'Clear',
        'Send a reminder with my next message',
        'Suggest one',
    ]);
    assert.equal(panel.byId('scribe-reminder').value, '');
    assert.equal(panel.rowTexts('findings')[0].includes('Marked as told'), true);
    assert.equal(panel.text('scribe-list-queued'), 'None.');
    assert.equal(panel.byId('scribe-badge').hidden, true);
});

test('the box is read-only and shows what will go; Edit opens it, Cancel changes nothing, Save passes the text once', async () => {
    const ready = '[Scribe] Mirelle has grey eyes.';
    const panel = mounted(findingsBook(), { live: liveView([], { ready }) });
    await panel.tab('Findings');
    const box = panel.byId('scribe-reminder');
    const edit = panel.byId('scribe-edit');
    const cancel = panel.byId('scribe-edit-cancel');
    const save = panel.byId('scribe-edit-save');
    assert.equal(box.tagName, 'TEXTAREA');
    assert.equal(box.value, ready);
    assert.equal(box.readOnly, true);
    assert.equal(box.getAttribute('maxlength'), null);
    assert.equal(box.getAttribute('placeholder'), 'No reminder is waiting.');
    assert.equal(box.parent.textContent.includes('Reminder'), true);
    assert.deepEqual([edit.hidden, cancel.hidden, save.hidden], [false, true, true]);
    assert.equal(cancel.parent === save.parent, true);
    assert.deepEqual(
        cancel.parent.children.map((child) => child.textContent),
        ['Edit', 'Cancel', 'Save'],
    );
    assert.equal(save.classes.has('primary'), true);
    assert.equal(cancel.classes.has('primary'), false);

    edit.click();
    await panel.flush();
    assert.equal(box.readOnly, false);
    assert.equal(box.value, ready);
    assert.equal(panel.focused(), `TEXTAREA|scribe-reminder|${ready}`);
    assert.deepEqual([edit.hidden, cancel.hidden, save.hidden], [true, false, false]);
    box.value = 'typed and abandoned';
    box.dispatchEvent({ type: 'input' });
    await panel.flush();
    assert.deepEqual(panel.live.called('edit'), []);
    cancel.click();
    await panel.flush();
    assert.deepEqual(panel.live.called('edit'), []);
    assert.equal(box.readOnly, true);
    assert.equal(box.value, ready);
    assert.deepEqual([edit.hidden, cancel.hidden, save.hidden], [false, true, true]);

    edit.click();
    await panel.flush();
    box.value = '[Scribe] Mirelle has grey eyes!';
    box.dispatchEvent({ type: 'input' });
    panel.redraw();
    assert.equal(box.value, '[Scribe] Mirelle has grey eyes!');
    save.click();
    await panel.flush();
    assert.deepEqual(plain(panel.live.called('edit')), [['[Scribe] Mirelle has grey eyes!', true]]);
    assert.equal(box.readOnly, true);
    assert.deepEqual([edit.hidden, cancel.hidden, save.hidden], [false, true, true]);
    panel.live.current = liveView([], { ready: '[Scribe] Mirelle has grey eyes!', edited: true });
    panel.redraw();
    assert.equal(box.value, '[Scribe] Mirelle has grey eyes!');
    assert.deepEqual(panel.live.called('clear'), []);
    assert.equal(panel.live.called('edit').length, 1);
});

test('a refused save is said under the box, the box stays open and the typed text stays', async () => {
    const panel = mounted(findingsBook(), { live: liveView([], { ready: '[Scribe] Hold.' }) });
    await panel.tab('Findings');
    const box = panel.byId('scribe-reminder');
    const words = 'A reminder may be at most 2,000 bytes; nothing was saved.';
    panel.click('scribe-edit');
    await panel.flush();
    panel.live.refusal = new Error(words);
    box.value = 'x'.repeat(3000);
    panel.click('scribe-edit-save');
    await panel.flush();
    assert.equal(panel.text('scribe-reminder-outcome'), words);
    assert.equal(box.value, 'x'.repeat(3000));
    assert.equal(box.readOnly, false);
    assert.equal(panel.byId('scribe-edit-save').hidden, false);
    panel.redraw();
    assert.equal(box.value, 'x'.repeat(3000));
    panel.live.refusal = null;
    box.value = 'short';
    panel.click('scribe-edit-save');
    await panel.flush();
    assert.equal(panel.text('scribe-reminder-outcome'), '');
    assert.equal(box.readOnly, true);
    assert.equal(panel.live.called('edit').length, 2);
});

test('Save tells the edit whether a line was shown when Edit was pressed', async () => {
    const empty = mounted(findingsBook(), { live: liveView() });
    await empty.tab('Findings');
    const box = empty.byId('scribe-reminder');
    empty.click('scribe-edit');
    await empty.flush();
    assert.equal(box.value, '');
    box.value = 'a';
    box.value = '';
    empty.click('scribe-edit-save');
    await empty.flush();
    assert.deepEqual(plain(empty.live.called('edit')), []);
    assert.equal(box.readOnly, true);

    const composing = mounted(findingsBook(), { live: liveView() });
    await composing.tab('Findings');
    const field = composing.byId('scribe-reminder');
    composing.click('scribe-edit');
    await composing.flush();
    field.dispatchEvent({ type: 'compositionstart', bubbles: true });
    field.value = 'a';
    field.dispatchEvent({ type: 'compositionend', bubbles: true });
    field.value = '';
    composing.click('scribe-edit-save');
    await composing.flush();
    assert.deepEqual(plain(composing.live.called('edit')), []);

    const shown = mounted(findingsBook(), { live: liveView([], { ready: '[Scribe] Hold.' }) });
    await shown.tab('Findings');
    shown.click('scribe-edit');
    await shown.flush();
    assert.equal(shown.byId('scribe-reminder').value, '[Scribe] Hold.');
    shown.byId('scribe-reminder').value = '';
    shown.click('scribe-edit-save');
    await shown.flush();
    assert.deepEqual(plain(shown.live.called('edit')), [['', true]]);

    const arriving = mounted(findingsBook(), { live: liveView() });
    await arriving.tab('Findings');
    arriving.click('scribe-edit');
    await arriving.flush();
    arriving.live.current = liveView([], { ready: '[Scribe] Late.' });
    arriving.redraw();
    assert.equal(arriving.byId('scribe-reminder').value, '');
    arriving.click('scribe-edit-save');
    await arriving.flush();
    assert.deepEqual(plain(arriving.live.called('edit')), []);
});

test('Save with the prefilled text unchanged is a Cancel, and focus returns to Edit', async () => {
    const ready = '[Scribe] Mirelle has grey eyes.';
    const panel = mounted(findingsBook(), { live: liveView([], { ready }) });
    await panel.tab('Findings');
    const box = panel.byId('scribe-reminder');
    panel.byId('scribe-edit').focus();
    panel.click('scribe-edit');
    await panel.flush();
    panel.click('scribe-edit-save');
    await panel.flush();
    assert.deepEqual(plain(panel.live.called('edit')), []);
    assert.equal(box.readOnly, true);
    assert.equal(panel.byId('scribe-edit').hidden, false);
    assert.equal(panel.root.activeElement, panel.byId('scribe-edit'));

    panel.click('scribe-edit');
    await panel.flush();
    box.value = `  ${ready}  `;
    panel.byId('scribe-edit-save').focus();
    panel.click('scribe-edit-save');
    await panel.flush();
    assert.deepEqual(plain(panel.live.called('edit')), []);

    panel.click('scribe-edit');
    await panel.flush();
    box.value = '[Scribe] Changed.';
    panel.byId('scribe-edit-save').focus();
    panel.click('scribe-edit-save');
    await panel.flush();
    assert.deepEqual(plain(panel.live.called('edit')), [['[Scribe] Changed.', true]]);
    assert.equal(panel.root.activeElement, panel.byId('scribe-edit'));

    panel.click('scribe-edit');
    await panel.flush();
    panel.byId('scribe-edit-cancel').focus();
    panel.click('scribe-edit-cancel');
    await panel.flush();
    assert.equal(panel.root.activeElement, panel.byId('scribe-edit'));
});

test('Clear takes the refusal line away with the box', async () => {
    const panel = mounted(findingsBook(), { live: liveView([], { ready: '[Scribe] Hold.' }) });
    await panel.tab('Findings');
    const words = 'A reminder may be at most 2,000 bytes; nothing was saved.';
    panel.click('scribe-edit');
    await panel.flush();
    panel.live.refusal = new Error(words);
    panel.byId('scribe-reminder').value = 'x'.repeat(3000);
    panel.click('scribe-edit-save');
    await panel.flush();
    assert.equal(panel.text('scribe-reminder-outcome'), words);
    panel.click('scribe-clear');
    await panel.flush();
    assert.equal(panel.text('scribe-reminder-outcome'), '');
});

test('while the box is open a reply and a rebuild leave the typed text alone, and Cancel shows the new line', async () => {
    const panel = mounted(findingsBook(), { live: liveView([], { ready: '[Scribe] First.' }) });
    await panel.tab('Findings');
    const box = panel.byId('scribe-reminder');
    panel.click('scribe-edit');
    await panel.flush();
    box.value = 'my own words';
    panel.live.current = liveView([], { ready: '[Scribe] Reply line.', due: true, prepared: true });
    panel.redraw();
    assert.equal(box.value, 'my own words');
    panel.live.current = liveView([], { ready: null, due: true, prepared: true });
    panel.redraw();
    assert.equal(box.value, 'my own words');
    panel.live.current = liveView([], { ready: '[Scribe] Rebuilt line.', due: true, prepared: true });
    panel.redraw();
    assert.equal(box.value, 'my own words');
    assert.equal(box.readOnly, false);
    panel.click('scribe-edit-cancel');
    await panel.flush();
    assert.equal(box.value, '[Scribe] Rebuilt line.');
    assert.equal(box.readOnly, true);
    assert.deepEqual(panel.live.called('edit'), []);
});

test('Findings snapshots the displayed text before an action redraw and preserves it on Cancel', async () => {
    const older = '[Scribe] A';
    const newer = '[Scribe] B';
    const panel = mounted(findingsBook(), { live: liveView([], { stale: true, draft: older }) });
    await panel.tab('Findings');
    const field = panel.byId('scribe-reminder');
    const captured = [];
    panel.live.force = async (resend, text) => {
        captured.push([resend, text]);
        panel.live.current = liveView([], { selected: text, ready: text, forced: true });
    };
    panel.live.current = liveView([], { ready: newer });
    panel.click('scribe-force');
    await panel.flush();
    assert.deepEqual(captured, [[null, older]]);
    assert.equal(field.value, older);
    panel.click('scribe-edit');
    await panel.flush();
    field.value = 'discard';
    panel.click('scribe-edit-cancel');
    await panel.flush();
    assert.equal(field.value, older);
    panel.click('scribe-edit');
    await panel.flush();
    const edit = '<strong>  Å\n雪</strong>';
    field.value = edit;
    panel.click('scribe-force');
    await panel.flush();
    assert.deepEqual(captured.at(-1), [null, edit]);
    assert.equal(field.readOnly, true);
    assert.equal(field.value, edit);
    assert.equal(panel.text('scribe-force-outcome'), 'Queued for your next message');
});

test('while the box is open Clear closes it and the force button still works', async () => {
    const panel = mounted(findingsBook(), { live: liveView([], { ready: '[Scribe] Hold.' }) });
    await panel.tab('Findings');
    const box = panel.byId('scribe-reminder');
    panel.click('scribe-edit');
    await panel.flush();
    box.value = 'half typed';
    panel.click('scribe-force');
    await panel.flush();
    assert.deepEqual(plain(panel.live.called('force')), [[]]);
    assert.equal(box.value, 'half typed');
    assert.equal(box.readOnly, false);
    panel.live.current = liveView([], { ready: null });
    panel.click('scribe-clear');
    await panel.flush();
    assert.deepEqual(panel.live.called('clear'), [[]]);
    assert.equal(box.readOnly, true);
    assert.equal(box.value, '');
    assert.deepEqual(
        [panel.byId('scribe-edit').hidden, panel.byId('scribe-edit-cancel').hidden, panel.byId('scribe-edit-save').hidden],
        [false, true, true],
    );
    assert.deepEqual(panel.live.called('edit'), []);
});

test('the placeholder says a stored edit waits for the book, and the force outcome follows the line', async () => {
    const held = mounted(findingsBook(), { live: liveView([], { edited: true }) });
    await held.tab('Findings');
    assert.equal(held.byId('scribe-reminder').getAttribute('placeholder'), 'Your edit goes once the book is ready.');

    const ready = '[Scribe] Halvard is brave.';
    const panel = mounted(findingsBook(), { live: liveView([], { forced: true, due: true, ready }) });
    await panel.tab('Findings');
    panel.click('scribe-force');
    await panel.flush();
    assert.equal(panel.text('scribe-force-outcome'), 'Queued for your next message');
    panel.live.current = liveView([], { forced: true, due: true, ready: null });
    panel.redraw();
    assert.equal(panel.text('scribe-force-outcome'), 'Waiting for a reminder to be prepared.');
    assert.equal(
        panel.byId('scribe-reminder').getAttribute('placeholder'),
        'Waiting for a reminder to be prepared.',
    );
    panel.live.current = liveView([], { forced: false, ready: null });
    panel.redraw();
    assert.equal(panel.text('scribe-force-outcome'), '');
});

test('Clear sits left of the force button in one row, and the force button answers at once', async () => {
    const panel = mounted(findingsBook(), { live: liveView([], { ready: '[Scribe] Hold.' }) });
    await panel.tab('Findings');
    const clear = panel.byId('scribe-clear');
    const force = panel.byId('scribe-force');
    assert.equal(clear.parent === force.parent, true);
    assert.deepEqual(
        clear.parent.children.map((child) => child.textContent),
        ['Clear', 'Send a reminder with my next message'],
    );
    assert.equal(force.classes.has('primary'), true);
    assert.equal(clear.classes.has('primary'), false);
    const queued = panel.section('Findings').descendants().filter((element) => element.tagName === 'BUTTON');
    assert.equal(queued.indexOf(clear) < queued.indexOf(force), true);
    const hold = panel.live.hold();
    panel.live.current = liveView([], { ready: '[Scribe] Hold.', forced: true });
    force.click();
    assert.equal(panel.text('scribe-force-outcome'), 'Working...');
    assert.equal(force.disabled, true);
    panel.redraw();
    assert.equal(force.disabled, true);
    hold.open();
    await panel.flush();
    assert.deepEqual(plain(panel.live.called('force')), [[]]);
    assert.equal(panel.text('scribe-force-outcome'), 'Queued for your next message');
    assert.equal(force.disabled, false);

    panel.live.failure = new Error('The book has not finished its first reading.');
    force.click();
    await panel.flush();
    assert.equal(panel.text('scribe-force-outcome'), 'The book has not finished its first reading.');
    assert.equal(force.disabled, false);

    const later = mounted(findingsBook(), { live: liveView([], { forced: true }) });
    await later.tab('Findings');
    assert.equal(
        later.byId('scribe-reminder').getAttribute('placeholder'),
        'Waiting for a reminder to be prepared.',
    );
    later.click('scribe-force');
    await later.flush();
    assert.equal(later.text('scribe-force-outcome'), 'Waiting for a reminder to be prepared.');
    later.live.current = liveView([], { forced: false });
    later.redraw();
    assert.equal(later.text('scribe-force-outcome'), '');
    assert.equal(later.byId('scribe-reminder').getAttribute('placeholder'), 'No reminder is waiting.');

    const ready = '[Scribe] Halvard is brave.';
    const waiting = mounted(findingsBook(), { live: liveView([], { forced: true }) });
    await waiting.tab('Findings');
    waiting.click('scribe-force');
    await waiting.flush();
    assert.equal(waiting.text('scribe-force-outcome'), 'Waiting for a reminder to be prepared.');
    waiting.live.current = liveView([], { forced: true, due: true, ready });
    waiting.redraw();
    assert.equal(waiting.text('scribe-force-outcome'), 'Queued for your next message');
    assert.equal(waiting.byId('scribe-reminder').value, ready);
});

test('in a held book the placeholder and the force outcome say what will happen', async () => {
    const held = 'The book holds only part of the chat';
    const hold = { forceBlock: held, due: true };
    const reason = 'Your reminder goes once the book is ready.';

    const prepared = mounted(findingsBook(), { live: liveView([], { due: true, prepared: true, ready: '[Scribe] Hold.' }) });
    await prepared.tab('Findings');
    prepared.live.current = liveView([], { ...hold, prepared: true });
    prepared.redraw();
    assert.equal(prepared.byId('scribe-reminder').getAttribute('placeholder'), reason);
    assert.equal(prepared.text('scribe-force-outcome'), '');
    prepared.live.current = liveView([], { due: true, prepared: true, ready: '[Scribe] Hold.' });
    prepared.redraw();
    assert.equal(prepared.byId('scribe-reminder').getAttribute('placeholder'), 'No reminder is waiting.');

    const quiet = mounted(findingsBook(), { live: liveView([], { forceBlock: held, due: false, prepared: true }) });
    await quiet.tab('Findings');
    assert.equal(quiet.byId('scribe-reminder').getAttribute('placeholder'), 'No reminder is waiting.');

    const forced = mounted(findingsBook(), { live: liveView([], { due: true, prepared: true, forced: true, ready: '[Scribe] Hold.' }) });
    await forced.tab('Findings');
    forced.click('scribe-force');
    await forced.flush();
    assert.equal(forced.text('scribe-force-outcome'), 'Queued for your next message');
    forced.live.current = liveView([], { ...hold, prepared: true, forced: true });
    forced.redraw();
    assert.equal(forced.byId('scribe-reminder').getAttribute('placeholder'), reason);
    assert.equal(forced.text('scribe-force-outcome'), 'Queued for your next message');
    forced.live.current = liveView([], { due: true, prepared: true, forced: true, ready: '[Scribe] Hold.' });
    forced.redraw();
    assert.equal(forced.text('scribe-force-outcome'), 'Queued for your next message');

    const unprepared = mounted(findingsBook(), { live: liveView([], { due: true, forced: true }) });
    await unprepared.tab('Findings');
    unprepared.click('scribe-force');
    await unprepared.flush();
    assert.equal(unprepared.text('scribe-force-outcome'), 'Waiting for a reminder to be prepared.');
    unprepared.live.current = liveView([], { ...hold, forced: true });
    unprepared.redraw();
    assert.equal(unprepared.byId('scribe-reminder').getAttribute('placeholder'), reason);

    const edited = mounted(findingsBook(), { live: liveView([], { due: true, forced: true, edited: true, ready: '[Scribe] Mine.' }) });
    await edited.tab('Findings');
    edited.click('scribe-force');
    await edited.flush();
    assert.equal(edited.text('scribe-force-outcome'), 'Queued for your next message');
    edited.live.current = liveView([], { ...hold, forced: true, edited: true });
    edited.redraw();
    assert.equal(edited.byId('scribe-reminder').getAttribute('placeholder'), 'Your edit goes once the book is ready.');
    assert.equal(edited.text('scribe-force-outcome'), 'Queued for your next message');
    edited.live.current = liveView([], { due: true, forced: true, edited: true, ready: '[Scribe] Mine.' });
    edited.redraw();
    assert.equal(edited.text('scribe-force-outcome'), 'Queued for your next message');
});

test('a forced reminder that becomes ready after the force reads as going with the next message', async () => {
    const panel = mounted(findingsBook(), { live: liveView([], { forced: true, due: true }) });
    await panel.tab('Findings');
    panel.click('scribe-force');
    await panel.flush();
    assert.equal(panel.text('scribe-force-outcome'), 'Waiting for a reminder to be prepared.');
    panel.live.current = liveView([], { forced: true, due: true, prepared: true, ready: '[Scribe] Prepared.' });
    panel.redraw();
    assert.equal(panel.text('scribe-force-outcome'), 'Queued for your next message');
    assert.equal(panel.byId('scribe-reminder').value, '[Scribe] Prepared.');
    panel.live.current = liveView([], { forced: false, due: false });
    panel.redraw();
    assert.equal(panel.text('scribe-force-outcome'), '');
});

test('the box and the force button follow the force block, with its reason', async () => {
    const reason = 'No book yet: adopt this chat first.';
    const panel = mounted(findingsBook(), { live: liveView([], { forceBlock: reason }) });
    await panel.tab('Findings');
    const box = panel.byId('scribe-reminder');
    const force = panel.byId('scribe-force');
    const why = panel.byId('scribe-force-reason');
    const edit = panel.byId('scribe-edit');
    assert.equal(box.disabled, true);
    assert.equal(edit.disabled, true);
    assert.equal(force.disabled, true);
    assert.equal(why.hidden, false);
    assert.equal(why.textContent, reason);
    force.click();
    edit.click();
    await panel.flush();
    assert.deepEqual(panel.live.called('force'), []);
    assert.equal(panel.byId('scribe-edit').hidden, false);
    assert.equal(box.readOnly, true);
    panel.live.current = liveView([], { forceBlock: null });
    panel.redraw();
    assert.equal(box.disabled, false);
    assert.equal(edit.disabled, false);
    assert.equal(force.disabled, false);
    assert.equal(why.hidden, true);
    assert.equal(why.textContent, '');
    edit.click();
    await panel.flush();
    const save = panel.byId('scribe-edit-save');
    assert.equal(save.disabled, false);
    panel.live.current = liveView([], { forceBlock: reason });
    panel.redraw();
    assert.equal(save.disabled, true);
    assert.equal(panel.byId('scribe-edit-cancel').disabled, false);
    assert.equal(box.readOnly, false);
    panel.click('scribe-edit-cancel');
    await panel.flush();
    assert.equal(box.readOnly, true);
    panel.live.current = liveView([], { forceBlock: null });
    panel.redraw();
    panel.live.current = liveView([], { forceBlock: 'The book has not finished its first reading.' });
    panel.redraw();
    assert.equal(box.disabled, true);
    assert.equal(why.textContent, 'The book has not finished its first reading.');
});

test('the Findings tab fits a phone: the box and both buttons wrap and nothing scrolls sideways', async () => {
    const long = liveView([], { ready: `[Scribe] ${'long '.repeat(300)}` });
    const panel = mounted(findingsBook(), { width: 390, live: long });
    panel.click('scribe-toggle');
    await panel.flush();
    await panel.tab('Findings');
    assert.equal(panel.byId('scribe-reminder').tagName, 'TEXTAREA');
    assert.equal(panel.byId('scribe-force').textContent, 'Send a reminder with my next message');
    assert.match(PanelStyle.Text, /\*,\s*\*::before,\s*\*::after \{[^}]*box-sizing: border-box;/);
    assert.match(PanelStyle.Text, /textarea \{[^}]*width: 100%;/);
    assert.match(PanelStyle.Text, /\.actions \{[^}]*flex-wrap: wrap;/);
    assert.doesNotMatch(PanelStyle.Text, /\.actions \{[^}]*(white-space: nowrap|overflow-x: (scroll|auto))/);
    assert.doesNotMatch(PanelStyle.Text, /textarea \{[^}]*(white-space: nowrap|overflow-x: (scroll|auto))/);
});

test('everything is locked while the keeper is busy', async () => {
    const log = rulingsBook();
    const findings = [contradiction(), leak()];
    const panel = mounted(log, { keeper: { phase: Phase.Reading, flight: 'Reading #41 to #80' }, live: liveView(findings) });
    const book = {
        Rulings: [
            'Keep the first value for all',
            'twenty-five (#2), established',
            'thirty (#3)',
            'Pin this value',
            'Two people',
            'Same person',
            'Two people',
            'Same person',
            'Only those present',
            'Dismiss',
            'Answer',
            'Dismiss',
            'Answer',
            'Not the same',
            'Revoke',
        ],
        Book: [...Array(4).fill(['Remove', 'Make public', 'Edit']).flat(), 'Add the fact', 'Split'],
        Findings: ['They were told'],
        Progress: ['Pull the chat again', 'Resume', 'Start the book over'],
        Settings: ['Save settings'],
    };
    const free = {
        Rulings: ['Work it out'],
        Book: ['Aldric', 'Aldrich', 'Halvard', 'Mirelle', 'Oswin', 'Oswin (the miller)'],
        Findings: [
            'Dismiss',
            'Rule it...',
            'Dismiss',
            'Edit',
            'Cancel',
            'Save',
            'Clear',
            'Send a reminder with my next message',
            'Suggest one',
        ],
        Progress: ['Export', 'Pause'],
        Settings: ['Save key'],
    };
    /**
     * @return {Promise<void>}
     */
    const visit = async () => {
        for (const name of Object.keys(book)) {
            await panel.tab(name);
            if (name === 'Book' && panel.byId('scribe-detail').hidden) {
                panel.button(panel.byId('scribe-list-subjects'), 'Halvard').click();
                await panel.flush();
            }
        }
    };
    /**
     * @param {string} name
     * @return {Promise<{ locked: string[], open: string[] }>}
     */
    const seen = async (name) => {
        await panel.tab(name);
        return { locked: panel.actionsWhere(name, true).sort(), open: panel.actionsWhere(name, false).sort() };
    };
    await visit();
    for (const name of Object.keys(book)) {
        const state = await seen(name);
        assert.deepEqual(state.locked, [...book[name]].sort(), name);
        assert.deepEqual(state.open, [...free[name]].sort(), name);
    }
    assert.equal(panel.byId('scribe-toggle').disabled, false);
    assert.equal(panel.byId('scribe-tab-rulings').disabled, false);
    panel.keeper.current = keeperView(log);
    panel.redraw();
    for (const name of Object.keys(book)) {
        const state = await seen(name);
        assert.deepEqual(state.locked, [], name);
        assert.deepEqual(state.open, [...book[name], ...free[name]].sort(), name);
    }
    const held = panel.keeper.hold();
    await panel.tab('Rulings');
    panel.button(panel.rowSaying('conflicts', 'Halvard, age'), 'thirty (#3)').click();
    assert.deepEqual(panel.actionsWhere('Rulings', false), ['Work it out']);
    held.open();
    await panel.flush();
    assert.deepEqual(panel.actionsWhere('Rulings', true), []);
    const loading = mounted(ScribeLog.create(), { keeper: { phase: Phase.Loading } });
    await loading.tab('Progress');
    assert.equal(loading.byId('scribe-adopt').hidden, true);
    assert.equal(loading.byId('scribe-resume').disabled, true);
    const empty = mounted(ScribeLog.create(), { keeper: { phase: Phase.NoBook } });
    await empty.tab('Progress');
    assert.equal(empty.byId('scribe-adopt').hidden, true);
    assert.equal(empty.byId('scribe-next').disabled, false);
    assert.equal(empty.byId('scribe-resume').disabled, true);
    assert.equal(empty.byId('scribe-pause').disabled, false);
});

test('a watching tab changes nothing', async () => {
    const log = rulingsBook();
    const panel = mounted(log, {
        keeper: { phase: Phase.Watching, reader: false },
        live: liveView([contradiction(), leak(), spelling('Spelling|MESSAGE-99|Aldrich|S6')], {
            ready: '[Scribe] Hold.',
            forceBlock: 'Another tab is reading this chat',
        }),
    });
    assert.equal(panel.text('scribe-headline'), 'Another tab is reading this chat.');
    await panel.tab('Rulings');
    assert.equal(panel.rows('conflicts').length, 1);
    assert.equal(panel.rows('questions').length, 2);
    assert.equal(panel.actionsWhere('Rulings', true).length, 16);
    assert.deepEqual(panel.actionsWhere('Rulings', false), []);
    await panel.tab('Book');
    panel.button(panel.byId('scribe-list-subjects'), 'Halvard').click();
    await panel.flush();
    assert.equal(panel.rows('facts').length, 4);
    assert.deepEqual(panel.actionsWhere('Book', false).sort(), ['Aldric', 'Aldrich', 'Halvard', 'Mirelle', 'Oswin', 'Oswin (the miller)']);
    assert.equal(panel.actionsWhere('Book', true).length, 14);
    await panel.tab('Findings');
    assert.equal(panel.rows('findings').length, 3);
    assert.deepEqual(panel.actionsWhere('Findings', false), ['Cancel', 'Rule it...']);
    assert.deepEqual(panel.actionsWhere('Findings', true).sort(), [
        'Clear',
        'Dismiss',
        'Dismiss',
        'Dismiss',
        'Edit',
        'Save',
        'Send a reminder with my next message',
        'Suggest one',
        'They were told',
    ]);
    assert.equal(panel.byId('scribe-reminder').disabled, true);
    assert.equal(panel.text('scribe-force-reason'), 'Another tab is reading this chat');
    await panel.tab('Progress');
    assert.deepEqual(panel.actionsWhere('Progress', false), ['Export']);
    assert.deepEqual(panel.actionsWhere('Progress', true).sort(), [
        'Pause',
        'Pull the chat again',
        'Resume',
        'Start the book over',
    ]);
    await panel.tab('Settings');
    assert.deepEqual(panel.actionsWhere('Settings', false), []);
    assert.deepEqual(panel.actionsWhere('Settings', true).sort(), ['Save key', 'Save settings']);
    for (const name of ['summary', 'book', 'timeline', 'rulings', 'findings', 'progress', 'settings']) {
        assert.equal(panel.byId(`scribe-tab-${name}`).disabled, false, name);
    }
    panel.click('scribe-adopt');
    panel.click('scribe-pause');
    await panel.flush();
    assert.deepEqual(panel.keeper.calls, []);
    assert.deepEqual(panel.live.calls, []);
});

test('a redraw keeps what was typed and where the focus was', async () => {
    const log = rulingsBook();
    const panel = mounted(log);
    await panel.tab('Book');
    const search = panel.byId('scribe-search');
    search.value = 'oswin';
    search.dispatchEvent({ type: 'input' });
    await panel.flush();
    assert.deepEqual(panel.rowTexts('subjects').map((text) => text.split(' ')[0]), ['Oswin', 'Oswin']);
    search.focus();
    panel.redraw();
    assert.equal(search.value, 'oswin');
    assert.equal(panel.focused(), 'INPUT|scribe-search|oswin');
    await panel.tab('Rulings');
    const field = panel.inputs(panel.rowSaying('questions', 'Who rang the bell?'), 'text')[0];
    field.value = 'Halvard did';
    panel.inputs(panel.rowSaying('conflicts', 'Halvard, age'), 'text')[0].value = 'forty';
    field.focus();
    panel.redraw();
    const answer = panel.inputs(panel.rowSaying('questions', 'Who rang the bell?'), 'text')[0];
    assert.equal(answer === field, false, 'the row was drawn again');
    assert.equal(answer.value, 'Halvard did');
    assert.equal(panel.inputs(panel.rowSaying('conflicts', 'Halvard, age'), 'text')[0].value, 'forty');
    assert.equal(panel.root.activeElement === answer, true, 'the focus is on the new answer field');
    await panel.tab('Book');
    assert.equal(search.value, 'oswin');
    await panel.tab('Rulings');
    assert.equal(panel.inputs(panel.rowSaying('questions', 'Who rang the bell?'), 'text')[0].value, 'Halvard did');
    const dismiss = panel.button(panel.rowSaying('questions', 'Does Mirelle trust Halvard?'), 'Dismiss');
    dismiss.focus();
    dismiss.click();
    await panel.flush();
    assert.equal(panel.focused(), 'BUTTON||Dismiss');
    assert.equal(panel.rowSaying('questions', 'Does Mirelle trust Halvard?').descendants().includes(panel.root.activeElement), true);
    const value = panel.button(panel.rowSaying('conflicts', 'Halvard, age'), 'thirty (#3)');
    value.focus();
    const pinned = rule(rulingsBook(), { type: 'Pin', subject: 'S1', category: 'age', target: null, text: 'thirty', hidden: false });
    panel.keeper.current = keeperView(pinned);
    panel.redraw();
    assert.equal(panel.rows('conflicts').length, 0);
    assert.equal(panel.focused(), 'H2|scribe-title-rulings|Rulings');
    const page = panel.document.createElement('textarea');
    panel.document.body.append(page);
    page.focus();
    panel.redraw();
    assert.equal(panel.document.activeElement === page, true, 'the page keeps its focus');
    assert.equal(panel.focused(), 'outside');
});

test('hostile text is text', async () => {
    /**
     * @param {number} number
     * @return {string}
     */
    const hostile = (number) => `<img src=x onerror=alert(${number})> 'quoted' "double"`;
    const label = `Kira <img src=x onerror=alert(1)> 'q' x`;
    const log = apply(
        ScribeLog.create(),
        answer({
            SUBJECTS: [`${label} | character`, 'Halvard | character'],
            FACTS: [`${label} | role | ${hostile(2)} | #2`, 'Halvard | trait | brave | #2'],
            SCENES: [`Day 1 | #1-#4 | The mill | public | present: Halvard | ${hostile(3)}`],
            QUESTIONS: [`${hostile(6)} | #3`],
        }),
        1,
        5,
    );
    readTo(log, 40);
    const finding = {
        ...contradiction(),
        subject: 'S2',
        label: 'Halvard',
        fact: 'F2',
        category: 'trait',
        book: 'brave',
        said: hostile(4),
        key: hostile(7),
    };
    const record = { sequence: null, pass: 'Story', system: 'prompt', input: hostile(8), answer: hostile(5), readable: false };
    const panel = mounted(log, {
        keeper: { calls: [record] },
        live: liveView([finding], { ready: hostile(9) }),
    });
    assert.equal(panel.byId('scribe-list-cast').textContent.includes(label), true);
    assert.equal(panel.byId('scribe-list-cast').textContent.includes(hostile(2)), true);
    assert.equal(panel.byId('scribe-standing').textContent.includes(hostile(3)), true);
    await panel.tab('Book');
    panel.button(panel.byId('scribe-list-subjects'), label).click();
    await panel.flush();
    assert.equal(panel.text('scribe-subject').includes(label), true);
    assert.equal(panel.byId('scribe-list-facts').textContent.includes(hostile(2)), true);
    await panel.tab('Rulings');
    assert.equal(panel.byId('scribe-list-questions').textContent.includes(hostile(6)), true);
    await panel.tab('Findings');
    assert.equal(panel.byId('scribe-list-findings').textContent.includes(hostile(4)), true);
    assert.equal(panel.byId('scribe-reminder').value, hostile(9));
    await panel.tab('Progress');
    assert.equal(panel.byId('scribe-list-calls').textContent.includes(hostile(5)), true);
    assert.equal(panel.byId('scribe-list-calls').textContent.includes('Unreadable answer: Story'), true);
    await panel.tab('Timeline');
    assert.equal(panel.byId('scribe-list-timeline').textContent.includes(hostile(3)), true);
    for (const element of panel.document.elements) {
        assert.notEqual(element.tagName, 'IMG');
        for (const text of attributeTexts(element)) {
            assert.equal(/<|onerror|quoted|double/.test(text), false, `${element.tagName} ${text.slice(0, 40)}`);
        }
        assert.equal(element.children.every((child) => child.tagName !== 'IMG'), true);
    }
    for (const file of ['ScribePanel.js', 'PanelView.js', 'PanelStyle.js']) {
        const source = readFileSync(new URL(`../scribe/page/${file}`, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\.style\b|setAttribute\(\s*['"](?:style|on)/, file);
    }
});

test('export hands over the saved chat', async () => {
    const key = 'sk-or-v1-mirelle-fedcba9876543210';
    const storage = new FakeStorage();
    const log = disputedBook();
    ScribeStore.setKey(storage, key);
    ScribeStore.write(storage, room, 'book', { log, fingerprints: {}, adopted: true });
    ScribeStore.write(storage, room, 'settings', settings);
    ScribeStore.write(storage, 'another-room', 'book', { log: ScribeLog.create(), fingerprints: {}, adopted: false });
    const panel = mounted(log, { storage });
    await panel.tab('Progress');
    panel.click('scribe-export');
    await panel.flush();
    assert.equal(panel.downloads.length, 1);
    const [download] = panel.downloads;
    assert.equal(download.name, 'scribe-harbour-room.json');
    assert.equal(download.text, ScribeStore.exportText(storage, room));
    assert.equal(download.text.includes(key), false);
    const bundle = JSON.parse(download.text);
    assert.equal(bundle.roomId, room);
    assert.equal(bundle.book.log.entries.length, log.entries.length);
    assert.deepEqual(bundle.settings, settings);
    assert.equal(panel.text('scribe-controls-outcome'), 'Exported scribe-harbour-room.json.');
    assert.deepEqual(panel.keeper.calls, []);
});

test('the Progress tab says when the story or the profile could not be read', async () => {
    const notice =
        "The story's characters could not be read, so every character counts as custom: Zeta answered HTTP 404";
    const panel = mounted(disputedBook(), { live: liveView([], { notice }) });
    await panel.tab('Progress');
    const story = panel.byId('scribe-story');
    assert.equal(story.hidden, false);
    assert.equal(story.textContent, notice);
    assert.equal(story.tagName, 'P');
    const controls = panel.byId('scribe-pull').parent;
    const order = controls.parent.children;
    assert.equal(order.indexOf(story) > order.indexOf(controls), true);
    panel.live.current = liveView([], { notice: null });
    panel.redraw();
    assert.equal(panel.byId('scribe-story').hidden, true);
    assert.equal(panel.text('scribe-story'), '');
    panel.live.current = liveView([]);
    panel.redraw();
    assert.equal(panel.byId('scribe-story').hidden, true);
    panel.live.current = liveView([], { notice: `${notice} <b>bold</b>` });
    panel.redraw();
    assert.equal(panel.text('scribe-story'), `${notice} <b>bold</b>`);
    assert.equal(panel.byId('scribe-story').children.length, 0);
    await panel.tab('Findings');
    assert.equal(panel.byId('scribe-story').parent.hidden, true);
    const quiet = mounted(disputedBook());
    await quiet.tab('Progress');
    assert.equal(quiet.byId('scribe-story').hidden, true);
});

test('lists are paged at twenty', async () => {
    const lines = Array.from({ length: 45 }, (unused, index) => `Lantern ${index + 1} | item`);
    const log = readTo(apply(ScribeLog.create(), answer({ SUBJECTS: lines }), 1, 1), 40);
    const findings = Array.from({ length: 25 }, (unused, index) => spelling(`Spelling|MESSAGE-${index}|Aldrich|S6`));
    const panel = mounted(log, { live: liveView(findings) });
    assert.equal(panel.rows('cast').length, 20);
    assert.equal(panel.text('scribe-list-cast-place'), 'Page 1 of 3');
    assert.equal(panel.byId('scribe-list-cast-pager').hidden, false);
    assert.equal(panel.byId('scribe-list-threads-pager').hidden, true);
    await panel.tab('Book');
    assert.equal(panel.rows('subjects').length, 20);
    assert.equal(panel.text('scribe-list-subjects-place'), 'Page 1 of 3');
    assert.equal(panel.byId('scribe-list-subjects-previous').disabled, true);
    panel.click('scribe-list-subjects-next');
    await panel.flush();
    assert.equal(panel.rows('subjects').length, 20);
    panel.click('scribe-list-subjects-next');
    await panel.flush();
    assert.equal(panel.rows('subjects').length, 5);
    assert.equal(panel.text('scribe-list-subjects-place'), 'Page 3 of 3');
    assert.equal(panel.byId('scribe-list-subjects-next').disabled, true);
    await panel.tab('Findings');
    assert.equal(panel.rows('findings').length, 20);
    assert.equal(panel.text('scribe-list-findings-place'), 'Page 1 of 2');
    panel.click('scribe-list-findings-next');
    await panel.flush();
    assert.equal(panel.rows('findings').length, 5);
    assert.equal(panel.text('scribe-badge'), '25 findings');
});

test('a development is offered and used only on request', async () => {
    const panel = mounted(findingsBook());
    await panel.tab('Findings');
    assert.deepEqual(panel.live.calls, []);
    assert.deepEqual(panel.buttonTexts('scribe-offer-actions'), ['Suggest one']);
    assert.equal(panel.byId('scribe-offer-text').hidden, true);
    const asking = panel.live.hold();
    panel.button(panel.byId('scribe-offer-actions'), 'Suggest one').click();
    assert.deepEqual(panel.live.calls, [{ name: 'suggest', args: [] }]);
    assert.equal(panel.text('scribe-offer-outcome'), 'Thinking...');
    assert.deepEqual(panel.buttonsWhere('scribe-offer-actions', false), []);
    asking.open();
    await panel.flush();
    assert.equal(panel.live.called('suggest').length, 1);
    assert.equal(panel.text('scribe-offer-outcome'), 'Nothing fits this scene right now.');
    assert.deepEqual(panel.buttonsWhere('scribe-offer-actions', false), ['Suggest one']);
    panel.redraw();
    assert.equal(panel.text('scribe-offer-outcome'), '');
    const away = panel.live.hold();
    panel.button(panel.byId('scribe-offer-actions'), 'Suggest one').click();
    await panel.tab('Rulings');
    away.open();
    await panel.flush();
    await panel.tab('Findings');
    assert.equal(panel.text('scribe-offer-outcome'), 'Nothing fits this scene right now.');
    panel.redraw();
    assert.equal(panel.text('scribe-offer-outcome'), '');
    panel.live.failure = new Error('No key');
    panel.button(panel.byId('scribe-offer-actions'), 'Suggest one').click();
    await panel.flush();
    assert.equal(panel.text('scribe-offer-outcome'), 'No key');
    const text = 'The bell at the gate rings twice, and Oswin looks up from the nets.';
    panel.live.current = liveView([], { offer: { thread: 'T2', text } });
    panel.redraw();
    assert.equal(panel.text('scribe-offer-text'), text);
    assert.equal(panel.byId('scribe-offer-text').hidden, false);
    assert.deepEqual(panel.buttonTexts('scribe-offer-actions'), ['Ignore', 'Another', 'Use']);
    const again = panel.live.hold();
    panel.button(panel.byId('scribe-offer-actions'), 'Another').click();
    assert.deepEqual(panel.live.calls.at(-1), { name: 'another', args: [] });
    assert.equal(panel.text('scribe-offer-outcome'), 'Thinking...');
    assert.deepEqual(panel.buttonsWhere('scribe-offer-actions', false), []);
    again.open();
    await panel.flush();
    assert.equal(panel.text('scribe-offer-outcome'), '');
    assert.deepEqual(panel.buttonsWhere('scribe-offer-actions', false), ['Ignore', 'Another', 'Use']);
    panel.button(panel.byId('scribe-offer-actions'), 'Use').click();
    await panel.flush();
    assert.deepEqual(panel.live.calls.at(-1), { name: 'use', args: [text] });
    panel.button(panel.byId('scribe-offer-actions'), 'Ignore').click();
    await panel.flush();
    assert.deepEqual(panel.live.calls.at(-1), { name: 'ignore', args: [] });
    assert.deepEqual(
        panel.live.calls.map((call) => call.name),
        ['suggest', 'suggest', 'suggest', 'another', 'use', 'ignore'],
    );
    assert.deepEqual(panel.keeper.calls, []);
    assert.equal(panel.byId('scribe-badge').hidden, true);
});

test('hostile text in an offer stays text', async () => {
    const text = `[Scribe] <img src=x onerror=alert(1)><b>bold</b> "quoted" 'single' &amp; <script>done</script>`;
    const panel = mounted(findingsBook(), { live: liveView([], { offer: { thread: 'T1', text } }) });
    await panel.tab('Findings');
    const shown = panel.byId('scribe-offer-text');
    assert.equal(shown.textContent === text, true, 'the offer is shown character for character');
    assert.equal(shown.textContent.length, text.length);
    assert.equal(shown.children.length, 0);
    for (const element of panel.document.elements) {
        assert.equal(['IMG', 'B', 'SCRIPT'].includes(element.tagName), false, element.tagName);
        assert.equal(attributeTexts(element).some((value) => /<|onerror|quoted/.test(value)), false, element.tagName);
    }
    assert.equal(panel.text('scribe-headline'), 'Waiting to read: 40 of 100 read.');
});

test("the player's words are worked out, shown, then filed", async () => {
    const panel = mounted(disputedBook());
    await panel.tab('Rulings');
    const field = panel.byId('scribe-tell');
    assert.equal(field.tagName, 'TEXTAREA');
    assert.equal(field.getAttribute('maxlength'), '2000');
    assert.equal(field.getAttribute('aria-required'), 'true');
    assert.equal(field.parent.textContent, 'What should the book know? *');
    assert.equal(
        panel.section('Rulings').textContent.includes('This stays with the scribe. It is never sent to the chat.'),
        true,
    );
    field.value = '  \n  ';
    panel.click('scribe-tell-work');
    await panel.flush();
    assert.deepEqual(panel.live.calls, []);
    assert.equal(field.getAttribute('aria-invalid'), 'true');
    assert.equal(panel.text('scribe-tell-outcome'), 'Write what the book should know.');
    field.value = 'x'.repeat(2001);
    panel.click('scribe-tell-work');
    await panel.flush();
    assert.deepEqual(panel.live.calls, []);
    assert.equal(panel.text('scribe-tell-outcome'), 'Write at most 2,000 characters.');
    const words = 'Mirelle is thirty-five, not thirty.\nShe keeps a knife in her boot.';
    field.value = words;
    const held = panel.live.hold();
    panel.click('scribe-tell-work');
    assert.equal(panel.text('scribe-tell-outcome'), 'Reading your words...');
    assert.equal(panel.byId('scribe-tell-work').disabled, true);
    held.open();
    await panel.flush();
    assert.deepEqual(panel.live.calls, [{ name: 'tell', args: [words] }]);
    assert.equal(field.getAttribute('aria-invalid'), null);
    assert.equal(panel.text('scribe-tell-outcome'), '');
    assert.equal(panel.byId('scribe-tell-work').disabled, false);
    const lines = ['Mirelle, age: thirty-five', 'Mirelle, belonging: a knife in her boot', 'Mirelle, eyes: grey'];
    panel.live.current = liveView([], { understood: { lines, refused: [], count: 3 } });
    panel.redraw();
    const understood = panel.byId('scribe-understood');
    assert.deepEqual(
        understood
            .descendants()
            .filter((element) => element.tagName === 'LI')
            .map((element) => element.textContent),
        lines,
    );
    assert.equal(understood.textContent.startsWith('The scribe understood:'), true);
    assert.equal(understood.textContent.includes('could not be used'), false);
    assert.deepEqual(panel.buttonTexts('scribe-understood'), ['Forget', 'File it']);
    panel.button(understood, 'Forget').click();
    await panel.flush();
    assert.deepEqual(panel.live.calls.at(-1), { name: 'forget', args: [] });
    assert.equal(field.value, words);
    panel.button(panel.byId('scribe-understood'), 'File it').click();
    await panel.flush();
    assert.deepEqual(panel.live.called('confirm'), [[]]);
    assert.equal(field.value, '');
    assert.deepEqual(panel.keeper.calls, []);
});

test('nothing understood is said plainly', async () => {
    const refused = [
        { line: 'she is older', reason: 'Shape' },
        { line: 'Mirelle | age', reason: 'Shape' },
    ];
    const panel = mounted(disputedBook(), {
        live: liveView([], { understood: { lines: [], refused, count: 0 } }),
    });
    await panel.tab('Rulings');
    assert.equal(panel.text('scribe-understood'), 'Nothing was understood. Say it another way.Forget');
    assert.deepEqual(panel.buttonTexts('scribe-understood'), ['Forget']);
    panel.live.current = liveView([], { understood: { lines: ['Mirelle, age: thirty-five'], refused, count: 1 } });
    panel.redraw();
    assert.equal(panel.text('scribe-understood').includes('2 lines of the answer could not be used.'), true);
    assert.deepEqual(panel.buttonTexts('scribe-understood'), ['Forget', 'File it']);
    panel.live.current = liveView([], {
        understood: { lines: ['Mirelle, age: thirty-five'], refused: refused.slice(0, 1), count: 1 },
    });
    panel.redraw();
    assert.equal(panel.text('scribe-understood').includes('1 line of the answer could not be used.'), true);
    panel.live.current = liveView();
    panel.redraw();
    assert.equal(panel.text('scribe-understood'), '');
});

test('a filing that fails keeps what was understood', async () => {
    const lines = ['Mirelle, age: thirty-five', 'Halvard, trait: stubborn'];
    const panel = mounted(disputedBook(), { live: liveView([], { understood: { lines, refused: [], count: 2 } }) });
    await panel.tab('Rulings');
    const field = panel.byId('scribe-tell');
    field.value = 'Mirelle is thirty-five. Halvard is stubborn.';
    panel.live.failure = new Error('StaleState');
    panel.button(panel.byId('scribe-understood'), 'File it').click();
    await panel.flush();
    assert.deepEqual(panel.live.called('confirm'), [[]]);
    assert.equal(panel.text('scribe-tell-outcome'), 'The engine refused this: the book changed underneath it. Try again.');
    assert.equal(panel.byId('scribe-understood').descendants().filter((element) => element.tagName === 'LI').length, 2);
    assert.deepEqual(panel.buttonsWhere('scribe-understood', false), ['Forget', 'File it']);
    assert.equal(field.value, 'Mirelle is thirty-five. Halvard is stubborn.');
    panel.live.failure = new Error('The book is being read; try again when it has finished this stretch');
    panel.button(panel.byId('scribe-understood'), 'File it').click();
    await panel.flush();
    assert.equal(
        panel.text('scribe-tell-outcome'),
        'The book is being read; try again when it has finished this stretch',
    );
    assert.equal(field.value, 'Mirelle is thirty-five. Halvard is stubborn.');
});

test('a watcher cannot file or ask', async () => {
    const understood = { lines: ['Mirelle, age: thirty-five'], refused: [], count: 1 };
    const offer = { thread: 'T1', text: 'A rider comes down the road at dusk.' };
    const panel = mounted(disputedBook(), {
        keeper: { phase: Phase.Watching, reader: false },
        live: liveView([], { understood, offer }),
    });
    await panel.tab('Rulings');
    assert.equal(panel.byId('scribe-tell-work').disabled, true);
    assert.deepEqual(panel.buttonsWhere('scribe-understood', true), ['File it']);
    assert.deepEqual(panel.buttonsWhere('scribe-understood', false), ['Forget']);
    await panel.tab('Findings');
    assert.deepEqual(panel.buttonsWhere('scribe-offer-actions', true), ['Another']);
    assert.deepEqual(panel.buttonsWhere('scribe-offer-actions', false), ['Ignore', 'Use']);
    panel.live.current = liveView([], { understood });
    panel.redraw();
    assert.deepEqual(panel.buttonsWhere('scribe-offer-actions', true), ['Suggest one']);
    const busy = mounted(disputedBook(), {
        keeper: { phase: Phase.Reading, flight: 'Reading #41 to #80' },
        live: liveView([], { understood, offer }),
    });
    await busy.tab('Rulings');
    assert.equal(busy.byId('scribe-tell-work').disabled, false);
    assert.deepEqual(busy.buttonsWhere('scribe-understood', true), ['File it']);
    assert.deepEqual(busy.buttonsWhere('scribe-understood', false), ['Forget']);
    await busy.tab('Findings');
    assert.deepEqual(busy.buttonsWhere('scribe-offer-actions', false), ['Ignore', 'Another', 'Use']);
    busy.keeper.current = keeperView(disputedBook());
    busy.redraw();
    await busy.tab('Rulings');
    assert.deepEqual(busy.buttonsWhere('scribe-understood', false), ['Forget', 'File it']);
});

test('typed words survive a redraw', async () => {
    const panel = mounted(disputedBook());
    await panel.tab('Rulings');
    const field = panel.byId('scribe-tell');
    field.value = 'Halvard is the elder brother of Brandt.';
    field.focus();
    panel.redraw();
    assert.equal(panel.byId('scribe-tell').value, 'Halvard is the elder brother of Brandt.');
    assert.equal(panel.focused(), 'TEXTAREA|scribe-tell|Halvard is the elder brother of Brandt.');
    panel.live.current = liveView([], { understood: { lines: ['Halvard, relation to Brandt: elder brother'], refused: [], count: 1 } });
    panel.redraw();
    assert.equal(panel.focused(), 'TEXTAREA|scribe-tell|Halvard is the elder brother of Brandt.');
    await panel.tab('Timeline');
    await panel.tab('Rulings');
    assert.equal(panel.byId('scribe-tell').value, 'Halvard is the elder brother of Brandt.');
});

test('an unexpected error is cleared by the next success', async () => {
    const storage = new FakeStorage();
    storage.values.set('scribe:panel', 'collapsed');
    storage.refuseSetsMatching(/^scribe:panel$/);
    const panel = mounted(findingsBook(), {
        storage,
        live: liveView([leak(), spelling('Spelling|MESSAGE-99|Aldrich|S6')]),
    });
    assert.equal(panel.byId('scribe-trouble').hidden, true);
    panel.click('scribe-toggle');
    await panel.flush();
    assert.equal(panel.byId('scribe-trouble').hidden, false);
    assert.equal(panel.text('scribe-trouble'), 'Something went wrong in the panel: The storage refused to set scribe:panel');
    assert.equal(panel.byId('scribe-body').hidden, false);
    await panel.tab('Findings');
    assert.equal(panel.byId('scribe-trouble').hidden, false);
    panel.live.failure = new Error('Reference');
    panel.button(panel.rowSaying('findings', 'never told'), 'They were told').click();
    await panel.flush();
    assert.equal(panel.byId('scribe-trouble').hidden, false);
    panel.button(panel.rowSaying('findings', 'Aldrich'), 'Dismiss').click();
    await panel.flush();
    assert.deepEqual(panel.live.calls.at(-1), { name: 'dismiss', args: ['Spelling|MESSAGE-99|Aldrich|S6'] });
    assert.equal(panel.byId('scribe-trouble').hidden, true);
    assert.equal(panel.text('scribe-trouble'), '');
});

test('typed text of a row that is gone is forgotten', async () => {
    const log = rulingsBook();
    const panel = mounted(log);
    await panel.tab('Rulings');
    /**
     * @param {string} question
     * @return {import('./support/PanelElement.mjs').default}
     */
    const answerField = (question) => panel.inputs(panel.rowSaying('questions', question), 'text')[0];
    answerField('Who rang the bell?').value = 'Halvard did';
    answerField('Does Mirelle trust Halvard?').value = 'She does';
    await panel.tab('Book');
    await panel.tab('Rulings');
    assert.equal(answerField('Who rang the bell?').value, 'Halvard did');
    assert.equal(answerField('Does Mirelle trust Halvard?').value, 'She does');
    panel.keeper.current = keeperView(rule(rulingsBook(), { type: 'Dismiss', question: 'Q1' }));
    panel.redraw();
    assert.equal(panel.rows('questions').length, 1);
    assert.equal(answerField('Does Mirelle trust Halvard?').value, 'She does');
    panel.keeper.current = keeperView(log);
    panel.redraw();
    assert.equal(panel.rows('questions').length, 2);
    assert.equal(answerField('Who rang the bell?').value, '');
    assert.equal(answerField('Does Mirelle trust Halvard?').value, 'She does');
});

test('a book loading from storage is shown but locked', async () => {
    const log = disputedBook();
    const panel = mounted(log, { keeper: { phase: Phase.Loading, flight: 'Pulling the chat: 620 messages' } });
    assert.equal(panel.text('scribe-headline'), 'Pulling the chat: 620 messages');
    assert.deepEqual(
        panel.rowTexts('cast').map((text) => text.split(' ')[0]),
        ['Halvard', 'Mirelle'],
    );
    assert.equal(panel.text('scribe-badge'), '2 to rule');
    await panel.tab('Rulings');
    assert.equal(panel.rows('conflicts').length, 2);
    assert.deepEqual(panel.actionsWhere('Rulings', false), ['Work it out']);
    assert.equal(panel.actionsWhere('Rulings', true).length, 7);
    await panel.tab('Book');
    assert.deepEqual(panel.actionsWhere('Book', false).sort(), ['Halvard', 'Mirelle']);
    panel.button(panel.byId('scribe-list-subjects'), 'Halvard').click();
    await panel.flush();
    assert.equal(panel.rows('facts').length, 2);
    assert.deepEqual(panel.actionsWhere('Book', true), ['Remove', 'Make public', 'Edit', 'Remove', 'Make public', 'Edit', 'Add the fact', 'Split']);
    await panel.tab('Progress');
    assert.equal(panel.byId('scribe-adopt').hidden, true);
    assert.equal(panel.byId('scribe-pull').disabled, true);
    assert.equal(panel.byId('scribe-pause').disabled, false);
    panel.keeper.current = keeperView(log);
    panel.redraw();
    await panel.tab('Rulings');
    assert.deepEqual(panel.actionsWhere('Rulings', true), []);
});

/**
 * @param {FakeStorage} store
 * @return {{ storage: object, fail: (name: string) => void }}
 */
function failing(store) {
    let refused = null;
    return {
        storage: {
            /**
             * @param {string} name
             * @param {*} fallback
             * @return {*}
             */
            get: (name, fallback) => {
                if (name === refused) {
                    refused = null;
                    throw new Error('The storage could not be read');
                }
                return store.get(name, fallback);
            },
            /**
             * @param {string} name
             * @param {*} value
             * @return {void}
             */
            set: (name, value) => store.set(name, value),
            /**
             * @param {string} name
             * @return {void}
             */
            remove: (name) => store.remove(name),
            /**
             * @return {string[]}
             */
            list: () => store.list(),
        },
        /**
         * @param {string} name
         * @return {void}
         */
        fail: (name) => {
            refused = name;
        },
    };
}

/**
 * @param {import('./support/PanelElement.mjs').default} row
 * @return {string[]}
 */
function buttonStates(row) {
    return row
        .descendants()
        .filter((element) => element.tagName === 'BUTTON')
        .map((element) => `${element.textContent}:${element.disabled}`);
}

/**
 * @param {object} source
 * @param {string} name
 * @return {object}
 */
function breaking(source, name) {
    const copy = { ...source };
    Object.defineProperty(copy, name, {
        enumerable: true,
        /**
         * @return {never}
         * @throws {Error}
         */
        get() {
            throw new Error(`${name} broke`);
        },
    });
    return copy;
}

/**
 * @param {import('./support/PanelElement.mjs').default} root
 * @return {import('./support/PanelElement.mjs').default[]}
 */
function buttonsIn(root) {
    return root.descendants().filter((element) => element.tagName === 'BUTTON');
}

/**
 * @param {number} count
 * @return {object}
 */
function questionsBook(count) {
    const lines = Array.from({ length: count }, (unused, index) => `Question number ${index + 1}? | #${index + 1}`);
    return readTo(apply(ScribeLog.create(), answer({ QUESTIONS: lines }), 1, 40), 40);
}

test('a throw never locks the panel', async () => {
    const log = disputedBook();
    const store = new FakeStorage();
    const broken = failing(store);
    const panel = mounted(log, { storage: broken.storage });
    await panel.tab('Rulings');
    assert.deepEqual(panel.actionsWhere('Rulings', true), []);
    const reading = panel.keeper.view.bind(panel.keeper);
    let throws = 1;
    panel.keeper.view = () => {
        if (throws > 0) {
            throws--;
            throw new Error('The view could not be read');
        }
        return reading();
    };
    panel.button(panel.rowSaying('conflicts', 'Halvard, age'), 'thirty (#3), hidden').click();
    await panel.flush();
    for (let turn = 0; turn < 5; turn++) {
        panel.redraw();
    }
    assert.deepEqual(panel.actionsWhere('Rulings', true), []);
    assert.equal(panel.keeper.called('rule').length, 1);
    await panel.tab('Progress');
    panel.click('scribe-pull');
    await panel.flush();
    assert.equal(panel.keeper.called('pull').length, 1);
    broken.fail('scribe:key');
    await panel.tab('Settings');
    assert.equal(panel.text('scribe-key-state'), 'The key could not be read');
    assert.equal(panel.text('scribe-failure-settings'), '');
    assert.deepEqual(panel.actionsWhere('Settings', true), []);
    panel.redraw();
    assert.equal(panel.text('scribe-key-state'), 'No key yet');
    await panel.tab('Rulings');
    panel.keeper.failure = Object.create(null);
    panel.button(panel.rowSaying('conflicts', 'Mirelle, eyes'), 'blue (#3)').click();
    await panel.flush();
    assert.equal(panel.rowSaying('conflicts', 'Mirelle, eyes').textContent.includes('Something went wrong.'), true);
    for (let turn = 0; turn < 5; turn++) {
        panel.redraw();
    }
    assert.deepEqual(panel.actionsWhere('Rulings', true), []);
    await panel.tab('Progress');
    assert.deepEqual(panel.actionsWhere('Progress', true), []);
    assert.equal(panel.keeper.called('rule').length, 2);
    assert.equal(panel.keeper.called('pull').length, 1);
});

test('a failed draw never unlocks', async () => {
    const log = disputedBook();
    const narrow = mounted(log, { width: 900 });
    assert.equal(narrow.byId('scribe-body').hidden, true);
    assert.equal(narrow.byId('scribe-pull').disabled, true);
    assert.equal(narrow.byId('scribe-keep-first').disabled, true);
    const panel = mounted(log);
    await panel.tab('Rulings');
    assert.equal(panel.byId('scribe-keep-first').disabled, false);
    panel.keeper.current = keeperView(log, { phase: Phase.Watching, reader: false, made: 5 });
    panel.redraw();
    assert.equal(panel.byId('scribe-failure-rulings').hidden, true);
    assert.equal(panel.text('scribe-list-made'), 'None.');
    panel.live.current = liveView([], { understood: breaking({ count: 1, refused: [] }, 'lines') });
    panel.redraw();
    assert.equal(panel.text('scribe-failure-rulings'), 'This tab could not be drawn: lines broke');
    assert.equal(panel.byId('scribe-keep-first').disabled, true);
    assert.deepEqual(panel.buttonTexts('scribe-list-conflicts'), []);
    for (const button of buttonsIn(panel.section('Rulings'))) {
        button.click();
    }
    await panel.flush();
    assert.deepEqual(panel.keeper.calls, []);
    assert.deepEqual(panel.live.calls, []);
    panel.live.current = liveView();
    panel.redraw();
    assert.equal(panel.byId('scribe-failure-rulings').hidden, true);
    assert.equal(panel.rows('conflicts').length, 2);
    assert.deepEqual(panel.buttonsWhere('scribe-list-conflicts', false), []);
    assert.deepEqual(panel.keeper.calls, []);
});

test('a broken tab or row is contained', async () => {
    const escaped = [];
    /**
     * @param {*} error
     * @return {void}
     */
    const record = (error) => {
        escaped.push(String(error));
    };
    process.on('unhandledRejection', record);
    try {
        const log = disputedBook();
        const bare = { now: null, ready: null, due: false, sends: 0, suggestion: null };
        const report = {
            pass: 'Story',
            first: 1,
            last: 40,
            read: 40,
            total: 100,
            spent: 0.01,
            calls: 1,
            unpriced: 0,
            stored: 3,
            refusedLines: [],
            refusedOperations: [],
        };
        const state = replay(log);
        const panel = mounted(log, {
            keeper: {
                state: { ...state, threads: undefined },
                calls: [{ sequence: 3, pass: 'Story', readable: true }],
                lines: [report, { ...report, refusedLines: null }, null, { ...report, first: 41, last: 80 }],
            },
            live: bare,
        });
        assert.equal(panel.text('scribe-headline'), 'Waiting to read: 40 of 100 read.');
        assert.equal(panel.rows('cast').length, 2);
        assert.equal(panel.text('scribe-list-threads'), 'None.');
        await panel.tab('Findings');
        assert.equal(panel.byId('scribe-failure-findings').hidden, true);
        assert.deepEqual(panel.buttonTexts('scribe-offer-actions'), ['Suggest one']);
        assert.equal(panel.text('scribe-list-findings'), 'None.');
        await panel.tab('Rulings');
        assert.equal(panel.byId('scribe-failure-rulings').hidden, true);
        assert.equal(panel.rows('conflicts').length, 2);
        assert.equal(panel.text('scribe-understood'), '');
        await panel.tab('Progress');
        assert.equal(panel.byId('scribe-failure-progress').hidden, true);
        assert.deepEqual(panel.rowTexts('lines'), [
            '#1 to #40: 3 stored, 0 refused, $0.0100 spent, 40 of 100 read',
            '#1 to #40: 3 stored, 0 refused, $0.0100 spent, 40 of 100 read',
            'This entry could not be shown.',
            '#41 to #80: 3 stored, 0 refused, $0.0100 spent, 40 of 100 read',
        ]);
        assert.deepEqual(panel.rowTexts('calls'), ['Call 3: StoryThe answer']);
        panel.live.current = { ...bare, findings: 5 };
        await panel.tab('Findings');
        assert.equal(panel.byId('scribe-failure-findings').hidden, true);
        assert.equal(panel.text('scribe-list-findings'), 'None.');
        panel.live.current = { ...bare, offer: breaking({}, 'text') };
        panel.redraw();
        assert.equal(panel.text('scribe-failure-findings'), 'This tab could not be drawn: text broke');
        assert.equal(panel.text('scribe-headline'), 'Waiting to read: 40 of 100 read.');
        assert.equal(panel.byId('scribe-trouble').hidden, true);
        await panel.tab('Timeline');
        assert.equal(panel.byId('scribe-failure-timeline').hidden, true);
        await panel.tab('Findings');
        panel.click('scribe-toggle');
        await panel.flush();
        assert.equal(panel.byId('scribe-body').hidden, true);
        assert.equal(panel.text('scribe-toggle'), 'Scribe');
        assert.equal(panel.byId('scribe-toggle').getAttribute('aria-expanded'), 'false');
        panel.click('scribe-toggle');
        await panel.flush();
        assert.equal(panel.byId('scribe-body').hidden, false);
        assert.equal(panel.text('scribe-toggle'), 'Hide');
        await panel.flush();
    } finally {
        process.off('unhandledRejection', record);
    }
    assert.deepEqual(escaped, []);
});

test('mounting again replaces', () => {
    const panel = mounted(disputedBook());
    const first = panel.handle;
    assert.equal(panel.hosts().length, 1);
    assert.equal(first.host === panel.hosts()[0], true);
    panel.mount();
    assert.equal(panel.hosts().length, 1);
    assert.equal(panel.document.body.children.length, 1);
    assert.equal(panel.handle.host === panel.hosts()[0], true);
    assert.equal(panel.handle.host === first.host, false);
    panel.handle.unmount();
    assert.equal(panel.hosts().length, 0);
    assert.equal(panel.document.body.children.length, 0);
});

test('adopt uses what the fields show', async () => {
    const panel = mounted(ScribeLog.create(), { keeper: { phase: Phase.NoBook } });
    await panel.tab('Settings');
    panel.byId('scribe-setting-budget').value = '0.01';
    panel.byId('scribe-setting-analyzer').value = 'mistralai/a-cheap-model';
    panel.click('scribe-next');
    await panel.flush();
    assert.deepEqual(panel.keeper.called('adopt'), [
        [{ ...settings, analyzer: 'mistralai/a-cheap-model', budget: 0.01 }],
    ]);
    await panel.tab('Summary');
    panel.byId('scribe-setting-budget').value = '-2';
    panel.click('scribe-next');
    await panel.flush();
    assert.equal(panel.keeper.called('adopt').length, 1);
    assert.equal(panel.byId('scribe-section-settings').hidden, false);
    assert.equal(panel.byId('scribe-section-summary').hidden, true);
    assert.equal(panel.focused(), 'INPUT|scribe-setting-budget|-2');
    assert.equal(panel.byId('scribe-setting-budget').getAttribute('aria-invalid'), 'true');
    assert.equal(panel.text('scribe-setting-budget-problem'), 'The budget must be a number of dollars, more than 0.');
    assert.equal(panel.text('scribe-next-outcome'), 'A field on the Settings tab needs attention.');
    const kept = mounted(disputedBook());
    await kept.tab('Settings');
    kept.byId('scribe-setting-size').value = 'forty';
    kept.byId('scribe-setting-refresh').value = 'many';
    await kept.tab('Progress');
    kept.click('scribe-adopt');
    await kept.flush();
    assert.deepEqual(kept.questions, []);
    assert.deepEqual(kept.keeper.calls, []);
    assert.equal(kept.byId('scribe-section-settings').hidden, false);
    assert.equal(kept.focused(), 'INPUT|scribe-setting-size|forty');
    assert.equal(kept.text('scribe-controls-outcome'), 'A field on the Settings tab needs attention.');
    kept.byId('scribe-setting-size').value = '25';
    kept.byId('scribe-setting-refresh').value = '4';
    await kept.tab('Progress');
    kept.click('scribe-adopt');
    await kept.flush();
    assert.deepEqual(kept.questions, ['Start a new book? It replaces the saved book for this chat.']);
    assert.deepEqual(kept.keeper.called('adopt'), [[{ ...settings, size: 25, refresh: 4 }]]);
});

test("a row's buttons wait together", async () => {
    const panel = mounted(findingsBook(), {
        live: liveView([leak(), spelling('Spelling|MESSAGE-99|Aldrich|S6')]),
    });
    await panel.tab('Findings');
    const held = panel.live.hold();
    panel.button(panel.rowSaying('findings', 'never told'), 'They were told').click();
    assert.deepEqual(buttonStates(panel.rowSaying('findings', 'never told')), ['Dismiss:true', 'They were told:true']);
    assert.deepEqual(buttonStates(panel.rowSaying('findings', 'Aldrich')), ['Dismiss:false']);
    panel.button(panel.rowSaying('findings', 'never told'), 'Dismiss').click();
    assert.deepEqual(
        panel.live.calls.map((call) => call.name),
        ['told'],
    );
    held.open();
    await panel.flush();
    assert.deepEqual(buttonStates(panel.rowSaying('findings', 'never told')), [
        'Dismiss:false',
        'They were told:false',
    ]);
});

test('a Book editor retains a stale draft and a collision refusal but discards the draft on room exit', async () => {
    const log = disputedBook();
    const panel = mounted(log);
    await panel.tab('Book');
    panel.button(panel.byId('scribe-list-subjects'), 'Halvard').click();
    await panel.flush();
    const row = () => panel.rowSaying('facts', 'twenty-five');
    const field = () => row().descendants().find((element) => element.tagName === 'TEXTAREA');
    panel.keeper.rule = async (operation) => ScribeLog.rule(log, replay(log), operation);
    panel.button(row(), 'Edit').click();
    await panel.flush();
    field().value = 'thirty';
    panel.button(row(), 'Save').click();
    await panel.flush();
    assert.match(row().textContent, /combine two facts/);
    assert.equal(field().value, 'thirty');
    field().value = 'forty';
    rule(log, { type: 'Widen', fact: 'F1', to: ['S2'] });
    panel.keeper.current = keeperView(log);
    panel.redraw();
    panel.button(row(), 'Save').click();
    await panel.flush();
    assert.equal(field().value, 'forty');
    assert.ok(!replay(log).facts.some((fact) => fact.text === 'forty'));
    panel.keeper.current = keeperView(log, { roomId: 'another room' });
    panel.redraw();
    panel.keeper.current = keeperView(log);
    panel.redraw();
    assert.equal(field(), undefined);
    panel.button(row(), 'Edit').click();
    await panel.flush();
    assert.equal(field().value, 'twenty-five');
});

test('required fields are asked before the call', async () => {
    const panel = mounted(rulingsBook());
    await panel.tab('Book');
    panel.button(panel.byId('scribe-list-subjects'), 'Halvard').click();
    await panel.flush();
    panel.byId('scribe-add-text').value = '   ';
    panel.click('scribe-add-file');
    await panel.flush();
    assert.deepEqual(panel.keeper.calls, []);
    assert.equal(panel.byId('scribe-add-text').getAttribute('aria-invalid'), 'true');
    assert.equal(panel.text('scribe-add-outcome'), 'Write the fact.');
    panel.click('scribe-split-file');
    await panel.flush();
    assert.deepEqual(panel.questions, []);
    assert.deepEqual(panel.keeper.calls, []);
    assert.equal(panel.byId('scribe-split-label').getAttribute('aria-invalid'), 'true');
    assert.equal(panel.text('scribe-split-outcome'), 'Name the second person.');
    panel.byId('scribe-split-label').value = 'Halvard the younger';
    panel.click('scribe-split-file');
    await panel.flush();
    assert.deepEqual(panel.questions, []);
    assert.deepEqual(panel.keeper.calls, []);
    assert.equal(panel.byId('scribe-split-label').getAttribute('aria-invalid'), null);
    assert.equal(panel.text('scribe-split-outcome'), 'Tick at least one fact to move.');
    await panel.tab('Rulings');
    panel.button(panel.rowSaying('conflicts', 'Halvard, age'), 'Pin this value').click();
    await panel.flush();
    assert.deepEqual(panel.keeper.calls, []);
    const row = panel.rowSaying('conflicts', 'Halvard, age');
    assert.equal(panel.inputs(row, 'text')[0].getAttribute('aria-invalid'), 'true');
    assert.equal(row.textContent.includes('Write the other value.'), true);
    panel.button(panel.rowSaying('conflicts', 'Halvard, age'), 'thirty (#3)').click();
    await panel.flush();
    assert.deepEqual(panel.keeper.calls.at(-1), {
        name: 'rule',
        args: [{ type: 'Pin', subject: 'S1', category: 'age', target: null, text: 'thirty', hidden: false }],
    });
    panel.button(panel.rowSaying('questions', 'Who rang the bell?'), 'Answer').click();
    await panel.flush();
    assert.equal(panel.keeper.calls.length, 1);
    assert.equal(panel.rowSaying('questions', 'Who rang the bell?').textContent.includes('Write the answer.'), true);
    panel.button(panel.rowSaying('questions', 'Who rang the bell?'), 'Dismiss').click();
    await panel.flush();
    assert.deepEqual(panel.keeper.calls.at(-1), { name: 'rule', args: [{ type: 'Dismiss', question: 'Q1' }] });
});

test('a second press does nothing', async () => {
    const panel = mounted(disputedBook());
    await panel.tab('Progress');
    panel.click('scribe-export');
    panel.click('scribe-export');
    await panel.flush();
    assert.equal(panel.downloads.length, 1);
    await panel.tab('Settings');
    panel.byId('scribe-key').value = 'sk-or-v1-oswin-00112233445566';
    panel.click('scribe-save-key');
    panel.click('scribe-save-key');
    await panel.flush();
    assert.equal(panel.storage.calls.filter((call) => call.operation === 'set' && call.name === 'scribe:key').length, 1);
    assert.equal(panel.byId('scribe-key').getAttribute('aria-invalid'), null);
    assert.equal(panel.text('scribe-key-outcome'), '');
    assert.equal(panel.text('scribe-key-state'), 'An OpenRouter key is saved');
    panel.clock.advance(2000);
    panel.click('scribe-export');
    await panel.flush();
    assert.equal(panel.downloads.length, 2);
});

test('the buttons are what can be done', async () => {
    const state = replay(findingsBook());
    const goesFirst = "The book's value goes first in the next reminder, if this room may hear it.";
    const unspent = { told: false, spent: false };
    const findings = [
        { ...contradiction(), key: 'spent', can: { told: false, spent: true } },
        { ...contradiction(), key: 'unspent', can: unspent },
        { ...contradiction(), key: 'stray', can: { ...unspent, correct: '[Scribe] Correction: grey.' } },
        { ...contradiction(), key: 'moving', category: 'location', can: { ...unspent, accept: true } },
        { ...spelling('rumour'), kind: 'Rumour' },
        { ...contradiction(), key: 'missing', label: null, book: undefined, said: null },
        { ...leak(), key: 'no speaker', speakerLabel: null },
    ];
    const described = plain(PanelView.findings(state, liveView(findings)));
    /**
     * @param {string} key
     * @return {object}
     */
    const of = (key) => described.find((item) => item.key === key);
    assert.deepEqual([of('spent').actions, of('spent').notes], [['Dismiss'], ['The book has since changed.']]);
    for (const key of ['unspent', 'stray', 'moving']) {
        assert.deepEqual([of(key).actions, of(key).notes], [['Dismiss', 'Rule it...'], [goesFirst]], key);
    }
    assert.deepEqual(
        [of('rumour').title, of('rumour').detail, of('rumour').actions],
        ['A finding of a kind this panel does not know', '', ['Dismiss']],
    );
    assert.equal(of('missing').detail, '(unknown), eyes: the book has (unknown); the reply says (unknown).');
    assert.equal(
        of('no speaker').detail,
        '(unknown) uses that Halvard, background: deserted at the siege. (unknown) was never told.',
    );
    assert.equal(/null|undefined/.test(JSON.stringify(described.map((item) => [item.title, item.detail, item.notes]))), false);
    assert.deepEqual(
        plain(PanelView.findings(state, liveView([{ ...contradiction(), can: undefined }]))[0].actions),
        ['Dismiss', 'Rule it...'],
    );
    const panel = mounted(findingsBook(), { live: liveView(findings) });
    await panel.tab('Findings');
    assert.deepEqual(buttonStates(panel.rowSaying('findings', 'The book has since changed.')), ['Dismiss:false']);
    assert.deepEqual(
        panel.buttonTexts('scribe-list-findings'),
        [
            'Dismiss',
            'Dismiss',
            'Rule it...',
            'Dismiss',
            'Rule it...',
            'Dismiss',
            'Rule it...',
            'Dismiss',
            'Dismiss',
            'Rule it...',
            'Dismiss',
            'They were told',
        ],
    );
    assert.equal(panel.text('scribe-list-findings').includes(goesFirst), true);
    assert.equal(panel.text('scribe-list-findings').includes('null'), false);
});

test('problems and the last pull are shown', async () => {
    const log = disputedBook();
    const panel = mounted(log, {
        keeper: {
            problem: 'Zeta answered HTTP 401',
            problemSource: 'Zeta',
            pulled: { end: 'NoCursor', count: 1326, skipped: 0, at: 0 },
        },
        live: liveView([], { problem: 'No key' }),
    });
    assert.equal(panel.text('scribe-headline'), 'Waiting to read: 40 of 100 read.');
    assert.match(panel.text('scribe-problems'), /chat history from Zeta/);
    assert.match(panel.text('scribe-problem-details'), /No key/);
    await panel.tab('Progress');
    assert.equal(panel.byId('scribe-pulled').hidden, false);
    assert.equal(panel.text('scribe-pulled'), 'Last pull: 1,326 messages, ended NoCursor');
    panel.keeper.current = keeperView(log, { pulled: { end: 'Limit', count: 1, skipped: 3, at: 0 } });
    panel.redraw();
    assert.equal(panel.text('scribe-pulled'), 'Last pull: 1 message, ended Limit, 3 could not be read');
    panel.keeper.current = keeperView(log, {
        phase: Phase.Stopped,
        stop: { reason: 'Budget', problem: null },
        settings: { ...settings, budget: 5 },
        spentToday: 3,
    });
    panel.live.current = liveView();
    panel.redraw();
    assert.equal(panel.text('scribe-headline'), "Stopped: the day's budget is spent.");
    assert.equal(panel.text('scribe-spend'), '$3.0000 today');
    assert.equal(panel.byId('scribe-pulled').hidden, true);
    panel.keeper.current = keeperView(log, { phase: Phase.NoBook, total: 1 });
    panel.redraw();
    assert.equal(panel.text('scribe-headline'), 'No local book: 1 message. Worker unchecked. No DM API key on this PC.');
});

test('counts are counts of the lists', async () => {
    const log = rulingsBook();
    rule(log, { type: 'Answer', question: 'Q2', text: 'She does not' });
    const panel = mounted(log);
    assert.deepEqual(
        panel.byId('scribe-needs').children.map((element) => element.textContent),
        ['1 conflict', '2 look-alikes', '1 question'],
    );
    assert.equal(panel.text('scribe-badge'), '4 to rule');
    await panel.tab('Rulings');
    const open = panel.rowTexts('questions').filter((text) => !text.includes('Answered;'));
    assert.deepEqual(
        [panel.rows('conflicts').length, panel.rows('likes').length, open.length],
        [1, 2, 1],
    );
    const questions = panel.rowTexts('questions');
    assert.equal(questions.length, 1);
    assert.equal(questions[0].startsWith('Who rang the bell?'), true);
    const [processing] = panel.rows('processing');
    assert.match(processing.textContent, /Does Mirelle trust Halvard\?.*Your answer: She does not/);
    assert.match(processing.textContent, /filed at the next reading/);
    assert.equal(panel.inputs(processing, 'text').length, 0);
    panel.keeper.current = { ...panel.keeper.current, stop: { reason: 'Failed', problem:
        'The answer for the answered questions held no line that could be read.' } };
    panel.redraw();
    assert.equal(panel.inputs(panel.rows('processing')[0], 'text').length, 1);
    const aliased = readTo(
        apply(
            ScribeLog.create(),
            answer({ SUBJECTS: ['Halvard | character', 'Brandt | character'], NAMES: ['Brandt | Halvard | #3'] }),
            1,
            5,
        ),
        40,
    );
    assert.deepEqual(plain(replay(aliased).lookAlikes.map((item) => item.reason)), ['Alias']);
    const alias = mounted(aliased);
    assert.deepEqual(alias.byId('scribe-needs').children.map((element) => element.textContent), ['1 look-alike']);
});

test('the cast shows what it counts', () => {
    const log = readTo(
        apply(
            ScribeLog.create(),
            answer({
                SUBJECTS: ['Halvard | character', 'Mirelle | character', 'Tamsin | character'],
                FACTS: [
                    'Mirelle | trait | keeps a knife | hidden | #2',
                    'Mirelle | trait | hums at night | hidden | #2',
                    'Halvard | trait | brave | #2',
                ],
            }),
            1,
            3,
        ),
        40,
    );
    const cast = plain(PanelView.summary(replay(log)).cast);
    assert.deepEqual(
        cast.map((member) => [member.label, member.lines]),
        [
            ['Mirelle', ['trait: keeps a knife (hidden)', 'trait: hums at night (hidden)']],
            ['Halvard', ['trait: brave']],
            ['Tamsin', []],
        ],
    );
    const panel = mounted(log);
    assert.equal(panel.rowTexts('cast')[0], 'Mirelle (character)trait: keeps a knife (hidden)trait: hums at night (hidden)');
});

test('a refusal is never lost', async () => {
    const panel = mounted(findingsBook(), { live: liveView([leak()]) });
    await panel.tab('Findings');
    const held = panel.live.hold();
    panel.button(panel.rowSaying('findings', 'never told'), 'They were told').click();
    panel.live.current = liveView([]);
    panel.redraw();
    assert.equal(panel.text('scribe-list-findings'), 'None.');
    held.fail(new Error('StaleState'));
    await panel.flush();
    assert.equal(panel.byId('scribe-trouble').hidden, false);
    assert.equal(panel.text('scribe-trouble'), 'The engine refused this: the book changed underneath it. Try again.');
    const quiet = mounted(disputedBook());
    await quiet.tab('Rulings');
    const later = quiet.keeper.hold();
    quiet.button(quiet.rowSaying('conflicts', 'Halvard, age'), 'thirty (#3), hidden').click();
    quiet.click('scribe-toggle');
    later.fail(new Error('Reference'));
    await quiet.flush();
    assert.equal(quiet.text('scribe-trouble'), 'The engine refused this: it names something the book does not hold.');
});

test('typed text survives paging', async () => {
    const log = questionsBook(25);
    const panel = mounted(log);
    await panel.tab('Rulings');
    assert.equal(panel.text('scribe-list-questions-place'), 'Page 1 of 2');
    panel.click('scribe-list-questions-next');
    await panel.flush();
    /**
     * @param {number} number
     * @return {import('./support/PanelElement.mjs').default}
     */
    const answerOf = (number) => panel.inputs(panel.rowSaying('questions', `Question number ${number}?`), 'text')[0];
    answerOf(21).value = 'Halvard rang it at dawn';
    panel.click('scribe-list-questions-previous');
    await panel.flush();
    panel.click('scribe-list-questions-next');
    await panel.flush();
    assert.equal(answerOf(21).value, 'Halvard rang it at dawn');
    answerOf(21).focus();
    panel.keeper.current = keeperView(rule(questionsBook(25), { type: 'Dismiss', question: 'Q1' }));
    panel.redraw();
    assert.equal(panel.text('scribe-list-questions-place'), 'Page 1 of 2');
    assert.equal(answerOf(21).value, 'Halvard rang it at dawn');
    assert.equal(panel.focused(), 'INPUT||Halvard rang it at dawn');
    panel.keeper.current = keeperView(rule(questionsBook(25), { type: 'Dismiss', question: 'Q21' }));
    panel.redraw();
    panel.keeper.current = keeperView(log);
    panel.redraw();
    panel.click('scribe-list-questions-next');
    await panel.flush();
    assert.equal(answerOf(21).value, '');
});

test('a redraw does not disturb typing', async () => {
    const panel = mounted(rulingsBook());
    await panel.tab('Rulings');
    /**
     * @return {import('./support/PanelElement.mjs').default}
     */
    const field = () => panel.inputs(panel.rowSaying('questions', 'Who rang the bell?'), 'text')[0];
    field().value = 'Halvard rang';
    field().setSelectionRange(3, 7, 'forward');
    field().focus();
    for (let turn = 0; turn < 5; turn++) {
        panel.redraw();
    }
    assert.deepEqual(
        [field().value, field().selectionStart, field().selectionEnd, field().selectionDirection],
        ['Halvard rang', 3, 7, 'forward'],
    );
    assert.equal(panel.root.activeElement === field(), true, 'the focus is on the answer field');
    const reading = panel.keeper.view.bind(panel.keeper);
    let views = 0;
    panel.keeper.view = () => {
        views++;
        return reading();
    };
    const before = field();
    before.dispatchEvent({ type: 'compositionstart', bubbles: true });
    panel.redraw();
    panel.redraw();
    panel.redraw();
    assert.equal(field() === before, true, 'no redraw rebuilt the field during the composition');
    assert.equal(views, 0);
    before.dispatchEvent({ type: 'compositionend', bubbles: true });
    assert.equal(views, 1);
    assert.equal(field() === before, false, 'one redraw followed the end');
    assert.equal(field().value, 'Halvard rang');
});

test('filing keeps later words', async () => {
    const panel = mounted(disputedBook());
    await panel.tab('Rulings');
    const field = panel.byId('scribe-tell');
    field.value = 'Mirelle is thirty-five.';
    panel.click('scribe-tell-work');
    await panel.flush();
    field.value = 'Mirelle is thirty-five. She keeps a knife.';
    panel.live.current = liveView([], { understood: { lines: ['Mirelle, age: thirty-five'], refused: [], count: 1 } });
    panel.redraw();
    panel.button(panel.byId('scribe-understood'), 'File it').click();
    await panel.flush();
    assert.deepEqual(panel.live.called('confirm'), []);
    assert.deepEqual(panel.live.called('forget'), [[]]);
    assert.equal(field.value, 'Mirelle is thirty-five. She keeps a knife.');
});

test('narrow windows start collapsed', async () => {
    const storage = new FakeStorage();
    storage.values.set('scribe:panel', 'open');
    const narrow = mounted(disputedBook(), { width: 390, storage });
    assert.equal(narrow.byId('scribe-body').hidden, true);
    narrow.click('scribe-toggle');
    await narrow.flush();
    assert.equal(narrow.byId('scribe-body').hidden, false);
    narrow.click('scribe-toggle');
    await narrow.flush();
    assert.equal(storage.values.get('scribe:panel'), 'open');
    const wide = mounted(disputedBook(), { width: 1400, storage });
    assert.equal(wide.byId('scribe-body').hidden, false);
    wide.document.defaultView.innerWidth = 700;
    wide.click('scribe-toggle');
    await wide.flush();
    assert.equal(storage.values.get('scribe:panel'), 'open');
});

test('destructive actions are never primary or rightmost', async () => {
    const panel = mounted(rulingsBook());
    await panel.tab('Progress');
    const controls = panel.byId('scribe-adopt').parent.children;
    assert.deepEqual(
        controls.map((element) => element.textContent),
        ['Pull the chat again', 'Pause', 'Resume', 'Export', 'Start the book over'],
    );
    assert.equal(panel.byId('scribe-adopt').classes.has('primary'), false);
    const fresh = mounted(ScribeLog.create(), { keeper: { phase: Phase.NoBook } });
    await fresh.tab('Progress');
    assert.equal(fresh.byId('scribe-adopt').hidden, true);
    assert.equal(fresh.byId('scribe-next').classes.has('primary'), true);
    await panel.tab('Rulings');
    assert.deepEqual(
        panel.rowSaying('likes', 'Oswin and Oswin (the miller)')
            .descendants()
            .filter((element) => element.tagName === 'BUTTON')
            .map((element) => element.textContent),
        ['Same person', 'Two people'],
    );
    assert.equal(panel.byId('scribe-split-file').classes.has('primary'), false);
});

test('direction controls are removed and isolated', async () => {
    const override = String.fromCodePoint(0x202e);
    const isolate = String.fromCodePoint(0x2066);
    const panel = mounted(findingsBook(), {
        live: liveView([{ ...spelling('bidi'), written: `Halvar${override}d` }], {
            offer: { thread: 'T1', text: `The bell${isolate} rings${override} twice` },
            understood: { lines: [`Mirelle${override}, age: 35`], refused: [], count: 1 },
        }),
    });
    await panel.tab('Findings');
    assert.equal(panel.text('scribe-offer-text'), 'The bell rings twice');
    assert.equal(panel.rowTexts('findings')[0].includes('"Halvard" in the reply; the book has Aldric.'), true);
    await panel.tab('Rulings');
    assert.equal(panel.text('scribe-understood').includes('Mirelle, age: 35'), true);
    for (const element of panel.document.elements) {
        assert.equal(element.textContent.includes(override) || element.textContent.includes(isolate), false, element.tagName);
    }
    assert.match(PanelStyle.Text, /unicode-bidi: isolate;/);
});

test('a failed key save does not echo the key', async () => {
    const key = 'sk-or-v1-tamsin-a1b2c3d4e5f6';
    const storage = new FakeStorage().refuseSetsMatching(/^scribe:key$/);
    const panel = mounted(disputedBook(), { storage });
    await panel.tab('Settings');
    panel.byId('scribe-key').value = key;
    panel.click('scribe-save-key');
    await panel.flush();
    const outcome = panel.text('scribe-key-outcome');
    assert.equal(outcome, 'The key could not be saved');
    for (let start = 0; start + 6 <= key.length; start++) {
        assert.equal(outcome.includes(key.slice(start, start + 6)), false, String(start));
    }
    assert.equal(panel.text('scribe-key-state'), 'No key yet');
});

test("the review's surviving mutants", async () => {
    const panel = mounted(disputedBook());
    await panel.tab('Rulings');
    panel.byId('scribe-tell').value = 'x'.repeat(2000);
    panel.click('scribe-tell-work');
    await panel.flush();
    assert.equal(panel.live.called('tell').length, 1);
    assert.equal(panel.text('scribe-tell-outcome'), '');
    const many = mounted(questionsBook(25));
    await many.tab('Rulings');
    many.click('scribe-list-questions-next');
    await many.flush();
    many.keeper.current = keeperView(questionsBook(5));
    many.redraw();
    assert.equal(many.text('scribe-list-questions-place'), 'Page 1 of 1');
    const book = mounted(rulingsBook());
    await book.tab('Book');
    book.button(book.byId('scribe-list-subjects'), 'Halvard').click();
    await book.flush();
    book.button(book.rowSaying('facts', 'twenty-five'), 'Make public').click();
    await book.flush();
    assert.deepEqual(book.questions, []);
    assert.deepEqual(book.keeper.calls.at(-1), { name: 'rule', args: [{ type: 'Widen', fact: 'F1', to: 'Everyone' }] });
    const held = book.keeper.hold();
    book.byId('scribe-add-text').value = 'stubborn';
    book.click('scribe-add-file');
    assert.equal(book.text('scribe-add-outcome'), 'Saving...');
    held.open();
    await book.flush();
    assert.equal(book.text('scribe-add-outcome'), 'Added.');
    book.byId('scribe-add-text').value = 'stubborn';
    book.keeper.failure = new Error('InvalidOperation');
    book.click('scribe-add-file');
    await book.flush();
    assert.equal(book.byId('scribe-add-text').value, 'stubborn');
    assert.equal(book.text('scribe-add-outcome'), 'The engine refused this: it is not a valid ruling here.');
    book.keeper.failure = new Error('toString');
    book.click('scribe-add-file');
    await book.flush();
    assert.equal(book.text('scribe-add-outcome'), 'toString');
    const style = PanelStyle.Text;
    assert.match(style, /\[hidden\] \{\n {4}display: none !important;/);
    assert.match(style, /button:focus-visible,[\s\S]*?\{\n {4}outline: 3px solid var\(--scribe-focus\);/);
    assert.match(style, /width: min\(var\(--scribe-width\), 100vw\);/);
    assert.match(style, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*transition: none !important;/);
    const related = readTo(
        apply(
            ScribeLog.create(),
            answer({
                SUBJECTS: ['Halvard | character', 'Mirelle | character'],
                NAMES: ['Brandt | Halvard | #2'],
                FACTS: ['Mirelle | relation to Brandt | owes him a debt | #3'],
            }),
            1,
            3,
        ),
        40,
    );
    const state = replay(related);
    const fact = state.facts.find((item) => item.category === 'relation');
    assert.deepEqual([fact.target, fact.targetText], ['S1', 'Brandt']);
    const finding = {
        ...contradiction(),
        fact: fact.id,
        category: 'relation',
        book: 'owes him a debt',
        said: 'paid him back',
    };
    assert.equal(
        PanelView.findings(state, liveView([finding]))[0].detail,
        'Mirelle toward Halvard: the book has owes him a debt; the reply says paid him back.',
    );
    const scenes = readTo(
        apply(
            ScribeLog.create(),
            answer({
                SUBJECTS: ['Halvard | character'],
                SCENES: [
                    'Day 2 | #1-#4 | The gate | public | present: Halvard | He waits',
                    'Day 1 | #5-#8 | The mill | public | present: Halvard | He works',
                ],
            }),
            1,
            8,
        ),
        40,
    );
    assert.deepEqual(
        plain(PanelView.summary(replay(scenes)).days.map((group) => group.day)),
        [1, 2],
    );
    const lines = Array.from(
        { length: 25 },
        (unused, index) => `Day 1 | #${index + 1}-#${index + 1} | Place ${index + 1} | public | present: Halvard | Waiting`,
    );
    const days = mounted(readTo(apply(ScribeLog.create(), answer({ SUBJECTS: ['Halvard | character'], SCENES: lines }), 1, 25), 40));
    days.click('scribe-list-days-next');
    await days.flush();
    assert.equal(days.rowTexts('days')[0].startsWith('Day 1#21-#21'), true);
});

test("the export's name is safe", async () => {
    const roomId = `../../<img src=x onerror=alert(1)>${'x'.repeat(100)}`;
    const panel = mounted(disputedBook(), { keeper: { roomId } });
    await panel.tab('Progress');
    panel.click('scribe-export');
    await panel.flush();
    const [download] = panel.downloads;
    assert.match(download.name, /^scribe-[A-Za-z0-9_-]+\.json$/);
    assert.equal(download.name.length, 'scribe-'.length + 60 + '.json'.length);
    assert.equal(download.name.startsWith('scribe-_______img_src_x_onerror_alert_1__x'), true);
});

test("a contradiction is ruled through the player's own words", async () => {
    const state = replay(findingsBook());
    const finding = {
        ...contradiction(),
        subject: 'S1',
        label: 'Halvard',
        said: 'blue eyes',
        key: 'Contradiction|MESSAGE-99|F3|blue eyes',
    };
    const spent = { ...contradiction(), key: 'spent', can: { told: false, spent: true } };
    const dismissed = { ...contradiction(), key: 'dismissed', status: Status.Dismissed, can: null };
    const panel = mounted(findingsBook(), { live: liveView([finding, spent, dismissed]) });
    await panel.tab('Findings');
    assert.deepEqual(buttonStates(panel.rowSaying('findings', 'blue eyes')), ['Dismiss:false', 'Rule it...:false']);
    assert.deepEqual(buttonStates(panel.rowSaying('findings', 'The book has since changed.')), ['Dismiss:false']);
    assert.deepEqual(buttonStates(panel.rowSaying('findings', 'Dismissed')), []);
    panel.button(panel.rowSaying('findings', 'blue eyes'), 'Rule it...').click();
    await panel.flush();
    assert.deepEqual(panel.live.calls, []);
    assert.deepEqual(panel.keeper.calls, []);
    assert.equal(panel.section('Rulings').hidden, false);
    assert.equal(panel.section('Findings').hidden, true);
    assert.equal(panel.byId('scribe-tell').value, 'Halvard, eyes: blue eyes');
    assert.equal(panel.focused(), 'TEXTAREA|scribe-tell|Halvard, eyes: blue eyes');
    panel.byId('scribe-tell').value = 'Mirelle is thirty-five.';
    await panel.tab('Findings');
    panel.button(panel.rowSaying('findings', 'blue eyes'), 'Rule it...').click();
    await panel.flush();
    assert.equal(panel.byId('scribe-tell').value, 'Mirelle is thirty-five.\nHalvard, eyes: blue eyes');
    assert.equal(panel.focused(), 'TEXTAREA|scribe-tell|Mirelle is thirty-five.\nHalvard, eyes: blue eyes');
    assert.deepEqual(panel.live.calls, []);
    const related = {
        ...contradiction(),
        fact: 'F4',
        category: 'relation',
        book: 'owes him a debt',
        said: 'paid him back',
    };
    assert.equal(PanelView.findings(state, liveView([related]))[0].draft, 'Mirelle toward Halvard: paid him back');
    const unknown = { ...related, fact: 'F99' };
    assert.equal(PanelView.findings(state, liveView([unknown]))[0].draft, 'Mirelle, relation: paid him back');
});

test('a leak offers no correction', async () => {
    const state = replay(findingsBook());
    const regenerate = 'If the reply should not stand, regenerate it. The next reminder will say who does not know.';
    const odd = { ...leak(), key: 'odd', can: { correct: '[Scribe] Correction: a secret.', told: true, spent: false } };
    const untold = { ...leak(), key: 'untold', can: { told: false, spent: false } };
    const described = plain(PanelView.findings(state, liveView([leak(), odd, untold])));
    assert.deepEqual(
        described.map((item) => [item.actions, item.notes]),
        [
            [['Dismiss', 'They were told'], [regenerate]],
            [['Dismiss', 'They were told'], [regenerate]],
            [['Dismiss'], [regenerate]],
        ],
    );
    const panel = mounted(findingsBook(), { live: liveView([odd, untold]) });
    await panel.tab('Findings');
    const rows = panel.rows('findings');
    assert.deepEqual(buttonStates(rows[0]), ['Dismiss:false', 'They were told:false']);
    assert.deepEqual(buttonStates(rows[1]), ['Dismiss:false']);
    assert.equal(rows[0].textContent.includes(regenerate), true);
});

test('a situation finding is shown with both quotes and a Dismiss', async () => {
    const state = replay(findingsBook());
    const situation = {
        kind: Kind.Situation,
        message: 'MESSAGE-99',
        position: 99,
        subject: null,
        label: null,
        fact: null,
        category: null,
        book: 'We camp for three nights getting there',
        said: 'You have a bed?',
        speaker: null,
        speakerLabel: null,
        written: null,
        key: 'Situation|MESSAGE-99|you have a bed?',
        status: Status.Open,
        can: { told: false, spent: false },
    };
    const hint = 'If the reply should not stand, regenerate it.';
    const [open] = plain(PanelView.findings(state, liveView([situation])));
    assert.deepEqual(open, {
        key: situation.key,
        kind: Kind.Situation,
        status: Status.Open,
        title: "The reply doesn't fit what's happening",
        detail: 'The reply says "You have a bed?"; earlier: "We camp for three nights getting there".',
        actions: ['Dismiss'],
        notes: [hint],
        draft: null,
    });
    const [gone] = plain(PanelView.findings(state, liveView([{ ...situation, status: Status.Dismissed }])));
    assert.deepEqual([gone.title, gone.actions, gone.notes], [open.title, [], []]);

    const panel = mounted(findingsBook(), { live: liveView([situation]) });
    assert.equal(panel.text('scribe-badge'), '1 finding');
    await panel.tab('Findings');
    const rows = panel.rows('findings');
    assert.equal(rows.length, 1);
    assert.deepEqual(buttonStates(rows[0]), ['Dismiss:false']);
    assert.equal(rows[0].textContent.includes(hint), true);
    assert.equal(rows[0].textContent.includes('We camp for three nights getting there'), true);
    panel.button(rows[0], 'Dismiss').click();
    await panel.flush();
    assert.deepEqual(panel.live.calls.at(-1), { name: 'dismiss', args: [situation.key] });
});

test('accept is gone', async () => {
    const state = replay(findingsBook());
    const shapes = [
        { correct: '[Scribe] Correction: grey.', accept: true, told: false, spent: false },
        { accept: true },
        { correct: null, told: true, spent: false },
        null,
        undefined,
    ];
    const findings = [];
    for (const [index, can] of shapes.entries()) {
        for (const made of [contradiction(), leak(), spelling(`spelling-${index}`)]) {
            findings.push({ ...made, key: `${made.key}-${index}`, can });
        }
    }
    const described = plain(PanelView.findings(state, liveView(findings)));
    assert.equal(described.length, 15);
    assert.equal(described.some((item) => item.actions.includes('Accept the reply')), false);
    assert.equal(Object.values(plain(PanelView.Settings.Actions)).includes('Accept the reply'), false);
    const panel = mounted(findingsBook(), { live: liveView(findings.slice(0, 12)) });
    await panel.tab('Findings');
    assert.equal(panel.buttonTexts('scribe-list-findings').includes('Accept the reply'), false);
    panel.click('scribe-list-findings-next');
    await panel.flush();
    assert.equal(panel.buttonTexts('scribe-list-findings').includes('Accept the reply'), false);
    assert.equal(panel.text('scribe-section-findings').includes('Accepting'), false);
});

test('nothing to file is not filed', async () => {
    const nothing = 'Nothing in the book would change.';
    const panel = mounted(disputedBook(), {
        live: liveView([], { understood: { lines: [nothing], refused: [], count: 1 } }),
    });
    await panel.tab('Rulings');
    assert.equal(panel.text('scribe-understood'), `${nothing}Forget`);
    assert.deepEqual(panel.buttonTexts('scribe-understood'), ['Forget']);
    panel.live.current = liveView([], { understood: { lines: [nothing], refused: [], count: 0 } });
    panel.redraw();
    assert.deepEqual(panel.buttonTexts('scribe-understood'), ['Forget']);
    assert.equal(panel.text('scribe-understood').includes('Nothing was understood'), false);
    panel.live.current = liveView([], {
        understood: { lines: [nothing, 'Mirelle, age: thirty-five'], refused: [], count: 1 },
    });
    panel.redraw();
    assert.deepEqual(panel.buttonTexts('scribe-understood'), ['Forget', 'File it']);
});

test('a failed draw leaves nothing to press', async () => {
    const log = findingsBook();
    const healthy = ['Dismiss', 'Rule it...', 'Dismiss', 'They were told'];
    const panel = mounted(log, { live: liveView([contradiction(), leak()]) });
    await panel.tab('Findings');
    assert.deepEqual(panel.buttonsWhere('scribe-list-findings', false), healthy);
    const earlier = buttonsIn(panel.byId('scribe-list-findings'));
    /**
     * @return {boolean}
     */
    const stale = () => buttonsIn(panel.section('Findings')).some((button) => earlier.includes(button));
    panel.keeper.current = keeperView(log, { reader: false });
    panel.live.current = liveView([breaking(contradiction(), 'label'), leak()]);
    panel.redraw();
    assert.equal(panel.byId('scribe-failure-findings').hidden, true);
    assert.equal(panel.rowTexts('findings')[0], 'This entry could not be shown.');
    assert.equal(stale(), false);
    for (const button of buttonsIn(panel.byId('scribe-list-findings'))) {
        button.click();
    }
    await panel.flush();
    assert.deepEqual(panel.live.calls, []);
    await panel.tab('Findings');
    const broken = liveView([contradiction(), leak()], { offer: breaking({}, 'text') });
    for (const changes of [{ reader: false }, { flight: 'Reading #41 to #80' }]) {
        panel.keeper.current = keeperView(log);
        panel.live.current = liveView([contradiction(), leak()]);
        panel.redraw();
        assert.deepEqual(panel.buttonsWhere('scribe-list-findings', false), healthy);
        earlier.splice(0, earlier.length, ...buttonsIn(panel.byId('scribe-list-findings')));
        panel.keeper.current = keeperView(log, changes);
        panel.live.current = broken;
        panel.redraw();
        assert.equal(panel.text('scribe-failure-findings'), 'This tab could not be drawn: text broke');
        assert.equal(stale(), false, JSON.stringify(changes));
        assert.deepEqual(panel.buttonTexts('scribe-list-findings'), []);
        assert.deepEqual(panel.buttonTexts('scribe-offer-actions'), []);
        assert.equal(panel.byId('scribe-list-findings-pager').hidden, true);
        for (const button of buttonsIn(panel.byId('scribe-list-findings'))) {
            button.click();
        }
        await panel.flush();
        assert.deepEqual(panel.live.calls, [], JSON.stringify(changes));
    }
    panel.keeper.current = keeperView(log);
    panel.live.current = liveView([contradiction(), leak()]);
    panel.redraw();
    assert.equal(panel.byId('scribe-failure-findings').hidden, true);
    assert.deepEqual(panel.buttonsWhere('scribe-list-findings', false), healthy);
    assert.equal(panel.text('scribe-badge'), '2 findings');
    assert.equal(panel.text('scribe-headline'), 'Waiting to read: 40 of 100 read.');
    panel.keeper.current = keeperView(log, { state: null });
    panel.redraw();
    assert.equal(panel.text('scribe-headline'), '');
    assert.equal(panel.text('scribe-badge'), '');
    assert.equal(panel.byId('scribe-badge').hidden, true);
    assert.equal(panel.text('scribe-spend'), '');
    assert.equal(panel.text('scribe-trouble').startsWith('Something went wrong in the panel: '), true);
    panel.keeper.current = keeperView(log);
    panel.redraw();
    assert.equal(panel.text('scribe-headline'), 'Waiting to read: 40 of 100 read.');
    assert.equal(panel.text('scribe-badge'), '2 findings');
});

test('one bad row never takes its neighbours', async () => {
    const log = findingsBook();
    const good = spelling('Spelling|MESSAGE-99|Aldrich|S6');
    const bad = [breaking(contradiction(), 'key'), breaking(contradiction(), 'label'), null];
    for (const [index, entry] of bad.entries()) {
        const panel = mounted(log, { live: liveView([entry, good]) });
        await panel.tab('Findings');
        assert.equal(panel.byId('scribe-failure-findings').hidden, true, String(index));
        assert.equal(panel.byId('scribe-trouble').hidden, true, String(index));
        assert.deepEqual(panel.rowTexts('findings').length, 2, String(index));
        assert.equal(panel.rowTexts('findings')[0], 'This entry could not be shown.', String(index));
        assert.deepEqual(buttonStates(panel.rows('findings')[1]), ['Dismiss:false'], String(index));
        panel.button(panel.rows('findings')[1], 'Dismiss').click();
        await panel.flush();
        assert.deepEqual(panel.live.called('dismiss'), [[good.key]], String(index));
    }
    const ruled = rulingsBook();
    const healthy = mounted(ruled);
    const badge = healthy.text('scribe-badge');
    await healthy.tab('Rulings');
    const conflicts = healthy.rowTexts('conflicts');
    const questions = healthy.rowTexts('questions');
    const made = healthy.rowTexts('made');
    const state = replay(ruled);
    const rulings = BenchView.made(ruled);
    const panel = mounted(ruled, {
        keeper: {
            state: { ...state, conflicts: [null, ...state.conflicts], questions: [...state.questions, null] },
            made: [breaking(rulings[0], 'sequence'), ...rulings],
        },
    });
    assert.equal(panel.text('scribe-badge'), badge);
    assert.equal(panel.byId('scribe-trouble').hidden, true);
    await panel.tab('Summary');
    assert.equal(panel.text('scribe-needs'), healthy.text('scribe-needs'));
    await panel.tab('Rulings');
    assert.equal(panel.byId('scribe-failure-rulings').hidden, true);
    assert.deepEqual(panel.rowTexts('conflicts'), ['This entry could not be shown.', ...conflicts]);
    assert.deepEqual(panel.rowTexts('questions'), [...questions, 'This entry could not be shown.']);
    assert.deepEqual(panel.rowTexts('made'), ['This entry could not be shown.', ...made]);
    assert.deepEqual(panel.actionsWhere('Rulings', true), []);
    panel.live.current = liveView([], { understood: { lines: ['Mirelle, age: thirty-five'], count: 1 } });
    panel.redraw();
    assert.equal(panel.byId('scribe-failure-rulings').hidden, true);
    assert.equal(panel.text('scribe-understood').includes('Mirelle, age: thirty-five'), true);
    assert.deepEqual(panel.buttonTexts('scribe-understood'), ['Forget', 'File it']);
});

test('a missing reason is said in words', async () => {
    const empty = { phase: Phase.Stopped, total: 1, read: 0, flight: null, problem: null };
    for (const stop of [{ reason: 'Failed', problem: null }, { reason: 'Failed' }, { reason: 'Failed', problem: ' ' }]) {
        assert.equal(PanelView.headline({ ...empty, stop }, {}), 'Stopped.');
        assert.deepEqual(plain(PanelView.problems({ ...empty, stop }, {})[0].details), ['The reason was not recorded.']);
    }
    assert.equal(
        PanelView.headline({ ...empty, stop: { reason: 'Failed', problem: 'The key was refused.' } }, {}),
        'Stopped.',
    );
    const log = disputedBook();
    const panel = mounted(log, {
        keeper: { phase: Phase.Stopped, stop: { reason: 'Failed', problem: null }, lastRead: null, pulled: null },
        live: liveView([contradiction(), leak()]),
    });
    assert.equal(panel.text('scribe-headline'), 'Stopped.');
    assert.match(panel.text('scribe-problem-details'), /reason was not recorded/);
    const texts = [];
    for (const name of ['Summary', 'Book', 'Timeline', 'Rulings', 'Findings', 'Progress']) {
        await panel.tab(name);
        texts.push(panel.root.textContent);
    }
    await panel.tab('Book');
    panel.button(panel.byId('scribe-list-subjects'), 'Halvard').click();
    await panel.flush();
    texts.push(panel.root.textContent);
    assert.deepEqual(
        texts.filter((text) => /\b(?:null|undefined)\b/.test(text)).length,
        0,
    );
});

test('they were told is a book call', async () => {
    const log = disputedBook();
    const understood = { lines: ['Mirelle, age: thirty-five'], refused: [], count: 1 };
    const panel = mounted(log, { live: liveView([leak()], { understood }) });
    await panel.tab('Book');
    panel.button(panel.byId('scribe-list-subjects'), 'Halvard').click();
    await panel.flush();
    panel.byId('scribe-add-text').value = 'has a scar';
    await panel.tab('Findings');
    const telling = panel.live.hold();
    panel.button(panel.rows('findings')[0], 'They were told').click();
    await panel.flush();
    assert.deepEqual(panel.live.called('told'), [[leak().key]]);
    await panel.tab('Rulings');
    for (const button of buttonsIn(panel.byId('scribe-list-conflicts'))) {
        button.click();
    }
    panel.button(panel.byId('scribe-understood'), 'File it').click();
    panel.click('scribe-keep-first');
    await panel.flush();
    await panel.tab('Book');
    panel.click('scribe-add-file');
    await panel.flush();
    assert.deepEqual(panel.keeper.calls, []);
    assert.deepEqual(panel.live.called('confirm'), []);
    telling.open();
    await panel.flush();
    await panel.tab('Rulings');
    assert.deepEqual(panel.buttonsWhere('scribe-list-conflicts', true), []);
    const ruling = panel.keeper.hold();
    panel.button(panel.rowSaying('conflicts', 'Halvard, age'), 'thirty (#3), hidden').click();
    await panel.flush();
    assert.equal(panel.keeper.called('rule').length, 1);
    await panel.tab('Findings');
    panel.button(panel.rows('findings')[0], 'They were told').click();
    await panel.flush();
    assert.equal(panel.live.called('told').length, 1);
    ruling.open();
    await panel.flush();
    panel.keeper.current = keeperView(log, { phase: Phase.Watching, reader: false });
    panel.redraw();
    panel.button(panel.rows('findings')[0], 'They were told').click();
    await panel.flush();
    assert.equal(panel.live.called('told').length, 1);
});

test('rule it does not repeat itself', async () => {
    const other = { ...contradiction(), said: 'green', key: 'Contradiction|MESSAGE-99|F3|green' };
    const panel = mounted(findingsBook(), { live: liveView([contradiction(), other]) });
    /**
     * @param {string} said
     * @return {Promise<void>}
     */
    const press = async (said) => {
        await panel.tab('Findings');
        panel.button(panel.rowSaying('findings', `the reply says ${said}.`), 'Rule it...').click();
        await panel.flush();
    };
    await press('blue');
    await press('blue');
    assert.equal(panel.byId('scribe-tell').value, 'Mirelle, eyes: blue');
    assert.equal(panel.section('Rulings').hidden, false);
    assert.equal(panel.focused(), 'TEXTAREA|scribe-tell|Mirelle, eyes: blue');
    await press('green');
    assert.equal(panel.byId('scribe-tell').value, 'Mirelle, eyes: blue\nMirelle, eyes: green');
    await press('blue');
    await press('green');
    assert.equal(panel.byId('scribe-tell').value, 'Mirelle, eyes: blue\nMirelle, eyes: green');
    assert.deepEqual(panel.live.calls, []);
});

test('the draft fits the field', async () => {
    const state = replay(findingsBook());
    const long = { ...contradiction(), said: 'a'.repeat(3000) };
    const draft = PanelView.findings(state, liveView([long]))[0].draft;
    const opening = 'Mirelle, eyes: ';
    assert.equal(draft.startsWith(opening), true);
    const reply = draft.slice(opening.length);
    assert.equal(reply.length, 200);
    assert.equal(reply, `${'a'.repeat(197)}...`);
    assert.equal(PanelView.findings(state, liveView([{ ...long, said: 'a'.repeat(200) }]))[0].draft, opening + 'a'.repeat(200));
    const panel = mounted(findingsBook(), { live: liveView([contradiction()]) });
    await panel.tab('Rulings');
    const filled = 'b'.repeat(1990);
    panel.byId('scribe-tell').value = filled;
    await panel.tab('Findings');
    panel.button(panel.rows('findings')[0], 'Rule it...').click();
    await panel.flush();
    assert.equal(panel.byId('scribe-tell').value, filled);
    assert.equal(panel.text('scribe-tell-outcome'), 'The field is full: clear it or file it first.');
    assert.equal(panel.section('Rulings').hidden, false);
    assert.equal(panel.root.activeElement === panel.byId('scribe-tell'), true);
    panel.byId('scribe-tell').value = 'b'.repeat(1980);
    await panel.tab('Findings');
    panel.button(panel.rows('findings')[0], 'Rule it...').click();
    await panel.flush();
    assert.equal(panel.byId('scribe-tell').value, `${'b'.repeat(1980)}\nMirelle, eyes: blue`);
    assert.equal(panel.text('scribe-tell-outcome'), '');
    assert.deepEqual(panel.live.calls, []);
});

test('a composition is released by blur', async () => {
    const panel = mounted(rulingsBook());
    await panel.tab('Rulings');
    const reading = panel.keeper.view.bind(panel.keeper);
    let views = 0;
    panel.keeper.view = () => {
        views++;
        return reading();
    };
    for (const leaving of [{ type: 'blur' }, { type: 'focusout', bubbles: true }]) {
        views = 0;
        const field = panel.byId('scribe-tell');
        field.focus();
        field.dispatchEvent({ type: 'compositionstart', bubbles: true });
        panel.click('scribe-tab-summary');
        await panel.flush();
        assert.equal(views, 0, leaving.type);
        assert.equal(panel.section('Summary').hidden, true, leaving.type);
        field.dispatchEvent(leaving);
        assert.equal(views, 1, leaving.type);
        assert.equal(panel.section('Summary').hidden, false, leaving.type);
        field.dispatchEvent({ type: 'compositionend', bubbles: true });
        assert.equal(views, 1, leaving.type);
        await panel.tab('Rulings');
        assert.equal(panel.section('Rulings').hidden, false, leaving.type);
    }
});

test('a budget of 0 is refused', async () => {
    for (const budget of ['0', '0.00', '.0']) {
        const panel = mounted(disputedBook());
        await panel.tab('Progress');
        panel.byId('scribe-setting-budget').value = budget;
        panel.click('scribe-adopt');
        await panel.flush();
        assert.deepEqual(panel.keeper.calls, [], budget);
        assert.deepEqual(panel.questions, [], budget);
        assert.equal(panel.byId('scribe-setting-budget').getAttribute('aria-invalid'), 'true', budget);
        assert.equal(panel.text('scribe-setting-budget-problem'), 'The budget must be a number of dollars, more than 0.');
        assert.equal(panel.text('scribe-controls-outcome'), 'A field on the Settings tab needs attention.');
        assert.equal(panel.focused(), `INPUT|scribe-setting-budget|${budget}`);
    }
});

test('the page follows the row to any page', async () => {
    /**
     * @return {object}
     */
    const many = () => {
        const lines = Array.from({ length: 45 }, (unused, index) => `Question number ${index + 1}? | #${index + 1}`);
        return apply(ScribeLog.create(), answer({ QUESTIONS: lines }), 1, 45);
    };
    const panel = mounted(many());
    await panel.tab('Rulings');
    panel.click('scribe-list-questions-next');
    await panel.flush();
    panel.click('scribe-list-questions-next');
    await panel.flush();
    assert.equal(panel.text('scribe-list-questions-place'), 'Page 3 of 3');
    /**
     * @param {number} number
     * @return {import('./support/PanelElement.mjs').default}
     */
    const answerOf = (number) => panel.inputs(panel.rowSaying('questions', `Question number ${number}?`), 'text')[0];
    answerOf(41).value = 'Halvard rang it at dawn';
    answerOf(41).focus();
    panel.keeper.current = keeperView(rule(many(), { type: 'Dismiss', question: 'Q1' }));
    panel.redraw();
    assert.equal(panel.text('scribe-list-questions-place'), 'Page 2 of 3');
    assert.equal(panel.focused(), 'INPUT||Halvard rang it at dawn');
    assert.equal(answerOf(41).value, 'Halvard rang it at dawn');
});

test('an unreadable view locks the controls', async () => {
    const log = disputedBook();
    const panel = mounted(log, { live: liveView([contradiction()]) });
    const reading = panel.keeper.view.bind(panel.keeper);
    /**
     * @return {never}
     * @throws {Error}
     */
    const unreadable = () => {
        throw new Error('The view could not be read');
    };
    for (const [name, free] of [
        ['Rulings', []],
        ['Findings', ['Rule it...']],
    ]) {
        panel.keeper.view = reading;
        await panel.tab(name);
        assert.deepEqual(panel.actionsWhere(name, true), [], name);
        panel.keeper.view = unreadable;
        panel.redraw();
        assert.equal(panel.text('scribe-trouble'), 'Something went wrong in the panel: The view could not be read');
        assert.deepEqual(panel.actionsWhere(name, false), free, name);
        for (const button of buttonsIn(panel.section(name))) {
            button.click();
        }
        await panel.flush();
        assert.deepEqual(panel.keeper.calls, [], name);
        assert.deepEqual(panel.live.calls, [], name);
    }
});

test('there is no correct', async () => {
    const line = '[Scribe] Correction: Mirelle, eyes: grey, not blue.';
    const stray = { correct: line, told: false, spent: false };
    const findings = [
        { ...contradiction(), can: stray },
        { ...spelling('Spelling|MESSAGE-99|Aldrich|S6'), can: stray },
        { ...leak(), can: { ...stray, told: true } },
        { ...contradiction(), key: 'reminded', said: 'violet', status: Status.Reminded, can: stray },
    ];
    const described = plain(PanelView.findings(replay(findingsBook()), liveView(findings)));
    assert.equal(described.some((item) => item.actions.includes('Correct')), false);
    assert.equal(JSON.stringify(described).includes('Would send'), false);
    assert.deepEqual(Object.keys(plain(PanelView.Settings.Actions)), ['Dismiss', 'Told', 'Rule']);
    assert.deepEqual(Object.keys(plain(scripts.ScribePanel.Settings.Remedies)), ['Dismiss', 'Told']);
    const panel = mounted(findingsBook(), { live: liveView(findings, { corrections: [line], ready: '[Scribe] Hold.' }) });
    const texts = [];
    for (const name of ['Summary', 'Book', 'Timeline', 'Rulings', 'Findings', 'Progress']) {
        await panel.tab(name);
        texts.push(...buttonsIn(panel.root).map((button) => button.textContent));
    }
    assert.equal(texts.includes('Correct'), false);
    assert.deepEqual(panel.rowTexts('queued'), []);
    assert.equal(panel.byId('scribe-reminder').value, '[Scribe] Hold.');
    assert.equal(panel.text('scribe-section-findings').includes('Correction'), false);
    panel.live.correct = (key) => {
        panel.live.note('correct', [key]);
    };
    for (const said of ['blue', 'violet']) {
        await panel.tab('Findings');
        for (const button of buttonsIn(panel.rowSaying('findings', `the reply says ${said}.`))) {
            button.click();
            await panel.flush();
        }
    }
    assert.deepEqual(
        panel.live.calls.map((call) => call.name),
        ['dismiss', 'dismiss'],
    );
});

test('an open contradiction says what will happen', async () => {
    const goesFirst = "The book's value goes first in the next reminder, if this room may hear it.";
    const wentOut = "The book's value went out in a reminder.";
    /**
     * @param {string} said
     * @param {object} changes
     * @return {object}
     */
    const ruled = (said, changes) => ({ ...contradiction(), key: `Contradiction|${said}`, said, ...changes });
    const findings = [
        ruled('blue', {}),
        leak(),
        spelling('Spelling|MESSAGE-99|Aldrich|S6'),
        ruled('green', { status: Status.Dismissed, can: null }),
        ruled('amber', { can: { told: false, spent: true } }),
        ruled('violet', { status: Status.Reminded, can: null }),
    ];
    const panel = mounted(findingsBook(), { live: liveView(findings) });
    await panel.tab('Findings');
    /**
     * @param {string} text
     * @return {string}
     */
    const row = (text) => panel.rowSaying('findings', text).textContent;
    assert.equal(row('the reply says blue.').includes(goesFirst), true);
    for (const text of ['never told', 'Aldrich', 'the reply says green.', 'the reply says amber.', 'the reply says violet.']) {
        assert.equal(row(text).includes(goesFirst), false, text);
    }
    assert.equal(row('the reply says violet.').includes(wentOut), true);
    assert.equal(panel.text('scribe-list-findings').split(wentOut).length, 2);
    assert.deepEqual(buttonStates(panel.rowSaying('findings', 'the reply says violet.')), [
        'Dismiss:false',
        'Rule it...:false',
    ]);
    assert.deepEqual(buttonStates(panel.rowSaying('findings', 'the reply says green.')), []);
    assert.deepEqual(buttonStates(panel.rowSaying('findings', 'the reply says amber.')), ['Dismiss:false']);
    panel.button(panel.rowSaying('findings', 'the reply says violet.'), 'Dismiss').click();
    await panel.flush();
    assert.deepEqual(panel.live.called('dismiss'), [['Contradiction|violet']]);
    panel.button(panel.rowSaying('findings', 'the reply says violet.'), 'Rule it...').click();
    await panel.flush();
    assert.equal(panel.byId('scribe-tell').value, 'Mirelle, eyes: violet');
});

test('a leak is not ruled by words', async () => {
    /**
     * @param {string} name
     * @param {object} changes
     * @return {object}
     */
    const leaked = (name, changes) => ({ ...leak(), key: `Leak|${name}`, speakerLabel: name, ...changes });
    const names = ['Tamsin', 'Oswin', 'Isolde', 'Aldric', 'Brandt', 'Kira'];
    const findings = [
        leaked('Tamsin', {}),
        leaked('Oswin', { can: { told: false, spent: false } }),
        leaked('Isolde', { can: { told: true, spent: true } }),
        leaked('Aldric', { status: Status.Dismissed, can: null }),
        leaked('Brandt', { status: Status.Told, can: null }),
        leaked('Kira', { status: Status.Reminded, can: null }),
        contradiction(),
    ];
    const described = plain(PanelView.findings(replay(findingsBook()), liveView(findings)));
    assert.deepEqual(
        described.map((item) => [item.actions.includes('Rule it...'), item.draft]),
        [[false, null], [false, null], [false, null], [false, null], [false, null], [false, null], [true, 'Mirelle, eyes: blue']],
    );
    const panel = mounted(findingsBook(), { live: liveView(findings) });
    await panel.tab('Findings');
    assert.deepEqual(
        names.map((name) => buttonsIn(panel.rowSaying('findings', `${name} uses`)).map((button) => button.textContent)),
        [['Dismiss', 'They were told'], ['Dismiss'], ['Dismiss'], [], [], ['Dismiss']],
    );
    assert.equal(panel.buttonTexts('scribe-list-findings').filter((text) => text === 'Rule it...').length, 1);
    const own = 'Words of my own.';
    panel.byId('scribe-tell').value = own;
    for (const name of names) {
        const texts = buttonsIn(panel.rowSaying('findings', `${name} uses`)).map((button) => button.textContent);
        for (const text of texts) {
            panel.button(panel.rowSaying('findings', `${name} uses`), text).click();
            await panel.flush();
            assert.equal(panel.byId('scribe-tell').value, own, `${name} ${text}`);
            assert.equal(panel.section('Findings').hidden, false, `${name} ${text}`);
        }
    }
    assert.deepEqual(
        panel.live.calls.map((call) => call.name),
        ['dismiss', 'told', 'dismiss', 'dismiss', 'dismiss'],
    );
    panel.button(panel.rowSaying('findings', 'the reply says blue.'), 'Rule it...').click();
    await panel.flush();
    assert.equal(panel.byId('scribe-tell').value, `${own}\nMirelle, eyes: blue`);
});

test('nothing is read after unmount', () => {
    const panel = mounted(disputedBook());
    const reads = { keeper: 0, live: 0 };
    for (const part of ['keeper', 'live']) {
        const reading = panel[part].view.bind(panel[part]);
        panel[part].view = () => {
            reads[part]++;
            return reading();
        };
    }
    panel.redraw();
    assert.deepEqual(reads, { keeper: 1, live: 1 });
    panel.handle.unmount();
    panel.redraw();
    panel.handle.redraw();
    assert.deepEqual(reads, { keeper: 1, live: 1 });
    assert.equal(panel.hosts().length, 0);
});

const stoppedFailed = { phase: Phase.Stopped, stop: { reason: 'Failed', problem: 'answer was cut off' } };

test('the header offers the next step', () => {
    const log = ScribeLog.create();
    const offered = (changes) => {
        const panel = mounted(log, { keeper: changes });
        const button = panel.byId('scribe-next');
        return { hidden: button.hidden, text: button.textContent };
    };
    const adoptWord = 'Start a new local book';
    const resumeWord = mounted(log).byId('scribe-resume').textContent;
    assert.deepEqual(offered({ phase: Phase.NoBook }), { hidden: false, text: adoptWord });
    assert.deepEqual(offered(stoppedFailed), { hidden: false, text: resumeWord });
    assert.deepEqual(offered({ phase: Phase.Stopped, stop: { reason: 'Paused', problem: null } }), {
        hidden: false,
        text: resumeWord,
    });
    for (const changes of [
        { phase: Phase.Stopped, stop: { reason: 'Budget', problem: null } },
        { phase: Phase.Stopped, stop: { reason: 'Done', problem: null } },
        { phase: Phase.Stopped, stop: null },
        { phase: Phase.Idle },
        { phase: Phase.Loading },
        { phase: Phase.Watching, reader: false },
        { phase: Phase.Reading, flight: 'Reading #41 to #80' },
        { ...stoppedFailed, flight: 'Pulling the chat: 10 messages' },
    ]) {
        assert.equal(offered(changes).hidden, true, JSON.stringify(changes));
    }
});

test('the header button does what the Progress button does', async () => {
    const adopting = mounted(disputedBook());
    await adopting.tab('Progress');
    adopting.click('scribe-adopt');
    await adopting.flush();
    const adopted = adopting.keeper.called('adopt');
    assert.equal(adopted.length, 1);
    const header = mounted(ScribeLog.create(), { keeper: { phase: Phase.NoBook } });
    header.click('scribe-next');
    await header.flush();
    assert.deepEqual(header.keeper.called('adopt'), adopted);
    assert.deepEqual(header.keeper.called('resume'), []);
    const resuming = mounted(ScribeLog.create(), { keeper: stoppedFailed });
    await resuming.tab('Progress');
    resuming.click('scribe-resume');
    await resuming.flush();
    assert.equal(resuming.keeper.called('resume').length, 1);
    const stopped = mounted(ScribeLog.create(), { keeper: stoppedFailed });
    stopped.click('scribe-next');
    await stopped.flush();
    assert.deepEqual(stopped.keeper.called('resume'), resuming.keeper.called('resume'));
    assert.deepEqual(stopped.keeper.called('adopt'), []);
});

test('the header button is locked like the Progress one, except during a routine poll', async () => {
    const cases = [
        { ...stoppedFailed, reader: false },
        { ...stoppedFailed, flight: 'Reading #41 to #80' },
        stoppedFailed,
    ];
    for (const changes of cases) {
        const panel = mounted(ScribeLog.create(), { keeper: changes });
        await panel.tab('Progress');
        assert.equal(
            panel.byId('scribe-next').disabled,
            panel.byId('scribe-resume').disabled,
            JSON.stringify(changes),
        );
    }
    const watcher = mounted(ScribeLog.create(), { keeper: { phase: Phase.NoBook, reader: false } });
    assert.equal(watcher.byId('scribe-next').disabled, true);
    assert.equal(mounted(ScribeLog.create(), { keeper: { phase: Phase.NoBook } }).byId('scribe-next').disabled, false);
    const locked = mounted(ScribeLog.create(), { keeper: { ...stoppedFailed, reader: false } });
    assert.equal(locked.byId('scribe-next').disabled, true);
    const open = mounted(ScribeLog.create(), { keeper: stoppedFailed });
    assert.equal(open.byId('scribe-next').disabled, false);
    const held = open.keeper.hold();
    open.click('scribe-next');
    await open.tab('Progress');
    assert.equal(open.byId('scribe-resume').disabled, true);
    assert.equal(open.byId('scribe-next').disabled, true);
    held.open();
    await open.flush();
    assert.equal(open.byId('scribe-next').disabled, false);
    assert.equal(open.byId('scribe-resume').disabled, false);
    const paused = await realKeeper(13);
    await paused.keeper.adopt({});
    await paused.harness.flush();
    paused.keeper.pause();
    await paused.harness.flush();
    const pausedPoll = await polling(paused);
    assert.equal(paused.keeper.view().busy, 'Looking');
    assert.equal(paused.harness.byId('scribe-next').hidden, false);
    assert.equal(paused.harness.byId('scribe-next').textContent, paused.harness.byId('scribe-resume').textContent);
    assert.equal(paused.harness.byId('scribe-next').disabled, false);
    assert.equal(paused.harness.byId('scribe-resume').disabled, true);
    paused.harness.click('scribe-next');
    await paused.harness.flush();
    assert.equal(paused.harness.text('scribe-next-outcome'), pulling);
    pausedPoll.release();
    await pausedPoll.ticking;
    await paused.harness.flush();
    assert.equal(paused.harness.byId('scribe-next').disabled, false);
    assert.equal(paused.harness.byId('scribe-resume').disabled, false);
    assert.equal(paused.harness.text('scribe-next-outcome'), '');
    assert.equal(paused.harness.byId('scribe-trouble').hidden, true);
    assert.equal(paused.harness.text('scribe-trouble'), '');
});

test('a failure is said beside the header button', async () => {
    const panel = mounted(ScribeLog.create(), { keeper: stoppedFailed });
    assert.equal(panel.text('scribe-next-outcome'), '');
    panel.keeper.failure = new Error('The key was refused');
    panel.click('scribe-next');
    await panel.flush();
    assert.equal(panel.text('scribe-next-outcome'), 'The key was refused');
    assert.equal(panel.text('scribe-controls-outcome'), '');
    assert.equal(panel.byId('scribe-trouble').hidden, true);
    const progress = mounted(ScribeLog.create(), { keeper: stoppedFailed });
    await progress.tab('Progress');
    progress.keeper.failure = new Error('The key was refused');
    progress.click('scribe-resume');
    await progress.flush();
    assert.equal(progress.text('scribe-controls-outcome'), 'The key was refused');
    assert.equal(progress.text('scribe-next-outcome'), '');
});

test('the header button works while the body is folded', async () => {
    const panel = mounted(ScribeLog.create(), { keeper: stoppedFailed });
    panel.click('scribe-toggle');
    assert.equal(panel.byId('scribe-panel').classes.has('collapsed'), true);
    const button = panel.byId('scribe-next');
    assert.equal(button.hidden, false);
    assert.equal(button.disabled, false);
    panel.click('scribe-next');
    await panel.flush();
    assert.equal(panel.keeper.called('resume').length, 1);
});

test('a button that goes away leaves no trouble', async () => {
    const panel = mounted(ScribeLog.create(), { keeper: stoppedFailed });
    const held = panel.keeper.hold();
    panel.click('scribe-next');
    panel.keeper.current = keeperView(ScribeLog.create(), { phase: Phase.Reading, flight: 'Reading #41 to #80' });
    panel.redraw();
    assert.equal(panel.byId('scribe-next').hidden, true);
    held.open();
    await panel.flush();
    assert.equal(panel.byId('scribe-trouble').hidden, true);
    assert.equal(panel.byId('scribe-next').hidden, true);
    const failing = mounted(ScribeLog.create(), { keeper: stoppedFailed });
    const refused = failing.keeper.hold();
    failing.click('scribe-next');
    failing.keeper.current = keeperView(ScribeLog.create(), { phase: Phase.Reading, flight: 'Reading #41 to #80' });
    failing.redraw();
    refused.fail(new Error('The key was refused'));
    await failing.flush();
    assert.equal(failing.byId('scribe-trouble').hidden, true);
    assert.equal(failing.text('scribe-next-outcome'), 'The key was refused');
});

test('a login not yet seen reads as a wait', () => {
    const messages = scripts.ZetaSource.Settings.Messages;
    const base = { phase: Phase.NoBook, total: 0, read: 0, flight: null, stop: null };
    const waiting = PanelView.problems({ ...base, problem: messages.NoLogin }, {})[0];
    assert.equal(waiting.service, 'Zeta');
    assert.match(waiting.explanation, /Sign in to Zeta/);
    const other = PanelView.problems({ ...base, problem: messages.NoRoom }, {})[0];
    assert.deepEqual(plain(other.details), [messages.NoRoom]);
    assert.doesNotMatch(other.explanation, /Sign in to Zeta/);
});

const finishedReport = {
    pass: 'Story',
    first: 1,
    last: 40,
    read: 40,
    total: 864,
    spent: 0.01,
    calls: 1,
    unpriced: 0,
    stored: 3,
    refusedLines: [],
    refusedOperations: [],
};

/**
 * @param {number} read
 * @param {number} total
 * @param {object} changes
 * @return {object}
 */
function working(read, total, changes = {}) {
    return {
        phase: Phase.Reading,
        flight: 'Reading #41 to #80',
        began: PanelHarness.StartTime,
        total,
        read,
        unread: Array.from({ length: total - read }, (unused, index) => index),
        ...changes,
    };
}

test('the header shows the work under way', async () => {
    const idle = mounted(ScribeLog.create());
    assert.equal(idle.byId('scribe-activity').hidden, true);
    const panel = mounted(ScribeLog.create(), { keeper: working(40, 864) });
    assert.equal(panel.byId('scribe-activity').hidden, false);
    assert.equal(panel.byId('scribe-meter').getAttribute('max'), '864');
    assert.equal(panel.byId('scribe-meter').getAttribute('value'), '40');
    const counts = panel.text('scribe-counts');
    assert.equal(counts.includes('40 of 864 messages read.'), true);
    assert.equal(counts.includes('About 21 readings to go.'), true);
    await panel.tab('Timeline');
    assert.equal(panel.byId('scribe-activity').hidden, false);
    panel.click('scribe-toggle');
    assert.equal(panel.byId('scribe-panel').classes.has('collapsed'), true);
    assert.equal(panel.byId('scribe-activity').hidden, false);
    assert.equal(panel.byId('scribe-meter').getAttribute('max'), '864');
    for (const flight of ['Pulling the chat: 120 messages', 'Looking for new messages', 'Saving a ruling']) {
        const other = mounted(ScribeLog.create(), { keeper: working(40, 864, { flight }) });
        assert.equal(other.byId('scribe-activity').hidden, false, flight);
        assert.equal(other.byId('scribe-meter').getAttribute('value'), null, flight);
    }
    for (const flight of ['Filing the answered questions', 'Finishing the reading']) {
        const other = mounted(ScribeLog.create(), { keeper: working(40, 864, { flight }) });
        assert.equal(other.byId('scribe-meter').getAttribute('value'), '40', flight);
    }
});

test('the clock moves without a redraw', async () => {
    const panel = mounted(ScribeLog.create(), { keeper: working(40, 864) });
    assert.equal(panel.text('scribe-clock'), 'This step: 0:00');
    panel.clock.advance(7000);
    assert.equal(panel.text('scribe-clock'), 'This step: 0:07');
    await panel.tab('Book');
    const search = panel.byId('scribe-search');
    search.value = 'halv';
    search.focus();
    const before = panel.focused();
    panel.clock.advance(1000);
    assert.equal(panel.text('scribe-clock'), 'This step: 0:08');
    assert.equal(search.value, 'halv');
    assert.equal(panel.focused(), before);
    assert.equal(before.startsWith('INPUT|scribe-search'), true);
});

test('one timer and it ends', async () => {
    const panel = mounted(ScribeLog.create(), { keeper: working(40, 864) });
    assert.equal(panel.clock.intervals, 1);
    for (let turn = 0; turn < 4; turn++) {
        panel.redraw();
    }
    await panel.tab('Rulings');
    assert.equal(panel.clock.intervals, 1);
    panel.keeper.current = keeperView(ScribeLog.create());
    panel.redraw();
    assert.equal(panel.clock.intervals, 0);
    panel.keeper.current = keeperView(ScribeLog.create(), working(40, 864));
    panel.redraw();
    assert.equal(panel.clock.intervals, 1);
    panel.handle.unmount();
    assert.equal(panel.clock.intervals, 0);
});

test('legacy book calls mask both keys in pass and answer, including after a key slot refuses reads', async () => {
    const storage = new FakeStorage();
    ScribeStore.setKey(storage, 'or-fixture');
    ScribeStore.setCloudKey(storage, 'private-worker-fixture');
    const text = 'or-fixture / private-worker-fixture';
    const calls = [
        { sequence: 14, pass: text, answer: text, readable: true },
        { sequence: null, pass: text, answer: text, readable: false },
        { sequence: null, pass: text, answer: null, stopped: true },
    ];
    const panel = mounted(ScribeLog.create(), { storage, keeper: { calls } });
    await panel.tab('Progress');
    const rows = panel.rowTexts('calls');
    assert.match(rows[0], /Call 14: \[key\] \/ \[key\]/);
    assert.match(rows[1], /The answer\[key\] \/ \[key\]/);
    assert.match(rows[2], /Stopped by the operator: \[key\] \/ \[key\]/);
    for (const slot of [/^scribe:key$/, /^scribe:cloudkey$/]) {
        storage.refuseGetsMatching(slot);
        panel.redraw();
        for (const row of panel.rowTexts('calls')) {
            assert.match(row, /Diagnostic withheld/);
            assert.doesNotMatch(row, /or-fixture|private-worker-fixture/);
        }
        storage.allow();
    }
    assert.equal(calls[0].answer, text);
});

test('legacy Readings and Last finished mask pass, refused lines, nested operations and reasons with no calls', async () => {
    const storage = new FakeStorage();
    ScribeStore.setKey(storage, 'or-fixture');
    ScribeStore.setCloudKey(storage, 'private-worker-fixture');
    const text = 'or-fixture / private-worker-fixture';
    const report = {
        ...finishedReport,
        pass: 'Review ' + text,
        refusedLines: [{ line: 'Line ' + text, reason: 'Refusal ' + text }],
        refusedOperations: [{
            operation: { type: 'Contradiction', position: 7, said: 'Quote ' + text, entry: 'F3', why: 'Why ' + text },
            reason: 'Citation ' + text,
        }],
    };
    const panel = mounted(ScribeLog.create(), { storage, keeper: working(40, 864, { lines: [report], calls: [] }) });
    await panel.tab('Progress');
    const [shown] = panel.rowTexts('lines');
    for (const label of ['Review', 'Line', 'Refusal', 'Quote', 'Why', 'Citation']) {
        assert.ok(shown.includes(label + ' [key] / [key]'), label);
    }
    assert.match(shown, /F3/);
    assert.match(panel.text('scribe-finished'), /Review \[key\] \/ \[key\]/);
    for (const slot of [/^scribe:key$/, /^scribe:cloudkey$/]) {
        storage.refuseGetsMatching(slot);
        panel.redraw();
        for (const shown of [panel.rowTexts('lines')[0], panel.text('scribe-finished')]) {
            assert.match(shown, /Diagnostic withheld/);
            assert.doesNotMatch(shown, /or-fixture|private-worker-fixture/);
        }
        storage.allow();
    }
    assert.equal(report.refusedOperations[0].operation.why, 'Why ' + text);
});

test('the last finished step is the Readings wording', async () => {
    const panel = mounted(ScribeLog.create(), { keeper: working(40, 864, { lines: [finishedReport] }) });
    const finished = panel.text('scribe-finished');
    assert.equal(finished.startsWith('Last finished: '), true);
    await panel.tab('Progress');
    assert.equal(finished.slice('Last finished: '.length), panel.rowTexts('lines')[0]);
    const none = mounted(ScribeLog.create(), { keeper: working(40, 864) });
    assert.equal(none.byId('scribe-finished').hidden, true);
});

test('elapsed and progress are worded right', () => {
    assert.equal(PanelView.elapsed(7000), '0:07');
    assert.equal(PanelView.elapsed(130000), '2:10');
    assert.equal(PanelView.elapsed(3665000), '61:05');
    assert.equal(PanelView.elapsed(-5), '0:00');
    assert.equal(PanelView.elapsed(Number.NaN), '0:00');
    const view = (left) => ({ read: 40, total: 100, unread: Array.from({ length: left }, (unused, index) => index), settings: { size: 40 } });
    assert.equal(PanelView.progress(view(0)), '40 of 100 messages read.');
    assert.equal(PanelView.progress(view(1)), '40 of 100 messages read. About 1 reading to go.');
    assert.equal(PanelView.progress(view(40)), '40 of 100 messages read. About 1 reading to go.');
    assert.equal(PanelView.progress(view(41)), '40 of 100 messages read. About 2 readings to go.');
});

test('empty tabs say why', async () => {
    const noBook = 'Worker unchecked. No DM API key on this PC. In Tampermonkey, choose Zeta Scribe → Set DM API key and enter the key used on the other PC.';
    const under = 'The first reading is under way. This fills as each stretch lands.';
    const nothing = 'Nothing has been read yet. Press Resume above.';
    const states = [
        [noBook, { phase: Phase.NoBook, read: 0 }],
        [under, { phase: Phase.Reading, read: 0, flight: 'Reading #1 to #40', began: PanelHarness.StartTime }],
        [nothing, { phase: Phase.Stopped, read: 0, stop: { reason: 'Failed', problem: 'cut' } }],
    ];
    for (const [sentence, changes] of states) {
        const panel = mounted(ScribeLog.create(), { keeper: changes });
        for (const name of ['Summary', 'Book', 'Timeline', 'Rulings']) {
            await panel.tab(name);
            const shown = panel.byId(`scribe-empty-${name.toLowerCase()}`);
            assert.equal(shown.hidden, false, name);
            assert.equal(shown.textContent, sentence, name);
        }
        for (const name of ['Findings', 'Progress', 'Settings']) {
            const hollow = panel.section(name).children.filter((child) => child.id.startsWith('scribe-empty-'));
            assert.equal(hollow.length, 0, name);
        }
    }
    const read = mounted(ScribeLog.create(), { keeper: { phase: Phase.Stopped, read: 5, stop: { reason: 'Failed', problem: 'cut' } } });
    for (const name of ['Summary', 'Book', 'Timeline', 'Rulings']) {
        assert.equal(read.byId(`scribe-empty-${name.toLowerCase()}`).hidden, true, name);
    }
});

test('a refused header Adopt names the Settings tab', async () => {
    const bad = { phase: Phase.NoBook, settings: { ...settings, size: 'many' } };
    const panel = mounted(ScribeLog.create(), { keeper: bad });
    panel.click('scribe-next');
    await panel.flush();
    assert.equal(panel.text('scribe-next-outcome'), 'A field on the Settings tab needs attention.');
    assert.equal(panel.byId('scribe-section-settings').hidden, false);
    assert.deepEqual(panel.keeper.called('adopt'), []);
    const progress = mounted(disputedBook(), { keeper: { settings: { ...settings, size: 'many' } } });
    await progress.tab('Progress');
    progress.click('scribe-adopt');
    await progress.flush();
    assert.equal(progress.text('scribe-controls-outcome'), 'A field on the Settings tab needs attention.');
    assert.equal(progress.text('scribe-next-outcome'), '');
    assert.equal(progress.byId('scribe-section-settings').hidden, false);
});

test('Adopt waits for the pull and says why', async () => {
    const reason = 'Nothing has been pulled from the chat yet';
    const log = ScribeLog.create();
    const panel = mounted(log, { keeper: { phase: Phase.NoBook, adoptBlock: reason } });
    assert.equal(panel.byId('scribe-next').disabled, true);
    assert.equal(panel.byId('scribe-next-outcome').hidden, false);
    assert.equal(panel.text('scribe-next-outcome'), reason);
    panel.click('scribe-next');
    await panel.flush();
    assert.deepEqual(panel.keeper.calls, []);
    panel.keeper.current = keeperView(log, { phase: Phase.NoBook });
    panel.redraw();
    assert.equal(panel.byId('scribe-next').disabled, false);
    assert.equal(panel.byId('scribe-next-outcome').hidden, true);
    assert.equal(panel.text('scribe-next-outcome'), '');
    await panel.tab('Progress');
    assert.equal(panel.text('scribe-next-outcome'), '');
});

test('a block is never said for Resume', () => {
    const panel = mounted(ScribeLog.create(), { keeper: { ...stoppedFailed, adoptBlock: 'Another tab is reading' } });
    assert.equal(panel.byId('scribe-next').disabled, false);
    assert.equal(panel.byId('scribe-next-outcome').hidden, true);
    const idle = mounted(ScribeLog.create(), { keeper: { phase: Phase.Idle, adoptBlock: 'Another tab is reading' } });
    assert.equal(idle.byId('scribe-next-outcome').hidden, true);
});

test('a refusal goes when the state it reported has moved', async () => {
    const log = ScribeLog.create();
    const noBook = { phase: Phase.NoBook, pulled: null };
    const moves = [
        ['the pull lands', { ...noBook, pulled: { end: 'NoCursor', count: 13, skipped: 0, at: 5 } }],
        ['another tab takes over', { ...noBook, phase: Phase.Watching, reader: false }],
        ['the block changes', { ...noBook, adoptBlock: 'The chat could not be compared with the book' }],
        ['the stop reason changes', { ...noBook, stop: { reason: 'Budget', problem: null } }],
    ];
    for (const [name, changes] of moves) {
        const panel = mounted(log, { keeper: noBook });
        panel.keeper.failure = new Error('The key was refused');
        panel.click('scribe-next');
        await panel.flush();
        assert.equal(panel.text('scribe-next-outcome'), 'The key was refused', name);
        panel.redraw();
        assert.equal(panel.text('scribe-next-outcome'), 'The key was refused', name);
        panel.keeper.current = keeperView(log, changes);
        panel.redraw();
        assert.equal(panel.byId('scribe-next-outcome').textContent.includes('The key was refused'), false, name);
    }
    const resuming = mounted(log, { keeper: stoppedFailed });
    resuming.keeper.failure = new Error('The key was refused');
    resuming.click('scribe-next');
    await resuming.flush();
    assert.equal(resuming.text('scribe-next-outcome'), 'The key was refused');
    resuming.keeper.current = keeperView(log, { phase: Phase.Stopped, stop: { reason: 'Budget', problem: null } });
    resuming.redraw();
    assert.equal(resuming.text('scribe-next-outcome'), '');
    const controls = mounted(log, { keeper: stoppedFailed });
    await controls.tab('Progress');
    controls.keeper.failure = new Error('The key was refused');
    controls.click('scribe-resume');
    await controls.flush();
    assert.equal(controls.text('scribe-controls-outcome'), 'The key was refused');
    controls.keeper.current = keeperView(log, {
        ...stoppedFailed,
        pulled: { end: 'NoCursor', count: 1, skipped: 0, at: 9 },
    });
    controls.redraw();
    assert.equal(controls.text('scribe-controls-outcome'), '');
});

test('a refusal stays while the state has not moved, and a success outlives a pull', async () => {
    const log = disputedBook();
    const panel = mounted(log, { keeper: stoppedFailed });
    panel.keeper.failure = new Error('The key was refused');
    panel.click('scribe-next');
    await panel.flush();
    for (let turn = 0; turn < 3; turn++) {
        panel.keeper.current = keeperView(log, { ...stoppedFailed, spentToday: 0.2 + turn });
        panel.redraw();
    }
    assert.equal(panel.text('scribe-next-outcome'), 'The key was refused');
    await panel.tab('Progress');
    panel.click('scribe-export');
    await panel.flush();
    assert.equal(panel.text('scribe-controls-outcome').startsWith('Exported '), true);
    panel.keeper.current = keeperView(log, { pulled: { end: 'NoCursor', count: 1, skipped: 0, at: 77 } });
    panel.redraw();
    assert.equal(panel.text('scribe-controls-outcome').startsWith('Exported '), true);
});

test('the Settings tab holds the key and every setting', async () => {
    const panel = mounted(disputedBook());
    assert.equal(panel.byId('scribe-tab-settings').textContent, 'Settings');
    const inside = panel.section('Settings').descendants();
    const ids = new Set(inside.map((element) => element.id));
    for (const id of [
        'scribe-key-state',
        'scribe-key',
        'scribe-save-key',
        'scribe-key-outcome',
        'scribe-setting-analyzer',
        'scribe-setting-scribe',
        'scribe-setting-pedant',
        'scribe-setting-size',
        'scribe-setting-budget',
        'scribe-setting-refresh',
        'scribe-save-settings',
        'scribe-settings-outcome',
    ]) {
        assert.equal(ids.has(id), true, id);
    }
    assert.equal(inside.some((element) => element.tagName === 'DETAILS'), false);
    assert.equal(panel.section('Progress').descendants().some((element) => element.id === 'scribe-key'), false);
});

test('Start the book over shows only when there is a book', async () => {
    const hidden = async (changes, log = ScribeLog.create()) => {
        const panel = mounted(log, { keeper: changes });
        await panel.tab('Progress');
        return panel.byId('scribe-adopt').hidden;
    };
    assert.equal(await hidden({ phase: Phase.NoBook }), true);
    assert.equal(await hidden({ phase: Phase.Loading }), true);
    assert.equal(await hidden({ phase: Phase.Idle }, disputedBook()), false);
    assert.equal(await hidden({ phase: Phase.Stopped, stop: { reason: 'Paused', problem: null } }), false);
    assert.equal(await hidden({ phase: Phase.Stopped, problem: 'The saved book of this chat is damaged' }), false);
    assert.equal(await hidden({ phase: Phase.Watching, reader: false }, disputedBook()), false);
    assert.equal(await hidden({ phase: Phase.Watching, reader: false, booked: false }), true);
});

test("a watcher's Progress tab says whether it pulled", async () => {
    const log = disputedBook();
    const watcher = mounted(log, { keeper: { phase: Phase.Watching, reader: false, pulled: null } });
    await watcher.tab('Progress');
    assert.equal(watcher.byId('scribe-pulled').hidden, false);
    assert.equal(watcher.text('scribe-pulled'), 'This tab has not pulled the chat; another tab is reading it.');
    watcher.keeper.current = keeperView(log, {
        phase: Phase.Watching,
        reader: false,
        pulled: { end: 'NoCursor', count: 40, skipped: 0, at: 3 },
    });
    watcher.redraw();
    assert.equal(watcher.text('scribe-pulled'), 'Last pull: 40 messages, ended NoCursor');
    const reader = mounted(log, { keeper: { pulled: null } });
    await reader.tab('Progress');
    assert.equal(reader.byId('scribe-pulled').hidden, true);
    reader.keeper.current = keeperView(log, { pulled: { end: 'NoCursor', count: 40, skipped: 0, at: 3 } });
    reader.redraw();
    assert.equal(reader.byId('scribe-pulled').hidden, false);
});

test('Progress holds the controls, the last pull, the readings and the calls in order', async () => {
    const panel = mounted(disputedBook(), { keeper: { pulled: { end: 'NoCursor', count: 40, skipped: 0, at: 3 } } });
    await panel.tab('Progress');
    const children = panel.section('Progress').children;
    const positions = ['scribe-adopt', 'scribe-pulled', 'scribe-list-lines', 'scribe-list-calls'].map((id) =>
        children.findIndex((child) => child.id === id || child.descendants().some((inner) => inner.id === id)),
    );
    assert.equal(positions.every((position) => position >= 0), true, JSON.stringify(positions));
    assert.deepEqual([...positions].sort((first, second) => first - second), positions);
});

test('seven tabs wrap at phone width', () => {
    const panel = mounted(disputedBook(), { width: 390 });
    const tabs = panel.byId('scribe-tab-summary').parent.children;
    assert.deepEqual(
        tabs.map((tab) => tab.textContent),
        ['Summary', 'Book', 'Timeline', 'Rulings', 'Findings', 'Progress', 'Settings'],
    );
    assert.match(PanelStyle.Text, /\.tabs \{[^}]*flex-wrap: wrap;/);
    assert.doesNotMatch(PanelStyle.Text, /\.tabs \{[^}]*(white-space: nowrap|overflow-x: (scroll|auto))/);
});

const pulling = scripts.ScribeKeeper.Settings.Messages.Pulling;
const refused = 'The key was refused';

/**
 * @param {number} length
 * @param {string|null} hold
 * @param {(keeper: object) => object} wrap
 * @return {Promise<{ harness: PanelHarness, keeper: object, chat: FakeChat, release: Function|null }>}
 */
async function realKeeper(length, hold = null, wrap = (keeper) => keeper) {
    const settle = async () => {
        for (let turn = 0; turn < 200; turn++) {
            await new Promise((resolve) => setImmediate(resolve));
        }
    };
    const chat = new FakeChat(length);
    const release = hold === null ? null : chat.hold(hold);
    const harness = new PanelHarness(scripts, { keeper: null, live: liveView() });
    const clock = harness.clock;
    const keeper = await scripts.ScribeKeeper.open({
        storage: harness.storage,
        roomId: 'harbour',
        tabId: 'tab-1',
        zeta: chat.zeta('tab-1'),
        ask: async () => ({ text: '=== FACTS', cost: 0.01 }),
        clock: { now: () => clock.now(), today: () => '2026-11-15' },
        notify: () => {
            if (harness.handle !== null) {
                harness.redraw();
            }
        },
    });
    await settle();
    harness.keeper = wrap(keeper);
    harness.live = new PanelLive(liveView());
    harness.mount();
    return { harness, keeper, chat, release };
}

/**
 * @param {{ harness: PanelHarness, keeper: object, chat: FakeChat }} setup
 * @return {Promise<{ ticking: Promise<void>, release: Function }>}
 */
async function polling(setup) {
    const release = setup.chat.hold('newest');
    setup.harness.clock.time = setup.harness.clock.now() + 20000;
    const ticking = setup.keeper.tick();
    await setup.harness.flush();
    return { ticking, release };
}

test('the first pull hides Adopt under its headline, and a routine poll never does', async () => {
    const first = await realKeeper(13, 'history');
    const { harness, keeper } = first;
    assert.equal(keeper.view().adoptBlock, pulling);
    assert.equal(keeper.view().busy, 'Pulling');
    assert.equal(harness.byId('scribe-next').hidden, true);
    assert.equal(harness.text('scribe-headline'), 'Reading chat history from Zeta · 0 messages');
    assert.equal(harness.byId('scribe-next-outcome').hidden, true);
    first.release();
    await harness.flush();
    assert.equal(harness.byId('scribe-next').disabled, false);
    assert.equal(harness.text('scribe-next-outcome'), '');
    for (let turn = 0; turn < 3; turn++) {
        const poll = await polling(first);
        assert.equal(keeper.view().busy, 'Looking');
        assert.equal(harness.byId('scribe-next').hidden, false);
        assert.equal(harness.byId('scribe-next').disabled, false);
        assert.equal(harness.text('scribe-next-outcome'), '');
        poll.release();
        await poll.ticking;
        await harness.flush();
        assert.equal(harness.byId('scribe-next').hidden, false);
        assert.equal(harness.byId('scribe-next').disabled, false);
        assert.equal(harness.text('scribe-next-outcome'), '');
    }
});

test('a redraw during a routine poll keeps the header Adopt shown and enabled with no line', async () => {
    const setup = await realKeeper(13);
    const { harness, keeper } = setup;
    const poll = await polling(setup);
    assert.equal(keeper.view().busy, 'Looking');
    assert.equal(keeper.view().flight, 'Looking for new messages');
    await harness.tab('Settings');
    await harness.flush();
    assert.equal(harness.byId('scribe-next').hidden, false);
    assert.equal(harness.byId('scribe-next').disabled, false);
    assert.equal(harness.byId('scribe-next-outcome').hidden, true);
    poll.release();
    await poll.ticking;
    await harness.flush();
    assert.equal(harness.byId('scribe-next').hidden, false);
    assert.equal(harness.byId('scribe-next').disabled, false);
    assert.equal(harness.byId('scribe-next-outcome').hidden, true);
});

test('a press on Adopt during a routine poll leaves no line when the poll ends', async () => {
    const setup = await realKeeper(13);
    const { harness } = setup;
    const poll = await polling(setup);
    harness.click('scribe-next');
    await harness.flush();
    assert.equal(harness.text('scribe-next-outcome'), pulling);
    poll.release();
    await poll.ticking;
    await harness.flush();
    assert.equal(harness.byId('scribe-next').disabled, false);
    assert.equal(harness.text('scribe-next-outcome'), '');
    for (let turn = 0; turn < 3; turn++) {
        await setup.keeper.tick();
        await harness.flush();
        assert.equal(harness.text('scribe-next-outcome'), '');
    }
});

test('every Book-guarded control is locked during a poll, and a refusal said then is gone after it', async () => {
    for (const withBook of [false, true]) {
        const gate = { release: null };
        const waiting = new Promise((resolve) => {
            gate.release = resolve;
        });
        const setup = await realKeeper(13, null, (keeper) => ({
            ...keeper,
            configure: async (given) => {
                await waiting;
                return keeper.configure(given);
            },
        }));
        const { harness, keeper } = setup;
        if (withBook) {
            await keeper.adopt({});
            await harness.flush();
        }
        await harness.tab('Settings');
        assert.equal(harness.byId('scribe-save-settings').disabled, false);
        harness.click('scribe-save-settings');
        await harness.flush();
        const poll = await polling(setup);
        assert.equal(harness.byId('scribe-save-settings').disabled, true);
        gate.release();
        await harness.flush();
        assert.equal(harness.text('scribe-settings-outcome'), pulling);
        poll.release();
        await poll.ticking;
        await harness.flush();
        assert.equal(harness.text('scribe-settings-outcome'), '');
        assert.equal(harness.byId('scribe-save-settings').disabled, false);
        const quiet = await polling(setup);
        assert.equal(harness.byId('scribe-save-settings').disabled, true);
        quiet.release();
        await quiet.ticking;
        await harness.flush();
        assert.equal(harness.byId('scribe-save-settings').disabled, false);
    }
});

test('a refusal stored while settled survives a routine poll on any outlet', async () => {
    const setup = await realKeeper(13, null, (keeper) => ({
        ...keeper,
        configure: async () => {
            throw new Error(refused);
        },
    }));
    const { harness, keeper } = setup;
    await harness.tab('Settings');
    harness.click('scribe-save-settings');
    await harness.flush();
    assert.equal(harness.text('scribe-settings-outcome'), refused);
    const poll = await polling(setup);
    assert.equal(harness.text('scribe-settings-outcome'), refused);
    poll.release();
    await poll.ticking;
    await harness.flush();
    assert.equal(harness.text('scribe-settings-outcome'), refused);
    for (let turn = 0; turn < 3; turn++) {
        await keeper.tick();
        await harness.flush();
        assert.equal(harness.text('scribe-settings-outcome'), refused);
    }
    await harness.tab('Summary');
    await harness.tab('Settings');
    assert.equal(harness.text('scribe-settings-outcome'), refused);
});

test('a controls refusal stored while settled survives a step that reads a stretch', async () => {
    for (const variant of ['resume', 'field']) {
        const setup = await realKeeper(13, null, (keeper) => ({
            ...keeper,
            resume: async () => {
                throw new Error(refused);
            },
        }));
        const { harness, keeper, chat } = setup;
        await keeper.adopt({});
        await harness.flush();
        await harness.tab('Progress');
        const field = 'A field on the Settings tab needs attention.';
        if (variant === 'resume') {
            harness.click('scribe-resume');
        } else {
            await harness.tab('Settings');
            harness.byId('scribe-setting-size').value = 'many';
            await harness.tab('Progress');
            harness.click('scribe-adopt');
            await harness.flush();
            await harness.tab('Progress');
        }
        await harness.flush();
        const line = variant === 'resume' ? refused : field;
        assert.equal(harness.text('scribe-controls-outcome'), line);
        for (let round = 0; round < 3; round++) {
            chat.add(20);
            harness.clock.time = harness.clock.now() + 20000;
            await keeper.tick();
            await harness.flush();
            assert.equal(harness.text('scribe-controls-outcome'), line);
        }
        assert.equal(keeper.view().read, 73);
    }
});

test('the field line on the controls goes when the field it named is fixed', async () => {
    const panel = mounted(ScribeLog.create(), {
        keeper: { phase: Phase.Idle, settings: { ...settings, size: 'many' } },
    });
    await panel.tab('Progress');
    panel.click('scribe-adopt');
    await panel.flush();
    const line = 'A field on the Settings tab needs attention.';
    assert.equal(panel.byId('scribe-section-settings').hidden, false);
    await panel.tab('Progress');
    assert.equal(panel.text('scribe-controls-outcome'), line);
    const size = panel.byId('scribe-setting-size');
    size.value = '30';
    size.dispatchEvent({ type: 'input' });
    assert.equal(panel.text('scribe-controls-outcome'), '');
    assert.equal(panel.text('scribe-next-outcome'), '');
});

test('a refusal stored while settled survives a poll, and one said during a poll goes when it ends', async () => {
    const log = ScribeLog.create();
    const paused = { phase: Phase.Stopped, stop: { reason: 'Paused', problem: null } };
    const polling = { ...paused, adoptBlock: pulling, flight: 'Looking for new messages' };
    const settled = mounted(log, { keeper: paused });
    settled.keeper.failure = new Error(refused);
    settled.click('scribe-next');
    await settled.flush();
    assert.equal(settled.text('scribe-next-outcome'), refused);
    for (const view of [polling, paused, polling, polling, paused]) {
        settled.keeper.current = keeperView(log, view);
        settled.redraw();
        assert.equal(settled.text('scribe-next-outcome'), refused);
    }
    const noBook = { phase: Phase.NoBook };
    const racing = mounted(log, { keeper: noBook });
    const held = racing.keeper.hold();
    racing.click('scribe-next');
    racing.keeper.current = keeperView(log, { ...noBook, adoptBlock: pulling });
    racing.redraw();
    held.fail(new Error(pulling));
    await racing.flush();
    assert.equal(racing.text('scribe-next-outcome'), pulling);
    racing.keeper.current = keeperView(log, noBook);
    racing.redraw();
    assert.equal(racing.text('scribe-next-outcome'), '');
    assert.equal(racing.byId('scribe-next').disabled, false);
});

test('the header Trouble line goes with the refusal it mirrors', async () => {
    const log = ScribeLog.create();
    const states = [
        { phase: Phase.Stopped, stop: { reason: 'Budget', problem: null } },
        { phase: Phase.Idle, pulled: { end: 'NoCursor', count: 3, skipped: 0, at: 99 } },
    ];
    for (const state of states) {
        const panel = mounted(log, { keeper: stoppedFailed });
        await panel.tab('Progress');
        const held = panel.keeper.hold();
        panel.click('scribe-resume');
        await panel.flush();
        await panel.tab('Summary');
        held.fail(new Error(refused));
        await panel.flush();
        assert.equal(panel.text('scribe-trouble'), refused);
        assert.equal(panel.byId('scribe-trouble').hidden, false);
        panel.keeper.current = keeperView(log, state);
        panel.redraw();
        assert.equal(panel.text('scribe-trouble'), '');
        assert.equal(panel.byId('scribe-trouble').hidden, true);
        assert.equal(panel.text('scribe-controls-outcome'), '');
    }
});

test('the collapsed strip hides every outcome line', () => {
    const panel = mounted(ScribeLog.create(), {
        keeper: { phase: Phase.NoBook, adoptBlock: pulling },
        width: 390,
        storage: new FakeStorage(),
    });
    assert.equal(panel.byId('scribe-panel').classes.has('collapsed'), true);
    assert.equal(panel.byId('scribe-next-outcome').classes.has('outcome'), true);
    assert.equal(panel.text('scribe-next-outcome'), pulling);
    assert.match(PanelStyle.Text, /\.panel\.collapsed \.outcome[,\s][^{]*\{[^}]*display: none;/);
    assert.doesNotMatch(PanelStyle.Text, /\.setup\b/);
});

test('a field refusal at phone width opens the panel and focuses the field', async () => {
    const panel = mounted(ScribeLog.create(), {
        keeper: { phase: Phase.NoBook, settings: { ...settings, size: 'many' } },
        width: 390,
        storage: new FakeStorage(),
    });
    assert.equal(panel.byId('scribe-panel').classes.has('collapsed'), true);
    panel.click('scribe-next');
    await panel.flush();
    assert.equal(panel.byId('scribe-panel').classes.has('collapsed'), false);
    assert.equal(panel.byId('scribe-body').hidden, false);
    assert.equal(panel.byId('scribe-section-settings').hidden, false);
    assert.equal(panel.focused(), 'INPUT|scribe-setting-size|many');
    assert.deepEqual(panel.keeper.called('adopt'), []);
});

test('the field line goes when the field it named is fixed', async () => {
    const panel = mounted(ScribeLog.create(), {
        keeper: { phase: Phase.NoBook, settings: { ...settings, size: 'many', budget: 0 } },
    });
    panel.click('scribe-next');
    await panel.flush();
    const line = 'A field on the Settings tab needs attention.';
    assert.equal(panel.text('scribe-next-outcome'), line);
    const budget = panel.byId('scribe-setting-budget');
    budget.value = '3';
    budget.dispatchEvent({ type: 'input' });
    assert.equal(panel.text('scribe-next-outcome'), line);
    const size = panel.byId('scribe-setting-size');
    size.value = '4';
    size.dispatchEvent({ type: 'input' });
    assert.equal(panel.text('scribe-next-outcome'), '');
    assert.equal(panel.text('scribe-setting-size-problem'), '');
    const again = mounted(ScribeLog.create(), {
        keeper: { phase: Phase.NoBook, settings: { ...settings, size: 'many' } },
    });
    again.click('scribe-next');
    await again.flush();
    const wrong = again.byId('scribe-setting-size');
    wrong.value = 'few';
    wrong.dispatchEvent({ type: 'input' });
    assert.equal(again.text('scribe-next-outcome'), line);
});

test('a failure that lands during a composition is compared when it ends', async () => {
    const log = ScribeLog.create();
    const panel = mounted(log, { keeper: stoppedFailed });
    const held = panel.keeper.hold();
    panel.click('scribe-next');
    await panel.flush();
    const search = panel.byId('scribe-search');
    search.dispatchEvent({ type: 'compositionstart', bubbles: true });
    held.fail(new Error(refused));
    await panel.flush();
    panel.keeper.current = keeperView(log, { phase: Phase.Stopped, stop: { reason: 'Budget', problem: null } });
    panel.redraw();
    search.dispatchEvent({ type: 'compositionend', bubbles: true });
    await panel.flush();
    assert.equal(panel.text('scribe-next-outcome'), '');
    panel.redraw();
    assert.equal(panel.text('scribe-next-outcome'), '');
});

/**
 * @param {string} phase
 * @param {object} changes
 * @return {object}
 */
function cloudView(phase, changes = {}) {
    return { phase, keyed: true, conflict: null, notes: null, unsent: 0, problem: null, ...changes };
}

const BAD_ROOM = "This chat's ID cannot be used as a room in your Worker";

test('the headline says where the book is kept', () => {
    const log = readTo(ScribeLog.create(), 0);
    const idle = keeperView(log);
    const watching = keeperView(log, { phase: Phase.Watching, reader: false });
    const today = PanelView.headline(idle, liveView());
    assert.equal(today.startsWith('Waiting to read: '), true);
    const cases = [
        [idle, null, today],
        [idle, cloudView('Off', { keyed: false }), today],
        [idle, cloudView('Leading'), today],
        [watching, cloudView('Off', { keyed: false }), 'Another tab is reading this chat.'],
        [watching, cloudView('Loading'), 'Loading the book from your Worker...'],
        [watching, cloudView('Watching'), 'Another PC is reading this chat.'],
        [watching, cloudView('Conflict', { conflict: { here: 1, there: 2 } }), 'This PC and your Worker hold different books for this chat.'],
        [idle, cloudView('Offline'), today],
        [idle, cloudView('Refused'), today],
        [idle, cloudView('Unusable', { problem: BAD_ROOM }), today],
        [
            idle,
            cloudView('Leading', { problem: 'Your Worker refused the request: bad_request' }),
            today,
        ],
    ];
    for (const [keeper, cloud, expected] of cases) {
        const line = cloud === null ? PanelView.headline(keeper, liveView()) : PanelView.headline(keeper, liveView(), cloud);
        assert.equal(line, expected, `${keeper.phase} ${cloud?.phase}`);
        const panel = mounted(log, { keeper: { phase: keeper.phase, reader: keeper.reader }, cloud: cloud ?? undefined });
        assert.equal(panel.text('scribe-headline'), expected);
    }
    const troubled = keeperView(log, { problem: 'Zeta could not be reached' });
    const offline = PanelView.headline(troubled, liveView({}, { problem: 'The scene failed' }), cloudView('Offline', { problem: 'x' }));
    assert.equal(offline, today);
    const issues = PanelView.problems(troubled, liveView({}, { problem: 'The scene failed' }), cloudView('Offline', { problem: 'x' }));
    assert.deepEqual(plain(issues.flatMap((item) => item.details)), ['Zeta could not be reached', 'The scene failed', 'x']);
});

test('the choice shows only on a conflict, with both counts, Use the cloud on the left', () => {
    const log = readTo(ScribeLog.create(), 10);
    for (const phase of ['Off', 'Leading', 'Watching', 'Offline', 'Loading']) {
        const panel = mounted(log, { cloud: cloudView(phase, { conflict: { here: 1, there: 2 } }) });
        assert.equal(panel.byId('scribe-choice').hidden, true, phase);
    }
    const panel = mounted(log, { keeper: { phase: Phase.Watching, reader: false }, cloud: cloudView('Conflict', { conflict: { here: 120, there: 1310 } }) });
    assert.equal(panel.byId('scribe-choice').hidden, false);
    assert.equal(panel.text('scribe-choice-counts'), 'This PC: 120 messages read. Your Worker: 1,310 messages read.');
    assert.deepEqual(panel.buttonTexts('scribe-choice'), ["Use the cloud's", "Keep this PC's book"]);
    assert.equal(panel.byId('scribe-keep-here').classes.has('primary'), true);
    assert.equal(panel.byId('scribe-use-cloud').classes.has('primary'), false);
    assert.deepEqual(panel.buttonsWhere('scribe-choice', true), []);
    assert.equal(panel.questions.length, 0);
    panel.cloud.current = cloudView('Conflict', { conflict: { here: null, there: 1 } });
    panel.redraw();
    assert.equal(panel.text('scribe-choice-counts'), 'This PC: no book. Your Worker: 1 message read.');
    panel.cloud.current = cloudView('Conflict', { conflict: { here: 0, there: null } });
    panel.redraw();
    assert.equal(panel.text('scribe-choice-counts'), 'This PC: 0 messages read. Your Worker: no book.');
    panel.cloud.current = cloudView('Leading');
    panel.redraw();
    assert.equal(panel.byId('scribe-choice').hidden, true);
});

test('either choice says Working at once and shows a refusal in its outlet', async () => {
    const log = readTo(ScribeLog.create(), 10);
    const conflict = cloudView('Conflict', { conflict: { here: 120, there: 131 } });
    const panel = mounted(log, { keeper: { phase: Phase.Watching, reader: false }, cloud: conflict });
    const held = panel.cloud.hold();
    panel.click('scribe-keep-here');
    await panel.flush();
    assert.equal(panel.text('scribe-choice-outcome'), 'Working...');
    assert.deepEqual(panel.buttonsWhere('scribe-choice', true), ["Use the cloud's", "Keep this PC's book"]);
    panel.click('scribe-use-cloud');
    await panel.flush();
    assert.equal(panel.cloud.called('useCloud').length, 0);
    held.open();
    await panel.flush();
    assert.equal(panel.text('scribe-choice-outcome'), '');
    assert.deepEqual(panel.buttonsWhere('scribe-choice', true), []);
    assert.equal(panel.cloud.called('keep').length, 1);
    const elsewhere = "Another PC is reading this chat; this PC's book is kept as soon as it lets go.";
    panel.cloud.failure = new Error(elsewhere);
    panel.click('scribe-keep-here');
    await panel.flush();
    assert.equal(panel.text('scribe-choice-outcome'), elsewhere);
    assert.equal(panel.text('scribe-trouble'), '');
    panel.click('scribe-use-cloud');
    await panel.flush();
    assert.equal(panel.cloud.called('useCloud').length, 1);
    assert.equal(panel.text('scribe-choice-outcome'), '');
    assert.equal(panel.questions.length, 0);
});

test('the Settings tab says where the book is kept and how much of the notes goes to the models', async () => {
    const log = readTo(ScribeLog.create(), 10);
    const local = mounted(log);
    await local.tab('Settings');
    assert.equal(
        local.text('scribe-cloud-state'),
        'Worker unchecked. No DM API key on this PC. In Tampermonkey, choose Zeta Scribe → Set DM API key and enter the key used on the other PC.',
    );
    assert.equal(local.byId('scribe-notes').hidden, true);
    const cases = [
        [null, 'No operator notes for this chat in your Worker.'],
        [{ length: 0, cut: null }, 'No operator notes for this chat in your Worker.'],
        [{ length: 1, cut: null }, '1 character of the operator notes goes to the models.'],
        [{ length: 3000, cut: 4001 }, '3,000 characters of the operator notes go to the models. They were cut from 4,001 characters.'],
        [{ length: 4000, cut: null }, '4,000 characters of the operator notes go to the models.'],
    ];
    for (const [notes, expected] of cases) {
        const panel = mounted(log, { cloud: cloudView('Leading', { notes, bookRevision: 3, checkedNotes: true }) });
        await panel.tab('Settings');
        assert.equal(panel.text('scribe-cloud-state'), 'Worker book revision 3. Open this room on the other PC with the same DM API key.');
        assert.equal(panel.byId('scribe-notes').hidden, false);
        assert.equal(panel.text('scribe-notes'), expected);
    }
});

test('the choice fits a phone: the block takes the width and its buttons wrap', () => {
    const log = readTo(ScribeLog.create(), 10);
    const panel = mounted(log, { width: 390, cloud: cloudView('Conflict', { conflict: { here: 120, there: 131 } }) });
    assert.equal(panel.byId('scribe-choice').hidden, false);
    assert.equal(panel.byId('scribe-use-cloud').parent.classes.has('actions'), true);
    assert.equal(panel.byId('scribe-choice').classes.has('choice'), true);
    assert.match(PanelStyle.Text, /\.choice \{[^}]*flex: 1 1 100%;/);
    assert.match(PanelStyle.Text, /\.choice p \{[^}]*overflow-wrap: anywhere;/);
    assert.match(PanelStyle.Text, /\.actions \{[^}]*flex-wrap: wrap;/);
    assert.doesNotMatch(PanelStyle.Text, /\.choice[^{]*\{[^}]*(white-space: nowrap|overflow-x: (scroll|auto))/);
});

test('a cloud view that throws locks everything', () => {
    const log = readTo(ScribeLog.create(), 10);
    const panel = mounted(log, { cloud: cloudView('Conflict', { conflict: { here: 1, there: 2 } }) });
    panel.cloud.view = () => {
        throw new Error('The cloud view broke');
    };
    panel.redraw();
    assert.equal(panel.text('scribe-trouble'), 'Something went wrong in the panel: The cloud view broke');
    assert.equal(panel.byId('scribe-use-cloud').disabled, true);
    assert.equal(panel.byId('scribe-keep-here').disabled, true);
});

test("the Analyzer's contradictions are listed newest first with both quotes, are dismissed, and never block", async () => {
    const log = rulingsBook();
    /**
     * @param {string} id
     * @param {number} position
     * @param {number} earlierPosition
     * @param {boolean} dismissed
     * @return {object}
     */
    const read = (id, position, earlierPosition, dismissed) => ({
        id,
        cite: `MESSAGE-${position}`,
        position,
        earlier: `MESSAGE-${earlierPosition}`,
        earlierPosition,
        said: `guarded the staff ${position}`,
        before: `held the staff ${earlierPosition}`,
        why: `Two keepers of one staff at ${position}.`,
        dismissed,
    });
    const contradictions = [read('first', 3, 1, false), read('gone', 4, 2, true), read('second', 9, 5, false)];
    const state = { ...replay(log), contradictions };
    const panel = mounted(log, { keeper: { state } });
    const before = panel.text('scribe-badge');
    await panel.tab('Rulings');
    assert.deepEqual(panel.rowTexts('contradictions').map((text) => text.split('.')[0]), [
        '#9 "guarded the staff 9" against #5 "held the staff 5"Two keepers of one staff at 9',
        '#3 "guarded the staff 3" against #1 "held the staff 1"Two keepers of one staff at 3',
    ]);
    panel.button(panel.rowSaying('contradictions', 'staff 9'), 'Dismiss').click();
    await panel.flush();
    assert.deepEqual(panel.keeper.calls.at(-1), {
        name: 'rule',
        args: [{ type: 'DismissContradiction', contradiction: 'second' }],
    });
    const quiet = mounted(log, { keeper: { state: { ...replay(log), contradictions: [] } } });
    assert.equal(quiet.text('scribe-badge'), before);
    assert.deepEqual(plain(PanelView.needs(state)), plain(PanelView.needs(replay(log))));
});

test('the header says which live calls keep failing, and the reminder line says why none waits', async () => {
    const log = readTo(ScribeLog.create(), 40);
    const held = 'No reminder: the scene was last read at #157; the latest reply is #225.';
    const panel = mounted(log, {
        live: liveView([], {
            failing: [{ role: 'scene', reason: 'HTTP 402' }, { role: 'check', reason: 'no answer' }],
            held,
        }),
    });
    assert.equal(panel.byId('scribe-problems').children.length, 2);
    assert.match(panel.text('scribe-problems'), /OpenRouter reported a credit or spending limit/);
    assert.match(panel.text('scribe-problems'), /Story checks could not run/);
    assert.match(panel.text('scribe-problem-details'), /no answer/);
    await panel.tab('Findings');
    assert.equal(panel.byId('scribe-reminder').getAttribute('placeholder'), held);
});

test('the phone strip groups and clears only the affected work while Progress retains masked detail', async () => {
    const key = 'example-test-secret-for-this-browser';
    const storage = new FakeStorage();
    ScribeStore.setKey(storage, key);
    const reason = 'unexpected HTTP status; status 401; finish none; reason: <b>user not found</b> ' + key;
    const errors = (roles) => liveView([], {
        failing: roles.map((role) => ({ role, reason, retrying: false })),
        problem: roles.length ? reason : null,
        calls: [],
    });
    const room = mounted(ScribeLog.create(), {
        width: 320,
        storage,
        keeper: { phase: Phase.Loading, flight: 'Reading chat history from Zeta · 155 messages' },
        live: errors(['scene', 'check']),
    });
    assert.equal(room.byId('scribe-problems').hidden, true);
    assert.equal(room.text('scribe-problems-compact'), 'OpenRouter key rejected');
    room.click('scribe-toggle');
    await room.flush();
    const expected = 'OpenRouter rejected the saved API key. Scene updates and story checks could not run. Open Settings, enter your current OpenRouter key, and press Save key.';
    for (let draw = 0; draw < 2; draw++) {
        room.redraw();
        assert.equal(room.text('scribe-headline'), 'Reading chat history from Zeta · 155 messages');
        assert.equal(room.byId('scribe-problems').children.length, 1);
        assert.equal(room.text('scribe-problems'), expected);
    }
    await room.tab('Progress');
    assert.match(room.text('scribe-problem-details'), /<b>user not found<\/b> \[key\]/);
    assert.ok(!room.root.textContent.includes(key));
    room.live.current = errors(['scene', 'check', 'recap']);
    room.redraw();
    assert.match(room.text('scribe-problems'), /Scene updates, story checks, and story recap could not run/);
    room.live.current = errors(['check']);
    room.redraw();
    assert.match(room.text('scribe-problems'), /Story checks could not run/);
    assert.doesNotMatch(room.text('scribe-problems'), /[Ss]cene/);
    room.cloud.current = cloudView('Refused');
    room.redraw();
    room.click('scribe-toggle');
    await room.flush();
    assert.equal(room.text('scribe-problems-compact'), '2 problems');
    room.cloud.current = cloudView('Off');
    room.live.current = errors([]);
    room.redraw();
    assert.equal(room.byId('scribe-problems-compact').hidden, true);
    assert.equal(room.text('scribe-problem-details'), '');
});

test('an unreadable key slot keeps a raw diagnostic out of the panel', () => {
    const secret = 'secret-used-only-by-this-test';
    const storage = new FakeStorage();
    ScribeStore.setKey(storage, secret);
    storage.refuseGetsMatching(/^scribe:key$/);
    const room = mounted(ScribeLog.create(), {
        storage,
        live: liveView([], { failing: [{ role: 'scene', reason: 'HTTP 401: ' + secret }] }),
    });
    assert.ok(!room.root.textContent.includes(secret));
    assert.match(room.text('scribe-problem-details'), /Diagnostic withheld/);
    assert.equal(room.byId('scribe-problems').children.length, 1);
});

test('problem classification keeps service, provider reason, finish and retry state distinct', () => {
    const keeper = { problem: scripts.ZetaSource.Settings.Messages.NoLogin, stop: { reason: 'Failed', problem: 'HTTP 401' } };
    const models = (reasons) => ({ failing: reasons.map(([role, reason, retrying]) => ({ role, reason, retrying })) });
    const error = (role, reason) => [role, reason, false];
    const service = PanelView.problems(keeper, models([error('scene', 'HTTP 401: user missing')]), cloudView('Refused'));
    assert.deepEqual(plain(service.map((item) => [item.service, item.cause])), [['Zeta', 'login'], ['Scribe', 'local'], ['OpenRouter', 'key'], ['Cloudflare', 'workerKey']]);
    assert.match(service[3].explanation, /Tampermonkey.*Set DM API key/);
    const reasons = [
        error('scene', 'unexpected HTTP status; status 503; finish none; reason: nested HTTP 401'),
        error('check', 'unexpected HTTP status; status 503; finish none; reason: capacity'),
        error('recap', 'answer was cut off; status 200; finish length'),
        error('scene', 'request failed; status no response; finish none'),
        error('check', 'response body is not a JSON object; status 200; finish none'),
        error('scene', 'quoted 401'),
        error('check', 'unknown second reason'),
        error('recap', 'quoted 401'),
    ];
    const issues = PanelView.problems({}, models(reasons));
    assert.deepEqual(plain(issues.map((item) => item.cause)), ['server', 'server', 'length', 'connection', 'unusable', 'unknown', 'unknown']);
    assert.deepEqual(plain(issues[5].operations), ['scene updates', 'story recap']);
    for (const retrying of [true, false]) {
        const issue = PanelView.problems({}, models([['recap', 'HTTP 429', retrying]]))[0];
        assert.equal(issue.cause, 'rate');
        assert.equal(issue.explanation.includes('retry is scheduled'), retrying);
    }
});

test('live calls are listed beside the keeper calls, a cut-off answer with its first characters', async () => {
    const log = readTo(ScribeLog.create(), 40);
    const calls = [
        Object.freeze({
            role: 'Pedant',
            tokensIn: 900,
            tokensOut: 4000,
            reasoningTokens: 3100,
            finish: 'length',
            answer: 'w'.repeat(2000),
            problem: 'answer was cut off; status 200; finish length',
        }),
        Object.freeze({
            role: 'Scribe',
            tokensIn: 10,
            tokensOut: 20,
            reasoningTokens: null,
            finish: 'stop',
            answer: null,
            problem: null,
        }),
    ];
    const panel = mounted(log, { live: liveView([], { calls }) });
    await panel.tab('Progress');
    const texts = panel.rowTexts('liveCalls');
    assert.equal(texts.length, 2);
    assert.equal(texts[0].startsWith('Pedant: in 900, out 4,000, reasoning 3,100, finish length'), false, texts[0]);
    assert.equal(texts[0].startsWith('Pedant: in 900, out 4000, reasoning 3100, finish length'), true, texts[0]);
    assert.equal(texts[0].includes('answer was cut off'), true);
    assert.equal(texts[0].includes('w'.repeat(2000)), true);
    assert.equal(texts[1], 'Scribe: in 10, out 20, finish stop');
});

test('legacy live-call fields are masked on display with either key or an unreadable key slot', async () => {
    const storage = new FakeStorage();
    ScribeStore.setKey(storage, 'opaque-provider');
    ScribeStore.setCloudKey(storage, 'opaque-worker');
    const detail = '<i>opaque-worker / opaque-provider</i>';
    const calls = [{ role: 'Pedant', finish: detail, answer: detail, problem: detail }];
    const room = mounted(ScribeLog.create(), { storage, live: liveView([], { calls }) });
    await room.tab('Progress');
    assert.match(room.rowTexts('liveCalls')[0], /<i>\[key\] \/ \[key\]<\/i>/);
    for (const slot of [/^scribe:key$/, /^scribe:cloudkey$/]) {
        storage.refuseGetsMatching(slot);
        room.redraw();
        const text = room.rowTexts('liveCalls')[0];
        assert.match(text, /Diagnostic withheld/);
        assert.doesNotMatch(text, /opaque-/);
        storage.allow();
    }
    const mixed = PanelView.problems({ stop: { reason: 'Failed', source: 'Scribe', problem: 'HTTP 401' } }, {
        failing: [
            { role: 'scene', source: 'Scribe', reason: 'HTTP 401' },
            { role: 'check', source: 'OpenRouter', reason: 'HTTP 401' },
        ],
    });
    assert.deepEqual(plain(mixed.map(({ service, operations }) => [service, operations])), [
        ['Scribe', ['book reading', 'scene updates']], ['OpenRouter', ['story checks']],
    ]);
});

test('Force stop shows only while a call has run four minutes, and pressing it stops that call', async () => {
    const panel = mounted(readTo(ScribeLog.create(), 40));
    assert.equal(panel.byId('scribe-force-stop').hidden, true);
    panel.callDue = true;
    panel.redraw();
    assert.equal(panel.byId('scribe-force-stop').hidden, false);
    assert.equal(panel.text('scribe-force-stop'), 'Force stop');
    panel.click('scribe-force-stop');
    await panel.flush();
    assert.equal(panel.forceStops, 1);
    panel.callDue = false;
    panel.redraw();
    assert.equal(panel.byId('scribe-force-stop').hidden, true);
});

test('focus leaves Force stop for the toggle when the button hides while it holds focus', async () => {
    const panel = mounted(readTo(ScribeLog.create(), 40));
    panel.callDue = true;
    panel.redraw();
    const button = panel.byId('scribe-force-stop');
    button.focus();
    assert.equal(panel.root.activeElement, button);
    panel.click('scribe-force-stop');
    await panel.flush();
    panel.callDue = false;
    panel.redraw();
    assert.equal(button.hidden, true);
    assert.equal(panel.root.activeElement, panel.byId('scribe-toggle'));
});

test('a call stopped by the operator shows as stopped, with its cost unknown', async () => {
    const stoppedRead = Object.freeze({
        sequence: null,
        pass: 'Story',
        system: 'prompt',
        input: 'the messages',
        answer: null,
        readable: true,
        stopped: true,
    });
    const stoppedLive = Object.freeze({
        role: 'Scribe',
        tokensIn: null,
        tokensOut: null,
        reasoningTokens: null,
        finish: null,
        answer: null,
        problem: 'Stopped by the operator; cost unknown',
    });
    const panel = mounted(readTo(ScribeLog.create(), 40), {
        keeper: { calls: [stoppedRead] },
        live: liveView([], { calls: [stoppedLive] }),
    });
    await panel.tab('Progress');
    assert.deepEqual(panel.rowTexts('calls'), ['Stopped by the operator: Story; cost unknown']);
    const [live] = panel.rowTexts('liveCalls');
    assert.equal(live.startsWith('Scribe: in (unknown), out (unknown), finish (unknown)'), true, live);
    assert.equal(live.endsWith('Stopped by the operator; cost unknown'), true, live);
    assert.equal(/\b0\b/.test(live), false, live);
});

test('a refused contradiction shows its numbers and quotes in Progress', async () => {
    const log = readTo(ScribeLog.create(), 40);
    const report = {
        pass: 'Story',
        first: 41,
        last: 80,
        read: 80,
        total: 100,
        spent: 0.5,
        calls: 2,
        unpriced: 0,
        stored: 3,
        refusedLines: [],
        refusedOperations: [
            {
                operation: {
                    type: 'Contradiction',
                    position: 45,
                    said: 'guarded it',
                    earlier: null,
                    before: null,
                    entry: 'F67',
                    why: 'Two keepers',
                },
                reason: 'Quote',
            },
            {
                operation: {
                    type: 'Contradiction',
                    position: 45,
                    said: 'kept it',
                    earlier: 5,
                    before: 'held it',
                    entry: null,
                    why: 'Two spans',
                },
                reason: 'Citation',
            },
        ],
    };
    const panel = mounted(log, { keeper: { lines: [report] } });
    await panel.tab('Progress');
    const text = panel.rowTexts('lines')[0];
    assert.equal(text.includes('Contradiction | #45 "guarded it" | F67 | Two keepers (Quote)'), true, text);
    assert.equal(text.includes('Contradiction | #45 "kept it" | #5 "held it" | Two spans (Citation)'), true, text);
});

test('an edit written before the latest reply stays shown, says why, and goes when saved again unchanged', async () => {
    const log = readTo(ScribeLog.create(), 40);
    const held = 'Your edit was written before the latest reply; Save it again to send it.';
    const panel = mounted(log, {
        live: liveView([], { ready: null, edited: true, stale: true, draft: '[Scribe] Mine.', held }),
    });
    await panel.tab('Findings');
    assert.equal(panel.byId('scribe-reminder').value, '[Scribe] Mine.');
    assert.equal(panel.text('scribe-held'), held);
    assert.equal(panel.byId('scribe-held').hidden, false);
    panel.click('scribe-edit');
    await panel.flush();
    assert.equal(panel.byId('scribe-reminder').value, '[Scribe] Mine.');
    panel.click('scribe-edit-save');
    await panel.flush();
    assert.deepEqual(panel.live.calls.at(-1), { name: 'edit', args: ['[Scribe] Mine.', true] });
});

test('saving a key asks the keeper to lift a failed reading', async () => {
    const log = readTo(ScribeLog.create(), 40);
    const panel = mounted(log);
    await panel.tab('Settings');
    panel.byId('scribe-key').value = 'sk-or-made-up-key';
    panel.click('scribe-save-key');
    await panel.flush();
    assert.deepEqual(
        panel.keeper.calls.map((call) => call.name),
        ['rekey'],
    );
    assert.deepEqual(
        panel.live.calls.map((call) => call.name),
        ['rekey'],
    );
});
