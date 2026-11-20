// SPDX-License-Identifier: MPL-2.0
// Candidate only. Proposed bridge ABI, NOT the current native seal API.
export const LIMITS = Object.freeze({ wire: 160 * 1024 * 1024, resident: 192 * 1024 * 1024,
  records: 524288, identity: 2048, heap: 1024 * 1024 * 1024, reserve: 64 * 1024 * 1024 });
export const runtimeFiles = Object.freeze(['touchhle-runtime.js', 'touchhle-runtime.wasm', 'touchhle-runtime.data',
  'runtime-worker.js', 'tci-jit.js', 'tci-precompile.mjs', 'audio-proxy.js', 'audio.mjs',
  'input.mjs', 'style.css', 'package-identity.mjs', 'guest-saves.js', 'save-session.mjs', 'external-open.js', 'text-input.js', 'external-links.mjs', 'save-transfer.mjs', 'preflight.mjs', 'touchhle_browser.wasm']);
const hashPattern = /^[a-f0-9]{64}$/;
const requireValue = (ok, reason) => { if (!ok) throw Error(reason); };
const verifiedIpas = new WeakMap(), verifiedSources = new WeakMap();
export async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    byte => byte.toString(16).padStart(2, '0')).join('');
}
// Blob snapshots are immutable. Handles never expose the verified snapshot;
// mounting reads that same snapshot afresh, without trusting mutable byte aliases.
export async function verifyIpa(file, expectedHash) {
  requireValue(file instanceof Blob && typeof expectedHash === 'string' && hashPattern.test(expectedHash), 'Invalid IPA verification request');
  const snapshot = Blob.prototype.slice.call(file);
  requireValue(snapshot.size > 0 && snapshot.size <= 256 * 1024 * 1024, 'Invalid or oversized IPA');
  requireValue(await sha256(await snapshot.arrayBuffer()) === expectedHash, 'IPA fingerprint mismatch');
  const handle = Object.freeze({});
  verifiedIpas.set(handle, { snapshot, hash: expectedHash });
  return handle;
}
async function checkIpa(ipa, expectedHash) {
  const verified = verifiedIpas.get(ipa);
  requireValue((verified ? verified.hash : await sha256(ipa)) === expectedHash, 'IPA fingerprint mismatch');
}
export async function writeVerifiedIpa(runtime, handle) {
  const verified = verifiedIpas.get(handle);
  requireValue(verified, 'Invalid verified IPA handle');
  runtime.FS.writeFile('/app.ipa', new Uint8Array(await verified.snapshot.arrayBuffer()));
}
// Transfer before hashing: caller aliases detach and only this module owns the
// checked bytes until prepare consumes the handle. No extra archive copy.
export async function verifyArchiveSource(source, expectedHash) {
  requireValue(source instanceof ArrayBuffer && source.byteLength > 0 && source.byteLength <= LIMITS.wire,
    'Invalid archive length');
  requireValue(expectedHash === undefined || typeof expectedHash === 'string' && hashPattern.test(expectedHash),
    'Invalid archive fingerprint');
  const bytes = structuredClone(source, { transfer: [source] });
  const hash = await sha256(bytes);
  requireValue(expectedHash === undefined || hash === expectedHash, 'Native archive fingerprint mismatch');
  const handle = Object.freeze({});
  verifiedSources.set(handle, { bytes, hash });
  return handle;
}
export function checkIdentity(identity) {
  requireValue(identity && typeof identity.ipa === 'string' && hashPattern.test(identity.ipa) && identity.files &&
    Object.keys(identity.files).length === runtimeFiles.length &&
    runtimeFiles.every(name => typeof identity.files[name] === 'string' && hashPattern.test(identity.files[name])), 'Invalid package identity');
}
export function checkPortableIdentity(archive, expected) {
  checkIdentity(expected);
  checkIdentity(archive?.identity);
  requireValue(archive.identity.ipa === expected.ipa &&
    runtimeFiles.every(name => archive.identity.files[name] === expected.files[name]),
    'Portable archive fingerprint mismatch');
}
export function descriptor(identity, bridgeHash, options = { headless: false, optionsHash: null }) {
  requireValue(typeof options.headless === 'boolean' &&
    (options.optionsHash === null || hashPattern.test(options.optionsHash)) &&
    Object.keys(options).every(key => ['headless', 'optionsHash'].includes(key)), 'Invalid launch options');
  checkIdentity(identity);
  requireValue(typeof bridgeHash === 'string' && hashPattern.test(bridgeHash), 'Invalid bridge hash');
  // Deterministic UTF-8, fixed field/file order, no caller configuration token.
  const bytes = new TextEncoder().encode(JSON.stringify({ format: 1,
    profile: 'touchhle-browser-arm-a15-v1', bridge: bridgeHash, ipa: identity.ipa,
    options: { headless: options.headless, optionsHash: options.optionsHash },
    files: runtimeFiles.map(name => [name, identity.files[name]]) }));
  requireValue(bytes.length <= LIMITS.identity, 'Identity too large');
  return bytes;
}
export async function readBounded(response, cap) {
  requireValue(response.ok && response.body, 'Artifact fetch failed');
  const stated = response.headers.get('content-length');
  if (stated !== null && (!/^\d+$/.test(stated) || Number(stated) > cap)) {
    await response.body.cancel().catch(() => {});
    throw Error('Artifact too large');
  }
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      requireValue(value.byteLength <= cap - length, 'Artifact too large');
      length += value.byteLength; chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function verifiedPackage(bootstrap, expected, ipa, get = fetch) {
  checkIdentity(expected);
  requireValue(bootstrap?.workerHash === expected.files['runtime-worker.js'], 'Worker was not verified by launcher');
  await checkIpa(ipa, expected.ipa);
  const retained = {};
  // Sequential: one transient hash input at a time. Retain only actual load bytes.
  for (const name of runtimeFiles) {
    if (name === 'runtime-worker.js') continue; // Launcher hashes the exact executed Blob.
    const cap = name.endsWith('.wasm') ? 256 * 1024 * 1024 :
      name.endsWith('.data') ? 128 * 1024 * 1024 : 8 * 1024 * 1024;
    const bytes = await readBounded(await get(new URL(name, bootstrap.base), { cache: 'no-store' }), cap);
    requireValue(await sha256(bytes) === expected.files[name], `Fingerprint mismatch: ${name}`);
    if (['touchhle-runtime.js', 'touchhle-runtime.wasm', 'touchhle-runtime.data', 'audio-proxy.js', 'tci-jit.js', 'tci-precompile.mjs', 'guest-saves.js', 'external-open.js', 'text-input.js'].includes(name))
      retained[name] = bytes;
  }
  return retained;
}
export function script(bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
  try { importScripts(url); } finally { URL.revokeObjectURL(url); }
}
export async function prepare(runtime, request, identity, ipa, bridgeHash, options) {
  requireValue(request && typeof request.capture === 'boolean' &&
    (request.capture || request.source !== undefined), 'Explicit capture or import required');
  requireValue(Object.keys(request).every(key => ['capture', 'source', 'sourceSha256'].includes(key)), 'Unknown archive option');
  requireValue(request.source === undefined || verifiedSources.has(request.source) || (request.source instanceof ArrayBuffer &&
    request.source.byteLength > 0 && request.source.byteLength <= LIMITS.wire), 'Invalid archive length');
  requireValue(request.sourceSha256 === undefined || request.source !== undefined &&
    typeof request.sourceSha256 === 'string' && hashPattern.test(request.sourceSha256), 'Invalid archive fingerprint');
  checkIdentity(identity);
  await checkIpa(ipa, identity.ipa);
  // Hash the complete verified manifest, leaving bounded native namespace space
  // for the actual loader option transcript.
  const id = new Uint8Array(await crypto.subtle.digest('SHA-256', descriptor(identity, bridgeHash, options)));
  const names = ['setup', 'import', 'freeze', 'export', 'clear', 'status', 'stat'];
  for (const name of names) requireValue(typeof runtime[`_touchhle_web_tb_${name}`] === 'function', 'Native archive bridge unavailable');
  requireValue(typeof runtime._malloc === 'function' && typeof runtime._free === 'function', 'Native allocation exports unavailable');
  let state = 'new', sourceHash, sourceBytes;
  const heap = () => {
    const bytes = runtime.HEAPU8;
    requireValue(bytes instanceof Uint8Array && bytes.byteLength <= LIMITS.heap, 'Invalid Wasm heap');
    return bytes;
  };
  const buffer = (length, action) => {
    requireValue(Number.isSafeInteger(length) && length > 0 && length <= LIMITS.wire, 'Invalid buffer length');
    const ptr = runtime._malloc(length) >>> 0;
    requireValue(ptr !== 0, 'Archive allocation failed');
    try {
      requireValue(ptr <= heap().length - length, 'Archive allocation outside heap');
      return action(ptr);
    } finally { runtime._free(ptr); }
  };
  const clear = () => {
    requireValue(runtime._touchhle_web_tb_clear() === 1, 'Native engine is busy');
    state = 'cleared';
  };
  try {
    // Keep the full digest and exact checked allocation; consume it only once.
    if (request.source) {
      const handle = verifiedSources.has(request.source) ? request.source
        : await verifyArchiveSource(request.source, request.sourceSha256);
      const verified = verifiedSources.get(handle);
      requireValue(request.sourceSha256 === undefined || verified.hash === request.sourceSha256,
        'Native archive fingerprint mismatch');
      sourceHash = verified.hash;
      sourceBytes = verified.bytes;
      verifiedSources.delete(handle);
    }
    buffer(id.length, ptr => {
      heap().set(id, ptr);
      requireValue(runtime._touchhle_web_tb_setup(ptr, id.length, request.capture ? 1 : 0,
        LIMITS.records, LIMITS.resident, LIMITS.wire, LIMITS.heap, LIMITS.reserve,
        sourceBytes?.byteLength ?? 0) === 1, 'Native archive setup rejected');
    });
    if (sourceBytes) buffer(sourceBytes.byteLength, ptr => {
      heap().set(new Uint8Array(sourceBytes), ptr);
      requireValue(runtime._touchhle_web_tb_import(ptr, sourceBytes.byteLength) === 1, 'Native archive import rejected');
    });
    state = 'ready';
  } catch (error) { clear(); throw error; }
  finally { sourceBytes = undefined; }
  return {
    sourceHash,
    snapshot() {
      const status = runtime._touchhle_web_tb_status();
      const busy = runtime._touchhle_web_tb_stat(19, 0) !== 0;
      if (busy) return { status, busy };
      const names = ['captures', 'restores', 'misses', 'frontendCalls', 'rejections',
        'records', 'wireBytes', 'residentBytes', 'quotaOmissions', 'allocationFailures',
        'deduplications', 'replacements', 'lookupProbes', 'coreRequestedPeak', 'coreRequestedBytes',
        'bridgeRequestedBytes', 'bridgeRequestedPeak', 'observedCombinedPeak', 'imported', 'runGuard', 'retainedCorePeak'];
      return { status, busy, ...Object.fromEntries(names.map((name, n) => [name,
        runtime._touchhle_web_tb_stat(n, 0) + runtime._touchhle_web_tb_stat(n, 1) * 2 ** 32])) };
    },
    // Synchronous handler: no await or emulation reentry between freeze/query/copy.
    exportTo(post) {
      requireValue(state === 'ready', 'Archive is not exportable');
      requireValue(runtime._touchhle_web_tb_freeze() === 1, 'Native engine is busy or unavailable');
      state = 'frozen'; // Freeze is permanent. Guest may continue, capture cannot.
      let output;
      try {
        const length = runtime._touchhle_web_tb_export(0, 0);
        requireValue(Number.isSafeInteger(length) && length > 0 && length <= LIMITS.wire, 'Invalid export length');
        output = buffer(length, ptr => {
          requireValue(runtime._touchhle_web_tb_export(ptr, length) === length, 'Archive export failed');
          return heap().slice(ptr, ptr + length).buffer;
        });
      } finally { clear(); } // Release canonical storage before posting the one binary.
      post({ type: 'tb-archive', sourceHash, buffer: output }, [output]);
    },
    clear,
  };
}

export function portableModuleSource(bytes) {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const imports = source.match(/^import .*;$/gm) ?? [];
  requireValue(imports.length === 1 && imports[0] === "import './tci-jit.js';",
    'Unsupported portable module dependencies');
  requireValue(typeof globalThis.TouchHLETciJit === 'function', 'Verified compiler is not loaded');
  return source.replace("import './tci-jit.js';", '// Exact verified compiler is already loaded.');
}
export async function loadPortable(bytes) {
  const url = URL.createObjectURL(new Blob([portableModuleSource(bytes)], { type: 'text/javascript' }));
  try { return await import(url); } finally { URL.revokeObjectURL(url); }
}
