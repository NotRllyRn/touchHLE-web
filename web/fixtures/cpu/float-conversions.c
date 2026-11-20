// SPDX-License-Identifier: MPL-2.0
// Original exact/inexact conversion fixture, no proprietary guest code.
#include <unicorn/unicorn.h>
#include <unicorn/arm.h>
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
static void write_reg(uc_engine *uc, int reg, uint32_t value) {
  assert(uc_reg_write(uc, reg, &value) == UC_ERR_OK);
}
static uint32_t read_reg(uc_engine *uc, int reg) {
  uint32_t value; assert(uc_reg_read(uc, reg, &value) == UC_ERR_OK); return value;
}
void float_conversion_checks(void) {
  uc_engine *uc; assert(uc_open(UC_ARCH_ARM, UC_MODE_ARM, &uc) == UC_ERR_OK);
  assert(uc_mem_map(uc, 0x1000, 4096, UC_PROT_ALL) == UC_ERR_OK);
  // Assembled from conversion.s; verified against the assembler before use.
  const uint32_t code[] = {0xec410b10,0xeeb71bc0,0xeebd1ac1,0xee110a10,0xeef11a10};
  assert(uc_mem_write(uc, 0x1000, code, sizeof(code)) == UC_ERR_OK);
  write_reg(uc, UC_ARM_REG_C1_C0_2, 0xf << 20);
  write_reg(uc, UC_ARM_REG_FPEXC, 0x40000000);
  // First execution initializes the native-to-JS registration bridge. Keep it
  // separate so every reported case has the same compilation opportunity.
  write_reg(uc, UC_ARM_REG_R0, 0);
  write_reg(uc, UC_ARM_REG_R1, 0x3ff00000);
  assert(uc_emu_start(uc,0x1000,0x1014,0,0)==UC_ERR_OK);
  assert(read_reg(uc,UC_ARM_REG_R0)==1);
  const uint64_t inputs[] = {
    0,0x8000000000000000ULL,0x3ff0000000000000ULL,0xbff0000000000000ULL,
    0x3ff0000000000001ULL,0x3ff0000010000000ULL,0x3ff0000030000000ULL,
    0x3ff0000020000000ULL,0x4008000000000000ULL,0x41dfffffffc00000ULL,
    0x3810000000000000ULL,0x380fffffe0000000ULL,0x380fffffffffffffULL,
    0x36a0000000000000ULL,0x3690000000000000ULL,1,0x000fffffffffffffULL,
    0x47efffffe0000000ULL,0x47efffffe0000001ULL,0x47effffff0000000ULL,
    0x47f0000000000000ULL,0x7fefffffffffffffULL,0x7ff0000000000000ULL,
    0xfff0000000000000ULL,0x7ff8000000000000ULL,0x7ff0000000000001ULL,
    0x7ff8123456789000ULL,0xfff8123456789000ULL
  };
  unsigned cases=0;
  for(unsigned mode=0;mode<16;mode++) for(unsigned sticky=0;sticky<3;sticky++) {
    const uint32_t flags=(mode&3)<<22 | ((mode>>2)&1)<<24 | ((mode>>3)&1)<<25 |
      (sticky==1?0x10:sticky==2?0x9f:0);
    for(unsigned i=0;i<sizeof(inputs)/sizeof(*inputs);i++) for(unsigned sign=0;sign<2;sign++) {
      uint64_t value=inputs[i] ^ ((uint64_t)sign<<63);
      write_reg(uc, UC_ARM_REG_R0, (uint32_t)value);
      write_reg(uc, UC_ARM_REG_R1, value>>32);
      write_reg(uc, UC_ARM_REG_FPSCR, flags);
      assert(uc_emu_start(uc,0x1000,0x1014,0,0)==UC_ERR_OK);
      printf("CONVERSION %016llx %08x %08x %08x\n",(unsigned long long)value,flags,
        read_reg(uc,UC_ARM_REG_R0),read_reg(uc,UC_ARM_REG_R1));
      cases++;
    }
  }
  assert(uc_close(uc)==UC_ERR_OK);
  printf("PASS %u conversions\n",cases);
}
