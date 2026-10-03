//! Android media session bridge. Audio stays in the existing rodio engine; the
//! platform service only exposes its state and forwards transport controls.
use std::sync::OnceLock;
use std::sync::mpsc;

use jni::objects::{GlobalRef, JObject, JString, JValue};
use jni::sys::{jboolean, jlong};
use jni::JNIEnv;
use tauri::{AppHandle, Emitter, Manager};

use crate::audio::{engine, state::AudioState};
use crate::audio::background;
use crate::android_playback_gate;

static APP: OnceLock<AppHandle> = OnceLock::new();
static CONTROL_TX: OnceLock<mpsc::Sender<ControlAction>> = OnceLock::new();
static SERVICE_CLASS: OnceLock<GlobalRef> = OnceLock::new();

enum ControlAction { Play, Pause, Stop, Next, Previous, Seek(f64), InterruptionEnded }

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    // FindClass on a Rust-created thread uses the bootstrap class loader, which
    // cannot see app classes. Cache the service Class via the app class loader
    // before the background audio worker needs to update the media session.
    let service_class = crate::android_audio::with_application(|env, application| {
        let loader = env
            .call_method(application, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?
            .l()?;
        let name = env.new_string("com.lomify.next.PlaybackService")?;
        let class = env
            .call_method(
                &loader,
                "loadClass",
                "(Ljava/lang/String;)Ljava/lang/Class;",
                &[JValue::Object(name.as_ref())],
            )?
            .l()?;
        env.new_global_ref(class)
    })?;
    SERVICE_CLASS
        .set(service_class)
        .map_err(|_| "Android media service class was already initialized".to_string())?;
    let _ = APP.set(app.clone());
    let (tx, rx) = mpsc::channel();
    let _ = CONTROL_TX.set(tx);
    let handle = app.clone();
    if let Err(error) = std::thread::Builder::new()
        .name("android-media-control".into())
        .spawn(move || {
            while let Ok(action) = rx.recv() {
                let state = handle.state::<AudioState>();
                match action {
                    ControlAction::Play => engine::play(&handle, state),
                    ControlAction::Pause => engine::pause(&handle, state),
                    ControlAction::Stop => engine::stop(&handle, state),
                    ControlAction::Next => {
                        if !background::try_advance(&handle) { let _ = handle.emit("media:next", ()); }
                    }
                    ControlAction::Previous => {
                        if background::is_hidden() && engine::get_position(state.clone()) > 3.0 {
                            seek(&handle, 0.0);
                        } else if !background::try_previous(&handle) { let _ = handle.emit("media:prev", ()); }
                    }
                    ControlAction::Seek(position) => seek(&handle, position),
                    ControlAction::InterruptionEnded => {
                        if android_playback_gate::finish_interruption() {
                            engine::play(&handle, state.clone());
                            if !android_playback_gate::blocked() { let _ = handle.emit("media:play", ()); }
                        }
                        playback(engine::is_playing(state.clone()), engine::get_position(state));
                    }
                }
            }
        }) {
        eprintln!("[Android media] failed to start control worker: {error}");
    }
    Ok(())
}

fn seek(app: &AppHandle, position: f64) {
    let state = app.state::<AudioState>();
    if let Err(error) = engine::seek(position, &state) {
        eprintln!("[Android media] seek failed: {error}");
    } else {
        let _ = app.emit("android-media:seeked", position);
        playback(engine::is_playing(state.clone()), engine::get_position(state));
    }
}

fn with_service<T>(
    callback: impl FnOnce(&mut JNIEnv<'_>, &JObject<'_>, &GlobalRef) -> jni::errors::Result<T>,
) -> Result<T, String> {
    let service_class = SERVICE_CLASS
        .get()
        .ok_or("Android media service class is not initialized")?;
    crate::android_audio::with_application(|env, application| {
        callback(env, application, service_class)
    })
}

pub fn metadata(title: &str, artist: &str, cover_url: Option<&str>, duration_secs: f64) {
    let result = with_service(|env, _, service_class| {
        let title = env.new_string(title)?;
        let artist = env.new_string(artist)?;
        let cover = match cover_url {
            Some(value) => Some(env.new_string(value)?),
            None => None,
        };
        let null = JObject::null();
        let cover_ref = cover.as_ref().map(JString::as_ref).unwrap_or(&null);
        env.call_static_method(
            service_class,
            "updateMetadata",
            "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;J)V",
            &[
                JValue::Object(title.as_ref()),
                JValue::Object(artist.as_ref()),
                JValue::Object(cover_ref),
                JValue::Long(seconds_to_millis(duration_secs)),
            ],
        )?;
        Ok(())
    });
    if let Err(error) = result {
        eprintln!("[Android media] metadata update failed: {error}");
    }
}

