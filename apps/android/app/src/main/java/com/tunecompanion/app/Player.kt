// Playing a score natively, as the iPhone's ScorePlayback and the website's tune player: the notes
// through an instrument (FluidR3 samples, the same the website uses, fetched once and kept), or a
// play-along recording that follows the score; a bar of count-in clicks first if asked; each note lit
// as it sounds. While a score is open in the music layer the deck's head becomes its player: play, where
// it is, the sound and the speed, with the mic still a tap (or a pull) away.
package com.tunecompanion.app

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaPlayer
import android.media.PlaybackParams
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tunecompanion.app.api.PlayalongTrack
import com.tunecompanion.app.api.SavedTune
import com.tunecompanion.app.api.TuneHeard
import com.tunecompanion.app.api.displayTitle
import com.tunecompanion.app.designsystem.Palette
import com.tunecompanion.app.designsystem.TuneType
import com.tunecompanion.app.designsystem.current
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import uniffi.listen_ffi.ScoreEvent
import uniffi.listen_ffi.scoreTimeline
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteOrder
import kotlin.concurrent.thread
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/** The sounds a score can be played with (the website's SOUND_OPTIONS). */
enum class ScoreSound(val program: Int, val label: String) {
    Whistle(74, "Whistle-like, recorder"), Accordion(21, "Accordion"), Flute(73, "Flute"), Piano(0, "Piano");

    companion object { fun of(program: Int) = entries.firstOrNull { it.program == program } }
}

/** One score's player. Hand it to [AbcView]; the deck's player head calls it, and it publishes what it is doing. */
@Stable
class ScorePlayback(val title: String, val tuneId: Int, private val meter: String?, defaultSound: Int?, context: Context) {
    private val prefs = context.getSharedPreferences("ui", Context.MODE_PRIVATE)
    private val cache = File(context.cacheDir, "Soundfont")

    var playing by mutableStateOf(false); private set
    var loading by mutableStateOf(false); private set
    /** A bar of clicks before the notes, when count-in is on. */
    var counting by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    /** 0 to 100. */
    var progress by mutableFloatStateOf(0f); private set
    var speed by mutableIntStateOf(100); private set
    var program by mutableIntStateOf(ScoreSound.of(defaultSound ?: -1)?.program ?: ScoreSound.Whistle.program); private set
    var track by mutableStateOf<PlayalongTrack?>(null); private set
    var countIn by mutableStateOf(prefs.getBoolean("countIn", false)); private set
    /** The notes sounding now, by the ids the score draws them with: lit up. */
    var playingNotes by mutableStateOf<Set<UInt>>(emptySet()); private set
    /** This tune's play-along recordings, once known. */
    var playalongs by mutableStateOf<List<PlayalongTrack>>(emptyList())
    /** The tune as it stands for you (the reader and the deck's practice panel both change its level). */
    var tune by mutableStateOf<SavedTune?>(null)
    /** Whether it is yours to change: a tune in your library, read from your list or your own tunebook. */
    var editable by mutableStateOf(false)
    /** Where you heard it in your recordings, once known. */
    var heard by mutableStateOf<List<TuneHeard>>(emptyList())

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var abc: String? = null
    private var events: List<ScoreEvent> = emptyList()
    /** The notes mixed, for the sound and speed they were mixed at. */
    private var rendered: Pair<String, FloatArray>? = null
    /** Seconds into the tune (or the recording) where it stopped, to carry on from. */
    private var offset = 0.0
    /** Seconds of count-in before the notes in the stream playing. */
    private var lead = 0.0
    private var stream: Stream? = null
    private var recording: MediaPlayer? = null
    private var recordingReady = false
    private var job: Job? = null

    /** The tempo you'd set a metronome to: the sound's crotchets a minute at this speed, in the meter's beat. */
    val bpm: Int get() = ((track?.bpm ?: 100.0) * speed / 100 / beat.second).roundToInt()

    val soundName: String get() = track?.label ?: "Notes, ${ScoreSound.of(program)?.label ?: "score"}"

    /** The score it plays: its notes in playing order, from the notation engine. */
    fun load(abc: String) {
        if (abc == this.abc) return
        stop()
        this.abc = abc
        events = scoreTimeline(abc)
        rendered = null
        offset = 0.0
        progress = 0f
        playingNotes = emptySet()
    }

