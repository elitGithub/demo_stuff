import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NarratorSettings } from '../extension/universe-narrator/NarratorSettings.js';
import { NarratorTurn } from '../extension/universe-narrator/NarratorTurn.js';

const narratorAvatar = 'Narrator.png';
const turnInstruction = 'The player directs the scene in their latest message, after "Narrator:". Write that scene.';

/**
 * @param {Array<string>} consulted
 * @param {?string} instruction
 * @returns {function(): ?string}
 */
function encounterSaying(consulted, instruction) {
  /**
   * @returns {?string}
   */
  const encounter = () => {
    consulted.push('encounter');
    return instruction;
  };
  return encounter;
}

test('a message starting with Narrator: after any run of *, _ and white space counts, in any letter case', () => {
  const directed = [
    'Narrator: they reach the market.',
    '*Narrator: and they reach the market square...*',
    '_Narrator: dusk._',
    '  * _ *Narrator: rain.',
    '\n*Narrator: morning.',
    'narrator: they rest.',
    'NARRATOR: thunder.',
  ];
  for (const text of directed) {
    assert.equal(NarratorTurn.isNarratorMessage(text), true, text);
  }
});

test('Narrator: anywhere but the start, or Narrator without its colon, does not count', () => {
  const plain = [
    'the Narrator: said nothing.',
    'I ask the narrator about it.',
    '*looks at the Narrator: nothing*',
    'Narrator, describe the room.',
    'Narrator : the room.',
    'Narrators: all of them.',
    '-Narrator: dusk.',
    '',
  ];
  for (const text of plain) {
    assert.equal(NarratorTurn.isNarratorMessage(text), false, text);
  }
});

test('a Narrator: message gives the narrator with the turn instruction and never consults encounter', () => {
  for (const instruction of [null, 'An encounter happens now.']) {
    const consulted = [];
    const decision = NarratorTurn.firstSpeaker({
      text: '*Narrator: they reach the market.*', narratorAvatar, encounter: encounterSaying(consulted, instruction),
    });
    assert.deepEqual(decision, { avatar: narratorAvatar, instruction: turnInstruction });
    assert.equal(NarratorSettings.TurnInstruction, turnInstruction);
    assert.deepEqual(consulted, []);
  }
  assert.deepEqual(
    NarratorTurn.firstSpeaker({ text: 'Narrator: dawn.', narratorAvatar, encounter: null }),
    { avatar: narratorAvatar, instruction: turnInstruction },
  );
});

test('without a narrator in the group the result is null, even for a Narrator: message, and encounter is never consulted', () => {
  for (const text of ['Narrator: they reach the market.', 'I look around.']) {
    const consulted = [];
    assert.equal(NarratorTurn.firstSpeaker({ text, narratorAvatar: null, encounter: encounterSaying(consulted, 'Bring a stranger.') }), null, text);
    assert.deepEqual(consulted, [], text);
    assert.equal(NarratorTurn.firstSpeaker({ text, narratorAvatar: null, encounter: null }), null, text);
  }
});

test('for a plain message, an encounter instruction gives the narrator with that instruction', () => {
  const consulted = [];
  const decision = NarratorTurn.firstSpeaker({
    text: 'I ask the narrator about it.', narratorAvatar, encounter: encounterSaying(consulted, 'Bring a stranger who fits this place.'),
  });
  assert.deepEqual(decision, { avatar: narratorAvatar, instruction: 'Bring a stranger who fits this place.' });
  assert.deepEqual(consulted, ['encounter']);
});

test('for a plain message, an encounter returning null or no encounter at all gives null', () => {
  const consulted = [];
  assert.equal(NarratorTurn.firstSpeaker({ text: 'I look around.', narratorAvatar, encounter: encounterSaying(consulted, null) }), null);
  assert.deepEqual(consulted, ['encounter']);
  assert.equal(NarratorTurn.firstSpeaker({ text: 'I look around.', narratorAvatar, encounter: null }), null);
});
