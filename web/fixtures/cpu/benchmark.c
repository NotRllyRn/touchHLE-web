// SPDX-License-Identifier: MPL-2.0
// Original guest code, independent of proprietary games.
#include <assert.h>
#include <emscripten.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
typedef struct Cpu Cpu;
extern Cpu *touchHLE_DynarmicWrapper_new(void *, size_t);
extern void touchHLE_DynarmicWrapper_delete(Cpu *);
extern uint32_t *touchHLE_DynarmicWrapper_regs_mut(Cpu *);
extern int32_t touchHLE_DynarmicWrapper_run_or_step(Cpu *, void *, uint64_t *);
extern void touchHLE_web_map(Cpu *, uint32_t, size_t, void *);
void touchHLE_web_map_memory(void *mem, Cpu *cpu) {
  touchHLE_web_map(cpu, 0x1000, 8192, mem);
}
int main(void) {
  for (unsigned length = 1; length <= 64; length *= 8) {
    uint32_t *code = calloc(1, 8192);
    for (unsigned i = 0; i < length; ++i) code[i] = 0xe2800001; // add r0,#1
    code[length] = 0xe2511001; // subs r1,#1
    code[length + 1] = 0x1a000000 | ((-(int32_t)(length + 3)) & 0xffffff); // bne start
    code[length + 2] = 0xef000042; // svc #0x42
    for (unsigned trial = 0; trial < 5; ++trial) {
      Cpu *cpu = touchHLE_DynarmicWrapper_new(NULL, 1);
      uint32_t *regs = touchHLE_DynarmicWrapper_regs_mut(cpu);
      regs[1] = 100000; regs[15] = 0x1000;
      double start = emscripten_get_now();
      int result;
      unsigned slices = 0;
      do {
        assert(++slices <= 1000);
        uint64_t ticks = 100000000;
        result = touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks);
      } while (result == -1);
      double ms = emscripten_get_now() - start;
      assert(result == 0x42 && regs[0] == 100000 * length && regs[1] == 0);
      printf("BENCH {\"adds\":%u,\"trial\":%u,\"instructions\":%u,\"ms\":%.3f}\n",
             length, trial, 100000 * (length + 2) + 1, ms);
      touchHLE_DynarmicWrapper_delete(cpu);
    }
    free(code);
  }
  for (unsigned kind = 0; kind < 4; ++kind) for (unsigned trial = 0; trial < 5; ++trial) {
    uint32_t *code = calloc(1, 8192);
    code[0] = 0xee000a10; code[1] = 0xee001a90; code[2] = 0xeee12a10;
    code[3] = kind & 1 ? 0xee200a20 : 0xee300a20; // vmul/vadd s0,s0,s1
    code[4] = 0xe2533001; code[5] = 0x1afffffc; // subs r3,#1; bne
    code[6] = 0xee100a10; code[7] = 0xeef11a10; code[8] = 0xef000042;
    Cpu *cpu = touchHLE_DynarmicWrapper_new(NULL, 1);
    uint32_t *regs = touchHLE_DynarmicWrapper_regs_mut(cpu);
    regs[0] = 0x3f800000; regs[1] = kind >= 2 ? 0x3f800000 : 0;
    regs[2] = 0; regs[3] = 100000; regs[15] = 0x1000;
    double start = emscripten_get_now();
    int result;
    unsigned slices = 0;
    do {
      assert(++slices <= 1000);
      uint64_t ticks = 100000000;
      result = touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks);
    } while (result == -1);
    double ms = emscripten_get_now() - start;
    union {float f; uint32_t bits;} value = {.bits = regs[0]};
    assert(result == 0x42 && value.f == (kind == 2 ? 100001.0f : kind == 1 ? 0.0f : 1.0f) && regs[1] == 0);
    const char *name[] = {"float-add-zero", "float-mul-zero", "float-add-normal", "float-mul-normal"};
    printf("BENCH {\"kind\":\"%s\",\"trial\":%u,\"instructions\":300006,\"ms\":%.3f}\n", name[kind], trial, ms);
    touchHLE_DynarmicWrapper_delete(cpu);
    free(code);
  }
  for (unsigned trial = 0; trial < 5; ++trial) {
    uint32_t *code = calloc(1, 8192);
    code[0] = 0xed920b00; // vldr d0,[r2]
    code[1] = 0xe2511001; code[2] = 0x1afffffc; // subs; bne start
    code[3] = 0xec530b10; code[4] = 0xef000042; // vmov r0,r3,d0; svc
    code[1536] = 0x89abcdef; code[1537] = 0xfff81234;
    Cpu *cpu = touchHLE_DynarmicWrapper_new(NULL, 1);
    uint32_t *regs = touchHLE_DynarmicWrapper_regs_mut(cpu);
    regs[1] = 100000; regs[2] = 0x2800; regs[15] = 0x1000;
    double start = emscripten_get_now();
    int result;
    unsigned slices = 0;
    do {
      assert(++slices <= 1000);
      uint64_t ticks = 100000000;
      result = touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks);
    } while (result == -1);
    double ms = emscripten_get_now() - start;
    assert(result == 0x42 && regs[0] == 0x89abcdef && regs[3] == 0xfff81234 && regs[1] == 0);
    printf("BENCH {\"kind\":\"doubleword\",\"trial\":%u,\"instructions\":300002,\"ms\":%.3f}\n", trial, ms);
    touchHLE_DynarmicWrapper_delete(cpu);
    free(code);
  }
  // Compare data sharing a translated page against a separate data page.
  for (unsigned data_page = 0; data_page < 2; ++data_page)
  for (unsigned trial = 0; trial < 5; ++trial) {
    uint32_t *code = calloc(1, 8192);
    code[0] = 0xe5920000; // ldr r0,[r2]
    code[1] = 0xe2800001; // add r0,#1
    code[2] = 0xe5820000; // str r0,[r2]
    code[3] = 0xe2511001; // subs r1,#1
    code[4] = 0x1afffffa; // bne start
    code[5] = 0xef000042;
    Cpu *cpu = touchHLE_DynarmicWrapper_new(NULL, 1);
    uint32_t *regs = touchHLE_DynarmicWrapper_regs_mut(cpu);
    regs[1] = 100000; regs[2] = data_page ? 0x2800 : 0x1800; regs[15] = 0x1000;
    double start = emscripten_get_now();
    int result;
    unsigned slices = 0;
    do {
      assert(++slices <= 1000);
      uint64_t ticks = 100000000;
      result = touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks);
    } while (result == -1);
    double ms = emscripten_get_now() - start;
    assert(result == 0x42 && regs[0] == 100000 && code[data_page ? 1536 : 512] == 100000);
    printf("BENCH {\"kind\":\"%s\",\"trial\":%u,\"instructions\":500001,\"ms\":%.3f}\n",
           data_page ? "data-memory" : "memory", trial, ms);
    touchHLE_DynarmicWrapper_delete(cpu);
    free(code);
  }
  for (unsigned trial = 0; trial < 5; ++trial) {
    uint32_t *code = calloc(1, 8192);
    code[0] = 0xe2800001; code[1] = 0xef000042; code[2] = 0xeafffffc;
    Cpu *cpu = touchHLE_DynarmicWrapper_new(NULL, 1);
    uint32_t *regs = touchHLE_DynarmicWrapper_regs_mut(cpu);
    regs[15] = 0x1000;
    double start = emscripten_get_now();
    for (unsigned i = 0; i < 50000; ++i) {
      uint64_t ticks = 100;
      assert(touchHLE_DynarmicWrapper_run_or_step(cpu, code, &ticks) == 0x42);
    }
    double ms = emscripten_get_now() - start;
    assert(regs[0] == 50000);
    printf("BENCH {\"kind\":\"svc\",\"trial\":%u,\"calls\":50000,\"ms\":%.3f}\n", trial, ms);
    touchHLE_DynarmicWrapper_delete(cpu);
    free(code);
  }
  return 0;
}
