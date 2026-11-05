"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { displayTitle } from "@/lib/titles";
import type { MonthCount, Stamp, StandardTune } from "@/lib/passport";

const LEVEL_WORDS: Record<string, string> = { mastered: "You can lead it", learned: "You can play along", learning: "You're learning it", wanted: "On your list", unlearned: "Saved, not assessed" };

/** A number that counts up from nothing the first time it comes into view. */
export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(value); return; }
    let frame = 0;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / 900);
        setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
        if (t < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    });
    observer.observe(element);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [value]);
  return <span ref={ref}>{shown.toLocaleString("en-GB")}</span>;
}

/** The Standards: the 100 tunes every session knows as a grid of dots, each filled with where you stand. */
export function StandardsGrid({ tunes }: { tunes: StandardTune[] }) {
  const [picked, setPicked] = useState<StandardTune | null>(null);
  return <div className="passport-standards">
    <div className="passport-grid" role="list">
      {tunes.map((tune, i) => <button key={tune.tuneId} type="button" role="listitem" className="passport-dot" data-level={tune.level ?? undefined}
        data-picked={picked?.tuneId === tune.tuneId ? "" : undefined} aria-label={`${i + 1}. ${displayTitle(tune.title)}${tune.level ? `: ${LEVEL_WORDS[tune.level]}` : ""}`}
        onClick={() => setPicked(picked?.tuneId === tune.tuneId ? null : tune)} />)}
    </div>
    <p className="passport-caption" aria-live="polite">{picked
      ? <><strong>{displayTitle(picked.title)}</strong>{picked.kind ? `, ${picked.kind}` : ""}. {picked.level ? LEVEL_WORDS[picked.level] : "Not one of yours yet"}.{picked.savedId && <> <Link href={`/tunes/${picked.savedId}`}>Open the score</Link></>}</>
      : "Tap a dot to see the tune."}</p>
  </div>;
}

const SEEN = "passport-stamps-seen";

/** Passport stamps: earned ones inked (and pressed in, the first time they are seen), the rest ghosted with how far to go. */
export function Stamps({ stamps }: { stamps: Stamp[] }) {
  const [fresh, setFresh] = useState<string[]>([]);
  useEffect(() => {
    const seen = new Set<string>(JSON.parse(localStorage.getItem(SEEN) ?? "[]"));
    const earned = stamps.filter((stamp) => stamp.earned).map((stamp) => stamp.id);
    setFresh(earned.filter((id) => !seen.has(id)));
    localStorage.setItem(SEEN, JSON.stringify([...new Set([...seen, ...earned])]));
  }, [stamps]);
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return <ul className="passport-stamps">{stamps.map((stamp, i) => <li key={stamp.id} className="passport-stamp" data-earned={stamp.earned ? "" : undefined}
    data-fresh={fresh.includes(stamp.id) ? "" : undefined} style={{ "--tilt": `${[-7, 4, -3, 6, -5, 3][i % 6]}deg`, "--delay": `${fresh.indexOf(stamp.id) * 120}ms` } as React.CSSProperties}>
    <span className="passport-stamp-ring"><span className="passport-stamp-title">{stamp.title}</span>
      <span className="passport-stamp-date">{stamp.at ? date.format(new Date(stamp.at)) : stamp.progress ? `${stamp.progress.have} of ${stamp.progress.need}` : "Not yet"}</span></span>
    <span className="passport-stamp-line">{stamp.line}</span>
  </li>)}</ul>;
}

/** Sessions over the last twelve months, one bar each. */
export function MonthBars({ months }: { months: MonthCount[] }) {
  const most = Math.max(1, ...months.map((month) => month.sessions));
  const name = new Intl.DateTimeFormat("en-GB", { month: "narrow", timeZone: "UTC" });
  return <div className="passport-months" role="img" aria-label={`Sessions by month: ${months.map((m) => m.sessions).join(", ")}`}>
    {months.map((month) => <span key={month.month} className="passport-month">
      <span className="passport-month-bar" style={{ height: `${month.sessions ? 12 + 88 * month.sessions / most : 4}%` }} data-empty={month.sessions ? undefined : ""} />
      <span className="passport-month-name">{name.format(new Date(`${month.month}-01T00:00:00Z`))}</span>
    </span>)}
  </div>;
}
