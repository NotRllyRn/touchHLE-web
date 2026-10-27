// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { checkIdentity, verifyFile, runtimeFiles } from '../package-identity.mjs';
const hash = createHash('sha256').update('original').digest('hex');
const identity = { ipa: hash, files: Object.fromEntries(runtimeFiles.map(name => [name, hash])) };

test('package identities reject missing, stale and different-game inputs', () => {
  checkIdentity(identity, structuredClone(identity));
  for (const name of runtimeFiles) {
    const missing = structuredClone(identity); delete missing.files[name];
    assert.throws(() => checkIdentity(missing, identity), /Invalid/);
    const changed = structuredClone(identity); changed.files[name] = 'f'.repeat(64);
    assert.throws(() => checkIdentity(identity, changed), /does not match/);
  }
  assert.throws(() => checkIdentity(identity, { ...identity, ipa: 'e'.repeat(64) }), /does not match/);
  for (const bad of [undefined, {}, { ...identity, ipa: 'not a hash' }])
    assert.throws(() => checkIdentity(identity, bad), /Invalid/);
});

test('browser SHA-256 agrees with producer and rejects changed bytes', async () => {
  await verifyFile('game.ipa', new TextEncoder().encode('original'), hash);
  await assert.rejects(verifyFile('game.ipa', new TextEncoder().encode('changed'), hash), /mismatch: game.ipa/);
});
