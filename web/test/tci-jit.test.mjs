// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import '../tci-jit.js';

const names = ['movi_i32', 'mov_i32', 'add_i32', 'sub_i32', 'mul_i32', 'shl_i32',
  'sar_i32', 'shr_i32', 'rotl_i32', 'rotr_i32', 'setcond_i32', 'brcond_i32',
  'exit_tb', 'goto_tb', 'add2_i32', 'sub2_i32', 'mulu2_i32', 'setcond2_i32',
  'ld_i32', 'st_i32', 'qemu_ld_i32', 'qemu_st_i32', 'call'];
const word = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24];
const imm = n => [255, ...word(n)];
const op = (name, ...args) => [names.indexOf(name), args.length + 2, ...args];
const exit = () => op('exit_tb', ...word(123), 0, 0, 0, 0);
function fixture(code, step = () => { throw new Error('Unexpected fallback'); }, dispatch = null) {
  const memory = new WebAssembly.Memory({ initial: 4 });
  new Uint8Array(memory.buffer).set(code, 1024);
  const jit = new globalThis.TouchHLETciJit(memory, step, fn => fn, () => {}, 1, dispatch);
  jit.names = names;
  jit.register(1024, code.length);
  const fn = jit.lookup(1024);
  assert.ok(fn, jit.stats.lastFailure);
  const regs = () => new Uint32Array(memory.buffer, 128, 16);
  return { jit, memory, regs, run: () => fn(0, 128, 512, 256) };
}
let seed = 0x12345678;
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };

test('compiled integer arithmetic and shifts match 32-bit reference semantics', () => {
  const refs = {
    add_i32: (a,b) => a+b, sub_i32: (a,b) => a-b, mul_i32: Math.imul,
    shl_i32: (a,b) => a << b, shr_i32: (a,b) => a >>> b, sar_i32: (a,b) => a >> b,
    rotl_i32: (a,b) => (a << b) | (a >>> ((32-b)&31)),
    rotr_i32: (a,b) => (a >>> b) | (a << ((32-b)&31)),
  };
  for (const [name, reference] of Object.entries(refs)) {
    const f = fixture([...op(name, 2, 0, 1), ...exit()]);
    for (let i = 0; i < 1000; i++) {
      const a = random(), b = i < 64 ? i : random();
      f.regs()[0] = a; f.regs()[1] = b;
      assert.equal(f.run(), 0);
      assert.equal(f.regs()[2], reference(a,b) >>> 0, `${name} ${a}, ${b}`);
    }
  }
});

test('compiled signed/unsigned comparisons and forward branches', () => {
  const refs = { 8: (a,b)=>a===b, 9: (a,b)=>a!==b, 2: (a,b)=>(a|0)<(b|0),
    3: (a,b)=>(a|0)>=(b|0), 10: (a,b)=>(a|0)<=(b|0), 11: (a,b)=>(a|0)>(b|0),
    4: (a,b)=>a<b, 5: (a,b)=>a>=b, 12: (a,b)=>a<=b, 13: (a,b)=>a>b };
  for (const [condition, reference] of Object.entries(refs)) {
    const f = fixture([...op('setcond_i32', 2, 0, 1, Number(condition)), ...exit()]);
    for (let i=0;i<100;i++) {
      const a=random(),b=i%3 ? random():a;
      f.regs()[0]=a; f.regs()[1]=b; f.run();
      assert.equal(f.regs()[2], Number(reference(a,b)));
    }
  }
  const branch = op('brcond_i32', 0, ...imm(0), 8, ...word(1024 + 13 + 7));
  const f = fixture([...branch, ...op('movi_i32', 1, ...word(42)), ...exit()]);
  f.run(); assert.equal(f.regs()[1],0);
  f.regs()[0]=1; f.run(); assert.equal(f.regs()[1],42);
});

test('64-bit arithmetic retains carry and high multiplication bits', () => {
  const mask=(1n<<64n)-1n;
  for (const name of ['add2_i32','sub2_i32','mulu2_i32']) {
    const operands=name==='mulu2_i32' ? [0,2] : [0,1,2,3];
    const f=fixture([...op(name,4,5,...operands),...exit()]);
    for(let i=0;i<200;i++) {
      const r=f.regs(); for(let j=0;j<4;j++) r[j]=random();
      const a=BigInt(r[0])+(BigInt(r[1])<<32n), b=BigInt(r[2])+(BigInt(r[3])<<32n);
      const expected=(name==='add2_i32'?a+b:name==='sub2_i32'?a-b:BigInt(r[0])*BigInt(r[2]))&mask;
      f.run(); assert.equal(BigInt(r[4])+(BigInt(r[5])<<32n),expected);
    }
  }
});

test('dynamic block links and memory growth never capture stale memory views', () => {
  const f=fixture(op('goto_tb',0,0,...word(100)));
  assert.equal(f.run(),1132);
  f.memory.grow(1);
  new DataView(f.memory.buffer).setInt32(1028,-100,true);
  assert.equal(f.run(),932);
});

