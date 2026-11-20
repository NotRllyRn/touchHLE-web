// SPDX-License-Identifier: MPL-2.0
if (!self.__tbBootstrap) importScripts('./touchhle-runtime.js', './audio-proxy.js', './guest-saves.js', './external-open.js', './text-input.js');
self.onmessage = async ({ data }) => {
  if (data.type !== 'start') return;
  // Latch Stop while verified scripts/payloads are loading; no guest has started.
  let earlyStop = false;
  self.onmessage = ({ data: input }) => { if (input.type === 'save-stop') earlyStop = true; };
  let runtime, tb, bridge, pinned, verifiedIpa, saves;
  let runtimeExited = false;
  try {
    if (!(data.file instanceof Blob) || data.file.size > 256 * 1024 * 1024) throw new Error('Invalid or oversized IPA');
    if (self.__tbBootstrap) {
      const boot = self.__tbBootstrap;
      // Failed package verification must not execute freshly fetched, unverified
      // code. Archive admission can decline later while these verified bytes run.
      if (!data.tbArchive) throw Error('Native archive requires an explicit request');
      bridge = await import(boot.helperURL);
      verifiedIpa = await bridge.verifyIpa(data.file, data.tbIdentity?.ipa);
      pinned = await bridge.verifiedPackage(boot, data.tbIdentity, verifiedIpa);
      if (data.tbArchive.source !== undefined) {
        data.tbArchive.source = await bridge.verifyArchiveSource(data.tbArchive.source, data.tbArchive.sourceSha256);
      }
      bridge.script(pinned['touchhle-runtime.js']);
      bridge.script(pinned['audio-proxy.js']);
      bridge.script(pinned['guest-saves.js']);
      bridge.script(pinned['external-open.js']);
      bridge.script(pinned['text-input.js']);
    } else if (data.tbArchive) {
      self.postMessage({ type: 'log', message: 'TB archive disabled: verified launcher required' });
    }
    const text = self.TouchHLEText.worker(message => self.postMessage(message));
    const external = self.TouchHLEExternal.workerController(data.externalSession, message => self.postMessage(message));
    self.addEventListener('message', ({ data: message }) => external.handle(message));
    if (earlyStop) external.close();
    if (data.persistentSaves === true) {
      saves = self.TouchHLESaves.workerController(message => self.postMessage(message), () => self.close());
      self.onmessage = ({ data: input }) => saves.handle(input);
      if (earlyStop) saves.handle({ type: 'save-stop' });
    }
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
      textFocus: (epoch, active) => text.focus(epoch, active),
      textResult: (sequence, status) => text.result(sequence, status),
      requestExternalURL: url => external.request(url),
      canvas,
      ...(pinned ? {
        wasmBinary: pinned['touchhle-runtime.wasm'],
        locateFile: name => new URL(name, self.__tbBootstrap.base).href,
        getPreloadedPackage: (_name, size) => {
          const bytes = pinned['touchhle-runtime.data'];
          if (size !== bytes.byteLength) throw Error('Runtime data length mismatch');
          return bytes.buffer;
        },
      } : self.__tbBootstrap ? { locateFile: name => new URL(name, self.__tbBootstrap.base).href } : {}),
      enableTciJit: data.cpuBackend === 'jit',
      tciJitThreshold: data.jitThreshold === 1 ? 1 : 32,
      noInitialRun: true,
      print: message => {
        self.postMessage({ type: 'log', message });
        if (tb) self.postMessage({ type: 'tb-stats', ...tb.snapshot() });
      },
      printErr: message => self.postMessage({ type: 'log', message }),
      onAbort: message => {
        text.close(false);
        const error = { type: 'error', message: `${message}\n${new Error().stack}` };
        if (saves) void saves.finish(error); else self.postMessage(error);
      },
      onExit: code => {
        text.close(false);
        runtimeExited = true; tb = undefined; // Native close/teardown owns cleanup.
        if (runtime.tciJit) self.postMessage({ type: 'log', message: `CPU JIT ${JSON.stringify(runtime.tciJit.stats)}` });
        if (saves) void saves.finish({ type: 'exit', code });
        else self.postMessage({ type: 'exit', code });
      },
    });
    text.bind(runtime);
    if (data.cpuBackend === 'jit') {
      if (pinned) bridge.script(pinned['tci-jit.js']);
      else importScripts(new URL('tci-jit.js', self.__tbBootstrap?.base ?? self.location.href).href);
    }

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
      if (pinned) bridge.checkPortableIdentity(data.precompiled, data.tbIdentity);
      const { prepareCache } = pinned
        ? await bridge.loadPortable(pinned['tci-precompile.mjs'])
        : await import(new URL('tci-precompile.mjs', self.__tbBootstrap?.base ?? self.location.href).href);
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
      if (input?.type === 'save-stop') text.close();
      if (text.handle(input)) return;
      if (saves?.handle(input)) return;
      if (input.type === 'tb-export' || input.type === 'tb-clear' || input.type === 'tb-stats') {
        try {
          if (!tb) throw Error('TB archive unavailable');
          if (input.type === 'tb-stats') self.postMessage({ type: 'tb-stats', ...tb.snapshot() });
          else if (input.type === 'tb-export') tb.exportTo((message, transfer) => self.postMessage(message, transfer));
          else tb.clear();
        } catch (error) { self.postMessage({ type: 'log', message: `TB archive: ${error.message}` }); }
        return;
      }

      if (input.type === 'touches') for (const point of input.points) {
        runtime.ccall('touchhle_web_touch', null,
          ['number', 'number', 'number', 'number', 'number'],
          [input.kind, point.id, point.x, point.y, input.timestamp]);
      }
      if (input.type === 'pointer') runtime.ccall('touchhle_web_pointer', null,
        ['number', 'number', 'number'], [input.kind, input.x, input.y]);
    };
    if (verifiedIpa) await bridge.writeVerifiedIpa(runtime, verifiedIpa);
    else runtime.FS.writeFile('/app.ipa', new Uint8Array(await data.file.arrayBuffer()));
    // Setup/import is staged before the loader creates or executes a CPU.
    if (bridge) {
      try {
        tb = await bridge.prepare(runtime, data.tbArchive, data.tbIdentity, verifiedIpa,
          self.__tbBootstrap.helperHash, {
            headless: Boolean(data.headless),
            optionsHash: runtime.FS.analyzePath('/touchHLE_options.txt').exists
              ? await bridge.sha256(runtime.FS.readFile('/touchHLE_options.txt')) : null,
          });
        self.postMessage({ type: 'tb-ready', sourceHash: tb.sourceHash });
      } catch (error) {
        self.postMessage({ type: 'log', message: `TB archive disabled: ${error.message}` });
      }
    }
    if (data.tbArchive && typeof data.tbArchive === 'object') delete data.tbArchive.source;
    pinned = undefined;

    verifiedIpa = undefined;
    if (saves && !await saves.prepare(runtime.FS)) return;
    self.postMessage({ type: 'log', message: 'Starting the touchHLE loader…' });
    await runtime.ccall('touchhle_web_start', null, ['number'], [data.headless ? 1 : 0], { async: true });
  } catch (error) {
    if (tb && !runtimeExited) { tb.clear(); tb = undefined; }
    if (error.name === 'ExitStatus') {
      if (runtime?.tciJit) self.postMessage({ type: 'log', message: `CPU JIT ${JSON.stringify(runtime.tciJit.stats)}` });
      if (saves) await saves.finish({ type: 'exit', code: error.status });
      else self.postMessage({ type: 'exit', code: error.status });
    }
    else {
      const message = { type: 'error', message: String(error.stack ?? error.message ?? error) };
      if (saves) await saves.finish(message); else self.postMessage(message);
    }
  }
};
