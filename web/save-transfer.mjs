// SPDX-License-Identifier: MPL-2.0
// Caller installs checked guest-saves.js first. No imports or network access.
const MAGIC = new TextEncoder().encode('THLESAV1');
export const LIMITS = Object.freeze({ payload: 128 * 1024 * 1024, metadata: 4 * 1024 * 1024,
  entries: 32768, path: 4096, id: 1024, file: 132 * 1024 * 1024 + 44 });
const utf8 = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const cancelled = signal => { if (signal?.aborted) throw new DOMException('Transfer cancelled', 'AbortError'); };
function keys(object, expected) {
  if (!object || typeof object !== 'object' || Array.isArray(object) ||
      Object.keys(object).sort().join(',') !== [...expected].sort().join(',')) throw Error('Invalid save schema fields');
}
function text(value, cap) {
  if (typeof value !== 'string' || !value.length || value.length > cap || utf8.encode(value).length > cap || decoder.decode(utf8.encode(value)) !== value)
    throw Error('Invalid or oversized save name');
  return value;
}
export function appId(id) {
  text(id, LIMITS.id);
  if (id === '.' || id === '..' || id.includes('/') || id.includes('\0')) throw Error('Invalid app identity');
  return id;
}
function recordCheck(record) {
  keys(record, ['id', 'schema', 'entries']); appId(record.id);
  globalThis.TouchHLESaves.validate([record]);
  for (const entry of record.entries) {
    text(entry.path, LIMITS.path);
    if (['Documents', 'Library'].includes(entry.path) && entry.kind !== 'directory') throw Error('Save roots must be directories');
    keys(entry, entry.kind === 'file' ? ['path','kind','mode','mtime','data'] : ['path','kind','mode','mtime']);
  }
  return record;
}
function manifest(record) {
  recordCheck(record); let offset = 0;
  const entries = record.entries.map(({ path, kind, mode, mtime, data }) => {
    const result = { path, kind, mode, mtime };
    if (kind === 'file') { result.offset = offset; result.length = data.length; offset += data.length; }
    return result;
  });
  const bytes = utf8.encode(JSON.stringify({ format: 1, id: record.id, entries }));
  if (bytes.length > LIMITS.metadata) throw Error('Save manifest exceeds 4 MiB');
  return { bytes, payload: offset };
}
export async function encode(record, { signal } = {}) {
  cancelled(signal); record = structuredClone(record);
  const { bytes, payload } = manifest(record), output = new Uint8Array(12 + bytes.length + payload + 32);
  output.set(MAGIC); new DataView(output.buffer).setUint32(8, bytes.length, true); output.set(bytes, 12);
  let offset = 12 + bytes.length;
  for (const entry of record.entries) if (entry.kind === 'file') { output.set(entry.data, offset); offset += entry.data.length; }
  output.set(new Uint8Array(await crypto.subtle.digest('SHA-256', output.subarray(0, offset))), offset);
  cancelled(signal); return output;
}
export async function decode(input, expectedId, { signal } = {}) {
  appId(expectedId); cancelled(signal);
  if (!(input instanceof Uint8Array) || input.byteLength < 44 || input.byteLength > LIMITS.file) throw Error('Invalid or oversized save file');
  const bytes = input.slice(); // Own bytes across asynchronous digest; caller cannot race validation.
  if (!MAGIC.every((b,i) => bytes[i] === b)) throw Error('Unsupported save format');
  const length = new DataView(bytes.buffer).getUint32(8, true), end = bytes.length - 32;
  if (!length || length > LIMITS.metadata || 12 + length > end || end - 12 - length > LIMITS.payload) throw Error('Invalid save lengths');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.subarray(0,end)));
  if (!digest.every((b,i) => bytes[end+i] === b)) throw Error('Save checksum mismatch or truncated data');
  cancelled(signal);
  const source = decoder.decode(bytes.subarray(12,12+length)), parsed = JSON.parse(source);
  if (JSON.stringify(parsed) !== source) throw Error('Noncanonical or duplicate save fields');
  keys(parsed,['format','id','entries']);
  if (parsed.format !== 1 || parsed.id !== expectedId) throw Error('Save format or app identity does not match the selected app');
  if (!Array.isArray(parsed.entries) || parsed.entries.length > LIMITS.entries) throw Error('Too many save entries');
  let cursor = 0;
  const entries = parsed.entries.map(entry => {
    keys(entry, entry.kind === 'file' ? ['path','kind','mode','mtime','offset','length'] : ['path','kind','mode','mtime']);
    const value = { path: entry.path, kind: entry.kind, mode: entry.mode, mtime: entry.mtime };
    if (entry.kind === 'file') {
      if (!Number.isSafeInteger(entry.offset) || entry.offset !== cursor || !Number.isSafeInteger(entry.length) || entry.length < 0 || entry.length > end - 12 - length - cursor)
        throw Error('Invalid or overlapping save payload');
      value.data = bytes.slice(12+length+cursor,12+length+cursor+entry.length); cursor += entry.length;
    }
    return value;
  });
  if (cursor !== end-12-length) throw Error('Trailing or missing save payload');
  return recordCheck({ id: parsed.id, schema: 1, entries });
}
export function size(record) {
  return { bytes: record?.entries.reduce((n,e) => n + (e.kind === 'file' ? e.data.length : 0), 0) ?? 0,
    entries: record?.entries.length ?? 0 };
}
export function createTransfer(id, { storeFactory = () => globalThis.TouchHLESaves.openStore(),
  acquireLock = () => globalThis.TouchHLESaves.acquire(), isStopped = () => true } = {}) {
  appId(id);
  const stopped = () => { if (!isStopped()) throw Error('Stop the app and wait for saved progress before transferring files'); };
  const locked = async (operation, signal) => {
    stopped(); cancelled(signal); const release = await acquireLock(); let store;
    try { stopped(); cancelled(signal); store = await storeFactory(); return await operation(store); }
    finally { store?.close(); await release(); }
  };
  const read = signal => locked(async store => {
    const apps = globalThis.TouchHLESaves.validate(await store.load());
    const backups = globalThis.TouchHLESaves.validateBackups(await store.loadBackups());
    cancelled(signal); stopped();
    return { current: apps.find(r=>r.id===id) ?? null, backup: backups.find(r=>r.id===id) ?? null,
      currentTotal: apps.reduce((n,r)=>n+size(r).bytes,0), backupTotal: backups.reduce((n,r)=>n+size(r.record).bytes,0) };
  }, signal);
  return {
    id, read,
    async export(backup = false, { signal } = {}) {
      const snapshot = await read(signal);
      if (backup && !snapshot.backup) throw Error('No recovery backup exists for this app');
      const record = (backup ? snapshot.backup.record : snapshot.current) ?? { id, schema:1, entries:[] };
      const bytes = await encode(record, { signal }); stopped(); return bytes;
    },
    async import(record, expected, { expectedBackup, signal } = {}) {
      record = structuredClone(record); recordCheck(record); manifest(record);
      if (record.id !== id) throw Error('Save belongs to another app');
      expected = structuredClone(expected);
      return locked(store => store.replace(id, record, { expected, expectedBackup, signal }), signal);
    },
    async recover(snapshot, { signal } = {}) {
      snapshot = structuredClone(snapshot);
      return locked(store => store.replace(id, null, { expected: snapshot.current, expectedBackup: snapshot.backup, recover:true, signal }), signal);
    },
  };
}

