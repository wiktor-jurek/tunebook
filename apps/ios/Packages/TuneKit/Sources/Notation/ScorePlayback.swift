// Plays a score natively, as the website's tune player does (apps/web/src/components/tune-player.tsx and
// lib/playalong-timing.ts): the notes through an instrument (FluidR3 samples, the same the website uses,
// fetched once and kept), or a play-along recording that follows the score; a bar of count-in clicks first
// if asked; the notes lit up as they play. Hand one to `AbcView(abc:style:playback:)`; the island's controls
// call it, and it publishes what it is doing.

import AVFoundation
import Foundation
import ListenCore
import Observation

public struct PlayalongTrack: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public let label: String
    public let url: String
    public let durationMs: Int
    public let bpm: Double?
    /// Recorded from another setting of the same tune in the same key: close enough to play along to.
    public let otherSetting: Bool
    /// Maps the recording onto the score, so the notes light up as it plays (absent for other settings).
    public let timing: Timing?

    public struct Timing: Codable, Hashable, Sendable {
        public let anchors: [[Double]]
        public let loop: Double?
    }
}

/// The sounds a score can be played with (the website's SOUND_OPTIONS).
public enum ScoreSound: Int, CaseIterable, Identifiable, Sendable {
    case whistle = 74, accordion = 21, flute = 73, piano = 0
    public var id: Int { rawValue }
    public var label: String {
        switch self {
        case .whistle: "Whistle-like, recorder"
        case .accordion: "Accordion"
        case .flute: "Flute"
        case .piano: "Piano"
        }
    }
}

@MainActor
@Observable
public final class ScorePlayback {
    public private(set) var playing = false
    public private(set) var loading = false
    /// A bar of clicks before the notes, when count-in is on.
    public private(set) var counting = false
    public private(set) var error: String?
    /// 0 to 100.
    public private(set) var progress: Double = 0
    public private(set) var speed = 100
    public private(set) var program = ScoreSound.whistle.rawValue
    public private(set) var track: PlayalongTrack?
    public var countIn = UserDefaults.standard.bool(forKey: "countIn") {
        didSet { UserDefaults.standard.set(countIn, forKey: "countIn") }
    }
    /// The notes sounding now, by the ids the score draws them with: lit up.
    public private(set) var playingNotes: Set<UInt32> = []

    /// Called before any sound plays, so the app can set its audio session (and not while it is recording).
    public var willPlay: () -> Void = {}

    let meter: String?
    private var abc: String?
    private var events: [ScoreEvent] = []
    /// The notes rendered, for the sound and speed they were rendered at.
    private var rendered: (key: String, buffer: AVAudioPCMBuffer)?
    /// Seconds into the tune (or the recording) where it stopped, to carry on from.
    private var offset: Double = 0
    /// Engine time the notes started from (after any count-in), while playing.
    private var startedAt: Double = 0
    private var token = 0
    private var ticker: Task<Void, Never>?
    private var recording: AVPlayer?
    private var recordingEnd: NSObjectProtocol?

    public init(meter: String?, defaultSound: Int? = nil) {
        self.meter = meter
        if let defaultSound, ScoreSound(rawValue: defaultSound) != nil { program = defaultSound }
    }

    /// The tempo you'd set a metronome to: the sound's crotchets a minute at this speed, in the meter's beat.
    public var bpm: Int {
        Int(((track?.bpm ?? 100) * Double(speed) / 100 / beat.crotchets).rounded())
    }

    public var soundName: String { track?.label ?? "Notes, \(ScoreSound(rawValue: program)?.label ?? "score")" }

    /// The score last started, anywhere in the app. One plays at a time: starting another pauses it, so a tune left
    /// playing behind a sheet, the reader or a fold never plays over the next.
    private static weak var started: ScorePlayback?

    /// Pauses whichever score is playing, anywhere: the microphone is about to listen, and would hear it.
    public static func pauseCurrent() { started?.pause() }

