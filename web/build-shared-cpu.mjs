// SPDX-License-Identifier: MPL-2.0
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = `${root}target/unicorn.js`;
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
if (revision !== 'fdfcc4fd5e7d4ceeebe6b4d65b19eea4aa655e5d') throw new Error('Expected Unicorn.js v2.1.4 source revision');
const coreRevision = execFileSync('git', ['rev-parse', 'HEAD'],
  { cwd: `${source}/unicorn`, encoding: 'utf8' }).trim();
if (coreRevision !== '8028ec436f2d9376525352dd38ed9ed6b9f6be10') throw new Error('Unexpected Unicorn core revision');
await mkdir(`${root}target/browser-cpu`, { recursive: true });
await mkdir(`${root}web/dist`, { recursive: true });
execFileSync('rustc', ['--edition=2021', '--crate-type=staticlib',
  '--target=wasm32-unknown-emscripten', '-C', 'panic=abort', '-C', 'opt-level=2',
  'web/fixtures/cpu/shared.rs', '-o', 'target/browser-cpu/libshared.a'], { cwd: root, stdio: 'inherit' });
execFileSync('emcc', ['web/fixtures/cpu/main.c', 'web/fixtures/cpu/adapter.c',
  'src/web/cpu.c', 'target/browser-cpu/libshared.a',
  `${source}/unicorn/build-wasm-eh/libunicorn.a`, `-I${source}/unicorn/include`,
  '-O2', '-sASSERTIONS=2', '-sALLOW_MEMORY_GROWTH=1', '-sASYNCIFY=1',
  '-sSTACK_OVERFLOW_CHECK=2',
  '-sSUPPORT_LONGJMP=wasm',
  '--pre-js', 'web/tci-jit.js', '-sALLOW_TABLE_GROWTH=1',
  '-sDEFAULT_LIBRARY_FUNCS_TO_INCLUDE=["$addFunction","$removeFunction"]',
  '-sASYNCIFY_REMOVE=["tcg_qemu_tb_exec_arm"]',
  '-sMODULARIZE=1', '-sEXPORT_NAME=createSharedCpuChecks', '-sENVIRONMENT=web,worker,node',
  '-o', 'web/dist/shared-cpu-checks.js'], { cwd: root, stdio: 'inherit' });
await writeFile(`${root}web/dist/shared-cpu-worker.js`, `// SPDX-License-Identifier: MPL-2.0
importScripts('./shared-cpu-checks.js');
let summary;
createSharedCpuChecks({
  enableTciJit: new URL(self.location.href).searchParams.has('jit'),
  tciJitThreshold: 1,
  print: message => {
    if (message.startsWith('PASS ')) summary = message;
    else self.postMessage({ message });
  },
  printErr: warning => self.postMessage({ warning }),
  onAbort: error => self.postMessage({ error: String(error) }),
}).then(runtime => self.postMessage({ message: summary, stats: runtime.tciJit?.stats }))
  .catch(error => self.postMessage({ error: String(error) }));
`);
