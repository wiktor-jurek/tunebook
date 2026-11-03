// Session recordings: uploading one (create its row, PUT the audio to the bucket, store the
// setlist), and listing, playing back and tidying the ones uploaded.

import Foundation

public struct RecordingSummary: Decodable, Identifiable, Hashable, Sendable {
    public let id: String
    /// The day it was recorded ("Tuesday 3 November").
    public let title: String
    public let recordedAt: String
    public let durationMs: Int?
    public let tunes: Int
    public let firstTunes: [String]
}

public struct RecordingDetail: Decodable, Sendable {
    public struct Entry: Decodable, Identifiable, Hashable, Sendable {
        public let id: String
        public let tuneId: Int
        public let settingId: Int
        public let startMs: Int
        public let endMs: Int
        public let title: String
        public let kind: String?
        public let meter: String?
        public let mode: String?
        public let abc: String
        public let practice: Practice
        public let savedId: String?
    }

    public let id: String
    public let title: String
    public let recordedAt: String
    public let durationMs: Int?
    public let audioUrl: String?
    public let tunes: [Entry]
}

/// One tune in a recording's setlist, as it is uploaded.
public struct SetlistEntry: Codable, Hashable, Sendable {
    public let tuneId: Int
    public let settingId: Int
    public let title: String
    public var startMs: Int
    public var endMs: Int
    /// Swiped away as wrong: it uploads anyway, as a labelled mistake for the finder to learn from.
    public var rejected: Bool

    public init(tuneId: Int, settingId: Int, title: String, startMs: Int, endMs: Int, rejected: Bool = false) {
        self.tuneId = tuneId
        self.settingId = settingId
        self.title = title
        self.startMs = startMs
        self.endMs = endMs
        self.rejected = rejected
    }
}

extension APIClient {
    public func recordings() async throws -> [RecordingSummary] {
        struct Answer: Decodable { let recordings: [RecordingSummary] }
        return try await send(try request("api/app/recordings"), as: Answer.self).recordings
    }

    public func recording(_ id: String) async throws -> RecordingDetail {
        struct Answer: Decodable { let recording: RecordingDetail }
        return try await send(try request("api/app/recordings/\(id)"), as: Answer.self).recording
    }

    /// Starts an upload: the server makes the (hidden) row and answers with where to PUT the audio.
    public func createRecording(name: String, mime: String, recordedAt: Date) async throws -> (id: String, uploadUrl: URL) {
        struct Body: Encodable { let name: String, mime: String, recordedAt: String }
        struct Answer: Decodable { let id: String, uploadUrl: String }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let answer = try await send(try request("api/recordings", method: "POST", body: Body(name: name, mime: mime, recordedAt: iso.string(from: recordedAt))),
                                    as: Answer.self)
        guard let url = URL(string: answer.uploadUrl) else { throw APIError.server(status: 0, message: "Could not start the upload") }
        return (answer.id, url)
    }

    /// Shows the uploaded recording, with its setlist.
    public func finishRecording(_ id: String, durationMs: Int, tunes: [SetlistEntry]) async throws {
        struct Tune: Encodable { let tuneId: Int, settingId: Int, startMs: Int, endMs: Int, rejected: Bool }
        struct Body: Encodable { let operation = "finish", durationMs: Int, tunes: [Tune] }
        struct Answer: Decodable { let ok: Bool? }
        let body = Body(durationMs: durationMs, tunes: tunes.map { Tune(tuneId: $0.tuneId, settingId: $0.settingId, startMs: $0.startMs, endMs: $0.endMs, rejected: $0.rejected) })
        _ = try await send(try request("api/recordings/\(id)", method: "PATCH", body: body), as: Answer.self)
    }

    /// Takes a tune off a recording's setlist (it stays, marked, as training data).
    public func removeRecordingTune(_ id: String, entryId: String) async throws {
        struct Body: Encodable { let operation = "removeTune", entryId: String }
        struct Answer: Decodable { let ok: Bool? }
        _ = try await send(try request("api/recordings/\(id)", method: "PATCH", body: Body(entryId: entryId)), as: Answer.self)
    }

    public func deleteRecording(_ id: String) async throws {
        struct Answer: Decodable { let ok: Bool? }
        _ = try await send(try request("api/recordings/\(id)", method: "DELETE"), as: Answer.self)
    }
}
