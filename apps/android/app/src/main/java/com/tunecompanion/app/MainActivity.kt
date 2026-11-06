package com.tunecompanion.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.DisposableEffect
import com.tunecompanion.app.designsystem.TuneCompanionTheme
import com.tunecompanion.app.designsystem.isAppInDarkTheme

class MainActivity : ComponentActivity() {
    private var pending: Mode? = null
    // Listening works without notifications but needs the microphone; without it the tray says so.
    private val askMicrophone = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        pending?.let { ListenController.start(this, it) }
        pending = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            // The status and navigation bar icons follow the app's appearance, which can differ from the system's.
            val dark = isAppInDarkTheme()
            DisposableEffect(dark) {
                val bars = SystemBarStyle.auto(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT) { dark }
                enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
                onDispose {}
            }
            TuneCompanionTheme(dark) { AppShell(onListen = ::listen) }
        }
        handle(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    /** Starts listening, asking for the microphone (and notifications, for the Live Update) first if needed. */
    fun listen(mode: Mode) {
        val needed = listOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.POST_NOTIFICATIONS)
            .filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (needed.isEmpty()) return ListenController.start(this, mode)
        pending = mode
        askMicrophone.launch(needed.toTypedArray())
    }

    private fun handle(intent: Intent) {
        // The Quick Settings tile, and `--es autoListen session` for screenshots and UI tests.
        val auto = intent.getStringExtra(EXTRA_AUTO_LISTEN)
        if (BuildConfig.DEBUG) intent.getStringExtra("showTune")?.toIntOrNull()?.let { ListenController.debugShow(it) }
        when {
            intent.action == ACTION_NAME_A_TUNE -> listen(Mode.NameTune)
            auto != null -> listen(if (auto == "session") Mode.RecordSession else Mode.NameTune)
        }
    }

    companion object {
        const val ACTION_NAME_A_TUNE = "com.tunecompanion.app.NAME_A_TUNE"
        const val EXTRA_AUTO_LISTEN = "autoListen"
    }
}
