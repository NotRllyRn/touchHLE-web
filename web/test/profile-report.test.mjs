// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profileWindow } from '../profile-report.mjs';
const snapshot = () => ({ mode: 'tci-counts', snapshotTimeMs: 100, dropped: 0, truncated: false,
  coverage: 'Partial after quota', blockEntryMeaning: 'Visits include self loops',
  opcodes: { call: 8 }, callSites: { 42: 3 }, blocks: [{ name: 'tci_block_0', entries: 5 }] });
test('window rejects absent or mismatched instrumentation and retains quota coverage', () => {
  const before = snapshot(), after = { ...snapshot(), snapshotTimeMs: 350, dropped: 2, truncated: true,
    opcodes: { call: 10, exit_tb: 1 }, callSites: { 42: 4 },
    blocks: [{ name: 'tci_block_0', entries: 7 }, { name: 'tci_block_1', entries: 1 }] };
  const delta = profileWindow(before, after, 'counts');
  assert.deepEqual(delta.opcodes, { call: 2, exit_tb: 1 });
  assert.deepEqual(delta.callSites, { 42: 1 });
  assert.deepEqual(delta.blocks.map(b => b.entries), [2, 1]);
  assert.equal(delta.truncated, true); assert.equal(delta.dropped, 2);
  assert.equal(delta.coverage, before.coverage);
  assert.equal(delta.counterWindow.durationMs, 250);
  assert.match(delta.counterWindow.meaning, /outside CPU sampling/);
  assert.throws(() => profileWindow(before, after, 'timing'), /does not match/);
  assert.throws(() => profileWindow(null, null, 'counts'), /does not match/);
  assert.throws(() => profileWindow(before, { ...after, mode: 'timing-names' }), /changed/);
  assert.equal(profileWindow(null, null), null);
});
