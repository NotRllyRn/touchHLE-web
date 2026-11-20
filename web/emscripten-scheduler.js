// SPDX-License-Identifier: MPL-2.0
// Yield the worker to input/audio tasks without nested setTimeout(0)'s 4 ms floor.
addToLibrary({
  touchhle_web_text_notify: (epoch, active) => { Module['textFocus']?.(epoch, Boolean(active)); },
  touchhle_web_text_result: (sequence, status) => { Module['textResult']?.(sequence, status); },
  // Parent-stack all-threads-sleeping wait. Rust rechecks its absolute deadline
  // after wake; rounding/clamping never authorizes early guest execution.
  touchhle_web_wait__deps: ['$Asyncify', '$safeSetTimeout'],
  touchhle_web_wait__async: true,
  touchhle_web_wait: milliseconds => Asyncify.handleSleep(wakeUp => {
    const delay = Math.max(1, Math.min(2147483647, Math.ceil(milliseconds)));
    safeSetTimeout(wakeUp, delay);
  }),
  touchhle_web_open_url__deps: ['$UTF8ArrayToString'],
  touchhle_web_open_url: (pointer, length) => {
    const reject = () => { try { Module['requestExternalURL']?.(null); } catch {} return 0; };
    if (length < 1 || length > 32768 || pointer < 0 || pointer > HEAPU8.length - length) return reject();
    // UTF8ArrayToString is NUL-terminated even with a maximum length.
    for (let i = 0; i < length; i++) if (HEAPU8[pointer + i] === 0) return reject();
    try { return Module['requestExternalURL']?.(UTF8ArrayToString(HEAPU8, pointer, length)) === true ? 1 : 0; }
    catch { return 0; }
  },
  $touchhleYieldTask: null,
  touchhle_web_yield__deps: ['$Asyncify', '$callUserCallback', '$safeSetTimeout', '$touchhleYieldTask'],
  touchhle_web_yield__async: true,
  touchhle_web_yield: () => Asyncify.handleSleep(wakeUp => {
    if (globalThis.process?.versions?.node) return safeSetTimeout(wakeUp, 0);
    // Ordinary tasks stay responsive to input; scheduler.yield continuations can starve it.
    if (globalThis.scheduler?.postTask) return scheduler.postTask(() => callUserCallback(wakeUp));
    if (!touchhleYieldTask) {
      const channel = new MessageChannel();
      let pending;
      channel.port1.onmessage = () => {
        const callback = pending;
        pending = null;
        callUserCallback(callback);
      };
      touchhleYieldTask = callback => {
        if (pending) throw new Error('Concurrent CPU yields');
        pending = callback;
        channel.port2.postMessage(0);
      };
    }
    touchhleYieldTask(wakeUp);
  }),
});
