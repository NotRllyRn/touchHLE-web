// SPDX-License-Identifier: MPL-2.0
// Yield the worker to input/audio tasks without nested setTimeout(0)'s 4 ms floor.
addToLibrary({
  $touchhleYieldTask: null,
  touchhle_web_yield__deps: ['$Asyncify', '$callUserCallback', '$safeSetTimeout', '$touchhleYieldTask'],
  touchhle_web_yield__async: true,
  touchhle_web_yield: () => Asyncify.handleSleep(wakeUp => {
    if (globalThis.process?.versions?.node) return safeSetTimeout(wakeUp, 0);
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
