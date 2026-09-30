//! Small Android handoff queue while the WebView is suspended with the screen off.
//! The UI still owns queue policy; Rust only plays the candidates it prepared.
#[cfg(target_os = "android")]
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "android")]
use super::{engine, state::AudioState};

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTrack {
    pub key: String,
    pub title: String,
    pub artist: String,
    pub cover_url: Option<String>,
    pub file_path: Option<String>,
    pub url: Option<String>,
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
}

#[derive(Default)]
struct BackgroundState {
    #[cfg(target_os = "android")]
    hidden: bool,
    #[cfg(target_os = "android")]
    candidates: VecDeque<BackgroundTrack>,
    status: BackgroundStatus,
}

static BACKGROUND: OnceLock<Mutex<BackgroundState>> = OnceLock::new();

fn state() -> &'static Mutex<BackgroundState> {
    BACKGROUND.get_or_init(|| Mutex::new(BackgroundState::default()))
}

#[cfg(target_os = "android")]
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

#[cfg(target_os = "android")]
pub fn set_hidden(hidden: bool) -> BackgroundStatus {
    let mut background = state().lock().unwrap();
    background.hidden = hidden;
    background.status.clone()
}

pub fn status() -> BackgroundStatus {
    state().lock().unwrap().status.clone()
}

/// Returns true only when Rust took responsibility for this end event.
#[cfg(target_os = "android")]
pub fn try_advance(app: &AppHandle) -> bool {
    let (epoch, candidate) = {
        let mut background = state().lock().unwrap();
        if !background.hidden {
            return false;
        }
        let Some(candidate) = background.candidates.pop_front() else {
            return false;
        };
        background.status.loading = true;
        (background.status.epoch, candidate)
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let cache_dir = app
            .path()
            .app_cache_dir()
            .ok()
            .map(|p| p.join("audio-normalization"));
        let result = if let Some(path) = candidate.file_path.clone() {
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
        } else if let Some(url) = candidate.url.clone() {
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
        } else {
            Err("background track has no source".into())
        };

        match result {
            Ok(loaded) if !loaded.superseded => {
                if state().lock().unwrap().status.epoch != epoch {
                    return;
                }
                engine::play(&app, app.state::<AudioState>());
                let duration = loaded.duration_secs;
                let mut background = state().lock().unwrap();
                if background.status.epoch != epoch {
                    return;
                }
                background.status.loading = false;
                background.status.sequence += 1;
                let sequence = background.status.sequence;
                background.status.advances.push(BackgroundAdvance {
                    sequence,
                    key: candidate.key.clone(),
                    duration_secs: duration,
                });
                let status = background.status.clone();
                drop(background);
                crate::android_media::metadata(
                    &candidate.title,
                    &candidate.artist,
                    candidate.cover_url.as_deref(),
                    duration.unwrap_or(0.0),
                );
                crate::android_media::playback(true, 0.0);
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
                    let _ = app.emit("audio:ended", ());
                }
            }
        }
    });
    true
}
