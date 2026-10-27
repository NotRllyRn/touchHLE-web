# Optimizing offline compiler handoff

Updated 2026-10-27. Goal active and unmet. User authorized implementation,
commits/pushes and GPT-6.1 Sol medium delegation; keep at most four concurrent
agents including parent. Serialize performance measurements.

## State and constraints

- Repository main; origin ssh://git@github.com/NotRllyRn/touchHLE-web.
- Previous pushed checkpoint e42992da; this increment records archive validation.
  Production runtime/TCI compiler unchanged. Existing converter/player still
  requires runtime ARM decoding and fallback for uncovered code.
- Target: TinkerBox game-only static package, faster scene loading and sustained
  near-real-time gameplay. Both lessons and clean repeated timings are required;
  <10-second loading and device acceptance remain unmet.
- User M3 Max 16-core/64 GB report: roughly 30-second loads/full-speed play.
  Browser, OS and measured FPS unverified. Keep separate from development
  Chromium141/SwiftShader measurements.
- No public emulator server. Only localhost 127.0.0.1:8765 serves web/dist,
  PID2277242 at this checkpoint. Diagnostic browsers stopped. Do not kill the
  unrelated T3 service or expose target/.
- IPA: /root/local-ipas/TinkerBox HD 1.4.1.ipa. Never commit it, extracted assets,
  saves, raw game traces or generated packages. Preserve Rust/native/licenses.

## Authoritative archive implementation

Parent owns ignored `target/tb-archive-scale/`. Its README.md contains exact
commands, failures, evidence and remaining limits. `source/` is the tested final
source, `baseline/` is the untouched bounded codec. Patch sequence:

1. target/opaque-ptr-validation/0001-opaque-pointer-materialization.patch
2. target/tb-restore-prototype/0002-exact-runtime-tb-capture-restore.patch
3. target/tb-restore-validation/0003-runtime-guard-fixes.patch
4. target/tb-restore-thumb/0004-thumb-runtime-hooks.patch
5. target/tb-archive-codec/0005-archive-codec.patch
6. target/tb-archive-scale/0006-scalable-archive-and-domains.patch

Patch6 already includes task19 operand-domain fixes; do not apply them twice.
Six-file zero-fuzz replay matches final source. Input/source/execution manifests
and all failed logs are retained. Do not rerun scale-edit.py: it is a one-shot
script against the earlier baseline. No active production Unicorn edits/builds.

Variable canonical LE records replace fixed 16 arrays; bounded full-key hash and
index, explicit dedup/replacement/quota counters, atomic staged import. Defaults
16 records/1 MiB; configured maxima 524288 records/256 MiB requested resident,
256 MiB wire and 512 MiB live+staged requested allocation. No silent eviction.
Peak includes failed staging; other live state/current allocation roll back.
Caller buffers, allocator overhead, scratch and retained heap are separate.

Final `validate.py` completed all 12 stages: formatting, enabled/omitted syntax,
fresh-process interpreter/JIT persistence, domain checks, storage tests,
Thumb/IT/fault/hook regressions and full CPU/fiber interpreter/JIT. Covered import
and flush fixtures require zero frontend calls; mismatch fallback is explicit.
Each import checks 744 accepted / 1,092 rejected synthetic domain records, plus
captured mutations. Synthetic operands never execute. Thumb JIT 149 modules;
full suite 14,926, both zero failures/retention. Full-suite engines are unbound.

Storage tests pass 16 / 32,768 / 321,287 cloned keys, exact quotas, differently sized
replacement, stale seals, noncanonical goto fields, allocation failures, late
malformed/duplicate rollback, clear/free. At 321,287: 133334220 bytes serialized,
164516517 requested resident, 329033034 peak live+staged; heap grew 520421376.
These are clones of a 415-byte ARM record, never executed as guest code. Not game
coverage, actual capture sizing, import-latency or throughput evidence.

Initial build missed a loop variable; premature link ran before library existed.
Both failures preserved. Independent review21's peak-counter contract finding
was resolved by documenting/testing failed staging in peak. No other new
blocking finding reported. Native copied-TCI smoke previously crashed identically
baseline/candidate; native execution unresolved. Bounded codec's native compile
and define-omitted full suite are separate prior results, not repeated here.

## Active delegated work

Exact IDs and ownership: `target/optimization-active-handoff.json`.

- Task20 `tinker-archive-enforce-20261027-20`: owns ONLY
  target/tb-archive-enforce/. Enforce known adapter CPU/config profile, revoke on
  unsupported mutations, preserve normal context/budget behavior. Max 2 build
  jobs, no throughput/game tests. Read policy in target/tb-archive-config/.
- Task22 `tinker-archive-bridge-20261027-22`: owns ONLY
  target/tb-archive-bridge/. Prepare bounded binary JS worker import/export,
  exact identity checking and focused mocks; document required C bridge ABI.
  No builds, real runtime claims or production edits.
- Tasks16/17/18/19/21 completed. Do not respawn their work or overwrite child
  trees while active. Parent integrates and tests the final combined branch.

Configuration is still a caller promise in the current scaled source. Actual
production adapter is src/web/cpu.c. Its worker has no C archive bridge yet.
Do not ship by trusting a caller string or numeric contract. Both ARM/Thumb must
be checked for supported A32/little-endian profile, not only Thumb. Runtime/IPA
hashes supplement enforced configuration and live guest-byte/mapping checks.

## Performance evidence and rejected work

- Baseline offline/JIT medians 143/148 s are inconclusive at 10 s screenshots; both
  training lessons work. Existing offline packaging is not a whole-app compiler.
- Early startup profile: tb_gen_code_arm 6.405 s inclusive in 15.187 s. Selected-level
  sample: generated self 5.774 s, CPU dispatch self 3.320 s, frontend inclusive 0.633 s,
  compiler inclusive 1.709 s. Guest scaling 1.596 s, inflate 0.989 s, PNG filtering 0.487 s,
  MDCT 0.483 s. Diagnostic attribution, not clean acceptance timing. browser.md
  records exact sample identities and all caveats.
- Two-block native fusion: roughly 4–5% warmed synthetic gain, game eligibility
  unproven. Forward joins and aligned-boundary tweaks showed no stable benefit.
- Lossless PNG A/B/A level observations 127/123/126 s, menu 119/111/117 s. Reject:
  unproven small gain, IPA+16.87%, expanded PNG+221.4 MiB. All raw artifacts remain
  target/asset-load-* and target/lossless-png-probe/. No new two-lesson acceptance.
- Advertising NPOT alone does not change this game's capability initializer;
  need actual resizing caller/dimension attribution before an image change.

## Next actions

1. Review/integrate enforced runtime profile and binary bridge; revalidate the
   combined source before enabling capture in the actual game runtime.
2. Capture both native TB records and portable Wasm templates with exact final
   artifact/IPA identities. Keep canonical pointer recipes distinct from live
   immediates; restored live TCI can feed existing portable matching.
3. Measure actual archive coverage, omissions, fallback frontend calls, bytes,
   import/preparation and peak browser memory. Real record sizes can hit byte
   quota before 321,287 records. Keep Wasm compilation costs explicit.
4. Run clean repeated TinkerBox comparison and both lessons, then target remaining
   initialization/dispatch/HLE work. Update docs and commit/push verified work.
5. Keep goal active until user acceptance, not just a prototype milestone.
