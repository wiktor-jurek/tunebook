// Me: your passport as a player, from /api/app/me (the web's lib/passport.ts). Who you are in a line, the Standards
// (the 100 tunes every session knows, with where you stand with each), your stamps, your tunes by type and key, where
// they sit between the standards and the rarities, your favourites and your sessions.

import Foundation

public struct Passport: Decodable, Sendable {
    public struct User: Decodable, Sendable {
        public let id: String
        public let name: String
        public let email: String
        /// ISO 8601.
        public let memberSince: String?
    }
    public struct Repertoire: Decodable, Sendable {
        public let tunes: Int
        public let playable: Int
        public let tunebooks: Int
    }
    public struct TypeCount: Decodable, Sendable, Hashable { public let kind: String; public let total: Int; public let playable: Int }
    public struct KeyCount: Decodable, Sendable, Hashable { public let mode: String; public let total: Int }
    public struct Band: Decodable, Sendable, Hashable { public let band: Int; public let label: String; public let tunes: Int; public let playable: Int }
    public struct Rarest: Decodable, Sendable { public let id: String; public let title: String; public let band: Int }
    public struct Popularity: Decodable, Sendable { public let bands: [Band]; public let rarest: Rarest? }
    public struct Persona: Decodable, Sendable { public let title: String; public let line: String }
    public struct Personas: Decodable, Sendable { public let type: Persona?; public let popularity: Persona? }
    /// One of your favourites: the saved tune itself, and why it is a favourite.
    public struct Favourite: Decodable, Sendable, Identifiable {
        public let tune: SavedTune
        public let starred: Int
        public let heard: Int
        public var id: String { tune.id }
        enum CodingKeys: String, CodingKey { case starred, heard }
        public init(from decoder: Decoder) throws {
            tune = try SavedTune(from: decoder)
            let container = try decoder.container(keyedBy: CodingKeys.self)
            starred = try container.decodeIfPresent(Int.self, forKey: .starred) ?? 0
            heard = try container.decodeIfPresent(Int.self, forKey: .heard) ?? 0
        }
    }
    public struct MostHeard: Decodable, Sendable { public let tuneId: Int; public let title: String; public let times: Int }
    public struct Month: Decodable, Sendable, Hashable { public let month: String; public let sessions: Int; public let minutes: Int }
    public struct BiggestNight: Decodable, Sendable { public let id: String; public let recordedAt: String; public let tunes: Int }
    public struct Sessions: Decodable, Sendable {
        public let recordings: Int
        public let minutes: Int
        public let tunesHeard: Int
        public let mostHeard: MostHeard?
        public let byMonth: [Month]?
        public let biggestNight: BiggestNight?
    }
    public struct Standard: Decodable, Sendable, Hashable, Identifiable {
        public let tuneId: Int
        public let title: String
        public let kind: String?
        public let level: FinderTune.Level?
        public let savedId: String?
        public var id: Int { tuneId }
    }
    public struct Standards: Decodable, Sendable { public let tunes: [Standard]; public let total: Int; public let playable: Int; public let learning: Int }
    public struct Progress: Decodable, Sendable, Hashable { public let have: Int; public let need: Int }
    public struct Stamp: Decodable, Sendable, Hashable, Identifiable {
        public let id: String
        public let title: String
        public let line: String
        public let earned: Bool
        public let at: String?
        public let progress: Progress?
    }

    public let user: User
    public let repertoire: Repertoire
    public let types: [TypeCount]
    public let keys: [KeyCount]
    public let popularity: Popularity
    public let personas: Personas
    public let favourites: [Favourite]
    public let sessions: Sessions
    /// "A jig person who digs deep cuts."
    public let headline: String?
    public let standards: Standards?
    public let stamps: [Stamp]?
}

extension APIClient {
    public func passport() async throws -> Passport {
        try await send(try request("api/app/me"), as: Passport.self)
    }
}
