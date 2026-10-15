// Step 6: 1–4 and R only select; the trigger (LMB / Q) fires the selection.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpellInput } from '../client/js/input/SpellInput.js';

test('1–4 select a spell slot and never fire', () => {
  const inp = new SpellInput();
  for (const [code, slot] of [['Digit1', 0], ['Digit2', 1], ['Digit3', 2], ['Digit4', 3]]) {
    const r = inp.key(code);
    assert.deepEqual(r, { action: 'select', slot });
    assert.notEqual(r.action, 'cast');
    assert.equal(inp.selected, slot);
  }
  assert.equal(inp.key('Digit5'), null, 'there is no slot 5');
});

test('R selects the Ultimate (it does not cast it)', () => {
  const inp = new SpellInput();
  assert.deepEqual(inp.key('KeyR'), { action: 'select', slot: 'ult' });
  assert.equal(inp.selected, 'ult');
});

test('the trigger (LMB / Q) fires whatever is selected', () => {
  const inp = new SpellInput();
  assert.deepEqual(inp.fire(), { action: 'cast', slot: 0 }, 'slot 1 by default');
  inp.key('Digit3');
  assert.deepEqual(inp.fire(), { action: 'cast', slot: 2 });
  assert.deepEqual(inp.fire(), { action: 'cast', slot: 2 }, 'and again: the selection stays');
  inp.key('KeyR');
  assert.deepEqual(inp.fire(), { action: 'cast', slot: 'ult' });
  inp.key('Digit1');
  assert.deepEqual(inp.fire(), { action: 'cast', slot: 0 });
});

test('Shift+number is left alone (the debug wizard swap)', () => {
  const inp = new SpellInput();
  inp.key('Digit2');
  assert.equal(inp.key('Digit4', { shift: true }), null);
  assert.equal(inp.selected, 1);
});

test('Archon form: 1–7 select a Mastery, the trigger fires it; R selects the Ultimate', () => {
  const inp = new SpellInput();
  assert.deepEqual(inp.key('Digit6', { archon: true }), { action: 'select-mastery', key: 6 });
  assert.deepEqual(inp.fire({ archon: true }), { action: 'mastery', key: 6 });
  inp.key('KeyR', { archon: true });
  assert.deepEqual(inp.fire({ archon: true }), { action: 'cast', slot: 'ult' });
  inp.key('Digit7', { archon: true });
  assert.deepEqual(inp.fire({ archon: true }), { action: 'mastery', key: 7 });
  assert.equal(inp.selected, 0, 'the normal slot selection is untouched');
});
