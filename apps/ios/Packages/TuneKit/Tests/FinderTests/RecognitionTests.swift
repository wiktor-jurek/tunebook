// Names a real recording with the shipped model, the way the phone does: 1 s blocks of 48 kHz
// audio into the Rust session, the model on each window, the decoder's answer. Needs files that
// are not in the repo, so it only runs when pointed at them:
//   FINDER_DIR    a folder with model.onnx, tunes.json and popularity.json (apps/web/public/finder)
//   FINDER_CLIP   mono 48 kHz little-endian float32 audio (ffmpeg -ac 1 -ar 48000 -f f32le)
//   FINDER_TUNE   the clip's The Session tune ID
// Pass them to xcodebuild prefixed with TEST_RUNNER_ (see `just ios-recognise`).

import Foundation
import Testing
@testable import Finder
import ListenCore

@Test(.enabled(if: ProcessInfo.processInfo.environment["FINDER_CLIP"] != nil))
func namesARealRecording() throws {
    let env = ProcessInfo.processInfo.environment
    let folder = URL(filePath: env["FINDER_DIR"]!, directoryHint: .isDirectory)
    let ids = try JSONDecoder().decode([UInt32].self, from: Data(contentsOf: folder.appending(path: "tunes.json")))
    let books = (try? JSONDecoder().decode([UInt32].self, from: Data(contentsOf: folder.appending(path: "popularity.json")))) ?? []
    let model = FinderModel(modelURL: folder.appending(path: "model.onnx"), tuneIds: ids, tunebooks: books.count == ids.count ? books : [])
    let loading = Date.now
    let runner = try ModelRunner(modelURL: model.modelURL)
    print("model loaded in \(Int(Date.now.timeIntervalSince(loading) * 1000)) ms, \(runner.channels) channels")

    let raw = try Data(contentsOf: URL(filePath: env["FINDER_CLIP"]!))
    let audio = raw.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
    let expected = UInt32(env["FINDER_TUNE"]!)!
    let session = ListenSession(rate: 48_000, tuneIds: model.tuneIds, tunebooks: model.tunebooks, channels: UInt32(runner.channels))

    var answer: (second: Int, tune: UInt32)?
    var milliseconds: [Double] = []
    for second in 0..<(audio.count / 48_000) {
        _ = session.pushAudio(samples: Array(audio[(second * 48_000)..<((second + 1) * 48_000)]))
        guard case let .features(values) = session.nextWindow() else { continue }
        let started = Date.now
        let verdict = session.pushCosines(cosines: try runner.cosines(values))
        milliseconds.append(Date.now.timeIntervalSince(started) * 1000)
        print("second \(second + 1): \(verdict.status), leader \(verdict.candidates.first?.tuneId ?? 0), margin \(String(format: "%.3f", verdict.margin))")
        if verdict.status == .match, answer == nil { answer = (second + 1, verdict.candidates[0].tuneId) }
    }
    print("named \(answer.map { "\($0.tune) after \($0.second) s" } ?? "nothing"), median window \(Int(milliseconds.sorted()[milliseconds.count / 2])) ms")
    #expect(answer?.tune == expected)
}
