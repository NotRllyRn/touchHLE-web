/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
//! Navigation-item state, independent of navigation-bar rendering.

use crate::objc::{id, msg, nil, objc_classes, release, ClassExports, HostObject, NSZonePtr};

#[derive(Default)]
struct UINavigationItemHostObject {
    /// Owned copy of the title, or nil.
    title: id,
}
impl HostObject for UINavigationItemHostObject {}

pub const CLASSES: ClassExports = objc_classes! {

(env, this, _cmd);

@implementation UINavigationItem: NSObject

+ (id)allocWithZone:(NSZonePtr)_zone {
    env.objc.alloc_object(this, Box::<UINavigationItemHostObject>::default(), &mut env.mem)
}

- (id)initWithTitle:(id)title { // NSString*
    () = msg![env; this setTitle:title];
    this
}

- (id)title {
    env.objc.borrow::<UINavigationItemHostObject>(this).title
}

- (())setTitle:(id)title { // NSString*, copy
    // Copy first: the input may be the currently owned title. Guest copy and
    // dealloc implementations may reenter, so neither runs under a host borrow.
    let title: id = msg![env; title copy];
    let old = std::mem::replace(
        &mut env.objc.borrow_mut::<UINavigationItemHostObject>(this).title,
        title,
    );
    release(env, old);
}

- (())dealloc {
    let title = std::mem::replace(
        &mut env.objc.borrow_mut::<UINavigationItemHostObject>(this).title,
        nil,
    );
    release(env, title);
    env.objc.dealloc_object(this, &mut env.mem);
}

@end

};
