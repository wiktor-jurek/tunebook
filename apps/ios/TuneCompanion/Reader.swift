// The reader, as the phone's web SessionBook: a list's tunes as full-screen scores, swiped through.
// The bar names the tune, says where it is ("3 of 12", which opens every tune to jump to) and finds
// one by name. Only the tune on screen plays, from its island; its neighbours are drawn ready.

import API
import DesignSystem
import Notation
import SwiftUI

struct ReaderPage: Identifiable, Hashable {
    let tune: SavedTune
    /// The set it is played in, if any.
    let set: String?
    let id: String
}

struct Reader: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(ListenModel.self) private var listen
    @State private var book: ReaderBook
    @State var at: Int
    /// The Tunes tab itself, unfolded: no close, and no tune open until one is picked.
    let embedded: Bool
    /// Opens your account, for the Tunes tab's list.
    var onAccount: (() -> Void)?
    @State private var chosen: Bool
    @State private var searching = false
    /// The tune on screen's player, for the bars to carry when they stand up the side.
    @State private var rail = PlayerRailSlot()
    /// Unfolded, how far the score is zoomed out: 0 large to read, 1 between, 2 small with four bars to a line.
    @AppStorage("scoreZoom") private var zoom = 0
    private static let zoomWidths = [400, 580, 760]

    init(book: ReaderBook, at: Int, embedded: Bool = false, onAccount: (() -> Void)? = nil) {
        _book = State(initialValue: book)
        _at = State(initialValue: at)
        self.embedded = embedded
        self.onAccount = onAccount
        _chosen = State(initialValue: !embedded)
    }

    var body: some View {
        Group {
            // Unfolded (iPhone Duo's inner display, an iPad), as the web on a desktop: the list's tunes down the side,
            // to pick from or switch tunebook, beside one large score. Folded, a phone's reader: swipe from score to score.
            // `at` is kept either way, so folding keeps your place.
            if sizeClass == .regular {
                GeometryReader { geometry in
                    NavigationSplitView(columnVisibility: .constant(.all)) {
                        ReaderSidebar(book: $book, at: $at, chosen: $chosen, embedded: embedded, onAccount: onAccount)
                            .navigationSplitViewColumnWidth(sidebarWidth(geometry))
                            .toolbar(removing: .sidebarToggle)
                    } detail: {
                        // The mic joins the column, and what it names opens on the right, over the score (the tabs show
                        // it themselves when this is the Tunes tab).
                        Group {
                            if chosen && !book.pages.isEmpty {
                                scores
                            } else {
                                ContentUnavailableView("Choose a tune", systemImage: "music.note.list",
                                                       description: Text("Pick one from the list, or search for any tune by name, type or key."))
                            }
                        }
                        .modifier(ListenBarItems())
                    }
                    .navigationSplitViewStyle(.balanced)
                }
            } else {
                NavigationStack { scores }
            }
        }
        .sheet(isPresented: $searching) { ReaderSearch(pages: book.pages) { at = $0 } }
        // Over the tabs, the reader shows the docked deck and the session's glow itself (the Tunes tab's reader has the tabs').
        .modifier(ListenDeck(enabled: listen.docked && !embedded))
        .modifier(NewTunePopUp(enabled: !embedded))
        .overlay { if listen.isRecording, !embedded { RecordingGlow(clock: listen.docked) } }
        // The phone is propped on a music stand or a pint glass: the screen stays on.
        // A tune named while reading that this list has: its full score is right here, so turn to it.
        .onChange(of: listen.scoreTune?.tuneId) {
            guard sizeClass == .regular, let named = listen.scoreTune,
                  let index = book.pages.firstIndex(where: { $0.tune.tuneId == named.tuneId }) else { return }
            listen.scoreTune = nil
            listen.answerOpen = false
            listen.deckOpen = false
            withAnimation { at = index; chosen = true }
        }
        // Opened to read (not the Tunes tab), the screen stays on and the reader shows what the mic names.
        .onAppear { if !embedded { UIApplication.shared.isIdleTimerDisabled = true; listen.readerOpen = true } }
        .onDisappear { if !embedded { UIApplication.shared.isIdleTimerDisabled = false; listen.readerOpen = false } }
    }

    /// The scores, swiped through, with the bar: close, where you are, find, and (when the bars stand up the side) the player.
    private var scores: some View {
        BarEdgeReader { edge in
            TabView(selection: $at) {
                ForEach(book.pages.indices, id: \.self) { index in
                    Group {
                        if abs(index - at) <= 1 { score(index) } else { Color.clear }
                    }
                    .tag(index)
                }
            }
            .environment(\.scoreStaffWidth, sizeClass == .regular ? Self.zoomWidths[min(max(zoom, 0), 2)] : nil)
            // Pinch to zoom, a step at a time.
            .simultaneousGesture(MagnifyGesture().onEnded { value in
                guard sizeClass == .regular else { return }
                let step = value.magnification < 0.85 ? 1 : value.magnification > 1.18 ? -1 : 0
                if step != 0 { withAnimation { zoom = min(max(zoom + step, 0), 2) } }
            })
            .sensoryFeedback(.selection, trigger: zoom)
            .id(book.id ?? book.name)
            .tabViewStyle(.page(indexDisplayMode: .never))
            .background(Palette.card)
            .environment(rail)
            .onChange(of: edge, initial: true) { rail.edge = edge }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !embedded {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close", systemImage: "xmark") { dismiss() }
                    }
                }
                if sizeClass == .regular {
                    ToolbarItem(placement: .primaryAction) { zoomButton }
                }
                // Beside the list, the list says where you are. Standing up the side, where you are joins the column too,
                // so the score keeps the top of the page.
                if sizeClass != .regular { ToolbarItem(placement: edge == nil ? .principal : .primaryAction) { counter(round: edge != nil) } }
                // Beside the list, the list finds a tune.
                if book.pages.count > 1, sizeClass != .regular {
                    ToolbarItem(placement: .primaryAction) { Button("Find a tune", systemImage: "magnifyingglass") { searching = true } }
                }
                // Up the side, the column has room to turn the page too: handy with the phone on a music stand.
                // (Not on the Tunes tab, whose column also holds the tabs and the mic, and whose list is right there.)
                if edge != nil, book.pages.count > 1, !embedded {
                    ToolbarItem(placement: .bottomBar) {
                        Button("Previous tune", systemImage: "chevron.up") { withAnimation { at -= 1 } }.disabled(at == 0)
                    }
                    ToolbarItem(placement: .bottomBar) {
                        Button("Next tune", systemImage: "chevron.down") { withAnimation { at += 1 } }.disabled(at >= book.pages.count - 1)
                    }
                }
                if edge != nil { RailPlayer(playback: rail.live?.playback, playalongs: rail.live?.playalongs ?? []) }
            }
            .sensoryFeedback(.selection, trigger: at)
        }
    }

    private func score(_ index: Int) -> some View {
        let page = book.pages[index]
        return ScorePage(page: page, current: index == at, playalongs: book.playalongs?[page.tune.settingId],
                         defaultSound: book.defaultSound, editable: book.editable)
            .id(page.id)
            .background(Palette.card)
    }

    /// How large the score is: large to read, between, or small with four bars to a line (pinching steps through them too).
    private var zoomButton: some View {
        Menu {
            Picker("Score size", selection: $zoom) {
                Label("Large", systemImage: "textformat.size.larger").tag(0)
                Label("Medium", systemImage: "textformat.size").tag(1)
                Label("Small, four bars a line", systemImage: "textformat.size.smaller").tag(2)
            }
        } label: {
            Label("Score size", systemImage: zoom == 0 ? "minus.magnifyingglass" : "plus.magnifyingglass")
        }
        .accessibilityValue(["Large", "Medium", "Small"][min(max(zoom, 0), 2)])
    }

    /// Where you are, which opens every tune to jump to: "3 of 12" across the top, or "3/12" as a round button in the column.
    @ViewBuilder private func counter(round: Bool) -> some View {
        if book.pages.count > 1 {
            Menu {
                Picker("Tune", selection: $at) {
                    ForEach(Array(book.pages.enumerated()), id: \.element.id) { index, page in
                        Text(page.tune.displayTitle).tag(index)
                    }
                }
            } label: {
                if round {
                    Text("\(at + 1)/\(book.pages.count)").font(.caption.weight(.semibold)).monospacedDigit().minimumScaleFactor(0.6).lineLimit(1)
                } else {
                    Text("\(at + 1) of \(book.pages.count)").font(.subheadline.weight(.semibold)).monospacedDigit()
                }
            }
            .accessibilityLabel("Tune \(at + 1) of \(book.pages.count). Jump to another")
        }
    }

    /// The list's width: up to the fold when iPhone Duo is half open like a book, so the score has a page of its own.
    private func sidebarWidth(_ geometry: GeometryProxy) -> CGFloat {
        if let fold = foldDivision(in: geometry), fold.minX > 240, fold.minX < geometry.size.width - 320 { return fold.minX }
        return min(340, geometry.size.width * 0.36)
    }
}

