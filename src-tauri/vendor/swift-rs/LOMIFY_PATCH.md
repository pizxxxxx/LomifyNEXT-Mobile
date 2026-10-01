# Local Xcode 27 adjustment

Based on the published `swift-rs` 1.0.8 crate. Runtime source and public APIs are
unchanged. The only library change is in `src-rs/build.rs`:
`globalize_cdecl_symbols` also processes the embedded `SwiftRs.o` member when
building **Tauri**. Plugin archives keep their copies local, avoiding duplicate
global definitions.

The upstream code already promotes each package's own `@_cdecl` exports under
Xcode 27 with rustup's `llvm-objcopy`, but omits the runtime embedded in Tauri.
This left `_retain_object`, `_release_object`, and `_string_from_bytes` local in
release device builds and caused the Rust link to fail.

Remove this patch when upstream includes the same runtime export fix. No files
in the global Cargo registry are modified.
