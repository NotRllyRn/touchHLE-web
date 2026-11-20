// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import '../guest-saves.js';
import { encode,decode,LIMITS,createTransfer,installSaveTransfer } from '../save-transfer.mjs';
const id='org.test.app';
const record=()=>({id,schema:1,entries:[{path:'Documents',kind:'directory',mode:0o755,mtime:123},{path:'Documents/日本\\%2e.gb',kind:'file',mode:0o640,mtime:456,data:new Uint8Array([0,255,128,13,10])},{path:'Library',kind:'directory',mode:0o700,mtime:789},{path:'Library/empty',kind:'file',mode:0o600,mtime:0,data:new Uint8Array()}]});
async function wire(value,payload=new Uint8Array()) { const json=new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value));const b=new Uint8Array(44+json.length+payload.length);b.set(new TextEncoder().encode('THLESAV1'));new DataView(b.buffer).setUint32(8,json.length,true);b.set(json,12);b.set(payload,12+json.length);b.set(new Uint8Array(await crypto.subtle.digest('SHA-256',b.subarray(0,-32))),b.length-32);return b; }
const metadata=()=>({format:1,id,entries:[{path:'Documents',kind:'directory',mode:493,mtime:0}]});
test('binary paths metadata empty files roundtrip and deterministic format',async()=>{const a=record(),b=await encode(a);assert.deepEqual(await decode(b,id),a);assert.deepEqual(await encode(a),b);});
test('wrong app format checksum truncation trailing and bad magic reject',async()=>{const b=await encode(record());await assert.rejects(decode(b,'other'),/identity/);for(const bad of [b.slice(0,-1),new Uint8Array([...b,0]),new Uint8Array(44)])await assert.rejects(decode(bad,id));b[20]^=1;await assert.rejects(decode(b,id),/checksum/);const m=metadata();m.format=2;await assert.rejects(decode(await wire(m),id),/format/);});
test('strict schema duplicate keys UTF8 paths parents and entry types reject',async()=>{for(const path of ['../Documents','Documents/../bad','/Documents','Documents//bad','tmp','Documents/\0bad','Documents/missing/file']){const m=metadata();m.entries.push({path,kind:'directory',mode:493,mtime:0});await assert.rejects(decode(await wire(m),id));}for(const modify of [m=>m.extra=1,m=>m.entries.push(m.entries[0]),m=>m.entries[0].kind='symlink',m=>m.entries[0].mode=-1,m=>m.entries[0].mtime=-1,m=>m.entries[0].path='Documents/'+ 'x'.repeat(4097)]){const m=metadata();modify(m);await assert.rejects(decode(await wire(m),id));}await assert.rejects(decode(await wire('{"format":1,"format":1,"id":"org.test.app","entries":[]}'),id),/Noncanonical/);});
test('payload offsets lengths gaps and limits reject before writes',async()=>{for(const [offset,length]of [[1,1],[0,2],[-1,1],[0,-1],[0,0.5],[0,Number.MAX_SAFE_INTEGER]]){const m=metadata();m.entries.push({path:'Documents/file',kind:'file',mode:384,mtime:0,offset,length});await assert.rejects(decode(await wire(m,new Uint8Array([7])),id));}const m=metadata();m.entries=Array(LIMITS.entries+1).fill(m.entries[0]);await assert.rejects(decode(await wire(m),id),/Too many/);const b=await wire(metadata());new DataView(b.buffer).setUint32(8,LIMITS.metadata+1,true);await assert.rejects(decode(b,id),/lengths/);});
test('cancelled codec and cloned input cannot race checksum',async()=>{const a=new AbortController();a.abort();await assert.rejects(encode(record(),{signal:a.signal}),{name:'AbortError'});const b=await encode(record()),pending=decode(b,id);b.fill(0);assert.deepEqual(await pending,record());});
test('transfer refuses active sessions before lock or database and opens only under lock',async()=>{let active=true,locked=false,opened=0;const manager=createTransfer(id,{isStopped:()=>!active,acquireLock:async()=>{locked=true;return()=>locked=false;},storeFactory:async()=>{assert(locked);opened++;return{load:async()=>[],loadBackups:async()=>[],close(){assert(locked);}};}});await assert.rejects(manager.read(),/Stop/);assert.equal(opened,0);active=false;assert.equal((await manager.read()).current,null);assert.equal(locked,false);});
test('transfer rechecks active after lock acquisition and releases on DB failure',async()=>{let active=false,releases=0;const manager=createTransfer(id,{isStopped:()=>!active,acquireLock:async()=>{active=true;return()=>releases++;},storeFactory:()=>{throw Error('must not open');}});await assert.rejects(manager.read(),/Stop/);assert.equal(releases,1);const fail=createTransfer(id,{acquireLock:async()=>()=>releases++,storeFactory:async()=>{throw Error('DB denied');}});await assert.rejects(fail.read(),/DB denied/);assert.equal(releases,2);});
test('Documents and Library roots cannot be regular files',async()=>{for(const path of ['Documents','Library']){const m=metadata();m.entries=[{path,kind:'file',mode:384,mtime:0,offset:0,length:1}];await assert.rejects(decode(await wire(m,new Uint8Array([9])),id),/roots/);}});
test('UTF8 path and identifier exact boundary',async()=>{const a=record();a.entries[1].path='Documents/'+'x'.repeat(4096-10);assert.deepEqual(await decode(await encode(a),id),a);a.entries[1].path+='x';await assert.rejects(encode(a),/oversized/);const b=record();b.id='a'.repeat(1024);assert.equal((await decode(await encode(b),b.id)).id,b.id);b.id+='a';await assert.rejects(encode(b),/oversized/);});

