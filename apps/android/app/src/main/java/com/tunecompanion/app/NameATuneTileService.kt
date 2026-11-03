package com.tunecompanion.app

import android.app.PendingIntent
import android.content.Intent
import android.service.quicksettings.TileService

/** "Name a tune" in Quick Settings: opens the app listening. */
class NameATuneTileService : TileService() {
    override fun onClick() {
        val intent = Intent(this, MainActivity::class.java).setAction(MainActivity.ACTION_NAME_A_TUNE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE))
    }
}
