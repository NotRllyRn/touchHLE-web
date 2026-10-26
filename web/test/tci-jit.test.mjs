// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import '../tci-jit.js';

const names = ['movi_i32', 'mov_i32', 'add_i32', 'sub_i32', 'mul_i32', 'shl_i32',
  'sar_i32', 'shr_i32', 'rotl_i32', 'rotr_i32', 'setcond_i32', 'brcond_i32',
  'exit_tb', 'goto_tb', 'add2_i32', 'sub2_i32', 'mulu2_i32', 'setcond2_i32',
  'ld_i32', 'st_i32', 'qemu_ld_i32', 'qemu_st_i32', 'call', 'qemu_ld_i64', 'qemu_st_i64'];
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

test('normalized call bridge preserves operand order, wide results and exceptions', () => {
  for (const dynamic of [false,true]) {
    const inputs = [0,1,2,3,5,6,7,8,9,10,11,12];
    let calls = 0, fail = false;
    const f = fixture([...op('call', ...(dynamic ? [4] : imm(99))), ...exit()],
      () => { throw Error('Unexpected interpreter call'); },
      {counter:96,clear(){},call(pc,callee,...args) {
        calls++;
        assert.equal(pc,1024); assert.equal(callee,99);
        assert.deepEqual(args.map(x=>x>>>0),inputs.map(i=>(0x80000000+i)>>>0));
        if (fail) throw Error('helper exception');
        return 0xfedcba9876543210n;
      }});
    const initialize = () => {
      for(let i=0;i<16;i++)f.regs()[i]=0x80000000+i;
      f.regs()[4]=99;
    };
    initialize(); f.run();
    assert.equal(calls,1);
    assert.equal(f.regs()[0],0x76543210); assert.equal(f.regs()[1],0xfedcba98);
    assert.equal(f.regs()[2],0x80000002); assert.equal(f.regs()[15],0x8000000f);
    initialize(); fail=true;
    assert.throws(()=>f.run(),/helper exception/);
    assert.equal(calls,2);
  }
});

