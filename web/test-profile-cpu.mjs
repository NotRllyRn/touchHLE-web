// SPDX-License-Identifier: MPL-2.0
// Exercise diagnostic instrumentation through the real ARM/Thumb adapter suite.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { TciProfile } from './tci-profile.mjs';
const require = createRequire(import.meta.url), create = require('./dist/shared-cpu-checks.js');
const compiler = new vm.Script(await readFile(new URL('./tci-jit.js', import.meta.url), 'utf8'));
const profile = new TciProfile({ counts: true });
const logs = [];
const result = await create({ enableTciJit: true, tciJitThreshold: 1,
  preRun: [() => { compiler.runInThisContext(); TouchHLETciJit.profile = profile; }],
  print: message => logs.push(message), printErr: message => console.error(message) });
console.log(logs.filter(message => message.startsWith('PASS')).join('\n'));
assert.ok(logs.some(message => message.startsWith('PASS')));
assert.equal(result.tciJit.stats.failed, 0, result.tciJit.stats.lastFailure);
const snapshot = profile.snapshot();
assert.equal(snapshot.dropped, 0);
assert.ok(snapshot.blocks.every(block => block.guestMap?.length > 0), 'Missing live ARM metadata');
assert.ok(snapshot.blocks.every(block => !block.guestMapError), JSON.stringify(snapshot.blocks.filter(block => block.guestMapError).slice(0, 3)));
assert.ok(snapshot.blocks.some(block => block.guestMap.some(row => row.thumb)), 'Missing Thumb map');
assert.ok(snapshot.blocks.some(block => block.guestMap.some(row => !row.thumb)), 'Missing ARM map');
assert.ok(snapshot.blocks.some(block => block.entries > 1));
assert.ok(snapshot.opcodes.exit_tb > 0);
console.log(JSON.stringify({ blocks: snapshot.blocks.length, opcodes: snapshot.opcodes, stats: result.tciJit.stats }));
console.log('PASS instrumented real CPU/fiber/cache suite');
