# Acceleration progress

Updated: 2026-10-26. Thread goal: active.

- [x] Inspect current CPU adapter and historical clean game acceptance.
- [x] Create PRD, SAD and SFDS with measurable acceptance and regression gates.
- [x] M0: validate and commit the existing uncommitted browser baseline.
- [x] M1: reproducible CPU baseline, current startup profile, architecture choice.
- [x] M2: compiled blocks, interpreter fallback and differential tests.
- [x] M3: full runtime integration and hot-path coverage.
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

Direct Wasm reads now cover bounded low RAM and high stack. CPU ABI offsets come
from C; unaligned, strict-alignment, other-format and invalid accesses fall back.
Eight compiler test groups, actual Node/Chromium CPU/fibers and HLE mipmap twice
pass. Same-Wasm memory A/B/A medians79.113/81.952/75.633 ms show a modest benefit.
Long diagnostic game has reached Training selection, but first level is still
loading. CPU benchmarks temporarily suspended that diagnostic browser; its wall
clock is explicitly not release timing evidence. Startup/real-time targets unmet.

Bounded subword memory and data stores now preserve code-page invalidation via
per-engine translated-page bitmap. Final Node/Chromium CPU/fibers, 17 JS tests,
nine graphics fixtures twice and audio pass. Native33/browser Rust9 pass.
Separate-data synthetic median103.277/31.968 ms interpreter/JIT; this is not
full-game performance. Rejected metadata-local caching for lack of measured gain.

MessageChannel CPU yields remove measured ~4 ms nested-timer clamping while
preserving Asyncify state and input processing. Positive sleeps remain unchanged.
Compiler loads separately; module cap8192 plus eviction accounting addresses
observed churn, with emitted-code cap still16 MiB. Fresh game validation underway.
Prior diagnostic run completed first simulation and Lesson2 placement, but not
Lesson2 SUCCESS; only0.5–3 FPS. M3/M4/M5 and the goal remain open. Exact tests,
failures, measurements and next steps are recorded in ../browser.md.

Scheduler/store run reaches terms by292 s and main menu by322 s with~3–4 menu
FPS, still far from acceptance. Profile identifies budget-stop unwinding at21%
of samples. Normal block-boundary budget returns pass rebuilt Node/Chromium
CPU/fibers, including a new Thumb IT boundary/resume regression. Long arithmetic
median13.116→11.525 ms; memory gains are mixed. Initial stale-archive checks are
explicitly excluded and build scripts now ensure Unicorn rebuilds before linking.
Full runtime/HLE verification pending; the diagnostic game continues on prior code.
Normal budget return full build, HLE mipmap twice, JS17, formatting and patch
roundtrip pass. Game-level speed and correctness on this change remain pending.

Specialized post-memory exit predicates preserve the original exceptional helper
and avoid ordinary no-op calls. Same-Wasm A/B/A data-memory medians11.418/32.048/
11.231 ms, code-page59.361/77.607/58.182 ms; retain pending full runtime checks.
JS18 and actual Node/Chromium CPU/fibers pass, including64 real memory-hook stops
and resume after hook removal. Older game confirms Lesson1 SUCCESS and Lesson2
pinch/placement; second simulation is underway. Targets and goal remain open.
Scheduler/store game now confirms Lesson2 SUCCESS (screenshot1593 s after second
Play1526 s), completing both training interactions for that build. Performance
acceptance and latest-backend full-game validation remain outstanding.
Predicate runtime rebuild succeeds after an interrupted link; restarted stopped
local server. Nine graphics fixtures twice and actual audio pass; JS19, patch
roundtrip and formatting/diff pass. Latest full-game run is next; no performance
acceptance claim yet.

Latest committed backend clean first-Play interval: terms by182 s, menu by212 s,
training input286 s, Play617 s (331 s including driver sampling).~2.5–2.7 FPS;
performance targets still unmet. Diagnostic continuation verifies Lesson2 SUCCESS
and Lesson3. Profiling now shows60% idle; MessageChannel delivery delays dominate
the measured waiting, with scheduler.yield under evaluation.

Same-block Wasm loops pass JS20 and actual CPU/fiber/self-modification tests.
Same-Wasm A/B/A medium4.694/9.370/3.698 ms and data-memory7.007/10.564/6.057 ms.
Full HLE/game checks pending before commit. Detailed failures/probes in browser.md.
Self-loop HLE graphics matrix passes twice. Pure scheduler.yield rejected by new
input-during-execution assertion (ping starved until all2000 yields finished).
Testing ordinary postTask and MessageChannel fallback before any scheduler commit.

M3 is complete on the validated a03e0005 integration: actual game training through
Lesson2 SUCCESS, graphics/audio/input and CPU fault/cache/fiber coverage exist.
M4 performance and M5 final/device validation remain open; subsequent optimizations
still require their own regressions. Goal remains active.

Ordinary scheduler.postTask passes the new input-progress test for both preferred
and MessageChannel fallback paths. All six2000-yield trials receive input after
the first yield; preferred ping0.4–0.7 ms, fallback0.4–1.1 ms. Full rebuild pending.
postTask full runtime, nine graphics fixtures twice, audio and JS20 pass. Next:
clean combined self-loop/postTask game timing, then profile remaining cost.
