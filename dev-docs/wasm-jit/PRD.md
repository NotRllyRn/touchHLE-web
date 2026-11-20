# Optimizing offline ARM-to-Wasm product requirements

**2026-10-29 22:08 UTC measured update:** full offlinePNG preparation with
scalerON reduces repeatedMenu26–31% against both controls, at246–251MiB endpoint
PSS cost. A fixed11PNG variant yields13–20% and23–24MiB overhead but fails its
stricter1s/no-Pause-regression target. Exact pixel/health/cleanup gates pass in
both series; performance acceptance remains scoped. The secondPause regression
is not reproduced by later third-cycle profiles. See latest ACTIVE-GOAL/HANDOFF
and target/tinker-png-menu-selective-20261029/RESULTS.md. No whole-app offline,
under1s, FPS or broad-game acceptance; hosted package unchanged.

**2026-10-29 21:02 UTC renewed direction:** the user explicitly authorized a
new45-minute observer-fix/PNG measurement window and continued exploration of
new performance improvements. The preceding two-experiment stop is superseded.
Current experiment deadline21:47:44UTC; preserve exact gates and serialized real
game comparisons. New opportunities must be backed by measured costs and bounded
to an actual interaction result; frozen loader prerequisite expansion is not
implicitly resumed. Earlier concluded-window statements below are historical.

**2026-10-29 user-directed performance focus:** profile-assisted packaging exists;
whole-app discovery, runtime frontend removal and subsecond game interactions
remain incomplete. Loader/owner/provenance prerequisite expansion is frozen.
Further work must have a bounded real-game performance justification and an
actual interaction measurement; prerequisite, compile or test completion is
not acceptance. Preserve the full offline compiler objective and all correctness,
native, source/license and static-hosting constraints. No commits or pushes.

Fresh scaler OFF/ON/OFF repeated Tools Menu bounds are 8201.4/6097.5/7770.5 ms:
21.5–25.7% lower against both controls, beyond430.9 ms drift, with unchanged
visual/health/cleanup gates. This reconfirms an existing private gain; it is not
subsecond performance or new compiler acceptance. The bounded window is now
concluded: incremental PNG HLE gained only4.0–4.8%, below the useful-gain target;
the final offline PNG asset trial stopped on an original-leg startup observer
failure before interaction measurement. No candidate asset latency or memory
result exists. Retain the validated private scaler-only export; no third
experiment or resumed prerequisite chain is scheduled. Raw evidence and the
stop decision are in [ACTIVE-GOAL.md](ACTIVE-GOAL.md) and
`target/tinker-png-offline-menu-20261029/RESULTS.md`. Full acceptance below remains
unmet; a six-second Menu improvement does not establish the under1s target.

Immediate experiment acceptance requires the same named interaction to improve
against both original controls beyond baseline drift, aiming for >=10% or >=500 ms
on a roughly6-second Menu. Record raw observation bounds, visual equality,
cleanup, compilation cost and memory limits. A mixed result is rejected; after
two unsuccessful bounded experiments, report a concrete decision instead of
starting another prerequisite chain. This milestone does not shrink the full
product requirements below.


**Latest user target (2026-10-28):** eliminate menu, pause, object-palette,
conveyor/ball/chain drag-spawn and release hitches, and make TrainingLab1 loading
and automatic next-level transitions finish in **under1s on this machine**.
User confirms the rendering fix on iPhone17 Pro Max/Brave; latest informal load
reports~5s first level and2–3s next-level black screen. Read
[ACTIVE-GOAL.md](ACTIVE-GOAL.md) for the exact acceptance events and next action.
Hosted8766 package is frozen and ACTIVE; earlier stopped-server notices are
historical. Current task status and evidence live in ACTIVE-GOAL.md and the newest
HANDOFF.md entry; parent serializes heavy workloads.


## Current performance work and completion boundary (2026-10-28)

The offline package CLI and archives remain useful infrastructure, but do not
yet satisfy the optimizing whole-app compiler or sub-second interaction goal.
The latest private image-scaling and PNG-filter experiments reduce observed
tools-Menu bounds in controlled comparisons; they remain unpromoted and all
measured actions remain over one second. Native/browser correctness and narrow
gameplay checks are evidence for those experiments only.

