// The listen experience in your hand: soft ticks while the engine narrows down, a rounded thud when
// a tune locks on, a double tap when a set moves on, and a metronome you can feel. Rich haptic
// primitives where the vibrator has them (Pixels, Samsung flagships), predefined effects otherwise.
package com.tunecompanion.app.designsystem

import android.content.Context
import android.os.VibrationEffect
import android.os.VibrationEffect.Composition
import android.os.VibratorManager

class Haptics(context: Context) {
    private val vibrator = context.getSystemService(VibratorManager::class.java).defaultVibrator

    private fun supports(vararg primitives: Int) = vibrator.hasVibrator() && vibrator.areAllPrimitivesSupported(*primitives)

    private fun play(primitives: Composition.() -> Unit, needs: IntArray, fallback: Int) {
        if (!vibrator.hasVibrator()) return
        val effect = if (supports(*needs)) VibrationEffect.startComposition().apply(primitives).compose()
        else VibrationEffect.createPredefined(fallback)
        vibrator.vibrate(effect)
    }

    /** A quiet tick while listening; firmer as it grows surer ([confidence] 0 to 1). */
    fun confidenceTick(confidence: Float) = play(
        { addPrimitive(Composition.PRIMITIVE_LOW_TICK, 0.3f + 0.6f * confidence.coerceIn(0f, 1f)) },
        intArrayOf(Composition.PRIMITIVE_LOW_TICK), VibrationEffect.EFFECT_TICK,
    )

    /** The tune is named: a firm thud that rounds off. */
    fun lockOn() = play(
        {
            addPrimitive(Composition.PRIMITIVE_THUD, 1f)
            addPrimitive(Composition.PRIMITIVE_TICK, 0.4f, 60)
        },
        intArrayOf(Composition.PRIMITIVE_THUD, Composition.PRIMITIVE_TICK), VibrationEffect.EFFECT_HEAVY_CLICK,
    )

    /** A set moved on to its next tune: two light taps. */
    fun setChange() = play(
        {
            addPrimitive(Composition.PRIMITIVE_CLICK, 0.6f)
            addPrimitive(Composition.PRIMITIVE_CLICK, 0.8f, 120)
        },
        intArrayOf(Composition.PRIMITIVE_CLICK), VibrationEffect.EFFECT_DOUBLE_CLICK,
    )

    /** One metronome beat, accented on the downbeat. */
    fun beat(downbeat: Boolean) = play(
        { addPrimitive(if (downbeat) Composition.PRIMITIVE_CLICK else Composition.PRIMITIVE_LOW_TICK, if (downbeat) 1f else 0.5f) },
        intArrayOf(Composition.PRIMITIVE_CLICK, Composition.PRIMITIVE_LOW_TICK),
        if (downbeat) VibrationEffect.EFFECT_CLICK else VibrationEffect.EFFECT_TICK,
    )
}
