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
The translator metadata hook provides guest PC/mode and instruction search
boundaries, including fault state. It does not capture instruction bytes or
establish retired ARM instruction counts.
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

The first restore experiment uses an exact-runtime, exact-address archive and
fresh native TB allocation. Engine pointers are emitted through an opaque IR
operation with explicit recipes for the engine, exit counter and budget field.
The optimizer must treat these as runtime values; matching numeric addresses
would incorrectly relocate equal-valued guest integers. Unknown pointer sources
reject capture. Helper identities, internal labels, tagged TB exits, jump resets
and the full search table need separate relocation and validation.

Restored code rejoins ordinary page/hash registration, dirty-page handling and
invalidation. No serialized ownership pointers are reused. Byte/state mismatch
falls back to the translator and is counted. A small ARM-only in-memory fixture
can prove this mechanism, but useful game coverage requires Thumb: the startup
registration sample contains 310328 Thumb versus 10342 ARM contexts. Supporting
Thumb must preserve IT/fault state and translator side effects; reject unsupported
states explicitly rather than silently accepting incomplete metadata.

## Initialization and HLE

Attribute host calls by both self and inclusive time: guest comparator callbacks
can make a cheap qsort host frame appear expensive. Identify repeated work and
high-frequency guest/host crossings before optimizing. Preserve libc/ObjC behavior
and thread/context semantics. Preload only if measured asset IO/decode latency
is significant; account for memory and gameplay contention. No cloud execution.

The first-level sample distinguishes host decompression from guest asset work:
named guest blocks attributed to Ogre image scaling, zlib inflate, PNG filtering
and FMOD decoding account for substantial execution. Cached IPA bytes do not
eliminate these routines. Evaluate generated-code improvements against these
workloads; any offline asset transformation would additionally need exact format,
filtering, layout and game behavior equivalence. Do not infer that low host
inflate time means all asset processing is cheap.

The filter0/stored-IDAT pilot is not selected: serial original/candidate/original
scene observations127/123/126s do not justify221.4MiB more expanded PNG data.
Keep original assets in the default package. Likewise, advertising NPOT alone
cannot change this executable's renderer because it checks neither NPOT token.
Measure scaling callers and dimensions before changing its image path; backend
GPU support alone does not establish that the game will use it.
