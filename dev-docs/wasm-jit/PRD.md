# Offline IPA-to-web product requirements

Updated: 2026-10-27. User-authorized pivot from online JIT optimization. Active
engineering objective: build a local converter producing a static per-game web
package, quantify its performance against JIT, and reduce measured scene loads.
Historical requirements are preserved in PRD-jit-history.md.

## Product

A developer supplies a locally owned ARM32 IPA to a command-line converter.
The output is a static site containing the game, runtime, precompiled Wasm and
assets. Visitors open a game player without an IPA-upload form. Execution,
audio, graphics, input and saves remain local. No execution server is required.
A Play button may be required for browser audio activation.

## Acceptance

- P1: Reproducible CLI package generation; build fingerprints reject mismatched
  precompiled code. Proprietary packages remain in ignored local output paths.
- P2: Reuse Rust touchHLE and verified Unicorn ARM/Thumb semantics. Native
  correctness reference and existing graphics/audio/input fixes remain intact.
- P3: Emit actual Wasm before visitors run the game; distinguish coverage from
  file packaging. Report translated blocks, cache hits/misses and fallback.
- P4: First milestone may use profile-assisted precompilation; it must be labeled
  as such. Full-app static discovery is a separate milestone. ARM/Thumb mixed
  code, indirect branches, runtime patches and generated code prevent claiming
  complete static coverage from a linear sweep. Safe dynamic fallback is allowed
  and measured; no claim of JIT-free execution unless proved by counters.
- P5: Compare identical TinkerBox scenes and browser settings on fresh workers:
  runtime/download, menu startup, level selection-to-interactivity, first 60 s
  gameplay, compilation time, artifact bytes, precompile time and memory.
  Target under 10 s level/menu loading and sustained 30 FPS. Report failed targets.
- P6: Complete Training 01 and Lesson 2 SUCCESS with actual input, pinch/placement,
  graphics and audio delivery; CPU context/fault/invalidation regressions pass.
- P7: Profile scene transitions to separate translation, asset reads/decoding,
  HLE and game initialization. Preload only if measured useful; avoid speculative
  whole-game asset loading or threads that compete with gameplay.
- P8: At least three comparable trials before claiming stable game speedup.
  Software-GPU CI numbers and qualitative laptop reports are separate evidence;
  cross-browser and physical-device gaps remain explicit.

## Non-goals

No engine rewrite, new UI framework, cloud execution, automatic publishing of
proprietary games, unsupported compatibility claims or decompilation to source.
AOT means ARM-to-Wasm translation ahead of play; browsers still compile Wasm
to their own machine code. It does not precompute arbitrary game initialization.
