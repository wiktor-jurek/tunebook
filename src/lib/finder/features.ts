// The Tune finder's front end: a port of ml/tunebook_ml/pitchclass.py, so the browser feeds the
// model exactly what it was trained on. 8 s of 16 kHz audio → 12 pitch classes × 400 frames,
// KeyCanon'd. features.test.ts checks it against the Python output.

export const SAMPLE_RATE = 16000;
export const N_FFT = 2048;
export const HOP = 320;
export const FRAMES = 400; // 8 s at 50 frames a second
export const WINDOW_SAMPLES = FRAMES * HOP;
const BINS = N_FFT / 2 + 1;
const MELODY_LOW = 55, MELODY_HIGH = 96; // G3 .. C7
const HARMONICS: [number, number][] = [[0, 1.0], [12, 0.6], [19, 0.4], [24, 0.3]];
const LOG_GAIN = 100;
const NOTES = MELODY_HIGH + 24 + 1; // highest semitone a partial reaches

// Periodic Hann window, as torch.hann_window.
const hann = Float64Array.from({ length: N_FFT }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT));

// Bit-reversal and twiddles for an in-place radix-2 FFT of N_FFT points.
const bitReverse = new Uint32Array(N_FFT);
for (let i = 0, bits = Math.log2(N_FFT); i < N_FFT; i++) {
  let r = 0;
  for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
  bitReverse[i] = r;
}
const cosTable = Float64Array.from({ length: N_FFT / 2 }, (_, k) => Math.cos((-2 * Math.PI * k) / N_FFT));
const sinTable = Float64Array.from({ length: N_FFT / 2 }, (_, k) => Math.sin((-2 * Math.PI * k) / N_FFT));

