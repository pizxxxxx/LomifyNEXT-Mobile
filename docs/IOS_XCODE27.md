# Совместимость с Xcode 27

Сборка использует прежние версии Tauri и Tao. В `Info.ios.plist` объявлена
статическая сцена `TaoScene` с `TaoSceneDelegate`: UIKit из SDK iOS 27 завершает
приложение без объявления scene lifecycle ещё до открытия интерфейса.

В Tao 0.35.3 обнаружена отдельная ошибка владения `UISceneConfiguration`:
указатель возвращался после освобождения объекта. Локальная копия
`src-tauri/vendor/tao` содержит одну замену в iOS-модуле:
`Retained::autorelease_ptr(config)` вместо `Retained::as_ptr(&config)`.
Другие платформенные исходники совпадают с опубликованным пакетом 0.35.3.
См. [описание локального исправления](../src-tauri/vendor/tao/LOMIFY_PATCH.md).

Swift release-сборка под Xcode 27 может скрывать символы `@_cdecl`.
Текущий `swift-rs` сообщает, что нужен `llvm-objcopy` из Rust toolchain:

```sh
rustup component add llvm-tools
```

Дополнительно `src-tauri/vendor/swift-rs` основан на пакете 1.0.8 и экспортирует
встроенный `SwiftRs.o` только из архива Tauri. Без этого исправления в release
оставались локальными три функции: `_retain_object`, `_release_object` и
`_string_from_bytes`. Копии runtime в архивах плагинов сохраняются локальными,
чтобы не появлялись дублирующиеся глобальные символы. Глобальный Cargo registry
не редактируется. См. [описание исправления](../src-tauri/vendor/swift-rs/LOMIFY_PATCH.md).

Установите llvm-tools **до** первой сборки. Если библиотеки уже были собраны без
него, сохраните промежуточные результаты и заставьте Cargo повторить build scripts
Tauri и Swift-плагинов. В выполненной проверке старые fingerprints этих пакетов
перенесены в `src-tauri/target/ios-swift-before-llvm`, а сборка запущена повторно.
Не удаляйте весь target или исходники проекта ради этой ошибки.

Рабочие команды из корня проекта:

```sh
node scripts/ios-tauri.mjs prepare-project
node scripts/ios-tauri.mjs build --target aarch64-sim --debug --no-sign --archive-only --ci
node scripts/ios-tauri.mjs build --target aarch64 --no-sign --ci
```

`--archive-only` для симулятора позволяет устанавливать `.app` из
`gen/apple/build/lomifynext-tauri_iOS.xcarchive/Products/Applications` и избегать
ошибки экспорта `Directory not empty` при повторной генерации готового `.app`.
Для устройства последний шаг создаёт IPA; флаг `--archive-only` там не нужен.

Источники: [обязательный scene lifecycle](https://developer.apple.com/documentation/uikit/migrating-to-the-uikit-scene-based-life-cycle),
[manifest для Tauri/iOS 27](https://github.com/tauri-apps/tauri/issues/15719),
[исправление владения в Tao](https://github.com/tauri-apps/tao/pull/1245).
