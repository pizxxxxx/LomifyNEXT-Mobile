//! Mobile handoff queue while the WebView is suspended with the screen off.
//! The UI still owns queue policy; Rust only plays the candidates it prepared.
#[cfg(any(target_os = "android", target_os = "ios"))]
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
#[cfg(any(target_os = "android", target_os = "ios"))]
use tauri::{AppHandle, Emitter, Manager};

#[cfg(any(target_os = "android", target_os = "ios"))]
use super::{engine, state::AudioState};

#[cfg_attr(not(any(target_os = "android", target_os = "ios")), allow(dead_code))]
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTrack {
    pub key: String,
    pub title: String,
    pub artist: String,
    pub cover_url: Option<String>,
    pub file_path: Option<String>,
    pub url: Option<String>,
    /// Session-only credentials. Never part of BackgroundStatus, disk, or logs.
    pub resolver: Option<BackgroundResolver>,
    #[serde(default)]
    pub repeat: bool,
    #[serde(default)]
    pub auto_cache: bool,
    pub duration_ms: Option<u64>,
}

#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BackgroundResolver {
    Yandex {
        id: String,
        token: String,
        #[serde(default, rename = "dataSaver")]
        data_saver: bool,
    },
    Soundcloud,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundStatus {
    pub epoch: u64,
    pub sequence: u64,
    pub loading: bool,
    pub advances: Vec<BackgroundAdvance>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundAdvance {
    pub sequence: u64,
    pub key: String,
    pub duration_secs: Option<f64>,
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub previous: bool,
}

#[derive(Default)]
struct BackgroundState {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    hidden: bool,
    #[cfg(any(target_os = "android", target_os = "ios"))]
    candidates: VecDeque<BackgroundTrack>,
    #[cfg(any(target_os = "android", target_os = "ios"))]
    previous: Option<BackgroundTrack>,
    #[cfg(any(target_os = "android", target_os = "ios"))]
    current: Option<BackgroundTrack>,
    status: BackgroundStatus,
}

static BACKGROUND: OnceLock<Mutex<BackgroundState>> = OnceLock::new();

fn state() -> &'static Mutex<BackgroundState> {
    BACKGROUND.get_or_init(|| Mutex::new(BackgroundState::default()))
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn prepare(epoch: u64, candidates: Vec<BackgroundTrack>) {
    let mut background = state().lock().unwrap();
    if epoch < background.status.epoch
        || (epoch == background.status.epoch && !background.status.advances.is_empty())
    {
        return;
    }
    if epoch == background.status.epoch && background.status.loading {
        // The first entry has already been claimed by the decoder. A late
        // second resolution may extend the pending queue, but must not put the
        // currently loading entry back at its front.
        background.candidates = candidates.into_iter().skip(1).collect();
        return;
    }
    background.status.epoch = epoch;
    background.status.loading = false;
    background.status.advances.clear();
    background.candidates = candidates.into();
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn set_hidden(hidden: bool) -> BackgroundStatus {
    let mut background = state().lock().unwrap();
    background.hidden = hidden;
    background.status.clone()
}

pub fn status() -> BackgroundStatus {
    state().lock().unwrap().status.clone()
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn prepare_previous(
    epoch: u64,
    previous: Option<BackgroundTrack>,
    current: Option<BackgroundTrack>,
) {
    let mut background = state().lock().unwrap();
    if background.status.epoch != epoch
        || background.status.loading
        || !background.status.advances.is_empty()
    {
        return;
    }
    background.previous = previous;
    background.current = current;
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn is_hidden() -> bool {
    state().lock().unwrap().hidden
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn try_previous(app: &AppHandle) -> bool {
    let (epoch, candidate) = {
        let mut background = state().lock().unwrap();
        if !background.hidden {
            return false;
        }
        if background.status.loading {
            return true;
        }
        let Some(candidate) = background.previous.take() else {
            return false;
        };
        background.status.loading = true;
        (background.status.epoch, candidate)
    };
    load_candidate(app, epoch, candidate, true);
    true
}

/// Returns true only when Rust took responsibility for this end event.
#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn try_advance(app: &AppHandle) -> bool {
    let (epoch, candidate) = {
        let mut background = state().lock().unwrap();
        if !background.hidden {
            return false;
        }
        if background.status.loading {
            return true;
        }
        let Some(candidate) = background.candidates.pop_front() else {
            return false;
        };
        background.status.loading = true;
        (background.status.epoch, candidate)
    };
    load_candidate(app, epoch, candidate, false);
    true
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn load_candidate(app: &AppHandle, epoch: u64, candidate: BackgroundTrack, previous: bool) {
    let audio_generation = app.state::<AudioState>().load_gen.load(std::sync::atomic::Ordering::Relaxed);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if state().lock().unwrap().status.epoch != epoch {
            return;
        }
        if app.state::<AudioState>().load_gen.load(std::sync::atomic::Ordering::Relaxed) != audio_generation {
            state().lock().unwrap().status.loading = false;
            return;
        }
        let cache_dir = app
            .path()
            .app_cache_dir()
            .ok()
            .map(|p| p.join("audio-normalization"));
        let file_path = candidate
            .file_path
            .clone()
            .or_else(|| crate::track_cache::background_cache_path(&app, &candidate.key));
        let mut stream_url = None;
        let result = if let Some(path) = file_path {
            engine::load_file(
                path,
                cache_dir,
                Some(candidate.key.clone()),
                false,
                0,
                0,
                &app,
                app.state::<AudioState>(),
            )
            .await
        } else {
            // Signed URLs prepared in JavaScript can expire while the screen is off.
            // Resolve immediately before loading, entirely outside the WebView.
            let url = super::background_source::resolve(&candidate).await;
            if state().lock().unwrap().status.epoch != epoch {
                return;
            }
            if app.state::<AudioState>().load_gen.load(std::sync::atomic::Ordering::Relaxed) != audio_generation {
                state().lock().unwrap().status.loading = false;
                return;
            }
            match url {
                Ok(url) => {
                    stream_url = Some(url.clone());
                    engine::load_url(
                        url,
                        None,
                        None,
                        cache_dir,
                        Some(candidate.key.clone()),
                        false,
                        0,
                        0,
                        &app,
                        app.state::<AudioState>(),
                    )
                    .await
                }
                Err(error) => Err(error),
            }
        };

        match result {
            Ok(loaded) if !loaded.superseded => {
                if state().lock().unwrap().status.epoch != epoch {
                    return;
                }
                engine::play(&app, app.state::<AudioState>());
                if let Some(url) = stream_url {
                    crate::track_cache::cache_background_track(&app, &candidate, url);
                }
                let duration = loaded.duration_secs;
                let mut background = state().lock().unwrap();
                if background.status.epoch != epoch {
                    return;
                }
                background.status.loading = false;
                #[cfg(any(target_os = "android", target_os = "ios"))]
                {
                    let old = background.current.replace(candidate.clone());
                    if previous {
                        if let Some(old) = old {
                            background.candidates.push_front(old);
                        }
                    } else {
                        background.previous = old;
                    }
                    if candidate.repeat {
                        background.candidates.push_back(candidate.clone());
                    }
                }
                background.status.sequence += 1;
                let sequence = background.status.sequence;
                background.status.advances.push(BackgroundAdvance {
                    sequence,
                    key: candidate.key.clone(),
                    duration_secs: duration,
                    previous,
                });
                let status = background.status.clone();
                drop(background);
                #[cfg(target_os = "android")]
                {
                    crate::android_media::metadata(
                        &candidate.title,
                        &candidate.artist,
                        candidate.cover_url.as_deref(),
                        duration.unwrap_or(0.0),
                    );
                    crate::android_media::playback(
                        engine::is_playing(app.state::<AudioState>()),
                        0.0,
                    );
                }
                #[cfg(target_os = "ios")]
                {
                    crate::ios_media::metadata(
                        &candidate.title,
                        &candidate.artist,
                        candidate.cover_url.as_deref(),
                        duration.unwrap_or(0.0),
                    );
                    crate::ios_media::playback(
                        engine::is_playing(app.state::<AudioState>()),
                        0.0,
                        1.0,
                    );
                }
                let _ = app.emit("audio:background-advanced", status);
            }
            Ok(_) => {
                let mut background = state().lock().unwrap();
                if background.status.epoch == epoch {
                    background.status.loading = false;
                }
            }
            Err(error) => {
                eprintln!("[Audio] background next failed: {error}");
                let mut background = state().lock().unwrap();
                if background.status.epoch == epoch {
                    background.status.loading = false;
                    drop(background);
                    // A bad item must not hand the queue back to sleeping JavaScript.
                    if previous || !try_advance(&app) {
                        let _ = app.emit("audio:ended", ());
                    }
                }
            }
        }
    });
}
