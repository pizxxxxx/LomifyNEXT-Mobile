#!/bin/bash
# Build libraries in the project cache; no global installation and no iOS executable.
set -euo pipefail

target="${1:-aarch64-apple-ios}"
project_root="$(cd "$(dirname "$0")/.." && pwd)"
version=8.1
checksum=b072aed6871998cce9b36e7774033105ca29e33632be5b6347f3206898e0756a
cache="$project_root/src-tauri/target/ios-ffmpeg"
prefix="$cache/$target"

case "$target" in
  aarch64-apple-ios) sdk=iphoneos; triple=arm64-apple-ios15.0; cross=yes ;;
  aarch64-apple-ios-sim) sdk=iphonesimulator; triple=arm64-apple-ios15.0-simulator; cross=yes ;;
  aarch64-apple-darwin) sdk=macosx; triple=arm64-apple-macos11.0; cross=no ;;
  *) printf 'Unsupported target: %s\n' "$target" >&2; exit 1 ;;
esac

if [ -f "$prefix/.lomify-ffmpeg-$version-v2" ]; then
  printf 'FFmpeg libraries already built: %s\n' "$prefix"
  exit 0
fi

mkdir -p "$cache/downloads" "$cache/source" "$cache/build/$target" "$prefix"
archive="$cache/downloads/ffmpeg-$version.tar.xz"
if [ ! -f "$archive" ]; then
  curl --fail --location --connect-timeout 20 --max-time 180 --retry 2 \
    --output "$archive" "https://ffmpeg.org/releases/ffmpeg-$version.tar.xz"
fi
printf '%s  %s\n' "$checksum" "$archive" | shasum -a 256 -c -
if [ ! -f "$cache/source/ffmpeg-$version/configure" ]; then
  tar -xf "$archive" -C "$cache/source"
fi

sdk_path="$(xcrun --sdk "$sdk" --show-sdk-path)"
compiler="$(xcrun --sdk "$sdk" --find clang)"
host_sdk="$(xcrun --sdk macosx --show-sdk-path)"
build_dir="$cache/build/$target"
cd "$build_dir"

arguments=(
  --prefix="$prefix" --arch=aarch64 --target-os=darwin
  --cc="$compiler" --extra-cflags="-target $triple -isysroot $sdk_path -fPIC"
  --extra-ldflags="-target $triple -isysroot $sdk_path"
  --host-cc="$compiler" --host-cflags="-isysroot $host_sdk"
  --host-ldflags="-isysroot $host_sdk"
  --enable-static --disable-shared --enable-pic
  --enable-zlib
  --disable-autodetect --disable-network --disable-doc --disable-debug
  --disable-avdevice --disable-swscale --disable-encoders --enable-encoder=aac
  --disable-videotoolbox --disable-audiotoolbox --disable-securetransport
)
if [ "$cross" = yes ]; then
  arguments+=(--enable-cross-compile --disable-programs --disable-avfilter)
else
  # A local CLI is useful for integration fixtures, and is never packaged for iOS.
  arguments+=(--enable-ffmpeg --enable-encoder=opus,pcm_s16le,flac)
fi

"$cache/source/ffmpeg-$version/configure" "${arguments[@]}" > configure.log 2>&1 || {
  tail -60 configure.log >&2
  tail -60 ffbuild/config.log >&2
  exit 1
}
make -j "${LOMIFY_FFMPEG_JOBS:-$(sysctl -n hw.ncpu)}" > build.log 2>&1 || {
  tail -80 build.log >&2
  exit 1
}
make install > install.log 2>&1
touch "$prefix/.lomify-ffmpeg-$version-v2"
printf 'Built FFmpeg %s libraries for %s: %s\n' "$version" "$target" "$prefix"
