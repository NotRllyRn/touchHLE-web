// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { LIMITS, runtimeFiles, sha256, descriptor, prepare, readBounded, verifiedPackage,
  verifyIpa, writeVerifiedIpa, verifyArchiveSource,
  portableModuleSource, checkPortableIdentity } from './tb-archive-bridge.mjs';
globalThis.crypto ??= webcrypto;
const ipa = new Uint8Array([1, 2, 3]);
const hash = 'a'.repeat(64);
const identity = { ipa: await sha256(ipa), files: Object.fromEntries(runtimeFiles.map(name => [name, hash])) };
function mock() {
  const calls = [], freed = [];
  let next = 64;
  const runtime = {
    HEAPU8: new Uint8Array(65536),
    _malloc(length) { calls.push(['malloc', length]); const ptr = next; next += length; return ptr; },
    _free(ptr) { freed.push(ptr); },
    _touchhle_web_tb_status() { return 2; },
    _touchhle_web_tb_stat() { return 0; },
    _touchhle_web_tb_setup(...args) { calls.push(['setup', ...args]); return 1; },
    _touchhle_web_tb_import(ptr, length) { calls.push(['import', ...runtime.HEAPU8.slice(ptr, ptr + length)]); return 1; },
    _touchhle_web_tb_freeze() { calls.push(['freeze']); return 1; },
    _touchhle_web_tb_export(ptr, capacity) {
      calls.push(['export', ptr, capacity]);
      if (ptr) runtime.HEAPU8.set([8, 9, 10], ptr);
      return 3;
    },
    _touchhle_web_tb_clear() { calls.push(['clear']); return 1; },
  };
  return { runtime, calls, freed };
}
const setup = (m, request = { capture: true }) => prepare(m.runtime, request, identity, ipa, hash);
test('canonical exact identity rejects malformed hashes and extra/missing files', () => {
  assert.deepEqual(descriptor(identity, hash), descriptor({ ...identity, files: Object.fromEntries(Object.entries(identity.files).reverse()) }, hash));
  for (const bad of [undefined, { ...identity, ipa: 'bad' }, { ...identity, files: {} },
    { ...identity, files: { ...identity.files, extra: hash } }])
    assert.throws(() => descriptor(bad, hash), /identity/i);
  assert.throws(() => descriptor(identity, 42), /hash/i);
});
test('explicit opt-in, full input validation and IPA check occur before allocation', async () => {
  const m = mock();
  for (const request of [undefined, { capture: false }, { capture: 1 }, { capture: true, token: 123 },
    { capture: false, source: new Uint8Array(3) }, { capture: false, source: new ArrayBuffer(0) }])
    await assert.rejects(prepare(m.runtime, request, identity, ipa, hash));
  await assert.rejects(prepare(m.runtime, { capture: true }, identity, new Uint8Array([0]), hash), /IPA/);
  assert.equal(m.calls.length, 0);
});
test('full source digest retained before import; exact bounded setup and borrowed buffers freed', async () => {
  const m = mock(), source = new Uint8Array([4, 5, 6, 7]).buffer;
  const expected = await sha256(source);
  const session = await setup(m, { capture: false, source });
  assert.equal(session.sourceHash, expected);
  assert.equal(source.byteLength, 0);
  assert.deepEqual(m.calls.find(c => c[0] === 'setup').slice(3),
    [0, LIMITS.records, LIMITS.resident, LIMITS.wire, LIMITS.heap, LIMITS.reserve, 4]);
  assert.deepEqual(m.calls.find(c => c[0] === 'import'), ['import', 4, 5, 6, 7]);
  assert.equal(m.freed.length, 2);
});
test('setup/import failure clears staging and frees input buffers', async () => {
  for (const fn of ['setup', 'import']) {
    const m = mock(); m.runtime[`_touchhle_web_tb_${fn}`] = () => 0;
    await assert.rejects(setup(m, { capture: false, source: new ArrayBuffer(4) }), /rejected/);
    assert.equal(m.freed.length, fn === 'setup' ? 1 : 2);
    assert.equal(m.calls.at(-1)[0], 'clear');
  }
});
test('freeze/query/copy/free/clear then single transfer; actual structuredClone detaches output', async () => {
  const m = mock(), session = await setup(m);
  let received;
  session.exportTo((message, transfer) => {
    assert.equal(m.calls.at(-1)[0], 'clear');
    assert.equal(m.freed.length, 2);
    received = structuredClone(message, { transfer });
    assert.equal(message.buffer.byteLength, 0);
  });
  assert.deepEqual([...new Uint8Array(received.buffer)], [8, 9, 10]);
  assert.equal(received.type, 'tb-archive');
  assert.deepEqual(m.calls.filter(c => ['freeze', 'export', 'clear'].includes(c[0])).map(c => c[0]),
    ['freeze', 'export', 'export', 'clear']);
  assert.throws(() => session.exportTo(() => {}), /not exportable/);
});
test('busy freeze is retryable and does not query or allocate', async () => {
  const m = mock(), session = await setup(m), count = m.calls.length;
  m.runtime._touchhle_web_tb_freeze = () => 0;
  assert.throws(() => session.exportTo(() => {}), /busy/);
  assert.equal(m.calls.length, count);
});
test('oversized export refuses allocation and clears; transfer throw still releases native storage', async () => {
  const m = mock(), session = await setup(m);
  m.runtime._touchhle_web_tb_export = () => LIMITS.wire + 1;
  assert.throws(() => session.exportTo(() => {}), /length/);
  assert.equal(m.freed.length, 1);
  assert.equal(m.calls.at(-1)[0], 'clear');
  const n = mock(), other = await setup(n);
  assert.throws(() => other.exportTo(() => { throw Error('post failed'); }), /post failed/);
  assert.equal(n.calls.at(-1)[0], 'clear');
  assert.equal(n.freed.length, 2);
});
test('failed malloc and out-of-bounds pointer clean up without import', async () => {
  for (const ptr of [0, 65535]) {
    const m = mock(); m.runtime._malloc = () => ptr;
    await assert.rejects(setup(m), /allocation/);
    assert.equal(m.calls.at(-1)[0], 'clear');
    assert.equal(m.freed.length, ptr === 0 ? 0 : 1);
  }
});
test('heap growth refreshes views after native export', async () => {
  const m = mock(), session = await setup(m);
  m.runtime._touchhle_web_tb_export = (ptr) => {
    if (ptr) { m.runtime.HEAPU8 = new Uint8Array(131072); m.runtime.HEAPU8.set([3], ptr); }
    return 1;
  };
  session.exportTo(message => assert.equal(new Uint8Array(message.buffer)[0], 3));
});
test('bounded fetch checks announced and streamed size and cancels overflow', async () => {
  await assert.rejects(readBounded(new Response(new Uint8Array(3), { headers: { 'content-length': '3' } }), 2), /large/);
  let canceled = false;
  const response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(3)); }, cancel() { canceled = true; } }));
  await assert.rejects(readBounded(response, 2), /large/);
  assert.equal(canceled, true);
  assert.deepEqual([...await readBounded(new Response(new Uint8Array([1, 2])), 2)], [1, 2]);
});
test('verified package hashes actual bytes, rejects worker mismatch, and fetches sequentially', async () => {
  const bytes = new Uint8Array([4]), digest = await sha256(bytes);
  const expected = { ...identity, files: Object.fromEntries(runtimeFiles.map(name => [name, digest])) };
  let fetched = 0;
  const get = async () => { fetched++; return new Response(bytes); };
  await assert.rejects(verifiedPackage({ workerHash: hash }, expected, ipa, get), /Worker/);
  assert.equal(fetched, 0);
  const pinned = await verifiedPackage({ workerHash: digest, base: 'https://example.test/' }, expected, ipa, get);
  assert.equal(fetched, runtimeFiles.length - 1);
  assert.equal(Object.keys(pinned).length, 9);
  assert.deepEqual(pinned['text-input.js'], bytes);
  assert.deepEqual(pinned['guest-saves.js'], bytes);
  assert.deepEqual(pinned['external-open.js'], bytes);
  await assert.rejects(verifiedPackage({ workerHash: digest, base: 'https://example.test/' }, expected, ipa,
    async () => new Response(new Uint8Array([5]))), /Fingerprint/);
});
test('launch options and portable identity are part of compatibility', () => {
  const normal = descriptor(identity, hash);
  assert.notDeepEqual(normal, descriptor(identity, hash, { headless: true, optionsHash: null }));
  assert.notDeepEqual(normal, descriptor(identity, hash, { headless: false, optionsHash: hash }));
  assert.throws(() => descriptor(identity, hash, { headless: false, optionsHash: 'bad' }));
  assert.throws(() => descriptor(identity, hash, { headless: false, optionsHash: null, unknown: true }));
  checkPortableIdentity({ identity }, identity);
  assert.throws(() => checkPortableIdentity({ identity: { ...identity, ipa: 'b'.repeat(64) } }, identity));
});
test('pinned portable module uses the already loaded compiler without refetch', async () => {
  const { readFile } = await import('node:fs/promises');
  await import('../tci-jit.js');
  const bytes = await readFile(new URL('../tci-precompile.mjs', import.meta.url));
  const source = portableModuleSource(bytes);
  assert(!source.includes("import './tci-jit.js'"));
  const module = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const cache = await module.prepareCache({ format: 1, abi: '{}', blocks: [] });
  assert.equal(cache.modules.size, 0);
  assert.throws(() => portableModuleSource(new TextEncoder().encode("import './unexpected.js';")));
});
test('candidate normal worker path loads existing runtime and starts without archive allocation', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const calls = [], messages = [];
  const runtime = {
    FS: { writeFile(path, bytes) { calls.push(['write', path, [...bytes]]); } },
    ccall(name) { calls.push(['call', name]); },
  };
  await import('../external-open.js');
  await import('../text-input.js');
  const self = { TouchHLEExternal: globalThis.TouchHLEExternal, TouchHLEText: globalThis.TouchHLEText, addEventListener() {}, location: { href: 'https://example.test/runtime-worker.js' }, postMessage(message) { messages.push(message); } };
  const context = { self, Blob, Uint8Array, URL, createTouchHLE: async options => {
    assert.equal(options.noInitialRun, true); assert.equal(options.wasmBinary, undefined); return runtime;
  }, importScripts: (...paths) => calls.push(['scripts', ...paths]) };
  runInNewContext(await readFile(new URL('./runtime-worker.js', import.meta.url), 'utf8'), context);
  await self.onmessage({ data: { type: 'start', file: new Blob([ipa]), headless: true } });
  assert.deepEqual(calls, [['scripts', './touchhle-runtime.js', './audio-proxy.js', './guest-saves.js', './external-open.js', './text-input.js'],
    ['write', '/app.ipa', [1, 2, 3]], ['call', 'touchhle_web_start']]);
  assert.equal(messages.some(message => message.type.startsWith('tb-')), false);
});

