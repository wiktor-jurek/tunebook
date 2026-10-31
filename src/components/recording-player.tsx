"use client";

import { trackEvent } from "@/lib/analytics";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BookPlus, Music, Pause, Play, Repeat, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { makeTunebook } from "@/lib/finder/make-book";
import { playedSets } from "@/lib/finder/played-sets";
import { RepeatMark } from "@/components/repeat-mark";
import { keyName } from "@/lib/notation";
import { ABILITY_LABELS, playAlongSentence } from "@/lib/ability";
import { TuneAbility } from "@/components/tune-ability";
import { RecordingTuneBooks } from "@/components/recording-tune-books";
import { LocalTime } from "@/components/local-time";
import { OpeningPhrase } from "@/components/opening-phrase";
import { ScoreSheet } from "@/components/score-sheet";
import type { getRecording } from "@/lib/recordings";
import { displayTitle } from "@/lib/titles";

type Recording = NonNullable<Awaited<ReturnType<typeof getRecording>>>;
type Entry = Recording["tunes"][number];
const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s % 60).padStart(2, "0")}`; };
const minutes = (ms: number) => { const m = Math.round(ms / 60000); return m < 1 ? "under a minute" : `${m} min`; };
const meta = (entry: Entry) => [entry.kind, keyName(entry.mode)].filter(Boolean).join(", ");
// A stretch with no tune named this long is shown in the setlist: a chat, a song, a break.
const GAP_MS = 45_000;

/** Whether you could join in: you can play along (or lead), you are learning it, or not yet. */
type Standing = "join" | "learning" | "new";
const standingOf = (entry: Entry): Standing => entry.practice.level === "learned" || entry.practice.level === "mastered" ? "join" : entry.practice.level === "learning" ? "learning" : "new";
const standingLabel = (entry: Entry) => entry.savedId || entry.practice.level !== "unlearned" ? ABILITY_LABELS[entry.practice.level] : "New to you";

/**
 * A recorded session, as it relates to you: how much of the music you could have joined in on, when each tune was played,
 * and which ones you can play. Each tune can be played from, looped and slowed down, with its opening bars and full score.
 */
export function RecordingPlayer({ recording, title, length, titleClass }: { recording: Recording; title: string; length: string; titleClass: string }) {
  const router = useRouter();
  const audio = useRef<HTMLAudioElement>(null);
  const [now, setNow] = useState(0);
  const [duration, setDuration] = useState(recording.durationMs);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(100);
  const [selected, setSelected] = useState<string | null>(null);
  const [loop, setLoop] = useState(false);
  const [busy, setBusy] = useState<"book" | "delete" | null>(null);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [score, setScore] = useState<Entry | null>(null);
  const tunes = recording.tunes;
  const tune = tunes.find((t) => t.id === selected) ?? null;
  const at = (ms: number) => tunes.find((t) => ms >= t.startMs && ms < t.endMs) ?? null;
  const current = at(now);
  const percent = (ms: number) => `${Math.min(100, (100 * ms) / Math.max(duration, 1))}%`;

  // How much of the music, by time, is tunes you can play along with.
  const played = tunes.reduce((sum, t) => sum + Math.max(0, t.endMs - t.startMs), 0);
  const joinable = tunes.filter((t) => standingOf(t) === "join");
  const share = played ? Math.round((100 * joinable.reduce((sum, t) => sum + Math.max(0, t.endMs - t.startMs), 0)) / played) : 0;
  const learning = tunes.filter((t) => standingOf(t) === "learning").length;
  const unique = new Set(tunes.map((t) => t.tuneId)).size, uniqueJoin = new Set(joinable.map((t) => t.tuneId)).size;

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
  // Tapping the timeline opens the tune played there in the setlist below, and stops looping the one before.
  function scrub(ms: number) {
    seek(ms);
    const there = at(ms);
    if (there && there.id !== selected) { setSelected(there.id); setLoop(false); }
  }
  async function play() { await audio.current?.play().catch(() => setError("Could not play the recording")); }
  async function toggle() { if (audio.current?.paused) await play(); else audio.current?.pause(); }
  function playFrom(entry: Entry) { setSelected(entry.id); seek(entry.startMs); void play(); }
  async function makeBook() {
    setBusy("book"); setError("");
    try {
      const { bookId } = await makeTunebook(`Session, ${title}`, tunes, undefined, sets.map((set) => set.map((entry) => tunes.indexOf(entry))));
      trackEvent("session_book_made", { outcome: "success", tune_count: tunes.length });
      router.push(`/books/${bookId}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not make the tunebook"); setBusy(null); }
  }
  async function change(init: RequestInit, done: () => void) {
    setError("");
    const response = await fetch(`/api/recordings/${recording.id}`, { ...init, headers: { "Content-Type": "application/json" } });
    if (!response.ok) { setError((await response.json().catch(() => ({}))).error || "Could not update the recording"); return; }
    done();
  }

  // The setlist as a timeline: each tune at its time, tunes played back to back marked as a set, and any long
  // stretch between tunes that had none named.
  const sets = playedSets(tunes);
  const rows: ({ kind: "tune"; entry: Entry; inSet: boolean } | { kind: "gap"; from: number; to: number } | { kind: "set"; from: number; count: number })[] = [];
  let edge = 0;
  for (const set of sets) {
    if (set[0].startMs - edge >= GAP_MS) rows.push({ kind: "gap", from: edge, to: set[0].startMs });
    if (set.length > 1) rows.push({ kind: "set", from: set[0].startMs, count: set.length });
    for (const entry of set) { rows.push({ kind: "tune", entry, inSet: set.length > 1 }); edge = Math.max(edge, entry.endMs); }
  }

  return <div className="recording">
    <header className="recording-head">
      <h1 className={titleClass}>{title}<LocalTime iso={new Date(recording.recordedAt).toISOString()} prefix=", " /></h1>
      <p className="recording-sub">{length}, {unique} {unique === 1 ? "tune" : "tunes"}</p>
    </header>

    {tunes.length > 0 && <section className="recording-share" aria-label="How much you could join in on">
      <p className="recording-share-figure"><strong>{share}%</strong> <span>of the music was tunes you can play along with.</span></p>
      <p className="recording-share-detail">{playAlongSentence(uniqueJoin, unique)}{learning ? ` You're learning ${learning === 1 ? "one more" : `${learning} more`}.` : ""}</p>
      <p className="recording-legend" aria-hidden="true"><span data-standing="join">Can play along</span><span data-standing="learning">Learning</span><span data-standing="new">Not yet</span></p>
    </section>}

    <audio ref={audio} src={recording.audioUrl ?? undefined} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onLoadedMetadata={(event) => { if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration * 1000); }} />
    <section className="recording-deck" aria-label="Player">
      <p className="recording-now" aria-live="polite">{current ? displayTitle(current.title) : now > 0 ? "No tune named here" : " "}</p>
      {/* The whole session as one strip: each tune coloured by whether you can join in, gaps where none was named. */}
      <div className="recording-track">
        {tunes.map((entry) => <span key={entry.id} className="recording-segment" data-standing={standingOf(entry)} data-selected={entry.id === selected ? "" : undefined} style={{ left: percent(entry.startMs), width: percent(Math.max(entry.endMs - entry.startMs, duration / 200)) }}><span aria-hidden="true">{displayTitle(entry.title)}</span></span>)}
        <span className="recording-playhead" style={{ left: percent(now) }} />
        <input type="range" min={0} max={duration} step={250} value={now} aria-label="Position in the recording" aria-valuetext={`${clock(now)}${current ? `, ${displayTitle(current.title)}` : ""}`}
          onChange={(event) => scrub(Number(event.target.value))} />
      </div>
      <div className="recording-transport">
        <Button size="icon" className="player-play" aria-label={playing ? "Pause" : "Play"} disabled={!recording.audioUrl} onClick={() => void toggle()}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</Button>
        <span className="recording-clock">{clock(now)} / {clock(duration)}</span>
        <label className="player-tempo">Speed<input type="range" min={50} max={100} step={5} value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /><output>{speed}%</output></label>
      </div>
    </section>
    {error && <p role="alert" className="form-error">{error}</p>}

    <ol className="recording-setlist" aria-label="What was played">
      {rows.map((row) => row.kind === "gap"
        ? <li key={`gap-${row.from}`} className="recording-gap"><span className="recording-at">{clock(row.from)}</span><span>{minutes(row.to - row.from)}, no tune named</span></li>
        : row.kind === "set" ? <li key={`set-${row.from}`} className="recording-set-head"><RepeatMark /><span>A set of {row.count}, played back to back</span></li>
        : <SetlistRow key={row.entry.id} entry={row.entry} inSet={row.inSet} open={row.entry.id === selected} playing={playing && current?.id === row.entry.id} looping={loop && row.entry.id === selected}
          onToggle={() => setSelected(row.entry.id === selected ? null : row.entry.id)} onPlay={() => playFrom(row.entry)} onLoop={() => { setSelected(row.entry.id); setLoop(!(loop && row.entry.id === selected)); }}
          onScore={() => setScore(row.entry)} books={<RecordingTuneBooks title={displayTitle(row.entry.title)} settingId={row.entry.settingId} savedId={row.entry.savedId} inBooks={row.entry.inBooks} books={recording.books} />}
          onReject={() => void change({ method: "PATCH", body: JSON.stringify({ operation: "removeTune", entryId: row.entry.id }) }, () => { setSelected(null); router.refresh(); })} />)}
      {!tunes.length && <li className="recording-gap">The finder did not name any tunes in this recording.</li>}
    </ol>

    <footer className="recording-actions">
      {tunes.length > 0 && <Button variant="outline" disabled={busy !== null} onClick={() => void makeBook()}><BookPlus size={15} /> {busy === "book" ? "Making the tunebook" : "Make a tunebook of these"}</Button>}
      <Button variant="ghost" className="recording-delete" disabled={busy !== null} onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Delete recording</Button>
    </footer>
    {score && <ScoreSheet tune={score} title={displayTitle(score.title)} meta={meta(score)} onClose={() => setScore(null)} />}
    <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} busy={busy === "delete"} title={`Delete the recording from ${title}?`} description="The audio and its setlist are deleted. Tunes you saved from it stay in your library." action={busy === "delete" ? "Deleting" : "Delete"}
      onConfirm={() => { setBusy("delete"); void change({ method: "DELETE" }, () => { router.push("/recordings"); router.refresh(); }).finally(() => setBusy(null)); }} />
  </div>;
}

