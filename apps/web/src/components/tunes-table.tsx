"use client";

import { Select } from "@/components/ui/select";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronsUpDown, Music2, Plus, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TuneAbility } from "@/components/tune-ability";
import { TuneActions } from "@/components/tune-actions";
import { TuneIcon } from "@/components/tune-icon";
import { GroupJump, groupAnchor } from "@/components/group-jump";
import { trackEvent } from "@/lib/analytics";
import { keyName } from "@/lib/notation";
import { ABILITY_LABELS, ABILITY_LEVELS, type AbilityLevel } from "@/lib/ability";
import type { CatalogTune } from "@/lib/library";
import type { TuneWithPractice } from "@/lib/tune-practice";
import { displayTitle, matchesTuneQuery, tuneSearchRank } from "@/lib/titles";
import { GROUP_BYS, GROUP_BY_LABELS, groupTunes, setGroupBy, useGroupBy, type GroupBook, type GroupBy } from "@/lib/tune-groups";
import { Button } from "@/components/ui/button";

type SortKey = "title" | "kind" | "mode" | "ability" | "added";
type Sort = { key: SortKey; descending: boolean };

const CATALOG_KINDS = ["reel", "jig", "slip jig", "hornpipe", "polka", "slide", "waltz", "march", "barndance", "strathspey", "mazurka", "three-two"];
const catalogCache = new Map<string, CatalogTune[]>();
const added = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const SORTS: Record<SortKey, (a: TuneWithPractice, b: TuneWithPractice) => number> = {
  title: (a, b) => a.title.localeCompare(b.title),
  kind: (a, b) => (a.kind ?? "").localeCompare(b.kind ?? ""),
  mode: (a, b) => (a.mode ?? "").localeCompare(b.mode ?? ""),
  ability: (a, b) => ABILITY_LEVELS.indexOf(a.practice.level) - ABILITY_LEVELS.indexOf(b.practice.level),
  added: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
};

