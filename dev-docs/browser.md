# Browser implementation plan

Current status: touchHLE loads and runs the local TinkerBox HD 1.4.1 IPA in
Chromium. A clean build renders textured Training 01, accepts Play, simulates
the ball down the ramps, and advances to Lesson 2. Mouse-wheel pinch zoom and
browser touch drag from the element tray work there; placing the ball and
pressing Play reaches SUCCESS in Lesson 2. These results use the
actual Rust HLE/ARM runtime, without injected rendering repairs or remote
execution. Startup and level loading remain very slow (about 56 minutes to the
first lesson in the latest headless run); rendering is not real-time. Full-game
compatibility, save persistence, and audiovisual synchronization remain unverified.
See the chronological validation notes below for tests and remaining limits.

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

Development resumed at the owner's request on 2026-10-20, targeting the supplied
TinkerBox HD 1.4.1 IPA. The experiments are not a completed browser emulator.
See [machine setup](browser-setup.md).

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

## 2026-10-20 — resumed browser integration and runtime experiments

The supplied download is stored outside the checkout at
`/root/local-ipas/TinkerBox HD 1.4.1.ipa`; no IPA or extracted assets were added.
SHA-256: `d1a915ac97ccd48ffbd69946532b8653b4a79b42c9889b00a97327fb2c1dbb15`.
Actual WASM preflight reports `com.autodesk.tinkerbox`, ARM32, unencrypted,
850 ZIP entries and 98,082,466 declared expanded bytes. This is eligibility,
not execution or a compatibility result.

Implemented a local file picker and disposable module worker for the existing
Rust parser. Build now compiles/copies its WASM. The input remains a local File;
Stop terminates the worker and a new import gets a fresh instance. Fixed a real
ABI allocation bug: `vec![0; len]` inferred i32, but inspect reconstructed a u8
allocation. Explicit `0u8` fixes the allocator-layout mismatch. Real WASM tests
failed with an allocator trap before the fix and pass afterwards.

M1 experiments now include stable, aligned sparse guest mappings and an
Emscripten Rust/C fiber fixture. The memory prototype checks high addresses,
null-page guards, overlap, budgets, overflow, stable pointers and cross-page
slices inside one mapping. It explicitly rejects slices across distinct host
allocations. The fiber fixture preserves Rust heap state through C callbacks,
nested Rust reentry and two yields, with destructor checks over 100 restarts.
It uses panic=abort; it does not support unwinding across fibers or FFI.

The pinned Unicorn.js source was built locally (wrapper
`fdfcc4fd5e7d4ceeebe6b4d65b19eea4aa655e5d`, Unicorn
`8028ec436f2d9376525352dd38ed9ed6b9f6be10`, upstream TCI/helper patches).
The shared CPU fixture links Rust-owned sparse mappings and the C interpreter
in one WASM instance. It tests ARM, Thumb, VFP, FPSCR contexts, a Rust memory
callback, SVC stop/resume, explicit code-cache invalidation, unmapped faults and
bounded execution. An initial fixture failure exposed the need to pass actual
64-bit arguments through Unicorn's variadic cache-control API; fixed in the
fixture. Emscripten warns that madvise/mprotect are unsupported; no host memory
protection guarantee is inferred from these tests.

Environment: Linux x86_64, Rust 1.99.1, Node 22.22.3, Emscripten 4.0.23,
Playwright 1.56.1, headless Chromium 141.0.7390.37. T3 preview failed with:
`This host blocks the sandbox T3's browser runs in (AppArmor on Ubuntu 23.10+).`
Used the documented optional Playwright harness and local headless Chromium
fallback; no Firefox/Safari/mobile results are claimed.

Validation commands and results:

- `cargo test --locked -p touchhle-browser`: 9 passed (7 parser, 2 memory).
- `cd web && npm run build && npm test`: build passed; 4 Node test groups passed,
  including all 9 original CPU fixtures and real WASM ABI/memory checks.
- `node web/build-fibers.mjs` (activated SDK); Node execution of generated module:
  passed Rust/C reentry, two yields, RAII and 100 restarts.
- `(cd target/unicorn.js && python3 build.py arm)` and
  `node web/build-shared-cpu.mjs`: passed source build; Node shared CPU checks
  passed, with the unsupported-syscall warnings described above.
- `TEST_SHARED_CPU=1 TEST_FIBERS=1
  PLAYWRIGHT_MODULE=/tmp/touchhle-browser-tools/node_modules/playwright/index.mjs
  TEST_IPA='/root/local-ipas/TinkerBox HD 1.4.1.ipa' node web/test-browser.mjs`
  against `python3 -m http.server 8765 --bind 0.0.0.0 --directory web/dist`:
  passed CPU/fibers/sparse memory, real IPA import, malformed IPA, stop/reimport
  and same-origin GET-only requests; no page errors. Local result log: `target/browser-integration.log`.
- `CMAKE_POLICY_VERSION_MINIMUM=3.5 cargo test --locked --lib -- --skip test_app`:
  30 passed. Initial attempts failed for missing Boost/Xext headers, then missing
  sndio linker library. Installed the missing development packages and reran;
  no native source compatibility changes were needed. Log: `target/native-tests.log`.
- `cargo fmt --all --check`, standalone fixture `rustfmt --check`, and
  `git diff --check`: passed.
- Dependency fetch initially failed because this host globally rewrites GitHub
  HTTPS to SSH. Used `GIT_CONFIG_GLOBAL=/dev/null CARGO_NET_GIT_FETCH_WITH_CLI=true`
  for the fetch/build, without changing global Git configuration.

Remaining work: **TinkerBox does not run in the browser yet.** None of these
experiments boots the actual HLE. Native `Mem` still assumes a contiguous 4 GiB
reservation, `Cpu` still uses Dynarmic, and `Environment` still uses corosensei.
The sparse-memory experiment needs allocator/loader integration, unmapping,
permissions and a full audit of retained pointers and cross-region accesses.
The shared CPU fixture now also stops at SVC, enters a Rust host callback,
yields twice, executes nested ARM, restores the caller context and resumes it
over ten fresh interpreter instances. This passes in Node and Chromium. These
are fixture callbacks, not actual HLE framework calls: real scheduler
cancellation/error cleanup, thread switching and framework reentry remain
unproven.
Next integrate these boundaries behind target-specific adapters, boot an owned
HLE guest fixture, then implement GLES/WebGL, input/audio and local persistence
before attempting TinkerBox's first interactive level and the 35-level sweep.
No game rendering, physics, sound, saves, FPS or browser gameplay is claimed.

## Actual HLE browser integration (2026-10-20)

This supersedes the earlier feasibility-only status above. The actual Rust
loader, dyld, Objective-C/framework implementations and scheduler now link into
one Emscripten module with source-built Unicorn. Native builds retain Dynarmic
and corosensei. The page's Run IPA creates a disposable worker, writes the local
File into MEMFS, and invokes the actual HLE. The static server only serves GETs.

Implementation boundaries:

- Unicorn implements the existing CPU adapter ABI, including ARM/Thumb, VFP
  registers/FPSCR, SVC stops, contexts, code invalidation and instruction budgets.
- Rust memory uses a stable 256 MiB low arena and separately mapped high dylib
  and stack segments, with a 384 MiB mapping budget. This is bounded storage,
  not full sparse virtual-memory/permission parity. Native 4 GiB reservation
  remains unchanged. Stack-top arithmetic uses u64 on the 32-bit WASM host.
- Emscripten fibers preserve guest/host/nested-guest continuations. Panics abort;
  suspended stacks do not unwind. Stop terminates the entire worker.
- OffscreenCanvas/SDL creates WebGL1 through the existing GLES1-on-GL2 backend
  and Emscripten legacy GL emulation. Optional controller/sensor subsystems are
  skipped on web. Pointer events are forwarded to SDL; game interaction is
  not yet validated. Worker audio and persistent saves remain unresolved.
- The Unicorn.js helper adapter leaked translation temporaries, corrupting the
  translator on long ARM blocks. `web/patches/unicorn-tci-temp-limit.patch` frees
  these temporaries, limits blocks and checks bounds in release builds.
  `web/patch-unicorn.mjs` verifies pinned revisions and applies it idempotently
  after upstream's build patches. The 512-instruction regression failed before
  the fix with heap corruption and passes after it.
- Empty memmove/memcpy returns without translating pointers, preserving native
  behavior for the zero-byte/null copy used by TinkerBox during startup.

Tests run in this environment (Chromium 141.0.7390.37, Emscripten 4.0.23):

```sh
cargo fmt --all --check
cargo test --lib                         # 30 passed
cargo test --manifest-path src/browser/Cargo.toml # 9 passed
python3 web/fixtures/make-hle-ipa.py
cargo run -- target/browser-hle-test.ipa --headless # exit 0
npm --prefix web test
PLAYWRIGHT_MODULE=/tmp/touchhle-browser-tools/node_modules/playwright/index.mjs node web/test-runtime.mjs
TEST_SHARED_CPU=1 TEST_FIBERS=1 PLAYWRIGHT_MODULE=/tmp/touchhle-browser-tools/node_modules/playwright/index.mjs TEST_IPA='/root/local-ipas/TinkerBox HD 1.4.1.ipa' node web/test-browser.mjs
```

The original tiny IPA uses real Mach-O imports and ARM instructions to call
memcpy(NULL,NULL,0), puts and exit. It passes native and two successive browser
runs, with no page errors and same-origin GET-only traffic. This proves real
IPA execution through the HLE, not game compatibility. CPU/fiber/parser/browser
integration tests also pass. T3 preview was explicitly unavailable under the
host AppArmor sandbox; these checks use the documented standalone Playwright
workflow. Emscripten still warns about unsupported madvise/mprotect; host page
protection must not be assumed.

The proprietary IPA remains outside the repository at
`/root/local-ipas/TinkerBox HD 1.4.1.ipa`; SHA256:
`d1a915ac97ccd48ffbd69946532b8653b4a79b42c9889b00a97327fb2c1dbb15`.
No IPA or extracted assets belong in commits. Current startup investigation
and remaining acceptance results are recorded below.

Startup comparison: native `--headless` stops when UIKit requests a window, as
expected. `timeout 120 xvfb-run -a target/debug/touchHLE '/root/local-ipas/TinkerBox HD 1.4.1.ipa' --gles1=gles1_on_gl2`
passes the initial graphics path, then aborts opening the host audio device
(no ALSA device in this container). Browser WebGL1 instead faults in the
orientation callback at guest PC 0xd53134, writing address 0x5c. A focused
Chromium check confirms RGBA8 renderbuffer allocation returns INVALID_ENUM
(1280) in WebGL1 and NO_ERROR in WebGL2. The browser context is being moved to
WebGL2 to support the renderbuffer format required by the existing renderer.
These failed startup checks are not gameplay passes.

WebGL2 resolved the incomplete framebuffer: the original RGBA8 request was
768x1024 but WebGL1 returned zero dimensions and FRAMEBUFFER_INCOMPLETE_ATTACHMENT
(0x8cd6). The WebGL2 run reports FRAMEBUFFER_COMPLETE (0x8cd5) and progresses to
thread creation. Some depth/stencil combinations are unsupported (0x8cdd);
TinkerBox probes these and selects supported formats.

Thread creation exposed a fiber adapter bug: initializing the caller fiber at
creation captured a guest stack, but the scheduler later resumed it from the
main stack. Reinitialize caller context on every resume. The original adapter
fails the new `web/fixtures/fibers/adapter.c` regression with a stack-limit error;
the fixed adapter passes 10 nested-creation/scheduler-resume/async-sleep cycles
in Node and Chromium. `node web/build-fibers.mjs` builds the actual adapter test,
and `TEST_FIBERS=1 ... node web/test-browser.mjs` runs both fiber suites.

The game renders its real Autodesk splash screen in Chromium after the fiber
caller-context fix. The next SDL locale lookup exposed 8-byte-aligned C stacks;
Emscripten's EM_ASM varargs require 16-byte alignment. C fiber stacks now use
`aligned_alloc(16, size)`. The regression checks stack-base alignment and an
EM_ASM argument; replacing it with the previous malloc reproduces the failure.
SDL locale lookup then successfully reports the browser's `en` preference.
No locale override is required. Further startup reaches accelerometer setup
but stops at a WASM function signature/missing-function error; investigation
continues. A splash screen alone does not establish working gameplay.

A native graphical comparison with `ALSOFT_DRIVERS=null` bypasses the absent
host audio device, but later stops at `Unexpected glDisable(0x3006)` in the
existing renderer. Native unit tests still pass; this Linux graphical run is
not a native gameplay pass.

Reproduce a graphical browser investigation without committing assets:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs RUN_SECONDS=180 \
  node web/inspect-ipa.mjs '/absolute/path/to/app.ipa'
