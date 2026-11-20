# Opt-in native TB archive core

These are the exact audited 0001–0007 patches, in filename order, on top of
Unicorn.js fdfcc4fd5e7d4ceeebe6b4d65b19eea4aa655e5d / Unicorn
8028ec436f2d9376525352dd38ed9ed6b9f6be10 and the existing production patches.
0007 includes sealing, deferred callback flushing and wire bounds. Do not add a
separate callback patch or validation-only instrumentation. Retain dependency
licenses and MPL-2.0 notices when distributing source and binaries.

From the repository root, with the pinned dependency checkout available:

```sh
TOUCHHLE_WEB_TB_ARCHIVE=1 node web/build-archive.mjs --prepare-only
# After browser validation, activate Emscripten 4.0.23 and install the Rust
# wasm32-unknown-emscripten target before running the actual build:
TOUCHHLE_WEB_TB_ARCHIVE=1 node web/build-archive.mjs
```

The first command only reconstructs and checks source. The second patches the
activated SDK with the existing tracked workflow, builds an isolated core
without TOUCHHLE_TB_RESTORE_TESTS, runs root Cargo with --locked, and links the
runtime. No private snapshot, wrapper symlink, assets or ignored build output is
an input. Git objects from the pinned dependency checkouts are required;
TOUCHHLE_UNICORN_SOURCE can select the Unicorn.js checkout. Working-tree edits
in that dependency are not consumed. Native and ordinary builds stay default-off.

Source, CMake output and Cargo output live under target/tb-archive-build/<hash>;
the key includes the option, build recipe, source/patch revisions and SDK path.
Source is freshly reconstructed on every invocation and audited hashes checked.
The distribution defaults to target/tb-archive-dist; override with
TOUCHHLE_WEB_TB_ARCHIVE_DIST. It copies web/tb-archive/runtime-worker.js,
tb-archive-bridge.mjs and launch.mjs to matching basenames, plus existing
input/style/audio/JIT/identity helpers. If using the ordinary page build, run it
before this entry and copy its desired page assets first: it can overwrite the
archive worker. The verified launcher still requires explicit tbArchive setup;
enabling this build does not automatically capture or import an archive.

Promotion checks: source-only replay and JS syntax/rustfmt checks. No enabled or
disabled build, guest execution, native runtime test, browser or throughput test
was run during this integration. Still required: clean checkout/path replay,
enabled build without TESTS, disabled/native builds, existing CPU/fiber,
Thumb/hooks, persistence, callbacks, bridge/worker and failure/rollback fixtures,
and distribution/license review. The parent owns recording results in
dev-docs/browser.md. This source integration makes no game compatibility or
performance claim.

Exact static checks run during promotion (all passed on final sources):

```sh
node --check web/build-archive.mjs
rustfmt --check --edition 2021 build.rs src/lib.rs
TOUCHHLE_WEB_TB_ARCHIVE=1 node web/build-archive.mjs --prepare-only
cc -std=c11 -fsyntax-only -Wall -Wextra -I target/unicorn.js/unicorn/include src/web/cpu.c src/web/tb-native-bridge.c
bash -c 'source target/emsdk/emsdk_env.sh >/dev/null 2>&1 && emcc -fsyntax-only -Wall -Wextra -DTOUCHHLE_WEB_TB_BRIDGE_PROTOTYPE -DTOUCHHLE_TB_SEAL_PROTOTYPE -I target/unicorn.js/unicorn/include src/web/cpu.c src/web/tb-native-bridge.c'
git diff --check -- build.rs src/lib.rs src/web/cpu.c
```

An additional byte/hash comparison matched all seven audited inputs, and a
comparison of linker `-s` arguments matched the authoritative build-game entry.
Invoking `node web/build-archive.mjs` without the option rejected as expected.
The initial source-only attempt failed because a copy path nested the QEMU
supplement directory; the corrected path passed complete replay/hash checks.

An additional whole-tree comparison exposed the private snapshot's populated
documentation submodule and excluded CI workflows; Git archive intentionally
uses only the pinned core tree (the documentation submodule is not a build
input). GNU patch also emitted .orig backups on offset hunks; the final recipe
disables those backups. Code/source hashes remain the audited comparison.
