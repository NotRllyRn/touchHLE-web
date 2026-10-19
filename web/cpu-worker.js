// SPDX-License-Identifier: MPL-2.0
importScripts('./vendor/unicorn_arm.js');
onmessage = async () => {
  try {
    const [{ runCpuChecks }, uc] = await Promise.all([
      import('./cpu-checks.mjs'), MUnicorn(),
    ]);
    postMessage({ results: runCpuChecks(uc) });
  } catch (error) {
    postMessage({ error: String(error) });
  }
};