    fun toggle() {
        when {
            counting -> stop()
            playing -> pause()
            else -> {
                // One plays at a time: starting another pauses the last, wherever it was left playing.
                started?.takeIf { it !== this }?.pause()
                started = this
                play()
            }
        }
    }

    fun pause() {
        if (!playing && !counting && !loading) return
        offset = position
        stop()
    }

    fun seek(percent: Float) {
        val was = playing
        if (was) stop()
        offset = percent / 100.0 * duration
        progress = percent
        light()
        if (was) play(countingIn = false)
    }

    fun changeSpeed(value: Int) {
        if (value == speed) return
        val ratio = if (duration > 0) position / duration else 0.0
        val was = playing
        if (was) stop()
        speed = value
        if (track == null) offset = ratio * duration
        if (was) play(countingIn = false)
    }

    fun changeSound(program: Int) {
        val switching = track != null
        val ratio = if (!switching && duration > 0) position / duration else 0.0
        val was = playing
        if (was) stop()
        this.program = program
        track = null
        dropRecording()
        offset = ratio * duration
        if (switching) progress = 0f
        if (was) play(countingIn = false)
    }

    fun changeTrack(track: PlayalongTrack) {
        val was = playing
        if (was) stop()
        this.track = track
        dropRecording()
        offset = 0.0
        progress = 0f
        if (was) play(countingIn = false)
    }

    fun changeCountIn(on: Boolean) {
        countIn = on
        prefs.edit().putBoolean("countIn", on).apply()
    }

    // Inside

    /** A bar's beats in the meter, and a beat in crotchets: dotted crotchets in 6/8, 9/8 and 12/8, otherwise the meter's own note. */
    private val beat: Pair<Int, Double>
        get() {
            val parts = (meter ?: "4/4").split("/").mapNotNull { it.trim().toDoubleOrNull() }
            if (parts.size != 2 || parts[0] <= 0 || parts[1] <= 0) return 4 to 1.0
            val compound = parts[1] == 8.0 && parts[0] > 3 && parts[0] % 3 == 0.0
            return if (compound) (parts[0] / 3).toInt() to 1.5 else parts[0].toInt() to 4 / parts[1]
        }

    /** Seconds per whole note: the score plays at 100 crotchets a minute at 100% (Q:1/4=100). */
    private val wholeSeconds: Double get() = 4 * 60 / (100.0 * speed / 100)

    /** The whole sound's length, in seconds. */
    private val duration: Double
        get() = track?.let { it.durationMs / 1000.0 } ?: events.lastOrNull()?.let { (it.start + it.duration) * wholeSeconds } ?: 0.0

    /** Seconds into the sound now. */
    private val position: Double
        get() {
            recording?.let { return if (recordingReady) it.currentPosition / 1000.0 else offset }
            val stream = stream ?: return offset
            return maxOf(0.0, offset + stream.seconds - lead)
        }

    private val renderKey get() = "$program-$speed"

    private fun play(countingIn: Boolean = true) {
        stop()
        error = null
        track?.let { playRecording(it); return }
        loading = rendered?.first != renderKey
        job = scope.launch {
            val notes = try {
                render()
            } catch (e: Exception) {
                loading = false
                error = "Some instrument notes could not be loaded"
                return@launch
            }
            loading = false
            val (perBar, crotchets) = beat
            val clicks = if (countingIn && countIn && offset == 0.0) clicks(perBar, 60 / (100.0 * speed / 100) * crotchets) else FloatArray(0)
            lead = clicks.size / RATE.toDouble()
            val from = (offset * RATE).toInt().coerceIn(0, notes.size)
            stream = Stream(clicks + notes.copyOfRange(from, notes.size))
            playing = true
            counting = clicks.isNotEmpty()
            tick()
        }
    }

    /** The tune's notes mixed into one sound, as abcjs's synth primes its buffer. */
    private suspend fun render(): FloatArray {
        rendered?.takeIf { it.first == renderKey }?.let { return it.second }
        val key = renderKey
        val samples = Samples.load(cache, program, events.flatMap { it.midi }.toSet())
        val mixed = withContext(Dispatchers.Default) { mix(events, samples, wholeSeconds) }
        rendered = key to mixed
        return mixed
    }

