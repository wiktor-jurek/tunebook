// A recording picked from the phone (its own recorder, or any file Android can decode), listened through as the live
// finder would have heard it at the session: decoded to mono, given to the Rust listen session a second at a time, and
// from 3 s in each second's last 8 s scored, as the web's worker and the iPhone's FileListener do.
package com.tunecompanion.app.listen

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import uniffi.listen_ffi.ListenSession
import uniffi.listen_ffi.ListenStatus
import uniffi.listen_ffi.ListenWindow
import java.nio.ByteOrder

object FileListener {
    /** A tune the finder named, and how far into the recording (ms). */
    data class Named(val tuneId: Int, val atMs: Long)
    data class Result(val durationMs: Long, val named: List<Named>)

    class Unreadable : Exception("This file could not be read as audio")

    /**
     * Decodes [uri] and names its tunes. [onRate] is told the audio's sample rate before the first samples; [onAudio] then
     * gets it as mono float in blocks, to keep a copy. [progress] is 0 to 1. Slow (a model run per second of audio): call it
     * off the main thread. [isActive] is checked as it goes, so a cancelled coroutine stops it.
     */
    fun nameTunes(context: Context, uri: Uri, runner: ModelRunner, model: FinderModel, onRate: (Int) -> Unit, onAudio: (FloatArray) -> Unit,
                  progress: (Float) -> Unit, isActive: () -> Boolean = { true }): Result {
        val extractor = MediaExtractor()
        try {
            runCatching { extractor.setDataSource(context, uri, null) }.onFailure { throw Unreadable() }
            val track = (0 until extractor.trackCount).firstOrNull { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
                ?: throw Unreadable()
            extractor.selectTrack(track)
            val format = extractor.getTrackFormat(track)
            val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
            val codec = runCatching { MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!) }.getOrElse { throw Unreadable() }
            try {
                codec.configure(format, null, null, 0)
                codec.start()
                return decode(extractor, codec, format, durationUs, runner, model, onRate, onAudio, progress, isActive)
            } finally {
                runCatching { codec.stop() }; codec.release()
            }
        } finally {
            extractor.release()
        }
    }

    private fun decode(extractor: MediaExtractor, codec: MediaCodec, input: MediaFormat, durationUs: Long, runner: ModelRunner, model: FinderModel,
                       onRate: (Int) -> Unit, onAudio: (FloatArray) -> Unit, progress: (Float) -> Unit, isActive: () -> Boolean): Result {
        var rate = input.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channels = input.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        var float = false
        var session: ListenSession? = null
        var second = FloatArray(rate)
        var filled = 0
        var seconds = 0
        var frames = 0L
        val named = mutableListOf<Named>()
        val info = MediaCodec.BufferInfo()
        var inputDone = false

        fun start() {
            onRate(rate)
            session = ListenSession(rate.toUInt(), model.tuneIds, model.tunebooks, runner.channels.toUInt())
            second = FloatArray(rate)
        }

        // A whole second of audio: into the session, and from 3 s in, scored.
        fun scoreSecond() {
            val listen = session ?: return
            listen.pushAudio(second.asList())
            seconds++
            if (seconds < 3) return
            val window = listen.nextWindow() as? ListenWindow.Features ?: return
            val verdict = listen.pushCosines(runner.cosines(window.values))
            val leader = verdict.candidates.firstOrNull()?.tuneId?.toInt()
            if (verdict.status == ListenStatus.MATCH && leader != null && named.lastOrNull()?.tuneId != leader) named += Named(leader, seconds * 1000L)
        }

        fun take(mono: FloatArray) {
            if (session == null) start()
            onAudio(mono)
            frames += mono.size
            var offset = 0
            while (offset < mono.size) {
                val n = minOf(second.size - filled, mono.size - offset)
                System.arraycopy(mono, offset, second, filled, n)
                filled += n; offset += n
                if (filled == second.size) { scoreSecond(); filled = 0 }
            }
        }

        while (true) {
            if (!isActive()) throw kotlinx.coroutines.CancellationException("Stopped")
            if (!inputDone) {
                val index = codec.dequeueInputBuffer(TIMEOUT_US)
                if (index >= 0) {
                    val size = extractor.readSampleData(codec.getInputBuffer(index)!!, 0)
                    if (size < 0) { codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
                    else { codec.queueInputBuffer(index, 0, size, extractor.sampleTime, 0); extractor.advance() }
                }
            }
            val index = codec.dequeueOutputBuffer(info, TIMEOUT_US)
            when {
                index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> codec.outputFormat.let { out ->
                    rate = out.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    channels = out.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    float = out.containsKey(MediaFormat.KEY_PCM_ENCODING) && out.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
                }
                index >= 0 -> {
                    val buffer = codec.getOutputBuffer(index)!!.order(ByteOrder.nativeOrder())
                    buffer.position(info.offset).limit(info.offset + info.size)
                    val count = info.size / (if (float) 4 else 2) / channels
                    if (count > 0) {
                        val mono = FloatArray(count)
                        if (float) { val f = buffer.asFloatBuffer(); for (i in 0 until count) { var s = 0f; for (c in 0 until channels) s += f.get(); mono[i] = s / channels } }
                        else { val p = buffer.asShortBuffer(); for (i in 0 until count) { var s = 0f; for (c in 0 until channels) s += p.get() / 32768f; mono[i] = s / channels } }
                        take(mono)
                    }
                    codec.releaseOutputBuffer(index, false)
                    if (durationUs > 0) progress((info.presentationTimeUs.toFloat() / durationUs).coerceIn(0f, 1f))
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                }
            }
        }
        if (frames == 0L) throw Unreadable()
        return Result(frames * 1000 / rate, named)
    }

    private const val TIMEOUT_US = 10_000L
}
