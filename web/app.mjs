// SPDX-License-Identifier: MPL-2.0
import { AudioBridge } from './audio.mjs';
import { attachInput } from './input.mjs';
const status = document.querySelector('#status');
const test = document.querySelector('#test');
const stop = document.querySelector('#stop');
const ipa = document.querySelector('#ipa');
const run = document.querySelector('#run');
const runtimeState = document.querySelector('#runtime-state');
let selectedFile;
let worker;
let audio;
let elapsedTimer;
function finish() {
  clearInterval(elapsedTimer);
  elapsedTimer = undefined;
  runtimeState.hidden = true;
  worker?.terminate();
  if (audio) { void audio.close(); audio = undefined; }
  worker = undefined;
  test.disabled = false;
  run.disabled = !selectedFile;
  ipa.disabled = false;
  stop.disabled = true;
}
test.onclick = () => {
  finish();
  test.disabled = true;
  run.disabled = true;
  ipa.disabled = true;
  stop.disabled = false;
  status.textContent = 'Testing ARM WASM in a local worker…';
  worker = new Worker('./cpu-worker.js');
  worker.onmessage = ({ data }) => {
    status.textContent = data.error ?? data.results.map(result =>
      `${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.error ? `: ${result.error}` : ''}`
    ).join('\n');
    finish();
  };
  worker.onerror = event => {
    status.textContent = `Worker failed: ${event.message}`;
    finish();
  };
  worker.postMessage({ type: 'test' });
};
ipa.onchange = () => {
  const file = ipa.files[0];
  if (!file) return;
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
  worker.onmessage = ({ data }) => {
    if (data.ok) selectedFile = file;
    status.textContent = data.ok
      ? `${data.app.name} (${data.app.bundleId})\n${data.app.architecture}; ${data.app.entries} archive entries.\nValidated, not executed. Ready to run.`
      : `IPA rejected: ${data.error}`;
    finish();
  };
  worker.onerror = event => {
    status.textContent = `Validator failed: ${event.message}`;
    finish();
  };
  worker.postMessage({ type: 'inspect', file });
};
stop.onclick = () => {
  finish();
  status.textContent = 'Stopped. Worker memory released.';
};

run.onclick = async () => {
  if (!selectedFile) return;
  finish();
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
    } catch (error) { status.textContent = `Audio initialization failed: ${error.message}`; finish(); return; }
  }
  const lines = [];
  worker = new Worker('./runtime-worker.js');
  worker.onmessage = ({ data }) => {
    if (data.type === 'audio') {
      try { audio?.handle(data); }
      catch (error) { status.textContent += `\nAudio failed: ${error.message}`; finish(); }
      return;
    }
    lines.push(data.type === 'exit' ? `Guest exited with status ${data.code}.` : data.message);
    if (lines.length > 200) lines.shift();
    status.textContent = lines.join('\n');
    if (data.type === 'exit' || data.type === 'error') finish();
  };
  worker.onerror = event => {
    status.textContent += `\nRuntime failed: ${event.message}`;
    finish();
  };
  let canvas;
  if (!headless) {
    const previous = document.querySelector('#canvas');
    const replacement = previous.cloneNode();
    previous.replaceWith(replacement);
    attachInput(replacement, message => worker?.postMessage(message));
    canvas = replacement.transferControlToOffscreen();
  }
  worker.postMessage({ type: 'start', file: selectedFile, headless, canvas, audioClock }, canvas ? [canvas] : []);
};
