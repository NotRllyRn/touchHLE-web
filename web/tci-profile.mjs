// SPDX-License-Identifier: MPL-2.0
import { parseTciGuestMap } from './tci-guest-map.mjs';

// Diagnostic-only observer. Never loaded by the normal runtime or packager.
const leb = n => {
  const bytes = [];
  do { const b = n & 127; n >>>= 7; bytes.push(b | (n ? 128 : 0)); } while (n);
  return bytes;
};
const string = text => { const bytes = new TextEncoder().encode(text); return [...leb(bytes.length), ...bytes]; };
const section = (id, bytes) => [id, ...leb(bytes.length), ...bytes];
const global = () => new WebAssembly.Global({ value: 'f64', mutable: true }, 0);

export class TciProfile {
  constructor({ counts = false, limit = 32768, translationLimit = limit } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 65536) throw Error('Invalid profile limit');
    if (!Number.isInteger(translationLimit) || translationLimit < 1 || translationLimit > 524288) throw Error('Invalid translation limit');
    this.translationLimit = translationLimit;
    this.counts = counts;
    this.limit = limit;
    this.records = [];
    this.opcodes = new Map();
    this.callSites = new Map();
    this.live = new WeakMap();
    this.dropped = 0;
    this.translations = new Map();
    this.registrationStats = { total: 0, tciBytes: 0, repeatedContexts: 0, omittedContexts: 0, missingMetadata: 0 };
  }
  register(metadata, size) {
    if (!this.counts) return;
    const stats = this.registrationStats;
    stats.total++; stats.tciBytes += size;
    if (!metadata) { stats.missingMetadata++; return; }
    const { guestPc, flags, guestSize } = metadata;
    const key = `${guestPc}:${flags}:${guestSize}`;
    const existing = this.translations.get(key);
    if (existing) { existing.translations++; stats.repeatedContexts++; }
    else if (this.translations.size < this.translationLimit) this.translations.set(key, { guestPc, flags, guestSize, translations: 1 });
    else stats.omittedContexts++;
  }
  begin(jit, start, length, ops) {
    let live = this.live.get(jit);
    if (!live) this.live.set(jit, live = new Map());
    live.delete(start);
    if (this.records.length >= this.limit) { this.dropped++; return null; }
    const id = this.records.length, histogram = {}, helpers = {}, calls = new Map();
    const view = new DataView(jit.memory.buffer);
    for (const op of ops) {
      histogram[op.name] = (histogram[op.name] ?? 0) + 1;
      if (op.name === 'call' && view.getUint8(op.pc + 2) === 255) {
        const callee = view.getUint32(op.pc + 3, true);
        helpers[callee] = (helpers[callee] ?? 0) + 1;
        calls.set(op.pc, String(callee));
      }
    }
    const name = `tci_block_${id}`, imports = {};
    if (this.counts) {
      imports.p_block = global();
      for (const opcode of Object.keys(histogram)) {
        if (!this.opcodes.has(opcode)) this.opcodes.set(opcode, global());
        imports[`p_${opcode}`] = this.opcodes.get(opcode);
      }
      for (const callee of Object.keys(helpers)) {
        if (!this.callSites.has(callee)) this.callSites.set(callee, global());
        imports[`h_${callee}`] = this.callSites.get(callee);
      }
    }
    // Registration owns the source metadata; retain only validated bounded
    // fields, never the live code buffer or a caller-owned search array.
    const block = jit.blocks?.get(start), guest = {};
    if (Number.isSafeInteger(block?.generation) && block.generation >= 0) {
      guest.generation = block.generation;
    }
    try {
      if (block?.guestMetadata != null) {
        const { format, guestPc, guestSize, icount, flags, search } = block.guestMetadata;
        const metadata = { format, guestPc, guestSize, icount, flags, search };
        guest.guestMap = parseTciGuestMap(metadata, length);
        guest.guestMetadata = { ...metadata, search: Array.from(search) };
      }
    } catch (error) {
      // Diagnostics must never make otherwise compilable TCI fail.
      guest.guestMapError = String(error?.message ?? error).slice(0, 256);
    }
    this.records.push({ name, start, length, histogram, helpers, ...guest, counter: imports.p_block });
    live.set(start, imports);
    const globals = Object.keys(imports), indices = new Map(globals.map((name, index) => [name, index]));
    const increment = (name, base) => [
      0x23, ...leb(base + indices.get(name)),
      0x44, 0, 0, 0, 0, 0, 0, 0xf0, 0x3f, 0xa0,
      0x24, ...leb(base + indices.get(name)),
    ];
    return {
      globals,
      count: (opcode, base, pc) => this.counts ? [
        ...increment(`p_${opcode}`, base),
        ...(calls.has(pc) ? increment(`h_${calls.get(pc)}`, base) : []),
      ] : [],
      nameSection: index => section(0, [...string('name'), ...section(1, [1, ...leb(index), ...string(name)])]),
    };
  }
  bindings(jit, start) { return this.live.get(jit)?.get(start); }
  snapshot() {
    return { format: 1, limits: { blocks: this.limit, translationContexts: this.translationLimit }, mode: this.counts ? 'tci-counts' : 'timing-names', dropped: this.dropped,
      truncated: this.dropped > 0,
      registrationStats: this.counts ? { ...this.registrationStats } : null,
      translationContexts: [...this.translations.values()].map(row => ({ ...row })),
      translationMeaning: 'Cumulative registration counts keyed by guest PC, full TB flags and byte span. Repeated context does not prove identical code or restore eligibility; cflags and code bytes are not captured here.',
      coverage: 'Only recorded compiled TCI operations; excludes interpreted operations and all compilations after the metadata limit. Counts are not ARM instructions or timings.',
      opcodes: Object.fromEntries([...this.opcodes].map(([name, counter]) => [name, counter.value])),
      callSites: Object.fromEntries([...this.callSites].map(([name, counter]) => [name, counter.value])),
      blockEntryMeaning: 'TCI block visits including same-block goto loops; not Wasm function invocations.',
      callSiteMeaning: 'TCI immediate-helper call-site visits, including inlined fast paths; not actual helper invocations.',
      guestMapMeaning: 'Translation/fault-restoration slots and TCI ranges; neither slots nor TCI counts establish ARM instruction retirement.',
      blocks: this.records.map(({ counter, guestMetadata, guestMap, ...record }) => ({
        ...record, entries: counter?.value ?? null,
        ...(guestMetadata ? { guestMetadata: { ...guestMetadata, search: [...guestMetadata.search] },
          guestMap: guestMap.map(row => ({ ...row })) } : {}),
      })) };
  }
}