    private fun playRecording(track: PlayalongTrack) {
        val player = recording ?: MediaPlayer().also { made ->
            recording = made
            recordingReady = false
            made.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            made.setDataSource(track.url)
            made.setOnPreparedListener { recordingReady = true; if (playing) startRecording(it) }
            made.setOnCompletionListener { finished() }
            made.setOnErrorListener { _, _, _ -> error = "The recording could not be played"; stop(); true }
            made.prepareAsync()
        }
        playing = true
        if (recordingReady) startRecording(player) else loading = true
        tick()
    }

    private fun startRecording(player: MediaPlayer) {
        loading = false
        player.seekTo((offset * 1000).toInt())
        // The speed changes, the pitch doesn't.
        player.playbackParams = PlaybackParams().setSpeed(speed / 100f).setPitch(1f)
        player.start()
    }

    /** Progress and the lit notes, a few dozen times a second while it plays. */
    private fun tick() {
        val ticking = scope.launch {
            while (isActive) {
                stream?.let { counting = it.seconds < lead }
                val at = position
                if (recording == null && at >= duration) { finished(); return@launch }
                val total = duration
                progress = if (total > 0) min(100.0, (at / total * 100).roundToInt().toDouble()).toFloat() else 0f
                light(at)
                delay(33)
            }
        }
        ticker?.cancel()
        ticker = ticking
    }

    private var ticker: Job? = null

    /** Lights the notes sounding at `at` seconds (by default, where it stands). */
    private fun light(at: Double = offset) {
        val whole = track?.let { track -> track.timing?.let { scorePosition(it, at * 1000) }?.let { it / 48 } }
            ?: if (track == null && (playing || counting || offset > 0)) at / wholeSeconds else null
        if (whole == null) {
            if (playingNotes.isNotEmpty()) playingNotes = emptySet()
            return
        }
        val now = events.filter { it.start <= whole + 1e-6 && whole < it.start + it.duration }.map { it.id }.toSet()
        if (now != playingNotes) playingNotes = now
    }

    private fun finished() {
        stop()
        offset = 0.0
        progress = 0f
        playingNotes = emptySet()
    }

    private fun stop() {
        job?.cancel(); job = null
        ticker?.cancel(); ticker = null
        recording?.let { if (recordingReady) { offset = it.currentPosition / 1000.0; if (it.isPlaying) it.pause() } }
        stream?.stop(); stream = null
        playing = false
        counting = false
        loading = false
    }

    private fun dropRecording() {
        recording?.release()
        recording = null
        recordingReady = false
    }

    companion object {
        /** The score last started, anywhere in the app: starting another pauses it. */
        private var started: ScorePlayback? = null

        /** Where in the score a play-along is (in 1/48ths of a whole note), `ms` into it; null in its lead-in and after the tune ends. */
        fun scorePosition(timing: kotlinx.serialization.json.JsonElement, ms: Double): Double? {
            val fields = runCatching { timing.jsonObject }.getOrNull() ?: return null
            val anchors = fields["anchors"]?.let { runCatching { it.jsonArray }.getOrNull() }.orEmpty()
                .mapNotNull { a -> runCatching { a.jsonArray.map { it.jsonPrimitive.doubleOrNull ?: return@mapNotNull null } }.getOrNull() }
                .filter { it.size >= 2 }
            if (anchors.size < 2 || ms < anchors.first()[0] || ms > anchors.last()[0]) return null
            var i = 1
            while (anchors[i][0] < ms) i++
            val from = anchors[i - 1]; val to = anchors[i]
            val span = to[0] - from[0]
            val position = from[1] + if (span > 0) (to[1] - from[1]) * (ms - from[0]) / span else 0.0
            if (position < 0) return null
            val loop = fields["loop"]?.let { runCatching { it.jsonPrimitive.doubleOrNull }.getOrNull() }
            return if (loop != null && loop > 0) position % loop else position
        }
    }
}

private const val RATE = 44_100
/** The device's own volume is the volume control; this leaves headroom for chords. */
private const val VOLUME = 0.75f

