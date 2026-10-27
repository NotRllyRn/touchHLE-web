# Optimizing offline precompilation architecture

Updated: 2026-10-27. Historical JIT design: SAD-jit-history.md.

## Retained execution and packaging

Reuse Unicorn ARM/Thumb -> TCI -> Wasm and Rust touchHLE. Current portable ABI 3
binds session move immediates as immutable imports, relocates helper PCs/links
through a base, and reads live exit identities. Exact normalized bytes and ABI
metadata select modules. Native builds remain the semantic reference. Static
player verifies IPA/runtime/archive identities; sites are immutable directories.

## Measurement architecture

Two independent diagnostic modes avoid conflating observer cost with speed:

1. Timing mode names generated functions uniquely and samples worker CPU stacks.
   Aggregate by function identity (including module/script), preserve self versus
   inclusive time, use actual sample time deltas, and retain caller attribution.
   Anonymous generated functions must not be merged into one unhelpful bucket.
2. Count mode instruments generated TCI operations and block entries, including
   self-loop iterations and taken forward branches. Count operations reached,
   not static block size multiplied by dispatch count. Include interpreter/JIT
   coverage gaps and bounded metadata retention. Do not report these as ARM counts.

Join sampled blocks with instruction/helper composition and compile statistics.
A later explicit translator metadata hook must provide guest PC/mode/bytes and
ARM instruction boundaries before instruction-level ARM attribution is claimed.
Separate controlled CPU fixtures measure throughput by operation class with
known counts, dependencies, memory alignment and FPSCR state. Browser sampling
cannot provide exact nanoseconds for each guest instruction in optimized code.

## Optimizing code generation

Use profiles to choose a bounded candidate, measure it in a targeted fixture,
then verify actual game gains. Region compilation may combine proven connected
blocks and keep temporary state in locals; preserve budget checks, fault PCs,
mutable edges, code invalidation, and exits to existing dispatch/HLE. Bound region
size and preserve fallback for indirect/unknown/changed targets. Previous slower
tail-call dispatch and scratch-local experiments are negative evidence, not a
reason to repeat them unchanged. Shipping requires measured benefit and tests.

## Eliminating runtime ARM decoding

A translated-code cache must key by guest bytes, PC, ARM/Thumb/IT and translation
flags; serialize explicit relocations, exits, links and exception/search metadata;
validate bytes/state before reuse; and invalidate affected regions on mutation.
Decode unobserved/dynamic code through the existing reference path. Never infer
code coverage from a linear scan of mixed ARM/Thumb/data. Track frontend time and
fallback coverage to determine whether this work pays for its complexity.

## Initialization and HLE

Attribute host calls by both self and inclusive time: guest comparator callbacks
can make a cheap qsort host frame appear expensive. Identify repeated work and
high-frequency guest/host crossings before optimizing. Preserve libc/ObjC behavior
and thread/context semantics. Preload only if measured asset IO/decode latency
is significant; account for memory and gameplay contention. No cloud execution.
