# SPDX-License-Identifier: MPL-2.0
"""Optional local Ogg/Vorbis -> PCM16 WAV preparation; no runtime dependency."""
import argparse
import array
import copy
import ctypes
import ctypes.util
import hashlib
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import wave
import zipfile

MIB = 1024 * 1024
MAX_IPA = 256 * MIB
MAX_EXPANDED = 512 * MIB
MAX_PCM = 64 * MIB
MAX_AUDIO_INPUT = 32 * MIB


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest_file(file):
    h = hashlib.sha256()
    for block in iter(lambda: file.read(MIB), b''):
        h.update(block)
    return h.hexdigest()


CRC_TABLE = []
for byte in range(256):
    value = byte << 24
    for _ in range(8):
        value = ((value << 1) ^ (0x04C11DB7 if value & 0x80000000 else 0)) & 0xFFFFFFFF
    CRC_TABLE.append(value)


def ogg_crc(data):
    value = 0
    for byte in data:
        value = ((value << 8) & 0xFFFFFFFF) ^ CRC_TABLE[(value >> 24) ^ byte]
    return value


def vorbis_info(data):
    """Admit one complete stream with empty comments; preserve no hidden loop tags."""
    require(0 < len(data) <= MAX_AUDIO_INPUT, 'selected audio input size limit')
    offset = sequence = 0
    serial = None
    partial = bytearray()
    packet_count = 0
    headers = []
    unfinished = False
    last_granule = 0
    eos = False
    while offset < len(data):
        require(not eos and offset + 27 <= len(data), 'truncated/chained Ogg stream')
        require(data[offset:offset + 5] == b'OggS\x00', 'expected Ogg version 0')
        flags = data[offset + 5]
        granule, page_serial, page_sequence, crc = struct.unpack_from('<QIII', data, offset + 6)
        count = data[offset + 26]
        require(offset + 27 + count <= len(data), 'truncated Ogg lacing')
        lacing = data[offset + 27:offset + 27 + count]
        end = offset + 27 + count + sum(lacing)
        require(end <= len(data), 'truncated Ogg page')
        page = bytearray(data[offset:end]); page[22:26] = bytes(4)
        require(ogg_crc(page) == crc, 'Ogg checksum mismatch')
        require(flags & ~7 == 0 and bool(flags & 1) == unfinished, 'Ogg continuation flags')
        require(page_sequence == sequence, 'Ogg page sequence')
        require(bool(flags & 2) == (sequence == 0), 'Ogg beginning-of-stream flag')
        if serial is None:
            serial = page_serial
        require(page_serial == serial, 'multiplexed Ogg streams unsupported')
        if granule != 0xFFFFFFFFFFFFFFFF:
            require(granule >= last_granule, 'Ogg granules decrease')
            last_granule = granule
        body = offset + 27 + count
        for length in lacing:
            if packet_count < 2:
                partial += data[body:body + length]
                require(len(partial) <= MIB, 'Vorbis header size limit')
            body += length
            unfinished = length == 255
            if not unfinished:
                if packet_count < 2:
                    headers.append(bytes(partial)); partial.clear()
                packet_count += 1
        eos = bool(flags & 4)
        if eos:
            require(not unfinished and granule != 0xFFFFFFFFFFFFFFFF, 'incomplete Ogg end')
        sequence += 1
        offset = end
    require(eos and packet_count >= 3 and len(headers) == 2, 'incomplete Vorbis stream')
    first, comments = headers
    require(len(first) == 30 and first[:7] == b'\x01vorbis', 'Vorbis identification packet')
    require(struct.unpack_from('<I', first, 7)[0] == 0 and first[29] == 1, 'Vorbis version/framing')
    channels = first[11]
    rate = struct.unpack_from('<I', first, 12)[0]
    require(channels in (1, 2) and 8000 <= rate <= 192000, 'supported mono/stereo sample rate required')
    require(6 <= (first[28] & 15) <= (first[28] >> 4) <= 13, 'Vorbis block sizes')
    require(comments[:7] == b'\x03vorbis' and len(comments) >= 16, 'Vorbis comments packet')
    vendor_size = struct.unpack_from('<I', comments, 7)[0]
    cursor = 11 + vendor_size
    require(cursor + 5 == len(comments), 'nonempty or malformed Vorbis comments unsupported')
    require(struct.unpack_from('<I', comments, cursor)[0] == 0 and comments[-1] == 1,
            'Vorbis tags/loop metadata unsupported; keep this entry unchanged')
    require(0 < last_granule * channels * 2 <= MAX_PCM, 'decoded audio size limit')
    return dict(frames=last_granule, rate=rate, channels=channels)


