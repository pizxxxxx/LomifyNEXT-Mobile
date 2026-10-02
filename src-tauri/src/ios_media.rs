//! System transport controls act on rodio even with a suspended WebView.
use crate::audio::{background, engine, state::AudioState};
use std::ffi::{c_char, CString};
use std::sync::{mpsc, Mutex, OnceLock};
use std::sync::atomic::Ordering;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};

static ACTIONS: OnceLock<mpsc::Sender<(i32, f64)>> = OnceLock::new();
static LAST_PLAYBACK: Mutex<Option<(bool, f64, f64, Instant)>> = Mutex::new(None);
static GATE: crate::ios_playback_gate::PlaybackGate = crate::ios_playback_gate::PlaybackGate::new();

pub fn playback_blocked() -> bool { GATE.blocked() }
pub fn request_play() { GATE.play(); }
pub fn request_pause() { GATE.pause(false); }

unsafe extern "C" {
    fn lomify_media_initialize(callback: extern "C" fn(i32, f64) -> i32);
    fn lomify_media_metadata(
        title: *const c_char,
        artist: *const c_char,
        cover: *const c_char,
        duration: f64,
    );
    fn lomify_media_playback(playing: i32, position: f64, rate: f64);
}

extern "C" fn action(kind: i32, value: f64) -> i32 {
    // Latch before queueing: a pending decode/device rebuild must stay paused
    // even if the worker is still finishing a seek.
    if matches!(kind, 1 | 6 | 10) { request_pause(); }
    if kind == 10 { GATE.pause(true); }
    i32::from(
        ACTIONS
            .get()
            .is_some_and(|tx| tx.send((kind, value)).is_ok()),
    )
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    ACTIONS
        .set(tx)
        .map_err(|_| "iOS media already initialized")?;
    let app_handle = app.clone();
    std::thread::Builder::new()
        .name("ios-media-control".into())
        .spawn(move || {
            let mut resume_after_interruption = false;
            while let Ok((kind, value)) = rx.recv() {
                let app = &app_handle;
                let state = app.state::<AudioState>();
                crate::app::diagnostics::log_native(app, "INFO", format!("[iOS media] command {kind}"));
                match kind {
                    0 | 2 if kind == 0 || !engine::is_playing(state.clone()) => {
                        resume_after_interruption = false;
                        request_play();
                        if crate::ios_audio::initialize_session().is_ok() {
                            engine::play(app, state.clone());
                            let _ = app.emit("media:play", ());
                        }
                    }
                    1 | 2 | 10 => {
                        request_pause();
                        resume_after_interruption = false;
                        engine::pause(app, state.clone());
                        let _ = app.emit("media:pause", ());
                    }
                    3 => {
                        request_play();
                        let _ = crate::ios_audio::initialize_session();
                        if !background::try_advance(app) {
                            let _ = app.emit("media:next", ());
                        }
                    }
                    4 => {
                        request_play();
                        let _ = crate::ios_audio::initialize_session();
                        if background::is_hidden() && engine::get_position(state.clone()) > 3.0 { action(5, 0.0); }
                        else if !background::try_previous(app) { let _ = app.emit("media:prev", ()); }
                    }
                    5 if value.is_finite() && value >= 0.0 => {
                        let app = app.clone();
                        let generation = state.seek_gen.fetch_add(1, Ordering::Relaxed) + 1;
                        tauri::async_runtime::spawn_blocking(move || {
                            let state = app.state::<AudioState>();
                            if state.seek_gen.load(Ordering::Relaxed) == generation && engine::seek(value, &state).is_ok() {
                                let _ = app.emit("ios-media:seeked", value);
                                playback(engine::is_playing(state.clone()), engine::get_position(state.clone()), *state.playback_rate.lock().unwrap() as f64);
                            }
                        });
                    }
                    6 => {
                        resume_after_interruption = engine::is_playing(state.clone());
                        engine::pause(app, state.clone());
                        let _ = app.emit("media:pause", ());
                    }
                    7 => {
                        if resume_after_interruption
                            && value != 0.0
                            && GATE.can_resume_interruption()
                            && crate::ios_audio::initialize_session().is_ok()
                        {
                            request_play();
                            engine::play(app, state.clone());
                            let _ = app.emit("media:play", ());
                        }
                        resume_after_interruption = false;
                    }
                    8 => {
                        background::set_hidden(true);
                    }
                    9 => {
                        background::set_hidden(false);
                    }
                    _ => {}
                }
                playback(
                    engine::is_playing(state.clone()),
                    engine::get_position(state.clone()),
                    *state.playback_rate.lock().unwrap() as f64,
                );
            }
        })
        .map_err(|error| error.to_string())?;
    app.run_on_main_thread(|| unsafe { lomify_media_initialize(action) })
        .map_err(|error| error.to_string())
}

pub fn metadata(title: &str, artist: &str, cover: Option<&str>, duration: f64) {
    let title = CString::new(title.replace('\0', "")).unwrap();
    let artist = CString::new(artist.replace('\0', "")).unwrap();
    let cover = cover.and_then(|url| CString::new(url).ok());
    *LAST_PLAYBACK.lock().unwrap() = None;
    unsafe {
        lomify_media_metadata(
            title.as_ptr(),
            artist.as_ptr(),
            cover.as_ref().map_or(std::ptr::null(), |url| url.as_ptr()),
            duration.max(0.0),
        )
    };
}

pub fn playback(playing: bool, position: f64, rate: f64) {
    if !position.is_finite() || !rate.is_finite() {
        return;
    }
    let mut last = LAST_PLAYBACK.lock().unwrap();
    if let Some((old_playing, old_position, old_rate, sent)) = *last {
        let elapsed = sent.elapsed().as_secs_f64();
        let expected = old_position + if old_playing { elapsed * old_rate } else { 0.0 };
        if playing == old_playing
            && rate == old_rate
            && (position - expected).abs() < 0.8
            && elapsed < 2.0
        {
            return;
        }
    }
    *last = Some((playing, position, rate, Instant::now()));
    unsafe { lomify_media_playback(i32::from(playing), position.max(0.0), rate) };
}
