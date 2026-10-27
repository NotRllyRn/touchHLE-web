// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileRecord, prepareCache, encodeBytes } from '../tci-precompile.mjs';
const names = ['movi_i32', 'brcond_i32', 'goto_tb', 'exit_tb', 'qemu_ld_i32'];
const word = n => [n&255, (n>>>8)&255, (n>>>16)&255, n>>>24];
const op = (name, ...args) => [names.indexOf(name), args.length+2, ...args];
const exit = n => op('exit_tb', ...word(n), 0,0,0,0);
function engine(start, code, step = () => { throw Error('Unexpected helper'); }) {
  const memory = new WebAssembly.Memory({ initial: 2 });
  new Uint8Array(memory.buffer).set(code, start);
  const jit = new TouchHLETciJit(memory, step, fn=>fn, ()=>{}, 1);
  jit.names = names;
  return { memory, jit, view: new DataView(memory.buffer) };
}
async function archiveOf(source, start, length) {
  const { key } = source.jit.describePortable(start, length), abi = source.jit.portableAbi();
  const bytes = compileRecord(key, abi);
  return prepareCache({format:1, abi, blocks:[{key, wasm:encodeBytes(bytes)}]});
}
function run(e, start, length, cache) {
  e.jit.portable = cache;
  e.jit.register(start, length);
  const fn = e.jit.lookup(start); assert.ok(fn, e.jit.stats.lastFailure);
  return fn(0, 128, 512, 256);
}

test('offline Wasm reuses normalized forward branches and live exit identities across memories', async () => {
  const code = (base, identity) => [
    ...op('brcond_i32', 0, 255, ...word(0), 8, ...word(base+20)),
    ...op('movi_i32', 1, ...word(42)), ...exit(identity)];
  const source = engine(1024, code(1024, 123));
  const cache = await archiveOf(source, 1024, 30);
  for (const base of [2048, 4096]) {
    const e = engine(base, code(base, base+500));
    assert.equal(run(e, base, 30, cache), 0);
    assert.equal(e.view.getUint32(256,true), base+500);
    assert.equal(e.view.getUint32(132,true), 0);
    e.view.setUint32(128,1,true);
    e.jit.lookup(base)(0,128,512,256);
    assert.equal(e.view.getUint32(132,true),42);
    assert.equal(e.jit.stats.precompiled,1);
    assert.equal(e.jit.stats.precompiledMisses,0);
  }
});

test('portable links follow current patches after memory growth and re-registration', async () => {
  const code = op('goto_tb',0,0,...word(100));
  const source = engine(1024, code), cache = await archiveOf(source,1024,code.length);
  const e = engine(2048,code);
  assert.equal(run(e,2048,code.length,cache),2156);
  e.memory.grow(1);
  new DataView(e.memory.buffer).setInt32(2052,-100,true);
  assert.equal(e.jit.lookup(2048)(0,128,512,256),1956);
  e.jit.reset();
  assert.equal(run(e,2048,code.length,cache),1956);
  assert.equal(e.jit.stats.precompiled,2);
});

test('portable helper receives relocated PC and exceptions propagate', async () => {
  const code = [...op('qemu_ld_i32',1,0,...word(0)),...exit(1)];
  const source=engine(1024,code),cache=await archiveOf(source,1024,code.length);
  let pc;
  const e=engine(8192,code,(_env,_regs,address)=>{pc=address;throw Error('guest fault');});
  assert.throws(()=>run(e,8192,code.length,cache),/guest fault/);
  assert.equal(pc,8192);
});

test('portable immediates use live values; changed opcodes miss and mismatched ABI rejects', async () => {
  const code=[...op('movi_i32',1,...word(17)),...exit(1)];
  const source=engine(1024,code),cache=await archiveOf(source,1024,code.length);
  const changed=[...op('movi_i32',1,...word(99)),...exit(2)];
  const e=engine(2048,changed);run(e,2048,changed.length,cache);
  assert.equal(e.view.getUint32(132,true),99);
  assert.equal(e.jit.stats.precompiled,1);assert.equal(e.jit.stats.precompiledMisses,0);
  e.jit.reset();new Uint8Array(e.memory.buffer).set(exit(99),2048);
  run(e,2048,10,cache);
  assert.equal(e.jit.stats.precompiledMisses,1);
  e.jit.reset();e.jit.portable={...cache,abi:'different'};e.jit.register(2048,changed.length);
  assert.equal(e.jit.lookup(2048),0);assert.match(e.jit.stats.lastFailure,/ABI mismatch/);
});

test('portable archive rejects malformed code, corrupt Wasm and duplicates', async () => {
  assert.throws(()=>compileRecord('0:AA==',JSON.stringify({version:2,names})),/operation/);
  await assert.rejects(prepareCache({format:2}),/archive/);
  const source=engine(1024,exit(1)),abi=source.jit.portableAbi();
  const {key}=source.jit.describePortable(1024,10);
  await assert.rejects(prepareCache({format:1,abi,blocks:[{key,wasm:'AAAA'}]}),WebAssembly.CompileError);
  const entry={key,wasm:encodeBytes(compileRecord(key,abi))};
  await assert.rejects(prepareCache({format:1,abi,blocks:[entry,entry]}),/Duplicate/);
});
