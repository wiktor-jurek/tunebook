//! ABC as session tunes write it, read into a flat list of items.
//!
//! The header gives the meter (`M:`), unit note length (`L:`) and key (`K:`); the body is notes,
//! rests, bars and the marks around them. Spaces between notes break beams, as in abcjs. Marks it
//! does not draw (slurs, most decorations, lyrics, parts) are skipped and listed in [`Tune::skipped`].

use crate::frac::Frac;

#[derive(Debug, Clone, PartialEq)]
pub struct Tune {
    /// The meter and key at the start; changes come as items.
    pub meter: Meter,
    pub key: Key,
    pub items: Vec<Item>,
    /// What was read but not drawn or played, for logs.
    pub skipped: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Meter {
    pub num: u32,
    pub den: u32,
    /// `C` (common time) or `C|` (cut time), drawn as their symbols.
    pub symbol: Option<MeterSymbol>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeterSymbol {
    Common,
    Cut,
}

impl Meter {
    /// A full bar, in whole notes.
    pub fn bar(self) -> Frac {
        Frac::new(self.num as i64, self.den.max(1) as i64)
    }

    /// 6/8, 9/8 and 12/8: three quavers to the beat.
    pub fn compound(self) -> bool {
        self.den == 8 && self.num > 3 && self.num.is_multiple_of(3)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Key {
    /// Sharps (positive) or flats (negative) in the key signature.
    pub fifths: i32,
}

impl Key {
    /// The key signature's alteration of a letter (0 C … 6 B), in semitones.
    pub fn alter(self, letter: i32) -> i32 {
        // Sharps go F C G D A E B, flats the other way.
        const SHARPS: [i32; 7] = [3, 0, 4, 1, 5, 2, 6];
        let n = self.fifths.unsigned_abs() as usize;
        if self.fifths > 0 && SHARPS[..n.min(7)].contains(&letter) {
            1
        } else if self.fifths < 0 && SHARPS.iter().rev().take(n.min(7)).any(|&l| l == letter) {
            -1
        } else {
            0
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Item {
    Note(Note),
    Rest(Rest),
    Bar(Bar),
    /// Where a first or second ending starts (`[1`, `|2`).
    Ending(u8),
    /// A space between notes: their beams break here.
    BeamBreak,
    KeyChange(Key),
    MeterChange(Meter),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Note {
    /// One pitch, or several for a chord (`[CEG]`), lowest first.
    pub pitches: Vec<Pitch>,
    /// Written length, in whole notes (tuplets and broken rhythm already applied).
    pub dur: Frac,
    /// The length it looks like: tuplets draw as their written value, not what they sound.
    pub shown: Frac,
    pub tie: bool,
    pub grace: Vec<Pitch>,
    pub roll: bool,
    pub chord: Option<String>,
    /// The first note of a tuplet carries its number and how many notes it spans.
    pub tuplet: Option<(u32, u32)>,
    pub id: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Rest {
    pub dur: Frac,
    pub shown: Frac,
    /// `x`: takes time but draws nothing.
    pub invisible: bool,
    pub id: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pitch {
    /// Diatonic step: octave × 7 + letter (C 0 … B 6), middle C (C4) = 28.
    pub step: i32,
    /// As written; `None` takes the key's (or the bar's earlier) alteration.
    pub acc: Option<Acc>,
    /// Semitones from the natural letter, as played (key, bar and written accidentals applied).
    pub alter: i32,
}

impl Pitch {
    pub fn letter(self) -> i32 {
        self.step.rem_euclid(7)
    }

    pub fn midi(self) -> i32 {
        const SEMITONES: [i32; 7] = [0, 2, 4, 5, 7, 9, 11];
        let octave = self.step.div_euclid(7);
        12 * (octave + 1) + SEMITONES[self.letter() as usize] + self.alter
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Acc {
    DoubleFlat,
    Flat,
    Natural,
    Sharp,
    DoubleSharp,
}

impl Acc {
    fn alter(self) -> i32 {
        match self {
            Acc::DoubleFlat => -2,
            Acc::Flat => -1,
            Acc::Natural => 0,
            Acc::Sharp => 1,
            Acc::DoubleSharp => 2,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bar {
    pub kind: BarKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BarKind {
    Single,
    /// `||`
    Double,
    /// `|]`
    Final,
    /// `[|`
    Start,
    /// `|:`
    StartRepeat,
    /// `:|`
    EndRepeat,
    /// `::` or `:|:`
    DoubleRepeat,
}

/// Reads a tune's ABC: headers (up to `K:`) then its body.
pub fn parse(abc: &str) -> Tune {
    let mut meter = Meter { num: 4, den: 4, symbol: None };
    let mut unit: Option<Frac> = None;
    let mut key = Key { fifths: 0 };
    let mut lines = abc.lines().peekable();
    let mut body = String::new();
    let mut in_header = true;
    for line in lines.by_ref() {
        let line = line.trim_end_matches('\r');
        if in_header {
            if let Some((field, value)) = field(line) {
                match field {
                    'M' => meter = parse_meter(value).unwrap_or(meter),
                    'L' => unit = parse_unit(value),
                    'K' => {
                        key = parse_key(value);
                        in_header = false;
                    }
                    _ => {}
                }
                continue;
            }
            // A bare body (no K:), as The Session stores them.
            in_header = false;
        }
        body.push_str(line);
        body.push('\n');
    }
    // The unit note: an eighth, or a sixteenth in meters under 3/4 (the ABC standard's rule).
    let unit = unit.unwrap_or(if meter.bar().f64() < 0.75 { Frac::new(1, 16) } else { Frac::new(1, 8) });
    let mut reader = Reader {
        chars: body.chars().collect(),
        at: 0,
        meter,
        unit,
        key,
        items: vec![],
        skipped: vec![],
        next_id: 0,
        bar_acc: vec![],
        pending: Pending::default(),
    };
    reader.read();
    Tune { meter, key, items: reader.items, skipped: reader.skipped }
}

/// `X: value` → ('X', "value"), for single-letter header and body fields.
fn field(line: &str) -> Option<(char, &str)> {
    let mut chars = line.chars();
    let letter = chars.next()?;
    if !letter.is_ascii_alphabetic() {
        return None;
    }
    let rest = chars.as_str().trim_start();
    rest.strip_prefix(':').map(|value| (letter, value.trim()))
}

fn parse_meter(value: &str) -> Option<Meter> {
    let value = value.trim();
    match value {
        "C" => return Some(Meter { num: 4, den: 4, symbol: Some(MeterSymbol::Common) }),
        "C|" => return Some(Meter { num: 2, den: 2, symbol: Some(MeterSymbol::Cut) }),
        "none" | "" => return None,
        _ => {}
    }
    let (num, den) = value.split_once('/')?;
    // Compound numerators like 2+3 add up.
    let num: u32 = num.split('+').filter_map(|n| n.trim().parse::<u32>().ok()).sum();
    let den: u32 = den.trim().parse().ok()?;
    (num > 0 && den > 0).then_some(Meter { num, den, symbol: None })
}

fn parse_unit(value: &str) -> Option<Frac> {
    let (num, den) = value.trim().split_once('/')?;
    Some(Frac::new(num.trim().parse().ok()?, den.trim().parse().ok()?))
}

/// `D`, `Dmaj`, `E minor`, `Amixolydian`, `F#m`, `Bb`, `HP` (bagpipes, as A mixolydian) …
pub fn parse_key(value: &str) -> Key {
    let value = value.trim();
    let mut chars = value.chars().peekable();
    let Some(tonic) = chars.next().filter(|c| ('A'..='G').contains(&c.to_ascii_uppercase())) else {
        return Key { fifths: if value.starts_with("HP") || value.starts_with("Hp") { 2 } else { 0 } };
    };
    // Major keys' sharps (positive) or flats from C.
    let mut fifths = match tonic.to_ascii_uppercase() {
        'C' => 0,
        'G' => 1,
        'D' => 2,
        'A' => 3,
        'E' => 4,
        'B' => 5,
        _ => -1, // F
    };
    match chars.peek() {
        Some('#') => {
            chars.next();
            fifths += 7;
        }
        Some('b') => {
            chars.next();
            fifths -= 7;
        }
        _ => {}
    }
    let mode: String = chars.collect::<String>().trim_start().to_ascii_lowercase();
    let mode = mode.split_whitespace().next().unwrap_or("");
    fifths += if mode.starts_with("mix") {
        -1
    } else if mode.starts_with("dor") {
        -2
    } else if mode.starts_with("phr") {
        -4
    } else if mode.starts_with("lyd") {
        1
    } else if mode.starts_with("loc") {
        -5
    } else if mode.starts_with("maj") || mode.starts_with("ion") {
        0
    } else if mode.starts_with('m') || mode.starts_with("aeo") {
        -3
    } else {
        0
    };
    Key { fifths: fifths.clamp(-7, 7) }
}

#[derive(Default)]
struct Pending {
    chord: Option<String>,
    roll: bool,
    grace: Vec<Pitch>,
    /// Broken rhythm waiting for the next note: its factor.
    broken_next: Option<Frac>,
    /// A tuplet in progress: (number, notes left, length factor).
    tuplet: Option<(u32, u32, Frac)>,
    tuplet_start: Option<(u32, u32)>,
}

struct Reader {
    chars: Vec<char>,
    at: usize,
    meter: Meter,
    unit: Frac,
    key: Key,
    items: Vec<Item>,
    skipped: Vec<String>,
    next_id: u32,
    /// Accidentals written earlier in this bar, by diatonic step.
    bar_acc: Vec<(i32, i32)>,
    pending: Pending,
}

impl Reader {
    fn peek(&self, ahead: usize) -> Option<char> {
        self.chars.get(self.at + ahead).copied()
    }

    fn skip(&mut self, what: impl Into<String>) {
        let what = what.into();
        if !self.skipped.contains(&what) {
            self.skipped.push(what);
        }
    }

    fn read(&mut self) {
        let mut line_start = true;
        while let Some(c) = self.peek(0) {
            // A field on a line of its own, mid-tune: K:, M:, L: change things; the rest (w:, P:, T: …) are skipped.
            if line_start && c.is_ascii_alphabetic() && self.peek(1) == Some(':') {
                let end =
                    self.chars[self.at..].iter().position(|&c| c == '\n').map_or(self.chars.len(), |n| self.at + n);
                let line: String = self.chars[self.at..end].iter().collect();
                self.at = end;
                self.inline_field(&line);
                continue;
            }
            line_start = false;
            match c {
                '\n' => {
                    self.at += 1;
                    line_start = true;
                    self.beam_break();
                }
                ' ' | '\t' => {
                    self.at += 1;
                    self.beam_break();
                }
                '%' => {
                    while self.peek(0).is_some_and(|c| c != '\n') {
                        self.at += 1;
                    }
                }
                '"' => self.quoted(),
                '!' | '+' => self.decoration(c),
                '~' => {
                    self.at += 1;
                    self.pending.roll = true;
                }
                '{' => self.grace(),
                '(' => self.tuplet_or_slur(),
                '[' => self.bracket(),
                '|' | ':' => self.bar(),
                '-' => {
                    self.at += 1;
                    if let Some(Item::Note(note)) = self.items.iter_mut().rev().find(|i| !matches!(i, Item::BeamBreak))
                    {
                        note.tie = true;
                    }
                }
                '>' | '<' => self.broken(c),
                '^' | '_' | '=' | 'A'..='G' | 'a'..='g' => self.note(),
                'z' | 'x' => self.rest(),
                'Z' => {
                    self.at += 1;
                    let bars = self.number().unwrap_or(1) as i64;
                    let bar = self.meter.bar();
                    self.push_rest(Frac::new(bar.num * bars, bar.den), false);
                }
                ')' => {
                    self.at += 1;
                }
                '.' | 'H' | 'L' | 'M' | 'O' | 'P' | 'S' | 'T' | 'u' | 'v' | 'J' | 'R' => {
                    self.at += 1;
                    self.skip(format!("decoration {c}"));
                }
                _ => {
                    // `\` continuations, `$` score breaks, back-ticks, `y` spacers and anything unknown.
                    self.at += 1;
                    if !matches!(c, '\\' | '$' | '`' | 'y' | '\r') {
                        self.skip(format!("character {c}"));
                    }
                }
            }
        }
    }

    fn beam_break(&mut self) {
        if !matches!(self.items.last(), Some(Item::BeamBreak) | None) {
            self.items.push(Item::BeamBreak);
        }
    }

    fn inline_field(&mut self, text: &str) {
        let Some((letter, value)) = field(text) else { return };
        match letter {
            'K' => {
                self.key = parse_key(value);
                self.items.push(Item::KeyChange(self.key));
            }
            'M' => {
                if let Some(meter) = parse_meter(value) {
                    self.meter = meter;
                    self.items.push(Item::MeterChange(meter));
                }
            }
            'L' => {
                if let Some(unit) = parse_unit(value) {
                    self.unit = unit;
                }
            }
            _ => self.skip(format!("field {letter}:")),
        }
    }

    /// `"G"` a chord symbol over the next note; `"^text"` and other annotations are skipped.
    fn quoted(&mut self) {
        self.at += 1;
        let mut text = String::new();
        while let Some(c) = self.peek(0) {
            self.at += 1;
            if c == '"' {
                break;
            }
            text.push(c);
        }
        if text.starts_with(['^', '_', '<', '>', '@']) {
            self.skip("annotation");
        } else if !text.is_empty() {
            self.pending.chord = Some(text);
        }
    }

    /// `!trill!` or `+trill+`; a `!` that closes no such name (no space or bar before the next) is the old ABC
    /// line break The Session still writes (`|edef a4|! f2ed`), and means nothing to the music.
    fn decoration(&mut self, close: char) {
        let name: String =
            (1..).map_while(|i| self.peek(i).filter(|&c| c != close && !c.is_whitespace() && c != '|')).collect();
        if self.peek(name.chars().count() + 1) != Some(close) || name.is_empty() {
            self.at += 1;
            if close == '+' {
                self.skip("+".to_string());
            }
            return;
        }
        self.at += name.chars().count() + 2;
        if name == "roll" {
            self.pending.roll = true;
        } else {
            self.skip(format!("!{name}!"));
        }
    }

    fn grace(&mut self) {
        self.at += 1;
        while let Some(c) = self.peek(0) {
            match c {
                '}' => {
                    self.at += 1;
                    break;
                }
                '^' | '_' | '=' | 'A'..='G' | 'a'..='g' => {
                    if let Some(pitch) = self.pitch() {
                        self.pending.grace.push(pitch);
                    }
                    let _ = self.length();
                }
                _ => self.at += 1,
            }
        }
    }

    /// `(3` a tuplet, `(p:q:r` in full; a bare `(` starts a slur, which is not drawn.
    fn tuplet_or_slur(&mut self) {
        self.at += 1;
        let Some(p) = self.number() else {
            self.skip("slur");
            return;
        };
        let mut q = None;
        let mut r = None;
        if self.peek(0) == Some(':') {
            self.at += 1;
            q = self.number();
            if self.peek(0) == Some(':') {
                self.at += 1;
                r = self.number();
            }
        }
        let q = q.unwrap_or(match p {
            2 | 4 | 8 => 3,
            3 | 6 => 2,
            _ => {
                if self.meter.compound() {
                    3
                } else {
                    2
                }
            }
        });
        let r = r.unwrap_or(p).max(1);
        self.pending.tuplet = Some((p, r, Frac::new(q as i64, p.max(1) as i64)));
        self.pending.tuplet_start = Some((p, r));
    }

    /// `[1` an ending, `[|` a bar, `[K:…]` an inline field, `[CEG]` a chord.
    fn bracket(&mut self) {
        match (self.peek(1), self.peek(2)) {
            (Some(d), _) if d.is_ascii_digit() => {
                self.at += 1;
                let n = self.number().unwrap_or(1);
                // `[1,3` and the like: only the first number is drawn.
                while self.peek(0).is_some_and(|c| c == ',' || c == '-' || c.is_ascii_digit()) {
                    self.at += 1;
                }
                self.items.push(Item::Ending(n.min(9) as u8));
            }
            (Some('|'), _) => {
                self.at += 2;
                self.push_bar(BarKind::Start);
            }
            (Some(f), Some(':')) if f.is_ascii_alphabetic() => {
                self.at += 1;
                let end =
                    self.chars[self.at..].iter().position(|&c| c == ']').map_or(self.chars.len(), |n| self.at + n);
                let text: String = self.chars[self.at..end].iter().collect();
                self.at = (end + 1).min(self.chars.len());
                self.inline_field(&text);
            }
            _ => {
                self.at += 1;
                let mut pitches = vec![];
                let mut inner = None;
                while let Some(c) = self.peek(0) {
                    match c {
                        ']' => {
                            self.at += 1;
                            break;
                        }
                        '^' | '_' | '=' | 'A'..='G' | 'a'..='g' => {
                            if let Some(pitch) = self.pitch() {
                                pitches.push(pitch);
                            }
                            let length = self.length();
                            inner.get_or_insert(length);
                        }
                        '\n' => break,
                        _ => self.at += 1,
                    }
                }
                let outer = self.length();
                if pitches.is_empty() {
                    return;
                }
                pitches.sort_by_key(|p| p.step);
                let length = inner.unwrap_or(Frac::new(1, 1)) * outer;
                self.push_note(pitches, length);
            }
        }
    }

    fn bar(&mut self) {
        let mut colons_before = 0;
        while self.peek(0) == Some(':') {
            colons_before += 1;
            self.at += 1;
        }
        if self.peek(0) != Some('|') && self.peek(0) != Some('[') {
            // `::` on its own.
            if colons_before >= 2 {
                self.push_bar(BarKind::DoubleRepeat);
            } else {
                self.skip("stray :");
            }
            return;
        }
        let mut pipes = 0;
        let mut closes = false;
        while self.peek(0) == Some('|') {
            pipes += 1;
            self.at += 1;
        }
        if self.peek(0) == Some(']') && pipes > 0 {
            closes = true;
            self.at += 1;
        }
        let mut colons_after = 0;
        while self.peek(0) == Some(':') {
            colons_after += 1;
            self.at += 1;
        }
        let kind = match (colons_before > 0, colons_after > 0) {
            (true, true) => BarKind::DoubleRepeat,
            (true, false) => BarKind::EndRepeat,
            (false, true) => BarKind::StartRepeat,
            _ if closes => BarKind::Final,
            _ if pipes >= 2 => BarKind::Double,
            _ => BarKind::Single,
        };
        self.push_bar(kind);
        // `|1`, `:|2`: an ending right on the bar.
        if self.peek(0).is_some_and(|c| c.is_ascii_digit()) {
            let n = self.number().unwrap_or(1);
            while self.peek(0).is_some_and(|c| c == ',' || c == '-' || c.is_ascii_digit()) {
                self.at += 1;
            }
            self.items.push(Item::Ending(n.min(9) as u8));
        }
    }

    fn push_bar(&mut self, kind: BarKind) {
        if matches!(self.items.last(), Some(Item::BeamBreak)) {
            self.items.pop();
        }
        self.items.push(Item::Bar(Bar { kind }));
        self.bar_acc.clear();
    }

    /// `>`: the note before is dotted and the next halved; `>>` doubly so. `<` the other way.
    fn broken(&mut self, c: char) {
        let mut count = 0;
        while self.peek(0) == Some(c) {
            count += 1;
            self.at += 1;
        }
        let shorter = Frac::new(1, 1 << count.min(3));
        let longer = Frac::new(2, 1) + Frac::new(-shorter.num, shorter.den);
        let (before, after) = if c == '>' { (longer, shorter) } else { (shorter, longer) };
        if let Some(item) = self.items.iter_mut().rev().find(|i| !matches!(i, Item::BeamBreak)) {
            match item {
                Item::Note(note) => {
                    note.dur = note.dur * before;
                    note.shown = note.shown * before;
                }
                Item::Rest(rest) => {
                    rest.dur = rest.dur * before;
                    rest.shown = rest.shown * before;
                }
                _ => {}
            }
        }
        // `a > b` with spaces still beams them: drop the break just read.
        if matches!(self.items.last(), Some(Item::BeamBreak)) {
            self.items.pop();
        }
        self.pending.broken_next = Some(after);
    }

    fn note(&mut self) {
        let Some(pitch) = self.pitch() else {
            self.at += 1;
            return;
        };
        let length = self.length();
        self.push_note(vec![pitch], length);
    }

    fn rest(&mut self) {
        let invisible = self.peek(0) == Some('x');
        self.at += 1;
        let length = self.length();
        self.push_rest(self.unit * length, invisible);
    }

    /// The length factor after a note: `2`, `/2`, `/`, `3/2`, `//` …
    fn length(&mut self) -> Frac {
        let num = self.number().unwrap_or(1) as i64;
        let mut den = 1i64;
        while self.peek(0) == Some('/') {
            self.at += 1;
            match self.number() {
                Some(d) => den *= d.max(1) as i64,
                None => den *= 2,
            }
        }
        Frac::new(num, den)
    }

    fn number(&mut self) -> Option<u32> {
        let start = self.at;
        while self.peek(0).is_some_and(|c| c.is_ascii_digit()) {
            self.at += 1;
        }
        let text: String = self.chars[start..self.at].iter().collect();
        text.parse().ok()
    }

    /// An accidental, a letter and octave marks: `^f`, `_B,`, `=c'`.
    fn pitch(&mut self) -> Option<Pitch> {
        let mut acc = None;
        match (self.peek(0), self.peek(1)) {
            (Some('^'), Some('^')) => {
                acc = Some(Acc::DoubleSharp);
                self.at += 2;
            }
            (Some('_'), Some('_')) => {
                acc = Some(Acc::DoubleFlat);
                self.at += 2;
            }
            (Some('^'), _) => {
                acc = Some(Acc::Sharp);
                self.at += 1;
            }
            (Some('_'), _) => {
                acc = Some(Acc::Flat);
                self.at += 1;
            }
            (Some('='), _) => {
                acc = Some(Acc::Natural);
                self.at += 1;
            }
            _ => {}
        }
        let letter = self.peek(0)?;
        let (index, mut octave) = match letter {
            'C'..='G' => (letter as i32 - 'C' as i32, 4),
            'A' | 'B' => (letter as i32 - 'A' as i32 + 5, 4),
            'c'..='g' => (letter as i32 - 'c' as i32, 5),
            'a' | 'b' => (letter as i32 - 'a' as i32 + 5, 5),
            _ => return None,
        };
        self.at += 1;
        while let Some(mark) = self.peek(0) {
            match mark {
                ',' => octave -= 1,
                '\'' => octave += 1,
                _ => break,
            }
            self.at += 1;
        }
        let step = octave * 7 + index;
        let alter = match acc {
            Some(acc) => {
                self.bar_acc.retain(|&(s, _)| s != step);
                self.bar_acc.push((step, acc.alter()));
                acc.alter()
            }
            None => {
                self.bar_acc.iter().rev().find(|&&(s, _)| s == step).map_or_else(|| self.key.alter(index), |&(_, a)| a)
            }
        };
        Some(Pitch { step, acc, alter })
    }

    /// Length factor → the note's length, with broken rhythm and any tuplet applied.
    fn timed(&mut self, written: Frac) -> (Frac, Frac, Option<(u32, u32)>) {
        let mut dur = written;
        let mut shown = written;
        if let Some(factor) = self.pending.broken_next.take() {
            dur = dur * factor;
            shown = shown * factor;
        }
        let start = self.pending.tuplet_start.take();
        if let Some((p, left, factor)) = self.pending.tuplet {
            dur = dur * factor;
            self.pending.tuplet = (left > 1).then_some((p, left - 1, factor));
        }
        (dur, shown, start)
    }

    fn push_note(&mut self, pitches: Vec<Pitch>, length: Frac) {
        let (dur, shown, tuplet) = self.timed(self.unit * length);
        let id = self.next_id;
        self.next_id += 1;
        let pending = std::mem::take(&mut self.pending.grace);
        self.items.push(Item::Note(Note {
            pitches,
            dur,
            shown,
            tie: false,
            grace: pending,
            roll: std::mem::take(&mut self.pending.roll),
            chord: self.pending.chord.take(),
            tuplet,
            id,
        }));
    }

    fn push_rest(&mut self, written: Frac, invisible: bool) {
        let (dur, shown, _) = self.timed(written);
        let id = self.next_id;
        self.next_id += 1;
        self.pending.chord = None;
        self.items.push(Item::Rest(Rest { dur, shown, invisible, id }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notes(tune: &Tune) -> Vec<&Note> {
        tune.items.iter().filter_map(|i| if let Item::Note(n) = i { Some(n) } else { None }).collect()
    }

    #[test]
    fn reads_header_and_lengths() {
        let tune = parse("X:1\nM:6/8\nL:1/8\nK:Ador\nA2B c>d e/f/|\n");
        assert_eq!(tune.meter, Meter { num: 6, den: 8, symbol: None });
        assert_eq!(tune.key.fifths, 1); // A dorian: F sharp, as G major
        let lengths: Vec<Frac> = notes(&tune).iter().map(|n| n.dur).collect();
        assert_eq!(
            lengths,
            vec![
                Frac::new(1, 4),
                Frac::new(1, 8),
                Frac::new(3, 16),
                Frac::new(1, 16),
                Frac::new(1, 16),
                Frac::new(1, 16)
            ]
        );
    }

    #[test]
    fn keys_and_accidentals() {
        assert_eq!(parse_key("Dmajor").fifths, 2);
        assert_eq!(parse_key("Edorian").fifths, 2);
        assert_eq!(parse_key("Amixolydian").fifths, 2);
        assert_eq!(parse_key("Bminor").fifths, 2);
        assert_eq!(parse_key("Gm").fifths, -2);
        let tune = parse("K:D\nF ^G G | G\n");
        let midis: Vec<i32> = notes(&tune).iter().map(|n| n.pitches[0].midi()).collect();
        // F# in D; G# written, still sharp later in the bar; natural again after the bar.
        assert_eq!(midis, vec![66, 68, 68, 67]);
    }

    #[test]
    fn triplets_rolls_endings_and_bars() {
        let tune = parse("K:G\n|:~G3 (3ABc|1 d2:|2 e2|]\n");
        let ns = notes(&tune);
        assert!(ns[0].roll);
        assert_eq!(ns[1].tuplet, Some((3, 3)));
        assert_eq!(ns[1].dur, Frac::new(1, 12));
        assert_eq!(ns[1].shown, Frac::new(1, 8));
        let bars: Vec<BarKind> =
            tune.items.iter().filter_map(|i| if let Item::Bar(b) = i { Some(b.kind) } else { None }).collect();
        assert_eq!(bars, vec![BarKind::StartRepeat, BarKind::Single, BarKind::EndRepeat, BarKind::Final]);
        assert_eq!(tune.items.iter().filter(|i| matches!(i, Item::Ending(_))).count(), 2);
    }
}
