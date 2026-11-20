// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../guest-saves.js';
import { attachSaveSession } from '../save-session.mjs';
const { open, validate, collect, ROOT } = globalThis.TouchHLESaves;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
// Independent host filesystem adapter. Browser integration separately uses actual Emscripten MEMFS.
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'touchhle-saves-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const host = name => path.join(root, name);
  const name = value => typeof value === 'string' ? value : value.path;
  const streams = new Map();
  const FS = {
    cwd: () => '/', getPath: node => node.path, getStream: fd => streams.get(fd),
    analyzePath: p => ({ exists: fs.existsSync(host(p)) }),
    lstat: p => fs.lstatSync(host(p)),
    isDir: m => (m & 0o170000) === 0o040000, isFile: m => (m & 0o170000) === 0o100000,
    readdir: p => ['.', '..', ...fs.readdirSync(host(p))],
    mkdir: p => fs.mkdirSync(host(p)),
    mkdirTree(p) { const parts = p.split('/').filter(Boolean); let current = ''; for (const part of parts) { current += '/' + part; if (!FS.analyzePath(current).exists) FS.mkdir(current); } },
    open(p, flags) { const fd = fs.openSync(host(p), flags); const stream = { fd, flags: flags === 'r' ? 0 : 1, node: { path: p } }; streams.set(fd, stream); return stream; },
    write: (s, data, offset, length, position) => fs.writeSync(s.fd, data, offset, length, position),
    close(s) { fs.closeSync(s.fd); streams.delete(s.fd); },
    writeFile(p, data) { const s = FS.open(p, 'w'); try { FS.write(s, data, 0, data.length, 0); } finally { FS.close(s); } },
    readFile: p => new Uint8Array(fs.readFileSync(host(p))),
    rename: (a, b) => fs.renameSync(host(a), host(b)), unlink: p => fs.unlinkSync(host(p)), rmdir: p => fs.rmdirSync(host(p)),
    truncate: (p, len) => fs.truncateSync(host(name(p)), len), ftruncate: (fd, len) => fs.ftruncateSync(fd, len),
    chmod: (p, mode) => fs.chmodSync(host(name(p)), mode), utime: (p, a, m) => fs.utimesSync(host(p), new Date(a), new Date(m)),
    symlink: (a, b) => fs.symlinkSync(a, host(b)),
  };
  return FS;
}
function storage(initial = []) {
  const records = new Map(structuredClone(initial).map(r => [r.id, r]));
  return { records, commits: [], closed: 0, async load() { return structuredClone([...records.values()]); },
    async commit(puts, deletes) { this.commits.push({ puts: structuredClone(puts), deletes: [...deletes] }); for (const id of deletes) records.delete(id); for (const record of puts) records.set(record.id, structuredClone(record)); },
    close() { this.closed++; } };
}
const settings = store => ({ store, intervalMs: 0, acquireLock: async () => () => {} });
const file = (id, relative = 'Documents/user_defaults.plist') => `${ROOT}/${id}/${relative}`;
function write(FS, id, relative, data) { const p = file(id, relative); FS.mkdirTree(p.slice(0, p.lastIndexOf('/'))); FS.writeFile(p, new Uint8Array(data)); }

test('opaque bytes and hierarchy restore before use; apps are separate; tmp and bundles excluded', async t => {
  const FS = fixture(t), store = storage(), session = await open(FS, settings(store));
  const bytes = [0, 255, 128, 10, 13, 60, 38];
  write(FS, 'com.example.one', 'Documents/User/slot0\\A%2eB.gb', bytes);
  write(FS, 'com.example.two', 'Documents/User/slot0\\A%2eB.gb', [9]);
  write(FS, 'com.example.one', 'Library/Preferences/settings.plist', [3, 2]);
  write(FS, 'com.example.one', 'tmp/disposable', [8]);
  await session.close();
  assert.deepEqual([...store.records.keys()].sort(), ['com.example.one', 'com.example.two']);
  assert(store.records.get('com.example.one').entries.every(e => !e.path.startsWith('tmp')));
  const restored = fixture(t), next = await open(restored, settings(store));
  assert.deepEqual([...restored.readFile(file('com.example.one', 'Documents/User/slot0\\A%2eB.gb'))], bytes);
  assert.deepEqual([...restored.readFile(file('com.example.two', 'Documents/User/slot0\\A%2eB.gb'))], [9]);
  assert.equal(restored.analyzePath(file('com.example.one', 'tmp/disposable')).exists, false);
  await next.close();
});

test('commit acknowledgement waits for transaction; later writes need another commit', async t => {
  const FS = fixture(t), store = storage(), gate = deferred(), entered = deferred();
  const original = store.commit.bind(store); let calls = 0;
  store.commit = async (...args) => { if (++calls === 1) { entered.resolve(); await gate.promise; } return original(...args); };
  const statuses = [], session = await open(FS, { ...settings(store), notify: s => statuses.push(s.state) });
  write(FS, 'app', 'Documents/progress', [1]);
  const flushing = session.flush(); await entered.promise;
  assert.equal(store.records.size, 0); assert.equal(statuses.at(-1), 'dirty');
  FS.writeFile(file('app', 'Documents/progress'), new Uint8Array([2, 3]));
  gate.resolve(); await flushing;
  assert.equal(calls, 2);
  assert.deepEqual([...store.records.get('app').entries.find(e => e.kind === 'file').data], [2, 3]);
  assert.equal(statuses.at(-1), 'saved'); await session.close();
});

