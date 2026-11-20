#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Review-first target artifact deduplication. No source/protected mutation.

Extent mode preserves independent inodes. Explicit hardlink mode is only for
reviewed immutable binary artifacts: subsequent edits MUST replace their inode,
never truncate/write in place. Hardlink apply removes write mode bits; use the
materialize command before any edit/rebuild (including as root). Plan hashes are mandatory for apply. Stop builds,
packaging and cleanup before planning/applying; this is not a concurrent writer
transaction. No fallback from extent mode to hardlinks happens automatically.
"""
import argparse
import collections
import fcntl
import hashlib
import json
import os
import re
from pathlib import Path
import stat
import struct
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
POLICY = 'web/retention-policy.json'
AUDIT = 'target/retention-audit-protected/protected.json'
BINARY_SUFFIXES = {'.ipa', '.wasm', '.tb'}
CAPTURE = re.compile(r'(?:frame[-_]?\d+|canvas[-_]?\d+(?:\.\d+)?|capture[-_]?\d+|\d{4,6})\.png$', re.I)
SOURCE_SUFFIXES = {'.rs', '.c', '.h', '.js', '.mjs', '.py', '.cpp'}
IDENTITY_FIELDS = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_mode', 'st_nlink', 'st_uid', 'st_gid')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def hash_file(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def identical(a, b):
    a.seek(0)
    b.seek(0)
    while True:
        left, right = a.read(1024 * 1024), b.read(1024 * 1024)
        if left != right:
            return False
        if not left:
            return True


def identity(s):
    return {field: getattr(s, field) for field in IDENTITY_FIELDS}


def confined(root, relative):
    p = Path(relative)
    if not isinstance(relative, str) or p.is_absolute() or not p.parts or p.parts[0] != 'target' or p.as_posix() != relative or '..' in p.parts:
        raise ValueError(f'Not a canonical target path: {relative}')
    current = root
    for part in p.parts:
        current /= part
        if current.is_symlink():
            raise ValueError(f'Symlink path: {relative}')
    return current


def protection(root):
    pol = json.loads((root / POLICY).read_text())
    audit = json.loads((root / AUDIT).read_text())
    trees, files = set(pol['protectedPrefixes']), set(pol['protectedFiles'])
    for item in audit['protected']:
        path = Path(item['path'])
        try:
            relative = path.relative_to(root).as_posix()
        except ValueError:
            continue
        (trees if item['scope'] == 'tree' else files).add(relative)
    return trees, files, {POLICY: hash_file(root / POLICY), AUDIT: hash_file(root / AUDIT)}


def protected(relative, trees, files):
    parts = {p.lower() for p in Path(relative).parts}
    return (bool(parts & {'touchhle_sandbox', 'saves', 'user-data', 'user_data', 'browser-profile', 'profiles', 'documents', 'payload'})
            or any(p.endswith('.app') for p in parts)
            or relative in files or any(relative == t or relative.startswith(t + '/') for t in trees))


def binary(path):
    parts = {part.lower() for part in path.parts}
    if parts & {'cargo', 'cargo-target', 'deps', 'incremental', 'build'} or any(part.startswith('emscripten-cache') for part in parts):
        return False
    return path.suffix.lower() in BINARY_SUFFIXES or path.name == 'touchhle-runtime.data'


def eligible(path, relative, selection, recording_roots):
    if selection == 'binary':
        return binary(path)
    if selection != 'supplement':
        raise ValueError('Unknown selection')
    # Compressed immutable binaries only; .js.gz remains source inventory-only.
    gzip_binary = path.suffix == '.gz' and binary(path.with_suffix(''))
    parts = {part.lower() for part in path.parts}
    capture = (bool(CAPTURE.fullmatch(path.name)) and str(Path(relative).parent) in recording_roots
               and not parts & {'vendor', 'node_modules', 'assets', 'saves', 'documents', 'payload', 'touchhle_sandbox'}
               and not any(part.endswith('.app') or part.startswith('images.') for part in parts))
    return gzip_binary or capture


def plan(root, minimum, selection='binary', skip_source=False):
    trees, files, safeguards = protection(root)
    recording_roots = set(json.loads((root / POLICY).read_text()).get('recordingRoots', []))
    sizes = collections.defaultdict(list)
    source_sizes = collections.defaultdict(list)
    skipped = 0
    for directory, dirs, names in os.walk(root / 'target', followlinks=False):
        dirs[:] = sorted(d for d in dirs if not (Path(directory) / d).is_symlink()
                         and not protected((Path(directory) / d).relative_to(root).as_posix(), trees, files))
        for name in sorted(names):
            path = Path(directory) / name
            relative = path.relative_to(root).as_posix()
            try:
                s = path.lstat()
                if not stat.S_ISREG(s.st_mode) or protected(relative, trees, files):
                    continue
                if eligible(path, relative, selection, recording_roots) and s.st_size >= minimum:
                    # An existing shared inode may have a protected alias outside the scan.
                    if s.st_nlink != 1:
                        skipped += 1
                        continue
                    sizes[s.st_size].append((path, identity(s), s.st_blocks * 512))
                elif not skip_source and path.suffix in SOURCE_SUFFIXES and s.st_size >= 4096:
                    source_sizes[s.st_size].append((path, identity(s), s.st_blocks * 512))
            except FileNotFoundError:
                continue
    changed = []

    def group_candidates(candidates):
        result = []
        for size, candidates_of_size in sorted(candidates.items(), reverse=True):
            if len(candidates_of_size) < 2:
                continue
            hashed = collections.defaultdict(list)
            for path, recorded, allocated in candidates_of_size:
                try:
                    sha = hash_file(path)
                    if identity(path.stat()) != recorded:
                        changed.append(path.relative_to(root).as_posix())
                        continue
                    hashed[(sha, recorded['st_dev'], recorded['st_mode'], recorded['st_uid'], recorded['st_gid'])].append((path, recorded, allocated))
                except FileNotFoundError:
                    changed.append(path.relative_to(root).as_posix())
            for key, matches in hashed.items():
                if len(matches) < 2:
                    continue
                source = matches[0][0]
                verified = []
                for path, recorded, allocated in matches:
                    try:
                        with source.open('rb') as a, path.open('rb') as b:
                            if identical(a, b) and identity(os.fstat(b.fileno())) == recorded:
                                verified.append({'path': path.relative_to(root).as_posix(), 'identity': recorded, 'allocatedBytes': allocated})
                    except FileNotFoundError:
                        changed.append(path.relative_to(root).as_posix())
                if len(verified) > 1:
                    result.append({'sha256': key[0], 'bytes': size, 'files': verified})
        return result

    groups = group_candidates(sizes)
    sources = group_candidates(source_sizes)
    return {'version': 1, 'workspace': str(root), 'safeguards': safeguards, 'selection': selection,
            'minimumBytes': minimum, 'groups': groups,
            'estimatedReclaimableBytes': sum(f['allocatedBytes'] for g in groups for f in g['files'][1:]),
            'sourceDuplicateInventoryOnly': sources,
            'sourceLogicalDuplicateBytes': sum(g['bytes'] * (len(g['files']) - 1) for g in sources),
            'alreadySharedBinaryFilesSkipped': skipped, 'changedOrDisappearedDuringScan': sorted(set(changed))}


def dedup_extent(source, destination, size):
    # linux/fs.h: file_dedupe_range header followed by one range_info.
    request = bytearray(struct.pack('=QQHHI', 0, size, 1, 0, 0)
                        + struct.pack('=qQQiI', destination, 0, 0, 0, 0))
    fcntl.ioctl(source, 0xc0189436, request, True)
    _, _, deduped, status, _ = struct.unpack('=qQQiI', request[24:])
    if status != 0:
        raise OSError(-status if status < 0 else 5, f'FIDEDUPERANGE status {status}')
    return deduped


def probe(root):
    with tempfile.TemporaryDirectory(prefix='dedup-probe-', dir=root / 'target') as directory:
        a, b = Path(directory) / 'a', Path(directory) / 'b'
        a.write_bytes(b'x' * 8192)
        b.write_bytes(a.read_bytes())
        try:
            with a.open('rb') as source, b.open('r+b') as destination:
                size = dedup_extent(source.fileno(), destination.fileno(), 8192)
            return {'supported': True, 'dedupedBytes': size}
        except OSError as exc:
            return {'supported': False, 'errno': exc.errno, 'error': str(exc)}


def apply(root, manifest, approved, method, shared):
    raw = manifest.read_bytes()
    if digest(raw) != approved:
        raise ValueError('Manifest approval digest mismatch')
    review = json.loads(raw)
    trees, files, safeguards = protection(root)
    if review['version'] != 1 or review['workspace'] != str(root) or review['safeguards'] != safeguards:
        raise ValueError('Workspace/protection changed; create and review a new plan')
    if method == 'hardlink' and not shared:
        raise ValueError('Hardlinks require --accept-shared-inodes after immutable-artifact review')
    if method == 'extent' and not probe(root)['supported']:
        raise ValueError('Extent deduplication unavailable; no artifact modified')
    recording_roots = set(json.loads((root / POLICY).read_text()).get('recordingRoots', []))
    opened = []
    seen = set()
    try:
        # Preflight every entry before mutation, pin no-follow file descriptors.
        for group in review['groups']:
            entries = []
            if len(group['files']) < 2:
                raise ValueError('Malformed duplicate group')
            for entry in group['files']:
                relative = entry['path']
                path = confined(root, relative)
                if relative in seen or not eligible(path, relative, review.get('selection', 'binary'), recording_roots) or protected(relative, trees, files):
                    raise ValueError(f'Forbidden/duplicate entry: {relative}')
                seen.add(relative)
                fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
                stream = os.fdopen(fd, 'rb')
                opened.append(stream)
                if identity(os.fstat(fd)) != entry['identity'] or entry['identity']['st_nlink'] != 1 or not stat.S_ISREG(os.fstat(fd).st_mode):
                    raise ValueError(f'Identity changed: {relative}')
                if hash_file(path) != group['sha256'] or os.fstat(fd).st_size != group['bytes']:
                    raise ValueError(f'Hash/size changed: {relative}')
                if entries and not identical(entries[0][1], stream):
                    raise ValueError(f'Byte comparison failed: {relative}')
                if entries and any(entry['identity'][key] != entries[0][2]['identity'][key] for key in ('st_dev', 'st_mode', 'st_uid', 'st_gid')):
                    raise ValueError(f'Metadata mismatch: {relative}')
                if os.listxattr(fd):
                    raise ValueError(f'Extended attributes/ACL require separate review: {relative}')
                entries.append((path, stream, entry))
            # Keep group boundaries for execution after the complete preflight.
            group['_opened'] = entries
        completed = []
        for group in review['groups']:
            source_path, source, _ = group['_opened'][0]
            if method == 'hardlink':
                # Shared artifacts are immutable. Materialize before any edit/rebuild.
                os.fchmod(source.fileno(), stat.S_IMODE(os.fstat(source.fileno()).st_mode) & ~0o222)
            for path, destination, entry in group['_opened'][1:]:
                # Extent operations only share blocks after a kernel byte check.
                # Hardlink callers must quiesce all writers; no shell/path following.
                if path.lstat().st_ino != entry['identity']['st_ino'] or source_path.lstat().st_ino != os.fstat(source.fileno()).st_ino:
                    raise ValueError('Path changed during apply')
                if method == 'extent':
                    with path.open('r+b') as writable:
                        count = dedup_extent(source.fileno(), writable.fileno(), group['bytes'])
                else:
                    fd, temporary = tempfile.mkstemp(prefix='.dedup-', dir=path.parent)
                    os.close(fd)
                    os.unlink(temporary)
                    try:
                        os.link(source_path, temporary, follow_symlinks=False)
                        os.replace(temporary, path)
                    finally:
                        if os.path.lexists(temporary):
                            os.unlink(temporary)
                    count = entry['allocatedBytes']
                completed.append({'path': entry['path'], 'bytes': count})
                print(json.dumps({'completed': completed[-1]}), flush=True)
        return {'method': method, 'completed': completed, 'reportedBytes': sum(e['bytes'] for e in completed)}
    finally:
        for stream in opened:
            stream.close()


def materialize(root, relative, expected):
    """Detach an approved immutable artifact into its own writable inode."""
    trees, files, _ = protection(root)
    path = confined(root, relative)
    recording_roots = set(json.loads((root / POLICY).read_text()).get('recordingRoots', []))
    if not (eligible(path, relative, 'binary', recording_roots) or eligible(path, relative, 'supplement', recording_roots)) or protected(relative, trees, files):
        raise ValueError('Only unprotected immutable artifacts can be materialized')
    before = path.lstat()
    if os.listxattr(path):
        raise ValueError('Extended attributes/ACL require separate review')
    if not stat.S_ISREG(before.st_mode) or hash_file(path) != expected:
        raise ValueError('Materialize identity/hash mismatch')
    fd, temporary = tempfile.mkstemp(prefix='.materialize-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as destination, path.open('rb') as source:
            for block in iter(lambda: source.read(1024 * 1024), b''):
                destination.write(block)
            destination.flush()
            os.fsync(destination.fileno())
            os.fchown(destination.fileno(), before.st_uid, before.st_gid)
            os.fchmod(destination.fileno(), stat.S_IMODE(before.st_mode) | stat.S_IWUSR)
        if identity(path.lstat()) != identity(before) or hash_file(Path(temporary)) != expected:
            raise ValueError('Materialize input changed during copy')
        os.replace(temporary, path)
        return {'path': relative, 'independentWritableInode': True, 'sha256': expected}
    finally:
        if os.path.lexists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    scan = commands.add_parser('plan')
    scan.add_argument('--output', type=Path, required=True)
    scan.add_argument('--minimum-bytes', type=int, default=1024 * 1024)
    scan.add_argument('--selection', choices=['binary', 'supplement'], default='binary')
    scan.add_argument('--skip-source', action='store_true')
    commands.add_parser('probe')
    detach = commands.add_parser('materialize', help='MANDATORY before editing/rebuilding a shared artifact')
    detach.add_argument('--path', required=True)
    detach.add_argument('--expected-sha256', required=True)
    run = commands.add_parser('apply')
    run.add_argument('--manifest', type=Path, required=True)
    run.add_argument('--approved-sha256', required=True)
    run.add_argument('--method', choices=['extent', 'hardlink'], default='extent')
    run.add_argument('--accept-shared-inodes', action='store_true')
    args = parser.parse_args()
    if args.command == 'probe':
        print(json.dumps(probe(ROOT), indent=2))
    elif args.command == 'materialize':
        print(json.dumps(materialize(ROOT, args.path, args.expected_sha256)))
    elif args.command == 'plan':
        if args.output.exists():
            raise ValueError('Refusing to overwrite an existing manifest')
        value = plan(ROOT, args.minimum_bytes, args.selection, args.skip_source)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(value, indent=2) + '\n')
        print(json.dumps({'manifest': str(args.output), 'sha256': hash_file(args.output),
                          'groups': len(value['groups']), 'estimatedReclaimableBytes': value['estimatedReclaimableBytes']}))
    else:
        print(json.dumps(apply(ROOT, args.manifest, args.approved_sha256, args.method, args.accept_shared_inodes), indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError) as error:
        print(f'error: {error}', file=sys.stderr)
        sys.exit(1)
