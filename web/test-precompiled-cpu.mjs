// SPDX-License-Identifier: MPL-2.0
// Reuses the source-built CPU/fiber fixture with current portable compiler code.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {compileRecord,encodeBytes,prepareCache} from './tci-precompile.mjs';
const require=createRequire(import.meta.url),create=require('./dist/shared-cpu-checks.js');
const compiler=new vm.Script(await readFile(new URL('./tci-jit.js',import.meta.url),'utf8'));
let abi;const keys=new Set();
const run=async portable=>{
 const logs=[];
 const result=await create({enableTciJit:true,tciJitThreshold:1,
  preRun:[()=>{compiler.runInThisContext();TouchHLETciJit.portable=portable;}],
  print:s=>logs.push(s),printErr:s=>console.error(s)});
 console.log(logs.filter(s=>s.startsWith('PASS')).join('\n'));
 console.log(JSON.stringify(result.tciJit?.stats));
 assert.ok(logs.some(s=>s.startsWith('PASS')));assert.equal(result.tciJit.stats.failed,0,result.tciJit.stats.lastFailure);
 return result.tciJit.stats;
};
await run({capture:r=>{abi=r.abi;keys.add(r.key);}});
const cache=await prepareCache({format:1,abi,blocks:[...keys].map(key=>({key,wasm:encodeBytes(compileRecord(key,abi))}))});
const stats=await run(cache);assert.ok(stats.precompiled>0);console.log('PASS actual ARM/Thumb/VFP/context/fault/cache suite with offline modules',keys.size);
