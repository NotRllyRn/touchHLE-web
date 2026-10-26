// SPDX-License-Identifier: MPL-2.0
//! Emscripten fibers for the existing single-host-thread scheduler.
//! Panics abort the worker. Suspended stacks cannot be unwound on this target;
//! cancellation terminates the worker and its entire WASM instance.
use std::cell::UnsafeCell;
use std::ffi::c_void;
extern "C" {
    fn touchhle_fiber_new(entry: extern "C" fn(*mut c_void), arg: *mut c_void) -> *mut c_void;
    fn touchhle_fiber_resume(fiber: *mut c_void);
    fn touchhle_fiber_yield(fiber: *mut c_void);
    fn touchhle_fiber_free(fiber: *mut c_void);
}
pub enum CoroutineResult<Y, R> {
    Yield(Y),
    Return(R),
}
pub struct Yielder<I, Y> {
    fiber: *mut c_void,
    input: *mut Option<I>,
    yielded: *mut Option<Y>,
}
impl<I, Y> Yielder<I, Y> {
    pub fn suspend(&self, value: Y) -> I {
        unsafe {
            *self.yielded = Some(value);
            touchhle_fiber_yield(self.fiber);
            (*self.input).take().expect("Fiber resumed without input")
        }
    }
    // Browser APIs run on this worker's thread; no Android parent-stack rule.
    pub fn on_parent_stack<F: FnOnce() -> R, R>(&self, f: F) -> R {
        f()
    }
}
type Entry<I, Y, R> = Box<dyn FnOnce(&Yielder<I, Y>, I) -> R>;
struct State<I, Y, R> {
    fiber: *mut c_void,
    entry: Option<Entry<I, Y, R>>,
    input: Option<I>,
    yielded: Option<Y>,
    returned: Option<R>,
    done: bool,
}
pub struct Coroutine<I, Y, R> {
    state: Box<UnsafeCell<State<I, Y, R>>>,
}
extern "C" fn entry<I, Y, R>(ptr: *mut c_void) {
    unsafe {
        let state = ptr.cast::<State<I, Y, R>>();
        let yielder = Yielder {
            fiber: (*state).fiber,
            input: &raw mut (*state).input,
            yielded: &raw mut (*state).yielded,
        };
        let callback = (*state).entry.take().unwrap();
        let input = (*state).input.take().unwrap();
        let result = callback(&yielder, input);
        (*state).returned = Some(result);
        (*state).done = true;
        touchhle_fiber_yield((*state).fiber);
        std::process::abort();
    }
}
impl<I, Y, R> Coroutine<I, Y, R> {
    pub fn new<F: FnOnce(&Yielder<I, Y>, I) -> R + 'static>(f: F) -> Self {
        let state = Box::new(UnsafeCell::new(State {
            fiber: std::ptr::null_mut(),
            entry: Some(Box::new(f)),
            input: None,
            yielded: None,
            returned: None,
            done: false,
        }));
        unsafe {
            (*state.get()).fiber = touchhle_fiber_new(entry::<I, Y, R>, state.get().cast());
        }
        Self { state }
    }
    pub fn resume(&mut self, value: I) -> CoroutineResult<Y, R> {
        unsafe {
            let state = self.state.get();
            assert!(!(*state).done, "Completed coroutine resumed");
            (*state).input = Some(value);
            touchhle_fiber_resume((*state).fiber);
            if (*state).done {
                CoroutineResult::Return((*state).returned.take().unwrap())
            } else {
                CoroutineResult::Yield((*state).yielded.take().unwrap())
            }
        }
    }
}
impl<I, Y, R> Drop for Coroutine<I, Y, R> {
    fn drop(&mut self) {
        unsafe {
            touchhle_fiber_free((*self.state.get()).fiber);
        }
    }
}
