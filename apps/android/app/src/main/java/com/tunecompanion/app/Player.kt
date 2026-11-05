// Playing a score, as the iPhone's ScorePlayback and PlayerIsland: the website's player
// (score-player.js, beside abcjs in the score's WebView) plays the notes through an instrument, or a
// play-along recording that follows the score, lighting each note as it sounds. While a score is open
// in the music layer the deck's head becomes its player: play, where it is, the sound and the speed,
// with the mic still a tap (or a pull) away.
package com.tunecompanion.app

import android.content.Context
import android.webkit.WebView
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
import org.json.JSONObject
import kotlin.math.roundToInt

/** The sounds a score can be played with (the website's SOUND_OPTIONS). */
enum class ScoreSound(val program: Int, val label: String) {
    Whistle(74, "Whistle-like, recorder"), Accordion(21, "Accordion"), Flute(73, "Flute"), Piano(0, "Piano");

    companion object { fun of(program: Int) = entries.firstOrNull { it.program == program } }
}

/** One score's player. Hand it to [AbcView]; the deck's player head calls it, and it holds what the page reports. */
@Stable
class ScorePlayback(val title: String, val tuneId: Int, private val meter: String?, defaultSound: Int?, context: Context) {
    private val prefs = context.getSharedPreferences("ui", Context.MODE_PRIVATE)

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
    /** This tune's play-along recordings, once known. */
    var playalongs by mutableStateOf<List<PlayalongTrack>>(emptyList())
    /** The tune as it stands for you (the reader and the deck's practice panel both change its level). */
    var tune by mutableStateOf<SavedTune?>(null)
    /** Whether it is yours to change: a tune in your library, read from your list or your own tunebook. */
    var editable by mutableStateOf(false)
    /** Where you heard it in your recordings, once known. */
    var heard by mutableStateOf<List<TuneHeard>>(emptyList())

    internal var webView: WebView? = null

    /** The tempo you'd set a metronome to: the sound's crotchets a minute at this speed, in the meter's beat. */
    val bpm: Int
        get() {
            val parts = (meter ?: "4/4").split("/").mapNotNull { it.trim().toDoubleOrNull() }
            val crotchets = when {
                parts.size == 2 && parts[1] == 8.0 && parts[0] > 3 && parts[0] % 3 == 0.0 -> 1.5
                parts.size == 2 && parts[1] > 0 -> 4 / parts[1]
                else -> 1.0
            }
            return ((track?.bpm ?: 100.0) * speed / 100 / crotchets).roundToInt()
        }

    val soundName: String get() = track?.label ?: "Notes, ${ScoreSound.of(program)?.label ?: "score"}"

    fun toggle() = send("toggle()")
    fun pause() = send("pause()")

    fun seek(percent: Float) {
        progress = percent
        send("seek($percent)")
    }

    fun changeSpeed(value: Int) {
        speed = value
        send("setSpeed($value)")
    }

    fun changeSound(program: Int) {
        this.program = program
        track = null
        send("setSound($program, null)")
    }

    fun changeTrack(track: PlayalongTrack) {
        this.track = track
        send("setSound($program, ${Services.api.json.encodeToString(PlayalongTrack.serializer(), track)})")
    }

    fun changeCountIn(on: Boolean) {
        countIn = on
        prefs.edit().putBoolean("countIn", on).apply()
        send("setCountIn($on)")
    }

    /** The page's state, whenever it changes. */
    internal fun receive(json: String) {
        val state = runCatching { JSONObject(json) }.getOrNull() ?: return
        playing = state.optBoolean("playing")
        loading = state.optBoolean("loading")
        counting = state.optBoolean("counting")
        progress = state.optDouble("progress", 0.0).toFloat()
        error = state.optString("error").takeIf { it.isNotEmpty() && it != "null" }
    }

    /** Settings the page needs again after it (re)draws a score. */
    internal fun configure() {
        send("reset(${meter?.let(JSONObject::quote) ?: "null"})")
        send("setSpeed($speed)")
        send("setCountIn($countIn)")
        track?.let(::changeTrack) ?: send("setSound($program, null)")
    }

    private fun send(call: String) {
        webView?.evaluateJavascript("window.scorePlayer && window.scorePlayer.$call", null)
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

