import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

/**
 * @param {string[]} paths
 * @param {object} globals
 * @return {Object<string, object>}
 */
function loadScripts(paths, globals = {}) {
    const context = vm.createContext({ ...globals });
    const loaded = {};
    for (const [label, relativePath] of paths) {
        const url = new URL(relativePath, import.meta.url);
        vm.runInContext(readFileSync(url, 'utf8'), context, { filename: url.pathname });
        loaded[label] = vm.runInContext(label, context);
    }
    return loaded;
}

const { ScribeSetup } = loadScripts([['ScribeSetup', '../scribe/page/ScribeSetup.js']]);
const { ScribeSetup: SetupWithIntake } = loadScripts([
    ['ScribeIntake', '../scribe/core/ScribeIntake.js'],
    ['ScribeSetup', '../scribe/page/ScribeSetup.js'],
]);

/**
 * @param {*} value
 * @return {*}
 */
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

/**
 * @param {object} overrides
 * @return {object}
 */
function samplePlot(overrides = {}) {
    return {
        plotId: 'plot-harbour-01',
        name: 'Harbour Lights',
        summary: 'A misty port with old debts for {{user}}.',
        description: 'Fog sits over the breakwater.\n\n{{USER}} arrives on the night ferry.',
        about: 'Written for slow coastal mystery.\n\nKeep track of tides.',
        creatorComment: 'Enjoy the harbour.',
        language: 'en',
        mode: 'roleplay',
        hashtags: ['mystery', 'harbour'],
        characters: [
            { id: 'char-1', name: 'Maren', description: 'Harbour master who watches {{user}}.' },
            { id: 'char-2', name: 'Tomas', description: '' },
        ],
        chatProfiles: [
            { id: 'cp-1', name: 'Ferry Clerk', summary: 'Keeps manifests', description: 'Knows {{user}} by sight.' },
        ],
        opening: [
            { speaker: 'Narrator', text: 'Rain taps the pier as {{user}} steps ashore.' },
            { speaker: '', text: 'A distant bell rings twice.' },
        ],
        lore: [
            { name: 'Lantern Law', text: 'No vessel leaves before dawn without {{user}} signing.' },
            { name: '', text: 'Salt corrodes iron keys quickly.' },
        ],
        raw: {
            characters: [{ id: 'char-1', name: 'Maren', imageUrl: 'https://cdn.example/maren.png' }],
            chatProfiles: [{ id: 'cp-1', name: 'Ferry Clerk', isUsingDefaultName: false }],
            intros: [{ id: 'intro-1', name: 'Night Ferry', conversation: { messages: [{ content: 'Rain taps for {{user}}.' }] } }],
            lorebooks: [{ id: 'lore-1', name: 'Lantern Law', triggers: ['lantern', 'harbour'], keywords: ['dawn'], content: 'No vessel leaves.' }],
            conversations: [],
            plugins: [{ id: 'plugin-1', enabled: true }],
            infoBoxSetting: { enabled: false },
            cyoaSetting: null,
            creator: { id: 'creator-1', name: 'Nora Vale' },
            isLongDescriptionPublic: true,
            isExampleConversationPublic: true,
            isAboutPublic: true,
        },
        ...overrides,
    };
}

