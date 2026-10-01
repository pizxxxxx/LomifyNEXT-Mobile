fn main() {
    println!("cargo:rerun-if-changed=native/ios_audio.c");
    println!("cargo:rerun-if-changed=native/ios_audio.h");
    println!("cargo:rerun-if-changed=native/ios_session.m");
    println!("cargo:rerun-if-changed=native/ios_navigation.m");
    println!("cargo:rerun-if-changed=native/ios_media.m");
    println!("cargo:rerun-if-changed=native/ios_controls.m");
    println!("cargo:rerun-if-env-changed=LOMIFY_IOS_FFMPEG_DIR");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") {
        let target = std::env::var("TARGET").expect("Cargo target");
        let prefix = std::env::var_os("LOMIFY_IOS_FFMPEG_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap())
                    .join("target/ios-ffmpeg")
                    .join(&target)
            });
        assert!(
            prefix.join("include/libavcodec/avcodec.h").is_file(),
            "Build iOS FFmpeg first: bash scripts/build-ios-ffmpeg.sh {target}"
        );
        cc::Build::new()
            .file("native/ios_audio.c")
            .include(prefix.join("include"))
            .flag_if_supported("-std=c17")
            .compile("lomify_ios_audio");
        cc::Build::new()
            .file("native/ios_session.m")
            .file("native/ios_navigation.m")
            .file("native/ios_media.m")
            .file("native/ios_controls.m")
            .flag("-fobjc-arc")
            .compile("lomify_ios_session");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=UIKit");
        println!("cargo:rustc-link-lib=framework=WebKit");
        println!("cargo:rustc-link-lib=framework=MediaPlayer");
        println!(
            "cargo:rustc-link-search=native={}",
            prefix.join("lib").display()
        );
        for library in ["avformat", "avcodec", "swresample", "avutil"] {
            println!("cargo:rustc-link-lib=static={library}");
        }
        println!("cargo:rustc-link-lib=m");
        println!("cargo:rustc-link-lib=z");
    }
    tauri_build::build()
}
