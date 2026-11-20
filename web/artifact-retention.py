#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Explicit, root-confined artifact maintenance. Planning never deletes files.

apply requires the SHA256 of the reviewed manifest, validates ALL file identities
before changing anything, and unlinks individual regular files via no-follow dir
descriptors. Reports/source/package inputs are not recording-prune candidates.
"""
import argparse
import collections
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "target"
GIB = 1024 ** 3
CAPTURE = re.compile(r"(?:frame[-_]?\d+|canvas[-_]?\d+(?:\.\d+)?|capture[-_]?\d+|\d{4,6})\.png$", re.I)


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def identity(path):
    s = path.lstat()
    return {"dev": s.st_dev, "ino": s.st_ino, "bytes": s.st_size,
            "mtimeNs": s.st_mtime_ns, "mode": s.st_mode, "blocks": s.st_blocks,
            "links": s.st_nlink}


def within(path, prefix):
    return path == prefix or path.startswith(prefix + "/")


def safe_path(relative, root=None):
    root = ROOT if root is None else root
    p = Path(relative)
    if p.as_posix() != relative or p.is_absolute() or not p.parts or p.parts[0] != "target" or ".." in p.parts:
        raise ValueError(f"Not a target-relative path: {relative}")
    current = root
    for part in p.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError(f"Symlink in path: {relative}")
    if current.resolve() != root / p:
        raise ValueError(f"Path escaped root: {relative}")
    return current


def files():
    for directory, dirs, names in os.walk(TARGET, followlinks=False):
        dirs[:] = sorted(d for d in dirs if not (Path(directory) / d).is_symlink())
        for name in sorted(names):
            p = Path(directory) / name
            if not p.is_symlink() and p.is_file():
                yield p


def policy():
    return json.loads((ROOT / "web/retention-policy.json").read_text())


def protected(relative, pol):
    parts = Path(relative).parts
    if {"touchHLE_sandbox", "saves", "user-data", "user_data", "browser-profile"}.intersection(parts):
        return True
    return relative in pol["protectedFiles"] or any(within(relative, x) for x in pol["protectedPrefixes"])


def capture_file(p):
    # Never confuse a vendor fixture, extracted game asset or saved game with a capture.
    excluded = {"vendor", "node_modules", "assets", "saves", "documents", "payload", "touchhle_sandbox"}
    parts = {s.lower() for s in p.parts}
    return (bool(CAPTURE.fullmatch(p.name)) and not excluded.intersection(parts)
            and not any(s.endswith(".app") or s.startswith("images.") for s in parts))


def cache_roots(paths):
    roots = [p.parent for p in paths if p.name == "CACHEDIR.TAG" and p.parent != TARGET]
    # Old Emscripten sysroot caches are copies; canonical SDK is protected.
    roots += [p.parent for p in paths if p.name == "emscripten.lock" and "emscripten-cache" in str(p.parent)]
    for p in TARGET.glob("tinker-offline-*/emscripten-cache*"):
        if p.is_dir() and not p.is_symlink():
            roots.append(p)
    return sorted(set(roots))


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from strings(item)


def capture_keep(paths):
    keep, groups = set(), collections.defaultdict(list)
    for p in paths:
        if capture_file(p):
            groups[p.parent].append(p)
    for group in groups.values():
        group.sort(key=lambda p: [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", p.name)])
        keep.update(group[:1] + group[-3:])  # startup + failure/final context
    for p in paths:
        # Reference tables are kept irrespective of run age. Do not keep every
        # capture merely because progress/pin manifests enumerate all of them.
        reference = p.suffix == ".json" and (any(x in p.name.lower() for x in ("reference", "golden", "review", "failure", "checkpoint")))
        result = p.name in {"result.json", "run.json", "trace-final.json"}
        if not (reference or result) or p.stat().st_size > 32 * 1024 * 1024:
            continue
        try:
            value = json.loads(p.read_text())
        except (ValueError, UnicodeError):
            continue
        selected = value if reference else value.get("events", []) if isinstance(value, dict) else []
        selected_paths = []
        for value in strings(selected):
            if not value.lower().endswith(".png"):
                continue
            for q in [ROOT / value, p.parent / value, Path(value)]:
                if q.is_absolute() and q.is_relative_to(TARGET) and q.is_file() and not q.is_symlink():
                    keep.add(q)
                    selected_paths.append(q)
        # Preserve the immediately preceding mismatch for each endpoint as well.
        for q in selected_paths:
            group = groups.get(q.parent, [])
            if q in group:
                i = group.index(q)
                keep.update(group[max(0, i - 1):i + 1])
    return keep


def plan(out):
    pol = policy()
    paths = list(files())
    safe_path(out.resolve().relative_to(ROOT).as_posix())
    roots = [safe_path(x) for x in pol["obsoleteBuildRoots"]]
    root_set = set(roots)
    recording_roots = {safe_path(x) for x in pol["recordingRoots"]}
    keep = capture_keep(paths)
    rows, counts = [], collections.Counter()
    for p in paths:
        rel = p.relative_to(ROOT).as_posix()
        if protected(rel, pol) or p in keep:
            continue
        reason = None
        if capture_file(p) and p.parent in recording_roots:
            reason = "intermediate-recording"
        elif any(parent in root_set for parent in p.parents):
            if (p.suffix.lower() not in pol["preserveFileSuffixesInObsoleteBuilds"]
                    and not p.name.upper().startswith(("LICENSE", "COPYING", "NOTICE"))):
                reason = "obsolete-build-output"
        if reason:
            row = {"path": rel, "reason": reason, **identity(p)}
            rows.append(row)
            counts[reason] += row["blocks"] * 512
    # Count only inodes whose every hardlink is selected, not duplicated paths.
    inode_rows = collections.defaultdict(list)
    for row in rows:
        inode_rows[(row["dev"], row["ino"])].append(row)
    reclaim = sum(v[0]["blocks"] * 512 for v in inode_rows.values() if len(v) == v[0]["links"])
    value = {"version": 1, "root": str(ROOT), "policySha256": sha(ROOT / "web/retention-policy.json"),
             "delete": rows, "keepCaptureCount": len(keep),
             "keepCaptures": sorted(str(p.relative_to(ROOT)) for p in keep),
             "cacheRoots": [str(p.relative_to(ROOT)) for p in roots],
             "summary": {"files": len(rows), "estimatedReclaimBytes": reclaim,
                         "pathSummedBytesByReason": dict(counts)}}
    dump(out, value)
    print(json.dumps({"manifest": str(out), "sha256": sha(out), **value["summary"]}, indent=2))


def workload_check():
    # Refuse concurrent compilers/test drivers. Hosting is intentionally allowed.
    for proc in Path("/proc").iterdir():
        if not proc.name.isdigit():
            continue
        try:
            args = (proc / "cmdline").read_bytes().split(b"\0")
            exe = Path(os.fsdecode(args[0])).name if args and args[0] else ""
            if exe in {"cargo", "rustc", "cc1", "cc1plus", "chrome-headless-shell"} or (
                exe in {"node", "nodejs"} and any(b"parent-once.mjs" in a for a in args[1:])):
                raise RuntimeError(f"Concurrent workload PID {proc.name}: {exe}")
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue


def parent_fd(relative):
    parts = Path(relative).parts
    fd = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            new_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = new_fd
        return fd, parts[-1]
    except BaseException:
        os.close(fd)
        raise


def write_exclusive(relative, data):
    safe_path(relative)
    fd, name = parent_fd(relative)
    try:
        out = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644, dir_fd=fd)
        with os.fdopen(out, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
    finally:
        os.close(fd)


def unlink_regular(relative, expected):
    fd, name = parent_fd(relative)
    try:
        s = os.stat(name, dir_fd=fd, follow_symlinks=False)
        if not stat.S_ISREG(s.st_mode):
            raise ValueError("Refusing nonregular unlink")
        if (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_mode) != tuple(
                expected[k] for k in ["dev", "ino", "bytes", "mtimeNs", "mode"]):
            raise ValueError("Identity changed at unlink")
        os.unlink(name, dir_fd=fd)
    finally:
        os.close(fd)


def apply(manifest, expected_sha):
    safe_path(manifest.resolve().relative_to(ROOT).as_posix())
    data = manifest.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected_sha:
        raise ValueError("Manifest SHA mismatch")
    value = json.loads(data)
    if value["root"] != str(ROOT) or value["policySha256"] != sha(ROOT / "web/retention-policy.json"):
        raise ValueError("Root or policy changed")
    pol = policy()
    workload_check()
    if len({r["path"] for r in value["delete"]}) != len(value["delete"]):
        raise ValueError("Duplicate deletion paths")
    if set(value["keepCaptures"]) & {r["path"] for r in value["delete"]}:
        raise ValueError("Retained capture selected for deletion")
    parents = {Path(r["path"]).parent for r in value["delete"]}
    notices = [p / ("RETENTION-PRUNED-" + manifest.stem + ".md") for p in parents]
    receipt = manifest.with_suffix(".receipt.json")
    journal = manifest.with_suffix(".applied.jsonl")
    for p in notices + [receipt.relative_to(ROOT), journal.relative_to(ROOT)]:
        q = safe_path(p.as_posix())
        if q.exists():
            raise ValueError(f"Output already exists: {q}")
    for row in value["delete"]:
        p = safe_path(row["path"])
        if protected(row["path"], pol) or not stat.S_ISREG(p.lstat().st_mode):
            raise ValueError(f"Protected or nonregular target: {p}")
        actual = identity(p)
        if any(actual[k] != row[k] for k in actual):
            raise ValueError(f"File changed since planning: {p}")
    before = shutil.disk_usage(TARGET).free
    fd, name = parent_fd(journal.relative_to(ROOT).as_posix())
    try:
        log_fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644, dir_fd=fd)
    finally:
        os.close(fd)
    with os.fdopen(log_fd, "w") as log:
        for i, row in enumerate(value["delete"]):
            p = safe_path(row["path"])
            # nlink changes as this manifest removes links to the same inode.
            actual = identity(p)
            if any(actual[k] != row[k] for k in ["dev", "ino", "bytes", "mtimeNs", "mode"]):
                raise ValueError(f"File changed during apply: {p}")
            unlink_regular(row["path"], row)
            log.write(json.dumps({"path": row["path"], "reason": row["reason"]}) + "\n")
            if i % 100 == 0:
                log.flush()
                os.fsync(log.fileno())
        log.flush()
        os.fsync(log.fileno())
    # No recursive directory deletion. Small per-directory notices preserve the
    # distinction between historical success and currently available evidence.
    for p in notices:
        write_exclusive(p.as_posix(), (
            "# Retired artifacts\n\nUser-authorized storage retention removed intermediate captures or regenerable build outputs.\n"
            f"Exact inventory: {manifest.relative_to(ROOT)}\n"
            "Reports and prior results remain historical. Full frozen verification or rerunning analyzers may require regeneration.\n").encode())
    result = {"deletedFiles": len(value["delete"]), "freeBefore": before,
              "freeAfter": shutil.disk_usage(TARGET).free, "manifestSha256": expected_sha}
    write_exclusive(receipt.relative_to(ROOT).as_posix(), (json.dumps(result, indent=2) + "\n").encode())
    print(json.dumps(result, indent=2))


def usage():
    paths = list(files())
    roots = cache_roots(paths)
    root_set = set(roots)
    seen = collections.defaultdict(set)
    totals = collections.Counter()
    for p in paths:
        try:
            s = p.stat()
        except FileNotFoundError:
            continue  # Maintenance may retire a file during a read-only inventory.
        key = (s.st_dev, s.st_ino)
        n = s.st_blocks * 512
        categories = {"targetBytes"}
        if capture_file(p) or "runs" in p.relative_to(TARGET).parts:
            categories.add("recordingBytes")
        if p.is_relative_to(TARGET / "debug") or p.is_relative_to(TARGET / "release") or any(parent in root_set for parent in p.parents):
            categories.add("buildCacheBytes")
        for category in categories - seen[key]:
            totals[category] += n
        seen[key].update(categories)
    totals["freeBytes"] = shutil.disk_usage(TARGET).free
    return dict(totals)


def check(reserve_gib):
    if not math.isfinite(reserve_gib) or reserve_gib < 0:
        raise ValueError("Reservation must be finite and nonnegative")
    pol, u = policy(), usage()
    errors = []
    for key, limit in [("recordingBytes", "recordingLimitGiB"), ("buildCacheBytes", "buildCacheLimitGiB"), ("targetBytes", "targetLimitGiB")]:
        if u.get(key, 0) > pol[limit] * GIB:
            errors.append(f"{key} exceeds {pol[limit]} GiB")
    if u["freeBytes"] < (pol["minimumFreeGiB"] + reserve_gib) * GIB:
        errors.append("Insufficient free disk for projected output plus reserve")
    print(json.dumps({"usage": u, "errors": errors, "admitted": not errors}, indent=2))
    return 1 if errors else 0


def main():
    if not (ROOT / "Cargo.toml").is_file() or TARGET.is_symlink() or TARGET.resolve() != TARGET:
        raise ValueError("Unexpected repository or target root")
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("plan"); p.add_argument("manifest", type=Path)
    p = sub.add_parser("apply"); p.add_argument("manifest", type=Path); p.add_argument("--sha256", required=True)
    p = sub.add_parser("check"); p.add_argument("--reserve-gib", type=float, default=0)
    sub.add_parser("status")
    args = parser.parse_args()
    if hasattr(args, "manifest"):
        rel = args.manifest.relative_to(ROOT).as_posix() if args.manifest.is_absolute() else args.manifest.as_posix()
        args.manifest = safe_path(rel)
    if args.command == "plan": plan(args.manifest)
    elif args.command == "apply": apply(args.manifest, args.sha256)
    elif args.command == "status": print(json.dumps(usage(), indent=2))
    elif args.command == "check": return check(args.reserve_gib)
    return 0


if __name__ == "__main__":
    sys.exit(main())
