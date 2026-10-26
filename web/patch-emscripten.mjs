// SPDX-License-Identifier: MPL-2.0
// Keep the pinned SDK's texture-combine shader generation reproducible.
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const version = execFileSync('emcc', ['--version'], { encoding: 'utf8' });
if (!/\b4\.0\.23\b/.test(version.split('\n')[0])) throw new Error('Expected Emscripten 4.0.23');
const cwd = execFileSync('em-config', ['EMSCRIPTEN_ROOT'], { encoding: 'utf8' }).trim();
for (const name of ['emscripten-texture-combine.patch', 'emscripten-point-parameters.patch', 'emscripten-material-emission.patch', 'emscripten-light-parameters.patch']) {
  const patch = fileURLToPath(new URL(`./patches/${name}`, import.meta.url));
  if (spawnSync('git', ['apply', '--reverse', '--check', patch], { cwd }).status !== 0) {
    execFileSync('git', ['apply', '--check', patch], { cwd, stdio: 'inherit' });
    execFileSync('git', ['apply', patch], { cwd, stdio: 'inherit' });
  }
}
