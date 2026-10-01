#import <UIKit/UIKit.h>
#import <UIKit/UIGestureRecognizerSubclass.h>
#import <math.h>
#import <WebKit/WebKit.h>

typedef void (*LomifyControlPressed)(const char *);
@interface LomifyGlassButton : UIButton
@property(nonatomic, copy) NSString *controlId;
@property(nonatomic, copy) NSString *configurationKey;
@end
@implementation LomifyGlassButton
@end

@interface LomifyControlClip : UIView
@end
@implementation LomifyControlClip
- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event {
    UIView *target = [super hitTest:point withEvent:event];
    return target == self ? nil : target;
}
@end

@interface LomifyControlsOverlay : UIView <WKScriptMessageHandler>
@property(nonatomic, strong) NSMutableDictionary<NSString *, LomifyGlassButton *> *buttons;
@property(nonatomic, weak) WKWebView *webView;
@property(nonatomic) LomifyControlPressed callback;
- (void)applyItems:(NSArray *)items viewportWidth:(double)viewportWidth rootMode:(BOOL)rootMode scrollEnabled:(BOOL)scrollEnabled;
@end

// These buttons sit above WebKit rather than inside its scroll view. Cancel
// UIKit's touch-following glass effect when a tap becomes a scroll, even before
// WebKit delivers its next geometry message. This observer never claims a pan.
@interface LomifyControlTouchObserver : UIGestureRecognizer
@property(nonatomic, weak) LomifyControlsOverlay *overlay;
@property(nonatomic) CGPoint origin;
@end
@implementation LomifyControlTouchObserver
- (BOOL)canPreventGestureRecognizer:(UIGestureRecognizer *)other { return NO; }
- (BOOL)canBePreventedByGestureRecognizer:(UIGestureRecognizer *)other { return NO; }
- (void)touchesBegan:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
    self.origin = [touches.anyObject locationInView:self.view];
}
- (void)touchesMoved:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
    CGPoint point = [touches.anyObject locationInView:self.view];
    if (hypot(point.x - self.origin.x, point.y - self.origin.y) <= 8) return;
    for (LomifyGlassButton *button in self.overlay.buttons.allValues) {
        if (button.tracking) { [button cancelTrackingWithEvent:event]; button.highlighted = NO; }
    }
    self.state = UIGestureRecognizerStateFailed;
}
- (void)touchesEnded:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event { self.state = UIGestureRecognizerStateFailed; }
- (void)touchesCancelled:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event { self.state = UIGestureRecognizerStateFailed; }
@end

