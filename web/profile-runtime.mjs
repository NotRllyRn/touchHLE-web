// SPDX-License-Identifier: MPL-2.0
// Local startup sampling. This changes timing; never use its run as an acceptance trial.
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ipa = process.env.TEST_IPA;
if (!ipa && !process.env.PROFILE_CDP) throw new Error('TEST_IPA must identify a locally owned IPA');
const output = process.env.PROFILE_DIR || 'target/jit-profile';
await mkdir(output, { recursive: true });
const browser = process.env.PROFILE_CDP
  ? await chromium.connectOverCDP(process.env.PROFILE_CDP)
  : await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = process.env.PROFILE_CDP ? browser.contexts()[0].pages()[0] : await browser.newPage();
  const logs = [], errors = [];
  const started = performance.now();
  page.on('console', message => logs.push({ ms: performance.now()-started, text: message.text() }));
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(() => {
    const Original = Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({data}) => {
          if (data.type !== 'audio') console.log(JSON.stringify(data));
        });
      }
    };
  });
  if (!process.env.PROFILE_CDP) {
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:8765/?cpu=jit');
    await page.locator('#ipa').setInputFiles(ipa);
    await page.waitForFunction(() => !document.querySelector('#run').disabled);
    await page.locator('#run').click();
  }
  await page.waitForTimeout(Number(process.env.PROFILE_DELAY_MS || 10000));
  const cdp = await browser.newBrowserCDPSession();
  const { targetInfos } = await cdp.send('Target.getTargets');
  const target = targetInfos.find(target => target.type === 'worker' && target.url.endsWith('/runtime-worker.js'));
  if (!target) throw new Error('Runtime worker missing');
  const { sessionId } = await cdp.send('Target.attachToTarget', {targetId: target.targetId, flatten: false});
  let id = 0;
  const pending = new Map();
  cdp.on('Target.receivedMessageFromTarget', event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message), request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  const send = (method, params={}) => new Promise((resolve,reject) => {
    const key=++id;
    const timer=setTimeout(()=>{pending.delete(key);reject(new Error(`${method} timed out`));},30000);
    pending.set(key,{resolve,reject,timer});
    cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:key,method,params})}).catch(reject);
  });
  await send('Profiler.enable'); await send('Profiler.start');
  await page.waitForTimeout(Number(process.env.PROFILE_MS || 15000));
  const { profile } = await send('Profiler.stop'); await send('Profiler.disable');
  await writeFile(`${output}/worker.cpuprofile`,JSON.stringify(profile));
  const nodes=new Map(profile.nodes.map(node=>[node.id,node]));
  const counts=new Map();
  for(const id of profile.samples || []) {
    const name=nodes.get(id)?.callFrame.functionName || '(anonymous)';
    counts.set(name,(counts.get(name)||0)+1);
  }
  const summary={browser:browser.version(),elapsedMs:performance.now()-started,errors,
    samples:profile.samples?.length,top:[...counts].sort((a,b)=>b[1]-a[1]).slice(0,30)};
  await writeFile(`${output}/summary.json`,JSON.stringify(summary,null,2));
  await writeFile(`${output}/logs.json`,JSON.stringify(logs,null,2));
  await page.screenshot({path:`${output}/page.png`});
  console.log(JSON.stringify(summary,null,2));
  if(errors.length) throw new Error('Page errors during profile');
} finally { await browser.close(); }
