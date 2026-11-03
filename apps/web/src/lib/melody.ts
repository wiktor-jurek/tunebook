import abcjs from "abcjs";
import { abcForScore } from "@/lib/notation";

// Starts and durations are in 1/48 of a whole note so triplets stay whole numbers.
export const DURATION_UNIT = 48;
// Bump when extraction or contour rules change; stale catalog rows are reindexed.
export const MELODY_VERSION = "abcjs-6.7-contour-v2";

// Starts keep rests and pickups, which durations alone lose; the catalog table stores no starts.
export type Melody = { pitches: number[]; durations: number[]; chars: number[]; starts: number[] };
export type Contour = { pitches: number[]; durations: number[]; origins: number[] };
type Tune = Parameters<typeof abcForScore>[0];
type NoteEvent = { cmd: string; pitch: number; start: number; duration: number; startChar: number };

/** Melody line of a setting, with repeats and endings played out as abcjs plays them. */
export function melodyFromAbc(tune: Tune): Melody | null {
  const [parsed] = abcjs.parseOnly(abcForScore(tune));
  if (!parsed) return null;
  const audio = (parsed as unknown as { setUpAudio(): { tracks: NoteEvent[][] } }).setUpAudio();
  // Chord accompaniment sits on its own track and, unlike written notes, has no score position;
  // it can be busier than a slow tune, so pick the busiest track of written notes.
  const track = audio.tracks.map((events) => events.filter((event) => event.cmd === "note"))
    .filter((events) => events.some((event) => event.startChar !== undefined))
    .sort((a, b) => b.length - a.length)[0] ?? [];
  const melody: Melody = { pitches: [], durations: [], chars: [], starts: [] };
  let lastStart = Number.NaN;
  for (const note of [...track].sort((a, b) => a.start - b.start || b.pitch - a.pitch)) {
    // Grace notes are ornaments a player may or may not add (abcjs gives them no score position);
    // double stops keep their top note.
    if (note.startChar === undefined || note.duration < 1 / 32 || Math.abs(note.start - lastStart) < 1e-6) continue;
    lastStart = note.start;
    melody.pitches.push(note.pitch);
    melody.durations.push(Math.max(1, Math.round(note.duration * DURATION_UNIT)));
    melody.chars.push(note.startChar);
    melody.starts.push(Math.round(note.start * DURATION_UNIT));
  }
  return melody.pitches.length >= 8 ? melody : null;
}

/** Repeated pitches merge into one longer note: players and pitch tracking split them unpredictably. */
export function contour(pitches: ArrayLike<number>, durations: ArrayLike<number>): Contour {
  const result: Contour = { pitches: [], durations: [], origins: [] };
  for (let i = 0; i < pitches.length; i++) {
    const last = result.pitches.length - 1;
    if (last >= 0 && result.pitches[last] === pitches[i]) result.durations[last] += durations[i];
    else { result.pitches.push(pitches[i]); result.durations.push(durations[i]); result.origins.push(i); }
  }
  return result;
}

export const MAX_INTERVAL = 12;
export const INTERVAL_SYMBOLS = MAX_INTERVAL * 2 + 1;
export const RHYTHM_SYMBOLS = 5;

export function intervalSymbol(from: number, to: number) {
  return Math.max(-MAX_INTERVAL, Math.min(MAX_INTERVAL, to - from)) + MAX_INTERVAL;
}

/** Ratio of successive note lengths, independent of tempo: much shorter, shorter, same, longer, much longer. */
export function rhythmSymbol(from: number, to: number) {
  const ratio = Math.log2(to / from);
  return ratio < -0.75 ? 0 : ratio < -0.3 ? 1 : ratio <= 0.3 ? 2 : ratio <= 0.75 ? 3 : 4;
}
