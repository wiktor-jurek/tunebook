"use client";

import { trackEvent } from "@/lib/analytics";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Moon, SunMedium, SunMoon } from "lucide-react";
import { applyTheme, parseTheme, type Theme } from "@/lib/theme";
import { SegmentedControl } from "@/components/ui/segmented-control";

const OPTIONS: { theme: Theme; label: string; icon: typeof Moon }[] = [
  { theme: "system", label: "Automatic", icon: SunMoon },
  { theme: "light", label: "Light", icon: SunMedium },
  { theme: "dark", label: "Dark", icon: Moon },
];

/** Light, dark or follow the device. It applies the moment it is chosen, like the system setting it mirrors.
 *  It only mounts inside an opened dialog or sheet, so it reads the current choice from the page. */
export function AppearancePicker() {
  const router = useRouter();
  const [theme, setTheme] = useState<Theme>(() => parseTheme(document.documentElement.dataset.theme));
  function choose(next: Theme) {
    setTheme(next);
    applyTheme(next);
    trackEvent("appearance_changed", { theme: next });
    // Refreshing re-renders the browser chrome colour for the new theme.
    router.refresh();
  }
  return <SegmentedControl label="Appearance" value={theme} onChange={choose} block size="lg"
    options={OPTIONS.map(({ theme: option, label, icon: Icon }) => ({ value: option, label, icon: <Icon size={18} aria-hidden="true" /> }))} />;
}
