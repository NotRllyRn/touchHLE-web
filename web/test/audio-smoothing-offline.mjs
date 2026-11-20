// SPDX-License-Identifier: MPL-2.0
// Browser-only rendered PCM tests of the actual dashboard handler and AudioBridge.
// Synthetic signals; no listening, original-game fidelity or speed assertion.
export async function checkAudioSmoothing({ beforeSource, candidateSource, beforeURL, candidateURL }) {
  const results = [];
  const require = (ok, message) => { if (!ok) throw Error(message); };
  const implementations = [
    ['before', beforeSource, (await import(beforeURL)).AudioBridge],
    ['candidate', candidateSource, (await import(candidateURL)).AudioBridge],
  ];
  async function render(name, settings, build) {
    const pair = [];
    for (const [version, source, Bridge] of implementations) {
      const rate = settings.rate ?? 48000, channels = settings.channels ?? 1;
      const c = new OfflineAudioContext(channels, Math.ceil(rate * .32), rate);
      let dashboardState = 'running';
      const proxy = new Proxy(c, { get(target, key) {
        if (key === 'state') return dashboardState;
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
      const bridge = new Bridge(proxy, { smoothUnderruns: true });
      require(source.indexOf('function syncAudioClock()') >= 0 && source.indexOf('function resumeLoops()') > source.indexOf('function syncAudioClock()') && source.indexOf('function handleAudio(') > 0 && source.indexOf('function stopGame(') > source.indexOf('function handleAudio('), 'actual handler extraction markers');
      const sync = source.slice(source.indexOf('function syncAudioClock()'), source.indexOf('function resumeLoops()'));
      const handler = source.slice(source.indexOf('function handleAudio('), source.indexOf('function stopGame('));
      const handle = Function('audio', 'audioClock', 'performance',
        `let audioOffset;const pendingLoops=new Map();${sync}\n${handler}\nreturn handleAudio;`)(
        bridge, { time: 0, timestamp: 0 }, { timeOrigin: 0, now: () => c.currentTime * 1000 });
      const start = (id, when, duration, options = {}) => {
        handle({ op: 'create', id, kind: 'source' });
        const pcm = Array.from({ length: channels }, (_, channel) => {
          const data = new Float32Array(Math.round(duration * (options.rate ?? rate)));
          data.fill(channel ? -.3 : .25); return data;
        });
        handle({ op: 'buffer', id, channels: pcm, sampleRate: options.rate ?? rate });
        if (options.speed) handle({ op: 'param', id, name: 'playbackRate', value: options.speed });
        if (options.loop) handle({ op: 'property', id, name: 'loop', value: true });
        handle({ op: 'connect', id, destination: options.destination ?? 0 });
        handle({ op: 'start', id, when, offset: options.offset ?? 0 });
      };
      const suspended = [], callbackErrors = [];
      const at = (time, action) => suspended.push(c.suspend(time).then(async () => {
        try { await action(); } catch (error) { callbackErrors.push(error); }
        finally { await c.resume(); }
      }).catch(error => { callbackErrors.push(error); }));
      await build({ start, handle, c, bridge, at, state: value => { dashboardState = value; } });
      let timeout;
      const deadline = new Promise((_, reject) => { timeout = setTimeout(() => reject(Error(name + ': offline deadline')), 10000); });
      let output;
      try { [output] = await Promise.race([Promise.all([c.startRendering(), ...suspended]), deadline]); }
      finally { clearTimeout(timeout); }
      if (callbackErrors.length) throw callbackErrors[0];
      await new Promise(resolve => setTimeout(resolve, 0)); // Drain ended event tasks after completed rendering.
      if (bridge.sources) require(bridge.sources.size === 0, name + ': source ownership remains after natural end/stop');
      const pcm = Array.from({ length: channels }, (_, channel) => output.getChannelData(channel));
      const peak = Math.max(...pcm.map(data => data.reduce((m, x) => Math.max(m, Math.abs(x)), 0)));
      const step = (from, to) => {
        let max = 0;
        for (const data of pcm) for (let i = Math.max(1, Math.floor(from * rate)); i < Math.ceil(to * rate); i++) max = Math.max(max, Math.abs(data[i] - data[i - 1]));
        return max;
      };
      pair.push({ version, pcm, rate, peak, step, bridge, output });
    }
    return pair;
  }
  function compareInterior(pair, from, to, label) {
    const [a, b] = pair; let max = 0;
    for (let c = 0; c < a.pcm.length; c++) for (let i = Math.ceil(from * a.rate); i < Math.floor(to * a.rate); i++) max = Math.max(max, Math.abs(a.pcm[c][i] - b.pcm[c][i]));
    require(max < 1e-6, `${label}: interior changed ${max}`); return max;
  }
  for (const settings of [{}, { channels: 2 }, { channels: 2, rate: 44100 }]) {
    const label = `contiguous-${settings.channels ?? 1}ch-${settings.rate ?? 48000}`;
    const pair = await render(label, settings, ({ start }) => { const rate = settings.rate ?? 48000; const when = Math.round(.032 * rate) / rate, duration = Math.round(.064 * rate) / rate; start(2, when, duration); start(3, when + duration, duration); });
    const interiorError = compareInterior(pair, .037, .155, label);
    require(pair[1].step(.093, .099) < 1e-5, label + ': join has discontinuity');
    results.push({ name: label, interiorError, joinStep: pair[1].step(.093, .099), peak: pair[1].peak });
  }
  const gap = await render('late recovery', {}, ({ start, at }) => {
    start(2, .032, .064);
    at(.128, () => start(3, .128, .064));
  });
  const beforeStep = gap[0].step(.09, .145), afterStep = gap[1].step(.09, .145);
  require(beforeStep > .24 && afterStep < .004, `underrun edge not improved: ${beforeStep}/${afterStep}`);
  require(gap[1].peak <= gap[0].peak + 1e-6, 'gain/peak increased');
  const first = gap[1].pcm[0].findIndex(x => x !== 0) / gap[1].rate;
  require(first >= .032 && first <= .032 + 1 / gap[1].rate + 1e-9, 'added scheduling latency');
  require(gap[1].pcm[0].slice(.097 * gap[1].rate, .127 * gap[1].rate).every(x => x === 0), 'replayed/fabricated tail');
  results.push({ name: 'late-gap-recovery', beforeStep, afterStep, peak: gap[1].peak, firstSignalSeconds: first, addedLatencyUpperSeconds: 1 / gap[1].rate });
  const one = await render('isolated effect', {}, ({ start }) => start(2, .032, .064));
  compareInterior(one, .037, .091, 'one-shot');
  require(one[1].step(.09, .1) < .004 && one[1].step(.03, .04) < .004, 'one-shot edge ramp');
  results.push({ name: 'one-shot-interior-and-edges', peak: one[1].peak });
  const overlap = await render('overlap', {}, ({ start }) => { start(2, .032, .096); start(3, .064, .096); });
  compareInterior(overlap, .07, .123, 'overlap');
  require(overlap[1].peak <= overlap[0].peak && overlap[1].peak === .5, 'overlap altered/double gain');
  results.push({ name: 'intentional-overlap', peak: overlap[1].peak });
  const loop = await render('loop', { channels: 2 }, ({ start, handle }) => { start(2, .032, .016, { loop: true }); handle({ op: 'stop', id: 2, when: .2 }); });
  compareInterior(loop, 0, .3, 'loop bypass');
  results.push({ name: 'loop-and-scheduled-stop-byte-equivalent', peak: loop[1].peak });
  const pitch = await render('rate offset', { channels: 2 }, ({ start }) => start(2, .032, .128, { speed: 2, offset: .032, rate: 24000 }));
  compareInterior(pitch, .037, .074, 'rate/offset');
  require(pitch[1].step(.074, .084) < .004, 'rate/offset predicted end incorrect');
  results.push({ name: 'stereo-24khz-rate2-offset', peak: pitch[1].peak });
  const tiny = await render('short contiguous', {}, ({ start }) => { start(2, .032, .004); start(3, .036, .004); });
  require(tiny[1].step(.035, .037) < 1e-5, 'short contiguous join');
  require(tiny[1].pcm[0][Math.round(.033 * 48000)] > .1, 'cancelled initial short ramp');
  results.push({ name: 'short-source-contiguous-ramp', joinStep: tiny[1].step(.035, .037) });
  const edited = await render('rate edit', {}, ({ start, handle, at }) => {
    start(2, .032, .192);
    at(.064, () => handle({ op: 'param', id: 2, name: 'playbackRate', value: 2 }));
  });
  compareInterior(edited, .07, .25, 'post-start rate bypass');
  results.push({ name: 'post-start-rate-edit-unpredictable-end-bypass', peak: edited[1].peak });
  const discarded = await render('suspended discard', {}, ({ start, state, bridge }) => {
    state('suspended'); start(2, .032, .064); require(!bridge.nodes.has(2), 'suspended one-shot retained');
    if (bridge.sources) require(bridge.sources.size === 0, 'private gain retained after discard');
    state('running'); start(3, .128, .064);
  });
  require(discarded[1].pcm[0].slice(0, .128 * 48000).every(x => x === 0), 'stale one-shot replayed');
  compareInterior(discarded, .133, .187, 'resume');
  results.push({ name: 'suspended-discard-resume', peak: discarded[1].peak });
  // Exercise the guard on both sides and during an already-running release ramp.
  for (const arrival of [.088, .09066666666666667, .09333333333333334]) {
    const pair = await render('contiguous receipt ' + arrival, {}, ({ start, at }) => {
      start(2, .032, .064); at(arrival, () => start(3, .096, .064));
    });
    const edge = pair[1].step(.09, .102);
    require(edge < .004, 'late contiguous edge exceeds bounded ramp');
    if (arrival === .088) compareInterior(pair, .09, .102, 'timely guard control');
    else require(pair[1].pcm[0][Math.round(.096 * 48000)] < .01, 'late guard erased fade');
    results.push({ name: 'contiguous-receipt-' + arrival, edge });
  }
  const ambiguous = await render('ambiguous predecessor', {}, ({ start }) => {
    start(2, .032, .064); start(3, .048, .048); start(4, .096, .064);
  });
  require(ambiguous[1].pcm[0][Math.round(.096 * 48000)] < .01, 'ambiguous predecessor merged');
  require(ambiguous[1].peak <= ambiguous[0].peak, 'ambiguous route extra gain');
  results.push({ name: 'ambiguous-predecessor-keeps-ramps', peak: ambiguous[1].peak });
  for (const duration of [1 / 48000, 2 / 48000, .001]) {
    const pair = await render('tiny ' + duration, {}, ({ start }) => start(2, .032, duration));
    require(pair[1].pcm[0].every(Number.isFinite) && pair[1].peak <= .25, 'tiny buffer peak/nonfinite');
    if (duration < 2 / 48000) {
      compareInterior(pair, 0, .3, 'one-sample impulse bypass');
      require(pair[1].peak === .25, 'one-sample impulse suppressed');
    }
    require(pair[1].pcm[0].slice(Math.ceil((.032 + duration) * 48000) + 1).every(x => x === 0), 'tiny tail extension');
    results.push({ name: 'tiny-finite-' + duration, peak: pair[1].peak });
  }
  for (const options of [{ offset: 47 / 48000 }, { speed: 48 }]) {
    const pair = await render('tiny remainder', {}, ({ start }) => start(2, .032, .001, options));
    compareInterior(pair, 0, .3, 'tiny offset/rate bypass');
    require(pair[1].peak === pair[0].peak && pair[1].peak > 0, 'tiny remainder suppressed');
    results.push({ name: 'tiny-remainder-bypass', options, peak: pair[1].peak });
  }
  const loopEdit = await render('loop edit during release', {}, ({ start, handle, at }) => {
    start(2, .032, .064);
    at(.09333333333333334, () => {
      handle({ op:'property',id:2,name:'loop',value:true });
      handle({ op:'property',id:2,name:'loopStart',value:.008 });
      handle({ op:'property',id:2,name:'loopEnd',value:.04 });
      handle({ op:'stop',id:2,when:.2 });
    });
  });
  compareInterior(loopEdit, .102, .198, 'loop edit restored unity');
  results.push({ name: 'loop-edit-during-release', peak: loopEdit[1].peak });
  const scheduledRate = await render('scheduled rate', {}, ({ start, handle }) => {
    start(2, .032, .192); handle({ op:'param',id:2,name:'playbackRate',value:2,time:.064 });
  });
  compareInterior(scheduledRate, .037, .25, 'scheduled rate bypass');
  results.push({ name:'scheduled-rate-automation',peak:scheduledRate[1].peak });
  const stopped = await render('stop joined successor', {}, ({ start, handle }) => {
    start(2,.032,.064);start(3,.096,.064);handle({op:'stop',id:3,when:.08});
  });
  compareInterior(stopped,.037,.3,'native cancelled-successor stop');
  results.push({name:'cancelled-successor-native-stop-no-replay',peak:stopped[1].peak});
  for (const reconnect of [false, true]) {
    const pair = await render('route isolation ' + reconnect, {}, ({ start, handle }) => {
      if (!reconnect) for (const id of [10,11]) { handle({op:'create',kind:'gain',id});handle({op:'connect',id,destination:0}); }
      start(2,.032,.064,{destination:reconnect?0:10});
      if(reconnect){handle({op:'disconnect',id:2});handle({op:'connect',id:2,destination:0});}
      start(3,.096,.064,{destination:reconnect?0:11});
    });
    require(pair[1].pcm[0][Math.round(.096*48000)] < .01,'route isolation/reconnect incorrectly joined');
    results.push({name:'route-isolation-reconnect-'+reconnect,peak:pair[1].peak});
  }
  const { AudioBridge } = await import(candidateURL);
  const live = new AudioContext(); const bridge = new AudioBridge(live,{smoothUnderruns:true});
  try {
    bridge.handle({op:'create',kind:'source',id:2});
    const oldEnd = bridge.nodes.get(2).onended;
    bridge.discard(2);require(bridge.nodes.size===2&&bridge.sources.size===0,'discard cleanup');
    bridge.handle({op:'create',kind:'source',id:2});oldEnd();
    require(bridge.nodes.has(2)&&bridge.sources.has(2),'stale onended removed new owner');
    bridge.handle({op:'buffer',id:2,channels:[new Float32Array(128)],sampleRate:live.sampleRate});
    bridge.handle({op:'property',id:2,name:'loop',value:true});
    bridge.handle({op:'connect',id:2,destination:0});bridge.handle({op:'start',id:2,when:0,offset:0});
    await bridge.close();require(live.state==='closed'&&bridge.nodes.size===0&&bridge.sources.size===0,'close cleanup');
    results.push({name:'actual-AudioContext-discard-stale-ended-close',state:live.state});
  } finally { if(live.state!=='closed')await live.close(); }
  return results;
}
