// SPDX-License-Identifier: MPL-2.0
import { AudioBridge } from './audio.mjs';
import { attachInput } from './input.mjs';
import { checkIdentity, verifyFile, runtimeFiles } from './package-identity.mjs';
import { loadGame } from './game-cache.mjs';
const $ = selector => document.querySelector(selector);
const state = $('#state'), running = $('#running-state'), bar = $('#progress');
const options = $('#options'), filesDialog = $('#files-dialog'), restartDialog = $('#restart-dialog');
const pendingLoops = new Map();
let generation = 0, worker, audio, audioClock, audioOffset, saves, input, external, textEntry, transfer;
let game, file, precompiled, attachSaveSession, attachExternalLinks, ready = false, action = false, stopping;
const status = message => { state.textContent = message; running.textContent = message; };
const controls = () => {
  $('#restart').disabled = $('#saved-files').disabled = !ready || action || !!transfer?.busy;
  $('#resume').disabled = !!transfer?.busy;
};
const get = async path => {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw Error(`${path}: HTTP ${response.status}`);
  return response;
};
function finish() {
  generation++; pendingLoops.clear(); audioOffset = undefined; $('#retry-save').hidden = true;
  textEntry?.dispose(); textEntry = undefined;
  external?.dispose(); external = undefined;
  input?.cancel(); input = undefined;
  saves?.dispose(); saves = undefined;
  worker?.terminate(); worker = undefined;
  if (audio) { void audio.close().catch(() => {}); audio = undefined; }
  transfer?.setActive(false);
  controls();
}
function unlockAudio() {
  const bridge = audio;
  if (bridge && bridge.context.state !== 'running') void bridge.context.resume().catch(() => {
    if (audio === bridge) $('#sound').textContent = 'Try enabling sound';
  });
}
// A real canvas/menu gesture unlocks sound; startup never waits on resume().
for (const name of ['pointerdown', 'keydown']) document.addEventListener(name, event => {
  if (event.isTrusted) unlockAudio();
}, { capture: true });
$('#sound').onclick = unlockAudio;
$('#retry-save').onclick = () => { if (stopping) { status('Retrying save…'); saves.stop(); } };
// Keep one translation while running: resampling two independent clocks for
// each command introduces gaps/overlap between contiguous worker buffers.
function syncAudioClock() {
  if (audio.context.state !== 'running') { audioOffset = undefined; return; }
  if (audioOffset === undefined) audioOffset = audioClock.time +
    (performance.timeOrigin + performance.now() - audioClock.timestamp) / 1000 - audio.context.currentTime;
}
function resumeLoops() {
  for (const [id, pending] of pendingLoops) {
    const node = audio?.nodes.get(id);
    if (node) {
      const duration = node.buffer?.duration || 0;
      const elapsed = (performance.now() - pending.at) / 1000;
      const offset = duration > 0 ? (pending.command.offset + elapsed) % duration : 0;
      try { audio.handle({ ...pending.command, when: audio.context.currentTime, offset }); } catch { /* An ended source stays silent. */ }
    }
  }
  pendingLoops.clear();
}
function handleAudio(data) {
  if (!audio) return;
  syncAudioClock();
  if (data.op !== 'create' && data.id !== undefined && !audio.nodes.has(data.id)) return;
  const node = audio.nodes.get(data.id);
  if (data.op === 'start' && audio.context.state !== 'running') {
    if (node.loop) pendingLoops.set(data.id, { command: data, at: performance.now() });
    else audio.discard(data.id);
    return; // Never queue stale one-shots behind an autoplay restriction.
  }
  if (data.op === 'stop' && pendingLoops.delete(data.id)) { audio.discard(data.id); return; }
  const offset = audioOffset ?? (audioClock.time +
    (performance.timeOrigin + performance.now() - audioClock.timestamp) / 1000 - audio.context.currentTime);
  const command = { ...data };
  for (const key of ['when', 'time']) if (typeof command[key] === 'number' && command[key] > 0) command[key] = Math.max(0, command[key] - offset);
  audio.handle(command);
}
function stopGame() {
  if (stopping) return stopping.promise;
  if (!worker) return Promise.resolve();
  status('Saving progress…');
  input?.cancel(); textEntry?.dispose(); textEntry = undefined; external?.dispose();
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  stopping = { promise, resolve, reject };
  saves.stop();
  return promise;
}
async function startGame() {
  if (!ready || worker || transfer?.busy) return;
  finish(); const current = generation;
  const active = () => current === generation;
  transfer.setActive(true);
  status('Starting game…');
  $('#loading').hidden = true; $('#toolbar').hidden = false;
  try {
    // Keep the exact audio bridge, but do not await autoplay permission.
    try {
      audio = new AudioBridge(undefined, { smoothUnderruns: true });
      const context = audio.context;
      audioClock = { sampleRate: context.sampleRate, time: context.currentTime, timestamp: performance.timeOrigin + performance.now() };
      audioOffset = undefined; // Anchor on the first running observation.
      context.onstatechange = () => { if (active()) { syncAudioClock(); $('#sound').textContent = context.state === 'running' ? 'Sound enabled' : 'Enable sound'; if (context.state === 'running') resumeLoops(); } };
      unlockAudio();
    } catch { audio = undefined; audioClock = undefined; $('#sound').textContent = 'Sound unavailable'; }
    const previous = $('#canvas'), canvas = previous.cloneNode();
    canvas.hidden = false; previous.replaceWith(canvas);
    const owner = worker = new Worker('./runtime-worker.js');
    external = attachExternalLinks(owner);
    textEntry = globalThis.TouchHLEText.attach(owner);
    saves = attachSaveSession(owner, {
      onStatus: message => { if (active()) $('#save-state').textContent = message; },
      onStopped: () => {
        if (!active()) return;
        const done = stopping; stopping = undefined;
        finish(); status('Progress saved.'); done?.resolve();
      },
      onStopFailed: () => {
        if (!active()) return;
        // The session callback also represents a timeout, not cancellation.
        // Keep the intended action pending until its real save acknowledgement.
        status('Saving is still pending. Keep this tab open; retry from More options if needed.');
        $('#retry-save').hidden = false;
      },
    });
    void navigator.storage?.persist?.().catch(() => {});
    input = attachInput(canvas, message => { if (active()) owner.postMessage(message); });
    owner.onmessage = ({ data }) => {
      if (!active()) return;
      if (data.type?.startsWith('save-') || data.type?.startsWith('external-') || data.type?.startsWith('text-')) return;
      if (data.type === 'audio') {
        if (!audio) return;
        try { handleAudio(data);
        } catch { $('#sound').textContent = 'Sound unavailable'; }
        return;
      }
      if (data.type === 'exit' || data.type === 'error') {
        const done = stopping; stopping = undefined;
        finish();
        status(data.type === 'exit' && data.code === 0 ? 'Game closed. Restart from More options.' : 'The game could not continue. You can restart from More options.');
        done?.reject(Error('Game ended before the requested save-stop completed.'));
      } else if (!stopping) status('Game running · loading may take a moment');
    };
    owner.onerror = () => {
      if (!active()) return;
      status('The game encountered an error. Trying to save progress…');
      void stopGame().catch(error => status(error.message));
    };
    const offscreen = canvas.transferControlToOffscreen();
    owner.postMessage({ type: 'start', externalSession: external.session, persistentSaves: true,
      file, canvas: offscreen, audioClock, cpuBackend: 'jit',
      jitThreshold: new URLSearchParams(location.search).get('jitThreshold') === '1' ? 1 : game.jitThreshold, precompiled }, [offscreen]);
  } catch (error) {
    if (!active()) return;
    finish(); status(`Unable to start: ${error.message}`);
  }
}
async function perform(operation) {
  if (action || !ready) return;
  action = true; controls(); options.open = false;
  try { await operation(); }
  catch (error) { status(error.message); }
  finally { action = false; controls(); }
}
$('#restart').onclick = () => { options.open = false; restartDialog.showModal(); };
$('#cancel-restart').onclick = () => restartDialog.close();
$('#confirm-restart').onclick = () => {
  restartDialog.close();
  void perform(async () => { await stopGame(); await startGame(); });
};
$('#saved-files').onclick = () => void perform(async () => {
  await stopGame(); status('Saved files · game paused'); filesDialog.showModal();
});
$('#resume').onclick = () => { if (!transfer?.busy) filesDialog.close(); };
filesDialog.addEventListener('cancel', event => { if (transfer?.busy) event.preventDefault(); });
filesDialog.addEventListener('close', () => { void perform(startGame); });
options.addEventListener('keydown', event => { if (event.key === 'Escape') { options.open = false; options.querySelector('summary').focus(); } });
document.addEventListener('pointerdown', event => { if (!options.contains(event.target)) options.open = false; });
controls();
try {
  game = await (await get('./game.json')).json();
  if (game.format !== 1) throw Error('Unsupported game package');
  checkIdentity(game.identity, game.identity);
  document.title = $('#title').textContent = game.name;
  [file, precompiled] = await Promise.all([
    loadGame(game, {
      progress: ({ phase, received, total }) => {
        if (phase === 'checking') { status('Checking game files…'); bar.removeAttribute('value'); return; }
        if (total > 0) {
          const percent = Math.min(99, Math.floor(received / total * 100));
          status(`Downloading game… ${percent}%`); bar.max = 100; bar.value = percent;
        } else { status(`Downloading game… ${(received / 1_000_000).toFixed(1)} MB`); bar.removeAttribute('value'); }
      },
      notice: message => { $('#cache-state').textContent = message; },
    }),
    new URLSearchParams(location.search).get('cpu') === 'jit' ? undefined : get('./precompiled.json').then(r => r.json()),
  ]);
  if (precompiled !== undefined) {
    if (precompiled?.format !== 1) throw Error('Unsupported precompiled archive');
    checkIdentity(game.identity, precompiled.identity);
  }
  status('Checking game files…'); bar.removeAttribute('value');
  const checked = {};
  await Promise.all(runtimeFiles.map(async name => {
    const bytes = await (await get(`./${name}`)).arrayBuffer();
    await verifyFile(name, bytes, game.identity.files[name]);
    if (['save-session.mjs', 'external-open.js', 'text-input.js', 'external-links.mjs', 'guest-saves.js', 'save-transfer.mjs', 'preflight.mjs', 'touchhle_browser.wasm'].includes(name)) checked[name] = bytes;
  }));
  const moduleFrom = async bytes => {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
    try { return await import(url); } finally { URL.revokeObjectURL(url); }
  };
  ({ attachSaveSession } = await moduleFrom(checked['save-session.mjs']));
  await moduleFrom(checked['external-open.js']); await moduleFrom(checked['text-input.js']);
  ({ attachExternalLinks } = await moduleFrom(checked['external-links.mjs']));
  await moduleFrom(checked['guest-saves.js']);
  const { installSaveTransfer } = await moduleFrom(checked['save-transfer.mjs']);
  const { inspectBytes } = await moduleFrom(checked['preflight.mjs']);
  const { instance } = await WebAssembly.instantiate(checked['touchhle_browser.wasm'], {});
  const inspected = inspectBytes(instance.exports, new Uint8Array(await file.arrayBuffer()));
  if (!inspected.ok) throw Error(inspected.error);
  transfer = installSaveTransfer({ id: inspected.app.bundleId, onBusy: controls });
  const panel = document.querySelector('section[aria-label="Saved files"]');
  panel.querySelector('h2').textContent = 'Your saved files';
  panel.querySelector('p').textContent = 'The game is safely stopped. Export your progress, import a saved file, or restore your previous backup. Return to the game when you’re done. Exports contain saved files, not a running-screen snapshot.';
  $('#files-content').append(panel);
  ready = true; controls(); await startGame();
} catch (error) { status(`Unable to load game: ${error.message}. Reload to try again.`); bar.hidden = true; }
