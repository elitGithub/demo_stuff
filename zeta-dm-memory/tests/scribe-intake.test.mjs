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

test('a per-line paste is lifted whole', () => {
    const builder = new CampaignBuilder('Orla').narrator('Dawn.').player(`I draw my blade and wait.\n\n${paste}`);
    const result = ScribeIntake.read(builder.messages);
    assert.equal(result.messages[1].text, 'Orla (player): I draw my blade and wait.');
    assert.deepEqual(plain(result.notes), [
        { text: firstNote, position: 2 },
        { text: secondNote, position: 2 },
        { text: thirdNote, position: 2 },
    ]);
});

test('a single paste is enough', () => {
    const builder = new CampaignBuilder('Orla').player('One.').player('Two.').player(`Three.\n${paste}`);
    const result = ScribeIntake.read(builder.messages);
    assert.equal(result.notes.length, 3);
    assert.deepEqual(plain(result.messages.map((message) => message.text.includes('*'))), [false, false, false]);
});

test('short pasted lines are notes too', () => {
    const builder = new CampaignBuilder('Orla').player('Go.\n\n*short one.*\n*Another.*\n*Third.*');
    const result = ScribeIntake.read(builder.messages);
    assert.deepEqual(plain(result.notes.map((note) => note.text)), ['short one.', 'Another.', 'Third.']);
    assert.equal(result.messages[0].text, 'Orla (player): Go.');
});

test('one closing action line is story', () => {
    const builder = new CampaignBuilder('Orla');
    for (let count = 0; count < 5; count++) {
        builder.player('Go.\n\n*keeps walking slowly along the river bank*');
    }
    const result = ScribeIntake.read(builder.messages);
    assert.deepEqual(plain(result.notes), []);
    assert.equal(result.messages[0].text, 'Orla (player): Go.\n\n*keeps walking slowly along the river bank*');
});

test('two action lines apart are story', () => {
    const apart = 'Go.\n\n*One action here.*\n\n*Two action here.*';
    const followed = 'Go.\n*One action here.*\n*Two action here.*\nA plain line.';
    const result = ScribeIntake.read(new CampaignBuilder('Orla').player(apart).player(followed).messages);
    assert.deepEqual(plain(result.notes), []);
    assert.equal(result.messages[0].text, `Orla (player): ${apart}`);
    assert.equal(result.messages[1].text, `Orla (player): ${followed}`);
});

test('a paste sits in the last block only', () => {
    const earlier = new CampaignBuilder('Orla').playerBlocks([
        ['Orla', 'RIGHT', `Hi.\n\n${paste}`],
        ['Maren', 'LEFT', 'Plain.'],
    ]);
    const stays = ScribeIntake.read(earlier.messages);
    assert.deepEqual(plain(stays.notes), []);
    assert.equal(stays.messages[0].blocks[0].text, `Hi.\n\n${paste}`);
    for (const [speaker, position] of [['Orla', 'RIGHT'], ['Maren', 'LEFT'], ['Narrator', 'NARRATOR']]) {
        const last = new CampaignBuilder('Orla').playerBlocks([
            ['Orla', 'RIGHT', 'Hi.'],
            [speaker, position, `Tail.\n${paste}`],
        ]);
        const result = ScribeIntake.read(last.messages);
        assert.equal(result.notes.length, 3, position);
        assert.equal(result.messages[0].blocks[1].text, 'Tail.');
    }
});

test('a note line with inner asterisks is lifted whole', () => {
    const builder = new CampaignBuilder('Orla').player(
        `Go.\n\n*Brandt* is captain of the guard.*\n*${secondNote}*\n*${thirdNote}*`,
    );
    const result = ScribeIntake.read(builder.messages);
    assert.deepEqual(plain(result.notes.map((note) => note.text)), [
        'Brandt* is captain of the guard.',
        secondNote,
        thirdNote,
    ]);
    assert.equal(result.messages[0].text, 'Orla (player): Go.');
});

test('a stray asterisk above the paste changes nothing', () => {
    const builder = new CampaignBuilder('Orla').player(`I grin* and wait.\n\n${paste}`);
    const result = ScribeIntake.read(builder.messages);
    assert.equal(result.notes.length, 3);
    assert.equal(result.messages[0].text, 'Orla (player): I grin* and wait.');
});

