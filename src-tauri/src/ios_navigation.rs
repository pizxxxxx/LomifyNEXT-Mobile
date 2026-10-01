//! Native UIKit tab navigation over the existing Svelte content.
use serde::{Deserialize, Serialize};
#[cfg(target_os = "ios")]
use std::{ffi::c_void, sync::OnceLock};
#[cfg(target_os = "ios")]
use tauri::{Emitter, Manager};

#[cfg(target_os = "ios")]
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

#[cfg(target_os = "ios")]
unsafe extern "C" {
    fn lomify_navigation_update(
        webview: *mut c_void,
        selected: i32,
        visible: i32,
        red: f64,
        green: f64,
        blue: f64,
        callback: extern "C" fn(i32),
    ) -> i32;
    fn lomify_controls_update(
        webview: *mut c_void,
        json: *const std::ffi::c_char,
        viewport_width: f64,
        root_mode: i32,
        scroll_enabled: i32,
        callback: extern "C" fn(*const std::ffi::c_char),
    ) -> i32;
}

#[cfg(target_os = "ios")]
extern "C" fn control_pressed(identifier: *const std::ffi::c_char) {
    if identifier.is_null() {
        return;
    }
    let id = unsafe { std::ffi::CStr::from_ptr(identifier) };
    if let (Some(app), Ok(id)) = (APP.get(), id.to_str()) {
        let _ = app.emit("ios:control", id);
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlassButton {
    id: String,
    symbol: String,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    icon_size: f64,
    style: String,
    root_scroll: bool,
    clip_x: f64,
    clip_y: f64,
    clip_width: f64,
    clip_height: f64,
    prominent: bool,
    selected: bool,
    enabled: bool,
    tint: [f64; 3],
}

#[tauri::command]
pub async fn ios_glass_buttons_update(
    app: tauri::AppHandle,
    buttons: Vec<GlassButton>,
    viewport_width: f64,
    root_mode: bool,
    scroll_enabled: bool,
) -> Result<bool, String> {
    #[cfg(target_os = "ios")]
    {
        let _ = APP.set(app.clone());
        let json = std::ffi::CString::new(
            serde_json::to_string(&buttons).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        let webview = app
            .get_webview_window("main")
            .ok_or("Main WebView unavailable")?;
        let (tx, rx) = tokio::sync::oneshot::channel();
        webview
            .with_webview(move |handle| {
                let ready = unsafe {
                    lomify_controls_update(
                        handle.inner(),
                        json.as_ptr(),
                        viewport_width,
                        i32::from(root_mode),
                        i32::from(scroll_enabled),
                        control_pressed,
                    ) != 0
                };
                let _ = tx.send(ready);
            })
            .map_err(|error| error.to_string())?;
        rx.await.map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, buttons, viewport_width, root_mode, scroll_enabled);
        Ok(false)
    }
}

#[cfg(target_os = "ios")]
extern "C" fn selected(index: i32) {
    if let (Some(app), Some(view)) = (
        APP.get(),
        ["home", "search", "library", "settings"].get(index as usize),
    ) {
        let _ = app.emit("ios:navigation", *view);
    }
}

#[tauri::command]
pub async fn ios_navigation_update(
    app: tauri::AppHandle,
    index: i32,
    visible: bool,
    tint: [f64; 3],
) -> Result<bool, String> {
    #[cfg(target_os = "ios")]
    {
        let _ = APP.set(app.clone());
        let webview = app
            .get_webview_window("main")
            .ok_or("Main WebView unavailable")?;
        let (tx, rx) = tokio::sync::oneshot::channel();
        webview
            .with_webview(move |handle| {
                let ready = unsafe {
                    lomify_navigation_update(
                        handle.inner(),
                        index,
                        i32::from(visible),
                        tint[0].clamp(0.0, 1.0),
                        tint[1].clamp(0.0, 1.0),
                        tint[2].clamp(0.0, 1.0),
                        selected,
                    ) != 0
                };
                let _ = tx.send(ready);
            })
            .map_err(|error| error.to_string())?;
        rx.await.map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, index, visible, tint);
        Ok(false)
    }
}
