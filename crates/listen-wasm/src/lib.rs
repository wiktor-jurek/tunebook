//! listen-core for the web finder's worker. Not wired in yet: apps/web still runs the TypeScript
//! front end. Switching over replaces `windowFeatures` and `Decoder` in worker.ts with these.

use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = coreVersion)]
pub fn core_version() -> String {
    listen_core::VERSION.to_string()
}

/// 8 s of 16 kHz mono audio → the model's input window (24 × 400, channel-major).
#[wasm_bindgen(js_name = windowFeatures)]
pub fn window_features(samples: &[f32]) -> Vec<f32> {
    listen_core::window_features(samples)
}

/// Mono audio at `rate` Hz → 16 kHz.
#[wasm_bindgen]
pub fn resample(samples: &[f32], rate: u32) -> Vec<f32> {
    listen_core::resample(samples, rate, listen_core::SAMPLE_RATE)
}

#[wasm_bindgen]
pub struct Decoder(listen_core::Decoder);

#[wasm_bindgen]
impl Decoder {
    /// `tunebooks`: each tune's count of member tunebooks (popularity.json), or empty for no prior.
    #[wasm_bindgen(constructor)]
    pub fn new(tunebooks: &[u32]) -> Decoder {
        let prior = (!tunebooks.is_empty()).then(|| listen_core::popularity_prior(tunebooks));
        Decoder(listen_core::Decoder::new(prior))
    }

    /// The answer so far, from the model's cosines for one window.
    pub fn push(&mut self, cosines: &[f32]) -> Verdict {
        let verdict = self.0.push(cosines);
        Verdict {
            status: match verdict.status {
                listen_core::Status::Listening => "listening",
                listen_core::Status::Unsure => "unsure",
                listen_core::Status::Match => "match",
            }
            .to_string(),
            leader: verdict.candidates.first().map_or(-1, |c| c.index as i32),
            margin: verdict.margin,
        }
    }

    pub fn reset(&mut self) {
        self.0.reset();
    }
}

/// One update of the running answer, as the TypeScript decoder's Verdict.
#[wasm_bindgen(getter_with_clone)]
pub struct Verdict {
    /// "listening", "unsure" or "match".
    pub status: String,
    /// Row in tunes.json of the leading tune, or -1 before any window.
    pub leader: i32,
    pub margin: f64,
}
