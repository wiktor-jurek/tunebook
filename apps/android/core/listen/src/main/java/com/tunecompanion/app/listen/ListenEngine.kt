// The Rust listen engine (crates/listen-ffi) as the app uses it. The generated bindings in
// uniffi/listen_ffi come from `just android-core`; this keeps call sites tidy.
package com.tunecompanion.app.listen

import uniffi.listen_ffi.ListenDecoder
import uniffi.listen_ffi.ListenVerdict
import uniffi.listen_ffi.coreVersion
import uniffi.listen_ffi.resampleToModelRate
import uniffi.listen_ffi.windowFeatures
import uniffi.listen_ffi.windowSamples
import uniffi.listen_ffi.windowShape

object ListenEngine {
    /** The engine's version, for logs and the about screen. */
    val version: String get() = coreVersion()

    /** Samples in one model window (8 s at 16 kHz). */
    val windowSamples: Int get() = windowSamples().toInt()

    /** The model input's shape: [channels, frames]. */
    val windowShape: List<Int> get() = windowShape().map { it.toInt() }

    /** Mono microphone audio at [rate] Hz, resampled to 16 kHz and turned into one model window. */
    fun features(samples: FloatArray, rate: Int): List<Float> {
        val audio = if (rate == 16_000) samples.asList() else resampleToModelRate(samples.asList(), rate.toUInt())
        return windowFeatures(audio)
    }

    /** A decoder for one listen; [tunebooks] is popularity.json, or empty for no prior. */
    fun decoder(tunebooks: List<Int> = emptyList()): ListenDecoder = ListenDecoder(tunebooks.map { it.toUInt() })
}

typealias Verdict = ListenVerdict
