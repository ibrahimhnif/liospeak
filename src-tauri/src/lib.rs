use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

use std::sync::Mutex;
use std::time::Instant;

static LAST_PASTE: Mutex<Option<(String, Instant)>> = Mutex::new(None);

#[tauri::command]
fn paste_text(app: AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;

    // Strict Rust-level deduplication: reject identical text within 1500ms
    if let Ok(mut guard) = LAST_PASTE.lock() {
        if let Some((ref last_text, ref last_time)) = *guard {
            if last_text == &text && last_time.elapsed().as_millis() < 1500 {
                println!("[Rust paste_text] Suppressing duplicate paste request within 1500ms");
                return Ok(());
            }
        }
        *guard = Some((text.clone(), Instant::now()));
    }

    // 1. Copy text to clipboard
    app.clipboard()
        .write_text(text)
        .map_err(|e| format!("Gagal menyalin ke clipboard: {}", e))?;

    // 2. Wait a brief moment for the OS clipboard buffer to propagate
    std::thread::sleep(std::time::Duration::from_millis(60));

    // 3. Simulate Cmd+V (macOS) or Ctrl+V (Windows/Linux)
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| format!("Gagal inisialisasi Enigo: {:?}", e))?;

    #[cfg(target_os = "macos")]
    {
        let _ = enigo.key(Key::Meta, Direction::Press);
        std::thread::sleep(std::time::Duration::from_millis(25));
        let _ = enigo.key(Key::Unicode('v'), Direction::Click);
        std::thread::sleep(std::time::Duration::from_millis(25));
        let _ = enigo.key(Key::Meta, Direction::Release);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = enigo.key(Key::Control, Direction::Press);
        std::thread::sleep(std::time::Duration::from_millis(25));
        let _ = enigo.key(Key::Unicode('v'), Direction::Click);
        std::thread::sleep(std::time::Duration::from_millis(25));
        let _ = enigo.key(Key::Control, Direction::Release);
    }

    Ok(())
}

#[cfg(target_os = "macos")]
extern "C" {
    fn start_mac_fn_listener(callback: extern "C" fn(i32));
    fn stop_mac_fn_listener();
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventCreate(source: *const std::ffi::c_void) -> *mut std::ffi::c_void;
    fn CGEventGetLocation(event: *mut std::ffi::c_void) -> CGPoint;
    fn CFRelease(cf: *mut std::ffi::c_void);
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Copy, Clone, Debug)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[cfg(target_os = "macos")]
fn get_cursor_position() -> (f64, f64) {
    unsafe {
        let event = CGEventCreate(std::ptr::null());
        if !event.is_null() {
            let loc = CGEventGetLocation(event);
            CFRelease(event);
            (loc.x, loc.y)
        } else {
            (960.0, 540.0)
        }
    }
}

#[tauri::command]
fn show_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("overlay") {
        #[cfg(target_os = "macos")]
        {
            let (cur_x, cur_y) = get_cursor_position();

            // Detect current active monitor dimensions dynamically
            let (screen_w, screen_h) = if let Ok(Some(monitor)) = window.current_monitor() {
                let scale = monitor.scale_factor();
                let size = monitor.size();
                (size.width as f64 / scale, size.height as f64 / scale)
            } else {
                (1920.0, 1080.0)
            };

            let overlay_w = 380.0f64;
            let overlay_h = 88.0f64;

            // Position centered horizontally under cursor, slightly below the mouse pointer
            let mut target_x = cur_x - (overlay_w / 2.0);
            let mut target_y = cur_y + 24.0;

            // If too close to bottom of screen, position above the cursor
            if target_y + overlay_h > screen_h - 20.0 {
                target_y = (cur_y - overlay_h - 16.0).max(20.0);
            }

            // Clamp horizontally to stay inside screen bounds
            if target_x < 16.0 {
                target_x = 16.0;
            } else if target_x + overlay_w > screen_w - 16.0 {
                target_x = (screen_w - overlay_w - 16.0).max(16.0);
            }

            let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
                target_x, target_y,
            )));
        }

        let _ = window.show();
        let _ = window.set_always_on_top(true);
    }
    Ok(())
}

#[tauri::command]
fn hide_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
fn hide_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
}

use tauri::Emitter;

static APP_HANDLE: Mutex<Option<AppHandle>> = Mutex::new(None);

#[cfg(target_os = "macos")]
extern "C" fn on_fn_key_changed(is_pressed: i32) {
    if let Ok(guard) = APP_HANDLE.lock() {
        if let Some(ref app) = *guard {
            let state = if is_pressed == 1 { "pressed" } else { "released" };
            let _ = app.emit("fn-key-state", state);
        }
    }
}

#[tauri::command]
fn set_fn_listener_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(mut guard) = APP_HANDLE.lock() {
            *guard = Some(app);
        }
        if enabled {
            unsafe {
                start_mac_fn_listener(on_fn_key_changed);
            }
        } else {
            unsafe {
                stop_mac_fn_listener();
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, enabled);
    }
    Ok(())
}

#[tauri::command]
fn log_to_terminal(level: String, message: String) {
    let prefix = match level.to_lowercase().as_str() {
        "error" => "\x1b[31m[LioSpeak ERROR]\x1b[0m",
        "warn" => "\x1b[33m[LioSpeak WARN]\x1b[0m",
        "info" => "\x1b[36m[LioSpeak INFO]\x1b[0m",
        _ => "\x1b[32m[LioSpeak LOG]\x1b[0m",
    };
    println!("{} {}", prefix, message);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            paste_text,
            show_overlay,
            hide_overlay,
            hide_main_window,
            show_main_window,
            set_fn_listener_enabled,
            log_to_terminal
        ])
        .setup(|app| {
            // Build Tray Menu
            let quit_i = MenuItem::with_id(app, "quit", "Keluar dari LioSpeak", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Buka Pengaturan", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                });

            #[cfg(target_os = "macos")]
            {
                tray_builder = tray_builder.icon_as_template(true);
            }

            // Load dedicated macOS Menu Bar tray icon
            let custom_tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png")).ok();
            if let Some(icon) = custom_tray_icon {
                tray_builder = tray_builder.icon(icon);
            } else if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            let _tray = tray_builder.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
