// The Tune Companion API (apps/web's routes), as the iPhone's TuneKit API module: signing in with
// better-auth's bearer tokens, the library, the finder's lookups, keeping tunes and recordings.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.tunecompanion.app.api"
    compileSdk = 37
    defaultConfig { minSdk = 29 }
}

dependencies {
    api(libs.serialization.json)
    implementation(libs.coroutines.android)
}