test('failed commit/close retains last committed bytes and dirty session for retry', async t => {
  const FS = fixture(t), store = storage(); let releases = 0;
  const session = await open(FS, { ...settings(store), acquireLock: async () => () => releases++ });
  write(FS, 'app', 'Documents/progress', [1]); await session.flush();
  const original = store.commit.bind(store); store.commit = async () => { throw Error('quota exceeded'); };
  FS.writeFile(file('app', 'Documents/progress'), new Uint8Array([2]));
  await assert.rejects(session.close(), /quota exceeded/);
  assert.equal(releases, 0); assert.equal(store.closed, 0);
  assert.deepEqual([...store.records.get('app').entries.find(e => e.kind === 'file').data], [1]);
  store.commit = original; await session.close(); assert.equal(releases, 1); assert.equal(store.closed, 1);
  assert.deepEqual([...store.records.get('app').entries.find(e => e.kind === 'file').data], [2]);
});

test('rename, truncation, deletion and metadata commit without losing another app', async t => {
  const FS = fixture(t), store = storage(), session = await open(FS, settings(store));
  write(FS, 'one', 'Documents/old', [1, 2, 3]); write(FS, 'two', 'Documents/keep', [7]); await session.flush();
  FS.rename(file('one', 'Documents/old'), file('one', 'Documents/new'));
  const fd = FS.open(file('one', 'Documents/new'), 'r+'); FS.ftruncate(fd.fd, 1); FS.close(fd);
  FS.chmod(file('one', 'Documents/new'), 0o640); FS.utime(file('one', 'Documents/new'), 1234000, 1234000);
  await session.flush();
  const e = store.records.get('one').entries.find(e => e.kind === 'file');
  assert.equal(e.path, 'Documents/new'); assert.equal(e.mode, 0o640); assert.equal(e.mtime, 1234000); assert.deepEqual([...e.data], [1]);
  FS.unlink(file('one', 'Documents/new')); FS.rmdir(file('one', 'Documents')); FS.rmdir(`${ROOT}/one`);
  await session.close(); assert.equal(store.records.has('one'), false); assert.equal(store.records.has('two'), true);
});

test('corrupt/unknown versions and failed hydration never overwrite storage', async t => {
  for (const record of [ { id: 'app', schema: 2, entries: [] }, { id: '../app', schema: 1, entries: [] },
    { id: 'app', schema: 1, entries: [{ path: 'Documents/../bad', kind: 'file', mode: 420, mtime: 0, data: new Uint8Array() }] } ]) {
    const FS = fixture(t), store = storage([record]); let releases = 0;
    await assert.rejects(open(FS, { ...settings(store), acquireLock: async () => () => releases++ }));
    assert.equal(releases, 1); assert.equal(store.commits.length, 0); assert.equal(FS.analyzePath(ROOT).exists, false);
  }
  const FS = fixture(t), store = storage(); FS.mkdirTree = () => { throw Error('hydrate failed'); };
  await assert.rejects(open(FS, settings(store)), /hydrate failed/); assert.equal(store.commits.length, 0);
});

test('symlink data is refused without deleting last committed save', async t => {
  const FS = fixture(t), store = storage(), session = await open(FS, settings(store));
  write(FS, 'app', 'Documents/progress', [1]); await session.flush();
  FS.symlink(file('app', 'Documents/progress'), file('app', 'Documents/link'));
  await assert.rejects(session.flush(), /symbolic links/);
  assert.equal(store.commits.length, 1);
  FS.unlink(file('app', 'Documents/link')); await session.close();
});

test('clean/read-only operations and tmp writes do not create save transactions', async t => {
  const FS = fixture(t), store = storage(), session = await open(FS, settings(store));
  write(FS, 'app', 'Documents/progress', [1]); await session.flush(); const count = store.commits.length;
  const fd = FS.open(file('app', 'Documents/progress'), 'r'); FS.close(fd); FS.readFile(file('app', 'Documents/progress'));
  write(FS, 'app', 'tmp/disposable', [9]); await session.flush(); assert.equal(store.commits.length, count);
  await session.close();
});

test('bad bounds, duplicate files and missing parent are rejected', () => {
  const entry = { path: 'Documents/a', kind: 'file', mode: 420, mtime: 0, data: new Uint8Array([1]) };
  assert.throws(() => validate([{ id: 'app', schema: 1, entries: [entry] }]), /parent/);
  assert.throws(() => validate([{ id: 'app', schema: 1, entries: [entry, entry] }]), /metadata/);
  assert.throws(() => validate([{ id: 'app', schema: 1, entries: [{ ...entry, mode: -1 }] }]), /metadata/);
});

