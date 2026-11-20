// SPDX-License-Identifier: MPL-2.0
// CLI policy only; these bytes are not part of the runtime archive identity.
import assert from 'node:assert/strict';

export function captureArguments(args) {
  const [runtimePath, ipaPath, outputPath, mode = 'capture', sourcePath] = args;
  const replay = mode === 'replay-capture';
  assert(args.length <= 5 && runtimePath && ipaPath && outputPath &&
    ['capture', 'restore', 'baseline', 'replay-capture'].includes(mode) &&
    ((mode === 'restore' || replay) === Boolean(sourcePath)),
  'Usage: node web/tb-archive/capture-game.mjs RUNTIME_DIRECTORY INPUT.ipa NEW_OUTPUT_DIRECTORY [capture|restore|baseline|replay-capture] [NATIVE_ARCHIVE]');
  return { runtimePath, ipaPath, outputPath, mode, sourcePath, replay,
    collectPortable: mode === 'capture' || replay };
}

export function requireReplayEvidence({ ready, stats, archiveError, failed, capture }, sourceHash) {
  assert(!failed && !archiveError, 'Replay failed or archive was disabled');
  assert(ready?.sourceHash === sourceHash, 'Replay source fingerprint was not confirmed by worker');
  assert(stats?.busy === false && stats.status === 2 && stats.imported === 1 && stats.restores > 0,
    'Replay requires an admitted archive and actual native restores');
  assert(stats.captures === 0 && stats.runGuard === 0 && stats.allocationFailures === 0,
    'Replay capture must leave native capture off and its runtime seal intact');
  assert(typeof capture?.abi === 'string' && capture.abi.length > 0 && capture.abi.length <= 65536 &&
    Array.isArray(capture.keys) && capture.keys.length > 0 && capture.keys.length <= 32768 &&
    capture.keys.every(key => typeof key === 'string' && key.length > 0 && key.length <= 90000) &&
    capture.keys.reduce((bytes, key) => bytes + key.length, 0) <= 32 * 1024 * 1024,
    'Replay requires bounded nonempty portable coverage');
}
