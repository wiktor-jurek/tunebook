"use client";

import { trackEvent } from "@/lib/analytics";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronLeft, ChevronRight, Search, Star } from "lucide-react";
import { GroupMenu } from "@/components/group-menu";
import { groupAnchor } from "@/components/group-jump";
import { abcForScore, keyName } from "@/lib/notation";
import { PlayerIsland, pauseTune, useTunePlayer } from "@/components/tune-player";
import { DEFAULT_SOUND } from "@/lib/sounds";
import type { Playalong } from "@/lib/playalongs";
import type { BookSection } from "@/lib/library";
import { RepeatMark } from "@/components/repeat-mark";
import { Button } from "@/components/ui/button";
import * as Popover from "@radix-ui/react-popover";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AbilityMark } from "@/components/ability-mark";
import { displayTitle, displaySetTitle } from "@/lib/titles";
import { groupTunes, useGroupBy, type GroupBook } from "@/lib/tune-groups";
import { AccountButton } from "@/components/session-shell";

type Tune = Extract<BookSection, { kind: "tune" }>["tune"];
type Page = { tune: Tune; set: string | null; key: string };

// A tune's type and key, less whichever its group's heading already says.
const meta = (tune: Tune, groupedBy?: string) => [groupedBy === "type" ? null : tune.kind, groupedBy === "key" ? null : keyName(tune.mode)].filter(Boolean).join(", ");
// The emoji a tune gets when nothing better matches its title; shown faintly, so chosen ones stand out.
const PLAIN_EMOJI = "🎵";

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
// A tablet or desktop showing the reader: room for the score at its full desktop width.
const ROOMY = "(min-width: 700px)";
function useRoomy() {
  return useSyncExternalStore((change) => { const query = matchMedia(ROOMY); query.addEventListener("change", change); return () => query.removeEventListener("change", change); },
    () => matchMedia(ROOMY).matches, () => false);
}
function useLandscape() {
  return useSyncExternalStore((change) => { const query = matchMedia(LANDSCAPE); query.addEventListener("change", change); return () => query.removeEventListener("change", change); },
    () => matchMedia(LANDSCAPE).matches, () => false);
}

/**
 * Notation alone, wrapped for a phone held at reading distance; the kind and tempo headings are left to the title above.
 * With `playback`, it plays too, from a floating island (put away by default in session mode). `island` false keeps the
 * island off (a reader's neighbouring pages) and pauses the score.
 */
