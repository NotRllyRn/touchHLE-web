// SPDX-License-Identifier: MPL-2.0
// Unicorn backend implementing the existing CPU adapter ABI; native Dynarmic
// symbols are kept at this boundary to avoid changing framework call sites.
#include <unicorn/unicorn.h>
#include <stdint.h>
#include <stdlib.h>
#include <assert.h>
#include <string.h>
#include <stdio.h>
typedef struct { uint32_t regs[16], extregs[64], cpsr, fpscr; } Context;
typedef struct { uc_engine *uc; Context context; int result; int mapped; uint64_t executed; size_t budget; int stepping; } Cpu;
extern void touchHLE_web_map_memory(void *mem, Cpu *cpu);
extern size_t touchHLE_uc_executed(uc_engine *uc);
static const int registers[] = {UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3,
 UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6,UC_ARM_REG_R7,UC_ARM_REG_R8,UC_ARM_REG_R9,
 UC_ARM_REG_R10,UC_ARM_REG_R11,UC_ARM_REG_R12,UC_ARM_REG_SP,UC_ARM_REG_LR,UC_ARM_REG_PC};
static void block(uc_engine *uc, uint64_t address, uint32_t size, void *user) {
  (void)address;
  Cpu *cpu = user;
  if (cpu->stepping) return;
  if (cpu->executed >= cpu->budget) {
    uc_emu_stop(uc);
    return;
  }
  // The adapter ABI defines ticks as an abstract time budget, as on native
  // Dynarmic. Charge a translated block before executing it; at most one
  // block can overshoot. Thumb-2 instructions conservatively cost two ticks.
  // Single stepping still uses Unicorn's exact instruction-count mechanism.
  uint32_t cpsr;
  assert(uc_reg_read(uc, UC_ARM_REG_CPSR, &cpsr) == UC_ERR_OK);
  unsigned ticks = size / ((cpsr & 0x20) ? 2 : 4);
  cpu->executed += ticks ? ticks : 1;
}
static bool invalid_memory(uc_engine *uc, uc_mem_type type, uint64_t address,
                           int size, int64_t value, void *user) {
  (void)value; (void)user;
  uint32_t pc, lr;
  uc_reg_read(uc, UC_ARM_REG_PC, &pc);
  uc_reg_read(uc, UC_ARM_REG_LR, &lr);
  fprintf(stderr, "Guest memory fault: type=%d address=0x%llx size=%d PC=0x%x LR=0x%x\n",
          type, (unsigned long long)address, size, pc, lr);
  return false;
}
static void interrupt(uc_engine *uc, uint32_t number, void *user) {
  Cpu *cpu = user;
  uint32_t pc, cpsr, instruction = 0;
  uc_reg_read(uc, UC_ARM_REG_PC, &pc);
  uc_reg_read(uc, UC_ARM_REG_CPSR, &cpsr);
  unsigned size = (cpsr & 0x20) ? 2 : 4;
  if (number == 2 && uc_mem_read(uc, pc-size, &instruction, size) == UC_ERR_OK)
    cpu->result = instruction & (size == 2 ? 0xff : 0xffffff);
  else cpu->result = -4;
  uc_emu_stop(uc);
}
Cpu *touchHLE_DynarmicWrapper_new(void *unused, size_t null_pages) {
  (void)unused; (void)null_pages;
  Cpu *cpu = calloc(1, sizeof(Cpu)); assert(cpu);
  assert(uc_open(UC_ARCH_ARM, UC_MODE_ARM, &cpu->uc) == UC_ERR_OK);
  uint32_t cpacr = 0xf << 20, fpexc = 0x40000000;
  assert(uc_reg_write(cpu->uc, UC_ARM_REG_C1_C0_2, &cpacr) == UC_ERR_OK);
  assert(uc_reg_write(cpu->uc, UC_ARM_REG_FPEXC, &fpexc) == UC_ERR_OK);
  uc_hook hook;
  assert(uc_hook_add(cpu->uc, &hook, UC_HOOK_INTR, interrupt, cpu, 1, 0) == UC_ERR_OK);
  assert(uc_hook_add(cpu->uc, &hook, UC_HOOK_BLOCK, block, cpu, 1, 0) == UC_ERR_OK);
  assert(uc_hook_add(cpu->uc, &hook, UC_HOOK_MEM_INVALID, invalid_memory, cpu, 1, 0) == UC_ERR_OK);
  cpu->context.cpsr = 0x10;
  return cpu;
}
void touchHLE_web_map(Cpu *cpu, uint32_t base, size_t len, void *pointer) {
  assert(uc_mem_map_ptr(cpu->uc, base, len, UC_PROT_ALL, pointer) == UC_ERR_OK);
}
void touchHLE_DynarmicWrapper_delete(Cpu *cpu) { uc_close(cpu->uc); free(cpu); }
const uint32_t *touchHLE_DynarmicWrapper_regs_const(const Cpu *cpu) { return cpu->context.regs; }
uint32_t *touchHLE_DynarmicWrapper_regs_mut(Cpu *cpu) { return cpu->context.regs; }
uint32_t touchHLE_DynarmicWrapper_cpsr(const Cpu *cpu) { return cpu->context.cpsr; }
void touchHLE_DynarmicWrapper_set_cpsr(Cpu *cpu, uint32_t value) { cpu->context.cpsr = value; }
void touchHLE_DynarmicWrapper_swap_context(Cpu *cpu, Context *context) {
  Context temporary = cpu->context; cpu->context = *context; *context = temporary;
}
void touchHLE_DynarmicWrapper_invalidate_cache_range(Cpu *cpu, uint32_t start, uint32_t size) {
  if (cpu->mapped) assert(uc_ctl_remove_cache(cpu->uc, (uint64_t)start, (uint64_t)start + size) == UC_ERR_OK);
}
int32_t touchHLE_DynarmicWrapper_run_or_step(Cpu *cpu, void *mem, uint64_t *ticks) {
  if (!cpu->mapped) { touchHLE_web_map_memory(mem, cpu); cpu->mapped = 1; }
  Context *c = &cpu->context;
  assert(uc_reg_write(cpu->uc, UC_ARM_REG_CPSR, &c->cpsr) == UC_ERR_OK);
  for (int i = 0; i < 15; ++i) assert(uc_reg_write(cpu->uc, registers[i], &c->regs[i]) == UC_ERR_OK);
  for (int i = 0; i < 32; ++i) assert(uc_reg_write(cpu->uc, UC_ARM_REG_D0+i, &c->extregs[i*2]) == UC_ERR_OK);
  assert(uc_reg_write(cpu->uc, UC_ARM_REG_FPSCR, &c->fpscr) == UC_ERR_OK);
  size_t budget = ticks ? (*ticks > 10000 ? 10000 : *ticks) : 1;
  if (!budget) return -1;
  cpu->result = -1;
  cpu->executed = 0;
  cpu->budget = budget;
  // Unicorn's count hook is compiled into translated blocks. A block cached
  // during normal execution cannot provide exact stepping without a flush.
  if (cpu->stepping != !ticks) assert(uc_ctl_flush_tb(cpu->uc) == UC_ERR_OK);
  cpu->stepping = !ticks;
  uc_err error = uc_emu_start(cpu->uc, c->regs[15] | ((c->cpsr & 0x20) ? 1 : 0), 0, 0, ticks ? 0 : 1);
  if (!ticks) cpu->executed = touchHLE_uc_executed(cpu->uc);
  if (ticks) *ticks -= cpu->executed > budget ? budget : cpu->executed;
  for (int i = 0; i < 16; ++i) assert(uc_reg_read(cpu->uc, registers[i], &c->regs[i]) == UC_ERR_OK);
  for (int i = 0; i < 32; ++i) assert(uc_reg_read(cpu->uc, UC_ARM_REG_D0+i, &c->extregs[i*2]) == UC_ERR_OK);
  assert(uc_reg_read(cpu->uc, UC_ARM_REG_CPSR, &c->cpsr) == UC_ERR_OK);
  assert(uc_reg_read(cpu->uc, UC_ARM_REG_FPSCR, &c->fpscr) == UC_ERR_OK);
  if (error == UC_ERR_INSN_INVALID) return -3;
  if (error != UC_ERR_OK) {
    fprintf(stderr, "Unicorn: %s at PC=0x%x LR=0x%x CPSR=0x%x\n",
            uc_strerror(error), c->regs[15], c->regs[14], c->cpsr);
    return -2;
  }
  return cpu->result;
}
