// SPDX-License-Identifier: MPL-2.0
// Local only: no emulator execution, capture, server, or publication.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { createGzip, createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { readFile, writeFile, mkdir, readdir, realpath, stat, rename, rm, mkdtemp } from 'node:fs/promises';
import { resolve, dirname, join, sep, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { runtimeFiles, checkIdentity, descriptor, LIMITS } from './tb-archive-bridge.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requireValue = (ok, message) => { if (!ok) throw Error(message); };
const inside = (parent, path) => path === parent || path.startsWith(parent + sep);
const options = { headless: false, optionsHash: null };
const coverage = 'Partial profile coverage. Matching native TBs skip ARM decoding; matching portable records reuse offline Wasm. Missing/rejected native records use normal runtime ARM decoding; portable misses use JIT/interpreter. Browser Wasm compilation remains necessary. This is not full-app AOT.';

async function boundedFile(path, cap) {
  const info = await stat(path);
  requireValue(info.isFile() && info.size > 0 && info.size <= cap, `Invalid or oversized input: ${basename(path)}`);
  const bytes = await readFile(path);
  requireValue(bytes.length > 0 && bytes.length <= cap, `Input changed or exceeds bound: ${basename(path)}`);
  return bytes;
}

// HTTP content encoding changes the transfer representation, never the bytes
// consumed by the player or its identity checks. Keep the raw fallback files.
async function gzipSidecar(path, bytes) {
  const encoded = path + '.gz';
  await pipeline(createReadStream(path), createGzip({ level: 6 }), createWriteStream(encoded, { flags: 'wx' }));
  const gzipBytes = (await stat(encoded)).size;
  if (gzipBytes >= bytes.length) { await rm(encoded); return null; }
  const decodedHash = createHash('sha256'); let decodedBytes = 0;
  await pipeline(createReadStream(encoded), createGunzip(), async source => {
    for await (const chunk of source) {
      decodedBytes += chunk.length;
      requireValue(decodedBytes <= bytes.length, 'Gzip output exceeds source length');
      decodedHash.update(chunk);
    }
  });
  const sha256 = hash(bytes);
  requireValue(decodedBytes === bytes.length && decodedHash.digest('hex') === sha256,
    'Gzip roundtrip does not match source');
  const encodedHash = createHash('sha256');
  for await (const chunk of createReadStream(encoded)) encodedHash.update(chunk);
  return { bytes: bytes.length, gzipBytes, sha256, gzipSha256: encodedHash.digest('hex') };
}

export async function packageGame({ ipa, runtime, capture: captureDirectory, output, gzip = false }) {
  requireValue(typeof gzip === 'boolean', 'gzip must be a boolean');
  [ipa, runtime, captureDirectory, output] = [ipa, runtime, captureDirectory, output].map(path => resolve(path));
  // Resolve parent symlinks as well as lexical paths. Parent must already exist.
  output = join(await realpath(dirname(output)), basename(output));
  const actualRoot = await realpath(root);
  requireValue(!inside(actualRoot, output) || inside(join(actualRoot, 'target'), output), 'Repository output must be below target/');
  requireValue(output !== join(actualRoot, 'target'), 'Output must be a new directory below target/');
  try { await stat(output); throw Error('Output already exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }

  const native = await boundedFile(join(captureDirectory, 'native.tb'), LIMITS.wire);
  const capture = JSON.parse(await boundedFile(join(captureDirectory, 'capture.json'), 40 * 1024 * 1024));
  requireValue(capture.format === 1, 'Unsupported capture format');
  if (capture.nativeSource !== undefined) {
    requireValue(capture.nativeSource?.bytes === native.length &&
      capture.nativeSource?.sha256 === hash(native), 'Replay capture native source mismatch');
  }
  checkIdentity(capture.identity);
  const optionFields = ['launchOptions', 'options'].filter(name => Object.hasOwn(capture, name));
  const flatOptions = ['headless', 'optionsHash'].some(name => Object.hasOwn(capture, name));
  requireValue(optionFields.length > 0 || flatOptions, 'Missing capture launch options');
  for (const name of optionFields) {
    const value = capture[name];
    requireValue(value !== null && typeof value === 'object' && !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) === JSON.stringify(['headless', 'optionsHash']) &&
      value.headless === false && value.optionsHash === null, `Capture ${name} launch options are incompatible`);
  }
  if (flatOptions) {
    requireValue(capture.headless === false, 'Headless capture is incompatible or incomplete');
    requireValue(capture.optionsHash === null, 'Capture options are incompatible or incomplete');
  }

  const input = await boundedFile(ipa, 256 * 1024 * 1024);
  const files = {}, identity = { ipa: hash(input), files: {} };
  for (const name of [...runtimeFiles, 'tb-archive-bridge.mjs', 'launch.mjs']) {
    const cap = name.endsWith('.wasm') ? 256 * 1024 * 1024 : name.endsWith('.data') ? 128 * 1024 * 1024 : 8 * 1024 * 1024;
    files[name] = await boundedFile(join(runtime, name), cap);
    if (runtimeFiles.includes(name)) identity.files[name] = hash(files[name]);
  }
  requireValue(identity.ipa === capture.identity.ipa && runtimeFiles.every(name => identity.files[name] === capture.identity.files[name]),
    'Capture does not match entire IPA/runtime identity');
  // Pin tracked integration bytes independently of the capture's helper digest.
  for (const name of ['runtime-worker.js', 'tb-archive-bridge.mjs', 'launch.mjs']) {
    requireValue(hash(files[name]) === hash(await readFile(join(here, name))),
      `Runtime ${name} differs from authoritative tracked integration`);
  }
  const helperHash = hash(files['tb-archive-bridge.mjs']);
  const helperFields = ['helperSha256', 'helperHash', 'bridgeHash'].filter(name => Object.hasOwn(capture, name));
  requireValue(helperFields.length > 0, 'Missing capture helper SHA256');
  for (const name of helperFields) {
    requireValue(capture[name] === helperHash, 'Capture helper hash mismatch');
  }
  descriptor(identity, helperHash, options);

  // Use the existing reviewed compiler, never an executable from a supplied
  // directory. Require its exact bytes to match the captured runtime compiler.
  for (const name of ['tci-precompile.mjs', 'tci-jit.js']) {
    requireValue(hash(files[name]) === hash(await readFile(join(root, 'web', name))), `Unsupported compiler bytes: ${name}`);
  }
  const { canonicalRecord, compileRecord, encodeBytes, MAX_CACHE_BYTES, MAX_CACHE_BLOCKS } = await import('../tci-precompile.mjs');
  requireValue(typeof capture.abi === 'string' && capture.abi.length <= 65536, 'Invalid capture ABI');
  const layout = JSON.parse(capture.abi);
  requireValue([1, 2, 3].includes(layout.version) && Array.isArray(layout.names) && layout.names.length > 0 &&
    layout.names.length <= 256 && layout.names.every(name => typeof name === 'string' && name.length <= 128), 'Unsupported capture ABI');
  requireValue(Array.isArray(capture.keys) && capture.keys.length <= MAX_CACHE_BLOCKS, 'Invalid or oversized capture keys');
  const abi = JSON.stringify({ ...layout, version: 3 });
  const blocks = [], seen = new Set();
  let cacheBytes = 0, wasmBytes = 0, keyBytes = 0;
  for (const key of capture.keys) {
    requireValue(typeof key === 'string' && key.length <= 90000, 'Invalid portable key');
    keyBytes += key.length;
    requireValue(keyBytes <= 32 * 1024 * 1024, 'Capture keys exceed bound');
    const canonical = canonicalRecord(key, capture.abi);
    if (seen.has(canonical)) continue;
    const bytes = compileRecord(canonical, abi);
    requireValue(bytes.length <= 262500 && canonical.length <= 90000, 'Portable entry exceeds player bound');
    cacheBytes += bytes.length + canonical.length;
    requireValue(cacheBytes <= MAX_CACHE_BYTES, 'Portable cache exceeds memory bound');
    seen.add(canonical); wasmBytes += bytes.length;
    blocks.push({ key: canonical, wasm: encodeBytes(bytes) });
  }
  const portable = Buffer.from(JSON.stringify({ format: 1, abi, identity, blocks }));
  const archive = { bytes: native.length, sha256: hash(native) };
  const manifest = { format: 1, name: basename(ipa, '.ipa'), identity, helperHash, options,
    launcherHash: hash(files['launch.mjs']), native: archive,
    portable: { bytes: portable.length, sha256: hash(portable) }, jitThreshold: 32, coverage };

  // Read all notices before creating any output. Preserve existing packaging's
  // license catalog and source-distribution caveat without copying game traces.
  const notices = { LICENSE: await readFile(join(root, 'LICENSE')) };
  for (const name of ['UNICORN-LICENSE', 'UNICORN-COPYING', 'UNICORN-COPYING.LGPL2', 'UNICORN-COPYING_GLIB']) {
    notices[`licenses/${name}`] = await boundedFile(join(runtime, name), 1024 * 1024);
  }
  const sources = ['src/licenses.rs', 'vendor/SDL/LICENSE.txt',
    'vendor/stb/LICENSE', 'vendor/PVRTDecompress/LICENSE.md'];
  for (const [directory, prefix] of [['touchHLE_fonts', 'LICENSE'], ['touchHLE_dylibs', 'COPYING']]) {
    for (const name of await readdir(join(root, directory))) if (name.startsWith(prefix)) sources.push(`${directory}/${name}`);
  }
  for (const source of sources) notices[`licenses/${source.replaceAll('/', '-')}`] = await readFile(join(root, source));
  for (const name of ['game.mjs', 'player.mjs', 'verified-launch.mjs', 'index.html', 'SOURCE.md']) files[name] = await readFile(join(here, name));
  const report = { format: 1, mode: 'paired-native-tb-portable-wasm', identity, helperHash,
    launcherHash: manifest.launcherHash, options, native: archive, portable: manifest.portable,
    capturedKeys: capture.keys.length, portableBlocks: blocks.length, wasmBytes, cacheBytes, coverage,
    validation: 'Input hashes and portable Wasm validation only; no native archive import, browser, guest execution, or timings.' };

  // Reserve the final path without overwrite; stage internally, clean on error.
  await mkdir(output);
  let staging;
  const compressed = [];
  try {
    staging = await mkdtemp(join(output, '.staging-'));
    await mkdir(join(staging, 'licenses'));
    for (const [name, bytes] of Object.entries({ ...files, ...notices, 'game.ipa': input, 'native.tb': native,
      'precompiled.json': portable, 'game.json': JSON.stringify(manifest, null, 2), 'build-report.json': JSON.stringify(report, null, 2) })) {
      await writeFile(join(staging, name), bytes, { flag: 'wx' });
      // IPA contents are already ZIP-compressed. Avoid spending host time
      // recompressing them; target the large TCI/Wasm/JSON and runtime payloads.
      if (gzip && /\.(?:tb|wasm|data|json|m?js|css|html)$/.test(name)) {
        const source = typeof bytes === 'string' ? Buffer.from(bytes) : bytes;
        if (source.length >= 1024) {
          const result = await gzipSidecar(join(staging, name), source);
          if (result) compressed.push({ file: name, ...result });
        }
      }
    }
    if (gzip) await writeFile(join(staging, 'compression.json'), JSON.stringify({ format: 1,
      encoding: 'gzip', level: 6, files: compressed,
      serving: 'Serve the .gz sibling at the original URL with Content-Encoding: gzip, the original Content-Type, and Vary: Accept-Encoding. Use raw files when gzip is not accepted. IPA is unchanged.' }, null, 2), { flag: 'wx' });
    for (const name of await readdir(staging)) await rename(join(staging, name), join(output, name));
    await rm(staging, { recursive: true });
  } catch (error) { await rm(output, { recursive: true, force: true }); throw error; }
  return { output, portableBlocks: blocks.length, nativeBytes: native.length, cacheBytes, gzipFiles: compressed.length };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { positionals, values } = parseArgs({ allowPositionals: true, options: { gzip: { type: 'boolean', default: false } } });
    requireValue(positionals.length === 4,
      'Usage: node web/tb-archive/package.mjs [--gzip] INPUT.ipa EXACT_RUNTIME_DIST CAPTURE_DIRECTORY NEW_OUTPUT_DIRECTORY');
    const [ipa, runtime, capture, output] = positionals;
    const result = await packageGame({ ipa, runtime, capture, output, gzip: values.gzip });
    console.log(`Local static package: ${result.output}\nNative bytes: ${result.nativeBytes}; portable blocks: ${result.portableBlocks}; cache bytes: ${result.cacheBytes}.\nPartial coverage; ordinary runtime decode/JIT fallback remains. No publication performed.`);
    if (values.gzip) console.log(`Verified gzip sidecars: ${result.gzipFiles}. Configure static Content-Encoding negotiation; see compression.json.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
