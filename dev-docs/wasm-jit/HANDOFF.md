# Paused development handoff

2026-10-27. User explicitly requested a pause and a reachable browser preview.
Thread goal is **paused**, not complete. Resume development only when requested.

## Source and preview

- Repository `/root/code/touchHLE-web`, branch `main`, pushed HEAD `c10a6af1`.
- Preview: `python3 -m http.server 8765 --bind 0.0.0.0 --directory web/dist`.
  Log `target/browser-preview-server.log`; only static built files are served.
- Open `http://100.104.105.115:8765/?cpu=jit` over the host's Tailscale network,
  or reachable host IP on port8765. Choose the locally owned IPA and Run.
- `?cpu=jit` is essential: default CPU mode is still the interpreter.
- Preview is the freshly built anisotropy-cache candidate, not just pushed HEAD.
  No proprietary IPA or extracted assets were added to the served directory.

## Current uncommitted candidate

`web/emscripten-gl-init.js`: successful anisotropy query caching per context and
texture. Setters invalidate; context restore clears caches; invalid/lost queries
retain native behavior. New `web/test-graphics-queries.mjs` exercises actual
WebGL1/2. README, browser.md, SAD, SFDS and PROGRESS document it.

Build completed successfully (former session41816), log
`target/gl-query-cache-runtime-build.log`. Formatting/diff checks pass.
Actual WebGL1/2 query tests pass, including setter/error/deletion/context-loss
cases: `target/gl-query-cache-browser-final.log`.
All nine graphics fixtures pass twice each under default and explicit compositor
settings (36 fixture runs): `target/gl-query-cache-{default,compositor}-*.log`.
Isolated new/old/new query benchmark medians2.400/153.800/1.200 ms; this is a
synchronization stress test, not a whole-game speedup.

## Interrupted game measurement

Clean candidate run used Chromium141 with CPU SwiftShader and explicit GPU
compositor flags. Menu checkpoint142 s, Training checkpoint222 s. User paused
during level loading, before Play: no level-load time/FPS/lesson acceptance
result for this candidate. Inspector stopped via UI; expected exit1. Driver
processes stopped. No benchmark/browser process should remain active.
Logs `target/gl-query-cache-{game,driver}.log`; screenshots/control files
`target/browser-gl-query-cache/`. Do not count interrupted run as acceptance.

Previous pushed baseline b44f389c: default compositor menu132 s, level137 s,
first-minute FPS median3.28; explicit compositor menu142 s, level153 s, median
5.10 FPS. Both lessons, pinch and touch placement passed. These single runs
remain far from under10 s loading and sustained30 FPS. No hardware GPU,
Firefox/WebKit or physical mobile validation yet.

## Resume sequence

1. Check working tree and preview use before rebuilding; do not disrupt the
   user's live test. Preserve candidate changes and local proprietary artifacts.
2. Finish a clean explicit-compositor game run, with no competing benchmark:
   `web/inspect-ipa.mjs`, owned IPA `/root/local-ipas/TinkerBox HD 1.4.1.ipa`,
   `TEST_URL=http://127.0.0.1:8765/?cpu=jit`, `INSPECTION_PORT=9241`,
   `INSPECTION_OPTIONS=com.autodesk.tinkerbox: --print-fps`, `RUN_SECONDS=1500`,
   `PLAYWRIGHT_MODULE=/tmp/touchhle-browser-tools/node_modules/playwright/index.mjs`.
   BROWSER_ARGS JSON array: `['--enable-gpu','--ignore-gpu-blocklist',
   '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']`
   (use JSON double quotes in the actual environment variable).
3. Drive with `/tmp/touchhle-finish-lessons.py OUTPUT_DIR CONTROL_JSON` using
   the inspector's printed control path. Manually inspect placement/SUCCESS.
   Measure Training-to-Play and first60 s logged FPS; screenshots are10 s apart.
4. After acceptance, capture15 s trace using `target/trace-gpu-compositor.mjs`
   with a new output filename; analyze with `target/analyze-graphics-trace.py`.
   Query probe: `target/profile-gl-queries.mjs`. Keep profiles separate from timing.
5. Compare default compositor too; retain cache only with measured evidence,
   record limitations, formatting/relevant tests, then concise commit/push.
6. Continue profile-guided acceleration; do not mark goal complete until PRD
   acceptance is met. Do not repeat rejected dispatch/table/scratch/float-exit
   experiments without new evidence (see browser.md).

Plans and acceptance: PRD.md, SAD.md, SFDS.md, PROGRESS.md. Exact historical
commands, failed experiments and evidence: ../browser.md. Keep proprietary
IPAs/assets/screenshots/traces under ignored local paths. No subagents authorized.
