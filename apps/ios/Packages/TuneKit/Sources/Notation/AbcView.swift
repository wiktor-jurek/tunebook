// Music notation, engraved by the Rust notation engine (crates/notation-core, through ListenCore) and
// drawn natively: Bravura's glyph outlines, staff lines, stems, beams and ties, on a Canvas. No web view:
// a score is laid out in well under a millisecond and draws in the first frame, at its final height.

import CoreText
import DesignSystem
import ListenCore
import SwiftUI

public struct AbcView: View {
    public enum Style: Sendable {
        /// One line: a tune's pickup and first bars (the web's OpeningPhrase).
        case phrase
        /// The whole tune, wrapped for a phone at reading distance (the web's session notation).
        case score
    }

    let abc: String
    let style: Style
    let playback: ScorePlayback?
    /// The reader's zoom: the width a score is laid out at before it is scaled to fit, as abcjs's `staffwidth`
    /// (wider, more bars to a line drawn smaller). nil lays it out for the screen it is on.
    @Environment(\.scoreStaffWidth) private var staffWidth
    @State private var available: CGFloat = 0

    /// With `playback`, the score plays too, and the note playing lights up.
    public init(abc: String, style: Style, playback: ScorePlayback? = nil) {
        self.abc = abc
        self.style = style
        self.playback = playback
    }

    public var body: some View {
        switch style {
        case .phrase:
            // Opening bars at reading size, as wide as they are.
            let engraving = Engravings.shared.phrase(abc)
            let scale = Self.phraseScale
            ScoreCanvas(engraving: engraving, playing: [])
                .frame(width: CGFloat(engraving.width) * scale, height: CGFloat(engraving.height) * scale)
                .frame(maxWidth: 420, alignment: .leading)
                .accessibilityElement()
                .accessibilityLabel("Opening bars")
        case .score:
            // Laid out at the zoom's width (or, as abcjs: 400 on a phone, 760 given room), scaled to the width there is.
            let layoutWidth = staffWidth ?? (available > 600 ? 760 : 400)
            let engraving = Engravings.shared.score(abc, width: layoutWidth)
            ScoreCanvas(engraving: engraving, playing: playback?.playingNotes ?? [])
                .aspectRatio(CGFloat(engraving.width / max(engraving.height, 1)), contentMode: .fit)
                .frame(maxWidth: .infinity)
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { available = $0 }
                .onAppear { playback?.load(abc) }
                .onChange(of: abc) { playback?.load(abc) }
                .accessibilityElement()
                .accessibilityLabel("Score")
        }
    }

    /// Points per staff space for opening bars: as abcjs drew them at its 360 staff width in the phone's column.
    static let phraseScale: CGFloat = 5.8
}

extension EnvironmentValues {
    /// The width scores lay out at before scaling to fit, as the reader zooms: 400 reads large, 760 fits four bars to a line.
    @Entry public var scoreStaffWidth: Int? = nil
}

/// Engravings by tune and width: the engine is fast, but a score redrawn as it plays need not be laid out again.
@MainActor
final class Engravings {
    static let shared = Engravings()
    private var cache: [String: ScoreEngraving] = [:]

    /// abcjs's staff width is in its pixels, about eight to a staff space.
    static let pixelsPerSpace: Float = 8

    func score(_ abc: String, width: Int) -> ScoreEngraving {
        engraving(abc, key: "s\(width)", width: Float(width) / Self.pixelsPerSpace, barsPerLine: width > 480 && width < 700 ? 3 : 4, phrase: 0)
    }

    func phrase(_ abc: String) -> ScoreEngraving {
        engraving(abc, key: "p", width: 45, barsPerLine: 99, phrase: 2)
    }

    private func engraving(_ abc: String, key: String, width: Float, barsPerLine: UInt32, phrase: UInt32) -> ScoreEngraving {
        let id = "\(key)-\(abc)"
        if let cached = cache[id] { return cached }
        if cache.count > 400 { cache.removeAll() }
        let made = engraveScore(abc: abc, staffWidth: width, barsPerLine: barsPerLine, phraseBars: phrase)
        cache[id] = made
        return made
    }
}

/// Draws an engraving to fill its frame (which keeps its aspect), notes playing in the brand's orange.
struct ScoreCanvas: View {
    let engraving: ScoreEngraving
    let playing: Set<UInt32>

