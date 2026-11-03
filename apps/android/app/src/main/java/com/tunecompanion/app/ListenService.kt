// Keeps listening going with the screen off or another app open, as a microphone foreground
// service whose notification is the Live Update. It follows ListenController and stops itself
// when listening ends.
package com.tunecompanion.app

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

class ListenService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var notifications: ListenNotifications

    override fun onCreate() {
        super.onCreate()
        notifications = ListenNotifications(this)
        startForeground(ListenNotifications.ID, notifications.build(ListenController.state.value), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        scope.launch {
            ListenController.state.distinctUntilChangedBy().collect { state ->
                if (state.live) {
                    notifications.show(state)
                } else {
                    // Leave the answer in the shade for a moment; the notification goes with the service.
                    stopForeground(if (state.phase == Phase.Named) STOP_FOREGROUND_DETACH else STOP_FOREGROUND_REMOVE)
                    if (state.phase == Phase.Named) notifications.show(state)
                    stopSelf()
                }
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    // Updating the notification for every confidence wobble is wasteful; follow what it shows.
    private fun kotlinx.coroutines.flow.Flow<ListenState>.distinctUntilChangedBy() =
        distinctUntilChanged { a, b -> a.live == b.live && a.phase == b.phase && a.current == b.current && a.quiet == b.quiet &&
            a.downloading?.times(20)?.toInt() == b.downloading?.times(20)?.toInt() && (a.confidence * 10).toInt() == (b.confidence * 10).toInt() }

    companion object {
        fun start(context: Context) {
            context.startForegroundService(Intent(context, ListenService::class.java))
        }
    }
}
