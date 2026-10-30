// The microphone runs at the device's rate (44.1 or 48 kHz); the model's front end wants 16 kHz.
// A windowed-sinc low-pass at 7.2 kHz, then interpolation. Melody partials above that carry
// little for the features (the top note, C7, is 2.1 kHz).

const TAPS = 64;
const CUTOFF = 7200;

export function resample(input: Float32Array, from: number, to = 16000): Float32Array {
  if (from === to) return input;
  const ratio = from / to, length = Math.floor(input.length / ratio);
  const cutoff = CUTOFF / from;
  const kernel = (x: number) => {
    // Blackman-windowed sinc, x in input samples from the output point.
    if (Math.abs(x) >= TAPS / 2) return 0;
    const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
    const n = (x + TAPS / 2) / TAPS;
    return sinc * (0.42 - 0.5 * Math.cos(2 * Math.PI * n) + 0.08 * Math.cos(4 * Math.PI * n));
  };
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const centre = i * ratio, first = Math.ceil(centre - TAPS / 2), last = Math.floor(centre + TAPS / 2);
    let sum = 0, norm = 0;
    for (let j = Math.max(first, 0); j <= Math.min(last, input.length - 1); j++) {
      const w = kernel(j - centre);
      sum += input[j] * w; norm += w;
    }
    out[i] = norm ? sum / norm : 0;
  }
  return out;
}
