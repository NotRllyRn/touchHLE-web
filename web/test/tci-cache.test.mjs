// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const context={WebAssembly,performance};vm.createContext(context);
vm.runInContext(await readFile(new URL('../tci-jit.js',import.meta.url),'utf8'),context);
const Class=context.TouchHLETciJit;
function fixture(){
 const memory=new WebAssembly.Memory({initial:8}),events=[],order=new Map();let next=8193;
 const jit=new Class(memory,()=>0,()=>{const fn=next++;events.push(['add',fn]);return fn;},fn=>events.push(['remove',fn]),1,{counter:0,clear:()=>events.push(['clear'])});
 jit.names=['exit_tb'];
 for(let i=0;i<8192;i++){
  const ptr=16384+i*16,block={size:10,count:1,fn:i+1,bytes:128,failed:false};
  new Uint8Array(memory.buffer).set([0,10,123,0,0,0,0,0,0,0],ptr);
  jit.blocks.set(ptr,block);jit.touchCompiled(block);jit.compiled.set(ptr,block);
  jit.liveBytes+=128;jit.liveModules++;order.set(ptr,block.fn);
 }
 jit.stats.liveBytes=jit.liveBytes;
 const hit=ptr=>{const fn=order.get(ptr);assert.equal(jit.lookup(ptr),fn);order.delete(ptr);order.set(ptr,fn);};
 return{jit,events,order,hit};
}
test('cache evicts least-recently looked-up functions, clearing native dispatch before releasing slots',()=>{
 const {jit,events,order,hit}=fixture();let seed=123456;
 for(let i=0;i<10000;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;hit(16384+(seed%8192)*16);}
 // Exercise timestamp exhaustion with both recently and long-ago used entries.
 jit.useClock=Number.MAX_SAFE_INTEGER-1;
 for(const ptr of [16384+16,16384+32,16384+48])hit(ptr);
 const victimEntries=[...order].slice(0,2049);
 const ptr=16384+8192*16;
 new Uint8Array(jit.memory.buffer).set([0,10,123,0,0,0,0,0,0,0],ptr);
 jit.register(ptr,10);const fn=jit.lookup(ptr);
 assert.equal(fn,8193);
 assert.deepEqual(events,[['clear'],...victimEntries.map(([,v])=>['remove',v]),['add',8193]]);
 for(const [address] of victimEntries){assert.equal(jit.blocks.get(address).fn,0);assert(!jit.compiled.has(address));}
 assert.equal(jit.liveModules,6144);
 assert.equal(jit.liveBytes,[...jit.compiled.values()].reduce((n,b)=>n+b.bytes,0));
 assert.equal(jit.stats.liveBytes,jit.liveBytes);
 assert(Number.isSafeInteger(jit.useClock)&&jit.useClock<Number.MAX_SAFE_INTEGER);
});
test('replacement retires the old function, and reset releases all surviving slots and clock state',()=>{
 const {jit,events}=fixture();const ptr=16384,old=jit.blocks.get(ptr).fn;
 jit.register(ptr,10);assert(!jit.compiled.has(ptr));assert.deepEqual(events,[['remove',old]]);
 const fn=jit.lookup(ptr);assert(fn&&fn!==old);assert.equal(jit.liveModules,8192);
 const survivors=[...jit.blocks.values()].filter(b=>b.fn).map(b=>b.fn);
 events.length=0;jit.reset();
 assert.deepEqual(events,[['clear'],...survivors.map(n=>['remove',n])]);
 assert.equal(jit.blocks.size,0);assert.equal(jit.compiled.size,0);assert.equal(jit.liveModules,0);
 assert.equal(jit.liveBytes,0);assert.equal(jit.stats.liveBytes,0);assert.equal(jit.useClock,0);
});
