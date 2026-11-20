// SPDX-License-Identifier: MPL-2.0
// Requires node web/build-shared-cpu.mjs with the pinned Emscripten SDK active.
// Runs serially: interpreter oracle, ordinary helpers, then conversion shortcuts.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const create=createRequire(import.meta.url)('./dist/shared-cpu-checks.js');
const source=await readFile(new URL('./tci-jit.js',import.meta.url),'utf8');
const reports=[];
for(const mode of ['interpreter','helpers','optimized']) {
 const logs=[];let narrowSites=0,integerSites=0,narrowCalls=0,integerCalls=0;
 const context=vm.createContext({performance,btoa});new vm.Script(source).runInContext(context);
 const Base=context.TouchHLETciJit;
 class Observed extends Base {
  constructor(...args){
   super(...args);
   const d=this.dispatch,{floatNarrow:narrow,floatToInt:integer}=d;
   assert(Number.isInteger(narrow)&&narrow>0&&Number.isInteger(integer)&&integer>0&&narrow!==integer,'Native helper descriptors required; rebuild CPU fixture');
   this.narrow=narrow;this.integer=integer;
   if(mode==='helpers'){delete d.floatNarrow;delete d.floatToInt;}
   const call=d.call;
   d.call=(pc,callee,...a)=>{if(callee===narrow)narrowCalls++;if(callee===integer)integerCalls++;return call(pc,callee,...a);};
  }
  compile(start,size,...rest){
   const v=new DataView(this.memory.buffer);
   for(let pc=start;pc<start+size;pc+=v.getUint8(pc+1))if(this.names[v.getUint8(pc)]==='call'&&v.getUint8(pc+2)===255){
    const callee=v.getUint32(pc+3,true);narrowSites+=callee===this.narrow?1:0;integerSites+=callee===this.integer?1:0;
   }
   return super.compile(start,size,...rest);
  }
 }
 const runtime=await create({enableTciJit:mode!=='interpreter',tciJitThreshold:1,
  preRun:[()=>{globalThis.TouchHLETciJit=Observed;}],print:x=>logs.push(x),printErr:x=>logs.push('ERR '+x)});
 assert(logs.some(x=>x.startsWith('PASS source-built')));
 const rows=logs.filter(x=>x.startsWith('CONVERSION '));assert.equal(rows.length,2688);
 if(reports.length)assert.deepEqual(rows,reports[0].rows,`${mode} ARM results/FPSCR differ from interpreter`);
 if(mode!=='interpreter'){
  assert.equal(runtime.tciJit.stats.failed,0,runtime.tciJit.stats.lastFailure);
  assert(narrowSites>=2689&&integerSites>=2689,'Require actual conversion sites, including warmup');
  for(const n of [runtime.tciJit.liveBytes,runtime.tciJit.liveModules,runtime.tciJit.blocks.size])assert.equal(n,0,'CPU engines must clean up');
 }
 const report={mode,rows,narrowSites,integerSites,narrowCalls,integerCalls,stats:runtime.tciJit?{...runtime.tciJit.stats}:null};reports.push(report);
 console.log(JSON.stringify({...report,rows:rows.length}));
}
const plain=reports[1],optimized=reports[2];
assert(optimized.narrowCalls>0&&optimized.narrowCalls<plain.narrowCalls,'Require narrowing shortcuts and fallbacks');
assert(optimized.integerCalls>0&&optimized.integerCalls<plain.integerCalls,'Require integer shortcuts and fallbacks');
console.log('PASS 2688 ARM conversion results/FPSCR across interpreter, ordinary helpers and native-bound shortcuts');
