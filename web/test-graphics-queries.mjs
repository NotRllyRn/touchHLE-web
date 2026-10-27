// SPDX-License-Identifier: MPL-2.0
// Exercise the production query wrappers against real WebGL, not mocked getters.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = await readFile(new URL('./emscripten-gl-init.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.on('console', message => console.log(message.text()));
  for (const type of ['webgl', 'webgl2']) {
    await page.evaluate(type => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext(type);
      if (!gl) throw Error(`${type} unavailable`);
      globalThis.GLctx = gl;
      globalThis.EGL = { contextAttributes: {} };
      globalThis.GLEmulation = {};
      // Only SDK initialization scaffolding is stubbed; all GL calls are real.
      globalThis.GLImmediate = { NUM_ATTRIBUTES: 0, clientAttributes: [],
        init() {}, getRenderer() {}, setClientAttribute() {}, prepareClientAttributes() {} };
      globalThis.GL = { recordError() { throw Error('Unexpected legacy error'); } };
      globalThis.queryCounts = { max: 0, texture: 0 };
      const get = gl.getParameter, tex = gl.getTexParameter;
      gl.getParameter = function(name) {
        if (name === 0x84ff) queryCounts.max++;
        return get.call(this, name);
      };
      gl.getTexParameter = function(target, name) {
        if (name === 0x84fe) queryCounts.texture++;
        return tex.call(this, target, name);
      };
    }, type);
    await page.addScriptTag({ content: source });
    const result = await page.evaluate(async () => {
      GLImmediate.init();
      const gl = GLctx, max = 0x84ff, anisotropy = 0x84fe;
      const check = (ok, message) => { if (!ok) throw Error(message); };
      // Invalid queries must still raise an error on every call, not cache null.
      for (let i = 0; i < 2; i++) {
        check(gl.getParameter(max) === null, 'Disabled extension result');
        check(gl.getError() === gl.INVALID_ENUM, 'Disabled extension error');
      }
      const ext = gl.getExtension('EXT_texture_filter_anisotropic');
      check(ext, 'Anisotropy extension unavailable');
      const before = queryCounts.max, limit = gl.getParameter(max);
      for (let i = 0; i < 20; i++) check(gl.getParameter(max) === limit, 'Stable limit');
      check(limit >= 1 && queryCounts.max === before + 1, 'One native limit query');
      const first = gl.createTexture(), second = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, first);
      const get = () => gl.getTexParameter(gl.TEXTURE_2D, anisotropy);
      const start = queryCounts.texture;
      for (let i = 0; i < 20; i++) check(get() === 1, 'Default anisotropy');
      check(queryCounts.texture === start + 1, 'One native texture query');
      const value = Math.min(2, limit);
      gl.texParameterf(gl.TEXTURE_2D, anisotropy, value);
      check(get() === value, 'Float setter invalidation');
      gl.bindTexture(gl.TEXTURE_2D, second); check(get() === 1, 'Independent texture');
      gl.bindTexture(gl.TEXTURE_2D, first); check(get() === value, 'Binding restores cached value');
      gl.texParameteri(gl.TEXTURE_2D, anisotropy, 1); check(get() === 1, 'Integer setter invalidation');
      gl.texParameterf(gl.TEXTURE_2D, anisotropy, 0);
      check(gl.getError() === gl.INVALID_VALUE && get() === 1, 'Invalid setter preserves real state');
      gl.deleteTexture(first);
      for (let i = 0; i < 2; i++) {
        check(get() === null && gl.getError() === gl.INVALID_OPERATION, 'Deleted binding errors');
      }
      const loss = gl.getExtension('WEBGL_lose_context'); check(loss, 'Context loss extension unavailable');
      const lost = new Promise(resolve => gl.canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); resolve(); }, { once: true }));
      const within = (promise, label) => Promise.race([promise,
        new Promise((_, reject) => setTimeout(() => reject(Error(label + ' timed out')), 10000))]);
      loss.loseContext(); await within(lost, 'Context loss');
      check(gl.isContextLost() && gl.getParameter(max) === null, 'No cached limit during loss');
      const restored = new Promise(resolve => gl.canvas.addEventListener('webglcontextrestored', resolve, { once: true }));
      // Restoration is only legal after the lost event has finished dispatching.
      await new Promise(resolve => setTimeout(resolve, 50));
      loss.restoreContext(); await within(restored, 'Context restoration');
      check(gl.getExtension('EXT_texture_filter_anisotropic'), 'Extension after restore');
      const oldCount = queryCounts.max;
      check(gl.getParameter(max) >= 1 && queryCounts.max === oldCount + 1, 'Restoration invalidates limit');
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture()); check(get() === 1, 'Restored texture default');
      check(gl.getError() === gl.NO_ERROR, 'Unexpected GL error');
      return { passed: true, counts: queryCounts };
    });
    assert.equal(result.passed, true);
    console.log('PASS', type, JSON.stringify(result));
  }
} finally { await browser.close(); }
