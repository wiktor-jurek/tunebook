import API
import DesignSystem
import ListenCore
import SwiftUI

/// Two tabs, one job each, with the deck's head docked above the tab bar on every screen. The deck
/// opens out of it with the system's zoom, as a player opens from its mini player.
struct RootView: View {
    @Environment(ListenModel.self) private var listen
    @Environment(LibraryStore.self) private var library
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Namespace private var deck
    @State private var tab = "tunes"
    @State private var barsStandUp = false
    #if DEBUG
    @State private var debugTune: SavedTune?
    @State private var debugBook: BookSummary?
    #endif

    private var wide: Bool { sizeClass == .regular }

    var body: some View {
        @Bindable var listen = listen
        @Bindable var library = library
        TabView(selection: $tab) {
            Tab("Tunes", systemImage: "music.note.list", value: "tunes") { TunesView() }
            Tab("Sessions", systemImage: "waveform", value: "recordings") { RecordingsView() }
            Tab("Me", systemImage: "person.crop.circle", value: "me") { MeView() }
        }
        // With the bars up the side, the tray's mic stands among them instead (`ListenBarItems`), for the docked deck.
        .modifier(TrayAccessory(enabled: !barsStandUp) { ListenTray().matchedTransitionSource(id: "deck", in: deck) })
        .tabBarMinimizeBehavior(.onScrollDown)
        // With the bars up the side or a wide screen, listening is one deck docked by the column (`ListenDeck`), as on
        // Android and the web; on a phone, the tray and its sheets.
        .modifier(ListenDeck(enabled: listen.docked && !listen.readerOpen))
        .modifier(NewTunePopUp(enabled: !listen.readerOpen))
        .onChange(of: barsStandUp || wide, initial: true) { listen.docked = barsStandUp || wide }
        .overlay { if listen.isRecording { RecordingGlow(clock: barsStandUp) } }
        .animation(.easeInOut(duration: 0.4), value: listen.isRecording)
        .sheet(isPresented: Binding(get: { listen.deckOpen && !listen.docked }, set: { listen.deckOpen = $0 }), onDismiss: {}) {
            DeckView()
                .navigationTransition(.zoom(sourceID: "deck", in: deck))
                .sheet(item: $listen.scoreTune) { ScoreScreen(tune: $0) }
        }
        .sheet(isPresented: Binding(get: { listen.answerOpen && !listen.docked }, set: { listen.answerOpen = $0 })) {
            AnswerSheet().sheet(item: $listen.scoreTune) { ScoreScreen(tune: $0) }
        }
        .sheet(item: Binding(get: { listen.docked || listen.deckOpen || listen.answerOpen ? nil : listen.scoreTune },
                             set: { listen.scoreTune = $0 })) { ScoreScreen(tune: $0) }
        .fullScreenCover(isPresented: $listen.dimmed) { PocketView() }
        // Learn later while signed out asks for an account first.
        .sheet(isPresented: $library.askToSignIn) {
            NavigationStack { SignInView().toolbar { ToolbarItem(placement: .cancellationAction) { Button("Not now") { library.askToSignIn = false } } } }
        }
        .onChange(of: library.user) { if library.user != nil { library.askToSignIn = false } }
        // A tunebook just made opens on the Tunes tab.
        .onChange(of: library.openingBook) { if library.openingBook != nil { listen.answerOpen = false; listen.deckOpen = false; tab = "tunes" } }
        #if DEBUG
        .sheet(item: $debugBook) { book in NavigationStack { BookView(summary: book) } }
        .sheet(item: $debugTune) { tune in
            NavigationStack {
                ScorePage(page: ReaderPage(tune: tune, set: nil, id: tune.id), current: true, playalongs: nil, defaultSound: nil, editable: false, autoplay: true)
            }
        }
        #endif
        .background { BarEdgeReader { edge in Color.clear.onChange(of: edge != nil, initial: true) { barsStandUp = edge != nil } } }
        .onReceive(NotificationCenter.default.publisher(for: .nameATune)) { _ in listen.nameATune() }
        .task {
            // For screenshots and UI tests: `-autoListen` starts listening on launch, `-autoListen session` records.
            let args = ProcessInfo.processInfo.arguments
            if let i = args.firstIndex(of: "-autoListen") {
                if args.dropFirst(i + 1).first == "session" { listen.startSession() } else { listen.nameATune() }
            }
            #if DEBUG
            // Screenshots of each state without music playing: `-showTune 55` opens a tune's answer, `-openDeck` the deck.
            if let i = args.firstIndex(of: "-showTune"), let id = args.dropFirst(i + 1).first.flatMap(Int.init) { await listen.show(tuneId: id) }
            if args.contains("-openDeck") { listen.deckOpen = true }
            // The docked deck armed, half up and not listening.
            if args.contains("-armDeck") { try? await Task.sleep(for: .seconds(1)); listen.settle(.half) }
            // Folded to standby a moment after starting (with `-autoListen session`, a session carrying on underneath).
            // Folded to standby a moment after starting (with `-autoListen session`, a session carrying on underneath), then
            // `-popTune 55` names a new tune (the new-tune pop-up). In a task of their own: the session starting re-lays
            // out the screen, which would cancel this one.
            if args.contains("-foldDeck") || args.contains("-popTune") {
                Task { @MainActor in
                    try? await Task.sleep(for: .seconds(3))
                    if args.contains("-foldDeck") { listen.settle(.head) }
                    if let i = args.firstIndex(of: "-popTune"), let id = args.dropFirst(i + 1).first.flatMap(Int.init) {
                        try? await Task.sleep(for: .seconds(2))
                        await listen.show(tuneId: id)
                    }
                }
            }
            if args.contains("-openRecording") { tab = "recordings" }
            if let i = args.firstIndex(of: "-openBook"), let id = args.dropFirst(i + 1).first {
                debugBook = try? JSONDecoder().decode(BookSummary.self, from: Data(#"{"id":"\#(id)","name":"Tunebook"}"#.utf8))
            }
            if let i = args.firstIndex(of: "-playTune"), let id = args.dropFirst(i + 1).first.flatMap(Int.init),
               let found = try? await listen.api.finderTunes(ids: [id]).first {
                // A catalog tune shown as if saved, to try the tune page and its player (screenshots, checks).
                let json: [String: Any] = ["id": UUID().uuidString, "tuneId": found.tuneId, "settingId": found.settingId ?? 0, "title": found.title,
                                           "kind": found.kind ?? "", "meter": found.meter ?? "", "mode": found.mode ?? "", "abc": found.abc ?? "",
                                           "practice": ["level": "learning"]]
                debugTune = try? JSONDecoder().decode(SavedTune.self, from: JSONSerialization.data(withJSONObject: json))
            }
            #endif
        }
    }
}

/// The tray docked over the tab bar; it can step aside (for the bars standing up the side) from iOS 26.1.
private struct TrayAccessory<Tray: View>: ViewModifier {
    let enabled: Bool
    @ViewBuilder let tray: Tray

    func body(content: Content) -> some View {
        if #available(iOS 26.1, *) {
            content.tabViewBottomAccessory(isEnabled: enabled) { tray }
        } else {
            content.tabViewBottomAccessory { tray }
        }
    }
}

// MARK: - Adaptive layout (iPhone Duo's inner display, iPad)

extension EnvironmentValues {
    /// Whether rows of a list open their detail beside it (a split view) rather than pushing it.
    @Entry var showsDetailBeside = false
}

/// A list and what it opens. In compact width (a phone, or iPhone Duo folded to its outer display) one stack,
/// the list pushing its detail; in regular width (Duo unfolded, iPad) the list beside its detail. Both share
/// `path`, so folding or unfolding keeps what is open. `split` is false while there is no list to show
/// (signed out, loading), which then fills the screen.
struct ListAndDetail<Route: Hashable, Sidebar: View, Placeholder: View, Destination: View>: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Binding var path: [Route]
    let split: Bool
    let sidebar: Sidebar
    let placeholder: Placeholder
    let destination: (Route) -> Destination

