"use client";

import * as React from "react";
import * as Primitive from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;
export function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal><Primitive.Content data-slot="dropdown-menu-content" sideOffset={sideOffset} className={cn("dropdown-content", className)} {...props} /></Primitive.Portal>;
}
export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof Primitive.Label>) {
  return <Primitive.Label data-slot="dropdown-menu-label" className={cn("dropdown-label", className)} {...props} />;
}
export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof Primitive.Item>) {
  return <Primitive.Item data-slot="dropdown-menu-item" className={cn("dropdown-item", className)} {...props} />;
}
export function DropdownMenuSeparator() {
  return <Primitive.Separator className="dropdown-separator" />;
}
export function DropdownMenuCheckboxItem({ children, className, ...props }: React.ComponentProps<typeof Primitive.CheckboxItem>) {
  return <Primitive.CheckboxItem data-slot="dropdown-menu-checkbox-item" className={cn("dropdown-checkbox", className)} {...props}><span className="dropdown-indicator"><Primitive.ItemIndicator><Check size={14} /></Primitive.ItemIndicator></span>{children}</Primitive.CheckboxItem>;
}