```

This diagnostic writes screenshots under ignored `target/browser-inspection`,
prints worker logs, stops on errors, and destroys the worker at the end. Optional
`CLICKS='[{"second":100,"x":0.5,"y":0.5}]'` sends pointer input using fractions
of the displayed canvas. It is not automatically a gameplay acceptance test.

The function mismatch was the desktop double-precision `glClearDepth` pointer;
Emscripten exposes the GLES float ABI. The browser adapter now directly calls
`glClearDepthf` and `glDepthRangef`; native desktop calls remain unchanged.
Emscripten's legacy GetBooleanv also aborts on TEXTURE_2D, so browser capability
queries use IsEnabled, which reads its emulated server state.

`python3 web/fixtures/make-hle-ipa.py --graphics` builds an original ARM IPA that
binds an Objective-C class reference, creates an EAGLContext, executes float
depth calls, allocates an RGBA8 renderbuffer, checks its width, and checks the
texture capability query and GL error state before printing success. It passes
native under Xvfb and twice in Chromium:

```sh
ALSOFT_DRIVERS=null xvfb-run -a cargo run -- target/browser-graphics-test.ipa --gles1=gles1_on_gl2
TEST_GRAPHICS=1 PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node web/test-runtime.mjs
```

Both Chromium runs exit 0 with no page errors and local GET-only traffic. This
is a real HLE/Objective-C/GLES integration regression, not a game screenshot.

Audio integration: the Run gesture creates and resumes a page AudioContext.
`web/audio-proxy.js` supplies Emscripten OpenAL's playback interface inside the
worker, forwarding decoded PCM buffers and node/parameter/scheduling operations
to `web/audio.mjs` on the page. No network operation is involved. Stop closes
the context and destroys the worker; completed buffer sources are disconnected
and removed. Capture, background-tab suspend/resume, multiple simultaneous AL
context suspension, and long-session audio drift are not yet validated.

`PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node web/test-audio.mjs`
passes a worker-to-real-OfflineAudioContext regression: 0.5 PCM amplitude through
0.25 gain produces 0.125, stopping at sample 240 leaves the remainder silent,
and ended sources are removed. Build the test worker with `npm run build`.
TinkerBox proceeds beyond the previous AudioToolbox context-creation abort and
continues asset loading in the long browser run. Audible game output and menu
interaction are still separate acceptance checks.

The texture-environment setter probe initially failed because Emscripten's
getProcAddress table omits those setters. Browser calls now use explicit JS
imports for the implemented scalar/float-vector setters; integer vectors retain
scalar enum values or normalized color components. The getter shim routes to
the initialized legacy state implementation. The expanded graphics IPA passes
again in two Chromium runs.

The graphics fixture now also creates a framebuffer, draws a red triangle
through GLES vertex arrays, and reads back a pixel to check red/green channels
and the GL error state. This passes natively with Mesa/Xvfb and twice in Chromium
141.0.7390.37, with local GET-only traffic and no page errors. The adapter clamps
MAX_CLIP_PLANES to its six exposed capabilities; Mesa previously advertised eight
and TinkerBox tried to disable the unsupported seventh plane. The fixture checks
the reported limit. Native unit tests (30), JavaScript tests, formatting, and
`git diff --check` pass after this change.

Native comparison after the clipping-plane fix: the optimized Linux build with
`ALSOFT_DRIVERS=null` and Xvfb renders TinkerBox's initial terms screen. No terms
were accepted and this is not a native level-play test. The browser investigation
still ended on black after 351 ferror log entries; no browser menu is verified.

Performance investigation: CPU profiling showed substantial time in JavaScript
`__emscripten_throw_longjmp`. An attempted combination of ASSERTIONS=1 and
EXCEPTION_STACK_TRACES=0 was rejected by Emscripten; that flag was removed, and
assertions remain enabled. A source-built Unicorn variant using
`-sSUPPORT_LONGJMP=wasm` passed the shared Rust/ARM/fiber checks in Node. A focused
50,000-SVC-exit benchmark measured 739.2 ms with JavaScript longjmp and 225.6 ms
with WASM-native longjmp. This is a CPU-transition benchmark, not game FPS.
The patched archive now builds in `unicorn/build-wasm-eh`, and both consumers
link with the matching setting. Full-runtime verification is in progress.

`TOUCHHLE_WEB_DEBUG=1 node web/build-runtime.mjs` additionally exposes
`self.__touchhleRuntime.debugSnapshot()` in the emulation worker for local heap
and GL inspection. Normal builds omit this interface. This avoids enabling the
worker debugger, which can deoptimize WASM. `inspect-ipa.mjs` now timestamps logs
and uses wall-clock seconds for its duration, screenshots, and scheduled input;
previous loop counters could understate elapsed time during slow execution.

Full WASM-native-longjmp runtime verification: original headless and graphics
IPAs each pass twice in Chromium 141, with no page errors and GET-only traffic.
The updated shared-CPU regression repeats 1,000 SVC exits before nested
Rust/guest/fiber reentry, over ten interpreter instances, and passes in Chromium.
Native unit tests remain 30/30 passing. The separate graphics buffer fixture
(`make-hle-ipa.py --buffers`, `TEST_BUFFERS=1 node web/test-runtime.mjs`) draws
with client arrays, then overwrites the pixel using indexed vertex/index buffers;
red/green/blue readback verifies the second draw. It passes natively and twice
in Chromium. These are integration checks, not TinkerBox gameplay acceptance.

A second measured optimization excludes only `tcg_qemu_tb_exec_arm` from
Asyncify instrumentation. Its hooks count instructions, stop execution, report
faults, or perform synchronous memory checks; HLE dispatch and fiber suspension
happen after the interpreter returns. Do not add suspending callbacks inside
this excluded function. A 5-million-instruction VFP/branch loop measured
6152.0 ms before and 2988.9 ms after this exclusion. The repeated-SVC/shared-CPU
and fiber regressions pass in Chromium with the exclusion. The full runtime's
headless and indexed-buffer graphics IPAs each pass twice, with GET-only
traffic and no page errors. This still does not establish game FPS.

Follow-up alternating benchmark runs, after compilation finished, measured
3552.0/3420.5 ms without the Asyncify exclusion and 2908.9/2836.0 ms with it
(about 18% faster). The initial 6152.0 ms baseline was affected by concurrent
build/test conditions; do not present that initial pair as a controlled 2x gain.

Live-run diagnosis (2026-10-21): a black canvas does not yet establish a
rendering failure. Saved main-thread registers and frame chains in the running
WASM-native-longjmp build show synchronous FMOD Vorbis loading, then libpng/zlib
decoding and Ogre pixel conversion/scaling. At roughly 40 minutes the stack
includes `PopupConfirmEulaForm`, `Form::loadFromFile`, `SpriteManager::LoadSprite`,
and `Ogre::Image::resize`. Draw counters have advanced between asset batches.
The initial terms dialog is still being constructed; no browser menu or playable
level is verified. This running worker predates the Asyncify exclusion. Keep
startup latency separate from rendering correctness when reporting results.

A further CPU change reuses Unicorn's existing budget counter through a small
pinned-source accessor, removing the production adapter's duplicate instruction
hook. The accessor clamps the stopping hook's budget+1 count to the budget.
Production-adapter regression coverage now checks zero budget, single stepping,
exact budget exhaustion, a 10,000-instruction slice, and early ARM/Thumb SVC
exits. Build and runtime verification of this change are in progress.

Instruction-counter validation: the shared CPU/fiber test, now linked against
`src/web/cpu.c` and `web/fixtures/cpu/adapter.c`, passes in Node and Chromium 141
(`TEST_SHARED_CPU=1 TEST_FIBERS=1 node web/test-browser.mjs`, log
`target/count-browser-tests.log`). The four JavaScript tests, Rust formatting,
JavaScript syntax checks, and `git diff --check` pass. A 5M VFP/branch benchmark
with the duplicate hook measured 3532.9/3089.9 ms versus 2894.2/2958.5 ms with
only the built-in hook; concurrent tests and the live game make this a noisy
microbenchmark, not a startup-time or FPS claim. Existing Emscripten
madvise/mprotect stub warnings remain visible in the test output.

At about 44.5 minutes the live game began regular scene draws (hundreds of
additional draw calls), but the canvas remained black. A diagnostic wrapper
then queried uniforms using a null program and threw a JavaScript TypeError,
terminating that run at 2730.8 seconds. This was an instrumentation failure,
not a guest crash. Future probes must use raw WebGL queries, handle null
programs, and contain their own errors. The first full-runtime rebuild after
the counter change was terminated with signal 15 after Rust compilation; no
compiler failure or OOM event was recorded. A fresh link is in progress.

The original `--present` fixture creates a full-screen opaque CAEAGLLayer in a
UIWindow, draws into its renderbuffer, presents through the actual EAGL fast
path, and reads the default framebuffer to verify red. It passes on native
GLES1-on-GL2. Its first draft incorrectly used objc_getClass without binding
the classes; explicit dyld class bindings fixed that test setup failure.

Presentation regressions found and fixed (2026-10-21):

- The first browser `--present` run panicked restoring an unset vertex-array
  size. Emscripten 4.0.23 initializes client descriptors as empty objects, not
  GLES defaults. `web/emscripten-gl-init.js` initializes valid defaults.
- The next run rendered red but reported GL_INVALID_ENUM. Tracing showed
  missing CURRENT_COLOR, CLIENT_ACTIVE_TEXTURE, array-buffer-binding, and legacy
  blend-factor queries. The shim supplies them from actual emulated state and
  tracks the buffer binding at each gl*Pointer call.
- `--present-buffers` draws with the guest VBO after presentation, then presents
  again and checks blue. Native passed; browser pixels were blue immediately
  after drawing but black at the later read after a scheduler yield. Setting
  EGL's `preserveDrawingBuffer` prevents automatic browser discard at arbitrary
  guest scheduling boundaries. The fixture then passed twice in Chromium.
- A follow-up glGetPointerv assertion exposed Emscripten's planar-array
  conversion replacing the application pointer with its temporary buffer.
  Preserve declared pointers after preparation (rendering still uses the
  generated offsets and vertexPointer). This assertion failed before the fix
  and passes twice in Chromium afterward; native verification also runs.

These fixes are browser-only, and do not establish TinkerBox gameplay. They
were first verified by injecting the exact post-JS source into a generated
local diagnostic build; a clean scripted rebuild is in progress. The earlier
counter build also passes headless and indexed-buffer runtime tests twice.
Two live TinkerBox comparisons are running: the earlier worker without retained
drawing-buffer contents, and a new worker with preservation and query fixes.
Both received the pointer-restoration diagnostic patch before scene rendering.

Clean rebuild results: `TOUCHHLE_WEB_DEBUG=1 node web/build-runtime.mjs`
completed successfully with the source post-JS shim. In Chromium 141, each of
headless, indexed graphics, basic presentation, and presentation with VBO reuse
and pointer preservation passes twice (`target/presentation-clean-*.log`).
All runs have same-origin GET-only traffic and no page errors. The updated
presentation/VBO/pointer fixture also passes natively. Native unit tests pass
30/30 (`CMAKE_POLICY_VERSION_MINIMUM=3.5 cargo test --lib -- --skip test_app`).
Rust formatting and `git diff --check` pass. Native code paths were unchanged
by the browser GL shim. TinkerBox acceptance remains pending live startup.

Block-budget investigation: a focused 5M-instruction ARM loop with 32-instruction
blocks measured 1997.5/1961.2 ms with per-instruction budgeting and 332.6/347.3 ms
with block budgeting. This is not a game FPS measurement. The production
adapter now experimentally charges blocks using their byte length (ARM: /4;
Thumb: /2, conservatively charging wide Thumb instructions twice). The CPU ABI
already defines ticks as abstract; normal execution can overshoot by at most
one translated block and remaining ticks saturate at zero. Exact instruction
stepping remains on Unicorn's count hook. Tests cover small budgets, long-block
infinite loops, mixed-width Thumb, SVC exits, and step/run transitions.

The first adapter test hung switching from normal execution to single stepping:
Unicorn reused a translation without its newly enabled instruction-count hook.
Flush translated blocks when switching modes. The updated production-adapter
and existing CPU/fiber tests pass in Node; browser and full-runtime verification
are in progress. Live game workers still use the preceding tested adapter.

Block-budget adapter tests also pass in Chromium (including fibers), log
`target/block-adapter-browser.log`. A further presentation regression checks
that TEXTURE_2D remains enabled after EAGL presents: Emscripten's legacy
`glIsEnabled` does not implement this capability, so the earlier GetBooleanv
workaround returned false. The browser adapter now queries TexEnvJIT's active
texture-unit state directly. This test passes natively; the browser build is
being updated before it is run. Do not treat the earlier plain-color
presentation tests as coverage of texture-enable restoration.

The texture-enable regression fails on the preceding browser build and passes
twice after the targeted query fix. The clean block-budget/texture-state build
also passes the VBO presentation/pointer fixture twice and the headless loader
fixture twice, with GET-only local traffic and no page errors. Native unit tests
remain 30/30 passing. Logs: `target/texture-state-after.log`,
`target/block-runtime-present-buffers.log`, `target/block-runtime-headless.log`,
and `target/texture-native-tests.log`.

Both earlier comparison workers reached their configured two-hour limit and
stopped with black final screenshots. They did not contain the texture-enable
fix or block-budget adapter. The new complete diagnostic run uses a five-hour
limit, its own ignored output directory, and periodic draw/register snapshots.
It is still a diagnostic run, not a verified interactive game result.

A 15-second Chrome worker CPU profile (Profiler only, no Debugger domain) of
actual TinkerBox audio initialization put 51.5% of samples in __wasm_longjmp,
14.2% in the TCI interpreter, and 8% idle. Stack inspection shows FMOD building
Vorbis decoding tables and loading individual sounds (e.g.
`Sounds.ipad/ui_element_select.ogg`). This is ongoing initialization, not proof
of a deadlock. Profile: ignored `target/block-worker.cpuprofile`.

A narrowly scoped experimental Unicorn patch makes WASM ARM SVC helpers record
the existing exception and request cpu_exit, then return through an explicit
translated-block exit. Other exceptions keep their existing longjmp behavior;
native builds are guarded out. Tests now cover stopping, continuing, conditional,
and unhandled SVCs, plus the existing ARM/Thumb and nested-fiber cases. Build
and runtime verification of this patch are in progress; the current live game
still uses the previously verified SVC path.

SVC-return validation: expanded CPU/fiber tests pass in Node and Chromium,
including conditional, unhandled, continuing, and repeated stopped SVCs. The
full runtime's headless, texture-state presentation, and VBO/pointer
presentation fixtures each pass twice. A 50,000-SVC microbenchmark measured
242.6/233.6 ms using WASM longjmp and 81.6/69.3 ms using ordinary block return.
This is not a game FPS claim. Logs: `target/svc-return-{node,browser}.log` and
`target/svc-return-runtime-*.log`.

TinkerBox rendering diagnosis: scene draws were issued with enabled vertex and
texture-coordinate arrays but no linked shader. Reading the program log showed
`Fragment shader is not compiled`, with a syntax error in Emscripten's generated
texture COMBINE code. Its duplicate-texture-load regexp stopped at the first
closing parenthesis of `(u_textureMatrix0 * v_texCoord0)`, splitting the sample
expression. The pinned SDK patch uses the already-known complete sample
expression for deduplication. `web/patch-emscripten.mjs` verifies SDK version and
applies the patch idempotently as part of `web/build-runtime.mjs`.

A temporary equivalent repair to the live shader generator, with shader-cache
invalidation, immediately produced the upright TinkerBox terms dialog. Browser
pointer input dismissed it and the actual main menu rendered. Selecting Puzzles
started further synchronous image conversion; a playable level is not yet
verified. This live run uses the earlier block-budget build with the shader
repair injected diagnostically. A clean patched build is in progress.

The original `--combine` fixture uploads a blue one-pixel texture and renders
with a texture matrix plus COMBINE mode (replace RGB, modulate alpha). Native
passes; the previous browser build fails, reproducing the shader defect without
proprietary assets. Clean patched-browser verification follows the rebuild.

Clean shader-patched build validation (2026-10-21):
`TOUCHHLE_WEB_DEBUG=1 node web/build-runtime.mjs` completed. With
`PLAYWRIGHT_MODULE=/tmp/touchhle-browser-tools/node_modules/playwright/index.mjs`,
`TEST_COMBINE=1 node web/test-runtime.mjs` passes twice, as do
`TEST_PRESENT_BUFFERS=1` and `TEST_GRAPHICS=1`. All report Chromium 141.0.7390.37,
no page errors, and same-origin GET-only traffic. Logs:
`target/runtime-combine-after.log`, `target/combine-build-present-buffers.log`,
`target/combine-build-graphics.log`. `cargo fmt --all -- --check`, JS syntax
checks for the SDK patch/build scripts, and `git diff --check` pass.

The retained diagnostic game session reached the actual Puzzles category
screen. Selecting Training entered `PopupStageSelectionForm` construction;
stack samples progressed from `_inflate` to `Ogre::Image::scale/resize` via
`SpriteManager::LoadSprite`. This confirms the click was handled and loading
continues; the unchanged previous frame does not establish a hang or a playable
level. Screenshots remain ignored under `target/browser-block-inspection/`.
A second game session (`target/tinkerbox-clean-combine.log`) is running the
clean shader-patched runtime without injected shader repair. Startup remains
slow. Next acceptance step: select and interact with the first training level,
then verify on the clean build. Audio, persistence, all levels, and other
browsers remain unverified.

Normal (non-diagnostic) `node web/build-runtime.mjs` also completed. Its COMBINE
regression initially failed at `page.goto` with `ERR_CONNECTION_REFUSED` because
the static server had expired (`target/combine-release-test.log`). Restarting
`python3 -m http.server 8765 --bind 127.0.0.1 --directory web/dist` resolved the
prerequisite; both runs pass (`target/combine-release-test-retry.log`).
Inspecting the game's sprite-loader call site shows that it unconditionally
rounds texture dimensions to powers of two before calling Ogre resize; reporting
an extra NPOT extension would not remove this loading cost. No capability or
game-code workaround was added.

The Training stage-selection popup subsequently rendered correctly, including
level 01 and locked later stages. Clicked level 01 to begin its load. The
screenshot `target/browser-block-inspection/training-current.png` captured the
stage popup; it is diagnostic evidence, not proof of playable physics.

Level-01 loading exposed another failure in the original retained run:
`RuntimeError: null function or function signature mismatch` in
`GLES1OnGL2::PointSize` (`target/tinkerbox-block.log`, at 11304.6 seconds).
That worker terminated before a level frame rendered. The clean shader build
independently rendered the terms dialog, main menu, and Puzzles screen before
any additional live repair (`target/browser-clean-combine/`).

The new original `--points` fixture reproduces the missing PointSize binding.
An initial fixture used GetIntegerv for POINT_SIZE, which touchHLE's native
parameter table rejects; corrected to GetFloatv. The corrected native fixture
passes. A browser-only direct import now invokes Emscripten's existing
`glPointSize`, and the legacy query shim returns its stored value. Fixed-point
PointSizex uses the same path; native PointSize keeps the desktop entry point.
The first browser rebuild stopped crashing but failed the rendered-pixel check:
the SDK's current-renderer cache reused a triangle shader for points. The post-JS
shim now invalidates that shortcut when transitioning between points and other
primitives. A diagnostic generated build passes twice; a clean build is pending.
The fixture checks float/fixed size, a blue pixel inside the four-pixel point,
and a neighboring red pixel outside it. Check failures return their ordinal as
the guest exit status. Logs: `target/runtime-points-before.log`,
`target/native-points.log` (incorrect query), `target/native-points-corrected.log`,
`target/native-points-bounds.log`, `target/runtime-points-after.log` (pixel failure),
`target/runtime-points-diagnostic.log`, `target/runtime-points-shader.log`.

To preserve hours of startup, the second live session received the equivalent
PointSize/query/cache repair diagnostically. CDP Runtime scope inspection
(without enabling Debugger) exposed the host table/state. Only the host
GLES1OnGL2 PointSize binding was redirected to a typed callback using the unused
GLES1Native PointSize table slot; no guest code or assets changed. The callback
sets Emscripten's point-size state. This run is now diagnostic, not a clean-build
game acceptance result. The scripted source fix uses a normal imported binding.

Clean point-size build validation: `TOUCHHLE_WEB_DEBUG=1 node
web/build-runtime.mjs` completed (`target/points-clean-build.log`). The extended
`TEST_POINTS=1` fixture passes twice in Chromium 141.0.7390.37 with same-origin
GET-only traffic and no page errors (`target/runtime-points-clean.log`). Native
unit tests remain 30/30 passing with `CMAKE_POLICY_VERSION_MINIMUM=3.5 cargo test
--lib -- --skip test_app` (`target/points-native-tests.log`). A fresh game run
using the built-in point and COMBINE fixes is underway in
`target/browser-clean-points/`; the retained diagnostic session is loading the
Training selector again. Playable physics remains unverified.

The clean point build also passes `TEST_PRESENT_BUFFERS=1` twice with no page
errors and same-origin GET-only traffic (`target/points-clean-presentation.log`).
Formatting, JS syntax checks, and `git diff --check` pass. The older session's
menu was a clean shader result, but its continuing level attempt includes the
explicit diagnostic point repair; keep this provenance distinct from the fresh
fully built-in run at `target/tinkerbox-clean-points.log`.

The next retained session passed PointSize and failed at PointParameterfv
(`target/tinkerbox-clean-combine.log`, 14202.1 seconds), again before a level
frame. Added browser point-parameter state/imports for scalar/vector float and
fixed-point calls, legacy queries, and a pinned SDK shader patch for eye-space
distance attenuation and min/max size clamping. Fade threshold is retained and
queryable, but multisampled point fading is not implemented or verified.
Native entry points remain intact. `--point-parameters` checks query state,
constant attenuation independently of limits, and a large point constrained by
the max-size limit against actual pixels. It passes natively
(`target/native-point-parameters-final.log`). The original fixture exceeded its
2 KiB code/literal area at first; sharing identical ARM literal-pool values
resolved that without moving its Mach-O sections. Browser compilation/testing
is in progress. The previous browser build reproduces the missing binding
(`target/point-parameters-before.log`).

The third game session reached its terms dialog on the fully built-in point-size
build. It now has the equivalent point-parameter repair injected diagnostically
via typed host callbacks and shader/uniform hooks. A local ignored screenshot
matcher advances only the four already verified menu screens after two matching
captures, to avoid losing hours waiting at prompts. It does not infer gameplay
success or act on unrecognized screens. Driver: `/tmp/touchhle-menu-driver.py`;
log: `target/point-session-menu-driver.log`. The normal point-size build passed
its point fixture twice (`target/points-release-test.log`) before these newer
parameter changes. Gameplay acceptance is still pending.

The clean point-parameter build completed (`target/point-parameters-build.log`).
`TEST_POINT_PARAMETERS=1 node web/test-runtime.mjs` passes twice in Chromium
141.0.7390.37, with no page errors and only same-origin GET requests
(`target/point-parameters-after.log`). Native unit tests pass 30/30
(`target/point-parameters-native-tests.log`). A fresh unmodified runtime session
with all current fixes and the guarded menu driver is running:
`target/tinkerbox-clean-parameters.log`, screenshots in
`target/browser-clean-parameters/`, driver log `target/parameters-menu-driver.log`.
The older session with injected point-parameter repair remains diagnostic.

After point-parameter support, COMBINE, presentation/VBO/pointer, and basic point
fixtures each pass twice (`target/parameters-{combine,presentation,points}-test.log`).
Those fixtures were regenerated with the deduplicated literal pool. The normal
non-diagnostic build completed (`target/parameters-release-build.log`) and its
point-parameter fixture passes twice (`target/parameters-release-test.log`).
Formatting, JS syntax checks, and `git diff --check` pass. The generated normal
runtime is served locally on port 8765. The fully built-in graphical game run
still has not reached verified gameplay; do not present these regressions as
that acceptance result.

A further original `--lighting` fixture exercises normal arrays, material
ambient/diffuse, global ambient, light diffuse, and enabled fixed-function
lighting. It verifies an actual lit red triangle pixel. The existing runtime
passes twice in Chromium with no page errors and GET-only local traffic
(`TEST_LIGHTING=1`, `target/browser-lighting.log`); native also passes
(`target/native-lighting.log`). No runtime change was needed for this fixture.
This is additional 3D-path coverage while the actual game loads, not a substitute
for gameplay verification.

The page now shows elapsed session time while an IPA is active and explains
that startup/level loading can take many minutes. It is a timer, not an inferred
loading percentage or a claim that the guest has reached gameplay. Stop/exit
clears it. The existing two-run point-parameter integration check passes with
this shell change (`target/elapsed-ui-runtime-test.log`). No new dependencies.

Actual game audio-path evidence: a non-mutating observer of AudioBridge.handle
in the fresh point-parameter run counted 51 PCM buffers and 51 source starts,
24 kHz samples, 13,051 nonzero values among 13,056 sampled values (sampling every
16th value), peak 0.291229248, sum of squares 27.166671621. The AudioContext was
`running`. This confirms actual TinkerBox PCM reaches browser scheduling; it is
not a human listening/synchronization check. The observer retains statistics
only, not game audio assets (`/tmp/touchhle-audio-observe.js`).

Level-loading bottleneck sample (third diagnostic session): main-thread frames
show `MusicAsSoundEffect::Load` called by `GameHudPuzzleForm::onFormOpen`, then
FMOD SoundI::read/createSound and `_ov_read_filter`. This is full guest Vorbis
music decoding, not idle waiting for a network response. Keep this separate
from graphics failures when assessing a frozen previous frame.

The third diagnostic session reached indexed level drawing after music decode,
then aborted on `glMaterialfv: TODO: 5632` (GL_EMISSION), at 6765.2 seconds in
`target/tinkerbox-clean-points.log`. Emscripten already stores emission and
uploads it to its lighting shader; only the setter case was missing. Added the
pinned `emscripten-material-emission.patch`. The lighting fixture now sets
ambient, diffuse, specular, shininess, and green emission and checks the resulting
yellow pixel. Native passes (`target/native-emission.log`); the previous browser
build reproduces the exact abort (`target/emission-before.log`). A clean build
is underway. The retained point-parameter session received an equivalent typed
wrapper around its actual material setter, preserving other cases and writing
the existing emission state. It is now diagnostic; no guest code changed.

The point-parameter SDK patch also supplies neutral parameter defaults when
used by an SDK consumer without touchHLE's post-JS state shim. This avoids
breaking that consumer's ordinary point rendering. touchHLE initializes its
own state as before; the fallback does not change that path.

Emission validation: the clean scripted build completed (`target/emission-build.log`)
and `TEST_LIGHTING=1 node web/test-runtime.mjs` passes twice in Chromium with no
page errors and same-origin GET-only requests (`target/emission-after.log`).
The final native fixture also verifies blue is zero (`target/native-emission-final.log`).
A new unmodified runtime game run includes all current fixes and the guarded
menu driver: `target/tinkerbox-clean-emission.log`, screenshots in
`target/browser-clean-emission/`, driver log `target/emission-menu-driver.log`.
The retained parameter run has the explicit emission repair injected and is
not a clean-build acceptance result. No playable level is verified yet.

The retained parameter run and the unmodified emission run both progressed to
scalar Materialf, then failed with `null function or function signature mismatch`
(`target/tinkerbox-clean-parameters.log` at 2828.0 seconds;
`target/tinkerbox-clean-emission.log` at 2566.4 seconds). Browser Materialf now
uses the existing Materialfv implementation with a one-element host float;
Materialx converts through the same method. Native Materialf retains its entry
point. The lighting fixture now exercises both scalar variants plus blue
specular, red diffuse, and green emission, checking a white pixel. Native passes
(`target/native-material-scalar.log`); the previous browser reproduces the
missing binding (`target/material-scalar-before.log`); the clean browser build
passes twice (`target/material-scalar-after.log`). A new clean game session is
running in `target/browser-clean-material/`, with log
`target/tinkerbox-clean-material.log` and guarded driver
`target/material-menu-driver.log`. The previous workers exited on their errors.

Browser binding audit and fog/buffer mapping follow-up:
- Compared TinkerBox's 104 imported GL symbols against initialized GLES1OnGL2
  WASM function-pointer slots. The audit identified absent Fogf/Fogfv, Lightf,
  and MapBuffer/UnmapBuffer (also used internally by DrawElements). It checks
  potential branches, not whether every import actually executes.
- Explicit fog imports call the pinned SDK's existing implementations. The
  original `--fog` fixture exercises scalar float/fixed values, enum conversion,
  vector color, and a fully fogged blue pixel. Native passed in
  `target/native-fog.log`; the prior browser reproduced a missing binding in
  `target/fog-before.log`. The clean diagnostic build passes twice in Chromium
  141 (`target/fog-after.log`).
- WebGL2 mapping uses a malloc-backed shadow populated with getBufferSubData;
  unmap uploads modifications and frees it. BUFFER_ACCESS/BUFFER_MAPPED queries
  reflect this state. The `--mapped` fixture modifies a VBO across two mappings,
  preserves untouched vertices, rejects duplicate mapping, checks state, and
  verifies a blue triangle. Native passed (`target/native-mapped.log`); the old
  browser failed (`target/mapped-before.log`); the clean browser passes twice
  (`target/mapped-after.log`). Both browser tests had no page errors and only
  same-origin GET traffic. Deletion while mapped and full GL conformance are
  not verified.
- Build: `TOUCHHLE_WEB_DEBUG=1 node web/build-runtime.mjs`, log
  `target/fog-mapped-build.log`. `cargo test --lib`: 30 passed, zero failed
  (`target/fog-mapped-native-tests.log`); `cargo fmt --all -- --check` passed.

Light parameter work in progress: the SDK lacks scalar light setters and its
shader ignores attenuation/spotlights. Added a pinned SDK patch and explicit
float/vector imports, preserving native calls. Original `--light-attenuation`
and `--light-spot` fixtures compare constant attenuation and a spotlight facing
away from a triangle, including float/fixed setters. Both pass natively
(`target/native-light-attenuation.log`, `target/native-light-spot.log`); the
preceding browser fails at the missing scalar binding
(`target/light-attenuation-before.log`). Browser validation is pending the
build in `target/light-parameters-build.log`. No playable TinkerBox level is
verified yet; the retained material session continues loading.

The light-parameter diagnostic build succeeded. Chromium 141 passes each of
`TEST_LIGHT_ATTENUATION=1`, `TEST_LIGHT_SPOT=1`, and `TEST_LIGHTING=1` twice
(`target/light-attenuation-after.log`, `target/light-spot-after.log`,
`target/light-regression.log`), with no page errors and local GET-only traffic.
The new shader distinguishes positional/directional lights, applies distance
attenuation and spotlight cone/exponent state, and transforms spot directions
at setter time. Full lighting conformance (including two-sided lighting) is
not claimed. Native unit tests remain 30/30 (`target/light-native-tests.log`);
formatting, JS syntax checks and `git diff --check` pass. A fresh clean game
session is running in `target/browser-clean-light/`, log
`target/tinkerbox-clean-light.log`, guarded driver `target/light-menu-driver.log`.

Initialized binding audit of the clean light build found no missing function
slots among TinkerBox's imported GL methods (`target/light-binding-audit.json`,
matched to `target/light-audit-runtime.wat`). Other GLES methods retain missing
bindings; this is an import-specific audit, not general GLES completeness or
proof of gameplay. Lightx/Lightxv's unused integer conversion branches still
show missing desktop integer setters; the table's light parameters all use
float conversion, exercised by the native/browser fixed-point fixture.

Normal (non-diagnostic) runtime build also succeeded
(`target/light-release-build.log`). FOG, MAPPED, LIGHTING, LIGHT_ATTENUATION,
LIGHT_SPOT, POINT_PARAMETERS, and COMBINE each passed twice with the same
Chromium/static-GET checks; logs are `target/release-<lowercase flag>.log`.
All four SDK patches applied in order to pristine pinned libglemu.js reproduced
the SDK source byte-for-byte. The optimized native build succeeds
(`target/native-game-release-build.log`), retaining existing stb warnings.
Native Xvfb/null-audio reference accepted terms and traversed Puzzles → Training
→ 01 (`target/native-game-release.log`, `target/native-menu-driver.log`);
level loading is still in progress. The earlier debug native comparison was
terminated during startup to use the optimized reference; not a crash/pass.

2026-10-22 game result and follow-up:
- The retained material build failed at Lightf at 3464.4 seconds
  (`target/tinkerbox-clean-material.log`), confirming the audit's prediction.
- The clean light build rendered Training 01 and accepted Play. Screenshots
  `target/browser-clean-light/level-current.png` and `level-play.png` show the
  scene, the pause control, and a moving ball. Objects were incorrectly black.
  The optimized native reference renders the textures correctly
  (`target/native-game-reference.png`, `target/native-game-release.log`).
- A draw-state capture showed valid lighting uniforms and interleaved arrays,
  but all black objects used mipmapped texture filters. Generating the chains
  on four bound textures restored their appearance. This was a diagnostic
  repair; the session must not be reported as a clean textured gameplay pass.
  It progressed to the pinch tutorial (`level-mipmap-fix.png`).
- TexEnvf was also ignoring enum-valued TEXTURE_ENV_MODE=MODULATE. Float/vector
  scalar setters now delegate to the SDK's integer state hook; color vectors
  and float scale values keep their existing paths. The COMBINE fixture tests
  both float variants and passes natively (`target/native-texenv-float.log`).
- GL_GENERATE_MIPMAP is now tracked per WebGL texture. Valid base-level image,
  subimage and copy writes regenerate the chain; the getter exposes the flag.
  The original --mipmap fixture verifies its default/set value, a blue texture
  under minification, then a red subimage update under minification. Native
  passes (`target/native-mipmap-minified.log`). Browser tests initially failed
  with ERR_CONNECTION_REFUSED because the static server had exited
  (`target/mipmap-before.log`, `target/texenv-float-before.log`); these were
  infrastructure failures, not reproduction of GL failures. After restarting
  the server and building, both fixtures pass twice in Chromium
  (`target/mipmap-after.log`, `target/texenv-float-after.log`).
- Input now retains independent touch IDs and forwards normalized SDL finger
  events. Mouse-wheel steps become paired pinch gestures; ordinary mouse input
  retains its existing route. Three JS input tests pass. The actual SDL adapter
  test caught SDL_PushEvent replacing timestamps, which can merge motion steps;
  touch insertion now uses SDL_PeepEvents with SDL_ADDEVENT to preserve batches.
  The first failed adapter tests are retained in `target/touch-adapter-node.log`
  and `target/touch-adapter-browser.log`; corrected tests/build are pending.

The corrected adapter passed in Node and Chromium 141
(`target/touch-adapter-node-final.log`, `target/touch-adapter-browser-final.log`).
A second Node-only test failure was the test leaving SDL's end-of-poll-cycle
sentinel queued before adding the next batch; the test now drains each poll
cycle, as the actual event loop does. The failed intermediate log is
`target/touch-adapter-node-after.log`. Three JS input tests also pass
(`node --test web/test/input.test.mjs`). The current runtime build began before
the timestamp correction and must be rebuilt once it completes.

The retained game session's audio observer counted 2,740 PCM buffers/starts,
677,975 nonzero sampled values out of 701,440, peak 0.985 at 24 kHz, with its
AudioContext running. This verifies actual game PCM delivery, not human
listening or audiovisual synchronization. The observer does not alter PCM.
The optimized native reference also advanced from Play to the pinch tutorial
(`target/native-after-play.png`). It was then terminated intentionally after
capturing the reference, to release CPU resources for browser validation.

Clean game acceptance (no injected repairs):
- Build `target/touch-mipmap-final-build.log` includes all graphics fixes and
  the timestamp-preserving touch adapter. Its MIPMAP and float COMBINE checks
  pass twice (`target/final-mipmap-runtime.log`, `target/final-combine-runtime.log`).
  Two preceding smoke-check attempts again hit a stopped server; their logs
  `target/touch-*-runtime*.log` retain ERR_CONNECTION_REFUSED. The server now
  runs in a persistent terminal session, verified by HTTP 200.
- `target/tinkerbox-clean-mipmap-touch.log`, screenshots under
  `target/browser-clean-mipmap-touch/`, and `target/mipmap-touch-driver.log`
  record the clean run. Terms clicked at 1029s, Puzzles at 1061s, Training at
  1301s, stage 01 at 1658s, Play at 3394s, and wheel pinch at 3921s. Each driver
  action required two matching screenshots. `level-01.png` shows the correctly
  textured ball, ramps and bucket. The first simulation completed and Lesson 2
  appeared. Wheel delta +480 zoomed out to reveal its placement area.
- Opening the element tray and using browser touch input dragged the ball into
  the placement circle (`valid-drag.png`). The game holds an object above the
  finger: earlier mouse drops placed it outside the valid region and were
  cancelled, rather than proving an input failure. The valid touch was released
  and Play clicked to test the second simulation; its result is pending.
- The run uses diagnostic exports only for observation. No function-table,
  texture, shader, or guest-memory repairs were applied to this worker.
- The first final normal-build process terminated with status 143 during
  linking (`target/final-release-build.log`); it is being retried in a persistent
  terminal (`target/final-release-build-retry.log`). This is not a build pass.


Clean Lesson 2 acceptance: browser touch input dragged the ball from the tray
into the placement region, release placed it, and Play simulated it into the
bucket. The actual game displayed SUCCESS, captured in
`target/browser-clean-mipmap-touch/lesson2-result.png`. This verifies two
training simulations and a user-created placement, without live runtime
repairs. Later lessons, other IPAs, real-time performance and persistent saves
remain outside the demonstrated result.

The final normal runtime retry succeeds (`target/final-release-build-retry.log`).
`npm run build` and `npm test` succeed (7 tests, zero failures), recorded in
`target/final-web-build.log` and `target/final-web-tests.log`. The final normal
runtime graphics suite is in progress in `target/final-release-*.log`.

Final normal-runtime checks completed: MIPMAP, COMBINE (float enum setters),
LIGHTING, LIGHT_ATTENUATION, LIGHT_SPOT, FOG, MAPPED, and POINT_PARAMETERS each
passed twice in Chromium 141, without page errors and with same-origin GET-only
requests (`target/final-release-<lowercase flag>.log`). Formatting and
`git diff --check` pass. The static app responds HTTP 200 at 127.0.0.1:8765.
The clean game's audio observer additionally saw 52 PCM buffers/starts at
24 kHz, 13,307 nonzero sampled values of 13,312, peak 0.689, AudioContext running.
The diagnostic game remains available on inspector port 9236; static dist now
contains the normal build, not the diagnostic export build.

Next work: profile and improve guest CPU/codec performance without bypassing
execution; validate later training levels and real touch hardware; implement
and test persistent local saves; broaden graphics conformance and other browser
coverage. T3 preview remains unavailable due host sandbox restrictions; its
HTML preview also exited unexpectedly. The documented standalone Chromium
workflow supplied the actual gameplay and regression evidence.

2026-10-26 acceleration project started:
Requirements, architecture, functional design and progress are tracked in
[wasm-jit/PRD.md](wasm-jit/PRD.md), [wasm-jit/SAD.md](wasm-jit/SAD.md),
[wasm-jit/SFDS.md](wasm-jit/SFDS.md) and
[wasm-jit/PROGRESS.md](wasm-jit/PROGRESS.md). The thread goal is active. Reuse
Unicorn's translation semantics where feasible; benchmark before selecting the
final compiler seam. Historical first Play at 3,394 seconds includes manual
interaction and is not a controlled load benchmark. No JIT speedup claimed yet.

Acceleration baseline checks (2026-10-26): `cargo fmt --all --check`,
`git diff --check`, `cargo test --locked -p touchhle-browser` (9 tests),
`CMAKE_POLICY_VERSION_MINIMUM=3.5 cargo test --lib -- --skip test_app`
(30 tests), and `cd web && npm run build && npm test` (7 tests) pass.
The pre-existing browser integration is being committed as the preserved source
baseline, separately from the acceleration design and implementation.
Baseline source and plans were committed together in 0780424e. The first staged
whitespace check flagged blank unified-diff context lines in existing patches;
the initial unstaged check had not inspected untracked files. `.gitattributes`
now disables only end-of-line whitespace checking for patch files, whose blank
context marker is required syntax. Other files retain the normal checks.
T3 preview_open failed: "Chrome will not start its sandbox as root". Browser
validation uses the documented standalone Chromium workflow.

TCI-to-Wasm prototype (2026-10-26, opt-in; not game acceptance):
- Added runtime Wasm emission over pinned Unicorn TCI, preserving the original
  interpreter for helper operations and cold blocks. Generated modules share
  runtime memory; dynamic TB links are read at execution time. Cache entries
  are replaced on retranslation and cleared on translation flush.
- `node --test web/test/tci-jit.test.mjs`: 6 groups pass, including 8,000 seeded
  integer/shift cases, comparisons/branches, 64-bit arithmetic, memory growth,
  mutable links, fallback state transfer and cache replacement/reset.
- `source target/emsdk/emsdk_env.sh; node web/patch-unicorn.mjs; node
  web/build-shared-cpu.mjs`: builds pass, retaining upstream unused-function
  warnings and fixture dead-code warnings. Shared CPU/fiber suite passes in
  Node for interpreter and forced JIT. JIT: 239 compiled blocks, 61,036 cache
  hits, zero compile failures; log `target/jit-shared-node.log`.
- `TEST_SHARED_CPU=1 TEST_JIT=1 TEST_FIBERS=1
  PLAYWRIGHT_MODULE=/tmp/touchhle-browser-tools/node_modules/playwright/index.mjs
  node web/test-browser.mjs`: passes in Chromium 141 with no page errors;
  log `target/jit-shared-browser.log`. Unsupported madvise/mprotect warnings
  remain, as before. These tests include guest fault handling and nested fibers.
- `source target/emsdk/emsdk_env.sh; node web/bench-cpu.mjs`: original ARM
  loops through the production adapter, 5 fresh CPU instances per case/backend.
  Node v22.22.3 on Intel i9-13900H, Linux x86_64. Median milliseconds:
  300,001 instructions: interpreter 52.891, JIT 56.475 (6.8% slower);
  1,000,001: 79.531 vs 48.590 (1.64x);
  6,600,001: 300.744 vs 52.991 (5.68x).
  First-trial compilation/tiering is included. Log `target/jit-cpu-benchmark.log`.
  This synthetic arithmetic result is not FPS or TinkerBox load time.
- Full runtime build passes (`target/jit-runtime-build.log`). Current JIT is
  selected by `?cpu=jit`; `&jitThreshold=1` forces early compilation for tests.
  Default remains interpreter. Full-game profiling/regressions are in progress.
The first full-runtime HLE/mipmap checks failed during instantiation with
`Import #457 "env" "touchhle_tci_init": function import requires a callable`;
the attempted startup profile then found no runtime worker. Failed logs are
`target/jit-runtime-{hle,mipmap}.log` and `target/jit-profile.log`. Investigation
includes ruling out mismatched JS/Wasm served during the ongoing runtime link.
No game result is claimed from those attempts.
After waiting for the full link to finish, instantiation succeeds without a
linkage code change: the earlier failure served mismatched JS/Wasm during build.
A subsequent harness failure was missing final counters when ExitStatus reached
the worker catch instead of onExit; both paths now report counters. Final
forced-JIT HLE and MIPMAP fixtures pass twice in Chromium, requiring compiled
blocks and zero compile failures (`target/jit-runtime-hle-final.log`,
`target/jit-runtime-mipmap-final.log`). Do not test served dist during a build.

