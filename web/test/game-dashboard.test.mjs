// SPDX-License-Identifier: MPL-2.0
// Actual dashboard handlers with DOM/Worker shims; not guest runtime evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
function fixture(initialState = 'suspended') {
  const elements=new Map(), workers=[], sessions=[], bridges=[];
  function element(name) {
    if (!elements.has(name)) elements.set(name,{hidden:false,disabled:false,open:false,textContent:'',listeners:{},
      addEventListener(type,cb){this.listeners[type]=cb;},contains(){return false;},querySelector:()=>({focus(){}}),
      showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();},cloneNode:()=>element('clone'+workers.length),replaceWith(){},transferControlToOffscreen:()=>({})});
    return elements.get(name);
  }
  const transfer={active:false,busy:false,setActive(v){this.active=v;}};
  class Worker {constructor(){this.posts=[];this.terminated=0;workers.push(this);}postMessage(x){this.posts.push(x);}terminate(){this.terminated++;}}
  class AudioBridge {constructor(){this.nodes=new Map();this.commands=[];this.context={sampleRate:48000,currentTime:0,state:initialState,resume:()=>new Promise(()=>{})};bridges.push(this);}discard(id){this.nodes.get(id)?.disconnect();this.nodes.delete(id);}close(){return Promise.resolve();}handle(data){this.commands.push(data);}}
  const env={document:{querySelector:element,addEventListener(){}},Worker,AudioBridge,navigator:{},location:{search:''},URLSearchParams,performance:{now:()=>0,timeOrigin:0},
    attachInput:()=>({cancel(){}}),TouchHLEText:{attach:()=>({dispose(){}})},
    testTransfer:transfer,testSession:(_w,callbacks)=>{const s={callbacks,stops:0,stop(){this.stops++;},dispose(){}};sessions.push(s);return s;},
    testLinks:()=>({session:'fresh',dispose(){}})};
  let source=readFileSync(process.env.DASHBOARD_SOURCE || new URL('../game.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
  source=source.slice(0,source.indexOf('\ntry {\n  game ='));
  runInNewContext(source+'\nready=true;file={};game={jitThreshold:32};transfer=testTransfer;attachSaveSession=testSession;attachExternalLinks=testLinks;globalThis.api={startGame,stopGame,perform,handleAudio,resumeLoops};',env);
  return {...env,element,workers,sessions,bridges,transfer};
}
test('autostart proceeds while audio permission remains unresolved',async()=>{const f=fixture();await f.api.startGame();assert.equal(f.workers.length,1);assert.equal(f.workers[0].posts[0].type,'start');assert(f.transfer.active);});
test('restart requires confirmation and save acknowledgement before old Worker destruction/new Worker',async()=>{
 const f=fixture();await f.api.startGame();f.element('#restart').onclick();assert(f.element('#restart-dialog').open);assert.equal(f.sessions[0].stops,0);
 f.element('#confirm-restart').onclick();assert.equal(f.sessions[0].stops,1);assert.equal(f.workers[0].terminated,0);assert(f.transfer.active);
 await f.api.startGame();assert.equal(f.workers.length,1);f.sessions[0].callbacks.onStopped();await new Promise(r=>setImmediate(r));
 assert.equal(f.workers[0].terminated,1);assert.equal(f.workers.length,2);assert(f.transfer.active);
 const old=f.workers[0];old.onmessage({data:{type:'error'}});assert.equal(f.workers[1].terminated,0);assert(f.transfer.active);
});
test('slow save keeps intended restart pending; retry and late ack complete exactly once',async()=>{
 const f=fixture();await f.api.startGame();f.element('#confirm-restart').onclick();f.sessions[0].callbacks.onStopFailed();await new Promise(r=>setImmediate(r));
 assert.equal(f.workers[0].terminated,0);assert(f.transfer.active);assert.equal(f.workers.length,1);assert(!f.element('#retry-save').hidden);
 f.element('#retry-save').onclick();assert.equal(f.sessions[0].stops,2);f.sessions[0].callbacks.onStopped();await new Promise(r=>setImmediate(r));assert.equal(f.workers[0].terminated,1);assert.equal(f.workers.length,2);assert(f.transfer.active);
});
test('saved-files dialog opens only after stopped acknowledgement; busy transfer blocks close',async()=>{
 const f=fixture();await f.api.startGame();f.element('#saved-files').onclick();assert(!f.element('#files-dialog').open);
 f.sessions[0].callbacks.onStopped();await new Promise(r=>setImmediate(r));assert(f.element('#files-dialog').open);assert(!f.transfer.active);
 f.transfer.busy=true;f.element('#resume').onclick();assert(f.element('#files-dialog').open);
 f.transfer.busy=false;f.element('#resume').onclick();await new Promise(r=>setImmediate(r));assert.equal(f.workers.length,2);assert(f.transfer.active);
});

test('suspended one-shots are discarded, active loops resume once and stopped loops are released',async()=>{
 const f=fixture();await f.api.startGame();const audio=f.bridges[0];let disconnected=0;
 const node=loop=>({loop,buffer:{duration:10},disconnect(){disconnected++;}});
 audio.nodes.set(2,node(false));f.api.handleAudio({op:'start',id:2,when:0,offset:0});assert(!audio.nodes.has(2));assert.equal(audio.commands.length,0);
 audio.nodes.set(3,node(true));f.api.handleAudio({op:'start',id:3,when:0,offset:0});audio.nodes.set(4,node(true));f.api.handleAudio({op:'start',id:4,when:0,offset:0});f.api.handleAudio({op:'stop',id:4});assert(!audio.nodes.has(4));
 audio.context.state='running';f.api.resumeLoops();f.api.resumeLoops();assert.equal(audio.commands.length,1);assert.equal(audio.commands[0].id,3);assert.equal(disconnected,2);
});

// Independent clock samples model Web Audio's render-quantum clock. Contiguous
// worker times must stay contiguous, irrespective of receipt-time quantization.
function audioFixture(f) {
 const a=f.bridges.at(-1); let now=0;
 f.performance.now=()=>now;
 const clock=(wall,context)=>{now=wall*1000;a.context.currentTime=context;};
 a.nodes.set(2,{loop:false}); return {a,clock};
}
test('running epoch preserves contiguous starts and parameter timing despite clock quantization',async()=>{
 const f=fixture();await f.api.startGame();const {a,clock}=audioFixture(f);
 clock(100,2);a.context.state='running';a.context.onstatechange();
 f.api.handleAudio({op:'start',id:2,when:100.5,offset:0});
 clock(100.3,2.298);f.api.handleAudio({op:'start',id:2,when:101,offset:0});
 clock(100.4,2.405);f.api.handleAudio({op:'param',id:2,name:'gain',value:.5,time:101});
 assert.equal(a.commands[0].when,2.5);assert.equal(a.commands[1].when,3);assert.equal(a.commands[2].time,3);
});
test('immediate zero commands stay immediate and repeated running events do not rebase',async()=>{
 const f=fixture();await f.api.startGame();const {a,clock}=audioFixture(f);
 clock(50,1);a.context.state='running';a.context.onstatechange();
 clock(50.3,1.29);a.context.onstatechange();f.element('#sound').onclick();
 f.api.handleAudio({op:'start',id:2,when:51,offset:.25});f.api.handleAudio({op:'stop',id:2,when:0});
 f.api.handleAudio({op:'param',id:2,name:'gain',value:1,time:0});
 assert.equal(a.commands[0].when,2);assert.equal(a.commands[0].offset,.25);assert.equal(a.commands[1].when,0);assert.equal(a.commands[2].time,0);
});
test('each suspension invalidates translation; a running message can precede statechange',async()=>{
 const f=fixture();await f.api.startGame();const {a,clock}=audioFixture(f);
 clock(10,1);a.context.state='running';a.context.onstatechange();
 for(const [wall,context] of [[20,2],[40,3]]){
  a.context.state='suspended';a.context.onstatechange();clock(wall,context);a.context.state='running';
  f.api.handleAudio({op:'start',id:2,when:wall+.5,offset:0});assert.equal(a.commands.at(-1).when,context+.5);
  clock(wall+.3,context+.29);a.context.onstatechange();f.api.handleAudio({op:'start',id:2,when:wall+1,offset:0});assert.equal(a.commands.at(-1).when,context+1);
 }
});
test('restart resets translation and stale context statechange cannot rebase the new owner',async()=>{
 const f=fixture();await f.api.startGame();const old=audioFixture(f);old.clock(10,1);old.a.context.state='running';old.a.context.onstatechange();
 const stopped=f.api.stopGame();f.sessions[0].callbacks.onStopped();await stopped;await f.api.startGame();
 const next=audioFixture(f);next.clock(30,2);next.a.context.state='running';next.a.context.onstatechange();
 old.a.context.state='suspended';old.a.context.onstatechange();next.clock(30.3,2.29);
 // New worker's immutable clock was anchored at wall10, so worker time20 == wall30.
 f.api.handleAudio({op:'start',id:2,when:21,offset:0});assert.equal(next.a.commands.at(-1).when,3);
});

test('positive stop times still translate while suspended without retaining a running epoch',async()=>{
 const f=fixture();await f.api.startGame();const {a,clock}=audioFixture(f);
 clock(10,1);a.context.state='running';a.context.onstatechange();a.context.state='suspended';a.context.onstatechange();
 clock(20,1);f.api.handleAudio({op:'stop',id:2,when:20.5});assert.equal(a.commands.at(-1).when,1.5);
 clock(30,1);a.context.state='running';f.api.handleAudio({op:'start',id:2,when:30.5,offset:0});assert.equal(a.commands.at(-1).when,1.5);
});

test('an initially running context anchors once after construction, before scheduling',async()=>{
 const f=fixture('running');await f.api.startGame();const {a,clock}=audioFixture(f);
 clock(.01,.02);a.context.onstatechange();clock(.02,.035);a.context.onstatechange();
 f.api.handleAudio({op:'start',id:2,when:.5,offset:0});assert.equal(a.commands.at(-1).when,.51);
});
