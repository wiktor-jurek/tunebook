// Names the tunes in a real recording file the way Upload recording does (FileListener), with the shipped model. Needs
// files that are not in the repo, so it only runs when pointed at them:
//   FINDER_DIR        a folder with model.onnx, tunes.json and popularity.json (apps/web/public/finder)
//   FINDER_FILE       an audio file AVFoundation reads (m4a, mp3, wav...)
//   FINDER_FILE_TUNE  The Session tune ID the finder should name first
// Pass them to xcodebuild prefixed with TEST_RUNNER_ (see `just ios-recognise-file`).

import AVFoundation
import Foundation
import Testing
@testable import Finder

@Test(.enabled(if: ProcessInfo.processInfo.environment["FINDER_FILE"] != nil))
func namesTheTunesInAFile() throws {
    let env = ProcessInfo.processInfo.environment
    let folder = URL(filePath: env["FINDER_DIR"]!, directoryHint: .isDirectory)
    let ids = try JSONDecoder().decode([UInt32].self, from: Data(contentsOf: folder.appending(path: "tunes.json")))
    let books = (try? JSONDecoder().decode([UInt32].self, from: Data(contentsOf: folder.appending(path: "popularity.json")))) ?? []
    let model = FinderModel(modelURL: folder.appending(path: "model.onnx"), tuneIds: ids, tunebooks: books.count == ids.count ? books : [])
    let runner = try ModelRunner(modelURL: model.modelURL)
    let copy = URL.temporaryDirectory.appending(path: "\(UUID().uuidString).m4a")
    defer { try? FileManager.default.removeItem(at: copy) }

    let started = Date.now
    let result = try FileListener.nameTunes(in: URL(filePath: env["FINDER_FILE"]!), copyingTo: copy, runner: runner, model: model, progress: { _ in })
    print("named \(result.named.map { "\($0.tuneId) at \($0.atMs / 1000) s" }.joined(separator: ", ")) in \(result.durationMs / 1000) s of audio, took \(Int(Date.now.timeIntervalSince(started))) s")

    #expect(result.named.first?.tuneId == Int(env["FINDER_FILE_TUNE"]!)!)
    // The copy is the whole recording, as the session is kept and uploaded.
    let kept = try AVAudioFile(forReading: copy)
    #expect(abs(Double(kept.length) / kept.fileFormat.sampleRate * 1000 - Double(result.durationMs)) < 1000)
}
