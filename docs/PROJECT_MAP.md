# LomifyNEXT project map

Last verified: 2026-09-30  
Indexed desktop base: 9.3.2. Current mobile worktree: 1.0.13 beta (see the mobile section).

This file is the navigation index for the repository. Read it before broad exploration.
It explains where a change normally belongs; source code is still the final authority.

## 1. Project at a glance

The desktop base of LomifyNEXT is an audio player that combines SoundCloud and Yandex Music, with
local/offline tracks, Spotify playlist import, Last.fm scrobbling and taste history,
lyrics, likes, playlists, a native audio engine, cache management, media controls,
Discord Rich Presence, tray controls, and visual customization.

Primary stack:

- Tauri 2 desktop shell and command/event bridge.
- Rust 2021 native backend.
- SvelteKit 2 + Svelte 5 + TypeScript frontend.
- Vite 6 and the Svelte static adapter; the application is an SPA with SSR disabled.
- Tailwind CSS 4 plus large project-owned CSS files.
- `rodio`, `cpal`, `rustfft`, and FFmpeg-related code for native playback and processing.

High-level runtime flow:

```text
Svelte routes/components
        |
        +--> Svelte stores and browser persistence
        +--> SoundCloud/Yandex/Spotify/Last.fm API modules
        +--> Tauri invoke/listen bridge
                  |
                  v
          src-tauri/src/lib.rs
                  |
        +---------+----------+-----------+
        |                    |           |
      audio              track_cache   network/auth/app/discord/import
        |                    |           |
        +---------- OS audio, filesystem, HTTP, tray and media controls
```

## 2. Start here by task

| Task | First files to inspect |
| --- | --- |
| App startup, global theme, window-level effects | `src/routes/+layout.svelte`, `src/app.css` |
| Page/view navigation and home layout | `src/routes/+page.svelte`, `src/lib/stores.ts` |
| Player controls or queue behavior | `src/lib/components/Player.svelte`, `src/lib/stores.ts` |
| Native playback, seeking, volume, crossfade | `src-tauri/src/audio/commands.rs`, `src-tauri/src/audio/engine.rs`, `src-tauri/src/audio/state.rs` |
| Audio output devices | `src/lib/audioOutput.ts`, `src-tauri/src/audio/device.rs` |
| Equalizer or FFT visualizer | `src/lib/components/Equalizer.svelte`, `src/lib/components/Fullscreen.svelte`, `src/lib/fft.ts`, `src-tauri/src/audio/eq.rs`, `src-tauri/src/audio/analyser.rs` |
| SoundCloud search, metadata, stream choice | `src/lib/api.ts` |
| Yandex Music account, search, likes, Wave, streams | `src/lib/yandex.ts`, `src/lib/wave.ts`, `src/lib/likes.ts` |
| Lyrics | `src/lib/components/Lyrics.svelte`, `src/lib/api.ts`, `src/lib/lyrics.ts`, `src-tauri/src/audio/timing.rs` |
| Likes and likes synchronization | `src/lib/likes.ts`, `src/lib/stores.ts`, `src/lib/components/Library.svelte` |
| Local library/imported files | `src/lib/db.ts`, `src/lib/components/Library.svelte` |
| Downloading, transcoding, offline audio/covers | `src/lib/offlineCovers.ts`, `src/lib/cacheMaintenance.ts`, `src-tauri/src/track_cache/`, `src-tauri/src/network/image_cache.rs` |
| Automatic cache cleanup | `src/lib/cacheMaintenance.ts`, `src/lib/components/Settings.svelte`, `src-tauri/src/track_cache/state.rs`, `src-tauri/src/network/image_cache.rs` |
| HTTP proxy, images, wallpapers, local servers | `src-tauri/src/network/` |
| Settings UI or persistence | `src/lib/components/Settings.svelte`, `src/lib/stores.ts` |
| HiDPI/interface scale | `src/routes/+layout.svelte`, `src/lib/components/Settings.svelte`, `src/lib/stores.ts`, `src-tauri/capabilities/default.json` |
| Tray, popover, diagnostics | `src-tauri/src/app/` |
| Authentication session | `src-tauri/src/auth/mod.rs` |
| Discord Rich Presence | `src-tauri/src/discord/commands.rs` |
| Yandex library import | `src-tauri/src/import/ym.rs` |
| Spotify account/library import | `src/lib/spotify.ts`, `src/lib/musicImport.ts`, `src/lib/components/SpotifyImport.svelte`, `src-tauri/src/import/spotify.rs` |
| Last.fm account, cloud reports, recommendations, scrobbling | `src/lib/lastfm.ts`, `src/lib/components/LastFmConnect.svelte`, `src/lib/components/Profile.svelte`, `src/lib/components/Player.svelte`, `src/lib/api.ts` |
| Release/version update | `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src/lib/version.ts`, changelog |

## 3. Repository layout

| Path | Role |
| --- | --- |
| `src/` | Active Svelte frontend. |
| `src/routes/` | SvelteKit shell, main screen, and callback route. |
| `src/lib/components/` | Screens and reusable UI components. |
| `src/lib/actions/` | Svelte actions for range dragging and liquid-glass interaction. |
| `src/lib/utils/` | Small frontend helpers for artists, navigation, visual effects, and formatting. |
| `src-tauri/src/` | Active Rust/Tauri application. |
| `src-tauri/capabilities/` | Tauri permission/capability declarations. |
| `utils/` | Rust helper crates referenced from `src-tauri/Cargo.toml`. |
| `static/` | Files copied into the frontend build as static assets. |
| `permissions/` | Additional permission definitions kept at repository root. |
| `README.md` | User-facing mobile app description and feature overview. |
| `CHANGELOG_9.3.0.md` | Release notes for the current repository version. |

Generated, dependency, and local-only paths that should not be used for architecture
discovery:

