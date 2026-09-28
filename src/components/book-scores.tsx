"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Score, pauseTune } from "@/components/score";
import { BookTuneControls } from "@/components/book-tune-controls";
import { TuneActions } from "@/components/tune-actions";
import { SaveSharedBook } from "@/components/save-shared-book";
import type { savedTunes } from "@/db/schema";

type Tune = typeof savedTunes.$inferSelect;

export function BookScores({ bookId, tunes, defaultSound, readOnly = false, signedIn = true, savedSettingIds = [] }: { bookId: string; tunes: Tune[]; defaultSound: number; readOnly?: boolean; signedIn?: boolean; savedSettingIds?: number[] }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  function setExpanded(tuneId: string, expanded: boolean) {
    if (!expanded) pauseTune(tuneId);
    setCollapsed((current) => {
      const next = new Set(current);
      if (expanded) next.delete(tuneId); else next.add(tuneId);
      return next;
    });
  }
  const allCollapsed = tunes.every((tune) => collapsed.has(tune.id));
  const allExpanded = tunes.every((tune) => !collapsed.has(tune.id));

  return <>
    <nav className="book-contents" aria-label="Tunebook contents">
      <div className="book-contents-head"><h2>Contents <span>{tunes.length}</span></h2><div className="book-expand-actions">
        <Button variant="ghost" size="sm" disabled={allCollapsed} onClick={() => { tunes.forEach((tune) => pauseTune(tune.id)); setCollapsed(new Set(tunes.map((tune) => tune.id))); }}>Collapse all</Button>
        <Button variant="ghost" size="sm" disabled={allExpanded} onClick={() => setCollapsed(new Set())}>Expand all</Button>
      </div></div>
      <ol>{tunes.map((tune, index) => <li key={tune.id}><a href={`#book-tune-${tune.id}`} onClick={() => setExpanded(tune.id, true)}><span className="contents-number">{String(index + 1).padStart(2, "0")}</span><span className="contents-title">{tune.title}</span><span className="contents-meta">{[tune.kind, tune.mode].filter(Boolean).join(" · ")}</span></a></li>)}</ol>
    </nav>
    <div className="book-scores">{tunes.map((tune, index) => {
      const expanded = !collapsed.has(tune.id);
      return <section className="book-tune" id={`book-tune-${tune.id}`} key={tune.id}>
        <div className="book-tune-head"><h2><button type="button" className="book-tune-toggle" id={`toggle-${tune.id}`} aria-expanded={expanded} aria-controls={`score-${tune.id}`} onClick={() => setExpanded(tune.id, !expanded)}>
          {expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}<span className="contents-number">{String(index + 1).padStart(2, "0")}</span><span className="book-tune-title">{tune.title}</span>
        </button></h2>{!readOnly && <div className="book-tune-tools">
          <BookTuneControls bookId={bookId} tuneId={tune.id} direction={index ? "up" : undefined} icon={<ArrowUp size={15} />} />
          <BookTuneControls bookId={bookId} tuneId={tune.id} direction={index < tunes.length - 1 ? "down" : undefined} icon={<ArrowDown size={15} />} />
          <TuneActions tuneId={tune.id} currentBookId={bookId} />
        </div>}{readOnly && <div className="book-tune-tools"><SaveSharedBook bookId={bookId} tuneId={tune.id} signedIn={signedIn} alreadySaved={savedSettingIds.includes(tune.settingId)} /></div>}</div>
        <div className="book-tune-panel" id={`score-${tune.id}`} role="region" aria-labelledby={`toggle-${tune.id}`} hidden={!expanded}>
          <Score tune={tune} defaultSound={defaultSound} showTitle={false} />
        </div>
      </section>;
    })}</div>
  </>;
}
