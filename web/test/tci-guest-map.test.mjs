// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTciGuestMap } from '../tci-guest-map.mjs';

// Test fixtures encode deltas directly, independently of the parser.
function sleb(value) {
  const bytes = [];
  do {
    const byte = value & 127;
    value >>= 7;
    const more = !((value === 0 && !(byte & 64)) || (value === -1 && (byte & 64)));
    bytes.push(byte | (more ? 128 : 0));
    if (!more) return bytes;
  } while (true);
}
function metadata(deltas = [[0, 0, 0, 12]], overrides = {}) {
  return { format: 'arm32-encode-search-v1', guestPc: 0x1000, guestSize: 4,
    icount: deltas.length, flags: 0,
    search: Uint8Array.from(deltas.flatMap(row => row.flatMap(sleb))), ...overrides };
}

test('literal signed deltas restore ARM PC, IT state and partial syndrome', () => {
  const m = metadata([], { icount: 2, guestSize: 8,
    search: Uint8Array.of(0x7c, 0x7f, 0x00, 0x08, 0x04, 0x01, 0x00, 0x04) });
  // -1 wraps to UINT32_MAX for IT, so that malformed ARM state is rejected.
  assert.throws(() => parseTciGuestMap(m, 12), /Invalid ARM IT/);
  m.search[1] = 0;
  assert.deepEqual(parseTciGuestMap(m, 12), [
    { guestPc: 0xffc, thumb: false, itState: 0, syndrome: 0, tciEndOffset: 8 },
    { guestPc: 0x1000, thumb: false, itState: 1, syndrome: 0, tciEndOffset: 12 },
  ]);
});

test('multiple Thumb rows preserve IT transitions, syndrome deltas and halfword PCs', () => {
  const m = metadata([[0, 0x8c, 4095, 8], [2, -4, -4094, 0], [4, -0x88, -1, 16]],
    { flags: 0x100, guestSize: 8 });
  assert.deepEqual(parseTciGuestMap(m, 24), [
    { guestPc: 0x1000, thumb: true, itState: 0x8c, syndrome: 0x3ffc000, tciEndOffset: 8 },
    { guestPc: 0x1002, thumb: true, itState: 0x88, syndrome: 0x4000, tciEndOffset: 8 },
    { guestPc: 0x1006, thumb: true, itState: 0, syndrome: 0, tciEndOffset: 24 },
  ]);
});

test('signed 32-bit extremes and target_ulong wrapping', () => {
  const m = metadata([[-0x80000000, 0, 0, 1], [0x7fffffff, 0, 0, 1], [2, 0, 0, 1]],
    { guestPc: 0x80000000, guestSize: 12 });
  assert.deepEqual(parseTciGuestMap(m, 3).map(row => row.guestPc), [0, 0x7fffffff, 0x80000001]);
  assert.equal(parseTciGuestMap(metadata([[4, 0, 0, 1]], { guestPc: 0xfffffffc }), 1)[0].guestPc, 0);
});

test('offsets are bounded and nondecreasing, with zero-length ranges allowed', () => {
  assert.deepEqual(parseTciGuestMap(metadata([[0, 0, 0, 0], [4, 0, 0, 0]]), 1)
    .map(row => row.tciEndOffset), [0, 0]);
  for (const [deltas, size] of [
    [[[0, 0, 0, -1]], 12],
    [[[0, 0, 0, 8], [4, 0, 0, -1]], 12],
    [[[0, 0, 0, 13]], 12],
    [[[0, 0, 0, 65536]], 65536],
  ]) assert.throws(() => parseTciGuestMap(metadata(deltas), size), /TCI end offset/);
  assert.equal(parseTciGuestMap(metadata([[0, 0, 0, 65535]]), 65536)[0].tciEndOffset, 65535);
});