test('a parenthesised paste is lifted', () => {
    const builder = new CampaignBuilder('Orla').player('*(Brandt is captain.\n\nMaren owes Orla a debt.)* I draw my blade.');
    const result = ScribeIntake.read(builder.messages);
    assert.deepEqual(plain(result.notes), [
        { text: 'Brandt is captain.', position: 1 },
        { text: 'Maren owes Orla a debt.', position: 1 },
    ]);
    assert.equal(result.messages[0].text, 'Orla (player): I draw my blade.');
});

test('a parenthesised paste in any block and with an asterisk inside is handled', () => {
    const builder = new CampaignBuilder('Orla').playerBlocks([
        ['Orla', 'RIGHT', 'Hi *(A note about Corvane.\nAnd one more.)* there.'],
        ['Maren', 'LEFT', 'Said *(not a paste* really)* ok.'],
    ]);
    const result = ScribeIntake.read(builder.messages);
    assert.deepEqual(plain(result.notes.map((note) => note.text)), ['A note about Corvane.', 'And one more.']);
    assert.equal(result.messages[0].blocks[0].text, 'Hi  there.');
    assert.equal(result.messages[0].blocks[1].text, 'Said *(not a paste* really)* ok.');
});

test('the same note in both formats is one note', () => {
    const shared = 'Corvane watches the gate.';
    const builder = new CampaignBuilder('Orla')
        .narrator('Dawn.')
        .player(`*(${shared}\n\nOther fact here.)* Go.`)
        .says('Maren', 'Hm.')
        .says('Brandt', 'Hm.')
        .player(`Go.\n*${shared}*\n*Third fact.*\n*Third fact too.*`)
        .says('Maren', 'Hm.')
        .says('Brandt', 'Hm.')
        .player(`Go.\n*${shared}*\n*Fourth fact.*\n*Fourth fact too.*`);
    const result = ScribeIntake.read(builder.messages);
    assert.deepEqual(plain(result.notes), [
        { text: shared, position: 2 },
        { text: 'Other fact here.', position: 2 },
        { text: 'Third fact.', position: 5 },
        { text: 'Third fact too.', position: 5 },
        { text: 'Fourth fact.', position: 8 },
        { text: 'Fourth fact too.', position: 8 },
    ]);
});

test('two closing action lines are story', () => {
    const tail = 'Maren looks at me.\n*I sit down beside her.*\n*I sigh and close my eyes.*';
    const only = '*I sit down beside her.*\n*I sigh and close my eyes.*';
    const builder = new CampaignBuilder('Orla').player(tail).player(only);
    const result = ScribeIntake.read(builder.messages);
    assert.deepEqual(plain(result.notes), []);
    assert.equal(result.messages[0].text, `Orla (player): ${tail}`);
    assert.equal(result.messages[1].text, `Orla (player): ${only}`);
    assert.equal(ScribeIntake.transcript(result.messages).includes('[#2]'), true);
});

test('three closing wrapped lines are a paste', () => {
    const builder = new CampaignBuilder('Orla').player(
        'Maren looks at me.\n*I sit down beside her.*\n*I sigh and close my eyes.*\n*The rain eases.*',
    );
    const result = ScribeIntake.read(builder.messages);
    assert.equal(result.notes.length, 3);
    assert.equal(result.messages[0].text, 'Orla (player): Maren looks at me.');
});

test('a closing run broken by an unclosed line is story', () => {
    const unclosed = 'Go.\n\n*I nod and wait\n*I step back.*';
    const middle = 'Go.\n*One fact here.*\nTwo fact here.*\n*Three fact here.*';
    const result = ScribeIntake.read(new CampaignBuilder('Orla').player(unclosed).player(middle).messages);
    assert.deepEqual(plain(result.notes), []);
    assert.equal(result.messages[0].text, `Orla (player): ${unclosed}`);
    assert.equal(result.messages[1].text, `Orla (player): ${middle}`);
});