Recovered exact same-worker residual module bodies now support investigating
checksum, channel conversion and inflate work. Static PC-store navigation and
CPU module sample weights do not establish per-function time or sampled guest
registration. These initialization optimizations complement offline translation;
they do not replace requirements for larger connected regions, reduced dispatch,
safe removal of runtime decoding, package memory limits or full-game acceptance.
See ACTIVE-GOAL.md for current evidence and the exact next action.

**Historical 2026-10-28 package checkpoint (superseded by ACTIVE-GOAL.md):** rendering fix and guarded float
conversion shortcuts are integrated. Public8766 was stopped at that checkpoint. Nine clean,
rotated fresh-browser package runs (three/configuration) now pass. Selected-level
median observation bounds: original121.113–126.160s, prepared baseline27.849–32.635s,
prepared paired28.669–33.232s. Offline preparation of the music track repeats the
large gain; no additional archive level-load gain is established. Browser endpoint
PSS medians1583/1676/2141MiB respectively; sampled running memory is not true peak
or mobile memory. Paired total-startup medians differ, but individual bounds overlap.
The full114.6175s music-loop comparison, both lessons and repeated player cleanup
pass. iPhone17 Pro Max/Brave Training5 rendering/performance retest remains external.
Optional `package.mjs --gzip` passes12 tests and actual compressed HTTP import/
restore plus two Play/Stop/refetch/audio cleanup cycles. All39 raw files are exact;
19 sidecars shrink265,228,932→31,268,220 bytes (88.21%). IPA unchanged. This reduces
encoded transfer bytes, not execution time or decoded runtime memory.
Follow-up live-body attribution maps32/40 hot scripts after sampling. A recency
bookkeeping candidate passes56+56 regression and2differential tests, but three
clean ordinary-JIT game runs show overlapping level-load bounds; unpromoted.
Next: archive resident memory and paired dispatch attribution, plus separately
validated startup audio preparation. Whole-app AOT/FPS/mobile acceptance remains
unmet. See [HANDOFF.md](HANDOFF.md) and [browser.md](../browser.md).

**Historical 2026-10-28 rendering update:** the split-VBO fix is packaged; the earlier port8766
service is now stopped. The direct Training5 scene now shows its button and placed conveyor
in Chromium; iPhone/WebKit validation remains external. Nine browser/native
pixel checks and eight ARM graphics fixtures (twice each) pass. Conversion integration and its measured limits are recorded above. See [HANDOFF.md](HANDOFF.md) and
[browser.md](../browser.md) for artifacts, scope and current next steps.

**Resumed 2026-10-27 at user request.** Fix reported invisible buttons and
conveyor belts before promoting performance changes. Current evidence and next
steps are in [HANDOFF.md](HANDOFF.md); older pause statements are historical.

Updated: 2026-10-27. Active thread goal contains the user's renewed request.
TinkerBox is the acceptance app; expand to other proprietary IPAs afterward.

## Product and baseline

A local CLI converts a locally owned ARM32 IPA into a static game-only website.
Visitors play without an IPA chooser. CPU execution, graphics, audio, input and
saves stay on the device; hosting serves static files. Preserve touchHLE's Rust
HLE, native correctness reference, licenses and existing compatibility fixes.

Current a3220587 baseline is profile-assisted TCI-to-Wasm packaging with runtime
ARM decoding and JIT fallback. It completes both training lessons but shows no
clear scene-load advantage: three-trial software-GPU medians 143 s offline versus
148 s JIT. This is not the requested optimizing whole-app compiler.
User reference: M3 Max MacBook, 16-core CPU, 64 GB RAM; reported ~30 s loads and
apparently 30–60 FPS. OS/browser and controlled frame-time results are unverified.

## Combined-runtime checkpoint


