//! Tune Companion's listen engine, shared by every platform.
//!
//! The model itself runs on each platform's own runtime (Core ML on iOS, LiteRT or ONNX Runtime
//! on Android, onnxruntime-web in browsers). This crate does everything around it, so all three
//! hear identically: resampling the microphone to 16 kHz, turning 8 s of audio into the model's
//! input window ([`features`]) and turning the model's per-window cosines into a live answer
//! ([`decode`]).
//!
//! It is a port of `apps/web/src/lib/finder/{features,resample,decode}.ts`, checked against the same
//! Python fixture (`features.fixture.json`). Keep the two in step until the web uses this crate.

pub mod decode;
pub mod features;
pub mod resample;
pub mod session;

pub use decode::{Candidate, Decoder, Status, Verdict, popularity_prior, top_k};
pub use features::{CHANNELS, FRAMES, SAMPLE_RATE, WINDOW_SAMPLES, key_shift, window_features, window_features_with};
pub use resample::resample;
pub use session::{ListenSession, SessionVerdict, TuneCandidate, Window};

/// The crate version, so apps can show which engine they carry.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
