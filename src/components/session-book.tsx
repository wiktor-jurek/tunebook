"use client";

import { trackEvent } from "@/lib/analytics";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import abcjs from "abcjs";
import { ChevronLeft, Search, Star } from "lucide-react";
import { abcForScore, keyName } from "@/lib/notation";
import type { BookSection } from "@/lib/library";
import { RepeatMark } from "@/components/repeat-mark";
import { AbilityMark } from "@/components/ability-mark";
import { displayTitle, displaySetTitle } from "@/lib/titles";

type Tune = Extract<BookSection, { kind: "tune" }>["tune"];
type Page = { tune: Tune; set: string | null; key: string };

const meta = (tune: Tune) => [tune.kind, keyName(tune.mode)].filter(Boolean).join(", ");

type Run = { kind: "tunes"; key: string; tunes: Tune[] } | { kind: "set"; section: Extract<BookSection, { kind: "set" }> };
function runs(sections: BookSection[]) {
  const result: Run[] = [];
  for (const section of sections) {
    const last = result[result.length - 1];
    if (section.kind === "set") result.push({ kind: "set", section });
    else if (last?.kind === "tunes") last.tunes.push(section.tune);
    else result.push({ kind: "tunes", key: section.entryId, tunes: [section.tune] });
  }
  return result;
}

// A phone on its side: wide but short. Matches the CSS for the same layout.
const LANDSCAPE = "(orientation: landscape) and (max-height: 500px)";
function useLandscape() {
  return useSyncExternalStore((change) => { const query = matchMedia(LANDSCAPE); query.addEventListener("change", change); return () => query.removeEventListener("change", change); },
    () => matchMedia(LANDSCAPE).matches, () => false);
}

/** Notation alone, wrapped for a phone held at reading distance; the kind and tempo headings are left to the title above. */
export function SessionScore({ tune }: { tune: Pick<Tune, "title" | "kind" | "meter" | "mode" | "abc"> }) {
  const paper = useRef<HTMLDivElement>(null);
  // The score scales to the screen's width, so on its side a phone lays it out wider: notes stay the
  // same size and more lines fit in the short height, instead of one line blown up to fill it.
  const landscape = useLandscape();
  useEffect(() => {
    if (paper.current) abcjs.renderAbc(paper.current, abcForScore(tune).replace(/^[RQ]\s*:[^\r\n]*(?:\r?\n|$)/gm, ""), { responsive: "resize", add_classes: true, staffwidth: landscape ? 760 : 400, paddingtop: 0, paddingbottom: 0, wrap: { minSpacing: 1.6, maxSpacing: 2.6, preferredMeasuresPerLine: 4 } });
  }, [tune, landscape]);
  return <div ref={paper} className="session-notation" aria-label={`Sheet music for ${displayTitle(tune.title)}`} />;
}

// While a score is open the screen stays on: it is propped on a music stand or a pint glass.
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let lock: WakeLockSentinel | null = null, released = false;
    const take = () => void navigator.wakeLock?.request("screen").then((next) => { if (released) void next.release(); else lock = next; }).catch(() => undefined);
    take();
    // The lock lapses when the tab is hidden; take it again on return.
    const onVisible = () => { if (document.visibilityState === "visible") take(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { released = true; document.removeEventListener("visibilitychange", onVisible); void lock?.release().catch(() => undefined); };
  }, [active]);
}

/**
 * A tunebook in session mode (or all your tunes): tunes as large rows with your progress on each, then each score full
 * screen, swiping through in playing order. `searchable` adds a filter by title, for long lists.
 */
