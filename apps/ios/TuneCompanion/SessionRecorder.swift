// A whole session recorded on the phone, as the web's use-recorder: the audio goes to an AAC file
// as it arrives (so a crash or a dead battery loses at most a moment), with its setlist beside it,
// and it uploads when the session stops. One that could not upload stays on the phone, and the
// Recordings tab lists it to try again or discard.

import API
import AVFoundation
import Foundation
import Observation

/// A recording kept on this phone until it has uploaded.
struct LocalRecording: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let recordedAt: Date
    var durationMs: Int
    var tunes: [SetlistEntry]
    var finished: Bool

    var audio: URL { SessionRecorder.folder.appending(path: "\(id).m4a") }
    var meta: URL { SessionRecorder.folder.appending(path: "\(id).json") }
}

/// Writes microphone audio to the recording's file. Called from the audio thread, so it locks.
final class SessionRecorder: @unchecked Sendable {
    static let folder = URL.applicationSupportDirectory.appending(path: "recordings", directoryHint: .isDirectory)
    /// The finder names a tune a few seconds after it starts; its setlist entry starts this much earlier.
    static let namingDelayMs = 8_000

    private let lock = NSLock()
    private var file: AVAudioFile?
    private var frames: AVAudioFramePosition = 0
    private var rate: Double = 48_000

    var isRecording: Bool { lock.withLock { file != nil } }

    /// How far into the recording it is, in ms.
    var elapsedMs: Int { lock.withLock { Int(Double(frames) / rate * 1000) } }

    func begin(_ recording: LocalRecording, format: AVAudioFormat) throws {
        try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
        let settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: format.sampleRate,
                                       AVNumberOfChannelsKey: format.channelCount, AVEncoderBitRateKey: 64_000 * Int(format.channelCount)]
        let file = try AVAudioFile(forWriting: recording.audio, settings: settings, commonFormat: format.commonFormat, interleaved: format.isInterleaved)
        lock.withLock {
            self.file = file
            frames = 0
            rate = format.sampleRate
        }
    }

    func write(_ buffer: AVAudioPCMBuffer) {
        lock.withLock {
            guard let file else { return }
            do {
                try file.write(from: buffer)
                frames += AVAudioFramePosition(buffer.frameLength)
            } catch {
                log.error("Recording write failed: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    /// Closes the file (which finishes it) and returns its length in ms.
    func end() -> Int {
        lock.withLock {
            let ms = Int(Double(frames) / rate * 1000)
            file = nil
            return ms
        }
    }
}

/// Recordings waiting on this phone, and the uploads in flight.
@MainActor
@Observable
final class RecordingUploads {
    enum Status: Equatable { case sending(Double), saving, done, failed(String) }

    private(set) var pending: [LocalRecording] = []
    private(set) var status: [String: Status] = [:]
    /// Bumped when an upload lands, so the list reloads.
    private(set) var landed = 0

    init() { reload() }

    func save(_ recording: LocalRecording) {
        try? FileManager.default.createDirectory(at: SessionRecorder.folder, withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(recording) { try? data.write(to: recording.meta, options: .atomic) }
        reload()
    }

    func reload() {
        let files = (try? FileManager.default.contentsOfDirectory(at: SessionRecorder.folder, includingPropertiesForKeys: nil)) ?? []
        pending = files.filter { $0.pathExtension == "json" }
            .compactMap { try? JSONDecoder().decode(LocalRecording.self, from: Data(contentsOf: $0)) }
            .filter(\.finished)
            .sorted { $0.recordedAt > $1.recordedAt }
    }

    func discard(_ recording: LocalRecording) {
        try? FileManager.default.removeItem(at: recording.audio)
        try? FileManager.default.removeItem(at: recording.meta)
        status[recording.id] = nil
        reload()
    }

    /// Create the row, PUT the audio to the bucket, then store the setlist.
    func upload(_ recording: LocalRecording, api: APIClient) async {
        if case .sending = status[recording.id] { return }
        status[recording.id] = .sending(0)
        do {
            guard FileManager.default.fileExists(atPath: recording.audio.path(percentEncoded: false)) else { throw RecordingFailure("Nothing was recorded") }
            let (id, url) = try await api.createRecording(name: recording.name, mime: "audio/mp4", recordedAt: recording.recordedAt)
            var put = URLRequest(url: url)
            put.httpMethod = "PUT"
            put.setValue("audio/mp4", forHTTPHeaderField: "Content-Type")
            let progress = UploadProgress { [weak self] sent in Task { @MainActor in self?.status[recording.id] = .sending(sent) } }
            let (_, response) = try await URLSession.shared.upload(for: put, fromFile: recording.audio, delegate: progress)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw RecordingFailure("The upload did not finish") }
            status[recording.id] = .saving
            try await api.finishRecording(id, durationMs: recording.durationMs, tunes: recording.tunes)
            status[recording.id] = .done
            try? FileManager.default.removeItem(at: recording.audio)
            try? FileManager.default.removeItem(at: recording.meta)
            try? await Task.sleep(for: .seconds(1.6))
            status[recording.id] = nil
            reload()
            landed += 1
        } catch {
            status[recording.id] = .failed((error as? LocalizedError)?.errorDescription ?? "The upload failed")
        }
    }

    private struct RecordingFailure: LocalizedError {
        let errorDescription: String?
        init(_ message: String) { errorDescription = message }
    }
}

private final class UploadProgress: NSObject, URLSessionTaskDelegate, Sendable {
    let report: @Sendable (Double) -> Void
    init(report: @escaping @Sendable (Double) -> Void) { self.report = report }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData _: Int64, totalBytesSent sent: Int64, totalBytesExpectedToSend total: Int64) {
        if total > 0 { report(Double(sent) / Double(total)) }
    }
}
