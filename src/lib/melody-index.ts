import { eq } from "drizzle-orm";
import { db } from "@/db";
import { catalogMelodies } from "@/db/schema";
import { contour, INTERVAL_SYMBOLS, intervalSymbol, MELODY_VERSION, RHYTHM_SYMBOLS, rhythmSymbol } from "@/lib/melody";

export type IndexedSetting = { settingId: number; tuneId: number; pitches: ArrayLike<number>; durations: ArrayLike<number>; chars: ArrayLike<number> };

// Two landmark families, like Shazam's peak pairs but on notes. Both use intervals,
// so a tune hashes the same in any key; the first also uses rhythm ratios, which
// ignore tempo. The interval-only family survives rhythm the tracker gets wrong.
const SHAPE_KEYS = INTERVAL_SYMBOLS ** 3 * RHYTHM_SYMBOLS ** 2;
export const HASH_KEYS = SHAPE_KEYS + INTERVAL_SYMBOLS ** 4;
const MAX_POSITION = 0xffff;

/** Calls `emit(key, position)` for every landmark that starts at a contour note. */
export function forEachLandmark(pitches: ArrayLike<number>, durations: ArrayLike<number>, emit: (key: number, position: number) => void) {
  for (let i = 0; i + 3 < pitches.length; i++) {
    const a = intervalSymbol(pitches[i], pitches[i + 1]), b = intervalSymbol(pitches[i + 1], pitches[i + 2]), c = intervalSymbol(pitches[i + 2], pitches[i + 3]);
    const melodic = (a * INTERVAL_SYMBOLS + b) * INTERVAL_SYMBOLS + c;
    emit(melodic * RHYTHM_SYMBOLS ** 2 + rhythmSymbol(durations[i], durations[i + 1]) * RHYTHM_SYMBOLS + rhythmSymbol(durations[i + 1], durations[i + 2]), i);
    if (i + 4 < pitches.length) emit(SHAPE_KEYS + melodic * INTERVAL_SYMBOLS + intervalSymbol(pitches[i + 3], pitches[i + 4]), i);
  }
}

/** Typed-array inverted index over contour landmarks for every catalog setting. */
export class MelodyIndex {
  readonly settingIds: Int32Array;
  readonly tuneIds: Int32Array;
  /** Contour of setting s is at [noteStart[s], noteStart[s + 1]). */
  readonly noteStart: Uint32Array;
  readonly pitch: Int8Array;
  readonly duration: Uint16Array;
  /** First original note of each contour note, relative to the setting's chars. */
  readonly origin: Uint16Array;
  readonly charStart: Uint32Array;
  readonly chars: Int32Array;
  /** Postings for key k are at [keyStart[k], keyStart[k + 1]). */
  readonly keyStart: Uint32Array;
  readonly postingSetting: Uint32Array;
  readonly postingPosition: Uint16Array;

  constructor(settings: IndexedSetting[]) {
    const contours = settings.map((setting) => contour(setting.pitches, setting.durations));
    const count = settings.length;
    this.settingIds = Int32Array.from(settings, (setting) => setting.settingId);
    this.tuneIds = Int32Array.from(settings, (setting) => setting.tuneId);
    this.noteStart = new Uint32Array(count + 1);
    this.charStart = new Uint32Array(count + 1);
    for (let s = 0; s < count; s++) {
      this.noteStart[s + 1] = this.noteStart[s] + Math.min(contours[s].pitches.length, MAX_POSITION);
      this.charStart[s + 1] = this.charStart[s] + settings[s].chars.length;
    }
    this.pitch = new Int8Array(this.noteStart[count]);
    this.duration = new Uint16Array(this.noteStart[count]);
    this.origin = new Uint16Array(this.noteStart[count]);
    this.chars = new Int32Array(this.charStart[count]);
    const counts = new Uint32Array(HASH_KEYS + 1);
    for (let s = 0; s < count; s++) {
      const notes = contours[s], base = this.noteStart[s], length = this.noteStart[s + 1] - base;
      for (let i = 0; i < length; i++) {
        this.pitch[base + i] = notes.pitches[i];
        this.duration[base + i] = Math.min(notes.durations[i], 0xffff);
        this.origin[base + i] = Math.min(notes.origins[i], 0xffff);
      }
      this.chars.set(Array.from(settings[s].chars), this.charStart[s]);
      forEachLandmark(this.pitch.subarray(base, base + length), this.duration.subarray(base, base + length), (key) => { counts[key + 1]++; });
    }
    for (let key = 0; key < HASH_KEYS; key++) counts[key + 1] += counts[key];
    this.keyStart = counts;
    this.postingSetting = new Uint32Array(counts[HASH_KEYS]);
    this.postingPosition = new Uint16Array(counts[HASH_KEYS]);
    const cursor = counts.slice(0, HASH_KEYS);
    for (let s = 0; s < count; s++) {
      const base = this.noteStart[s], end = this.noteStart[s + 1];
      forEachLandmark(this.pitch.subarray(base, end), this.duration.subarray(base, end), (key, position) => {
        const slot = cursor[key]++;
        this.postingSetting[slot] = s;
        this.postingPosition[slot] = position;
      });
    }
  }

  get size() { return this.settingIds.length; }

  /** Score characters of the original notes behind contour notes [from, to] of setting s. */
  matchedChars(s: number, from: number, to: number) {
    const base = this.noteStart[s], last = this.noteStart[s + 1] - base - 1;
    const first = this.origin[base + Math.max(0, from)];
    const stop = to < last ? this.origin[base + to + 1] : this.charStart[s + 1] - this.charStart[s];
    return [...new Set(this.chars.subarray(this.charStart[s] + first, this.charStart[s] + stop))];
  }
}

const globalIndex = globalThis as typeof globalThis & { __tunebookMelodyIndex?: Promise<MelodyIndex> };

/**
 * Builds the catalog index once per server process; simultaneous first requests share
 * the load. A failed load is forgotten so the next request retries.
 */
export function getMelodyIndex() {
  return globalIndex.__tunebookMelodyIndex ??= (async () => {
    const rows = await db.select({ settingId: catalogMelodies.settingId, tuneId: catalogMelodies.tuneId, pitches: catalogMelodies.pitches, durations: catalogMelodies.durations, chars: catalogMelodies.chars })
      .from(catalogMelodies).where(eq(catalogMelodies.version, MELODY_VERSION)).orderBy(catalogMelodies.settingId);
    return new MelodyIndex(rows);
  })().catch((error) => { globalIndex.__tunebookMelodyIndex = undefined; throw error; });
}