// These are actual transfer handlers with a controlled store/lock boundary.
// Deferred release is a test schedule, not proof of real browser click timing
// or IndexedDB rollback. Keep global-dependent cases serialized and restore the
// frozen production API binding (never mutate its properties).
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

async function withTransfer(heldRelease, body) {
  const original = globalThis.TouchHLESaves;
  assert.equal(Object.isFrozen(original), true);
  const releaseEntered = deferred(), releaseDone = deferred();
  const pending = [], idleWaiters = [];
  const counts = { acquire: 0, open: 0, load: 0, backups: 0, close: 0, release: 0, replace: 0, commit: 0 };
  let locked = false, wasBusy = false, transfer, replacementSignal;
  let current = record();
  const older = record(); older.entries[1].data[0] = 17;
  let backup = { id, schema: 1, record: older };
  const snapshot = () => structuredClone({ current, backup });
  const initial = snapshot();
  class Element {
    constructor(tag) {
      this.tag = tag; this.children = []; this.attributes = {};
      this.hidden = this.disabled = false; this.textContent = ''; this.value = '';
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; delete this[name]; }
    append(...children) {
      this.children.push(...children);
      for (const child of children) if (typeof child === 'object') child.parent = this;
    }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  }
  const document = { body: new Element('body'), createElement: tag => new Element(tag) };
  globalThis.TouchHLESaves = Object.freeze({
    ...original,
    acquire: async () => {
      assert.equal(locked, false); locked = true;
      const number = ++counts.acquire;
      return async () => {
        assert.equal(locked, true); counts.release++;
        if (number === heldRelease) { releaseEntered.resolve(); await releaseDone.promise; }
        locked = false;
      };
    },
    openStore: async () => {
      assert.equal(locked, true); counts.open++;
      return {
        load: async () => { counts.load++; return structuredClone([current]); },
        loadBackups: async () => { counts.backups++; return structuredClone([backup]); },
        close() { assert.equal(locked, true); counts.close++; },
        commit() { counts.commit++; throw Error('Runtime commit must not be called'); },
        async replace(selected, next, options) {
          counts.replace++; assert.equal(selected, id); assert.equal(options.recover, undefined);
          assert.deepEqual(options.expected, current); assert.deepEqual(options.expectedBackup, backup);
          assert.equal(options.signal.aborted, false); replacementSignal = options.signal;
          original.validate([next]);
          // Model an already successful storage result; cancellation below is
          // deliberately after this return. Actual IndexedDB truth is covered
          // separately by retained024, not by this store stub.
          backup = { id, schema: 1, record: structuredClone(current) };
          current = structuredClone(next);
          return { replaced: true, recovered: false };
        },
      };
    },
  });
  try {
    transfer = installSaveTransfer({ id, document, onBusy: busy => {
      if (wasBusy && !busy) for (const done of idleWaiters.splice(0)) done();
      wasBusy = busy;
    } });
    const children = document.body.children[0].children.filter(child => typeof child === 'object');
    const button = text => children.find(child => child.tag === 'button' && child.textContent === text);
    const controls = {
      recover: button('Recover previous saved files'), cancel: button('Cancel transfer'),
      confirm: button(''), picker: children.find(child => child.tag === 'input'),
      status: children.find(child => child.attributes.role === 'status'),
    };
    await body({ ...controls, transfer, counts, initial, snapshot,
      releaseEntered: releaseEntered.promise, release: releaseDone.resolve,
      track(promise) { pending.push(promise); return promise; },
      idle() { return new Promise(done => idleWaiters.push(done)); },
      get replacementSignal() { return replacementSignal; },
    });
  } finally {
    releaseDone.resolve();
    try { await Promise.allSettled(pending); transfer?.dispose(); }
    finally { globalThis.TouchHLESaves = original; }
    assert.equal(globalThis.TouchHLESaves, original);
    assert.equal(locked, false);
    assert.equal(document.body.children.length, 0);
  }
}

