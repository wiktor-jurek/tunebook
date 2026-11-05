//! Tune Companion's notation engine, shared by the apps so a score draws natively and at once.
//!
//! [`parse`] reads a tune's ABC (the subset Irish and Scottish session tunes use: one voice, repeats
//! and endings, broken rhythm, rolls, triplets, grace notes, chord symbols, key and meter changes).
//! [`engrave`] lays it out as a display list in staff spaces (SMuFL glyphs, lines, beams, arcs and
//! text) that each platform only has to draw, and [`timeline`] lists its notes in playing order,
//! repeats and endings followed, for the player. Anything it does not know is skipped, never fatal.
//!
//! It replaces abcjs in the apps' web views; its layout follows abcjs's (the website's) closely so
//! a score reads the same on every platform.

pub mod engrave;
pub mod frac;
pub mod parse;
pub mod timeline;

pub use engrave::{Arc, Beam, Engraving, Glyph, LayoutOptions, Line, NoteBox, Text, engrave};
pub use frac::Frac;
pub use parse::{Tune, parse};
pub use timeline::{NoteEvent, timeline};

/// The crate version, so apps can show which engine they carry.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