/// The reader's list beside its score: the tunes to pick from under their headings, a search that finds any tune (in
/// this list, your others, then The Session's), and (from the title) the other tunebooks.
private struct ReaderSidebar: View {
    @Environment(LibraryStore.self) private var library
    @Environment(ListenModel.self) private var listen
    @AppStorage("groupBy") private var groupBy = GroupBy.stage
    @Binding var book: ReaderBook
    @Binding var at: Int
    @Binding var chosen: Bool
    let embedded: Bool
    var onAccount: (() -> Void)?
    @State private var query = ""
    @State private var opening: String?
    @State private var catalog: [FinderTune]?

    var body: some View {
        ScrollViewReader { proxy in
            List {
                if words.isEmpty { browsing } else { searching }
            }
            .listStyle(.plain)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Name, type or key")
            .overlay { if opening != nil { ProgressView() } }
            .onChange(of: at, initial: true) { if chosen { withAnimation { proxy.scrollTo(at, anchor: .center) } } }
        }
        .navigationTitle(book.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarTitleMenu { if !library.books.isEmpty || !library.tunes.isEmpty || !library.sharedBooks.isEmpty { books } }
        .toolbar {
            if embedded, library.user != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("Group by", selection: $groupBy) { ForEach(GroupBy.allCases) { Text($0.label).tag($0) } }
                    } label: {
                        Label("Group by \(groupBy.label)", systemImage: "line.3.horizontal.decrease")
                    }
                }
                if let onAccount {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(action: onAccount) {
                            Text(library.user.map { String($0.name.prefix(1)).uppercased() } ?? "")
                                .font(.subheadline.weight(.bold))
                                .frame(width: 30, height: 30)
                                .background(Palette.border, in: .circle)
                        }
                        .accessibilityLabel("Settings for \(library.user?.name ?? "you")")
                    }
                }
            }
        }
        // All your tunes follow your library and its grouping, keeping the tune you have open.
        .onChange(of: library.tunes) { refreshYourTunes() }
        .onChange(of: groupBy) { refreshYourTunes() }
        .task(id: words) { await searchCatalog() }
    }

    private var words: String { query.trimmingCharacters(in: .whitespaces) }

    /// The list under its headings.
    @ViewBuilder private var browsing: some View {
        ForEach(book.runs) { run in
            Section {
                ForEach(run.pages, id: \.self) { index in row(book.pages[index], index: index).id(index) }
            } header: {
                if let title = run.title {
                    HStack(spacing: 6) {
                        if book.id != nil { RepeatMark() }
                        Text(title)
                        Spacer()
                        Text("\(run.pages.count)").monospacedDigit().foregroundStyle(Palette.text4)
                    }
                }
            }
        }
    }

    /// What the search finds: here first, then your other tunes, then every tune on The Session.
    @ViewBuilder private var searching: some View {
        let here = book.pages.indices.filter { book.pages[$0].tune.matches(words) }
        let inList = Set(book.pages.map(\.tune.id))
        let yours = book.id == nil ? [] : library.tunes.filter { !inList.contains($0.id) && $0.matches(words) }
        if !here.isEmpty {
            Section(book.id == nil ? "Your tunes" : "In \(book.name)") {
                ForEach(here, id: \.self) { index in row(book.pages[index], index: index) }
            }
        }
        if !yours.isEmpty {
            Section("Your other tunes") {
                ForEach(yours) { tune in
                    Button { openYours(tune) } label: { label(tune, caption: tune.meta(groupedBy: .none)) }.buttonStyle(.plain)
                }
            }
        }
        if let catalog {
            let known = Set(library.tunes.map(\.tuneId))
            let others = catalog.filter { !known.contains($0.tuneId) }
            if !others.isEmpty {
                Section("The Session") {
                    ForEach(others) { tune in FinderRow(tune: tune, detail: tune.meta) }
                }
            }
            if here.isEmpty, yours.isEmpty, others.isEmpty {
                Text("No tune called that.").foregroundStyle(Palette.text3)
            }
        } else if here.isEmpty, yours.isEmpty, words.count >= 2 {
            HStack { Spacer(); ProgressView(); Spacer() }.listRowSeparator(.hidden)
        }
    }

    private func row(_ page: ReaderPage, index: Int) -> some View {
        let selected = chosen && index == at
        return Button { at = index; chosen = true } label: {
            label(page.tune, caption: nil, set: page.set)
        }
        .buttonStyle(.plain)
        .listRowBackground(selected ? Palette.accent : nil)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func label(_ tune: SavedTune, caption: String?, set: String? = nil) -> some View {
        HStack(spacing: 10) {
            Text(tune.emoji ?? "🎵").font(.title3).opacity(tune.emoji == nil || tune.emoji == "🎵" ? 0.35 : 1).frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(tune.displayTitle).font(.tuneTitle(.headline)).lineLimit(2)
                HStack(spacing: 6) {
                    if let caption { Text(caption) } else if let set, book.sections.isEmpty { RepeatMark().scaleEffect(0.8); Text(set).lineLimit(1) } else {
                        Text(tune.meta(groupedBy: book.id == nil ? groupBy : .none))
                    }
                }
                .font(.caption).foregroundStyle(Palette.text3)
            }
            Spacer(minLength: 6)
            AbilityMark(level: tune.practice.level)
        }
        .padding(.vertical, 2)
        .contentShape(.rect)
    }

    /// One of your tunes not in this tunebook: open all your tunes at it.
    private func openYours(_ tune: SavedTune) {
        let yours = ReaderBook.yourTunes(library, groupedBy: groupBy)
        book = yours
        at = yours.pages.firstIndex { $0.tune.id == tune.id } ?? 0
        chosen = true
        query = ""
    }

    private func refreshYourTunes() {
        guard book.id == nil, embedded || !library.tunes.isEmpty else { return }
        let open = book.pages.indices.contains(at) ? book.pages[at].tune.id : nil
        book = .yourTunes(library, groupedBy: groupBy)
        at = open.flatMap { id in book.pages.firstIndex { $0.tune.id == id } } ?? 0
    }

    private func searchCatalog() async {
        catalog = nil
        guard words.count >= 2 else { return }
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled else { return }
        catalog = (try? await listen.api.searchTunes(words)) ?? []
    }

    /// The other lists to read: all your tunes, your tunebooks, and those shared with you.
    @ViewBuilder private var books: some View {
        if !library.tunes.isEmpty {
            choice("All my tunes", emoji: "🎵", current: book.id == nil) { book = .yourTunes(library, groupedBy: groupBy); at = 0; chosen = !embedded }
        }
        if !library.books.isEmpty {
            Section("Tunebooks") { ForEach(library.books) { summary in bookChoice(summary) } }
        }
        if !library.sharedBooks.isEmpty {
            Section("Shared with you") { ForEach(library.sharedBooks) { summary in bookChoice(summary) } }
        }
    }

    private func bookChoice(_ summary: BookSummary) -> some View {
        choice(summary.name, emoji: summary.emoji ?? "📖", current: book.id == summary.id) {
            opening = summary.id
            Task {
                if let loaded = try? await ReaderBook.load(summary, api: library.api), opening == summary.id { book = loaded; at = 0; chosen = !embedded }
                opening = nil
            }
        }
    }

    private func choice(_ name: String, emoji: String, current: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            if current { Label("\(emoji) \(name)", systemImage: "checkmark") } else { Text("\(emoji) \(name)") }
        }
    }
}

