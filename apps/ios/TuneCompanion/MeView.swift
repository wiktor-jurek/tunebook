// Me: your passport as a player, as on the web and Android (from /api/app/me), the way Flighty's passport or
// Polarsteps' profile would have it. A cover that says who you are, the Standards (the 100 tunes every session knows as
// a scratch map of dots, filled with what you can play), your stamps, your sound, standards or rarities, the tunes you
// love and your sessions. Account settings sit behind the cover's gear.

import API
import DesignSystem
import Notation
import SwiftUI

private enum MeRoute: Hashable {
    case tune(SavedTune)
    case session(RecordingSummary)
}

struct MeView: View {
    @Environment(LibraryStore.self) private var library
    @State private var passport: Passport?
    @State private var problem: String?
    @State private var account = false
    @State private var path: [MeRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(spacing: 14) {
                    if !library.signedIn {
                        GhostCover { library.askToSignIn = true }
                    } else if let me = passport {
                        Cover(me: me) { account = true }
                        StandardsPage(standards: me.standards) { id in
                            if let tune = library.tunes.first(where: { $0.id == id }) { path.append(.tune(tune)) }
                        }
                        if let stamps = me.stamps, !stamps.isEmpty { StampsPage(stamps: stamps) }
                        if !me.types.isEmpty { SoundPage(me: me) }
                        if me.popularity.bands.contains(where: { $0.tunes > 0 }) { PopularityPage(me: me) }
                        if !me.favourites.isEmpty { FavouritesPage(me: me) { path.append(.tune($0)) } }
                        SessionsPage(me: me) { night in if let summary = Self.summary(night) { path.append(.session(summary)) } }
                    } else if let problem {
                        ContentUnavailableView("Couldn't load your passport", systemImage: "person.crop.circle", description: Text(problem))
                    } else {
                        ProgressView().padding(48)
                    }
                }
                .padding(16)
            }
            .background(Palette.background)
            .refreshable { await load() }
            .navigationDestination(for: MeRoute.self) { route in
                switch route {
                case let .tune(tune):
                    ScorePage(page: ReaderPage(tune: tune, set: nil, id: tune.id), current: true, playalongs: nil, defaultSound: nil, editable: true, autoplay: false)
                case let .session(summary):
                    RecordingPage(summary: summary)
                }
            }
            .sheet(isPresented: $account) { if let me = passport { AccountSheet(me: me) } }
        }
        // Reloads when you sign in, and when your tunes change (a level set, a tune kept).
        .task(id: "\(library.signedIn)-\(library.tunes.count)-\(library.tunes.map(\.practice.level.rawValue).joined())") { await load() }
    }

    private func load() async {
        guard library.signedIn else { return }
        do { passport = try await library.api.passport(); problem = nil } catch { if passport == nil { problem = error.localizedDescription } }
    }

    /// The biggest night as the Sessions tab lists it, to open its page.
    private static func summary(_ night: Passport.BiggestNight) -> RecordingSummary? {
        let title = RecordingsView.parse(night.recordedAt).map { $0.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(Locale(identifier: "en_GB"))) } ?? ""
        let json: [String: Any] = ["id": night.id, "title": title, "recordedAt": night.recordedAt, "tunes": night.tunes, "firstTunes": [String]()]
        return (try? JSONSerialization.data(withJSONObject: json)).flatMap { try? JSONDecoder().decode(RecordingSummary.self, from: $0) }
    }
}

/// A card on the passport's pages, with its small-caps heading.
private struct Page<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title.uppercased()).font(.caption.weight(.semibold)).tracking(1).foregroundStyle(Palette.text3)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(Palette.card, in: .rect(cornerRadius: 24))
    }
}

/// A line under a page's heading: its bold verdict, then what it means.
private func lede(_ bold: String?, _ rest: String) -> some View {
    (Text(bold.map { "\($0) " } ?? "").bold() + Text(rest)).font(.body)
}

