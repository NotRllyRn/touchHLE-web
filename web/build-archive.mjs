// SPDX-License-Identifier: MPL-2.0
// Explicit opt-in only. --prepare-only reconstructs/checks source without building.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...options });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (process.env.TOUCHHLE_WEB_TB_ARCHIVE !== '1') throw new Error('Set TOUCHHLE_WEB_TB_ARCHIVE=1 to opt in');
if (process.argv.slice(2).some(arg => arg !== '--prepare-only')) throw new Error('Only --prepare-only is supported');
const prepareOnly = process.argv.includes('--prepare-only');
// Audited exact seven-patch chain; no callback or validation-only patch.
const manifest = {
  "wrapper_revision": "fdfcc4fd5e7d4ceeebe6b4d65b19eea4aa655e5d",
  "unicorn_revision": "8028ec436f2d9376525352dd38ed9ed6b9f6be10",
  "base_touched_files": {
    "qemu/include/tcg/tcg.h": "926dcd1c1352e56c4e8e161d2f1f529ff3e6c2ae012c2226ff3c3a7860f421ed",
    "qemu/include/tcg/tcg-opc.h": "bb279765fac47c5bec4910aa7b4f0e5d4487e2dcbddc3a45ffa59bb1402917a1",
    "qemu/tcg/tcg.c": "eed6dd1ec8505ff3e73de250944957764956e0d7ea87aaedc8e90694aae051f3",
    "qemu/tcg/optimize.c": "3f65a03776efb29d6a744b414ba3a02de4a0c4266447a47ccc585364f52e2d0d",
    "qemu/include/tcg/tcg-op.h": "9c55d3a85c933d14eac5bc6daabcbf6c4688da74da7eeed67b82354ece407d32",
    "qemu/include/exec/gen-icount.h": "5cf050ef85b95cebf9a558d054770ef29b635cc4ad100d6802190c24e31bfe88",
    "qemu/accel/tcg/translator.c": "5664379d21d8ac143d6f487948a9c627fa0e3bdba0dafead23da7692d47401cd",
    "qemu/tcg/tcg-op.c": "a1d19d5fc49e91a5e3dc8ca4c35542d2d208ebb7616b165fcf9c7eacd1501c15",
    "qemu/accel/tcg/translate-all.c": "8f5c892919983a959f346be542eaaf7e477aec9f2c39dfbd8d2f4ae27007373a",
    "qemu/accel/tcg/touchhle-tb-archive.inc.c": null,
    "qemu/include/tcg/touchhle-tb-archive.h": null,
    "qemu/accel/tcg/touchhle-tb-codec-tests.inc.c": null,
    "qemu/accel/tcg/touchhle-tb-codec.inc.c": null,
    "qemu/accel/tcg/touchhle-tb-store.inc.c": null,
    "qemu/accel/tcg/touchhle-tb-store-tests.inc.c": null,
    "include/uc_priv.h": "11544c6615144a7171d1c409a0fef8d795f79db633625ac115926a2f04602824",
    "qemu/accel/tcg/cpu-exec.c": "03650a375bcc0dbe3d525dc2e276e4051b2f66fcf818af34cae0b45f3b1c1867",
    "qemu/include/exec/exec-all.h": "e4358053458b78cf0c251fc5a359b5d4fe5b8714fc8c53553ac77bbe03bad3f9",
    "qemu/target/arm/helper.c": "32a143847f3ced51dbe88533910b3fcddbcbd5919a5a28e26a323d30e4f339c0",
    "uc.c": "5512d7840718357b323adf5f8c01b633e12b8403775a6ce3c99ee11bb291d828"
  },
  "final_files": {
    "qemu/include/tcg/tcg.h": "8c58f61256200e46d40f9abf4ca8344ca420e844305dfe103cbf9b67147f8adf",
    "qemu/include/tcg/tcg-opc.h": "fb28772be7e2a1ef69fefb585475fad178ff50945279ccd142bcc9d6520747f5",
    "qemu/tcg/tcg.c": "e6850c72c6b2d36abbf9c032025869953b10a77fc3f75a37ff2ac9c8dc49ddb5",
    "qemu/tcg/optimize.c": "0aa78d3ada8db97e81e04c196947cbf94650766f25f87c86e60e291730fea790",
    "qemu/include/tcg/tcg-op.h": "6e99a31f2db439b7f326080951953bdd691caffc064dbaff503521a5d960d1a7",
    "qemu/include/exec/gen-icount.h": "160f9fe52ef2fb2e1c692d6ee336835060acefb49ece9c399effb910f39a189f",
    "qemu/accel/tcg/translator.c": "a44ebfe943cf57dd1e59166d649cc8648904b7ed4dee9b217e6b9db440ca194b",
    "qemu/tcg/tcg-op.c": "f4c230bb45eda230fa6dcb56494aba94381b7e0627d4159b4fa0d8d6dc3e4e17",
    "qemu/accel/tcg/translate-all.c": "bd9d64efaa4d33b655395b6f1cca8fb2c3534079252ba51af5815802247525fb",
    "qemu/accel/tcg/touchhle-tb-archive.inc.c": "bd40b33a96792306fa1b92a9d492162ce8d04d13884f7d76144142c444f904a8",
    "qemu/include/tcg/touchhle-tb-archive.h": "75e915df60a04d003068527e8366e7bb487d4996fe636f731eabc0e09da9220c",
    "qemu/accel/tcg/touchhle-tb-codec-tests.inc.c": "105115c494a4cfc38465c0be044213924267c10b07cd9ffb54412f5743652a4c",
    "qemu/accel/tcg/touchhle-tb-codec.inc.c": "9e560c5d6b15ff9a025eb98fdd8fd1cf5034d34ea9c85f8b8e5916aab48e68f3",
    "qemu/accel/tcg/touchhle-tb-store.inc.c": "ab88f32b57c8fe2aa7f00e10c18ffcf730a4fc081e1eb342b637a35406a01bb8",
    "qemu/accel/tcg/touchhle-tb-store-tests.inc.c": "ded2c1ad1783429c6ce38952de835ffa2ac5fcf2bcac7dd317db76a70d96d8f0",
    "include/uc_priv.h": "a20463760246112376f1952ac6a2c2a7d0570092debc04445c4dc483e8e7993c",
    "qemu/accel/tcg/cpu-exec.c": "ec996388331fd6f9d86879323cff7bae4ebe077b557dd3721f707ac9d1c8e564",
    "qemu/include/exec/exec-all.h": "e0a54f0dce9398cde73f6610b8f824ed53b7fe16577a67515c9f4d66603ca2af",
    "qemu/target/arm/helper.c": "5dd193faeeb891d32d91f8d06fae8f977fb70d76f5aa611eca02fe024386a262",
    "uc.c": "3d1dd8c306e364853ba0d5af0eb1066e3eb03ba8081619070f1fa734333bbb78"
  },
  "patches": [
    {
      "name": "0001-opaque-pointer-materialization.patch",
      "sha256": "8fc436effa1a5f27c68f1a732204f7b392c829dddfdf2d544e5cb852ae5fd114"
    },
    {
      "name": "0002-exact-runtime-tb-capture-restore.patch",
      "sha256": "108d4ae5774679dd526ab657a440e7b379ae547a073d16db88ca8a480fd9e78f"
    },
    {
      "name": "0003-runtime-guard-fixes.patch",
      "sha256": "77401f71f4019b3c7880b247003b9fdeaeda1241f45ddc77c686a1aef851dc37"
    },
    {
      "name": "0004-thumb-runtime-hooks.patch",
      "sha256": "b2993d5a30f9f3c817ee6da2e30708a219b7317e963a20dbdfbe8abeeed57d17"
    },
    {
      "name": "0005-archive-codec.patch",
      "sha256": "0e0030604d463bbd8aaf67c1f4372a24a5fce67a25bcf7e2c5e57e2c4973115c"
    },
    {
      "name": "0006-scalable-archive-and-domains.patch",
      "sha256": "d85bfc1746d6fc8c162ada8793d4504d1da6ac14eaba449ec340d54981899968"
    },
    {
      "name": "0007-combined-runtime-seal-and-bounds.patch",
      "sha256": "069c78b3a5412599e0b67f08a9d0b8ddf58b50d185bedfce05bc934d97dadab7"
    }
  ]
};
const dependency = resolve(process.env.TOUCHHLE_UNICORN_SOURCE || join(root, 'target/unicorn.js'));
for (const [cwd, revision] of [[dependency, manifest.wrapper_revision], [join(dependency, 'unicorn'), manifest.unicorn_revision]]) {
  const actual = run('git', ['rev-parse', 'HEAD'], { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();
  if (actual !== revision) throw new Error(`Unexpected dependency revision: ${actual}`);
}
// Pin the production preparation patches as well as the archive delta.
const productionHashes = {
  "unicorn-tci-temp-limit.patch": "af1a8be1e87118e7ded3ca3435a4c38a025f140ab07eac8f70965aefbdf65707",
  "unicorn-instruction-count.patch": "e20b86486772674729a1141d53d425b25af5d877ce96e67e12626c81b7e98813",
  "unicorn-svc-return.patch": "23137e62ec7555107e22f1c00dba428d45dbc57107ab3aadfe616b7da92ed26d",
  "unicorn-tci-jit.patch": "ab397c629a1784124b85879325414f1bfbfb224041dd6e6e12fc059670dc494a",
  "unicorn-block-budget.patch": "3c6d05357e76eb0a6528d840dbb558840c468468599284bd68105e2a8a501381",
  "unicorn-exit-check.patch": "1989120ed271f31b3d7346850a7df05a32321aea6695166ccefad9fb924f400a",
  "unicorn-adapter-read.patch": "3aa21868937e9c6d9b0b9961fe62dd10bc27dc44f928d9124eed96bdfa5f89c5",
  "unicorn-adapter-registers.patch": "9a50b6ba2b7d81a0e9378bda6456b6d78f0c05d6bd37f7adc732f9b2d1ee62c5"
};
const production = Object.entries(productionHashes).map(([name, expected]) => {
  const path = join(root, 'web/patches', name);
  if (hash(readFileSync(path)) !== expected) throw new Error(`Production patch hash mismatch: ${name}`);
  return path;
});
const patches = manifest.patches.map(({name, sha256}) => {
  const path = join(root, 'web/patches/tb-archive', name);
  if (hash(readFileSync(path)) !== sha256) throw new Error(`Archive patch hash mismatch: ${name}`);
  return path;
});
const flags = '-sSUPPORT_LONGJMP=wasm -DTOUCHHLE_OPAQUE_PTR_PROTOTYPE -DTOUCHHLE_TB_RESTORE_PROTOTYPE -DTOUCHHLE_TB_SEAL_PROTOTYPE';
// Include option/recipe/SDK identity in BOTH CMake and Cargo isolation keys.
const key = hash(Buffer.concat([Buffer.from(JSON.stringify([manifest, flags, 'TOUCHHLE_WEB_TB_ARCHIVE=1', process.env.EMSDK || ''])),
  readFileSync(fileURLToPath(import.meta.url)), ...production.map(path => readFileSync(path)), ...patches.map(path => readFileSync(path))]));
const base = join(root, 'target/tb-archive-build', key);
const source = join(base, 'source');
const build = join(base, 'build');
const wrapper = join(base, 'wrapper');
mkdirSync(base, { recursive: true });
// Never copy a dirty dependency, symlink facade, or ignored build/private tree.
// Reconstruct pinned Git objects with the wrapper's original preparation order.
function extract(repo, revision, destination, paths = []) {
  mkdirSync(destination, { recursive: true });
  const tar = run('git', ['archive', '--format=tar', revision, ...paths], { cwd: repo, stdio: 'pipe', maxBuffer: 128 * 1024 * 1024 });
  run('tar', ['-xf', '-', '-C', destination], { input: tar, stdio: ['pipe', 'inherit', 'inherit'] });
}
rmSync(source, { recursive: true, force: true });
rmSync(wrapper, { recursive: true, force: true });
extract(join(dependency, 'unicorn'), manifest.unicorn_revision, source);
extract(dependency, manifest.wrapper_revision, wrapper, ['externals/qemu-5.0.1', 'src/patches', 'src/qemu/helper-adapter.h']);
function apply(path) {
  run('patch', ['-p1', '--batch', '--fuzz=0', '--no-backup-if-mismatch', '-i', path], { cwd: source });
}
// The wrapper copies only missing QEMU files (not an overlay).
run('cp', ['-rn', join(wrapper, 'externals/qemu-5.0.1') + '/.', join(source, 'qemu')]);
apply(join(wrapper, 'src/patches/unicorn-tci.patch'));
copyFileSync(join(wrapper, 'src/qemu/helper-adapter.h'), join(source, 'qemu/include/exec/helper-adapter.h'));
apply(join(wrapper, 'src/patches/unicorn-adapters.patch'));
apply(join(wrapper, 'src/patches/unicorn-ppc-fix.patch'));
run('bash', ['symbols.sh'], { cwd: source });
for (const path of production) apply(path);
function verify(files) {
  for (const [name, expected] of Object.entries(files)) {
    const path = join(source, name);
    const actual = existsSync(path) ? hash(readFileSync(path)) : null;
    if (actual !== expected) throw new Error(`Source hash mismatch: ${name}: ${actual}`);
  }
}
verify(manifest.base_touched_files);
for (const path of patches) apply(path);
verify(manifest.final_files);
console.log(`Verified archive source: ${source}`);
if (prepareOnly) process.exit(0);
// Fail before expensive compilation if the separately owned web integration is missing.
for (const name of ['runtime-worker.js', 'tb-archive-bridge.mjs', 'launch.mjs']) {
  readFileSync(join(root, 'web/tb-archive', name));
}
run(process.execPath, ['web/patch-emscripten.mjs']);
run('emcmake', ['cmake', '-S', source, '-B', build, '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF',
  '-DUNICORN_ARCH=arm', '-DUNICORN_BUILD_TESTS=OFF', '-DUNICORN_INSTALL=OFF', '-DUNICORN_FUZZ=OFF',
  '-DUNICORN_LEGACY_STATIC_ARCHIVE=ON', `-DCMAKE_C_FLAGS=${flags}`]);
run('cmake', ['--build', build, '--target', 'unicorn_archive', '-j2']);
const cargo = join(base, 'cargo');
const dist = resolve(process.env.TOUCHHLE_WEB_TB_ARCHIVE_DIST || join(root, 'target/tb-archive-dist'));
const env = { ...process.env, TOUCHHLE_WEB_TB_ARCHIVE: '1', TOUCHHLE_UNICORN_SOURCE: source,
  TOUCHHLE_UNICORN_BUILD: build, CARGO_TARGET_DIR: cargo, RUSTFLAGS: '-C panic=abort' };
mkdirSync(dist, { recursive: true });
const diagnostics = [];
if (process.env.TOUCHHLE_WEB_DEBUG === '1') {
  // Opt-in local inspection without enabling the JS debugger, which can
  // deoptimize WASM. Never included by the normal build.
  const path = join(base, 'browser-runtime-debug.js');
  writeFileSync(path, 'Module.debugSnapshot = () => ({heap: HEAPU32, gl: GL, immediate: GLImmediate, egl: EGL});\n');
  diagnostics.push('--post-js', path);
}
execFileSync('cargo', ['rustc', '--locked', '--no-default-features', '--target', 'wasm32-unknown-emscripten',
  '--release', '--lib', '--crate-type', 'staticlib'], { cwd: root, env, stdio: 'inherit' });
execFileSync('em++', [join(cargo, 'wasm32-unknown-emscripten/release/libtouchHLE.a'),
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
  '-sABORTING_MALLOC=0', '-sALLOW_MEMORY_GROWTH=1', '-sMAXIMUM_MEMORY=1073741824', '-sSTACK_SIZE=2097152',
  '-sUSE_SDL=2', '-sOFFSCREENCANVAS_SUPPORT=1', '-sLEGACY_GL_EMULATION=1', '-sGL_UNSAFE_OPTS=0',
  '-sMAX_WEBGL_VERSION=2',
  '-sASSERTIONS=1',
  '-sEXIT_RUNTIME=1', '-sMODULARIZE=1', '-sEXPORT_NAME=createTouchHLE',
  '-sEXPORTED_FUNCTIONS=["_touchhle_web_start","_touchhle_web_pointer","_touchhle_web_touch","_touchhle_web_text_lease","_touchhle_web_text_enqueue","_malloc","_free","_touchhle_web_tb_setup","_touchhle_web_tb_import","_touchhle_web_tb_freeze","_touchhle_web_tb_export","_touchhle_web_tb_clear","_touchhle_web_tb_status","_touchhle_web_tb_stat"]', '-sEXPORTED_RUNTIME_METHODS=["FS","ccall","HEAPU8"]',
  '-sENVIRONMENT=web,worker,node', '-lopenal',
  '--preload-file', 'touchHLE_dylibs', '--preload-file', 'touchHLE_fonts',
  '--preload-file', 'touchHLE_default_options.txt',
  '-o', join(dist, 'touchhle-runtime.js')], { cwd: root, stdio: 'inherit' });

// Run the ordinary page build first if desired; it overwrites runtime-worker.js.
// Copy notices from the same pinned Git objects used to reconstruct the core.
for (const [repo, revision, sourceName, destination] of [
  [dependency, manifest.wrapper_revision, 'LICENSE', 'UNICORN-LICENSE'],
  ...['COPYING', 'COPYING.LGPL2', 'COPYING_GLIB'].map(name =>
    [join(dependency, 'unicorn'), manifest.unicorn_revision, name, `UNICORN-${name}`]),
]) {
  writeFileSync(join(dist, destination), run('git', ['show', `${revision}:${sourceName}`], { cwd: repo, stdio: 'pipe' }));
}
for (const name of ['runtime-worker.js', 'tb-archive-bridge.mjs', 'launch.mjs']) {
  copyFileSync(join(root, 'web/tb-archive', name), join(dist, name));
}
for (const name of ['guest-saves.js', 'save-session.mjs', 'external-open.js', 'text-input.js', 'external-links.mjs', 'save-transfer.mjs', 'preflight.mjs', 'audio-proxy.js', 'audio.mjs', 'tci-jit.js', 'tci-precompile.mjs', 'package-identity.mjs', 'input.mjs', 'style.css']) {
  copyFileSync(join(root, 'web', name), join(dist, name));
}
writeFileSync(join(dist, 'tb-archive-build.json'), JSON.stringify({ option: 'TOUCHHLE_WEB_TB_ARCHIVE=1', key,
  wrapper: manifest.wrapper_revision, unicorn: manifest.unicorn_revision, patches: manifest.patches }, null, 2) + '\n');

// Reuse the existing IPA validator; missing input fails rather than rebuilding.
copyFileSync(join(root, 'web/dist/touchhle_browser.wasm'), join(dist, 'touchhle_browser.wasm'));
