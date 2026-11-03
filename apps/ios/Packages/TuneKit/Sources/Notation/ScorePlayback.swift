// Plays a score drawn by AbcView, through the website's player (Resources/score-player.js) running
// beside abcjs: the notes through an instrument, or a play-along recording that follows the score.
// Hand one to `AbcView(abc:style:playback:)`; the island's controls call it, and it publishes what
// the player is doing.

import Foundation
import Observation
import WebKit

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
        didSet { UserDefaults.standard.set(countIn, forKey: "countIn"); send("setCountIn(\(countIn))") }
    }

    /// Called before any sound plays, so the app can set its audio session (and not while it is recording).
    public var willPlay: () -> Void = {}

    let meter: String?
    weak var webView: WKWebView?

    public init(meter: String?, defaultSound: Int? = nil) {
        self.meter = meter
        if let defaultSound, ScoreSound(rawValue: defaultSound) != nil { program = defaultSound }
    }

    /// The tempo you'd set a metronome to: the sound's crotchets a minute at this speed, in the meter's beat.
    public var bpm: Int {
        let parts = (meter ?? "4/4").split(separator: "/").compactMap { Double($0) }
        let crotchets = parts.count == 2 && parts[1] == 8 && parts[0] > 3 && parts[0].truncatingRemainder(dividingBy: 3) == 0 ? 1.5
            : parts.count == 2 && parts[1] > 0 ? 4 / parts[1] : 1
        return Int(((track?.bpm ?? 100) * Double(speed) / 100 / crotchets).rounded())
    }

    public var soundName: String { track?.label ?? "Notes, \(ScoreSound(rawValue: program)?.label ?? "score")" }

    public func toggle() {
        if !playing { willPlay() }
        send("toggle()")
    }

    public func pause() { send("pause()") }

    public func seek(_ percent: Double) {
        progress = percent
        send("seek(\(percent))")
    }

    public func setSpeed(_ value: Int) {
        speed = value
        send("setSpeed(\(value))")
    }

    public func setSound(_ program: Int) {
        self.program = program
        track = nil
        send("setSound(\(program), null)")
    }

    public func setTrack(_ track: PlayalongTrack) {
        self.track = track
        guard let data = try? JSONEncoder().encode(track), let json = String(data: data, encoding: .utf8) else { return }
        send("setSound(\(program), \(json))")
    }

    /// The page's state, whenever it changes.
    func receive(_ body: Any) {
        guard let state = body as? [String: Any] else { return }
        playing = state["playing"] as? Bool ?? false
        loading = state["loading"] as? Bool ?? false
        counting = state["counting"] as? Bool ?? false
        progress = state["progress"] as? Double ?? 0
        let message = state["error"] as? String
        error = message?.isEmpty == false ? message : nil
    }

    /// Settings the page needs again after it (re)loads a score.
    func configure() {
        send("reset(\(json(meter)))")
        send("setSpeed(\(speed))")
        send("setCountIn(\(countIn))")
        if let track { setTrack(track) } else { send("setSound(\(program), null)") }
    }

    private func send(_ call: String) {
        webView?.evaluateJavaScript("window.scorePlayer && window.scorePlayer.\(call)")
    }

    private func json(_ value: String?) -> String {
        guard let value, let data = try? JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed) else { return "null" }
        return String(data: data, encoding: .utf8) ?? "null"
    }
}
