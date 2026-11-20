// SPDX-License-Identifier: MPL-2.0
import { AudioBridge } from './audio.mjs';
import { attachInput } from './input.mjs';
import { attachSaveSession } from './save-session.mjs';
import './external-open.js';
import './guest-saves.js';
import { installSaveTransfer } from './save-transfer.mjs';
import { attachExternalLinks } from './external-links.mjs';
const status = document.querySelector('#status');
const test = document.querySelector('#test');
const stop = document.querySelector('#stop');
const ipa = document.querySelector('#ipa');
const run = document.querySelector('#run');
const runtimeState = document.querySelector('#runtime-state');
let selectedFile, transfer, generation = 0;
let worker;
let audio;
let elapsedTimer, saves, input, external;
const saveState = document.querySelector('#save-state');
function finish() {
  generation++;
  external?.dispose(); external = undefined;
  input?.cancel?.(); input = undefined;
  saves?.dispose(); saves = undefined;
  clearInterval(elapsedTimer);
  elapsedTimer = undefined;
  runtimeState.hidden = true;
  worker?.terminate();
  if (audio) { void audio.close(); audio = undefined; }
  worker = undefined;
  transfer?.setActive(false);
  test.disabled = false;
  run.disabled = !selectedFile;
  ipa.disabled = false;
  stop.disabled = true;
}
test.onclick = () => {
  if (test.disabled || worker || transfer?.active || transfer?.busy) return;
  finish();
  test.disabled = true;
  run.disabled = true;
  ipa.disabled = true;
  stop.disabled = false;
  status.textContent = 'Testing ARM WASM in a local worker…';
  worker = new Worker('./cpu-worker.js');
  const tester = worker;
  worker.onmessage = ({ data }) => {
    if (worker !== tester) return;
    status.textContent = data.error ?? data.results.map(result =>
      `${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.error ? `: ${result.error}` : ''}`
    ).join('\n');
    finish();
  };
  worker.onerror = event => {
    if (worker !== tester) return;
    status.textContent = `Worker failed: ${event.message}`;
    finish();
  };
  worker.postMessage({ type: 'test' });
};
ipa.onchange = () => {
  if (ipa.disabled || worker || transfer?.active || transfer?.busy) return;
  const file = ipa.files[0];
  if (!file) return;
  transfer?.dispose(); transfer = undefined;
  selectedFile = undefined;
  finish();
  ipa.value = '';
  if (file.size > 256 * 1024 * 1024) {
    status.textContent = 'IPA exceeds the 256 MiB browser import limit.';
    return;
  }
  test.disabled = true;
  run.disabled = true;
  ipa.disabled = true;
  stop.disabled = false;
  status.textContent = 'Validating IPA locally…';
  worker = new Worker('./ipa-worker.mjs', { type: 'module' });
  const validator = worker;
  worker.onmessage = ({ data }) => {
    if (worker !== validator) return;
    if (data.ok) {
      selectedFile = file;
      transfer = installSaveTransfer({ id: data.app.bundleId,
        onBusy: () => { run.disabled = !selectedFile || !!worker || !!transfer?.busy || !!transfer?.active; ipa.disabled = !!worker || !!transfer?.busy; } });
    }
    status.textContent = data.ok
      ? `${data.app.name} (${data.app.bundleId})\n${data.app.architecture}; ${data.app.entries} archive entries.\nValidated, not executed. Ready to run.`
      : `IPA rejected: ${data.error}`;
    finish();
  };
  worker.onerror = event => {
    if (worker !== validator) return;
    status.textContent = `Validator failed: ${event.message}`;
    finish();
  };
  worker.postMessage({ type: 'inspect', file });
};
stop.onclick = () => {
  external?.dispose();
  if (saves) { input?.cancel?.(); stop.disabled = true; saves.stop(); return; }
  finish();
  status.textContent = 'Stopped. Worker memory released.';
};

run.onclick = async () => {
  if (run.disabled || worker || transfer?.active || !selectedFile || transfer?.busy) return;
  finish();
  const current = generation;
  const active = () => current === generation;
  transfer?.setActive(true);
  test.disabled = ipa.disabled = run.disabled = true;
  stop.disabled = false;
  status.textContent = 'Loading touchHLE WASM runtime…';
  const started = performance.now();
  const updateElapsed = () => {
    const seconds = Math.floor((performance.now() - started) / 1000);
    runtimeState.textContent = `Session time ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}. Startup and level loading can take many minutes.`;
  };
  runtimeState.hidden = false;
  updateElapsed();
  elapsedTimer = setInterval(updateElapsed, 1000);
  const headless = document.querySelector('#headless').checked;
  let audioClock;
  if (!headless) {
    try {
      const bridge = audio = new AudioBridge();
      audioClock = await bridge.start();
      if (audio !== bridge) return; // Stop while resume was pending.
    } catch (error) { if (!active()) return; status.textContent = `Audio initialization failed: ${error.message}`; finish(); return; }
  }
  const lines = [];
  worker = new Worker('./runtime-worker.js');
  external = attachExternalLinks(worker);
  saves = attachSaveSession(worker, {
    onStatus: message => { saveState.textContent = message; },
    onStopped: () => { finish(); status.textContent = 'Stopped. Progress saved on this browser.'; },
    onStopFailed: () => { stop.disabled = false; },
  });
  void navigator.storage?.persist?.().catch(() => {});
  worker.onmessage = ({ data }) => {
    if (!active()) return;
    if (data.type === 'aot-block' || data.type?.startsWith('save-') || data.type?.startsWith('external-')) return;
    if (data.type === 'audio') {
      try { audio?.handle(data); }
      catch (error) { status.textContent += `\nAudio failed: ${error.message}`; stop.onclick(); }
      return;
    }
    lines.push(data.type === 'exit' ? `Guest exited with status ${data.code}.` : data.message);
    if (lines.length > 200) lines.shift();
    status.textContent = lines.join('\n');
    if (data.type === 'exit' || data.type === 'error') finish();
  };
  worker.onerror = event => {
    if (!active()) return;
    status.textContent += `\nRuntime failed: ${event.message}`;
    stop.onclick();
  };
  let canvas;
  if (!headless) {
    const previous = document.querySelector('#canvas');
    const replacement = previous.cloneNode();
    previous.replaceWith(replacement);
    input = attachInput(replacement, message => worker?.postMessage(message));
    canvas = replacement.transferControlToOffscreen();
  }
  worker.postMessage({ type: 'start', externalSession: external.session, persistentSaves: true, file: selectedFile, headless, canvas, audioClock,
    cpuBackend: new URLSearchParams(location.search).get('cpu'),
    aotCapture: new URLSearchParams(location.search).get('aot') === 'capture',
    jitThreshold: new URLSearchParams(location.search).get('jitThreshold') === '1' ? 1 : 32 }, canvas ? [canvas] : []);
};
