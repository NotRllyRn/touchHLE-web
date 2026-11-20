// SPDX-License-Identifier: MPL-2.0
// Original pixel regression through the pinned legacy GL adapter. Requires the
// repository Emscripten/Playwright setup; no proprietary game input is used.
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.argv[2] || 'target/gl-buffers-test');
assert(output.startsWith(resolve(root, 'target') + sep), 'Use a new directory under target/');
const parent = await realpath(resolve(output, '..'));
assert(parent === resolve(root, 'target') || parent.startsWith(resolve(root, 'target') + sep));
await mkdir(output); // Preserve failures; never overwrite a previous run.
const log = [];
try {
  const build = execFileSync('emcc', ['web/fixtures/gl-buffers/main.c', '-O1',
    '-sUSE_SDL=2', '-sLEGACY_GL_EMULATION=1', '-sGL_UNSAFE_OPTS=0',
    '-sMAX_WEBGL_VERSION=2', '-sALLOW_MEMORY_GROWTH=1', '-sEXIT_RUNTIME=1', '-sASSERTIONS=1',
    '-sEXPORTED_FUNCTIONS=["_main","_malloc","_free"]', '--js-library', 'web/emscripten-gl.js',
    '--post-js', 'web/emscripten-gl-init.js', '-o', resolve(output, 'fixture.js')],
  { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  await writeFile(resolve(output, 'build.log'), build);
} catch (error) {
  await writeFile(resolve(output, 'build.log'), String(error.stdout || '') + String(error.stderr || ''));
  throw error;
}
await writeFile(resolve(output, 'fixture.html'), `<!doctype html>
<canvas id="canvas" width="64" height="64"></canvas>
<script>var Module={canvas:document.querySelector('#canvas'),onExit:code=>{window.fixtureExit=code},onAbort:reason=>{window.fixtureExit=String(reason)}};</script>
<script src="fixture.js"></script>`);
const server = http.createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://localhost').pathname;
    assert(['/fixture.html', '/fixture.js', '/fixture.wasm'].includes(name));
    res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : name.endsWith('.js') ? 'text/javascript' : 'text/html');
    res.end(await readFile(resolve(output, '.' + name)));
  } catch { res.statusCode = 404; res.end(); }
});
let browser;
try {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', m => log.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', e => log.push(`PAGE ERROR: ${e}`));
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture.html`);
  await page.waitForFunction(() => window.fixtureExit !== undefined, null, { timeout: 30000 });
  const exit = await page.evaluate(() => window.fixtureExit);
  await page.screenshot({ path: resolve(output, 'result.png') });
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ exit, chromium: browser.version(), log }, null, 2));
  assert.equal(exit, 0, log.join('\n'));
  assert(log.some(line => line.includes('PASS split buffer fixture')));
  assert(!log.some(line => line.startsWith('PAGE ERROR:')));
  console.log(log.filter(line => line.startsWith('log:')).join('\n'));
} finally {
  await browser?.close();
  await new Promise(r => server.close(r));
  await writeFile(resolve(output, 'browser.log'), log.join('\n') + '\n');
}
