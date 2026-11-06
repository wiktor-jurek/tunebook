// Sessions, as the phone's web screen: sessions recorded with the deck, newest first by month, each
// named for when it was in your own time ("Last night", "Saturday afternoon"). One still on this phone (stopped with no connection) waits at the top to upload or
// discard. Opening one shows how much of it you could join in on, when each tune was played, and
// plays it back from any tune.

import API
import AVFoundation
import DesignSystem
import Notation
import SwiftUI
import UniformTypeIdentifiers

struct RecordingsView: View {
    @Environment(LibraryStore.self) private var library
    @Environment(ListenModel.self) private var listen
    @State private var recordings: [RecordingSummary]?
    @State private var problem: String?
    @State private var path: [RecordingSummary] = []
    @State private var picking = false

    var body: some View {
        ListAndDetail(path: $path, split: library.signedIn && !(recordings ?? []).isEmpty) {
            Group {
                if !library.signedIn {
                    ContentUnavailableView("Sign in to keep your sessions", systemImage: "waveform",
                                           description: Text("Record a night at the pub and every tune is named as it's played. Sign in and the setlist is here afterwards, to play back and practise at home."))
                } else if let recordings, recordings.isEmpty, listen.uploads.pending.isEmpty, listen.importing == nil, listen.importProblem == nil {
                    ContentUnavailableView {
                        Label("No sessions yet", systemImage: "waveform")
                    } description: {
                        Text("Next time the tunes start, open the tray below and tap record. Every tune is named as it's played, and the setlist waits for you here. Recorded it another way? Upload the recording and the tunes are named from it.")
                    } actions: {
                        Button("Upload recording", systemImage: "square.and.arrow.up") { picking = true }
                    }
                } else if recordings == nil, problem == nil {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    list
                }
            }
            .navigationTitle("Sessions")
            .refreshable { await load() }
            .toolbar {
                if library.signedIn {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Upload recording", systemImage: "square.and.arrow.up") { picking = true }
                            .disabled(listen.importing != nil)
                    }
                }
            }
            // A recording from the phone's own recorder, or anything in Files: the finder names its tunes, then it uploads.
            .fileImporter(isPresented: $picking, allowedContentTypes: [.audio]) { result in
                if case let .success(url) = result { Task { await listen.uploadRecording(from: url) } }
            }
        } placeholder: {
            ContentUnavailableView("Choose a session", systemImage: "waveform", description: Text("Its tunes and player open here."))
        } destination: { recording in
            RecordingPage(summary: recording).id(recording.id)
        }
        // Outside the split, so swapping it for a stack on a fold doesn't load again.
        .task(id: "\(library.signedIn)-\(listen.uploads.landed)") { await load() }
    }

    private var list: some View {
        List {
            if listen.importing != nil || listen.importProblem != nil {
                Section("Uploading a recording") { ImportRow() }
            }
            if !listen.uploads.pending.isEmpty {
                Section("On this phone") {
                    ForEach(listen.uploads.pending) { PendingRow(recording: $0) }
                }
            }
            if let problem { Text(problem).foregroundStyle(Palette.danger) }
            ForEach(months, id: \.0) { month, rows in
                Section(month) {
                    ForEach(rows) { recording in
                        RouteLink(route: recording, path: $path) {
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(alignment: .firstTextBaseline) {
                                    Text(title(recording)).font(.tuneTitle(.title3))
                                    Spacer()
                                    Text(recordingLength(recording.durationMs ?? 0)).font(.caption).foregroundStyle(Palette.text3)
                                }
                                Text(detail(recording)).font(.caption).foregroundStyle(Palette.text3)
                                if recording.tunes > 0 { Text(tunes(recording)).font(.subheadline).lineLimit(2) }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
            }
        }
    }

    /// Uploaded sessions under their month's heading ("November", or "November 2025" from another year).
    private var months: [(String, [RecordingSummary])] {
        var groups: [(String, [RecordingSummary])] = []
        for recording in recordings ?? [] {
            let month = Self.parse(recording.recordedAt).map(sessionMonth) ?? ""
            if groups.last?.0 == month { groups[groups.count - 1].1.append(recording) } else { groups.append((month, [recording])) }
        }
        return groups
    }

    private func title(_ recording: RecordingSummary) -> String {
        Self.parse(recording.recordedAt).map { sessionName($0) } ?? recording.title
    }

    private func detail(_ recording: RecordingSummary) -> String {
        let when = Self.parse(recording.recordedAt).map { "\(recording.title), \($0.formatted(date: .omitted, time: .shortened))" } ?? recording.title
        return "\(when), \(recording.tunes == 0 ? "no tunes named" : recording.tunes == 1 ? "1 tune" : "\(recording.tunes) tunes")"
    }

    private func tunes(_ recording: RecordingSummary) -> String {
        recording.firstTunes.map(displayTitle).joined(separator: ", ") + (recording.tunes > recording.firstTunes.count ? " and \(recording.tunes - recording.firstTunes.count) more" : "")
    }

    private func load() async {
        guard library.signedIn else { return }
        listen.uploads.reload()
        do {
            recordings = try await library.api.recordings()
            problem = nil
            #if DEBUG
            // Screenshots: `-openRecording <id>` opens one (with `-openEntry`, its first tune expanded).
            let args = ProcessInfo.processInfo.arguments
            if path.isEmpty, let i = args.firstIndex(of: "-openRecording"), let id = args.dropFirst(i + 1).first,
               let match = recordings?.first(where: { $0.id == id }) { path = [match] }
            #endif
        } catch {
            problem = "Couldn't load your sessions. Pull down to try again."
        }
    }

    static func parse(_ iso: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }
}

/// A session named for when it was, in your own time, as the web and Android name it: "This evening", "Last night",
/// "Yesterday afternoon", "Saturday morning". The small hours count as the night before.
func sessionName(_ date: Date, now: Date = .now, calendar: Calendar = .current) -> String {
    let hour = calendar.component(.hour, from: date)
    let part = (5..<12).contains(hour) ? "morning" : (12..<17).contains(hour) ? "afternoon" : (17..<21).contains(hour) ? "evening" : "night"
    func day(_ moment: Date) -> Date {
        let start = calendar.startOfDay(for: moment)
        return calendar.component(.hour, from: moment) < 5 ? calendar.date(byAdding: .day, value: -1, to: start)! : start
    }
    let days = calendar.dateComponents([.day], from: day(date), to: day(now)).day ?? 0
    switch days {
    case 0: return part == "night" ? "Tonight" : "This \(part)"
    case 1: return part == "night" ? "Last night" : "Yesterday \(part)"
    default: return "\(day(date).formatted(.dateTime.weekday(.wide).locale(Locale(identifier: "en_GB")))) \(part)"
    }
}

/// "November", or "November 2025" from another year.
func sessionMonth(_ date: Date) -> String {
    let sameYear = Calendar.current.isDate(date, equalTo: .now, toGranularity: .year)
    return date.formatted(sameYear ? .dateTime.month(.wide).locale(Locale(identifier: "en_GB")) : .dateTime.month(.wide).year().locale(Locale(identifier: "en_GB")))
}

func recordingLength(_ ms: Int) -> String {
    let m = Int((Double(ms) / 60000).rounded())
    return m < 1 ? "Under a minute" : m < 60 ? "\(m) min" : "\(m / 60) h \(m % 60) min"
}

func displayTitle(_ title: String) -> String {
    guard let match = title.wholeMatch(of: /(.+), (The|A|An)/) else { return title }
    return "\(match.2) \(match.1)"
}

/// A recording from Files while the finder listens through it, or why it couldn't.
private struct ImportRow: View {
    @Environment(ListenModel.self) private var listen

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            switch listen.importing {
            case .loading:
                ProgressView().tint(Palette.brandInk)
                Text("Getting the tune finder ready").font(.caption).foregroundStyle(Palette.text3)
            case let .listening(progress):
                ProgressView(value: progress).tint(Palette.brandInk)
                Text("Naming the tunes, \(Int(progress * 100))%").font(.caption).foregroundStyle(Palette.text3)
            case .setlist:
                Text("Writing the setlist").font(.caption).foregroundStyle(Palette.text3)
            case nil:
                Text(listen.importProblem ?? "").font(.caption).foregroundStyle(Palette.danger)
            }
        }
        .padding(.vertical, 4)
    }
}

