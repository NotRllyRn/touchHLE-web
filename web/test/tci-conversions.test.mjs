// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import '../tci-jit.js';
import {compileRecord,prepareCache,encodeBytes} from '../tci-precompile.mjs';
const names=['call','exit_tb','brcond_i32','movi_i32','mov_i32','sub_i32','goto_tb'];
const word=n=>[n&255,n>>>8&255,n>>>16&255,n>>>24];
const op=(n,...a)=>[names.indexOf(n),a.length+2,...a];
const imm=n=>[255,...word(n)];
const exit=()=>op('exit_tb',...word(123),0,0,0,0);
const fp={callees:[],rounding:0,flags:1,nearest:0,inexact:32};
const argumentRegisters=[0,1,2,3,5,6,7,8,9,10,11,12];
const sentinel=0x1234567887654321n;
function fixture(code,{base=4096,descriptors=true,call=()=>sentinel}={}) {
 const memory=new WebAssembly.Memory({initial:2});
 new Uint8Array(memory.buffer).set(code,base);
 const dispatch={counter:96,clear(){},call,...(descriptors?{floatNarrow:900,floatToInt:901,floatMath:fp}:{})};
 const jit=new TouchHLETciJit(memory,()=>{throw Error('Unexpected interpreter step');},f=>f,()=>{},1,dispatch);
 jit.names=names;
 return {memory,jit,base,code,regs:()=>new Uint32Array(memory.buffer,128,16),
  run(){jit.register(base,code.length);const fn=jit.lookup(base);assert(fn,jit.stats.lastFailure);return fn(0,128,512,256);}};
}
const scratch=new DataView(new ArrayBuffer(8));
function doubleWords(x){scratch.setFloat64(0,x,true);return [scratch.getUint32(0,true),scratch.getUint32(4,true)];}
function floatBits(x){scratch.setFloat32(0,x,true);return scratch.getUint32(0,true);}
function init(f,input){const r=f.regs();for(let i=0;i<16;i++)r[i]=0x12345000+i;r[0]=input[0];r[1]=input[1];r[2]=800;
 new Uint8Array(f.memory.buffer).fill(0x82,800,824);return Array.from(r);}
for(const portable of [false,true]) {
 test(`conversion fallback preserves actual normalized arguments and current helper PC (portable=${portable})`,async()=>{
  for(const [callee,inputs] of [[900,[[1,0x3ff00000],doubleWords(Infinity),doubleWords(NaN),[1,0]]],
   [901,[[1,0x6a5b4c3d],[0x7fc12345,0x6a5b4c3d],[0x4f000000,0x6a5b4c3d],[0xcf000000,0x6a5b4c3d]]]]) {
   let observed;
   const f=fixture([...op('call',...imm(callee)),...exit()],{base:8192,call:(pc,target,...args)=>{observed={pc,target,args};return sentinel;}});
   if(portable){const {key}=f.jit.describePortable(f.base,f.code.length),abi=f.jit.portableAbi();
    f.jit.portable=await prepareCache({format:1,abi,blocks:[{key,wasm:encodeBytes(compileRecord(key,abi))}]});}
   for(const input of inputs){const prior=init(f,input);observed=null;f.run();
    assert.deepEqual(observed,{pc:f.base,target:callee,args:argumentRegisters.map(i=>prior[i]|0)});
    assert.equal(f.regs()[0],0x87654321);assert.equal(f.regs()[1],0x12345678);
    assert.deepEqual(Array.from(f.regs().slice(2)),prior.slice(2));}
   assert.equal(f.jit.stats.failed,0);if(portable)assert.equal(f.jit.stats.precompiled,inputs.length);
  }
 });
 test(`conversion exact and sticky paths survive memory growth, live pointers and relocated cache (portable=${portable})`,async()=>{
  for(const callee of [900,901]) {
   const code=[...op('call',...imm(callee)),...exit()];
   const source=fixture(code);const abi=source.jit.portableAbi(),{key}=source.jit.describePortable(source.base,code.length);
   const cache=portable?await prepareCache({format:1,abi,blocks:[{key,wasm:encodeBytes(compileRecord(key,abi))}]}):null;
   const inputs=callee===900?[0,-0,1,-1,2**-126,2**127,Math.fround(3.25),Math.fround(-123.125)]:[0,-0,1,-1,1.75,-1.75,2**-126,2**30,-(2**30)];
   const f=fixture(code,{base:16384,call:()=>{throw Error('Unexpected conversion fallback');}});
   if(cache)f.jit.portable=cache;
   for(const [index,x] of inputs.entries()) {
    if(index===3)f.memory.grow(1);
    const prior=init(f,callee===900?doubleWords(x):[floatBits(x),0xabcdef01]);
    const r=f.regs(),ptr=index%2?900:800;r[2]=ptr;prior[2]=ptr;
    const bytes=new Uint8Array(f.memory.buffer);bytes.fill(0xa5,ptr,ptr+24);bytes[ptr+1]=index;
    const before=bytes.slice(ptr,ptr+24);f.run();
    if(callee===900){assert.equal(r[0],floatBits(x));assert.equal(r[1],0);}
    else{const n=Math.trunc(x);assert.equal(r[0],n>>>0);assert.equal(r[1],n<0?0xffffffff:0);if(x!==n)before[1]|=32;}
    assert.deepEqual(bytes.slice(ptr,ptr+24),before);assert.deepEqual(Array.from(r.slice(2)),prior.slice(2));
   }
   if(cache)assert.equal(f.jit.stats.precompiled,inputs.length);assert.equal(f.jit.stats.failed,0);
  }
 });
}
test('absent descriptors and indirect callees retain normal invocation; ABI binds optional helper identities',()=>{
 for(const [descriptors,indirect] of [[false,false],[true,true]]) {
  let calls=0;const f=fixture([...op('call',...(indirect?[6]:imm(901))),...exit()],{descriptors,call:()=>{calls++;return sentinel;}});
  init(f,[floatBits(1.5),0xabcdef01]);f.regs()[6]=901;f.run();assert.equal(calls,1);assert.equal(f.regs()[0],0x87654321);
 }
 const f=fixture(exit());const abi=f.jit.portableAbi();
 f.jit.dispatch.floatNarrow=902;assert.notEqual(f.jit.portableAbi(),abi);
 f.jit.dispatch.floatNarrow=900;f.jit.dispatch.floatToInt=903;assert.notEqual(f.jit.portableAbi(),abi);
 delete f.jit.dispatch.floatToInt;delete f.jit.dispatch.floatNarrow;
 assert(!f.jit.portableAbi().includes('floatNarrow'));assert(!f.jit.portableAbi().includes('floatToInt'));
});
test('skipped conversion preserves result registers at a forward join and exceptions propagate from fallback',()=>{
 for(const callee of [900,901]){
  const branch=op('brcond_i32',5,...imm(0),8,...word(4096+13+7));
  const f=fixture([...branch,...op('call',...imm(callee)),...exit()],{call:()=>{throw Error('conversion fault');}});
  const before=init(f,[0x7fc00001,0x7ff80000]);f.regs()[5]=0;f.run();assert.equal(f.regs()[0],before[0]);assert.equal(f.regs()[1],before[1]);
  f.regs()[5]=1;assert.throws(()=>f.run(),/conversion fault/);
 }
});
test('same-block loop preserves conversion inputs and executes current mutable link',()=>{
 const base=4096,code=[...op('mov_i32',0,6),...op('call',...imm(901)),...op('sub_i32',5,5,...imm(1))];
 const branchPC=base+code.length;
 const branch=op('brcond_i32',5,...imm(0),8,...word(0));
 const gotoPC=branchPC+branch.length;
 const field=(gotoPC+5)&~3;
 const goto=op('goto_tb',...Array(field-gotoPC-2).fill(0),...word(base-(field+4)));
 branch.splice(branch.length-4,4,...word(gotoPC+goto.length));
 code.push(...branch,...goto,...exit());
 const f=fixture(code,{call:()=>{throw Error('Unexpected helper');}});init(f,[0,0]);f.regs()[5]=5;f.regs()[6]=floatBits(-3.75);
 f.run();assert.equal(f.regs()[0],(-3)>>>0);assert.equal(f.regs()[1],0xffffffff);assert.equal(f.regs()[5],0);
 assert.equal(new Uint8Array(f.memory.buffer)[801],0xa2);
});

