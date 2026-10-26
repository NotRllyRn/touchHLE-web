// SPDX-License-Identifier: MPL-2.0
import { execFileSync } from 'node:child_process';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(`${root}target/browser-fibers`, { recursive: true });
await mkdir(`${root}web/dist`, { recursive: true });
execFileSync('rustc', ['--edition=2021', '--crate-type=staticlib',
  '--target=wasm32-unknown-emscripten', '-C', 'panic=abort', '-C', 'opt-level=2',
  'web/fixtures/fibers/reentry.rs', '-o', 'target/browser-fibers/libreentry.a'], { cwd: root, stdio: 'inherit' });
execFileSync('emcc', ['web/fixtures/fibers/main.c', 'target/browser-fibers/libreentry.a',
  '-O2', '-sASYNCIFY=1', '-sASSERTIONS=2', '-sSTACK_OVERFLOW_CHECK=2',
  '-sMODULARIZE=1', '-sEXPORT_NAME=createFiberChecks', '-sENVIRONMENT=web,worker,node',
  '-o', 'web/dist/fiber-checks.js'], { cwd: root, stdio: 'inherit' });
await copyFile(`${root}web/fixtures/fibers/worker.js`, `${root}web/dist/fiber-worker.js`);
execFileSync('emcc', ['web/fixtures/fibers/adapter.c', 'src/web/fibers.c',
  '-O2', '-sUSE_SDL=2', '-sASYNCIFY=1', '-sASSERTIONS=2', '-sSTACK_OVERFLOW_CHECK=2',
  '-sALLOW_MEMORY_GROWTH=1', '-sMODULARIZE=1', '-sEXPORT_NAME=createFiberAdapterChecks',
  '-sENVIRONMENT=web,worker,node', '-o', 'web/dist/fiber-adapter-checks.js'], { cwd: root, stdio: 'inherit' });