pub fn playback(playing: bool, position_secs: f64) {
    let result = with_service(|env, application, service_class| {
        env.call_static_method(
            service_class,
            "updatePlayback",
            "(Landroid/content/Context;ZJ)V",
            &[
                JValue::Object(application),
                JValue::Bool(u8::from(playing)),
                JValue::Long(seconds_to_millis(position_secs)),
            ],
        )?;
        Ok(())
    });
    if let Err(error) = result {
        eprintln!("[Android media] playback update failed: {error}");
    }
}

pub fn position(position_secs: f64) {
    let result = with_service(|env, _, service_class| {
        env.call_static_method(
            service_class,
            "updatePosition",
            "(J)V",
            &[JValue::Long(seconds_to_millis(position_secs))],
        )?;
        Ok(())
    });
    if let Err(error) = result {
        eprintln!("[Android media] position update failed: {error}");
    }
}

fn seconds_to_millis(value: f64) -> i64 {
    if value.is_finite() && value > 0.0 {
        (value * 1000.0).min(i64::MAX as f64) as i64
    } else {
        0
    }
}

/// Activity lifecycle reaches Rust even when the WebView cannot dispatch its
/// visibilitychange callback before Android suspends the renderer.
#[no_mangle]
pub extern "system" fn Java_com_lomify_next_MainActivity_nativeVisibilityChanged(
    _env: JNIEnv,
    _activity: JObject,
    hidden: jboolean,
) {
    crate::audio::background::set_hidden(hidden != 0);
}

#[no_mangle]
pub extern "system" fn Java_com_lomify_next_MainActivity_nativeAudioOutputLost(
    _env: JNIEnv,
    _activity: JObject,
) {
    android_playback_gate::request_pause();
    let _ = CONTROL_TX.get().map(|tx| tx.send(ControlAction::Pause));
    if let Some(app) = APP.get() { let _ = app.emit("media:pause", ()); }
}

/// Called by MediaSession callbacks. The main rodio engine responds directly to
/// play/pause, so those buttons work even while Android throttles the WebView.
#[no_mangle]
pub extern "system" fn Java_com_lomify_next_PlaybackService_nativeMediaAction(
    mut env: JNIEnv,
    _service: JObject,
    action: JString,
    value: jlong,
) {
    let Ok(action) = env.get_string(&action) else {
        return;
    };
    let action = action.to_string_lossy();
    let Some(app) = APP.get() else { return };
    match action.as_ref() {
        "focus_loss_transient" => {
            android_playback_gate::begin_interruption(value != 0);
            let _ = CONTROL_TX.get().map(|tx| tx.send(ControlAction::Pause));
            let _ = app.emit("media:pause", ());
        }
        "focus_gain" => {
            let _ = CONTROL_TX.get().map(|tx| tx.send(ControlAction::InterruptionEnded));
        }
        "play" => {
            android_playback_gate::request_play();
            let _ = CONTROL_TX.get().map(|tx| tx.send(ControlAction::Play));
            let _ = app.emit("media:play", ());
        }
        "pause" => {
            android_playback_gate::request_pause();
            let _ = CONTROL_TX.get().map(|tx| tx.send(ControlAction::Pause));
            let _ = app.emit("media:pause", ());
        }
        "next" => {
            android_playback_gate::request_play();
            let _ = CONTROL_TX.get().map(|tx| tx.send(ControlAction::Next));
        }
        "previous" => {
            android_playback_gate::request_play();
            let _ = CONTROL_TX.get().map(|tx| tx.send(ControlAction::Previous));
        }
        "seek" => {
            let position = (value.max(0) as f64) / 1000.0;
            let _ = CONTROL_TX.get().map(|tx| tx.send(ControlAction::Seek(position)));
        }
        "stop" => {
            android_playback_gate::request_pause();
            let _ = CONTROL_TX.get().map(|tx| tx.send(ControlAction::Stop));
            let _ = app.emit("media:pause", ());
        }
        _ => {}
    }
}
