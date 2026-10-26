// SPDX-License-Identifier: MPL-2.0
// Exercise the production adapter, including its tick accounting and stepping.
#include <assert.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
typedef struct Cpu Cpu;
extern Cpu *touchHLE_DynarmicWrapper_new(void *, size_t);
extern void touchHLE_DynarmicWrapper_delete(Cpu *);
extern uint32_t *touchHLE_DynarmicWrapper_regs_mut(Cpu *);
extern void touchHLE_DynarmicWrapper_set_cpsr(Cpu *, uint32_t);
extern void touchHLE_DynarmicWrapper_invalidate_cache_range(Cpu *, uint32_t, uint32_t);
extern int32_t touchHLE_DynarmicWrapper_run_or_step(Cpu *, void *, uint64_t *);
extern void touchHLE_web_map(Cpu *, uint32_t, size_t, void *);
void touchHLE_web_map_memory(void *mem, Cpu *cpu) {
  touchHLE_web_map(cpu, 0x1000, 4096, mem);
}
void adapter_checks(void) {
  uint32_t *code = calloc(1, 4096);
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
  // Mixed-width Thumb charges halfwords conservatively, but stepping a wide
  // instruction must still execute exactly one instruction.
  const uint16_t wide[] = {0xf240, 0x002a, 0x3001, 0xdf24}; // movw; add; svc
  memcpy(code, wide, sizeof(wide));
  touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
  regs[15] = 0x1000;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, NULL) == -1);
  assert(regs[0] == 42 && regs[15] == 0x1004);
  regs[15] = 0x1000; ticks = 19;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x24);
  assert(ticks == 15 && regs[0] == 43 && regs[15] == 0x1008);
  // A tiny abstract budget may overshoot by one translated block, but must
  // terminate even in a long-block infinite loop and saturate at zero ticks.
  for (unsigned i = 0; i < 512; i++) code[i] = 0xe2800001;
  code[512] = 0xeafffdfe;
  touchHLE_DynarmicWrapper_invalidate_cache_range(cpu, 0x1000, 4096);
  touchHLE_DynarmicWrapper_set_cpsr(cpu, 0x10);
  regs[0] = 0; regs[15] = 0x1000; ticks = 1;
  assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == -1);
  assert(ticks == 0 && regs[0] > 0 && regs[0] <= 512);
  touchHLE_DynarmicWrapper_delete(cpu);
  free(code);
}
