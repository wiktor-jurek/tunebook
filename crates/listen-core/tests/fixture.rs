//! Checks the Rust front end against the Python one, through the fixture that
//! ml/train/export_finder.py writes (the same one apps/web's features.test.ts reads).

use listen_core::features::{FRAMES, SAMPLE_RATE, WINDOW_SAMPLES, key_shift, window_features};
use listen_core::resample;

struct Fixture {
    shift: usize,
    features: Vec<Vec<f32>>,
}

fn fixture() -> Fixture {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/web/src/lib/finder/features.fixture.json");
    let json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).expect("read fixture")).unwrap();
    Fixture {
        shift: json["shift"].as_u64().unwrap() as usize,
        features: json["features"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row.as_array().unwrap().iter().map(|v| v.as_f64().unwrap() as f32).collect())
            .collect(),
    }
}

/// The same 8 s as test_signal() in ml/train/export_finder.py.
fn test_signal() -> Vec<f32> {
    let notes = [62, 66, 69, 74, 73, 71, 69, 66, 67, 71, 74, 78, 76, 74, 73, 71];
    (0..WINDOW_SAMPLES)
        .map(|n| {
            let t = n as f64 / SAMPLE_RATE as f64;
            let mut signal = 0.3 * (2.0 * std::f64::consts::PI * 98.0 * t).sin();
            for i in 0..40 {
                let local = t - i as f64 * 0.2;
                if !(0.0..0.2).contains(&local) {
                    continue;
                }
                let freq = 440.0 * 2f64.powf((notes[i % notes.len()] - 69) as f64 / 12.0);
                let envelope = (local / 0.01).min(1.0) * (-3.0 * local).exp();
                for h in 1..=4 {
                    signal += envelope * (2.0 * std::f64::consts::PI * freq * h as f64 * t).sin() / h as f64;
                }
            }
            // Float32Array stores 0.2 * signal as a float.
            (0.2 * signal) as f32
        })
        .collect()
}

#[test]
fn matches_the_python_front_end() {
    let fixture = fixture();
    let features = window_features(&test_signal());
    assert_eq!(features.len(), fixture.features.len() * FRAMES);
    let mut worst = 0f32;
    for (k, row) in fixture.features.iter().enumerate() {
        for (t, &expected) in row.iter().enumerate() {
            worst = worst.max((features[k * FRAMES + t] - expected).abs());
        }
    }
    assert!(worst < 2e-3, "worst difference {worst}");
}

#[test]
fn rotates_to_the_same_key_as_python() {
    // Undo the fixture's rotation and check the shift is found again.
    let fixture = fixture();
    let canon: Vec<f32> = fixture.features.concat();
    let mut raw = vec![0.0f32; canon.len()];
    for k in 0..canon.len() / FRAMES {
        let to = (k / 12) * 12 + ((k % 12) + fixture.shift) % 12;
        raw[to * FRAMES..(to + 1) * FRAMES].copy_from_slice(&canon[k * FRAMES..(k + 1) * FRAMES]);
    }
    assert_eq!(key_shift(&raw), fixture.shift);
}

#[test]
fn resamples_a_tone_without_moving_it() {
    let rate = 48_000;
    let input: Vec<f32> =
        (0..rate).map(|n| (2.0 * std::f64::consts::PI * 440.0 * n as f64 / rate as f64).sin() as f32).collect();
    let out = resample(&input, rate, SAMPLE_RATE);
    assert_eq!(out.len(), SAMPLE_RATE as usize);
    let mut error = 0f64;
    for (n, &v) in out.iter().enumerate().take(out.len() - 100).skip(100) {
        error =
            error.max((v as f64 - (2.0 * std::f64::consts::PI * 440.0 * n as f64 / SAMPLE_RATE as f64).sin()).abs());
    }
    assert!(error < 0.01, "error {error}");
}
