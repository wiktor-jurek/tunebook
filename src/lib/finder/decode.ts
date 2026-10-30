// Turns per-window cosines into a live answer. Windows are averaged over the last few seconds,
// as the mean cosine scored best on real recordings, and an answer is only given when the
// leader is clearly ahead of the runner-up and has stayed in front.

export type Candidate = { index: number; cosine: number };
export type Verdict = { status: "listening" | "unsure" | "match"; candidates: Candidate[]; margin: number };

// Windows (one a second) averaged together. Longer is steadily better on the real eval clips
// (leader right at each second: 8 → 59%, 16 → 67%, 32 → 72%, whole clip → 77%); 30 still lets a
// set's next tune take over within about half a minute.
export const HISTORY = 30;
// Lead of the best tune's mean cosine over the second's. At 30 windows, 0.04 answers on about
// two-thirds of clips and is right on 85% of those (0.03: 74% / 83%).
export const MATCH_MARGIN = 0.04;
export const MIN_WINDOWS = 3;
export const STABLE_UPDATES = 2;

export class Decoder {
  private windows: Float32Array[] = [];
  private leaders: number[] = [];

  push(cosines: Float32Array): Verdict {
    // A copy: onnxruntime may hand back the same output buffer on every run.
    this.windows.push(cosines.slice());
    if (this.windows.length > HISTORY) this.windows.shift();
    const candidates = topK(mean(this.windows), 10);
    const margin = candidates.length > 1 ? candidates[0].cosine - candidates[1].cosine : 0;
    this.leaders.push(candidates[0]?.index ?? -1);
    if (this.leaders.length > STABLE_UPDATES) this.leaders.shift();
    const stable = this.leaders.length === STABLE_UPDATES && this.leaders.every((leader) => leader === this.leaders[0]);
    const status = this.windows.length < MIN_WINDOWS ? "listening" : margin >= MATCH_MARGIN && stable ? "match" : "unsure";
    return { status, candidates, margin };
  }

  reset() { this.windows = []; this.leaders = []; }
}

function mean(windows: Float32Array[]): Float32Array {
  const out = new Float32Array(windows[0].length);
  for (const w of windows) for (let i = 0; i < w.length; i++) out[i] += w[i];
  for (let i = 0; i < out.length; i++) out[i] /= windows.length;
  return out;
}

export function topK(values: Float32Array, k: number): Candidate[] {
  const best: Candidate[] = [];
  for (let i = 0; i < values.length; i++) {
    if (best.length === k && values[i] <= best[k - 1].cosine) continue;
    let at = best.length < k ? best.length : k - 1;
    while (at > 0 && best[at - 1].cosine < values[i]) at--;
    best.splice(at, 0, { index: i, cosine: values[i] });
    if (best.length > k) best.pop();
  }
  return best;
}
