//! Statically linked FFmpeg for iOS. Decoder state belongs to one audio thread.
use std::ffi::{c_char, c_int, c_void, CString};
use std::num::NonZero;
use std::path::Path;
use std::ptr::NonNull;
use std::time::Duration;

use rodio::source::SeekError;
use rodio::Source;

unsafe extern "C" {
    fn lomify_audio_session_prepare(error: *mut c_char, capacity: usize) -> c_int;
    fn lomify_audio_open(
        data: *const u8,
        size: usize,
        error: *mut c_char,
        capacity: usize,
    ) -> *mut c_void;
    fn lomify_audio_close(decoder: *mut c_void);
    fn lomify_audio_channels(decoder: *const c_void) -> c_int;
    fn lomify_audio_sample_rate(decoder: *const c_void) -> c_int;
    fn lomify_audio_duration(decoder: *const c_void) -> f64;
    fn lomify_audio_read(decoder: *mut c_void, samples: *mut f32, capacity: c_int) -> c_int;
    fn lomify_audio_seek(decoder: *mut c_void, seconds: f64) -> c_int;
    fn lomify_audio_convert(
        input: *const c_char,
        output: *const c_char,
        error: *mut c_char,
        capacity: usize,
    ) -> c_int;
    fn lomify_audio_export(
        input: *const c_char,
        output: *const c_char,
        cover: *const u8,
        cover_size: usize,
        error: *mut c_char,
        capacity: usize,
    ) -> c_int;
    fn lomify_audio_probe(path: *const c_char) -> i64;
}

pub fn initialize_session() -> Result<(), std::io::Error> {
    let mut error = [0u8; 512];
    let result = unsafe { lomify_audio_session_prepare(error.as_mut_ptr().cast(), error.len()) };
    if result < 0 {
        Err(std::io::Error::other(error_text(&error)))
    } else {
        Ok(())
    }
}

fn error_text(buffer: &[u8]) -> String {
    let end = buffer
        .iter()
        .position(|&byte| byte == 0)
        .unwrap_or(buffer.len());
    String::from_utf8_lossy(&buffer[..end]).into_owned()
}

fn c_path(path: &Path) -> Result<CString, String> {
    CString::new(path.as_os_str().as_encoded_bytes()).map_err(|_| "Path contains NUL".into())
}

pub fn convert(input: &Path, output: &Path) -> Result<(), String> {
    let input = c_path(input)?;
    let output = c_path(output)?;
    let mut error = [0u8; 512];
    // All C strings and the error buffer remain alive for this synchronous call.
    let result = unsafe {
        lomify_audio_convert(
            input.as_ptr(),
            output.as_ptr(),
            error.as_mut_ptr().cast(),
            error.len(),
        )
    };
    if result < 0 {
        Err(error_text(&error))
    } else {
        Ok(())
    }
}

pub fn export(input: &Path, output: &Path, cover: Option<&[u8]>) -> Result<(), String> {
    let input = c_path(input)?;
    let output = c_path(output)?;
    let mut error = [0u8; 512];
    let (data, size) = cover
        .map(|data| (data.as_ptr(), data.len()))
        .unwrap_or((std::ptr::null(), 0));
    let result = unsafe {
        lomify_audio_export(
            input.as_ptr(),
            output.as_ptr(),
            data,
            size,
            error.as_mut_ptr().cast(),
            error.len(),
        )
    };
    if result < 0 {
        Err(error_text(&error))
    } else {
        Ok(())
    }
}

pub fn probe(path: &Path) -> Option<u64> {
    let path = c_path(path).ok()?;
    let duration = unsafe { lomify_audio_probe(path.as_ptr()) };
    u64::try_from(duration).ok()
}

pub struct NativeSource {
    decoder: NonNull<c_void>,
    // FFmpeg's custom AVIO borrows this allocation until Drop closes the decoder.
    _data: Vec<u8>,
    samples: Vec<f32>,
    position: usize,
    channels: NonZero<u16>,
    sample_rate: NonZero<u32>,
    duration: Option<Duration>,
    ended: bool,
}

// There is no shared access to the C context. Moving its sole owner is safe.
unsafe impl Send for NativeSource {}

impl NativeSource {
    pub fn new(bytes: &[u8]) -> Result<Self, String> {
        let data = bytes.to_vec();
        let mut error = [0u8; 512];
        let decoder = unsafe {
            lomify_audio_open(
                data.as_ptr(),
                data.len(),
                error.as_mut_ptr().cast(),
                error.len(),
            )
        };
        let decoder = NonNull::new(decoder).ok_or_else(|| error_text(&error))?;
        let channels = unsafe { lomify_audio_channels(decoder.as_ptr()) };
        let sample_rate = unsafe { lomify_audio_sample_rate(decoder.as_ptr()) };
        let seconds = unsafe { lomify_audio_duration(decoder.as_ptr()) };
        // The C constructor validates channels (1..=64) and a positive sample rate.
        Ok(Self {
            decoder,
            _data: data,
            samples: Vec::new(),
            position: 0,
            channels: NonZero::new(channels as u16).unwrap(),
            sample_rate: NonZero::new(sample_rate as u32).unwrap(),
            duration: (seconds.is_finite() && seconds >= 0.0)
                .then(|| Duration::from_secs_f64(seconds)),
            ended: false,
        })
    }
}

impl Drop for NativeSource {
    fn drop(&mut self) {
        unsafe { lomify_audio_close(self.decoder.as_ptr()) };
    }
}

impl Iterator for NativeSource {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if self.position >= self.samples.len() {
            if self.ended {
                return None;
            }
            self.samples
                .resize(4096 * self.channels.get() as usize, 0.0);
            let count = unsafe {
                lomify_audio_read(
                    self.decoder.as_ptr(),
                    self.samples.as_mut_ptr(),
                    self.samples.len() as c_int,
                )
            };
            if count <= 0 {
                if count < 0 {
                    eprintln!("[iOS audio] FFmpeg decode failed: {count}");
                }
                self.ended = true;
                return None;
            }
            self.samples.truncate(count as usize);
            self.position = 0;
        }
        let sample = self.samples[self.position];
        self.position += 1;
        Some(sample)
    }
}

impl Source for NativeSource {
    fn current_span_len(&self) -> Option<usize> {
        None
    }
    fn channels(&self) -> NonZero<u16> {
        self.channels
    }
    fn sample_rate(&self) -> NonZero<u32> {
        self.sample_rate
    }
    fn total_duration(&self) -> Option<Duration> {
        self.duration
    }

    fn try_seek(&mut self, position: Duration) -> Result<(), SeekError> {
        let result = unsafe { lomify_audio_seek(self.decoder.as_ptr(), position.as_secs_f64()) };
        if result < 0 {
            return Err(SeekError::NotSupported {
                underlying_source: "iOS FFmpeg seek failed",
            });
        }
        self.samples.clear();
        self.position = 0;
        self.ended = false;
        Ok(())
    }
}
