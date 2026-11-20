// SPDX-License-Identifier: MPL-2.0
// Stop inside a load after an already-executed instruction in the same TB.
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <unicorn/unicorn.h>
#include <unicorn/arm.h>

// The TCI helper ABI exposes a call-site PC for state restoration. Checking only
// guest PC is insufficient: the memory path may have synchronized it already.
extern uintptr_t tci_tb_ptr_arm;
typedef uint64_t (*stop_probe_fn)(uint32_t, uint32_t, uint32_t, uint32_t,
                                 uint32_t, uint32_t, uint32_t, uint32_t,
                                 uint32_t, uint32_t, uint32_t, uint32_t);
extern uint64_t touchhle_tci_call(uintptr_t, stop_probe_fn, uint32_t, uint32_t,
                                uint32_t, uint32_t, uint32_t, uint32_t,
                                uint32_t, uint32_t, uint32_t, uint32_t,
                                uint32_t, uint32_t);
static uint64_t stop_probe(uint32_t a0, uint32_t a1, uint32_t a2, uint32_t a3,
                           uint32_t a5, uint32_t a6, uint32_t a7, uint32_t a8,
                           uint32_t a9, uint32_t a10, uint32_t a11, uint32_t a12) {
    assert(tci_tb_ptr_arm == 0x12345678);
    assert(a0 == 0 && a1 == 1 && a2 == 2 && a3 == 3 && a5 == 5 && a6 == 6);
    assert(a7 == 7 && a8 == 8 && a9 == 9 && a10 == 10 && a11 == 11 && a12 == 12);
    return UINT64_C(0xfedcba9887654321);
}

static const int stop_regs[] = {
    UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3,
    UC_ARM_REG_R4, UC_ARM_REG_R5, UC_ARM_REG_R6, UC_ARM_REG_R7,
    UC_ARM_REG_R8, UC_ARM_REG_R9, UC_ARM_REG_R10, UC_ARM_REG_R11,
    UC_ARM_REG_R12, UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC,
};
struct stop_hook_state { unsigned armed, calls; };
static void stop_on_read(uc_engine *cpu, uc_mem_type type, uint64_t address,
                         int size, int64_t value, void *opaque) {
    (void)value;
    struct stop_hook_state *state = opaque;
    if (!state->armed) return;
    assert(type == UC_MEM_READ && address == 0x2000 && size == 4);
    assert(++state->calls == 1);
    assert(tci_tb_ptr_arm != 0);
    assert(uc_emu_stop(cpu) == UC_ERR_OK);
}
static void stop_case(const void *code, size_t length, unsigned thumb,
                      unsigned prefix_size) {
    uc_engine *cpu;
    assert(uc_open(UC_ARCH_ARM, thumb ? UC_MODE_THUMB : UC_MODE_ARM, &cpu) == UC_ERR_OK);
    assert(uc_ctl_set_cpu_model(cpu, UC_CPU_ARM_CORTEX_A15) == UC_ERR_OK);
    assert(uc_mem_map(cpu, 0x1000, 0x2000, UC_PROT_ALL) == UC_ERR_OK);
    const uint8_t data[] = {0x11, 0x22, 0x33, 0x44};
    assert(uc_mem_write(cpu, 0x1000, code, length) == UC_ERR_OK);
    assert(uc_mem_write(cpu, 0x2000, data, sizeof(data)) == UC_ERR_OK);
    struct stop_hook_state state = {0};
    uc_hook hook;
    assert(uc_hook_add(cpu, &hook, UC_HOOK_MEM_READ, stop_on_read,
                      &state, 0x2000, 0x2003) == UC_ERR_OK);
    const uint32_t cpsr = thumb ? 0x30 : 0x10;
    uint32_t expected[16];
    for (unsigned run = 0; run <= 40; ++run) {
        assert(uc_reg_write(cpu, UC_ARM_REG_CPSR, &cpsr) == UC_ERR_OK);
        for (unsigned i = 0; i < 16; ++i) {
            expected[i] = 0x10203040 + i * 0x01010101;
            if (i == 1) expected[i] = 0x2000;
            if (i == 15) expected[i] = 0x1000;
            uint32_t value = expected[i] | (i == 15 ? thumb : 0);
            assert(uc_reg_write(cpu, stop_regs[i], &value) == UC_ERR_OK);
        }
        state.armed = run == 40;
        // Test-only reset between invocations rules out an earlier stale PC.
        tci_tb_ptr_arm = 0;
        assert(uc_emu_start(cpu, 0x1000 | thumb, 0x1000 + length, 0, 0) == UC_ERR_OK);
    }
    assert(state.calls == 1);
    expected[6]++;
    expected[15] += prefix_size;
    for (unsigned i = 0; i < 16; ++i) {
        uint32_t actual;
        assert(uc_reg_read(cpu, stop_regs[i], &actual) == UC_ERR_OK);
        if (actual != expected[i])
            fprintf(stderr, "STOP_RESTORE thumb=%u prefix=%u reg=%u actual=%x expected=%x\n",
                    thumb, prefix_size, i, actual, expected[i]);
        assert(actual == expected[i]);
    }
    uint32_t actual_cpsr;
    assert(uc_reg_read(cpu, UC_ARM_REG_CPSR, &actual_cpsr) == UC_ERR_OK);
    assert(actual_cpsr == cpsr);
    state.armed = 0;
    assert(uc_emu_start(cpu, expected[15] | thumb, 0x1000 + length, 0, 0) == UC_ERR_OK);
    expected[0] = 0x44332211;
    expected[7]++;
    expected[15] = 0x1000 + length;
    for (unsigned i = 0; i < 16; ++i) {
        uint32_t actual;
        assert(uc_reg_read(cpu, stop_regs[i], &actual) == UC_ERR_OK);
        assert(actual == expected[i]);
    }
    assert(uc_reg_read(cpu, UC_ARM_REG_CPSR, &actual_cpsr) == UC_ERR_OK);
    assert(actual_cpsr == cpsr);
    assert(uc_hook_del(cpu, hook) == UC_ERR_OK);
    assert(uc_close(cpu) == UC_ERR_OK);
}
void direct_helper_pc_checks(void) {
    tci_tb_ptr_arm = 0;
    assert(touchhle_tci_call(0x12345678, stop_probe, 0, 1, 2, 3,
                            5, 6, 7, 8, 9, 10, 11, 12) ==
           UINT64_C(0xfedcba9887654321));
    tci_tb_ptr_arm = 0;
    puts("PASS direct helper PC, arguments and 64-bit return");
}
void restore_stop_checks(void) {
    const uint32_t arm[] = {0xe2866001, 0xe5910000, 0xe2877001, 0xe1a00000};
    const uint16_t thumb16[] = {0x3601, 0x6808, 0x3701, 0xbf00};
    const uint16_t thumb32[] = {0x3601, 0xf8d1, 0x0000, 0x3701, 0xbf00};
    stop_case(arm, sizeof(arm), 0, 4);
    stop_case(thumb16, sizeof(thumb16), 1, 2);
    stop_case(thumb32, sizeof(thumb32), 1, 2);
    direct_helper_pc_checks();
    puts("PASS ARM/Thumb16/Thumb32 load-stop PC restoration and exact-once resume");
}
