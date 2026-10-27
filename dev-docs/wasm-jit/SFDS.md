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

## Restore implementation sequence

1. Prove typed pointer materialization and complete TB relocation across two live
   engines, including equal-valued scalar constants, faults, budget accounting,
   flushes and host/guest code changes. The isolated ARM prototype passes this
   bounded gate; zero-span exit blocks still decode.
2. Prove Thumb mixed widths, IT fault/resume and the actual adapter's runtime-only
   interrupt/invalid-memory hooks. Translation-affecting hooks remain rejected.
3. Add explicit little-endian records with variable payloads and a bounded index.
   Do not serialize C struct padding, native pointers, jump chains or hash tables.
   Verify full runtime/CPU configuration identity, framing, checked lengths,
   canonical TCI/search/relocations and duplicate keys before atomic attachment.
   Reject malformed imports without replacing the previously accepted archive.
4. Export, destroy the producing Wasm module, instantiate a fresh identical
   module, import and execute with JIT disabled/enabled. Same-process cross-engine
   reuse alone does not establish offline persistence or fresh helper identities.
5. Measure bytes, staging/retained memory, import latency, lookup work and fallback
   decodes at small and representative capture sizes. Stop capture with explicit
   quota omissions. Do not scale by raising fixed record/module-array limits.
6. Connect validated restoration to offline Wasm generation, retaining correct
   bindings for canonical pointer recipes, helper IDs and fresh TB exits. Run the
   full package, phase and game acceptance gates before enabling it by default.

Archive checksums detect accidental corruption, not the provenance of executable
TCI. Initially accept locally captured compiler output with exact identities;
retain live guest-byte and mapping checks regardless of the IPA fingerprint.