/// A recording still on this phone: uploading, or waiting to be tried again or discarded.
private struct PendingRow: View {
    @Environment(ListenModel.self) private var listen
    @Environment(LibraryStore.self) private var library
    let recording: LocalRecording
    @State private var confirming = false

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(recording.name).font(.headline)
                switch listen.uploads.status[recording.id] {
                case let .sending(progress):
                    ProgressView(value: progress).tint(Palette.brandInk)
                    Text("Uploading, \(Int(progress * 100))%").font(.caption).foregroundStyle(Palette.text3)
                case .saving:
                    Text("Saving the setlist").font(.caption).foregroundStyle(Palette.text3)
                case .done:
                    Label("Uploaded", systemImage: "checkmark").font(.caption).foregroundStyle(Palette.brandInk)
                case let .failed(message):
                    Text(message).font(.caption).foregroundStyle(Palette.danger)
                case nil:
                    Text("\(recordingLength(recording.durationMs)), \(recording.tunes.filter { !$0.rejected }.count) tunes. Not uploaded yet.")
                        .font(.caption).foregroundStyle(Palette.text3)
                }
            }
            Spacer()
            if !isBusy {
                Button("Upload", systemImage: "icloud.and.arrow.up") { Task { await listen.uploads.upload(recording, api: library.api) } }
                    .labelStyle(.iconOnly).buttonStyle(.borderless).tint(Palette.brandInk)
            }
        }
        .swipeActions {
            if !isBusy { Button("Discard", role: .destructive) { confirming = true } }
        }
        .confirmationDialog("Discard this session? It hasn't uploaded, so it will be gone.", isPresented: $confirming, titleVisibility: .visible) {
            Button("Discard", role: .destructive) { listen.uploads.discard(recording) }
        }
    }

    private var isBusy: Bool {
        switch listen.uploads.status[recording.id] {
        case .sending, .saving, .done: true
        default: false
        }
    }
}

