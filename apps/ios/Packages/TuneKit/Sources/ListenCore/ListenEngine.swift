// The Rust listen engine (crates/listen-ffi) as the app uses it. The generated bindings in
// Generated/listen_ffi.swift come from `just ios-core`; this file keeps call sites tidy.
// ListenDecoder, ListenVerdict and ListenStatus come straight from the bindings.

import Foundation

public enum ListenEngine {
    /// The engine's version, for logs and the about screen.
    public static var version: String { ListenCore.coreVersion() }

    /// Samples in one model window (8 s at 16 kHz).
    public static var windowSamples: Int { Int(ListenCore.windowSamples()) }

    /// The model input's shape: [channels, frames].
    public static var windowShape: [Int] { ListenCore.windowShape().map(Int.init) }

    /// Mono microphone audio at `rate` Hz, resampled to 16 kHz and turned into one model window.
    public static func features(samples: [Float], rate: Int) -> [Float] {
        let audio = rate == 16_000 ? samples : resampleToModelRate(samples: samples, rate: UInt32(rate))
        return windowFeatures(samples: audio)
    }
}
