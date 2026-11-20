// SPDX-License-Identifier: MPL-2.0
#ifndef TOUCHHLE_WEB_TB_BRIDGE_H
#define TOUCHHLE_WEB_TB_BRIDGE_H
#include <stdint.h>
struct uc_struct;
enum touchhle_web_tb_state {
    TOUCHHLE_TB_DISABLED = 0,
    TOUCHHLE_TB_STAGED = 1,
    TOUCHHLE_TB_SEALED = 2,
    TOUCHHLE_TB_REJECTED = 3,
    TOUCHHLE_TB_FROZEN = 4,
    TOUCHHLE_TB_CLEARED = 5
};
/* Trusted verified caller supplies exact identity INCLUDING resolved options.
 * Seal accepts 1..2048 bytes. No hash verification is performed by C.
 * setup/import return STAGED=1 (borrowed arguments copied); not a restore.
 * No retry/rebind in this module. clear returns 0 when unsafe, 1 on success. */
int32_t touchhle_web_tb_setup(const uint8_t *, uint32_t, uint32_t capture,
                              uint32_t records, uint32_t resident,
                              uint32_t wire, uint32_t heap, uint32_t reserve,
                              uint32_t incoming);
/* Native loader only, after actual option parsing and before CPU creation. */
int32_t touchhle_web_tb_options(const uint8_t *, uint32_t);
int touchhle_web_tb_wants_archive(void);
int32_t touchhle_web_tb_import(const uint8_t *, uint32_t);
int32_t touchhle_web_tb_freeze(void);
uint32_t touchhle_web_tb_export(uint8_t *, uint32_t);
int32_t touchhle_web_tb_clear(void);
uint32_t touchhle_web_tb_status(void);
/* 0..14: core counters; 15 bridge current requested bytes; 16 bridge peak;
 * 17 combined requested peak observed at call boundaries (incl borrowed caller
 * bytes); 18 imported flag; 19 active run guard; 20 core requested peak
 * retained across clear. part=0 low32, part=1 high32. Excludes allocator
 * overhead, static scratch, guest, JS and committed heap. */
uint32_t touchhle_web_tb_stat(uint32_t counter, uint32_t part);
/* Adapter-only. created also runs on ordinary/no-setup path. run_enter guards
 * the whole run call, including mapping/context work and Asyncify suspension.
 * first_run only called inside that guard after actual budget/context setup. */
void touchhle_web_tb_created(struct uc_struct *);
int touchhle_web_tb_run_enter(struct uc_struct *);
void touchhle_web_tb_first_run(struct uc_struct *, int ordinary_budget);
void touchhle_web_tb_run_leave(struct uc_struct *);
int touchhle_web_tb_closing(struct uc_struct *);
#endif
