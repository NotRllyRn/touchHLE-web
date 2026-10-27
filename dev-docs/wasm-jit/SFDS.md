# Offline precompilation functional design

Updated2026-10-27. Previous CPU/graphics contracts: SFDS-jit-history.md.

## Milestones and checks

- A0: Preserve tested browser baseline; stop public preview; record new objective.
- A1: Relocatable compiler. Validate across different TCI addresses and memories,
  relocated branches, mutable links, helper GETPC/fault propagation, exit identities,
  code mutation, cache reset, ABI mismatch and bounded retention. Existing JIT
  output and behavior remain the default unless portable mode is selected.
- A2: Offline CLI capture/compile/package. Emit actual Wasm, versioned metadata,
  content fingerprint and a static per-game player. No IPA chooser in output.
  Reject corrupt/incompatible packages; report profile-assisted coverage honestly.
- A3: Clean JIT/precompiled TinkerBox comparisons and both-lesson regressions.
  Preserve raw local artifacts, commands, trial counts and any failed checks.
- A4: Profile loading; expand static discovery and optimize measured initialization
  or asset work. Retain only demonstrated improvements. Repeat relevant regressions.

## Packaging and lifecycle

Output defaults below ignored target/. Never overwrite an existing package or
source tree silently. Validate IPA locally; preserve bundled dependency notices.
The guest still uses the same loader/HLE environment. Fresh worker per run;
Stop releases game/module memory. Assets stay local to the generated site.
Developer capture and guest execution are explicit, bounded build stages.
Performance instrumentation is opt-in and excluded from clean acceptance runs.
