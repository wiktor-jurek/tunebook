"use client";

import { trackEvent } from "@/lib/analytics";
import { useRouter } from "next/navigation";
import type { Mode } from "@/lib/mode";

/** Switches a desktop or tablet between practice and session mode; phones stay in session mode. */
export function ModeSwitch({ to, className, title, children }: { to: Mode; className?: string; title?: string; children: React.ReactNode }) {
  const router = useRouter();
  return <button type="button" className={className} title={title} onClick={() => {
    document.cookie = `mode=${to}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    trackEvent("mode_switched", { mode: to });
    router.push("/"); router.refresh();
  }}>{children}</button>;
}
