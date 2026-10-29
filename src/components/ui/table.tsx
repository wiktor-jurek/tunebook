import * as React from "react";
import { cn } from "@/lib/utils";

// shadcn/ui's table, styled by the .table classes in globals.css.
export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return <div data-slot="table-container" className="table-container"><table data-slot="table" className={cn("table", className)} {...props} /></div>;
}
export function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("table-header", className)} {...props} />;
}
export function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={cn("table-body", className)} {...props} />;
}
export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr data-slot="table-row" className={cn("table-row", className)} {...props} />;
}
export function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return <th data-slot="table-head" className={cn("table-head", className)} {...props} />;
}
export function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td data-slot="table-cell" className={cn("table-cell", className)} {...props} />;
}
