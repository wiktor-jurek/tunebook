import { ABILITY_LABELS, ABILITY_LEVELS, playAlongSentence, practiceSummary, type Practice } from "@/lib/ability";

// Four bars, filled one per step past Not assessed: Want to learn fills one, Can lead all four.
export function AbilityMark({ practice, label = false }: { practice: Practice; label?: boolean }) {
  const rank = ABILITY_LEVELS.indexOf(practice.level);
  const description = `${ABILITY_LABELS[practice.level]}${practice.playableTempo ? `, best recorded speed ${practice.playableTempo}%` : ""}${practice.levelOverride ? ", set by hand" : ""}`;
  return <span className="ability-mark" data-level={practice.level} title={description}>
    <span className="ability-bars" aria-hidden="true">{[1, 2, 3, 4].map((step) => <i key={step} className={step <= rank ? "filled" : ""} />)}</span>
    <span className={label ? "ability-label" : "sr-only"}>{ABILITY_LABELS[practice.level]}</span>
  </span>;
}

export function AbilitySummary({ tunes }: { tunes: { tuneId: number; practice: Practice }[] }) {
  const { total, playable, counts } = practiceSummary(tunes);
  if (!total) return null;
  const description = `${counts.unlearned} not assessed, ${counts.wanted} want to learn, ${counts.learning} learning, ${counts.learned} can play along, ${counts.mastered} can lead.`;
  return <p className="ability-summary" title={description}>{playAlongSentence(playable, total)}</p>;
}
