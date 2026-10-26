import { SAMPLE_RATE } from "@/lib/pitch-tracker";

export type SynthNote = { midi: number; seconds: number };
export type Timbre = { harmonics: number[]; vibratoCents: number; noise: number; detuneCents: number };

export const TIMBRES: Record<string, Timbre> = {
  whistle: { harmonics: [1, 0.15, 0.05], vibratoCents: 8, noise: 0.02, detuneCents: 0 },
  flute: { harmonics: [1, 0.45, 0.2, 0.08], vibratoCents: 15, noise: 0.03, detuneCents: 0 },
  fiddle: { harmonics: [1, 0.8, 0.6, 0.45, 0.3, 0.2, 0.12], vibratoCents: 20, noise: 0.01, detuneCents: 0 },
};

/**
 * Plays notes as a harmonic tone with vibrato, breath noise and short articulation
 * gaps. Evaluation and tests use it in place of a real player.
 */
export function synthesize(notes: SynthNote[], timbre: Timbre, random: () => number = Math.random) {
  const total = Math.ceil(notes.reduce((sum, note) => sum + note.seconds, 0.2) * SAMPLE_RATE);
  const out = new Float32Array(total);
  let cursor = Math.floor(0.1 * SAMPLE_RATE), phase = 0;
  const norm = timbre.harmonics.reduce((sum, value) => sum + value, 0);
  for (const note of notes) {
    const length = Math.floor(note.seconds * SAMPLE_RATE), sounding = Math.max(1, length - Math.floor(0.012 * SAMPLE_RATE));
    const frequency = 440 * 2 ** ((note.midi - 69 + timbre.detuneCents / 100) / 12);
    const amplitude = 0.25 + random() * 0.15, vibratoRate = 4.5 + random() * 1.5;
    for (let i = 0; i < sounding && cursor + i < total; i++) {
      const t = i / SAMPLE_RATE;
      const envelope = Math.min(1, i / (0.008 * SAMPLE_RATE), (sounding - i) / (0.006 * SAMPLE_RATE));
      phase += 2 * Math.PI * frequency * 2 ** (timbre.vibratoCents / 1200 * Math.sin(2 * Math.PI * vibratoRate * t)) / SAMPLE_RATE;
      let sample = 0;
      for (let h = 0; h < timbre.harmonics.length; h++) sample += timbre.harmonics[h] * Math.sin((h + 1) * phase);
      out[cursor + i] += amplitude * envelope * sample / norm;
    }
    cursor += length;
  }
  const pcm = new Int16Array(total);
  for (let i = 0; i < total; i++) {
    const noisy = out[i] + timbre.noise * (random() * 2 - 1);
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(noisy * 32767)));
  }
  return pcm;
}
