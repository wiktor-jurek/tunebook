import API
import DesignSystem
import ListenCore
import SwiftUI

/// Two tabs, one job each, with the deck's head docked above the tab bar on every screen. The deck
/// opens out of it with the system's zoom, as a player opens from its mini player.
struct RootView: View {
    @Environment(ListenModel.self) private var listen
    @Environment(LibraryStore.self) private var library
    @Namespace private var deck
    @State private var tab = "tunes"
    #if DEBUG
    @State private var debugTune: SavedTune?
    @State private var debugBook: BookSummary?
    #endif

    var body: some View {
        @Bindable var listen = listen
        @Bindable var library = library
        TabView(selection: $tab) {
            Tab("Tunes", systemImage: "music.note.list", value: "tunes") { TunesView() }
            Tab("Recordings", systemImage: "waveform", value: "recordings") { RecordingsView() }
        }
        .tabViewBottomAccessory {
            ListenTray().matchedTransitionSource(id: "deck", in: deck)
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .sheet(isPresented: $listen.deckOpen, onDismiss: { listen.stopPeeking() }) {
            DeckView()
                .navigationTransition(.zoom(sourceID: "deck", in: deck))
                .sheet(item: $listen.scoreTune) { ScoreScreen(tune: $0) }
        }
        .sheet(isPresented: $listen.answerOpen) {
            AnswerSheet().sheet(item: $listen.scoreTune) { ScoreScreen(tune: $0) }
        }
        .sheet(item: Binding(get: { listen.deckOpen || listen.answerOpen ? nil : listen.scoreTune },
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
