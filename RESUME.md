# Resume checkpoint — 2026-11-20

User requested preserving all unpublished source before further disk cleanup.
This checkpoint includes the existing Rust/UIKit/browser changes, save handling,
text input, audio/input fixes, TB archive experiment, tests and historical notes.
It is not a new release, game acceptance result or automatic development restart.

Review corrections made here:
- Include text-input.js and its native exports in the archive build.
- Include game-cache.mjs and dashboard.css in ordinary IPA packages.
- Update archive test fixtures for text input; explicitly disable Web Locks
  in the no-lock test instead of inheriting Node's global navigator.locks.
- Remove the extra trailing blank line from dev-docs/browser.md.

Checks: 183 Node tests, 10 retention tests, 15 dedup tests and 7 audio-preparation
Python tests passed. cargo fmt --all -- --check and git diff --check passed.
Build scripts passed node --check. Initial Node run had three stale-fixture
failures; corrected and rerun. No full native/Wasm build or live game acceptance.

Latest historical worker state is ordinal108: selected-code collection was
refused by the then-current storage budget; no runtime candidate was accepted.
That historical storage reading is stale after cleanup. Modified Lab007 restore,
full068 acceptance, native validation and archive integration remain open.
Read dev-docs/wasm-jit/ACTIVE-GOAL.md and HANDOFF.md for exact earlier limitations;
they contain long historical entries, not a fresh authorization to replay work.

Frozen hosted095 on port8766, original IPAs/assets, save masters and existing
ignored build outputs were retained. This commit does not reconstruct raw
captures removed during earlier user-authorized cleanup. Check referenced paths
before resuming; regenerate only what the next bounded task actually needs.
Keep the hosted package stable. Choose one evidenced unresolved issue before
new builds; preserve native reference behavior and avoid speculative rewrites.
