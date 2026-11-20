// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../game-cache.mjs';
import { createHash } from 'node:crypto';
const version = text => ({ identity: { ipa: createHash('sha256').update(text).digest('hex') }, ipaBytes: Buffer.byteLength(text) });
function fixture() {
  const entries = new Map(), events = [], notices = []; let body = 'first', calls = 0, failPut = false;
  const cache = {
    match: async key => entries.get(key)?.clone(),
    put: async (key, response) => { if (failPut) throw Error('Quota'); entries.set(key, new Response(await response.blob())); events.push('put'); },
    keys: async () => [...entries.keys()].map(url => ({ url })),
    delete: async request => { events.push('delete'); return entries.delete(request.url); },
  };
  const options = { locks: { request: async (_name, callback) => callback() }, baseURL: 'https://local/game/', cacheStorage: { open: async () => cache },
    fetch: async () => { calls++; return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(body.slice(0,2))); controller.enqueue(new TextEncoder().encode(body.slice(2))); controller.close(); } })); },
    notice: text => notices.push(text) };
  return { entries, events, notices, options, cache, get calls() { return calls; }, body: value => { body = value; }, quota: () => { failPut = true; } };
}
test('cold download verifies exact chunks; warm version is verified without any IPA request', async () => {
  const f=fixture(), progress=[]; f.options.progress=x=>progress.push(x);
  assert.equal(await (await loadGame(version('first'),f.options)).text(),'first');
  assert.deepEqual(progress.filter(x=>x.phase==='download').map(x=>x.received),[0,2,5]);
  assert.equal(await (await loadGame(version('first'),f.options)).text(),'first'); assert.equal(f.calls,1);
});
test('new version is committed before obsolete owned key is removed',async()=>{
  const f=fixture();await loadGame(version('first'),f.options);f.entries.set('https://local/unrelated',new Response('keep'));
  f.body('second');await loadGame(version('second'),f.options);assert.equal(f.calls,2);
  assert.deepEqual(f.events,['put','put','delete']);assert.equal(f.entries.size,2);assert(f.entries.has('https://local/unrelated'));
});
test('wrong hash and partial body never replace the prior verified entry',async()=>{
  const f=fixture();await loadGame(version('first'),f.options);f.body('broken');
  await assert.rejects(loadGame(version('second'),f.options),/fingerprint/);assert.equal(f.entries.size,1);
  f.options.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));c.error(Error('disconnected'));}}));
  await assert.rejects(loadGame(version('second'),f.options),/disconnected/);assert.equal(f.entries.size,1);
});
test('quota failure preserves prior entry and returns verified downloaded bytes',async()=>{
  const f=fixture();await loadGame(version('first'),f.options);f.body('second');f.quota();
  assert.equal(await(await loadGame(version('second'),f.options)).text(),'second');assert.equal(f.entries.size,1);assert.match(f.notices.at(-1),/without a saved download/);
});
test('corrupt cache entry is not accepted and is replaced from verified network bytes',async()=>{
  const f=fixture(),game=version('first');f.entries.set(`https://local/game/.game-download/${game.identity.ipa}`,new Response('wrong'));
  assert.equal(await(await loadGame(game,f.options)).text(),'first');assert.equal(f.calls,1);
});
test('unavailable cache, unknown size and absent body still allow verified game',async()=>{
  const f=fixture(),game=version('first');delete game.ipaBytes;
  f.options.cacheStorage={open:async()=>{throw Error('private');}};
  const states=[];f.options.progress=x=>states.push(x);await loadGame(game,f.options);assert.equal(states[1].total,0);
  f.options.fetch=async()=>({ok:true,headers:new Headers(),body:null,blob:async()=>new Blob(['first'])});
  assert.equal(await(await loadGame(game,f.options)).text(),'first');
});

test('without Web Locks cache replacement never prunes another tab version',async()=>{const f=fixture();f.options.locks=null;await loadGame(version('first'),f.options);f.body('second');await loadGame(version('second'),f.options);assert.equal(f.entries.size,2);assert(!f.events.includes('delete'));});