function fft(re: Float64Array, im: Float64Array) {
  for (let i = 0; i < N_FFT; i++) {
    const j = bitReverse[i];
    if (j > i) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let size = 2; size <= N_FFT; size *= 2) {
    const half = size / 2, step = N_FFT / size;
    for (let start = 0; start < N_FFT; start += size) {
      for (let k = 0; k < half; k++) {
        const a = start + k, b = a + half, wr = cosTable[k * step], wi = sinTable[k * step];
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

// Triangular filters a semitone either side of each MIDI note, rows normalised to sum to 1; kept sparse.
const filters: { bins: Uint16Array; weights: Float64Array }[] = (() => {
  const midi = Float64Array.from({ length: BINS }, (_, f) => 69 + 12 * Math.log2(Math.max((f * SAMPLE_RATE) / N_FFT, 1) / 440));
  return Array.from({ length: NOTES }, (_, m) => {
    const bins: number[] = [], weights: number[] = [];
    for (let f = 1; f < BINS; f++) {
      const w = 1 - Math.abs(midi[f] - m);
      if (w > 0) { bins.push(f); weights.push(w); }
    }
    const total = Math.max(weights.reduce((a, b) => a + b, 0), 1e-6);
    return { bins: Uint16Array.from(bins), weights: Float64Array.from(weights, (w) => w / total) };
  });
})();

const reflect = (i: number, n: number) => (i < 0 ? -i : i >= n ? 2 * (n - 1) - i : i);

/** Magnitude STFT, centred with reflect padding like torch.stft: (BINS × frames), bin-major. */
function stft(audio: Float32Array, frames: number): Float64Array {
  const spec = new Float64Array(BINS * frames);
  const re = new Float64Array(N_FFT), im = new Float64Array(N_FFT);
  for (let t = 0; t < frames; t++) {
    const start = t * HOP - N_FFT / 2;
    for (let n = 0; n < N_FFT; n++) { re[n] = audio[reflect(start + n, audio.length)] * hann[n]; im[n] = 0; }
    fft(re, im);
    for (let f = 0; f < BINS; f++) spec[f * frames + t] = Math.hypot(re[f], im[f]);
  }
  return spec;
}

/** Running median along one axis of a (rows × cols) array, reflect-padded; odd kernels only.
 *  Keeps the window sorted as it slides (drop the outgoing value, insert the incoming one)
 *  rather than sorting every position: the slowest step on phones. */
function median(x: Float64Array, rows: number, cols: number, kernel: number, alongRows: boolean): Float64Array {
  const out = new Float64Array(x.length), half = kernel >> 1;
  const [lines, length, step] = alongRows ? [cols, rows, cols] : [rows, cols, 1];
  const padded = new Float64Array(length + kernel - 1), sorted = new Float64Array(kernel);
  for (let line = 0; line < lines; line++) {
    const start = alongRows ? line : line * cols;
    for (let i = 0; i < padded.length; i++) padded[i] = x[start + reflect(i - half, length) * step];
    sorted.set(padded.subarray(0, kernel));
    sorted.sort();
    out[start] = sorted[half];
    for (let i = 1; i < length; i++) {
      const gone = padded[i - 1], come = padded[i + kernel - 1];
      let at = 0;
      while (sorted[at] !== gone) at++;
      // Close the gap towards where the incoming value belongs, then drop it in.
      while (at > 0 && sorted[at - 1] > come) { sorted[at] = sorted[at - 1]; at--; }
      while (at < kernel - 1 && sorted[at + 1] < come) { sorted[at] = sorted[at + 1]; at++; }
      sorted[at] = come;
      out[start + i * step] = sorted[half];
    }
  }
  return out;
}

/** torch.quantile with linear interpolation. */
function quantile(values: Float64Array, q: number): number {
  const sorted = Float64Array.from(values).sort();
  const position = q * (sorted.length - 1), lo = Math.floor(position), frac = position - lo;
  return lo + 1 < sorted.length ? sorted[lo] + frac * (sorted[lo + 1] - sorted[lo]) : sorted[lo];
}

/** Harmonic part of the spectrum (median-filter HPSS) mapped to semitone power: (NOTES × FRAMES). */
export function semitones(audio: Float32Array): Float64Array {
  const frames = 1 + Math.floor(audio.length / HOP);
  const spec = stft(audio, frames);
  const harmonic = median(spec, BINS, frames, 9, false); // across time: sustained tones survive
  const percussive = median(spec, BINS, frames, 17, true); // across frequency: broadband clicks survive
  const power = new Float64Array(spec.length);
  for (let i = 0; i < spec.length; i++) {
    const h2 = harmonic[i] ** 2, mask = h2 / (h2 + percussive[i] ** 2 + 1e-10);
    power[i] = (spec[i] * mask) ** 2;
  }
  const semis = new Float64Array(NOTES * FRAMES);
  for (let m = 0; m < NOTES; m++) {
    const { bins, weights } = filters[m];
    for (let j = 0; j < bins.length; j++) {
      const row = bins[j] * frames, w = weights[j];
      for (let t = 0; t < FRAMES; t++) semis[m * FRAMES + t] += w * power[row + t];
    }
  }
  return semis;
}

/** Rotation that puts the pitch-class profile's first Fourier coefficient at phase 0. */
export function keyShift(pcs: Float32Array): number {
  let re = 0, im = 0;
  for (let k = 0; k < 12; k++) {
    let profile = 0;
    for (let t = 0; t < FRAMES; t++) profile += pcs[k * FRAMES + t];
    re += profile * Math.cos((2 * Math.PI * k) / 12);
    im += profile * -Math.sin((2 * Math.PI * k) / 12);
  }
  const x = (-Math.atan2(im, re) * 12) / (2 * Math.PI);
  // torch.round rounds halves to even.
  const rounded = Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : Math.round(x);
  return ((rounded % 12) + 12) % 12;
}

/** Semitone power → KeyCanon'd pitch-class salience in [0, 1], (12 × FRAMES), bin 0 = C before the rotation. */
export function features(semis: Float64Array): Float32Array {
  // The level is taken over all 128 MIDI rows in Python; rows above NOTES are silent and only shift the quantile's index.
  const all = new Float64Array(128 * FRAMES);
  all.set(semis);
  const level = Math.max(quantile(all, 0.995), 1e-10);
  const pcs = new Float64Array(12 * FRAMES);
  for (let k = 0; k <= MELODY_HIGH - MELODY_LOW; k++) {
    const row = ((k + MELODY_LOW) % 12) * FRAMES;
    for (const [offset, weight] of HARMONICS) {
      const source = (MELODY_LOW + offset + k) * FRAMES;
      for (let t = 0; t < FRAMES; t++) pcs[row + t] += weight * Math.log1p((LOG_GAIN * semis[source + t]) / level);
    }
  }
  // A tone held through the whole window (drone, hum) is not melody.
  for (let k = 0; k < 12; k++) {
    let low = Infinity;
    for (let t = 0; t < FRAMES; t++) low = Math.min(low, pcs[k * FRAMES + t]);
    for (let t = 0; t < FRAMES; t++) pcs[k * FRAMES + t] = Math.max(pcs[k * FRAMES + t] - low, 0);
  }
  const scale = Math.max(quantile(pcs, 0.99), 1e-6);
  const raw = Float32Array.from(pcs, (v) => Math.min(v / scale, 1));
  const shift = keyShift(raw);
  const out = new Float32Array(12 * FRAMES);
  for (let k = 0; k < 12; k++) out.set(raw.subarray(((k + shift) % 12) * FRAMES, ((k + shift) % 12 + 1) * FRAMES), k * FRAMES);
  return out;
}

/** 8 s of 16 kHz mono audio (zero-padded if shorter) → one model input window. */
export function windowFeatures(audio: Float32Array): Float32Array {
  const window = audio.length === WINDOW_SAMPLES ? audio : (() => { const a = new Float32Array(WINDOW_SAMPLES); a.set(audio.subarray(0, WINDOW_SAMPLES)); return a; })();
  return features(semitones(window));
}