Startup sampling of the first integrated JIT (`web/profile-runtime.mjs`, 10 s
initial delay + 15 s Profiler-only sample, local owned IPA, Chromium 141) passes
without page errors. At ~22 s it reports 287 compiled blocks, 863,027 cache hits,
zero compilation failures and 616 ms cumulative compilation. Sample self-time:
TCI interpreter/helper execution 21.0%, translation generation 6.3%, store helper
5.4%, address translation 5.2%, load helper 4.5%, memory mapping 4.4%, with
additional register-transfer overhead. `target/jit-profile/{summary.json,
worker.cpuprofile,logs.json,page.png}` retains evidence. This sampled run is not
a startup acceptance timing, and had not reached the main menu.

Follow-up experiments:
- Selective register transfers for existing memory helpers and bounded compiler
  retention (16 MiB emitted code, 4,096 modules, 65,536 metadata entries) added.
  These bounds cover retained emitted code, not total browser machine-code RAM.
- Direct Wasm-table helper calls passed smoke tests but hung the medium-loop
  benchmark after earlier CPU instances. Terminated those runs and removed the
  optimization. Failed logs: `target/jit-{eager,lazy}-benchmark.log`, diagnostic
  `target/jit-runaway.log`. Isolated single-instance loops passed, so they were
  insufficient coverage. Benchmarks now have a slice limit to detect recurrence.
- Keep VFP registers/FPSCR in Unicorn between ordinary HLE calls; materialize
  only at context swaps. The production-adapter fixture now checks different
  VFP values, repeated calls, swaps and FPSCR restoration. Node interpreter/JIT
  suites pass (`target/jit-lazy-node.log`), 259 compiled blocks, no failures.
- With direct calls disabled, all five trials of each benchmark finish
  (`target/jit-without-direct.log`), including 50,000 repeated SVCs. Eager VFP
  transfer interpreter median ~283 ms vs lazy ~150 ms in the earlier same-helper
  comparison; final controlled results and browser regressions are pending.

Refined JIT game observation (180-second bounded run, not acceptance):
`PLAYWRIGHT_MODULE=/tmp/touchhle-browser-tools/node_modules/playwright/index.mjs
TEST_URL='http://127.0.0.1:8765/?cpu=jit'
INSPECTION_DIR=target/browser-jit-refined/ RUN_SECONDS=180
node web/inspect-ipa.mjs '/root/local-ipas/TinkerBox HD 1.4.1.ipa'`.
The final screenshot still shows the Autodesk loading splash. At 183 s:
6,573 compiled blocks, 27,486,486 compiled hits, zero compile failures,
6,051 ms compilation, 337,813 registered translations, 9 cache resets (4 from
metadata limits). No menu or gameplay performance pass. Logs/screenshots remain
local. The image-guarded menu driver did not match a stage. This proves the
current acceleration is insufficient for the startup target.

New original cache fixture checks guest-store invalidation of compiled code,
write protection, unmap/remap and cross-page reads/faults; interpreter and forced
JIT pass in Node (`target/jit-cache-node.log`). Full refined MIPMAP passes twice
in Chromium (`target/jit-refined-mipmap-final.log`). An earlier refined-MIPMAP
attempt again ran during linking and failed; retained in
`target/jit-refined-mipmap.log`. The final run waited for confirmed build exit.
Integer register transfers now use Unicorn's existing batch API; isolated
old/lazy/batch adapter benchmarks and expanded browser checks are in progress.

Controlled register-transfer comparison: same compiler/helper path, Node
v22.22.3, five trials per backend/workload. `CPU_ADAPTER` selects an ignored copy
of the prior adapter when running `node web/bench-cpu.mjs`; no game assets used.
For 50,000 SVC exits, interpreter/JIT median milliseconds were eager VFP
279.269/287.191, lazy VFP 152.219/161.071, and lazy VFP + batched integer registers
142.786/145.545. Retain both small adapter changes (~1.97x faster JIT host-call
benchmark). Arithmetic-loop timings stayed similar: final JIT long-loop median
50.739 ms versus interpreter 294.841 ms. Tiny loops remain slower in JIT mode.
Logs: `target/jit-{eager,lazy,batch}-final.log`. The first expanded batch-suite
invocation had an incorrect relative require path in an ignored local runner
(`target/jit-batch-node.log`); corrected rerun is `target/jit-batch-node-final.log`.

Compiled-block dispatch cache: a bounded 8,192-entry C cache skips JavaScript
lookups for compiled blocks; generated-code eviction clears it before recycling
Wasm table slots, and retranslation clears its corresponding entry. The
interpreter-only mode now also skips the unnecessary JS lookup. C counts actual
compiled dispatches in shared memory. Unit tests exercise eviction ordering and
recompilation; expanded CPU suites pass in Node and Chromium.
`target/jit-dispatch-{emitter,node,browser}.log` retains results.

Five-trial same-build medians (`target/jit-dispatch-benchmark.log`): tiny loop
53.107 ms interpreter / 37.759 ms JIT, medium 78.961 / 36.161, long 293.475 /
39.628, 50k SVC 132.505 / 133.732. Tiny blocks now improve rather than regress.
Narrowing helper-call register transfers to the actual TCI ABI retains the
interpreter helper path (not the rejected direct calls); expanded Node suite
passes, with medians 53.667 / 33.344, 78.273 / 32.640, 292.512 / 35.568 and
133.647 / 129.372 (`target/jit-helper-state-{node,benchmark}.log`).
These are CPU microbenchmarks, not a game startup/FPS result.

Native startup reference: optimized native binary (reported dff1fa77, existing
compatibility work), Intel i9-13900H, Xvfb 1280x1024, GLES1-on-GL2, null audio,
fresh sandbox per trial. `xvfb-run -a -s '-screen 0 1280x1024x24' python3
 target/native-startup-check.py` compares the terms-button crop against a local
reference twice, sampling every 0.5 s. Terms detected at 60.337, 58.579, 58.548 s
(median 58.579); screenshot/matching overhead included. This is a local software
rendering reference, not physical-device timing. Evidence stays in
`target/native-startup-check/` and `target/native-startup-check.log`.

Native GDB samples (`target/native-profile/stack-{5,15,25,35,45}.log`) show
Dynarmic translating at the earlier points, and guest comparator calls under
`qsort_rec` at both later points. Inspection confirms a first-element-pivot
quicksort with quadratic sorted/equal-input behavior and unbounded recursion.
An in-place heapsort replacement preserves guest comparator/swap calls, avoids
allocation, and bounds comparisons. Three new correctness/complexity tests pass
with the existing native suite (33/33, `target/jit-qsort-native-tests.log`).
Native optimized build succeeds (`target/jit-qsort-native-build.log`) with the
existing stb warnings; repeat game startup measurement is in progress.

Instruction-budget experiment: emit decrement/check operations in TCG instead
of invoking the generic Unicorn block hook every block. Budget exhaustion keeps
the existing stop/exception path; exact debugger stepping retains its hook and
mode-switch cache flush. Mixed-width Thumb now charges one tick per instruction,
not one per halfword. The adapter, context/cache/memory and nested-fiber suites
pass in Node and Chromium (`target/jit-budget-{node,browser}.log`). Initial patch
application failed due overlapping patch context and missing upstream EOF
newlines; the final patch is independently reversible and idempotent
(`target/jit-budget-build-fixed.log`). Initial CPU timings overlap the native
sampling experiment and must be repeated in isolation before comparison.

After heapsort, the same fresh native terms-screen trials measured 56.356,
56.455, 56.353 s (median 56.356, ~3.8% below the 58.579 s baseline). This is a
modest end-to-end improvement; the sampled qsort stacks did not establish its
share of total startup. Keep the bounded algorithm for correctness/robustness
and measured benefit, but do not attribute the whole loading problem to it.
Logs: `target/native-startup-qsort.log`, images under the matching directory.

