// SPDX-License-Identifier: MPL-2.0
importScripts('./touchhle-runtime.js', './audio-proxy.js');
self.onmessage = async ({ data }) => {
  if (data.type !== 'start') return;
  self.onmessage = null; // One guest per worker; Stop destroys the instance.
  let runtime;
  try {
    if (!(data.file instanceof Blob) || data.file.size > 256 * 1024 * 1024) throw new Error('Invalid or oversized IPA');
    const canvas = data.canvas;
    if (canvas) {
      // SDL's worker video backend needs browser display metadata and a canvas
      // lookup; input is forwarded separately, not dispatched by this facade.
      self.screen = { width: canvas.width, height: canvas.height };
      canvas.style = {};
      canvas.addEventListener = () => {};
      canvas.removeEventListener = () => {};
      canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: canvas.width, height: canvas.height });
      self.document = {
        querySelector: selector => selector === '#canvas' ? canvas : null,
        getElementById: id => id === 'canvas' ? canvas : null,
        addEventListener() {}, removeEventListener() {},
        createElement: tag => { if (tag === 'canvas') return new OffscreenCanvas(1, 1); throw new Error(`Unsupported DOM element: ${tag}`); },
        documentElement: { style: {} },
      };
    }
    runtime = await createTouchHLE({
      canvas,
      enableTciJit: data.cpuBackend === 'jit',
      tciJitThreshold: data.jitThreshold === 1 ? 1 : 32,
      noInitialRun: true,
      print: message => self.postMessage({ type: 'log', message }),
      printErr: message => self.postMessage({ type: 'log', message }),
      onAbort: message => self.postMessage({ type: 'error', message: `${message}\n${new Error().stack}` }),
      onExit: code => {
        if (runtime.tciJit) self.postMessage({ type: 'log', message: `CPU JIT ${JSON.stringify(runtime.tciJit.stats)}` });
        self.postMessage({ type: 'exit', code });
      },
    });
    if (data.cpuBackend === 'jit') importScripts('./tci-jit.js');
    if (data.aotCapture) {
      const keys = new Set(); let bytes = 0;
      TouchHLETciJit.portable = { capture: record => {
        if (keys.has(record.key)) return;
        if (keys.size >= 32768 || bytes + record.key.length > 32 * 1024 * 1024) {
          if (!keys.full) { keys.full = true; self.postMessage({ type: 'log', message: 'AOT capture limit reached; coverage is partial.' }); }
          return;
        }
        keys.add(record.key); bytes += record.key.length;
        self.postMessage({ type: 'aot-block', ...record });
      } };
    }
    if (data.precompiled) {
      const { prepareCache } = await import('./tci-precompile.mjs');
      const started = performance.now();
      TouchHLETciJit.portable = await prepareCache(data.precompiled);
      self.postMessage({ type: 'log', message: `AOT preparation ${JSON.stringify({ ms: performance.now() - started,
        blocks: TouchHLETciJit.portable.modules.size, bytes: TouchHLETciJit.portable.bytes })}` });
    }
    if (data.cpuBackend === 'jit') setInterval(() => {
      if (runtime.tciJit) self.postMessage({ type: 'log', message: `CPU JIT ${JSON.stringify(runtime.tciJit.stats)}` });
    }, 10000);
    if (runtime.debugSnapshot) self.__touchhleRuntime = runtime;
    if (data.audioClock) {
      self.AudioContext = self.installTouchHLEAudio(data.audioClock, message => self.postMessage(message));
      self.window = { AudioContext: self.AudioContext };
    }
    self.onmessage = ({ data: input }) => {
      if (input.type === 'touches') for (const point of input.points) {
        runtime.ccall('touchhle_web_touch', null,
          ['number', 'number', 'number', 'number', 'number'],
          [input.kind, point.id, point.x, point.y, input.timestamp]);
      }
      if (input.type === 'pointer') runtime.ccall('touchhle_web_pointer', null,
        ['number', 'number', 'number'], [input.kind, input.x, input.y]);
    };
    runtime.FS.writeFile('/app.ipa', new Uint8Array(await data.file.arrayBuffer()));
    self.postMessage({ type: 'log', message: 'Starting the touchHLE loader…' });
    await runtime.ccall('touchhle_web_start', null, ['number'], [data.headless ? 1 : 0], { async: true });
  } catch (error) {
    if (error.name === 'ExitStatus') {
      if (runtime?.tciJit) self.postMessage({ type: 'log', message: `CPU JIT ${JSON.stringify(runtime.tciJit.stats)}` });
      self.postMessage({ type: 'exit', code: error.status });
    }
    else self.postMessage({ type: 'error', message: String(error.stack ?? error.message ?? error) });
  }
};
