// SPDX-License-Identifier: MPL-2.0
// Emscripten 4.0.23 omits legacy state queried while EAGL saves/restores the
// guest context for presentation. Keep that state in its existing descriptors.
// Guest scheduling can yield between graphics calls. Browser auto-discard at
// an event-loop boundary is not a guest clear or buffer swap.
EGL.contextAttributes.preserveDrawingBuffer = true;
{
  // Point draws need gl_PointSize in their vertex shader. The SDK includes
  // draw mode in its shader-cache key, but its current-renderer shortcut can
  // bypass that key after a triangle/point transition.
  const getRenderer = GLImmediate.getRenderer;
  let rendererUsesPoints;
  GLImmediate.getRenderer = function (...args) {
    const points = GLImmediate.mode === 0; // POINTS
    if (points !== rendererUsesPoints) GLImmediate.currentRenderer = null;
    rendererUsesPoints = points;
    return getRenderer.apply(this, args);
  };
  const setAttribute = GLImmediate.setClientAttribute;
  GLImmediate.setClientAttribute = function (index, ...args) {
    setAttribute.call(this, index, ...args);
    GLImmediate.clientAttributes[index].bufferBinding = GLctx.currentArrayBufferBinding || 0;
    GLImmediate.clientAttributes[index].declaredPointer = GLImmediate.clientAttributes[index].pointer;
  };
  const prepare = GLImmediate.prepareClientAttributes;
  GLImmediate.prepareClientAttributes = function (...args) {
    try {
      return prepare.apply(this, args);
    } finally {
      // The planar-array conversion rewrites pointer to its scratch buffer.
      // Rendering uses offset/vertexPointer, but later glGetPointerv and EAGL
      // state backups must still see the pointer supplied by the application.
      for (const attribute of GLImmediate.clientAttributes) {
        attribute.pointer = attribute.declaredPointer;
      }
    }
  };
  const initialize = GLImmediate.init;
  GLImmediate.init = function (...args) {
    initialize.apply(this, args);
    GLEmulation.pointParameters = {
      0x8126: 0, // POINT_SIZE_MIN
      0x8127: GLctx.getParameter(GLctx.ALIASED_POINT_SIZE_RANGE)[1], // POINT_SIZE_MAX
      0x8128: 1, // POINT_FADE_THRESHOLD_SIZE (multisampled points)
      0x8129: [1, 0, 0], // POINT_DISTANCE_ATTENUATION
    };
    // GLES specifies valid defaults even before the first gl*Pointer call.
    for (let index = 0; index < GLImmediate.NUM_ATTRIBUTES; index++) {
      GLImmediate.setClientAttribute(index,
        index === GLImmediate.NORMAL ? 3 : 4, 0x1406 /* FLOAT */, 0, 0);
      GLImmediate.clientAttributes[index].bufferBinding = 0;
    }
    // Each SDL context currently uses the canvas's WebGL context. Install only
    // once per actual context; the closure reads the current legacy state.
    if (GLctx.touchhleLegacyQueries) return;
    GLctx.touchhleLegacyQueries = true;
    // GLES 1's automatic mipmap flag is absent from WebGL. Generate the
    // chain after a base-level write, on the same bound texture object.
    for (const name of ['texParameteri', 'texParameterf']) {
      const setParameter = GLctx[name];
      GLctx[name] = function (target, pname, value) {
        if (target === this.TEXTURE_2D && pname === 0x8191) {
          const texture = this.getParameter(this.TEXTURE_BINDING_2D);
          if (!texture) { GL.recordError(0x0502); return; }
          texture.touchhleGenerateMipmap = !!value;
          return;
        }
        return setParameter.call(this, target, pname, value);
      };
    }
    const getTexParameter = GLctx.getTexParameter;
    GLctx.getTexParameter = function (target, pname) {
      if (target === this.TEXTURE_2D && pname === 0x8191) {
        const texture = this.getParameter(this.TEXTURE_BINDING_2D);
        if (!texture) { GL.recordError(0x0502); return null; }
        return texture.touchhleGenerateMipmap ? 1 : 0;
      }
      return getTexParameter.call(this, target, pname);
    };
    for (const name of ['texImage2D', 'texSubImage2D', 'copyTexImage2D',
      'copyTexSubImage2D', 'compressedTexImage2D', 'compressedTexSubImage2D']) {
      const writeImage = GLctx[name];
      GLctx[name] = function (...args) {
        const result = writeImage.apply(this, args);
        if (args[0] === this.TEXTURE_2D && args[1] === 0 &&
          this.getParameter(this.TEXTURE_BINDING_2D)?.touchhleGenerateMipmap) {
          this.generateMipmap(this.TEXTURE_2D);
        }
        return result;
      };
    }
    const getParameter = GLctx.getParameter;
    const getBufferParameter = GLctx.getBufferParameter;
    GLctx.getBufferParameter = function (target, name) {
      if ([0x8892, 0x8893].includes(target) && [0x88bb, 0x88bc].includes(name)) {
        const buffer = getParameter.call(this, target === 0x8892 ? 0x8894 : 0x8895);
        if (!buffer) { GL.recordError(0x0502); return null; }
        return name === 0x88bc ? (buffer.touchhleMapping ? 1 : 0) :
          (buffer.touchhleMapping?.access ?? 0x88b9);
      }
      return getBufferParameter.call(this, target, name);
    };
    const deleteBuffer = GLctx.deleteBuffer;
    GLctx.deleteBuffer = function (buffer) {
      if (buffer?.touchhleMapping) {
        _free(buffer.touchhleMapping.pointer);
        delete buffer.touchhleMapping;
      }
      return deleteBuffer.call(this, buffer);
    };
    GLctx.getParameter = function (name) {
      let attribute;
      switch (name) {
        case 0x0b11: return GLEmulation.pointSize; // POINT_SIZE
        case 0x8126: case 0x8127: case 0x8128: case 0x8129:
          return GLEmulation.pointParameters[name];
        case 0x0b00: return GLImmediate.clientColor; // CURRENT_COLOR
        case 0x84e1: return 0x84c0 + GLImmediate.clientActiveTexture;
        case 0x0be1: return getParameter.call(this, 0x80c9); // BLEND_SRC_RGB
        case 0x0be0: return getParameter.call(this, 0x80c8); // BLEND_DST_RGB
        case 0x8896: attribute = GLImmediate.VERTEX; break;
        case 0x8897: attribute = GLImmediate.NORMAL; break;
        case 0x8898: attribute = GLImmediate.COLOR; break;
        case 0x889a: attribute = GLImmediate.TEXTURE0 + GLImmediate.clientActiveTexture; break;
        default: return getParameter.call(this, name);
      }
      return GLImmediate.clientAttributes[attribute]?.bufferBinding || 0;
    };
  };
}