test('busy clear retains session for later successful export', async () => {
  const m = mock(), session = await setup(m);
  m.runtime._touchhle_web_tb_clear = () => 0;
  assert.throws(() => session.clear(), /busy/);
  m.runtime._touchhle_web_tb_clear = () => 1;
  session.exportTo(message => assert.equal(message.buffer.byteLength, 3));
});

test('diagnostics report actual status and avoid mixed counters while run is busy', async () => {
  const m = mock(), session = await setup(m);
  assert.equal(session.snapshot().status, 2);
  m.runtime._touchhle_web_tb_stat = n => n === 19 ? 1 : 0;
  assert.deepEqual(session.snapshot(), { status: 2, busy: true });
});


test('verified worker stops on package mismatch without executing unverified fallback', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const original = await readFile(new URL('./runtime-worker.js', import.meta.url), 'utf8');
  // Substitute only dynamic module resolution; execute the actual worker flow.
  const source = original.replace('await import(boot.helperURL)', 'fixtureBridge');
  assert.notEqual(source, original);
  for (const request of [undefined, { capture: true }]) {
    const messages = [], calls = [];
    const self = { __tbBootstrap: { helperURL: 'blob:helper', base: 'https://example.test/' },
      postMessage: message => messages.push(message) };
    runInNewContext(source, { self, Blob, Uint8Array, URL,
      fixtureBridge: {
        verifyIpa: async () => ({}),
        verifiedPackage: async () => { throw Error('Fingerprint mismatch: touchhle-runtime.wasm'); },
        script: () => calls.push('verified-script'),
      },
      importScripts: () => calls.push('unverified-script'),
      createTouchHLE: () => calls.push('runtime'),
    });
    await self.onmessage({ data: { type: 'start', file: new Blob([ipa]), tbArchive: request } });
    assert.deepEqual(calls, []);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, 'error');
    assert.match(messages[0].message, request ? /Fingerprint mismatch/ : /explicit request/);
  }
});

