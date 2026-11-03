// A tune as the finder shows it: /api/finder's answer for a heard tune ID.

import Foundation

public struct FinderTune: Codable, Hashable, Sendable, Identifiable {
    public let tuneId: Int
    public let settingId: Int?
    /// As The Session files it ("Silver Spear, The"); show `displayTitle`.
    public let title: String
    public let kind: String?
    public let meter: String?
    public let mode: String?
    /// The setting's ABC body: yours if you saved one, else The Session's first.
    public let abc: String?
    /// Member tunebooks on The Session holding it: how popular it is.
    public let tunebooks: Int?
    /// Where it stands for the signed-in person ("unlearned" for guests).
    public var level: Level?
    public var savedId: String?
    public let inBooks: [Book]?

    public enum Level: String, Codable, Sendable {
        case unlearned, wanted, learning, learned, mastered
    }

    public struct Book: Codable, Hashable, Sendable {
        public let id: String
        public let name: String
    }

    /// Can play along or can lead.
    public var isKnown: Bool { level == .learned || level == .mastered }

    /// Where a named tune stands, said in full: "You can lead this one. It's in Madrid Session."
    public var standingSentence: String {
        let ability: String? = switch level {
        case .learning: "You're learning this one."
        case .learned: "You can play along with this one."
        case .mastered: "You can lead this one."
        default: nil
        }
        let books = inBooks ?? []
        let where_: String? = books.count == 1 ? "It's in \(books[0].name)." : books.count > 1 ? "It's in \(books.count) of your tunebooks."
            : savedId != nil && (level ?? .unlearned) == .unlearned ? "It's in your library." : nil
        return [ability, where_].compactMap { $0 }.joined(separator: " ")
    }

    public var id: Int { tuneId }

    /// "The Silver Spear", as people say it.
    public var displayTitle: String {
        guard let match = title.wholeMatch(of: /(.+), (The|A|An)/) else { return title }
        return "\(match.2) \(match.1)"
    }

    /// "Reel, D major".
    public var meta: String {
        [kind.map { $0.prefix(1).uppercased() + $0.dropFirst() }, mode.map(Self.keyName)]
            .compactMap { $0 }.joined(separator: ", ")
    }

    /// The Session writes keys as "Dmajor" or "Adorian"; people read "D major".
    static func keyName(_ mode: String) -> String {
        mode.replacing(/^([A-G][#b]?)(?=[a-z])/) { "\($0.1) " }
    }
}

extension APIClient {
    /// Names for heard tune IDs (at most 20).
    public func finderTunes(ids: [Int]) async throws -> [FinderTune] {
        // Signed in, the answer says where each tune stands for you (level, library, tunebooks).
        let request = try request("api/finder", query: [URLQueryItem(name: "ids", value: ids.prefix(20).map(String.init).joined(separator: ","))])
        return try await send(request, as: Answer.self).tunes
    }

    /// Tunes on The Session by name, for a tune someone calls out; ranked as on the web.
    public func searchTunes(_ query: String) async throws -> [FinderTune] {
        try await send(try request("api/finder", query: [URLQueryItem(name: "q", value: query)]), as: Answer.self).tunes
    }

    private struct Answer: Decodable { let tunes: [FinderTune] }
}
