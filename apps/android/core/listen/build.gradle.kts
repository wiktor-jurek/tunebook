// The Rust listen engine: jniLibs and UniFFI bindings come from `just android-core`.
plugins {
    alias(libs.plugins.android.library)
}

android {
    namespace = "com.tunecompanion.app.listen"
    compileSdk = 37
    defaultConfig {
        minSdk = 29
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
}

dependencies {
    // UniFFI's Kotlin bindings call the .so through JNA.
    implementation("${libs.jna.get()}@aar")
    // The same model.onnx the website runs. LiteRT conversion can replace this later.
    implementation(libs.onnxruntime)
    implementation(libs.coroutines.android)
    androidTestImplementation(libs.test.runner)
    androidTestImplementation(libs.test.junit)
}
