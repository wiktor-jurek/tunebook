//! One listen, from microphone to answer, minus the model. A port of the web worker's loop
//! (`apps/web/src/lib/finder/worker.ts` and `use-listener.ts`): keep the last 8 s of audio at the
//! microphone's rate, and once a second turn it into a model window unless the room is quiet;
//! the platform runs the model and hands the cosines back, which the decoder turns into an answer
//! in The Session's tune IDs.

use crate::decode::{Decoder, Status, popularity_prior};
use crate::features::{SAMPLE_RATE, WINDOW_SAMPLES, window_features_with};
use crate::resample::resample;

/// Seconds of audio kept: one model window.
pub const BUFFER_SECONDS: usize = 8;
/// How often a window is scored, as the web finder.
pub const HOP_MS: u64 = 1000;
/// Below this RMS (on 16 kHz audio) the room is quiet; nothing is scored.
pub const SILENCE: f32 = 0.003;

#[derive(Debug, Clone, PartialEq)]
pub enum Window {
    /// Not a single sample yet.
    Empty,
    /// The room is quiet; the model need not run.
    Quiet,
    /// The model's input, `CHANNELS × FRAMES`.
    Features(Vec<f32>),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TuneCandidate {
    /// The Session's tune ID.
    pub tune_id: u32,
    pub cosine: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SessionVerdict {
    pub status: Status,
    pub candidates: Vec<TuneCandidate>,
    pub margin: f64,
}

#[derive(Debug)]
pub struct ListenSession {
    rate: u32,
    buffer: Vec<f32>,
    capacity: usize,
    tune_ids: Vec<u32>,
    channels: usize,
    decoder: Decoder,
}

impl ListenSession {
    /// `rate`: the microphone's sample rate. `tune_ids`: tunes.json, the model's output order.
    /// `tunebooks`: popularity.json in the same order, or empty for no popularity prior.
    /// `channels`: what the model takes, 12 (pitch classes) or 24 (with heights).
    pub fn new(rate: u32, tune_ids: Vec<u32>, tunebooks: &[u32], channels: usize) -> Self {
        let prior = (tunebooks.len() == tune_ids.len() && !tunebooks.is_empty()).then(|| popularity_prior(tunebooks));
        let capacity = BUFFER_SECONDS * rate as usize;
        Self {
            rate,
            buffer: Vec::with_capacity(capacity * 2),
            capacity,
            tune_ids,
            channels,
            decoder: Decoder::new(prior),
        }
    }

    /// Adds microphone samples (mono) and returns their RMS level, for drawing the input.
    pub fn push_audio(&mut self, samples: &[f32]) -> f32 {
        self.buffer.extend_from_slice(samples);
        // Trim in batches rather than on every block.
        if self.buffer.len() > self.capacity * 2 {
            self.buffer.drain(..self.buffer.len() - self.capacity);
        }
        rms(samples)
    }

    /// The last 8 s as a model window, or why there is none.
    pub fn next_window(&self) -> Window {
        if self.buffer.is_empty() {
            return Window::Empty;
        }
        let start = self.buffer.len().saturating_sub(self.capacity);
        let audio = resample(&self.buffer[start..], self.rate, SAMPLE_RATE);
        let audio = &audio[audio.len().saturating_sub(WINDOW_SAMPLES)..];
        if rms(audio) < SILENCE {
            return Window::Quiet;
        }
        Window::Features(window_features_with(audio, self.channels))
    }

    /// The model's cosines for the last window → the answer so far.
    pub fn push_cosines(&mut self, cosines: &[f32]) -> SessionVerdict {
        let verdict = self.decoder.push(cosines);
        SessionVerdict {
            status: verdict.status,
            candidates: verdict
                .candidates
                .iter()
                .filter_map(|c| self.tune_ids.get(c.index).map(|&tune_id| TuneCandidate { tune_id, cosine: c.cosine }))
                .collect(),
            margin: verdict.margin,
        }
    }

    /// Forget the answer so far (a new tune, or a wrong answer), keeping the audio.
    pub fn reset(&mut self) {
        self.decoder.reset();
    }
}

fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    (samples.iter().map(|&s| s as f64 * s as f64).sum::<f64>() / samples.len() as f64).sqrt() as f32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::FRAMES;

    fn tone(rate: u32, seconds: f32, amplitude: f32) -> Vec<f32> {
        (0..(rate as f32 * seconds) as usize)
            .map(|n| amplitude * (2.0 * std::f32::consts::PI * 293.66 * n as f32 / rate as f32).sin())
            .collect()
    }

    #[test]
    fn waits_for_audio_and_skips_quiet_rooms() {
        let mut session = ListenSession::new(48_000, vec![10, 20], &[], 24);
        assert_eq!(session.next_window(), Window::Empty);
        session.push_audio(&tone(48_000, 2.0, 0.0005));
        assert_eq!(session.next_window(), Window::Quiet);
    }

    #[test]
    fn makes_a_window_from_whatever_audio_there_is() {
        let mut session = ListenSession::new(48_000, vec![10, 20], &[], 24);
        let level = session.push_audio(&tone(48_000, 3.0, 0.2));
        assert!((level - 0.2 / 2f32.sqrt()).abs() < 1e-3);
        match session.next_window() {
            Window::Features(f) => assert_eq!(f.len(), 24 * FRAMES),
            other => panic!("expected features, got {other:?}"),
        }
    }

    #[test]
    fn fits_a_twelve_channel_model() {
        let mut session = ListenSession::new(48_000, vec![10], &[], 12);
        session.push_audio(&tone(48_000, 3.0, 0.2));
        assert!(matches!(session.next_window(), Window::Features(f) if f.len() == 12 * FRAMES));
    }

    #[test]
    fn keeps_only_the_last_eight_seconds() {
        let mut session = ListenSession::new(16_000, vec![10], &[], 24);
        for _ in 0..40 {
            session.push_audio(&tone(16_000, 1.0, 0.2));
        }
        assert!(session.buffer.len() <= 2 * 8 * 16_000);
    }

    #[test]
    fn answers_in_tune_ids() {
        let mut session = ListenSession::new(16_000, vec![101, 202, 303], &[], 24);
        let window = [0.1, 0.4, 0.2];
        session.push_cosines(&window);
        session.push_cosines(&window);
        let verdict = session.push_cosines(&window);
        assert_eq!(verdict.status, Status::Match);
        assert_eq!(verdict.candidates[0].tune_id, 202);
    }
}
