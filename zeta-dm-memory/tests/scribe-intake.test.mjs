import assert from 'node:assert/strict';
import test from 'node:test';
import CampaignBuilder from './support/CampaignBuilder.mjs';
import ScribeCore from './support/ScribeCore.mjs';

const { ScribeText, ScribeIntake } = ScribeCore.load(['ScribeText', 'ScribeIntake']);

const firstNote = 'Brandt is captain of the river guard.';
const secondNote = 'Maren owes Orla a debt.';
const thirdNote = 'The bridge fell last winter.';
const paste = `*${firstNote}*\n*${secondNote}*\n*${thirdNote}*`;

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
 * @param {object[]} raw
 * @return {*}
 */
function texts(raw) {
    return plain(ScribeIntake.read(raw).messages.map((message) => message.text));
}

test('positions and roles', () => {
    const builder = new CampaignBuilder('Orla')
        .playerBlocks([
            ['Orla', 'RIGHT', 'I draw my blade.'],
            ['Narrator', 'NARRATOR', 'Rain falls.'],
            ['Maren', 'LEFT', 'Wait.'],
        ])
        .reply([['Brandt', 'Stand down.']]);
    builder.append('BOT', [{ speakerName: 'Corvane', position: 'RIGHT', text: 'Hm.' }]);
    const result = ScribeIntake.read(builder.messages);
    assert.deepEqual(plain(result.messages.map((message) => message.position)), [1, 2, 3]);
    assert.deepEqual(plain(result.messages[0].blocks.map((block) => block.role)), ['Player', 'Narrator', 'Character']);
    assert.equal(
        result.messages[0].text,
        'Orla (player): I draw my blade.\nNarrator: Rain falls.\nMaren: Wait.',
    );
    assert.equal(result.messages[0].fromPlayer, true);
    assert.equal(result.messages[1].fromPlayer, false);
    assert.equal(result.messages[2].blocks[0].role, 'Character');
    assert.equal(result.messages[2].text, 'Corvane: Hm.');
    assert.equal(ScribeIntake.Role.Player, 'Player');
});

test('the player is found by frequency', () => {
    const builder = new CampaignBuilder('Orla')
        .player('one')
        .playerBlocks([['Guard', 'RIGHT', 'Halt.']])
        .player('two');
    const result = ScribeIntake.read(builder.messages);
    assert.equal(result.player, 'Orla');
    assert.equal(result.messages[1].blocks[0].role, 'Character');
});

test('a tie for the player goes to the first seen, and none gives unknown', () => {
    const tie = new CampaignBuilder('Orla')
        .playerBlocks([['Guard', 'RIGHT', 'Halt.']])
        .player('Hello.');
    assert.equal(ScribeIntake.read(tie.messages).player, 'Guard');
    const none = new CampaignBuilder('Orla').narrator('Dawn.').says('Maren', 'Hi.');
    const result = ScribeIntake.read(none.messages);
    assert.equal(result.player, 'unknown');
    assert.deepEqual(plain(result.notes), []);
});

test('RIGHT blocks in BOT messages do not vote for the player', () => {
    const builder = new CampaignBuilder('Orla').player('hi');
    for (let count = 0; count < 3; count++) {
        builder.append('BOT', [{ speakerName: 'Corvane', position: 'RIGHT', text: 'Hm.' }]);
    }
    assert.equal(ScribeIntake.read(builder.messages).player, 'Orla');
});

test("a player's name spoken by the bot is not the player", () => {
    const builder = new CampaignBuilder('Orla').player('hi');
    builder.append('BOT', [{ speakerName: 'Orla', position: 'RIGHT', text: 'Echo.' }]);
    const result = ScribeIntake.read(builder.messages);
    assert.equal(result.messages[1].blocks[0].role, 'Character');
    assert.equal(result.messages[1].text, 'Orla: Echo.');
});

test('narrator by position and by name', () => {
    const builder = new CampaignBuilder('Orla').player('hi');
    builder.append('BOT', [
        { speakerName: 'Maren', position: 'NARRATOR', text: 'Wind.' },
        { speakerName: 'Narrator', position: 'LEFT', text: 'Dusk.' },
    ]);
    const result = ScribeIntake.read(builder.messages);
    assert.deepEqual(plain(result.messages[1].blocks.map((block) => block.role)), ['Narrator', 'Narrator']);
});

