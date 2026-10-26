// SPDX-License-Identifier: MPL-2.0
// Exercise cache lifetime through actual guest stores and memory-map changes.
#include <assert.h>
#include <stdint.h>
#include <unicorn/unicorn.h>
static void reg(uc_engine *cpu, int id, uint32_t value) {
  assert(uc_reg_write(cpu, id, &value) == UC_ERR_OK);
}
static uint32_t r0(uc_engine *cpu) {
  uint32_t value;
  assert(uc_reg_read(cpu, UC_ARM_REG_R0, &value) == UC_ERR_OK);
  return value;
}
static void stop_read(uc_engine *cpu, uc_mem_type type, uint64_t address,
                      int size, int64_t value, void *user) {
  (void)type; (void)address; (void)size; (void)value;
  ++*(unsigned *)user;
  assert(uc_emu_stop(cpu) == UC_ERR_OK);
}
void cache_checks(void) {
  uc_engine *cpu;
  assert(uc_open(UC_ARCH_ARM, UC_MODE_ARM, &cpu) == UC_ERR_OK);
  assert(uc_mem_map(cpu, 0x1000, 0x4000, UC_PROT_ALL) == UC_ERR_OK);
  uint32_t instruction = 0xe3a00001; // mov r0,#1
  assert(uc_mem_write(cpu, 0x1000, &instruction, 4) == UC_ERR_OK);
  for (unsigned i = 0; i < 64; ++i) {
    reg(cpu, UC_ARM_REG_R0, 0);
    assert(uc_emu_start(cpu, 0x1000, 0x1004, 0, 0) == UC_ERR_OK);
    assert(r0(cpu) == 1);
  }
  instruction = 0xe5821000; // str r1,[r2]
  assert(uc_mem_write(cpu, 0x2000, &instruction, 4) == UC_ERR_OK);
  reg(cpu, UC_ARM_REG_R1, 0xe3a0002a); reg(cpu, UC_ARM_REG_R2, 0x1000);
  // Guest store must invalidate the compiled function without a host flush.
  assert(uc_emu_start(cpu, 0x2000, 0x2004, 0, 0) == UC_ERR_OK);
  for (unsigned i = 0; i < 64; ++i) {
    assert(uc_emu_start(cpu, 0x1000, 0x1004, 0, 0) == UC_ERR_OK);
    assert(r0(cpu) == 42);
  }
  assert(uc_mem_protect(cpu, 0x1000, 4096, UC_PROT_READ | UC_PROT_EXEC) == UC_ERR_OK);
  assert(uc_emu_start(cpu, 0x2000, 0x2004, 0, 0) == UC_ERR_WRITE_PROT);
  assert(uc_mem_protect(cpu, 0x1000, 4096, UC_PROT_ALL) == UC_ERR_OK);
  assert(uc_emu_start(cpu, 0x2000, 0x2004, 0, 0) == UC_ERR_OK);

  instruction = 0xe5910000; // ldr r0,[r1]
  assert(uc_mem_write(cpu, 0x2000, &instruction, 4) == UC_ERR_OK);
  assert(uc_ctl_remove_cache(cpu, (uint64_t)0x2000, (uint64_t)0x2004) == UC_ERR_OK);
  reg(cpu, UC_ARM_REG_R1, 0x3000);
  uint32_t value = 123;
  assert(uc_mem_write(cpu, 0x3000, &value, 4) == UC_ERR_OK);
  for (unsigned i = 0; i < 64; ++i) {
    assert(uc_emu_start(cpu, 0x2000, 0x2004, 0, 0) == UC_ERR_OK);
    assert(r0(cpu) == 123);
  }
  assert(uc_mem_unmap(cpu, 0x3000, 4096) == UC_ERR_OK);
  assert(uc_emu_start(cpu, 0x2000, 0x2004, 0, 0) == UC_ERR_READ_UNMAPPED);
  assert(uc_mem_map(cpu, 0x3000, 4096, UC_PROT_ALL) == UC_ERR_OK);
  value = 456;
  assert(uc_mem_write(cpu, 0x3000, &value, 4) == UC_ERR_OK);
  assert(uc_emu_start(cpu, 0x2000, 0x2004, 0, 0) == UC_ERR_OK);
  assert(r0(cpu) == 456);
  value = 0x44332211;
  assert(uc_mem_write(cpu, 0x3ffe, &value, 4) == UC_ERR_OK);
  reg(cpu, UC_ARM_REG_R1, 0x3ffe);
  assert(uc_emu_start(cpu, 0x2000, 0x2004, 0, 0) == UC_ERR_OK);
  assert(r0(cpu) == value);
  assert(uc_mem_unmap(cpu, 0x4000, 4096) == UC_ERR_OK);
  assert(uc_emu_start(cpu, 0x2000, 0x2004, 0, 0) == UC_ERR_READ_UNMAPPED);
  // A valid-memory callback can request a stop after an otherwise valid load.
  // The compiled post-access check must take the real exit path before ADD.
  const uint32_t stop_code[] = {0xe5910000, 0xe2822001}; // ldr r0,[r1]; add r2,#1
  assert(uc_mem_write(cpu, 0x2000, stop_code, sizeof(stop_code)) == UC_ERR_OK);
  reg(cpu, UC_ARM_REG_R1, 0x3000); reg(cpu, UC_ARM_REG_R2, 0);
  unsigned calls = 0;
  uc_hook hook;
  assert(uc_hook_add(cpu, &hook, UC_HOOK_MEM_READ, stop_read, &calls, 1, 0) == UC_ERR_OK);
  assert(uc_ctl_flush_tb(cpu) == UC_ERR_OK);
  for (unsigned i = 0; i < 64; ++i) {
    assert(uc_emu_start(cpu, 0x2000, 0x2008, 0, 0) == UC_ERR_OK);
    uint32_t r2;
    assert(uc_reg_read(cpu, UC_ARM_REG_R2, &r2) == UC_ERR_OK);
    assert(r2 == 0 && calls == i + 1);
  }
  assert(uc_hook_del(cpu, hook) == UC_ERR_OK);
  assert(uc_ctl_flush_tb(cpu) == UC_ERR_OK);
  assert(uc_emu_start(cpu, 0x2000, 0x2008, 0, 0) == UC_ERR_OK);
  uint32_t r2;
  assert(uc_reg_read(cpu, UC_ARM_REG_R2, &r2) == UC_ERR_OK);
  assert(r2 == 1 && calls == 64);
  assert(uc_close(cpu) == UC_ERR_OK);
}