test('truncated, overlong, overflowing and trailing encodings are rejected', () => {
  const bytes = metadata([[0x10000, 0x80, 0x800, 0x1000]]).search;
  for (let length = 0; length < bytes.length; length++) {
    assert.throws(() => parseTciGuestMap(metadata([], { icount: 1, search: bytes.slice(0, length) }), 0x1000),
      /search length|Truncated search delta/);
  }
  for (const prefix of [
    [0x80, 0x80, 0x80, 0x80, 0x80, 0], // continued fifth byte
    [0xff, 0xff, 0xff, 0xff, 0x0f], // positive value beyond INT32_MAX
    [0x80, 0x80, 0x80, 0x80, 0x70], // negative value below INT32_MIN
  ]) {
    const search = Uint8Array.from([...prefix, 0, 0, 1]);
    assert.throws(() => parseTciGuestMap(metadata([], { icount: 1, search }), 12), /Search delta exceeds/);
  }
  assert.throws(() => parseTciGuestMap(metadata([], { icount: 1, search: Uint8Array.of(0, 0, 0, 1, 0) }), 12),
    /Trailing search bytes/);
});

test('metadata validation bounds allocation and rejects unsupported layouts', () => {
  for (const overrides of [
    { format: 'arm64' }, { guestPc: -1 }, { guestPc: 2 ** 32 }, { guestPc: 1.5 },
    { guestSize: -1 }, { guestSize: 65536 }, { icount: 0 }, { icount: 513 },
    { flags: -1 }, { flags: NaN }, { search: [0, 0, 0, 1] },
    { search: new Uint8Array(21) },
  ]) assert.throws(() => parseTciGuestMap(metadata(undefined, overrides), 12));
  for (const size of [0, -1, NaN, 1.5, 2 ** 32]) {
    assert.throws(() => parseTciGuestMap(metadata(), size), /Invalid tciSize/);
  }
  for (const deltas of [[[0, 256, 0, 1]], [[0, 0, 4096, 1]]]) {
    assert.throws(() => parseTciGuestMap(metadata(deltas), 12), /Invalid ARM/);
  }
  assert.equal(parseTciGuestMap(metadata(Array.from({ length: 512 }, () => [0, 0, 0, 1])), 512).length, 512);
});

// A BP_CPU breakpoint can emit a restoration row without advancing guest PC.
test('zero-size guest TBs retain their fault-restoration slot', () => {
  const rows = parseTciGuestMap(metadata([[0, 0, 0, 12]], { guestSize: 0 }), 12);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].guestPc, 0x1000);
});

test('registration hook copies only encoded search bytes when a profiler exists', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const patch = await readFile(new URL('../patches/unicorn-tci-jit.patch', import.meta.url), 'utf8');
  const source = patch.split('\n').filter(line => line.startsWith('+')).map(line => line.slice(1)).join('\n');
  const body = source.match(/EM_JS\(void, touchhle_tci_register_js,[\s\S]*?unsigned search_size\), \{([\s\S]*?)\n\}\);/)?.[1];
  assert.ok(body, 'metadata registration hook exists');
  const heap = Uint8Array.of(99, 0, 0, 0, 8, 99), registrations = [];
  const jit = { register: (...args) => registrations.push(args) };
  const context = { Module: { tciJit: jit }, ptr: 1024, size: 8, guest_pc: -4,
    guest_size: 2, icount: 1, flags: 0x100, search: 1, search_size: 4 };
  // Without profiling, the hook must not even touch the encoded table.
  runInNewContext(`(function () { ${body} })()`, context);
  assert.deepEqual(registrations[0], [1024, 8]);
  jit.profile = {};
  runInNewContext(`(function () { ${body} })()`, { ...context, HEAPU8: heap });
  const captured = registrations[1][2];
  heap.fill(255);
  assert.equal(captured.guestPc, 0xfffffffc);
  assert.equal(captured.guestSize, 2);
  assert.deepEqual([...captured.search], [0, 0, 0, 8]);
  assert.equal(parseTciGuestMap(captured, 8)[0].thumb, true);
});
