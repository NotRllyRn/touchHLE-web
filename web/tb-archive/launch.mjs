// SPDX-License-Identifier: MPL-2.0
// Optional replacement for `new Worker` in a private harness, never auto-enabled.
import { checkIdentity, readBounded, sha256 } from './tb-archive-bridge.mjs';
export async function launch(base, identity) {
  checkIdentity(identity);
  base = new URL(base, location.href).href;
  const workerBytes = await readBounded(await fetch(new URL('runtime-worker.js', base), { cache: 'no-store' }), 1024 * 1024);
  const workerHash = await sha256(workerBytes);
  if (workerHash !== identity.files['runtime-worker.js']) throw Error('Worker fingerprint mismatch');
  const helperBytes = await readBounded(await fetch(new URL('tb-archive-bridge.mjs', base), { cache: 'no-store' }), 1024 * 1024);
  const helperHash = await sha256(helperBytes);
  const helperURL = URL.createObjectURL(new Blob([helperBytes], { type: 'text/javascript' }));
  const prefix = `self.__tbBootstrap = Object.freeze(${JSON.stringify({ base, workerHash, helperHash, helperURL })});\n`;
  const workerURL = URL.createObjectURL(new Blob([prefix, workerBytes], { type: 'text/javascript' }));
  try {
    const worker = new Worker(workerURL);
    // Caller owns lifetime; keep both URLs until destroy, including startup failure.
    return { worker, destroy() { worker.terminate(); URL.revokeObjectURL(workerURL); URL.revokeObjectURL(helperURL); } };
  } catch (error) { URL.revokeObjectURL(workerURL); URL.revokeObjectURL(helperURL); throw error; }
}