private struct Cover: View {
    let me: Passport
    let onAccount: () -> Void
    @State private var shown = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Text(me.user.name.prefix(1).uppercased()).font(.title3.bold()).foregroundStyle(Palette.onBrandDot)
                    .frame(width: 44, height: 44).background(Palette.brandDot, in: .circle)
                VStack(alignment: .leading, spacing: 2) {
                    Text(me.user.name).font(.headline)
                    if let since = me.user.memberSince.flatMap(RecordingsView.parse) {
                        Text("MEMBER SINCE \(since.formatted(.dateTime.month(.wide).year().locale(Locale(identifier: "en_GB"))).uppercased())")
                            .font(.caption2).tracking(1).opacity(0.7)
                    }
                }
                Spacer()
                Button(action: onAccount) { Image(systemName: "gearshape.fill").font(.title3) }.accessibilityLabel("Account and settings")
            }
            Text(me.headline ?? "Your passport starts with your first tune.").font(.system(size: 32, design: .serif))
                .fixedSize(horizontal: false, vertical: true).padding(.vertical, 20)
            HStack(alignment: .top) {
                number(Double(me.repertoire.playable), "Tunes you can play")
                number(Double(me.sessions.recordings), "Sessions")
                number(Double(me.sessions.minutes) / 60, "Hours at sessions", tenths: me.sessions.minutes < 600)
            }
        }
        .foregroundStyle(Palette.onBrandInk)
        .padding(22)
        .background {
            ZStack {
                Palette.brandInk
                // The faint rings of a passport's security print, from the top right corner.
                Canvas { context, size in
                    var r: CGFloat = 14
                    while r < max(size.width, size.height) * 1.6 {
                        context.stroke(Path(ellipseIn: CGRect(x: size.width * 1.1 - r, y: -size.height * 0.1 - r, width: r * 2, height: r * 2)), with: .color(.white.opacity(0.06)))
                        r += 9
                    }
                }
            }
        }
        .clipShape(.rect(cornerRadius: 28))
        .onAppear { withAnimation(.easeOut(duration: 0.9)) { shown = true } }
    }

    private func number(_ value: Double, _ label: String, tenths: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(tenths ? (shown ? value : 0).formatted(.number.precision(.fractionLength(1))) : "\(Int(shown ? value : 0))")
                .font(.system(size: 34, weight: .semibold, design: .serif)).contentTransition(.numericText(value: shown ? value : 0))
            Text(label).font(.caption).opacity(0.75)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private let levelWords: [FinderTune.Level: String] = [.mastered: "You can lead it", .learned: "You can play along", .learning: "You're learning it",
                                                       .wanted: "On your list", .unlearned: "Saved, not assessed"]

private func levelColour(_ level: FinderTune.Level?) -> Color? {
    switch level {
    case .mastered: Palette.brandInk
    case .learned: Palette.learned
    case .learning, .wanted: Palette.brandDot
    default: nil
    }
}

/// The Standards: the 100 tunes every session knows, a scratch map of dots filled with where you stand.
private struct StandardsPage: View {
    let standards: Passport.Standards?
    let onOpen: (String) -> Void
    @State private var picked: Passport.Standard?

    var body: some View {
        Page(title: "The Standards") {
            if let standards {
                lede(nil, "You can play \(standards.playable) of the \(standards.total) tunes every session knows" + (standards.learning > 0 ? ", and you're learning \(standards.learning) more." : "."))
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 10), spacing: 8) {
                    ForEach(standards.tunes) { tune in
                        let fill = levelColour(tune.level)
                        Circle().fill(fill ?? .clear)
                            .overlay { if fill == nil { Circle().strokeBorder(tune.level == .unlearned ? Palette.brandInk : Palette.lineStrong, lineWidth: 1.5) } }
                            .aspectRatio(1, contentMode: .fit)
                            .scaleEffect(picked == tune ? 1.3 : 1)
                            .onTapGesture { withAnimation(.spring(duration: 0.25)) { picked = picked == tune ? nil : tune } }
                            .accessibilityLabel(displayTitle(tune.title))
                    }
                }
                .frame(maxWidth: 420)
                .sensoryFeedback(.selection, trigger: picked)
                if let tune = picked {
                    HStack {
                        VStack(alignment: .leading) {
                            Text(displayTitle(tune.title)).font(.tuneTitle(.title3))
                            Text([tune.kind?.capitalized, tune.level.flatMap { levelWords[$0] } ?? "Not one of yours yet"].compactMap { $0 }.joined(separator: ". "))
                                .font(.caption).foregroundStyle(Palette.text3)
                        }
                        Spacer()
                        if let id = tune.savedId { Button("Score") { onOpen(id) } }
                    }
                } else {
                    Text("Tap a dot to see the tune.").font(.subheadline).foregroundStyle(Palette.text3)
                }
                HStack(spacing: 12) {
                    ForEach([(FinderTune.Level.mastered, "Can lead"), (.learned, "Can play"), (.learning, "Learning")], id: \.1) { level, label in
                        HStack(spacing: 4) { Circle().fill(levelColour(level)!).frame(width: 9, height: 9); Text(label) }
                    }
                    HStack(spacing: 4) { Circle().strokeBorder(Palette.brandInk, lineWidth: 1.2).frame(width: 9, height: 9); Text("Saved") }
                }
                .font(.caption2).foregroundStyle(Palette.text3)
            }
        }
    }
}

