import * as React from "react";
import { cn } from "@/lib/utils";

/** A pill that toggles one of several choices on or off; pressed, it fills with brand-ink. */
export function Chip({ pressed, className, ...props }: React.ComponentProps<"button"> & { pressed?: boolean }) {
  return <button type="button" aria-pressed={pressed} data-slot="chip" className={cn("chip", className)} {...props} />;
}
