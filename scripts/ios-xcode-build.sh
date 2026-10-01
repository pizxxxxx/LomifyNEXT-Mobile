#!/bin/bash
# The generated Xcode phase calls this from SRCROOT, including Xcode GUI builds.
set -euo pipefail
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
project_root="$(cd "${SRCROOT:?}/../../.." && pwd)"
cd "$project_root"
exec node scripts/ios-tauri.mjs xcode-script "$@"
