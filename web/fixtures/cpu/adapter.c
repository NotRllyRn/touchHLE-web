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
  touchHLE_web_map(cpu, 0x30000000, 4096, (uint32_t *)mem + 3072);
  touchHLE_web_map(cpu, 0x30001000, 4096, (uint32_t *)mem + 5120);
  touchHLE_web_map(cpu, 0x3748a000, 4096, (uint32_t *)mem + 4096);
}
void adapter_checks(void) {
  uint32_t *code = calloc(1, 24576);
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
  // Preserve full ARM immediates and Thumb width at mapped page ends.
  for (unsigned thumb_mode = 0; thumb_mode < 2; ++thumb_mode) {
    unsigned size = thumb_mode ? 2 : 4;
    touchHLE_DynarmicWrapper_set_cpsr(cpu, thumb_mode ? 0x30 : 0x10);
    for (unsigned page = 1; page <= 2; ++page) for (unsigned variant = 0; variant < 2; ++variant) {
      uint32_t immediate = thumb_mode ? (variant ? 0xff : 0x80) : (variant ? 0xffffff : 0xabcdef);
      uint32_t instruction = (thumb_mode ? 0xdf00 : 0xef000000) | immediate;
      memcpy((uint8_t *)code + page * 4096 - size, &instruction, size);
      touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, page * 4096, 4096);
      regs[15] = (page + 1) * 4096 - size; ticks = 100;
      assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == (int32_t)immediate);
      assert(regs[15] == (page + 1) * 4096 && ticks == 99);
    }
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
    const unsigned offsets[] = {1536,1537,2046,1023};
    unsigned offset = offsets[trial % 4];
    code[offset] = 0x89abcdef; code[offset+1] = 0xfff81234;
    regs[2] = 0x1000 + offset * 4; regs[15] = 0x1000; ticks = 100;
    assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
    assert(regs[0] == 0x89abcdef && regs[1] == 0xfff81234);
  }
  regs[2] = 0x2ffc; regs[15] = 0x1000; ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == -2);
  assert(regs[15] == 0x1000);
  // Doubleword stores use a fresh engine so the data page starts untranslated.
  // Reusing it for executable code must then force normal invalidation.
  Cpu *store_cpu = touchHLE_DynarmicWrapper_new(NULL, 1);
  uint32_t *store_regs = touchHLE_DynarmicWrapper_regs_mut(store_cpu);
  code[0] = 0xec410b10; // vmov d0,r0,r1
  code[1] = 0xed820b00; // vstr d0,[r2]
  code[2] = 0xef000042;
  for (unsigned trial = 0; trial < 64; ++trial) {
    const unsigned offsets[] = {1536,1537,2046,1023};
    unsigned offset = offsets[trial % 4];
    store_regs[0] = 0x89abcdef; store_regs[1] = 0xfff81234;
    store_regs[2] = 0x1000 + offset * 4; store_regs[15] = 0x1000; ticks = 100;
    assert(touchHLE_DynarmicWrapper_run_or_step(store_cpu, code, &ticks) == 0x42);
    assert(code[offset] == 0x89abcdef && code[offset+1] == 0xfff81234);
  }
  code[1024] = 0xe3a0002a; code[1025] = 0xef000043;
  store_regs[15] = 0x2000; ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(store_cpu, code, &ticks) == 0x43);
  assert(store_regs[0] == 42);
  store_regs[0] = 0xe3a00063; store_regs[1] = 0xef000043;
  store_regs[2] = 0x2000; store_regs[15] = 0x1000; ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(store_cpu, code, &ticks) == 0x42);
  store_regs[15] = 0x2000; ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(store_cpu, code, &ticks) == 0x43);
  assert(store_regs[0] == 99);
  store_regs[2] = 0x2ffc; store_regs[15] = 0x1000; ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(store_cpu, code, &ticks) == -2);
  assert(store_regs[15] == 0x1004);
  touchHLE_DynarmicWrapper_delete(store_cpu);
  // Smaller library mappings in the same address-space half as low RAM.
  code[0] = 0xe5920000; code[1] = 0xe2800001; // ldr r0,[r2]; add r0,#1
  code[2] = 0xe5820000; code[3] = 0xef000042; // str r0,[r2]; svc
  touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
  const uint32_t library_bases[] = {0x30000000,0x3748a000};
  for (unsigned trial = 0; trial < 64; ++trial) {
    unsigned offset = trial & 1 ? 4096 : 3072;
    code[offset+1023] = trial;
    regs[2] = library_bases[trial&1]+4092; regs[15] = 0x1000; ticks = 100;
    assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
    assert(regs[0] == trial+1 && code[offset+1023] == trial+1);
  }
  // Adjacent guest pages are deliberately nonadjacent in host storage.
  code[4095] = 0x89abcdef; code[5120] = 0xfff81234;
  code[0] = 0xed920b00; code[1] = 0xec510b10; code[2] = 0xef000042;
  touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
  regs[2] = 0x30000ffc; regs[15] = 0x1000; ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
  assert(regs[0] == 0x89abcdef && regs[1] == 0xfff81234);
  regs[2] = 0x30001ffc; regs[15] = 0x1000; ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == -2);
  assert(regs[15] == 0x1000);
  // Crossing store: only the second page has translated code. The helper
  // must invalidate that page even though the starting page is ordinary data.
  code[5120] = 0xe3a0002a; code[5121] = 0xef000043;
  regs[15] = 0x30001000; ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x43);
  assert(regs[0] == 42);
  code[0] = 0xec410b10; code[1] = 0xed820b00; code[2] = 0xef000042;
  touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
  regs[0] = 0x89abcdef; regs[1] = 0xe3a00063;
  regs[2] = 0x30000ffc; regs[15] = 0x1000; ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
  assert(code[4095] == 0x89abcdef && code[5120] == 0xe3a00063);
  regs[15] = 0x30001000; ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x43);
  assert(regs[0] == 99);
  code[3072] = 0xe3a0002a; code[3073] = 0xef000043;
  regs[15] = 0x30000000; ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x43);
  assert(regs[0] == 42);
  code[0] = 0xe5820000; code[1] = 0xef000042;
  touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
  regs[0] = 0xe3a00063; regs[2] = 0x30000000; regs[15] = 0x1000; ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
  regs[15] = 0x30000000; ticks = 100;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x43);
  assert(regs[0] == 99);
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
  // Pin exact result bits and FPSCR against the unmodified software-float
  // implementation, including all ARM rounding modes, FZ/DN and sticky flags.
  const uint32_t fp_ops[] = {0xee301a20, 0xee301a60, 0xee201a20, 0xee801a20}; // add/sub/mul/div s2,s0,s1
  const uint32_t edge[] = {0,0x80000000,0x3f800000,0xbf800000,0x40000000,
    0xc0000000,0x00800000,0x80800000,0x7f7fffff,0xff7fffff,1,0x80000001,
    0x007fffff,0x807fffff,0x7f800000,0xff800000,0x7fc12345,0xffc12345,0x7f812345,0xff812345};
  // VNEG/VABS are raw sign operations even for signaling NaNs and FZ/DN modes.
  for (unsigned unary = 0; unary < 2; ++unary) {
    code[0] = 0xee000a10; code[1] = 0xeee12a10; // vmov s0,r0; vmsr fpscr,r2
    code[2] = unary ? 0xeeb00ac0 : 0xeeb10a40; // vabs/vneg s0,s0
    code[3] = 0xee100a10; code[4] = 0xeef11a10; code[5] = 0xef000042;
    touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
    for (unsigned mode = 0; mode < 32; ++mode) for (unsigned i = 0; i < sizeof(edge)/sizeof(*edge); ++i) {
      uint32_t fpscr = ((mode & 3) << 22) | ((mode & 4) << 22) |
                       ((mode & 8) << 22) | (mode & 16 ? 0x9f : 0);
      regs[0] = edge[i]; regs[2] = fpscr; regs[15] = 0x1000; ticks = 100;
      assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
      assert(regs[0] == (unary ? edge[i] & 0x7fffffff : edge[i] ^ 0x80000000));
      assert(regs[1] == fpscr);
    }
  }
  for (unsigned op = 0; op < 4; ++op) {
    code[0] = 0xee000a10; code[1] = 0xee001a90; // vmov s0,r0; vmov s1,r1
    code[2] = 0xeee12a10; code[3] = fp_ops[op]; // vmsr fpscr,r2; operation
    code[4] = 0xee110a10; code[5] = 0xeef11a10; code[6] = 0xef000042;
    touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
    const uint32_t simple[] = {0x40400000,0xbf800000,0x40000000,0x3f000000};
    regs[0] = 0x3f800000; regs[1] = 0x40000000; regs[2] = 0;
    regs[15] = 0x1000; ticks = 100;
    assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
    assert(regs[0] == simple[op] && regs[1] == 0);
    // Precision-gate boundaries and nearest-even ties must preserve FPSCR.
    if (op < 2) {
      const unsigned gaps[] = {24, 29, 30, 100};
      for (unsigned i = 0; i < 4; ++i) {
        regs[0] = 0x3f800000; regs[1] = (127 - gaps[i]) << 23; regs[2] = 0;
        regs[15] = 0x1000; ticks = 100;
        assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
        assert(regs[0] == (op == 1 && gaps[i] == 24 ? 0x3f7fffff : 0x3f800000));
        assert(regs[1] == (op == 1 && gaps[i] == 24 ? 0 : 0x10));
      }
    } else if (op == 2) {
      regs[0] = regs[1] = 0x3f800001; regs[2] = 0;
      regs[15] = 0x1000; ticks = 100;
      assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
      assert(regs[0] == 0x3f800002 && regs[1] == 0x10);
    }
    for (unsigned mode = 0; mode < 32; ++mode) for (unsigned pair = 0; pair < 3; ++pair) {
      uint32_t fpscr = ((mode & 3) << 22) | ((mode & 4) << 22) |
                       ((mode & 8) << 22) | (mode & 16 ? 0x9f : 0);
      regs[0] = pair == 1 ? 0 : 0x7fc00000;
      regs[1] = pair == 2 ? 0 : 0x7fc00000; regs[2] = fpscr;
      regs[15] = 0x1000; ticks = 100;
      assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
      assert(regs[0] == 0x7fc00000 && regs[1] == fpscr);
    }
    uint32_t hash = 2166136261u, seed = 0x12345678;
    for (unsigned mode = 0; mode < 32; ++mode) for (unsigned item = 0; item < 512; ++item) {
      seed = seed * 1664525u + 1013904223u;
      regs[0] = item < 400 ? edge[item / 20] : seed;
      seed = seed * 1664525u + 1013904223u;
      regs[1] = item < 400 ? edge[item % 20] : seed;
      regs[2] = ((mode & 3) << 22) | ((mode & 4) << 22) | ((mode & 8) << 22) | (mode & 16 ? 0x9f : 0);
      regs[15] = 0x1000; ticks = 100;
      assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
      hash = (hash ^ regs[0]) * 16777619u;
      hash = (hash ^ regs[1]) * 16777619u;
    }
    const uint32_t reference[] = {0x3e25bbf3,0xfa74602e,0x4a539c72,0x4803deb0};
    assert(hash == reference[op]);
  }
  touchHLE_DynarmicWrapper_delete(cpu);
  free(code);
}
