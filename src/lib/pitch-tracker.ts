export const SAMPLE_RATE = 16000;

export type PlayedNote = { midi: number; start: number; duration: number };

/** Turns streamed mono audio into notes. A heavier model can replace YIN behind this. */
export interface Transcriber {
  push(samples: Int16Array): void;
  notes(): PlayedNote[];
  readonly seconds: number;
}

// 120–2400 Hz covers tenor banjo and guitar up to the top of a whistle.
const MIN_LAG = Math.floor(SAMPLE_RATE / 2400);
const MAX_LAG = Math.ceil(SAMPLE_RATE / 120);
const WINDOW = 400;
const HOP = 128;
const FRAME_SECONDS = HOP / SAMPLE_RATE;
const THRESHOLD = 0.15;
// A pitch must hold this many frames to start a note: cuts, taps and slides fall below it.
const CONFIRM_FRAMES = 4;
const MIN_NOTE_FRAMES = 5;
const MAX_GAP_FRAMES = 3;

/**
 * Streams audio into fixed hops, asks a frame analyser for the main pitch of each,
 * then segments notes with hysteresis. Pitches are rounded after removing the
 * player's overall tuning offset, so a flat whistle still lands on the right semitones.
 */
abstract class FrameTranscriber implements Transcriber {
  private buffer = new Float32Array(0);
  private consumed = 0;
  private readonly pitch: number[] = [];
  private readonly level: number[] = [];
  protected abstract readonly frameSize: number;
  /** MIDI pitch of the most prominent voice in the frame, or NaN. */
  protected abstract analyse(frame: Float32Array): number;

  get seconds() { return (this.consumed + this.buffer.length) / SAMPLE_RATE; }

  push(samples: Int16Array) {
    const next = new Float32Array(this.buffer.length + samples.length);
    next.set(this.buffer);
    for (let i = 0; i < samples.length; i++) next[this.buffer.length + i] = samples[i] / 32768;
    let offset = 0;
    while (offset + this.frameSize <= next.length) {
      const frame = next.subarray(offset, offset + this.frameSize);
      this.level.push(rms(frame));
      this.pitch.push(this.analyse(frame));
      offset += HOP;
    }
    this.buffer = next.slice(offset);
    this.consumed += offset;
  }

  notes(): PlayedNote[] {
    // Ignore anything 20 dB below the playing level: room noise, reverb tails, other players far away.
    const silence = Math.max(0.004, quantile(this.level, 0.95) * 0.1);
    const voiced = this.pitch.map((midi, i) => this.level[i] > silence ? midi : Number.NaN);
    const tuning = tuningOffset(voiced);
    const steps = medianFilter(voiced).map((midi) => Number.isNaN(midi) ? Number.NaN : Math.round(midi - tuning));
    const notes: PlayedNote[] = [];
    let current = Number.NaN, start = 0, last = 0, candidate = Number.NaN, candidateStart = 0, gap = 0;
    const finish = () => {
      if (!Number.isNaN(current) && last - start + 1 >= MIN_NOTE_FRAMES) notes.push({ midi: current, start: start * FRAME_SECONDS, duration: (last - start + 1) * FRAME_SECONDS });
      current = Number.NaN;
    };
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (Number.isNaN(step)) {
        if (++gap > MAX_GAP_FRAMES) finish();
        candidate = Number.NaN;
        continue;
      }
      if (step === current) { last = i; gap = 0; candidate = Number.NaN; continue; }
      if (step !== candidate) { candidate = step; candidateStart = i; }
      if (i - candidateStart + 1 >= CONFIRM_FRAMES) {
        finish();
        current = candidate; start = candidateStart; last = i; gap = 0; candidate = Number.NaN;
      }
    }
    finish();
    return notes;
  }
}

/** YIN (de Cheveigné & Kawahara, 2002): precise for one instrument on its own. */
export class YinTranscriber extends FrameTranscriber {
  protected readonly frameSize = WINDOW + MAX_LAG;
  protected analyse(frame: Float32Array) { return yin(frame); }
}

const FFT_SIZE = 2048;
const BIN_HZ = SAMPLE_RATE / FFT_SIZE;
// Salience in tenth-of-a-semitone bins from A2 to A6.
const LOWEST_MIDI = 45, SALIENCE_BINS = 480, HARMONICS = 10, HARMONIC_WEIGHT = 0.8;
const hann = Float32Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FFT_SIZE));

/**
 * Predominant melody (after Salamon & Gómez's Melodia, 2012) for a tune played over
 * guitar, bouzouki or other players: every spectral peak votes for the fundamentals
 * it could be a harmonic of, and the line that stays continuous wins over strummed chords.
 */
export class SalienceTranscriber extends FrameTranscriber {
  protected readonly frameSize = FFT_SIZE;
  private previous = Number.NaN;
  private readonly real = new Float32Array(FFT_SIZE);
  private readonly imaginary = new Float32Array(FFT_SIZE);
  private readonly salience = new Float32Array(SALIENCE_BINS);

