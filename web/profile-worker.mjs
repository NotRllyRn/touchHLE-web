// SPDX-License-Identifier: MPL-2.0
// CDP reconnects may not expose existing workers through Playwright page.workers().
export function selectProfileWorker(targets, pageUrl) {
  const pages = targets.filter(target => target.type === 'page');
  const workers = targets.filter(target => target.type === 'worker' && target.url.endsWith('/runtime-worker.js'));
  if (pages.length !== 1 || pages[0].url !== pageUrl || workers.length !== 1)
    throw Error('Profiling requires exactly one page and one runtime worker in this browser');
  const worker = workers[0], page = pages[0];
  if (worker.browserContextId !== page.browserContextId || new URL(worker.url).origin !== new URL(page.url).origin)
    throw Error('Runtime worker and page do not share a browser context and origin');
  return worker;
}

export async function readProfileWorker(send, expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (response.exceptionDetails) throw Error(`Worker evaluation failed: ${response.exceptionDetails.text}`);
  if (response.result?.type !== 'string') throw Error('Worker did not return serialized profiling data');
  return JSON.parse(response.result.value);
}
