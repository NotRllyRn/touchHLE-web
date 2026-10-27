// SPDX-License-Identifier: MPL-2.0
// Shared package identity contract; usable by both the producer and browser.
export const runtimeFiles = ['touchhle-runtime.js', 'touchhle-runtime.wasm', 'touchhle-runtime.data',
  'runtime-worker.js', 'tci-jit.js', 'tci-precompile.mjs', 'audio-proxy.js', 'audio.mjs',
  'input.mjs', 'style.css', 'package-identity.mjs'];
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function checkIdentity(expected, actual) {
  for (const identity of [expected, actual]) {
    if (!isHash(identity?.ipa) || !identity.files ||
        Object.keys(identity.files).length !== runtimeFiles.length ||
        !runtimeFiles.every(name => isHash(identity.files[name]))) throw Error('Invalid game package identity');
  }
  if (actual.ipa !== expected.ipa || runtimeFiles.some(name => actual.files[name] !== expected.files[name]))
    throw Error('Precompiled archive does not match this game/runtime package');
}

export async function verifyFile(name, bytes, expected) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const actual = Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== expected) throw Error(`Game package fingerprint mismatch: ${name}`);
}
