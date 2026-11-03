"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SETS, lockTime, median, type BenchmarkClip, type EngineKey } from "@/lib/finder/benchmark";

type Engine = { key: EngineKey; name: string; colour: string };
const HEIGHT = 260, PAD = { top: 16, right: 118, bottom: 34, left: 40 };
const pct = (x: number) => `${Math.round(100 * x)}%`;

/** Share of clips each engine names correctly after hearing t seconds, and how soon it locks on. */
export function BenchmarkTiming({ clips, engines, prefixes }: { clips: BenchmarkClip[]; engines: Engine[]; prefixes: number[] }) {
  const [set, setSet] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(640);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);

  const timed = engines.filter((e) => clips.some((clip) => clip.results[e.key]?.curve));
  const shown = useMemo(() => clips.filter((clip) => !set || clip.set === set), [clips, set]);
  const stats = useMemo(() => timed.map((engine) => {
    const curves = shown.map((clip) => clip.results[engine.key]?.curve ?? "");
    const rates = prefixes.map((_, i) => curves.filter((c) => c[i] === "1").length / Math.max(1, curves.length));
    const locks = curves.map((c) => lockTime(c, prefixes)).filter((t): t is number => t !== null);
    return { ...engine, rates, median: median(locks), by10: locks.filter((t) => t <= 10).length / Math.max(1, curves.length) };
  }), [timed, shown, prefixes]);
  if (!timed.length) return null;

  const plotW = width - PAD.left - PAD.right, plotH = HEIGHT - PAD.top - PAD.bottom;
  const maxT = prefixes[prefixes.length - 1];
  const x = (t: number) => PAD.left + (t / maxT) * plotW;
  const y = (rate: number) => PAD.top + (1 - rate) * plotH;
  // Axis ticks a readable distance apart (narrow screens drop some of the short ones).
  const ticks = prefixes.filter((t, i) => i === prefixes.length - 1 || x(prefixes[prefixes.length - 1]) - x(t) >= 26)
    .reduce<number[]>((kept, t) => (!kept.length || x(t) - x(kept[kept.length - 1]) >= 26 ? [...kept, t] : kept), []);
  // End labels, nudged apart so close lines stay readable.
  const ends = stats.map((s) => ({ key: s.key, y: y(s.rates[s.rates.length - 1]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 15);

  function move(event: React.PointerEvent<SVGRectElement>) {
    const left = event.currentTarget.getBoundingClientRect().left;
    const t = ((event.clientX - left) / plotW) * maxT;
    setHover(prefixes.reduce((best, p, i) => (Math.abs(p - t) < Math.abs(prefixes[best] - t) ? i : best), 0));
  }

  return <div className="bench-timing">
    <div className="table-toolbar">
      <select className="table-filter" value={set} onChange={(event) => setSet(event.target.value)} aria-label="Filter by recordings"><option value="">All recordings</option>{SETS.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select>
      <span className="table-count">{shown.length} clips</span>
    </div>
    <div className="bench-locks">
      {stats.map((s) => <div key={s.key}>
        <span className="bench-lock-name"><span className="bench-dot" style={{ background: s.colour }} />{s.name}</span>
        <strong>{s.median === null ? "None" : `${s.median} s`}</strong><span>median time to lock on</span>
        <strong className="bench-lock-small">{pct(s.by10)}</strong><span>locked on within 10 s</span>
      </div>)}
    </div>
    <div className="bench-chart" ref={box}>
      <svg width={width} height={HEIGHT} role="img" aria-label={`Share of clips named correctly after each number of seconds: ${stats.map((s) => `${s.name} ${prefixes.map((t, i) => `${t} s ${pct(s.rates[i])}`).join(", ")}`).join("; ")}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((r) => <g key={r}><line x1={PAD.left} x2={PAD.left + plotW} y1={y(r)} y2={y(r)} className="bench-grid-line" /><text x={PAD.left - 8} y={y(r) + 4} textAnchor="end" className="bench-axis">{pct(r)}</text></g>)}
        {ticks.map((t) => <text key={t} x={x(t)} y={HEIGHT - PAD.bottom + 18} textAnchor="middle" className="bench-axis">{t}</text>)}
        <text x={PAD.left + plotW / 2} y={HEIGHT - 4} textAnchor="middle" className="bench-axis">seconds heard</text>
        {hover !== null && <line x1={x(prefixes[hover])} x2={x(prefixes[hover])} y1={PAD.top} y2={PAD.top + plotH} className="bench-crosshair" />}
        {stats.map((s) => <g key={s.key}>
          <polyline points={prefixes.map((t, i) => `${x(t)},${y(s.rates[i])}`).join(" ")} fill="none" stroke={s.colour} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hover !== null && <circle cx={x(prefixes[hover])} cy={y(s.rates[hover])} r={4.5} fill={s.colour} stroke="var(--card)" strokeWidth={2} />}
          <text x={PAD.left + plotW + 8} y={ends.find((e) => e.key === s.key)!.y + 4} className="bench-end-label">{s.name} {pct(s.rates[s.rates.length - 1])}</text>
        </g>)}
        <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="transparent" onPointerMove={move} onPointerLeave={() => setHover(null)} />
      </svg>
      {hover !== null && <div className="bench-chart-tip" style={{ left: Math.min(x(prefixes[hover]) + 12, width - 170), top: PAD.top }}>
        <strong>After {prefixes[hover]} s</strong>
        {[...stats].sort((a, b) => b.rates[hover] - a.rates[hover]).map((s) => <span key={s.key}><span className="bench-dot" style={{ background: s.colour }} />{s.name}<b>{pct(s.rates[hover])}</b></span>)}
      </div>}
    </div>
  </div>;
}
