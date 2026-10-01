#!/usr/bin/env python3
"""Exercise the exact iOS C bridge on macOS with real codec/container fixtures."""
import array
import ctypes
import hashlib
import json
import math
import pathlib
import struct
import subprocess
import urllib.request
import wave
import zlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
PREFIX = ROOT / "src-tauri/target/ios-ffmpeg/aarch64-apple-darwin"
WORK = ROOT / "src-tauri/target/ios-audio-tests"
WORK.mkdir(parents=True, exist_ok=True)


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


subprocess.run(["bash", str(ROOT / "scripts/build-ios-ffmpeg.sh"), "aarch64-apple-darwin"], check=True)
sdk = run("xcrun", "--sdk", "macosx", "--show-sdk-path").strip()
library = WORK / "liblomify_audio.dylib"
run("xcrun", "clang", "-dynamiclib", "-isysroot", sdk, "-std=c17", "-Wall", "-Wextra", "-Werror",
    "-I", str(PREFIX / "include"), str(ROOT / "src-tauri/native/ios_audio.c"),
    "-L", str(PREFIX / "lib"), "-lavformat", "-lavcodec", "-lswresample", "-lavutil", "-lm", "-lz",
    "-o", str(library))
api = ctypes.CDLL(str(library))
ptr = ctypes.c_void_p
api.lomify_audio_open.argtypes = [ptr, ctypes.c_size_t, ptr, ctypes.c_size_t]
api.lomify_audio_open.restype = ptr
api.lomify_audio_close.argtypes = [ptr]
for name in ("channels", "sample_rate"):
    function = getattr(api, "lomify_audio_" + name)
    function.argtypes, function.restype = [ptr], ctypes.c_int
api.lomify_audio_duration.argtypes, api.lomify_audio_duration.restype = [ptr], ctypes.c_double
api.lomify_audio_read.argtypes = [ptr, ptr, ctypes.c_int]
api.lomify_audio_seek.argtypes = [ptr, ctypes.c_double]
api.lomify_audio_convert.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ptr, ctypes.c_size_t]
api.lomify_audio_export.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ptr, ctypes.c_size_t, ptr, ctypes.c_size_t]
api.lomify_audio_probe.argtypes, api.lomify_audio_probe.restype = [ctypes.c_char_p], ctypes.c_int64
ffmpeg = str(PREFIX / "bin/ffmpeg")
ffprobe = str(PREFIX / "bin/ffprobe")

pcm = array.array("h")
for index in range(48000 * 3):
    pcm.extend((int(12000 * math.sin(2 * math.pi * 440 * index / 48000)),
                int(10000 * math.sin(2 * math.pi * 660 * index / 48000))))
wav = WORK / "source.wav"
with wave.open(str(wav), "wb") as file:
    file.setnchannels(2)
    file.setsampwidth(2)
    file.setframerate(48000)
    file.writeframes(pcm.tobytes())


def encode(name, *options):
    path = WORK / name
    run(ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", str(wav), *options, str(path))
    return path


opus = encode("source.opus", "-c:a", "opus", "-strict", "-2", "-b:a", "128k")
flac = encode("source.flac", "-c:a", "flac")
aac = encode("source.m4a", "-c:a", "aac", "-b:a", "256k")
adts = encode("source.aac", "-c:a", "aac", "-b:a", "256k")


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 32, 32, 8, 2, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress((b"\0" + b"\x80\x40\xff" * 32) * 32)) + chunk(b"IEND", b""))
png_file = WORK / "cover.png"
png_file.write_bytes(png)
jpeg_file = WORK / "cover.jpg"
run("sips", "-s", "format", "jpeg", str(png_file), "--out", str(jpeg_file))
jpeg = jpeg_file.read_bytes()


def decode(path, seek=None, expected_rate=48000):
    data = ctypes.create_string_buffer(path.read_bytes())
    error = ctypes.create_string_buffer(512)
    decoder = api.lomify_audio_open(data, path.stat().st_size, error, len(error))
    assert decoder, error.value.decode()
    try:
        channels = api.lomify_audio_channels(decoder)
        rate = api.lomify_audio_sample_rate(decoder)
        duration = api.lomify_audio_duration(decoder)
        assert channels == 2 and rate == expected_rate, (path, channels, rate)
        if seek is not None:
            assert api.lomify_audio_seek(decoder, seek) == 0, path
        samples = array.array("f")
        buffer = (ctypes.c_float * 8192)()
        for _ in range(10000):
            count = api.lomify_audio_read(decoder, buffer, len(buffer))
            assert count >= 0, (path, count)
            if count == 0:
                break
            samples.extend(buffer[:count])
        else:
            raise AssertionError("decoder did not reach EOF")
        assert samples and all(math.isfinite(value) for value in samples)
        assert max(abs(value) for value in samples) > 0.1, "silent output"
        return samples, duration
    finally:
        api.lomify_audio_close(decoder)


