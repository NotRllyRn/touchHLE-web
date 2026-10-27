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
  // A partial/stale site update must fail before starting guest execution.
  for (const name of ['game.ipa', 'touchhle-runtime.wasm', 'tci-jit.js']) {
    const broken = await browser.newPage(); let workers = 0;
    broken.on('worker', () => workers++);
    await broken.route(`**/${name}`, async route => {
      const response = await route.fetch();
      const bytes = Buffer.from(await response.body()); bytes[bytes.length - 1] ^= 1;
      await route.fulfill({ response, body: bytes });
    });
    await broken.goto(process.env.TEST_URL || 'http://127.0.0.1:8766/aot-fixture/?jitThreshold=1');
    await broken.waitForFunction(() => document.querySelector('#state').textContent.startsWith('Unable to load game:'));
    assert.match(await broken.locator('#state').textContent(), new RegExp(`fingerprint mismatch: ${name.replaceAll('.', '\\.')}`));
    assert.ok(await broken.locator('#run').isDisabled());
    assert.equal(workers, 0, 'Reject mixed package before guest worker starts');
    await broken.close();
  }
  const stale = await browser.newPage();
  await stale.route('**/precompiled.json', async route => {
    const response = await route.fetch(), archive = await response.json();
    archive.identity.ipa = '0'.repeat(64);
    await route.fulfill({ response, json: archive });
  });
  await stale.goto(process.env.TEST_URL || 'http://127.0.0.1:8766/aot-fixture/?jitThreshold=1');
  await stale.waitForFunction(() => document.querySelector('#state').textContent.startsWith('Unable to load game:'));
  assert.match(await stale.locator('#state').textContent(), /does not match this game\/runtime package/);
  assert.ok(await stale.locator('#run').isDisabled());
  await stale.close();
  console.log('PASS static game-only player',browser.version());
}finally{await browser.close();}
