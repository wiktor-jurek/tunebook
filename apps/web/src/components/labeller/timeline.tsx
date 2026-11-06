"use client";

import { useEffect, useRef, useState } from "react";
import type { EngineGuesses, GroupDetail, OtherLabel } from "@/lib/labels";

// The loaded stretch of audio, as in ml/eval/review.html: a min/max waveform drawn per device pixel (sharp at any
// zoom), a time ruler, the music-activity lane with the detector's threshold, one lane per engine with its top tune
// per window, and a lane of the labels already on this recording. The tunes being labelled are shaded spans whose
// boundaries can be dragged; a click moves the playhead; the wheel zooms (or pans, sideways or with Shift).
// All times are seconds into the source.
const RULER = 18, LANE = 20, GAP = 5, GUTTER = 96;
// Below these cosines an engine is guessing, so its lane shows a gap: an in or out point reads as a break.
// JigRipper's is its own abstention threshold; the finder's is where its wrong answers start to outnumber right ones.
const UNSURE: Record<string, number> = { jigripper: 0.26, tunebook: 0.3 };
const MUSIC_THRESHOLD = 0.6; // eval/music_activity.py suggest()
const ENGINE_NAMES: Record<string, string> = { tunebook: "Tune Companion", jigripper: "JigRipper", cadence: "Cadence", folkfriend: "FolkFriend" };

export type Peaks = { rate: number; low: Float32Array; high: Float32Array; start: number; duration: number };
type Hover = { x: number; y: number; text: string } | null;

const tuneColour = (tune: number, dark: boolean) => `hsl(${(tune * 137.5) % 360} 55% ${dark ? 62 : 40}%)`;
const clock = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