def packet_hash(path):
    info = json.loads(run(ffprobe, "-v", "error", "-select_streams", "a:0", "-show_packets",
                          "-show_data_hash", "sha256", "-show_entries", "packet=data_hash",
                          "-of", "json", str(path)))
    return [packet["data_hash"] for packet in info["packets"]]


for source in (wav, opus, flac, aac, adts):
    samples, duration = decode(source)
    assert abs(len(samples) / 96000 - 3) < 0.1, (source, len(samples))
    sought, _ = decode(source, 1.25)
    assert abs(len(sought) / 96000 - 1.75) < 0.1, (source, len(sought))
    dest = WORK / (source.name + ".converted.m4a")
    error = ctypes.create_string_buffer(512)
    assert api.lomify_audio_convert(bytes(source), bytes(dest), error, len(error)) == 0, error.value.decode()
    assert abs(api.lomify_audio_probe(bytes(dest)) - 3000) < 100
    assert dest.read_bytes().find(b"moov") < dest.read_bytes().find(b"mdat"), "faststart missing"
    decode(dest)
    exported = WORK / (source.name + ".covered.m4a")
    cover = ctypes.create_string_buffer(png)
    assert api.lomify_audio_export(bytes(dest), bytes(exported), cover, len(png), error, len(error)) == 0, error.value.decode()
    assert packet_hash(dest) == packet_hash(exported), "export re-encoded the AAC audio"
    streams = json.loads(run(ffprobe, "-v", "error", "-show_streams", "-of", "json", str(exported)))["streams"]
    assert any(stream["codec_name"] == "png" and stream["disposition"]["attached_pic"] for stream in streams)
    cover = ctypes.create_string_buffer(jpeg)
    exported_jpeg = WORK / (source.name + ".jpeg.m4a")
    assert api.lomify_audio_export(bytes(dest), bytes(exported_jpeg), cover, len(jpeg), error, len(error)) == 0, error.value.decode()
    assert packet_hash(dest) == packet_hash(exported_jpeg)
    streams = json.loads(run(ffprobe, "-v", "error", "-show_streams", "-of", "json", str(exported_jpeg)))["streams"]
    assert any(stream["codec_name"] == "mjpeg" and stream["disposition"]["attached_pic"] for stream in streams)
    print(f"PASS {source.suffix}: decode, EOF, seek, AAC conversion, duration, faststart, lossless cover export")

bmp_file = WORK / "cover.bmp"
run("sips", "-s", "format", "bmp", str(png_file), "--out", str(bmp_file))
bmp = bmp_file.read_bytes()
cover = ctypes.create_string_buffer(bmp)
exported_bmp = WORK / "bmp-covered.m4a"
assert api.lomify_audio_export(bytes(aac), bytes(exported_bmp), cover, len(bmp), error, len(error)) == 0, error.value.decode()
assert packet_hash(aac) == packet_hash(exported_bmp)
streams = json.loads(run(ffprobe, "-v", "error", "-show_streams", "-of", "json", str(exported_bmp)))["streams"]
assert any(stream["codec_name"] == "bmp" and stream["disposition"]["attached_pic"] for stream in streams)
print("PASS BMP cover: lossless AAC export")

mp3 = WORK / "ffmpeg-sample.mp3"
if not mp3.is_file():
    with urllib.request.urlopen("https://samples.ffmpeg.org/A-codecs/MP3/ascii.mp3", timeout=30) as response:
        mp3.write_bytes(response.read())
assert hashlib.sha256(mp3.read_bytes()).hexdigest() == "7c72e328ad3fe508ba244d8a20bac3d2c646ceca42341dcb7dc4fbf7bb3badeb"
samples, duration = decode(mp3, expected_rate=44100)
assert abs(len(samples) / 88200 - duration) < 0.15
sought, _ = decode(mp3, seek=5, expected_rate=44100)
assert abs(len(sought) / 88200 - (duration - 5)) < 0.15
error = ctypes.create_string_buffer(512)
mp3_output = WORK / "mp3-converted.m4a"
assert api.lomify_audio_convert(bytes(mp3), bytes(mp3_output), error, len(error)) == 0, error.value.decode()
assert abs(api.lomify_audio_probe(bytes(mp3_output)) / 1000 - duration) < 0.15
decode(mp3_output, expected_rate=44100)
print("PASS MP3: decode, seek and AAC conversion (official FFmpeg regression fixture)")

invalid = WORK / "invalid.bin"
invalid.write_bytes(b"not an audio file")
error = ctypes.create_string_buffer(512)
assert api.lomify_audio_convert(bytes(invalid), bytes(WORK / "invalid.m4a"), error, len(error)) < 0
assert error.value
assert api.lomify_audio_probe(bytes(invalid)) == -1
bad = ctypes.create_string_buffer(b"invalid cover")
assert api.lomify_audio_export(bytes(aac), bytes(WORK / "bad-cover.m4a"), bad, 13, error, len(error)) < 0
assert api.lomify_audio_export(bytes(aac), bytes(WORK / "without-cover.m4a"), None, 0, error, len(error)) == 0
print("PASS invalid audio, invalid cover, and export without cover")
