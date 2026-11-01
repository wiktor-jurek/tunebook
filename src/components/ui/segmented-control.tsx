import * as React from "react";
import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = { value: T; label: React.ReactNode; icon?: React.ReactNode; disabled?: boolean };

/**
 * Two or three mutually exclusive choices that apply at once: a mode or a view of the same content, never navigation.
 * An accent track; the chosen segment lifts onto card. `block` fills its container's width.
 */
export function SegmentedControl<T extends string>({ value, onChange, options, label, block = false, size = "default", className }: {
  value: T; onChange: (value: T) => void; options: SegmentedOption<T>[]; label: string; block?: boolean; size?: "default" | "lg"; className?: string;
}) {
  return <div role="radiogroup" aria-label={label} className={cn("segmented", className)} data-block={block ? "" : undefined} data-size={size}>
    {options.map((option) => <button key={option.value} type="button" role="radio" aria-checked={option.value === value} disabled={option.disabled} className="segmented-option" onClick={() => onChange(option.value)}>
      {option.icon}{option.label}
    </button>)}
  </div>;
}
