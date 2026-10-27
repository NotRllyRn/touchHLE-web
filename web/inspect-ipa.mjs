// SPDX-License-Identifier: MPL-2.0
// Local graphical diagnostics, not a gameplay acceptance test.
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ipa = process.argv[2];
if (!ipa) throw new Error('Usage: node web/inspect-ipa.mjs /absolute/path/to/app.ipa');
const output = process.env.INSPECTION_DIR || fileURLToPath(new URL('../target/browser-inspection/', import.meta.url));
await mkdir(output, { recursive: true });
// Diagnostic launch flags must be recorded alongside performance results.
const browserArgs = JSON.parse(process.env.BROWSER_ARGS || '[]');
if (!Array.isArray(browserArgs) || browserArgs.some(arg => typeof arg !== 'string'))
  throw new Error('BROWSER_ARGS must be a JSON array of strings');
console.log('Browser extra arguments:', JSON.stringify(browserArgs));
const args = ['--no-sandbox', ...browserArgs];
if (process.env.INSPECTION_PORT) {
  const port = Number(process.env.INSPECTION_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid inspection port');
  args.push(`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1');
}
const browser = await chromium.launch({ headless: true, args });
try {
  const page = await browser.newPage();
  const started = Date.now();
  page.on('pageerror', error => { console.error(error); process.exitCode = 1; });
  page.on('console', message => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${message.text()}`));
  await page.addInitScript(() => {
    const Original = Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({ data }) => {
          if (data.type !== 'audio') console.log('WORKER', JSON.stringify(data));
        });
      }
    };
  });
  // Diagnostic-only standard touchHLE options, e.g. bundle.id: --print-fps.
  // Inject into this browser's worker response; never modify served artifacts.
  if (process.env.INSPECTION_OPTIONS) await page.route('**/runtime-worker.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = "    runtime.FS.writeFile('/app.ipa',";
    if (!source.includes(marker)) throw new Error('Runtime options injection point missing');
    const setup = `    runtime.FS.writeFile('/touchHLE_options.txt', ${JSON.stringify(process.env.INSPECTION_OPTIONS)});\n`;
    await route.fulfill({ response, body: source.replace(marker, setup + marker) });
  });
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:8765');
  await page.locator('#ipa').setInputFiles(ipa);
  await page.waitForFunction(() => !document.querySelector('#run').disabled);
  if (process.env.HEADLESS) await page.locator('#headless').check();
  await page.locator('#run').click();
  // Optional clicks use fractions of the displayed canvas: [{second,x,y}].
  const clicks = JSON.parse(process.env.CLICKS || '[]');
  const control = join(output, `control-${process.pid}.json`);
  console.log(`Live pointer control: append {x,y} objects to a JSON array in ${control}`);
  let processed = 0;
  const sentClicks = new Set();
  let nextScreenshot = 0;
  let nextDiagnostic = 0;
  while ((Date.now() - started) / 1000 < Number(process.env.RUN_SECONDS || 180)) {
    await page.waitForTimeout(1000);
    const second = Math.floor((Date.now() - started) / 1000);
    for (const click of clicks.filter(click => click.second <= second && !sentClicks.has(click))) {
      const box = await page.locator('#canvas').boundingBox();
      await page.mouse.click(box.x + box.width * click.x, box.y + box.height * click.y);
      sentClicks.add(click);
    }
    let actions = [];
    try { actions = JSON.parse(await readFile(control, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (; processed < actions.length; processed++) {
      const action = actions[processed];
      const box = await page.locator('#canvas').boundingBox();
      if (action.wheel !== undefined) {
        await page.mouse.move(box.x + box.width * action.x, box.y + box.height * action.y);
        await page.mouse.wheel(0, action.wheel);
      } else {
        await page.mouse.click(box.x + box.width * action.x, box.y + box.height * action.y);
      }
      console.log(`Input ${processed}: ${JSON.stringify(action)} at ${second}s`);
    }
    if (process.env.DIAGNOSTICS && second >= nextDiagnostic) {
      const worker = page.workers().find(worker => worker.url().endsWith('runtime-worker.js'));
      if (worker) {
        const diagnostic = await worker.evaluate(() => {
          const snapshot = self.__touchhleRuntime?.debugSnapshot();
          if (!snapshot) return { waiting: 'diagnostic runtime' };
          const { heap, gl } = snapshot;
          if (!self.__inspectionDraws) {
            self.__inspectionDraws = { arrays: 0, elements: 0, clears: 0 };
            const context = document.querySelector('#canvas').getContext('webgl2');
            for (const [method, key] of [['drawArrays', 'arrays'], ['drawElements', 'elements'], ['clear', 'clears']]) {
              const original = context[method];
              context[method] = function (...args) {
                self.__inspectionDraws[key]++;
                return original.apply(this, args);
              };
            }
          }
          // Contexts in the low host heap can contain the suspended main
          // thread. Rescan because thread contexts are created later. No
          // debugger, GPU readback, or changes to guest state are needed.
          const candidates = [];
          const valid = i => heap[i + 13] >= 0xfff00000 && heap[i + 13] < 0xfffffff0 &&
            !(heap[i + 13] & 3) && heap[i + 15] >= 0x1000 && !(heap[i + 15] & 1) &&
            heap[i + 15] < 0x40000000 && (heap[i + 80] & 0x07ffffdf) === 0x10;
          for (let i = 0; i < Math.min(heap.length - 82, 2 * 1024 * 1024); i++) {
            if (valid(i)) candidates.push(i);
          }
          return { draws: { ...self.__inspectionDraws },
            contexts: candidates.filter(valid).slice(0, 8).map(i => ({ host: i * 4,
              pc: heap[i + 15].toString(16), lr: heap[i + 14].toString(16), sp: heap[i + 13].toString(16) })),
            retained: gl.currentContext?.GLctx.getContextAttributes()?.preserveDrawingBuffer };
        });
        console.log(`[${second}s] DIAGNOSTIC ${JSON.stringify(diagnostic)}`);
      }
      nextDiagnostic = second + 30;
    }
    if (second >= nextScreenshot) {
      await page.locator('#canvas').screenshot({ path: join(output, `canvas-${second}.png`) });
      nextScreenshot = second + 10;
    }
    if (await page.locator('#stop').isDisabled()) {
      const status = await page.locator('#status').innerText();
      if (!status.includes('Guest exited with status 0')) process.exitCode = 1;
      break;
    }
  }
  await page.screenshot({ path: join(output, 'page.png'), fullPage: true });
  if (await page.locator('#stop').isEnabled()) await page.locator('#stop').click();
} finally { await browser.close(); }