export function SessionBook({ name, sections: all, searchable = false }: { name: string; sections: BookSection[]; searchable?: boolean }) {
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase();
  const matches = (tune: Tune) => !words || displayTitle(tune.title).toLowerCase().includes(words) || tune.title.toLowerCase().includes(words);
  const sections = words ? all.flatMap((section): BookSection[] => section.kind === "tune" ? (matches(section.tune) ? [section] : [])
    : section.tunes.some(matches) ? [{ ...section, tunes: section.tunes.filter(matches) }] : []) : all;
  const pages = sections.flatMap((section): Page[] => section.kind === "tune" ? [{ tune: section.tune, set: null, key: `${section.entryId}-${section.tune.id}` }]
    : section.tunes.map((tune) => ({ tune, set: section.name, key: `${section.entryId}-${tune.id}` })));
  const [open, setOpen] = useState<number | null>(null);
  const [at, setAt] = useState(0);
  const pager = useRef<HTMLDivElement>(null);
  const current = useRef(0), resizing = useRef(false);
  useWakeLock(open !== null);

  function show(index: number) {
    trackEvent("session_score_opened", { tune: pages[index].tune.title });
    setOpen(index); setAt(index); current.current = index;
  }
  // Turning the phone changes the page width; keep the same tune in view rather than whatever the old scroll offset lands on.
  useEffect(() => {
    const element = pager.current;
    if (open === null || !element) return;
    const observer = new ResizeObserver(() => {
      resizing.current = true;
      element.scrollTo({ left: current.current * element.clientWidth, behavior: "instant" });
      requestAnimationFrame(() => requestAnimationFrame(() => { resizing.current = false; }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);
  useEffect(() => {
    if (open === null || !pager.current) return;
    pager.current.scrollTo({ left: open * pager.current.clientWidth, behavior: "instant" });
  }, [open]);
  useEffect(() => {
    if (open === null) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  let index = 0;
  const row = (tune: Tune) => {
    const i = index++;
    return <li key={pages[i].key}><button type="button" className="session-row" onClick={() => show(i)}>
      <span className="session-row-emoji" aria-hidden="true">{tune.emoji}</span>
      <span className="session-row-text"><span className="session-row-title">{displayTitle(tune.title)}</span><span className="session-row-meta">{meta(tune)}</span></span>
      {tune.oftenPlayed && <Star size={15} fill="currentColor" className="session-star" aria-label="Often played" />}
      <AbilityMark practice={tune.practice} />
    </button></li>;
  };

  return <>
    {searchable && <label className="finder-search-field session-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Find a tune</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a tune" enterKeyHint="search" /></label>}
    {/* Single tunes next to each other share one group; each set is a group of its own under its name. */}
    <div className="session-list">{runs(sections).map((run) => run.kind === "tunes"
      ? <ul className="session-group" key={run.key}>{run.tunes.map(row)}</ul>
      : <section key={run.section.entryId}><h2 className="session-group-title"><RepeatMark />{displaySetTitle(run.section.name)}</h2><ul className="session-group">{run.section.tunes.map(row)}</ul></section>)}
    </div>
    {words && !pages.length && <p className="session-empty">No tune called that.</p>}
    {open !== null && <div className="session-reader" role="dialog" aria-modal="true" aria-label={name}>
      <header className="session-reader-bar">
        <button type="button" className="session-back" onClick={() => setOpen(null)}><ChevronLeft size={22} /> <span>{name}</span></button>
        <span className="session-reader-tune">{displayTitle(pages[at]!.tune.title)}</span>
        <span className="session-reader-count">{at + 1} of {pages.length}</span>
      </header>
      <div className="session-pager" ref={pager} onScroll={(event) => { if (resizing.current) return; const next = Math.round(event.currentTarget.scrollLeft / event.currentTarget.clientWidth); current.current = next; setAt(next); }}>
        {pages.map((page, i) => <article className="session-page" key={page.key} aria-hidden={i !== at}>
          {page.set && <p className="session-page-set"><RepeatMark />{page.set}</p>}
          <div className="session-page-head"><h2>{displayTitle(page.tune.title)}</h2><p className="session-row-meta">{meta(page.tune)}</p></div>
          {/* Only the scores either side of the one showing are drawn, so long books open instantly. */}
          {Math.abs(i - at) <= 1 && <SessionScore tune={page.tune} />}
        </article>)}
      </div>
    </div>}
  </>;
}