test('narrowing accepts exact normal float32 values and preserves status/control bytes across signs',()=>{
 const f=fixture([...op('call',...imm(900)),...exit()],{call:()=>{throw Error('Exact narrowing unexpectedly fell back');}});
 f.jit.register(f.base,f.code.length);const fn=f.jit.lookup(f.base);assert(fn,f.jit.stats.lastFailure);
 let seed=0x79bdfeca;
 for(let i=0;i<4096;i++) {
  seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;
  const bits=((seed&0x807fffff)|((1+(i%254))<<23))>>>0;
  scratch.setUint32(0,bits,true);const x=scratch.getFloat32(0,true);
  const prior=init(f,doubleWords(x));const bytes=new Uint8Array(f.memory.buffer);bytes[801]=i&255;
  const status=bytes.slice(800,824);fn(0,128,512,256);assert.equal(f.regs()[0],bits);assert.equal(f.regs()[1],0);
  assert.deepEqual(Array.from(f.regs().slice(2)),prior.slice(2));assert.deepEqual(bytes.slice(800,824),status);
 }
 assert.equal(f.jit.stats.failed,0);
});

test('integer conversion matches truncation and sticky inexact over arbitrary float32 inputs',()=>{
 let calls=0;
 const f=fixture([...op('call',...imm(901)),...exit()],{call:()=>{calls++;return sentinel;}});
 f.jit.register(f.base,f.code.length);const fn=f.jit.lookup(f.base);assert(fn,f.jit.stats.lastFailure);
 const values=[0,0x80000000,1,0x007fffff,0x00800000,0x3f7fffff,0x3f800000,
  0x3f800001,0x3fc00000,0x4affffff,0x4b000000,0x4effffff,0x4f000000,
  0xcf000000,0x7f800000,0x7fc12345,0x7f800001];
 let seed=0x35a9feda;
 for(let i=0;i<10000;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;values.push(seed>>>0);}
 for(const [i,bits] of values.entries()) {
  scratch.setUint32(0,bits,true);const x=scratch.getFloat32(0,true);
  const prior=init(f,[bits,0x12345678]);const bytes=new Uint8Array(f.memory.buffer);bytes[801]=i&255;
  const status=bytes.slice(800,824),before=calls;fn(0,128,512,256);
  if((Math.abs(x)>=2**-126||x===0)&&Math.abs(x)<2**31){
   const n=Math.trunc(x);assert.equal(f.regs()[0],n>>>0);assert.equal(f.regs()[1],n<0?0xffffffff:0);
   assert.equal(calls,before);if(n!==x)status[1]|=32;
  }else{assert.equal(calls,before+1);assert.equal(f.regs()[0],0x87654321);assert.equal(f.regs()[1],0x12345678);}
  assert.deepEqual(bytes.slice(800,824),status);assert.deepEqual(Array.from(f.regs().slice(2)),prior.slice(2));
 }
 assert.equal(f.jit.stats.failed,0);
});