test('immutable IPA handle mounts checked bytes and rejects a different identity or forged handle', async () => {
  const bytes = ipa.slice(), file = new Blob([bytes]);
  bytes.fill(9);
  const handle = await verifyIpa(file, identity.ipa);
  const mounted = [];
  const runtime = { FS: { writeFile(path, value) {
    mounted.push([path, [...value]]); value.fill(8);
  } } };
  await writeVerifiedIpa(runtime, handle);
  await writeVerifiedIpa(runtime, handle);
  assert.deepEqual(mounted, [['/app.ipa', [1, 2, 3]], ['/app.ipa', [1, 2, 3]]]);
  await assert.rejects(writeVerifiedIpa(runtime, {}), /handle/);
  await assert.rejects(verifyIpa(file, hash), /fingerprint/);
  const m = mock();
  await assert.rejects(prepare(m.runtime, { capture: true }, { ...identity, ipa: hash }, handle, hash), /IPA/);
  assert.equal(m.calls.length, 0);
  await prepare(m.runtime, { capture: true }, identity, handle, hash);
});

test('archive ownership detaches all caller aliases and verified handles are consumed once', async () => {
  const bytes = new Uint8Array([4, 5, 6]), expected = await sha256(bytes);
  const verification = verifyArchiveSource(bytes.buffer, expected);
  assert.equal(bytes.byteLength, 0); // Detach synchronously, before async digest.
  const handle = await verification, m = mock();
  const result = await setup(m, { capture: false, source: handle, sourceSha256: expected });
  assert.equal(result.sourceHash, expected);
  assert.deepEqual(m.calls.find(c => c[0] === 'import'), ['import', 4, 5, 6]);
  await assert.rejects(setup(mock(), { capture: false, source: handle }), /length/);
  await assert.rejects(setup(mock(), { capture: false, source: {} }), /length/);
  await assert.rejects(verifyArchiveSource(new Uint8Array([4, 5, 7]).buffer, expected), /fingerprint/);
});

