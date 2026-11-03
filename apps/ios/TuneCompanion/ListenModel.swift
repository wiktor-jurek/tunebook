// Drives listening, as the web's useTuneListener and listen tray do: the microphone and model
// (Finder), the Live Activity, the haptics, the tunes heard tonight, and which of the deck, the
// answer card and a score is showing. Naming a tune stops at the first confident answer; a session
// keeps going and adds each new tune as the set moves on.

@preconcurrency import ActivityKit
import API
import Finder
import Foundation
import Haptics
import ListenActivity
import ListenCore
import Observation
import UIKit

struct HeardTune: Identifiable, Hashable {
    let tune: FinderTune
    let at: Date
    var id: String { "\(tune.tuneId)-\(at.timeIntervalSince1970)" }
}

@MainActor
@Observable
final class ListenModel {
    typealias Phase = ListenActivityAttributes.ContentState.Phase

    // MARK: Listening

    private(set) var isLive = false
    /// Asking for the microphone, before audio flows.
    private(set) var starting = false
    private(set) var mode = ListenActivityAttributes.Mode.nameTune
    private(set) var phase = Phase.listening
    /// Downloading the model on first use, 0 to 1; nil once ready.
    private(set) var downloading: Double?
    private(set) var quiet = false
    /// The input level, 0 to 1, for the dial's halo.
    private(set) var level: Double = 0
    /// How far the leader is ahead of what naming it needs, 0 to 1: the dial's arc.
    private(set) var certainty = 0.0
    /// The finder's best guess, and whether it is sure.
    private(set) var leader: FinderTune?
    private(set) var leaderSure = false
    /// The next best guesses, with their names once looked up.
    private(set) var alternatives: [FinderTune] = []
    /// Tonight's tunes, newest first.
    private(set) var heard: [HeardTune] = []
    /// When the session recording began (nil when not recording).
    private(set) var sessionStartedAt: Date?
    /// The microphone was refused.
    private(set) var denied = false
    /// Why listening stopped, said plainly.
    private(set) var problem: String?

    var isRecording: Bool { isLive && mode == .recordSession }
    /// A live session's tunes since it began, newest first.
    var tonight: [HeardTune] { sessionStartedAt.map { start in heard.filter { $0.at >= start } } ?? [] }

    // MARK: What is showing

    var deckOpen = false
    var answerOpen = false
    /// Opened by a newly named tune in a live session; any touch keeps it open.
    var peeking = false
    var scoreTune: FinderTune?
    var dimmed = false

    private let assets = FinderAssets.production
    let api = APIClient.current
    private var prepared: (ModelRunner, FinderModel)?
    private var listener: Listener?
    private var names: [Int: FinderTune] = [:]
    private var candidateIds: [Int] = []
    private var activity: Activity<ListenActivityAttributes>?
    private var startedAt = Date.now
    private var peekTask: Task<Void, Never>?

    // MARK: Recording the session, and keeping tunes (signed in)

    /// Writes the session's audio while it records; signed in only, as on the web.
    private let recorder = SessionRecorder()
    /// The recording in progress: its setlist grows as tunes are named.
    private(set) var recording: LocalRecording?
    let uploads = RecordingUploads()
    /// Set by the app: whether someone is signed in, so a session keeps its audio and tunes can be kept.
    var signedIn: () -> Bool = { false }
    /// Called when tunes are kept, so the library reloads.
    var libraryChanged: () -> Void = {}
    /// A tune being saved, by The Session tune ID.
    private(set) var saving: Int?
    /// Making a tunebook from tonight's tunes.
    private(set) var makingBook = false

    // MARK: Actions

    /// Names one tune: stops at the first confident answer.
    func nameATune() { start(.nameTune) }

    /// Records the session: keeps listening, adding each new tune to tonight's setlist. Already listening, it carries on.
    func startSession() {
        if isLive {
            mode = .recordSession
            sessionStartedAt = .now
            if let leader, leaderSure, heard.first?.tune.tuneId == leader.tuneId { heard[0] = HeardTune(tune: leader, at: .now) }
            UIApplication.shared.isIdleTimerDisabled = true
            restartActivity()
            beginRecording()
            // The tune that started it all opens the setlist.
            if let first = tonight.first { mark(first.tune) }
        } else {
            start(.recordSession)
        }
    }

    func start(_ mode: ListenActivityAttributes.Mode) {
        guard !isLive else { return }
        Haptics.shared.prepare()
        self.mode = mode
        isLive = true
        starting = true
        phase = .listening
        quiet = false
        certainty = 0
        problem = nil
        denied = false
        leader = nil
        leaderSure = false
        alternatives = []
        startedAt = .now
        sessionStartedAt = mode == .recordSession ? .now : nil
        // A session runs with the phone face up on the table: keep the screen from locking.
        UIApplication.shared.isIdleTimerDisabled = mode == .recordSession
        restartActivity()
        Task { await begin() }
    }

