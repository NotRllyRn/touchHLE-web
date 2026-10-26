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

Combined c39e2a6a game: menu212 s, training-to-Play321 s, ~3 FPS. Lesson1
complete; Lesson2 placement visible, but second Play1799 s left insufficient
time to verify SUCCESS. M4/M5 remain open. Software GPU/raster suppression
diagnosis and a live-register experiment are recorded in browser.md. The new
mode-banking regression caught a bug; preservation around CPSR writes now
passes actual Node/Chromium CPU/fibers. Benchmark/full-runtime checks pending.

Live-register adapter retained: alternating new/old/new50000-SVC medians
124.594/181.047/112.885 ms (31–38% reduction). Eight patches roundtrip,
Node/Chromium CPU/fibers, JS20, formatting/diff, full runtime, nine HLE graphics
fixtures twice and actual audio pass. No native-path changes. Fresh TinkerBox
loading/gameplay measurement is next; no game-speed improvement claimed yet.

Live-register fresh game: menu match202 s, training288 s to Play598 s (310 s);
~3.2 FPS before Play. Lesson1 SUCCESS verified at728 s; later diagnostic work
changes timing. Bounded64-bit load experiment passes JS21 and actual Node/
Chromium CPU/fibers, including VFP payload and cross-boundary fault tests.
Same-Wasm enabled/disabled/enabled doubleword medians5.385/30.294/4.654 ms.
Graphics matrix pending. M4/M5 remain open.

Doubleword compiler graphics matrix passes twice with forced threshold1;
formatting/diff pass. Retain the small extension; game performance on it remains
pending. Existing live-register game reaches Lesson2 and accepts pinch.

Live-register Lesson2 SUCCESS verified999 s, then Lesson3; owned inspector
stopped deliberately afterward. Gameplay profile still60% idle with confirmed
SwiftShader. Fresh doubleword-compiler game starts for startup profiling;
performance/device acceptance remains open.

Doubleword startup profile identifies software floating-point cost. Testing
small exact-zero identities, preserving existing special cases and flags.
Original/optimized49152-operation fingerprints match for ADD/SUB/MUL across
rounding/FZ/DN/sticky modes; actual Node/Chromium CPU/fibers pass. Alternating
benchmarks and full-runtime checks pending. Doubleword game reaches Lesson2
placement; second SUCCESS pending. M4/M5 remain open.

Zero-operand production optimization rejected: ordinary-addition medians
regressed despite predicate reordering. Reverted vendor source/patch registration;
retained49,152-operation result/FPSCR corpus and zero/normal FP benchmarks.
Rebuilt actual Node/Chromium CPU/fibers and benchmark pass. Doubleword game
confirms Lesson2 SUCCESS968 s, then Lesson3. Next: measured helper-dispatch
overhead, preserving GETPC/exception and multi-instance semantics. Goal active.

Normalized call bridge prototype passes JS22 and actual Node/Chromium CPU/
fibers, including FP fingerprints and repeated instances. It preserves GETPC
and calls the unchanged C helper ABI without per-helper imports. Same-Wasm
enabled/disabled/enabled normal-add24.985/27.080/22.024 ms, normal-multiply
23.466/25.277/19.187, SVC109.430/116.563/106.348. Eight-patch roundtrip and
idempotence pass. Full runtime/HLE/game checks pending; goal remains active.

Call-bridge full runtime, nine forced-JIT graphics fixtures twice and audio pass.
Retain pending fresh clean game timing/correctness; M4/M5 remain open.

Bridge clean game: menu182 s, training258 s to Play508 s (250 s, vs310 s);
~3 FPS. Lesson2 SUCCESS1532 s verified. Cancellation C experiment set aside
after low observed frequency; source reverted. Call sampling instead supports
guarded native Wasm float operations matching QEMU's existing hardfloat gate.
Prototype passes JS23 and initial Node corpus; DIV fingerprint4803deb0 adds
coverage to65536 operations/invocation. Browser checks/benchmarks pending.

