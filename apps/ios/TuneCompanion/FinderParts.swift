// The pieces of the tune finder the answer card and the deck share, as the web's finder-parts.tsx:
// a named tune's answer, other close matches, a tune row, quick search, tonight's list and a score.

import API
import DesignSystem
import Notation
import SwiftUI

extension FinderTune {
    var abcTune: AbcTune? { abc.map { AbcTune(title: title, kind: kind, meter: meter, mode: mode, abc: $0) } }

    /// "can play along, in Madrid Session" or "in your library", to follow other details.
    var standing: String {
        var parts: [String] = []
        switch level {
        case .wanted: parts.append("want to learn")
        case .learning: parts.append("learning")
        case .learned: parts.append("can play along")
        case .mastered: parts.append("can lead")
        default: break
        }
        let books = inBooks ?? []
        if books.count == 1 { parts.append("in \(books[0].name)") } else if books.count > 1 { parts.append("in \(books.count) of your tunebooks") }
        else if savedId != nil, (level ?? .unlearned) == .unlearned { parts.append("in your library") }
        return parts.joined(separator: ", ")
    }
}

/// How a tune starts, as one line of music.
struct OpeningPhrase: View {
    let tune: FinderTune

    var body: some View {
        if let abc = tune.abcTune { AbcView(abc: Abc.openingPhrase(abc), style: .phrase) }
    }
}

/// A named tune: whether it is sure, the title as people say it, where it stands for you, and how it starts.
struct FinderAnswer: View {
    @Environment(ListenModel.self) private var listen
    let tune: FinderTune
    let sure: Bool

    var body: some View {
        VStack(spacing: 4) {
            if !sure {
                Text("Possible match").font(.footnote.weight(.semibold)).foregroundStyle(Palette.brandDotText)
            }
            Text(tune.displayTitle)
                .font(.system(size: 34, design: .serif))
                .tracking(-0.8)
                .multilineTextAlignment(.center)
            Text(tune.meta).font(.footnote).foregroundStyle(Palette.text3)
            if !tune.standingSentence.isEmpty {
                Text(tune.standingSentence)
                    .font(.footnote.weight(tune.isKnown ? .semibold : .regular))
                    .foregroundStyle(tune.isKnown ? Palette.brandInk : Palette.mutedForeground)
                    .padding(.top, 4)
            }
            OpeningPhrase(tune: tune).padding(.top, 14)
            if tune.savedId == nil {
                Text("Opening bars of The Session's setting, not a transcription")
                    .font(.caption).foregroundStyle(Palette.text3).padding(.top, 2)
            }
            let open = Button("Open full score", systemImage: "music.note") { listen.openScore(tune) }
                .buttonStyle(.borderedProminent)
                .tint(Palette.brandInk)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { open; LearnLater(tune: tune) }
                VStack(spacing: 8) { open; LearnLater(tune: tune) }
            }
            .lineLimit(1)
            .padding(.top, 10)
        }
        .frame(maxWidth: .infinity)
    }
}

/// Other candidates, with how they start: at once when the finder is unsure, behind "Not it?" when it is sure.
struct FinderAlternatives: View {
    @Environment(ListenModel.self) private var listen
    let sure: Bool
    @State private var open = false

    var body: some View {
        if !listen.alternatives.isEmpty {
            VStack(spacing: 10) {
                if sure {
                    Button(open ? "Hide other matches" : "Not it?") { withAnimation(Motion.standard) { open.toggle() } }
                        .font(.subheadline)
                        .tint(Palette.brandInk)
                }
                if open || !sure {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(sure ? "Other close matches" : "Or it could be")
                            .font(.footnote.weight(.semibold)).foregroundStyle(Palette.text3)
                        ForEach(listen.alternatives.prefix(sure ? 4 : 2)) { tune in
                            Divider().padding(.vertical, 8)
                            FinderRow(tune: tune, detail: tune.meta, phrase: true)
                        }
                    }
                    if listen.isLive {
                        Button("Listen again from here") { listen.restart(); open = false }.font(.subheadline).tint(Palette.brandInk)
                    }
                }
            }
        }
    }
}

struct FinderRow: View {
    @Environment(ListenModel.self) private var listen
    let tune: FinderTune
    let detail: String
    var phrase = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(tune.displayTitle).font(.tuneTitle(.title3))
                    Text(detail).font(.caption).foregroundStyle(Palette.text3)
                    if !tune.standing.isEmpty { Text(tune.standing).font(.caption).foregroundStyle(Palette.text3) }
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 4) {
                    Button("Score", systemImage: "music.note") { listen.openScore(tune) }
                        .buttonStyle(.borderless)
                        .tint(Palette.foreground)
                    LearnLater(tune: tune, quiet: true)
                }
                .font(.subheadline)
            }
            if phrase { OpeningPhrase(tune: tune) }
        }
    }
}

/// For a tune someone names out loud; results show exactly like a heard tune.
struct FinderSearch: View {
    @Environment(ListenModel.self) private var listen
    @State private var query = ""
    @State private var found: [FinderTune]?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Quick search").font(.footnote.weight(.semibold)).foregroundStyle(Palette.text3)
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(Palette.text3)
                TextField("Search scores by tune name", text: $query)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    .accessibilityLabel("Search the scores of every tune on The Session, by name")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(Palette.muted, in: .rect(cornerRadius: Radius.row))
            if let found {
                if found.isEmpty {
                    Text("No tune by that name on The Session.").font(.caption).foregroundStyle(Palette.text3)
                } else {
                    ForEach(found) { tune in
                        FinderRow(tune: tune, detail: tune.meta)
                        Divider()
                    }
                }
            }
        }
        .task(id: query) {
            let text = query.trimmingCharacters(in: .whitespaces)
            guard text.count >= 2 else { found = nil; return }
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            found = (try? await listen.api.searchTunes(text)) ?? []
        }
    }
}

