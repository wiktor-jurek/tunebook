// Keeping tunes: saving a The Session setting to your library, and building tunebooks and sets,
// through the same routes the website uses.

import Foundation

extension APIClient {
    /// Saves a setting to your library (or finds your copy) and returns the saved tune's ID.
    public func saveSetting(_ settingId: Int) async throws -> String {
        struct Body: Encodable { let settingId: Int }
        struct Answer: Decodable { let tuneId: String }
        return try await send(try request("api/catalog", method: "POST", body: Body(settingId: settingId)), as: Answer.self).tuneId
    }

    public func createBook(name: String) async throws -> String {
        struct Body: Encodable { let operation = "createBook", name: String }
        struct Answer: Decodable { let bookId: String }
        return try await send(try request("api/library", method: "POST", body: Body(name: name)), as: Answer.self).bookId
    }

    public func addToBook(bookId: String, tuneId: String) async throws {
        struct Body: Encodable { let operation = "addToBook", bookId: String, tuneId: String }
        struct Answer: Decodable { let ok: Bool? }
        _ = try await send(try request("api/library", method: "POST", body: Body(bookId: bookId, tuneId: tuneId)), as: Answer.self)
    }

    /// Groups tunes already in a book into a set, in this order.
    public func makeSet(bookId: String, tuneIds: [String]) async throws {
        struct Body: Encodable { let operation = "fromTunes", bookId: String, tuneIds: [String] }
        struct Answer: Decodable { let ok: Bool? }
        _ = try await send(try request("api/sets", method: "POST", body: Body(bookId: bookId, tuneIds: tuneIds)), as: Answer.self)
    }

    /// Saves each setting not yet in the library, then puts them all, in order, into a new tunebook (the web's
    /// makeTunebook). Each group of indexes into `settings` (tunes played back to back) becomes a set; a tune already
    /// in an earlier set stays there. Returns the new book's ID.
    public func makeTunebook(name: String, settings: [(settingId: Int, savedId: String?)], sets: [[Int]] = []) async throws -> String {
        var ids: [String] = [], savedIds: [String] = []
        for setting in settings {
            let id = if let saved = setting.savedId { saved } else { try await saveSetting(setting.settingId) }
            savedIds.append(id)
            if !ids.contains(id) { ids.append(id) }
        }
        let bookId = try await createBook(name: name)
        for id in ids { try await addToBook(bookId: bookId, tuneId: id) }
        var grouped = Set<String>()
        for set in sets {
            var tuneIds: [String] = []
            for index in set where !tuneIds.contains(savedIds[index]) && !grouped.contains(savedIds[index]) { tuneIds.append(savedIds[index]) }
            guard tuneIds.count >= 2 else { continue }
            try await makeSet(bookId: bookId, tuneIds: tuneIds)
            grouped.formUnion(tuneIds)
        }
        return bookId
    }
}