/** The tune's notes mixed into one (mono) sound: each sample cut to its note's length with a short release. */
private fun mix(events: List<ScoreEvent>, samples: Map<Int, FloatArray>, wholeSeconds: Double): FloatArray {
    val release = 0.08
    val end = (events.lastOrNull()?.let { it.start + it.duration } ?: 0.0) * wholeSeconds + release + 0.2
    val out = FloatArray(maxOf(1, (end * RATE).toInt()))
    val fade = (release * RATE).toInt()
    for (event in events) {
        if (event.midi.isEmpty()) continue
        val gain = VOLUME / sqrt(event.midi.size.toFloat())
        for (midi in event.midi) {
            val sample = samples[midi] ?: continue
            val start = (event.start * wholeSeconds * RATE).toInt()
            val sounding = (event.duration * wholeSeconds * RATE).toInt()
            val length = minOf(sample.size, sounding + fade, out.size - start)
            for (i in 0 until length) {
                val envelope = if (i < sounding) 1f else (length - i).toFloat() / maxOf(1, length - sounding)
                out[start + i] += sample[i] * gain * envelope
            }
        }
    }
    return out
}

/** A bar of clicks, the first higher, `seconds` apart. */
private fun clicks(beats: Int, seconds: Double): FloatArray {
    val out = FloatArray(((0.05 + beats * seconds) * RATE).toInt())
    for (beat in 0 until beats) {
        val frequency = if (beat == 0) 1760.0 else 1320.0
        val start = ((0.05 + beat * seconds) * RATE).toInt()
        for (i in 0 until (0.06 * RATE).toInt()) {
            if (start + i >= out.size) break
            val t = i.toDouble() / RATE
            out[start + i] = (sin(2 * PI * frequency * t) * 0.5 * exp(-t * 60)).toFloat()
        }
    }
    return out
}

/** One sound streaming out: written from its own thread, stopped (and its track released) at once. */
private class Stream(private val pcm: FloatArray) {
    private val lock = Any()
    private var stopped = false
    private var writing = true
    private val track = AudioTrack.Builder()
        .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
        .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_FLOAT).setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
        .setTransferMode(AudioTrack.MODE_STREAM)
        .setBufferSizeInBytes(maxOf(AudioTrack.getMinBufferSize(RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT), RATE / 5 * 4))
        .build()

    init {
        thread(name = "score-audio") {
            track.play()
            var i = 0
            while (i < pcm.size && !synchronized(lock) { stopped }) {
                val wrote = track.write(pcm, i, min(4096, pcm.size - i), AudioTrack.WRITE_BLOCKING)
                if (wrote <= 0) break
                i += wrote
            }
            synchronized(lock) {
                writing = false
                if (stopped) track.release()
            }
        }
    }

    /** Seconds of it heard so far. */
    val seconds: Double get() = synchronized(lock) { if (stopped) 0.0 else track.playbackHeadPosition.toDouble() / RATE }

    fun stop() = synchronized(lock) {
        if (stopped) return@synchronized
        stopped = true
        track.pause()
        track.flush()
        if (!writing) track.release()
    }
}

/** The instruments' notes: FluidR3 samples (MIT), as the website's player fetches them, kept in the cache after the first time. */
private object Samples {
    private const val BASE = "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/"
    private val names = mapOf(0 to "acoustic_grand_piano", 21 to "accordion", 73 to "flute", 74 to "recorder")
    private val decoded = HashMap<String, FloatArray>()
    private val lock = Mutex()

    /** The notes `notes` (MIDI) on `program`, fetched and decoded as needed. */
    suspend fun load(cache: File, program: Int, notes: Set<Int>): Map<Int, FloatArray> = lock.withLock {
        val instrument = names[program] ?: "recorder"
        withContext(Dispatchers.IO) {
            notes.filter { "$instrument/$it" !in decoded }
                .map { midi -> async { midi to decode(file(cache, instrument, noteName(midi))) } }
                .awaitAll()
        }.forEach { (midi, pcm) -> decoded["$instrument/$midi"] = pcm }
        notes.mapNotNull { midi -> decoded["$instrument/$midi"]?.let { midi to it } }.toMap()
    }

    /** FluidR3's file names: C4, Db4, D4 … (flats). */
    private fun noteName(midi: Int) = listOf("C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B")[midi % 12] + (midi / 12 - 1)

