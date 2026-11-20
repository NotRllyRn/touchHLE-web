// SPDX-License-Identifier: MPL-2.0
import { installPlayer } from './player.mjs';
const run = document.querySelector('#run'), stop = document.querySelector('#stop');
const state = document.querySelector('#state'), log = document.querySelector('#status');
const baseline = new URLSearchParams(location.search).get('baseline') === '1';
let game, file, source, precompiled, AudioBridge, attachInput, attachSaveSession, attachExternalLinks, transfer;
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  byte => byte.toString(16).padStart(2, '0')).join('');
async function read(name, cap, signal) {
  const response = await fetch(new URL(name, import.meta.url), { cache: 'no-store', signal });
  if (!response.ok || !response.body) throw Error(`${name}: fetch failed`);
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > cap)) {
    await response.body.cancel(); throw Error(`${name}: exceeds bound`);
  }
  const reader = response.body.getReader(), chunks = [];
  let total = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > cap) throw Error(`${name}: exceeds bound`);
      chunks.push(value);
    }
    signal?.throwIfAborted();
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function verified(name, cap, expected, size, signal) {
  const bytes = await read(name, cap, signal);
  if ((size !== undefined && bytes.length !== size) || await digest(bytes) !== expected) throw Error(`${name}: fingerprint mismatch`);
  signal?.throwIfAborted();
  return bytes;
}
const reloadNative = async signal => {
  if (!game.native || !Number.isSafeInteger(game.native.bytes) || game.native.bytes <= 0 ||
    game.native.bytes > 160 * 1024 * 1024 || typeof game.native.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(game.native.sha256)) throw Error('Invalid native archive identity');
  const bytes = await read('native.tb', 160 * 1024 * 1024, signal);
  if (bytes.length !== game.native.bytes) throw Error('native.tb: length mismatch');
  // The worker checks the expected digest on the transferred allocation before
  // runtime scripts execute. Reload and first Play use the same path.
  return bytes;
};
async function moduleFrom(bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
  try { return await import(url); } finally { URL.revokeObjectURL(url); }
}
try {
  game = JSON.parse(new TextDecoder().decode(await read('game.json', 16384)));
  if (game.format !== 1 || game.options?.headless !== false || game.options?.optionsHash !== null) throw Error('Incompatible game package');
  // Execute identity validation only after checking the exact helper bytes.
  const helper = await verified('tb-archive-bridge.mjs', 1024 * 1024, game.helperHash);
  const verifier = await moduleFrom(helper);
  if (!['verifyIpa', 'writeVerifiedIpa', 'verifyArchiveSource'].every(name => typeof verifier[name] === 'function'))
    throw Error('Incompatible payload verification helper; regenerate the complete package');
  const { checkIdentity, runtimeFiles } = verifier;
  checkIdentity(game.identity);
  const loaded = {};
  for (const name of runtimeFiles) {
    loaded[name] = await verified(name, name.endsWith('.wasm') ? 256 * 1024 * 1024 :
      name.endsWith('.data') ? 128 * 1024 * 1024 : 8 * 1024 * 1024, game.identity.files[name]);
    if (!['audio.mjs', 'input.mjs', 'save-session.mjs', 'external-open.js', 'text-input.js', 'external-links.mjs', 'guest-saves.js', 'save-transfer.mjs', 'preflight.mjs', 'touchhle_browser.wasm'].includes(name)) delete loaded[name];
  }
  await verified('launch.mjs', 1024 * 1024, game.launcherHash);
  // Immutable Blob crosses to the worker; it verifies the exact consumed IPA.
  const ipa = await verified('game.ipa', 256 * 1024 * 1024, game.identity.ipa);
  file = new Blob([ipa]);
  source = await reloadNative();
  const portable = await verified('precompiled.json', 96 * 1024 * 1024, game.portable.sha256, game.portable.bytes);
  precompiled = JSON.parse(new TextDecoder().decode(portable));
  if (precompiled.format !== 1) throw Error('Unsupported portable archive');
  const { checkPortableIdentity } = await moduleFrom(helper);
  checkPortableIdentity(precompiled, game.identity);
  ({ AudioBridge } = await moduleFrom(loaded['audio.mjs']));
  ({ attachInput } = await moduleFrom(loaded['input.mjs']));
  ({ attachSaveSession } = await moduleFrom(loaded['save-session.mjs']));
  await moduleFrom(loaded['external-open.js']);
  await moduleFrom(loaded['text-input.js']);
  ({ attachExternalLinks } = await moduleFrom(loaded['external-links.mjs']));
  await moduleFrom(loaded['guest-saves.js']);
  const { installSaveTransfer } = await moduleFrom(loaded['save-transfer.mjs']);
  const { inspectBytes } = await moduleFrom(loaded['preflight.mjs']);
  const { instance } = await WebAssembly.instantiate(loaded['touchhle_browser.wasm'], {});
  const inspected = inspectBytes(instance.exports, ipa);
  if (!inspected.ok) throw Error(inspected.error);
  transfer = installSaveTransfer({ id: inspected.app.bundleId,
    onBusy: () => { run.disabled = !file || !!transfer?.busy || !!transfer?.active; } });
  document.title = document.querySelector('#title').textContent = game.name;
  document.querySelector('#coverage').textContent = game.coverage;
  state.textContent = 'Ready';
  log.textContent = baseline ? 'Diagnostic baseline: normal decode/JIT, both archives disabled.' : 'Paired native TB + portable Wasm.';
  run.disabled = false;
} catch (error) { file = undefined; state.textContent = 'Stopped'; log.textContent = `Unable to load game: ${error.message}`; }

if (file) installPlayer({ run, stop, state, log, document, game, file, source, precompiled,
  AudioBridge, attachInput, attachSaveSession, attachExternalLinks, transfer, baseline, read, digest, reloadNative });
// Ownership moves to the player, then to the worker on the first paired Play.
source = undefined;
