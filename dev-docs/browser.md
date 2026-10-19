# Browser implementation plan

## Contract

Static hosting only. IPA bytes never leave the user's device. Supported,
unencrypted 32-bit iPhone OS apps execute locally; this is not a promise to run
every IPA. Preserve the native backend and existing TinkerBox graphics fixes.
Do not ship game assets. Single-game export, cloud saves, accounts, and a
language rewrite are out of scope.

## Architecture decisions

- Keep the Rust HLE, Objective-C runtime, framework implementations, and loader.
- Use a worker for emulation so stop/reset remains responsive. Keep DOM and
  browser permissions on the main thread. Transfer IPA bytes, not network uploads.
- Evaluate Emscripten first for mixed Rust/C++ code, SDL/OpenAL, and stackful
  fibers. Use a tiny executable spike before coupling the whole build to it.
- Replace Dynarmic on WASM with an established ARM/Thumb interpreter; evaluate
  Unicorn/TCI licensing, VFP support, callbacks, and performance before adoption.
  Do not build an incomplete homegrown ARM decoder to claim game support.
- Introduce sparse guest memory with explicit mapping and checked translation.
  Native 4 GiB virtual reservation is not a portable WASM allocation strategy.
  Audit host pointers, cross-page slices, allocator behavior, and CPU callbacks.
- Add GLES1-to-WebGL2 shaders behind the existing GLES interface. Preserve
  texture query/BGRA semantics. Implement states demanded by tests and games,
  not speculative WebGPU support.
- Replace native coroutines through a narrow abstraction; prototype nested
  guest/host reentry and yielding using fibers before porting the scheduler.
- Start with one emulation worker, not shared-memory guest threads. Introduce
  COOP/COEP only if the selected runtime needs shared memory.
- Browser-local persistence needs explicit save flush and import/export. Audio
  starts from a user gesture. Errors must identify unsupported behavior.

## Ordered acceptance gates

1. Fork baseline: exact local graphics diff preserved, license retained,
   no IPA/assets/saves in commits, native formatting/build regression checks.
2. WASM feasibility: execute ARM + Thumb + VFP fixtures, memory callbacks and
   SVC traps in browser; exercise fiber yield/reentry and checked guest memory.
3. Loader: import a local IPA in a worker; validate bounds, archive paths,
   decompression limits, executable architecture and encryption. Boot an owned
   test app through the actual HLE. No fake run button or canned screenshots.
4. Graphics/input/audio: render textured GLES1 scenes with reference comparisons,
   pointer/touch coordinate tests, audio gesture unlock, stop/restart cleanup.
5. TinkerBox: first interactive level, then all 35 level loads; physics,
   pause/reset, transitions, sound, saves across reload. Compare native behavior.
6. Browser matrix: Chromium/Firefox/Safari desktop, then mobile where feasible;
   record frame times, peak memory, stalls and unsupported combinations.

Each gate requires executable evidence; a successful compile is not gameplay.
Benchmarks determine whether a faster CPU backend is necessary. Do not optimize
or change languages based on assumptions.

## Starting evidence and risks

Base: upstream ca1de89; four local graphics files, 52 additions/1 deletion.
Native 35-level results exist in the original TinkerBox investigation; they are
not browser results. The original checkout and packaged runtime remain intact.

Upstream issue https://github.com/touchHLE/touchHLE/issues/129 reports a limited
Unicorn/TCI + Emscripten fibers prototype. Its gameplay/performance are unverified
here; no public touchHLE fork was found in the author's public repositories.
Primary risks: interpreter speed, native pointer assumptions, nested coroutine
control flow, GLES1 completeness, browser memory pressure, dependency licenses.

## Validation log

- 2026-10-19: preserved native patch as its own commit; git diff --check passed.
- Full browser runtime is not implemented. A local Emscripten 4.0.23 SDK and
  wasm32-unknown-emscripten Rust target were installed for future experiments;
  they are not committed and are not needed for the current CPU spike.
- Fork baseline: source diff SHA-256 matches the original checkout exactly
  (9df8bcc903fbefe63e0ae85af8209d8b871a5694d1f15d93a575e23be014a10b).
- Native `CMAKE_POLICY_VERSION_MINIMUM=3.5 cargo test --lib -- --skip test_app`:
  30 tests passed. `cargo fmt --check` and `git diff --check` passed.
