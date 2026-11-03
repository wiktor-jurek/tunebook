import * as React from "react";
import { cn } from "@/lib/utils";

/** A raised surface: hairline border, card fill, radius-group corners. Padding is the consumer's. */
export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card" className={cn("card", className)} {...props} />;
}
