// SPDX-License-Identifier: MPL-2.0
//! Browser-only capability and owned edits; native SDL editing is unchanged.
use super::*;
use crate::frameworks::uikit::ui_view::ui_label::UILabelHostObject;
use crate::objc::retain;

#[derive(Default)]
pub struct State {
    owner: id,
    epoch: u32,
    depth: u32,
    ambiguous: bool,
    busy: bool,
}
extern "C" {
    fn touchhle_web_text_focus(active: i32) -> u32;
    fn touchhle_web_text_valid(epoch: u32, lease: u32) -> i32;
    fn touchhle_web_text_result(sequence: u32, status: u32);
}
fn state(env: &mut Environment) -> &mut State {
    &mut env.framework_state.uikit.ui_responder.web_text
}
pub fn invalidate(env: &mut Environment) {
    let epoch = unsafe { touchhle_web_text_focus(0) };
    let s = state(env);
    s.owner = nil;
    s.epoch = epoch;
}
pub fn teardown(env: &mut Environment, field: id) {
    if env.framework_state.uikit.ui_responder.first_responder == field {
        env.framework_state.uikit.ui_responder.first_responder = nil;
        invalidate(env);
    }
}
pub fn removed(env: &mut Environment) {
    if state(env).owner != nil || state(env).depth != 0 || state(env).busy {
        state(env).ambiguous = true;
        invalidate(env);
    }
}
fn valid(env: &mut Environment, field: id, epoch: u32, lease: u32) -> bool {
    let current = env.framework_state.uikit.ui_responder.first_responder;
    let s = state(env);
    s.owner == field
        && field != nil
        && current == field
        && s.epoch == epoch
        && !s.ambiguous
        && s.depth == 0
        && unsafe { touchhle_web_text_valid(epoch, lease) != 0 }
}
fn revision(env: &Environment, label: id) -> u64 {
    env.objc
        .borrow::<UILabelHostObject>(label)
        .web_text_revision
}
/// Status: 0 applied/dispatched; 1 stale/no focus; 2 unsupported; 3 veto;
/// 4 callback changed state; 5 nested. No text payload is sent to the browser.
pub fn handle(env: &mut Environment, event: [u32; 5]) {
    let [epoch, lease, op, code, sequence] = event;
    let field = state(env).owner;
    let status = if state(env).busy {
        5
    } else if !valid(env, field, epoch, lease) {
        1
    } else {
        let supported = env
            .objc
            .get_host_object(field)
            .and_then(|o| o.as_any().downcast_ref::<UITextFieldHostObject>())
            .is_some_and(|o| o.editing);
        if !supported {
            1
        } else {
            state(env).busy = true;
            let result = edit(env, field, epoch, lease, op, code);
            state(env).busy = false;
            result
        }
    };
    unsafe {
        touchhle_web_text_result(sequence, status);
    }
}
fn edit(env: &mut Environment, field: id, epoch: u32, lease: u32, op: u32, code: u32) -> u32 {
    if !((op == 0 && (32..=126).contains(&code)) || ((op == 1 || op == 2) && code == 0)) {
        return 2;
    }
    // Built-in state reads do not dispatch guest methods. Keep each referenced
    // object alive throughout callbacks and the commit, including equal-value ABA.
    retain(env, field);
    let (label, delegate) = {
        let h = env.objc.borrow::<UITextFieldHostObject>(field);
        (h.text_label, h.delegate)
    };
    retain(env, label);
    retain(env, delegate);
    let current = env.objc.borrow::<UILabelHostObject>(label).web_text_value();
    retain(env, current);
    let rev = revision(env, label);
    let result = (|| {
        let Some(mut text) = ns_string::bounded_ascii(env, current, 255) else {
            return 2;
        };
        if rev == u64::MAX || !valid(env, field, epoch, lease) {
            return 1;
        }
        let unchanged =
            |env: &mut Environment| valid(env, field, epoch, lease) && revision(env, label) == rev;
        if op == 2 {
            let sel = env
                .objc
                .register_host_selector("textFieldShouldReturn:".into(), &mut env.mem);
            let responds: bool = msg![env; delegate respondsToSelector:sel];
            if !unchanged(env) {
                return 4;
            }
            if responds {
                () = msg![env; delegate textFieldShouldReturn:field];
            }
            return 0;
        }
        if op == 0 && text.len() >= 255 {
            return 2;
        }
        if op == 1 && text.is_empty() {
            return 0;
        }
        let range = NSRange {
            location: (text.len() - usize::from(op == 1)) as NSUInteger,
            length: usize::from(op == 1) as NSUInteger,
        };
        let replacement = ns_string::from_rust_string(
            env,
            if op == 0 {
                (code as u8 as char).to_string()
            } else {
                String::new()
            },
        );
        let sel = env.objc.register_host_selector(
            "textField:shouldChangeCharactersInRange:replacementString:".into(),
            &mut env.mem,
        );
        let responds: bool = msg![env; delegate respondsToSelector:sel];
        let mut allowed = false;
        if unchanged(env) {
            allowed = delegate == nil
                || !responds
                || msg![env; delegate textField:field shouldChangeCharactersInRange:range replacementString:replacement];
        }
        release(env, replacement);
        if !unchanged(env) {
            return 4;
        }
        if !allowed {
            return 3;
        }
        if op == 0 {
            text.push(code as u8 as char);
        } else {
            text.pop();
        }
        // Owned +1 result, unlike the native helper's autoreleased substring.
        let new_text = ns_string::from_rust_string(env, text);
        () = msg![env; label setText:new_text];
        release(env, new_text);
        () = msg![env; field setNeedsDisplay];
        0
    })();
    release(env, current);
    release(env, delegate);
    release(env, label);
    release(env, field);
    result
}

