"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { X } from "lucide-react";
import { AbilityMark } from "@/components/ability-mark";
import { ABILITY_LABELS, ABILITY_LEVELS, abilityFromTempo, type AbilityLevel, type Practice, type PracticeUpdate } from "@/lib/ability";
import { trackEvent } from "@/lib/analytics";

type Tune = { id: string; title: string; practice: Practice };

function usePracticeUpdate(tune: Tune) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  async function update(input: PracticeUpdate) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/tunes/${tune.id}/practice`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save progress");
      trackEvent("tune_practice_updated", { outcome: "success", source: input.operation });
      setMessage(input.operation === "reset" ? "Progress reset" : "Progress saved");
      router.refresh();
    } catch (cause) {
      trackEvent("tune_practice_updated", { outcome: "error", source: input.operation });
      setError(cause instanceof Error ? cause.message : "Could not save progress");
    } finally { setBusy(false); }
  }
  return { busy, error, message, update };
}

export function TuneAbility({ tune, editable = true }: { tune: Tune; editable?: boolean }) {
  const { busy, error, message, update } = usePracticeUpdate(tune);
  const selectId = useId();
  if (!editable) return <AbilityMark practice={tune.practice} label />;
  return <Popover.Root><Popover.Trigger asChild>
    <button type="button" className="ability-button" aria-label={`Ability for ${tune.title}: ${ABILITY_LABELS[tune.practice.level]}`}><AbilityMark practice={tune.practice} label /></button>
  </Popover.Trigger><Popover.Portal><Popover.Content className="ability-popover" sideOffset={6} collisionPadding={12} align="end" aria-label="Your tune ability">
    <header><strong>Your ability</strong><Popover.Close asChild><button type="button" className="icon-button" aria-label="Close ability settings"><X size={15} /></button></Popover.Close></header>
    <p>{tune.practice.playableTempo ? `Best recorded speed: ${tune.practice.playableTempo}%` : "No speed recorded yet. Confirm a speed while practising."}</p>
    <label className="field-label" htmlFor={selectId}>Ability level</label>
    <select id={selectId} value={tune.practice.levelOverride ?? "auto"} disabled={busy} onChange={(event) => void update({ operation: "level", level: event.target.value === "auto" ? null : event.target.value as AbilityLevel })}>
      <option value="auto">From speed · {ABILITY_LABELS[abilityFromTempo(tune.practice.playableTempo)]}</option>
      {ABILITY_LEVELS.map((level) => <option key={level} value={level}>{ABILITY_LABELS[level]}</option>)}
    </select>
    <p className="ability-help">Unlearned: no speed recorded. Learning: 50–99%. Learned: 100–124%. Mastered: 125–150%. You can choose any level yourself.</p>
    <p className="ability-help">Progress is private and follows your settings of this tune. Speeds are relative to the score’s normal tempo.</p>
    <button type="button" className="ability-reset" disabled={busy || (tune.practice.playableTempo === null && tune.practice.levelOverride === null)} onClick={() => void update({ operation: "reset" })}>Reset progress</button>
    <span role="status" className="ability-status">{busy ? "Saving…" : message}</span>{error && <p className="form-error" role="alert">{error}</p>}
  </Popover.Content></Popover.Portal></Popover.Root>;
}

export function PracticeSpeed({ tune, speed }: { tune: Tune; speed: number }) {
  const { busy, error, message, update } = usePracticeUpdate(tune);
  return <div className="practice-speed">
    <button type="button" className="practice-confirm" disabled={busy} onClick={() => void update({ operation: "tempo", tempo: speed })}>Can play at {speed}%</button>
    <span className="practice-recorded">{tune.practice.playableTempo ? `Best: ${tune.practice.playableTempo}%` : "No speed recorded"}{tune.practice.levelOverride && " · level set manually"}</span>
    <span className="ability-status" role="status">{busy ? "Saving…" : message}</span>{error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
