import { useSyncExternalStore } from "react";
import { ABILITY_LABELS, type AbilityLevel, type Practice } from "@/lib/ability";
import { keyName } from "@/lib/notation";

// How a list of tunes is grouped: by how far along you are with each, by key, by type (jig, reel, waltz), or not at all.
export const GROUP_BYS = ["stage", "key", "type", "none"] as const;
export type GroupBy = typeof GROUP_BYS[number];
export const GROUP_BY_LABELS: Record<GroupBy, string> = { stage: "Stage of learning", key: "Key", type: "Type", none: "Nothing" };

// What you can play comes first, then what you are working on, then the rest.
const STAGES: AbilityLevel[] = ["mastered", "learned", "learning", "wanted", "unlearned"];

type Groupable = { title: string; kind: string | null; mode: string | null; practice: Practice };
export type TuneGroup<T> = { key: string; label: string; tunes: T[] };

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Splits tunes into labelled groups, in a fixed order; tunes keep their order within each group. */
export function groupTunes<T extends Groupable>(tunes: T[], by: GroupBy): TuneGroup<T>[] {
  if (by === "none") return tunes.length ? [{ key: "all", label: "", tunes }] : [];
  const groups = new Map<string, TuneGroup<T>>();
  for (const tune of tunes) {
    const [key, label] = by === "stage" ? [tune.practice.level, ABILITY_LABELS[tune.practice.level]]
      : by === "key" ? (tune.mode ? [tune.mode, keyName(tune.mode)!] : ["", "No key"])
      : (tune.kind ? [tune.kind.toLowerCase(), capital(tune.kind)] : ["", "Other"]);
    const group = groups.get(key) ?? { key, label, tunes: [] };
    group.tunes.push(tune);
    groups.set(key, group);
  }
  // Stages go in learning order; keys and types alphabetically, with tunes that have none last.
  const rank = (group: TuneGroup<T>) => by === "stage" ? String(STAGES.indexOf(group.key as AbilityLevel)) : group.key ? `0${group.label}` : "1";
  return [...groups.values()].sort((a, b) => rank(a).localeCompare(rank(b)));
}

// The choice is remembered on this device: a convenience, so it lives in the browser and never needs to reach the server.
const STORAGE = "tunebook-group-by";
const listeners = new Set<() => void>();
function read(): GroupBy {
  try { const value = localStorage.getItem(STORAGE); return GROUP_BYS.includes(value as GroupBy) ? value as GroupBy : "stage"; } catch { return "stage"; }
}
export function setGroupBy(value: GroupBy) {
  try { localStorage.setItem(STORAGE, value); } catch { /* Private windows may refuse; the choice just isn't kept. */ }
  listeners.forEach((listener) => listener());
}
/** The remembered grouping; stage of learning until one is chosen (and on the server, which cannot know). */
export function useGroupBy(): GroupBy {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, read, () => "stage");
}
