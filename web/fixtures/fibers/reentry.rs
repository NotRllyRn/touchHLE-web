// SPDX-License-Identifier: MPL-2.0
// Test Rust frames and RAII across a C-hosted Emscripten fiber suspension.
use std::sync::atomic::{AtomicU32, Ordering};
static DROPS: AtomicU32 = AtomicU32::new(0);
struct Guard;
impl Drop for Guard {
    fn drop(&mut self) {
        DROPS.fetch_add(1, Ordering::SeqCst);
    }
}
extern "C" {
    fn host_callback(value: u32) -> u32;
    fn yield_to_main();
}
#[no_mangle]
pub extern "C" fn rust_outer(value: u32) -> u32 {
    let _guard = Guard;
    // Keep owned heap state alive while C reenters Rust and yields twice.
    let saved = vec![value; 64];
    let result = unsafe { host_callback(value + 1) };
    assert_eq!(saved, vec![value; 64]);
    assert_eq!(result, value + 3);
    result + saved[0]
}
#[no_mangle]
pub extern "C" fn rust_inner(value: u32) -> u32 {
    let _guard = Guard;
    unsafe { yield_to_main() };
    let saved = value + 1;
    unsafe { yield_to_main() };
    saved + 1
}
#[no_mangle]
pub extern "C" fn rust_drops() -> u32 {
    DROPS.load(Ordering::SeqCst)
}
