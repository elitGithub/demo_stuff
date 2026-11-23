import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WalkOns } from '../extension/universe-narrator/WalkOns.js';

test('enter=Tom|Old Mag adds both, trimmed, in order, and empty parts are ignored', () => {
  assert.deepEqual(WalkOns.apply([], { enter: 'Tom|Old Mag', leave: undefined }), ['Tom', 'Old Mag']);
  assert.deepEqual(WalkOns.apply(['Ina'], { enter: ' Tom | | Old Mag |', leave: undefined }), ['Ina', 'Tom', 'Old Mag']);
});

test('a name already listed is not added again, whatever its letter case, also within one block', () => {
  assert.deepEqual(WalkOns.apply(['Tom'], { enter: 'Tom', leave: undefined }), ['Tom']);
  assert.deepEqual(WalkOns.apply(['Tom'], { enter: 'tom', leave: undefined }), ['Tom']);
  assert.deepEqual(WalkOns.apply([], { enter: 'Tom|TOM|Old Mag|old mag', leave: undefined }), ['Tom', 'Old Mag']);
});

test('leave=tom removes Tom, case-insensitive, and a leave name not listed is ignored', () => {
  assert.deepEqual(WalkOns.apply(['Tom', 'Old Mag'], { enter: undefined, leave: 'tom' }), ['Old Mag']);
  assert.deepEqual(WalkOns.apply(['Tom', 'Old Mag'], { enter: undefined, leave: ' OLD MAG | Tom ' }), []);
  assert.deepEqual(WalkOns.apply(['Tom'], { enter: undefined, leave: 'Ina|To' }), ['Tom']);
});

test('enter is applied before leave, so enter=Tom with leave=Tom in one block leaves Tom out', () => {
  assert.deepEqual(WalkOns.apply([], { enter: 'Tom', leave: 'Tom' }), []);
  assert.deepEqual(WalkOns.apply(['Ina'], { enter: 'Tom|Old Mag', leave: 'tom' }), ['Ina', 'Old Mag']);
});

test('an empty, missing or none value changes nothing', () => {
  const noneWords = ['none', 'None', 'NULL', 'n/a', 'N/A', 'na', 'no one', 'No One', 'nobody', 'empty', '-', ' none '];
  for (const value of [undefined, '', '   ', '|', ...noneWords]) {
    assert.deepEqual(WalkOns.apply(['Tom'], { enter: value, leave: undefined }), ['Tom'], String(value));
    assert.deepEqual(WalkOns.apply(['Tom'], { enter: undefined, leave: value }), ['Tom'], String(value));
  }
  assert.deepEqual(WalkOns.apply([], { enter: 'none|Tom|nobody', leave: 'none' }), ['Tom']);
  assert.deepEqual(WalkOns.apply([], { enter: 'None of them', leave: undefined }), ['None of them']);
});

test('the input array is never mutated and a new array is always returned', () => {
  const walkOns = Object.freeze(['Tom', 'Old Mag']);
  for (const parameters of [{ enter: 'Ina', leave: 'Tom' }, { enter: undefined, leave: undefined }]) {
    const updated = WalkOns.apply(walkOns, parameters);
    assert.notEqual(updated, walkOns);
    assert.deepEqual(walkOns, ['Tom', 'Old Mag']);
    updated.push('Extra');
    assert.deepEqual(walkOns, ['Tom', 'Old Mag']);
  }
});

test('the prompt lists the walk-ons with the leave instruction, and is empty with none listed', () => {
  assert.equal(WalkOns.prompt([]), '');
  assert.equal(
    WalkOns.prompt(['Tom', 'Old Mag']),
    'Walk-ons in the scene now: Tom, Old Mag\nWhen one leaves the scene, write leave=Name in your parameters.',
  );
});
