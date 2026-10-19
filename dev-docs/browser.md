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
- Browser runtime not yet implemented. Emscripten is not on PATH; installed Rust
  targets include wasm32-unknown-unknown but not wasm32-unknown-emscripten.
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
