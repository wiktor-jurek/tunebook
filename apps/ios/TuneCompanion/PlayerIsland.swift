// The player as a floating island over the score, as on the phone's web page: where it is, play,
// the sound (an instrument or a play-along recording) and the speed, out of the music's way. Swiped
// down it tucks away into one round button; it remembers which, on this device.

import DesignSystem
import Notation
import SwiftUI

struct PlayerIsland: View {
    let playback: ScorePlayback
    let playalongs: [PlayalongTrack]
    @AppStorage("playerIslandOpen") private var open = false
    @State private var drag: CGFloat = 0
    @State private var scrubbing: Double?

    var body: some View {
        Group {
            if open { island.transition(.move(edge: .bottom).combined(with: .opacity)) } else { handle.transition(.scale.combined(with: .opacity)) }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
        .animation(.spring(response: 0.4, dampingFraction: 0.85), value: open)
    }

    private var island: some View {
        VStack(spacing: 10) {
            // The grip: drag it down, or tap it, to put the player away. It takes the drag before the score's scroll
            // and the reader's paging can, and is wide and tall enough to catch a thumb.
            Capsule().fill(Palette.lineStrong).frame(width: 36, height: 5)
                .frame(maxWidth: .infinity, minHeight: 22)
                .contentShape(.rect)
                .highPriorityGesture(DragGesture(minimumDistance: 4, coordinateSpace: .global)
                    .onChanged { drag = $0.translation.height }
                    .onEnded { value in
                        if value.translation.height > 50 || value.predictedEndTranslation.height > 140 { open = false }
                        drag = 0
                    })
                .onTapGesture { open = false }
                .accessibilityElement()
                .accessibilityLabel("Put the player away")
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { open = false }
                .padding(.top, -6)
            Slider(value: Binding(get: { scrubbing ?? playback.progress }, set: { scrubbing = $0 }), in: 0...100) { editing in
                if !editing, let value = scrubbing { playback.seek(value); scrubbing = nil }
            }
            .tint(Palette.brandDot)
            .accessibilityLabel("Playback position")
            HStack(spacing: 12) {
                playButton(size: 46)
                soundMenu
                Spacer(minLength: 4)
                speedControl
            }
            if let error = playback.error {
                Text(error).font(.caption).foregroundStyle(Palette.danger)
            }
        }
        .padding(14)
        .glassEffect(.regular, in: .rect(cornerRadius: 26))
        .offset(y: max(0, drag))
        .animation(.interactiveSpring, value: drag)
    }

    private var handle: some View {
        HStack {
            Spacer()
            // The system's glass button: its own glass takes the touch, so the tap always reaches the button.
            Button { open = true } label: {
                Group {
                    if playback.playing { LiveBars() } else { Image(systemName: "play.fill").font(.system(size: 18)) }
                }
                .frame(width: 40, height: 40)
                .contentShape(.circle)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .tint(Palette.foreground)
            .accessibilityLabel(playback.playing ? "Playing. Show the player" : "Show the player")
            .sensoryFeedback(.impact(weight: .light), trigger: open)
        }
    }

    private func playButton(size: CGFloat) -> some View {
        Button { playback.toggle() } label: {
            ZStack {
                Circle().fill(Palette.brandInk)
                if playback.loading || playback.counting {
                    ProgressView().tint(Palette.onBrandInk)
                } else {
                    Image(systemName: playback.playing ? "pause.fill" : "play.fill")
                        .font(.system(size: size * 0.38)).foregroundStyle(Palette.onBrandInk)
                        .contentTransition(.symbolEffect(.replace))
                }
            }
            .frame(width: size, height: size)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(playback.playing ? "Pause" : "Play")
        .sensoryFeedback(.impact(weight: .light), trigger: playback.playing)
    }

    private var soundMenu: some View {
        Menu {
            Section("Notes") {
                ForEach(ScoreSound.allCases) { sound in
                    Button { playback.setSound(sound.rawValue) } label: {
                        if playback.track == nil, playback.program == sound.rawValue { Label(sound.label, systemImage: "checkmark") } else { Text(sound.label) }
                    }
                }
            }
            if !playalongs.isEmpty {
                Section("Play-along recordings") {
                    ForEach(playalongs) { track in
                        Button { playback.setTrack(track) } label: {
                            let label = "\(leadEmoji(track.label)) \(track.label)\(track.otherSetting ? ", other setting" : "")"
                            if playback.track?.id == track.id { Label(label, systemImage: "checkmark") } else { Text(label) }
                        }
                    }
                }
            }
            if playback.track == nil {
                Toggle("Count-in", isOn: Binding(get: { playback.countIn }, set: { playback.countIn = $0 }))
            }
        } label: {
            VStack(alignment: .leading, spacing: 1) {
                Text(playback.soundName).font(.footnote.weight(.semibold)).lineLimit(1)
                Text("\(playback.bpm) BPM").font(.caption2).monospacedDigit().foregroundStyle(Palette.text3)
            }
            .foregroundStyle(Palette.foreground)
        }
    }

    private var speedControl: some View {
        Picker("Speed", selection: Binding(get: { playback.speed }, set: { playback.setSpeed($0) })) {
            ForEach([75, 85, 100], id: \.self) { Text("\($0)%").tag($0) }
        }
        .pickerStyle(.segmented)
        .frame(width: 150)
    }

    /// The lead instrument of a play-along, for its menu item.
    private func leadEmoji(_ label: String) -> String {
        let lead: [(String, String)] = [("fiddle|violin", "🎻"), ("whistle|flute", "🪈"), ("accordion|concertina", "🪗"), ("banjo", "🪕"), ("piano", "🎹"), ("guitar|bouzouki", "🎸")]
        return lead.first { label.range(of: $0.0, options: [.regularExpression, .caseInsensitive]) != nil }?.1 ?? "🎶"
    }
}

/// Three bars bobbing: something is playing.
private struct LiveBars: View {
    @State private var bob = false

    var body: some View {
        HStack(alignment: .bottom, spacing: 3) {
            ForEach(0..<3) { i in
                Capsule().fill(Palette.brandDot).frame(width: 4, height: bob ? [16, 9, 13][i] : [7, 15, 8][i])
                    .animation(.easeInOut(duration: 0.45).repeatForever().delay(Double(i) * 0.12), value: bob)
            }
        }
        .frame(height: 18)
        .onAppear { bob = true }
    }
}
