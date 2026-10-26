// SPDX-License-Identifier: MPL-2.0
import { inspectBytes, MAX_IPA_BYTES } from './preflight.mjs';
self.onmessage = async ({ data }) => {
  try {
    if (data.type !== 'memory-check' && (data.type !== 'inspect' || !(data.file instanceof Blob))) {
      throw new Error('Invalid import request');
    }
    if (data.file?.size > MAX_IPA_BYTES) throw new Error('IPA exceeds the 256 MiB browser import limit');
    const response = await fetch('./touchhle_browser.wasm');
    if (!response.ok) throw new Error(`Unable to load validator: HTTP ${response.status}`);
    const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
    if (data.type === 'memory-check') {
      self.postMessage({ ok: instance.exports.memory_check() === 1 });
      return;
    }
    const result = inspectBytes(instance.exports, new Uint8Array(await data.file.arrayBuffer()));
    self.postMessage(result);
  } catch (error) {
    self.postMessage({ ok: false, error: String(error.message ?? error) });
  }
};
