// SPDX-License-Identifier: MPL-2.0
// Exercise the production adapter, including its tick accounting and stepping.
#include <assert.h>
#include <emscripten/heap.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
typedef struct Cpu Cpu;
typedef struct { uint32_t regs[16], extregs[64], cpsr, fpscr; } Context;
extern void touchHLE_DynarmicWrapper_swap_context(Cpu *, Context *);
extern Cpu *touchHLE_DynarmicWrapper_new(void *, size_t);
extern void touchHLE_DynarmicWrapper_delete(Cpu *);
extern uint32_t *touchHLE_DynarmicWrapper_regs_mut(Cpu *);
extern void touchHLE_DynarmicWrapper_set_cpsr(Cpu *, uint32_t);
extern void touchHLE_DynarmicWrapper_invalidate_cache_range(Cpu *, uint32_t, uint32_t);
extern int32_t touchHLE_DynarmicWrapper_run_or_step(Cpu *, void *, uint64_t *);
extern void touchHLE_web_map(Cpu *, uint32_t, size_t, void *);
void touchHLE_web_map_memory(void *mem, Cpu *cpu) {
  touchHLE_web_map(cpu, 0x1000, 8192, mem);
  uint32_t *high_memory = (uint32_t *)mem + 2048;
  high_memory[0] = 0x11223344; high_memory[1022] = 0x44332211; high_memory[1023] = 0x88776655;
  touchHLE_web_map(cpu, 0xfffff000, 4096, high_memory);
}
void adapter_checks(void) {
  uint32_t *code = calloc(1, 12288);
  assert(code);
  Cpu *cpu = touchHLE_DynarmicWrapper_new(NULL, 1);
  uint32_t *regs = touchHLE_DynarmicWrapper_regs_mut(cpu);
  // add r0,#1; b back to add. Abstract budgets stop at block boundaries.
  code[0] = 0xe2800001; code[1] = 0xeafffffd;
  regs[15] = 0x1000;
  uint64_t ticks = 7;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == -1);
  assert(ticks == 0 && regs[0] == 4 && regs[15] == 0x1000);
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, NULL) == -1);
  assert(regs[0] == 5 && regs[15] == 0x1004);
  ticks = 0;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == -1);
  assert(regs[15] == 0x1004);
  // Early SVC exit consumes exactly add + SVC, never the following add.
  code[1] = 0xef000042; code[2] = 0xe2800064;
  touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
  regs[15] = 0x1000;
  ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
  assert(ticks == 98 && regs[0] == 6 && regs[15] == 0x1008);
  // A budget larger than the adapter slice leaves remaining ticks.
  code[1] = 0xeafffffd;
  touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
  regs[15] = 0x1000; ticks = 10001;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == -1);
  assert(ticks == 1 && regs[0] == 5006 && regs[15] == 0x1000);
  // Thumb stepping and SVC use the same accounting path.
  const uint16_t thumb[] = {0x3001, 0xdf23, 0x3064};
  memcpy(code, thumb, sizeof(thumb));
  touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
  touchHLE_DynarmicWrapper_set_cpsr(cpu, 0x30);
  regs[15] = 0x1000; ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x23);
  assert(ticks == 98 && regs[0] == 5007 && regs[15] == 0x1004);
  // Mixed-width Thumb charges guest instructions, including one tick for a
  // wide instruction. Debugger stepping must also execute exactly one.
  const uint16_t wide[] = {0xf240, 0x002a, 0x3001, 0xdf24}; // movw; add; svc
  memcpy(code, wide, sizeof(wide));
  touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
  regs[15] = 0x1000;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, NULL) == -1);
  assert(regs[0] == 42 && regs[15] == 0x1004);
  regs[15] = 0x1000; ticks = 19;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x24);
  assert(ticks == 16 && regs[0] == 43 && regs[15] == 0x1008);
  // A page boundary splits Thumb IT from its conditional instruction. Budget
  // return must preserve the pending IT state before that next block executes.
  uint16_t *halves = (uint16_t *)code;
  halves[2047] = 0xbf08; halves[2048] = 0x202a; halves[2049] = 0xdf42;
  touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 8192);
  for (unsigned equal = 0; equal < 2; ++equal) {
    touchHLE_DynarmicWrapper_set_cpsr(cpu, 0x30 | (equal ? 0x40000000 : 0));
    regs[0] = 7; regs[15] = 0x1ffe; ticks = 1;
    assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == -1);
    assert(ticks == 0 && regs[15] == 0x2000 && regs[0] == 7);
    ticks = 100;
    assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
    assert(regs[0] == (equal ? 42 : 7) && regs[15] == 0x2004);
  }
  // A tiny abstract budget may overshoot by one translated block, but must
  // terminate even in a long-block infinite loop and saturate at zero ticks.
  for (unsigned i = 0; i < 512; i++) code[i] = 0xe2800001;
  code[512] = 0xeafffdfe;
  touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
  touchHLE_DynarmicWrapper_set_cpsr(cpu, 0x10);
  regs[0] = 0; regs[15] = 0x1000; ticks = 1;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == -1);
  assert(ticks == 0 && regs[0] > 0 && regs[0] <= 512);
  // VFP remains live across HLE calls and materializes on a context swap.
  const uint32_t vfp[] = {0xeeb70a00, 0xeef00a00, 0xee301a20, 0xee110a10, 0xef000042};
  memcpy(code, vfp, sizeof(vfp));
  touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
  regs[15] = 0x1000; ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
  assert(regs[0] == 0x40400000);
  Context other = { .cpsr = 0x10, .fpscr = 0x01000000 };
  other.regs[15] = 0x1000; other.extregs[0] = 0x40a00000;
  touchHLE_DynarmicWrapper_swap_context(cpu, &other);
  assert(other.extregs[0] == 0x3f800000 && other.extregs[2] == 0x40400000);
  code[0] = 0xee100a10; code[1] = 0xef000042; // vmov r0,s0; svc
  touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
  ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
  assert(regs[0] == 0x40a00000);
  // A second call must keep the active VFP state without reloading stale data.
  regs[15] = 0x1000; ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
  assert(regs[0] == 0x40a00000);
  touchHLE_DynarmicWrapper_swap_context(cpu, &other);
  assert(other.extregs[0] == 0x40a00000 && other.fpscr == 0x01000000);
  regs[15] = 0x1000; ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
  assert(regs[0] == 0x3f800000);
  // Fast aligned reads, unaligned fallback, and both mapping boundaries.
  code[0] = 0xe5910000; code[1] = 0xef000042; // ldr r0,[r1]; svc
  code[2046] = 0x44332211; code[2047] = 0x88776655;
  touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
  touchHLE_DynarmicWrapper_set_cpsr(cpu, 0x10);
  const uint32_t addresses[] = {0x1000, 0x2ffc, 0x2ff9, 0xfffff000, 0xfffffffc, 0xfffffff9};
  const uint32_t expected[] = {0xe5910000, 0x88776655, 0x55443322, 0x11223344, 0x88776655, 0x55443322};
  for (unsigned pass = 0; pass < 2; ++pass) {
    if (pass) assert(emscripten_resize_heap(emscripten_get_heap_size() + 64 * 1024 * 1024));
    for (unsigned i = 0; i < sizeof(addresses) / sizeof(addresses[0]); ++i) {
      for (unsigned hot = 0; hot < 64; ++hot) {
        regs[1] = addresses[i]; regs[15] = 0x1000; ticks = 100;
        assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
        assert(regs[0] == expected[i]);
      }
    }
  }
  const uint32_t invalid[] = {0, 0x3000, 0x2ffd};
  for (unsigned i = 0; i < 3; ++i) {
    regs[1] = invalid[i]; regs[15] = 0x1000; ticks = 100;
    assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == -2);
    assert(regs[15] == 0x1000);
  }
  // A hot store starts on a data page. Translating that page must immediately
  // force the same compiled store through Unicorn's code invalidation path.
  code[0] = 0xe5810000; code[1] = 0xef000042; // str r0,[r1]; svc
  touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
  for (unsigned i = 0; i < 64; ++i) {
    regs[0] = i; regs[1] = 0x2000; regs[15] = 0x1000; ticks = 100;
    assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
    assert(code[1024] == i);
  }
  code[1024] = 0xe3a00001; code[1025] = 0xef000043; // mov r0,#1; svc
  touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x2000, 4096);
  for (unsigned i = 0; i < 64; ++i) {
    regs[15] = 0x2000; ticks = 100;
    assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x43);
    assert(regs[0] == 1);
  }
  regs[0] = 0xe3a0002a; regs[1] = 0x2000; regs[15] = 0x1000; ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
  regs[15] = 0x2000; ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x43);
  assert(regs[0] == 42);
  for (unsigned i = 0; i < 3; ++i) {
    regs[1] = invalid[i]; regs[15] = 0x1000; ticks = 100;
    assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == -2);
    assert(regs[15] == 0x1000);
  }
  regs[0] = 0x76543210; regs[1] = 0xfffffffc; regs[15] = 0x1000; ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
  code[0] = 0xe5910000; // ldr r0,[r1]
  touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
  regs[15] = 0x1000; ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
  assert(regs[0] == 0x76543210);
  // Subword JIT reads: unsigned/signed, endpoint and unaligned fallback.
  code[2047] = 0x88776655;
  const uint32_t loads[] = {0xe5d10000, 0xe1d100d0, 0xe1d100b0, 0xe1d100f0, 0xe1d100b0};
  const uint32_t load_addresses[] = {0x2fff, 0x2fff, 0x2ffe, 0x2ffe, 0x2ffd};
  const uint32_t load_values[] = {0x88, 0xffffff88, 0x8877, 0xffff8877, 0x7766};
  for (unsigned i = 0; i < 5; ++i) {
    code[0] = loads[i];
    touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
    for (unsigned hot = 0; hot < 64; ++hot) {
      regs[1] = load_addresses[i]; regs[15] = 0x1000; ticks = 100;
      assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
      assert(regs[0] == load_values[i]);
    }
  }
  for (unsigned half = 0; half < 2; ++half) {
    code[0] = half ? 0xe1c100b0 : 0xe5c10000; // strh/strb r0,[r1]
    touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
    regs[0] = half ? 0x8001 : 0xfe; regs[1] = half ? 0xfffffffe : 0xffffffff;
    regs[15] = 0x1000; ticks = 100;
    assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
    // Reuse the same compiled subword store on an already translated page.
    regs[0] = half ? 44 : 43; regs[1] = 0x2000; regs[15] = 0x1000; ticks = 100;
    assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
    regs[15] = 0x2000; ticks = 100;
    assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x43);
    assert(regs[0] == (half ? 44 : 43));
    code[0] = half ? 0xe1d100f0 : 0xe1d100d0; // signed endpoint read
    touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
    regs[1] = half ? 0xfffffffe : 0xffffffff; regs[15] = 0x1000; ticks = 100;
    assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
    assert(regs[0] == (half ? 0xffff8001 : 0xfffffffe));
  }
  // Doubleword VFP loads preserve all bits, including NaN payloads. Exercise
  // the final mapped doubleword and an access crossing into unmapped memory.
  code[0] = 0xed920b00; // vldr d0,[r2]
  code[1] = 0xec510b10; // vmov r0,r1,d0
  code[2] = 0xef000042;
  touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
  for (unsigned trial = 0; trial < 64; ++trial) {
    unsigned offset = trial & 1 ? 2046 : 1536;
    code[offset] = 0x89abcdef; code[offset+1] = 0xfff81234;
    regs[2] = 0x1000 + offset * 4; regs[15] = 0x1000; ticks = 100;
    assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
    assert(regs[0] == 0x89abcdef && regs[1] == 0xfff81234);
  }
  regs[2] = 0x2ffc; regs[15] = 0x1000; ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == -2);
  assert(regs[15] == 0x1000);
  // CPSR mode changes bank r8-r14. The adapter's supplied register state must
  // remain authoritative, as with the original write-CPSR-then-write-registers ABI.
  code[0] = 0xef000042;
  touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
  const uint32_t modes[] = {0x13, 0x11, 0x10}; // supervisor, FIQ, user
  for (unsigned mode = 0; mode < 3; ++mode) {
    touchHLE_DynarmicWrapper_set_cpsr(cpu, modes[mode]);
    for (unsigned r = 8; r < 15; ++r) regs[r] = 0x12340000 + mode * 16 + r;
    regs[15] = 0x1000; ticks = 100;
    assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
    for (unsigned r = 8; r < 15; ++r) assert(regs[r] == 0x12340000 + mode * 16 + r);
  }
  touchHLE_DynarmicWrapper_delete(cpu);
  free(code);
}
