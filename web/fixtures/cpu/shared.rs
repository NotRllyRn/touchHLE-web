// SPDX-License-Identifier: MPL-2.0
#[path = "../../../src/browser/src/memory.rs"]
mod memory;
use std::sync::atomic::{AtomicU32, Ordering};
static WRITES: AtomicU32 = AtomicU32::new(0);
extern "C" {
    fn cpu_checks(code: *mut u8, high: *mut u8);
    fn scheduler_yield();
    fn nested_guest(cpu: *mut std::ffi::c_void) -> u32;
}
#[no_mangle]
pub unsafe extern "C" fn rust_hle_callback(cpu: *mut std::ffi::c_void) {
    let saved = vec![17u32; 64];
    scheduler_yield();
    assert_eq!(nested_guest(cpu), 42);
    scheduler_yield();
    assert_eq!(saved, vec![17u32; 64]);
}
#[no_mangle]
pub extern "C" fn rust_memory_write(address: u64, size: u32, value: i64) {
    assert_eq!((address, size, value), (0xffff_fffc, 4, 123));
    WRITES.fetch_add(1, Ordering::SeqCst);
}
#[no_mangle]
pub extern "C" fn run_shared_cpu_checks() {
    WRITES.store(0, Ordering::SeqCst);
    memory::check().unwrap();
    let mut mem = memory::GuestMemory::new(8192);
    mem.map(0x1000, 4096).unwrap();
    mem.map(0xffff_f000, 4096).unwrap();
    let code = mem.slice_mut(0x1000, 4096).unwrap().as_mut_ptr();
    let high = mem.slice_mut(0xffff_f000, 4096).unwrap().as_mut_ptr();
    unsafe { cpu_checks(code, high) };
    assert_eq!(WRITES.load(Ordering::SeqCst), 1);
    assert_eq!(mem.slice(0xffff_fffc, 4).unwrap(), 123u32.to_le_bytes());
}
