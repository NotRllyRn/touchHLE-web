// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectBytes } from '../preflight.mjs';

// Stored ZIP with real CRCs: independent fixture exercises the Rust/WASM ABI.
function archive(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [path, bytes] of entries) {
    const name = Buffer.from(path), data = Buffer.from(bytes);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50); dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42); central.push(dir, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
function fixture(encrypted = false) {
  const binary = Buffer.alloc(48);
  [0xfeedface, 12, 9, 2, 1, 20, 0, 0x21, 20, 0, 0, Number(encrypted)]
    .forEach((word, i) => binary.writeUInt32LE(word, i * 4));
  return archive([
    ['Payload/Test.app/Info.plist', '<plist version="1.0"><dict><key>CFBundleExecutable</key><string>Test</string><key>CFBundleIdentifier</key><string>org.example.test</string></dict></plist>'],
    ['Payload/Test.app/Test', binary],
  ]);
}
const wasm = await readFile(new URL('../dist/touchhle_browser.wasm', import.meta.url));
async function runtime() { return (await WebAssembly.instantiate(wasm, {})).instance.exports; }

test('sparse memory checks execute in WASM', async () => {
  assert.equal((await runtime()).memory_check(), 1);
});

test('actual WASM accepts ARM IPA and rejects encryption and invalid ZIP', async () => {
  const exports = await runtime();
  const result = inspectBytes(exports, fixture());
  assert.equal(result.app.bundleId, 'org.example.test');
  assert.equal(result.app.status, 'validated-not-executed');
  assert.match(inspectBytes(exports, fixture(true)).error, /Encrypted/);
  assert.equal(inspectBytes(exports, Buffer.from('invalid')).ok, false);
  assert.match(inspectBytes(exports, archive([['../bad', 'x']])).error, /Unsafe/);
});

test('ABI releases input/results across repeated imports and memory growth', async () => {
  const exports = await runtime();
  const bytes = fixture();
  for (let i = 0; i < 20; i++) assert.equal(inspectBytes(exports, bytes).ok, true);
  const size = exports.memory.buffer.byteLength;
  for (let i = 0; i < 100; i++) assert.equal(inspectBytes(exports, bytes).ok, true);
  assert.equal(exports.memory.buffer.byteLength, size);
  assert.equal(inspectBytes(exports, new Uint8Array(8 * 1024 * 1024)).ok, false);
  assert.equal(inspectBytes(exports, bytes).ok, true);
});
