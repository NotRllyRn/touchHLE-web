// SPDX-License-Identifier: MPL-2.0
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync('emcc', ['web/fixtures/cpu/benchmark.c', process.env.CPU_ADAPTER || 'src/web/cpu.c',
  'target/unicorn.js/unicorn/build-wasm-eh/libunicorn.a',
  '-Itarget/unicorn.js/unicorn/include', '-O2', '-sSUPPORT_LONGJMP=wasm',
  '--pre-js', 'web/tci-jit.js', '-sALLOW_TABLE_GROWTH=1',
  '-sDEFAULT_LIBRARY_FUNCS_TO_INCLUDE=["$addFunction","$removeFunction"]',
  '-sALLOW_MEMORY_GROWTH=1', '-sMODULARIZE=1', '-sENVIRONMENT=node',
  '-o', 'target/browser-cpu/benchmark.js'], { cwd: root, stdio: 'inherit' });
const require = createRequire(import.meta.url);
for (const enableTciJit of [false, true]) {
  console.log(JSON.stringify({ backend: enableTciJit ? 'jit' : 'interpreter', node: process.version }));
  const result = await require(`${root}target/browser-cpu/benchmark.js`)({ enableTciJit });
  if (enableTciJit) {
    console.log(JSON.stringify(result.tciJit.stats));
    if (!result.tciJit.stats.hits) throw new Error('Benchmark did not exercise compiled code');
  }
}
