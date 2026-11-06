// Turns per-window cosines into a live answer. Windows are averaged over the last few seconds,
// as the mean cosine scored best on real recordings, and an answer is only given when the
// leader is clearly ahead of the runner-up and has stayed in front. Once a tune is named, a
// short view of the last few windows notices when a set moves on to the next one.

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
// Popular tunes are heard more often: each tune's mean cosine gains this much per ln(tunebooks + 1).
// On the real eval clips it gained 9 clips and lost none (YouTube 83.3 → 85.3%, albums 69.6 → 71.3%),
// and at the 0.04 margin it answers more clips at the same precision (ml/PIPELINE.md §11).
export const POPULARITY_WEIGHT = 0.006;
// Moving on: after a tune is named, the mean of only the last SWITCH_WINDOW windows is watched. When another tune
// leads it by SWITCH_MARGIN for STABLE_UPDATES updates, that tune is named and the history is cut to those windows,
// so it need not outvote half a minute of the last one. Replayed on 11 hours of labelled sessions
// (ml/eval/session_decode.py), the median time to name each tune of a set fell from 19.4 s to 10.2 s, and tunes
// named within 15 s rose from 11% to 81%, with as few wrong names (0.2 and 0.5 an hour on the two halves);
// one tune in 180 more went unnamed. The first answer, and so single clips, are unchanged.
export const SWITCH_WINDOW = 8;
export const SWITCH_MARGIN = MATCH_MARGIN + 0.06;
// A floor on the leader's score (mean cosine plus prior): below it nothing is named, however far ahead it is. Wrong
// names on phone recordings in a pub sit at low scores (Chromatic #23777 named at 0.24 on 5 November; Cadence's author
// found the same on hand-labelled sessions, and that 0.35 cut his wrong names from 17% to 5% and named nothing in bar
// noise). On the labelled session videos it costs little: 0 to 1 tune in 180 found, a few named a second or two later.
export const MIN_SCORE = 0.35;

/** Each tune's prior, in cosine units, from how many The Session member tunebooks hold it. */
export function popularityPrior(tunebooks: number[]): Float32Array {
  return Float32Array.from(tunebooks, (n) => POPULARITY_WEIGHT * Math.log(n + 1));
}

export class Decoder {
  private windows: Float32Array[] = [];
  private leaders: number[] = [];
  private recentLeaders: number[] = [];
  private named = -1; // the tune last answered, which the short view watches for a change

  /** `prior` is added to every tune's mean cosine before ranking (popularityPrior). */
  constructor(private prior: Float32Array | null = null) {}

  setPrior(prior: Float32Array | null) { this.prior = prior; }

  push(cosines: Float32Array): Verdict {
    // A copy: onnxruntime may hand back the same output buffer on every run.
    this.windows.push(cosines.slice());
    if (this.windows.length > HISTORY) this.windows.shift();
    if (this.named >= 0 && this.windows.length >= SWITCH_WINDOW) {
      const recent = mean(this.windows.slice(-SWITCH_WINDOW));
      if (this.prior) for (let i = 0; i < recent.length; i++) recent[i] += this.prior[i];
      const candidates = topK(recent, 10);
      const margin = candidates.length > 1 ? candidates[0].cosine - candidates[1].cosine : 0;
      const leader = candidates[0]?.index ?? -1;
      this.recentLeaders.push(leader);
      if (this.recentLeaders.length > STABLE_UPDATES) this.recentLeaders.shift();
      const held = this.recentLeaders.length === STABLE_UPDATES && this.recentLeaders.every((l) => l === leader);
      if (leader !== this.named && margin >= SWITCH_MARGIN && candidates[0].cosine >= MIN_SCORE && held) {
        this.windows = this.windows.slice(-SWITCH_WINDOW);
        this.leaders = Array(STABLE_UPDATES).fill(leader);
        this.named = leader;
        return { status: "match", candidates, margin };
      }
    }
    const scores = mean(this.windows);
    if (this.prior) for (let i = 0; i < scores.length; i++) scores[i] += this.prior[i];
    const candidates = topK(scores, 10);
    const margin = candidates.length > 1 ? candidates[0].cosine - candidates[1].cosine : 0;
    this.leaders.push(candidates[0]?.index ?? -1);
    if (this.leaders.length > STABLE_UPDATES) this.leaders.shift();
    const stable = this.leaders.length === STABLE_UPDATES && this.leaders.every((leader) => leader === this.leaders[0]);
    const status = this.windows.length < MIN_WINDOWS ? "listening" : margin >= MATCH_MARGIN && stable && candidates[0].cosine >= MIN_SCORE ? "match" : "unsure";
    if (status === "match") this.named = candidates[0].index;
    return { status, candidates, margin };
  }

  reset() { this.windows = []; this.leaders = []; this.recentLeaders = []; this.named = -1; }
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