test('empty input', () => {
    const result = ScribeIntake.read([]);
    assert.deepEqual(plain(result), { messages: [], notes: [], own: [], player: 'unknown' });
    assert.equal(ScribeIntake.transcript(result.messages), '');
    assert.deepEqual(plain(ScribeIntake.changed([], [])), { withdrawn: [], unread: [] });
});

test('messages must be oldest first', () => {
    const builder = new CampaignBuilder('Orla').player('one').says('Maren', 'two').player('three');
    const reversed = [...builder.messages].reverse();
    assert.throws(() => ScribeIntake.read(reversed), /oldest first/);
    assert.doesNotThrow(() => ScribeIntake.read(builder.messages.slice(0, 1)));
    assert.doesNotThrow(() => ScribeIntake.read([]));
    assert.doesNotThrow(() => ScribeIntake.read(builder.messages));
});

test('the input is left alone', () => {
    const builder = new CampaignBuilder('Orla').narrator('Dawn.').player(`Go.\n\n${paste}`).player('*(A note here.\nAnother.)* Hi.');
    const copy = structuredClone(builder.messages);
    ScribeIntake.read(builder.messages);
    assert.deepEqual(builder.messages, copy);
    assert.equal(Object.isFrozen(builder.messages), false);
    assert.equal(Object.isFrozen(builder.messages[1]), false);
    assert.equal(Object.isFrozen(builder.messages[1].contents), false);
    assert.equal(Object.isFrozen(builder.messages[1].contents[0]), false);
});

for (const original of [paste, 'A wave.\n' + paste, '*I go.*', '*I open the door.*\n*I hide the key.*\n*I step outside.*',
    '*(A note here.\nAnother.)* Hi.', 'A *hidden* detail.', '***\n***\n***', '*(A one-line aside.)*', 'salt\r\n*Storm.*']) {
    test('unmarked chat keeps its formatting and original role: ' + JSON.stringify(original), () => {
        const builder = new CampaignBuilder('Orla').player(original).narrator(original).says('Ada', original);
        const result = ScribeIntake.read(builder.messages);
        assert.deepEqual(plain(result.notes), []);
        assert.deepEqual(Array.from(result.messages, (message) => message.blocks[0].text), [original, original, original]);
    });
}

