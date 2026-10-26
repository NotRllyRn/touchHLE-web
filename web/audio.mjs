// SPDX-License-Identifier: MPL-2.0
export class AudioBridge {
  constructor(context = new AudioContext()) {
    this.context = context;
    this.nodes = new Map([[0, context.destination], [1, context.listener]]);
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
        if (message.kind === 'source') created.onended = () => {
          created.disconnect(); this.nodes.delete(message.id);
        };
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
          if (message.time === undefined) node[message.name].value = message.value;
          else node[message.name].setValueAtTime(message.value, message.time);
        }
        break;
      case 'property': if (node) node[message.name] = message.value; break;
      case 'connect': node?.connect(this.nodes.get(message.destination)); break;
      case 'disconnect': node?.disconnect(); break;
      case 'start': node.start(Math.max(message.when, c.currentTime), message.offset); break;
      case 'stop': node?.stop(message.when); break;
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
    this.nodes.clear();
    return this.context.close();
  }
}