// MARK: One recording

/// Whether you could join in: you can play along (or lead), you are learning it, or not yet.
private enum Standing {
    case join, learning, new

    init(_ entry: RecordingDetail.Entry) {
        switch entry.practice.level {
        case .learned, .mastered: self = .join
        case .learning: self = .learning
        default: self = .new
        }
    }

    var colour: Color {
        switch self {
        case .join: Palette.learned
        case .learning: Palette.brandDot
        case .new: Palette.lineStrong
        }
    }
}

struct RecordingPage: View {
    @Environment(LibraryStore.self) private var library
    @Environment(ListenModel.self) private var listen
    @Environment(\.dismiss) private var dismiss
    let summary: RecordingSummary
    @State private var detail: RecordingDetail?
    @State private var player = RecordingAudio()
    @State private var open: String?
    @State private var problem: String?
    @State private var confirmDelete = false
    @State private var busy = false
    @State private var score: RecordingDetail.Entry?
    /// A tune picked on the timeline, scrolled into view in the setlist once the finger lifts.
    @State private var scrollTarget: String?

    /// A stretch with no tune named this long shows in the setlist: a chat, a song, a break.
    private let gapMs = 45_000
    /// Tunes played straight after one another are a set; a longer stretch with none named starts a new one.
    private let setBreakMs = 20_000