/// Passport stamps: earned ones inked (and pressed in, the first time they're seen), the rest ghosted with how far to go.
private struct StampsPage: View {
    let stamps: [Passport.Stamp]
    @AppStorage("seenStamps") private var seen = ""
    @State private var fresh: [String] = []

    var body: some View {
        Page(title: "Stamps") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 14) {
                    ForEach(Array(stamps.enumerated()), id: \.element.id) { i, stamp in
                        StampView(stamp: stamp, ink: [Palette.danger, Palette.brandDot, Palette.brandInk][i % 3], tilt: [-7, 4, -3, 6, -5, 3][i % 6],
                                  landIn: fresh.firstIndex(of: stamp.id))
                    }
                }
                .padding(.vertical, 6)
            }
        }
        .onAppear {
            let before = Set(seen.split(separator: ",").map(String.init))
            let earned = stamps.filter(\.earned).map(\.id)
            fresh = earned.filter { !before.contains($0) }
            seen = before.union(earned).joined(separator: ",")
        }
    }
}

private struct StampView: View {
    let stamp: Passport.Stamp
    let ink: Color
    let tilt: Double
    let landIn: Int?
    @State private var landed = false

    var body: some View {
        let colour = stamp.earned ? ink : Palette.text4
        VStack(spacing: 6) {
            ZStack {
                if stamp.earned {
                    Circle().strokeBorder(colour, lineWidth: 2.5)
                    Circle().strokeBorder(colour, lineWidth: 1).padding(5)
                } else {
                    Circle().strokeBorder(colour, style: StrokeStyle(lineWidth: 2, dash: [7, 5]))
                }
                VStack(spacing: 2) {
                    Text(stamp.title.uppercased()).font(.system(size: 11, weight: .bold)).tracking(0.6).multilineTextAlignment(.center)
                    Text(stamp.at.flatMap(RecordingsView.parse).map { $0.formatted(.dateTime.day().month(.abbreviated).year()) }
                         ?? stamp.progress.map { "\($0.have) of \($0.need)" } ?? "Not yet").font(.system(size: 10))
                }
                .foregroundStyle(colour)
                .padding(.horizontal, 12)
            }
            .frame(width: 100, height: 100)
            .rotationEffect(.degrees(tilt))
            .scaleEffect(landIn == nil || landed ? 1 : 1.6)
            .opacity(landIn == nil || landed ? 1 : 0)
            Text(stamp.line).font(.caption).foregroundStyle(Palette.text3).multilineTextAlignment(.center).lineLimit(3)
        }
        .frame(width: 112)
        .task {
            guard let landIn else { return }
            try? await Task.sleep(for: .milliseconds(300 + landIn * 140))
            withAnimation(.spring(response: 0.45, dampingFraction: 0.5)) { landed = true }
        }
        .sensoryFeedback(.impact(weight: .medium), trigger: landed)
    }
}

