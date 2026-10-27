// SPDX-License-Identifier: MPL-2.0
import { AudioBridge } from './audio.mjs';
import { attachInput } from './input.mjs';
import { checkIdentity, verifyFile, runtimeFiles } from './package-identity.mjs';
const run = document.querySelector('#run'), stop = document.querySelector('#stop');
const state = document.querySelector('#state'), log = document.querySelector('#status');
let worker, audio, game, file, precompiled;
const get = async path => {
  const response = await fetch(path);
  if (!response.ok) throw Error(`${path}: HTTP ${response.status}`);
  return response;
};
const finish = () => {
  worker?.terminate(); worker = undefined;
  if (audio) { void audio.close(); audio = undefined; }
  run.disabled = !file; stop.disabled = true;
};
stop.onclick = () => { finish(); state.textContent = 'Stopped.'; };
const started = performance.now();
try {
  game = await (await get('./game.json')).json();
  if (game.format !== 1) throw Error('Unsupported game package');
  checkIdentity(game.identity, game.identity);
  document.title = document.querySelector('#title').textContent = game.name;
  [file, precompiled] = await Promise.all([
    get('./game.ipa').then(r => r.blob()),
    new URLSearchParams(location.search).get('cpu') === 'jit' ? undefined : get('./precompiled.json').then(r => r.json()),
  ]);
  if (precompiled !== undefined) {
    if (precompiled?.format !== 1) throw Error('Unsupported precompiled archive');
    checkIdentity(game.identity, precompiled.identity);
  }
  state.textContent = 'Checking game files…';
  const validationStarted = performance.now();
  await Promise.all([
    file.arrayBuffer().then(bytes => verifyFile('game.ipa', bytes, game.identity.ipa)),
    ...runtimeFiles.map(async name => verifyFile(name,
      await (await get(`./${name}`)).arrayBuffer(), game.identity.files[name])),
  ]);
  console.log('Game validation ms', performance.now() - validationStarted);
  console.log('Game download ms', performance.now() - started);
  state.textContent = 'Ready.'; run.disabled = false;
} catch (error) { state.textContent = `Unable to load game: ${error.message}`; }
run.onclick = async () => {
  if (!file) return;
  finish(); run.disabled = true; stop.disabled = false;
  state.textContent = 'Starting game…'; log.textContent = '';
  try {
    const bridge = audio = new AudioBridge();
    const audioClock = await bridge.start();
    if (audio !== bridge) return;
    const previous = document.querySelector('#canvas'), canvas = previous.cloneNode();
    previous.replaceWith(canvas);
    worker = new Worker('./runtime-worker.js');
    attachInput(canvas, message => worker?.postMessage(message));
    const lines = [];
    worker.onmessage = ({data}) => {
      if (data.type === 'audio') {
        try { audio?.handle(data); } catch(error) { state.textContent = String(error); finish(); }
        return;
      }
      console.log('WORKER', JSON.stringify(data));
      lines.push(data.type === 'exit' ? `Guest exited with status ${data.code}.` : data.message);
      if (lines.length > 200) lines.shift(); log.textContent = lines.join('\n');
      if (data.type === 'exit' || data.type === 'error') { state.textContent = lines.at(-1); finish(); }
      else state.textContent = 'Game running; startup and scene loading may take time.';
    };
    worker.onerror = event => { state.textContent = `Runtime failed: ${event.message}`; finish(); };
    const offscreen = canvas.transferControlToOffscreen();
    worker.postMessage({type:'start', file, canvas:offscreen, audioClock, cpuBackend:'jit',
      jitThreshold:new URLSearchParams(location.search).get('jitThreshold') === '1' ? 1 : game.jitThreshold, precompiled}, [offscreen]);
  } catch(error) { state.textContent = String(error); finish(); }
};
