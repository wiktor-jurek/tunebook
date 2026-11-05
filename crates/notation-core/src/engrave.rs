//! A tune laid out as a score: a display list in staff spaces that each platform only draws.
//!
//! Units are staff spaces (the gap between two staff lines); y grows downwards, and each staff's
//! top line sits where its line of music needs it. Glyphs are SMuFL code points (draw them in a
//! SMuFL font, Bravura in the apps, at 4 staff spaces to the em, baseline at `y`).
//!
//! The layout follows abcjs's with `wrap` (the website's): measures fill each line up to a preferred
//! number per line, spacing grows with each note's length, beams follow the spaces in the ABC, and
//! every line but a short last one is justified to the full width.

use crate::frac::Frac;
use crate::parse::{BarKind, Item, Key, Meter, MeterSymbol, Note, Pitch, Rest, Tune, Acc};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LayoutOptions {
    /// The width to fill, in staff spaces.
    pub staff_width: f32,
    /// The most measures on a line (fewer if they would not fit).
    pub bars_per_line: u32,
    /// Only how the tune starts: any pickup and this many bars, on one line at its natural width.
    /// 0 for the whole tune.
    pub phrase_bars: u32,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Engraving {
    pub width: f32,
    pub height: f32,
    pub glyphs: Vec<Glyph>,
    pub lines: Vec<Line>,
    pub beams: Vec<Beam>,
    pub arcs: Vec<Arc>,
    pub texts: Vec<Text>,
    /// Each note and rest drawn, by the id the timeline plays it with.
    pub notes: Vec<NoteBox>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Glyph {
    /// A SMuFL code point.
    pub code: u32,
    pub x: f32,
    pub y: f32,
    /// 1 for full size; grace notes are smaller.
    pub scale: f32,
    /// The note it belongs to, to light up as it plays.
    pub note: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Line {
    pub x1: f32,
    pub y1: f32,
    pub x2: f32,
    pub y2: f32,
    pub thickness: f32,
    pub note: Option<u32>,
}

/// A beam: the slanted band from (x1, y1) to (x2, y2), `thickness` deep (downwards if positive).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Beam {
    pub x1: f32,
    pub y1: f32,
    pub x2: f32,
    pub y2: f32,
    pub thickness: f32,
}

/// A curve from (x1, y1) to (x2, y2) bowing `bulge` from the straight line (negative: upwards); ties and rolls.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Arc {
    pub x1: f32,
    pub y1: f32,
    pub x2: f32,
    pub y2: f32,
    pub bulge: f32,
    pub thickness: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextKind {
    /// A chord symbol over the staff, in the sans-serif text face.
    Chord,
    /// A tuplet's number, in italics.
    Tuplet,
    /// An ending's number in its bracket.
    Ending,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Text {
    pub text: String,
    /// The baseline's left end.
    pub x: f32,
    pub y: f32,
    /// Font size, in staff spaces.
    pub size: f32,
    pub kind: TextKind,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NoteBox {
    pub id: u32,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

// SMuFL code points.
const G_CLEF: u32 = 0xE050;
const HEAD_WHOLE: u32 = 0xE0A2;
const HEAD_HALF: u32 = 0xE0A3;
const HEAD_BLACK: u32 = 0xE0A4;
const DOT: u32 = 0xE1E7;
const FLAG_UP: [u32; 3] = [0xE240, 0xE242, 0xE244];
const FLAG_DOWN: [u32; 3] = [0xE241, 0xE243, 0xE245];
const SHARP: u32 = 0xE262;
const FLAT: u32 = 0xE260;
const NATURAL: u32 = 0xE261;
const DOUBLE_SHARP: u32 = 0xE263;
const DOUBLE_FLAT: u32 = 0xE264;
const TIME_DIGIT: u32 = 0xE080;
const COMMON_TIME: u32 = 0xE08A;
const CUT_TIME: u32 = 0xE08B;
const REST_WHOLE: u32 = 0xE4E3;
const REST_HALF: u32 = 0xE4E4;
const REST_QUARTER: u32 = 0xE4E5;
const REST_8TH: u32 = 0xE4E6;
const REST_16TH: u32 = 0xE4E7;
const REST_32ND: u32 = 0xE4E8;

// Sizes, in staff spaces (Bravura's metrics, rounded).
const HEAD: f32 = 1.18;
const STAFF_LINE: f32 = 0.13;
const STEM: f32 = 0.12;
const STEM_LENGTH: f32 = 3.5;
const BEAM: f32 = 0.5;
const BEAM_GAP: f32 = 0.75;
const THIN: f32 = 0.16;
const THICK: f32 = 0.5;
const LEDGER: f32 = 0.16;
const GRACE: f32 = 0.6;
const LINE_GAP: f32 = 1.8;

/// Diatonic step → y within a staff (top line 0, bottom line 4): B4, the middle line, at 2.
fn y_of(step: i32) -> f32 {
    2.0 + (34 - step) as f32 * 0.5
}

/// Lays a tune out as a score.
pub fn engrave(tune: &Tune, options: &LayoutOptions) -> Engraving {
    let mut measures = measures(tune);
    let phrase = options.phrase_bars > 0;
    if phrase {
        measures = opening(measures, tune.meter, options.phrase_bars as usize);
    }
    if measures.is_empty() {
        return Engraving { width: options.staff_width, height: 4.0, ..Default::default() };
    }
    let widths: Vec<f32> = measures.iter().map(|m| m.natural()).collect();
    let tightest: Vec<f32> = measures.iter().map(|m| m.tightest()).collect();

    // Measures to lines: up to the preferred count, while they fit; a short pickup does not count.
    let mut lines: Vec<std::ops::Range<usize>> = vec![];
    let mut start = 0;
    while start < measures.len() {
        let header = header_width(&measures[start], start == 0);
        let available = options.staff_width - header;
        let mut end = start;
        let mut used = 0.0;
        let mut counted = 0;
        while end < measures.len() {
            let width = tightest[end];
            let counts = !(end == 0 && measures[0].duration().f64() < tune.meter.bar().f64() * 0.75);
            if !phrase && end > start && (used + width > available || (counts && counted >= options.bars_per_line)) {
                break;
            }
            used += width;
            if counts {
                counted += 1;
            }
            end += 1;
        }
        lines.push(start..end);
        start = end;
    }

    let mut out = Engraving::default();
    let mut top = 0.0f32;
    let count = lines.len();
    let mut carry = Carry::default();
    for (index, range) in lines.into_iter().enumerate() {
        let header = header_width(&measures[range.start], range.start == 0);
        let mut natural: f32 = header + range.clone().map(|i| widths[i]).sum::<f32>();
        // A repeat starting at a line break is drawn at the start of the next line, not the end of this one.
        let opens = |close: Option<BarKind>| matches!(close, Some(BarKind::StartRepeat | BarKind::DoubleRepeat));
        if range.start > 0 && measures[range.start].lead.is_none() && opens(measures[range.start - 1].close) {
            natural += bar_width(BarKind::StartRepeat);
        }
        if index + 1 < count {
            natural -= match measures[range.end - 1].close {
                Some(BarKind::StartRepeat) => bar_width(BarKind::StartRepeat),
                Some(BarKind::DoubleRepeat) => bar_width(BarKind::DoubleRepeat) - bar_width(BarKind::EndRepeat),
                _ => 0.0,
            };
        }
        // Justified to the width, except one-line phrases and a last line well short of it.
        let width = if phrase {
            natural
        } else if index == count - 1 && natural < options.staff_width * 0.7 {
            (natural * 1.25).min(options.staff_width)
        } else {
            options.staff_width
        };
        let mut painter = Painter::default();
        let continues = index + 1 < count;
        draw_line(&mut painter, &measures[range.clone()], range.start == 0, width, natural, continues, tune, &mut carry);
        // Stack the lines: each sits below the lowest thing on the one before.
        let (min_y, max_y) = painter.bounds();
        let offset = top - min_y;
        painter.shift(offset);
        out.width = out.width.max(width);
        top += max_y - min_y + LINE_GAP;
        out.glyphs.extend(painter.out.glyphs);
        out.lines.extend(painter.out.lines);
        out.beams.extend(painter.out.beams);
        out.arcs.extend(painter.out.arcs);
        out.texts.extend(painter.out.texts);
        out.notes.extend(painter.out.notes);
    }
    out.height = (top - LINE_GAP).max(4.0);
    out
}

#[derive(Debug, Clone)]
enum Event<'a> {
    Note(&'a Note),
    Rest(&'a Rest),
    Break,
    Key(Key),
    Meter(Meter),
}

#[derive(Debug, Clone)]
struct Measure<'a> {
    /// A bar before the first measure (a tune starting `|:`).
    lead: Option<BarKind>,
    ending: Option<u8>,
    events: Vec<Event<'a>>,
    close: Option<BarKind>,
    /// The key in force where the measure starts, for a line starting there.
    key: Key,
}

impl Measure<'_> {
    fn duration(&self) -> Frac {
        self.events.iter().fold(Frac::ZERO, |sum, e| match e {
            Event::Note(n) => sum + n.dur,
            Event::Rest(r) => sum + r.dur,
            _ => sum,
        })
    }

    fn slots(&self) -> Vec<Slot> {
        self.events.iter().map(slot).collect()
    }

    /// Its width before justifying: the gap after the bar, its notes, and its closing bar.
    fn natural(&self) -> f32 {
        let lead = self.lead.map_or(0.0, bar_width);
        lead + 1.0 + self.slots().iter().map(|s| s.width()).sum::<f32>() + 0.5 + self.close.map_or(0.0, bar_width)
    }

    /// The least it may be squeezed to so a line holds another bar: the room after each note halved, as abcjs's
    /// wrapping squeezes toward its minimum spacing before it gives a line one bar fewer.
    fn tightest(&self) -> f32 {
        let slack: f32 = self.slots().iter().map(|s| s.space).sum();
        self.natural() - slack * (1.0 - SQUEEZE)
    }
}

/// How far the room after a note may shrink (as a share of its natural room) to fit another bar on a line.
const SQUEEZE: f32 = 0.5;

/// An event's room: `before` (accidentals, grace notes), the head, then `space` that justifying stretches.
#[derive(Debug, Clone, Copy)]
struct Slot {
    before: f32,
    head: f32,
    space: f32,
}

impl Slot {
    fn width(self) -> f32 {
        self.before + self.head + self.space
    }
}

fn slot(event: &Event) -> Slot {
    match event {
        Event::Note(note) => {
            let before = if note.pitches.iter().any(|p| p.acc.is_some()) { 1.25 } else { 0.0 }
                + if note.grace.is_empty() { 0.0 } else { note.grace.len() as f32 * 0.85 + 0.4 };
            let (_, dots) = shape(note.shown);
            Slot { before, head: HEAD, space: spacing(note.shown) + dots as f32 * 0.5 }
        }
        Event::Rest(rest) if rest.invisible => Slot { before: 0.0, head: 0.0, space: spacing(rest.shown) },
        Event::Rest(rest) => Slot { before: 0.0, head: 1.1, space: spacing(rest.shown) },
        Event::Break => Slot { before: 0.0, head: 0.0, space: 0.35 },
        Event::Key(key) => Slot { before: 0.6, head: key.fifths.unsigned_abs() as f32 * 1.0, space: 0.8 },
        Event::Meter(_) => Slot { before: 0.6, head: 1.9, space: 0.8 },
    }
}

/// Room after a note, growing with its length (the square root, as engravers space notes): with its head,
/// an eighth takes about 3.2 staff spaces, a sixteenth 2.7, a crotchet 3.8, as abcjs spaces them.
fn spacing(length: Frac) -> f32 {
    let quarters = (length.f64() * 4.0).max(0.125) as f32;
    (1.6 + 2.2 * quarters.sqrt() - HEAD).max(0.55)
}

/// A drawn length → its plain value (whole 1, half 1/2 …) and dots.
fn shape(length: Frac) -> (Frac, u32) {
    let value = length.f64();
    let mut base = Frac::new(4, 1);
    while base.f64() > value + 1e-9 && base.den < 256 {
        base = Frac::new(base.num, base.den * 2);
    }
    let dots = if (value - base.f64() * 1.75).abs() < 1e-9 {
        2
    } else if (value - base.f64() * 1.5).abs() < 1e-9 {
        1
    } else {
        0
    };
    (base, dots)
}

/// Beams (or flags) a plain value needs: 1 for an eighth, 2 for a sixteenth …
fn beams_for(base: Frac) -> usize {
    let v = base.f64();
    if v >= 0.25 - 1e-9 {
        0
    } else if v >= 0.125 - 1e-9 {
        1
    } else if v >= 0.0625 - 1e-9 {
        2
    } else {
        3
    }
}

fn bar_width(kind: BarKind) -> f32 {
    match kind {
        BarKind::Single => 0.0,
        BarKind::Double => 0.6,
        BarKind::Final => 0.9,
        BarKind::Start => 1.0,
        BarKind::StartRepeat => 1.6,
        BarKind::EndRepeat => 1.5,
        BarKind::DoubleRepeat => 1.8,
    }
}

fn header_width(first: &Measure, opening: bool) -> f32 {
    let key = first.key.fifths.unsigned_abs() as f32;
    0.5 + 2.7 + 0.6 + key * 1.0 + if key > 0.0 { 0.5 } else { 0.0 } + if opening { 2.6 } else { 0.0 } + 0.4
}

/// The tune's items as measures, each with what closes it.
fn measures(tune: &Tune) -> Vec<Measure<'_>> {
    let mut out: Vec<Measure> = vec![];
    let mut key = tune.key;
    let mut current = Measure { lead: None, ending: None, events: vec![], close: None, key };
    for item in &tune.items {
        match item {
            Item::Note(n) => current.events.push(Event::Note(n)),
            Item::Rest(r) => current.events.push(Event::Rest(r)),
            Item::BeamBreak => {
                if !current.events.is_empty() && !matches!(current.events.last(), Some(Event::Break)) {
                    current.events.push(Event::Break);
                }
            }
            Item::KeyChange(k) => {
                key = *k;
                current.events.push(Event::Key(*k));
            }
            Item::MeterChange(m) => current.events.push(Event::Meter(*m)),
            Item::Ending(n) => current.ending = Some(*n),
            Item::Bar(bar) => {
                while matches!(current.events.last(), Some(Event::Break)) {
                    current.events.pop();
                }
                let has_music = current.events.iter().any(|e| matches!(e, Event::Note(_) | Event::Rest(_)));
                if !has_music && out.is_empty() && current.lead.is_none() {
                    // `|:` before the first note.
                    current.lead = Some(bar.kind);
                    continue;
                }
                if !has_music {
                    // Two bars in a row (`| |`, `:| |:` written apart): keep the stronger.
                    if let Some(last) = out.last_mut() {
                        last.close = Some(merge(last.close.unwrap_or(BarKind::Single), bar.kind));
                    }
                    continue;
                }
                current.close = Some(bar.kind);
                let next = Measure { lead: None, ending: None, events: vec![], close: None, key };
                out.push(std::mem::replace(&mut current, next));
            }
        }
    }
    while matches!(current.events.last(), Some(Event::Break)) {
        current.events.pop();
    }
    if current.events.iter().any(|e| matches!(e, Event::Note(_) | Event::Rest(_))) {
        out.push(current);
    }
    for m in &mut out {
        while matches!(m.events.first(), Some(Event::Break)) {
            m.events.remove(0);
        }
    }
    out
}

fn merge(a: BarKind, b: BarKind) -> BarKind {
    match (a, b) {
        (BarKind::EndRepeat, BarKind::StartRepeat) | (BarKind::StartRepeat, BarKind::EndRepeat) => BarKind::DoubleRepeat,
        (BarKind::Single, other) => other,
        (other, _) => other,
    }
}

/// Any pickup and the first `bars` full bars, plain bars between and a final bar to end; as `Abc.openingPhrase`.
fn opening(measures: Vec<Measure<'_>>, meter: Meter, bars: usize) -> Vec<Measure<'_>> {
    let pickup = measures.len() > 1 && measures[0].duration().f64() < meter.bar().f64() * 0.75;
    let take = bars + usize::from(pickup);
    let mut out: Vec<Measure> = measures.into_iter().take(take).collect();
    let last = out.len().saturating_sub(1);
    for (i, m) in out.iter_mut().enumerate() {
        m.lead = None;
        m.ending = None;
        m.close = Some(if i == last { BarKind::Final } else { BarKind::Single });
    }
    out
}

/// What carries over from line to line: a tie or an ending still open, or a repeat that starts the next line.
#[derive(Default)]
struct Carry {
    tie: Option<(f32, f32, bool)>,
    ending: Option<u8>,
    repeat: bool,
}

#[derive(Default)]
struct Painter {
    out: Engraving,
    min_y: f32,
    max_y: f32,
}

impl Painter {
    fn extend(&mut self, top: f32, bottom: f32) {
        self.min_y = self.min_y.min(top);
        self.max_y = self.max_y.max(bottom);
    }

    fn glyph(&mut self, code: u32, x: f32, y: f32, scale: f32, note: Option<u32>, top: f32, bottom: f32) {
        self.out.glyphs.push(Glyph { code, x, y, scale, note });
        self.extend(y + top * scale, y + bottom * scale);
    }

    fn line(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, thickness: f32, note: Option<u32>) {
        self.out.lines.push(Line { x1, y1, x2, y2, thickness, note });
        self.extend(y1.min(y2), y1.max(y2));
    }

    fn text(&mut self, text: String, x: f32, y: f32, size: f32, kind: TextKind) {
        self.extend(y - size * 0.8, y + size * 0.25);
        self.out.texts.push(Text { text, x, y, size, kind });
    }

    fn arc(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, bulge: f32) {
        self.extend(y1.min(y2) + bulge.min(0.0), y1.max(y2) + bulge.max(0.0));
        self.out.arcs.push(Arc { x1, y1, x2, y2, bulge, thickness: 0.16 });
    }

    fn bounds(&self) -> (f32, f32) {
        (self.min_y.min(-0.6), self.max_y.max(4.6))
    }

    fn shift(&mut self, dy: f32) {
        let o = &mut self.out;
        o.glyphs.iter_mut().for_each(|g| g.y += dy);
        o.lines.iter_mut().for_each(|l| {
            l.y1 += dy;
            l.y2 += dy;
        });
        o.beams.iter_mut().for_each(|b| {
            b.y1 += dy;
            b.y2 += dy;
        });
        o.arcs.iter_mut().for_each(|a| {
            a.y1 += dy;
            a.y2 += dy;
        });
        o.texts.iter_mut().for_each(|t| t.y += dy);
        o.notes.iter_mut().for_each(|n| n.y += dy);
    }
}

/// Where a note was drawn, for beams, tuplets and ties.
#[derive(Debug, Clone, Copy)]
struct Placed {
    id: u32,
    x: f32,
    /// Highest and lowest head.
    top: f32,
    bottom: f32,
    beams: usize,
    stem_x: f32,
    tip: f32,
    up: bool,
}

#[allow(clippy::too_many_arguments)]
fn draw_line(p: &mut Painter, measures: &[Measure], opening: bool, width: f32, natural: f32, continues: bool, tune: &Tune, carry: &mut Carry) {
    for i in 0..5 {
        p.line(0.0, i as f32, width, i as f32, STAFF_LINE, None);
    }
    // Clef, key signature, and (on the first line) the time signature.
    let first = &measures[0];
    p.glyph(G_CLEF, 0.5, 3.0, 1.0, None, -4.4, 2.6);
    let mut x = 0.5 + 2.7 + 0.6;
    x = key_signature(p, first.key, x);
    if opening {
        time_signature(p, tune.meter, x);
        x += 2.6;
    }
    x += 0.4;
    // Justifying spreads the extra width over the room after each note, in proportion to it.
    let stretchable: f32 = measures.iter().flat_map(|m| m.slots()).map(|s| s.space).sum();
    let extra = width - natural;
    let factor = if stretchable > 0.0 { (1.0 + extra / stretchable).max(0.35) } else { 1.0 };

    let mut ending_from: Option<(f32, u8, bool)> = carry.ending.take().map(|n| (x - 0.6, n, false));
    let mut tie = carry.tie.take();
    for (index, m) in measures.iter().enumerate() {
        if let Some(lead) = m.lead {
            x = bar(p, lead, x);
        } else if index == 0 && std::mem::take(&mut carry.repeat) {
            // The line before ended where a repeat starts (`|:` or `::`): the sign opens this one.
            x = bar(p, BarKind::StartRepeat, x);
        }
        if let Some(n) = m.ending {
            if let Some((from, number, numbered)) = ending_from.take() {
                ending(p, from, x - 0.3, number, numbered, false);
            }
            ending_from = Some((x + 0.2, n, true));
        }
        x += 1.0;
        let mut placed: Vec<Placed> = vec![];
        let mut beam_run: Vec<Placed> = vec![];
        let slots = m.slots();
        for (event, s) in m.events.iter().zip(slots) {
            let head_x = x + s.before;
            match event {
                Event::Note(note) => {
                    let (base, dots) = shape(note.shown);
                    let beams = beams_for(base);
                    let in_beam = beams > 0;
                    let one = draw_note(p, note, head_x, base, dots, &mut tie);
                    let placed_note = Placed { beams, ..one };
                    placed.push(placed_note);
                    if in_beam {
                        beam_run.push(placed_note);
                    } else {
                        flush_beams(p, &mut beam_run);
                    }
                }
                Event::Rest(rest) => {
                    flush_beams(p, &mut beam_run);
                    draw_rest(p, rest, head_x);
                }
                Event::Break => flush_beams(p, &mut beam_run),
                Event::Key(key) => {
                    flush_beams(p, &mut beam_run);
                    key_signature(p, *key, x + 0.6);
                }
                Event::Meter(meter) => {
                    flush_beams(p, &mut beam_run);
                    time_signature(p, *meter, x + 0.6);
                }
            }
            x += s.before + s.head + s.space * factor;
        }
        flush_beams(p, &mut beam_run);
        tuplets(p, &m.events, &placed);
        x += 0.5;
        // The closing bar: at the end of a line `|:` waits for the next line's start, `::` splits.
        let last_on_line = index == measures.len() - 1;
        let close = m.close.map(|kind| match kind {
            BarKind::StartRepeat if last_on_line && continues => BarKind::Single,
            BarKind::DoubleRepeat if last_on_line && continues => BarKind::EndRepeat,
            other => other,
        });
        let bar_x = x;
        if let Some(kind) = close {
            x = bar(p, kind, x);
        }
        // Endings close at a repeat or double bar, and are left open (no end hook) at a plain one at a line's end.
        if let Some((from, number, numbered)) = ending_from {
            let closes = matches!(m.close, Some(BarKind::EndRepeat | BarKind::DoubleRepeat | BarKind::Double | BarKind::Final | BarKind::StartRepeat));
            if closes {
                ending(p, from, bar_x - 0.2, number, numbered, matches!(m.close, Some(BarKind::EndRepeat | BarKind::DoubleRepeat)));
                ending_from = None;
            } else if last_on_line {
                ending(p, from, bar_x, number, numbered, false);
                ending_from = None;
                carry.ending = Some(number);
            }
        }
        if last_on_line {
            // A tie into the next line leaves from the line's end.
            if let Some((tx, ty, below)) = tie.take() {
                let dir = if below { 0.5 } else { -0.5 };
                p.arc(tx, ty, width - 0.2, ty, dir);
            }
            carry.repeat = continues && matches!(m.close, Some(BarKind::StartRepeat | BarKind::DoubleRepeat));
        }
    }
    if !continues {
        carry.ending = None;
    }
}

fn key_signature(p: &mut Painter, key: Key, mut x: f32) -> f32 {
    const SHARPS: [i32; 7] = [38, 35, 39, 36, 33, 37, 34];
    const FLATS: [i32; 7] = [34, 37, 33, 36, 32, 35, 31];
    let n = key.fifths.unsigned_abs() as usize;
    for i in 0..n.min(7) {
        if key.fifths > 0 {
            p.glyph(SHARP, x, y_of(SHARPS[i]), 1.0, None, -1.4, 1.4);
            x += 1.0;
        } else {
            p.glyph(FLAT, x, y_of(FLATS[i]), 1.0, None, -1.75, 0.7);
            x += 0.95;
        }
    }
    if n > 0 { x + 0.5 } else { x }
}

fn time_signature(p: &mut Painter, meter: Meter, x: f32) {
    match meter.symbol {
        Some(MeterSymbol::Common) => p.glyph(COMMON_TIME, x, 2.0, 1.0, None, -1.0, 1.0),
        Some(MeterSymbol::Cut) => p.glyph(CUT_TIME, x, 2.0, 1.0, None, -1.4, 1.4),
        None => {
            let num = meter.num.to_string();
            let den = meter.den.to_string();
            let wide = num.len().max(den.len()) as f32 * 1.8;
            for (text, y) in [(num, 1.0), (den, 3.0)] {
                let mut dx = x + (wide - text.len() as f32 * 1.8) / 2.0;
                for digit in text.chars().filter_map(|c| c.to_digit(10)) {
                    p.glyph(TIME_DIGIT + digit, dx, y, 1.0, None, -1.0, 1.0);
                    dx += 1.8;
                }
            }
        }
    }
}

fn accidental_glyph(acc: Acc) -> (u32, f32, f32) {
    match acc {
        Acc::Sharp => (SHARP, -1.4, 1.4),
        Acc::Flat => (FLAT, -1.75, 0.7),
        Acc::Natural => (NATURAL, -1.35, 1.35),
        Acc::DoubleSharp => (DOUBLE_SHARP, -0.5, 0.5),
        Acc::DoubleFlat => (DOUBLE_FLAT, -1.75, 0.7),
    }
}

fn ledger_lines(p: &mut Painter, step: i32, x: f32, scale: f32, note: Option<u32>) {
    let (from, to) = (x - 0.35 * scale, x + (HEAD + 0.35) * scale);
    if step >= 40 {
        let mut s = 40;
        while s <= step {
            p.line(from, y_of(s), to, y_of(s), LEDGER, note);
            s += 2;
        }
    } else if step <= 28 {
        let mut s = 28;
        while s >= step {
            p.line(from, y_of(s), to, y_of(s), LEDGER, note);
            s -= 2;
        }
    }
}

/// A note's heads, accidentals, dots, ledger lines and stem (flags and beams come later), its grace notes,
/// roll and chord symbol, and the tie into it.
fn draw_note(p: &mut Painter, note: &Note, x: f32, base: Frac, dots: u32, tie: &mut Option<(f32, f32, bool)>) -> Placed {
    let id = Some(note.id);
    let head = if base.f64() >= 1.0 - 1e-9 {
        HEAD_WHOLE
    } else if base.f64() >= 0.5 - 1e-9 {
        HEAD_HALF
    } else {
        HEAD_BLACK
    };
    let steps: Vec<i32> = note.pitches.iter().map(|p| p.step).collect();
    let low = *steps.iter().min().unwrap_or(&34);
    let high = *steps.iter().max().unwrap_or(&34);
    let up = (low + high) as f32 / 2.0 < 34.0;
    for pitch in &note.pitches {
        let y = y_of(pitch.step);
        ledger_lines(p, pitch.step, x, 1.0, id);
        p.glyph(head, x, y, 1.0, id, -0.5, 0.5);
        if let Some(acc) = pitch.acc {
            let (code, top, bottom) = accidental_glyph(acc);
            p.glyph(code, x - 1.2, y, 1.0, id, top, bottom);
        }
        for d in 0..dots {
            // A dot on a line moves up into the space.
            let on_line = (pitch.step - 30).rem_euclid(2) == 0;
            p.glyph(DOT, x + HEAD + 0.35 + d as f32 * 0.5, y - if on_line { 0.5 } else { 0.0 }, 1.0, id, -0.2, 0.2);
        }
    }
    // Grace notes, small, stems up, slashed if one.
    if !note.grace.is_empty() {
        let accidentals = if note.pitches.iter().any(|p| p.acc.is_some()) { 1.25 } else { 0.0 };
        draw_grace(p, &note.grace, x - accidentals - note.grace.len() as f32 * 0.85 - 0.3);
    }
    let top = y_of(high);
    let bottom = y_of(low);
    let stem_x = if up { x + HEAD - STEM / 2.0 } else { x + STEM / 2.0 };
    let tip = if up { (top - STEM_LENGTH).min(2.0) } else { (bottom + STEM_LENGTH).max(2.0) };
    if head != HEAD_WHOLE {
        if up {
            p.line(stem_x, bottom - 0.17, stem_x, tip, STEM, id);
        } else {
            p.line(stem_x, top + 0.17, stem_x, tip, STEM, id);
        }
    }
    p.out.notes.push(NoteBox { id: note.id, x: x - 0.3, y: top.min(tip) - 0.5, width: HEAD + 0.6, height: (bottom.max(tip) - top.min(tip)) + 1.0 });
    if let Some((tx, ty, below)) = tie.take() {
        let dir = if below { 0.5 } else { -0.5 };
        p.arc(tx, ty, x - 0.1, ty, dir);
    }
    if note.tie {
        // Ties curve away from the stems.
        let below = up;
        let y = if below { bottom + 0.6 } else { top - 0.6 };
        *tie = Some((x + HEAD + 0.1, y, below));
    }
    if note.roll {
        let y = (if up { tip } else { top } - 1.1).min(-0.9);
        p.arc(x - 0.15, y, x + HEAD + 0.15, y, -0.55);
    }
    if let Some(chord) = &note.chord {
        p.text(chord.clone(), x - 0.2, -1.3, 1.6, TextKind::Chord);
    }
    Placed { id: note.id, x, top, bottom, beams: 0, stem_x, tip, up }
}

fn draw_grace(p: &mut Painter, pitches: &[Pitch], mut x: f32) {
    let mut tips = vec![];
    for pitch in pitches {
        let y = y_of(pitch.step);
        ledger_lines(p, pitch.step, x, GRACE, None);
        p.glyph(HEAD_BLACK, x, y, GRACE, None, -0.5, 0.5);
        let stem_x = x + HEAD * GRACE - STEM / 2.0;
        let tip = y - 2.4;
        p.line(stem_x, y - 0.1, stem_x, tip, STEM * 0.8, None);
        tips.push((stem_x, tip));
        x += 0.85;
    }
    if tips.len() == 1 {
        let (sx, tip) = tips[0];
        p.glyph(FLAG_UP[0], sx - STEM / 2.0, tip, GRACE, None, 0.0, 3.0);
        // The slash of an acciaccatura.
        p.line(sx - 0.55, tip + 1.5, sx + 0.75, tip + 0.4, 0.12, None);
    } else if let (Some(&(x1, y1)), Some(&(x2, y2))) = (tips.first(), tips.last()) {
        let y = y1.min(y2);
        p.out.beams.push(Beam { x1: x1 - STEM / 2.0, y1: y, x2: x2 + STEM / 2.0, y2: y, thickness: BEAM * 0.6 });
        p.extend(y, y + BEAM);
    }
}

fn draw_rest(p: &mut Painter, rest: &Rest, x: f32) {
    if rest.invisible {
        return;
    }
    let (base, dots) = shape(rest.shown);
    let v = base.f64();
    let (code, y) = if v >= 1.0 - 1e-9 {
        (REST_WHOLE, 1.0)
    } else if v >= 0.5 - 1e-9 {
        (REST_HALF, 2.0)
    } else if v >= 0.25 - 1e-9 {
        (REST_QUARTER, 2.0)
    } else if v >= 0.125 - 1e-9 {
        (REST_8TH, 2.0)
    } else if v >= 0.0625 - 1e-9 {
        (REST_16TH, 2.0)
    } else {
        (REST_32ND, 2.0)
    };
    p.glyph(code, x, y, 1.0, Some(rest.id), -1.5, 1.5);
    for d in 0..dots {
        p.glyph(DOT, x + 1.4 + d as f32 * 0.5, 1.5, 1.0, Some(rest.id), -0.2, 0.2);
    }
    p.out.notes.push(NoteBox { id: rest.id, x: x - 0.3, y: 0.5, width: 1.7, height: 3.0 });
}

/// Beams a run of eighths and shorter (flags a lone one), then forgets it.
fn flush_beams(p: &mut Painter, run: &mut Vec<Placed>) {
    if run.is_empty() {
        return;
    }
    let notes = std::mem::take(run);
    if notes.len() == 1 {
        let n = notes[0];
        let flags = if n.up { FLAG_UP } else { FLAG_DOWN };
        let code = flags[(n.beams.clamp(1, 3)) - 1];
        if n.up {
            p.glyph(code, n.stem_x - STEM / 2.0, n.tip, 1.0, Some(n.id), 0.0, 3.2);
        } else {
            p.glyph(code, n.stem_x - STEM / 2.0, n.tip, 1.0, Some(n.id), -3.2, 0.0);
        }
        return;
    }
    // One direction for the group: from the average of its notes.
    let middle: f32 = notes.iter().map(|n| (n.top + n.bottom) / 2.0).sum::<f32>() / notes.len() as f32;
    let up = middle > 2.0;
    let most = notes.iter().map(|n| n.beams).max().unwrap_or(1);
    let stem_x = |n: &Placed| if up { n.x + HEAD - STEM / 2.0 } else { n.x + STEM / 2.0 };
    let first = &notes[0];
    let last = &notes[notes.len() - 1];
    let (x1, x2) = (stem_x(first), stem_x(last));
    // A gentle slope following the first and last notes, never more than a space overall.
    let end = |n: &Placed| if up { n.top - STEM_LENGTH } else { n.bottom + STEM_LENGTH };
    let mut slope = if x2 > x1 { (end(last) - end(first)) / (x2 - x1) } else { 0.0 };
    let rise = (slope * (x2 - x1)).clamp(-1.0, 1.0);
    slope = if x2 > x1 { rise * 0.6 / (x2 - x1) } else { 0.0 };
    // Then far enough from every head that the shortest stem is still a good length.
    let min_stem = 2.75 + (most as f32 - 1.0) * BEAM_GAP;
    let mut offset = end(first);
    for n in &notes {
        let at = offset + slope * (stem_x(n) - x1);
        let head = if up { n.top } else { n.bottom };
        if up && head - at < min_stem {
            offset -= min_stem - (head - at);
        } else if !up && at - head < min_stem {
            offset += min_stem - (at - head);
        }
    }
    // Keep beams off the far side of the staff's middle when the notes are far from it.
    if up {
        offset = offset.min(2.0 + 0.0);
    } else {
        offset = offset.max(2.0);
    }
    let beam_y = |x: f32| offset + slope * (x - x1);
    let depth = if up { BEAM } else { -BEAM };
    for n in &notes {
        let sx = stem_x(n);
        let head = if up { n.bottom - 0.17 } else { n.top + 0.17 };
        p.line(sx, head, sx, beam_y(sx), STEM, Some(n.id));
    }
    // The main beam, then shorter ones where notes are shorter (or a stub for a note on its own).
    p.out.beams.push(Beam { x1: x1 - STEM / 2.0, y1: beam_y(x1), x2: x2 + STEM / 2.0, y2: beam_y(x2), thickness: depth });
    p.extend(beam_y(x1).min(beam_y(x2)) - BEAM, beam_y(x1).max(beam_y(x2)) + BEAM);
    for level in 2..=most {
        let shift = (level as f32 - 1.0) * if up { BEAM_GAP } else { -BEAM_GAP };
        let mut i = 0;
        while i < notes.len() {
            if notes[i].beams < level {
                i += 1;
                continue;
            }
            let mut j = i;
            while j + 1 < notes.len() && notes[j + 1].beams >= level {
                j += 1;
            }
            let (from, to) = if j > i {
                (stem_x(&notes[i]) - STEM / 2.0, stem_x(&notes[j]) + STEM / 2.0)
            } else if i == 0 {
                (stem_x(&notes[i]) - STEM / 2.0, stem_x(&notes[i]) + 1.15)
            } else {
                (stem_x(&notes[i]) - 1.15, stem_x(&notes[i]) + STEM / 2.0)
            };
            p.out.beams.push(Beam { x1: from, y1: beam_y(from) + shift, x2: to, y2: beam_y(to) + shift, thickness: depth });
            i = j + 1;
        }
    }
}

/// Each tuplet's number, over (or under) its notes' middle, on the beams' side.
fn tuplets(p: &mut Painter, events: &[Event], placed: &[Placed]) {
    for (index, event) in events.iter().enumerate() {
        let Event::Note(note) = event else { continue };
        let Some((number, span)) = note.tuplet else { continue };
        let ids: Vec<u32> = events[index..]
            .iter()
            .filter_map(|e| match e {
                Event::Note(n) => Some(n.id),
                Event::Rest(r) => Some(r.id),
                _ => None,
            })
            .take(span as usize)
            .collect();
        let group: Vec<&Placed> = placed.iter().filter(|p| ids.contains(&p.id)).collect();
        let (Some(first), Some(last)) = (group.first(), group.last()) else { continue };
        let up = first.up;
        let centre = (first.x + last.x + HEAD) / 2.0 - 0.35;
        let y = if up {
            group.iter().map(|n| n.tip.min(n.top)).fold(f32::MAX, f32::min) - 0.7
        } else {
            group.iter().map(|n| n.tip.max(n.bottom)).fold(f32::MIN, f32::max) + 1.7
        };
        p.text(number.to_string(), centre, y, 1.5, TextKind::Tuplet);
    }
}

/// A bar line of its kind at `x`; returns where the music carries on.
fn bar(p: &mut Painter, kind: BarKind, x: f32) -> f32 {
    let thin = |p: &mut Painter, x: f32| p.line(x, 0.0, x, 4.0, THIN, None);
    let thick = |p: &mut Painter, x: f32| p.line(x, 0.0, x, 4.0, THICK, None);
    let dots = |p: &mut Painter, x: f32| {
        p.glyph(DOT, x, 1.5, 1.0, None, -0.2, 0.2);
        p.glyph(DOT, x, 2.5, 1.0, None, -0.2, 0.2);
    };
    match kind {
        BarKind::Single => thin(p, x),
        BarKind::Double => {
            thin(p, x);
            thin(p, x + 0.5);
        }
        BarKind::Final => {
            thin(p, x);
            thick(p, x + 0.6);
        }
        BarKind::Start => {
            thick(p, x + 0.25);
            thin(p, x + 0.8);
        }
        BarKind::StartRepeat => {
            thick(p, x + 0.25);
            thin(p, x + 0.8);
            dots(p, x + 1.15);
        }
        BarKind::EndRepeat => {
            dots(p, x);
            thin(p, x + 0.65);
            thick(p, x + 1.2);
        }
        BarKind::DoubleRepeat => {
            dots(p, x);
            thin(p, x + 0.65);
            thin(p, x + 1.05);
            dots(p, x + 1.45);
        }
    }
    x + bar_width(kind)
}

/// An ending's bracket over the staff, numbered at its start (not on a line it carries over to).
fn ending(p: &mut Painter, from: f32, to: f32, number: u8, numbered: bool, closed: bool) {
    const Y: f32 = -3.1;
    p.line(from, Y, to, Y, THIN, None);
    if numbered {
        p.line(from, Y, from, Y + 1.6, THIN, None);
        p.text(format!("{number}."), from + 0.4, Y + 1.35, 1.3, TextKind::Ending);
    }
    if closed {
        p.line(to, Y, to, Y + 1.6, THIN, None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse::parse;

    const BUTTERFLY: &str = "X:1\nM:9/8\nL:1/8\nK:Em\n|:B2E G2E F3|B2E G2E FED|B2E G2E F3|B2d d2B AFD:|\n";

    fn options(width: f32) -> LayoutOptions {
        LayoutOptions { staff_width: width, bars_per_line: 4, phrase_bars: 0 }
    }

    #[test]
    fn lays_out_a_tune() {
        let e = engrave(&parse(BUTTERFLY), &options(80.0));
        assert_eq!(e.width, 80.0);
        // 5 + 7 + 5 + 7 notes, each a box.
        assert_eq!(e.notes.len(), 24);
        assert!(e.height > 6.0);
        assert!(!e.beams.is_empty());
    }

    #[test]
    fn wider_fits_more_bars_on_a_line() {
        let staff_lines = |width| engrave(&parse(BUTTERFLY), &options(width)).lines.iter().filter(|l| l.y1 == l.y2 && l.thickness == STAFF_LINE && l.x1 == 0.0).count();
        assert!(staff_lines(60.0) > staff_lines(150.0));
    }

    #[test]
    fn phrase_is_one_line() {
        let e = engrave(&parse(BUTTERFLY), &LayoutOptions { staff_width: 72.0, bars_per_line: 99, phrase_bars: 2 });
        assert!(e.height < 9.0);
        assert_eq!(e.notes.len(), 12);
    }
}
