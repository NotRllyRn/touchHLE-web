// SPDX-License-Identifier: MPL-2.0
// Opaque guest files, not a CPU snapshot or an HTTP/compiled-code cache.
(() => {
  'use strict';
  const ROOT = '/touchHLE_sandbox';
  const DATABASE = 'touchHLE-guest-saves';
  const MAX_BYTES = 128 * 1024 * 1024, MAX_ENTRIES = 32768;
  const component = value => typeof value === 'string' && value.length > 0 &&
    value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\0');
  function validPath(path) {
    const parts = typeof path === 'string' ? path.split('/') : [];
    return ['Documents', 'Library'].includes(parts[0]) && parts.every(component);
  }
  function validate(records) {
    if (!Array.isArray(records) || records.length > MAX_ENTRIES) throw Error('Invalid saved filesystem');
    let bytes = 0, count = 0;
    const apps = new Set();
    for (const record of records) {
      if (record?.schema !== 1 || !component(record.id) || apps.has(record.id) ||
          !Array.isArray(record.entries)) throw Error('Unsupported or invalid saved app data');
      apps.add(record.id);
      const paths = new Map();
      for (const entry of record.entries) {
        if (++count > MAX_ENTRIES || !validPath(entry.path) || paths.has(entry.path) ||
            !['directory', 'file'].includes(entry.kind) || !Number.isInteger(entry.mode) ||
            entry.mode < 0 || entry.mode > 0o7777 || !Number.isFinite(entry.mtime) ||
            entry.mtime < 0 || entry.mtime > 8.64e15) throw Error('Invalid saved file metadata');
        if (entry.kind === 'file') {
          if (!(entry.data instanceof Uint8Array)) throw Error('Invalid saved file bytes');
          bytes += entry.data.byteLength;
          if (bytes > MAX_BYTES) throw Error('Saved files exceed the 128 MiB session limit');
        }
        paths.set(entry.path, entry.kind);
      }
      for (const path of paths.keys()) {
        const parts = path.split('/');
        while (parts.length > 1) {
          parts.pop();
          if (paths.get(parts.join('/')) !== 'directory') throw Error('Missing saved parent directory');
        }
      }
    }
    return records;
  }
  function collect(FS) {
    if (!FS.analyzePath(ROOT).exists) return [];
    const records = [];
    let bytes = 0, count = 0;
    for (const id of FS.readdir(ROOT).filter(name => name !== '.' && name !== '..').sort()) {
      const base = `${ROOT}/${id}`;
      if (!FS.isDir(FS.lstat(base).mode)) throw Error('Unsupported app sandbox entry');
      const entries = [];
      function visit(path) {
        if (++count > MAX_ENTRIES) throw Error('Too many saved files');
        const full = `${base}/${path}`, stat = FS.lstat(full);
        const entry = { path, mode: stat.mode & 0o7777, mtime: +stat.mtime };
        if (FS.isDir(stat.mode)) {
          entries.push({ ...entry, kind: 'directory' });
          for (const child of FS.readdir(full).filter(name => name !== '.' && name !== '..').sort()) visit(`${path}/${child}`);
        } else if (FS.isFile(stat.mode)) {
          bytes += stat.size;
          if (bytes > MAX_BYTES) throw Error('Saved files exceed the 128 MiB session limit');
          entries.push({ ...entry, kind: 'file', data: FS.readFile(full).slice() });
        } else throw Error('Unsupported saved file type (including symbolic links)');
      }
      for (const dir of ['Documents', 'Library']) if (FS.analyzePath(`${base}/${dir}`).exists) visit(dir);
      records.push({ id, schema: 1, entries });
    }
    return validate(records);
  }
  function restore(FS, records) {
    validate(records); // Validate everything before touching the fresh guest filesystem.
    FS.mkdirTree(ROOT);
    for (const record of records) {
      const base = `${ROOT}/${record.id}`;
      FS.mkdirTree(base);
      const entries = [...record.entries].sort((a, b) => a.path.split('/').length - b.path.split('/').length);
      for (const entry of entries) {
        const path = `${base}/${entry.path}`;
        if (entry.kind === 'directory') FS.mkdirTree(path);
        else FS.writeFile(path, entry.data);
      }
      // Apply metadata last: read-only directory modes must not obstruct hydration.
      for (const entry of entries.reverse()) {
        const path = `${base}/${entry.path}`;
        FS.chmod(path, entry.mode);
        FS.utime(path, entry.mtime, entry.mtime);
      }
    }
  }
  function equal(a, b) {
    if (!a || !b || a.entries.length !== b.entries.length) return false;
    const entries = new Map(a.entries.map(entry => [entry.path, entry]));
    return b.entries.every(entry => {
      const other = entries.get(entry.path);
      return other && other.kind === entry.kind && other.mode === entry.mode && other.mtime === entry.mtime &&
        (entry.kind === 'directory' || (entry.data.length === other.data.length &&
          entry.data.every((byte, i) => byte === other.data[i])));
    });
  }
  async function openStore(factory = globalThis.indexedDB) {
    if (!factory) throw Error('IndexedDB is unavailable; cannot safely load saved progress');
    const db = await new Promise((resolve, reject) => {
      const request = factory.open(DATABASE, 2);
      let refused = false;
      request.onupgradeneeded = event => {
        if (refused) { request.transaction.abort(); return; }
        if (event.oldVersion === 0) request.result.createObjectStore('apps', { keyPath: 'id' });
        if (event.oldVersion < 2) request.result.createObjectStore('backups', { keyPath: 'id' });
      };
      request.onblocked = () => { refused = true; reject(Error('Saved data is open in another version; close the other tab')); };
      request.onerror = () => reject(request.error || Error('Unable to open saved data'));
      request.onsuccess = () => {
        if (refused) request.result.close();
        else resolve(request.result);
      };
    });
    db.onversionchange = () => db.close();
    function transaction(mode, operation, { stores = ['apps'], signal } = {}) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new DOMException('Transfer cancelled', 'AbortError')); return; }
        const tx = db.transaction(stores, mode);
        let result, failure;
        const cleanup = () => signal?.removeEventListener('abort', cancel);
        const fail = error => { failure = error; try { tx.abort(); } catch { /* Commit may already be underway: await its actual outcome. */ } };
        const cancel = () => fail(new DOMException('Transfer cancelled', 'AbortError'));
        signal?.addEventListener('abort', cancel, { once: true });
        tx.oncomplete = () => { cleanup(); resolve(result); };
        tx.onabort = () => { cleanup(); reject(failure || tx.error || Error('Saved-data transaction aborted')); };
        tx.onerror = () => {}; // A successful request is not a committed transaction.
        try { operation(tx.objectStore('apps'), value => { result = value; }, tx, fail); }
        catch (error) { fail(error); }
      });
    }
    return {
      load: () => transaction('readonly', (store, result) => {
        const request = store.getAll(); request.onsuccess = () => result(request.result);
      }),
      loadBackups: () => transaction('readonly', (_store, result, tx) => {
        const request = tx.objectStore('backups').getAll(); request.onsuccess = () => result(request.result);
      }, { stores: ['apps', 'backups'] }),
      commit: (puts, deletes) => transaction('readwrite', store => {
        for (const record of puts) store.put(record);
        for (const id of deletes) store.delete(id);
      }),
      // Caller holds the same exclusive lock as the runtime. Check the current
      // snapshots again inside the transaction; a stale confirmation cannot win.
      replace(id, next, { expected, expectedBackup, recover = false, signal } = {}) {
        if (!component(id) || expected === undefined || expectedBackup === undefined) return Promise.reject(Error('Missing selected app or prior snapshot'));
        next = next === null ? null : structuredClone(next);
        expected = expected === null ? null : structuredClone(expected);
        expectedBackup = expectedBackup === undefined ? undefined : structuredClone(expectedBackup);
        if (!recover) { validate([next]); if (next.id !== id) return Promise.reject(Error('Save belongs to another app')); }
        return transaction('readwrite', (store, result, tx, fail) => {
          let apps, backups;
          const ready = () => {
            if (!apps || !backups) return;
            try {
              validate(apps); validateBackups(backups);
              const previous = apps.find(r => r.id === id) ?? null;
              const backup = backups.find(r => r.id === id) ?? null;
              if (!(backup === null && expectedBackup === null) &&
                  !(backup && expectedBackup && (backup.record === null && expectedBackup.record === null || equal(backup.record, expectedBackup.record))))
                throw Error('Recovery backup changed since preview; select the operation again');
              if (!(previous === null && expected === null) && !equal(previous, expected)) throw Error('Saved files changed since preview; select the operation again');
              let replacement = next;
              if (recover) {
                if (!backup || !expectedBackup || !(backup.record === null && expectedBackup.record === null || equal(backup.record, expectedBackup.record)))
                  throw Error('Recovery backup changed or is unavailable; select recovery again');
                replacement = backup.record;
              }
              const nextApps = apps.filter(r => r.id !== id);
              if (replacement !== null) { if (replacement.id !== id) throw Error('Wrong recovery app'); nextApps.push(replacement); }
              const nextBackups = backups.filter(r => r.id !== id);
              nextBackups.push({ id, schema: 1, record: previous });
              validate(nextApps); validateBackups(nextBackups); // Global limits, not just this app.
              tx.objectStore('backups').put(nextBackups.at(-1));
              if (replacement === null) store.delete(id); else store.put(replacement);
              result({ replaced: true, recovered: recover });
            } catch (error) { fail(error); }
          };
          const a = store.getAll(), b = tx.objectStore('backups').getAll();
          a.onsuccess = () => { apps = a.result; ready(); };
          b.onsuccess = () => { backups = b.result; ready(); };
        }, { stores: ['apps', 'backups'], signal });
      },
      close: () => db.close(),
    };
  }
  function validateBackups(backups) {
    if (!Array.isArray(backups) || backups.length > MAX_ENTRIES) throw Error('Invalid recovery backups');
    const ids = new Set(), records = [];
    let metadata = 0;
    for (const backup of backups) {
      if (backup?.schema !== 1 || !component(backup.id) || ids.has(backup.id) ||
          !(backup.record === null || backup.record?.id === backup.id)) throw Error('Invalid recovery backup');
      ids.add(backup.id);
      if (new TextEncoder().encode(backup.id).length > 1024) throw Error('Recovery app identifier is too long');
      metadata += new TextEncoder().encode(JSON.stringify({ id: backup.id, schema: 1, record: null })).length;
      if (backup.record !== null) {
        records.push(backup.record);
        if (!Array.isArray(backup.record.entries)) throw Error('Invalid recovery entries');
        for (const entry of backup.record.entries) {
          if (typeof entry.path !== 'string' || new TextEncoder().encode(entry.path).length > 4096) throw Error('Recovery path is too long');
          metadata += new TextEncoder().encode(JSON.stringify({ path: entry.path, kind: entry.kind, mode: entry.mode, mtime: entry.mtime })).length + 64;
          if (metadata > 4 * 1024 * 1024) throw Error('Recovery metadata exceeds 4 MiB');
        }
      }
    }
    validate(records); // Backups have their own aggregate128MiB/32768-entry budget.
    if (metadata > 4 * 1024 * 1024) throw Error('Recovery metadata exceeds 4 MiB');
    return backups;
  }

  function acquire(locks = globalThis.navigator?.locks) {
    if (!locks) return Promise.reject(Error('This browser cannot safely coordinate saved progress between tabs'));
    return new Promise((resolve, reject) => {
      const done = locks.request('touchHLE-guest-saves-writer-v1', { mode: 'exclusive', ifAvailable: true }, lock => {
        if (!lock) { reject(Error('Another game tab is using saved progress; stop it first')); return; }
        return new Promise(release => resolve(() => { release(); return done; }));
      }).catch(reject);
    });
  }
  async function open(FS, { notify = () => {}, store: supplied, acquireLock = acquire,
    intervalMs = 1000 } = {}) {
    const release = await acquireLock();
    let store, timer, closed = false, revision = 0, committed = 0, pending;
    let records, status;
    const hooks = [];
    const report = (state, message) => {
      if (status !== state || state === 'error') { status = state; notify({ type: 'save-status', state, message }); }
    };
    try {
      report('restoring', 'Restoring saved progress…');
      store = supplied || await openStore();
      records = validate(await store.load());
      restore(FS, records);
      report('saved', 'Saved progress restored. Changes save on this browser.');
      function relevant(value) {
        let path;
        try {
          if (value?.node) path = FS.getPath(value.node);
          else if (typeof value === 'object' && value) path = FS.getPath(value);
          else if (typeof value === 'string') path = value;
          else return false;
          if (!path.startsWith('/')) path = `${FS.cwd()}/${path}`;
          const parts = [];
          for (const part of path.split('/')) {
            if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part);
          }
          return parts[0] === 'touchHLE_sandbox' &&
            (parts.length <= 2 || ['Documents', 'Library'].includes(parts[2]));
        } catch { return true; } // Conservatively checkpoint if a removed node cannot be resolved.
      }
      for (const name of ['write', 'msync', 'truncate', 'ftruncate', 'open', 'mkdir', 'mknod',
        'rename', 'unlink', 'rmdir', 'chmod', 'utime', 'symlink']) {
        if (typeof FS[name] !== 'function') continue;
        const original = FS[name];
        const wrapped = function (...args) {
          const target = name === 'ftruncate' ? FS.getStream(args[0]) : args[0];
          const changed = relevant(target) || (['rename', 'symlink'].includes(name) && relevant(args[1]));
          const result = original.apply(this, args);
          const writes = name !== 'open' || (result.flags & 3) !== 0;
          if (changed && writes) { revision++; report('dirty', 'Saving progress…'); }
          return result;
        };
        FS[name] = wrapped; hooks.push({ name, original, wrapped });
      }
      const flush = () => {
        if (closed) return Promise.reject(Error('Saved-data session is closed'));
        if (pending) return pending;
        pending = (async () => {
          while (committed !== revision) {
            const captured = revision, next = collect(FS);
            const old = new Map(records.map(record => [record.id, record]));
            const puts = next.filter(record => !equal(old.get(record.id), record));
            const ids = new Set(next.map(record => record.id));
            const deletes = records.filter(record => !ids.has(record.id)).map(record => record.id);
            if (puts.length || deletes.length) await store.commit(puts, deletes);
            records = next; committed = captured;
          }
          report('saved', 'Progress saved on this browser.');
        })().catch(error => {
          report('error', `Progress is not saved: ${error.message}. Keep this tab open and retry Stop.`);
          throw error;
        }).finally(() => { pending = undefined; });
        return pending;
      };
      if (intervalMs > 0) timer = setInterval(() => { void flush().catch(() => {}); }, intervalMs);
      return {
        flush,
        async close(afterCommit) {
          if (closed) return;
          do { await flush(); } while (committed !== revision); // Preserve revisions arriving during completion microtasks.
          clearInterval(timer); closed = true;
          for (const { name, original, wrapped } of hooks) if (FS[name] === wrapped) FS[name] = original;
          store.close(); const released = release();
          // Close a stopping Worker in this same turn: yielding first could let
          // guest timers write after hooks were detached and the final flush.
          afterCommit?.();
          await released;
        },
      };
    } catch (error) {
      clearInterval(timer); store?.close(); await release(); throw error;
    }
  }
  // The worker only acknowledges termination after the final transaction commits.
  function workerController(post, closeWorker, openSession = open) {
    let session, preparing = false, prepared = false, ending, endingPromise, finished = false;
    async function finish(message) {
      if (finished) return;
      ending ||= message;
      if (preparing || endingPromise) return endingPromise;
      endingPromise = (async () => {
        try {
          const done = () => { finished = true; post(ending); closeWorker(); };
          if (session) await session.close(done); else done();
        } catch (error) {
          post({ type: 'save-stop-failed', message: `Cannot stop safely: ${error.message}. Retry Stop.` });
        } finally { endingPromise = undefined; }
      })();
      return endingPromise;
    }
    return {
      async prepare(FS) {
        preparing = true;
        try { if (!ending) session = await openSession(FS, { notify: post }); }
        finally { preparing = false; prepared = true; }
        if (ending) { await finish(ending); return false; }
        return true;
      },
      handle(message) {
        if (message.type === 'save-stop') {
          ending ||= { type: 'save-stopped' };
          if (prepared) void finish(ending);
          return true;
        }
        if (message.type === 'save-flush') { void session?.flush().catch(() => {}); return true; }
        return Boolean(ending);
      },
      finish,
    };
  }
  globalThis.TouchHLESaves = Object.freeze({ open, openStore, collect, restore, validate, validateBackups, acquire, workerController, DATABASE, ROOT, MAX_BYTES, MAX_ENTRIES });
})();