    /// The score it plays: its notes in playing order, from the notation engine.
    func load(_ abc: String) {
        guard abc != self.abc else { return }
        stop()
        self.abc = abc
        events = scoreTimeline(abc: abc)
        rendered = nil
        offset = 0
        progress = 0
    }

    public func toggle() {
        if counting {
            stop()
            return
        }
        if playing {
            pause()
            return
        }
        if let other = Self.started, other !== self { other.pause() }
        Self.started = self
        willPlay()
        play()
    }

    public func pause() {
        guard playing || counting else { return }
        offset = position
        stop()
    }

    public func seek(_ percent: Double) {
        let wasPlaying = playing
        if wasPlaying { stop() }
        offset = percent / 100 * duration
        progress = percent
        light()
        if wasPlaying { play(countingIn: false) }
    }

    public func setSpeed(_ value: Int) {
        guard value != speed else { return }
        let ratio = duration > 0 ? position / duration : 0
        let wasPlaying = playing
        if wasPlaying { stop() }
        speed = value
        if track == nil { offset = ratio * duration }
        recording?.rate = playing ? Float(value) / 100 : 0
        if wasPlaying { play(countingIn: false) }
    }

    public func setSound(_ program: Int) {
        let switching = track != nil
        let ratio = !switching && duration > 0 ? position / duration : 0
        let wasPlaying = playing
        if wasPlaying { stop() }
        self.program = program
        track = nil
        recording = nil
        offset = ratio * duration
        if switching { progress = 0 }
        if wasPlaying { play(countingIn: false) }
    }

    public func setTrack(_ track: PlayalongTrack) {
        let wasPlaying = playing
        if wasPlaying { stop() }
        self.track = track
        recording = nil
        offset = 0
        progress = 0
        if wasPlaying { play(countingIn: false) }
    }

    // MARK: Inside

    /// A bar's beats in the meter: dotted crotchets in 6/8, 9/8 and 12/8, otherwise the meter's own note.
    private var beat: (perBar: Int, crotchets: Double) {
        let parts = (meter ?? "4/4").split(separator: "/").compactMap { Double($0) }
        guard parts.count == 2, parts[0] > 0, parts[1] > 0 else { return (4, 1) }
        let compound = parts[1] == 8 && parts[0] > 3 && parts[0].truncatingRemainder(dividingBy: 3) == 0
        return compound ? (Int(parts[0] / 3), 1.5) : (Int(parts[0]), 4 / parts[1])
    }

    /// Seconds per whole note: the score plays at 100 crotchets a minute at 100% (Q:1/4=100).
    private var wholeSeconds: Double { 4 * 60 / (100 * Double(speed) / 100) }

    /// The whole sound's length, in seconds.
    private var duration: Double {
        if let track { return Double(track.durationMs) / 1000 }
        guard let last = events.last else { return 0 }
        return (last.start + last.duration) * wholeSeconds
    }

    /// Seconds into the sound now.
    private var position: Double {
        if let recording { return recording.currentTime().seconds.isFinite ? recording.currentTime().seconds : offset }
        guard playing, let time = Audio.shared.now else { return offset }
        return max(0, time - startedAt)
    }

    private func play(countingIn: Bool = true) {
        token += 1
        let token = token
        error = nil
        if let track {
            playRecording(track)
            return
        }
        loading = rendered?.key != renderKey
        Task {
            do {
                let buffer = try await render()
                guard token == self.token else { return }
                loading = false
                let clicks = countingIn && countIn && offset == 0 ? Audio.shared.clicks(beats: beat.perBar, seconds: 60 / (100 * Double(speed) / 100) * beat.crotchets) : nil
                counting = clicks != nil
                let lead = try Audio.shared.play(buffer, from: offset, after: clicks)
                startedAt = lead - offset
                playing = true
                tick(token)
            } catch {
                guard token == self.token else { return }
                loading = false
                counting = false
                self.error = "Some instrument notes could not be loaded"
            }
        }
    }