class SFInfo(ctypes.Structure):
    # Public libsndfile SF_INFO ABI; SNDFILE remains opaque.
    _fields_ = [('frames', ctypes.c_int64), ('samplerate', ctypes.c_int),
                ('channels', ctypes.c_int), ('format', ctypes.c_int),
                ('sections', ctypes.c_int), ('seekable', ctypes.c_int)]


class Decoder:
    def __init__(self):
        name = ctypes.util.find_library('sndfile')
        require(name is not None, 'Install host libsndfile to use optional audio preparation')
        self.lib = lib = ctypes.CDLL(name)
        signatures = {
            'sf_version_string': ([], ctypes.c_char_p),
            'sf_open': ([ctypes.c_char_p, ctypes.c_int, ctypes.POINTER(SFInfo)], ctypes.c_void_p),
            'sf_readf_short': ([ctypes.c_void_p, ctypes.POINTER(ctypes.c_int16), ctypes.c_int64], ctypes.c_int64),
            'sf_error': ([ctypes.c_void_p], ctypes.c_int),
            'sf_strerror': ([ctypes.c_void_p], ctypes.c_char_p),
            'sf_close': ([ctypes.c_void_p], ctypes.c_int),
        }
        for function, (args, result) in signatures.items():
            getattr(lib, function).argtypes = args
            getattr(lib, function).restype = result
        self.version = lib.sf_version_string().decode('utf-8')

    def decode(self, source, output, expected):
        info = SFInfo()
        handle = self.lib.sf_open(os.fsencode(source), 0x10, ctypes.byref(info))
        require(handle, 'libsndfile open: ' + self.lib.sf_strerror(None).decode('utf-8', 'replace'))
        try:
            require(info.format == 0x200060 and info.sections == 1, 'single Ogg/Vorbis section required')
            require((info.frames, info.channels, info.samplerate) ==
                    (expected['frames'], expected['channels'], expected['rate']), 'decoder/header disagreement')
            block = (ctypes.c_int16 * (8192 * info.channels))()
            frames = 0
            with wave.open(str(output), 'wb') as wav:
                wav.setnchannels(info.channels); wav.setsampwidth(2); wav.setframerate(info.samplerate)
                while True:
                    count = self.lib.sf_readf_short(handle, block, 8192)
                    require(0 <= count <= 8192, 'decoder block count')
                    if count == 0:
                        break
                    frames += count
                    require(frames <= info.frames, 'decoder emitted excess frames')
                    pcm = ctypes.string_at(ctypes.addressof(block), count * info.channels * 2)
                    if sys.byteorder != 'little':
                        samples = array.array('h'); samples.frombytes(pcm); samples.byteswap(); pcm = samples.tobytes()
                    wav.writeframesraw(pcm)
            require(self.lib.sf_error(handle) == 0, 'libsndfile decode error')
            require(frames == info.frames, 'decoder emitted too few frames; no padding/trimming performed')
        finally:
            require(self.lib.sf_close(handle) == 0, 'libsndfile close error')
        with wave.open(str(output), 'rb') as wav:
            require((wav.getnframes(), wav.getnchannels(), wav.getframerate(), wav.getsampwidth()) ==
                    (expected['frames'], expected['channels'], expected['rate'], 2), 'WAV framing mismatch')
        require(output.stat().st_size == 44 + expected['frames'] * expected['channels'] * 2, 'canonical WAV size')


