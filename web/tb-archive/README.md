# Paired archive tooling

Tracked promotion of the validated local native TB + portable Wasm capture,
packager and game player. Rust/core/bridge builds remain owned by the parent
workflow. Its distribution default is `target/tb-archive-dist`; it must copy
this directory's `runtime-worker.js`, `tb-archive-bridge.mjs` and `launch.mjs`
to those basenames in the distribution. Existing production
`web/runtime-worker.js` is separate and unchanged by this promotion.

The launcher retains the validated integration. Worker/helper verification now
uses immutable IPA snapshots and transferred native handles, and stops on package
fingerprint failure before executing runtime scripts. These identity changes
require fresh matching captures; older packages remain separate artifacts.
Rebuilds that change any of the eleven runtime identity files, the helper,
IPA or loader options require a fresh matching paired capture. The packager
checks worker/helper/launcher against these tracked sources, and compiler/JIT
against existing `web/` sources; ignored source directories are not authoritative.
Do not edit helper comments casually: its digest is part of the native namespace.

## Optional audio preparation

Some games spend substantial loading time decoding music in guest code. The
experimental local preparation tool can replace explicitly selected Ogg/Vorbis
entries with PCM16 WAV content, keeping their resource paths. Use it only after
checking that the game recognizes WAV by content and preserves playback and
looping. It requires Python 3.9+ and host libsndfile; it adds no browser dependency.

```sh
python3 web/tb-archive/prepare_audio.py /absolute/path/to/owned.ipa \
  target/owned-prepared \
  --entry Payload/Game.app/Music/level.ogg \
  --max-expanded-increase-mib 20
```

The entry name must match the ZIP exactly; repeat `--entry` to select more files.
The new directory contains `prepared.ipa` and `audio-preparation.json`, including
source/output hashes, decoder version, frame counts and size changes. Pass this
prepared IPA to capture and packaging below. **It needs fresh captures bound to
its new identity; original-IPA archives cannot be reused.** Existing files are
never overwritten. Repository outputs must resolve under ignored `target/`;
external outputs are allowed. A failed run can leave a new directory, so require
successful exit and both output files before continuing.

The tool keeps rates, mono/stereo channels and exact frame counts, without
resampling, trimming or padding. It preserves all unselected entry bytes and
checks every output entry. It rejects chained streams, damaged Ogg pages and
nonempty Vorbis comments, which could contain loop metadata. PCM16 rounding can
differ from guest decoding; this is not a lossless-audio guarantee. Converted
IPAs have stale signing metadata and are intended for this emulator workflow.
The default expanded-size increase limit is 64 MiB; total expanded data is
limited to 512 MiB, individual PCM output to 64 MiB, and the resulting IPA to
the packager's 256 MiB bound. Inspect memory and transfer costs as well as speed.

In one controlled TinkerBox comparison, preparing the first-level music track
reduced selected-level loading from 118–122 s to 29–32 s on the test host. The
IPA grew by 17.3 MB and browser endpoint PSS by about 89–92 MiB. The original and
prepared versions match through one full music loop within two PCM16 steps in
the aligned output samples. A fresh identity-bound package also completes the
first two training lessons. These results do not establish other levels,
mobile/FPS performance, peak memory or final paired-package speed. The tool
selects no assets automatically and is not enabled by default.

Preparation tests use original synthetic audio, with the same host dependency:

```sh
python3 -m unittest discover -s web/tb-archive -p 'test_prepare_audio.py' -v
```

## Local capture

Use the existing Playwright development workflow (`playwright` resolvable from
this module, or `PLAYWRIGHT_MODULE` pointing to its installed module). Install
Chromium using that workflow before running. No new runtime dependency is added.
From the repository root, with an existing output parent:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node web/tb-archive/capture-game.mjs target/tb-archive-dist \
  /absolute/path/to/owned.ipa target/owned-capture
```

The CLI takes runtime directory, IPA and new output directory; optional mode is
`capture` (default), `restore`, `replay-capture`, or `baseline`. Both replay
modes require a native archive path; other modes reject one.
It serves files on loopback and runs a graphical guest in headless Chromium.
`RUN_SECONDS` defaults to 180. `CLICKS` accepts a JSON array of
`{"second":30,"x":0.5,"y":0.5}` normalized canvas clicks. Additional clicks can
be appended to the output's `control.json` array during a run. Logs, screenshots
and traces are private game data: use ignored `target/` or an external directory.
The harness uses the documented Chromium `--no-sandbox` development workflow
with trusted local inputs. Capture runs are diagnostic, not loading-time trials.

A successful capture must contain **both** nonempty `native.tb` and
`capture.json`. Failed runs can leave partial output; JSON alone is insufficient.
The CLI records exact IPA/runtime hashes, graphical/default launch options and
helper digest. Capture and replay-capture produce paired output. Neither builds
or package the runtime. The promoted entry point has captured TinkerBox through
the first lesson scene; exact commands, quota omissions and limitations are in
[the browser development record](../../dev-docs/browser.md).

## Portable capture during native replay

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node web/tb-archive/capture-game.mjs target/tb-archive-dist \
  /absolute/path/to/owned.ipa target/owned-replay replay-capture \
  target/owned-capture/native.tb
```