/// Owned web-only focus transition. Ambiguous/reentrant transitions invalidate
/// browser capability and fail closed; the native methods are unchanged.
pub fn focus(env: &mut Environment, field: id, starting: bool) -> bool {
    if state(env).depth != 0 {
        state(env).ambiguous = true;
        invalidate(env);
        return false;
    }
    let Some(h) = env
        .objc
        .get_host_object(field)
        .and_then(|h| h.as_any().downcast_ref::<UITextFieldHostObject>())
    else {
        return false;
    };
    let was_editing = h.editing;
    let delegate = h.delegate;
    let previous = env.framework_state.uikit.ui_responder.first_responder;
    state(env).depth = 1;
    state(env).ambiguous = previous != nil && previous != field;
    invalidate(env);
    let epoch = state(env).epoch;
    retain(env, field);
    retain(env, delegate);
    let intact = |env: &mut Environment, expected: id, editing: bool| {
        state(env).epoch == epoch
            && !state(env).ambiguous
            && env.framework_state.uikit.ui_responder.first_responder == expected
            && env
                .objc
                .get_host_object(field)
                .and_then(|h| h.as_any().downcast_ref::<UITextFieldHostObject>())
                .is_some_and(|h| h.editing == editing)
    };
    let result = (|| {
        if !intact(env, previous, was_editing) {
            return false;
        }
        if starting == was_editing {
            return !starting || previous == field;
        }
        if !starting && previous != field {
            return false;
        }
        let selector = if starting {
            "textFieldShouldBeginEditing:"
        } else {
            "textFieldShouldEndEditing:"
        };
        let sel = env
            .objc
            .register_host_selector(selector.into(), &mut env.mem);
        let responds: bool = msg![env; delegate respondsToSelector:sel];
        if !intact(env, previous, was_editing) {
            return false;
        }
        let allowed = if !responds {
            true
        } else if starting {
            msg![env; delegate textFieldShouldBeginEditing:field]
        } else {
            msg![env; delegate textFieldShouldEndEditing:field]
        };
        if !allowed || !intact(env, previous, was_editing) {
            return false;
        }
        if starting {
            let label = env.objc.borrow::<UITextFieldHostObject>(field).text_label;
            if env.objc.borrow::<UILabelHostObject>(label).web_text_value() == nil {
                let empty = ns_string::get_static_str(env, "");
                () = msg![env; label setText:empty];
            }
            if !intact(env, previous, was_editing) {
                return false;
            }
        }
        let center: id = msg_class![env; NSNotificationCenter defaultCenter];
        let name = ns_string::get_static_str(
            env,
            if starting {
                UIKeyboardWillShowNotification
            } else {
                UIKeyboardWillHideNotification
            },
        );
        () = msg![env; center postNotificationName:name object:field userInfo:nil];
        if !intact(env, previous, was_editing) {
            return false;
        }
        let committed = if starting { field } else { nil };
        env.framework_state.uikit.ui_responder.first_responder = committed;
        env.objc.borrow_mut::<UITextFieldHostObject>(field).editing = starting;
        env.on_parent_stack_in_coroutine(|window, _| {
            if starting {
                window.start_text_input()
            } else {
                window.stop_text_input()
            }
        });
        let name = ns_string::get_static_str(
            env,
            if starting {
                UIKeyboardDidShowNotification
            } else {
                UIKeyboardDidHideNotification
            },
        );
        () = msg![env; center postNotificationName:name object:field userInfo:nil];
        if !intact(env, committed, starting) {
            return false;
        }
        let selector = if starting {
            "textFieldDidBeginEditing:"
        } else {
            "textFieldDidEndEditing:"
        };
        let sel = env
            .objc
            .register_host_selector(selector.into(), &mut env.mem);
        let responds: bool = msg![env; delegate respondsToSelector:sel];
        if !intact(env, committed, starting) {
            return false;
        }
        if responds {
            if starting {
                () = msg![env; delegate textFieldDidBeginEditing:field];
            } else {
                () = msg![env; delegate textFieldDidEndEditing:field];
            }
        }
        intact(env, committed, starting)
    })();
    release(env, delegate);
    release(env, field);
    state(env).depth = 0;
    let current = env.framework_state.uikit.ui_responder.first_responder;
    if current == nil {
        state(env).ambiguous = false;
    }
    if result
        && starting
        && current == field
        && state(env).epoch == epoch
        && !state(env).ambiguous
        && env.objc.get_host_object(field).is_some()
    {
        let epoch = unsafe { touchhle_web_text_focus(1) };
        state(env).owner = field;
        state(env).epoch = epoch;
    }
    result
}
