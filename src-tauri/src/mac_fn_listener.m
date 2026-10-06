#import <Cocoa/Cocoa.h>

typedef void (*FnKeyCallback)(int is_pressed);

#ifdef __cplusplus
extern "C" {
#endif

void start_mac_fn_listener(FnKeyCallback callback);
void stop_mac_fn_listener(void);

#ifdef __cplusplus
}
#endif

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
