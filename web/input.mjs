// SPDX-License-Identifier: MPL-2.0
// Keep pointer identities for UIKit multi-touch; mouse clicks retain SDL's
// existing mouse path. A wheel step represents a two-finger pinch gesture.
export function attachInput(canvas, send) {
  const pressed = new Map();
  let cancelled = false;
  for (const [name, kind] of [['pointerdown', 0], ['pointermove', 1], ['pointerup', 2], ['pointercancel', 2]]) {
    canvas.addEventListener(name, event => {
      if (cancelled) return;
      if (kind === 0) {
        pressed.set(event.pointerId, null);
        canvas.setPointerCapture(event.pointerId);
      }
      if (!pressed.has(event.pointerId)) return;
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      if (event.pointerType === 'touch') {
        const message = { type: 'touches', kind, timestamp: Math.round(event.timeStamp) >>> 0 || 1,
          points: [{ id: event.pointerId, x, y }] };
        pressed.set(event.pointerId, message); send(message);
      } else {
        const message = { type: 'pointer', kind, x: Math.round(x * canvas.width), y: Math.round(y * canvas.height) };
        pressed.set(event.pointerId, message); send(message);
      }
      if (kind === 2) pressed.delete(event.pointerId);
    });
  }
  canvas.addEventListener('wheel', event => {
    if (cancelled || pressed.size || !event.deltaY) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(.25, Math.min(.75, (event.clientX - rect.left) / rect.width));
    const y = Math.max(.05, Math.min(.95, (event.clientY - rect.top) / rect.height));
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
    const start = .2, end = Math.max(.025, Math.min(.24, start * Math.exp(-delta * .003)));
    const timestamp = Math.round(event.timeStamp) >>> 0 || 1;
    const emit = (kind, radius, step) => send({ type: 'touches', kind, timestamp: timestamp + step,
      points: [{ id: -1, x: x - radius, y }, { id: -2, x: x + radius, y }] });
    emit(0, start, 0);
    for (let step = 1; step <= 6; step++) emit(1, start + (end - start) * step / 6, step);
    emit(2, end, 7);
  }, { passive: false });
  return {
    cancel() {
      if (cancelled) return;
      cancelled = true;
      for (const [id, message] of pressed) {
        if (message) send({ ...message, kind: 2 });
        try { canvas.releasePointerCapture?.(id); } catch { /* Contact may already be gone. */ }
      }
      pressed.clear();
    },
  };
}
