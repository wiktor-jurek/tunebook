"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Keyboard, Pause, Play, Scissors, ZoomIn, ZoomOut } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { FILTERS, QUEUES, type Filter, type Queue, type Verdict } from "@/lib/label-options";
import type { GroupDetail, QueueItem, Segment } from "@/lib/labels";
import { Timeline, type Peaks } from "@/components/labeller/timeline";
import { Segments, type Tune } from "@/components/labeller/segments";
import { TagPicker } from "@/components/labeller/tags";

const BLOCKS_PER_SECOND = 1000; // waveform min/max blocks: sharp down to a second or two across the screen
const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const SHORTCUTS: [string, string][] = [["Space", "Play or pause"], ["Y", "Correct"], ["N", "Wrong or unusable"], ["S", "A set: label its tunes later (YouTube)"],
  ["T", "Split at the playhead"], ["U", "Use the suggested start and end"], ["Z", "Zoom to the tunes, or out to the whole recording"],
  ["[ and ]", "Move the start or end to the playhead"], ["Left and Right", "Nudge the start by 0.1 s (with Shift, the end)"], ["J and K", "Next or previous"],
  ["Scroll", "Zoom around the pointer (sideways or with Shift, pan)"]];

async function decodePeaks(url: string, start: number): Promise<Peaks> {
  const data = await (await fetch(url)).arrayBuffer();
  const context = new AudioContext();
  const buffer = await context.decodeAudioData(data);
  void context.close();
  // The lowest and highest sample of each block, as review.html drew them; the decoded audio itself is let go.
  const samples = buffer.getChannelData(0), step = Math.max(1, Math.round(buffer.sampleRate / BLOCKS_PER_SECOND));
  const n = Math.ceil(samples.length / step), low = new Float32Array(n), high = new Float32Array(n);
  let loudest = 1e-6;
  for (let b = 0; b < n; b++) {
    let lo = 0, hi = 0;
    for (let i = b * step, end = Math.min(samples.length, i + step); i < end; i++) { const v = samples[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    low[b] = lo; high[b] = hi; loudest = Math.max(loudest, hi, -lo);
  }
  for (let b = 0; b < n; b++) { low[b] /= loudest; high[b] /= loudest; }
  return { rate: buffer.sampleRate / step, low, high, start, duration: buffer.duration };
}

export function Labeller({ queue, filter, item }: { queue: Queue; filter: Filter; item: string | null }) {
  const router = useRouter();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [counts, setCounts] = useState<Record<Filter, number> | null>(null);
  const [position, setPosition] = useState(0);
  const [failed, setFailed] = useState(false);
  const key = items[position]?.key ?? null;

  const go = useCallback((next: { queue?: Queue; filter?: Filter; item?: string | null }) => {
    const params = new URLSearchParams({ queue: next.queue ?? queue, filter: next.filter ?? filter });
    if (next.item) params.set("item", next.item);
    router.replace(`/admin/label?${params}`, { scroll: false });
  }, [router, queue, filter]);

  const loadList = useCallback(async () => {
    const response = await fetch(`/api/admin/labels?queue=${queue}&filter=${filter}`).catch(() => null);
    if (!response?.ok) { setFailed(true); return null; }
    const data = await response.json() as { items: QueueItem[]; counts: Record<Filter, number> };
    setItems(data.items); setCounts(data.counts); setFailed(false);
    return data.items;
  }, [queue, filter]);

  // First load: open the item named in the URL, if it is in this queue.
  const first = useRef(item);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/admin/labels?queue=${queue}&filter=${filter}`).catch(() => null);
      if (cancelled) return;
      if (!response?.ok) { setFailed(true); return; }
      const data = await response.json() as { items: QueueItem[]; counts: Record<Filter, number> };
      if (cancelled) return;
      setItems(data.items); setCounts(data.counts); setFailed(false);
      setPosition(first.current ? Math.max(0, data.items.findIndex((i) => i.key === first.current)) : 0);
      first.current = null;
    })();
    return () => { cancelled = true; };
  }, [queue, filter]);
  useEffect(() => { if (key) go({ item: key }); }, [key, go]);

  const next = useCallback(() => setPosition((p) => Math.min(items.length - 1, p + 1)), [items.length]);
  const previous = useCallback(() => setPosition((p) => Math.max(0, p - 1)), []);
  // As in review.py: stay at the same place in the list, which now holds the next item when the saved one drops out.
  const saved = useCallback(async () => {
    const before = items.length;
    const list = await loadList();
    if (list) setPosition((p) => Math.min(list.length - 1, list.length === before ? p + 1 : p));
  }, [items.length, loadList]);

  return <div className="labeller">
    <header className="label-bar">
      <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href="/admin/data"><ArrowLeft size={15} /> Training data</Link>
      <SegmentedControl className="label-switch" label="Recordings" value={queue} onChange={(q) => go({ queue: q, item: null })}
        options={(Object.keys(QUEUES) as Queue[]).map((q) => ({ value: q, label: QUEUES[q].label }))} />
      <select className="table-filter" value={filter} aria-label="Which labels" onChange={(event) => go({ filter: event.target.value as Filter, item: null })}>
        {(Object.keys(FILTERS) as Filter[]).map((f) => <option key={f} value={f}>{FILTERS[f]}{counts ? ` (${counts[f].toLocaleString("en-GB")})` : ""}</option>)}
      </select>
      <div className="label-nav">
        <Button variant="outline" size="icon" aria-label="Previous (K)" disabled={position <= 0} onClick={previous}><ChevronLeft size={16} /></Button>
        <span className="table-count" role="status">{items.length ? `${position + 1} of ${items.length.toLocaleString("en-GB")}` : counts ? "Nothing here" : "Loading"}</span>
        <Button variant="outline" size="icon" aria-label="Next (J)" disabled={position >= items.length - 1} onClick={next}><ChevronRight size={16} /></Button>
      </div>
      <details className="label-shortcuts"><summary><Keyboard size={15} /> Shortcuts</summary>
        <dl>{SHORTCUTS.map(([k, what]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{what}</dd></div>)}</dl>
      </details>
    </header>
    <main className="label-main">
      {key ? <LabelItem key={key} itemKey={key} queue={queue} onSaved={saved} onNext={next} onPrevious={previous} />
        : <section className="label-item label-empty"><p className="muted">{failed ? "Couldn't load the queue." : counts ? "Nothing to label here." : "Loading"}</p></section>}
    </main>
  </div>;
}

/** One recording to label, loaded fresh whenever the item changes (the parent keys it by item). */
function LabelItem({ itemKey: key, queue, onSaved, onNext, onPrevious }: { itemKey: string; queue: Queue; onSaved: () => Promise<void>; onNext: () => void; onPrevious: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [bounds, setBounds] = useState<number[]>([0, 1]);
  const [tunes, setTunes] = useState<(Tune | null)[]>([]);
  const [meta, setMeta] = useState<Segment["meta"][]>([]);
  const [tags, setTags] = useState<GroupDetail["tags"]>({ instruments: [], ensemble: null, setting: null });
  const [notes, setNotes] = useState("");
  const [view, setView] = useState<[number, number]>([0, 1]);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const until = useRef<number | null>(null);
  const start = detail?.audio.start ?? 0, length = peaks?.duration ?? Math.max(1, (detail?.audio.end ?? bounds[bounds.length - 1]) - start);
  const limits: [number, number] = [start, start + length];

  // Its segments, audio and analysis.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/admin/labels/${encodeURIComponent(key)}?queue=${queue}`);
      if (cancelled) return;
      if (!response.ok) { setStatus("Couldn't load this recording."); return; }
      const group = await response.json() as GroupDetail;
      const b = [...group.segments.map((s) => s.startS), group.segments[group.segments.length - 1].endS];
      setDetail(group); setBounds(b); setMeta(group.segments.map((s) => s.meta)); setTags(group.tags); setNotes(group.notes);
      setTunes(group.segments.map((s) => (s.tuneId ? { tuneId: s.tuneId, title: s.title ?? `#${s.tuneId}`, kind: s.kind } : null)));
      setView(queue === "youtube" ? [Math.max(group.audio.start, b[0] - 20), b[b.length - 1] + 20] : [group.audio.start, group.audio.end ?? b[b.length - 1]]);
      try {
        const decoded = await decodePeaks(group.audio.url, group.audio.start);
        if (cancelled) return;
        setPeaks(decoded);
        if (queue !== "youtube") setView([decoded.start, decoded.start + decoded.duration]);
        else setView(([a, z]) => [a, Math.min(z, decoded.start + decoded.duration)]);
      } catch { if (!cancelled) setStatus("The audio couldn't be drawn, but it can still be played."); }
    })();
    return () => { cancelled = true; };
  }, [key, queue]);

  // The playhead follows the audio, and playback stops at the end of a played tune.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const node = audio.current;
      if (node) {
        const now = node.currentTime + start;
        setPlayhead(now);
        if (until.current !== null && now >= until.current) { node.pause(); setPlaying(false); return; }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, start]);

  function play(from: number, to: number | null = null) {
    const node = audio.current;
    if (!node) return;
    node.currentTime = Math.max(0, from - start);
    until.current = to;
    void node.play().then(() => setPlaying(true)).catch(() => setStatus("The audio couldn't play."));
  }
  function toggle() {
    const node = audio.current;
    if (!node) return;
    if (playing) { node.pause(); setPlaying(false); return; }
    play(playhead ?? bounds[0]);
  }
  function seek(t: number) {
    setPlayhead(t);
    if (audio.current) audio.current.currentTime = Math.max(0, t - start);
  }
  function split() {
    if (playhead === null) { setStatus("Move the playhead to where the next tune starts, then split."); return; }
    const i = bounds.findIndex((b, j) => j < bounds.length - 1 && playhead > b + 1 && playhead < bounds[j + 1] - 1);
    if (i < 0) { setStatus("Split inside a tune, at least a second from its ends."); return; }
    const at = Math.round(playhead * 10) / 10;
    setBounds([...bounds.slice(0, i + 1), at, ...bounds.slice(i + 1)]);
    setTunes([...tunes.slice(0, i + 1), null, ...tunes.slice(i + 1)]);
    setMeta([...meta.slice(0, i + 1), null, ...meta.slice(i + 1)]);
  }
  function remove(i: number) {
    // The removed tune's time joins its neighbour.
    setBounds(bounds.filter((_, j) => j !== (i === tunes.length - 1 ? i : i + 1)));
    setTunes(tunes.filter((_, j) => j !== i)); setMeta(meta.filter((_, j) => j !== i));
  }
  function edge(which: number, value: number) {
    const lo = which ? bounds[which - 1] + 1 : start, hi = which < bounds.length - 1 ? bounds[which + 1] - 1 : start + length;
    const next = [...bounds]; next[which] = Math.round(Math.min(hi, Math.max(lo, value)) * 10) / 10; setBounds(next);
  }
  function suggest() {
    const s = detail?.lane?.suggested;
    if (!s || tunes.length !== 1) { setStatus(tunes.length === 1 ? "No suggestion for this recording." : "Suggestions are for single tunes."); return; }
    setBounds([start + s.start, start + s.end]);
  }
  const clipView: [number, number] = [Math.max(start, bounds[0] - 5), Math.min(start + length, bounds[bounds.length - 1] + 5)];
  const zoomedOut = view[0] <= limits[0] + 0.01 && view[1] >= limits[1] - 0.01;
  function zoom() { setView(zoomedOut ? clipView : limits); }

  async function verdict(value: Verdict) {
    if (!detail || !key || saving) return;
    if (value === "yes" && tunes.some((t) => !t)) { setStatus("Name every tune before marking it correct."); return; }
    setSaving(true); setStatus("Saving");
    audio.current?.pause(); setPlaying(false);
    const response = await fetch(`/api/admin/labels/${encodeURIComponent(key)}`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ queue, verdict: value, tags, notes, segments: tunes.map((t, i) => ({ startS: bounds[i], endS: bounds[i + 1], tuneId: t?.tuneId ?? null })) }),
    }).catch(() => null);
    setSaving(false);
    if (!response?.ok) { setStatus(`Couldn't save: ${(await response?.json().catch(() => null))?.error ?? "no connection"}`); return; }
    setStatus("Saved.");
    await onSaved();
  }

  // Shortcuts act on the page, not inside a text field.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select") || event.metaKey || event.ctrlKey || event.altKey) return;
      const k = event.key.toLowerCase(), last = bounds.length - 1;
      const actions: Record<string, () => void> = {
        " ": toggle, y: () => verdict("yes"), n: () => verdict("no"), t: split, u: suggest, z: zoom,
        j: onNext, k: onPrevious,
        "[": () => playhead !== null && edge(0, playhead), "]": () => playhead !== null && edge(last, playhead),
        arrowleft: () => edge(event.shiftKey ? last : 0, bounds[event.shiftKey ? last : 0] - 0.1),
        arrowright: () => edge(event.shiftKey ? last : 0, bounds[event.shiftKey ? last : 0] + 0.1),
        ...(queue === "youtube" ? { s: () => verdict("set") } : {}),
      };
      if (!actions[k]) return;
      event.preventDefault();
      actions[k]();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const current = playhead === null ? null : tunes.findIndex((_, i) => playhead >= bounds[i] && playhead < bounds[i + 1]);
  const video = detail?.source.video;
  if (!detail) return <section className="label-item label-empty"><p className="muted">{status || "Loading"}</p></section>;
  const names = tunes.map((t) => t?.title ?? "Unnamed tune");
  const verified = detail.segments[0].verified;
  const details = [detail.source.title, detail.source.channel, verified ? `marked ${({ yes: "correct", no: "wrong", set: "a set" } as Record<string, string>)[verified]}` : "unchecked"].filter(Boolean) as string[];
  return <section className="label-item" aria-busy={!peaks}>
    <header className="label-head">
      <div>
        <h2>{names.join(" / ")}</h2>
        <p className="label-meta">{details.map((d) => <span key={d}>{d}</span>)}</p>
      </div>
      <div className="label-links">
        {tunes.filter((t): t is Tune => Boolean(t)).map((t) => <a key={t.tuneId} className={buttonVariants({ variant: "ghost", size: "sm" })} href={`https://thesession.org/tunes/${t.tuneId}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {t.title} on The Session</a>)}
        {video && <a className={buttonVariants({ variant: "ghost", size: "sm" })} href={`https://www.youtube.com/watch?v=${video}&t=${Math.floor(detail.audio.offsetInVideo + bounds[0])}s`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Watch</a>}
      </div>
    </header>

    <audio ref={audio} src={detail.audio.url} preload="auto" onEnded={() => setPlaying(false)} />
    <Timeline peaks={peaks} lane={detail.lane} guesses={detail.guesses} others={detail.others} bounds={bounds} tunes={tunes.map((t) => t?.tuneId ?? null)} names={names}
      playhead={playhead} view={view} limits={limits} onSeek={seek} onBounds={setBounds} onView={setView} />

    <div className="label-tools">
      <Button variant="outline" onClick={toggle} aria-keyshortcuts="Space">{playing ? <Pause size={15} /> : <Play size={15} />} {playing ? "Pause" : "Play"}</Button>
      <span className="label-clock">{playhead === null ? "0:00.0" : clock(playhead)}</span>
      <Button variant="ghost" onClick={split} aria-keyshortcuts="T"><Scissors size={15} /> Split here</Button>
      <Button variant="ghost" onClick={zoom} aria-keyshortcuts="Z">{zoomedOut ? <><ZoomIn size={15} /> Zoom to the tunes</> : <><ZoomOut size={15} /> Whole recording</>}</Button>
      {queue !== "album" && detail.lane?.suggested && tunes.length === 1 && <Button variant="ghost" onClick={suggest} aria-keyshortcuts="U">Use suggestion</Button>}
      <span className="label-edges">
        <span>Start {clock(bounds[0])}</span>
        <Button variant="ghost" size="sm" aria-label="Start earlier" onClick={() => edge(0, bounds[0] - 0.5)}>-</Button><Button variant="ghost" size="sm" aria-label="Start later" onClick={() => edge(0, bounds[0] + 0.5)}>+</Button>
        <span>End {clock(bounds[bounds.length - 1])}</span>
        <Button variant="ghost" size="sm" aria-label="End earlier" onClick={() => edge(bounds.length - 1, bounds[bounds.length - 1] - 0.5)}>-</Button><Button variant="ghost" size="sm" aria-label="End later" onClick={() => edge(bounds.length - 1, bounds[bounds.length - 1] + 0.5)}>+</Button>
      </span>
    </div>

    <div className="label-columns">
      <Segments bounds={bounds} tunes={tunes} meta={meta} guesses={detail.guesses} current={current !== null && current >= 0 ? current : null}
        onTune={(i, t) => setTunes(tunes.map((x, j) => (j === i ? t : x)))} onPlay={(i) => play(bounds[i], bounds[i + 1])} onRemove={remove} />
      <div className="label-side">
        <TagPicker tags={tags} onChange={setTags} />
        <label className="label-notes"><span>Notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Anything odd about this recording" /></label>
      </div>
    </div>

    <footer className="label-verdicts">
      <Button onClick={() => verdict("yes")} disabled={saving} aria-keyshortcuts="Y">Correct <kbd>Y</kbd></Button>
      {queue === "youtube" && <Button variant="outline" onClick={() => verdict("set")} disabled={saving} aria-keyshortcuts="S">A set, label later <kbd>S</kbd></Button>}
      <Button variant="outline" onClick={() => verdict("no")} disabled={saving} aria-keyshortcuts="N">Wrong or unusable <kbd>N</kbd></Button>
      <span className="label-status" role="status">{status}</span>
    </footer>
  </section>;
}
