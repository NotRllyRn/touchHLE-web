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
MessageChannel yields keep CPU slices cooperative without nested timer clamping;
actual duration sleeps retain timer semantics. Compiler JS loads independently
of the full runtime. Cache remains bounded (8192 modules, 16 MiB emitted bytes,
65,536 translation identities); capacity flushes are counted explicitly.

Normal adapter budget exhaustion returns through the translated block boundary
with PC synchronized and pending Thumb IT state preserved. Actual exceptional
exits still use Unicorn restoration/unwinding. The Wasm compiler specializes the
known post-memory exit-check helper using its C-provided identity and layout:
ordinary no-op checks stay in Wasm, pending exits retain the original helper.
