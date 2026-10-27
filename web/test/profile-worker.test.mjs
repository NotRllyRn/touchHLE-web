// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectProfileWorker, readProfileWorker } from '../profile-worker.mjs';
const page = { type: 'page', url: 'http://localhost:8765/?cpu=jit', browserContextId: 'one' };
const worker = { type: 'worker', url: 'http://localhost:8765/runtime-worker.js', browserContextId: 'one', targetId: 'guest' };

test('profiling selects an unambiguous context without Playwright worker wrappers', () => {
  assert.equal(selectProfileWorker([page, worker], page.url), worker);
  for (const targets of [[page], [page, worker, { ...worker }], [page, { ...page }, worker],
    [page, { ...worker, browserContextId: 'two' }],
    [page, { ...worker, url: 'http://localhost:8766/runtime-worker.js' }]])
    assert.throws(() => selectProfileWorker(targets, page.url));
  assert.throws(() => selectProfileWorker([page, worker], 'http://localhost:8765/other'));
});

test('worker data uses the same CDP session as sampling and propagates failures', async () => {
  const send = async (method, params) => {
    assert.equal(method, 'Runtime.evaluate');
    assert.deepEqual(params, { expression: 'snapshot()', returnByValue: true });
    return { result: { type: 'string', value: '{"mode":"timing-names"}' } };
  };
  assert.deepEqual(await readProfileWorker(send, 'snapshot()'), { mode: 'timing-names' });
  for (const response of [{ exceptionDetails: { text: 'Uncaught' } },
    { result: { type: 'undefined' } }, { result: { type: 'string', value: 'invalid JSON' } }])
    await assert.rejects(readProfileWorker(async () => response, 'snapshot()'));
});
