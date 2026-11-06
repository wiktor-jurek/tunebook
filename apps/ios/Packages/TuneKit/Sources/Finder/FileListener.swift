// A recording picked from Files (the phone's own recorder, or anything AVFoundation can read), listened through as the
// live finder would have heard it at the session: the Rust listen session takes it a second at a time, and from 3 s in
// each second's last 8 s is scored, as the web's worker does. On the way it is copied to a mono AAC file, the format a
// session recorded in the app is kept and uploaded in.

import AVFoundation
import Foundation
import ListenCore

public enum FileListener {
    public struct Named: Sendable, Equatable {
        /// The Session's tune ID.
        public let tuneId: Int
        /// How far into the recording the finder named it.
        public let atMs: Int
    }

    public struct Result: Sendable {
        public let durationMs: Int
        public let named: [Named]
    }

    public struct Unreadable: LocalizedError {
        public var errorDescription: String? { "This file could not be read as audio" }
    }

    /// Reads `source`, writes it to `copy` as mono AAC, and names its tunes. `progress` is 0 to 1. Slow (a model run
    /// per second of audio): call it off the main thread. `isCancelled` is checked once a second.
    public static func nameTunes(in source: URL, copyingTo copy: URL, runner: ModelRunner, model: FinderModel,
                                 progress: @Sendable (Double) -> Void, isCancelled: @Sendable () -> Bool = { false }) throws -> Result {
        let input: AVAudioFile
        do { input = try AVAudioFile(forReading: source) } catch { throw Unreadable() }
        let rate = input.processingFormat.sampleRate
        let channels = Int(input.processingFormat.channelCount)
        guard rate > 0, channels > 0, input.length > 0,
              let mono = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false),
              let block = AVAudioPCMBuffer(pcmFormat: input.processingFormat, frameCapacity: AVAudioFrameCount(rate)),
              let monoBlock = AVAudioPCMBuffer(pcmFormat: mono, frameCapacity: AVAudioFrameCount(rate)) else { throw Unreadable() }
        // The AAC encoder takes up to 48 kHz; a higher-rate file is stored at its own rate only if the encoder allows it.
        let settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: rate, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 64_000]
        let output = try AVAudioFile(forWriting: copy, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)

        let session = ListenSession(rate: UInt32(rate), tuneIds: model.tuneIds, tunebooks: model.tunebooks, channels: UInt32(runner.channels))
        var named: [Named] = []
        var second = 0
        let total = Double(input.length)
        while input.framePosition < input.length {
            if isCancelled() { throw CancellationError() }
            do { try input.read(into: block, frameCount: AVAudioFrameCount(rate)) } catch { throw Unreadable() }
            let frames = Int(block.frameLength)
            guard frames > 0, let data = block.floatChannelData, let out = monoBlock.floatChannelData?[0] else { break }
            for i in 0..<frames {
                var sum: Float = 0
                for c in 0..<channels { sum += data[c][i] }
                out[i] = sum / Float(channels)
            }
            monoBlock.frameLength = AVAudioFrameCount(frames)
            try output.write(from: monoBlock)
            _ = session.pushAudio(samples: Array(UnsafeBufferPointer(start: out, count: frames)))
            // Only whole seconds are scored, as the live finder scores once a second.
            guard frames == Int(rate) else { break }
            second += 1
            if second >= 3, case let .features(values) = session.nextWindow() {
                let verdict = session.pushCosines(cosines: try runner.cosines(values))
                if verdict.status == .match, let leader = verdict.candidates.first.map({ Int($0.tuneId) }), named.last?.tuneId != leader {
                    named.append(Named(tuneId: leader, atMs: second * 1000))
                }
            }
            progress(Double(input.framePosition) / total)
        }
        return Result(durationMs: Int(total / rate * 1000), named: named)
    }
}
