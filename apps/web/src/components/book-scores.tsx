"use client";

import { trackEvent } from "@/lib/analytics";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Score, pauseTune } from "@/components/score";
import { TuneActions } from "@/components/tune-actions";
import { GuestAbilityPrompt, SaveSharedBook } from "@/components/save-shared-book";
import { TuneAbility } from "@/components/tune-ability";
import { AbilityMark, AbilitySummary } from "@/components/ability-mark";
import { TuneIcon } from "@/components/tune-icon";
import { RepeatMark } from "@/components/repeat-mark";
import { EntryControls, GroupBar, SetControls, SetTuneOrder } from "@/components/set-controls";
import type { BookSection, getLibrary } from "@/lib/library";
import type { Playalong } from "@/lib/playalongs";
import { keyName } from "@/lib/notation";
import { displayTitle, displaySetTitle } from "@/lib/titles";

type Library = Awaited<ReturnType<typeof getLibrary>>;
const members = (section: BookSection) => section.kind === "tune" ? [section.tune] : section.tunes;

export function BookScores({ bookId, sections, defaultSound, readOnly = false, editing = false, signedIn = true, libraryTunes = [], playalongs = {} }: {
  bookId: string; sections: BookSection[]; defaultSound: number; readOnly?: boolean; editing?: boolean; signedIn?: boolean; libraryTunes?: Library["tunes"]; playalongs?: Record<number, Playalong[]>;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // A long book opens on its first score; its contents are one tap away.
  const [contentsOpen, setContentsOpen] = useState(() => sections.flatMap(members).length <= 8);
  const router = useRouter();
  const [popularChanges, setPopularChanges] = useState<Map<number, boolean>>(new Map());
  const [popularBusy, setPopularBusy] = useState<Set<number>>(new Set());
  const [popularError, setPopularError] = useState("");
  const [onlyPopular, setOnlyPopular] = useState(false);
  // Tunes ticked to group into a set, in the order they were ticked: that is the playing order.
  const [picked, setPicked] = useState<string[]>([]);
  const isPopular = (tune: ReturnType<typeof members>[number]) => popularChanges.get(tune.tuneId) ?? tune.oftenPlayed;
  const tunes = sections.flatMap((section) => members(section).map((tune) => ({ tune, instanceId: `${section.entryId}-${tune.id}` })));
  const visibleTunes = tunes.filter(({ tune }) => !onlyPopular || isPopular(tune));
  const popularCount = new Set(tunes.filter(({ tune }) => isPopular(tune)).map(({ tune }) => tune.tuneId)).size;
  const visibleSections = sections.flatMap((section): BookSection[] => {
    if (!onlyPopular) return [section];
    if (section.kind === "tune") return isPopular(section.tune) ? [section] : [];
    const tunes = section.tunes.filter(isPopular);
    return tunes.length ? [{ ...section, tunes }] : [];
  });
  async function changePopularity(tune: ReturnType<typeof members>[number]) {
    if (popularBusy.has(tune.tuneId)) return;
    const oftenPlayed = !isPopular(tune);
    setPopularBusy((current) => new Set(current).add(tune.tuneId)); setPopularError("");
    try {
      const response = await fetch(`/api/books/${bookId}/popularity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tuneId: tune.id, oftenPlayed }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update often played tunes");
      setPopularChanges((current) => new Map(current).set(tune.tuneId, result.oftenPlayed));
      router.refresh();
    } catch (cause) { setPopularError(cause instanceof Error ? cause.message : "Could not update often played tunes"); }
    finally { setPopularBusy((current) => { const next = new Set(current); next.delete(tune.tuneId); return next; }); }
  }
  const popularityMark = (tune: ReturnType<typeof members>[number]) => !editing
    ? isPopular(tune) && <span className="often-played-mark" role="img" aria-label="Often played in this session" title="Often played in this session"><Star size={15} fill="currentColor" /></span>
    : <button type="button" className="often-played-button" aria-pressed={isPopular(tune)} aria-label={`${isPopular(tune) ? "Unmark" : "Mark"} ${displayTitle(tune.title)} as often played in this session`} title={isPopular(tune) ? "Often played in this session. Click to unmark." : "Mark as often played in this session"} disabled={popularBusy.has(tune.tuneId)} onClick={() => void changePopularity(tune)}><Star size={16} fill={isPopular(tune) ? "currentColor" : "none"} /></button>;
  const positions = new Map(tunes.map((row, index) => [row.instanceId, index]));
  const pickedTitles = picked.flatMap((id) => sections.flatMap((section) => section.kind === "tune" && section.entryId === id ? [section.tune.title] : []));
  const pick = (entryId: string, on: boolean) => setPicked((current) => on ? [...current, entryId] : current.filter((id) => id !== entryId));
  function setExpanded(instanceId: string, expanded: boolean) {
    if (expanded === collapsed.has(instanceId)) trackEvent("scores_toggled", { action: expanded ? "expand" : "collapse", scope: "tune" });
    if (!expanded) pauseTune(instanceId);
    setCollapsed((current) => { const next = new Set(current); if (expanded) next.delete(instanceId); else next.add(instanceId); return next; });
  }
  const allExpanded = visibleTunes.every((row) => !collapsed.has(row.instanceId));
  const setCount = visibleSections.filter((section) => section.kind === "set").length;
  const contentsTune = (section: BookSection, tune: ReturnType<typeof members>[number]) => {
    const instanceId = `${section.entryId}-${tune.id}`, index = positions.get(instanceId)!;
    return <li className="contents-tune" key={instanceId}><a href={`#book-tune-${instanceId}`} onClick={() => { trackEvent("contents_navigated", { kind: "tune" }); setExpanded(instanceId, true); }}><span className="contents-number">{String(index + 1).padStart(2, "0")}</span><span className="contents-emoji" aria-hidden="true">{tune.emoji}</span><span className="contents-title">{displayTitle(tune.title)}</span>{signedIn && <AbilityMark practice={tune.practice} />}<span className="contents-meta">{[tune.kind, keyName(tune.mode)].filter(Boolean).join(", ")}</span></a>{popularityMark(tune)}</li>;
  };
  function renderTune(section: BookSection, sectionIndex: number, tune: ReturnType<typeof members>[number], memberIndex: number) {
    if (onlyPopular && !isPopular(tune)) return null;
    const instanceId = `${section.entryId}-${tune.id}`, expanded = !collapsed.has(instanceId), index = positions.get(instanceId)!;
    const Heading = section.kind === "set" ? "h3" : "h2";
    return <section className="book-tune" id={`book-tune-${instanceId}`} key={instanceId}>
      <div className="book-tune-head">{editing && section.kind === "tune" && <input type="checkbox" className="book-pick" checked={picked.includes(section.entryId)} onChange={(event) => pick(section.entryId, event.target.checked)} aria-label={`Pick ${displayTitle(tune.title)} for a set`} title="Pick for a set" />}<TuneIcon tune={tune} readOnly={readOnly} size="book" /><Heading><button type="button" className="book-tune-toggle" id={`toggle-${instanceId}`} aria-expanded={expanded} aria-controls={`score-${instanceId}`} onClick={() => setExpanded(instanceId, !expanded)}>
        {expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}<span className="contents-number">{String(index + 1).padStart(2, "0")}</span><span className="book-tune-title">{displayTitle(tune.title)}</span>
      </button></Heading><div className="book-tune-tools">{popularityMark(tune)}{signedIn && <TuneAbility tune={tune} editable={!readOnly} />}{readOnly ? <SaveSharedBook bookId={bookId} tuneId={tune.id} signedIn={signedIn} alreadySaved={libraryTunes.some((saved) => saved.settingId === tune.settingId)} /> : !editing ? null : section.kind === "set" ? <SetTuneOrder setId={section.setId} tuneId={tune.id} first={memberIndex === 0} last={memberIndex === section.tunes.length - 1} /> : <><EntryControls bookId={bookId} section={section} first={sectionIndex === 0} last={sectionIndex === sections.length - 1} /><TuneActions tuneId={tune.id} title={displayTitle(tune.title)} currentBookId={bookId} /></>}</div></div>
      <div className="book-tune-panel" id={`score-${instanceId}`} role="region" aria-labelledby={`toggle-${instanceId}`} hidden={!expanded}><Score tune={tune} defaultSound={defaultSound} showTitle={false} playbackId={instanceId} practiceEditable={!readOnly} showPractice={signedIn} playalongs={playalongs[tune.settingId]} /></div>
    </section>;
  }
  return <>
    {signedIn ? <AbilitySummary tunes={tunes.map((row) => row.tune)} /> : <GuestAbilityPrompt bookId={bookId} tunes={tunes.map((row) => row.tune)} />}
    {(popularCount > 0 || editing) && <div className="book-popularity-filter segmented" role="group" aria-label="Show tunes">
      <Button variant={onlyPopular ? "ghost" : "outline"} size="sm" aria-pressed={!onlyPopular} onClick={() => setOnlyPopular(false)}>All tunes</Button>
      <Button variant={onlyPopular ? "outline" : "ghost"} size="sm" aria-pressed={onlyPopular} onClick={() => { tunes.filter(({ tune }) => !isPopular(tune)).forEach((row) => pauseTune(row.instanceId)); setOnlyPopular(true); }}><Star size={14} />Often played <span>{popularCount}</span></Button>
      {editing && <span className="muted">Star the tunes often played in this session.</span>}
    </div>}
    {popularError && <p role="alert" className="form-error">{popularError}</p>}
    <nav className="book-contents" aria-label="Tunebook contents">
      <div className="book-contents-head"><h2><button type="button" className="book-contents-toggle" aria-expanded={contentsOpen} onClick={() => setContentsOpen(!contentsOpen)}>{contentsOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}Contents <span>{visibleTunes.length} {visibleTunes.length === 1 ? "tune" : "tunes"}{setCount > 0 && `, ${setCount} ${setCount === 1 ? "set" : "sets"}`}</span></button></h2><div className="book-expand-actions">
        {allExpanded ? <Button variant="ghost" size="sm" onClick={() => { trackEvent("scores_toggled", { action: "collapse", scope: "all" }); visibleTunes.forEach((row) => pauseTune(row.instanceId)); setCollapsed((current) => new Set([...current, ...visibleTunes.map((row) => row.instanceId)])); }}>Collapse all</Button>
          : <Button variant="ghost" size="sm" onClick={() => { trackEvent("scores_toggled", { action: "expand", scope: "all" }); setCollapsed((current) => { const next = new Set(current); visibleTunes.forEach((row) => next.delete(row.instanceId)); return next; }); }}>Expand all</Button>}
      </div></div>
      {contentsOpen && <ol>{visibleSections.map((section) => section.kind === "tune" ? contentsTune(section, section.tune) : <li className="contents-set" key={section.entryId}><a className="contents-set-link" href={`#book-set-${section.entryId}`} onClick={() => { trackEvent("contents_navigated", { kind: "set" }); section.tunes.forEach((tune) => setExpanded(`${section.entryId}-${tune.id}`, true)); }}><RepeatMark /><span className="contents-title">{displaySetTitle(section.name)}</span><span className="contents-meta">{section.tunes.length} {section.tunes.length === 1 ? "tune" : "tunes"}</span></a><ol>{section.tunes.map((tune) => contentsTune(section, tune))}</ol></li>)}</ol>}
    </nav>
    {onlyPopular && !visibleTunes.length && <div className="empty-state"><h2>No often played tunes yet.</h2><p>{readOnly ? "The owner hasn't marked any tunes for this session." : "Choose Edit, then star this session's regular tunes."}</p><Button variant="outline" size="sm" onClick={() => setOnlyPopular(false)}>Show all tunes</Button></div>}
    <div className="book-scores">{sections.map((section, sectionIndex) => section.kind === "tune" ? renderTune(section, sectionIndex, section.tune, 0) : onlyPopular && !section.tunes.some(isPopular) ? null : <section className="book-set" id={`book-set-${section.entryId}`} key={section.entryId} aria-labelledby={`set-heading-${section.entryId}`}>
      <header className="book-set-head"><div><p className="book-set-count"><RepeatMark />{onlyPopular ? `${section.tunes.filter(isPopular).length} of ` : ""}{section.tunes.length} tunes</p><h2 id={`set-heading-${section.entryId}`}>{displaySetTitle(section.name)}</h2>{signedIn && <AbilitySummary tunes={section.tunes} />}</div>{editing && <div className="book-set-tools"><SetControls set={{ setId: section.setId, name: section.name, autoName: section.autoName, tuneIds: section.tunes.map((tune) => tune.id) }} choices={libraryTunes.map((tune) => ({ id: tune.id, title: tune.title }))} /><EntryControls bookId={bookId} section={section} first={sectionIndex === 0} last={sectionIndex === sections.length - 1} /></div>}</header>
      {section.tunes.map((tune, index) => renderTune(section, sectionIndex, tune, index))}
    </section>)}</div>
    {editing && <GroupBar bookId={bookId} entryIds={picked} titles={pickedTitles} onDone={() => setPicked([])} />}
  </>;
}