test('helper fallback sees current registers and returns updated values', () => {
  let f;
  f=fixture([...op('movi_i32',0,...word(42)), ...op('qemu_ld_i32',1,0,...word(0)),
    ...op('add_i32',2,1,...imm(1)), ...exit()], (env,regs,pc,sp,ret)=> {
    assert.equal(f.regs()[0],42); f.regs()[1]=99; return pc+8;
  });
  f.run(); assert.equal(f.regs()[2],100);
});

test('malformed code rejects compilation; registration and reset release cached functions', () => {
  const memory=new WebAssembly.Memory({initial:1}); let removed=0;
  const jit=new globalThis.TouchHLETciJit(memory,()=>0,()=>5,()=>removed++,1);
  jit.names=names;
  new Uint8Array(memory.buffer).set(exit(),1024);
  jit.register(1024,10); assert.equal(jit.lookup(1024),5);
  jit.register(1024,10); assert.equal(removed,1); assert.equal(jit.lookup(1024),5);
  jit.reset(); assert.equal(removed,2); assert.equal(jit.lookup(1024),0);
  jit.register(0,1); assert.equal(jit.lookup(0),0); assert.equal(jit.stats.failed,1);
});

test('compiled-cache eviction clears native dispatch before table slots are reused', () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const events = [];
  const jit = new globalThis.TouchHLETciJit(memory, () => 0,
    () => { events.push('add'); return 7; }, () => events.push('remove'), 1,
    { counter: 512, clear: () => events.push('clear') });
  jit.names = names;
  new Uint8Array(memory.buffer).set(exit(), 1024);
  new Uint8Array(memory.buffer).set(exit(), 2048);
  jit.register(1024, 10); assert.equal(jit.lookup(1024), 7);
  new DataView(memory.buffer).setFloat64(512, 123, true);
  assert.equal(jit.stats.hits, 123);
  jit.liveModules = 8192; // Force the production retention limit.
  jit.register(2048, 10); assert.equal(jit.lookup(2048), 7);
  assert.deepEqual(events, ['add', 'clear', 'remove', 'add']);
  assert.equal(jit.blocks.get(1024).fn, 0);
  assert.equal(jit.lookup(1024), 7); // Eviction retains enough metadata to recompile.
  jit.reset();
  assert.equal(events.at(-3), 'clear');
});

test('inline fixed-region reads preserve bounds, fallback, engine identity and memory growth', () => {
  for (const memop of [2, 0x12, 0x22, 0x72, 10, 0x32]) {
    let calls = 0;
    const f = fixture([...op('qemu_ld_i32', 3, 0, ...word((memop << 4) | 2)), ...exit()],
      (_env, regs) => { calls++; new Uint32Array(f.memory.buffer, regs, 16)[3] = 12345; return 0; },
      { counter: 96, clear() {}, readLayout: [0, 0, 8, 16] });
    const view = () => new DataView(f.memory.buffer);
    view().setUint32(0, 4096, true); // env -> engine
    const mapping = (base, size = 16) => {
      const engine = view().getUint32(0, true) + (base >>> 31) * 4;
      view().setUint32(engine, base, true);
      view().setUint32(engine + 8, size, true);
      view().setUint32(engine + 16, 8192, true);
    };
    view().setUint32(8192, 0x11223344, true);
    view().setUint32(8204, 0xaabbccdd, true);
    for (const base of [0x1000, 0xfffff000]) {
      mapping(base);
      for (const [address, expected] of [[base, 0x11223344], [base + 12, 0xaabbccdd],
        [base + 1, 12345], [base - 4, 12345], [base + 16, 12345], [0, 12345]]) {
        const eligible = [2, 0x12, 0x22, 0x72].includes(memop) && expected !== 12345;
        const previous = calls;
        f.regs()[0] = address; f.run();
        assert.equal(f.regs()[3], eligible ? expected : 12345);
        assert.equal(calls - previous, eligible ? 0 : 1);
      }
    }
    for (const size of [0, 3]) {
      mapping(0x1000, size); f.regs()[0] = 0x1000; f.run();
      assert.equal(f.regs()[3], 12345);
    }
    f.memory.grow(1);
    view().setUint32(0, 4128, true); // another CPU, same compiled function
    mapping(0x2000); f.regs()[0] = 0x2000; f.run();
    assert.equal(f.regs()[3], [2, 0x12, 0x22, 0x72].includes(memop) ? 0x11223344 : 12345);
  }
});

