// The microphone, the Rust listen session and the model, run together. Audio arrives on the audio
// thread and goes straight into the session; once a second a serial queue takes the last 8 s,
// runs the model unless the room is quiet, and reports the decoder's answer.

import AVFoundation
import Foundation
import ListenCore

public enum ListenerEvent: Sendable {
    /// The input's RMS level, several times a second.
    case level(Float)
    /// The room is quiet; nothing was scored.
    case quiet
    /// The answer so far, with candidates as The Session tune IDs.
    case verdict(HeardVerdict)
    /// The model failed on a window.
    case failed(String)
}

public final class Listener: @unchecked Sendable {
    private let runner: ModelRunner
    private let model: FinderModel
    private let onEvent: @Sendable (ListenerEvent) -> Void
    private let engine = AVAudioEngine()
    private let scoring = DispatchQueue(label: "com.tunecompanion.listen.score", qos: .userInitiated)
    private var timer: DispatchSourceTimer?
    private var session: ListenSession?
    /// Every block of microphone audio, for recording the session to a file.
    public var onBuffer: (@Sendable (AVAudioPCMBuffer) -> Void)?
    /// The microphone's format, once listening has started.
    public private(set) var format: AVAudioFormat?

    public init(runner: ModelRunner, model: FinderModel, onEvent: @escaping @Sendable (ListenerEvent) -> Void) {
        self.runner = runner
        self.model = model
        self.onEvent = onEvent
    }

    /// Asks for the microphone if needed; false if the person said no.
    public static func requestPermission() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }

    public func start() throws {
        let audio = AVAudioSession.sharedInstance()
        // Measurement mode turns off voice processing (gain control, noise suppression), which would eat the music.
        try audio.setCategory(.record, mode: .measurement, options: [.allowBluetoothHFP])
        try audio.setActive(true)

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        let session = ListenSession(rate: UInt32(format.sampleRate), tuneIds: model.tuneIds, tunebooks: model.tunebooks,
                                    channels: UInt32(runner.channels))
        self.session = session
        self.format = format
        let onEvent = onEvent, onBuffer = onBuffer
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in
            onBuffer?(buffer)
            guard let channel = buffer.floatChannelData?[0] else { return }
            let samples = Array(UnsafeBufferPointer(start: channel, count: Int(buffer.frameLength)))
            onEvent(.level(session.pushAudio(samples: samples)))
        }
        engine.prepare()
        try engine.start()

        let timer = DispatchSource.makeTimerSource(queue: scoring)
        timer.schedule(deadline: .now() + .milliseconds(Int(hopMs())), repeating: .milliseconds(Int(hopMs())))
        timer.setEventHandler { [weak self] in self?.score() }
        timer.resume()
        self.timer = timer
    }

    public func stop() {
        timer?.cancel()
        timer = nil
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// Forget the answer so far, keeping the audio (a wrong answer, or a set moving on).
    public func reset() {
        scoring.async { [session] in session?.reset() }
    }

    private func score() {
        guard let session else { return }
        switch session.nextWindow() {
        case .empty:
            return
        case .quiet:
            onEvent(.quiet)
        case let .features(values):
            do {
                onEvent(.verdict(session.pushCosines(cosines: try runner.cosines(values))))
            } catch {
                onEvent(.failed(error.localizedDescription))
            }
        }
    }
}