- `node_modules/`
- `.svelte-kit/`
- `build/`, `build_output/`, `dist/`, `.output/`
- `src-tauri/target/` and any other `target/`
- `.agents/` and `.claude/` are local agent assets; `.vscode/` is IDE configuration.
  Skip them for architecture discovery unless the task explicitly concerns agent or IDE setup.
- `tauri-dev.log` and other `*.log`

## 4. Frontend map

### Routes and composition

| File | Responsibility |
| --- | --- |
| `src/routes/+layout.ts` | Disables SSR for the Tauri SPA. |
| `src/routes/+layout.svelte` | Initializes stores, applies themes/effects, restores output device, schedules daily cache maintenance, sets up title bar and global app behavior. |
| `src/routes/+page.svelte` | Main composition root: sidebar, home, view switching, player, fullscreen overlay, notifications, initial data loading. |
| `src/routes/callback/+page.svelte` | Legacy browser OAuth callback page; current desktop Spotify import uses the native loopback callback instead. |

`currentView` in `src/lib/stores.ts` is the current manual view router. Its known values
are `home`, `search`, `library`, `settings`, `lyrics`, `equalizer`, `fullscreen`, `profile`,
and `artist`. When adding a view, update the union types, navigation history logic,
`+page.svelte`, and the sidebar or other entry controls together.

### Main components

| Component | Responsibility |
| --- | --- |
| `Player.svelte` | Playback orchestration, queue, preloading, crossfade decisions, Tauri audio commands, media/tray events, Discord activity. |
| `Search.svelte` | Search UI and results for configured sources. |
| `Library.svelte` | Likes, playlists, local files, caching/download actions, library layouts. |
| `Settings.svelte` | All settings groups, account/source configuration, cache controls, autostart, diagnostics-facing controls. |
| `Lyrics.svelte` | Lyrics loading, synchronization, seeking, alignment, and line rendering. |
| `Fullscreen.svelte` | Fullscreen player, fullscreen lyrics, FFT visualization, playback-rate integration. |
| `Equalizer.svelte` | Ten-band equalizer UI and presets. |
| `ArtistPage.svelte` | Artist profile, releases/albums, artist tracks, page atmosphere. |
| `Profile.svelte` | User profile dashboard, local listening/likes/playlist statistics, ranked tracks, SoundCloud/Yandex/Last.fm identity, and cloud Last.fm period reports. |
| `Sidebar.svelte` | Main view navigation and the same account-identity precedence as the profile header. |
| `Titlebar.svelte` | Custom Tauri window controls, persisted Windows/macOS-style placement, and window-state saving. |
| `WaveHero.svelte` | Home-page Yandex “My Wave” hero and visual presentation. |
| `PlaylistMenu.svelte` | Add-to-playlist menu. |
| `PlaylistTrailer.svelte` | Hover/preview playback for playlist content. |
| `SpotifyImport.svelte` | Spotify developer-app setup and read-only account connection, plus no-Premium local Account data JSON import, progress, cancellation, and recovery UI. |
| `LastFmConnect.svelte` | Last.fm app-key setup, browser authorization, distinct now-playing/recent-scrobble state, monthly favourites dashboard, and account actions. |
| `MusicServiceIcon.svelte` | Local, network-independent provider marks for SoundCloud, Yandex Music, Spotify, and Last.fm. |
| `ArtistTag.svelte` | Clickable artist identity/navigation. |
| `TrackStatus.svelte` | Compact track status/availability indicator. |
| `Notifications.svelte` | Toast-like notifications from the global store. |
| `GlyphWake.svelte` | Capped canvas cursor effect: scroll-coupled terminal-grid glyph puffs, interpolated pointer sampling, lightweight inertia, viewport-edge/collision physics, and reduced-motion/performance gates. |
| `WaveFrame.svelte` | Small visual helper for Wave/soundprint rendering. |
| `ArchiveStation.svelte` | Active grid/card renderer for the Home shelves (`Новые релизы`, `Главная`, similar artists); also owns hover audio preview for those cards. |

The largest frontend hotspots are `WaveHero.svelte`, `Settings.svelte`, `Player.svelte`,
`Library.svelte`, and `ArtistPage.svelte`. Prefer targeted searches inside these files
instead of reading all of them for unrelated changes.

### Home feed fast path

For Home recommendations or Home-card performance, inspect these files first and in this
order; do not scan the whole frontend before them:

1. `src/routes/+page.svelte` — loads the feed, keeps playlists out of the rendered Home
   grid, and progressively exposes at most 96 recommendation cards.
2. `src/lib/api.ts` — `buildTasteProfile()` and `getTrendingTracks()` build/rank the feed
   from likes, repeat listens, recent searches, playlist tracks, cached Last.fm monthly/all-time
   favourites, and similar artists. Playlist and known Last.fm tracks are excluded from returned
   recommendations.
3. `src/lib/components/ArchiveStation.svelte` — the actual Home card markup, responsive/lazy
   cover loading, keyed reconciliation, like lookup, and lazily-created hover preview audio.
4. `src/lib/components/WaveHero.svelte`, `src/routes/+layout.svelte`, and the
   `body[data-perf="light"]` block near the end of `src/app.css` — performance mode stops
   the Wave render loop, card preview/animation work, tilt/glare, blur, and large backdrop
   layers while preserving the normal-mode card appearance.

### State and data modules