/** One tune in the setlist: when it started, what it is, and whether you can play it. Open, it shows how it goes and what to do with it. */
function SetlistRow({ entry, inSet, open, playing, looping, onToggle, onPlay, onLoop, onScore, onReject, books }: {
  entry: Entry; inSet: boolean; open: boolean; playing: boolean; looping: boolean; books: React.ReactNode;
  onToggle: () => void; onPlay: () => void; onLoop: () => void; onScore: () => void; onReject: () => void;
}) {
  const title = displayTitle(entry.title);
  return <li className="recording-entry" data-in-set={inSet ? "" : undefined} data-standing={standingOf(entry)} data-open={open ? "" : undefined} data-playing={playing ? "" : undefined}>
    <button type="button" className="recording-tune" aria-expanded={open} onClick={onToggle}>
      <span className="recording-at">{clock(entry.startMs)}</span>
      <span className="recording-dot" aria-hidden="true" />
      <span className="recording-tune-name"><span className="finder-row-title">{title}</span><span className="finder-meta">{[meta(entry), minutes(entry.endMs - entry.startMs)].filter(Boolean).join(", ")}</span></span>
      <span className="recording-standing">{standingLabel(entry)}</span>
    </button>
    {open && <div className="recording-detail">
      <OpeningPhrase tune={entry} />
      <div className="recording-detail-actions">
        <Button size="sm" onClick={onPlay}><Play size={14} fill="currentColor" /> Play from here</Button>
        <Button size="sm" variant="outline" aria-pressed={looping} onClick={onLoop}><Repeat size={14} /> {looping ? "Looping" : "Loop"}</Button>
        <Button size="sm" variant="ghost" onClick={onScore}><Music size={14} /> Full score</Button>
      </div>
      <div className="recording-detail-actions">
        {entry.savedId && <TuneAbility tune={{ id: entry.savedId, title: entry.title, practice: entry.practice }} />}
        {books}
        <button type="button" className="finder-link recording-reject" onClick={onReject} aria-label={`Not ${title}: take it off the setlist`}><X size={13} /> Not this tune</button>
      </div>
    </div>}
  </li>;
}

