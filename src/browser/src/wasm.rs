// SPDX-License-Identifier: MPL-2.0
//! Private worker ABI. Pointer/length pairs must come from these allocators.

#[no_mangle]
pub extern "C" fn memory_check() -> u32 {
    u32::from(crate::memory::check().is_ok())
}

#[no_mangle]
pub extern "C" fn input_alloc(len: usize) -> *mut u8 {
    if len > super::MAX_IPA_BYTES {
        return std::ptr::null_mut();
    }
    // Keep the element type explicit: inspect frees this as a byte slice.
    Box::into_raw(vec![0u8; len].into_boxed_slice()).cast()
}

/// Consumes an input allocation and returns an owned JSON byte-vector handle.
/// Safety: ptr/len must match a live input_alloc allocation, exactly once.
#[no_mangle]
pub unsafe extern "C" fn inspect(ptr: *mut u8, len: usize) -> *mut Vec<u8> {
    let input = Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len));
    let result = match super::inspect_ipa(&input) {
        Ok(value) => serde_json::json!({"ok": true, "app": value}),
        Err(error) => serde_json::json!({"ok": false, "error": error}),
    };
    Box::into_raw(Box::new(serde_json::to_vec(&result).unwrap()))
}

#[no_mangle]
pub unsafe extern "C" fn result_ptr(result: *const Vec<u8>) -> *const u8 {
    (*result).as_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn result_len(result: *const Vec<u8>) -> usize {
    (*result).len()
}

#[no_mangle]
pub unsafe extern "C" fn result_free(result: *mut Vec<u8>) {
    drop(Box::from_raw(result));
}