    var body: some View {
        Group {
            if let detail { content(detail) } else if let problem {
                ContentUnavailableView("Couldn't open this session", systemImage: "waveform", description: Text(problem))
            } else { ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity) }
        }
        .navigationTitle(RecordingsView.parse(summary.recordedAt).map { sessionName($0) } ?? summary.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .onDisappear { player.pause() }
        .sheet(item: $score) { entry in
            ScoreScreen(tune: tuneFor(entry))
        }
        .confirmationDialog("Delete this session? Its audio and setlist go for good.", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete session", role: .destructive) {
                Task {
                    busy = true
                    do { try await library.api.deleteRecording(summary.id); dismiss() } catch { problem = error.localizedDescription }
                    busy = false
                }
            }
        }
    }

    private func content(_ detail: RecordingDetail) -> some View {
        let tunes = detail.tunes
        let duration = max(player.duration ?? Double(detail.durationMs ?? 0) / 1000, 1)
        return ScrollViewReader { proxy in List {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text(RecordingsView.parse(summary.recordedAt).map { sessionName($0) } ?? summary.title).font(.system(size: 30, design: .serif))
                    Text("\(summary.title), \(recordingLength(detail.durationMs ?? 0).lowercased()), \(Set(tunes.map(\.tuneId)).count) tunes").font(.subheadline).foregroundStyle(Palette.text3)
                }
            }
            .listRowSeparator(.hidden)

            Section {
                deck(tunes, duration: duration)
            }
            .listRowSeparator(.hidden)

            Section("What was played") {
                ForEach(rows(tunes), id: \.id) { row in
                    switch row.kind {
                    case let .gap(from, to):
                        Text("\(clock(Double(from) / 1000)), no tune named for \(recordingLength(to - from).lowercased())")
                            .font(.caption).foregroundStyle(Palette.text3)
                    case let .set(from, count):
                        HStack(spacing: 8) { RepeatMark(); Text("Set of \(count), from \(clock(Double(from) / 1000))").font(.footnote.weight(.semibold)).foregroundStyle(Palette.text3) }
                    case let .tune(entry):
                        entryRow(entry, detail: detail)
                    }
                }
            }

            Section {
                if !tunes.isEmpty {
                    Button(busy ? "Making the tunebook" : "Make a tunebook of these", systemImage: "book.closed") { Task { await makeBook(detail) } }
                        .disabled(busy)
                }
                Button("Delete this session", systemImage: "trash", role: .destructive) { confirmDelete = true }.disabled(busy)
                if let problem { Text(problem).foregroundStyle(Palette.danger) }
            }
        }
        .onChange(of: scrollTarget) {
            guard let target = scrollTarget else { return }
            withAnimation(.smooth(duration: 0.45)) { proxy.scrollTo(target, anchor: .center) }
            scrollTarget = nil
        }
        }
        // A tick under the finger each time the timeline crosses into another tune, and when a row opens.
        .sensoryFeedback(.selection, trigger: open)
    }

    /// The player: what is playing now, the session as a strip of its tunes, and the controls.
    private func deck(_ tunes: [RecordingDetail.Entry], duration: Double) -> some View {
        let nowMs = Int(player.time * 1000)
        let current = tunes.first { nowMs >= $0.startMs && nowMs < $0.endMs }
        return VStack(alignment: .leading, spacing: 10) {
            Text(current.map { displayTitle($0.title) } ?? (player.time > 0 ? "No tune named here" : " "))
                .font(.tuneTitle(.title3)).lineLimit(1)
            // The session as a strip of its tunes. Touching it scrubs the audio and picks the tune under the finger:
            // its segment lifts while the rest fall back, and on release it opens, with its first bars, in the setlist.
            GeometryReader { geometry in
                let x = { (ms: Int) in geometry.size.width * Double(ms) / 1000 / duration }
                ZStack(alignment: .leading) {
                    Capsule().fill(Palette.accent).frame(height: 14)
                    ForEach(tunes) { entry in
                        let picked = open == entry.id
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(Standing(entry).colour)
                            .opacity(open == nil ? 0.85 : picked ? 1 : 0.4)
                            // A picked tune shows at least a fingertip wide, even one the setlist gives almost no time.
                            .frame(width: max(picked ? 12 : 3, x(entry.endMs) - x(entry.startMs) - 1), height: picked ? 26 : open == nil ? 18 : 14)
                            .shadow(color: .black.opacity(picked ? 0.18 : 0), radius: 4, y: 2)
                            .offset(x: x(entry.startMs))
                            .zIndex(picked ? 1 : 0)
                    }
                    Capsule().fill(Palette.foreground).frame(width: 3, height: 30)
                        .offset(x: geometry.size.width * min(player.time / duration, 1) - 1.5)
                        .zIndex(2)
                }
                .frame(maxHeight: .infinity)
                .contentShape(.rect)
                .animation(.spring(response: 0.3, dampingFraction: 0.75), value: open)
                .gesture(DragGesture(minimumDistance: 0)
                    .onChanged { drag in
                        let seconds = max(0, min(1, drag.location.x / geometry.size.width)) * duration
                        player.seek(seconds, precise: false)
                        let ms = Int(seconds * 1000)
                        if let entry = tunes.last(where: { ms >= $0.startMs && ms < $0.endMs }), open != entry.id { open = entry.id }
                    }
                    .onEnded { drag in
                        player.seek(max(0, min(1, drag.location.x / geometry.size.width)) * duration)
                        scrollTarget = open
                    })
            }
            .frame(height: 32)
            .accessibilityElement()
            .accessibilityLabel("Position in the session")
            .accessibilityValue("\(clock(player.time))\(current.map { ", \(displayTitle($0.title))" } ?? "")")
            HStack(spacing: 14) {
                Button { player.toggle() } label: {
                    Image(systemName: player.playing ? "pause.fill" : "play.fill").font(.title3).frame(width: 44, height: 44)
                        .background(Palette.brandInk, in: .circle).foregroundStyle(Palette.onBrandInk)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(player.playing ? "Pause" : "Play")
                Text("\(clock(player.time)) / \(clock(duration))").font(.footnote).monospacedDigit().foregroundStyle(Palette.text3)
                Spacer()
                Picker("Speed", selection: Binding(get: { player.speed }, set: { player.setSpeed($0) })) {
                    ForEach([75, 85, 100], id: \.self) { Text("\($0)%").tag($0) }
                }
                .pickerStyle(.segmented)
                .frame(width: 150)
            }
        }
        .padding(.vertical, 6)
    }

    private func entryRow(_ entry: RecordingDetail.Entry, detail: RecordingDetail) -> some View {
        let isOpen = open == entry.id
        let nowMs = Int(player.time * 1000)
        let playing = player.playing && nowMs >= entry.startMs && nowMs < entry.endMs
        return VStack(alignment: .leading, spacing: 8) {
            Button { withAnimation(Motion.standard) { open = isOpen ? nil : entry.id } } label: {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(clock(Double(entry.startMs) / 1000)).font(.caption).monospacedDigit().foregroundStyle(Palette.text3).frame(width: 44, alignment: .leading)
                    Circle().fill(Standing(entry).colour).frame(width: 8, height: 8)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(displayTitle(entry.title)).font(.tuneTitle(.headline)).foregroundStyle(playing ? Palette.brandDotText : Palette.foreground)
                        Text([meta(entry), "\(max(1, (entry.endMs - entry.startMs) / 60000)) min"].filter { !$0.isEmpty }.joined(separator: ", "))
                            .font(.caption).foregroundStyle(Palette.text3)
                    }
                    Spacer()
                    Text(entry.savedId != nil || entry.practice.level != .unlearned ? entry.practice.level.label : "New to you")
                        .font(.caption).foregroundStyle(Palette.mutedForeground)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            if isOpen {
                AbcView(abc: Abc.openingPhrase(AbcTune(title: entry.title, kind: entry.kind, meter: entry.meter, mode: entry.mode, abc: entry.abc)), style: .phrase)
                // One line when they fit at their natural width; on a narrow phone, Not this tune drops to its own line.
                let play = Button { player.seek(Double(entry.startMs) / 1000); player.play() } label: { action("Play from here", "play.fill") }
                    .buttonStyle(.borderedProminent).buttonBorderShape(.capsule).tint(Palette.brandInk).fixedSize()
                let full = Button { score = entry } label: { action("Full score", "music.note") }
                    .buttonStyle(.borderless).tint(Palette.foreground).fixedSize()
                let wrong = Button { Task { await reject(entry) } } label: { action("Not this tune", "xmark") }
                    .buttonStyle(.borderless).tint(Palette.danger).fixedSize()
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 18) { play; full; wrong }
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(spacing: 18) { play; full }
                        wrong
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .font(.subheadline)
            }
        }
        .padding(.vertical, 4)
    }

    /// A button's icon and words, close together (a list row would otherwise spread them apart).
    private func action(_ title: String, _ icon: String) -> some View {
        HStack(spacing: 6) { Image(systemName: icon).imageScale(.small); Text(title) }
    }

    private enum RowKind { case gap(Int, Int), set(Int, Int), tune(RecordingDetail.Entry) }
    private struct Row { let id: String; let kind: RowKind }

    /// The setlist as a timeline: each tune at its time, tunes played back to back marked as a set, and any long
    /// stretch between tunes with none named.
    private func rows(_ tunes: [RecordingDetail.Entry]) -> [Row] {
        var sets: [[RecordingDetail.Entry]] = [], edge = Int.min
        for tune in tunes {
            if sets.isEmpty || tune.startMs - edge > setBreakMs { sets.append([]) }
            sets[sets.count - 1].append(tune)
            edge = max(edge, tune.endMs)
        }
        var rows: [Row] = [], last = 0
        for set in sets {
            if set[0].startMs - last >= gapMs { rows.append(Row(id: "gap-\(last)", kind: .gap(last, set[0].startMs))) }
            if set.count > 1 { rows.append(Row(id: "set-\(set[0].id)", kind: .set(set[0].startMs, set.count))) }
            for entry in set { rows.append(Row(id: entry.id, kind: .tune(entry))); last = max(last, entry.endMs) }
        }
        return rows
    }

    private func meta(_ entry: RecordingDetail.Entry) -> String {
        [entry.kind.map { $0.prefix(1).uppercased() + $0.dropFirst() }, entry.mode.map(keyName)].compactMap { $0 }.joined(separator: ", ")
    }

    private func tuneFor(_ entry: RecordingDetail.Entry) -> FinderTune {
        let json: [String: Any] = ["tuneId": entry.tuneId, "settingId": entry.settingId, "title": entry.title, "kind": entry.kind ?? "",
                                   "meter": entry.meter ?? "", "mode": entry.mode ?? "", "abc": entry.abc, "level": entry.practice.level.rawValue,
                                   "savedId": entry.savedId as Any]
        return try! JSONDecoder().decode(FinderTune.self, from: JSONSerialization.data(withJSONObject: json.filter { !($0.value is NSNull) }))
    }

    private func load() async {
        do {
            let detail = try await library.api.recording(summary.id)
            self.detail = detail
            #if DEBUG
            if open == nil, ProcessInfo.processInfo.arguments.contains("-openEntry") { open = detail.tunes.first?.id }
            #endif
            if let url = detail.audioUrl.flatMap(URL.init(string:)), player.url != url { player.load(url) }
        } catch {
            problem = error.localizedDescription
        }
    }

    private func reject(_ entry: RecordingDetail.Entry) async {
        do {
            try await library.api.removeRecordingTune(summary.id, entryId: entry.id)
            open = nil
            await load()
        } catch { problem = error.localizedDescription }
    }

    private func makeBook(_ detail: RecordingDetail) async {
        busy = true
        defer { busy = false }
        var sets: [[Int]] = [], edge = Int.min
        for (index, tune) in detail.tunes.enumerated() {
            if sets.isEmpty || tune.startMs - edge > setBreakMs { sets.append([]) }
            sets[sets.count - 1].append(index)
            edge = max(edge, tune.endMs)
        }
        do {
            let id = try await library.api.makeTunebook(name: "Session, \(summary.title)", settings: detail.tunes.map { ($0.settingId, $0.savedId) }, sets: sets)
            await library.load()
            library.open(bookId: id, name: "Session, \(summary.title)")
        } catch {
            problem = "Could not make the tunebook. Try again."
        }
    }
}

