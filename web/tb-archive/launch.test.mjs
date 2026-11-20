// SPDX-License-Identifier: MPL-2.0
// Mock lifecycle checks only: no browser or real Worker/guest is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { launch } from './verified-launch.mjs';

test('launcher pins exact executed worker/helper and owns Blob URL lifetime', async t => {
  const worker = new TextEncoder().encode('synthetic worker bytes');
  const helper = new TextEncoder().encode('synthetic helper bytes');
  const digest = async bytes => createHash('sha256').update(bytes).digest('hex');
  const identity = { files: { 'runtime-worker.js': await digest(worker) } };
  const helperHash = await digest(helper);
  const previousLocation = globalThis.location, previousWorker = globalThis.Worker;
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const blobs = new Map(), revoked = [];
  globalThis.location = { href: 'http://localhost/game/index.html' };
  URL.createObjectURL = blob => { const url = `blob:synthetic-${blobs.size}`; blobs.set(url, blob); return url; };
  URL.revokeObjectURL = url => revoked.push(url);
  let started = 0, terminated = 0, workerURL;
  globalThis.Worker = class {
    constructor(url) { started++; workerURL = url; }
    terminate() { terminated++; }
  };
  t.after(() => {
    if (previousLocation === undefined) delete globalThis.location; else globalThis.location = previousLocation;
    if (previousWorker === undefined) delete globalThis.Worker; else globalThis.Worker = previousWorker;
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
  });
  const read = async name => name === 'runtime-worker.js' ? worker : helper;
  await assert.rejects(launch('./', identity, 'wrong helper', read, digest), /Helper fingerprint/);
  await assert.rejects(launch('./', { files: { 'runtime-worker.js': 'wrong worker' } }, helperHash, read, digest), /Worker fingerprint/);
  assert.equal(started, 0); assert.equal(blobs.size, 0);
  const handle = await launch('./', identity, helperHash, read, digest);
  assert.equal(started, 1); assert.equal(revoked.length, 0);
  assert.equal(await blobs.get('blob:synthetic-0').text(), new TextDecoder().decode(helper));
  const text = await blobs.get(workerURL).text();
  assert(text.endsWith(new TextDecoder().decode(worker)));
  assert(text.includes(JSON.stringify(helperHash)));
  assert(text.includes('http://localhost/game/'));
  handle.destroy(); assert.equal(terminated, 1); assert.equal(revoked.length, 2);
  globalThis.Worker = class { constructor() { throw Error('synthetic constructor failure'); } };
  await assert.rejects(launch('./', identity, helperHash, read, digest), /constructor failure/);
  assert.equal(revoked.length, 4);
});
