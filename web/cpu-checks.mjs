// SPDX-License-Identifier: MPL-2.0
// Original, bounded fixtures. This tests a candidate CPU, not touchHLE gameplay.
export function runCpuChecks(uc) {
  const results = [];
  const equal = (actual, expected) => {
    if (actual !== expected) throw new Error(`Expected ${expected}, got ${actual}`);
  };
  function check(name, mode, body) {
    const cpu = new uc.Unicorn(uc.ARCH_ARM, mode);
    const hooks = [];
    const hook = (...args) => hooks.push(cpu.hook_add(...args));
    try {
      cpu.mem_map(0x1000, 4096, uc.PROT_ALL);
      body(cpu, hook);
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, error: String(error) });
    } finally {
      for (const handle of hooks) cpu.hook_del(handle);
      cpu.close();
    }
  }
  function execute(cpu, code, thumb = false, count = 100) {
    cpu.mem_write(0x1000, code);
    cpu.emu_start(0x1000 + Number(thumb), 0x1000 + code.length, 0, count);
  }
  check('ARM arithmetic', uc.MODE_ARM, cpu => {
    // mov r0, #7; add r0, r0, #5
    execute(cpu, [7, 0, 0xa0, 0xe3, 5, 0, 0x80, 0xe2]);
    equal(cpu.reg_read_i32(uc.ARM_REG_R0), 12);
  });
  check('Thumb arithmetic', uc.MODE_THUMB, cpu => {
    // movs r0, #7; adds r0, #5
    execute(cpu, [7, 0x20, 5, 0x30], true);
    equal(cpu.reg_read_i32(uc.ARM_REG_R0), 12);
  });
  check('ARM to Thumb branch', uc.MODE_ARM, cpu => {
    cpu.reg_write_i32(uc.ARM_REG_R1, 0x1005);
    // bx r1; movs r0, #42 (Thumb)
    execute(cpu, [0x11, 0xff, 0x2f, 0xe1, 42, 0x20]);
    equal(cpu.reg_read_i32(uc.ARM_REG_R0), 42);
    equal(cpu.reg_read_i32(uc.ARM_REG_CPSR) & 0x20, 0x20);
  });
  check('VFP floating point', uc.MODE_ARM, cpu => {
    cpu.reg_write_i32(uc.ARM_REG_C1_C0_2, 0xf << 20);
    cpu.reg_write_i32(uc.ARM_REG_FPEXC, 0x40000000);
    // fixtures/vfp.s: 1.0 + 2.0, return float bits in r0.
    execute(cpu, [0, 10, 0xb7, 0xee, 0, 10, 0xf0, 0xee,
      0x20, 0x1a, 0x30, 0xee, 0x10, 10, 0x11, 0xee]);
    equal(cpu.reg_read_i32(uc.ARM_REG_R0), 0x40400000);
  });
  check('High guest address and memory callbacks', uc.MODE_ARM, (cpu, hook) => {
    cpu.mem_map(0xfffff000, 4096, uc.PROT_ALL);
    cpu.reg_write_i32(uc.ARM_REG_R1, 0xfffffffc);
    cpu.reg_write_i32(uc.ARM_REG_R0, 123);
    let writes = 0;
    hook(uc.HOOK_MEM_WRITE, (_cpu, _type, address, size) => {
      equal(Number(address), 0xfffffffc);
      equal(size, 4);
      writes++;
    });
    // str r0, [r1]; ldr r2, [r1]
    execute(cpu, [0, 0, 0x81, 0xe5, 0, 0x20, 0x91, 0xe5]);
    equal(cpu.reg_read_i32(uc.ARM_REG_R2), 123);
    equal(writes, 1);
  });
  check('SVC trap and resumption', uc.MODE_ARM, (cpu, hook) => {
    let traps = 0;
    hook(uc.HOOK_INTR, (engine, interrupt) => {
      equal(interrupt, 2);
      equal(engine.reg_read_i32(uc.ARM_REG_PC), 0x1004);
      traps++;
      engine.emu_stop();
    });
    // svc #0x42; mov r0, #9
    execute(cpu, [0x42, 0, 0, 0xef, 9, 0, 0xa0, 0xe3]);
    equal(traps, 1);
    cpu.emu_start(cpu.reg_read_i32(uc.ARM_REG_PC), 0x1008, 0, 10);
    equal(cpu.reg_read_i32(uc.ARM_REG_R0), 9);
  });
  check('Register context save/restore', uc.MODE_ARM, cpu => {
    const context = cpu.context_alloc();
    try {
      cpu.reg_write_i32(uc.ARM_REG_R0, 77);
      cpu.context_save(context);
      cpu.reg_write_i32(uc.ARM_REG_R0, 88);
      cpu.context_restore(context);
      equal(cpu.reg_read_i32(uc.ARM_REG_R0), 77);
    } finally {
      cpu.context_free(context);
    }
  });
  check('Unmapped memory fails closed', uc.MODE_ARM, cpu => {
    cpu.reg_write_i32(uc.ARM_REG_R1, 0x4000);
    let fault = '';
    try {
      execute(cpu, [0, 0, 0x91, 0xe5]); // ldr r0, [r1]
    } catch (error) {
      fault = String(error);
    }
    if (!fault.includes('READ_UNMAPPED')) throw new Error(`Wrong fault: ${fault}`);
  });
  check('Instruction budget stops infinite loop', uc.MODE_ARM, cpu => {
    execute(cpu, [0xfe, 0xff, 0xff, 0xea], false, 20); // b .
    equal(cpu.reg_read_i32(uc.ARM_REG_PC), 0x1000);
  });
  return results;
}
