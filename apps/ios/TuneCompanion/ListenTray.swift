import DesignSystem
import SwiftUI

/// The deck's head, docked above the tab bar on every screen (the web's `.deck-head`): the mic, what
/// it is doing, and a hint. The mic names a tune; the rest opens the deck (tap, or swipe up), or the
/// answer once a tune is named.
struct ListenTray: View {
    @Environment(ListenModel.self) private var listen

    var body: some View {
        HStack(spacing: 14) {
            FinderDial(size: .mini, action: listen.pressMic)
                .scaleEffect(0.72)
                .frame(width: 36, height: 36)
            Button(action: listen.openTray) {
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 8) {
                        if listen.isRecording { RecordingDot() }
                        Text(listen.statusLine)
                            .font(listen.showsTuneInStatus ? .tuneTitle(.headline) : .subheadline.weight(.semibold))
                            .lineLimit(1)
                            .contentTransition(.opacity)
                        if listen.isLive, !listen.isRecording, !listen.quiet, listen.downloading == nil, !listen.starting { HoppingDots() }
                    }
                    if listen.hintLine(at: .now) != nil {
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            Text(listen.hintLine(at: context.date) ?? "").font(.caption).foregroundStyle(Palette.text3).lineLimit(1).monospacedDigit()
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint(listen.isRecording ? "Opens the live session" : "Opens the session recorder")
            Button("Open", systemImage: "chevron.up", action: listen.openTray)
                .labelStyle(.iconOnly)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.text3)
        }
        .padding(.horizontal, 14)
        .animation(Motion.standard, value: listen.statusLine)
        // A swipe up opens the deck, as dragging the web's sheet does.
        .gesture(DragGesture(minimumDistance: 12).onEnded { drag in
            if drag.translation.height < -24 || drag.predictedEndTranslation.height < -80 { listen.deckOpen = true }
        })
    }
}

extension ListenModel {
    /// One button, three jobs (the web's `press`): name a tune, stop listening, or open the live session.
    func pressMic() {
        if isRecording { deckOpen = true } else if isLive { stop() } else { nameATune() }
    }

    /// A named tune opens its answer; otherwise the deck.
    func openTray() {
        if !isLive, leader != nil { answerOpen = true } else { deckOpen = true }
    }

    private var nowPlaying: String? { tonight.first?.tune.displayTitle }
    var showsTuneInStatus: Bool { isRecording && nowPlaying != nil }

    /// The web's status line, word for word.
    var statusLine: String {
        if isRecording { return nowPlaying ?? "Listening for a tune" }
        if let progress = downloading { return "Loading the tune model, \(Int(progress * 100))%" }
        if starting, isLive { return "Asking for the microphone" }
        if let problem { return problem }
        if isLive { return quiet ? "Too quiet, move closer" : "Listening" }
        return leader != nil ? "Tap to name another tune" : "What's playing?"
    }

    func hintLine(at date: Date) -> String? {
        if isRecording, let start = sessionStartedAt {
            let count = tonight.count
            return "Live \(clock(date.timeIntervalSince(start))), \(count) \(count == 1 ? "tune" : "tunes")"
        }
        if isLive { return nil }
        return "Expand to record a full session"
    }
}

/// With the bars standing up the side (iPhone Duo), the mic joins them, over the tab bar: one button for the docked deck
/// (`ListenDeck`), as the tray's mic is on a phone. The screen keeps its whole height for the list and the music.
struct ListenBarItems: ViewModifier {
    @Environment(ListenModel.self) private var listen

    func body(content: Content) -> some View {
        BarEdgeReader { edge in
            content.toolbar {
                if edge != nil {
                    // A round button of the column's own size: anything bigger, or text, the column pushes out over the screen.
                    ToolbarItem(placement: .bottomBar) {
                        Button(action: listen.pressDockedMic) {
                            Image(systemName: listen.isRecording ? "waveform" : listen.isLive ? "stop.fill" : "mic.fill")
                                .symbolEffect(.pulse, isActive: listen.isLive)
                        }
                        // Green names a tune; orange is a session, as everywhere.
                        .tint(listen.isRecording || listen.deckHeight == .full ? Palette.brandDot : Palette.brandInk)
                        .buttonStyle(.glassProminent)
                        .accessibilityLabel(listen.isRecording ? (listen.deckHeight == .head ? "Show the live session" : "Fold the live session away")
                                            : listen.isLive ? "Stop listening" : "Name the tune that's playing")
                    }
                }
            }
        }
    }
}

