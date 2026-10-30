"use client";

import { useMemo, useState } from "react";
import { Check, ExternalLink, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SETS, right, type Answer, type BenchmarkClip, type EngineKey } from "@/lib/finder/benchmark";

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const titleOf = (tunes: Record<string, { title: string }>, id: number | null | undefined) => (id == null ? "No answer" : tunes[id]?.title ?? `Tune ${id}`);
const ordinal = (n: number) => `${n}${n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

export function BenchmarkClips({ clips, tunes, engines, bands }: { clips: BenchmarkClip[]; tunes: Record<string, { title: string; kind: string }>; engines: { key: EngineKey; name: string }[]; bands: string[] }) {
  const [query, setQuery] = useState("");
  const [set, setSet] = useState("");
  const [band, setBand] = useState("");
  const [result, setResult] = useState("");
  // "all", "none", or "only:<engine>" / "missed:<engine>"
  const outcomes = useMemo(() => [
    ["all", "All right"], ["none", "All wrong"],
    ...engines.map((e) => [`only:${e.key}`, `Only ${e.name} right`]),
    ...engines.map((e) => [`missed:${e.key}`, `${e.name} wrong, another right`]),
  ], [engines]);
  const shown = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    const matches = (clip: BenchmarkClip) => {
      const hits = engines.filter((e) => right(clip, e.key)).map((e) => e.key);
      const [kind, key] = result.split(":");
      if (kind === "all") return hits.length === engines.length;
      if (kind === "none") return hits.length === 0;
      if (kind === "only") return hits.length === 1 && hits[0] === key;
      if (kind === "missed") return hits.length > 0 && !hits.includes(key as EngineKey);
      return true;
    };
    return clips.filter((clip) => (!set || clip.set === set) && (!band || clip.popularity === Number(band)) && matches(clip)
      && words.every((word) => fold(`${titleOf(tunes, clip.tuneId)} ${clip.instrument}`).includes(word)));
  }, [clips, tunes, engines, query, set, band, result]);

  function answer(r: Answer | undefined) {
    if (r?.rank === 1) return <span className="benchmark-right"><Check size={14} aria-hidden="true" /> Right</span>;
    const rank = r?.rank ?? null;
    return <><span className="benchmark-wrong">{titleOf(tunes, r?.top)}</span><span className="table-meta">{rank === null ? "Right tune not found" : rank <= 5 ? `Right tune ${ordinal(rank)}` : `Right tune ranked ${rank}`}</span></>;
  }

  return <div>
    <div className="table-toolbar">
      <label className="table-search"><Search size={15} aria-hidden="true" /><span className="sr-only">Search clips</span><Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by tune or instrument" />{query && <button type="button" className="icon-button" aria-label="Clear search" onClick={() => setQuery("")}><X size={14} /></button>}</label>
      <select className="table-filter" value={set} onChange={(event) => setSet(event.target.value)} aria-label="Filter by recordings"><option value="">All recordings</option>{SETS.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select>
      {bands.length > 0 && <select className="table-filter" value={band} onChange={(event) => setBand(event.target.value)} aria-label="Filter by popularity"><option value="">Any popularity</option>{bands.map((label, i) => <option key={label} value={i + 1}>{label}</option>)}</select>}
      <select className="table-filter" value={result} onChange={(event) => setResult(event.target.value)} aria-label="Filter by result"><option value="">Any result</option>{outcomes.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <span className="table-count" role="status">{shown.length} of {clips.length}</span>
    </div>
    <Table className="benchmark-clips">
      <TableHeader><TableRow><TableHead>Tune</TableHead>{engines.map((e) => <TableHead key={e.key}>{e.name}</TableHead>)}<TableHead><span className="sr-only">Listen</span></TableHead></TableRow></TableHeader>
      <TableBody>
        {shown.map((clip) => <TableRow key={`${clip.video}-${clip.start}-${clip.tuneId}`}>
          <TableCell><span className="table-title">{titleOf(tunes, clip.tuneId)}</span><span className="table-meta"><span className="table-kind">{tunes[clip.tuneId]?.kind}</span>, {SETS.find((entry) => entry.key === clip.set)?.label}{clip.instrument !== "band" && `, ${clip.instrument}`}{clip.popularity && bands[clip.popularity - 1] && `, ${bands[clip.popularity - 1].toLowerCase()}`}</span></TableCell>
          {engines.map((e) => <TableCell key={e.key}>{answer(clip.results[e.key])}</TableCell>)}
          <TableCell className="table-actions"><a className="button button-ghost button-sm" href={`https://www.youtube.com/watch?v=${clip.video}&t=${clip.start}s`} target="_blank" rel="noreferrer" aria-label={`Listen to ${titleOf(tunes, clip.tuneId)} on YouTube`}><ExternalLink size={14} /></a></TableCell>
        </TableRow>)}
        {!shown.length && <TableRow><TableCell colSpan={engines.length + 2} className="table-empty">No clips match.</TableCell></TableRow>}
      </TableBody>
    </Table>
  </div>;
}
