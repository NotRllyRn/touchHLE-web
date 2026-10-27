// SPDX-License-Identifier: MPL-2.0
import { mkdir, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
execFileSync('cargo', ['build', '--locked', '-p', 'touchhle-browser',
  '--target', 'wasm32-unknown-unknown', '--release'], { cwd: join(root, '..'), stdio: 'inherit' });
await mkdir(join(root, 'dist/vendor'), { recursive: true });
for (const name of ['index.html', 'style.css', 'app.mjs', 'input.mjs', 'audio.mjs', 'audio-proxy.js', 'runtime-worker.js', 'tci-jit.js', 'tci-precompile.mjs', 'package-identity.mjs', 'cpu-worker.js', 'cpu-checks.mjs', 'ipa-worker.mjs', 'preflight.mjs']) {
  await copyFile(join(root, name), join(root, 'dist', name));
}
await copyFile(join(root, '../target/wasm32-unknown-unknown/release/touchhle_browser.wasm'),
  join(root, 'dist/touchhle_browser.wasm'));
await copyFile(require.resolve('@alexaltea/unicorn-js/arm'), join(root, 'dist/vendor/unicorn_arm.js'));
await copyFile(join(dirname(require.resolve('@alexaltea/unicorn-js/package.json')), 'LICENSE'),
  join(root, 'dist/vendor/UNICORN-LICENSE'));
console.log('Built local CPU and IPA validation page in web/dist (not a game emulator).');

await copyFile(join(root, 'fixtures/audio/worker.js'), join(root, 'dist/audio-test-worker.js'));
