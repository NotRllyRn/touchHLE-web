#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""All mutation tests run in disposable directories, never real artifacts."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('dedup', Path(__file__).with_name('artifact-dedup.py'))
dedup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dedup)


class DedupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'web').mkdir()
        (self.root / 'target/retention-audit-protected').mkdir(parents=True)
        (self.root / dedup.POLICY).write_text(json.dumps({'protectedFiles': ['target/protected.ipa'], 'protectedPrefixes': ['target/hosted']}))
        (self.root / dedup.AUDIT).write_text(json.dumps({'protected': [{'path': str(self.root / 'target/current'), 'scope': 'tree'}]}))
        self.a = self.file('target/old/a.ipa')
        self.b = self.file('target/old/b.ipa')

    def file(self, name, content=b'a' * 8192):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def manifest(self, value=None):
        value = dedup.plan(self.root, 4096) if value is None else value
        path = self.root / 'manifest.json'
        path.write_text(json.dumps(value))
        return path, dedup.hash_file(path)

    def run_apply(self, value=None, method='hardlink', shared=True):
        path, sha = self.manifest(value)
        with contextlib.redirect_stdout(io.StringIO()):
            return dedup.apply(self.root, path, sha, method, shared)

    def test_hardlink_preserves_exact_bytes_and_reports_all_destinations(self):
        self.file('target/old/c.ipa')
        result = self.run_apply()
        self.assertEqual(len(result['completed']), 2)
        self.assertEqual(self.a.stat().st_ino, self.b.stat().st_ino)
        self.assertEqual(self.b.read_bytes(), b'a' * 8192)

    def test_shared_artifacts_readonly_and_materialize_before_edit(self):
        expected = dedup.hash_file(self.a)
        self.run_apply()
        self.assertEqual(self.a.stat().st_mode & 0o222, 0)
        self.assertEqual(self.b.stat().st_mode & 0o222, 0)
        dedup.materialize(self.root, 'target/old/b.ipa', expected)
        self.assertNotEqual(self.a.stat().st_ino, self.b.stat().st_ino)
        self.assertTrue(self.b.stat().st_mode & 0o200)
        self.b.write_bytes(b'updated')
        self.assertEqual(dedup.hash_file(self.a), expected)
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            dedup.materialize(self.root, 'target/old/b.ipa', expected)

    def test_build_cache_binaries_are_not_candidates(self):
        for name in ('target/old/a.a', 'target/old/a.rlib', 'target/runtime/cargo/a.wasm', 'target/deps/a.wasm', 'target/build/a.wasm'):
            self.assertFalse(dedup.binary(Path(name)))

    def test_protected_saves_symlinks_and_existing_shared_inodes_excluded(self):
        for name in ('target/protected.ipa', 'target/hosted/game.ipa', 'target/current/game.ipa', 'target/old/saves/game.ipa', 'target/old/Payload/Foo.app/game.ipa'):
            self.file(name)
        (self.root / 'target/alias.ipa').symlink_to(self.a)
        os.link(self.a, self.root / 'target/shared.ipa')
        review = dedup.plan(self.root, 4096)
        self.assertEqual(review['groups'], [])
        self.assertEqual(review['alreadySharedBinaryFilesSkipped'], 2)

    def test_source_files_inventory_only(self):
        self.file('target/old/a.js')
        self.file('target/old/b.js')
        review = dedup.plan(self.root, 4096)
        self.assertEqual(len(review['groups']), 1)
        self.assertEqual(len(review['sourceDuplicateInventoryOnly']), 1)
        review['groups'] = review['sourceDuplicateInventoryOnly']
        with self.assertRaisesRegex(ValueError, 'Forbidden'):
            self.run_apply(review)

    def test_hash_match_alone_does_not_authorize_unequal_bytes(self):
        self.b.write_bytes(b'b' * 8192)
        with mock.patch.object(dedup, 'hash_file', return_value='same hash'):
            self.assertEqual(dedup.plan(self.root, 4096)['groups'], [])

    def test_supplement_only_explicit_recordings_and_binary_gzip(self):
        policy = json.loads((self.root / dedup.POLICY).read_text())
        policy['recordingRoots'] = ['target/history']
        policy['protectedFiles'].append('target/history/frame-00003.png')
        (self.root / dedup.POLICY).write_text(json.dumps(policy))
        for name in ('target/history/frame-00001.png', 'target/history/canvas-00002.png',
                     'target/history/frame-00003.png', 'target/history/icon.png',
                     'target/history/assets/frame-00004.png', 'target/elsewhere/frame-00005.png',
                     'target/old/runtime.wasm.gz', 'target/old/copy.wasm.gz',
                     'target/old/a.js.gz', 'target/old/b.js.gz'):
            self.file(name)
        self.file('target/old/a.js')
        self.file('target/old/b.js')
        review = dedup.plan(self.root, 1, selection='supplement', skip_source=True)
        self.assertEqual(len(review['groups']), 1)  # Same bytes/mode combine PNG and gzip artifacts.
        entries = review['groups'][0]['files']
        self.assertEqual({e['path'] for e in entries}, {
            'target/history/frame-00001.png', 'target/history/canvas-00002.png',
            'target/old/runtime.wasm.gz', 'target/old/copy.wasm.gz'})
        self.assertEqual(review['sourceDuplicateInventoryOnly'], [])
        result = self.run_apply(review)
        self.assertEqual(len(result['completed']), 3)
        png = self.root / 'target/history/frame-00001.png'
        self.assertEqual(png.stat().st_mode & 0o222, 0)
        dedup.materialize(self.root, 'target/history/frame-00001.png', dedup.hash_file(png))
        self.assertEqual(png.stat().st_nlink, 1)

    def test_hash_approval_required(self):
        path, _ = self.manifest()
        with self.assertRaisesRegex(ValueError, 'digest mismatch'):
            dedup.apply(self.root, path, '0' * 64, 'hardlink', True)

    def test_changed_identity_aborts_all_before_mutation(self):
        review = dedup.plan(self.root, 4096)
        self.b.write_bytes(b'b' * 8192)
        before = self.a.stat().st_ino
        with self.assertRaisesRegex(ValueError, 'Identity changed'):
            self.run_apply(review)
        self.assertEqual(self.a.stat().st_ino, before)
        self.assertNotEqual(self.a.stat().st_ino, self.b.stat().st_ino)

    def test_changed_protection_aborts(self):
        review = dedup.plan(self.root, 4096)
        (self.root / dedup.POLICY).write_text('{}')
        # A valid changed protection document must be rejected by its snapshot digest.
        (self.root / dedup.POLICY).write_text(json.dumps({'protectedFiles': [], 'protectedPrefixes': ['target/old']}))
        with self.assertRaisesRegex(ValueError, 'protection changed'):
            self.run_apply(review)

    def test_hardlinks_require_explicit_acknowledgement(self):
        with self.assertRaisesRegex(ValueError, 'accept-shared-inodes'):
            self.run_apply(shared=False)

    def test_extent_failure_does_not_fallback_or_mutate(self):
        with mock.patch.object(dedup, 'probe', return_value={'supported': False}):
            with self.assertRaisesRegex(ValueError, 'no artifact modified'):
                self.run_apply(method='extent')
        self.assertNotEqual(self.a.stat().st_ino, self.b.stat().st_ino)

    def test_symlink_parent_and_traversal_rejected(self):
        (self.root / 'target/link').symlink_to(self.root / 'target/old')
        for relative in ('target/link/a.ipa', 'target/../web/foo', '/tmp/a.ipa', 'target//old/a.ipa'):
            with self.assertRaises(ValueError):
                dedup.confined(self.root, relative)

    def test_extent_ioctl_layout_and_status(self):
        def ioctl(fd, op, request, mutate):
            self.assertEqual((fd, op, mutate), (7, 0xc0189436, True))
            self.assertEqual(struct.unpack('=QQHHI', request[:24]), (0, 8192, 1, 0, 0))
            request[24:] = struct.pack('=qQQiI', 8, 0, 8192, 0, 0)
        with mock.patch.object(dedup.fcntl, 'ioctl', side_effect=ioctl):
            self.assertEqual(dedup.dedup_extent(7, 8, 8192), 8192)
        def failure(fd, op, request, mutate):
            request[24:] = struct.pack('=qQQiI', 8, 0, 0, -22, 0)
        with mock.patch.object(dedup.fcntl, 'ioctl', side_effect=failure):
            with self.assertRaises(OSError):
                dedup.dedup_extent(7, 8, 8192)

    def test_inode_metadata_and_xattrs_not_silently_discarded(self):
        review = dedup.plan(self.root, 4096)
        review['groups'][0]['files'][1]['identity']['st_mode'] ^= 0o100
        with self.assertRaises(ValueError):
            self.run_apply(review)
        if hasattr(os, 'setxattr'):
            try:
                os.setxattr(self.b, 'user.dedup-test', b'preserve')
            except OSError:
                self.skipTest('User xattrs unavailable')
            with self.assertRaisesRegex(ValueError, 'Extended attributes'):
                self.run_apply()


if __name__ == '__main__':
    unittest.main()