- CPU spike: pinned Unicorn.js 2.1.4 ARM bundle, nine checks passed in Node WASM
  and the actual collaborative Chromium browser worker. Includes ARM, Thumb,
  interworking, VFP, high guest addresses, memory callback, SVC/resume, contexts,
  unmapped memory fault, and bounded infinite loop. No game execution yet.
- Browser network inspection during CPU tests showed only local static GETs.
  See web/README.md for reproduction and dependency distribution constraints.
- Rust IPA preflight (`src/browser`): seven native unit tests passed and the
  wasm32-unknown-unknown release build succeeded. It is not connected to the
  browser UI, has not inspected a real IPA in WASM, and does not execute apps.

## Execution policy

Development is paused at the owner's request. Publish existing work and this
plan; do not implement further milestones until development is resumed.
The existing CPU and parser experiments are retained, not presented as a
completed browser emulator. See [machine setup](browser-setup.md).

## Requirements and boundaries

- R1: A static HTTP host delivers the app; no execution service, streaming,
  accounts, or server-side IPA handling exists.
- R2: A file picker reads an owned local IPA in the browser. No IPA bytes,
  filenames, saves, or diagnostics are sent to external services by default.
- R3: Target supported, unencrypted 32-bit ARM/Thumb apps. Detect and explain
  encryption, ARM64-only binaries, invalid packages, and missing HLE APIs.
- R4: Preserve native compatibility, including BGRA and texture-parameter fixes.
- R5: Run graphics, input, audio, guest scheduling and saves locally; Stop must
  terminate a hung worker without reloading the page.
- R6: Save data survives a normal reload; explicit export/import supports backup.
- R7: Document browser/device support from measured tests, not compilation alone.
- R8: Deliver reproducible source/build instructions and applicable licenses.

Not promised: arbitrary modern iOS apps, DRM removal, App Store services, cloud
sync, native hardware equivalence, mobile performance parity, or AOT conversion.
Guest networking is disabled initially; any later browser network adapter needs
an explicit scope/security decision and cannot silently proxy through a server.

## Component boundaries

Keep the web shell small: file selection, capability checks, canvas, user audio
gesture, status/error presentation, and worker lifecycle. Use a small versioned
message protocol for load/start/stop, input, status/error and save operations.
Transfer buffers instead of repeatedly cloning them; never log IPA contents.

The worker owns the WASM runtime, guest state, scheduler, virtual filesystem and
memory. Prefer a single WASM instance for Rust HLE and C/C++ CPU code so native
callbacks and shared guest storage do not cross JavaScript for every access.
The current Unicorn.js package is a feasibility harness, not a binding decision.

Use narrow, target-selected adapters at CPU, memory, coroutine, graphics, audio,
clock and filesystem boundaries. Do not introduce a generalized plugin system.
Worker rendering through OffscreenCanvas/WebGL2 is the first candidate; verify
the browser matrix before selecting a main-thread rendering fallback.

## Work breakdown and dependencies

### M0 — Reproducible baseline (partially complete)

Deliver: clean checkout build instructions, pinned tool/dependency versions,
native regression suite, CPU smoke suite and parser suite in CI. Existing
graphics patch is preserved separately in commit 0005f91.

Exit: a second machine reproduces tests without copying target/node_modules;
CI runs on fork changes without proprietary fixtures or upstream credentials.
Review inherited workflows before enabling releases. Tag a verified baseline.

### M1 — Resolve runtime feasibility (CPU smoke portion complete)

Depends on M0. Deliver three small experiments, not a full port:

1. Build an established ARM/Thumb/VFP interpreter from pinned source. Connect
   it to a Rust callback harness with instruction budgeting, SVC stop/resume,
   register/FPSCR context handling, invalidation and memory-fault propagation.
2. Prove Emscripten fiber yield/resume, nested guest-to-host-to-guest calls,
   cleanup and error handling. Check Rust/C++ unwind assumptions explicitly.
3. Prove a portable guest-memory mapping with high addresses, null guards,
   range overflow checks, cross-page operations and stable host-visible slices.

Exit: all three execute in a browser with deterministic assertions. Record
dependency licensing and exact corresponding-source distribution requirements.
If an experiment fails, revise that adapter's decision before large refactors.

### M2 — Connect actual HLE and IPA loader

