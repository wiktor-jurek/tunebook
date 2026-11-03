"use client";

import * as React from "react";
import * as Primitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type SelectOption = { value: string; label: React.ReactNode; text?: string };

/**
 * A pick-one control whose menu matches the app's own menus (the current choice ticked), not the operating system's.
 * Radix reserves the empty value for "nothing chosen", so `value=""` shows the placeholder; give "all" options a real value.
 */
export function Select({ value, onValueChange, options, placeholder, disabled, id, className, "aria-label": label }: {
  value: string; onValueChange: (value: string) => void; options: SelectOption[]; placeholder?: string; disabled?: boolean; id?: string; className?: string; "aria-label"?: string;
}) {
  return <Primitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
    <Primitive.Trigger id={id} className={cn("select-trigger", className)} aria-label={label}>
      <Primitive.Value placeholder={placeholder} />
      <Primitive.Icon className="select-icon"><ChevronDown size={15} /></Primitive.Icon>
    </Primitive.Trigger>
    <Primitive.Portal>
      <Primitive.Content className="select-content" position="popper" sideOffset={6} collisionPadding={12}>
        <Primitive.ScrollUpButton className="select-scroll"><ChevronUp size={14} /></Primitive.ScrollUpButton>
        <Primitive.Viewport className="select-viewport">
          {options.map((option) => <Primitive.Item key={option.value} value={option.value} textValue={option.text} className="select-item">
            <span className="select-indicator"><Primitive.ItemIndicator><Check size={14} /></Primitive.ItemIndicator></span>
            <Primitive.ItemText>{option.label}</Primitive.ItemText>
          </Primitive.Item>)}
        </Primitive.Viewport>
        <Primitive.ScrollDownButton className="select-scroll"><ChevronDown size={14} /></Primitive.ScrollDownButton>
      </Primitive.Content>
    </Primitive.Portal>
  </Primitive.Root>;
}