    private var renderKey: String { "\(program)-\(speed)" }

    /// The tune's notes mixed into one sound, as abcjs's synth primes its buffer.
    private func render() async throws -> AVAudioPCMBuffer {
        if let rendered, rendered.key == renderKey { return rendered.buffer }
        let samples = try await Samples.shared.load(program: program, notes: Set(events.flatMap(\.midi)))
        let buffer = Audio.shared.mix(events, samples: samples, wholeSeconds: wholeSeconds)
        rendered = (renderKey, buffer)
        return buffer
    }

    private func playRecording(_ track: PlayalongTrack) {
        guard let url = URL(string: track.url) else { return }
        let player = recording ?? {
            let item = AVPlayerItem(url: url)
            item.audioTimePitchAlgorithm = .timeDomain
            let made = AVPlayer(playerItem: item)
            if let recordingEnd { NotificationCenter.default.removeObserver(recordingEnd) }
            recordingEnd = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.finished() }
            }
            return made
        }()
        recording = player
        if offset > 0 { player.seek(to: CMTime(seconds: offset, preferredTimescale: 600)) }
        loading = true
        player.volume = Audio.volume
        player.playImmediately(atRate: Float(speed) / 100)
        playing = true
        tick(token)
    }

    /// Progress and the lit notes, a few dozen times a second while it plays.
    private func tick(_ token: Int) {
        ticker?.cancel()
        ticker = Task { [weak self] in
            while let self, token == self.token, !Task.isCancelled {
                if let recording {
                    if recording.timeControlStatus == .playing { loading = false }
                } else {
                    counting = (Audio.shared.now ?? 0) < startedAt + offset
                }
                let at = position
                if recording == nil, at >= duration {
                    finished()
                    return
                }
                let total = duration
                progress = total > 0 ? min(100, (at / total * 100).rounded()) : 0
                light(at)
                try? await Task.sleep(for: .milliseconds(33))
            }
        }
    }

    /// Lights the notes sounding at `at` seconds (by default, where it stands).
    private func light(_ at: Double? = nil) {
        let at = at ?? offset
        let whole: Double?
        if let track {
            // A recording maps onto the score through its timing (in 1/48ths of a whole note), as on the website.
            whole = track.timing.flatMap { Self.scorePosition($0, ms: at * 1000) }.map { $0 / 48 }
        } else {
            whole = playing || counting || offset > 0 ? at / wholeSeconds : nil
        }
        guard let whole else {
            if !playingNotes.isEmpty { playingNotes = [] }
            return
        }
        let now = Set(events.filter { $0.start <= whole + 1e-6 && whole < $0.start + $0.duration }.map(\.id))
        if now != playingNotes { playingNotes = now }
    }

    /// Where in the score a play-along is, `ms` into it; nil in its lead-in and after the tune ends.
    static func scorePosition(_ timing: PlayalongTrack.Timing, ms: Double) -> Double? {
        let anchors = timing.anchors.filter { $0.count >= 2 }
        guard anchors.count >= 2, ms >= anchors[0][0], ms <= anchors[anchors.count - 1][0] else { return nil }
        var i = 1
        while anchors[i][0] < ms { i += 1 }
        let from = anchors[i - 1], to = anchors[i]
        let span = to[0] - from[0]
        let position = from[1] + (span > 0 ? (to[1] - from[1]) * (ms - from[0]) / span : 0)
        guard position >= 0 else { return nil }
        if let loop = timing.loop, loop > 0 { return position.truncatingRemainder(dividingBy: loop) }
        return position
    }

    private func finished() {
        stop()
        offset = 0
        progress = 0
        playingNotes = []
    }

    private func stop() {
        token += 1
        ticker?.cancel()
        ticker = nil
        if let recording {
            offset = recording.currentTime().seconds.isFinite ? recording.currentTime().seconds : offset
            recording.pause()
        } else if playing || counting {
            Audio.shared.stop()
        }
        playing = false
        counting = false
        loading = false
    }
}

