# Artifact storage retention

## Standing cleanup-first authorization

The user explicitly authorizes deleting verified old unused artifacts when limits
are reached, instead of defaulting to quota increases or an idle worker. Apply this
on every future admission failure: inspect usage/dependencies, select obsolete
build outputs, redundant snapshots, refetchable caches and superseded intermediate
recordings, write and review a fresh exact-path manifest, apply through retention
tools, verify protected files, then retry honest admission. Existing manifests
being exhausted is not a reason to seek renewed permission for these categories.
Retain compact reports, hashes, useful endpoint/failure examples and restoration
or reproduction references; mark retired historical paths as absent, never as
still hash-verifiable. Age alone does not establish that an artifact is unused.
Current/hosted products, active work, original assets, user saves, source and
irreplaceable evidence stay protected. No broad directory deletion or budget bypass.
Escalate only when cleanup would require protected/ambiguous data or changing limits.


Budgets: 30 GiB allocated target storage, 5 GiB recordings, 10 GiB build
caches, and at least 2 GiB free after projected output. These are admission
limits, not a filesystem quota. Never delete protected artifacts to satisfy a
budget. Hosting, original inputs, saves, current native/web packages, licenses,
reports, timing JSON, golden/endpoint/failure captures and source are retained.

Every new game recording or build must use the serialized admission wrapper:

```sh
python3 web/with-artifact-budget.py --kind recording --reserve-gib 0.75 -- node path/to/new-harness.mjs
python3 web/with-artifact-budget.py --kind build --reserve-gib 3 -- cargo build
```

Estimate the whole workload, including temporary output. The wrapper refuses
projected category/total/free-space violations; it does not kill a workload if
its estimate is exceeded. Bound capture count/bytes in new harnesses. After each
completed experiment, retain event pairs, failure context and summaries, then
retire intermediate frames before admitting the next experiment. Never modify a
frozen harness just to retrofit this wrapper: wrap its invocation instead.

Inspect storage with `python3 web/artifact-retention.py status`. To retire
artifacts, explicitly review and add completed capture directories or obsolete
build roots to `web/retention-policy.json`, then:

```sh
python3 web/artifact-retention.py plan target/retention-review/plan.json
# Review all selected roots/files, retained evidence and manifest SHA256.
python3 web/artifact-retention.py apply target/retention-review/plan.json --sha256 REVIEWED_SHA256
```

Planning is read-only except its manifest. Apply checks root, policy, identities,
protected paths, symlinks and active workloads before unlinking individual files.
It produces an exact deletion journal, receipt and per-directory retirement
notices. No recursive directory deletion is used. Use a new manifest filename
for each pass. Run maintenance with workers/builds/games idle.

Historical reports remain historical after pruning; complete old raw-frame
analysis and frozen pin checks may no longer be reproducible without regenerating
the retired recordings/build products. Never reinterpret pruning as passing an
old verifier or improving game performance.

## Exact duplicate snapshots

`web/artifact-dedup.py` plans exact SHA256 plus byte-equality groups, excluding
protected/current packages and editable source. Filesystem extent deduplication
was unavailable here (EPERM), so reviewed historical binary/capture groups use
read-only hardlinks. Their paths and bytes remain intact. This is not safe for
in-place editing, even as root; first detach the file:

```sh
python3 web/artifact-dedup.py materialize --path target/OLD/FILE --expected-sha256 SHA256
```

The command verifies the expected content and replaces that one path with an
independent writable inode. Rebuilding into old snapshot directories without
materializing is prohibited. Prefer a new bounded output directory. Source
copies remain separate because they may be edited. Protected hosted files and
current candidates were never linked into the shared groups.
