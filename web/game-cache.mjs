// SPDX-License-Identifier: MPL-2.0
import { verifyFile } from './package-identity.mjs';

// Owns game downloads only, never saved progress or runtime assets.
export const CACHE_NAME = 'touchhle-verified-game-v1';
export async function loadGame(game, { fetch = globalThis.fetch, cacheStorage = globalThis.caches,
  baseURL = globalThis.location?.href, locks = globalThis.navigator?.locks, progress = () => {}, notice = () => {} } = {}) {
  const hash = game.identity.ipa;
  if (!/^[a-f0-9]{64}$/.test(hash)) throw Error('Invalid game fingerprint');
  const key = new URL(`./.game-download/${hash}`, baseURL).href;
  const prefix = new URL('./.game-download/', baseURL).href;
  let cache;
  try { cache = await cacheStorage?.open(CACHE_NAME); }
  catch { notice('Local game cache unavailable. Your game can still run.'); }
  const verify = async blob => {
    progress({ phase: 'checking' });
    if (Number.isSafeInteger(game.ipaBytes) && game.ipaBytes > 0 && blob.size !== game.ipaBytes)
      throw Error('Game download size does not match the package');
    await verifyFile('game.ipa', await blob.arrayBuffer(), hash);
  };
  if (cache) {
    try {
      const response = await cache.match(key);
      if (response) {
        const blob = await response.blob();
        await verify(blob);
        notice('Game saved on this device.');
        return blob;
      }
    } catch {
      // Never use a broken entry. Failed replacement leaves other versions intact.
      notice('Refreshing the local game download…');
    }
  }
  progress({ phase: 'download', received: 0, total: game.ipaBytes || 0 });
  const response = await fetch(new URL('./game.ipa', baseURL), { cache: 'no-store' });
  if (!response.ok) throw Error(`Game download: HTTP ${response.status}`);
  const encoding = response.headers.get('Content-Encoding')?.trim().toLowerCase();
  const length = response.headers.get('Content-Length');
  const header = (!encoding || encoding === 'identity') && /^\d+$/.test(length ?? '') ? Number(length) : 0;
  const total = Number.isSafeInteger(game.ipaBytes) && game.ipaBytes > 0 ? game.ipaBytes :
    Number.isSafeInteger(header) && header > 0 ? header : 0;
  let received = 0;
  const body = response.body?.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      progress({ phase: 'download', received, total });
      controller.enqueue(chunk);
    },
  }));
  const blob = await (body ? new Response(body, { headers: { 'Content-Type': response.headers.get('Content-Type') || '' } }).blob() : response.blob());
  await verify(blob);
  if (cache) {
    try {
      // put commits a complete entry atomically. Retire old versions only after
      // the new bytes have passed integrity and storage has succeeded.
      const commit = async prune => {
        await cache.put(key, new Response(blob));
        if (prune) try {
          for (const request of await cache.keys()) {
            if (request.url.startsWith(prefix) && request.url !== key) await cache.delete(request);
          }
        } catch { /* Later successful downloads can retire obsolete entries. */ }
      };
      // A separate download lock, never the save-data lock. Without cross-tab
      // coordination keep old verified entries instead of racing their deletion.
      if (locks?.request) await locks.request(`${CACHE_NAME}:${prefix}`, () => commit(true));
      else await commit(false);
      notice('Game saved on this device.');
    } catch { notice('Not enough local cache space. Playing without a saved download.'); }
  } else notice('Playing without a local game cache.');
  return blob;
}
