# Browser CPU acceleration: software functional design specification

Status: experimental implementation; game performance acceptance remains open.
Updated: 2026-10-26.

## Execution contract

Input: existing CPU context, shared mapped guest memory, execution budget.
Output: updated registers/CPSR/FPSCR/memory, consumed budget, existing stop reason.
Native adapter ABI remains unchanged. Interpreter mode is always selectable for
comparison. JIT eligibility must never change which guest instruction executes.

## Translation lifecycle

1. Observe an existing translated block and increment bounded hotness metadata.
2. Decode supported TCI operations, validating operand sizes and branch targets.
3. Emit Wasm integer arithmetic, local temporaries, control flow and typed calls
   into existing memory/CPU helpers; reject the whole block if unsupported.
4. Validate/instantiate with the current runtime memory. Compilation failure
   records a counter and leaves the interpreter available.
5. Execute compiled code on subsequent visits; account budgets and stop requests.
6. Remove all associated compiled state on invalidation/reset/worker termination.

Implemented counters include compiled blocks, failures, cumulative bytes/time,
registered translations, resets, metadata resets and retained bytes. Compiled
dispatches use a shared-memory counter; no per-instruction JS callback.

Further candidate counters: interpreted/compiled blocks, compile attempts/failures,
compiled bytes/time, helper calls, cache entries/evictions. Counters must have a
bounded memory cost and avoid per-instruction logging in measured runs.

## Verification matrix

- Arithmetic: carry/borrow, signed overflow, shifts 0/31/32+, conditions,
  32/64-bit operations; deterministic seeded differential input corpus.
- Control: ARM/Thumb interworking, conditional branches, SVC stop/resume,
  unknown instructions and exact stepping versus bounded block execution.
- State: VFP/FPSCR, registers, context switches and nested Rust/fiber reentry.
- Memory: mapped reads/writes, misalignment, cross-page and unmapped faults,
  code writes/invalidation, memory growth, reset and stale-cache prevention.
- Integration: original HLE IPA, audio, input, texture/mipmap/material/lighting,
  fog/point parameters, buffer presentation; existing native unit tests.
- Performance: isolated arithmetic/memory/helper loops plus real TinkerBox
  startup and active simulation. Report same-build interpreter/JIT comparisons.

## Measurement protocol

Use monotonic timestamps and fresh workers, fixed runtime/game input and browser
settings. Keep debugger disabled; profiling runs separate from timing trials.
Warm machine consistently; no simultaneous builds/benchmarks. Record CPU/browser
versions and acceleration mode (software GPU is not hardware-GPU evidence).
Use at least three trials for release comparisons, reporting raw durations and
median/range. Exclude user interaction waits using stage-specific timestamps.
Retain raw logs locally in ignored target; summarize commands/results publicly.

## Delivery sequence

M0: requirements/design, preserve and verify existing baseline, inventory tools.
M1: reproducible CPU benchmarks and startup profile; choose translation seam.
M2: minimal compiled path with differential correctness and bounded fallback.
M3: full runtime integration, coverage driven by observed hot blocks.
M4: optimize measured bottlenecks and meet game acceptance without repairs.
M5: regression/browser/device validation, docs, clean commits and source push.

Each milestone records evidence in PROGRESS.md and ../browser.md. A failed
experiment is recorded and may change architecture; it is never reported as a
working game result. No shortcut may skip actual game execution.

## Implemented hot-path contract

Generated modules import the existing single-TCI-operation C helper as a raw
Wasm function from the runtime table. The helper cannot suspend; Rust dispatches
HLE only after the CPU returns. Asyncify still instruments fibers and the outer
runtime. This avoids a JS wrapper per memory/VFP operation while preserving
Unicorn exceptions. Modules retain TCI locals and transfer only helper operands
and outputs. Bounded C dispatch entries are cleared before removing Wasm table
functions; dynamic block links are loaded at execution time.

Normal budget and pending-exit checks emit TCG operations. Exhaustion uses the
original CPU stop/restore path; exact debugger stepping retains the instruction
hook and flushes translations when modes change. Budget counts guest instructions,
including one tick for a wide Thumb instruction; one block can overshoot.

The browser adapter opts into one immutable identity-mapped RWX RAM region in
each half of the guest address space (ordinary RAM and high stack). General
Unicorn engines do not opt in. C exports metadata structure offsets to the JIT;
compiled aligned little-endian32-bit loads check size/bounds at runtime, preserving
memory growth and per-engine identity. Any unsupported access uses the original
helper, and all stores retain the full invalidation path. New mapping/protection/
valid-memory-hook APIs would require disabling or revisiting this contract.
