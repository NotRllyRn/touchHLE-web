# SPDX-License-Identifier: MPL-2.0
import ctypes
import cmath
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave
import zipfile

import prepare_audio as prep


def synthesize(path, rate=44100, channels=2, frames=4800, tag=None):
    # Original synthetic sine wave; public libsndfile encoder API, no app assets.
    decoder = prep.Decoder(); lib = decoder.lib
    lib.sf_writef_float.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_float), ctypes.c_int64]
    lib.sf_writef_float.restype = ctypes.c_int64
    lib.sf_set_string.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_char_p]
    lib.sf_set_string.restype = ctypes.c_int
    info = prep.SFInfo(0, rate, channels, 0x200060, 0, 0)
    handle = lib.sf_open(str(path).encode(), 0x20, ctypes.byref(info))
    if not handle: raise RuntimeError(lib.sf_strerror(None))
    try:
        if tag is not None: assert lib.sf_set_string(handle, 1, tag.encode()) == 0
        values = (ctypes.c_float * (frames * channels))(*(
            .2 * math.sin(2 * math.pi * (440 + 110 * channel) * frame / rate)
            for frame in range(frames) for channel in range(channels)))
        assert lib.sf_writef_float(handle, values, frames) == frames
    finally:
        assert lib.sf_close(handle) == 0
    data = path.read_bytes()
    if tag is None:
        # libsndfile writes ENCODER even without user tags. Remove that known
        # synthetic fixture tag, leaving the production empty-comments policy.
        first_size = 27 + data[26] + sum(data[27:27 + data[26]])
        at = first_size; count = data[at + 26]
        lacing = bytearray(data[at + 27:at + 27 + count]); body_at = at + 27 + count
        end = body_at + sum(lacing); comment = data[body_at:body_at + lacing[0]]
        assert comment[:7] == b'\x03vorbis' and lacing[0] < 255
        vendor_size = struct.unpack_from('<I', comment, 7)[0]; cursor = 11 + vendor_size
        assert comment[cursor:] == struct.pack('<II',1,18) + b'ENCODER=libsndfile' + b'\x01'
        replacement = comment[:cursor] + struct.pack('<I',0) + b'\x01'
        body = replacement + data[body_at + lacing[0]:end]; lacing[0] = len(replacement)
        page = bytearray(data[at:at+27]) + lacing + body; page[22:26] = bytes(4)
        struct.pack_into('<I',page,22,prep.ogg_crc(page))
        data = data[:at] + page + data[end:]; path.write_bytes(data)
    return data


class PreparationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(); cls.root = Path(cls.tmp.name)
        cls.stereo = synthesize(cls.root / 'stereo.ogg')
        cls.mono = synthesize(cls.root / 'mono.ogg', rate=22050, channels=1, frames=1172)
        cls.tagged = synthesize(cls.root / 'tagged.ogg', tag='Preserve this title')

    @classmethod
    def tearDownClass(cls): cls.tmp.cleanup()

    def setUp(self):
        self.tmp_case = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp_case.cleanup)
        self.work = Path(self.tmp_case.name); self.source = self.work / 'owned game.ipa'
        self.entries = {'Payload/test.app/sound.ogg': self.stereo,
                        'Payload/test.app/short.ogg': self.mono,
                        'Payload/test.app/unchanged.txt': b'unchanged\x00content'}
        with zipfile.ZipFile(self.source, 'w') as z:
            z.comment = b'archive comment'
            for name, data in self.entries.items():
                info = zipfile.ZipInfo(name, (2020, 1, 2, 3, 4, 6))
                info.compress_type = zipfile.ZIP_DEFLATED; info.external_attr = 0o100644 << 16
                info.comment = b'entry comment'; z.writestr(info, data)

    def test_real_stereo_roundtrip_and_unchanged_entries(self):
        before = self.source.read_bytes(); output = self.work / 'new output'
        r = prep.prepare(self.source, output, [next(iter(self.entries))])
        self.assertEqual(r['changedEntries'], 1); self.assertEqual(r['unchangedEntries'], 2)
        self.assertEqual(self.source.read_bytes(), before)
        self.assertEqual(r, json.loads((output / 'audio-preparation.json').read_text()))
        self.assertEqual(r['sha256'], hashlib.sha256((output / 'prepared.ipa').read_bytes()).hexdigest())
        with zipfile.ZipFile(self.source) as a, zipfile.ZipFile(output / 'prepared.ipa') as b:
            self.assertEqual(a.namelist(), b.namelist()); self.assertEqual(a.comment, b.comment)
            for name in self.entries:
                self.assertEqual(a.getinfo(name).date_time, b.getinfo(name).date_time)
                self.assertEqual(a.getinfo(name).external_attr, b.getinfo(name).external_attr)
                self.assertEqual(a.getinfo(name).comment, b.getinfo(name).comment)
                if name != next(iter(self.entries)): self.assertEqual(a.read(name), b.read(name))
            data = b.read(next(iter(self.entries)))
            self.assertEqual(data[:4], b'RIFF'); self.assertEqual(len(data), 44 + 4800 * 2 * 2)
            self.assertEqual(struct.unpack_from('<HHIIHH', data, 20), (1, 2, 44100, 176400, 4, 16))
            self.assertTrue(any(data[44:]))
            samples=struct.unpack('<9600h',data[44:])
            def energy(channel,frequency):
                return abs(sum(x*cmath.exp(-2j*math.pi*frequency*i/44100)
                               for i,x in enumerate(samples[channel::2])))
            self.assertGreater(energy(0,440),10*energy(0,550))
            self.assertGreater(energy(1,550),10*energy(1,440))

    def test_short_mono_exact_granule_frames(self):
        r = prep.prepare(self.source, self.work / 'mono', ['Payload/test.app/short.ogg'])
        self.assertEqual(r['entries'][0]['frames'], 1172)
        self.assertEqual(r['entries'][0]['outputBytes'], 44 + 1172 * 2)
        self.assertEqual(r['entries'][0]['rate'], 22050)

    def test_budget_selection_and_existing_output_reject_before_write(self):
        out = self.work / 'out'
        for entries, budget in [(['missing.ogg'], prep.MIB),
                                (['Payload/test.app/sound.ogg'] * 2, prep.MIB),
                                (['Payload/test.app/sound.ogg'], 0)]:
            with self.assertRaises(ValueError): prep.prepare(self.source, out, entries, budget)
            self.assertFalse(out.exists())
        out.mkdir(); (out / 'sentinel').write_text('preserve')
        with self.assertRaises(ValueError): prep.prepare(self.source, out, ['Payload/test.app/sound.ogg'])
        self.assertEqual((out / 'sentinel').read_text(), 'preserve')

    def test_crc_truncation_chain_and_tags_reject(self):
        corrupt = bytearray(self.stereo); corrupt[-1] ^= 1
        for data in [corrupt, self.stereo[:-1], self.stereo + self.stereo, self.tagged]:
            with self.assertRaises(ValueError): prep.vorbis_info(data)
        self.assertEqual(prep.vorbis_info(self.stereo), dict(frames=4800, rate=44100, channels=2))

    def test_decoder_failure_does_not_publish_output(self):
        out = self.work / 'failed'; before = self.source.read_bytes()
        with patch.object(prep.Decoder, 'decode', side_effect=RuntimeError('deliberate decode failure')):
            with self.assertRaises(RuntimeError): prep.prepare(self.source, out, ['Payload/test.app/sound.ogg'])
        self.assertFalse((out / 'prepared.ipa').exists())
        self.assertFalse((out / 'audio-preparation.json').exists())
        self.assertEqual(list(out.iterdir()), [])
        self.assertEqual(self.source.read_bytes(), before)

    def test_repository_output_and_symlink_escape_rejected(self):
        repo = Path(prep.__file__).resolve().parents[2]
        out = repo/'web'/'audio-preparation-test-must-not-create'
        with self.assertRaisesRegex(ValueError, 'ignored target'):
            prep.prepare(self.source, out, ['Payload/test.app/sound.ogg'])
        self.assertFalse(out.exists())
        with tempfile.TemporaryDirectory(dir=repo/'target') as directory:
            link=Path(directory)/'outside'; link.symlink_to(repo/'web', target_is_directory=True)
            with self.assertRaisesRegex(ValueError, 'ignored target'):
                prep.prepare(self.source, link/'audio-preparation-test-must-not-create', ['Payload/test.app/sound.ogg'])
        self.assertFalse(out.exists())

    def test_cli(self):
        out = self.work / 'cli output'
        run = subprocess.run([sys.executable, str(Path(prep.__file__)), str(self.source), str(out),
                              '--entry', 'Payload/test.app/short.ogg'], capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(json.loads(run.stdout)['changedEntries'], 1)


if __name__ == '__main__': unittest.main()
