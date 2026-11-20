// SPDX-License-Identifier: MPL-2.0
export class AudioBridge {
  constructor(context = new AudioContext(), { smoothUnderruns = false } = {}) {
    this.context = context;
    this.nodes = new Map([[0, context.destination], [1, context.listener]]);
    this.smoothUnderruns = smoothUnderruns;
    this.sources = new Map();
  }
  // Short, native AudioParam ramps still run if the page/worker stalls. No
  // samples are repeated, and neither source time nor playback rate is changed.
  // Only the dashboard opts in; other AudioBridge clients keep their old path.
  shape(source, when, offset) {
    const { node, gain } = source;
    const rate = node.playbackRate.value;
    if (node.loop || source.variableRate || !node.buffer || !(rate > 0) ||
        !Number.isFinite(rate) || !(offset >= 0) || offset >= node.buffer.duration) return;
    const duration = (node.buffer.duration - offset) / rate;
    // A sub-two-sample remainder cannot carry a useful ramp. Keep tiny
    // impulses intact instead of fading their only output sample to zero.
    if (duration * this.context.sampleRate < 2) return;
    const fade = Math.min(0.004, duration / 2);
    const end = when + duration;
    source.when = when; source.end = end; source.fade = fade;
    source.joinable = true;
    const now = this.context.currentTime;
    const predecessors = [...this.sources.values()].filter(previous => previous !== source &&
      previous.joinable && previous.destinations.size > 0 &&
      previous.destinations.size === source.destinations.size &&
      [...previous.destinations].every(id => source.destinations.has(id)) &&
      Math.abs(previous.end - when) < 0.5 / this.context.sampleRate &&
      previous.end - previous.fade > now + 128 / this.context.sampleRate);
    let joined = false;
    if (predecessors.length === 1) {
      const previous = predecessors[0];
      // A timely successor covers this boundary. Remove only its predecessor's
      // future fade-out; never modify a fade already reaching the output.
      previous.gain.gain.cancelScheduledValues(previous.end - previous.fade);
      previous.gain.gain.linearRampToValueAtTime(1, previous.end - previous.fade);
      previous.joinable = false;
      joined = true;
    }
    gain.gain.setValueAtTime(joined ? 1 : 0, when);
    if (!joined) gain.gain.linearRampToValueAtTime(1, when + fade);
    gain.gain.setValueAtTime(1, end - fade);
    gain.gain.linearRampToValueAtTime(0, end);
  }
  unshape(source) {
    if (!source?.joinable && source?.when === undefined) return;
    source.joinable = false;
    const now = this.context.currentTime;
    // Rate/loop edits after start make the predicted end invalid. Restore unity
    // without moving the native source's stop, loop points or rate automation.
    source.gain.gain.cancelAndHoldAtTime(now);
    source.gain.gain.linearRampToValueAtTime(1, now + 0.004);
    source.when = undefined;
  }
  discard(id) {
    this.nodes.get(id)?.disconnect();
    this.sources.get(id)?.gain.disconnect();
    this.sources.delete(id);
    this.nodes.delete(id);
  }
  async start() {
    await this.context.resume();
    return { sampleRate: this.context.sampleRate, time: this.context.currentTime,
      timestamp: performance.timeOrigin + performance.now() };
  }
  handle(message) {
    const c = this.context;
    const node = this.nodes.get(message.id);
    switch (message.op) {
      case 'create': {
        const factories = { gain: 'createGain', panner: 'createPanner', source: 'createBufferSource' };
        const method = factories[message.kind];
        if (!method) throw new Error(`Unsupported audio node: ${message.kind}`);
        const created = c[method]();
        this.nodes.set(message.id, created);
        if (message.kind === 'source') {
          if (this.smoothUnderruns) {
            const gain = c.createGain();
            created.connect(gain);
            this.sources.set(message.id, { node: created, gain, destinations: new Set() });
          }
          created.onended = () => {
            if (this.nodes.get(message.id) === created) this.discard(message.id);
          };
        }
        break;
      }
      case 'buffer': {
        const buffer = c.createBuffer(message.channels.length, message.channels[0].length, message.sampleRate);
        message.channels.forEach((samples, channel) => buffer.copyToChannel(samples, channel));
        node.buffer = buffer;
        break;
      }
      case 'param':
        if (node) {
          const source = this.sources.get(message.id);
          if (source && message.name === 'playbackRate') {
            if (message.time !== undefined || source.when !== undefined) source.variableRate = true;
            this.unshape(source);
          }
          if (message.time === undefined) node[message.name].value = message.value;
          else node[message.name].setValueAtTime(message.value, message.time);
        }
        break;
      case 'property':
        if (node) {
          if (['loop', 'loopStart', 'loopEnd'].includes(message.name)) this.unshape(this.sources.get(message.id));
          node[message.name] = message.value;
        }
        break;
      case 'connect': {
        const source = this.sources.get(message.id);
        (source?.gain ?? node)?.connect(this.nodes.get(message.destination));
        source?.destinations.add(message.destination);
        break;
      }
      case 'disconnect': {
        const source = this.sources.get(message.id);
        (source?.gain ?? node)?.disconnect();
        if (source) { source.destinations.clear(); source.joinable = false; }
        break;
      }
      case 'start': {
        const when = Math.max(message.when, c.currentTime);
        node.start(when, message.offset);
        const source = this.sources.get(message.id);
        if (source) this.shape(source, when, message.offset ?? 0);
        break;
      }
      case 'stop':
        node?.stop(message.when);
        if (this.sources.has(message.id)) this.sources.get(message.id).joinable = false;
        break;
      case 'resume': void c.resume(); break;
      case 'suspend': void c.suspend(); break;
      default: throw new Error(`Unsupported audio operation: ${message.op}`);
    }
  }
  close() {
    for (const [id, node] of this.nodes) if (id > 1) {
      if (typeof node.stop === 'function') { try { node.stop(); } catch {} }
      node.disconnect();
    }
    for (const source of this.sources.values()) source.gain.disconnect();
    this.sources.clear();
    this.nodes.clear();
    return this.context.close();
  }
}
