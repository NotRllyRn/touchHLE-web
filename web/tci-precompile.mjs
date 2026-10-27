// SPDX-License-Identifier: MPL-2.0
// Shared by the offline converter and the static player; no Node dependency.
import './tci-jit.js';
export const MAX_CACHE_BYTES = 64 * 1024 * 1024;
export const MAX_CACHE_BLOCKS = 32768;
export const encodeBytes = bytes => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
};
export const decodeBytes = text => {
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(text);
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

function decodeRecord(key, abi) {
  const layout = JSON.parse(abi);
  if (![1, 2, 3].includes(layout.version) || !Array.isArray(layout.names)) throw Error('Unsupported portable ABI');
  const match = /^([0-3]):([A-Za-z0-9+/]*={0,2})$/.exec(key);
  if (!match) throw Error('Invalid portable block key');
  const code = decodeBytes(match[2]);
  if (!code.length || code.length > 65536) throw Error('Invalid portable block size');
  const start = 64 + Number(match[1]);
  const memory = new WebAssembly.Memory({ initial: 2 });
  new Uint8Array(memory.buffer).set(code, start);
  const view = new DataView(memory.buffer);
  for (let offset = 0; offset < code.length;) {
    const size = code[offset + 1], name = layout.names[code[offset]];
    if (!name || size < 2 || offset + size > code.length) throw Error('Invalid portable operation');
    if (['br', 'brcond_i32', 'brcond2_i32'].includes(name)) {
      const field = start + offset + size - 4;
      view.setUint32(field, view.getUint32(field, true) + start, true);
    }
    offset += size;
  }
  const dispatch = { ...layout, call: layout.call ? () => 0n : undefined };
  const jit = new TouchHLETciJit(memory, () => 0, () => 0, () => {}, 1, dispatch);
  jit.names = layout.names;
  return { jit, start, length: code.length };
}

export function canonicalRecord(key, abi) {
  const {jit,start,length} = decodeRecord(key, abi);
  return jit.describePortable(start, length).key;
}

export function compileRecord(key, abi) {
  const {jit,start,length} = decodeRecord(key, abi);
  const bytes = jit.compile(start, length, true);
  if (!WebAssembly.validate(bytes)) throw Error('Invalid precompiled Wasm');
  return bytes;
}

export async function prepareCache(archive) {
  if (archive?.format !== 1 || typeof archive.abi !== 'string' || !Array.isArray(archive.blocks) ||
      archive.blocks.length > MAX_CACHE_BLOCKS) throw Error('Invalid precompiled archive');
  const modules = new Map();
  let total = 0, next = 0;
  // Bound native compilation concurrency; the runtime begins only after prepare.
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (;;) {
      const index = next++;
      if (index >= archive.blocks.length) return;
      const { key, wasm } = archive.blocks[index];
      if (typeof key !== 'string' || key.length > 90000 || typeof wasm !== 'string' || wasm.length > 350000)
        throw Error('Invalid precompiled entry');
      const bytes = decodeBytes(wasm);
      total += bytes.length + key.length;
      if (total > MAX_CACHE_BYTES) throw Error('Precompiled archive exceeds memory bound');
      if (modules.has(key)) throw Error('Duplicate precompiled entry');
      // Reserve before awaiting, so duplicate entries cannot race.
      modules.set(key, null);
      modules.set(key, { bytes, module: await WebAssembly.compile(bytes) });
    }
  }));
  return { abi: archive.abi, modules, bytes: total };
}
