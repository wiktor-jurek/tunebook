// A tunebook, as the phone's web book page: its tunes and sets in playing order, each opening the
// reader at its score. Stars mark tunes often played at the book's session; one tap shows only those.

import API
import DesignSystem
import Notation
import SwiftUI

private struct BookDetail: Decodable {
    struct Book: Decodable { let id: String, name: String, emoji: String?, isOwner: Bool }
    let book: Book
    let sections: [BookSection]
    let playalongs: [String: [PlayalongTrack]]
    let defaultSound: Int
}

struct BookView: View {
    @Environment(LibraryStore.self) private var library
    let summary: BookSummary
    @State private var detail: BookDetail?
    @State private var problem: String?
    @State private var query = ""
    @State private var oftenPlayed = false
    @State private var reading: Int?

    var body: some View {
        Group {
            if let detail {
                if detail.sections.isEmpty {
                    ContentUnavailableView("No tunes in this book yet.", systemImage: "book")
                } else {
                    list(detail)
                }
            } else if let problem {
                ContentUnavailableView { Label("Couldn't open the tunebook", systemImage: "book") } description: { Text(problem) } actions: {
                    Button("Try again") { Task { await load() } }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle(summary.name)
        .toolbar {
            if detail?.sections.contains(where: { section in tunes(in: section).contains { $0.oftenPlayed == true } }) == true {
                ToolbarItem(placement: .topBarTrailing) {
                    Toggle(isOn: $oftenPlayed) { Label("Often played", systemImage: oftenPlayed ? "star.fill" : "star") }
                        .toggleStyle(.button)
                        .tint(Palette.brandDot)
                }
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .fullScreenCover(item: Binding(get: { reading.map { ReaderAt(index: $0) } }, set: { reading = $0?.index })) { at in
            if let detail {
                Reader(name: detail.book.name, pages: pages(detail), playalongs: playalongsBySetting(detail), defaultSound: detail.defaultSound,
                       editable: detail.book.isOwner, at: at.index)
            }
        }
    }

    private func list(_ detail: BookDetail) -> some View {
        let all = pages(detail)
        let shown = Set(all.filter { (!oftenPlayed || $0.tune.oftenPlayed == true) && (query.isEmpty || $0.tune.matches(query)) }.map(\.id))
        return List {
            ForEach(detail.sections) { section in
                let rows = all.enumerated().filter { $0.element.id.hasPrefix(section.id + "-") && shown.contains($0.element.id) }
                if !rows.isEmpty {
                    if case let .set(_, name, _) = section {
                        Section {
                            ForEach(rows, id: \.element.id) { index, page in row(page, index: index) }
                        } header: {
                            HStack(spacing: 8) { RepeatMark(); Text(name) }
                        }
                    } else {
                        ForEach(rows, id: \.element.id) { index, page in row(page, index: index) }
                    }
                }
            }
            if shown.isEmpty {
                Text(oftenPlayed ? "No tune here is marked often played." : "No tune called that.").foregroundStyle(Palette.text3)
            }
        }
        .searchable(text: $query, prompt: "Search this tunebook")
    }

    private func row(_ page: ReaderPage, index: Int) -> some View {
        Button { reading = index } label: {
            HStack(spacing: 12) {
                Text(page.tune.emoji ?? "🎵").font(.title3).opacity(page.tune.emoji == nil || page.tune.emoji == "🎵" ? 0.35 : 1).frame(width: 32)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(page.tune.displayTitle).font(.tuneTitle(.title3)).lineLimit(2)
                        if page.tune.oftenPlayed == true {
                            Image(systemName: "star.fill").font(.caption).foregroundStyle(Palette.brandDot).accessibilityLabel("Often played")
                        }
                    }
                    Text(page.tune.meta(groupedBy: .none)).font(.caption).foregroundStyle(Palette.text3)
                }
                Spacer(minLength: 8)
                AbilityMark(level: page.tune.practice.level)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    private func tunes(in section: BookSection) -> [SavedTune] {
        switch section {
        case let .tune(_, tune): [tune]
        case let .set(_, _, tunes): tunes
        }
    }

    private func pages(_ detail: BookDetail) -> [ReaderPage] {
        detail.sections.flatMap { section -> [ReaderPage] in
            switch section {
            case let .tune(entryId, tune): [ReaderPage(tune: tune, set: nil, id: "\(entryId)-\(tune.id)")]
            case let .set(entryId, name, tunes): tunes.map { ReaderPage(tune: $0, set: name, id: "\(entryId)-\($0.id)") }
            }
        }
    }

    private func playalongsBySetting(_ detail: BookDetail) -> [Int: [PlayalongTrack]] {
        Dictionary(uniqueKeysWithValues: detail.playalongs.compactMap { key, value in Int(key).map { ($0, value) } })
    }

    private func load() async {
        do {
            detail = try await library.api.get("api/app/books/\(summary.id)")
            problem = nil
            #if DEBUG
            // Screenshots: `-readAt 2` opens the reader at the third tune.
            if let i = ProcessInfo.processInfo.arguments.firstIndex(of: "-readAt"), reading == nil,
               let at = ProcessInfo.processInfo.arguments.dropFirst(i + 1).first.flatMap(Int.init) { reading = at }
            #endif
        } catch {
            if detail == nil { problem = error.localizedDescription }
        }
    }
}

struct ReaderAt: Identifiable { let index: Int; var id: Int { index } }
