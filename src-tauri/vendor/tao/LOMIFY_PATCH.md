# Local iOS fix for Tao 0.35.3

This package is copied from the exact crates.io `tao` 0.35.3 already used by
LomifyNEXT. The only library source change is in
`src/platform_impl/ios/view.rs`: return the scene configuration with
`Retained::autorelease_ptr(config)` instead of a pointer to an object that is
released when the callback returns.

Upstream fix: https://github.com/tauri-apps/tao/pull/1245
Commit: `f2163508104413ef0609178dcebdd5803b496211`.

Other platform implementations and dependency constraints retain the released
0.35.3 sources. A local copy avoids pulling unrelated changes from the upstream
development branch. Remove this Cargo patch when Tauri permits a release that
contains the scene ownership fix, matching the Android Tao dependency as well.