test('build orders all sections, preserves description and about paragraphs, and omits empty sections', () => {
    const profile = {
        source: 'Persona',
        name: 'Frost',
        description: 'A quiet surveyor with a brass compass.',
        text: 'Frost: A quiet surveyor with a brass compass.',
    };
    const built = ScribeSetup.build(samplePlot(), profile, 'unknown');
    assert.equal(Object.isFrozen(built), true);
    assert.equal(built.source, 'Persona');
    assert.equal(built.persona, 'Frost');
    assert.equal(built.storyText, [
        'Harbour Lights: A misty port with old debts for Frost.',
        'Fog sits over the breakwater.\n\nFrost arrives on the night ferry.',
        'About:\nWritten for slow coastal mystery.\n\nKeep track of tides.',
        'Story characters:\n- Maren: Harbour master who watches Frost.\n- Tomas',
        'Opening:\nNarrator: Rain taps the pier as Frost steps ashore.\nA distant bell rings twice.',
        'Lore:\n- Lantern Law: No vessel leaves before dawn without Frost signing.\n- Salt corrodes iron keys quickly.',
    ].join('\n\n'));
    assert.equal(built.profileText, 'Frost: A quiet surveyor with a brass compass.');
    assert.equal(built.shown, Array.from(built.storyText).length);
    assert.equal(built.whole, Array.from(built.storyText).length);
    const headings = ScribeSetup.Settings.Headings;
    assert.equal(
        built.text,
        `${headings.Background}\n\n${headings.Story}\n${built.storyText}\n\n${headings.Profile}\n${built.profileText}`,
    );

    const sparse = ScribeSetup.build({
        name: 'Only Title',
        summary: '   ',
        description: '',
        about: null,
        characters: [{ name: '', description: 'Ignored' }, null],
        opening: [{ speaker: 'Narrator', text: '  ' }],
        lore: [{ name: 'Empty', text: '' }],
    }, null, '');
    assert.equal(sparse.storyText, 'Only Title');
    assert.equal(sparse.profileText, null);
    assert.equal(sparse.text, `${headings.Background}\n\n${headings.Story}\nOnly Title`);

    const summaryOnly = ScribeSetup.build({ name: '', summary: 'Just a summary' }, null, '');
    assert.equal(summaryOnly.storyText, 'Just a summary');

    const profileOnly = ScribeSetup.build(null, profile, '');
    assert.equal(profileOnly.storyText, null);
    assert.equal(profileOnly.shown, 0);
    assert.equal(profileOnly.whole, 0);
    assert.equal(profileOnly.profileText, profile.text);
    assert.equal(profileOnly.text, `${headings.Background}\n\n${headings.Profile}\n${profile.text}`);

    const empty = ScribeSetup.build(null, null, '');
    assert.deepEqual(plain(empty), {
        text: null,
        storyText: null,
        profileText: null,
        shown: 0,
        whole: 0,
        source: null,
        persona: null,
    });

    const arrayStory = ScribeSetup.build(
        Object.assign(['ignored'], { name: 'Should Ignore' }),
        { source: 123, name: '   ', text: 'A quiet wanderer.' },
        '',
    );
    assert.equal(arrayStory.storyText, null);
    assert.equal(arrayStory.shown, 0);
    assert.equal(arrayStory.whole, 0);
    assert.equal(arrayStory.source, null);
    assert.equal(arrayStory.persona, null);
    assert.equal(arrayStory.profileText, 'A quiet wanderer.');

    const trimmedMeta = ScribeSetup.build(null, { source: ' Persona ', name: ' Frost ', text: 'Frost: calm' }, '');
    assert.equal(trimmedMeta.source, 'Persona');
    assert.equal(trimmedMeta.persona, 'Frost');
});