export function Timeline({ peaks, lane, guesses, others, bounds, tunes, names, playhead, view, limits, onSeek, onBounds, onView, onCreate }: {
  peaks: Peaks | null; lane: GroupDetail["lane"]; guesses: EngineGuesses[]; others: OtherLabel[]; bounds: number[]; tunes: (number | null)[];
  names: string[]; playhead: number | null; view: [number, number]; limits: [number, number];
  onSeek: (t: number) => void; onBounds: (bounds: number[]) => void; onView: (view: [number, number]) => void;
  /** Right-click: a new, unnamed tune starting (or, past the end, ending) at this time. */
  onCreate: (t: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, wave: 220 });
  const [hover, setHover] = useState<Hover>(null);
  const drag = useRef<number | null>(null);
  const { width, wave } = size;
  const musicTop = RULER + wave + GAP, enginesTop = musicTop + LANE + GAP, labelsTop = enginesTop + guesses.length * (LANE + 3);
  const height = labelsTop + LANE + 4;
  const plot = Math.max(1, width - GUTTER);
  const x = (t: number) => GUTTER + ((t - view[0]) / (view[1] - view[0])) * plot;
  const t = (px: number) => view[0] + ((px - GUTTER) / plot) * (view[1] - view[0]);
  const labelled = (time: number) => { for (let i = 0; i < tunes.length; i++) if (time >= bounds[i] && time < bounds[i + 1]) return tunes[i]; return null; };

  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.max(320, entry.contentRect.width), wave: Math.round(Math.min(380, Math.max(150, window.innerHeight * 0.32))) }));
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);

  // The wheel zooms around the pointer; sideways (or with Shift) it pans. Not passive, so the page doesn't scroll.
  const viewRef = useRef({ view, limits, onView });
  useEffect(() => { viewRef.current = { view, limits, onView }; });
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    function wheel(event: WheelEvent) {
      const { view: [a, b], limits: [lo, hi], onView: set } = viewRef.current;
      const px = event.clientX - node!.getBoundingClientRect().left;
      if (px < GUTTER) return;
      event.preventDefault();
      const span = b - a, sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey;
      if (sideways) {
        const shift = ((event.shiftKey ? event.deltaY : event.deltaX) / plot) * span;
        const from = Math.min(Math.max(lo, a + shift), hi - span);
        set([from, from + span]);
        return;
      }
      const at = a + ((px - GUTTER) / plot) * span, factor = Math.exp(event.deltaY * 0.0025);
      const next = Math.min(hi - lo, Math.max(1, span * factor));
      const from = Math.min(Math.max(lo, at - ((at - a) / span) * next), hi - next);
      set([from, from + next]);
    }
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [plot]);

  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const ratio = window.devicePixelRatio || 1;
    node.width = Math.round(width * ratio); node.height = Math.round(height * ratio);
    const g = node.getContext("2d")!;
    const style = getComputedStyle(node);
    const token = (name: string) => style.getPropertyValue(name).trim();
    const dark = matchMedia("(prefers-color-scheme: dark)").matches || document.documentElement.dataset.theme === "dark";
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, width, height);
    g.font = `11px ${token("--font-ui")}`; g.textBaseline = "middle";
    const span = (a: number, b: number) => [Math.max(GUTTER, x(a)), Math.min(width, x(b))] as const;

    // Tune spans behind the waveform, two quiet tints so neighbours read apart.
    for (let i = 0; i < bounds.length - 1; i++) {
      const [a, b] = span(bounds[i], bounds[i + 1]);
      if (b <= a) continue;
      g.fillStyle = token(i % 2 ? "--accent" : "--brand-ink-soft");
      g.fillRect(a, RULER, b - a, wave);
    }

    // Ruler.
    const seconds = view[1] - view[0], step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => seconds / s < plot / 80) ?? 600;
    g.fillStyle = token("--text-3"); g.strokeStyle = token("--border");
    for (let tick = Math.ceil(view[0] / step) * step; tick < view[1]; tick += step) {
      const px = Math.round(x(tick)) + 0.5;
      g.beginPath(); g.moveTo(px, RULER - 5); g.lineTo(px, RULER + wave); g.stroke();
      g.fillText(step < 1 ? `${clock(tick)}.${Math.round((tick % 1) * 10)}` : clock(tick), px + 3, RULER / 2 - 1);
    }

    // Waveform: per device pixel column, the lowest and highest sample of the blocks it covers.
    if (peaks) {
      const mid = RULER + wave / 2, amp = wave / 2 - 6;
      const inside = token("--foreground"), outside = token("--text-4");
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
      const columns = Math.round(width * ratio), from = Math.round(GUTTER * ratio);
      for (let d = from; d < columns; d++) {
        const t0 = t(d / ratio), t1 = t((d + 1) / ratio);
        const a = Math.max(0, Math.floor((t0 - peaks.start) * peaks.rate)), b = Math.min(peaks.low.length, Math.max(a + 1, Math.ceil((t1 - peaks.start) * peaks.rate)));
        if (a >= peaks.low.length) break;
        let lo = 0, hi = 0;
        for (let i = a; i < b; i++) { if (peaks.low[i] < lo) lo = peaks.low[i]; if (peaks.high[i] > hi) hi = peaks.high[i]; }
        g.fillStyle = t0 >= bounds[0] && t0 < bounds[bounds.length - 1] ? inside : outside;
        g.fillRect(d, (mid - hi * amp) * ratio, 1, Math.max(1, (hi - lo) * amp * ratio));
      }
      g.restore();
    }

    // Lane names in the gutter.
    const rowLabel = (text: string, top: number) => { g.fillStyle = token("--text-3"); g.fillText(text, 6, top + LANE / 2); };

    // Music activity, with the detector's threshold dashed across it.
    g.fillStyle = token("--muted"); g.fillRect(GUTTER, musicTop, plot, LANE);
    rowLabel("Music", musicTop);
    if (lane) {
      g.fillStyle = token("--brand-ink");
      const origin = peaks?.start ?? limits[0];
      for (let px = GUTTER; px < width; px++) {
        const value = lane.score[Math.floor((t(px) - origin) * lane.fps)];
        if (value === undefined) continue;
        g.globalAlpha = 0.25 + 0.75 * value;
        g.fillRect(px, musicTop + LANE - value * LANE, 1, value * LANE);
      }
      g.globalAlpha = 1;
      g.strokeStyle = token("--text-3"); g.setLineDash([2, 3]);
      g.beginPath(); g.moveTo(GUTTER, musicTop + LANE * (1 - MUSIC_THRESHOLD)); g.lineTo(width, musicTop + LANE * (1 - MUSIC_THRESHOLD)); g.stroke();
      g.setLineDash([]);
    }

    // A named bar: the text sits inside when there is room.
    const bar = (a: number, b: number, top: number, fill: string, text: string | null, ink: string, outline = false) => {
      const [l, r] = span(a, b);
      if (r - l < 1) return;
      if (outline) { g.strokeStyle = fill; g.setLineDash([3, 2]); g.strokeRect(l + 0.5, top + 0.5, r - l - 2, LANE - 1); g.setLineDash([]); }
      else { g.fillStyle = fill; g.fillRect(l, top, r - l - 1, LANE); }
      if (text && r - l > 36) {
        g.save(); g.beginPath(); g.rect(l, top, r - l - 3, LANE); g.clip();
        g.fillStyle = ink; g.fillText(text, l + 4, top + LANE / 2 + 0.5); g.restore();
      }
    };

    // Each engine's top tune per window, at the window's centre. Runs of one tune merge into one bar; the
    // labelled tune is green, any other keeps its own colour wherever it appears, and unsure windows are gaps.
    guesses.forEach((engine, row) => {
      const top = enginesTop + row * (LANE + 3), floor = UNSURE[engine.engine] ?? -Infinity;
      g.fillStyle = token("--muted"); g.fillRect(GUTTER, top, plot, LANE);
      rowLabel(ENGINE_NAMES[engine.engine] ?? engine.engine, top);
      const key = (w: EngineGuesses["windows"][number]) => (w.cos === null || w.cos >= floor ? w.tune : 0);
      const ws = engine.windows;
      for (let i = 0; i < ws.length;) {
        let j = i;
        while (j + 1 < ws.length && key(ws[j + 1]) === key(ws[i])) j++;
        const a = ws[i].t + engine.window / 2 - engine.hop / 2, b = ws[j].t + engine.window / 2 + engine.hop / 2, tune = key(ws[i]);
        if (tune && b >= view[0] && a <= view[1]) {
          const right = labelled((a + b) / 2) === tune;
          bar(a, b, top, right ? token("--success") : tuneColour(tune, dark), ws[i].name, token("--card"));
        }
        i = j + 1;
      }
    });

    // The labels on this recording: the tunes being labelled, and every other labelled stretch with its verdict.
    g.fillStyle = token("--muted"); g.fillRect(GUTTER, labelsTop, plot, LANE);
    rowLabel("Labels", labelsTop);
    for (const o of others) {
      const name = o.title ?? (o.tuneId ? `#${o.tuneId}` : "Unnamed");
      if (o.verified === "no") bar(o.startS, o.endS, labelsTop, token("--text-3"), `${name} (wrong)`, token("--text-3"), true);
      else bar(o.startS, o.endS, labelsTop, o.verified === "yes" ? token("--success") : o.verified === "set" ? token("--line-strong") : token("--text-4"),
        o.verified === "set" ? `${name} (set)` : o.verified ? name : `${name} (unchecked)`, token("--card"));
    }
    for (let i = 0; i < bounds.length - 1; i++) bar(bounds[i], bounds[i + 1], labelsTop, token("--brand-ink"), names[i], token("--on-brand-ink"));

    // The label's whole span outlined across every lane, its boundaries with grips, and the playhead.
    const [l, r] = span(bounds[0], bounds[bounds.length - 1]);
    if (r > l) { g.strokeStyle = token("--brand-ink"); g.lineWidth = 1; g.strokeRect(l + 0.5, RULER + 0.5, r - l - 1, height - RULER - 2); }
    g.fillStyle = token("--brand-ink");
    for (const b of bounds) {
      const px = x(b);
      if (px < GUTTER - 4 || px > width + 4) continue;
      g.fillRect(px - 1, RULER, 2, height - RULER); g.fillRect(px - 5, RULER, 10, 12);
    }
    if (playhead !== null && x(playhead) >= GUTTER) { g.fillStyle = token("--brand-dot"); g.fillRect(x(playhead) - 0.75, 0, 1.5, height); }
  });

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { px: event.clientX - rect.left, py: event.clientY - rect.top };
  };
  function down(event: React.PointerEvent<HTMLCanvasElement>) {
    const { px } = point(event);
    if (px < GUTTER || event.button !== 0) return; // the right button makes a new tune (onContextMenu)
    const near = bounds.map((b, i) => [Math.abs(x(b) - px), i]).sort((a, b) => a[0] - b[0])[0];
    if (near && near[0] <= 7) { drag.current = near[1]; event.currentTarget.setPointerCapture(event.pointerId); return; }
    onSeek(t(px));
  }
  function describe(px: number, py: number): string | null {
    const at = t(px);
    if (py >= musicTop && py < musicTop + LANE && lane) {
      const value = lane.score[Math.floor((at - (peaks?.start ?? limits[0])) * lane.fps)];
      return value === undefined ? null : `Music ${Math.round(value * 100)}% at ${clock(at)}`;
    }
    const row = Math.floor((py - enginesTop) / (LANE + 3));
    if (py >= enginesTop && row < guesses.length) {
      const engine = guesses[row];
      const w = engine.windows.find((w) => at >= w.t + engine.window / 2 - engine.hop / 2 && at < w.t + engine.window / 2 + engine.hop / 2);
      if (!w) return null;
      const floor = UNSURE[engine.engine] ?? -Infinity;
      return `${ENGINE_NAMES[engine.engine] ?? engine.engine}: ${w.name} (#${w.tune})${w.cos === null ? "" : `, cosine ${w.cos.toFixed(2)}`}${w.cos !== null && w.cos < floor ? ", unsure" : ""}`;
    }
    if (py >= labelsTop && py < labelsTop + LANE) {
      const o = others.find((o) => at >= o.startS && at < o.endS);
      if (o) return `${o.title ?? `#${o.tuneId}`}: ${o.verified === "yes" ? "marked correct" : o.verified === "no" ? "marked wrong" : o.verified === "set" ? "a set" : "unchecked"}`;
      const i = bounds.findIndex((b, j) => j < bounds.length - 1 && at >= b && at < bounds[j + 1]);
      return i >= 0 ? `Labelling: ${names[i]}` : null;
    }
    return null;
  }
  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    const { px, py } = point(event);
    const edge = drag.current;
    if (edge === null) {
      const text = px >= GUTTER ? describe(px, py) : null;
      setHover(text ? { x: px, y: py, text } : null);
      event.currentTarget.style.cursor = bounds.some((b) => Math.abs(x(b) - px) <= 7) ? "ew-resize" : "pointer";
      return;
    }
    const lo = edge ? bounds[edge - 1] + 1 : limits[0], hi = edge < bounds.length - 1 ? bounds[edge + 1] - 1 : limits[1];
    const next = [...bounds];
    next[edge] = Math.round(Math.min(hi, Math.max(lo, t(px))) * 10) / 10;
    onBounds(next);
  }

  const summary = `${tunes.length} ${tunes.length === 1 ? "tune" : "tunes"}, from ${bounds[0].toFixed(1)} to ${bounds[bounds.length - 1].toFixed(1)} seconds`;
  return <div className="label-timeline" ref={box}>
    <canvas ref={canvas} style={{ width, height }} role="img"
      aria-label={`Waveform of the recording with music, engine and label lanes: ${summary}. Click to move the playhead, drag a boundary, right-click to start a new tune, scroll to zoom.`}
      onPointerDown={down} onPointerMove={move} onPointerLeave={() => setHover(null)}
      onContextMenu={(event) => {
        const rect = event.currentTarget.getBoundingClientRect(), px = event.clientX - rect.left;
        if (px < GUTTER) return;
        event.preventDefault();
        onCreate(t(px));
      }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} />
    {hover && <div className="label-hover" style={{ left: Math.min(hover.x + 12, width - 260), top: hover.y + 14 }}>{hover.text}</div>}
    <p className="label-key">
      <span className="label-swatch is-match" /> the tune labelled here
      <span className="label-swatch is-other" /> another tune, one colour per tune
      <span className="label-swatch" /> gap: the engine is unsure
    </p>
  </div>;
}