  protected analyse(frame: Float32Array) {
    const { real, imaginary, salience } = this;
    for (let i = 0; i < FFT_SIZE; i++) { real[i] = frame[i] * hann[i]; imaginary[i] = 0; }
    fft(real, imaginary);
    const half = FFT_SIZE / 2, magnitude = new Float32Array(half);
    let loudest = 0;
    for (let k = 1; k < half; k++) { magnitude[k] = Math.hypot(real[k], imaginary[k]); loudest = Math.max(loudest, magnitude[k]); }
    salience.fill(0);
    for (let k = 2; k < half - 1; k++) {
      const peak = magnitude[k];
      if (peak < loudest * 0.01 || peak <= magnitude[k - 1] || peak < magnitude[k + 1]) continue;
      // Parabolic interpolation on log magnitude for the true peak frequency.
      const a = Math.log(magnitude[k - 1] + 1e-12), b = Math.log(peak), c = Math.log(magnitude[k + 1] + 1e-12);
      const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
      const frequency = (k + shift) * BIN_HZ, weight = Math.sqrt(peak / loudest);
      for (let h = 1; h <= HARMONICS; h++) {
        const centre = (69 + 12 * Math.log2(frequency / h / 440) - LOWEST_MIDI) * 10;
        if (centre < -5) break;
        for (let bin = Math.max(0, Math.ceil(centre - 5)); bin <= Math.min(SALIENCE_BINS - 1, Math.floor(centre + 5)); bin++) {
          salience[bin] += weight * HARMONIC_WEIGHT ** (h - 1) * Math.cos((bin - centre) / 10 * Math.PI) ** 2;
        }
      }
    }
    let best = -1, bestScore = 0, strongest = 0;
    for (let bin = 1; bin < SALIENCE_BINS - 1; bin++) {
      const value = salience[bin];
      strongest = Math.max(strongest, value);
      if (value < salience[bin - 1] || value < salience[bin + 1]) continue;
      // Prefer continuing the current line; a note change must clearly out-sing it.
      const midi = LOWEST_MIDI + bin / 10;
      const score = value * (Math.abs(midi - this.previous) < 0.7 ? 1.4 : 1);
      if (score > bestScore) { best = bin; bestScore = score; }
    }
    this.previous = best < 0 ? Number.NaN : LOWEST_MIDI + best / 10;
    return this.previous;
  }
}

/** In-place iterative radix-2 FFT. */
function fft(real: Float32Array, imaginary: Float32Array) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]]; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = -2 * Math.PI / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < size / 2; k++) {
        const cos = Math.cos(step * k), sin = Math.sin(step * k);
        const a = i + k, b = a + size / 2;
        const tr = real[b] * cos - imaginary[b] * sin, ti = real[b] * sin + imaginary[b] * cos;
        real[b] = real[a] - tr; imaginary[b] = imaginary[a] - ti;
        real[a] += tr; imaginary[a] += ti;
      }
    }
  }
}

function rms(samples: Float32Array) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** MIDI pitch of one frame, or NaN when it is not clearly periodic. */
function yin(frame: Float32Array) {
  const difference = new Float32Array(MAX_LAG + 1);
  for (let lag = 1; lag <= MAX_LAG; lag++) {
    let sum = 0;
    for (let i = 0; i < WINDOW; i++) {
      const delta = frame[i] - frame[i + lag];
      sum += delta * delta;
    }
    difference[lag] = sum;
  }
  // Cumulative mean normalised difference.
  let running = 0;
  const normalised = new Float32Array(MAX_LAG + 1);
  normalised[0] = 1;
  for (let lag = 1; lag <= MAX_LAG; lag++) {
    running += difference[lag];
    normalised[lag] = running ? difference[lag] * lag / running : 1;
  }
  let lag = -1;
  for (let tau = MIN_LAG; tau <= MAX_LAG; tau++) {
    if (normalised[tau] < THRESHOLD) {
      while (tau + 1 <= MAX_LAG && normalised[tau + 1] < normalised[tau]) tau++;
      lag = tau;
      break;
    }
  }
  if (lag < 0) return Number.NaN;
  // Parabolic interpolation between neighbouring lags.
  const before = normalised[lag - 1], here = normalised[lag], after = lag < MAX_LAG ? normalised[lag + 1] : here;
  const curve = before + after - 2 * here;
  const refined = curve > 0 ? lag + (before - after) / (2 * curve) : lag;
  return 69 + 12 * Math.log2(SAMPLE_RATE / refined / 440);
}

function quantile(values: number[], q: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** Circular mean of the cents offset from equal temperament, in semitones. */
function tuningOffset(pitches: number[]) {
  let x = 0, y = 0;
  for (const midi of pitches) {
    if (Number.isNaN(midi)) continue;
    const angle = 2 * Math.PI * (midi - Math.round(midi));
    x += Math.cos(angle); y += Math.sin(angle);
  }
  return x || y ? Math.atan2(y, x) / (2 * Math.PI) : 0;
}

/** Five-frame median over voiced frames removes single-frame octave slips. */
function medianFilter(pitches: number[]) {
  return pitches.map((midi, i) => {
    if (Number.isNaN(midi)) return midi;
    const window = pitches.slice(Math.max(0, i - 2), i + 3).filter((value) => !Number.isNaN(value)).sort((a, b) => a - b);
    return window[Math.floor(window.length / 2)];
  });
}
