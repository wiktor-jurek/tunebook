// The signed-in person's library, as /api/app/library answers it: every saved tune with where it
// stands, their tunebooks (with the tunes in each) and books shared with them.

import Foundation

public struct Practice: Codable, Hashable, Sendable {
    public let level: FinderTune.Level
    public let playableTempo: Int?
    public let levelOverride: FinderTune.Level?
}

public struct SavedTune: Codable, Hashable, Sendable, Identifiable {
    /// The saved copy's ID (a tunebook entry refers to this).
    public let id: String
    /// The Session's tune ID.
    public let tuneId: Int
    public let settingId: Int
    public let title: String
    public let emoji: String?
    public let kind: String?
    public let meter: String?
    public let mode: String?
    public let abc: String
    public var practice: Practice
    /// In a tunebook: often played at that book's session.
    public let oftenPlayed: Bool?
}

public struct BookSummary: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let emoji: String?
    /// Saved tune IDs, in playing order (only for your own books).
    public let tuneIds: [String]?
}

public struct Library: Codable, Sendable {
    public let user: SignedInUser
    public let tunes: [SavedTune]
    public let books: [BookSummary]
    public let sharedBooks: [BookSummary]
}

extension APIClient {
    public func library() async throws -> Library {
        try await send(try request("api/app/library"))
    }
}

extension APIClient {
    /// Any signed-in GET that answers JSON, for the app's own routes.
    public func get<T: Decodable>(_ path: String, as type: T.Type = T.self) async throws -> T {
        try await send(try request(path))
    }

    /// Sets where a saved tune stands; `nil` goes back to judging it from your recorded speed.
    public func setLevel(tuneId: String, level: FinderTune.Level?) async throws -> Practice {
        struct Body: Encodable { let operation = "level", level: FinderTune.Level? }
        struct Answer: Decodable { let practice: Practice }
        var request = try request("api/tunes/\(tuneId)/practice", method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // `level: null` must be sent, not left out.
        request.httpBody = level == nil ? Data(#"{"operation":"level","level":null}"#.utf8) : try JSONEncoder().encode(Body(level: level))
        return try await send(request, as: Answer.self).practice
    }
}

/// A tunebook's entries in playing order: single tunes, and sets played one after another.
public enum BookSection: Decodable, Hashable, Sendable, Identifiable {
    case tune(entryId: String, tune: SavedTune)
    case set(entryId: String, name: String, tunes: [SavedTune])

    public var id: String {
        switch self { case let .tune(entryId, _), let .set(entryId, _, _): entryId }
    }

    private enum Keys: String, CodingKey { case kind, entryId, tune, name, tunes }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        let entryId = try c.decode(String.self, forKey: .entryId)
        if try c.decode(String.self, forKey: .kind) == "set" {
            self = .set(entryId: entryId, name: try c.decode(String.self, forKey: .name), tunes: try c.decode([SavedTune].self, forKey: .tunes))
        } else {
            self = .tune(entryId: entryId, tune: try c.decode(SavedTune.self, forKey: .tune))
        }
    }
}
