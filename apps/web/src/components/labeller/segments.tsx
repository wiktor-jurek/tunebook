"use client";

import { useRef, useState } from "react";
import { Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EngineGuesses, Segment } from "@/lib/labels";
import { Chip } from "@/components/ui/chip";

export type Tune = { tuneId: number; title: string; kind: string | null };
const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/** The engines' most common guesses inside a tune's span, as one-click choices: [tune, name, share of windows]. */
export function votes(guesses: EngineGuesses[], start: number, end: number) {
  const out: { engine: string; tuneId: number; name: string; share: number }[] = [];
  for (const engine of guesses) {
    const inside = engine.windows.filter((w) => w.t >= start && w.t + engine.window <= end + engine.hop);
    if (!inside.length) continue;
    const counts = new Map<number, { name: string; n: number }>();
    for (const w of inside) counts.set(w.tune, { name: w.name, n: (counts.get(w.tune)?.n ?? 0) + 1 });
    const [tuneId, best] = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0];
    out.push({ engine: engine.engine, tuneId, name: best.name, share: best.n / inside.length });
  }
  return out;
}

function TunePicker({ value, onPick, label }: { value: Tune | null; onPick: (tune: Tune | null) => void; label: string }) {
  const [query, setQuery] = useState(value?.title ?? "");
  const [results, setResults] = useState<Tune[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  function search(text: string) {
    setQuery(text); setOpen(true); setActive(0);
    window.clearTimeout(timer.current);
    if (!text.trim()) { setResults([]); return; }
    timer.current = window.setTimeout(async () => {
      const response = await fetch(`/api/admin/labels/tunes?q=${encodeURIComponent(text)}`);
      if (response.ok) setResults((await response.json()).tunes);
    }, 200);
  }
  function pick(tune: Tune) { onPick(tune); setQuery(tune.title); setOpen(false); }

  return <div className="label-picker">
    <Input value={query} aria-label={label} placeholder="Tune name or number" role="combobox" aria-expanded={open && results.length > 0} aria-autocomplete="list"
      onChange={(event) => search(event.target.value)} onFocus={(event) => event.target.select()} onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
        else if (event.key === "ArrowUp") { event.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
        else if (event.key === "Enter" && results[active]) { event.preventDefault(); pick(results[active]); }
        else if (event.key === "Escape") setOpen(false);
      }} />
    {open && results.length > 0 && <ul className="label-options" role="listbox">
      {results.map((tune, i) => <li key={tune.tuneId} role="option" aria-selected={i === active}>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => pick(tune)}>{tune.title}<span>{tune.kind ? `${tune.kind}, ` : ""}#{tune.tuneId}</span></button>
      </li>)}
    </ul>}
  </div>;
}

export function Segments({ bounds, tunes, meta, guesses, current, onTune, onPlay, onRemove }: {
  bounds: number[]; tunes: (Tune | null)[]; meta: (Segment["meta"])[]; guesses: EngineGuesses[]; current: number | null;
  onTune: (i: number, tune: Tune | null) => void; onPlay: (i: number) => void; onRemove: (i: number) => void;
}) {
  return <ol className="label-tunes">
    {tunes.map((tune, i) => {
      const m = meta[i], chips = votes(guesses, bounds[i], bounds[i + 1]);
      return <li key={i} className={current === i ? "is-current" : undefined}>
        <span className="label-number">{i + 1}</span>
        <Button variant="ghost" size="icon" aria-label={`Play tune ${i + 1}`} onClick={() => onPlay(i)}><Play size={15} /></Button>
        <span className="label-times">{clock(bounds[i])} to {clock(bounds[i + 1])}</span>
        <TunePicker key={tune?.tuneId ?? "none"} value={tune} onPick={(t) => onTune(i, t)} label={`Tune ${i + 1}`} />
        {tunes.length > 1 ? <Button variant="ghost" size="icon" aria-label={`Remove tune ${i + 1}`} onClick={() => onRemove(i)}><X size={15} /></Button> : <span />}
        {(m?.described || chips.length > 0) && <div className="label-hints">
          {m?.described && <span>Description says &quot;{m.described}&quot;{m.match && m.match !== "exact" ? ` (${m.match} match)` : ""}</span>}
          {m?.candidates?.map((id) => <Chip key={id} onClick={() => onTune(i, { tuneId: id, title: `#${id}`, kind: null })}>#{id}</Chip>)}
          {chips.map((v) => <Chip key={v.engine} pressed={tune?.tuneId === v.tuneId}
            onClick={() => onTune(i, { tuneId: v.tuneId, title: v.name, kind: null })}>{v.engine[0].toUpperCase() + v.engine.slice(1)}: {v.name} <span>{Math.round(v.share * 100)}%</span></Chip>)}
        </div>}
      </li>;
    })}
  </ol>;
}
