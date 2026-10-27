// SPDX-License-Identifier: MPL-2.0
// Pinned Unicorn 8028ec436f2d9376525352dd38ed9ed6b9f6be10, ARM32:
// qemu/accel/tcg/translate-all.c encode_search/cpu_restore_state_from_tb;
// qemu/target/arm/cpu-param.h, cpu.h, translate.c and translate.h.
// Translation/fault-restoration metadata, never evidence of ARM retirement.
const MAX_ROWS = 512; // qemu/include/tcg/tcg.h: TCG_MAX_INSNS
const MAX_OFFSET = 65535; // gen_insn_end_off is uint16_t

function uint(name, value, max, min = 0) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`Invalid ${name}`);
  }
}

/** Decode a copied registration table. Offsets are relative to the TCI block.
 * Input: { format: 'arm32-encode-search-v1', guestPc, guestSize, icount,
 *          flags, search: Uint8Array }. guestSize is tb->size, not TCI size.
 * Output syndrome is the saved partial data-abort syndrome shifted back by
 * 14, not a complete architectural exception syndrome. PC keeps its raw
 * instruction address; Thumb state comes from TB flags, not PC bit zero.
 * Rows cover [previous end, tciEndOffset); the first range can include the
 * block prologue. Equal ends are valid (an instruction may emit no code).
 * No guest memory or live Wasm memory is read. Malformed input throws.
 */
export function parseTciGuestMap(metadata, tciSize) {
  if (!metadata || metadata.format !== 'arm32-encode-search-v1') {
    throw new TypeError('Expected pinned ARM32 encode_search metadata');
  }
  const { guestPc, guestSize, icount, flags, search } = metadata;
  uint('guestPc', guestPc, 0xffffffff);
  // Breakpoint/exception TBs may have a slot without advancing pc_next.
  uint('guestSize', guestSize, 65535);
  uint('icount', icount, MAX_ROWS, 1);
  uint('flags', flags, 0xffffffff);
  uint('tciSize', tciSize, 0xffffffff, 1);
  if (!(search instanceof Uint8Array)) throw new TypeError('Expected copied Uint8Array search');
  // Four signed 32-bit columns, each taking one to five bytes per row.
  if (search.length < icount * 4 || search.length > icount * 20) {
    throw new RangeError('Invalid search length');
  }
  let cursor = 0;
  function signedDelta() {
    let value = 0, scale = 1;
    for (let i = 0; i < 5; i++, scale *= 128) {
      if (cursor >= search.length) throw new RangeError('Truncated search delta');
      const byte = search[cursor++];
      value += (byte & 127) * scale;
      if (!(byte & 128)) {
        if (byte & 64) value -= scale * 128;
        if (value < -0x80000000 || value > 0x7fffffff) {
          throw new RangeError('Search delta exceeds signed 32 bits');
        }
        return value;
      }
    }
    throw new RangeError('Search delta exceeds five bytes');
  }

  const rows = [], thumb = !!(flags & (1 << 8));
  let pc = guestPc, itState = 0, syndromeWord = 0, end = 0;
  for (let i = 0; i < icount; i++) {
    // target_ulong addition wraps at 32 bits, as in the C decoder.
    pc = (pc + signedDelta()) >>> 0;
    itState = (itState + signedDelta()) >>> 0;
    syndromeWord = (syndromeWord + signedDelta()) >>> 0;
    const nextEnd = end + signedDelta();
    if (nextEnd < end || nextEnd > tciSize || nextEnd > MAX_OFFSET) {
      throw new RangeError('Nonmonotone or out-of-bounds TCI end offset');
    }
    if (itState > 255 || syndromeWord > 4095) {
      throw new RangeError('Invalid ARM IT state or compressed syndrome');
    }
    rows.push({ guestPc: pc, thumb, itState, syndrome: (syndromeWord << 14) >>> 0,
      tciEndOffset: nextEnd });
    end = nextEnd;
  }
  if (cursor !== search.length) throw new RangeError('Trailing search bytes');
  return rows;
}
