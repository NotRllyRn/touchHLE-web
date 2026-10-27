# Optimizing offline compiler handoff

Updated 2026-10-27. The renewed thread goal is active. User authorized continued
implementation, commits/pushes and GPT-6.1 Sol medium subagents (at most4–5);
serialize benchmarks. Previous paused-goal limitation has been resolved.

## State

- main, origin ssh://git@github.com/NotRllyRn/touchHLE-web.
- Latest diagnostic checkpoint b2d36270 pushed; previous baseline a3220587. Offline converter/player and immutable portable ABI3
  work, but browser still decodes ARM and falls back to JIT for uncaptured blocks.
- User's M3 Max16-core/64 GB MacBook reportedly loads levels in~30s and plays
  near full speed; browser/OS and precise FPS not verified. Development host is
  i9-13900H/8 logical CPUs/Chromium141/CPU SwiftShader. Keep results separate.
- Three clean offline/JIT medians143/148s are inconclusive at10s screenshot cadence.
  Both lessons work. <10s and near-real-time/device acceptance remain unmet.
- Public server stopped. Local diagnostic server127.0.0.1:8765 serves web/dist.
  Do not expose target/: it contains private game data/traces/packages.
- Owned IPA /root/local-ipas/TinkerBox HD 1.4.1.ipa; baseline package
  target/aot-tinker-verified; raw capture target/tinker-aot-capture.json.
  That package uses the previous core fingerprint; after metadata runtime rebuild,
  old captures intentionally fail the converter's fingerprint check.

## Current work

PRD/SAD/SFDS have B0–B4 optimizing-precompiler milestones. New diagnostic profiler
adds unique generated function names, optional TCI opcode/helper-site counters,
weighted CPU self/inclusive samples and copied guest-PC/IT/search metadata.
It is opt-in via local routes, absent from ordinary runtime output. Counts are
not ARM retirement/timings; call sites include inlined helpers, block visits
include self loops. Retention truncation and differing counter/sample windows
are explicit. Cached profiling rejects rather than silently losing counts.

Read web/README.md for PROFILE_MODE and inspector attach commands. Source hashes
identify routed diagnostics; local runtime/IPA hashes are only references for
remote/already-loaded workers. T3 preview failed explicitly due Chrome's root
sandbox; repository Playwright scripts use /tmp/touchhle-browser-tools/node_modules/
playwright/index.mjs. No user browser/physical-device results were invented.

Tests:56 JS tests pass; new source-built instrumented real CPU suite passes14926
blocks, zero compile/mapping failures/drops, ARM+Thumb maps present. Formatting
passes. Logs target/opt-profile-{js-final2,metadata-build,metadata-cpu}.log.
Chromium CPU integration and full runtime rebuild pass. Fresh game timing profile
retains2642 valid maps with zero errors/drops (opt-profile-guest-startup/).
HLE mipmap fixture passes twice (opt-profile-metadata-hle.log). Sample15.187s repeats early translation
hotspot: tb_gen_code_arm6.405s inclusive. No optimization speedup claimed.

Profiles: early15.147s sample spends6.874s inclusive in tb_gen_code_arm; late
15.573s sample spends7.353s self in generated blocks (~47%). See browser.md for
exact calls/counts and caveats. target/opt-profile-{startup,startup-counts,late-startup}.
Frontend and generated execution need separate optimizations; asset preloading
is not supported by these samples.

Forward-join candidate is NOT adopted: target/tci-jit-forward-joins.js,
forward-joins-check.mjs and bench-forward-joins.mjs. Correctness passed but
original/candidate/original benchmarks showed no consistent target benefit.
Raw target/forward-joins-bench.jsonl. Do not repeat without a new hypothesis.
A two-TB fusion prototype is delegated under ignored target/ only; production
compiler remains baseline apart from diagnostic hooks.

## Next

1. Diagnostic increment validated; commit/push checkpoint before further optimization.
   Profile selected level with inspector if current startup evidence is insufficient.
2. Review/benchmark two-TB fusion with mutable link and generation guards,
   budget/PC/helper fault state intact. Reject if no meaningful measured benefit.
3. Implement safe decoding-free restore separately: current portable keys require
   live TCI. Exact-runtime/address archive needs translation identity/code bytes,
   typed engine-pointer provenance, helper/link/exit relocations, full search data,
   fresh TB allocation/page/hash registration and code-page invalidation state.
   Never infer engine pointers from numeric ranges or restore stale TB pointers.
4. Profile selected level transitions and actual helper callers; optimize measured
   work. Run clean repeated game trials and both lessons before game-speed claims.
5. Keep goal active until actual acceptance; hardware GPU/mobile remains untested.


## Follow-up experiments in progress

Counts-only translation observer added;57 JS tests pass. JSON-string snapshot
transport fixes large Playwright recursive serialization cost. Fresh diagnostic
records321287 registrations/320670 contexts, no omissions;310159 contexts map to
static initialization by text symbols. Exact evidence in browser.md; artifacts
opt-profile-translation-counts-json/. Earlier large-object run completed slowly,
not an acceptance measurement.

Two-TB sparse-transfer prototype now passes24 tests. Offline modeled-helper
A/B/A medians129.579/77.224/144.404ms, no native/game claim. Native dispatch
lifecycle probe delegated (tinker-region-native-adapter-20261027-4).
Opaque pointer materialization patch under target/opaque-ptr-prototype-20261027
has14 static checks; separate-source build validation delegated
(tinker-pointer-op-build-20261027-5). Neither experiment touches production.
Do not claim static frontend removal or broaden supported helpers before proof.