/// The one engine every score plays through (only one plays at a time).
@MainActor
final class Audio {
    static let shared = Audio()
    /// The device's own volume is the volume control; this leaves headroom for chords.
    static let volume: Float = 0.75
    static let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 2)!

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()

    private init() {
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: Self.format)
    }

    /// Engine seconds now, while it plays.
    var now: Double? {
        guard let node = player.lastRenderTime, let time = player.playerTime(forNodeTime: node) else { return nil }
        return Double(time.sampleTime) / time.sampleRate
    }

    /// Plays `buffer` from `from` seconds, after `clicks` if given; returns the engine time the notes start.
    func play(_ buffer: AVAudioPCMBuffer, from: Double, after clicks: AVAudioPCMBuffer?) throws -> Double {
        if !engine.isRunning {
            engine.prepare()
            try engine.start()
        }
        player.stop()
        var lead = 0.0
        if let clicks {
            player.scheduleBuffer(clicks)
            lead = Double(clicks.frameLength) / Self.format.sampleRate
        }
        let start = AVAudioFramePosition(from * Self.format.sampleRate)
        if let rest = buffer.slice(from: start) { player.scheduleBuffer(rest) }
        player.play()
        return lead
    }

    func stop() {
        player.stop()
    }

    /// The tune's notes mixed into one buffer: each sample cut to its note's length with a short release.
    func mix(_ events: [ScoreEvent], samples: [Int32: AVAudioPCMBuffer], wholeSeconds: Double) -> AVAudioPCMBuffer {
        let rate = Self.format.sampleRate
        let release = 0.08
        let end = (events.last.map { $0.start + $0.duration } ?? 0) * wholeSeconds + release + 0.2
        let frames = AVAudioFrameCount(max(1, end * rate))
        let out = AVAudioPCMBuffer(pcmFormat: Self.format, frameCapacity: frames)!
        out.frameLength = frames
        guard let outData = out.floatChannelData else { return out }
        for event in events where !event.midi.isEmpty {
            let gain = Self.volume / Float(event.midi.count).squareRoot()
            for midi in event.midi {
                guard let sample = samples[midi], let inData = sample.floatChannelData else { continue }
                let startFrame = Int(event.start * wholeSeconds * rate)
                let sounding = Int(event.duration * wholeSeconds * rate)
                let fade = Int(release * rate)
                let length = min(Int(sample.frameLength), sounding + fade, Int(frames) - startFrame)
                guard length > 0 else { continue }
                let channels = Int(sample.format.channelCount)
                for channel in 0..<2 {
                    let source = inData[min(channel, channels - 1)]
                    let target = outData[channel] + startFrame
                    for i in 0..<length {
                        let envelope: Float = i < sounding ? 1 : Float(length - i) / Float(max(1, length - sounding))
                        target[i] += source[i] * gain * envelope
                    }
                }
            }
        }
        return out
    }

    /// A bar of clicks, the first higher, `seconds` apart.
    func clicks(beats: Int, seconds: Double) -> AVAudioPCMBuffer {
        let rate = Self.format.sampleRate
        let frames = AVAudioFrameCount(max(1, (0.05 + Double(beats) * seconds) * rate))
        let out = AVAudioPCMBuffer(pcmFormat: Self.format, frameCapacity: frames)!
        out.frameLength = frames
        guard let data = out.floatChannelData else { return out }
        for beat in 0..<beats {
            let frequency = beat == 0 ? 1760.0 : 1320.0
            let start = Int((0.05 + Double(beat) * seconds) * rate)
            let length = Int(0.06 * rate)
            for i in 0..<length where start + i < Int(frames) {
                let t = Double(i) / rate
                let value = Float(sin(2 * .pi * frequency * t) * 0.5 * exp(-t * 60))
                data[0][start + i] = value
                data[1][start + i] = value
            }
        }
        return out
    }
}

