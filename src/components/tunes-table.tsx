"use client";

import { Select } from "@/components/ui/select";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TuneAbility } from "@/components/tune-ability";
import { TuneActions } from "@/components/tune-actions";
import { TuneIcon } from "@/components/tune-icon";
import { GroupJump, groupAnchor } from "@/components/group-jump";
import { keyName } from "@/lib/notation";
import { ABILITY_LABELS, ABILITY_LEVELS, type AbilityLevel } from "@/lib/ability";
import type { TuneWithPractice } from "@/lib/tune-practice";
import { displayTitle } from "@/lib/titles";
import { GROUP_BYS, GROUP_BY_LABELS, groupTunes, setGroupBy, useGroupBy, type GroupBook, type GroupBy } from "@/lib/tune-groups";

type SortKey = "title" | "kind" | "mode" | "ability" | "added";
type Sort = { key: SortKey; descending: boolean };

// Irish titles carry fadas that searches rarely type: "ril" finds "Ríl".
const fold = (text: string | null) => (text ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const added = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const SORTS: Record<SortKey, (a: TuneWithPractice, b: TuneWithPractice) => number> = {
  title: (a, b) => a.title.localeCompare(b.title),
  kind: (a, b) => (a.kind ?? "").localeCompare(b.kind ?? ""),
  mode: (a, b) => (a.mode ?? "").localeCompare(b.mode ?? ""),
  ability: (a, b) => ABILITY_LEVELS.indexOf(a.practice.level) - ABILITY_LEVELS.indexOf(b.practice.level),
  added: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
};

export function TunesTable({ tunes, books = [] }: { tunes: TuneWithPractice[]; books?: GroupBook[] }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [level, setLevel] = useState<AbilityLevel | "">("");
  const [sort, setSort] = useState<Sort>({ key: "title", descending: false });
  const kinds = useMemo(() => [...new Set(tunes.flatMap((tune) => tune.kind ? [tune.kind] : []))].sort(), [tunes]);
  const shown = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    const compare = SORTS[sort.key];
    return tunes.filter((tune) => (!kind || tune.kind === kind) && (!level || tune.practice.level === level)
      && words.every((word) => fold([tune.title, tune.kind, tune.mode, tune.meter, tune.composer].join(" ")).includes(word)))
      .sort((a, b) => (sort.descending ? -1 : 1) * (compare(a, b) || SORTS.title(a, b)));
  }, [tunes, query, kind, level, sort]);
  const filtered = Boolean(query || kind || level);
  // Grouped, each group keeps the chosen sort inside it.
  const groupBy = useGroupBy();
  const groups = useMemo(() => groupTunes(shown, groupBy, books), [shown, groupBy, books]);

  function header(key: SortKey, label: string, className?: string) {
    const active = sort.key === key;
    const Icon = !active ? ChevronsUpDown : sort.descending ? ArrowDown : ArrowUp;
    return <TableHead className={className} aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}>
      <button type="button" className="table-sort" onClick={() => setSort({ key, descending: active ? !sort.descending : key === "added" })}>{label}<Icon size={13} aria-hidden="true" /></button>
    </TableHead>;
  }
  function clear() { setQuery(""); setKind(""); setLevel(""); }

  return <div className="tunes-table">
    <div className="table-toolbar">
      <label className="table-search"><Search size={15} aria-hidden="true" /><span className="sr-only">Search tunes</span><Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by title, type, key or composer" />{query && <button type="button" className="icon-button" aria-label="Clear search" onClick={() => setQuery("")}><X size={14} /></button>}</label>
      <Select className="table-filter" value={kind || "all"} onValueChange={(value) => setKind(value === "all" ? "" : value)} aria-label="Filter by type" options={[{ value: "all", label: "All types" }, ...kinds.map((entry) => ({ value: entry, label: entry[0].toUpperCase() + entry.slice(1) }))]} />
      <Select className="table-filter" value={level || "all"} onValueChange={(value) => setLevel(value === "all" ? "" : value as AbilityLevel)} aria-label="Filter by progress" options={[{ value: "all", label: "Any progress" }, ...ABILITY_LEVELS.map((entry) => ({ value: entry, label: ABILITY_LABELS[entry] }))]} />
      <span className="table-group">Group by<Select className="table-filter" value={groupBy} onValueChange={(value) => setGroupBy(value as GroupBy)} aria-label="Group by" options={GROUP_BYS.map((entry) => ({ value: entry, label: GROUP_BY_LABELS[entry] }))} /></span>
      {filtered && <span className="table-count" role="status">{shown.length} of {tunes.length}</span>}
    </div>
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
          <TableCell className="table-actions"><TuneActions tuneId={tune.id} title={displayTitle(tune.title)} /></TableCell>
          </TableRow>)}
        </Fragment>)}
        {!shown.length && filtered && <TableRow><TableCell colSpan={6} className="table-empty">No tunes match. <button type="button" onClick={clear}>Clear filters</button></TableCell></TableRow>}
      </TableBody>
    </Table>
  </div>;
}
