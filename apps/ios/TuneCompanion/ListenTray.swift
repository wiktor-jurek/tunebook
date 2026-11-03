import DesignSystem
import SwiftUI

/// The deck's head, docked above the tab bar on every screen (the web's `.deck-head`): the mic, what
/// it is doing, and a hint. The mic names a tune; the rest opens the deck (tap, or swipe up), or the
/// answer once a tune is named.
struct ListenTray: View {
    @Environment(ListenModel.self) private var listen

    var body: some View {
        HStack(spacing: 14) {
            FinderDial(size: .mini, action: press)
                .scaleEffect(0.72)
                .frame(width: 36, height: 36)
            Button(action: open) {
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 8) {
                        if listen.isRecording { RecordingDot() }
                        Text(status)
                            .font(showsTune ? .tuneTitle(.headline) : .subheadline.weight(.semibold))
                            .lineLimit(1)
                            .contentTransition(.opacity)
                        if listen.isLive, !listen.isRecording, !listen.quiet, listen.downloading == nil, !listen.starting { HoppingDots() }
                    }
                    if let hint {
                        TimelineView(.periodic(from: .now, by: 1)) { _ in
                            Text(self.hint ?? hint).font(.caption).foregroundStyle(Palette.text3).lineLimit(1).monospacedDigit()
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint(listen.isRecording ? "Opens the live session" : "Opens the session recorder")
            Button("Open", systemImage: "chevron.up", action: open)
                .labelStyle(.iconOnly)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.text3)
        }
        .padding(.horizontal, 14)
        .animation(Motion.standard, value: status)
        // A swipe up opens the deck, as dragging the web's sheet does.
        .gesture(DragGesture(minimumDistance: 12).onEnded { drag in
            if drag.translation.height < -24 || drag.predictedEndTranslation.height < -80 { listen.deckOpen = true }
        })
    }

    /// One button, three jobs (the web's `press`): name a tune, stop listening, or open the live session.
    private func press() {
        if listen.isRecording { listen.deckOpen = true } else if listen.isLive { listen.stop() } else { listen.nameATune() }
    }

    /// A named tune opens its answer; otherwise the deck.
    private func open() {
        if !listen.isLive, listen.leader != nil { listen.answerOpen = true } else { listen.deckOpen = true }
    }

    private var now: String? { listen.tonight.first?.tune.displayTitle }
    private var showsTune: Bool { listen.isRecording && now != nil }

    /// The web's status line, word for word.
    private var status: String {
        if listen.isRecording { return now ?? "Listening for a tune" }
        if let progress = listen.downloading { return "Loading the tune model, \(Int(progress * 100))%" }
        if listen.starting, listen.isLive { return "Asking for the microphone" }
        if let problem = listen.problem { return problem }
        if listen.isLive { return listen.quiet ? "Too quiet, move closer" : "Listening" }
        return listen.leader != nil ? "Tap to name another tune" : "What's playing?"
    }

    private var hint: String? {
        if listen.isRecording, let start = listen.sessionStartedAt {
            let count = listen.tonight.count
            return "Live \(clock(Date.now.timeIntervalSince(start))), \(count) \(count == 1 ? "tune" : "tunes")"
        }
        if listen.isLive { return nil }
        return "Expand to record a full session"
    }
}
