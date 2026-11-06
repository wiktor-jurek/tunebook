# Tune Companion monorepo tasks. `just` lists them.
# Toolchains live where `just setup` put them; override any of these in your shell.

export PATH := "/opt/homebrew/opt/rustup/bin:" + env("HOME") + "/.cargo/bin:" + env("HOME") + "/Library/Android/sdk/platform-tools:" + env("HOME") + "/Library/Android/sdk/emulator:" + env("PATH")
export DEVELOPER_DIR := env("DEVELOPER_DIR", "/Applications/Xcode.app/Contents/Developer")
export JAVA_HOME := env("JAVA_HOME", "/Volumes/Storage/Applications/Android Studio.app/Contents/jbr/Contents/Home")
export ANDROID_HOME := env("ANDROID_HOME", env("HOME") + "/Library/Android/sdk")

ios_kit := "apps/ios/Packages/TuneKit"
android_listen := "apps/android/core/listen/src/main"
simulator := env("IOS_SIMULATOR", "iPhone 17 Pro")

default:
    @just --list

# Install the toolchains (Homebrew, rustup targets, Android SDK). Xcode and Android Studio come from their own installers.
setup:
    brew install rustup xcodegen just wasm-pack gradle
    brew install --cask android-commandlinetools
    rustup default stable
    rustup component add clippy rustfmt
    rustup target add aarch64-apple-ios aarch64-apple-ios-sim aarch64-linux-android x86_64-linux-android wasm32-unknown-unknown
    cargo install cargo-ndk --locked
    yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses > /dev/null
    sdkmanager --sdk_root="$ANDROID_HOME" "platform-tools" "platforms;android-37.0" "build-tools;37.0.0" "ndk;29.0.14206865" "emulator" "system-images;android-37.0;google_apis;arm64-v8a"
    npm install

# Run the web app (apps/web) in development.
web:
    npm run dev

# Test everything that runs without a device: web, tokens and the Rust workspace.
test: core-test
    npm test

# Rust tests, lints and formatting.
core-test:
    cargo test --workspace --exclude listen-wasm
    cargo clippy --workspace --all-targets -- -D warnings
    cargo fmt --all --check

# Regenerate the native design tokens after `npm run extract -w packages/tokens`.
tokens:
    npm run extract -w packages/tokens
    npm run generate -w packages/tokens

# Build the listen engine for iOS: an XCFramework plus its Swift bindings, into TuneKit.
ios-core:
    cargo build --release -p listen-ffi
    cargo build --release -p listen-ffi --lib --target aarch64-apple-ios
    cargo build --release -p listen-ffi --lib --target aarch64-apple-ios-sim
    rm -rf target/uniffi-swift {{ios_kit}}/listen_ffiFFI.xcframework {{ios_kit}}/Sources/ListenCore/Generated
    cargo run --release -p listen-ffi --bin uniffi-bindgen -- generate --library target/release/liblisten_ffi.dylib --language swift --out-dir target/uniffi-swift
    mkdir -p target/uniffi-swift/headers {{ios_kit}}/Sources/ListenCore/Generated
    cp target/uniffi-swift/listen_ffiFFI.h target/uniffi-swift/headers/
    cp target/uniffi-swift/listen_ffiFFI.modulemap target/uniffi-swift/headers/module.modulemap
    xcodebuild -create-xcframework \
        -library target/aarch64-apple-ios/release/liblisten_ffi.a -headers target/uniffi-swift/headers \
        -library target/aarch64-apple-ios-sim/release/liblisten_ffi.a -headers target/uniffi-swift/headers \
        -output {{ios_kit}}/listen_ffiFFI.xcframework
    cp target/uniffi-swift/listen_ffi.swift {{ios_kit}}/Sources/ListenCore/Generated/

# Render the iOS app icon from apps/ios/design/app-icon.svg (the brand mark on ink).
ios-icon:
    rsvg-convert -w 1024 -h 1024 -b "#1F3A2E" apps/ios/design/app-icon.svg -o apps/ios/TuneCompanion/Assets.xcassets/AppIcon.appiconset/AppIcon.png

# Generate the Xcode project from apps/ios/project.yml.
ios-project:
    cd apps/ios && xcodegen generate

# Build the iOS app for the simulator.
ios-build: ios-project
    xcodebuild -project apps/ios/TuneCompanion.xcodeproj -scheme TuneCompanion \
        -destination "platform=iOS Simulator,name={{simulator}}" -derivedDataPath apps/ios/build \
        -quiet build

# Build, install and launch on a booted (or booted here) simulator.
ios-run: ios-build
    xcrun simctl boot "{{simulator}}" 2>/dev/null || true
    open -a Simulator
    xcrun simctl install booted apps/ios/build/Build/Products/Debug-iphonesimulator/TuneCompanion.app
    xcrun simctl launch --console-pty booted com.tunecompanion.app

# Build and run on the iPhone Duo simulator; fold and unfold it from Device Hub to switch displays.
ios-run-duo:
    IOS_SIMULATOR="iPhone Duo" just ios-run

