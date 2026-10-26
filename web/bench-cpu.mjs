// SPDX-License-Identifier: MPL-2.0
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, ['web/patch-unicorn.mjs'], { cwd: root, stdio: 'inherit' });
execFileSync('emcc', ['web/fixtures/cpu/benchmark.c', process.env.CPU_ADAPTER || 'src/web/cpu.c',
  'target/unicorn.js/unicorn/build-wasm-eh/libunicorn.a',
  '-Itarget/unicorn.js/unicorn/include', '-O2', '-sSUPPORT_LONGJMP=wasm',
  '--pre-js', 'web/tci-jit.js', '-sALLOW_TABLE_GROWTH=1',
  '-sDEFAULT_LIBRARY_FUNCS_TO_INCLUDE=["$addFunction","$removeFunction"]',
  ...(process.env.CPU_ASYNCIFY === '1' ? ['-sASYNCIFY=1', '-sASYNCIFY_REMOVE=["tcg_qemu_tb_exec_arm"]'] : []),
  ...(process.env.CPU_CHECKS === '1' ? ['-sASSERTIONS=1', '-sSTACK_OVERFLOW_CHECK=2'] : []),
  '-sALLOW_MEMORY_GROWTH=1', '-sMODULARIZE=1', '-sENVIRONMENT=node',
  '-o', 'target/browser-cpu/benchmark.js'], { cwd: root, stdio: 'inherit' });
const require = createRequire(import.meta.url);
for (const enableTciJit of [false, true]) {
  console.log(JSON.stringify({ backend: enableTciJit ? 'jit' : 'interpreter', node: process.version, asyncify: process.env.CPU_ASYNCIFY === '1', checks: process.env.CPU_CHECKS === '1' }));
  const result = await require(`${root}target/browser-cpu/benchmark.js`)({ enableTciJit });
  if (enableTciJit) {
    console.log(JSON.stringify(result.tciJit.stats));
    if (!result.tciJit.stats.hits) throw new Error('Benchmark did not exercise compiled code');
  }
}