test('a scene break is not a note', () => {
    const scene = 'We sleep.\n\n***\n*Morning comes.*';
    const trailing = 'Go.\n\n*Note one.*\n*Note two.*\n*Note three.*\n* *';
    const result = ScribeIntake.read(new CampaignBuilder('Orla').player(scene).player(trailing).messages);
    assert.deepEqual(plain(result.notes), []);
    assert.equal(result.messages[0].text, `Orla (player): ${scene}`);
    assert.equal(result.messages[1].text, `Orla (player): ${trailing}`);
    const dashes = ScribeIntake.read(new CampaignBuilder('Orla').player('Go.\n*Note one.*\n*Note two.*\n***\n* * *').messages);
    assert.deepEqual(plain(dashes.notes), []);
});

test('a one-line aside in parentheses is story', () => {
    const aside = 'I shrug. *(sighs)* Fine, I will go.';
    const result = ScribeIntake.read(new CampaignBuilder('Orla').player(aside).messages);
    assert.deepEqual(plain(result.notes), []);
    assert.equal(result.messages[0].text, `Orla (player): ${aside}`);
});

test('a parenthesised paste needs a line break', () => {
    const result = ScribeIntake.read(
        new CampaignBuilder('Orla').player('*(Brandt is captain.\nMaren owes Orla a debt.)* Go.').messages,
    );
    assert.deepEqual(plain(result.notes.map((note) => note.text)), ['Brandt is captain.', 'Maren owes Orla a debt.']);
    assert.equal(result.messages[0].text, 'Orla (player): Go.');
});

test('notes inside one message keep text order', () => {
    const result = ScribeIntake.read(
        new CampaignBuilder('Orla').player('*(Note one.\nNote two.)* Go.\n\n*Note three.*\n*Note four.*\n*Note five.*').messages,
    );
    assert.deepEqual(plain(result.notes.map((note) => note.text)), [
        'Note one.',
        'Note two.',
        'Note three.',
        'Note four.',
        'Note five.',
    ]);
});

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

test('the same note in another spelling is one note', () => {
    const builder = new CampaignBuilder('Orla')
        .player("Go.\n*orla keeps maren's lantern.*\n*Other fact here.*\n*More here.*")
        .says('Maren', 'Hm.')
        .player('Go.\n*Orla keeps Maren’s Lantern..*\n*Third fact.*\n*Fourth fact.*');
    const result = ScribeIntake.read(builder.messages);
    assert.deepEqual(plain(result.notes), [
        { text: "orla keeps maren's lantern.", position: 1 },
        { text: 'Other fact here.', position: 1 },
        { text: 'More here.', position: 1 },
        { text: 'Third fact.', position: 3 },
        { text: 'Fourth fact.', position: 3 },
    ]);
    assert.deepEqual(plain(result.messages.map((message) => message.text)), [
        'Orla (player): Go.',
        'Maren: Hm.',
        'Orla (player): Go.',
    ]);
});

test('an edited note gives two notes', () => {
    const builder = new CampaignBuilder('Orla')
        .player('One.\n*The bridge fell last winter.*\n*Second line.*\n*Third line.*')
        .says('Maren', 'Hm.')
        .player('Two.\n*The bridge fell last spring.*\n*Second line.*\n*Third line.*');
    const result = ScribeIntake.read(builder.messages);
    assert.deepEqual(plain(result.notes), [
        { text: 'The bridge fell last winter.', position: 1 },
        { text: 'Second line.', position: 1 },
        { text: 'Third line.', position: 1 },
        { text: 'The bridge fell last spring.', position: 3 },
    ]);
    assert.deepEqual(plain(result.messages.map((message) => message.text)), [
        'Orla (player): One.',
        'Maren: Hm.',
        'Orla (player): Two.',
    ]);
});

test('notes come in order of first appearance', () => {
    const builder = new CampaignBuilder('Orla')
        .player('Go.\n*Corvane watches the gate.*\n*Brandt sleeps.*\n*Guard waits.*')
        .player('Go.\n*Maren owes Orla a debt much larger than anyone knows.*\n*Brandt sleeps.*\n*Guard waits.*');
    const result = ScribeIntake.read(builder.messages);
    assert.deepEqual(plain(result.notes.map((note) => note.text)), [
        'Corvane watches the gate.',
        'Brandt sleeps.',
        'Guard waits.',
        'Maren owes Orla a debt much larger than anyone knows.',
    ]);
});

