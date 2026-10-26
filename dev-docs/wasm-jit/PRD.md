# Browser CPU acceleration: product requirements

Status: implementation in progress. Owner: this fork. Updated: 2026-10-26.

## Problem and outcome

The existing browser runtime runs TinkerBox HD 1.4.1 through Training 01 and
Lesson 2 SUCCESS, but the recorded first Play action occurred at 3,394 seconds.
That manually driven session is correctness evidence, not a controlled startup
benchmark. Deliver usable local gameplay without changing the game's behavior.

## Requirements and acceptance

- R1: User-selected IPA, code, assets, audio and saves remain on the device;
  a static server is sufficient. Never check proprietary inputs into Git.
- R2: Preserve native touchHLE and the existing Rust HLE/graphics/input fixes.
- R3: Run clean TinkerBox Training 01 and Lesson 2 through SUCCESS with working
  textures, sound delivery, pinch and placement; no injected state repairs.
- R4: Target Run-to-interactive-menu and level-selection-to-interactive-level
  each below 10 seconds. Report these separately, excluding human dwell time;
  report cold runtime download/initialization and IPA import separately too.
- R5: Target sustained >=30 presented frames/s and simulation time within 10%
  of wall time over 60 seconds of active play, input response p95 <100 ms.
  Rendering FPS alone does not establish correct simulation speed.
- R6: Record machine, browser, build, backend, input hash (local only), trial
  count, median/range startup, frame-time p50/p95/p99, compilation time/memory
  and fallback frequency. At least three fresh-worker acceptance trials.
- R7: Exercise real desktop Chromium first, then available Firefox/WebKit and
  physical mobile/tablet devices. Emulated viewport is not device validation.
  Identify unavailable hardware explicitly; do not imply universal coverage.
- R8: Bounded execution, correct exceptions, CPU context switching, executable
  cache invalidation and differential CPU tests must pass before default enable.

## Scope

Accelerate CPU execution and measured bottlenecks. Reuse WebGL2, Rust HLE,
worker lifecycle, existing ARM semantics and interpreter fallback. Local runtime
compilation is allowed. Exclude a new UI, WebGPU rewrite, full OS emulation,
new game compatibility, speculative threading and persistent code cache.

## Release gate

A CPU microbenchmark is not game acceptance. Keep incomplete modes opt-in.
Publish exact evidence and limitations in ../browser.md, track work in
PROGRESS.md, and do not mark the thread goal complete before acceptance is met.
Performance targets may require further engineering; failed targets remain open.
