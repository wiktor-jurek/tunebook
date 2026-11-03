import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// One shape for every button: 6px corners (--radius). Primary is the only action colour; see the design system's Button.
export const buttonVariants = cva("button", {
  variants: {
    variant: { default: "button-primary", outline: "button-outline", ghost: "button-ghost", danger: "button-danger", link: "button-link" },
    size: { default: "button-default", sm: "button-sm", lg: "button-lg", icon: "button-icon", "icon-sm": "button-icon-sm" },
  },
  defaultVariants: { variant: "default", size: "default" },
});
type Props = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };
export function Button({ className, variant, size, asChild, ...props }: Props) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