test('guarded float operations retain rounding, flag and special-value fallback', () => {
  const bitsBuffer=new ArrayBuffer(4), bitsView=new DataView(bitsBuffer);
  const bits=x=>{bitsView.setFloat32(0,x,true);return bitsView.getUint32(0,true);};
  const value=x=>{bitsView.setUint32(0,x,true);return bitsView.getFloat32(0,true);};
  const normalOrZero=x=>!(x&0x7fffffff)||((x&0x7fffffff)>=0x00800000&&(x&0x7fffffff)<0x7f800000);
  const pairs=[[1,2],[0,1],[-0,1],[1,-1],[1,0],[Infinity,1],[NaN,1],
    [value(0x7f7fffff),value(0x7f7fffff)],[value(0x00800000),1],[value(0x00800001),1],
    [value(0x007fffff),1],[value(0x7f7fffff),1],[value(1),1]].map(p=>p.map(bits));
  for(let i=0;i<300;i++)pairs.push([random(),random()]);
  const operations=[(a,b)=>a+b,(a,b)=>a*b,(a,b)=>a-b,(a,b)=>a/b];
  for(let operation=0;operation<4;operation++) {
    let calls=0;
    const f=fixture([...op('call',...imm(900+operation)),...exit()],undefined,
      {counter:96,clear(){},call(){calls++;return 0x11223344n;},
        floatMath:{callees:[900,901,902,903],rounding:0,flags:1,nearest:0,inexact:32}});
    const status=new Uint8Array(f.memory.buffer,4096,2);
    for(const rounding of [0,1])for(const flags of [0,32,33])for(const [a,b] of pairs) {
      f.regs()[0]=a;f.regs()[1]=123;f.regs()[2]=b;f.regs()[5]=4096;
      status[0]=rounding;status[1]=flags;
      const expected=bits(operations[operation](value(a),value(b))), magnitude=expected&0x7fffffff;
      const fast=rounding===0&&(flags&32)&&normalOrZero(a)&&normalOrZero(b)&&magnitude>0x00800000&&magnitude<0x7f800000;
      const before=calls;f.run();
      assert.equal(calls-before,fast?0:1);
      assert.equal(f.regs()[0],fast?expected:0x11223344);
      assert.equal(f.regs()[1],0);
      assert.deepEqual([...status],[rounding,flags]);
    }
  }
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

test('inline doubleword reads preserve both halves, bounds and fallback', () => {
  for (const unaligned of [undefined, 0, 0x70])
  for (const memop of [3, 0x13, 0x23, 0x33, 0x73, 0x43, 11, 2, 6]) {
    let calls = 0;
    const f = fixture([...op('qemu_ld_i64', 0, 1, 0, ...word(memop << 4)), ...exit()],
      (_env, regs) => {
        calls++;
        const r = new Uint32Array(f.memory.buffer, regs, 16);
        r[0] = 0x11223344; r[1] = 0x89abcdef;
        return 0;
      }, {counter:96,clear(){},readLayout:[0,0,8,16],unaligned});
    const view = () => new DataView(f.memory.buffer);
    view().setUint32(0,4096,true);
    const expected = 0xffeeddccbbaa9988n;
    for (const base of [0x1000,0xfffff000]) {
      const slot = (base >>> 31) * 4;
      view().setUint32(4096+slot,base,true);
      view().setUint32(4112+slot,8192,true);
      for (const size of [0,7,16]) for (const offset of [0,8,4,12,16,-8]) {
        view().setUint32(4104+slot,size,true);
        view().setBigUint64(8192,expected,true); view().setBigUint64(8200,expected,true);
        f.regs()[0] = (base+offset) >>> 0;
        const previous = calls; f.run();
        const relaxed = unaligned !== undefined && [unaligned >>> 4,1,2].includes(memop >>> 4);
        const fast = [3,0x13,0x23,0x33,0x73].includes(memop) && size === 16 &&
          ([0,8].includes(offset) || (relaxed && offset === 4));
        assert.equal(calls-previous,fast ? 0 : 1);
        assert.equal(f.regs()[0],fast ? view().getUint32(8192+offset,true) : 0x11223344);
        assert.equal(f.regs()[1],fast ? view().getUint32(8196+offset,true) : 0x89abcdef);
      }
      f.memory.grow(1);
    }
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

test('inline doubleword stores recheck translated pages and retain helper fallback', () => {
  for (const unaligned of [undefined, 0, 0x70])
  for (const memop of [3, 0x13, 0x23, 0x33, 0x73, 0x43, 11]) {
    let calls = 0;
    const f = fixture([...op('qemu_st_i64', 1, 2, 0, ...word(memop << 4)), ...exit()],
      (_env, regs) => { calls++; assert.equal(new Uint32Array(f.memory.buffer, regs, 16)[1], 0x89abcdef); assert.equal(new Uint32Array(f.memory.buffer, regs, 16)[2], 0xfff81234); return 0; },
      { counter: 96, clear() {}, readLayout: [0, 0, 8, 16, 32768], unaligned });
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
        for (const offset of [0, 4088, 4, 4092, 1, 4096, -4]) {
          const address = (base + offset) >>> 0;
          new Uint8Array(f.memory.buffer,8192,8192).fill(0);
          f.regs()[0] = address; f.regs()[1] = 0x89abcdef; f.regs()[2] = 0xfff81234;
          const previous = calls; f.run();
          const relaxed = unaligned !== undefined && [unaligned >>> 4,1,2].includes(memop >>> 4);
          const fast = [3,0x13,0x23,0x33,0x73].includes(memop) && !translated &&
            ([0,4088].includes(offset) || (relaxed && offset === 4));
          assert.equal(calls - previous, fast ? 0 : 1);
          if ([0, 4, 4088, 4092].includes(offset)) assert.equal(view().getBigUint64(8192 + offset, true), fast ? 0xfff8123489abcdefn : 0n);
        }
        f.memory.grow(1);
      }
      if (base === 0x1000) {
        // Both pages mapped, first not translated: crossing still uses helper.
        view().setUint32(4104,8192,true); view().setUint8(flag,0);
        f.regs()[0]=base+4092;
        const previous=calls; f.run(); assert.equal(calls,previous+1);
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


test('same-block links loop with local registers and observe unlinking', () => {
  // add r0,1; branch to exit if r0==10; otherwise follow mutable goto link.
  const add = op('add_i32',0,0,...imm(1));
  const branchSize = 13;
  const jumpStart = 1024 + add.length + branchSize;
  const displacement = (jumpStart + 5) & ~3;
  const jump = op('goto_tb', ...Array(displacement - jumpStart - 2).fill(0), ...word(1024 - displacement - 4));
  const branch = op('brcond_i32',0,...imm(10),8,...word(jumpStart + jump.length));
  assert.equal(branch.length,branchSize);
  const f = fixture([...add,...branch,...jump,...exit()]);
  assert.equal(f.run(),0); assert.equal(f.regs()[0],10);
  // An unlinked exit must return to the dispatcher, with all registers saved.
  new DataView(f.memory.buffer).setInt32(displacement,2048-displacement-4,true);
  f.regs()[0]=0;
  assert.equal(f.run(),2048); assert.equal(f.regs()[0],1);
});

test('page lookup covers library mappings without crossing pages or bypassing code invalidation', () => {
  for (const store of [false,true]) for (const memop of [0,1,2,3,4,5]) {
    if (store && memop >= 4) continue;
    const width=memop&3, wide=width===3, bytes=1<<width;
    let calls=0;
    const f=fixture([...op(`qemu_${store?'st':'ld'}_i${wide?64:32}`,1,...(wide?[2]:[]),0,...word(memop<<4)),...exit()],
      (_env,ptr)=>{calls++;const regs=new Uint32Array(f.memory.buffer,ptr,16);
        if(store){assert.equal(regs[1],0x89abcdef);if(wide)assert.equal(regs[2],0xfff81234);}
        else {regs[1]=0x11223344;if(wide)regs[2]=0x55667788;}return 0;},
      {counter:96,clear(){},readLayout:[0,0,8,16,0x410000],pageMap:16384,unaligned:0});
    f.memory.grow(70);
    const view=()=>new DataView(f.memory.buffer), engine=4096;
    view().setUint32(0,engine,true);
    for(const [index,base] of [0x1000,0x30000000,0x3748a000,0xfffff000].entries()) {
      const host=0x440000+index*8192, entry=engine+16384+(base>>>12)*4;
      const flag=engine+0x410000+(base>>>15),bit=1<<((base>>>12)&7);
      for(const mapped of [false,true])for(const translated of [false,true]) {
        view().setUint32(entry,mapped?host:0,true);view().setUint8(flag,translated?bit:0);
        for(const offset of [...new Set([0,4,4096-bytes,4092,4093,4096,-bytes])]) {
          new Uint8Array(f.memory.buffer,host,8192).fill(0);
          if(!store&&offset>=0&&offset+bytes<=4096){view().setUint32(host+offset,0x89abcdef,true);if(wide)view().setUint32(host+offset+4,0xfff81234,true);}
          f.regs()[0]=(base+offset)>>>0;f.regs()[1]=0x89abcdef;f.regs()[2]=0xfff81234;
          const fast=mapped&&(!store||!translated)&&offset>=0&&offset+bytes<=4096&&offset%(wide?4:bytes)===0;
          const before=calls;f.run();assert.equal(calls-before,fast?0:1);
          if(store&&offset>=0&&offset+bytes<=4096) {
            const actual=wide?view().getBigUint64(host+offset,true):bytes===4?view().getUint32(host+offset,true):bytes===2?view().getUint16(host+offset,true):view().getUint8(host+offset);
            assert.equal(actual,fast?(wide?0xfff8123489abcdefn:bytes===4?0x89abcdef:bytes===2?0xcdef:0xef):(wide?0n:0));
          } else if(!store) {
            const expected=fast?(bytes===1?(memop&4?0xffffffef:0xef):bytes===2?(memop&4?0xffffcdef:0xcdef):0x89abcdef):0x11223344;
            assert.equal(f.regs()[1],expected);if(wide)assert.equal(f.regs()[2],fast?0xfff81234:0x55667788);
          }
        }
      }
      // Adjacent guest pages may have unrelated host allocations. Never coalesce.
      if(wide&&base!==0xfffff000){
        view().setUint32(entry,host,true);view().setUint32(entry+4,host+8192,true);view().setUint8(flag,0);
        f.regs()[0]=base+4092;f.regs()[1]=0x89abcdef;f.regs()[2]=0xfff81234;
        const before=calls;f.run();assert.equal(calls,before+1);
        view().setUint32(entry+4,0,true);
      }
      f.memory.grow(1);
    }
    // The generated function must read the current engine on every dispatch.
    view().setUint8(engine+0x410000,0);
    f.regs()[0]=0x1000;f.regs()[1]=0x89abcdef;f.regs()[2]=0xfff81234;
    const before=calls;f.run();assert.equal(calls,before);
    view().setUint32(0,engine+1024,true); // distinct, unopted-in page table
    f.regs()[0]=0x1000;f.regs()[1]=0x89abcdef;f.regs()[2]=0xfff81234;
    f.run();assert.equal(calls,before+1);
  }
});