# Run TuneKit's Swift tests (they call the Rust engine) on the simulator.
ios-test:
    cd {{ios_kit}} && xcodebuild test -scheme TuneKit-Package -destination "platform=iOS Simulator,name={{simulator}}" 2>&1 | grep -E "^.?(✔|✘|➜) Test|error:"

# Name a real clip with the shipped model on the simulator: just ios-recognise <clip.f32> <tune id>
ios-recognise clip tune:
    cd {{ios_kit}} && TEST_RUNNER_FINDER_DIR="{{justfile_directory()}}/apps/web/public/finder" TEST_RUNNER_FINDER_CLIP="{{clip}}" TEST_RUNNER_FINDER_TUNE="{{tune}}" \
        xcodebuild test -scheme TuneKit-Package -destination "platform=iOS Simulator,name={{simulator}}" -only-testing:FinderTests 2>&1 | grep -E "model loaded|second|named|passed|failed|error:"

# Name the tunes in a real recording file as Upload recording does, on the simulator: just ios-recognise-file <file.m4a> <first tune id>
ios-recognise-file file tune:
    cd {{ios_kit}} && TEST_RUNNER_FINDER_DIR="{{justfile_directory()}}/apps/web/public/finder" TEST_RUNNER_FINDER_FILE="{{file}}" TEST_RUNNER_FINDER_FILE_TUNE="{{tune}}" \
        xcodebuild test -scheme TuneKit-Package -destination "platform=iOS Simulator,name={{simulator}}" -derivedDataPath ../../build/tunekit -only-testing:FinderTests 2>&1 | grep -E "named|passed|failed|error:"

# Build the listen engine for Android: .so files into jniLibs plus Kotlin bindings.
android-core:
    cargo build --release -p listen-ffi
    rm -rf {{android_listen}}/jniLibs {{android_listen}}/java/uniffi
    cargo ndk -t arm64-v8a -t x86_64 -o {{android_listen}}/jniLibs build --release -p listen-ffi --lib
    cargo run --release -p listen-ffi --bin uniffi-bindgen -- generate --library target/release/liblisten_ffi.dylib --language kotlin --no-format --out-dir {{android_listen}}/java

# Name a real clip with the shipped model on a running emulator: just android-recognise <clip.f32> <tune id>
android-recognise clip tune:
    adb shell mkdir -p /data/local/tmp/finder
    adb push apps/web/public/finder/model.onnx apps/web/public/finder/tunes.json apps/web/public/finder/popularity.json /data/local/tmp/finder/ > /dev/null
    adb push "{{clip}}" /data/local/tmp/clip.f32 > /dev/null
    adb logcat -c
    cd apps/android && ./gradlew --quiet :core:listen:connectedDebugAndroidTest \
        -Pandroid.testInstrumentationRunnerArguments.finderDir=/data/local/tmp/finder \
        -Pandroid.testInstrumentationRunnerArguments.clip=/data/local/tmp/clip.f32 \
        -Pandroid.testInstrumentationRunnerArguments.tune={{tune}} || true
    adb logcat -d -s Recognition:I | grep -E "model loaded|second|named"

# Name the tunes in a real recording file as Upload recording does, on a running emulator: just android-recognise-file <file> <first tune id>
android-recognise-file file tune:
    adb shell mkdir -p /data/local/tmp/finder
    adb push apps/web/public/finder/model.onnx apps/web/public/finder/tunes.json apps/web/public/finder/popularity.json /data/local/tmp/finder/ > /dev/null
    adb push "{{file}}" /data/local/tmp/recording > /dev/null
    adb logcat -c
    cd apps/android && ./gradlew --quiet :core:listen:connectedDebugAndroidTest \
        -Pandroid.testInstrumentationRunnerArguments.finderDir=/data/local/tmp/finder \
        -Pandroid.testInstrumentationRunnerArguments.file=/data/local/tmp/recording \
        -Pandroid.testInstrumentationRunnerArguments.fileTune={{tune}} || true
    adb logcat -d -s Recognition:I | grep -E "named"

# Build the Android debug APK.
android-build:
    cd apps/android && ./gradlew --quiet assembleDebug

# Install and launch on a running emulator or device.
android-run: android-build
    # Debug builds talk to the dev server on this Mac at localhost:3000, tunnelled by adb.
    adb reverse tcp:3000 tcp:3000
    adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
    adb shell am start -n com.tunecompanion.app/.MainActivity

# Boot the Android emulator headless and mirror it in a window (its own window hangs on this Mac), with the dev server tunnelled.
android-emulator:
    emulator -avd TuneCompanion_API37 -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect > /dev/null 2>&1 &
    adb wait-for-device && until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ]; do sleep 2; done
    adb reverse tcp:3000 tcp:3000
    scrcpy --window-title "Tune Companion (Android)" --stay-awake > /dev/null 2>&1 &

# Build the listen engine for browsers into packages/listen-wasm.
wasm-core:
    wasm-pack build crates/listen-wasm --release --target web --out-dir ../../packages/listen-wasm --out-name listen

# Run the realtime service locally on :4000.
realtime:
    cargo run -p realtime