    func stop() {
        finishRecording()
        listener?.stop()
        listener = nil
        isLive = false
        starting = false
        level = 0
        downloading = nil
        dimmed = false
        UIApplication.shared.isIdleTimerDisabled = false
        let final = state
        let activity = activity
        self.activity = nil
        Task { await activity?.end(.init(state: final, staleDate: nil), dismissalPolicy: phase == .named ? .after(.now + 15) : .immediate) }
    }

    /// Forget the answer so far and listen afresh, keeping the audio (the web's "Listen again from here").
    func restart() {
        listener?.reset()
        leader = nil
        leaderSure = false
        alternatives = []
        certainty = 0
        phase = .listening
    }

    /// A tune named wrongly leaves tonight's list, and listening carries on.
    func reject(_ heard: HeardTune) {
        self.heard.removeAll { $0.id == heard.id }
        // The recording keeps it, marked, for training the finder.
        if let index = recording?.tunes.lastIndex(where: { $0.tuneId == heard.tune.tuneId && !$0.rejected }) {
            recording?.tunes[index].rejected = true
        }
        if leader?.tuneId == heard.tune.tuneId { restart() }
        publish()
    }

    func clearHeard() { heard = [] }

    func openScore(_ tune: FinderTune) { scoreTune = names[tune.tuneId] ?? tune }

    /// A newly named tune in a live session opens the deck for a moment, then it folds away again.
    func peek() {
        guard !deckOpen, !dimmed else { return }
        peeking = true
        deckOpen = true
        peekTask?.cancel()
        peekTask = Task {
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled, peeking else { return }
            peeking = false
            deckOpen = false
        }
    }

    func stopPeeking() {
        peeking = false
        peekTask?.cancel()
    }

    // MARK: Listening, inside

    private var state: ListenActivityAttributes.ContentState {
        let named = phase == .named ? (tonight.first?.tune ?? heard.first?.tune ?? leader) : nil
        return .init(phase: phase, title: named?.displayTitle, meta: named?.meta, confidence: certainty, tunesHeard: tonight.count)
    }

    private func restartActivity() {
        let old = activity
        activity = nil
        Task { await old?.end(nil, dismissalPolicy: .immediate) }
        if ActivityAuthorizationInfo().areActivitiesEnabled {
            activity = try? Activity.request(attributes: ListenActivityAttributes(mode: mode, startedAt: sessionStartedAt ?? startedAt),
                                             content: .init(state: state, staleDate: nil))
        }
    }

    private func publish() {
        let content = ActivityContent(state: state, staleDate: nil)
        let activity = activity
        Task { await activity?.update(content) }
    }

    private func begin() async {
        guard await Listener.requestPermission() else {
            denied = true
            fail("Allow the microphone to listen")
            return
        }
        do {
            let (runner, model) = try await prepare()
            guard isLive else { return }
            let listener = Listener(runner: runner, model: model) { [weak self] event in
                Task { @MainActor in self?.handle(event) }
            }
            let recorder = recorder
            listener.onBuffer = { recorder.write($0) }
            try listener.start()
            self.listener = listener
            if isRecording { beginRecording() }
            starting = false
            log.info("Listening with \(model.tuneIds.count, privacy: .public) tunes, \(runner.channels, privacy: .public) channels")
        } catch {
            log.error("Could not start listening: \(error.localizedDescription, privacy: .public)")
            fail("The tune finder stopped")
        }
    }

    /// The model, downloaded on first use and loaded once per launch.
    private func prepare() async throws -> (ModelRunner, FinderModel) {
        if let prepared { return prepared }
        downloading = 0
        defer { downloading = nil }
        let model = try await assets.load { progress in
            Task { @MainActor [weak self] in self?.downloading = progress }
        }
        let runner = try await Task.detached(priority: .userInitiated) { try ModelRunner(modelURL: model.modelURL) }.value
        prepared = (runner, model)
        return (runner, model)
    }

    private func fail(_ message: String) {
        problem = message
        stop()
    }

    private func handle(_ event: ListenerEvent) {
        guard isLive else { return }
        switch event {
        case let .level(value):
            // RMS of a few tenths is loud music close by; the halo saturates there.
            level = min(Double(value) * 5, 1)
        case .quiet:
            quiet = true
        case let .failed(message):
            log.error("Scoring failed: \(message, privacy: .public)")
        case let .verdict(verdict):
            quiet = false
            certainty = min(max(verdict.margin / 0.04, 0), 1)
            candidateIds = verdict.candidates.prefix(5).map { Int($0.tuneId) }
            Task { await lookUp(candidateIds) }
            refreshGuesses(sure: verdict.status == .match)
            switch verdict.status {
            case .listening, .unsure:
                // In a session the last tune stays on screen until the next one is named.
                if !isRecording || tonight.isEmpty {
                    phase = verdict.status == .listening ? .listening : .narrowing
                    if !isRecording, verdict.status == .unsure { Haptics.shared.confidenceTick(certainty) }
                }
                publish()
            case .match:
                guard let first = candidateIds.first else { return }
                Task { await named(first) }
            }
        }
    }

    /// The leader and the other guesses, from the latest verdict's candidates.
    private func refreshGuesses(sure: Bool) {
        if let first = candidateIds.first, let tune = names[first] {
            leader = tune
            leaderSure = sure
        }
        alternatives = candidateIds.dropFirst().compactMap { names[$0] }
    }