This collects portable templates from actual replay, including ordinary fallback
translation, with native capture disabled and no portable cache installed. It
reuses the current runtime and exact input native archive; no native recapture is
needed. Successful output requires the worker's matching source hash, admitted
import, actual native restores, intact seal and nonempty bounded portable keys.
An archive-disabled ordinary run cannot become a successful replay capture.
`native.tb` is the exact snapshot served to the worker, not a new native export.
`capture.json` binds its SHA-256/length, checked again by the packager; replay.json
retains admission evidence. Existing key/count/byte quotas and partial coverage
warnings apply. A controlled Tinker comparison reduced compiler misses/time but
showed no clear level-loading improvement; this remains an optional capture mode.
See the browser development record for exact intervals and limits.

## Local package

```sh
node web/tb-archive/package.mjs /absolute/path/to/owned.ipa \
  target/tb-archive-dist target/owned-capture target/owned-game-site
python3 -m http.server 8766 --bind 127.0.0.1 --directory target/owned-game-site
```

Output must be new, with an existing parent. Repository output must stay below
`target/` (parent symlinks are resolved); external output is allowed. Packaging
only reads local inputs, validates hashes, compiles/validates portable Wasm and
copies files. It performs no native import or guest execution. Keep served files
immutable. Use localhost or HTTPS and the existing runtime browser requirements.
The default page offers Play/Stop with diagnostics, without an upload chooser.
`?baseline=1` disables both archives for diagnostics. Running means the start
request was posted, not that gameplay was reached.

For static hosts that support precompressed files, add `--gzip` to the package
command. This writes verified `.gz` siblings for compressible runtime, archive
and text files, plus `compression.json` with raw/encoded sizes and hashes. The
raw files, runtime identity and IPA stay unchanged; no recapture is required.
Packaging roundtrips every sidecar through decompression before publishing it.
The already-compressed IPA is left alone. This uses Node's built-in zlib, with
no browser dependency.

Configure the host to serve a `.gz` sibling **at the original URL**, with
`Content-Encoding: gzip`, the original file's `Content-Type`, and
`Vary: Accept-Encoding`, when the client accepts gzip. Nginx's `gzip_static on`
provides this behavior when its gzip-static module is available. Otherwise the
unchanged raw files remain usable. Plain `python3 -m http.server` does not select
these sidecars automatically. Compression reduces transfer size; it does not
reduce the current decoded archive's memory footprint or prove faster game
execution. Inspect `compression.json` for the actual package's savings.

Capture format 1 requires `abi`, `keys`, exact `identity:{ipa,files}`,
`launchOptions:{headless:false,optionsHash:null}` and `helperSha256`. Complete
legacy `options` or flat `headless`/`optionsHash` representations and
`helperHash`/`bridgeHash` aliases remain accepted; every supplied alias must
agree. No silent helper or graphical defaults are added. All existing bounds
remain: IPA 256 MiB, native wire 160 MiB, capture JSON 40 MiB, keys 32768 / 32 MiB,
ABI 64 KiB and portable cache 64 MiB. Empty portable coverage is explicit.
Opaque native archives are trusted local captures; runtime admission validates
actual compatibility and may fall back. Profile coverage is partial; missing
native records decode normally and portable misses use the existing JIT or
interpreter. Browsers still compile Wasm. No full-app AOT, performance or
full-game compatibility claim is made.

## Payload verification and ownership

The page checks payload size limits and requires an exact native archive length
and SHA-256 in the manifest. The worker verifies the IPA and transferred native
archive **before executing runtime scripts**. Ready means page preparation has
finished; payload verification can still fail after Play. A fingerprint mismatch
stops startup. Native structural/configuration rejection after successful byte
verification can still use normal decoding with the verified runtime.

The helper retains an immutable Blob snapshot behind an opaque IPA handle, so
package verification, mounting and archive setup use one checked input without
rehashing mutable aliases. Native verification first takes ownership by transfer,
detaching caller aliases; its opaque handle is consumed once by import. The full
actual archive digest remains in diagnostics. Later Plays refetch, transfer and
verify again; cancellation and audio activation remain tied to that Play.

