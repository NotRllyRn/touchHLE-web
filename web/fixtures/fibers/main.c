// SPDX-License-Identifier: MPL-2.0
#include <assert.h>
#include <emscripten/fiber.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

extern uint32_t rust_outer(uint32_t);
extern uint32_t rust_inner(uint32_t);
extern uint32_t rust_drops(void);
static emscripten_fiber_t main_fiber, guest_fiber;
static unsigned phase, result;

void yield_to_main(void) {
  ++phase;
  emscripten_fiber_swap(&guest_fiber, &main_fiber);
}
uint32_t host_callback(uint32_t value) { return rust_inner(value); }
static void guest_entry(void *unused) {
  (void)unused;
  result = rust_outer(20);
  ++phase;
  emscripten_fiber_swap(&guest_fiber, &main_fiber);
  abort(); // A completed fiber must never be resumed.
}
int main(void) {
  const size_t size = 64 * 1024;
  void *main_async = malloc(size), *guest_async = malloc(size), *stack = malloc(size);
  assert(main_async && guest_async && stack);
  emscripten_fiber_init_from_current_context(&main_fiber, main_async, size);
  for (unsigned round = 0; round < 100; ++round) {
    phase = result = 0;
    emscripten_fiber_init(&guest_fiber, guest_entry, NULL, stack, size, guest_async, size);
    for (unsigned expected = 1; expected <= 3; ++expected) {
      emscripten_fiber_swap(&main_fiber, &guest_fiber);
      assert(phase == expected);
      assert(rust_drops() == round * 2 + (expected == 3 ? 2 : 0));
    }
    assert(result == 43);
  }
  free(stack);
  free(guest_async);
  free(main_async);
  puts("PASS Rust/C nested fiber reentry, two yields, RAII and 100 restarts");
  return 0;
}