/// The instruments' notes: FluidR3 samples (MIT), as the website's player fetches them, kept in Caches after the first time.
@MainActor
final class Samples {
    static let shared = Samples()
    nonisolated private static let base = "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/"
    private static let names = [0: "acoustic_grand_piano", 21: "accordion", 73: "flute", 74: "recorder"]
    private var decoded: [String: AVAudioPCMBuffer] = [:]

    /// The notes `notes` (MIDI) on `program`, fetched and decoded as needed.
    func load(program: Int, notes: Set<Int32>) async throws -> [Int32: AVAudioPCMBuffer] {
        let instrument = Self.names[program] ?? "recorder"
        var out: [Int32: AVAudioPCMBuffer] = [:]
        try await withThrowingTaskGroup(of: (Int32, URL).self) { group in
            for midi in notes where decoded["\(instrument)/\(midi)"] == nil {
                let name = Self.noteName(midi)
                group.addTask { (midi, try await Self.file(instrument: instrument, note: name)) }
            }
            for try await (midi, url) in group {
                decoded["\(instrument)/\(midi)"] = try Self.decode(url)
            }
        }
        for midi in notes { out[midi] = decoded["\(instrument)/\(midi)"] }
        return out
    }

    /// FluidR3's file names: C4, Db4, D4 … (flats).
    nonisolated static func noteName(_ midi: Int32) -> String {
        let names = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
        return "\(names[Int(midi) % 12])\(Int(midi) / 12 - 1)"
    }

    /// The sample's file, downloaded once into Caches.
    nonisolated private static func file(instrument: String, note: String) async throws -> URL {
        let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("Soundfont/\(instrument)", isDirectory: true)
        let local = folder.appendingPathComponent("\(note).mp3")
        if FileManager.default.fileExists(atPath: local.path) { return local }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        guard let remote = URL(string: "\(base)\(instrument)-mp3/\(note).mp3") else { throw URLError(.badURL) }
        let (data, response) = try await URLSession.shared.data(from: remote)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        try data.write(to: local, options: .atomic)
        return local
    }

    /// An MP3 sample as 44.1 kHz stereo floats, the mix's format.
    private static func decode(_ url: URL) throws -> AVAudioPCMBuffer {
        let file = try AVAudioFile(forReading: url)
        let read = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length))!
        try file.read(into: read)
        if file.processingFormat == Audio.format { return read }
        guard let converter = AVAudioConverter(from: file.processingFormat, to: Audio.format) else { throw URLError(.cannotDecodeContentData) }
        let ratio = Audio.format.sampleRate / file.processingFormat.sampleRate
        let out = AVAudioPCMBuffer(pcmFormat: Audio.format, frameCapacity: AVAudioFrameCount(Double(read.frameLength) * ratio) + 1024)!
        var fed = false
        var failure: NSError?
        converter.convert(to: out, error: &failure) { _, status in
            if fed {
                status.pointee = .endOfStream
                return nil
            }
            fed = true
            status.pointee = .haveData
            return read
        }
        if let failure { throw failure }
        return out
    }
}

private extension AVAudioPCMBuffer {
    /// The buffer from `start` frames on, as a buffer of its own.
    func slice(from start: AVAudioFramePosition) -> AVAudioPCMBuffer? {
        let begin = Int(max(0, start))
        let length = Int(frameLength) - begin
        guard length > 0, let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(length)),
              let from = floatChannelData, let to = out.floatChannelData else { return nil }
        out.frameLength = AVAudioFrameCount(length)
        for channel in 0..<Int(format.channelCount) {
            (to[channel]).update(from: from[channel] + begin, count: length)
        }
        return out
    }
}
