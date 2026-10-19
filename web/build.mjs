// SPDX-License-Identifier: MPL-2.0
import { mkdir, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
await mkdir(join(root, 'dist/vendor'), { recursive: true });
for (const name of ['index.html', 'style.css', 'app.mjs', 'cpu-worker.js', 'cpu-checks.mjs']) {
  await copyFile(join(root, name), join(root, 'dist', name));
}
await copyFile(require.resolve('@alexaltea/unicorn-js/arm'), join(root, 'dist/vendor/unicorn_arm.js'));
await copyFile(join(dirname(require.resolve('@alexaltea/unicorn-js/package.json')), 'LICENSE'),
  join(root, 'dist/vendor/UNICORN-LICENSE'));
console.log('Built local CPU feasibility page in web/dist (not a game emulator).');
