// The tune finder's model and tune list, the same files the website loads from /finder/. Kept in
// Application Support after the first download (about 36 MB), and refreshed in the background when
// the server's model changes, taking effect at the next launch.

import Foundation

public struct FinderModel: Sendable {
    public let modelURL: URL
    /// tunes.json: The Session tune ID for each of the model's outputs.
    public let tuneIds: [UInt32]
    /// popularity.json in the same order, or empty.
    public let tunebooks: [UInt32]
}

public actor FinderAssets {
    public static let production = FinderAssets(base: URL(string: "https://tunecompanion.com/finder/")!)

    private let base: URL
    private let folder: URL
    private let defaults = UserDefaults.standard
    private static let versionKey = "finder.model.etag"

    public init(base: URL) {
        self.base = base
        folder = URL.applicationSupportDirectory.appending(path: "finder", directoryHint: .isDirectory)
    }

    /// The cached model, or a fresh download reporting progress from 0 to 1.
    public func load(progress: @escaping @Sendable (Double) -> Void) async throws -> FinderModel {
        if let cached = try? read() {
            Task { await refreshIfChanged() }
            return cached
        }
        try await download(into: folder, progress: progress)
        return try read()
    }

    private func read() throws -> FinderModel {
        let model = folder.appending(path: "model.onnx")
        guard FileManager.default.fileExists(atPath: model.path(percentEncoded: false)) else { throw CocoaError(.fileNoSuchFile) }
        let ids = try JSONDecoder().decode([UInt32].self, from: Data(contentsOf: folder.appending(path: "tunes.json")))
        let books = (try? JSONDecoder().decode([UInt32].self, from: Data(contentsOf: folder.appending(path: "popularity.json")))) ?? []
        return FinderModel(modelURL: model, tuneIds: ids, tunebooks: books.count == ids.count ? books : [])
    }

    private func download(into target: URL, progress: @escaping @Sendable (Double) -> Void) async throws {
        let staging = FileManager.default.temporaryDirectory.appending(path: "finder-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
        for name in ["tunes.json", "popularity.json"] {
            let (data, response) = try await URLSession.shared.data(from: base.appending(path: name))
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                if name == "popularity.json" { continue } // optional, as on the web
                throw URLError(.badServerResponse)
            }
            try data.write(to: staging.appending(path: name))
        }
        let (file, response) = try await URLSession.shared.download(from: base.appending(path: "model.onnx"), delegate: Progress(report: progress))
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw URLError(.badServerResponse) }
        try FileManager.default.moveItem(at: file, to: staging.appending(path: "model.onnx"))
        // Swap the whole folder at once, so the model and tune list always come from the same export.
        try? FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        if FileManager.default.fileExists(atPath: target.path(percentEncoded: false)) {
            _ = try FileManager.default.replaceItemAt(target, withItemAt: staging)
        } else {
            try FileManager.default.moveItem(at: staging, to: target)
        }
        defaults.set(http.value(forHTTPHeaderField: "ETag"), forKey: Self.versionKey)
    }

    /// Downloads a new export in the background if the server's model has changed.
    private func refreshIfChanged() async {
        var request = URLRequest(url: base.appending(path: "model.onnx"))
        request.httpMethod = "HEAD"
        guard let (_, response) = try? await URLSession.shared.data(for: request),
              let etag = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "ETag"),
              etag != defaults.string(forKey: Self.versionKey) else { return }
        try? await download(into: folder, progress: { _ in })
    }

    private final class Progress: NSObject, URLSessionDownloadDelegate, Sendable {
        let report: @Sendable (Double) -> Void
        init(report: @escaping @Sendable (Double) -> Void) { self.report = report }

        func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData _: Int64,
                        totalBytesWritten written: Int64, totalBytesExpectedToWrite expected: Int64) {
            if expected > 0 { report(Double(written) / Double(expected)) }
        }

        func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {}
    }
}
