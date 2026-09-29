import { ABILITY_LABELS, ABILITY_LEVELS, practiceSummary, type Practice } from "@/lib/ability";

export function AbilityMark({ practice, label = false }: { practice: Practice; label?: boolean }) {
  const rank = ABILITY_LEVELS.indexOf(practice.level);
  const description = `${ABILITY_LABELS[practice.level]}${practice.playableTempo ? ` · best recorded speed ${practice.playableTempo}%` : " · no speed recorded"}${practice.levelOverride ? " · manual level" : ""}`;
  return <span className="ability-mark" data-level={practice.level} title={description}>
    <span className="ability-bars" aria-hidden="true">{ABILITY_LEVELS.map((level, i) => <i key={level} className={i <= rank ? "filled" : ""} />)}</span>
    <span className={label ? "ability-label" : "sr-only"}>{ABILITY_LABELS[practice.level]}</span>
  </span>;
}

export function AbilitySummary({ tunes }: { tunes: { tuneId: number; practice: Practice }[] }) {
  const { total, playable, percent, counts } = practiceSummary(tunes);
  if (!total) return null;
  const description = `${counts.unlearned} unlearned, ${counts.learning} learning, ${counts.learned} learned, ${counts.mastered} mastered. Playable means learned or mastered; each tune is counted once.`;
  return <div className="ability-summary" title={description}>
    <span>{playable} of {total} playable <span className="ability-percent">· {percent}%</span></span>
    <span className="ability-summary-track" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>
    <span className="sr-only">{description}</span>
  </div>;
}
