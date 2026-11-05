// One tune's page in the reader, as the phone's web page: its set (if any), the title and meta,
// where it stands for you, and the score, which plays from a floating island while it is the page
// on screen.

import API
import AVFoundation
import DesignSystem
import Notation
import SwiftUI

private struct TuneDetail: Decodable {
    let tune: SavedTune
    let playalongs: [PlayalongTrack]
    let defaultSound: Int
}

struct ScorePage: View {
    @Environment(LibraryStore.self) private var library
    @Environment(ListenModel.self) private var listen
    /// The reader's bars, when they stand up the side and carry the player instead of the island.
    @Environment(PlayerRailSlot.self) private var rail: PlayerRailSlot?
    let page: ReaderPage
    let current: Bool
    /// Given by a tunebook; fetched here otherwise (your own tunes).
    let playalongs: [PlayalongTrack]?
    let defaultSound: Int?
    let editable: Bool
    @State private var tune: SavedTune
    @State private var fetched: [PlayalongTrack] = []
    @State private var playback: ScorePlayback
    /// Debug builds' `-playTune`: press play once drawn, and log what the player reports.
    var autoplay = false

    init(page: ReaderPage, current: Bool, playalongs: [PlayalongTrack]?, defaultSound: Int?, editable: Bool, autoplay: Bool = false) {
        self.page = page
        self.current = current
        self.playalongs = playalongs
        self.defaultSound = defaultSound
        self.editable = editable
        self.autoplay = autoplay
        _tune = State(initialValue: page.tune)
        _playback = State(initialValue: ScorePlayback(meter: page.tune.meter, defaultSound: defaultSound))
    }

    var body: some View {
        // With the player in the bars' column the score gets the page: a smaller title, no room kept for the island.
        let railed = rail?.edge != nil
        // The island sits beside the scrolling score, not on it, so its gestures are its own.
        ZStack(alignment: .bottom) {
        ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                if let set = page.set {
                    HStack(spacing: 8) { RepeatMark(); Text(set).font(.footnote.weight(.semibold)).foregroundStyle(Palette.text3) }
                        .padding(.bottom, 4)
                }
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(tune.displayTitle).font(.system(size: railed ? 26 : 34, design: .serif)).tracking(railed ? -0.5 : -0.8)
                    if tune.oftenPlayed == true {
                        Image(systemName: "star.fill").font(.footnote).foregroundStyle(Palette.brandDot).accessibilityLabel("Often played")
                    }
                }
                HStack(spacing: 10) {
                    let meta = tune.meta(groupedBy: .none)
                    if !meta.isEmpty { Text(meta).font(.subheadline).foregroundStyle(Palette.text3) }
                    Spacer()
                    if editable { ProgressMenu(tune: $tune) } else if tune.practice.level != .unlearned {
                        HStack(spacing: 6) { AbilityMark(level: tune.practice.level); Text(tune.practice.level.label).font(.subheadline) }
                            .foregroundStyle(Palette.mutedForeground)
                    }
                }
                AbcView(abc: Abc.forScore(AbcTune(title: tune.title, kind: tune.kind, meter: tune.meter, mode: tune.mode, abc: tune.abc)),
                        style: .score, playback: playback)
                    .padding(.top, railed ? 6 : 20)
            }
            .padding(.horizontal, railed ? 12 : 20)
            .padding(.top, railed ? 4 : 0)
            .padding(.bottom, railed ? 24 : 140)
        }
            if current, !railed { PlayerIsland(playback: playback, playalongs: playalongs ?? fetched) }
        }
        .onChange(of: current, initial: true) { claimRail() }
        .onChange(of: fetched.count) { claimRail() }
        .onChange(of: current) { if !current { playback.pause() } }
        .onDisappear { playback.pause(); rail?.release(page.id) }
        .task {
            playback.willPlay = { [listen] in
                // A live session owns the audio session, already set to play as it records; otherwise play through the
                // speaker even in silent mode.
                guard !listen.isLive else { return }
                try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
                try? AVAudioSession.sharedInstance().setActive(true)
            }
            if playalongs == nil, editable, library.user != nil,
               let detail = try? await library.api.get("api/app/tunes/\(tune.id)", as: TuneDetail.self) {
                tune = detail.tune
                fetched = detail.playalongs
                if playback.track == nil { playback.setSound(detail.defaultSound) }
            }
            if autoplay {
                try? await Task.sleep(for: .seconds(2))
                playback.toggle()
                for _ in 0..<4 {
                    try? await Task.sleep(for: .seconds(2))
                    log.info("Player: playing \(playback.playing, privacy: .public), loading \(playback.loading, privacy: .public), progress \(playback.progress, privacy: .public), error \(playback.error ?? "none", privacy: .public)")
                }
            }
        }
    }
}

extension ScorePage {
    /// The tune on screen hands its player to the reader's bars (they show it when they stand up the side).
    fileprivate func claimRail() {
        if current { rail?.claim(page.id, playback: playback, playalongs: playalongs ?? fetched) } else { rail?.release(page.id) }
    }
}

/// Where the tune stands for you: the five stages, or judged from your recorded speed.
struct ProgressMenu: View {
    @Environment(LibraryStore.self) private var library
    @Binding var tune: SavedTune
    @State private var saving = false

    var body: some View {
        Menu {
            Picker("Progress", selection: Binding(get: { tune.practice.levelOverride }, set: { level in Task { await save(level) } })) {
                ForEach([FinderTune.Level.mastered, .learned, .learning, .wanted, .unlearned], id: \.self) { level in
                    Text(level.label).tag(Optional(level))
                }
                if tune.practice.playableTempo != nil {
                    Text("From my best speed").tag(FinderTune.Level?.none)
                }
            }
        } label: {
            HStack(spacing: 6) {
                AbilityMark(level: tune.practice.level)
                Text(tune.practice.level.label).font(.subheadline)
            }
            .foregroundStyle(Palette.mutedForeground)
            .opacity(saving ? 0.5 : 1)
        }
        .accessibilityLabel("Progress: \(tune.practice.level.label)")
        .sensoryFeedback(.selection, trigger: tune.practice.level)
    }

    private func save(_ level: FinderTune.Level?) async {
        saving = true
        defer { saving = false }
        if let practice = try? await library.api.setLevel(tuneId: tune.id, level: level) {
            tune.practice = practice
            library.update(tune)
        }
    }
}