/// Tonight's tunes, each once with when it was last heard, and a recap of how many you already know.
struct FinderHeard: View {
    @Environment(ListenModel.self) private var listen
    @Environment(LibraryStore.self) private var library
    @State private var problem: String?

    var body: some View {
        let tunes = unique
        if !tunes.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("Heard").font(.footnote.weight(.semibold)).foregroundStyle(Palette.text3)
                if tunes.count > 1 { Text(recap(tunes.map(\.last.tune))).font(.footnote).foregroundStyle(Palette.mutedForeground) }
                ForEach(tunes, id: \.last.id) { entry in
                    FinderRow(tune: entry.last.tune, detail: [entry.last.tune.meta, entry.last.at.formatted(date: .omitted, time: .shortened),
                                                               entry.times > 1 ? "\(entry.times) times" : nil].compactMap { $0 }.joined(separator: ", "))
                    Divider()
                }
                HStack {
                    if library.signedIn {
                        Button(listen.makingBook ? "Making the tunebook" : "Make a tunebook of these", systemImage: "book.closed") {
                            Task {
                                problem = nil
                                do {
                                    let id = try await listen.makeBook()
                                    listen.clearHeard()
                                    listen.deckOpen = false
                                    library.open(bookId: id, name: "Tonight's tunes")
                                } catch {
                                    problem = "Could not make the tunebook. Try again."
                                }
                            }
                        }
                        .buttonStyle(.bordered)
                        .disabled(listen.makingBook)
                    }
                    Button("Clear") { listen.clearHeard() }
                }
                .font(.subheadline)
                .tint(Palette.brandInk)
                if let problem { Text(problem).font(.footnote).foregroundStyle(Palette.danger) }
            }
        }
    }

    private var unique: [(last: HeardTune, times: Int)] {
        var seen: [Int: Int] = [:], order: [(last: HeardTune, times: Int)] = []
        for heard in listen.heard {
            if let index = seen[heard.tune.tuneId] { order[index].times += 1 } else {
                seen[heard.tune.tuneId] = order.count
                order.append((heard, 1))
            }
        }
        return order
    }

    private func recap(_ tunes: [FinderTune]) -> String {
        let known = tunes.filter(\.isKnown).count, wanted = tunes.filter { $0.level == .wanted }.count
        let list = wanted > 0 ? ", and \(wanted) \(wanted == 1 ? "is" : "are") on your list to learn" : ""
        return "You heard \(tunes.count) tunes. You can play along with \(known)\(list)."
    }
}

/// One tap to keep a tune for later: saved and marked Want to learn. Nothing for a tune already known.
/// `quiet` (in a list) is a plain text button, like Score beside it; the answer's own is outlined.
struct LearnLater: View {
    @Environment(ListenModel.self) private var listen
    @Environment(LibraryStore.self) private var library
    let tune: FinderTune
    var quiet = false

    var body: some View {
        if tune.isKnown {
            EmptyView()
        } else if tune.level == .wanted {
            Label("On your list", systemImage: "checkmark").font(.subheadline).foregroundStyle(Palette.brandInk)
        } else {
            let button = Button(listen.saving == tune.tuneId ? "Saving" : "Learn later", systemImage: "bookmark") {
                if library.signedIn { Task { await listen.learnLater(tune) } } else { library.askToSignIn = true }
            }
            .disabled(listen.saving == tune.tuneId)
            .tint(Palette.brandInk)
            if quiet { button.buttonStyle(.borderless) } else { button.buttonStyle(.bordered) }
        }
    }
}

/// A named tune, as a card: the answer and, below it, other close matches.
struct AnswerSheet: View {
    @Environment(ListenModel.self) private var listen

    var body: some View {
        ScrollView {
            if let tune = listen.leader {
                VStack(spacing: 18) {
                    FinderAnswer(tune: tune, sure: listen.leaderSure)
                    FinderAlternatives(sure: listen.leaderSure)
                }
                .padding(.horizontal, 24)
                .padding(.top, 28)
                .padding(.bottom, 24)
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Palette.card)
    }
}

/// A tune's whole score: a heard or searched tune, or one of yours.
struct ScoreScreen: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let meta: String
    let abc: AbcTune?
    let note: String?

    init(tune: FinderTune) {
        title = tune.displayTitle
        meta = [tune.meta, tune.standing].filter { !$0.isEmpty }.joined(separator: ", ")
        abc = tune.abcTune
        note = tune.savedId != nil ? "Your setting of this tune." : "The Session's first setting of this tune. Other settings are on The Session."
    }

    init(tune: SavedTune) {
        title = tune.displayTitle
        meta = [tune.meta(groupedBy: .none), tune.practice.level == .unlearned ? nil : tune.practice.level.label.lowercased()]
            .compactMap { $0 }.joined(separator: ", ")
        abc = AbcTune(title: tune.title, kind: tune.kind, meter: tune.meter, mode: tune.mode, abc: tune.abc)
        note = nil
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    Text(title).font(.system(size: 34, design: .serif)).tracking(-0.8)
                    if !meta.isEmpty { Text(meta).font(.footnote).foregroundStyle(Palette.text3) }
                    if let abc { AbcView(abc: Abc.forScore(abc), style: .score).padding(.top, 16) }
                    if let note { Text(note).font(.caption).foregroundStyle(Palette.text3).padding(.top, 12) }
                }
                .padding(20)
            }
            .background(Palette.card)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done", systemImage: "xmark") { dismiss() } }
            }
        }
    }
}
