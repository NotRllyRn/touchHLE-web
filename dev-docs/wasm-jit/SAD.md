# Offline precompilation architecture

Updated2026-10-27. See SAD-jit-history.md for retained runtime architecture.

## Decision

Reuse Unicorn ARM/Thumb -> TCI -> Wasm and Rust HLE. First make generated
blocks relocatable across engine instances, then build a profile-assisted local
converter and a static per-game player. Measure before expanding static coverage.
This staged design avoids implementing a second ARM decoder before proving the
runtime benefit. It is not yet a whole-app static compiler.

## Components and contracts

1. Existing runtime remains the semantic reference and fallback.
2. Portable TCI compiler normalizes only known session-relative fields: forward
   branch addresses, mutable goto links and exit-TB identities. Move immediates are also normalized and read from live TCI because
   they contain engine-private pointers. Other immediates remain exact. An immutable imported base relocates helper PCs and link reads;
   exit identities are read from the current live TCI. No stale host pointer is
   trusted. Exact normalized bytes and ABI layout select a module, never hash-only.
3. Offline capture records portable TCI and layout metadata for observed blocks;
   a local Node compiler emits Wasm artifacts. Runtime/compiler fingerprints bind
   the package. Static discovery of unobserved code is a subsequent stage.
4. Browser validates the package fingerprint, asynchronously compiles prebuilt
   modules, and instantiates matched blocks with current memory/base/helper imports.
   Existing invalidation, budgets and bounded live-function eviction still apply.
   Cache misses retain JIT; counters expose actual coverage.
5. Local packager emits a game-only page and static assets. Shared worker/input/
   audio paths remain. No CDN, server execution or proprietary Git artifacts.

## Performance risks

Browser Wasm compilation cannot be done portably on the producer's machine.
Thousands of modules, larger downloads, matching cost or eager compilation may
outweigh saved code generation. Compare on-demand versus async prewarming and
bound both retained bytes and preparation work. Do not assume JIT dominates:
previous menu compilation totaled around13 s versus142 s menu wall time.
Profile-assisted coverage is input dependent. Full static discovery must handle
Mach-O executable sections, ARM/Thumb entry metadata and dynamic targets without
executing arbitrary data or silently changing semantics.