/// Your sound: the type you play most, every type ranked, and your home key.
private struct SoundPage: View {
    let me: Passport
    var body: some View {
        Page(title: "Your sound") {
            if let type = me.personas.type { lede("\(type.title).", type.line) }
            let most = max(1, me.types.map(\.total).max() ?? 1)
            ForEach(me.types.prefix(6), id: \.kind) { type in
                HStack(spacing: 12) {
                    Text("\(type.kind.capitalized)s").font(.subheadline.weight(.medium)).frame(width: 96, alignment: .leading)
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Palette.muted)
                            Capsule().fill(Palette.brandDotSoft).frame(width: geometry.size.width * Double(type.total) / Double(most))
                            Capsule().fill(Palette.brandDot).frame(width: geometry.size.width * Double(type.playable) / Double(most))
                        }
                    }
                    .frame(height: 10)
                    Text("\(type.playable) of \(type.total)").font(.caption).foregroundStyle(Palette.text3).frame(width: 60, alignment: .trailing)
                }
            }
            if let home = me.keys.first {
                FlowLayout(spacing: 8) {
                    Text("Your home key: \(keyName(home.mode))").font(.caption.weight(.semibold)).foregroundStyle(Palette.brandInk)
                        .padding(.horizontal, 12).padding(.vertical, 6).background(Palette.brandInkSoft, in: .capsule)
                    ForEach(me.keys.dropFirst(), id: \.mode) { key in
                        Text(keyName(key.mode)).font(.caption).foregroundStyle(Palette.mutedForeground)
                            .padding(.horizontal, 12).padding(.vertical, 6).background(Palette.muted, in: .capsule)
                    }
                }
                .padding(.top, 6)
            }
        }
    }
}

