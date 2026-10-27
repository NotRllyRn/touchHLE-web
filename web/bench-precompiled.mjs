// SPDX-License-Identifier: MPL-2.0
// Isolated full-artifact decode/checksum comparison; do not overlap game timing.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url=process.env.TEST_URL;
if(!url) throw Error('TEST_URL must point to a locally served generated game directory');
const b=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const p=await b.newPage();
 await p.route('**/game.mjs',route=>route.fulfill({contentType:'text/javascript',body:''}));
 await p.goto(url);
 console.log(JSON.stringify(await p.evaluate(async()=>{
  const archive=await(await fetch('./precompiled.json')).json();
  const old=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const loop=s=>{const t=atob(s),a=new Uint8Array(t.length);for(let i=0;i<t.length;i++)a[i]=t.charCodeAt(i);return a;};
  const native=Uint8Array.fromBase64?s=>Uint8Array.fromBase64(s):loop;
  let expected;
  const rows=[];
  for(const [name,fn] of [['old',old],['loop',loop],['native',native],['old',old]]){
   const times=[];for(let trial=0;trial<3;trial++){
    let sum=0;const start=performance.now();for(const block of archive.blocks){const bytes=fn(block.wasm);for(const byte of bytes)sum=(sum+byte)>>>0;}
    times.push(performance.now()-start);if(expected!==undefined&&sum!==expected)throw Error('Checksum mismatch');expected=sum;
   }rows.push({name,times});
  }return {nativeAvailable:!!Uint8Array.fromBase64,checksum:expected,rows};
 }),null,2));
}finally{await b.close();}