The normal exit check now emits a TCG load/branch and calls the existing exit
helper only when its original pending-exit predicate is true. Node CPU/context,
cache, memory and fiber tests pass. Isolated five-trial microbenchmark medians
(`target/jit-exit-benchmark.log`): interpreter/JIT milliseconds: tiny 42.406 /
10.254, medium 68.415 / 9.406, long 283.050 / 12.551, 50k SVC 118.215 / 105.818.
JIT ranges respectively 8.942–53.559, 8.876–11.521, 11.388–21.515 and
105.426–110.396 ms; first compilation/tiering trials included. Long repeated-add
blocks are particularly easy for the browser compiler to optimize; their
22.6x ratio must not be generalized to game performance. Full runtime rebuild
and game measurements are pending.

Full runtime rebuild completed successfully with budget/exit checks and heapsort
(`target/jit-exit-runtime-build.log`). Node CPU and Chromium shared CPU/fibers
pass (`target/jit-exit-{node,browser}.log`); forced-JIT mipmap HLE fixture passes
twice (`target/jit-exit-mipmap.log`). Five-minute game run still has no matched
menu at 302.8 s: 55,437,560 compiled dispatches, zero compilation failures,
6,890 cumulative compilations, 5,068.5 ms cumulative compilation time and no
metadata resets (`target/jit-budget-game.log`). Startup acceptance remains unmet.
A longer run with attached Profiler is collecting later loading evidence.

Later startup sample: `PLAYWRIGHT_MODULE=/tmp/touchhle-browser-tools/node_modules/playwright/index.mjs
PROFILE_CDP=http://127.0.0.1:9241 PROFILE_DELAY_MS=100000 PROFILE_MS=15000
PROFILE_DIR=target/jit-late-profile node web/profile-runtime.mjs` attached to the
existing inspector without Debugger. Chromium 141, 13,671 samples, no page errors.
Top self samples: idle 2,006, maybeStopUnwind 1,753, TCI interpreter 1,707,
load_helper 960, wasm-to-js 931, js-to-wasm 662, address translation 636.
Profiler output and screenshots are local-only. Attaching/disconnecting preserved
the inspector run. This run later overlaps builds, so is not an acceptance timing.

Inspection shows the JIT imports the Asyncify-wrapped exported single-op helper,
forcing a JS round trip for each guest-memory/VFP helper. The next experiment
passes that same C function's table index at initialization and imports its raw
Wasm function. It does not replace helper implementations or their exceptions;
CPU execution is synchronous and already excluded from Asyncify. This differs
from the rejected direct normalized QEMU-helper experiment. Node CPU/fault/cache/
context/fiber regressions pass (`target/jit-raw-step-node.log`). Full runtime and
browser tests are pending. Inspector now joins its control-file path correctly
with or without a trailing directory slash; CDP attachment is opt-in, loopback.

Raw-helper Chromium shared CPU/fiber checks also pass
(`target/jit-raw-step-browser.log`). First full runtime build failed its patch
verification because a separate raw-helper patch overlapped the existing JIT
patch (`target/jit-raw-step-runtime-build.log`). Consolidated the edit into the
JIT patch; idempotent patch/build succeeds before the runtime rebuild
(`target/jit-raw-step-idempotent.log`). No benchmark timing is taken during builds.
Added a 500,001-instruction read/modify/write guest-memory benchmark with output
assertions and optional CPU_ASYNCIFY=1 to represent the production wrapper setup.
The later inspector run omitted a trailing directory slash; its screenshots were
written adjacent to the directory, so the driver could not observe them. All
output paths now use join. Manual inspection at 392 s still shows startup splash;
this diagnostic run is not a valid automated menu timing trial.

Consolidated raw-helper runtime build completed successfully
(`target/jit-raw-step-runtime-build-fixed.log`); forced-JIT actual HLE mipmap
fixture passes twice (`target/jit-raw-step-mipmap.log`). All 14 JS tests pass
(`target/jit-raw-step-js.log`), Rust formatting passes. Prior diagnostic game
still shows splash at 552 s; its middle portion overlapped compilation.

Isolated five-trial Asyncify benchmark (`CPU_ASYNCIFY=1 node web/bench-cpu.mjs`,
Node 22.22.3, i9-13900H, no browser/build running): interpreter/raw-JIT medians
(ms): tiny 70.094/10.198, medium 99.358/9.487, long 306.669/14.209,
memory 166.696/101.705, 50k SVC 227.552/186.785.
For a controlled wrapper comparison, copy generated benchmark.js to ignored
benchmark-wrapped.js, replace its single `wasmTable.get(step)` expression with
`wasmExports["touchhle_tci_step"]`, and run that factory with enableTciJit=true.
Both use the identical benchmark.wasm. Wrapped-JIT medians: tiny 11.093,
medium 10.655, long 16.743, memory 144.014, SVC 189.579 ms. Memory raw range
100.364–118.227 vs wrapped 140.666–163.203 ms (~29.4% median reduction).
Logs: `target/jit-{raw,wrapped}-step-async-benchmark.log`. Compilation/tiering
included; these are synthetic measurements, not game FPS or startup claims.
Actual Web Audio PCM/gain/scheduling/stop/cleanup test passes
(`target/jit-raw-step-audio.log`). Fresh full-game run and later profile underway.

Raw-step later profile (same 100 s delay/15 s sampling protocol, Chromium141,
13,786 samples; `target/jit-raw-step-profile/summary.json`) removes Asyncify
wrapper functions from the top costs. TCI interpreter 2,585, idle 2,547,
load_helper 1,229, generated Wasm 1,004, mapping lookup 774, address translation
692, single-op helper 601 and store_helper 534 self samples. The phase is not
instruction-identical to the prior sample; compare diagnosis, not percentages as
an end-to-end speedup. Subsequent game progress overlaps builds and is diagnostic.

Fast-read experiment: only the production adapter opts into its largest immutable,
identity-mapped RWX Rust-owned region. It has no unmap/protect/valid-read-hook API.
Naturally aligned little-endian 32-bit TCI reads entirely inside that region can
read its host pointer directly; stricter alignment requests, all other sizes,
other mappings and faults retain soft-MMU handling. Stores always retain Unicorn
invalidation. Wasm memory growth preserves the numeric host pointer. This API
must not be enabled for general Unicorn engines or mutable mappings.
Expanded production-adapter tests exercise both endpoints, unaligned reads,
unmapped/cross-boundary faults, hot compiled loads and 64 MiB memory growth.
Node and Chromium shared CPU/cache/context/fiber checks pass
(`target/jit-fast-read-{node,browser}.log`); existing general-Unicorn protection,
unmap/remap and guest-store invalidation cases still pass. Patch application is
idempotent (`target/jit-fast-read-idempotent.log`). Full runtime build/measurement
pending; do not retain solely on microbenchmark expectations.

Fast-read full runtime build completes (`target/jit-fast-read-runtime-build.log`).
Forced-JIT mipmap fixture passes twice; broader Chromium suite also passes each
fixture twice: TEST_COMBINE, TEST_LIGHTING, TEST_LIGHT_ATTENUATION, TEST_LIGHT_SPOT,
TEST_FOG, TEST_MAPPED, TEST_POINT_PARAMETERS, TEST_PRESENT_BUFFERS. Commands use
`TEST_URL=http://127.0.0.1:8765/?cpu=jit&jitThreshold=1`, the named flag=1 and
`PLAYWRIGHT_MODULE=/tmp/touchhle-browser-tools/node_modules/playwright/index.mjs
node web/test-runtime.mjs`. Logs: `target/jit-fast-read-TEST_*.log`. Static GET-only
network assertions pass. Isolated fast-read performance measurement pending.
Inspector accepts optional INSPECTION_OPTIONS standard touchHLE per-bundle
options injected only into its worker response, to enable --print-fps without
changing served artifacts or gameplay state. This diagnostic path needs a run.

Fast reads retained after isolated same-library, same-Asyncify benchmark:
five-trial JIT memory median 83.610 ms (82.140–92.348) versus 100.565 ms
(99.975–102.435) with registration disabled (~16.9% reduction). Interpreter
memory medians 138.048 versus 167.373 ms. Other JIT medians fast/disabled:
tiny 10.262/9.991, medium 9.238/9.317, long 13.367/13.510, SVC181.107/180.979 ms.
Commands: CPU_ASYNCIFY=1 node web/bench-cpu.mjs; comparison sets
CPU_ADAPTER=target/browser-cpu/no-fast-read.c, a copy of src/web/cpu.c with only
its touchHLE_uc_read_region call removed. Logs `target/jit-{fast,no-fast}-read-benchmark.log`.
The uc_version export annotation was preserved when positioning the new API;
corrected patch reapplication/build passes (`target/jit-fast-read-export-build.log`).

Raw-helper diagnostic game reached the terms screen (driver click813 s) and
main menu (click843 s); stopped at904 s before a playable level. No compiler
failures in 144 million compiled dispatches. This included builds/profiles and
is not an isolated startup trial. Logs `target/jit-raw-step-{game,driver}.log`.
Later sample at ~750 s still shows memory helpers/TCI fallback dominating,
with 24% idle samples (`target/jit-raw-step-late-profile/summary.json`).

Fast-read diagnostic build (`TOUCHHLE_WEB_DEBUG=1 node web/build-runtime.mjs`)
completed. New 3,600 s inspector run enables DIAGNOSTICS=1 and
INSPECTION_OPTIONS='com.autodesk.tinkerbox: --print-fps'; the guest loader confirms
that standard option was applied. Files stay local under target/browser-jit-fast-read/.
This is a diagnostic/gameplay run, not a release timing trial.

Fast-read startup profile (`target/jit-fast-read-profile/summary.json`, same
15 s sample protocol) shifts load_helper from 1,229 to443 self samples; TCI
single-op dispatch is now the largest CPU category. Guest context snapshots
identify FMOD Vorbis decode, zlib crc32/inflate_fast, and Ogre::Image::scale.
Symbol lookup/disassembly uses the locally owned Mach-O symbol table; no game
code/assets are published. Public Ogre1.7.0 source consulted:
https://github.com/OGRECave/ogre/tree/v1-7-0/RenderSystems/GLES/src
It distinguishes GPU mipmaps from CPU image resizing. Its NPOT capability probe
is commented out, and this game's binary contains no matching NPOT extension
strings; advertising a new GL extension would not establish a safe speedup.
An initial v1-7-4 source URL returned404; git ls-remote identified v1-7-0.

Next experiment emits the existing bounded 32-bit read directly in Wasm, with
raw-helper fallback. C provides structure offsets instead of hardcoded ABI
layout. The original single-region version passes eight JS test groups, actual
Node/Chromium CPU/fiber checks and HLE mipmap twice
(`target/jit-inline-read-{unit,node,browser,mipmap}.log`). The expanded version
covers low RAM and high stack using one immutable region per address-space half;
regions spanning the boundary remain on the MMU path. Tests cover first/last
words, high-address unsigned bounds, unavailable regions, unaligned/other formats,
stricter alignment, multiple engines and memory growth. Eight JS groups and actual
Node CPU checks pass (`target/jit-inline-stack-{unit,node}.log`). Browser/runtime
checks and isolated performance measurement are pending. Reverse/reapply of all
patches in declared order passes in a temporary source copy; git apply reports
an existing extra blank line at the end of the budget patch (not a build failure).

Inline low/high reads: Chromium CPU/fiber checks and forced-JIT actual HLE
mipmap fixture pass twice (`target/jit-inline-stack-{browser,mipmap}.log`), full
runtime build completes (`target/jit-inline-stack-runtime-build.log`). Corrected
unsigned high-address/memory-growth tests pass in Node and JS.

To avoid competing active browser CPU work while preserving the long diagnostic
game, its owned Chromium descendant processes were suspended with SIGSTOP and
resumed in finally with SIGCONT; benchmark subprocesses had a25 s timeout. The
inspector itself stayed live. First pause19.545 s (includes benchmark compilation),
second7.039 s. This makes the game run unsuitable for startup/simulation timing;
no acceptance timing is claimed. CPU benchmark has no concurrent builds or active
game execution, but retains the suspended browser's memory footprint.

Five-trial Asyncify medians (`target/jit-inline-stack-benchmark.log`): interpreter/
JIT ms tiny65.172/10.191, medium90.643/9.533, long304.210/14.175,
memory138.238/75.007, SVC226.271/197.865. A tighter same-Wasm A/B/A comparison
removes only readLayout from a copied generated JS initializer, leaving the
existing C read optimization enabled. Memory medians inline79.113, helper81.952,
inline75.633 ms; ranges77.805–107.013,81.890–83.377,74.771–76.383. SVC medians
184.268/174.603/175.756 show run-order variability, not a demonstrated regression
or improvement. Log `target/jit-inline-stack-comparison.log`; pause logs share
that prefix. Retain the bounded inline path for its measured modest memory benefit;
do not extrapolate to game speed. Standard builds remain opt-in JIT.

### Data stores and cooperative CPU yields (2026-10-26)

Extended the opted-in fixed mapping path to naturally aligned little-endian
8/16/32-bit Wasm reads/writes (including signed byte/halfword reads). C TCI has
32-bit fast reads/stores. A per-engine 128 KiB bitmap marks every translated
4 KiB page permanently. Stores to any marked page retain Unicorn invalidation;
all unaligned, out-of-region and unsupported accesses retain helpers. The adapter
contract excludes physical aliases, mutable mappings/permissions and valid-memory
hooks; generic Unicorn engines do not opt in. Actual ARM tests cover a data page
becoming executable and subsequent word/halfword/byte writes from already compiled
stores, alongside endpoint reads/faults, separate engines and memory growth.
The original store test polluted a shared static high-memory fixture and failed
an assertion (`target/jit-store-fault-node.log`); each CPU now owns its high-memory
allocation. Final checks below pass. No failure is being discarded.

Gameplay profiling of the prior run found 44% idle samples. Replace only the
scheduler's zero-delay CPU yield with an Asyncify MessageChannel callback;
positive-duration sleeps are unchanged. Node retains timer fallback. The compiled
scheduler harness checks preserved local state, input pings and positive sleep.
Its initial Blob worker was blocked by CSP (`target/jit-scheduler-check.log`);
use a generated same-origin worker. Fixed harness
(`target/jit-scheduler-check-fixed.log`): 200 timer yields 834.4/830.3/815.0 ms;
2000 channel yields 93.0/57.9/114.1 ms; requested 20 ms sleep 20.4 ms. These are
scheduler measurements, not game speed. CPU slices remain 100,000 instructions.

Raise compiled-module cap 4096 to 8192, retaining the 16 MiB emitted-code cap
and 65,536 translation metadata cap. Add capacity eviction counter: the previous
long game compiled 151k blocks/275 MB cumulatively and spent ~106 s compiling.
The new cap's game effect is pending. Load compiler JS separately in JIT workers
after runtime initialization and before guest execution, permitting compiler-only
iterations without relinking Rust/LLVM. CPU fixtures remain self-contained.

Rejected experiment: cache fixed-region metadata in extra block locals. Correctness
passed but separate-data median 32.124 to 32.251 ms and same-code-page median
77.015 to 77.449 ms did not improve; reverted before final validation.

Final validation (Node 22.22.3, Chromium 141.0.7390.37, Linux x86_64):
- Shared CPU Node and Chromium/fibers pass; JS 17 tests pass
  (`target/jit-subword-final-{build,node,browser,js}.log`).
- Forced-JIT HLE MIPMAP, COMBINE, LIGHTING, LIGHT_ATTENUATION, LIGHT_SPOT, FOG,
  MAPPED, POINT_PARAMETERS, PRESENT_BUFFERS each pass twice
  (`target/jit-scheduler-TEST_*.log`); actual Web Audio passes
  (`target/jit-scheduler-audio.log`).
- Browser Rust 9/native 33 tests pass (`target/jit-memory-scheduler-{rust-browser,native}.log`);
  cargo fmt --all --check and git diff --check pass. All seven Unicorn patches
  reverse/reapply byte-identically across 12 files in a temporary copy; existing
  budget-patch EOF blank-line warning remains.
- Isolated five-trial Asyncify CPU medians, interpreter/JIT ms
  (`CPU_ASYNCIFY=1 node web/bench-cpu.mjs`, `target/jit-subword-final-benchmark.log`):
  tiny 65.521/10.265, medium 92.254/9.601, long 303.099/13.116,
  code-page memory 143.622/78.774, separate-data memory 103.277/31.968,
  50k SVC 237.808/186.907. i9-13900H; no concurrent game/build. Trivial long
  arithmetic favors optimization and is not representative game evidence.

Prior single-region-read game diagnostic (`target/jit-fast-read-game.log`) reached
first Play at 2455 s and completed the first simulation, then verified Lesson2
ball placement. Second Play at 3592 s preceded timeout at 3604 s, so Lesson2
SUCCESS is unverified. Reported gameplay ~0.5–1.5 FPS, later static Lesson2 ~2–3
FPS. Profiling, builds and two benchmark suspensions contaminated wall-clock
timing; these are diagnostic observations only. Under-10-second startup and
real-time gameplay remain unmet. A fresh scheduler/store/cache run is underway
without simultaneous builds/benchmarks (`target/jit-scheduler-game.log`). Physical
phones/tablets and other browser engines remain untested. Next: validate both
training successes and measure startup, frame rate and simulation pace, then
profile the remaining bottleneck separately from timing runs.

### Normal instruction-budget returns (2026-10-26)

The scheduler/store/cache game run showed terms by screenshot292 s and main
menu by322 s (driver sampling, not precise transition timestamps). Menu reports
~3–4 FPS. These observations precede profiling/builds, but are one headless
Chromium run, not the required three acceptance trials. The run then became
explicitly diagnostic: `target/jit-scheduler-menu-profile/summary.json` has13,607
samples, 3,974 in TCI interpreter/helper dispatch, 2,955 generated Wasm, 2,890
in `__wasm_longjmp`, 1,014 in exit-request helper and only68 idle. Stack inspection
attributes the unwind cost to `touchhle_budget_stop`.

The adapter budget branch already synchronizes PC before executing any guest
instruction in the next block. It now calls uc_emu_stop then emits exit_tb,
returning normally through cpu_tb_exec's unlock and cpu_exec's stop handling.
Actual faults and other exceptional paths retain existing unwinding. Added a
Thumb IT test split across a4 KiB page boundary: exhaust budget after IT, verify
unexecuted PC/registers, resume with both true/false predicates. This specifically
checks pending conditional state across a budget return.

Validation correction: initial `jit-budget-return-*` and `jit-budget-it-*` tests
and the first benchmark linked the old Unicorn archive. Those results establish
only baseline fixture behavior, not this implementation. After explicit
`node web/patch-unicorn.mjs`, CPU interpreter/JIT Node and Chromium/fibers pass
(`target/jit-budget-return-rebuilt-{build,node,browser}.log`). Shared CPU, benchmark
and full-runtime builders now run the patch/build step themselves to prevent
stale archives. No failed or stale test is treated as implementation evidence.

Isolated five-trial Asyncify medians after rebuilding
(`target/jit-budget-return-rebuilt-benchmark.log`), interpreter/JIT ms:
tiny66.545/10.774, medium92.217/9.473, long302.847/11.525,
code-page memory140.961/77.297, separate-data memory101.553/32.351,
SVC220.931/173.699. Previous long JIT13.116 ms; memory changes are small/mixed.
The owned diagnostic browser was suspended/resumed in finally for20.347 s during
the stale-archive benchmark and21.139 s during the rebuilt benchmark. Its remaining
wall-clock game timings are not acceptance data. Full runtime rebuild and HLE
regressions are pending; the active game retains the previous loaded build.

Normal-budget-return full runtime build completed. Forced-JIT HLE mipmap passes
twice with GET-only static traffic; all17 JS tests pass
(`target/jit-budget-return-{runtime-build,mipmap,js}.log`). Formatting/diff and
patch reverse/reapply checks pass (existing EOF whitespace warning unchanged).

### Inline post-memory exit predicate (2026-10-26)

Source inspection links the profile's exit-check cost to Unicorn's helper after
memory operations. TCG cannot insert a branch there without disrupting liveness;
the Wasm compiler can preserve its register locals. C now supplies the exact
normalized helper table identity and env-relative icount-decrement offset. Only
that immediate helper call is specialized. If the signed exit flag is negative
and the delay-slot argument is zero, the original single-op helper still runs,
including GETPC, restoration and unwinding. Otherwise write its normalized void
return (r0:r1=0) without calling. Other helpers and dynamic calls are unchanged.
This does not reintroduce the rejected direct normalized-helper call experiment.

Node actual CPU and Chromium/fibers pass (`target/jit-exit-predicate-{build,node,
browser}.log`); JS18 pass (`target/jit-exit-predicate-js.log`), including no-request,
pending-request, delay-slot, return-register and throwing fallback cases. Added
actual Unicorn valid-memory hook test:64 consecutive reads request stop, never
execute the following ADD, then removing the hook permits that ADD. Node and
Chromium/fibers pass (`target/jit-exit-stop-{build,node,browser}.log`). Existing
fault/unmap/protection/code-write and Thumb IT resume tests remain enabled.

Same-Wasm A/B/A comparison uses a copied generated initializer with only
`exitCheck` metadata renamed to disable specialization. Five trials per case:
- Separate-data memory: specialized11.418, helper32.048, specialized11.231 ms.
- Code-page memory: specialized59.361, helper77.607, specialized58.182 ms.
- Long arithmetic:11.920/11.732/11.319 ms; SVC184.138/179.450/184.454 ms,
  illustrating variability on unaffected workloads.
