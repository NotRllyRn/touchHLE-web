// SPDX-License-Identifier: MPL-2.0
export const MAX_IPA_BYTES = 256 * 1024 * 1024;

// Each worker owns one instance. inspect consumes the input allocation; the
// result handle must be released even if decoding the response fails.
export function inspectBytes(exports, bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_IPA_BYTES) {
    throw new Error('IPA exceeds the 256 MiB browser import limit');
  }
  const ptr = exports.input_alloc(bytes.length);
  if (!ptr) throw new Error('Unable to allocate IPA memory');
  new Uint8Array(exports.memory.buffer, ptr, bytes.length).set(bytes);
  const result = exports.inspect(ptr, bytes.length);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
      new Uint8Array(exports.memory.buffer, exports.result_ptr(result), exports.result_len(result))
    ));
  } finally {
    exports.result_free(result);
  }
}