export function TunesTable({ tunes, books = [] }: { tunes: TuneWithPractice[]; books?: GroupBook[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [level, setLevel] = useState<AbilityLevel | "">("");
  const [sort, setSort] = useState<Sort>({ key: "title", descending: false });
  const [addedTunes, setAddedTunes] = useState<TuneWithPractice[]>([]);
  const [addedIds, setAddedIds] = useState<Record<number, string>>({});
  const [addingId, setAddingId] = useState<number | null>(null);
  const [saveError, setSaveError] = useState("");
  const [catalogState, setCatalogState] = useState<{ key: string; tunes: CatalogTune[]; error: string }>({ key: "", tunes: [], error: "" });

  const allTunes = useMemo(() => {
    const byId = new Map(tunes.map((tune) => [tune.id, tune]));
    for (const tune of addedTunes) if (!byId.has(tune.id)) byId.set(tune.id, tune);
    return [...byId.values()];
  }, [tunes, addedTunes]);

  const savedBySettingId = useMemo(() => new Map(allTunes.map((tune) => [tune.settingId, tune])), [allTunes]);
  const savedByTuneId = useMemo(() => new Map(allTunes.map((tune) => [tune.tuneId, tune])), [allTunes]);

  const trimmedQuery = query.trim();
  const cacheKey = trimmedQuery ? `${trimmedQuery.toLowerCase()}\0${kind}` : "";
  const cachedCatalog = cacheKey ? catalogCache.get(cacheKey) : undefined;
  const catalogTunes = useMemo(
    () => (!cacheKey ? [] : cachedCatalog ?? (catalogState.key === cacheKey ? catalogState.tunes : [])),
    [cacheKey, cachedCatalog, catalogState],
  );
  const searching = Boolean(cacheKey && !cachedCatalog && catalogState.key !== cacheKey);
  const catalogError = catalogState.key === cacheKey ? catalogState.error : "";

  useEffect(() => {
    if (!cacheKey || catalogCache.has(cacheKey)) return;
    const controller = new AbortController();
    const isUrl = /^https?:\/\//i.test(trimmedQuery);
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: trimmedQuery });
        if (kind) params.set("kind", kind);
        const response = await fetch(`/api/catalog?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not search The Session");
        const found: CatalogTune[] = result.tunes ?? [];
        catalogCache.set(cacheKey, found);
        setCatalogState({ key: cacheKey, tunes: found, error: "" });
        trackEvent("tune_lookup", { source: isUrl ? "url" : "title", outcome: "success", result_count: found.length, query: trimmedQuery });
      } catch (cause) {
        if (controller.signal.aborted) return;
        trackEvent("tune_lookup", { source: isUrl ? "url" : "title", outcome: "error", query: trimmedQuery });
        setCatalogState({ key: cacheKey, tunes: [], error: cause instanceof Error ? cause.message : "Could not search The Session" });
      }
    }, isUrl ? 0 : 60);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cacheKey, trimmedQuery, kind]);

  const kinds = useMemo(
    () => [...new Set([...allTunes.flatMap((tune) => (tune.kind ? [tune.kind] : [])), ...(trimmedQuery ? CATALOG_KINDS : [])])].sort(),
    [allTunes, trimmedQuery],
  );

  const shown = useMemo(() => {
    const compare = SORTS[sort.key];
    return allTunes
      .filter((tune) => (!kind || tune.kind === kind) && (!level || tune.practice.level === level) && (!trimmedQuery || matchesTuneQuery(tune, trimmedQuery)))
      .sort((a, b) => {
        if (trimmedQuery && sort.key === "title" && !sort.descending) {
          const rankDiff = tuneSearchRank(a, trimmedQuery) - tuneSearchRank(b, trimmedQuery);
          if (rankDiff !== 0) return rankDiff;
        }
        return (sort.descending ? -1 : 1) * (compare(a, b) || SORTS.title(a, b));
      });
  }, [allTunes, trimmedQuery, kind, level, sort]);

  const shownTuneIds = useMemo(() => new Set(shown.map((tune) => tune.id)), [shown]);
  const catalogCandidates = useMemo(
    () => catalogTunes.filter((candidate) => {
      const saved = savedBySettingId.get(candidate.settingId) ?? savedByTuneId.get(candidate.tuneId);
      return !saved || !shownTuneIds.has(saved.id);
    }),
    [catalogTunes, savedBySettingId, savedByTuneId, shownTuneIds],
  );

  const filtered = Boolean(trimmedQuery || kind || level);
  // Grouped, each group keeps the chosen sort inside it.
  const groupBy = useGroupBy();
  const groups = useMemo(() => groupTunes(shown, groupBy, books), [shown, groupBy, books]);

  async function addCandidate(candidate: CatalogTune) {
    setAddingId(candidate.settingId);
    setSaveError("");
    try {
      const response = await fetch("/api/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settingId: candidate.settingId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save the tune");
      trackEvent("tune_saved", { outcome: "success", tune: candidate.title });
      if (result.tune) {
        setAddedTunes((current) => [...current.filter((entry) => entry.id !== result.tune.id), result.tune as TuneWithPractice]);
      } else if (result.tuneId) {
        setAddedIds((current) => ({ ...current, [candidate.tuneId]: result.tuneId as string }));
      }
      router.refresh();
    } catch (cause) {
      trackEvent("tune_saved", { outcome: "error", tune: candidate.title });
      setSaveError(cause instanceof Error ? cause.message : "Could not save the tune");
    } finally {
      setAddingId(null);
    }
  }

  function header(key: SortKey, label: string, className?: string) {
    const active = sort.key === key;
    const Icon = !active ? ChevronsUpDown : sort.descending ? ArrowDown : ArrowUp;
    return <TableHead className={className} aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}>
      <button type="button" className="table-sort" onClick={() => setSort({ key, descending: active ? !sort.descending : key === "added" })}>{label}<Icon size={13} aria-hidden="true" /></button>
    </TableHead>;
  }
  function clear() { setQuery(""); setKind(""); setLevel(""); setSaveError(""); }

  return <div className="tunes-table">
    <div className="table-toolbar">
      <label className="table-search"><Search size={15} aria-hidden="true" /><span className="sr-only">Search tunes or add from The Session</span><Input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setSaveError(""); }} placeholder="Search by title, type, key, composer or The Session link" />{query && <Button variant="ghost" size="icon-sm" aria-label="Clear search" onClick={() => { setQuery(""); setSaveError(""); }}><X size={14} /></Button>}</label>
      {(allTunes.length > 0 || filtered) && <>
        <Select className="table-filter" value={kind || "all"} onValueChange={(value) => setKind(value === "all" ? "" : value)} aria-label="Filter by type" options={[{ value: "all", label: "All types" }, ...kinds.map((entry) => ({ value: entry, label: entry[0].toUpperCase() + entry.slice(1) }))]} />
        <Select className="table-filter" value={level || "all"} onValueChange={(value) => setLevel(value === "all" ? "" : value as AbilityLevel)} aria-label="Filter by progress" options={[{ value: "all", label: "Any progress" }, ...ABILITY_LEVELS.map((entry) => ({ value: entry, label: ABILITY_LABELS[entry] }))]} />
        <span className="table-group">Group by<Select className="table-filter" value={groupBy} onValueChange={(value) => setGroupBy(value as GroupBy)} aria-label="Group by" options={GROUP_BYS.map((entry) => ({ value: entry, label: GROUP_BY_LABELS[entry] }))} /></span>
      </>}
      {filtered && <span className="table-count" role="status">{searching ? "Searching…" : `${shown.length} of ${allTunes.length}`}</span>}
    </div>
    {(saveError || catalogError) && <p className="form-error" role="alert">{saveError || catalogError}</p>}
    {!allTunes.length && !filtered ? (
      <div className="empty-state"><div className="empty-icon"><Music2 size={26} /></div><h2>Your library starts with a tune.</h2><p>Search by title above or paste a The Session link to add your first tune.</p></div>
    ) : <>
      <GroupJump groups={groups.map((group) => ({ key: group.key, label: group.label, count: group.tunes.length }))} />
      <Table>
        <TableHeader><TableRow>{header("title", "Tune")}{header("kind", "Type", "table-wide")}{header("mode", "Key", "table-wide")}{header("ability", "Progress")}{header("added", "Added", "table-wide table-added")}<TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
        <TableBody>
          {groups.map((group, groupIndex) => <Fragment key={group.key}>
            {group.label && <TableRow className="table-group-row"><TableHead colSpan={6} scope="colgroup" id={groupAnchor(groupIndex)}>{group.book ? <Link className="table-group-link" href={`/books/${group.book.id}`}>{group.label}</Link> : group.label}<span className="table-group-count">{group.tunes.length}</span></TableHead></TableRow>}
            {group.tunes.map((tune) => <TableRow key={tune.id}>
            <TableCell><div className="table-tune"><div><span className="table-title-line"><TuneIcon tune={tune} size="inline" /><Link href={`/tunes/${tune.id}`} className="table-title">{displayTitle(tune.title)}</Link></span><span className="table-meta">{tune.meter}<span className="table-narrow">{tune.kind && <>, <span className="table-kind">{tune.kind}</span></>}{tune.mode && `, ${keyName(tune.mode)}`}</span></span></div></div></TableCell>
            <TableCell className="table-wide table-kind">{tune.kind}</TableCell>
            <TableCell className="table-wide">{keyName(tune.mode)}</TableCell>
            <TableCell><TuneAbility tune={tune} /></TableCell>
            <TableCell className="table-wide table-added table-muted">{added.format(new Date(tune.createdAt))}</TableCell>
            <TableCell className="table-actions"><div className="tune-actions">{trimmedQuery && <span className="table-in-list"><Check size={14} aria-hidden="true" /> In tune list</span>}<TuneActions tuneId={tune.id} title={displayTitle(tune.title)} /></div></TableCell>
            </TableRow>)}
          </Fragment>)}
          {trimmedQuery && catalogCandidates.length > 0 && <>
            <TableRow className="table-group-row"><TableHead colSpan={6} scope="colgroup">From The Session<span className="table-group-count">{catalogCandidates.length}</span></TableHead></TableRow>
            {catalogCandidates.map((candidate) => {
              const existingId = (savedBySettingId.get(candidate.settingId) ?? savedByTuneId.get(candidate.tuneId))?.id ?? addedIds[candidate.tuneId];
              return <TableRow key={`catalog-${candidate.tuneId}-${candidate.settingId}`}>
                <TableCell><div className="table-tune"><div><span className="table-title-line"><span className="tune-icon tune-icon-inline" role="img" aria-label="Tune icon"><span aria-hidden="true">🎵</span></span>{existingId ? <Link href={`/tunes/${existingId}`} className="table-title">{displayTitle(candidate.title)}</Link> : <a href={candidate.sourceUrl} target="_blank" rel="noreferrer" className="table-title">{displayTitle(candidate.title)}</a>}</span><span className="table-meta">{candidate.meter}<span className="table-narrow">{candidate.kind && <>, <span className="table-kind">{candidate.kind}</span></>}{candidate.mode && `, ${keyName(candidate.mode)}`}</span></span></div></div></TableCell>
                <TableCell className="table-wide table-kind">{candidate.kind}</TableCell>
                <TableCell className="table-wide">{keyName(candidate.mode)}</TableCell>
                <TableCell className="table-muted">{candidate.tunebooks ? `In ${candidate.tunebooks.toLocaleString("en-GB")} tunebooks` : "On The Session"}</TableCell>
                <TableCell className="table-wide table-added table-muted">—</TableCell>
                <TableCell className="table-actions"><div className="tune-actions">{existingId ? <Link href={`/tunes/${existingId}`} className="table-in-list"><Check size={14} aria-hidden="true" /> In tune list</Link> : <Button size="sm" variant="outline" disabled={addingId === candidate.settingId} onClick={() => void addCandidate(candidate)}><Plus size={14} aria-hidden="true" /> {addingId === candidate.settingId ? "Adding" : "Add to tune list"}</Button>}</div></TableCell>
              </TableRow>;
            })}
          </>}
          {!shown.length && !catalogCandidates.length && !searching && filtered && <TableRow><TableCell colSpan={6} className="table-empty">No tunes match. <button type="button" onClick={clear}>Clear filters</button></TableCell></TableRow>}
        </TableBody>
      </Table>
    </>}
  </div>;
}
