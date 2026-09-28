"use client";

import { trackEvent } from "@/lib/analytics";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Score, pauseTune } from "@/components/score";
import { TuneActions } from "@/components/tune-actions";
import { SaveSharedBook } from "@/components/save-shared-book";
import { TuneIcon } from "@/components/tune-icon";
import { EntryControls, SetControls, SetTuneOrder } from "@/components/set-controls";
import type { BookSection, getLibrary } from "@/lib/library";

type Library = Awaited<ReturnType<typeof getLibrary>>;
const members = (section: BookSection) => section.kind === "tune" ? [section.tune] : section.tunes;

export function BookScores({ bookId, sections, defaultSound, readOnly = false, signedIn = true, libraryTunes = [], mySets = [] }: {
  bookId: string; sections: BookSection[]; defaultSound: number; readOnly?: boolean; signedIn?: boolean; libraryTunes?: Library["tunes"]; mySets?: Library["sets"];
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tunes = sections.flatMap((section) => members(section).map((tune) => ({ tune, instanceId: `${section.entryId}-${tune.id}` })));
  const positions = new Map(tunes.map((row, index) => [row.instanceId, index]));
  const singles = sections.filter((section) => section.kind === "tune");
  const choices = singles.filter((section, index) => singles.findIndex((other) => other.tune.id === section.tune.id) === index).map((section) => ({ id: section.entryId, title: section.tune.title }));
  function setExpanded(instanceId: string, expanded: boolean) {
    if (expanded === collapsed.has(instanceId)) trackEvent("scores_toggled", { action: expanded ? "expand" : "collapse", scope: "tune" });
    if (!expanded) pauseTune(instanceId);
    setCollapsed((current) => { const next = new Set(current); if (expanded) next.delete(instanceId); else next.add(instanceId); return next; });
  }
  const allCollapsed = tunes.every((row) => collapsed.has(row.instanceId));
  const allExpanded = tunes.every((row) => !collapsed.has(row.instanceId));
  const setCount = sections.filter((section) => section.kind === "set").length;
  const contentsTune = (section: BookSection, tune: ReturnType<typeof members>[number]) => {
    const instanceId = `${section.entryId}-${tune.id}`, index = positions.get(instanceId)!;
    return <li key={instanceId}><a href={`#book-tune-${instanceId}`} onClick={() => { trackEvent("contents_navigated", { kind: "tune" }); setExpanded(instanceId, true); }}><span className="contents-number">{String(index + 1).padStart(2, "0")}</span><span className="contents-emoji" aria-hidden="true">{tune.emoji}</span><span className="contents-title">{tune.title}</span><span className="contents-meta">{[tune.kind, tune.mode].filter(Boolean).join(" · ")}</span></a></li>;
  };
  function renderTune(section: BookSection, sectionIndex: number, tune: ReturnType<typeof members>[number], memberIndex: number) {
    const instanceId = `${section.entryId}-${tune.id}`, expanded = !collapsed.has(instanceId), index = positions.get(instanceId)!;
    const Heading = section.kind === "set" ? "h3" : "h2";
    return <section className="book-tune" id={`book-tune-${instanceId}`} key={instanceId}>
      <div className="book-tune-head"><TuneIcon tune={tune} readOnly={readOnly} size="book" /><Heading><button type="button" className="book-tune-toggle" id={`toggle-${instanceId}`} aria-expanded={expanded} aria-controls={`score-${instanceId}`} onClick={() => setExpanded(instanceId, !expanded)}>
        {expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}<span className="contents-number">{String(index + 1).padStart(2, "0")}</span><span className="book-tune-title">{tune.title}</span>
      </button></Heading><div className="book-tune-tools">{readOnly ? <SaveSharedBook bookId={bookId} tuneId={tune.id} signedIn={signedIn} alreadySaved={libraryTunes.some((saved) => saved.settingId === tune.settingId)} /> : section.kind === "set" ? <SetTuneOrder setId={section.setId} tuneId={tune.id} first={memberIndex === 0} last={memberIndex === section.tunes.length - 1} /> : <><EntryControls bookId={bookId} section={section} first={sectionIndex === 0} last={sectionIndex === sections.length - 1} /><TuneActions tuneId={tune.id} currentBookId={bookId} /></>}</div></div>
      <div className="book-tune-panel" id={`score-${instanceId}`} role="region" aria-labelledby={`toggle-${instanceId}`} hidden={!expanded}><Score tune={tune} defaultSound={defaultSound} showTitle={false} playbackId={instanceId} /></div>
    </section>;
  }
  return <>
    <nav className="book-contents" aria-label="Tunebook contents">
      <div className="book-contents-head"><h2>Contents <span>{tunes.length} {tunes.length === 1 ? "tune" : "tunes"}{setCount > 0 && ` · ${setCount} ${setCount === 1 ? "set" : "sets"}`}</span></h2><div className="book-expand-actions">
        {!readOnly && <SetControls task={{ mode: "group", bookId }} choices={choices} />}
        <Button variant="ghost" size="sm" disabled={allCollapsed} onClick={() => { trackEvent("scores_toggled", { action: "collapse", scope: "all" }); tunes.forEach((row) => pauseTune(row.instanceId)); setCollapsed(new Set(tunes.map((row) => row.instanceId))); }}>Collapse all</Button>
        <Button variant="ghost" size="sm" disabled={allExpanded} onClick={() => { trackEvent("scores_toggled", { action: "expand", scope: "all" }); setCollapsed(new Set()); }}>Expand all</Button>
      </div></div>
      <ol>{sections.map((section) => section.kind === "tune" ? contentsTune(section, section.tune) : <li className="contents-set" key={section.entryId}><a className="contents-set-link" href={`#book-set-${section.entryId}`} onClick={() => { trackEvent("contents_navigated", { kind: "set" }); section.tunes.forEach((tune) => setExpanded(`${section.entryId}-${tune.id}`, true)); }}><span className="set-tag">SET</span><span className="contents-title">{section.name}</span><span className="contents-meta">{section.tunes.length} tunes</span></a><ol>{section.tunes.map((tune) => contentsTune(section, tune))}</ol></li>)}</ol>
    </nav>
    <div className="book-scores">{sections.map((section, sectionIndex) => section.kind === "tune" ? renderTune(section, sectionIndex, section.tune, 0) : <section className="book-set" id={`book-set-${section.entryId}`} key={section.entryId} aria-labelledby={`set-heading-${section.entryId}`}>
      <header className="book-set-head"><div><p className="eyebrow">SET · {section.tunes.length} TUNES</p><h2 id={`set-heading-${section.entryId}`}>{section.name}</h2></div>{!readOnly && <div className="book-set-tools"><SetControls task={{ mode: "edit", setId: section.setId, name: section.name, autoName: section.autoName, tuneIds: section.tunes.map((tune) => tune.id), bookCount: mySets.find((set) => set.id === section.setId)?.books.length ?? 1 }} choices={libraryTunes.map((tune) => ({ id: tune.id, title: tune.title }))} /><EntryControls bookId={bookId} section={section} first={sectionIndex === 0} last={sectionIndex === sections.length - 1} /></div>}</header>
      {section.tunes.map((tune, index) => renderTune(section, sectionIndex, tune, index))}
    </section>)}</div>
  </>;
}
