// SPDX-License-Identifier: MPL-2.0
// Run against a generated package of the original HLE/graphics test IPA.
import assert from 'node:assert/strict';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage(), errors=[],requests=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('request',r=>requests.push([r.method(),r.url()]));
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:8766/aot-fixture/?jitThreshold=1');
  assert.equal(await page.locator('input[type=file]').count(),0,'No IPA upload UI');
  for(let trial=0;trial<2;trial++){
    await page.waitForFunction(()=>!document.querySelector('#run').disabled);
    await page.locator('#run').click();
    await page.waitForFunction(()=>document.querySelector('#stop').disabled,null,{timeout:60000});
    const output=await page.locator('#status').textContent();
    assert.match(output,/PASS real touchHLE ARM guest called puts and exit/,await page.locator('#state').innerText());
    assert.match(output,/Guest exited with status 0/);
    const stats=JSON.parse(output.match(/CPU JIT (\{[^\n]+\})/)[1]);
    console.log('CPU stats', JSON.stringify(stats));
    assert.equal(stats.failed,0,stats.lastFailure);
    assert.ok(stats.precompiled>0,'Must execute offline-compiled guest blocks');
    console.log('PASS precompiled guest',JSON.stringify(stats));
  }
  assert.deepEqual(errors,[]);
  assert.ok(requests.every(([method])=>method==='GET'));
  console.log('PASS static game-only player',browser.version());
}finally{await browser.close();}
