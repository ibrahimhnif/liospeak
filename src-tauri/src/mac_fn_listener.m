#import <Cocoa/Cocoa.h>

typedef void (*FnKeyCallback)(int is_pressed);

#ifdef __cplusplus
extern "C" {
#endif

void start_mac_fn_listener(FnKeyCallback callback);
void stop_mac_fn_listener(void);
int is_cursor_in_text_input(void);

#ifdef __cplusplus
}
#endif

static id g_global_monitor = nil;
static id g_local_monitor = nil;
static BOOL g_was_pressed = NO;
static NSTimeInterval g_last_fn_event_time = 0;

void start_mac_fn_listener(FnKeyCallback callback) {
    if (g_global_monitor != nil) {
        return;
    }

    g_was_pressed = NO;
    g_last_fn_event_time = 0;

    // Monitor modifier key changes across external active applications
    g_global_monitor = [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskFlagsChanged
        handler:^(NSEvent *event) {
            BOOL is_pressed = (event.modifierFlags & NSEventModifierFlagFunction) != 0;
            NSTimeInterval now = [NSDate timeIntervalSinceReferenceDate];
            if (is_pressed != g_was_pressed) {
                // Reject rapid key bouncing within 120ms
                if (now - g_last_fn_event_time < 0.12) {
                    return;
                }
                g_last_fn_event_time = now;
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
            NSTimeInterval now = [NSDate timeIntervalSinceReferenceDate];
            if (is_pressed != g_was_pressed) {
                if (now - g_last_fn_event_time < 0.12) {
                    return event;
                }
                g_last_fn_event_time = now;
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

int is_cursor_in_text_input(void) {
    AXUIElementRef systemWide = AXUIElementCreateSystemWide();
    if (!systemWide) {
        return 1; // Fallback: allow if Accessibility is unavailable
    }

    AXUIElementRef focusedElement = NULL;
    AXError err = AXUIElementCopyAttributeValue(systemWide, kAXFocusedUIElementAttribute, (CFTypeRef *)&focusedElement);
    CFRelease(systemWide);

    if (err != kAXErrorSuccess || !focusedElement) {
        return 0; // No focused UI element
    }

    // 1. Check if AXValue is settable (editable input / textarea)
    Boolean isSettable = false;
    if (AXUIElementIsAttributeSettable(focusedElement, kAXValueAttribute, &isSettable) == kAXErrorSuccess) {
        if (isSettable) {
            CFRelease(focusedElement);
            return 1;
        }
    }

    // 2. Check kAXRoleAttribute (AXTextField, AXTextArea, AXComboBox, AXSearchField)
    CFTypeRef roleRef = NULL;
    if (AXUIElementCopyAttributeValue(focusedElement, kAXRoleAttribute, &roleRef) == kAXErrorSuccess && roleRef) {
        NSString *role = (__bridge NSString *)roleRef;
        BOOL isTextRole = [role isEqualToString:@"AXTextField"] ||
                          [role isEqualToString:@"AXTextArea"] ||
                          [role isEqualToString:@"AXComboBox"] ||
                          [role isEqualToString:@"AXSearchField"];
        CFRelease(roleRef);
        if (isTextRole) {
            CFRelease(focusedElement);
            return 1;
        }
    }

    // 3. Check kAXSubroleAttribute (e.g. contentEditable in browsers/Slack/Notion)
    CFTypeRef subroleRef = NULL;
    if (AXUIElementCopyAttributeValue(focusedElement, kAXSubroleAttribute, &subroleRef) == kAXErrorSuccess && subroleRef) {
        NSString *subrole = (__bridge NSString *)subroleRef;
        BOOL isTextSubrole = [subrole isEqualToString:@"AXContentEditable2"] ||
                             [subrole isEqualToString:@"AXContentEditable"] ||
                             [subrole isEqualToString:@"AXPlainText"] ||
                             [subrole isEqualToString:@"AXSearchField"];
        CFRelease(subroleRef);
        if (isTextSubrole) {
            CFRelease(focusedElement);
            return 1;
        }
    }

    CFRelease(focusedElement);
    return 0;
}

