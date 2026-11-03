// The open deck, as the web's: the record button, then quick search and tonight's tunes; while a
// session records, its clock and the live setlist, newest first, with the tune playing now open on
// its opening bars. A tune swiped away was named wrongly.

import API
import DesignSystem
import SwiftUI

struct DeckView: View {
    @Environment(ListenModel.self) private var listen
    @Environment(LibraryStore.self) private var library
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    recorder
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                }
                if listen.isRecording {
                    LiveSetlist()
                } else {
                    Section { FinderSearch() }.listRowBackground(Color.clear).listRowSeparator(.hidden)
                    Section { FinderHeard() }.listRowBackground(Color.clear).listRowSeparator(.hidden)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Palette.card)
            .navigationTitle(listen.isRecording ? "Live session" : "Record a session")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button { dismiss() } label: {
                        ZStack {
                            if listen.peeking { Countdown() }
                            Image(systemName: "chevron.down")
                        }
                    }
                    .accessibilityLabel(listen.peeking ? "Fold the deck down now (it folds by itself in a moment)" : "Fold the deck down")
                }
            }
        }
        // Any touch keeps a deck that opened for a new tune from folding itself away.
        .simultaneousGesture(TapGesture().onEnded { listen.stopPeeking() })
        .simultaneousGesture(DragGesture(minimumDistance: 4).onChanged { _ in listen.stopPeeking() })
    }

    private var recorder: some View {
        HStack(alignment: .center, spacing: 20) {
            FinderDial(size: .record) {
                if listen.isRecording { listen.stop() } else { listen.startSession() }
            }
            .padding(10)
            if listen.isRecording, let start = listen.sessionStartedAt {
                VStack(alignment: .leading, spacing: 6) {
                    TimelineView(.periodic(from: .now, by: 1)) { _ in
                        Text(clock(Date.now.timeIntervalSince(start))).font(.system(size: 28, weight: .semibold)).monospacedDigit()
                    }
                    Text(listen.recording != nil ? "The screen stays on. Tap Stop to finish and upload." : "The screen stays on. Tap Stop to finish.")
                        .font(.footnote).foregroundStyle(Palette.mutedForeground)
                    Button("Dim the screen", systemImage: "moon") { dismiss(); listen.dimmed = true }
                        .font(.footnote).buttonStyle(.borderless).tint(Palette.foreground)
                }
            } else {
                Text(library.signedIn ? "Records the whole session and names each tune as it goes. Tap any tune for its music."
                     : "Names each tune as the session goes, into tonight's list. Sign in to keep the recording too.")
                    .font(.footnote).foregroundStyle(Palette.mutedForeground)
            }
        }
        .padding(.vertical, 8)
    }
}

/// A live session's tunes, newest first. One is open with its opening bars: the tune playing now, until another is tapped.
private struct LiveSetlist: View {
    @Environment(ListenModel.self) private var listen
    @State private var chosen: (id: String, newest: String)?

    var body: some View {
        let tonight = listen.tonight
        if tonight.isEmpty {
            HStack(spacing: 8) {
                Text("Listening for the first tune").font(.subheadline).foregroundStyle(Palette.mutedForeground)
                HoppingDots()
            }
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        } else {
            let newest = tonight[0].id
            let openId = chosen.flatMap { pick in pick.newest == newest && tonight.contains { $0.id == pick.id } ? pick.id : nil } ?? newest
            ForEach(Array(tonight.enumerated()), id: \.element.id) { index, heard in
                if index == 1 {
                    Text("Played tonight").font(.footnote.weight(.semibold)).foregroundStyle(Palette.text3)
                        .listRowBackground(Color.clear).listRowSeparator(.hidden)
                }
                SetlistItem(heard: heard, now: index == 0, open: heard.id == openId) {
                    if heard.id == openId { listen.openScore(heard.tune) } else {
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { chosen = (heard.id, newest) }
                    }
                }
                .listRowBackground(Color.clear)
                .swipeActions(edge: .trailing) {
                    Button("Not this tune", systemImage: "xmark", role: .destructive) { listen.reject(heard) }
                }
                .swipeActions(edge: .leading) {
                    Button("Not this tune", systemImage: "xmark", role: .destructive) { listen.reject(heard) }
                }
            }
        }
    }
}

private struct SetlistItem: View {
    let heard: HeardTune
    let now: Bool
    let open: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 3) {
                if open || now {
                    Text(now ? "Now playing" : "Played at \(heard.at.formatted(date: .omitted, time: .shortened))")
                        .font(.caption.weight(.semibold)).foregroundStyle(Palette.brandDotText)
                }
                Text(heard.tune.displayTitle).font(.tuneTitle(open ? .title2 : .title3))
                Text([heard.tune.meta, heard.tune.standing, open || now ? "" : heard.at.formatted(date: .omitted, time: .shortened)]
                    .filter { !$0.isEmpty }.joined(separator: ", "))
                    .font(.caption).foregroundStyle(Palette.text3)
                if open {
                    OpeningPhrase(tune: heard.tune).padding(.top, 8)
                    Text("Tap for the full score. Swipe it away if it is wrong.")
                        .font(.caption).foregroundStyle(Palette.text3).padding(.top, 2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 6)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityHint(open ? "Opens the full score" : "Shows its opening bars")
    }
}

/// A ring that runs down to when a deck opened by a new tune folds itself away.
private struct Countdown: View {
    @State private var left = 1.0

    var body: some View {
        Circle()
            .trim(from: 0, to: left)
            .stroke(Palette.brandDot, style: StrokeStyle(lineWidth: 2, lineCap: .round))
            .rotationEffect(.degrees(-90))
            .frame(width: 30, height: 30)
            .onAppear { withAnimation(.linear(duration: 5)) { left = 0 } }
    }
}

/// The screen dimmed while a session records: black, the clock low and faint, a tap wakes it.
struct PocketView: View {
    @Environment(ListenModel.self) private var listen

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.ignoresSafeArea()
            if let start = listen.sessionStartedAt {
                TimelineView(.periodic(from: .now, by: 1)) { _ in
                    Text("Recording \(clock(Date.now.timeIntervalSince(start)))")
                        .font(.footnote).monospacedDigit().foregroundStyle(Color(white: 0.35))
                }
                .padding(.bottom, 48)
            }
        }
        .contentShape(.rect)
        .onTapGesture { listen.dimmed = false }
        .accessibilityLabel("Wake the screen")
        .accessibilityAddTraits(.isButton)
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
    }
}
