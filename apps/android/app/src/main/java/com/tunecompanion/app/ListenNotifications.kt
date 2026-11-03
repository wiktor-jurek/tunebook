// Listening as an Android 16 Live Update: a promoted ongoing notification with a status bar chip,
// the way the Dynamic Island shows it on iOS. Older Android gets a plain ongoing notification.
package com.tunecompanion.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build

class ListenNotifications(private val context: Context) {
    private val manager = context.getSystemService(NotificationManager::class.java)

    init {
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.listening_channel), NotificationManager.IMPORTANCE_DEFAULT).apply {
                setSound(null, null)
                enableVibration(false) // the app plays its own haptics
            },
        )
    }

    fun show(state: ListenState) {
        if (context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        manager.notify(ID, build(state))
    }

    fun build(state: ListenState): Notification {
        val open = PendingIntent.getActivity(
            context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE,
        )
        val tune = state.current.takeIf { state.phase == Phase.Named }
        val (title, text) = when {
            state.downloading != null -> "Getting the tune finder, ${(state.downloading * 100).toInt()}%" to null
            tune != null -> tune.displayTitle to tune.meta
            state.phase == Phase.Narrowing -> "Narrowing it down" to null
            state.quiet -> "Waiting for music" to null
            else -> "Listening" to null
        }
        val builder = Notification.Builder(context, CHANNEL)
            .setSmallIcon(if (state.phase == Phase.Named) R.drawable.ic_music_note else R.drawable.ic_waveform)
            .setContentTitle(title)
            .setContentText(text ?: if (state.mode == Mode.RecordSession) "Recording the session" else null)
            .setOngoing(state.live)
            .setContentIntent(open)
            .setOnlyAlertOnce(true)
            .setUsesChronometer(state.live)
            .setAutoCancel(!state.live)
            .setWhen(state.startedAt)
            .setColor(BRAND_DOT)
            .setCategory(Notification.CATEGORY_PROGRESS)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA && state.live) {
            builder.setRequestPromotedOngoing(true)
                .setShortCriticalText(tune?.displayTitle ?: "Listening")
            if (tune == null) {
                builder.setStyle(
                    Notification.ProgressStyle()
                        .setStyledByProgress(false)
                        .setProgress((state.confidence * 100).toInt())
                        .setProgressSegments(listOf(Notification.ProgressStyle.Segment(100).setColor(BRAND_DOT))),
                )
            }
        }
        return builder.build()
    }

    fun dismiss() = manager.cancel(ID)

    companion object {
        private const val CHANNEL = "listening"
        const val ID = 1
        private const val BRAND_DOT = 0xFFC8642A.toInt()
    }
}
