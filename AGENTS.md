# touchHLE-web development

Build a client-side iPhone OS emulator. The server serves static files only;
IPAs, execution, audio, graphics, and saves stay on the user's device.

- Keep Rust and existing compatibility fixes. No speculative rewrites.
- Prefer small, tested changes and minimal dependencies (YAGNI).
- Keep native builds working as a correctness reference.
- AI-assisted contributions are allowed in this independent fork. Review and
  test them; never submit them upstream contrary to upstream policy.
- Preserve MPL-2.0 notices, dependency licenses, and attribution.
- Never commit proprietary IPAs, extracted game assets, saves, or credentials.
- Do not describe an upload UI or CPU demo as a working game emulator.
- Record exact tests, limitations, and next steps in dev-docs/browser.md.
- Run formatting and relevant tests before committing; do not hide failures.

## Local test hosting preference

The user already has an HTTPS reverse proxy configured. When they request test
hosting, bind the static server to `0.0.0.0`, normally port `8766`, and provide
the backend address (currently `http://10.17.11.4:8766/`). They open their existing
HTTPS proxy link. Do not ask again for a domain, HTTPS setup, or Tailscale.
Keep the served tested package stable while continuing development separately.
Start/stop hosting according to the latest user request; this is not blanket
permission to expose unrelated services or files.

## Current performance focus and delegated work

On continuation/compaction, first read `dev-docs/wasm-jit/ACTIVE-GOAL.md` and
`dev-docs/wasm-jit/HANDOFF.md`; they record the latest user acceptance target,
current evidence, live tasks and the frozen test package. Keep them current.

The user explicitly authorizes up to four concurrent **GPT-6.1 Sol** subagents
at **medium reasoning** when useful. Respect any lower environment concurrency
limit (currently root plus three children). Use focused, non-overlapping tasks;
serialize actual games, builds, and performance measurements under the parent.
Do not let delegated work alter the currently hosted tested package.

Live task status belongs in `dev-docs/wasm-jit/ACTIVE-GOAL.md` and
`target/optimization-active-handoff.json`, not in this instructions file.

## Cleanup-first standing authorization (user instruction)

When artifact limits approach or refuse admission, proactively retire verified
obsolete/unused artifacts rather than asking to raise limits or stopping solely
because earlier cleanup manifests were exhausted. The user authorizes routine
cleanup of stale build outputs, redundant snapshots, refetchable caches and
superseded intermediate recordings. Review exact paths and dependencies, retain
compact summaries plus useful endpoint/failure evidence, use the manifest-backed
retention tools, and verify protected files afterward. A new reviewed manifest
within these categories does not require another user approval. Old age alone
is not proof of disuse. Preserve original inputs, user saves, sources, credentials,
current/hosted packages, active work and irreplaceable evidence. Record retired
paths/hashes and reproduction or restoration references honestly. Never bypass
budget guards, broadly delete directories, or increase quotas without approval.
Ask only if adequate cleanup requires protected/ambiguous data or a policy change.

## Artifact storage budgets

Use `python3 web/with-artifact-budget.py --kind build|recording --reserve-gib N -- COMMAND`
for every new build or game recording, estimating all temporary output. Budgets:
30 GiB total target, 10 GiB build caches, 5 GiB recordings; keep 2 GiB free.
After each completed experiment, retain summaries, endpoint pairs and failure
examples; explicitly retire intermediate captures before the next admission.
Follow `dev-docs/artifact-retention.md`; never bypass refusal with broad deletion.
Historical deduplicated binary snapshots are read-only shared inodes. Materialize
an independent copy with `web/artifact-dedup.py materialize` before editing or
rebuilding them, including when running as root. Current sources/hosted packages
are excluded from this deduplication.
