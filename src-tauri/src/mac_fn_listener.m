#import <Cocoa/Cocoa.h>

typedef void (*FnKeyCallback)(int is_pressed);

static id g_global_monitor = nil;
static id g_local_monitor = nil;
static BOOL g_was_pressed = NO;

void start_mac_fn_listener(FnKeyCallback callback) {
    if (g_global_monitor != nil) {
        return;
    }

    g_was_pressed = NO;

    // Monitor modifier key changes across external active applications
    g_global_monitor = [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskFlagsChanged
        handler:^(NSEvent *event) {
            BOOL is_pressed = (event.modifierFlags & NSEventModifierFlagFunction) != 0;
            if (is_pressed != g_was_pressed) {
                g_was_pressed = is_pressed;
                if (callback) {
                    callback(is_pressed ? 1 : 0);
                }
            }
        }];

    // Monitor modifier key changes when LioSpeak itself has focus
    g_local_monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskFlagsChanged
        handler:^NSEvent *(NSEvent *event) {
            BOOL is_pressed = (event.modifierFlags & NSEventModifierFlagFunction) != 0;
            if (is_pressed != g_was_pressed) {
                g_was_pressed = is_pressed;
                if (callback) {
                    callback(is_pressed ? 1 : 0);
                }
            }
            return event;
        }];
}

void stop_mac_fn_listener(void) {
    if (g_global_monitor != nil) {
        [NSEvent removeMonitor:g_global_monitor];
        g_global_monitor = nil;
    }
    if (g_local_monitor != nil) {
        [NSEvent removeMonitor:g_local_monitor];
        g_local_monitor = nil;
    }
    g_was_pressed = NO;
}

void get_mac_cursor_pos(double *out_x, double *out_y, double *out_screen_w, double *out_screen_h) {
    CGEventRef event = CGEventCreate(NULL);
    CGPoint point = CGPointZero;
    if (event) {
        point = CGEventGetLocation(event);
        CFRelease(event);
    } else {
        NSPoint mouseLoc = [NSEvent mouseLocation];
        NSScreen *primary = [NSScreen screens].firstObject;
        double sHeight = primary ? primary.frame.size.height : 1080.0;
        point = CGPointMake(mouseLoc.x, sHeight - mouseLoc.y);
    }

    if (out_x) *out_x = (double)point.x;
    if (out_y) *out_y = (double)point.y;

    NSScreen *currentScreen = [NSScreen mainScreen];
    if (!currentScreen) {
        currentScreen = [NSScreen screens].firstObject;
    }
    if (currentScreen) {
        if (out_screen_w) *out_screen_w = (double)currentScreen.frame.size.width;
        if (out_screen_h) *out_screen_h = (double)currentScreen.frame.size.height;
    } else {
        if (out_screen_w) *out_screen_w = 1920.0;
        if (out_screen_h) *out_screen_h = 1080.0;
    }
}

