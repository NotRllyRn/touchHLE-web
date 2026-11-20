// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdir, mkdtemp, readFile, writeFile, rm, copyFile, stat, truncate, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageGame } from './package.mjs';
import { runtimeFiles, LIMITS } from './tb-archive-bridge.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const directory = await mkdtemp(join(root, 'target/tb-archive-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtime = join(directory, 'runtime'), capture = join(directory, 'capture');
  await mkdir(runtime); await mkdir(capture);
  const ipa = join(directory, 'synthetic.ipa'), output = join(directory, 'output');
  await writeFile(ipa, 'synthetic IPA identity only; not executable');
  const identity = { ipa: hash(await readFile(ipa)), files: {} };
  for (const name of [...runtimeFiles, 'tb-archive-bridge.mjs', 'launch.mjs']) {
    const actual = ['tci-jit.js', 'tci-precompile.mjs'].includes(name) ? join(root, 'web', name) :
      ['runtime-worker.js', 'tb-archive-bridge.mjs', 'launch.mjs'].includes(name) ? join(here, name) : null;
    if (actual) await copyFile(actual, join(runtime, name));
    else await writeFile(join(runtime, name), `synthetic ${name}`);
    if (runtimeFiles.includes(name)) identity.files[name] = hash(await readFile(join(runtime, name)));
  }
  for (const name of ['UNICORN-LICENSE', 'UNICORN-COPYING', 'UNICORN-COPYING.LGPL2', 'UNICORN-COPYING_GLIB']) {
    await writeFile(join(runtime, name), `synthetic notice ${name}`);
  }
  const abi = JSON.stringify({ version: 3, names: ['exit_tb'] });
  // Original synthetic TCI exit record; compiled/validated only, never executed.
  const key = '0:' + Buffer.from([0, 10, 1, 0, 0, 0, 0, 0, 0, 0]).toString('base64');
  const record = { format: 1, abi, keys: [key, key], identity,
    launchOptions: { headless: false, optionsHash: null },
    helperSha256: hash(await readFile(join(runtime, 'tb-archive-bridge.mjs'))) };
  const save = () => writeFile(join(capture, 'capture.json'), JSON.stringify(record));
  await save(); await writeFile(join(capture, 'native.tb'), 'opaque synthetic trusted archive; no native import');
  return { ipa, runtime, capture, output, record, save, directory };
}
async function rejectsWithoutOutput(f, pattern) {
  await assert.rejects(packageGame(f), pattern);
  await assert.rejects(stat(f.output), { code: 'ENOENT' });
}

test('paired static package preserves exact bytes, hashes, ABI3 and notices without execution', async t => {
  const f = await fixture(t), result = await packageGame(f);
  assert.equal(result.portableBlocks, 1);
  for (const name of [...runtimeFiles, 'tb-archive-bridge.mjs', 'launch.mjs']) {
    assert.deepEqual(await readFile(join(f.output, name)), await readFile(join(f.runtime, name)));
  }
  assert.deepEqual(await readFile(join(f.output, 'game.ipa')), await readFile(f.ipa));
  assert.deepEqual(await readFile(join(f.output, 'native.tb')), await readFile(join(f.capture, 'native.tb')));
  const manifest = JSON.parse(await readFile(join(f.output, 'game.json')));
  for (const [name, field] of [['native.tb', 'native'], ['precompiled.json', 'portable']]) {
    const bytes = await readFile(join(f.output, name));
    assert.equal(manifest[field].sha256, hash(bytes)); assert.equal(manifest[field].bytes, bytes.length);
  }
  const portable = JSON.parse(await readFile(join(f.output, 'precompiled.json')));
  assert.equal(JSON.parse(portable.abi).version, 3);
  assert.equal(portable.blocks.length, 1);
  assert(WebAssembly.validate(Buffer.from(portable.blocks[0].wasm, 'base64')));
  assert.match(await readFile(join(f.output, 'index.html'), 'utf8'), /worker-src 'self' blob:/);
  assert.doesNotMatch(await readFile(join(f.output, 'index.html'), 'utf8'), /type="file"/);
  assert.match(manifest.coverage, /not full-app AOT/);
  assert((await readdir(join(f.output, 'licenses'))).length >= 10);
  for (const name of ['UNICORN-LICENSE', 'UNICORN-COPYING', 'UNICORN-COPYING.LGPL2', 'UNICORN-COPYING_GLIB']) {
    assert.deepEqual(await readFile(join(f.output, 'licenses', name)), await readFile(join(f.runtime, name)));
  }
  for (const name of ['LICENSE', 'SOURCE.md', 'verified-launch.mjs', 'game.mjs', 'player.mjs', 'build-report.json']) assert((await stat(join(f.output, name))).isFile());
  await assert.rejects(packageGame(f), /already exists/);
  assert(!(await readdir(f.output)).some(name => name.endsWith('.gz')));
});