    init(path: Binding<[Route]>, split: Bool = true, @ViewBuilder sidebar: () -> Sidebar, @ViewBuilder placeholder: () -> Placeholder,
         @ViewBuilder destination: @escaping (Route) -> Destination) {
        _path = path
        self.split = split
        self.sidebar = sidebar()
        self.placeholder = placeholder()
        self.destination = destination
    }

    var body: some View {
        if split && sizeClass == .regular {
            NavigationSplitView {
                sidebar.environment(\.showsDetailBeside, true)
            } detail: {
                NavigationStack(path: $path) {
                    placeholder.modifier(ListenBarItems())
                        .navigationDestination(for: Route.self) { destination($0).modifier(ListenBarItems()) }
                }
            }
        } else {
            NavigationStack(path: $path) {
                sidebar.modifier(ListenBarItems())
                    .navigationDestination(for: Route.self) { destination($0).modifier(ListenBarItems()) }
            }
        }
    }
}

/// A row that opens `route`: pushed in a stack, or shown beside the list in a split view and marked while it is.
struct RouteLink<Route: Hashable, Label: View>: View {
    @Environment(\.showsDetailBeside) private var beside
    let route: Route
    @Binding var path: [Route]
    @ViewBuilder let label: Label

    var body: some View {
        if beside {
            Button { path = [route] } label: { label.frame(maxWidth: .infinity, alignment: .leading).contentShape(.rect) }
                .buttonStyle(.plain)
                .listRowBackground(path.first == route ? Palette.accent : nil)
        } else {
            NavigationLink(value: route) { label }
        }
    }
}

/// The crease of iPhone Duo's inner display half open like a book (margins included), in `geometry`'s space; nil when flat or folded.
func foldDivision(in geometry: GeometryProxy) -> CGRect? {
    if #available(iOS 27.1, *) {
        return geometry.reservedRegions(kind: .division).first { $0.isActive && $0.frame.height > $0.frame.width }?.frame
    }
    return nil
}