/// Listening as one deck docked by the bars' column (iPhone Duo), as Android's and the web's: the microphone at three
/// heights. Down is standby; up once (half) it names a tune, listening as it comes up, and shows the answer in place; up
/// again (full) it is the session deck, which records once Record is pressed. Down stops naming a tune; only Stop ends a
/// session. Dragged by its top, or moved with the mic, the hint at its foot and the session's clock. Unfolded it is a
/// card over the right of the score; folded it is as wide as the screen, a bottom drawer.
struct ListenDeck: ViewModifier {
    @Environment(ListenModel.self) private var listen
    let enabled: Bool

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottomTrailing) {
                if enabled {
                    GeometryReader { geometry in
                        DeckCard(width: min(400, geometry.size.width - 24), fullHeight: min(geometry.size.height - 24, 640))
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                            .padding([.trailing, .bottom], 12)
                    }
                    .animation(.spring(response: 0.42, dampingFraction: 0.86), value: listen.deckHeight)
                }
            }
            .sheet(item: Binding(get: { enabled ? listen.scoreTune : nil }, set: { listen.scoreTune = $0 })) { ScoreScreen(tune: $0) }
    }
}

private struct DeckCard: View {
    @Environment(ListenModel.self) private var listen
    let width: CGFloat
    let fullHeight: CGFloat
    @State private var drag: CGFloat = 0