Verification reuse is now validated in tracked JS. Immutable IPA snapshots and
single-use transferred archive handles preserve exact-byte checks before runtime
execution, reducing large-input hashes from 3 IPA + 2 native to 1 + 1. Final JS
suite:106/106. Node/browser restore, capture, disabled and rejection fixtures pass.
Fresh package: `target/tinker-verification-reuse/site` (305,834 native records;
13,484 portable blocks). Only worker/helper JS changed in the runtime distribution;
there was no new native build. Older namespace captures remain incompatible.

A serial matched-cache original/candidate/original startup comparison reached
Terms at navigation-relative bounds (111.574,114.784] / (103.957,107.154] /
(109.546,112.761] seconds. Both sites used identical 10,589 portable modules and
native records excluding namespace binding. This supports a modest startup gain
in one sandwich, not scene loading or FPS acceptance. Full-package delayed
Play/Stop/Play/cancel, audio activation, buffer transfer and cleanup pass. Served
IPA/native mutations reject before runtime output; new-page/legacy-helper mixing
rejects before payload fetch. Exact runs and the preserved failed harness are in
browser.md and target/tinker-verification-reuse/.

Portable replay capture is now implemented and validated as an optional CLI mode.
It reuses the exact native archive with native capture off, collects actual replay
keys, and requires worker fingerprint/admission/restore proof. Final JS tests109/109;
real rejected-native fallback cannot produce successful paired output. Candidate
has12,951 portable keys versus13,484 before, with only2,536 common (common Wasm
bytes identical). All runtime/player/IPA/native bytes match.

Clean original/candidate/original scene bounds are (130.541,133.798] /
(132.528,135.845] / (130.523,133.807] seconds. Reported portable misses fall from
11,664/11,788 to3,148 and cumulative compilation from15.428/15.591 to8.446 seconds,
but no scene-loading gain is established. All visual stages, native coverage,
zero reported JIT failures and cleanup pass. These are asynchronous compiler
observations with stated gaps, not exact phase times. Keep replay-capture optional;
current default remains unchanged. Exact results: target/tinker-replay-portable/
and browser.md. No FPS/both-lesson/whole-app AOT acceptance follows.

Next: profile the actual Training load on verified promoted bytes with the raw
worker CDP path, preserving cached modules and visual phase boundaries. Resolve
generated-code/dispatch/guest-asset attribution before another compiler or asset
change. All sessions from the replay comparison are finished; goal remains active.

Earlier archive comparison (before verification reuse):

The offline IPA/Wasm conversion goal remains active and unmet. Serial private
package trials baseline-1 / paired-2 / baseline-2 show no loading gain: Training
input to first playable screenshot intervals are (127.641,130.641] /
(130.116,133.116] / (126.856,130.856] seconds. Endpoint PSS is respectively
1,691,709,440 / 2,362,776,576 / 1,700,979,712 bytes (about 1613/2253/1622 MiB),
for the inspector and descendants, not peak browser memory. Runtime timings
start after Play; verified file preflight is separate and reads both archives
in both modes. These results establish neither download savings nor FPS gains.

paired-2 reached the playable scene and Stop terminated its worker, but its
post-scene restart HARNESS timed out after 90,000 ms without requesting stats.
Keep that failed result. Corrected restart-1 polls stats and passes fresh-worker
import/restore, two-worker lifecycle and second Stop. It is a lifecycle check,
not another scene timing or both-lesson acceptance.

Tracked-source opt-in promotion is in progress: `TOUCHHLE_WEB_TB_ARCHIVE=1`,
seven core patches, guarded C bridge/Rust loader transcript and web archive
build/capture/package/player. The promoted opt-in build and fresh Node/Chromium fixture checks pass:
28 imported records restore with zero frontend calls; capture/disabled modes
also pass, including corrupted-archive rejection with successful normal decode.
Native Rust reference tests pass 33/33. The promoted full CPU suite passes with
JIT off/on (14,926 modules, zero failures or retained modules/bytes). The separate
default-off runtime build and original guest fixture pass with JIT off/on. Private package
`target/tinker-native-paired-site-1` predates the promoted verification changes
and task33's player transfer fix. Task33 removes the retained page JS archive
copy by transferring its verified allocation; later Play reloads and verifies
it. Task36 additionally preserves synchronous audio activation before refetch.
The full JS suite passes 100/100; real Chromium delayed-refetch/restart/abort
checks prove two 167,768,360-byte buffers detached, audio resumed during all three
clicks and final workers/audio cleaned up. Total-memory remeasurement is pending.
No whole-app AOT, complete frontend elimination, speed acceptance or FPS claim follows.