test('optional static gzip roundtrips to identical player, runtime and archive bytes', async t => {
  const f = await fixture(t);
  await writeFile(join(f.capture, 'native.tb'), Buffer.alloc(65536, 37));
  await packageGame(f);
  const compressedOutput = join(f.directory, 'compressed');
  const result = await packageGame({ ...f, output: compressedOutput, gzip: true });
  const report = JSON.parse(await readFile(join(compressedOutput, 'compression.json')));
  assert.equal(report.encoding, 'gzip'); assert.equal(report.files.length, result.gzipFiles);
  assert(report.files.some(r => r.file === 'native.tb'));
  assert(!report.files.some(r => r.file === 'game.ipa'));
  for (const row of report.files) {
    const raw = await readFile(join(compressedOutput, row.file));
    const encoded = await readFile(join(compressedOutput, row.file + '.gz'));
    assert(encoded.length < raw.length);
    assert.equal(row.bytes, raw.length); assert.equal(row.gzipBytes, encoded.length);
    assert.equal(row.sha256, hash(raw)); assert.equal(row.gzipSha256, hash(encoded));
    assert.deepEqual(gunzipSync(encoded), raw);
    // Truncated transport cannot silently become a valid decoded payload.
    assert.throws(() => gunzipSync(encoded.subarray(0, encoded.length - 4)));
  }
  for (const name of await readdir(f.output, { recursive: true })) {
    if ((await stat(join(f.output, name))).isFile())
      assert.deepEqual(await readFile(join(compressedOutput, name)), await readFile(join(f.output, name)), name);
  }
  const invalidOutput = join(f.directory, 'invalid');
  await assert.rejects(packageGame({ ...f, output: invalidOutput, gzip: 'yes' }), /boolean/);
  await assert.rejects(stat(invalidOutput), { code: 'ENOENT' });
});

test('each runtime identity member and the entire IPA must match before writes', async t => {
  const f = await fixture(t);
  for (const name of runtimeFiles) {
    const original = f.record.identity.files[name];
    f.record.identity.files[name] = '0'.repeat(64); await f.save();
    await rejectsWithoutOutput(f, /entire IPA\/runtime identity/);
    f.record.identity.files[name] = original;
  }
  f.record.identity.ipa = '0'.repeat(64); await f.save();
  await rejectsWithoutOutput(f, /entire IPA\/runtime identity/);
});

test('missing native archive (including a failed capture) and wire overflow reject before writes', async t => {
  const f = await fixture(t), native = join(f.capture, 'native.tb');
  await rm(native); await rejectsWithoutOutput(f, /ENOENT/);
  await writeFile(native, ''); await rejectsWithoutOutput(f, /Invalid or oversized/);
  await truncate(native, LIMITS.wire + 1); await rejectsWithoutOutput(f, /Invalid or oversized/);
});

test('missing or changed tracked worker, helper and launcher are refused', async t => {
  const f = await fixture(t);
  for (const name of ['runtime-worker.js', 'tb-archive-bridge.mjs', 'launch.mjs']) {
    const path = join(f.runtime, name), original = await readFile(path);
    await rm(path); await rejectsWithoutOutput(f, /ENOENT/);
    await writeFile(path, 'changed');
    if (runtimeFiles.includes(name)) { f.record.identity.files[name] = hash(await readFile(path)); await f.save(); }
    await rejectsWithoutOutput(f, /authoritative/);
    await writeFile(path, original);
    if (runtimeFiles.includes(name)) { f.record.identity.files[name] = hash(original); await f.save(); }
  }
  f.record.helperHash = '0'.repeat(64); await f.save();
  await rejectsWithoutOutput(f, /helper hash mismatch/);
});

