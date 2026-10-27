# Offline TinkerBox checkpoint — 2026-10-27

The local converter produces a working game-only static package with precompiled
Wasm. It **does not yet eliminate runtime ARM decoding or JIT fallback**. Three
trials show no clear scene-loading or gameplay improvement over ordinary JIT.
The sub-10-second scene target and physical-device acceptance remain unmet.

## Comparable scene measurements

Intel Core i9-13900H, x86_64, 8 online logical CPUs; Chromium 141.0.7390.37,
CPU SwiftShader with explicit compositor flags. No competing benchmark/build
during loading or the first minute of gameplay. Fresh game worker per trial.

| Mode/trial | Training selection → automated Play | First-minute FPS sample median |
| --- | ---: | ---: |
| Precompiled, initial | 143 s | 4.24 |
| Precompiled, repeat 2 | 149 s | 4.495 |
| Precompiled, repeat 3 | 138 s | 4.27 |
| JIT, initial | 148 s | 3.825 |
| JIT, repeat 2 | 142 s | 4.64 |
| JIT, repeat 3 | 149 s | 4.81 |

Median loading interval: **143 s precompiled versus 148 s JIT**. Ranges overlap:
138–149 versus 142–149 s. Screenshots every 10 s, two visual confirmations and
driver reaction add uncertainty/delay. These are end-to-end interaction intervals,
not precise asset-loading times; the small difference is not a demonstrated gain.
FPS is the game's logged samples, not measured display frame pacing.

Initial accepted logs: `target/aot-tinker-globals-clean-{game,driver}.log` and
`target/aot-jit-reference-{game,driver}.log`. Repeats: `target/aot-repeat-results.jsonl`
and `target/{aot,jit}-repeat-{2,3}-{game,driver}.log`. All sampled compiler failure
counters are zero. Actual pinch/placement and both lesson SUCCESS screens were
checked separately; repeats deliberately stop after their first-minute window.

The user's roughly 30-second loads and apparently full-speed laptop gameplay are
separate qualitative evidence. These software-GPU results cannot predict hardware
GPU, phone, tablet, Firefox or WebKit performance.

## What offline compilation costs and saves

- Latest local package: `target/aot-tinker-verified`.
- Existing capture → package: **35.267 s**, excluding the earlier interactive
  capture (about 618 s). Fresh CLI builds execute a bounded local capture session;
  coverage depends on the actions exercised. This is not static whole-app discovery.
- 15,646 templates, 38,491,889 Wasm bytes and 66,016,467 JSON archive bytes,
  alongside the 83,644,753-byte IPA and roughly 30 MiB of core runtime files.
- Earlier clean module preparation: **1.943 s**. Browsers still compile these
  Wasm modules into native machine code.
- Latest three localhost page-ready checks: **3.420/3.315/3.283 s**, including
  **2.208/2.178/2.169 s** verifying file fingerprints. This only enables Play;
  guest/menu/scene startup follows. Production network transfer was not measured.
- Final repeated compilation counters: about **11.0–11.6 s precompiled** versus
  **22.0–23.0 s JIT**. Sample endpoints differ; upfront preparation/transfer are
  separate. Offline instances 20,943/21,216 still had 2,939/2,678 misses.

The loader's Base64 decoding optimization is a demonstrated local improvement:
isolated full-payload decode/checksum median fell from 10,248 ms to 1,046 ms
(native) or 1,445 ms (fallback loop). It does not imply an equivalent level gain.
Selective small-literal specialization was rejected after a no-gain loop probe.

## Why loading remains slow

The entire IPA is in MEMFS before guest execution; scene changes are not fetching
game assets over the network. `IpaFileRef::open` caches decompressed entries.
A level-loading worker CPU sample contained 13,457 samples: generated guest Wasm
6,339 (~47%), CPU execution 1,742, TCI dispatch 915 and HLE `run_call` 818.
Asset decompression was not a leading entry in that sample. This points toward
guest initialization and execution/host-call costs; speculative asset preloading
does not address the observed dominant work.

Full static frontend removal needs guest-code/state identities and relocatable
translation/exception metadata, described in SAD.md. Measure its share before
implementing that larger architecture. Precompilation alone does not precompute
game initialization.

## Regression status

37 JS tests pass. The unchanged CPU/compiler passes the actual ARM/Thumb/VFP,
context, fault, budget, invalidation, eviction and fiber suite in capture/offline
modes (14,926 offline instances, zero misses/failures). Generated mipmap and
presentation/buffer packages pass twice each (130/103 offline instances).
Producer trace mismatch/output checks and browser corrupt-package rejection pass.
The latest TinkerBox package starts 444 offline block instances with zero failures;
its runtime and compiled Wasm payloads match the full-lesson comparison package.

Exact commands, initial failed attempts and logs are in ../browser.md. Private
IPAs, traces, screenshots and generated packages remain ignored local artifacts.
The public preview is stopped. Plans/progress are committed; the full static
compiler and performance goal are not complete.
