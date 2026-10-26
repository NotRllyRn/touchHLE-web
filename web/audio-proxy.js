// SPDX-License-Identifier: MPL-2.0
// Emscripten OpenAL's playback-only Web Audio interface, forwarded to the page.
// Buffers contain guest-decoded PCM; neither audio nor assets leave the device.
self.installTouchHLEAudio = (clock, send) => {
  let nextId = 2;
  const emit = command => send({ type: 'audio', ...command });
  class Param {
    constructor(id, name, value = 0) { this.id = id; this.name = name; this.current = value; }
    get value() { return this.current; }
    set value(value) { this.current = value; emit({ op: 'param', id: this.id, name: this.name, value }); }
    setValueAtTime(value, time) { this.current = value; emit({ op: 'param', id: this.id, name: this.name, value, time }); return this; }
  }
  class Node {
    constructor(kind, id = nextId++) {
      this.id = id;
      if (id > 1) emit({ op: 'create', id, kind });
      for (const name of ['gain', 'playbackRate', 'positionX', 'positionY', 'positionZ',
        'orientationX', 'orientationY', 'orientationZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ']) {
        this[name] = new Param(id, name, ['gain', 'playbackRate', 'orientationX', 'upY'].includes(name) ? 1 : name === 'forwardZ' ? -1 : 0);
      }
      for (const name of ['loop', 'loopStart', 'loopEnd', 'panningModel', 'distanceModel',
        'refDistance', 'maxDistance', 'rolloffFactor', 'coneInnerAngle', 'coneOuterAngle', 'coneOuterGain']) {
        let value;
        Object.defineProperty(this, name, { get: () => value, set: next => {
          value = next; emit({ op: 'property', id, name, value: next });
        }});
      }
    }
    connect(node) { emit({ op: 'connect', id: this.id, destination: node.id }); return node; }
    disconnect() { emit({ op: 'disconnect', id: this.id }); }
    set buffer(buffer) {
      this.audioBuffer = buffer;
      emit({ op: 'buffer', id: this.id, sampleRate: buffer.sampleRate, channels: buffer.channels });
    }
    get buffer() { return this.audioBuffer; }
    start(when = 0, offset = 0) { emit({ op: 'start', id: this.id, when, offset }); }
    stop(when = 0) { emit({ op: 'stop', id: this.id, when }); }
  }
  class Buffer {
    constructor(numberOfChannels, length, sampleRate) {
      this.numberOfChannels = numberOfChannels; this.length = length; this.sampleRate = sampleRate;
      this.duration = length / sampleRate;
      this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    }
    getChannelData(channel) { return this.channels[channel]; }
  }
  return class AudioContext {
    constructor() {
      this.sampleRate = clock.sampleRate;
      this.state = 'running';
      this.destination = new Node('destination', 0);
      this.listener = new Node('listener', 1);
    }
    get currentTime() { return clock.time + (performance.timeOrigin + performance.now() - clock.timestamp) / 1000; }
    createGain() { return new Node('gain'); }
    createPanner() { return new Node('panner'); }
    createBufferSource() { return new Node('source'); }
    createBuffer(channels, length, rate) { return new Buffer(channels, length, rate); }
    resume() { this.state = 'running'; emit({ op: 'resume' }); return Promise.resolve(); }
    suspend() { this.state = 'suspended'; emit({ op: 'suspend' }); return Promise.resolve(); }
  };
};
