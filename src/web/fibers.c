// SPDX-License-Identifier: MPL-2.0
#include <emscripten/fiber.h>
#include <stdlib.h>
#include <assert.h>
#include <string.h>
typedef struct {
  emscripten_fiber_t caller, callee;
  void *caller_stack, *callee_stack, *c_stack;
} Fiber;
void *touchhle_fiber_new(void (*entry)(void *), void *arg) {
  Fiber *f = calloc(1, sizeof(Fiber));
  assert(f);
  const size_t size = 2 * 1024 * 1024;
  f->caller_stack = malloc(size);
  f->callee_stack = malloc(size);
  f->c_stack = aligned_alloc(16, size);
  assert(f->caller_stack && f->callee_stack && f->c_stack);
  emscripten_fiber_init_from_current_context(&f->caller, f->caller_stack, size);
  emscripten_fiber_init(&f->callee, entry, arg, f->c_stack, size, f->callee_stack, size);
  return f;
}
void touchhle_fiber_resume(Fiber *f) {
  // A coroutine can be created on a guest fiber but resumed by the main
  // scheduler. Capture the actual caller's stack limits on every resume.
  emscripten_fiber_init_from_current_context(&f->caller, f->caller_stack, 2 * 1024 * 1024);
  emscripten_fiber_swap(&f->caller, &f->callee);
}
void touchhle_fiber_yield(Fiber *f) {
  emscripten_fiber_swap(&f->callee, &f->caller);
}
void touchhle_fiber_free(Fiber *f) {
  free(f->caller_stack); free(f->callee_stack); free(f->c_stack); free(f);
}

// SDL events are queued on the worker when the main thread forwards a pointer.
#include <SDL2/SDL.h>
void touchhle_web_pointer(int kind, int x, int y) {
  SDL_Event event;
  memset(&event, 0, sizeof(event));
  if (kind == 0 || kind == 2) {
    event.type = kind == 0 ? SDL_MOUSEBUTTONDOWN : SDL_MOUSEBUTTONUP;
    event.button.button = SDL_BUTTON_LEFT;
    event.button.state = kind == 0 ? SDL_PRESSED : SDL_RELEASED;
    event.button.x = x; event.button.y = y;
  } else {
    event.type = SDL_MOUSEMOTION;
    event.motion.state = SDL_BUTTON_LMASK;
    event.motion.x = x; event.motion.y = y;
  }
  SDL_PushEvent(&event);
}

// Coordinates are normalized, matching SDL's finger-event contract. All
// contacts in one browser batch share a timestamp for native UIKit grouping.
void touchhle_web_touch(int kind, int id, float x, float y, uint32_t timestamp) {
  SDL_Event event;
  memset(&event, 0, sizeof(event));
  event.type = kind == 0 ? SDL_FINGERDOWN : kind == 2 ? SDL_FINGERUP : SDL_FINGERMOTION;
  event.tfinger.timestamp = timestamp;
  event.tfinger.touchId = 1;
  event.tfinger.fingerId = id;
  event.tfinger.x = x;
  event.tfinger.y = y;
  event.tfinger.pressure = kind == 2 ? 0.0f : 1.0f;
  // SDL_PushEvent replaces timestamps, which can merge separate queued
  // pinch steps or split a pair. Preserve the browser batch timestamp.
  assert(SDL_PeepEvents(&event, 1, SDL_ADDEVENT, 0, 0) == 1);
}

// Browser text ingress never enters Rust/guest code on a suspended stack.
// Generation/lease tags remain authoritative until Rust commits an edit.
extern void touchhle_web_text_notify(uint32_t epoch, int active);
extern void touchhle_web_text_result(uint32_t sequence, uint32_t status);
static uint32_t text_epoch, text_lease, text_last_lease;
static int text_active, text_count;
static uint32_t text_queue[32][5];
static void text_clear(void) {
  for (int i = 0; i < text_count; i++) touchhle_web_text_result(text_queue[i][4], 1);
  text_count = 0;
}
uint32_t touchhle_web_text_focus(int active) {
  text_clear(); text_lease = 0;
  if (text_epoch < 0x7fffffffU) text_epoch++; else active = 0;
  text_active = active && text_epoch < 0x7fffffffU;
  touchhle_web_text_notify(text_epoch, text_active);
  return text_epoch;
}
int touchhle_web_text_valid(uint32_t epoch, uint32_t lease) {
  return text_active && epoch == text_epoch && lease && lease == text_lease;
}
int touchhle_web_text_lease(uint32_t epoch, uint32_t lease) {
  if (!text_active || epoch != text_epoch || lease > 0x7fffffffU) return 1;
  if (lease && lease <= text_last_lease) return 1;
  text_clear(); text_lease = lease;
  if (lease) text_last_lease = lease;
  return 0;
}
int touchhle_web_text_enqueue(uint32_t epoch, uint32_t lease, uint32_t op, uint32_t code, uint32_t sequence) {
  if (!touchhle_web_text_valid(epoch, lease)) return 1;
  if (!sequence || sequence > 0x7fffffffU || !((op == 0 && code >= 32 && code <= 126) || ((op == 1 || op == 2) && code == 0))) return 2;
  if (text_count == 32) return 6;
  uint32_t event[5] = {epoch, lease, op, code, sequence};
  memcpy(text_queue[text_count++], event, sizeof(event));
  return 0;
}
int touchhle_web_text_take(uint32_t *out) {
  if (!text_count) return 0;
  memcpy(out, text_queue[0], sizeof(text_queue[0]));
  memmove(text_queue, text_queue + 1, --text_count * sizeof(text_queue[0]));
  return 1;
}
