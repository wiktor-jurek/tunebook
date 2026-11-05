# Tune Companion monorepo

| Path | What | Build |
|---|---|---|
| `apps/web` | Next.js app, API and MCP server (tunecompanion.com) | `npm run dev` |
| `apps/ios` | SwiftUI app, Live Activity and widgets (XcodeGen) | `just ios-core ios-run` |
| `apps/android` | Kotlin and Compose app (Gradle) | `just android-core android-run` |
| `crates/listen-core` | Listen engine front end and decoder in Rust, shared by every platform | `just core-test` |
| `crates/listen-ffi`, `crates/listen-wasm` | UniFFI (Swift, Kotlin) and wasm-bindgen wrappers | `just ios-core`, `just android-core`, `just wasm-core` |
| `services/realtime` | Rust session-room service (skeleton, not deployed) | `just realtime` |
| `packages/tokens` | Design tokens from `apps/web/src/app/globals.css`, generated into Swift and Kotlin | `just tokens` |
| `ml` | Python training and evaluation for the listen model | see `ml/README.md` |

- Web work: read `apps/web/AGENTS.md` first (this Next.js version differs from training data).
- `listen-core` ports `apps/web/src/lib/finder/{features,resample,decode}.ts`. Change both together until the web uses the WASM build; both are checked against `features.fixture.json`.
- Generated, never edited by hand: `Tokens.swift`, `Tokens.kt` (from `packages/tokens/tokens.json`), the UniFFI bindings, the XCFramework, `jniLibs` and `apps/ios/TuneCompanion.xcodeproj`.
- `just` sets `DEVELOPER_DIR` (Xcode 27.2 in /Applications, for the iOS 27 SDK and iPhone Duo), `JAVA_HOME` (Android Studio's JBR) and `ANDROID_HOME`.
