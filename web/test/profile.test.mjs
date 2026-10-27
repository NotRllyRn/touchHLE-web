// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import '../tci-jit.js';
import { TciProfile } from '../tci-profile.mjs';
import { summarizeProfile } from '../profile-report.mjs';
const names = ['movi_i32', 'sub_i32', 'brcond_i32', 'goto_tb', 'exit_tb', 'qemu_ld_i32', 'call'];
const word = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24];
const op = (name, ...args) => [names.indexOf(name), args.length + 2, ...args];
const imm = n => [255, ...word(n)];
const exit = () => op('exit_tb', ...word(123), 0, 0, 0, 0);
function fixture(profile, code, step = () => { throw Error('guest fault'); }) {
  const memory = new WebAssembly.Memory({ initial: 2 });
  new Uint8Array(memory.buffer).set(code, 1024);
  const jit = new TouchHLETciJit(memory, step, fn => fn, () => {}, 1);
  jit.names = names; jit.profile = profile;
  const run = () => {
    jit.register(1024, code.length); const fn = jit.lookup(1024);
    assert.ok(fn, jit.stats.lastFailure); return fn;
  };
  return { jit, memory, run };
}
test('TCI counts follow forward branches, self loops and memory growth', () => {
  // decrement; branch to exit on zero; otherwise mutable goto loops to start
  const code = [...op('sub_i32', 0, 0, ...imm(1)),
    ...op('brcond_i32', 0, ...imm(0), 8, ...word(1052)),
    ...op('goto_tb', ...word(-28)), ...exit()];
  // goto aligns its 4-byte link at 1048, then advances to 1052.
  assert.equal(code.length, 38);
  const profile = new TciProfile({ counts: true }), f = fixture(profile, code), fn = f.run();
  new DataView(f.memory.buffer).setUint32(128, 3, true); fn(0, 128, 512, 256);
  f.memory.grow(1);
  new DataView(f.memory.buffer).setUint32(128, 2, true); fn(0, 128, 512, 256);
  const result = profile.snapshot();
  assert.equal(result.blocks[0].entries, 5);
  assert.deepEqual(result.opcodes, { sub_i32: 5, brcond_i32: 5, goto_tb: 3, exit_tb: 2 });
  assert.equal(new DataView(f.memory.buffer).getUint32(128, true), 0);
});
test('profile faults stop counts, new compilation identities survive reuse, and retention is bounded', () => {
  const p = new TciProfile({ counts: true, limit: 2 });
  const f = fixture(p, [...op('qemu_ld_i32', 1, 0, ...word(0)), ...exit()]);
  assert.throws(() => f.run()(0, 128, 512, 256), /guest fault/);
  f.jit.reset(); assert.throws(() => f.run()(0, 128, 512, 256), /guest fault/);
  assert.throws(() => f.run()(0, 128, 512, 256), /guest fault/);
  const result = p.snapshot();
  assert.deepEqual(result.blocks.map(b => b.name), ['tci_block_0', 'tci_block_1']);
  assert.equal(result.opcodes.qemu_ld_i32, 2); assert.equal(result.opcodes.exit_tb, 0);
  assert.equal(result.dropped, 1); assert.equal(f.jit.stats.failed, 0);
  assert.equal(result.truncated, true); assert.match(result.coverage, /metadata limit/);
});
test('cached modules cannot silently bypass either profiling mode', () => {
  for (const counts of [false, true]) {
    const f = fixture(new TciProfile({ counts }), exit());
    f.jit.portable = { modules: new Map() };
    assert.throws(() => f.run(), /Profiling cached modules is unsupported/);
  }
});
test('failed code generation consumes diagnostic quota but never records executions', () => {
  const p = new TciProfile({ counts: true, limit: 1 });
  const f = fixture(p, [...op('movi_i32', 255, ...word(7)), ...exit()]);
  f.jit.register(1024, 17); assert.equal(f.jit.lookup(1024), 0);
  assert.match(f.jit.stats.lastFailure, /Invalid TCI destination/);
  assert.equal(p.snapshot().blocks[0].entries, 0);
  new Uint8Array(f.memory.buffer)[1026] = 0;
  f.run()(0, 128, 512, 256);
  assert.equal(p.snapshot().dropped, 1);
  assert.equal(p.snapshot().opcodes.movi_i32, 0);
  assert.equal(new DataView(f.memory.buffer).getUint32(128, true), 7);
});
test('portable counters use multibyte global indices and name the correct function with direct dispatch', () => {
  const code = [...Array.from({ length: 150 }, (_, i) => op('movi_i32', 0, ...word(i))).flat(), ...exit()];
  for (const dispatch of [false, true]) {
    const f = fixture(new TciProfile({ counts: true }), code);
    if (dispatch) f.jit.dispatch = { call: () => 0n };
    f.jit.portable = { capture() {} };
    f.run()(0, 128, 512, 256);
    assert.equal(f.jit.profile.snapshot().opcodes.movi_i32, 150);
    assert.equal(new DataView(f.memory.buffer).getUint32(128, true), 149);
    const bytes = f.jit.compile(1024, code.length, true);
    const section = new Uint8Array(WebAssembly.Module.customSections(new WebAssembly.Module(bytes), 'name')[0]);
    // function-name subsection, payload size, one entry, function index, string length
    assert.equal(section[0], 1); assert.equal(section[2], 1);
    assert.equal(section[3], dispatch ? 2 : 1);
    assert.equal(new TextDecoder().decode(section.slice(5)), 'tci_block_1');
  }
});
test('timing-only metadata adds no counter operations; ordinary compiler is unchanged after observer removal', () => {
  const code = [...op('movi_i32', 0, ...word(7)), ...exit()];
  const f = fixture(null, code), before = f.jit.compile(1024, code.length);
  f.jit.profile = new TciProfile(); const named = f.jit.compile(1024, code.length);
  assert.deepEqual(named.slice(0, before.length), before);
  assert.ok(WebAssembly.validate(named));
  f.jit.profile = null; assert.deepEqual(f.jit.compile(1024, code.length), before);
  f.jit.profile = new TciProfile({ counts: true });
  f.jit.portable = { capture() {} }; // Imported constants and counters have separate global indices.
  f.run()(0, 128, 512, 256);
  assert.equal(new DataView(f.memory.buffer).getUint32(128, true), 7);
  assert.equal(f.jit.profile.snapshot().opcodes.movi_i32, 1);
});
test('sample attribution weights deltas, distinguishes modules and deduplicates recursive inclusive frames', () => {
  const frame = (id, name, scriptId, children = []) => ({ id,
    callFrame: { functionName: name, scriptId, url: 'wasm://test', lineNumber: 0, columnNumber: 0 }, children });
  const profile = { nodes: [frame(1, '(root)', '0', [2, 4]), frame(2, 'recursive', '1', [3]),
    frame(3, 'recursive', '1'), frame(4, 'recursive', '2')],
    samples: [3, 2, 4], timeDeltas: [1000, 2000, 4000], startTime: 0, endTime: 7000 };
  const report = summarizeProfile(profile);
  assert.equal(report.sampledMs, 7);
  const rows = report.functions.filter(f => f.functionName === 'recursive');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(f => [f.selfMs, f.inclusiveMs]), [[4, 4], [3, 3]]);
  assert.equal(report.functions.find(f => f.functionName === '(root)').inclusiveMs, 7);
  assert.throws(() => summarizeProfile({ ...profile, timeDeltas: [] }), /Incomplete/);
  assert.throws(() => summarizeProfile({ ...profile, timeDeltas: [-1, 2, 3] }), /Invalid/);
  assert.throws(() => summarizeProfile({ ...profile, samples: [99, 2, 4] }), /Invalid/);
  const cyclic = structuredClone(profile); cyclic.nodes[2].children = [2];
  assert.throws(() => summarizeProfile(cyclic), /Cyclic/);
});

