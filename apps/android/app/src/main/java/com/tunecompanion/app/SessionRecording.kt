// A whole session recorded on the phone, as the iPhone's SessionRecorder and the web's use-recorder: the audio goes to an
// AAC file as it arrives (so a crash or a dead battery loses at most a moment), with its setlist beside it, and it uploads
// when the session stops. One that could not upload stays on the phone, and the Recordings tab lists it to try again or
// discard.
package com.tunecompanion.app

import android.content.Context
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.util.Log
import com.tunecompanion.app.api.LocalRecording
import com.tunecompanion.app.listen.Listener
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Encodes microphone audio to an .m4a file on a thread of its own, so the listener never waits on it. */
class SessionRecorder(file: File) {
    private val thread = Executors.newSingleThreadExecutor()
    private val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
    private val muxer = MediaMuxer(file.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    private val info = MediaCodec.BufferInfo()
    private var track = -1
    @Volatile private var frames = 0L

    /** How far into the recording it is. */
    val elapsedMs: Long get() = frames * 1000 / Listener.RATE

    init {
        val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, Listener.RATE, 1).apply {
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_BIT_RATE, 64_000)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16 * 1024)
        }
        encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        encoder.start()
    }

    /** Called from the listener's reader thread. */
    fun write(samples: FloatArray) {
        thread.execute { runCatching { encode(samples) }.onFailure { Log.e(TAG, "Recording write failed", it) } }
    }

    /** Finishes the file and returns its length in ms. */
    fun end(): Long {
        thread.execute {
            runCatching {
                val index = encoder.dequeueInputBuffer(TIMEOUT_US)
                if (index >= 0) encoder.queueInputBuffer(index, 0, 0, presentationUs(), MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                drain(untilEnd = true)
            }.onFailure { Log.e(TAG, "Could not finish the recording", it) }
            runCatching { encoder.stop() }; encoder.release()
            if (track >= 0) runCatching { muxer.stop() }
            muxer.release()
        }
        thread.shutdown()
        thread.awaitTermination(10, TimeUnit.SECONDS)
        return elapsedMs
    }

    private fun encode(samples: FloatArray) {
        // 16-bit PCM, as the AAC encoder takes it.
        val pcm = ByteBuffer.allocate(samples.size * 2).order(ByteOrder.LITTLE_ENDIAN)
        for (sample in samples) pcm.putShort((sample.coerceIn(-1f, 1f) * Short.MAX_VALUE).toInt().toShort())
        pcm.flip()
        while (pcm.hasRemaining()) {
            val index = encoder.dequeueInputBuffer(TIMEOUT_US)
            if (index < 0) { drain(untilEnd = false); continue }
            val input = encoder.getInputBuffer(index)!!
            input.clear()
            val n = minOf(input.remaining(), pcm.remaining()) and 1.inv()
            val chunk = pcm.slice().limit(n) as ByteBuffer
            input.put(chunk)
            pcm.position(pcm.position() + n)
            encoder.queueInputBuffer(index, 0, n, presentationUs(), 0)
            frames += n / 2
            drain(untilEnd = false)
        }
    }

    private fun presentationUs() = frames * 1_000_000 / Listener.RATE

    private fun drain(untilEnd: Boolean) {
        var waits = 0
        while (true) {
            val index = encoder.dequeueOutputBuffer(info, if (untilEnd) TIMEOUT_US else 0)
            when {
                // Finishing waits up to two seconds for the encoder's last frames.
                index == MediaCodec.INFO_TRY_AGAIN_LATER -> if (!untilEnd || ++waits > 200) return
                index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> { track = muxer.addTrack(encoder.outputFormat); muxer.start() }
                index >= 0 -> {
                    val output = encoder.getOutputBuffer(index)!!
                    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0 && info.size > 0 && track >= 0) muxer.writeSampleData(track, output, info)
                    encoder.releaseOutputBuffer(index, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                }
            }
        }
    }

    private companion object {
        const val TAG = "TuneCompanion"
        const val TIMEOUT_US = 10_000L
    }
}

/** Recordings waiting on this phone, and the uploads in flight. */
object RecordingUploads {
    sealed interface Status {
        data class Sending(val progress: Float) : Status
        data object Saving : Status
        data object Done : Status
        data class Failed(val message: String) : Status
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var folder: File
    private val _pending = MutableStateFlow<List<LocalRecording>>(emptyList())
    val pending: StateFlow<List<LocalRecording>> = _pending
    private val _status = MutableStateFlow<Map<String, Status>>(emptyMap())
    val status: StateFlow<Map<String, Status>> = _status
    /** Bumped when an upload lands, so the list reloads. */
    private val _landed = MutableStateFlow(0)
    val landed: StateFlow<Int> = _landed

    /** The uploaded list changed some other way (a recording deleted): reload it. */
    fun landed() { _landed.value++ }

    fun init(context: Context) {
        folder = File(context.filesDir, "recordings").apply { mkdirs() }
        reload()
    }

    fun audio(recording: LocalRecording) = File(folder, "${recording.id}.m4a")
    private fun meta(recording: LocalRecording) = File(folder, "${recording.id}.json")

    fun save(recording: LocalRecording) {
        meta(recording).writeText(Services.api.json.encodeToString(LocalRecording.serializer(), recording))
        reload()
    }

    private fun reload() {
        _pending.value = folder.listFiles { file -> file.extension == "json" }.orEmpty()
            .mapNotNull { runCatching { Services.api.json.decodeFromString(LocalRecording.serializer(), it.readText()) }.getOrNull() }
            .filter { it.finished }
            .sortedByDescending { it.recordedAt }
    }

    fun discard(recording: LocalRecording) {
        audio(recording).delete(); meta(recording).delete()
        _status.update { it - recording.id }
        reload()
    }

    /** Create the row, PUT the audio to the bucket, then store the setlist. */
    fun upload(recording: LocalRecording) = scope.launch {
        if (_status.value[recording.id] is Status.Sending) return@launch
        fun set(status: Status?) = _status.update { if (status == null) it - recording.id else it + (recording.id to status) }
        set(Status.Sending(0f))
        try {
            val file = audio(recording)
            if (!file.exists() || file.length() == 0L) throw IllegalStateException("Nothing was recorded")
            val (id, url) = Services.api.createRecording(recording.name, "audio/mp4", recording.recordedAt)
            Services.api.putFile(url, file, "audio/mp4") { sent -> set(Status.Sending(sent)) }
            set(Status.Saving)
            Services.api.finishRecording(id, recording.durationMs, recording.tunes)
            set(Status.Done)
            withContext(Dispatchers.IO) { file.delete(); meta(recording).delete() }
            delay(1600)
            set(null)
            reload()
            _landed.value++
        } catch (cause: Exception) {
            Log.w("TuneCompanion", "Recording upload failed", cause)
            set(Status.Failed(when (cause) {
                is java.io.IOException -> "No connection. Try again when you're online."
                else -> cause.message?.takeIf { it.isNotBlank() } ?: "The upload failed"
            }))
        }
    }
}
