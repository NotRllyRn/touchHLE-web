// SPDX-License-Identifier: MPL-2.0
// Product handler bodies; browser/Audio/Worker shims isolate async ownership races.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function fixture(role){
 const elements=new Map(),workers=[],bridges=[],transfers=[],sessions=[];
 const canvas=()=>({cloneNode:canvas,replaceWith(){},transferControlToOffscreen:()=>({})});
 const element=name=>{if(!elements.has(name))elements.set(name,{...canvas(),disabled:false,textContent:'',hidden:false,checked:false,value:'',files:[{size:10}]});return elements.get(name);};
 const document={querySelector:element};
 class Worker{constructor(url){this.url=url;this.terminated=0;this.posts=[];workers.push(this);}terminate(){this.terminated++;}postMessage(data){this.posts.push(data);}}
 class AudioBridge{constructor(){this.gate=deferred();this.closed=0;bridges.push(this);}start(){return this.gate.promise;}close(){this.closed++;return Promise.resolve();}handle(){}}
 const installSaveTransfer=()=>{const t={busy:false,active:false,setActive(v){this.active=v;},dispose(){}};transfers.push(t);return t;};
 const attachSaveSession=(_worker,options)=>{const s={options,stops:0,disposed:0,stop(){this.stops++;},dispose(){this.disposed++;}};sessions.push(s);return s;};
 const env={document,Worker,AudioBridge,installSaveTransfer,attachSaveSession,attachExternalLinks:()=>({session:'test',dispose(){}}),attachInput:()=>({cancel(){}}),testAttachSaveSession:attachSaveSession,testAttachExternalLinks:()=>({session:'test',dispose(){}}),navigator:{},URLSearchParams,location:{search:''},performance:{now:()=>0},setInterval:()=>1,clearInterval(){},console};
 let source=readFileSync(new URL(role==='upload'?'../app.mjs':'../game.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
 if(role==='standard'){
  source=source.slice(0,source.indexOf('const started = performance.now();'))+'\nfile = {}; game = {}; transfer = installSaveTransfer(); attachSaveSession = testAttachSaveSession; attachExternalLinks = testAttachExternalLinks;\n'+source.slice(source.indexOf('run.onclick = async'));
 }
 runInNewContext(source,env);
 const run=element('#run'),stop=element('#stop');
 if(role==='upload'){element('#ipa').onchange();workers.at(-1).onmessage({data:{ok:true,app:{bundleId:'test',name:'test',architecture:'ARM',entries:1}}});}
 return{elements,workers,bridges,transfers,sessions,run,stop,element};
}
// Standard dashboard lifecycle is covered by game-dashboard.test.mjs.
for(const role of ['upload']){
 for(const late of ['reject','resolve'])test(`${role}: stale audio ${late} after Stop cannot touch newer live session`,async()=>{
  const f=fixture(role),first=f.run.onclick();f.stop.onclick();const second=f.run.onclick();f.bridges[1].gate.resolve({});await second;const worker=f.workers.at(-1),session=f.sessions.at(-1),transfer=f.transfers.at(-1);assert(transfer.active);const before={stopped:worker.terminated,disposed:session.disposed,closed:f.bridges[1].closed};
  if(late==='reject')f.bridges[0].gate.reject(Error('old audio failure'));else f.bridges[0].gate.resolve({});await first;
  assert.deepEqual({stopped:worker.terminated,disposed:session.disposed,closed:f.bridges[1].closed},before);assert(transfer.active);assert(f.run.disabled);f.stop.onclick();assert.equal(session.stops,1);assert.equal(worker.terminated,0);assert(transfer.active);session.options.onStopFailed();assert(transfer.active);await f.run.onclick();assert.equal(f.sessions.length,1);session.options.onStopped();assert.equal(worker.terminated,1);assert.equal(transfer.active,false);
 });
 test(`${role}: transfer busy and repeated Play refused during audio admission and stop failure`,async()=>{const f=fixture(role),transfer=f.transfers.at(-1);transfer.busy=true;await f.run.onclick();assert.equal(f.bridges.length,0);transfer.busy=false;const start=f.run.onclick();await f.run.onclick();assert.equal(f.bridges.length,1);f.bridges[0].gate.resolve({});await start;f.stop.onclick();f.sessions[0].options.onStopFailed();await f.run.onclick();assert.equal(f.bridges.length,1);assert(transfer.active);});
 test(`${role}: stale audio rejection after Stop cannot reset busy transfer`,async()=>{const f=fixture(role),start=f.run.onclick();f.stop.onclick();const transfer=f.transfers.at(-1);transfer.busy=true;f.run.disabled=true;const state=f.element(role==='upload'?'#status':'#state');state.textContent='Transfer in progress';f.bridges[0].gate.reject(Error('late'));await start;assert(transfer.busy);assert(f.run.disabled);assert.equal(state.textContent,'Transfer in progress');});
}
test('upload: stale validation callbacks and live selection/test requests have no effect',async()=>{const f=fixture('upload');const old=f.workers[0],callback=old.onmessage,error=old.onerror;f.element('#ipa').onchange();const current=f.workers.at(-1);callback({data:{ok:true,app:{bundleId:'wrong'}}});error({message:'stale'});assert.equal(current.terminated,0);assert.equal(f.transfers.length,1);current.onmessage({data:{ok:true,app:{bundleId:'new'}}});const start=f.run.onclick();f.element('#ipa').onchange();f.element('#test').onclick();assert.equal(f.workers.length,2);f.bridges[0].gate.resolve({});await start;const active=f.workers.at(-1);f.element('#ipa').onchange();f.element('#test').onclick();assert.equal(active.terminated,0);assert.equal(f.workers.length,3);});