Logs `target/jit-exit-predicate-comparison.log`. An initial comparison script
still named an older helper-read artifact; its output is preserved as
`target/jit-exit-predicate-comparison-invalid.log` and excluded. Fixed script
names the new helper-exit copy. Diagnostic browser suspended/resumed in finally:
20.994 s for benchmark compilation/execution,7.589 s for valid A/B/A comparison;
the invalid comparison pause has its separate log. No concurrent builds during
valid benchmarks. Retain specialization for the reproducible memory improvement;
full runtime rebuild and game effect remain pending.

The older scheduler/store game run has verified Lesson1 SUCCESS (screenshot1240 s),
Lesson2 pinch (driver1393 s), tray opening and genuine touch ball placement
(`target/browser-jit-scheduler/lesson2-placed.png`). It is heavily diagnostic
with profiles/builds/suspensions; no acceptance timing is inferred. Second Play
has been requested, SUCCESS pending. New backend changes are not in that already
loaded worker.

Scheduler/store build also completes Lesson2 SUCCESS: second Play at1526 s,
SUCCESS visible in `target/browser-jit-scheduler/canvas-1593.png`. This validates
the two requested training interactions for that build, not real-time performance.
The owned diagnostic inspector was terminated after recording success to release
CPU/memory for the next clean run; any termination status is intentional.

The predicate full-runtime build returned status143 during final optimization,
with no compiler error in its log, after the diagnostic inspector was terminated.
The cause is not established; do not treat its artifacts as validated. Rebuilding
with no active game (`target/jit-exit-predicate-runtime-retry.log`) before testing.

Retry full runtime build completed successfully. The first HLE test then failed
before guest execution with `page.goto: net::ERR_CONNECTION_REFUSED` because the
local static server had stopped (`target/jit-exit-predicate-TEST_MIPMAP.log`).
Restarted the loopback server and rerunning fixtures under `jit-exit-predicate-retry-*`.
The added different-helper-identity test brings JS total to19 passing tests
(`target/jit-exit-predicate-final-js.log`).

With the server restored, all nine forced-JIT HLE graphics fixtures pass twice
(MIPMAP, COMBINE, LIGHTING, LIGHT_ATTENUATION, LIGHT_SPOT, FOG, MAPPED,
POINT_PARAMETERS, PRESENT_BUFFERS), with local GET-only traffic. Actual Web Audio
passes (`target/jit-exit-predicate-retry-TEST_*.log`, `jit-exit-predicate-audio.log`).
Patch roundtrip and formatting/diff checks pass. Starting a fresh full game on
this verified runtime with no concurrent build or benchmark.

### Clean predicate-backend game interval and loop experiment (2026-10-26)

Fresh Chromium run on a03e0005 (`target/jit-exit-predicate-game.log`) had no
concurrent build/benchmark/profile through first Play. Terms visible by182 s,
main menu by212 s. Exact driver inputs: terms185, main215, puzzles246,
training286, Play617 s. Thus level-selection-to-Play was331 s including screenshot
matching delay (screenshots every10 s, two matches). First matching playable
screenshot is613 s. These are single-run local-server observations, not3-trial
medians or precise subsecond transition times. Startup/level targets remain unmet.
Reported simulation~2.5–2.7 FPS; simulation speed and input p95 are unmeasured.
The run became diagnostic after first Play. Lesson2 genuine touch placement and
SUCCESS were verified (`canvas-1134.png`), followed by Lesson3. No injected game
state. Second Play1087 s is diagnostic, not a timing comparison.

Post-Play profile (`target/jit-exit-predicate-play-profile/summary.json`):13,997
samples, idle8,371, generated Wasm1,106, interpreter/helper455, cpu_exec433,
getParameter349, dispatcher307, run_call304. This overlaps progression into later
training screens, not a sustained60-second physics sample. No `/dev/dri` hardware
GPU is exposed. Timer instrumentation found50 zero-delay callbacks totaling5.7 ms
across15,187.7 ms; requested timeouts do not explain the idle samples. Initial
Playwright worker lookup failed (no worker on the CDP-attached page); direct
Runtime attachment succeeded without enabling Debugger. GL method timing over
15,111 ms totals roughly0.65 s, primarily synchronous state queries. Probe logs:
`jit-exit-predicate-{timers,timers-retry,gl}.log`.

MessagePort instrumentation identifies a much larger delay:422 deliveries spend
9,077.9 ms pending across15,129.8 ms; max249 ms. An in-place diagnostic routing
of that channel through scheduler.yield reduces510 deliveries to35.4 ms total,
max3.1 ms, over15,674 ms, but reported FPS improves only modestly (~3.4 vs~3).
A repeated channel probe initially saw zero events because the preceding test
restored an own native postMessage property, bypassing prototype instrumentation.
Delete that diagnostic-only own property before probing:442 deliveries again
spend9,105.5 ms pending over15,172.5 ms. This invalid repeat is retained in its log;
use `jit-exit-predicate-yields-repeat-fixed.log`. A longer scheduler-profile probe
is pending; no scheduler API source change has been accepted yet.

Compiler experiment: same-block linked backedges branch to an outer Wasm loop,
keeping TCI temporaries in locals. Every iteration rereads the mutable link and
still executes the block's budget/exit checks. Other targets return to C with
registers saved. No native tail-call extension or speculative cross-block merge.
JS20 pass, Node/Chromium CPU/fibers pass, including an actual warmed loop whose
own STR is replaced by a guest store with MOV; it must execute the new instruction
(`target/jit-self-{loop,mod-loop}-{build,node,browser}.log`).

Same-Wasm five-trial A/B/A (loop enabled/disabled/enabled), ms:
tiny5.284/9.622/3.889; medium4.694/9.370/3.698; long6.786/10.987/5.744;
code-page memory54.297/56.558/50.977; separate-data7.007/10.564/6.057;
SVC182.750/179.413/178.692. Disable only the emitted self-backedge in a copied JS
initializer, retaining identical runtime Wasm. Logs `jit-self-loop-comparison.log`.
Diagnostic browser suspended/resumed in finally20.762 s for benchmark compilation
and7.047 s for A/B/A; no concurrent build during benchmark execution. Compiled-hit
counter counts C dispatches, so internal loop iterations no longer increment it
(504,095 dispatches in the full benchmark vs2,903,327 previously). Keep this
semantic distinction when comparing counters. Full HLE/game verification pending.

Self-loop compiler web build and all nine forced-JIT HLE graphics fixtures pass
twice (`target/jit-self-loop-web-build.log`, `jit-self-loop-TEST_*.log`).
The predicate game ends normally at1803.7 s with zero compiler failures. A later
all-WebGL-method probe could not attach (ECONNREFUSED after normal run end), so
it provides no timing data (`jit-exit-predicate-gl-all.log`).

Longer scheduler.yield diagnostic:1497 deliveries total98.6 ms pending over45.183 s;
profile still46.8% idle (5995/12801 samples), so reduced channel delay is only a
partial improvement. Crucially, the new real Asyncify responsiveness assertion
rejects pure scheduler.yield: an input ping is processed only after all2000 yields
finish (50.9 ms in the tiny fixture; unbounded starvation in sustained execution
is unacceptable). Failed log `target/jit-scheduler-api-check.log`. Do not ship
that version. Testing ordinary scheduler.postTask instead, with MessageChannel
fallback and explicit mid-execution input progress assertions for both paths.

Ordinary scheduler.postTask passes Asyncify state and input-progress assertions
(`target/jit-scheduler-post-task-check.log`). Preferred2000 yields50.5/36.5/37.2 ms,
MessageChannel fallback52.7/42.1/39.6 ms; all input pings occur at progress1 of2000
(preferred0.4–0.7 ms, fallback0.4–1.1 ms). Positive20 ms sleep remains >=20 ms.
These fixture diagnostics ran near HLE regression work and are not game timing.
Prefer postTask when available, retain MessageChannel when absent and Node timer
fallback. Full runtime build/regressions/game retest pending.

postTask full runtime rebuild completed successfully. Nine forced-JIT graphics
fixtures pass twice, actual audio passes, JS20 pass
(`target/jit-post-task-{runtime-build,TEST_*,audio,js}.log`). Formatting/diff pass.
Next is a clean game run combining same-block loops and ordinary browser tasks.

### Combined loop/scheduler game run and register experiment (2026-10-26)

On c39e2a6a, Chromium141/Linux x86_64 software rendering, the fresh TinkerBox
run reached terms182 s, menu212 s, training input295 s, and first Play616 s
(playable screenshot match612 s). Selection-to-Play321 s includes the image
driver's sampling delay. Normal gameplay remained about3 FPS: no material
startup gain versus a03e0005. Lesson1 completed; Lesson2 pinch/tray/ball placement
was visible at1794 s. Second Play arrived1799 s, too late for this1803 s run to
verify Lesson2 SUCCESS. Do not count this as a second-lesson regression pass.
Log: `target/jit-loops-tasks-game.log`; screenshots stay local.

Diagnostic graphics probes (not acceptance tests): all WebGL calls consumed
827 ms/15 s, including getParameter460 ms and getTexParameter201 ms. Eight
software-GPU threads each used about45% CPU. Temporarily suppressing draws gave
6.285 presents/s; suppressing draw/clear/blit after finish gave10.43 presents/s
and removed much of the idle time. These runs do not render working gameplay.
Original methods were restored. No hardware GPU is exposed in this container.
Logs: `target/jit-loops-tasks-gl-all.log`, `target/jit-loops-tasks-threads.log`;
profile: `target/jit-no-raster-profile/summary.json`.

The profile also identified integer register API overhead across HLE calls.
An experimental adapter exposes Unicorn's live integer array. The initial
mode-banking regression FAILED: CPSR changes clobbered supplied r8-r14.
Preserving/restoring the16-register array around CPSR writes fixes this while
removing the per-register API loop. Actual Node and Chromium CPU/fiber suites
now pass, including supervisor/FIQ/user mode transitions, ARM/Thumb/VFP,
faults, budget and cache checks. Logs: `target/jit-live-regs-bank-node.log`
(failure), `target/jit-live-regs-fixed-{build,node,browser}.log` (fixed).
Benchmark and full runtime verification are pending; this is not yet accepted.

Live-register comparison, Node22.22.3 with Asyncify and no concurrent game/build:
5 trials/case, new/old/new medians (ms): tiny5.413/4.774/4.087,
medium4.601/4.528/4.748, long7.517/6.255/5.230, code-page memory
53.211/50.564/51.057, data-memory7.031/6.732/5.964, and50000 SVC calls
124.594/181.047/112.885. The transition workload improves31–38%; other
workloads show warmup/noise, not an established gain. Both adapters use the
same newly built Unicorn archive; each module receives its own exact Wasm
binary. Logs: `target/jit-live-regs-{old-bench,new-bench,comparison}.log`.
Eight-patch reverse/reapply byte comparison passes (existing budget-patch EOF
blank-line warning remains). Rust formatting, diff whitespace and JS20 pass.
Full runtime build and HLE checks remain in progress.

Live-register full runtime build succeeds (`target/jit-live-regs-runtime-build.log`),
including web assets. Forced JIT threshold1 actual HLE graphics fixtures MIPMAP,
COMBINE, LIGHTING, LIGHT_ATTENUATION, LIGHT_SPOT, FOG, MAPPED, POINT_PARAMETERS
and PRESENT_BUFFERS each pass twice with static GET-only traffic, Chromium141.
Actual Web Audio passes. Logs: `target/jit-live-regs-TEST_*.log` and
`target/jit-live-regs-audio.log`. Native source paths are unchanged; prior native33
and browser Rust9 tests remain the reference. Retain the register optimization
for its measured transition benefit. Fresh TinkerBox timing/gameplay pending;
M4/M5 and the thread goal remain open.

### Live-register game timing and bounded doubleword loads (2026-10-26)

Fresh live-register runtime (source committed as cdaadfd5; embedded version is
c39e2a6a because the build preceded the commit), same Chromium/software-GPU
host: terms match172 s/input176 s, main match202 s/input206 s, puzzles input246 s,
training input288 s, first Play match592 s/input598 s. Training-to-Play310 s
versus321 s previously; menu match10 s earlier. Single trials with screenshot
sampling/dwell, not release medians. Clean interval ends at first Play: tests
and diagnostic suspensions follow. Level rendering before Play ~3.2 FPS.
Lesson1 SUCCESS is verified in `target/browser-jit-live-regs/canvas-728.png`.
Logs: `target/jit-live-regs-{game,driver}.log`. Targets remain unmet.

Prior no-raster profile has295/12725 inclusive samples under
`helper_le_ldq_mmu_arm`; doubleword reads still used the generic memory helper.
A small compiler extension emits aligned, bounded little-endian64-bit loads
for the same adapter-only mappings. It preserves both32-bit TCI result halves.
Other widths/formats/alignment and out-of-range accesses retain the helper.
No floating-point arithmetic semantics change; stores are unchanged.

JS21 pass, including both halves, address/result aliasing, high stack addresses,
mapping boundaries, memory growth and fallback. Actual Node and Chromium CPU/
fiber suites pass. New actual ARM VFP tests repeat64 loads of a NaN payload,
including the last mapped doubleword; crossing into unmapped memory faults with
the original guest PC. Logs: `target/jit-doubleword-{js,build,node,browser}.log`.

Same-Wasm Asyncify benchmark, five trials/case, enabled/disabled/enabled medians
(ms): doubleword5.385/30.294/4.654; tiny5.539/4.968/4.313; medium4.691/5.079/
4.598; long6.085/4.770/4.802; code-page memory51.820/51.174/50.856; data-memory
6.084/6.654/6.203; SVC113.092/111.058/108.758. Compiler eligibility alone is
toggled; each instance uses the same Wasm binary. Only the task-owned diagnostic
browser was suspended (20.852 s for build/initial benchmark,6.495 s for comparison),
then resumed in finally. Logs: `target/jit-doubleword-{benchmark,comparison}.log`
and corresponding `-pause.log` files. This is not a game-speed claim.
Full runtime graphics checks pending using the existing validated runtime binary
and updated separately loaded compiler; no C/Rust production code changed.

Doubleword compiler full HLE graphics matrix passes twice with forced JIT
threshold1: MIPMAP, COMBINE, LIGHTING, LIGHT_ATTENUATION, LIGHT_SPOT, FOG, MAPPED,
POINT_PARAMETERS and PRESENT_BUFFERS. Logs: `target/jit-doubleword-TEST_*.log`;
web build: `target/jit-doubleword-web-build.log`. Formatting/diff pass. Retain
the compiler extension for its isolated measured gain. Actual game on this
compiler remains pending; the continuing game still uses the prior compiler.
Live-register game has advanced to Lesson2 and accepted pinch; placement and
second SUCCESS verification are in progress.

Live-register game confirms Lesson2 SUCCESS at999 s after second Play948 s
(`target/browser-jit-live-regs/canvas-999.png`), then Lesson3 at1060 s. The owned
diagnostic browser was stopped through its Stop button afterward; inspector
exit1 reflects that deliberate stop, not a guest failure. No active build was
interrupted. The short active-play profile has13068 samples,7856 idle,922 generated
Wasm,499 TCI interpreter/helper and367 C compiled dispatcher; no page errors
(`target/jit-live-regs-play-profile/summary.json`).

Renderer probe confirms default Chromium uses ANGLE/SwiftShader Vulkan software
rendering. Requesting ANGLE GL fell back to the same SwiftShader renderer;
requesting Vulkan returned no WebGL2 context. Explicit SwiftShader matches default.
`target/browser-renderers.log` retains exact strings. No hardware GPU is exposed.
A fresh updated-doubleword game is starting for diagnostic startup profiling;
it will not supply a clean acceptance timing once the profiler attaches.

### Exact floating-point identities experiment (2026-10-26)

Updated doubleword compiler startup profile, same software-GPU Chromium:
13535 samples: TCI interpreter2602, generated Wasm2530, soft_f32_addsub868,
cpu_exec840, float32_mul765, single-op helper664, rounding495. No page errors.
`target/jit-doubleword-startup-profile/{summary.json,worker.cpuprofile}` retains
the evidence. This game run was profiled and overlaps later CPU fixture builds;
its first Play around583 s is diagnostic, not a clean startup comparison.
It progresses through Lesson1, pinch/tray and ball placement for Lesson2.

Inspection finds QEMU already uses native float arithmetic when its sticky
inexact flag is set and rounding is nearest-even. Exact zero operations may
therefore remain on expensive software paths. A browser-only experiment short-
circuits zero +/- normal and zero * normal/zero identities; denormals, infinities,
NaNs and signed-zero pairs in addition retain their original implementation.
Flags and rounding semantics must stay exact. No fast-math option is used.

Before the production patch, a guest ARM corpus covers ADD/SUB/MUL,20 edge
operands,112 seeded random pairs per mode, all4 ARM rounding modes, FZ, DN and
clear/pre-existing sticky flags:49152 operations per adapter suite invocation.
The unchanged pinned Unicorn produces result/FPSCR FNV fingerprints
3e25bbf3/fa74602e/4a539c72 in every interpreter and forced-JIT repetition.
`target/jit-fp-reference-{build,node}.log`. The expanded suite also checks
1+2,1-2,1*2 explicitly. The SDK's wasm-only clang could not assemble an ARM
fixture (`Unknown command line argument '-arm-add-build-attributes'`); explicit
ARM encodings are instead checked by those known-result execution assertions.

After the exact-identity patch, the same fingerprints and actual Node/Chromium
CPU/fiber suites pass: `target/jit-fp-zero-{build,node,browser}.log`. Benchmark
acceptance and full runtime/HLE verification remain pending. The benchmark
reference archive was rebuilt with only this patch reversed, then the patch
and current archive restored in finally before producing both fixture binaries.
No concurrent runtime build used the temporarily reversed source.

Exact-zero production patch REJECTED and removed. First new/old/new medians
(ms): zero addition19.875/27.906/19.876; zero multiplication21.458/23.697/18.063;
ordinary addition29.298/27.808/29.301. Reordering predicates still gives ordinary
addition29.347/27.542/28.267, versus zero addition20.122/27.336/19.224 and zero
multiplication17.905/23.953/17.043. The specialized gain does not establish a
net game improvement and ordinary addition regresses. Preserve the reference
corpus/benchmarks, not this production complexity. Logs:
`target/jit-fp-zero-{comparison,order-comparison}.log`; owned browser pauses
were8.949 s and the duration in `jit-fp-zero-order-comparison-pause.log`.

After reverting source and patch registration, rebuilt actual Node/Chromium
CPU/fiber suites and the expanded benchmark pass, including a normal-multiply
control. Logs: `target/jit-fp-final-{build,node,browser,benchmark}.log`. No
production floating-point implementation changed. Prior JS21 and runtime
graphics remain applicable; only test/benchmark/docs changes are retained.

Doubleword game Lesson2 SUCCESS verified at968 s after second Play909 s, then
Lesson3 at1028 s (`target/browser-jit-doubleword/canvas-{968,1028}.png`). The
owned inspector was deliberately stopped through Stop before reverting/building
the experiment; its exit1 is the diagnostic harness's manual-stop behavior.
Both committed optimizations therefore have actual two-lesson correctness
evidence, but the under10 s/30 FPS and device acceptance gates remain unmet.
Next candidate: reduce normalized-helper dispatch overhead while preserving
GETPC and the existing helper implementations; the earlier rejected direct-
import experiment must not be reinstated without reproducing its multi-instance
regression and establishing a safer boundary.

### Normalized helper call bridge experiment (2026-10-26)

Generated Wasm now optionally calls one C bridge with the TCI instruction
location, helper table index and original12-register argument order. The bridge
sets GETPC's tci_tb_ptr before calling the unchanged normalized helper, returning
the same64-bit result. This avoids temporary-register spills/reloads and repeated
TCI decoding. It does not import each QEMU helper directly as the previously
rejected experiment did. That earlier source/hang is not reproduced here; the
new boundary must pass repeated-instance, exception and full-game validation
on its own. Runtimes without this bridge retain the old interpreter-helper path.

JS22 pass, including immediate/register callees, argument order, wide result,
exception propagation and preserved temporaries. Actual Node/Chromium CPU/fibers
pass, including repeated engines/instances, all floating-point fingerprints,
fault/cache/budget/context coverage. No hangs or compilation failures in these
runs: `target/jit-call-bridge-{js,build,node,browser}.log`. Patch changes are merged
into the original TCI patch so independent idempotence checks still work; eight-
patch reverse/reapply byte comparison, repeated patch application, formatting
and diff checks pass. Existing budget-patch EOF whitespace warning remains.

Same-Wasm enabled/disabled/enabled five-trial medians, Node22 with Asyncify and
no concurrent game/build (ms): zero-add25.079/27.756/21.816, zero-multiply23.138/
25.161/18.413, normal-add24.985/27.080/22.024, normal-multiply23.466/25.277/19.187,
SVC109.430/116.563/106.348. Other medians: tiny6.006/4.234/3.091, medium4.960/
3.508/3.289, long5.938/4.915/5.298, doubleword4.950/7.047/4.703, code-page
memory52.705/52.485/51.469, data-memory6.685/8.505/6.086. Warmup/noise remains;
these are microbenchmarks, not game speed. Logs: `target/jit-call-bridge-
{benchmark,comparison}.log`. Full runtime/HLE rebuild and game checks pending.

Call-bridge full runtime rebuild succeeds (`target/jit-call-bridge-runtime-build.log`),
then nine forced-JIT graphics fixtures pass twice with zero compilation failures
and static GET-only traffic. Actual Web Audio passes. Logs:
`target/jit-call-bridge-TEST_*.log`, `target/jit-call-bridge-audio.log`.
Retain the bridge for its isolated measured benefit after these regressions.
Fresh clean TinkerBox loading/gameplay measurement is next; game performance
and final hardware/browser acceptance remain outstanding.

