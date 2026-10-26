// SPDX-License-Identifier: MPL-2.0
#include <assert.h>
#include <emscripten/fiber.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unicorn/unicorn.h>

extern void run_shared_cpu_checks(void);
extern void adapter_checks(void);
extern void rust_memory_write(uint64_t, uint32_t, int64_t);
extern void rust_hle_callback(uc_engine *);
static unsigned traps;
static emscripten_fiber_t scheduler, guest;
static unsigned phase;
void scheduler_yield(void) {
  ++phase;
  emscripten_fiber_swap(&guest, &scheduler);
}
static void write_hook(uc_engine *cpu, uc_mem_type type, uint64_t addr,
                       int size, int64_t value, void *user) {
  (void)cpu; (void)type; (void)user;
  rust_memory_write(addr, size, value);
}
static uint32_t read_reg(uc_engine *cpu, int reg) {
  uint32_t value;
  assert(uc_reg_read(cpu, reg, &value) == UC_ERR_OK);
  return value;
}
static void write_reg(uc_engine *cpu, int reg, uint32_t value) {
  assert(uc_reg_write(cpu, reg, &value) == UC_ERR_OK);
}
static void interrupt_hook(uc_engine *cpu, uint32_t interrupt, void *user) {
  (void)user;
  assert(interrupt == 2 && read_reg(cpu, UC_ARM_REG_PC) == 0x1004);
  ++traps;
  assert(uc_emu_stop(cpu) == UC_ERR_OK);
}
static void continuing_interrupt_hook(uc_engine *cpu, uint32_t interrupt, void *user) {
  (void)user;
  assert(interrupt == 2 && read_reg(cpu, UC_ARM_REG_PC) == 0x1004);
  ++traps;
}
static uc_err execute(uc_engine *cpu, const void *code, size_t len, int thumb) {
  assert(uc_mem_write(cpu, 0x1000, code, len) == UC_ERR_OK);
  // Host-side writes must invalidate translated instructions before reuse.
  assert(uc_ctl_remove_cache(cpu, (uint64_t)0x1000, (uint64_t)0x2000) == UC_ERR_OK);
  return uc_emu_start(cpu, 0x1000 + thumb, 0x1000 + len, 0, 100);
}
uint32_t nested_guest(uc_engine *cpu) {
  uc_context *context;
  assert(uc_context_alloc(cpu, &context) == UC_ERR_OK);
  assert(uc_context_save(cpu, context) == UC_ERR_OK);
  const uint32_t nested[] = {0xe3a0002a}; // mov r0, #42
  assert(uc_mem_write(cpu, 0x1100, nested, sizeof(nested)) == UC_ERR_OK);
  assert(uc_ctl_remove_cache(cpu, (uint64_t)0x1100, (uint64_t)0x1104) == UC_ERR_OK);
  assert(uc_emu_start(cpu, 0x1100, 0x1104, 0, 10) == UC_ERR_OK);
  uint32_t result = read_reg(cpu, UC_ARM_REG_R0);
  assert(uc_context_restore(cpu, context) == UC_ERR_OK);
  assert(uc_context_free(context) == UC_ERR_OK);
  return result;
}
void cpu_checks(uint8_t *code, uint8_t *high) {
  traps = 0;
  uc_engine *cpu;
  assert(uc_open(UC_ARCH_ARM, UC_MODE_ARM, &cpu) == UC_ERR_OK);
  assert(uc_mem_map_ptr(cpu, 0x1000, 4096, UC_PROT_ALL, code) == UC_ERR_OK);
  assert(uc_mem_map_ptr(cpu, 0xfffff000, 4096, UC_PROT_ALL, high) == UC_ERR_OK);
  // Regression: instruction-count instrumentation can exhaust TCG temporaries
  // before its operation buffer fills on a 32-bit interpreter host.
  uint32_t long_block[512];
  for (unsigned i = 0; i < 512; ++i) long_block[i] = 0xe2800001;
  write_reg(cpu, UC_ARM_REG_R0, 0);
  assert(execute(cpu, long_block, sizeof(long_block), 0) == UC_ERR_OK);
  assert(read_reg(cpu, UC_ARM_REG_R0) == 100);
  const uint32_t arm[] = {0xe3a00007, 0xe2800005};
  assert(execute(cpu, arm, sizeof(arm), 0) == UC_ERR_OK);
  assert(read_reg(cpu, UC_ARM_REG_R0) == 12);
  const uint16_t thumb[] = {0x2007, 0x3005};
  assert(execute(cpu, thumb, sizeof(thumb), 1) == UC_ERR_OK);
  assert(read_reg(cpu, UC_ARM_REG_R0) == 12);
  write_reg(cpu, UC_ARM_REG_C1_C0_2, 0xf << 20);
  write_reg(cpu, UC_ARM_REG_FPEXC, 0x40000000);
  const uint32_t vfp[] = {0xeeb70a00, 0xeef00a00, 0xee301a20, 0xee110a10};
  assert(execute(cpu, vfp, sizeof(vfp), 0) == UC_ERR_OK);
  assert(read_reg(cpu, UC_ARM_REG_R0) == 0x40400000);
  uc_context *context;
  assert(uc_context_alloc(cpu, &context) == UC_ERR_OK);
  write_reg(cpu, UC_ARM_REG_FPSCR, 0x01000000);
  assert(uc_context_save(cpu, context) == UC_ERR_OK);
  write_reg(cpu, UC_ARM_REG_R0, 0);
  write_reg(cpu, UC_ARM_REG_FPSCR, 0);
  assert(uc_context_restore(cpu, context) == UC_ERR_OK);
  assert(read_reg(cpu, UC_ARM_REG_R0) == 0x40400000);
  assert(read_reg(cpu, UC_ARM_REG_FPSCR) == 0x01000000);
  assert(uc_context_free(context) == UC_ERR_OK);
  uc_hook write, interrupt;
  assert(uc_hook_add(cpu, &write, UC_HOOK_MEM_WRITE, write_hook, NULL, 1, 0) == UC_ERR_OK);
  write_reg(cpu, UC_ARM_REG_R0, 123);
  write_reg(cpu, UC_ARM_REG_R1, 0xfffffffc);
  const uint32_t store[] = {0xe5810000, 0xe5912000};
  assert(execute(cpu, store, sizeof(store), 0) == UC_ERR_OK);
  assert(read_reg(cpu, UC_ARM_REG_R2) == 123);
  assert(uc_hook_add(cpu, &interrupt, UC_HOOK_INTR, interrupt_hook, NULL, 1, 0) == UC_ERR_OK);
  const uint32_t svc[] = {0xef000042, 0xe3a00009};
  assert(execute(cpu, svc, sizeof(svc), 0) == UC_ERR_OK);
  assert(traps == 1);
  // Normal SVC exits now unwind through WASM-native longjmp. Exercise repeated
  // catch/resume before the Rust callback suspends and reenters this fiber.
  for (unsigned i = 0; i < 1000; ++i)
    assert(uc_emu_start(cpu, 0x1000, 0x1008, 0, 100) == UC_ERR_OK);
  assert(traps == 1001);
  rust_hle_callback(cpu);
  assert(read_reg(cpu, UC_ARM_REG_PC) == 0x1004);
  assert(uc_emu_start(cpu, read_reg(cpu, UC_ARM_REG_PC), 0x1008, 0, 10) == UC_ERR_OK);
  assert(read_reg(cpu, UC_ARM_REG_R0) == 9);
  write_reg(cpu, UC_ARM_REG_R1, 0x4000);
  const uint32_t load[] = {0xe5910000};
  assert(execute(cpu, load, sizeof(load), 0) == UC_ERR_READ_UNMAPPED);
  const uint32_t loop[] = {0xeafffffe};
  assert(execute(cpu, loop, sizeof(loop), 0) == UC_ERR_OK);
  assert(read_reg(cpu, UC_ARM_REG_PC) == 0x1000);
  assert(uc_hook_del(cpu, interrupt) == UC_ERR_OK);
  // SVC's ordinary TB return must still support an unhandled exception and a
  // callback that continues execution, not just the HLE's stop-on-SVC path.
  assert(execute(cpu, svc, sizeof(svc), 0) == UC_ERR_EXCEPTION);
  assert(uc_hook_add(cpu, &interrupt, UC_HOOK_INTR, continuing_interrupt_hook,
                     NULL, 1, 0) == UC_ERR_OK);
  assert(execute(cpu, svc, sizeof(svc), 0) == UC_ERR_OK);
  assert(read_reg(cpu, UC_ARM_REG_R0) == 9 && traps == 1002);
  const uint32_t conditional_svc[] = {0xe3a00000, 0xe3500000, 0x1f000042, 0xe3a00009};
  assert(execute(cpu, conditional_svc, sizeof(conditional_svc), 0) == UC_ERR_OK);
  assert(read_reg(cpu, UC_ARM_REG_R0) == 9 && traps == 1002);
  assert(uc_hook_del(cpu, interrupt) == UC_ERR_OK);
  assert(uc_hook_del(cpu, write) == UC_ERR_OK);
  assert(uc_close(cpu) == UC_ERR_OK);
}
static void guest_entry(void *unused) {
  (void)unused;
  adapter_checks();
  run_shared_cpu_checks();
  scheduler_yield();
  abort();
}
int main(void) {
  const size_t size = 256 * 1024;
  void *main_async = malloc(size), *guest_async = malloc(size), *stack = malloc(size);
  assert(main_async && guest_async && stack);
  emscripten_fiber_init_from_current_context(&scheduler, main_async, size);
  for (unsigned round = 0; round < 10; ++round) {
    phase = 0;
    emscripten_fiber_init(&guest, guest_entry, NULL, stack, size, guest_async, size);
    for (unsigned expected = 1; expected <= 3; ++expected) {
      emscripten_fiber_swap(&scheduler, &guest);
      assert(phase == expected);
    }
  }
  free(stack); free(guest_async); free(main_async);
  puts("PASS source-built Unicorn/Rust shared memory, ARM, Thumb, VFP, FPSCR contexts, callbacks, SVC, faults, budgets and nested ARM/host fiber reentry");
  return 0;
}
