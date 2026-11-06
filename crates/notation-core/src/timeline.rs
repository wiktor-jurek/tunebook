//! A tune's notes in the order they are played: repeats taken, first and second endings followed.
//!
//! As abcjs plays a score: a `:|` goes back to the last `|:` (or the last `||`, or the start), once;
//! on the way round again the first ending is skipped and the second played. Tied notes sound as one.

use crate::frac::Frac;
use crate::parse::{BarKind, Item, Tune};

#[derive(Debug, Clone, PartialEq)]
pub struct NoteEvent {
    /// When it starts and how long it lasts, in whole notes from the start of the tune as played.
    pub start: f64,
    pub duration: f64,
    /// MIDI note numbers (several for a chord); empty for a rest.
    pub midi: Vec<i32>,
    /// The note or rest it plays, as drawn ([`crate::engrave::NoteBox::id`]), for lighting it up.
    pub id: u32,
}

/// The tune's notes and rests in playing order.
pub fn timeline(tune: &Tune) -> Vec<NoteEvent> {
    let items = &tune.items;
    let mut events: Vec<NoteEvent> = vec![];
    let mut at = Frac::ZERO;
    let mut i = 0;
    let mut repeat_from = 0;
    let mut taken: Vec<usize> = vec![];
    // Which time round the repeat this is, for endings: 1, then 2 after going back.
    let mut pass = 1u8;
    let mut skipping = false;
    let mut tied: Option<usize> = None;
    let mut guard = 0;
    while i < items.len() {
        guard += 1;
        if guard > items.len() * 8 {
            break; // Repeats that never settle: play what we have.
        }
        match &items[i] {
            Item::Bar(bar) => match bar.kind {
                BarKind::EndRepeat | BarKind::DoubleRepeat if !taken.contains(&i) => {
                    taken.push(i);
                    pass = 2;
                    skipping = false;
                    i = repeat_from;
                    continue;
                }
                BarKind::EndRepeat => {
                    skipping = false;
                }
                BarKind::DoubleRepeat => {
                    skipping = false;
                    pass = 1;
                    repeat_from = i + 1;
                }
                BarKind::StartRepeat => {
                    skipping = false;
                    pass = 1;
                    repeat_from = i + 1;
                }
                BarKind::Double | BarKind::Final | BarKind::Start => {
                    skipping = false;
                    pass = 1;
                    repeat_from = i + 1;
                }
                BarKind::Single => {}
            },
            Item::Ending(n) => skipping = *n != pass,
            Item::Note(note) if !skipping => {
                let midi: Vec<i32> = note.pitches.iter().map(|p| p.midi()).collect();
                match tied.take() {
                    // Tied on from the note before: it carries on sounding.
                    Some(index) if events[index].midi == midi => {
                        events[index].duration += note.dur.f64();
                    }
                    _ => events.push(NoteEvent { start: at.f64(), duration: note.dur.f64(), midi, id: note.id }),
                }
                if note.tie {
                    tied = Some(events.len() - 1);
                }
                at = at + note.dur;
            }
            Item::Rest(rest) if !skipping => {
                tied = None;
                events.push(NoteEvent { start: at.f64(), duration: rest.dur.f64(), midi: vec![], id: rest.id });
                at = at + rest.dur;
            }
            _ => {}
        }
        i += 1;
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse::parse;

    fn ids(abc: &str) -> Vec<u32> {
        timeline(&parse(abc)).iter().map(|e| e.id).collect()
    }

    #[test]
    fn repeats_and_endings() {
        // A B | 1 C :| 2 D |]  →  A B C A B D
        assert_eq!(ids("K:C\n|:AB|1 c:|2 d|]\n"), vec![0, 1, 2, 0, 1, 3]);
        // No start repeat: back to the beginning.
        assert_eq!(ids("K:C\nAB:|cd|]\n"), vec![0, 1, 0, 1, 2, 3]);
        // A second part repeats from its own |:.
        assert_eq!(ids("K:C\n|:A:|:B:|\n"), vec![0, 0, 1, 1]);
    }

    #[test]
    fn ties_sound_once() {
        let events = timeline(&parse("K:C\nA2-A2 B|\n"));
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].duration, 0.5);
    }
}
