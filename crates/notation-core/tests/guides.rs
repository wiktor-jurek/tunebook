//! Every tune in the website's guides (apps/web/src/lib/guides/guides.json) reads, engraves and plays:
//! with the headers the apps give The Session's bare bodies, nothing in them is skipped as unknown,
//! each lays out at every zoom, and each plays at least a bar.

use notation_core::{LayoutOptions, engrave, parse, timeline};

fn tunes() -> Vec<(String, String)> {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/web/src/lib/guides/guides.json");
    let json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    json["tunes"]
        .as_object()
        .unwrap()
        .values()
        .map(|t| {
            let text = |key: &str, fallback: &str| t[key].as_str().filter(|s| !s.is_empty()).unwrap_or(fallback).to_string();
            // As `Abc.forScore` builds it.
            let abc = format!("X:1\nM:{}\nL:1/8\nQ:1/4=100\nK:{}\n{}", text("meter", "4/4"), text("mode", "D"), text("abc", ""));
            (text("title", "?"), abc)
        })
        .collect()
}

#[test]
fn every_guide_tune_reads_engraves_and_plays() {
    let tunes = tunes();
    assert!(tunes.len() >= 50, "found {} tunes", tunes.len());
    for (title, abc) in &tunes {
        let tune = parse(abc);
        let unknown: Vec<&String> = tune.skipped.iter().filter(|s| s.starts_with("character")).collect();
        assert!(unknown.is_empty(), "{title}: skipped {unknown:?}");
        for width in [80.0, 116.0, 152.0] {
            let e = engrave(&tune, &LayoutOptions { staff_width: width, bars_per_line: 4, phrase_bars: 0 });
            assert!(e.width <= width + 0.01, "{title}: {} wide in {width}", e.width);
            assert!(!e.notes.is_empty(), "{title}: no notes drawn");
            assert!(e.glyphs.iter().all(|g| g.x.is_finite() && g.y.is_finite()), "{title}: a glyph off the page");
            let widest = e.lines.iter().map(|l| l.x1.max(l.x2)).fold(0.0f32, f32::max);
            assert!(widest <= e.width + 0.05, "{title}: a line reaches {widest} past the staff's {} at {width}", e.width);
        }
        let played: f64 = timeline(&tune).iter().map(|e| e.duration).sum();
        assert!(played >= tune.meter.bar().f64(), "{title}: plays only {played} whole notes");
    }
}

#[test]
fn old_line_breaks_are_not_decorations() {
    // Homer's as The Session has it: `!` ends each line, as ABC once broke lines.
    let abc = "X:1\nM:4/4\nL:1/8\nK:Bminor\n|:f2ed B2e2|dBAF E2FA|BF~F2 Bcdf|edef a4|! f2ed B2e2|dBAF E2FA|BF~F2 Bcdf|edBA B4:|! |:B2dA BFAB|edef a3f|edBA F3A|dBAF E2FA|! B2dA BFAB|edef a2fa|b2af e2a2|fedA B4:|";
    let tune = parse(abc);
    assert!(tune.skipped.is_empty(), "skipped {:?}", tune.skipped);
    let bars = tune.items.iter().filter(|i| matches!(i, notation_core::parse::Item::Bar(_))).count();
    assert!(bars >= 16, "only {bars} bars");
    let played: f64 = timeline(&tune).iter().map(|e| e.duration).sum();
    assert!((played - 32.0).abs() < 1e-6, "plays {played} whole notes, not 32 (16 bars twice)");
}

#[test]
fn a_reel_fits_two_bars_to_a_phone_line() {
    // Homer's as a library keeps it: 16 bars of 4/4, at the phone's 400 (50 staff spaces), two to a line as abcjs draws it.
    let abc = "X:1\nM:4/4\nL:1/8\nQ:1/4=100\nK:Bminor\n|:f2ed B2e2|dBAF E2FA|BF~F2 Bcdf|edef a4|\r\nf2ed B2e2|dBAF E2FA|BF~F2 Bcdf|edBA B4:|\r\n|:B2dA BFAB|edef a3f|edBA F3A|dBAF E2FA|\r\nB2dA BFAB|edef a2fa|b2af e2a2|fedA B4:|";
    let e = engrave(&parse(abc), &LayoutOptions { staff_width: 50.0, bars_per_line: 4, phrase_bars: 0 });
    let staves = e.lines.iter().filter(|l| l.x1 == 0.0 && l.y1 == l.y2).count() / 5;
    assert_eq!(staves, 8);
    let wide = engrave(&parse(abc), &LayoutOptions { staff_width: 95.0, bars_per_line: 4, phrase_bars: 0 });
    assert_eq!(wide.lines.iter().filter(|l| l.x1 == 0.0 && l.y1 == l.y2).count() / 5, 4);
}