/// Type part of a tune's name to find it in this list.
private struct ReaderSearch: View {
    @Environment(\.dismiss) private var dismiss
    let pages: [ReaderPage]
    let pick: (Int) -> Void
    @State private var query = ""

    var body: some View {
        NavigationStack {
            let matches = pages.indices.filter { query.isEmpty || pages[$0].tune.matches(query) }
            List(matches, id: \.self) { index in
                Button { pick(index); dismiss() } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(pages[index].tune.displayTitle).font(.tuneTitle(.headline))
                        Text(pages[index].tune.meta(groupedBy: .none)).font(.caption).foregroundStyle(Palette.text3)
                    }
                }
                .tint(Palette.foreground)
            }
            .overlay { if matches.isEmpty { ContentUnavailableView("No tune called that in this list.", systemImage: "magnifyingglass") } }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Find a tune")
            .navigationTitle("Find a tune")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

/// The two dots and bars of a repeat sign: the mark of a set.
struct RepeatMark: View {
    var body: some View {
        HStack(spacing: 1.5) {
            VStack(spacing: 4) { Circle().frame(width: 3, height: 3); Circle().frame(width: 3, height: 3) }
                .foregroundStyle(Palette.brandDot)
            RoundedRectangle(cornerRadius: 0.5).fill(Palette.brandInk).frame(width: 1.5, height: 14)
            RoundedRectangle(cornerRadius: 0.5).fill(Palette.brandInk).frame(width: 3, height: 14)
        }
        .accessibilityHidden(true)
    }
}
