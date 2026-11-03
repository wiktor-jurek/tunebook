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
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
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
                .sheet(isPresented: $account) { AccountSheet() }
                .onChange(of: library.openingBook) {
                    if let book = library.openingBook { path.append(book); library.openingBook = nil }
                }
                .navigationDestination(for: BookSummary.self) { BookView(summary: $0) }
                .fullScreenCover(item: Binding(get: { reading.map { ReaderAt(index: $0.at) } }, set: { if $0 == nil { reading = nil } })) { at in
                    if let reading { Reader(name: "Tunes", pages: reading.pages, at: at.index) }
                }
        }
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
        let shown = query.isEmpty ? library.tunes : library.tunes.filter { $0.matches(query) }
        let groups = groupTunes(shown, by: groupBy, books: library.books)
        // The reader turns through the tunes as they are listed, group after group.
        let pages = groups.flatMap { group in group.tunes.map { ReaderPage(tune: $0, set: nil, id: "\(group.id)-\($0.id)") } }
        return List {
            ForEach(groups) { group in
                Section {
                    ForEach(group.tunes) { tune in
                        Button { reading = (pages, pages.firstIndex { $0.id == "\(group.id)-\(tune.id)" } ?? 0) } label: {
                            TuneRow(tune: tune, groupedBy: groupBy)
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    if !group.label.isEmpty {
                        // Grouped by tunebook, each book's heading opens it.
                        if let book = group.book {
                            NavigationLink(value: book) { groupHeading(group) }.buttonStyle(.plain)
                        } else {
                            groupHeading(group)
                        }
                    }
                }
            }
            if query.isEmpty, !library.sharedBooks.isEmpty {
                Section("Shared with you") {
                    ForEach(library.sharedBooks) { book in
                        NavigationLink(value: book) { Label { Text(book.name) } icon: { Text(book.emoji ?? "📖") } }
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
