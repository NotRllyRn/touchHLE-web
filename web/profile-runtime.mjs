// SPDX-License-Identifier: MPL-2.0
// Local startup sampling. This changes timing; never use its run as an acceptance trial.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { installProfileRoutes } from './profile-instrumentation.mjs';
import { summarizeProfile, profileWindow } from './profile-report.mjs';
import { fingerprint } from './precompile-files.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ipa = process.env.TEST_IPA;
if (!ipa && !process.env.PROFILE_CDP) throw new Error('TEST_IPA must identify a locally owned IPA');
const output = process.env.PROFILE_DIR || 'target/jit-profile';
const mode = process.env.PROFILE_MODE;
const runtimeIdentity = ipa ? await fingerprint(ipa) : null;
const browserArgs = JSON.parse(process.env.BROWSER_ARGS || '[]');
if (!Array.isArray(browserArgs) || browserArgs.some(arg => typeof arg !== 'string')) throw Error('Invalid browser arguments');
await mkdir(output, { recursive: true });
const browser = process.env.PROFILE_CDP
  ? await chromium.connectOverCDP(process.env.PROFILE_CDP)
  : await chromium.launch({ headless: true, args: ['--no-sandbox', ...browserArgs] });
try {
  const page = process.env.PROFILE_CDP ? browser.contexts()[0].pages()[0] : await browser.newPage();
  const logs = [], errors = [];
  const started = performance.now();
  if (mode && !process.env.PROFILE_CDP) await installProfileRoutes(page, mode);
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
  const targets = targetInfos.filter(target => target.type === 'worker' && target.url.endsWith('/runtime-worker.js'));
  if (targets.length !== 1) throw new Error('Expected exactly one runtime worker in this browser; close other emulator tabs');
  const target = targets[0];
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
  const worker = page.workers().find(worker => worker.url().endsWith('/runtime-worker.js'));
  if (!worker) throw Error('Runtime worker does not belong to the selected page');
  const snapshot = () => worker.evaluate(() => self.__tciProfile ? {
    ...self.__tciProfile.snapshot(), snapshotTimeMs: performance.now(),
  } : null);
  const before = await snapshot();
  profileWindow(before, before, mode); // Reject missing/mismatched instrumentation before sampling.
  await send('Profiler.enable'); await send('Profiler.start');
  await page.waitForTimeout(Number(process.env.PROFILE_MS || 15000));
  const { profile } = await send('Profiler.stop'); await send('Profiler.disable');
  const after = await snapshot();
  await writeFile(`${output}/worker.cpuprofile`,JSON.stringify(profile));
  const windowProfile = profileWindow(before, after, mode);
  if (windowProfile) await writeFile(`${output}/counts.json`, JSON.stringify(windowProfile, null, 2));
  const routedSourceIdentity = await worker.evaluate(() => self.__tciProfileIdentity ?? null);
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const identity = Object.fromEntries(await Promise.all(['tci-jit.js', 'tci-profile.mjs', 'tci-guest-map.mjs'].map(async name =>
    [name, hash(await readFile(new URL(name, import.meta.url)))])));
  const summary={browser:browser.version(),browserArgs,mode:after?.mode ?? 'sampling-only',phase:process.env.PROFILE_PHASE ?? 'startup',
    elapsedMs:performance.now()-started,errors,localReferenceIdentity: { sources: identity, runtime: runtimeIdentity },
    routedSourceIdentity, loadedRuntimeIdentity: null,
    identityMeaning: 'Routed hashes identify installed diagnostic sources. Local references do not verify loaded runtime/IPA bytes, especially for CDP or remote URLs.',
    coverage: windowProfile && { truncated: windowProfile.truncated, dropped: windowProfile.dropped,
      truncatedBeforeWindow: before.truncated, description: windowProfile.coverage,
      blockEntryMeaning: windowProfile.blockEntryMeaning, callSiteMeaning: windowProfile.callSiteMeaning },
    counterWindow: windowProfile?.counterWindow, ...summarizeProfile(profile, windowProfile?.blocks)};
  await writeFile(`${output}/summary.json`,JSON.stringify(summary,null,2));
  await writeFile(`${output}/logs.json`,JSON.stringify(logs,null,2));
  await page.screenshot({path:`${output}/page.png`});
  console.log(JSON.stringify({...summary,functions:summary.functions.slice(0,30)},null,2));
  if(errors.length) throw new Error('Page errors during profile');
} finally { await browser.close(); }
