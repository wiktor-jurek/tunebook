import { contour, intervalSymbol, rhythmSymbol } from "@/lib/melody";
import { forEachLandmark, type MelodyIndex } from "@/lib/melody-index";

export type MelodyMatch = { settingId: number; tuneId: number; score: number; chars: number[] };

const OFFSET_BIN = 4;
const OFFSET_BINS = 1 << 15;
const OFFSET_RANGE = OFFSET_BINS / 2 * OFFSET_BIN;
const CANDIDATES = 300;
// Landmarks this common (runs of steps, arpeggios) say little and would dominate the work.
const MAX_POSTINGS = 40000;
const GAP = 0.8;

/**
 * Ranks catalog settings for a played phrase, best setting per tune first.
 * `durations` may use any unit; only ratios between successive notes matter.
 */
export function matchMelody(index: MelodyIndex, pitches: number[], durations: number[], limit = 8): MelodyMatch[] {
  const query = contour(pitches, durations);
  if (query.pitches.length < 6) return [];
  const candidates = vote(index, query.pitches, query.durations);
  const best = new Map<number, { setting: number; score: number; from: number; to: number }>();
  for (const { setting, offset } of candidates) {
    const aligned = align(index, setting, offset, query.pitches, query.durations);
    if (!aligned) continue;
    const tuneId = index.tuneIds[setting], current = best.get(tuneId);
    if (!current || aligned.score > current.score) best.set(tuneId, { setting, ...aligned });
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.setting - b.setting).slice(0, limit)
    .map(({ setting, score, from, to }) => ({ settingId: index.settingIds[setting], tuneId: index.tuneIds[setting], score, chars: index.matchedChars(setting, from, to) }));
}

/** Shazam-style offset voting: true matches pile up on one diagonal of (target − query) position. */
function vote(index: MelodyIndex, pitches: number[], durations: number[]) {
  const votes = new Map<number, number>();
  forEachLandmark(pitches, durations, (key, queryPosition) => {
    const start = index.keyStart[key], end = index.keyStart[key + 1];
    if (start === end || end - start > MAX_POSTINGS) return;
    const weight = Math.log(1 + index.size / (end - start));
    for (let p = start; p < end; p++) {
      const offset = index.postingPosition[p] - queryPosition + OFFSET_RANGE;
      const bin = index.postingSetting[p] * OFFSET_BINS + Math.floor(offset / OFFSET_BIN);
      votes.set(bin, (votes.get(bin) ?? 0) + weight);
      // Spill into the nearer neighbour so a note the tracker added or missed still lines up.
      const neighbour = offset % OFFSET_BIN < OFFSET_BIN / 2 ? bin - 1 : bin + 1;
      votes.set(neighbour, (votes.get(neighbour) ?? 0) + weight);
    }
  });
  const bySetting = new Map<number, { score: number; offset: number }>();
  for (const [bin, score] of votes) {
    const setting = Math.floor(bin / OFFSET_BINS), offset = (bin % OFFSET_BINS) * OFFSET_BIN - OFFSET_RANGE;
    const current = bySetting.get(setting);
    if (!current || score > current.score) bySetting.set(setting, { score, offset });
  }
  return [...bySetting].sort((a, b) => b[1].score - a[1].score).slice(0, CANDIDATES).map(([setting, { offset }]) => ({ setting, offset }));
}

/**
 * Semi-global alignment of the query's intervals inside a window of the setting around
 * the voted offset: every query note must be explained, the setting may start and end
 * anywhere. Intervals make it key-independent; rhythm ratios are a softer penalty.
 */
function align(index: MelodyIndex, setting: number, offset: number, pitches: number[], durations: number[]) {
  const base = index.noteStart[setting], length = index.noteStart[setting + 1] - base;
  const m = pitches.length - 1;
  const from = Math.max(0, offset - 24), to = Math.min(length - 1, offset + m + 24);
  const n = to - from;
  if (n < 3) return null;
  const query = new Int8Array(m), queryRhythm = new Int8Array(m);
  for (let i = 0; i < m; i++) {
    query[i] = intervalSymbol(pitches[i], pitches[i + 1]);
    queryRhythm[i] = i ? rhythmSymbol(durations[i - 1], durations[i]) : 2;
  }
  // Rolling rows of cost and the setting interval where each path began.
  let cost = new Float32Array(n + 1), start = new Int32Array(n + 1);
  let next = new Float32Array(n + 1), nextStart = new Int32Array(n + 1);
  for (let j = 0; j <= n; j++) start[j] = j;
  for (let i = 1; i <= m; i++) {
    next[0] = i * GAP; nextStart[0] = 0;
    for (let j = 1; j <= n; j++) {
      const t = from + j - 1;
      const target = intervalSymbol(index.pitch[base + t], index.pitch[base + t + 1]);
      const difference = Math.abs(target - query[i - 1]);
      let substitution = difference === 0 ? 0 : difference === 1 ? 0.6 : 1;
      if (i > 1 && t > 0) {
        const rhythm = Math.abs(rhythmSymbol(index.duration[base + t - 1], index.duration[base + t]) - queryRhythm[i - 1]);
        substitution += rhythm >= 2 ? 0.3 : rhythm === 1 ? 0.1 : 0;
      }
      let best = cost[j - 1] + substitution, origin = start[j - 1];
      if (cost[j] + GAP < best) { best = cost[j] + GAP; origin = start[j]; }
      if (next[j - 1] + GAP < best) { best = next[j - 1] + GAP; origin = nextStart[j - 1]; }
      next[j] = best; nextStart[j] = origin;
    }
    [cost, next] = [next, cost];
    [start, nextStart] = [nextStart, start];
  }
  let end = 1;
  for (let j = 2; j <= n; j++) if (cost[j] < cost[end]) end = j;
  return { score: Math.max(0, 1 - cost[end] / m), from: from + start[end], to: from + end };
}