Direct trusted local-capture imports without a manifest remain supported by the
fixture/capture tools. They compute the full archive digest and rely on native
identity/structure checks; they do not claim an externally verified manifest.
The packaged player always supplies `sourceSha256` from its validated manifest.

## Status and licensing

The promoted opt-in and default-off builds and public runtime/browser fixtures
pass, including native restore with zero frontend calls for admitted fixture
records and normal decoding after rejection. Fresh promoted Tinker capture and
packaging also pass. The existing private paired comparison showed no loading
gain. Verification reuse now shows a modest startup improvement in one matched
A/B/A; scene loading, both lessons and FPS acceptance remain open. Full JS suite:
109/109; delayed replay/cancellation/audio and served mutation checks pass.
See `dev-docs/browser.md` for exact identities, browser lifecycle results, quota
omissions and remaining scene, memory, gameplay and save validation.

Preserve MPL-2.0 headers, LICENSE, dependency notices and attribution. Generated
packages include the existing license catalog and SOURCE.md. Before sharing a
package, supply the exact corresponding runtime/dependency source, patches and
build scripts required by their licenses; a moving repository URL is insufficient.
Game distribution rights are separate. Never commit IPAs, extracted assets,
native archives, traces, saves or credentials. See [SOURCE.md](SOURCE.md) and
[the existing distribution guidance](../README.md).

## Focused verification

```sh
node --test web/tb-archive/*.test.mjs
for file in web/tb-archive/*.mjs web/tb-archive/*.js; do node --check "$file" || exit; done
```

The initial promotion run passed 30/31 tests; one bridge test still used its old
relative compiler path. That test path was corrected without changing runtime
bytes. Final results are recorded below. Tests use synthetic files, mocked
workers/audio and portable Wasm validation; no guest or browser is executed.

Final run: **31 passed, 0 failed** (16 bridge tests plus the original 15 package,
launcher and player tests). All **12 JS files** passed `node --check`. Worker,
helper and launcher were compared byte-for-byte with the supplied sources;
player, HTML and SOURCE.md also remain byte-identical. No runtime builds,
browsers/games, timing runs, subagents, commits or parent/private edits were
performed. Formatting follows the existing source style; whitespace checks pass.

Parent correction: verified-bootstrap fingerprint failure is fatal before any
runtime script executes. Only archive admission failures may use normal decoding
with the already verified runtime. Focused worker test covers missing request
and mismatch rejection without runtime or fallback script execution.

## Runtime fixture check

Generate the original public ARM/Mach-O fixture with
`python3 web/fixtures/make-hle-ipa.py`. Then, after an archive runtime build:

```sh
node web/tb-archive/check-runtime.mjs capture target/tb-archive-dist target/tb-runtime-check
node web/tb-archive/check-runtime.mjs restore target/tb-archive-dist target/tb-runtime-check
node web/tb-archive/check-runtime.mjs disabled target/tb-archive-dist target/tb-runtime-check
```

Each command uses a fresh process. Set `RESTORE_JIT=1` to repeat with JIT enabled.
The restore check requires actual import/restores and zero ARM frontend calls
through the expected guest output; this is a tiny original fixture, not game
coverage. Parent has prepared this promoted entry; execution results belong in
`dev-docs/browser.md`.

The archive build supplies UNICORN-LICENSE, UNICORN-COPYING,
UNICORN-COPYING.LGPL2 and UNICORN-COPYING_GLIB from pinned sources. The packager
requires these notices in the supplied runtime directory, so the separate
validator/page build is not a licensing prerequisite.

The same fixture can exercise the verified Blob worker in a fresh Chromium
process. First create `runtime-roundtrip.bin` with the Node capture command
above, then run:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node web/tb-archive/check-browser.mjs restore target/tb-archive-dist target/tb-runtime-check
```

The browser checker also accepts `capture` (checks capture activity without
exporting) and `disabled` (checks verified execution with no admitted archive).
Mode `reject` corrupts only the served archive magic and requires rejection plus
successful guest execution through normal decoding; the saved archive is intact.
It records messages and static requests in the output directory and requires
the original guest PASS/exit result. Restore additionally requires admitted
records and zero frontend calls. These fixture checks do not measure game speed.


Browser modes `ipa-mismatch` and `archive-mismatch` require a fingerprint error
before runtime/guest output. They exercise manifest verification separately from
trusted-source structural rejection/fallback in `reject`. The current page also
rejects legacy helpers missing the verified-payload ownership API before launch.
