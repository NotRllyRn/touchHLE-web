@ Original test fixture: add two single-precision values, return their bits.
.syntax unified
.arm
.fpu vfpv3
vmov.f32 s0, #1.0
vmov.f32 s1, #2.0
vadd.f32 s2, s0, s1
vmov r0, s2