test('cap enforces 6000 code points across newlines, CRLF, unbroken runs, and surrogate pairs with headings excluded', () => {
    const exact = 'a'.repeat(6000);
    const exactResult = ScribeSetup.cap(exact, 6000);
    assert.equal(Object.isFrozen(exactResult), true);
    assert.deepEqual(plain(exactResult), { text: exact, shown: 6000, whole: 6000 });

    const withNewline = `${'a'.repeat(5950)}\n${'b'.repeat(200)}`;
    const cutNewline = ScribeSetup.cap(withNewline, 6000);
    assert.equal(cutNewline.text, 'a'.repeat(5950));
    assert.equal(cutNewline.shown, 5950);
    assert.equal(cutNewline.whole, 6151);

    const withCrlf = `${'a'.repeat(5950)}\r\n${'b'.repeat(200)}`;
    const cutCrlf = ScribeSetup.cap(withCrlf, 6000);
    assert.equal(cutCrlf.text, 'a'.repeat(5950));
    assert.equal(cutCrlf.text.endsWith('\r'), false);
    assert.equal(cutCrlf.shown, 5950);
    assert.equal(cutCrlf.whole, 6152);

    const unbroken = 'x'.repeat(6200);
    const cutUnbroken = ScribeSetup.cap(unbroken, 6000);
    assert.equal(cutUnbroken.text, 'x'.repeat(6000));
    assert.equal(cutUnbroken.shown, 6000);
    assert.equal(cutUnbroken.whole, 6200);

    const leadingBreak = `\n${'z'.repeat(10)}`;
    const cutLeadingBreak = ScribeSetup.cap(leadingBreak, 5);
    assert.equal(cutLeadingBreak.text, '\nzzzz');
    assert.equal(cutLeadingBreak.shown, 5);
    assert.equal(cutLeadingBreak.whole, 11);

    const leadingCrlf = `\r\n${'z'.repeat(10)}`;
    const cutLeadingCrlf = ScribeSetup.cap(leadingCrlf, 5);
    assert.equal(cutLeadingCrlf.text, '\r\nzzz');
    assert.equal(cutLeadingCrlf.shown, 5);
    assert.equal(cutLeadingCrlf.whole, 12);

    const straddlingCrlf = ScribeSetup.cap('abcde\r\nfghij', 6);
    assert.deepEqual(plain(straddlingCrlf), { text: 'abcde', shown: 5, whole: 12 });

    assert.deepEqual(plain(ScribeSetup.cap(null, 10)), { text: '', shown: 0, whole: 0 });
    assert.deepEqual(plain(ScribeSetup.cap(42, 10)), { text: '', shown: 0, whole: 0 });
    assert.deepEqual(plain(ScribeSetup.cap('abcdef', 0)), { text: '', shown: 0, whole: 6 });
    assert.deepEqual(plain(ScribeSetup.cap('abcdef', -5)), { text: '', shown: 0, whole: 6 });
    assert.deepEqual(plain(ScribeSetup.cap('abcdef', Number.NaN)), { text: '', shown: 0, whole: 6 });
    assert.deepEqual(plain(ScribeSetup.cap('abcdef', Number.POSITIVE_INFINITY)), { text: '', shown: 0, whole: 6 });
    assert.deepEqual(plain(ScribeSetup.cap('abcdef', 0.5)), { text: '', shown: 0, whole: 6 });
    assert.deepEqual(plain(ScribeSetup.cap('abcdef', 3.9)), { text: 'abc', shown: 3, whole: 6 });

    const astralExact = '𐍈'.repeat(6000);
    const astralFits = ScribeSetup.cap(astralExact, 6000);
    assert.equal(astralFits.shown, 6000);
    assert.equal(astralFits.whole, 6000);
    assert.equal(astralFits.text.length, 12000);

    const astralOver = '𐍈'.repeat(6005);
    const astralCut = ScribeSetup.cap(astralOver, 6000);
    assert.equal(astralCut.shown, 6000);
    assert.equal(astralCut.whole, 6005);
    assert.equal(astralCut.text.length, 12000);
    assert.equal(astralCut.text.isWellFormed(), true);

    const built = ScribeSetup.build({ description: exact }, { source: 'Persona', name: 'Rowan', text: 'Rowan: calm' }, 'Rowan');
    assert.equal(built.shown, 6000);
    assert.equal(built.whole, 6000);
    assert.equal(built.storyText, exact);
    assert.equal(Array.from(built.text).length > 6000, true);
});

