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

Implemented memory coverage includes signed/unsigned 8/16-bit and 32-bit
little-endian reads and 8/16/32-bit stores. Stores dynamically recheck translated
page marks, including pages that became code after the store block compiled.
Cache-capacity evictions are reported separately from explicit resets. Scheduler
regressions verify local Asyncify state across repeated yields, worker message
handling and positive-duration sleep. Full-game acceptance remains outstanding.

Budget-return regressions include Thumb conditional state across page boundaries.
Post-memory exit predicates preserve normalized helper return registers and delay
slots. Actual valid-memory hooks repeatedly stop before the following instruction,
then resume after hook removal. Other helper identities use the existing path.

Self-loop regressions verify local loop state, dynamic unlinking and guest writes
that replace the executing loop's own instruction. Compiled-hit statistics count
C-to-generated-code dispatches, not internal self-loop iterations. Scheduler tests
assert input arrives before the repeated-yield workload finishes, for both the
preferred browser task API and MessageChannel fallback.

Doubleword reads use an i64 Wasm load only for aligned, bounded little-endian
64-bit accesses in the opted-in adapter mappings, then split into TCI low/high
registers. Other formats retain Unicorn helpers. Payload bits, register aliasing,
mapping boundaries, growth and actual VFP memory faults are regression-tested.

Normalized TCI helper calls may use one raw Wasm C bridge. Generated code passes
the instruction address, helper index, and12 arguments in the original TCI ABI
order; C records GETPC and invokes the unchanged adapter. The returned i64 is
split into r0/r1. This preserves exception bookkeeping without saving all helper
arguments into the interpreter's temporary array. Memory helpers still use the
existing single-operation path when inline access is ineligible. Older runtime
artifacts without the bridge continue to use the original helper path.

Guarded VFP single-precision ADD/MUL/SUB/DIV can emit core Wasm f32 operations
when the exact normalized helper identity matches C-provided metadata. Read
rounding/exception fields using C-provided offsets: nearest-even and an already
sticky inexact flag are required. Both inputs must be normal or zero; the result
must have magnitude strictly above FLT_MIN and below infinity. Otherwise invoke
the unchanged helper with original operands. This conservatively excludes
NaNs, infinities, denormals, tiny results, overflow, alternate rounding and
flag-sensitive cases. The fast path returns zero-extended float bits and changes
no status flags. No relaxed SIMD, fast-math or arithmetic fusion is introduced.

Doubleword stores combine low/high TCI words and retain translated-page checks.
C-exported MO_UNALN permits four-byte-aligned doublewords when their requested
alignment allows it. Stores crossing4 KiB pages retain helpers; reads cannot
cross their host mapping. Missing metadata preserves legacy natural alignment.
Tests cover strict/relaxed alignment, memory growth, endpoint/cross-region faults,
NaN payloads and stores replacing previously translated instructions.

Page-map metadata enables direct lookup of every opted-in immutable guest page,
including small library mappings omitted by the legacy largest-region cache.
Page-crossing reads and stores retain helpers, even when both pages are mapped;
their host allocations may be unrelated. Regressions include byte/halfword/word/
doubleword accesses, high addresses, memory growth, changing engines, unmapped
pages and a crossing store that rewrites translated code on its second page.

Partial cache eviction must preserve valid retained functions, clear native
pointers before recycling table slots, and retain evicted translation identities.
Tests exercise both byte and module limits, failed function-table insertion,
re-registration and reset. Actual ARM capacity testing compiles more than8192
modules, revisits code, checks results and rewrites a prior block through a guest
store. The synthetic cache-pressure benchmark is distinct from game acceptance.

## Temporary register transfers

For each compiled block, track registers definitely assigned on the current
forward path, registers written anywhere emitted so far, and incoming registers
read before assignment. Clear definite assignments at forward joins as a
conservative merge. Prepend loads only for needed incoming values; save only
written registers on ordinary exits. Helper input/output contracts remain
unchanged, with full state transfer for unclassified operations. Preserve the
incoming value when a branch skips a write. Same-block loops keep locals, as
before. Validate randomized skipped writes, helper state, actual CPU fingerprints,
linked code invalidation, fibers and game behavior before acceptance.

## Exact floating-point flag updates

Candidate fast paths for binary32 multiply use binary64's exact48-bit product.
For add/sub, allow an initially clear inexact flag only for zero operands or
exponent differences <=29, bounding the exact significand to53 bits. Compare
that exact value with the promoted rounded binary32 result, setting only inexact
when they differ. Preserve existing flags. Nearest-even, finite normal-or-zero
inputs and strictly above-minimum-normal finite results remain required, with
exact signed-zero results allowed separately. All exceptional cases use the
original helper; division keeps its existing sticky-inexact gate. Validate result
bits and FPSCR across rounding/FZ/DN modes and targeted exponent boundaries.
