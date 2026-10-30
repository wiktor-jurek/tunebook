"use client";

import { trackEvent } from "@/lib/analytics";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BookPlus, Maximize2, Pause, Play, Repeat, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SessionScore } from "@/components/session-book";
import { makeTunebook } from "@/lib/finder/make-book";
import { keyName } from "@/lib/notation";
import { ABILITY_LEVELS } from "@/lib/ability";
import { AbilityMark, AbilitySummary } from "@/components/ability-mark";
import { TuneAbility } from "@/components/tune-ability";
import { RecordingTuneBooks } from "@/components/recording-tune-books";
import { LocalTime } from "@/components/local-time";
import { ScoreSheet } from "@/components/score-sheet";
import type { getRecording } from "@/lib/recordings";
import { displayTitle } from "@/lib/titles";

type Recording = NonNullable<Awaited<ReturnType<typeof getRecording>>>;
const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s % 60).padStart(2, "0")}`; };

/** A recorded session for practising at home: the setlist on a timeline, each tune loopable and slowed down, with its score. */
export function RecordingPlayer({ recording, title, length, titleClass }: { recording: Recording; title: string; length: string; titleClass: string }) {
  const router = useRouter();
  const audio = useRef<HTMLAudioElement>(null);
  const [now, setNow] = useState(0);
  const [duration, setDuration] = useState(recording.durationMs);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(100);
  const [selected, setSelected] = useState<string | null>(recording.tunes[0]?.id ?? null);
  const [loop, setLoop] = useState(false);
  const [busy, setBusy] = useState<"book" | "delete" | null>(null);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [full, setFull] = useState(false);
  // As played keeps the session's order; To learn puts the tunes you know least first, in the order they came up.
  const [order, setOrder] = useState<"played" | "learn">("played");
  const setlist = order === "played" ? recording.tunes : [...recording.tunes].sort((a, b) => ABILITY_LEVELS.indexOf(a.practice.level) - ABILITY_LEVELS.indexOf(b.practice.level) || a.startMs - b.startMs);
  const tune = recording.tunes.find((t) => t.id === selected) ?? null;
  const at = (ms: number) => recording.tunes.find((t) => ms >= t.startMs && ms < t.endMs) ?? null;
  const current = at(now);
  const percent = (ms: number) => `${Math.min(100, (100 * ms) / Math.max(duration, 1))}%`;

  // Looping keeps playback inside the selected tune's stretch of the recording.
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    const onTime = () => {
      const ms = element.currentTime * 1000;
      if (loop && tune && ms >= tune.endMs) element.currentTime = tune.startMs / 1000;
      setNow(element.currentTime * 1000);
    };
    element.addEventListener("timeupdate", onTime);
    return () => element.removeEventListener("timeupdate", onTime);
  }, [loop, tune]);
  useEffect(() => { if (audio.current) { audio.current.playbackRate = speed / 100; audio.current.preservesPitch = true; } }, [speed]);

  function seek(ms: number) {
    if (audio.current) audio.current.currentTime = ms / 1000;
    setNow(ms);
  }
  function choose(entry: Recording["tunes"][number]) { setSelected(entry.id); seek(entry.startMs); }
  async function toggle() {
    const element = audio.current;
    if (!element) return;
    if (element.paused) await element.play().catch(() => setError("Could not play the recording")); else element.pause();
  }
  async function makeBook() {
    setBusy("book"); setError("");
    try {
      const { bookId } = await makeTunebook(`Session, ${title}`, recording.tunes);
      trackEvent("session_book_made", { outcome: "success", tune_count: recording.tunes.length });
      router.push(`/books/${bookId}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not make the tunebook"); setBusy(null); }
  }
  async function change(init: RequestInit, done: () => void) {
    setError("");
    const response = await fetch(`/api/recordings/${recording.id}`, { ...init, headers: { "Content-Type": "application/json" } });
    if (!response.ok) { setError((await response.json().catch(() => ({}))).error || "Could not update the recording"); return; }
    done();
  }

  return <div className="recording">
    <header className="recording-head">
      <div><h1 className={titleClass}>{title}<LocalTime iso={new Date(recording.recordedAt).toISOString()} prefix=", " /></h1><p className="recording-sub">{length}, {recording.tunes.length} {recording.tunes.length === 1 ? "tune" : "tunes"}</p></div>
      <div className="recording-head-actions">
        {recording.tunes.length > 0 && <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void makeBook()}><BookPlus size={15} /> {busy === "book" ? "Making the tunebook" : "Make a tunebook"}</Button>}
        <Button variant="ghost" size="icon" disabled={busy !== null} aria-label="Delete recording" title="Delete recording" onClick={() => setConfirmDelete(true)}><Trash2 size={16} /></Button>
      </div>
    </header>

    <audio ref={audio} src={recording.audioUrl ?? undefined} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onLoadedMetadata={(event) => { if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration * 1000); }} />
    <div className="recording-transport">
      <Button size="icon" className="player-play" aria-label={playing ? "Pause" : "Play"} disabled={!recording.audioUrl} onClick={() => void toggle()}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</Button>
      {/* One track: the tunes are its segments. A transparent range input on top does the seeking, keyboard included. */}
      <div className="recording-track">
        {recording.tunes.map((entry) => <span key={entry.id} className="recording-segment" data-selected={entry.id === selected ? "" : undefined} style={{ left: percent(entry.startMs), width: percent(Math.max(entry.endMs - entry.startMs, duration / 200)) }} />)}
        <span className="recording-playhead" style={{ left: percent(now) }} />
        <input type="range" min={0} max={duration} step={250} value={now} aria-label="Position in the recording" aria-valuetext={`${clock(now)}${current ? `, ${displayTitle(current.title)}` : ""}`}
          onChange={(event) => { const ms = Number(event.target.value); seek(ms); const entry = at(ms); if (entry) setSelected(entry.id); }} />
      </div>
      <span className="recording-clock">{clock(now)} / {clock(duration)}</span>
    </div>
    <div className="recording-options">
      <label className="player-tempo">Speed<input type="range" min={50} max={100} step={5} value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /><output>{speed}%</output></label>
      <button type="button" className="playalong-choice" aria-pressed={loop} disabled={!tune} onClick={() => setLoop(!loop)} title={tune ? `Loop ${displayTitle(tune.title)}` : undefined}><Repeat size={14} /> Loop this tune</button>
    </div>
    {error && <p role="alert" className="form-error">{error}</p>}

    <div className="recording-body">
      <section className="recording-setlist-wrap" aria-label="Setlist">
        {recording.tunes.length > 0 && <div className="recording-setlist-head"><AbilitySummary tunes={recording.tunes} />
          <div className="appearance-picker recording-order" role="radiogroup" aria-label="Order">{([["played", "As played"], ["learn", "To learn"]] as const).map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={order === value} className="appearance-option" onClick={() => setOrder(value)}>{label}</button>)}</div>
        </div>}
        <ol className="recording-setlist">{setlist.map((entry) => <li key={entry.id} aria-current={entry.id === selected ? "true" : undefined} data-level={entry.practice.level} data-playing={playing && current?.id === entry.id ? "" : undefined}>
          <button type="button" className="recording-tune" onClick={() => choose(entry)}><span className="recording-at">{clock(entry.startMs)}</span><span className="recording-tune-name"><span className="finder-row-title">{displayTitle(entry.title)}</span><span className="finder-meta">{[entry.kind, keyName(entry.mode)].filter(Boolean).join(", ")}</span></span></button>
          <div className="recording-tune-status">
            {entry.savedId ? <TuneAbility tune={{ id: entry.savedId, title: entry.title, practice: entry.practice }} /> : <AbilityMark practice={entry.practice} label />}
            <RecordingTuneBooks title={displayTitle(entry.title)} settingId={entry.settingId} savedId={entry.savedId} inBooks={entry.inBooks} books={recording.books} />
          </div>
          <button type="button" className="icon-button recording-remove" aria-label={`Not ${displayTitle(entry.title)}: remove it from the setlist`} title="Not this tune" onClick={() => void change({ method: "PATCH", body: JSON.stringify({ operation: "removeTune", entryId: entry.id }) }, () => router.refresh())}><X size={15} /></button>
        </li>)}
          {!recording.tunes.length && <li className="muted">The finder did not name any tunes in this recording.</li>}
        </ol>
      </section>
      {tune && <aside className="recording-score" aria-label={`Score of ${displayTitle(tune.title)}`}><div className="recording-score-head"><h2>{displayTitle(tune.title)}</h2><Button size="sm" variant="ghost" onClick={() => setFull(true)}><Maximize2 size={14} /> Full screen</Button></div><p className="finder-meta">{[tune.kind, keyName(tune.mode)].filter(Boolean).join(", ")}</p><SessionScore key={tune.id} tune={tune} /></aside>}
    </div>
    {full && tune && <ScoreSheet tune={tune} title={displayTitle(tune.title)} meta={[tune.kind, keyName(tune.mode)].filter(Boolean).join(", ")} onClose={() => setFull(false)} />}
    <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} busy={busy === "delete"} title={`Delete the recording from ${title}?`} description="The audio and its setlist are deleted. Tunes you saved from it stay in your library." action={busy === "delete" ? "Deleting" : "Delete"}
      onConfirm={() => { setBusy("delete"); void change({ method: "DELETE" }, () => { router.push("/recordings"); router.refresh(); }).finally(() => setBusy(null)); }} />
  </div>;
}
