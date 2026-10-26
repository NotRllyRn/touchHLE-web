// SPDX-License-Identifier: MPL-2.0
#include <assert.h>
#include <emscripten.h>
#include <emscripten/stack.h>
#include <stdio.h>
#include <stdlib.h>
#include <SDL2/SDL.h>
extern void touchhle_web_touch(int, int, float, float, uint32_t);
extern void *touchhle_fiber_new(void (*entry)(void *), void *arg);
extern void touchhle_fiber_resume(void *);
extern void touchhle_fiber_yield(void *);
extern void touchhle_fiber_free(void *);
static void *parent, *child;
static unsigned phase;
static void child_entry(void *unused) {
  (void)unused;
  assert((emscripten_stack_get_base() & 15) == 0);
  EM_ASM({ if ($0 !== 123) throw new Error("Bad fiber EM_ASM argument"); }, 123);
  phase = 2;
  touchhle_fiber_yield(child);
  phase = 4;
  touchhle_fiber_yield(child);
  abort();
}
static void parent_entry(void *unused) {
  (void)unused;
  assert((emscripten_stack_get_base() & 15) == 0);
  child = touchhle_fiber_new(child_entry, NULL);
  phase = 1;
  touchhle_fiber_yield(parent);
  phase = 3;
  touchhle_fiber_yield(parent);
  abort();
}
int main(void) {
  assert(SDL_Init(SDL_INIT_EVENTS) == 0);
  SDL_Event event;
  for (int kind = 0; kind < 3; ++kind) {
    touchhle_web_touch(kind, -1, .25f, .5f, 100 + kind);
    touchhle_web_touch(kind, -2, .75f, .5f, 100 + kind);
    for (int id = -1; id >= -2; --id) {
      assert(SDL_PollEvent(&event) == 1);
      assert(event.type == (kind == 0 ? SDL_FINGERDOWN : kind == 2 ? SDL_FINGERUP : SDL_FINGERMOTION));
      assert(event.tfinger.fingerId == id);
      assert(event.tfinger.timestamp == 100 + kind);
      assert(event.tfinger.x == (id == -1 ? .25f : .75f));
      assert(event.tfinger.y == .5f);
      assert(event.tfinger.pressure == (kind == 2 ? 0.0f : 1.0f));
    }
    // Drain SDL's end-of-poll-cycle sentinel before queuing the next batch.
    assert(SDL_PollEvent(&event) == 0);
  }
  SDL_Quit();
  for (unsigned round = 0; round < 10; ++round) {
    parent = touchhle_fiber_new(parent_entry, NULL);
    touchhle_fiber_resume(parent); assert(phase == 1);
    emscripten_sleep(0);
    touchhle_fiber_resume(child); assert(phase == 2);
    touchhle_fiber_resume(parent); assert(phase == 3);
    emscripten_sleep(0);
    touchhle_fiber_resume(child); assert(phase == 4);
    touchhle_fiber_free(child); touchhle_fiber_free(parent);
  }
  puts("PASS actual fiber adapter: child creation on guest stack, scheduler resume, async sleep and paired SDL finger events");
}
