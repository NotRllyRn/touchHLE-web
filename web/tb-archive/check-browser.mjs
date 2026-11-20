// SPDX-License-Identifier: MPL-2.0
// Repository Playwright workflow: real verified worker, fresh browser each mode.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve, sep, join } from 'node:path';
import { createHash } from 'node:crypto';
import { runtimeFiles } from './tb-archive-bridge.mjs';
const [mode, dist, outputPath] = process.argv.slice(2);
assert(['restore', 'capture', 'disabled', 'reject', 'ipa-mismatch', 'archive-mismatch'].includes(mode) && dist && outputPath,
  'Usage: node web/tb-archive/check-browser.mjs capture|restore|disabled|reject|ipa-mismatch|archive-mismatch RUNTIME_DIRECTORY OUTPUT_DIRECTORY');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = pathToFileURL(resolve(dist) + sep);
const output = resolve(outputPath);
await mkdir(output, { recursive: true });
const ipa = await readFile(new URL('../../target/browser-hle-test.ipa', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = { ipa: hash(ipa), files: {} };
for (const name of runtimeFiles) identity.files[name] = hash(await readFile(new URL(name, base)));
const sourceSha256 = ['restore', 'archive-mismatch'].includes(mode)
  ? hash(await readFile(join(output, 'runtime-roundtrip.bin'))) : undefined;
const errors = [], requests = [];
let page, messages = [], failure;
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, 'http://127.0.0.1').pathname.slice(1);
  requests.push([req.method, name]);
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method !== 'GET') throw Error('only GET');
    if (!name) { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Archive fixture</title>'); return; }
    if (name === 'fixture.ipa') {
      const bytes = Buffer.from(ipa);
      if (mode === 'ipa-mismatch') bytes[0] ^= 128;
      res.end(bytes); return;
    }
    if (name === 'native.tb') {
      const bytes = await readFile(join(output, 'runtime-roundtrip.bin'));
      if (['reject', 'archive-mismatch'].includes(mode)) bytes[0] ^= 128; // Preserve the captured file.
      res.end(bytes); return;
    }
    if (!/^[\w.-]+$/.test(name)) throw Error('invalid path');
    if (/\.(js|mjs)$/.test(name)) res.setHeader('Content-Type', 'text/javascript');
    if (name.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
    res.end(await readFile(new URL(name, base)));
  } catch { res.statusCode = 404; res.end('not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  page = await browser.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(origin);
  await page.evaluate(async ({ identity, mode, sourceSha256 }) => {
    const { launch } = await import('./launch.mjs');
    const handle = await launch('./', identity);
    self.handle = handle;
    self.messages = [];
    handle.worker.onmessage = event => self.messages.push(event.data);
    handle.worker.onerror = event => self.messages.push({ type: 'error', message: event.message });
    const file = await (await fetch('./fixture.ipa')).blob();
    const source = ['restore', 'reject', 'archive-mismatch'].includes(mode) ? await (await fetch('./native.tb')).arrayBuffer() : undefined;
    handle.worker.postMessage({ type: 'start', file, headless: true, cpuBackend: 'jit', jitThreshold: 1,
      tbIdentity: identity, tbArchive: { capture: mode === 'capture', ...(source ? { source } : {}),
        ...(sourceSha256 ? { sourceSha256 } : {}) } }, source ? [source] : []);
  }, { identity, mode, sourceSha256 });
  await page.waitForFunction(() => self.messages.some(m => ['exit', 'error'].includes(m.type)), null, { timeout: 90000 });
  messages = await page.evaluate(() => self.messages);
  assert.deepEqual(errors, []);
  if (['ipa-mismatch', 'archive-mismatch'].includes(mode)) {
    assert.equal(messages.length, 1, 'fingerprint failure must precede runtime/guest output');
    assert.equal(messages[0].type, 'error');
    assert.match(messages[0].message, mode === 'ipa-mismatch' ? /IPA fingerprint mismatch/ : /Native archive fingerprint mismatch/);
    console.log(JSON.stringify({ mode, rejectedBeforeRuntime: true, requests: requests.length }));
  } else {
    assert(!messages.some(m => m.type === 'error'), JSON.stringify(messages.slice(-8)));
    assert(messages.some(m => m.type === 'log' && m.message.includes('PASS real touchHLE ARM guest called puts and exit')));
    const active = messages.filter(m => m.type === 'tb-stats' && m.status === 2 && !m.busy);
    if (['restore', 'capture'].includes(mode)) assert(active.length, 'must seal through verified worker');
    if (mode === 'capture') assert(active.some(m => m.captures > 0));
    if (mode === 'restore') {
      assert(active.some(m => m.imported === 1 && m.restores > 0));
      assert.equal(active.at(-1).frontendCalls, 0);
    }
    if (mode === 'disabled') assert(!active.length, 'disabled launch must not bind an archive');
    if (mode === 'reject') {
      const stats = messages.filter(m => m.type === 'tb-stats' && !m.busy);
      assert(stats.some(m => m.status === 3), 'corrupt archive must reach rejected state');
      assert(stats.every(m => m.imported === 0 && m.restores === 0));
      assert(!active.length, 'rejected archive must never be admitted');
    }
    assert(messages.some(m => m.type === 'exit' && m.code === 0));
    console.log(JSON.stringify({ mode, chromium: browser.version(), lastActive: active.at(-1), requests: requests.length }));
  }
  assert(requests.every(r => r[0] === 'GET'));
  await page.evaluate(() => self.handle.destroy());
} catch (error) {
  failure = String(error);
  throw error;
} finally {
  if (page && !messages.length) messages = await page.evaluate(() => self.messages ?? []).catch(() => []);
  try {
    await writeFile(join(output, `browser-${mode}.json`), JSON.stringify({
      mode, identity, chromium: browser.version(), args: ['--no-sandbox'],
      messages, errors, requests, failure,
    }, null, 2));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
