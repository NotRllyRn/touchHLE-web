// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import createUnicorn from '@alexaltea/unicorn-js/arm';
import { runCpuChecks } from '../cpu-checks.mjs';

test('candidate WASM CPU meets basic HLE requirements', async () => {
  const uc = await createUnicorn();
  const results = runCpuChecks(uc);
  assert.equal(results.length, 9);
  for (const result of results) assert.equal(result.passed, true, JSON.stringify(result));
});