/// Standards or rarities: where your tunes sit among every tune on The Session.
private struct PopularityPage: View {
    let me: Passport
    var body: some View {
        Page(title: "Standards or rarities") {
            if let persona = me.personas.popularity { lede("\(persona.title).", persona.line) }
            let most = max(1, me.popularity.bands.map(\.tunes).max() ?? 1)
            HStack(alignment: .bottom, spacing: 8) {
                ForEach(me.popularity.bands, id: \.band) { band in
                    VStack(spacing: 4) {
                        Text("\(band.tunes)").font(.caption.weight(.semibold))
                        RoundedRectangle(cornerRadius: 8).fill(band.band >= 4 ? Palette.brandDot : Palette.brandInk)
                            .frame(height: max(4, 72 * Double(band.tunes) / Double(most)))
                        Text(band.label).font(.caption2).foregroundStyle(Palette.text3).lineLimit(1).minimumScaleFactor(0.7)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 120, alignment: .bottom)
            if let rarest = me.popularity.rarest { Text("Your rarest: \(displayTitle(rarest.title))").font(.subheadline) }
        }
    }
}

/// The tunes you love, side by side, each with its opening bars.
private struct FavouritesPage: View {
    let me: Passport
    let onOpen: (SavedTune) -> Void
    var body: some View {
        Page(title: "Tunes you love") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(me.favourites) { favourite in
                        let tune = favourite.tune
                        Button { onOpen(tune) } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text([tune.emoji, displayTitle(tune.title)].compactMap { $0 }.joined(separator: " ")).font(.tuneTitle(.title3)).lineLimit(1)
                                Text([favourite.starred > 0 ? "Often played in your tunebooks" : nil,
                                      favourite.heard > 0 ? (favourite.heard == 1 ? "Heard once" : "Heard \(favourite.heard) times") : nil]
                                    .compactMap { $0 }.joined(separator: ", ").ifEmpty("You can lead it"))
                                    .font(.caption).foregroundStyle(Palette.text3)
                                AbcView(abc: Abc.openingPhrase(AbcTune(title: tune.title, kind: tune.kind, meter: tune.meter, mode: tune.mode, abc: tune.abc)), style: .phrase)
                            }
                            .frame(width: 250, alignment: .leading)
                            .padding(14)
                            .background(Palette.muted, in: .rect(cornerRadius: 18))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

/// At sessions: how often you go (the last twelve months), your biggest night, and the tune you hear most.
private struct SessionsPage: View {
    let me: Passport
    let onNight: (Passport.BiggestNight) -> Void
    var body: some View {
        let s = me.sessions
        Page(title: "At sessions") {
            if s.recordings == 0 {
                Text("Record a session and it shows here: how often you go, your biggest nights, the tunes you hear most.")
            } else {
                HStack(alignment: .top) {
                    stat("\(s.recordings)", "Sessions")
                    stat((Double(s.minutes) / 60).formatted(.number.precision(.fractionLength(1))), "Hours")
                    stat("\(s.tunesHeard)", "Tunes heard")
                }
                if let months = s.byMonth, !months.isEmpty {
                    let most = max(1, months.map(\.sessions).max() ?? 1)
                    HStack(alignment: .bottom, spacing: 6) {
                        ForEach(months, id: \.month) { month in
                            VStack(spacing: 4) {
                                RoundedRectangle(cornerRadius: 5).fill(month.sessions == 0 ? Palette.muted : Palette.danger)
                                    .frame(maxWidth: 22).frame(height: month.sessions == 0 ? 4 : 80 * (0.12 + 0.88 * Double(month.sessions) / Double(most)))
                                Text(monthLetter(month.month)).font(.caption2).foregroundStyle(Palette.text3)
                            }
                            .frame(maxWidth: .infinity)
                        }
                    }
                    .frame(height: 100, alignment: .bottom)
                }
                if let night = s.biggestNight {
                    Button { onNight(night) } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Biggest night").font(.caption).foregroundStyle(Palette.text3)
                                Text("\(RecordingsView.parse(night.recordedAt).map { sessionName($0) } ?? "A session"), \(night.tunes) tunes").font(.tuneTitle(.headline))
                            }
                            Spacer()
                            Image(systemName: "chevron.right").foregroundStyle(Palette.text3)
                        }
                    }
                    .buttonStyle(.plain)
                }
                if let most = s.mostHeard { Text("Heard most: \(displayTitle(most.title)), \(most.times) times").font(.subheadline) }
            }
        }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.system(.title2, design: .serif).weight(.semibold))
            Text(label).font(.caption).foregroundStyle(Palette.text3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func monthLetter(_ month: String) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM"
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter.date(from: month).map { String($0.formatted(.dateTime.month(.narrow).locale(Locale(identifier: "en_GB")))) } ?? ""
    }
}

/// Signed out: an empty passport, waiting for its first stamp.
private struct GhostCover: View {
    let onSignIn: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("YOUR PASSPORT").font(.caption2).tracking(1).opacity(0.7)
            Text("What kind of player are you?").font(.system(size: 32, design: .serif))
            Text("Sign in and every tune you learn and every session you record fills it in: the standards you know, the stamps you collect, the tunes you love.")
                .font(.subheadline).opacity(0.8)
            Button("Sign in to start your passport", action: onSignIn).buttonStyle(.borderedProminent).tint(Palette.brandDot)
        }
        .foregroundStyle(Palette.onBrandInk)
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.brandInk, in: .rect(cornerRadius: 28))
    }
}

/// Account, behind the cover's gear: who is signed in, and signing out.
private struct AccountSheet: View {
    @Environment(LibraryStore.self) private var library
    @Environment(\.dismiss) private var dismiss
    let me: Passport
    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(me.user.name).font(.title3)
                        Text(me.user.email).foregroundStyle(Palette.text3)
                        Text("\(me.repertoire.tunes) tunes saved, in \(me.repertoire.tunebooks) \(me.repertoire.tunebooks == 1 ? "tunebook" : "tunebooks")")
                            .font(.caption).foregroundStyle(Palette.text3)
                    }
                }
                Section {
                    Button("Sign out", role: .destructive) { Task { await library.signOut(); dismiss() } }
                }
            }
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }
}

private extension String {
    func ifEmpty(_ fallback: String) -> String { isEmpty ? fallback : self }
}

/// Lays its children out in rows, wrapping to the next when a row is full (the keys' chips).
private struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width { y += row + spacing; x = 0; row = 0 }
            x += size.width + spacing; row = max(row, size.height); widest = max(widest, x - spacing)
        }
        return CGSize(width: widest, height: y + row)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX { y += row + spacing; x = bounds.minX; row = 0 }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing; row = max(row, size.height)
        }
    }
}
