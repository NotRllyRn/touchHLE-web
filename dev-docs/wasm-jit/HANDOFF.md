# Offline precompilation checkpoint

Updated: 2026-10-27. User resumed work, pivoting to a local IPA-to-web converter
and static per-game player. Public0.0.0.0:8765 preview stopped as requested.
The new engineering objective is in PRD.md; full static translation is unfinished.

## Goal metadata limitation

`create_goal` rejected replacement: an unfinished paused goal already exists.
Available tools cannot cancel/replace/resume it. Do not mark the old unmet goal
complete to bypass this. User has explicitly authorized continued engineering
under the new objective; PROGRESS.md tracks that work independently.

## Source and artifacts

- Main branch, origin ssh://git@github.com/NotRllyRn/touchHLE-web.
- a517977e: query cache baseline;4c7c7c09: revised plans;
  cc9fc835: offline packages;cedb96c1: immutable portable imports. Pushed.
- Runtime C/Rust Wasm is unchanged by this pivot. Current JS/compiler source
  is copied to web/dist by both build scripts. Public server remains off.
- Local diagnostic servers:127.0.0.1:8765 serves web/dist;127.0.0.1:8766 serves
  ignored target/. Do not expose target/ publicly; it includes private artifacts.
- Latest package: target/aot-tinker-globals. Original owned IPA:
  /root/local-ipas/TinkerBox HD 1.4.1.ipa. No proprietary content committed.
- Runtime compiler portable ABI 3; archive/trace outer format 1. Older raw TCI
  traces with ABI 1/2 can be recompiled against the same core runtime.

## What works and what does not

`web/precompile-ipa.mjs INPUT.ipa OUTPUT_DIR` performs bounded local capture,
offline Wasm compilation and static game packaging. Optional --capture reuses
an existing trace; --seconds and --clicks control coverage; --threshold 1 is for
short original test IPAs. Read exact syntax in web/README.md. Generated player
has Play/Stop and no IPA chooser. ?cpu=jit skips the precompiled cache for A/B.

This is **profile-assisted TCI-to-Wasm precompilation**, not full static ARM
recompilation. ARM-to-TCI decoding still runs to identify current blocks; unseen
blocks retain JIT. Whole-app static discovery and removing runtime ARM decoding
remain unfinished. Do not describe this as a completely precompiled IPA.

Portable blocks bind current move immediates as immutable imports, including
engine-private pointers; base-relative helper PCs/links and live exit identities
remain correct. Re-registration rebinds values. Layout/code identity and pinned
core fingerprints guard reuse. Caches retain existing bounds and invalidation.

## Validation and measurements

- 35 JS tests pass; actual ARM/Thumb/VFP/FPSCR/context/SVC/fault/budget/invalidation/
 eviction/fiber suite passes capture and offline modes:14,926 offline instances,
 0 misses/failures,61 templates. Final logs target/aot-immutable-*-final.log.
- Initial immutable-import test found10 large-block compile failures. Fixed
 unsigned LEB128 import count and added150-import test. Failure retained in
 target/aot-immutable-cpu-tests.log; no hiding fallback failures.
- CLI end-to-end capture/compile/package and two fresh browser runs each pass
 for mipmap and presentation fixtures, all130/103 block instances offline.
- TinkerBox clean v2/v3/immutable variants and fresh JIT reference pass both
 lessons, actual pinch and touch placement; placement/SUCCESS images inspected.
- Immutable package:15,646 templates,38,491,889 Wasm bytes,66,016,377 JSON bytes.
- Clean immutable preparation1,942.8 ms; previous decoder version11,998 ms.
 Native Base64/fallback loop isolated decode+checksum medians1,045.9/1,445.4 ms
 versus10,248 ms original. Raw log target/aot-decode-isolated.log.
- Immutable-import loop median6.773 versus7.510 ms live TCI reads (~10% targeted),
 normal JIT5.913 ms. Not a whole-game improvement estimate.
- Single clean immutable game: menu checkpoint133 s, Training229 -> Play372 =143 s;
 first 60 s51 logged FPS samples, median4.24, range0.60–8.95.
- Same-package fresh JIT reference: menu151 s, Training241 -> Play389 =148 s;
50 samples, median3.825, range0.65–8.93. Earlier optimized live-immediate package:
142 s level,4.63 median. Small differences require repeated trials.
- Profiled level loading:47% of sampled worker CPU in generated guest Wasm;
 CPU dispatch/HLE also significant. Asset decompression not a leading cost.
 Existing IPA implementation already caches decompressed entries.
- Host i9-13900H,x86_64,8 online logical CPUs; Chromium 141/CPU SwiftShader.
 No hardware GPU, Firefox/WebKit or physical mobile validation. User's laptop
 report (~30 s loads, apparent full-speed gameplay) is qualitative, separate data.

## Completed repeated comparison

All alternating trials finished. Offline level intervals 143/149/138 s
(median 143, range 138–149), JIT 148/142/149 s (median 148, range 142–149).
Offline first-minute FPS trial medians 4.24/4.495/4.27, JIT 3.825/4.64/4.81.
No clear whole-game gain: ten-second screenshot cadence, driver delay and trial
variation exceed the apparent small difference. Final repeated offline counters
show 20,943/21,216 precompiled instances, 2,939/2,678 misses, zero failures.
All six accepted logs have no page-error/panic/RuntimeError signatures.

Harness target/repeat-tinker-loads.py, rows target/aot-repeat-results.jsonl,
summary target/aot-repeat-driver.log. Inspector exit1 follows deliberate UI Stop;
drivers terminate intentionally. Full lesson correctness was checked separately.
Previous late-driver immutable attempt remains discarded.

## Next steps

1. Measure selective constant specialization: keep small move literals exact in
   module identity and generated Wasm; bind remaining immediates per engine.
   This is an optimization experiment, not evidence of static ARM discovery.
2. Retain only measured changes with CPU/fixture/game regressions. Update
   PROGRESS/browser.md with failures as well as gains; commit/push tested work.
3. Full static discovery/translation-cache restoration requires explicit guest
   code/CPU-state validation and relocation/search-data handling. Do not ship an
   unsafe whole-binary linear sweep or claim current ARM decoding is eliminated.
4. Sub-10-second/device acceptance is open. Avoid repeating rejected dispatch,
   tail-call, scratch and float-side-exit experiments without new evidence.

No subagents authorized. Proprietary code/assets/traces remain under ignored
local paths. SDK target/emsdk; Playwright module
/tmp/touchhle-browser-tools/node_modules/playwright/index.mjs. Exact history,
commands, failures and limits: ../browser.md; plans and progress alongside this file.
