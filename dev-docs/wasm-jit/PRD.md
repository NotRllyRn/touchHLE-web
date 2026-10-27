# Optimizing offline ARM-to-Wasm product requirements

Updated: 2026-10-27. Active thread goal contains the user's renewed request.
TinkerBox is the acceptance app; expand to other proprietary IPAs afterward.

## Product and baseline

A local CLI converts a locally owned ARM32 IPA into a static game-only website.
Visitors play without an IPA chooser. CPU execution, graphics, audio, input and
saves stay on the device; hosting serves static files. Preserve touchHLE's Rust
HLE, native correctness reference, licenses and existing compatibility fixes.

Current a3220587 baseline is profile-assisted TCI-to-Wasm packaging with runtime
ARM decoding and JIT fallback. It completes both training lessons but shows no
clear scene-load advantage: three-trial software-GPU medians 143 s offline versus
148 s JIT. This is not the requested optimizing whole-app compiler.
User reference: M3 Max MacBook, 16-core CPU, 64 GB RAM; reported ~30 s loads and
apparently 30–60 FPS. OS/browser and controlled frame-time results are unverified.

## Requirements and acceptance gates

- R1: Preserve reproducible local conversion, immutable package identities,
  corrupt/stale-input rejection and game-only player. Never commit game assets,
  IPAs, saves or raw proprietary code traces.
- R2: Generate faster Wasm through measured optimization, including evaluating
  larger connected regions, safe frontend removal and initialization/HLE costs.
  Packaging success or more cached blocks alone does not satisfy this gate.
- R3: Profiling must expose hot instructions/blocks, generated-code composition,
  helper/HLE costs, compilation, dispatch and scene phases. Separate dynamic
  counts, sampled self/inclusive time and controlled instruction microbenchmarks.
  Report unsupported attribution instead of inventing per-instruction timings.
- R4: Preserve ARM/Thumb/IT/VFP/FPSCR semantics, exceptions, faults, context swaps,
  budgets/input responsiveness, self-modifying-code invalidation and bounded
  caches. Safe dynamic fallback is allowed and its frequency must be reported.
- R5: Full static coverage/frontend removal must be demonstrated using counters
  and guest-code/state identities. Captured coverage is never proof that every
  instruction in an IPA was discovered. No JIT-free claim with fallback present.
- R6: Target <10 s menu/scene loading and sustained >=30 FPS in TinkerBox with
  functional graphics/audio/input. Both Training 01 and Lesson 2 must reach
  SUCCESS using real pinch/placement. Keep device/browser limits explicit.
- R7: Use >=3 comparable clean trials before claiming stable whole-game gain.
  Report startup/download/validation/preparation, selected-scene latency,
  first-minute frame/FPS distribution, compilation, artifact bytes and memory.
  Counter/profiler runs are diagnostic and excluded from acceptance timings.
- R8: Check native reference and relevant CPU/graphics/audio regressions for
  affected changes. Record exact commands, failures and decisions in browser.md;
  keep PROGRESS and HANDOFF current, commit and push verified increments.

## Scope boundaries

No speculative engine rewrite, unrelated compatibility expansion or automatic
public game deployment. Asset preloading is conditional on measured IO/decode
cost and memory impact; the existing loader already caches decompressed entries.
Wasm still needs browser-native compilation. Offline translation cannot precompute
arbitrary game initialization. The goal remains open until its acceptance gates
are proven; an individual diagnostic or optimization milestone is not completion.
