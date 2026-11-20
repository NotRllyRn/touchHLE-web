// SPDX-License-Identifier: MPL-2.0
#include "tb-native-bridge.h"
#include <stdlib.h>
#include <string.h>

/* Opt-in only; merged scale+seal+capture core API is a link prerequisite. */
#if defined(__EMSCRIPTEN__) && defined(TOUCHHLE_WEB_TB_BRIDGE_PROTOTYPE) &&                               \
    defined(TOUCHHLE_TB_SEAL_PROTOTYPE)
extern int touchhle_tb_archive_bind(struct uc_struct *, uint64_t);
extern void touchhle_tb_archive_clear(void);
extern void touchhle_tb_archive_capture(unsigned);
extern int touchhle_tb_archive_limits(uint32_t, uint32_t);
extern int touchhle_tb_archive_wire_limit(uint32_t);
extern uint64_t touchhle_tb_archive_stat(unsigned);
extern uint32_t touchhle_tb_archive_export(const uint8_t *, uint32_t, uint8_t *,
                                           uint32_t);
extern int touchhle_tb_archive_import(const uint8_t *, uint32_t,
                                      const uint8_t *, uint32_t);
extern int touchHLE_uc_archive_seal(struct uc_struct *, const uint8_t *,
                                    uint32_t);
extern unsigned touchHLE_uc_archive_state(struct uc_struct *);
#ifdef __EMSCRIPTEN__
#include <emscripten/heap.h>
#endif
#ifndef TB_BRIDGE_MALLOC
#define TB_BRIDGE_MALLOC malloc
#define TB_BRIDGE_FREE free
#endif
static struct {
    uint32_t state, used, busy, running, attempted, capture, imported, options_ready;
    uint32_t idlen, pending_len, incoming, records, resident, wire, heap,
        reserve;
    uint32_t frozen_len, deferred_reject;
    uint64_t allocated, peak, combined_peak, core_peak;
    uint8_t *identity, *pending;
    struct uc_struct *engine, *runner;
    unsigned engines;
} b;
static void observe(uint32_t caller)
{
    uint64_t total = b.allocated + caller + touchhle_tb_archive_stat(14);
    uint64_t peak = touchhle_tb_archive_stat(13);
    if (peak > b.core_peak)
        b.core_peak = peak;
    if (total > b.combined_peak)
        b.combined_peak = total;
}
static int fits(uint64_t extra, uint32_t caller)
{
    observe(caller);
#ifdef __EMSCRIPTEN__
    if (emscripten_get_heap_size() > b.heap)
        return 0;
#endif
    return b.allocated + touchhle_tb_archive_stat(14) + extra + caller <=
           (uint64_t)b.heap - b.reserve;
}
static void *allocate(uint32_t n, uint32_t caller)
{
    void *p;
    if (!fits(n, caller))
        return NULL;
    p = TB_BRIDGE_MALLOC(n);
    if (p) {
        b.allocated += n;
        if (b.allocated > b.peak)
            b.peak = b.allocated;
        observe(caller);
    }
    return p;
}
static void release(uint8_t **p, uint32_t *n)
{
    if (*p) {
        TB_BRIDGE_FREE(*p);
        b.allocated -= *n;
    }
    *p = NULL;
    *n = 0;
}
static void disable(uint32_t state)
{
    observe(0);
    touchhle_tb_archive_capture(0);
    if (b.engine)
        (void)touchhle_tb_archive_bind(b.engine, 0);
    touchhle_tb_archive_clear();
    release(&b.pending, &b.pending_len);
    release(&b.identity, &b.idlen);
    b.capture = b.imported = b.frozen_len = 0;
    b.state = state;
}
static int control(void) { return !b.running && !b.busy; }
int32_t touchhle_web_tb_setup(const uint8_t *id, uint32_t len, uint32_t capture,
                              uint32_t records, uint32_t resident,
                              uint32_t wire, uint32_t heap, uint32_t reserve,
                              uint32_t incoming)
{
    if (!control() || b.used || b.engines)
        return 0;
    b.used = b.busy = 1;
    b.state = TOUCHHLE_TB_REJECTED;
    touchhle_tb_archive_capture(0);
    touchhle_tb_archive_clear();
    if (!id || !len || len > 2048 || capture > 1 || (!capture && !incoming) ||
        !records || records > 524288 || !resident || resident > 201326592 ||
        wire <= 4124 || wire > 167772160 || incoming > wire || !heap ||
        heap > 1073741824 || reserve >= heap)
        goto fail;
    b.records = records;
    b.resident = resident;
    b.wire = wire;
    b.heap = heap;
    b.reserve = reserve;
    b.incoming = incoming;
    b.identity = allocate(len, len);
    if (!b.identity)
        goto fail;
    b.idlen = len;
    memcpy(b.identity, id, len);
    b.capture = capture;
    b.state = TOUCHHLE_TB_STAGED;
    b.busy = 0;
    return TOUCHHLE_TB_STAGED;
fail:
    disable(TOUCHHLE_TB_REJECTED);
    b.busy = 0;
    return 0;
}
/* The loader supplies its ordered successfully applied option arguments and
 * application arguments, after all parsing. Defaults and resolver semantics
 * are pinned by the verified runtime digest in the original identity. */