Guarded floats pass final Node/Chromium CPU/fibers and all65536-operation
fingerprints. Same-Wasm sticky normal-add5.186/10.805/4.087 ms and normal-
multiply4.983/10.666/4.072; clear-flag fallback normal-add22.429/22.427/22.196.
Eight-patch roundtrip/idempotence and formatting pass. Full build/HLE pending.

Guarded-float full runtime, nine forced-JIT graphics fixtures twice and actual
audio pass. Retain; fresh clean game measurement and two-lesson validation
remain next. No under10 s/real-time or hardware-device acceptance claim.

Guarded-float clean game: menu182 s; training267 s to Play input497 s (230 s;
Play screenshot492 s), ~3 FPS. Lesson1 and Lesson2 SUCCESS verified; Lesson2
screenshot1032 s follows diagnostic work and is correctness evidence only.
Named-block profiling after45 s warmup reports67.4% idle, with graphics queries
prominent and no dominant individual CPU block. Defer broad register promotion;
measure graphics query wall time. M4/M5 and goal remain open.

Direct graphics queries total ~724 ms/15.19 s at3.09 FPS, confirming earlier
software-GPU observations. Guard magnitude range simplification passes JS23,
actual Node/Chromium CPU/fibers and two forced-JIT HLE runs. Repeat paired
sticky multiply medians4.176/4.652/4.530 ms; modest gain only. Both lesson
checks precede this last equivalent guard simplification. Next: profile loading
on the current compiler; broad CPU-state promotion still needs evidence.

Startup memory fallback sampling supports bounded64-bit stores:138991/270298
fallbacks in one15 s window;4181 later stores satisfy the conservative fast gate.
Implemented within existing mapping/code-page contract. JS24, actual Node/
Chromium CPU/fibers and all nine HLE graphics fixtures twice pass. New ARM tests
verify bit preservation, endpoint/fault PC and executable-page invalidation.
Paired doubleword-store4.740/46.932/4.820 ms; retain. Fresh game timing/two-lesson
validation still required; M4/M5 and goal remain open.

Aligned-store clean trial: menu182 s; training input275 s to Play508 s =233 s,
~3 FPS. No material gain versus230 s, allowing10 s screenshot resolution. Both
lesson checks pending. Next experiment covers permitted word-aligned doubles,
using C-exported MO_UNALN and excluding page-crossing stores; JS24 pass so far.

Aligned-store Lesson1 SUCCESS612 s and Lesson2 SUCCESS824 s verified. New
word-aligned path passes actual Node/Chromium CPU/fibers and full rebuild.
Paired load4.596/30.305/4.603 ms, store5.208/307.376/5.143 ms; ordinary cases
broadly stable. Graphics matrix pending. Further sampled word-load fallbacks
come from existing libgcc/libstdc++ mappings omitted by the two-region cache;
consider bounded mapping lookup next. Under10 s/real-time targets remain open.

Word-aligned full static build and nine graphics fixtures twice pass; formatting/
diff pass. Retain pending fresh game measurements and two-lesson validation.

Word-aligned clean game: menu172 s; training259 s to Play487 s =228 s, ~3 FPS.
No material improvement beyond10 s screenshot precision. Both lessons pending.
Preparing measured library-mapping coverage: bounded4 MiB page-pointer table,
original alignment/page/code checks, legacy metadata fallback. JS25 pass; actual
CPU regressions and benchmarks pending. M4/M5 remain open.

Word-aligned game confirms both lessons (SUCCESS582/965 s). Page-map full build
and nine graphics fixtures twice pass. Same-binary library-memory5.707/82.537/
5.742 ms, low data5.661/6.010/5.548; retain if final cross-page code-invalidation
regression passes Chromium (Node passes). Fresh game measurement remains next.

Final Chromium crossing-store invalidation test passes. Formatting/diff pass.
Retain page lookup; start fresh game measurement and two-lesson validation next.
