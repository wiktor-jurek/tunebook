// The microphone, as the web's finder dial (components/listen-tray.tsx and the .finder-* styles in globals.css):
// a disc whose soft halo breathes with the input, sonar ripples while it listens, an arc of how sure the finder
// is, a bloom as listening starts and a tick when a tune is named. Its glyph changes shape: the capsule swells into
// the record dot as the deck opens, and squares off into Stop while it listens or records.
//
// One colour language for the mic everywhere: green names a tune, red records a session.
package com.tunecompanion.app

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tunecompanion.app.designsystem.Motion
import com.tunecompanion.app.designsystem.Palette
import com.tunecompanion.app.designsystem.current

/** The mic's colours: [strong] for the disc, ripples, arc and live labels; [soft] for its halo and the deck behind it. */
@Immutable
class MicTint(val strong: Color, val soft: Color)

/** Green while naming a tune, red for a session; [session] runs between them, 0 to 1, as the deck rises to full. */
@Composable
fun micTint(session: Float): MicTint {
    val s = session.coerceIn(0f, 1f)
    return MicTint(lerp(Palette.success.current(), Palette.danger.current(), s), lerp(Palette.successBg.current(), Palette.dangerBg.current(), s))
}

private val RippleEase = CubicBezierEasing(0.15f, 0.6f, 0.3f, 1f)

/**
 * The mic. [grow] is how far it has become the session's record button (0 in the deck's head, 1 at full): it tints
 * it red and turns the capsule into the record dot.
 */
@Composable
fun Dial(listen: ListenState, size: Dp, modifier: Modifier = Modifier, grow: Float = 0f, onClick: () -> Unit) {
    val level by ListenController.level.collectAsStateWithLifecycle()
    val listening = listen.live && !listen.starting && listen.downloading == null
    val tint = micTint(if (listen.recording) 1f else grow)
    val ink = Palette.brandInk.current()
    val onDot = Palette.onBrandDot.current()
    val halo by animateFloatAsState(1f + level * (0.4f + 0.14f * grow), tween(120), label = "halo")
    val arc by animateFloatAsState(
        listen.downloading ?: when { listen.leader != null && listen.leaderSure -> 1f; listening -> listen.confidence; else -> 0f },
        tween(500, easing = Motion.ease), label = "arc")
    // Stop shows as a square: always while recording, and while naming a tune with the deck folded.
    val recordingShape by animateFloatAsState(if (listen.recording) 1f else 0f, spring(dampingRatio = 0.6f, stiffness = 300f), label = "recording")
    val listeningShape by animateFloatAsState(if (listen.live && !listen.recording) 1f else 0f, spring(dampingRatio = 0.6f, stiffness = 300f), label = "listening")
    val square = maxOf(recordingShape, listeningShape * (1 - grow)).coerceIn(0f, 1f)

    val ripple = rememberInfiniteTransition(label = "ripple")
    val spread by ripple.animateFloat(0f, 1f, infiniteRepeatable(tween(2400, easing = LinearEasing), RepeatMode.Restart), label = "spread")
    // Breathes while it asks for the microphone; blooms the moment it starts to hear.
    val breathe by ripple.animateFloat(1f, 0.94f, infiniteRepeatable(tween(1200, easing = Motion.ease), RepeatMode.Reverse), label = "breathe")
    val bloom = remember { Animatable(1f) }
    LaunchedEffect(listening) {
        if (listening) bloom.animateTo(1f, keyframes { durationMillis = 550; 0.92f at 0 using Motion.ease; 1.06f at 300 using Motion.ease })
    }
    // A tune named: a tick pops in over the disc and fades.
    val tick = remember { Animatable(1f) }
    val matched = listen.leader?.tuneId?.takeIf { listen.leaderSure }
    val initial = remember { matched }
    LaunchedEffect(matched) {
        if (matched == null || matched == initial) return@LaunchedEffect
        tick.snapTo(0f); tick.animateTo(1f, tween(1600, easing = LinearEasing))
    }

    val press = remember { MutableInteractionSource() }
    val pressed by press.collectIsPressedAsState()
    val haptics = LocalHapticFeedback.current
    Canvas(modifier.size(size).clickable(press, indication = null) { haptics.performHapticFeedback(HapticFeedbackType.Confirm); onClick() }) {
        val r = this.size.minDimension / 2
        drawCircle(tint.soft, r * halo)
        if (listening) for (phase in listOf(spread, (spread + 0.5f) % 1f)) {
            val e = RippleEase.transform(phase)
            drawCircle(tint.strong.copy(alpha = 0.55f * (1 - e)), r * (1 + 0.6f * e), style = Stroke(2.dp.toPx()))
        }
        val ring = r + 5.dp.toPx()
        val arcBox = Rect(center, ring)
        if (listening) drawCircle(tint.strong.copy(alpha = 0.25f), ring, style = Stroke(2.5.dp.toPx()))
        if (arc > 0f) drawArc(if (listen.downloading != null) ink else tint.strong, -90f, 360f * arc, false, arcBox.topLeft, arcBox.size,
            style = Stroke(3.dp.toPx(), cap = StrokeCap.Round))
        val disc = (if (listen.starting) breathe else 1f) * bloom.value * (if (pressed) 0.96f else 1f)
        scale(disc) {
            drawCircle(tint.strong, r)
            micGlyph(onDot, side = r * 0.9f, dot = grow, square = square)
            if (tick.value < 1f) tickMark(tick.value, r, tint.strong, onDot)
        }
    }
}