### Helper-bridge game and guarded float experiment (2026-10-26)

Fresh d9bf3e8b source runtime (embedded pre-commit6eb95dd2) clean interval:
terms match152 s, menu182 s, training input258 s, Play match502 s/input508 s.
Training-to-Play250 s versus310 s for the live-register clean trial, about19%
less in these single trials. Menu match20 s earlier. No build/profile overlaps
this first-Play interval. Gameplay remains roughly3 FPS on SwiftShader. Later
diagnostic work is excluded from timing. Lesson2 SUCCESS is verified at1532 s
after second Play1472 s (`target/browser-jit-call-bridge/canvas-1532.png`).
The owned inspector was then stopped deliberately through Stop. Logs:
`target/jit-call-bridge-{game,driver,drag}.log`. Targets remain unmet.

A narrower exact-cancellation C patch was tested but set aside, not retained:
original result/FPSCR fingerprints and Node/Chromium suites pass; new/old/new
cancellation medians11.962/21.083/10.408 ms. Ordinary-add medians22.341/21.646/
21.099 ms. Logs `target/jit-fp-cancel-{build,node,browser,comparison}.log`; benchmark
reference built by temporary reverse/reapply, then production source restored.
The cancellation benchmark remains useful for future fallback-cost comparisons.

A15 s diagnostic of the running bridge game's idle Lesson2 wrapped the call
bridge temporarily, preserving its arguments/results. Runtime Wasm table/name
sections identify the three VFP helpers; they are not guessed from pointer values.
Compiled functions were evicted with dispatch clear before table removal both
when installing and restoring the wrapper, retaining translation metadata.
Observed2224491 helper calls,1121862 multiplies,302106 adds,139272 subtracts.
Multiply inexact flag already set1110739 times; add302106; subtract139270.
All observed rounding modes were nearest-even. Eligible nonzero cancellations
were only90 adds and270 subtracts. This is an idle-rendering sample, not a startup
or simulation distribution. It does not justify making cancellation the next
optimization priority. Probe cleanup restores the original bridge and recompiles
without instrumentation. `target/jit-call-bridge-float-inputs.log`.

Next experiment specializes the four exact normalized VFP ADD/MUL/SUB/DIV
helper identities exported by C. It mirrors QEMU's existing hardfloat gate:
nearest-even, inexact already sticky, inputs normal-or-zero. Generated Wasm
uses f32 arithmetic only when the result magnitude is strictly greater than
FLT_MIN and below infinity. All other cases invoke the unchanged C bridge
with original operands, preserving NaNs, under/overflow, signed zeros, other
rounding modes, FZ/DN and exception flags. Status offsets and enum values come
from C rather than assumed packing. This changes no C floating-point arithmetic.

JS23 and initial actual Node suites pass. DIV extends the guest corpus to65536
operations per adapter invocation; interpreter and JIT both produce4803deb0,
now pinned alongside the three original fingerprints. Known1/2 result checks
validate the DIV encoding. Initial logs `target/jit-float-guard-{js,build,node}.log`.
Final browser checks and paired sticky/clear-flag benchmarks are in progress;
this guarded float optimization is not yet accepted.

Guarded float final Node/Chromium CPU/fibers pass with all four fingerprints
asserted (`target/jit-float-guard-final-{build,node}.log`,
`target/jit-float-guard-browser.log`). The paired benchmark explicitly covers
clear and sticky inexact states. Same-Wasm enabled/disabled/enabled5-trial
medians (ms): normal-add with sticky5.186/10.805/4.087; normal-multiply with
sticky4.983/10.666/4.072; zero-add with sticky5.206/10.212/4.111.

Clear-flag fallbacks: normal-add22.429/22.427/22.196; normal-multiply20.154/
19.149/19.253; zero-add22.662/21.542/21.638; zero-multiply20.650/18.370/17.750.
Sticky zero-multiply (tiny result, deliberately fallback)12.257/10.685/10.607;
cancellation22.256/20.829/20.147. Other medians: SVC106.231/104.734/105.085,
doubleword4.872/4.727/4.644, code-page memory51.801/50.290/50.246, data-memory
6.233/5.823/6.156. First-case warmup/noise remains; eligible arithmetic improves
materially without a sustained large fallback regression in this comparison.
No concurrent game/build. Logs: `target/jit-float-guard-{benchmark,comparison}.log`.
Eight-patch roundtrip, repeated patch application, formatting/diff pass.
Full runtime/HLE validation is underway before retaining the change.

Guarded-float full runtime rebuild succeeds (`target/jit-float-guard-runtime-
build.log` and `jit-float-guard-web-build.log`). Nine graphics fixtures MIPMAP,
COMBINE, LIGHTING, LIGHT_ATTENUATION, LIGHT_SPOT, FOG, MAPPED, POINT_PARAMETERS
and PRESENT_BUFFERS each pass twice with forced JIT threshold1 and no compile
failures; actual Web Audio passes. `target/jit-float-guard-TEST_*.log` and
`target/jit-float-guard-audio.log`. Retain this guarded implementation for its
measured eligible-case gain and passing regressions. Fresh clean TinkerBox
loading/gameplay validation follows; M4/M5 and the goal remain open.

Guarded-float clean TinkerBox trial (e9391fe6): menu matched182 s; training
selected267 s; Play matched492 s and clicked497 s, giving230 s selection-to-
Play input (225 s to screenshot match), versus250 s in the previous bridge
trial. Approximately3 FPS. This is one trial with10 s screenshot sampling,
not statistical acceptance. No concurrent build/profile before Play497 s.
Lesson1 completed; Lesson2 SUCCESS verified in `canvas-1032.png` after pinch,
tray opening, ball drag and Play. Later diagnostics perturb timing.
Artifacts: `target/jit-float-guard-game.log`,
`target/browser-jit-float-guard/lesson2-placed.png` and `canvas-1032.png`.

The15.6 s `target/jit-float-guard-play-profile/summary.json` has13354 samples,
4827 generated-Wasm,1957 idle,1209 dispatcher,1083 CPU execution and798 compile.
Its screenshot shows the transition into Lesson2, so it is not comparable to
previous steady-play profiles with60% idle. A diagnostic-only custom Wasm name
section identified generated blocks without changing their instructions. It
clears native dispatch before removing table entries, retains translation
metadata, and restores the compiler and evicts instrumentation in finally.
First sample still overlapped recompilation; a second uses45 s warmup then15 s
sampling:13009 samples,8762 idle (67.4%),440 CPU execution,378 getParameter,
268 dispatcher,160 getTexParameter,53 getRenderbufferParameter. The hottest
individual named block has44 samples. Logs `target/jit-named-blocks{,-steady}.log`.
This does not yet justify CPU environment register promotion. Measure graphics
query wall time next. Both samples are diagnostics, not acceptance trials.
Under10 s loading, real-time simulation,30 FPS, input latency and hardware/
multiple-browser validation remain unmet or unmeasured; M4/M5 remain open.

Direct WebGL query timing during the guarded-float game's later training screen:
15188.9 ms observation,47 frames (~3.09 FPS). MAX_TEXTURE_MAX_ANISOTROPY_EXT
257 queries221.5 ms; TEXTURE_MAX_ANISOTROPY_EXT257 queries183.4 ms;
viewport94 queries110.2 ms; renderbuffer width/height47 each42.4/30.9 ms.
Total measured queries ~724 ms, consistent with the earlier software-raster
investigation; these queries alone do not explain the frame interval. Probe
restored original GL methods. `target/jit-gl-query-profile.log`. Inspector was
stopped deliberately through Stop after both lesson correctness checks.

A smaller float-guard experiment replaces each two-sided normal-range test
with unsigned subtraction and one comparison. For inputs, `(m-0x00800000) <
0x7f000000` (unsigned32) accepts normal magnitudes; zero remains a separate
accepted case. Results use `(m-0x00800001) < 0x7effffff`, retaining the strict
FLT_MIN exclusion. Wrapping excludes subnormals; infinities/NaNs remain outside.
Existing boundary tests now also cover adjacent values below/above FLT_MIN
and largest finite times1. No helper, memory, exception or native changes.

Same-binary new/old/new five-trial medians (ms), repeat with no concurrent
build/game/test: sticky normal-add5.018/5.103/4.580; sticky normal-multiply
4.176/4.652/4.530; sticky zero-add6.061/4.804/4.865; sticky zero-multiply
fallback12.200/11.962/11.125. Clear normal-add23.022/21.932/21.610; clear
normal-multiply20.437/19.364/19.264; SVC105.329/104.933/105.996.
Warmup variation remains; only modest eligible-case improvement, no game-level
claim. Initial comparison overlapped the subsecond JS test; use the repeat
for evidence. `target/jit-float-range-{comparison,repeat}.log`.
JS23, rebuilt actual Node/Chromium CPU/fibers including all65536-operation
FP fingerprints and repeated instances pass. Browser build and two actual
forced-JIT HLE MIPMAP runs pass. No Rust/C change required a runtime relink;
the game worker imports the updated compiler from the rebuilt static files.
Logs `target/jit-float-range-{js,build,node,browser,web-build,hle}.log`.

### Bounded doubleword stores (2026-10-26)

A diagnostic fresh run on38fb8457 reached terms152 s, menu182 s, puzzles222 s,
training272 s (screenshot matches). This run overlaps CPU fixture builds and
profiling, so none are clean acceptance timings. Initial15.9 s startup profile:
13480 samples, generated Wasm1215, compiler1208, dispatcher1153, store_helper905,
CPU885, address translation724, interpreter646, Module633, mapping lookup624.
`target/jit-float-range-startup-profile{.log,/worker.cpuprofile}`.

A temporary single-op helper wrapper, with native dispatch cleared before
compiled-table eviction and translation metadata retained, counts270298
fallbacks/15.03 s:138991 doubleword stores,100392 word loads,30660 doubleword
loads,255 word stores. Later after the training action:21583 fallbacks/15.02 s,
11281 doubleword stores (4181 meet the bounded aligned non-code-page gate,
7100 fail other checks),8796 doubleword loads,1506 word loads. Both wrappers
restore the original step function and evict instrumented modules in finally.
These are stage-dependent diagnostic counts, not uninstrumented throughput.
`target/jit-range-memory-fallbacks{,-loading}.log`. The inspector was stopped
through Stop during loading; its driver was terminated deliberately. No guest
failure or new completed-lesson claim. Screenshot `target/jit-range-loading-stop.png`.

Extend the existing direct memory branch to aligned little-endian64-bit stores.
Combine low/high TCI operands into a Wasm i64; retain the same engine, mapping,
bounds and translated-page checks. Eight-byte alignment means the access cannot
cross a4096-byte page. Other alignments/formats, generic engines, faults and
translated code use the unchanged helper with all three input registers saved.
No new mapping, C bridge or invalidation mechanism.

JS24 pass, including low/high regions, endpoint/out-of-range/misaligned stores,
memory growth and dynamic code-page flags. Actual ARM VSTR tests use a fresh
engine for initially untranslated data, verify NaN payload bits and the final
mapped doubleword, then execute a destination page, overwrite its instructions
through VSTR, and verify the new instructions execute. Cross-boundary store
faults preserve guest PC1004. Rebuilt Node and Chromium CPU/fibers (including
FP fingerprints and repeated instances) pass. All nine forced-JIT graphics
fixtures pass twice. Existing dead-code build warning remains.

Same-binary enabled/disabled/enabled five-trial medians, no concurrent game/build:
doubleword-store4.740/46.932/4.820 ms; doubleword-load4.630/4.665/5.063;
word-memory50.515/50.073/51.318; data-memory5.915/6.928/5.907;
SVC104.646/105.291/104.412. Sticky multiply4.571/4.579/4.557.
Retain the measured targeted gain; full-game timing/correctness on this final
compiler remains pending. Logs `target/jit-wide-store-{js,build,node,browser,
comparison,web-build,hle}.log` and `jit-wide-store-<GRAPHICS_FIXTURE>.log`.
The benchmark-build log overlaps the diagnostic game; its timings are not used.

Aligned-store clean game trial onac52e3f0: terms match152 s, menu182 s, training
match272 s/input275 s, Play match502 s/input508 s. Selection-to-Play input233 s,
with10 s screenshot sampling; playable scene already visible492 s. Roughly3 FPS.
No build/test/profile overlapped this interval (source-only edits were prepared).
This shows no material load-time improvement versus the prior230 s trial despite
the synthetic store gain. Correctness and diagnostic sampling continue after508 s.
`target/jit-wide-store-{game,driver}.log`; screenshots `target/browser-jit-wide-store/`.

Aligned-store build Lesson1 SUCCESS verified612 s and Lesson2 SUCCESS824 s;
pinch and real touch drag/placement verified. Later profiling/builds perturb
these times; they establish correctness only. Inspector stopped via Stop after
build completion and diagnostics. `target/browser-jit-wide-store/canvas-{612,824}.png`.

### Permitted word-aligned doublewords (2026-10-26)

After clean Play, helper sampling observed247334 fallbacks/15.391 s:124146 word
loads,61426 doubleword stores,61762 doubleword loads. All61426 stores have
MO_LEQ/no requested alignment and address remainder4 modulo8. A later sample
confirmed the same store alignment. `target/jit-wide-store-memory-fallbacks.log`.

The compiler now accepts four-byte-aligned doublewords when C-exported MO_UNALN
or explicit2/4-byte alignment permits them. Older runtime artifacts without the
metadata retain the natural-alignment path. Doubleword stores must additionally
fit inside one4 KiB page, preserving the single-page code bitmap check; crossing
stores and all stricter alignment requirements retain the original helper.
Reads remain bounded by their complete host mapping. C exports its enum rather
than assuming TARGET_ALIGNED_ONLY or host alignment policy.

JS24, rebuilt actual Node/Chromium CPU/fibers pass. Unit coverage includes both
possible MO_UNALN encodings, legacy missing metadata, strict natural alignment,
mapping boundaries and both-mapped-page store fallback. ARM VFP load/store tests
now include address remainder4 and accesses crossing two mapped pages, alongside
unmapped-boundary faults, payload preservation and executable-page invalidation.
Eight-patch reverse/reapply byte comparison and repeated patch application pass;
the existing budget-patch EOF blank-line warning remains. Full runtime rebuild
passes with existing warnings. No native CPU path is changed.

Same-binary enabled/disabled/enabled five-trial medians without concurrent game/
build/test (ms): word-aligned doubleword-load4.596/30.305/4.603; word-aligned
store5.208/307.376/5.143. Naturally aligned load4.778/5.376/4.686; naturally
aligned store5.719/4.808/4.853; word-memory51.632/50.615/51.918;
data-memory6.390/5.929/5.844; SVC104.469/106.059/104.111.
Initial-case warmup variation remains (clear zero-add31.299/23.617/21.838);
no game speedup claim yet. Logs `target/jit-word-aligned-{js,build,node,browser,
runtime-build,comparison}.log`. Benchmark-build log overlaps game/runtime build
and is not performance evidence. Full graphics validation is in progress.

Further sampling identifies why aligned word loads still fall back: addresses
in libgcc (0x30000000 slide) and libstdc++ (0x3748a000 slide) lie outside the
cached low-RAM region0x1000+0x0ffff000. The adapter currently caches only the
largest immutable mapping in each address-space half. Probe logs
`target/jit-wide-store-{word-read-fallbacks,read-addresses}.log` (diagnostic only).
These are existing loaded library mappings, not missing guest RAM. Next design
candidate: bounded direct lookup covering all opted-in immutable mappings,
preserving unmapped/cross-region faults and translated-code-page invalidation.
Do not expand or coalesce guest mappings just to bypass checks.

Word-aligned full static build and all nine forced-JIT graphics fixtures each
pass twice (`target/jit-word-aligned-<GRAPHICS_FIXTURE>.log`). Formatting/diff
checks pass. Retain the alignment extension; fresh game performance and both
lessons on this final compiler remain next. No acceptance target is closed.

Word-aligned clean TinkerBox trial (f1ce8c52): terms142 s, menu172 s,
training match252 s/input259 s, Play match482 s/input487 s. Level-selection-
to-Play input228 s versus233 s previously, within10 s screenshot sampling;
~3 FPS. No competing build/test/profile before Play; source-only edits during
that interval. Later validation is diagnostic. `target/jit-word-aligned-{game,
driver}.log`, screenshots `target/browser-jit-word-aligned/`. Targets remain open.

Next prototype adds a4 MiB per-engine array of immutable host page pointers,
filled only by the adapter's mapping opt-in. Each generated access requires a
mapped page, original alignment and an endpoint within that page. Stores also
check the existing translated-code bitmap. Unmapped, crossing and unsupported
accesses retain Unicorn helpers; native paths are unchanged. The legacy two-
region path remains for runtime artifacts without page-map metadata. Do not
coalesce independently allocated guest mappings. JS25 pass; actual ARM/library
mapping and invalidation checks are building. No performance claim yet.

Page-map actual Node and Chromium CPU/fibers pass, including all floating-point
fingerprints, repeated instances, library endpoints, two adjacent guest pages
with nonadjacent host backing, unmapped-boundary faults and replacing executed
library instructions. JS25 also checks current-engine selection and memory
growth. Patch reverse/reapply byte comparison passes for all eight patches;
existing budget-patch EOF whitespace warning remains. Full runtime rebuild
is in progress. Logs `target/jit-page-map-{js,build,node,browser}.log`.

Word-aligned build confirms Lesson1 SUCCESS582 s and Lesson2 SUCCESS965 s
with pinch and touch-drag placement. These later timings overlap diagnostics/
builds, so are correctness evidence only. Inspector stopped through Stop after
full build completion. Screenshots `target/browser-jit-word-aligned/canvas-
{582,965}.png`; drag log `target/jit-word-aligned-drag.log`.

Page-map full runtime and static rebuilds pass. All nine forced-JIT graphics
fixtures each pass twice. Paired same-binary enabled/disabled/enabled five-trial
medians (ms), no concurrent game/build/test: library-memory5.707/82.537/5.742;
low data-memory5.661/6.010/5.548; code-page memory49.888/50.448/49.038;
SVC107.021/104.563/104.875. Doubleword-load4.690/4.719/4.442; word-aligned
load4.392/4.550/4.429; doubleword-store5.076/5.964/4.664; word-aligned store
4.695/5.719/4.483. Sticky multiply4.613/4.617/4.637. First-case warmup variation
remains; targeted library gain is clear, but no full-game improvement claimed.
`target/jit-page-map-{comparison,runtime-build,web-build}.log` and graphics logs.
Benchmark-build timings overlap the diagnostic game/build and are not used.

An additional actual ARM regression executes code on the second of two adjacent,
separately backed guest pages, then stores a doubleword across the boundary from
the unexecuted first page and verifies the replacement instruction on the second
page executes. Final Node CPU suite passes; final Chromium run pending.
`target/jit-page-map-final-{build,node,browser}.log`.

Final Chromium CPU/fiber suite passes the crossing-store/second-page invalidation
regression. Formatting/diff checks pass. Retain the page lookup for its measured
library-access gain with the fixed4 MiB cost. Fresh game loading and two-lesson
validation remain required; under10 s/30 FPS/input/device acceptance stays open.

Page-map clean TinkerBox trial on313e6160: terms142 s, menu162 s, training
match242 s/input245 s, Play match462 s/input465 s. Selection-to-Play input220 s
versus228 s previously; still near10 s screenshot precision, ~3 FPS. No build,
test or profiler overlapped that interval; source-only edits were prepared.
Lesson1 SUCCESS562 s and Lesson2 SUCCESS1242 s verified with pinch and touch
placement; later times overlap diagnostic work and are correctness evidence.
Inspector stopped via Stop. `target/jit-page-map-{game,driver,drag}.log` and
`target/browser-jit-page-map/canvas-{562,1242}.png`. Goal targets remain unmet.

### Partial compiler-cache eviction experiment (2026-10-26)

The clean page-map run logged24.65 s compilation by452 s (29550 compiled blocks,
three capacity flushes);27.75 s by472 s. Rather than discard all compiled blocks
at capacity, the experiment removes older modules until75% of byte/module
capacity remains. Limits stay8192 modules/16 MiB emitted bytes and65536
translation identities. Native dispatch is cleared before table-slot removal.
Translation metadata remains, permitting recompilation. Lookups refresh recency;
native dispatch hits bypass JS, so this is approximate recency, not exact LRU.
The bounded compiled-module map is cleared on reset and re-registration.

JS26 pass, including byte/module pressure, retained modules, re-registration,
metadata-based recompilation and a failed table allocation after eviction with
accurate memory accounting. Actual ARM capacity regression executes9000 distinct
two-instruction blocks, revisits hot/old code, checks all results, confirms a
capacity eviction under forced JIT, then replaces old code through a guest store.
It passes Node and Chromium along with the existing CPU/fiber corpus. The shared
CPU browser timeout is now120 s because this deliberate stress compiles over
8192 modules; it is not a startup-performance test. Other timeouts are unchanged.
Logs `target/jit-partial-cache-{js,final-build,final-node,final-browser}.log`.

New `web/bench-jit-cache.mjs` replays4096 hot blocks with8192 streamed blocks in
512-block phases, checking executed results and cache bounds. It measures only
compiler-cache pressure, excluding ARM translation and the native dispatch cache;
it cannot establish game speed. Paired runs and ordinary CPU benchmarks pending.

