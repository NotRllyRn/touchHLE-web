// SPDX-License-Identifier: MPL-2.0
// Requires a built runtime plus a locally captured original test IPA.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { root } from './precompile-files.mjs';
const [ipa, trace] = process.argv.slice(2);
if (!ipa || !trace) throw Error('Usage: node web/test-precompile-cli.mjs FIXTURE.ipa CAPTURE.json');
const original = JSON.parse(await readFile(trace, 'utf8'));
const directory = await mkdtemp(join(root, 'target/precompile-rejection-'));
try {
  for (const field of ['ipa', 'touchhle-runtime.wasm']) {
    const capture = structuredClone(original);
    if (field === 'ipa') capture.identity.ipa = '0'.repeat(64);
    else capture.identity.files[field] = '0'.repeat(64);
    const path = join(directory, `${field}.json`), output = join(directory, field);
    await writeFile(path, JSON.stringify(capture));
    const result = spawnSync(process.execPath, [join(root, 'web/precompile-ipa.mjs'), resolve(ipa), output,
      '--capture', path], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 1, result.error?.message ?? result.stderr);
    assert.match(result.stderr, /Capture does not match this IPA\/core runtime build/);
    assert.deepEqual(await readdir(output), [], 'No mismatched executable package emitted');
    console.log('PASS reject mismatched capture', field);
  }
  const result = spawnSync(process.execPath, [join(root, 'web/precompile-ipa.mjs'), resolve(ipa), directory,
    '--capture', resolve(trace)], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EEXIST/);
  console.log('PASS refuse existing output');
} finally { await rm(directory, { recursive: true, force: true }); }
