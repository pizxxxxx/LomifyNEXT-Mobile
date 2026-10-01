//! The cache pipeline uses the same operations on iOS through linked libraries.
use crate::ios_audio;
use std::path::{Path, PathBuf};

#[derive(Clone)]
pub struct Backend;

pub fn backend_label(_backend: &Backend) -> String {
    "linked FFmpeg 8.1".into()
}

pub async fn acquire_ffmpeg(_install_dir: &Path) -> Option<Backend> {
    Some(Backend)
}

pub async fn transcode_to_m4a(
    _backend: &Backend,
    input: &Path,
    out_dir: &Path,
    final_name: &str,
) -> Result<PathBuf, String> {
    let dest = out_dir.join(final_name);
    let tmp = super::transcode::temp_sibling(out_dir, final_name);
    let source = input.to_owned();
    let output = tmp.clone();
    let result = tokio::task::spawn_blocking(move || ios_audio::convert(&source, &output))
        .await
        .map_err(|error| format!("iOS convert task: {error}"))
        .and_then(|result| result);
    if let Err(error) = result {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(error);
    }
    if let Err(error) = tokio::fs::rename(&tmp, &dest).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(format!("commit iOS conversion: {error}"));
    }
    Ok(dest)
}

pub async fn export_with_cover(
    _backend: &Backend,
    input: &Path,
    cover: Option<&[u8]>,
    dest: &Path,
) -> Result<(), String> {
    let directory = dest
        .parent()
        .ok_or("export: destination has no parent directory")?;
    let stem = dest
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("export");
    let tmp = super::transcode::temp_sibling(directory, stem);
    let source = input.to_owned();
    let output = tmp.clone();
    let cover = cover.map(|bytes| bytes.to_vec());
    let result =
        tokio::task::spawn_blocking(move || ios_audio::export(&source, &output, cover.as_deref()))
            .await
            .map_err(|error| format!("iOS export task: {error}"))
            .and_then(|result| result);
    if let Err(error) = result {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(error);
    }
    if let Err(error) = tokio::fs::rename(&tmp, dest).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(format!("commit iOS export: {error}"));
    }
    Ok(())
}

pub async fn probe_duration_ms(_backend: &Backend, path: &Path) -> Option<u64> {
    let path = path.to_owned();
    tokio::task::spawn_blocking(move || ios_audio::probe(&path))
        .await
        .ok()
        .flatten()
}
