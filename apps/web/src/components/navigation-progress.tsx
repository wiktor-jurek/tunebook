"use client";

import { useEffect, useState } from "react";
import { useLinkStatus } from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// Only a navigation slower than this shows the bar, so quick ones (prefetched, or from the cache) do not flash it.
const SHOW_AFTER_MS = 120;
// A navigation that never lands (a server error, a closed laptop) stops showing as one after this long.
const GIVE_UP_MS = 20_000;

/**
 * Whether a click on this link leaves the page for another one in the app. Next's Link cancels the browser's own
 * navigation to do it, so a cancelled click still counts; one that stays on the page (a jump within it) does not.
 */
function navigates(event: MouseEvent) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!link || link.target && link.target !== "_self" || link.hasAttribute("download")) return false;
  const to = new URL(link.href, location.href);
  return to.origin === location.origin && (to.pathname !== location.pathname || to.search !== location.search);
}

/**
 * Feedback while the app moves to another page: a thin bar across the top that creeps along until the page arrives, and
 * the page being left dimmed, so it is never mistaken for the one asked for. Lives in the root layout, for every page.
 */
export function NavigationProgress() {
  const path = usePathname(), search = useSearchParams().toString();
  const [phase, setPhase] = useState<"idle" | "waiting" | "loading" | "done">("idle");

  useEffect(() => {
    const onClick = (event: MouseEvent) => { if (navigates(event)) setPhase("waiting"); };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  // The new page has arrived when the address changes: the bar runs to the end and fades.
  const [landed, setLanded] = useState(`${path}?${search}`);
  if (landed !== `${path}?${search}`) { setLanded(`${path}?${search}`); setPhase((current) => current === "idle" ? "idle" : "done"); }
  useEffect(() => {
    if (phase === "waiting") { const timer = window.setTimeout(() => setPhase("loading"), SHOW_AFTER_MS); return () => window.clearTimeout(timer); }
    if (phase === "loading") { const timer = window.setTimeout(() => setPhase("idle"), GIVE_UP_MS); return () => window.clearTimeout(timer); }
    if (phase === "done") { const timer = window.setTimeout(() => setPhase("idle"), 400); return () => window.clearTimeout(timer); }
  }, [phase]);
  useEffect(() => {
    if (phase === "loading") document.body.dataset.navigating = "";
    else delete document.body.dataset.navigating;
  }, [phase]);

  return <div className="nav-progress" data-phase={phase} role="progressbar" aria-hidden={phase !== "loading"} aria-label="Loading the page"><span /></div>;
}

/** Inside a Link: a small spinner that shows while that link's page is on its way. Fixed size, so nothing shifts. */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return <span className="link-pending" data-pending={pending ? "" : undefined} aria-hidden="true" />;
}
