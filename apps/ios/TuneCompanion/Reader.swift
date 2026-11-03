// The reader, as the phone's web SessionBook: a list's tunes as full-screen scores, swiped through.
// The bar names the tune, says where it is ("3 of 12", which opens every tune to jump to) and finds
// one by name. Only the tune on screen plays, from its island; its neighbours are drawn ready.

import API
import DesignSystem
import Notation
import SwiftUI

struct ReaderPage: Identifiable, Hashable {
    let tune: SavedTune
    /// The set it is played in, if any.
    let set: String?
    let id: String
}

struct Reader: View {
    @Environment(\.dismiss) private var dismiss
    let name: String
    let pages: [ReaderPage]
    /// Play-alongs by setting ID, when the list already has them (a tunebook); otherwise each page fetches its own.
    var playalongs: [Int: [PlayalongTrack]]?
    var defaultSound: Int?
    /// Whether progress can be set: the tunes are yours.
    var editable = true
    @State var at: Int
    @State private var searching = false

    var body: some View {
        NavigationStack {
            TabView(selection: $at) {
                ForEach(Array(pages.enumerated()), id: \.element.id) { index, page in
                    Group {
                        if abs(index - at) <= 1 {
                            ScorePage(page: page, current: index == at, playalongs: playalongs?[page.tune.settingId],
                                      defaultSound: defaultSound, editable: editable)
                        } else {
                            Color.clear
                        }
                    }
                    .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .background(Palette.card)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                }
                ToolbarItem(placement: .principal) {
                    if pages.count > 1 {
                        Menu {
                            Picker("Tune", selection: $at) {
                                ForEach(Array(pages.enumerated()), id: \.element.id) { index, page in
                                    Text(page.tune.displayTitle).tag(index)
                                }
                            }
                        } label: {
                            Text("\(at + 1) of \(pages.count)").font(.subheadline.weight(.semibold)).monospacedDigit()
                        }
                        .accessibilityLabel("Tune \(at + 1) of \(pages.count). Jump to another")
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    if pages.count > 1 { Button("Find a tune", systemImage: "magnifyingglass") { searching = true } }
                }
            }
            .sheet(isPresented: $searching) { ReaderSearch(pages: pages) { at = $0 } }
            .sensoryFeedback(.selection, trigger: at)
        }
        // The phone is propped on a music stand or a pint glass: the screen stays on.
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }
}

/// Type part of a tune's name to find it in this list.
private struct ReaderSearch: View {
    @Environment(\.dismiss) private var dismiss
    let pages: [ReaderPage]
    let pick: (Int) -> Void
    @State private var query = ""

    var body: some View {
        NavigationStack {
            let matches = pages.indices.filter { query.isEmpty || pages[$0].tune.matches(query) }
            List(matches, id: \.self) { index in
                Button { pick(index); dismiss() } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(pages[index].tune.displayTitle).font(.tuneTitle(.headline))
                        Text(pages[index].tune.meta(groupedBy: .none)).font(.caption).foregroundStyle(Palette.text3)
                    }
                }
                .tint(Palette.foreground)
            }
            .overlay { if matches.isEmpty { ContentUnavailableView("No tune called that in this list.", systemImage: "magnifyingglass") } }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Find a tune")
            .navigationTitle("Find a tune")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

/// The two dots and bars of a repeat sign: the mark of a set.
struct RepeatMark: View {
    var body: some View {
        HStack(spacing: 1.5) {
            VStack(spacing: 4) { Circle().frame(width: 3, height: 3); Circle().frame(width: 3, height: 3) }
                .foregroundStyle(Palette.brandDot)
            RoundedRectangle(cornerRadius: 0.5).fill(Palette.brandInk).frame(width: 1.5, height: 14)
            RoundedRectangle(cornerRadius: 0.5).fill(Palette.brandInk).frame(width: 3, height: 14)
        }
        .accessibilityHidden(true)
    }
}
