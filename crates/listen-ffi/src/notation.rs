//! The notation engine as the apps see it: a score engraved for drawing, and its notes for playing.
//! Flat records, in staff spaces (see `notation_core::engrave`).

use notation_core::engrave::TextKind;

#[derive(uniffi::Record, Debug, Clone)]
pub struct ScoreGlyph {
    /// A SMuFL code point, drawn in Bravura at 4 staff spaces to the em, baseline at `y`.
    pub code: u32,
    pub x: f32,
    pub y: f32,
    pub scale: f32,
    /// The note it belongs to (lit up while it plays), or -1.
    pub note: i64,
}

#[derive(uniffi::Record, Debug, Clone)]
pub struct ScoreLine {
    pub x1: f32,
    pub y1: f32,
    pub x2: f32,
    pub y2: f32,
    pub thickness: f32,
    pub note: i64,
}

#[derive(uniffi::Record, Debug, Clone)]
pub struct ScoreBeam {
    pub x1: f32,
    pub y1: f32,
    pub x2: f32,
    pub y2: f32,
    /// Depth of the band, downwards if positive.
    pub thickness: f32,
}

#[derive(uniffi::Record, Debug, Clone)]
pub struct ScoreArc {
    pub x1: f32,
    pub y1: f32,
    pub x2: f32,
    pub y2: f32,
    /// How far it bows from the straight line, upwards if negative.
    pub bulge: f32,
    pub thickness: f32,
}

#[derive(uniffi::Enum, Debug, Clone, Copy)]
pub enum ScoreTextKind {
    Chord,
    Tuplet,
    Ending,
}

#[derive(uniffi::Record, Debug, Clone)]
pub struct ScoreText {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub size: f32,
    pub kind: ScoreTextKind,
}

#[derive(uniffi::Record, Debug, Clone)]
pub struct ScoreNoteBox {
    pub id: u32,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(uniffi::Record, Debug, Clone)]
pub struct ScoreEngraving {
    pub width: f32,
    pub height: f32,
    pub glyphs: Vec<ScoreGlyph>,
    pub lines: Vec<ScoreLine>,
    pub beams: Vec<ScoreBeam>,
    pub arcs: Vec<ScoreArc>,
    pub texts: Vec<ScoreText>,
    pub notes: Vec<ScoreNoteBox>,
}

#[derive(uniffi::Record, Debug, Clone)]
pub struct ScoreEvent {
    /// Start and length in whole notes, from the start of the tune as played (repeats followed).
    pub start: f64,
    pub duration: f64,
    /// MIDI notes; empty for a rest.
    pub midi: Vec<i32>,
    /// The note or rest to light up (`ScoreGlyph::note`).
    pub id: u32,
}

/// A tune's ABC (with headers) engraved `staff_width` staff spaces wide, up to `bars_per_line` bars a line;
/// `phrase_bars` > 0 gives only its opening (any pickup and that many bars) on one line.
#[uniffi::export]
pub fn engrave_score(abc: String, staff_width: f32, bars_per_line: u32, phrase_bars: u32) -> ScoreEngraving {
    let tune = notation_core::parse(&abc);
    let e = notation_core::engrave(&tune, &notation_core::LayoutOptions { staff_width, bars_per_line, phrase_bars });
    let note = |id: Option<u32>| id.map_or(-1, i64::from);
    ScoreEngraving {
        width: e.width,
        height: e.height,
        glyphs: e
            .glyphs
            .iter()
            .map(|g| ScoreGlyph { code: g.code, x: g.x, y: g.y, scale: g.scale, note: note(g.note) })
            .collect(),
        lines: e
            .lines
            .iter()
            .map(|l| ScoreLine { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, thickness: l.thickness, note: note(l.note) })
            .collect(),
        beams: e
            .beams
            .iter()
            .map(|b| ScoreBeam { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, thickness: b.thickness })
            .collect(),
        arcs: e
            .arcs
            .iter()
            .map(|a| ScoreArc { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, bulge: a.bulge, thickness: a.thickness })
            .collect(),
        texts: e
            .texts
            .iter()
            .map(|t| ScoreText {
                text: t.text.clone(),
                x: t.x,
                y: t.y,
                size: t.size,
                kind: match t.kind {
                    TextKind::Chord => ScoreTextKind::Chord,
                    TextKind::Tuplet => ScoreTextKind::Tuplet,
                    TextKind::Ending => ScoreTextKind::Ending,
                },
            })
            .collect(),
        notes: e
            .notes
            .iter()
            .map(|n| ScoreNoteBox { id: n.id, x: n.x, y: n.y, width: n.width, height: n.height })
            .collect(),
    }
}

/// A tune's notes and rests in playing order, for the player.
#[uniffi::export]
pub fn score_timeline(abc: String) -> Vec<ScoreEvent> {
    notation_core::timeline(&notation_core::parse(&abc))
        .into_iter()
        .map(|e| ScoreEvent { start: e.start, duration: e.duration, midi: e.midi, id: e.id })
        .collect()
}