    /// A confident answer: a new tune joins tonight's list (a set moving on), the same one is ignored.
    private func named(_ tuneId: Int) async {
        await lookUp([tuneId])
        guard isLive, let tune = names[tuneId] else { return }
        refreshGuesses(sure: true)
        guard heard.first?.tune.tuneId != tuneId || mode == .nameTune && !answerOpen else { return }
        let first = tonight.isEmpty || mode == .nameTune
        heard.insert(HeardTune(tune: tune, at: .now), at: 0)
        if isRecording { mark(tune) }
        phase = .named
        if first { Haptics.shared.lockOn() } else { Haptics.shared.setChange() }
        publish()
        if mode == .nameTune {
            stop()
            deckOpen = false
            answerOpen = true
        } else {
            peek()
        }
    }

    // MARK: Recording, inside

    /// Starts writing the session's audio, once the microphone is running (signed in only).
    private func beginRecording() {
        guard isRecording, recording == nil, signedIn(), let format = listener?.format else { return }
        let start = sessionStartedAt ?? .now
        let name = "Session, \(start.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)))"
        let local = LocalRecording(id: UUID().uuidString, name: name, recordedAt: start, durationMs: 0, tunes: [], finished: false)
        do {
            try recorder.begin(local, format: format)
            recording = local
        } catch {
            log.error("Could not start recording: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Each newly named tune joins the recording's setlist, starting a little before it was named.
    private func mark(_ tune: FinderTune) {
        guard var local = recording else { return }
        let start = max(0, recorder.elapsedMs - SessionRecorder.namingDelayMs)
        if local.tunes.last?.tuneId == tune.tuneId { return }
        if !local.tunes.isEmpty { local.tunes[local.tunes.count - 1].endMs = start }
        local.tunes.append(SetlistEntry(tuneId: tune.tuneId, settingId: tune.settingId ?? 0, title: tune.title, startMs: start, endMs: 0))
        recording = local
        uploads.save(local)
    }

    /// Stops writing and uploads the recording with its setlist.
    private func finishRecording() {
        guard var local = recording else { return }
        recording = nil
        local.durationMs = recorder.end()
        local.tunes = local.tunes.map { var tune = $0; if tune.endMs == 0 { tune.endMs = local.durationMs }; return tune }
        local.finished = true
        uploads.save(local)
        Task { await uploads.upload(local, api: api) }
    }

    // MARK: Keeping tunes

    /// One tap in the pub: save the tune and mark it Want to learn. A level already set stays.
    func learnLater(_ tune: FinderTune) async {
        guard signedIn(), let settingId = tune.settingId else { return }
        saving = tune.tuneId
        defer { saving = nil }
        do {
            let savedId = if let saved = tune.savedId { saved } else { try await api.saveSetting(settingId) }
            var kept = tune
            kept.savedId = savedId
            if (tune.level ?? .unlearned) == .unlearned {
                _ = try await api.setLevel(tuneId: savedId, level: .wanted)
                kept.level = .wanted
            }
            update(kept)
            libraryChanged()
            Haptics.shared.confidenceTick(1)
        } catch {
            log.error("Learn later failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Puts tonight's heard tunes, in the order they were played, into a new tunebook; returns its ID.
    func makeBook(name: String = "Tonight's tunes") async throws -> String {
        makingBook = true
        defer { makingBook = false }
        var seen = Set<Int>(), played: [FinderTune] = []
        for heard in heard.reversed() where seen.insert(heard.tune.tuneId).inserted { played.append(heard.tune) }
        let bookId = try await api.makeTunebook(name: name, settings: played.compactMap { tune in tune.settingId.map { ($0, tune.savedId) } })
        libraryChanged()
        return bookId
    }

    /// A tune's new standing, everywhere it shows.
    private func update(_ tune: FinderTune) {
        names[tune.tuneId] = tune
        heard = heard.map { $0.tune.tuneId == tune.tuneId ? HeardTune(tune: tune, at: $0.at) : $0 }
        if leader?.tuneId == tune.tuneId { leader = tune }
        alternatives = alternatives.map { $0.tuneId == tune.tuneId ? tune : $0 }
        if scoreTune?.tuneId == tune.tuneId { scoreTune = tune }
    }

    #if DEBUG
    /// Shows a tune as if it had just been named, with the next IDs as alternatives (screenshots).
    func show(tuneId: Int) async {
        candidateIds = [tuneId, 1, 2, 27]
        await lookUp(candidateIds)
        guard let tune = names[tuneId] else { return }
        refreshGuesses(sure: true)
        heard.insert(HeardTune(tune: tune, at: .now), at: 0)
        if isRecording { phase = .named; publish(); deckOpen = true } else { answerOpen = true }
    }
    #endif

    private func lookUp(_ ids: [Int]) async {
        let missing = ids.filter { names[$0] == nil }
        if !missing.isEmpty, let tunes = try? await api.finderTunes(ids: missing) {
            for tune in tunes { names[tune.tuneId] = tune }
        }
        refreshGuesses(sure: leaderSure)
    }
}
