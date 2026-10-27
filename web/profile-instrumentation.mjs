// SPDX-License-Identifier: MPL-2.0
// Local Playwright routing only: never modifies served production artifacts.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export async function installProfileRoutes(page, mode) {
  if (!['timing', 'counts'].includes(mode)) throw Error('PROFILE_MODE must be timing or counts');
  const identity = {};
  for (const file of ['tci-jit.js', 'tci-profile.mjs', 'tci-guest-map.mjs']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    identity[file] = createHash('sha256').update(source).digest('hex');
    await page.route(`**/${file}`, route => route.fulfill({ contentType: 'text/javascript', body: source }));
  }
  await page.route('**/runtime-worker.js', async route => {
    const response = await route.fetch(), source = await response.text();
    const marker = "    if (data.cpuBackend === 'jit') importScripts('./tci-jit.js');";
    if (!source.includes(marker)) throw Error('Profile installation point missing');
    await route.fulfill({ response, body: source.replace(marker, marker + `
    if (data.precompiled) throw Error('Detailed profile requires the JIT reference path');
    const { TciProfile } = await import('./tci-profile.mjs');
    self.__tciProfileIdentity = ${JSON.stringify(identity)};
    self.__tciProfile = TouchHLETciJit.profile = new TciProfile({ counts: ${mode === 'counts'} });`) });
  });
}