test('player resolution and {{user}} substitution skip unknown, respect ScribeIntake, handle dollar patterns, and run before cap', () => {
    const profile = { source: 'Persona', name: '  Frost  ', text: 'Frost: surveyor' };
    assert.equal(ScribeSetup.resolvePlayer('Maren', profile), 'Maren');
    assert.equal(ScribeSetup.resolvePlayer('  Maren  ', profile), 'Maren');
    assert.equal(ScribeSetup.resolvePlayer('unknown', profile), 'Frost');
    assert.equal(ScribeSetup.resolvePlayer('UNKNOWN', profile), 'Frost');
    assert.equal(ScribeSetup.resolvePlayer('  UnKnOwN  ', profile), 'Frost');
    assert.equal(ScribeSetup.resolvePlayer('', profile), 'Frost');
    assert.equal(ScribeSetup.resolvePlayer('unknown', null), null);
    assert.equal(ScribeSetup.resolvePlayer('unknown', { name: '   ' }), null);
    assert.equal(SetupWithIntake.resolvePlayer('UNKNOWN', profile), 'Frost');

    const { ScribeSetup: CustomSetup } = loadScripts(
        [['ScribeSetup', '../scribe/page/ScribeSetup.js']],
        { ScribeIntake: { Settings: { UnknownPlayer: ' anon ' } } },
    );
    assert.equal(CustomSetup.resolvePlayer('ANON', profile), 'Frost');
    assert.equal(CustomSetup.resolvePlayer('unknown', profile), 'unknown');

    const { ScribeSetup: SpacedUnknownSetup } = loadScripts(
        [['ScribeSetup', '../scribe/page/ScribeSetup.js']],
        { ScribeIntake: { Settings: { UnknownPlayer: ' unknown ' } } },
    );
    assert.equal(SpacedUnknownSetup.resolvePlayer('UNKNOWN', profile), 'Frost');

    assert.equal(ScribeSetup.substitute('{{user}} meets {{USER}} and {{User}}', '$& $$ $1'), '$& $$ $1 meets $& $$ $1 and $& $$ $1');
    assert.equal(ScribeSetup.substitute('Stay {{user}}', null), 'Stay {{user}}');
    assert.equal(ScribeSetup.substitute('Stay {{user}}', ''), 'Stay {{user}}');

    const literalBuilt = ScribeSetup.build({ description: 'Welcome {{user}} and {{USER}}.' }, null, '$& $$ $1');
    assert.equal(literalBuilt.storyText, 'Welcome $& $$ $1 and $& $$ $1.');

    const untouchedBuilt = ScribeSetup.build({ description: 'Welcome {{user}}.' }, null, 'UNKNOWN');
    assert.equal(untouchedBuilt.storyText, 'Welcome {{user}}.');

    const expanded = ScribeSetup.build(
        { description: `${'a'.repeat(5995)}{{user}}` },
        null,
        'Alexander',
    );
    assert.equal(expanded.whole, 6004);
    assert.equal(expanded.shown, 6000);
    assert.equal(expanded.storyText, `${'a'.repeat(5995)}Alexa`);
});

test('line breaks collapse in flat fields and twelve story characters stay ordered', () => {
    assert.equal(ScribeSetup.flatten('  line one\r\n\r\nline two\nline three  '), 'line one line two line three');
    assert.equal(ScribeSetup.flatten('first\rsecond'), 'first second');
    assert.equal(ScribeSetup.flatten(null), '');

    const characters = Array.from({ length: 12 }, (unused, index) => ({
        name: `Character\n${index + 1}`,
        description: `Role ${index + 1}\r\nline two`,
    }));
    const built = ScribeSetup.build({
        name: 'Harbour\nLights',
        summary: 'Short\r\nsummary\n\nhere',
        characters,
        opening: [{ speaker: 'Captain\nMaren', text: 'First line\r\nSecond line' }],
        lore: [{ name: 'Tide\nBell', text: 'Rings at\n\ndusk' }],
    }, null, '');

    assert.equal(built.storyText.startsWith('Harbour Lights: Short summary here\n\nStory characters:\n'), true);
    for (let index = 1; index <= 12; index++) {
        assert.equal(built.storyText.includes(`- Character ${index}: Role ${index} line two`), true, `character ${index}`);
    }
    assert.equal(built.storyText.indexOf('- Character 1:') < built.storyText.indexOf('- Character 12:'), true);
    assert.equal(built.storyText.includes('Opening:\nCaptain Maren: First line Second line'), true);
    assert.equal(built.storyText.includes('Lore:\n- Tide Bell: Rings at dusk'), true);
});