## Latest checkpoint (supersedes pending experiments above)

Production runtime/TCI compiler remains61301008. Current tracked increment fixes
CDP reconnect profiling (same worker session for snapshots/samples, unique page/
worker/context/origin selection);59 JS tests and actual reconnect sampling pass.
Docs now include measured Training01 loading attribution and prototype results.
No delegated tasks remain active at this checkpoint. All diagnostic games and
fixture8766 server stopped; localhost8765 still serves web/dist. No public server.

Most important new evidence: selected-level15.244s sample in
`target/opt-profile-training01-retry/`. Generated self5.774s, two CPU dispatch
self3.320s, frontend inclusive0.633s, compiler inclusive1.709s. Top guest symbol
attributions: image scaling1.596s, inflate_fast0.989s, PNG filtering0.487s, MDCT
butterflies0.483s. Asset processing inside guest code IS material, despite low
host miniz time. Phase is actual loading, verified frozen stage-select screenshot;
not a clean acceptance trial (diagnostics/concurrent builds). Initial CDP attempt
failed due absent Playwright worker wrappers; fixed using same-session CDP eval.

`target/opaque-ptr-validation/`: original pointer patch passes full Wasm suite
on/off/define-omitted,35251 checked immediates; synthetic rebasing/spills/helper
pairs/unknown rejection pass. Native copied Unicorn smoke crashes identically
with/without patch; separate native Dynarmic backend wasn't changed/tested here.

`target/tb-restore-prototype/`: complete in-memory archive patch from agent,
synthetic ASan/UBSan and on/off syntax checks, no actual runtime checks there.
Parent built/tested it in `target/tb-restore-validation/`, where authoritative
latest source lives. Apply original opaque patch, restore patch, then parent
`0003-runtime-guard-fixes.patch`. See README.md/final-hashes.json there.
Actual interpreter/JIT passes cross-engine2 covered TB restores (zero-span exit
still decodes), flush, host/guest writes, corruption, contract mismatch, fault PC.
JIT50 modules, zero failures, clean reset. Parent fixes QEMU RAM offset vs guest
address guard, cluster sentinel, setcond layout, effective max_insns identity.
Both independent review findings match actual first-run failures. Unknown ops
still reject. NOT serialized; only16 records, ARM-only/no hooks, no game support.
97% of startup contexts are Thumb, so broaden only with real IT/fault regressions.
Adapt synthetic fixtures for changed host-backing/key signature before relying
on them for parent-source testing. Execution overflow/retry remains untested.

`target/two-tb-fusion/`: native linked fixture passes3 installed/retired regions,
10179entries/9154edges, stops in both A/B and cleanup;32 focused tests pass.
General suite threshold32 still fails coverage (unsupported candidate), recorded.
`target/two-tb-benchmark/`: actual same-artifact A/B/A done with all other heavy
work stopped. Warm357.701/340.421/354.693ms (~4–5% gain); cold407.556/423.529/
406.101ms. First run fixed unexported HEAPU32 use; source manifest updated, native
artifact unchanged. No production adoption or game claim.

Next work:
1. Extend isolated restore to Thumb and proven runtime-only adapter hooks with
   targeted IT/fault/budget tests, then scale archive representation and add
   exact-runtime import/export. Avoid adopting16-slot fixed arrays for the game.
2. Use level profile to test representative image/decompression CPU blocks;
   two-block integer fusion alone has only modest native benefit. Preserve all
   invalidation and helper identity guards if extending eligibility.
3. Reprofile/measure chosen optimization in comparable game phases, recapture
   updated runtime, then >=3 clean trials/both lessons. No <10s/real-time claim.
4. Keep goal active and full PRD acceptance intact; committed diagnostic/prototype
   milestones are progress, not completion of offline whole-app compilation.

After checkpoint b2d36270 (pushed), Thumb/hook restoration and aligned-boundary
probes completed. target/tb-restore-thumb/README.md records149 JIT modules with
zero failures, interpreter parity and successful defines-omitted execution.
Host writes require explicit adapter invalidation. No full CPU/game/native or
remapping/protection acceptance yet. target/aligned-boundary-probe native A/B/A
shows no consistent speed gain; do not adopt the compiler change.
`...tinker-archive-codec-20261027-14` owns target/tb-archive-codec, preparing
explicit LE export/import and fresh-module tests from the final Thumb snapshot.
It is instructed not to build/test while parent runs serialized game timings.
target/lossless-png-probe contains verified filter0/stored PNG candidate IPA;
514 images and336 other files preserved, IPA+16.87%, expanded PNGs+221.4MiB.
Parent target/run-asset-load.mjs and target/asset-load-driver.py compare visual
checkpoints at1s cadence with identical production runtime/JIT. All artifacts
and raw traces remain ignored. No speed/memory acceptance established yet.
Full task IDs are in ignored target/optimization-active-handoff.json.
Archive-design review `...tinker-restore-archive-design-20261027-11` completed:
explicit LE variable records/index, enforce full runtime/config identity,
validate atomically before publication, fresh-module roundtrip before scaling.
Do not serialize native structs/ownership or raise fixed-array/cache limits alone.
Goal remains active; these tasks are not complete game acceptance.