    /** The sample's file, downloaded once. */
    private fun file(cache: File, instrument: String, note: String): File {
        val local = File(cache, "$instrument/$note.mp3")
        if (local.exists()) return local
        local.parentFile?.mkdirs()
        val connection = URL("$BASE$instrument-mp3/$note.mp3").openConnection() as HttpURLConnection
        try {
            if (connection.responseCode != 200) error("sample $note: ${connection.responseCode}")
            val part = File(local.path + ".part")
            connection.inputStream.use { input -> part.outputStream().use { input.copyTo(it) } }
            part.renameTo(local)
        } finally {
            connection.disconnect()
        }
        return local
    }

    /** An MP3 sample as 44.1 kHz mono floats, the mix's format. */
    private fun decode(file: File): FloatArray {
        val extractor = MediaExtractor()
        extractor.setDataSource(file.path)
        val format = extractor.getTrackFormat(0)
        extractor.selectTrack(0)
        val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
        codec.configure(format, null, null, 0)
        codec.start()
        var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        var pcm = ShortArray(1 shl 16)
        var count = 0
        val info = MediaCodec.BufferInfo()
        var input = true
        try {
            while (true) {
                if (input) {
                    val index = codec.dequeueInputBuffer(10_000)
                    if (index >= 0) {
                        val read = extractor.readSampleData(codec.getInputBuffer(index)!!, 0)
                        if (read < 0) {
                            codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            input = false
                        } else {
                            codec.queueInputBuffer(index, 0, read, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }
                val index = codec.dequeueOutputBuffer(info, 10_000)
                if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    rate = codec.outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    channels = codec.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                } else if (index >= 0) {
                    val buffer = codec.getOutputBuffer(index)!!
                    buffer.position(info.offset).limit(info.offset + info.size)
                    val shorts = buffer.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
                    val n = shorts.remaining()
                    if (count + n > pcm.size) pcm = pcm.copyOf(maxOf(pcm.size * 2, count + n))
                    shorts.get(pcm, count, n)
                    count += n
                    codec.releaseOutputBuffer(index, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                }
            }
        } finally {
            codec.stop(); codec.release(); extractor.release()
        }
        // Down to one channel, then to the mix's rate.
        val frames = count / maxOf(1, channels)
        val mono = FloatArray(frames) { f -> (0 until channels).sumOf { pcm[f * channels + it].toInt() } / (32768f * channels) }
        if (rate == RATE) return mono
        val ratio = rate.toDouble() / RATE
        return FloatArray((frames / ratio).toInt()) { i ->
            val at = i * ratio
            val j = at.toInt()
            val t = (at - j).toFloat()
            mono[j] * (1 - t) + mono[min(j + 1, frames - 1)] * t
        }
    }
}

/** The score showing in the music layer, whose player the deck's head becomes. */
object Player {
    var current by mutableStateOf<ScorePlayback?>(null)
}

/** The deck's head as the player: play, the tune and its sound (tap for the sounds), the speed, the mic; where it is below. */
@Composable
fun PlayerHead(playback: ScorePlayback, onListen: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    Column(Modifier.fillMaxWidth().height(72.dp).padding(horizontal = 16.dp)) {
        Row(Modifier.fillMaxWidth().height(54.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(46.dp).background(Palette.brandInk.current(), CircleShape)
                .clickable { haptics.performHapticFeedback(HapticFeedbackType.ContextClick); playback.toggle() }, contentAlignment = Alignment.Center) {
                val on = Palette.onBrandInk.current()
                if (playback.loading || playback.counting) CircularProgressIndicator(Modifier.size(20.dp), color = on, strokeWidth = 2.dp)
                else Icon(painterResource(if (playback.playing) R.drawable.ic_pause else R.drawable.ic_play), if (playback.playing) "Pause" else "Play",
                    Modifier.size(22.dp), tint = on)
            }
            Spacer(Modifier.width(12.dp))
            SoundMenu(playback, Modifier.weight(1f))
            SpeedChip(playback)
            IconButton(onListen) { Icon(painterResource(R.drawable.ic_mic), "Name a tune", tint = micTint(0f).strong) }
        }
        SeekBar(playback.progress, playback::seek, Modifier.fillMaxWidth())
        playback.error?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = Palette.danger.current(), maxLines = 1) }
    }
}

@Composable
private fun SoundMenu(playback: ScorePlayback, modifier: Modifier) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        Column(Modifier.fillMaxWidth().clickable { open = true }.padding(vertical = 4.dp)) {
            Text(displayTitle(playback.title), style = TuneType.trayTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${playback.soundName}, ${playback.bpm} BPM", style = MaterialTheme.typography.bodySmall, color = Palette.text3.current(),
                maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        DropdownMenu(open, { open = false }) {
            Text("Notes", style = MaterialTheme.typography.labelMedium, color = Palette.text3.current(), modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
            ScoreSound.entries.forEach { sound ->
                val chosen = playback.track == null && playback.program == sound.program
                DropdownMenuItem({ Text(sound.label, fontWeight = if (chosen) FontWeight.SemiBold else FontWeight.Normal) }, { playback.changeSound(sound.program); open = false })
            }
            if (playback.playalongs.isNotEmpty()) {
                HorizontalDivider()
                Text("Play-along recordings", style = MaterialTheme.typography.labelMedium, color = Palette.text3.current(), modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
                playback.playalongs.forEach { track ->
                    val chosen = playback.track?.id == track.id
                    DropdownMenuItem({ Text("${leadEmoji(track.label)} ${track.label}${if (track.otherSetting) ", other setting" else ""}",
                        fontWeight = if (chosen) FontWeight.SemiBold else FontWeight.Normal) }, { playback.changeTrack(track); open = false })
                }
            }
            if (playback.track == null) {
                HorizontalDivider()
                DropdownMenuItem({ Text("Count-in") }, { playback.changeCountIn(!playback.countIn) },
                    trailingIcon = { Switch(playback.countIn, { playback.changeCountIn(it) }) })
            }
        }
    }
}

/** 100%, 85% or 75%: tap to slow down for learning, and back. */
@Composable
private fun SpeedChip(playback: ScorePlayback) {
    val next = mapOf(100 to 85, 85 to 75, 75 to 100)
    Surface(shape = RoundedCornerShape(999.dp), color = if (playback.speed == 100) Palette.muted.current() else Palette.brandDotSoft.current(),
        modifier = Modifier.padding(horizontal = 4.dp).clickable { playback.changeSpeed(next[playback.speed] ?: 100) }) {
        Text("${playback.speed}%", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            color = if (playback.speed == 100) MaterialTheme.colorScheme.onSurface else Palette.brandDotText.current())
    }
}

/** Where the score is: tap or drag to move through it. */
@Composable
private fun SeekBar(progress: Float, onSeek: (Float) -> Unit, modifier: Modifier) {
    var scrub by remember { mutableStateOf<Float?>(null) }
    val seek by rememberUpdatedState(onSeek)
    val shown = scrub ?: progress
    BoxWithConstraints(
        modifier.height(16.dp)
            .pointerInput(Unit) { detectTapGestures { seek((it.x / size.width * 100).coerceIn(0f, 100f)) } }
            .pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onDragStart = { scrub = (it.x / size.width * 100).coerceIn(0f, 100f) },
                    onDragEnd = { scrub?.let(seek); scrub = null },
                    onDragCancel = { scrub = null },
                ) { change, _ -> scrub = (change.position.x / size.width * 100).coerceIn(0f, 100f) }
            },
        contentAlignment = Alignment.CenterStart,
    ) {
        Box(Modifier.fillMaxWidth().height(3.dp).background(Palette.accent.current(), CircleShape))
        Box(Modifier.width(maxWidth * (shown / 100f)).height(3.dp).background(Palette.brandDot.current(), CircleShape))
        Box(Modifier.padding(start = (maxWidth - 10.dp) * (shown / 100f)).size(10.dp).background(Palette.brandDot.current(), CircleShape))
    }
}

/** The lead instrument of a play-along, for its menu item. */
private fun leadEmoji(label: String): String = listOf(
    "fiddle|violin" to "🎻", "whistle|flute" to "🪈", "accordion|concertina" to "🪗", "banjo" to "🪕", "piano" to "🎹", "guitar|bouzouki" to "🎸",
).firstOrNull { Regex(it.first, RegexOption.IGNORE_CASE).containsMatchIn(label) }?.second ?: "🎶"

