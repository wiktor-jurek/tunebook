// A live session's waveform, after the Pixel's Recorder: mirrored bars scroll in from the right, quiet shows as a dotted
// line, and each tune gets its own colour, with its name called out above the bars. Bars wait grey while the finder is
// unsure, and take the next tune's colour when it is named.
package com.tunecompanion.app

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tunecompanion.app.designsystem.ColorPair
import com.tunecompanion.app.designsystem.Motion
import com.tunecompanion.app.designsystem.Palette
import com.tunecompanion.app.designsystem.current
import kotlin.math.sqrt

/** The session's warm colours, one per tune in turn: a set's tunes stand apart from each other. */
private val Amber = ColorPair(Color(0xFFB7791F), Color(0xFFE3B341))

@Composable
fun sessionPalette() = listOf(Palette.danger.current(), Palette.brandDot.current(), Amber.current())

/** Each tune's colour tonight, by when it was first named; grey for none (not yet named). */
@Composable
fun tuneColours(tonight: List<Heard>): (Int?) -> Color {
    val palette = sessionPalette()
    val waiting = Palette.text4.current()
    val order = remember(tonight) { tonight.reversed().map { it.tune.tuneId }.distinct() }
    return { id -> order.indexOf(id).let { if (id == null || it < 0) waiting else palette[it % palette.size] } }
}

/** The waveform card. Recording, it sits beside the Stop button, shorter, with the session's [clock] in its corner. */
@Composable
fun SessionWave(listen: ListenState, modifier: Modifier = Modifier, barsHeight: Dp = 120.dp, clock: String? = null) {
    val bars by ListenController.wave.collectAsStateWithLifecycle()
    val shown = if (listen.recording) bars else emptyList()
    val tonight = listen.tonight
    val colour = tuneColours(tonight)
    val waiting = Palette.text4.current()

    // Scrolls smoothly between bars rather than stepping a bar at a time.
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(listen.recording) { while (listen.recording) withFrameMillis { now = System.currentTimeMillis() } }

    // The callout names what the newest bars are: the tune playing, or that it is still listening.
    val owner = shown.lastOrNull()?.tuneId
    val callout = when {
        !listen.recording -> null
        owner != null -> tonight.firstOrNull { it.tune.tuneId == owner }?.tune?.displayTitle?.let { owner to it }
        else -> null to "Listening for a tune"
    }
    val compact = clock != null
    Column(modifier.fillMaxWidth().clip(RoundedCornerShape(if (compact) 20.dp else 24.dp)).background(MaterialTheme.colorScheme.surface.copy(alpha = 0.55f))
        .padding(vertical = if (compact) 10.dp else 18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Row(Modifier.height(24.dp).then(if (compact) Modifier.fillMaxWidth().padding(end = 14.dp) else Modifier), verticalAlignment = Alignment.CenterVertically) {
        Box(if (compact) Modifier.weight(1f) else Modifier, contentAlignment = if (compact) Alignment.CenterStart else Alignment.Center) {
            AnimatedContent(callout, transitionSpec = {
                (fadeIn() + slideInVertically { it / 2 }) togetherWith (fadeOut() + slideOutVertically { -it / 2 })
            }, label = "callout") { said ->
                if (said != null) Text((if (said.first != null) "♪ " else "") + said.second, color = colour(said.first),
                    style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(horizontal = if (compact) 14.dp else 24.dp))
            }
        }
        if (clock != null) Text(clock, style = MaterialTheme.typography.titleMedium.copy(fontFeatureSettings = "tnum"), color = MaterialTheme.colorScheme.onSurface)
        }
        Canvas(Modifier.fillMaxWidth().height(barsHeight).padding(top = 8.dp)) {
            val pitch = 9.dp.toPx(); val width = 4.dp.toPx(); val dot = 1.6.dp.toPx()
            val middle = size.height / 2
            val last = shown.lastOrNull()
            val shift = if (last == null) 0f else pitch * ((now - last.at).toFloat() / ListenController.BAR_MS).coerceIn(0f, 1f)
            val right = size.width - pitch / 2
            fun x(fromEnd: Int) = right - fromEnd * pitch - shift
            // Before the first bar, and in the quiet, a dotted line.
            var gap = x(shown.size)
            while (gap > -pitch) { drawCircle(waiting, dot, Offset(gap, middle)); gap -= pitch }
            for (k in 0 until shown.size) {
                val bar = shown[shown.size - 1 - k]
                val at = x(k)
                if (at < -width) break
                val tint = colour(bar.tuneId)
                if (bar.level < 0.06f) { drawCircle(tint.copy(alpha = 0.7f), dot, Offset(at, middle)); continue }
                // Each bar grows out of the line as it arrives, as the Recorder's do.
                val grown = Motion.ease.transform(((now - bar.at).toFloat() / GROW_MS).coerceIn(0f, 1f))
                val half = maxOf(width / 2, (0.12f + 0.88f * sqrt(bar.level)) * size.height / 2 * grown)
                drawLine(tint, Offset(at, middle - half + width / 2), Offset(at, middle + half - width / 2), width, StrokeCap.Round)
            }
        }
    }
}

private const val GROW_MS = 420f
