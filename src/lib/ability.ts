export const ABILITY_LEVELS = ["unlearned", "learning", "learned", "mastered"] as const;
export type AbilityLevel = typeof ABILITY_LEVELS[number];
export type Practice = { playableTempo: number | null; levelOverride: AbilityLevel | null; level: AbilityLevel };
export const ABILITY_LABELS: Record<AbilityLevel, string> = { unlearned: "Unlearned", learning: "Learning", learned: "Learned", mastered: "Mastered" };

export function abilityFromTempo(tempo: number | null): AbilityLevel {
  if (!tempo) return "unlearned";
  if (tempo < 100) return "learning";
  return tempo < 125 ? "learned" : "mastered";
}

export function resolvePractice(playableTempo: number | null = null, levelOverride: AbilityLevel | null = null): Practice {
  return { playableTempo, levelOverride, level: levelOverride ?? abilityFromTempo(playableTempo) };
}

export function practiceSummary(tunes: { tuneId: number; practice: Practice }[]) {
  const unique = [...new Map(tunes.map((tune) => [tune.tuneId, tune])).values()];
  const counts = { unlearned: 0, learning: 0, learned: 0, mastered: 0 };
  for (const tune of unique) counts[tune.practice.level]++;
  const playable = counts.learned + counts.mastered;
  return { counts, total: unique.length, playable, percent: unique.length ? Math.round(playable / unique.length * 100) : 0 };
}

export type PracticeUpdate = { operation: "tempo"; tempo: number } | { operation: "level"; level: AbilityLevel | null } | { operation: "reset" };