@implementation LomifyControlsOverlay
- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event {
    UIView *target = [super hitTest:point withEvent:event];
    return target == self ? nil : target;
}
- (void)pressed:(LomifyGlassButton *)button {
    if (self.callback && button.enabled) self.callback(button.controlId.UTF8String);
}
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    if (![message.body isKindOfClass:NSDictionary.class] || !message.frameInfo.isMainFrame) return;
    NSDictionary *body = message.body;
    if (![body[@"buttons"] isKindOfClass:NSArray.class]) return;
    [self applyItems:body[@"buttons"] viewportWidth:[body[@"viewportWidth"] doubleValue]
           rootMode:[body[@"rootMode"] boolValue] scrollEnabled:[body[@"scrollEnabled"] boolValue]];
}
- (void)applyItems:(NSArray *)items viewportWidth:(double)viewportWidth rootMode:(BOOL)rootMode scrollEnabled:(BOOL)scrollEnabled {
    WKWebView *webView = self.webView;
    if (!webView.window || viewportWidth <= 0) return;
    if (@available(iOS 26.0, *)) {
        [UIView performWithoutAnimation:^{
            [CATransaction begin];
            [CATransaction setDisableActions:YES];
            self.frame = webView.frame;
            webView.scrollView.scrollEnabled = !rootMode || scrollEnabled;
            CGFloat scale = webView.bounds.size.width / viewportWidth;
            NSMutableSet<NSString *> *activeIds = [NSMutableSet new];
            for (NSDictionary *item in items) {
                if (![item isKindOfClass:NSDictionary.class]) continue;
                NSString *identifier = item[@"id"];
                NSArray *tint = item[@"tint"];
                if (![identifier isKindOfClass:NSString.class] || ![tint isKindOfClass:NSArray.class] || tint.count != 3) continue;
                LomifyGlassButton *button = self.buttons[identifier];
                if (!button) {
                    button = [LomifyGlassButton new];
                    button.controlId = identifier;
                    [button addTarget:self action:@selector(pressed:) forControlEvents:UIControlEventTouchUpInside];
                    LomifyControlClip *clip = [LomifyControlClip new];
                    clip.clipsToBounds = YES;
                    [clip addSubview:button];
                    [self addSubview:clip];
                    self.buttons[identifier] = button;
                }
                UIColor *accent = [UIColor colorWithRed:[tint[0] doubleValue] green:[tint[1] doubleValue] blue:[tint[2] doubleValue] alpha:1];
                NSString *symbol = item[@"symbol"];
                BOOL prominent = [item[@"prominent"] boolValue], selected = [item[@"selected"] boolValue];
                BOOL plain = [item[@"style"] isEqualToString:@"plain"];
                NSString *key = [NSString stringWithFormat:@"%@/%@/%@/%d/%d/%d", symbol, item[@"iconSize"], tint, prominent, selected, plain];
                if (![button.configurationKey isEqualToString:key]) {
                    UIButtonConfiguration *configuration = plain ? UIButtonConfiguration.plainButtonConfiguration : prominent ? UIButtonConfiguration.prominentGlassButtonConfiguration : UIButtonConfiguration.glassButtonConfiguration;
                    configuration.cornerStyle = UIButtonConfigurationCornerStyleCapsule;
                    configuration.image = [UIImage systemImageNamed:symbol];
                    configuration.preferredSymbolConfigurationForImage = [UIImageSymbolConfiguration configurationWithPointSize:[item[@"iconSize"] doubleValue] weight:UIImageSymbolWeightRegular];
                    configuration.baseForegroundColor = plain ? UIColor.whiteColor : prominent ? UIColor.whiteColor : selected ? accent : UIColor.labelColor;
                    if (plain && selected) configuration.background.backgroundColor = [UIColor.whiteColor colorWithAlphaComponent:0.14];
                    configuration.contentInsets = NSDirectionalEdgeInsetsZero;
                    button.tintColor = accent;
                    button.configuration = configuration;
                    button.configurationKey = key;
                }
                // Content controls belong to the actual native scrolling
                // coordinate space; fixed player controls stay in the overlay.
                UIView *host = [item[@"rootScroll"] boolValue] ? webView.scrollView : self;
                if (button.superview.superview != host) [host addSubview:button.superview];
                CGFloat clipX = [item[@"clipX"] doubleValue], clipY = [item[@"clipY"] doubleValue];
                button.superview.frame = CGRectMake(clipX * scale, clipY * scale, [item[@"clipWidth"] doubleValue] * scale, [item[@"clipHeight"] doubleValue] * scale);
                button.frame = CGRectMake(([item[@"x"] doubleValue] - clipX) * scale, ([item[@"y"] doubleValue] - clipY) * scale, [item[@"width"] doubleValue] * scale, [item[@"height"] doubleValue] * scale);
                button.enabled = [item[@"enabled"] boolValue];
                button.selected = selected;
                button.accessibilityLabel = item[@"label"];
                [activeIds addObject:identifier];
            }
            for (NSString *identifier in self.buttons.allKeys) {
                if (![activeIds containsObject:identifier]) {
                    [self.buttons[identifier].superview removeFromSuperview];
                    [self.buttons removeObjectForKey:identifier];
                }
            }
            [self layoutIfNeeded];
            [CATransaction commit];
        }];
    }
}
@end

static LomifyControlsOverlay *controls;

int lomify_controls_update(void *pointer, const char *json, double viewportWidth, int rootMode, int scrollEnabled, LomifyControlPressed callback) {
    @autoreleasepool {
        if (![NSThread isMainThread]) return 0;
        if (@available(iOS 26.0, *)) {
            WKWebView *webView = (__bridge WKWebView *)pointer;
            if (!webView.superview || !webView.window || viewportWidth <= 0) return 0;
            NSData *data = [[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding];
            NSArray *items = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
            if (![items isKindOfClass:NSArray.class]) return 0;
            if (!controls) {
                controls = [[LomifyControlsOverlay alloc] initWithFrame:webView.frame];
                controls.backgroundColor = UIColor.clearColor;
                controls.overrideUserInterfaceStyle = UIUserInterfaceStyleDark;
                controls.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
                controls.buttons = [NSMutableDictionary new];
                controls.callback = callback;
                controls.webView = webView;
                controls.clipsToBounds = YES;
                [webView.configuration.userContentController addScriptMessageHandler:controls name:@"lomifyControls"];
                LomifyControlTouchObserver *touchObserver = [[LomifyControlTouchObserver alloc] initWithTarget:nil action:NULL];
                touchObserver.overlay = controls;
                touchObserver.cancelsTouchesInView = NO;
                touchObserver.delaysTouchesBegan = NO;
                touchObserver.delaysTouchesEnded = NO;
                [webView.superview addGestureRecognizer:touchObserver];
                [webView.superview addSubview:controls];
            }
            [controls applyItems:items viewportWidth:viewportWidth rootMode:rootMode scrollEnabled:scrollEnabled];
            return 1;
        }
        return 0;
    }
}
