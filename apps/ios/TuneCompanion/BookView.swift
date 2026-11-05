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
                Reader(book: ReaderBook(detail: detail), at: at.index)
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

/// A list the reader turns through: a tunebook, or all your tunes.
struct ReaderBook {
    /// The tunebook's ID; nil for all your tunes.
    let id: String?
    let name: String
    let pages: [ReaderPage]
    /// Play-alongs by setting ID, when the list already has them (a tunebook); otherwise each page fetches its own.
    var playalongs: [Int: [PlayalongTrack]]?
    var defaultSound: Int?
    /// Whether progress can be set: the tunes are yours.
    var editable = true
    /// The list's headings, in order, each over a run of pages: your tunes' groups, or a tunebook's sets. Empty: one run.
    var sections: [Section] = []

    struct Section: Identifiable {
        let title: String?
        let pages: Range<Int>
        var id: Int { pages.lowerBound }
    }

    /// The headings, or the whole list under none.
    var runs: [Section] { sections.isEmpty ? [Section(title: nil, pages: 0..<pages.count)] : sections }

    /// A tunebook, fetched.
    static func load(_ summary: BookSummary, api: APIClient) async throws -> ReaderBook {
        ReaderBook(detail: try await api.get("api/app/books/\(summary.id)"))
    }

    /// All your tunes, in the order the Tunes list shows them, under its headings.
    @MainActor static func yourTunes(_ library: LibraryStore, groupedBy groupBy: GroupBy) -> ReaderBook {
        let groups = groupTunes(library.tunes, by: groupBy, books: library.books)
        var pages: [ReaderPage] = []
        var sections: [Section] = []
        for group in groups {
            let start = pages.count
            pages += group.tunes.map { ReaderPage(tune: $0, set: nil, id: "\(group.id)-\($0.id)") }
            sections.append(Section(title: group.label.isEmpty ? nil : group.label, pages: start..<pages.count))
        }
        return ReaderBook(id: nil, name: "Tunes", pages: pages, sections: sections)
    }
}

extension ReaderBook {
    /// A tunebook: its tunes in playing order, each set under its name.
    fileprivate init(detail: BookDetail) {
        var pages: [ReaderPage] = []
        var sections: [Section] = []
        for section in detail.sections {
            let start = pages.count
            switch section {
            case let .tune(entryId, tune):
                pages.append(ReaderPage(tune: tune, set: nil, id: "\(entryId)-\(tune.id)"))
                // Single tunes in a row share one run without a heading.
                if let last = sections.last, last.title == nil, last.pages.upperBound == start {
                    sections[sections.count - 1] = Section(title: nil, pages: last.pages.lowerBound..<pages.count)
                } else {
                    sections.append(Section(title: nil, pages: start..<pages.count))
                }
            case let .set(entryId, name, tunes):
                pages += tunes.map { ReaderPage(tune: $0, set: name, id: "\(entryId)-\($0.id)") }
                sections.append(Section(title: name, pages: start..<pages.count))
            }
        }
        self.init(id: detail.book.id, name: detail.book.name, pages: pages,
                  playalongs: Dictionary(uniqueKeysWithValues: detail.playalongs.compactMap { key, value in Int(key).map { ($0, value) } }),
                  defaultSound: detail.defaultSound, editable: detail.book.isOwner, sections: sections)
    }
}
