/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
// Deliberately self-contained declarations: also syntax-checkable without an SDK.
typedef signed char BOOL;
typedef unsigned long NSUInteger;
#define nil ((id)0)
@interface NSObject
+ (id)new;
+ (id)alloc;
- (id)init;
- (id)retain;
- (void)release;
- (id)autorelease;
- (void)dealloc;
- (BOOL)respondsToSelector:(SEL)selector;
@end
@interface NSString : NSObject
+ (id)stringWithUTF8String:(const char *)string;
- (BOOL)isEqualToString:(NSString *)other;
@end
@interface NSMutableString : NSString
- (id)initWithUTF8String:(const char *)string;
- (void)setString:(NSString *)string;
@end
@interface NSAutoreleasePool : NSObject
- (void)drain;
@end
@interface UINavigationItem : NSObject
- (id)initWithTitle:(NSString *)title;
- (NSString *)title;
- (void)setTitle:(NSString *)title;
@end
@interface UIViewController : NSObject
- (UINavigationItem *)navigationItem;
- (void)loadView;
- (void)viewDidLoad;
@end
@interface UINavigationController : UIViewController
@end

static int loaded, appeared, controller_deallocs, probe_deallocs, probe_copies, bad_reentry;
static UINavigationItem *observed_item;
static id expected_title;
@interface NavigationProbeController : UIViewController
@end
@implementation NavigationProbeController
- (void)loadView { loaded++; }
- (void)viewDidLoad { appeared++; }
- (void)dealloc { controller_deallocs++; [super dealloc]; }
@end

// A copyable ownership probe (not a string-content oracle). Real mutable-string
// copies are tested separately. The setter's guest copy/release messages reenter.
@interface NavigationCopyProbe : NSObject
- (id)copyWithZone:(void *)zone;
@end
@implementation NavigationCopyProbe
- (id)copyWithZone:(void *)zone { (void)zone; probe_copies++; return [self retain]; }
- (void)dealloc {
  probe_deallocs++;
  if (observed_item && [observed_item title] != expected_title) bad_reentry++;
  [super dealloc];
}
@end

#define NAV_CHECK(condition, code) do { if (!(condition)) return (code); } while (0)
int test_NavigationItem(void) {
  loaded = appeared = controller_deallocs = probe_deallocs = probe_copies = bad_reentry = 0;
  observed_item = nil;
  expected_title = nil;
  NSAutoreleasePool *pool = [NSAutoreleasePool new];
  NavigationProbeController *controller = [NavigationProbeController new];
  NSAutoreleasePool *creation_pool = [NSAutoreleasePool new];
  UINavigationItem *item = [controller navigationItem];
  [creation_pool drain];
  NAV_CHECK(item && item == [controller navigationItem], -1);
  NAV_CHECK(loaded == 0 && appeared == 0, -2);
  UIViewController *other = [UIViewController new];
  NAV_CHECK(item != [other navigationItem], -3);
  UINavigationController *nav = [UINavigationController new];
  NAV_CHECK([nav navigationItem] && [nav navigationItem] == [nav navigationItem]
            && [nav navigationItem] != item, -4);
  NAV_CHECK([item title] == nil, -5);
  NAV_CHECK(![item respondsToSelector:@selector(navigationItemUnknown033)], -6);

  NSMutableString *source = [[NSMutableString alloc] initWithUTF8String:"first"];
  NSString *first = [NSString stringWithUTF8String:"first"];
  NSString *second = [NSString stringWithUTF8String:"second"];
  UINavigationItem *standalone = [[UINavigationItem alloc] initWithTitle:source];
  NAV_CHECK([[standalone title] isEqualToString:first], -7);
  [source setString:second];
  NAV_CHECK([[standalone title] isEqualToString:first], -8);
  [standalone setTitle:source];
  [source setString:first];
  NAV_CHECK([[standalone title] isEqualToString:second], -9);
  [standalone setTitle:[standalone title]];
  NAV_CHECK([[standalone title] isEqualToString:second], -10);
  [standalone setTitle:nil];
  NAV_CHECK([standalone title] == nil, -11);
  [source release];
  [standalone release];

  // Getter is +0 but the controller owns it across a nested pool drain.
  NSAutoreleasePool *nested = [NSAutoreleasePool new];
  NAV_CHECK(item == [controller navigationItem], -12);
  [nested drain];
  NAV_CHECK(item == [controller navigationItem], -13);
  [item retain];
  [controller release];
  NAV_CHECK(controller_deallocs == 1 && [item title] == nil, -14);

  // Probe becomes owned solely by the item. Clearing must publish nil before
  // the old title's dealloc callback reads the property.
  NavigationCopyProbe *probe = [NavigationCopyProbe new];
  [item setTitle:(NSString *)probe];
  [probe release];
  [item setTitle:[item title]];
  NAV_CHECK(probe_copies == 2 && probe_deallocs == 0, -18);
  observed_item = item;
  expected_title = nil;
  [item setTitle:nil];
  NAV_CHECK(probe_deallocs == 1 && bad_reentry == 0, -15);
  // Item deallocation must also clear before releasing its owned title.
  probe = [NavigationCopyProbe new];
  [item setTitle:(NSString *)probe];
  [probe release];
  [item release];
  observed_item = nil;
  NAV_CHECK(probe_deallocs == 2 && bad_reentry == 0, -16);

  // Without an external retain, controller teardown releases its item/title.
  controller = [NavigationProbeController new];
  probe = [NavigationCopyProbe new];
  [[controller navigationItem] setTitle:(NSString *)probe];
  [probe release];
  [controller release];
  NAV_CHECK(controller_deallocs == 2 && probe_deallocs == 3, -17);
  [other release];
  [nav release]; // Empty stack: does not exercise the pre-existing stack leak.
  [pool drain];
  return 0;
}
