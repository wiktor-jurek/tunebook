// What the Listen Live Activity shows, shared by the app (which starts and updates it) and the
// widget extension (which draws it on the Lock Screen and in the Dynamic Island).

import ActivityKit
import Foundation

public struct ListenActivityAttributes: ActivityAttributes {
    public enum Mode: String, Codable, Hashable, Sendable {
        /// Stop at the first confident answer, like naming a tune mid-session.
        case nameTune
        /// Keep going and build a setlist from the whole session.
        case recordSession
    }

    public struct ContentState: Codable, Hashable, Sendable {
        public enum Phase: String, Codable, Hashable, Sendable {
            case listening, narrowing, named
        }

        public var phase: Phase
        /// The leading tune once named, as the app shows it ("The Silver Spear").
        public var title: String?
        /// Its meta line ("Reel, D major").
        public var meta: String?
        /// 0 to 1: how far the leader is ahead of the margin needed to name it.
        public var confidence: Double
        /// Tunes named so far in a recorded session.
        public var tunesHeard: Int

        public init(phase: Phase, title: String? = nil, meta: String? = nil, confidence: Double = 0, tunesHeard: Int = 0) {
            self.phase = phase
            self.title = title
            self.meta = meta
            self.confidence = confidence
            self.tunesHeard = tunesHeard
        }
    }

    public var mode: Mode
    public var startedAt: Date

    public init(mode: Mode, startedAt: Date = .now) {
        self.mode = mode
        self.startedAt = startedAt
    }
}
