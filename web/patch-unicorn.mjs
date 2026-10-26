// SPDX-License-Identifier: MPL-2.0
// Run after the pinned Unicorn.js `python3 build.py arm` has applied its patches.
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = `${root}target/unicorn.js`;
for (const [cwd, expected] of [
  [source, 'fdfcc4fd5e7d4ceeebe6b4d65b19eea4aa655e5d'],
  [`${source}/unicorn`, '8028ec436f2d9376525352dd38ed9ed6b9f6be10'],
]) {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  if (revision !== expected) throw new Error(`Unexpected revision in ${cwd}: ${revision}`);
}
const cwd = `${source}/unicorn`;
for (const name of ['unicorn-tci-temp-limit.patch', 'unicorn-instruction-count.patch', 'unicorn-svc-return.patch']) {
  const patch = `${root}web/patches/${name}`;
  const applied = spawnSync('git', ['apply', '--reverse', '--check', patch], { cwd });
  if (applied.status !== 0) {
    execFileSync('git', ['apply', '--check', patch], { cwd, stdio: 'inherit' });
    execFileSync('git', ['apply', patch], { cwd, stdio: 'inherit' });
  }
}
// Normal Unicorn CPU exits use longjmp. Keep those exceptions within WASM
// instead of throwing through JavaScript for every guest/HLE transition.
const build = `${cwd}/build-wasm-eh`;
execFileSync('emcmake', ['cmake', '-S', cwd, '-B', build,
  '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF', '-DUNICORN_ARCH=arm',
  '-DUNICORN_BUILD_TESTS=OFF', '-DUNICORN_INSTALL=OFF', '-DUNICORN_FUZZ=OFF',
  '-DUNICORN_LEGACY_STATIC_ARCHIVE=ON', '-DCMAKE_C_FLAGS=-sSUPPORT_LONGJMP=wasm'], { stdio: 'inherit' });
execFileSync('cmake', ['--build', build, '--target', 'unicorn_archive', '-j4'], { stdio: 'inherit' });