int32_t touchhle_web_tb_options(const uint8_t *options, uint32_t len)
{
    if (!control() || b.engines || b.state != TOUCHHLE_TB_STAGED || b.options_ready)
        return 0;
    b.busy = 1;
    if (!options || !len || len > 2048 || b.idlen > 2048 - len ||
        b.idlen + len > 2044)
        goto fail;
    uint32_t size = 4 + b.idlen + len;
    uint8_t *combined = allocate(size, len);
    if (!combined)
        goto fail;
    for (unsigned i = 0; i < 4; ++i)
        combined[i] = (uint8_t)(b.idlen >> (8 * i));
    memcpy(combined + 4, b.identity, b.idlen);
    memcpy(combined + 4 + b.idlen, options, len);
    release(&b.identity, &b.idlen);
    b.identity = combined;
    b.idlen = size;
    b.options_ready = 1;
    b.busy = 0;
    return 1;
fail:
    disable(TOUCHHLE_TB_REJECTED);
    b.busy = 0;
    return 0;
}
int touchhle_web_tb_wants_archive(void)
{
    return control() && !b.engines && b.state == TOUCHHLE_TB_STAGED && b.options_ready;
}
int32_t touchhle_web_tb_import(const uint8_t *source, uint32_t len)
{
    if (!control())
        return 0;
    b.busy = 1;
    if (b.state != TOUCHHLE_TB_STAGED || b.engines || b.pending || !source ||
        !len || len != b.incoming || len > b.wire)
        goto fail;
    b.pending = allocate(len, len);
    if (!b.pending)
        goto fail;
    b.pending_len = len;
    memcpy(b.pending, source, len);
    b.busy = 0;
    return TOUCHHLE_TB_STAGED;
fail:
    disable(TOUCHHLE_TB_REJECTED);
    b.busy = 0;
    return 0;
}
void touchhle_web_tb_created(struct uc_struct *uc)
{
    ++b.engines;
    if (!control()) {
        b.deferred_reject = 1;
        return;
    }
    /* Called after constructor/helper initialization. Never retain borrowed JS
     * identity inside the engine; namespace is created at first run only. */
    touchhle_tb_archive_capture(0);
    if (b.engines == 1 && b.state == TOUCHHLE_TB_STAGED)
        b.engine = uc;
    else if (b.state == TOUCHHLE_TB_STAGED || b.state == TOUCHHLE_TB_SEALED)
        disable(TOUCHHLE_TB_REJECTED);
}
int touchhle_web_tb_run_enter(struct uc_struct *uc)
{
    if (!control())
        return 0;
    b.running = 1;
    b.runner = uc;
    return 1;
}
void touchhle_web_tb_first_run(struct uc_struct *uc, int ordinary_budget)
{
    if (!b.running || b.runner != uc || b.engine != uc || b.attempted ||
        b.state != TOUCHHLE_TB_STAGED)
        return;
    b.attempted = b.busy = 1;
    /* Constructor may have initialized helper identity. Apply limits only now,
     * after engine creation, while store is empty. Never raw-import pre-seal.
     */
    if (!b.options_ready || !ordinary_budget || (b.incoming && !b.pending) ||
        !touchhle_tb_archive_limits(b.records, b.resident) ||
        !touchhle_tb_archive_wire_limit(b.wire - 4124) ||
        !touchHLE_uc_archive_seal(uc, b.identity, b.idlen) ||
        touchHLE_uc_archive_state(uc) != 2)
        goto fail;
    if (b.pending) {
        if (!fits(b.resident, 0) ||
            !touchhle_tb_archive_import(b.identity, b.idlen, b.pending,
                                        b.pending_len))
            goto fail;
        b.imported = 1;
        observe(0);
        release(&b.pending, &b.pending_len);
    }
    touchhle_tb_archive_capture(b.capture);
    b.state = TOUCHHLE_TB_SEALED;
    b.busy = 0;
    return;
fail:
    disable(TOUCHHLE_TB_REJECTED);
    b.busy = 0;
}
void touchhle_web_tb_run_leave(struct uc_struct *uc)
{
    if (b.running && b.runner == uc) {
        b.running = 0;
        b.runner = NULL;
        observe(0);
        if (b.deferred_reject || (b.state == TOUCHHLE_TB_SEALED &&
                                  touchHLE_uc_archive_state(uc) != 2))
            disable(TOUCHHLE_TB_REJECTED);
    }
}
int32_t touchhle_web_tb_freeze(void)
{
    if (!control() || b.state != TOUCHHLE_TB_SEALED)
        return 0;
    b.busy = 1;
    if (!b.engine || touchHLE_uc_archive_state(b.engine) != 2)
        goto fail;
    touchhle_tb_archive_capture(0);
    (void)touchhle_tb_archive_bind(b.engine,
                                   0); /* No further restore or capture. */
    b.frozen_len = touchhle_tb_archive_export(b.identity, b.idlen, NULL, 0);
    if (!b.frozen_len || b.frozen_len > b.wire || !fits(b.frozen_len, 0))
        goto fail;
    b.state = TOUCHHLE_TB_FROZEN;
    b.busy = 0;
    return 1;
fail:
    disable(TOUCHHLE_TB_REJECTED);
    b.busy = 0;
    return 0;
}
uint32_t touchhle_web_tb_export(uint8_t *out, uint32_t capacity)
{
    uint32_t result = 0;
    if (!control() || b.state != TOUCHHLE_TB_FROZEN)
        return 0;
    b.busy = 1;
    if (!out && !capacity)
        result = b.frozen_len;
    else if (out && capacity >= b.frozen_len && fits(0, b.frozen_len)) {
        result = touchhle_tb_archive_export(b.identity, b.idlen, out, capacity);
        if (result != b.frozen_len)
            result = 0;
    }
    b.busy = 0;
    return result;
}
int32_t touchhle_web_tb_clear(void)
{
    if (!control())
        return 0;
    b.busy = 1;
    disable(TOUCHHLE_TB_CLEARED);
    b.used = 1;
    b.busy = 0;
    return 1;
}
uint32_t touchhle_web_tb_status(void) { return b.state; }
uint32_t touchhle_web_tb_stat(uint32_t n, uint32_t part)
{
    uint64_t value = 0;
    if (part > 1)
        return 0;
    if (n == 19)
        return part ? 0 : b.running;
    if (!control())
        return 0;
    if (n < 15)
        value = touchhle_tb_archive_stat(n);
    else if (n == 15)
        value = b.allocated;
    else if (n == 16)
        value = b.peak;
    else if (n == 17)
        value = b.combined_peak;
    else if (n == 18)
        value = b.imported;
    else if (n == 20)
        value = b.core_peak;
    return (uint32_t)(value >> (32 * part));
}
int touchhle_web_tb_closing(struct uc_struct *uc)
{
    if (!control())
        return 0;
    b.busy = 1;
    if (uc == b.engine) {
        disable(TOUCHHLE_TB_CLEARED);
        b.engine = NULL;
    }
    b.busy = 0;
    return 1;
}
#else
/* No core dependency in normal adapter builds. */
int32_t touchhle_web_tb_options(const uint8_t *p, uint32_t n)
{ (void)p; (void)n; return 0; }
int touchhle_web_tb_wants_archive(void) { return 0; }

