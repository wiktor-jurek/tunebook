plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.tunecompanion.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.tunecompanion.app"
        minSdk = 29
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
        // The emulator reaches this Mac's dev server at 10.0.2.2; release builds talk to production.
        buildConfigField("String", "API_BASE", "\"https://tunecompanion.com\"")
    }

    buildTypes {
        debug {
            buildConfigField("String", "API_BASE", "\"http://10.0.2.2:3000\"")
        }
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    // Notation's abcjs and the score player: the same files the iPhone app bundles, one copy for both.
    sourceSets["main"].assets.directories.add("../../ios/Packages/TuneKit/Sources/Notation/Resources")
}

dependencies {
    implementation(project(":core:listen"))
    implementation(project(":core:designsystem"))
    implementation(project(":core:api"))
    implementation(libs.activity.compose)
    implementation(libs.core.ktx)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.coroutines.android)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
}