test('inline stores recheck translated pages and retain helper fallback', () => {
  for (const memop of [2, 0x72, 0x32, 10]) {
    let calls = 0;
    const f = fixture([...op('qemu_st_i32', 1, 0, ...word(memop << 4)), ...exit()],
      (_env, regs) => { calls++; assert.equal(new Uint32Array(f.memory.buffer, regs, 16)[1], 0x89abcdef); return 0; },
      { counter: 96, clear() {}, readLayout: [0, 0, 8, 16, 32768] });
    const view = () => new DataView(f.memory.buffer);
    view().setUint32(0, 4096, true);
    for (const base of [0x1000, 0xfffff000]) {
      const slot = (base >>> 31) * 4;
      view().setUint32(4096 + slot, base, true);
      view().setUint32(4104 + slot, 4096, true);
      view().setUint32(4112 + slot, 8192, true);
      const flag = 4096 + 32768 + (base >>> 15), bit = 1 << ((base >>> 12) & 7);
      for (const translated of [false, true, true]) {
        view().setUint8(flag, translated ? bit : 0);
        for (const offset of [0, 4092, 1, 4096, -4]) {
          const address = (base + offset) >>> 0;
          view().setUint32(8192 + (offset === 4092 ? 4092 : 0), 0, true);
          f.regs()[0] = address; f.regs()[1] = 0x89abcdef;
          const previous = calls; f.run();
          const fast = [2, 0x72].includes(memop) && !translated && [0, 4092].includes(offset);
          assert.equal(calls - previous, fast ? 0 : 1);
          if ([0, 4092].includes(offset)) assert.equal(view().getUint32(8192 + offset, true), fast ? 0x89abcdef : 0);
        }
        f.memory.grow(1);
      }
    }
  }
});

test('inline byte and halfword loads/stores preserve signed values and boundaries', () => {
  for (const store of [false, true]) for (const memop of [0,4,1,5,0x70,0x74,0x71,0x75,0x10,0x21,9]) {
    const size = (memop & 3) === 0 ? 1 : 2;
    let calls = 0;
    const f = fixture([...op(store ? 'qemu_st_i32' : 'qemu_ld_i32', 1, 0, ...word(memop << 4)), ...exit()],
      (_env, regs) => { calls++; if (!store) new Uint32Array(f.memory.buffer, regs, 16)[1] = 12345; return 0; },
      {counter:96,clear(){},readLayout:[0,0,8,16,32768]});
    const view = () => new DataView(f.memory.buffer);
    view().setUint32(0,4096,true);
    for (const base of [0x1000,0xfffff000]) {
      const slot = (base >>> 31) * 4;
      view().setUint32(4096+slot,base,true); view().setUint32(4104+slot,16,true); view().setUint32(4112+slot,8192,true);
      for (const offset of [0,1,14,15,16,-1]) {
        view().setUint32(8192,0x44338080,true); view().setUint32(8204,0xaabbccdd,true);
        const fast = ![0x10,0x21,9].includes(memop) && offset >= 0 && offset + size <= 16 && offset % size === 0;
        const load = () => size === 1 ? (memop & 4 ? view().getInt8(8192+offset) : view().getUint8(8192+offset)) :
          (memop & 4 ? view().getInt16(8192+offset,true) : view().getUint16(8192+offset,true));
        const expected = fast && !store ? load() >>> 0 : 12345;
        f.regs()[0] = (base+offset) >>> 0; f.regs()[1] = 0x89abcdef;
        const previous = calls; f.run(); assert.equal(calls-previous,fast ? 0 : 1);
        if (!store) assert.equal(f.regs()[1],expected);
        else if (fast) assert.equal(size === 1 ? view().getUint8(8192+offset) : view().getUint16(8192+offset,true),size === 1 ? 0xef : 0xcdef);
      }
    }
  }
});


test('exit-request helper fast path preserves delay slots, results and exceptional fallback', () => {
  for (const request of [0, 1, 0x7fffffff, -1, -0x80000000]) for (const delay of [0, 1]) {
    let calls = 0;
    const f = fixture([...op('call', ...imm(37)), ...exit()], (_env, regs, pc) => {
      calls++;
      assert.equal(pc, 1024);
      const r = new Uint32Array(f.memory.buffer, regs, 16);
      assert.equal(r[0], 123); assert.equal(r[2], delay);
      r[0] = 11; r[1] = 22;
      return pc + 7;
    }, {counter:96,clear(){},exitCheck:{callee:37,offset:64}});
    new DataView(f.memory.buffer).setInt32(64, request, true);
    f.regs()[0] = 123; f.regs()[1] = 456; f.regs()[2] = delay;
    f.run();
    const slow = request < 0 && !delay;
    assert.equal(calls, slow ? 1 : 0);
    assert.equal(f.regs()[0], slow ? 11 : 0); assert.equal(f.regs()[1], slow ? 22 : 0);
    assert.equal(f.regs()[2], delay);
  }
  const failure = new Error('pending exit');
  const f = fixture([...op('call', ...imm(37)), ...exit()], () => { throw failure; },
    {counter:96,clear(){},exitCheck:{callee:37,offset:64}});
  new DataView(f.memory.buffer).setInt32(64,-1,true);
  assert.throws(() => f.run(), error => error === failure);
});


test('exit predicate specialization never skips another helper identity', () => {
  let calls = 0;
  const f = fixture([...op('call', ...imm(38)), ...exit()], () => { calls++; return 1031; },
    {counter:96,clear(){},exitCheck:{callee:37,offset:64}});
  f.run();
  assert.equal(calls, 1);
});