test('a repeated action inside story text stays', () => {
    const action = '*keeps walking slowly along the river bank at dusk*';
    const builder = new CampaignBuilder('Orla');
    for (let count = 0; count < 3; count++) {
        builder.player(`Orla ${action} and sighs.`);
    }
    const result = ScribeIntake.read(builder.messages);
    assert.deepEqual(plain(result.notes), []);
    assert.equal(result.messages[2].text, `Orla (player): Orla ${action} and sighs.`);
});

test('bot messages are never searched', () => {
    const body = `Hi.\n\n${paste}`;
    const builder = new CampaignBuilder('Orla').says('Maren', body).player('Go.');
    const result = ScribeIntake.read(builder.messages);
    assert.deepEqual(plain(result.notes), []);
    assert.equal(result.messages[0].text, `Maren: ${body}`);
});

test('a message that is only a paste has empty text', () => {
    const builder = new CampaignBuilder('Orla')
        .player('Start.')
        .player('*Only note one.*\n*Only note two.*\n*Only note three.*')
        .player('Hi.')
        .says('Maren', 'Done.');
    const result = ScribeIntake.read(builder.messages);
    assert.equal(result.messages[1].text, '');
    assert.deepEqual(plain(result.messages[1].blocks), []);
    const transcript = ScribeIntake.transcript(result.messages);
    assert.equal(transcript, '[#1] Orla (player): Start.\n\n[#3] Orla (player): Hi.\n\n[#4] Maren: Done.');
    assert.equal(transcript.includes('[#2]'), false);
});

test('windows line breaks', () => {
    const builder = new CampaignBuilder('Orla').player('Go.\r\n\r\n*Note one.*\r\n*Note two.*\r\n*Note three.*\r\n');
    const result = ScribeIntake.read(builder.messages);
    assert.deepEqual(plain(result.notes.map((note) => note.text)), ['Note one.', 'Note two.', 'Note three.']);
    assert.equal(result.messages[0].text, 'Orla (player): Go.');
});

