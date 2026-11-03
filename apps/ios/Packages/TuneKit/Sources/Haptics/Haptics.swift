// The listen experience in your hand: soft ticks while the engine narrows down, a rounded thud
// when a tune locks on, a double tap when a set moves to its next tune, and a metronome you can
// feel. Core Haptics where the phone has a Taptic Engine, UIKit feedback otherwise.

import CoreHaptics
import UIKit

@MainActor
public final class Haptics {
    public static let shared = Haptics()

    private var engine: CHHapticEngine?
    private let supported = CHHapticEngine.capabilitiesForHardware().supportsHaptics

    private init() {
        guard supported else { return }
        engine = try? CHHapticEngine()
        engine?.isAutoShutdownEnabled = true
        // The engine stops when the app is backgrounded or audio is interrupted; restart on the next play.
        engine?.resetHandler = { [weak self] in Task { @MainActor in try? self?.engine?.start() } }
    }

    /// Prepare before a moment that needs to land on time (listening starts, a count-in).
    public func prepare() {
        try? engine?.start()
    }

    /// A quiet tick while the engine is listening; firmer as it grows surer (`confidence` 0 to 1).
    public func confidenceTick(_ confidence: Double) {
        let c = Float(min(max(confidence, 0), 1))
        play([transient(at: 0, intensity: 0.25 + 0.45 * c, sharpness: 0.35 + 0.3 * c)],
             fallback: { UIImpactFeedbackGenerator(style: .soft).impactOccurred(intensity: 0.4 + 0.5 * CGFloat(c)) })
    }

    /// The tune is named: a firm tap that rounds off into a short swell.
    public func lockOn() {
        play([
            transient(at: 0, intensity: 1.0, sharpness: 0.55),
            CHHapticEvent(eventType: .hapticContinuous, parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: 0.55),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.15),
            ], relativeTime: 0.02, duration: 0.18),
        ], curves: [
            CHHapticParameterCurve(parameterID: .hapticIntensityControl, controlPoints: [
                .init(relativeTime: 0.02, value: 1.0), .init(relativeTime: 0.2, value: 0.0),
            ], relativeTime: 0),
        ], fallback: { UINotificationFeedbackGenerator().notificationOccurred(.success) })
    }

    /// A set moved on to its next tune: two light taps.
    public func setChange() {
        play([transient(at: 0, intensity: 0.6, sharpness: 0.7), transient(at: 0.12, intensity: 0.8, sharpness: 0.7)],
             fallback: { UIImpactFeedbackGenerator(style: .rigid).impactOccurred() })
    }

    /// One metronome beat: accented on the downbeat, so you can feel the bar while playing.
    public func beat(downbeat: Bool) {
        play([transient(at: 0, intensity: downbeat ? 1.0 : 0.45, sharpness: downbeat ? 0.8 : 0.4)],
             fallback: { UIImpactFeedbackGenerator(style: downbeat ? .heavy : .light).impactOccurred() })
    }

    private func transient(at time: TimeInterval, intensity: Float, sharpness: Float) -> CHHapticEvent {
        CHHapticEvent(eventType: .hapticTransient, parameters: [
            CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
            CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness),
        ], relativeTime: time)
    }

    private func play(_ events: [CHHapticEvent], curves: [CHHapticParameterCurve] = [], fallback: () -> Void) {
        guard supported, let engine else { return fallback() }
        do {
            try engine.start()
            let pattern = try CHHapticPattern(events: events, parameterCurves: curves)
            try engine.makePlayer(with: pattern).start(atTime: CHHapticTimeImmediate)
        } catch {
            fallback()
        }
    }
}