def prepare(source, destination, entries, max_increase=64 * MIB):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    repository = Path(__file__).resolve().parents[2]
    require(not destination.is_relative_to(repository) or destination.is_relative_to(repository / 'target'),
            'repository output must stay under ignored target/; external output is allowed')
    require(entries and len(entries) == len(set(entries)), 'select distinct entries explicitly')
    require(0 <= max_increase <= MAX_EXPANDED, 'expanded increase limit')
    require(source.is_file() and 0 < source.stat().st_size <= MAX_IPA, 'IPA input size limit')
    require(destination.parent.is_dir() and not destination.exists(), 'output directory must be new with existing parent')
    decoder = Decoder()
    with source.open('rb') as source_file:
        original_hash = digest_file(source_file); source_file.seek(0)
        with zipfile.ZipFile(source_file) as archive:
            infos = archive.infolist(); names = [i.filename for i in infos]
            require(len(names) <= 65536 and len(names) == len(set(names)), 'duplicate/excessive ZIP entries')
            require(set(entries) <= set(names), 'selected entry missing from IPA')
            require(all(not i.flag_bits & 1 and i.compress_type in (0, 8) for i in infos), 'unsupported ZIP compression/encryption')
            expanded = sum(i.file_size for i in infos)
            require(expanded <= MAX_EXPANDED, 'expanded IPA size limit')
            selected = []
            for name in entries:
                info = archive.getinfo(name)
                require(not info.is_dir() and info.file_size <= MAX_AUDIO_INPUT, 'selected audio size/type')
                data = archive.read(name)
                metadata = vorbis_info(data)
                selected.append((name, data, metadata))
            increase = sum(44 + m['frames'] * m['channels'] * 2 - len(b) for _, b, m in selected)
            require(increase <= max_increase and expanded + increase <= MAX_EXPANDED, 'expanded audio/IPA budget exceeded')
            destination.mkdir()
            with tempfile.TemporaryDirectory(prefix='.audio-work-', dir=destination) as work_name:
                work = Path(work_name); replacements = {}; records = []
                for index, (name, data, metadata) in enumerate(selected):
                    encoded = work / f'{index}.ogg'; wav = work / f'{index}.wav'; encoded.write_bytes(data)
                    decoder.decode(encoded, wav, metadata)
                    with wav.open('rb') as file: wav_hash = digest_file(file)
                    replacements[name] = wav
                    records.append(dict(entry=name, **metadata, inputBytes=len(data), outputBytes=wav.stat().st_size,
                                        inputSha256=hashlib.sha256(data).hexdigest(), outputSha256=wav_hash))
                expected = {}
                staging = work / 'prepared.ipa'
                with zipfile.ZipFile(staging, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
                    output.comment = archive.comment
                    for info in infos:
                        copied = copy.copy(info)
                        if info.filename in replacements:
                            copied.file_size = replacements[info.filename].stat().st_size
                        h = hashlib.sha256()
                        with (replacements[info.filename].open('rb') if info.filename in replacements else archive.open(info)) as inp:
                            with output.open(copied, 'w') as out:
                                for chunk in iter(lambda: inp.read(MIB), b''):
                                    h.update(chunk); out.write(chunk)
                        expected[info.filename] = h.hexdigest()
                require(staging.stat().st_size <= MAX_IPA, 'prepared IPA exceeds packager input limit')
                with zipfile.ZipFile(staging) as check:
                    require(check.namelist() == names and check.comment == archive.comment, 'ZIP entry/comment mismatch')
                    for info in check.infolist():
                        with check.open(info) as file: require(digest_file(file) == expected[info.filename], 'output entry mismatch')
                source_file.seek(0); require(digest_file(source_file) == original_hash, 'source changed during preparation')
                with staging.open('rb') as file: prepared_hash = digest_file(file)
                report = dict(format=1, source=str(source), sourceSha256=original_hash, output='prepared.ipa',
                              sha256=prepared_hash, bytes=staging.stat().st_size, decoder=decoder.version,
                              expandedIncreaseBytes=increase, maxExpandedIncreaseBytes=max_increase,
                              changedEntries=len(records), unchangedEntries=len(infos) - len(records), entries=records,
                              limits='Selected paths contain PCM16 WAV. No resampling or frame padding/trimming. '
                                     'PCM16 rounding may differ from guest decoding. Per-game content recognition and playback '
                                     'require validation; source signatures are stale. Capture/package this new IPA identity.')
                staging.replace(destination / 'prepared.ipa')
                (destination / 'audio-preparation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output_directory', type=Path)
    parser.add_argument('--entry', action='append', required=True, help='exact ZIP entry to convert; repeat to select more')
    parser.add_argument('--max-expanded-increase-mib', type=int, default=64)
    args = parser.parse_args()
    try:
        report = prepare(args.source, args.output_directory, args.entry, args.max_expanded_increase_mib * MIB)
    except (ValueError, OSError, RuntimeError, zipfile.BadZipFile, wave.Error) as error:
        parser.exit(1, f'Audio preparation failed: {error}\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