/**
 * The web's MicShape: Lucide's microphone in its 24-unit box. As [dot] rises the stand undraws and the capsule swells and
 * fills into the record dot; [square] turns either into the Stop square.
 */
private fun DrawScope.micGlyph(color: Color, side: Float, dot: Float, square: Float) {
    val u = side / 24f
    val round = maxOf(dot, square).coerceIn(0f, 1f)
    fun between(capsule: Float, disc: Float, box: Float) = mix(mix(capsule, disc, round), box, square)
    val w = between(6f, 16f, 12f); val h = between(13f, 16f, 12f); val corner = between(3f, 8f, 2.5f); val y = between(2f, 4f, 6f)
    translate(center.x - side / 2, center.y - side / 2) {
        val stroke = Stroke(2 * u, cap = StrokeCap.Round, join = StrokeJoin.Round)
        val topLeft = Offset((12 - w / 2) * u, y * u)
        drawRoundRect(color.copy(alpha = color.alpha * round), topLeft, Size(w * u, h * u), CornerRadius(corner * u))
        drawRoundRect(color, topLeft, Size(w * u, h * u), CornerRadius(corner * u), style = stroke)
        val stand = 1 - round
        if (stand <= 0.01f) return@translate
        // "M19 10v2a7 7 0 0 1-14 0v-2" and "M12 19v3", drawn only as far as [stand] reaches.
        val cradle = Path().apply {
            moveTo(19 * u, 10 * u); lineTo(19 * u, 12 * u)
            arcTo(Rect(Offset(12 * u, 12 * u), 7 * u), 0f, 180f, false)
            lineTo(5 * u, 10 * u)
        }
        val foot = Path().apply { moveTo(12 * u, 19 * u); lineTo(12 * u, 22 * u) }
        for (path in listOf(cradle, foot)) {
            val measure = PathMeasure().apply { setPath(path, false) }
            val part = Path().also { measure.getSegment(0f, measure.length * stand, it, true) }
            drawPath(part, color.copy(alpha = color.alpha * stand), style = stroke)
        }
    }
}

/** The web's finder-tick: a disc with a tick pops in (to 1.08, then 1), holds, and fades; [t] runs 0 to 1. */
private fun DrawScope.tickMark(t: Float, r: Float, disc: Color, mark: Color) {
    val grow = when { t < 0.18f -> mix(0.6f, 1.08f, t / 0.18f); t < 0.3f -> mix(1.08f, 1f, (t - 0.18f) / 0.12f); else -> 1f }
    val alpha = when { t < 0.18f -> t / 0.18f; t < 0.75f -> 1f; else -> 1 - (t - 0.75f) / 0.25f }
    scale(grow) {
        drawCircle(disc.copy(alpha = alpha), r)
        val s = r * 0.9f / 24f
        val path = Path().apply {
            moveTo(center.x + (20 - 12) * s, center.y + (6 - 12) * s)
            lineTo(center.x + (9 - 12) * s, center.y + (17 - 12) * s)
            lineTo(center.x + (4 - 12) * s, center.y + (12 - 12) * s)
        }
        drawPath(path, mark.copy(alpha = alpha), style = Stroke(2.4f * s, cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

private fun mix(a: Float, b: Float, t: Float) = a + (b - a) * t
