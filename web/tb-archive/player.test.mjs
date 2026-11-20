// SPDX-License-Identifier: MPL-2.0
// Session mocks only: no browser, AudioContext, Worker, or guest execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import '../external-open.js';
import { attachExternalLinks } from '../external-links.mjs';
import { attachSaveSession } from '../save-session.mjs';
import { installPlayer } from './player.mjs';
import { AudioBridge as ProductionAudioBridge } from '../audio.mjs';

// Exercise the production bounded reader/verifier without game-page startup.
const gameSource = readFileSync(new URL('./game.mjs', import.meta.url), 'utf8');
const makeReload = new Function('fetch', 'digest', 'game', 'baseURL',
  gameSource.slice(gameSource.indexOf('async function read('), gameSource.indexOf('async function moduleFrom('))
    .replaceAll('import.meta.url', 'baseURL') + '\nreturn reloadNative;');
const archive = new Uint8Array([1, 2, 3]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function boundedReload(fetch, digest = hash) {
  return makeReload(fetch, digest, { native: { sha256: hash(archive), bytes: archive.length } },
    'https://example.test/game.mjs');
}
test('native reload requires a complete bounded manifest before fetching', async () => {
  for (const native of [undefined, {}, { bytes: 3 }, { bytes: 3, sha256: 'bad' },
    { bytes: 0, sha256: hash(archive) }, { bytes: 160 * 1024 * 1024 + 1, sha256: hash(archive) }]) {
    const reload = makeReload(() => { throw Error('must not fetch'); }, hash, { native }, 'https://example.test/game.mjs');
    await assert.rejects(reload(), /native archive identity/);
  }
});
test('new page refuses a legacy helper before reading unverified game payloads', async () => {
  const { runInNewContext } = await import('node:vm');
  const helperBytes = new TextEncoder().encode('synthetic verified legacy helper');
  const game = { format:1, options:{headless:false,optionsHash:null}, helperHash:hash(helperBytes) };
  const requests = [], elements = new Map();
  const script = gameSource.replace("import { installPlayer } from './player.mjs';", '')
    .replaceAll('import.meta.url', "'https://example.test/game.mjs'")
    .replace('await import(url)', 'legacyHelper');
  assert.notEqual(script, gameSource);
  await runInNewContext(`(async () => { ${script} })()`, {
    location:{search:''}, URLSearchParams, URL:class extends URL { static createObjectURL(){return 'blob:helper';} static revokeObjectURL(){} },
    Blob, Uint8Array, TextDecoder, crypto,
    document:{querySelector(selector) {if(!elements.has(selector))elements.set(selector,{textContent:'',disabled:true});return elements.get(selector);}},
    legacyHelper:{checkIdentity(){},runtimeFiles:[]}, installPlayer(){throw Error('must not start player');},
    fetch:async url => {
      requests.push(new URL(url).pathname);
      if(requests.at(-1)==='/game.json')return new Response(JSON.stringify(game));
      if(requests.at(-1)==='/tb-archive-bridge.mjs')return new Response(helperBytes);
      throw Error('unexpected payload fetch');
    },
  });
  assert.deepEqual(requests,['/game.json','/tb-archive-bridge.mjs']);
  assert.equal(elements.get('#state').textContent,'Stopped');
  assert.match(elements.get('#status').textContent,/Incompatible payload verification helper/);
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function fixture({ persistence = false, pendingAudio = false, pendingLaunch = false, closeFails = false, baseline = false,
  reloadNative = async () => archive.slice() } = {}) {
  const run = { disabled: false }, stop = { disabled: true };
  const state = { textContent: 'Ready' }, log = { textContent: '' };
  const starts = [], launches = [], bridges = [], handles = [], inputs = [], events = [];
  let canvas;
  const makeCanvas = () => ({ cloneNode: makeCanvas, replaceWith(next) { canvas = next; },
    transferControlToOffscreen: () => ({ synthetic: true }) });
  canvas = makeCanvas();
  class AudioBridge extends ProductionAudioBridge {
    constructor() {
      super({ destination: {}, listener: {}, sampleRate: 48000, currentTime: 0,
        resume() {
          events.push('resume');
          const d = deferred(); starts.push(d);
          return pendingAudio ? d.promise : Promise.resolve();
        } });
      events.push('construct');
      this.closed = this.messages = 0; bridges.push(this);
    }
    close() { this.closed++; return closeFails ? Promise.reject(Error('close failed')) : Promise.resolve(); }
    handle() { this.messages++; }
  }
  const launch = () => {
    const d = deferred(); launches.push(d);
    const worker = Object.assign(new EventTarget(), { posts: [], transfers: [], postMessage(message, transfer = []) {
      this.transfers.push(transfer);
      // The mock canvas is plain data; native buffers use real transfer semantics.
      this.posts.push(structuredClone(message, { transfer: transfer.filter(item => item instanceof ArrayBuffer) }));
    } });
    const handle = { worker, destroyed: 0, destroy() { this.destroyed++; } };
    handles.push(handle);
    return pendingLaunch ? d.promise : Promise.resolve(handle);
  };
  class Element {
    constructor() { this.children = []; this.style = {}; }
    setAttribute() {} removeAttribute(name) { delete this[name]; }
    append(...children) { this.children.push(...children); for (const c of children) if (typeof c === 'object') c.parent = this; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
  }
  const document = { body: new Element(), createElement: () => new Element(), querySelector: () => canvas, addEventListener() {}, removeEventListener() {} };
  const source = archive.slice();
  installPlayer({ run, stop, state, log, document,
    persistence, game: { identity: {}, helperHash: 'synthetic', native: { sha256: hash(archive) } }, file: {}, source, precompiled: {}, baseline,
    reloadNative: signal => { events.push('reload'); return reloadNative(signal); },
    AudioBridge, attachSaveSession, attachExternalLinks, attachInput: (_canvas, send) => {
      inputs.push(send); let cancelled = false;
      return persistence ? { cancel() { if (!cancelled) { cancelled = true; send({ type: 'pointer', kind: 2, x: 0, y: 0 }); } } } : undefined;
    }, launch });
  return { run, stop, state, log, starts, launches, bridges, handles, inputs, source, events, document };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('every Play constructs and resumes audio synchronously, then awaits audio before reload', async () => {
  const request = deferred();
  const f = fixture({ pendingAudio: true, reloadNative: () => request.promise });
  const first = f.run.onclick();
  assert.deepEqual(f.events, ['construct', 'resume']);
  assert.equal(f.launches.length, 0);
  f.starts[0].resolve(); await first; f.stop.onclick();
  const next = f.run.onclick();
  assert.deepEqual(f.events, ['construct', 'resume', 'construct', 'resume']);
  await flush();
  assert.equal(f.events.includes('reload'), false);
  f.starts[1].resolve(); await flush();
  assert.equal(f.events.at(-1), 'reload');
  assert.equal(f.bridges[1].closed, 0); assert.equal(f.launches.length, 1);
  const fresh = archive.slice(); request.resolve(fresh); await next;
  assert.equal(f.state.textContent, 'Running'); assert.equal(fresh.byteLength, 0);
  f.stop.onclick();
});

test('Stop or audio rejection before a later reload preserves cancellation and permits retry', async () => {
  for (const stop of [false, true]) {
    const f = fixture({ pendingAudio: true });
    const first = f.run.onclick(); f.starts[0].resolve(); await first; f.stop.onclick();
    const old = f.run.onclick();
    assert.equal(f.starts.length, 2); assert.equal(f.events.includes('reload'), false);
    if (stop) f.stop.onclick();
    f.starts[1].reject(Error('audio failed')); await old;
    assert.equal(f.state.textContent, 'Stopped'); assert.equal(f.bridges[1].closed, 1);
    assert.equal(f.events.includes('reload'), false); assert.equal(f.handles.length, 1);
    if (stop) assert.doesNotMatch(f.log.textContent, /audio failed/);
    else assert.match(f.log.textContent, /audio failed/);
    const retry = f.run.onclick();
    assert.equal(f.starts.length, 3); assert.equal(f.events.at(-1), 'resume');
    f.starts[2].resolve(); await retry;
    assert.equal(f.state.textContent, 'Running');
    assert.equal(f.events.filter(event => event === 'reload').length, 1);
    f.stop.onclick();
    assert.ok(f.bridges.every(bridge => bridge.closed === 1));
  }
});

test('Stop during audio start ignores stale resolution/rejection and allows a fresh Play', async () => {
  for (const reject of [false, true]) {
    const f = fixture({ pendingAudio: true });
    const old = f.run.onclick();
    assert.equal(f.state.textContent, 'Starting');
    f.stop.onclick();
    assert.equal(f.state.textContent, 'Stopped'); assert.equal(f.bridges[0].closed, 1);
    const next = f.run.onclick();
    if (reject) f.starts[0].reject(Error('stale audio')); else f.starts[0].resolve({});
    await old;
    assert.equal(f.launches.length, 0); assert.equal(f.state.textContent, 'Starting');
    f.starts[1].resolve({}); await next;
    assert.equal(f.state.textContent, 'Running');
    assert.equal(f.bridges[1].closed, 0);
    f.stop.onclick(); assert.equal(f.bridges[1].closed, 1);
  }
});

test('Stop during launch destroys late handles without touching the newer session', async () => {
  for (const reject of [false, true]) {
    const f = fixture({ pendingLaunch: true });
    const old = f.run.onclick(); await flush(); f.stop.onclick();
    const next = f.run.onclick(); await flush();
    f.launches[1].resolve(f.handles[1]); await next;
    if (reject) f.launches[0].reject(Error('stale launch')); else f.launches[0].resolve(f.handles[0]);
    await old;
    assert.equal(f.handles[0].destroyed, reject ? 0 : 1);
    assert.equal(f.handles[1].destroyed, 0); assert.equal(f.state.textContent, 'Running');
    assert.doesNotMatch(f.log.textContent, /stale launch/);
    f.stop.onclick();
  }
});

test('queued old worker/audio/input/error callbacks cannot stop or change a newer Play', async () => {
  const f = fixture(); await f.run.onclick();
  const worker = f.handles[0].worker, oldMessage = worker.onmessage, oldError = worker.onerror;
  f.stop.onclick();
  assert.equal(worker.onmessage, null); assert.equal(worker.onerror, null);
  await f.run.onclick();
  oldMessage({ data: { type: 'audio' } }); oldMessage({ data: { type: 'exit', code: 1 } });
  oldError({ message: 'stale worker' }); f.inputs[0]({ type: 'pointer' });
  assert.equal(f.bridges[0].messages, 0); assert.equal(worker.posts.length, 1);
  assert.equal(f.state.textContent, 'Running'); assert.equal(f.handles[1].destroyed, 0);
  const active = f.handles[1].worker;
  active.onmessage({ data: { type: 'tb-ready' } });
  active.onmessage({ data: { type: 'log', message: 'TB archive disabled: synthetic' } });
  assert.equal(f.state.textContent, 'Running'); assert.match(f.log.textContent, /fallback/);
  active.onmessage({ data: { type: 'exit', code: 0 } });
  assert.equal(f.state.textContent, 'Stopped'); assert.match(f.log.textContent, /status 0/);
  assert.equal(f.bridges[1].closed, 1); assert.equal(f.handles[1].destroyed, 1);
  f.stop.onclick(); assert.equal(f.handles[1].destroyed, 1);
});

test('launch failure and rejected audio cleanup leave Play usable with diagnostic details', async () => {
  const f = fixture({ pendingLaunch: true, closeFails: true });
  const play = f.run.onclick(); await flush();
  f.launches[0].reject(Error('synthetic launch failure')); await play; await flush();
  assert.equal(f.state.textContent, 'Stopped'); assert.equal(f.run.disabled, false); assert.equal(f.stop.disabled, true);
  assert.equal(f.bridges[0].closed, 1);
  assert.match(f.log.textContent, /synthetic launch failure/); assert.match(f.log.textContent, /Audio cleanup/);
});


test('late audio cleanup failure cannot append diagnostics to a new session', async () => {
  const f = fixture(); await f.run.onclick();
  const cleanup = deferred();
  f.bridges[0].close = () => cleanup.promise;
  f.stop.onclick(); await f.run.onclick();
  const before = f.log.textContent;
  cleanup.reject(Error('stale cleanup')); await flush();
  assert.equal(f.log.textContent, before); assert.equal(f.state.textContent, 'Running');
  f.stop.onclick();
});

test('first Play detaches the full buffer; second Play reloads bytes with the expected digest', async () => {
  let fetches = 0, reloaded;
  const reload = boundedReload(async (url, options) => {
    fetches++;
    assert.equal(url.href, 'https://example.test/native.tb');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.signal.aborted, false);
    return new Response(archive);
  });
  const f = fixture({ reloadNative: async signal => (reloaded = await reload(signal)) });
  const original = f.source.buffer;
  await f.run.onclick();
  assert.equal(fetches, 0);
  assert.equal(original.byteLength, 0); assert.equal(f.source.byteLength, 0);
  assert.equal(f.handles[0].worker.transfers[0][1], original);
  assert.deepEqual(new Uint8Array(f.handles[0].worker.posts[0].tbArchive.source), archive);
  assert.equal(f.handles[0].worker.posts[0].tbArchive.sourceSha256, hash(archive));
  f.stop.onclick(); await f.run.onclick();
  assert.equal(fetches, 1); assert.equal(reloaded.byteLength, 0);
  assert.equal(f.handles[1].worker.transfers[0][1], reloaded.buffer);
  assert.deepEqual(new Uint8Array(f.handles[1].worker.posts[0].tbArchive.source), archive);
  f.stop.onclick();
  assert.ok(f.handles.every(handle => handle.destroyed === 1));
  assert.ok(f.bridges.every(bridge => bridge.closed === 1));
});

test('baseline never transfers or reloads native bytes', async () => {
  const f = fixture({ baseline: true, reloadNative: () => { throw Error('unexpected reload'); } });
  for (let i = 0; i < 2; i++) {
    await f.run.onclick();
    const worker = f.handles[i].worker;
    assert.deepEqual(worker.posts[0].tbArchive, { capture: false });
    assert.equal(worker.transfers[0].length, 1);
    assert.equal(f.source.byteLength, archive.length);
    f.stop.onclick();
  }
});

test('failed length, bounded fetch, or network reload leaves no worker/audio and permits retry', async () => {
  for (const response of [() => new Response(new Uint8Array([1])),
    () => new Response(archive, { headers: { 'content-length': 160 * 1024 * 1024 + 1 } }),
    () => { throw Error('network failed'); }]) {
    let failed = true;
    const f = fixture({ reloadNative: boundedReload(async () => failed ? response() : new Response(archive)) });
    await f.run.onclick(); f.stop.onclick();
    await f.run.onclick();
    assert.equal(f.state.textContent, 'Stopped'); assert.equal(f.run.disabled, false);
    assert.equal(f.handles.length, 1); assert.equal(f.handles[0].destroyed, 1);
    assert.equal(f.bridges.length, 2); assert.ok(f.bridges.every(bridge => bridge.closed === 1));
    assert.match(f.log.textContent, /length mismatch|exceeds bound|network failed/);
    failed = false;
    await f.run.onclick(); assert.equal(f.state.textContent, 'Running');
    f.stop.onclick();
    assert.ok(f.handles.every(handle => handle.destroyed === 1));
    assert.ok(f.bridges.every(bridge => bridge.closed === 1));
  }
});

test('Stop aborts native fetch before another Play and ignores late resolution or rejection', async () => {
  for (const reject of [false, true]) {
    const requests = [];
    const f = fixture({ reloadNative: signal => {
      const d = deferred(); requests.push({ ...d, signal }); return d.promise;
    } });
    await f.run.onclick(); f.stop.onclick();
    const old = f.run.onclick();
    assert.equal(f.events.at(-1), 'resume');
    assert.equal(f.handles.length, 1); assert.equal(f.bridges.length, 2);
    await flush();
    f.stop.onclick(); assert.equal(requests[0].signal.aborted, true);
    assert.equal(f.bridges[1].closed, 1);
    const next = f.run.onclick();
    assert.equal(f.events.at(-1), 'resume');
    await flush();
    const fresh = archive.slice(); requests[1].resolve(fresh); await next;
    const stale = archive.slice();
    if (reject) requests[0].reject(Error('stale reload')); else requests[0].resolve(stale);
    await old;
    assert.equal(stale.byteLength, archive.length); assert.equal(fresh.byteLength, 0);
    assert.equal(requests[1].signal.aborted, false);
    assert.equal(f.state.textContent, 'Running'); assert.doesNotMatch(f.log.textContent, /stale reload/);
    assert.equal(f.handles.length, 2); assert.equal(f.bridges.length, 3);
    assert.equal(f.bridges[2].closed, 0);
    f.stop.onclick();
    assert.ok(f.handles.every(handle => handle.destroyed === 1));
    assert.ok(f.bridges.every(bridge => bridge.closed === 1));
  }
});

test('production reload aborts a streaming fetch and leaves hashing to the consuming worker', async () => {
  let cancelled = false, started;
  const ready = deferred();
  const f = fixture({ reloadNative: boundedReload(async (_url, { signal }) => {
    started = signal;
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(archive.slice(0, 1));
        signal.addEventListener('abort', () => { cancelled = true; controller.error(signal.reason); }, { once: true });
        ready.resolve();
      }
    }));
  }) });
  await f.run.onclick(); f.stop.onclick();
  const play = f.run.onclick(); await ready.promise; await flush();
  f.stop.onclick(); await play;
  assert.equal(started.aborted, true); assert.equal(cancelled, true);
  assert.equal(f.state.textContent, 'Stopped');
  assert.equal(f.handles.length, 1); assert.equal(f.bridges.length, 2);
  assert.equal(f.handles[0].destroyed, 1); assert.ok(f.bridges.every(bridge => bridge.closed === 1));

  const changed = new Uint8Array([3, 2, 1]);
  const reload = boundedReload(async () => new Response(changed), () => { throw Error('page must not hash native bytes'); });
  assert.deepEqual(await reload(new AbortController().signal), changed);
  // Changed contents are rejected by the worker before runtime execution (bridge.test).
});