test('exportBundle builds lossless plot and plot+chat JSON, omits Scribe internals, deep-clones, and rejects incomplete chat', () => {
    const plot = samplePlot();
    const longDescription = 'Surveyor notes. '.repeat(200);
    const profile = {
        source: 'Persona',
        name: 'Frost',
        description: longDescription,
        text: 'Frost: truncated prompt text',
    };
    const plotOnly = ScribeSetup.exportBundle({
        plot,
        profile,
        notes: 'Full DM notes without cap.',
        exportedAt: '2026-11-26T10:00:00.000Z',
        book: { entries: ['secret'] },
        live: { seen: 'm1' },
        settings: { key: 'sk-or-v1-secret' },
    });

    assert.deepEqual(Object.keys(plotOnly).sort(), [
        'chat',
        'exportedAt',
        'format',
        'introId',
        'notes',
        'plot',
        'plotId',
        'profile',
        'roomId',
        'roomTitle',
        'version',
    ]);
    assert.equal(plotOnly.format, 'zeta-scribe-plot');
    assert.equal(plotOnly.version, 1);
    assert.equal(plotOnly.exportedAt, '2026-11-26T10:00:00.000Z');
    assert.equal(plotOnly.plotId, 'plot-harbour-01');
    assert.equal(plotOnly.roomId, null);
    assert.equal(plotOnly.roomTitle, null);
    assert.equal(plotOnly.introId, null);
    assert.equal(plotOnly.chat, null);
    assert.equal(plotOnly.notes, 'Full DM notes without cap.');
    assert.equal(plotOnly.plot.id, 'plot-harbour-01');
    assert.equal(plotOnly.plot.shortDescription, 'A misty port with old debts for {{user}}.');
    assert.equal(plotOnly.plot.longDescription, 'Fog sits over the breakwater.\n\n{{USER}} arrives on the night ferry.');
    assert.equal(plotOnly.plot.about, 'Written for slow coastal mystery.\n\nKeep track of tides.');
    assert.deepEqual(plain(plotOnly.plot.raw.lorebooks[0].triggers), ['lantern', 'harbour']);
    assert.deepEqual(plain(plotOnly.plot.raw.lorebooks[0].keywords), ['dawn']);
    assert.deepEqual(plain(plotOnly.profile), {
        source: 'Persona',
        name: 'Frost',
        description: longDescription,
    });
    assert.equal(Object.hasOwn(plotOnly.profile, 'text'), false);
    assert.equal(JSON.stringify(plotOnly).includes('sk-or-v1-secret'), false);

    const messages = [
        { id: 'm1', senderType: 'AI', content: 'Welcome {{user}}.' },
        { id: 'm2', senderType: 'USER', content: 'I step off the gangplank.' },
    ];
    const withChat = ScribeSetup.exportBundle({
        plot,
        roomId: 'room-42',
        roomTitle: 'Harbour Night',
        introId: 'intro-1',
        profile: null,
        notes: null,
        chat: { completeHistory: true, messages },
        exportedAt: '2026-11-26T10:05:00.000Z',
    });
    assert.equal(withChat.roomId, 'room-42');
    assert.equal(withChat.roomTitle, 'Harbour Night');
    assert.equal(withChat.introId, 'intro-1');
    assert.equal(withChat.profile, null);
    assert.deepEqual(plain(withChat.chat), {
        completeHistory: true,
        messageCount: 2,
        messages,
    });

    plot.characters[0].name = 'Mutated';
    plot.raw.lorebooks[0].triggers.push('mutated');
    messages[0].content = 'Mutated message';
    assert.equal(withChat.plot.characters[0].name, 'Maren');
    assert.deepEqual(plain(withChat.plot.raw.lorebooks[0].triggers), ['lantern', 'harbour']);
    assert.equal(withChat.chat.messages[0].content, 'Welcome {{user}}.');

    const emptyChat = ScribeSetup.exportBundle({
        plot,
        chat: { completeHistory: true, messages: [] },
        exportedAt: '2026-11-26T10:06:00.000Z',
    });
    assert.deepEqual(plain(emptyChat.chat), { completeHistory: true, messageCount: 0, messages: [] });

    const invalidChats = [
        { completeHistory: false, messages: [] },
        { completeHistory: 1, messages: [] },
        { messages: [] },
        { completeHistory: true, messages: null },
        { completeHistory: true, messages: {} },
        [],
        'incomplete',
        42,
        true,
    ];
    for (const invalidChat of invalidChats) {
        assert.throws(
            () => ScribeSetup.exportBundle({ plot, chat: invalidChat, exportedAt: '2026-11-26T10:06:00.000Z' }),
            { message: ScribeSetup.Settings.Messages.IncompleteChat },
        );
    }

    const fromNull = ScribeSetup.exportBundle(null);
    assert.equal(fromNull.format, 'zeta-scribe-plot');
    assert.equal(fromNull.plotId, null);
    assert.equal(fromNull.profile, null);
    assert.equal(fromNull.notes, null);
    assert.equal(fromNull.chat, null);

    const fromEmpty = ScribeSetup.exportBundle();
    assert.equal(fromEmpty.plot.name, '');
    assert.equal(fromEmpty.plot.raw, null);

    const normalized = ScribeSetup.exportBundle({
        plot: {
            plotId: 123,
            name: { value: 1 },
            summary: 42,
            description: true,
            about: [],
            creatorComment: {},
            language: 9,
            mode: false,
            raw: () => 'unserializable',
        },
        roomId: 7,
        roomTitle: ['bad'],
        introId: {},
        profile: ['not-an-object'],
        notes: { text: 'a' },
        exportedAt: 99,
    });
    assert.equal(normalized.plotId, null);
    assert.equal(normalized.roomId, null);
    assert.equal(normalized.roomTitle, null);
    assert.equal(normalized.introId, null);
    assert.equal(normalized.exportedAt, null);
    assert.equal(normalized.notes, null);
    assert.equal(normalized.profile, null);
    assert.equal(normalized.plot.id, null);
    assert.equal(normalized.plot.name, '');
    assert.equal(normalized.plot.shortDescription, '');
    assert.equal(normalized.plot.longDescription, '');
    assert.equal(normalized.plot.about, '');
    assert.equal(normalized.plot.creatorComment, '');
    assert.equal(normalized.plot.language, null);
    assert.equal(normalized.plot.mode, null);
    assert.equal(normalized.plot.raw, null);
});

