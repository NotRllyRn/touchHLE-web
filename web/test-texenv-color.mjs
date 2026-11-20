// SPDX-License-Identifier: MPL-2.0
// Usage: node web/test-texenv-color.mjs EMITTED_JS RECEIPT_JSON [--candidate]
// Executes the exact emitted TexEnvJIT and renderer-cache implementations.
import {readFile,writeFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const file=process.argv[2],out=process.argv[3],candidate=process.argv.includes('--candidate');
const text=await readFile(file,'utf8');
function extracted(start,end){assert.equal(text.split(start).length,2);return text.slice(text.indexOf(start)+start.length,text.indexOf(end,text.indexOf(start)));}
const heap=new Float32Array(16),ctx=vm.createContext({assert,Math,GLImmediate:{currentMatrix:0},HEAPF32:heap,abort:m=>{throw Error(m);},err:m=>{throw Error(m);},ptrToString:x=>x.toString(16)});
const map=vm.runInContext('('+extracted('spawnMapTreeLib: ', ',\n  TexEnvJIT:')+')',ctx)().create();
const env=vm.runInContext('('+extracted('spawnTexEnvJIT: ', ',\n  vertexData:')+')',ctx)();env.init(null,2);env.setGLSLVars('u_tex','v_tex','v_color',null);
const configure=unit=>{env.hook_activeTexture(33984+unit);env.hook_enable(3553);for(const [p,v]of [[8704,34160],[34161,7681],[34176,5890],[34192,768],[34162,8448],[34184,5890],[34185,34166],[34200,770],[34201,770]])env.hook_texEnvi(8960,p,v);};configure(0);
let compiles=0;const rows=[];
for(const a of [0,.6,.8,.999,1,.75,0,1]){heap.set([0,0,0,a]);env.hook_texEnvfv(8960,8705,0);const key=map.getStaticKeyView();env.traverseState(key);let shader=key.get();if(!shader){shader={id:++compiles,source:env.genAllPassLines('gl_FragColor')};key.set(shader);}rows.push({alpha:heap[3],program:shader.id,source:shader.source,color:candidate?Array.from(env.getTexEnvColor(0)):undefined});}
if(!candidate){assert.equal(rows[0].program,rows[1].program);assert.equal(rows[0].program,rows[2].program);assert.notEqual(rows[0].program,rows[4].program);assert(rows[1].source.includes('vec4(0.0, 0.0, 0.0, 0.0)'));}
else {assert.equal(compiles,1);assert(rows.every(r=>r.source.includes('u_texEnvColor0.a')&&!r.source.includes('vec4(0.0, 0.0, 0.0,')));assert(rows.every(r=>r.color[3]===r.alpha));configure(1);heap.set([.2,.3,.4,.5]);env.hook_texEnvfv(8960,8705,0);assert.deepEqual(Array.from(env.getTexEnvColor(0)),[0,0,0,1]);assert.equal(env.getTexEnvColor(1)[3],.5);}
await writeFile(out,JSON.stringify({source:file,candidate,compiles,passed:true,rows},null,2)+'\n');console.log(JSON.stringify({candidate,compiles,passed:true}));
