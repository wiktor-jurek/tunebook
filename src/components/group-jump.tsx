"use client";

import { useEffect, useRef, useState } from "react";

export type JumpGroup = { key: string; label: string; count: number };
/** The id a group's heading carries, for the strip to jump to. */
export const groupAnchor = (index: number) => `tune-group-${index}`;

/**
 * A long grouped list's index: a strip of its groups that sticks to the top of the screen. Tapping one jumps to it,
 * and the one being read stays lit (and in view, when the strip itself scrolls sideways). Short lists do without.
 */
export function GroupJump({ groups }: { groups: JumpGroup[] }) {
  const strip = useRef<HTMLElement>(null);
  const [current, setCurrent] = useState(0);
  const enough = groups.length > 2;

  // The group being read is the last whose heading has scrolled up to the strip.
  useEffect(() => {
    if (!enough) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const edge = (strip.current?.getBoundingClientRect().bottom ?? 0) + 24;
      let at = 0;
      groups.forEach((_, index) => { const heading = document.getElementById(groupAnchor(index)); if (heading && heading.getBoundingClientRect().top <= edge) at = index; });
      setCurrent(at);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); cancelAnimationFrame(frame); };
  }, [groups, enough]);
  // Keep the lit chip in view as the reader moves through the groups.
  useEffect(() => {
    const chip = strip.current?.querySelectorAll<HTMLElement>(".group-jump-chip")[current];
    const list = strip.current?.firstElementChild as HTMLElement | null;
    if (chip && list) list.scrollTo({ left: chip.offsetLeft - list.clientWidth / 2 + chip.clientWidth / 2, behavior: "smooth" });
  }, [current]);

  if (!enough) return null;
  return <nav ref={strip} className="group-jump" aria-label="Jump to a group">
    <div className="group-jump-chips">{groups.map((group, index) => <a key={group.key} href={`#${groupAnchor(index)}`} className="group-jump-chip" aria-current={index === current ? "true" : undefined}
      onClick={(event) => { event.preventDefault(); document.getElementById(groupAnchor(index))?.scrollIntoView({ behavior: "smooth", block: "start" }); setCurrent(index); }}>
      {group.label}<span>{group.count}</span>
    </a>)}</div>
  </nav>;
}