test('filename produces ASCII-safe bounded slugs with fallbacks and chat prefix toggle', () => {
    assert.equal(ScribeSetup.filename('Harbour Lights', 'plot-1'), 'zeta-plot-harbour-lights.json');
    assert.equal(ScribeSetup.filename('Harbour Lights', 'plot-1', true), 'zeta-plot-chat-harbour-lights.json');
    assert.equal(ScribeSetup.filename('../../etc/passwd', 'plot-1'), 'zeta-plot-etc-passwd.json');
    assert.equal(ScribeSetup.filename('---Hello   World!!!---', 'plot-1'), 'zeta-plot-hello-world.json');
    assert.equal(ScribeSetup.filename('日本語タイトル', '57475939-4faa-4cf0'), 'zeta-plot-57475939-4faa-4cf0.json');
    assert.equal(ScribeSetup.filename('日本語タイトル', '57475939-4faa-4cf0', true), 'zeta-plot-chat-57475939-4faa-4cf0.json');
    assert.equal(ScribeSetup.filename('!!!', '///', false), 'zeta-plot-plot.json');
    assert.equal(ScribeSetup.filename(null, undefined, true), 'zeta-plot-chat-plot.json');

    const trailingBoundary = `${'a'.repeat(59)} tail`;
    const bounded = ScribeSetup.filename(trailingBoundary, 'plot-1');
    assert.equal(bounded, `zeta-plot-${'a'.repeat(59)}.json`);
    assert.equal(bounded.endsWith('-.json'), false);

    const longTitle = 'word-'.repeat(20);
    const sliced = ScribeSetup.filename(longTitle, 'plot-1');
    const slug = sliced.slice('zeta-plot-'.length, -'.json'.length);
    assert.equal(slug.length <= 60, true);
    assert.equal(slug.endsWith('-'), false);
    assert.equal(/^[a-z0-9-]+$/.test(slug), true);
});
