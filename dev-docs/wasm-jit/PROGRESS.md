# Acceleration progress

Updated: 2026-10-26. Thread goal: active.

- [x] Inspect current CPU adapter and historical clean game acceptance.
- [x] Create PRD, SAD and SFDS with measurable acceptance and regression gates.
- [x] M0: validate and commit the existing uncommitted browser baseline.
- [x] M1: reproducible CPU baseline, current startup profile, architecture choice.
- [x] M2: compiled blocks, interpreter fallback and differential tests.
- [ ] M3: full runtime integration and hot-path coverage.
- [ ] M4: real-time Training 01/Lesson 2 and startup target measurements.
- [ ] M5: regression/browser/device results, final documentation and source push.

## Evidence and decisions

2026-10-26: Historical clean interpreter run reached Lesson 2 SUCCESS. First
Play was at 3,394 s including manual navigation; no precise FPS or isolated
startup median exists. Working tree contains prior CPU/graphics/audio/input
integration, retained intact. Proposed first experiment reuses Unicorn TCI
semantics and compiles intermediate blocks; no implementation speedup claimed.

Initial next step (completed): inventory SDK/test inputs, run baseline checks,
inspect TCI interfaces and measure the translation prototype.

Baseline checks pass: Rust browser 9, native 30, JS/Wasm 7, real headless HLE
IPA twice in Chromium 141. Source/plans pushed as 0780424e. New compiler tests
pass 6 groups including 8,000 seeded arithmetic cases, comparisons, 64-bit
carry/multiply, mutable block links, memory growth and cache lifetime. Actual
Unicorn integration build is pending; no game-performance claim yet.

First integrated opt-in JIT passes shared CPU/fiber checks in Node and Chromium,
and HLE/MIPMAP runtime checks twice in Chromium. Same-build synthetic medians
show 1.64x/5.68x for medium/long arithmetic blocks but 6.8% regression on tiny
blocks. Full-game profile is running. M2 remains open for broader differential
coverage/cache bounds and M3 for game-driven integration. Goal is not complete.

Profile-guided iteration: first game startup sample executes compiled code but
still spends substantial time in helpers/memory and state transfers. Direct
helper-table calls were rejected after a multi-instance benchmark hang. Retain
existing helper path, selective memory operand transfer, bounded cache and lazy
VFP context materialization. Expanded adapter tests pass in Node. Rebuilt full
runtime/browser regressions and new game startup measurement are next. Exact
commands, failed attempts and measurements are recorded in ../browser.md.

Three-minute refined JIT game run remains on loading splash, with 27.5 million
compiled hits and zero compiler failures. Startup target is not met. Counters
show ~338k translations and four metadata-limit resets during initialization;
compiler retention/dispatch and guest-memory helpers need further work. New
self-modifying-code/protection/unmap/cross-page tests pass in Node. Benchmarking
batched register transfers separately from lazy VFP transfers before retaining.

Compiled-dispatch cache, selective helper operands and batched register transfer
are pushed. Instruction budget and ordinary exit checks now execute as TCG/Wasm
operations with original exceptional paths retained. CPU/context/cache/fiber
regressions and actual HLE mipmap fixture pass. Isolated interpreter/JIT medians
(ms): tiny 42.406/10.254, medium 68.415/9.406, long 283.050/12.551,
50k SVC 118.215/105.818. These are synthetic CPU results only.

Heapsort bounds guest comparator calls and passes 33 native tests. Native game
startup median improves 58.579 to 56.356 s. Browser game still loading at
302.8 s despite 55.4 million compiled dispatches and no compilation failures.
Next: sample later loading, optimize the measured bottleneck, then repeat clean
game acceptance and graphics/audio regressions. M4/M5 and the goal remain open.

Later loading profile identified Asyncify JS wrappers around the synchronous
single-op helper. Importing the same helper as a raw Wasm function passes Node,
Chromium CPU/fibers, forced-JIT HLE mipmap twice, JS tests and Web Audio checks.
Same-Wasm Asyncify memory-loop median falls 144.014 to 101.705 ms (five trials).
Full-game retest underway; no real-time or startup acceptance claim yet.

M1/M2 are complete: reproducible interpreter/JIT CPU benchmarks, later startup
profiles, compiled path/fallback/cache bounds and differential/regression tests
exist. M3 remains open for full game-driven integration; M4/M5 are unmet.

Opted-in fixed-RAM aligned reads pass boundary/fault/memory-growth, Node/Chromium
CPU/fibers, and nine graphics fixtures twice each. Isolated Asyncify memory-loop
median improves 100.565 to 83.610 ms with fast reads. Source retains full store
invalidation and all general-Unicorn semantics. Raw-helper game reaches terms
and main menu at diagnostic driver clicks813/843 s, but no JIT playable level
has yet been validated. Longer fast-read game run with guest FPS logging underway.
