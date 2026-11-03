//! The Tune finder's front end: a port of `ml/tunebook_ml/pitchclass.py` (by way of
//! `apps/web/src/lib/finder/features.ts`), so every platform feeds the model exactly what it was
//! trained on. 8 s of 16 kHz audio becomes 12 pitch classes and their 12 heights
//! (`TUNEBOOK_FEATURES=height`) × 400 frames, KeyCanon'd. `tests/fixture.rs` checks it against the
//! Python output.

use std::f64::consts::PI;
use std::sync::OnceLock;

pub const SAMPLE_RATE: u32 = 16_000;
pub const N_FFT: usize = 2048;
pub const HOP: usize = 320;
/// 8 s at 50 frames a second.
pub const FRAMES: usize = 400;
pub const WINDOW_SAMPLES: usize = FRAMES * HOP;
/// The shipped model takes heights after the pitch classes: where in the melody range each pitch
/// class sounds, so a leap up an octave is not a repeated note. Must match the shipped model.
pub const CHANNELS: usize = 24;

const BINS: usize = N_FFT / 2 + 1;
/// G3 to C7.
const MELODY_LOW: usize = 55;
const MELODY_HIGH: usize = 96;
const HARMONICS: [(usize, f64); 4] = [(0, 1.0), (12, 0.6), (19, 0.4), (24, 0.3)];
const LOG_GAIN: f64 = 100.0;
/// Highest semitone a partial reaches.
const NOTES: usize = MELODY_HIGH + 24 + 1;

/// Tables built once: the Hann window, the FFT's bit reversal and twiddles, and the semitone filters.
struct Tables {
    hann: Vec<f64>,
    bit_reverse: Vec<usize>,
    cos: Vec<f64>,
    sin: Vec<f64>,
    filters: Vec<(Vec<usize>, Vec<f64>)>,
}

fn tables() -> &'static Tables {
    static TABLES: OnceLock<Tables> = OnceLock::new();
    TABLES.get_or_init(|| {
        // Periodic Hann window, as torch.hann_window.
        let hann = (0..N_FFT).map(|n| 0.5 - 0.5 * ((2.0 * PI * n as f64) / N_FFT as f64).cos()).collect();
        let bits = N_FFT.trailing_zeros();
        let bit_reverse = (0..N_FFT).map(|i| i.reverse_bits() >> (usize::BITS - bits)).collect();
        let cos = (0..N_FFT / 2).map(|k| ((-2.0 * PI * k as f64) / N_FFT as f64).cos()).collect();
        let sin = (0..N_FFT / 2).map(|k| ((-2.0 * PI * k as f64) / N_FFT as f64).sin()).collect();
        // Triangular filters a semitone either side of each MIDI note, rows normalised to sum to 1; kept sparse.
        let midi: Vec<f64> = (0..BINS)
            .map(|f| 69.0 + 12.0 * ((f as f64 * SAMPLE_RATE as f64 / N_FFT as f64).max(1.0) / 440.0).log2())
            .collect();
        let filters = (0..NOTES)
            .map(|m| {
                let (mut bins, mut weights) = (Vec::new(), Vec::new());
                for (f, &note) in midi.iter().enumerate().skip(1) {
                    let w = 1.0 - (note - m as f64).abs();
                    if w > 0.0 {
                        bins.push(f);
                        weights.push(w);
                    }
                }
                let total = weights.iter().sum::<f64>().max(1e-6);
                (bins, weights.into_iter().map(|w| w / total).collect())
            })
            .collect();
        Tables { hann, bit_reverse, cos, sin, filters }
    })
}

