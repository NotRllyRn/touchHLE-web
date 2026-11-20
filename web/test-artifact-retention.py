# SPDX-License-Identifier: MPL-2.0
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("retention", Path(__file__).with_name("artifact-retention.py"))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class RetentionSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.patches = [patch.object(r, "ROOT", self.root), patch.object(r, "TARGET", self.root / "target"),
                        patch.object(r, "workload_check", lambda: None)]
        for p in self.patches:
            p.start()
        (self.root / "target/a").mkdir(parents=True)
        (self.root / "web").mkdir()
        self.pol = {"protectedPrefixes": ["target/protected"], "protectedFiles": [],
                    "obsoleteBuildRoots": [], "recordingRoots": ["target/a"],
                    "preserveFileSuffixesInObsoleteBuilds": [".json", ".md", ".png"]}
        r.dump(self.root / "web/retention-policy.json", self.pol)

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.temp.cleanup()

    def manifest(self):
        for i in range(8):
            (self.root / f"target/a/frame-{i:05}.png").write_bytes(bytes([i]))
        p = self.root / "target/plan.json"
        r.plan(p)
        return p

    def test_escape_and_noncanonical_rejected(self):
        for path in ["/tmp/x", "target/../web/x", "target//protected/x", "target/./protected/x", "web/x"]:
            with self.assertRaises(ValueError):
                r.safe_path(path)

    def test_symlink_rejected(self):
        (self.root / "target/a/link").symlink_to(self.root / "web", target_is_directory=True)
        with self.assertRaises(ValueError):
            r.safe_path("target/a/link/x")

    def test_asset_and_save_not_capture(self):
        for path in ["target/a/Payload/game.app/0001.png", "target/vendor/0001.png", "target/touchHLE_sandbox/frame-00001.png"]:
            self.assertFalse(r.capture_file(Path(path)))
        self.assertTrue(r.protected("target/a/touchHLE_sandbox/save", self.pol))

    def test_wrong_digest_and_stale_identity_prevent_any_deletion(self):
        p = self.manifest()
        with self.assertRaises(ValueError):
            r.apply(p, "bad")
        rows = json.loads(p.read_text())["delete"]
        (self.root / rows[-1]["path"]).write_bytes(b"changed")
        with self.assertRaises(ValueError):
            r.apply(p, r.sha(p))
        self.assertTrue(all((self.root / row["path"]).exists() for row in rows))

    def test_keep_overrides_cache_and_apply_is_precise(self):
        self.pol["obsoleteBuildRoots"] = ["target/a"]
        r.dump(self.root / "web/retention-policy.json", self.pol)
        r.dump(self.root / "target/a/references.json", {"gold": "target/a/frame-00003.png"})
        p = self.manifest()
        plan = json.loads(p.read_text())
        self.assertNotIn("target/a/frame-00003.png", [x["path"] for x in plan["delete"]])
        r.apply(p, r.sha(p))
        self.assertTrue((self.root / "target/a/frame-00003.png").exists())
        self.assertTrue(all(not (self.root / x["path"]).exists() for x in plan["delete"]))
        self.assertTrue(p.with_suffix(".receipt.json").exists())

    def test_notice_symlink_rejected_before_deletion(self):
        p = self.manifest()
        outside = self.root / "web/keep"
        outside.write_text("safe")
        (self.root / "target/a/RETENTION-PRUNED-plan.md").symlink_to(outside)
        with self.assertRaises(ValueError):
            r.apply(p, r.sha(p))
        self.assertEqual(outside.read_text(), "safe")
        self.assertEqual(len(list((self.root / "target/a").glob("frame-*.png"))), 8)

    def test_unadmitted_recording_and_source_preserved(self):
        self.pol['recordingRoots'] = []
        self.pol['obsoleteBuildRoots'] = ['target/build']
        self.pol['preserveFileSuffixesInObsoleteBuilds'].append('.rs')
        r.dump(self.root / 'web/retention-policy.json', self.pol)
        (self.root / 'target/build').mkdir()
        (self.root / 'target/build/source.rs').write_text('source')
        (self.root / 'target/build/output.o').write_bytes(b'object')
        p = self.manifest()
        self.assertEqual([x['path'] for x in json.loads(p.read_text())['delete']], ['target/build/output.o'])

    def test_failure_checkpoint_kept(self):
        r.dump(self.root / 'target/a/checkpoints.json', {'failed': 'frame-00003.png'})
        p = self.manifest()
        selected = {x['path'] for x in json.loads(p.read_text())['delete']}
        self.assertNotIn('target/a/frame-00003.png', selected)
        self.assertNotIn('target/a/frame-00002.png', selected)

    def test_shared_inode_counted_once_per_category(self):
        import os
        p = self.root / 'target/a/blob.bin'
        p.write_bytes(b'x' * 8192)
        (self.root / 'target/runs').mkdir()
        os.link(p, self.root / 'target/runs/blob.bin')
        u = r.usage()
        self.assertEqual(u['recordingBytes'], p.stat().st_blocks * 512)
        self.assertEqual(u['targetBytes'], p.stat().st_blocks * 512)

    def test_reservation_rejects_nonfinite_and_negative(self):
        for n in [-1, float("nan"), float("inf")]:
            with self.assertRaises(ValueError):
                r.check(n)


if __name__ == "__main__":
    unittest.main()
