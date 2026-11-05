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
        // Debug builds reach this Mac's dev server through `adb reverse tcp:3000 tcp:3000` (just android-run sets it up), the
        // same way on the emulator and on a phone over USB; release builds talk to production.
        buildConfigField("String", "API_BASE", "\"https://tunecompanion.com\"")
        // The website's Google client: Sign in with Google asks for an ID token for it, which the server accepts. Client IDs
        // are public; Google matches this app to its Android client (package name and signing certificate) in the same project.
        buildConfigField("String", "GOOGLE_SERVER_CLIENT_ID", "\"227010461268-2ak1chs98chq247ggsrso4nfl6ig59ed.apps.googleusercontent.com\"")
    }

    buildTypes {
        debug {
            buildConfigField("String", "API_BASE", "\"http://localhost:3000\"")
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
    // The music font (Bravura) the notation draws with: the same file the iPhone app bundles, one copy for both.
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
    implementation(libs.credentials)
    implementation(libs.credentials.play.services)
    implementation(libs.googleid)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
}
