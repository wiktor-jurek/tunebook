// The microphone, the Rust listen session and the model, run together. A reader thread pushes
// audio into the session as it arrives; once a second the last 8 s are scored unless the room is
// quiet, and the decoder's answer is reported.
package com.tunecompanion.app.listen

import android.Manifest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.content.Context
import android.annotation.SuppressLint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import uniffi.listen_ffi.HeardVerdict
import uniffi.listen_ffi.ListenSession
import uniffi.listen_ffi.ListenWindow
import uniffi.listen_ffi.hopMs

sealed interface ListenerEvent {
    /** The input's RMS level, several times a second. */
    data class Level(val rms: Float) : ListenerEvent
    /** The room is quiet; nothing was scored. */
    data object Quiet : ListenerEvent
    /** The answer so far, with candidates as The Session tune IDs. */
    data class Verdict(val verdict: HeardVerdict) : ListenerEvent
    data class Failed(val message: String) : ListenerEvent
}

class Listener(
    private val context: Context,
    private val runner: ModelRunner,
    private val model: FinderModel,
    private val onEvent: (ListenerEvent) -> Unit,
) {
    private var record: AudioRecord? = null
    private var session: ListenSession? = null
    private val jobs = mutableListOf<Job>()

    /** Needs [Manifest.permission.RECORD_AUDIO]; the caller checks it. */
    @SuppressLint("MissingPermission")
    fun start(scope: CoroutineScope) {
        // UNPROCESSED skips voice processing (gain control, noise suppression), which would eat the music.
        val unprocessed = context.getSystemService(AudioManager::class.java)
            .getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED) == "true"
        val source = if (unprocessed) MediaRecorder.AudioSource.UNPROCESSED else MediaRecorder.AudioSource.VOICE_RECOGNITION
        val minimum = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT)
        val record = AudioRecord.Builder()
            .setAudioSource(source)
            .setAudioFormat(AudioFormat.Builder().setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_IN_MONO).setEncoding(AudioFormat.ENCODING_PCM_FLOAT).build())
            .setBufferSizeInBytes(maxOf(minimum, BLOCK * 4 * 4))
            .build()
        val session = ListenSession(RATE.toUInt(), model.tuneIds, model.tunebooks, runner.channels.toUInt())
        this.record = record
        this.session = session
        record.startRecording()

        jobs += scope.launch(Dispatchers.IO) {
            val block = FloatArray(BLOCK)
            while (isActive) {
                val n = record.read(block, 0, BLOCK, AudioRecord.READ_BLOCKING)
                if (n <= 0) continue
                onEvent(ListenerEvent.Level(session.pushAudio(block.copyOf(n).asList())))
            }
        }
        jobs += scope.launch(Dispatchers.Default) {
            while (isActive) {
                delay(hopMs().toLong())
                when (val window = session.nextWindow()) {
                    ListenWindow.Empty -> Unit
                    ListenWindow.Quiet -> onEvent(ListenerEvent.Quiet)
                    is ListenWindow.Features -> runCatching { session.pushCosines(runner.cosines(window.values)) }
                        .onSuccess { onEvent(ListenerEvent.Verdict(it)) }
                        .onFailure { onEvent(ListenerEvent.Failed(it.message ?: it.toString())) }
                }
            }
        }
    }

    fun stop() {
        jobs.forEach { it.cancel() }
        jobs.clear()
        record?.run { runCatching { stop() }; release() }
        record = null
    }

    /** Forget the answer so far, keeping the audio (a wrong answer, or a set moving on). */
    fun reset() {
        session?.reset()
    }

    private companion object {
        const val RATE = 48_000
        const val BLOCK = 4096
    }
}
