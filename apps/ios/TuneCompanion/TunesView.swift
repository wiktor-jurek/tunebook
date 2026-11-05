// Session mode's home: every tune you have, each opening to its score, grouped as you choose. Grouped
// by tunebook, each book is a section; books shared with you follow.

import API
import DesignSystem
import SwiftUI

struct TunesView: View {
    @Environment(LibraryStore.self) private var library
    @AppStorage("groupBy") private var groupBy = GroupBy.stage
    @State private var query = ""
    @State private var account = false
    @State private var reading: (pages: [ReaderPage], at: Int)?
    @State private var path: [BookSummary] = []
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        // Unfolded (iPhone Duo, an iPad), the Tunes tab is the reader itself: your tunes down the side, each opening beside
        // them. Folded, the list, each tune opening the full-screen reader. The sheet and reader hang outside, so a fold
        // or unfold keeps them open.
        Group {
            if sizeClass == .regular, library.state == .ready, !library.tunes.isEmpty {
                Reader(book: .yourTunes(library, groupedBy: groupBy), at: 0, embedded: true) { account = true }
            } else {
                list(path: $path)
            }
        }
        .sheet(isPresented: $account) { AccountSheet() }
        .onChange(of: library.openingBook) {
            if let book = library.openingBook { path.append(book); library.openingBook = nil }
        }
        .fullScreenCover(item: Binding(get: { reading.map { ReaderAt(index: $0.at) } }, set: { if $0 == nil { reading = nil } })) { at in
            if let reading { Reader(book: ReaderBook(id: nil, name: "Tunes", pages: reading.pages), at: at.index) }
        }
    }

    private func list(path: Binding<[BookSummary]>) -> some View {
        ListAndDetail(path: path, split: false) {
            content
                .navigationTitle("Tunes")
                .toolbar {
                    if library.user != nil {
                        ToolbarItem(placement: .topBarTrailing) {
                            Menu {
                                Picker("Group by", selection: $groupBy) {
                                    ForEach(GroupBy.allCases) { Text($0.label).tag($0) }
                                }
                            } label: {
                                Label(groupBy.short, systemImage: "line.3.horizontal.decrease").labelStyle(.titleAndIcon)
                            }
                            .accessibilityLabel("Group by \(groupBy.label)")
                        }
                        ToolbarItem(placement: .topBarTrailing) {
                            Button { account = true } label: {
                                Text(library.user.map { String($0.name.prefix(1)).uppercased() } ?? "")
                                    .font(.subheadline.weight(.bold))
                                    .frame(width: 30, height: 30)
                                    .background(Palette.border, in: .circle)
                            }
                            .accessibilityLabel("Settings for \(library.user?.name ?? "you")")
                        }
                    }
                }
        } placeholder: {
            EmptyView()
        } destination: { book in
            BookView(summary: book)
        }
    }

    private var groups: [TuneGroup] {
        groupTunes(query.isEmpty ? library.tunes : library.tunes.filter { $0.matches(query) }, by: groupBy, books: library.books)
    }

    /// The reader turns through the tunes as they are listed, group after group.
    private var pages: [ReaderPage] {
        groups.flatMap { group in group.tunes.map { ReaderPage(tune: $0, set: nil, id: "\(group.id)-\($0.id)") } }
    }

    private func read(from id: String) {
        let pages = pages
        reading = (pages, pages.firstIndex { $0.id == id } ?? 0)
    }

    @ViewBuilder private var content: some View {
        switch library.state {
        case .signedOut:
            SignInView()
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case let .failed(message):
            ContentUnavailableView { Label("No connection", systemImage: "wifi.slash") } description: { Text(message) } actions: {
                Button("Try again") { Task { await library.load() } }
            }
        case .ready:
            if library.tunes.isEmpty {
                ContentUnavailableView {
                    Label { Text("No tunes yet") } icon: { BrandMark().frame(width: 48, height: 48) }
                } description: {
                    Text("Save tunes at home, or name one that's playing with the microphone below, and they appear here.")
                }
            } else {
                list
            }
        }
    }

    private var list: some View {
        let groups = groups
        return List {
            ForEach(groups) { group in
                Section {
                    ForEach(group.tunes) { tune in
                        Button { read(from: "\(group.id)-\(tune.id)") } label: { TuneRow(tune: tune, groupedBy: groupBy) }
                            .buttonStyle(.plain)
                    }
                } header: {
                    if !group.label.isEmpty {
                        // Grouped by tunebook, each book's heading opens it.
                        if let book = group.book {
                            RouteLink(route: book, path: $path) { groupHeading(group) }.buttonStyle(.plain)
                        } else {
                            groupHeading(group)
                        }
                    }
                }
            }
            if query.isEmpty, !library.sharedBooks.isEmpty {
                Section("Shared with you") {
                    ForEach(library.sharedBooks) { book in
                        RouteLink(route: book, path: $path) { Label { Text(book.name) } icon: { Text(book.emoji ?? "📖") } }
                    }
                }
            }
            if groups.isEmpty {
                Text("No tune of yours matches \"\(query)\".").foregroundStyle(Palette.text3)
            }
        }
        .searchable(text: $query, prompt: "Search your tunes")
        .refreshable { await library.load() }
    }
}

