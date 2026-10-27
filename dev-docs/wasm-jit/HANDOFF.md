# Optimizing offline compiler handoff

Updated 2026-10-27. The renewed thread goal is active. User authorized continued
implementation, commits/pushes and GPT-6.1 Sol medium subagents (at most4–5);
serialize benchmarks. Previous paused-goal limitation has been resolved.

## State

- main, origin ssh://git@github.com/NotRllyRn/touchHLE-web.
- Latest diagnostic checkpoint e57d24a5 pushed; previous baseline a3220587. Offline converter/player and immutable portable ABI3
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
