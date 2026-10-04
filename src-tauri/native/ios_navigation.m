#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#include <stdint.h>

extern void lomify_haptic(int kind);

typedef void (*LomifyTabSelected)(int32_t);

// Only the system tab bar consumes touches. Content stays in the existing WebView.
@interface LomifyNavigationOverlay : UIView
@property(nonatomic, weak) UITabBar *tabBar;
@end
@implementation LomifyNavigationOverlay
- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event {
    UITabBar *bar = self.tabBar;
    if (self.hidden || bar.hidden || !bar || !CGRectContainsPoint(bar.bounds, [bar convertPoint:point fromView:self])) return nil;
    return [super hitTest:point withEvent:event];
}
@end

@interface LomifyTabs : UITabBarController <UITabBarControllerDelegate>
@property(nonatomic) LomifyTabSelected selectionCallback;
@property(nonatomic, strong) LomifyNavigationOverlay *overlay;
@end
@implementation LomifyTabs
- (void)tabBarController:(UITabBarController *)controller didSelectViewController:(UIViewController *)selected {
    if (self.selectionCallback) { lomify_haptic(0); self.selectionCallback((int32_t)controller.selectedIndex); }
}
@end

static LomifyTabs *navigation;

// Called by Tauri's with_webview on UIKit's main thread; no private APIs.
int lomify_navigation_update(void *pointer, int32_t selected, int visible,
                             double red, double green, double blue, LomifyTabSelected callback) {
    @autoreleasepool {
        if (![NSThread isMainThread]) return 0;
        WKWebView *webView = (__bridge WKWebView *)pointer;
        if (!webView.superview || !webView.window) return 0;
        if (!navigation) {
            UIResponder *responder = webView;
            while (responder && ![responder isKindOfClass:UIViewController.class]) responder = responder.nextResponder;
            UIViewController *parent = (UIViewController *)responder;
            if (!parent) return 0;
            navigation = [LomifyTabs new];
            navigation.delegate = navigation;
            navigation.selectionCallback = callback;
            navigation.overrideUserInterfaceStyle = UIUserInterfaceStyleDark;
            if (@available(iOS 18.0, *)) navigation.mode = UITabBarControllerModeTabBar;
            if (@available(iOS 26.0, *)) navigation.tabBarMinimizeBehavior = UITabBarMinimizeBehaviorNever;
            NSArray<NSString *> *titles = @[@"Моя Волна", @"Главное", @"Медиатека", @"Настройки"];
            NSArray<NSString *> *symbols = @[@"dot.radiowaves.left.and.right", @"house", @"books.vertical", @"gearshape"];
            NSArray<NSString *> *selectedSymbols = @[@"dot.radiowaves.left.and.right", @"house.fill", @"books.vertical.fill", @"gearshape.fill"];
            UIImageSymbolConfiguration *iconStyle = [UIImageSymbolConfiguration configurationWithPointSize:21 weight:UIImageSymbolWeightRegular];
            NSMutableArray<UIViewController *> *controllers = [NSMutableArray new];
            for (NSInteger index = 0; index < 4; index++) {
                UIViewController *controller = [UIViewController new];
                controller.view.backgroundColor = UIColor.clearColor;
                controller.tabBarItem = [[UITabBarItem alloc] initWithTitle:titles[index]
                    image:[UIImage systemImageNamed:symbols[index] withConfiguration:iconStyle]
                    selectedImage:[UIImage systemImageNamed:selectedSymbols[index] withConfiguration:iconStyle]];
                [controllers addObject:controller];
            }
            navigation.viewControllers = controllers;
            // Leave UITabBarAppearance untouched so UIKit renders actual Liquid Glass.
            navigation.view.backgroundColor = UIColor.clearColor;
            LomifyNavigationOverlay *overlay = [[LomifyNavigationOverlay alloc] initWithFrame:webView.frame];
            overlay.backgroundColor = UIColor.clearColor;
            overlay.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
            overlay.tabBar = navigation.tabBar;
            navigation.overlay = overlay;
            [parent addChildViewController:navigation];
            [webView.superview addSubview:overlay];
            navigation.view.frame = overlay.bounds;
            navigation.view.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
            [overlay addSubview:navigation.view];
            [navigation didMoveToParentViewController:parent];
        }
        if (selected >= 0 && selected < 4 && navigation.selectedIndex != (NSUInteger)selected)
            navigation.selectedIndex = (NSUInteger)selected;
        navigation.tabBar.tintColor = [UIColor colorWithRed:red green:green blue:blue alpha:1];
        navigation.overlay.hidden = !visible;
        return 1;
    }
}
