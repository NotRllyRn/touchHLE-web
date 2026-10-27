// SPDX-License-Identifier: MPL-2.0
// Local profile-assisted IPA -> static game package. Generated content is private.
import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile, copyFile, stat, readdir } from 'node:fs/promises';
import { resolve, dirname, join, extname, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { compileRecord, canonicalRecord, encodeBytes, MAX_CACHE_BYTES, MAX_CACHE_BLOCKS } from './tci-precompile.mjs';
import { root, runtimeFiles, fingerprint, digest } from './precompile-files.mjs';
import { inspectBytes } from './preflight.mjs';
const {values,positionals} = parseArgs({allowPositionals:true, options:{
  capture:{type:'string'}, threshold:{type:'string',default:'32'}, seconds:{type:'string',default:'180'}, clicks:{type:'string'},
}});
if(positionals.length!==2) throw Error('Usage: node web/precompile-ipa.mjs INPUT.ipa OUTPUT_DIR [--capture capture.json] [--seconds 180] [--clicks actions.json]');
const [ipa,output]=positionals.map(path=>resolve(path));
if(output.startsWith(root) && !output.startsWith(join(root,'target')+sep))
  throw Error('Generated games inside this repository must stay under ignored target/');
const threshold=Number(values.threshold);
if (![1,32].includes(threshold)) throw Error('Threshold must be 1 or 32');
const seconds=Number(values.seconds);
if(!Number.isFinite(seconds)||seconds<1||seconds>14400) throw Error('Capture seconds must be 1–14400');
await stat(ipa);
await mkdir(dirname(output),{recursive:true});
await mkdir(output); // Never overwrite an existing package or source directory.
const started=performance.now(), input=new Uint8Array(await readFile(ipa));
const {instance}=await WebAssembly.instantiate(await readFile(join(root,'web/dist/touchhle_browser.wasm')));
const inspection=inspectBytes(instance.exports,input);
if(!inspection.ok) throw Error(`Invalid IPA: ${inspection.error}`);
const capturePath=values.capture?resolve(values.capture):join(output,'capture.json');
if(!values.capture){
  const directory=join(root,'web/dist');
  const server=createServer(async(req,res)=>{
    try{
      const path=resolve(directory,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
      if(path!==directory&&!path.startsWith(directory+sep))throw Error('Outside static root');
      const file=path===directory?join(path,'index.html'):path;
      const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.css':'text/css'};
      res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(await readFile(file));
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const clicks=values.clicks?await readFile(values.clicks,'utf8'):'[]';
    const code=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[join(root,'web/inspect-ipa.mjs'),ipa],{cwd:root,stdio:'inherit',env:{...process.env,
        TEST_URL:`http://127.0.0.1:${server.address().port}/?cpu=jit&jitThreshold=${threshold}`,RUN_SECONDS:String(seconds),
        CAPTURE_AOT:capturePath,INSPECTION_DIR:join(output,'capture'),CLICKS:clicks}});
      child.on('error',reject);child.on('exit',resolve);
    });
    if(code!==0)throw Error(`Capture failed with exit ${code}; see local capture artifacts`);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
const identity=await fingerprint(ipa), capture=JSON.parse(await readFile(capturePath,'utf8'));
for (const name of ['tci-jit.js','tci-precompile.mjs'])
  if (identity.files[name] !== digest(await readFile(join(root,'web',name))))
    throw Error(`Stale runtime ${name}; rebuild web artifacts before packaging`);
if(capture.format!==1||capture.identity?.ipa!==identity.ipa||
  ['touchhle-runtime.js','touchhle-runtime.wasm','touchhle-runtime.data'].some(name=>capture.identity?.files[name]!==identity.files[name]))
  throw Error('Capture does not match this IPA/core runtime build');
if(!Array.isArray(capture.keys)||capture.keys.length>MAX_CACHE_BLOCKS||!capture.keys.length)
  throw Error('Empty or oversized capture');
const abi=JSON.stringify({...JSON.parse(capture.abi),version:2});
const blocks=[];let codeBytes=0,total=0;
for(const key of new Set(capture.keys.map(key=>canonicalRecord(key,capture.abi)))){
  const bytes=compileRecord(key,abi);codeBytes+=bytes.length;total+=bytes.length+key.length;
  if(total>MAX_CACHE_BYTES)throw Error('Precompiled cache exceeds memory bound');
  blocks.push({key,wasm:encodeBytes(bytes)});
}
for(const name of runtimeFiles)await copyFile(join(root,'web/dist',name),join(output,name));
await copyFile(ipa,join(output,'game.ipa'));
await copyFile(join(root,'web/game.html'),join(output,'index.html'));
await copyFile(join(root,'web/game.mjs'),join(output,'game.mjs'));
const archive={format:1,abi,identity,blocks};
await writeFile(join(output,'precompiled.json'),JSON.stringify(archive));
await writeFile(join(output,'game.json'),JSON.stringify({name:inspection.app.name,format:1,jitThreshold:threshold,
  coverage:'profile-assisted; unseen code uses JIT',identity},null,2));
await copyFile(join(root,'LICENSE'),join(output,'LICENSE'));
// Runtime distribution retains the project's third-party attribution catalog.
await mkdir(join(output,'licenses'));
for (const source of ['src/licenses.rs','web/dist/vendor/UNICORN-LICENSE','vendor/SDL/LICENSE.txt',
  'vendor/stb/LICENSE','vendor/PVRTDecompress/LICENSE.md',
  ...(await readdir(join(root,'touchHLE_fonts'))).filter(n=>n.startsWith('LICENSE')).map(n=>'touchHLE_fonts/'+n),
  ...(await readdir(join(root,'touchHLE_dylibs'))).filter(n=>n.startsWith('COPYING')).map(n=>'touchHLE_dylibs/'+n)]) {
  await copyFile(join(root,source),join(output,'licenses',source.replaceAll('/','-')));
}
await writeFile(join(output,'SOURCE.md'), `Runtime source and build instructions: https://github.com/NotRllyRn/touchHLE-web

This is a local generated package. Before redistribution, provide the exact
corresponding runtime/dependency source and notices described in web/README.md.
Game content has its own distribution rights. The build report identifies inputs.
`);
const report={mode:'profile-assisted',blocks:blocks.length,wasmBytes:codeBytes,archiveBytes:(await stat(join(output,'precompiled.json'))).size,
  buildMs:performance.now()-started,ipaBytes:input.length,ipaSha256:digest(input)};
await writeFile(join(output,'build-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
console.log(`Static game package: ${output}. Serve it over HTTPS or localhost. No public deployment performed.`);
