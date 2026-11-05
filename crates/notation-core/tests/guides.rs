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
        }
        let played: f64 = timeline(&tune).iter().map(|e| e.duration).sum();
        assert!(played >= tune.meter.bar().f64(), "{title}: plays only {played} whole notes");
    }
}