test('verified IPA and archive handles avoid rehashing in package verification and prepare', async () => {
  const file = new Blob([ipa]), bytes = new Uint8Array([4, 5, 6, 7]);
  const expected = await sha256(bytes), ipaHandle = await verifyIpa(file, identity.ipa);
  const source = await verifyArchiveSource(bytes.buffer, expected);
  const original = crypto.subtle.digest;
  const lengths = [];
  crypto.subtle.digest = function (algorithm, input) { lengths.push(input.byteLength); return original.call(this, algorithm, input); };
  try {
    const runtimeBytes = new Uint8Array([9]), digest = await sha256(runtimeBytes);
    const compatible = { ...identity, files: Object.fromEntries(runtimeFiles.map(name => [name, digest])) };
    await verifiedPackage({ workerHash: digest, base: 'https://example.test/' }, compatible, ipaHandle,
      async () => new Response(runtimeBytes));
    await prepare(mock().runtime, { capture: false, source, sourceSha256: expected }, compatible, ipaHandle, hash);
    assert(!lengths.includes(ipa.length), 'IPA must not be hashed again');
    assert(!lengths.includes(4), 'archive must not be hashed again');
  } finally { crypto.subtle.digest = original; }
});

test('verified worker rejects changed IPA/archive before executing runtime scripts or allocating native state', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const source = (await readFile(new URL('./runtime-worker.js', import.meta.url), 'utf8'))
    .replace('await import(boot.helperURL)', 'fixtureBridge');
  const native = new Uint8Array([8, 9, 10]), expected = await sha256(native);
  for (const badIpa of [false, true]) {
    const calls = [], messages = [];
    const self = { __tbBootstrap: { helperURL: 'blob:helper' }, postMessage: m => messages.push(m) };
    runInNewContext(source, { self, Blob, Uint8Array, URL,
      fixtureBridge: { verifyIpa, verifyArchiveSource, verifiedPackage: async () => ({}), script: () => calls.push('script') },
      importScripts: () => calls.push('unverified-script'), createTouchHLE: () => calls.push('runtime') });
    await self.onmessage({ data: { type: 'start', file: new Blob([badIpa ? new Uint8Array([9]) : ipa]), tbIdentity: identity,
      tbArchive: { capture: false, source: new Uint8Array([8, 9, 11]).buffer, sourceSha256: expected } } });
    assert.deepEqual(calls, []);
    assert.equal(messages.length, 1); assert.equal(messages[0].type, 'error');
    assert.match(messages[0].message, badIpa ? /IPA fingerprint/ : /Native archive fingerprint/);
  }
});
