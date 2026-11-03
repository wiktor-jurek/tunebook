"use client";

import { ENSEMBLES, INSTRUMENTS, PLACES } from "@/lib/label-options";
import type { GroupDetail } from "@/lib/labels";
import { Chip } from "@/components/ui/chip";

type Tags = GroupDetail["tags"];

function Chips({ label, options, selected, onToggle }: { label: string; options: string[]; selected: string[]; onToggle: (value: string) => void }) {
  return <fieldset className="label-tag-group"><legend>{label}</legend>
    <div className="label-chips">{options.map((option) => <Chip key={option}
      pressed={selected.includes(option)} onClick={() => onToggle(option)}>{option}</Chip>)}</div>
  </fieldset>;
}

/** What is heard: instruments (several), the size of the group and where it was played (one each). */
export function TagPicker({ tags, onChange }: { tags: Tags; onChange: (tags: Tags) => void }) {
  return <div className="label-tags">
    <Chips label="Instruments" options={INSTRUMENTS} selected={tags.instruments}
      onToggle={(v) => onChange({ ...tags, instruments: tags.instruments.includes(v) ? tags.instruments.filter((x) => x !== v) : [...tags.instruments, v] })} />
    <Chips label="Players" options={ENSEMBLES} selected={tags.ensemble ? [tags.ensemble] : []} onToggle={(v) => onChange({ ...tags, ensemble: tags.ensemble === v ? null : v })} />
    <Chips label="Setting" options={PLACES} selected={tags.setting ? [tags.setting] : []} onToggle={(v) => onChange({ ...tags, setting: tags.setting === v ? null : v })} />
  </div>;
}
