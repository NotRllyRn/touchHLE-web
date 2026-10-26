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
