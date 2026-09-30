//! One bounded, transient successor download. Never enters the offline library.
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tokio::task::JoinHandle;

const MAX_BYTES: usize = 16 * 1024 * 1024;
// Preparation begins when the current song starts, including for a quick Next tap.
// Keep the single bounded download long enough to survive a normal full song.
const TTL: Duration = Duration::from_secs(15 * 60);

struct Entry {
    url: String,
    created: Instant,
    task: JoinHandle<Result<Vec<u8>, String>>,
}

#[derive(Default)]
struct PrefetchStore {
    entry: Option<Entry>,
}

impl PrefetchStore {
    fn clear(&mut self) {
        if let Some(entry) = self.entry.take() {
            entry.task.abort();
        }
    }

    fn take(&mut self, url: &str) -> Option<JoinHandle<Result<Vec<u8>, String>>> {
        if self
            .entry
            .as_ref()
            .is_some_and(|entry| entry.created.elapsed() >= TTL)
        {
            self.clear();
        }
        if self.entry.as_ref().is_some_and(|entry| entry.url == url) {
            return self.entry.take().map(|entry| entry.task);
        }
        None
    }
}

static STORE: OnceLock<Mutex<PrefetchStore>> = OnceLock::new();

fn store() -> &'static Mutex<PrefetchStore> {
    STORE.get_or_init(|| Mutex::new(PrefetchStore::default()))
}

pub fn prepare(url: Option<String>) {
    let mut state = store().lock().unwrap();
    let Some(url) = url else {
        state.clear();
        return;
    };
    if state
        .entry
        .as_ref()
        .is_some_and(|entry| entry.url == url && entry.created.elapsed() < TTL)
    {
        return;
    }
    state.clear();
    state.entry = Some(Entry {
        url: url.clone(),
        created: Instant::now(),
        task: tokio::spawn(download(url)),
    });
}

pub async fn take(url: &str) -> Option<Vec<u8>> {
    let task = store().lock().unwrap().take(url)?;
    // Reuse an in-flight download too, avoiding two copies on a quick Next tap.
    task.await.ok()?.ok()
}

async fn download(url: String) -> Result<Vec<u8>, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|error| error.to_string())?;
    if !matches!(parsed.scheme(), "https" | "http") {
        return Err("unsupported prefetch URL".into());
    }
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0")
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;
    let mut response = client
        .get(parsed)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    if response
        .content_length()
        .is_some_and(|size| size > MAX_BYTES as u64)
    {
        return Err("prefetch size limit".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err("prefetch size limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    // HLS still goes through the existing assembly/retry path on playback.
    if bytes.is_empty() || crate::shared::hls::looks_like_playlist(&bytes) {
        return Err("prefetch requires direct audio".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(url: &str, age: Duration) -> Entry {
        Entry {
            url: url.into(),
            created: Instant::now() - age,
            task: tokio::spawn(async { Ok(vec![1, 2, 3]) }),
        }
    }

    #[tokio::test]
    async fn only_matching_source_is_consumed_once() {
        let mut cache = PrefetchStore {
            entry: Some(entry("https://audio/next", Duration::ZERO)),
        };
        assert!(cache.take("https://audio/other").is_none());
        assert_eq!(
            cache
                .take("https://audio/next")
                .unwrap()
                .await
                .unwrap()
                .unwrap(),
            vec![1, 2, 3]
        );
        assert!(cache.take("https://audio/next").is_none());
    }

    #[tokio::test]
    async fn expired_and_replaced_downloads_are_cancelled() {
        let mut cache = PrefetchStore {
            entry: Some(entry("expired", TTL)),
        };
        assert!(cache.take("expired").is_none());
        assert!(cache.entry.is_none());
        let pending =
            tokio::spawn(async { std::future::pending::<Result<Vec<u8>, String>>().await });
        let abort = pending.abort_handle();
        cache.entry = Some(Entry {
            url: "old".into(),
            created: Instant::now(),
            task: pending,
        });
        cache.clear();
        tokio::task::yield_now().await;
        assert!(abort.is_finished());
    }

    #[tokio::test]
    async fn ready_successor_survives_a_long_current_song() {
        let mut cache = PrefetchStore {
            entry: Some(entry("https://audio/next", Duration::from_secs(8 * 60))),
        };
        assert_eq!(
            cache
                .take("https://audio/next")
                .unwrap()
                .await
                .unwrap()
                .unwrap(),
            vec![1, 2, 3]
        );
    }
}
