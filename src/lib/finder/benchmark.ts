// The benchmark page's numbers: tune recognisers on the same real clips (ml/eval/benchmark.py
// writes benchmark.json). A few hundred clips leave wide error bars, so every rate carries a 95%
// interval, and a scenario only names a winner when a paired test says the lead is real.

export type EngineKey = "tunebook" | "folkfriend" | "jigripper";
/** `curve`: right ("1"), wrong ("0") or no answer yet ("-") after each of Benchmark.prefixes seconds. */
export type Answer = { top: number | null; rank: number | null; curve?: string };

export type BenchmarkClip = {
  set: "youtube" | "holdout" | "bands" | "albums";
  tuneId: number;
  instrument: string;
  video: string;
  start: number;
  /** How many The Session member tunebooks hold the tune, and its band (1 very popular … 5 rare). */
  tunebooks?: number;
  popularity?: number;
  results: Partial<Record<EngineKey, Answer>>;
};

export type Benchmark = {
  generated: string;
  prefixes: number[];
  bandRanks?: number[];
  engines: Partial<Record<EngineKey, { name: string; detail: string; tunes: number; missing: number[] }>>;
  tunes: Record<string, { title: string; kind: string }>;
  clips: BenchmarkClip[];
};

// Fixed identity colours, as tokens in globals.css (validated for colour-blind separation in light and dark;
// every bar is also labelled by name).
export const ENGINES: { key: EngineKey; name: string; colour: string; url: string }[] = [
  { key: "tunebook", name: "Tune Companion", colour: "var(--series-tunebook)", url: "/tunes/finder" },
  { key: "folkfriend", name: "FolkFriend", colour: "var(--series-folkfriend)", url: "https://folkfriend.app" },
  { key: "jigripper", name: "JigRipper", colour: "var(--series-jigripper)", url: "https://www.jigripper.com" },
];

export const SETS: { key: BenchmarkClip["set"]; label: string; about: string }[] = [
  { key: "holdout", label: "YouTube holdout", about: "YouTube performances added after Tune Companion's settings were chosen. The fairest test." },
  { key: "youtube", label: "YouTube", about: "Single-tune YouTube performances, labels checked by ear. Tune Companion's settings were chosen on these, so they flatter it a little." },
  { key: "albums", label: "Albums", about: "Album tracks of the same tunes, often with backing." },
  { key: "bands", label: "Bands", about: "Album tracks of tunes whose real recordings Tune Companion never trained on." },
];

export const BANDS = ["Very popular", "Popular", "Common", "Uncommon", "Rare"];

/** "top 100", "101 to 500", up to "beyond 8,000", from the catalogue-rank edges between bands. */
export function bandRange(band: number, edges: number[]): string {
  const n = (x: number) => x.toLocaleString("en-GB");
  if (band === 1) return `top ${n(edges[0])}`;
  if (band > edges.length) return `beyond ${n(edges[edges.length - 1])}`;
  return `${n(edges[band - 2] + 1)} to ${n(edges[band - 1])}`;
}

/** Wilson score interval for k successes in n trials, 95%. */
export function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Exact two-sided McNemar test: of the clips only one engine got right, b went to the first and c to the second. */
export function mcnemar(b: number, c: number): number {
  const n = b + c;
  if (!n) return 1;
  let term = Math.pow(0.5, n), tail = 0; // P(X = 0) for X ~ Binomial(n, 1/2), then upward
  for (let k = 0; k <= Math.min(b, c); k++) {
    tail += term;
    term *= (n - k) / (k + 1);
  }
  return Math.min(1, 2 * tail);
}

export const right = (clip: BenchmarkClip, engine: EngineKey) => clip.results[engine]?.rank === 1;

export type EngineScore = { key: EngineKey; right: number; top5: number; clips: number; interval: [number, number] };
/** `leader` has the most right; `best` is the leader only when its lead over the runner-up is significant. */
export type Scoreboard = { clips: number; scores: EngineScore[]; leader: EngineKey | null; best: EngineKey | null; runnerUp: EngineKey | null; p: number };

/** Each engine's top-1 on these clips, and whether the leader beats the runner-up on the same clips (p < 0.05). */
export function scoreboard(clips: BenchmarkClip[], engines: EngineKey[]): Scoreboard {
  const scores = engines.map((key) => {
    const hits = clips.filter((clip) => right(clip, key)).length;
    const top5 = clips.filter((clip) => { const rank = clip.results[key]?.rank; return rank != null && rank <= 5; }).length;
    return { key, right: hits, top5, clips: clips.length, interval: wilson(hits, clips.length) };
  });
  const [first, second] = [...scores].sort((a, b) => b.right - a.right);
  if (!first || !second || first.right === second.right) return { clips: clips.length, scores, leader: null, best: null, runnerUp: null, p: 1 };
  const onlyFirst = clips.filter((clip) => right(clip, first.key) && !right(clip, second.key)).length;
  const onlySecond = clips.filter((clip) => right(clip, second.key) && !right(clip, first.key)).length;
  const p = mcnemar(onlyFirst, onlySecond);
  return { clips: clips.length, scores, leader: first.key, best: p < 0.05 ? first.key : null, runnerUp: second.key, p };
}

/** Seconds after which an engine is right and stays right for every longer prefix, or null if it never settles on the tune. */
export function lockTime(curve: string | undefined, prefixes: number[]): number | null {
  if (!curve || !curve.endsWith("1")) return null;
  const last = Math.max(curve.lastIndexOf("0"), curve.lastIndexOf("-"));
  return prefixes[last + 1];
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