int32_t touchhle_web_tb_setup(const uint8_t *p, uint32_t n, uint32_t c,
                              uint32_t r, uint32_t b, uint32_t w, uint32_t h,
                              uint32_t v, uint32_t i)
{
    (void)p;
    (void)n;
    (void)c;
    (void)r;
    (void)b;
    (void)w;
    (void)h;
    (void)v;
    (void)i;
    return 0;
}
int32_t touchhle_web_tb_import(const uint8_t *p, uint32_t n)
{
    (void)p;
    (void)n;
    return 0;
}
int32_t touchhle_web_tb_freeze(void) { return 0; }
uint32_t touchhle_web_tb_export(uint8_t *p, uint32_t n)
{
    (void)p;
    (void)n;
    return 0;
}
int32_t touchhle_web_tb_clear(void) { return 1; }
uint32_t touchhle_web_tb_status(void) { return TOUCHHLE_TB_DISABLED; }
uint32_t touchhle_web_tb_stat(uint32_t n, uint32_t p)
{
    (void)n;
    (void)p;
    return 0;
}
void touchhle_web_tb_created(struct uc_struct *p) { (void)p; }
int touchhle_web_tb_run_enter(struct uc_struct *p)
{
    (void)p;
    return 1;
}
void touchhle_web_tb_first_run(struct uc_struct *p, int n)
{
    (void)p;
    (void)n;
}
void touchhle_web_tb_run_leave(struct uc_struct *p) { (void)p; }
int touchhle_web_tb_closing(struct uc_struct *p)
{
    (void)p;
    return 1;
}
#endif
