// SPDX-License-Identifier: MPL-2.0
// Runtime compiler for the pinned Unicorn 32-bit TCI bytecode. No ARM decoder.
// Loaded by JIT workers, CPU fixture pre-js, and dependency-free Node tests.
(() => {
  const uleb = value => {
    const bytes = [];
    do { const byte = value & 127; value >>>= 7; bytes.push(byte | (value ? 128 : 0)); } while (value);
    return bytes;
  };
  const sleb = value => {
    const bytes = [];
    value |= 0;
    for (;;) {
      const byte = value & 127;
      value >>= 7;
      const done = (value === 0 && !(byte & 64)) || (value === -1 && (byte & 64));
      bytes.push(byte | (done ? 0 : 128));
      if (done) return bytes;
    }
  };
  const str = text => [text.length, ...Array.from(text, c => c.charCodeAt(0))];
  const section = (id, bytes) => [id, ...uleb(bytes.length), ...bytes];
  const binary = { add_i32: 0x6a, sub_i32: 0x6b, mul_i32: 0x6c,
    and_i32: 0x71, or_i32: 0x72, xor_i32: 0x73, shl_i32: 0x74,
    sar_i32: 0x75, shr_i32: 0x76, rotl_i32: 0x77, rotr_i32: 0x78 };
  const compare32 = { 8: 0x46, 9: 0x47, 2: 0x48, 3: 0x4e,
    4: 0x49, 5: 0x4f, 10: 0x4c, 11: 0x4a, 12: 0x4d, 13: 0x4b };

  class TouchHLETciJit {
    constructor(memory, step, addFunction, removeFunction, threshold = 32, dispatch = null) {
      this.memory = memory;
      this.dispatch = dispatch;
      this.step = step;
      this.addFunction = addFunction;
      this.removeFunction = removeFunction;
      this.threshold = threshold;
      // Set by the offline tooling before the engine is created. Default JIT
      // keeps its existing session-specialized code and retention limits.
      this.portable = TouchHLETciJit.portable ?? null;
      this.names = [];
      this.blocks = new Map();
      this.compiled = new Map();
      this.liveBytes = 0;
      this.liveModules = 0;
      this.stats = { compiled: 0, failed: 0, hits: 0, bytes: 0, compileMs: 0, resets: 0, metadataResets: 0, evictions: 0, registered: 0, liveBytes: 0, precompiled: 0, precompiledMisses: 0, emitMs: 0, moduleMs: 0, instantiateMs: 0 };
      if (dispatch) Object.defineProperty(this.stats, 'hits', {
        get: () => new DataView(this.memory.buffer).getFloat64(dispatch.counter, true),
      });
    }
    reset() {
      this.dispatch?.clear();
      for (const block of this.blocks.values()) if (block.fn) this.removeFunction(block.fn);
      this.blocks.clear();
      this.compiled.clear();
      this.liveBytes = this.stats.liveBytes = 0;
      this.liveModules = 0;
      this.stats.resets++;
    }
    register(ptr, size) {
      const old = this.blocks.get(ptr);
      this.compiled.delete(ptr);
      if (old?.fn) { this.removeFunction(old.fn); this.liveBytes -= old.bytes; this.liveModules--; }
      this.stats.liveBytes = this.liveBytes;
      // Bound metadata/module retention, including permanently cold blocks.
      if (this.blocks.size >= 65536) { this.reset(); this.stats.metadataResets++; }
      this.stats.registered++;
      this.blocks.set(ptr, { size, count: 0, fn: 0, failed: false });
    }
    lookup(ptr) {
      const block = this.blocks.get(ptr);
      if (!block || block.failed) return 0;
      if (block.fn) {
        // Native dispatch hits bypass JS; these lookups provide approximate recency.
        this.compiled.delete(ptr); this.compiled.set(ptr, block);
        if (!this.dispatch) this.stats.hits++;
        return block.fn;
      }
      if (++block.count < this.threshold) return 0;
      const start = performance.now();
      try {
        const emitStart = performance.now();
        let description, cached;
        if (this.portable) {
          const abi = this.abi ??= this.portableAbi();
          if (this.portable.abi && this.portable.abi !== abi) throw new Error('Precompiled ABI mismatch');
          description = this.describePortable(ptr, block.size);
          cached = this.portable.modules?.get(description.key);
          if (this.portable.modules && !cached) this.stats.precompiledMisses++;
        }
        const bytes = cached?.bytes ?? this.compile(ptr, block.size, !!this.portable?.capture);
        this.stats.emitMs += performance.now() - emitStart;
        if (bytes.length > 262144) throw new Error('Compiled block exceeds 256 KiB');
        if (this.liveBytes + bytes.length > 16 * 1024 * 1024 || this.liveModules >= 8192) {
          this.stats.evictions++;
          this.dispatch?.clear();
          // Free a quarter of capacity, retaining recent modules and translation
          // identities. Clear native pointers before any table slot is reused.
          for (const [address, entry] of this.compiled) {
            if (this.liveBytes + bytes.length <= 12 * 1024 * 1024 && this.liveModules < 6144) break;
            this.removeFunction(entry.fn);
            entry.fn = 0; entry.count = 0;
            this.liveBytes -= entry.bytes; this.liveModules--;
            this.compiled.delete(address);
          }
          this.stats.liveBytes = this.liveBytes;
        }
        const moduleStart = performance.now();
        const module = cached?.module ?? new WebAssembly.Module(bytes);
        this.stats.moduleMs += performance.now() - moduleStart;
        const instantiateStart = performance.now();
        const instance = new WebAssembly.Instance(module,
          { e: { m: this.memory, s: this.step, c: this.dispatch?.call, b: ptr } });
        this.stats.instantiateMs += performance.now() - instantiateStart;
        if (cached) this.stats.precompiled++;
        this.portable?.capture?.({ ...description, abi: this.abi });
        block.fn = this.addFunction(instance.exports.run, 'iiiii');
        block.bytes = bytes.length;
        this.compiled.set(ptr, block);
        this.liveModules++;
        this.liveBytes += bytes.length;
        this.stats.liveBytes = this.liveBytes;
        this.stats.compiled++;
        this.stats.bytes += bytes.length;
      } catch (error) {
        block.failed = true;
        this.stats.failed++;
        this.stats.lastFailure = String(error);
      }
      this.stats.compileMs += performance.now() - start;
      return block.fn;
    }
    portableAbi() {
      const d = this.dispatch;
      return JSON.stringify({ version: 2, names: this.names, call: !!d?.call,
        readLayout: d?.readLayout, exitCheck: d?.exitCheck, floatMath: d?.floatMath,
        unaligned: d?.unaligned, pageMap: d?.pageMap, floatUnary: d?.floatUnary });
    }
    describePortable(start, length) {
      if (length <= 0 || length > 65536 || start + length > this.memory.buffer.byteLength)
        throw new Error('Invalid TCI block bounds');
      const code = new Uint8Array(this.memory.buffer, start, length).slice();
      const view = new DataView(code.buffer);
      for (let offset = 0; offset < length;) {
        const size = code[offset + 1], name = this.names[code[offset]];
        if (!name || size < 2 || offset + size > length) throw new Error('Invalid TCI operation');
        if (['br', 'brcond_i32', 'brcond2_i32'].includes(name)) {
          const field = offset + size - 4;
          view.setUint32(field, view.getUint32(field, true) - start, true);
        } else if (name === 'goto_tb') {
          // Alignment is part of the identity; links are patched at runtime.
          const field = ((start + offset + 5) & ~3) - start;
          code.fill(0, field, field + 4);
        } else if (name === 'movi_i32') {
          // Includes engine-private pointers (budget/stop fields). Read the
          // current immediate in portable code instead of capturing an address.
          code.fill(0, offset + 3, offset + 7);
        } else if (name === 'exit_tb') {
          code.fill(0, offset + 2, offset + size);
        }
        offset += size;
      }
      let binary = '';
      for (let i = 0; i < code.length; i += 8192) binary += String.fromCharCode(...code.subarray(i, i + 8192));
      return { key: `${start & 3}:${btoa(binary)}` };
    }
    compile(start, length, portable = false) {
      if (length <= 0 || length > 65536 || start + length > this.memory.buffer.byteLength)
        throw new Error('Invalid TCI block bounds');
      const view = new DataView(this.memory.buffer);
      const ops = [], targets = new Set();
      for (let pc = start; pc < start + length;) {
        const size = view.getUint8(pc + 1), name = this.names[view.getUint8(pc)];
        if (!name || size < 2 || pc + size > start + length) throw new Error('Invalid TCI operation');
        let target;
        if (name === 'br' || name === 'brcond_i32' || name === 'brcond2_i32') {
          target = view.getUint32(pc + size - 4, true);
          if (target <= pc || target >= start + length) throw new Error('Non-forward TCI branch');
          targets.add(target);
        }
        ops.push({ pc, size, name, target });
        pc += size;
      }
      const boundaries = new Set(ops.map(op => op.pc));
      if ([...targets].some(target => !boundaries.has(target))) throw new Error('Invalid branch target');
      const labels = [...targets].sort((a, b) => a - b);
      const out = [];
      const emit = (...bytes) => out.push(...bytes);
      const get = i => emit(0x20, ...uleb(i));
      const set = i => emit(0x21, ...uleb(i));
      const constant = value => emit(0x41, ...sleb(value));
      const codePointer = address => {
        if (portable) { emit(0x23, 0); constant(address - start); emit(0x6a); }
        else constant(address);
      };
      const defined = new Set(), written = new Set(), needed = new Set();
      const reg = i => { if (!defined.has(i)) needed.add(i); if (i > 15) throw new Error('Invalid TCI register'); get(i + 4); };
      const put = i => { if (i > 13) throw new Error('Invalid TCI destination'); defined.add(i); written.add(i); set(i + 4); };
      const save = (indices = written) => {
        for (const i of indices) { get(1); reg(i); emit(0x36, 2, ...uleb(i * 4)); }
      };
      const restore = (indices = Array.from({ length: 16 }, (_, i) => i)) => {
        for (const i of indices) { get(1); emit(0x28, 2, ...uleb(i * 4)); set(i + 4); defined.add(i); written.add(i); }
      };
      const helper = (pc, inputs, outputs) => {
        save(inputs ?? Array.from({ length: 16 }, (_, i) => i)); get(0); get(1); codePointer(pc); get(2); get(3); emit(0x10, 0, 0x1a);
        restore(outputs);
      };
      emit(0x03, 0x40); // Same-block backedges keep TCI registers in locals.
      for (const _ of labels) emit(0x02, 0x40);
      for (const { pc, size, name, target } of ops) {
        if (labels[0] === pc) { emit(0x0b); labels.shift(); defined.clear(); }
        let cursor = pc + 2;
        const byte = () => view.getUint8(cursor++);
        const word = () => { const value = view.getUint32(cursor, true); cursor += 4; return value; };
        const operand = () => { const r = byte(); if (r === 255) constant(word()); else reg(r); };
        const pair = immediate => {
          if (immediate) operand(); else reg(byte());
          emit(0xad); // i64.extend_i32_u
          if (immediate) operand(); else reg(byte());
          emit(0xad, 0x42, 32, 0x86, 0x84); // high << 32 | low
        };
        const condition = wide => {
          const value = byte(), op = compare32[value];
          if (!op) throw new Error(`Unsupported TCI condition ${value}`);
          emit(op + (wide ? 11 : 0));
        };
        if (binary[name]) {
          const dst = byte(); operand(); operand(); emit(binary[name]); put(dst);
        } else if (name === 'movi_i32') {
          const dst = byte();
          if (portable) { codePointer(cursor); emit(0x28, 0, 0); word(); }
          else constant(word());
          put(dst);
        } else if (name === 'mov_i32') {
          const dst = byte(); reg(byte()); put(dst);
        } else if (['ld_i32', 'ld8u_i32', 'st_i32', 'st8_i32', 'st16_i32'].includes(name)) {
          const r = byte(); reg(byte()); constant(word()); emit(0x6a);
          if (name.startsWith('ld')) { emit(name === 'ld_i32' ? 0x28 : 0x2d, 0, 0); put(r); }
          else { reg(r); emit({ st_i32: 0x36, st8_i32: 0x3a, st16_i32: 0x3b }[name], 0, 0); }
        } else if (name === 'br') {
          word(); emit(0x0c, ...uleb(labels.indexOf(target)));
        } else if (name === 'brcond_i32' || name === 'setcond_i32') {
          const dst = name === 'setcond_i32' ? byte() : null;
          reg(byte()); operand(); condition(false);
          if (dst !== null) put(dst);
          else { word(); emit(0x0d, ...uleb(labels.indexOf(target))); }
        } else if (name === 'brcond2_i32' || name === 'setcond2_i32') {
          const dst = name === 'setcond2_i32' ? byte() : null;
          pair(false); pair(true); condition(true);
          if (dst !== null) put(dst);
          else { word(); emit(0x0d, ...uleb(labels.indexOf(target))); }
        } else if (['add2_i32', 'sub2_i32', 'mulu2_i32'].includes(name)) {
          const low = byte(), high = byte();
          if (name === 'mulu2_i32') { reg(byte()); emit(0xad); reg(byte()); emit(0xad, 0x7e); }
          else { pair(false); pair(false); emit(name === 'add2_i32' ? 0x7c : 0x7d); }
          set(20); get(20); emit(0xa7); put(low);
          get(20); emit(0x42, 32, 0x88, 0xa7); put(high);
        } else if (['ext8s_i32', 'ext16s_i32', 'ext8u_i32', 'ext16u_i32', 'not_i32', 'neg_i32'].includes(name)) {
          const dst = byte(), src = byte();
          if (name === 'neg_i32') { constant(0); reg(src); emit(0x6b); }
          else {
            reg(src);
            if (name === 'ext8s_i32') emit(0xc0);
            else if (name === 'ext16s_i32') emit(0xc1);
            else { constant(name === 'not_i32' ? -1 : name === 'ext8u_i32' ? 255 : 65535); emit(name === 'not_i32' ? 0x73 : 0x71); }
          }
          put(dst);
        } else if (name === 'deposit_i32') {
          const dst = byte(), a = byte(), b = byte(), shift = byte(), bits = byte();
          const mask = ((2 ** bits - 1) << shift) | 0;
          reg(a); constant(~mask); emit(0x71); reg(b); constant(shift); emit(0x74);
          constant(mask); emit(0x71, 0x72); put(dst);
        } else if (name === 'call' && this.dispatch?.exitCheck &&
                   view.getUint8(cursor) === 255 &&
                   view.getUint32(cursor + 1, true) === this.dispatch.exitCheck.callee) {
          // The pinned normalized void helper returns zero in r0:r1. Keep its
          // exception/GETPC path for actual requests; avoid its normal no-op call.
          byte(); word();
          get(0); constant(this.dispatch.exitCheck.offset); emit(0x6a, 0x28, 2, 0);
          constant(0); emit(0x48); reg(2); emit(0x45, 0x71, 0x04, 0x40);
          helper(pc, [0,1,2,3,5,6,7,8,9,10,11,12], [0,1]);
          emit(0x05); constant(0); put(0); constant(0); put(1); emit(0x0b);
        } else if (name === 'call' && this.dispatch?.call) {
          const functionReg = byte(), callee = functionReg === 255 ? word() : null;
          const invoke = () => {
            codePointer(pc); if (callee === null) reg(functionReg); else constant(callee);
            for (const i of [0,1,2,3,5,6,7,8,9,10,11,12]) reg(i);
            emit(0x10, 1); set(20);
            get(20); emit(0xa7); put(0);
            get(20); emit(0x42, 32, 0x88, 0xa7); put(1);
          };
          const fp = this.dispatch.floatMath;
          const operation = callee === null ? -1 : fp?.callees.indexOf(callee) ?? -1;
          const unary = callee === null ? -1 : this.dispatch.floatUnary?.indexOf(callee) ?? -1;
          if (unary >= 0) {
            // ARM VNEG/VABS manipulate the sign bit, preserving NaN payloads
            // (including signaling NaNs), subnormals and all FPSCR flags.
            reg(0); constant(unary === 0 ? 0x80000000 : 0x7fffffff);
            emit(unary === 0 ? 0x73 : 0x71); put(0); constant(0); put(1);
          } else if (operation >= 0) {
            // Pinned ARM rules return the same canonical quiet NaN without
            // flag changes for this exact pair, in every FPSCR mode.
            const incoming = new Set(defined);
            reg(0); constant(0x7fc00000); emit(0x46);
            reg(2); constant(0x7fc00000); emit(0x46, 0x71, 0x04, 0x40);
            constant(0x7fc00000); put(0); constant(0); put(1); emit(0x05);
            defined.clear(); for (const r of incoming) defined.add(r);
            // Binary64 holds a binary32 product exactly (24+24 bits), and an
            // add/sub with exponent gap <=29 (24+29 bits), or a zero operand.
            // These cases can set inexact; wider gaps/division require it sticky.
            // Exceptional inputs/results retain the QEMU helper.
            reg(5); emit(0x2d, 0, ...uleb(fp.rounding)); constant(fp.nearest); emit(0x46);
            if (operation !== 1) {
              reg(5); emit(0x2d, 0, ...uleb(fp.flags)); constant(fp.inexact); emit(0x71, 0x45, 0x45);
              if (operation !== 3) {
                emit(0x04, 0x7f); constant(1); emit(0x05); // sticky inexact
                reg(0); constant(23); emit(0x76); constant(255); emit(0x71);
                reg(2); constant(23); emit(0x76); constant(255); emit(0x71, 0x6b);
                constant(29); emit(0x6a); constant(59); emit(0x49);
                reg(0); constant(0x7fffffff); emit(0x71, 0x45, 0x72);
                reg(2); constant(0x7fffffff); emit(0x71, 0x45, 0x72, 0x0b);
              }
              emit(0x71);
            }
            for (const r of [0,2]) {
              reg(r); constant(0x7fffffff); emit(0x71); set(22);
              get(22); emit(0x45);
              // Unsigned subtraction folds the normal range into one comparison.
              get(22); constant(0x00800000); emit(0x6b);
              constant(0x7f000000); emit(0x49, 0x72, 0x71);
            }
            emit(0x04, 0x7f);
            reg(0); emit(0xbe); reg(2); emit(0xbe, [0x92,0x94,0x93,0x95][operation], 0xbc); set(21);
            get(21); constant(0x7fffffff); emit(0x71); set(22);
            get(22); constant(0x00800001); emit(0x6b);
            constant(0x7effffff); emit(0x49);
            if (operation === 1) {
              // Accept exact signed zero, but never an underflow rounded to zero.
              get(22); emit(0x45);
              reg(0); constant(0x7fffffff); emit(0x71, 0x45);
              reg(2); constant(0x7fffffff); emit(0x71, 0x45, 0x72, 0x71, 0x72);
            } else if (operation !== 3) {
              // Normal binary32 add/sub can round to zero only by cancellation.
              get(22); emit(0x45, 0x72);
            }
            emit(0x05); constant(0); emit(0x0b, 0x04, 0x40);
            if (operation !== 3) {
              reg(5); emit(0x2d, 0, ...uleb(fp.flags)); constant(fp.inexact); emit(0x71, 0x45, 0x04, 0x40);
              reg(0); emit(0xbe, 0xbb); reg(2); emit(0xbe, 0xbb, [0xa0,0xa2,0xa1][operation]);
              get(21); emit(0xbe, 0xbb, 0x62, 0x04, 0x40); // exact product != rounded
              reg(5); reg(5); emit(0x2d, 0, ...uleb(fp.flags)); constant(fp.inexact);
              emit(0x72, 0x3a, 0, ...uleb(fp.flags), 0x0b, 0x0b);
            }
            get(21); put(0); constant(0); put(1);
            emit(0x05);
            defined.clear(); for (const r of incoming) defined.add(r);
            // Exactly one positive zero and one canonical quiet NaN: ARM
            // returns that NaN without flag changes, even for division by zero.
            // Keep this check off the ordinary successful arithmetic path.
            reg(0); reg(2); emit(0x72); constant(0x7fc00000); emit(0x46);
            reg(0); emit(0x45); reg(2); emit(0x45, 0x72, 0x71, 0x04, 0x40);
            constant(0x7fc00000); put(0); constant(0); put(1); emit(0x05);
            defined.clear(); for (const r of incoming) defined.add(r);
            invoke(); emit(0x0b, 0x0b, 0x0b);
          } else invoke();
        } else if (name === 'exit_tb') {
          save(); get(3);
          if (portable) { codePointer(pc + 2); emit(0x28, 0, 0); word(); }
          else constant(word());
          emit(0x36, 2, 0); word();
          constant(0); emit(0x0f);
        } else if (name === 'goto_tb') {
          // Unicorn patches this relative displacement when linking/unlinking TBs.
          // Read it at execution time; never bake a mutable link into generated code.
          const address = (pc + 5) & ~3;
          codePointer(address); emit(0x28, 2, 0); codePointer(address + 4); emit(0x6a); set(21);
          // Recheck the mutable link every iteration, including after code writes.
          // Budgets and exit checks still execute at the beginning of the block.
          get(21); codePointer(start); emit(0x46, 0x0d, ...uleb(labels.length));
          save(); get(21); emit(0x0f);
          cursor = pc + size;
        } else if (['qemu_ld_i32', 'qemu_ld_i64', 'qemu_st_i32', 'qemu_st_i64'].includes(name) && this.dispatch?.readLayout) {
          const store = name.startsWith('qemu_st'), wide = name.endsWith('i64');
          const value = byte(), high = wide ? byte() : null, address = byte(), oi = word(), memop = oi >>> 4;
          const alignment = (memop >>> 4) & 7, width = memop & 3, bytes = 1 << width;
          // A32 doubles are often only word-aligned. Use C's alignment enum;
          // older runtime artifacts retain the naturally aligned path.
          const wordAligned = wide && this.dispatch.unaligned !== undefined &&
            (alignment === (this.dispatch.unaligned >>> 4) || alignment === 1 || alignment === 2);
          const inputs = store ? (wide ? [value, high, address] : [value, address]) : [address], outputs = store ? [] : wide ? [value, high] : [value];
          // Pinned TCGMemOpIdx: low 4 bits are the MMU index; width is log2(size).
          // Alignment 7 means natural alignment (or unaligned on strict hosts).
          if (!(memop & 8) && (wide ? width === 3 && !(memop & 4) : width < 3 && (store || width < 2 || !(memop & 4))) &&
              (alignment <= width || alignment === 7) &&
              (!store || this.dispatch.readLayout.length >= 5)) {
            const [engine, base, size, pointer, codePages] = this.dispatch.readLayout;
            const pageMap = this.dispatch.pageMap;
            if (pageMap !== undefined) {
              get(0); emit(0x28, 2, ...uleb(engine));
              reg(address); constant(12); emit(0x76); constant(2); emit(0x74, 0x6a, 0x28, 2, ...uleb(pageMap)); set(21);
              reg(address); constant(4095); emit(0x71); set(22);
              reg(address); constant(wordAligned ? 3 : bytes - 1); emit(0x71, 0x45);
              get(21); emit(0x45, 0x45, 0x71);
              get(22); constant(4096 - bytes); emit(0x4d, 0x71);
            } else {
              get(0); emit(0x28, 2, ...uleb(engine));
              reg(address); constant(31); emit(0x76); constant(2); emit(0x74, 0x6a); set(21);
              reg(address); get(21); emit(0x28, 2, ...uleb(base), 0x6b); set(22);
              reg(address); constant(wordAligned ? 3 : bytes - 1); emit(0x71, 0x45);
              get(21); emit(0x28, 2, ...uleb(size)); constant(bytes); emit(0x4f, 0x71);
              get(22); get(21); emit(0x28, 2, ...uleb(size)); constant(bytes); emit(0x6b, 0x4d, 0x71);
            }
            if (store) {
              // Keep relaxed doubleword stores within one checked code page.
              if (wordAligned && pageMap === undefined) { reg(address); constant(4095); emit(0x71); constant(4088); emit(0x4d, 0x71); }
              get(0); emit(0x28, 2, ...uleb(engine));
              reg(address); constant(15); emit(0x76, 0x6a, 0x2d, 0, ...uleb(codePages));
              constant(1); reg(address); constant(12); emit(0x76); constant(7); emit(0x71, 0x74, 0x71, 0x45, 0x71);
            }
            emit(0x04, store ? 0x40 : wide ? 0x7e : 0x7f);
            get(21); if (pageMap === undefined) emit(0x28, 2, ...uleb(pointer)); get(22); emit(0x6a);
            if (store) {
              reg(value);
              if (wide) { emit(0xad); reg(high); emit(0xad, 0x42, 32, 0x86, 0x84); }
              emit([0x3a, 0x3b, 0x36, 0x37][width], 0, 0);
            } else emit([memop & 4 ? 0x2c : 0x2d, memop & 4 ? 0x2e : 0x2f, 0x28, 0x29][width], 0, 0);
            emit(0x05); helper(pc, inputs, outputs);
            if (!store) {
              reg(value);
              if (wide) { emit(0xad); reg(high); emit(0xad, 0x42, 32, 0x86, 0x84); }
            }
            emit(0x0b);
            if (wide && !store) {
              set(20); get(20); emit(0xa7); put(value);
              get(20); emit(0x42, 32, 0x88, 0xa7); put(high);
            } else if (!store) put(value);
          } else helper(pc, inputs, outputs);
        } else if (name === 'mb') {
          // Worker memory is unshared; TCI's fence has no additional effect.
        } else {
          // Preserve QEMU memory/exception/VFP semantics via the same interpreter
          // operation. Helpers cannot yield; exceptions propagate through Wasm.
          let inputs, outputs;
          if (name === 'call') {
            inputs = [0,1,2,3,5,6,7,8,9,10,11,12];
            const functionReg = byte();
            if (functionReg !== 255 && !inputs.includes(functionReg)) inputs.push(functionReg);
            outputs = [0,1];
          } else if (name === 'qemu_ld_i32') { const dst = byte(); inputs = [byte()]; outputs = [dst]; }
          else if (name === 'qemu_ld_i64') { outputs = [byte(), byte()]; inputs = [byte()]; }
          else if (name === 'qemu_st_i32') { inputs = [byte(), byte()]; outputs = []; }
          else if (name === 'qemu_st_i64') { inputs = [byte(), byte(), byte()]; outputs = []; }
          helper(pc, inputs, outputs); cursor = pc + size;
        }
        if (cursor !== pc + size) throw new Error(`TCI operand mismatch: ${name}`);
      }
      if (labels.length) throw new Error('Unresolved TCI labels');
      emit(0x00, 0x0b, 0x00, 0x0b); // Neither block nor loop may fall through.
      // Only inputs read before a definite assignment need entry loads. At
      // forward joins definitions are conservatively forgotten; untouched
      // registers stay in memory, and exits save only registers written here.
      const entry = [];
      for (const i of needed) entry.push(0x20, 1, 0x28, 2, ...uleb(i * 4), 0x21, ...uleb(i + 4));
      const body = [3, 16, 0x7f, 1, 0x7e, 2, 0x7f, ...entry, ...out];
      return new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0,
        ...section(1, [3, 0x60, 5, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 1, 0x7f,
          0x60, 4, 0x7f, 0x7f, 0x7f, 0x7f, 1, 0x7f,
          0x60, 14, ...Array(14).fill(0x7f), 1, 0x7e]),
        ...section(2, [(this.dispatch?.call ? 3 : 2) + (portable ? 1 : 0), ...str('e'), ...str('m'), 2, 0, 0,
          ...str('e'), ...str('s'), 0, 0,
          ...(this.dispatch?.call ? [...str('e'), ...str('c'), 0, 2] : []),
          ...(portable ? [...str('e'), ...str('b'), 3, 0x7f, 0] : [])]),
        ...section(3, [1, 1]),
        ...section(7, [1, ...str('run'), 0, this.dispatch?.call ? 2 : 1]),
        ...section(10, [1, ...uleb(body.length), ...body]),
      ]);
    }
  }
  globalThis.TouchHLETciJit = TouchHLETciJit;
})();
