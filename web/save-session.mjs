// SPDX-License-Identifier: MPL-2.0
// Page lifecycle bridge. Never terminate a worker merely because a save is slow.
export function attachSaveSession(worker, { onStatus, onStopped, onStopFailed,
  document = globalThis.document, window = globalThis.window, timeoutMs = 15000 } = {}) {
  let timer, disposed = false;
  const status = message => onStatus?.(message);
  const flush = () => { if (!disposed) worker.postMessage({ type: 'save-flush' }); };
  const visibility = () => { if (document?.visibilityState === 'hidden') flush(); };
  const message = ({ data }) => {
    if (disposed) return;
    if (data.type === 'save-status') status(data.message);
    if (data.type === 'save-stopped') { clearTimeout(timer); onStopped?.(); }
    if (data.type === 'save-stop-failed') {
      clearTimeout(timer); status(data.message); onStopFailed?.();
    }
  };
  worker.addEventListener('message', message);
  document?.addEventListener('visibilitychange', visibility);
  window?.addEventListener('pagehide', flush);
  return {
    stop() {
      if (disposed) return;
      clearTimeout(timer); status('Saving progress before stopping…');
      worker.postMessage({ type: 'save-stop' });
      timer = setTimeout(() => {
        status('Save is still pending. Keep this tab open; you can retry Stop.');
        onStopFailed?.();
      }, timeoutMs);
    },
    dispose() {
      disposed = true; clearTimeout(timer);
      worker.removeEventListener('message', message);
      document?.removeEventListener('visibilitychange', visibility);
      window?.removeEventListener('pagehide', flush);
    },
  };
}
