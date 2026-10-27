// SPDX-License-Identifier: MPL-2.0
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const runtimeFiles = ['touchhle-runtime.js', 'touchhle-runtime.wasm', 'touchhle-runtime.data',
  'runtime-worker.js', 'tci-jit.js', 'tci-precompile.mjs', 'audio-proxy.js', 'audio.mjs', 'input.mjs', 'style.css'];
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function fingerprint(ipa) {
  const hashes = {};
  for (const name of runtimeFiles) hashes[name] = digest(await readFile(`${root}web/dist/${name}`));
  return { ipa: digest(await readFile(ipa)), files: hashes };
}
