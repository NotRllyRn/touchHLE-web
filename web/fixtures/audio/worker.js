// SPDX-License-Identifier: MPL-2.0
importScripts('./audio-proxy.js');
const Context = self.installTouchHLEAudio({sampleRate: 48000, time: 0,
  timestamp: performance.timeOrigin + performance.now()}, message => self.postMessage(message));
const context = new Context();
const gain = context.createGain();
gain.gain.value = 0.25;
gain.connect(context.destination);
const source = context.createBufferSource();
const buffer = context.createBuffer(1, 480, 48000);
buffer.getChannelData(0).fill(0.5);
source.buffer = buffer;
source.playbackRate.value = 1;
source.loop = false;
source.connect(gain);
source.start(0);
source.stop(0.005);
self.postMessage({type: 'done'});
