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