test('any pair out of order throws', () => {
    const five = new CampaignBuilder('Orla').player('1').player('2').player('3').player('4').player('5');
    const swapped = [...five.messages];
    [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
    assert.throws(() => ScribeIntake.read(swapped), /oldest first/);
    const two = new CampaignBuilder('Orla').player('1').player('2');
    assert.throws(() => ScribeIntake.read([...two.messages].reverse()), /oldest first/);
    const equal = new CampaignBuilder('Orla')
        .player('1')
        .timed('2026-11-03T11:00:05.000Z')
        .player('2')
        .timed('2026-11-03T11:00:05.000Z');
    assert.doesNotThrow(() => ScribeIntake.read(equal.messages));
});

test('times of different precision compare as dates', () => {
    const fine = new CampaignBuilder('Orla')
        .player('1')
        .timed('2026-11-03T11:33:21.337782Z')
        .player('2')
        .timed('2026-11-03T11:33:21.337782140Z');
    assert.doesNotThrow(() => ScribeIntake.read(fine.messages));
    const late = new CampaignBuilder('Orla')
        .player('1')
        .timed('2026-11-03T11:33:22.5Z')
        .player('2')
        .timed('2026-11-03T11:33:21.337782140Z');
    assert.throws(() => ScribeIntake.read(late.messages), /oldest first/);
});

test('an edit in an earlier block changes the fingerprint', () => {
    const blocks = (first) => [
        ['Orla', 'RIGHT', first],
        ['Narrator', 'NARRATOR', 'Rain.'],
        ['Maren', 'LEFT', 'Wait.'],
    ];
    const before = ScribeIntake.read(new CampaignBuilder('Orla').playerBlocks(blocks('Go.')).messages);
    const after = ScribeIntake.read(new CampaignBuilder('Orla').playerBlocks(blocks('Stay.')).messages);
    assert.notEqual(before.messages[0].fingerprint, after.messages[0].fingerprint);
    assert.deepEqual(plain(ScribeIntake.changed(before.messages, after.messages)), {
        withdrawn: ['MESSAGE-1'],
        unread: [],
    });
});

test('the input is left alone, whitespace and all', () => {
    const builder = new CampaignBuilder('Orla').playerBlocks([
        ['Orla', 'RIGHT', '  \n Go. \n\n*Note one.*\n*Note two.*\n*Note three.*  \n'],
        ['Maren', 'LEFT', ' padded \n'],
    ]);
    builder.messages[0].contents.push({ type: 'IMAGE', speakerName: 'Maren', position: 'LEFT', text: ' x ' });
    const copy = structuredClone(builder.messages);
    ScribeIntake.read(builder.messages);
    assert.deepEqual(builder.messages, copy);
});

test('player and narrator text reaches the Scribe with literal prefixes and punctuation intact', () => {
    const result = ScribeIntake.read(new CampaignBuilder('Orla')
        .player('Hello.\r\n[Operator note] Stop, Ada.\r\n[Operator note] Mind the *gate*.')
        .player('[Operator note] Stop Ada.').narrator('[Operator note] Storyteller says this aloud.').messages);
    assert.deepEqual(plain(result.notes), []);
    assert.equal(result.messages[0].blocks[0].text, 'Hello.\r\n[Operator note] Stop, Ada.\r\n[Operator note] Mind the *gate*.');
    assert.equal(result.messages[1].blocks[0].text, '[Operator note] Stop Ada.');
    assert.equal(result.messages[2].blocks[0].text, '[Operator note] Storyteller says this aloud.');
});

test('the fingerprint covers speaker and position', () => {
    const base = ScribeIntake.read(
        new CampaignBuilder('Orla').playerBlocks([['Orla', 'RIGHT', 'ab cd']]).messages,
    ).messages[0].fingerprint;
    const variants = [
        [['Guard', 'RIGHT', 'ab cd']],
        [['Orla', 'LEFT', 'ab cd']],
        [['Orla', 'RIGHT', 'ab'], ['Orla', 'RIGHT', 'cd']],
    ];
    const seen = new Set([base]);
    for (const blocks of variants) {
        const result = ScribeIntake.read(new CampaignBuilder('Orla').playerBlocks(blocks).messages);
        seen.add(result.messages[0].fingerprint);
        const known = [{ id: 'MESSAGE-1', fingerprint: base }];
        assert.deepEqual(plain(ScribeIntake.changed(known, result.messages)), {
            withdrawn: ['MESSAGE-1'],
            unread: [],
        });
    }
    assert.equal(seen.size, 4);
});

test('the fingerprint is taken before notes are removed', () => {
    const text = `Go.\n${paste}`;
    const result = ScribeIntake.read(new CampaignBuilder('Orla').player(text).messages);
    assert.equal(result.messages[0].fingerprint, ScribeText.fingerprint(`Orla\nRIGHT\n${text}`));
    const edited = ScribeIntake.read(new CampaignBuilder('Orla').player(text.replace('winter', 'spring')).messages);
    assert.notEqual(result.messages[0].fingerprint, edited.messages[0].fingerprint);
});

test('non-text blocks are ignored', () => {
    const plainBuilder = new CampaignBuilder('Orla').player('Hello.');
    const withImage = new CampaignBuilder('Orla').player('Hello.');
    withImage.messages[0].contents.unshift({ type: 'IMAGE', speakerName: 'Maren', position: 'LEFT', text: 'picture' });
    const base = ScribeIntake.read(plainBuilder.messages);
    const result = ScribeIntake.read(withImage.messages);
    assert.equal(result.messages[0].text, 'Orla (player): Hello.');
    assert.equal(result.messages[0].blocks.length, 1);
    assert.equal(result.messages[0].blocks[0].blockNumber, 2);
    assert.equal(result.messages[0].fingerprint, base.messages[0].fingerprint);
});

test('changed detects edits, removals and new messages', () => {
    const known = [
        { id: 'A', fingerprint: 'aaaa' },
        { id: 'B', fingerprint: 'bbbb' },
        { id: 'C', fingerprint: 'cccc' },
    ];
    const current = [
        { id: 'A', fingerprint: 'aaaa' },
        { id: 'B', fingerprint: 'edited' },
        { id: 'D', fingerprint: 'dddd' },
    ];
    const result = ScribeIntake.changed(known, current);
    assert.deepEqual(plain(result), { withdrawn: ['B', 'C'], unread: ['D'] });
    assert.deepEqual(plain(ScribeIntake.changed(known, known)), { withdrawn: [], unread: [] });
});

test('a marker by itself proves nothing about who wrote a line', () => {
    for (const line of ['[Scribe] Day 2.', '@: [Scribe] Day 2.', '@:\u00a0[Scribe] Now.', 'He said [Scribe] aloud.']) {
        const room = ScribeIntake.read(new CampaignBuilder('Orla').player(line).narrator(line).says('Archivist', line).messages);
        assert.equal(room.own.length, 0);
        assert.deepEqual(Array.from(room.messages, (message) => message.blocks[0].text), [line, line, line]);
        assert.ok(ScribeIntake.transcript(room.messages).includes(line));
    }
});

test('a saved automatic delivery removes only the exact carried suffix', () => {
    const line = '[Scribe] Generated paragraph.';
    const body = 'My words.\n@: ' + line;
    const raw = new CampaignBuilder('Orla').player(body).messages;
    const receipt = { floor: 0, after: null, carried: line, suggestion: null, submission: ScribeText.submission(body) };
    const room = ScribeIntake.read(raw, { posts: [receipt] });
    assert.equal(room.messages[0].blocks[0].text, 'My words.');
    assert.equal(room.own.length, 1);
    assert.equal(ScribeIntake.read(raw, { posts: [{ ...receipt, carried: line + ' changed' }] }).messages[0].blocks[0].text, body);
});

test('manual receipt matches exact multiline transport in joined and split narrator blocks', () => {
    const player = 'I listen.\nThen  I wait.';
    const carried = '[Scribe] 雪  falls.\nThe bell rings. ';
    const suggestion = 'Open the door.';
    const post = { carried, suggestion, submission: ScribeText.fingerprint(player) };
    const wire = player + '\n@: ' + carried + '\n@: ' + suggestion;
    const builder = new CampaignBuilder('Orla').player(wire).playerBlocks([
        ['Orla', 'RIGHT', player], ['Narrator', 'NARRATOR', carried], ['Narrator', 'NARRATOR', suggestion],
    ]).player(wire.replace('雪  falls', '雪 falls')).player(wire.replace('Then  I', 'Then I')).narrator(wire);
    const read = ScribeIntake.read(builder.messages);
    assert.deepEqual(plain(read.messages.map((message) => ScribeIntake.carried(message, post))), [true, true, false, false, false]);
    assert.ok(read.messages[0].text.startsWith('Orla (player): ' + player));
    assert.equal(read.messages[1].blocks[0].text, player);
});

test('a trimmed player block identifies only the original attachment and its exact author boundary', () => {
    const player = '  I  wait.\n@: [Scribe] My own line.';
    const carried = '[Scribe] The  chosen paragraph. ';
    const suggestion = 'Keep watch.';
    const stamp = ScribeText.playerSubmission(player + '  ');
    const post = { ...stamp, carried, suggestion, manual: true, floor: 0, after: null };
    const tail = '\n@: ' + carried + '\n@: ' + suggestion;
    for (const [prefix, suffix, accepted] of [
        [player + '  ', tail, true], [player, tail, true], [player + ' ', tail, false],
        [player.trimStart(), tail, false], [player.replace('I  wait', 'I wait'), tail, false],
        [player, tail.replace('chosen paragraph. ', 'chosen paragraph.'), false], [player, tail.slice(0, -1), false],
        [player, tail + ' Changed.', false],
    ]) {
        const builder = new CampaignBuilder('Orla').player(prefix + suffix);
        const message = ScribeIntake.read(builder.messages, { posts: [post] }).messages[0];
        assert.equal(ScribeIntake.carried(message, post), accepted);
        assert.equal(message.projection, accepted ? prefix.length : undefined);
        if (accepted) {
            assert.equal(message.blocks[0].text, player.trim());
        }
    }
    const legacy = { ...post, trimmedSubmission: undefined };
    const message = ScribeIntake.read(new CampaignBuilder('Orla').player(player + tail).messages).messages[0];
    assert.equal(ScribeIntake.carried(message, legacy), false);
});

test('saved manual attribution preserves authored markers, validates the raw row and survives split narrator history', () => {
    const player = 'I wait.\n\n\n@: [Scribe] Keep.';
    const carried = '[Scribe] First.\nMira lost the key.';
    const builder = new CampaignBuilder('Orla').playerBlocks([
        ['Orla', 'RIGHT', player], ['Narrator', 'NARRATOR', carried],
    ]).player('My own last line.\nMira lost the key.').player('Different.\n@: ' + carried);
    const raw = ScribeIntake.read(builder.messages);
    const post = { manual: true, floor: 0, after: null, submission: ScribeText.fingerprint(player), carried, suggestion: null };
    const evidence = { posts: [post] };
    const matched = ScribeIntake.read(builder.messages, evidence);
    assert.equal(matched.messages[0].text, 'Orla (player): ' + player);
    assert.equal(matched.messages[0].fingerprint, raw.messages[0].fingerprint);
    assert.equal(matched.messages[1].text, raw.messages[1].text);
    assert.equal(matched.messages[2].text, raw.messages[2].text);
    const entry = raw.messages[0];
    const saved = { attachments: [{ id: entry.id, fingerprint: entry.fingerprint, length: player.length }] };
    assert.equal(ScribeIntake.read(builder.messages, saved).messages[0].text, matched.messages[0].text);
    builder.messages[0].contents[1].text = 'No attachment.\nA new authored line.';
    builder.messages[0].edited = true;
    const edited = ScribeIntake.read(builder.messages, saved).messages[0];
    assert.notEqual(edited.fingerprint, entry.fingerprint);
    assert.deepEqual(plain(edited.blocks.map((block) => block.text)), [player, 'No attachment.\nA new authored line.']);
});

test('a retried multiline reminder in the middle excludes only the carried lines after reload', () => {
    const before = 'I hold it.';
    const carried = '[Scribe] Keep the lantern.\nUse its oil.';
    const after = 'My authored ending.';
    for (const split of [false, true]) {
        const builder = new CampaignBuilder('Orla');
        const wire = before + '\n@: ' + carried + '\n' + after;
        if (split) {
            builder.playerBlocks([['Orla', 'RIGHT', before], ['Narrator', 'NARRATOR', carried], ['Orla', 'RIGHT', after]]);
        } else {
            builder.player(wire);
        }
        const post = { ...ScribeText.playerSubmission(before + '\n' + after), retained: true, manual: true,
            floor: 0, after: null, carried, suggestion: null };
        const message = ScribeIntake.read(builder.messages, { posts: [post] }).messages[0];
        assert.equal(ScribeIntake.carried(message, post), true);
        assert.deepEqual(plain(message.blocks.map((block) => block.text)), split ? [before, after] : [before + '\n' + after]);
        const end = wire.lastIndexOf('\n');
        const saved = { attachments: [{ id: message.id, fingerprint: message.fingerprint, length: before.length, end }] };
        assert.equal(message.projection, before.length + ':' + end);
        assert.equal(ScribeIntake.read(builder.messages, saved).messages[0].text, message.text);
        assert.equal(ScribeIntake.carried(message, { ...post, submission: ScribeText.fingerprint(before) }), false);
    }
});

test('two identical raw rows with different possible author boundaries cannot be assigned by queue order', () => {
    const player = 'I wait.';
    const other = player + '\n@: [Scribe] My authored line.';
    const wire = other + '\n@: [Scribe] Note.';
    const builder = new CampaignBuilder('Orla').player(wire).player(wire);
    const first = { key: 'one', manual: true, floor: 0, after: null, submission: ScribeText.fingerprint(player),
        carried: '[Scribe] My authored line.\n@: [Scribe] Note.', suggestion: null, confirmed: false };
    const second = { ...first, key: 'two', submission: ScribeText.fingerprint(other), carried: '[Scribe] Note.', confirmed: true };
    for (const posts of [[first, second], [second, first], [{ ...first, confirmed: true }, second]]) {
        const intake = ScribeIntake.read(builder.messages, { posts });
        assert.deepEqual(plain(intake.messages.map((message) => message.attributionPending)), [true, true]);
        assert.deepEqual(plain(intake.messages.map((message) => message.text)), ['', '']);
    }
    const unique = ScribeIntake.read(builder.messages.slice(0, 1), { posts: [first, second] });
    assert.equal(unique.messages[0].text, 'Orla (player): ' + other);
});

test('results are read-only', () => {
    const builder = new CampaignBuilder('Orla').player('Go.\n[Operator note] One\n[Operator note] Two\n[Operator note] Three').says('Maren', 'Hm.');
    const result = ScribeIntake.read(builder.messages);
    assert.equal(result.notes.length, 0);
    assertFrozenDeep(result, 'result');
    assertFrozenDeep(ScribeIntake.changed([{ id: 'A', fingerprint: 'x' }], result.messages), 'changed');
    assert.throws(() => result.messages.push({}), TypeError);
    assert.throws(() => {
        result.notes[0].text = 'changed';
    }, TypeError);
});