    var body: some View {
        if listen.deckHeight != .head {
            VStack(spacing: 0) {
                header
                if listen.deckHeight == .full {
                    DeckContent().contentMargins(.horizontal, 18, for: .scrollContent)
                } else {
                    HalfDeck()
                }
            }
            .frame(width: width)
            .frame(height: listen.deckHeight == .full ? fullHeight : nil)
            .background(Palette.card)
            .clipShape(.rect(cornerRadius: 28, style: .continuous))
            .shadow(color: .black.opacity(0.16), radius: 24, y: 8)
            .offset(y: drag)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    /// The grabber and what the deck is: drag it up a step or down a step, as Android's deck.
    private var header: some View {
        VStack(spacing: 8) {
            Capsule().fill(Palette.lineStrong).frame(width: 36, height: 5).padding(.top, 8)
            HStack(spacing: 10) {
                if listen.isRecording, let start = listen.sessionStartedAt {
                    RecordingDot()
                    TimelineView(.periodic(from: .now, by: 1)) { _ in
                        Text("Recording \(clock(Date.now.timeIntervalSince(start)))").font(.subheadline.weight(.semibold)).monospacedDigit()
                    }
                    Spacer()
                    Button("Stop", role: .destructive) { listen.stop(); listen.settle(.head) }
                        .buttonStyle(.borderedProminent).tint(Palette.danger).controlSize(.small)
                        .accessibilityLabel("Stop the session")
                } else {
                    Text(listen.deckHeight == .full ? "Record a session" : "Name a tune").font(.subheadline.weight(.semibold))
                    Spacer()
                }
                Button("Fold away", systemImage: "chevron.down") { listen.settle(.head) }
                    .labelStyle(.iconOnly).buttonStyle(.glass).buttonBorderShape(.circle).controlSize(.small)
            }
            .padding(.horizontal, 16)
        }
        .padding(.bottom, 6)
        .contentShape(.rect)
        .highPriorityGesture(DragGesture(minimumDistance: 6, coordinateSpace: .global)
            .onChanged { drag = max($0.translation.height, -40) }
            .onEnded { value in
                drag = 0
                let up = value.translation.height < -40 || value.predictedEndTranslation.height < -160
                let down = value.translation.height > 60 || value.predictedEndTranslation.height > 200
                if up, listen.deckHeight == .half { listen.settle(.full) }
                if down { listen.settle(listen.deckHeight == .full && !listen.isRecording && listen.leader != nil ? .half : .head) }
            })
        .accessibilityAction(named: "Fold away") { listen.settle(.head) }
    }
}

/// Half up: listening for a tune (the dial and what it hears), then the tune it names, in place; at the foot, the step
/// up to a session.
private struct HalfDeck: View {
    @Environment(ListenModel.self) private var listen

    var body: some View {
        VStack(spacing: 0) {
            if !listen.isLive, listen.leader != nil {
                AnswerPanel()
            } else {
                VStack(spacing: 14) {
                    FinderDial(size: .record, forSession: false, action: listen.pressMic)
                    // Armed, it waits for the dial; listening, it says what it hears.
                    Text(listen.isLive || listen.problem != nil ? listen.statusLine : "Tap to name the tune that's playing")
                        .font(.headline).multilineTextAlignment(.center)
                        .contentTransition(.opacity)
                        .animation(Motion.standard, value: listen.statusLine)
                }
                .padding(.vertical, 24)
                .frame(maxWidth: .infinity)
            }
            Divider()
            Button { listen.settle(.full) } label: {
                Label("Swipe up to record the whole session", systemImage: "chevron.up")
                    .font(.footnote.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Palette.brandDotText)
        }
    }
}

/// A named tune's answer, as tall as it is (up to the panel's height), so a short answer is a short card.
private struct AnswerPanel: View {
    @State private var height: CGFloat = 300

    var body: some View {
        ScrollView {
            AnswerContent().onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(height: min(height, 460))
    }
}

/// While a session records, a thin warm line round the edge of the screen, following its corners and breathing slowly,
/// and on it, at the foot, the session's clock: a glance says the mic is on, whatever screen you're on. The clock opens
/// the deck; the line is never in the way of a touch. `clock` is off where the tray already shows it (a phone's tabs).
struct RecordingGlow: View {
    @Environment(ListenModel.self) private var listen
    var clock = true

    var body: some View {
        ZStack(alignment: .bottom) {
            TimelineView(.animation(minimumInterval: 1 / 30)) { context in
                let phase = (sin(context.date.timeIntervalSinceReferenceDate * .pi / 1.6) + 1) / 2
                ContainerRelativeShape()
                    .strokeBorder(Palette.brandDot.opacity(0.35 + 0.35 * phase), lineWidth: 3)
                    .blur(radius: 1.5)
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            // The deck open shows the clock itself.
            if clock, !(listen.docked && listen.deckHeight != .head), let start = listen.sessionStartedAt {
                Button { if listen.docked { listen.settle(.full) } else { listen.deckOpen = true } } label: {
                    TimelineView(.periodic(from: .now, by: 1)) { _ in
                        HStack(spacing: 6) {
                            Circle().fill(.white).frame(width: 7, height: 7)
                            Text(TuneCompanion.clock(Date.now.timeIntervalSince(start))).font(.footnote.weight(.semibold)).monospacedDigit()
                            // What's playing now, as the tray says it on a phone.
                            if let now = listen.tonight.first?.tune.displayTitle {
                                Text("·").opacity(0.7)
                                Text(now).font(.tuneTitle(.footnote)).lineLimit(1)
                            }
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Palette.brandDot, in: .capsule)
                    }
                }
                .buttonStyle(.plain)
                .padding(.bottom, 2)
                .ignoresSafeArea(edges: .bottom)
                .accessibilityLabel("Recording\(listen.tonight.first.map { ", now \($0.tune.displayTitle)" } ?? ""). Open the live session")
            }
        }
        // Centred on the screen, not on what the bars' column leaves.
        .ignoresSafeArea(edges: .horizontal)
        .transition(.opacity)
    }
}

/// A session moving on to a new tune pops up to say so: its name and opening bars, for a moment (it goes by itself,
/// or swiped away; touched, it stays). Tapped, the tune joins your tunes and its full score opens. Docked (iPhone Duo)
/// it sits where the deck does, by the column; on a phone, at the top of the screen.
struct NewTunePopUp: ViewModifier {
    @Environment(ListenModel.self) private var listen
    let enabled: Bool

    func body(content: Content) -> some View {
        content.overlay(alignment: listen.docked ? .bottomTrailing : .top) {
            if enabled, let heard = listen.newTune {
                NewTuneCard(heard: heard)
                    .frame(maxWidth: 400)
                    .padding(12)
                    .id(heard.id)
                    .transition(.move(edge: listen.docked ? .bottom : .top).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.42, dampingFraction: 0.86), value: listen.newTune?.id)
    }
}

private struct NewTuneCard: View {
    @Environment(ListenModel.self) private var listen
    let heard: HeardTune
    @State private var drag: CGFloat = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Now playing").font(.caption.weight(.semibold)).foregroundStyle(Palette.brandDotText)
                Spacer()
                Button("Not this tune", systemImage: "xmark") { listen.reject(heard); listen.dismissNewTune() }
                    .labelStyle(.iconOnly).font(.caption.weight(.semibold)).foregroundStyle(Palette.text3)
            }
            Text(heard.tune.displayTitle).font(.tuneTitle(.title3)).lineLimit(2)
            if !heard.tune.meta.isEmpty { Text(heard.tune.meta).font(.caption).foregroundStyle(Palette.text3) }
            OpeningPhrase(tune: heard.tune).padding(.top, 4)
            Label(heard.tune.savedId == nil ? "Tap to add it to your tunes and see the full score" : "Tap for the full score",
                  systemImage: "music.note")
                .font(.caption.weight(.semibold)).foregroundStyle(Palette.brandInk)
        }
        .padding(16)
        .background(Palette.card, in: .rect(cornerRadius: 22, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Palette.brandDot.opacity(0.5), lineWidth: 1.5) }
        .shadow(color: .black.opacity(0.16), radius: 20, y: 6)
        .offset(y: drag)
        .contentShape(.rect)
        .onTapGesture { Task { await listen.openNewTune() } }
        .gesture(DragGesture(minimumDistance: 6)
            .onChanged { listen.stopPeeking(); drag = listen.docked ? max($0.translation.height, 0) : min($0.translation.height, 0) }
            .onEnded { value in
                if abs(value.translation.height) > 50 || abs(value.predictedEndTranslation.height) > 140 { listen.dismissNewTune() }
                drag = 0
            })
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Now playing: \(heard.tune.displayTitle)")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction(named: "Not this tune") { listen.reject(heard); listen.dismissNewTune() }
    }
}