Engine-pointer hoisting remains isolated after a controlled real-game A/B/A:
Training load bounds were (126.778,129.933] / (126.516,129.913] /
(128.566,131.895] seconds, with zero reported JIT failures and no convincing gain.
Raw baseline/paired/baseline startup profiles expose import/verification costs;
they do not establish a speedup. The duplicate search-check proposal remains
unimplemented. Exact profiles, harness failures and limits are in browser.md.

Fresh promoted capture reached the first lesson scene with zero reported JIT
failures. Its native archive retains 305,834 records in 167,768,360 bytes, with
explicit quota omissions; packaging generated 13,467 portable modules using
45,641,933 cache bytes. This closes capture/packaging operational validation,
not clean game timing, both-lesson or FPS acceptance. Private output:
`target/tinker-promoted-site-1`.
Real Chromium Play/Stop/Play, delayed-refetch cancellation, transferred-buffer
detachment and audio activation/cleanup checks pass on this exact new package.

## Requirements and acceptance gates

- R1: Preserve reproducible local conversion, immutable package identities,
  corrupt/stale-input rejection and game-only player. Never commit game assets,
  IPAs, saves or raw proprietary code traces.
- R2: Generate faster Wasm through measured optimization, including evaluating
  larger connected regions, safe frontend removal and initialization/HLE costs.
  Packaging success or more cached blocks alone does not satisfy this gate.
- R3: Profiling must expose hot instructions/blocks, generated-code composition,
  helper/HLE costs, compilation, dispatch and scene phases. Separate dynamic
  counts, sampled self/inclusive time and controlled instruction microbenchmarks.
  Report unsupported attribution instead of inventing per-instruction timings.
- R4: Preserve ARM/Thumb/IT/VFP/FPSCR semantics, exceptions, faults, context swaps,
  budgets/input responsiveness, self-modifying-code invalidation and bounded
  caches. Safe dynamic fallback is allowed and its frequency must be reported.
- R5: Full static coverage/frontend removal must be demonstrated using counters
  and guest-code/state identities. Captured coverage is never proof that every
  instruction in an IPA was discovered. No JIT-free claim with fallback present.
- R6: Target under1s for every menu/pause/palette/spawn/place interaction,
  TrainingLab1 loading and automatic next-level transition on the parent machine,
  plus sustained >=30 FPS in TinkerBox with
  functional graphics/audio/input. Both Training 01 and Lesson 2 must reach
  SUCCESS using real pinch/placement. Keep device/browser limits explicit.
- R7: Use >=3 comparable clean trials before claiming stable whole-game gain.
  Report startup/download/validation/preparation, selected-scene latency,
  first-minute frame/FPS distribution, compilation, artifact bytes and memory.
  Counter/profiler runs are diagnostic and excluded from acceptance timings.
- R8: Check native reference and relevant CPU/graphics/audio regressions for
  affected changes. Record exact commands, failures and decisions in browser.md;
  keep PROGRESS and HANDOFF current. No commits or pushes in this session.
- R9: Persistent translation archives must survive a fresh process/module,
  enforce the supported CPU/adapter configuration, and validate live guest
  bytes before restoration. Bound retained and staging memory, reject malformed
  imports atomically, and report quota omissions and fallback decoding. Synthetic
  archive cardinality does not establish TinkerBox coverage or loading speed.

## Scope boundaries

No speculative engine rewrite, unrelated compatibility expansion or automatic
public game deployment. Asset preloading is conditional on measured IO/decode
cost and memory impact; the existing loader already caches decompressed entries.
Wasm still needs browser-native compilation. Offline translation cannot precompute
arbitrary game initialization. The goal remains open until its acceptance gates
are proven; an individual diagnostic or optimization milestone is not completion.
