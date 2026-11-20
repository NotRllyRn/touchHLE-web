#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Serialize a workload and reject projected storage budget violations."""
import argparse
import fcntl
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import sys

spec = importlib.util.spec_from_file_location('retention', Path(__file__).with_name('artifact-retention.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--kind', choices=['recording', 'build'], required=True)
p.add_argument('--reserve-gib', type=float, required=True)
p.add_argument('command', nargs=argparse.REMAINDER)
a = p.parse_args()
if not math.isfinite(a.reserve_gib) or a.reserve_gib <= 0:
    p.error('reserve must be finite and positive')
cmd = a.command[1:] if a.command[:1] == ['--'] else a.command
if not cmd:
    p.error('a command is required after --')
lock = r.safe_path('target/artifact-workload.lock')
import os
with os.fdopen(os.open(lock, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600), 'w') as f:
    fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    u, pol = r.usage(), r.policy()
    reserve = a.reserve_gib * r.GIB
    errors = []
    for key, limit in [('recordingBytes','recordingLimitGiB'), ('buildCacheBytes','buildCacheLimitGiB'), ('targetBytes','targetLimitGiB')]:
        projected = u.get(key, 0) + (reserve if key == 'targetBytes' or key == {'recording':'recordingBytes','build':'buildCacheBytes'}[a.kind] else 0)
        if projected > pol[limit] * r.GIB:
            errors.append(f'{key}: projected {projected / r.GIB:.2f} GiB exceeds {pol[limit]} GiB')
    if u['freeBytes'] < reserve + pol['minimumFreeGiB'] * r.GIB:
        errors.append('projected output would consume free-space reserve')
    print(json.dumps({'before': u, 'reserveGiB': a.reserve_gib, 'errors': errors}), flush=True)
    if errors:
        sys.exit(2)
    result = subprocess.run(cmd, cwd=r.ROOT)
    print(json.dumps({'after': r.usage(), 'workloadExitCode': result.returncode}), flush=True)
    sys.exit(result.returncode)