test('headless, custom options, malformed ABI/keys/identity and oversized capture reject before writes', async t => {
  const f = await fixture(t), original = structuredClone(f.record);
  const cases = [
    [{ headless: true }, /Headless/],
    [{ headless: false, optionsHash: '0'.repeat(64) }, /options/],
    [{ options: { headless: true, optionsHash: null } }, /options/],
    [{ options: { headless: false, optionsHash: null, unknown: 1 } }, /options/],
    [{ format: 2 }, /format/],
    [{ abi: JSON.stringify({ version: 9, names: [] }) }, /ABI/],
    [{ keys: ['0:AA=='] }, /operation/],
    [{ keys: Array(32769).fill(original.keys[0]) }, /keys/],
    [{ keys: [1] }, /key/],
    [{ identity: { ...original.identity, files: {} } }, /identity/],
  ];
  for (const [change, pattern] of cases) {
    Object.keys(f.record).forEach(key => delete f.record[key]);
    Object.assign(f.record, structuredClone(original), change); await f.save();
    await rejectsWithoutOutput(f, pattern);
  }
});

test('changed compiler rejected even with updated capture identity', async t => {
  const f = await fixture(t);
  await writeFile(join(f.runtime, 'tci-jit.js'), 'changed compiler');
  f.record.identity.files['tci-jit.js'] = hash(await readFile(join(f.runtime, 'tci-jit.js'))); await f.save();
  await rejectsWithoutOutput(f, /Unsupported compiler bytes/);
});

test('empty portable coverage is explicit and valid; native-only captured coverage may remain useful', async t => {
  const f = await fixture(t);
  f.record.keys = []; f.record.options = { headless: false, optionsHash: null }; await f.save();
  assert.equal((await packageGame(f)).portableBlocks, 0);
});


test('new capture metadata is required and every alias must agree before writes', async t => {
  const f = await fixture(t), original = structuredClone(f.record);
  const cases = [
    { launchOptions: undefined },
    { launchOptions: null },
    { launchOptions: {} },
    { launchOptions: { headless: true, optionsHash: null } },
    { launchOptions: { headless: false, optionsHash: 'custom' } },
    { launchOptions: { headless: false, optionsHash: null, extra: false } },
    { helperSha256: undefined },
    { helperSha256: null },
    { helperSha256: '0'.repeat(64) },
    { helperHash: '0'.repeat(64) },
    { bridgeHash: '0'.repeat(64) },
    { options: null },
    { options: { headless: true, optionsHash: null } },
    { headless: false },
    { optionsHash: null },
    { headless: true, optionsHash: null },
    { headless: false, optionsHash: 'custom' },
    { helperSha256: '0'.repeat(64), helperHash: original.helperSha256 },
  ];
  for (const change of cases) {
    Object.keys(f.record).forEach(key => delete f.record[key]);
    Object.assign(f.record, structuredClone(original), change); await f.save();
    await rejectsWithoutOutput(f, /launch options|options|Headless|helper/i);
  }
});

test('complete consistent legacy aliases are explicit alternatives to new metadata', async t => {
  for (const optionAlias of ['options', 'flat']) {
    for (const helperAlias of ['helperHash', 'bridgeHash']) {
      const f = await fixture(t);
      if (optionAlias === 'flat') Object.assign(f.record, f.record.launchOptions);
      else f.record.options = f.record.launchOptions;
      f.record[helperAlias] = f.record.helperSha256;
      delete f.record.launchOptions; delete f.record.helperSha256; await f.save();
      assert.equal((await packageGame(f)).portableBlocks, 1);
    }
  }
  const f = await fixture(t);
  Object.assign(f.record, f.record.launchOptions, { options: f.record.launchOptions,
    helperHash: f.record.helperSha256, bridgeHash: f.record.helperSha256 });
  await f.save(); assert.equal((await packageGame(f)).portableBlocks, 1);
});


test('archive-only package requires its own runtime notices before creating output', async t => {
  const f = await fixture(t);
  await rm(join(f.runtime, 'UNICORN-COPYING.LGPL2'));
  await rejectsWithoutOutput(f, /UNICORN-COPYING.LGPL2/);
});

test('replay capture binds the copied native archive before package writes', async t => {
  const f = await fixture(t), bytes = await readFile(join(f.capture, 'native.tb'));
  for (const source of [null, {}, { bytes: bytes.length, sha256: '0'.repeat(64) },
    { bytes: bytes.length + 1, sha256: hash(bytes) }]) {
    f.record.nativeSource = source; await f.save();
    await rejectsWithoutOutput(f, /Replay capture native source mismatch/);
  }
  f.record.nativeSource = { bytes: bytes.length, sha256: hash(bytes) }; await f.save();
  assert.equal((await packageGame(f)).portableBlocks, 1);
  assert.deepEqual(await readFile(join(f.output, 'native.tb')), bytes);
});
