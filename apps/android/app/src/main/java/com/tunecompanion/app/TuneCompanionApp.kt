package com.tunecompanion.app

import android.app.Application
import com.tunecompanion.app.api.ApiClient

/** Sets up what every screen shares: the API client (and, through it, the session). */
class TuneCompanionApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Services.api = ApiClient(this, BuildConfig.API_BASE)
        Library.load()
        RecordingUploads.init(this)
    }
}

object Services {
    lateinit var api: ApiClient
}