test('actual recovery preview: cancellation during deferred read-lock release stays cancelled',
  { concurrency: false, timeout: 5000 }, async () => {
    await withTransfer(1, async f => {
      const operation = f.track(f.recover.onclick());
      await f.releaseEntered;
      assert.equal(f.transfer.busy, true); assert.equal(f.cancel.hidden, false);
      assert.equal(f.cancel.disabled, false); assert.equal(f.confirm.hidden, true);
      assert.deepEqual(f.counts, { acquire: 1, open: 1, load: 1, backups: 1, close: 1, release: 1, replace: 0, commit: 0 });
      f.cancel.onclick();
      assert.equal(f.transfer.busy, true); assert.equal(f.confirm.hidden, true);
      f.release(); await operation;
      assert.equal(f.confirm.hidden, true); assert.equal(f.cancel.hidden, true);
      assert.equal(f.transfer.busy, false); assert.equal(f.recover.disabled, false);
      assert.equal(f.status.textContent, 'Transfer cancelled. No replacement was committed.');
      assert.deepEqual(f.snapshot(), f.initial);
      assert.deepEqual(f.counts, { acquire: 1, open: 1, load: 1, backups: 1, close: 1, release: 1, replace: 0, commit: 0 });
    });
  });

test('actual recovery preview: uncancelled read publishes only after lock release and does not write',
  { concurrency: false, timeout: 5000 }, async () => {
    await withTransfer(1, async f => {
      const operation = f.track(f.recover.onclick());
      await f.releaseEntered;
      assert.equal(f.transfer.busy, true); assert.equal(f.confirm.hidden, true);
      f.release(); await operation;
      assert.equal(f.transfer.busy, false); assert.equal(f.confirm.hidden, false);
      assert.equal(f.confirm.disabled, false); assert.equal(f.cancel.hidden, false);
      assert.equal(f.confirm.textContent, 'Confirm recovery and back up current files');
      assert.match(f.status.textContent, /Recovery replaces current files with the backup/);
      assert.deepEqual(f.snapshot(), f.initial);
      assert.deepEqual(f.counts, { acquire: 1, open: 1, load: 1, backups: 1, close: 1, release: 1, replace: 0, commit: 0 });
    });
  });

test('actual confirmed import: cancellation after successful replacement retains committed-success truth',
  { concurrency: false, timeout: 5000 }, async () => {
    await withTransfer(2, async f => {
      const next = record(); next.entries[1].data[0] = 42;
      const bytes = await encode(next), previewDone = f.idle();
      f.picker.files = [{ size: bytes.length, arrayBuffer: async () => bytes.slice().buffer }];
      f.picker.onchange(); await previewDone;
      assert.equal(f.confirm.hidden, false); assert.equal(f.transfer.busy, false);
      assert.equal(f.confirm.textContent, 'Replace saved files and keep one backup');
      const operation = f.track(f.confirm.onclick());
      await f.releaseEntered;
      assert.equal(f.transfer.busy, true); assert.equal(f.confirm.hidden, true);
      assert.equal(f.replacementSignal.aborted, false);
      const committed = { current: next, backup: { id, schema: 1, record: f.initial.current } };
      assert.deepEqual(f.snapshot(), committed);
      f.cancel.onclick(); assert.equal(f.replacementSignal.aborted, true);
      f.release(); await operation;
      assert.equal(f.transfer.busy, false); assert.equal(f.confirm.hidden, true);
      assert.equal(f.cancel.hidden, true);
      assert.equal(f.status.textContent, 'Saved files replaced atomically. The previous committed files are available as the recovery backup. Start the app to restore these files.');
      assert.deepEqual(f.snapshot(), committed);
      assert.deepEqual(f.counts, { acquire: 2, open: 2, load: 1, backups: 1, close: 2, release: 2, replace: 1, commit: 0 });
    });
  });
