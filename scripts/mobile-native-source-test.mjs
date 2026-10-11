// Compile the real resolver and execute the native command with a held resolver.
// No account, device, or network is used by these tests.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const harness = join(root, 'src-tauri/target/native-source-regressions');
mkdirSync(join(harness, 'src'), { recursive: true });
const commands = readFileSync(join(root, 'src-tauri/src/audio/commands.rs'), 'utf8');
const start = commands.indexOf('pub async fn audio_load_mobile_source(');
assert(start >= 0);
const mobileBlock = commands.indexOf('\n    {', start) + 5;
assert.equal(commands[mobileBlock], '{');
let end = mobileBlock + 1, depth = 1;
while (depth && end < commands.length) {
  if (commands[end] === '{') depth++;
  if (commands[end] === '}') depth--;
  end++;
}
assert.equal(depth, 0);
const body = commands.slice(mobileBlock, end);
writeFileSync(join(harness, 'Cargo.toml'), `[package]
name = "lomify-native-source-regressions"
version = "0.1.0"
edition = "2021"
[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
base64 = "0.22"
hmac = "0.12"
md-5 = "0.10"
sha2 = "0.10"
hex = "0.4"
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "json"] }
urlencoding = "2"
tokio = { version = "1", features = ["macros", "rt", "sync"] }
`);
writeFileSync(join(harness, 'src/lib.rs'), `#![allow(dead_code)]
use std::sync::{Arc, atomic::{AtomicU64, AtomicUsize, Ordering}};
use audio::background::BackgroundTrack;
mod audio {
    #[path = ${JSON.stringify(join(root, 'src-tauri/src/audio/background.rs'))}]
    pub mod background;
    #[path = ${JSON.stringify(join(root, 'src-tauri/src/audio/background_source.rs'))}]
    pub mod background_source;
}
mod track_cache {
    pub async fn background_stream_url(_: &str) -> Result<Option<String>, String> {
        panic!("Tests must not access a real account or network");
    }
    pub fn cache_background_track(_: &super::AppHandle, _: &super::BackgroundTrack, _: String) {}
}
struct AudioState { load_gen: AtomicU64 }
struct AudioLoadResult { duration_secs: Option<f64>, superseded: bool }
struct AppHandle;
impl AppHandle { fn path(&self) -> Self { Self } fn app_cache_dir(&self) -> Result<std::path::PathBuf, ()> { Err(()) } }
mod background_source {
    pub static STARTED: tokio::sync::Notify = tokio::sync::Notify::const_new();
    pub static FINISH: tokio::sync::Notify = tokio::sync::Notify::const_new();
    pub async fn resolve(_: &super::BackgroundTrack) -> Result<String, String> {
        STARTED.notify_one();
        FINISH.notified().await;
        Ok("https://example.invalid/audio".into())
    }
}
mod command_regression {
    use super::*;
    pub mod background {
        use super::*;
        pub static EPOCH: AtomicU64 = AtomicU64::new(5);
        pub struct Status { pub epoch: u64 }
        pub fn status() -> Status { Status { epoch: EPOCH.load(Ordering::Relaxed) } }
        pub fn prepare(_: u64, _: Vec<BackgroundTrack>) {}
        pub fn prepare_previous(_: u64, _: Option<BackgroundTrack>, _: Option<BackgroundTrack>) {}
    }
    mod engine {
        use super::*;
        pub static LOADS: AtomicUsize = AtomicUsize::new(0);
        pub async fn load_url(_: String, _: Option<String>, _: Option<String>, _: Option<std::path::PathBuf>,
            _: Option<String>, _: bool, _: u64, _: u64, _: &AppHandle, _: Arc<AudioState>) -> Result<AudioLoadResult, String> {
            LOADS.fetch_add(1, Ordering::Relaxed);
            Ok(AudioLoadResult { duration_secs: Some(180.0), superseded: false })
        }
    }
    fn audio_set_metadata(_: String, _: String, _: Option<String>, _: f64, _: Arc<AudioState>) {}
    async fn load(state: Arc<AudioState>) -> Result<AudioLoadResult, String> {
        let source = super::fixture();
        let candidates = vec![]; let previous = None; let epoch = 5;
        let crossfade_ms = None; let remaining_ms = None; let app = AppHandle;
        ${body}
    }
    #[tokio::test]
    async fn stop_or_replacement_during_resolution_cannot_start_audio() {
        for (cancel, replace) in [(true, false), (false, true), (false, false)] {
            background::EPOCH.store(5, Ordering::Relaxed);
            engine::LOADS.store(0, Ordering::Relaxed);
            let state = Arc::new(AudioState { load_gen: AtomicU64::new(1) });
            let task = tokio::spawn(load(state.clone()));
            super::background_source::STARTED.notified().await;
            if cancel { state.load_gen.fetch_add(1, Ordering::Relaxed); }
            if replace { background::EPOCH.store(6, Ordering::Relaxed); }
            super::background_source::FINISH.notify_one();
            let result = task.await.unwrap().unwrap();
            assert_eq!(result.superseded, cancel || replace);
            assert_eq!(engine::LOADS.load(Ordering::Relaxed), usize::from(!cancel && !replace));
        }
    }
}
fn fixture() -> BackgroundTrack {
    serde_json::from_str(r#"{"key":"lomify:yandex:42","title":"Test","artist":"Test","url":"https://example.invalid/audio","resolver":{"kind":"yandex","id":"42","token":"fake-session-secret","dataSaver":false}}"#).unwrap()
}
#[test]
fn credentials_are_not_in_status() {
    let _source = fixture();
    let serialized = serde_json::to_string(&audio::background::BackgroundStatus::default()).unwrap();
    assert!(!serialized.contains("secret"));
    assert!(!serialized.contains("token"));
}
#[tokio::test]
async fn direct_source_uses_prepared_url() {
    let mut source = fixture(); source.resolver = None;
    assert_eq!(audio::background_source::resolve(&source).await.unwrap(), source.url.unwrap());
}
`);
const result = spawnSync('cargo', ['test', '--offline', '--manifest-path', join(harness, 'Cargo.toml'), '--target-dir', join(root, 'src-tauri/target')], {
  cwd: root, stdio: 'inherit', env: process.env
});
process.exitCode = result.status ?? 1;
