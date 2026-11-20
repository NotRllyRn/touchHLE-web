// SPDX-License-Identifier: MPL-2.0
// Same bootstrap contract as the private launcher; pin the helper as well as
// the exact executed worker. Keep Blob URLs alive until worker destruction.
export async function launch(base, identity, helperHash, read, digest) {
  base = new URL(base, location.href).href;
  const workerBytes = await read('runtime-worker.js', 1024 * 1024);
  const helperBytes = await read('tb-archive-bridge.mjs', 1024 * 1024);
  const workerHash = await digest(workerBytes);
  if (workerHash !== identity.files['runtime-worker.js']) throw Error('Worker fingerprint mismatch');
  if (await digest(helperBytes) !== helperHash) throw Error('Helper fingerprint mismatch');
  const helperURL = URL.createObjectURL(new Blob([helperBytes], { type: 'text/javascript' }));
  const prefix = `self.__tbBootstrap = Object.freeze(${JSON.stringify({ base, workerHash, helperHash, helperURL })});\n`;
  const workerURL = URL.createObjectURL(new Blob([prefix, workerBytes], { type: 'text/javascript' }));
  const revoke = () => { URL.revokeObjectURL(workerURL); URL.revokeObjectURL(helperURL); };
  try {
    const worker = new Worker(workerURL);
    return { worker, destroy() { worker.terminate(); revoke(); } };
  } catch (error) { revoke(); throw error; }
}
