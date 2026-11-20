// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('capture CLI rejects ignored archive inputs and missing restore input before browser setup', () => {
  for (const suffix of [['capture', 'unused.tb'], ['baseline', 'unused.tb'], ['restore']]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./capture-game.mjs', import.meta.url)),
      'unused-runtime', 'unused.ipa', 'unused-output', ...suffix], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage: node web\/tb-archive\/capture-game.mjs/);
    assert.doesNotMatch(result.stderr, /Cannot find package 'playwright'/);
  }
});
