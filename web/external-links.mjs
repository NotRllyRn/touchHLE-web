// SPDX-License-Identifier: MPL-2.0
// Policy is installed by the caller (verified pages execute checked bytes).

// Listen only on this Worker instance, with a fresh generation token per launch.
export function attachExternalLinks(worker, { document = globalThis.document, window = globalThis.window,
  session = globalThis.crypto.randomUUID() } = {}) {
  let disposed = false, latest = 0, pending, panel, message, link, open, dismiss;
  function show(text) {
    if (!panel) {
      panel = document.createElement('section'); panel.setAttribute('aria-label', 'External link');
      message = document.createElement('p'); message.setAttribute('role', 'status');
      link = document.createElement('a'); link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = 'Open link in a separate tab'; link.hidden = true;
      open = document.createElement('button'); open.textContent = 'Open in new tab'; open.hidden = true;
      dismiss = document.createElement('button'); dismiss.textContent = 'Dismiss';
      panel.append(message, open, ' ', link, ' ', dismiss); document.body.append(panel);
      open.onclick = () => {
        if (disposed || !pending) return;
        // A real user click owns this attempt. Detach opener before navigating.
        let tab;
        try {
          tab = window.open('about:blank', '_blank');
          if (!tab) { show('Popup blocked. Use the link below or allow popups, then try again.'); return; }
          tab.opener = null;
          tab.location.replace(globalThis.TouchHLEExternal.validate(pending.url));
          show('New tab requested. This game is still running; loading the link is controlled by your browser.');
        } catch {
          try { tab?.close(); } catch {}
          show('Could not open a new tab. Use the link below to try again.');
        }
      };
      link.onclick = () => { if (pending) show('Separate tab requested. If blocked, allow popups and try again.'); };
      dismiss.onclick = () => {
        if (pending) worker.postMessage({ type: 'external-dismiss', session, id: pending.id });
        pending = undefined; panel.remove(); panel = undefined;
      };
    }
    message.textContent = text;
  }
  function receive(event) {
    if (disposed || event.target !== worker) return;
    const data = event.data;
    if (data?.session !== session) return;
    if (data.type === 'external-status' && typeof data.message === 'string' && data.message.length <= 256) { show(data.message); return; }
    if (data.type !== 'external-open' || !Number.isSafeInteger(data.id) || data.id <= latest) return;
    latest = data.id;
    try { globalThis.TouchHLEExternal.validate(data.url); }
    catch {
      pending = undefined;
      show('Unsafe or unsupported external link rejected.');
      link.removeAttribute('href'); link.hidden = open.hidden = true;
      worker.postMessage({ type: 'external-dismiss', session, id: data.id }); return;
    }
    pending = { id: data.id, url: data.url };
    show('The game requested an external link. Open it in a separate tab to keep playing here.');
    link.href = data.url; link.textContent = data.url; link.style.overflowWrap = 'anywhere';
    link.hidden = open.hidden = false;
  }
  worker.addEventListener('message', receive);
  return {
    session,
    dispose() {
      if (disposed) return;
      disposed = true; pending = undefined;
      worker.removeEventListener('message', receive);
      if (link) { link.removeAttribute('href'); link.onclick = null; }
      if (open) { open.disabled = true; open.onclick = null; }
      if (dismiss) dismiss.onclick = null;
      panel?.remove(); panel = undefined;
    },
  };
}
