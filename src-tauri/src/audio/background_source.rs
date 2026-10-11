//! Native counterparts of yandex.ts stream resolution for suspended WebViews.
use super::background::{BackgroundResolver, BackgroundTrack};
use base64::Engine as _;
use hmac::{Hmac, Mac};
use md5::{Digest, Md5};
use reqwest::Client;
use serde_json::Value;
use sha2::Sha256;
use std::{
    sync::OnceLock,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

fn client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20))
            .build()
            .expect("native media HTTP client")
    })
}

pub async fn resolve(track: &BackgroundTrack) -> Result<String, String> {
    let resolved = match &track.resolver {
        Some(BackgroundResolver::Yandex {
            id,
            token,
            data_saver,
        }) => yandex(id, token, *data_saver).await,
        Some(BackgroundResolver::Soundcloud) => {
            crate::track_cache::background_stream_url(&track.key)
                .await
                .and_then(|url| url.ok_or_else(|| "SoundCloud full stream unavailable".into()))
        }
        None => Err("No native stream resolver".into()),
    };
    // An already prepared URL still works if metadata API happens to be offline.
    resolved.or_else(|_| {
        track
            .url
            .clone()
            .ok_or_else(|| "Background stream unavailable".into())
    })
}

fn file_info_signature(ts: u64, id: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(b"p93jhgh689SBReK6ghtw62").unwrap();
    mac.update(format!("{ts}{id}nqmp3aacaac-mp4raw").as_bytes());
    let mut encoded = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());
    encoded.pop();
    encoded
}

async fn json(path: &str, token: &str) -> Result<Value, String> {
    let mut status = 0;
    // Same profiles as yandex.ts; a perimeter 403 must not look like an expired token.
    for agent in ["YandexMusicAndroid/24023621", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "Yandex-Music-API"] {
    let response = client().get(format!("https://api.music.yandex.net{path}"))
        .header("Authorization", format!("OAuth {token}"))
        .header("User-Agent", agent)
        .header("X-Yandex-Music-Device", "os=Android; os_version=13; manufacturer=Xiaomi; model=Redmi Note 8 Pro; clid=; device_id=lomifynext0000001; uuid=lomifynext0000002")
        .header("X-Yandex-Music-Client", "YandexMusicAndroid/24023621").send().await
        .map_err(|_| "Yandex media request failed".to_string())?;
    status = response.status().as_u16();
    if status == 403 { continue; }
    if !response.status().is_success() { return Err(format!("Yandex media HTTP {status}")); }
    let value: Value = response.json().await.map_err(|_| "Yandex media response invalid".to_string())?;
    if value.get("error").is_some() { return Err("Yandex media API rejected request".into()); }
    return Ok(value.get("result").cloned().unwrap_or(value));
    }
    Err(format!("Yandex media HTTP {status}"))
}

fn stream_url(value: &str) -> Option<String> {
    let value = if value.starts_with("//") {
        format!("https:{value}")
    } else {
        value.to_string()
    };
    let url = reqwest::Url::parse(&value).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || value.contains("preview")
        || value.contains("snippet")
    {
        return None;
    }
    Some(value)
}

async fn v2(id: &str, token: &str) -> Result<String, String> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let sign = urlencoding::encode(&file_info_signature(ts, id)).into_owned();
    let result = json(&format!("/get-file-info?ts={ts}&trackId={id}&quality=nq&codecs=mp3,aac,aac-mp4&transports=raw&sign={sign}"), token).await?;
    let info = result.get("downloadInfo").unwrap_or(&result);
    info.get("urls")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .find_map(stream_url)
        .or_else(|| info.get("url").and_then(Value::as_str).and_then(stream_url))
        .ok_or_else(|| "Yandex full stream unavailable".into())
}

fn xml_tag<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    xml.split_once(&format!("<{tag}>"))?
        .1
        .split_once(&format!("</{tag}>"))
        .map(|(value, _)| value.trim())
}

fn legacy_url(xml: &str) -> Option<String> {
    let host = xml_tag(xml, "host")?;
    let path = xml_tag(xml, "path")?;
    let ts = xml_tag(xml, "ts")?;
    let salt = xml_tag(xml, "s")?;
    if !path.starts_with('/') {
        return None;
    }
    let sign = hex::encode(Md5::digest(
        format!("XGRlBW9FXlekgbPrRHuSiA{}{salt}", &path[1..]).as_bytes(),
    ));
    stream_url(&format!("https://{host}/get-mp3/{sign}/{ts}{path}"))
}

async fn legacy(id: &str, token: &str, saver: bool) -> Result<String, String> {
    let result = json(&format!("/tracks/{id}/download-info"), token).await?;
    let mut variants: Vec<_> = result
        .as_array()
        .into_iter()
        .flatten()
        .filter(|v| {
            v.get("preview").and_then(Value::as_bool) != Some(true)
                && v.get("codec").and_then(Value::as_str) == Some("mp3")
        })
        .collect();
    variants.sort_by_key(|v| {
        let rate = v.get("bitrateInKbps").and_then(Value::as_i64).unwrap_or(0);
        if saver {
            rate
        } else {
            -rate
        }
    });
    for variant in variants {
        let Some(url) = variant
            .get("downloadInfoUrl")
            .and_then(Value::as_str)
            .and_then(stream_url)
        else {
            continue;
        };
        let Ok(response) = client().get(url).send().await else {
            continue;
        };
        if !response.status().is_success() {
            continue;
        }
        let Ok(xml) = response.text().await else {
            continue;
        };
        if let Some(url) = legacy_url(&xml) {
            return Ok(url);
        }
    }
    Err("Yandex full stream unavailable".into())
}

async fn yandex(raw_id: &str, token: &str, saver: bool) -> Result<String, String> {
    let id = raw_id.split(':').next().unwrap_or("");
    if id.is_empty() || !id.bytes().all(|c| c.is_ascii_digit()) {
        return Err("Invalid Yandex track id".into());
    }
    if saver {
        match legacy(id, token, saver).await {
            Ok(url) => Ok(url),
            Err(_) => v2(id, token).await,
        }
    } else {
        match v2(id, token).await {
            Ok(url) => Ok(url),
            Err(_) => legacy(id, token, saver).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signatures_match_web_resolver() {
        assert_eq!(
            file_info_signature(1700000000, "42"),
            "tdUtdUPQZZCSI/HIkbKG1aEgrHjMo7KUVI0gTa6J0cw"
        );
        assert_eq!(
            legacy_url("<host>cdn.example</host><path>/a/b.mp3</path><ts>123</ts><s>salt</s>"),
            Some("https://cdn.example/get-mp3/c7542deec10d6946d760a7a0b15f96a1/123/a/b.mp3".into())
        );
    }
    #[test]
    fn reject_previews_and_non_media_urls() {
        assert!(stream_url("https://cdn.example/preview/1.mp3").is_none());
        assert!(stream_url("file:///private/token").is_none());
        assert_eq!(
            stream_url("//cdn.example/a.mp3"),
            Some("https://cdn.example/a.mp3".into())
        );
    }
}
