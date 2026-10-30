// Self-assessed progress on a tune, in the terms of a session: not assessed yet, want to learn, learning,
// can play along (follow it confidently), can lead (start it). Stored values keep their original names:
// "unlearned" is Not assessed, "learned" is Can play along and "mastered" is Can lead.
export const ABILITY_LEVELS = ["unlearned", "wanted", "learning", "learned", "mastered"] as const;
export type AbilityLevel = typeof ABILITY_LEVELS[number];
export type Practice = { playableTempo: number | null; levelOverride: AbilityLevel | null; level: AbilityLevel };
export const ABILITY_LABELS: Record<AbilityLevel, string> = { unlearned: "Not assessed", wanted: "Want to learn", learning: "Learning", learned: "Can play along", mastered: "Can lead" };

export function abilityFromTempo(tempo: number | null): AbilityLevel {
  if (!tempo) return "unlearned";
  if (tempo < 100) return "learning";
  return tempo < 125 ? "learned" : "mastered";
}

export function resolvePractice(playableTempo: number | null = null, levelOverride: AbilityLevel | null = null): Practice {
  return { playableTempo, levelOverride, level: levelOverride ?? abilityFromTempo(playableTempo) };
}

/** Can play along means "learned" or "mastered"; each catalog tune counts once. */
export function practiceSummary(tunes: { tuneId: number; practice: Practice }[]) {
  const unique = [...new Map(tunes.map((tune) => [tune.tuneId, tune])).values()];
  const counts = { unlearned: 0, wanted: 0, learning: 0, learned: 0, mastered: 0 };
  for (const tune of unique) counts[tune.practice.level]++;
  const playable = counts.learned + counts.mastered;
  return { counts, total: unique.length, playable, percent: unique.length ? Math.round(playable / unique.length * 100) : 0 };
}

/** "You can play along with 3 of these 4 tunes." */
export function playAlongSentence(playable: number, total: number) {
  if (total === 1) return playable ? "You can play along with this tune." : "You can't play along with this tune yet.";
  if (playable === total) return `You can play along with all ${total} of these tunes.`;
  return `You can play along with ${playable} of these ${total} tunes.`;
}

export type PracticeUpdate = { operation: "tempo"; tempo: number } | { operation: "level"; level: AbilityLevel | null } | { operation: "reset" };
