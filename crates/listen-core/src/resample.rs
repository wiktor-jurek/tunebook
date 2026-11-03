//! The microphone runs at the device's rate (44.1 or 48 kHz); the model's front end wants 16 kHz.
//! A windowed-sinc low-pass at 7.2 kHz, then interpolation. Melody partials above that carry
//! little for the features (the top note, C7, is 2.1 kHz).

use std::f64::consts::PI;

const TAPS: f64 = 64.0;
const CUTOFF: f64 = 7200.0;

/// Resamples mono audio from `from` Hz to `to` Hz.
pub fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to {
        return input.to_vec();
    }
    let ratio = from as f64 / to as f64;
    let length = (input.len() as f64 / ratio).floor() as usize;
    let cutoff = CUTOFF / from as f64;
    // Blackman-windowed sinc, x in input samples from the output point.
    let kernel = |x: f64| {
        if x.abs() >= TAPS / 2.0 {
            return 0.0;
        }
        let sinc = if x == 0.0 { 2.0 * cutoff } else { (2.0 * PI * cutoff * x).sin() / (PI * x) };
        let n = (x + TAPS / 2.0) / TAPS;
        sinc * (0.42 - 0.5 * (2.0 * PI * n).cos() + 0.08 * (4.0 * PI * n).cos())
    };
    (0..length)
        .map(|i| {
            let centre = i as f64 * ratio;
            let first = (centre - TAPS / 2.0).ceil().max(0.0) as usize;
            let last = ((centre + TAPS / 2.0).floor() as usize).min(input.len().saturating_sub(1));
            let (mut sum, mut norm) = (0.0, 0.0);
            for (j, &sample) in input.iter().enumerate().take(last + 1).skip(first) {
                let w = kernel(j as f64 - centre);
                sum += sample as f64 * w;
                norm += w;
            }
            if norm != 0.0 { (sum / norm) as f32 } else { 0.0 }
        })
        .collect()
}
