// SPDX-License-Identifier: MPL-2.0
// Keep pointer identities for UIKit multi-touch; mouse clicks retain SDL's
// existing mouse path. A wheel step represents a two-finger pinch gesture.
export function attachInput(canvas, send) {
  const pressed = new Set();
  for (const [name, kind] of [['pointerdown', 0], ['pointermove', 1], ['pointerup', 2], ['pointercancel', 2]]) {
    canvas.addEventListener(name, event => {
      if (kind === 0) {
        pressed.add(event.pointerId);
        canvas.setPointerCapture(event.pointerId);
      }
      if (!pressed.has(event.pointerId)) return;
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      if (event.pointerType === 'touch') {
        send({ type: 'touches', kind, timestamp: Math.round(event.timeStamp) >>> 0 || 1,
          points: [{ id: event.pointerId, x, y }] });
      } else {
        send({ type: 'pointer', kind, x: Math.round(x * canvas.width), y: Math.round(y * canvas.height) });
      }
      if (kind === 2) pressed.delete(event.pointerId);
    });
  }
  canvas.addEventListener('wheel', event => {
    if (pressed.size || !event.deltaY) return;
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
}