Depends on M1. First wire the existing preflight WASM to a worker/local picker;
add ABI ownership tests, malformed ZIP/plist/Mach-O cases, cancellation and memory
limits. A successful preflight must say validated, not running.

Then port the actual loader, guest memory, CPU and scheduler behind native/web
adapters. Reuse framework implementations. Do not build a parallel fake loader.
Start an owned open-source minimal test app through actual HLE calls and report
unsupported operations precisely.

Exit: a local IPA reaches deterministic guest test output through HLE, survives
start/stop/restart, and no IPA-bearing request leaves the browser. Native tests
remain green. Test stack/heap allocations and pointer-returning framework APIs.

### M3 — Interactive vertical slice

Depends on M2. Add GLES1-to-WebGL2 shader translation through the GLES interface;
implement matrix stacks, required fixed-function state, vertex arrays, texture
formats/queries and framebuffer behavior against small rendering fixtures.
Add pointer/touch coordinates, frame pacing, audio gesture unlock and buffers.
Use browser-backed filesystem storage and explicit save flush/import/export.

Exit: an owned test game renders, responds to input, plays audio, saves/reloads,
and can stop/restart without orphaned audio, workers or retained GPU resources.
Compare render output and state traces against the native reference; explain
tolerances. Exercise tab visibility changes and WebGL context loss.

### M4 — TinkerBox compatibility and performance

Depends on M3. Use a separately supplied owned IPA; never commit it. First load
one interactive level and measure CPU, rendering, audio, frame time and memory.
Then run a repeatable 35-level load sweep plus representative physics, object
interaction, pause/reset, transitions, sound and save/reload tests.

Exit: every level reaches an interactive scene without faults; tested controls
and persistence match native behavior. Record exact browser/device/build/IPA
hash and level results. Repeated restart and a 30-minute session show no crashes
or sustained memory growth. Target 30 FPS on an agreed reference desktop;
measure median/p95 frame times and report misses rather than hiding them.
If interpreter time dominates, evaluate faster translation only with profiles.

### M5 — Browser release readiness

Depends on M4. Test current stable Chromium, Firefox and Safari desktop; evaluate
mobile separately and publish limitations. Include clean/offline-after-assets
operation tests, constrained-memory errors, malformed-input tests, and save
backup/recovery. Confirm no unwanted external requests or server computation.

Exit: reproducible static dist, necessary headers documented, dependency source
and notices included as required, no game assets, supported-browser matrix and
known limitations published. Only then consider single-game post-processing.

## Verification strategy

- Unit: parser limits, address translation, context semantics, GLES state and
  worker protocol. Test boundary/overflow/failure cases, not only happy paths.
- Integration: actual guest fixtures exercising HLE callbacks and coroutine
  reentry; compare deterministic register/memory/state outputs with native.
- Browser: local file import, rendering, audio unlock, lifecycle and persistence;
  automate in supported browsers and retain small result artifacts.
- Security: fuzz package preflight and memory-range handling; treat all package
  input as hostile. Bound decompression output, archive counts and worker memory.
- Performance: fixed workload/device, warmup and repeated measurements; separate
  CPU translation, framework work, GPU time, audio underruns and memory overhead.
- Regression: require native tests and relevant web tests for each adapter change.
  Do not use proprietary games as public CI dependencies.

## Risks and decision triggers

- Interpreter too slow: profile M4 first; do not begin an ARM-to-WASM compiler
  or language rewrite based solely on microbenchmarks.
- Memory assumptions unsafe: audit every retained guest-derived host pointer;
  block integration if mapping can move memory behind those pointers.
- Fiber/reentry incompatibility: prove nested paths in M1; consider explicit
  continuations only if fibers cannot preserve required semantics.
- Graphics mismatch: use native differential fixtures and add only evidenced
  GLES behavior. WebGPU is deferred, not a second simultaneous backend.
- Browser limits: detect missing capabilities early and fail clearly. Use
  cross-origin isolation only if selected features actually require it.
- License/source gaps: resolve before distributing combined binaries; retaining
  MPL notices alone does not satisfy every bundled dependency's obligations.

## Delivery discipline

Use small independently testable commits. For each milestone record scope,
decision rationale, commands, observed results and remaining limitations here.
Keep native backend as rollback/reference; enable incomplete web paths explicitly.
No upstream PR is implied. No delivery date is committed before M1 establishes
integration feasibility and M4 measures real game performance.