| File | Responsibility |
| --- | --- |
| `src/lib/stores.ts` | Canonical global stores, default settings, navigation state, queue, current track, likes, playlists, notifications, statistics, localStorage hydration. |
| `src/lib/settings.ts` | Compatibility re-export of the canonical settings store; do not create a second settings store here. |
| `src/lib/api.ts` | SoundCloud requests, generic safe fetch, search aggregation, stream ranking, related/trending content, cached Last.fm taste/discovery weighting and known-track exclusion, lyrics aggregation, artist/album APIs. |
| `src/lib/yandex.ts` | Yandex token normalization, account APIs, track mapping, search, lyrics, Wave, artist/album APIs, likes, stream URL resolution. |
| `src/lib/likes.ts` | Local like mutation and synchronization queues for remote sources. |
| `src/lib/wave.ts` | Yandex Wave session lifecycle and queue refill. |
| `src/lib/waveFilters.ts` | Wave language/content/genre filtering and labels. |
| `src/lib/db.ts` | IndexedDB wrapper for locally imported track metadata. |
| `src/lib/lyrics.ts` | LRC parsing and additional lyrics lookup helpers. |
| `src/lib/audioOutput.ts` | Lists and restores native output-device selection. |
| `src/lib/cacheMaintenance.ts` | Protected likes/recent-cover collection, cache size reads, startup/manual smart-cleanup orchestration. |
| `src/lib/spotify.ts` | Spotify PKCE token/session handling, 2026 Web API pagination, importable-source discovery, and official Account data JSON parsing for no-Premium import. |
| `src/lib/musicImport.ts` | Shared Yandex/SoundCloud matching, deduplication, progress, and atomic library merge for Spotify and file imports. |
| `src/lib/lastfm.ts` | Last.fm signed desktop authorization, local session, cloud charts for week/month/year/all-time, recent and known-track cache, similar-artist discovery, now-playing updates, and listened-time scrobbling. |
| `src/lib/offlineCovers.ts` | Reactive downloaded-track inventory, local cover URLs served by the native loopback server, and mobile artwork fallback handlers. |
| `src/lib/utils/trackUrn.ts` | Canonical track-cache URN builder shared by playback and maintenance. |
| `src/lib/fft.ts` | Fixed-size FFT payload normalization for UI visualizers. |
| `src/lib/version.ts` | UI-facing application name, version, and release channel. |

### Styling

| File | Responsibility |
| --- | --- |
| `src/app.css` | Main global styles, themes, effects, performance mode, and most component-facing utility classes. |
| `src/design-aurora.css` | Alternative Aurora design layer. |
| `src/sc-theme.css` | SoundCloud-oriented theme styles. |
| `src/app.html` | HTML shell. |

## 5. Native/Tauri map

### Entry and registration

- `src-tauri/src/main.rs` only launches `lomifynext_tauri_lib::run()`.
- `src-tauri/src/lib.rs` is the native composition root. It registers plugins, creates
  cache/data directories, starts network servers, initializes managed state, starts audio
  workers, configures the tray, and registers every callable Tauri command.
- When a frontend `invoke("command_name")` fails because a new command is unknown, check
  both the command annotation in its module and the `generate_handler!` list in `lib.rs`.

### Native modules

| Module | Responsibility |
| --- | --- |
| `app/diagnostics.rs` | Native diagnostics log and Linux file-descriptor monitoring. |
| `app/popover.rs` | Tray popover window state and behavior. |
| `app/tray.rs` | Tray creation and tray actions. |
| `audio/commands.rs` | Tauri command surface for loading, playback, seek, volume, EQ, devices, timelines, preview, and export. |
| `audio/engine.rs` | Playback engine operations and mixer behavior. |
| `audio/state.rs` | Shared audio state and initialization. |
| `audio/decode.rs` | Decode pipeline and normalization analysis/cache. |
| `audio/device.rs` | Output enumeration, switching, and default-device monitoring. |
| `audio/eq.rs` | Equalizer processing. |
| `audio/analyser.rs` | FFT analysis and `audio:fft` emission. |
| `audio/tick.rs` | Playback clock, end detection, reconnect behavior, `audio:tick`. |
| `audio/timing.rs` | Lyrics and floating-comment timelines. |
| `audio/media_controls.rs` | OS media-key/control integration. |
| `auth/mod.rs` | Persisted application authentication session and auth commands/events. |
| `discord/commands.rs` | Discord Rich Presence lifecycle. |
| `import/ym.rs` | Yandex library import and progress/cancellation. |
| `import/spotify.rs` | Short-lived fixed-port `127.0.0.1:43827` OAuth callback for Spotify PKCE; emits the authorization result without storing tokens. |
| `network/call.rs` | Optional call-client state and persistence. |
| `network/direct_fetch.rs` | Restricted direct native HTTP command. |
| `network/image_cache.rs` | Ordinary image download/LRU plus downloaded-track covers stored by URN and served independently of their music service. |
| `network/proxy.rs` | `scproxy` protocol handling and asset cache. |
| `network/proxy_server.rs` | Local proxy server. |
| `network/static_server.rs` | Local static/wallpaper serving. |
| `network/server.rs` | Starts native servers and exposes their ports. |
| `network/wallpapers.rs` | Wallpaper search sources. |
| `shared/hls.rs` | HLS parsing/download helpers shared by playback/cache code. |
| `shared/net.rs` | Shared network validation/helpers. |
| `track_cache/commands.rs` | Tauri cache command surface. |
| `track_cache/state.rs` | Cache inventory, limits, jobs, recovery, and managed state. |
| `track_cache/direct_download.rs` | Direct track downloads. |
| `track_cache/sc_anon/` | Anonymous SoundCloud stream resolution/download support. |
| `track_cache/transcode.rs` | FFmpeg discovery/download, transcoding, temp-file recovery. |

### Tauri command groups

The authoritative registration list is in `src-tauri/src/lib.rs`.

- App/server: `exit_app`, `get_os_username`, `get_server_ports`, `diagnostics_log`.
- Discord: `discord_connect`, `discord_disconnect`, `discord_set_activity`,
  `discord_clear_activity`.
