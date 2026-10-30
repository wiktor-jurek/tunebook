import type { savedTunes } from "@/db/schema";

// Catalog rows and saved snapshots share the fields notation needs.
type Tune = Pick<typeof savedTunes.$inferSelect, "title" | "kind" | "meter" | "mode" | "abc">;

export function abcForTune(tune: Tune) {
  if (/^X\s*:/m.test(tune.abc)) return tune.abc;
  const line = (value: string | null, fallback: string) => (value || fallback).replace(/[\r\n]/g, " ");
  return `X:1\nT:${line(tune.title, "Untitled")}\nR:${line(tune.kind, "tune")}\nM:${line(tune.meter, "4/4")}\nL:1/8\nQ:1/4=100\nK:${line(tune.mode, "D")}\n${tune.abc}`;
}

export function abcForScore(tune: Tune) {
  return abcForTune(tune).replace(/^T\s*:[^\r\n]*(?:\r?\n|$)/gm, "");
}

/** The Session writes keys as "Dmajor" or "Adorian"; people read "D major". */
export function keyName(mode: string | null) {
  return mode ? mode.replace(/^([A-G][#b♯♭]?)(?=[a-z])/, "$1 ") : mode;
}

export function noteNames(pitches: Array<{ pitch: number }> | undefined) {
  if (!pitches?.length) return "-";
  const names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  return pitches.map(({ pitch }) => `${names[(pitch % 12 + 12) % 12]}${Math.floor(pitch / 12) - 1}`).join(", ");
}

/**
 * The first bars of a setting, enough to recognise how a tune starts: any pickup notes and then `bars` full bars,
 * from the first part, with the headers kept and the tempo and rhythm headings dropped. Returns full ABC.
 */
export function openingPhrase(tune: Tune, bars = 2) {
  const lines = abcForScore(tune).replace(/^[RQ]\s*:[^\r\n]*(?:\r?\n|$)/gm, "").split(/\r?\n/);
  const headers: string[] = [], body: string[] = [];
  for (const line of lines) (body.length === 0 && /^[A-Za-z]\s*:/.test(line) ? headers : body).push(line);
  // Split the body at bar lines, keeping each bar line with the bar before it.
  const parts = body.join(" ").replace(/%[^\n]*/g, "").split(/(\|\]|\|\||\|:|:\||::|\|\d?|\[\d)/).filter((part) => part !== undefined);
  const measures: string[] = [];
  let current = "";
  for (const part of parts) {
    if (/^(\|\]|\|\||\|:|:\||::|\|\d?|\[\d)$/.test(part)) {
      if (current.trim()) { measures.push(current.trim()); current = ""; }
      continue;
    }
    current += part;
  }
  if (current.trim()) measures.push(current.trim());
  if (!measures.length) return [...headers, body.join(" ")].join("\n");
  // A first bar much shorter than the second is a pickup: keep it and count full bars after it.
  const notes = (measure: string) => (measure.match(/[A-Ga-gz]/g) ?? []).length;
  const pickup = measures.length > 1 && notes(measures[0]) * 2 <= notes(measures[1]) ? 1 : 0;
  return [...headers, measures.slice(0, pickup + bars).join(" | ") + " |]"].join("\n");
}
