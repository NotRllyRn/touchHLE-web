# Continue on another machine

## Fetch the complete source baseline

```sh
git clone --recurse-submodules https://github.com/NotRllyRn/touchHLE-web.git
cd touchHLE-web
git switch main
git status --short
```

Read AGENTS.md and [the implementation plan](browser.md) before resuming.
All completed source work and the in-progress IPA preflight are on main.
There is no need to copy the original TinkerBox checkout or build directories.

## Current executable checks

Install Rust (stable), Node.js (a maintained version with node:test support),
and Python 3 for optional static hosting. Record exact versions when validating
a new machine; a fully pinned cross-platform toolchain/CI is a remaining M0 task.

```sh
rustup target add wasm32-unknown-unknown
cargo fmt --all --check
cargo test --locked -p touchhle-browser
cargo build --locked -p touchhle-browser --target wasm32-unknown-unknown --release
cd web
npm ci --ignore-scripts
npm run build
npm test
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
```

Open http://127.0.0.1:8765 and run the CPU checks or validate a local IPA.
The picker runs the Rust parser in a disposable worker. Validation is separate from execution. Build the HLE runtime using the
Run the actual HLE instructions in ../web/README.md to enable Run IPA. `npm run build` now builds and
copies the parser WASM, so Rust and the wasm32-unknown-unknown target are required.

For native regression tests, first follow [building.md](building.md), including
C/C++ compilers, CMake, Boost and initialized submodules. On the original macOS
development host this passed:

```sh
CMAKE_POLICY_VERSION_MINIMUM=3.5 cargo test --lib -- --skip test_app
```

## Optional next-stage toolchain

Emscripten is not needed for the existing CPU page or raw Rust preflight WASM.
For the planned mixed-language/fiber experiment, use a local SDK installation:

```sh
git clone https://github.com/emscripten-core/emsdk.git target/emsdk
target/emsdk/emsdk install 4.0.23
target/emsdk/emsdk activate 4.0.23
source target/emsdk/emsdk_env.sh
rustup target add wasm32-unknown-emscripten
```

The SDK is ignored. No shell startup edits are necessary. Run the mixed Rust/C fiber experiment as described in `web/README.md`.

## What is deliberately not published

IPAs, extracted proprietary assets, personal saves, local tool installations,
node_modules, compiled binaries and dist. Obtain owned test IPAs separately.
The prior native TinkerBox level sweep is not portable proof of browser support.
See web/README.md before publishing compiled Unicorn-containing artifacts.

## Runtime integration

The source-built interpreter now shares Rust guest mappings and runs the actual
HLE scheduler using Emscripten fibers. An original ARM IPA passes the real loader
and libc in Chromium. TinkerBox startup and graphics remain under investigation;
see browser.md for exact results and limitations.
