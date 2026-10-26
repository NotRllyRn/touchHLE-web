// SPDX-License-Identifier: MPL-2.0
// Real Asyncify yield/state/input check; timing diagnostics are not game FPS.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
await mkdir('target/browser-cpu', { recursive: true });
await writeFile('target/browser-cpu/scheduler.c', `
#include <assert.h>
#include <emscripten.h>
extern void touchhle_web_yield(void);
EMSCRIPTEN_KEEPALIVE double scheduler_check(int mode, unsigned count) {
  volatile unsigned value = 0;
  double start = emscripten_get_now();
  for (unsigned i = 0; i < count; ++i) {
    value = value * 1664525u + 1013904223u;
    if (mode > 0) touchhle_web_yield();
    else emscripten_sleep(mode < 0 ? 20 : 0);
  }
  double elapsed = emscripten_get_now() - start;
  unsigned expected = 0;
  for (unsigned i = 0; i < count; ++i) expected = expected * 1664525u + 1013904223u;
  assert(value == expected);
  return elapsed;
}
`);
execFileSync('emcc', ['target/browser-cpu/scheduler.c', '--no-entry', '-O2',
  '--js-library', 'web/emscripten-scheduler.js', '-sASYNCIFY=1', '-sASSERTIONS=2',
  '-sSTACK_OVERFLOW_CHECK=2', '-sMODULARIZE=1', '-sEXPORT_NAME=createSchedulerChecks',
  '-sEXPORTED_RUNTIME_METHODS=["ccall"]', '-sENVIRONMENT=worker',
  '-o', 'web/dist/scheduler-checks.js'], { stdio: 'inherit' });
await writeFile('web/dist/scheduler-checks-worker.js', `
importScripts('./scheduler-checks.js');
const ready = createSchedulerChecks();
onmessage = async ({data}) => {
  if (data === 'ping') { postMessage({ping:true}); return; }
  try {
    const runtime = await ready;
    const ms = await runtime.ccall('scheduler_check', 'number', ['number','number'], data, {async:true});
    postMessage({ms});
  } catch (error) { postMessage({error:String(error)}); }
};
`);
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const origin = new URL(process.env.TEST_URL || 'http://127.0.0.1:8765').origin;
  await page.goto(origin);
  const results = await page.evaluate(async origin => {
    const worker = new Worker(origin + '/scheduler-checks-worker.js');
    try {
      const results = [];
      for (const mode of [0,1,0,1,0,1,-1]) {
        const count = mode > 0 ? 2000 : mode < 0 ? 1 : 200;
        results.push(await new Promise((resolve, reject) => {
          const started = performance.now();
          let duration, ping;
          const timeout = setTimeout(() => reject(new Error('Scheduler check timed out')), 10000);
          const finish = () => {
            if (duration !== undefined && ping !== undefined) {
              clearTimeout(timeout); resolve({mode,count,ms:duration,pingMs:ping});
            }
          };
          worker.onerror = event => { clearTimeout(timeout); reject(new Error(event.message)); };
          worker.onmessage = ({data}) => {
            if (data.error) { clearTimeout(timeout); reject(new Error(data.error)); }
            else if (data.ping) { ping = performance.now() - started; finish(); }
            else { duration = data.ms; finish(); }
          };
          worker.postMessage([mode,count]);
          setTimeout(() => worker.postMessage('ping'), 0);
        }));
      }
      return results;
    } finally { worker.terminate(); }
  }, origin);
  if (results.at(-1).ms < 18) throw new Error('Positive sleep returned prematurely');
  console.log(JSON.stringify({browser:browser.version(),results}, null, 2));
} finally { await browser.close(); }