/// The recording's audio: an AVPlayer, slowed down without changing pitch.
@MainActor
@Observable
private final class RecordingAudio {
    private(set) var playing = false
    private(set) var time: Double = 0
    private(set) var duration: Double?
    private(set) var speed = 100
    private(set) var url: URL?
    private var player: AVPlayer?
    private var observer: Any?

    func load(_ url: URL) {
        self.url = url
        let item = AVPlayerItem(url: url)
        item.audioTimePitchAlgorithm = .timeDomain
        let player = AVPlayer(playerItem: item)
        self.player = player
        observer = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 4), queue: .main) { [weak self] now in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.time = now.seconds
                if let seconds = player.currentItem?.duration.seconds, seconds.isFinite { self.duration = seconds }
                self.playing = player.rate > 0
            }
        }
    }

    func toggle() { playing ? pause() : play() }

    func play() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        try? AVAudioSession.sharedInstance().setActive(true)
        player?.rate = Float(speed) / 100
        playing = true
    }

    func pause() {
        player?.pause()
        playing = false
    }

    /// `precise` false while scrubbing: the nearest point that can play at once, so the finger never waits.
    func seek(_ seconds: Double, precise: Bool = true) {
        time = seconds
        let tolerance = precise ? CMTime.zero : CMTime(seconds: 0.5, preferredTimescale: 600)
        player?.seek(to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: tolerance, toleranceAfter: tolerance)
    }

    func setSpeed(_ value: Int) {
        speed = value
        if playing { player?.rate = Float(value) / 100 }
    }
}