class Target extends EventTarget { visibilityState = 'visible'; }
function emit(target, data) { const e = new Event('message'); e.data = data; target.dispatchEvent(e); }
test('page Stop awaits acknowledgement, failure is retryable, lifecycle hints are detached', async t => {
  const worker = new Target(), document = new Target(), window = new Target(), posts = [], statuses = [];
  worker.postMessage = data => posts.push(data.type); let stopped = 0, failed = 0;
  const client = attachSaveSession(worker, { document, window, onStatus: m => statuses.push(m), onStopped: () => stopped++, onStopFailed: () => failed++, timeoutMs: 20 });
  t.after(() => client.dispose());
  client.stop(); assert.equal(stopped, 0); assert.deepEqual(posts, ['save-stop']);
  emit(worker, { type: 'save-stop-failed', message: 'quota' }); assert.equal(failed, 1); assert.equal(stopped, 0);
  client.stop(); emit(worker, { type: 'save-stopped' }); assert.equal(stopped, 1);
  document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide'));
  assert.deepEqual(posts.slice(-2), ['save-flush', 'save-flush']);
  client.dispose(); window.dispatchEvent(new Event('pagehide')); assert.equal(posts.length, 4);
});


test('controller latches Stop before/during hydration and acknowledges only committed close', async t => {
  const { workerController } = globalThis.TouchHLESaves;
  const events = []; let opens = 0;
  const early = workerController(m => events.push(m.type), () => events.push('closed'), async () => { opens++; });
  early.handle({ type: 'save-stop' }); assert.equal(await early.prepare({}), false);
  assert.equal(opens, 0); assert.deepEqual(events, ['save-stopped', 'closed']);
  const FS = fixture(t), store = storage(), hydrate = deferred(), entered = deferred(), commit = deferred();
  const actualCommit = store.commit.bind(store);
  store.commit = async (...args) => { entered.resolve(); await commit.promise; return actualCommit(...args); };
  const output = [];
  const controller = workerController(m => output.push(m.type), () => output.push('closed'), async () => {
    await hydrate.promise; const session = await open(FS, settings(store)); write(FS, 'app', 'Documents/progress', [42]); return session;
  });
  const preparing = controller.prepare(FS); controller.handle({ type: 'save-stop' }); hydrate.resolve(); await entered.promise;
  assert.deepEqual(output, []); assert.equal(controller.handle({ type: 'pointer', kind: 0 }), true);
  commit.resolve(); assert.equal(await preparing, false);
  assert.deepEqual(output, ['save-stopped', 'closed']); assert.equal(store.commits.length, 1);
});

test('controller retry preserves dirty bytes and only closes once after newest revision commits', async t => {
  const FS = fixture(t), store = storage(), ended = deferred(), output = []; let fail = true, releases = 0, wrote = false;
  const actualCommit = store.commit.bind(store);
  store.commit = async (...args) => {
    if (fail) throw Error('quota');
    await actualCommit(...args);
    if (!wrote) { wrote = true; queueMicrotask(() => FS.writeFile(file('app', 'Documents/progress'), new Uint8Array([99]))); }
  };
  const controller = globalThis.TouchHLESaves.workerController(m => output.push(m.type), () => ended.resolve(),
    () => open(FS, { ...settings(store), acquireLock: async () => () => releases++ }));
  assert.equal(await controller.prepare(FS), true); write(FS, 'app', 'Documents/progress', [1]);
  await controller.finish({ type: 'save-stopped' });
  assert.deepEqual(output, ['save-stop-failed']); assert.equal(releases, 0); assert.equal(store.records.size, 0);
  fail = false;
  const finishing = controller.finish({ type: 'save-stopped' });
  await controller.finish({ type: 'error', message: 'simultaneous terminal callback' }); await finishing; await ended.promise;
  assert.deepEqual(output, ['save-stop-failed', 'save-stopped']); assert.equal(releases, 1);
  assert.deepEqual([...store.records.get('app').entries.find(e => e.kind === 'file').data], [99]);
});

test('failed hydration reports an error without a commit or guest admission', async t => {
  const FS = fixture(t), store = storage(), output = [];
  store.load = async () => { throw Error('read failed'); };
  const controller = globalThis.TouchHLESaves.workerController(m => output.push(m.type), () => output.push('closed'), () => open(FS, settings(store)));
  await assert.rejects(controller.prepare(FS), /read failed/);
  await controller.finish({ type: 'error', message: 'read failed' });
  assert.deepEqual(output, ['error', 'closed']); assert.equal(store.commits.length, 0);
});

test('stopping Worker closes synchronously after final flush, before asynchronous lock release completion', async t => {
  const FS = fixture(t), store = storage(), gate = deferred(), events = [];
  const session = await open(FS, { store, intervalMs: 0, acquireLock: async () => () => { events.push('release'); queueMicrotask(()=>events.push('yield')); return gate.promise; } });
  write(FS, 'app', 'Documents/proof', [7]);
  let settled=false;const close = session.close(() => events.push('close Worker')).then(()=>{settled=true;});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['release', 'close Worker', 'yield']);assert.equal(settled,false);
  assert.equal(store.commits.length, 1);
  gate.resolve(); await close;
});