test('optional guest metadata is copied with generation and survives buffer and pointer reuse', () => {
  const p = new TciProfile({ limit: 2 }), f = fixture(p, exit());
  const search = Uint8Array.of(0, 0, 0, 10);
  const metadata = { format: 'arm32-encode-search-v1', guestPc: 0x1000,
    guestSize: 4, icount: 1, flags: 0x100, search };
  f.jit.register(1024, 10);
  // The registration record is the existing begin(jit,start,length,ops) API.
  Object.assign(f.jit.blocks.get(1024), { guestMetadata: metadata, generation: 7 });
  const fn = f.jit.lookup(1024);
  assert.ok(fn, f.jit.stats.lastFailure);
  fn(0, 128, 512, 256);
  search.fill(255); metadata.guestPc = 0x9000;
  f.memory.grow(1);
  f.jit.reset(); f.run()(0, 128, 512, 256);
  const result = p.snapshot(), block = result.blocks[0];
  assert.equal(block.generation, 7);
  assert.equal(block.guestMetadata.guestPc, 0x1000);
  assert.deepEqual(block.guestMetadata.search, [0, 0, 0, 10]);
  assert.deepEqual(block.guestMap, [{ guestPc: 0x1000, thumb: true, itState: 0,
    syndrome: 0, tciEndOffset: 10 }]);
  assert.equal(result.blocks[1].guestMetadata, undefined);
  assert.match(result.guestMapMeaning, /neither slots nor TCI counts establish ARM/);
  block.guestMetadata.search[0] = 99;
  block.guestMap[0].guestPc = 99;
  assert.equal(p.snapshot().blocks[0].guestMetadata.search[0], 0);
  assert.equal(p.snapshot().blocks[0].guestMap[0].guestPc, 0x1000);
  assert.equal(JSON.parse(JSON.stringify(result)).blocks[0].generation, 7);
});