test('persistent worker error releases input then requests Stop without destroying recoverable saves', async () => {
  const f = fixture({ persistence: true }); await f.run.onclick();
  const handle = f.handles[0], worker = handle.worker;
  worker.onerror({ message: 'synthetic asynchronous runtime error' });
  assert.equal(handle.destroyed, 0);
  assert.deepEqual(worker.posts.slice(-2).map(p => [p.type, p.kind]), [['pointer', 2], ['save-stop', undefined]]);
  const fail = new Event('message'); fail.data = { type: 'save-stop-failed', message: 'quota' }; worker.dispatchEvent(fail);
  assert.equal(handle.destroyed, 0); assert.equal(f.stop.disabled, false);
  f.stop.onclick();
  const done = new Event('message'); done.data = { type: 'save-stopped' }; worker.dispatchEvent(done);
  assert.equal(handle.destroyed, 1); assert.equal(f.stop.disabled, true);
});


test('pending external link preserves mocked audio and Worker until acknowledged save Stop', async () => {
  const f = fixture({ persistence: true }); await f.run.onclick();
  const worker = f.handles[0].worker;
  const start = worker.posts.find(p => p.type === 'start');
  worker.dispatchEvent(new MessageEvent('message', { data: { type: 'external-open', session: start.externalSession, id: 1, url: 'https://example.invalid/?x=%3C' } }));
  assert.equal(f.document.body.children.length, 1);
  assert.equal(f.bridges[0].closed, 0);
  f.stop.onclick();
  assert.equal(f.document.body.children.length, 0);
  assert.equal(f.bridges[0].closed, 0); // save transaction still pending
  assert.equal(worker.posts.at(-1).type, 'save-stop');
  worker.dispatchEvent(new MessageEvent('message', { data: { type: 'save-stop-failed', message: 'retry storage' } }));
  assert.equal(f.bridges[0].closed, 0); assert.equal(f.stop.disabled, false);
  worker.dispatchEvent(new MessageEvent('message', { data: { type: 'external-open', session: start.externalSession, id: 2, url: 'https://late.invalid' } }));
  assert.equal(f.document.body.children.length, 0);
  f.stop.onclick();
  worker.dispatchEvent(new MessageEvent('message', { data: { type: 'save-stopped' } }));
  assert.equal(f.bridges[0].closed, 1); assert.equal(f.state.textContent, 'Stopped');
});
