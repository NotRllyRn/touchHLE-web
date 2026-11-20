// SPDX-License-Identifier: MPL-2.0
// Shared URL admission policy. No navigation, Worker teardown or audio ownership.
(() => {
  const MAX_URL = 8192;
  function validate(url) {
    if (typeof url !== 'string' || !url.length || url.length > MAX_URL || /[\u0000-\u0020\u007f]/u.test(url))
      throw Error('External link rejected: invalid or oversized URL.');
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname)
      throw Error('External link rejected: only HTTP and HTTPS are supported.');
    return url; // Preserve query/fragment/escaping; never interpolate into markup.
  }
  function workerController(session, post, now = () => performance.now()) {
    let pending, sequence = 0, closed = false, lastRequest = -Infinity, lastNotice = -Infinity;
    const recent = new Map(); // At most 32 accepted URL strings, not an event queue.
    const validSession = typeof session === 'string' && /^[a-f0-9-]{36}$/.test(session);
    function reject(message) {
      const time = now();
      if (validSession && !closed && time - lastNotice >= 1000) {
        lastNotice = time;
        try { post({ type: 'external-status', session, message }); } catch {}
      }
      return false;
    }
    return {
      request(url) {
        if (closed || !validSession) return false;
        try { validate(url); } catch { return reject('External link rejected: use a valid HTTP(S) URL of at most 8192 characters, without spaces or control characters.'); }
        if (pending?.url === url) return true; // Already queued; no additional message.
        if (pending) return reject('Another external link is pending. Dismiss it first.');
        const time = now();
        if (time - lastRequest < 1000 || (recent.has(url) && time - recent.get(url) < 30000))
          return reject('Repeated external link suppressed. Try again later.');
        const request = { type: 'external-open', session, id: ++sequence, url };
        try { post(request); } catch { return false; }
        pending = request; lastRequest = time;
        recent.delete(url); recent.set(url, time);
        if (recent.size > 32) recent.delete(recent.keys().next().value);
        return true;
      },
      handle(data) {
        if (data?.type === 'save-stop') { closed = true; pending = undefined; recent.clear(); return; }
        if (data?.type === 'external-dismiss' && data.session === session && data.id === pending?.id) pending = undefined;
      },
      close() { closed = true; pending = undefined; recent.clear(); },
    };
  }
  globalThis.TouchHLEExternal = { validate, workerController };
})();
