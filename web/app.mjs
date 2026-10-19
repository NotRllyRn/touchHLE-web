// SPDX-License-Identifier: MPL-2.0
const status = document.querySelector('#status');
const test = document.querySelector('#test');
const stop = document.querySelector('#stop');
let worker;
function finish() {
  worker?.terminate();
  worker = undefined;
  test.disabled = false;
  stop.disabled = true;
}
test.onclick = () => {
  finish();
  test.disabled = true;
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
stop.onclick = () => {
  finish();
  status.textContent = 'Stopped. Worker memory released.';
};
