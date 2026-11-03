// The finder's microphone, as on the web: an orange disc whose soft halo breathes with the input,
// ripples while it listens, and an arc that fills as the finder grows sure (green once named).
// Small in the tray, it names a tune; large in the deck, it is the record button.

import DesignSystem
import SwiftUI

struct FinderDial: View {
    enum Size {
        case mini, record
        var diameter: CGFloat { self == .mini ? 50 : 88 }
        var halo: Double { self == .mini ? 0.4 : 0.54 }
        var ring: CGFloat { self == .mini ? 5 : 9 }
    }

    @Environment(ListenModel.self) private var listen
    let size: Size
    let action: () -> Void

    var body: some View {
        ZStack {
            // The halo grows with the input level.
            Circle()
                .fill(Palette.brandDotSoft)
                .scaleEffect(1 + listen.level * size.halo)
                .animation(.linear(duration: 0.12), value: listen.level)
            if listening { Ripples(diameter: size.diameter) }
            arc
            Button(action: action) {
                ZStack {
                    Circle().fill(Palette.brandDot)
                    glyph
                }
                .frame(width: size.diameter, height: size.diameter)
                .contentShape(.circle)
            }
            .buttonStyle(DialPress())
            .disabled(listen.starting || listen.downloading != nil)
            .accessibilityLabel(label)
        }
        .frame(width: size.diameter, height: size.diameter)
        .sensoryFeedback(.impact(weight: .medium), trigger: listen.isLive)
    }

    private var listening: Bool { listen.isLive && !listen.starting && listen.downloading == nil }

    /// Fills as the finder grows sure; full and green once named. While downloading, it shows how much has arrived.
    private var arc: some View {
        let downloading = listen.downloading
        let value = downloading ?? (listen.leader != nil && (listen.leaderSure || !listen.isLive) ? (listen.leaderSure ? 1 : listen.certainty) : listening ? listen.certainty : 0)
        let named = downloading == nil && listen.leaderSure && listen.leader != nil
        return ZStack {
            Circle().stroke(Palette.brandDot.opacity(listening ? 0.25 : 0), lineWidth: 2.5)
            Circle()
                .trim(from: 0, to: value)
                .stroke(downloading != nil || named ? Palette.brandInk : Palette.brandDot, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .opacity(value > 0 ? 1 : 0)
                .animation(.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.5), value: value)
        }
        .padding(-size.ring)
        .allowsHitTesting(false)
    }

    @ViewBuilder private var glyph: some View {
        switch size {
        case .mini:
            Image(systemName: listen.denied ? "mic.slash.fill" : listen.isLive ? "stop.fill" : "mic.fill")
                .font(.system(size: 19, weight: .semibold))
                .foregroundStyle(Palette.onBrandDot)
                .contentTransition(.symbolEffect(.replace))
        case .record:
            // The record dot squares off into Stop while a session records.
            RoundedRectangle(cornerRadius: listen.isRecording ? 5 : 15)
                .fill(Palette.onBrandDot)
                .frame(width: listen.isRecording ? 26 : 30, height: listen.isRecording ? 26 : 30)
                .animation(.spring(response: 0.35, dampingFraction: 0.7), value: listen.isRecording)
        }
    }

    private var label: String {
        switch size {
        case .mini: listen.isRecording ? "Live session: open it" : listen.isLive ? "Stop listening" : "Name the tune that's playing"
        case .record: listen.isRecording ? "Stop recording" : "Start recording the session"
        }
    }
}

/// Two rings spreading out from the dial while it listens, half a beat apart.
private struct Ripples: View {
    let diameter: CGFloat
    @State private var spread = false

    var body: some View {
        ZStack {
            ring(delay: 0)
            ring(delay: 1.2)
        }
        .onAppear { spread = true }
        .allowsHitTesting(false)
    }

    private func ring(delay: Double) -> some View {
        Circle()
            .stroke(Palette.brandDot, lineWidth: 2)
            .scaleEffect(spread ? 1.6 : 1)
            .opacity(spread ? 0 : 0.55)
            .animation(.timingCurve(0.15, 0.6, 0.3, 1, duration: 2.4).repeatForever(autoreverses: false).delay(delay), value: spread)
    }
}

/// Pressed, the dial gives a little, as the web's :active scale.
private struct DialPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(Motion.standard, value: configuration.isPressed)
    }
}

/// The web's two hopping dots after "Listening".
struct HoppingDots: View {
    @State private var hop = false

    var body: some View {
        HStack(spacing: 4) {
            dot(delay: 0)
            dot(delay: 0.18)
        }
        .onAppear { hop = true }
        .accessibilityHidden(true)
    }

    private func dot(delay: Double) -> some View {
        Circle()
            .fill(Palette.brandDot)
            .frame(width: 6, height: 6)
            .offset(y: hop ? -5 : 0)
            .opacity(hop ? 1 : 0.55)
            .animation(.easeInOut(duration: 0.5).repeatForever().delay(delay), value: hop)
    }
}

/// The blinking red-orange dot of a live recording.
struct RecordingDot: View {
    @State private var dim = false

    var body: some View {
        Circle()
            .fill(Palette.brandDot)
            .frame(width: 9, height: 9)
            .opacity(dim ? 0.25 : 1)
            .animation(.easeInOut(duration: 0.8).repeatForever(), value: dim)
            .onAppear { dim = true }
            .accessibilityHidden(true)
    }
}

/// m:ss or h:mm:ss, as the web's clock.
func clock(_ interval: TimeInterval) -> String {
    let s = max(0, Int(interval)), h = s / 3600, m = s / 60 % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, s % 60) : String(format: "%d:%02d", m, s % 60)
}
