mod commands;
mod direct_download;
mod sc_anon;
mod state;
mod transcode;
#[cfg(target_os = "ios")]
mod transcode_ios;

pub use commands::*;
pub use state::init;

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn background_cache_path(app: &tauri::AppHandle, urn: &str) -> Option<String> {
    use tauri::Manager;
    app.state::<state::TrackCacheState>().get_cache_path(urn)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn cache_background_track(
    app: &tauri::AppHandle,
    source: &crate::audio::background::BackgroundTrack,
    url: String,
) {
    use tauri::{Emitter, Manager};
    if !source.auto_cache {
        return;
    }
    let request = commands::EnsureCachedRequest {
        urn: source.key.clone(),
        cover_url: source.cover_url.clone(),
        url: Some(url),
        urls: None,
        download_urls: None,
        storage_urls: None,
        session_id: None,
        hq: false,
        duration_ms: source.duration_ms,
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let urn = request.urn.clone();
        if commands::track_ensure_cached(request, app.state::<state::TrackCacheState>())
            .await
            .is_ok()
        {
            let _ = app.emit(
                "trackCacheChanged",
                serde_json::json!({ "urn": urn, "cached": true }),
            );
        }
    });
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn background_stream_url(urn: &str) -> Result<Option<String>, String> {
    use std::sync::OnceLock;
    static ANON: OnceLock<sc_anon::AnonClient> = OnceLock::new();
    ANON.get_or_init(|| {
        sc_anon::AnonClient::new(
            reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(8))
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("SoundCloud media client"),
        )
    })
    .resolve_stream_url(urn)
    .await
}
