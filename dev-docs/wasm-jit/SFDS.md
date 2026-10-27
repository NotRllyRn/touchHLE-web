# Optimizing precompiler functional design

Updated: 2026-10-27. Existing correctness contracts: SFDS-jit-history.md.

## Milestones

- B0: Update requirements/architecture, retain a3220587 baseline and measurements,
  confirm renewed active goal and public preview stopped.
- B1: Diagnostic profiles with stable generated-block identities, TCI opcode
  dynamic counts, block entries/self loops, compile costs, and CPU sampled self/
  inclusive times. Export bounded JSON locally. Regression checks must prove
  branch-sensitive counts, memory growth, faults, re-registration and recursion
  aggregation; instrumentation must be absent from ordinary output.
- B2: Capture TinkerBox startup and selected level-load phase, identify ranked
  hotspots and caller causes. Add guest ARM PC/mode/instruction metadata and
  controlled opcode throughput fixtures where attribution is currently missing.
- B3: Optimize measured code/initialization. Evaluate bounded connected regions,
  frontend reuse and HLE costs separately. Keep only candidates that pass
  correctness and show targeted improvement; require clean game trials for a
  game-speed claim. Record rejected variants and their measurements.
- B4: Validate offline package with both training lessons, >=3 clean comparison
  trials, memory/artifact/coverage metrics and near-real-time/<10 s targets.
  Hardware-GPU and M3 Max results are separate from software-GPU development runs.

## Diagnostic contracts

Reports identify mode, phase, runtime/compiler/IPA fingerprints, browser/device,
wall duration and sampled duration. Counters are opt-in and bounded; saturation,
omitted blocks, fallback and unavailable fields are explicit. Time categories
must not double-count inclusive frames as total CPU time. Preserve raw sample
profiles separately from summaries. Avoid debugger breakpoints that deoptimize
Wasm. Counts and timing samples from different runs must be labeled as such.

## Correctness and lifecycle gates

CPU: ARM/Thumb/IT, integer/VFP/FPSCR, contexts, SVC, faults, budgets, hooks,
unmapped/cross-page accesses, code invalidation, cache eviction and fibers.
Graphics/audio/input: relevant existing fixtures and real TinkerBox lesson input.
Package: capture identity, current compiler, corrupt payloads, immutable outputs,
Play/Stop fresh worker lifecycle, no upload form or runtime server dependence.
All proprietary output stays ignored under target/ or outside the repository.