export function installSaveTransfer({ id, document = globalThis.document, onBusy = () => {} }) {
  let active = false, busy = false, disposed = false, pending, abort, objectURL;
  const manager = createTransfer(id, { isStopped: () => !active && !disposed });
  const panel = document.createElement('section'); panel.setAttribute('aria-label', 'Saved files');
  const title = document.createElement('h2'); title.textContent = `Saved files: ${id}`;
  const info = document.createElement('p'); info.textContent = 'Stop the app before transferring files. Export contains committed Documents and Library files, not a running-state snapshot or unflushed app buffers. One recovery backup per app replaces the previous backup.';
  const status = document.createElement('p'); status.setAttribute('role','status');
  const current = document.createElement('button'); current.textContent = 'Export saved files';
  const backup = document.createElement('button'); backup.textContent = 'Export recovery backup';
  const recover = document.createElement('button'); recover.textContent = 'Recover previous saved files';
  const picker = document.createElement('input'); picker.type = 'file'; picker.accept = '.thsaves,application/octet-stream'; picker.setAttribute('aria-label','Import saved files');
  const confirm = document.createElement('button'); confirm.hidden = true;
  const cancel = document.createElement('button'); cancel.textContent = 'Cancel transfer'; cancel.hidden = true;
  const download = document.createElement('a'); download.hidden = true;
  panel.append(title, info, current, ' ', backup, ' ', recover, ' ', picker, status, confirm, ' ', cancel, download); document.body.append(panel);
  const buttons = [current,backup,recover,picker];
  const update = () => { for (const b of buttons) b.disabled = active || busy || disposed; confirm.disabled = active || busy || disposed; onBusy(busy); };
  const clearDownload = () => { if (objectURL) URL.revokeObjectURL(objectURL); objectURL = undefined; download.removeAttribute('href'); download.hidden = true; };
  const clearPending = () => { pending = undefined; confirm.hidden = true; picker.value = ''; };
  const act = async operation => {
    if (busy || active || disposed) return;
    busy = true; abort = new AbortController(); update(); cancel.hidden = false;
    try { await operation(abort.signal); }
    catch (error) { status.textContent = error.name === 'AbortError' ? 'Transfer cancelled. No replacement was committed.' : `Transfer failed: ${error.message}`; }
    finally { busy = false; abort = undefined; cancel.hidden = !pending; update(); }
  };
  const summary = snapshot => `Current ${size(snapshot.current).bytes} bytes; recovery backup ${size(snapshot.backup?.record).bytes} bytes. Across apps: current ${snapshot.currentTotal}/134217728 bytes, backups ${snapshot.backupTotal}/134217728 bytes; browser storage overhead/quota is additional.`;
  const exportFile = backupCopy => act(async signal => {
    clearPending(); clearDownload(); const bytes = await manager.export(backupCopy,{signal}); cancelled(signal);
    objectURL = URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'})); download.href = objectURL;
    download.download = id.replace(/[^a-z0-9._-]/gi,'_').slice(0,100)+(backupCopy?'-backup':'')+'.thsaves';
    download.textContent = `Download ${backupCopy?'recovery backup':'committed saved files'} (${bytes.length} bytes)`; download.hidden = false;
    status.textContent = 'Export prepared locally. Click Download to save it on your device.';
  });
  current.onclick = () => exportFile(false); backup.onclick = () => exportFile(true);
  picker.onchange = () => { const file = picker.files?.[0]; if (!file) return; void act(async signal => {
    clearPending(); clearDownload(); if (file.size > LIMITS.file) throw Error('Save file exceeds the 132 MiB format limit');
    const record = await decode(new Uint8Array(await file.arrayBuffer()),id,{signal});
    const snapshot = await manager.read(signal); cancelled(signal);
    pending = { kind:'import',record,snapshot }; confirm.textContent = 'Replace saved files and keep one backup'; confirm.hidden = false;
    status.textContent = `Validated ${size(record).bytes} bytes for ${id}. ${summary(snapshot)} Confirm replacement: current files become the recovery backup, overwriting the older backup.`;
  }); };
  recover.onclick = () => act(async signal => {
    clearPending(); clearDownload(); const snapshot = await manager.read(signal); cancelled(signal);
    if (!snapshot.backup) throw Error('No recovery backup exists for this app');
    pending = { kind:'recover',snapshot }; confirm.textContent = 'Confirm recovery and back up current files'; confirm.hidden = false;
    status.textContent = `${summary(snapshot)} Recovery replaces current files with the backup; current files become the new backup.`;
  });
  confirm.onclick = () => act(async signal => {
    if (!pending) return;
    const action = pending; clearPending();
    if (action.kind === 'import') await manager.import(action.record,action.snapshot.current,{expectedBackup:action.snapshot.backup,signal}); else await manager.recover(action.snapshot,{signal});
    // Once transaction-complete arrives this is a committed result, even if a
    // cancellation click races the UI continuation. Never claim rollback then.
    status.textContent = 'Saved files replaced atomically. The previous committed files are available as the recovery backup. Start the app to restore these files.';
  });
  cancel.onclick = () => { abort?.abort(); clearPending(); clearDownload(); if (!busy) { cancel.hidden = true; status.textContent = 'Transfer cancelled. Saved files unchanged.'; } };
  update();
  return {
    get busy() { return busy; },
    get active() { return active; },
    setActive(value) { active = value; if (active) { abort?.abort(); clearPending(); clearDownload(); status.textContent = 'App active or stopping. Wait for saved progress and Stop completion before transferring files.'; } else if (!busy) status.textContent = 'App stopped. Saved-file transfer is available.'; update(); },
    dispose() { disposed = true; abort?.abort(); clearPending(); clearDownload(); panel.remove(); update(); },
  };
}
