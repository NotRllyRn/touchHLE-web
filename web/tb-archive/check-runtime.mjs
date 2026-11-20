// SPDX-License-Identifier: MPL-2.0
// Full Rust loader + real CPU + JS bridge, original public fixture only.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, sep, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { prepare, runtimeFiles, sha256 } from './tb-archive-bridge.mjs';
globalThis.crypto ??= webcrypto;
await import('../tci-jit.js');
const [mode, dist, outputPath] = process.argv.slice(2);
assert(['capture', 'restore', 'disabled'].includes(mode) && dist && outputPath,
  'Usage: node web/tb-archive/check-runtime.mjs capture|restore|disabled RUNTIME_DIRECTORY OUTPUT_DIRECTORY');
const output = resolve(outputPath);
await mkdir(output, { recursive: true });
const jit = process.env.RESTORE_JIT === '1';
const base = pathToFileURL(resolve(dist) + sep);
const ipa = new Uint8Array(await readFile(new URL('../../target/browser-hle-test.ipa', import.meta.url)));
const identity = { ipa: await sha256(ipa), files: {} };
for (const name of runtimeFiles) identity.files[name] = await sha256(await readFile(new URL(name, base)));
const helperHash = await sha256(await readFile(new URL('./tb-archive-bridge.mjs', import.meta.url)));
assert.equal(await sha256(await readFile(new URL('tb-archive-bridge.mjs', base))), helperHash, 'fixture helper must match executed distribution');
const dataBytes = await readFile(new URL('touchhle-runtime.data', base));
let m, session, captured, result;
const logs = [];
const stat = n => m._touchhle_web_tb_stat(n, 0) + m._touchhle_web_tb_stat(n, 1) * 2 ** 32;
const print = line => {
  logs.push(line); console.log(line);
  if (line.includes('PASS real touchHLE ARM guest called puts and exit')) {
    assert.equal(m._touchhle_web_tb_status(), mode === 'disabled' ? 0 : 2);
    result = { mode, jit, captures: stat(0), restores: stat(1), frontendCalls: stat(3), imported: stat(18), resident: stat(14) };
    if (mode === 'capture') {
      assert(result.captures > 0);
      session.exportTo(message => { captured = message.buffer; });
    }
    if (mode === 'restore') { assert(result.restores > 0); assert.equal(result.imported, 1); assert.equal(result.frontendCalls, 0); }
    console.log('ARCHIVE_PROOF ' + JSON.stringify(result));
  }
};
m = await createRequire(import.meta.url)(fileURLToPath(new URL('touchhle-runtime.js', base)))({
  noInitialRun: true, enableTciJit: jit, tciJitThreshold: 1,
  wasmBinary: await readFile(new URL('touchhle-runtime.wasm', base)),
  getPreloadedPackage: () => dataBytes.buffer.slice(dataBytes.byteOffset, dataBytes.byteOffset + dataBytes.byteLength),
  print, printErr: print,
});
m.FS.writeFile('/app.ipa', ipa);
if (mode !== 'disabled') {
  const source = mode === 'restore' ? new Uint8Array(await readFile(join(output, 'runtime-roundtrip.bin'))).buffer : undefined;
  session = await prepare(m, { capture: mode === 'capture', ...(source ? { source } : {}) }, identity, ipa, helperHash, { headless: true, optionsHash: null });
}
try { await m.ccall('touchhle_web_start', null, ['number'], [1], { async: true }); }
catch (error) { if (!(error.name === 'ExitStatus' && error.status === 0)) throw error; }
assert(result, 'must reach fixture guest result');
assert(logs.some(s => s.includes('App called exit(), exiting.')));
if (captured) await writeFile(join(output, 'runtime-roundtrip.bin'), new Uint8Array(captured));
await writeFile(join(output, `runtime-${mode}-${jit ? 'on' : 'off'}.json`), JSON.stringify(result, null, 2));
if (jit) { assert(m.tciJit.stats.compiled > 0); assert.equal(m.tciJit.stats.failed, 0); }
