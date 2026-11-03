//! The listen engine as the native apps see it. UniFFI generates `ListenCore.swift` and
//! `listen_ffi.kt` from these exports (see `just ios-core` and `just android-core`).

use std::sync::Mutex;

uniffi::setup_scaffolding!();

/// The engine's version, shown in the apps' about screens and logs.
#[uniffi::export]
pub fn core_version() -> String {
    listen_core::VERSION.to_string()
}

/// Samples per model window (8 s at 16 kHz).
#[uniffi::export]
pub fn window_samples() -> u32 {
    listen_core::WINDOW_SAMPLES as u32
}

/// Floats per model window: channels × frames, channel-major.
#[uniffi::export]
pub fn window_shape() -> Vec<u32> {
    vec![listen_core::CHANNELS as u32, listen_core::FRAMES as u32]
}

/// Mono microphone audio at `rate` Hz → 16 kHz.
#[uniffi::export]
pub fn resample_to_model_rate(samples: Vec<f32>, rate: u32) -> Vec<f32> {
    listen_core::resample(&samples, rate, listen_core::SAMPLE_RATE)
}

/// 8 s of 16 kHz mono audio → the model's input window (`window_shape()`).
#[uniffi::export]
pub fn window_features(samples: Vec<f32>) -> Vec<f32> {
    listen_core::window_features(&samples)
}

#[derive(uniffi::Enum, Debug, Clone, Copy, PartialEq, Eq)]
pub enum ListenStatus {
    Listening,
    Unsure,
    Match,
}

#[derive(uniffi::Record, Debug, Clone)]
pub struct ListenCandidate {
    /// Row in the model's tune list (tunes.json).
    pub index: u32,
    pub cosine: f32,
}

#[derive(uniffi::Record, Debug, Clone)]
pub struct ListenVerdict {
    pub status: ListenStatus,
    pub candidates: Vec<ListenCandidate>,
    pub margin: f64,
}

/// Holds the running answer across windows. Thread-safe, so the audio thread can push while the UI reads.
#[derive(uniffi::Object)]
pub struct ListenDecoder {
    inner: Mutex<listen_core::Decoder>,
}

#[uniffi::export]
impl ListenDecoder {
    /// `tunebooks` is each tune's count of member tunebooks (popularity.json), or empty for no prior.
    #[uniffi::constructor]
    pub fn new(tunebooks: Vec<u32>) -> Self {
        let prior = (!tunebooks.is_empty()).then(|| listen_core::popularity_prior(&tunebooks));
        Self { inner: Mutex::new(listen_core::Decoder::new(prior)) }
    }

    /// The model's cosines for one window → the answer so far.
    pub fn push(&self, cosines: Vec<f32>) -> ListenVerdict {
        let verdict = self.inner.lock().unwrap().push(&cosines);
        ListenVerdict {
            status: match verdict.status {
                listen_core::Status::Listening => ListenStatus::Listening,
                listen_core::Status::Unsure => ListenStatus::Unsure,
                listen_core::Status::Match => ListenStatus::Match,
            },
            candidates: verdict
                .candidates
                .iter()
                .map(|c| ListenCandidate { index: c.index as u32, cosine: c.cosine })
                .collect(),
            margin: verdict.margin,
        }
    }

    pub fn reset(&self) {
        self.inner.lock().unwrap().reset();
    }
}

#[derive(uniffi::Enum, Debug, Clone)]
pub enum ListenWindow {
    /// No audio yet.
    Empty,
    /// The room is quiet; skip the model.
    Quiet,
    /// The model's input, `window_shape()`.
    Features { values: Vec<f32> },
}

#[derive(uniffi::Record, Debug, Clone)]
pub struct HeardCandidate {
    /// The Session's tune ID.
    pub tune_id: u32,
    pub cosine: f32,
}

#[derive(uniffi::Record, Debug, Clone)]
pub struct HeardVerdict {
    pub status: ListenStatus,
    pub candidates: Vec<HeardCandidate>,
    pub margin: f64,
}

/// One listen, from microphone to answer, minus the model: push audio as it arrives, take a
/// window once a second (`hop_ms()`), run the model on it, and push its cosines back.
/// Thread-safe, so the audio thread can push while a worker scores.
#[derive(uniffi::Object)]
pub struct ListenSession {
    inner: Mutex<listen_core::ListenSession>,
}

#[uniffi::export]
impl ListenSession {
    /// `rate`: the microphone's sample rate. `tune_ids`: tunes.json. `tunebooks`: popularity.json, or empty.
    /// `channels`: the model's input channels, 12 or 24.
    #[uniffi::constructor]
    pub fn new(rate: u32, tune_ids: Vec<u32>, tunebooks: Vec<u32>, channels: u32) -> Self {
        Self { inner: Mutex::new(listen_core::ListenSession::new(rate, tune_ids, &tunebooks, channels as usize)) }
    }

    /// Adds mono microphone samples; returns their RMS level.
    pub fn push_audio(&self, samples: Vec<f32>) -> f32 {
        self.inner.lock().unwrap().push_audio(&samples)
    }

    pub fn next_window(&self) -> ListenWindow {
        match self.inner.lock().unwrap().next_window() {
            listen_core::Window::Empty => ListenWindow::Empty,
            listen_core::Window::Quiet => ListenWindow::Quiet,
            listen_core::Window::Features(values) => ListenWindow::Features { values },
        }
    }

    pub fn push_cosines(&self, cosines: Vec<f32>) -> HeardVerdict {
        let verdict = self.inner.lock().unwrap().push_cosines(&cosines);
        HeardVerdict {
            status: status(verdict.status),
            candidates: verdict
                .candidates
                .iter()
                .map(|c| HeardCandidate { tune_id: c.tune_id, cosine: c.cosine })
                .collect(),
            margin: verdict.margin,
        }
    }

    pub fn reset(&self) {
        self.inner.lock().unwrap().reset();
    }
}

/// Milliseconds between scored windows.
#[uniffi::export]
pub fn hop_ms() -> u64 {
    listen_core::session::HOP_MS
}

fn status(status: listen_core::Status) -> ListenStatus {
    match status {
        listen_core::Status::Listening => ListenStatus::Listening,
        listen_core::Status::Unsure => ListenStatus::Unsure,
        listen_core::Status::Match => ListenStatus::Match,
    }
}
