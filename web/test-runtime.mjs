// SPDX-License-Identifier: MPL-2.0
// Requires the built runtime, generated original IPA fixture, and static server.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
// Diagnostic launch flags must be recorded alongside performance results.
const browserArgs = JSON.parse(process.env.BROWSER_ARGS || '[]');
if (!Array.isArray(browserArgs) || browserArgs.some(arg => typeof arg !== 'string'))
  throw new Error('BROWSER_ARGS must be a JSON array of strings');
console.log('Browser extra arguments:', JSON.stringify(browserArgs));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', ...browserArgs] });
try {
  const page = await browser.newPage();
  const requests = [], errors = [];
  page.on('request', request => requests.push([request.method(), request.url()]));
  page.on('pageerror', error => errors.push(error.message));
  const origin = process.env.TEST_URL || 'http://127.0.0.1:8765';
  await page.goto(origin);
  const fixture = process.env.TEST_MIPMAP ? 'mipmap' : process.env.TEST_LIGHT_SPOT ? 'light-spot' : process.env.TEST_LIGHT_ATTENUATION ? 'light-attenuation' : process.env.TEST_MAPPED ? 'mapped' : process.env.TEST_FOG ? 'fog' : process.env.TEST_LIGHTING ? 'lighting' : process.env.TEST_POINT_PARAMETERS ? 'point-parameters' : process.env.TEST_POINTS ? 'points' : process.env.TEST_COMBINE ? 'combine' : process.env.TEST_PRESENT_BUFFERS ? 'present-buffers' : process.env.TEST_PRESENT ? 'present' : process.env.TEST_BUFFERS ? 'buffers' : process.env.TEST_GRAPHICS ? 'graphics' : 'hle';
  if (fixture === 'hle') await page.locator('#headless').check();
  await page.locator('#ipa').setInputFiles(fileURLToPath(new URL(`../target/browser-${fixture}-test.ipa`, import.meta.url)));
  await page.waitForFunction(() => !document.querySelector('#run').disabled);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.locator('#run').click();
    await page.waitForFunction(() => document.querySelector('#stop').disabled, null, { timeout: 60000 });
    const output = await page.locator('#status').innerText();
    assert.match(output, /CPU emulation begins now/);
    assert.match(output, /PASS real touchHLE ARM guest called puts and exit/);
    assert.match(output, /Guest exited with status 0/);
    assert.doesNotMatch(output, /panicked|Runtime failed|native code called abort/);
    if (new URL(origin).searchParams.get('cpu') === 'jit') {
      const stats = JSON.parse(output.match(/CPU JIT (\{[^\n]+\})/)[1]);
      assert.ok(stats.compiled > 0, 'Must compile actual guest blocks');
      assert.equal(stats.failed, 0, stats.lastFailure);
    }
    console.log(`PASS actual HLE IPA run ${attempt + 1}`);
  }
  assert.deepEqual(errors, []);
  assert(requests.every(([method, url]) => method === 'GET' && new URL(url).origin === new URL(origin).origin));
  console.log(`PASS local static GET-only traffic; Chromium ${browser.version()}`);
} finally { await browser.close(); }
