// SPDX-License-Identifier: MPL-2.0
// Optional integration check: install Playwright separately; never needs an IPA in Git.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const requests = [], errors = [];
  page.on('request', request => requests.push({ method: request.method(), url: request.url() }));
  page.on('pageerror', error => errors.push(error.message));
  const url = process.env.TEST_URL || 'http://127.0.0.1:8765';
  await page.goto(url);
  if (process.env.TEST_SHARED_CPU) {
    const result = await page.evaluate(() => new Promise((resolve, reject) => {
      const worker = new Worker('./shared-cpu-worker.js');
      const warnings = [];
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error('Shared CPU test timed out'));
      }, 30000);
      const finish = callback => {
        clearTimeout(timeout);
        worker.terminate();
        callback();
      };
      worker.onmessage = ({ data }) => {
        if (data.warning) { warnings.push(data.warning); return; }
        if (data.error) finish(() => reject(new Error(data.error)));
        else if (data.message?.startsWith('PASS ')) {
          finish(() => resolve({ message: data.message, warnings }));
        }
      };
      worker.onerror = event => finish(() => reject(new Error(event.message)));
    }));
    assert.match(result.message, /^PASS source-built Unicorn\/Rust/);
    console.log(result);
  }
  assert.equal(await page.evaluate(() => new Promise((resolve, reject) => {
    const worker = new Worker('./ipa-worker.mjs', { type: 'module' });
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Memory check timed out'));
    }, 15000);
    worker.onmessage = ({ data }) => {
      clearTimeout(timeout);
      worker.terminate();
      resolve(data.ok);
    };
    worker.onerror = event => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage({ type: 'memory-check' });
  })), true);
  if (process.env.TEST_FIBERS) for (const adapter of [false, true]) {
    const result = await page.evaluate(adapter => new Promise((resolve, reject) => {
      const worker = new Worker(`./fiber-worker.js${adapter ? '?adapter' : ''}`);
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error('Fiber test timed out'));
      }, 15000);
      const finish = callback => {
        clearTimeout(timeout);
        worker.terminate();
        callback();
      };
      worker.onmessage = ({ data }) => finish(() =>
        data.error ? reject(new Error(data.error)) : resolve(data.message));
      worker.onerror = event => finish(() => reject(new Error(event.message)));
    }), adapter);
    assert.match(result, adapter ? /^PASS actual fiber adapter/ : /^PASS Rust\/C nested fiber reentry/);
    console.log(result);
  }
  await page.locator('#test').click();
  await page.waitForFunction(() => document.querySelector('#stop').disabled);
  assert.doesNotMatch(await page.locator('#status').innerText(), /^FAIL|^Worker failed/im);
  assert.match(await page.locator('#status').innerText(), /PASS/);
  await page.locator('#ipa').setInputFiles({ name: 'invalid.ipa', mimeType: 'application/octet-stream', buffer: Buffer.from('invalid') });
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('IPA rejected:'));
  if (process.env.TEST_IPA) {
    await page.locator('#ipa').setInputFiles(process.env.TEST_IPA);
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Validated, not executed.'), null, { timeout: 60000 });
    console.log(await page.locator('#status').innerText());
    await page.locator('#ipa').setInputFiles(process.env.TEST_IPA);
    await page.locator('#stop').click();
    assert.match(await page.locator('#status').innerText(), /^Stopped/);
    await page.locator('#ipa').setInputFiles(process.env.TEST_IPA);
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Validated, not executed.'), null, { timeout: 60000 });
  }
  assert.deepEqual(errors, []);
  assert(requests.every(request => request.method === 'GET' && new URL(request.url).origin === new URL(url).origin));
  console.log(JSON.stringify({ browser: browser.version(), requests, errors, passed: true }, null, 2));
} finally {
  await browser.close();
}
