// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { captureArguments, requireReplayEvidence } from './capture-policy.mjs';

test('CLI replay capture requires an archive; ordinary capture/baseline reject one', () => {
  const args = ['runtime', 'game.ipa', 'out'];
  assert.equal(captureArguments(args).collectPortable, true);
  assert.equal(captureArguments([...args, 'baseline']).collectPortable, false);
  assert.equal(captureArguments([...args, 'restore', 'native.tb']).collectPortable, false);
  assert.equal(captureArguments([...args, 'replay-capture', 'native.tb']).replay, true);
  for (const tail of [['capture', 'native.tb'], ['baseline', 'native.tb'], ['restore'],
    ['replay-capture'], ['unknown'], ['restore', 'native.tb', 'extra']]) {
    assert.throws(() => captureArguments([...args, ...tail]));
  }
});

const hash = 'a'.repeat(64);
const evidence = () => ({ ready: { sourceHash: hash },
  stats: { status: 2, busy: false, imported: 1, restores: 28, captures: 0, runGuard: 0, allocationFailures: 0 },
  capture: { abi: '{}', keys: ['original-fixture'] } });
test('replay evidence requires verified source, import, restoration and unchanged native capture mode', () => {
  requireReplayEvidence(evidence(), hash);
  for (const [field, value] of Object.entries({ status: 1, busy: true, imported: 0,
    restores: 0, captures: 1, runGuard: 1, allocationFailures: 1 })) {
    const input = evidence(); input.stats[field] = value;
    assert.throws(() => requireReplayEvidence(input, hash), field);
  }
  for (const change of [{ ready: { sourceHash: 'b'.repeat(64) } }, { ready: null },
    { stats: null }, { failed: { type: 'error' } }, { archiveError: 'import rejected' },
    { capture: { abi: '{}', keys: [] } }, { capture: { abi: null, keys: ['x'] } },
    { capture: { abi: '{}', keys: ['x'.repeat(90001)] } },
    { capture: { abi: '{}', keys: Array(32769).fill('x') } },
    { capture: { abi: '{}', keys: Array(400).fill('x'.repeat(90000)) } }]) {
    assert.throws(() => requireReplayEvidence({ ...evidence(), ...change }, hash));
  }
});
