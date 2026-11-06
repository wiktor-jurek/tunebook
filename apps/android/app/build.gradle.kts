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
        // release-please owns apps/android/version.txt. The version code follows from it (0.2.3 is 2003, 1.4.0 is 1004000),
        // so every release Play sees is higher than the last; 0.1.0 went to Play by hand as version code 1.
        versionName = rootProject.file("version.txt").readText().trim()
        versionCode = versionName!!.split(".").map(String::toInt).let { (major, minor, patch) -> major * 1_000_000 + minor * 1_000 + patch }
        // Debug builds reach this Mac's dev server through `adb reverse tcp:3000 tcp:3000` (just android-run sets it up), the
        // same way on the emulator and on a phone over USB; release builds talk to production.
        buildConfigField("String", "API_BASE", "\"https://tunecompanion.com\"")
        // The website's Google client: Sign in with Google asks for an ID token for it, which the server accepts. Client IDs
        // are public; Google matches this app to its Android client (package name and signing certificate) in the same project.
        buildConfigField("String", "GOOGLE_SERVER_CLIENT_ID", "\"227010461268-2ak1chs98chq247ggsrso4nfl6ig59ed.apps.googleusercontent.com\"")
    }

    // The Play upload key. Its path and passwords live in ~/.gradle/gradle.properties, never in the repo; without them a
    // release build is left unsigned. Google re-signs what Play ships with the app signing key it holds.
    val upload = providers.gradleProperty("TUNECOMPANION_UPLOAD_STORE_FILE").orNull
    if (upload != null) signingConfigs.create("upload") {
        storeFile = file(upload)
        storePassword = providers.gradleProperty("TUNECOMPANION_UPLOAD_STORE_PASSWORD").get()
        keyAlias = providers.gradleProperty("TUNECOMPANION_UPLOAD_KEY_ALIAS").get()
        keyPassword = providers.gradleProperty("TUNECOMPANION_UPLOAD_KEY_PASSWORD").get()
    }

    buildTypes {
        debug {
            buildConfigField("String", "API_BASE", "\"http://localhost:3000\"")
        }
        release {
            isMinifyEnabled = true
            signingConfigs.findByName("upload")?.let { signingConfig = it }
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
