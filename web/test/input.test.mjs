// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachInput } from '../input.mjs';
function harness() {
  const listeners = new Map(), messages = [];
  const canvas = { width: 800, height: 600,
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 300 }),
    setPointerCapture() {}, addEventListener: (name, fn) => listeners.set(name, fn) };
  attachInput(canvas, message => messages.push(message));
  const emit = (name, props = {}) => listeners.get(name)({ pointerId: 1, pointerType: 'touch',
    clientX: 210, clientY: 170, timeStamp: 100, deltaMode: 0, preventDefault() {}, ...props });
  return { messages, emit };
}
test('two contacts keep independent identities through cancellation and movement', () => {
  const { messages, emit } = harness();
  emit('pointerdown'); emit('pointerdown', { pointerId: 2 });
  emit('pointercancel'); emit('pointermove', { pointerId: 2, clientX: 310 });
  emit('pointerup', { pointerId: 2 }); emit('pointermove', { pointerId: 2 });
  assert.deepEqual(messages.map(m => [m.kind, m.points[0].id]), [[0, 1], [0, 2], [2, 1], [1, 2], [2, 2]]);
  assert.deepEqual(messages[3].points[0], { id: 2, x: .75, y: .5 });
});
test('mouse input uses backing-canvas pixels and ignores hover', () => {
  const { messages, emit } = harness();
  emit('pointermove', { pointerType: 'mouse' });
  emit('pointerdown', { pointerType: 'mouse' }); emit('pointerup', { pointerType: 'mouse' });
  assert.deepEqual(messages, [0, 2].map(kind => ({ type: 'pointer', kind, x: 400, y: 300 })));
});
test('wheel zoom produces paired, ordered pinch events and respects active contacts', () => {
  const { messages, emit } = harness(); let prevented = false;
  emit('wheel', { deltaY: 120, preventDefault: () => { prevented = true; } });
  assert(prevented); assert.equal(messages.length, 8);
  assert.deepEqual(messages.map(m => m.kind), [0, 1, 1, 1, 1, 1, 1, 2]);
  for (const m of messages) assert.deepEqual(m.points.map(p => p.id), [-1, -2]);
  const separation = m => m.points[1].x - m.points[0].x;
  assert(separation(messages[6]) < separation(messages[0]));
  assert.deepEqual(messages[6].points, messages[7].points);
  assert(messages.every((m, i) => m.timestamp === 100 + i));
  emit('pointerdown'); const count = messages.length;
  emit('wheel', { deltaY: -120 }); assert.equal(messages.length, count);
});
