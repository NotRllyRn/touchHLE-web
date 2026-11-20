// SPDX-License-Identifier: MPL-2.0
// Private diagnostic capture; original IPA remains ignored/local. No timing claim.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, writeFile, mkdir, open, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { runtimeFiles, LIMITS } from './tb-archive-bridge.mjs';
import { captureArguments, requireReplayEvidence } from './capture-policy.mjs';
const { runtimePath, ipaPath, outputPath, mode, sourcePath, replay, collectPortable } = captureArguments(process.argv.slice(2));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = resolve(outputPath), base = pathToFileURL(resolve(runtimePath) + sep);
await mkdir(output); // refuse overwrite
async function boundedInput(path, limit) {
  const info = await stat(path);
  assert(info.isFile() && info.size > 0 && info.size <= limit, 'Invalid input size');
  const bytes = await readFile(path);
  assert(bytes.length === info.size && bytes.length <= limit, 'Input changed while reading');
  return bytes;
}
const ipa = await boundedInput(ipaPath, 256 * 1024 * 1024), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = { ipa: hash(ipa), files: {} };
for (const name of runtimeFiles) identity.files[name] = hash(await readFile(new URL(name, base)));
const native = sourcePath ? await boundedInput(sourcePath, LIMITS.wire) : null;
const sourceHash = native ? hash(native) : null;
const logs = [], errors = [], requests = [];
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, 'http://127.0.0.1').pathname.slice(1);
  requests.push([req.method, name]);
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method !== 'GET') throw Error('only GET');
    if (!name) { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Private archive capture</title><canvas id="canvas" width="1024" height="768"></canvas><button id="run">Start</button>'); return; }
    if (name === 'game.ipa') { res.end(ipa); return; }
    if (name === 'native.tb' && native) { res.end(native); return; }
    if (!/^[\w.-]+$/.test(name)) throw Error('invalid path');
    if (/\.(js|mjs)$/.test(name)) res.setHeader('Content-Type', 'text/javascript');
    if (name.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
    res.end(await readFile(new URL(name, base)));
  } catch { res.statusCode = 404; res.end('not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
let capturedBytes = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  page.on('pageerror', error => { errors.push(String(error)); console.error(error); });
  page.on('console', message => {
    const line = message.text(); logs.push({ time: Date.now(), line });
    if (line.startsWith('TB ') || line.includes('ERROR') || line.includes('AOT capture limit')) console.log(line);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async ({ identity, mode, collectPortable, sourceHash }) => {
    const { launch } = await import('./launch.mjs');
    const { AudioBridge } = await import('./audio.mjs');
    const { attachInput } = await import('./input.mjs');
    const file = await (await fetch('./game.ipa')).blob();
    const source = sourceHash ? await (await fetch('./native.tb')).arrayBuffer() : undefined;
    const handle = mode === 'baseline' ? { worker: new Worker('./runtime-worker.js'), destroy() { this.worker.terminate(); } } : await launch('./', identity);
    self.handle = handle; self.native = null; self.keys = new Set(); self.abi = null; self.stats = [];
    self.failed = null; self.archiveError = null; self.ready = null;
    const canvas = document.querySelector('#canvas');
    attachInput(canvas, message => handle.worker.postMessage(message));
    document.querySelector('#run').onclick = async () => {
      const audio = self.audio = new AudioBridge();
      const audioClock = await audio.start();
      handle.worker.onmessage = ({ data }) => {
        if (data.type === 'audio') { audio.handle(data); return; }
        if (data.type === 'aot-block') {
          if (self.abi && self.abi !== data.abi) throw Error('capture ABI mismatch');
          self.abi = data.abi; self.keys.add(data.key); return;
        }
        if (data.type === 'tb-ready') { self.ready = data; return; }
        if (data.type === 'tb-archive') { self.native = data.buffer; console.log('TB exported ' + data.buffer.byteLength); return; }
        if (data.type === 'tb-stats') { self.stats.push({ time: performance.now(), ...data }); if (self.stats.length > 10000) self.stats.shift(); return; }
        if (data.type === 'error' || data.type === 'exit') self.failed = data;
        if (data.type === 'log' && /^TB archive(?::| disabled:)/.test(data.message)) self.archiveError = data.message;
        console.log('WORKER ' + JSON.stringify(data));
      };
      handle.worker.onerror = e => { self.failed = { message: e.message }; console.log('ERROR ' + e.message); };
      const offscreen = canvas.transferControlToOffscreen();
      self.startTime = performance.now();
      handle.worker.postMessage({ type: 'start', file, canvas: offscreen, audioClock, cpuBackend: 'jit', jitThreshold: 32,
        ...(mode !== 'baseline' ? { tbIdentity: identity, tbArchive: { capture: mode === 'capture', ...(source ? { source, sourceSha256: sourceHash } : {}) } } : {}),
        aotCapture: collectPortable }, [offscreen, ...(source ? [source] : [])]);
    };
  }, { identity, mode, collectPortable, sourceHash });
  await page.locator('#run').click();
  const started = Date.now(), seconds = Number(process.env.RUN_SECONDS || 180);
  const scheduled = JSON.parse(process.env.CLICKS || '[]');
  const sent = new Set(); let handled = 0;
  for (let t = 0; t < seconds; t += 10) {
    await page.waitForTimeout(Math.min(10000, seconds * 1000 - t * 1000));
    let manual = [];
    try { manual = JSON.parse(await readFile(`${output}/control.json`, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const due = scheduled.filter(action => action.second <= (Date.now() - started) / 1000 && !sent.has(action));
    for (const action of due) sent.add(action);
    for (const action of [...due, ...manual.slice(handled)]) {
      const rect = await page.locator('#canvas').boundingBox();
      await page.mouse.click(rect.x + rect.width * action.x, rect.y + rect.height * action.y);
      console.log('INPUT ' + JSON.stringify(action));
    }
    handled = manual.length;
    await page.evaluate(() => self.handle.worker.postMessage({ type: 'tb-stats' }));
    const state = await page.evaluate(() => ({ failed: self.failed, archiveError: self.archiveError, ready: self.ready, stats: self.stats.at(-1), keys: self.keys.size }));
    console.log(JSON.stringify({ elapsed: (Date.now() - started) / 1000, ...state }));
    if (t % 30 === 0) await page.locator('#canvas').screenshot({ path: `${output}/canvas-${t + 10}.png` });
    if (state.failed) throw Error(JSON.stringify(state.failed));
    if (replay) {
      assert(!state.archiveError, state.archiveError || 'Archive replay failed');
      if (state.ready) assert.equal(state.ready.sourceHash, sourceHash, 'Worker source fingerprint mismatch');
    }
  }
  await writeFile(`${output}/stats.json`, JSON.stringify(await page.evaluate(() => self.stats)));
  if (collectPortable) {
    const capture = await page.evaluate(() => ({ format: 1, abi: self.abi, keys: [...self.keys] }));
    let replayEvidence;
    if (replay) {
      const previous = await page.evaluate(() => self.stats.at(-1)?.time);
      await page.evaluate(() => self.handle.worker.postMessage({ type: 'tb-stats' }));
      await page.waitForFunction(previous => self.failed || self.archiveError ||
        (self.stats.at(-1)?.time !== previous && self.stats.at(-1)?.busy === false), previous, { timeout: 30000 });
      replayEvidence = await page.evaluate(() => ({ ready: self.ready, stats: self.stats.at(-1),
        failed: self.failed, archiveError: self.archiveError }));
      requireReplayEvidence({ ...replayEvidence, capture }, sourceHash);
      // Write the exact snapshot served to the worker, not a reread or native export.
      await writeFile(`${output}/native.tb`, native, { flag: 'wx' });
      capturedBytes = native.length;
      await writeFile(`${output}/replay.json`, JSON.stringify({ ...replayEvidence, sourceHash,
        sourceBytes: native.length, nativeCapture: false, portableCapture: true }, null, 2));
    }
    await writeFile(`${output}/capture.json`, JSON.stringify({ ...capture, identity,
      launchOptions: { headless: false, optionsHash: null },
      helperSha256: hash(await readFile(new URL('tb-archive-bridge.mjs', base))),
      ...(replay ? { nativeSource: { sha256: sourceHash, bytes: native.length } } : {}) }));
  }
  if (mode === 'capture') {
    await page.evaluate(() => self.handle.worker.postMessage({ type: 'tb-export' }));
    await page.waitForFunction(() => self.native !== null || self.failed || self.archiveError, null, { timeout: 60000 });
    capturedBytes = await page.evaluate(() => self.native?.byteLength ?? 0);
    assert(capturedBytes > 0, await page.evaluate(() => self.archiveError) || 'native export required');
    const f = await open(`${output}/native.tb`, 'wx');
    try {
      for (let offset = 0; offset < capturedBytes; offset += 1024 * 1024) {
        const chunk = await page.evaluate(offset => {
          const view = new Uint8Array(self.native, offset, Math.min(1024 * 1024, self.native.byteLength - offset));
          let str = ''; for (let i = 0; i < view.length; i += 32768) str += String.fromCharCode(...view.subarray(i, i + 32768));
          return btoa(str);
        }, offset);
        await f.write(Buffer.from(chunk, 'base64'));
      }
    } finally { await f.close(); }
  }
  const stats = await page.evaluate(() => self.stats);
  await writeFile(`${output}/stats.json`, JSON.stringify(stats));
  await page.locator('#canvas').screenshot({ path: `${output}/final.png` });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ mode, capturedBytes, lastStats: stats.at(-1) }));
} finally {
  await writeFile(`${output}/run.json`, JSON.stringify({ mode, identity, sourceHash, chromium: browser.version(), args: ['--no-sandbox'], capturedBytes, errors, requests, logs }, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
