// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
try {
  const page = await browser.newPage();
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:8765');
  const result = await page.evaluate(async () => {
    const { AudioBridge } = await import('./audio.mjs');
    const context = new OfflineAudioContext(1, 960, 48000);
    const bridge = new AudioBridge(context);
    const worker = new Worker('./audio-test-worker.js');
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Audio worker timeout')), 10000);
        worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
        worker.onmessage = ({ data }) => {
          try {
            if (data.type === 'done') { clearTimeout(timer); resolve(); }
            else bridge.handle(data);
          } catch (error) { clearTimeout(timer); reject(error); }
        };
      });
      const rendered = await context.startRendering();
      const pcm = rendered.getChannelData(0);
      return { signal: pcm.slice(0, 240).every(value => Math.abs(value - 0.125) < 0.000001),
        silence: pcm.slice(240).every(value => value === 0), nodes: bridge.nodes.size };
    } finally { worker.terminate(); }
  });
  assert.deepEqual(result, {signal: true, silence: true, nodes: 3});
  console.log('PASS worker PCM, gain, scheduling, stop and source cleanup through actual Web Audio');
} finally { await browser.close(); }