test('excess line breaks left by a removal are reduced', () => {
    const builder = new CampaignBuilder('Orla').player('One.\n\n\n\n*(A note here.\nAnother.)*\n\n\n\nTwo.');
    assert.deepEqual(texts(builder.messages), ['Orla (player): One.\n\nTwo.']);
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
    withImage.messages[0].contents.push({ type: 'IMAGE', speakerName: 'Maren', position: 'LEFT', text: 'picture' });
    const base = ScribeIntake.read(plainBuilder.messages);
    const result = ScribeIntake.read(withImage.messages);
    assert.equal(result.messages[0].text, 'Orla (player): Hello.');
    assert.equal(result.messages[0].blocks.length, 1);
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

test("the scribe's own lines are lifted out", () => {
    const own = '@: [Scribe] Day 2, the mill. Present: Halvard.';
    const spoken = `I lift the sack.\n${paste}\n${own}`;
    const otherPaste = '*Corvane keeps the ferry.*\n*Kira mends the nets.*\n*Oswin sells salt.*';
    const builder = new CampaignBuilder('Halvard').narrator('Dawn.').player(spoken);
    builder.playerBlocks([
        ['Halvard', 'RIGHT', `Go.\n@: a note [Scribe]\nHe said [Scribe] aloud.\n${otherPaste}`],
        ['Narrator', 'NARRATOR', `${own}\n\n  [Scribe] again\n`],
    ]);
    builder.player('Rain.\n\n\t[Scribe] Day 2.\n\nWind.');
    const result = ScribeIntake.read(builder.messages);
    assert.equal(result.messages[1].text, 'Halvard (player): I lift the sack.');
    assert.deepEqual(plain(result.messages[1].blocks.map((block) => block.text)), ['I lift the sack.']);
    assert.deepEqual(plain(result.messages[2].blocks.map((block) => [block.speaker, block.text])), [
        ['Halvard', 'Go.\n@: a note [Scribe]\nHe said [Scribe] aloud.'],
    ]);
    assert.equal(result.messages[3].text, 'Halvard (player): Rain.\n\nWind.');
    assert.deepEqual(plain(result.own), [
        { text: own, position: 2 },
        { text: own, position: 3 },
        { text: '[Scribe] again', position: 3 },
        { text: '[Scribe] Day 2.', position: 4 },
    ]);
    assert.deepEqual(plain(result.notes), [
        { text: firstNote, position: 2 },
        { text: secondNote, position: 2 },
        { text: thirdNote, position: 2 },
        { text: 'Corvane keeps the ferry.', position: 3 },
        { text: 'Kira mends the nets.', position: 3 },
        { text: 'Oswin sells salt.', position: 3 },
    ]);
    assert.equal(ScribeIntake.transcript(result.messages).includes('[Scribe] Day'), false);
    assert.equal(result.messages[1].fingerprint, ScribeText.fingerprint(`Halvard\nRIGHT\n${spoken}`));
    assertFrozenDeep(result.own, 'own');
    assert.equal(ScribeIntake.Settings.OwnMarker, '[Scribe]');
    for (const line of [own, '[Scribe]', '  [Scribe] x', '@:[Scribe] x', ' @:   [Scribe] x', '\t[Scribe] x', '[Scribe]\tx']) {
        assert.equal(ScribeIntake.own(line), true, line);
    }
    const kept = [
        'He said [Scribe] aloud',
        '@: a note [Scribe]',
        'x [Scribe]',
        '@: @: [Scribe]',
        '[scribe] x',
        '',
        '[Scribe]s are clerks',
        '[Scribe]: x',
        `${String.fromCodePoint(0x200b)}[Scribe] x`,
    ];
    for (const line of kept) {
        assert.equal(ScribeIntake.own(line), false, line);
    }
});

test("a no-break space does not hide the scribe's line", () => {
    const noBreak = String.fromCodePoint(0xa0);
    const after = `@:${noBreak}[Scribe] Day 3, the mill.`;
    const before = `${noBreak}@: [Scribe] Day 3, the mill.`;
    const both = `${noBreak}@:${noBreak}[Scribe]${noBreak}Day 3, the mill.`;
    const builder = new CampaignBuilder('Halvard')
        .player(`I wait.\n${after}`)
        .player(`I nod.\n${before}`)
        .player(`I sit.\n${both}`)
        .player('I go.\n@: [Scribe] Day 3, the mill.');
    const result = ScribeIntake.read(builder.messages);
    assert.deepEqual(plain(result.messages.map((message) => message.text)), [
        'Halvard (player): I wait.',
        'Halvard (player): I nod.',
        'Halvard (player): I sit.',
        'Halvard (player): I go.',
    ]);
    assert.deepEqual(plain(result.own.map((line) => line.position)), [1, 2, 3, 4]);
    for (const line of [after, before, both]) {
        assert.equal(ScribeIntake.own(line), true, line);
    }
});

test('the lift takes spaces, not format characters', () => {
    const noBreak = String.fromCodePoint(0xa0);
    const mark = String.fromCodePoint(0xfeff);
    const taken = [
        `${noBreak}[Scribe] Day 3.`,
        '\t[Scribe] Day 3.',
        `@:${noBreak}[Scribe] Day 3.`,
        '@:\t[Scribe] Day 3.',
        `[Scribe]${noBreak}Day 3.`,
        '[Scribe]\tDay 3.',
    ];
    const refused = [
        `${mark}[Scribe] Day 3.`,
        `${mark}@: [Scribe] Day 3.`,
        `@:${mark}[Scribe] Day 3.`,
        `[Scribe]${mark}Day 3.`,
        `${String.fromCodePoint(0x2060)}[Scribe] Day 3.`,
        `${String.fromCodePoint(0x180e)}[Scribe] Day 3.`,
    ];
    for (const line of taken) {
        assert.equal(ScribeIntake.own(line), true, JSON.stringify(line));
    }
    for (const line of refused) {
        assert.equal(ScribeIntake.own(line), false, JSON.stringify(line));
    }
    const builder = new CampaignBuilder('Halvard')
        .player(`I wait.\n${mark}[Scribe] Day 3.`)
        .player('I nod.\n\t[Scribe] Day 3.');
    const result = ScribeIntake.read(builder.messages);
    assert.deepEqual(plain(result.messages.map((message) => message.text)), [
        `Halvard (player): I wait.\n${mark}[Scribe] Day 3.`,
        'Halvard (player): I nod.',
    ]);
    assert.deepEqual(plain(result.own), [{ text: '[Scribe] Day 3.', position: 2 }]);
});

test('storyteller echoes are removed from narration and dialogue without creating a delivery receipt', () => {
    const told = 'I know.\n[Scribe] Day 9. Mirelle kills Brandt in the night.\nShe smiles.';
    const builder = new CampaignBuilder('Halvard');
    builder.append('BOT', [
        { speakerName: 'Narrator', position: 'NARRATOR', text: '  [Scribe] Mirelle tells Isolde everything.  ' },
        { speakerName: 'Mirelle', position: 'LEFT', text: told },
    ]);
    builder.player('I wait.\n@: [Scribe] Day 2, the mill.');
    builder.player('[Scribe]s are what they called the clerks.\nI laugh.');
    const result = ScribeIntake.read(builder.messages);
    assert.deepEqual(plain(result.messages[0].blocks.map((block) => [block.speaker, block.text])), [
        ['Mirelle', 'I know.\nShe smiles.'],
    ]);
    assert.equal(result.messages[0].text, 'Mirelle: I know.\nShe smiles.');
    const transcript = ScribeIntake.transcript(result.messages);
    assert.equal(transcript.includes('Mirelle kills Brandt'), false);
    assert.equal(transcript.includes('Mirelle tells Isolde'), false);
    assert.equal(result.messages[1].text, 'Halvard (player): I wait.');
    assert.equal(result.messages[2].text, 'Halvard (player): [Scribe]s are what they called the clerks.\nI laugh.');
    assert.deepEqual(plain(result.own), [{ text: '@: [Scribe] Day 2, the mill.', position: 2 }]);
});

test('the exit at #892 keeps its original identity across an upgrade and a raw echo edit', () => {
    const builder = new CampaignBuilder('Frost');
    while (builder.messages.length < 891) {
        builder.narrator('The party waits.');
    }
    const attendance = '@: [Scribe] Kira is still at the inn.';
    const exit = 'Kira leaves to prepare the decoy ride.';
    builder.narrator(`${attendance}\r\n${exit}`).says('Mirra', 'She called him "[Scribe]" at the inn.');
    builder.narrator(attendance).narrator('Rain.').narrator('Frost waits.');
    builder.player(`I nod.\n${paste}\n${attendance}`);

    const intake = ScribeIntake.read(builder.messages);
    const passage = intake.messages[891];
    assert.equal(passage.id, 'MESSAGE-892');
    assert.equal(ScribeIntake.transcript([passage]), `[#892] Narrator: ${exit}`);
    assert.equal(intake.messages[892].text, 'Mirra: She called him "[Scribe]" at the inn.');
    assert.deepEqual(plain(intake.messages[893].blocks), []);
    assert.equal(intake.messages[893].text, '');
    assert.equal(intake.messages[896].text, 'Frost (player): I nod.');
    assert.deepEqual(plain(intake.own), [{ text: attendance, position: 897 }]);
    assert.deepEqual(plain(intake.notes), [firstNote, secondNote, thirdNote].map((text) => ({ text, position: 897 })));

    const saved = [{ id: 'MESSAGE-892', fingerprint: '082090d2' }];
    assert.deepEqual(plain(ScribeIntake.changed(saved, [passage])), { withdrawn: [], unread: [] });
    const raw = builder.messages[891];
    raw.contents[0].text = raw.contents[0].text.replace('Kira is still', 'Everyone is still');
    raw.edited = true;
    const edited = ScribeIntake.read(builder.messages).messages[891];
    assert.equal(edited.edited, true);
    assert.equal(edited.text, passage.text);
    assert.deepEqual(plain(ScribeIntake.changed(saved, [edited])), { withdrawn: ['MESSAGE-892'], unread: [] });
});

test('a lifted line does not join the notes around it', () => {
    const notesOf = (text) => {
        const result = ScribeIntake.read(new CampaignBuilder('Halvard').player(text).messages);
        return { notes: plain(result.notes.map((note) => note.text)), text: result.messages[0].text, own: plain(result.own) };
    };
    const runs = ['Go.', '*Corvane keeps the ferry.*', '*Kira mends the nets.*'];
    const between = notesOf([...runs, '[Scribe] Day 2.', '*Oswin sells salt.*'].join('\n'));
    const story = notesOf([...runs, 'A plain line.', '*Oswin sells salt.*'].join('\n'));
    assert.deepEqual(between.notes, story.notes);
    assert.deepEqual(between.notes, []);
    assert.equal(
        between.text,
        'Halvard (player): Go.\n*Corvane keeps the ferry.*\n*Kira mends the nets.*\n*Oswin sells salt.*',
    );
    assert.deepEqual(between.own, [{ text: '[Scribe] Day 2.', position: 1 }]);
    const trailing = notesOf([...runs, '*Oswin sells salt.*', '[Scribe] Day 2.', '', '@: [Scribe] again'].join('\n'));
    assert.deepEqual(trailing.notes, ['Corvane keeps the ferry.', 'Kira mends the nets.', 'Oswin sells salt.']);
    assert.equal(trailing.text, 'Halvard (player): Go.');
    assert.deepEqual(trailing.own, [
        { text: '[Scribe] Day 2.', position: 1 },
        { text: '@: [Scribe] again', position: 1 },
    ]);
    const inside = notesOf('*(Note one.\n[Scribe] Day 2.\nNote two.)* Go.');
    assert.deepEqual(inside.notes, ['Note one.', 'Note two.']);
    assert.equal(inside.text, 'Halvard (player): Go.');
    assert.deepEqual(inside.own, [{ text: '[Scribe] Day 2.', position: 1 }]);
});

test("the marker's space may be any space", () => {
    const noBreak = String.fromCodePoint(0xa0);
    const ideographic = String.fromCodePoint(0x3000);
    const builder = new CampaignBuilder('Halvard')
        .player(`Go.\n[Scribe]${noBreak}Day 2.`)
        .player(`Wait.\n@: [Scribe]${ideographic}Day 3.\nThen go.`)
        .player(`Stay.\n[Scribe]${String.fromCodePoint(0x200b)}Day 4.`);
    const result = ScribeIntake.read(builder.messages);
    assert.deepEqual(plain(result.messages.map((message) => message.text)), [
        'Halvard (player): Go.',
        'Halvard (player): Wait.\nThen go.',
        `Halvard (player): Stay.\n[Scribe]${String.fromCodePoint(0x200b)}Day 4.`,
    ]);
    assert.deepEqual(plain(result.own.map((line) => line.position)), [1, 2]);
    assert.equal(ScribeIntake.own(`[Scribe]${noBreak}x`), true);
    assert.equal(ScribeIntake.own(`[Scribe]${String.fromCodePoint(0xfeff)}x`), false);
});

test('notes before a blank block, and a marker in an earlier block', () => {
    const blank = new CampaignBuilder('Halvard').playerBlocks([
        ['Halvard', 'RIGHT', `Go.\n${paste}`],
        ['Narrator', 'NARRATOR', '  \n\n '],
    ]);
    const lifted = ScribeIntake.read(blank.messages);
    assert.deepEqual(plain(lifted.notes.map((note) => note.text)), [firstNote, secondNote, thirdNote]);
    assert.equal(lifted.messages[0].text, 'Halvard (player): Go.');
    const earlier = new CampaignBuilder('Halvard').playerBlocks([
        ['Halvard', 'RIGHT', 'I wait.\n@: [Scribe] Day 2, the mill.'],
        ['Narrator', 'NARRATOR', 'The rain falls.'],
    ]);
    const result = ScribeIntake.read(earlier.messages);
    assert.deepEqual(plain(result.own), [{ text: '@: [Scribe] Day 2, the mill.', position: 1 }]);
    assert.equal(result.messages[0].text, 'Halvard (player): I wait.\nNarrator: The rain falls.');
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
    const builder = new CampaignBuilder('Orla').player(`Go.\n${paste}`).says('Maren', 'Hm.');
    const result = ScribeIntake.read(builder.messages);
    assert.equal(result.notes.length, 3);
    assertFrozenDeep(result, 'result');
    assertFrozenDeep(ScribeIntake.changed([{ id: 'A', fingerprint: 'x' }], result.messages), 'changed');
    assert.throws(() => result.messages.push({}), TypeError);
    assert.throws(() => {
        result.notes[0].text = 'changed';
    }, TypeError);
});
