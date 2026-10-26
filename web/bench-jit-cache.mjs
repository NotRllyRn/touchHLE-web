// SPDX-License-Identifier: MPL-2.0
// Synthetic compiler-cache pressure, not a game startup or CPU throughput test.
import { readFile } from 'node:fs/promises';
import { runInThisContext } from 'node:vm';
runInThisContext(await readFile(process.env.JIT_COMPILER || new URL('./tci-jit.js', import.meta.url), 'utf8'));
const hot=4096, cold=8192, batch=512;
for(let trial=0;trial<5;trial++) {
  const memory=new WebAssembly.Memory({initial:8}), heap=new Uint8Array(memory.buffer);
  const word=n=>[n&255,(n>>>8)&255,(n>>>16)&255,n>>>24];
  const jit=new globalThis.TouchHLETciJit(memory,()=>{throw Error('Unexpected helper');},fn=>fn,()=>{},1);
  jit.names=['movi_i32','exit_tb'];
  for(let i=0;i<hot+cold;i++) {
    const ptr=1024+i*32, code=[0,7,0,...word(i),1,10,...word(123),0,0,0,0];
    heap.set(code,ptr);jit.register(ptr,code.length);
  }
  const regs=new Uint32Array(memory.buffer,128,16);
  const visit=i=>{
    const fn=jit.lookup(1024+i*32);
    if(!fn)throw Error(jit.stats.lastFailure || 'Missing compiled function');
    fn(0,128,256,512);
    if(regs[0]!==i)throw Error('Stale compiled block');
  };
  const started=performance.now();
  for(let i=0;i<hot;i++)visit(i);
  for(let phase=0;phase<cold;phase+=batch) {
    for(let i=0;i<batch;i++)visit(hot+phase+i);
    for(let i=0;i<hot;i++)visit(i);
  }
  const ms=performance.now()-started;
  if(jit.stats.failed || jit.liveModules>8192 || jit.liveBytes>16*1024*1024)throw Error('Cache invariant failed');
  console.log(JSON.stringify({trial,ms,compiled:jit.stats.compiled,compileMs:jit.stats.compileMs,
    evictions:jit.stats.evictions,liveModules:jit.liveModules,liveBytes:jit.liveBytes}));
  jit.reset();
}