- Audio: commands prefixed with `audio_`, plus `save_track_to_path`.
- Import: `ym_import_start`, `ym_import_stop`, `spotify_oauth_start`.
- Track cache: commands prefixed with `track_`.
- Image cache: `image_cache_size`, `image_cache_clear`, `image_cache_prune`.
- Call client: commands prefixed with `call_`.
- Auth: commands prefixed with `auth_`.
- Wallpapers/direct network: `wallpaper_search`, `net_fetch_direct`.

Important event families:

- Playback: `audio:tick`, `audio:ended`, `audio:fft`.
- Devices: `audio:default-device-changed`, `audio:device-reconnected`.
- OS media controls: `media:play`, `media:pause`, `media:toggle`, `media:next`,
  `media:prev`, `media:seek`, `media:seek-relative`.
- Timelines: `lyrics:active_line`, `comments:show`.
- App/auth: `tray-action`, `auth:changed`.
- Spotify import: `spotify:oauth-callback`.
- Cache and import modules also emit progress/status events; inspect the emitting module
  and its matching frontend listener when changing their payloads.

## 6. Persistence and caches

### Browser-side persistence

`src/lib/stores.ts` owns the main localStorage-backed state:

- `lomifynext_settings`
- `lomifynext_stats`
- `lomifynext_likes`
- `lomifynext_search_history`
- `lomifynext_playlists`

The settings payload also persists `windowControlsStyle`.

Additional browser keys:

- `lomifynext_likes_sync` in `src/lib/likes.ts`.
- `lomifynext_yandex_twins` and `lomifynext_lyrics_cache` in `src/lib/api.ts`.
- `lomify-library-liked-view` in `Library.svelte`.
- `spotify_auth_code` in the callback route.
- `lomifynext_spotify_session` in `src/lib/spotify.ts` stores the Spotify PKCE access and
  refresh session separately from normal settings; unlinking Spotify removes only this key.
- `lomifynext_lastfm_session`, `lomifynext_lastfm_pending`, and
  `lomifynext_lastfm_overview` in `src/lib/lastfm.ts` store the signed Last.fm session,
  short-lived browser-authorization attempt, and fifteen-minute dashboard/report/taste cache;
  unlinking removes all three.
- `src/routes/+layout.svelte` removes the obsolete `lomifynext_apple_music_session` key at
  startup so tokens saved by builds that briefly exposed Apple Music do not remain on disk.

Optional release-build credentials are documented in `.env.example`:
`VITE_LASTFM_API_KEY` and `VITE_LASTFM_SHARED_SECRET`. Without them, Settings asks the
local user for the corresponding Last.fm developer credentials.

Local imported track metadata is stored in IndexedDB database `LomifyNextDB`, object
store `offline_tracks`, through `src/lib/db.ts`.

### Native persistence

Native code uses these application cache directories. `src-tauri/src/lib.rs` creates
most of them; the audio commands initialize `audio-normalization/` when needed:

- `audio/` — normal cached tracks.
- `audio_liked/` — liked-track cache.
- `audio_incoming/` — raw/staging files awaiting transcode or recovery.
- `audio-normalization/` — normalization analysis cache created by audio commands.
- `assets/` — proxied assets.
- `wallpapers/` — wallpaper files served locally.
- `images/` — image cache.
- `audio_covers/` — covers tied to downloaded-track URNs; ignored by ordinary image cleanup
  and removed when their matching audio is removed.
- `ffmpeg/` — managed FFmpeg binary/location.

Application data includes `auth_session.json` (with migration from `sc-auth.json`) and
`call_enabled.json`.

Smart cache cleanup is scheduled by `src/routes/+layout.svelte` and runs at most once per
day when `settings.autoCacheCleanup` is enabled. The frontend sends liked/current/recent
track URNs and cover URLs as protected sets. Native `track_smart_cleanup` and
`image_cache_prune` remove only unprotected stale files, then enforce the selected ordinary
cache quota; `audio_liked/` is excluded from quota eviction. The related settings
(`cacheRetentionDays`, `cacheMaxMb`, `lastCacheCleanupAt`) persist in
`lomifynext_settings`.

Every successful `track_ensure_cached` request may include `coverUrl`. Native code saves
that image into `audio_covers/` without delaying playback. The loopback
`/downloaded-cover/` route serves it by canonical track URN, and can backfill covers for
audio downloaded by older builds while the original source is reachable. Track removal,
ordinary/liked cache clearing, quota enforcement, and smart cleanup prune orphan covers.

The persisted `settings.uiScale` mode controls native WebView zoom. `auto` is calculated
in `src/routes/+layout.svelte` from the Tauri window's physical size divided by the OS
scale factor, using 1920×1080 as 100%; the manual options store their percentage as a
string. Applying it requires `core:webview:allow-set-webview-zoom` in the main capability.

## 7. Shared Rust crates

The active helper crates are at repository-root `utils/`:

- `utils/call/client`
- `utils/call/relay`
- `utils/decrypt-client`
- `utils/decrypt`
- `utils/dpi-desync`
- `utils/tls-common`

`src-tauri/Cargo.toml` currently references `../utils/call/client` and
`../utils/decrypt-client`. Confirm manifest dependencies before assuming another helper
crate is part of the desktop build.

## 8. Known duplicate and inactive paths

Desktop-derived local worktrees contain tracked nested copies that are not activated by the current
Rust module declarations in `src-tauri/src/lib.rs` and the parent `mod.rs` files:

- `src-tauri/src/audio/audio/`
- `src-tauri/src/app/app/`
- `src-tauri/src/auth/auth/`
- `src-tauri/src/import/import/`
- `src-tauri/src/shared/shared/`

Several differ from their active parent files, so editing the nested copy can produce a
convincing change that never compiles into the application. The active paths are the
parent directories listed in section 5.

`src-tauri/utils/` is an identical tracked mirror of root `utils/`, but the active path
dependencies in `src-tauri/Cargo.toml` resolve to root `utils/`. Treat `src-tauri/utils/`
as inactive unless the manifest changes or the task explicitly concerns the duplicate.