/// In-place radix-2 FFT of `N_FFT` points.
fn fft(t: &Tables, re: &mut [f64], im: &mut [f64]) {
    for i in 0..N_FFT {
        let j = t.bit_reverse[i];
        if j > i {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut size = 2;
    while size <= N_FFT {
        let (half, step) = (size / 2, N_FFT / size);
        for start in (0..N_FFT).step_by(size) {
            for k in 0..half {
                let (a, b) = (start + k, start + k + half);
                let (wr, wi) = (t.cos[k * step], t.sin[k * step]);
                let tr = re[b] * wr - im[b] * wi;
                let ti = re[b] * wi + im[b] * wr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
            }
        }
        size *= 2;
    }
}

fn reflect(i: isize, n: usize) -> usize {
    let n = n as isize;
    (if i < 0 {
        -i
    } else if i >= n {
        2 * (n - 1) - i
    } else {
        i
    }) as usize
}

/// Magnitude STFT, centred with reflect padding like torch.stft: (BINS × frames), bin-major.
fn stft(t: &Tables, audio: &[f32], frames: usize) -> Vec<f64> {
    let mut spec = vec![0.0; BINS * frames];
    let (mut re, mut im) = (vec![0.0; N_FFT], vec![0.0; N_FFT]);
    for frame in 0..frames {
        let start = (frame * HOP) as isize - (N_FFT / 2) as isize;
        for n in 0..N_FFT {
            re[n] = audio[reflect(start + n as isize, audio.len())] as f64 * t.hann[n];
            im[n] = 0.0;
        }
        fft(t, &mut re, &mut im);
        for f in 0..BINS {
            spec[f * frames + frame] = re[f].hypot(im[f]);
        }
    }
    spec
}

/// Running median along one axis of a (rows × cols) array, reflect-padded; odd kernels only.
/// Keeps the window sorted as it slides (drop the outgoing value, insert the incoming one)
/// rather than sorting every position.
fn median(x: &[f64], rows: usize, cols: usize, kernel: usize, along_rows: bool) -> Vec<f64> {
    let mut out = vec![0.0; x.len()];
    let half = kernel / 2;
    let (lines, length, step) = if along_rows { (cols, rows, cols) } else { (rows, cols, 1) };
    let mut padded = vec![0.0; length + kernel - 1];
    let mut sorted = vec![0.0; kernel];
    for line in 0..lines {
        let start = if along_rows { line } else { line * cols };
        for (i, p) in padded.iter_mut().enumerate() {
            *p = x[start + reflect(i as isize - half as isize, length) * step];
        }
        sorted.copy_from_slice(&padded[..kernel]);
        sorted.sort_by(f64::total_cmp);
        out[start] = sorted[half];
        for i in 1..length {
            let (gone, come) = (padded[i - 1], padded[i + kernel - 1]);
            let mut at = 0;
            while sorted[at] != gone {
                at += 1;
            }
            // Close the gap towards where the incoming value belongs, then drop it in.
            while at > 0 && sorted[at - 1] > come {
                sorted[at] = sorted[at - 1];
                at -= 1;
            }
            while at < kernel - 1 && sorted[at + 1] < come {
                sorted[at] = sorted[at + 1];
                at += 1;
            }
            sorted[at] = come;
            out[start + i * step] = sorted[half];
        }
    }
    out
}

/// torch.quantile with linear interpolation.
fn quantile(values: &[f64], q: f64) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let position = q * (sorted.len() - 1) as f64;
    let lo = position.floor() as usize;
    let frac = position - lo as f64;
    if lo + 1 < sorted.len() { sorted[lo] + frac * (sorted[lo + 1] - sorted[lo]) } else { sorted[lo] }
}

/// Harmonic part of the spectrum (median-filter HPSS) mapped to semitone power: (NOTES × FRAMES).
pub fn semitones(audio: &[f32]) -> Vec<f64> {
    let t = tables();
    let frames = 1 + audio.len() / HOP;
    let spec = stft(t, audio, frames);
    let harmonic = median(&spec, BINS, frames, 9, false); // across time: sustained tones survive
    let percussive = median(&spec, BINS, frames, 17, true); // across frequency: broadband clicks survive
    let power: Vec<f64> = (0..spec.len())
        .map(|i| {
            let h2 = harmonic[i].powi(2);
            let mask = h2 / (h2 + percussive[i].powi(2) + 1e-10);
            (spec[i] * mask).powi(2)
        })
        .collect();
    let mut semis = vec![0.0; NOTES * FRAMES];
    for (m, (bins, weights)) in t.filters.iter().enumerate() {
        for (&bin, &w) in bins.iter().zip(weights) {
            let row = bin * frames;
            for frame in 0..FRAMES {
                semis[m * FRAMES + frame] += w * power[row + frame];
            }
        }
    }
    semis
}

/// Rotation that puts the pitch-class profile's first Fourier coefficient at phase 0.
pub fn key_shift(pcs: &[f32]) -> usize {
    let (mut re, mut im) = (0.0, 0.0);
    for k in 0..12 {
        let profile: f64 = pcs[k * FRAMES..(k + 1) * FRAMES].iter().map(|&v| v as f64).sum();
        re += profile * (2.0 * PI * k as f64 / 12.0).cos();
        im += profile * -(2.0 * PI * k as f64 / 12.0).sin();
    }
    let x = -im.atan2(re) * 12.0 / (2.0 * PI);
    // torch.round rounds halves to even.
    let rounded = x.round_ties_even() as i64;
    rounded.rem_euclid(12) as usize
}

/// Semitone power → KeyCanon'd pitch-class salience in [0, 1], bin 0 = C before the rotation, then
/// each pitch class's height (its salience-weighted mean semitone, 0.1 at G3 to 1.0 at C7, times its
/// salience): (channels × FRAMES), the heights turned with their pitch classes.
pub fn features(semis: &[f64], channels: usize) -> Vec<f32> {
    assert!(channels == 12 || channels == 24, "channels must be 12 or 24");
    // The level is taken over all 128 MIDI rows in Python; rows above NOTES are silent and only shift the quantile's index.
    let mut all = vec![0.0; 128 * FRAMES];
    all[..semis.len()].copy_from_slice(semis);
    let level = quantile(&all, 0.995).max(1e-10);
    let (mut pcs, mut weighted) = (vec![0.0; 12 * FRAMES], vec![0.0; 12 * FRAMES]);
    let span = MELODY_HIGH - MELODY_LOW;
    for k in 0..=span {
        let row = ((k + MELODY_LOW) % 12) * FRAMES;
        let position = 0.1 + 0.9 * k as f64 / span as f64; // torch.linspace(0.1, 1.0, 42)
        for (offset, weight) in HARMONICS {
            let source = (MELODY_LOW + offset + k) * FRAMES;
            for frame in 0..FRAMES {
                let value = weight * (LOG_GAIN * semis[source + frame] / level).ln_1p();
                pcs[row + frame] += value;
                weighted[row + frame] += value * position;
            }
        }
    }
    let before = pcs.clone(); // each pitch class's salience before the drone is taken off
    // A tone held through the whole window (drone, hum) is not melody.
    for k in 0..12 {
        let row = &mut pcs[k * FRAMES..(k + 1) * FRAMES];
        let low = row.iter().copied().fold(f64::INFINITY, f64::min);
        for v in row.iter_mut() {
            *v = (*v - low).max(0.0);
        }
    }
    let scale = quantile(&pcs, 0.99).max(1e-6);
    let mut raw = vec![0.0f32; channels * FRAMES];
    for i in 0..12 * FRAMES {
        raw[i] = (pcs[i] / scale).min(1.0) as f32;
    }
    if channels == 24 {
        for i in 0..12 * FRAMES {
            raw[12 * FRAMES + i] = (raw[i] as f64 * (weighted[i] / before[i].max(1e-6))) as f32;
        }
    }
    let shift = key_shift(&raw);
    let mut out = vec![0.0f32; channels * FRAMES];
    for group in (0..channels).step_by(12) {
        for k in 0..12 {
            let from = (group + (k + shift) % 12) * FRAMES;
            out[(group + k) * FRAMES..(group + k + 1) * FRAMES].copy_from_slice(&raw[from..from + FRAMES]);
        }
    }
    out
}

/// 8 s of 16 kHz mono audio (zero-padded or cut to length) → one model input window,
/// `CHANNELS × FRAMES`, channel-major.
pub fn window_features(audio: &[f32]) -> Vec<f32> {
    window_features_with(audio, CHANNELS)
}

/// As [`window_features`] for a model taking `channels` (12: pitch classes only; 24: with heights).
pub fn window_features_with(audio: &[f32], channels: usize) -> Vec<f32> {
    if audio.len() == WINDOW_SAMPLES {
        return features(&semitones(audio), channels);
    }
    let mut window = vec![0.0f32; WINDOW_SAMPLES];
    let n = audio.len().min(WINDOW_SAMPLES);
    window[..n].copy_from_slice(&audio[..n]);
    features(&semitones(&window), channels)
}
