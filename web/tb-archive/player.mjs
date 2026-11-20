// SPDX-License-Identifier: MPL-2.0
import { launch as verifiedLaunch } from './verified-launch.mjs';

// Separate the session lifecycle so cancellation can be checked without a guest.
export function installPlayer({ run, stop, state, log, document, game, file, source, precompiled,
  AudioBridge, attachInput, attachSaveSession, attachExternalLinks, transfer, baseline, read, digest, reloadNative, launch = verifiedLaunch, persistence = true }) {
  let generation = 0, handle, audio, nativeFetch, saves, input, external, textEntry;
  let lines = log.textContent ? [log.textContent] : [];
  const note = message => {
    if (!message) return;
    lines.push(String(message));
    if (lines.length > 200) lines.shift();
    log.textContent = lines.join('\n');
  };
  function finish() {
    textEntry?.dispose(); textEntry = undefined;
    external?.dispose(); external = undefined;
    input?.cancel?.(); input = undefined;
    saves?.dispose(); saves = undefined;
    const stopped = ++generation;
    const cleanupError = error => { if (generation === stopped) note(`Audio cleanup: ${error}`); };
    const previous = handle, bridge = audio;
    handle = audio = undefined;
    nativeFetch?.abort();
    nativeFetch = undefined;
    if (previous) {
      previous.worker.onmessage = previous.worker.onerror = null;
      try { previous.destroy(); } catch (error) { note(`Worker cleanup: ${error}`); }
    }
    if (bridge) {
      try { Promise.resolve(bridge.close()).catch(cleanupError); }
      catch (error) { cleanupError(error); }
    }
    transfer?.setActive(false);
    run.disabled = !!transfer?.busy; stop.disabled = true;
    state.textContent = 'Stopped';
  }
  const requestStop = () => {
    textEntry?.dispose(); textEntry = undefined;
    external?.dispose();
    if (saves) { input?.cancel?.(); stop.disabled = true; saves.stop(); } else finish();
  };
  stop.onclick = requestStop;
  run.onclick = async () => {
    if (run.disabled || transfer?.busy) return;
    finish();
    transfer?.setActive(true);
    const current = generation;
    const active = () => current === generation;
    run.disabled = true; stop.disabled = false;
    state.textContent = 'Starting';
    lines = []; log.textContent = '';
    note(baseline ? 'Diagnostic baseline: normal decode/JIT, both archives disabled.' : 'Native archive pending.');
    try {
      // start() calls AudioContext.resume() before yielding; keep user activation.
      const bridge = audio = new AudioBridge();
      const audioClock = await bridge.start();
      if (!active()) return;
      if (!baseline && !source) {
        const controller = nativeFetch = new AbortController();
        try {
          const bytes = await reloadNative(controller.signal);
          if (!active()) return;
          source = bytes;
        } finally {
          if (nativeFetch === controller) nativeFetch = undefined;
        }
      }
      const launched = await launch('./', game.identity, game.helperHash, read, digest);
      if (!active()) { launched.destroy(); return; }
      handle = launched;
      const worker = handle.worker;
      external = attachExternalLinks(worker, { document });
      textEntry = globalThis.TouchHLEText?.attach(worker, document);
      if (persistence) {
        saves = attachSaveSession(worker, {
          onStatus: message => { const element = document.querySelector('#save-state'); if (element) element.textContent = message; },
          onStopped: finish,
          onStopFailed: () => { if (active()) stop.disabled = false; },
          document,
        });
        void globalThis.navigator?.storage?.persist?.().catch(() => {});
      }
      const previous = document.querySelector('#canvas'), canvas = previous.cloneNode();
      previous.replaceWith(canvas);
      input = attachInput(canvas, message => { if (active()) worker.postMessage(message); });
      worker.onmessage = ({ data }) => {
        if (!active()) return;
        if (data.type?.startsWith('save-') || data.type?.startsWith('external-') || data.type?.startsWith('text-')) return;
        if (data.type === 'audio') {
          try { bridge.handle(data); } catch (error) { note(error); requestStop(); }
          return;
        }
        let message = data.message;
        if (data.type === 'tb-ready') note('Native archive staged; guest-byte admission occurs during execution.');
        if (data.type === 'tb-stats') message = `TB ${JSON.stringify(data)}`;
        if (data.type === 'log' && message?.startsWith('TB archive disabled:')) message += ' Normal runtime decode fallback.';
        if (data.type === 'exit') message = `Guest exited with status ${data.code}.`;
        note(message);
        if (data.type === 'exit' || data.type === 'error') finish();
      };
      worker.onerror = event => {
        if (!active()) return;
        note(`Runtime failed: ${event.message}`); requestStop();
      };
      const offscreen = canvas.transferControlToOffscreen();
      const native = baseline ? undefined : source.buffer;
      if (native && (source.byteOffset !== 0 || source.byteLength !== native.byteLength)) {
        throw Error('Native archive must own its full buffer');
      }
      // Transfer ownership; the worker verifies these exact bytes before use.
      if (!baseline) source = undefined;
      // Baseline uses verified bootstrap and explicitly declines archive import.
      worker.postMessage({ type: 'start', externalSession: external.session, persistentSaves: persistence, file, canvas: offscreen, audioClock, cpuBackend: 'jit', jitThreshold: 32,
        headless: false, tbIdentity: game.identity, tbArchive: baseline ? { capture: false } : { capture: false, source: native, sourceSha256: game.native.sha256 },
        ...(!baseline ? { precompiled } : {}) }, [offscreen, ...(native ? [native] : [])]);
      if (active()) state.textContent = 'Running';
    } catch (error) {
      if (active()) { note(error); finish(); }
    }
  };
}