test('malformed guest maps are bounded diagnostics and never stop TCI execution', () => {
  const p = new TciProfile({ counts: true, limit: 2 }), f = fixture(p, exit());
  for (const search of [Uint8Array.of(0, 0, 0, 11), new Uint8Array(10241)]) {
    f.jit.register(1024, 10);
    Object.assign(f.jit.blocks.get(1024), { generation: p.records.length,
      guestMetadata: { format: 'arm32-encode-search-v1', guestPc: 0x1000,
        guestSize: 4, icount: 1, flags: 0, search } });
    const fn = f.jit.lookup(1024);
    assert.ok(fn, f.jit.stats.lastFailure);
    fn(0, 128, 512, 256);
  }
  f.run()(0, 128, 512, 256);
  const result = p.snapshot();
  assert.equal(f.jit.stats.failed, 0);
  assert.equal(result.opcodes.exit_tb, 2);
  assert.equal(result.blocks.length, 2);
  assert.equal(result.dropped, 1);
  assert.deepEqual(result.blocks.map(block => block.generation), [0, 1]);
  for (const block of result.blocks) {
    assert.match(block.guestMapError, /TCI end offset|search length/);
    assert.equal(block.guestMetadata, undefined);
    assert.equal(block.guestMap, undefined);
    assert.equal(block.entries, 1);
  }
});

test('helper call-site counts include inlined operations without claiming helper calls', () => {
  const f = fixture(new TciProfile({ counts: true }), [...op('call', ...imm(900)), ...exit()]);
  let calls = 0;
  f.jit.dispatch = { call() { calls++; return 0n; }, floatUnary: [900, 901] };
  const fn = f.run(); fn(0, 128, 512, 256); fn(0, 128, 512, 256);
  const result = f.jit.profile.snapshot();
  assert.equal(calls, 0);
  assert.equal(result.opcodes.call, 2); assert.deepEqual(result.callSites, { 900: 2 });
  assert.match(result.callSiteMeaning, /not actual helper/);
  assert.match(result.blockEntryMeaning, /same-block goto loops/);
});

test('translation counts distinguish contexts and explicitly bound retention', () => {
  const p = new TciProfile({ counts: true, limit: 2 });
  const f = fixture(p, exit()), metadata = { guestPc: 4096, guestSize: 4, flags: 0 };
  f.jit.register(1024, 10, metadata); f.jit.register(1024, 10, metadata);
  f.jit.reset(); f.jit.register(1024, 10, { ...metadata, flags: 256 });
  f.jit.register(1024, 10, { ...metadata, guestPc: 4100 });
  f.jit.register(1024, 10);
  const result = p.snapshot();
  assert.deepEqual(result.registrationStats, { total: 5, tciBytes: 50, repeatedContexts: 1,
    omittedContexts: 1, missingMetadata: 1 });
  assert.deepEqual(result.translationContexts.map(row => row.translations), [2, 1]);
  assert.match(result.translationMeaning, /does not prove identical code/);
  const timing = new TciProfile(); timing.register(metadata, 10);
  assert.equal(timing.snapshot().registrationStats, null);
});