private func groupHeading(_ group: TuneGroup) -> some View {
    HStack(spacing: 6) {
        if let emoji = group.book?.emoji { Text(emoji) }
        Text(group.label)
        if group.book != nil { Image(systemName: "chevron.right").font(.caption2.weight(.semibold)) }
        Spacer()
        Text("\(group.tunes.count)").monospacedDigit().foregroundStyle(Palette.text4)
    }
}

private struct TuneRow: View {
    let tune: SavedTune
    let groupedBy: GroupBy

    var body: some View {
        HStack(spacing: 12) {
            // The emoji a tune gets when nothing better matches its title shows faintly, so chosen ones stand out.
            Text(tune.emoji ?? "🎵").font(.title3).opacity(tune.emoji == nil || tune.emoji == "🎵" ? 0.35 : 1)
                .frame(width: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(tune.displayTitle).font(.tuneTitle(.title3)).lineLimit(2)
                let meta = tune.meta(groupedBy: groupedBy)
                if !meta.isEmpty { Text(meta).font(.caption).foregroundStyle(Palette.text3) }
            }
            Spacer(minLength: 8)
            if groupedBy != .stage { AbilityMark(level: tune.practice.level) }
        }
        .padding(.vertical, 4)
        .contentShape(.rect)
    }
}

/// Four bars, filled one per step past Not assessed: Want to learn fills one, Can lead all four.
struct AbilityMark: View {
    let level: FinderTune.Level

    var body: some View {
        HStack(alignment: .bottom, spacing: 2) {
            ForEach(1...4, id: \.self) { step in
                RoundedRectangle(cornerRadius: 1)
                    .fill(step <= level.rank ? fill : Palette.accent)
                    .frame(width: 3, height: [4, 6, 9, 12][step - 1])
            }
        }
        .frame(height: 12)
        .accessibilityElement()
        .accessibilityLabel(level.label)
    }

    private var fill: Color {
        switch level {
        case .wanted, .learning: Palette.brandDot
        case .learned: Palette.learned
        case .mastered: Palette.brandInk
        case .unlearned: Palette.lineStrong
        }
    }
}

/// Who is signed in, and signing out.
private struct AccountSheet: View {
    @Environment(LibraryStore.self) private var library
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if let user = library.user {
                    Section {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(user.name).font(.headline)
                            Text(user.email).font(.subheadline).foregroundStyle(Palette.mutedForeground)
                        }
                    }
                }
                Section {
                    Button("Sign out", role: .destructive) {
                        Task { await library.signOut(); dismiss() }
                    }
                } footer: {
                    if library.api.base != APIClient.production { Text("Connected to \(library.api.base.absoluteString)") }
                }
            }
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }
}
