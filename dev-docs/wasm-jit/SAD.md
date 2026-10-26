# Browser CPU acceleration: software architecture

Status: implemented experimentally; game performance acceptance open. Updated: 2026-10-26.

## Existing boundaries

Static files -> page -> disposable worker -> Rust HLE + Emscripten fibers ->
CPU adapter -> Unicorn ARM/Thumb/VFP translator -> TCI interpreter. Guest memory
is shared with Rust through mapped regions. GLES1 is implemented through WebGL2;
audio PCM is delivered to the page. Native builds use Dynarmic unchanged.

## Decision A1: reuse proven ARM translation

First evaluate compiling existing TCI blocks to WebAssembly instead of writing
another ARM decoder. This reuses instruction semantics, flags, VFP helpers,
exceptions, guest memory checks and Unicorn's translation cache. Dynarmic's
native emitters cannot run directly in a browser. A new ARM decoder is a fallback
only if measured TCI integration cost or performance makes reuse unsuitable.

## Decision A2: tiered execution within existing worker

Execute cold blocks with TCI. Compile hot blocks into small Wasm modules sharing
the runtime memory and narrowly typed helper imports. Cache compiled functions
by translation identity, invalidate with Unicorn's block lifetime. Start with
synchronous small-module compilation in the worker; bound module size and total
cache. Retain interpreter execution for unsupported operations or compile failure.
Do not use eval or generate native executable memory.

## Decision A3: preserve semantics at boundaries

Use existing soft-MMU/helper paths initially. Direct memory accesses are allowed
only after differential tests establish bounds, faults and invalidation safety.
Keep SVC/HLE calls outside the CPU execution interval, preserving nested guest
calls and fibers. Preserve tick budgets and exact debugger stepping. Generated
code must not retain JS heap views across memory growth. No guest-state snapshots
or proprietary compiled code are persisted or committed.

## Risks and experiments

- JS/Wasm transitions can erase gains: measure block dispatch and helper cost.
- Large modules increase startup/compile cost: measure thresholds, cache and
  code size before introducing batching or background compilation.
- Wasm exception/longjmp interaction: run memory fault and nested fiber tests.
- Existing slow paths may dominate: profile actual startup and active gameplay.
- Cache reuse/self-modification: test invalidation, retranslation and mode switch.
- Browser limits differ: test fallback and record actual platform support.

## Licensing and deployment

Keep MPL notices and upstream GPL attribution on derived Unicorn patches.
No new dependency is assumed. Source patches and reproducible build instructions
must accompany any future binary distribution under dependency license terms.
This work pushes source only, not generated distribution bundles or game data.

## Implemented refinement: fixed RAM and worker scheduling

Only the immutable, identity-mapped adapter opts into bounded direct Wasm memory
accesses. A permanent per-engine translated-page bitmap excludes all code pages
from direct stores, preserving Unicorn's invalidation path. Bounds, alignment,
format and mapping tests gate each access; generic engines use helpers.
Ordinary scheduler.postTask yields (MessageChannel fallback) keep CPU slices
cooperative without nested timer clamping;
actual duration sleeps retain timer semantics. Compiler JS loads independently
of the full runtime. Cache remains bounded (8192 modules, 16 MiB emitted bytes,
65,536 translation identities); capacity flushes are counted explicitly.

Normal adapter budget exhaustion returns through the translated block boundary
with PC synchronized and pending Thumb IT state preserved. Actual exceptional
exits still use Unicorn restoration/unwinding. The Wasm compiler specializes the
known post-memory exit-check helper using its C-provided identity and layout:
ordinary no-op checks stay in Wasm, pending exits retain the original helper.

Same-block linked loops remain inside their generated Wasm function, preserving
TCI temporaries in locals. Read the mutable target on every backedge; other targets
return through the existing dispatcher. Every iteration retains budget/exit
checks and self-modifying-code invalidation. No cross-block trace construction.

## Integer state across HLE calls

The browser-only Unicorn adapter exposes its initialized engine's live integer
register array for the existing Rust CPU ABI. Context swaps still copy complete
integer state; CPSR uses Unicorn's API. Preserve integer state around CPSR writes
because ARM mode switches bank r8-r14. VFP retains its lazy context transfer.
This removes per-register API dispatch without changing native Dynarmic or the
Rust call boundary. Mode-bank, context, stepping and exception regressions gate
the change; HLE-transition benchmarks measure its intended benefit.

## Helper dispatch boundary

A single C call bridge preserves the normalized QEMU helper ABI and GETPC while
accepting arguments directly from generated Wasm locals. It imports no individual
QEMU helper into a generated module. This avoids the previously rejected direct-
helper-import architecture and retains its arithmetic/exception implementations.
The original single-operation interpreter remains the memory/unsupported path
and the compatibility path for a runtime without this bridge. Repeated-instance,
CPU exception, floating-point fingerprint and fiber tests gate integration.

## Guarded VFP arithmetic

Use nearest-even, normal/zero operands, and a normal finite result strictly
larger than FLT_MIN, or a separately checked exact signed zero. Binary64 gives
an exact reference for binary32 multiplication and add/sub with exponent gap
<=29 or a zero operand, allowing precise inexact-flag updates. Other add/sub
cases and division require inexact already sticky. An exact pair of canonical quiet NaNs (both0x7fc00000) returns that same
bit pattern without changing flags in every FPSCR mode, following the pinned
ARM helper rules. Other exceptional cases retain the original helper. C exports identities, status offsets and enum values;
core Wasm arithmetic needs no new ARM decoder or browser extension.
The pinned interpreter supplies result/FPSCR fingerprints across rounding,
FZ/DN, sticky flags, edge values and seeded inputs, including division.

Doubleword stores share the direct-memory mapping and code-page gate.
C-exported alignment metadata also permits word-aligned doubles; a separate
page-boundary check keeps those stores inside one checked code page. Other
accesses retain the helper, including original exception semantics.

## Immutable mapping lookup

Browser engines carry a bounded4 MiB page-pointer table, populated only through
the adapter's immutable-mapping opt-in. Generated memory accesses use the current
engine's table, preserving engine isolation and Wasm memory growth. They require
a nonzero mapped-page pointer, allowed alignment and a complete access within
that page. Stores retain the translated-page bitmap gate. All other accesses
use the original helpers. Older runtime metadata retains the two-region path;
no guest mappings are enlarged or coalesced. The extra table cost applies to
each browser engine and is absent from native builds.

## Bounded compiler retention

Capacity eviction clears native dispatch first, then removes older compiled
functions until the new module fits within75% of the unchanged8192-module/
16 MiB limits. Translation identities remain for recompilation. A bounded map
tracks compiled modules; JS lookups refresh recency, while native dispatch hits
bypass that bookkeeping. This is approximate recency, not a strict LRU policy.
Reset and re-registration remove retained entries and account for emitted bytes.

## Synchronous helper instrumentation

The browser CPU adapter's callbacks only stop or report errors; HLE dispatch and
fiber suspension occur after CPU return. Exclude the TCI call/step/interpreter
bridges from Asyncify along with the existing dispatcher. Four pure float32
arithmetic entry points also use internal synchronous function pointers and need
no suspension state. Use exact names, retain production assertions/stack checks,
and keep Rust/HLE/fibers instrumented. CPU/fiber, fault, floating-point and game
regressions gate this boundary; synthetic improvements alone do not establish
real-time game acceptance. Native execution is unchanged.