    var body: some View {
        Canvas { context, size in
            let s = size.width / CGFloat(max(engraving.width, 1))
            let ink = GraphicsContext.Shading.foreground
            let lit = GraphicsContext.Shading.color(Palette.brandDot)
            func shade(_ note: Int64) -> GraphicsContext.Shading { note >= 0 && playing.contains(UInt32(note)) ? lit : ink }

            for line in engraving.lines {
                var path = Path()
                path.move(to: CGPoint(x: CGFloat(line.x1) * s, y: CGFloat(line.y1) * s))
                path.addLine(to: CGPoint(x: CGFloat(line.x2) * s, y: CGFloat(line.y2) * s))
                context.stroke(path, with: shade(line.note), lineWidth: CGFloat(line.thickness) * s)
            }
            for beam in engraving.beams {
                var path = Path()
                let t = CGFloat(beam.thickness) * s
                path.move(to: CGPoint(x: CGFloat(beam.x1) * s, y: CGFloat(beam.y1) * s))
                path.addLine(to: CGPoint(x: CGFloat(beam.x2) * s, y: CGFloat(beam.y2) * s))
                path.addLine(to: CGPoint(x: CGFloat(beam.x2) * s, y: CGFloat(beam.y2) * s + t))
                path.addLine(to: CGPoint(x: CGFloat(beam.x1) * s, y: CGFloat(beam.y1) * s + t))
                path.closeSubpath()
                context.fill(path, with: ink)
            }
            for arc in engraving.arcs {
                // A crescent: thick in the middle, fine at the ends, as engraved ties are.
                let start = CGPoint(x: CGFloat(arc.x1) * s, y: CGFloat(arc.y1) * s)
                let end = CGPoint(x: CGFloat(arc.x2) * s, y: CGFloat(arc.y2) * s)
                let mid = CGPoint(x: (start.x + end.x) / 2, y: (start.y + end.y) / 2)
                let bulge = CGFloat(arc.bulge) * s * 2
                let thick = CGFloat(arc.thickness) * s * 2 * (arc.bulge < 0 ? 1 : -1)
                var path = Path()
                path.move(to: start)
                path.addQuadCurve(to: end, control: CGPoint(x: mid.x, y: mid.y + bulge))
                path.addQuadCurve(to: start, control: CGPoint(x: mid.x, y: mid.y + bulge + thick))
                path.closeSubpath()
                context.fill(path, with: ink)
            }
            for glyph in engraving.glyphs {
                guard let outline = Bravura.outline(glyph.code) else { continue }
                let scale = s * CGFloat(glyph.scale)
                let placed = outline.applying(CGAffineTransform(scaleX: scale, y: scale)
                    .concatenating(CGAffineTransform(translationX: CGFloat(glyph.x) * s, y: CGFloat(glyph.y) * s)))
                context.fill(placed, with: shade(glyph.note))
            }
            for text in engraving.texts {
                let size = CGFloat(text.size) * s
                let font: Font = switch text.kind {
                case .chord: .system(size: size, weight: .medium)
                case .tuplet: .system(size: size, design: .serif).italic()
                case .ending: .system(size: size)
                }
                context.draw(Text(text.text).font(font), at: CGPoint(x: CGFloat(text.x) * s, y: CGFloat(text.y) * s), anchor: .bottomLeading)
            }
        }
    }
}

/// Bravura's glyph outlines, at one staff space to the unit (a 4-point font), y down; each made once.
@MainActor
enum Bravura {
    private static let font: CTFont? = {
        guard let url = Bundle.module.url(forResource: "Bravura", withExtension: "otf"),
              let provider = CGDataProvider(url: url as CFURL),
              let graphics = CGFont(provider) else { return nil }
        return CTFontCreateWithGraphicsFont(graphics, 4, nil, nil)
    }()
    private static var outlines: [UInt32: Path] = [:]

    static func outline(_ code: UInt32) -> Path? {
        if let made = outlines[code] { return made }
        guard let font, let scalar = UnicodeScalar(code) else { return nil }
        var characters = Array(String(scalar).utf16)
        var glyphs = [CGGlyph](repeating: 0, count: characters.count)
        guard CTFontGetGlyphsForCharacters(font, &characters, &glyphs, characters.count),
              let path = CTFontCreatePathForGlyph(font, glyphs[0], nil) else { return nil }
        // Font outlines are y up; the score's y is down.
        let made = Path(path).applying(CGAffineTransform(scaleX: 1, y: -1))
        outlines[code] = made
        return made
    }
}
