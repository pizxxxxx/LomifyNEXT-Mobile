# LomifyNEXT на iPhone: подготовка и первая проверка

Статус: Apple-проект создан; приложение открывается на iPhone 17 Simulator с iOS 27. Нативная панель UIKit и четыре вкладки проверены пользователем. Обработка аудио использует встроенные библиотеки FFmpeg без внешних процессов; первая неподписанная device IPA собрана. Установка приложения, звук и системные медиакнопки на настоящем iPhone ещё требуют проверки. APK для Android на iPhone не устанавливается.

Для установки и обновления через бесплатный Apple ID следуйте [IOS_ALTSTORE.md](IOS_ALTSTORE.md). Детали встроенного FFmpeg: [IOS_FFMPEG.md](IOS_FFMPEG.md).

Исходники Android и iOS остаются в одном мобильном проекте `LomifyNEXT-Mobile`; настольный проект `LomifyNEXT-Tauri` не затрагивается. Архив для Mac - копия исходников на момент упаковки. Дальнейшие исправления Android можно продолжать в рабочей мобильной папке; для Mac нужно будет перенести обновлённые исходники заново.

## Первый запуск на Mac

1. Установите Xcode из Mac App Store, откройте его один раз и дождитесь завершения установки компонентов. В Xcode откройте Settings > Accounts и добавьте Apple ID.
2. Установите [Node.js LTS](https://nodejs.org/), [Rust](https://rustup.rs/) и [Homebrew](https://brew.sh/). В Terminal выполните `rustup target add aarch64-apple-ios aarch64-apple-ios-sim` и `brew install cocoapods`.
3. Откройте папку актуального репозитория на Mac и выполните `npm ci`. Соберите аудиобиблиотеки: `bash scripts/build-ios-ffmpeg.sh aarch64-apple-ios` и `bash scripts/build-ios-ffmpeg.sh aarch64-apple-ios-sim`. Затем выполните `node scripts/ios-tauri.mjs init --skip-targets-install`. Не переносите готовые библиотеки симулятора вместо библиотек устройства.
4. Подключите iPhone кабелем, разблокируйте его и подтвердите доверие компьютеру. В Terminal из папки проекта выполните `node scripts/ios-tauri.mjs dev --open --host`. Команду не закрывайте, пока работает Xcode. Эти команды не загружают `.env` репозитория.
5. В открывшемся Xcode выберите цель приложения и вкладку Signing & Capabilities. В поле Team выберите свой Apple ID или команду разработчика. iOS использует отдельный идентификатор `io.github.pizxxxxx.lomifynext.mobile` из `tauri.ios.conf.json`; идентификатор Android не меняется. Для AltStore используйте отдельный путь сборки неподписанного IPA из `IOS_ALTSTORE.md`.
6. Выберите подключённый iPhone в списке устройств и нажмите Run. Если iPhone попросит включить Developer Mode, откройте Settings > Privacy & Security > Developer Mode, включите его и повторите запуск.

Успех первой проверки: приложение появляется на домашнем экране с фиолетовой иконкой, открывает главную и настройки, загружает трек, воспроизводит его через динамик и наушники, а скачанный трек играет без интернета.

## Что ещё нужно проверить до релиза

- Звук, маршрутизацию наушников, поведение при блокировке экрана и после звонка на реальном iPhone. Для iOS добавлен отдельный мост MediaPlayer/AVAudioSession; его работу нужно проверить на устройстве.
- Сетевые источники и локальный сервер обложек в WKWebView. Android-эмулятор не доказывает, что они работают в iOS.
- Подпись и распространение. Для установки на другие устройства и TestFlight нужны сертификат, профиль и настройка Apple Developer/App Store Connect. Не сохраняйте Apple ID, сертификаты или приватные ключи в проекте.

После этих проверок сборка IPA для AltStore выполняется на Mac командой `node scripts/ios-tauri.mjs build --target aarch64 --no-sign`. До проверки установки текущую папку следует считать подготовкой iOS, а не готовой iPhone-версией.

Официальные инструкции: [предварительные требования Tauri](https://v2.tauri.app/start/prerequisites/), [разработка на мобильных устройствах](https://v2.tauri.app/develop/), [подпись iOS](https://v2.tauri.app/distribute/sign/ios/).