Cache-pressure paired new/old/new five-trial medians3.593/4.375/3.709 s, ranges
3.067–4.154/3.690–5.186/3.327–4.112 s. Every new-policy trial compiles12288
modules versus16384 under whole-cache flushing (25% fewer); live modules8190
versus8192, below the same production limits. New policy batches two evictions
versus one whole flush. Node22.22.3, no concurrent game/build/test.
Baseline compiler is313e6160's `web/tci-jit.js`, copied locally and selected with
`JIT_COMPILER=target/tci-jit-before-partial-cache.js node web/bench-jit-cache.mjs`.
Logs `target/jit-partial-cache-pressure-{new,old,repeat}.log`. Native C dispatch
hits are not modeled by this replay, so real-game recency may be less accurate.

Same-runtime CPU enabled/disabled/enabled five-trial medians (ms): library-memory
5.907/5.658/5.535; data-memory5.885/5.687/5.491; code-page memory49.475/50.858/
49.529; SVC107.008/103.876/103.662. Word-aligned doubleword load4.458/4.415/
4.282, store6.697/4.566/4.664; ordinary doubleword store7.062/4.682/4.571.
First-pass warmup variation remains; no persistent large regression in this
comparison. `target/jit-partial-cache-cpu-comparison.log`. No concurrent workload.
Static build and all nine forced-JIT graphics fixtures each pass twice. No C/Rust
production change required a runtime relink; the worker imports the updated
compiler independently. Retain pending fresh game timing/correctness.
`target/jit-partial-cache-web-build.log` and graphics logs. Acceptance stays open.

Read-only runtime disassembly identifies a further performance question. The
current full runtime uses ASSERTIONS=1 and STACK_OVERFLOW_CHECK=2, while the
standalone CPU benchmark uses default assertions. Asyncify restore prologues
remain in touchhle_tci_call, touchhle_tci_interpret, cpu_exec_arm, tb_gen_code_arm
and float32_add_arm. State-global read counts in their disassembled bodies are
5,202,133,539,7 respectively (not execution frequencies). The explicitly removed
dispatcher has state-preservation assertions as well. Artifacts:
`target/jit-runtime-asyncify.wat`, `target/jit-asyncify-functions.json`.
These observations do not establish the cost or justify broad exclusions yet.
Next compare production checking overhead and investigate synchronous CPU helper
boundaries, retaining real Rust/HLE yielding and strict regression fixtures.
No assertion/Asyncify setting has been changed by this diagnostic.

Partial-cache clean game reached main-menu screenshot172 s, training input255 s,
and Play input479 s (screenshot473 s):224 s selection-to-Play, versus220 s in
the prior page-map run. Ten-second screenshot sampling and driver polling limit
precision; no material game-loading improvement established. Render logs remain
approximately3 FPS. No build/test/profile competed before Play. CPU benchmark
builds started afterward, so subsequent lesson timestamps are correctness only.
Logs `target/jit-partial-cache-{game,driver}.log`.

Corrected the preceding diagnostic assertion level: production uses ASSERTIONS=1,
not2. `CPU_CHECKS=1 node web/bench-cpu.mjs` now selects production assertion and
stack checking levels; combine with CPU_ASYNCIFY=1 for the instrumentation
comparison. Defaults remain unchanged. Paired benchmark builds/results pending;
no production flag change. Build-phase timings with the game running are excluded.

Partial-cache game confirms Lesson1 SUCCESS in canvas-573.png and Lesson2
SUCCESS in canvas-755.png under `target/browser-jit-partial-cache/`. Lesson2
uses actual touch drag and Play. Runtime deliberately stopped with the UI Stop
button after verification; inspector exit1 is manual termination, not guest
failure. Both lessons pass; real-time and startup targets remain unmet.
Benchmark harness change passes node --check, JS26, cargo fmt --check and
 git diff --check. Checked and unchecked Asyncify builds execute both interpreter
and JIT result assertions successfully; timings during these builds are excluded.

Isolated Asyncify unchecked/checked/unchecked five-trial medians (ms), Node22:
SVC104.678/118.610/104.046; code-page memory49.195/52.569/49.339;
library-memory5.769/5.893/5.604; data-memory5.631/5.681/5.749;
float-add-normal23.219/22.730/21.939. Tiny arithmetic5.881/5.285/3.625
shows warmup variation. No competing game/build/test. All guest assertions pass,
zero JIT failures. `target/jit-runtime-checks-comparison.log`. Checks contribute
to some microbenchmarks but do not explain the game gap; retain production flags.
Next local experiment excludes only synchronous TCI call/step/interpreter bridges
in addition to the existing dispatcher, retaining checks and all HLE/fiber code.

### Synchronous CPU instrumentation experiment (2026-10-26)

With production checks retained, excluding touchhle_tci_call, touchhle_tci_step
and touchhle_tci_interpret in addition to the existing dispatcher gives checked/
bridge/checked medians (ms): code-page memory53.218/47.856/52.484, SVC120.427/
121.464/119.220, library-memory5.810/6.209/5.810. Float-normal-add23.956/
21.561/21.933 shows warmup variation. Local builds only at this point.
`target/jit-sync-bridge-{build,comparison}.log`.

Additional pure float32_add/sub/mul/div exclusions: bridge/bridge+float/bridge
medians normal-add22.244/20.810/22.249, normal-multiply20.556/17.054/18.890,
zero-add22.872/20.695/21.984, cancellation21.693/19.275/21.065; code-page
memory49.173/48.954/47.498 and SVC119.951/122.714/118.455. Five trials/case,
Node22, no competing workload; all result checks pass, zero compiler failures.
`target/jit-sync-float-{build,comparison}.log`. These are microbenchmarks only.

Candidate applies that exact seven-function addition consistently to full runtime,
strict CPU/fiber fixture and CPU benchmark. No wildcard exclusions, change to
assertion levels, or instruction semantics. Adapter CPU hooks only stop/report;
HLE dispatch occurs after return. Softfloat's internal function pointers select
pure numerical operations, which cannot suspend. Rust/HLE/fibers remain under
Asyncify. Full CPU/fiber and runtime regressions/build now running; do not count
candidate as accepted until real-game/yield checks finish.

Candidate full runtime build succeeds. Strict actual CPU/context/FP fingerprints/
9000-block cache/fiber checks pass in Node and Chromium. JS26, formatting and
syntax/diff checks pass. All nine forced-JIT graphics fixtures each pass twice;
actual Web Audio passes. Logs `target/jit-sync-{cpu-build,cpu-node,cpu-browser,
runtime-build,web-build,js,audio}.log` and `jit-sync-TESTNAME.log` (fixture names
MIPMAP, COMBINE, LIGHTING, LIGHT_ATTENUATION, LIGHT_SPOT, FOG, MAPPED,
POINT_PARAMETERS, PRESENT_BUFFERS). Fresh clean game started after all checks;
`target/jit-sync-helpers-game.log`, screenshots `target/browser-jit-sync-helpers/`.
No timing or game acceptance claim for this candidate yet.

Synchronous-helper clean game: terms screenshot132 s, menu162 s; training input
238 s and first Play457 s (screenshot452 s), selection-to-Play219 s. Previous
partial-cache run224 s and page-map220 s: this single trial does not establish
a material gain at10 s screenshot sampling. Render logs remain ~3.3 FPS.
No builds/tests/profiling overlapped the clean interval. Both lessons still being
verified. Startup/real-time targets remain unmet. Commit f4ae8e6e pushed with
regression evidence; game timing is not an acceptance claim.

Both synchronous-helper lessons pass: SUCCESS screenshots canvas-532.png and
canvas-762.png in `target/browser-jit-sync-helpers/`. Lesson2 uses actual touch
placement (`lesson2-placed.png`) and Play, with no injected guest state. Stopped
through UI after verification; inspector exit1 is deliberate Stop, not guest
failure. Retain the exact exclusions for the modest measured CPU gains and
passing regressions, without claiming a material game speedup. M4/M5 remain open.
Next: profile compiled dispatch/transition cost and compare an isolated reduction
before another runtime change. Software GPU limits remain; hardware/mobile,
input p95, wall-time simulation and three-trial final acceptance are outstanding.

### Direct compiled transfers experiment (2026-10-26)

Prototype feature-detects Wasm tail calls and preserves ordinary dispatcher
fallback when unavailable. It rereads mutable goto links and C-provided dispatch
cache layout before transfer, retaining all target budget/exit checks and
register state. New JS test runs nearly two million transfers and checks mutable
links, memory growth, cache misses/collisions, empty functions, table reuse after
clear and forced fallback. JS27 pass. Real ARM two-block benchmark checks results.

Rejected first design: each block imported the full runtime Wasm table. The
9000-block cache regression exhausted Node's default heap (~4059 MiB, exit134),
`target/jit-tail-calls-node.log`. No production build or game used this version;
it is not committed. Interpreter half passed; JIT half did not complete.

Revised prototype imports the runtime table once in a shared Wasm dispatcher.
Each block tail-calls that small function; it verifies cache key/function, counts
the transfer and tail-calls the target, or returns a cache miss to C. No stack
accumulation, table import per block, instruction semantics change, or new
browser requirement. JS27 pass again (`jit-tail-dispatch-js.log`). Actual CPU
regression now also warms two linked blocks and lets one overwrite the other
through a guest store before returning. Full actual tests and isolated timings
pending; no retention/performance acceptance claim yet.

Revised shared-table dispatcher passes actual Node CPU/fiber/cache checks,
including linked guest-code overwrite:46.332 s, peak child RSS478216 KiB, exit0.
`target/jit-tail-dispatch-node.log`. First resource wrapper attempt could not run
because /usr/bin/time is absent; the recorded successful run uses Python
resource.getrusage(RUSAGE_CHILDREN), without increasing Node's heap limit.

Reject the revised tail-call design on isolated performance evidence. Same-Wasm
new/old/new five-trial medians (ms): linked-blocks149.331/135.204/148.611;
code-page memory48.234/47.331/48.648; library-memory5.728/5.626/5.868;
SVC121.066/121.180/131.192. Logs `target/jit-tail-dispatch-comparison.log`.
The two-block loop performs1,000,000 iterations,4,000,001 guest instructions;
all results pass. No competing workload. Tail calls were enabled in both new
runs. This fixes memory growth but regresses the intended dispatch workload
~10%; do not ship it. The prototype and C metadata changes are removed.

A subsequent source review caught a zero-target sentinel edge case in the
unretained dispatcher. A guard and regression were prepared after the comparison,
but no favorable benchmark or production claim is based on that unmeasured edit.
Both rejected compiler copies remain local in target only. Retain just the ARM
linked-block benchmark and the warmed linked-code rewrite regression. Rebuilding
and checking those against the unchanged production compiler now. No new game
run is required to validate a production optimization, since none is retained.
Next investigate a single generated dispatch loop with ordinary calls, avoiding
both per-block table imports and the extra tail-transfer boundary, only if its
measured gain justifies integration. M4/M5 and the original goal remain open.

Final retained test additions pass actual Node and Chromium CPU/cache/fiber
checks with the unchanged production compiler and restored metadata. JS26,
cargo fmt --check and git diff --check pass. Logs
`target/jit-linked-regression-{build,node,browser,js}.log`. The new benchmark
already passed interpreter/JIT guest assertions in the exploratory build;
its same-Wasm baseline comparison verifies the existing compiler. No production
runtime code change remains from this experiment.

### Ordinary dispatch loop and temporary transfers (2026-10-26)

A single generated dispatch loop using ordinary calls avoids both prior tail-call
problems, and JS27 plus interpreter/JIT benchmark assertions pass. Same-Wasm
new/old/new linked-loop medians133.214/135.542/131.634 ms, code-page memory
49.116/47.957/47.899, SVC123.034/120.716/122.231. No competing workload.
`target/jit-dispatch-loop-{build,js,comparison}.log`. A2–3% targeted gain with
no broader clear win does not justify a second runtime dispatcher; reject it.
Prototype compiler and metadata restored before the next experiment. Local
rejected copies remain under target, not production source.

Next candidate reduces temporary-register transfers within existing compiled
blocks: load only registers read before a definite assignment, and save only
written registers at exits. Forget definitions at forward joins conservatively,
so skipped writes preserve original values. Unknown helpers retain all inputs/
outputs. No CPU architecture, dispatcher, or native change. JS28 pass, including
1000 randomized skipped-assignment preservation cases and an unclassified helper
reading/writing full state. Actual CPU/fiber tests and production CPU benchmark
rebuild running; no game claim yet.

Initial same-Wasm new/old/new linked-loop129.657/134.473/108.709 ms shows warmup
variation; library-memory5.621/5.594/5.283, code-page47.712/50.719/47.237,
SVC122.783/119.267/119.292. `target/jit-temp-liveness-initial-comparison.log`.
This preliminary binary still contains the rejected optional dispatcher branch,
disabled for every case. Repeat with the restored production C before retaining.

Restored production-C comparison, no competing workload: new/old/new medians
linked-blocks108.208/134.997/108.034 ms (~20% less), SVC120.824/119.364/
118.132, library-memory5.844/5.710/5.597, data-memory5.748/5.720/5.548,
code-page memory47.921/48.252/49.438. Other cases show warmup/noise without a
persistent large regression. All guest assertions pass, zero compiler failures.
Each case compiles114 modules; emitted bytes133593/179170/133593 (25.4% less).
Compilation totals186.649/214.881/159.626 ms; not isolated compile-time medians.
`target/jit-temp-liveness-comparison.log`. Synthetic gain only, not game speed.
Actual Node/Chromium CPU/cache/fiber suites and JS28 pass; full graphics fixtures
running. No C/Rust production change requires relinking the accepted runtime.

Static build and nine forced-JIT graphics fixtures each pass twice, formatting/
diff pass. Logs `target/jit-temp-liveness-{web-build,MIPMAP,COMBINE,LIGHTING,
LIGHT_ATTENUATION,LIGHT_SPOT,FOG,MAPPED,POINT_PARAMETERS,PRESENT_BUFFERS}.log`.
Retain pending clean game measurement and both lessons; no real-time claim.

Temporary-transfer clean game reached terms132 s and menu162 s; training input
238 s, Play447 s (matched screenshot442 s), selection-to-Play209 s versus219 s
previously. One screenshot interval earlier is suggestive but insufficient to
claim a material/statistically established gain. Approximately3.3 FPS persists.
No competing build/test/profile before Play. Logs `target/jit-temp-liveness-
{game,driver}.log`; screenshots `target/browser-jit-temp-liveness/`. Both lessons
are being verified. Startup and real-time targets remain unmet.

Both temporary-transfer lessons pass: SUCCESS canvas-523.png and canvas-734.png
in `target/browser-jit-temp-liveness/`; actual touch placement is visible in
lesson2-placed.png. Deliberately stopped through UI afterward; inspector exit1
is manual Stop. Retain68577f3a; game targets remain unmet.

Phase-matched diagnostics (5.3 s after Play each): prior helper build at462.3 s
compiled23140 modules/53654742 emitted bytes/20296.2 ms compile time/6 evictions;
new at452.3 s compiled21034/42539532 bytes/16949.0 ms/3 evictions. Both have
~409 million compiled dispatches and ~368.5k registrations. These single-run
cumulative counters show fewer compilations and bytes, not gameplay acceptance.
All clean timing/correctness artifacts remain local; no game data committed.

Next local-only measurement compares CPU benchmark link optimization O2/O3
with the same production assertions, stack checks and Asyncify exclusions.
No production optimization flag changed. Game stopped before benchmarking.

Local O2/O3/O2 five-trial medians (ms): linked-blocks108.219/108.040/106.953,
SVC118.669/125.531/120.593, code-page memory47.839/48.626/47.234,
library-memory5.698/5.740/5.364. No competing workload; all assertions pass.
Wasm sizes1126203/1118757 bytes (~0.7% less). No convincing speed gain: retain
O2. `target/jit-opt3-{benchmark-build,comparison}.log`. This comparison changes
both benchmark C source compilation and final linking; full-runtime cc::Build
already inherits release optimization. It cannot establish an isolated linker
benefit. No production flags changed; default benchmark artifact restored to O2.
Next profile current game loading/HLE cost before another speculative CPU change.

### Profile-guided exact floating-point fast paths (2026-10-26)

Current ce9d4aab diagnostic startup profile:13426 samples, generated Wasm2170,
dispatch1060, CPU993, compiler876, lookup587, run_call499, soft_f32_addsub477,
float32_mul270, round_canonical237, miniz352. Actual level-loading profile after
Training selection:13678 samples, generated Wasm3721, soft_f32_addsub1424,
CPU1167, float32_mul809, round_canonical777, helper bridge646, run_call597,
dispatch535, slice_mut301. Screenshot shows the loading transition from stage
selection; these are self samples, not inclusive sums or acceptance timings.
Artifacts `target/jit-current-{startup,level}-profile/{summary.json,worker.cpuprofile,page.png}`.
No build/test competed with either sampling interval (the JS test finished45 s
before the level sample). Diagnostic inspector stopped through UI; driver
terminated afterward. This run is not a game acceptance trial.

Candidate: binary64 represents normal binary32 multiplication exactly (at most
48 significand bits). Add/sub is also exact in binary64 when either input is
zero or exponent difference <=29 (at most53 bits). For these cases, compare the
exact binary64 result against promoted rounded binary32 and OR the existing
inexact flag when different. Nearest-even and normal-or-zero input guards remain;
NaN/infinity/subnormal input and overflow/tiny results use QEMU. Retain strict
result magnitude >FLT_MIN except exact signed zero: multiplication requires a
zero operand; add/sub zero is exact cancellation. Division and wider-gap add/sub
still require sticky inexact. Already-sticky cases skip precision/inexact work.
No new Wasm feature or native execution change.

Multiplication alone: same-Wasm new/old/new medians clear normal-multiply
5.707/16.849/4.815 ms; zero-multiply5.804/16.693/5.092; sticky zero5.261/8.294/
4.922. Linked-loop111.728/107.833/108.042, SVC119.207/118.692/118.022.
Actual Node CPU/fingerprint/cache/fiber suite passes with this compiler injected
before runtime initialization. `target/jit-exact-multiply-{js,node,comparison}.log`.

Additional add/sub: new/multiply-only/new clear normal-add6.057/20.395/5.336,
zero-add6.151/20.411/5.816, cancellation6.319/19.375/5.376 ms. Extra eager
precision work makes sticky adds slower. Short-circuit/eager/short-circuit
sticky zero-add5.033/5.287/4.711, sticky normal-add5.016/5.309/5.011;
cancellation5.005/5.401/4.590. Keep short circuit for final validation. All these
five-trial comparisons have no competing workload; synthetic gains only.
`target/jit-exact-arithmetic-{comparison,short-comparison}.log`. JS28 pass with
signed zero, exponent boundaries, special values, flags and fallback coverage.
Actual ARM fixture adds explicit exponent-gap24/29/30/100, nearest-even ties and
inexact multiplication assertions alongside existing65536-operation fingerprints.
Full actual Node/Chromium regressions running; no production acceptance yet.

Final selected compiler versus prior production, new/old/new five-trial medians
(ms), no competing workload: clear normal-add6.076/20.964/5.547, normal-multiply
6.501/17.028/5.108, zero-add6.073/20.537/6.519, zero-multiply5.792/15.838/
5.109, cancellation5.709/19.781/4.691. Sticky normal-add4.996/4.906/4.714,
sticky normal-multiply4.852/4.590/4.498; code-page memory48.260/48.181/48.521,
linked-loop110.217/108.340/108.352, SVC119.016/115.567/116.938. Warmup variation
remains; no persistent large unrelated regression. Emitted corpus bytes137208/
133593/137208 (~2.7% growth),114 compiled modules and zero failures each.
`target/jit-exact-arithmetic-final-comparison.log`.

Selected compiler passes actual Node and Chromium CPU/context/FPSCR fingerprints,
new precision/tie cases, cache invalidation and fibers. JS28 and formatting/diff
checks pass. Logs `target/jit-exact-arithmetic-{build,node,browser,short-js}.log`.
Nine forced-JIT graphics fixtures are running; real-game measurement remains next.

Static build and all nine forced-JIT graphics fixtures each pass twice. Logs
`target/jit-exact-arithmetic-{web-build,MIPMAP,COMBINE,LIGHTING,LIGHT_ATTENUATION,
LIGHT_SPOT,FOG,MAPPED,POINT_PARAMETERS,PRESENT_BUFFERS}.log`. Retain candidate
for a fresh clean game measurement and both lesson checks. No runtime relink
needed: Rust/C production code and metadata are unchanged; worker imports JS.

Exact-arithmetic clean game d9475b81: menu162 s; training input234 s to Play438 s
(screenshot433 s) =204 s, versus209 s previously. This single five-second
difference is below screenshot precision; no material loading gain established.
Approximately3.3 FPS. No build/test/profile before Play. Both lessons pass:
SUCCESS canvas-523.png and canvas-813.png in `target/browser-jit-exact-arithmetic/`.
Lesson2 actual touch placement verified. Diagnostics after Play perturb later
timestamps, which are correctness evidence only. Deliberately stopped via UI.

Temporary helper wrapper after Play (roughly525–540 s, crossing into Lesson2)
observed3,057,599 helper calls/15.019 s. Among remaining specialized FP fallback
calls:396586 multiply,318937 add,197429 subtract,24 divide. Most are NaN pairs:
332744 multiply,300971 add,179493 subtract with sticky inexact; further zero/NaN
and infinity cases dominate the rest. Wrapper uses C-exported identities/status
offsets, preserves results, clears dispatch before module eviction, and restores
original imports in finally. `target/jit-exact-arithmetic-fallbacks.log`.
This explains why ordinary finite arithmetic benchmarks overpredict game gains.

