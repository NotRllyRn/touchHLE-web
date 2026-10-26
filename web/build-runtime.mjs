// SPDX-License-Identifier: MPL-2.0
import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, ['web/patch-unicorn.mjs'], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, ['web/patch-emscripten.mjs'], { cwd: root, stdio: 'inherit' });
const env = { ...process.env, TOUCHHLE_UNICORN_SOURCE: `${root}target/unicorn.js`, RUSTFLAGS: '-C panic=abort' };
for (const [directory, expected] of [
  ['target/unicorn.js', 'fdfcc4fd5e7d4ceeebe6b4d65b19eea4aa655e5d'],
  ['target/unicorn.js/unicorn', '8028ec436f2d9376525352dd38ed9ed6b9f6be10'],
]) {
  const actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: `${root}${directory}`, encoding: 'utf8' }).trim();
  if (actual !== expected) throw new Error(`Unexpected Unicorn source revision: ${actual}`);
}
for (const patch of ['unicorn-tci-temp-limit.patch', 'unicorn-instruction-count.patch', 'unicorn-svc-return.patch', 'unicorn-tci-jit.patch', 'unicorn-block-budget.patch', 'unicorn-exit-check.patch', 'unicorn-adapter-read.patch', 'unicorn-adapter-registers.patch']) {
  execFileSync('git', ['apply', '--reverse', '--check', `${root}web/patches/${patch}`],
    { cwd: `${root}target/unicorn.js/unicorn`, stdio: 'inherit' });
}
await mkdir(`${root}web/dist`, { recursive: true });
const diagnostics = [];
if (process.env.TOUCHHLE_WEB_DEBUG === '1') {
  // Opt-in local inspection without enabling the JS debugger, which can
  // deoptimize WASM. Never included by the normal build.
  const path = `${root}target/browser-runtime-debug.js`;
  await writeFile(path, 'Module.debugSnapshot = () => ({heap: HEAPU32, gl: GL, immediate: GLImmediate, egl: EGL});\n');
  diagnostics.push('--post-js', path);
}
execFileSync('cargo', ['rustc', '--no-default-features', '--target', 'wasm32-unknown-emscripten',
  '--release', '--lib', '--crate-type', 'staticlib'], { cwd: root, env, stdio: 'inherit' });
execFileSync('em++', ['target/wasm32-unknown-emscripten/release/libtouchHLE.a',
  '--js-library', 'web/emscripten-gl.js', '--js-library', 'web/emscripten-scheduler.js', ...diagnostics,
  '--post-js', 'web/emscripten-gl-init.js',
  '--no-entry', '-O2', '-g2', '-sSTACK_OVERFLOW_CHECK=2', '-sASYNCIFY=1', '-sASYNCIFY_STACK_SIZE=2097152',
  '-sSUPPORT_LONGJMP=wasm',
  '-sALLOW_TABLE_GROWTH=1',
  '-sDEFAULT_LIBRARY_FUNCS_TO_INCLUDE=["$addFunction","$removeFunction"]',
  // CPU hooks only count, stop, or report faults. They never suspend; Rust
  // dispatches HLE calls after the interpreter returns. TCI bridges and these
  // pure softfloat operations cannot suspend either. Keep fibers instrumented.
  '-sASYNCIFY_REMOVE=["tcg_qemu_tb_exec_arm","touchhle_tci_call","touchhle_tci_step","touchhle_tci_interpret","float32_add_arm","float32_sub_arm","float32_mul_arm","float32_div_arm"]',
  '-sALLOW_MEMORY_GROWTH=1', '-sMAXIMUM_MEMORY=1073741824', '-sSTACK_SIZE=2097152',
  '-sUSE_SDL=2', '-sOFFSCREENCANVAS_SUPPORT=1', '-sLEGACY_GL_EMULATION=1', '-sGL_UNSAFE_OPTS=0',
  '-sMAX_WEBGL_VERSION=2',
  '-sASSERTIONS=1',
  '-sEXIT_RUNTIME=1', '-sMODULARIZE=1', '-sEXPORT_NAME=createTouchHLE',
  '-sEXPORTED_FUNCTIONS=["_touchhle_web_start","_touchhle_web_pointer","_touchhle_web_touch"]', '-sEXPORTED_RUNTIME_METHODS=["FS","ccall"]',
  '-sENVIRONMENT=web,worker,node', '-lopenal',
  '--preload-file', 'touchHLE_dylibs', '--preload-file', 'touchHLE_fonts',
  '--preload-file', 'touchHLE_default_options.txt',
  '-o', 'web/dist/touchhle-runtime.js'], { cwd: root, stdio: 'inherit' });

await copyFile(`${root}web/runtime-worker.js`, `${root}web/dist/runtime-worker.js`);

for (const name of ['audio-proxy.js', 'audio.mjs', 'tci-jit.js']) await copyFile(`${root}web/${name}`, `${root}web/dist/${name}`);
