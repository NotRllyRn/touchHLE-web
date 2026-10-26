// SPDX-License-Identifier: MPL-2.0
// Emscripten 4.0.23 installs the legacy texture-environment getters only on
// _glGetTexEnv*, leaving its emscripten_glGetTexEnv* imports pointing at abort
// stubs. Call the initialized state implementation through explicit shims.
addToLibrary({
  touchhle_web_light_f__deps: ['glLightf'],
  touchhle_web_light_f: (light, pname, param) => _glLightf(light, pname, param),
  touchhle_web_light_fv__deps: ['glLightfv'],
  touchhle_web_light_fv: (light, pname, params) => _glLightfv(light, pname, params),
  touchhle_web_fog_f__deps: ['glFogf'],
  touchhle_web_fog_f: (pname, param) => _glFogf(pname, param),
  touchhle_web_fog_i__deps: ['glFogi'],
  touchhle_web_fog_i: (pname, param) => _glFogi(pname, param),
  touchhle_web_fog_fv__deps: ['glFogfv'],
  touchhle_web_fog_fv: (pname, params) => _glFogfv(pname, params),
  touchhle_web_fog_iv__deps: ['glFogiv'],
  touchhle_web_fog_iv: (pname, params) => _glFogiv(pname, params),
  // WebGL2 exposes buffer readback but no mapped pointer. Keep a host-memory
  // copy until unmap; the existing Rust HLE copies that to/from guest memory.
  touchhle_web_map_buffer__deps: ['$GL', 'malloc', 'free'],
  touchhle_web_map_buffer: (target, access) => {
    if (![0x8892, 0x8893].includes(target)) { GL.recordError(0x0500); return 0; }
    if (![0x88b8, 0x88b9, 0x88ba].includes(access)) { GL.recordError(0x0500); return 0; }
    const buffer = GLctx.getParameter(target === 0x8892 ? 0x8894 : 0x8895);
    if (!buffer || buffer.touchhleMapping) { GL.recordError(0x0502); return 0; }
    const size = GLctx.getBufferParameter(target, 0x8764);
    if (!size) { GL.recordError(0x0502); return 0; }
    const pointer = _malloc(size);
    if (!pointer) { GL.recordError(0x0505); return 0; }
    try {
      GLctx.getBufferSubData(target, 0, HEAPU8.subarray(pointer, pointer + size));
    } catch (error) { _free(pointer); throw error; }
    buffer.touchhleMapping = { pointer, size, access };
    return pointer;
  },
  touchhle_web_unmap_buffer__deps: ['$GL', 'free'],
  touchhle_web_unmap_buffer: (target) => {
    if (![0x8892, 0x8893].includes(target)) { GL.recordError(0x0500); return 0; }
    const buffer = GLctx.getParameter(target === 0x8892 ? 0x8894 : 0x8895);
    const mapping = buffer?.touchhleMapping;
    if (!mapping) { GL.recordError(0x0502); return 0; }
    try {
      if (mapping.access !== 0x88b8) GLctx.bufferSubData(target, 0,
        HEAPU8.subarray(mapping.pointer, mapping.pointer + mapping.size));
    } finally { _free(mapping.pointer); delete buffer.touchhleMapping; }
    return 1;
  },
  // Legacy point size has an implementation but no getProcAddress entry.
  touchhle_web_point_size__deps: ['glPointSize'],
  touchhle_web_point_size: (size) => _glPointSize(size),
  touchhle_web_point_parameter_f__deps: ['$GLEmulation', '$GL'],
  touchhle_web_point_parameter_f: (pname, param) => {
    if (![0x8126, 0x8127, 0x8128].includes(pname)) { GL.recordError(0x0500); return; }
    if (param < 0) { GL.recordError(0x0501); return; }
    GLEmulation.pointParameters[pname] = param;
  },
  touchhle_web_point_parameter_fv__deps: ['touchhle_web_point_parameter_f', '$GLEmulation', '$GL'],
  touchhle_web_point_parameter_fv: (pname, params) => {
    if (pname !== 0x8129) { _touchhle_web_point_parameter_f(pname, HEAPF32[params >> 2]); return; }
    const attenuation = Array.from(HEAPF32.subarray(params >> 2, (params >> 2) + 3));
    if (attenuation.some(value => value < 0)) { GL.recordError(0x0501); return; }
    GLEmulation.pointParameters[pname] = attenuation;
  },
  touchhle_web_texture_2d_enabled__deps: ['$GLImmediate'],
  touchhle_web_texture_2d_enabled: () => {
    const textures = GLImmediate.TexEnvJIT;
    return textures.getTexUnitType(textures.getActiveTexture()) === 0x0de1 ? 1 : 0;
  },
  // These setters are implemented by legacy GL, but absent from its
  // getProcAddress table. Import them explicitly with the correct WASM ABI.
  touchhle_web_tex_env_f__deps: ['$GLImmediate'],
  touchhle_web_tex_env_f: (target, pname, param) => {
    const env = GLImmediate.TexEnvJIT;
    // GLES permits enum-valued texture state through the float API too.
    if (pname === 0x8573 || pname === 0x0d1c) env.hook_texEnvf(target, pname, param);
    else env.hook_texEnvi(target, pname, param);
  },
  touchhle_web_tex_env_i__deps: ['$GLImmediate'],
  touchhle_web_tex_env_i: (target, pname, param) => {
    GLImmediate.TexEnvJIT.hook_texEnvi(target, pname, param);
  },
  touchhle_web_tex_env_fv__deps: ['$GLImmediate', 'touchhle_web_tex_env_f'],
  touchhle_web_tex_env_fv: (target, pname, params) => {
    if (pname === 0x2201) GLImmediate.TexEnvJIT.hook_texEnvfv(target, pname, params);
    else _touchhle_web_tex_env_f(target, pname, HEAPF32[params >> 2]);
  },
  touchhle_web_get_tex_env_iv__deps: ['$GLImmediate'],
  touchhle_web_get_tex_env_iv: (target, pname, params) => {
    GLImmediate.TexEnvJIT.hook_getTexEnviv(target, pname, params);
  },
  touchhle_web_get_tex_env_fv__deps: ['$GLImmediate'],
  touchhle_web_get_tex_env_fv: (target, pname, params) => {
    GLImmediate.TexEnvJIT.hook_getTexEnvfv(target, pname, params);
  },
});