A later15.105 s sample (~891–906 s, after Lesson2) observed797730 helper calls
but only70 tracked FP fallbacks (normal multiply rounding to zero), no NaN pairs.
`target/jit-exact-arithmetic-nan-pairs.log`. Phase matters; do not generalize the
transition distribution to steady gameplay. A short fresh startup diagnostic is
now collecting actual NaN operand/result patterns before any NaN specialization.
Read-only ARM source confirms signaling/payload/default-NaN rules must remain
intact; no NaN fast path has been implemented yet. M4/M5 remain open.

Fresh startup NaN probe (15.040 s,4,248,963 helper calls) captures canonical
quiet-NaN pairs:1077870 multiplies,975196 adds,582253 subtracts have operand /
operand / result bits7fc00000/7fc00000/7fc00000. This is2,635,319 calls, about62%
of instrumented helper calls and89% of tracked FP fallbacks. Other observed NaN
pairs involve zero or infinity. `target/jit-nan-startup-pairs.log`; diagnostic
screenshots/log under `target/browser-jit-nan-startup/`, `jit-nan-startup-game.log`.
The180 s inspector finished normally (exit0, final logs184 s); a later Stop
attachment got ECONNREFUSED because the process had already ended. No restart.

Read-only review of pinned softfloat-specialize.inc.c confirms ARM uses quiet
bit22, default positive NaN7fc00000, and ARM NaN selection rules. Two identical
canonical quiet NaNs return that same value without raising invalid, independent
of rounding/default-NaN modes; other payloads/signaling cases require the helper.
Next implement and measure only this exact observed pair, with all FPSCR modes
and flags validated before retention. No NaN shortcut is currently committed.


Canonical quiet-NaN candidate: specialize only two exact0x7fc00000 operands
for the four known ARM float32 arithmetic helpers; preserve FPSCR unchanged.
All other NaN payloads/signaling cases retain helpers. Actual ARM fixture adds
128 operation/mode checks (four operations,32 rounding/FZ/DN/sticky combinations).
Benchmark adds canonical add/multiply loops with clear and sticky flags.

Initial JS regression failed: helper fallback observed r1=0 instead of incoming
123. Definite-assignment tracking incorrectly carried a fast-branch write into
its alternate helper branch. Restore incoming definitions before each alternate
branch; retained assertion now passes along with all28 JS tests. This fixes
fallback ABI preservation even though these VFP helpers ignore that padding
argument. Logs target/jit-canonical-nan-{js,fixed-js}.log. cargo fmt --check and
git diff --check pass. Corrected actual CPU/browser checks and isolated benchmark
comparison are pending; no game performance improvement claimed yet.


Corrected canonical-NaN compiler passes Node and Chromium shared CPU/ARM/Thumb/
VFP/FPSCR, cache invalidation and fiber regressions. Logs
`target/jit-canonical-nan-fixed-{build,node,browser}.log`. JS28 including explicit
raw signaling/signed/different-payload NaN pairs pass. Isolated same-Wasm
new/old/new benchmark medians (five trials each; milliseconds): canonical
multiply3.861/15.027/3.518; add3.893/19.403/3.647; sticky multiply3.494/14.794/2.934;
sticky add2.979/19.494/2.871. Finite paths incur guard overhead: clear add-normal
5.721/5.402/5.712, multiply-normal5.760/4.930/5.251; clear add-zero6.675/5.550/7.060.
Linked blocks107.818/108.342/108.033 and SVC118.688/117.940/117.744 remain similar.
Corpus165723/163448/165723 bytes (+1.4%),134 modules, zero failures each.
`target/jit-canonical-nan-{benchmark,comparison}.log`. A first reporting script
failed on benchmark rows without a kind field; corrected parser uses default.
The benchmark itself passed. Retention depends on the measured game tradeoff;
finite arithmetic slows modestly while the observed loading NaN path is4–6x faster.

Static web build and all nine forced-JIT graphics fixtures each pass twice
(MIPMAP, COMBINE, LIGHTING, LIGHT_ATTENUATION, LIGHT_SPOT, FOG, MAPPED,
POINT_PARAMETERS, PRESENT_BUFFERS). Logs target/jit-canonical-nan-*.log.
Fresh clean TinkerBox run is underway, with no overlapping build/test/profile.


Canonical-NaN clean TinkerBox result (uncommitted candidate on30e4284c): menu
visible152 s versus162 s prior (one screenshot interval). Training input215 s
to Play388 s =173 s, versus204 s previous (~15% less in one comparison; not
three-trial acceptance). Driver matched Play at canvas-382.png. First60 s after
Play:49 FPS log samples, median3.19, range1.87–3.48; these are runtime FPS logs,
not frame-time percentiles or simulation-speed verification. Both lessons
SUCCESS: canvas-442.png and canvas-713.png under target/browser-jit-canonical-nan/.
Actual touch placement confirmed in lesson2-placed.png. Pinch accepted normally.
No competing build/test/profile through either lesson. Diagnostic profiling
started only afterward and its later timestamps are not performance acceptance.
Logs target/jit-canonical-nan-{game,driver}.log. Retain the measured loading gain
with finite-path overhead explicitly recorded. Ten-second/30 FPS targets remain
unmet; hardware GPU, Firefox/WebKit and physical mobile validation remain open.

Post-lesson diagnostic15 s sample (13476 samples) now shows generated Wasm4119,
TCI dispatcher1501, CPU1266, JS compile924, lookup633, Module543 and Rust
GuestMemory::slice_mut477; soft-float no longer appears in the top30.
This is a different phase, not a controlled before/after profile. Inspect
HLE byte-at-a-time memory operations and compilation/dispatch next.
Artifacts target/jit-canonical-nan-after-lessons-profile/{summary.json,
worker.cpuprofile,page.png}. Game deliberately stopped via #stop; inspector
exit1 follows that stop, not a guest crash. No game process remains.


Next measured candidate: profile parent stacks attribute419/477 slice_mut
samples to GenericChar<u8>::memset. Replace byte-at-a-time narrow memset with
page-bounded slice.fill, preserving count=0 (including NULL), unsigned-byte
conversion, return pointer and checked destination size. Page chunks preserve
valid adjacent guest mappings without requiring contiguous host storage. Wide
character routines remain unchanged. No new dependencies.

Original ARM HLE fixture now checks empty NULL regular/checked fills, return
pointer, byte truncation, unaligned multi-page fill and untouched sentinels.
It passes twice against previous runtime; native unit suite33/33 and formatting
pass. Logs target/jit-memset-{baseline-browser,native-tests}.log. Browser runtime
rebuild/new regressions pending. Local original-guest100 MiB benchmark uses
gettimeofday around100 one-MiB memset calls; scripts target/make-memset-bench.py
and target/compare-memset.mjs, previous runtime preserved under
 target/runtime-before-memset/. No benchmark or game gain claimed yet.


Chunked memset runtime builds and the original ARM regression passes twice in
Chromium forced-JIT (target/jit-memset-{runtime-build,browser}.log). Isolated
actual guest gettimeofday benchmark,100 calls of1 MiB each, new/old/new groups
with five fresh workers each: medians78/9158/74.001 ms; ranges69–79.001,
9136–9242,67–81 ms. Approximately120x faster for this workload, not game FPS.
No overlapping build/test/game during timings. target/jit-memset-comparison.log.

Reproduce benchmark IPA with `python3 web/fixtures/make-hle-ipa.py --memset-bench`:
original guest prints MEMSET_START/END seconds and microseconds. Local browser
comparison script target/compare-memset.mjs routes old runtime assets from
 target/runtime-before-memset/ for the middle group. Initial measured local
fixture and new tracked generator produce identical extracted files; ZIP binary
comparison differs only because timestamps differ. Native actual guest and nine
graphics regressions underway; clean-game effect remains unmeasured.

Native actual ARM HLE fixture exits0 with updated fill. All nine forced-JIT
graphics fixtures each pass twice; formatting/diff checks pass. Logs
 target/jit-memset-native-guest.log and target/jit-memset-{MIPMAP,COMBINE,LIGHTING,
LIGHT_ATTENUATION,LIGHT_SPOT,FOG,MAPPED,POINT_PARAMETERS,PRESENT_BUFFERS}.log.
Clean TinkerBox run started after all tests finished, without competing work.


Chunked-fill clean TinkerBox run: menu152 s; training input229 s to Play397 s
=168 s (driver matched canvas-393.png), versus173 s prior. Five seconds is below
screenshot precision; no material loading gain established for this change.
First60 s after Play:49 FPS log samples, median3.25, range2.19–3.53, versus3.19
prior; no real-time claim. Both lessons SUCCESS in canvas-463.png/canvas-723.png
under target/browser-jit-memset/. Actual touch placement verified in
lesson2-placed.png and pinch accepted. No competing build/test/profile through
both lessons. Logs target/jit-memset-{game,driver}.log. Stop requested through UI
after success. Retain the simple measured fill improvement, with its limited game
effect explicit. Next focus remaining CPU dispatch/generated-code/compilation
cost; all original game/device acceptance targets remain open.


Dispatch-cache diagnostic after81561e72: initial Playwright page.workers lookup
failed with Missing runtime worker because the worker predated CDP attachment.
Retried using repository CDP target discovery;15.1515 s startup sample observed
121486 JS lookups:105141 already compiled,15100 cold,1245 missing. Simulated
8192/16384/32768/65536-entry direct tables could avoid0/40610/70391/86336 of those
lookups. Simulation sees native misses only, starts empty, mirrors registration
slot invalidation and JS clears, and modifies no guest code/results. Restored
wrappers in finally. This is projected lookup avoidance, not measured speedup.
Logs target/jit-dispatch-lookups{,-cdp}.log.180 s diagnostic exits normally.

Candidate expands only native compiled-function dispatch table from8192 to65536
entries (+448 KiB static storage); compiled-code/metadata limits are unchanged.
Use a shared size constant for table/index/invalidation. Existing actual CPU
cache rewrite/eviction/fiber regressions and measured throughput gate retention.
Previous benchmark saved in target/dispatch-cache-small/. No performance gain
claimed yet; source patch is an uncommitted experiment.


Large dispatch table passes actual Node/Chromium CPU/FPSCR/cache/fiber tests;
logs target/jit-dispatch-cache-{build,node,browser}.log. Existing microbenchmarks
new/old/new (five trials per workload) are mixed: linked107.538/108.287/114.693 ms,
SVC119.303/121.554/117.942, memory47.296/48.470/47.987. Third-group cancellation
8.020 ms vs5.544/5.287 is a noisy outlier requiring follow-up. Other short-loop
results vary; no broad gain claimed. These workloads do not create the observed
game-sized dispatch working set. target/jit-dispatch-cache-{benchmark,comparison}.log.
Full runtime/graphics checks underway; game measurement and focused repeat pending.

Large-table full runtime and nine graphics fixtures each pass twice. Isolated
repeat new/old/new medians: cancellation5.606/5.132/5.060 ms,
linked108.414/108.947/108.014, memory48.467/47.498/47.733,
SVC120.036/119.840/118.185. Earlier third-group outliers do not persist.
Logs target/jit-dispatch-cache-{runtime-build,repeat,graphics fixture names}.log.
Clean game run starts after all tests/benchmarks finish; no concurrent profiling.


Large dispatch cache rejected: clean game menu153 s (prior152), training229 to
Play397 =168 s, exactly matching smaller table. First60 s after Play:50 FPS
samples, median3.275, range2.24–3.54 vs3.25 prior. Lesson1 SUCCESS confirmed at
canvas-473.png under target/browser-jit-dispatch-cache/. No material game gain
justifies extra448 KiB. Restore8192-entry source table and original patch;
production runtime rebuild pending. Candidate was not committed. Named-block
profiling afterward is diagnostic only, on the rejected larger-table binary;
its timing must not be used for performance acceptance.

Named-block diagnostic on rejected large-cache binary:12924 samples,9970 idle
(~77%), CPU344, getParameter341, dispatcher194; hottest individual generated
block56 samples. target/jit-dispatch-cache-named-blocks.log; screenshot
 target/jit-named-blocks.png. This later training phase cannot explain CPU-bound
startup or justify register promotion. Earlier software-raster probes remain
relevant; do not equate idle samples with one proven cause. Game stopped via UI
(exit1 expected); restoration build/tests running.

Attempted T3 collaborative preview as an additional browser route: status reported
unavailable, and preview_open failed: "Chrome will not start its sandbox as root,
so T3's browser cannot run while the T3 server runs as root." No server settings
changed. Continue documented repository Chromium workflow; no hardware GPU or
additional device validation obtained from this attempt.

Restored production8192-entry runtime and shared CPU rebuild successfully.
Node/Chromium CPU/FPSCR/cache/fiber checks pass; actual HLE guest (including
memset checks) passes twice. Formatting/diff checks pass. Logs
 target/jit-dispatch-restored-{runtime-build,build,node,browser,hle}.log.
CPU benchmark artifacts restored from saved small-table baseline. No active
game remains. Production code remains81561e72; only negative experiment evidence
is retained in this follow-up. Next sample named blocks during CPU-bound startup
before applying any further compiler optimization; real-time/device goals remain
open and opt-in JIT remains appropriate.


Named startup profile on production b0ec3cd5 (diagnostic name sections added as
blocks first compile; no cache flush):13481 samples, CPU1552, lookup863,
dispatcher817, HLE run_call754; hottest generated blocks550/275/216 samples.
Top block has304 stores/402 loads, including68 pairs at private scratch offsets
-504/-500. Second has793 stores/1090 loads and230 pairs at those offsets.
Artifacts target/jit-named-startup-{game,profile}.log, jit-named-startup.png.
Inspector150 s run ended normally. This profile establishes CPU-heavy startup,
unlike the previous mostly idle later-training sample.

Candidate promotes aligned private TCI scratch slots to Wasm locals. Pinned
backend reserves r15, uses negative frame offsets, and passes normalized helper
arguments through registers (tcg-target.inc.c tcg_out_call/tcg_set_frame).
C exports actual private-frame size; older runtime metadata keeps memory path.
Reject promotion for any exposed r15 value, partial/out-of-frame access or opaque
helper requiring full state. Initialize used slots from frame at block entry,
keep locals over same-block backedges, flush written slots at ordinary exits.
The frame is host-private scratch, not guest RAM or CPU architectural state;
normalized helpers cannot alias it unless its address escapes. Existing guest
memory checks and helper behavior are unchanged. Edits apply only after full
block inspection; unknown paths conservatively retain original emitted code.

JS32 tests pass (target/jit-stack-locals-final-js.log), including seeded branch/
call comparisons against unpromoted compiler, memory growth, linked exits,
backedges/unlinking, address escape, opaque helper and byte-write fallback.
Formatting passes. Actual ARM/CPU/cache/fiber checks are running; throughput and
game gains remain unproven. Candidate is not committed.

Initial unrestricted promotion passes actual Node/Chromium CPU/cache/fiber tests,
but benchmark corpus grows180403 vs165723 bytes (+8.9%) and small loops show no
broad gain (linked111.849/108.691/111.595 ms new/old/new; sticky NaN add
3.796/2.947/3.808). Do not retain that version. Add exact emitted-byte gate:
rewritten accesses must save more bytes than slot entry loads, exit flushes and
local declaration growth cost. Tiny blocks retain original code. Tests now use
profitable repeated spills and assert generated size shrinks so the optimization
is actually exercised. JS32 still pass. Add32-dependent-VADD chain workload,
3,400,006 guest instructions per trial, to represent larger arithmetic blocks.
Gated benchmark running; logs target/jit-stack-locals-{comparison,gated-*}.log.

Gated scratch promotion also lacks convincing throughput benefit. Same-runtime
new/old/new medians:32-add chain143.337/138.194/133.391 ms, sticky chain
85.306/77.548/81.606; emitted300623/305573/300623 bytes (1.6% smaller) but
compilation364.6/254.5/310.8 ms. Retain representative chain benchmark, not scratch
promotion. Prototype saved locally as target/stack-locals-prototype.patch and
 tci-jit-stack-locals-gated.js; compiler/metadata/tests restored before next trial.
No scratch promotion enters production.

Second named startup sample confirms hottest blocks are float-helper heavy:
first block511 samples with28 adds,28 multiplies,16 subtracts; second229 samples
with100 adds,48 multiplies,82 subtracts. Raw TCI for top three stays local under
 target/jit-named-startup-calls-profile.log (never commit derived game bytes).
This supports the VFP chain workload. Diagnostic150 s run ends normally.

Next candidate: explicit partialFallback metadata permits a failed float guard
to save TCI temporaries and return its call PC, so C interprets from that point.
Successful math does not rejoin a helper import in the generated function.
JS29 and actual Node CPU tests pass so far; Chromium checks/benchmarks pending.
This can regress workloads with frequent failures; compare before retention.

Float side-exit experiment rejected. First equal code-size totals were checked:
metadata partialFallback is true,385 matching float calls and75 generated blocks
change instructions; equal lengths were coincidental, not a missing feature.
Diagnostic target/jit-float-side-exit-metadata.log confirms actual exercise.

Final same-runtime new/old/new comparison (five trials each): normal32-add chain
145.020/138.809/143.495 ms; sticky77.708/76.705/76.456. Canonical-NaN-plus-zero
chain811.560/548.243/804.832, sticky807.213/543.254/808.671 (~47–49% slower).
Linked108.339/108.319/107.899 and SVC117.969/117.422/117.325. No fast-path gain
justifies interpreting tails on fallback.154 modules,445423 bytes, zero failures
per group. Logs target/jit-float-side-exit-fallback-{benchmark,comparison}.log.
Restore production compiler/metadata/tests; retain new finite/fallback VFP chain
benchmarks and negative evidence. No game run needed for this rejected regression.
Production full runtime was never relinked for either candidate; shared CPU and
benchmark artifacts are being rebuilt to match restored source.

Restored baseline passes JS28, actual Node/Chromium ARM/FPSCR/cache/fibers and
expanded interpreter/JIT benchmarks, including both32-add chains with exact
result/flag assertions. Logs target/jit-vfp-chains-restored-{js,build,node,browser,
benchmark}.log. Full game runtime remains unchanged. Next measured candidate is
an exact canonical quiet-NaN/positive-zero shortcut within the existing fallback
branch, preserving ordinary fast-path cost; verify pinned ARM NaN/zero flags.


Canonical quiet-NaN/positive-zero candidate (after1a3c5adb): in the existing
float fallback branch, require `(a | b) == 0x7fc00000` and at least one operand
word exactly zero. Thus the other is exactly the canonical quiet NaN. Return
canonical bits and zero high word without changing status. The pinned soft-float
rules select quiet NaN before zero arithmetic, including division; neither input
is denormal/signaling. Ordinary successful arithmetic and two-canonical-NaN
paths do not execute the new predicate. All other cases retain helper semantics.

JS28 pass with negative-zero, signaling/payload and split-bit lookalike cases.
Actual ARM tests add256 checks (four operations ×32 modes ×two operand orders)
to the prior128 canonical-pair cases; test exact result and unchanged FPSCR.
Node CPU/cache/fiber checks pass; Chromium verification and benchmark pending.
Formatting/diff checks pass. Logs target/jit-nan-zero-{js,final-js,build,node,browser}.log.
Candidate is not committed and no game improvement is claimed yet.

Canonical-NaN/zero passes actual Chromium CPU/FPSCR/cache/fibers. Isolated
same-runtime new/old/new benchmark medians (five trials each; ms): NaN+zero chain
99.718/551.704/100.632; sticky74.167/536.024/72.513 (~5.5x and7.4x faster).
Finite chain149.874/139.085/139.681; sticky79.354/76.645/79.654 (~4% slower).
Linked112.776/109.086/108.569, memory47.857/48.013/48.145,
SVC126.854/119.903/123.886. Initial group is generally slower; no broad normal-
arithmetic gain claimed. Emitted470803/445423/470803 bytes (+5.7%),154 modules,
zero failures each. Compilation359.9/308.9/314.7 ms. Logs
 target/jit-nan-zero-{benchmark,comparison}.log. Static build/graphics checks
underway, then clean game timing will determine retention.


Canonical-NaN/zero retained after clean game: menu canvas142 s, Training input206
to Play364 =158 s versus168 s baseline (single runs; screenshot cadence10 s,
so the10 s difference is modest evidence). Lesson1 SUCCESS at432 s and Lesson2
SUCCESS622 s; pinch and real touch drag placement verified. First60 s after Play
has49 logged FPS samples: median3.16, range2.36–3.54 (baseline3.25 median). No
frame-rate improvement claimed. Chromium141/ANGLE SwiftShader, no hardware GPU.
Under10 s and30 FPS targets remain unmet. Logs target/jit-nan-zero-{game,driver}.log;
local screenshots target/browser-jit-nan-zero, including lesson2-placed.png.

All nine forced-JIT graphics fixtures pass twice: MIPMAP, COMBINE, LIGHTING,
LIGHT_ATTENUATION, LIGHT_SPOT, FOG, MAPPED, POINT_PARAMETERS, PRESENT_BUFFERS
(logs target/jit-nan-zero-<fixture>.log). npm run build --prefix web, JS28,
Node/Chromium CPU/FPSCR/cache/fibers, cargo fmt --check and git diff --check pass.
No production Rust/C change requires runtime relinking; refreshed compiler is
served from web/dist. Inspector exited1 after deliberate Stop; driver exited0.
Next: diagnostic startup helper distribution after these shortcuts; keep its
instrumented timings separate from acceptance. Native/mobile/other-browser
coverage is unchanged.
