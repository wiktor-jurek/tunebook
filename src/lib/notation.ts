import type { savedTunes } from "@/db/schema";

type Tune = typeof savedTunes.$inferSelect;

export function abcForTune(tune: Tune) {
  if (/^X\s*:/m.test(tune.abc)) return tune.abc;
  const line = (value: string | null, fallback: string) => (value || fallback).replace(/[\r\n]/g, " ");
  return `X:1\nT:${line(tune.title, "Untitled")}\nR:${line(tune.kind, "tune")}\nM:${line(tune.meter, "4/4")}\nL:1/8\nQ:1/4=100\nK:${line(tune.mode, "D")}\n${tune.abc}`;
}

export function abcForScore(tune: Tune) {
  return abcForTune(tune).replace(/^T\s*:[^\r\n]*(?:\r?\n|$)/gm, "");
}

export function noteNames(pitches: Array<{ pitch: number }> | undefined) {
  if (!pitches?.length) return "-";
  const names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  return pitches.map(({ pitch }) => `${names[(pitch % 12 + 12) % 12]}${Math.floor(pitch / 12) - 1}`).join(", ");
}
