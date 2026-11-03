// How the Tunes list is grouped, as the web's tune-groups.ts: by stage of learning (the default),
// key, type, tunebook, or not at all. The choice is remembered on this device.

import API
import Foundation

enum GroupBy: String, CaseIterable, Identifiable {
    case stage, key, type, book, none
    var id: String { rawValue }

    var label: String {
        switch self {
        case .stage: "Stage of learning"
        case .key: "Key"
        case .type: "Type"
        case .book: "Tunebook"
        case .none: "No grouping"
        }
    }

    var short: String {
        switch self {
        case .stage: "Stage"
        case .key: "Key"
        case .type: "Type"
        case .book: "Tunebook"
        case .none: "Ungrouped"
        }
    }
}

struct TuneGroup: Identifiable {
    let id: String
    let label: String
    let tunes: [SavedTune]
    var book: BookSummary?
}

extension FinderTune.Level {
    /// The progress scale's names (stored values keep their old ones).
    var label: String {
        switch self {
        case .unlearned: "Not assessed"
        case .wanted: "Want to learn"
        case .learning: "Learning"
        case .learned: "Can play along"
        case .mastered: "Can lead"
        }
    }

    /// Steps past Not assessed: Want to learn fills one bar, Can lead all four.
    var rank: Int { [.unlearned, .wanted, .learning, .learned, .mastered].firstIndex(of: self)! }
}

/// The Session writes keys as "Dmajor"; people read "D major".
func keyName(_ mode: String) -> String { mode.replacing(/^([A-G][#b]?)(?=[a-z])/) { "\($0.1) " } }

extension SavedTune {
    /// "The Silver Spear", as people say it.
    var displayTitle: String {
        guard let match = title.wholeMatch(of: /(.+), (The|A|An)/) else { return title }
        return "\(match.2) \(match.1)"
    }

    /// Type and key, less whichever the group's heading already says.
    func meta(groupedBy: GroupBy) -> String {
        // Types read capitalised, as the web's text-transform does: "Jig, G major".
        [groupedBy == .type ? nil : kind.map { $0.prefix(1).uppercased() + $0.dropFirst() }, groupedBy == .key ? nil : mode.map(keyName)]
            .compactMap { $0 }.joined(separator: ", ")
    }

    func matches(_ query: String) -> Bool {
        let words = query.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil).split(separator: " ")
        let text = [displayTitle, title, kind ?? "", mode.map(keyName) ?? ""].joined(separator: " ")
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
        return words.allSatisfy { text.contains($0) }
    }
}

/// Splits tunes into labelled groups in a fixed order; tunes keep their order within each group. By tunebook, a tune
/// is in the group of every book it is in, and tunes in none come last.
func groupTunes(_ tunes: [SavedTune], by: GroupBy, books: [BookSummary]) -> [TuneGroup] {
    switch by {
    case .none:
        return tunes.isEmpty ? [] : [TuneGroup(id: "all", label: "", tunes: tunes)]
    case .book:
        let inBooks = Set(books.flatMap { $0.tuneIds ?? [] })
        var groups = books.map { book in
            let ids = Set(book.tuneIds ?? [])
            return TuneGroup(id: book.id, label: book.name, tunes: tunes.filter { ids.contains($0.id) }, book: book)
        }
        groups.append(TuneGroup(id: "none", label: "Not in a tunebook", tunes: tunes.filter { !inBooks.contains($0.id) }))
        return groups.filter { !$0.tunes.isEmpty }
    case .stage, .key, .type:
        var order: [String] = [], labels: [String: String] = [:], members: [String: [SavedTune]] = [:]
        for tune in tunes {
            let (key, label): (String, String) = switch by {
            case .stage: (tune.practice.level.rawValue, tune.practice.level.label)
            case .key: tune.mode.map { ($0, keyName($0)) } ?? ("", "No key")
            default: tune.kind.map { ($0.lowercased(), $0.prefix(1).uppercased() + $0.dropFirst()) } ?? ("", "Other")
            }
            if members[key] == nil { order.append(key); labels[key] = label }
            members[key, default: []].append(tune)
        }
        // Stages go from what you can play to what you haven't started; keys and types alphabetically, with none last.
        let stages: [FinderTune.Level] = [.mastered, .learned, .learning, .wanted, .unlearned]
        func rank(_ key: String) -> String {
            by == .stage ? String(stages.firstIndex { $0.rawValue == key } ?? 9) : key.isEmpty ? "1" : "0\(labels[key]!)"
        }
        return order.sorted { rank($0) < rank($1) }.map { TuneGroup(id: $0, label: labels[$0]!, tunes: members[$0]!) }
    }
}