export function SessionScore({ tune, playback, island = true, islandMode = "session" }: { tune: Pick<Tune, "title" | "kind" | "meter" | "mode" | "abc">; playback?: { id: string; playalongs?: Playalong[]; defaultSound?: number }; island?: boolean; islandMode?: "session" | "practice" }) {
  // The score scales to the screen's width, so on its side a phone lays it out wider: notes stay the
  // same size and more lines fit in the short height, instead of one line blown up to fill it.
  const landscape = useLandscape();
  const roomy = useRoomy();
  const scoreId = playback?.id ?? `session-${tune.title}`;
  const paperRef = useRef<HTMLDivElement>(null);
  const player = useTunePlayer({ paperRef, tune, notation: abcForScore(tune), scoreId, defaultSound: playback?.defaultSound ?? DEFAULT_SOUND, playalongs: playback?.playalongs,
    renderOptions: { staffwidth: landscape || roomy ? 760 : 400, paddingtop: 0, paddingbottom: 0, wrap: { minSpacing: 1.6, maxSpacing: 2.6, preferredMeasuresPerLine: 4 } } });
  useEffect(() => { if (!island) pauseTune(scoreId); }, [island, scoreId]);
  return <>
    {/* abcjs sets the score's height as padding, a share of its parent's width, so the frame is what a reader caps. */}
    <div className="session-notation-frame"><div ref={paperRef} className="session-notation" aria-label={`Sheet music for ${displayTitle(tune.title)}`} /></div>
    {playback && island && <PlayerIsland player={player} mode={islandMode} />}
  </>;
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
 * screen, swiping through in playing order. `searchable` adds a filter by title, for long lists. `groupable` (for a list of
 * single tunes, not a book with its sets) puts the title in a row with a menu to group them by stage of learning, key,
 * type or the tunebooks they are in (`books`), and the scores follow that order. Grouped by tunebook, the books others
 * shared (`shared`, whose tunes are theirs, not yours) follow, to open.
 */
/** `closeHref`: open straight into the reader (a desktop's or tablet's Reader view), and leave it for that page. */
export function SessionBook({ name, sections: given, searchable = false, groupable = false, books = [], shared = [], playalongs, defaultSound, closeHref, closeLabel }: {
  name: string; sections: BookSection[]; searchable?: boolean; groupable?: boolean; books?: GroupBook[]; shared?: Omit<GroupBook, "tuneIds">[];
  playalongs?: Record<number, Playalong[]>; defaultSound?: number; closeHref?: string; closeLabel?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase();
  const matches = (tune: Tune) => !words || displayTitle(tune.title).toLowerCase().includes(words) || tune.title.toLowerCase().includes(words);
  const groupBy = useGroupBy();
  const matching = words ? given.flatMap((section): BookSection[] => section.kind === "tune" ? (matches(section.tune) ? [section] : [])
    : section.tunes.some(matches) ? [{ ...section, tunes: section.tunes.filter(matches) }] : []) : given;
  const singles = new Map(matching.flatMap((section) => section.kind === "tune" ? [[section.tune.id, section] as const] : []));
  const groups = groupable ? groupTunes(matching.flatMap((section) => section.kind === "tune" ? [section.tune] : []), groupBy, books) : [];
  // Grouped by tunebook, a tune in two books shows twice, so each showing gets an entry of its own.
  const sections = groupable ? groups.flatMap((group) => group.tunes.map((tune): BookSection => ({ ...singles.get(tune.id)!, entryId: `${group.key}-${tune.id}` }))) : matching;
  const pages = sections.flatMap((section): Page[] => section.kind === "tune" ? [{ tune: section.tune, set: null, key: `${section.entryId}-${section.tune.id}` }]
    : section.tunes.map((tune) => ({ tune, set: section.name, key: `${section.entryId}-${tune.id}` })));
  const [open, setOpenState] = useState<number | null>(closeHref ? 0 : null);
  const setOpen = useCallback((next: number | null) => { if (next === null && closeHref) router.push(closeHref); else setOpenState(next); }, [closeHref, router]);
  const [at, setAt] = useState(0);
  const pager = useRef<HTMLDivElement>(null);
  const current = useRef(0), resizing = useRef(false);
  useWakeLock(open !== null);

  // Turns the reader to a page: a neighbour slides across, a jump further away goes straight there.
  function turn(index: number) {
    const element = pager.current;
    if (!element || index < 0 || index >= pages.length) return;
    element.scrollTo({ left: index * element.clientWidth, behavior: Math.abs(index - at) === 1 ? "smooth" : "instant" });
  }
  // While the reader is open the page behind it stays still, so there is one scrollbar: the score's.
  useEffect(() => {
    if (open === null) return;
    const root = document.documentElement, before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => { root.style.overflow = before; };
  }, [open]);

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
    // Escape leaves the reader; the arrow keys turn its pages (a desktop's or tablet's keyboard).
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (step && pager.current && !(event.target as HTMLElement | null)?.closest("input, textarea, select")) {
        event.preventDefault();
        pager.current.scrollBy({ left: step * pager.current.clientWidth, behavior: "smooth" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  let index = 0;
  const row = (tune: Tune) => {
    const i = index++;
    return <li key={pages[i].key}><button type="button" className="session-row" onClick={() => show(i)}>
      <span className="session-row-emoji" aria-hidden="true" data-plain={tune.emoji === PLAIN_EMOJI ? "" : undefined}>{tune.emoji}</span>
      <span className="session-row-text"><span className="session-row-title">{displayTitle(tune.title)}</span><span className="session-row-meta">{meta(tune, groupable ? groupBy : undefined)}</span></span>
      {tune.oftenPlayed && <Star size={15} fill="currentColor" className="session-star" aria-label="Often played" />}
      <AbilityMark practice={tune.practice} />
    </button></li>;
  };

  return <>
    {/* The Reader view is the reader alone: no list behind it to scroll. */}
    {!closeHref && <>
    {groupable && <div className="session-title-row"><h1 className="session-title">{name}</h1><div className="session-title-actions"><GroupMenu /><AccountButton /></div></div>}
    {searchable && <label className="finder-search-field session-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Find a tune</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a tune" enterKeyHint="search" /></label>}
    {/* Grouped, each group is headed with its name and size, and the heading stays at the top while its tunes scroll by.
        Otherwise single tunes next to each other share one group, and each set is a group of its own under its name. */}
    <div className="session-list">{groupable ? groups.map((group, groupIndex) => <section key={group.key}>
      {/* A tunebook's heading opens the book, with its sets in playing order. */}
      {group.book ? <h2 className="session-group-title" id={groupAnchor(groupIndex)}><Link className="session-group-link" href={`/books/${group.book.id}`}><span aria-hidden="true">{group.book.emoji ?? <BookOpen size={14} />}</span>{group.label}<span className="session-group-count">{group.tunes.length}</span><ChevronRight size={15} aria-hidden="true" /></Link></h2>
        : group.label && <h2 className="session-group-title" id={groupAnchor(groupIndex)}>{group.label}<span className="session-group-count">{group.tunes.length}</span></h2>}
      <ul className="session-group">{group.tunes.map(row)}</ul>
    </section>) : runs(sections).map((run) => run.kind === "tunes"
      ? <ul className="session-group" key={run.key}>{run.tunes.map(row)}</ul>
      : <section key={run.section.entryId}><h2 className="session-group-title"><RepeatMark />{displaySetTitle(run.section.name)}</h2><ul className="session-group">{run.section.tunes.map(row)}</ul></section>)}
    </div>
    {words && !pages.length && <p className="session-empty">No tune called that.</p>}
    {groupable && groupBy === "book" && !words && shared.length > 0 && <section><h2 className="session-group-title">Shared with you</h2><ul className="session-group">{shared.map((book) => <li key={book.id}><Link className="session-row" href={`/books/${book.id}`}>
      <span className="session-row-emoji" aria-hidden="true">{book.emoji ?? <BookOpen size={18} />}</span><span className="session-row-text"><span className="session-row-title">{book.name}</span></span><ChevronRight size={18} className="session-chevron" />
    </Link></li>)}</ul></section>}
    </>}
    {open !== null && <div className="session-reader" role="dialog" aria-modal="true" aria-label={name}>
      <header className="session-reader-bar">
        <button type="button" className="session-back" onClick={() => setOpen(null)}><ChevronLeft size={22} /> <span>{closeLabel ?? name}</span></button>
        <span className="session-reader-tune">{displayTitle(pages[at]!.tune.title)}</span>
        {/* Previous and next for a mouse (a finger swipes), and the count opens every tune to jump to. */}
        {pages.length > 1 && <div className="session-reader-nav">
          <ReaderSearch pages={pages} onPick={turn} />
          <Button variant="ghost" size="icon-sm" className="session-reader-step" aria-label="Previous tune" disabled={at === 0} onClick={() => turn(at - 1)}><ChevronLeft size={18} /></Button>
          <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="session-reader-count" aria-label={`Tune ${at + 1} of ${pages.length}. Jump to another`}>{at + 1} of {pages.length}</button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" collisionPadding={12}>
              {pages.map((page, i) => <DropdownMenuCheckboxItem key={page.key} checked={i === at} onCheckedChange={() => turn(i)}>{displayTitle(page.tune.title)}</DropdownMenuCheckboxItem>)}
            </DropdownMenuContent></DropdownMenu>
          <Button variant="ghost" size="icon-sm" className="session-reader-step" aria-label="Next tune" disabled={at === pages.length - 1} onClick={() => turn(at + 1)}><ChevronRight size={18} /></Button>
        </div>}
      </header>
      <div className="session-pager" ref={pager} onScroll={(event) => { if (resizing.current) return; const next = Math.round(event.currentTarget.scrollLeft / event.currentTarget.clientWidth); current.current = next; setAt(next); }}>
        {pages.map((page, i) => <article className="session-page" key={page.key} aria-hidden={i !== at}>
          {page.set && <p className="session-page-set"><RepeatMark />{displaySetTitle(page.set)}</p>}
          <div className="session-page-head"><h2>{displayTitle(page.tune.title)}</h2><p className="session-row-meta">{meta(page.tune)}</p></div>
          {/* Only the scores either side of the one showing are drawn, so long books open instantly. */}
          {Math.abs(i - at) <= 1 && <SessionScore tune={page.tune} island={i === at} islandMode={closeHref ? "practice" : "session"} playback={{ id: `reader-${page.key}`, playalongs: playalongs?.[page.tune.settingId], defaultSound }} />}
        </article>)}
      </div>
    </div>}
  </>;
}

/**
 * Quick search in the reader's bar: type part of a tune's name to find it in the book; Enter goes to the first match.
 * Slash opens it from the keyboard.
 */
function ReaderSearch({ pages, onPick }: { pages: Page[]; onPick: (index: number) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || (event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const words = query.trim().toLowerCase();
  const matches = pages.map((page, index) => ({ page, index }))
    .filter(({ page }) => !words || displayTitle(page.tune.title).toLowerCase().includes(words) || page.tune.title.toLowerCase().includes(words)).slice(0, 8);
  const pick = (index: number) => { onPick(index); setOpen(false); setQuery(""); };
  return <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
    <Popover.Trigger asChild><Button variant="ghost" size="icon-sm" aria-label="Find a tune in this book" title="Find a tune (/)"><Search size={16} /></Button></Popover.Trigger>
    <Popover.Portal><Popover.Content className="reader-search" align="end" sideOffset={6} collisionPadding={12} aria-label="Find a tune">
      <label className="finder-search-field"><Search size={15} aria-hidden="true" /><span className="sr-only">Find a tune</span>
        <input type="search" autoFocus value={query} placeholder="Find a tune" enterKeyHint="go" onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && matches[0]) { event.preventDefault(); pick(matches[0].index); } }} /></label>
      {matches.length ? <ul className="reader-search-results">{matches.map(({ page, index }) => <li key={page.key}>
        <button type="button" onClick={() => pick(index)}><span className="session-row-title">{displayTitle(page.tune.title)}</span><span className="session-row-meta">{meta(page.tune)}</span></button>
      </li>)}</ul> : <p className="reader-search-empty">No tune called that in this book.</p>}
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