The separately published mobile repository includes the active source paths only;
these inactive mirrors are retained in the local desktop-derived worktree.

Do not delete duplicate trees merely because they are inactive; removal is a separate
repository-cleanup decision that requires an explicit task.

## 9. Build and verification

| Purpose | Command |
| --- | --- |
| Install JS dependencies | `npm install` |
| Frontend development server only | `npm run dev` |
| Desktop development | `npm run tauri dev` |
| Svelte/TypeScript checks | `npm run check` |
| Frontend production build | `npm run build` |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml` |
| Desktop bundle | `npm run tauri build` |

Rust unit tests currently live in active audio decode, HLS/shared network helpers,
direct fetch, wallpapers, SoundCloud anonymous cache logic, and transcoding modules.

The package script `npm run push` stages every change, creates a generic commit, and
pushes it. Agents must not run it unless the user explicitly asks for that exact action.

## 10. Release/version synchronization

When changing the application version, verify all of these locations:

1. `package.json` — npm/package version.
2. `src-tauri/Cargo.toml` — Rust package version.
3. `src-tauri/tauri.conf.json` — Tauri bundle version.
4. `src/lib/version.ts` — UI-visible version and channel.
5. `src/lib/changelog.ts` for in-app notices and `docs/releases/v1.0.13.md` for current GitHub release notes.
   Current GitHub notes retain the requested 1.0.10 baseline and include 1.0.11/1.0.12 changes.
   The 1.0.12 GitHub notes aggregate changes since the last published version, 1.0.10;
   the intermediate local build 1.0.11 was not published.
6. In the mobile worktree, `src-tauri/tauri.conf.json > bundle.android.versionCode`
   must increase for each Android update, and `bundle.iOS.bundleVersion` for each iOS build.
7. In the mobile worktree, `src/lib/version.ts > APP_PACKAGE_VERSION` must match the
   package version used by the GitHub release checker.

## 11. Maintaining this map

Update this file in the same change when any of the following happens:

- A route, view, composition root, or major component is added or removed.
- Ownership moves between frontend modules or Rust modules.
- A Tauri command/event is added, removed, or changes payload ownership.
- Persistence keys, cache directories, or migration behavior changes.
- A duplicate tree is removed, activated, or replaced.
- Build/test commands or release-version locations change.

Do not update the verification date for a cosmetic edit. Update it only after checking
the affected paths against the repository.


## 12. Android mobile worktree

The mobile source is published to `main` at `pizxxxxx/LomifyNEXT-Mobile`.
The local desktop-derived worktree remains separate from the `LomifyNEXT-Tauri`
desktop checkout. Phone UI selection is
owned by `src/lib/mobile.ts` (Android/iOS user agent; `?mobile` for development preview).

- `src/lib/components/MobileApp.svelte`: phone header, four bottom tabs, home feed,
  native/browser back history, retained lazy-mounted tabs with independent scroll regions.
  `src/mobile.css` owns floating pill navigation and mini-player, artwork-led artist
  layout and shared phone typography; the selected Lomify accent/font settings persist.
  Home labels the selected recommendation source; `+page.svelte` ignores stale feed
  responses after a source change. Mobile `api.getTrendingTracks` never falls back to
  SoundCloud when Yandex is selected and reports a missing token or failed source.
  `src/lib/actions/mobileReveal.ts` cancels/replaces lightweight WAAPI tab entrances.
  Reuses Search and Lyrics, while `MobileArtistPage.svelte` owns the phone artist view.
  Home artist names use `ArtistTag` links; recommendation cards expose a three-dot track menu.
  Mobile Search uses the same menu for its best match and track rows, with like/download actions
  in that menu. Mobile Search publishes songs without waiting
  for playlist enrichment and refreshes when the settings source changes.
- `MobileSettings.svelte`: collapsible appearance, typography, playback, lyrics,
  connections, library and updates groups; desktop theme swatches, theme depth, motion, separate player/lyrics video background toggles, optional tilt depth, preview, blur, visualizer,
  data-saver, hidden-track reset and mobile lyrics controls; independent interface and
  lyrics font selection, plus link to `MobileEqualizer.svelte` for the native 10-band EQ.
  Appearance starts collapsed; summary rows show the current choice or a short description.
  EQ gains, enabled flag, and preset live in `lomifynext_settings`; `Player.svelte`
  coalesces updates and disables native filters when flat or switched off.
- `MobileArtistPage.svelte`: full-bleed artist portrait with centered name/play controls,
  profile information/share action, featured release, source selector, tracks and
  albums with lazy album-track loading and a 40-row initial track window. It replaces
  the desktop `ArtistPage.svelte` only in the mobile shell; `ArtistTag` and the mobile
  track menu navigate here through `goToArtist`.
- `src/lib/mobileArtists.ts`: bounded saved-artist collection in
  `lomifynext_mobile_artists` localStorage, with name normalization and defensive loading.
  The artist-page star toggles local membership; `MobileLibrary.svelte > Исполнители`
  opens saved pages. `node scripts/mobile-artists-test.mjs` covers session restore,
  removal, Unicode deduplication, damaged/unavailable storage and the 200-item limit.
- `MobileConnections.svelte`: collapsible, numbered Yandex/MarshalX device-flow guide
  (external browser, manual token paste), public SoundCloud profile/likes/playlist import,
  bounded account checks and recoverable errors. `mobileConnectionRequest` in `mobile.ts`
  opens the Yandex guide from Wave without carrying credentials. `api.getUserPlaylists`
  has an opt-in strict error mode for this flow; existing callers retain tolerant behavior.
  `likes.syncLikes` serializes a new-account/source request after an unrelated running sync.
- `MobileWave.svelte`: separate `currentView='wave'` screen, animated entry/exit,
  a two-layer gradient glow with slow compositor-only motion and Android FFT-reactive scale/opacity,
  track-first hero with centered cover and synchronized lyric snippet, play/pause/restart and
  genre/language/vocal filters for Yandex, genre filter for SoundCloud.
  The glow stops animating when paused, hidden, motion-reduced or disabled in settings.
  The single Home station card and this screen use `settings.searchSource` directly;
  `MobileConnections.svelte` owns the source selector.
  `settings.mobileWaveName` switches only the mobile station label between
  "Моя Волна" and "Моя Тусня"; it does not alter the source or recommendations.
  Uses the unchanged desktop station/filter semantics in `wave.ts` and `waveFilters.ts`.
  Mobile `wave.ts` additionally cancels stale starts with optional AbortSignal, account/
  track guards and request generations; refills cannot leak into a restarted session.
  The UI cancels pending startup on exit or after 25 seconds; active playback persists.
- `MobileLibrary.svelte`: horizontal collection shelf, category rows and recent-track
  artwork grid; separate playlists and saved-artists screens plus liked, downloaded and
  playlist track screens, playlist creation/playback, local title/cover editing,
  shake/manual playlist shuffle with top undo (enabled by `settings.mobileShakeShuffle`),
  per-track downloads through the three-dot menu and sequential bulk downloads. Track rows have matching 88px CSS/virtualization
  height and separate 44px title/artist targets. The detail screen is stored in browser history so Android Back returns
  to the overview. `MobileSettings.svelte` owns account identity/listening stats and
  profile editing. `mobileDownloads.ts` owns the download queue, progress, metadata in
  `lomifynext_mobile_downloads`, and native cache inventory sync. The liked/playlist track viewport is windowed to avoid
  mounting hundreds of rows and decoded covers at once while preserving scroll position.
  Track titles/artwork start playback; artist names are separate links to the mobile artist view.
  `mobilePlaylistCovers.ts` stores compressed square cover blobs in the separate
  `LomifyMobilePlaylistCovers` IndexedDB database and exposes temporary object URLs;
  playlist names remain in the existing `lomifynext_playlists` localStorage payload.
  `mobileShake.ts` detects a two-peak shake only while the playlist view is active;
  `mobileTracks.ts` owns shuffle/restore and SoundCloud liked-track Wave rotation,
  hidden-track keys, playlist additions/removal, deleted imported-playlist IDs
  (`lomifynext_mobile_removed_imported_playlists`) and track-menu context.
- `likes.ts`: `lomifynext_likes_sync` also keeps account-scoped Yandex removal IDs;
  `settings.mobileSkipRemovedYandexLikes` controls whether they are excluded from
  incoming sync. Mobile single/bulk deletion can remain local or queue explicit
  Yandex remote unlike operations. Remote bulk deletion first reads all account
  like IDs, including items not imported to the phone. SoundCloud removal remains local-only.
- `MobileConnections.svelte`: imports SoundCloud public playlists and local copies
  of connected Yandex playlists through `getYandexUserPlaylists` in `yandex.ts`;
  deleted imported IDs stay excluded until reset in `MobileSettings.svelte`.
- `MobileTrackMenu.svelte` and `actions/mobileHold.ts`: long-press opens the native
  dialog; audio preview starts only from its button and pauses/restores native playback.
  Its compact cover/title header and highlighted next-in-queue action are shared across phone views.
- Mobile `Player.svelte` mounts shared `Lyrics.svelte` in its full-player middle region
  by default, with large left-aligned text and a hide/show action. A compact artwork/title
  header owns artist/like/menu actions; bottom transport is followed by lyrics/shuffle/
  repeat/EQ actions. Portrait and landscape layouts keep lyrics above/beside controls.
  The persistent line/letter
  selector lives in `MobileSettings.svelte > Текст песни`.
  `Lyrics.svelte > embedded` reuses the player background without a second video.
  `MobileWave.svelte` opens this panel from the synchronized lyric snippet.
  `mobileTracks.ts > queueMobileTrackNext/mobileNextQueueIndex` own explicit successor
  priority before shuffle. Queue entries carry `mobileQueuedNext` without changing the
  source track; `wave.ts` preserves its station across these manual insertions.
  `actions/mobileHold.ts` suppresses the release click at window capture so a new dialog
  cannot receive an accidental Like action; fresh pointer gestures reset suppression.
  `MobileTrackMenu.svelte` owns interruptible WAAPI dialog/backdrop entry and exit;
  content and the native focus trap stay mounted until the closing motion finishes.
- `audio/prefetch.rs` owns one transient direct-audio download, capped at 16 MiB and
  15 minutes, cancellable on queue replacement. `audio_prefetch_url` is registered in
  `lib.rs`; mobile `audio/engine.rs` consumes ready/in-flight bytes before downloading.
  No offline-cache or like persistence is involved. Player prepares again on queue edits.
  `yandex.ts` shares signed-link requests for 90 seconds (account/track/data-saver key,
  64 entries); `getAudioUrl > fresh` bypasses them after CDN rejection. `api.ts` shares
  concurrent lyric requests between the player and lyric view.
  `node scripts/mobile-hold-test.mjs` covers modal-release protection; existing
  mobile feature/Wave tests cover explicit-next priority and station continuity.
  `node scripts/mobile-stream-test.mjs` covers signed-link reuse, expiry, forced
  refresh, account isolation and the mobile data-saver bitrate route.
- `Player.svelte` retains shared native playback/queue logic; its `mobile` prop selects
  the mini-player and portrait/landscape now-playing screen instead of desktop controls.
  The expanded Android player paints full-bleed artwork and, when Yandex provides it,
  a muted background video through `MobileVideoBackdrop.svelte`, shared with the mobile
  lyrics screen. Video mounts only while its view is open, playing and visible; video
  settings and system reduced motion can disable it. `yandex.ts` maps `backgroundVideoUri` and lazily
  checks a full track response when list metadata omitted the field.
  The expanded panel mounts only while visible to avoid Android WebView painting an
  offscreen copy; a short interruptible transition preserves motion, and focus returns
  to the trigger. Android uses unity engine gain and OS volume,
  independent of the hidden desktop volume slider. Mobile loading supports cancel/retry.
  The local DOM event `lomify:open-player` lets Wave open the same expanded panel.
  In the expanded mobile panel, artist names open the artist view and the equalizer
  has its own full-width action away from the lyrics button.
  The compact player separates title and artist/status into two ellipsized lines;
  horizontal touch swipes advance or reverse the queue, while vertical scrolling
  remains available. `settings.mobileBlur` controls its and the bottom navigation's
  translucent blur.
  The phone timer renders at about 4 Hz instead of every audio tick; when the page is
  hidden, progress subscribers update at about 1 Hz while queue/crossfade logic keeps
  receiving every tick.
- `src/mobile.css`: mobile semantic tokens, theme-colored background, restrained panel elevation,
  darkened video behind lyrics, touch targets, safe-area layout and responsive
  overrides, including compact Home-card artist labels and a single-row best-match
  search result with reduced-motion-safe entrance, font mappings, and minimal
  no-orbit station artwork. `+layout.svelte` skips desktop zoom, titlebar and pointer
  effects on mobile, but initializes downloaded covers and download inventory.
- `Lyrics.svelte`: mobile mounts the shared view in line-sync mode by default (one
  update per timed line, no per-character animation); `settings.mobileLyricsLetterSync`
  enables optional per-letter sync from `MobileSettings.svelte`. Parenthesized ad-libs are parsed from lyrics and
  shown as a lightweight timed backdrop; plain lyrics show them inline. The ad-lib
  toggle and lyrics offset persist in `lomifynext_settings` via `MobileSettings.svelte`.
  `mobileLyricsVideoBackground` independently controls muted Yandex video behind lyrics;
  the shared `MobileVideoBackdrop.svelte` caches video URL resolution.
  `actions/mobileDepth.ts` uses one orientation listener for a few visible large panels
  when `mobileDepthMotion` is enabled, and stops on hide or reduced motion.
  The shared desktop view in this worktree retains its optional per-character mode.
- `yandex.ts`: on Android, legacy MP3 bitrate order can favor smaller streams when
  `settings.mobileDataSaver` is enabled. `audio/state.rs` disables pre-playback loudness
  analysis on Android; `audio/analyser.rs` taps PCM only while the mobile visualizer is on.
- `src-tauri/src/lib.rs` registers `audio_visualizer_set_enabled` and starts the FFT worker
  on Android. `audio/commands.rs` owns the switch; desktop FFT remains enabled by default.
  `MobileWave.svelte` disables FFT and glow motion while paused, reduced-motion is requested, the page is hidden, or the visualizer setting is off.
- `src-tauri/gen/android/.../MainActivity.kt` disables WebView pinch zoom and allows
  user-started delayed preview playback.
- `src/lib/changelog.ts`: structured Android preview notes for this mobile worktree.
  Android version is `1.0.13` in npm/Cargo/Tauri metadata and `src/lib/version.ts`.
  `bundle.android.versionCode` is 9010004, above earlier Android test installs.
- `src/lib/mobileUpdateCore.ts`: pure semantic-version comparison and strict GitHub
  ARM64 APK asset selection; the APK name, not its GitHub release tag, is authoritative.
  `src/lib/mobileUpdates.ts` checks the public GitHub releases API on Android launch/
  resume or manual request, stores a 6-hour result in `lomifynext_mobile_update_check`,
  and opens the selected APK in the system browser for user-confirmed installation.
  `MobileApp.svelte` shows an available-update notice; `MobileSettings.svelte` owns
  manual check/status and iOS TestFlight guidance. The Tauri updater plugin is not
  used because it does not support Android/iOS. `docs/ANDROID_UPDATES.md` describes
  APK naming, monotonic versionCode and same-key signing. `node scripts/mobile-updates-test.mjs`
  covers version/tag mismatch and unsafe asset URLs without network access.
- Android currently disables auto-cache/transcode and crossfade; native MP3/AAC playback
  uses Symphonia. Native Opus and desktop FFmpeg are not bundled for Android. Explicit
  downloads use the existing raw-cache path under persistent Android app data
  (`downloads/audio_incoming`), so Android cache eviction does not remove them.
- `src-tauri/src/android_audio.rs`: initializes CPAL's ndk-context from Tao's JVM and an
  owned Application global reference, before audio workers start; also gives the media
  bridge safe access to the JVM. Tao is pinned to 0.35.3
  to share Tauri's context registry; review this coupling when upgrading Tauri/Tao.
- `src-tauri/src/android_media.rs` bridges the existing rodio AudioState and Tauri media
  events to the platform `PlaybackService`. It resolves the service Class through the
  Application class loader once so Rust-created audio threads can update the media
  session without Android `FindClass` crashes. Java media callbacks return immediately;
  play/pause/seek/stop run on a Rust worker. `audio/commands.rs` publishes metadata,
  playback state and position; Player handles seek and transport events. Desktop
  `souvlaki` media controls are excluded from Android via `audio/mod.rs` and Cargo cfg.
- `audio/background.rs` owns a small Android-only prepared queue while the activity is
  paused. `Player.svelte` sends up to two resolved successors with
  `audio_background_prepare`; `audio/tick.rs` starts them natively on end instead of
  waiting for the suspended WebView. `audio:background-advanced` and
  `audio_background_status` reconcile the UI queue on return. `MainActivity.kt`
  forwards lifecycle visibility through `android_media.rs`; the page also sends
  `audio_background_set_hidden` for WebView visibility changes.
- `PlaybackService.kt` holds a partial CPU wake lock only while playback is active
  (declared in the Android manifest), so native end/advance can run with the screen off.
- `src-tauri/src/lib.rs`: Android manages AudioState and tick emitter; does not initialize
  tray, desktop media controls, output monitor or desktop-only plugins.
- `src-tauri/capabilities/mobile.json`: Android/iOS bridge permissions, separate from
  desktop default capability. Only Android has been built; iOS is not verified.
- iOS preparation: `src-tauri/src/lib.rs`, `audio/decode.rs`, `audio/mod.rs`, and
  `app/mod.rs` now keep desktop plugins, tray, FFmpeg and media controls off both
  mobile targets. iOS uses the mobile Symphonia decode path and persistent app-data
  downloads. `src-tauri/tauri.conf.json > bundle.iOS` sets iOS 15 minimum and build
  number 10005. `src-tauri/icons/ios/` uses the current plum PC artwork. This is not
  an iOS build or a verified sound path; the iOS audio session, background playback,
  lock-screen controls and WKWebView network behavior need Mac/iPhone testing.
- `src-tauri/Info.ios.plist` allows only local networking for the app's 127.0.0.1
  artwork/cache server without disabling ATS for external music services.
- `docs/IOS_SETUP.md`: concrete Mac/Xcode/iPhone first-run and validation steps.
- `src-tauri/gen/android/`: generated Android Studio project, with app-owned MainActivity
  system-bar/keyboard insets, app-owned `PlaybackService.kt` platform MediaSession and
  foreground notification, app-owned monochrome dotted-wave notification icon and
  launcher fallback artwork, launcher resources from `src-tauri/icons/android`, manifest,
  and cross-drive Kotlin incremental compilation disabled in gradle.properties.
  `app/build.gradle.kts` keeps minSdk 26 and NDK 30.0.14904198 explicit; debug APKs
  strip native symbols while the original Cargo libraries retain them locally.
- `src-tauri/mobile-icon.json`: launcher generation from the user-selected PC artwork:
  root `NewIcon.png` for standard icons, transparent `NewIconPPP.png` for the adaptive
  foreground (80% scale) on a plum background. Generated `static/mobile-icon.png`
  uses the same artwork in the phone header.
- `scripts/android-webview.mjs`: local debug WebView inspection after an explicit adb
  port forward. Does not expose a debug endpoint in release builds.
- `scripts/android-mobile-smoke.mjs`: emulator UI/native playback smoke checks over CDP;
  `scripts/android-mobile-features-smoke.mjs`: non-destructive checks for new profile,
  playlist form, hold menu, mounted-only full player, selected-source Wave screen and Android FFT command;
  `node scripts/mobile-features-test.mjs`: isolated SoundCloud station/playlist regression;
  `node scripts/mobile-download-test.mjs`: isolated sequential downloads and removal;
  `node scripts/mobile-wave-test.mjs`: isolated station/cancellation/filter regression tests,
  mocked network and stores, never reads real accounts;
  `node scripts/mobile-video-test.mjs`: isolated Yandex moving-artwork mapping and
  URL allowlist checks, without network or account data.

Commands from mobile worktree root:

- `npm run tauri android dev` — install/run in a booted emulator with Vite.
- `npm run tauri android build -- --debug --target x86_64 --apk` — standalone emulator APK.
- `npm run tauri android build -- --debug --target aarch64 --apk` — installable
  debug-signed test APK for ARM64 phones.
- `npm run tauri android build -- --target aarch64 --apk` — ARM64 release APK; needs
  signing configuration before distribution. Not a Google Play-ready release yet.
- The direct-share beta `LomifyNEXT-1.0.0-beta.2-arm64.apk` at the mobile worktree
  root is the optimized ARM64 release APK signed with this machine's Android debug
  keystore using SDK `apksigner`; its certificate matches the earlier beta.1 APK.
  Versions 1.0.2 through 1.0.8 use matching `LomifyNEXT-<version>-arm64.apk`
  filenames and the same signing key for
  in-place updates. `node scripts/mobile-library-test.mjs` covers local/remote
  deletion, selective sync, renaming and imported-playlist tombstones;
  `node scripts/mobile-playlist-cover-test.mjs` covers cover persistence and removal.
  Future in-place updates need the same signing key;
  this key is for testing/direct sharing, not Play Store publication.
- `LomifyNEXT-1.0.11-arm64.apk` is the preceding local beta build: Android versionCode
  9010002, ARM64 only, minimum API 26. Its verified signing certificate matches
  `LomifyNEXT-1.0.10-arm64.apk`, and SDK zip alignment checks pass for 16 KiB pages.
- `LomifyNEXT-1.0.12-arm64.apk` is the preceding local beta build: Android versionCode
  9010003, ARM64 only, minimum API 26; mobile design polish. Its signing certificate matches
  1.0.11 and the final signed APK passes 16 KiB page alignment checks. Visual QA uses synthetic data at phone
  portrait/landscape sizes; no real-phone smoke test was performed for this release.
- `LomifyNEXT-1.0.13-arm64.apk` is the current local beta build: Android versionCode
  9010004, ARM64 only, minimum API 26; artist/library/player redesign and saved artists.
  Uses the same direct-share signing key as 1.0.12 and 16 KiB page alignment checks.
  Browser visual QA uses synthetic data at 320x640, 375x812, 412x915 and 844x390;
  no real-phone smoke test was performed for this release.

SDK: Android API 26 minimum, Android Studio JBR, SDK/NDK via JAVA_HOME, ANDROID_HOME,
NDK_HOME. Android foreground media notification and hardware transport keys have been
smoke-tested on Pixel 8 API 36 emulator with the app backgrounded and screen off.
Bluetooth routing and real-device battery behavior still need device verification.
